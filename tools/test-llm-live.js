'use strict';
// Live-Probe des Spielleiter-LLM (CONTRACT-S1 §8.3) – npm run test:llm. NUR VON HAND, nie in npm test.
// Verlangt LLM_LIVE=1. Macht genau 1 Grobplan + 1 Szene live (claude-code CLI, Sonnet, ohne Denken), schickt beide durch
// die Prüfung (Grobplan-Prüfung bzw. katalog.instantiate + Regiebuch-Prüfer) und gibt die verbrauchten Tokens aus.
//   --record        speichert beide Antworten als Replay-Aufzeichnung in tools/fixtures/llm/<kind>/<key>.json
//                   (mit 'erwartet' = Prüfergebnis); danach läuft sie in npm run test:spielleiter mit
//   --model <name>  Standard sonnet (Kai, 2026-10-07: Sonnet für Grobplan und Szenen)
//   --auftrag <id>  Auftrag aus concept/regiebuch/trockenversuch/auftraege.json (Standard grauzahn-rache)
// Token-Deckel: CLAUDE_TOKEN_BUDGET (Standard 500 000). Erwartet laut Trockenversuch: Grobplan ~45 s, Szene ~15 s.
// Aufruf (PowerShell): $env:LLM_LIVE='1'; npm run test:llm -- --record; Remove-Item Env:LLM_LIVE

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

if (process.env.LLM_LIVE !== '1') {
  console.log('Abbruch: test-llm-live macht echte LLM-Aufrufe und läuft nur mit LLM_LIVE=1 (von Hand).');
  console.log("  PowerShell: $env:LLM_LIVE='1'; npm run test:llm -- --record; Remove-Item Env:LLM_LIVE");
  console.log('Ohne LLM: npm run test:spielleiter (mock + replay).');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const LLM = require('../server/mission/llm.js');
const Context = require('../server/mission/context.js');
const Katalog = require('./katalog.js');
const T = require('./test-spielleiter.js');

const MODEL = opt('--model', 'sonnet');
const AUFTRAG = opt('--auftrag', 'grauzahn-rache');
const RECORD = args.includes('--record');
const FIXTURES = path.join(__dirname, 'fixtures', 'llm');

// Szene-Prompt wie im Trockenversuch (szene.js → prompt/umsetzungVoll), Weltstand aus dem Kontext
function sceneWorld(ctx) {
  const L = [`Marken ${ctx.schiff.marken}.`, 'NSC:'];
  for (const n of ctx.npc) L.push(`- ${n.id} (${n.titel || ''} ${n.name}, ${n.fraktion}, Haltung ${n.haltung}): ${n.gedaechtnis.map((g) => g.text).join(' | ')}`);
  return L.join('\n');
}
function umsetzungVoll(kat, env, m, s) {
  const mol = kat.molekuele[m.id]; const u = mol.umsetzungen.find((x) => x.id === m.umsetzung);
  const L = [`### ${mol.id} / ${u.id} – ${u.name}`, u.beschreibung, 'Parameter (* = Pflicht):'];
  for (const [n, d] of Object.entries(u.params)) {
    let hint = '';
    if (d.typ === 'loc') hint = ` → Ort der Szene: ${s.ort}`;
    if (d.typ === 'npc') hint = ` → eine von: ${env.npc.join(', ')}`;
    if (d.typ === 'find') hint = ` → Funde an ${s.ort}: ${(env.LOC[s.ort] ? env.LOC[s.ort].hidden.map((h) => h.id) : []).join(', ') || '–'}`;
    L.push(`- ${n}${d.pflicht ? '*' : ''} (${d.typ}${d.werte ? ': ' + d.werte.join('|') : ''}${d.min != null ? `, ${d.min}–${d.max}` : ''}${d.default !== undefined ? ', Standard ' + JSON.stringify(d.default) : ''})${d.beschreibung ? ' – ' + d.beschreibung : ''}${hint}`);
  }
  return L.join('\n');
}
function scenePrompt(kat, env, ctx, g, s) {
  const plan = Object.assign({}, g, { szenen: g.szenen.map((x) => ({ id: x.id, ort: x.ort, molekuele: x.molekuele.map((m) => m.umsetzung), sachverhalt: x.sachverhalt, weiter: x.weiter })) });
  return `<weltstand>\n${sceneWorld(ctx)}\n</weltstand>\n\n<grobplan>\n${JSON.stringify(plan)}\n</grobplan>\n\n<szene>\n${JSON.stringify(s, null, 1)}\n</szene>\n\n<umsetzungen>\n${s.molekuele.map((m) => umsetzungVoll(kat, env, m, s)).join('\n\n')}\n</umsetzungen>\n\nArbeite jetzt die Szene '${s.id}' aus. Nur das JSON-Objekt.`;
}

async function main() {
  const kat = Katalog.load({});
  if (kat.fehler.length) { console.log('Katalog fehlerhaft – erst `npm run katalog` reparieren.'); process.exit(1); }
  const env = T.buildEnv(kat);
  const auftraege = JSON.parse(fs.readFileSync(path.join(ROOT, 'concept', 'regiebuch', 'trockenversuch', 'auftraege.json'), 'utf8'));
  const a = auftraege.find((x) => x.id === AUFTRAG);
  if (!a) { console.log(`Auftrag '${AUFTRAG}' unbekannt (${auftraege.map((x) => x.id).join(', ')})`); process.exit(1); }
  const world = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'context', 'nach-tutorial.weltstand.json'), 'utf8'));
  const anlass = Object.assign({}, T.ANLASS['nach-tutorial'], { auftrag: a.id });
  const ctx = Context.build(world, anlass, kat);
  const { verfuegbar, ...welt } = ctx;
  const llm = LLM.create({ mode: 'live', model: MODEL });
  console.log(`Live-Probe: Modell ${MODEL}, Auftrag ${a.id}, Token-Deckel ${llm.budget}${RECORD ? ', --record' : ''}`);

  // 1. Grobplan
  const prompt = `<weltstand>\n${JSON.stringify(welt)}\n</weltstand>\n\n<katalog>\n${JSON.stringify(verfuegbar)}\n</katalog>\n\n<auftrag>\n${a.auftrag}\n</auftrag>\n\nGib jetzt den Grobplan aus. Nur das JSON-Objekt.`;
  const gIn = { quelle: 'test-llm-live', modell: MODEL, anlass, kontext: ctx, auftrag: a, prompt };
  const gAns = await llm.ask('grobplan', gIn);
  const gRes = T.evaluateGrobplan(gAns.text, env);
  console.log(`Grobplan: ${gAns.sec.toFixed(1)} s, Tokens ein ${gAns.usage.input} / aus ${gAns.usage.output} (${gAns.modelId}) – ${gRes.gueltig ? 'gültig' : gRes.fehler.length + ' Fehler'}`);
  for (const f of gRes.fehler) console.log('  ✗ ' + f);
  if (RECORD) console.log('  aufgezeichnet: ' + path.relative(ROOT, LLM.record(FIXTURES, 'grobplan', gIn, gAns, { name: `live.${a.id}.${MODEL}`, modell: MODEL, quelle: 'tools/test-llm-live.js', aufgenommen: new Date().toISOString().slice(0, 10), erwartet: { gueltig: gRes.gueltig, fehler: gRes.fehler } })));

  // 2. Szene (erste Szene mit Molekülen; nur bei gültigem Grobplan)
  let sOk = false;
  if (!gRes.gueltig) console.log('Szene: übersprungen, weil der Grobplan ungültig ist.');
  else {
    const g = T.parseJsonAnswer(gAns.text);
    const s = g.szenen.find((x) => (x.molekuele || []).length);
    const sIn = { quelle: 'test-llm-live', modell: MODEL, grobplan: g, szene: s.id, prompt: scenePrompt(kat, env, ctx, g, s) };
    const sAns = await llm.ask('szene', sIn);
    const sRes = T.evaluateScene(g, s.id, sAns.text, env);
    sOk = sRes.gueltig;
    console.log(`Szene ${s.id}: ${sAns.sec.toFixed(1)} s, Tokens ein ${sAns.usage.input} / aus ${sAns.usage.output} – ${sRes.gueltig ? 'gültig' : sRes.fehler.join(', ')}`);
    for (const d of sRes.details) console.log('  ✗ ' + d);
    if (RECORD) console.log('  aufgezeichnet: ' + path.relative(ROOT, LLM.record(FIXTURES, 'szene', sIn, sAns, { name: `live.${a.id}.${s.id}.${MODEL}`, modell: MODEL, quelle: 'tools/test-llm-live.js', aufgenommen: new Date().toISOString().slice(0, 10), erwartet: { gueltig: sRes.gueltig, fehler: sRes.fehler } })));
  }
  console.log(`Verbraucht: ${llm.used()} Tokens (Rest ${llm.remaining()} von ${llm.budget})`);
  process.exit(gRes.gueltig && sOk ? 0 : 1);
}

main().catch((e) => { console.log('Fehler: ' + e.message); process.exit(1); });
