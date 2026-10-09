// Bühnen: modulare Außenkarten (CONTRACT-B1 §2, §3, §5, Team BUEHNE). Gemeinsamer Code (UMD): läuft im Browser
// (window.Shared_Buehne, Werkstatt/Galerie) und in Node (require), ohne Server.
// Exporte: bauen, pruefen, pruefeModul, kennzahlen, modulLagen, kantenTyp, vertraeglich, hand, rng, hash, bauversion,
//          setDaten/daten/ladeVerzeichnis (Node), schablonen, module,
//          TUER_ZEIT, kantenListe, ankerKanten, eingangAktion, kachelZustandRegel, raetselWege, raetselFenster, padTiles,
//          deckLinkInReichweite, interaktionsVorrang, raetselHinweis (Regeln für Server und Client).
// Determinismus: eigener PRNG (mulberry32, nur Ganzzahlen), Kandidaten nach id sortiert, kein Math.random,
// keine Abhängigkeit von der Reihenfolge der Objektschlüssel.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./buehne-kennzahlen.js'), function () { return require('./maps.js'); },
      function () { try { return require('./config.js'); } catch (e) { return null; } }, true);
  } else {
    root.Shared_Buehne = factory(root.Shared_BuehneKennzahlen, function () { return root.Shared_Maps; },
      function () { return root.Shared_Config || null; }, false);
  }
})(typeof self !== 'undefined' ? self : this, function (K, getMaps, getConfig, IST_NODE) {
  'use strict';

  const SEITEN = ['N', 'O', 'S', 'W'];
  const GEGEN = { N: 'S', S: 'N', O: 'W', W: 'O' };
  const BOEDEN = { '.': 1, ',': 1, ':': 1 };
  const BELEG_ZEICHEN = { o: 1, O: 1, I: 1 };
  const NICHT_BLOCKEND = { abholpunkt: 1, lift: 1, leiter: 1 };   // Objekt-Anker, die man betreten kann
  const SCHIFF_GAENGE = [2, 6, 10];
  const SCHIFF_STRIDE = 16;
  const STANDARD_CFG = { versuche: 20, backtrack: 200, deckungMin: 0.6, deckungRadius: 1, sichtgasseMax: 12, eingaengeMin: 2,
    abholpunkteMin: 1, sweepSeeds: 50, bestehensquote: 0.8, schiffDecks: 2, freiMin: 6 };

  // ---------------- PRNG und Hash ----------------
  function fnv(str, h) {
    h = h == null ? 0x811c9dc5 : h;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  // rng(seed) -> Funktion (uint32), mit .int(n), .pick(arr), .chance(prozent). seed: Zahl oder Text.
  function rng(seed) {
    let a = (typeof seed === 'number' ? (seed | 0) : fnv(String(seed))) >>> 0;
    const next = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0);
    };
    next.int = (n) => (n > 0 ? next() % n : 0);
    next.pick = (arr) => arr[next.int(arr.length)];
    next.chance = (p) => next.int(100) < p;
    return next;
  }
  function seedVon(text, seed) { return (fnv(String(text)) ^ Math.imul((seed | 0) + 1, 0x9E3779B1)) >>> 0; }
  // stabile Serialisierung (Schlüssel sortiert) für bauversion
  function stabil(v) {
    if (Array.isArray(v)) return '[' + v.map(stabil).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stabil(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  function hex(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }
  // Hash über rows + anker (Determinismus-Test Node vs. Browser)
  function hash(karte) {
    let h = fnv((karte.rows || []).join('\n'));
    for (const a of karte.anker || []) h = fnv('|' + a.id + ',' + a.rolle + ',' + a.x + ',' + a.y, h);
    return hex(h);
  }

  // ---------------- Daten (Vokabular, Module, Schablonen) ----------------
  let DATEN = null;
  const CACHE = { lagen: new Map(), bauversion: new Map() };
  let DATEN_NR = 0;
  function normalisiere(d) {
    d = d || {};
    if (d._norm) return d;
    const out = {
      _norm: true, _nr: ++DATEN_NR,
      kacheln: d.kacheln || { zeichen: {} },
      anker: d.anker || { rollen: {} },
      achsen: d.achsen || null,
      zustaende: d.zustaende || null,
      bauweisen: {},
      module: {}, schablonen: {},
    };
    const bws = Array.isArray(d.bauweisen) ? d.bauweisen : Object.values(d.bauweisen || {});
    for (const b of bws) if (b && b.id) out.bauweisen[b.id] = b;
    const mods = Array.isArray(d.module) ? d.module : Object.values(d.module || {});
    for (const m of mods) if (m && m.id) out.module[m.id] = m;
    const schs = Array.isArray(d.schablonen) ? d.schablonen : Object.values(d.schablonen || {});
    for (const s of schs) if (s && s.id) out.schablonen[s.id] = s;
    return out;
  }
  function setDaten(d) { DATEN = normalisiere(d); CACHE.lagen.clear(); CACHE.bauversion.clear(); return DATEN; }
  // Node: liest <dir>/{kacheln,anker,achsen,zustaende}.json und <dir>/<art>/{module,schablonen}/*.json.
  // basis: Ordner für fehlende Vokabular-Dateien (Standard content/buehnen) – so laufen Test-Fixtures mit echtem Vokabular.
  function ladeVerzeichnis(dir, basis) {
    if (!IST_NODE) throw new Error('ladeVerzeichnis: nur in Node');
    const fs = require('fs'), path = require('path');
    const std = path.join(__dirname, '..', 'content', 'buehnen');
    dir = dir || std; basis = basis || std;
    const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const voc = (name) => {
      for (const d of [dir, basis]) { const f = path.join(d, name + '.json'); if (fs.existsSync(f)) return json(f); }
      return null;
    };
    const d = { kacheln: voc('kacheln'), anker: voc('anker'), achsen: voc('achsen'), zustaende: voc('zustaende'), module: [], schablonen: [], bauweisen: [] };
    for (const bd of [path.join(dir, 'bauweisen'), path.join(basis, 'bauweisen')]) {
      if (!fs.existsSync(bd)) continue;
      for (const f of fs.readdirSync(bd).filter((n) => n.endsWith('.json')).sort()) {
        try { const b = json(path.join(bd, f)); if (b && b.id && !d.bauweisen.some((q) => q.id === b.id)) d.bauweisen.push(b); } catch (e) { /* Art-Datei kaputt: ohne Fuß */ }
      }
    }
    const arten = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n !== 'bauweisen' && fs.statSync(path.join(dir, n)).isDirectory()).sort() : [];
    for (const art of arten) {
      for (const [sub, list] of [['module', d.module], ['schablonen', d.schablonen]]) {
        const p = path.join(dir, art, sub);
        if (!fs.existsSync(p)) continue;
        for (const f of fs.readdirSync(p).filter((n) => n.endsWith('.json')).sort()) {
          try { const o = json(path.join(p, f)); o._datei = path.join(art, sub, f).replace(/\\/g, '/'); list.push(o); }
          catch (e) { list.push({ id: f.replace(/\.json$/, ''), _ladefehler: String(e.message || e), _datei: path.join(art, sub, f) }); }
        }
      }
    }
    return d;
  }
  function daten() {
    if (!DATEN) {
      if (IST_NODE) setDaten(ladeVerzeichnis());
      else setDaten({});
    }
    return DATEN;
  }
  function cfgVon(opts) {
    const c = (opts && opts.cfg) || null;
    if (c) return Object.assign({}, STANDARD_CFG, c);
    const C = getConfig();
    return Object.assign({}, STANDARD_CFG, (C && C.buehne) || {});
  }
  function zeichenInfo(D, ch) { return D.kacheln.zeichen[ch] || null; }
  function kanteVon(D, ch) { const i = zeichenInfo(D, ch); return i ? i.kante : 'fest'; }
  function objektRolle(D, rolle) {
    const r = D.anker.rollen && D.anker.rollen[rolle];
    if (r) return !!r.objekt;
    return ['terminal', 'sprengpunkt', 'zelle', 'beute', 'ziel', 'fund', 'raetsel', 'abholpunkt', 'lift', 'leiter'].includes(rolle);
  }
  function blockendesObjekt(D, rolle) { return objektRolle(D, rolle) && !NICHT_BLOCKEND[rolle]; }
  function module(D) { D = D || daten(); return Object.keys(D.module).sort().map((k) => D.module[k]); }
  function schablonen(art, D) {
    D = D || daten();
    return Object.keys(D.schablonen).sort().map((k) => D.schablonen[k]).filter((s) => !art || s.art === art);
  }

  // ---------------- Kanten (§3.2) ----------------
  // Kantentyp aus 8 Kantenkacheln (Zeichen). freiMin aus CONFIG.buehne.
  function segmentTyp(D, seg, freiMin) {
    const k = seg.map((c) => kanteVon(D, c));
    if (k[3] === 'tuer' || k[4] === 'tuer') return 'tuer';
    const mitte = k[3] === 'begehbar' && k[4] === 'begehbar';
    const n = k.filter((x) => x === 'begehbar').length;
    if (mitte && n >= (freiMin || 6)) return 'frei';
    if (mitte) return 'offen';
    return 'wand';
  }
  function segment(rows, seite, i) {
    const H = rows.length, W = rows[0].length, out = [];
    for (let k = 0; k < 8; k++) {
      if (seite === 'N') out.push(rows[0][i * 8 + k]);
      else if (seite === 'S') out.push(rows[H - 1][i * 8 + k]);
      else if (seite === 'W') out.push(rows[i * 8 + k][0]);
      else out.push(rows[i * 8 + k][W - 1]);
    }
    return out;
  }
  // kantenTyp(rows, seite, i?) – Typ des i-ten Zellanschlusses (8 Kacheln) auf der Seite N/O/S/W
  function kantenTyp(rows, seite, i, opts) {
    const D = (opts && opts.daten) ? normalisiere(opts.daten) : daten();
    return segmentTyp(D, segment(rows, seite, i || 0), cfgVon(opts).freiMin);
  }
  // Schiff: Anschluss = einzelne Kachel in Zeile 2/6/10 an der Seitenwand
  function schiffKante(D, rows, seite, zeile) {
    const W = rows[0].length;
    const c = rows[zeile] ? rows[zeile][seite === 'W' ? 0 : W - 1] : '#';
    const k = kanteVon(D, c);
    return k === 'tuer' ? 'tuer' : k === 'begehbar' ? 'offen' : 'wand';
  }
  const VERTRAEGLICH = {
    offen: { offen: 1, tuer: 1, frei: 1 },
    tuer: { offen: 1, tuer: 1, frei: 1 },
    wand: { wand: 1, frei: 1 },
    frei: { offen: 1, tuer: 1, wand: 1, frei: 1 },
  };
  function vertraeglich(a, b) { return !!(VERTRAEGLICH[a] && VERTRAEGLICH[a][b]); }
  const RAND_OK = { wand: 1, frei: 1 };

  // ---------------- Lagen (Drehen/Spiegeln) ----------------
  function spiegelX(rows) { return rows.map((r) => r.split('').reverse().join('')); }
  function spiegelY(rows) { return rows.slice().reverse(); }
  function dreheCW(rows) {
    const H = rows.length, W = rows[0].length, out = [];
    for (let y = 0; y < W; y++) { let s = ''; for (let x = 0; x < H; x++) s += rows[H - 1 - x][y]; out.push(s); }
    return out;
  }
  function transform(rows, rot, spiegel) {
    let r = rows;
    if (spiegel === true || spiegel === 'x') r = spiegelX(r);
    if (spiegel === 'y') r = spiegelY(r);
    for (let i = 0; i < rot; i++) r = dreheCW(r);
    return r;
  }
  function istSchiffModul(m) { return m.art === 'schiff' || (m.groesse && m.groesse[1] === 13); }
  // modulLagen(modul) -> [{ rot, spiegel, aussen, w, h, rows, anker, belegungen, kanten }]
  function modulLagen(modul, opts) {
    const D = (opts && opts.daten) ? normalisiere(opts.daten) : daten();
    return lagenVon(D, cfgVon(opts), modul, !(opts && opts.ohneCache));
  }
  function lagenVon(D, cfg, modul, cache) {
    const key = D._nr + '#' + modul.id + '#' + cfg.freiMin;
    if (cache && CACHE.lagen.has(key)) return CACHE.lagen.get(key);
    const out = [];
    const rows0 = modul.rows || [];
    if (!rows0.length || !rows0[0].length) return out;
    const anker0 = (modul.anker && modul.anker.length === rows0.length) ? modul.anker : rows0.map((r) => '.'.repeat(r.length));
    const bel0 = (modul.belegungen || []).filter((b) => Array.isArray(b) && b.length === rows0.length);
    const seen = new Set();
    if (istSchiffModul(modul)) {
      const sp = modul.spiegeln ? [false, 'y'] : [false];
      for (const s of sp) {
        const rows = transform(rows0, 0, s);
        const sig = rows.join('') + '|' + transform(anker0, 0, s).join('');
        if (seen.has(sig)) continue; seen.add(sig);
        const kanten = {};
        for (const seite of ['W', 'O']) kanten[seite] = SCHIFF_GAENGE.map((z) => schiffKante(D, rows, seite, z));
        out.push({ rot: 0, spiegel: s, aussen: null, w: rows[0].length, h: rows.length, rows, anker: transform(anker0, 0, s),
          belegungen: bel0.map((b) => transform(b, 0, s)), kanten });
      }
    } else {
      const sp = modul.spiegeln ? [false, true] : [false];
      const rots = modul.drehen === false ? [0] : [0, 1, 2, 3];
      for (const s of sp) for (const rot of rots) {
        const rows = transform(rows0, rot, s);
        if (rows.length % 8 || rows[0].length % 8) continue;
        const ank = transform(anker0, rot, s);
        // entdoppeln nur bei gleicher Außenkante: ein symmetrisches Modul muss für jede richtung eine Lage behalten
        const sig = SEITEN[rot] + '|' + rows.join('') + '|' + ank.join('');
        if (seen.has(sig)) continue; seen.add(sig);
        const cw = rows[0].length / 8, ch = rows.length / 8;
        const kanten = {};
        for (const seite of SEITEN) {
          const n = (seite === 'N' || seite === 'S') ? cw : ch;
          kanten[seite] = [];
          for (let i = 0; i < n; i++) kanten[seite].push(segmentTyp(D, segment(rows, seite, i), cfg.freiMin));
        }
        out.push({ rot, spiegel: s, aussen: SEITEN[rot], w: rows[0].length, h: rows.length, rows, anker: ank,
          belegungen: bel0.map((b) => transform(b, rot, s)), kanten });
      }
    }
    if (cache) CACHE.lagen.set(key, out);
    return out;
  }

  // ---------------- Leitstück-Fuß (Nachtrag „Leitstück-Fuß“ / „Rundungsregel Leitstück-Fuß“) ----------------
  // Datenquelle: Bauweisen-Tabelle leit[platztyp][art] = Modell-ID (oder { "*": id, <platztyp>: id }) und
  // leit_fuss: { "<Modell-ID>": [fw, fd] } in Kacheln, Grundlage N (fw entlang x des unrotierten Moduls).
  // Rundungsregel (Studioleitung): x0 = ax - floor((fw-1)/2), y0 = ay - floor((fd-1)/2), Rechteck fw × fd (x1/y1 inklusiv),
  // Modellmitte (x0 + fw/2, y0 + fd/2); gerade Größe -> Anker = obere linke der mittleren Kacheln.
  // Im Modul gilt sie in Grundlage N; beim Zusammenbau wird das Rechteck mit dem Modul gespiegelt/gedreht und steht an der
  // Karte am Anker als fuss: [x0, y0, w, h] (Kartenkacheln, nach Lage) – VOXEL soll für gebaute Karten dieses Feld nutzen.
  function leitFuss(ax, ay, fw, fd) {
    const x0 = ax - Math.floor((fw - 1) / 2), y0 = ay - Math.floor((fd - 1) / 2);
    return { x0, y0, x1: x0 + fw - 1, y1: y0 + fd - 1, mx: x0 + fw / 2, my: y0 + fd / 2 };
  }
  function leitModell(D, bauweise, typ, art) {
    const b = D.bauweisen && D.bauweisen[bauweise];
    const e = b && b.leit && b.leit[typ] && b.leit[typ][art];
    if (!e) return null;
    return typeof e === 'string' ? e : (e[typ] || e['*'] || null);
  }
  function leitModellFuss(D, bauweise, typ, art) {
    const m = leitModell(D, bauweise, typ, art);
    if (!m) return null;
    const b = D.bauweisen[bauweise];
    const f = b.leit_fuss && b.leit_fuss[m];
    return { modell: m, fuss: Array.isArray(f) && f.length === 2 ? [f[0] | 0, f[1] | 0] : null };
  }
  // Punkt (x, y) eines W×H-Moduls in die Lage (spiegel, rot) übertragen (gleiche Transformation wie transform())
  function lagePunkt(x, y, W, H, rot, spiegel) {
    if (spiegel === true || spiegel === 'x') x = W - 1 - x;
    if (spiegel === 'y') y = H - 1 - y;
    for (let i = 0; i < rot; i++) { const nx = H - 1 - y, ny = x; x = nx; y = ny; const t = W; W = H; H = t; }
    return [x, y];
  }
  const BLOCK = { O: 1, X: 1 };
  // Grundfläche [x0, y0, w, h] prüfen: alle Kacheln Block (O/X); 1×1 darf auf freier Fläche stehen. -> Fehlertext | null
  function fussFehler(rows, r) {
    const [x0, y0, w, h] = r;
    if (w * h <= 1) return null;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const c = rows[y] && rows[y][x];
      if (c == null) return `Grundfläche ${w}×${h} ragt hinaus (${x},${y})`;
      if (!BLOCK[c]) return `Grundfläche ${w}×${h} bei (${x},${y}) ist "${c}", nicht Block (O/X)`;
    }
    return null;
  }
  const leitAufDeckung = (i) => !!i && i.cover > 0 && !['wand', 'fels', 'leere', 'zaun'].includes(i.kind);

  // ---------------- Modulprüfung (Werkstatt live, tools/buehne.js modul) ----------------
  function lPad(pass, x, y) {
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) if (pass(x + dx, y) && pass(x, y + dy)) return true;
    return false;
  }
  function pruefeModul(modul, opts) {
    const D = (opts && opts.daten) ? normalisiere(opts.daten) : daten();
    const fehler = [], warnungen = [];
    const F = (code, msg, x, y) => fehler.push(x == null ? { code, msg } : { code, msg, x, y });
    const Wn = (code, msg, x, y) => warnungen.push(x == null ? { code, msg } : { code, msg, x, y });
    if (!modul || typeof modul !== 'object') { F('K-RASTER', 'kein Modul'); return { ok: false, fehler, warnungen, lagen: [] }; }
    if (modul._ladefehler) { F('K-RASTER', 'JSON: ' + modul._ladefehler); return { ok: false, fehler, warnungen, lagen: [] }; }
    if (modul.format !== 'modul/1') F('K-RASTER', `format muss "modul/1" sein (ist ${JSON.stringify(modul.format)})`);
    const teile = String(modul.id || '').split('.');
    if (teile.length < 3) F('K-RASTER', `id "${modul.id}" nicht im Schema <art>.<typ>.<variante>`);
    else {
      if (modul.art && teile[0] !== modul.art) F('K-RASTER', `id-Präfix ${teile[0]} ≠ art ${modul.art}`);
      if (modul.typ && teile[1] !== modul.typ) F('K-RASTER', `id-Typ ${teile[1]} ≠ typ ${modul.typ}`);
    }
    const schiff = istSchiffModul(modul);
    const rows = modul.rows || [];
    const g = modul.groesse || [];
    let H, W;
    if (schiff) { W = g[0]; H = 13; if (![5, 6, 8, 12].includes(W)) Wn('K-RASTER', `Schiffsbreite ${W} nicht im Raster 5/6/8/12`); }
    else {
      const ok = [[1, 1], [2, 1], [1, 2], [2, 2]].some((p) => p[0] === g[0] && p[1] === g[1]);
      if (!ok) F('K-RASTER', `groesse ${JSON.stringify(g)} ungültig ([1,1], [2,1], [2,2])`);
      W = (g[0] || 1) * 8; H = (g[1] || 1) * 8;
    }
    if (rows.length !== H) F('K-RASTER', `rows: ${rows.length} Zeilen, erwartet ${H}`);
    rows.forEach((r, y) => {
      if (typeof r !== 'string' || r.length !== W) F('K-RASTER', `Zeile ${y}: Länge ${r && r.length}, erwartet ${W}`, 0, y);
      else for (let x = 0; x < r.length; x++) {
        const i = zeichenInfo(D, r[x]);
        if (!i) F('K-RASTER', `unbekanntes Zeichen "${r[x]}"`, x, y);
        else if (i.nurUeberzug) F('K-RASTER', `"${r[x]}" (${i.kind}) nur aus dem Zustand-Überzug, nicht im Modul`, x, y);
      }
    });
    if (fehler.length) return { ok: false, fehler, warnungen, lagen: [] };
    const ank = modul.anker || rows.map((r) => '.'.repeat(r.length));
    if (ank.length !== H || ank.some((r) => typeof r !== 'string' || r.length !== W)) F('K-RASTER', 'anker-Overlay hat nicht die Größe von rows');
    const leg = modul.anker_legende || {};
    for (const c of Object.keys(leg).sort()) {
      const e = leg[c];
      if (!e || !e.rolle || !(D.anker.rollen || {})[e.rolle]) F('K-RASTER', `anker_legende "${c}": unbekannte Rolle ${e && e.rolle}`);
      if (e && e.rolle === 'eingang' && e.art && !['laut', 'leise', 'technisch'].includes(e.art)) F('K-RASTER', `eingang art ${e.art} unbekannt`);
    }
    const info = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? null : zeichenInfo(D, rows[y][x]);
    const begeh = (x, y) => { const i = info(x, y); return !!i && !K.fest(i); };
    const anker = [];
    if (!fehler.length) ank.forEach((r, y) => { for (let x = 0; x < r.length; x++) {
      const c = r[x]; if (c === '.' || c === ' ') continue;
      const e = leg[c];
      if (!e) { F('K-RASTER', `Ankerzeichen "${c}" ohne Eintrag in anker_legende`, x, y); continue; }
      anker.push(Object.assign({ x, y, ch: c }, e));
    } });
    // Ankerregeln (INHALT §1.5): nie auf fester Kachel, nie in Türkacheln (außer tor/eingang), Objekte nie in der Kantenmitte
    for (const a of anker) {
      const i = info(a.x, a.y);
      const tuer = K.istTuer(i);
      const darfTuer = a.rolle === 'tor' || a.rolle === 'eingang';
      if (tuer && !darfTuer) F('K-ANKER-WAND', `${a.rolle} auf Türkachel`, a.x, a.y);
      else if (!tuer && K.fest(i) && !(a.rolle === 'versteck' && i && i.kind === 'wand_schwach') && !(a.rolle === 'leit' && leitAufDeckung(i))) F('K-ANKER-WAND', `${a.rolle} auf fester Kachel "${rows[a.y][a.x]}"`, a.x, a.y);
      if (a.rolle === 'leit') {
        const bws = Array.isArray(modul.bauweise) ? modul.bauweise : Object.keys(D.bauweisen || {}).sort();
        for (const bw of bws) {
          const lf = leitModellFuss(D, bw, modul.typ, modul.art);
          if (!lf) continue;
          if (!lf.fuss) { Wn('K-LEIT-FUSS', `${bw}: Grundfläche für ${lf.modell} fehlt in leit_fuss`, a.x, a.y); continue; }
          const g = leitFuss(a.x, a.y, lf.fuss[0], lf.fuss[1]);
          const e = fussFehler(rows, [g.x0, g.y0, lf.fuss[0], lf.fuss[1]]);
          if (e) F('K-LEIT-FUSS', `${bw} ${lf.modell}: ${e}`, a.x, a.y);
        }
      }
      if (objektRolle(D, a.rolle) && !schiff) {
        const mx = a.x % 8, my = a.y % 8;   // nur Außenkanten des Moduls (innere Zellgrenzen sind keine Anschlüsse)
        const mitte = ((a.y === 0 || a.y === H - 1) && (mx === 3 || mx === 4)) || ((a.x === 0 || a.x === W - 1) && (my === 3 || my === 4));
        if (mitte) F('K-ANKER-WAND', `${a.rolle} (Objekt) in der Kantenmitte`, a.x, a.y);
      }
      if (blockendesObjekt(D, a.rolle) && ![[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => begeh(a.x + dx, a.y + dy) || K.istTuer(info(a.x + dx, a.y + dy)))) {
        F('K-ANKER-WAND', `${a.rolle} ohne begehbaren Nachbarn`, a.x, a.y);
      }
      if (a.rolle === 'abholpunkt' && !lPad(begeh, a.x, a.y)) F('K-ABHOLPUNKT', 'Pad-Fläche: 3 freie Kacheln in L-Form fehlen', a.x, a.y);
      if (a.rolle === 'aussicht' && rows[a.y][a.x] !== '^') Wn('K-PLATEAU', 'aussicht steht nicht auf ^', a.x, a.y);
      if (a.rolle === 'versteck' && ![[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => { const q = info(a.x + dx, a.y + dy); return q && q.kind === 'wand_schwach'; })) {
        F('K-ANKER-WAND', 'versteck ohne schwache Wand (w) daneben', a.x, a.y);
      }
    }
    // Objektanker, die zur Laufzeit fest werden, dürfen das Modul nicht in getrennte Teile zerschneiden
    if (!fehler.length) {
      // zelle trennt absichtlich (Gefangenenraum, öffnet über den Anker) und zählt hier nicht
      const trennt = (a) => blockendesObjekt(D, a.rolle) && a.rolle !== 'zelle';
      const obj = new Set(anker.filter(trennt).map((a) => a.y * W + a.x));
      const pass = (x, y) => { const i = info(x, y); return !!i && (!K.fest(i) || K.istTuer(i)); };
      const teile = (ohne) => {
        const seen = new Uint8Array(W * H); let n = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const k0 = y * W + x;
          if (seen[k0] || !pass(x, y) || obj.has(k0)) continue;
          n++;
          const d = K.bfs(W, H, (qx, qy) => pass(qx, qy) && !(ohne && obj.has(qy * W + qx)), [[x, y]]);
          for (let i = 0; i < d.length; i++) if (d[i] >= 0 && !obj.has(i)) seen[i] = 1;
        }
        return n;
      };
      const vorher = teile(false), nachher = teile(true);
      if (nachher > vorher) {
        const schuld = anker.filter(trennt).find((a) => { const keep = obj.has(a.y * W + a.x); obj.delete(a.y * W + a.x); const t = teile(true); obj.add(a.y * W + a.x); return keep && t < nachher; });
        F('K-ERREICHBAR', `Objektanker trennen das Modul (${vorher} → ${nachher} Teile)${schuld ? ': ' + schuld.rolle : ''}`, schuld && schuld.x, schuld && schuld.y);
      }
    }
    if (anker.filter((a) => a.rolle === 'leit').length > 1) F('K-LEIT-FUSS', 'höchstens ein leit-Anker je Modul');
    // Paare im Modul: je Buchstabe genau 2
    const paare = {};
    for (const a of anker) if (a.rolle === 'raetsel' && a.paar) paare[a.paar] = (paare[a.paar] || 0) + 1;
    for (const p of Object.keys(paare).sort()) if (paare[p] !== 2) F('K-PAAR', `Rätselpaar ${p}: ${paare[p]} Anker im Modul (genau 2)`);
    // Plateau
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (rows[y][x] !== '^') continue;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (!['^', 'k', '/'].includes(rows[ny][nx])) { F('K-PLATEAU', `^ grenzt an "${rows[ny][nx]}"`, x, y); break; }
      }
    }
    // Belegungen: nur o/O/I auf Bodenkacheln
    (modul.belegungen || []).forEach((b, bi) => {
      if (!Array.isArray(b) || b.length !== H || b.some((r) => typeof r !== 'string' || r.length !== W)) { F('K-RASTER', `belegungen[${bi}] hat nicht die Größe von rows`); return; }
      b.forEach((r, y) => { for (let x = 0; x < r.length; x++) {
        const c = r[x]; if (c === '.' || c === ' ') continue;
        if (!BELEG_ZEICHEN[c]) F('K-RASTER', `belegungen[${bi}]: "${c}" (nur o/O/I)`, x, y);
        else if (!BOEDEN[rows[y][x]]) Wn('K-RASTER', `belegungen[${bi}]: "${c}" nicht auf Boden (wird übersprungen)`, x, y);
        else if (ank[y] && ank[y][x] !== '.') Wn('K-RASTER', `belegungen[${bi}]: "${c}" auf Anker (wird übersprungen)`, x, y);
      } });
    });
    if ((modul.belegungen || []).length > 3) Wn('K-RASTER', `${modul.belegungen.length} Belegungen (Vertrag: 0–3)`);
    if (modul.bauweise != null && !Array.isArray(modul.bauweise)) F('K-RASTER', 'bauweise: null oder Liste');
    const lagen = fehler.length ? [] : lagenVon(D, cfgVon(opts), modul, false);
    return { ok: !fehler.length, fehler, warnungen, lagen, anker };
  }

  // ---------------- Schablone vorbereiten ----------------
  function platzListe(sch, spiegel, cfgDecks) {
    const out = [];
    if (sch.decks) {
      const nDecks = Math.min(sch.decks.length, cfgDecks || 2);
      for (let d = 0; d < nDecks; d++) {
        let x = 0;
        for (const p of sch.decks[d].plaetze || []) {
          out.push(Object.assign({}, p, { deck: d + 1, tx: x, ty: d * SCHIFF_STRIDE, tw: p.breite, th: 13, schiff: true }));
          x += p.breite;
        }
      }
      return out;
    }
    const [CW, CH] = sch.zellen;
    for (const p0 of sch.plaetze || []) {
      const p = Object.assign({ w: 1, h: 1 }, p0);
      let x = p.x, y = p.y, r = p.richtung || null;
      if (spiegel && spiegel.includes('x')) { x = CW - p.x - p.w; if (r === 'O') r = 'W'; else if (r === 'W') r = 'O'; }
      if (spiegel && spiegel.includes('y')) { y = CH - p.y - p.h; if (r === 'N') r = 'S'; else if (r === 'S') r = 'N'; }
      out.push(Object.assign(p, { x, y, richtung: r, tx: x * 8, ty: y * 8, tw: p.w * 8, th: p.h * 8 }));
    }
    // Füllplätze aus fuellung, wenn sie ein Modultyp ist
    return out;
  }
  function fuellZeichen(D, fuellung) {
    if (!fuellung) return 'F';
    if (fuellung.length === 1 && zeichenInfo(D, fuellung)) return fuellung;
    const z = D.kacheln.zeichen;
    for (const c of Object.keys(z).sort()) if (z[c].kind === fuellung) return c;
    return null;
  }

  // ---------------- Zusammenbau (§5.3) ----------------
  // Module mit Prüffehlern (pruefeModul) werden nie verbaut (Abnahme F9): einmal je Datenstand geprüft (D._pruef).
  function modulFehler(D, m) {
    if (!D._pruef) D._pruef = {};
    if (!Object.prototype.hasOwnProperty.call(D._pruef, m.id)) {
      let f;
      try { f = pruefeModul(m, { daten: D }).fehler; } catch (e) { f = [{ code: 'K-RASTER', msg: 'Prüfung abgebrochen: ' + (e && e.message || e) }]; }
      D._pruef[m.id] = f;
    }
    return D._pruef[m.id];
  }
  // fehlerhafteModule(art?, D?) -> [{ id, fehler: [{ code, msg }] }] – Module (einer Kartenart), die der Zusammenbau auslässt
  function fehlerhafteModule(art, D) {
    D = D ? normalisiere(D) : daten();
    return Object.keys(D.module).sort().map((id) => D.module[id]).filter((m) => !art || m.art === art || String(m.id).split('.')[0] === art)
      .map((m) => ({ id: m.id, fehler: modulFehler(D, m) })).filter((e) => e.fehler.length);
  }
  function kandidaten(D, cfg, p, bauweise, R) {
    const mods = Object.keys(D.module).sort().map((k) => D.module[k]).filter((m) => {
      if (m._ladefehler || m.typ !== p.typ) return false;
      if (modulFehler(D, m).length) return false;
      if (m.bauweise && !(Array.isArray(m.bauweise) && m.bauweise.includes(bauweise))) return false;
      if (p.schiff) return istSchiffModul(m) && m.groesse && m.groesse[0] === p.breite && (m.deck == null || m.deck === p.deck);
      return !istSchiffModul(m);
    });
    // gewichtet gemischt (ohne Zurücklegen), dann je Modul die Lagen gemischt
    const pool = mods.map((m) => ({ m, g: Math.max(1, m.gewicht | 0 || 1) }));
    const order = [];
    while (pool.length) {
      const sum = pool.reduce((s, e) => s + e.g, 0);
      let r = R.int(sum), i = 0;
      while (r >= pool[i].g) { r -= pool[i].g; i++; }
      order.push(pool.splice(i, 1)[0].m);
    }
    const out = [];
    for (const m of order) {
      let lagen = lagenVon(D, cfg, m, true).filter((l) => l.w === p.tw && l.h === p.th);
      if (p.richtung) lagen = lagen.filter((l) => l.aussen === p.richtung);
      if (p.schiff && p.fest) lagen = lagen.filter((l) => !l.spiegel);
      const idx = lagen.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = R.int(i + 1); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (const i of idx) out.push({ m, l: lagen[i] });
    }
    return out;
  }

  function versuch(D, cfg, sch, seed, opts) {
    const fehler = [];
    const R = rng(seedVon(sch.id, seed));
    // 1. Spiegelung
    let spiegel = '';
    for (const ax of (sch.spiegeln || []).filter((a) => !sch.decks || a === 'y')) if (R.int(2)) spiegel += ax;
    const decksN = sch.decks ? Math.min(sch.decks.length, opts.schiffDecks || cfg.schiffDecks || 2) : 0;
    const plaetze = platzListe(sch, spiegel, decksN);
    const byId = {}; for (const p of plaetze) byId[p.id] = p;
    const fill = sch.decks ? '_' : fuellZeichen(D, sch.fuellung);
    if (!sch.decks && fill == null) {
      // fuellung ist ein Modultyp: freie Zellen werden Füllplätze
      const [CW, CH] = sch.zellen; const belegt = new Set();
      for (const p of plaetze) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) belegt.add(x + ',' + y);
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (!belegt.has(x + ',' + y)) {
        const p = { id: `fuell_${x}_${y}`, typ: sch.fuellung, x, y, w: 1, h: 1, tx: x * 8, ty: y * 8, tw: 8, th: 8, auto: true };
        plaetze.push(p); byId[p.id] = p;
      }
    }
    const fillCh = fill == null ? 'F' : fill;
    const fillTyp = segmentTyp(D, Array(8).fill(fillCh), cfg.freiMin);
    // Zellraster -> Platz
    let zelle = null;
    if (!sch.decks) {
      const [CW, CH] = sch.zellen;
      zelle = new Array(CW * CH).fill(null);
      for (const p of plaetze) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
        if (x < 0 || y < 0 || x >= CW || y >= CH) { fehler.push({ code: 'K-RASTER', msg: `Platz ${p.id} liegt außerhalb der Schablone` }); continue; }
        if (zelle[y * CW + x]) fehler.push({ code: 'K-RASTER', msg: `Plätze ${zelle[y * CW + x].id} und ${p.id} überlappen` });
        zelle[y * CW + x] = p;
      }
    }
    if (fehler.length) return { fehler };
    const festPaare = (sch.kanten_fest || []).filter((k) => byId[k.a] && byId[k.b]);
    const festIds = new Set(); for (const k of festPaare) { festIds.add(k.a); festIds.add(k.b); }
    // 2. Reihenfolge: 2×2 -> feste Kanten -> richtung -> Rest
    const gruppe = (p) => (p.schiff ? (p.fest ? 0 : 1) : (p.w * p.h >= 4 ? 0 : festIds.has(p.id) ? 1 : p.richtung ? 2 : 3));
    const reihe = plaetze.slice().sort((a, b) => gruppe(a) - gruppe(b) || a.ty - b.ty || a.tx - b.tx || (a.id < b.id ? -1 : 1));
    const gesetzt = {};   // platzId -> { m, l }
    const bw = opts.bauweise;

    // Kante eines Platzes zu einem Nachbarn; prüft gegen gesetzte Nachbarn, Rand, Füllung und kanten_fest
    function passt(p, c) {
      if (p.schiff) {
        const nachbarn = plaetze.filter((q) => q.deck === p.deck);
        const i = nachbarn.indexOf(p);
        const links = nachbarn[i - 1], rechts = nachbarn[i + 1];
        for (const [seite, q] of [['W', links], ['O', rechts]]) {
          const mine = c.l.kanten[seite];
          if (!q) { if (mine.some((t) => !RAND_OK[t])) return false; continue; }
          const g = gesetzt[q.id]; if (!g) continue;
          const theirs = g.l.kanten[GEGEN[seite]];
          for (let k = 0; k < 3; k++) if (!vertraeglich(mine[k], theirs[k])) return false;
          if (mine[1] === 'wand' || theirs[1] === 'wand') return false;   // Längsgang Zeile 6 ist Pflicht
        }
        return true;
      }
      const [CW, CH] = sch.zellen;
      for (const seite of SEITEN) {
        const n = (seite === 'N' || seite === 'S') ? p.w : p.h;
        for (let i = 0; i < n; i++) {
          const cx = seite === 'N' || seite === 'S' ? p.x + i : (seite === 'W' ? p.x - 1 : p.x + p.w);
          const cy = seite === 'W' || seite === 'O' ? p.y + i : (seite === 'N' ? p.y - 1 : p.y + p.h);
          const mine = c.l.kanten[seite][i];
          if (cx < 0 || cy < 0 || cx >= CW || cy >= CH) {
            if (!RAND_OK[mine] && !(mine === 'tuer' && randTuerErlaubt(c, seite, i))) return false;
            continue;
          }
          const q = zelle[cy * CW + cx];
          if (!q) { if (!vertraeglich(mine, fillTyp)) return false; continue; }
          const g = gesetzt[q.id]; if (!g) continue;
          const j = (seite === 'N' || seite === 'S') ? cx - q.x : cy - q.y;
          const theirs = g.l.kanten[GEGEN[seite]][j];
          if (!vertraeglich(mine, theirs)) return false;
        }
      }
      // feste Kanten mit bereits gesetzten Partnern
      for (const kf of festPaare) {
        if (kf.a !== p.id && kf.b !== p.id) continue;
        const q = byId[kf.a === p.id ? kf.b : kf.a];
        const g = gesetzt[q.id]; if (!g) continue;
        const paare = gemeinsameKanten(p, c.l, q, g.l);
        if (!paare.some(([x, y]) => x === kf.typ || y === kf.typ)) return false;
      }
      return true;
    }
    function randTuerErlaubt(c, seite, i) {
      // Tür am Kartenrand nur, wenn ein Eingang davor/daneben liegt (Schleuse, Hülle)
      const L = c.l; const leg = c.m.anker_legende || {};
      const mx = seite === 'W' ? 0 : seite === 'O' ? L.w - 1 : i * 8 + 3;
      const my = seite === 'N' ? 0 : seite === 'S' ? L.h - 1 : i * 8 + 3;
      for (let y = Math.max(0, my - 3); y < Math.min(L.h, my + 5); y++) for (let x = Math.max(0, mx - 3); x < Math.min(L.w, mx + 5); x++) {
        const e = leg[L.anker[y][x]]; if (e && e.rolle === 'eingang') return true;
      }
      return false;
    }
    function gemeinsameKanten(p, lp, q, lq) {
      const out = [];
      for (const seite of SEITEN) {
        const n = (seite === 'N' || seite === 'S') ? p.w : p.h;
        for (let i = 0; i < n; i++) {
          const cx = seite === 'N' || seite === 'S' ? p.x + i : (seite === 'W' ? p.x - 1 : p.x + p.w);
          const cy = seite === 'W' || seite === 'O' ? p.y + i : (seite === 'N' ? p.y - 1 : p.y + p.h);
          if (cx < q.x || cy < q.y || cx >= q.x + q.w || cy >= q.y + q.h) continue;
          const j = (seite === 'N' || seite === 'S') ? cx - q.x : cy - q.y;
          out.push([lp.kanten[seite][i], lq.kanten[GEGEN[seite]][j]]);
        }
      }
      return out;
    }

    // 3. Belegen mit begrenztem Backtracking
    const cands = new Array(reihe.length), ptr = new Array(reihe.length).fill(0);
    let idx = 0, schritte = 0;
    const leer = {};
    while (idx < reihe.length) {
      const p = reihe[idx];
      if (!cands[idx]) {
        cands[idx] = kandidaten(D, cfg, p, bw, R); ptr[idx] = 0;
        if (!cands[idx].length) {
          return { fehler: [{ code: 'K-MODUL', msg: `kein Modul für Platz ${p.id} (typ ${p.typ}, ${p.schiff ? 'breite ' + p.breite + ', deck ' + p.deck : p.w + '×' + p.h}${p.richtung ? ', richtung ' + p.richtung : ''}, bauweise ${bw})` }] };
        }
      }
      let ok = false;
      while (ptr[idx] < cands[idx].length) {
        const c = cands[idx][ptr[idx]++];
        if (passt(p, c)) { gesetzt[p.id] = c; ok = true; break; }
      }
      if (ok) { idx++; continue; }
      leer[p.id] = (leer[p.id] || 0) + 1;
      cands[idx] = null; idx--; schritte++;
      if (idx < 0 || schritte > cfg.backtrack) {
        const schlimm = Object.keys(leer).sort((a, b) => leer[b] - leer[a] || (a < b ? -1 : 1))[0];
        return { fehler: [{ code: 'K-KANTE', msg: `Zusammenbau gescheitert (${schritte} Rückschritte), keine passende Lage für ${schlimm}` }] };
      }
      delete gesetzt[reihe[idx].id];
    }

    // 4. Kompilieren: Zeilen
    let W, H;
    if (sch.decks) { W = plaetze.filter((p) => p.deck === 1).reduce((s, p) => s + p.breite, 0); H = decksN >= 2 ? SCHIFF_STRIDE + 13 : 13; }
    else { W = sch.zellen[0] * 8; H = sch.zellen[1] * 8; }
    const grid = []; for (let y = 0; y < H; y++) grid.push(new Array(W).fill(fillCh));
    const ankerGrid = new Map();
    const RB = rng(seedVon(sch.id + ':belegung', seed));
    const roh = [];
    const istRand = (p, lx, ly) => (p.schiff ? (ly === 6 || ly === 2 || ly === 10 || lx === 0 || lx === p.tw - 1) : (lx % 8 === 0 || lx % 8 === 7 || ly % 8 === 0 || ly % 8 === 7));
    for (const p of plaetze) {
      const c = gesetzt[p.id]; const L = c.l;
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) grid[p.ty + y][p.tx + x] = L.rows[y][x];
      // Anker
      const leg = c.m.anker_legende || {};
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const ch = L.anker[y][x]; if (ch === '.' || ch === ' ') continue;
        const e = leg[ch]; if (!e) continue;
        const a = Object.assign({}, e, { x: p.tx + x, y: p.ty + y, platz: p.id, bereich: p.bereich || null });
        if (e.rolle === 'leit') {
          const lf = leitModellFuss(D, bw, p.typ, sch.art);
          if (lf && lf.fuss) {
            // Anker in Grundlage N zurückrechnen, Rechteck dort bilden, Ecken in die Lage übertragen
            const W0 = c.m.rows[0].length, H0 = c.m.rows.length;
            let ax0 = -1, ay0 = -1;
            for (let yy = 0; yy < H0 && ax0 < 0; yy++) for (let xx = 0; xx < W0; xx++) {
              const q = lagePunkt(xx, yy, W0, H0, L.rot, L.spiegel);
              if (q[0] === x && q[1] === y) { ax0 = xx; ay0 = yy; break; }
            }
            if (ax0 >= 0) {
              const g = leitFuss(ax0, ay0, lf.fuss[0], lf.fuss[1]);
              const p1 = lagePunkt(g.x0, g.y0, W0, H0, L.rot, L.spiegel), p2 = lagePunkt(g.x1, g.y1, W0, H0, L.rot, L.spiegel);
              a.fuss = [p.tx + Math.min(p1[0], p2[0]), p.ty + Math.min(p1[1], p2[1]), Math.abs(p2[0] - p1[0]) + 1, Math.abs(p2[1] - p1[1]) + 1];
              a.modell = lf.modell;
            }
          }
        }
        roh.push(a); ankerGrid.set((p.ty + y) * W + p.tx + x, a);
      }
      // 5. Belegung (Seed wählt eine; nie auf Ankern, nie auf Zellrändern)
      if (L.belegungen.length) {
        const b = L.belegungen[RB.int(L.belegungen.length)];
        for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
          const ch = b[y][x];
          if (!BELEG_ZEICHEN[ch] || !BOEDEN[L.rows[y][x]] || L.anker[y][x] !== '.' || istRand(p, x, y)) continue;
          grid[p.ty + y][p.tx + x] = ch;
        }
        c.belegung = L.belegungen.indexOf(b);
      }
    }
    if (sch.decks && decksN >= 2) for (let y = 13; y < SCHIFF_STRIDE; y++) grid[y] = new Array(W).fill('_');
    // Schiff: Spiegeln y = Backbord/Steuerbord des ganzen Schiffs (beide Decks gemeinsam, Lift/Leiter bleiben übereinander)
    if (sch.decks && spiegel.includes('y')) {
      for (let d = 0; d < decksN; d++) {
        const b = d * SCHIFF_STRIDE; const block = grid.slice(b, b + 13).reverse();
        for (let i = 0; i < 13; i++) grid[b + i] = block[i];
      }
      for (const a of roh) {
        const b = a.y >= SCHIFF_STRIDE ? SCHIFF_STRIDE : 0;
        a.y = b + 12 - (a.y - b);
        // Leitstück-Fuß mitspiegeln: neue Oberkante = gespiegelte Unterkante (Rechteck bleibt im selben Deck)
        if (Array.isArray(a.fuss)) a.fuss[1] = b + 12 - (a.fuss[1] + a.fuss[3] - 1 - b);
      }
    }

    // Anker kompilieren: IDs, Attribute, Paare, Ankunft, Decks
    const eingangArt = {}; for (const p of plaetze) if (p.eingang_art) eingangArt[p.id] = p.eingang_art;
    const paarVon = {}; for (const L of Object.keys(sch.paare || {}).sort()) for (const pid of sch.paare[L]) paarVon[pid] = L;
    const ankunftPlatz = plaetze.filter((p) => p.ankunft).map((p) => p.id);
    if (ankunftPlatz.length !== 1) return { fehler: [{ code: 'K-ABHOLPUNKT', msg: `Schablone ${sch.id}: ${ankunftPlatz.length} Plätze mit ankunft (genau 1)` }] };
    roh.sort((a, b) => (a.platz < b.platz ? -1 : a.platz > b.platz ? 1 : 0) || (a.rolle < b.rolle ? -1 : a.rolle > b.rolle ? 1 : 0) || a.y - b.y || a.x - b.x);
    const zaehl = {}; for (const a of roh) { const k = a.platz + '.' + a.rolle; zaehl[k] = (zaehl[k] || 0) + 1; }
    const lauf = {};
    const anker = [];
    for (const a of roh) {
      const k = a.platz + '.' + a.rolle;
      lauf[k] = (lauf[k] || 0) + 1;
      const o = { id: zaehl[k] > 1 ? k + '.' + lauf[k] : k, rolle: a.rolle, x: a.x, y: a.y, platz: a.platz, bereich: a.bereich };
      for (const f of Object.keys(a).sort()) {
        if (['rolle', 'x', 'y', 'platz', 'bereich', 'hinweis'].includes(f)) continue;
        o[f] = a[f];
      }
      if (o.rolle === 'eingang' && eingangArt[o.platz]) o.art = eingangArt[o.platz];
      if (o.rolle === 'raetsel') o.paar = paarVon[o.platz] ? paarVon[o.platz] : (o.paar ? o.platz + '.' + o.paar : undefined);
      if (o.paar === undefined) delete o.paar;
      if (o.rolle === 'abholpunkt') delete o.ankunft;   // Studioleitung: ankunft kommt nur vom Platz
      if (sch.decks) o.deck = o.y >= SCHIFF_STRIDE ? 2 : 1;
      else if (o.rolle !== 'lift' && o.rolle !== 'leiter') delete o.deck;
      anker.push(o);
    }
    for (const pid of ankunftPlatz) {
      const a = anker.find((q) => q.platz === pid && q.rolle === 'abholpunkt');
      if (a) { a.ankunft = true; break; }
    }
    const rows = grid.map((r) => r.join(''));

    // Bereiche
    const bereiche = {};
    const BER = sch.bereiche || {};
    const gefechtSet = new Set(sch.gefecht || []);
    for (const p of plaetze) if (p.bereich === 'gefecht') gefechtSet.add(p.id);
    for (const p of plaetze.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const rect = [p.tx, p.ty, p.tw, p.th];
      if (p.bereich) {
        const b = bereiche[p.bereich] || (bereiche[p.bereich] = { name: (BER[p.bereich] && BER[p.bereich].name) || p.bereich, rects: [],
          rolle: (BER[p.bereich] && 'rolle' in BER[p.bereich]) ? BER[p.bereich].rolle : (['hinein', 'ziel', 'rueckzug'].includes(p.bereich) ? p.bereich : null),
          gefecht: p.bereich === 'gefecht' });
        b.rects.push(rect);
      }
      if (gefechtSet.has(p.id)) {
        const g = bereiche.gefecht || (bereiche.gefecht = { name: (BER.gefecht && BER.gefecht.name) || 'Gefecht', rects: [], rolle: null, gefecht: true });
        if (p.bereich !== 'gefecht') g.rects.push(rect);
      }
    }
    const plaetzeOut = {};
    for (const p of plaetze.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const c = gesetzt[p.id];
      const e = { typ: p.typ, modul: c.m.id, lage: { rot: c.l.rot, spiegel: c.l.spiegel, aussen: c.l.aussen }, rect: [p.tx, p.ty, p.tw, p.th] };
      if (p.richtung) e.richtung = p.richtung;
      if (p.bereich) e.bereich = p.bereich;
      if (gefechtSet.has(p.id)) e.gefecht = true;
      if (p.kern) e.kern = true;
      if (p.deck) e.deck = p.deck;
      if (c.belegung != null && c.belegung >= 0) e.belegung = c.belegung;
      plaetzeOut[p.id] = e;
    }
    const legende = {};   // ganze Kit-Legende (klein, und Überzug/Werkstatt brauchen auch ungenutzte Zeichen)
    for (const ch of Object.keys(D.kacheln.zeichen).sort()) legende[ch] = D.kacheln.zeichen[ch];
    const karte = {
      id: opts.id || null, erzeuger: 'modul/1', art: sch.art, bauweise: bw, besitz: opts.besitz || null, zustand: opts.zustand || 'intakt',
      seed, bauversion: bauversion(sch.art, D), schablone: sch.id, spiegel: spiegel || null,
      w: W, h: H, rows, legende, anker,
      bereiche, plaetze: plaetzeOut,
      eingaenge: anker.filter((a) => a.rolle === 'eingang').map((a) => a.id),
      abholpunkte: anker.filter((a) => a.rolle === 'abholpunkt').map((a) => a.id),
      ankunft: (anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft) || {}).id || null,
      patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
      meta: { versuche: 1, kennzahlen: null, linear: !!sch.linear, pflicht: pflichtVon(sch, decksN), zellen: sch.decks ? null : sch.zellen.slice(), schiffDecks: sch.decks ? decksN : null },
    };
    // Decks (Schiff): Lift/Leiter übereinander
    if (sch.decks && decksN >= 2) {
      const links = [];
      for (const a of anker.filter((q) => (q.rolle === 'lift' || q.rolle === 'leiter') && q.deck === 1)) {
        const b = anker.find((q) => q.rolle === a.rolle && q.deck === 2 && q.x === a.x && q.y === a.y + SCHIFF_STRIDE);
        if (b) links.push({ a: [a.x, a.y], b: [b.x, b.y], via: a.rolle });
      }
      karte.decks = { stride: SCHIFF_STRIDE, links };
    }
    kompiliereKanten(D, karte);
    torKantenStart(D, karte);
    return { karte, gesetzt };
  }

  function pflichtVon(sch, decksN) {
    const p = Object.assign({}, sch.pflicht || {});
    if (sch.decks && decksN < 2) {
      if (sch.pflicht_deck1) return Object.assign({}, sch.pflicht_deck1);
      const out = {};
      for (const k of ['eingang', 'abholpunkt', 'ziel', 'sprengpunkt', 'zelle']) if (p[k]) out[k] = 1;
      return out;
    }
    return p;
  }

  // Innere Türanschlüsse (für Zustände): Paare benachbarter Plätze mit Türkacheln an der gemeinsamen Grenze
  function kompiliereKanten(D, karte) {
    const ids = Object.keys(karte.plaetze).sort();
    const own = new Int32Array(karte.w * karte.h).fill(-1);
    ids.forEach((id, i) => { const q = karte.plaetze[id].rect; for (let y = q[1]; y < q[1] + q[3]; y++) for (let x = q[0]; x < q[0] + q[2]; x++) own[y * karte.w + x] = i; });
    const tuerAt = (x, y) => x >= 0 && y >= 0 && x < karte.w && y < karte.h && K.istTuer(zeichenInfo(D, karte.rows[y][x]));
    const paare = new Map();
    for (let y = 0; y < karte.h; y++) for (let x = 0; x < karte.w; x++) {
      const a = own[y * karte.w + x]; if (a < 0) continue;
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (nx >= karte.w || ny >= karte.h) continue;
        const b = own[ny * karte.w + nx]; if (b < 0 || b === a) continue;
        if (!tuerAt(x, y) && !tuerAt(nx, ny)) continue;
        const k = Math.min(a, b) + ':' + Math.max(a, b);
        const set = paare.get(k) || paare.set(k, new Set()).get(k);
        for (const [tx, ty] of [[x, y], [nx, ny]]) if (tuerAt(tx, ty)) for (const t of K.tuerKacheln(karte, tx, ty)) set.add(t[1] * karte.w + t[0]);
      }
    }
    const keys = Array.from(paare.keys()).sort((p, q) => { const [a1, b1] = p.split(':').map(Number), [a2, b2] = q.split(':').map(Number); return a1 - a2 || b1 - b2; });
    for (const k of keys) {
      const [a, b] = k.split(':').map(Number);
      const tiles = Array.from(paare.get(k)).sort((p, q) => p - q).map((i) => [i % karte.w, Math.floor(i / karte.w)]);
      const ch = karte.rows[tiles[0][1]][tiles[0][0]];
      const info = zeichenInfo(D, ch);
      let id = ids[a] + '~' + ids[b]; let n = 2;
      while (karte.kanten[id]) id = ids[a] + '~' + ids[b] + '.' + (n++);
      karte.kanten[id] = { a: ids[a], b: ids[b], typ: info.kind, tiles, zustand: (info.zustaende || [])[0] || null };
    }
    // Übrige Türgruppen (im Modul, an Eingängen/Toren): eigener Schlüssel <platz>.tuer[.n], damit jede Zustandstür einen
    // Laufzeitzustand hat (aw.zustaende, Snapshot ko). a = b = Platz.
    const belegt = new Set();
    for (const k of Object.keys(karte.kanten)) for (const t of karte.kanten[k].tiles) belegt.add(t[1] * karte.w + t[0]);
    const gruppen = {};
    for (let y = 0; y < karte.h; y++) for (let x = 0; x < karte.w; x++) {
      if (belegt.has(y * karte.w + x) || !(tuerAt(x, y) || (zeichenInfo(D, karte.rows[y][x]) || {}).kind === 'wand_schwach')) continue;
      const g = K.tuerKacheln(karte, x, y);
      for (const t of g) belegt.add(t[1] * karte.w + t[0]);
      const pi = own[y * karte.w + x];
      const pid = pi >= 0 ? ids[pi] : 'karte';
      (gruppen[pid] = gruppen[pid] || []).push(g);
    }
    for (const pid of Object.keys(gruppen).sort()) {
      const list = gruppen[pid];
      list.forEach((tiles, i) => {
        const info = zeichenInfo(D, karte.rows[tiles[0][1]][tiles[0][0]]);
        karte.kanten[list.length > 1 ? `${pid}.tuer.${i + 1}` : `${pid}.tuer`] = { a: pid, b: pid, typ: info.kind, tiles, zustand: (info.zustaende || [])[0] || null };
      });
    }
  }

  // Türen eines tor-Ankers starten 'zu' (sonst stünde eine D-Tür mit Startzustand 'offen' – Kassentür – von Beginn an
  // offen). Markiert die Kanten mit tor: <ankerId>; der Überzug lässt sie in Ruhe.
  function torKantenStart(D, karte) {
    for (const a of karte.anker) {
      if (a.rolle !== 'tor') continue;
      const set = new Set(K.tuerKacheln(karte, a.x, a.y).map((t) => t[0] + ',' + t[1]));
      for (const kid of Object.keys(karte.kanten).sort()) {
        const kk = karte.kanten[kid];
        if (!kk.tiles.some((t) => set.has(t[0] + ',' + t[1]))) continue;
        const info = Object.values(D.kacheln.zeichen).find((i) => i.kind === kk.typ) || {};
        if ((info.zustaende || []).includes('zu')) kk.zustand = 'zu';
        kk.tor = a.id;
      }
    }
  }

  // Patrouillen (W4): Ketten gleicher Buchstaben in benachbarten, verbundenen Plätzen werden zu Wegen verbunden
  function kompilierePatrouillen(karte) {
    const pat = karte.anker.filter((a) => a.rolle === 'patrouille');
    if (!pat.length) return [];
    const r = K.raster(karte);
    const g = K.platzGraph(karte, r);
    const pidx = {}; g.ids.forEach((id, i) => { pidx[id] = i; });
    const gruppen = {};
    for (const a of pat) { const k = a.platz + '|' + (a.kette || 'a'); (gruppen[k] = gruppen[k] || []).push(a); }
    const keys = Object.keys(gruppen).sort();
    const parent = {}; keys.forEach((k) => { parent[k] = k; });
    const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const [pa, ka] = keys[i].split('|'), [pb, kb] = keys[j].split('|');
      if (ka !== kb) continue;
      if (g.adj[pidx[pa]] && g.adj[pidx[pa]].includes(pidx[pb])) parent[find(keys[i])] = find(keys[j]);
    }
    const comp = {};
    for (const k of keys) (comp[find(k)] = comp[find(k)] || []).push(...gruppen[k]);
    const out = [];
    for (const root of Object.keys(comp).sort()) {
      const rest = comp[root].slice().sort((a, b) => a.x - b.x || a.y - b.y);
      const weg = [rest.shift()];
      while (rest.length) {
        const l = weg[weg.length - 1]; let bi = 0, bd = Infinity;
        rest.forEach((a, i) => { const d = Math.abs(a.x - l.x) + Math.abs(a.y - l.y); if (d < bd) { bd = d; bi = i; } });
        weg.push(rest.splice(bi, 1)[0]);
      }
      out.push(weg.map((a) => a.id));
    }
    return out;
  }

  // Deckungsplätze (verallgemeinerte keshCoverSpots): begehbare Kacheln mit Deckung in der 8er-Nachbarschaft, ohne Pads/Rand
  function kompiliereCover(karte) {
    const r = K.raster(karte);
    const pad = new Set();
    for (const a of karte.anker) if (a.rolle === 'abholpunkt') for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) pad.add((a.y + dy) * karte.w + a.x + dx);
    const out = [];
    for (let y = 1; y < karte.h - 1; y++) for (let x = 1; x < karte.w - 1; x++) {
      if (!r.begehbar(x, y) || r.tuer(x, y) || pad.has(y * karte.w + x)) continue;
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) best = Math.max(best, r.cover(x + dx, y + dy));
      if (best) out.push({ x, y, cover: best });
    }
    return out;
  }

  // ---------------- Zustand-Überzug (§5.4, content/buehnen/zustaende.json) ----------------
  function ueberzug(D, karte, stufe, variante) {
    variante = variante | 0;
    const def = D.zustaende && D.zustaende.zustaende && D.zustaende.zustaende[karte.zustand];
    if (!def || stufe === 'kein') return;
    const R = rng(seedVon(karte.schablone + ':zustand:' + karte.zustand, karte.seed));
    const rows = karte.rows.map((r) => r.split(''));
    const W = karte.w, H = karte.h;
    const ankerNah = new Set();
    for (const a of karte.anker) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ankerNah.add((a.y + dy) * W + a.x + dx);
    const tuerFeld = new Uint8Array(W * H);   // Kacheln neben Türen (einmal berechnet)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (K.istTuer(zeichenInfo(D, rows[y][x]))) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) tuerFeld[ny * W + nx] = 1; }
    }
    const tuerNah = (x, y) => tuerFeld[y * W + x] === 1;
    // lokaler Zusammenhang: die begehbaren Nachbarn im 8er-Ring bilden höchstens einen Lauf (sonst wäre die Kachel eine
    // Engstelle); Rampen/Plateaus und Türen in der Nähe bleiben frei
    const geh = (x, y) => { const c = rows[y] && rows[y][x]; const i = c && zeichenInfo(D, c); return !!i && (!K.fest(i) || K.istTuer(i)); };
    const RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
    function lokalFrei(x, y) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = rows[y + dy] && rows[y + dy][x + dx]; if (c === '/' || c === '^') return false; }
      const g = RING.map(([dx, dy]) => geh(x + dx, y + dy));
      // Ecken zählen nur, wenn ein orthogonaler Nachbar sie verbindet
      for (let i = 0; i < 8; i += 2) if (g[i] && !g[(i + 1) % 8] && !g[(i + 7) % 8]) g[i] = false;
      let laeufe = 0;
      for (let i = 0; i < 8; i++) if (g[i] && !g[(i + 7) % 8]) laeufe++;
      if (laeufe === 0 && g.every(Boolean)) laeufe = 1;
      return laeufe <= 1 && g.filter(Boolean).length >= 3;
    }
    const T = def.truemmer;
    if (T) {
      const wahl = Object.keys(karte.plaetze).sort().filter((id) => {
        const p = karte.plaetze[id];
        if (T.plaetze === 'gefecht') return !!p.gefecht;
        if (T.plaetze === 'fuell') return !p.kern;
        return true;
      });
      const [lo, hi] = T.je_zelle || [1, 3];
      for (const id of wahl) {
        const p = karte.plaetze[id]; const [px, py, pw, ph] = p.rect;
        const zellen = Math.max(1, Math.round((pw * ph) / 64));
        let n = 0; for (let i = 0; i < zellen; i++) n += lo + R.int(hi - lo + 1);
        if (stufe === 'halb') n = Math.ceil(n / 2);
        const kand = [];
        for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) {
          const lx = x - px, ly = y - py;
          const rand = karte.meta.zellen ? (lx % 8 === 0 || lx % 8 === 7 || ly % 8 === 0 || ly % 8 === 7) : (ly === 2 || ly === 6 || ly === 10 || lx === 0 || lx === pw - 1);
          if (rand || !BOEDEN[rows[y][x]] || ankerNah.has(y * W + x) || tuerNah(x, y)) continue;
          kand.push([x, y]);
        }
        // Obergrenze (Sichtung): höchstens max_anteil der Fläche des Platzes als neue Deckung. Trümmer in Gruppen
        // (T.gruppe [min, max] Kacheln) an Wänden/Ecken zuerst; je_zelle zählt dann Gruppen statt Kacheln.
        let flaeche = 0;
        for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) if (BOEDEN[rows[y][x]] || BELEG_ZEICHEN[rows[y][x]] || (zeichenInfo(D, rows[y][x]) || {}).kante === 'begehbar') flaeche++;   // Boden + Deckung, keine Wände
        const maxKacheln = T.max_anteil != null ? Math.floor(flaeche * T.max_anteil) : Infinity;
        const WANDKIND = { wand: 1, zaun: 1, fels: 1, pfeiler: 1, deckung_voll: 1, leere: 1 };
        const wandnah = (q) => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => { const c = rows[q[1] + dy] && rows[q[1] + dy][q[0] + dx]; const i = c && zeichenInfo(D, c); return !!i && !!WANDKIND[i.kind]; });
        const kset = new Set(kand.map((q) => q[1] * W + q[0]));
        const nah = T.wandnah ? kand.filter(wandnah) : [];
        const frei = T.wandnah ? kand.filter((q) => !wandnah(q)) : kand.slice();
        const [glo, ghi] = T.gruppe || [1, 1];
        let gesetzt = 0, gruppen = 0;
        const setze = (x, y) => {
          if (!kset.has(y * W + x) || !BOEDEN[rows[y][x]] || !lokalFrei(x, y)) return false;
          rows[y][x] = R.chance(T.schutt_anteil || 0) ? 'X' : 'x';
          kset.delete(y * W + x); gesetzt++; return true;
        };
        for (const pool of [nah, frei]) {
          while (gruppen < n && gesetzt < maxKacheln && pool.length) {
            const [x, y] = pool.splice(R.int(pool.length), 1)[0];
            if (!setze(x, y)) continue;
            gruppen++;
            // Gruppe wachsen lassen: Nachbarn entlang der Wand bevorzugt
            const ziel = Math.min(glo + R.int(ghi - glo + 1), maxKacheln - gesetzt + 1);   // + 1: die erste Kachel ist schon gezählt
            let groesse = 1, cx = x, cy = y;
            for (let v = 0; v < 6 && groesse < ziel && gesetzt < maxKacheln; v++) {
              const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cx + dx, cy + dy]).filter((q) => kset.has(q[1] * W + q[0]));
              if (!nb.length) break;
              const w2 = nb.filter(wandnah); const pick = (w2.length ? w2 : nb)[R.int((w2.length ? w2 : nb).length)];
              if (setze(pick[0], pick[1])) { groesse++; cx = pick[0]; cy = pick[1]; }
            }
          }
        }
      }
    }
    karte.rows = rows.map((r) => r.join(''));
    // Türen: teils offen/gesprengt
    const TU = def.tueren;
    const kids = Object.keys(karte.kanten).sort();
    if (TU && stufe !== 'halb') for (const k of kids) {
      const kk = karte.kanten[k];
      if (kk.tor) continue;   // Tore (Rätsel/Kassentür) bleiben, wie sie sind
      const ch = karte.rows[kk.tiles[0][1]][kk.tiles[0][0]];
      const z = (zeichenInfo(D, ch) || {}).zustaende || [];
      const r = R.int(100);
      if (r < (TU.gesprengt || 0) && z.includes('gesprengt')) karte.zustaende[k] = 'gesprengt';
      else if (r < (TU.gesprengt || 0) + (TU.offen || 0) && z.includes('offen') && kk.zustand !== 'offen') karte.zustaende[k] = 'offen';
    }
    // ein innerer Anschluss verschlossen
    if (def.verschliessen && stufe === 'voll') {
      // nie den einzigen Zugang eines Platzes: einmal den Platzgraph mit allen Übergängen bauen; eine Kante a~b ist erlaubt,
      // wenn a und b ohne ihre Türkacheln verbunden bleiben (anderer Übergang oder anderer Weg, kein Brückentest nötig)
      const kk2 = Object.assign({}, karte, { rows: rows.map((r) => r.join('')), zustaende: Object.assign({}, karte.zustaende) });
      const r2 = K.raster(kk2);
      const ids = Object.keys(karte.plaetze).sort(); const pIdx = {}; ids.forEach((id, i) => { pIdx[id] = i; });
      const own = new Int32Array(W * H).fill(-1);
      ids.forEach((id, i) => { const q = karte.plaetze[id].rect; for (let y = q[1]; y < q[1] + q[3]; y++) for (let x = q[0]; x < q[0] + q[2]; x++) own[y * W + x] = i; });
      const ueber = new Map();   // "a:b" -> [[k1, k2], …] Kachelpaare über die Grenze
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const A = own[y * W + x]; if (A < 0 || !r2.durchgang(x, y)) continue;
        for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
          if (nx >= W || ny >= H) continue;
          const Bn = own[ny * W + nx]; if (Bn < 0 || Bn === A || !r2.durchgang(nx, ny)) continue;
          const key = Math.min(A, Bn) + ':' + Math.max(A, Bn);
          (ueber.get(key) || ueber.set(key, []).get(key)).push([y * W + x, ny * W + nx]);
        }
      }
      const adj = ids.map(() => new Set());
      for (const key of ueber.keys()) { const [x, y] = key.split(':').map(Number); adj[x].add(y); adj[y].add(x); }
      const erlaubt = (kid) => {
        const kk = karte.kanten[kid]; const A = pIdx[kk.a], Bn = pIdx[kk.b];
        if (A == null || Bn == null) return false;
        const t = new Set(kk.tiles.map((q) => q[1] * W + q[0]));
        const key = Math.min(A, Bn) + ':' + Math.max(A, Bn);
        if ((ueber.get(key) || []).some(([u, v]) => !t.has(u) && !t.has(v))) return true;   // anderer Übergang
        const seen = new Set([A]); const q = [A];   // anderer Weg ohne die Kante A-B
        while (q.length) { const x = q.pop(); if (x === Bn) return true; for (const y of adj[x]) if (!seen.has(y) && !((x === A && y === Bn) || (x === Bn && y === A))) { seen.add(y); q.push(y); } }
        return false;
      };
      const kand = kids.filter((k) => { const kk = karte.kanten[k]; if (kk.a === kk.b || kk.tor) return false;
        const ch = karte.rows[kk.tiles[0][1]][kk.tiles[0][0]];
        return ((zeichenInfo(D, ch) || {}).zustaende || []).includes('verschlossen') && erlaubt(k); });
      // Reihenfolge aus dem Seed; variante verschiebt die Wahl (nächster Kandidat, wenn der erste die Prüfung bricht)
      const ord = []; while (kand.length) ord.push(kand.splice(R.int(kand.length), 1)[0]);
      for (let i = 0; i < def.verschliessen && i < ord.length; i++) karte.zustaende[ord[(i + variante) % ord.length]] = 'verschlossen';
      karte.meta.verschlussKandidaten = ord.length;
    }
    for (const k of Object.keys(karte.zustaende)) if (karte.kanten[k]) karte.kanten[k].zustand = karte.zustaende[k];
    // Karte-Legende um Überzugszeichen ergänzen
    for (const ch of ['x', 'X']) if (!karte.legende[ch] && zeichenInfo(D, ch)) karte.legende[ch] = zeichenInfo(D, ch);
    if (def.haltung) karte.meta.haltung = def.haltung;
  }

  // ---------------- bauen (§2, §5.3) ----------------
  function bauversion(art, D) {
    D = D || daten();
    const key = art + '|' + Object.keys(D.module).length + '|' + Object.keys(D.schablonen).length;
    const ck = D._nr + '|' + key;
    if (CACHE.bauversion.has(ck)) return CACHE.bauversion.get(ck);
    let h = fnv(art);
    for (const id of Object.keys(D.module).sort()) if (D.module[id].art === art) h = fnv(stabil(Object.assign({}, D.module[id], { _datei: undefined })), h);
    for (const id of Object.keys(D.schablonen).sort()) if (D.schablonen[id].art === art) h = fnv(stabil(Object.assign({}, D.schablonen[id], { _datei: undefined })), h);
    const v = hex(h).slice(0, 6);
    CACHE.bauversion.set(ck, v);
    return v;
  }

  function standardBauweise(D, art) {
    const a = D.achsen && D.achsen.kartenarten && D.achsen.kartenarten[art];
    return (a && a.bauweise) || (art === 'ruine' ? 'rom' : 'germanen');
  }

  // bauRoh: ein einzelner Versuch mit genau diesem Seed (für sweep). -> { karte?, pruefung, fehler }
  function bauRoh(opts) {
    const D = opts.daten ? normalisiere(opts.daten) : daten();
    return bauRohIntern(D, opts);
  }
  function waehleSchablone(D, opts) {
    if (opts.schablone) {
      const s = D.schablonen[opts.schablone] || D.schablonen[opts.art + '.' + opts.schablone];
      if (!s) throw new Error(`BUEHNE: Schablone ${opts.schablone} unbekannt`);
      return s;
    }
    const list = schablonen(opts.art, D);
    if (!list.length) throw new Error(`BUEHNE: keine Schablone für Kartenart ${opts.art}`);
    return list[rng(seedVon('wahl:' + opts.art, opts.seed | 0)).int(list.length)];
  }
  function bauRohIntern(D, opts) {
    const cfg = cfgVon(opts);
    const sch = waehleSchablone(D, opts);
    const o = Object.assign({}, opts, { bauweise: opts.bauweise || standardBauweise(D, sch.art) });
    const v = versuch(D, cfg, sch, opts.seed | 0, o);
    if (!v.karte) return { karte: null, pruefung: { ok: false, fehler: v.fehler, warnungen: [] }, fehler: v.fehler };
    // Überzug (vor der Prüfung); bricht er die Prüfung, wird er abgeschwächt ('teil': ohne Verschließen) bzw. verworfen
    const basis = JSON.stringify(v.karte);
    // Abschwächung: voll (bis zu 4 Kandidaten fürs Verschließen) -> teil (ohne Verschließen) -> halb (halbe Trümmer, Türen
    // wie gebaut) -> kein
    const stufen = v.karte.zustand && v.karte.zustand !== 'intakt'
      ? [['voll', 0], ['voll', 1], ['voll', 2], ['voll', 3], ['teil', 0], ['halb', 0], ['kein', 0]] : [['kein', 0]];
    let pr = null, k = null, grund = null;
    let basisGeprueft = stufen.length === 1;
    for (const [stufe, variante] of stufen) {
      // Scheitert die erste Stufe, zuerst die Grundkarte ohne Überzug prüfen: scheitert auch sie, ist der Seed verloren
      // (alle weiteren Stufen sparen; Bauzeit bei Neuversuchen)
      if (!basisGeprueft && pr && !pr.ok) {
        basisGeprueft = true;
        const k0 = JSON.parse(basis); k0.meta.ueberzug = 'kein';
        const p0 = pruefenIntern(D, k0, cfg, { nurFehler: true });
        if (!p0.ok) { k = k0; pr = p0; break; }
      }
      k = JSON.parse(basis);
      ueberzug(D, k, stufe, variante);
      if (stufe === 'voll' && variante > 0 && variante >= (k.meta.verschlussKandidaten || 0)) continue;
      k.meta.ueberzug = stufen.length > 1 ? stufe : null;
      delete k.meta.verschlussKandidaten;
      pr = pruefenIntern(D, k, cfg, { nurFehler: true });   // Stufen: nur Fehler (Kennzahlen erst am Ende)
      if (pr.ok) break;
      if (!grund) grund = pr.fehler.slice(0, 3).map((f) => f.code + ' ' + f.msg);
    }
    k.patrouillen = kompilierePatrouillen(k);
    k.coverSpots = kompiliereCover(k);
    // Im Spiel (opts.spiel) keine Kennzahlen/Warnungen: die braucht nur Werkzeug, Galerie und check-maps (Bauzeit im Tick)
    if (!opts.spiel) {
      k.meta.kennzahlen = K.kennzahlen(k, cfg);
      const w = pruefenIntern(D, k, cfg, { nurWarnungen: true });
      pr = { ok: pr.ok, fehler: pr.fehler, warnungen: w.warnungen };
    }
    if (grund && k.meta.ueberzug !== 'voll') k.meta.ueberzugGrund = grund;   // warum abgeschwächt (Werkzeug, Galerie)
    v.karte = k;
    return { karte: v.karte, pruefung: pr, fehler: pr.fehler };
  }

  // bauen({ art, schablone?, seed, bauweise, besitz, zustand, zustaende?, id?, versuche?, daten?, cfg?, schiffDecks? }) -> Karte
  // Fehlschlag -> seed + 1, höchstens versuche Mal. Wirft Error (mit .fehler), wenn alle scheitern.
  function bauen(opts) {
    opts = Object.assign({}, opts);
    const D = opts.daten ? normalisiere(opts.daten) : daten();
    const cfg = cfgVon(opts);
    const max = Math.max(1, opts.versuche || cfg.versuche);
    if (!opts.art && opts.schablone) { const s = D.schablonen[opts.schablone]; if (s) opts.art = s.art; }
    if (!opts.zustand) { const a = D.achsen && D.achsen.kartenarten && D.achsen.kartenarten[opts.art]; opts.zustand = (a && a.zustand) || 'intakt'; }
    const start = opts.seed | 0;
    let letzte = null;
    for (let i = 0; i < max; i++) {
      const r = bauRohIntern(D, Object.assign({}, opts, { seed: start + i }));
      letzte = r;
      if (r.karte && r.pruefung.ok) {
        const k = r.karte;
        k.meta.versuche = i + 1; k.meta.seedStart = start;
        k.meta.warnungen = r.pruefung.warnungen;
        // 6. gespeicherte Zustände aus dem Weltstand (nach der Prüfung: Spielzustand bricht keine Karte)
        if (opts.zustaende) zustaendeAnwenden(k, opts.zustaende);
        return k;
      }
    }
    const err = new Error(`BUEHNE: ${opts.schablone || opts.art} ab Seed ${start}: ${max} Versuche gescheitert (${(letzte && letzte.fehler || []).slice(0, 3).map((f) => f.code + ' ' + f.msg).join('; ')})`);
    err.fehler = letzte ? letzte.fehler : [];
    throw err;
  }
  // Zustände (Weltstand) anwenden: { <ankerId|kantenId>: zustand }; Unbekanntes wird verworfen (Rückgabe: verworfen[])
  function zustaendeAnwenden(karte, z) {
    const verworfen = [];
    const ids = new Set(karte.anker.map((a) => a.id));
    for (const k of Object.keys(z || {}).sort()) {
      if (karte.kanten[k]) { karte.kanten[k].zustand = z[k]; karte.zustaende[k] = z[k]; }
      else if (ids.has(k)) karte.zustaende[k] = z[k];
      else verworfen.push(k);
    }
    return verworfen;
  }

  // ---------------- pruefen (§11.3 Bühnen-Codes) ----------------
  function pruefen(karte, opts) {
    const D = (opts && opts.daten) ? normalisiere(opts.daten) : daten();
    return pruefenIntern(D, karte, cfgVon(opts));
  }
  function pruefenIntern(D, karte, cfg0, modus) {
    const cfg = K.cfgFuer(cfg0, karte.art);
    const M = modus || {};
    const fehler = [], warnungen = [];
    const F = (code, msg, x, y) => fehler.push(x == null ? { code, msg } : { code, msg, x, y });
    const Wn = (code, msg, x, y) => warnungen.push(x == null ? { code, msg } : { code, msg, x, y });
    const hand = karte.erzeuger === 'hand';
    const leg = karte.legende || {};
    // K-RASTER
    if (!Array.isArray(karte.rows) || karte.rows.length !== karte.h) F('K-RASTER', `rows: ${karte.rows && karte.rows.length} Zeilen, h = ${karte.h}`);
    else karte.rows.forEach((r, y) => {
      if (r.length !== karte.w) F('K-RASTER', `Zeile ${y}: Länge ${r.length}, w = ${karte.w}`, 0, y);
      for (let x = 0; x < r.length; x++) if (!leg[r[x]] && !(hand && r[x] === ' ')) { F('K-RASTER', `unbekanntes Zeichen "${r[x]}"`, x, y); break; }
    });
    if (fehler.length) return { ok: false, fehler, warnungen };
    if (M.nurWarnungen) return warnungenVon(karte, cfg, hand, fehler, warnungen);
    const r = K.raster(karte);
    const W = karte.w, H = karte.h;
    const anker = karte.anker || [];
    // K-KANTE / K-RICHTUNG (Zellkarten)
    if (!hand && karte.meta && karte.meta.zellen) {
      const [CW, CH] = karte.meta.zellen;
      const own = new Array(CW * CH).fill('#fuell');
      for (const id of Object.keys(karte.plaetze || {}).sort()) {
        const q = karte.plaetze[id].rect;
        for (let y = q[1] / 8; y < (q[1] + q[3]) / 8; y++) for (let x = q[0] / 8; x < (q[0] + q[2]) / 8; x++) own[y * CW + x] = id;
      }
      const seg = (cx, cy, seite) => {
        const out = [];
        for (let k = 0; k < 8; k++) {
          if (seite === 'N') out.push(karte.rows[cy * 8][cx * 8 + k]);
          else if (seite === 'S') out.push(karte.rows[cy * 8 + 7][cx * 8 + k]);
          else if (seite === 'W') out.push(karte.rows[cy * 8 + k][cx * 8]);
          else out.push(karte.rows[cy * 8 + k][cx * 8 + 7]);
        }
        return segmentTyp(D, out, cfg.freiMin);
      };
      const eingNah = (x, y) => anker.some((a) => a.rolle === 'eingang' && Math.abs(a.x - x) <= 4 && Math.abs(a.y - y) <= 4);
      for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
        const me = own[cy * CW + cx];
        for (const seite of SEITEN) {
          const nx = cx + (seite === 'O' ? 1 : seite === 'W' ? -1 : 0), ny = cy + (seite === 'S' ? 1 : seite === 'N' ? -1 : 0);
          const t = seg(cx, cy, seite);
          if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) {
            const mx = cx * 8 + (seite === 'O' ? 7 : seite === 'W' ? 0 : 3), my = cy * 8 + (seite === 'S' ? 7 : seite === 'N' ? 0 : 3);
            if (!RAND_OK[t] && !(t === 'tuer' && eingNah(mx, my))) F('K-KANTE', `Rand ${seite} von ${me}: ${t}`, mx, my);
            continue;
          }
          if (seite === 'N' || seite === 'W') {
            const other = own[ny * CW + nx];
            if (other === me && me !== '#fuell') continue;
            if (other === '#fuell' && me === '#fuell') continue;
            const t2 = seg(nx, ny, GEGEN[seite]);
            if (!vertraeglich(t, t2)) F('K-KANTE', `${me} (${t}) ↔ ${other} (${t2})`, cx * 8 + (seite === 'W' ? 0 : 3), cy * 8 + (seite === 'N' ? 0 : 3));
          }
        }
      }
      for (const id of Object.keys(karte.plaetze || {}).sort()) {
        const p = karte.plaetze[id];
        if (p.richtung && p.lage && p.lage.aussen && p.lage.aussen !== p.richtung) F('K-RICHTUNG', `${id}: Außenkante ${p.lage.aussen}, richtung ${p.richtung}`, p.rect[0], p.rect[1]);
      }
    }
    // Schiff: Längsgang zwischen Sektionen
    if (!hand && karte.art === 'schiff' && karte.plaetze) {
      for (const id of Object.keys(karte.plaetze).sort()) {
        const p = karte.plaetze[id]; const x = p.rect[0] + p.rect[2];
        if (x >= W) continue;
        const y = p.rect[1] + 6;
        if (!r.durchgang(x - 1, y) || !r.durchgang(x, y)) F('K-KANTE', `Längsgang Zeile 6 zwischen ${id} und Nachbar geschlossen`, x, y);
      }
    }
    // K-ANKER-WAND
    const objekt = new Set();
    for (const a of anker) if (blockendesObjekt(D, a.rolle)) objekt.add(a.y * W + a.x);
    if (!hand) for (const a of anker) {
      const i = r.info(a.x, a.y);
      const tuer = K.istTuer(i);
      if (!i) { F('K-ANKER-WAND', `${a.id} außerhalb der Karte`, a.x, a.y); continue; }
      if (tuer && !(a.rolle === 'tor' || a.rolle === 'eingang')) F('K-ANKER-WAND', `${a.id} auf Türkachel`, a.x, a.y);
      else if (!tuer && K.fest(i) && !(a.rolle === 'versteck' && i.kind === 'wand_schwach') && !(a.rolle === 'leit' && leitAufDeckung(i))) F('K-ANKER-WAND', `${a.id} auf fester Kachel "${karte.rows[a.y][a.x]}"`, a.x, a.y);
      if (a.rolle === 'leit' && Array.isArray(a.fuss)) { const e = fussFehler(karte.rows, a.fuss); if (e) F('K-LEIT-FUSS', `${a.id}: ${e}`, a.x, a.y); }
      if (blockendesObjekt(D, a.rolle) && ![[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => (r.durchgang(a.x + dx, a.y + dy)) && !objekt.has((a.y + dy) * W + a.x + dx))) {
        F('K-ANKER-WAND', `${a.id}: Objekt ohne begehbaren Nachbarn`, a.x, a.y);
      }
    }
    // K-PLATEAU
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (karte.rows[y][x] !== '^' || hand) continue;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const c = r.ch(x + dx, y + dy);
        if (c != null && !['^', 'k', '/'].includes(c)) { F('K-PLATEAU', `^ grenzt an "${c}"`, x, y); break; }
      }
    }
    // K-EINGAENGE / K-ABHOLPUNKT
    const eing = anker.filter((a) => a.rolle === 'eingang');
    const abh = anker.filter((a) => a.rolle === 'abholpunkt');
    if (!hand && eing.length < cfg.eingaengeMin) F('K-EINGAENGE', `${eing.length} Eingänge (min. ${cfg.eingaengeMin})`);
    if (abh.length < cfg.abholpunkteMin) F('K-ABHOLPUNKT', `${abh.length} Abholpunkte (min. ${cfg.abholpunkteMin})`);
    const ank = abh.filter((a) => a.ankunft);
    if (ank.length !== 1) F('K-ABHOLPUNKT', `${ank.length} Abholpunkte mit ankunft (genau 1)`);
    if (!hand) for (const a of abh) if (!lPad((x, y) => r.begehbar(x, y) && !r.tuer(x, y), a.x, a.y) || !r.begehbar(a.x, a.y)) F('K-ABHOLPUNKT', `${a.id}: Pad-Fläche ungültig`, a.x, a.y);
    // K-PAAR
    const paare = {};
    for (const a of anker) if (a.rolle === 'raetsel') {
      if (!a.paar) F('K-PAAR', `${a.id} ohne Paar`, a.x, a.y);
      else (paare[a.paar] = paare[a.paar] || []).push(a);
    }
    for (const p of Object.keys(paare).sort()) {
      if (paare[p].length !== 2) F('K-PAAR', `Paar ${p}: ${paare[p].length} Anker (genau 2)`);
      else if (!hand && paare[p][0].platz === paare[p][1].platz && karte.meta && karte.meta.paareGetrennt) Wn('K-PAAR', `Paar ${p} im selben Platz`);
    }
    // K-PFLICHT
    const pflicht = (karte.meta && karte.meta.pflicht) || {};
    const zahl = {}; for (const a of anker) zahl[a.rolle] = (zahl[a.rolle] || 0) + 1;
    for (const rolle of Object.keys(pflicht).sort()) {
      let n = zahl[rolle] || 0, soll = pflicht[rolle];
      if (rolle === 'lift' || rolle === 'leiter') { n = (karte.decks && karte.decks.links || []).filter((l) => l.via === rolle).length; }
      if (n < soll) F('K-PFLICHT', `${rolle}: ${n} von ${soll}`);
    }
    // K-DECK
    if (karte.art === 'schiff' && karte.h > 13) {
      for (let y = 13; y < Math.min(16, H); y++) if (/[^_]/.test(karte.rows[y])) F('K-DECK', `Zeile ${y}: Lücke nicht vollständig "_"`, 0, y);
      for (const a of anker.filter((q) => q.rolle === 'lift' || q.rolle === 'leiter')) {
        const oy = a.y >= SCHIFF_STRIDE ? a.y - SCHIFF_STRIDE : a.y + SCHIFF_STRIDE;
        if (!anker.some((q) => q.rolle === a.rolle && q.x === a.x && q.y === oy)) F('K-DECK', `${a.id}: kein Gegenstück auf dem anderen Deck`, a.x, a.y);
      }
    }
    // K-ERREICHBAR (BFS über Durchgänge, Objekte blockieren, inkl. Deck-Links) von jedem Eingang und der Ankunft
    const links = K.deckLinks(karte);
    const pass = (x, y) => r.durchgang(x, y) && !objekt.has(y * W + x);
    const erreicht = (dist, a) => {
      if (dist[a.y * W + a.x] >= 0) return true;
      if (!objekt.has(a.y * W + a.x) && !K.istTuer(r.info(a.x, a.y))) return false;
      return [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => { const x = a.x + dx, y = a.y + dy; return x >= 0 && y >= 0 && x < W && y < H && dist[y * W + x] >= 0; });
    };
    const pflichtRollen = new Set(Object.keys(pflicht).filter((k) => k !== 'lift' && k !== 'leiter'));
    const ziele = anker.filter((a) => pflichtRollen.has(a.rolle));
    const starts = (hand ? [] : eing).concat(ank);
    const startDist = new Map();
    for (const s of starts) {
      const dist = K.bfs(W, H, (x, y) => pass(x, y) || (x === s.x && y === s.y), [[s.x, s.y]], links);
      startDist.set(s.id, dist);
      for (const z of ziele) if (!erreicht(dist, z)) F('K-ERREICHBAR', `${z.id} von ${s.id} nicht erreichbar`, z.x, z.y);
    }
    // K-INSEL: begehbare Flächen ohne Zugang (schwache Wände gelten als offen)
    if (ank.length && !hand) {
      const r2 = K.raster(karte, { wSchwachOffen: true });
      const main = K.bfs(W, H, (x, y) => r2.durchgang(x, y) && !objekt.has(y * W + x), [[ank[0].x, ank[0].y]], links);
      // Inseln in einem Durchgang beschriften (eine Queue, keine BFS je Insel)
      const lab = new Int32Array(W * H).fill(-1); const q = new Int32Array(W * H);
      const ankerAt = new Map(); for (const a of anker) if (a.rolle !== 'zelle') ankerAt.set(a.y * W + a.x, a);
      let nr = 0;
      for (let k0 = 0; k0 < W * H; k0++) {
        if (lab[k0] >= 0 || main[k0] >= 0 || objekt.has(k0)) continue;
        const x0 = k0 % W, y0 = (k0 - x0) / W;
        if (!r2.begehbar(x0, y0)) continue;
        let qh = 0, qt = 0; q[qt++] = k0; lab[k0] = nr; let n = 0, mitAnker = null;
        while (qh < qt) {
          const k = q[qh++]; n++;
          if (!mitAnker && ankerAt.has(k)) mitAnker = ankerAt.get(k);
          const x = k % W, y = (k - x) / W;
          for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nk = ny * W + nx;
            if (lab[nk] >= 0 || main[nk] >= 0 || objekt.has(nk) || !r2.begehbar(nx, ny)) continue;
            lab[nk] = nr; q[qt++] = nk;
          }
        }
        nr++;
        if (mitAnker) F('K-INSEL', `${mitAnker.id} liegt auf einer Insel ohne Zugang (${n} Kacheln)`, mitAnker.x, mitAnker.y);
        else if (n >= 16) F('K-INSEL', `begehbare Insel ohne Zugang (${n} Kacheln)`, x0, y0);
      }
    }
    if (M.nurFehler) return { ok: !fehler.length, fehler, warnungen };
    return warnungenVon(karte, cfg, hand, fehler, warnungen);
  }
  // Warnungen aus den Kennzahlen
  function warnungenVon(karte, cfg, hand, fehler, warnungen) {
    const Wn = (code, msg, x, y) => warnungen.push(x == null ? { code, msg } : { code, msg, x, y });
    const kz = karte.meta && karte.meta.kennzahlen ? karte.meta.kennzahlen : K.kennzahlen(karte, cfg);
    if (!hand) {
      for (const id of Object.keys(kz.deckung).sort()) if (kz.deckung[id] != null && kz.deckung[id] < cfg.deckungMin) Wn('K-DECKUNG', `${id}: Deckung ${kz.deckung[id]} < ${cfg.deckungMin}`);
      if (kz.sichtgasse > cfg.sichtgasseMax) Wn('K-SICHTGASSE', `Sichtgasse ${kz.sichtgasse} > ${cfg.sichtgasseMax}`, kz.sichtgasseOrt && kz.sichtgasseOrt.x, kz.sichtgasseOrt && kz.sichtgasseOrt.y);
      if (kz.rueckzugFrei === false) Wn('K-RUECKZUG', 'Rückzug nur über den Eingang');
      for (const id of Object.keys(kz.schatten).sort()) if (kz.schatten[id] < 1) Wn('K-SCHATTEN', `Bereich ${id} ohne Sichtschatten`);
      // Sichtung GD: Dichte-Obergrenzen, Schleifen im Gefecht, getrennte Wege auf Außenkarten
      const dicht = [];
      if (cfg.deckungMaxGefecht != null && kz.deckungAnteilGefecht != null && kz.deckungAnteilGefecht > cfg.deckungMaxGefecht) dicht.push(`Gefecht ${kz.deckungAnteilGefecht} > ${cfg.deckungMaxGefecht}`);
      if (cfg.deckungMaxAussen != null && kz.deckungAnteilAussen != null && kz.deckungAnteilAussen > cfg.deckungMaxAussen) dicht.push(`außerhalb ${kz.deckungAnteilAussen} > ${cfg.deckungMaxAussen}`);
      if (cfg.einzelblockMax != null && kz.einzelblockAnteil != null && kz.einzelblockAnteil > cfg.einzelblockMax) dicht.push(`Einzelblöcke ${kz.einzelblockAnteil} > ${cfg.einzelblockMax}`);
      if (dicht.length) Wn('K-DECKUNG-DICHT', 'Deckung zu dicht: ' + dicht.join(', '));
      if (cfg.schleifenMin != null && kz.schleifen != null && kz.schleifen < cfg.schleifenMin && !(karte.meta && karte.meta.linear)) Wn('K-SCHLEIFE', `${kz.schleifen} Schleifen im Gefechtsbereich (min. ${cfg.schleifenMin})`);
      if ((karte.art === 'aussenposten' || karte.art === 'ruine') && kz.wegeGetrennt != null && kz.wegeGetrennt < 2) Wn('K-WEGE', `nur ${kz.wegeGetrennt} getrennter Weg zum Zielbereich (Außenkarte: min. 2)`);
    }
    return { ok: !fehler.length, fehler, warnungen };
  }

  function kennzahlen(karte, opts) { return K.kennzahlen(karte, cfgVon(opts)); }
  // Vorwärmen (Server-Start): Daten laden und alle Modul-Lagen berechnen, damit der erste Bau im Spiel nicht kalt ist
  function vorwaermen() {
    const D = daten(); const cfg = cfgVon();
    for (const id of Object.keys(D.module).sort()) if (!D.module[id]._ladefehler) lagenVon(D, cfg, D.module[id], true);
    fehlerhafteModule(null, D);   // Prüfstand je Modul (F9: fehlerhafte Module werden nicht verbaut)
    for (const art of ['aussenposten', 'station', 'ruine', 'schiff']) {
      bauversion(art, D);
      // ein Probebau je Kartenart wärmt den JIT (erster Bau sonst ~2× langsamer)
      if (schablonen(art, D).length) { try { bauRohIntern(D, { art, seed: 1, zustand: 'verfallen', spiel: true }); } catch (e) { /* Inhalte unvollständig */ } }
    }
    return Object.keys(D.module).length;
  }

  // ---------------- Handkarten als Karte (§2, §6.1) ----------------
  function hand(id) {
    const Maps = getMaps();
    if (!Maps || !Maps[id] || !Maps[id].rows) throw new Error(`BUEHNE: Handkarte ${id} unbekannt`);
    const m = Maps[id];
    const anker = ((Maps.MAP_ANCHORS || {})[id] || []).map((a) => Object.assign({}, a));
    const bereiche = {};
    const areas = (Maps.MAP_AREAS || {})[id] || {};
    for (const k of Object.keys(areas).sort()) {
      const a = areas[k];
      const rects = a.rects ? a.rects.map((q) => q.slice()) : a.rect ? [a.rect.slice()] : a.cols ? [[a.cols[0], 0, a.cols[1] - a.cols[0] + 1, m.h]] : [];
      bereiche[k] = { name: k, rects, rolle: a.rolle || null, gefecht: !!a.gefecht };
    }
    const karte = {
      id, erzeuger: 'hand', art: 'hand', bauweise: null, besitz: null, zustand: 'intakt', seed: null, bauversion: 'hand', schablone: null,
      spiegel: null, w: m.w, h: m.h, rows: m.rows.slice(), legende: m.legend, anker, bereiche, plaetze: {},
      eingaenge: anker.filter((a) => a.rolle === 'eingang').map((a) => a.id),
      abholpunkte: anker.filter((a) => a.rolle === 'abholpunkt').map((a) => a.id),
      ankunft: (anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft) || {}).id || null,
      patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
      meta: { versuche: 0, kennzahlen: null, pflicht: {}, zellen: null },
    };
    karte.coverSpots = kompiliereCover(karte);
    return karte;
  }

  // ---------------- Interaktionsregeln, die Server (server/sim/anker.js) und Client (E-Hinweis) teilen ----------------
  // E (kurz halten): Tür/Luke/Schott/Tor im Zustand 'zu' öffnen – Haltezeit in s je Kachelart
  const TUER_ZEIT = { tuer: 0.4, luke: 0.6, schott: 1, tor: 2 };
  // Kanten einer Karte als Liste [{ id, typ, tiles }] in kantenIdx-Reihenfolge (nach id sortiert). Nimmt beide Formen:
  // karte.kanten als Objekt { id: { typ, tiles } } (Server) oder als awayMap-Liste [[id, tiles, startIdx]] (Client;
  // typ = Kachelart der ersten Kachel, wie beim Bau gesetzt).
  function kantenListe(karte) {
    const kk = karte.kanten || {};
    if (Array.isArray(kk)) {
      return kk.map((e) => {
        const t = (e[1] || [])[0]; const c = t && karte.rows[t[1]] && karte.rows[t[1]][t[0]];
        const info = c != null && karte.legende ? karte.legende[c] : null;
        return { id: e[0], typ: info ? info.kind : null, tiles: e[1] || [] };
      });
    }
    return Object.keys(kk).sort().map((id) => ({ id, typ: kk[id].typ, tiles: kk[id].tiles || [] }));
  }
  // Kanten (aus kantenListe), deren Kacheln die Türgruppe eines Ankers berühren; versteck: auch schwache Wand daneben.
  // a: { rolle, x, y }. -> [{ id, typ, tiles, idx }] nach id sortiert (idx = kantenIdx im Snapshot ko)
  function ankerKanten(karte, a) {
    const tiles = K.tuerKacheln(karte, a.x, a.y);
    if (a.rolle === 'versteck') {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = a.x + dx, y = a.y + dy; const c = karte.rows[y] && karte.rows[y][x];
        if (c && karte.legende[c] && karte.legende[c].kind === 'wand_schwach') tiles.push([x, y]);
      }
    }
    const set = new Set(tiles.map((t) => t[0] + ',' + t[1]));
    return kantenListe(karte).map((k, idx) => Object.assign(k, { idx })).filter((k) => k.tiles.some((t) => set.has(t[0] + ',' + t[1])));
  }
  // Eingang (art technisch): welche Halte-Aktion bietet er an? Nur bei Schott/Luke im Zustand zu/verschlossen;
  // ein Schott darunter -> 'hacken' (Haltezeit halten.schott_hacken), sonst Luke -> 'luke' (TUER_ZEIT.luke), sonst null.
  // zustandVon(kante) -> aktueller Kantenzustand (Server: Laufzeitzustände; Client: Snapshot ko + Startzustand).
  function eingangAktion(karte, a, zustandVon) {
    if (!a || a.rolle !== 'eingang' || a.art !== 'technisch') return null;
    const zu = ankerKanten(karte, a).filter((k) => (k.typ === 'schott' || k.typ === 'luke') && ['zu', 'verschlossen'].includes(zustandVon(k)));
    if (!zu.length) return null;
    return zu.some((k) => k.typ === 'schott') ? 'hacken' : 'luke';
  }

  // Zustand einer Zustandskachel (D/S/G/L/w) auf einer gebauten Karte – maßgeblich für Kollision und Darstellung.
  // Regel des Servers (server/sim/interior.js kachelZustand), auch für gemischte Kanten (z. B. Schott + Tür): der Zustand
  // wird als NAME übertragen und gilt für eine Kachel nur, wenn ihre Kachelart ihn kennt.
  //   liste: Zustände der Kachelart; kanteZ: Laufzeitzustand der Kante (Name) oder null; ankerZ: Laufzeitzustand eines
  //   Ankers auf der Kachel (tor/eingang/versteck) oder null; kanteStart: Startzustand der Kante (Name) oder null;
  //   kanteDurch: begehbarIn des Kantentyps (Zustände, in denen die Kante durchgängig ist), optional.
  //   Reihenfolge: Kante (wenn die Kachelart ihn kennt; ein durchgängiger Kantenzustand, den die Kachelart nicht kennt –
  //   z. B. gehackt/gesprengt an der Tür-Hälfte einer Schott+Tür-Kante –, gilt als offen, wie anker.js kachelZustandFuer)
  //   > Anker (gehackt -> offen, wenn unbekannt) > Kantenstart > erster Zustand.
  function kachelZustandRegel(liste, kanteZ, ankerZ, kanteStart, kanteDurch) {
    const l = liste || [];
    if (kanteZ && l.includes(kanteZ)) return kanteZ;
    if (kanteZ && kanteDurch && kanteDurch.includes(kanteZ) && l.includes('offen')) return 'offen';
    if (ankerZ) { const s = ankerZ === 'gehackt' && !l.includes('gehackt') ? 'offen' : ankerZ; if (l.includes(s)) return s; }
    if (kanteStart && l.includes(kanteStart)) return kanteStart;
    return l.length ? l[0] : null;
  }

  // ---------------- Rätselpaar-Fenster (Abnahme F4, Entscheidung Studioleitung) ----------------
  // Laufweg Schloss A -> Schloss B je Rätselpaar in Kacheln: kürzester begehbarer Weg auf der gebauten Karte (BFS, Türen
  // im Startzustand; ist B so nicht erreichbar, zählen Türen, die man mit E öffnen kann, als Durchgang). Ziel ist B selbst
  // oder ein Nachbarfeld (Schlösser stehen als Objekt auf dem Boden). -> { paar: kacheln | null }, Paare sortiert.
  function raetselWege(karte) {
    const out = {};
    const rs = (karte.anker || []).filter((a) => a.rolle === 'raetsel' && a.paar != null);
    const paare = [...new Set(rs.map((a) => String(a.paar)))].sort();
    if (!paare.length) return out;
    const r = K.raster(karte);
    const links = (karte.decks && karte.decks.links) || [];
    for (const paar of paare) {
      const [a, b] = rs.filter((q) => String(q.paar) === paar).sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
      if (!a || !b) { out[paar] = null; continue; }
      const ziel = (dist) => {
        let best = -1;
        for (const [dx, dy, plus] of [[0, 0, 0], [0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, 0, 1]]) {
          const x = b.x + dx, y = b.y + dy;
          if (x < 0 || y < 0 || x >= karte.w || y >= karte.h) continue;
          const d = dist[y * karte.w + x];
          if (d >= 0 && (best < 0 || d + plus < best)) best = d + plus;
        }
        return best;
      };
      let d = ziel(K.bfs(karte.w, karte.h, (x, y) => r.begehbar(x, y), [[a.x, a.y]], links));
      if (d < 0) d = ziel(K.bfs(karte.w, karte.h, (x, y) => r.durchgang(x, y), [[a.x, a.y]], links));
      out[paar] = d >= 0 ? d : null;
    }
    return out;
  }
  // Fenster eines Rätselpaars SOLO in Sekunden (in der Gruppe gilt das enge anker.paarFenster, anker.js):
  //   max(paarSoloFenster, Laufzeit(Weg A -> B, Spielertempo) × paarLaufFaktor + halten.raetsel + paarPuffer)
  // kacheln: Laufweg (raetselWege); null -> paarSoloFenster. C: Spielkonfiguration (shared/config.js), Standard getConfig().
  function raetselFenster(kacheln, C) {
    C = C || getConfig() || {};
    const A = C.anker || {};
    const solo = Math.max(A.paarFenster || 1.5, A.paarSoloFenster || 15);
    if (!(kacheln >= 0)) return solo;
    const tile = 32;   // Physics.TILE
    const tempo = ((C.player && C.player.speed) || 96) / tile;   // Kacheln je Sekunde
    const lauf = kacheln / tempo;
    const halten = (A.halten && A.halten.raetsel) || 3;
    return Math.max(solo, lauf * (A.paarLaufFaktor || 1.3) + halten + (A.paarPuffer != null ? A.paarPuffer : 2));
  }

  // ---------------- Abholpunkt-Pad, Lift-Reichweite (eine Quelle für Server und Client) ----------------
  // Kachel im Startzustand fest? (Legende der Karte; außerhalb = fest)
  function festStart(karte, x, y) {
    const rows = karte.rows; const leg = karte.legende || {};
    if (y < 0 || y >= rows.length || x < 0 || x >= rows[y].length) return true;
    const i = leg[rows[y][x]];
    if (!i) return true;
    return i.solid === 'zustand' ? !(i.begehbarIn || []).includes((i.zustaende || [])[0]) : !!i.solid;
  }
  // padTiles(karte, a) -> [{ x, y }]: Pad-Felder eines Abholpunkts = der Anker selbst + die im Startzustand begehbaren
  // Nachbarn (N/O/S/W in fester Reihenfolge O, S, W, N). karte: { rows, legende } (Karte oder Client-Kartenobjekt).
  function padTiles(karte, a) {
    const out = [{ x: a.x, y: a.y }];
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (!festStart(karte, a.x + dx, a.y + dy)) out.push({ x: a.x + dx, y: a.y + dy });
    return out;
  }
  // Lift/Leiter (Abnahme F5): wie alle Anker aus Reichweite – auf dem Feld oder auf einem der 8 Nachbarfelder.
  // deckLinkInReichweite(px, py, ax, ay): px/py = Kachel der Figur, ax/ay = Kachel des Lift-/Leiter-Ankers.
  function deckLinkInReichweite(px, py, ax, ay) { return Math.abs(px - ax) <= 1 && Math.abs(py - ay) <= 1; }
  // interaktionsVorrang(karte, tx, ty) -> 'eigen' | 'blick' (Studioleitung, F5): Steht die Figur auf einem Deck-Link-Feld
  // (Lift/Leiter, karte.decks.links), gilt zuerst die eigene Kachel, sonst wie bisher zuerst die Blickrichtungs-Kachel.
  // karte: gebaute Karte oder Client-Kartenobjekt (decks direkt oder unter .karte); ohne Decks immer 'blick'.
  function interaktionsVorrang(karte, tx, ty) {
    const dk = karte && (karte.decks || (karte.karte && karte.karte.decks));
    const links = (dk && dk.links) || [];
    for (const l of links) if ((l.a && l.a[0] === tx && l.a[1] === ty) || (l.b && l.b[0] === tx && l.b[1] === ty)) return 'eigen';
    return 'blick';
  }
  // Solo-Regel des Rätselpaars (Studioleitung, F4): genau 1 (verbundener) Spieler im Außenteam. players: Server game.players
  // bzw. Snapshot st.players (Felder connected, zone). Eine Zählung für Server (anker.js) und Client (E-Hinweis).
  function raetselSolo(players) { return (players || []).filter((p) => p && p.connected !== false && p.zone === 'away').length <= 1; }
  // Karte in Server-Form (anker als Objekte, kanten als { id: { tiles, zustand } }). Die Client-Form aus awayMap
  // (anker [id, rolle, x, y, extra], kanten [[id, tiles, startIdx]]) wird umgesetzt: Kantenstart = Zustand startIdx der
  // Kachelart der ersten Kantenkachel (wie render.js kantenTypInfo).
  function karteServerForm(karte) {
    if (!karte) return karte;
    const anker = karte.anker || [];
    const kanten = karte.kanten;
    const ankerArr = anker.length && Array.isArray(anker[0]);
    const kantenArr = Array.isArray(kanten);
    if (!ankerArr && !kantenArr) return karte;
    const leg = karte.legende || {};
    const out = Object.assign({}, karte);
    if (ankerArr) out.anker = anker.map((a) => Object.assign({}, a[4] || {}, { id: a[0], rolle: a[1], x: a[2], y: a[3] }));
    if (kantenArr) {
      out.kanten = {};
      for (const k of kanten) {
        const t = (k[1] || [])[0];
        const info = t ? leg[karte.rows[t[1]][t[0]]] : null;
        out.kanten[k[0]] = { tiles: k[1] || [], zustand: ((info && info.zustaende) || [])[k[2] || 0] || null };
      }
    }
    out.zustaende = null;
    if (!out.w) out.w = karte.rows[0].length;
    if (!out.h) out.h = karte.rows.length;
    return out;
  }
  // Solo-Fenster eines Paars auf einer Karte (Server- oder Client-Form), Laufwege einmal je Kartenobjekt (WeakMap).
  const WEGE_CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;
  function raetselSoloFenster(karte, paar, C) {
    let w = WEGE_CACHE && WEGE_CACHE.get(karte);
    if (!w) { w = raetselWege(karteServerForm(karte)); if (WEGE_CACHE) WEGE_CACHE.set(karte, w); }
    const d = paar != null ? w[String(paar)] : null;
    return raetselFenster(d == null ? null : d, C);
  }
  // Rätselpaar-Hinweis (Studioleitung, F4): solo nacheinander mit Laufweg-Fenster, in der Gruppe beide gleichzeitig.
  // raetselHinweis(solo, fensterSek) -> Text-Zusatz für den E-Hinweis (Client) bzw. die Meldungen (Server)
  function raetselHinweis(solo, fensterSek) {
    return solo ? 'nacheinander, ' + Math.floor(fensterSek || 0) + ' s Zeit' : 'beide gleichzeitig!';
  }

  // ---------------- K-SILHOUETTE: was wie ein Turm aussieht, ist nicht begehbar (FIX-TURM) ----------------
  // Props, die auf einer begehbaren Kachel stehen (Deko = nur Optik; Props an nicht blockenden Ankern wie `aussicht`),
  // dürfen nicht höher als eine Figur sein – sonst läuft man sichtbar durch sie hindurch (Server-Kollision und
  // Client-Vorhersage kennen nur die Kachel). Hohe Dinge gehören auf einen Block (`O`/`X`, vgl. Leitstück-Fuß) oder
  // an einen blockenden Objektanker.
  // o = { bauweisen: [bauweise/1-JSON], deko: [deko/1-JSON], modelle: { <id>: { height (m), footprint [w, d] } } }
  // -> [{ code: 'K-SILHOUETTE', msg, id }]
  const FIGUR_HOEHE_M = 31 / 16;   // Figur bis Helmoberkante 31 Voxel (actors.js FB_PARTS), 16 Voxel = 1 m
  // Ausnahmen mit Grund (Manifest-Höhe gilt für die höchste Variante, die Deko-Streuung nutzt sie nicht):
  const SILHOUETTE_AUSNAHMEN = {
    'prop/germanen/gemein/kette': 'Deko streut Form 0 (liegend, < 0,2 m); 2 m nur hängend',
  };
  // Türrollen sitzen auf Tür-/Wandkacheln (Kit), lift/leiter sind Kabinen, in die man bewusst hineingeht.
  const SILHOUETTE_ROLLEN_FREI = { tor: 1, eingang: 1, versteck: 1, lift: 1, leiter: 1 };
  function silhouetteFehler(o, D) {
    D = D || daten();
    const M = (o && o.modelle) || {};
    const out = [];
    const pruef = (id, wo, wandstaendig) => {
      if (!id || SILHOUETTE_AUSNAHMEN[id]) return;
      const m = M[id];
      if (!m || typeof m.height !== 'number') return;
      if (m.height <= FIGUR_HOEHE_M + 0.005) return;   // Manifest rundet auf cm (Bake 1,94 m = Figurhöhe)
      const fp = Array.isArray(m.footprint) ? m.footprint : [1, 1];
      if (wandstaendig && Math.min(fp[0], fp[1]) < 1) return;   // schmales Wandteil (Monitor, Regal) an der Wand
      out.push({ code: 'K-SILHOUETTE', id, msg: `${wo}: ${id} ist ${m.height} m hoch (Figur ${FIGUR_HOEHE_M.toFixed(2)} m) und steht auf begehbarer Kachel – man läuft hindurch` });
    };
    for (const b of (o && o.bauweisen) || []) {
      for (const [rolle, je] of Object.entries(b.anker || {})) {
        if (!je || typeof je !== 'object' || SILHOUETTE_ROLLEN_FREI[rolle] || blockendesObjekt(D, rolle)) continue;
        for (const [art, v] of Object.entries(je)) pruef(typeof v === 'string' ? v : v && v.id, `${b.id} anker.${rolle}.${art}`, false);
      }
    }
    for (const d of (o && o.deko) || []) {
      for (const [typ, r] of Object.entries(d.regeln || {})) for (const id of (r && r.props) || []) pruef(id, `deko ${d.id}.${typ}`, !!r.wandnah);
    }
    return out;
  }
  // Node: Eingaben für silhouetteFehler aus content/buehnen/{bauweisen,deko} und public/voxel/manifest.json
  function silhouetteDaten() {
    if (!IST_NODE) throw new Error('silhouetteDaten: nur in Node');
    const fs = require('fs'), path = require('path');
    const wurzel = path.join(__dirname, '..');
    const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
    const ordner = (d) => fs.readdirSync(d).filter((n) => n.endsWith('.json')).sort().map((n) => json(path.join(d, n)));
    const man = json(path.join(wurzel, 'public', 'voxel', 'manifest.json'));
    const modelle = {};
    for (const [id, e] of Object.entries(man.assets || {})) modelle[id] = { height: e.height, footprint: e.footprint };
    return { bauweisen: ordner(path.join(wurzel, 'content', 'buehnen', 'bauweisen')), deko: ordner(path.join(wurzel, 'content', 'buehnen', 'deko')), modelle };
  }

  // Zelle als Text (Werkzeug, Galerie-Rückfall): Anker als Buchstaben über den Zeilen
  const ANKER_GLYPHE = { eingang: 'E', abholpunkt: 'A', wache: 'W', patrouille: 'p', deckung: 'd', terminal: 'T', sprengpunkt: 'B', zelle: 'Z',
    beute: 'K', ziel: '*', fund: 'F', tor: 'G', raetsel: 'R', aussicht: 'V', nsc: 'N', versteck: 'H', lift: 'U', leiter: 'H' };
  function alsText(karte, mitAnker) {
    const rows = karte.rows.map((r) => r.split(''));
    if (mitAnker) for (const a of karte.anker) if (rows[a.y]) rows[a.y][a.x] = '\u001b[1;33m' + (ANKER_GLYPHE[a.rolle] || '?') + '\u001b[0m';
    return rows.map((r) => r.join(''));
  }

  return {
    rng, hash, fnv, bauversion, setDaten, daten, ladeVerzeichnis, schablonen, module,
    modulLagen, pruefeModul, kantenTyp, vertraeglich, segmentTyp: (seg, opts) => segmentTyp(opts && opts.daten ? normalisiere(opts.daten) : daten(), seg, cfgVon(opts).freiMin),
    bauen, bauRoh, pruefen, kennzahlen, vorwaermen, hand, leitFuss, zustaendeAnwenden, alsText, ANKER_GLYPHE,
    tuerKacheln: K.tuerKacheln, raster: K.raster, SCHIFF_STRIDE, STANDARD_CFG,
    TUER_ZEIT, kantenListe, ankerKanten, eingangAktion, kachelZustandRegel,
    raetselWege, raetselFenster, raetselHinweis, raetselSolo, raetselSoloFenster, karteServerForm, padTiles, deckLinkInReichweite, interaktionsVorrang, fehlerhafteModule,
    silhouetteFehler, silhouetteDaten, FIGUR_HOEHE_M,
  };
});
