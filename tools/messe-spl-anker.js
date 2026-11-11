'use strict';
// SPL-01 a3: Anker-Sweep. Welche Anker-Rollen und wie viele liefern die Gelaende-Generatoren ueber Seeds (karteRoh)? Daraus folgt, welchen
// Pflichtsatz der Spielleiter-Kontext (kartenarten[].pflichtsatz) ehrlich zusagen kann. Liest nur, im Speicher.
// Aufruf:  node tools/messe-spl-anker.js [--seeds n] [--json]      (npm run messe:spl-anker)
//   --seeds n  Seeds je Gruppe (1..n), Standard 50
// Gruppen: Wildnis 3 Biome (wueste, wiesenwald, vulkan) x 3 Groessen (klein, mittel, gross); Hoehle 3 Groessen; Wildnis+Hoehle (wueste/vulkan x klein/mittel).
// Ausgabe: je Gruppe Anzahl Karten, Wuerfe (Generator wirft: Karte zaehlt nicht), min und max je Anker-Rolle; zum Schluss je Kartenart der Pflichtsatz des Kontexts
//          (context.kartenartenOf) gegen das gemessene Minimum ("fehlt" = Rolle hat in mindestens einer Gruppe weniger als zugesagt).
// Der Pflichtsatz aendert sich mit dem Paket SPL-01 a1 (wache >= 3): diese Messung ist darum KEIN Test mit Erwartung, sie zeigt den Abstand.
// Exit: 0 gemessen, 1 Fehler beim Messen, 2 falscher Aufruf.
const M = require('./lib/messe-spl.js');
const G = require('../shared/gen-gelaende.js');
const H = require('../shared/gen-hoehle.js');
const Context = require('../server/mission/context.js');

const flags = M.args(process.argv.slice(2), { seeds: 'zahl', json: 'flag' }, 'Aufruf: node tools/messe-spl-anker.js [--seeds n] [--json]');
const N = flags.seeds || 50;

M.laufen('messe-spl-anker', flags, () => {
  const gruppen = [];
  function sweep(name, art, fn) {
    const mn = {}; const mx = {}; let n = 0; let wuerfe = 0;
    for (let s = 1; s <= N; s++) {
      let r;
      try { r = fn(s); } catch (e) { wuerfe++; continue; }
      n++;
      const z = {};
      for (const a of r.anker) z[a.rolle] = (z[a.rolle] || 0) + 1;
      for (const k of new Set([...Object.keys(z), ...Object.keys(mn)])) {
        const v = z[k] || 0;
        mn[k] = mn[k] == null ? v : Math.min(mn[k], v);
        mx[k] = Math.max(mx[k] || 0, v);
      }
    }
    gruppen.push({ name, art, karten: n, wuerfe, min: mn, max: mx });
  }
  for (const biom of ['wueste', 'wiesenwald', 'vulkan']) for (const gr of ['klein', 'mittel', 'gross']) sweep(`wildnis ${biom} ${gr}`, 'wildnis', (s) => G.erzeuger().karteRoh(s, { biom, groesse: gr }));
  for (const gr of ['klein', 'mittel', 'gross']) sweep(`hoehle ${gr}`, 'hoehle', (s) => H.erzeuger().karteRoh(s, { groesse: gr }));
  for (const biom of ['wueste', 'vulkan']) for (const gr of ['klein', 'mittel']) sweep(`wildnis+hoehle ${biom} ${gr}`, 'wildnis', (s) => G.erzeuger().karteRoh(s, { biom, groesse: gr, hoehle: true }));

  const text = gruppen.map((g) => `${g.name} Karten ${g.karten} Wuerfe ${g.wuerfe} min ${JSON.stringify(g.min)} max ${JSON.stringify(g.max)}`);
  // Pflichtsatz des Kontexts gegen gemessenes Minimum je Kartenart (nur Kartenarten, die hier gemessen werden)
  const pflicht = [];
  for (const k of Context.kartenartenOf()) {
    const gs = gruppen.filter((g) => g.art === k.id && g.karten > 0);
    if (!gs.length) continue;
    const roh = {};
    for (const r of Object.keys(k.pflichtsatz)) {
      const minimum = Math.min(...gs.map((g) => (g.min[r] == null ? 0 : g.min[r])));
      roh[r] = { zugesagt: k.pflichtsatz[r], gemessenMin: minimum, fehlt: minimum < k.pflichtsatz[r] };
    }
    pflicht.push({ art: k.id, rollen: roh });
  }
  text.push('', 'Pflichtsatz im Kontext gegen gemessenes Minimum (zugesagt/gemessen):');
  for (const p of pflicht) text.push(`  ${p.art}: ${Object.entries(p.rollen).map(([r, v]) => `${r} ${v.zugesagt}/${v.gemessenMin}${v.fehlt ? ' fehlt' : ''}`).join(', ')}`);
  return { text, daten: { seeds: N, gruppen, pflichtsatz: pflicht } };
});
