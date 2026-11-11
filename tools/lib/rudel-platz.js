'use strict';
// SPL-01 c: Platzierungs-Sweep fuer Rudel auf Gelaende-Karten (kein Produktcode, liest nur, im Speicher wie tools/gel02-hilfen.js).
// Setzt wie die Mission-Aktion kreatur_besetzen (Kreatur.rudelSetzen, typ rudeltier, ohne bereich) ein oder zwei Rudel auf frisch erzeugte
// Karten und prueft je Karte: alle Tiere vom Abholpunkt aus erreichbar, mindestens RUDEL_ABHOLPUNKT Kacheln vom Abholpunkt, auf Kachelmitte, nicht in
// solider Kachel, Abstand der Tiere untereinander (Daten: Kreatur-Regel 1,5 Kacheln), Rudel zueinander verteilt (kleinster Abstand zweier Tiere verschiedener
// Rudel >= ZWISCHEN Kacheln), Tiere stehen auf Deck 0 (Oberflaeche bzw. Hoehlenkarte).
// Die Mindestabstaende zwischen den Rudeln sind ein MESSKRITERIUM, keine Servergarantie: rudelSetzen waehlt Mittelpunkte zufaellig unter den
// Lichtungen, verlangt zwischen Rudeln nur den Tierabstand. Der Sweep zeigt, ob das in allen Groessen reicht.
const Mon = require('../../shared/monster.js');
const Monster = require('../../server/sim/monster.js');
const Kreatur = require('../../server/sim/kreatur.js');
const H = require('../gel02-hilfen.js');

const TILE = 32;
const BIOME = ['wueste', 'wiesenwald', 'vulkan'];
const GROESSEN = ['klein', 'mittel', 'gross'];
const ABHOLPUNKT = 10;      // Kacheln (Regel von rudelSetzen, RUDEL_ABHOLPUNKT)
const TIERABSTAND = 1.5;    // Kacheln (RUDEL_ABSTAND)
const ZWISCHEN = 12;        // Kacheln: Messkriterium fuer "Rudel verteilt" (kleinster Abstand zweier Tiere verschiedener Rudel)

const mitte = (K) => ({ tx: Math.floor(K.x / TILE), ty: Math.floor(K.y / TILE) });

// Ein Fall: Spielparameter (Arena), Rudel [{ gruppe, anzahl }]. -> { probleme: [Text], zwischen: kleinster Abstand zweier Rudel (Kacheln) | null }
function fall(spiel, rudel) {
  const probleme = [];
  let s;
  try { s = H.neuesSpiel(1, spiel); } catch (e) { return { probleme: ['neuesSpiel: ' + e.message], zwischen: null }; }
  if (!s.k) return { probleme: ['keine Karte'], zwischen: null };
  const g = s.g; g.away.kreaturen = []; g.away.drones = [];
  for (const r of rudel) {
    let res;
    try { res = Kreatur.rudelSetzen(g, { map: s.map, typ: 'rudeltier', anzahl: r.anzahl, gruppe: r.gruppe }); } catch (e) { probleme.push('Ausnahme ' + r.gruppe + ': ' + e.message); continue; }
    if (res.fehler) probleme.push(r.gruppe + ': ' + res.fehler.slice(0, 120));
    else if (res.n !== r.anzahl) probleme.push(r.gruppe + ': ' + res.n + ' statt ' + r.anzahl + ' Tiere');
  }
  if (probleme.length) return { probleme, zwischen: null };
  const m1 = Monster.maskeVonGroesse(s.k, 1);
  const abh = s.k.anker.filter((a) => a.rolle === 'abholpunkt');
  const ref = abh.find((a) => a.ankunft) || abh[0];
  const dist = Mon.bfs(m1, [Mon.naechster(m1, ref.x, ref.y, 4)]);
  const tiere = g.away.kreaturen;
  const stride = s.k.decks ? s.k.decks.stride : null;
  for (const K of tiere) {
    const { tx, ty } = mitte(K);
    const a = Mon.ankerVonPosition(K.x, K.y, 1);
    if (!m1.geht(a.cx, a.cy) || dist[a.cy * m1.w + a.cx] < 0) probleme.push('unerreichbar ' + K.id);
    if (abh.some((q) => Math.hypot(tx - q.x, ty - q.y) < ABHOLPUNKT)) probleme.push('Abholpunkt ' + K.id);
    if (stride && Math.floor(ty / stride) !== 0) probleme.push('Deck ' + K.id);
  }
  let zwischen = null;
  for (let i = 0; i < tiere.length; i++) for (let j = i + 1; j < tiere.length; j++) {
    const d = Math.hypot(tiere[i].x - tiere[j].x, tiere[i].y - tiere[j].y) / TILE;
    if (tiere[i].gruppe === tiere[j].gruppe) { if (d < TIERABSTAND - 1e-9) probleme.push('Tierabstand ' + d.toFixed(2)); }
    else zwischen = zwischen === null ? d : Math.min(zwischen, d);
  }
  if (zwischen !== null && zwischen < ZWISCHEN) probleme.push('Rudel zu nah ' + zwischen.toFixed(1) + ' < ' + ZWISCHEN);
  return { probleme, zwischen };
}

// Sweep: Wildnis 3 Biome x 3 Groessen, Wildnis+Hoehle 3 Biome x klein/mittel (Deck unter Wildnis gibt es nur dort) und Hoehle (3 Groessen), je Seed 1..n; Rudelzahlen 1 und 2, Tiere 3 und 4.
// -> [{ name, karten, probleme, meldungen, zwischenMin }] (karten = Zahl der Faelle)
const VARIANTEN = [
  { name: '1 Rudel (4)', rudel: [{ gruppe: 'r_a', anzahl: 4 }] },
  { name: '1 Rudel (3)', rudel: [{ gruppe: 'r_a', anzahl: 3 }] },
  { name: '2 Rudel (4+4)', rudel: [{ gruppe: 'r_a', anzahl: 4 }, { gruppe: 'r_b', anzahl: 4 }] },
  { name: '2 Rudel (3+3)', rudel: [{ gruppe: 'r_a', anzahl: 3 }, { gruppe: 'r_b', anzahl: 3 }] },
];
function sweep(n, nur) {
  const faelle = [];
  const arten = [];
  for (const biom of BIOME) for (const gr of GROESSEN) arten.push({ name: 'wildnis ' + biom + ' ' + gr, spiel: (seed) => ({ art: 'wildnis', seed, biom, groesse: gr }) });
  for (const biom of BIOME) for (const gr of ['klein', 'mittel']) arten.push({ name: 'wildnis+hoehle ' + biom + ' ' + gr, spiel: (seed) => ({ art: 'wildnis', seed, biom, groesse: gr, hoehle: true }) });
  for (const gr of GROESSEN) arten.push({ name: 'hoehle ' + gr, spiel: (seed) => ({ art: 'hoehle', seed, groesse: gr }) });
  for (const a of arten) {
    if (nur && !nur.test(a.name)) continue;
    for (const v of VARIANTEN) {
      const f = { name: a.name + ' | ' + v.name, karten: 0, probleme: 0, meldungen: {}, zwischenMin: null };
      for (let seed = 1; seed <= n; seed++) {
        const r = fall(a.spiel(seed), v.rudel);
        f.karten++;
        if (r.zwischen !== null) f.zwischenMin = f.zwischenMin === null ? r.zwischen : Math.min(f.zwischenMin, r.zwischen);
        if (r.probleme.length) { f.probleme++; for (const p of r.probleme) { const k = p.replace(/\d+/g, '#').slice(0, 90); f.meldungen[k] = (f.meldungen[k] || 0) + 1; } }
      }
      faelle.push(f);
    }
  }
  return faelle;
}

module.exports = { fall, sweep, VARIANTEN, ZWISCHEN, ABHOLPUNKT, TIERABSTAND };
