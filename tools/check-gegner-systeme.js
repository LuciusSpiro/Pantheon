'use strict';
// SYS-01 C1a-1: Formprüfung der Gegner-Systemdaten (content/kampf/gegner-systeme.json) gegen content/schema/gegner-systeme.schema.json.
// Teil von `npm run check`. Prüft die FORM (Pflichtfelder, Aufzählungen, Zahlen, keine Zusatzfelder) und die Eindeutigkeit der Ids je Klasse;
// die Regeln (fünf Zonen, jede Waffe in enemyWeapons genau ein System, Schildseiten) prüft tools/test-gegnersystem.js.
//   node tools/check-gegner-systeme.js              Daten prüfen
//   node tools/check-gegner-systeme.js --selftest   kaputte Daten (aus den echten erzeugt) müssen abgelehnt werden
const fs = require('fs');
const path = require('path');
const { fallbackValidate } = require('../server/weltstand.js');

const ROOT = path.join(__dirname, '..');
const DATEI = path.join(ROOT, 'content', 'kampf', 'gegner-systeme.json');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'schema', 'gegner-systeme.schema.json'), 'utf8'));

// Form gegen das Schema (fallbackValidate kennt exclusiveMinimum nicht: Gewicht > 0 und eindeutige Ids hier zusätzlich)
function pruefe(doc) {
  const out = fallbackValidate(doc, SCHEMA);
  for (const [kind, k] of Object.entries((doc && doc.klassen) || {})) {
    const ids = new Set();
    for (const s of (k && k.systeme) || []) {
      if (typeof s.gewicht === 'number' && !(s.gewicht > 0)) out.push(`$.klassen.${kind}.${s.id}: gewicht muss größer als 0 sein`);
      if (ids.has(s.id)) out.push(`$.klassen.${kind}: Id doppelt ${s.id}`);
      ids.add(s.id);
    }
  }
  return out;
}

const echt = JSON.parse(fs.readFileSync(DATEI, 'utf8'));
const fehler = pruefe(echt);
let rot = 0;
if (fehler.length) { rot++; console.log('✗ gegner-systeme.json: ' + fehler.length + ' Fehler'); for (const f of fehler.slice(0, 10)) console.log('    FEHLER ' + f); }
else console.log('✓ gegner-systeme.json entspricht dem Schema (' + Object.keys(echt.klassen).length + ' Klassen)');

if (process.argv.includes('--selftest')) {
  const kopie = () => JSON.parse(JSON.stringify(echt));
  const faelle = [
    ['Zone unbekannt', (d) => { d.klassen.raider.systeme[0].zone = 'oben'; }],
    ['Art unbekannt', (d) => { d.klassen.raider.systeme[0].art = 'kanone'; }],
    ['Gewicht 0', (d) => { d.klassen.raider.systeme[0].gewicht = 0; }],
    ['Pflichtfeld id fehlt', (d) => { delete d.klassen.raider.systeme[0].id; }],
    ['Zusatzfeld', (d) => { d.klassen.raider.systeme[0].hp = 5; }],
    ['Id doppelt', (d) => { d.klassen.raider.systeme[1].id = d.klassen.raider.systeme[0].id; }],
    ['Modul unbekannt', (d) => { d.klassen.korvette.systeme.find((s) => s.art === 'modul').modul = 'bar'; }],
    ['Format falsch', (d) => { d.format = 'gegner-systeme/2'; }],
  ];
  for (const [name, mut] of faelle) {
    const d = kopie(); mut(d);
    const r = pruefe(d);
    if (r.length) console.log('  ✓ Selbsttest abgelehnt: ' + name); else { rot++; console.log('  ✗ Selbsttest NICHT abgelehnt: ' + name); }
  }
}
process.exit(rot ? 1 : 0);
