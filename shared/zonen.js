// Zonen mit Wirkung (CONCEPT-SL6). UMD: window.Shared_Zonen / require. Reine Funktionen, kein Zufall außer dem festen Seed.
// Eine Zone ist ein Bereich einer Raumszene mit Rand und Werten. Sie steht als Daten in `scene.zonen` (nicht im Snapshot);
// Server (server/sim/zonen.js) und Client (render.js) rechnen mit DIESER Datei.
//
// Zone: { id, form: 'kreis'|'ring'|'rechteck', x, y, r | r0, r1 | w, h,
//         drift?: { winkel, staerke },   Positionsversatz in px/s (Winkel in Radiant, 0 = +x, y nach unten)
//         tang?: px/s,                   Versatz um den Mittelpunkt (positiv = im Uhrzeigersinn, Strömung um einen Gasriesen)
//         hitze?, schaden?,              Hitze je Sekunde (auf die Systeme), Hüllenschaden je Sekunde
//         sicht?: 0..1,                  Faktor auf die Sensorreichweite (mehrere Zonen: Produkt)
//         ertrag?: { ziel, rate },       ziel 'fracht:<art>' | 'zaehler:<id>', rate = Einheiten je Sekunde
//         sichtbarFuer?: 'alle'|'ops'|'karte',   'ops' sieht die Ops sofort, alle anderen nach dem Scan/Erkunden; 'karte' erst nach dem Erkunden
//         name?, farbe? }
// Werte mehrerer Zonen an einem Punkt addieren sich (Sicht: Produkt). Es gibt keine Pulse: Zonen stehen still.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Zonen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function drin(z, x, y) {
    if (!z) return false;
    if (z.form === 'rechteck') return Math.abs(x - z.x) <= (z.w || 0) / 2 && Math.abs(y - z.y) <= (z.h || 0) / 2;
    const d = Math.hypot(x - z.x, y - z.y);
    if (z.form === 'ring') return d >= (z.r0 || 0) && d < (z.r1 || 0);
    return d < (z.r || 0);
  }

  // Alle Zonen, in denen der Punkt liegt
  function an(zonen, x, y) {
    const out = [];
    for (const z of zonen || []) if (drin(z, x, y)) out.push(z);
    return out;
  }

  // Summe der Wirkung an einem Punkt -> { vx, vy, hitze, schaden, sicht, ertrag: [{ id, ziel, rate }], ids, mx, my }
  // (mx, my = Mittelpunkt der Zone mit dem größten Schaden, für die Treffer-Richtung)
  function wirkung(zonen, x, y) {
    const w = { vx: 0, vy: 0, hitze: 0, schaden: 0, sicht: 1, ertrag: [], ids: [], mx: null, my: null };
    let best = -1;
    for (const z of an(zonen, x, y)) {
      w.ids.push(z.id);
      if (z.drift) { const a = +z.drift.winkel || 0, s = +z.drift.staerke || 0; w.vx += Math.cos(a) * s; w.vy += Math.sin(a) * s; }
      if (z.tang) {
        const dx = x - z.x, dy = y - z.y, d = Math.hypot(dx, dy) || 1;
        w.vx += (-dy / d) * z.tang; w.vy += (dx / d) * z.tang;   // senkrecht zum Radius, im Uhrzeigersinn (y nach unten)
      }
      w.hitze += +z.hitze || 0;
      w.schaden += +z.schaden || 0;
      if (z.sicht != null) w.sicht *= Math.max(0, +z.sicht);
      if (z.ertrag && z.ertrag.ziel && +z.ertrag.rate > 0) w.ertrag.push({ id: z.id, ziel: String(z.ertrag.ziel), rate: +z.ertrag.rate });
      if ((+z.schaden || 0) > best) { best = +z.schaden || 0; w.mx = z.x; w.my = z.y; }
    }
    return w;
  }

  // Darf der Betrachter die Zone sehen? ctx = { ops: bool, bekannt: Set|Array der Zonen-IDs }
  function sichtbar(z, ctx) {
    const f = (z && z.sichtbarFuer) || 'alle';
    if (f === 'alle') return true;
    const b = ctx && ctx.bekannt;
    const kennt = !!b && (typeof b.has === 'function' ? b.has(z.id) : b.indexOf(z.id) >= 0);
    if (f === 'ops') return !!(ctx && ctx.ops) || kennt;
    return kennt;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Standard-Atmosphäre eines Gasriesen (Faktoren auf den Planetenradius, von außen nach innen). Werte sind Startwerte (tune zonen.gasriese).
  //   rand: sichtbar für alle; die inneren Ringe zeigt erst Erkundung oder Sonde ('karte').
  const GAS = {
    ringe: [
      { name: 'Hochatmosphäre', von: 1.9, bis: 1.45, sicht: 0.85, hitze: 2, schaden: 0, tang: 4, sichtbarFuer: 'alle' },
      { name: 'Wolkendecke', von: 1.45, bis: 1.05, sicht: 0.65, hitze: 4, schaden: 0.1, tang: 8, sichtbarFuer: 'karte' },
      { name: 'Schöpfschicht', von: 1.05, bis: 0.6, sicht: 0.45, hitze: 7, schaden: 0.25, tang: 11, sichtbarFuer: 'karte', rate: 0.08 },
      { name: 'Tiefe', von: 0.6, bis: 0, sicht: 0.25, hitze: 12, schaden: 1.0, tang: 14, sichtbarFuer: 'karte', rate: 0.16 },
    ],
    zellen: { n: 3, r: [60, 110], staerke: [22, 34], schaden: 0.3 },
    ziel: 'fracht:deuterium',
  };

  // Zonen für einen Gasriesen { x, y, r } -> [Zone]. Deterministisch aus Lage und Radius (Server und Client erzeugen dasselbe).
  function gasriese(planet, cfg, idPrefix) {
    const G = Object.assign({}, GAS, cfg || {});
    const pre = idPrefix || 'gas';
    const out = [];
    G.ringe.forEach((g, i) => {
      const z = { id: pre + '_ring' + i, form: g.bis > 0 ? 'ring' : 'kreis', x: planet.x, y: planet.y, name: g.name,
        sicht: g.sicht, hitze: g.hitze, schaden: g.schaden, tang: g.tang, sichtbarFuer: g.sichtbarFuer || 'karte' };
      if (g.bis > 0) { z.r0 = Math.round(planet.r * g.bis); z.r1 = Math.round(planet.r * g.von); } else z.r = Math.round(planet.r * g.von);
      if (g.rate) z.ertrag = { ziel: G.ziel, rate: g.rate };
      out.push(z);
    });
    // Sturmzellen: kleine Kreise mit Drift in der Wolkendecke und der Schöpfschicht (Hindernis für den Navigator, kein Ertrag)
    const r = mulberry32(((planet.x * 73856093) ^ (planet.y * 19349663) ^ (planet.r * 83492791)) >>> 0);
    const Z = G.zellen;
    for (let i = 0; i < Z.n; i++) {
      const ring = G.ringe[1 + Math.floor(r() * 2)];
      const rr = planet.r * (ring.bis + r() * (ring.von - ring.bis));
      const ang = r() * Math.PI * 2;
      out.push({ id: pre + '_sturm' + i, form: 'kreis', x: Math.round(planet.x + Math.cos(ang) * rr), y: Math.round(planet.y + Math.sin(ang) * rr),
        r: Math.round(Z.r[0] + r() * (Z.r[1] - Z.r[0])), name: 'Sturmzelle', schaden: Z.schaden,
        drift: { winkel: Math.round((r() * Math.PI * 2) * 100) / 100, staerke: Math.round(Z.staerke[0] + r() * (Z.staerke[1] - Z.staerke[0])) },
        sichtbarFuer: 'karte' });
    }
    return out;
  }

  return { drin, an, wirkung, sichtbar, gasriese, GAS };
});
