'use strict';
// SUND-03 B (b, e): Transport-Router, Eskalation und Spielleiter-Ablauf mit Fake-Transporten (kein Netz, kein Claude, kein Ollama).
//   1. Router: Wahl je Art, Schema nur an Ollama, Konfiguration (opts/Env), Ausfall-Rückfall bei OFFLINE
//   2. llm.js: eskaliere(), Prozess-Zähler zählt Claude, nicht Ollama; 'text' in mock/script
//   3. Spielleiter: Szene von Ollama gültig / ungültig → Eskalation (kein zweiter Gemma-Versuch) / Eskalation tot → Rohfassung;
//      Ollama tot → Rückfall auf Claude; Ollama und Claude tot: Rohfassung wird gespielt, nichts blockiert, nichts wirft
//   node tools/test-transport-router.js
const H = require('./transport-testhilfe.js');
const LLM = require('../server/mission/llm.js');
const Router = require('../server/mission/transport-router.js');
const Schema = require('../server/mission/schema-ableiten.js');
const SB = require('../server/mission/szenenbau.js');
const Katalog = require('../server/mission/katalog.js');
const Archiv = require('../server/mission/archiv.js');
const Regielog = require('../server/mission/regielog.js');
const Spielleiter = require('../server/mission/spielleiter.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

const T = H.runner('Router und Eskalation');
const katalog = Katalog.load({});
const env = SB.buildEnv(katalog);
const ctx = H.kontextNachTutorial();
const fehler = async (p) => { try { await p; return null; } catch (e) { return e; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-router-'));

// Fake-Transport: handler(text, o, n) -> Ergebnis oder wirft
function fake(name, handler) {
  const calls = [];
  return { name, calls, call: async (text, o) => { calls.push({ text, o }); return handler(text, o, calls.length); } };
}
const ok = (text, input, output, modelId) => ({ text, usage: { input: input || 100, output: output || 10 }, sec: 0.1, modelId: modelId || 'fake', cost: 0 });
const tot = (code) => () => { const e = new Error('tot (' + code + ')'); e.code = code; throw e; };
const mitLive = async (fn) => { const alt = process.env.LLM_LIVE; process.env.LLM_LIVE = '1'; try { return await fn(); } finally { if (alt === undefined) delete process.env.LLM_LIVE; else process.env.LLM_LIVE = alt; } };

(async () => {
  // ---------------- 1. Router ----------------
  await T.safe('Router: Wahl je Art (Standard grobplan→claude/sonnet, szene→ollama, text→ollama), Schema nur an Ollama', async () => {
    const claude = fake('cli', (t) => ok('C:' + t)); const ollama = fake('ollama', (t) => ok('O:' + t));
    const R = Router.routeTransport({}, { transports: { claude, ollama } });
    const rg = await R.call('p1', { kind: 'grobplan', model: 'sonnet', schema: { x: 1 }, system: 's' });
    const rs = await R.call('p2', { kind: 'szene', model: 'sonnet', schema: { x: 1 }, system: 's' });
    const rt = await R.call('p3', { kind: 'text', model: 'sonnet' });
    T.check('grobplan → Claude (Modell sonnet), Schema abgestreift', rg.text === 'C:p1' && rg.anbieter === 'claude' && claude.calls[0].o.model === 'sonnet' && !('schema' in claude.calls[0].o) && claude.calls[0].o.kind === 'grobplan', JSON.stringify(claude.calls[0].o));
    T.check('szene → Ollama, Schema und kind kommen an, Modell sonnet wird nicht weitergereicht', rs.text === 'O:p2' && rs.anbieter === 'ollama' && JSON.stringify(ollama.calls[0].o.schema) === '{"x":1}' && ollama.calls[0].o.model === undefined && ollama.calls[0].o.kind === 'szene', JSON.stringify(ollama.calls[0].o));
    T.check('text → Ollama', rt.anbieter === 'ollama' && ollama.calls[1].o.kind === 'text', JSON.stringify(rt));
    T.check('Antwort trägt modell (modelId des Anbieters)', rs.modell === 'fake', rs.modell);
    const re = await R.call('p5', { kind: 'szene', anbieter: 'claude' });
    T.check('erzwungener Anbieter (Eskalation) → Claude mit Eskalationsmodell, eskaliert:true', re.anbieter === 'claude' && re.eskaliert === true && claude.calls[1].o.model === 'sonnet' && !('anbieter' in claude.calls[1].o), JSON.stringify(re));
    T.check('ohne kind (direkter Aufruf) → Claude wie bisher', (await R.call('p4', { model: 'haiku' })).anbieter === 'claude' && claude.calls[2].o.model === 'haiku', '');
    T.check('eskalationFuer: nur für Ollama-Arten', R.eskalationFuer('szene') === 'claude' && R.eskalationFuer('text') === 'claude' && R.eskalationFuer('grobplan') === null, `${R.eskalationFuer('szene')} ${R.eskalationFuer('grobplan')}`);
  });
  await T.safe('Router: Konfiguration über opts und Umgebung', async () => {
    const claude = fake('cli', (t) => ok('C')); const ollama = fake('ollama', (t) => ok('O'));
    const R = Router.routeTransport({ grobplan: { anbieter: 'ollama', modell: 'gm:1' }, szene: { anbieter: 'claude', modell: 'haiku' }, text: { anbieter: 'claude' } }, { transports: { claude, ollama }, eskalation: null });
    await R.call('x', { kind: 'grobplan' }); await R.call('x', { kind: 'szene' }); await R.call('x', { kind: 'text' });
    T.check('opts: andere Zuordnung und Modelle', ollama.calls[0].o.model === 'gm:1' && claude.calls[0].o.model === 'haiku' && claude.calls[1].o.model === 'sonnet', JSON.stringify([ollama.calls[0].o.model, claude.calls[0].o.model, claude.calls[1].o.model]));
    T.check('eskalation: null → keine Eskalation', R.eskalationFuer('grobplan') === null && R.eskalationFuer('szene') === null, '');
    T.check('Umgebung ohne Router-Variablen → kein Router (Standardverhalten bleibt)', Router.routerAusEnv({}) === null && Router.routerAusEnv({ LLM_ANBIETER_SZENE: '' }) === null, '');
    const r1 = Router.routerAusEnv({ LLM_ROUTER: '1' }, { transports: { claude, ollama } });
    T.check('LLM_ROUTER=1 → Standardzuordnung mit Eskalation', r1 && r1.arten.szene.anbieter === 'ollama' && r1.arten.grobplan.anbieter === 'claude' && r1.eskalationFuer('szene') === 'claude', '');
    const r2 = Router.routerAusEnv({ LLM_ANBIETER_SZENE: 'claude', LLM_MODELL_SZENE: 'opus', LLM_ESKALATION: 'aus' }, { transports: { claude, ollama } });
    T.check('LLM_ANBIETER_SZENE=claude, LLM_MODELL_SZENE, LLM_ESKALATION=aus', r2 && r2.arten.szene.anbieter === 'claude' && r2.arten.szene.modell === 'opus' && r2.arten.text.anbieter === 'ollama' && r2.eskalationFuer('text') === null, JSON.stringify(r2 && r2.arten));
    const r3 = Router.routerAusEnv({ LLM_ANBIETER_TEXT: 'ollama', LLM_MODELL_TEXT: 'x:1', LLM_ESKALATION_MODELL: 'haiku' }, { transports: { claude, ollama } });
    T.check('LLM_MODELL_TEXT, LLM_ESKALATION_MODELL', r3.arten.text.modell === 'x:1' && r3.eskalation.modell === 'haiku', JSON.stringify(r3.eskalation));
    const e1 = (() => { try { Router.routeTransport({ szene: { anbieter: 'gpt' } }, { transports: { claude, ollama } }); return null; } catch (e) { return e; } })();
    T.check('unbekannter Anbieter wirft', e1 && /Unbekannter Anbieter/.test(e1.message), e1 && e1.message);
  });
  await T.safe('Router: Ollama OFFLINE → Rückfall auf die Eskalation (eskaliert:true); andere Fehler und fehlende Eskalation werfen', async () => {
    const claude = fake('cli', () => ok('C')); let ollamaFehler = 'OFFLINE';
    const ollama = fake('ollama', tot('OFFLINE'));
    const R = Router.routeTransport({}, { transports: { claude, ollama } });
    const r = await R.call('x', { kind: 'szene', schema: {} });
    T.check('OFFLINE → Claude antwortet, eskaliert:true, Modell der Eskalation', r.anbieter === 'claude' && r.eskaliert === true && claude.calls[0].o.model === 'sonnet' && !('schema' in claude.calls[0].o), JSON.stringify(r));
    const ollama2 = fake('ollama', tot('EXIT')); const claude2 = fake('cli', () => ok('C'));
    const e2 = await fehler(Router.routeTransport({}, { transports: { claude: claude2, ollama: ollama2 } }).call('x', { kind: 'szene' }));
    T.check('EXIT bei Ollama → Fehler bleibt (Eskalation entscheidet der Spielleiter), Claude nicht gerufen', e2 && e2.code === 'EXIT' && claude2.calls.length === 0, e2 && e2.code);
    const e3 = await fehler(Router.routeTransport({}, { transports: { claude: claude2, ollama }, eskalation: null }).call('x', { kind: 'szene' }));
    T.check('OFFLINE ohne Eskalation → OFFLINE', e3 && e3.code === 'OFFLINE', e3 && e3.code);
    const claude4 = fake('cli', tot('EXIT'));
    const e4 = await fehler(Router.routeTransport({}, { transports: { claude: claude4, ollama } }).call('x', { kind: 'szene' }));
    T.check('Ollama und Claude tot → Fehler (kein Hängen)', e4 && e4.code === 'EXIT', e4 && e4.code);
    const e5 = (() => { try { Router.routeTransport({}, { transports: { claude, ollama }, eskalation: { anbieter: 'ollama' } }); return null; } catch (e) { return e; } })();
    T.check('Eskalation nur an Claude', e5 && /Eskalation nur an claude/.test(e5.message), e5 && e5.message);
  });

  // ---------------- 2. llm.js ----------------
  await T.safe('llm: eskaliere() geht an Claude; Zähler zählt Claude, nicht Ollama; Kosten/usage im Antwortobjekt', async () => {
    await mitLive(async () => {
      LLM.resetBudget();
      const claude = fake('cli', () => ok('C', 1000, 100, 'claude-x')); const ollama = fake('ollama', () => ok('O', 500, 50, 'gemma-x'));
      const llm = LLM.create({ mode: 'live', katalog, transport: Router.routeTransport({}, { transports: { claude, ollama } }) });
      const a = await llm.ask('szene', { prompt: 'p', system: 's' }, { timeoutMs: 1000, schema: { s: 1 } });
      T.check('ask(szene) → Ollama, Zähler unverändert, usage im Objekt', a.anbieter === 'ollama' && a.modell === 'gemma-x' && a.tokens === 550 && LLM.budget().used === 0 && llm.used() === 0 && !a.eskaliert, JSON.stringify({ a: a.anbieter, used: LLM.budget().used }));
      const b = await llm.eskaliere('szene', { prompt: 'p', system: 's' }, { timeoutMs: 1000, schema: { s: 1 } });
      T.check('eskaliere(szene) → Claude, eskaliert:true, Schema nicht an Claude, Zähler +1100', b.anbieter === 'claude' && b.eskaliert === true && claude.calls[0].o.model === 'sonnet' && !('schema' in claude.calls[0].o) && LLM.budget().used === 1100 && LLM.budget().calls === 1, JSON.stringify({ a: b.anbieter, used: LLM.budget().used }));
      const c = await llm.ask('grobplan', { prompt: 'p', system: 's' });
      T.check('ask(grobplan) → Claude, Zähler zählt', c.anbieter === 'claude' && !c.eskaliert && LLM.budget().used === 2200, String(LLM.budget().used));
      T.check('anbieterFuer/eskalationMoeglich', llm.anbieterFuer('szene') === 'ollama' && llm.anbieterFuer('grobplan') === 'claude' && llm.eskalationMoeglich('szene') === true && llm.eskalationMoeglich('grobplan') === false, '');
      LLM.setBudgetLimit(100);
      const e = await fehler(llm.ask('grobplan', { prompt: 'p', system: 's' }));
      const ollamaWeiter = await llm.ask('szene', { prompt: 'p', system: 's' });
      T.check('Claude-Deckel erreicht → Claude BUDGET, Ollama läuft weiter', e && e.code === 'BUDGET' && ollamaWeiter.anbieter === 'ollama', e && e.code);
      LLM.setBudgetLimit(null);
    });
  });
  await T.safe('llm ohne Router: eskaliere() wie ask(), kind kommt beim Transport an, kein Schema ohne Angabe, usage zählt', async () => {
    await mitLive(async () => {
      LLM.resetBudget();
      const cli = fake('cli', () => ok('C', 40, 2));
      const llm = LLM.create({ mode: 'live', katalog, transport: cli });
      const r = await llm.eskaliere('grobplan', { prompt: 'p', system: 's' });
      T.check('gleiche Antwort, Claude-Zähler zählt, kein Router-Feld', r.text === 'C' && LLM.budget().used === 42 && r.anbieter === undefined && cli.calls[0].o.kind === 'grobplan' && !('schema' in cli.calls[0].o) && !('anbieter' in cli.calls[0].o), JSON.stringify(cli.calls[0].o));
      T.check('anbieterFuer ohne Router = claude, keine Eskalation', llm.anbieterFuer('szene') === 'claude' && llm.eskalationMoeglich('szene') === false, '');
    });
  });
  await T.safe("Art 'text': mock und script liefern ein Platzhalter-Ergebnis, unbekannte Art wirft", async () => {
    const m = await LLM.create({ mode: 'mock', katalog }).ask('text', { prompt: 'x' });
    const s = await LLM.create({ mode: 'script', katalog, script: [] }).ask('text', { prompt: 'x' });
    const e = await fehler(LLM.create({ mode: 'mock', katalog }).ask('quatsch', {}));
    T.check("text: mock/script → Platzhalter; KINDS enthält 'text'", m.text === LLM.MOCK_TEXT && s.text === LLM.MOCK_TEXT && LLM.KINDS.includes('text') && e && /Unbekannte Anfrage/.test(e.message), `${m.text} / ${s.text}`);
  });

  // ---------------- 3. Spielleiter ----------------
  const G = LLM.mockGrobplan({ kontext: ctx }, katalog);
  const szeneAntwort = (sid) => JSON.stringify(LLM.mockSzene({ grobplan: G, szene: sid }, katalog));
  const sidAus = (text) => { const m = /Szene '([^']+)' aus/.exec(text) || /<szene>\s*\{\s*"id": "([^"]+)"/.exec(text); return m && m[1]; };   // Neuversuch-Prompt hat keinen Schlusssatz
  const UNGUELTIG = '{"molekuele": [], "verzweigung": [], "wendung": null}';
  // Szenario bauen: verhalten.ollama/claude = (text, o, n) => Ergebnis | wirft; pro Art getrennt für claude (grobplan/szene)
  async function szenario(name, v, laufen) {
    await T.safe(name, async () => {
      await mitLive(async () => {
        LLM.resetBudget();
        const F = H.fakeGame();
        const claudeG = { tot: false };
        const ollama = fake('ollama', (t, o, n) => (v.ollama ? v.ollama(t, o, n) : ok(szeneAntwort(sidAus(t)), 500, 50, 'gemma-x')));
        const claude = fake('cli', (t, o, n) => {
          if (o.kind === 'grobplan') return ok(JSON.stringify(G), 2000, 200, 'sonnet-x');
          if (claudeG.tot) tot('EXIT')();
          return v.claude ? v.claude(t, o, n) : ok(szeneAntwort(sidAus(t)), 1500, 150, 'sonnet-x');
        });
        const llm = LLM.create({ mode: 'live', katalog, transport: Router.routeTransport({}, Object.assign({ transports: { claude, ollama } }, v.router || {})) });
        const regieDir = path.join(tmp, name.replace(/\W+/g, '_'));
        const sl = Spielleiter.create(F.g, { llm, kontext: () => ctx, archiv: Archiv.load().entries, regieDir, katalog, memoryLog: true, ablage: null, config: { offers: 1 } });
        sl.onMissionDone({ id: 'm3', ausgang: 'erfolg' });
        await H.ticks(sl, F.g, 10, 0.25, () => sl.offers().filter((o) => o.origin === 'sl').length >= 1);
        const o = sl.offers().find((x) => x.origin === 'sl');
        if (!o) throw new Error('kein Spielleiter-Angebot: ' + F.errors.join(' | '));
        claudeG.tot = !!v.claudeTotNachPlan;
        if (v.budgetNachPlan) LLM.setBudgetLimit(LLM.budget().used + v.budgetNachPlan);
        const t0 = Date.now();
        const ctl = { F, sl, llm, ollama, claude, o, plan: null };
        sl.accept(o.id); ctl.plan = sl.planById(o.id);
        await laufen(ctl);
        T.check(`${name}: Ablauf ohne Blockieren (Wanduhr) und ohne gezählten Fehler`, Date.now() - t0 < 5000 && !F.errors.length, `${Date.now() - t0} ms, Fehler ${F.errors.join(' | ') || '–'}`);
      });
    });
  }
  const logs = (sl, f) => sl.regie.entries.filter(f);
  const szenenLog = (sl) => logs(sl, (e) => e.art === 'szene');

  await szenario('Szene: Ollama liefert gültig', {}, async ({ F, sl, ollama, claude, plan, o }) => {
    const s2 = plan.grobplan.szenen[1].id;
    // Rohfassung zuerst: das Buch ist registriert und spielbar, bevor irgendeine Antwort da ist
    T.check('Rohfassung zuerst: Buch ist registriert, Szene angefragt', !!F.m.books[o.id] && plan.szenen[s2].state === 'requested', plan.szenen[s2].state);
    await H.ticks(sl, F.g, 10, 0.25, () => plan.szenen[s2].state === 'ready');
    const sz = ollama.calls.filter((c) => c.o.kind === 'szene');
    const schemaSoll = Schema.szenenSchemaFuer(env, plan.grobplan.szenen[1]);
    T.check('Szene ersetzt (updateBook), Quelle llm, nur Ollama gefragt, kein Claude für Szenen', plan.szenen[s2].state === 'ready' && plan.szenen[s2].quelle === 'llm' && F.m.updates.includes(o.id) && claude.calls.filter((c) => c.o.kind === 'szene').length === 0, `Ollama-Szenen ${sz.length}`);
    T.check('Schema aus dem Katalog geht in der Szenen-Anfrage an Ollama', sz.length >= 1 && JSON.stringify(sz[0].o.schema) === JSON.stringify(schemaSoll), sz[0] && JSON.stringify(sz[0].o.schema).slice(0, 80));
    const e = szenenLog(sl).find((x) => x.szene === s2);
    T.check('Logbuch: anbieter ollama, modell, tokens, nicht eskaliert', e && e.anbieter === 'ollama' && e.modell === 'gemma-x' && e.tokens === 550 && e.eskaliert === undefined && !e.fehler.length, JSON.stringify(e));
    T.check('Token-Zähler zählt nur den Claude-Grobplan (2200), nicht Ollama', LLM.budget().used === 2200, String(LLM.budget().used));
  });
  await szenario('Szene: Ollama ungültig → Eskalation an Claude, kein zweiter Gemma-Versuch', { ollama: (t) => ok(UNGUELTIG, 500, 50, 'gemma-x') }, async ({ F, sl, ollama, claude, plan, o }) => {
    const s2 = plan.grobplan.szenen[1].id; const s3 = plan.grobplan.szenen[2].id;
    await H.ticks(sl, F.g, 20, 0.25, () => plan.szenen[s2].state === 'ready' && plan.szenen[s3].state === 'ready');
    const oSz = ollama.calls.filter((c) => c.o.kind === 'szene'); const cSz = claude.calls.filter((c) => c.o.kind === 'szene');
    T.check('je Szene genau ein Ollama-Lauf und ein Claude-Lauf, beide Szenen von Claude ersetzt', oSz.length === 2 && cSz.length === 2 && plan.szenen[s2].state === 'ready' && plan.szenen[s2].quelle === 'llm' && F.m.updates.includes(o.id), `Ollama ${oSz.length}, Claude ${cSz.length}`);
    T.check('Claude bekommt dieselbe Anfrage (gleicher Prompttext, ohne Prüferfehler) und kein Schema', cSz[0].text === oSz[0].text && !('schema' in cSz[0].o) && cSz[0].o.model === 'sonnet' && !/<pruefer>/.test(cSz[0].text), cSz[0].text.slice(-80));
    const eintraege = szenenLog(sl).filter((x) => x.szene === s2);
    T.check('Logbuch: Ollama-Eintrag mit Fehlern und eskaliert:true, Claude-Eintrag anbieter claude, eskaliert:true, gültig', eintraege.length === 2 && eintraege[0].anbieter === 'ollama' && eintraege[0].eskaliert === true && eintraege[0].fehler.length > 0 && eintraege[1].anbieter === 'claude' && eintraege[1].eskaliert === true && !eintraege[1].fehler.length, JSON.stringify(eintraege.map((x) => [x.anbieter, x.eskaliert, x.fehler.length])));
    T.check('Token-Zähler: Grobplan 2200 + zwei Claude-Szenen 2×1650, Ollama nicht', LLM.budget().used === 2200 + 2 * 1650, String(LLM.budget().used));
  });
  await szenario('Szene: Ollama ungültig und Claude tot → bleibt Rohfassung', { ollama: () => ok(UNGUELTIG), claudeTotNachPlan: true }, async ({ F, sl, ollama, claude, plan, o }) => {
    const s2 = plan.grobplan.szenen[1].id;
    await H.ticks(sl, F.g, 10, 0.25, () => plan.szenen[s2].state === 'failed');
    T.check('Szene failed/Rohfassung, Buch unverändert, Mission läuft weiter', plan.szenen[s2].state === 'failed' && plan.szenen[s2].quelle === 'rohfassung' && !F.m.updates.includes(o.id) && F.m.activeId === o.id, plan.szenen[s2].state);
    const rueck = logs(sl, (e) => e.art === 'rueckfall' && e.szene === s2);
    T.check('Rückfall im Logbuch (EXIT von Claude), Ollama nur einmal je Szene gefragt', rueck.length >= 1 && /EXIT/.test(rueck[0].begruendung) && ollama.calls.filter((c) => c.o.kind === 'szene').length <= 2, rueck[0] && rueck[0].begruendung);
  });
  await szenario('Szene: Ollama ungültig und Claude ungültig → Rohfassung (kein dritter Versuch)', { ollama: () => ok(UNGUELTIG), claude: () => ok(UNGUELTIG, 10, 10) }, async ({ F, sl, ollama, claude, plan }) => {
    const s2 = plan.grobplan.szenen[1].id; const s3 = plan.grobplan.szenen[2].id;
    await H.ticks(sl, F.g, 15, 0.25, () => plan.szenen[s2].state === 'failed' && plan.szenen[s3].state === 'failed');
    T.check('beide Szenen Rohfassung; je Szene 1× Ollama, 1× Claude', plan.szenen[s2].state === 'failed' && plan.szenen[s3].state === 'failed' && ollama.calls.filter((c) => c.o.kind === 'szene').length === 2 && claude.calls.filter((c) => c.o.kind === 'szene').length === 2, `${ollama.calls.length}/${claude.calls.length}`);
  });
  await szenario('Szene: Ollama ungültig, Eskalation abgeschaltet → Rohfassung, nur ein Ollama-Lauf je Szene', { ollama: () => ok(UNGUELTIG), router: { eskalation: null } }, async ({ F, sl, ollama, claude, plan }) => {
    const s2 = plan.grobplan.szenen[1].id;
    await H.ticks(sl, F.g, 10, 0.25, () => plan.szenen[s2].state === 'failed');
    await H.ticks(sl, F.g, 3, 0.25);
    T.check('Szene Rohfassung (failed), kein zweiter Gemma-Versuch, Claude nicht gefragt', plan.szenen[s2].state === 'failed' && plan.szenen[s2].quelle === 'rohfassung' && ollama.calls.filter((c) => c.o.kind === 'szene').length === 2 && claude.calls.filter((c) => c.o.kind === 'szene').length === 0, `${ollama.calls.length}/${claude.calls.length}`);
    const rueck = logs(sl, (e) => e.art === 'rueckfall' && e.szene === s2);
    T.check('Logbuch: Rückfall „keine Eskalation“', rueck.length === 1 && /keine Eskalation/.test(rueck[0].begruendung), rueck[0] && rueck[0].begruendung);
  });
  await szenario('Claude-Budget fast leer: Ollama-Szenen laufen weiter, Eskalation wird verweigert (Rohfassung)', { budgetNachPlan: 100, ollama: (t) => ok(/s2_mock/.test(sidAus(t)) ? szeneAntwort('s2_mock') : UNGUELTIG, 10, 10, 'gemma-x') }, async ({ F, sl, ollama, claude, plan, o }) => {
    const s2 = plan.grobplan.szenen[1].id; const s3 = plan.grobplan.szenen[2].id;
    await H.ticks(sl, F.g, 10, 0.25, () => plan.szenen[s2].state === 'ready' && plan.szenen[s3].state === 'failed');
    T.check('s2 von Ollama trotz leerem Claude-Deckel (ready, llm); s3 ungültig → Eskalation am Deckel gescheitert → Rohfassung', plan.szenen[s2].state === 'ready' && plan.szenen[s2].quelle === 'llm' && plan.szenen[s3].state === 'failed' && claude.calls.filter((c) => c.o.kind === 'szene').length === 0, `${plan.szenen[s2].state}/${plan.szenen[s3].state}, Claude-Szenen ${claude.calls.filter((c) => c.o.kind === 'szene').length}`);
    LLM.setBudgetLimit(null);
  });
  await szenario('Szene: Ollama leer (EMPTY) → Eskalation', { ollama: tot('EMPTY') }, async ({ F, sl, claude, plan }) => {
    const s2 = plan.grobplan.szenen[1].id;
    await H.ticks(sl, F.g, 10, 0.25, () => plan.szenen[s2].state === 'ready');
    T.check('Claude liefert die Szene', plan.szenen[s2].state === 'ready' && claude.calls.filter((c) => c.o.kind === 'szene').length >= 1, plan.szenen[s2].state);
  });
  await szenario('Szene: Ollama tot (OFFLINE) → Router fällt auf Claude zurück', { ollama: tot('OFFLINE') }, async ({ F, sl, claude, plan }) => {
    const s2 = plan.grobplan.szenen[1].id;
    await H.ticks(sl, F.g, 10, 0.25, () => plan.szenen[s2].state === 'ready');
    const e = szenenLog(sl).find((x) => x.szene === s2);
    T.check('Szene von Claude, im Logbuch eskaliert:true', plan.szenen[s2].state === 'ready' && e && e.anbieter === 'claude' && e.eskaliert === true, JSON.stringify(e));
  });
  await szenario('Ollama UND Claude tot: Rohfassung wird gespielt, nichts blockiert (Anflug, Wartezeit ≤ sceneWaitMax)', { ollama: tot('OFFLINE'), claudeTotNachPlan: true }, async ({ F, sl, plan, o }) => {
    const s2 = plan.grobplan.szenen[1];
    F.m.step = { id: `${s2.id}_anflug` }; F.g.ship.scene = s2.ort;
    const t0 = F.g.time; let bereitNach = null;
    for (let i = 0; i < 200 && bereitNach === null; i++) { F.g.time += 0.25; sl.update(0.25); await H.flush(); if (sl.sceneReady(o.id, s2.id)) bereitNach = F.g.time - t0; }
    T.check('Szene bleibt Rohfassung, Anflug gibt frei (≤ sceneWaitMax + 0,5 s)', bereitNach !== null && bereitNach <= F.g.C.spielleiter.sceneWaitMax + 0.5 && plan.szenen[s2.id].quelle === 'rohfassung' && plan.szenen[s2.id].state === 'failed', `bereit nach ${bereitNach} s, ${plan.szenen[s2.id].state}`);
    // die Mission läuft mit der Rohfassung weiter: betreten, Folgeszene ebenfalls versucht, kein Absturz
    F.m.step = { id: s2.id }; F.g.time += 0.25; sl.update(0.25); await H.flush();
    await H.ticks(sl, F.g, 10, 0.25);
    T.check('Szene betreten, Buch registriert und unverändert, Spielleiter wirft nicht', plan.szenen[s2.id].state === 'active' && !F.m.updates.includes(o.id) && !!F.m.books[o.id], plan.szenen[s2.id].state);
  });
  await szenario('Ollama hängt (nie eine Antwort), Claude tot: Spiel wartet höchstens sceneWaitMax', { ollama: () => new Promise(() => {}), claudeTotNachPlan: true }, async ({ F, sl, plan, o }) => {
    const s2 = plan.grobplan.szenen[1];
    F.m.step = { id: `${s2.id}_anflug` }; F.g.ship.scene = s2.ort;
    const t0 = F.g.time; let bereitNach = null;
    for (let i = 0; i < 400 && bereitNach === null; i++) { F.g.time += 0.25; sl.update(0.25); await H.flush(); if (sl.sceneReady(o.id, s2.id)) bereitNach = F.g.time - t0; }
    T.check('Rohfassung nach höchstens sceneWaitMax s, obwohl die Anfrage offen bleibt', bereitNach !== null && bereitNach <= F.g.C.spielleiter.sceneWaitMax + 0.5 && plan.szenen[s2.id].quelle === 'rohfassung', `bereit nach ${bereitNach}`);
  });
  await szenario('Standardverhalten: ohne Router wie bisher (zweiter Versuch bei ungültiger Antwort, kein Schema)', { }, async ({ F, sl, plan, o }) => {
    // eigener Spielleiter mit gewöhnlichem Transport (kein Router): ungültig → Neuversuch mit Prüferfehlern
    const antworten = []; const cli = fake('cli', (t, c) => { antworten.push(c); return c.kind === 'grobplan' ? ok(JSON.stringify(G), 1, 1) : ok(antworten.filter((x) => x.kind === 'szene').length === 1 ? UNGUELTIG : szeneAntwort(sidAus(t)), 1, 1); });
    const F2 = H.fakeGame();
    const sl2 = Spielleiter.create(F2.g, { llm: LLM.create({ mode: 'live', katalog, transport: cli }), kontext: () => ctx, archiv: Archiv.load().entries, regieDir: path.join(tmp, 'std'), katalog, memoryLog: true, ablage: null, config: { offers: 1 } });
    sl2.onMissionDone({ id: 'm3' });
    await H.ticks(sl2, F2.g, 10, 0.25, () => sl2.offers().some((x) => x.origin === 'sl'));
    const o2 = sl2.offers().find((x) => x.origin === 'sl'); sl2.accept(o2.id);
    const p2 = sl2.planById(o2.id); const s = p2.grobplan.szenen[1].id;
    await H.ticks(sl2, F2.g, 10, 0.25, () => p2.szenen[s].state === 'ready');
    const sz = antworten.filter((x) => x.kind === 'szene');
    T.check('ohne Router: Neuversuch bei Claude, kein Schema, keine Eskalationsfelder im Logbuch', p2.szenen[s].state === 'ready' && sz.length >= 2 && sz.every((x) => !('schema' in x)) && sl2.regie.entries.every((e) => e.eskaliert === undefined && e.anbieter === undefined) && !F2.errors.length, `${sz.length} Szenen-Aufrufe, Schema ${sz.map((x) => 'schema' in x).join(',')}, Fehler ${F2.errors.join('|')}, Log ${JSON.stringify(sl2.regie.entries.filter((e) => e.eskaliert !== undefined || e.anbieter !== undefined).map((e) => [e.anbieter, e.eskaliert]))}`);
  });
  T.finish();
})();
