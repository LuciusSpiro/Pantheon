'use strict';
// BOT-04 D2: Messkatalog gegen den echten Matcher. Jede Phrase aus tools/fixtures/bot-messung/phrasen.json (Messmodus ?botmessung=1) und jeder Beispielsatz aus
// katalog.json (Mock-Katalog) geht durch shared/bot-matcher.js (mit content/bots/kanon.json und muster.json); erwartungErfuellt (bot-sprache.js) prueft erwartet == Ergebnis.
// Erwartet null (phrasen.json) bzw. ohneMatcher (katalog.json) = der Matcher MUSS null liefern (nav.sprung ist per Sprache nicht erreichbar, "Torpedo klar machen" kennt der Kanon nicht).
// Standardwerte (Feuer frei ohne Waffe, Abstand halten ohne Ziel) fuellt der Server, nicht der Matcher: dort stehen keine Argumente. Systemnamen sind Spiel-IDs.
//   node tools/test-bot-katalog.js
const M = require('../shared/bot-matcher.js');
const BS = require('../public/js/bot-sprache.js');
const KANON = require('../content/bots/kanon.json');
const MUSTER = require('../content/bots/muster.json');
const KATALOG = require('./fixtures/bot-messung/katalog.json');
const PHRASEN = require('./fixtures/bot-messung/phrasen.json').phrasen;

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');
M.setzeMuster(Object.assign({}, MUSTER, { kanon: KANON }));

section('phrasen.json: Messmodus');
ok(PHRASEN.length >= 24 && new Set(PHRASEN.map((p) => p.id)).size === PHRASEN.length, 'Phrasen vorhanden, Kennungen eindeutig (' + PHRASEN.length + ')');
for (const p of PHRASEN) {
  const res = M.match(p.text);
  ok(BS.erwartungErfuellt(p.erwartet, res), p.id + ' "' + p.text + '": erwartet ' + JSON.stringify(p.erwartet) + ' == Matcher ' + JSON.stringify(res && { an: res.an, befehl: res.befehl, args: res.args }));
}
const nullIds = PHRASEN.filter((p) => p.erwartet === null).map((p) => p.text);
ok(nullIds.length === 2 && nullIds.includes('Sprung nach Hex zwölf') && nullIds.includes('Torpedo klar machen'), 'genau zwei bewusst null erwartet: nav.sprung und Torpedo klar machen');
ok(!BS.erwartungErfuellt(null, { befehl: 'ops.feuer_frei', args: {} }) && BS.erwartungErfuellt(null, null), 'erwartungErfuellt: erwartet null heisst "Matcher liefert null"');
ok(!PHRASEN.some((p) => p.erwartet && p.erwartet.args && Object.values(p.erwartet.args).some((v) => ['antrieb', 'waffen'].includes(String(v)) && p.erwartet.befehl !== 'ops.feuer_frei')), 'keine veralteten Systemnamen (antrieb/waffen) in den Erwartungen');

section('katalog.json: Mock-Katalog');
for (const k of KATALOG) {
  const res = M.match(k.spricht);
  if (k.ohneMatcher) ok(res === null, k.befehl + ' "' + k.spricht + '": ohneMatcher, der Matcher liefert null');
  else ok(BS.erwartungErfuellt({ befehl: k.befehl, an: k.an, args: k.args || {} }, res), k.befehl + ' "' + k.spricht + '": Katalog == Matcher ' + JSON.stringify(res && { an: res.an, befehl: res.befehl, args: res.args }));
}
ok(KATALOG.filter((k) => k.ohneMatcher).map((k) => k.befehl).join() === 'nav.sprung', 'nur nav.sprung ist ohneMatcher');

console.log('\n' + (fails ? fails + ' FEHLER von ' + n : n + '/' + n + ' ok'));
process.exit(fails ? 1 : 0);
