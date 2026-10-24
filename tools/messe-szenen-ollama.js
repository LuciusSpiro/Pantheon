'use strict';
// SUND-03 B: Mess- und Prüfwerkzeug. Lässt N Szenen aus vorhandenen gültigen Plänen (Archiv, Ablage) gegen den Ollama-Transport
// laufen und prüft die Antworten mit dem Prüfer des Repos (Reparaturen → Szenenbau.evaluateScene → Regiebuch-Prüfer).
//
//   node tools/messe-szenen-ollama.js [--n 5] [--quelle archiv|erzeugt|alle] [--szene <Teil des Namens>] [--url …] [--model …]
//                                     [--timeout 120] [--ohne-schema] [--claude] [--json]
//   node tools/messe-szenen-ollama.js --selbsttest        (Fake-Server auf 127.0.0.1, kein Netz; in npm test)
//
// Ausgabe: Healthcheck, je Szene gültig/ungültig, dann gültig im 1. Versuch, nach Eskalation, Dauer Median/p90, Fehlerarten,
// Anzahl Eskalationen. Ohne --claude wird die Eskalation nur gezählt (nötig: k); mit --claude (und LLM_LIVE=1) geht dieselbe
// Anfrage wirklich an die Claude-CLI und wird erneut geprüft. Voreinstellung: Ollama wie im Spiel (OLLAMA_URL, OLLAMA_MODEL).
// Nichts außer dem Prompt verlässt den Rechner; die Prompts enthalten keine Spielernamen (Kontext: Fixture nach-tutorial).
const H = require('./transport-testhilfe.js');
const LLM = require('../server/mission/llm.js');
const SB = require('../server/mission/szenenbau.js');
const Katalog = require('../server/mission/katalog.js');
const Schema = require('../server/mission/schema-ableiten.js');
const Ollama = require('../server/mission/transport-ollama.js');
const { scenePrompt } = require('../server/mission/spielleiter.js');

const args = process.argv.slice(2);
const opt = (name, std) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : std; };
const flag = (name) => args.includes('--' + name);

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const perzentil = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const sek = (x) => (x === null ? '–' : x.toFixed(1) + ' s');

// Auswahl: gleichmäßig über die sortierte Liste der bekannten Szenen, eine je Szenen-Id
function waehle(n, quelle, teil) {
  const alle = H.bekannteSzenen().filter((x) => (quelle === 'alle' || x.name.startsWith(quelle + '/')) && (!teil || x.name.includes(teil)));
  const seen = new Set(); const eindeutig = [];
  for (const x of alle.sort((a, b) => a.name.localeCompare(b.name))) { const k = x.szene.id; if (!seen.has(k)) { seen.add(k); eindeutig.push(x); } }
  if (eindeutig.length <= n) return eindeutig;
  const out = [];
  for (let i = 0; i < n; i++) out.push(eindeutig[Math.floor((i * eindeutig.length) / n)]);
  return out;
}

// Antwort prüfen wie Spielleiter.handleScene (ohne Weltzustand): JSON → Reparaturen → Fakten → Buch bauen (Szene als Antwort, der
// Rest Rohfassung) → Regiebuch-Prüfer. Der Kontext (Funde, NSC) ist die Fixture nach-tutorial.
function pruefe(env, x, text, ctx) {
  let a;
  try { a = SB.parseJsonAnswer(text); } catch (e) { return { gueltig: false, codes: ['JSON'], details: ['kein gültiges JSON: ' + e.message], repairs: [] }; }
  const g = JSON.parse(JSON.stringify(x.grobplan)); const sid = x.szene.id;
  const rep = SB.repairSceneAnswer(g, g.szenen.find((s) => s.id === sid), a, env, { knownFlags: SB.planFlags(g, {}, env) });
  const errs = [...SB.factContradictions(SB.answerTexts(rep.answer), (ctx && ctx.fakten) || {})];
  const built = SB.buildBook(g, { [sid]: { answer: rep.answer, quelle: 'llm' } }, env, { id: 'sl_9_messung', art: 'generiert', kontext: ctx });
  const info = built.szenen[sid] || {};
  if (info.quelle === 'rohfassung') errs.push(...(info.fehler || []).filter((e) => !/^Rohfassung:/.test(e)));
  errs.push(...built.errors.map((e) => (typeof e === 'string' ? e : `${e.code} ${e.p}: ${e.msg}`)));
  if (info.quelle === 'rohfassung' && !errs.length) errs.push('Szene ließ sich nicht zusammensetzen');
  const codes = [...new Set(errs.map((e) => (/^([A-Z][A-Z0-9-]+)/.exec(e) || [null, 'SZENE'])[1]))].sort();
  return { gueltig: !errs.length, codes, details: errs, repairs: rep.repairs };
}

async function messe(o) {
  const katalog = Katalog.load({}); const env = SB.buildEnv(katalog);
  const ctx = H.kontextNachTutorial();
  const transport = Ollama.create({ url: o.url, model: o.model });
  const h = await Ollama.gesund({ url: o.url });
  console.log(`Healthcheck ${h.url}: ${h.ok ? 'ok, Ollama ' + (h.version || '?') : 'NICHT erreichbar (' + h.fehler + ')'}   Modell: ${o.model || transport.model}`);
  if (!h.ok && !o.trotzdem) return { ok: false, gesund: h };
  const wahl = o.selbst || waehle(o.n, o.quelle, o.szene);
  console.log(`${wahl.length} Szenen aus ${o.selbst ? 'dem Selbsttest' : o.quelle}${o.schema ? ', mit Schema' : ', ohne Schema'}\n`);
  const R = []; const system = LLM.systemPromptFile('szene');
  for (const x of wahl) {
    const prompt = scenePrompt(x.grobplan, x.szene.id, env, ctx, { crew: 3 });
    const schema = o.schema ? Schema.szenenSchemaFuer(env, x.szene) : undefined;
    const r = { name: x.name, sec: null, gueltig1: false, gueltig2: null, codes: [], fehlertext: null, eskaliert: false, tokens: null };
    try {
      const a = await transport.call(prompt, { system, schema, timeoutMs: o.timeoutMs, model: o.model });
      r.sec = a.sec; r.tokens = a.usage;
      const p = pruefe(env, x, a.text, ctx);
      r.gueltig1 = p.gueltig; r.codes = p.codes; r.repairs = p.repairs.length; r.fehlertext = p.gueltig ? null : (p.details[0] || '').slice(0, 140);
    } catch (e) { r.codes = [e.code || 'FEHLER']; r.fehlertext = e.message.slice(0, 140); r.sec = null; }
    if (!r.gueltig1) {
      r.eskaliert = true;
      if (o.claude) {
        try {
          const c = await LLM.TRANSPORTS.cli.call(prompt, { system, model: 'sonnet', timeoutMs: 180000 });
          const p = pruefe(env, x, c.text, ctx); r.gueltig2 = p.gueltig; r.claudeSec = c.sec;
        } catch (e) { r.gueltig2 = false; r.claudeFehler = e.message.slice(0, 100); }
      }
    }
    R.push(r);
    console.log(`  ${r.gueltig1 ? '✓' : '✗'} ${x.name}  ${sek(r.sec)}${r.tokens ? `  (${r.tokens.input}→${r.tokens.output} Token)` : ''}${r.repairs ? `  ${r.repairs} Reparatur(en)` : ''}${r.gueltig1 ? '' : `  [${r.codes.join(',')}] ${r.fehlertext || ''}`}${r.gueltig2 === null ? '' : `  → Claude: ${r.gueltig2 ? 'gültig' : 'ungültig'}`}`);
  }
  const n = R.length; const g1 = R.filter((r) => r.gueltig1).length; const esk = R.filter((r) => r.eskaliert).length;
  const secs = R.map((r) => r.sec).filter((s) => s !== null);
  const arten = {};
  for (const r of R) if (!r.gueltig1) for (const c of r.codes.length ? r.codes : ['?']) arten[c] = (arten[c] || 0) + 1;
  const g2 = R.filter((r) => r.gueltig2 === true).length;
  console.log(`\nErgebnis (${n} Szenen)`);
  console.log(`  gültig im 1. Versuch:   ${g1} von ${n}`);
  console.log(`  Eskalationen nötig:     ${esk}${o.claude ? ` → davon nach Eskalation gültig: ${g2}` : ' (nicht ausgeführt; --claude mit LLM_LIVE=1 führt sie aus)'}`);
  console.log(`  gültig gesamt:          ${g1 + g2} von ${n}${o.claude ? '' : ' (mit Eskalation noch offen)'}`);
  console.log(`  Dauer Ollama:           Median ${sek(median(secs))}, p90 ${sek(perzentil(secs, 0.9))}, max ${sek(secs.length ? Math.max(...secs) : null)}`);
  console.log(`  Fehlerarten:            ${Object.keys(arten).length ? Object.entries(arten).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ') : '–'}`);
  return { ok: true, n, gueltig1: g1, eskalationen: esk, nachEskalation: g2, median: median(secs), p90: perzentil(secs, 0.9), arten, ergebnisse: R };
}

// ---------- Selbsttest mit Fake-Server ----------
async function selbsttest() {
  const katalog = Katalog.load({}); const env = SB.buildEnv(katalog);
  const ctx = H.kontextNachTutorial();
  const wahl = waehle(400, 'alle').filter((x) => pruefe(env, x, JSON.stringify(x.antwort), ctx).gueltig).filter((x, i, a) => i % Math.floor(a.length / 4) === 0).slice(0, 4);
  const antworten = new Map(wahl.map((x) => [x.szene.id, x.antwort]));
  const kaputt = wahl[wahl.length - 1].szene.id;        // diese Szene beantwortet der Fake-Server falsch → Eskalation nötig
  const srv = await H.fakeOllama((req, res, body) => {
    if (req.url === '/api/version') return H.antwort(res, 200, { version: 'fake-1' });
    const user = body.messages[body.messages.length - 1].content;
    const m = /Szene '([^']+)' aus/.exec(user); const sid = m && m[1];
    const text = sid === kaputt ? '{"molekuele": []}' : JSON.stringify(antworten.get(sid) || {});
    H.antwort(res, 200, { model: body.model, message: { role: 'assistant', content: text }, done: true, prompt_eval_count: 100, eval_count: 20 });
  });
  const log = console.log; let aus = [];
  console.log = (...a) => { aus.push(a.join(' ')); };
  let r;
  try { r = await messe({ n: 4, quelle: 'alle', selbst: wahl, url: srv.url, model: 'fake:1b', timeoutMs: 20000, schema: true, claude: false }); } finally { console.log = log; }
  const fehler = [];
  if (!r.ok) fehler.push('Healthcheck fehlgeschlagen');
  else {
    if (r.n !== 4) fehler.push(`${r.n} statt 4 Szenen`);
    if (r.gueltig1 !== 3) fehler.push(`gültig im 1. Versuch ${r.gueltig1} statt 3`);
    if (r.eskalationen !== 1) fehler.push(`Eskalationen ${r.eskalationen} statt 1`);
    if (!r.arten.SZENE && !Object.keys(r.arten).length) fehler.push('keine Fehlerart gezählt');
    if (r.median === null) fehler.push('keine Dauer gemessen');
  }
  const posts = srv.requests.filter((q) => q.method === 'POST');
  if (posts.length !== 4 || !posts.every((q) => q.body.think === false && q.body.format && q.body.model === 'fake:1b')) fehler.push('Anfragen: think:false/format/Modell fehlen');
  if (!aus.some((l) => /Healthcheck .*ok, Ollama fake-1/.test(l)) || !aus.some((l) => /gültig im 1\. Versuch:\s+3 von 4/.test(l))) fehler.push('Ausgabe unvollständig');
  await srv.close();
  console.log(fehler.length ? `Selbsttest FEHLER: ${fehler.join('; ')}` : `Selbsttest ok (Fake-Ollama, ${posts.length} Szenen, ${r.gueltig1} gültig im 1. Versuch, ${r.eskalationen} Eskalation, Median ${sek(r.median)})`);
  process.exit(fehler.length ? 1 : 0);
}

if (require.main === module) {
  if (flag('selbsttest')) selbsttest().catch((e) => { console.log('Selbsttest FEHLER: Ausnahme ' + (e && e.stack)); process.exit(1); });
  else {
    messe({ n: Number(opt('n', 5)), quelle: opt('quelle', 'alle'), szene: opt('szene'), url: opt('url'), model: opt('model'), timeoutMs: Number(opt('timeout', 120)) * 1000, schema: !flag('ohne-schema'), claude: flag('claude'), trotzdem: false })
      .then((r) => { if (flag('json')) console.log(JSON.stringify(r, null, 1)); process.exit(r.ok ? 0 : 1); }, (e) => { console.log('Fehler: ' + (e && e.stack)); process.exit(1); });
  }
}
module.exports = { messe, pruefe, waehle };
