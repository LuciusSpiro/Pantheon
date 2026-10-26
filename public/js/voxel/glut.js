// ORT-01 Glut: Leuchtflächen der ORT-Kits (Rom-Amberrinne, Germanen-Glutfuge) bleiben im Nebel des Krieges hell.
// Gemessen (2026-10-26, Rom-Station, Kommando): Die Amber-Linie (emit 0,6) ist im sichtbaren Bereich #BC700B, im nicht gesehenen
// Bereich #6F584B. Die Mesher-Stufe und der Emissions-Zweig des Shaders liefern das Richtige. Verloren geht die Farbe im
// Nebel-Schritt von kit.js (Entsättigung und Abdunklung nicht gesehener Kacheln), der auch die Leuchtflächen traf.
// Der Schalter wirkt nur für Karten der Kartenart station/aussenposten mit den ORT-Bauweisen rom/germanen. Ruine, Schiff und
// alle anderen Kartenarten bleiben unverändert. Dieses Modul hat keine Abhängigkeiten, damit der Test es ohne Browser lädt.

export const GLUT_ARTEN = ['station', 'aussenposten'];
export const GLUT_BAUWEISEN = ['rom', 'germanen'];

/** Bleiben die Leuchtflächen dieser Karte im Nebel hell? (true nur für ORT-Kits in Station oder Außenposten) */
export function glutAusnahme(art, bauweise) {
  return GLUT_ARTEN.includes(art) && GLUT_BAUWEISEN.includes(bauweise);
}
