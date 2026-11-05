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

// GEL-01 D: Stimmungen der Kartenart wildnis (je Biom). Es gibt dafür noch keine Stimmungsdateien (ART-PALETTEN/Voxelwerk): bis sie kommen,
// stehen die Werte hier; eine Datei moods/wildnis_<biom>.json gewinnt, sobald sie im Index steht (renderer.js applyMood, kit.js ladeMood).
// Auswahl in der Bauweisen-Tabelle: stimmung["wildnis:<boden>"] (boden = Bodenton der Karte: wueste | gras | vulkan), Rückfall stimmung.wildnis.
export const WILDNIS_STIMMUNG = {
  wildnis_wueste: {   // warm und hell: gleißende Sonne, Dunst in Sandfarbe
    id: 'wildnis_wueste', background: '#E4CFA0', fog: { color: '#E6D3A8', near: 2.4, far: 6.5 },
    hemi: { sky: '#F4E6C6', ground: '#A07C4C', intensity: 1.2 }, sun: { color: '#FFDFA0', intensity: 3.4, dir: [-0.55, 1, 0.42], softness: 2.5 },
    exposure: 1.05, bloom: { strength: 0.25, radius: 0.4, threshold: 0.92 },
  },
  wildnis_wiesenwald: {   // grün und frisch: klares, leicht kühles Licht, grüner Dunst
    id: 'wildnis_wiesenwald', background: '#B2D2BC', fog: { color: '#C2DCCA', near: 2.2, far: 6 },
    hemi: { sky: '#CCE6D6', ground: '#587A3C', intensity: 1.15 }, sun: { color: '#FFF6DC', intensity: 3.0, dir: [-0.5, 1, 0.4], softness: 2.5 },
    exposure: 1.0, bloom: { strength: 0.25, radius: 0.4, threshold: 0.92 },
  },
  wildnis_vulkan: {   // dunkel und rötlich: Ascheluft, tiefes Glutlicht von unten, die Lava bloomt
    id: 'wildnis_vulkan', background: '#2C1A18', fog: { color: '#4E2C26', near: 2.2, far: 6 },
    hemi: { sky: '#B4A09C', ground: '#8A4A30', intensity: 1.25 }, ambient: { color: '#6A4A40', intensity: 0.5 },
    sun: { color: '#FFD0A8', intensity: 2.7, dir: [-0.7, 0.8, 0.3], softness: 3 },
    exposure: 1.25, bloom: { strength: 0.6, radius: 0.5, threshold: 0.85 },   // Befund 9: milder (heller Boden, weniger Rot); Lava bleibt das hellste Element
  },
};
// GEL-02 Paket 0: Stimmung unter der Erde (ein Eintrag, nicht je Biom). Gilt für die Karte art 'hoehle' und für Deck >= 1 einer Wildnis mit Decks (renderer.js felsHintergrund).
// Kühl, dunkel, enger Nebel; der Nebel hat die Höhlenfarbe, die Figur bleibt durch Hemisphäre und Sonne gut lesbar (kein Schwarz). Eine Datei moods/hoehle.json gewinnt, sobald sie im Index steht.
export const HOEHLE_STIMMUNG = {
  hoehle: {
    id: 'hoehle', background: '#0C0F14', fog: { color: '#10141B', near: 1.4, far: 4.4 },
    hemi: { sky: '#9CB0C8', ground: '#4C4038', intensity: 0.95 }, ambient: { color: '#5E6E82', intensity: 0.3 },
    sun: { color: '#B4C8E6', intensity: 1.1, dir: [-0.35, 1, 0.5], softness: 2.5 },
    exposure: 1.1, bloom: { strength: 0.2, radius: 0.4, threshold: 0.92 },
  },
};
/** Kartenarten, deren Decks ab 1 (bzw. die ganze Karte bei 'hoehle') die Höhlenstimmung tragen */
export const HOEHLE_ARTEN = ['wildnis', 'hoehle'];
/** Stimmungs-ID einer Karte aus der Bauweisen-Tabelle: stimmung["<art>:<boden>"] (nur wildnis nutzt das), sonst stimmung[<art>]; sonst null. */
// Letzter Rückfall nur für wildnis (Befund 6): fehlt die Bauweisen-Tabelle ganz (Datei nicht geladen), bekommt die Wildnis trotzdem die Stimmung ihres Bodentons.
const WILDNIS_STIMMUNG_JE_BODEN = { wueste: 'wildnis_wueste', gras: 'wildnis_wiesenwald', vulkan: 'wildnis_vulkan' };
export function stimmungVon(tabelle, art, boden) {
  const t = tabelle || {};
  return (art === 'hoehle' && (t.hoehle || 'hoehle')) || (boden && t[art + ':' + boden]) || t[art] || (art === 'wildnis' && boden && WILDNIS_STIMMUNG_JE_BODEN[boden]) || null;
}
