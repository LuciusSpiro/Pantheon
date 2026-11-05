(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GenSchiff = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const Buehne = require('./buehne.js');   // nur Node: ankerIdsVergeben (neutrale Ids verborgener Fallen); der Erzeuger läuft nur auf dem Server und in den Werkzeugen
  // SCH-01 P1: prozeduraler Schiffsgenerator im Modulraster des Prüfers (13 Zeilen je Deck, Deck-Abstand 16, Längsgang auf Zeile 6).
  // Längsachse Heck -> Mittschiffs (3..5 Sektionen, je Seite des Längsgangs 1..2 Räume) -> Bug.
  //   Deck 1 (Wohn/Lager): Heck Antrieb, Räume Schleuse/Lager/Quartier/Zellen/Messe, Bug Brücke.
  //   Deck 2 (Technik):     Heck Reaktor, Räume Transferkammer/Waffenkammer/Lager/Messe, Bug Batteriedeck.
  // layout 'schiff' (Standard): Hülle verjüngt am Heck und zum Bug. layout 'rechteck' (Rom): Rechteck, spiegelsymmetrisch in der Längsachse,
  // gleiche Sektionsbreiten, spiegelsymmetrische Raumfolge. zustand: intakt | verfallen | umkaempft (Überzug aus Trümmern, Hüllenlöchern, Barrikaden).
  // SCH-01 P5: 2..4 Fallen je Karte (Anker der Rolle falle: schott, druck, schuss; umkaempft 2), eigener RNG-Strom, nicht in meta.pflicht; Regeln am Block "Fallen" in karteRoh.
  // Ausgabe wie GenStation.karteRoh: Rohkarte für Buehne.ausRaster. Wirft Error('gen-schiff: …'), wenn nirgends Platz ist (Aufrufer versucht Seed+1).
  const HD = 13, STRIDE = 16, GANG = 6, MAXLAENGE = 74;
  const TUEREN = 'DSLG';
  const WACHEN = { intakt: 5, verfallen: 4, umkaempft: 7 };
  const PFLICHT = { eingang: 2, abholpunkt: 2, sprengpunkt: 1, ziel: 3, terminal: 2, zelle: 1, beute: 3, nsc: 1, wache: 4, lift: 1, leiter: 1 };
  const RAUMTITEL = { antrieb: 'Antrieb', reaktor: 'Reaktor', bruecke: 'Brücke', batteriedeck: 'Batteriedeck', schleuse: 'Schleuse', lager: 'Laderaum', quartier: 'Quartiere', zellen: 'Zellen', messe: 'Messe', waffenkammer: 'Waffenkammer', transferkammer: 'Transferkammer' };
  // Raumbedarf je Deck (Typ, Mindestzahl) in Rangfolge, danach Füllung
  const BEDARF = [[['schleuse', 1], ['zellen', 1], ['lager', 2], ['quartier', 1], ['messe', 1]], [['transferkammer', 1], ['waffenkammer', 1], ['lager', 1], ['messe', 1]]];
  const FUELL = [['lager', 'quartier', 'messe', 'lager', 'quartier'], ['lager', 'waffenkammer', 'messe', 'lager']];

  function erzeuger() {
    function rng(seed) {   // mulberry32 wie gen-station
      let a = seed >>> 0;
      const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      return { f, int: (n) => Math.floor(f() * n), range: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)), pick: (a2) => a2[Math.floor(f() * a2.length)], shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; } };
    }
    // Sektionen: Heck, 3..5 Mittschiffs, Bug. Länge höchstens MAXLAENGE; rechteck: Breiten palindromisch, Heck 10 / Bug 11 (Schottspalten spiegeln sich)
    function sektionen(R, opts, layout) {
      const heck = 10, bug = layout === 'rechteck' ? 11 : 12;
      let n = opts.sektionen | 0; if (n < 3 || n > 5) n = R.range(3, 5);
      let ws = [];
      if (layout === 'rechteck') {
        const h = []; for (let i = 0; i < Math.floor(n / 2); i++) h.push(R.range(8, 11));
        ws = h.concat(n % 2 ? [9 + 2 * R.int(2)] : [], h.slice().reverse());   // Mittelsektion ungerade: Breite W gerade, Türpaar der Mitte spiegelt auf sich selbst
      } else for (let i = 0; i < n; i++) ws.push(R.range(8, 11));
      const summe = () => heck + bug + ws.reduce((a, b) => a + b, 0);
      while (summe() > MAXLAENGE) {
        if (layout === 'rechteck') {
          const c = n % 2 ? (n - 1) / 2 : -1;
          if (c >= 0 && ws[c] > 9) { ws[c] -= 2; continue; }
          let bi = -1; for (let i = 0; i < Math.floor(n / 2); i++) if (ws[i] > 8 && (bi < 0 || ws[i] > ws[bi])) bi = i;
          if (bi < 0) break;
          ws[bi]--; ws[n - 1 - bi]--;
        } else { let bi = 0; ws.forEach((w, i) => { if (w > ws[bi]) bi = i; }); if (ws[bi] <= 8) break; ws[bi]--; }
      }
      const sek = []; let x = 0;
      sek.push({ art: 'heck', x0: 0, w: heck }); x = heck;
      ws.forEach((w) => { sek.push({ art: 'mitte', x0: x, w }); x += w; });
      sek.push({ art: 'bug', x0: x, w: bug }); x += bug;
      return { sek, W: x };
    }
    // Hüllenhalbhöhe je Spalte (Innenraum Zeile GANG-hw .. GANG+hw); rechteck: überall voll
    function halbhoehe(x, W, layout) {
      if (x < 1 || x > W - 2) return -1;
      if (layout === 'rechteck') return 5;
      if (x === 1) return 3;
      if (x === 2) return 4;
      const bugAb = W - 12;
      if (x >= bugAb) { const t = (x - bugAb) / 11; return Math.max(1, 5 - Math.floor(t * 4.99)); }
      return 5;
    }
    function bauen(seed, opts) {
      opts = opts || {};
      const R = rng(seed);
      const layout = opts.layout === 'rechteck' ? 'rechteck' : 'schiff';
      const { sek, W } = sektionen(R, opts, layout);
      const H = STRIDE + HD;
      const g = Array.from({ length: H }, () => Array(W).fill('_'));
      const raeume = [];   // { deck, sek, typ, seite, x0,x1,y0,y1 (Deck-lokal y, x global, inklusiv), gx (Türspalte links) }
      const mitten = sek.map((s, i) => (s.art === 'mitte' ? i : -1)).filter((i) => i >= 0);
      // rechteck: Raumteilung einmal für beide Decks und Seiten; rechte Hälfte = Spiegelbild der linken
      const teilung = {};
      const intervalle = (i) => { const s = sek[i]; const x0 = s.x0 + 1, x1 = s.x0 + s.w - 1, nutz = x1 - x0 + 1; return { x0, x1, nutz }; };
      if (layout === 'rechteck') {
        const n = mitten.length;
        for (let k = 0; k < Math.ceil(n / 2); k++) {
          const i = mitten[k], { x0, x1, nutz } = intervalle(i);
          const mittig = n % 2 === 1 && k === (n - 1) / 2;
          const zwei = !mittig && nutz >= 9 && R.f() < 0.6;
          const wc = x0 + Math.floor(nutz / 2);
          teilung[i] = zwei ? [[x0, wc - 1], [wc + 1, x1]] : [[x0, x1]];
        }
        for (let k = Math.ceil(n / 2); k < n; k++) {
          const i = mitten[k], j = mitten[n - 1 - k];
          teilung[i] = teilung[j].map(([a, b]) => [W - 1 - b, W - 1 - a]).reverse();
        }
      }
      for (let d = 0; d < 2; d++) {
        const oy = d * STRIDE;
        const innen = Array.from({ length: HD }, () => Array(W).fill(false));
        for (let x = 0; x < W; x++) { const hw = halbhoehe(x, W, layout); for (let y = GANG - hw; hw >= 0 && y <= GANG + hw; y++) { innen[y][x] = true; g[oy + y][x] = '.'; } }
        for (let x = 0; x < W; x++) if (innen[GANG][x]) g[oy + GANG][x] = ',';
        // Hülle: jede Außenkachel neben dem Innenraum (8er-Nachbarschaft) ist Wand
        for (let y = 0; y < HD; y++) for (let x = 0; x < W; x++) {
          if (innen[y][x]) continue;
          let nah = false;
          for (let dy = -1; dy <= 1 && !nah; dy++) for (let dx = -1; dx <= 1; dx++) if (innen[y + dy] && innen[y + dy][x + dx]) { nah = true; break; }
          if (nah) g[oy + y][x] = '#';
        }
        // Schotts an den Sektionsgrenzen (Zeile GANG)
        sek.forEach((s, i) => {
          if (i === 0) return;
          for (let y = 0; y < HD; y++) if (innen[y][s.x0]) g[oy + y][s.x0] = '#';
          g[oy + GANG][s.x0] = 'S';
        });
        sek.forEach((s, i) => {
          if (s.art === 'mitte') {
            const { x0, x1 } = intervalle(i);
            for (let x = x0; x <= x1; x++) { g[oy + GANG - 1][x] = '#'; g[oy + GANG + 1][x] = '#'; }
            for (const seite of ['o', 'u']) {
              const y0 = seite === 'o' ? 1 : GANG + 2, y1 = seite === 'o' ? GANG - 2 : HD - 2;
              let rs;
              if (layout === 'rechteck') rs = teilung[i];
              else {
                const nutz = x1 - x0 + 1;
                const zwei = nutz >= 9 && R.f() < 0.6;
                const wc = x0 + Math.floor(nutz / 2);
                rs = zwei ? [[x0, wc - 1], [wc + 1, x1]] : [[x0, x1]];
              }
              if (rs.length === 2) for (let y = y0; y <= y1; y++) g[oy + y][rs[0][1] + 1] = '#';
              for (const [a, b] of rs) {
                // Türpaar: rechteck rechts der Mitte gespiegelt zur linken Hälfte (W - 2 - m), sonst Raummitte
                let m = Math.floor((a + b) / 2);
                if (layout === 'rechteck') { const mb = Math.floor((a + b) / 2); const links = (a + b) < W - 1; m = links ? mb : (W - 2 - Math.floor(((W - 1 - b) + (W - 1 - a)) / 2)); }
                const ty = seite === 'o' ? GANG - 1 : GANG + 1;
                g[oy + ty][m] = 'D'; g[oy + ty][m + 1] = 'D';
                raeume.push({ deck: d, sek: i, seite, typ: null, x0: a, x1: b, y0, y1, gx: m });
              }
            }
          } else {
            const { x0: ax0, x1: ax1 } = s.art === 'heck' ? { x0: s.x0 + 1, x1: s.x0 + s.w - 1 } : intervalle(i);
            let r;
            if (s.art === 'heck') r = { x0: Math.max(ax0, layout === 'rechteck' ? ax0 : 3), x1: ax1, y0: 1, y1: HD - 2 };
            else if (layout === 'rechteck') r = { x0: ax0, x1: W - 2, y0: 1, y1: HD - 2 };
            else r = { x0: ax0, x1: Math.min(ax1, W - 5), y0: GANG - 3, y1: GANG + 3 };
            raeume.push(Object.assign({ deck: d, sek: i, seite: 'm', typ: d === 0 ? (s.art === 'heck' ? 'antrieb' : 'bruecke') : (s.art === 'heck' ? 'reaktor' : 'batteriedeck'), gx: -1 }, r));
          }
        });
      }
      return { R, sek, W, H, g, raeume, layout };
    }

    // karteRoh(seed, opts) -> Rohkarte für Buehne.ausRaster (Kartenart 'schiff', Schablone 'gen-schiff')
    function karteRoh(seed, opts) {
      opts = opts || {};
      const zustand = ['intakt', 'verfallen', 'umkaempft'].includes(opts.zustand) ? opts.zustand : 'intakt';
      const S = bauen(seed, opts), W = S.W, H = S.H, g = S.g, layout = S.layout, R = S.R, R2 = rng(seed * 7919 + 13);
      const at = (x, y) => (g[y] || [])[x];
      const key = (x, y) => x + ',' + y;
      const BEG = (c) => c === '.' || c === ',' || c === 'P';
      const GEH = (c) => BEG(c) || (c != null && TUEREN.includes(c));
      const nahTuer = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = at(x + dx, y + dy); if (c != null && TUEREN.includes(c)) return true; } return false; };
      const RING = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
      // lokaler Zusammenhang (wie der Überzug des Prüfers): die begehbaren Nachbarn im 8er-Ring bilden höchstens einen Lauf
      const lokalFrei = (x, y) => {
        const q = RING.map(([dx, dy]) => GEH(at(x + dx, y + dy)));
        for (let i = 0; i < 8; i += 2) if (q[i] && !q[(i + 1) % 8] && !q[(i + 7) % 8]) q[i] = false;
        let laeufe = 0;
        for (let i = 0; i < 8; i++) if (q[i] && !q[(i + 7) % 8]) laeufe++;
        if (laeufe === 0 && q.every(Boolean)) laeufe = 1;
        return laeufe <= 1 && q.filter(Boolean).length >= 3;
      };
      const belegt = new Set(), reserviert = new Set(), blockiert = new Set();
      const BLOCKEND = { terminal: 1, sprengpunkt: 1, zelle: 1, beute: 1, ziel: 1, flagge: 1, fund: 1, raetsel: 1 };
      const deko = (x, y, ch, hart) => {
        if (at(x, y) !== '.' || belegt.has(key(x, y))) return false;
        if (!hart && (nahTuer(x, y) || !lokalFrei(x, y))) return false;
        g[y][x] = ch; return true;
      };
      const raeumeD = (d) => S.raeume.filter((r) => r.deck === d);
      const mitte = (d) => raeumeD(d).filter((r) => r.seite !== 'm').sort((a, b) => a.x0 - b.x0 || (a.seite < b.seite ? -1 : 1));
      const heck = (d) => raeumeD(d).find((r) => r.typ === 'antrieb' || r.typ === 'reaktor');
      const bug = (d) => raeumeD(d).find((r) => r.typ === 'bruecke' || r.typ === 'batteriedeck');

      // ---- Raumtypen (rechteck: je Spiegelpaar derselbe Typ, also palindromische Folge) ----
      for (let d = 0; d < 2; d++) {
        const rs = mitte(d);
        const partner = (r) => rs.find((q) => q.seite === r.seite && q.x0 === W - 1 - r.x1 && q.x1 === W - 1 - r.x0);
        const umlauf = [];
        const gesehen = new Set();
        for (const r of rs) {
          if (gesehen.has(r)) continue;
          const p = layout === 'rechteck' ? partner(r) : null;
          const orbit = p && p !== r ? [r, p] : [r];
          orbit.forEach((q) => gesehen.add(q));
          umlauf.push(orbit);
        }
        R.shuffle(umlauf);
        for (const [typ, min] of BEDARF[d]) {
          let n = 0;
          while (n < min && umlauf.length) { const o = umlauf.shift(); o.forEach((q) => { q.typ = typ; }); n += o.length; }
        }
        for (const o of umlauf) { const typ = R.pick(FUELL[d]); o.forEach((q) => { q.typ = typ; }); }
      }

      // ---- Räume ausstatten (nur bekannte Kacheln: o halbe, O volle Deckung, I Pfeiler, z Gitter) ----
      const zellNischen = [];   // [x, y] der Zellenanker
      const heckBlock = (r, d) => {   // Maschinenblöcke beiderseits des Längsgangs (Zeilen ±2..3), Pfeiler dahinter
        const oy = d * STRIDE;
        const bx = r.x0 + (layout === 'rechteck' ? 2 : 3), bw = 3;
        for (let x = bx; x < bx + bw; x++) for (const yy of [GANG - 3, GANG - 2, GANG + 2, GANG + 3]) if (at(x, oy + yy) === '.') g[oy + yy][x] = 'O';
        for (const [x, yy] of [[r.x1 - 1, GANG - 3], [r.x1 - 1, GANG + 3]]) deko(x, oy + yy, 'I', true);
        for (const [x, yy] of [[r.x0 + 1, GANG - 4], [r.x0 + 1, GANG + 4]]) deko(x, oy + yy, 'o');
      };
      const reaktorKern = (r, d) => {   // Reaktorkern 2x3 neben dem Gang, Gang bleibt frei; Kühlpfeiler
        const oy = d * STRIDE, cx = r.x0 + 4;
        for (const yy of [GANG - 3, GANG - 2]) for (const x of [cx, cx + 1]) if (at(x, oy + yy) === '.') g[oy + yy][x] = 'O';
        for (const yy of [GANG + 2, GANG + 3]) for (const x of [cx, cx + 1]) if (at(x, oy + yy) === '.') g[oy + yy][x] = 'O';
        for (const [x, yy] of [[r.x0 + 1, GANG - 4], [r.x0 + 1, GANG + 4], [r.x1 - 1, GANG - 3], [r.x1 - 1, GANG + 3]]) deko(x, oy + yy, 'I', true);
      };
      for (let d = 0; d < 2; d++) {
        const oy = d * STRIDE;
        const h = heck(d); (d === 0 ? heckBlock : reaktorKern)(h, d);
        const b = bug(d);
        if (d === 0) {   // Brücke: Konsolen und Pfeiler
          for (const yy of [GANG - 3, GANG + 3]) for (const x of [b.x0 + 1, b.x0 + 2]) deko(x, oy + yy, 'O');
          for (const yy of [GANG - 2, GANG + 2]) deko(b.x0 + 4, oy + yy, 'o');
        } else {         // Batteriedeck: Geschützbänke an den Bordwänden, Schotts
          for (const yy of [GANG - 3, GANG + 3]) for (const x of [b.x0 + 1, b.x0 + 2, b.x0 + 5, b.x0 + 6]) deko(x, oy + yy, 'O');
          for (const yy of [GANG - 2, GANG + 2]) for (const x of [b.x0 + 3, b.x0 + 4]) deko(x, oy + yy, 'o');
        }
        for (const r of mitte(d)) {
          const hy = r.seite === 'o' ? r.y0 : r.y1, ih = r.seite === 'o' ? hy + 1 : hy - 1;   // Hüllenzeile und die Zeile davor
          const Y = (y) => y + oy;
          if (r.typ === 'lager') {
            for (let x = r.x0 + 1; x <= r.x1 - 1; x += 3) { deko(x, Y(hy), 'O'); deko(x + 1, Y(hy), 'O'); if (x + 1 <= r.x1 - 1) deko(x, Y(ih), 'o'); }
          } else if (r.typ === 'quartier') {
            for (let x = r.x0 + 1; x + 1 <= r.x1; x += 3) { deko(x, Y(hy), 'O'); deko(x + 1, Y(hy), 'o'); }
            deko(r.x0 + 1, Y(ih + (r.seite === 'o' ? 1 : -1)), 'o');
          } else if (r.typ === 'zellen') {
            const cs = r.x1 - r.x0 >= 3 ? [[r.x0, 1], [r.x1, -1]] : [[r.x0, 1]];
            for (const [cx, dir] of cs) { g[Y(hy)][cx + dir] = 'z'; g[Y(ih)][cx + dir] = 'z'; zellNischen.push([cx, Y(hy)]); }
          } else if (r.typ === 'waffenkammer') {
            for (const x of [r.x0 + 1, r.x0 + 2, r.x1 - 2, r.x1 - 1]) deko(x, Y(hy), 'O');
            deko(Math.floor((r.x0 + r.x1) / 2), Y(ih), 'o');
          } else if (r.typ === 'messe') {
            const cx = Math.floor((r.x0 + r.x1) / 2);
            deko(cx, Y(ih), 'o'); deko(cx + 1, Y(ih), 'o'); deko(r.x0 + 1, Y(hy), 'o'); deko(r.x1 - 1, Y(hy), 'o');
          } else if (r.typ === 'schleuse') {
            deko(r.x0, Y(hy), 'o'); deko(r.x1, Y(hy), 'o');
          } else if (r.typ === 'transferkammer') {
            deko(r.x0, Y(hy), 'o'); deko(r.x1, Y(hy), 'O');
          }
        }
      }

      // ---- Plätze: eine je Sektion und Deck ----
      const plaetze = {};
      const pid = (d, i) => 'sek' + (i + 1) + '_d' + (d + 1);
      for (let d = 0; d < 2; d++) S.sek.forEach((s, i) => {
        const art = s.art;
        plaetze[pid(d, i)] = { typ: art === 'heck' ? (d === 0 ? 'antrieb' : 'reaktor') : art === 'bug' ? (d === 0 ? 'bruecke' : 'batteriedeck') : 'sektion', modul: 'gen-schiff', lage: { rot: 0, spiegel: false, aussen: null }, rect: [s.x0, d * STRIDE, s.w, HD], bereich: 'gefecht_d' + (d + 1), deck: d + 1, ...(art === 'mitte' ? {} : { kern: true }) };
      });
      const sekVon = (x) => { let k = 0; S.sek.forEach((s, i) => { if (x >= s.x0) k = i; }); return k; };

      // ---- Anker ----
      const roh = [];
      const ank = (d, rolle, x, y, attr) => { const i = sekVon(x); const p = pid(d, i); const bid = attr && attr.bereich; const a = Object.assign({ rolle, x, y: y + d * STRIDE, platz: p, bereich: plaetze[p].bereich, deck: d + 1 }, attr || {}); if (bid) a.bereich = bid; roh.push(a); belegt.add(key(x, y + d * STRIDE)); if (BLOCKEND[rolle]) blockiert.add(key(x, y + d * STRIDE)); return a; };
      const orthFrei = (x, y) => [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => BEG(at(x + dx, y + dy)) && !blockiert.has(key(x + dx, y + dy))).length >= 2;
      const frei = (x, y) => (at(x, y) === '.' || at(x, y) === ',') && !belegt.has(key(x, y)) && !reserviert.has(key(x, y));
      const kandidaten = (d, r, wohin) => {   // freie Bodenkachel im Raum (ohne Gangzeile, nicht an Türen), wohin: rand | innen | beliebig
        const c = [];
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
          const Y = y + d * STRIDE;
          if (y === GANG || at(x, Y) !== '.' || !frei(x, Y) || nahTuer(x, Y) || !orthFrei(x, Y) || !lokalFrei(x, Y) || RING.some(([dx, dy]) => blockiert.has(key(x + dx, Y + dy)))) continue;
          const rand = x === r.x0 || y === r.y0 || x === r.x1 || y === r.y1;
          if (wohin === 'rand' ? rand : wohin === 'innen' ? !rand : true) c.push([x, y]);
        }
        return c;
      };
      const kachel = (d, r, wohin) => { let c = kandidaten(d, r, wohin); if (!c.length && wohin !== 'beliebig') c = kandidaten(d, r, 'beliebig'); return c.length ? c[R2.int(c.length)] : null; };
      const neben = (d, r, ch) => {   // Kachel neben Dekoration (z. B. am Kern): bevorzugt
        const c = kandidaten(d, r, 'beliebig').filter(([x, y]) => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => at(x + dx, y + dy + d * STRIDE) === ch));
        return c.length ? c[R2.int(c.length)] : null;
      };
      const muss = (p, was) => { if (!p) throw new Error('gen-schiff: kein Platz für ' + was); return p; };
      const padSuche = (d, r) => {   // L-Pad (3 freie Kacheln) im Raum
        const fr = (x, y) => frei(x, y + d * STRIDE) && !nahTuer(x, y + d * STRIDE);
        const c = [];
        for (let y = r.y0 + 1; y < r.y1; y++) for (let x = r.x0 + 1; x < r.x1; x++) if (y !== GANG && fr(x, y) && [[1, 1], [-1, 1], [1, -1], [-1, -1]].some(([dx, dy]) => fr(x + dx, y) && fr(x, y + dy))) c.push([x, y]);
        return c.length ? c[R2.int(c.length)] : null;
      };
      const padSetzen = (d, r, attr) => {
        const p = padSuche(d, r); if (!p) return null;
        const a = ank(d, 'abholpunkt', p[0], p[1], attr);
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) reserviert.add(key(p[0] + dx, p[1] + dy + d * STRIDE));
        return a;
      };
      const rolleRaum = (d, typ) => mitte(d).filter((r) => r.typ === typ);
      const raumRect = (r, d) => [r.x0, r.y0 + d * STRIDE, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1];
      let hineinRaum = null;
      // Ankunft in einer Schleuse (Deck 1), zweiter Abholpunkt in der Transferkammer (Deck 2)
      {
        for (const r of rolleRaum(0, 'schleuse').concat(mitte(0))) { if (padSetzen(0, r, { ankunft: true, bereich: 'hinein' })) { hineinRaum = r; break; } }
        muss(hineinRaum, 'die Ankunft');
        let ok = false;
        for (const r of rolleRaum(1, 'transferkammer').concat(mitte(1))) { if (padSetzen(1, r, { bereich: 'rueckzug' })) { ok = true; if (r.typ !== 'transferkammer') r.typ = 'transferkammer'; break; } }
        muss(ok, 'den zweiten Abholpunkt');
      }
      // Lift (in einem Mittschiffsraum) und Leiter (im Heck), auf beiden Decks an derselben Stelle
      const links = [];
      {
        const pos = (r, wo) => { const c = []; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { if (y === GANG) continue; const inn = x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1; if (frei(x, y) && frei(x, y + STRIDE) && at(x, y) === '.' && at(x, y + STRIDE) === '.' && !nahTuer(x, y) && !nahTuer(x, y + STRIDE) && orthFrei(x, y) && orthFrei(x, y + STRIDE) && (wo !== 'innen' || inn)) c.push([x, y]); } return c.length ? c[R2.int(c.length)] : null; };
        const kand = R2.shuffle(mitte(0).filter((r) => r !== hineinRaum && r.typ !== 'zellen'));
        let l1 = null; for (const r of kand) { l1 = pos(r, 'innen'); if (l1) break; }
        if (!l1) for (const r of kand) { l1 = pos(r, 'rand'); if (l1) break; }
        const l2 = pos(heck(0), 'innen') || pos(heck(0), 'rand');
        for (const [rolle, p] of [['lift', l1], ['leiter', l2]]) {
          muss(p, rolle);
          ank(0, rolle, p[0], p[1]); ank(1, rolle, p[0], p[1]);
          links.push({ a: [p[0], p[1]], b: [p[0], p[1] + STRIDE], via: rolle });
        }
      }
      // Eingänge (Hüllentüren): Schleuse technisch (Schott), ein Laderaum leise (Luke), Transferkammer laut (Tür)
      const huelle = (r, d) => r.seite === 'o' ? 0 : HD - 1;
      const eingang = (d, r, zeichen, art) => {
        const wy = huelle(r, d), iy = (r.seite === 'o' ? 1 : HD - 2) + d * STRIDE, mx = Math.floor((r.x0 + r.x1) / 2);
        let x = null;
        for (const dx of [0, 1, -1, 2, -2, 3, -3]) { const c = mx + dx; if (c >= r.x0 && c <= r.x1 && at(c, wy + d * STRIDE) === '#' && at(c, iy) === '.' && !reserviert.has(key(c, iy)) && !nahTuer(c, iy) && (at(c - 1, iy) === '.' || at(c + 1, iy) === '.')) { x = c; break; } }
        if (x == null) return false;
        g[wy + d * STRIDE][x] = zeichen; ank(d, 'eingang', x, wy, { art }); return true;
      };
      {
        let n = 0;
        for (const r of rolleRaum(0, 'schleuse')) if (eingang(0, r, 'S', 'technisch')) n++;
        for (const r of rolleRaum(0, 'lager')) if (eingang(0, r, 'L', 'leise')) { n++; break; }
        for (const r of rolleRaum(1, 'transferkammer')) if (eingang(1, r, 'D', 'laut')) n++;
        if (n < 2) throw new Error('gen-schiff: zu wenige Eingänge');
      }
      // Antrieb/Reaktor: Sprengpunkt (am Reaktorkern), Ziel; Brücke: Ziel, Terminal; Batteriedeck: Terminal
      {
        const h1 = heck(1), b0 = bug(0), b1 = bug(1);
        const sp = muss(neben(1, h1, 'O') || kachel(1, h1, 'rand'), 'den Sprengpunkt'); ank(1, 'sprengpunkt', sp[0], sp[1], { bereich: 'ziel' });
        const z1 = muss(kachel(0, b0, 'innen'), 'ein Ziel (Brücke)'); ank(0, 'ziel', z1[0], z1[1], { bereich: 'ziel' });
        const z2 = muss(kachel(1, h1, 'innen') || kachel(1, h1, 'rand'), 'ein Ziel (Reaktor)'); ank(1, 'ziel', z2[0], z2[1], { bereich: 'ziel' });
        const z3 = muss(kachel(1, b1, 'innen') || kachel(1, b1, 'rand'), 'ein Ziel (Batteriedeck)'); ank(1, 'ziel', z3[0], z3[1], { bereich: 'ziel' });
        const lg = rolleRaum(0, 'lager'); let z4 = null; for (const r of lg) { z4 = kachel(0, r, 'innen'); if (z4) { ank(0, 'ziel', z4[0], z4[1], { bereich: 'ziel' }); break; } }   // Katalog (krise_eindaemmen/ventile) verlangt min. 3 ziel; Lager als vierter Standort
        const t1 = muss(kachel(0, b0, 'rand'), 'ein Terminal (Brücke)'); ank(0, 'terminal', t1[0], t1[1], { bereich: 'ziel' });
        const t2 = muss(kachel(1, b1, 'rand'), 'ein Terminal (Batteriedeck)'); ank(1, 'terminal', t2[0], t2[1], { bereich: 'ziel' });
      }
      // Raumrollen: Beute (Lager, Waffenkammer), NSC (Quartier, Messe), Zellen
      for (let d = 0; d < 2; d++) for (const r of mitte(d)) {
        if (r.typ === 'quartier') { const p = kachel(d, r, 'innen'); if (p) ank(d, 'nsc', p[0], p[1]); }
        if (r.typ === 'messe' && R2.f() < 0.5) { const p = kachel(d, r, 'innen'); if (p) ank(d, 'nsc', p[0], p[1]); }
      }
      // Beute: Budget 8..12 gesamt (keine Beute-Spirale). Zuerst je Lager/Waffenkammer eine, dann zweite im Lager, dann Auffüllen; überzählige Räume bleiben bei Deckung/Props
      {
        const soll = R2.range(8, 12);
        const lagerR = [], zweit = [];
        for (let d = 0; d < 2; d++) for (const r of mitte(d)) if (r.typ === 'lager' || r.typ === 'waffenkammer') { lagerR.push([d, r]); if (r.typ === 'lager') zweit.push([d, r]); }
        R2.shuffle(lagerR); R2.shuffle(zweit);
        const setzeBeute = ([d, r]) => { const p = kachel(d, r, 'rand'); if (p) ank(d, 'beute', p[0], p[1], d === 0 && r.typ === 'lager' ? { bereich: 'ziel' } : {}); return !!p; };
        const zb = () => roh.filter((a) => a.rolle === 'beute').length;
        for (const q of lagerR.concat(zweit)) { if (zb() >= soll) break; setzeBeute(q); }
        const fuell = [];
        for (let d = 0; d < 2; d++) for (const r of mitte(d)) if (r.typ !== 'zellen') fuell.push([d, r]);
        for (let v = 0; zb() < soll && v < 40; v++) setzeBeute(R2.pick(fuell));
      }
      for (const [x, y] of zellNischen) if (frei(x, y)) ank(0, 'zelle', x, y - 0);
      {
        const zahl = (rolle) => roh.filter((a) => a.rolle === rolle).length;
        for (const [rolle, soll] of [['beute', 3], ['nsc', 1], ['zelle', 1]]) {
          for (let k = zahl(rolle); k < soll; k++) {
            const d = k % 2; const r = R2.pick(mitte(d));
            const p = rolle === 'zelle' ? null : kachel(d, r, 'beliebig');
            if (!p) throw new Error('gen-schiff: kein Platz für ' + rolle);
            ank(d, rolle, p[0], p[1]);
          }
        }
      }
      // Patrouillen: je Deck eine Kette (kette 'a' Deck 1, 'b' Deck 2) auf Gangkacheln, mindestens eine je Mittschiffs-Sektion; Buehne.kompilierePatrouillen verbindet sie zu karte.patrouillen
      {
        for (let d = 0; d < 2; d++) {
          const mine = [];
          S.sek.forEach((s, i) => {
            if (s.art !== 'mitte') return;
            const mx = s.x0 + Math.floor(s.w / 2);
            for (const dx of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7]) {
              const x = mx + dx, Y = GANG + d * STRIDE;
              if (x <= s.x0 || x >= s.x0 + s.w - 1 || at(x, Y) !== ',' || !frei(x, Y) || TUEREN.includes(at(x, Y - 1)) || TUEREN.includes(at(x, Y + 1)) || mine.some(([qx]) => Math.abs(qx - x) < 2)) continue;
              mine.push([x, Y]); break;
            }
          });
          mine.forEach(([x, Y]) => ank(d, 'patrouille', x, Y - d * STRIDE, { kette: d === 0 ? 'a' : 'b' }));
        }
      }
      // Wachen: Brücke (schwer), Reaktor, Gang, Batteriedeck, Antrieb … mit Abstand zueinander, zur Ankunft und zu den Eingängen; nie auf oder neben Türen
      {
        const soll = WACHEN[zustand];
        const pad = roh.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
        const eing = roh.filter((a) => a.rolle === 'eingang');
        const ws = [];
        const dist = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);
        const gut = (d, x, y, abstand, padAb) => {
          const Y = y + d * STRIDE;
          if (!frei(x, Y) || nahTuer(x, Y)) return false;
          if (!(at(x, Y) === ',' || orthFrei(x, Y))) return false;
          for (const w of ws) if (w.deck === d + 1 && dist(w.x, w.y, x, Y) < abstand) return false;
          if (pad && pad.deck === d + 1 && dist(pad.x, pad.y, x, Y) < padAb) return false;
          for (const e of eing) if (e.deck === d + 1 && dist(e.x, e.y, x, Y) < 4) return false;
          for (const a of roh) if (a.rolle !== 'wache' && a.x === x && a.y === Y) return false;
          return true;
        };
        const setzen = (d, x, y, attr) => { const a = ank(d, 'wache', x, y, Object.assign({ bereich: 'gefecht_d' + (d + 1) }, attr || {})); ws.push(a); };
        const gangTuerNah = (d, x) => { let m = 99; for (let xx = 0; xx < W; xx++) for (const yy of [GANG - 1, GANG + 1, GANG]) { const c = at(xx, yy + d * STRIDE); if (c != null && TUEREN.includes(c) && yy !== GANG - 0) m = Math.min(m, Math.abs(xx - x)); else if (c === 'S') m = Math.min(m, Math.abs(xx - x)); } return m; };
        const aus = (d, typ) => { const r = typ === 'gang' ? null : (raeumeD(d).filter((q) => q.typ === typ)); return r; };
        const slotKand = (d, typ, abstand, padAb) => {
          const c = [];
          if (typ === 'gang') { for (let x = 1; x < W - 1; x++) if (at(x, GANG + d * STRIDE) === ',' && gut(d, x, GANG, abstand, padAb)) { const m = gangTuerNah(d, x); if (m >= 2 && m <= 4) c.push([x, GANG]); } }
          else for (const r of aus(d, typ)) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (y !== GANG && gut(d, x, y, abstand, padAb)) c.push([x, y]);
          return c;
        };
        const folge = [[0, 'bruecke'], [1, 'reaktor'], [0, 'gang'], [1, 'gang'], [1, 'batteriedeck'], [0, 'antrieb'], [1, 'waffenkammer'], [0, 'gang'], [1, 'gang'], [1, 'lager'], [0, 'messe'], [0, 'lager']];
        for (const [d, typ] of folge) {
          if (ws.length >= soll) break;
          const c = slotKand(d, typ, 6, 8);
          if (!c.length) continue;
          const p = c[R2.int(c.length)];
          setzen(d, p[0], p[1], ws.length === 0 ? { schwer: true } : null);
        }
        for (let versuch = 0; ws.length < soll && versuch < 200; versuch++) {   // Rest: beliebige Stelle mit gelockertem Abstand
          const d = R2.int(2); const r = R2.pick(raeumeD(d)); const x = R2.range(r.x0, r.x1), y = R2.range(r.y0, r.y1);
          if (y !== GANG && gut(d, x, y, 4, 6)) setzen(d, x, y);
        }
        if (ws.length < 4) throw new Error('gen-schiff: zu wenige Wachen');
      }
      // Anker sortieren, IDs vergeben
      roh.sort((a, b) => (a.platz < b.platz ? -1 : a.platz > b.platz ? 1 : 0) || (a.rolle < b.rolle ? -1 : a.rolle > b.rolle ? 1 : 0) || a.y - b.y || a.x - b.x);
      const zz = {}; for (const a of roh) { const k = a.platz + '.' + a.rolle; zz[k] = (zz[k] || 0) + 1; }
      const lauf = {}; const anker = [];
      for (const a of roh) { const k = a.platz + '.' + a.rolle; lauf[k] = (lauf[k] || 0) + 1; anker.push(Object.assign({ id: zz[k] > 1 ? k + '.' + lauf[k] : k }, a)); }

      // ---- Zusammenhang prüfen (alle Anker erreichbar, keine abgeschnittenen Flächen ab 16 Kacheln) ----
      const zusammenhang = (raster) => {
        const gt = (x, y) => (raster[y] || [])[x];
        const pad = anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
        const lk = new Map(); for (const l of links) { lk.set(key(l.a[0], l.a[1]), l.b); lk.set(key(l.b[0], l.b[1]), l.a); }
        const seen = new Set(), comp = (sx, sy) => { const q = [[sx, sy]]; seen.add(key(sx, sy)); let n = 0; for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; n++; const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]; const l = lk.get(key(x, y)); if (l) nb.push(l); for (const [nx, ny] of nb) if (GEH(gt(nx, ny)) && !blockiert.has(key(nx, ny)) && !seen.has(key(nx, ny))) { seen.add(key(nx, ny)); q.push([nx, ny]); } } return n; };
        comp(pad.x, pad.y);
        for (const a of anker) if (!seen.has(key(a.x, a.y)) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(key(a.x + dx, a.y + dy)))) { if (process.env.GS_DEBUG) console.log('anker', a.id); return false; }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (BEG(gt(x, y)) && !blockiert.has(key(x, y)) && !seen.has(key(x, y))) { const hat = anker.some((a) => a.x === x && a.y === y); const gr = comp(x, y); if (hat || gr >= 16) { if (process.env.GS_DEBUG) console.log('insel', x, y, gr, hat); return false; } }
        return true;
      };
      if (!zusammenhang(g)) throw new Error('gen-schiff: Karte nicht zusammenhängend');

      // ---- Zustand: Überzug (verfallen: Trümmer, Hüllenlöcher, halb verschüttete Türen; umkaempft: Barrikaden, Trümmer, wenige Hüllenlöcher) ----
      let ueberzug = zustand === 'intakt' ? null : 'voll';
      if (zustand !== 'intakt') {
        const basis = g.map((r) => r.slice());
        const nahAnker = (x, y, r) => anker.some((a) => Math.abs(a.x - x) <= r && Math.abs(a.y - y) <= r);
        const anwenden = (stufe) => {
          const R3 = rng(seed * 104729 + (zustand === 'verfallen' ? 17 : 29));
          const setze = (x, y, ch) => { if (at(x, y) !== '.' || nahAnker(x, y, 1) || nahTuer(x, y) || !lokalFrei(x, y)) return false; g[y][x] = ch; return true; };
          for (let d = 0; d < 2; d++) for (const r of mitte(d)) {
            const oy = d * STRIDE;
            if (zustand === 'umkaempft') {
              const ty = r.seite === 'o' ? GANG - 3 : GANG + 3;   // zwei Kacheln hinter der Tür
              if (R3.f() < 0.7) { const x = r.gx >= 0 ? r.gx + R3.int(2) : r.x0; setze(x, ty + oy, 'o'); }
              if (R3.f() < 0.5) { for (let k = 0; k < 6; k++) if (setze(R3.range(r.x0, r.x1), R3.range(r.y0, r.y1) + oy, R3.f() < 0.1 ? 'X' : 'x')) break; }
            } else {
              const n = R3.range(1, 2);
              for (let i = 0, k = 0; i < n && k < 12; k++) if (setze(R3.range(r.x0, r.x1), R3.range(r.y0, r.y1) + oy, R3.f() < 0.15 ? 'X' : 'x')) i++;
              if (stufe === 'voll' && r.gx >= 0 && R3.f() < 0.3) {   // halb verschüttete Tür: eine der beiden Kacheln
                const ty = (r.seite === 'o' ? GANG - 1 : GANG + 1) + oy;
                if (at(r.gx + 1, ty) === 'D' && !nahAnker(r.gx + 1, ty, 1)) g[ty][r.gx + 1] = 'X';
              }
            }
          }
          const loecher = zustand === 'verfallen' ? R3.range(2, 4) : R3.range(1, 2);
          for (let i = 0, k = 0; i < loecher && k < 40; k++) {
            const d = R3.int(2), x = R3.range(4, W - 5), wy = (R3.f() < 0.5 ? 0 : HD - 1) + d * STRIDE;
            if (at(x, wy) !== '#' || at(x - 1, wy) !== '#' || at(x + 1, wy) !== '#' || nahAnker(x, wy, 2)) continue;
            const innenY = wy % STRIDE === 0 ? wy + 1 : wy - 1;
            if (!BEG(at(x, innenY))) continue;
            let tuerNah = false; for (let dx = -2; dx <= 2; dx++) { const c = at(x + dx, wy); if (c != null && TUEREN.includes(c)) tuerNah = true; }
            if (tuerNah) continue;
            g[wy][x] = '~'; i++;
          }
        };
        let ok = false;
        for (const stufe of ['voll', 'teil']) {
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y][x] = basis[y][x];
          anwenden(stufe);
          if (zusammenhang(g)) { ueberzug = stufe; ok = true; break; }
        }
        if (!ok) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y][x] = basis[y][x]; ueberzug = 'kein'; }
      }

      // ---- Bereiche ----
      const bereiche = {};
      for (let d = 1; d <= 2; d++) {
        const rects = S.sek.map((s) => (s.art === 'heck' ? [s.x0, (d - 1) * STRIDE, s.w, HD] : [s.x0 + 1, (d - 1) * STRIDE, s.w - 1, HD]));
        bereiche['gefecht_d' + d] = { name: 'Schiff Deck ' + d, rects, rolle: null, gefecht: true };
      }
      bereiche.hinein = { name: 'Schleuse', rects: [raumRect(hineinRaum, 0)], rolle: 'hinein' };
      bereiche.rueckzug = { name: 'Transferkammer', rects: rolleRaum(1, 'transferkammer').map((r) => raumRect(r, 1)), rolle: 'rueckzug' };
      bereiche.ziel = { name: 'Laderäume, Reaktor und Brücke', rects: [raumRect(bug(0), 0), raumRect(heck(1), 1), raumRect(bug(1), 1)].concat(rolleRaum(0, 'lager').map((r) => raumRect(r, 0))), rolle: 'ziel' };

      // ---- Fallenplätze: Gangkacheln vor Türen, Engstellen an den Schotts (keine Anker dafür) ----
      const fallen = [];
      {
        const nah = (x, y) => anker.some((a) => Math.abs(a.x - x) <= 1 && Math.abs(a.y - y) <= 1);
        const add = (d, x, art, platz) => { const y = GANG + d * STRIDE; if (at(x, y) === ',' && !nah(x, y) && !fallen.some((f) => f.x === x && f.y === y)) fallen.push({ x, y, deck: d + 1, art, platz }); };
        for (let d = 0; d < 2; d++) {
          for (const r of mitte(d)) if (r.gx >= 0 && at(r.gx, (r.seite === 'o' ? GANG - 1 : GANG + 1) + d * STRIDE) === 'D') add(d, r.gx, 'tuer', pid(d, r.sek));
          S.sek.forEach((s, i) => { if (i > 0) { add(d, s.x0 - 1, 'schott', pid(d, i - 1)); add(d, s.x0 + 1, 'schott', pid(d, i)); } });
        }
        fallen.sort((a, b) => a.y - b.y || a.x - b.x);
      }
      // ---- Fallen (SCH-01 P5): Anker der Rolle falle, eigener RNG-Strom R4 (R, R2, R3 bleiben unberührt). 2..4 je Karte (umkaempft 2), mindestens eine passive und eine verborgene,
      // Typmix schott (Gang, nahe einem Schott) / druck (nahe Hüllenloch, intakt: im Antrieb/Reaktor) / schuss (Raum, Kollisionsbox an der Hüllenwand, nie im 1 Kachel breiten Gang).
      // Nie auf/neben einem Anker, nie nahe Lift/Leiter/Abholpunkt/Eingang/Terminal/Ziel/Sprengpunkt, Abstand 4 zur Ankunft, untereinander mindestens 5. Prüfung der Erreichbarkeit mit allen Boxen als Hindernis.
      const fallenAnker = [];
      {
        const R4 = rng(seed * 6271 + 101);
        const NAH2 = { lift: 1, leiter: 1, abholpunkt: 1, eingang: 1, terminal: 1, ziel: 1, sprengpunkt: 1 };
        const padA = anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
        const deckVon = (y) => (y >= STRIDE ? 1 : 0);
        const zulaessig = (x, y, gewaehlt) => {
          const c = at(x, y);
          if (c !== '.' && c !== ',') return false;
          if (reserviert.has(key(x, y)) || belegt.has(key(x, y))) return false;
          for (const a of anker) { const ch = Math.max(Math.abs(a.x - x), Math.abs(a.y - y)); if (ch <= 1 || (NAH2[a.rolle] && ch <= 2)) return false; }
          if (padA && Math.hypot(padA.x - x, padA.y - y) < 4) return false;
          for (const f of gewaehlt) if (Math.hypot(f.x - x, f.y - y) < 5) return false;
          return true;
        };
        const kand = { schott: [], druck: [], schuss: [] };
        const schottNah = (x, y) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dy) <= 3 && at(x + dx, y + dy) === 'S') return true; return false; };
        for (const f of fallen) if (schottNah(f.x, f.y)) kand.schott.push({ x: f.x, y: f.y });
        if (zustand === 'intakt') {
          for (let d = 0; d < 2; d++) { const h = heck(d); for (let y = h.y0; y <= h.y1; y++) for (let x = h.x0; x <= h.x1; x++) kand.druck.push({ x, y: y + d * STRIDE }); }
        } else {
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) === '~') for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dy) <= 3 && !kand.druck.some((q) => q.x === x + dx && q.y === y + dy)) kand.druck.push({ x: x + dx, y: y + dy });
        }
        for (let d = 0; d < 2; d++) for (const r of raeumeD(d)) {
          const oy = d * STRIDE;
          if (r.typ === 'lager' || r.typ === 'waffenkammer') {
            const hy = r.seite === 'o' ? r.y0 : r.y1;   // Hüllenzeile des Raums: Blick auf die Tür am Gang
            for (let x = r.x0; x <= r.x1; x++) if (x <= r.gx - 2 || x >= r.gx + 3) kand.schuss.push({ x, y: hy + oy });
          } else if (r.typ === 'bruecke') {   // Vorraum: die ersten Spalten an den Bordwänden
            for (let x = r.x0; x <= r.x0 + 3; x++) for (const y of [r.y0, r.y1]) kand.schuss.push({ x, y: y + oy });
          }
        }
        const typenFrei = ['schott', 'druck', 'schuss'].filter((t) => kand[t].some((c) => zulaessig(c.x, c.y, [])));
        if (typenFrei.length < 1) throw new Error('gen-schiff: keine Fallenplätze');
        const nSoll = zustand === 'umkaempft' ? 2 : R4.range(3, 4);
        const wuerfeln = (n) => {
          const basis = R4.shuffle(typenFrei.slice());
          const typen = []; for (let i = 0; i < n; i++) typen.push(basis[i % basis.length]);
          const sichten = [true, false]; while (sichten.length < n) sichten.push(R4.f() < 0.5);
          R4.shuffle(sichten);
          const gewaehlt = [], hinzu = [];
          const zurueck = () => { for (const k of hinzu) blockiert.delete(k); anker.length = anker.length - hinzu.length; };
          for (let i = 0; i < n; i++) {
            const typ = typen[i];
            const zahl = [0, 0]; for (const f of gewaehlt) zahl[deckVon(f.y)]++;
            let c = kand[typ].filter((q) => zulaessig(q.x, q.y, gewaehlt));
            const letztDeck = i === n - 1 && (!zahl[0] || !zahl[1]);   // letzter Platz: das noch leere Deck (beide Decks bekommen Fallen)
            const pref = letztDeck ? (zahl[1] ? 0 : 1) : (zahl[0] === zahl[1] ? R4.int(2) : (zahl[0] < zahl[1] ? 0 : 1));
            const c2 = c.filter((q) => deckVon(q.y) === pref);
            if (c2.length) c = c2; else if (letztDeck) { zurueck(); return null; }
            R4.shuffle(c);
            let wahl = null;
            for (const q of c) {
              if (typ !== 'schuss') { wahl = q; break; }
              const k = key(q.x, q.y); blockiert.add(k); anker.push({ id: '_p5', rolle: 'falle', x: q.x, y: q.y });   // Box als Hindernis: Pflicht-Anker und alle Wege müssen erreichbar bleiben
              if (zusammenhang(g)) { hinzu.push(k); wahl = q; break; }
              blockiert.delete(k); anker.pop();
            }
            if (!wahl) { zurueck(); return null; }
            gewaehlt.push({ x: wahl.x, y: wahl.y, typ, passiv: sichten[i] });
          }
          zurueck();
          return gewaehlt;
        };
        let gw = null;
        for (let v = 0; !gw && v < 40; v++) gw = wuerfeln(nSoll);
        for (let v = 0; !gw && v < 40 && nSoll > 2; v++) gw = wuerfeln(nSoll - 1);
        if (!gw) throw new Error('gen-schiff: keine Fallen platzierbar');
        for (const f of gw) {
          const d = deckVon(f.y), i = sekVon(f.x), p = pid(d, i);
          fallenAnker.push({ rolle: 'falle', x: f.x, y: f.y, platz: p, bereich: plaetze[p].bereich, deck: d + 1, typ: f.typ, sicht: f.passiv ? 'passiv' : 'verborgen' });
        }
      }
      {   // Ids neu vergeben (verborgene Fallen bekommen neutrale Ids falle.<Hash>, Buehne.ankerIdsVergeben), die übrigen Ids bleiben wie vorher
        const alle = roh.concat(fallenAnker);
        alle.sort((a, b) => (a.platz < b.platz ? -1 : a.platz > b.platz ? 1 : 0) || (a.rolle < b.rolle ? -1 : a.rolle > b.rolle ? 1 : 0) || a.y - b.y || a.x - b.x);
        const ids = Buehne.ankerIdsVergeben(alle);
        anker.length = 0;
        alle.forEach((a, i) => anker.push(Object.assign({ id: ids[i] }, a)));
      }
      const pflicht = Object.assign({}, PFLICHT);
      const titel = {}; for (const id of Object.keys(plaetze)) titel[id] = RAUMTITEL[plaetze[id].typ] || 'Mittschiffs';
      const folge = (d) => mitte(d).map((r) => r.typ);
      return {
        id: opts.id || null, erzeuger: 'gen-schiff/1', art: 'schiff', bauweise: opts.bauweise || 'germanen', besitz: opts.besitz || null,
        zustand, seed, bauversion: 'gschiff1', schablone: 'gen-schiff', spiegel: null, w: W, h: H, rows: g.map((r) => r.join('')), legende: null, anker,
        bereiche, plaetze, eingaenge: anker.filter((a) => a.rolle === 'eingang').map((a) => a.id), abholpunkte: anker.filter((a) => a.rolle === 'abholpunkt').map((a) => a.id),
        ankunft: (anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft) || {}).id || null,
        patrouillen: [], coverSpots: [], decks: { stride: STRIDE, links }, kanten: {}, zustaende: {}, gelaende: null,
        meta: Object.assign({ versuche: 1, kennzahlen: null, linear: false, pflicht, zellen: null, schiffDecks: 2, schottStart: 'offen', huelle: true, layout, raeume: S.raeume.length, raumfolge: [folge(0), folge(1)], titel, fallenplaetze: fallen, ueberzug }, zustand === 'umkaempft' ? { haltung: 'wach' } : {}),
      };
    }
    return { bauen, karteRoh, HD, STRIDE, MAXLAENGE, PFLICHT };
  }
  return { erzeuger };
});
