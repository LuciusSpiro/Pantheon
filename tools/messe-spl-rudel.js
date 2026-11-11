'use strict';
// SPL-01 a3: Rudel-Erreichbarkeit. Setzt ein Rudeltier (Kreatur.rudelSetzen, typ rudeltier, 6 Tiere) auf frisch erzeugte Gelaende-Karten und zaehlt,
// auf wie vielen Seeds die Platzierung klappt und auf welchen Decks die Tiere stehen. Liest nur, im Speicher (Spiel ohne Store, wie tools/gel02-hilfen.js).
// Erkundungswert SPL-01: Oberflaeche (wildnis) 20/20; Hoehle-Deck unter Wildnis (bereich 'hoehle') 0/20.
// Aufruf:  node tools/messe-spl-rudel.js [--seeds n] [--json]      (npm run messe:spl-rudel)
//   --seeds n  Seeds je Fall (1..n), Standard 20
// Faelle: wildnis (wueste/mittel), hoehle (mittel, ohne Bereich), wildnis+hoehle (vulkan/mittel, ohne Bereich = Oberflaeche),
//         wildnis+hoehle mit bereich 'hoehle' (zweites Deck), hoehle mit bereich 'lager_1' (Seed 3, Einzelprobe).
// Ausgabe: je Fall ok / fehler (mit Meldung) und die Decks der Tiere.
// Exit: 0 gemessen, 1 Fehler beim Messen, 2 falscher Aufruf. Keine Erwartung (Befund, kein Gate).
const M = require('./lib/messe-spl.js');
process.chdir(M.WURZEL);
const H = require('./gel02-hilfen.js');
const Kreatur = require('../server/sim/kreatur.js');

const flags = M.args(process.argv.slice(2), { seeds: 'zahl', json: 'flag' }, 'Aufruf: node tools/messe-spl-rudel.js [--seeds n] [--json]');
const N = flags.seeds || 20;

M.laufen('messe-spl-rudel', flags, () => {
  const seeds = [...Array(N)].map((_, i) => i + 1);
  const faelle = [];
  function lauf(name, spiel, setzen, seedsFall) {
    let ok = 0; let fehl = 0; const msgs = {}; const decks = new Set();
    const merke = (m) => { const k = String(m).slice(0, 90); msgs[k] = (msgs[k] || 0) + 1; };
    for (const seed of seedsFall) {
      let s;
      try { s = H.neuesSpiel(1, spiel(seed)); } catch (e) { fehl++; merke(`neuesSpiel: ${e.message}`); continue; }
      const g = s.g; g.away.kreaturen = [];
      let r;
      try { r = Kreatur.rudelSetzen(g, Object.assign({ map: s.map, typ: 'rudeltier', anzahl: 6 }, setzen)); } catch (e) { fehl++; merke(e.message); continue; }
      if (r.fehler) { fehl++; merke(r.fehler); continue; }
      ok++;
      const st = s.k.decks ? s.k.decks.stride : null;
      for (const K of g.away.kreaturen) decks.add(st ? Math.floor(K.y / 32 / st) : 0);
    }
    faelle.push({ name, ok, fehler: fehl, von: seedsFall.length, meldungen: msgs, decks: [...decks].sort() });
  }
  lauf('wildnis', (seed) => ({ art: 'wildnis', seed, biom: 'wueste', groesse: 'mittel' }), { bereich: null, gruppe: 'rudel_a' }, seeds);
  lauf('hoehle', (seed) => ({ art: 'hoehle', seed, groesse: 'mittel' }), { bereich: null, gruppe: 'rudel_a' }, seeds);
  lauf('wildnis+hoehle (Oberflaeche)', (seed) => ({ art: 'wildnis', seed, biom: 'vulkan', groesse: 'mittel', hoehle: true }), { bereich: null, gruppe: 'rudel_a' }, seeds);
  lauf("wildnis+hoehle bereich='hoehle'", (seed) => ({ art: 'wildnis', seed, biom: 'vulkan', groesse: 'mittel', hoehle: true }), { bereich: 'hoehle', gruppe: 'rudel_b' }, seeds);
  lauf("hoehle bereich='lager_1' (Seed 3)", (seed) => ({ art: 'hoehle', seed, groesse: 'mittel' }), { bereich: 'lager_1', gruppe: 'y' }, [3]);
  const text = faelle.map((f) => `${f.name}: ok ${f.ok}/${f.von} fehler ${f.fehler} ${JSON.stringify(f.meldungen)} Decks [${f.decks}]`);
  return { text, daten: { seeds: N, faelle } };
});
