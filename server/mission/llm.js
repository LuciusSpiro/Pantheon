'use strict';
// LLM-Schnittstelle des Spielleiters (CONTRACT-S1 §8.1). In S1 ruft KEIN Spielcode das auf – nur die Tests.
//
//   const llm = LLM.create({ mode, fixturesDir, budget, katalog })
//   await llm.ask(kind, input)   // kind: 'grobplan' | 'szene' -> { text, tokens, usage, source, key }
//
// Modi (Standard aus SPIELLEITER_LLM, sonst 'off'):
//   off    – wirft einen verständlichen Fehler (Spiel ohne Spielleiter)
//   mock   – deterministische Minimal-Antwort aus dem Katalog (gültiger Grobplan bzw. Szene mit Testwerten)
//   replay – Antwort aus tools/fixtures/llm/<kind>/<key>.json, key = sha1(kind + kanonisches input).
//            Fehlt die Aufzeichnung: Fehler mit Hinweis auf `npm run test:llm -- --record`. Nie ein Live-Fallback.
//   live   – nur wenn mode 'live' ausdrücklich gesetzt ist UND LLM_LIVE=1. Aufruf wie im Trockenversuch
//            (claude-code CLI -p, --model sonnet, MAX_THINKING_TOKENS=0), Token-Deckel CLAUDE_TOKEN_BUDGET.
//
// Eingabe 'input' ist ein JSON-Objekt. Für live/replay zählt das ganze Objekt (Schlüssel). Hat es ein Feld 'prompt'
// (String), wird genau dieser Text gesendet, sonst eine Standardform aus dem Objekt (renderPrompt).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const KINDS = ['grobplan', 'szene'];
const MODES = ['off', 'mock', 'replay', 'live'];
const DEFAULT_FIXTURES = path.join(ROOT, 'tools', 'fixtures', 'llm');
const DEFAULT_BUDGET = 500000;
// Systemprompts aus dem Trockenversuch (bewährt, Runde 3 / Stufe 2)
const SYSTEM_PROMPTS = {
  grobplan: path.join(ROOT, 'concept', 'regiebuch', 'trockenversuch', 'grobplan-spielleiter.md'),
  szene: path.join(ROOT, 'concept', 'regiebuch', 'trockenversuch', 'szene-spielleiter.md'),
};

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

// Aufzeichnung schreiben (nur test-llm-live --record). meta: { modell, quelle, erwartet, ... }
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

// Standard-Prompt aus dem Eingabeobjekt (live). Die Tests übergeben meist ein fertiges 'prompt'.
function renderPrompt(kind, input) {
  if (input && typeof input.prompt === 'string') return input.prompt;
  const rest = Object.assign({}, input); delete rest.auftrag;
  const auftrag = input && input.auftrag ? (typeof input.auftrag === 'string' ? input.auftrag : JSON.stringify(input.auftrag)) : '';
  const tail = kind === 'grobplan' ? 'Gib jetzt den Grobplan aus. Nur das JSON-Objekt.' : 'Arbeite jetzt die Szene aus. Nur das JSON-Objekt.';
  return `<eingabe>\n${JSON.stringify(canonicalize(rest), null, 1)}\n</eingabe>\n\n<auftrag>\n${auftrag}\n</auftrag>\n\n${tail}`;
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
  const erinnerung = ((kontext.npc || []).find((n) => n.id === auftraggeber) || { gedaechtnis: [] }).gedaechtnis.slice(-1).map((g) => g.text)[0] || 'Noch keine gemeinsame Erinnerung.';
  return {
    format: 'grobplan/2', id: 'mock_plan', titel: 'Mock: Probeauftrag', auftraggeber, zielspieldauer_min: ziel,
    aufhaenger: 'Deterministischer Testauftrag aus dem Katalog (mock).', erinnerung,
    szenen: [
      { id: 's1_hafen', szenentyp: 'hafen', ort: 'hafen', karte: null, molekuele: [], sachverhalt: 'Auftrag im Hafen.', wendung: null, dauer_min: 1, weiter: [{ wenn: 'immer', nach: 's2_mock' }] },
      { id: 's2_mock', szenentyp: a.st.id, ort: a.ort, karte: null, molekuele: [{ id: a.mol.id, umsetzung: a.u.id }], sachverhalt: `${a.u.name} (mock).`, wendung: null, dauer_min: dauer(a.u), weiter: [{ wenn: 'immer', nach: 's3_mock' }] },
      { id: 's3_mock', szenentyp: b.st.id, ort: b.ort, karte: null, molekuele: [{ id: b.mol.id, umsetzung: b.u.id }], sachverhalt: `${b.u.name} (mock).`, wendung: null, dauer_min: dauer(b.u),
        weiter: [{ wenn: 'Wahl A', nach: 'ausgang:erfolg' }, { wenn: 'sonst', nach: 'ausgang:teilerfolg' }] },
    ],
    entscheidungen: [{ szene: 's3_mock', frage: 'Wahl A oder B?', optionen: [{ id: 'a', text: 'A', folge: 'Ausgang erfolg' }, { id: 'b', text: 'B', folge: 'Ausgang teilerfolg' }] }],
    ausgaenge: {
      erfolg: { wann: 'Wahl A', folgen: [`npc_haltung ${auftraggeber} +1`, 'chronik Mock: erfolgreich.'] },
      teilerfolg: { wann: 'sonst', folgen: ['chronik Mock: teilweise.'] },
    },
  };
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

// ---------- live ----------
function claudeCli() { return process.env.CLAUDE_CLI || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'); }
function callClaude(text, sysFile, model) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [claudeCli(), '-p', '--model', model, '--tools', '', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--no-session-persistence', '--strict-mcp-config', '--system-prompt-file', sysFile],
    { env: Object.assign({}, process.env, { MAX_THINKING_TOKENS: '0' }) });
    let buf = ''; let txt = ''; let result = null; let err = ''; let modelId = null;
    const kill = setTimeout(() => p.kill(), 5 * 60 * 1000);
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
    p.on('error', (e) => { clearTimeout(kill); reject(new Error(`claude nicht startbar (${claudeCli()}): ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(kill);
      if (code !== 0 && !result) return reject(new Error(`claude fehlgeschlagen (${code}): ${err.slice(0, 300)}`));
      const u = (result && result.usage) || {};
      const usage = { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 };
      resolve({ text: (result && result.result) || txt, usage, sec: (Date.now() - t0) / 1000, modelId, cost: result && result.total_cost_usd });
    });
    p.stdin.end(text);
  });
}

// ---------- Fabrik ----------
function create(opts) {
  opts = opts || {};
  const mode = opts.mode || process.env.SPIELLEITER_LLM || 'off';
  if (!MODES.includes(mode)) throw new Error(`Unbekannter LLM-Modus '${mode}' (erlaubt: ${MODES.join(', ')})`);
  const fixturesDir = opts.fixturesDir || DEFAULT_FIXTURES;
  const envBudget = Number(process.env.CLAUDE_TOKEN_BUDGET);
  const budget = opts.budget != null ? opts.budget : (envBudget > 0 ? envBudget : DEFAULT_BUDGET);
  const model = opts.model || 'sonnet';
  let used = 0; let kat = opts.katalog || null;
  const katalog = () => (kat = kat || loadKatalog());

  async function ask(kind, input) {
    if (!KINDS.includes(kind)) throw new Error(`Unbekannte Anfrage '${kind}' (erlaubt: ${KINDS.join(', ')})`);
    const k = key(kind, input);
    if (mode === 'off') throw new Error(`Spielleiter-LLM ist aus (SPIELLEITER_LLM=off). Für Tests 'mock' oder 'replay' setzen; '${kind}' wurde nicht angefragt.`);
    if (mode === 'mock') {
      const obj = kind === 'grobplan' ? mockGrobplan(input, katalog()) : mockSzene(input, katalog());
      return { text: JSON.stringify(obj, null, 2), tokens: 0, usage: { input: 0, output: 0 }, source: 'mock', key: k };
    }
    if (mode === 'replay') {
      const file = recordingPath(fixturesDir, kind, k);
      if (!fs.existsSync(file)) throw new Error(`Keine Aufzeichnung für '${kind}' (Schlüssel ${k}) in ${path.relative(ROOT, path.dirname(file))} – mit \`npm run test:llm -- --record\` aufzeichnen (verlangt LLM_LIVE=1).`);
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      const usage = (rec.response && rec.response.usage) || { input: 0, output: 0 };
      return { text: rec.response.text, tokens: (usage.input || 0) + (usage.output || 0), usage, source: 'replay', key: k };
    }
    // live
    if (process.env.LLM_LIVE !== '1') throw new Error('Live-Aufruf verweigert: mode \'live\' braucht zusätzlich LLM_LIVE=1 (nur von Hand, nie in npm test).');
    if (used >= budget) throw new Error(`Token-Deckel erreicht (${used} von ${budget}, CLAUDE_TOKEN_BUDGET)`);
    const r = await callClaude(renderPrompt(kind, input), opts.systemPrompts && opts.systemPrompts[kind] || SYSTEM_PROMPTS[kind], model);
    used += r.usage.input + r.usage.output;
    return { text: r.text, tokens: r.usage.input + r.usage.output, usage: r.usage, source: 'live', key: k, sec: r.sec, modelId: r.modelId, cost: r.cost };
  }

  return { mode, fixturesDir, budget, ask, used: () => used, remaining: () => Math.max(0, budget - used) };
}

module.exports = { create, key, canonical, canonicalize, record, recordingPath, renderPrompt, mockGrobplan, mockSzene, KINDS, MODES, SYSTEM_PROMPTS, DEFAULT_FIXTURES };
