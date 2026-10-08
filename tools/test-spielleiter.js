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
    const llm = LLM.create({ mode: 'script', katalog, script: {} });
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
    // betretene Szene wird nicht ersetzt: s3 zurückhalten, dann s3 betreten, dann freigeben
    llm._hold = true;
    const scr = { szene: [{ hold: true }] };
    sl.llm = LLM.create({ mode: 'script', katalog, script: scr });
    F.m.step = { id: `${s2}_anflug` }; sl.update(0.1); await flush();
    F.m.step = { id: s2 }; F.g.time += 0.25; sl.update(0.25); await flush();
    const req = plan.szenen[s3].state;
    const upd0 = F.m.updates.length;
    F.m.step = { id: `${s3}_anflug` }; F.g.time += 0.25; sl.update(0.25); await flush();
    F.m.step = { id: s3 }; F.g.time += 0.25; sl.update(0.25); await flush();
    sl.llm.release(); await ticks(sl, F.g, 2);
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
