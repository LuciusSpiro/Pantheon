// VOX-01 Paket 5a: reine Zuordnungsregeln des Kit-Renderers (kit.js) ohne three.js, damit sie in Node testbar sind (tools/test-vox01-kit.js).
// kit.js importiert diese Funktionen; hier steht, WAS gesetzt wird (Tabelleneintrag, conn, Baumwahl, Rampenrichtung), kit.js macht daraus Geometrie.

// Kachelklassen für conn (gleiche Klasse = Nachbar). brustwehr hat eine eigene Klasse B: Reihen, Ecken, T und Kreuz baut das Kit-Teil selbst.
export const KLASSE = {
  wand: 'W', fenster: 'W', wand_schwach: 'W', tuer: 'W', schott: 'W', luke: 'W', zaun: 'Z', tor: 'Z', gitter: 'G', kante: 'K',
  deckung_halb: 'H', deckung_voll: 'V', truemmer: 'T', schutt: 'T', brustwehr: 'B',
};

/** conn (N1 O2 S4 W8, N = -z, absolut) einer Kachel aus ihren Nachbarn gleicher Klasse. klasseAt(x, y) → Klassenbuchstabe | null. */
export function connVon(klasseAt, x, y) {
  const c = klasseAt(x, y);
  if (!c) return 0;
  const same = (xx, yy) => { const o = klasseAt(xx, yy); return o === c || (c === 'Z' && o === 'W') || (c === 'W' && o === 'Z'); };
  return (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
}

export function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Eintrag der Bauweisen-Tabelle (kits.<kind>): String oder Objekt { id, <feste Parameter>, je_art: { <art>: {…} }, <META-Felder> }.
// META-Felder sind keine Modellparameter. palette = Palette für dieses Teil (statt der Karten-Palette, z. B. Bäume in rom/germanen),
// nadel/laub/nadelAnteil/seeds = Baumwahl, eigene_hoehe = das Teil bringt seine Höhe selbst mit (kein Absenken, kein Anheben),
// sockel_inset = Einzug des Plateau-Unterbaus (m) gegen Z-Flimmern mit den Seitenflächen des Teils, hoch_zu = Kachelarten, zu denen hin ein Teil mit eigener Steigung dreht (Rampe).
export const META = {
  id: 1, je_art: 1, terrain: 1, leer: 1, hoehe: 1, top: 1, fill: 1, steinDichte: 1, hinweis: 1,
  sockel_inset: 1, palette: 1, nadel: 1, laub: 1, nadelAnteil: 1, seeds: 1, eigene_hoehe: 1, hoch_zu: 1,
};
export function eintragVon(e, art) {
  if (!e) return null;
  if (typeof e === 'string') return { id: e, fest: {} };
  const m = Object.assign({}, e, (e.je_art && e.je_art[art]) || {});
  const fest = {};
  for (const key of Object.keys(m)) if (!META[key]) fest[key] = m[key];
  return {
    id: m.id || null, fest, terrain: !!m.terrain, leer: !!m.leer, hoehe: m.hoehe, top: m.top, fill: m.fill, steinDichte: m.steinDichte,
    palette: m.palette || null, nadel: m.nadel || null, laub: m.laub || null, nadelAnteil: m.nadelAnteil, seeds: m.seeds,
    sockelInset: m.sockel_inset == null ? 0 : +m.sockel_inset, eigeneHoehe: !!m.eigene_hoehe, hochZu: Array.isArray(m.hoch_zu) ? m.hoch_zu : null,
  };
}

/** Alle Modell-IDs, die ein Eintrag braucht (Vorladen): id, bei Bäumen auch nadel und laub. */
export function eintragIds(e) {
  const out = [];
  if (!e) return out;
  for (const id of [e.id, e.nadel, e.laub]) if (id && !out.includes(id)) out.push(id);
  return out;
}

/**
 * Baum einer Kachel: Nadel oder Laub und Seed (Typ im Modell = seed % 3). Nur von Kachelposition und Eintrag abhängig, nicht vom Kartenseed:
 * dieselbe Karte zeigt jedes Mal denselben Wald. e = eintragVon(kits.baum). → { id, seed, art: 'nadel' | 'laub', dx, dz, rot } oder null.
 * Seed aus einem kleinen Vorrat (e.seeds, Standard 12 = je Typ 4 Gestalten), damit Geometrien gecacht werden können.
 */
export function baumWahl(tx, ty, e) {
  if (!e || !(e.nadel || e.laub || e.id)) return null;
  const anteil = e.nadelAnteil == null ? 0.6 : +e.nadelAnteil;
  const nadel = e.nadel || e.id, laub = e.laub || e.nadel || e.id;
  const istNadel = e.laub ? hash2(tx, ty, 71) < anteil : true;
  const n = Math.max(3, (e.seeds | 0) || 12);
  const seed = Math.floor(hash2(tx, ty, 73) * n) % n;
  return {
    id: istNadel ? nadel : laub, art: istNadel ? 'nadel' : 'laub', seed,
    dx: (hash2(tx, ty, 75) - 0.5) * 0.5, dz: (hash2(tx, ty, 77) - 0.5) * 0.5, rot: Math.floor(hash2(tx, ty, 79) * 4) * Math.PI / 2,
  };
}

/** Zelle (3×3 Kacheln) einer Kachel für die Kronen-Gruppen: Schlüssel 'cx,cz'. Stamm bleibt im normalen Chunk, die Krone liegt je Zelle in einem eigenen Mesh. */
export const KRONEN_ZELLE = 3;
export const kronenZelle = (tx, ty) => Math.floor(tx / KRONEN_ZELLE) + ',' + Math.floor(ty / KRONEN_ZELLE);

/**
 * Drehung (um Y) für ein Teil, dessen Steigung im Modell nach Norden (-z) zeigt: so, dass „hoch“ zum ersten Nachbarn einer Art aus hochZu zeigt.
 * Reihenfolge: Arten wie genannt, je Art N, O, S, W. Ohne Treffer 0. kindAt(x, y) → Kachelart | null.
 */
export function hochRichtung(kindAt, x, y, hochZu) {
  const DIR = [[0, -1, 0], [1, 0, -Math.PI / 2], [0, 1, Math.PI], [-1, 0, Math.PI / 2]];   // [dx, dy, Drehung]
  for (const art of hochZu || []) for (const [dx, dy, rot] of DIR) if (kindAt(x + dx, y + dy) === art) return rot;
  return 0;
}
