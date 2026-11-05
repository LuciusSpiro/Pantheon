(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GenSchiff = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // SCH-01 P0 (Spike): prozeduraler Schiffsgenerator im Modulraster des Prüfers (13 Zeilen je Deck, Deck-Abstand 16, Längsgang auf Zeile 6).
  // Längsachse Heck (Antrieb) -> Mittschiffs (Sektionen mit Gang + je Seite Räume) -> Bug (Brücke, Hüllenprofil verjüngt).
  // Ausgabe wie GenStation.karteRoh: Rohkarte für Buehne.ausRaster. Räume sind in P0 grob (Grammatik: P1).
  const HD = 13, STRIDE = 16, GANG = 6;
  function erzeuger() {
    function rng(seed) {   // mulberry32 wie gen-station
      let a = seed >>> 0;
      const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      return { f, int: (n) => Math.floor(f() * n), range: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)), shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; } };
    }
    // Sektionen: Heck, 3..5 Mittschiffs, Bug. Breiten so, dass die Länge höchstens ~74 bleibt.
    function sektionen(R, opts) {
      const heck = 10, bug = 12;
      const n = opts.sektionen || R.range(3, 5);
      const ws = []; for (let i = 0; i < n; i++) ws.push(R.range(8, 11));
      const sek = []; let x = 0;
      sek.push({ art: 'heck', x0: 0, w: heck }); x = heck;
      ws.forEach((w) => { sek.push({ art: 'mitte', x0: x, w }); x += w; });
      sek.push({ art: 'bug', x0: x, w: bug }); x += bug;
      return { sek, W: x };
    }
    // Hüllenhalbhöhe je Spalte (Innenraum Zeile GANG-hw .. GANG+hw)
    function halbhoehe(x, W) {
      if (x < 1 || x > W - 2) return -1;
      if (x === 1) return 3;
      if (x === 2) return 4;
      const bugAb = W - 12;
      if (x >= bugAb) { const t = (x - bugAb) / 11; return Math.max(1, 5 - Math.floor(t * 4.99)); }
      return 5;
    }
    function bauen(seed, opts) {
      const R = rng(seed);
      const { sek, W } = sektionen(R, opts);
      const decks = [];
      const raeume = [];   // { deck, sek, typ, x0,x1,y0,y1 (global, inklusiv) }
      const tueren = [];
      for (let d = 0; d < 2; d++) {
        const oy = d * STRIDE;
        const g = Array.from({ length: HD }, () => Array(W).fill('_'));
        const innen = Array.from({ length: HD }, () => Array(W).fill(false));
        for (let x = 0; x < W; x++) { const hw = halbhoehe(x, W); for (let y = GANG - hw; hw >= 0 && y <= GANG + hw; y++) { innen[y][x] = true; g[y][x] = '.'; } }
        for (let x = 0; x < W; x++) if (innen[GANG][x]) g[GANG][x] = ',';
        // Hülle: jede Außenkachel neben dem Innenraum (8er-Nachbarschaft) ist Wand
        for (let y = 0; y < HD; y++) for (let x = 0; x < W; x++) {
          if (innen[y][x]) continue;
          let nah = false;
          for (let dy = -1; dy <= 1 && !nah; dy++) for (let dx = -1; dx <= 1; dx++) if (innen[y + dy] && innen[y + dy][x + dx]) { nah = true; break; }
          if (nah) g[y][x] = '#';
        }
        // Schotts an den Sektionsgrenzen (Zeile GANG), Spante dazwischen
        sek.forEach((s, i) => {
          if (i === 0) return;
          for (let y = 0; y < HD; y++) if (innen[y][s.x0]) g[y][s.x0] = '#';
          g[GANG][s.x0] = 'S';
        });
        sek.forEach((s, i) => {
          const x0 = s.x0 + (i === 0 ? 1 : 1), x1 = s.x0 + s.w - 1;   // nutzbare Spalten (Heck: Spalte 0 ist Hüllenwand)
          if (s.art === 'mitte') {
            for (let x = x0; x <= x1; x++) { g[GANG - 1][x] = '#'; g[GANG + 1][x] = '#'; }
            for (const seite of ['o', 'u']) {
              const y0 = seite === 'o' ? 1 : GANG + 2, y1 = seite === 'o' ? GANG - 2 : HD - 2;
              const nutz = x1 - x0 + 1;
              const teile = nutz >= 9 && R.f() < 0.6 ? 2 : 1;
              const grenzen = teile === 2 ? [x0, x0 + Math.floor(nutz / 2) - 1, x0 + Math.floor(nutz / 2) + 1, x1] : [x0, x1];
              // bei 2 Räumen: Trennwand in Spalte x0 + floor(nutz/2)
              const rs = teile === 2 ? [[grenzen[0], grenzen[1]], [grenzen[2], grenzen[3]]] : [[x0, x1]];
              if (teile === 2) for (let y = y0; y <= y1; y++) g[y][x0 + Math.floor(nutz / 2)] = '#';
              for (const [a, b] of rs) {
                const m = Math.floor((a + b) / 2) - 0;
                const ty = seite === 'o' ? GANG - 1 : GANG + 1;
                g[ty][m] = 'D'; g[ty][m + 1] = 'D'; tueren.push([m, ty + oy], [m + 1, ty + oy]);
                raeume.push({ deck: d, sek: i, seite, typ: null, x0: a, x1: b, y0, y1, gx: m });
              }
            }
          } else {
            raeume.push({ deck: d, sek: i, seite: 'm', typ: s.art === 'heck' ? 'antrieb' : 'bruecke', x0: Math.max(x0, s.art === 'heck' ? 3 : x0), x1: s.art === 'bug' ? Math.min(x1, W - 5) : x1, y0: s.art === 'bug' ? GANG - 3 : 1, y1: s.art === 'bug' ? GANG + 3 : HD - 2, gx: -1 });
          }
        });
        decks.push(g);
      }
      return { R, sek, W, decks, raeume, tueren };
    }

    const RAUMTITEL = { antrieb: 'Antrieb', bruecke: 'Brücke', schleuse: 'Schleuse', lager: 'Laderaum', quartier: 'Quartiere', zellen: 'Zellen', messe: 'Messe' };
    // karteRoh(seed, opts) -> Rohkarte für Buehne.ausRaster (Kartenart 'schiff', Schablone 'gen-schiff')
    function karteRoh(seed, opts) {
      opts = opts || {};
      const S = bauen(seed, opts), W = S.W, H = STRIDE + HD, R2 = rng(seed * 7919 + 13);
      const grid = [];
      for (let y = 0; y < H; y++) grid.push(y < HD ? S.decks[0][y].slice() : y >= STRIDE ? S.decks[1][y - STRIDE].slice() : Array(W).fill('_'));
      const at = (x, y) => (grid[y] || [])[x];
      // Raumtypen je Deck in Reihenfolge (x, dann Seite): Schleuse, Lager, Quartier, Lager, Zellen, Messe, ... (versetzt je Deck)
      const folge = ['schleuse', 'lager', 'quartier', 'lager', 'zellen', 'messe', 'lager', 'quartier'];
      for (let d = 0; d < 2; d++) {
        const rs = S.raeume.filter((r) => r.deck === d && r.typ == null).sort((a, b) => a.x0 - b.x0 || (a.seite < b.seite ? -1 : 1));
        rs.forEach((r, i) => { r.typ = d === 0 ? folge[i % folge.length] : (i === 0 ? 'lager' : folge[(i + 1) % folge.length]); });
        // deck 2: mindestens eine Zelle sicherstellen, Schleuse nur auf Deck 1
        if (d === 1) { rs.forEach((r) => { if (r.typ === 'schleuse') r.typ = 'messe'; }); }
      }
      // Plätze: eine je Sektion und Deck (volle Deckhöhe, Längsgang zwischen den Sektionen)
      const plaetze = {};
      const pid = (d, i) => 'sek' + (i + 1) + '_d' + (d + 1);
      for (let d = 0; d < 2; d++) S.sek.forEach((s, i) => {
        const art = s.art;
        plaetze[pid(d, i)] = { typ: art === 'heck' ? 'antrieb' : art === 'bug' ? 'bruecke' : 'sektion', modul: 'gen-schiff', lage: { rot: 0, spiegel: false, aussen: null }, rect: [s.x0, d * STRIDE, s.w, HD], bereich: art === 'mitte' ? 'gang_d' + (d + 1) : 'kern_d' + (d + 1), deck: d + 1, ...(art === 'mitte' ? { gefecht: true } : { kern: true }) };
      });
      const bereiche = {};
      for (let d = 1; d <= 2; d++) { bereiche['gang_d' + d] = { name: 'Längsgang Deck ' + d, rects: [], gefecht: true }; bereiche['kern_d' + d] = { name: 'Heck und Bug Deck ' + d, rects: [], rolle: 'ziel' }; }
      for (const id of Object.keys(plaetze).sort()) bereiche[plaetze[id].bereich].rects.push(plaetze[id].rect);
      // Anker
      const roh = [], belegt = new Set();
      const key = (x, y) => x + ',' + y;
      const nahTuer = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = at(x + dx, y + dy); if (c === 'D' || c === 'S') return true; } return false; };
      const sekVon = (x) => { let k = 0; S.sek.forEach((s, i) => { if (x >= s.x0) k = i; }); return k; };
      const ank = (d, rolle, x, y, attr) => { const i = sekVon(x); const p = pid(d, i); roh.push(Object.assign({ rolle, x, y: y + d * STRIDE, platz: p, bereich: plaetze[p].bereich, deck: d + 1 }, attr || {})); belegt.add(key(x, y + d * STRIDE)); };
      const kachel = (d, r, wohin) => {   // freie Bodenkachel '.' im Raum (rand: an der Wand, innen: nicht am Rand)
        const c = [];
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
          if (at(x, y + d * STRIDE) !== '.' || belegt.has(key(x, y + d * STRIDE)) || nahTuer(x, y + d * STRIDE)) continue;
          const rand = x === r.x0 || y === r.y0 || x === r.x1 || y === r.y1;
          if (wohin === 'rand' ? rand : !rand) c.push([x, y]);
        }
        return c.length ? c[R2.int(c.length)] : null;
      };
      const raeumeD = (d) => S.raeume.filter((r) => r.deck === d);
      const heck = (d) => raeumeD(d).find((r) => r.typ === 'antrieb'), bug = (d) => raeumeD(d).find((r) => r.typ === 'bruecke');
      const mitte = (d) => raeumeD(d).filter((r) => r.seite !== 'm').sort((a, b) => a.x0 - b.x0 || (a.seite < b.seite ? -1 : 1));
      // Lift (in einem Mittschiffsraum) und Leiter (im Heck), auf beiden Decks an derselben Stelle
      const links = [];
      {
        const mr = mitte(0)[2] || mitte(0)[0];
        const pos = (r, wo) => { const c = []; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (at(x, y) === '.' && at(x, y + STRIDE) === '.' && !nahTuer(x, y) && !nahTuer(x, y + STRIDE) && (wo !== 'innen' || (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1))) c.push([x, y]); return c.length ? c[R2.int(c.length)] : null; };
        const l1 = pos(mr, 'innen') || pos(mr, 'rand'), l2 = pos(heck(0), 'innen') || pos(heck(0), 'rand');
        for (const [rolle, p] of [['lift', l1], ['leiter', l2]]) {
          if (!p) throw new Error('gen-schiff: kein Platz für ' + rolle);
          ank(0, rolle, p[0], p[1]); ank(1, rolle, p[0], p[1]);
          links.push({ a: [p[0], p[1]], b: [p[0], p[1] + STRIDE], via: rolle });
        }
      }
      // Antrieb: Sprengpunkt (Deck 1); Brücke: 2 Ziele + 2 Terminals (Deck 2 Ziele, je Deck ein Terminal)
      ank(0, 'sprengpunkt', ...kachel(0, heck(0), 'rand'));
      ank(1, 'ziel', ...kachel(1, bug(1), 'innen')); ank(1, 'ziel', ...kachel(1, bug(1), 'rand'));
      ank(0, 'terminal', ...kachel(0, bug(0), 'rand')); ank(1, 'terminal', ...kachel(1, bug(1), 'rand'));
      // Raumtypen
      for (let d = 0; d < 2; d++) for (const r of mitte(d)) {
        if (r.typ === 'lager') { const p = kachel(d, r, 'rand'); if (p) ank(d, 'beute', p[0], p[1]); }
        if (r.typ === 'quartier') { const p = kachel(d, r, 'innen') || kachel(d, r, 'rand'); if (p) ank(d, 'nsc', p[0], p[1]); }
        if (r.typ === 'zellen') { const p = kachel(d, r, 'rand'); if (p) ank(d, 'zelle', p[0], p[1]); }
      }
      // Ankunft und zweiter Abholpunkt: L-Pad (3 freie Kacheln) in der Schleuse (Deck 1) und in der Messe/Lager (Deck 2)
      const pad = (d, r) => {
        const fr = (x, y) => at(x, y + d * STRIDE) === '.' && !belegt.has(key(x, y + d * STRIDE)) && !nahTuer(x, y + d * STRIDE);
        const c = [];
        for (let y = r.y0 + 1; y < r.y1; y++) for (let x = r.x0 + 1; x < r.x1; x++) if (fr(x, y) && [[1, 1], [-1, 1], [1, -1], [-1, -1]].some(([dx, dy]) => fr(x + dx, y) && fr(x, y + dy))) c.push([x, y]);
        return c.length ? c[R2.int(c.length)] : null;
      };
      {
        const kand0 = mitte(0).filter((r) => r.typ === 'schleuse').concat(mitte(0)); let p0 = null, r0 = null;
        for (const r of kand0) { p0 = pad(0, r); if (p0) { r0 = r; break; } }
        if (!p0) throw new Error('gen-schiff: kein Platz für die Ankunft');
        ank(0, 'abholpunkt', p0[0], p0[1], { ankunft: true });
        let p1 = null;
        for (const r of mitte(1).filter((q) => q.typ === 'messe' || q.typ === 'lager').concat(mitte(1))) { p1 = pad(1, r); if (p1) break; }
        if (!p1) throw new Error('gen-schiff: kein Platz für den zweiten Abholpunkt');
        ank(1, 'abholpunkt', p1[0], p1[1]);
      }
      // Eingänge: zwei Hüllentüren an Mittschiffsräumen (Deck 1: oben und unten), Tür in der Außenwand
      {
        const o = mitte(0).find((r) => r.seite === 'o'), u = mitte(0).slice().reverse().find((r) => r.seite === 'u');
        for (const [r, wy, art] of [[o, 0, 'laut'], [u, HD - 1, 'technisch']]) {
          const x = Math.floor((r.x0 + r.x1) / 2);
          grid[wy][x] = 'D'; ank(0, 'eingang', x, wy, { art });
        }
      }
      // Wachen: Längsgang (Mittschiffs), reihum beide Decks
      {
        const c = [];
        for (let d = 0; d < 2; d++) for (const s of S.sek.filter((q) => q.art === 'mitte')) for (let x = s.x0 + 1; x < s.x0 + s.w; x++) if (at(x, GANG + d * STRIDE) === ',') c.push([d, x]);
        R2.shuffle(c);
        let n = 0; const je = [0, 0];
        for (const [d, x] of c) { if (n >= 4) break; if (je[d] >= 2) continue; if ([...belegt].some((b) => { const [bx, by] = b.split(',').map(Number); return by === GANG + d * STRIDE && Math.abs(bx - x) < 3; })) continue; ank(d, 'wache', x, GANG); je[d]++; n++; }
      }
      roh.sort((a, b) => (a.platz < b.platz ? -1 : a.platz > b.platz ? 1 : 0) || (a.rolle < b.rolle ? -1 : a.rolle > b.rolle ? 1 : 0) || a.y - b.y || a.x - b.x);
      const zz = {}; for (const a of roh) { const k = a.platz + '.' + a.rolle; zz[k] = (zz[k] || 0) + 1; }
      const lauf = {}; const anker = [];
      for (const a of roh) { const k = a.platz + '.' + a.rolle; lauf[k] = (lauf[k] || 0) + 1; anker.push(Object.assign({ id: zz[k] > 1 ? k + '.' + lauf[k] : k }, a)); }
      const pflicht = { eingang: 2, abholpunkt: 2, sprengpunkt: 1, ziel: 2, terminal: 2, zelle: 1, beute: 3, nsc: 1, wache: 4, lift: 1, leiter: 1 };
      const titel = {}; for (const id of Object.keys(plaetze)) titel[id] = plaetze[id].typ === 'antrieb' ? RAUMTITEL.antrieb : plaetze[id].typ === 'bruecke' ? RAUMTITEL.bruecke : 'Mittschiffs';
      return {
        id: opts.id || null, erzeuger: 'gen-schiff/1', art: 'schiff', bauweise: opts.bauweise || 'germanen', besitz: opts.besitz || null,
        zustand: opts.zustand || 'intakt', seed, bauversion: 'gschiff1', schablone: 'gen-schiff', spiegel: null, w: W, h: H, rows: grid.map((r) => r.join('')), legende: null, anker,
        bereiche, plaetze, eingaenge: anker.filter((a) => a.rolle === 'eingang').map((a) => a.id), abholpunkte: anker.filter((a) => a.rolle === 'abholpunkt').map((a) => a.id),
        ankunft: (anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft) || {}).id || null,
        patrouillen: [], coverSpots: [], decks: { stride: STRIDE, links }, kanten: {}, zustaende: {}, gelaende: null,
        meta: { versuche: 1, kennzahlen: null, linear: false, pflicht, zellen: null, schiffDecks: 2, schottStart: 'offen', huelle: true, raeume: S.raeume.length, titel },
      };
    }
    return { bauen, karteRoh, HD, STRIDE };
  }
  return { erzeuger };
});
