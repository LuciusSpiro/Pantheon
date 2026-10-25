'use strict';
// SUND-03b T: Mess- und Prüfwerkzeug für die Live-Texte (Pool, Gemma auf Sleipnir). Lässt je Textart mehrere Läufe gegen den Ollama-Transport laufen und prüft jede Antwort mit dem Prüfer der Texte
// (server/sim/texte-pruefer.js, Daten content/texte/texte-werte.json). Gezählt wird nur der ERSTE Versuch („gültig beim 1. Versuch“); ungültige bekommen genau den Wiederholungsversuch des Pools (mit den
// Fehlern des Prüfers im Prompt), das Ergebnis steht getrennt. Nichts außer dem Prompt verlässt den Rechner; der Prompt enthält nie Spielernamen (er wird nur aus Daten gebaut). Claude kommt nie vor.
//
//   node tools/messe-texte-ollama.js [--funk 50] [--reaktion 40] [--verlust 30] [--soeldner 10] [--antwort 20] [--url …] [--model …] [--timeout 60] [--ausgabe <Datei.md>] [--json]
//   node tools/messe-texte-ollama.js --selbsttest        (Fake-Server auf 127.0.0.1, kein Netz; in npm test)
//
// Ausgabe: Healthcheck, je Textart und gesamt: gültig beim 1. Versuch (Wilson-95-%-Intervall), nach einem Wiederholungsversuch, Dauer Median/p90/max, Fehlerarten. Dazu 15 Beispiele (je 5 Funk,
// NSC-Reaktion, Verlustspruch) als Markdown für das Stilurteil (Standard tools/ausgabe/texte-beispiele.md). Läuft Sleipnir nicht, steht „nicht gelaufen“ und es wird nichts geschrieben.
// Zugang: ssh -N -L 11435:127.0.0.1:11434 sleipnir  (OLLAMA_URL, OLLAMA_MODEL wie im Spiel).
const fs = require('fs');
const os = require('os');
const path = require('path');
const LLM = require('../server/mission/llm.js');
const Router = require('../server/mission/transport-router.js');
const Ollama = require('../server/mission/transport-ollama.js');
const Pool = require('../server/sim/texte-pool.js');
const Pruefer = require('../server/sim/texte-pruefer.js');

const W = Pruefer.WERTE;
const args = process.argv.slice(2);
const opt = (name, std) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : std; };
const flag = (name) => args.includes('--' + name);

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const perzentil = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const sek = (x) => (x === null || x === undefined ? '–' : x.toFixed(1) + ' s');
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.959964, p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const anteil = (k, n) => { const [a, b] = wilson(k, n); return `${k} von ${n} (${n ? Math.round((100 * k) / n) : 0} %, Wilson 95 %: ${Math.round(100 * a)}–${Math.round(100 * b)} %)`; };

// ---------- Messfälle (je Textart eine Liste von Specs, wie sie der Pool benutzt)
const katalog = () => Pool.katalogSpecs();
function fallListen() {
  const alle = katalog();
  const bsp = W.messbeispiele.reaktion;
  return {
    funk: alle.filter((s) => s.art === 'reise' && ['ankuendigung', 'eintreffen'].includes(s.slot)),
    reaktion: bsp.map((b) => ({ art: 'npc', id: b.id, slot: 'reaktion', optionId: '', sprecher: b.sprecher, stimme: b.stimme, fakt: b.fakt, antwort: b.antwort, beispiele: [], platzhalter: [], pflicht: [], muss: [], nicht: [] })),
    verlust: alle.filter((s) => s.slot === 'verlust'),
    soeldner: alle.filter((s) => s.slot === 'soeldner'),
    antwort: bsp.map((b) => ({ art: 'npc', id: b.id, slot: 'antwort', optionId: 'o1', sprecher: b.sprecher, stimme: b.stimme, fakt: b.fakt + ' Die Crew darf jetzt antworten.', option: b.absicht, beispiele: [], platzhalter: [], pflicht: [], muss: [], nicht: [] })),
  };
}
const TITEL = { funk: 'Funk (Reise-Ankündigung und Eintreffen)', reaktion: 'NSC-Reaktion (Slot reaktion, Beispiel-Antworten)', verlust: 'Verlustspruch (Hafen gefallen, Posten verloren)', soeldner: 'Söldner-Funk des Konkordats', antwort: 'Antwortoption (Slot antwort, höchstens 40 Zeichen)' };

// Ein Lauf: erster Versuch, bei ungültig ein Wiederholungsversuch mit den Fehlern des Prüfers (wie im Pool). Wirft nie.
async function lauf(llm, spec) {
  const r = { id: spec.id, slot: spec.slot, spec, ok1: false, ok2: null, sec: null, tokens: 0, text: null, fehler: [], ausfall: null };
  try {
    const v1 = await Pool.versuch(llm, spec, { vorhanden: [], namen: [] });
    r.sec = v1.r.sec == null ? null : v1.r.sec; r.tokens = v1.r.tokens || 0; r.text = v1.p.text; r.ok1 = v1.p.ok; r.fehler = v1.p.fehler;
    if (!v1.p.ok) {
      const v2 = await Pool.versuch(llm, spec, { vorhanden: [], namen: [], vorher: { antwort: v1.r.text, fehler: v1.p.fehler } });
      r.ok2 = v2.p.ok; r.text2 = v2.p.text; r.fehler2 = v2.p.fehler;
    }
  } catch (e) { r.ausfall = (e.code || 'FEHLER') + ': ' + String(e.message).slice(0, 120); }
  return r;
}

async function messe(o) {
  const transport = Ollama.create({ url: o.url, model: o.model });
  const h = await Ollama.gesund({ url: o.url });
  console.log(`Healthcheck ${h.url}: ${h.ok ? 'ok, Ollama ' + (h.version || '?') : 'NICHT erreichbar (' + h.fehler + ')'}   Modell: ${o.model || transport.model}`);
  if (!h.ok) { console.log('Messung nicht gelaufen: Sleipnir nicht erreichbar (ssh -N -L 11435:127.0.0.1:11434 sleipnir starten).'); return { ok: false, gesund: h }; }
  const env = { OLLAMA_URL: o.url || process.env.OLLAMA_URL, OLLAMA_MODEL: o.model || process.env.OLLAMA_MODEL };
  for (const k of Object.keys(env)) if (!env[k]) delete env[k];
  const alt = process.env.LLM_LIVE; process.env.LLM_LIVE = '1';   // nur in diesem Werkzeug: live ohne Claude (Router: text nur Ollama, keine Eskalation)
  const llm = LLM.create({ mode: 'live', transport: Router.routeTransport({ text: { anbieter: 'ollama', modell: o.model } }, { eskalation: null, env }) });
  const listen = fallListen(), erg = {};
  try {
    for (const g of Object.keys(TITEL)) {
      const n = o.n[g]; erg[g] = [];
      for (let i = 0; i < n; i++) {
        const sp = listen[g][i % listen[g].length];
        const r = await lauf(llm, sp);
        erg[g].push(r);
        if (r.ausfall) console.log(`  ✗ ${g} ${sp.id}/${sp.slot}  AUSFALL ${r.ausfall}`);
        else if (flag('lang')) console.log(`  ${r.ok1 ? '✓' : '✗'} ${g} ${sp.id}/${sp.slot}  ${sek(r.sec)}  ${r.ok1 ? r.text : r.fehler.join('; ')}`);
      }
    }
  } finally { if (alt === undefined) delete process.env.LLM_LIVE; else process.env.LLM_LIVE = alt; }
  return Object.assign(auswerten(erg), { ok: true, modell: o.model || transport.model, url: h.url, version: h.version, ergebnisse: erg });
}

function zusammen(liste) {
  const n = liste.length, ok1 = liste.filter((r) => r.ok1).length, ok2 = liste.filter((r) => !r.ok1 && r.ok2).length, ausfall = liste.filter((r) => r.ausfall).length;
  const secs = liste.map((r) => r.sec).filter((s) => s !== null);
  const arten = {};
  for (const r of liste) for (const f of r.fehler || []) { const k = f.replace(/„[^“]*“/g, '„…“').replace(/\([^)]*\)/g, '(…)').replace(/\{\w+\}/g, '{…}'); arten[k] = (arten[k] || 0) + 1; }
  return { n, ok1, ok2, ausfall, median: median(secs), p90: perzentil(secs, 0.9), max: secs.length ? Math.max(...secs) : null, arten, wilson: wilson(ok1, n), tokens: liste.reduce((s, r) => s + r.tokens, 0) };
}
function auswerten(erg) {
  const je = {}, alle = [];
  for (const g of Object.keys(erg)) { je[g] = zusammen(erg[g]); alle.push(...erg[g]); }
  const gesamt = zusammen(alle);
  console.log('\nErgebnis (gültig beim 1. Versuch = Prüfer lässt die erste Antwort durch):');
  for (const g of Object.keys(je)) {
    const z = je[g];
    console.log(`  ${TITEL[g].padEnd(52)} ${anteil(z.ok1, z.n)}; mit 1 Wiederholung +${z.ok2}; Dauer Median ${sek(z.median)}, p90 ${sek(z.p90)}, max ${sek(z.max)}${z.ausfall ? `; Ausfälle ${z.ausfall}` : ''}`);
  }
  console.log(`  ${'gesamt'.padEnd(52)} ${anteil(gesamt.ok1, gesamt.n)}; mit 1 Wiederholung +${gesamt.ok2} (ungültig nach 2 Versuchen: ${gesamt.n - gesamt.ok1 - gesamt.ok2 - gesamt.ausfall}); Dauer Median ${sek(gesamt.median)}, p90 ${sek(gesamt.p90)}, max ${sek(gesamt.max)}`);
  const arten = Object.entries(gesamt.arten).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  Fehlerarten (1. Versuch): ${arten.length ? arten.map(([k, v]) => `${k} ×${v}`).join('; ') : '–'}`);
  return { je, gesamt };
}

// ---------- 15 Beispiele als Markdown (je 5 Funk, NSC-Reaktion, Verlustspruch): gültige zuerst, verschiedene Einträge
function beispiele(erg, n) {
  const wahl = (g) => {
    const liste = erg[g] || [], ids = new Set(), out = [];
    const gueltig = liste.filter((r) => r.ok1 || r.ok2);
    const reihe = gueltig.concat(liste.filter((r) => !(r.ok1 || r.ok2) && !r.ausfall));
    for (let pass = 0; pass < 2 && out.length < n; pass++) for (const r of reihe) { if (out.length >= n) break; const k = r.id + '/' + r.slot; if (!pass && ids.has(k)) continue; if (out.includes(r)) continue; ids.add(k); out.push(r); }
    return out;
  };
  return { funk: wahl('funk'), reaktion: wahl('reaktion'), verlust: wahl('verlust') };
}
function markdown(m, bsp) {
  const L = [];
  const heute = new Date().toISOString().slice(0, 10);
  L.push('---', 'title: Live-Texte von Gemma, 15 Beispiele (SUND-03b T)', `updated: ${heute}`, 'tags: [pantheon, sund-03b, texte, stilurteil]', '---', '', '# Live-Texte von Gemma: 15 Beispiele für Kais Stilurteil', '');
  L.push(`Erzeugt mit \`tools/messe-texte-ollama.js\` am ${heute}, Modell \`${m.modell}\` auf Sleipnir (Ollama ${m.version || '?'}), \`think:false\`, \`format\` = kleines JSON-Schema, Systemprompt \`content/spielleiter/prompts/text.system.md\`. Jeder Text hat den Prüfer der Texte beim jeweils genannten Versuch bestanden (Länge, Platzhalter, keine Ziffern, kein Ausweich-Versprechen, keine fremde Stimme). \`{ort}\` und \`{n}\` setzt das Spiel beim Verbrauch ein. **Das Stilurteil fehlt noch: bitte lesen.**`, '');
  L.push(`Messung (${m.gesamt.n} Läufe): gültig beim 1. Versuch ${anteil(m.gesamt.ok1, m.gesamt.n)}, Dauer Median ${sek(m.gesamt.median)}, p90 ${sek(m.gesamt.p90)}.`, '');
  const kopf = { funk: 'Funk (Reise-Ankündigung und Eintreffen)', reaktion: 'NSC-Reaktion', verlust: 'Verlustspruch' };
  let nr = 0;
  for (const g of ['funk', 'reaktion', 'verlust']) {
    L.push(`## ${kopf[g]}`, '');
    for (const r of bsp[g]) {
      nr++;
      const s = r.spec;
      L.push(`### ${nr}. ${s.id} (${s.slot}${s.sprecher ? ', ' + s.sprecher : ''}, Stimme ${W.stimmen[s.stimme].name})`, '');
      L.push(`- **Lage:** ${String(s.fakt).replace(/\s+/g, ' ')}`);
      if (s.antwort) L.push(`- **Antwort der Spieler:** „${s.antwort}“`);
      const text = r.ok1 ? r.text : (r.ok2 ? r.text2 : r.text);
      L.push(`- **Gemma** (${r.ok1 ? '1. Versuch gültig' : r.ok2 ? '2. Versuch gültig' : 'UNGÜLTIG: ' + (r.fehler || []).join('; ')}): ${text}`);
      if (g === 'funk' && s.beispiele && s.beispiele.length) L.push(`- **Katalogtext zum Vergleich:** ${s.beispiele[0]}`);
      L.push('');
    }
  }
  return L.join('\n');
}
function schreibeBeispiele(m, datei) {
  const erg = m.ergebnisse;
  const bsp = beispiele(erg, 5);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, markdown(m, bsp).replace(/\r?\n/g, '\n'), 'utf8');
  return { datei, anzahl: bsp.funk.length + bsp.reaktion.length + bsp.verlust.length };
}

// ---------- Selbsttest mit Fake-Server ----------
async function selbsttest() {
  const H = require('./transport-testhilfe.js');
  let nr = 0;
  const srv = await H.fakeOllama((req, res, body) => {
    if (req.url === '/api/version') return H.antwort(res, 200, { version: 'fake-1' });
    const user = body.messages[body.messages.length - 1].content;
    const pf = /im Text müssen vorkommen: ([^.]*)\./.exec(user);
    const pflicht = pf ? pf[1].split(',').map((x) => x.trim()).join(' ') : '';
    const slot = /Textart: (\w+)/.exec(user)[1];
    const kurz = slot === 'antwort';
    nr++;
    const wort = (/Der (Hafen|Posten) /.exec(user) || [null, ''])[1];
    let text = kurz ? 'Wir bleiben und halten Wort' : `Hier spricht der Funker, es wird ernst, haltet die Augen offen und seid bereit ${wort} ${pflicht}.`;
    if (nr % 5 === 0 && !user.includes('<deine_antwort>')) text = 'Ihr könnt jederzeit ausweichen, springt einfach weg!';   // jede fünfte erste Antwort ungültig, die Wiederholung gelingt
    H.antwort(res, 200, { model: body.model, message: { role: 'assistant', content: JSON.stringify({ text }) }, done: true, prompt_eval_count: 100, eval_count: 20 });
  });
  const log = console.log; const aus = [];
  console.log = (...a) => { aus.push(a.join(' ')); };
  let m;
  try { m = await messe({ n: { funk: 10, reaktion: 5, verlust: 5, soeldner: 2, antwort: 5 }, url: srv.url, model: 'fake:1b', timeoutMs: 20000 }); } finally { console.log = log; }
  const fehler = [];
  if (!m.ok) fehler.push('Healthcheck fehlgeschlagen');
  else {
    if (m.gesamt.n !== 27) fehler.push(`${m.gesamt.n} Läufe statt 27`);
    if (m.gesamt.ausfall) fehler.push('Ausfälle im Selbsttest');
    if (m.gesamt.ok1 < 20 || m.gesamt.ok1 > 24) fehler.push(`gültig beim 1. Versuch ${m.gesamt.ok1} statt etwa 22`);
    if (m.gesamt.ok1 + m.gesamt.ok2 !== 27) fehler.push(`nach Wiederholung ${m.gesamt.ok1 + m.gesamt.ok2} statt 27`);
    if (m.gesamt.median === null) fehler.push('keine Dauer gemessen');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-texte-'));
    const w = schreibeBeispiele(m, path.join(tmp, 'beispiele.md'));
    const md = fs.readFileSync(w.datei, 'utf8');
    if (w.anzahl !== 15) fehler.push(`${w.anzahl} Beispiele statt 15`);
    if ((md.match(/^### \d+\./gm) || []).length !== 15 || !/## Funk/.test(md) || !/## NSC-Reaktion/.test(md) || !/## Verlustspruch/.test(md)) fehler.push('Markdown unvollständig');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }
  }
  const posts = srv.requests.filter((q) => q.method === 'POST');
  if (!posts.length || !posts.every((q) => q.body.think === false && q.body.format && q.body.format.properties && q.body.format.properties.text && q.body.model === 'fake:1b')) fehler.push('Anfragen: think:false/format/Modell fehlen');
  if (!posts.every((q) => q.body.messages[0].role === 'system' && /Genau ein JSON-Objekt/.test(q.body.messages[0].content))) fehler.push('Systemprompt der Texte fehlt');
  if (!aus.some((l) => /Healthcheck .*ok, Ollama fake-1/.test(l)) || !aus.some((l) => /gültig beim 1\. Versuch|gesamt/.test(l))) fehler.push('Ausgabe unvollständig');
  await srv.close();
  console.log(fehler.length ? `Selbsttest FEHLER: ${fehler.join('; ')}` : `Selbsttest ok (Fake-Ollama, ${m.gesamt.n} Läufe, ${m.gesamt.ok1} im 1. Versuch gültig, Median ${sek(m.gesamt.median)}, 15 Beispiele geschrieben)`);
  process.exit(fehler.length ? 1 : 0);
}

if (require.main === module) {
  if (flag('selbsttest')) selbsttest().catch((e) => { console.log('Selbsttest FEHLER: Ausnahme ' + (e && e.stack)); process.exit(1); });
  else {
    const n = { funk: Number(opt('funk', 50)), reaktion: Number(opt('reaktion', 40)), verlust: Number(opt('verlust', 30)), soeldner: Number(opt('soeldner', 10)), antwort: Number(opt('antwort', 20)) };
    messe({ n, url: opt('url'), model: opt('model'), timeoutMs: Number(opt('timeout', 60)) * 1000 })
      .then((m) => {
        if (m.ok) { const w = schreibeBeispiele(m, path.resolve(opt('ausgabe', path.join(__dirname, 'ausgabe', 'texte-beispiele.md')))); console.log(`\n${w.anzahl} Beispiele geschrieben: ${w.datei}`); }
        if (flag('json')) console.log(JSON.stringify({ je: m.je, gesamt: m.gesamt }, null, 1));
        process.exit(m.ok ? 0 : 1);
      }, (e) => { console.log('Fehler: ' + (e && e.stack)); process.exit(1); });
  }
}
module.exports = { messe, lauf, fallListen, beispiele, markdown, wilson };
