// Sichtlinie und Deckung auf dem Kachelraster (CONTRACT-M2 §2.2/§4). UMD: window.Shared_Los / require.
// Studioleitung. Reine Funktionen, kein Zustand. Server (Treffer, KI, Sichtbarkeit) und Client (Nebel) rechnen gleich.
// sightBlocked(tx, ty) -> true, wenn die Kachel die Sicht blockiert (solid und nicht low; Tor zu usw. entscheidet der Aufrufer).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Los = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TILE = 32;

  // Standard-Sichtsperre für eine Karte aus shared/maps.js; isSolid(tx,ty) liefert den aktuellen Zustand (Tore, dünne Wände).
  function sightFn(map, isSolid) {
    return function (tx, ty) {
      var info = map.info(tx, ty);
      var solid = isSolid ? isSolid(tx, ty) : !!info.solid;
      return solid && !info.low;
    };
  }

  // Exakte Rasterdurchquerung (Amanatides/Woo) von Pixel (x0,y0) nach (x1,y1).
  // visit(tx, ty) wird für jede durchquerte Kachel (ohne Startkachel) aufgerufen; gibt visit true zurück, bricht der Lauf ab.
  // Rückgabe: true, wenn abgebrochen wurde.
  function walk(x0, y0, x1, y1, visit) {
    var tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
    var ex = Math.floor(x1 / TILE), ey = Math.floor(y1 / TILE);
    var dx = x1 - x0, dy = y1 - y0;
    var sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    var tdx = dx !== 0 ? Math.abs(TILE / dx) : Infinity, tdy = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    var nx = dx > 0 ? (tx + 1) * TILE : tx * TILE, ny = dy > 0 ? (ty + 1) * TILE : ty * TILE;
    var tmx = dx !== 0 ? Math.abs((nx - x0) / dx) : Infinity, tmy = dy !== 0 ? Math.abs((ny - y0) / dy) : Infinity;
    var guard = 0;
    while ((tx !== ex || ty !== ey) && guard++ < 512) {
      if (tmx < tmy) { tmx += tdx; tx += sx; } else { tmy += tdy; ty += sy; }
      if (visit(tx, ty)) return true;
    }
    return false;
  }

  // Freie Sicht zwischen zwei Pixelpunkten? Die Zielkachel selbst zählt nicht als Sperre.
  function lineOfSight(blocked, x0, y0, x1, y1) {
    var ex = Math.floor(x1 / TILE), ey = Math.floor(y1 / TILE);
    return !walk(x0, y0, x1, y1, function (tx, ty) { return (tx !== ex || ty !== ey) && blocked(tx, ty); });
  }

  // Deckung des Ziels (tx,ty-Pixel) gegen einen Schützen (sx,sy-Pixel): 0 keine, 1 halb, 2 voll.
  // Zählt nur Deckungskacheln (info.cover), die direkt an die Kachel des Ziels grenzen (8er-Nachbarschaft)
  // und auf der Linie Schütze -> Ziel liegen. Flanke = Linie läuft an der Deckung vorbei = 0.
  // crouched (optional, M2 §15): Das Ziel ist geduckt -> niedrige Deckung (low) zählt als volle Deckung (2).
  function coverAgainst(map, isSolid, sx, sy, x, y, crouched) {
    var ttx = Math.floor(x / TILE), tty = Math.floor(y / TILE);
    var best = 0;
    walk(sx, sy, x, y, function (cx, cy) {
      if (Math.abs(cx - ttx) > 1 || Math.abs(cy - tty) > 1 || (cx === ttx && cy === tty)) return false;
      var info = map.info(cx, cy);
      var solid = isSolid ? isSolid(cx, cy) : !!info.solid;
      if (solid && info.cover) best = Math.max(best, crouched && info.low ? 2 : info.cover);
      return best >= 2;
    });
    return best;
  }

  // ---- M2 §15 Ducken ----
  // Ist (tx,ty) eine niedrige Deckungskachel (low, aktuell solid) in der 8er-Nachbarschaft der Pixelposition (px,py)?
  function lowGuard(map, isSolid, px, py, tx, ty) {
    var cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
    if (Math.abs(tx - cx) > 1 || Math.abs(ty - cy) > 1 || (tx === cx && ty === cy)) return false;
    var info = map.info(tx, ty);
    if (!info.low) return false;
    return isSolid ? !!isSolid(tx, ty) : !!info.solid;
  }
  // Steht eine geduckte Figur an (px,py) neben niedriger Deckung?
  function nextToLow(map, isSolid, px, py) {
    var cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && lowGuard(map, isSolid, px, py, cx + dx, cy + dy)) return true;
    }
    return false;
  }
  // Sichtsperre mit Ducken: wie blocked, zusätzlich sperren die low-Kacheln rund um jeden geduckten Punkt
  // (crouchAt: Liste von Pixelpunkten {x,y}). Die Sperre wirkt in beide Richtungen. Leere Liste -> blocked unverändert.
  function crouchSight(map, isSolid, blocked, crouchAt) {
    var pts = (crouchAt || []).filter(function (p) { return p && isFinite(p.x) && isFinite(p.y); });
    if (!pts.length) return blocked;
    return function (tx, ty) {
      if (blocked(tx, ty)) return true;
      for (var i = 0; i < pts.length; i++) if (lowGuard(map, isSolid, pts[i].x, pts[i].y, tx, ty)) return true;
      return false;
    };
  }
  // Sichtsperre für die Linie zwischen zwei Figuren a und b ({x, y, crouch|cr}); geduckte Endpunkte zählen nach §15.
  function sightFnFor(map, isSolid, a, b) {
    var pts = [];
    if (a && (a.crouch || a.cr)) pts.push(a);
    if (b && (b.crouch || b.cr)) pts.push(b);
    return crouchSight(map, isSolid, sightFn(map, isSolid), pts);
  }

  // Alle sichtbaren Kacheln im Radius (Kacheln) von Pixel (x,y) – für Nebel/Fog of War. Rückgabe: Set von "tx,ty".
  function visibleTiles(blocked, x, y, radiusTiles, w, h) {
    var out = new Set();
    var cx = Math.floor(x / TILE), cy = Math.floor(y / TILE), r = radiusTiles;
    for (var ty = Math.max(0, cy - r); ty <= Math.min(h - 1, cy + r); ty++) {
      for (var tx = Math.max(0, cx - r); tx <= Math.min(w - 1, cx + r); tx++) {
        if ((tx - cx) * (tx - cx) + (ty - cy) * (ty - cy) > r * r) continue;
        if (lineOfSight(blocked, x, y, tx * TILE + TILE / 2, ty * TILE + TILE / 2)) out.add(tx + ',' + ty);
      }
    }
    return out;
  }

  return { TILE: TILE, sightFn: sightFn, walk: walk, lineOfSight: lineOfSight, coverAgainst: coverAgainst, visibleTiles: visibleTiles,
    lowGuard: lowGuard, nextToLow: nextToLow, crouchSight: crouchSight, sightFnFor: sightFnFor };
});
