// Gemeinsame Bewegungs- und Winkelhilfen (CONTRACT.md §4.4). UMD: window.Shared_Physics / require.
// Server (maßgeblich) und Client (Vorhersage der eigenen Figur) benutzen exakt diese Funktionen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Physics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TILE = 32;

  // Kollidiert eine Hitbox (Mittelpunkt x/y = Füße, Breite w, Höhe h) mit soliden Kacheln?
  // isSolid(tx, ty) -> bool
  function boxHits(isSolid, x, y, w, h) {
    const x0 = Math.floor((x - w / 2) / TILE), x1 = Math.floor((x + w / 2 - 0.001) / TILE);
    const y0 = Math.floor((y - h / 2) / TILE), y1 = Math.floor((y + h / 2 - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isSolid(tx, ty)) return true;
    return false;
  }

  // Bewegt achsengetrennt (gleiten an Wänden). Gibt {x, y} zurück.
  // Ecken-Hilfe (QA M1): Läuft man fast gerade auf eine Tür zu und streift nur die Türkante (bis CORNER_ASSIST px
  // daneben), rutscht die Figur quer in die Öffnung, statt an der Kante hängen zu bleiben. Wichtig z. B. vor der
  // Brückentür, wenn ein Leck in der Messe die Figur seitlich zieht.
  const CORNER_ASSIST = 10;
  function cornerShift(isSolid, x, y, w, h, step, axis) {
    // axis 'x': Bewegung in x blockiert -> y verschieben; axis 'y': umgekehrt.
    const s = Math.abs(step);
    for (let o = 1; o <= CORNER_ASSIST; o++) {
      for (const sg of [1, -1]) {
        const ox = axis === 'y' ? sg * o : 0, oy = axis === 'x' ? sg * o : 0;
        const mx = axis === 'x' ? step : 0, my = axis === 'y' ? step : 0;
        if (!boxHits(isSolid, x + ox, y + oy, w, h) && !boxHits(isSolid, x + ox + mx, y + oy + my, w, h)) {
          const k = Math.min(o, s) / o;
          return { x: x + ox * k, y: y + oy * k };
        }
      }
    }
    return null;
  }

  function moveWithCollision(isSolid, x, y, dx, dy, hitbox) {
    const w = hitbox.w, h = hitbox.h;
    let nx = x + dx, ny0 = y;
    if (boxHits(isSolid, nx, y, w, h)) {
      nx = x;
      if (dx !== 0 && Math.abs(dy) < Math.abs(dx) * 0.5) {
        const c = cornerShift(isSolid, x, y, w, h, dx, 'x');
        if (c) { ny0 = c.y; }
      }
    }
    let ny = ny0 + dy;
    if (boxHits(isSolid, nx, ny, w, h)) {
      ny = ny0;
      if (dy !== 0 && Math.abs(dx) < Math.abs(dy) * 0.5 && ny0 === y) {
        const c = cornerShift(isSolid, nx, y, w, h, dy, 'y');
        if (c) { nx = c.x; }
      }
    }
    return { x: nx, y: ny };
  }

  // Winkel auf (-PI, PI] normieren.
  function normAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  }

  // Sektor eines Punktes relativ zum Schiff. Winkel: 0 = +x, im Uhrzeigersinn (y nach unten).
  // 0 = Bug, 1 = Steuerbord, 2 = Heck, 3 = Backbord.
  function sectorOf(shipX, shipY, shipAngle, px, py) {
    const rel = normAngle(Math.atan2(py - shipY, px - shipX) - shipAngle);
    const q = Math.PI / 4;
    if (Math.abs(rel) <= q) return 0;
    if (rel > q && rel <= 3 * q) return 1;
    if (rel < -q && rel >= -3 * q) return 3;
    return 2;
  }

  // Liegt ein Ziel im Feuerbogen? facingDeg/arcDeg in Grad, relativ zum Bug.
  function inArc(shipX, shipY, shipAngle, facingDeg, arcDeg, range, tx, ty) {
    const dx = tx - shipX, dy = ty - shipY;
    if (dx * dx + dy * dy > range * range) return false;
    const rel = normAngle(Math.atan2(dy, dx) - shipAngle - facingDeg * Math.PI / 180);
    return Math.abs(rel) <= (arcDeg * Math.PI / 180) / 2;
  }

  // Kachel -> Pixelmitte und zurück.
  function tileCenter(tx, ty) { return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }; }
  function toTile(px, py) { return { x: Math.floor(px / TILE), y: Math.floor(py / TILE) }; }

  return { TILE, boxHits, moveWithCollision, normAngle, sectorOf, inArc, tileCenter, toTile };
});
