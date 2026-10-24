'use strict';
// SUND-03 B/B2: Mess- und Prüfwerkzeug. Lässt N Szenen aus vorhandenen gültigen Plänen (Archiv, Ablage) mehrere Runden gegen den
// Ollama-Transport laufen und prüft die Antworten wie der Spielleiter (Prüfer des Repos).
//
//   node tools/messe-szenen-ollama.js [--n 5] [--runden 1] [--quelle archiv|erzeugt|alle] [--szene <Teil des Namens>] [--url …]
//                                     [--model …] [--timeout 120] [--ohne-schema] [--alle-szenen] [--claude] [--json]
//   node tools/messe-szenen-ollama.js --selbsttest        (Fake-Server auf 127.0.0.1, kein Netz; in npm test)
//
// Prompt wie auf der Ollama-Route im Spiel: Systemprompt ohne Lexikon-Absatz (prompts-ollama.js), Schema aus dem Katalog.
// Gezählt wird getrennt: Szenen (verschiedene Szenen-Ids) und Läufe (Szenen × Runden; die Läufe einer Szene sind nicht unabhängig).
//   roh               = Antwort ohne jede Code-Reparatur durch den Prüfer
//   mit Reparatur     = wie im Spiel: loc/Lexikon-Reparatur, repairSceneAnswer; „Scheinwahl“ (Flag setzt keine Folge → toter Zweig)
//                       zählt bei Ollama-Antworten als ungültig
// Ohne --alle-szenen zählen nur Szenen mit, deren bekannte Referenzantwort denselben Prüfer besteht (sonst läge der Fehler am
// Kontext der Fixture, nicht am Modell). Ausgabe: Healthcheck, je Lauf gültig/ungültig, Wilson-95-%-Intervalle, Dauer Median/p90,
// Fehlerarten, Eskalationen. Ohne --claude wird die Eskalation nur gezählt; mit --claude (und LLM_LIVE=1) geht sie wirklich an die
// Claude-CLI. Nichts außer dem Prompt verlässt den Rechner; keine Spielernamen (Kontext: Fixture nach-tutorial, crew 3).
const H = require('./transport-testhilfe.js');
const LLM = require('../server/mission/llm.js');
const SB = require('../server/mission/szenenbau.js');
const Katalog = require('../server/mission/katalog.js');
const Schema = require('../server/mission/schema-ableiten.js');
const Ollama = require('../server/mission/transport-ollama.js');
const Prompts = require('../server/mission/prompts-ollama.js');
const { scenePrompt } = require('../server/mission/spielleiter.js');

const args = process.argv.slice(2);
const opt = (name, std) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : std; };
const flag = (name) => args.includes('--' + name);

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const perzentil = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const sek = (x) => (x === null ? '–' : x.toFixed(1) + ' s');
// Wilson-Intervall (95 %) für k von n
function wilson(k, n, z) {
  if (!n) return [0, 0];
  const zz = z || 1.959964; const p = k / n; const d = 1 + (zz * zz) / n;
  const c = (p + (zz * zz) / (2 * n)) / d; const h = (zz * Math.sqrt((p * (1 - p)) / n + (zz * zz) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const anteil = (k, n) => { const [a, b] = wilson(k, n); return `${k} von ${n} (${n ? Math.round((100 * k) / n) : 0} %, Wilson 95 %: ${Math.round(100 * a)}–${Math.round(100 * b)} %)`; };

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

// Buch bauen und prüfen (Szene als Antwort, der Rest Rohfassung) -> Fehlerliste
function baue(env, x, answer, ctx) {
  const g = JSON.parse(JSON.stringify(x.grobplan)); const sid = x.szene.id;
  const errs = [...SB.factContradictions(SB.answerTexts(answer), (ctx && ctx.fakten) || {})];
  const built = SB.buildBook(g, { [sid]: { answer, quelle: 'llm' } }, env, { id: 'sl_9_messung', art: 'generiert', kontext: ctx });
  const info = built.szenen[sid] || {};
  if (info.quelle === 'rohfassung') errs.push(...(info.fehler || []).filter((e) => !/^Rohfassung:/.test(e)));
  errs.push(...built.errors.map((e) => (typeof e === 'string' ? e : `${e.code} ${e.p}: ${e.msg}`)));
  if (info.quelle === 'rohfassung' && !errs.length) errs.push('Szene ließ sich nicht zusammensetzen');
  return errs;
}
const codesVon = (errs) => [...new Set(errs.map((e) => (/^([A-Z][A-Z0-9-]+)\b/.exec(e) || [null, 'SZENE'])[1]))].sort();

// Antwort prüfen wie Spielleiter.handleScene (ohne Weltzustand). herkunft 'ollama': Scheinwahl ist ungültig.
// -> { roh: {gueltig, codes, details}, rep: {gueltig, codes, details, repairs} }
function pruefe(env, x, text, ctx, herkunft) {
  let a;
  try { a = SB.parseJsonAnswer(text); } catch (e) { const d = ['kein gültiges JSON: ' + e.message]; return { roh: { gueltig: false, codes: ['JSON'], details: d }, rep: { gueltig: false, codes: ['JSON'], details: d, repairs: [] } }; }
  const g = JSON.parse(JSON.stringify(x.grobplan)); const s = g.szenen.find((y) => y.id === x.szene.id);
  const eRoh = baue(env, x, a, ctx);
  const vor = SB.repairSceneAnswerLexLoc(g, s, a, env);
  const rep = SB.repairSceneAnswer(g, s, vor.answer, env, { knownFlags: SB.planFlags(g, {}, env) });
  const eRep = baue(env, x, rep.answer, ctx);
  if (herkunft === 'ollama') eRep.push(...rep.repairs.filter((r) => /setzt keine Folge → Standardweg/.test(r)).map((r) => `Scheinwahl: ${r}`));
  return { roh: { gueltig: !eRoh.length, codes: codesVon(eRoh), details: eRoh }, rep: { gueltig: !eRep.length, codes: codesVon(eRep), details: eRep, repairs: vor.repairs.concat(rep.repairs) } };
}

async function messe(o) {
  const katalog = Katalog.load({}); const env = SB.buildEnv(katalog);
  const ctx = H.kontextNachTutorial();
  const transport = Ollama.create({ url: o.url, model: o.model });
  const h = await Ollama.gesund({ url: o.url });
  console.log(`Healthcheck ${h.url}: ${h.ok ? 'ok, Ollama ' + (h.version || '?') : 'NICHT erreichbar (' + h.fehler + ')'}   Modell: ${o.model || transport.model}`);
  if (!h.ok) return { ok: false, gesund: h };
  let wahl = o.selbst || waehle(o.n, o.quelle, o.szene);
  let ausgeschlossen = 0;
  if (!o.selbst && !o.alleSzenen) { const vor = wahl.length; wahl = wahl.filter((x) => pruefe(env, x, JSON.stringify(x.antwort), ctx, 'claude').rep.gueltig); ausgeschlossen = vor - wahl.length; }
  const runden = o.runden || 1;
  console.log(`${wahl.length} Szenen × ${runden} Runde(n) = ${wahl.length * runden} Läufe aus ${o.selbst ? 'dem Selbsttest' : o.quelle}${ausgeschlossen ? ` (${ausgeschlossen} Szenen ausgeschlossen: Referenzantwort besteht den Prüfer im Fixture-Kontext nicht)` : ''}${o.schema ? ', mit Schema' : ', ohne Schema'}\n`);
  const R = []; const system = Prompts.systemFuerOllama('szene', LLM.systemPromptFile('szene'));
  for (let rd = 1; rd <= runden; rd++) {
    for (const x of wahl) {
      const prompt = scenePrompt(x.grobplan, x.szene.id, env, ctx, { crew: 3 });
      const schema = o.schema ? Schema.szenenSchemaFuer(env, x.szene) : undefined;
      const r = { name: x.name, szene: x.szene.id, runde: rd, sec: null, roh: false, rep: false, codes: [], fehlertext: null, claudeGueltig: null, tokens: null };
      try {
        const a = await transport.call(prompt, { system, schema, timeoutMs: o.timeoutMs, model: o.model });
        r.sec = a.sec; r.tokens = a.usage;
        const p = pruefe(env, x, a.text, ctx, 'ollama');
        r.roh = p.roh.gueltig; r.rep = p.rep.gueltig; r.codes = p.rep.codes; r.repairs = p.rep.repairs.length;
        r.fehlertext = p.rep.gueltig ? null : (p.rep.details[0] || '').slice(0, 140);
      } catch (e) { r.codes = [e.code || 'FEHLER']; r.fehlertext = e.message.slice(0, 140); }
      if (!r.rep && o.claude) {
        try {
          const c = await LLM.TRANSPORTS.cli.call(prompt, { system: LLM.systemPromptFile('szene'), model: 'sonnet', timeoutMs: 180000 });
          r.claudeGueltig = pruefe(env, x, c.text, ctx, 'claude').rep.gueltig;
        } catch (e) { r.claudeGueltig = false; }
      }
      R.push(r);
      console.log(`  ${r.rep ? '✓' : '✗'} R${rd} ${x.name}  ${sek(r.sec)}${r.tokens ? `  (${r.tokens.input}→${r.tokens.output} Token)` : ''}${r.repairs ? `  ${r.repairs} Reparatur(en)` : ''}${r.roh ? '' : r.rep ? '  [roh ungültig]' : ''}${r.rep ? '' : `  [${r.codes.join(',')}] ${r.fehlertext || ''}`}${r.claudeGueltig === null ? '' : `  → Claude: ${r.claudeGueltig ? 'gültig' : 'ungültig'}`}`);
    }
  }
  const n = R.length; const nSzenen = new Set(R.map((r) => r.szene)).size;
  const roh = R.filter((r) => r.roh).length; const rep = R.filter((r) => r.rep).length; const esk = R.filter((r) => !r.rep).length;
  const secs = R.map((r) => r.sec).filter((s) => s !== null);
  const arten = {};
  for (const r of R) if (!r.rep) for (const c of r.codes.length ? r.codes : ['?']) arten[c] = (arten[c] || 0) + 1;
  const g2 = R.filter((r) => r.claudeGueltig === true).length;
  // je Szene: immer / nie / wechselnd gültig (mit Reparatur)
  const je = {}; for (const r of R) { (je[r.szene] = je[r.szene] || []).push(r.rep); }
  const immer = Object.values(je).filter((v) => v.every(Boolean)).length; const nie = Object.values(je).filter((v) => v.every((x) => !x)).length;
  const erste = R.filter((r) => r.runde === 1); const ersteRep = erste.filter((r) => r.rep).length;
  console.log(`\nErgebnis: ${nSzenen} Szenen, ${n} Läufe (die Läufe je Szene sind nicht unabhängig)`);
  console.log(`  gültig roh (ohne Reparatur):      ${anteil(roh, n)}`);
  console.log(`  gültig mit Reparatur (im Spiel):  ${anteil(rep, n)}`);
  console.log(`  erster Lauf je Szene, mit Rep.:   ${anteil(ersteRep, erste.length)}`);
  console.log(`  Szenen immer / nie / wechselnd:   ${immer} / ${nie} / ${nSzenen - immer - nie}`);
  console.log(`  Eskalationen nötig:               ${esk}${o.claude ? ` → davon nach Eskalation gültig: ${g2}` : ' (nicht ausgeführt; --claude mit LLM_LIVE=1 führt sie aus)'}`);
  console.log(`  Dauer Ollama:                     Median ${sek(median(secs))}, p90 ${sek(perzentil(secs, 0.9))}, max ${sek(secs.length ? Math.max(...secs) : null)}`);
  console.log(`  Fehlerarten (nach Reparatur):     ${Object.keys(arten).length ? Object.entries(arten).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ') : '–'}`);
  return { ok: true, n, szenen: nSzenen, roh, gueltigMitReparatur: rep, eskalationen: esk, nachEskalation: g2, median: median(secs), p90: perzentil(secs, 0.9), arten, wilsonRep: wilson(rep, n), ergebnisse: R };
}

// ---------- Selbsttest mit Fake-Server ----------
async function selbsttest() {
  const katalog = Katalog.load({}); const env = SB.buildEnv(katalog);
  const ctx = H.kontextNachTutorial();
  const wahl = waehle(400, 'alle').filter((x) => pruefe(env, x, JSON.stringify(x.antwort), ctx, 'ollama').rep.gueltig).filter((x, i, a) => i % Math.floor(a.length / 4) === 0).slice(0, 4);
  const antworten = new Map(wahl.map((x) => [x.szene.id, x.antwort]));
  const kaputt = wahl[wahl.length - 1].szene.id;        // diese Szene beantwortet der Fake-Server falsch → Eskalation nötig
  const srv = await H.fakeOllama((req, res, body) => {
    if (req.url === '/api/version') return H.antwort(res, 200, { version: 'fake-1' });
    const user = body.messages[body.messages.length - 1].content;
    const m = /Szene '([^']+)' aus/.exec(user); const sid = m && m[1];
    const text = sid === kaputt ? '{"molekuele": []}' : JSON.stringify(antworten.get(sid) || {});
    H.antwort(res, 200, { model: body.model, message: { role: 'assistant', content: text }, done: true, prompt_eval_count: 100, eval_count: 20 });
  });
  const log = console.log; const aus = [];
  console.log = (...a) => { aus.push(a.join(' ')); };
  let r;
  try { r = await messe({ n: 4, runden: 2, quelle: 'alle', selbst: wahl, url: srv.url, model: 'fake:1b', timeoutMs: 20000, schema: true, claude: false }); } finally { console.log = log; }
  const fehler = [];
  if (!r.ok) fehler.push('Healthcheck fehlgeschlagen');
  else {
    if (r.n !== 8 || r.szenen !== 4) fehler.push(`${r.szenen} Szenen / ${r.n} Läufe statt 4 / 8`);
    if (r.gueltigMitReparatur !== 6) fehler.push(`gültig ${r.gueltigMitReparatur} statt 6`);
    if (r.eskalationen !== 2) fehler.push(`Eskalationen ${r.eskalationen} statt 2`);
    if (!Object.keys(r.arten).length) fehler.push('keine Fehlerart gezählt');
    if (r.median === null) fehler.push('keine Dauer gemessen');
    const [lo, hi] = r.wilsonRep; if (!(lo > 0.4 && lo < 0.75 && hi > 0.75 && hi < 0.97)) fehler.push(`Wilson ${lo.toFixed(2)}–${hi.toFixed(2)} unplausibel für 6/8`);
  }
  const posts = srv.requests.filter((q) => q.method === 'POST');
  if (posts.length !== 8 || !posts.every((q) => q.body.think === false && q.body.format && q.body.model === 'fake:1b')) fehler.push('Anfragen: think:false/format/Modell fehlen');
  if (!posts.every((q) => q.body.messages[0].role === 'system' && !q.body.messages[0].content.includes('Lexikon-Platzhalter') && q.body.messages[0].content.includes('Keine Platzhalter'))) fehler.push('Systemprompt der Ollama-Route ohne Lexikon-Absatz fehlt');
  if (!aus.some((l) => /Healthcheck .*ok, Ollama fake-1/.test(l)) || !aus.some((l) => /gültig mit Reparatur .*6 von 8/.test(l)) || !aus.some((l) => /Wilson 95 %/.test(l))) fehler.push('Ausgabe unvollständig');
  await srv.close();
  console.log(fehler.length ? `Selbsttest FEHLER: ${fehler.join('; ')}` : `Selbsttest ok (Fake-Ollama, ${r.szenen} Szenen, ${r.n} Läufe, ${r.gueltigMitReparatur} gültig, ${r.eskalationen} Eskalationen, Median ${sek(r.median)})`);
  process.exit(fehler.length ? 1 : 0);
}

if (require.main === module) {
  if (flag('selbsttest')) selbsttest().catch((e) => { console.log('Selbsttest FEHLER: Ausnahme ' + (e && e.stack)); process.exit(1); });
  else {
    messe({ n: Number(opt('n', 5)), runden: Number(opt('runden', 1)), quelle: opt('quelle', 'alle'), szene: opt('szene'), url: opt('url'), model: opt('model'), timeoutMs: Number(opt('timeout', 120)) * 1000, schema: !flag('ohne-schema'), alleSzenen: flag('alle-szenen'), claude: flag('claude') })
      .then((r) => { if (flag('json')) console.log(JSON.stringify(r, null, 1)); process.exit(r.ok ? 0 : 1); }, (e) => { console.log('Fehler: ' + (e && e.stack)); process.exit(1); });
  }
}
module.exports = { messe, pruefe, waehle, wilson };
