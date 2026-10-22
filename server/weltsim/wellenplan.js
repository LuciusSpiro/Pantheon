'use strict';
// SUND-02a A1: Wellenplan einer Flottenbegegnung. REIN: nur Eingabe -> Plan, kein Spielzustand, kein Math.random/Date.now,
// kein game.rng; eigener Zufallsstrom aus zufall.js (Seed -> Zustand). Alle Zahlen stehen in CONFIG.wellenplan (shared/config.js),
// die Kommandanten in content/welt/kommandanten.json. Den Szenenaufbau macht der Aufrufer (A2).
//
//   plane({ staerke, seed, volk, kommandant }) -> { wellen: [[{kind, n, volk?}…]…], flaggschiff: {kind, kommandant}|null, punkte }
//     wellen = alle Wellen in Spielreihenfolge, die LETZTE ist das Finale (Flaggschiff-Gruppe zuerst, dann Eskorte). Das Format
//     passt zu Flotte.wellenStart(game, { wellen }) (Gruppen {kind, n, volk}). punkte = abgerundete Stärke = Summe aller Gruppen.
//     Stärke < 1 -> { wellen: [], flaggschiff: null, punkte: 0 } (keine Szene).
//   kommandantFuer({ fraktion, seed, gefallen }) -> { name, volk, zug } | null
//   seedAus(...teile) -> uint32 (z. B. seedAus(flotte.id, zustand.tick))
const Zufall = require('./zufall.js');
const CONFIG = require('../../shared/config.js');
const KOMMANDANTEN = require('../../content/welt/kommandanten.json').kommandanten;

const W = CONFIG.wellenplan;
// Klassen mit Punktwert > 0, größte zuerst
const KLASSEN = Object.keys(W.punkte).filter((k) => W.punkte[k] > 0).sort((a, b) => W.punkte[b] - W.punkte[a]);
const P = W.punkte;
const KLEIN = KLASSEN[KLASSEN.length - 1];                       // raider (kleinste Klasse)
const KORV = 'korvette';
const MAX = CONFIG.flotte.max;

// Beliebige Teile (Zahl, Text) -> uint32 (FNV-1a), damit Flotten-Id + Tick einen Seed ergeben.
function seedAus(...teile) {
  let h = 0x811C9DC5;
  for (const c of teile.map(String).join('|')) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const strom = (seed) => ({ zufall: Zufall.startzustand(typeof seed === 'number' ? seed : seedAus(seed)) });

const anzahl = (gruppen) => gruppen.reduce((s, g) => s + g.n, 0);
const summe = (gruppen) => gruppen.reduce((s, g) => s + g.n * P[g.kind], 0);
const zuGruppen = (zaehler) => KLASSEN.filter((k) => zaehler[k] > 0).map((k) => ({ kind: k, n: zaehler[k] }));

// Jäger + Korvetten (Welle 1 und Eskorte): korvetteAnteil der Punkte als Korvetten, Rest Jäger
function kleineGruppe(punkte) {
  const k = Math.floor(punkte * W.welle1.korvetteAnteil / P[KORV]);
  return { [KORV]: k, [KLEIN]: punkte - k * P[KORV] };
}

// Mittlere Welle: größte Klasse mit Punkten ≤ klassenAnteil × Wellenpunkte (mindestens Korvette), Kreuzer höchstens einmal.
function mittlereGruppe(punkte) {
  const grenze = Math.max(punkte * W.mittlere.klassenAnteil, P[KORV]);
  const bau = (kreuzerMax, ohneGrenze) => {
    const z = {}; let rest = punkte;
    for (const k of KLASSEN) {
      z[k] = 0;
      const max = k === KLASSEN[0] ? kreuzerMax : Infinity;
      while (z[k] < max && P[k] <= rest && (ohneGrenze || P[k] <= grenze)) { z[k]++; rest -= P[k]; }
    }
    return z;
  };
  let z = bau(1, false);
  if (anzahl(zuGruppen(z)) > MAX) z = bau(Infinity, true);        // Sicherung: nie mehr als MAX gleichzeitig
  return z;
}

// Bauweise: Umwandlungen mit gleichem Punktwert (2 Jäger <-> Korvette, 2 Korvetten <-> Fregatte), je Paar eine Würfelprobe
function bauweise(z, volk, rng, max = MAX) {
  const b = W.bauweise[volk];
  if (!b) return z;
  const wandle = (von, nach, wahrsch, paarN, nachN) => {
    if (!wahrsch) return;
    for (let i = Math.floor((z[von] || 0) / paarN); i > 0; i--) {
      const wurf = Zufall.zahl(rng);                               // immer ziehen: Strom unabhängig vom Ausgang
      if (wurf >= wahrsch) continue;
      const alt = z[von], neuN = (z[nach] || 0) + nachN;
      z[von] = alt - paarN; z[nach] = neuN;
      if (anzahl(zuGruppen(z)) > max) { z[von] = alt; z[nach] = neuN - nachN; }
    }
  };
  wandle('raider', KORV, b.raiderZuKorvette, 2, 1);
  wandle(KORV, 'fregatte', b.korvetteZuFregatte, 2, 1);
  wandle('fregatte', KORV, b.fregatteZuKorvette, 1, 2);
  wandle(KORV, 'raider', b.korvetteZuRaider, 1, 2);
  return z;
}

function plane({ staerke, seed, volk, kommandant } = {}) {
  const S = Math.floor(Number(staerke) || 0);
  if (!(S >= 1)) return { wellen: [], flaggschiff: null, punkte: 0 };
  const rng = strom(seed == null ? 0 : seed);

  // Flaggschiff: größte Klasse mit Punkten ≤ anteil × Stärke, mindestens die kleinste Klasse
  const flag = KLASSEN.find((k) => P[k] <= S * W.flaggschiff.anteil) || KLEIN;
  const flagP = Math.min(P[flag], S);
  let rest = S - flagP;

  // Eskorte des Finales (nur sehr große Flotten); sie zählt zur Stärke, nicht zusätzlich
  const eskP = Math.min(rest, Math.max(0, Math.min(W.eskorte.max, Math.floor((S - W.eskorte.ab) * W.eskorte.anteil))));
  rest -= eskP;

  // Welle 1, dann mittlere Wellen mit wachsenden Gewichten 2, 3, …
  const rohe = [];
  if (rest > 0) {
    const w1 = Math.min(rest, Math.max(1, Math.min(Math.floor(S * W.welle1.anteil), W.welle1.max)));
    rohe.push(zuGruppen(bauweise(kleineGruppe(w1), volk, rng)));
    rest -= w1;
  }
  if (rest > 0) {
    const k = Math.max(1, Math.round(rest / W.mittlere.punkteJeWelle));
    const basis = k > 2 ? 3 * k : 1, gew = Array.from({ length: k }, (_, i) => i + 1 + basis), gs = gew.reduce((a, b) => a + b, 0);
    const pj = gew.map((g) => Math.floor(rest * g / gs));
    for (let r = rest - pj.reduce((a, b) => a + b, 0), i = k - 1; r > 0; r--, i--) pj[i]++;   // Rest je einen Punkt an die letzten Wellen: bleibt nicht fallend
    for (const p of pj) {
      if (p > 0) rohe.push(zuGruppen(bauweise(mittlereGruppe(p), volk, rng)));
    }
  }

  const mitVolk = (g) => (volk ? { ...g, volk } : g);
  const finale = [{ kind: flag, n: 1 }];
  if (eskP > 0) finale.push(...zuGruppen(bauweise(kleineGruppe(eskP), volk, rng, MAX - 1)));
  const wellen = [...rohe, finale].map((w) => w.map(mitVolk));
  return { wellen, flaggschiff: { kind: flag, kommandant: kommandant || null }, punkte: wellen.reduce((s, w) => s + summe(w), 0) };
}

// Kommandant einer Fraktion: deterministisch aus dem Seed, überspringt Namen aus `gefallen` (Liste oder Set). Sind alle gefallen -> null.
function kommandantFuer({ fraktion, seed, gefallen } = {}) {
  const liste = KOMMANDANTEN[fraktion];
  if (!liste || !liste.length) return null;
  const tot = new Set(gefallen || []);
  const frei = liste.filter((k) => !tot.has(k.name));
  if (!frei.length) return null;
  const k = frei[Math.floor(Zufall.zahl(strom(seed == null ? 0 : seed)) * frei.length)];
  return { ...k };
}

module.exports = { plane, kommandantFuer, seedAus };
