'use strict';
// SUND-03 B: Mutationsprobe zu den Transport-Tests (Ollama-Transport, Router/Eskalation, Schema-Ableitung, Reparaturen). Kopiert die
// nötigen Teile in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass mindestens
// einer der Tests rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-transport.js          (npm run test:transport-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mut-transport-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'package.json'].forEach(kopiere);
const TESTS = ['tools/test-transport-ollama.js', 'tools/test-schema-ableiten.js', 'tools/test-reparaturen-ref.js', 'tools/test-transport-router.js'];
for (const rel of ['tools/transport-testhilfe.js', 'tools/messe-szenen-ollama.js', 'tools/fixtures/context', ...TESTS]) {
  fs.mkdirSync(path.dirname(path.join(TMP, rel)), { recursive: true });
  kopiere(rel);
}
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const R = 'server/mission/transport-router.js'; const O = 'server/mission/transport-ollama.js'; const S = 'server/mission/schema-ableiten.js';
const L = 'server/mission/llm.js'; const SL = 'server/mission/spielleiter.js'; const SB = 'server/mission/szenenbau.js'; const RL = 'server/mission/regielog.js';
const MUTATIONEN = [
  // ----- Router -----
  [R, "szene: { anbieter: 'ollama' }, text: { anbieter: 'ollama' } };\nconst STANDARD_ESKALATION", "szene: { anbieter: 'claude', modell: 'sonnet' }, text: { anbieter: 'ollama' } };\nconst STANDARD_ESKALATION", 'Router: Standard schickt Szenen an Claude'],
  [R, "const STANDARD = { grobplan: { anbieter: 'claude', modell: 'sonnet' }", "const STANDARD = { grobplan: { anbieter: 'ollama' }", 'Router: Standard schickt den Grobplan an Ollama'],
  [R, "else { delete co.schema; if (modell) co.model = modell; }", "else { if (modell) co.model = modell; }", 'Router: Schema geht auch an Claude'],
  [R, "if (anbieter === 'ollama') { co.model = modell; }", "if (anbieter === 'ollama') { co.model = co.model || modell; }", 'Router: Ollama bekommt das Claude-Modell des Aufrufs'],
  [R, "(eskCfg && cfg[kind] && cfg[kind].anbieter === 'ollama' ? eskCfg.anbieter : null)", "null", 'Router: keine Eskalation'],
  [R, "(eskCfg && cfg[kind] && cfg[kind].anbieter === 'ollama' ? eskCfg.anbieter : null)", "(eskCfg && cfg[kind] ? eskCfg.anbieter : null)", 'Router: auch Claude-Arten eskalieren'],
  [R, "if (co.anbieter) {", "if (false) {", 'Router: erzwungener Anbieter (Eskalation) wird ignoriert'],
  [R, "const ziel = e && e.code === 'OFFLINE' ? eskalationFuer(kind) : null;", "const ziel = null;", 'Router: kein Rückfall bei OFFLINE'],
  [R, "const ziel = e && e.code === 'OFFLINE' ? eskalationFuer(kind) : null;", "const ziel = eskalationFuer(kind);", 'Router: Rückfall bei jedem Fehler'],
  [R, "const r = await einzeln(text, co, ziel, eskCfg.modell, null);\n        return Object.assign(r, { eskaliert: true });", "const r = await einzeln(text, co, ziel, eskCfg.modell, null);\n        return r;", 'Router: Rückfall nicht als eskaliert gekennzeichnet'],
  [R, "const r = await einzeln(text, co, co.anbieter, modell, null);\n        return Object.assign(r, { eskaliert: true });", "const r = await einzeln(text, co, co.anbieter, modell, null);\n        return r;", 'Router: Eskalation nicht gekennzeichnet'],
  [R, "return Object.assign({}, r, { anbieter, modell: r.modelId || modell || null });", "return Object.assign({}, r, { modell: r.modelId || modell || null });", 'Router: Antwort ohne Anbieter'],
  [R, "const gewaehlt = e.LLM_ROUTER === '1' || ARTEN.some(", "const gewaehlt = true || ARTEN.some(", 'Router: immer aktiv (Standardverhalten ändert sich)'],
  [R, "if (eskCfg && eskCfg.anbieter !== 'claude') throw", "if (false) throw", 'Router: Eskalation an Ollama erlaubt'],
  // ----- llm.js -----
  [L, "if (r.anbieter !== 'ollama') { used += n; addUsage(n); }", "{ used += n; addUsage(n); }", 'llm: Token-Zähler zählt Ollama mit'],
  [L, "if (vorab !== 'ollama' && b.used >= b.limit)", "if (b.used >= b.limit)", 'llm: Claude-Deckel sperrt auch Ollama'],
  [L, "if (vorab !== 'ollama' && b.used >= b.limit)", "if (false)", 'llm: Claude-Deckel gilt nicht mehr'],
  [L, "const co = { system: sys, model, timeoutMs: ao.timeoutMs, kind };", "const co = { system: sys, model, timeoutMs: ao.timeoutMs };", 'llm: kind kommt beim Transport nicht an'],
  [L, "if (ao.schema) co.schema = ao.schema;", "", 'llm: Schema kommt beim Transport nicht an'],
  [L, "if (forced) co.anbieter = forced;", "", 'llm: Eskalation ohne erzwungenen Anbieter'],
  [L, "const KINDS = ['grobplan', 'szene', 'text'];", "const KINDS = ['grobplan', 'szene'];", "llm: Art 'text' fehlt"],
  [L, "if (r.eskaliert || forced) ans.eskaliert = true;", "", 'llm: Antwort ohne eskaliert-Kennzeichen'],
  [L, "if (r.anbieter) { ans.anbieter = r.anbieter;", "if (false) { ans.anbieter = r.anbieter;", 'llm: Antwort ohne Anbieter/Modell'],
  // ----- Spielleiter -----
  [SL, "if (vonOllama) { this.eskaliereSzene(plan, sid, 'Ollama-Antwort ungültig'); return; }", "", 'Spielleiter: ungültige Ollama-Antwort wird wiederholt statt eskaliert'],
  [SL, "this.enqueue({ type: 'szene', plan, sid, eskalation: true });", "", 'Spielleiter: Eskalation wird nie angefragt'],
  [SL, "if (schema) askOpts.schema = schema;", "", 'Spielleiter: Schema geht nicht an den Transport'],
  [SL, "p = job.eskalation ? this.getLlm().eskaliere(kind, input, askOpts) : this.getLlm().ask(kind, input, askOpts);", "p = this.getLlm().ask(kind, input, askOpts);", 'Spielleiter: Eskalation geht wieder an Ollama'],
  [SL, "if (!this.eskalationMoeglich('szene')) { this.sceneFailed(plan, sid, `${grund} (keine Eskalation)`); return false; }", "if (!this.eskalationMoeglich('szene')) { return false; }", 'Spielleiter: ohne Eskalation bleibt die Szene offen statt Rohfassung'],
  [SL, "anbieter: r.anbieter, modell: r.modell, eskaliert: eskaliert || undefined,", "", 'Spielleiter: Logbuch ohne Anbieter, Modell, eskaliert'],
  [SL, "const eskaliert = !!(job.eskalation || r.eskaliert || (vonOllama && errs.length && this.eskalationMoeglich('szene')));", "const eskaliert = false;", 'Spielleiter: eskaliert nie im Logbuch'],
  [SL, "else if (!job.eskalation && ['EMPTY', 'EXIT'].includes(e.code) && this.anbieterFuer('szene') === 'ollama')", "else if (false)", 'Spielleiter: leere/kaputte Ollama-Antwort eskaliert nicht'],
  [SL, "(job.eskalation || this.anbieterFuer(kind) !== 'ollama') && b.remaining < this.C.minBudget", "b.remaining < this.C.minBudget", 'Spielleiter: Claude-Budget sperrt Ollama-Läufe'],
  [SL, "try { repairs.push(...Szenenbau.repairGrobplanReferenzen(g, this.env2())); } catch (e) { this.countError('reparatur', e); }", "", 'Spielleiter: Referenz-Reparaturen werden nicht angewandt'],
  [SL, "if (l.mode !== 'live' || this.anbieterFuer('szene') !== 'ollama') return null;", "if (l.mode !== 'live') return null;", 'Spielleiter: Schema auch für Claude-Szenen'],
  [RL, "'plan', 'anbieter', 'modell', 'eskaliert']", "'plan']", 'Regielog: verwirft anbieter/modell/eskaliert'],
  // ----- Schema -----
  [S, "if (d.pflicht && d.default === undefined && d.typ !== 'map' && d.typ !== 'landepunkt' && !VOM_SPIEL.has(n)) req.push(n);", "", 'Schema: keine Pflichtparameter'],
  [S, "if (d.pflicht && d.default === undefined && d.typ !== 'map' && d.typ !== 'landepunkt' && !VOM_SPIEL.has(n)) req.push(n);", "if (d.pflicht) req.push(n);", 'Schema: auch vom Spiel gesetzte Parameter sind Pflicht'],
  [S, "properties: { id: { const: m.id }, umsetzung: { const: m.umsetzung },", "properties: { id: S, umsetzung: S,", 'Schema: Molekül und Umsetzung nicht festgelegt'],
  [S, "nach: { type: 'string', enum: ziele }", "nach: S", 'Schema: Verzweigungsziele frei'],
  [S, "properties: props, additionalProperties: false }", "properties: props }", 'Schema: unbekannte Parameter erlaubt'],
  [S, "return { anyOf: [{ type: 'string', enum: ids.length ? ids : ['tesk'] }, { type: 'string', pattern: '^neu:.+' }] };", "return S;", 'Schema: NSC frei'],
  [S, "nach_s: { type: 'number', minimum: 20, maximum: 120 }", "nach_s: { type: 'number' }", 'Schema: Wendungszeit ohne Grenzen'],
  [S, "case 'loc': return { const: s.ort };", "case 'loc': return S;", 'Schema: Ort nicht auf die Szene festgelegt'],
  [S, "if (Number.isFinite(d.min)) o.minimum = d.min;", "", 'Schema: Zahlen ohne Untergrenze'],
  [S, "const wendung = hasWendung(s) ? { anyOf: [{ type: 'null' }, wendungObjekt] } : { type: 'null' };", "const wendung = { anyOf: [{ type: 'null' }, wendungObjekt] };", 'Schema: Wendung auch ohne Plan erlaubt'],
  [S, "{ type: 'array', maxItems: 0 };", "{ type: 'array' };", 'Schema: Verzweigung bei einem Ziel frei'],
  [S, "{ type: 'object', required: ['do', 'marks'], properties: { do: { const: 'pay_marks' }, marks: { type: 'number' } }, additionalProperties: false },", "{ type: 'object', required: ['do', 'marks'], properties: { do: S, marks: { type: 'number' } }, additionalProperties: false },", 'Schema: jede do-Aktion erlaubt'],
  // ----- Reparaturen -----
  [SB, "if (ids && ids.length === 1) { R.push(`Szene '${s.id}': Szenentyp", "if (ids && ids.length >= 1) { R.push(`Szene '${s.id}': Szenentyp", 'Reparatur: Kennung auch bei Mehrdeutigkeit'],
  [SB, "if (typeof s[f] === 'string' && /^\\s*null\\s*$/i.test(s[f]))", "if (typeof s[f] === 'string' && /null/i.test(s[f]))", 'Reparatur: jeder Text mit null wird zu null'],
  [SB, "if (teile.length === 1 && teile[0] !== m.umsetzung && mol.umsetzungen.some((u) => u.id === teile[0])) {", "if (teile.length === 1 && teile[0] !== m.umsetzung) {", 'Reparatur: Präfix auch ohne registrierte Umsetzung'],
  [SB, "while (teile.length > 1 && teile[0] === m.id) teile.shift();", "while (teile.length > 1) teile.shift();", 'Reparatur: fremde Präfixe werden abgeschnitten'],
  // ----- Ollama-Transport -----
  [O, "const body = { model, stream: false, think: false, messages: [] };", "const body = { model, stream: false, think: true, messages: [] };", 'Ollama: think an'],
  [O, "const body = { model, stream: false, think: false, messages: [] };", "const body = { model, stream: true, think: false, messages: [] };", 'Ollama: stream an'],
  [O, "if (co.schema) body.format = co.schema;", "", 'Ollama: Schema nicht als format gesendet'],
  [O, "if (co.schema) body.format = co.schema;", "if (co.schema) body.format = co.schema;\n      body.keep_alive = -1;", 'Ollama: keep_alive gesetzt'],
  [O, "const model = co.model || modelName(o, o.env);", "const model = modelName(o, o.env);", 'Ollama: Modell des Aufrufs ignoriert'],
  [O, "const DEFAULT_MODEL = 'gemma4:26b-a4b-it-q4_K_M';", "const DEFAULT_MODEL = 'sonnet';", 'Ollama: falsches Standardmodell'],
  [O, "const DEFAULT_URL = 'http://127.0.0.1:11435';", "const DEFAULT_URL = 'http://127.0.0.1:11434';", 'Ollama: falsche Standard-URL'],
  [O, "timedOut = true; ctl.abort();", "ctl.abort();", 'Ollama: Zeitlimit nicht als ETIMEDOUT erkannt'],
  [O, "const OFFLINE_CODES = new Set(['ECONNREFUSED', ", "const OFFLINE_CODES = new Set([", 'Ollama: ECONNREFUSED ist nicht OFFLINE'],
  [O, "if (!out.trim()) throw err('EMPTY', 'Ollama: leere Antwort');", "", 'Ollama: leere Antwort wird durchgereicht'],
  [O, "if (!res.ok) throw err('EXIT', `Ollama: HTTP ${res.status} ${String(raw).slice(0, 200).replace(/\\s+/g, ' ')}`);", "", 'Ollama: HTTP-Fehler werden ignoriert'],
  [O, "if (j && j.error) throw err('EXIT', `Ollama: ${String(j.error).slice(0, 200)}`);", "", 'Ollama: Fehlerfeld bei 200 wird ignoriert'],
  [O, "usage: { input: j.prompt_eval_count || 0, output: j.eval_count || 0 }", "usage: { input: j.eval_count || 0, output: j.prompt_eval_count || 0 }", 'Ollama: Token vertauscht'],
  [O, "cost: 0, anbieter: 'ollama' }", "cost: 1, anbieter: 'ollama' }", 'Ollama: Kosten ≠ 0'],
  [O, "cost: 0, anbieter: 'ollama' }", "cost: 0 }", 'Ollama: Antwort ohne Anbieter (Zähler zählt mit)'],
  [O, "if (o.numPredict) options.num_predict = o.numPredict;", "options.temperature = 0.7;", 'Ollama: feste Temperatur trotz Konfiguration'],
  [O, "return { ok: true, url, version };", "return { ok: true, url };", 'Healthcheck: ohne Version'],
  [O, "if (!res.ok) return { ok: false, url, fehler: `HTTP ${res.status}`, code: 'EXIT' };", "", 'Healthcheck: HTTP-Fehler gilt als gesund'],
];

let ueberlebt = 0;
console.log(`Mutationsprobe Transport (${MUTATIONEN.length} Mutationen, ${TESTS.length} Tests, Kopie in ${TMP})`);
const laufen = () => {
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: TMP, encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) return { rot: true, test: t, fehler: (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).concat(r.error ? ['Zeitüberschreitung'] : []) };
  }
  return { rot: false };
};
const basis = laufen();
console.log(`  Ausgangslage (unverändert): ${basis.rot ? 'ROT (Abbruch) in ' + basis.test : 'grün'}`);
if (basis.rot) { console.log((basis.fehler || []).slice(0, 5).join('\n')); process.exit(1); }
for (const [datei, alt, neu, was] of MUTATIONEN) {
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  const mut = text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? mut.replace(/\n/g, '\r\n') : mut);
  const r = laufen();
  fs.writeFileSync(f, orig);
  if (!r.rot) ueberlebt++;
  console.log(`  ${r.rot ? 'rot  ' : 'GRÜN '} ${was}${r.rot ? ` (${path.basename(r.test)}: ${(r.fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 60)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen erkannt');
process.exit(ueberlebt ? 1 : 0);
