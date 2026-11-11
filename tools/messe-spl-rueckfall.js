'use strict';
// SPL-01 a3: Rueckfall-Zaehler. Faellt der Spielleiter auf den Rueckfall zurueck (erst Archiv, dann Mock-Grobplan), waehlt der dann jemals
// eine Wildnis- oder Hoehlenkarte? Je Seed: zufaellige Teilmenge schon gespielter Archiv-Eintraege (50 %), Bodenpflicht an/aus (50 %),
// Auswahl ueber Archiv.pick und LLM.mockGrobplan, danach szenenbau.aufloesen; gezaehlt werden die Kartenarten der Landepunkt-Szenen. Liest nur.
// Erkundungswert SPL-01: Gelaende 0 von 100 Plaenen (50 Seeds x Archiv + Mock).
// Aufruf:  node tools/messe-spl-rueckfall.js [--seeds n] [--json]      (npm run messe:spl-rueckfall)
//   --seeds n  Anzahl Seeds, Standard 50 (deterministischer Zufall, xorshift mit festem Start)
// Ausgabe: Landepunkt-Arten je Quelle (Archiv/Mock), Plaene ohne Bodenszene, Plaene mit wildnis/hoehle von (Archiv-Plaene + Mock-Plaene).
// Exit: 0 gemessen, 1 Fehler beim Messen, 2 falscher Aufruf. Keine Erwartung (Wert ist Befund, kein Gate).
const M = require('./lib/messe-spl.js');
const Archiv = require('../server/mission/archiv.js');
const SB = require('../server/mission/szenenbau.js');
const Context = require('../server/mission/context.js');
const LLM = require('../server/mission/llm.js');
const Katalog = require('./katalog.js');

const flags = M.args(process.argv.slice(2), { seeds: 'zahl', json: 'flag' }, 'Aufruf: node tools/messe-spl-rueckfall.js [--seeds n] [--json]');
const N = flags.seeds || 50;

M.laufen('messe-spl-rueckfall', flags, () => {
  const katalog = Katalog.load({});
  const env = SB.buildEnv(katalog);
  const w = M.weltstand('nach-tutorial');
  const lpA = Context.lpAdapterAusWelt(w);
  const entries = Archiv.load().entries;
  const bodenInfo = (x) => SB.bodenInfo(x.grobplan, env, { langAbMin: 25, langMaxMin: 35, langeJeRunde: 1, wiederholtFenster: 3 });
  function artenVon(g, ctx) {
    const c = M.clone(g);
    const r = SB.aufloesen(c, env, ctx, { lp: lpA });
    const out = [];
    for (const s of c.szenen) {
      if (!s.landepunkt) continue;
      const i = lpA.info(s.landepunkt) || {};
      out.push(i.art || (r.neu.find((n) => n.id === s.landepunkt) || {}).art || '?');
    }
    return { arten: out, fehler: r.errors.length };
  }
  let x = 12345; const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const zaehl = { archiv: {}, mock: {} }; const ohne = { archiv: 0, mock: 0 }; let gelaende = 0; let archivPlaene = 0;
  const plus = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (let seed = 1; seed <= N; seed++) {
    const gespielt = entries.filter(() => rnd() < 0.5).map((e) => e.name);
    const pflicht = rnd() < 0.5;
    const ctx = Context.build(w, M.anlass(), katalog);
    ctx.bodenbilanz = { letzte: pflicht ? [{ titel: 'x', boden: false }] : [], pflicht_jetzt: pflicht, lang_ab_min: 25 };
    const e = Archiv.pick(entries, gespielt, ctx, [], { boden: pflicht, ohneLang: false, info: bodenInfo });
    if (e) {
      archivPlaene++;
      const a = artenVon(e.grobplan, ctx);
      for (const k of a.arten) plus(zaehl.archiv, k);
      if (!a.arten.length) ohne.archiv++;
      if (a.arten.some((k) => k === 'wildnis' || k === 'hoehle')) gelaende++;
    }
    const g = LLM.mockGrobplan({ anlass: { art: 'missionsgrenze', crew: 3 }, kontext: ctx }, katalog);
    const m = artenVon(g, ctx);
    for (const k of m.arten) plus(zaehl.mock, k);
    if (!m.arten.length) ohne.mock++;
    if (m.arten.some((k) => k === 'wildnis' || k === 'hoehle')) gelaende++;
  }
  const gesamt = archivPlaene + N;
  const text = [
    `Archiv-Eintraege: ${entries.length} (${entries.map((e) => e.name).join(',')})`,
    `Landepunkt-Arten Archiv-Rueckfall (${N} Seeds, ${archivPlaene} Plaene): ${JSON.stringify(zaehl.archiv)} ohne Bodenszene ${ohne.archiv}`,
    `Landepunkt-Arten Mock-Grobplan (${N} Seeds): ${JSON.stringify(zaehl.mock)} ohne Bodenszene ${ohne.mock}`,
    `Plaene mit wildnis/hoehle gesamt: ${gelaende} von ${gesamt}`,
  ];
  return { text, daten: { seeds: N, archivEintraege: entries.length, archiv: { plaene: archivPlaene, arten: zaehl.archiv, ohneBoden: ohne.archiv }, mock: { plaene: N, arten: zaehl.mock, ohneBoden: ohne.mock }, gelaendePlaene: gelaende, plaeneGesamt: gesamt } };
});
