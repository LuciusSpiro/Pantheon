'use strict';
// SPL-01 a3: Kontext-Wachstum je gespeichertem Gelaende-Landepunkt. Der Spielleiter legt Wildnis/Hoehle ueber buehne.neu an; jeder gespeicherte
// Landepunkt steht danach im Kontext (orte[].landepunkte). Gemessen mit synthetischen Weltstaenden (nach-tutorial + n neue, besuchte Landepunkte am Ort kesh),
// Tokens = Zeichen / 2,5. Liest nur. Erkundungswert SPL-01: etwa 93 Tokens je Landepunkt, linear.
// Aufruf:  node tools/messe-spl-kontext-wachstum.js [--art wildnis|hoehle] [--json]      (npm run messe:spl-kontext-wachstum)
//   --art  Kartenart der neuen Landepunkte, Standard wildnis
// Ausgabe: je n in 0, 5, 10, 20, 40: Eintraege im Kontext, Tokens aller landepunkte-Felder, Zuwachs gegen n=0, Tokens je Landepunkt; Beispieleintrag.
// Exit: 0 gemessen, 1 Fehler beim Messen (auch: weniger Eintraege im Kontext als angelegt), 2 falscher Aufruf.
const M = require('./lib/messe-spl.js');
const Context = require('../server/mission/context.js');
const Katalog = require('./katalog.js');

const flags = M.args(process.argv.slice(2), { art: 'text', json: 'flag' }, 'Aufruf: node tools/messe-spl-kontext-wachstum.js [--art wildnis|hoehle] [--json]');
const art = flags.art || 'wildnis';
if (!['wildnis', 'hoehle'].includes(art)) { console.error(`--art: wildnis oder hoehle, nicht "${art}"`); process.exit(2); }
const NS = [0, 5, 10, 20, 40];

M.laufen('messe-spl-kontext-wachstum', flags, () => {
  const katalog = Katalog.load({});
  const w0 = M.weltstand('nach-tutorial');
  const mitNeuen = (n) => {
    const w = M.clone(w0); w.welt = Object.assign({}, w.welt);
    const b = Object.assign({}, w.welt.landepunkte || {});
    for (let i = 1; i <= n; i++) {
      b[`kesh.${art}-${i}`] = { seed: 1000 + i, bauversion: art === 'wildnis' ? '~gelaende.3' : '~hoehle.1', art, bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt', zustaende: { 'fund.1': 'genommen' }, alarm: false, besuche: 1, letzte_mission: null, neu: true, gesperrt: false, ort: 'kesh', beam: { x: 1650, y: 1060, range: 360 } };
    }
    w.welt.landepunkte = b; return w;
  };
  const lpTok = (c) => M.tok(c.orte.map((o) => o.landepunkte || []));
  const basis = lpTok(Context.build(w0, {}, katalog));
  const zeilen = []; const text = [];
  for (const n of NS) {
    const c = Context.build(mitNeuen(n), {}, katalog);
    const lp = c.orte.flatMap((o) => o.landepunkte || []).filter((x) => x.id.includes(art));
    if (lp.length !== n) throw new Error(`n=${n}: ${lp.length} Eintraege im Kontext statt ${n}`);
    const t = lpTok(c);
    zeilen.push({ n, eintraege: lp.length, tokens: t, plus: t - basis, jeLandepunkt: n ? Math.round((t - basis) / n * 10) / 10 : null, beispiel: n ? lp[0] : null });
  }
  text.push(...M.tabelle([['n', 'Eintraege', 'Tokens', 'plus', 'je Landepunkt'], ...zeilen.map((z) => [z.n, z.eintraege, z.tokens, `+${z.plus}`, z.jeLandepunkt == null ? '-' : z.jeLandepunkt])]));
  text.push(`Beispiel: ${JSON.stringify(zeilen[1].beispiel)}`);
  return { text, daten: { art, basis, zeilen } };
});
