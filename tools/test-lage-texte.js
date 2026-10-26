'use strict';
// SUND-03 F2 Z2: Funktexte der Regie-Schicht (content/flotte/lage-befehle.json): Vorwarnung, Wirkung und Entwarnung, durchgerendert für alle Waren (jede nichtleere Teilmenge von M, T, E) auf Platzhalter-
// und Grammatik-Reste. Früher stand dort „Die Sperre des Konkordats gilt jetzt, Medizin kommen nicht mehr zu uns“ (Singular/Plural der Waren-Namen gemischt).
//   node tools/test-lage-texte.js   (npm run test:lage-texte)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Kriegslage = require('../server/sim/kriegslage.js');
const Regie = require('../server/sim/regie-befehle.js');
const F = require('./regie-fixture.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TEXTE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'flotte', 'lage-befehle.json'), 'utf8'));
const ws = (g) => g.weltsim, z = (g) => g.weltsim.zustand;
const tick = (g, k) => { for (let i = 0; i < (k || 1); i++) Kriegslage.tick(g, 'test'); };

console.log('\nDaten: alle Texte, Platzhalter bekannt');
const alle = [];
for (const abschnitt of ['vorwarnung', 'wirksam', 'entwarnung']) for (const [k, v] of Object.entries(TEXTE[abschnitt])) alle.push([abschnitt + '.' + k, v.text]);
ok(alle.length >= 9, alle.length + ' Texte (Vorwarnung, Wirkung, Entwarnung)');
for (const [name, t] of alle) {
  const ph = [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  ok(ph.every((p) => ['ziel', 'n', 'waren'].includes(p)) && /[.!]$/.test(t) && !/\s{2,}| ,|,,|\.\./.test(t), `${name}: nur bekannte Platzhalter, ein Satzende, keine doppelten Leerzeichen oder Kommas`);
}
const wirk = TEXTE.wirksam.embargo.text;
ok(!/kommen nicht mehr zu uns/.test(wirk) && /\{waren\}/.test(wirk), 'die Wirkungsmeldung hat keine Verbform, die an Singular oder Plural der Ware hängt: ' + wirk);

console.log('\nDurchgerendert: jede Waren-Teilmenge, Vorwarnung, Wirkung, Entwarnung');
const WAREN = ['M', 'T', 'E'];
const teilmengen = []; for (let m = 1; m < 8; m++) teilmengen.push(WAREN.filter((_, i) => m & (1 << i)));
function neuesEmbargoSpiel() {
  const t = F.neuesSpiel({}); const g = t.g;
  for (let i = 0; i < 2; i++) ws(g).ereignisse.push({ n: ws(g).tickZahl, typ: 'hafen_gefallen', fraktion: 'rom', ort: '0105', ortName: 'Carrara', alt: 'ger', neu: 'rom' });
  return t;
}
const rest = (txt) => /\{|\}|undefined|NaN|\[object|, und |und und|  /.test(txt);
for (const waren of teilmengen) {
  const namen = waren.map((w) => TEXTE.waren[w]);
  const liste = namen.length > 1 ? namen.slice(0, -1).join(', ') + ' und ' + namen[namen.length - 1] : namen[0];
  const plan = { befehle: [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren, dauer: 6 }] };
  const t = neuesEmbargoSpiel();
  const r = Regie.planAnwenden(t.g, plan);
  const vor = t.funk().filter((x) => /Sperre/.test(x));
  ok(r.angenommen.length === 1 && vor.length === 1 && vor[0].includes('Sperre für ' + liste + '.') && !rest(vor[0]), `${waren.join('')}: Vorwarnung nennt „${liste}“, ohne Reste`);
  tick(t.g, Regie.R.vorwarnung.wert.vorlauf.embargo + 2);
  const wirkung = t.funk().filter((x) => /Sperre des Konkordats gilt/.test(x));
  ok(wirkung.length === 1 && wirkung[0] === 'Die Sperre des Konkordats gilt jetzt. Gesperrt: ' + liste + '.' && !rest(wirkung[0]), `${waren.join('')}: Wirkung „${wirkung[0]}“`);
  const u = neuesEmbargoSpiel();
  Regie.planAnwenden(u.g, plan);
  Regie.rueckfall(u.g, 'Test');
  const ent = u.funk().filter((x) => /Entwarnung/.test(x));
  ok(ent.length === 1 && ent[0] === 'Entwarnung: Die angedrohte Sperre für ' + liste + ' kommt nicht, die Lieferungen laufen weiter.' && !rest(ent[0]), `${waren.join('')}: Entwarnung „${ent[0]}“`);
}

console.log('\nDurchgerendert: Angriff und Überfall (Ziel, Sprünge)');
{
  const t = F.neuesSpiel({}); const g = t.g, zz = z(g);
  zz.angriffe = [];
  for (const fl of zz.flotten) { fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null; fl.angriff = null; fl.warte = 0; fl.staerke = fl.kap; fl.versorgung = 1; }
  for (const f of ['rom', 'ger']) { zz.vorrat[f].T = 40; zz.vorrat[f].U = 40; zz.marken[f] = 500; }
  const r = Regie.planAnwenden(g, { befehle: [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403' }] });
  const vor = t.funk().filter((x) => /Verbände|Schlag/.test(x));
  ok(r.angenommen.length === 1 && vor.length === 1 && !rest(vor[0]) && /Speculum/.test(vor[0]) && /\d+ Sprüngen/.test(vor[0]), 'Angriff: Vorwarnung nennt Ziel und Sprünge: ' + vor[0]);
  Regie.rueckfall(g, 'Test');
  const ent = t.funk().filter((x) => /Entwarnung/.test(x));
  ok(ent.length === 1 && !rest(ent[0]) && /Speculum/.test(ent[0]), 'Angriff: Entwarnung nennt das Ziel: ' + ent[0]);
}
console.log(`\n${n - fails} von ${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
