// Bewegte Asteroiden als deterministische Drift (CONTRACT-W2 §3.3 Nr. 5, Team ALL). UMD: window.Shared_Drift / require.
// Die Lage eines Brockens ist eine reine Funktion der Spielzeit. Server (space.js, pilot.js) und Client (render.js)
// rechnen mit DIESER Datei. Gesendet werden nur die Bahnparameter (Feld `b` am Brocken, im 15er-Schema wie bisher).
//
// Brocken: { id, x, y, r, seed, b? }. Ohne `b` steht der Brocken still (Kampagne): Lage = (x, y), Drehung 0.
// b = [richtung, tempo, amplitude, phase, drehung] (ganzzahlig, kompakt fürs Netz):
//   richtung  Bahnrichtung in Milliradiant
//   tempo     Höchsttempo in px/s (in der Bahnmitte)
//   amplitude halbe Bahnlänge in px – der Brocken pendelt auf einer Strecke (x, y) ± amplitude · (cos, sin)(richtung)
//   phase     Startphase in Milliradiant
//   drehung   Eigendrehung in Milliradiant/s
// Lage(t) = Mitte + Richtung · amplitude · sin(tempo / amplitude · t + phase): weich, beschränkt, ohne Sprünge.
// Die Bahnen werden beim Erzeugen so gewählt, dass sich zwei Brocken nie berühren (Abstand der Strecken).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Drift = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const M = 1000;

  function bahn(a) {
    const b = a && a.b;
    if (!b || b.length < 5) return null;
    const amp = Math.max(1, +b[2] || 0);
    return { dir: (+b[0] || 0) / M, v: +b[1] || 0, amp, ph: (+b[3] || 0) / M, rot: (+b[4] || 0) / M };
  }

  // Lage eines Brockens zur Spielzeit t -> { x, y, vx, vy, rot }
  function lage(a, t) {
    const q = bahn(a);
    if (!q) return { x: a.x, y: a.y, vx: 0, vy: 0, rot: 0 };
    const w = q.v / q.amp;
    const arg = w * (+t || 0) + q.ph;
    const s = q.amp * Math.sin(arg);
    const ds = q.v * Math.cos(arg);
    const cx = Math.cos(q.dir), cy = Math.sin(q.dir);
    return { x: a.x + cx * s, y: a.y + cy * s, vx: cx * ds, vy: cy * ds, rot: q.rot * (+t || 0) };
  }

  // Alle Brocken zur Zeit t -> [{ id, x, y, r, vx, vy, rot }]. Stehen alle still, kommt die Liste selbst zurück
  // (keine Kopie, Kampagne unverändert). Ergebnis je (Liste, t) zwischengespeichert.
  const cache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function jetzt(list, t) {
    if (!list || !list.length) return list || [];
    if (!bewegt(list)) return list;
    const c = cache && cache.get(list);
    if (c && c.t === t) return c.out;
    const out = list.map((a) => { const l = lage(a, t); return { id: a.id, x: l.x, y: l.y, r: a.r, vx: l.vx, vy: l.vy, rot: l.rot, seed: a.seed }; });
    if (cache) cache.set(list, { t, out });
    return out;
  }
  function bewegt(list) {
    for (const a of list || []) if (a && a.b) return true;
    return false;
  }

  // Endpunkte der Bahnstrecke (für das Erzeugen: Abstand zwischen Bahnen und zu Schutzpunkten)
  function strecke(a) {
    const q = bahn(a);
    if (!q) return { x1: a.x, y1: a.y, x2: a.x, y2: a.y };
    const dx = Math.cos(q.dir) * q.amp, dy = Math.sin(q.dir) * q.amp;
    return { x1: a.x - dx, y1: a.y - dy, x2: a.x + dx, y2: a.y + dy };
  }
  // Abstand Punkt–Strecke
  function punktStrecke(px, py, s) {
    const sx = s.x2 - s.x1, sy = s.y2 - s.y1; const l2 = sx * sx + sy * sy;
    let u = l2 > 0 ? ((px - s.x1) * sx + (py - s.y1) * sy) / l2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    return Math.hypot(px - (s.x1 + sx * u), py - (s.y1 + sy * u));
  }
  // Abstand Strecke–Strecke (2D)
  function streckeStrecke(a, b) {
    const kreuz = (ax, ay, bx, by) => ax * by - ay * bx;
    const d1x = a.x2 - a.x1, d1y = a.y2 - a.y1, d2x = b.x2 - b.x1, d2y = b.y2 - b.y1;
    const den = kreuz(d1x, d1y, d2x, d2y);
    if (Math.abs(den) > 1e-9) {
      const u = kreuz(b.x1 - a.x1, b.y1 - a.y1, d2x, d2y) / den, v = kreuz(b.x1 - a.x1, b.y1 - a.y1, d1x, d1y) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return 0;
    }
    return Math.min(punktStrecke(a.x1, a.y1, b), punktStrecke(a.x2, a.y2, b), punktStrecke(b.x1, b.y1, a), punktStrecke(b.x2, b.y2, a));
  }

  // Erster Schnitt eines Strahls (x1,y1)->(x2,y2) mit einem Brocken der Liste -> { t (0..1), a } | null
  function strahlTrifft(list, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1; const l2 = dx * dx + dy * dy;
    if (!(l2 > 0)) return null;
    let best = null;
    for (const a of list || []) {
      const fx = x1 - a.x, fy = y1 - a.y;
      const b = fx * dx + fy * dy, c = fx * fx + fy * fy - a.r * a.r;
      if (c <= 0) { if (!best || best.t > 0) best = { t: 0, a }; continue; }   // Start im Brocken
      const disc = b * b - l2 * c;
      if (disc < 0 || b > 0) continue;
      const t = (-b - Math.sqrt(disc)) / l2;
      if (t >= 0 && t <= 1 && (!best || t < best.t)) best = { t, a };
    }
    return best;
  }

  return { lage, jetzt, bewegt, bahn, strecke, punktStrecke, streckeStrecke, strahlTrifft, MILLI: M };
});
