'use strict';
// SPL-01 a3: Kontext-Messung. Wie viele Tokens kosten die Felder des Spielleiter-Kontexts, die S2b/GEL-02 ergaenzt haben (Landepunkte je Ort,
// Kartenarten, Bodenbilanz, Fraktionen, Gegner, gesehene Rollen, Bewaffnung)? Nachbildung von T13 in tools/test-spielleiter.js
// (Grobplan-Kontext ohne 'verfuegbar', vorher = ohne diese Felder, nachher = mit; Schaetzung 2,5 Zeichen je Token; Grenze 2200) plus Aufschluesselung je Feld.
// Liest nur. Formel gemeinsam mit T13: tools/lib/messe-spl.js kontextZuwachs.
// Aufruf:  node tools/messe-spl-kontext.js [--json]        (npm run messe:spl-kontext)
// Ausgabe: je Weltstand-Fixture (tools/fixtures/context) Zuwachs "plus" und Tokens je Feld; "max plus" und Luft zur Grenze 2200;
//          Tokens von 'verfuegbar' (nicht im Prompt-Kontext); Groesse je Kartenart und je Fraktion (Nach-Tutorial-Stand).
// Exit: 0 gemessen (auch ueber der Grenze: das prueft T13), 1 Fehler beim Messen, 2 falscher Aufruf.
const M = require('./lib/messe-spl.js');
const Context = require('../server/mission/context.js');
const Katalog = require('../server/mission/katalog.js');

const GRENZE = M.KONTEXT_GRENZE;
const FELDER = M.KONTEXT_FELDER;
const flags = M.args(process.argv.slice(2), { json: 'flag' }, 'Aufruf: node tools/messe-spl-kontext.js [--json]');

M.laufen('messe-spl-kontext', flags, () => {
  const katalog = Katalog.load({});
  let max = 0;
  const welten = []; const text = [];
  for (const [name, w] of M.weltstaende()) {
    const c = Context.build(w, {}, katalog);
    const { vorher: a, nachher: b, plus } = M.kontextZuwachs(c); max = Math.max(max, plus);
    const teile = {};
    for (const k of FELDER) teile[k] = M.tok(c[k] || null);
    teile.landepunkte = M.tok(c.orte.map((o) => o.landepunkte || []));
    teile.bewaffnung = M.tok((c.crew || {}).bewaffnung || null);
    welten.push({ name, vorher: a, nachher: b, plus, felder: teile, verfuegbar: M.tok(c.verfuegbar || null) });
    text.push(`${name} ${a}->${b} plus ${plus} ${JSON.stringify(teile)}`);
  }
  const c = Context.build(M.weltstand('nach-tutorial'), {}, katalog);
  const kartenarten = c.kartenarten.map((k) => [k.id, M.tok(k)]);
  const fraktionen = c.fraktionen.map((f) => [f.id, M.tok(f), f.rezepte.length]);
  text.push(`max plus ${max} (Grenze ${GRENZE}) -> Luft ${GRENZE - max}`);
  text.push(`verfuegbar (Tokens, nicht in der Grenze): ${JSON.stringify(Object.fromEntries(welten.map((x) => [x.name, x.verfuegbar])))}`);
  text.push(`kartenarten (id, Tokens): ${JSON.stringify(kartenarten)}`);
  text.push(`fraktionen (id, Tokens, Rezepte): ${JSON.stringify(fraktionen)}`);
  return { text, daten: { grenze: GRENZE, maxPlus: max, luft: GRENZE - max, welten, kartenarten, fraktionen } };
});
