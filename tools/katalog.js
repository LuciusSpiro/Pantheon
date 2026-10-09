'use strict';
// Katalog – Kommandozeile. Die Bibliothek liegt in server/mission/katalog.js (Prüfung über server/mission/checker.js);
// diese Datei re-exportiert load/instantiate/expand/fuerSpielleiter/testRegiebuch für Tools und Tests.
// Aufruf: node tools/katalog.js [--spielleiter kurz|voll] [--tokens [kurz|voll]] [--json] [--mod <ordner>] [--quiet]
//
// --tokens (CONTRACT-W1 §5.4 Nr. 8): Zeichen und geschätzte Tokens je Abschnitt des Katalogtexts, den der Spielleiter
// bekommt (Standard: 'kurz' = Grobplan-Prompt, spielleiter.js grobplanInput). Offline, ohne LLM. Schätzung:
// Tokens ≈ Zeichen / 3,5 (deutscher Text mit Kennungen; grob, reicht für Vorher/Nachher-Vergleiche). Abschnitt = Block
// ab einer Überschrift „## …“.
const path = require('path');
const K = require('../server/mission/katalog.js');

const ZEICHEN_JE_TOKEN = 3.5;
// Text -> [{ abschnitt, zeichen, tokens }] + Summe (letzte Zeile)
function tokenTabelle(text) {
  const teile = String(text).split(/\n(?=## )/);
  const rows = teile.map((t) => ({ abschnitt: (t.split('\n')[0] || '').replace(/^##\s*/, '') || '(ohne Überschrift)', zeichen: t.length, tokens: Math.round(t.length / ZEICHEN_JE_TOKEN) }));
  rows.push({ abschnitt: 'gesamt', zeichen: text.length, tokens: Math.round(text.length / ZEICHEN_JE_TOKEN) });
  return rows;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const k = K.load({ mods: args.filter((a, i) => args[i - 1] === '--mod').map((d) => path.resolve(d)) });
  if (args.includes('--spielleiter')) { console.log(K.fuerSpielleiter(k, args[args.indexOf('--spielleiter') + 1] || 'kurz')); process.exit(k.fehler.length ? 1 : 0); }
  if (args.includes('--tokens')) {
    const nx = args[args.indexOf('--tokens') + 1];
    const stufe = nx === 'voll' || nx === 'kurz' ? nx : 'kurz';
    const rows = tokenTabelle(K.fuerSpielleiter(k, stufe));
    if (args.includes('--json')) { console.log(JSON.stringify({ stufe, zeichen_je_token: ZEICHEN_JE_TOKEN, abschnitte: rows }, null, 2)); process.exit(0); }
    console.log(`Katalog für den Spielleiter (${stufe}), Tokens ≈ Zeichen / ${String(ZEICHEN_JE_TOKEN).replace('.', ',')}`);
    console.log('| Abschnitt | Zeichen | Tokens (geschätzt) |');
    console.log('|---|---|---|');
    for (const r of rows) console.log(`| ${r.abschnitt} | ${r.zeichen} | ${r.tokens} |`);
    process.exit(k.fehler.length ? 1 : 0);
  }
  const sV = Object.values(k.szenentypen); const mV = Object.values(k.molekuele); const uV = mV.flatMap((m) => m.umsetzungen.map((u) => Object.assign({ mol: m.id }, u)));
  console.log(`Szenentypen: ${sV.length} (verfügbar ${sV.filter((s) => s.status === 'verfuegbar').length}, geplant ${sV.filter((s) => s.status === 'geplant').length})`);
  console.log(`Moleküle:    ${mV.length} (verfügbar ${mV.filter((m) => m.status === 'verfuegbar').length}, geplant ${mV.filter((m) => m.status === 'geplant').length})`);
  console.log(`Umsetzungen: ${uV.length} (verfügbar ${uV.filter((u) => u.status === 'verfuegbar').length}, geplant ${uV.filter((u) => u.status === 'geplant').length}, fehlerhaft ${uV.filter((u) => u.status === 'fehlerhaft').length})`);
  if (!args.includes('--quiet')) {
    console.log('\nUmsetzungen:');
    for (const u of uV) console.log(`  ${u.status === 'verfuegbar' ? '✓' : u.status === 'geplant' ? '…' : '✗'} ${u.mol}/${u.id} (${u.herkunft})${u.fehlende_mechaniken.length ? ' – fehlt: ' + u.fehlende_mechaniken.join(', ') : ''}${u.pruefung.warnungen ? ` – ${u.pruefung.warnungen} Warnungen` : ''}`);
    console.log('\nSzenentypen verfügbar: ' + sV.filter((s) => s.status === 'verfuegbar').map((s) => `${s.kennung} ${s.name}`).join(', '));
  }
  if (k.fehler.length) { console.log(`\n${k.fehler.length} Fehler:`); for (const f of k.fehler) console.log(`  ✗ ${f.datei}: ${f.msg}`); }
  process.exit(k.fehler.length ? 1 : 0);
}

module.exports = { load: K.load, instantiate: K.instantiate, expand: K.expand, fuerSpielleiter: K.fuerSpielleiter, testRegiebuch: K.testRegiebuch };
