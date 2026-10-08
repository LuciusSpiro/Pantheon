'use strict';
// LLM-Schnittstelle des Spielleiters (CONTRACT-S1 §8.1, CONTRACT-S2 §2.2).
//
//   const llm = LLM.create({ mode, fixturesDir, budget, katalog, script, transport, recordDir, model })
//   await llm.ask(kind, input, { timeoutMs })   // kind: 'grobplan' | 'szene' -> { text, tokens, usage, source, key }
//   LLM.budget()                               // EIN Token-Zähler je Prozess: { used, limit, remaining, calls }
//
// Modi (Standard aus SPIELLEITER_LLM, sonst 'off'):
//   off    – wirft einen verständlichen Fehler (Spiel ohne Spielleiter → nur Archiv)
//   mock   – deterministische Minimal-Antwort aus dem Katalog (gültiger Grobplan bzw. Szene mit Testwerten)
//   replay – Antwort aus tools/fixtures/llm/<kind>/<key>.json, key = sha1(kind + kanonisches input).
//            Fehlt die Aufzeichnung: Fehler mit Hinweis auf `npm run test:llm -- --record`. Nie ein Live-Fallback.
//   script – S2: Antworten/Fehler/Verzögerungen nach Plan (deterministisch, für Pipeline-Tests). opts.script:
//            { grobplan: [eintrag…], szene: [eintrag…] } oder eine Liste für beide. Eintrag:
//              { text } | { json: obj } | { error: 'timeout'|'enoent'|'exit'|'429'|'<Text>' } | { mock: true }
//              optional { tokens: n } (zählt auf den Prozess-Zähler) und { hold: true } (bleibt offen bis llm.release()).
//            Leere Liste -> mock-Antwort. llm.calls() listet die Aufrufe.
//   live   – nur wenn mode 'live' ausdrücklich gesetzt ist UND LLM_LIVE=1. Transport 'cli' (Claude-CLI über Node,
//            --model sonnet, MAX_THINKING_TOKENS=0), 'api' ist nur als Schnittstelle vorgesehen (wirft). Jeder Live-Aufruf
//            wird nach <recordDir>/<kind>/<key>.json geschrieben (Format llm-aufzeichnung/1, wie tools/fixtures/llm).
//
// Fehler tragen err.code: ETIMEDOUT, ENOENT (CLI fehlt), EXIT (Exit≠0), RATE_LIMIT (429), BUDGET, OFF, REFUSED.
//
// Eingabe 'input' ist ein JSON-Objekt. Für live/replay zählt das ganze Objekt (Schlüssel). Hat es ein Feld 'prompt'
// (String), wird genau dieser Text gesendet, sonst eine Standardform aus dem Objekt (renderPrompt). Hat es 'system'
// (Dateipfad), ist das der Systemprompt.
//
// Prompt-Reihenfolge für Caching (buildPrompt): statischer Teil (Katalog) → Grobplan der Mission → variabler Teil.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const KINDS = ['grobplan', 'szene'];
const MODES = ['off', 'mock', 'replay', 'script', 'live'];
const TRANSPORT_NAMES = ['cli', 'api'];
const DEFAULT_FIXTURES = path.join(ROOT, 'tools', 'fixtures', 'llm');
const DEFAULT_BUDGET = 500000;
const PROMPT_DIR = path.join(ROOT, 'content', 'spielleiter', 'prompts');
// Systemprompts: content/spielleiter/prompts/<kind>.system.md (S2), sonst die bewährten aus dem Trockenversuch
const LEGACY_PROMPTS = {
  grobplan: path.join(ROOT, 'concept', 'regiebuch', 'trockenversuch', 'grobplan-spielleiter.md'),
  szene: path.join(ROOT, 'concept', 'regiebuch', 'trockenversuch', 'szene-spielleiter.md'),
};
function systemPromptFile(kind) {
  const f = path.join(PROMPT_DIR, `${kind}.system.md`);
  return fs.existsSync(f) ? f : LEGACY_PROMPTS[kind];
}
const SYSTEM_PROMPTS = { get grobplan() { return systemPromptFile('grobplan'); }, get szene() { return systemPromptFile('szene'); } };

// ---------- EIN Token-Zähler je Prozess (CONTRACT-S2 Entscheidung 13; Cache-Treffer zählen voll) ----------
const BUDGET = { used: 0, calls: 0, limit: null };
function envLimit() { const n = Number(process.env.CLAUDE_TOKEN_BUDGET); return n > 0 ? n : DEFAULT_BUDGET; }
function budget() {
  const limit = BUDGET.limit != null ? BUDGET.limit : envLimit();
  return { used: BUDGET.used, limit, remaining: Math.max(0, limit - BUDGET.used), calls: BUDGET.calls };
}
function addUsage(n) { const v = Math.max(0, Number(n) || 0); BUDGET.used += v; BUDGET.calls++; return budget(); }
function setBudgetLimit(n) { BUDGET.limit = n == null ? null : Math.max(0, Number(n) || 0); }
function resetBudget() { BUDGET.used = 0; BUDGET.calls = 0; BUDGET.limit = null; }

// ---------- kanonische Form und Schlüssel ----------
// Sortierte Schlüssel, undefined fällt weg (wie JSON), Zahlen/Strings unverändert.
function canonicalize(x) {
  if (Array.isArray(x)) return x.map((v) => (v === undefined ? null : canonicalize(v)));
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x).sort()) if (x[k] !== undefined) o[k] = canonicalize(x[k]);
    return o;
  }
  return x;
}
function canonical(x) { return JSON.stringify(canonicalize(x)); }
function key(kind, input) { return crypto.createHash('sha1').update(String(kind) + '\n' + canonical(input)).digest('hex'); }
function recordingPath(fixturesDir, kind, k) { return path.join(fixturesDir || DEFAULT_FIXTURES, kind, k + '.json'); }

// Aufzeichnung schreiben (test-llm-live --record, Live-Aufrufe im Spiel). meta: { modell, quelle, erwartet, ... }
function record(fixturesDir, kind, input, answer, meta) {
  const k = key(kind, input);
  const file = recordingPath(fixturesDir, kind, k);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const doc = Object.assign({ format: 'llm-aufzeichnung/1', kind, key: k }, meta || {}, {
    input, response: { text: answer.text, usage: answer.usage || null, sec: answer.sec != null ? answer.sec : null, modelId: answer.modelId || null },
  });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return file;
}

// Standard-Prompt aus dem Eingabeobjekt (live). Die Tests und der Spielleiter übergeben meist ein fertiges 'prompt'.
function renderPrompt(kind, input) {
  if (input && typeof input.prompt === 'string') return input.prompt;
  const rest = Object.assign({}, input); delete rest.auftrag;
  const auftrag = input && input.auftrag ? (typeof input.auftrag === 'string' ? input.auftrag : JSON.stringify(input.auftrag)) : '';
  const tail = kind === 'grobplan' ? 'Gib jetzt den Grobplan aus. Nur das JSON-Objekt.' : 'Arbeite jetzt die Szene aus. Nur das JSON-Objekt.';
  return `<eingabe>\n${JSON.stringify(canonicalize(rest), null, 1)}\n</eingabe>\n\n<auftrag>\n${auftrag}\n</auftrag>\n\n${tail}`;
}

// Prompt in Caching-Reihenfolge: statisch (Katalog) → Grobplan → variabel (Kontext, Szene, Auftrag, Prüferfehler).
// parts: { katalog: Text, grobplan?: obj, variabel: [[tag, inhalt]…], schluss: Text, vorher?: { antwort, fehler[] } }
function buildPrompt(parts) {
  const out = [];
  if (parts.katalog) out.push(`<katalog>\n${parts.katalog}\n</katalog>`);
  if (parts.grobplan) out.push(`<grobplan>\n${typeof parts.grobplan === 'string' ? parts.grobplan : JSON.stringify(parts.grobplan)}\n</grobplan>`);
  for (const [tag, v] of parts.variabel || []) out.push(`<${tag}>\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n</${tag}>`);
  if (parts.vorher) {
    out.push(`<deine_antwort>\n${parts.vorher.antwort}\n</deine_antwort>`);
    out.push(`<pruefer>\n${(parts.vorher.fehler || []).map((e) => '- ' + e).join('\n')}\n</pruefer>`);
    out.push('Korrigiere die Fehler. Nur das JSON-Objekt.');
  } else if (parts.schluss) out.push(parts.schluss);
  return out.join('\n\n');
}

// ---------- mock ----------
// Lädt den Katalog nur bei Bedarf (server/mission/katalog.js, sonst tools/katalog.js).
function loadKatalog() {
  for (const p of [path.join(__dirname, 'katalog.js'), path.join(ROOT, 'tools', 'katalog.js')]) {
    if (!fs.existsSync(p)) continue;
    try { const K = require(p); if (K && typeof K.load === 'function') return K.load({}); } catch (e) { /* nächste Quelle */ }
  }
  throw new Error('Katalog nicht ladbar (server/mission/katalog.js bzw. tools/katalog.js)');
}
function locationsById() {
  const L = require(path.join(ROOT, 'shared', 'locations.js'));
  return Object.fromEntries(L.LOCATIONS.map((l) => [l.id, l]));
}
function hops(LOC, a, b) {
  if (a === b) return 0;
  const seen = new Set([a]); let front = [a]; let d = 0;
  while (front.length) { d++; const next = []; for (const x of front) for (const y of (LOC[x] ? LOC[x].links : [])) { if (y === b) return d; if (!seen.has(y)) { seen.add(y); next.push(y); } } front = next; }
  return -1;
}
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const hasActionList = (u) => Object.values(u.params || {}).some((d) => d.typ === 'aktionen');

// Erinnerung für den Mock: letzter Gedächtnis-Eintrag des Auftraggebers, sonst ein Fakt, sonst null.
function mockErinnerung(kontext, auftraggeber) {
  const n = (kontext.npc || []).find((x) => x.id === auftraggeber);
  const g = n && (n.gedaechtnis || []).slice(-1)[0];
  if (g && g.ereignis) return { ref: { npc: auftraggeber, ereignis: g.ereignis }, text: g.text || 'Noch keine gemeinsame Erinnerung.' };
  const fk = Object.keys(kontext.fakten || {}).sort()[0];
  if (fk) return { ref: { fakt: fk }, text: `Man spricht im Hafen über ${fk.replace(/_/g, ' ')}.` };
  return { ref: null, text: (g && g.text) || 'Noch keine gemeinsame Erinnerung.' };
}

// Minimal-Grobplan: Hafen -> Szene A -> Szene B (verzweigt in zwei Ausgänge). Jede Umsetzung spielt an ihrem Testort,
// damit die Szene später mit den Testwerten gültig ausgearbeitet werden kann. Rein deterministisch.
function mockGrobplan(input, kat) {
  const LOC = locationsById();
  const anlass = (input && input.anlass) || {};
  const kontext = (input && input.kontext) || {};
  const npcIds = (kontext.npc || []).map((n) => n.id);
  const auftraggeber = anlass.auftraggeber || (npcIds.includes('tesk') || !npcIds.length ? 'tesk' : npcIds[0]);
  const types = Object.values(kat.szenentypen).filter((s) => s.status === 'verfuegbar' && s.id !== 'hafen' && s.bereich === 'weltraum')
    .sort((a, b) => a.kennung.localeCompare(b.kennung, 'de', { numeric: true }));
  const pairs = [];
  for (const st of types) {
    for (const mid of [...st.verfuegbare_molekuele].sort()) {
      const mol = kat.molekuele[mid];
      for (const u of [...mol.umsetzungen].sort(byId)) {
        if (u.status !== 'verfuegbar' || u.schauplatz !== st.bereich || (u.nach || []).length) continue;
        const ort = (u.test && u.test.params && u.test.params.loc) || (u.params.loc && u.params.loc.werte && u.params.loc.werte[0]);
        if (!ort || !LOC[ort] || hops(LOC, 'hafen', ort) < 0) continue;
        pairs.push({ st, mol, u, ort });
      }
    }
  }
  const a = pairs[0];
  const b = pairs.find((p) => p !== a && p.mol.id !== a.mol.id && hasActionList(p.u));
  if (!a || !b) throw new Error('mock: im Katalog fehlen zwei verfügbare Weltraum-Umsetzungen (eine davon mit Aktionsliste)');
  const dauer = (u) => u.dauer_min[0];
  const sprung = (hops(LOC, 'hafen', a.ort) + hops(LOC, a.ort, b.ort)) * 0.5;
  const ziel = Math.max(1, Math.round(1 + dauer(a.u) + dauer(b.u) + sprung));
  const er = mockErinnerung(kontext, auftraggeber);
  const plan = {
    format: 'grobplan/2', id: 'mock_plan', titel: 'Mock: Probeauftrag', auftraggeber, zielspieldauer_min: ziel,
    aufhaenger: 'Deterministischer Testauftrag aus dem Katalog (mock).', erinnerung: er.ref || er.text,
    szenen: [
      { id: 's1_hafen', szenentyp: 'hafen', ort: 'hafen', karte: null, molekuele: [], sachverhalt: 'Auftrag im Hafen.', wendung: null, dauer_min: 1, weiter: [{ wenn: 'immer', nach: 's2_mock' }] },
      { id: 's2_mock', szenentyp: a.st.id, ort: a.ort, karte: null, molekuele: [{ id: a.mol.id, umsetzung: a.u.id }], sachverhalt: `${a.u.name} (mock).`, wendung: null, dauer_min: dauer(a.u), weiter: [{ wenn: 'immer', nach: 's3_mock' }] },
      { id: 's3_mock', szenentyp: b.st.id, ort: b.ort, karte: null, molekuele: [{ id: b.mol.id, umsetzung: b.u.id }], sachverhalt: `${b.u.name} (mock).`, wendung: null, dauer_min: dauer(b.u),
        weiter: [{ wenn: 'Wahl A', nach: 'ausgang:erfolg' }, { wenn: 'sonst', nach: 'ausgang:teilerfolg' }] },
    ],
    entscheidungen: [{ szene: 's3_mock', frage: 'Wahl A oder B?', optionen: [{ id: 'a', text: 'A', folge: 'Ausgang erfolg' }, { id: 'b', text: 'B', folge: 'Ausgang teilerfolg' }] }],
    ausgaenge: {
      erfolg: { wann: 'Wahl A', folgen: [`npc_haltung ${auftraggeber} +1`, `npc_gedaechtnis ${auftraggeber}: Die Crew hat den Probeauftrag erledigt.`, 'chronik Mock: erfolgreich.'] },
      teilerfolg: { wann: 'sonst', folgen: [`npc_gedaechtnis ${auftraggeber}: Die Crew hat den Probeauftrag nur halb erledigt.`, 'chronik Mock: teilweise.'] },
    },
  };
  if (er.ref) plan.erinnerung_text = er.text;
  return plan;
}
// Szene: Parameter = Testwerte der Umsetzung (Ort aus der Szene). Bei Verzweigung setzt die erste Aktionsliste eine Flag.
function mockSzene(input, kat) {
  const g = input && input.grobplan; const sid = input && input.szene;
  const s = g && (g.szenen || []).find((x) => x.id === sid);
  if (!s) throw new Error(`mock: Szene '${sid}' fehlt im Grobplan der Eingabe`);
  const flag = `${s.id.split('_')[0]}_wahl`;
  let flagSet = false;
  const molekuele = (s.molekuele || []).map((m) => {
    const mol = kat.molekuele[m.id]; const u = mol && mol.umsetzungen.find((x) => x.id === m.umsetzung);
    if (!u) throw new Error(`mock: Umsetzung ${m.id}/${m.umsetzung} unbekannt`);
    const params = JSON.parse(JSON.stringify((u.test && u.test.params) || {}));
    if (u.params.loc) params.loc = s.ort;
    if ((s.weiter || []).length > 1 && !flagSet) {
      const n = Object.keys(u.params).find((p) => u.params[p].typ === 'aktionen' && Array.isArray(params[p]));
      if (n) { params[n] = params[n].concat([{ setFlag: { [flag]: true } }]); flagSet = true; }
    }
    return { id: m.id, umsetzung: m.umsetzung, params };
  });
  const weiter = (s.weiter || []).map((w) => w.nach);
  const verzweigung = weiter.length > 1 ? weiter.map((n, i) => (i === 0 ? { nach: n, if: { flag } } : { nach: n })) : [];
  return { molekuele, verzweigung, wendung: null };
}

// ---------- Fehler ----------
function llmError(code, msg) { const e = new Error(msg); e.code = code; return e; }
const SCRIPT_ERRORS = {
  timeout: () => llmError('ETIMEDOUT', 'Zeitüberschreitung (script)'),
  enoent: () => llmError('ENOENT', 'claude nicht startbar (script: CLI fehlt)'),
  exit: () => llmError('EXIT', 'claude fehlgeschlagen (script: Exit 1)'),
  429: () => llmError('RATE_LIMIT', 'claude: 429 Too Many Requests (script)'),
};

// ---------- Transport 'cli' (live) ----------
function claudeCli() { return process.env.CLAUDE_CLI || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'); }
function callClaude(text, sysFile, model, timeoutMs) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const cli = claudeCli();
    if (!fs.existsSync(cli)) { reject(llmError('ENOENT', `claude nicht gefunden (${cli})`)); return; }
    const t0 = Date.now();
    let p;
    try {
      p = spawn(process.execPath, [cli, '-p', '--model', model, '--tools', '', '--output-format', 'stream-json', '--verbose',
        '--include-partial-messages', '--no-session-persistence', '--strict-mcp-config', '--system-prompt-file', sysFile],
      { env: Object.assign({}, process.env, { MAX_THINKING_TOKENS: '0' }), windowsHide: true });
    } catch (e) { reject(llmError(e.code === 'ENOENT' ? 'ENOENT' : 'EXIT', `claude nicht startbar: ${e.message}`)); return; }
    let buf = ''; let txt = ''; let result = null; let err = ''; let modelId = null; let timedOut = false;
    const kill = setTimeout(() => { timedOut = true; try { p.kill(); } catch (e) { /* schon weg */ } }, timeoutMs || 5 * 60 * 1000);
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let o; try { o = JSON.parse(line); } catch (e) { continue; }
        if (o.type === 'system' && o.model) modelId = o.model;
        if (o.type === 'stream_event') { const dl = (o.event || {}).delta || {}; if (dl.type === 'text_delta') txt += dl.text; }
        if (o.type === 'result') result = o;
      }
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(kill); reject(llmError(e.code === 'ENOENT' ? 'ENOENT' : 'EXIT', `claude nicht startbar (${cli}): ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(kill);
      if (timedOut) return reject(llmError('ETIMEDOUT', `Zeitüberschreitung nach ${Math.round((Date.now() - t0) / 1000)} s`));
      const all = err + ' ' + (result && typeof result.result === 'string' ? result.result.slice(0, 300) : '');
      if (/\b429\b|rate.?limit/i.test(all) && (code !== 0 || (result && result.is_error))) return reject(llmError('RATE_LIMIT', `claude: Ratenlimit (${all.trim().slice(0, 200)})`));
      if (code !== 0 && !result) return reject(llmError('EXIT', `claude fehlgeschlagen (${code}): ${err.slice(0, 300)}`));
      const u = (result && result.usage) || {};
      const usage = { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 };
      resolve({ text: (result && result.result) || txt, usage, sec: (Date.now() - t0) / 1000, modelId, cost: result && result.total_cost_usd });
    });
    p.stdin.end(text);
  });
}
const TRANSPORTS = {
  cli: { name: 'cli', call: (text, o) => callClaude(text, o.system, o.model, o.timeoutMs) },
  // Platzhalter für die spätere API (Entscheidung 11): gleiche Signatur, noch nicht umgesetzt
  api: { name: 'api', call: () => Promise.reject(llmError('EXIT', 'Transport api ist noch nicht umgesetzt (nur cli)')) },
};

// ---------- Fabrik ----------
function create(opts) {
  opts = opts || {};
  const mode = opts.mode || process.env.SPIELLEITER_LLM || 'off';
  if (!MODES.includes(mode)) throw new Error(`Unbekannter LLM-Modus '${mode}' (erlaubt: ${MODES.join(', ')})`);
  const fixturesDir = opts.fixturesDir || DEFAULT_FIXTURES;
  if (opts.budget != null) setBudgetLimit(opts.budget);
  const model = opts.model || 'sonnet';
  const transportName = opts.transport && typeof opts.transport === 'string' ? opts.transport : 'cli';
  if (!TRANSPORT_NAMES.includes(transportName)) throw new Error(`Unbekannter Transport '${transportName}' (erlaubt: ${TRANSPORT_NAMES.join(', ')})`);
  const transport = opts.transport && typeof opts.transport === 'object' ? opts.transport : TRANSPORTS[transportName];
  let used = 0; let kat = opts.katalog || null;
  const katalog = () => (kat = kat || loadKatalog());
  // script-Zustand
  const script = opts.script || {};
  const scriptQueue = (kind) => (Array.isArray(script) ? script : (script[kind] = script[kind] || []));
  const held = []; const callLog = [];

  function answerObj(kind, input, text, source, tokens, extra) {
    const t = Number(tokens) || 0;
    return Object.assign({ text, tokens: t, usage: { input: t, output: 0 }, source, key: key(kind, input) }, extra || {});
  }
  function fromScript(kind, input) {
    const q = scriptQueue(kind);
    const idx = q.findIndex((e) => !e || !e.kind || e.kind === kind);
    const e = idx >= 0 ? q.splice(idx, 1)[0] : { mock: true };
    callLog.push({ kind, entry: e, key: key(kind, input) });
    const settle = () => {
      if (e && e.tokens) { used += e.tokens; addUsage(e.tokens); }
      if (e && e.error) throw (SCRIPT_ERRORS[e.error] ? SCRIPT_ERRORS[e.error]() : llmError('EXIT', String(e.error)));
      let text;
      if (e && typeof e.text === 'string') text = e.text;
      else if (e && e.json !== undefined) text = JSON.stringify(e.json);
      else text = JSON.stringify(kind === 'grobplan' ? mockGrobplan(input, katalog()) : mockSzene(input, katalog()));
      return answerObj(kind, input, text, 'script', e && e.tokens);
    };
    if (e && e.hold) return new Promise((resolve, reject) => { held.push({ run: () => { try { resolve(settle()); } catch (err) { reject(err); } } }); });
    return Promise.resolve().then(settle);
  }

  async function ask(kind, input, askOpts) {
    if (!KINDS.includes(kind)) throw new Error(`Unbekannte Anfrage '${kind}' (erlaubt: ${KINDS.join(', ')})`);
    const ao = askOpts || {};
    const k = key(kind, input);
    if (mode === 'off') throw llmError('OFF', `Spielleiter-LLM ist aus (SPIELLEITER_LLM=off). Für Tests 'mock' oder 'replay' setzen; '${kind}' wurde nicht angefragt.`);
    if (mode === 'mock') {
      const obj = kind === 'grobplan' ? mockGrobplan(input, katalog()) : mockSzene(input, katalog());
      return { text: JSON.stringify(obj, null, 2), tokens: 0, usage: { input: 0, output: 0 }, source: 'mock', key: k };
    }
    if (mode === 'script') return fromScript(kind, input);
    if (mode === 'replay') {
      const file = recordingPath(fixturesDir, kind, k);
      if (!fs.existsSync(file)) throw new Error(`Keine Aufzeichnung für '${kind}' (Schlüssel ${k}) in ${path.relative(ROOT, path.dirname(file))} – mit \`npm run test:llm -- --record\` aufzeichnen (verlangt LLM_LIVE=1).`);
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      const usage = (rec.response && rec.response.usage) || { input: 0, output: 0 };
      return { text: rec.response.text, tokens: (usage.input || 0) + (usage.output || 0), usage, source: 'replay', key: k };
    }
    // live
    if (process.env.LLM_LIVE !== '1') throw llmError('REFUSED', 'Live-Aufruf verweigert: mode \'live\' braucht zusätzlich LLM_LIVE=1 (nur von Hand, nie in npm test).');
    const b = budget();
    if (b.used >= b.limit) throw llmError('BUDGET', `Token-Deckel erreicht (${b.used} von ${b.limit}, CLAUDE_TOKEN_BUDGET)`);
    const sys = (input && typeof input.system === 'string' && input.system) || (opts.systemPrompts && opts.systemPrompts[kind]) || systemPromptFile(kind);
    const r = await transport.call(renderPrompt(kind, input), { system: sys, model, timeoutMs: ao.timeoutMs });
    const n = r.usage.input + r.usage.output;
    used += n; addUsage(n);
    const ans = { text: r.text, tokens: n, usage: r.usage, source: 'live', key: k, sec: r.sec, modelId: r.modelId, cost: r.cost };
    if (opts.recordDir) {
      try { ans.file = record(opts.recordDir, kind, input, ans, { modell: model, quelle: 'spiel', zeit: new Date().toISOString() }); } catch (e) { ans.recordError = e.message; }
    }
    return ans;
  }

  return {
    mode, fixturesDir, model, transport: transport.name || transportName,
    get budget() { return budget().limit; },
    ask, used: () => used, remaining: () => budget().remaining,
    // script: offene (hold) Antworten freigeben; n = Anzahl (Standard alle)
    release(n) { const list = held.splice(0, n == null ? held.length : n); list.forEach((h) => h.run()); return list.length; },
    pending: () => held.length,
    calls: () => callLog.slice(),
  };
}

module.exports = {
  create, key, canonical, canonicalize, record, recordingPath, renderPrompt, buildPrompt, mockGrobplan, mockSzene,
  budget, addUsage, resetBudget, setBudgetLimit, systemPromptFile, llmError,
  KINDS, MODES, TRANSPORTS, SYSTEM_PROMPTS, DEFAULT_FIXTURES, PROMPT_DIR,
};
