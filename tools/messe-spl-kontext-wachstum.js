'use strict';
// SPL-01 a3: Kontext-Wachstum je gespeichertem Gelaende-Landepunkt. Der Spielleiter legt Wildnis/Hoehle ueber buehne.neu an; jeder gespeicherte
// Landepunkt steht danach im Kontext (orte[].landepunkte). Gemessen mit synthetischen Weltstaenden (nach-tutorial + n neue, besuchte Landepunkte am Ort kesh),
// Tokens = Zeichen / 2,5. Liest nur. Erkundungswert SPL-01: etwa 93 Tokens je Landepunkt, linear.
// SPL-01 a2: zwei Messungen je n: "ohne Deckel" (spielleiter.kontext.gelaendeEinzeln auf 1e9, Stand vor a2) und "mit Deckel" (Konfigurationswert).
// Aufruf:  node tools/messe-spl-kontext-wachstum.js [--art wildnis|hoehle] [--json]      (npm run messe:spl-kontext-wachstum)
//   --art  Kartenart der neuen Landepunkte, Standard wildnis
// Ausgabe: je n in 0, 5, 10, 20, 40: Eintraege im Kontext, Tokens aller landepunkte-Felder, Zuwachs gegen n=0, Tokens je Landepunkt; Beispieleintrag.
// Exit: 0 gemessen, 1 Fehler beim Messen (auch: weniger Eintraege im Kontext als angelegt), 2 falscher Aufruf.
const M = require('./lib/messe-spl.js');
const Context = require('../server/mission/context.js');
const Config = require('../shared/config.js');
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
      b[`kesh.${art}-${i}`] = { seed: 1000 + i, bauversion: art === 'wildnis' ? '~gelaende.3' : '~hoehle.1', art, bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt', zustaende: { 'fund.1': 'genommen' }, alarm: false, besuche: 1, zuletzt: i, letzte_mission: null, neu: true, gesperrt: false, ort: 'kesh', beam: { x: 1650, y: 1060, range: 360 } };
    }
    w.welt.landepunkte = b; return w;
  };
  const lpTok = (c) => M.tok(c.orte.map((o) => [o.landepunkte || [], o.landepunkte_mehr || null]));
  const kont = Config.spielleiter.kontext; const deckel = kont.gelaendeEinzeln;
  const messen = (n, grenze) => {
    kont.gelaendeEinzeln = grenze;
    try { const c = Context.build(mitNeuen(n), {}, katalog); return { c, lp: c.orte.flatMap((o) => o.landepunkte || []).filter((x) => x.id.includes(art)), t: lpTok(c) }; }
    finally { kont.gelaendeEinzeln = deckel; }
  };
  const basis = lpTok(Context.build(w0, {}, katalog));
  const zeilen = []; const text = [];
  for (const n of NS) {
    const roh = messen(n, 1e9); const dk = messen(n, deckel);
    if (roh.lp.length !== n) throw new Error(`n=${n}: ${roh.lp.length} Eintraege im Kontext statt ${n} (ohne Deckel)`);
    if (dk.lp.length !== Math.min(n, deckel)) throw new Error(`n=${n}: ${dk.lp.length} Eintraege im Kontext statt ${Math.min(n, deckel)} (mit Deckel)`);
    zeilen.push({ n, ohneDeckel: { eintraege: roh.lp.length, tokens: roh.t, plus: roh.t - basis }, mitDeckel: { eintraege: dk.lp.length, tokens: dk.t, plus: dk.t - basis },
      jeLandepunkt: n ? Math.round((roh.t - basis) / n * 10) / 10 : null, beispiel: n ? roh.lp[0] : null });
  }
  text.push(...M.tabelle([['n', 'ohne Deckel: Eintraege', 'Tokens', 'plus', `mit Deckel (${deckel}): Eintraege`, 'Tokens', 'plus', 'je Landepunkt (ohne)'],
    ...zeilen.map((z) => [z.n, z.ohneDeckel.eintraege, z.ohneDeckel.tokens, `+${z.ohneDeckel.plus}`, z.mitDeckel.eintraege, z.mitDeckel.tokens, `+${z.mitDeckel.plus}`, z.jeLandepunkt == null ? '-' : z.jeLandepunkt])]));
  text.push(`Beispiel: ${JSON.stringify(zeilen[1].beispiel)}`);
  return { text, daten: { art, gelaendeEinzeln: deckel, basis, zeilen } };
});
