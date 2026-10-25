// Asset-Klassen für check:assets, rein (ohne Dateizugriff), damit Tests sie direkt prüfen können.
//
// Klasse `bau` (ORT-01 Integration, Kai 2026-10-25): Gebäude, Türme und Leitstücke der Orte (Tag `bau` im Manifest).
//   Höhe:   eigene Grenze BAU_H (statt 2,2 m für Props und 3 m für Wände); wer höher baut, ist ein Fehler.
//   Budget: je belegter Kachel hart 2.500 Dreiecke (Ziel 1.500), die Kacheln stammen aus dem Fußabdruck
//           (aufgerundete Fläche), ohne die Obergrenze von 4 Kacheln der Detail-Props. Eine 8×5-Halle darf also bis 100.000
//           (Summe je Bühne misst `VoxelKit.stats()`, nicht dieses Modell).
//   Die alten Behelfe (Tag `wall` an Hallen und Türmen) sind damit überflüssig.

export const BAU_H = 10.0;
export const BAU_DREIECKE_JE_KACHEL = 2500;
export const BAU_ZIEL_JE_KACHEL = 1500;

// Die Klasse gilt nur für ort/- und kit/-IDs (Gebäude, Türme, Kit-Teile der Orte) und zwei Bestandsmodelle ohne ort/-Präfix (Standarte, Laterne: 3,6 m / 2,6 m
// hohe Leit-Anker an Wegkanten). Ein bau-Tag an anderen IDs (Lerche, Props, Figuren) hebt weder Höhe noch Budget an.
export const BAU_BESTAND = ['rom/standarte', 'rom/laterne'];
export const bauId = (id) => /^(ort|kit)\//.test(id || '') || BAU_BESTAND.includes(id);
export const isBau = (e) => Array.isArray(e && e.tags) && e.tags.includes('bau') && bauId(e.id);

/** Gemessene Grundfläche (m²) gegen den Footprint: 'ok' | 'warnung' (< 50 %) | 'fehler' (< 25 %, Modell fast leer oder Footprint zu groß: das Budget wäre sonst zu großzügig). */
export function bauFlaecheUrteil(gemessenBreite, gemessenTiefe, footprint) {
  const fp = Array.isArray(footprint) && footprint.length === 2 ? footprint : [1, 1];
  const soll = fp[0] * fp[1];
  if (!(soll > 0)) return 'ok';
  const q = (gemessenBreite * gemessenTiefe) / soll;
  return q < 0.25 ? 'fehler' : q < 0.5 ? 'warnung' : 'ok';
}

/** Belegte Kacheln aus dem Fußabdruck [x, z] in Kacheln (Meter): aufgerundete Fläche, mindestens 1. */
export function bauKacheln(footprint) {
  const fp = Array.isArray(footprint) && footprint.length === 2 ? footprint : [1, 1];
  return Math.max(1, Math.ceil(fp[0] * fp[1] - 1e-9));
}

export function bauBudget(footprint) {
  const t = bauKacheln(footprint);
  return { n: BAU_DREIECKE_JE_KACHEL * t, ziel: BAU_ZIEL_JE_KACHEL * t, tiles: t, what: `Bauteil ${t} Kacheln` };
}

/** Höhenurteil der Klasse: 'ok' | 'fehler'. */
export const bauHoehe = (maxH, tol = 0) => (maxH > BAU_H + tol ? 'fehler' : 'ok');
