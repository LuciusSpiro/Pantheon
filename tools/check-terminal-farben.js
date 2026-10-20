// PAN-01 D (Designer): Terminal-Code ohne freie Gestaltungswerte. Farben stehen nur im Token-Block von public/js/pult-terminal-tokens.js
// (zwischen „// <tokens>“ und „// </tokens>“); Terminal-Code nimmt Token-Namen ('waffe', 'preis', 'textZu' …) oder PultTerminal.TOKENS.FARBE.
// Geprüft: alle Dateien public/js/*terminal*.js. Verboten außerhalb des Token-Blocks: Hex-Farben (#abc, #aabbcc), rgb()/rgba()/hsl() mit Zahlen,
// eigene Schriften (ctx.font = …, font-family), Emoji. Aufruf: node tools/check-terminal-farben.js   (Exit 1 bei Treffern). --selftest prüft die Regeln.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'js');
const REGELN = [
  { name: 'freie Hex-Farbe', re: /['"`]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?['"`]/g },
  { name: 'freie rgb/hsl-Farbe', re: /\b(?:rgba?|hsla?)\(\s*\d/g },
  { name: 'eigene Schrift', re: /\.font\s*=|font-family/g },
  { name: 'Emoji', re: /\p{Extended_Pictographic}/gu },
];
function pruefe(name, src) {
  const out = [];
  let inTokens = false;
  src.split('\n').forEach((zeile, i) => {
    if (/\/\/\s*<tokens>/.test(zeile)) { inTokens = true; return; }
    if (/\/\/\s*<\/tokens>/.test(zeile)) { inTokens = false; return; }
    if (inTokens) return;
    const code = zeile.replace(/\/\/.*$/, '');   // Kommentare dürfen Werte nennen
    for (const r of REGELN) for (const m of code.matchAll(r.re)) out.push({ datei: name, zeile: i + 1, regel: r.name, text: m[0] });
  });
  return out;
}
if (process.argv.includes('--selftest')) {
  const fehler = pruefe('t.js', "// <tokens>\nconst A = '#112233';\n// </tokens>\nrect(c, 0, 0, 1, 1, '#FF0000');\nc.font = '8px x';\nrgba(1,2,3)\n// '#00FF00' im Kommentar\n");
  const ok = fehler.length === 3 && fehler.map((f) => f.zeile).join() === '4,5,6';
  console.log(ok ? 'Selbsttest ok' : 'Selbsttest FEHLER ' + JSON.stringify(fehler)); process.exit(ok ? 0 : 1);
}
const dateien = fs.readdirSync(DIR).filter((f) => /terminal/i.test(f) && f.endsWith('.js'));
const treffer = dateien.flatMap((f) => pruefe(f, fs.readFileSync(path.join(DIR, f), 'utf8')));
console.log(`${dateien.length} Terminal-Datei(en) geprüft: ${dateien.join(', ') || '–'}`);
for (const t of treffer) console.log(`  ${t.regel.padEnd(20)} public/js/${t.datei}:${t.zeile}  ${t.text}  → Token aus PultTerminal.TOKENS nehmen`);
console.log(treffer.length ? `${treffer.length} freie Werte.` : 'Keine freien Gestaltungswerte.');
process.exit(treffer.length ? 1 : 0);
