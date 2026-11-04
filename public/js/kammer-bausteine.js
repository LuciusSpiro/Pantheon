// CHA-01 Nacharbeit Gesamt S3: gemeinsame Zeichenbausteine für die Oberflächen, die Charakterporträts zeigen (Kleiderkammer: kammer-ui.js, Startmenü: menue-ui.js).
// Reine Darstellung ohne Regeln und ohne eigenen Zustand außer dem Bildspeicher der Vorschaudateien. Teilnamen und Katalog kommen aus `Charaktere` (Store/Actions).
// Globales `KammerBausteine`:
//   vorschau(datei)                       -> Image der Vorschaudatei (public/voxel/sprites/) oder null, solange es nicht geladen ist
//   bildIn(ctx, bild, r, oben?)           -> Bild in das Rechteck einpassen (mittig, mit `oben` oben bündig), geglättet
//   portraetIn(ctx, r, karte, grund, art?, yaw?) -> Hintergrund `grund`, darüber das Porträt dieser Karte: live über KammerBild; solange es dort noch nicht fertig ist, nur die Platte (nie ein Standardkopf als Platzhalter);
//                                          erst wenn Live-Bilder gar nicht möglich sind (kein WebGL, ?render=2d), die Gesichtsvorschau des Katalogs; ohne Karte nur der Hintergrund
(function () {
  'use strict';
  const BILDER = {};   // Vorschaudatei -> Image
  function vorschau(datei) {
    if (!datei) return null;
    let im = BILDER[datei];
    if (!im) { im = BILDER[datei] = new Image(); im.src = '/voxel/sprites/' + datei; }
    return im.complete && im.naturalWidth ? im : null;
  }
  // Bild in das Rechteck einpassen (mittig, bei oben: oben bündig), geglättet (Quellbilder sind doppelt so groß wie das Fenster)
  function bildIn(c, im, r, oben) {
    if (!im) return;
    const sw = im.width || im.naturalWidth, sh = im.height || im.naturalHeight;
    const s = Math.min(r.w / sw, r.h / sh), w = sw * s, h = sh * s;
    c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
    c.drawImage(im, Math.round(r.x + (r.w - w) / 2), Math.round(r.y + (oben ? 0 : (r.h - h) / 2)), Math.round(w), Math.round(h));
    c.restore();
  }
  function portraetIn(c, r, karte, grund, art, yaw) {
    c.fillStyle = grund; c.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
    if (!karte) return;
    const KB = window.KammerBild;
    if (KB && KB.moeglich()) { const b = KB.bild(karte, art || 'portraet', yaw); if (b) bildIn(c, b, r, art === 'nah'); return; }   // noch in Arbeit: die Platte bleibt, jedes Frame fragt neu (der Cache-Schlüssel steckt im Karteninhalt)
    const t = window.Charaktere ? Charaktere.teil('frisur', karte.frisur) : null;
    bildIn(c, t && vorschau(t.vorschau), r, art === 'nah');
  }
  window.KammerBausteine = { vorschau, bildIn, portraetIn };
})();
