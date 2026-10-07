// Auflösungsstufen (Stonehearth-Prinzip): jede Stufe hat ihre eigene Voxelgröße.
// Weltmaß: 1 Kachel = 1 Meter = 1 three.js-Einheit.
export const TIERS = {
  terrain:      { voxelsPerMeter: 1,  label: 'Terrain',     use: 'Boden, Felsen, Gelände' },
  architecture: { voxelsPerMeter: 4,  label: 'Architektur', use: 'Wände, Säulen, Bauten, Plattformen' },
  detail:       { voxelsPerMeter: 16, label: 'Detail',      use: 'Figuren, Props, Konsolen, Waffen, Pflanzen' },
};

export function tierOf(name) {
  const t = TIERS[name];
  if (!t) throw new Error(`Unbekannte Stufe "${name}" (erlaubt: ${Object.keys(TIERS).join(', ')})`);
  return t;
}

/** Kantenlänge eines Voxels in Metern. */
export const voxelSize = (name) => 1 / tierOf(name).voxelsPerMeter;
