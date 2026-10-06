'use strict';
// Teaser-Mission (§8): Claude-Bridge oder Archiv (fallback.json). Token wird nie geloggt oder an Clients gegeben.
const fs = require('fs');
const path = require('path');
const Schema = require('../../shared/schema.js');

const FALLBACK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fallback.json'), 'utf8')).missions;
const TIMEOUT_MS = 90000;

let inFlight = null; // nur ein Bridge-Aufruf gleichzeitig

// Token-Deckel pro Serverlauf (Kai, 2026-10-04: 500k). Gezählt wird, was die CLI als usage meldet
// (Eingabe inkl. Cache + Ausgabe). Ist der Deckel erreicht, kommen nur noch Archiv-Missionen.
// Ein laufender Aufruf darf den Deckel um seinen eigenen Verbrauch überschreiten.
const DEFAULT_TOKEN_BUDGET = 500000;
const usage = { tokens: 0, calls: 0 };

function settings(env) {
  const e = env || process.env;
  return {
    source: (e.MISSION_SOURCE || 'fallback').toLowerCase() === 'bridge' ? 'bridge' : 'fallback',
    url: (e.CLAUDE_BRIDGE_URL || 'http://localhost:5505').replace(/\/+$/, ''),
    token: e.CLAUDE_BRIDGE_TOKEN || '',
    budget: String(Number(e.CLAUDE_MAX_BUDGET_USD) > 0 ? Number(e.CLAUDE_MAX_BUDGET_USD) : 0.30),
    tokenBudget: Number(e.CLAUDE_TOKEN_BUDGET) > 0 ? Number(e.CLAUDE_TOKEN_BUDGET) : DEFAULT_TOKEN_BUDGET,
  };
}

// Summe aller Token-Felder aus dem usage-Block der CLI-Antwort (fehlende Felder zählen 0).
function tokensFromCli(cli) {
  const u = (cli && cli.usage) || {};
  return ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .reduce((sum, k) => sum + (Number(u[k]) || 0), 0);
}

function recordUsage(body, log) {
  try {
    const n = tokensFromCli(JSON.parse(body.stdout));
    usage.tokens += n; usage.calls++;
    log('Teaser: Claude-Aufruf ' + usage.calls + ' verbrauchte ' + n + ' Tokens, gesamt ' + usage.tokens + '.');
  } catch (e) { /* unlesbare Antwort: parseBridgeResponse meldet den Fehler */ }
}

// Beste Übereinstimmung: jede erfüllte Anforderung +2, jede verletzte -3; bekannte, aber offene Flags zählen 0.
function pickFallback(flags) {
  let best = null, bestScore = -Infinity;
  for (const m of FALLBACK) {
    let score = 0;
    for (const [k, v] of Object.entries(m.requires || {})) {
      const have = flags[k];
      if (have === null || have === undefined) continue;
      score += have === v ? 2 : -3;
    }
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return { source: 'archiv', title: best.title, from: best.from, briefing: best.briefing, reward: best.reward, hook: best.hook };
}

function buildPrompt(flags) {
  const lines = [
    'Du schreibst für das gemütliche Koop-Raumschiffspiel „Sternenschicht“ einen kurzen Auftrags-Funkspruch (Teaser) auf Deutsch.',
    'Setting: der Saumraum, ein dünn besiedelter Grenzraum. Das Konkordat der Häfen (Handelsbund, bürokratisch, meist fair).',
    'Die Rostmeute (Piratenbande, Anführer Grauzahn, laut, aber mit Ehrenkodex). Die Vaelen (verschwiegene Nomaden-Händler).',
    'Die Kustoden (verschwundene Erbauer uralter Bojen, Sonden und Drohnen; rätselhaft, nie direkt gesehen).',
    'Die Crew fliegt die KRS Lerche, ein kleines, heimeliges Frachtschiff. Ton: warm, leicht humorvoll, kein Grimdark, keine Gewalt-Details.',
    'Die Crew hat gerade die Mission „Die stumme Boje“ (Boje B-7, Datenkern geborgen) beendet. Was passiert ist:',
    `- Grauzahn: ${flags.bribed === true ? 'die Crew hat Wegezoll gezahlt (bestochen)' : flags.bribed === false ? 'die Crew hat gekämpft und gewonnen' : 'unbekannt'}.`,
    `- Datenkern: ${flags.decision === 'deliver' ? 'ans Konkordat abgeliefert' : flags.decision === 'decode' ? 'selbst entschlüsselt (Spur zu den Kustoden)' : 'Entscheidung steht noch aus – der Auftrag soll zu beiden Varianten passen'}.`,
    `- Techniker Ivo von der Boje: ${flags.technikerRescued ? 'gerettet' : 'nicht gerettet (bisher)'}.`,
    'Bitte schlage EINE Folgemission vor, die an diese Ereignisse anknüpft. Felder: title (≤ 60 Zeichen), from (Absender, ≤ 40),',
    'briefing (≤ 500 Zeichen, 2–4 Sätze, als Funkspruch an die Crew), reward (ganze Zahl 50–500 Marken), hook (≤ 200, ein neugierig machender Satz).',
    'Keine Namen echter Personen, keine bekannten Marken oder fremden Spielwelten. Antworte nur mit dem JSON-Objekt.',
  ];
  return lines.join('\n');
}

function parseBridgeResponse(body) {
  if (!body || typeof body.stdout !== 'string') throw new Error('Bridge-Antwort ohne stdout');
  if (body.exitCode !== 0 && body.exitCode !== undefined) throw new Error('Bridge exitCode ' + body.exitCode);
  const cli = JSON.parse(body.stdout);
  let out = cli.structured_output;
  if (!out && typeof cli.result === 'string') {
    const txt = cli.result.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    out = JSON.parse(txt);
  }
  if (!out) throw new Error('keine strukturierte Ausgabe');
  const res = Schema.clamp(Schema.MISSION_SCHEMA, out);
  if (!res.ok) throw new Error('Schema: ' + res.errors.join(', '));
  return res.value;
}

async function callBridge(flags, cfg, log) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS + 5000);
  try {
    const res = await fetch(cfg.url + '/v1/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
      body: JSON.stringify({
        args: ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(Schema.MISSION_SCHEMA), '--model', 'sonnet',
          '--no-session-persistence', '--max-budget-usd', cfg.budget],
        prompt: buildPrompt(flags),
        timeoutMs: TIMEOUT_MS,
      }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json();
    recordUsage(body, log);
    const value = parseBridgeResponse(body);
    return Object.assign({ source: 'claude' }, value);
  } finally { clearTimeout(timer); }
}

// Liefert immer ein Ergebnis (nie reject). opts: { env, log, bridgeImpl }
function generate(flags, opts) {
  const o = opts || {};
  const log = o.log || (() => {});
  const cfg = settings(o.env);
  if (cfg.source !== 'bridge') return Promise.resolve(pickFallback(flags));
  if (!cfg.token) { log('Teaser: MISSION_SOURCE=bridge, aber kein CLAUDE_BRIDGE_TOKEN – nutze Archiv.'); return Promise.resolve(pickFallback(flags)); }
  if (inFlight) return inFlight;
  if (usage.tokens >= cfg.tokenBudget) {
    log('Teaser: Token-Deckel erreicht (' + usage.tokens + ' / ' + cfg.tokenBudget + ') – nutze Archiv.');
    return Promise.resolve(pickFallback(flags));
  }
  const impl = o.bridgeImpl || callBridge;
  inFlight = impl(flags, cfg, log)
    .catch((err) => { log('Teaser: Bridge fehlgeschlagen (' + (err && err.name === 'AbortError' ? 'Timeout' : (err && err.message)) + ') – nutze Archiv.'); return pickFallback(flags); })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function getTokenUsage() { return { tokens: usage.tokens, calls: usage.calls }; }
function resetTokenUsage() { usage.tokens = 0; usage.calls = 0; }

module.exports = { generate, pickFallback, buildPrompt, parseBridgeResponse, settings, tokensFromCli, getTokenUsage, resetTokenUsage, FALLBACK };
