// Werkstatt (CONTRACT-B1 §4, Team WERKSTATT): Module (modul/1) und Schablonen (schablone/1) zeichnen, live prüfen, speichern.
// Aufbau wie ein Datentool: S = Zustand (einzige Quelle), A = Aktionen (laden, ändern, prüfen, bauen, speichern),
// V = Darstellung (liest S, ruft A). Alle Bühnenregeln kommen aus Shared_Buehne (pruefeModul, modulLagen, kantenTyp,
// bauRoh, pruefen, kennzahlen); das Dateiformat aus WerkstattFormat (auch vom Server benutzt).
// URL: werkstatt.html?modul=<id> | ?schablone=<id>&seed=<n> | &quelle=fixtures
(function () {
  'use strict';
  const WB = window.WerkstattBasis, h = WB.h, FMT = window.WerkstattFormat, B = window.Shared_Buehne;
  const ARTEN = FMT.KARTENARTEN;
  const ANKER_ZEICHEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

  // ======================= Zustand =======================
  const S = {
    buendel: null, quelle: 'content', speichernMoeglich: false, weg: '',
    modus: 'modul', art: 'ruine', filter: '',
    // Modul
    modul: null, ebene: 'rows', zeigeBeleg: -1, zeichen: true,
    pinsel: { rows: '.', beleg: 'o', anker: { rolle: 'wache' }, radieren: false },
    pruefung: null, formatFehler: [], markiert: null, probebau: null,
    // Schablone
    schablone: null, platzSel: null, seed: 1, bauweise: '', besitz: '', zustand: '', decks: null, bau: null, sweep: null,
    dirty: false, meldung: null,
  };

  // ======================= Aktionen =======================
  const A = {};
  A.laden = async function (quelle) {
    S.quelle = quelle || S.quelle;
    const r = await WB.ladeDaten(S.quelle);
    S.buendel = r.buendel; S.speichernMoeglich = r.speichernMoeglich; S.weg = r.weg;
    B.setDaten(WB.klon(S.buendel));
  };
  A.meldung = function (text, art) { S.meldung = text ? { text, art: art || 'ok' } : null; V.meldung(); };
  A.verwerfenOk = function () { return !S.dirty || confirm('Ungespeicherte Änderungen verwerfen?'); };
  A.module = function (art) { return (S.buendel.module || []).filter((m) => !art || m.art === art).sort((a, b) => (a.id < b.id ? -1 : 1)); };
  A.schablonen = function (art) { return (S.buendel.schablonen || []).filter((s) => !art || s.art === art).sort((a, b) => (a.id < b.id ? -1 : 1)); };
  A.typen = function (art) { return Array.from(new Set(A.module(art).map((m) => m.typ))).sort(); };
  A.naechsteVariante = function (art, typ) {
    const ids = new Set(A.module().map((m) => m.id));
    for (const c of 'abcdefghijklmnopqrstuvwxyz') if (!ids.has(`${art}.${typ}.${c}`)) return c;
    return 'neu';
  };

  // ---------- Modul ----------
  A.oeffneModul = function (m) {
    S.modus = 'modul'; S.modul = WB.klon(m); delete S.modul._datei; delete S.modul._ladefehler;
    if (!S.modul.anker) S.modul.anker = S.modul.rows.map((r) => '.'.repeat(r.length));
    if (!S.modul.anker_legende) S.modul.anker_legende = {};
    if (!S.modul.belegungen) S.modul.belegungen = [];
    S.art = S.modul.art; S.ebene = 'rows'; S.zeigeBeleg = -1; S.markiert = null; S.probebau = null; S.dirty = false;
    A.pruefeModul(); V.alles();
  };
  A.neuesModul = function (art, typ) {
    art = art || S.art; typ = typ || A.typen(art)[0] || 'test';
    const schiff = art === 'schiff';
    const W = schiff ? 8 : 8, H = schiff ? 13 : 8;
    const rows = []; for (let y = 0; y < H; y++) rows.push((schiff && (y === 0 || y === H - 1) ? '#' : '.').repeat(W));
    const m = { format: 'modul/1', id: `${art}.${typ}.${A.naechsteVariante(art, typ)}`, art, typ, groesse: schiff ? [W, 13] : [1, 1] };
    if (schiff) m.deck = null;
    Object.assign(m, { drehen: !schiff, spiegeln: true, gewicht: 1, bauweise: null, rows, anker: rows.map((r) => '.'.repeat(r.length)), anker_legende: {}, belegungen: [] });
    A.oeffneModul(m); S.dirty = true; V.kopf();
  };
  A.dupliziere = function () {
    const m = WB.klon(S.modul);
    m.id = `${m.art}.${m.typ}.${A.naechsteVariante(m.art, m.typ)}`;
    A.oeffneModul(m); S.dirty = true; V.kopf();
  };
  A.modulGeaendert = function (sofort) {
    S.dirty = true; S.probebau = null;
    clearTimeout(A._t);
    if (sofort) { A.pruefeModul(); V.alles(); } else { V.modulCanvas(); A._t = setTimeout(() => { A.pruefeModul(); V.nachPruefung(); }, 120); }
  };
  A.pruefeModul = function () {
    const m = S.modul;
    S.formatFehler = FMT.pruefeModul(m);
    try { S.pruefung = B.pruefeModul(m); } catch (e) { S.pruefung = { ok: false, fehler: [{ code: 'INTERN', msg: e.message }], warnungen: [], lagen: [] }; }
  };
  A.dims = function () { return { W: S.modul.rows[0] ? S.modul.rows[0].length : 0, H: S.modul.rows.length }; };
  A.ebeneRaster = function (ebene) {
    if (ebene === 'rows') return S.modul.rows;
    if (ebene === 'anker') return S.modul.anker;
    return S.modul.belegungen[Number(ebene.slice(1))];
  };
  A.setzeZeichen = function (raster, x, y, ch) {
    if (!raster[y] || x < 0 || x >= raster[y].length) return false;
    if (raster[y][x] === ch) return false;
    raster[y] = raster[y].slice(0, x) + ch + raster[y].slice(x + 1);
    return true;
  };
  // Anker-Pinsel -> Legendenzeichen (gleiche Rolle + Attribute = gleiches Zeichen; sonst neues Zeichen)
  A.ankerZeichen = function (eintrag) {
    const leg = S.modul.anker_legende;
    const sig = JSON.stringify(sortiert(eintrag));
    for (const c of Object.keys(leg)) if (JSON.stringify(sortiert(leg[c])) === sig) return c;
    const vorzug = eintrag.rolle.charAt(0);
    const frei = [vorzug].concat(ANKER_ZEICHEN.split('')).find((c) => !leg[c] && c !== '.');
    leg[frei] = Object.assign({ rolle: eintrag.rolle }, WB.klon(eintrag));
    return frei;
  };
  A.legendeAufraeumen = function () {
    const benutzt = new Set(S.modul.anker.join(''));
    for (const c of Object.keys(S.modul.anker_legende)) if (!benutzt.has(c)) delete S.modul.anker_legende[c];
  };
  A.malen = function (x, y) {
    const e = S.ebene;
    let ch;
    if (e === 'rows') ch = S.pinsel.rows;
    else if (e === 'anker') ch = S.pinsel.radieren ? '.' : A.ankerZeichen(ankerEintrag());
    else ch = S.pinsel.beleg;
    const ok = A.setzeZeichen(A.ebeneRaster(e), x, y, ch);
    if (e === 'anker') A.legendeAufraeumen();
    return ok;
  };
  A.rechteck = function (x0, y0, x1, y1) {
    let n = 0;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (A.malen(x, y)) n++;
    return n;
  };
  A.pipette = function (x, y) {
    const r = A.ebeneRaster(S.ebene); if (!r || !r[y]) return;
    const ch = r[y][x];
    if (S.ebene === 'rows') S.pinsel.rows = ch;
    else if (S.ebene === 'anker') { if (ch !== '.' && S.modul.anker_legende[ch]) { S.pinsel.anker = WB.klon(S.modul.anker_legende[ch]); S.pinsel.radieren = false; } else S.pinsel.radieren = true; }
    else S.pinsel.beleg = ch;
    V.panel();
  };
  A.setzeGroesse = function (gw, gh) {
    const m = S.modul;
    const schiff = m.art === 'schiff';
    const W = schiff ? gw : gw * 8, H = schiff ? 13 : gh * 8;
    const passe = (raster, fuell) => {
      const out = [];
      for (let y = 0; y < H; y++) { const r = raster[y] || ''; out.push((r + fuell.repeat(W)).slice(0, W)); }
      return out;
    };
    m.groesse = schiff ? [gw, 13] : [gw, gh];
    m.rows = passe(m.rows, '.'); m.anker = passe(m.anker, '.'); m.belegungen = m.belegungen.map((b) => passe(b, '.'));
    A.legendeAufraeumen();
    A.modulGeaendert(true);
  };
  A.setzeId = function (art, typ, variante) {
    const m = S.modul;
    if (art !== m.art) {
      const schiffNeu = art === 'schiff', schiffAlt = m.art === 'schiff';
      m.art = art;
      if (schiffNeu !== schiffAlt) { if (schiffNeu) { m.deck = null; m.drehen = false; A.setzeGroesse(8, 13); } else { delete m.deck; m.drehen = true; A.setzeGroesse(1, 1); } }
      S.art = art;
    }
    m.typ = typ; m.id = `${art}.${typ}.${variante}`;
    A.modulGeaendert(true);
  };
  A.json = function (text) {
    let o; try { o = JSON.parse(text); } catch (e) { A.meldung('JSON ungültig: ' + e.message, 'bad'); return; }
    if (o.format === 'schablone/1') A.oeffneSchablone(o); else A.oeffneModul(o);
    S.dirty = true; V.kopf();
  };
  A.probebau = async function () {
    const m = S.modul, n = 20;
    const schs = A.schablonen(m.art).filter((s) => platzListe(s).some((p) => p.typ === m.typ));
    S.probebau = { laeuft: true, zeilen: [], beispiel: null, seeds: n };
    V.probebau();
    if (!schs.length) { S.probebau = { laeuft: false, zeilen: [], leer: `Keine Schablone der Kartenart ${m.art} hat einen Platz vom Typ ${m.typ}.` }; V.probebau(); return; }
    const D = B.setDaten(WB.mitErsatz(S.buendel, m));
    for (const s of schs) {
      const z = { id: s.id, ok: 0, genutzt: 0, codes: {} };
      for (let seed = 1; seed <= n; seed++) {
        let r = null; try { r = B.bauRoh({ daten: D, schablone: s.id, seed }); } catch (e) { z.codes.INTERN = (z.codes.INTERN || 0) + 1; continue; }
        if (r.pruefung && r.pruefung.ok) z.ok++;
        else for (const f of (r.pruefung && r.pruefung.fehler) || []) z.codes[f.code] = (z.codes[f.code] || 0) + 1;
        if (r.karte) {
          const plaetze = Object.keys(r.karte.plaetze).filter((id) => r.karte.plaetze[id].modul === m.id);
          if (plaetze.length) { z.genutzt++; if (!S.probebau.beispiel) S.probebau.beispiel = { karte: r.karte, plaetze: new Set(plaetze), pruefung: r.pruefung, schablone: s.id, seed }; }
        }
      }
      S.probebau.zeilen.push(z);
      V.probebau();
      await new Promise((res) => setTimeout(res, 0));
    }
    B.setDaten(WB.klon(S.buendel));
    S.probebau.laeuft = false;
    V.probebau();
  };

  // ---------- Schablone ----------
  A.oeffneSchablone = function (s, seed) {
    S.modus = 'schablone'; S.schablone = WB.klon(s); delete S.schablone._datei;
    const sch = S.schablone;
    if (!sch.bereiche) sch.bereiche = {};
    if (!sch.gefecht) sch.gefecht = [];
    if (!sch.paare) sch.paare = {};
    if (!sch.kanten_fest) sch.kanten_fest = [];
    if (!sch.pflicht) sch.pflicht = {};
    S.art = sch.art; S.platzSel = null; S.sweep = null; S.dirty = false;
    if (seed != null) S.seed = seed;
    A.baueSchablone(); V.alles();
  };
  A.neueSchablone = function (art) {
    art = art || S.art;
    const ids = new Set(A.schablonen().map((s) => s.id));
    let name = 'neu', i = 2; while (ids.has(`${art}.${name}`)) name = 'neu' + i++;
    const ka = S.buendel.achsen && S.buendel.achsen.kartenarten && S.buendel.achsen.kartenarten[art];
    const s = { format: 'schablone/1', id: `${art}.${name}`, art, name: 'Neue Schablone' };
    if (art === 'schiff') Object.assign(s, { spiegeln: ['y'], fuellung: 'leere', decks: [{ plaetze: [] }, { plaetze: [] }] });
    else Object.assign(s, { zellen: (ka && ka.zellen) || [6, 4], spiegeln: ['x'], fuellung: 'fels', plaetze: [] });
    Object.assign(s, { bereiche: { hinein: { name: 'Hinein', rolle: 'hinein' }, ziel: { name: 'Ziel', rolle: 'ziel' }, rueckzug: { name: 'Rückzug', rolle: 'rueckzug' } },
      gefecht: [], paare: {}, kanten_fest: [], pflicht: { eingang: 2, abholpunkt: 1 } });
    A.oeffneSchablone(s); S.dirty = true; V.kopf();
  };
  A.schabloneGeaendert = function () {
    S.dirty = true; S.sweep = null;
    clearTimeout(A._ts);
    V.schabloneCanvas(); V.panel();
    A._ts = setTimeout(() => { A.baueSchablone(); V.bau(); V.panel(); }, 200);
  };
  A.bauOpts = function (seed) {
    const s = S.schablone;
    const o = { schablone: s.id, seed, bauweise: S.bauweise || WB.standardBauweise(S.buendel, s.art), zustand: S.zustand || 'intakt' };
    if (S.besitz) o.besitz = S.besitz;
    if (S.decks) o.schiffDecks = S.decks;
    return o;
  };
  A.baueSchablone = function () {
    const s = S.schablone;
    const fmt = FMT.pruefeSchablone(s);
    let r = null, err = null;
    const t0 = performance.now();
    try {
      const D = B.setDaten(WB.mitErsatz(S.buendel, s));
      r = B.bauRoh(Object.assign({ daten: D }, A.bauOpts(S.seed)));
    } catch (e) { err = e.message; }
    S.bau = { fmt, roh: r, err, ms: Math.round(performance.now() - t0) };
  };
  A.sweep = async function (n) {
    const s = S.schablone, D = B.setDaten(WB.mitErsatz(S.buendel, s));
    S.sweep = { laeuft: true, n, ok: 0, fertig: 0, schlecht: [], codes: {} };
    V.sweep();
    for (let seed = 1; seed <= n; seed++) {
      let r = null; try { r = B.bauRoh(Object.assign({ daten: D }, A.bauOpts(seed))); } catch (e) { r = null; }
      S.sweep.fertig++;
      if (r && r.pruefung && r.pruefung.ok) S.sweep.ok++;
      else { S.sweep.schlecht.push(seed); for (const f of (r && r.pruefung && r.pruefung.fehler) || [{ code: 'INTERN' }]) S.sweep.codes[f.code] = (S.sweep.codes[f.code] || 0) + 1; }
      if (seed % 5 === 0) { V.sweep(); await new Promise((res) => setTimeout(res, 0)); }
    }
    S.sweep.laeuft = false; V.sweep();
  };
  A.platz = function (id) { return platzListe(S.schablone).find((p) => p.id === id) || null; };
  A.platzBelegt = function (x, y, w, h, ohne) {
    for (const p of S.schablone.plaetze || []) {
      if (p.id === ohne) continue;
      const pw = p.w || 1, ph = p.h || 1;
      if (x < p.x + pw && x + w > p.x && y < p.y + ph && y + h > p.y) return true;
    }
    return false;
  };
  A.neuerPlatz = function (x, y, w, h) {
    const s = S.schablone;
    if (x < 0 || y < 0 || x + w > s.zellen[0] || y + h > s.zellen[1] || A.platzBelegt(x, y, w, h)) return;
    const typ = (S.platzSel && A.platz(S.platzSel) && A.platz(S.platzSel).typ) || A.typen(s.art)[0] || 'platz';
    const id = freieId(typ);
    s.plaetze.push({ id, typ, x, y, w, h, bereich: null });
    S.platzSel = id; A.schabloneGeaendert();
  };
  A.verschiebePlatz = function (id, x, y) {
    const p = A.platz(id), s = S.schablone;
    const w = p.w || 1, hh = p.h || 1;
    if (x < 0 || y < 0 || x + w > s.zellen[0] || y + hh > s.zellen[1] || A.platzBelegt(x, y, w, hh, id)) return false;
    p.x = x; p.y = y; A.schabloneGeaendert(); return true;
  };
  A.entfernePlatz = function (id) {
    const s = S.schablone;
    if (s.decks) for (const d of s.decks) d.plaetze = d.plaetze.filter((p) => p.id !== id);
    else s.plaetze = s.plaetze.filter((p) => p.id !== id);
    s.gefecht = s.gefecht.filter((g) => g !== id);
    for (const k of Object.keys(s.paare)) s.paare[k] = s.paare[k].map((q) => (q === id ? '' : q));
    s.kanten_fest = s.kanten_fest.filter((k) => k.a !== id && k.b !== id);
    if (S.platzSel === id) S.platzSel = null;
    A.schabloneGeaendert();
  };
  A.umbenennePlatz = function (alt, neu) {
    if (!/^[a-z0-9_]+$/.test(neu) || A.platz(neu)) { A.meldung(`Platz-id „${neu}“ ungültig oder schon vergeben`, 'bad'); V.panel(); return; }
    const s = S.schablone, p = A.platz(alt);
    p.id = neu;
    s.gefecht = s.gefecht.map((g) => (g === alt ? neu : g));
    for (const k of Object.keys(s.paare)) s.paare[k] = s.paare[k].map((q) => (q === alt ? neu : q));
    for (const k of s.kanten_fest) { if (k.a === alt) k.a = neu; if (k.b === alt) k.b = neu; }
    S.platzSel = neu; A.schabloneGeaendert();
  };
  A.setzePlatzFeld = function (id, feld, wert) {
    const p = A.platz(id); if (!p) return;
    if (feld === 'ankunft') { for (const q of platzListe(S.schablone)) delete q.ankunft; if (wert) p.ankunft = true; }
    else if (feld === 'gefecht') { const s = S.schablone; s.gefecht = s.gefecht.filter((g) => g !== id); if (wert) s.gefecht.push(id); }
    else if (feld === 'w' || feld === 'h') {
      const w = feld === 'w' ? wert : (p.w || 1), hh = feld === 'h' ? wert : (p.h || 1);
      if (p.x + w > S.schablone.zellen[0] || p.y + hh > S.schablone.zellen[1] || A.platzBelegt(p.x, p.y, w, hh, id)) { A.meldung('Platz passt so nicht (Rand oder Überlappung)', 'bad'); V.panel(); return; }
      p[feld] = wert;
    } else if (wert === '' || wert == null || wert === false) {
      if (feld === 'bereich') p.bereich = null; else delete p[feld];
    } else p[feld] = wert;
    A.schabloneGeaendert();
  };
  A.schiffPlatzNeu = function (deck) {
    const s = S.schablone;
    const typ = A.typen('schiff')[0] || 'lager';
    s.decks[deck].plaetze.push({ id: freieId(typ), typ, breite: 8, fest: false, kern: false, bereich: null });
    A.schabloneGeaendert();
  };
  A.schiffVerschiebe = function (id, d) {
    for (const deck of S.schablone.decks) {
      const i = deck.plaetze.findIndex((p) => p.id === id);
      if (i < 0) continue;
      const j = i + d; if (j < 0 || j >= deck.plaetze.length) return;
      const t = deck.plaetze[i]; deck.plaetze[i] = deck.plaetze[j]; deck.plaetze[j] = t;
    }
    A.schabloneGeaendert();
  };
  A.varianten = function (p) {
    // Module mit passendem Typ und Lage (Größe, richtung) – über Shared_Buehne.modulLagen
    const s = S.schablone;
    return A.module(s.art).filter((m) => {
      if (m.typ !== p.typ) return false;
      if (s.decks) return m.groesse && m.groesse[0] === p.breite;
      let lagen; try { lagen = B.modulLagen(m); } catch (e) { return false; }
      return lagen.some((l) => l.w === (p.w || 1) * 8 && l.h === (p.h || 1) * 8 && (!p.richtung || l.aussen === p.richtung));
    });
  };

  // ---------- Speichern ----------
  A.inhalt = function () { return S.modus === 'modul' ? S.modul : S.schablone; };
  A.speichern = async function (trotzFehler) {
    const inhalt = A.inhalt();
    const fmt = FMT.pruefe(inhalt);
    if (fmt.length) { A.meldung('Format: ' + fmt.map((f) => f.msg).join(' · '), 'bad'); return; }
    let r, body;
    try {
      r = await fetch('/werkstatt/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quelle: S.quelle, inhalt, trotzFehler: !!trotzFehler }) });
      body = await r.json();
    } catch (e) { A.meldung('Speichern nicht möglich (Server ohne WERKSTATT=1?) – bitte „Download“ nutzen.', 'bad'); return; }
    if (r.status === 409 && body.brauchtBestaetigung) {
      if (confirm(`Die Prüfung meldet ${body.fehler.length} Fehler:\n\n${body.fehler.slice(0, 8).map((f) => f.code + ' ' + f.msg).join('\n')}\n\nTrotzdem speichern?`)) return A.speichern(true);
      A.meldung('nicht gespeichert', 'warn'); return;
    }
    if (!body.ok) { A.meldung('Nicht gespeichert: ' + (body.fehler || []).slice(0, 4).map((f) => f.code + ' ' + f.msg).join(' · '), 'bad'); return; }
    const kopie = Object.assign(WB.klon(inhalt), { _datei: FMT.dateiPfad(inhalt) });
    const feld = FMT.istSchablone(inhalt) ? 'schablonen' : 'module';
    S.buendel[feld] = (S.buendel[feld] || []).filter((o) => o.id !== inhalt.id).concat([kopie]);
    B.setDaten(WB.klon(S.buendel));
    S.dirty = false;
    A.meldung(`Gespeichert: ${body.pfad}${body.ueberschrieben ? ' (überschrieben)' : ' (neu)'}` + ((body.fehler || []).length ? ` – mit ${body.fehler.length} Prüffehlern` : ''), 'ok');
    V.liste(); V.kopf();
  };
  A.download = function () { const o = A.inhalt(); WB.download(o.id + '.json', FMT.alsText(o)); };

  // ======================= Hilfen =======================
  function sortiert(o) { const out = {}; for (const k of Object.keys(o).sort()) if (o[k] !== '' && o[k] != null && o[k] !== false) out[k] = o[k]; return out; }
  function ankerEintrag() { return sortiert(S.pinsel.anker); }
  function platzListe(s) { return s.decks ? s.decks.flatMap((d) => d.plaetze || []) : (s.plaetze || []); }
  function freieId(typ) {
    const ids = new Set(platzListe(S.schablone).map((p) => p.id));
    if (!ids.has(typ)) return typ;
    let i = 1; while (ids.has(`${typ}_${i}`)) i++;
    return `${typ}_${i}`;
  }
  function rollen() { return Object.keys((S.buendel.anker && S.buendel.anker.rollen) || {}); }
  function feld(label, el, titel) { return h('label', { class: 'feld', title: titel || '' }, h('span', {}, label), el); }
  function zahl(wert, onchange, attrs) { return h('input', Object.assign({ type: 'number', value: wert, onchange: (e) => onchange(Number(e.target.value)) }, attrs || {})); }
  function text(wert, onchange, attrs) { return h('input', Object.assign({ value: wert == null ? '' : wert, onchange: (e) => onchange(e.target.value) }, attrs || {})); }
  function check(wert, onchange, attrs) { return h('input', Object.assign({ type: 'checkbox', checked: !!wert, onchange: (e) => onchange(e.target.checked) }, attrs || {})); }
  function abschnitt(titel, ...inhalt) { return h('section', {}, h('h3', {}, titel), inhalt); }

  // ======================= Darstellung =======================
  const V = {};
  // nach Live-Prüfung beim Malen: Leinwand bleibt dasselbe Element (Ziehen läuft weiter)
  V.nachPruefung = function () { V.kopf(); V.modulCanvas(); V.lagen(); V.probebau(); V.panel(); };
  V.alles = function () { V.kopf(); V.liste(); V.mitte(); V.panel(); V.meldung(); };
  V.meldung = function () {
    const el = document.getElementById('meldung');
    el.textContent = S.meldung ? S.meldung.text : '';
    el.className = S.meldung ? S.meldung.art : '';
  };
  V.kopf = function () {
    const k = document.getElementById('kopfInhalt');
    k.textContent = '';
    k.appendChild(h('div', { class: 'tabs' },
      h('button', { class: S.modus === 'modul' ? 'an' : '', id: 'tabModul', onclick: () => { if (S.modus !== 'modul') { if (!A.verwerfenOk()) return; S.modus = 'modul'; if (!S.modul) A.neuesModul(); else { A.pruefeModul(); V.alles(); } } } }, 'Modul'),
      h('button', { class: S.modus === 'schablone' ? 'an' : '', id: 'tabSchablone', onclick: () => { if (S.modus !== 'schablone') { if (!A.verwerfenOk()) return; S.modus = 'schablone'; if (!S.schablone) { const s = A.schablonen(S.art)[0]; if (s) A.oeffneSchablone(s); else A.neueSchablone(); } else { A.baueSchablone(); V.alles(); } } } }, 'Schablone')));
    k.appendChild(feld('Quelle', WB.auswahl([['content', 'content/buehnen'], ['fixtures', 'tools/fixtures/buehne']], S.quelle, async (v) => {
      if (!A.verwerfenOk()) { V.kopf(); return; }
      try { await A.laden(v); A.meldung(`Quelle: ${v}`); } catch (e) { A.meldung(e.message, 'bad'); }
      S.modul = null; S.schablone = null; S.dirty = false;
      if (S.modus === 'modul') A.neuesModul(); else { const s = A.schablonen(S.art)[0]; if (s) A.oeffneSchablone(s); else A.neueSchablone(); }
    }, { id: 'fQuelle' })));
    const o = A.inhalt();
    k.appendChild(h('span', { class: 'titel' }, o ? o.id : '–', S.dirty ? h('span', { class: 'warn', title: 'ungespeichert' }, ' ●') : null));
    k.appendChild(h('span', { class: 'dim' }, S.speichernMoeglich ? `Speichern nach ${S.quelle === 'fixtures' ? 'tools/fixtures/buehne' : 'content/buehnen'}/${o ? FMT.dateiPfad(o) || '?' : ''}` : 'Speichern aus (Server ohne WERKSTATT=1) – Download geht'));
    k.appendChild(h('span', { class: 'knoepfe' },
      h('button', { id: 'bSpeichern', disabled: !S.speichernMoeglich, onclick: () => A.speichern(false), title: 'POST /werkstatt/save' }, 'Speichern'),
      h('button', { id: 'bDownload', onclick: A.download }, 'Download')));
  };
  V.liste = function () {
    const el = document.getElementById('liste');
    el.textContent = '';
    el.appendChild(feld('Kartenart', WB.auswahl(ARTEN, S.art, (v) => { S.art = v; V.liste(); }, { id: 'lArt' })));
    el.appendChild(h('input', { placeholder: 'Filter …', value: S.filter, oninput: (e) => { S.filter = e.target.value; V.listeEintraege(); } }));
    el.appendChild(h('div', { class: 'knoepfe' },
      S.modus === 'modul'
        ? [h('button', { id: 'bNeu', onclick: () => { if (A.verwerfenOk()) A.neuesModul(S.art); } }, '+ Modul'), h('button', { onclick: () => A.dupliziere(), disabled: !S.modul }, 'Duplizieren')]
        : [h('button', { id: 'bNeuSch', onclick: () => { if (A.verwerfenOk()) A.neueSchablone(S.art); } }, '+ Schablone')],
      h('label', { class: 'datei' }, 'Import …', h('input', { type: 'file', accept: '.json', onchange: (e) => {
        const f = e.target.files[0]; if (!f) return;
        f.text().then((t) => { if (A.verwerfenOk()) A.json(t); });
      } }))));
    el.appendChild(h('div', { id: 'eintraege' }));
    V.listeEintraege();
  };
  V.listeEintraege = function () {
    const el = document.getElementById('eintraege'); el.textContent = '';
    const liste = S.modus === 'modul' ? A.module(S.art) : A.schablonen(S.art);
    const f = S.filter.toLowerCase();
    let typ = null;
    for (const o of liste) {
      if (f && o.id.toLowerCase().indexOf(f) < 0) continue;
      if (S.modus === 'modul' && o.typ !== typ) { typ = o.typ; el.appendChild(h('div', { class: 'gruppe' }, typ)); }
      const aktiv = A.inhalt() && A.inhalt().id === o.id;
      let ok = true;
      if (S.modus === 'modul') { try { ok = B.pruefeModul(o).ok; } catch (e) { ok = false; } }
      el.appendChild(h('div', { class: 'eintrag' + (aktiv ? ' an' : '') + (ok ? '' : ' bad'), onclick: () => {
        if (!A.verwerfenOk()) return;
        if (S.modus === 'modul') A.oeffneModul(o); else A.oeffneSchablone(o);
        history.replaceState(null, '', `?${S.modus}=${encodeURIComponent(o.id)}${S.quelle !== 'content' ? '&quelle=' + S.quelle : ''}`);
      } }, o.id.replace(S.art + '.', ''), S.modus === 'modul' ? h('span', { class: 'dim' }, ` ${(o.groesse || []).join('×')}`) : null));
    }
    if (!el.childNodes.length) el.appendChild(h('div', { class: 'dim' }, 'nichts vorhanden'));
  };
  V.mitte = function () {
    const el = document.getElementById('mitte'); el.textContent = '';
    if (S.modus === 'modul' && S.modul) {
      el.appendChild(V.modulWerkzeug());
      el.appendChild(h('div', { class: 'leinwand' }, h('canvas', { id: 'cvModul' })));
      el.appendChild(h('div', { id: 'hoverInfo', class: 'dim mono' }, 'Linke Maus: malen · Umschalt+Ziehen: Rechteck · Rechte Maus: Pipette'));
      el.appendChild(h('h3', {}, 'Lagen (Drehen/Spiegeln) mit abgeleiteten Kanten'));
      el.appendChild(h('div', { id: 'lagen', class: 'lagen' }));
      el.appendChild(h('div', { id: 'probebau' }));
      V.modulCanvas(); V.lagen(); V.probebau();
      V.modulMaus();
    }
    if (S.modus === 'schablone' && S.schablone) {
      el.appendChild(h('div', { class: 'leinwand' }, h('canvas', { id: 'cvSchablone', tabindex: 0 })));
      el.appendChild(h('div', { class: 'dim' }, S.schablone.decks ? 'Klick: Platz wählen · Reihenfolge und Breite im Seitenfeld' : 'Ziehen auf freien Zellen: neuer Platz · Platz ziehen: verschieben · Entf: Platz löschen'));
      el.appendChild(V.bauWerkzeug());
      el.appendChild(h('div', { id: 'bau' }));
      el.appendChild(h('div', { id: 'sweep' }));
      V.schabloneCanvas(); V.bau(); V.sweep();
      V.schabloneMaus();
    }
  };

  // ---------- Modul: Werkzeugleiste, Leinwand ----------
  V.modulWerkzeug = function () {
    const m = S.modul;
    const ebenen = [['rows', 'Kacheln'], ['anker', 'Anker']].concat(m.belegungen.map((_, i) => ['b' + i, `Belegung ${i + 1}`]));
    return h('div', { class: 'werkzeug' },
      h('span', { class: 'tabs' }, ebenen.map(([k, t]) => h('button', { class: S.ebene === k ? 'an' : '', 'data-ebene': k, onclick: () => { S.ebene = k; V.mitte(); V.panel(); } }, t))),
      m.belegungen.length < 3 ? h('button', { id: 'bBelegNeu', onclick: () => { m.belegungen.push(m.rows.map((r) => '.'.repeat(r.length))); S.ebene = 'b' + (m.belegungen.length - 1); A.modulGeaendert(true); } }, '+ Belegung') : null,
      S.ebene.charAt(0) === 'b' ? h('button', { onclick: () => { m.belegungen.splice(Number(S.ebene.slice(1)), 1); S.ebene = 'rows'; A.modulGeaendert(true); } }, 'Belegung löschen') : null,
      S.ebene.charAt(0) !== 'b' && m.belegungen.length ? feld('Belegung zeigen', WB.auswahl([['-1', 'keine']].concat(m.belegungen.map((_, i) => [String(i), String(i + 1)])), String(S.zeigeBeleg), (v) => { S.zeigeBeleg = Number(v); V.modulCanvas(); })) : null,
      h('label', {}, check(S.zeichen, (v) => { S.zeichen = v; V.modulCanvas(); }), ' Zeichen'));
  };
  V.modulGeo = function () {
    const { W, H } = A.dims();
    const px = Math.max(14, Math.min(46, Math.floor(600 / Math.max(W, H))));
    return { px, ox: 24, oy: 24, W, H };
  };
  V.modulCanvas = function () {
    const cv = document.getElementById('cvModul'); if (!cv) return;
    const m = S.modul, g = V.modulGeo();
    cv.width = g.W * g.px + 48; cv.height = g.H * g.px + 48;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0d1018'; ctx.fillRect(0, 0, cv.width, cv.height);
    const o = { px: g.px, ox: g.ox, oy: g.oy, zeichen: S.zeichen };
    WB.zeichneRows(ctx, S.buendel, m.rows, o);
    const bi = S.ebene.charAt(0) === 'b' ? Number(S.ebene.slice(1)) : S.zeigeBeleg;
    if (bi >= 0 && m.belegungen[bi]) WB.zeichneBelegung(ctx, S.buendel, m.belegungen[bi], Object.assign({}, o, { alpha: S.ebene.charAt(0) === 'b' ? 0.95 : 0.6 }));
    // Raster
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
    for (let x = 0; x <= g.W; x++) { ctx.beginPath(); ctx.moveTo(g.ox + x * g.px + 0.5, g.oy); ctx.lineTo(g.ox + x * g.px + 0.5, g.oy + g.H * g.px); ctx.stroke(); }
    for (let y = 0; y <= g.H; y++) { ctx.beginPath(); ctx.moveTo(g.ox, g.oy + y * g.px + 0.5); ctx.lineTo(g.ox + g.W * g.px, g.oy + y * g.px + 0.5); ctx.stroke(); }
    if (m.art !== 'schiff') {
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      for (let x = 8; x < g.W; x += 8) { ctx.beginPath(); ctx.moveTo(g.ox + x * g.px, g.oy); ctx.lineTo(g.ox + x * g.px, g.oy + g.H * g.px); ctx.stroke(); }
      for (let y = 8; y < g.H; y += 8) { ctx.beginPath(); ctx.moveTo(g.ox, g.oy + y * g.px); ctx.lineTo(g.ox + g.W * g.px, g.oy + y * g.px); ctx.stroke(); }
    }
    // Anker
    const anker = [];
    m.anker.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const c = r[x]; if (c === '.' || c === ' ') continue; const e = m.anker_legende[c]; anker.push({ x, y, ch: c, rolle: e ? e.rolle : '?' }); } });
    ctx.save(); if (S.ebene.charAt(0) === 'b') ctx.globalAlpha = 0.45;
    WB.zeichneAnker(ctx, anker, Object.assign({}, o, { mitZeichen: S.ebene === 'anker' }));
    ctx.restore();
    // Kanten (abgeleitet über Shared_Buehne)
    WB.zeichneKanten(ctx, V.kantenGrundlage(), g.W, g.H, Object.assign({}, o, { dicke: 10, mitText: true }));
    // Außenkante (Grundlage N) markieren
    if (m.art !== 'schiff') { ctx.fillStyle = '#9aa3b5'; ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('außen ▲', 2, 2); }
    if (S.pruefung) {
      WB.zeichneFehler(ctx, S.pruefung.warnungen.map((w) => Object.assign({ warnung: true }, w)), o);
      WB.zeichneFehler(ctx, S.pruefung.fehler, o);
    }
    if (S.markiert) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(g.ox + S.markiert.x * g.px - 2, g.oy + S.markiert.y * g.px - 2, g.px + 4, g.px + 4); }
  };
  V.kantenGrundlage = function () {
    const m = S.modul;
    if (m.art === 'schiff') { const l = S.pruefung && S.pruefung.lagen && S.pruefung.lagen[0]; return l ? l.kanten : null; }
    const { W, H } = A.dims();
    if (!W || W % 8 || H % 8 || m.rows.some((r) => r.length !== W)) return null;
    const k = {};
    try {
      for (const seite of FMT.SEITEN) {
        const n = seite === 'N' || seite === 'S' ? W / 8 : H / 8;
        k[seite] = []; for (let i = 0; i < n; i++) k[seite].push(B.kantenTyp(m.rows, seite, i));
      }
    } catch (e) { return null; }
    return k;
  };
  V.modulMaus = function () {
    const cv = document.getElementById('cvModul');
    let malt = false, start = null, rechteck = false;
    const pos = (ev) => { const r = cv.getBoundingClientRect(), g = V.modulGeo(); return { x: Math.floor((ev.clientX - r.left - g.ox) / g.px), y: Math.floor((ev.clientY - r.top - g.oy) / g.px) }; };
    cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
    cv.addEventListener('mousedown', (ev) => {
      const p = pos(ev); const { W, H } = A.dims();
      if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return;
      if (ev.button === 2) { A.pipette(p.x, p.y); return; }
      if (ev.shiftKey) { rechteck = true; start = p; return; }
      malt = true; if (A.malen(p.x, p.y)) A.modulGeaendert();
    });
    cv.addEventListener('mousemove', (ev) => {
      const p = pos(ev); const { W, H } = A.dims();
      const info = document.getElementById('hoverInfo');
      if (p.x >= 0 && p.y >= 0 && p.x < W && p.y < H && info) {
        const ch = S.modul.rows[p.y][p.x], i = WB.zeichenInfo(S.buendel, ch), ac = S.modul.anker[p.y][p.x], e = S.modul.anker_legende[ac];
        info.textContent = `${p.x},${p.y}  "${ch}" ${i ? i.kind : 'unbekannt'}` + (e ? `  ·  Anker "${ac}" ${JSON.stringify(e)}` : '') + `  ·  Zelle ${Math.floor(p.x / 8)},${Math.floor(p.y / 8)}`;
      }
      if (malt && p.x >= 0 && p.y >= 0 && p.x < W && p.y < H && A.malen(p.x, p.y)) A.modulGeaendert();
      if (rechteck && start) {
        V.modulCanvas();
        const g = V.modulGeo(), ctx = cv.getContext('2d');
        ctx.strokeStyle = '#7FE0C2'; ctx.lineWidth = 2;
        ctx.strokeRect(g.ox + Math.min(start.x, p.x) * g.px, g.oy + Math.min(start.y, p.y) * g.px, (Math.abs(p.x - start.x) + 1) * g.px, (Math.abs(p.y - start.y) + 1) * g.px);
      }
    });
    window.onmouseup = (ev) => {
      if (rechteck && start) {
        const p = pos(ev); const { W, H } = A.dims();
        const cl = (v, m) => Math.max(0, Math.min(m - 1, v));
        if (A.rechteck(start.x, start.y, cl(p.x, W), cl(p.y, H))) A.modulGeaendert(true); else V.modulCanvas();
      }
      malt = false; rechteck = false; start = null;
    };
  };
  V.lagen = function () {
    const el = document.getElementById('lagen'); if (!el) return;
    el.textContent = '';
    const lagen = (S.pruefung && S.pruefung.lagen) || [];
    if (!lagen.length) { el.appendChild(h('div', { class: 'dim' }, 'Keine Lagen (erst Fehler im Raster beheben).')); return; }
    for (const l of lagen) {
      const px = Math.max(3, Math.min(10, Math.floor(130 / Math.max(l.w, l.h))));
      const cv = h('canvas', { width: l.w * px + 24, height: l.h * px + 24 });
      const ctx = cv.getContext('2d');
      const o = { px, ox: 12, oy: 12 };
      WB.zeichneRows(ctx, S.buendel, l.rows, o);
      const anker = [];
      l.anker.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const e = S.modul.anker_legende[r[x]]; if (e) anker.push({ x, y, rolle: e.rolle }); } });
      WB.zeichneAnker(ctx, anker, o);
      WB.zeichneKanten(ctx, l.kanten, l.w, l.h, Object.assign({}, o, { dicke: 5 }));
      const titel = `${l.rot * 90}°${l.spiegel ? ' gespiegelt' + (l.spiegel === 'y' ? ' (y)' : '') : ''}${l.aussen ? ' · außen ' + l.aussen : ''}`;
      el.appendChild(h('div', { class: 'lage' }, cv, h('div', { class: 'dim' }, titel)));
    }
    el.appendChild(h('div', { class: 'legende' }, Object.keys(WB.KANTE_FARBE).map((k) => h('span', {}, h('i', { style: { background: WB.KANTE_FARBE[k] } }), k))));
  };
  V.probebau = function () {
    const el = document.getElementById('probebau'); if (!el) return;
    el.textContent = '';
    el.appendChild(h('h3', {}, 'Probebau', h('button', { id: 'bProbebau', onclick: () => A.probebau(), disabled: S.probebau && S.probebau.laeuft, style: { marginLeft: '10px' } }, 'Mit diesem Modul bauen (Seeds 1–20)')));
    const p = S.probebau;
    if (!p) { el.appendChild(h('div', { class: 'dim' }, 'Baut alle Schablonen der Kartenart, die einen Platz vom Typ dieses Moduls haben, mit dem ungespeicherten Stand.')); return; }
    if (p.leer) { el.appendChild(h('div', { class: 'warn' }, p.leer)); return; }
    el.appendChild(h('table', { class: 'tab' }, h('tr', {}, h('th', {}, 'Schablone'), h('th', {}, 'bestanden'), h('th', {}, 'Modul genutzt'), h('th', {}, 'häufigste Fehler')),
      p.zeilen.map((z) => h('tr', {}, h('td', {}, z.id), h('td', { class: z.ok / p.seeds < 0.8 ? 'bad' : 'ok' }, `${z.ok}/${p.seeds}`), h('td', { class: z.genutzt ? '' : 'warn' }, `${z.genutzt}/${p.seeds}`),
        h('td', { class: 'dim' }, Object.keys(z.codes).sort((a, b) => z.codes[b] - z.codes[a]).slice(0, 3).map((c) => `${c} ×${z.codes[c]}`).join(', ') || '–')))));
    if (p.laeuft) el.appendChild(h('div', { class: 'dim' }, 'baut …'));
    if (p.beispiel) {
      const k = p.beispiel.karte, px = Math.max(3, Math.min(10, Math.floor(760 / k.w)));
      const cv = h('canvas', { width: k.w * px, height: k.h * px });
      WB.zeichneKarte(cv.getContext('2d'), S.buendel, k, { px, plaetze: true, markPlaetze: p.beispiel.plaetze, fehler: p.beispiel.pruefung ? p.beispiel.pruefung.fehler : [] });
      el.appendChild(h('div', { class: 'dim' }, `Beispiel: ${p.beispiel.schablone}, Seed ${p.beispiel.seed} – Plätze mit diesem Modul rosa umrandet`));
      el.appendChild(cv);
    } else if (!p.laeuft) el.appendChild(h('div', { class: 'warn' }, 'Das Modul wurde in keinem Bau gewählt (Kanten passen nirgends, oder andere Varianten gewinnen).'));
  };

  // ---------- Schablone: Leinwand ----------
  V.schabloneGeo = function () {
    const s = S.schablone;
    if (s.decks) {
      const breite = Math.max(1, ...s.decks.map((d) => (d.plaetze || []).reduce((a, p) => a + (p.breite || 0), 0)));
      const cpx = Math.max(12, Math.min(30, Math.floor(900 / breite)));
      return { schiff: true, cpx, ox: 50, oy: 10, deckH: 96, breite };
    }
    const [CW, CH] = s.zellen || [1, 1];
    const c = Math.max(48, Math.min(96, Math.floor(820 / CW)));
    return { c, ox: 20, oy: 20, CW, CH };
  };
  function bereichFarbe(bereich) {
    const s = S.schablone;
    if (!bereich) return '#2a3242';
    const b = s.bereiche[bereich];
    if (b && WB.ROLLE_BEREICH_FARBE[b.rolle]) return WB.ROLLE_BEREICH_FARBE[b.rolle];
    const keys = Object.keys(s.bereiche).sort();
    const pal = ['#bb6bd9', '#f2c94c', '#9fd8ff', '#c2a4ff', '#f2994a', '#7fe0c2'];
    return pal[Math.max(0, keys.indexOf(bereich)) % pal.length];
  }
  function zeichnePlatzKasten(ctx, p, x, y, w, hh, sel) {
    const s = S.schablone;
    const f = bereichFarbe(p.bereich);
    ctx.fillStyle = f + '40'; ctx.fillRect(x + 2, y + 2, w - 4, hh - 4);
    if (s.gefecht.includes(p.id)) {
      ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, hh - 4); ctx.clip();
      ctx.strokeStyle = 'rgba(242,201,76,.25)'; ctx.lineWidth = 2;
      for (let d = -hh; d < w; d += 10) { ctx.beginPath(); ctx.moveTo(x + d, y + hh); ctx.lineTo(x + d + hh, y); ctx.stroke(); }
      ctx.restore();
    }
    ctx.strokeStyle = sel ? '#ffffff' : f; ctx.lineWidth = sel ? 3 : 1.5;
    ctx.strokeRect(x + 2, y + 2, w - 4, hh - 4);
    ctx.fillStyle = '#e8ecf3'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(p.id, x + 6, y + 6, w - 12);
    ctx.font = '11px system-ui'; ctx.fillStyle = '#aab3c5';
    ctx.fillText(p.typ, x + 6, y + 20, w - 12);
    const n = A.varianten(p).length;
    ctx.fillStyle = n ? '#7FE0C2' : '#ff2d55'; ctx.font = 'bold 11px system-ui';
    ctx.fillText(`${n} Var.`, x + 6, y + 34);
    const marken = [p.kern ? '★' : '', p.ankunft ? 'A↓' : '', p.eingang_art ? { laut: 'E:laut', leise: 'E:leise', technisch: 'E:techn' }[p.eingang_art] : '', p.fest ? 'fest' : ''].filter(Boolean).join(' ');
    if (marken) { ctx.fillStyle = '#f2c94c'; ctx.fillText(marken, x + 6, y + hh - 18, w - 12); }
    if (p.richtung) {
      ctx.fillStyle = '#56ccf2';
      const d = 6;
      if (p.richtung === 'N') ctx.fillRect(x + 4, y - 1, w - 8, d);
      if (p.richtung === 'S') ctx.fillRect(x + 4, y + hh - d + 1, w - 8, d);
      if (p.richtung === 'W') ctx.fillRect(x - 1, y + 4, d, hh - 8);
      if (p.richtung === 'O') ctx.fillRect(x + w - d + 1, y + 4, d, hh - 8);
    }
  }
  V.schabloneCanvas = function (geist) {
    const cv = document.getElementById('cvSchablone'); if (!cv) return;
    const s = S.schablone, g = V.schabloneGeo();
    const ctx = cv.getContext('2d');
    if (g.schiff) {
      cv.width = g.ox + g.breite * g.cpx + 20; cv.height = g.oy + s.decks.length * (g.deckH + 14) + 10;
      ctx.fillStyle = '#0d1018'; ctx.fillRect(0, 0, cv.width, cv.height);
      s.decks.forEach((d, di) => {
        const y = g.oy + di * (g.deckH + 14);
        ctx.fillStyle = '#8791a5'; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(`Deck ${di + 1}`, 4, y + g.deckH / 2);
        let x = g.ox;
        for (const p of d.plaetze) { zeichnePlatzKasten(ctx, p, x, y, p.breite * g.cpx, g.deckH, S.platzSel === p.id); x += p.breite * g.cpx; }
      });
      ctx.fillStyle = '#8791a5'; ctx.textAlign = 'right'; ctx.fillText('Heck ←   → Bug', cv.width - 6, 6);
      return;
    }
    cv.width = g.ox * 2 + g.CW * g.c; cv.height = g.oy * 2 + g.CH * g.c;
    ctx.fillStyle = '#0d1018'; ctx.fillRect(0, 0, cv.width, cv.height);
    const fz = (() => { const i = Object.values((S.buendel.kacheln || {}).zeichen || {}).find((z) => z.kind === s.fuellung); return i ? WB.KIND_FARBE[i.kind] : '#20242e'; })();
    for (let y = 0; y < g.CH; y++) for (let x = 0; x < g.CW; x++) {
      ctx.fillStyle = fz; ctx.globalAlpha = 0.5; ctx.fillRect(g.ox + x * g.c + 1, g.oy + y * g.c + 1, g.c - 2, g.c - 2); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#2a3242'; ctx.strokeRect(g.ox + x * g.c + 0.5, g.oy + y * g.c + 0.5, g.c - 1, g.c - 1);
    }
    for (const p of s.plaetze) zeichnePlatzKasten(ctx, p, g.ox + p.x * g.c, g.oy + p.y * g.c, (p.w || 1) * g.c, (p.h || 1) * g.c, S.platzSel === p.id);
    // Paare als Linien
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ff7bd5'; ctx.lineWidth = 2;
    for (const k of Object.keys(s.paare)) {
      const [a, b] = (s.paare[k] || []).map((id) => s.plaetze.find((p) => p.id === id));
      if (!a || !b) continue;
      const m = (p) => [g.ox + (p.x + (p.w || 1) / 2) * g.c, g.oy + (p.y + (p.h || 1) / 2) * g.c];
      const [ax, ay] = m(a), [bx, by] = m(b);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#ff7bd5'; ctx.font = 'bold 12px system-ui'; ctx.fillText('Paar ' + k, (ax + bx) / 2 + 4, (ay + by) / 2);
    }
    ctx.setLineDash([]);
    if (geist) {
      ctx.strokeStyle = geist.ok ? '#7FE0C2' : '#ff2d55'; ctx.lineWidth = 3;
      ctx.strokeRect(g.ox + geist.x * g.c + 3, g.oy + geist.y * g.c + 3, geist.w * g.c - 6, geist.h * g.c - 6);
    }
  };
  V.schabloneMaus = function () {
    const cv = document.getElementById('cvSchablone'); const s = S.schablone;
    const g = () => V.schabloneGeo();
    if (s.decks) {
      cv.addEventListener('mousedown', (ev) => {
        const r = cv.getBoundingClientRect(), G = g();
        const mx = ev.clientX - r.left, my = ev.clientY - r.top;
        const di = Math.floor((my - G.oy) / (G.deckH + 14));
        const d = s.decks[di]; if (!d) return;
        let x = G.ox; let hit = null;
        for (const p of d.plaetze) { if (mx >= x && mx < x + p.breite * G.cpx) hit = p; x += p.breite * G.cpx; }
        S.platzSel = hit ? hit.id : null; V.schabloneCanvas(); V.panel();
      });
      return;
    }
    let drag = null;
    const zelle = (ev) => { const r = cv.getBoundingClientRect(), G = g(); return { x: Math.floor((ev.clientX - r.left - G.ox) / G.c), y: Math.floor((ev.clientY - r.top - G.oy) / G.c) }; };
    const finde = (z) => s.plaetze.find((p) => z.x >= p.x && z.x < p.x + (p.w || 1) && z.y >= p.y && z.y < p.y + (p.h || 1));
    cv.addEventListener('mousedown', (ev) => {
      const z = zelle(ev); cv.focus();
      if (z.x < 0 || z.y < 0 || z.x >= s.zellen[0] || z.y >= s.zellen[1]) return;
      const p = finde(z);
      if (p) { S.platzSel = p.id; drag = { art: 'schieben', p, dx: z.x - p.x, dy: z.y - p.y }; V.panel(); V.schabloneCanvas(); }
      else drag = { art: 'neu', start: z };
    });
    cv.addEventListener('mousemove', (ev) => {
      if (!drag) return;
      const z = zelle(ev);
      if (drag.art === 'schieben') {
        const x = z.x - drag.dx, y = z.y - drag.dy, w = drag.p.w || 1, hh = drag.p.h || 1;
        const ok = x >= 0 && y >= 0 && x + w <= s.zellen[0] && y + hh <= s.zellen[1] && !A.platzBelegt(x, y, w, hh, drag.p.id);
        V.schabloneCanvas({ x, y, w, h: hh, ok });
      } else {
        const x = Math.min(drag.start.x, z.x), y = Math.min(drag.start.y, z.y);
        const w = Math.min(2, Math.abs(z.x - drag.start.x) + 1), hh = Math.min(2, Math.abs(z.y - drag.start.y) + 1);
        V.schabloneCanvas({ x, y, w, h: hh, ok: !A.platzBelegt(x, y, w, hh) });
      }
    });
    cv.addEventListener('mouseup', (ev) => {
      if (!drag) return;
      const z = zelle(ev), d = drag; drag = null;
      if (d.art === 'schieben') { if (z.x - d.dx !== d.p.x || z.y - d.dy !== d.p.y) { if (!A.verschiebePlatz(d.p.id, z.x - d.dx, z.y - d.dy)) V.schabloneCanvas(); } }
      else {
        const x = Math.min(d.start.x, z.x), y = Math.min(d.start.y, z.y);
        A.neuerPlatz(Math.max(0, x), Math.max(0, y), Math.min(2, Math.abs(z.x - d.start.x) + 1), Math.min(2, Math.abs(z.y - d.start.y) + 1));
      }
    });
    cv.addEventListener('keydown', (ev) => { if ((ev.key === 'Delete' || ev.key === 'Backspace') && S.platzSel) { ev.preventDefault(); A.entfernePlatz(S.platzSel); V.mitte(); } });
  };
  V.bauWerkzeug = function () {
    const s = S.schablone, b = S.buendel;
    const neu = () => { A.baueSchablone(); V.bau(); };
    return h('div', { class: 'werkzeug' },
      h('b', {}, 'Bauen '),
      h('button', { onclick: () => { S.seed = Math.max(0, S.seed - 1); V.mitte(); } }, '−'),
      zahl(S.seed, (v) => { S.seed = v | 0; neu(); }, { id: 'fSeed', style: { width: '64px' } }),
      h('button', { id: 'bSeedPlus', onclick: () => { S.seed++; V.mitte(); } }, '+'),
      feld('Bauweise', WB.auswahl([['', 'Standard']].concat(WB.achse(b, 'bauweisen')), S.bauweise, (v) => { S.bauweise = v; neu(); })),
      feld('Besitz', WB.auswahl([['', '–']].concat(WB.achse(b, 'besitz')), S.besitz, (v) => { S.besitz = v; neu(); })),
      feld('Zustand', WB.auswahl([['', 'intakt']].concat(WB.achse(b, 'zustaende')), S.zustand, (v) => { S.zustand = v; neu(); })),
      s.decks ? feld('Decks', WB.auswahl([['', 'CONFIG'], '1', '2'], S.decks || '', (v) => { S.decks = v ? Number(v) : null; neu(); })) : null,
      h('button', { id: 'bSweep', onclick: () => A.sweep(50) }, 'Sweep 1–50'),
      h('a', { href: `galerie.html?art=${s.art}&schablone=${encodeURIComponent(s.id)}&seeds=1-24${S.quelle !== 'content' ? '&quelle=' + S.quelle : ''}`, target: '_blank', title: 'nur gespeicherter Stand' }, 'Galerie ↗'));
  };
  V.bau = function () {
    const el = document.getElementById('bau'); if (!el) return;
    el.textContent = '';
    const b = S.bau; if (!b) return;
    if (b.fmt.length) el.appendChild(h('div', { class: 'box bad' }, h('b', {}, 'Format: '), b.fmt.map((f) => h('div', {}, f.msg))));
    if (b.err) { el.appendChild(h('div', { class: 'box bad' }, 'Bau abgebrochen: ' + b.err)); return; }
    const r = b.roh; if (!r) return;
    const pr = r.pruefung || { ok: false, fehler: r.fehler || [], warnungen: [] };
    el.appendChild(h('div', { class: pr.ok ? 'ok' : 'bad' }, h('b', {}, pr.ok ? `Seed ${S.seed}: bestanden` : `Seed ${S.seed}: ${pr.fehler.length} Fehler`), h('span', { class: 'dim' }, ` · ${b.ms} ms` + (r.karte ? ` · ${r.karte.w}×${r.karte.h} · Spiegel ${r.karte.spiegel || '–'} · Hash ${B.hash(r.karte)}` : ''))));
    if (r.karte) {
      const k = r.karte, px = Math.max(3, Math.min(14, Math.floor(820 / k.w)));
      const cv = h('canvas', { id: 'cvBau', width: k.w * px, height: k.h * px });
      const markiert = S.platzSel ? new Set([S.platzSel]) : null;
      WB.zeichneKarte(cv.getContext('2d'), S.buendel, k, { px, plaetze: true, platzNamen: px >= 8, markPlaetze: markiert, fehler: pr.fehler, warnungen: pr.warnungen });
      el.appendChild(cv);
      const kz = k.meta && k.meta.kennzahlen;
      if (kz) {
        const d = Object.values(kz.deckung || {}).filter((v) => v != null);
        el.appendChild(h('div', { class: 'dim' }, `Deckung min ${d.length ? Math.min(...d).toFixed(2) : '–'} · Sichtgasse ${kz.sichtgasse} · getrennte Wege ${kz.wegeGetrennt} · Engstellen ${(kz.engstellen || []).length} · Rückzug ${kz.rueckzugFrei ? 'frei' : 'nur Eingang'}`));
      }
    }
    for (const f of pr.fehler) el.appendChild(WB.fehlerZeile(f));
    for (const w of pr.warnungen || []) el.appendChild(WB.fehlerZeile(Object.assign({ warnung: true }, w)));
  };
  V.sweep = function () {
    const el = document.getElementById('sweep'); if (!el) return;
    el.textContent = '';
    const w = S.sweep; if (!w) return;
    const q = w.fertig ? Math.round(w.ok / w.fertig * 100) : 0;
    el.appendChild(h('div', { class: q >= 80 ? 'ok' : 'bad' }, h('b', {}, `Sweep: ${w.ok}/${w.fertig} bestanden (${q} %)`), w.laeuft ? ' …' : '',
      h('span', { class: 'dim' }, ' ' + Object.keys(w.codes).sort((a, b) => w.codes[b] - w.codes[a]).map((c) => `${c} ×${w.codes[c]}`).join(', '))));
    if (w.schlecht.length) el.appendChild(h('div', {}, 'Fehlseeds: ', w.schlecht.slice(0, 40).map((sd) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); S.seed = sd; V.mitte(); } }, String(sd) + ' '))));
  };

  // ======================= Seitenfeld =======================
  V.panel = function () {
    const el = document.getElementById('panel'); el.textContent = '';
    if (S.modus === 'modul' && S.modul) V.modulPanel(el);
    if (S.modus === 'schablone' && S.schablone) V.schablonePanel(el);
  };
  V.modulPanel = function (el) {
    const m = S.modul, teile = m.id.split('.');
    const variante = teile.slice(2).join('.') || 'a';
    const schiff = m.art === 'schiff';
    // Prüfung zuerst: das Wichtigste beim Bauen
    const pr = S.pruefung || { ok: false, fehler: [], warnungen: [] };
    const alleF = S.formatFehler.concat(pr.fehler);
    el.appendChild(abschnitt(alleF.length ? `Live-Prüfung: ${alleF.length} Fehler` : 'Live-Prüfung: bestanden',
      h('div', { id: 'pruefung', class: alleF.length ? 'bad' : 'ok' }),
      alleF.map((f) => WB.fehlerZeile(f, () => { S.markiert = f.x != null ? { x: f.x, y: f.y } : null; V.modulCanvas(); })),
      pr.warnungen.map((f) => WB.fehlerZeile(Object.assign({ warnung: true }, f), () => { S.markiert = f.x != null ? { x: f.x, y: f.y } : null; V.modulCanvas(); })),
      !alleF.length && !pr.warnungen.length ? h('div', { class: 'dim' }, 'Keine Fehler, keine Warnungen.') : null));
    // Palette
    if (S.ebene === 'rows') {
      const z = (S.buendel.kacheln && S.buendel.kacheln.zeichen) || {};
      el.appendChild(abschnitt('Kacheln (kacheln.json)', h('div', { class: 'palette' }, Object.keys(z).filter((c) => !z[c].nurUeberzug).map((c) =>
        h('button', { class: 'farbe' + (S.pinsel.rows === c ? ' an' : ''), 'data-zeichen': c, title: `${z[c].kind}: ${z[c].hinweis || ''}`, onclick: () => { S.pinsel.rows = c; V.panel(); } },
          h('i', { style: { background: WB.KIND_FARBE[z[c].kind] || '#f0f' } }), h('code', {}, c), ' ', z[c].kind)))));
    } else if (S.ebene === 'anker') {
      const R = (S.buendel.anker && S.buendel.anker.rollen) || {};
      const pin = S.pinsel.anker;
      const attr = (R[pin.rolle] && R[pin.rolle].attribute) || {};
      el.appendChild(abschnitt('Anker (anker.json)',
        h('div', { class: 'palette' }, h('button', { class: 'farbe' + (S.pinsel.radieren ? ' an' : ''), onclick: () => { S.pinsel.radieren = true; V.panel(); } }, '⌫ Radierer'),
          Object.keys(R).map((r) => h('button', { class: 'farbe' + (!S.pinsel.radieren && pin.rolle === r ? ' an' : ''), 'data-rolle': r, title: R[r].regel || '', onclick: () => { S.pinsel.anker = { rolle: r }; S.pinsel.radieren = false; V.panel(); } },
            h('i', { style: { background: WB.ROLLE_FARBE[r] || '#f0f', borderRadius: '50%' } }), r))),
        Object.keys(attr).length && !S.pinsel.radieren ? h('div', { class: 'attrs' }, h('div', { class: 'dim' }, `Attribute für ${pin.rolle}:`),
          Object.keys(attr).map((a) => {
            const t = attr[a];
            const setze = (v) => { if (v === '' || v === false || v == null) delete pin[a]; else pin[a] = v; V.panel(); };
            if (Array.isArray(t)) return feld(a, WB.auswahl([['', '–']].concat(t.map(String)), pin[a] == null ? '' : String(pin[a]), (v) => setze(v === '' ? '' : (typeof t[0] === 'number' ? Number(v) : v)), { 'data-attr': a }));
            if (t === 'bool') return feld(a, check(pin[a], setze, { 'data-attr': a }));
            if (t === 'buchstabe') return feld(a, text(pin[a], setze, { maxlength: 1, size: 2, 'data-attr': a }));
            return feld(a, text(pin[a], setze, { 'data-attr': a }));
          })) : null,
        h('div', { class: 'dim' }, 'Paare (raetsel) setzt meist die Schablone (paare); ankunft setzt nur die Schablone.')));
    } else {
      el.appendChild(abschnitt('Belegung (nur o/O/I auf Boden)', h('div', { class: 'palette' }, [['o', 'deckung_halb'], ['O', 'deckung_voll'], ['I', 'pfeiler'], ['.', 'leer']].map(([c, k]) =>
        h('button', { class: 'farbe' + (S.pinsel.beleg === c ? ' an' : ''), 'data-zeichen': c, onclick: () => { S.pinsel.beleg = c; V.panel(); } }, h('i', { style: { background: WB.KIND_FARBE[k] || '#3b4252' } }), h('code', {}, c), ' ', k)))));
    }
    // Anker-Legende
    const leg = m.anker_legende;
    el.appendChild(abschnitt('Anker-Legende', Object.keys(leg).length ? Object.keys(leg).map((c) => h('div', { class: 'legzeile' }, h('code', {}, c),
      text(JSON.stringify(leg[c]), (v) => { try { const o = JSON.parse(v); if (!o.rolle) throw new Error('rolle fehlt'); leg[c] = o; A.modulGeaendert(true); } catch (e) { A.meldung('Legende: ' + e.message, 'bad'); } }, { class: 'mono', size: 34 }))) : h('div', { class: 'dim' }, 'keine Anker')));
    // Datei
    el.appendChild(abschnitt('Modul',
      feld('Kartenart', WB.auswahl(ARTEN, m.art, (v) => A.setzeId(v, m.typ, variante), { id: 'mArt' })),
      feld('Typ', text(m.typ, (v) => A.setzeId(m.art, v.trim(), variante), { list: 'typListe', id: 'mTyp' })),
      h('datalist', { id: 'typListe' }, A.typen(m.art).map((t) => h('option', { value: t }))),
      feld('Variante', text(variante, (v) => A.setzeId(m.art, m.typ, v.trim()), { id: 'mVar', size: 10 })),
      schiff
        ? [feld('Breite', WB.auswahl(FMT.SCHIFF_BREITEN.map(String), String(m.groesse[0]), (v) => A.setzeGroesse(Number(v), 13))),
          feld('Deck', WB.auswahl([['', 'beide'], '1', '2'], m.deck == null ? '' : String(m.deck), (v) => { m.deck = v ? Number(v) : null; A.modulGeaendert(true); }))]
        : feld('Größe (Zellen)', WB.auswahl(['1x1', '2x1', '1x2', '2x2'], m.groesse.join('x'), (v) => { const [a, b] = v.split('x').map(Number); A.setzeGroesse(a, b); }, { id: 'mGroesse' })),
      feld('drehen', check(m.drehen !== false, (v) => { m.drehen = v; A.modulGeaendert(true); })),
      feld('spiegeln', check(!!m.spiegeln, (v) => { m.spiegeln = v; A.modulGeaendert(true); })),
      feld('gewicht', zahl(m.gewicht == null ? 1 : m.gewicht, (v) => { m.gewicht = v; A.modulGeaendert(true); }, { min: 1, style: { width: '60px' } })),
      feld('Signatur für', h('span', {}, WB.achse(S.buendel, 'bauweisen').map((bw) => h('label', {}, check((m.bauweise || []).includes(bw), (v) => {
        const l = new Set(m.bauweise || []); if (v) l.add(bw); else l.delete(bw); m.bauweise = l.size ? Array.from(l).sort() : null; A.modulGeaendert(true);
      }), ' ' + bw + ' '))), 'leer = neutral (für alle Bauweisen)'),
      feld('Hinweis', text(m.hinweis, (v) => { if (v) m.hinweis = v; else delete m.hinweis; A.modulGeaendert(true); }))));
    V.jsonAbschnitt(el);
  };
  V.jsonAbschnitt = function (el) {
    const ta = h('textarea', { id: 'jsonText', spellcheck: 'false', rows: 14 });
    ta.value = FMT.alsText(A.inhalt());
    el.appendChild(abschnitt('JSON', ta, h('div', { class: 'knoepfe' }, h('button', { onclick: () => A.json(ta.value) }, 'JSON übernehmen'))));
  };
  V.schablonePanel = function (el) {
    const s = S.schablone;
    const p = S.platzSel ? A.platz(S.platzSel) : null;
    const ids = platzListe(s).map((q) => q.id);
    const fmt = FMT.pruefeSchablone(s);
    if (fmt.length) el.appendChild(abschnitt(`Format: ${fmt.length} Fehler`, fmt.map((f) => WB.fehlerZeile(f))));
    if (p) {
      const varianten = A.varianten(p);
      const bereiche = [['', '–']].concat(Object.keys(s.bereiche).sort());
      el.appendChild(abschnitt(`Platz ${p.id}`,
        feld('id', text(p.id, (v) => A.umbenennePlatz(p.id, v.trim()), { id: 'pId' })),
        feld('Typ', text(p.typ, (v) => A.setzePlatzFeld(p.id, 'typ', v.trim()), { list: 'typListe2', id: 'pTyp' })),
        h('datalist', { id: 'typListe2' }, A.typen(s.art).map((t) => h('option', { value: t }))),
        s.decks
          ? [feld('Breite', WB.auswahl(FMT.SCHIFF_BREITEN.map(String), String(p.breite), (v) => A.setzePlatzFeld(p.id, 'breite', Number(v)))),
            feld('fest', check(p.fest, (v) => A.setzePlatzFeld(p.id, 'fest', v)), 'feste Sektion: nicht gespiegelt')]
          : [feld('Breite', WB.auswahl(['1', '2'], String(p.w || 1), (v) => A.setzePlatzFeld(p.id, 'w', Number(v)))),
            feld('Höhe', WB.auswahl(['1', '2'], String(p.h || 1), (v) => A.setzePlatzFeld(p.id, 'h', Number(v)))),
            feld('richtung', WB.auswahl([['', '–']].concat(FMT.SEITEN), p.richtung || '', (v) => A.setzePlatzFeld(p.id, 'richtung', v), { id: 'pRichtung' }), 'Außenkante des Moduls zeigt hierhin')],
        feld('Bereich', WB.auswahl(bereiche, p.bereich || '', (v) => A.setzePlatzFeld(p.id, 'bereich', v), { id: 'pBereich' })),
        feld('eingang_art', WB.auswahl([['', '– (Modul)']].concat(FMT.EINGANG_ARTEN), p.eingang_art || '', (v) => A.setzePlatzFeld(p.id, 'eingang_art', v), { id: 'pEingang' })),
        feld('kern', check(p.kern, (v) => A.setzePlatzFeld(p.id, 'kern', v))),
        feld('ankunft', check(p.ankunft, (v) => A.setzePlatzFeld(p.id, 'ankunft', v), { id: 'pAnkunft' }), 'genau ein Platz je Schablone'),
        feld('Gefecht', check(s.gefecht.includes(p.id), (v) => A.setzePlatzFeld(p.id, 'gefecht', v), { id: 'pGefecht' })),
        h('div', { class: varianten.length ? 'dim' : 'bad' }, `${varianten.length} passende Module: `, varianten.map((m) => h('a', { href: `?modul=${encodeURIComponent(m.id)}${S.quelle !== 'content' ? '&quelle=' + S.quelle : ''}`, target: '_blank' }, m.id.split('.').pop() + ' '))),
        h('div', { class: 'knoepfe' },
          s.decks ? [h('button', { onclick: () => A.schiffVerschiebe(p.id, -1) }, '◀'), h('button', { onclick: () => A.schiffVerschiebe(p.id, 1) }, '▶')] : null,
          h('button', { onclick: () => { A.entfernePlatz(p.id); V.mitte(); } }, 'Platz löschen'))));
    } else el.appendChild(abschnitt('Platz', h('div', { class: 'dim' }, s.decks ? 'Platz anklicken.' : 'Platz anklicken oder auf freien Zellen einen neuen aufziehen (1–2 Zellen).')));
    if (s.decks) el.appendChild(h('div', { class: 'knoepfe' }, s.decks.map((_, i) => h('button', { onclick: () => A.schiffPlatzNeu(i) }, `+ Platz Deck ${i + 1}`))));
    // Schablone
    const fuellungen = Object.values((S.buendel.kacheln && S.buendel.kacheln.zeichen) || {}).filter((z) => z.solid === true && !z.nurUeberzug).map((z) => z.kind).concat(A.typen(s.art));
    el.appendChild(abschnitt('Schablone',
      feld('Name (id)', text(s.id.split('.').slice(1).join('.'), (v) => { s.id = `${s.art}.${v.trim()}`; A.schabloneGeaendert(); V.kopf(); }, { id: 'sId' })),
      feld('Titel', text(s.name, (v) => { s.name = v; A.schabloneGeaendert(); })),
      feld('Hinweis', text(s.hinweis, (v) => { if (v) s.hinweis = v; else delete s.hinweis; A.schabloneGeaendert(); })),
      s.decks ? null : feld('Zellen', h('span', {}, zahl(s.zellen[0], (v) => { s.zellen = [Math.max(1, v), s.zellen[1]]; A.schabloneGeaendert(); V.mitte(); }, { style: { width: '52px' } }), ' × ',
        zahl(s.zellen[1], (v) => { s.zellen = [s.zellen[0], Math.max(1, v)]; A.schabloneGeaendert(); V.mitte(); }, { style: { width: '52px' } }))),
      feld('spiegeln', h('span', {}, (s.decks ? ['y'] : ['x', 'y']).map((ax) => h('label', {}, check((s.spiegeln || []).includes(ax), (v) => {
        const l = new Set(s.spiegeln || []); if (v) l.add(ax); else l.delete(ax); s.spiegeln = Array.from(l).sort(); A.schabloneGeaendert();
      }), ' ' + ax + ' ')))),
      feld('Füllung', WB.auswahl(Array.from(new Set(fuellungen)), s.fuellung, (v) => { s.fuellung = v; A.schabloneGeaendert(); }), 'Kachelart oder Füllmodul-Typ für freie Zellen')));
    // Bereiche
    el.appendChild(abschnitt('Bereiche', Object.keys(s.bereiche).sort().map((k) => h('div', { class: 'reihe' },
      h('i', { class: 'punkt', style: { background: bereichFarbe(k) } }), h('code', {}, k),
      text(s.bereiche[k].name, (v) => { s.bereiche[k].name = v; A.schabloneGeaendert(); }, { size: 12 }),
      WB.auswahl([['', '–'], 'hinein', 'ziel', 'rueckzug'], s.bereiche[k].rolle || '', (v) => { s.bereiche[k].rolle = v || null; A.schabloneGeaendert(); }),
      h('button', { onclick: () => { delete s.bereiche[k]; for (const q of platzListe(s)) if (q.bereich === k) q.bereich = null; A.schabloneGeaendert(); } }, '×'))),
    h('div', { class: 'reihe' }, text('', (v) => { v = v.trim(); if (/^[a-z0-9_]+$/.test(v) && !s.bereiche[v]) { s.bereiche[v] = { name: v, rolle: null }; A.schabloneGeaendert(); } }, { placeholder: '+ Bereich (id, Enter)', size: 18 }))));
    // Paare
    const platzWahl = (wert, cb) => WB.auswahl([['', '–']].concat(ids), wert || '', cb);
    el.appendChild(abschnitt('Rätselpaare (paare)', Object.keys(s.paare).sort().map((k) => h('div', { class: 'reihe' }, h('code', {}, k),
      platzWahl(s.paare[k][0], (v) => { s.paare[k][0] = v; A.schabloneGeaendert(); }), platzWahl(s.paare[k][1], (v) => { s.paare[k][1] = v; A.schabloneGeaendert(); }),
      h('button', { onclick: () => { delete s.paare[k]; A.schabloneGeaendert(); } }, '×'))),
    h('button', { onclick: () => { const k = 'ABCDEFGH'.split('').find((c) => !s.paare[c]); if (k) { s.paare[k] = ['', '']; A.schabloneGeaendert(); } } }, '+ Paar')));
    // feste Kanten
    if (!s.decks) el.appendChild(abschnitt('Feste Kanten', s.kanten_fest.map((k, i) => h('div', { class: 'reihe' },
      platzWahl(k.a, (v) => { k.a = v; A.schabloneGeaendert(); }), platzWahl(k.b, (v) => { k.b = v; A.schabloneGeaendert(); }),
      WB.auswahl(FMT.KANTEN_TYPEN, k.typ, (v) => { k.typ = v; A.schabloneGeaendert(); }),
      h('button', { onclick: () => { s.kanten_fest.splice(i, 1); A.schabloneGeaendert(); } }, '×'))),
    h('button', { onclick: () => { s.kanten_fest.push({ a: ids[0] || '', b: ids[1] || '', typ: 'tuer' }); A.schabloneGeaendert(); } }, '+ Kante')));
    // Pflicht
    el.appendChild(abschnitt('Pflichtsatz (pflicht)', h('div', { class: 'pflicht' }, rollen().map((r) => h('label', {}, h('span', {}, r),
      zahl(s.pflicht[r] == null ? '' : s.pflicht[r], (v) => { if (!v) delete s.pflicht[r]; else s.pflicht[r] = v; A.schabloneGeaendert(); }, { min: 0, style: { width: '48px' } }))))));
    V.jsonAbschnitt(el);
  };

  // ======================= Start =======================
  async function start() {
    const q = new URLSearchParams(location.search);
    try { await A.laden(q.get('quelle') || 'content'); } catch (e) {
      document.getElementById('mitte').appendChild(h('div', { class: 'box bad' }, e.message));
      return;
    }
    const modulId = q.get('modul'), schId = q.get('schablone');
    if (schId) {
      const s = A.schablonen().find((x) => x.id === schId);
      if (s) { A.oeffneSchablone(s, q.get('seed') ? Number(q.get('seed')) : 1); } else { A.neueSchablone(); A.meldung(`Schablone ${schId} nicht gefunden`, 'bad'); }
    } else if (modulId) {
      const m = A.module().find((x) => x.id === modulId);
      if (m) A.oeffneModul(m); else { A.neuesModul(); A.meldung(`Modul ${modulId} nicht gefunden`, 'bad'); }
    } else {
      S.art = ARTEN.includes(q.get('art')) ? q.get('art') : 'ruine';
      A.neuesModul(S.art);
    }
    if (!S.speichernMoeglich) A.meldung('Nur lesen: Server ohne WERKSTATT=1 – Speichern aus, Download geht.', 'warn');
    window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
    window.__werkstattBereit = true;
  }
  window.Werkstatt = { S, A, V };
  start();
})();
