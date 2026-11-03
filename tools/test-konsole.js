'use strict';
// TEL-01 B2: p.console wird nur ueber EINEN Weg frei (interior.konsoleVerlassen / konsoleLoesen), damit das Protokoll jedes Verlassen sieht.
// Statischer Scan von server/**/*.js: Zuweisungen `.console = null` (auch `console: null` in Objektliteralen der Spielerneuanlage sind erlaubt: game.js resetPlayer)
// ausserhalb von interior.js sind Verstoesse. Es gibt keine Ausnahmen mehr (B-Integration: der Altname leaveConsole ist weg, alle Aufrufer nennen einen Grund).
//   node tools/test-konsole.js  (npm run test:konsole)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'server');
const ERLAUBT = {};   // Anzahl bekannter Zuweisungen je Datei: leer, jede Zuweisung ausserhalb von interior.js ist ein Verstoss
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function dateien(d, out) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) dateien(f, out); else if (e.name.endsWith('.js')) out.push(f); } return out; }

const treffer = {};
for (const f of dateien(ROOT, [])) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const zeilen = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  zeilen.forEach((z, i) => {
    const code = z.replace(/\/\/.*$/, '');   // Zeilenkommentar weg
    if (/\.console\s*=\s*null\b/.test(code) || /\[\s*['"]console['"]\s*\]\s*=/.test(code) || /Object\.assign\([^)]*\bconsole\s*:\s*null/.test(code) && rel !== 'game.js') (treffer[rel] = treffer[rel] || []).push(i + 1);
  });
}
const interior = require('../server/sim/interior.js');
console.log('p.console frei nur ueber interior.js');
ok(typeof interior.konsoleVerlassen === 'function' && typeof interior.konsoleLoesen === 'function' && typeof interior.leaveConsole === 'undefined', 'interior exportiert konsoleVerlassen und konsoleLoesen, keinen Altnamen leaveConsole');
for (const [rel, zl] of Object.entries(treffer)) {
  if (rel === 'sim/interior.js') continue;
  const erlaubt = ERLAUBT[rel] || 0;
  ok(zl.length <= erlaubt, `${rel}: ${zl.length} direkte Zuweisung(en) \`.console = null\` (erlaubt ${erlaubt})${zl.length > erlaubt ? ' in Zeile ' + zl.join(', ') : ''}`);
}
for (const [rel, n] of Object.entries(ERLAUBT)) ok((treffer[rel] || []).length === n, `${rel}: bekannte Ausnahmen noch ${n} (sonst ERLAUBT anpassen)`);
const nIn = (treffer['sim/interior.js'] || []).length;
ok(nIn === 2, `interior.js: genau 2 Zuweisungen (konsoleLoesen, konsoleVerlassen), gefunden ${nIn}`);
console.log(fails ? `\n${fails} FEHLER` : '\nKONSOLE OK');
process.exit(fails ? 1 : 0);
