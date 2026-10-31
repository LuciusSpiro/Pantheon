// BOD-02 P4: Stellungen und Sichtbonus. UMD: window.Shared_Stellung / require. Reine Funktionen, kein Zustand.
// Eine Stellung ist ein markierter Platz (Graben-Sohle, erhöhter Posten, später Bunkerscharte): ein Bereich der Karte mit
// `rolle: 'stellung'` (festkarte/1: decks[0].abschnitte.<a>.varianten.<v>.bereiche.<id> = { rects: [[x,y,w,h]...], rolle: 'stellung' }).
// Wer darin steht, sieht und schießt `awayCombat.sicht.stellung` (16) Kacheln statt sightTiles (10); wer auf einem Anker
// `aussicht` (Posten, ±1 Kachel) steht, sieht `sicht.aussicht` (22). Karten ohne solchen Bereich bleiben unverändert.
// `karte` ist die Server-Karte (Vertrag Karte) oder die Client-Karte aus dem Payload awayMap: beide tragen `bereiche`
// { id: { rects, rolle } }, `anker` (Objekte bzw. Zeilen [id, rolle, x, y, ...]) und `w`/`h` bzw. `rows`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Stellung = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TILE = 32;
  var ROLLE = 'stellung';
  var cache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;   // bereiche-Objekt -> Raster (Karten ändern sich nicht)

  function masse(karte) {
    var w = karte.w || (karte.rows && karte.rows[0] ? karte.rows[0].length : 0);
    var h = karte.h || (karte.rows ? karte.rows.length : 0);
    return { w: w, h: h };
  }
  function rastern(karte) {
    var b = karte && karte.bereiche;
    if (!b || typeof b !== 'object') return null;
    var hit = cache && cache.get(b);
    if (hit) return hit;
    var m = masse(karte);
    var g = new Uint8Array(Math.max(0, m.w * m.h));
    var rects = [];
    var ids = Object.keys(b).sort();
    for (var i = 0; i < ids.length; i++) {
      var o = b[ids[i]];
      if (!o || o.rolle !== ROLLE || !Array.isArray(o.rects)) continue;
      for (var j = 0; j < o.rects.length; j++) {
        var r = o.rects[j];
        rects.push([r[0], r[1], r[2], r[3]]);
        for (var y = r[1]; y < r[1] + r[3]; y++) for (var x = r[0]; x < r[0] + r[2]; x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h) g[y * m.w + x] = 1;
      }
    }
    var out = { w: m.w, h: m.h, g: g, rects: rects };
    if (cache) cache.set(b, out);
    return out;
  }
  // Steht die Kachel (tx, ty) in einer Stellung?
  function istIn(karte, tx, ty) {
    var R = rastern(karte);
    if (!R || tx < 0 || ty < 0 || tx >= R.w || ty >= R.h) return false;
    return R.g[ty * R.w + tx] === 1;
  }
  // Die Rechtecke aller Stellungen [[x,y,w,h]] (Kacheln)
  function rects(karte) { var R = rastern(karte); return R ? R.rects.map(function (r) { return r.slice(); }) : []; }
  function ankerPos(a) { return Array.isArray(a) ? { rolle: a[1], x: a[2], y: a[3] } : a; }
  // Steht (px, py) [Pixel] auf einem Posten (Anker aussicht, ±1 Kachel)?
  function amPosten(karte, px, py) {
    var an = (karte && karte.anker) || [];
    var tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    for (var i = 0; i < an.length; i++) {
      var a = ankerPos(an[i]);
      if (a && a.rolle === 'aussicht' && Math.abs(a.x - tx) <= 1 && Math.abs(a.y - ty) <= 1) return true;
    }
    return false;
  }
  // Alle Stellungsplätze als Kachelliste [{ x, y, posten }] (zeilenweise). solid(tx, ty) -> true filtert unbegehbare Kacheln heraus.
  function plaetze(karte, solid) {
    var R = rastern(karte);
    var out = [];
    if (!R) return out;
    for (var y = 0; y < R.h; y++) for (var x = 0; x < R.w; x++) {
      if (!R.g[y * R.w + x] || (solid && solid(x, y))) continue;
      out.push({ x: x, y: y, posten: amPosten(karte, x * TILE + TILE / 2, y * TILE + TILE / 2) });
    }
    return out;
  }
  // Sichtradius in Kacheln an Pixelposition (px, py): cfg { normal, stellung, aussicht } (CONFIG.awayCombat.sightTiles / sicht.stellung / sicht.aussicht).
  // Posten vor Stellung vor normal; nie weniger als normal.
  function sichtKacheln(karte, px, py, cfg) {
    var normal = Number(cfg && cfg.normal) || 10;
    if (!karte) return normal;
    var best = normal;
    if (amPosten(karte, px, py)) best = Math.max(best, Number(cfg.aussicht) || 22);
    if (best < (Number(cfg.stellung) || 0) && istIn(karte, Math.floor(px / TILE), Math.floor(py / TILE))) best = Number(cfg.stellung);
    return best;
  }
  // Das Verhältnis zum Normalwert (Schussfenster engageBox wächst mit: 16 -> ×1,6, 22 -> ×2,2)
  function faktor(kacheln, normal) { return Math.max(1, kacheln / (Number(normal) || 10)); }
  return { ROLLE: ROLLE, istIn: istIn, rects: rects, amPosten: amPosten, plaetze: plaetze, sichtKacheln: sichtKacheln, faktor: faktor };
});
