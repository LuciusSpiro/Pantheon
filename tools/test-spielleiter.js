'use strict';
// Spielleiter-Tests ohne LLM (CONTRACT-S1 §8.3, CONTRACT-S2 §8) – npm run test:spielleiter. Kein Netz, keine LLM-Aufrufe.
//
//   0. Schnittstelle: server/mission/llm.js – off wirft, live ohne LLM_LIVE=1 wirft, replay ohne Aufzeichnung wirft
//      mit Hinweis auf --record (kein Live-Fallback), Schlüssel stabil gegen Schlüsselreihenfolge, Modus script, ein Zähler
//   1. Prüfer: m1–m3 gültig; kaputte Bücher aus tools/fixtures/regiebuecher-kaputt/ liefern ihren Code mit Begründung
//   2. Kontext: tools/fixtures/context/*.weltstand.json -> Context.build == *.context.json (Golden), deterministisch,
//      keine Spielernamen
//   3. Replay: Aufzeichnungen tools/fixtures/llm/<kind>/*.json (aus dem Trockenversuch) -> Grobplan-Prüfung bzw.
//      katalog.instantiate + Prüfer -> erwartetes Ergebnis (Feld 'erwartet' in der Aufzeichnung)
//   4. Mock: Weltstand -> Kontext -> mock-Grobplan -> Grobplan-Prüfung -> mock-Szenen -> Regiebuch-Prüfer, ohne Fehler
//   5. Registry: jedes do/check in content/regiebuecher/* steht in Registry.describe()
//   S2:
//   6. Szenenbau: Einheitentests (Folgen, S2-Regeln, Rohfassung, Anflug, umsetzung, liefert_flags, neu:-Stimmen)
//   7. Pipeline (Modus script, Test-Engine): missionDone → planning → offered → accept → Szenen ersetzt → betretene Szene
//      bleibt → sceneWait ≤ 20 s → missionDone → neue Runde; toSave/restore
//   8. Rückfälle: Timeout, Müll-JSON, zweimal ungültig, Budget leer, CLI fehlt, 429 → Archiv/Mock, keine Ausnahme
//   9. Echte Engine (wenn ENGINE registerBook liefert): Angebote nach „ohne Tutorial“, Annehmen, Skip-Lauf bis missionDone,
//      Speichern/Laden mitten in einer erzeugten Mission (wenn Weltstand v2)
//  10. Archiv: Lader + jedes Archiv-Buch besteht den Prüfer; Skip-Lauf je Archiv-Buch (echte Engine)
//  11. Replay-Regression: Buch-Hash aus den Aufzeichnungen stabil (tools/fixtures/llm/buch-hashes.json)
//
// Fehlt ein Baustein eines anderen Teams (Prüfer-Fixtures, Registry, Bücher, registerBook), wird der Teil als
// „übersprungen“ gemeldet, nicht als grün. Aufruf: node tools/test-spielleiter.js [--update] [--strict] [--verbose]
//   --update  schreibt Kontext-Goldens, 'erwartet' in den Aufzeichnungen und die Buch-Hashes neu (nur bewusst!)
//   --strict  übersprungene Teile zählen als Fehler (für die Integration, wenn alle Teile da sein müssen)

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const LLM = require('../server/mission/llm.js');
const Context = require('../server/mission/context.js');
const SB = require('../server/mission/szenenbau.js');
const Archiv = require('../server/mission/archiv.js');
const Regielog = require('../server/mission/regielog.js');

// ---------- Module der anderen Teams (defensiv) ----------
function tryRequire(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return { mod: null, why: `${rel} fehlt` };
  try { return { mod: require(file) }; } catch (e) { return { mod: null, why: `${rel} lädt nicht: ${e.message.split('\n')[0]}` }; }
}
function resolveChecker() {
  const c = tryRequire('server/mission/checker.js');
  if (c.mod && typeof c.mod.check === 'function') return { check: c.mod.check, src: 'server/mission/checker.js' };
  const old = require('./check-missions.js');
  return { check: old.check, src: 'tools/check-missions.js' + (c.why ? ` (${c.why})` : '') };
}
const CHECKER = resolveChecker();
const Katalog = require('./katalog.js');

// Prüfer-Ergebnis vereinheitlichen: { errors, warnings }
function checkBook(book) {
  const r = CHECKER.check(book) || {};
  return { errors: r.errors || [], warnings: r.warnings || [] };
}
// Altnamen (S1): die Helfer leben seit S2 in server/mission/szenenbau.js
const { buildEnv, checkGrobplan, assembleScene, sceneTestBook, evaluateScene, evaluateGrobplan, parseJsonAnswer } = SB;

// Anlässe der Kontext-Fixtures (gehören zum Golden; Änderung = bewusst --update)
const ANLASS = {
  'frisch': { art: 'kampagnenstart', tutorial: true, crew: 1 },
  'nach-m1': { art: 'missionsgrenze', nach: 'm1', crew: 3 },
  'mitten-m2': { art: 'angedockt', mission: 'm2', schritt: 'vaelen', crew: 2 },
  'ohne-tutorial': { art: 'kampagnenstart', tutorial: false, crew: 1 },
  'nach-tutorial': { art: 'missionsgrenze', nach: 'm3', crew: 3, zielspieldauer_min: 12, auftraggeber: 'tesk' },
};

const flush = () => new Promise((r) => setImmediate(r));
const sha1 = (o) => crypto.createHash('sha1').update(LLM.canonical(o)).digest('hex');
let TMP = null;
function tmpDir(name) {
  if (!TMP) TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sl-'));
  const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d;
}

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const UPDATE = args.includes('--update'); const STRICT = args.includes('--strict'); const VERBOSE = args.includes('--verbose');
  const t0 = Date.now();
  const results = [];
  const add = (teil, name, status, detail) => { results.push({ teil, name, status, detail }); };
  const ok = (teil, name, detail) => add(teil, name, 'ok', detail);
  const bad = (teil, name, detail) => add(teil, name, 'fehler', detail);
  const skip = (teil, name, detail) => add(teil, name, 'übersprungen', detail);
  const safe = async (teil, name, fn) => { try { await fn(); } catch (e) { bad(teil, name, 'Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } };
  const check = (teil, name, cond, detail) => (cond ? ok : bad)(teil, name, detail);

  const katalog = Katalog.load({});
  const env = buildEnv(katalog);
  if (katalog.fehler.length) bad('0', 'Katalog lädt fehlerfrei', katalog.fehler.map((f) => `${f.datei}: ${f.msg}`).join(' | '));

  // ---------- 0. Schnittstelle ----------
  const T0 = '0 Schnittstelle';
  await safe(T0, 'off wirft verständlich', async () => {
    try { await LLM.create({ mode: 'off' }).ask('grobplan', {}); bad(T0, 'off wirft verständlich', 'kein Fehler'); } catch (e) { (/SPIELLEITER_LLM/.test(e.message) ? ok : bad)(T0, 'off wirft verständlich', e.message); }
  });
  await safe(T0, 'Standardmodus ohne SPIELLEITER_LLM = off', async () => {
    const saved = process.env.SPIELLEITER_LLM; delete process.env.SPIELLEITER_LLM;
    try { const m = LLM.create({}).mode; (m === 'off' ? ok : bad)(T0, 'Standardmodus ohne SPIELLEITER_LLM = off', m); } finally { if (saved !== undefined) process.env.SPIELLEITER_LLM = saved; }
  });
  await safe(T0, 'live ohne LLM_LIVE=1 verweigert', async () => {
    const saved = process.env.LLM_LIVE; delete process.env.LLM_LIVE;
    try { await LLM.create({ mode: 'live' }).ask('grobplan', { x: 1 }); bad(T0, 'live ohne LLM_LIVE=1 verweigert', 'kein Fehler'); } catch (e) { (/LLM_LIVE=1/.test(e.message) ? ok : bad)(T0, 'live ohne LLM_LIVE=1 verweigert', e.message); } finally { if (saved !== undefined) process.env.LLM_LIVE = saved; }
  });
  await safe(T0, 'replay ohne Aufzeichnung: Hinweis auf --record', async () => {
    try { await LLM.create({ mode: 'replay' }).ask('szene', { gibt: 'es nicht' }); bad(T0, 'replay ohne Aufzeichnung: Hinweis auf --record', 'kein Fehler'); } catch (e) { (/npm run test:llm -- --record/.test(e.message) ? ok : bad)(T0, 'replay ohne Aufzeichnung: Hinweis auf --record', e.message); }
  });
  await safe(T0, 'Schlüssel unabhängig von der Schlüsselreihenfolge', async () => {
    const k1 = LLM.key('grobplan', { b: 1, a: { y: [1, { d: 2, c: 3 }], x: 'ü' } });
    const k2 = LLM.key('grobplan', { a: { x: 'ü', y: [1, { c: 3, d: 2 }] }, b: 1 });
    const k3 = LLM.key('szene', { b: 1, a: { y: [1, { d: 2, c: 3 }], x: 'ü' } });
    (k1 === k2 && k1 !== k3 && /^[0-9a-f]{40}$/.test(k1) ? ok : bad)(T0, 'Schlüssel unabhängig von der Schlüsselreihenfolge', k1);
  });
  await safe(T0, 'script: Antworten, Fehler, hold/release, Prozess-Zähler', async () => {
    LLM.resetBudget();
    const llm = LLM.create({ mode: 'script', katalog, script: { grobplan: [{ text: '{"a":1}', tokens: 100 }, { error: 'timeout' }, { hold: true, json: { b: 2 }, tokens: 50 }] } });
    const r1 = await llm.ask('grobplan', { n: 1 });
    let e2 = null; try { await llm.ask('grobplan', { n: 2 }); } catch (e) { e2 = e; }
    const p3 = llm.ask('grobplan', { n: 3 }); let r3 = null; p3.then((x) => { r3 = x; });
    await flush(); const before = r3; llm.release(); await flush();
    const llm2 = LLM.create({ mode: 'script', katalog, script: [{ error: 'enoent' }] });
    let e4 = null; try { await llm2.ask('szene', {}); } catch (e) { e4 = e; }
    const b = LLM.budget();
    const fine = r1.text === '{"a":1}' && r1.source === 'script' && e2 && e2.code === 'ETIMEDOUT' && before === null && r3 && r3.text === '{"b":2}' && e4 && e4.code === 'ENOENT' && b.used === 150;
    check(T0, 'script: Antworten, Fehler, hold/release, Prozess-Zähler', fine, `Zähler ${b.used}, Fehlercodes ${e2 && e2.code}/${e4 && e4.code}`);
    // generator.js hängt am selben Zähler
    const gen = require('../server/mission/generator.js');
    check(T0, 'generator.js nutzt den Prozess-Zähler (Altname getTokenUsage)', gen.getTokenUsage().tokens === b.used, JSON.stringify(gen.getTokenUsage()));
    const r5 = await gen.generate({ bribed: false }, { env: { MISSION_SOURCE: 'bridge', CLAUDE_BRIDGE_TOKEN: 'x' } });
    check(T0, 'Teaser-Generator stillgelegt (ohne bridgeImpl nur Archiv)', r5.source === 'archiv', r5.source);
    LLM.resetBudget();
  });
  await safe(T0, 'Transport-Schnittstelle cli|api, Prompts aus content/spielleiter/prompts', async () => {
    let e = null; try { await LLM.TRANSPORTS.api.call('x', {}); } catch (x) { e = x; }
    const sysG = LLM.systemPromptFile('grobplan'); const sysS = LLM.systemPromptFile('szene');
    const p = LLM.buildPrompt({ katalog: 'K', grobplan: { id: 'g' }, variabel: [['szene', 'S']], schluss: 'Los.' });
    const order = p.indexOf('<katalog>') < p.indexOf('<grobplan>') && p.indexOf('<grobplan>') < p.indexOf('<szene>');
    check(T0, 'Transport-Schnittstelle cli|api, Prompts aus content/spielleiter/prompts', !!e && typeof LLM.TRANSPORTS.cli.call === 'function' && /content[\\/]spielleiter[\\/]prompts/.test(sysG) && /content[\\/]spielleiter[\\/]prompts/.test(sysS) && order,
      `api: ${e && e.message}; Reihenfolge Katalog→Grobplan→variabel: ${order}`);
  });

  // ---------- 1. Prüfer ----------
  const T1 = '1 Prüfer';
  for (const id of ['m1', 'm2', 'm3']) {
    const file = path.join(ROOT, 'content', 'regiebuecher', `${id}.regiebuch.json`);
    if (!fs.existsSync(file)) { skip(T1, `${id} gültig`, `content/regiebuecher/${id}.regiebuch.json fehlt noch (DATEN)`); continue; }
    await safe(T1, `${id} gültig`, () => {
      const r = checkBook(JSON.parse(fs.readFileSync(file, 'utf8')));
      (r.errors.length ? bad : ok)(T1, `${id} gültig`, r.errors.length ? r.errors.map((e) => `${e.code} ${e.p}: ${e.msg}`).join(' | ') : `0 Fehler, ${r.warnings.length} Warnungen`);
    });
  }
  const KAPUTT = path.join(FIX, 'regiebuecher-kaputt');
  const erwFile = path.join(KAPUTT, 'erwartet.json');
  if (!fs.existsSync(erwFile)) skip(T1, 'kaputte Regiebücher', 'tools/fixtures/regiebuecher-kaputt/erwartet.json fehlt noch (DATEN)');
  else await safe(T1, 'kaputte Regiebücher', () => {
    const erw = JSON.parse(fs.readFileSync(erwFile, 'utf8'));
    const cases = normalizeExpected(erw);
    if (!cases.length) { bad(T1, 'kaputte Regiebücher', 'erwartet.json hat ein unbekanntes Format'); return; }
    const files = fs.readdirSync(KAPUTT).filter((f) => f.endsWith('.json') && f !== 'erwartet.json');
    for (const c of cases) {
      const f = files.find((x) => x === c.datei || x === c.datei + '.json' || x.replace(/\.json$/, '') === c.datei.replace(/\.json$/, ''));
      const name = `kaputt: ${c.datei} → ${c.codes.join('+')}`;
      if (!f) { bad(T1, name, 'Datei fehlt'); continue; }
      let doc; try { doc = JSON.parse(fs.readFileSync(path.join(KAPUTT, f), 'utf8')); } catch (e) { bad(T1, name, 'kein gültiges JSON: ' + e.message); continue; }
      const r = checkBook(doc);
      const got = new Set(r.errors.map((e) => e.code));
      const missing = c.codes.filter((x) => !got.has(x));
      const noReason = r.errors.filter((e) => c.codes.includes(e.code) && !(e.msg && String(e.msg).trim()));
      const extra = [...got].filter((x) => !c.codes.includes(x));
      const hit = r.errors.find((e) => c.codes.includes(e.code));
      if (missing.length || noReason.length) bad(T1, name, `fehlt: ${missing.join(', ') || '–'}${noReason.length ? '; ohne Begründung: ' + noReason.map((e) => e.code).join(', ') : ''}; bekommen: ${[...got].join(', ') || 'keine Fehler'}`);
      else ok(T1, name, `${hit.msg}${extra.length ? ` (zusätzlich: ${extra.join(', ')})` : ''}`);
    }
    for (const f of files) if (!cases.some((c) => f === c.datei || f.replace(/\.json$/, '') === c.datei.replace(/\.json$/, ''))) bad(T1, `kaputt: ${f}`, 'in erwartet.json nicht aufgeführt');
  });

  // ---------- 2. Kontext ----------
  const T2 = '2 Kontext';
  const CTX = path.join(FIX, 'context');
  const worlds = fs.existsSync(CTX) ? fs.readdirSync(CTX).filter((f) => f.endsWith('.weltstand.json')).sort() : [];
  if (!worlds.length) bad(T2, 'Fixtures vorhanden', 'tools/fixtures/context/*.weltstand.json fehlen');
  const contexts = {}; const worldData = {};
  for (const wf of worlds) {
    const name = wf.replace('.weltstand.json', '');
    await safe(T2, name, () => {
      const w = JSON.parse(fs.readFileSync(path.join(CTX, wf), 'utf8'));
      worldData[name] = w;
      const anlass = ANLASS[name] || { art: 'test' };
      const c1 = Context.build(w, anlass, katalog);
      const c2 = Context.build(reverseKeys(w), reverseKeys(anlass), katalog);
      contexts[name] = c1;
      const s1 = JSON.stringify(c1);
      if (s1 !== JSON.stringify(c2)) { bad(T2, `${name}: deterministisch`, 'Ergebnis hängt von der Schlüsselreihenfolge ab'); return; }
      const inv = [];
      for (const n of c1.npc) if (n.gedaechtnis.length > Context.NPC_MEMORY) inv.push(`${n.id}: ${n.gedaechtnis.length} Gedächtniseinträge`);
      if (c1.chronik.length > Context.CHRONIK) inv.push(`chronik: ${c1.chronik.length}`);
      if (!isSorted(c1)) inv.push('Schlüssel nicht sortiert');
      // S2 Entscheidung 14: keine Spielernamen
      const names = ((w.meta && w.meta.spieler) || []).filter((x) => typeof x === 'string' && x.length > 2);
      const leaked = names.filter((nm) => s1.includes(JSON.stringify(nm)));
      if (c1.crew && c1.crew.spieler !== undefined) inv.push('crew.spieler gesetzt');
      if (leaked.length) inv.push(`Spielernamen im Kontext: ${leaked.join(', ')}`);
      if (inv.length) { bad(T2, `${name}: Grenzen`, inv.join(', ')); return; }
      const gf = path.join(CTX, `${name}.context.json`);
      if (UPDATE) { fs.writeFileSync(gf, JSON.stringify(c1, null, 2) + '\n', 'utf8'); ok(T2, `${name} == Golden`, `neu geschrieben (${s1.length} Zeichen)`); return; }
      if (!fs.existsSync(gf)) { bad(T2, `${name} == Golden`, `${name}.context.json fehlt – mit --update anlegen`); return; }
      const golden = JSON.parse(fs.readFileSync(gf, 'utf8'));
      if (JSON.stringify(golden) === s1) ok(T2, `${name} == Golden`, `${s1.length} Zeichen, ${c1.npc.length} NSC, Chronik ${c1.chronik.length}`);
      else bad(T2, `${name} == Golden`, `Abweichung in: ${Object.keys(Object.assign({}, golden, c1)).filter((k) => JSON.stringify(golden[k]) !== JSON.stringify(c1[k])).join(', ')} (bewusst? dann --update)`);
    });
  }

  // ---------- 3. Replay ----------
  const T3 = '3 Replay';
  const LLMFIX = path.join(FIX, 'llm');
  const replay = LLM.create({ mode: 'replay', fixturesDir: LLMFIX });
  let recCount = 0;
  for (const kind of LLM.KINDS) {
    const dir = path.join(LLMFIX, kind);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      recCount++;
      const file = path.join(dir, f);
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      const name = `${kind}: ${rec.name || f}`;
      await safe(T3, name, async () => {
        const k = LLM.key(kind, rec.input);
        if (k !== rec.key || f !== k + '.json') { bad(T3, name, `Schlüssel passt nicht zum input (Datei ${f}, gespeichert ${rec.key}, berechnet ${k})`); return; }
        const ans = await replay.ask(kind, rec.input);
        if (ans.source !== 'replay' || ans.key !== k) { bad(T3, name, 'Antwort nicht aus der Aufzeichnung'); return; }
        const res = kind === 'grobplan' ? evaluateGrobplan(ans.text, env) : evaluateScene(rec.input.grobplan, rec.input.szene, ans.text, env);
        const actual = { gueltig: res.gueltig, fehler: res.fehler };
        if (UPDATE) { rec.erwartet = actual; fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n', 'utf8'); ok(T3, name, `erwartet neu: ${res.gueltig ? 'gültig' : res.fehler.length + ' Fehler'}`); return; }
        if (!rec.erwartet) { bad(T3, name, "Feld 'erwartet' fehlt – mit --update anlegen"); return; }
        const same = JSON.stringify(actual) === JSON.stringify({ gueltig: rec.erwartet.gueltig, fehler: rec.erwartet.fehler });
        const what = res.gueltig ? 'gültig' : `ungültig wie erwartet (${res.fehler.length}: ${res.fehler.slice(0, 2).join(' | ')}${res.fehler.length > 2 ? ' …' : ''})`;
        (same ? ok : bad)(T3, name, same ? what : `erwartet ${JSON.stringify(rec.erwartet.fehler)}, bekommen ${JSON.stringify(res.fehler)}${VERBOSE ? ' – ' + res.details.join(' | ') : ''}`);
      });
    }
  }
  if (!recCount) bad(T3, 'Aufzeichnungen vorhanden', 'tools/fixtures/llm/<kind>/*.json fehlen');

  // ---------- 4. Mock ----------
  const T4 = '4 Mock';
  const mock = LLM.create({ mode: 'mock', katalog });
  for (const [name, ctx] of Object.entries(contexts)) {
    await safe(T4, `${name}: Weltstand → Kontext → Grobplan → Prüfer`, async () => {
      const input = { anlass: ctx.anlass, kontext: ctx };
      const a1 = await mock.ask('grobplan', input); const a2 = await mock.ask('grobplan', input);
      if (a1.text !== a2.text || a1.source !== 'mock') { bad(T4, `${name}: Weltstand → Kontext → Grobplan → Prüfer`, 'mock nicht deterministisch'); return; }
      const g = parseJsonAnswer(a1.text);
      const gf = checkGrobplan(g, env);
      if (gf.length) { bad(T4, `${name}: Weltstand → Kontext → Grobplan → Prüfer`, gf.join(' | ')); return; }
      const scenes = g.szenen.filter((s) => (s.molekuele || []).length);
      const errs = [];
      for (const s of scenes) {
        const sa = await mock.ask('szene', { grobplan: g, szene: s.id, kontext: ctx });
        const r = evaluateScene(g, s.id, sa.text, env);
        if (!r.gueltig) errs.push(`${s.id}: ${r.details.join(' | ')}`);
      }
      const book = SB.buildBook(g, {}, env, { id: 'sl_9_mock', kontext: ctx });
      if (book.errors.length) errs.push('Rohfassung: ' + book.errors.map((e) => `${e.code} ${e.p}: ${e.msg}`).join(' | '));
      (errs.length ? bad : ok)(T4, `${name}: Weltstand → Kontext → Grobplan → Prüfer`, errs.length ? errs.join(' || ') : `Grobplan '${g.titel}' (${g.szenen.length} Szenen, Auftraggeber ${g.auftraggeber}) + ${scenes.length} Szenen + Rohfassung gültig`);
    });
  }
  if (!Object.keys(contexts).length) skip(T4, 'Mock-Durchlauf', 'keine Kontexte aus Teil 2');

  // ---------- 5. Registry ----------
  const T5 = '5 Registry';
  const reg = tryRequire('server/mission/registry.js');
  if (!reg.mod || typeof reg.mod.describe !== 'function') skip(T5, 'do/check der Bücher in Registry.describe()', reg.why || 'server/mission/registry.js ohne describe() (ENGINE)');
  else await safe(T5, 'do/check der Bücher in Registry.describe()', () => {
    const desc = reg.mod.describe();
    const asJson = JSON.parse(JSON.stringify(desc));
    if (!Array.isArray(asJson) || !asJson.length) { bad(T5, 'Registry.describe() liefert Einträge', 'leer oder kein Array'); return; }
    const known = new Map(asJson.map((e) => [e.id, e]));
    const BOOKS = path.join(ROOT, 'content', 'regiebuecher');
    const books = fs.existsSync(BOOKS) ? fs.readdirSync(BOOKS).filter((f) => f.endsWith('.json')).sort() : [];
    if (!books.length) { skip(T5, 'do/check der Bücher in Registry.describe()', 'keine Bücher in content/regiebuecher'); return; }
    for (const f of books) {
      const used = collectBausteine(JSON.parse(fs.readFileSync(path.join(BOOKS, f), 'utf8')));
      const missing = [...used.do].filter((x) => !known.has(x)).map((x) => 'do ' + x).concat([...used.check].filter((x) => !known.has(x)).map((x) => 'check ' + x));
      const wrongArt = [...used.do].filter((x) => known.has(x) && known.get(x).art && known.get(x).art !== 'aktion').map((x) => `do ${x} ist ${known.get(x).art}`)
        .concat([...used.check].filter((x) => known.has(x) && known.get(x).art && known.get(x).art !== 'pruefung').map((x) => `check ${x} ist ${known.get(x).art}`));
      const all = missing.concat(wrongArt);
      (all.length ? bad : ok)(T5, `${f}: ${used.do.size} do, ${used.check.size} check registriert`, all.length ? all.join(', ') : `Registry kennt ${known.size} Bausteine`);
    }
  });

  // ---------- 6.–11. S2 ----------
  await s2Tests({ katalog, env, contexts, worldData, ok, bad, skip, safe, check, UPDATE, VERBOSE });

  // ---------- Ausgabe ----------
  const ms = Date.now() - t0;
  const parts = [...new Set(results.map((r) => r.teil))].sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
  for (const p of parts) {
    console.log(`\n${p}`);
    for (const r of results.filter((x) => x.teil === p)) console.log(`  ${r.status === 'ok' ? '✓' : r.status === 'fehler' ? '✗' : '–'} ${r.name}${r.detail && (r.status !== 'ok' || VERBOSE) ? `\n      ${r.detail}` : ''}${r.status === 'übersprungen' ? '  [übersprungen]' : ''}`);
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`\nPrüfer: ${CHECKER.src}`);
  console.log(`${n('ok')} ok, ${n('fehler')} Fehler, ${n('übersprungen')} übersprungen – ${ms} ms${UPDATE ? ' (--update: Goldens/erwartet/Hashes neu geschrieben)' : ''}`);
  if (n('übersprungen')) console.log(`NICHT vollständig grün: ${n('übersprungen')} Teil(e) übersprungen, weil Dateien anderer Teams fehlen${STRICT ? ' (--strict: zählt als Fehler)' : ''}.`);
  if (ms > 20000) console.log(`WARNUNG: Laufzeit ${ms} ms über dem Ziel von 20 s`);
  try { if (TMP) fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  process.exit(n('fehler') || (STRICT && n('übersprungen')) ? 1 : 0);
}

// =================================================================================================================
// S2-Tests
// =================================================================================================================
const Spielleiter = require('../server/mission/spielleiter.js');

// Test-Engine: das Nötigste von mission.js (registerBook/updateBook/startMission/step) – unabhängig von ENGINE
function fakeGame(opts) {
  const events = []; const errors = []; const notices = [];
  const g = {
    time: 0, C: require('../shared/config.js'), env: {}, players: [{ connected: true }, { connected: true }, { connected: true }],
    ship: { scene: 'hafen' },
    emit(k, d) { events.push({ k, d }); }, oda(t) { events.push({ k: 'oda', d: { text: t } }); }, notice(p, t) { notices.push(t); },
    countError(w, e) { errors.push(w + ': ' + (e && e.message)); }, log() {},
    weltstand: { id: 'w-test', persistent: true, data: null, npcMemory(n, e) { events.push({ k: 'mem', d: { n, e } }); return true; } },
  };
  const m = {
    books: {}, updates: [], activeId: null, step: null, missions: {}, order: ['m1', 'm2', 'm3'],
    info(id) { return ['m1', 'm2', 'm3'].includes(id) ? { id, tutorial: true } : (this.books[id] ? { id, tutorial: false } : null); },
    registerBook(b, o) { const r = CHECKER.check(b); this.books[b.id] = { book: b, origin: o && o.origin }; return { ok: !r.errors.length, errors: r.errors }; },
    updateBook(id, b) { const r = CHECKER.check(b); if (r.errors.length) return { ok: false, errors: r.errors }; this.books[id].book = b; this.updates.push(id); return { ok: true }; },
    unregisterBook(id) { delete this.books[id]; },
    startMission(id) { if (!this.books[id]) return; this.activeId = id; this.missions[id] = { state: 'active' }; this.step = { id: this.books[id].book.steps[0].id }; },
    radio(from, text) { events.push({ k: 'radio', d: { from, text } }); },
    playTime() { return g.time; },
  };
  for (const id of m.order) m.missions[id] = { state: (opts && opts.tutorialOpen) ? 'active' : 'done' };
  g.mission = m;
  return { g, m, events, errors, notices };
}
async function ticks(sl, g, sec, dt, until) {
  const step = dt || 0.25;
  for (let t = 0; t < sec; t += step) {
    g.time += step; sl.update(step); await flush();
    if (until && until()) return true;
  }
  return until ? !!until() : true;
}
function archivEntriesFor(env) {
  const loaded = Archiv.load();
  if (loaded.entries.length) return { entries: loaded.entries, synthetic: false, errors: loaded.errors };
  // Archiv von KATALOG fehlt noch: zwei Einträge aus dem Trockenversuch (nur für die Pipeline-Tests)
  const mk = (f) => ({ name: 'test_' + f.replace(/-/g, '_'), file: f, grobplan: JSON.parse(fs.readFileSync(path.join(ROOT, 'concept', 'regiebuch', 'trockenversuch', 'out', f + '.grobplan.json'), 'utf8')), szenen: {}, rec: { erinnerung_neutral: 'Man kennt sich vom Hafen.' } });
  return { entries: [mk('sela-fund'), mk('grauzahn-rache')], synthetic: true, errors: [] };
}

async function s2Tests(T) {
  const { katalog, env, contexts, ok, bad, skip, safe, check } = T;
  const ctxNT = contexts['nach-tutorial'] || Context.build({}, {}, katalog);
  const ctxOT = contexts['ohne-tutorial'] || Context.build({}, {}, katalog);
  const AR = archivEntriesFor(env);

  // ---------- 6. Szenenbau ----------
  const T6 = '6 Szenenbau';
  await safe(T6, 'parseFolge', () => {
    const a = SB.parseFolge('npc_haltung grauzahn -1'); const b = SB.parseFolge('npc_gedaechtnis melk: Die Crew hat geholfen.');
    const c = SB.parseFolge('chronik: Etwas geschah.'); const d = SB.parseFolge('welt_fakt kustoden_echo (faden): Es summt.');
    const e = SB.parseFolge({ chronik: '@x' }); const f = SB.parseFolge('npc_haltung tesk +3');
    check(T6, 'parseFolge', a.art === 'npc_haltung' && a.delta === -1 && b.npc === 'melk' && b.text === 'Die Crew hat geholfen.' && c.art === 'chronik' && d.faden && d.key === 'kustoden_echo' && e.art === 'chronik' && f.delta === 2,
      JSON.stringify([a, b, c, d, e, f]));
  });
  await safe(T6, 'S2-Regeln Grobplan', () => {
    const g = LLM.mockGrobplan({ kontext: ctxNT }, katalog);
    const r0 = SB.checkGrobplanS2(g, env, ctxNT, { origin: 'sl' });
    const g1 = JSON.parse(JSON.stringify(g)); g1.erinnerung = { npc: 'tesk', ereignis: 'gibt_es_nicht' };
    const g2 = JSON.parse(JSON.stringify(g)); g2.erinnerung = 'nur Text';
    const g3 = JSON.parse(JSON.stringify(g)); g3.ausgaenge.teilerfolg.folgen = ['npc_haltung tesk -1'];
    const g4 = JSON.parse(JSON.stringify(g)); g4.ausgaenge.erfolg.folgen.push('welt_fakt a (faden): x', 'welt_fakt b (faden): y');
    const found = ((ctxNT.orte || []).flatMap((l) => l.funde).find((f) => f.status === 'gefunden') || {}).id;
    const g5 = JSON.parse(JSON.stringify(g)); if (found) g5.szenen[1].fund = found;
    const g6 = JSON.parse(JSON.stringify(g)); g6.aufhaenger = 'Ivo braucht Hilfe.';
    const ctxSkip = Object.assign({}, ctxOT);
    const g7 = LLM.mockGrobplan({ kontext: ctxSkip }, katalog);
    const r = (x, c) => SB.checkGrobplanS2(x, env, c || ctxNT, { origin: 'sl' });
    const res = {
      gueltig: r0.errors.length === 0, dauerWarnung: r0.warnings.some((w) => /unter 10 min/.test(w)),
      erinnerungFalsch: r(g1).errors.some((e) => /gibt_es_nicht/.test(e)), erinnerungText: r(g2).errors.some((e) => /erinnerung/.test(e)),
      archivNurWarnung: SB.checkGrobplanS2(g2, env, ctxNT, { origin: 'archiv' }).errors.length === 0,
      ausgangOhne: r(g3).errors.some((e) => /teilerfolg/.test(e)), faeden: r(g4).errors.some((e) => /Fäden/.test(e)),
      fund: !found || r(g5).errors.some((e) => /schon gefunden/.test(e)),
      tutorial: r(g6, ctxSkip).errors.some((e) => /Tutorial-Bezug/.test(e)) && r(g7, ctxSkip).errors.length === 0,
    };
    check(T6, 'S2-Regeln Grobplan', Object.values(res).every(Boolean), JSON.stringify(res) + ' ' + JSON.stringify(r0) + (Object.values(res).every(Boolean) ? '' : ' g7: ' + JSON.stringify(r(g7, ctxSkip))));
  });
  await safe(T6, 'Rohfassung: vollständiges Buch, Hafen-Rahmen, Anflug, umsetzung', () => {
    const g = LLM.mockGrobplan({ kontext: ctxNT }, katalog);
    const r = SB.buildBook(g, {}, env, { id: 'sl_1_mock', art: 'generiert', kontext: ctxNT });
    const b = r.book;
    const hafen = b.steps[0];
    const anflug = b.steps.filter((s) => /_anflug$/.test(s.id));
    const ohneUms = b.steps.filter((s) => !s.umsetzung).map((s) => s.id);
    const briefing = hafen.enter.find((a) => a.radio);
    const fine = !r.errors.length && b.kopf.art === 'generiert' && briefing && briefing.radio.accept && hafen.onAccept
      && anflug.length >= 1 && anflug.every((s) => s.next[0].goto && s.skip[0].do === 'debug_jump') && !ohneUms.length && b.buch.ziel && b.buch.erinnerung && b.erinnerung
      && Object.values(b.ausgaenge).every((a) => a.folgen.some((x) => x.do === 'npc_gedaechtnis') && a.folgen.some((x) => x.do === 'chronik'));
    check(T6, 'Rohfassung: vollständiges Buch, Hafen-Rahmen, Anflug, umsetzung', fine,
      `${b.steps.length} Schritte, Anflug ${anflug.map((s) => s.id).join(',')}, ohne umsetzung: ${ohneUms.join(',') || '–'}, Fehler: ${r.errors.map((e) => e.code + ' ' + e.p).join(' | ') || '–'}`);
  });
  await safe(T6, 'Trockenversuch-Grobpläne als Rohfassung prüferfest', () => {
    const out = [];
    for (const f of ['grauzahn-rache', 'sela-fund', 'melk-klausel']) {
      const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'concept', 'regiebuch', 'trockenversuch', 'out', f + '.grobplan.json'), 'utf8'));
      const r = SB.buildBook(g, {}, env, { id: 'sl_1_' + f.replace(/-/g, '_'), kontext: ctxNT });
      if (r.errors.length) out.push(`${f}: ${r.errors.map((e) => e.code + ' ' + e.p + ' ' + e.msg).slice(0, 3).join(' | ')}`);
    }
    check(T6, 'Trockenversuch-Grobpläne als Rohfassung prüferfest', !out.length, out.join(' || ') || '3 Bücher gültig');
  });
  await safe(T6, 'liefert_flags erlaubt Verzweigung, neu:-Stimme wird Stimme', () => {
    const kat2 = JSON.parse(JSON.stringify({ molekuele: katalog.molekuele, szenentypen: katalog.szenentypen }));
    const u = kat2.molekuele.vernichten.umsetzungen.find((x) => x.id === 'angriffswelle');
    u.liefert_flags = ['{{id}}_heil', '{{id}}_verloren'];
    const env2 = Object.assign({}, env, { katalog: kat2 });
    const s = { id: 's3_kampf', szenentyp: 'raumgefecht', ort: 'b7', karte: null, molekuele: [{ id: 'vernichten', umsetzung: 'angriffswelle' }], weiter: [{ nach: 'ausgang:erfolg' }, { nach: 'ausgang:teil' }] };
    const g = { id: 'x', titel: 'X', auftraggeber: 'tesk', zielspieldauer_min: 10, szenen: [{ id: 's1', ort: 'hafen', szenentyp: 'hafen', molekuele: [], weiter: [{ nach: 's3_kampf' }] }, s], ausgaenge: { erfolg: {}, teil: {} } };
    const ans = { molekuele: [{ id: 'vernichten', umsetzung: 'angriffswelle', params: { loc: 'b7', npc: 'neu:Kapitän Orr' } }], verzweigung: [{ nach: 'ausgang:erfolg', if: { flag: 's3_kampf_heil' } }, { nach: 'ausgang:teil' }] };
    const sz = SB.assembleScene(g, s, ans, env2, { book: true });
    const st = sz.steps[0];
    const stimme = sz.besetzung.stimmen && Object.keys(sz.besetzung.stimmen)[0];
    check(T6, 'liefert_flags erlaubt Verzweigung, neu:-Stimme wird Stimme', !sz.fehler.length && st.umsetzung === 'vernichten/angriffswelle' && JSON.stringify(st.liefert_flags) === '["s3_kampf_heil","s3_kampf_verloren"]' && stimme && /^neu_/.test(stimme) && !JSON.stringify(sz.steps).includes('neu:'),
      `Fehler: ${sz.fehler.join(' | ') || '–'}, Stimme ${stimme}`);
    // Rohfassung nimmt rueckfall.params
    u.rueckfall = { params: { jaeger: 2 } };
    const roh = SB.rohAnswer(g, s, env2);
    check(T6, 'Rohfassung nutzt rueckfall.params und verzweigt über liefert_flags', roh.molekuele[0].params.jaeger === 2 && roh.verzweigung[0].if && roh.verzweigung[0].if.flag === 's3_kampf_heil', JSON.stringify(roh));
  });
  await safe(T6, 'Schritt → Szene, Anflug nur bei Ortswechsel', () => {
    const g = LLM.mockGrobplan({ kontext: ctxNT }, katalog);
    const a = SB.sceneOfStep(g, 's2_mock_anflug'); const b2 = SB.sceneOfStep(g, 's3_mock'); const c = SB.sceneOfStep(g, 's3_mock_2'); const d = SB.sceneOfStep(g, 'xyz');
    check(T6, 'Schritt → Szene, Anflug nur bei Ortswechsel', a === 's2_mock' && b2 === 's3_mock' && c === 's3_mock' && d === null && SB.needsApproach(g, g.szenen[1]) && !SB.needsApproach(g, g.szenen[0]), [a, b2, c, d].join(','));
  });
  await safe(T6, 'Regie-Logbuch: Datei, Rotation, Wunschliste, Bericht', () => {
    const dir = tmpDir('regie6');
    const log = Regielog.create({ dir, weltId: 'w-abc', rotateBytes: 400 });
    for (let i = 0; i < 6; i++) log.write({ art: 'grobplan', mission: 'sl_1', quelle: 'llm', tokens: 100, fehler: [], begruendung: 'Test ' + i, spielzeit: i });
    log.wish('Schützling mit Andockmanöver', { mission: 'sl_1' }); log.wish('Schützling mit Andockmanöver', { mission: 'sl_2' });
    const r = Regielog.read(dir, 'w-abc'); const w = Regielog.readWishes(dir);
    const rotated = fs.existsSync(path.join(dir, 'w-abc.1.jsonl'));
    const Bericht = require('./regie-bericht.js');
    const md = Bericht.report(dir, 'w-abc');
    check(T6, 'Regie-Logbuch: Datei, Rotation, Wunschliste, Bericht', rotated && r.entries.length >= 3 && r.entries.every((e) => 'quelle' in e && 'tokens' in e && 'fehler' in e) && w['Schützling mit Andockmanöver'].n === 2 && /# Regie-Bericht/.test(md) && /Schützling mit Andockmanöver/.test(md),
      `${r.entries.length} Einträge (rotiert: ${rotated}), Bericht ${md.length} Zeichen`);
  });

  // ---------- 7. Pipeline (script, Test-Engine) ----------
  const T7 = '7 Pipeline';
  let savedState = null; let savedOffers = null;
  await safe(T7, 'missionDone → planning → offered (2 SL + 1 Archiv)', async () => {
    LLM.resetBudget();
    const F = fakeGame();
    // S2b-Vorlauf: s2 und s3 werden beim Annehmen angefragt; s3 bleibt offen (hold), um „betreten vor fertig“ zu prüfen
    const llm = LLM.create({ mode: 'script', katalog, script: { grobplan: [], szene: [{}, { hold: true }] } });
    const sl = Spielleiter.create(F.g, { llm, kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie7'), katalog });
    sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
    const p0 = sl.planning(); const arch0 = sl.offers().filter((o) => o.origin === 'archiv').length;
    const teaser = F.events.filter((e) => e.k === 'radio' && e.d.text === Spielleiter.TEASER_TEXT).length;
    const done = await ticks(sl, F.g, 10, 0.25, () => sl.offers().length >= 3);
    const offers = sl.offers();
    const sealed = sl.planning();
    check(T7, 'missionDone → planning → offered (2 SL + 1 Archiv)', done && p0 && p0.stage === 0 && arch0 === 1 && teaser === 1 && offers.filter((o) => o.origin === 'sl').length === 2 && sealed && sealed.stage === 2 && Object.keys(F.m.books).length === 3 && !F.errors.length,
      `Angebote: ${offers.map((o) => `${o.id}[${o.origin}]`).join(', ')}; planning vorher ${JSON.stringify(p0)}, danach ${JSON.stringify(sealed)}; Teaser ${teaser}; Fehler ${F.errors.join(' | ') || '–'}`);
    const o = offers.find((x) => x.origin === 'sl');
    check(T7, 'Angebot hat Absender, Ziel, Dauer, Belohnung, Erinnerung', o && o.von && o.ziel && o.dauer_min && o.belohnung && o.erinnerung, JSON.stringify(o));
    // accept → Szenen-Vorlauf → ersetzt
    const err = sl.accept(o.id);
    const plan = sl.planById(o.id);
    await ticks(sl, F.g, 5, 0.25, () => F.m.updates.length >= 1);
    const s2 = plan.grobplan.szenen[1].id; const s3 = plan.grobplan.szenen[2].id;
    check(T7, 'accept → Mission läuft, Nachfolgeszene ausgearbeitet und ersetzt (updateBook)', err === null && F.m.activeId === o.id && F.m.updates.includes(o.id) && plan.szenen[s2].state === 'ready' && plan.szenen[s2].quelle === 'llm',
      `Fehler ${err}; Szenen ${JSON.stringify(Object.fromEntries(Object.entries(plan.szenen).map(([k, v]) => [k, v.state + '/' + v.quelle])))}; Updates ${F.m.updates.length}`);
    // betretene Szene wird nicht ersetzt: s3 ist zurückgehalten (hold), s3 betreten, dann freigeben
    F.m.step = { id: `${s2}_anflug` }; sl.update(0.1); await flush();
    F.m.step = { id: s2 }; F.g.time += 0.25; sl.update(0.25); await flush();
    const req = plan.szenen[s3].state;
    const upd0 = F.m.updates.length;
    F.m.step = { id: `${s3}_anflug` }; F.g.time += 0.25; sl.update(0.25); await flush();
    F.m.step = { id: s3 }; F.g.time += 0.25; sl.update(0.25); await flush();
    llm.release(); await ticks(sl, F.g, 2);
    check(T7, 'betretene Szene wird nicht mehr ersetzt', req === 'requested' && F.m.updates.length === upd0 && plan.szenen[s3].state === 'active',
      `vorher ${req}, nachher ${plan.szenen[s3].state}, Updates ${upd0} -> ${F.m.updates.length}`);
    // Speichern mitten in der Mission
    savedState = JSON.parse(JSON.stringify(sl.toSave())); savedOffers = sl.offers().map((x) => x.id).sort();
    const keys = Object.keys(savedState.plaene);
    check(T7, 'toSave: Format §3.2 (plaene, archiv_gespielt, zusammenfassung, naechste_id)', keys.includes(o.id) && savedState.plaene[o.id].buch && savedState.plaene[o.id].grobplan && savedState.plaene[o.id].szenen[s2].antwort && Array.isArray(savedState.archiv_gespielt) && Number.isFinite(savedState.naechste_id),
      `Pläne ${keys.join(', ')}, ${JSON.stringify(savedState).length} Bytes`);
    // missionDone → Zusammenfassung + neue Runde
    F.m.activeId = null; F.m.step = null;
    sl.onMissionDone({ id: o.id, ausgang: 'erfolg' });
    await ticks(sl, F.g, 10, 0.25, () => sl.offers().filter((x) => x.origin === 'sl').length >= 2);
    check(T7, 'missionDone → Zusammenfassung, Gedächtnis-taugliche Ausgänge, neue Runde', sl.zusammenfassung.length === 1 && sl.zusammenfassung[0].ausgang === 'erfolg' && sl.offers().length >= 3 && !sl.planById(o.id),
      `Zusammenfassung ${JSON.stringify(sl.zusammenfassung)}, Angebote ${sl.offers().length}`);
    // ablehnen: leichter Gedächtnis-Eintrag, Ersatz-Angebot
    const d = sl.offers().find((x) => x.origin === 'sl');
    const mem0 = F.events.filter((e) => e.k === 'mem').length;
    const derr = sl.decline(d.id);
    await ticks(sl, F.g, 5, 0.25, () => sl.offers().filter((x) => x.origin === 'sl').length >= 2);
    const mem = F.events.filter((e) => e.k === 'mem').slice(mem0);
    check(T7, 'decline: Buch abgemeldet, leichter Gedächtnis-Eintrag, Ersatz geplant', derr === null && !F.m.books[d.id] && mem.length === 1 && mem[0].d.e.gewicht < 1 && sl.offers().filter((x) => x.origin === 'sl').length === 2,
      `Gedächtnis ${JSON.stringify(mem.map((x) => x.d))}`);
    check(T7, 'keine gezählten Fehler, Tokens auf dem Prozess-Zähler', !F.errors.length, `${F.errors.join(' | ') || '0 Fehler'}; Tokens ${LLM.budget().used}`);
  });
  await safe(T7, 'restore: Bücher wieder registriert, Angebote gleich', async () => {
    if (!savedState) { skip(T7, 'restore: Bücher wieder registriert, Angebote gleich', 'kein gespeicherter Stand aus dem vorigen Test'); return; }
    const F = fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: {} }), kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie7b'), katalog });
    const r = sl.restore(JSON.parse(JSON.stringify(savedState)));
    const active = Object.keys(savedState.plaene).find((id) => !savedOffers.includes(id));
    // aktive Mission: Engine stellt sie her -> Spielleiter erkennt 'running', betretene Szene, fordert Nachfolger an
    F.m.activeId = active; F.m.step = { id: F.m.books[active].book.steps[0].id };
    sl.update(0.1);
    const offers = sl.offers().map((x) => x.id).sort();
    const plan = sl.planById(active);
    const same = JSON.stringify(sl.toSave().plaene[active].buch) === JSON.stringify(savedState.plaene[active].buch);
    check(T7, 'restore: Bücher wieder registriert, Angebote gleich', r && Object.keys(F.m.books).length === Object.keys(savedState.plaene).length && plan && plan.state === 'running' && same && offers.every((id) => savedOffers.includes(id)) && !F.errors.length,
      `registriert ${Object.keys(F.m.books).join(', ')}, aktiv ${active} (${plan && plan.state}), Buch gleich ${same}, Angebote ${offers.join(',')} / gespeichert ${savedOffers.join(',')}, Fehler ${F.errors.join(' | ') || '–'}`);
  });
  await safe(T7, 'sceneWait: höchstens sceneWaitMax s, dann Rohfassung', async () => {
    const F = fakeGame();
    const scr = { grobplan: [], szene: [{ hold: true }, { hold: true }, { hold: true }] };
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: scr }), kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie7c'), katalog });
    sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
    await ticks(sl, F.g, 10, 0.25, () => sl.offers().filter((o) => o.origin === 'sl').length >= 2);
    const o = sl.offers().find((x) => x.origin === 'sl');
    sl.accept(o.id); sl.update(0.1); await flush();
    const plan = sl.planById(o.id); const s2 = plan.grobplan.szenen[1];
    F.m.step = { id: `${s2.id}_anflug` }; F.g.ship.scene = s2.ort;
    const t0 = F.g.time; let readyAt = null;
    for (let i = 0; i < 200 && readyAt === null; i++) { F.g.time += 0.25; sl.update(0.25); await flush(); if (sl.sceneReady(o.id, s2.id)) readyAt = F.g.time - t0; }
    const waits = F.events.filter((e) => e.k === 'sceneWait');
    const odas = F.events.filter((e) => e.k === 'oda' && e.d.text === Spielleiter.WAIT_ODA);
    check(T7, 'sceneWait: höchstens sceneWaitMax s, dann Rohfassung', readyAt !== null && readyAt <= F.g.C.spielleiter.sceneWaitMax + 0.5 && waits.length === 1 && waits[0].d.sec === F.g.C.spielleiter.sceneWaitMax && odas.length === 1 && plan.szenen[s2.id].state === 'failed' && plan.szenen[s2.id].quelle === 'rohfassung' && sl.stats.maxWait <= F.g.C.spielleiter.sceneWaitMax + 0.5,
      `bereit nach ${readyAt} s, sceneWait ${waits.length}×, ODA ${odas.length}×, Szene ${plan.szenen[s2.id].state}, max. Wartezeit ${sl.stats.maxWait} s`);
    // max. 1 CLI-Prozess: der zurückgehaltene Prozess blockiert weitere Starts, bis er endet
    check(T7, 'höchstens 1 CLI-Prozess gleichzeitig', sl.inflight <= 1, `inflight ${sl.inflight}, Warteschlange ${sl.queue.length}`);
    sl.llm.release(); await ticks(sl, F.g, 1);
  });
  await safe(T7, 'ohne Tutorial: Archiv ab Sekunde 0, Planung nach dem Tesk-Funk', async () => {
    const F = fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: {} }), kontext: () => ctxOT, archiv: AR.entries, regieDir: tmpDir('regie7d'), katalog });
    sl.onCampaignStart({ tutorial: false });
    const at0 = sl.offers().length;
    const p0 = sl.planning();
    await ticks(sl, F.g, 20, 0.25, () => sl.offers().length >= 3);
    check(T7, 'ohne Tutorial: Archiv ab Sekunde 0, Planung nach dem Tesk-Funk', at0 === 1 && p0 && p0.stage === 2 && sl.offers().length >= 3, `sofort ${at0}, nach 20 s ${sl.offers().length} (${sl.offers().map((x) => x.origin + ':' + x.titel).join(', ')})`);
    // QA-INTEGRATION S2: abgelehnte Archiv-Mission kommt nicht sofort wieder, solange eine andere frei ist; Liste im Weltstand
    const offA = sl.offers().filter((x) => x.origin === 'archiv');
    const dec = offA[offA.length - 1];
    if (!dec || offA.length >= AR.entries.length) { skip(T7, 'Ablehnen: Archiv-Mission kommt nicht sofort wieder', 'zu wenige Archiv-Einträge'); return; }
    sl.decline(dec.id);
    await ticks(sl, F.g, 5, 0.25, () => sl.offers().length >= 3);
    const again = sl.offers().filter((x) => x.titel === dec.titel);
    const sv = sl.toSave();
    check(T7, 'Ablehnen: Archiv-Mission kommt nicht sofort wieder, archiv_abgelehnt im Weltstand', !again.length && sl.offers().length >= 3 && Array.isArray(sv.archiv_abgelehnt) && sv.archiv_abgelehnt.length === 1,
      `abgelehnt „${dec.titel}“ -> jetzt ${sl.offers().map((x) => x.titel).join(', ')}; archiv_abgelehnt ${JSON.stringify(sv.archiv_abgelehnt)}`);
  });
  await safe(T7, 'mit Tutorial: m1/m2 lösen keine Planung aus', async () => {
    const F = fakeGame({ tutorialOpen: true });
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: {} }), kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie7e'), katalog });
    sl.onCampaignStart({ tutorial: true });
    F.m.missions.m1.state = 'done'; sl.onMissionDone({ id: 'm1', ausgang: 'geliefert' });
    F.m.activeId = 'm2';
    await ticks(sl, F.g, 3);
    check(T7, 'mit Tutorial: m1/m2 lösen keine Planung aus', sl.offers().length === 0 && !sl.planning(), `Angebote ${sl.offers().length}`);
  });

  // ---------- 8. Rückfälle ----------
  const T8 = '8 Rückfälle';
  const fallbackCase = async (name, script, prep, expect) => {
    await safe(T8, name, async () => {
      LLM.resetBudget();
      const F = fakeGame();
      if (prep && prep.budget != null) LLM.setBudgetLimit(prep.budget);
      const sl = Spielleiter.create(F.g, { llm: LLM.create(script === 'off' ? { mode: 'off' } : { mode: 'script', katalog, script }), kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie8'), katalog, config: { offers: 1 } });
      let thrown = null;
      try {
        sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
        await ticks(sl, F.g, (prep && prep.sec) || 10, 0.5, () => sl.offers().length >= 2);
      } catch (e) { thrown = e; }
      LLM.setBudgetLimit(null);
      const offers = sl.offers(); const t = F.g.time;
      const rueck = sl.regie ? sl.regie.entries.filter((e) => e.art === 'rueckfall') : [];
      const extra = expect ? expect(sl, F) : true;
      check(T8, name, !thrown && offers.length >= 2 && offers.every((o) => o.origin === 'archiv' || /mock/.test(o.id) || o.origin === 'sl') && rueck.length >= 1 && extra && !F.errors.filter((e) => !/fallback/.test(e)).length,
        `${thrown ? 'Ausnahme ' + thrown.message + '; ' : ''}Angebote nach ${t.toFixed(1)} s: ${offers.map((o) => `${o.id}[${o.origin}]`).join(', ')}; Rückfall: ${rueck.map((e) => e.begruendung).join(' | ')}; Fehler ${F.errors.join(' | ') || '–'}`);
    });
  };
  await fallbackCase('Timeout (Grobplan hält > 120 s) → Archiv', { grobplan: [{ hold: true }] }, { sec: 130 }, (sl) => sl.inflight === 0);
  await fallbackCase('Müll-JSON zweimal → Nachbesserung, dann Archiv', { grobplan: [{ text: 'Hier ist dein Plan: {kaputt' }, { text: 'immer noch {{ kaputt' }] }, null,
    (sl) => sl.regie.entries.filter((e) => e.art === 'grobplan' && e.fehler.length).length === 2);
  await fallbackCase('zweimal ungültig (Prüfer) → Archiv', { grobplan: [{ json: { format: 'grobplan/2', id: 'x', szenen: [] } }, { json: { format: 'grobplan/2', id: 'x', szenen: [] } }] }, null,
    (sl) => sl.regie.entries.filter((e) => e.art === 'grobplan' && e.versuch === 2).length === 1);
  await fallbackCase('Budget leer → Archiv ohne Aufruf', { grobplan: [] }, { budget: 10 }, (sl) => sl.llm.calls().length === 0);
  await fallbackCase('CLI fehlt (ENOENT) → Transport für den Lauf aus', { grobplan: [{ error: 'enoent' }] }, null, (sl) => !!sl.transportOff && !sl.transportUsable());
  await fallbackCase('429 → 60 s Pause, Rückfall', { grobplan: [{ error: '429' }] }, null, (sl) => sl.pauseUntil > 50);
  await fallbackCase('LLM aus (Modus off) → nur Archiv/Mock', 'off', null, (sl) => sl.offers().every((o) => o.origin === 'archiv' || /mock/.test(o.id)));
  await safe(T8, 'Szene: zweimal ungültig → bleibt Rohfassung', async () => {
    const F = fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: { szene: [{ text: '{"molekuele": []}' }, { text: 'kein json' }] } }), kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie8b'), katalog });
    sl.onMissionDone({ id: 'm3' });
    await ticks(sl, F.g, 10, 0.25, () => sl.offers().filter((o) => o.origin === 'sl').length >= 2);
    const o = sl.offers().find((x) => x.origin === 'sl'); sl.accept(o.id);
    const plan = sl.planById(o.id); const s2 = plan.grobplan.szenen[1].id;
    await ticks(sl, F.g, 5, 0.25, () => plan.szenen[s2].state === 'failed');
    check(T8, 'Szene: zweimal ungültig → bleibt Rohfassung', plan.szenen[s2].state === 'failed' && plan.szenen[s2].quelle === 'rohfassung' && !F.m.updates.includes(o.id) && !F.errors.length, `Szene ${plan.szenen[s2].state}, Fehler ${F.errors.join(' | ') || '–'}`);
  });
  await safe(T8, 'Debug: sl status / fail / archiv', async () => {
    const F = fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: {} }), kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie8c'), katalog, config: { offers: 1 } });
    const e1 = sl.debug(['sl', 'status'], {}); const e2 = sl.debug(['fail', 'grobplan'], {}); const e3 = sl.debug(['fail', 'quatsch'], {});
    sl.onMissionDone({ id: 'm3' });
    await ticks(sl, F.g, 5, 0.25, () => sl.offers().length >= 2);
    const viaFail = sl.regie.entries.some((e) => e.art === 'rueckfall' && /Debug/.test(e.begruendung));
    const e4 = sl.debug(['archiv'], {});
    check(T8, 'Debug: sl status / fail / archiv', e1 === null && e2 === null && typeof e3 === 'string' && viaFail && F.notices.length >= 2, `notices ${F.notices.length}, archiv: ${e4}`);
  });

  // ---------- 9. Echte Engine ----------
  const T9 = '9 Engine';
  const MissionMod = tryRequire('server/sim/mission.js').mod;
  const hasEngine = !!(MissionMod && MissionMod.Mission && typeof MissionMod.Mission.prototype.registerBook === 'function' && typeof MissionMod.Mission.prototype.updateBook === 'function');
  if (!hasEngine) {
    skip(T9, 'Kampagne ohne Tutorial → Angebote → Annehmen → Skip-Lauf → missionDone', 'mission.registerBook/updateBook fehlen noch (ENGINE)');
    skip(T9, 'Speichern/Laden mitten in einer erzeugten Mission', 'mission.registerBook fehlt noch (ENGINE)');
  } else {
    await engineTests(Object.assign({}, T, { T9, AR }));
  }

  // ---------- 10. Archiv ----------
  const T10 = '10 Archiv';
  await safe(T10, 'Lader', () => {
    const r = Archiv.load();
    if (!r.entries.length && !r.errors.length) { skip(T10, 'Lader', 'content/spielleiter/archiv/*.json fehlen noch (KATALOG)'); return; }
    check(T10, 'Lader', !r.errors.length && r.entries.length >= 4, `${r.entries.length} Einträge (${r.entries.map((e) => e.name).join(', ')}); Fehler: ${r.errors.map((e) => e.file + ': ' + e.msg).join(' | ') || '–'}`);
    const names = r.entries.map((e) => e.name);
    const p1 = Archiv.pick(r.entries, [], ctxNT); const p2 = Archiv.pick(r.entries, [p1.name], ctxNT); const pAll = Archiv.pick(r.entries, names, ctxNT);
    const p1b = Archiv.pick(r.entries, names.slice(1).concat([names[0]]), ctxNT);   // zuletzt gespielt: names[0] -> ältester zuerst
    check(T10, 'Wiederholung erst, wenn alle gespielt', !!p1 && (names.length < 2 || (p2 && p1.name !== p2.name)) && !!pAll && (names.length < 2 || (p1b && p1b.name === names[1])),
      `${p1 && p1.name} → ${p2 && p2.name}; alle gespielt → ${pAll && pAll.name}; ältester zuerst → ${p1b && p1b.name}`);
    for (const e of r.entries) {
      for (const [cname, ctx] of [['nach-tutorial', ctxNT], ['ohne-tutorial', ctxOT]]) {
        const er = Archiv.erinnerung(e, ctx);
        const g = JSON.parse(JSON.stringify(e.grobplan)); if (er.ref) g.erinnerung = er.ref; else delete g.erinnerung; g.erinnerung_text = er.text;
        const legacy = SB.checkGrobplan(Object.assign({ erinnerung: er.text || '' }, g), env);
        const s2 = SB.checkGrobplanS2(g, env, ctx, { origin: 'archiv' });
        const answers = {}; for (const [sid, a] of Object.entries(e.szenen)) answers[sid] = { answer: a, quelle: 'archiv' };
        const b = SB.buildBook(g, answers, env, { id: 'ar_1_' + SB.slug(e.name, 20), art: 'archiv', kontext: ctx });
        const roh = Object.entries(b.szenen).filter(([, v]) => v.quelle === 'rohfassung' && Object.keys(e.szenen).length).map(([k]) => k);
        const warn = b.warnings.filter((w) => /OBJEKT-BUEHNE|NPC-BESETZUNG|BEREICH-BUEHNE|ORT-BUEHNE/.test(w));
        if (cname === 'nach-tutorial') {
          const lohn = Object.entries(b.book.ausgaenge).map(([k, a]) => [k, (a.folgen.find((x) => x.reward) || { reward: { marks: 0 } }).reward.marks]);
          check(T10, `${e.name}: Lohn je Ausgang (kein Malus für die andere Wahl)`, new Set(lohn.filter(([k]) => !/abbruch|gescheitert|verloren|unvollstaendig/.test(k)).map(([, m]) => m)).size <= 1, lohn.map(([k, m]) => `${k} ${m}`).join(', '));
        }
        check(T10, `${e.name} (${cname}): Bühne/Besetzung vollständig`, !warn.length, warn.join(' | ') || 'keine Bühnen-/Besetzungs-Warnungen');
        check(T10, `${e.name} (${cname}): Grobplan + Buch prüferfest`, !legacy.length && !s2.errors.length && !b.errors.length,
          `Grobplan: ${legacy.concat(s2.errors).join(' | ') || 'ok'}; Buch: ${b.errors.map((x) => x.code + ' ' + x.p + ' ' + x.msg).slice(0, 4).join(' | ') || 'ok'}; Erinnerung ${er.ref ? JSON.stringify(er.ref) : 'neutral'}; Szenen als Rohfassung: ${roh.join(',') || '–'}`);
      }
    }
  });

  // ---------- 11. Replay-Regression ----------
  const T11 = '11 Regression';
  await safe(T11, 'Buch-Hash aus den Aufzeichnungen stabil', () => {
    const file = path.join(FIX, 'llm', 'buch-hashes.json');
    const now = {};
    const dir = path.join(FIX, 'llm', 'grobplan');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort() : []) {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      let g; try { g = SB.parseJsonAnswer(rec.response.text); } catch (e) { continue; }
      const r = SB.buildBook(g, {}, env, { id: 'sl_1_' + SB.slug(g.id, 20), kontext: ctxNT });
      now['grobplan/' + (rec.name || f)] = { hash: sha1(r.book), fehler: r.errors.map((e) => e.code).sort() };
    }
    const sdir = path.join(FIX, 'llm', 'szene');
    for (const f of fs.existsSync(sdir) ? fs.readdirSync(sdir).filter((x) => x.endsWith('.json')).sort() : []) {
      const rec = JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8'));
      let a; try { a = SB.parseJsonAnswer(rec.response.text); } catch (e) { continue; }
      const g = rec.input.grobplan;
      const r = SB.buildBook(g, { [rec.input.szene]: { answer: a, quelle: 'llm' } }, env, { id: 'sl_1_' + SB.slug(g.id, 20), kontext: ctxNT });
      now['szene/' + (rec.name || f)] = { hash: sha1(r.book), fehler: r.errors.map((e) => e.code).sort(), szene: r.szenen[rec.input.szene] ? r.szenen[rec.input.szene].quelle : null };
    }
    if (T.UPDATE || !fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(now, null, 2) + '\n', 'utf8'); ok(T11, 'Buch-Hash aus den Aufzeichnungen stabil', `neu geschrieben (${Object.keys(now).length} Bücher)`); return; }
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diff = Object.keys(Object.assign({}, old, now)).filter((k) => JSON.stringify(old[k]) !== JSON.stringify(now[k]));
    check(T11, 'Buch-Hash aus den Aufzeichnungen stabil', !diff.length, diff.length ? `abweichend: ${diff.join(', ')} (bewusst? dann --update)` : `${Object.keys(now).length} Bücher, Hash gleich`);
    const twice = sha1(SB.buildBook(LLM.mockGrobplan({ kontext: ctxNT }, katalog), {}, env, { id: 'sl_1_m', kontext: ctxNT }).book) === sha1(SB.buildBook(LLM.mockGrobplan({ kontext: ctxNT }, katalog), {}, env, { id: 'sl_1_m', kontext: ctxNT }).book);
    check(T11, 'Buchbau deterministisch', twice, '');
  });

  // ---------- 12. S2b ----------
  await s2bTests(Object.assign({}, T, { ctxNT, AR }));

  // ---------- 13. B1/B2 ----------
  await b1Tests(Object.assign({}, T, { ctxNT, ctxOT, AR }));

  // ---------- 14. B1-FIX (ABNAHME-B1 F3, F14) ----------
  await b1FixTests(Object.assign({}, T, { ctxNT, ctxOT, AR }));

  // ---------- 15. W1 AP4 (Spielleiter Boden II) ----------
  await w1Tests(Object.assign({}, T, { ctxNT, ctxOT, AR }));
}

// =================================================================================================================
// W1 AP4 (CONTRACT-W1 §5.4 Nr. 9–11): Katalog-Kurzfassung, KARTE-WIEDERHOLT über die Angebotsrunde, Kampagnenstart ohne
// Neuversuch (Mock-LLM mit ungültigen Plänen)
// =================================================================================================================
async function w1Tests(T) {
  const { katalog, env, safe, check, ctxNT, ctxOT, AR } = T;
  const T15 = '15 W1';
  const SB = require('../server/mission/szenenbau.js');
  const K = require('../server/mission/katalog.js');
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // 1. Kurzfassung: je verfügbare Umsetzung genau eine Zeile, keine Beschreibungsprosa, kein „Noch nicht spielbar“,
  //    höchstens 60 % der Fassung vor W1 (gemessen 19 768 Zeichen, node tools/katalog.js --tokens)
  await safe(T15, 'Katalog-Kurzfassung: eine Zeile je Umsetzung, ohne Prosa, −40 %', () => {
    const kurz = K.fuerSpielleiter(katalog, 'kurz');
    const verf = Object.values(katalog.molekuele).flatMap((m) => m.umsetzungen.filter((u) => u.status === 'verfuegbar').map((u) => ({ key: `${m.id}/${u.id}`, u })));
    const zeilen = verf.map((x) => (kurz.match(new RegExp(`^- ${x.key.replace('/', '\\/')} – `, 'gm')) || []).length);
    const prosa = verf.filter((x) => x.u.beschreibung && kurz.includes(x.u.beschreibung.slice(0, 40))).map((x) => x.key);
    const res = { jeEineZeile: zeilen.every((n) => n === 1), ohneProsa: !prosa.length, ohneGeplant: !/Noch nicht spielbar/.test(kurz), minus40: kurz.length <= Math.floor(19768 * 0.6),
      vollUnveraendert: /Noch nicht spielbar/.test(K.fuerSpielleiter(katalog, 'voll')) };
    check(T15, 'Katalog-Kurzfassung: eine Zeile je Umsetzung, ohne Prosa, −40 %', Object.values(res).every(Boolean), `${JSON.stringify(res)}; ${kurz.length} Zeichen; Prosa: ${prosa.join(', ') || '–'}`);
  });

  // 2. KARTE-WIEDERHOLT über die Runde (Muster LANG-RUNDE): wreck zweimal in einer Angebotsrunde
  const wrackPlan = (id, titel) => b1Plan([{ id: 's2_wrack', ort: 'wrack', szenentyp: 'erkundung', landepunkt: 'wreck', mols: ['ausschlachten/wrack_container'], dauer: 4 },
    { id: 's3_heim', ort: 'hafen', szenentyp: 'ablieferung', mols: ['ladung_liefern/im_hafen_abgeben'], dauer: 2 }], { id, titel });
  await safe(T15, 'KARTE-WIEDERHOLT über die Angebotsrunde: wreck zweimal in einer Runde', async () => {
    const g = wrackPlan('w1_a', 'Wrack A');
    const mit = SB.checkGrobplanB1(clone(g), env, ctxNT, { landepunkteImAngebot: [{ titel: 'Wrack B', landepunkte: ['wreck'] }] });
    const ohne = SB.checkGrobplanB1(clone(g), env, ctxNT, { landepunkteImAngebot: [{ titel: 'Anderswo', landepunkte: ['kesh.kastell'] }] });
    const F = fakeGame();
    const llm = LLM.create({ mode: 'script', katalog, script: { grobplan: [{ json: wrackPlan('w1_a', 'Wrack A') }, { json: wrackPlan('w1_b', 'Wrack B') }] } });
    const sl = Spielleiter.create(F.g, { llm, kontext: () => clone(ctxNT), archiv: AR.entries, regieDir: tmpDir('regie15b'), katalog, config: { offers: 2 } });
    sl.onMissionDone({ id: 'm3' });
    await ticks(sl, F.g, 20, 0.25, () => sl.offers().filter((o) => o.origin === 'sl').length >= 2);
    const gp = sl.regie.entries.filter((e) => e.art === 'grobplan' && /^Grobplan/.test(e.begruendung || ''));
    const res = { warnung: mit.warnings.some((w) => /^KARTE-WIEDERHOLT: Landepunkt 'wreck' ist in dieser Angebotsrunde schon im Angebot \(„Wrack B“\)/.test(w)) && !mit.errors.some((e) => /KARTE-WIEDERHOLT/.test(e)),
      andereKarteStill: !ohne.warnings.some((w) => /Angebotsrunde/.test(w)),
      spielleiter: sl.offers().filter((o) => o.origin === 'sl').length === 2 && gp.length === 2 && !/Angebotsrunde/.test(gp[0].begruendung || '') && /KARTE-WIEDERHOLT: Landepunkt 'wreck' ist in dieser Angebotsrunde/.test(gp[1].begruendung || '') };
    check(T15, 'KARTE-WIEDERHOLT über die Angebotsrunde: wreck zweimal in einer Runde', Object.values(res).every(Boolean), `${JSON.stringify(res)}; ${gp.map((e) => (e.begruendung || '').slice(0, 160) + ' ' + (e.fehler || []).join(' | ')).join(' || ')}`);
  });

  // 2b. Gefangennahme nie am Heimathafen: Szenenauflösung meldet GEFANGEN-HEIMATHAFEN, Vorgaben bieten hafen.kontor nicht an
  await safe(T15, 'Ausbruch nie am Heimathafen: Auflösung GEFANGEN-HEIMATHAFEN, Vorgaben ohne hafen.kontor', () => {
    const g = b1Plan([{ id: 's2_zelle', ort: 'hafen', szenentyp: 'ausbruch', landepunkt: 'hafen.kontor', mols: ['ausbruch/zelle_und_kammer'], dauer: 5 }]);
    const r = SB.aufloesen(g, env, ctxNT);
    const g2 = b1Plan([{ id: 's2_zelle', ort: 'splitter', szenentyp: 'ausbruch', landepunkt: 'splitter.schuerflager', mols: ['ausbruch/zelle_und_kammer'], dauer: 5 }]);
    const r2 = SB.aufloesen(g2, env, ctxNT);
    const u = katalog.molekuele.ausbruch.umsetzungen.find((x) => x.id === 'zelle_und_kammer');
    const pass = SB.passendeLandepunkte(u, env, ctxNT, {});
    const res = { heimathafen: r.errors.some((e) => /^GEFANGEN-HEIMATHAFEN: Szene 's2_zelle'/.test(e)), anderswo: !r2.errors.length, vorgaben: !Object.values(pass.orte).flat().includes('hafen.kontor') };
    check(T15, 'Ausbruch nie am Heimathafen: Auflösung GEFANGEN-HEIMATHAFEN, Vorgaben ohne hafen.kontor', Object.values(res).every(Boolean), `${JSON.stringify(res)}; ${[...r.errors, ...r2.errors].join(' | ')}; passend ${JSON.stringify(pass.orte)}`);
  });

  // 3. Kampagnenstart: 0 Wiederholungen (Archiv-Angebot liegt schon); normale Runde: Neuversuch mit Prüferfehlern als Liste
  const kaputt = () => ({ grobplan: [1, 2, 3, 4].map(() => ({ text: '{"format":"grobplan/2","szenen":[]}' })) });
  const mitZaehler = (sl) => { const calls = []; const ask0 = sl.llm.ask.bind(sl.llm); sl.llm.ask = (kind, input, o) => { calls.push({ kind, zeichen: String(input.prompt || '').length, pruefer: /<pruefer>/.test(input.prompt || '') }); return ask0(kind, input, o); }; return calls; };
  await safe(T15, 'Kampagnenstart: kein Neuversuch, Rückfall aufs Archiv (Mock mit ungültigen Plänen)', async () => {
    const F = fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: kaputt() }), kontext: () => clone(ctxOT), archiv: AR.entries, regieDir: tmpDir('regie15c'), katalog });
    const calls = mitZaehler(sl);
    sl.onCampaignStart({ tutorial: false });
    await ticks(sl, F.g, 40, 0.25, () => !sl.planning() && sl.offers().length >= 3);
    const rueck = sl.regie.entries.filter((e) => e.art === 'rueckfall' && /Kampagnenstart: kein Neuversuch/.test(e.begruendung || ''));
    const res = { zweiAufrufe: calls.filter((c) => c.kind === 'grobplan').length === 2, ohnePruefer: !calls.some((c) => c.pruefer), rueckfall: rueck.length === 2,
      angebote: sl.offers().length >= 3 && sl.offers().some((o) => o.origin === 'archiv'), fehlerfrei: !F.errors.length };
    check(T15, 'Kampagnenstart: kein Neuversuch, Rückfall aufs Archiv (Mock mit ungültigen Plänen)', Object.values(res).every(Boolean), `${JSON.stringify(res)}; Aufrufe ${calls.map((c) => c.kind + ':' + c.zeichen).join(', ')}; Angebote ${sl.offers().map((o) => o.origin + ':' + o.titel).join(', ')}; Fehler ${F.errors.join(' | ') || '–'}`);
  });
  await safe(T15, 'Normale Runde: Neuversuch bekommt die Prüferfehler als Liste', async () => {
    const F = fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'script', katalog, script: kaputt() }), kontext: () => clone(ctxNT), archiv: AR.entries, regieDir: tmpDir('regie15d'), katalog });
    const calls = mitZaehler(sl); const prompts = []; const ask1 = sl.llm.ask; sl.llm.ask = (k, i, o) => { prompts.push(String(i.prompt || '')); return ask1(k, i, o); };
    sl.onMissionDone({ id: 'm3' });
    await ticks(sl, F.g, 40, 0.25, () => !sl.planning() && calls.length >= 4);
    const retry = prompts.filter((p) => /<pruefer>\n- /.test(p));
    const res = { vierAufrufe: calls.length === 4, zweiNeuversuche: retry.length === 2, liste: retry.every((p) => /<pruefer>\n(- [^\n]+\n?)+<\/pruefer>/.test(p)) };
    check(T15, 'Normale Runde: Neuversuch bekommt die Prüferfehler als Liste', Object.values(res).every(Boolean), `${JSON.stringify(res)}; Aufrufe ${calls.length}`);
  });
}

// =================================================================================================================
// B1-FIX (ABNAHME-B1 F3/F14): Vorgaben im Grobplan-Prompt, Reparatur eindeutiger Fehler, die 14 Live-Versuche der QA,
// KARTE-WIEDERHOLT sichtbar
// =================================================================================================================
async function b1FixTests(T) {
  const { katalog, env, ok, bad, skip, safe, check, ctxNT, ctxOT } = T;
  const T14 = '14 B1-FIX';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const lp0 = env.lp ? env.lp() : null;
  if (!lp0) { skip(T14, 'B1-FIX Vorgaben/Reparatur', 'server/sim/landepunkte.js fehlt (BUEHNE)'); return; }
  const LIVE = path.join(FIX, 'llm', 'b1-live');
  const lpWelt = () => { const w = JSON.parse(fs.readFileSync(path.join(LIVE, '_welt.json'), 'utf8')); return Context.lpAdapterAusWelt({ meta: w.meta, welt: w.welt }); };
  const live = fs.existsSync(LIVE) ? fs.readdirSync(LIVE).filter((f) => /^\d+_.*\.json$/.test(f)).sort().map((f) => Object.assign({ file: f }, JSON.parse(fs.readFileSync(path.join(LIVE, f), 'utf8')))) : [];
  const lineOf = (v, uid) => (v.split('\n').find((l) => l.startsWith(`- ${uid}:`)) || '');

  // 1. Vorgaben: Landepunkte je Umsetzung stimmen mit aufloesen überein (jede genannte Kombination löst ohne Bühnenfehler auf)
  await safe(T14, 'Vorgaben: passende Landepunkte je Bodenumsetzung = was aufloesen annimmt; wreck nie für Gefecht', () => {
    const v = SB.grobplanVorgaben(env, ctxNT, { lp: lp0, dauer: { soll: 15, min: 12, max: 18 } });
    const fails = []; let pairs = 0;
    for (const mol of Object.values(katalog.molekuele).filter((m) => m.status === 'verfuegbar')) {
      for (const u of mol.umsetzungen.filter((x) => x.status === 'verfuegbar' && x.schauplatz === 'aussen')) {
        const r = SB.passendeLandepunkte(u, env, ctxNT, { lp: lp0 });
        for (const [ort, ids] of Object.entries(r.orte)) for (const id of ids) {
          pairs++;
          const g = b1Plan([{ id: 's2_x', ort, szenentyp: 'gefecht', landepunkt: id, mols: [`${mol.id}/${u.id}`] }]);
          const a = SB.aufloesen(g, env, ctxNT, { lp: lp0 });
          if (a.errors.length) fails.push(`${mol.id}/${u.id}@${id}: ${a.errors[0]}`);
        }
      }
    }
    const wreckIn = (uid) => /\bwreck\b/.test(lineOf(v, uid));
    const res = { pairs: pairs >= 20, konsistent: !fails.length, durchbrechenOhneWreck: !wreckIn('durchbrechen/bis_zum_ziel'), entkommenOhneWreck: !wreckIn('entkommen/zu_den_pads'),
      raeumenOhneWreck: !wreckIn('stellung_nehmen/trupp_raeumen'), ausschlachtenMitWreck: wreckIn('ausschlachten/wrack_container'), plattformNur: /nur platform/.test(lineOf(v, 'datenkern_bergen/plattform_kern')),
      dauerHart: /zielspieldauer_min: 15; .*12–18/.test(v), umlaute: /keine Umlaute/.test(v) };
    check(T14, 'Vorgaben: passende Landepunkte je Bodenumsetzung = was aufloesen annimmt; wreck nie für Gefecht', Object.values(res).every(Boolean), `${JSON.stringify(res)}; ${pairs} Paare; ${fails.slice(0, 3).join(' | ') || 'alle auflösbar'}; ${v.length} Zeichen`);
  });

  // 2. Vorgaben: Erinnerung als Aufzählung (kein neutral, wenn es Fakten gibt), Tutorial-Wörter, gerade gespielte Landepunkte
  await safe(T14, 'Vorgaben: erlaubte Erinnerungen, verbotene Tutorial-Wörter, ↺ für gerade gespielte Landepunkte', () => {
    const ctxSkip = Object.assign(clone(ctxOT), { tutorial: 'uebersprungen', fakten: { b7: 'sendet', datenkern: 'konkordat', tafel_von_kesh: 'konkordat_archiv', tutorial: 'uebersprungen' },
      bodenbilanz: { letzte: [{ titel: 'Davor', boden: true, landepunkte: ['kesh.kastell'] }], pflicht_jetzt: false, lang_ab_min: 25 } });
    const v = SB.grobplanVorgaben(env, ctxSkip, { lp: lp0 });
    const leer = Object.assign(clone(ctxOT), { fakten: { tutorial: 'uebersprungen' }, npc: (ctxOT.npc || []).map((n) => Object.assign({}, n, { gedaechtnis: [] })) });
    const v2 = SB.grobplanVorgaben(env, leer, { lp: lp0 });
    const er = v.split('\n').find((l) => l.startsWith('erinnerung')) || '';
    const res = { fakten: /b7, datenkern, tafel_von_kesh/.test(er) && !/tutorial/.test(er), keinNeutral: /kein neutral/.test(er) && !/"neutral": true/.test(er),
      neutralOhne: /\{"neutral": true\}/.test(v2), tabu: /nirgends erwähnen \(kein Fakt\): Ivo, Nachhut\./.test(v), recent: /kesh\.kastell \([^)]*\) ↺/.test(v) };
    check(T14, 'Vorgaben: erlaubte Erinnerungen, verbotene Tutorial-Wörter, ↺ für gerade gespielte Landepunkte', Object.values(res).every(Boolean), `${JSON.stringify(res)}; ${er}`);
  });

  // 3. Reparatur: nur eindeutige Fälle
  await safe(T14, 'Reparatur: Umlaut-Ausgang, leere Dublette, Anflug ohne Molekül, neu:-Folgen, Dauer – Mehrdeutiges bleibt', () => {
    const base = () => b1Plan([{ id: 's2_kastell', ort: 'kesh', szenentyp: 'raetselort', landepunkt: 'kesh.kastell', mols: ['raetsel_loesen/zwei_schluessel'], dauer: 4 },
      { id: 's3_raus', ort: 'kesh', szenentyp: 'rueckzug', landepunkt: 'kesh.kastell', mols: ['entkommen/zu_den_pads'], dauer: 4 }]);
    const R = (g) => SB.repairGrobplan(g, env, { minMinutes: 10, maxMinutes: 35 });
    // Umlaut-Schlüssel
    const g1 = base(); g1.ausgaenge = { erfolg: g1.ausgaenge.erfolg, 'teilerfüllt': g1.ausgaenge.teil }; g1.szenen[2].weiter[1].nach = 'ausgang:teilerfüllt';
    const r1 = R(g1);
    const umlaut = 'teilerfuellt' in g1.ausgaenge && g1.szenen[2].weiter[1].nach === 'ausgang:teilerfuellt' && !SB.checkGrobplan(g1, env).some((e) => /teilerf|Ausgang/.test(e)) && r1.length === 1;
    // Anflug ohne Molekül: weg (Vorgänger zeigt auf die Folgeszene); mit Entscheidung: bleibt
    const anflug = () => { const g = base(); g.szenen.splice(1, 0, { id: 's2_anflug', szenentyp: 'annaeherung_und_erkundung', ort: 'kesh', molekuele: [], sachverhalt: 'Anflug.', wendung: null, dauer_min: 2, weiter: [{ wenn: 'immer', nach: 's2_kastell' }] }); g.szenen[0].weiter = [{ wenn: 'immer', nach: 's2_anflug' }]; return g; };
    const g2 = anflug(); R(g2);
    const g2b = anflug(); g2b.entscheidungen = [{ szene: 's2_anflug', frage: 'Bluff?', optionen: [{ id: 'a', text: 'A', folge: 'x' }, { id: 'b', text: 'B', folge: 'y' }] }]; R(g2b);
    const anflugWeg = g2.szenen.length === 3 && g2.szenen[0].weiter[0].nach === 's2_kastell' && !SB.checkGrobplan(g2, env).some((e) => /Moleküle|erreichbar|Folgeszene/.test(e));
    const anflugBleibt = g2b.szenen.some((s) => s.id === 's2_anflug');
    // leere Dublette
    const g3 = base(); g3.szenen.splice(2, 0, Object.assign(clone(g3.szenen[1]), { molekuele: [] })); R(g3);
    const dublette = g3.szenen.filter((s) => s.id === 's2_kastell').length === 1 && g3.szenen.find((s) => s.id === 's2_kastell').molekuele.length === 1;
    // neue NSC in Folgen
    const g4 = base(); g4.ausgaenge.erfolg.folgen.push('npc_gedaechtnis neu:Inspektor Varn: Varn ist gerettet.', 'npc_haltung neu:Inspektor Varn +1'); R(g4);
    const neuNsc = g4.ausgaenge.erfolg.folgen.includes('welt_fakt inspektor_varn: Varn ist gerettet.') && !g4.ausgaenge.erfolg.folgen.some((f) => /neu:/.test(f)) && !SB.checkGrobplan(g4, env).some((e) => /unbekannten NSC/.test(e));
    // Dauer: Summe gilt, wenn sie im Rahmen liegt; sonst bleibt der Fehler
    const g5 = base(); g5.zielspieldauer_min = 30; R(g5);
    const dauer = g5.zielspieldauer_min === Math.round(SB.planDauer(g5, env).plan) && !SB.checkGrobplan(g5, env).some((e) => /^Dauer/.test(e));
    const g6 = base(); g6.szenen.forEach((s) => { s.dauer_min = 1; }); g6.zielspieldauer_min = 15; R(g6);
    const kurzBleibt = g6.zielspieldauer_min === 15 && SB.checkGrobplan(g6, env).some((e) => /^Dauer/.test(e));
    // 7 Szenen mit Molekülen: nicht eindeutig, welche weg soll -> bleibt
    const g7 = b1Plan(Array.from({ length: 6 }, (_, i) => ({ id: `s${i + 2}_x`, ort: 'kesh', szenentyp: 'rueckzug', landepunkt: 'kesh.kastell', mols: ['entkommen/zu_den_pads'], dauer: 2 })));
    R(g7);
    const res = { umlaut, anflugWeg, anflugBleibt, dublette, neuNsc, dauer, kurzBleibt, siebenBleiben: g7.szenen.length === 7 };
    check(T14, 'Reparatur: Umlaut-Ausgang, leere Dublette, Anflug ohne Molekül, neu:-Folgen, Dauer – Mehrdeutiges bleibt', Object.values(res).every(Boolean), `${JSON.stringify(res)}; ${r1.join(' | ')}`);
  });

  // 3b. Karte zur Laufzeit (kapern/prise_entern -> <loc>.prise): kein Landepunkt verlangt, Bodenszene zählt
  await safe(T14, 'Laufzeit-Karte: prise_entern ohne Landepunkt einplanbar, zählt als Bodenszene', () => {
    const u = (katalog.molekuele.kapern || { umsetzungen: [] }).umsetzungen.find((x) => x.id === 'prise_entern');
    if (!u || u.status !== 'verfuegbar') { skip(T14, 'Laufzeit-Karte: prise_entern ohne Landepunkt einplanbar, zählt als Bodenszene', 'kapern/prise_entern nicht verfügbar (KATALOG)'); return; }
    const plan = (extra) => b1Plan([Object.assign({ id: 's2_prise', ort: 'splitter', szenentyp: 'gefecht', mols: ['kapern/prise_entern'], dauer: 8 }, extra || {}),
      { id: 's3_heim', ort: 'hafen', szenentyp: 'ablieferung', mols: ['ladung_liefern/im_hafen_abgeben'], dauer: 2 }]);
    const g = plan(); const a = SB.aufloesen(g, env, ctxNT, { lp: lp0 });
    const errs = [...a.errors, ...SB.checkGrobplan(g, env), ...SB.checkGrobplanB1(g, env, ctxNT).errors];
    const b = SB.buildBook(g, {}, env, { id: 'sl_1_prise', kontext: ctxNT });
    const g2 = plan({ landepunkt: 'splitter.treibgut' }); const a2 = SB.aufloesen(g2, env, ctxNT, { lp: lp0 });
    const v = SB.grobplanVorgaben(env, ctxNT, { lp: lp0 });
    const res = { gueltig: !errs.length, buch: !b.errors.length, boden: SB.bodenInfo(g, env).boden === true, laufzeit: u.buehne_braucht.landepunkt === 'laufzeit',
      landepunktIgnoriert: !a2.errors.length && !g2.szenen[1].landepunkt && a2.warnings.some((w) => /Laufzeit/.test(w)), prompt: /prise_entern: Prise entern \(nach Raumgefecht\) – ohne landepunkt/.test(v) };
    check(T14, 'Laufzeit-Karte: prise_entern ohne Landepunkt einplanbar, zählt als Bodenszene', Object.values(res).every(Boolean), `${JSON.stringify(res)}; ${[...errs, ...b.errors.map((e) => e.code + ' ' + e.msg), ...a2.errors].slice(0, 4).join(' | ')}`);
  });

  // 4. Die 14 Live-Grobplan-Versuche der QA-B1 (tools/fixtures/llm/b1-live) offline durch die Prüfkette wie handleGrobplan
  if (!live.length) skip(T14, 'Live-Versuche QA-B1 offline', 'tools/fixtures/llm/b1-live fehlt');
  else await safe(T14, `Live-Grobpläne QA-B1 offline: gültig nach Reparatur (live 6/${live.length})`, () => {
    const lp = lpWelt();
    const envL = Object.assign({}, env, { lp: () => lp });
    const rows = []; const gueltig = [];
    const ERWARTET = ['03_', '07_', '08_', '09_', '11_', '13_', '14_'];   // 03 neu gültig: Umlaut-Ausgang repariert
    for (const r of live) {
      const k = r.kontext; const errs = [];
      let g = null; try { g = SB.parseJsonAnswer(r.antwort); } catch (e) { errs.push('JSON: ' + e.message); }
      if (g) {
        SB.normalizeGrobplan(g); SB.repairGrobplan(g, envL, { minMinutes: 10, maxMinutes: 35 });
        const auf = SB.aufloesen(g, envL, k, { lp });
        errs.push(...SB.checkGrobplan(g, envL), ...auf.errors, ...SB.checkGrobplanS2(g, envL, k, { origin: 'sl', minMinutes: 10, maxThreads: 1, crew: k.crew.anzahl }).errors,
          ...SB.checkGrobplanB1(g, envL, k, { langImAngebot: r.lang_im_angebot, lp }).errors);
        if (!errs.length) { const b = SB.buildBook(g, {}, envL, { id: 'sl_1_' + SB.slug(g.id, 20), kontext: k, marks: g.belohnung_marken }); errs.push(...SB.explainBookErrors(g, b.errors, envL)); }
      }
      if (!errs.length) gueltig.push(r.file);
      rows.push(`${r.file.slice(0, 11)}${errs.length ? ' ✗ ' + errs.map((e) => String(e).split(':')[0].slice(0, 30)).join(', ') : ' ✓'}`);
    }
    const same = JSON.stringify(gueltig.map((f) => f.slice(0, 3))) === JSON.stringify(ERWARTET);
    check(T14, `Live-Grobpläne QA-B1 offline: gültig nach Reparatur (live 6/${live.length})`, same, `${gueltig.length}/${live.length} gültig; ${rows.join(' · ')}`);
  });

  // 5. F14: KARTE-WIEDERHOLT (mit Seed) steht im Regielog vorn – im Live-Lauf ging es hinter Besetzungs-Warnungen verloren
  const m6 = live.find((r) => /0518eccb/.test(r.file));
  if (!m6) skip(T14, 'F14 KARTE-WIEDERHOLT im Regielog', 'Live-Versuch 14_0518eccb fehlt');
  else await safe(T14, 'F14: KARTE-WIEDERHOLT (Landepunkt + Seed) im Regielog sichtbar, auch bei vielen Besetzungs-Warnungen', async () => {
    const F = fakeGame(); F.g.players = [{ connected: true }];
    const llm = LLM.create({ mode: 'script', katalog, script: { grobplan: [{ text: m6.antwort }] } });
    const sl = Spielleiter.create(F.g, { llm, kontext: () => clone(m6.kontext), lp: lpWelt(), archiv: [], regieDir: tmpDir('regie14'), katalog, config: { offers: 1 } });
    sl.onMissionDone({ id: 'm3' });
    await ticks(sl, F.g, 20, 0.25, () => sl.offers().some((o) => o.origin === 'sl'));
    const e = sl.regie.entries.find((x) => x.art === 'grobplan' && x.quelle === 'llm' && x.mission) || {};
    const plan = Object.values(sl.plans).find((p) => p.grobplan && p.grobplan.id === 'langschiff_kapern') || Object.values(sl.plans).find((p) => p.slot === 'sl') || {};
    const warns = plan.warnungen || [];
    const alt = warns.join(' | ').indexOf('KARTE-WIEDERHOLT');
    const b = String(e.begruendung || '');
    const res = { gueltig: !!e.mission, warnung: warns.some((w) => /^KARTE-WIEDERHOLT: Landepunkt 'wrack\.langschiff' \(Seed \d+\)/.test(w)),
      imLog: /KARTE-WIEDERHOLT: Landepunkt 'wrack\.langschiff' \(Seed \d+\)/.test(b) && b.length <= 500, vorn: b.indexOf('KARTE-WIEDERHOLT') < 80, warAltVerdeckt: alt > 400 || alt < 0 };
    check(T14, 'F14: KARTE-WIEDERHOLT (Landepunkt + Seed) im Regielog sichtbar, auch bei vielen Besetzungs-Warnungen', Object.values(res).every(Boolean), `${JSON.stringify(res)}; Begründung: ${b.slice(0, 220)}; Fehler ${F.errors.join(' | ') || '–'} ${JSON.stringify(e.fehler || [])}`);
  });
}

// =================================================================================================================
// S2b-Tests (CONTRACT-S2B §4): Rohfassung plan-treu, Sprecher ∈ Besetzung, ERINNERUNG-WIDERSPRUCH, Belohnung,
// Reparatur einfacher Szenenfehler, Szenen-Prompt-Größe, Vorlauf
// =================================================================================================================
function loadS2bPlan(name) { return JSON.parse(fs.readFileSync(path.join(FIX, 'llm', 's2b', name + '.grobplan.json'), 'utf8')).grobplan; }
const radiosOf = (steps) => [...new Set((JSON.stringify(steps).match(/"from":"[^"]+"/g) || []).map((x) => x.slice(8, -1)))];
async function s2bTests(T) {
  const { katalog, env, ok, bad, safe, check, ctxNT, AR } = T;
  const T12 = '12 S2b';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // 1. Rohfassung ohne Fremd-NSC (Fall „Sela funkt in Grauzahns Mission“, „Grauzahn droht als Gegner“)
  await safe(T12, 'Rohfassung ohne Fremd-NSC (Grauzahn-/Sela-Mission aus der S2-Abnahme)', () => {
    const out = [];
    for (const name of ['splitter-grauzahn', 'fluesterer-sela']) {
      const g = loadS2bPlan(name); SB.normalizeGrobplan(g);
      const r = SB.buildBook(g, {}, env, { id: 'sl_9_' + name.replace(/-/g, '_'), kontext: ctxNT });
      const cast = SB.missionCast(g, env);
      const foreign = radiosOf(r.book.steps).filter((f) => !cast.named.has(f) && !/^neu_/.test(f));
      const spk = r.warnings.filter((w) => /SPRECHER/.test(w));
      // Gegenüber-Rollen (Bluff, Abwehr) funken nie als Auftraggeber
      const hostile = r.book.steps.filter((st) => /^(taeuschen|vertreiben|vernichten|verhandeln|system_ausschalten)\//.test(st.umsetzung || ''));
      const threat = radiosOf(hostile).filter((f) => f === g.auftraggeber);
      if (r.errors.length || foreign.length || spk.length || threat.length) out.push(`${name}: Fehler ${r.errors.map((e) => e.code).join(',') || '–'}, Fremd-NSC ${foreign.join(',') || '–'}, Auftraggeber als Gegner ${threat.length}`);
    }
    check(T12, 'Rohfassung ohne Fremd-NSC (Grauzahn-/Sela-Mission aus der S2-Abnahme)', !out.length, out.join(' | ') || 'Funk nur Besetzung/neue Stimmen, Gegner nie der Auftraggeber');
  });
  await safe(T12, 'Rohfassung plan-treu: stimme, ziel_name, Schiffsklasse, belohnung_marken', () => {
    const g = loadS2bPlan('splitter-grauzahn'); SB.normalizeGrobplan(g);
    const bl = g.szenen.find((s) => s.id === 's3_entscheidung_bluff'); bl.stimme = 'neu:Inspektor Varn';
    const ph = g.szenen.find((s) => s.id === 's4_pannenhilfe'); ph.ziel_name = 'Frachter Schiefmaul';
    g.belohnung_marken = 140;
    const r = SB.buildBook(g, {}, env, { id: 'sl_9_split', kontext: ctxNT, marks: g.belohnung_marken });
    const bluff = r.book.steps.filter((st) => /^s3_entscheidung_bluff/.test(st.id));
    const ship = r.book.besetzung.schiffe && r.book.besetzung.schiffe.s4_pannenhilfe;
    const lohn = Object.values(r.book.ausgaenge).map((a) => (a.folgen.find((x) => x.reward) || { reward: { marks: 0 } }).reward.marks);
    const fine = !r.errors.length && radiosOf(bluff).includes('neu_inspektor_varn') && !radiosOf(bluff).includes('grauzahn') && ship && ship.kind === 'frachter' && ship.name === 'Frachter Schiefmaul'
      && r.book.texte['buch.belohnung'] === '140 Marken' && Math.max(...lohn) === 140 && r.book.besetzung.stimmen && r.book.besetzung.stimmen.neu_inspektor_varn;
    check(T12, 'Rohfassung plan-treu: stimme, ziel_name, Schiffsklasse, belohnung_marken', fine,
      `Funk Bluff ${radiosOf(bluff).join(',')}; Schiff ${JSON.stringify(ship)}; Belohnung ${r.book.texte['buch.belohnung']} / Ausgänge ${lohn.join(',')}; Fehler ${r.errors.map((e) => e.code + ' ' + e.p).join(' | ') || '–'}`);
  });
  // 2. Sprecher ∈ Besetzung
  await safe(T12, 'Prüfregel SPRECHER: Fremd-NSC in einer LLM-Szene → Rohfassung, unbekannte stimme → Grobplanfehler', () => {
    const g = loadS2bPlan('splitter-grauzahn'); SB.normalizeGrobplan(g);
    const s = g.szenen.find((x) => x.id === 's4_pannenhilfe');
    const ans = { molekuele: [{ id: 'pannenhilfe', umsetzung: 'andocken_und_flicken', params: { loc: 'splitter', funk_npc: 'sela', mit_angriff: true } }], verzweigung: [], wendung: { kennung: 'stoerer', nach_s: 40, ankuendigung: 'Ortung: Kontakt!', wirkung: [{ oda: 'Jäger im Anflug.' }] } };
    const r = SB.buildBook(g, { [s.id]: { answer: ans, quelle: 'llm' } }, env, { id: 'sl_9_spk', kontext: ctxNT });
    const info = r.szenen[s.id];
    const ok1 = info.quelle === 'rohfassung' && info.fehler.some((f) => /^SPRECHER: 'sela'/.test(f));
    const ans2 = clone(ans); ans2.molekuele[0].params.funk_npc = 'grauzahn';
    const r2 = SB.buildBook(g, { [s.id]: { answer: ans2, quelle: 'llm' } }, env, { id: 'sl_9_spk', kontext: ctxNT });
    const ans3 = clone(ans); ans3.molekuele[0].params.funk_npc = 'neu:Kapitän Orr';
    const r3 = SB.buildBook(g, { [s.id]: { answer: ans3, quelle: 'llm' } }, env, { id: 'sl_9_spk', kontext: ctxNT });
    const g4 = clone(g); g4.szenen[1].stimme = 'quatschkopf';
    const e4 = SB.checkGrobplanS2(g4, env, ctxNT, { origin: 'sl' }).errors.filter((e) => /SPRECHER/.test(e));
    // GEGNER-AUFTRAGGEBER (Live-Befund „Grauzahns Preis“: stimme grauzahn in seiner eigenen Abwehr-Szene)
    const g5 = clone(g); g5.szenen.find((x) => x.id === 's5_abwehr').stimme = 'grauzahn';
    const e5 = SB.checkGrobplanS2(g5, env, ctxNT, { origin: 'sl' }).errors.filter((e) => /^GEGNER-AUFTRAGGEBER/.test(e));
    const r5 = SB.buildBook(g5, {}, env, { id: 'sl_9_g5', kontext: ctxNT });
    const abw = r5.book.steps.filter((st) => /^s5_abwehr/.test(st.id));
    const ok2 = r2.szenen[s.id].quelle === 'llm' && r3.szenen[s.id].quelle === 'llm' && !r3.errors.length && e4.length === 1 && e5.length === 1 && !radiosOf(abw).includes('grauzahn');
    check(T12, 'Prüfregel SPRECHER: Fremd-NSC in einer LLM-Szene → Rohfassung, unbekannte stimme → Grobplanfehler', ok1 && ok2,
      `sela: ${info.quelle} (${info.fehler.slice(0, 1).join('')}); grauzahn: ${r2.szenen[s.id].quelle}; neu: ${r3.szenen[s.id].quelle} ${r3.errors.map((e) => e.code).join(',')}; stimme quatschkopf: ${e4.join(' | ')}`);
  });
  // 3. ERINNERUNG-WIDERSPRUCH + Belohnung
  await safe(T12, 'Prüfregel ERINNERUNG-WIDERSPRUCH (Datenkern „an Bord“, obwohl beim Konkordat)', () => {
    const g = loadS2bPlan('fluesterer-sela'); SB.normalizeGrobplan(g);
    const k = (f) => Object.assign({}, ctxNT, { fakten: Object.assign({}, ctxNT.fakten, f) });
    const err = SB.checkGrobplanS2(g, env, k({ datenkern: 'konkordat' }), { origin: 'sl' }).errors.filter((e) => /^ERINNERUNG-WIDERSPRUCH/.test(e));
    const fine = SB.checkGrobplanS2(g, env, k({ datenkern: 'lerche' }), { origin: 'sl' }).errors.filter((e) => /^ERINNERUNG-WIDERSPRUCH/.test(e));
    const arch = SB.checkGrobplanS2(g, env, k({ datenkern: 'konkordat' }), { origin: 'archiv' });
    const tafel = SB.factContradictions(['Die Tafel liegt bei euch im Laderaum.', 'Melk hütet die Tafel im Archiv.'], { tafel_von_kesh: 'konkordat_archiv' });
    const scene = SB.factContradictions(SB.answerTexts({ molekuele: [{ params: { funk_start: 'Ihr habt den Datenkern noch an Bord, oder?' } }] }), { b7_datenkern: 'konkordat' });
    check(T12, 'Prüfregel ERINNERUNG-WIDERSPRUCH (Datenkern „an Bord“, obwohl beim Konkordat)', err.length === 1 && !fine.length && arch.warnings.some((w) => /ERINNERUNG-WIDERSPRUCH/.test(w)) && !arch.errors.some((e) => /ERINNERUNG-WIDERSPRUCH/.test(e)) && tafel.length === 1 && scene.length === 1,
      `konkordat: ${err.join(' | ')}; lerche: ${fine.length}; Archiv nur Warnung; Tafel ${tafel.length}; Szene ${scene.length}`);
  });
  await safe(T12, 'Belohnung nur als belohnung_marken (Fall 80 im Text vs. 190 im Buch)', () => {
    const g = loadS2bPlan('splitter-grauzahn');
    const reps = SB.normalizeGrobplan(g);
    const noMarks = Object.values(g.ausgaenge).every((a) => !a.folgen.some((f) => /marken/i.test(String(f))));
    const g2 = loadS2bPlan('fluesterer-sela'); SB.normalizeGrobplan(g2);   // „Sie bietet 80 Marken“ -> belohnung_marken 80
    const g3 = loadS2bPlan('fluesterer-sela'); g3.belohnung_marken = 190;
    const e3 = SB.checkGrobplanS2(g3, env, ctxNT, { origin: 'sl' }).errors.filter((e) => /^BELOHNUNG-WIDERSPRUCH/.test(e));
    const b2 = SB.buildBook(g2, {}, env, { id: 'sl_9_b', kontext: ctxNT, marks: g2.belohnung_marken });
    check(T12, 'Belohnung nur als belohnung_marken (Fall 80 im Text vs. 190 im Buch)', noMarks && g.belohnung_marken === 80 && reps.some((x) => /entfernt/.test(x)) && g2.belohnung_marken === 80 && b2.book.texte['buch.belohnung'] === '80 Marken' && e3.length >= 1,
      `Splitter: ${g.belohnung_marken} (${reps.length} Reparaturen); Flüsterer: ${g2.belohnung_marken} -> Buch ${b2.book.texte['buch.belohnung']}; 190 vs. Text: ${e3.slice(0, 1).join('')}`);
  });
  // 4. Reparatur einfacher Szenenfehler
  await safe(T12, 'Reparatur: Verzweigung ohne Einträge, Flag ohne Folge, setFlag-Form, Anführungszeichen, doppeltes weiter', async () => {
    const g = LLM.mockGrobplan({ kontext: ctxNT }, katalog);
    const s = g.szenen[2];   // zwei Ziele (Ausgänge)
    const base = JSON.parse((await LLM.create({ mode: 'mock', katalog }).ask('szene', { grobplan: g, szene: s.id })).text);
    const cases = {};
    const a1 = clone(base); a1.verzweigung = [];
    const a2 = clone(base); a2.verzweigung = [{ nach: 'ausgang:erfolg', if: { flag: 's3_gibt_es_nicht' } }, { nach: 'ausgang:teilerfolg' }];
    const a3 = clone(base); a3.verzweigung = [{ nach: 'ausgang:teilerfolg' }, { nach: 'ausgang:erfolg', if: { flag: 's3_wahl' } }, { nach: 'ausgang:quatsch' }];
    for (const [k, a] of Object.entries({ leer: a1, flag: a2, reihenfolge: a3 })) {
      const before = SB.assembleScene(g, s, a, env, { book: true }).fehler.length;
      const rep = SB.repairSceneAnswer(g, s, a, env);
      const r = SB.buildBook(g, { [s.id]: { answer: rep.answer, quelle: 'llm' } }, env, { id: 'sl_9_rep', kontext: ctxNT });
      cases[k] = { vorher: before, reparaturen: rep.repairs.length, quelle: r.szenen[s.id].quelle, fehler: r.errors.length };
    }
    // Anführungszeichen: „…" (ASCII-Schluss) im JSON
    let parsed = null; try { parsed = SB.parseJsonAnswer(JSON.stringify({ x: 'a' }).replace('"a"', '"Er sagt „Halt" und geht."')); } catch (e) { parsed = null; }
    // doppeltes weiter im Grobplan -> eine Verzweigung genügt
    const gd = clone(g); gd.szenen[1].weiter = [{ wenn: 'a', nach: s.id }, { wenn: 'b', nach: s.id }];
    const repG = SB.normalizeGrobplan(gd);
    const ok1 = Object.values(cases).every((c) => c.vorher > 0 && c.reparaturen > 0 && c.quelle === 'llm' && c.fehler === 0);
    check(T12, 'Reparatur: Verzweigung ohne Einträge, Flag ohne Folge, setFlag-Form, Anführungszeichen, doppeltes weiter', ok1 && parsed && /Halt/.test(parsed.x) && gd.szenen[1].weiter.length === 1 && repG.length === 1,
      `${JSON.stringify(cases)}; Anführungszeichen ${parsed ? 'repariert' : 'nicht lesbar'}; doppeltes weiter ${gd.szenen[1].weiter.length}`);
    // setFlag {"name": "s3_x"} -> {"s3_x": true}
    const a4 = clone(base); const n = Object.keys(a4.molekuele[0].params).find((p) => Array.isArray(a4.molekuele[0].params[p]));
    if (n) {
      a4.molekuele[0].params[n] = [{ setFlag: { name: 's3_gewaehlt' } }]; a4.verzweigung = [{ nach: 'ausgang:erfolg', if: { flag: 's3_gewaehlt' } }, { nach: 'ausgang:teilerfolg' }];
      const rep4 = SB.repairSceneAnswer(g, s, a4, env);
      check(T12, 'Reparatur: setFlag {"name": …} → {flag: true}', JSON.stringify(rep4.answer.molekuele[0].params[n]) === '[{"setFlag":{"s3_gewaehlt":true}}]' && rep4.answer.verzweigung[0].if.flag === 's3_gewaehlt', JSON.stringify(rep4.answer.molekuele[0].params[n]));
    }
  });
  await safe(T12, 'Live-Befunde S2b: wendung "null", ODA-Text aus Parametern zu lang, Flag aus früherer Szene, Spawn am Händlerort', async () => {
    // 1. Grobplan mit "wendung": "null" verlangt keine Wendung
    const g = LLM.mockGrobplan({ kontext: ctxNT }, katalog); g.szenen[1].wendung = 'null';
    const rep = SB.normalizeGrobplan(g);
    const a = LLM.mockSzene({ grobplan: g, szene: g.szenen[1].id }, katalog);
    const w = SB.assembleScene(g, g.szenen[1], a, env, { book: true }).fehler.filter((x) => /Wendung/.test(x));
    // 2. ODA-Text aus einem Parameter (Vorlage oda "@id.x") > 120 Zeichen wird gekürzt
    const gs = loadS2bPlan('splitter-grauzahn'); SB.normalizeGrobplan(gs);
    const s2 = gs.szenen[1]; s2.wendung = null;
    const ans = SB.rohAnswer(gs, s2, env);
    const long = 'Ortung: ' + 'sehr '.repeat(40) + 'weit draußen.';
    const u = SB.umsetzungOf(env, s2.molekuele[0]);
    const tp = Object.keys(u.params).find((p) => u.params[p].typ === 'text');
    if (tp) ans.molekuele[0].params[tp] = long;
    const b = SB.buildBook(gs, { [s2.id]: { answer: ans, quelle: 'llm' } }, env, { id: 'sl_9_oda', kontext: ctxNT });
    const odaLen = b.errors.filter((e) => e.code === 'ODA-LAENGE');
    // 3. Verzweigung auf eine Flag, die eine andere Szene setzt
    const known = SB.planFlags(gs, { s2_splitter_suche: { answer: { molekuele: [{ params: { x: [{ setFlag: { s2_frueh: true } }] } }] } } }, env);
    // 4. Spawn-Timer an einem Händlerort (Vaelen) ist abgesichert (pannenhilfe: Angriff per Timer); Spawn beim Betreten
    //    (vertreiben) bleibt NEUSTART, wird für die Nachbesserung aber als „nicht an diesem Ort“ erklärt
    const gv = clone(gs); gv.szenen.find((x) => x.id === 's4_pannenhilfe').ort = 'vaelen';
    for (const x of gv.szenen) if (x.id !== 's1_hafen') x.ort = 'vaelen';
    const bv = SB.buildBook(gv, {}, env, { id: 'sl_9_vae', kontext: ctxNT });
    const neu4 = bv.errors.filter((e) => e.code === 'NEUSTART');
    const expl = SB.explainBookErrors(gv, neu4, env);
    // ODA aus Parameter: Bergungskisten (auftraggeber_hinweis wird ODA-Text) – Live-Befund s2_splitter_bergen
    const gk = clone(gs); gk.szenen[1].molekuele = [{ id: 'ladung_bergen', umsetzung: 'bergungskisten' }];
    const ak = SB.rohAnswer(gk, gk.szenen[1], env); ak.molekuele[0].params.auftraggeber_hinweis = long;
    const bk = SB.buildBook(gk, { [gk.szenen[1].id]: { answer: ak, quelle: 'llm' } }, env, { id: 'sl_9_oda2', kontext: ctxNT });
    check(T12, 'Live-Befunde S2b: wendung "null", ODA-Text aus Parametern zu lang, Flag aus früherer Szene, Spawn am Händlerort',
      rep.some((x) => /wendung/.test(x)) && g.szenen[1].wendung === null && !w.length && !odaLen.length && b.szenen[s2.id].quelle === 'llm' && known.has('s2_frueh')
      && !neu4.length && expl.length === 0 && bv.book.steps.some((x) => /_ablegen$/.test(x.id) && x.loc === 'vaelen')
      && bv.book.steps.filter((x) => x.wiederaufnahme && /_ablegen$/.test(x.wiederaufnahme.ab)).every((x) => bv.book.steps.some((y) => y.id === x.wiederaufnahme.ab)) && bk.szenen[gk.szenen[1].id].quelle === 'llm' && !bk.errors.some((e) => e.code === 'ODA-LAENGE'),
      `wendung: ${rep.join('; ')}; ODA-LAENGE ${odaLen.length}/${bk.errors.filter((e) => e.code === 'ODA-LAENGE').length} (Bergung: ${bk.szenen[gk.szenen[1].id].quelle}); Flag bekannt ${known.has('s2_frueh')}; NEUSTART bei Vaelen ${neu4.length} (${neu4.map((e) => e.p).join(',')}), Wartepunkte ${bv.book.steps.filter((x) => /_ablegen$/.test(x.id)).map((x) => x.id).join(',')}, Prüferfehler ${bv.errors.length}`);
  });
  await safe(T12, 'QA S2b: ohne Tutorial – Meta-Fakt tutorial wird neutrale Erinnerung, Lohn 0 nie „0 Marken“', async () => {
    const g = LLM.mockGrobplan({ kontext: ctxNT }, katalog);
    g.erinnerung = { fakt: 'tutorial' }; g.erinnerung_text = 'Ihr habt das Tutorial übersprungen, Lerche.';
    const rep = SB.normalizeGrobplan(g);
    const leer = { fakten: { tutorial: 'uebersprungen' }, npc: [{ id: 'tesk', gedaechtnis: [] }] };
    const voll = { fakten: { tutorial: 'uebersprungen', datenkern: 'konkordat' }, npc: [{ id: 'tesk', gedaechtnis: [] }] };
    const errLeer = SB.checkGrobplanS2(g, env, leer).errors.filter((e) => /Erinnerung/.test(e));
    const errVoll = SB.checkGrobplanS2(g, env, voll).errors.filter((e) => /Erinnerung/.test(e));
    const b = SB.buildBook(g, {}, env, { id: 'sl_9_neutral', kontext: ctxNT, marks: 0 });
    check(T12, 'QA S2b: ohne Tutorial – Meta-Fakt tutorial wird neutrale Erinnerung, Lohn 0 nie „0 Marken“',
      g.erinnerung.neutral === true && g.erinnerung_text === undefined && rep.some((x) => /Meta-Fakt/.test(x)) && !errLeer.length && errVoll.length === 1
      && !b.book.erinnerung && !/\b0 Marken/.test(JSON.stringify(b.book.texte)),
      `Reparaturen ${rep.join('; ')}; Fehler ohne Erinnerungsstoff ${errLeer.length}, mit Fakt ${errVoll.length}; Belohnung „${b.book.texte['buch.belohnung']}“`);
  });
  await safe(T12, 'QA S2b: Gefecht am Andock-Ort – Wartepunkt „Ablegen“, Laden angedockt nimmt dort auf, Kampf erst nach dem Ablegen', async () => {
    const { Game: G2 } = require('../server/game.js');
    const g = LLM.mockGrobplan({ kontext: ctxNT }, katalog);
    g.szenen[1].ort = 'vaelen'; g.szenen[1].molekuele = [{ id: 'vertreiben', umsetzung: 'bis_zur_flucht' }];
    g.szenen[2].ort = 'vaelen'; g.szenen[2].molekuele = [{ id: 'schuetzen', umsetzung: 'notruf_verteidigen' }];
    const b = SB.buildBook(g, {}, env, { id: 'sl_9_gate', kontext: ctxNT });
    const sid = g.szenen[1].id;
    const gm = new G2({ noStore: true, seed: 3, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const cc = { send() {} }; gm.addConnection(cc); gm.handleMessage(cc, { t: 'hello', clientId: 'A', name: 'A', color: 0 }); gm.handleMessage(cc, { t: 'ready', ready: true });
    const tick = (n) => { for (let i = 0; i < n; i++) gm.step(); };
    tick(30);
    const reg = gm.mission.registerBook(b.book, { origin: 'sl' });
    gm.mission.run([{ do: 'debug_jump', loc: 'vaelen' }]); tick(60);
    gm.mission.run([{ do: 'debug_dock', loc: 'vaelen' }]); tick(30);
    gm.mission.restore({ missionen: { [b.book.id]: { status: 'aktiv', schritt: sid } }, aktiv: b.book.id });
    tick(300);
    const docked = { stage: gm.mission.state.stage, enemies: gm.space.enemies.length };
    const sh = gm.ship; sh.docked = false; sh.dockedAt = null; sh.dockArmed = false; sh.undockT = gm.time; sh.x += 300;
    tick(90);
    const out = { stage: gm.mission.state.stage, enemies: gm.space.enemies.length };
    check(T12, 'QA S2b: Gefecht am Andock-Ort – Wartepunkt „Ablegen“, Laden angedockt nimmt dort auf, Kampf erst nach dem Ablegen',
      !b.errors.length && reg && reg.ok !== false && docked.stage === `${sid}_ablegen` && docked.enemies === 0 && out.stage === sid && out.enemies > 0 && gm.errors === 0,
      `Prüfer ${b.errors.length}; angedockt geladen: ${JSON.stringify(docked)}; nach Ablegen: ${JSON.stringify(out)}; Fehler ${gm.errors}`);
  });
  await safe(T12, 'Pipeline: reparierbare Szene gilt beim 1. Versuch, Sprecherfehler → 2. Versuch mit Prüferfehlern', async () => {
    const F = fakeGame();
    // s2 des Mock-Plans: Testwerte, aber Verzweigung kaputt (hat nur ein Ziel -> wird entfernt); s3: leere Verzweigung
    const gm = LLM.mockGrobplan({ kontext: ctxNT }, katalog);
    const mk = (sid, mut) => { const a = LLM.mockSzene({ grobplan: gm, szene: sid }, katalog); mut(a); return { json: a, tokens: 10 }; };
    const scr = { grobplan: [], szene: [mk('s2_mock', (a) => { a.verzweigung = [{ nach: 'gibt_es_nicht' }]; }), mk('s3_mock', (a) => { a.verzweigung = []; })] };
    const llm = LLM.create({ mode: 'script', katalog, script: scr });
    const sl = Spielleiter.create(F.g, { llm, kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie12'), katalog, config: { offers: 1 } });
    sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
    await ticks(sl, F.g, 10, 0.25, () => sl.offers().some((o) => o.origin === 'sl'));
    const o = sl.offers().find((x) => x.origin === 'sl'); sl.accept(o.id);
    const plan = sl.planById(o.id);
    await ticks(sl, F.g, 10, 0.25, () => ['s2_mock', 's3_mock'].every((x) => ['ready', 'failed'].includes(plan.szenen[x].state)));
    const sz = sl.regie.entries.filter((e) => e.art === 'szene');
    check(T12, 'Pipeline: reparierbare Szene gilt beim 1. Versuch, Sprecherfehler → 2. Versuch mit Prüferfehlern', plan.szenen.s2_mock.state === 'ready' && plan.szenen.s3_mock.state === 'ready' && sz.length === 2 && sz.every((e) => !e.fehler.length && /Reparatur/.test(e.begruendung)) && !F.errors.length,
      `Szenen ${plan.szenen.s2_mock.state}/${plan.szenen.s3_mock.state}; Logbuch: ${sz.map((e) => e.begruendung).join(' | ')}; Fehler ${F.errors.join(' | ') || '–'}`);
    // Sprecherfehler: Retry-Prompt enthält die Prüferfehler
    const F2 = fakeGame();
    const gs = loadS2bPlan('splitter-grauzahn');
    const badAns = { molekuele: [{ id: 'pannenhilfe', umsetzung: 'andocken_und_flicken', params: { loc: 'splitter', funk_npc: 'sela' } }], verzweigung: [], wendung: { kennung: 'stoerer', nach_s: 40, ankuendigung: 'Ortung: Kontakt!', wirkung: [{ oda: 'Jäger.' }] } };
    const llm2 = LLM.create({ mode: 'script', katalog, script: { grobplan: [{ json: gs }], szene: [] } });
    const sl2 = Spielleiter.create(F2.g, { llm: llm2, kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie12b'), katalog, config: { offers: 1 } });
    sl2.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
    await ticks(sl2, F2.g, 10, 0.25, () => sl2.offers().some((x) => x.origin === 'sl'));
    const o2 = sl2.offers().find((x) => x.origin === 'sl');
    if (!o2) { bad(T12, 'SPRECHER → Nachbesserung mit Prüferfehler', `kein SL-Angebot: ${sl2.regie.entries.filter((e) => e.art === 'grobplan').map((e) => e.fehler.join(';')).join(' | ')}`); return; }
    const p2 = sl2.planById(o2.id);
    // nur s4 per Skript beantworten: erst falsch (Sela), dann Mock
    sl2.llm =LLM.create({ mode: 'script', katalog, script: { szene: [] } });
    const order = [];
    const ask0 = sl2.llm.ask; sl2.llm.ask = (kind, input, ao) => { order.push(input.szene); if (input.szene === 's4_pannenhilfe' && !order.slice(0, -1).includes('s4_pannenhilfe')) return Promise.resolve({ text: JSON.stringify(badAns), tokens: 5, source: 'script', key: 'x' }); return ask0(kind, input, ao).then((r) => { if (input.szene === 's4_pannenhilfe') sl2.__retryPrompt = input.prompt; return r; }); };
    sl2.accept(o2.id);
    await ticks(sl2, F2.g, 20, 0.25, () => ['ready', 'failed'].includes(p2.szenen.s4_pannenhilfe.state) && p2.szenen.s4_pannenhilfe.versuche >= 2);
    const e4 = sl2.regie.entries.filter((e) => e.art === 'szene' && e.szene === 's4_pannenhilfe');
    check(T12, 'SPRECHER → Nachbesserung mit Prüferfehler', e4.length === 2 && /SPRECHER/.test(e4[0].fehler.join(' ')) && /<pruefer>[\s\S]*SPRECHER/.test(sl2.__retryPrompt || ''),
      `Versuche ${e4.map((e) => (e.fehler.length ? 'ungültig: ' + e.fehler[0].slice(0, 60) : 'gültig')).join(' → ')}; Retry-Prompt mit Prüferfehler: ${/SPRECHER/.test(sl2.__retryPrompt || '')}`);
  });
  // 5. Szenen-Prompt-Größe (Ziel < 8k Tokens je Szene; ohne Katalog)
  await safe(T12, 'Szenen-Prompt ohne Katalog, geschätzt < 8k Tokens', () => {
    const sys = fs.readFileSync(LLM.systemPromptFile('szene'), 'utf8').length;
    const kat = require('../server/mission/katalog.js').fuerSpielleiter(katalog, 'kurz').length;
    const rows = []; let max = 0; let withKat = false;
    for (const name of ['splitter-grauzahn', 'fluesterer-sela']) {
      const g = loadS2bPlan(name); SB.normalizeGrobplan(g);
      for (const s of g.szenen.filter((x) => (x.molekuele || []).length)) {
        const p = Spielleiter.scenePrompt(g, s.id, env, ctxNT, { crew: 3 });
        if (/<katalog>/.test(p)) withKat = true;
        const est = Math.round((p.length + sys) / 2.5);   // gemessen S2: ~2,5 Zeichen je Token (Deutsch + JSON)
        max = Math.max(max, est); rows.push(`${s.id} ${p.length + sys} Z ≈ ${est}`);
      }
    }
    // Größe der S2-Fassung zum Vergleich: + Katalog-Kurzform
    check(T12, 'Szenen-Prompt ohne Katalog, geschätzt < 8k Tokens', !withKat && max < 6000, `max ≈ ${max} Tokens (ohne CLI-Grundlast; S2 zusätzlich Katalog ${kat} Z ≈ ${Math.round(kat / 2.5)}): ${rows.join(', ')}`);
  });
  // 6. Vorlauf: zwei Szenen nach dem Hafen + Szenen am selben Ort ohne Anflug
  await safe(T12, 'Vorlauf: beim Annehmen bis zur zweiten Szene, Szenen am selben Ort mit; „zu spät“ im Logbuch', async () => {
    const F = fakeGame();
    const g = loadS2bPlan('splitter-grauzahn');   // s2 Anflug (splitter), s3–s5 am selben Ort
    const llm = LLM.create({ mode: 'script', katalog, script: { grobplan: [{ json: g }], szene: [{ hold: true }, { hold: true }, { hold: true }, { hold: true }, { hold: true }] } });
    const sl = Spielleiter.create(F.g, { llm, kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie12c'), katalog, config: { offers: 1 } });
    sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
    await ticks(sl, F.g, 10, 0.25, () => sl.offers().some((x) => x.origin === 'sl'));
    const o = sl.offers().find((x) => x.origin === 'sl');
    if (!o) { bad(T12, 'Vorlauf: beim Annehmen bis zur zweiten Szene, Szenen am selben Ort mit; „zu spät“ im Logbuch', 'kein SL-Angebot'); return; }
    sl.accept(o.id);
    const plan = sl.planById(o.id);
    const req = Object.entries(plan.szenen).filter(([, x]) => x.state === 'requested').map(([k]) => k);
    await ticks(sl, F.g, 1, 0.25);
    const first = llm.calls().filter((c) => c.kind === 'szene').length;
    // s3 betreten, während die Antworten noch ausstehen -> Rohfassung mit Grund „zu spät“
    F.m.step = { id: 's2_splitter_suche' }; sl.update(0.1); await flush();
    F.m.step = { id: 's3_entscheidung_bluff' }; F.g.time += 0.25; sl.update(0.25); await flush();
    const late = sl.regie.entries.filter((e) => e.art === 'rueckfall' && /zu spät/.test(e.begruendung || ''));
    llm.release(); await ticks(sl, F.g, 2);
    const want = ['s2_splitter_suche', 's3_entscheidung_bluff', 's4_pannenhilfe', 's5_abwehr'];
    check(T12, 'Vorlauf: beim Annehmen bis zur zweiten Szene, Szenen am selben Ort mit; „zu spät“ im Logbuch', want.every((x) => req.includes(x)) && first === 1 && late.length >= 1 && late.some((e) => e.szene === 's3_entscheidung_bluff'),
      `angefragt beim Annehmen: ${req.join(', ')}; gleichzeitig laufend ${first}; zu spät: ${late.map((e) => e.szene + ' – ' + e.begruendung).join(' | ') || '–'}`);
    // Reihenfolge: früheste Szene zuerst
    const F2 = fakeGame();
    const llm2 = LLM.create({ mode: 'script', katalog, script: { grobplan: [{ json: g }], szene: [] } });
    const sl2 = Spielleiter.create(F2.g, { llm: llm2, kontext: () => ctxNT, archiv: AR.entries, regieDir: tmpDir('regie12d'), katalog, config: { offers: 1 } });
    sl2.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
    await ticks(sl2, F2.g, 10, 0.25, () => sl2.offers().some((x) => x.origin === 'sl'));
    sl2.accept(sl2.offers().find((x) => x.origin === 'sl').id);
    await ticks(sl2, F2.g, 10, 0.25);
    const seq = llm2.calls().filter((c) => c.kind === 'szene').map((c) => c.key);
    const ord = [...new Set(sl2.regie.entries.filter((e) => e.art === 'szene').map((e) => e.szene))];
    check(T12, 'Vorlauf: Szenen in Grobplan-Reihenfolge, alle vor dem Betreten fertig', JSON.stringify(ord) === JSON.stringify(want) && seq.length >= 4,
      `Reihenfolge ${ord.join(' → ')} (${seq.length} Aufrufe)`);
  });
}

// ---------- 9. echte Engine (Game + Mission aus server/) ----------
async function engineTests(T) {
  const { katalog, ok, bad, skip, safe, check, T9, AR } = T;
  const { Game } = require('../server/game.js');
  const Weltstand = require('../server/weltstand.js');
  const worldDir = tmpDir('worlds9'); const regieDir = tmpDir('regie9');
  const setup = (lobby) => {
    const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir, seed: 7, debug: false, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: regieDir, WORLD_DIR: worldDir }, log: () => {} });
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'SL0', name: 'Testcrew', color: 0 });
    if (lobby) g.handleMessage(c, Object.assign({ t: 'lobbyOpt' }, lobby));
    g.handleMessage(c, { t: 'ready', ready: true });
    return { g, c };
  };
  const errorsOf = (g) => (g.stats && g.stats.errors) || g.errors || {};
  // ENGINE ruft spielleiter.update aus game.step (vertraglich); sonst hier von Hand
  const runner = (g, sl) => {
    let wired = null;
    return async (sec) => {
      for (let k = 0; k < Math.round(sec * 30); k++) {
        const before = sl.__calls || 0;
        g.step();
        if (wired === null) wired = (sl.__calls || 0) > before;
        if (!wired) sl.update(1 / 30);
        await flush();
      }
    };
  };
  const instrument = (sl) => { const u = sl.update.bind(sl); sl.update = (dt) => { sl.__calls = (sl.__calls || 0) + 1; return u(dt); }; return sl; };
  let savedWorld = null;
  await safe(T9, 'Kampagne ohne Tutorial → Angebote → Annehmen → Skip-Lauf → missionDone', async () => {
    const { g } = setup({ startMission: 'free' });
    for (let i = 0; i < 6; i++) g.step();
    const own = instrument(Spielleiter.create(g, { llm: LLM.create({ mode: 'script', katalog, script: {} }), archiv: AR.entries, regieDir, memoryLog: true, katalog }));
    g.spielleiter = own;
    own.onCampaignStart({ tutorial: false });
    const run = runner(g, own);
    let t = 0; while (own.offers().length < 3 && t < 30) { await run(1); t++; }
    const offers = own.offers();
    const entries = typeof g.mission.offerList === 'function' ? g.mission.offerList() : null;
    check(T9, 'Angebote nach „ohne Tutorial“ (Spielleiter + Archiv) im Missionsbuch', offers.length >= 3 && (!entries || entries.length >= 3), `${offers.map((o) => `${o.id}[${o.origin}]`).join(', ')} nach ${t} s; offerList ${entries ? entries.length : 'fehlt'}`);
    const o = offers.find((x) => x.origin === 'sl') || offers[0];
    const err = own.accept(o.id);
    check(T9, 'Annehmen startet die erzeugte Mission', err === null && g.mission.activeId === o.id && g.mission.def && g.mission.def.kopf && g.mission.def.kopf.art === 'generiert', `Fehler ${err}, aktiv ${g.mission.activeId}`);
    await run(1);
    if (Weltstand.VERSION >= 2) {
      // Datei sofort sichern: das Auto-Speichern bei missionDone überschreibt den Stand später
      try {
        const r = Weltstand.save(g, { sync: true });
        const file = path.join(worldDir, g.weltstand.id + '.json');
        savedWorld = r && r.ok ? { id: g.weltstand.id, mission: o.id, raw: fs.readFileSync(file, 'utf8'), file } : { error: (r && r.error) || 'unbekannt' };
      } catch (e) { savedWorld = { error: e.message }; }
    }
    const plan = own.planById(o.id);
    const steps = [];
    for (let i = 0; i < 120 && g.mission.activeId === o.id; i++) {
      const st = g.mission.step && g.mission.step.id; if (st && steps[steps.length - 1] !== st) steps.push(st);
      g.mission.skip(); await run(2);
    }
    const done = g.mission.missions[o.id] && g.mission.missions[o.id].state === 'done';
    if (done && own.planById(o.id)) own.onMissionDone({ id: o.id, ausgang: g.mission.missions[o.id].ausgang });
    const replaced = own.regie ? own.regie.entries.filter((e) => e.art === 'szene' && /ersetzt/.test(e.begruendung || '')).length : 0;
    check(T9, 'Skip-Lauf bis missionDone, Szenen ersetzt, Zusammenfassung', done && replaced >= 1 && own.zusammenfassung.some((z) => z.id === o.id),
      `Schritte ${steps.join(' → ')}; erledigt ${done} (${done ? g.mission.missions[o.id].ausgang : '–'}); ersetzt ${replaced}; Szenen ${plan ? Object.entries(plan.szenen).map(([k, v]) => k + ':' + v.quelle).join(' ') : '–'}`);
    await run(2);
    check(T9, 'nach missionDone wieder ≥ 1 Angebot', own.offers().length >= 1, `${own.offers().length} Angebote`);
    const errs = errorsOf(g); const slErr = Object.keys(errs).filter((k) => /spielleiter|mission/.test(k));
    check(T9, 'keine gezählten Fehler in Spielleiter/Mission', !slErr.length, slErr.map((k) => `${k}: ${JSON.stringify(errs[k]).slice(0, 120)}`).join(' | ') || '0');
    // Archiv-Skip-Lauf: jedes Archiv-Buch einmal (Standardweg)
    if (!Archiv.load().entries.length) { skip('10 Archiv', 'Skip-Lauf je Archiv-Buch (echte Engine)', 'content/spielleiter/archiv/*.json fehlen noch (KATALOG)'); return; }
    // je Archiv-Buch bis zu 3 Varianten: offene Entscheidungen nehmen Option v (mod Anzahl), dann skip
    const res = []; const names = Archiv.load().entries.map((e) => e.name);
    for (const name of names) {
      const reached = new Set(); let total = 0; let hang = null; const variants = [];
      for (const v of [0, 1, 2, -1]) {   // Option v bei jeder offenen Entscheidung; v = -1: nur skip (Standardweg)
        if (hang) break;
        // Angebot genau dieses Buchs herstellen
        const plan = own.newPlan('archiv', { art: 'test' });
        plan.kontext = own.kontext({ crew: 1 });
        const entry = own.archiv().find((e) => e.name === name);
        own.archivGespielt = own.archivGespielt.filter((x) => x !== name);
        plan.triedArchiv = own.archiv().filter((e) => e.name !== name).map((e) => e.name);
        for (const p of Object.values(own.plans)) if (p !== plan && p.archivName === name && p.state === 'offered') { own.callMission('unregisterBook', p.id); delete own.plans[p.key]; }
        if (!entry || !own.planFromArchive(plan, 'Skip-Lauf')) { hang = 'kein Angebot'; break; }
        total = Object.keys(plan.book.ausgaenge).length;
        g.inventory.marks = 2000;   // Optionen mit Kosten (Zoll, Bestechung) sollen wählbar sein
        if (own.accept(plan.id) !== null) { hang = 'Annehmen fehlgeschlagen'; break; }
        const chosen = [];
        for (let k = 0; k < 150 && g.mission.activeId === plan.id; k++) {
          const ch = g.mission.state && g.mission.state.choice;
          if (v >= 0 && ch && ch.options && ch.options.length) { const opt = ch.options.filter((o) => !o.disabled); if (opt.length) { chosen.push(opt[v % opt.length].id); g.mission.choice(opt[v % opt.length].id); } else g.mission.skip(); }
          else g.mission.skip();
          await run(2);
        }
        const ms = g.mission.missions[plan.id];
        if (!(ms && ms.state === 'done')) {
          hang = 'HÄNGT bei ' + (g.mission.step && g.mission.step.id) + (g.mission.step && g.mission.step.umsetzung ? ` (${g.mission.step.umsetzung})` : '');
          try { g.mission.completeMission(Object.keys(plan.book.ausgaenge)[0]); } catch (e) { /* weiter mit dem nächsten Buch */ }
          if (own.planById(plan.id)) own.onMissionDone({ id: plan.id, ausgang: 'abbruch' });
          break;
        }
        reached.add(ms.ausgang); variants.push(`${v < 0 ? 'skip' : 'opt' + v}=${ms.ausgang}${chosen.length ? '[' + chosen.join(',') + ']' : ''}`);
        if (own.planById(plan.id)) own.onMissionDone({ id: plan.id, ausgang: ms.ausgang });
        await run(1);
      }
      res.push(`${name}: ${hang || `Ausgänge ${[...reached].join('/')} (${reached.size} von ${total})`}${variants.length ? ' – ' + variants.join(' ') : ''}`);
    }
    check('10 Archiv', 'Skip-Lauf je Archiv-Buch (echte Engine, Standardweg + 3 Optionsvarianten)', res.length >= 1 && res.every((x) => !/HÄNGT|kein Angebot|fehlgeschlagen/.test(x)), res.join('; '));
  });
  await safe(T9, 'Speichern/Laden mitten in einer erzeugten Mission', async () => {
    if (Weltstand.VERSION < 2) { skip(T9, 'Speichern/Laden mitten in einer erzeugten Mission', `Weltstand Version ${Weltstand.VERSION} – Block 'spielleiter' kommt mit Weltstand v2 (ENGINE)`); return; }
    if (!savedWorld || savedWorld.error) { bad(T9, 'Speichern/Laden mitten in einer erzeugten Mission', 'Speichern nach dem Annehmen fehlgeschlagen: ' + (savedWorld && savedWorld.error)); return; }
    fs.writeFileSync(savedWorld.file, savedWorld.raw, 'utf8');
    try { fs.unlinkSync(path.join(worldDir, savedWorld.id + '.lock')); } catch (e) { /* keine Sperre */ }
    const data = Weltstand.load(worldDir, savedWorld.id);
    if (!data.ok) { bad(T9, 'Speichern/Laden mitten in einer erzeugten Mission', 'Laden: ' + data.error); return; }
    const hasBlock = data.ok && data.data.spielleiter && data.data.spielleiter.plaene && data.data.spielleiter.plaene[savedWorld.mission];
    const { g } = setup({ world: savedWorld.id });
    for (let i = 0; i < 6; i++) g.step();
    const sl = g.spielleiter;
    const active = g.mission.activeId;
    check(T9, 'Speichern/Laden mitten in einer erzeugten Mission', hasBlock && sl && active === savedWorld.mission && sl.planById(active) && g.mission.def && g.mission.def.kopf.art === 'generiert',
      `Block gespeichert ${!!hasBlock}, Spielleiter ${!!sl}, aktiv ${active} (erwartet ${savedWorld.mission})`);
    if (sl && active === savedWorld.mission) {
      instrument(sl); const run = runner(g, sl);
      for (let i = 0; i < 120 && g.mission.activeId === active; i++) { g.mission.skip(); await run(2); }
      check(T9, 'nach dem Laden zu Ende spielbar', g.mission.missions[active] && g.mission.missions[active].state === 'done', `Schritt ${g.mission.step && g.mission.step.id}`);
    }
  });
}

// =================================================================================================================
// B1/B2-Tests (CONTRACT-B1 §11.2/§11.3, §8; CONTRACT-B2 §7): Kontext (Landepunkte, Bodenbilanz, Kartenarten, Fraktionen),
// Token-Zuwachs, Landepunkt-Auflösung, Rostnest gesperrt, KOORDINATE, Bodenquote, lange Missionen, Zusammenfassung,
// Besetzung, Archiv mit Boden
// =================================================================================================================
// Testplan: Hafen -> Szenen (Kette) -> zwei Ausgänge. szenen: [{ id, ort, szenentyp, mols: ['mol/umsetzung'], dauer, … }]
function b1Plan(szenen, extra) {
  const S = szenen.map((s, i) => {
    const o = Object.assign({ karte: null, sachverhalt: `${s.id} (Test).`, wendung: null, dauer_min: s.dauer || 4 }, s);
    o.molekuele = (s.mols || []).map((x) => ({ id: x.split('/')[0], umsetzung: x.split('/')[1] }));
    delete o.mols; delete o.dauer;
    o.weiter = i < szenen.length - 1 ? [{ wenn: 'immer', nach: szenen[i + 1].id }] : [{ wenn: 'gut', nach: 'ausgang:erfolg' }, { wenn: 'sonst', nach: 'ausgang:teil' }];
    return o;
  });
  return Object.assign({
    format: 'grobplan/2', id: 'b1_test', titel: 'B1-Test', auftraggeber: 'melk', zielspieldauer_min: 12, aufhaenger: 'Ein Testauftrag.',
    erinnerung: { npc: 'melk', ereignis: 'm3_erinnerung' }, erinnerung_text: 'Melk erinnert sich an Kesh.', belohnung_marken: 120,
    szenen: [{ id: 's1_hafen', szenentyp: 'hafen', ort: 'hafen', karte: null, molekuele: [], sachverhalt: 'Auftrag.', wendung: null, dauer_min: 2, weiter: [{ wenn: 'immer', nach: S[0].id }] }, ...S],
    entscheidungen: [],
    ausgaenge: { erfolg: { wann: 'geschafft', folgen: ['npc_gedaechtnis melk: Die Crew hat geholfen.', 'chronik: B1-Test geschafft.'] },
      teil: { wann: 'halb', folgen: ['npc_gedaechtnis melk: Nur halb.', 'chronik: B1-Test halb.'] } },
  }, extra || {});
}
async function b1Tests(T) {
  const { katalog, env, ok, bad, skip, safe, check, ctxNT, AR, worldData } = T;
  const T13 = '13 B1';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const lp0 = env.lp ? env.lp() : null;
  if (!lp0) { skip(T13, 'B1 Spielleiter-Anbindung', 'server/sim/landepunkte.js fehlt (BUEHNE)'); return; }
  const codes = (list) => [...new Set((list || []).map((x) => String(x).split(':')[0]))].sort();
  const ctxMit = (bil) => Object.assign(clone(ctxNT), { bodenbilanz: Object.assign({ letzte: [], pflicht_jetzt: false, lang_ab_min: 25 }, bil || {}) });
  const ctxPflicht = ctxMit({ letzte: [{ titel: 'Nebelphantom', boden: false }], pflicht_jetzt: true });
  const ground = (extra, sz) => b1Plan(sz || [{ id: 's2_kastell', ort: 'kesh', szenentyp: 'raetselort', landepunkt: 'kesh.kastell', mols: ['raetsel_loesen/zwei_schluessel'], dauer: 4 },
    { id: 's3_raus', ort: 'kesh', szenentyp: 'rueckzug', landepunkt: 'kesh.kastell', mols: ['entkommen/zu_den_pads'], dauer: 4 }], extra);
  const noGround = () => { const g = LLM.mockGrobplan({ kontext: ctxNT }, katalog); g.belohnung_marken = 100; return g; };
  // Bühnenbedarf steht genau einmal im Grobplan-Prompt. Seit W1 AP4 (Katalog-Kurzfassung) nur noch in <vorgaben>
  // („Bodenszenen – passende Kartenarten je Umsetzung“), nicht mehr als Zeile „Bühne:“ im Katalog.
  const buehneZeilen = (t) => (String(t || '').match(/^\s+Bühne: /gm) || []).length;
  const buehneEinmalIn = (t) => buehneZeilen(t) === 0 && (String(t || '').match(/Bodenszenen – passende Kartenarten je Umsetzung/g) || []).length === 1;

  // 1. Kontext: Landepunkte je Ort, Kartenarten, Bodenbilanz, Fraktionen/Gegner, Bewaffnung
  await safe(T13, 'Kontext: Landepunkte je Ort, Kartenarten, Bodenbilanz, Fraktionen, Bewaffnung', () => {
    const w = clone(worldData['nach-tutorial'] || {});
    w.welt = Object.assign({}, w.welt, { landepunkte: { 'kesh.kastell': { seed: 205, bauversion: 'alt', art: 'ruine', bauweise: 'rom', besitz: 'herrenlos', zustand: 'verfallen', zustaende: {}, alarm: true, besuche: 2, letzte_mission: 'sl_3_x', neu: false, gesperrt: false } } });
    w.spielleiter = { zusammenfassung: [{ id: 'sl_1', titel: 'Grauzahns Preis', boden: true, lang: false, landepunkte: ['kesh.kastell'], dauer_ziel_min: 15 }, { id: 'sl_2', titel: 'Nebelphantom', boden: false, landepunkte: [] }] };
    w.crew = { waffen: { a1b2c3d4e5f6: 'blaster', ffeeddccbbaa: 'lanze' }, rollen_gesehen: ['grundtyp'] };
    const c = Context.build(w, { art: 'missionsgrenze', crew: 3 }, katalog);
    const c2 = Context.build(reverseKeys(w), { crew: 3, art: 'missionsgrenze' }, katalog);
    const kesh = (c.orte.find((o) => o.id === 'kesh') || {}).landepunkte || [];
    const kk = kesh.find((x) => x.id === 'kesh.kastell') || {};
    const kg = kesh.find((x) => x.id === 'kesh.grabung') || {};
    const all = c.orte.flatMap((o) => o.landepunkte || []);
    const treib = all.find((x) => x.id === 'splitter.treibgut') || {};
    const ruine = (c.kartenarten || []).find((x) => x.id === 'ruine') || { pflichtsatz: {} };
    const mitBraucht = ((c.verfuegbar && c.verfuegbar.molekuele) || []).flatMap((m) => m.umsetzungen).filter((u) => u.braucht_anker);
    const res = {
      deterministisch: JSON.stringify(c) === JSON.stringify(c2),
      keshDrei: kesh.map((x) => x.id).join(',') === 'kesh,kesh.grabung,kesh.kastell',
      ankerGebaut: !!(kk.anker && kk.anker.raetsel >= 2 && kk.anker.fund >= 1 && !('deckung' in kk.anker)), besucht: kk.besucht === 2 && kk.alarm === true,
      ankerPflicht: !kg.anker, ankerHand: !!((kesh.find((x) => x.id === 'kesh') || {}).anker || {}).tor,
      treibgutNichtFrei: treib.frei === 'nach_raumgefecht', keinRostnest: !all.some((x) => /^rostnest/.test(x.id) && !x.gesperrt),
      kartenarten: (c.kartenarten || []).map((x) => x.id).join(',') === 'aussenposten,station,ruine,schiff' && ruine.pflichtsatz.raetsel === 2 && !!ruine.kurz,
      bilanz: c.bodenbilanz.pflicht_jetzt === true && c.bodenbilanz.letzte.length === 2 && c.bodenbilanz.lang_ab_min === 25 && c.bodenbilanz.letzte[0].landepunkte[0] === 'kesh.kastell',
      bewaffnung: JSON.stringify(c.crew.bewaffnung) === '{"blaster":1,"lanze":1}' && !JSON.stringify(c).includes('a1b2c3d4e5f6'),
      rollen: JSON.stringify(c.rollen_gesehen) === '["grundtyp"]',
      fraktionen: !Object.keys(katalog.fraktionen || {}).length || (c.fraktionen.length === Object.keys(katalog.fraktionen).length && c.fraktionen.every((f) => f.rezepte.length && f.rollen.length)),
      gegner: !Object.keys(katalog.gegner || {}).length || c.gegner.every((g) => g.rolle && g.name),
      brauchtAnker: !mitBraucht.length || mitBraucht.every((u) => !u.karten),
    };
    const frisch = Context.build(worldData.frisch || { tutorial: 'laeuft' }, {}, katalog);
    res.nachTutorial = ((frisch.orte.find((o) => o.id === 'kesh') || {}).landepunkte || []).find((x) => x.id === 'kesh.kastell').frei === 'nach_tutorial';
    check(T13, 'Kontext: Landepunkte je Ort, Kartenarten, Bodenbilanz, Fraktionen, Bewaffnung', Object.values(res).every(Boolean),
      `${JSON.stringify(res)}; kesh.kastell ${JSON.stringify(kk)}; ${mitBraucht.length} Umsetzungen mit braucht_anker`);
  });

  // 2. Token-Schätzung: Grobplan-Kontext (ohne verfuegbar, wie im Prompt) vorher (S2b-Felder) / nachher, Ziel + ≤ 2k
  await safe(T13, 'Kontext wächst um höchstens 2k Tokens (Schätzung 2,5 Zeichen je Token)', () => {
    const rows = []; let max = 0;
    for (const [name, w] of Object.entries(worldData)) {
      const c = Context.build(w, {}, katalog);
      const nachher = Object.assign({}, c); delete nachher.verfuegbar;
      const vorher = clone(nachher);
      for (const k of ['bodenbilanz', 'kartenarten', 'fraktionen', 'gegner', 'rollen_gesehen']) delete vorher[k];
      for (const o of vorher.orte) delete o.landepunkte;
      if (vorher.crew) delete vorher.crew.bewaffnung;
      const a = JSON.stringify(vorher).length; const b = JSON.stringify(nachher).length;
      const plus = Math.round((b - a) / 2.5); max = Math.max(max, plus);
      rows.push(`${name} ${Math.round(a / 2.5)}→${Math.round(b / 2.5)} (+${plus})`);
    }
    check(T13, 'Kontext wächst um höchstens 2k Tokens (Schätzung 2,5 Zeichen je Token)', max <= 2000, `Grobplan-Kontext in Tokens: ${rows.join(', ')}`);
  });

  // 3. Landepunkt-Auflösung
  await safe(T13, 'Landepunkt-Auflösung: landepunkt, Wahl am Ort, buehne, buehne.neu, Karte gegen buehne_braucht', () => {
    const res = {}; const det = [];
    // a) ausdrücklich
    const ga = ground();
    const ra = SB.aufloesen(ga, env, ctxNT);
    const ba = SB.buildBook(ga, {}, env, { id: 'sl_1_b1a', kontext: ctxNT });
    const js = JSON.stringify(ba.book.steps);
    res.ausdruecklich = !ra.errors.length && ga.szenen[1].landepunkt === 'kesh.kastell' && (ba.book.buehne.aussenkarten || []).includes('kesh.kastell') && /"map":"kesh\.kastell"/.test(js) && !/"map":"kesh"/.test(js);
    det.push(`a: ${ra.errors.join(' | ') || 'ok'}; Buch ${ba.errors.map((e) => e.code).join(',') || 'ok'}`);
    res.buchGueltig = !ba.errors.length;
    // b) Wahl am Ort (nicht gerade gespielt, wenig besucht)
    const gb = ground(null, [{ id: 's2_fund', ort: 'kesh', szenentyp: 'raetselort', mols: ['artefakt_freilegen/fund_aus_gewoelbe'], dauer: 6 }]);
    const rb = SB.aufloesen(gb, env, ctxMit({ letzte: [{ titel: 'x', boden: true, landepunkte: ['kesh'] }] }));
    res.wahlAmOrt = !rb.errors.length && gb.szenen[1].landepunkt === 'kesh.kastell';
    det.push(`b: ${gb.szenen[1].landepunkt} ${rb.errors.join(' | ')}`);
    // c) buehne { kartenart } am Ort
    const gc = ground(null, [{ id: 's2_kontor', ort: 'hafen', szenentyp: 'gefecht', buehne: { kartenart: 'station', besitz: 'kontor' }, mols: ['daten_stehlen/download'], dauer: 6 }]);
    const rc = SB.aufloesen(gc, env, ctxNT);
    res.buehneArt = !rc.errors.length && gc.szenen[1].landepunkt === 'hafen.kontor';
    det.push(`c: ${gc.szenen[1].landepunkt} ${rc.errors.join(' | ')}`);
    // d) buehne.neu: Vorschau, das Spiel bleibt unverändert; zweite Szene am selben neuen Landepunkt
    const gd = ground(null, [{ id: 's2_neu', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'ruine', besitz: 'herrenlos', neu: true }, mols: ['probe_nehmen/am_fund'], dauer: 3 },
      { id: 's3_neu', ort: 'kesh', szenentyp: 'rueckzug', buehne: { kartenart: 'ruine', neu: true }, mols: ['entkommen/zu_den_pads'], dauer: 3 }]);
    const rd = SB.aufloesen(gd, env, ctxNT);
    res.neu = !rd.errors.length && /^kesh\.ruine-\d+$/.test(gd.szenen[1].landepunkt || '') && gd.szenen[2].landepunkt === gd.szenen[1].landepunkt && rd.neu.length === 1 && !lp0.liste('kesh').some((x) => x.id === gd.szenen[1].landepunkt);
    det.push(`d: ${gd.szenen[1].landepunkt}/${gd.szenen[2].landepunkt} neu=${JSON.stringify(rd.neu)} ${rd.errors.join(' | ')}`);
    // e) BUEHNE-ART: Rätsel (ruine/kesh) auf der Station
    const ge = ground(null, [{ id: 's2_falsch', ort: 'hafen', szenentyp: 'raetselort', landepunkt: 'hafen.kontor', mols: ['raetsel_loesen/zwei_schluessel'], dauer: 4 }]);
    const re = SB.aufloesen(ge, env, ctxNT);
    res.buehneArtFehler = codes(re.errors).includes('BUEHNE-ART');
    // f) BUEHNE-ANKER: Umsetzung verlangt einen Anker, den die gebaute Station nicht hat (lift)
    const kat2 = clone(katalog); const env2 = SB.buildEnv(kat2);
    const u2 = kat2.molekuele.daten_stehlen && kat2.molekuele.daten_stehlen.umsetzungen.find((u) => u.id === 'download');
    if (u2) u2.buehne_braucht = { kartenarten: ['station'], anker: ['lift'] };
    const gf = ground(null, [{ id: 's2_lift', ort: 'hafen', szenentyp: 'gefecht', landepunkt: 'hafen.kontor', mols: ['daten_stehlen/download'], dauer: 6 }]);
    const rf = SB.aufloesen(gf, env2, ctxNT);
    res.buehneAnker = !u2 || codes(rf.errors).includes('BUEHNE-ANKER');
    // g) LANDEPUNKT: unbekannt bzw. falscher Ort
    const gg = ground(null, [{ id: 's2_x', ort: 'kesh', szenentyp: 'raetselort', landepunkt: 'kesh.gibtsnicht', mols: ['raetsel_loesen/zwei_schluessel'], dauer: 4 },
      { id: 's3_x', ort: 'kesh', szenentyp: 'gefecht', landepunkt: 'hafen.kontor', mols: ['stellung_nehmen/trupp_raeumen'], dauer: 4 }]);
    const rg = SB.aufloesen(gg, env, ctxNT);
    res.landepunktFehler = rg.errors.filter((e) => /^LANDEPUNKT:/.test(e)).length === 2;
    det.push(`e-g: ${[...re.errors, ...rf.errors, ...rg.errors].map((e) => e.slice(0, 70)).join(' | ')}`);
    check(T13, 'Landepunkt-Auflösung: landepunkt, Wahl am Ort, buehne, buehne.neu, Karte gegen buehne_braucht', Object.values(res).every(Boolean), `${JSON.stringify(res)} – ${det.join(' · ')}`);
  });

  // 4. Rostnest gesperrt (E33), Landepunkt erst nach dem Tutorial
  await safe(T13, 'Rostnest gesperrt: LANDEPUNKT-GESPERRT, nie gewählt; nach_tutorial erst nach der Ausbildung', () => {
    const g = ground(null, [{ id: 's2_nest', ort: 'kesh', szenentyp: 'raetselort', landepunkt: 'rostnest.kastell', mols: ['raetsel_loesen/zwei_schluessel'], dauer: 4 }]);
    const r = SB.aufloesen(g, env, ctxNT);
    const g2 = ground(null, [{ id: 's2_nest', ort: 'kesh', szenentyp: 'raetselort', buehne: { kartenart: 'ruine', besitz: 'rostmeute' }, mols: ['raetsel_loesen/zwei_schluessel'], dauer: 4 }]);
    const r2 = SB.aufloesen(g2, env, ctxNT);
    const nest = lp0.liste('rostnest');
    const lpFrisch = Context.lpAdapterAusWelt(worldData.frisch || { tutorial: 'laeuft' });
    const g3 = ground();
    const r3 = SB.aufloesen(g3, env, ctxNT, { lp: lpFrisch });
    const res = { gesperrt: codes(r.errors).includes('LANDEPUNKT-GESPERRT'), nieGewaehlt: !/rostnest/.test(g2.szenen[1].landepunkt || '') && !codes(r2.errors).includes('LANDEPUNKT-GESPERRT'),
      datei: nest.length === 2 && nest.every((x) => x.gesperrt && !x.frei), nachTutorial: r3.errors.some((e) => /^LANDEPUNKT: .*noch nicht frei/.test(e)) };
    check(T13, 'Rostnest gesperrt: LANDEPUNKT-GESPERRT, nie gewählt; nach_tutorial erst nach der Ausbildung', Object.values(res).every(Boolean), `${JSON.stringify(res)} – ${r.errors.join(' | ')} · ohne Landepunkt: ${g2.szenen[1].landepunkt || '–'} · ${r3.errors.slice(0, 1).join('')}`);
  });

  // 5. KOORDINATE
  await safe(T13, 'KOORDINATE: x/y/tile/pos in Szene, buehne oder besetzung sind Fehler', () => {
    const g = ground(null, [{ id: 's2_k', ort: 'kesh', szenentyp: 'raetselort', buehne: { kartenart: 'ruine', x: 12, y: 4 }, mols: ['raetsel_loesen/zwei_schluessel'], dauer: 4 },
      { id: 's3_k', ort: 'kesh', szenentyp: 'rueckzug', landepunkt: 'kesh.kastell', pos: [3, 4], besetzung: [{ fraktion: 'herrenlos', tile: [1, 1] }], mols: ['entkommen/zu_den_pads'], dauer: 4 }]);
    const r = SB.aufloesen(g, env, ctxNT);
    const k = r.errors.filter((e) => /^KOORDINATE:/.test(e));
    const sauber = SB.aufloesen(ground(), env, ctxNT).errors.filter((e) => /^KOORDINATE/.test(e));
    check(T13, 'KOORDINATE: x/y/tile/pos in Szene, buehne oder besetzung sind Fehler', k.length === 4 && !sauber.length, k.join(' | '));
  });

  // 6. Bodenquote
  await safe(T13, 'BODEN-QUOTE: Fehler, mit ohne_boden_grund nur Warnung; nicht fällig = still', () => {
    const r1 = SB.checkGrobplanB1(noGround(), env, ctxPflicht);
    const r2 = SB.checkGrobplanB1(Object.assign(noGround(), { ohne_boden_grund: 'Die Crew ist nach dem Gefecht verletzt, heute nur Raumarbeit.' }), env, ctxPflicht);
    const r3 = SB.checkGrobplanB1(ground(), env, ctxPflicht);
    const r4 = SB.checkGrobplanB1(noGround(), env, ctxNT);
    const res = { fehler: codes(r1.errors).includes('BODEN-QUOTE'), grundWarnung: !r2.errors.length && codes(r2.warnings).includes('BODEN-QUOTE'),
      mitBoden: !codes(r3.errors).includes('BODEN-QUOTE'), nichtFaellig: !r4.errors.length && !codes(r4.warnings).includes('BODEN-QUOTE') };
    check(T13, 'BODEN-QUOTE: Fehler, mit ohne_boden_grund nur Warnung; nicht fällig = still', Object.values(res).every(Boolean), `${JSON.stringify(res)} – ${r1.errors.join(' | ')}`);
  });
  await safe(T13, 'Angebotsrunde bei fälliger Quote: Nachbesserung mit BODEN-QUOTE, beide Spielleiter-Angebote mit Boden, Archiv mit Boden', async () => {
    const F = fakeGame();
    const llm = LLM.create({ mode: 'script', katalog, script: { grobplan: [{ json: noGround() }, { json: ground() }, { json: ground({ id: 'b1_zwei', titel: 'B1-Zwei' }) }] } });
    const sl = Spielleiter.create(F.g, { llm, kontext: () => clone(ctxPflicht), archiv: AR.entries, regieDir: tmpDir('regie13a'), katalog });
    const prompts = []; const ask0 = sl.llm.ask; sl.llm.ask = (kind, input, ao) => { prompts.push(input.prompt); return ask0(kind, input, ao); };
    sl.onMissionDone({ id: 'm3' });
    await ticks(sl, F.g, 20, 0.25, () => sl.offers().filter((o) => o.origin === 'sl').length >= 2);
    const sl0 = sl.offers().filter((o) => o.origin === 'sl').map((o) => sl.planById(o.id));
    const ar = sl.plansBy((p) => p.slot === 'archiv' && p.state === 'offered')[0];
    const quote = sl.regie.entries.filter((e) => e.art === 'grobplan' && (e.fehler || []).some((x) => /^BODEN-QUOTE/.test(x)));
    const retry = prompts.find((p) => /<pruefer>[\s\S]*BODEN-QUOTE/.test(p));
    const res = { zweiSl: sl0.length === 2, beideBoden: sl0.every((p) => sl.planBoden(p).boden), nachbesserung: quote.length === 1 && !!retry,
      pflichtImPrompt: /PFLICHT: Diese Mission braucht eine Bodenszene/.test(prompts[0] || ''), buehneEinmal: buehneEinmalIn(prompts[0]) && !/Bühnen-Bedarf/.test(prompts[0] || ''),
      archivBoden: !!ar && (AR.synthetic || sl.planBoden(ar).boden), fehlerfrei: !F.errors.length };
    check(T13, 'Angebotsrunde bei fälliger Quote: Nachbesserung mit BODEN-QUOTE, beide Spielleiter-Angebote mit Boden, Archiv mit Boden', Object.values(res).every(Boolean),
      `${JSON.stringify(res)}; Archiv ${ar && ar.archivName}; Fehler ${F.errors.join(' | ') || '–'}`);
    // Archiv: Vorzug ordnet nur (ohne Quote die Dateireihenfolge)
    if (!AR.synthetic) {
      const info = (x) => SB.bodenInfo(x.grobplan, env);
      const mit = Archiv.pick(AR.entries, [], ctxPflicht, [], { boden: true, info });
      const ohne = Archiv.pick(AR.entries, [], ctxNT, [], { boden: false, info });
      check(T13, 'Archiv bevorzugt bei fälliger Quote eine Bodenmission', !!mit && info(mit).boden && !!ohne && ohne.name === Archiv.pick(AR.entries, [], ctxNT).name, `Quote fällig → ${mit && mit.name}; sonst → ${ohne && ohne.name}`);
    }
  });

  // 7. Lange Missionen
  await safe(T13, 'Lange Mission: lang ab 25 min (größerer Wert), BODEN-LANG, LANG-RUNDE, DAUER-ABWEICHUNG', () => {
    const langSz = (boden) => (boden
      ? [{ id: 's2_hof', ort: 'kesh', szenentyp: 'gefecht', landepunkt: 'kesh.kastell', mols: ['stellung_nehmen/trupp_raeumen'], dauer: 8 }, { id: 's3_kasse', ort: 'kesh', szenentyp: 'raetselort', landepunkt: 'kesh.kastell', mols: ['raetsel_loesen/zwei_schluessel'], dauer: 9 }, { id: 's4_raus', ort: 'kesh', szenentyp: 'rueckzug', landepunkt: 'kesh.kastell', mols: ['entkommen/zu_den_pads'], dauer: 8 }]
      : null);
    const gl = ground({ zielspieldauer_min: 28 }, langSz(true));
    const iLang = SB.bodenInfo(gl, env);
    const gx = noGround(); gx.zielspieldauer_min = 28;
    const gDecl = ground({ zielspieldauer_min: 15 }, langSz(true));   // als 15 min deklariert, geplant 27
    const r1 = SB.checkGrobplanB1(gl, env, ctxNT);
    const r2 = SB.checkGrobplanB1(gx, env, ctxNT);
    const r3 = SB.checkGrobplanB1(gl, env, ctxNT, { langImAngebot: 'Castellum Kesh' });
    const r4 = SB.checkGrobplanB1(gDecl, env, ctxNT);
    const iDecl = SB.bodenInfo(gDecl, env);
    const res = { lang: iLang.lang && iLang.boden && iLang.landepunkte.join() === 'kesh.kastell', mitBodenOk: !r1.errors.length, bodenLang: codes(r2.errors).includes('BODEN-LANG'),
      langRunde: codes(r3.errors).includes('LANG-RUNDE'), groessererWert: iDecl.lang && iDecl.dauer_ziel_min === 15, abweichung: codes(r4.warnings).includes('DAUER-ABWEICHUNG'),
      kurz: !SB.bodenInfo(ground(), env).lang };
    check(T13, 'Lange Mission: lang ab 25 min (größerer Wert), BODEN-LANG, LANG-RUNDE, DAUER-ABWEICHUNG', Object.values(res).every(Boolean), `${JSON.stringify(res)} – ${JSON.stringify(iDecl)}; ${[...r2.errors, ...r3.errors, ...r4.warnings].join(' | ')}`);
  });
  await safe(T13, 'Angebotsrunde: höchstens eine lange Mission; die erste Planung ohne lange im Angebot darf lang sein', async () => {
    const F = fakeGame();
    const gl = ground({ id: 'b1_lang', titel: 'B1-Lang', zielspieldauer_min: 28 }, [{ id: 's2_hof', ort: 'kesh', szenentyp: 'gefecht', landepunkt: 'kesh.kastell', mols: ['stellung_nehmen/trupp_raeumen'], dauer: 8 },
      { id: 's3_kasse', ort: 'kesh', szenentyp: 'raetselort', landepunkt: 'kesh.kastell', mols: ['raetsel_loesen/zwei_schluessel'], dauer: 9 }, { id: 's4_raus', ort: 'kesh', szenentyp: 'rueckzug', landepunkt: 'kesh.kastell', mols: ['entkommen/zu_den_pads'], dauer: 8 }]);
    const gl2 = Object.assign(clone(gl), { id: 'b1_lang2', titel: 'B1-Lang-Zwei' });
    const llm = LLM.create({ mode: 'script', katalog, script: { grobplan: [{ json: gl }, { json: gl2 }, { json: ground() }] } });
    const sl = Spielleiter.create(F.g, { llm, kontext: () => clone(ctxNT), archiv: AR.entries.filter((e) => !SB.bodenInfo(e.grobplan, env).lang), regieDir: tmpDir('regie13b'), katalog });
    const prompts = []; const ask0 = sl.llm.ask; sl.llm.ask = (kind, input, ao) => { prompts.push(input.prompt); return ask0(kind, input, ao); };
    sl.onMissionDone({ id: 'm3' });
    await ticks(sl, F.g, 20, 0.25, () => sl.offers().filter((o) => o.origin === 'sl').length >= 2);
    const langOffers = sl.offers().filter((o) => sl.planBoden(sl.planById(o.id)).lang);
    const runde = sl.regie.entries.some((e) => e.art === 'grobplan' && (e.fehler || []).some((x) => /^LANG-RUNDE/.test(x)));
    const res = { eineLange: langOffers.length === 1, langRundeFehler: runde, ersterLang: /eine \*\*lange\*\* Mission/.test(prompts[0] || ''), zweiterKurz: /schon im Angebot/.test(prompts[1] || '') };
    check(T13, 'Angebotsrunde: höchstens eine lange Mission; die erste Planung ohne lange im Angebot darf lang sein', Object.values(res).every(Boolean),
      `${JSON.stringify(res)}; Angebote ${sl.offers().map((o) => `${o.titel}[${o.origin}]`).join(', ')}; Fehler ${F.errors.join(' | ') || '–'}`);
  });

  // 8. KARTE-WIEDERHOLT, BESITZ-REGION
  await safe(T13, 'KARTE-WIEDERHOLT und BESITZ-REGION sind Warnungen', () => {
    const r1 = SB.checkGrobplanB1(ground(), env, ctxMit({ letzte: [{ titel: 'Davor', boden: true, landepunkte: ['kesh.kastell'] }] }));
    const g2 = ground(null, [{ id: 's2_neu', ort: 'hafen', szenentyp: 'gefecht', buehne: { kartenart: 'station', besitz: 'raubzug', neu: true }, mols: ['daten_stehlen/download'], dauer: 6 }]);
    const r2 = SB.aufloesen(g2, env, ctxNT);
    const res = { wiederholt: !r1.errors.length && codes(r1.warnings).includes('KARTE-WIEDERHOLT'), region: !r2.errors.length && codes(r2.warnings).includes('BESITZ-REGION'),
      regionOk: !codes(SB.aufloesen(ground(), env, ctxNT).warnings).includes('BESITZ-REGION') };
    check(T13, 'KARTE-WIEDERHOLT und BESITZ-REGION sind Warnungen', Object.values(res).every(Boolean), `${JSON.stringify(res)} – ${[...r1.warnings, ...r2.warnings, ...r2.errors].join(' | ')}`);
  });

  // 9. Zusammenfassung (Weltstand §8) und Bodenbilanz daraus; neuer Landepunkt im Spiel angelegt
  await safe(T13, 'Zusammenfassung: boden, lang, landepunkte, dauer_ziel_min; buehne.neu legt den Landepunkt im Spiel an', async () => {
    const F = fakeGame();
    const gn = ground({ id: 'b1_neu', titel: 'B1-Neu' }, [{ id: 's2_neu', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'ruine', besitz: 'herrenlos', neu: true }, mols: ['probe_nehmen/am_fund'], dauer: 4 },
      { id: 's3_raus', ort: 'kesh', szenentyp: 'rueckzug', buehne: { kartenart: 'ruine', neu: true }, mols: ['entkommen/zu_den_pads'], dauer: 4 }]);
    const llm = LLM.create({ mode: 'script', katalog, script: { grobplan: [{ json: gn }, { json: noGround() }] } });
    const sl = Spielleiter.create(F.g, { llm, kontext: () => clone(ctxNT), archiv: AR.entries, regieDir: tmpDir('regie13c'), katalog, config: { offers: 2 } });
    sl.onMissionDone({ id: 'm3' });
    await ticks(sl, F.g, 20, 0.25, () => sl.offers().filter((o) => o.origin === 'sl').length >= 2);
    const o = sl.offers().find((x) => x.titel === 'B1-Neu');
    const plan = o && sl.planById(o.id);
    const lpId = plan && plan.grobplan.szenen[1].landepunkt;
    const angelegt = !!(F.g.landepunkte && F.g.landepunkte.dyn && F.g.landepunkte.dyn[lpId]);
    const imBuch = !!plan && JSON.stringify(plan.book).includes(`"map":"${lpId}"`);
    if (o) sl.accept(o.id);
    F.m.activeId = null; F.m.step = null;
    if (o) sl.onMissionDone({ id: o.id, ausgang: 'erfolg' });
    const z = sl.zusammenfassung[sl.zusammenfassung.length - 1] || {};
    const saved = JSON.parse(JSON.stringify(sl.toSave()));
    const c = Context.build({ spielleiter: saved }, {}, katalog);
    const res = { angebot: !!o, angelegt, imBuch, beideSzenen: !!plan && plan.grobplan.szenen[2].landepunkt === lpId,
      felder: z.boden === true && z.lang === false && JSON.stringify(z.landepunkte) === JSON.stringify([lpId]) && z.dauer_ziel_min === 12,
      gespeichert: !!(saved.zusammenfassung || []).find((x) => x.id === (o && o.id) && x.boden === true), bilanz: c.bodenbilanz.letzte.slice(-1)[0].boden === true && c.bodenbilanz.pflicht_jetzt === false };
    check(T13, 'Zusammenfassung: boden, lang, landepunkte, dauer_ziel_min; buehne.neu legt den Landepunkt im Spiel an', Object.values(res).every(Boolean), `${JSON.stringify(res)}; ${JSON.stringify(z)}; Fehler ${F.errors.join(' | ') || '–'}`);
  });

  // 10. Besetzung (B2 §7)
  await safe(T13, 'Besetzung: Szenenbau setzt Fraktion/Stärke/Haltung (sonst Besitz), BESETZUNG-NEU, FRAKTION', () => {
    const g = ground(null, [{ id: 's2_hof', ort: 'kesh', szenentyp: 'gefecht', landepunkt: 'kesh.kastell', besetzung: [{ fraktion: 'rostmeute', staerke: 'gross', haltung: 'wach' }], mols: ['stellung_nehmen/trupp_raeumen'], dauer: 5 },
      { id: 's3_hof', ort: 'kesh', szenentyp: 'gefecht', landepunkt: 'kesh.kastell', mols: ['stellung_nehmen/trupp_raeumen'], dauer: 5 }]);
    const r = SB.aufloesen(g, env, ctxNT);
    const b = SB.buildBook(g, {}, env, { id: 'sl_1_b1bes', kontext: ctxNT });
    const st = b.book.steps;
    const s2 = JSON.stringify(st.filter((x) => /^s2_hof/.test(x.id))); const s3 = JSON.stringify(st.filter((x) => /^s3_hof/.test(x.id)));
    const uses = /"fraktion"/.test(s2);
    const gN = clone(g); gN.szenen[1].besetzung = [{ fraktion: 'rostmeute', staerke: 'mittel', haltung: 'ruhig', neue_rolle: 'niederhalter' }]; gN.szenen[2].besetzung = [{ fraktion: 'rostmeute', staerke: 'klein', haltung: 'ruhig', neue_rolle: 'schuetze' }];
    const rN = SB.aufloesen(gN, env, ctxNT);
    const gF = clone(g); gF.szenen[1].besetzung = [{ fraktion: 'piraten', staerke: 'riesig', haltung: 'wach' }];
    const rF = SB.aufloesen(gF, env, ctxNT);
    const mitFr = Object.keys(katalog.fraktionen || {}).length > 0;
    const res = { ohneFehler: !r.errors.length, gesetzt: !uses || (/"rostmeute"/.test(s2) && /"gross"/.test(s2) && /"herrenlos"/.test(s3)), neu: codes(rN.errors).includes('BESETZUNG-NEU'),
      fraktion: codes(rF.errors).includes('FRAKTION'), unbekannt: !mitFr || rF.errors.some((e) => /piraten/.test(e)) };
    check(T13, 'Besetzung: Szenenbau setzt Fraktion/Stärke/Haltung (sonst Besitz), BESETZUNG-NEU, FRAKTION', Object.values(res).every(Boolean), `${JSON.stringify(res)} – ${[...r.errors, ...rN.errors, ...rF.errors].join(' | ')}; Buch ${b.errors.map((e) => e.code).join(',') || 'ok'}`);
  });

  // 11. Archiv mit Boden (KATALOG): Bühne auflösbar, B1-Regeln ohne Fehler
  await safe(T13, 'Archivmissionen mit Boden: Bühne auflösbar, B1-Regeln ohne Fehler', () => {
    const mitBoden = AR.entries.filter((e) => SB.bodenInfo(e.grobplan, env).boden);
    if (!mitBoden.length) { skip(T13, 'Archivmissionen mit Boden: Bühne auflösbar, B1-Regeln ohne Fehler', 'keine Archivmission mit Bodenszene (KATALOG)'); return; }
    const rows = []; let fine = true;
    for (const e of mitBoden) {
      const g = clone(e.grobplan);
      const r = SB.aufloesen(g, env, ctxNT); const b = SB.checkGrobplanB1(g, env, ctxNT);
      const i = SB.bodenInfo(g, env);
      if (r.errors.length || b.errors.length) fine = false;
      rows.push(`${e.name}: ${i.lang ? 'lang' : 'normal'} ${i.landepunkte.join('+')}${r.errors.length || b.errors.length ? ' – ' + [...r.errors, ...b.errors].join(' | ') : ''}${r.warnings.length ? ' (Warnungen: ' + r.warnings.join(' | ') + ')' : ''}`);
    }
    check(T13, 'Archivmissionen mit Boden: Bühne auflösbar, B1-Regeln ohne Fehler', fine && mitBoden.length >= 2, rows.join(' · '));
  });

  // Vorbau (OFFEN-STUDIO): accept -> landepunkte.vorbauen außerhalb des Aufrufs; doppelt = Cache-Treffer, Handkarte übersprungen
  await safe(T13, 'Vorbau: Szenen-Landepunkte nach dem Annehmen per setImmediate, zweiter Aufruf baut nicht neu', async () => {
    const Buehne = require('../shared/buehne.js');
    const g = { seed: 7, countError(w, e) { errs.push(w + ': ' + (e && e.message)); }, log() {},
      // eigener Seed -> eigener Cache-Schlüssel (der Karten-Cache ist modulweit)
      landepunkte: { eintraege: { 'kesh.kastell': { seed: 918273, bauversion: null, schablone: null, art: 'ruine', bauweise: 'rom', besitz: 'herrenlos', zustand: 'verfallen', zustaende: {}, alarm: false, besuche: 0, letzte_mission: null, neu: false, gesperrt: false } }, lru: [], dyn: {} } };
    const errs = [];
    const ad = Context.lpAdapter(g);
    const plan = { grobplan: ground() };
    const self = { lp: () => ad, countError: (w, e) => errs.push(w + ': ' + e.message) };
    const bau0 = Buehne.bauen; let n = 0; Buehne.bauen = (...a) => { if (a[0] && a[0].id === 'kesh.kastell' && a[0].seed === 918273) n++; return bau0(...a); };
    try {
      const ids = Spielleiter.Spielleiter.prototype.vorbauen.call(self, plan);
      const sofort = n;
      for (let i = 0; i < 6; i++) await flush();
      const erst = n;
      Spielleiter.Spielleiter.prototype.vorbauen.call(self, plan);
      for (let i = 0; i < 6; i++) await flush();
      const res = { ids: ids === 1, nichtImAufruf: sofort === 0, gebaut: erst === 1, doppeltHarmlos: n === 1, hand: Spielleiter.Spielleiter.prototype.vorbauen.call(self, { grobplan: b1Plan([{ id: 's2', ort: 'kesh', szenentyp: 'raetselort', landepunkt: 'kesh', mols: ['raetsel_loesen/zwei_schluessel'] }]) }) === 1, fehlerfrei: !errs.length };
      for (let i = 0; i < 4; i++) await flush();
      res.handNichtGebaut = n === 1;
      check(T13, 'Vorbau: Szenen-Landepunkte nach dem Annehmen per setImmediate, zweiter Aufruf baut nicht neu', Object.values(res).every(Boolean), `${JSON.stringify(res)}; Bauten ${n}; ${errs.join(' | ') || '0 Fehler'}`);
    } finally { Buehne.bauen = bau0; }
  });
}

// erwartet.json (DATEN) flexibel lesen: { datei: code | [codes] | { code|codes|fehler } } oder [{ datei|file, code|codes }]
function normalizeExpected(erw) {
  const codesOf = (v) => {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.flatMap(codesOf);
    if (v && typeof v === 'object') return codesOf(v.codes || v.code || v.fehler || v.erwartet || []);
    return [];
  };
  let list = [];
  if (Array.isArray(erw)) list = erw.map((e) => ({ datei: String(e.datei || e.file || e.id || ''), codes: codesOf(e) }));
  else if (erw && typeof erw === 'object') {
    const src = erw.faelle || erw.cases || erw.dateien || erw;
    if (Array.isArray(src)) return normalizeExpected(src);
    list = Object.entries(src).filter(([k]) => !k.startsWith('_') && !k.startsWith('$')).map(([k, v]) => ({ datei: k, codes: codesOf(v) }));
  }
  return list.filter((c) => c.datei && c.codes.length);
}
// Alle Baustein-Namen eines Buchs: do: "<name>" (String) und check: "<name>" | { name }
function collectBausteine(doc) {
  const used = { do: new Set(), check: new Set() };
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (typeof n.do === 'string') used.do.add(n.do);
    if (n.check !== undefined) { const c = n.check; if (typeof c === 'string') used.check.add(c); else if (c && typeof c.name === 'string') used.check.add(c.name); }
    for (const v of Object.values(n)) walk(v);
  };
  walk(doc);
  return used;
}
function reverseKeys(x) {
  if (Array.isArray(x)) return x.map(reverseKeys);
  if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).reverse()) o[k] = reverseKeys(x[k]); return o; }
  return x;
}
function isSorted(x) {
  if (Array.isArray(x)) return x.every(isSorted);
  if (x && typeof x === 'object') { const k = Object.keys(x); return k.every((v, i) => i === 0 || k[i - 1] <= v) && Object.values(x).every(isSorted); }
  return true;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { checkGrobplan, assembleScene, sceneTestBook, evaluateScene, evaluateGrobplan, parseJsonAnswer, buildEnv, checkBook, collectBausteine, normalizeExpected, CHECKER, ANLASS, fakeGame };
