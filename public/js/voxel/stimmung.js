// B1 Team VOXEL – Stimmungs-Akzente (SICHTUNG-ART „VOXEL-Licht/Stimmungen“).
// Die Stimmungsdateien (voxelwerk moods/*.json) gehören ART-PALETTEN. Station (hall_forge) und Schiff (ship_nord) wirkten
// darin gleich („blau vor dunklem All“). Der Renderer legt deshalb je Stimmung einen Akzent darüber:
//   - hall_forge: warm, Schmiede und Glut (Himmel bräunlich, Boden-Rückstrahlung glutrot, Sonne warm, Hintergrund Rußbraun)
//   - ship_nord: kalt, Spanten und Arbeitslicht (Himmel stahlblau, Boden-Rückstrahlung Alarm-Rot, Hintergrund tiefes All)
// Grundsatz (Studioleitung): Stimmungen sind Daten – die Datei gewinnt. Ein Akzent füllt nur Felder bzw. Unterfelder, die
// die Datei nicht setzt (z. B. fehlendes ambient oder fog.near). Liefert ART eine vollständige Datei, wirkt der Akzent nicht.
export const AKZENT = {
  hall_forge: {
    background: '#1E1209',
    fog: { color: '#3A2214', near: 1.8, far: 5 },
    hemi: { sky: '#B48C68', ground: '#A4481A', intensity: 1.05 },
    ambient: { color: '#5A3420', intensity: 0.35 },
    sun: { color: '#FFD2A0', intensity: 1.45, dir: [-0.25, 1, 0.35] },
    exposure: 1.15,
  },
  ship_nord: {
    background: '#03060C',
    fog: { color: '#0A1220', near: 1.6, far: 4.5 },
    hemi: { sky: '#8AA8DC', ground: '#8A1A14', intensity: 1.35 },
    ambient: { color: '#2A3A5A', intensity: 0.4 },
    sun: { color: '#C8DCFF', intensity: 1.9, dir: [-0.3, 1, 0.3] },
    exposure: 1.2,
  },
};
const istObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Stimmung + Akzent → neue Stimmung (Original bleibt unverändert); Werte der Datei gehen vor */
export function mitAkzent(id, mood) {
  const a = AKZENT[id];
  if (!a || !mood) return mood;
  const out = Object.assign({}, mood);
  for (const [k, v] of Object.entries(a)) {
    if (out[k] === undefined || out[k] === null) out[k] = istObj(v) ? Object.assign({}, v) : v;
    else if (istObj(v) && istObj(out[k])) out[k] = Object.assign({}, v, out[k]);
  }
  return out;
}
