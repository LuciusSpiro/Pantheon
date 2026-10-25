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

export const isBau = (e) => Array.isArray(e && e.tags) && e.tags.includes('bau');

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
