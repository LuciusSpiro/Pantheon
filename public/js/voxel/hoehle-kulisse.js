// GEL-02 E2: Kulisse der Höhle (Schacht, Lichtquellen, Fund-Glutring). Reine Platzierung ohne three.js (läuft auch in Node, tools/test-hoehle-kulisse.js);
// kit.js zeichnet die Boxlisten mit seinem Stift (`zeichne`) und hängt sie an die Kacheln.
//
// Gilt NUR für Karten mit Erdboden (kit.js erdBoden: art 'hoehle', oder Wildnis mit Decks) und dort nur
//   - als Schacht auf Deck 0 (Anker leiter oben) bzw. Lichtfleck am unteren Ende (Anker leiter auf Deck >= 1),
//   - als Pilz-/Kristall-/Glutriss-Kulisse unter der Erde (Deck >= 1 bzw. art 'hoehle'),
//   - als Glutring unter dem Fund, solange er da ist (unter der Erde).
// Alles andere (Bunker, Wildnis ohne Deck, Schiffe, Stationen, Siedlungen) bekommt eine leere Kulisse.
//
// Kollisionsregel (Kai): Gegenständliches braucht eine Kollisionsbox. Diese Kulisse hat keine, deshalb liegt sie
//   a) flach auf dem Boden (höchstens FLACH_MAX = 0,2 m: Schachtrand, Leiterholme, Lichtfleck, Glutring) oder
//   b) IN einer festen Felskachel (Pilze und Glutrisse in einer Nische der Südseite, Kristalle auf der Felsoberseite),
//      ohne eine Kachelgrenze zu überschreiten und ohne die begehbare Nachbarkachel zu berühren.
// Keine Daten in rows, keine neuen Kachelzeichen. Die Streuung kommt aus hash2 (Kachel + Karten-Seed), nie aus Math.random.
//
// Boxen: { x0, y0, z0, x1, y1, z1, c, emit?, skip?, bottom?, low? } in Kachelkoordinaten (Mitte = 0, Boden y = 0, Süden = +z).
// Farbe c: { hex, f? } | { rolle, f? } | 'seite' (Seitenfarbe des Felsens, nur in der Nische).
import { hash2 } from './kit-regeln.js';

export const FLACH_MAX = 0.2;          // flache Optik ohne Kollision: höchstens so hoch
export const DICHTE_PILZ = 1 / 50;     // Cluster je begehbare Kachel (Pilze, im Vulkan Glutrisse)
export const DICHTE_KRISTALL = 1 / 150;
const ABSTAND_PILZ = 3, ABSTAND_KRISTALL = 7;   // Kacheln (Chebyshev) zwischen zwei Clustern
// Leuchtfaktoren der Kulisse unter der Erde: alles dunkler als der Fund-Glutring (RING_F), aber sichtbar
export const PILZ_F_MIN = 0.45, RISS_F_MIN = 0.4, KRISTALL_F_MIN = 0.28;   // je + Streuung bis 0,1 (Pilz, Riss) bzw. 0,07 (Kristall)
const KRISTALL_HOCH_MAX = 0.6;         // höchster Kristall (siehe kristalle()); Fels + Kristall bleibt unter der Erde <= FELS_REIHE2_MAX (GEL-02 E1: zweite Felsreihe hinter dem Gang höchstens 2 m)
const FELS_REIHE2_MAX = 2;
const KAMMER_MIN = 17;                 // von 25 Kacheln um die Südkachel müssen so viele begehbar sein (offene Fläche, nicht Gang)
const WALK = { boden: 1, boden2: 1, gelaende: 1 };

const FACES = ['y+', 'y-', 'x+', 'x-', 'z+', 'z-'];
const nur = (face) => ({ skip: FACES.filter((f) => f !== face && f !== 'y-'), bottom: face === 'y-' });
const box = (x0, y0, z0, x1, y1, z1, c, o) => Object.assign({ x0, y0, z0, x1, y1, z1, c }, o || {});
const flaeche = (face, x0, y0, z0, x1, y1, z1, c) => box(x0, y0, z0, x1, y1, z1, c, nur(face));
const r2 = (v) => Math.round(v * 1000) / 1000;

/** Anzahl gezeichneter Flächen einer Box (je 2 Dreiecke), für das Dreiecksbudget */
export function dreiecke(boxen) {
  let n = 0;
  for (const b of boxen) { const sk = b.skip || []; n += (5 + (b.bottom ? 1 : 0) - sk.filter((f) => f !== 'y-').length) * 2; }
  return n;
}

// --------------------------------------------------------------------------------------------- Schacht (Eingang an der Oberfläche)
// Biomtöne der Randsteine (heller Ring um schwarzen Kern: auch in Graustufen aus > 20 m lesbar, Designer-Review P1-3)
export const SCHACHT_RAND = { gras: '#9AA08A', wueste: '#D8C8A0', vulkan: '#6E6466' };
const LOCH = '#07080A';

/** Schacht oben (Deck 0): flaches Loch 0,8 x 0,8, Tiefenstreifen an der Nordinnenkante, 12 flache Randsteine, Leiterholme 0,18 m. Alles <= 0,2 m, in der Kachel. */
export function schachtOben(boden) {
  const rand = SCHACHT_RAND[boden] || SCHACHT_RAND.gras;
  const L = [];
  L.push(flaeche('y+', -0.4, -0.02, -0.4, 0.4, 0.005, 0.4, { hex: LOCH }));
  L.push(flaeche('y+', -0.4, 0.005, -0.4, 0.4, 0.008, -0.3, { rolle: 'soil_dark', f: 0.6 }));   // Tiefenandeutung: die Kamera schaut von Süden auf die Nordwand
  // Randsteine im Ring 0,405 bis 0,485 m (je Seite 3, Ecken frei), Höhe 0,10 bis 0,16 m
  let i = 0;
  for (const seite of ['n', 's', 'w', 'o']) {
    for (const t of [-0.21, 0, 0.21]) {
      const h = 0.1 + hash2(i, 7, 91) * 0.06, len = 0.09 + hash2(i, 8, 91) * 0.05, dick = 0.07 + hash2(i, 9, 91) * 0.015, mid = 0.41 + dick / 2;
      const a = t - len, b = t + len;
      const c = { hex: rand, f: 0.92 + hash2(i, 10, 91) * 0.16 };
      if (seite === 'n') L.push(box(a, 0, -mid - dick / 2, b, h, -mid + dick / 2, c, { jit: true }));
      else if (seite === 's') L.push(box(a, 0, mid - dick / 2, b, h, mid + dick / 2, c, { jit: true }));
      else if (seite === 'w') L.push(box(-mid - dick / 2, 0, a, -mid + dick / 2, h, b, c, { jit: true }));
      else L.push(box(mid - dick / 2, 0, a, mid + dick / 2, h, b, c, { jit: true }));
      i++;
    }
  }
  // Leiterholme: nur 0,18 m über dem Boden, eine Sprosse bei 0,12 m (laufen nach unten ins Loch weiter)
  L.push(box(-0.24, 0.005, -0.38, -0.2, 0.18, -0.34, { rolle: 'wood' }));
  L.push(box(0.2, 0.005, -0.38, 0.24, 0.18, -0.34, { rolle: 'wood' }));
  L.push(box(-0.2, 0.11, -0.37, 0.2, 0.14, -0.35, { rolle: 'wood', f: 0.9 }));
  return L;
}
/** Unteres Leiterende (Deck 1): flacher warmer Lichtfleck 0,9 x 0,9 auf y 0,004 (emissiv wie die Lava); der Rückweg ist an Fleck und Licht erkennbar */
export function lichtfleck() {
  return [flaeche('y+', -0.45, 0, -0.45, 0.45, 0.004, 0.45, { hex: '#E8D8B0' })].map((b) => Object.assign(b, { emit: true }));
}
/** Lichtschacht am unteren Leiter-Ende (Punktlicht; Signatur wie ship.js addLight) */
export const LICHT_LEITER = { color: '#FFE2A0', intensity: 2.5, distance: 6, y: 2.5, priority: 1 };
/** Licht über dem Fund, solange er da ist */
export const LICHT_FUND = { color: '#FFB868', intensity: 3.2, distance: 6, y: 1.3, priority: 1 };

export const RING_HEX = '#FFE2A8';   // helles, warmes Gold (der Shader deckelt die Leuchtfläche bei max. Kanal 1,5: die Helligkeit kommt aus dem geringen Sättigungsgrad, nicht aus dem Faktor)
export const RING_F = 1.25;           // Leuchtfaktor des Fund-Glutrings (über 1: der Fund ist das hellste Element unter der Erde; Pilze, Risse, Kristalle sind dunkler)
export const RING_IN = 0.2;           // Innenkante des Außenbands (Band 0,2 bis 0,49 m um die Kachelmitte)
/** Glutring unter dem Fund (0,02 m hoch, emissiv, Farbe ember): Außenband 0,2 bis 0,49 m um die Kachelmitte voll hell, innen gedämpft (das Prop deckt die Mitte meist ab, sichtbar bleibt das Band) */
export function glutring() {
  const c = { hex: RING_HEX, f: RING_F }, d = { hex: RING_HEX, f: RING_F * 0.6 };
  const B = [flaeche('y+', -0.49, 0, RING_IN, 0.49, 0.02, 0.49, c), flaeche('y+', -0.49, 0, -0.49, 0.49, 0.02, -RING_IN, c),
    flaeche('y+', RING_IN, 0, -RING_IN, 0.49, 0.02, RING_IN, c), flaeche('y+', -0.49, 0, -RING_IN, -RING_IN, 0.02, RING_IN, c),
    flaeche('y+', -RING_IN, 0, -RING_IN, RING_IN, 0.02, RING_IN, d)];
  return B.map((x) => Object.assign(x, { emit: true }));
}

// --------------------------------------------------------------------------------------------- Karten-Sicht
function sicht(k) {
  const stride = k.stride | 0;
  const art = k.art;
  const erd = art === 'hoehle' || (art === 'wildnis' && stride > 0);
  const deckOf = (y) => (stride ? Math.max(0, Math.floor(y / stride)) : 0);
  const unterErde = (y) => art === 'hoehle' || (art === 'wildnis' && stride > 0 && deckOf(y) >= 1);
  return { erd, stride, deckOf, unterErde };
}
const begehbar = (k, x, y) => { const kd = x < 0 || y < 0 || x >= k.w || y >= k.h ? null : k.kindAt(x, y); return !!(kd && WALK[kd]); };

// --------------------------------------------------------------------------------------------- Pilze / Glutrisse (Nische in der Südseite einer Felskachel)
/** Nische + Cluster (Pilze, bzw. Glutriss im Vulkan). n = { x0, x1, y0, y1 } (Nischenrechteck auf der Südfläche der untersten Felsschicht), boxen = Inhalt. */
function pilzNische(x, y, seed, riss) {
  const S = seed | 0;
  const h = (n) => hash2(x * 5 + n, y * 3 - n, (S ^ 0x6A09) + n);
  const cx = (h(1) - 0.5) * 0.36;
  const hw = riss ? 0.14 : 0.17 + h(2) * 0.05;
  const n = { x0: r2(Math.max(-0.45, cx - hw)), x1: r2(Math.min(0.45, cx + hw)), y0: 0.1, y1: riss ? 0.9 : 0.52 };
  const Z0 = 0.38;
  const boxen = [];
  const dunkel = { hex: '#0B0A0C' };
  boxen.push(flaeche('z+', n.x0, n.y0, Z0 - 0.001, n.x1, n.y1, Z0, dunkel));                    // Rückwand der Nische
  boxen.push(flaeche('y+', n.x0, n.y0 - 0.001, Z0, n.x1, n.y0, 0.5, { hex: '#171310' }));        // Boden der Nische
  boxen.push(flaeche('x+', n.x0 - 0.001, n.y0, Z0, n.x0, n.y1, 0.5, dunkel));                    // linke Wand (von innen sichtbar)
  boxen.push(flaeche('x-', n.x1, n.y0, Z0, n.x1 + 0.001, n.y1, 0.5, dunkel));                    // rechte Wand
  if (riss) {
    // Glutriss: schmaler, gezackter Streifen aus 4 Segmenten (ember, etwas dunkler als der Fund)
    const f = RISS_F_MIN + h(3) * 0.1, w = 0.05;
    for (let i = 0; i < 4; i++) {
      const mx = (n.x0 + n.x1) / 2 + (i % 2 ? 0.05 : -0.05) * (h(4) < 0.5 ? 1 : -1);
      const ya = n.y0 + 0.02 + i * 0.18;
      boxen.push(box(r2(mx - w / 2), r2(ya), Z0, r2(mx + w / 2), r2(ya + 0.2), r2(0.42 + i * 0.01), { rolle: 'ember', f }, { emit: true, skip: ['z-'] }));
    }
  } else {
    const m = 3 + Math.floor(h(5) * 3), f = PILZ_F_MIN + h(6) * 0.1;   // 3 bis 5 Pilze, Leuchtfarbe nur ein Teil der Fundhelligkeit
    const breite = n.x1 - n.x0 - 0.04;
    for (let i = 0; i < m; i++) {
      const s = 0.06 + h(10 + i) * 0.06;
      const xa = n.x0 + 0.02 + (m === 1 ? 0 : (i / (m - 1)) * Math.max(0, breite - s));
      const ya = n.y0 + (i % 2 ? h(20 + i) * (n.y1 - n.y0 - s) : 0);
      boxen.push(box(r2(xa), r2(ya), Z0, r2(xa + s), r2(ya + s), r2(0.42 + 0.012 * i), { hex: '#FFB050', f }, { emit: true, skip: ['z-'] }));
    }
  }
  return { n, boxen };
}
/** Boxen für die Nische einer Felskachel (in FB.fels, unterste Schicht): Südfläche mit Aussparung + Inhalt. */
export function nischeBoxen(nis) {
  const n = nis.n, L = [];
  // Südfläche der Schicht 0 (0..1 m) um das Rechteck n herum; Verlauf der Schattierung an den Rand angepasst (low)
  L.push(Object.assign(flaeche('z+', -0.5, 0, 0.499, n.x0, 1, 0.5, 'seite'), { low: 0.75 }));
  L.push(Object.assign(flaeche('z+', n.x1, 0, 0.499, 0.5, 1, 0.5, 'seite'), { low: 0.75 }));
  L.push(Object.assign(flaeche('z+', n.x0, 0, 0.499, n.x1, n.y0, 0.5, 'seite'), { low: 0.75 }));
  L.push(Object.assign(flaeche('z+', n.x0, n.y1, 0.499, n.x1, 1, 0.5, 'seite'), { low: 0.75 + 0.25 * n.y1 }));
  return L.concat(nis.boxen);
}

// --------------------------------------------------------------------------------------------- Kristalle (auf der Oberseite niedriger Randfelsen)
function kristalle(x, y, seed, H) {
  const S = seed | 0, h = (n) => hash2(x * 7 + n, y * 11 - n, (S ^ 0x3C6E) + n);
  const L = [], m = 2 + Math.floor(h(1) * 2), f = KRISTALL_F_MIN + h(2) * 0.07;
  for (let i = 0; i < m; i++) {
    const bx = (h(10 + i) - 0.5) * 0.5, bz = (h(20 + i) - 0.5) * 0.5, w = 0.1 + h(30 + i) * 0.04, hoch = 0.3 + h(40 + i) * 0.3;
    const dx = (h(50 + i) < 0.5 ? -1 : 1) * 0.035, dz = (h(60 + i) < 0.5 ? -1 : 1) * 0.03;
    const mitte = H + hoch * 0.55, c = { hex: '#6FE6D8', f };
    L.push(box(r2(bx - w / 2), H, r2(bz - w / 2), r2(bx + w / 2), r2(mitte), r2(bz + w / 2), c, { emit: true }));   // Fuß
    const w2 = w * 0.65;   // schräger Aufsatz: gegen den Fuß versetzt (Prisma kippt in eine Richtung)
    L.push(box(r2(bx + dx - w2 / 2), r2(mitte), r2(bz + dz - w2 / 2), r2(bx + dx + w2 / 2), r2(H + hoch), r2(bz + dz + w2 / 2), c, { emit: true }));
  }
  return L;
}

// --------------------------------------------------------------------------------------------- Platzierung
function zaehleBegehbar(k, S) {
  let n = 0;
  for (let y = 0; y < k.h; y++) if (S.unterErde(y)) for (let x = 0; x < k.w; x++) if (begehbar(k, x, y)) n++;
  return n;
}
function kammer(k, x, y) {   // offene Fläche um die Kachel (x, y) (die begehbare Südkachel)
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (begehbar(k, x + dx, y + dy)) n++;
  return n;
}
/** Kristall auf Fels (x, y): Felsoberseite <= 2 m; liegt die Kachel in der zweiten Felsreihe hinter einem Gang (Fels davor, dahinter begehbar: kit.js nordGang 2), muss Fels + Kristall <= 2 m bleiben (sonst verdeckt der Kristall die Figur, GEL-02 E1) */
function kristallOk(k, S, x, y) {
  const H = k.felsHoehe ? k.felsHoehe(x, y) : 1;
  if (H > 2) return false;
  const zweiteReihe = k.kindAt(x, y - 1) === 'fels' && S.deckOf(y - 2) === S.deckOf(y) && begehbar(k, x, y - 2);
  return !zweiteReihe || H + KRISTALL_HOCH_MAX <= FELS_REIHE2_MAX + 1e-9;
}
function waehle(kand, menge, abstand, salz, seed, belegt) {
  const s = (seed ^ salz) | 0;
  const L = kand.map((c) => ({ c, r: hash2(c[0], c[1], s) })).sort((a, b) => a.r - b.r || a.c[1] - b.c[1] || a.c[0] - b.c[0]);
  const out = [];
  for (const { c } of L) {
    if (out.length >= menge) break;
    if (out.some((q) => Math.max(Math.abs(q[0] - c[0]), Math.abs(q[1] - c[1])) < abstand)) continue;
    if (belegt && belegt.some((q) => Math.max(Math.abs(q[0] - c[0]), Math.abs(q[1] - c[1])) < 2)) continue;
    out.push(c);
  }
  return out;
}

/**
 * k: { art, w, h, seed, stride (0 ohne Decks), boden (Biom), kindAt(x, y), felsHoehe(x, y) }
 * → { aktiv, begehbar, nischen: Map 'x,y' → Nische (Pilze/Risse), pilze: [[x,y]], risse: [[x,y]], kristalle: [{ x, y, H, boxen }] }
 * Karten ohne Erdboden: leer. Deterministisch aus Seed und Position.
 */
export function platziere(k) {
  const S = sicht(k);
  const leer = { aktiv: false, begehbar: 0, nischen: new Map(), pilze: [], risse: [], kristalle: [] };
  if (!S.erd) return leer;
  const seed = k.seed | 0, begehbarN = zaehleBegehbar(k, S);
  const kand = [], kandK = [];
  for (let y = 0; y < k.h - 1; y++) {
    if (!S.unterErde(y) || S.deckOf(y + 1) !== S.deckOf(y)) continue;
    for (let x = 0; x < k.w; x++) {
      if (k.kindAt(x, y) !== 'fels' || !begehbar(k, x, y + 1)) continue;
      kand.push([x, y]);
      if (kammer(k, x, y + 1) >= KAMMER_MIN && kristallOk(k, S, x, y)) kandK.push([x, y]);
    }
  }
  const kr = waehle(kandK, Math.round(begehbarN * DICHTE_KRISTALL), ABSTAND_KRISTALL, 0x51C7, seed);
  const pil = waehle(kand, Math.round(begehbarN * DICHTE_PILZ), ABSTAND_PILZ, 0x9B3D, seed, kr);
  const vulkan = k.art === 'wildnis' && k.boden === 'vulkan';
  const out = { aktiv: true, begehbar: begehbarN, nischen: new Map(), pilze: [], risse: [], kristalle: [] };
  for (const [x, y] of pil) { out.nischen.set(x + ',' + y, pilzNische(x, y, seed, vulkan)); (vulkan ? out.risse : out.pilze).push([x, y]); }
  for (const [x, y] of kr) { const H = k.felsHoehe ? k.felsHoehe(x, y) : 1; out.kristalle.push({ x, y, H, boxen: kristalle(x, y, seed, H) }); }
  return out;
}

/** Ankerrolle leiter: 'oben' (Schacht, Deck 0 der Wildnis mit Decks), 'unten' (Lichtfleck, Deck >= 1 bzw. art hoehle), sonst null (Bunker, Schiff, Wildnis ohne Deck: das Prop bleibt) */
export function leiterEnde(k, ay) {
  const S = sicht(k);
  if (!S.erd) return null;
  return S.unterErde(ay) ? 'unten' : 'oben';
}
/** Boxen für Schacht oben bzw. unten */
export function leiterBoxen(ende, boden) { return ende === 'oben' ? schachtOben(boden) : ende === 'unten' ? lichtfleck() : []; }
/** Fund unter der Erde und noch da: Glutring (und Licht) */
export function fundRing(k, ay, zustand) { return sicht(k).unterErde(ay) && zustand === 'da'; }

// --------------------------------------------------------------------------------------------- Zeichnen (der Stift gehört kit.js)
/** pen: kit.js Pen (nach pen.to(bucket, matrix)), F: Farben (F.get(rolle, f)), lin(hex, f) → lineares RGB, seite: Seitenfarbe des Felsens (nur Nische) */
export function zeichne(pen, boxen, F, lin, seite) {
  for (const b of boxen) {
    const c = b.c === 'seite' ? seite : b.c.hex ? lin(b.c.hex, b.c.f || 1) : F.get(b.c.rolle, b.c.f || 1);
    pen.box(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, c, c, { emit: !!b.emit, skip: b.skip, bottom: !!b.bottom, low: b.low, jit: b.jit === true });
  }
}
