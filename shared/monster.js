// Monster-Station (CONCEPT-SL7 §7c): Größenklasse statt Kachelart. UMD: window.Shared_Monster / require. Reine Funktionen auf der Kartenrohform.
//
// Das Monster hat einen Fußabdruck von 2×2 Kacheln. Es passt durch Gänge (4 breit), Räume und Türen/Schotts (2 breit), aber nicht durch den Kriechgang
// und die Luken (1 breit). Es gibt KEINE neue Kachelart: die Begehbarkeit des Monsters ist eine Maske über dem vorhandenen Raster (Erosion).
//   Ankerpunkt (cx, cy) = Kachelecke, 1 ≤ cx < w, 1 ≤ cy < h; der Fußabdruck sind die Kacheln (cx−1, cy−1), (cx, cy−1), (cx−1, cy), (cx, cy).
//   Mittelpunkt in Pixeln = (cx · 32, cy · 32).
// Türen zählen als passierbar: das Monster bricht sie auf (server/sim/monster.js), auch verschlossene.
// Pfadsuche und Kollision benutzen DIESELBE Maske, damit es sich nie in einer Engstelle festläuft (Problem der Kachel-BFS bei großen Körpern).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./buehne-kennzahlen.js'));
  else root.Shared_Monster = factory(root.Shared_BuehneKennzahlen || root.Shared_Kennzahlen || null);
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';
  const FUSS = 2;   // Kanten des Fußabdrucks in Kacheln
  const TILE = 32;

  // Kachel passierbar (für das Monster): Durchgang des Rasters, Türen offen oder zu; Objekte (Möbel) sperren
  function kachelFrei(r, objekt, w, x, y) {
    const i = r.info(x, y);
    if (i && i.kind === 'luke') return false;   // Luken sind 1 breit und führen in den Kriechgang: für das Monster immer dicht
    return (r.durchgang(x, y) || r.tuer(x, y)) && !(objekt && objekt.has(y * w + x));
  }

  // objektKacheln(karte): Kacheln, die ein Anker-Objekt belegt (Pulte, Beute, …). Das Monster darf darauf nicht stehen, Spieler können es.
  function objektKacheln(karte) {
    const s = new Set();
    for (const a of karte.anker || []) if (['terminal', 'beute', 'sprengpunkt', 'zelle', 'nsc', 'versteck'].includes(a.rolle)) s.add(a.y * karte.w + a.x);
    return s;
  }

  // maske(karte) -> { w, h, ok(cx, cy), anker[] }; Rasterkachelwerte einmal berechnet
  function maske(karte) {
    const r = K.raster(karte, { wSchwachOffen: false });
    const w = karte.w, h = karte.h;
    const objekt = objektKacheln(karte);
    const frei = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (kachelFrei(r, objekt, w, x, y)) frei[y * w + x] = 1;
    const ok = new Uint8Array(w * h);
    for (let cy = 1; cy < h; cy++) for (let cx = 1; cx < w; cx++) {
      if (frei[(cy - 1) * w + cx - 1] && frei[(cy - 1) * w + cx] && frei[cy * w + cx - 1] && frei[cy * w + cx]) ok[cy * w + cx] = 1;
    }
    return { w, h, frei, ok, raster: r,
      geht(cx, cy) { return cx >= 1 && cy >= 1 && cx < w && cy < h && ok[cy * w + cx] === 1; } };
  }

  // BFS über Ankerpunkte (4er-Nachbarschaft) -> Int32Array Distanzen (−1 = unerreichbar)
  function bfs(m, starts) {
    const w = m.w, h = m.h; const d = new Int32Array(w * h).fill(-1);
    const q = [];
    for (const s of starts) if (m.geht(s.cx, s.cy) && d[s.cy * w + s.cx] < 0) { d[s.cy * w + s.cx] = 0; q.push(s.cx, s.cy); }
    for (let i = 0; i < q.length; i += 2) {
      const cx = q[i], cy = q[i + 1], v = d[cy * w + cx];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!m.geht(nx, ny) || d[ny * w + nx] >= 0) continue;
        d[ny * w + nx] = v + 1; q.push(nx, ny);
      }
    }
    return d;
  }

  // Kürzester Weg von a nach b (Listen von { cx, cy }, ohne den Start); null wenn keiner. maxKnoten begrenzt die Suche.
  function weg(m, a, b, maxKnoten) {
    if (!m.geht(a.cx, a.cy) || !m.geht(b.cx, b.cy)) return null;
    const w = m.w; const vor = new Int32Array(w * m.h).fill(-2);
    const q = [a.cx, a.cy]; vor[a.cy * w + a.cx] = -1;
    let n = 0;
    for (let i = 0; i < q.length; i += 2) {
      const cx = q[i], cy = q[i + 1];
      if (cx === b.cx && cy === b.cy) {
        const out = []; let c = cy * w + cx;
        while (vor[c] !== -1) { out.push({ cx: c % w, cy: Math.floor(c / w) }); c = vor[c]; }
        return out.reverse();
      }
      if (maxKnoten && ++n > maxKnoten) return null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!m.geht(nx, ny) || vor[ny * w + nx] !== -2) continue;
        vor[ny * w + nx] = cy * w + cx; q.push(nx, ny);
      }
    }
    return null;
  }

  // nächster Ankerpunkt (Chebyshev-Ring) zu einer Kachel (tx, ty), den das Monster einnehmen kann; null, wenn keiner im Radius
  function naechster(m, tx, ty, radius) {
    let best = null, bd = Infinity;
    for (let dy = -radius; dy <= radius + 1; dy++) for (let dx = -radius; dx <= radius + 1; dx++) {
      const cx = tx + dx, cy = ty + dy;
      if (!m.geht(cx, cy)) continue;
      const d = Math.hypot(cx - (tx + 0.5), cy - (ty + 0.5));
      if (d < bd) { bd = d; best = { cx, cy }; }
    }
    return best;
  }

  const mitte = (p) => ({ x: p.cx * TILE, y: p.cy * TILE });
  const ankerVon = (x, y) => ({ cx: Math.round(x / TILE), cy: Math.round(y / TILE) });

  // Prüfregeln der Monster-Karte (karte.meta.monster): Fehlerliste [{ code, msg, x, y }]
  //   K-MONSTER-PULT   das Monster erreicht jedes Pult (Umfeld), sonst lockt ein Hack nichts
  //   K-MONSTER-FLUCHT von jedem Pult führt ein Spielerweg (Kachel-BFS, Luken zählen) ≤ maxFlucht Schritte in den Kriechgang (Hauptnetz)
  //   K-MONSTER-KRIECH jeder Kriechgang-Boden (1 breit) ist für die Monstermaske unerreichbar, und es gibt ein Kriechnetz
  function pruefen(karte, opts) {
    const o = opts || {};
    const maxFlucht = o.maxFlucht || 24;
    const F = [];
    const m = maske(karte);
    const r = m.raster; const w = karte.w, h = karte.h;
    const pulte = (karte.anker || []).filter((a) => a.rolle === 'terminal');
    const ank = (karte.anker || []).find((a) => a.rolle === 'abholpunkt' && a.ankunft) || (karte.anker || []).find((a) => a.rolle === 'abholpunkt');
    if (!ank) { F.push({ code: 'K-MONSTER-PULT', msg: 'kein Abholpunkt (Ankunft)', x: 0, y: 0 }); return F; }
    const start = naechster(m, ank.x, ank.y, 4);
    if (!start) { F.push({ code: 'K-MONSTER-PULT', msg: 'Ankunft: kein Platz für das Monster in der Nähe', x: ank.x, y: ank.y }); return F; }
    const dist = bfs(m, [start]);
    for (const p of pulte) {
      const n = naechster(m, p.x, p.y, 1);   // das Monster muss bis auf eine Kachel an das Pult heran
      if (!n || dist[n.cy * w + n.cx] < 0) F.push({ code: 'K-MONSTER-PULT', msg: `${p.id}: das Monster erreicht es nicht`, x: p.x, y: p.y });
    }
    // Kriechgang: begehbare Kacheln, die kein Ankerpunkt-Fußabdruck abdeckt und die nicht Teil eines Raums/Gangs sind: Boden mit höchstens 1 Breite
    const kriech = new Uint8Array(w * h);
    let nKriech = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!r.begehbar(x, y) || r.tuer(x, y)) continue;
      let abgedeckt = false;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (m.geht(x + dx, y + dy)) { abgedeckt = true; break; }
      if (!abgedeckt) { kriech[y * w + x] = 1; nKriech++; }
    }
    // Ist ein Pult von einem Kriechgang-Boden aus (Spieler) schnell erreichbar? Kachel-BFS über Begehbares inklusive Türen/Luken
    if (nKriech === 0) F.push({ code: 'K-MONSTER-KRIECH', msg: 'kein Kriechgang (1 breit) vorhanden', x: 0, y: 0 });
    else {
      const starts = []; for (let i = 0; i < w * h; i++) if (kriech[i]) starts.push([i % w, Math.floor(i / w)]);
      const dk = K.bfs(w, h, (x, y) => r.durchgang(x, y), starts, null);
      for (const p of pulte) {
        let best = -1;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = p.x + dx, y = p.y + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; const v = dk[y * w + x]; if (v >= 0 && (best < 0 || v < best)) best = v; }
        if (best < 0 || best > maxFlucht) F.push({ code: 'K-MONSTER-FLUCHT', msg: `${p.id}: Kriechgang nur in ${best < 0 ? '∞' : best} Schritten (max. ${maxFlucht})`, x: p.x, y: p.y });
      }
    }
    return F;
  }

  return { TILE, FUSS, maske, bfs, weg, naechster, mitte, ankerVon, pruefen, objektKacheln };
});
