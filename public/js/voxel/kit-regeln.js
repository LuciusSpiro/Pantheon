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
// Nur für Anker-Props (VOX-01 5c): dreh = feste Drehung in Grad (Front +z; +90 = Front nach Osten, -90 = nach Westen, 0 = nach Süden), statt der Drehung zur freien Nachbarkachel;
// versatz = [dx, dz] in Metern, Weltrichtung (x Ost, z Süd), vom Kachelmittelpunkt des Ankers aus, statt des automatischen Versatzes für Props über 1 x 1.
export const META = {
  id: 1, je_art: 1, terrain: 1, leer: 1, hoehe: 1, top: 1, fill: 1, steinDichte: 1, hinweis: 1,
  sockel_inset: 1, palette: 1, nadel: 1, laub: 1, nadelAnteil: 1, seeds: 1, eigene_hoehe: 1, hoch_zu: 1, dreh: 1, versatz: 1,
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
    dreh: Number.isFinite(m.dreh) ? m.dreh : null, versatz: Array.isArray(m.versatz) && m.versatz.length === 2 && m.versatz.every(Number.isFinite) ? m.versatz : null,
  };
}

/**
 * Eintrag der Bauweisen-Tabelle für eine Anker-Rolle (anker.<rolle>): String, Objekt { id, <feste Parameter>, dreh?, versatz? } oder Tabelle je Kartenart
 * ({ <art>: …, '*': … }) bzw. je Platztyp ({ '*': ID, <platztyp>: ID }). → eintragVon(…) oder null. platzTyp = Platztyp des Ankers (oder null).
 */
export function ankerEintragVon(bw, rolle, art, platzTyp) {
  const e = bw && bw.anker && bw.anker[rolle];
  if (!e) return null;
  let v = typeof e === 'string' ? e : e[art] || e['*'] || null;
  if (v && typeof v === 'object' && !v.id) v = (platzTyp && v[platzTyp]) || v['*'] || null;
  return eintragVon(v, art);
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

// ---------------------------------------------------------------------------------------------------------------------------
// Sichtlinien-Umschaltung (Hüllen hoch/niedrig, VOX-01 5b: Baumkronen). Rein, ohne three.js; kit.js und tools/test-vox01-kronen.js nutzen sie.

/** Schneidet die Strecke (x0,y0,z0)→(x1,y1,z1) die Box (bx0..bx1, by0..by1, bz0..bz1)? Erst ein Vorfilter (AABB der Strecke gegen die Box, billig,
 *  weist fast alle Zellen ab), dann der Slab-Test ohne Zwischenfelder (läuft je Frame viele tausend Mal). */
export function segmentBox(x0, y0, z0, x1, y1, z1, bx0, by0, bz0, bx1, by1, bz1) {
  if ((x0 < bx0 && x1 < bx0) || (x0 > bx1 && x1 > bx1) || (z0 < bz0 && z1 < bz0) || (z0 > bz1 && z1 > bz1) || (y0 < by0 && y1 < by0) || (y0 > by1 && y1 > by1)) return false;
  let tmin = 0, tmax = 1;
  let d = x1 - x0;
  if (Math.abs(d) < 1e-9) { if (x0 < bx0 || x0 > bx1) return false; } else {
    let p = (bx0 - x0) / d, q = (bx1 - x0) / d;
    if (p > q) { const t = p; p = q; q = t; }
    if (p > tmin) tmin = p;
    if (q < tmax) tmax = q;
    if (tmin > tmax) return false;
  }
  d = y1 - y0;
  if (Math.abs(d) < 1e-9) { if (y0 < by0 || y0 > by1) return false; } else {
    let p = (by0 - y0) / d, q = (by1 - y0) / d;
    if (p > q) { const t = p; p = q; q = t; }
    if (p > tmin) tmin = p;
    if (q < tmax) tmax = q;
    if (tmin > tmax) return false;
  }
  d = z1 - z0;
  if (Math.abs(d) < 1e-9) { if (z0 < bz0 || z0 > bz1) return false; } else {
    let p = (bz0 - z0) / d, q = (bz1 - z0) / d;
    if (p > q) { const t = p; p = q; q = t; }
    if (p > tmin) tmin = p;
    if (q < tmax) tmax = q;
    if (tmin > tmax) return false;
  }
  return true;
}

/** Nachlauf gegen Flackern: `o` = { tief, seit }. `im` = Sichtlinie jetzt gekreuzt. Setzt o.seit, gibt den neuen Zustand zurück (o.tief wird gesetzt). */
export const NACHLAUF_MS = 250;
export function mitNachlauf(o, im, t, ms) {
  if (im) o.seit = t;
  o.tief = !!(im || (o.tief && t - o.seit < (ms == null ? NACHLAUF_MS : ms)));
  return o.tief;
}

/**
 * Welche Kronen-Zellen sind ausgeblendet? zellen = [{ key, bx0, bx1, bz0, bz1, by0, by1 }] (Box der Krone in Weltmetern),
 * ziele = [{ x, y?, z }] (Punkte aller sichtbaren Figuren: eigene, Mitspieler, Gegner), kamera = { x, y, z }.
 * zustand = Map key → { tief, seit } (vom Aufrufer gehalten, bleibt zwischen Aufrufen). → Set der Schlüssel, die ausgeblendet sind.
 * Eine Zelle geht aus, wenn eine Strecke Kamera → Figurenpunkt ihre Box (um `einzug` verkleinert, damit ein Streifen am Rand nicht reicht) kreuzt.
 * opt (alles optional): einzug, nachlaufMs, aus = Set, der geleert und wiederverwendet wird (kein neues Set je Aufruf), n = nur die ersten n Einträge von ziele.
 */
export function kronenAus(zustand, kamera, zellen, ziele, jetztMs, opt) {
  const einzug = opt && opt.einzug != null ? opt.einzug : 0.3;
  let aus;
  if (opt && opt.aus) { aus = opt.aus; aus.clear(); } else aus = new Set();
  const n = ziele ? (opt && opt.n != null ? Math.min(opt.n, ziele.length) : ziele.length) : 0;
  for (const c of zellen) {
    let im = false;
    for (let i = 0; i < n; i++) {
      const z = ziele[i];
      if (segmentBox(kamera.x, kamera.y, kamera.z, z.x, z.y == null ? 0.9 : z.y, z.z, c.bx0 + einzug, c.by0, c.bz0 + einzug, c.bx1 - einzug, c.by1, c.bz1 - einzug)) { im = true; break; }
    }
    let s = zustand.get(c.key);
    if (!s) { s = { tief: false, seit: 0 }; zustand.set(c.key, s); }
    if (mitNachlauf(s, im, jetztMs, opt && opt.nachlaufMs)) aus.add(c.key);
  }
  return aus;
}

// ---- Volk der Bauweise (VOX-01 Nacharbeit): datengetrieben aus bauweisen/<id>.json (Feld `volk`), nicht aus dem Namen der Bauweise.
// kit.js trägt jede geladene Bauweise ein (bauweiseMerken); Figuren (actors.js) fragen volkVon(karte.bauweise). Unbekannt oder ohne Feld: null.
const VOELKER = {};
export function bauweiseMerken(bw) { if (bw && bw.id) VOELKER[bw.id] = bw.volk || null; }
export function volkVon(bauweiseId) { return (bauweiseId && VOELKER[bauweiseId]) || null; }
