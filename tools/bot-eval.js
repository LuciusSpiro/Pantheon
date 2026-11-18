'use strict';
// BOT-04 A1: Eval-Runner fuer den Bot-Matcher. Laedt tools/fixtures/bot-eval/eval.json (Array von
// { text, art: 'positiv'|'stt-fehler'|'negativ', erwartet: { befehl, args } | null }), laesst shared/bot-matcher.js match() laufen und
// gibt n, Trefferquote (positiv + stt-fehler), Falsch-Positiv-Zahl und die Fehlfaelle aus.
//   node tools/bot-eval.js [datei.json] [--schwelle 0.85] [--json]
// Treffer: Befehl und Argumente stimmen (Argumente werden als Text verglichen, "3" gleich 3; fehlende Argumente gleich {}).
// Falsch-Positiv: match liefert einen Befehl, obwohl keiner erwartet war (negativ) oder einen anderen als den erwarteten.
// Exit 0: Falsch-Positiv 0 und Quote >= 0,95. Exit 1: sonst. Exit 2: Datei fehlt oder ungueltig.
const fs = require('fs');
const path = require('path');
const M = require('../shared/bot-matcher.js');

const QUOTE_MIN = 0.95;
const args = process.argv.slice(2);
let datei = path.join(__dirname, 'fixtures', 'bot-eval', 'eval.json');
let schwelle; let alsJson = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--schwelle') schwelle = Number(args[++i]);
  else if (args[i] === '--json') alsJson = true;
  else datei = path.resolve(args[i]);
}
if (schwelle !== undefined && !(schwelle > 0 && schwelle <= 1)) { console.error('--schwelle muss in (0, 1] liegen'); process.exit(2); }

let eval_;
try { eval_ = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { console.error('Eval-Set nicht lesbar: ' + datei + ' (' + e.message + ')'); process.exit(2); }
if (!Array.isArray(eval_) || !eval_.length) { console.error('Eval-Set leer oder kein Array: ' + datei); process.exit(2); }

function argsGleich(a, b) {
  a = a || {}; b = b || {};
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return false;
  return ka.every((k) => String(a[k]) === String(b[k]));
}

const opts = schwelle !== undefined ? { schwelle } : undefined;
let n = 0, erwartetBefehle = 0, treffer = 0, falschPositiv = 0;
const je = {};   // je Art: { n, ok }
const fehlfaelle = [];
for (const f of eval_) {
  n++;
  const art = f.art || '?';
  const r = M.match(f.text, opts);
  const j = je[art] || (je[art] = { n: 0, ok: 0 });
  j.n++;
  let ok, grund = null;
  if (f.erwartet == null) {
    ok = r === null;
    if (!ok) { falschPositiv++; grund = 'falsch-positiv'; }
  } else {
    erwartetBefehle++;
    if (r && r.befehl === f.erwartet.befehl && argsGleich(r.args, f.erwartet.args)) { ok = true; treffer++; }
    else if (r) { ok = false; falschPositiv++; grund = 'falscher Befehl'; }
    else { ok = false; grund = 'nicht erkannt'; }
  }
  if (ok) j.ok++;
  else fehlfaelle.push({ text: f.text, art, grund, erwartet: f.erwartet || null, bekommen: r ? { an: r.an, befehl: r.befehl, args: r.args, konfidenz: r.konfidenz } : null });
}
const quote = erwartetBefehle ? treffer / erwartetBefehle : 1;
const gruen = falschPositiv === 0 && quote >= QUOTE_MIN;
const ergebnis = { n, erwartetBefehle, treffer, quote: Math.round(quote * 1000) / 1000, falschPositiv, schwelle: schwelle !== undefined ? schwelle : M.SCHWELLE, je, fehlfaelle, gruen };
if (alsJson) console.log(JSON.stringify(ergebnis, null, 2));
else {
  console.log('Bot-Eval ' + datei);
  console.log('n = ' + n + ' (mit erwartetem Befehl: ' + erwartetBefehle + '), Schwelle ' + ergebnis.schwelle);
  console.log('Trefferquote (positiv + stt-fehler): ' + treffer + '/' + erwartetBefehle + ' = ' + (quote * 100).toFixed(1) + ' % (Ziel >= ' + QUOTE_MIN * 100 + ' %)');
  console.log('Falsch-Positiv: ' + falschPositiv + ' (Ziel 0)');
  for (const art of Object.keys(je)) console.log('  ' + art + ': ' + je[art].ok + '/' + je[art].n);
  if (fehlfaelle.length) {
    console.log('Fehlfaelle (' + fehlfaelle.length + '):');
    for (const x of fehlfaelle) console.log('  [' + x.art + '/' + x.grund + '] "' + x.text + '" erwartet ' + JSON.stringify(x.erwartet) + ' bekommen ' + JSON.stringify(x.bekommen));
  }
  console.log(gruen ? 'GRUEN' : 'ROT');
}
process.exit(gruen ? 0 : 1);
