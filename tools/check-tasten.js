// Prüft, ob jede Konsolentaste (Consoles.keyDown → tryButton/findButton mit Text oder RegExp) einen Knopf findet,
// dessen Beschriftung im Client-Code vorkommt. Hintergrund: Tasten suchen ihren Knopf über die Beschriftung; eine
// Umbenennung bricht die Taste still (z. B. Shift+A/D suchte „Ausweichen Bb“, der Knopf hieß „Ausw. Bb“).
// Aufruf: node tools/check-tasten.js   (Exit 1 bei Treffern ohne Knopf)
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'js');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).map((f) => path.join(DIR, f));
const src = Object.fromEntries(files.map((f) => [path.basename(f), fs.readFileSync(f, 'utf8')]));

// 1) Beschriftungen: R.button(ctx, x, y, w, h, 'Label' …), label: 'Label', Template-Anfänge `Label ${…}`
const labels = new Set();
const strLit = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|` + '`([^`$]*)';
const reBtn = new RegExp(String.raw`\b(?:R\.)?button\(\s*ctx\s*,[^,]+,[^,]+,[^,]+,[^,]+,\s*(?:` + strLit + ')', 'g');
const reLabel = new RegExp(String.raw`\blabel\s*:\s*(?:` + strLit + ')', 'g');
const reTern = new RegExp(String.raw`\?\s*(?:` + strLit + String.raw`)\s*:\s*(?:` + strLit + ')', 'g');
const reLit = new RegExp(strLit, 'g');
for (const s of Object.values(src)) {
  for (const re of [reBtn, reLabel]) for (const m of s.matchAll(re)) { const v = m[1] ?? m[2] ?? m[3]; if (v) labels.add(v); }
  for (const m of s.matchAll(reTern)) for (const v of m.slice(1)) if (v) labels.add(v);
  // Beschriftung als Ausdruck (verschachtelte Ternäre, Verkettung): alle Literale bis zu den Optionen „{ hotkey …“
  for (const m of s.matchAll(/\bbutton\(\s*ctx\s*,([^\n]*?)(?:,\s*\{|$)/gm)) for (const q of m[1].matchAll(reLit)) { const v = q[1] ?? q[2] ?? q[3]; if (v) labels.add(v); }
}
// bekannte Namenslisten, aus denen Beschriftungen dynamisch entstehen
for (const s of Object.values(src)) for (const m of s.matchAll(/(?:MOUNT_NAMES|ESCORT_ORDER_NAMES|TABS(?:_TECHNIK)?)\s*=\s*([\[{][^;]*?[\]}])\s*;/g)) for (const q of m[1].matchAll(/'([^']+)'/g)) labels.add(q[1]);

// 2) Tasten: tryButton(…) / findButton(…) mit Text- oder RegExp-Literal in consoles.js
const K = src['consoles.js'];
const start = K.indexOf('keyDown(e, view)'), end = K.indexOf('keyUp(e, view)', start);
const block = start >= 0 ? K.slice(start, end > 0 ? end : undefined) : K;
const lineOf = (i) => K.slice(0, start + i).split('\n').length;
const reTry = /(?:tryButton|findButton)\(\s*(?:'((?:[^'\\]|\\.)*)'|\/((?:[^/\\]|\\.)+)\/[a-z]*)/g;
const treffer = [];
for (const m of block.matchAll(reTry)) {
  const text = m[1], rx = m[2];
  const ok = [...labels].some((l) => (rx ? new RegExp(rx).test(l) : l === text || l.indexOf(text) === 0));
  treffer.push({ line: lineOf(m.index), such: text != null ? `'${text}'` : `/${rx}/`, ok });
}
const fehlt = treffer.filter((t) => !t.ok);
console.log(`${treffer.length} Tasten mit Textsuche geprüft, ${labels.size} Beschriftungen gefunden.`);
for (const t of fehlt) console.log(`  FEHLT  consoles.js:${t.line}  ${t.such} – kein Knopf mit passender Beschriftung`);
console.log(fehlt.length ? `${fehlt.length} Taste(n) ohne Knopf.` : 'Alle Tasten finden einen Knopf.');
process.exit(fehlt.length ? 1 : 0);
