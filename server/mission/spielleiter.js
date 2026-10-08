'use strict';
// Spielleiter an der Missionsgrenze (CONTRACT-S2 §2.1). Nie blockierend: LLM-Antworten landen in einer Inbox und werden
// zwischen zwei Ticks in update() verarbeitet; höchstens CONFIG.spielleiter.maxConcurrent (1) CLI-Prozess gleichzeitig,
// Warteschlange mit Szenen vor Grobplänen. Nichts wirft in den Tick (Fehler -> game.countError).
//
//   const sl = Spielleiter.create(game, opts?)  // game.spielleiter; nur Kampagne (game.weltstand.persistent)
//   sl.update(dt)                              // aus game.step() vor mission.update
//   sl.onMissionDone({ id, ausgang })          // Missionsgrenze: 2 Grobpläne + 1 Archiv-Angebot
//   sl.onCampaignStart({ tutorial })           // ohne Tutorial: Archiv sofort, Planung nach dem Tesk-Funk
//   sl.onSceneEnter(missionId, sceneOrStepId)  // Vorlauf: Nachfolgeszenen anfragen
//   sl.offers()                                // -> [{ id, titel, von, ziel, dauer_min, belohnung, erinnerung, origin, state }]
//   sl.accept(id) / sl.decline(id)             // -> Fehlertext | null (accept startet die Mission per mission.startMission)
//   sl.planning()                              // -> null | { stage: 0|1|2, von }
//   sl.sceneReady(missionId, szene) / sl.sceneTimeout(missionId, szene)   // Prüfung 'szene_bereit' (ENGINE)
//   sl.toSave() / sl.restore(obj)              // Weltstand-Block `spielleiter` (CONTRACT-S2 §3.2)
//   sl.debug(args, player)                     // `sl status|plan|fail grobplan|szene|archiv` -> Fehlertext | null
//
// Plan-Zustände:  planning → checking → (retry ≤ 1) → offered → running → done | fallback (→ Archiv/Mock → offered)
// Szenen-Zustände: rohfassung → requested → ready | failed → active
//
// opts (Tests): { llm, mode, archivDir, archiv (Einträge), regieDir, memoryLog, katalog, env, config, kontext(anlass) }

const path = require('path');
const LLM = require('./llm.js');
const Szenenbau = require('./szenenbau.js');
const Archiv = require('./archiv.js');
const Regielog = require('./regielog.js');
const Context = require('./context.js');
const Loader = require('./loader.js');
const Ablage = require('./ablage.js');

const DEFAULTS = { offers: 2, archivOffers: 1, grobplanTimeout: 120, sceneTimeout: 45, retries: 1, minBudget: 30000,
  sceneWaitMax: 20, prefetch: 'start', maxConcurrent: 1, rateLimitPause: 60, regieRotateBytes: 5 * 1024 * 1024,
  minPlanMinutes: 10, targetMinutes: 15, maxOpenThreads: 1 };
const TEASER_TEXT = 'Bei mir läuft gerade was rein, bleibt in der Nähe.';
const WAIT_ODA = 'Kurs wird berechnet …';
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

let KAT_CACHE = null;
function katalog() {
  if (!KAT_CACHE) KAT_CACHE = require('./katalog.js').load({});
  return KAT_CACHE;
}

// Modus aus der .env: live nur mit SPIELLEITER_LLM=live UND LLM_LIVE=1 (Entscheidung 12); mock für Debug; sonst aus
function llmModeFromEnv(env) {
  const e = env || process.env;
  const m = String(e.SPIELLEITER_LLM || 'off').toLowerCase();
  if (m === 'live') return e.LLM_LIVE === '1' ? 'live' : 'off';
  if (m === 'mock') return 'mock';
  return 'off';
}

class Spielleiter {
  constructor(game, opts) {
    const o = opts || {};
    this.game = game;
    this.opts = o;
    this.env = o.env || (game && game.env) || process.env;
    this.C = Object.assign({}, DEFAULTS, (game && game.C && game.C.spielleiter) || {}, o.config || {});
    this.regieDir = o.regieDir || Regielog.dir(this.env);
    this.mode = o.llm ? o.llm.mode : (o.mode || llmModeFromEnv(this.env));
    this.kat = o.katalog || null;
    this.llm = o.llm || null;
    this.transportOff = null;     // Grund, wenn der Transport für diesen Lauf aus ist (z. B. CLI fehlt)
    this.plans = {};              // key -> Plan
    this.queue = []; this.job = null; this.inbox = []; this.seq = 0;
    this.pauseUntil = -Infinity;  // 429: Spielzeit, bis zu der keine Jobs starten
    this.failNext = {};           // Debug: nächster Aufruf dieser Art schlägt fehl
    this.nextId = 1;
    this.archivGespielt = []; this.zusammenfassung = [];
    this.declinedArchiv = [];     // abgelehnte Archiv-Namen (Weltstand: archiv_abgelehnt)
    this.archivEntries = o.archiv || null;
    this.pendingStartAt = null;
    this.teaserSent = false;
    this.lastSealAt = -Infinity;
    this.waits = {};              // `${mid}:${sid}` -> { t0, sent }
    this.stats = { waits: [], maxWait: 0, fallbacks: 0, grobplaene: 0, szenen: 0 };
    this.regie = null; this.regieWelt = null;
    this.errorsOnce = new Set();
    this.lastStep = null;
    this.safetyAt = -Infinity;
    this.inflight = 0;            // laufende CLI-Prozesse (auch verworfene, bis sie enden oder ihr Timeout greift)
  }

  // ---------- Hilfen ----------
  get time() { return (this.game && Number.isFinite(this.game.time)) ? this.game.time : 0; }
  countError(where, err) {
    try { if (this.game && typeof this.game.countError === 'function') this.game.countError('spielleiter-' + where, err); else console.warn('[Pantheon] spielleiter-' + where + ':', err && err.message); } catch (e) { /* nie werfen */ }
  }
  countOnce(where, msg) { if (this.errorsOnce.has(where)) return; this.errorsOnce.add(where); this.countError(where, new Error(msg)); }
  katalog() { return (this.kat = this.kat || katalog()); }
  env2() { return (this.envCache = this.envCache || Szenenbau.buildEnv(this.katalog())); }
  getLlm() {
    if (!this.llm) {
      try {
        this.llm = LLM.create({ mode: this.mode, katalog: this.mode === 'mock' ? this.katalog() : undefined,
          recordDir: path.join(this.regieDir, 'aufnahmen') });
      } catch (e) { this.countError('llm', e); this.llm = LLM.create({ mode: 'off' }); }
    }
    return this.llm;
  }
  transportUsable() { return !this.transportOff && this.mode !== 'off' && this.getLlm().mode !== 'off'; }
  archiv() {
    if (!this.archivEntries) {
      const r = Archiv.load(this.opts.archivDir);
      for (const e of r.errors) this.countError('archiv', new Error(`${e.file}: ${e.msg}`));
      this.archivEntries = r.entries;
    }
    return this.archivEntries;
  }
  // Ablage erzeugter Missionen (CONTRACT-S2 §8c): opts.ablage (Instanz | null = aus), sonst Ablage.fromEnv (nur live/ERZEUGT_*)
  ablage() {
    if (this.ablageInst === undefined) {
      try { this.ablageInst = this.opts.ablage !== undefined ? (this.opts.ablage || null) : Ablage.fromEnv(this.env, { live: this.mode === 'live', onError: (e) => this.countError('ablage', e) }); } catch (e) { this.countError('ablage', e); this.ablageInst = null; }
    }
    return this.ablageInst;
  }
  ablageStore(plan, how) {
    try {
      const ab = this.ablage();
      if (!ab || !plan || plan.origin !== 'sl' || !plan.book || !plan.grobplan) return;
      const szq = {}; for (const [sid, sc] of Object.entries(plan.szenen || {})) szq[sid] = sc.quelle || 'rohfassung';
      const llm = this.llm || null;
      ab[how === 'update' ? 'updateBook' : 'saveBook']({ book: plan.book, grobplan: plan.grobplan, szenen: plan.bookAnswers, kontext: plan.kontext,
        meta: { welt: this.weltId(), plan: plan.key, origin: plan.origin, quelle: plan.quelle, modell: llm && llm.mode === 'live' ? llm.model : (llm ? llm.mode : this.mode),
          tokens: plan.tokens, anlass: plan.anlass, szenen_quelle: szq, erinnerung_text: plan.erinnerungText } });
    } catch (e) { this.countError('ablage', e); }
  }
  mission() { return this.game && this.game.mission; }
  weltId() { const w = this.game && this.game.weltstand; return (w && w.id) || 'ohne-welt'; }
  log(entry) {
    try {
      const id = this.weltId();
      if (!this.regie || this.regieWelt !== id) {
        this.regie = Regielog.create({ dir: this.regieDir, weltId: id, rotateBytes: this.C.regieRotateBytes, memoryOnly: !!this.opts.memoryLog || (!!this.game && this.game.worldsEnabled === false && !(this.env && this.env.REGIE_DIR)), onError: (e) => this.countError('regielog', e) });   // noStore-Spiele (Tests) schreiben nichts
        this.regieWelt = id;
      }
      return this.regie.write(Object.assign({ spielzeit: this.playTime() }, entry));
    } catch (e) { this.countError('regielog', e); return null; }
  }
  playTime() { try { const m = this.mission(); return m && typeof m.playTime === 'function' ? m.playTime() : this.time; } catch (e) { return this.time; } }
  emit(kind, data) { try { if (this.game && typeof this.game.emit === 'function') this.game.emit(kind, data); } catch (e) { this.countError('emit', e); } }
  // Missions-Engine (ENGINE) defensiv aufrufen
  callMission(fn, ...args) {
    const m = this.mission();
    if (!m || typeof m[fn] !== 'function') { this.countOnce('mission-' + fn, `mission.${fn} fehlt (ENGINE)`); return undefined; }
    try { return m[fn](...args); } catch (e) { this.countError('mission-' + fn, e); return undefined; }
  }
  kontext(anlass) {
    if (typeof this.opts.kontext === 'function') { try { return this.opts.kontext(anlass); } catch (e) { this.countError('kontext', e); } }
    let data = {};
    try {
      const W = require('../weltstand.js');
      if (this.game && this.game.weltstand && this.game.weltstand.data) data = W.capture(this.game);
    } catch (e) { this.countError('kontext', e); }
    try { return Context.build(data, anlass || {}, this.katalog()); } catch (e) { this.countError('kontext', e); return {}; }
  }
  crew() { try { return Math.max(1, Math.min(3, (this.game.players || []).filter((p) => p.connected).length || 1)); } catch (e) { return 1; } }
  plansBy(pred) { return Object.values(this.plans).filter(pred); }
  planById(id) { return Object.values(this.plans).find((p) => p.id === id) || null; }
  tutorialDone() {
    const m = this.mission();
    if (!m || !m.missions) return false;
    const order = (m.order || []).filter((id) => { try { const inf = m.info(id); return inf && inf.tutorial; } catch (e) { return false; } });
    return order.length > 0 && order.every((id) => m.missions[id] && m.missions[id].state === 'done');
  }

  // ---------- Lebenszyklus ----------
  onCampaignStart(o) {
    try {
      const tutorial = !(o && o.tutorial === false);
      this.log({ art: 'kampagne', begruendung: tutorial ? 'Kampagne mit Tutorial – Planung erst nach der letzten Tutorial-Mission' : 'Kampagne ohne Tutorial – Archiv sofort, Planung nach dem Tesk-Funk' });
      if (tutorial) return;
      this.ensureArchivOffer({ art: 'kampagnenstart', tutorial: false });
      const camp = (this.game && this.game.C && this.game.C.campaign) || {};
      this.pendingStartAt = this.time + (camp.teskRumorAt != null ? camp.teskRumorAt : 8) + 2;
    } catch (e) { this.countError('onCampaignStart', e); }
  }

  onMissionDone(d) {
    try {
      const id = d && d.id; const ausgang = d && d.ausgang;
      const plan = this.planById(id);
      if (plan) {
        plan.state = 'done';
        this.zusammenfassung.push({ id, titel: plan.book ? plan.book.kopf.titel : id, auftraggeber: plan.book ? plan.book.kopf.auftraggeber : null, ausgang: ausgang || null });
        if (this.zusammenfassung.length > 50) this.zusammenfassung.splice(0, this.zusammenfassung.length - 50);
        this.log({ art: 'abschluss', mission: id, quelle: plan.quelle, tokens: plan.tokens, ausgang, origin: plan.origin,
          begruendung: `Mission abgeschlossen (${ausgang || '–'}), Szenen: ${Object.entries(plan.szenen).map(([s, x]) => `${s}=${x.quelle}`).join(', ')}` });
        // §8c: Mission beendet -> Abschnitt „Gespielt“ in der Ablage
        if (plan.origin === 'sl' && this.ablage()) {
          try { this.ablage().recordPlay({ id, welt: this.weltId(), ausgang: ausgang || null, dauer_s: Number.isFinite(plan.acceptedAt) ? this.time - plan.acceptedAt : null, crew: this.crew() }); } catch (e) { this.countError('ablage', e); }
        }
        delete this.plans[plan.key];
      }
      // Tutorial: erst nach der letzten Tutorial-Mission planen
      const m = this.mission();
      let inf = null; try { inf = m && m.info ? m.info(id) : null; } catch (e) { inf = null; }
      if (inf && inf.tutorial && !this.tutorialDone()) return;
      this.startRound({ art: 'missionsgrenze', nach: id, ausgang: ausgang || null, tutorialEnde: !!(inf && inf.tutorial) });
    } catch (e) { this.countError('onMissionDone', e); }
  }

  // Eine Planungsrunde: Archiv-Angebot sofort, fehlende Spielleiter-Angebote anfragen
  startRound(anlass, opts) {
    const o = opts || {};
    this.ensureArchivOffer(anlass);
    const open = this.plansBy((p) => p.slot === 'sl' && ['planning', 'checking', 'retry', 'offered'].includes(p.state)).length;
    const need = o.force ? 1 : Math.max(0, this.C.offers - open);
    for (let i = 0; i < need; i++) this.createSlPlan(anlass);
    if (need && anlass && anlass.tutorialEnde && !this.teaserSent) {
      this.teaserSent = true;
      // Teaser abgelöst (Entscheidung 19): Tesk funkt während der ersten Planung
      const m = this.mission();
      if (m && typeof m.radio === 'function') { try { m.radio(Loader.npcName('tesk'), TEASER_TEXT, false); } catch (e) { this.countError('teaser', e); } }
    }
  }
  ensureArchivOffer(anlass) {
    const have = this.plansBy((p) => p.slot === 'archiv' && ['offered'].includes(p.state)).length;
    for (let i = have; i < this.C.archivOffers; i++) {
      const plan = this.newPlan('archiv', anlass);
      if (!this.planFromArchive(plan, 'Archiv-Angebot der Missionsgrenze')) this.planFromMock(plan, 'Archiv leer');
    }
  }
  newPlan(slot, anlass) {
    const key = 'p' + (++this.seq);
    const plan = { key, id: null, slot, origin: slot === 'archiv' ? 'archiv' : 'sl', state: 'planning', anlass: Object.assign({}, anlass || {}),
      grobplan: null, quelle: null, versuche: 0, fehler: [], t0: this.time, book: null, szenen: {}, bookAnswers: {}, entered: new Set(),
      tokens: 0, kontext: null, archivName: null, erinnerungText: null, offeredAt: null, triedArchiv: [] };
    this.plans[key] = plan;
    return plan;
  }
  createSlPlan(anlass) {
    const plan = this.newPlan('sl', anlass);
    plan.kontext = this.kontext(Object.assign({ crew: this.crew() }, anlass || {}));
    if (!this.transportUsable()) { this.fallbackPlan(plan, this.transportOff || `LLM aus (Modus ${this.mode})`); return plan; }
    this.enqueue({ type: 'grobplan', plan });
    this.log({ art: 'planung', plan: plan.key, begruendung: `Grobplan angefragt (${(anlass && anlass.art) || '–'})` });
    return plan;
  }

  // ---------- Warteschlange ----------
  enqueue(job) { job.token = 0; this.queue.push(job); }
  nextJob() {
    if (!this.queue.length) return null;
    let i = this.queue.findIndex((j) => j.type === 'szene');
    if (i < 0) i = 0;
    return this.queue.splice(i, 1)[0];
  }
  startJob(job) {
    const kind = job.type;
    job.token = ++this.seq; job.startedAt = this.time; job.wall = Date.now();
    const fail = (code, msg) => { this.finishJob(job, null, LLM.llmError(code, msg)); };
    if (this.failNext[kind]) { this.failNext[kind] = false; return fail('EXIT', `Debug: sl fail ${kind}`); }
    if (!this.transportUsable()) return fail('OFF', this.transportOff || 'LLM aus');
    const b = LLM.budget();
    if (b.remaining < this.C.minBudget) return fail('BUDGET', `Token-Budget fast leer (${b.used} von ${b.limit}, Rest < ${this.C.minBudget})`);
    let input;
    try { input = kind === 'grobplan' ? this.grobplanInput(job) : this.sceneInput(job); } catch (e) { this.countError('prompt', e); return fail('EXIT', 'Prompt nicht baubar: ' + e.message); }
    this.job = job;
    const timeoutMs = 1000 * (kind === 'grobplan' ? this.C.grobplanTimeout : this.C.sceneTimeout);
    let p;
    try { p = this.getLlm().ask(kind, input, { timeoutMs }); } catch (e) { p = Promise.reject(e); }
    const token = job.token;
    this.inflight++; job.inflight = true;
    const settle = () => { if (job.inflight) { job.inflight = false; this.inflight = Math.max(0, this.inflight - 1); } };
    Promise.resolve(p).then((r) => { settle(); this.inbox.push({ token, r }); }, (e) => { settle(); this.inbox.push({ token, e }); });
    job.release = settle;
  }
  drainInbox() {
    while (this.inbox.length) {
      const it = this.inbox.shift();
      const job = this.job;
      if (!job || job.token !== it.token) {
        // verspätete Antwort (Timeout schon behandelt): Tokens zählen trotzdem (LLM.budget), sonst verwerfen
        this.log({ art: 'verspaetet', begruendung: 'Antwort nach Zeitüberschreitung verworfen', tokens: it.r ? it.r.tokens : 0 });
        continue;
      }
      this.job = null;
      this.finishJob(job, it.r || null, it.e || null);
    }
  }
  checkJobTimeout() {
    const job = this.job;
    if (!job) return;
    const limit = job.type === 'grobplan' ? this.C.grobplanTimeout : this.C.sceneTimeout;
    // der Transport beendet den Prozess nach derselben Frist (Wanduhr) -> Platz wieder frei
    if (this.time - job.startedAt > limit + 1) { this.job = null; if (job.release) job.release(); this.finishJob(job, null, LLM.llmError('ETIMEDOUT', `Zeitüberschreitung nach ${limit} s (Spielzeit)`)); }
  }
  finishJob(job, r, e) {
    if (this.job === job) this.job = null;
    const dauer = Math.max(0, this.time - (job.startedAt || this.time));
    const plan = job.plan;
    if (r) plan.tokens += r.tokens || 0;
    if (e) {
      if (e.code === 'ENOENT') this.transportOff = 'CLI fehlt (' + e.message + ')';
      if (e.code === 'RATE_LIMIT') this.pauseUntil = this.time + this.C.rateLimitPause;
      this.log({ art: job.type, mission: plan.id, szene: job.sid || null, quelle: 'llm', dauer_s: dauer, tokens: 0, fehler: [`${e.code || 'FEHLER'}: ${e.message}`], begruendung: 'LLM-Aufruf fehlgeschlagen', plan: plan.key });
      if (job.type === 'grobplan') this.fallbackPlan(plan, `${e.code || 'FEHLER'}: ${e.message}`);
      else this.sceneFailed(plan, job.sid, `${e.code || 'FEHLER'}: ${e.message}`);
      return;
    }
    const quelle = r.source === 'live' ? 'llm' : (r.source === 'mock' ? 'mock' : 'llm');
    if (job.type === 'grobplan') this.handleGrobplan(plan, job, r, dauer, quelle);
    else this.handleScene(plan, job, r, dauer, quelle);
  }

  // ---------- Grobplan ----------
  grobplanInput(job) {
    const plan = job.plan; const k = plan.kontext || {};
    const kurz = Object.assign({}, k); delete kurz.verfuegbar;
    const auftrag = [`Plane die nächste Mission für eine Crew von ${(k.crew && k.crew.anzahl) || this.crew()}.`,
      `Ziel: etwa ${this.C.targetMinutes} min, 4–6 Szenen, 1–2 Entscheidungen.`,
      plan.anlass && plan.anlass.nach ? `Anlass: Mission '${plan.anlass.nach}' ist gerade abgeschlossen (Ausgang ${plan.anlass.ausgang || '–'}).` : 'Anlass: Kampagnenstart.',
      `Schon im Angebot (bitte etwas anderes): ${this.offers().map((x) => `${x.titel} (${x.von})`).join('; ') || '–'}.`,
      plan.anlass && typeof plan.anlass.auftrag === 'string' ? `Vorgabe der Regie: ${plan.anlass.auftrag}` : '',
      plan.anlass && plan.anlass.auftraggeber ? `Auftraggeber: ${plan.anlass.auftraggeber}.` : ''].filter(Boolean).join('\n');
    const prompt = LLM.buildPrompt({
      katalog: require('./katalog.js').fuerSpielleiter(this.katalog(), 'kurz'),
      variabel: [['weltstand', JSON.stringify(kurz)], ['auftrag', auftrag]],
      schluss: 'Gib jetzt den Grobplan aus. Nur das JSON-Objekt.',
      vorher: job.retry || null,
    });
    // anlass/kontext stehen zusätzlich als Objekt im input (mock/script bauen daraus ihre Antwort; live sendet nur 'prompt')
    return { prompt, system: LLM.systemPromptFile('grobplan'), art: 'grobplan', welt: this.weltId(), plan: plan.key, versuch: plan.versuche + 1, anlass: plan.anlass, kontext: k };
  }
  handleGrobplan(plan, job, r, dauer, quelle) {
    plan.versuche++;
    this.stats.grobplaene++;
    let g = null; const errs = []; let warns = [];
    try { g = Szenenbau.parseJsonAnswer(r.text); } catch (e) { errs.push('kein gültiges JSON: ' + e.message); }
    let built = null;
    if (g) {
      errs.push(...Szenenbau.checkGrobplan(g, this.env2()));
      const s2 = Szenenbau.checkGrobplanS2(g, this.env2(), plan.kontext, { origin: 'sl', minMinutes: this.C.minPlanMinutes, maxThreads: this.C.maxOpenThreads, crew: this.crew() });
      errs.push(...s2.errors); warns = s2.warnings;
      if (!errs.length) {
        plan.state = 'checking';
        built = this.buildPlanBook(plan, g, {});
        if (built.errors.length) errs.push(...built.errors.map((x) => (typeof x === 'string' ? x : `${x.code} ${x.p}: ${x.msg}`)));
      }
    }
    this.log({ art: 'grobplan', mission: built && !errs.length ? built.book.id : null, quelle, dauer_s: dauer, tokens: r.tokens || 0, fehler: errs.slice(0, 20),
      begruendung: errs.length ? `Grobplan ungültig (Versuch ${plan.versuche})` : `Grobplan „${g.titel}“ gültig${warns.length ? ' – ' + warns.join(' | ') : ''}`, versuch: plan.versuche, plan: plan.key, budget: LLM.budget().used });
    if (g && Array.isArray(g.wuensche) && this.regie) for (const w of g.wuensche.slice(0, 5)) this.regie.wish(w, { mission: built && built.book ? built.book.id : plan.key, quelle });
    if (errs.length) {
      plan.fehler = errs;
      if (plan.versuche <= this.C.retries) {
        plan.state = 'retry';
        this.enqueue({ type: 'grobplan', plan, retry: { antwort: String(r.text).slice(0, 12000), fehler: errs.slice(0, 25) } });
        return;
      }
      this.fallbackPlan(plan, `Grobplan ${plan.versuche}× ungültig`);
      return;
    }
    plan.grobplan = g; plan.quelle = quelle;
    plan.erinnerungText = g.erinnerung_text || null;
    this.adoptBook(plan, built, {});
    this.offer(plan);
  }

  // Buch bauen (Mission-ID beim ersten Mal vergeben)
  buildPlanBook(plan, g, answers) {
    if (!plan.id) plan.id = `${plan.origin === 'archiv' ? 'ar' : 'sl'}_${this.nextId++}_${Szenenbau.slug(g.id, 20)}`.slice(0, 40).replace(/_+$/, '');
    const marks = Number.isFinite(g.belohnung_marken) ? Math.max(0, Math.min(600, g.belohnung_marken)) : undefined;
    return Szenenbau.buildBook(g, answers, this.env2(), { id: plan.id, art: plan.origin === 'archiv' ? 'archiv' : 'generiert', kontext: plan.kontext,
      marks, erinnerungText: plan.erinnerungText });
  }
  adoptBook(plan, built, answers) {
    plan.book = built.book;
    plan.bookAnswers = answers || {};
    for (const s of plan.grobplan.szenen) {
      const info = built.szenen[s.id] || { quelle: 'rohfassung' };
      const prev = plan.szenen[s.id] || {};
      plan.szenen[s.id] = Object.assign({ state: 'rohfassung', quelle: 'rohfassung', antwort: null, key: null }, prev,
        { quelle: info.quelle, state: prev.state && prev.state !== 'rohfassung' ? prev.state : (info.quelle === 'rohfassung' ? 'rohfassung' : 'ready') });
      if (answers && answers[s.id] && info.quelle !== 'rohfassung') plan.szenen[s.id].antwort = answers[s.id].answer;
    }
  }

  // Rückfall: Archiv (ungespielt, nicht schon angeboten) -> Mock-Grobplan
  fallbackPlan(plan, reason) {
    this.stats.fallbacks++;
    plan.state = 'fallback';
    this.log({ art: 'rueckfall', plan: plan.key, begruendung: `Rückfall aufs Archiv: ${reason}` });
    if (this.planFromArchive(plan, reason)) return;
    if (this.planFromMock(plan, reason)) return;
    plan.state = 'failed';
    delete this.plans[plan.key];
    this.countError('fallback', new Error('Weder Archiv noch Mock lieferten ein gültiges Buch: ' + reason));
  }
  offeredArchivNames() { return this.plansBy((p) => p.archivName && ['offered', 'running'].includes(p.state)).map((p) => p.archivName); }
  planFromArchive(plan, reason) {
    const entries = this.archiv();
    if (!entries.length) return false;
    if (!plan.kontext) plan.kontext = this.kontext(Object.assign({ crew: this.crew() }, plan.anlass));
    for (let i = 0; i < entries.length; i++) {
      // eben abgelehnte Archiv-Missionen erst wieder, wenn sonst nichts passt (QA-INTEGRATION S2)
      const ausser = this.offeredArchivNames().concat(plan.triedArchiv);
      let e = Archiv.pick(entries, this.archivGespielt, plan.kontext, ausser.concat(this.declinedArchiv || []));
      if (!e) { e = Archiv.pick(entries, this.archivGespielt, plan.kontext, ausser); if (e) this.declinedArchiv = []; }   // alles andere gespielt/abgelehnt -> Liste leeren
      if (!e) return false;
      plan.triedArchiv.push(e.name);
      const er = Archiv.erinnerung(e, plan.kontext);
      const g = clone(e.grobplan);
      if (er.ref) g.erinnerung = er.ref; else delete g.erinnerung;
      g.erinnerung_text = er.text || g.erinnerung_text || null;
      const errs = Szenenbau.checkGrobplan(Object.assign({ erinnerung: er.text || '' }, g), this.env2());
      if (errs.length) { this.log({ art: 'archiv', begruendung: `Archiv '${e.name}' ungültig`, fehler: errs, quelle: 'archiv' }); continue; }
      plan.origin = 'archiv'; plan.archivName = e.name; plan.grobplan = g; plan.quelle = 'archiv'; plan.erinnerungText = g.erinnerung_text;
      plan.id = null;
      const answers = {};
      for (const [sid, a] of Object.entries(e.szenen || {})) answers[sid] = { answer: a, quelle: 'archiv' };
      const built = this.buildPlanBook(plan, g, answers);
      if (built.errors.length) {
        this.log({ art: 'archiv', mission: plan.id, quelle: 'archiv', begruendung: `Archiv '${e.name}' besteht den Prüfer nicht`, fehler: built.errors.map((x) => `${x.code} ${x.p}: ${x.msg}`) });
        plan.id = null; continue;
      }
      this.adoptBook(plan, built, answers);
      this.log({ art: 'grobplan', mission: plan.id, quelle: 'archiv', begruendung: `Archiv '${e.name}' (${reason})`, plan: plan.key });
      this.offer(plan);
      return true;
    }
    return false;
  }
  planFromMock(plan, reason) {
    try {
      if (!plan.kontext) plan.kontext = this.kontext(Object.assign({ crew: this.crew() }, plan.anlass));
      const g = LLM.mockGrobplan({ anlass: plan.anlass, kontext: plan.kontext }, this.katalog());
      g.id = `mock_${this.nextId}`;
      plan.origin = plan.slot === 'archiv' ? 'archiv' : 'sl'; plan.grobplan = g; plan.quelle = 'mock'; plan.erinnerungText = g.erinnerung_text || (typeof g.erinnerung === 'string' ? g.erinnerung : null);
      plan.id = null;
      const built = this.buildPlanBook(plan, g, {});
      if (built.errors.length) { this.countError('mock', new Error(built.errors.slice(0, 3).map((x) => `${x.code} ${x.p}: ${x.msg}`).join('; '))); return false; }
      this.adoptBook(plan, built, {});
      this.log({ art: 'grobplan', mission: plan.id, quelle: 'mock', begruendung: `Mock-Grobplan (${reason})`, plan: plan.key });
      this.offer(plan);
      return true;
    } catch (e) { this.countError('mock', e); return false; }
  }

  offer(plan) {
    plan.state = 'offered'; plan.offeredAt = this.time;
    this.lastSealAt = this.time;
    const r = this.callMission('registerBook', plan.book, { origin: plan.origin });
    if (r && r.ok === false) this.countError('registerBook', new Error(`${plan.id}: ${(r.errors || []).slice(0, 3).map((x) => x.code || x).join(', ') || r.error || 'abgelehnt'}`));
    this.ablageStore(plan, 'save');   // §8c: Buch registriert
    const info = Szenenbau.offerInfo(plan.book, plan.grobplan);
    // Ereignis offerIn sendet die Engine (registerBook, einmal je Angebot inkl. Ton)
    this.log({ art: 'angebot', mission: plan.id, quelle: plan.quelle, origin: plan.origin, titel: info.titel, auftraggeber: info.von, tokens: plan.tokens,
      begruendung: `Angebot „${info.titel}“ von ${info.von} (${plan.quelle})` });
  }

  // ---------- Angebote ----------
  offers() {
    return this.plansBy((p) => p.state === 'offered' && p.book).sort((a, b) => a.offeredAt - b.offeredAt).map((p) => {
      const i = Szenenbau.offerInfo(p.book, p.grobplan);
      return { id: p.id, titel: i.titel, von: i.von, ziel: i.ziel, dauer_min: i.dauer_min, belohnung: i.belohnung, erinnerung: i.erinnerung, origin: p.origin, state: 'angeboten' };
    });
  }
  accept(id) {
    try {
      const plan = this.planById(id);
      if (!plan || plan.state !== 'offered') return 'Dieses Angebot gibt es nicht (mehr).';
      const m = this.mission();
      if (m && m.activeId) return 'Erst die laufende Mission abschließen.';
      plan.state = 'running'; plan.acceptedAt = this.time;
      if (plan.archivName) { this.archivGespielt = this.archivGespielt.filter((n) => n !== plan.archivName).concat([plan.archivName]); this.declinedArchiv = this.declinedArchiv.filter((n) => n !== plan.archivName); }
      this.log({ art: 'annahme', mission: id, quelle: plan.quelle, origin: plan.origin, begruendung: 'Captain hat angenommen' });
      this.callMission('startMission', id);
      if (m && typeof m.startMission === 'function' && m.activeId !== id) {
        plan.state = 'offered';
        this.log({ art: 'annahme', mission: id, fehler: ['mission.startMission hat die Mission nicht gestartet'], begruendung: 'Start fehlgeschlagen' });
        return 'Die Mission ließ sich nicht starten.';
      }
      // Vorlauf: Szenen nach dem Hafen
      this.requestSuccessors(plan, plan.grobplan.szenen[0].id);
      return null;
    } catch (e) { this.countError('accept', e); return 'Annehmen fehlgeschlagen.'; }
  }
  decline(id) {
    try {
      const plan = this.planById(id);
      if (!plan || plan.state !== 'offered') return 'Dieses Angebot gibt es nicht (mehr).';
      plan.state = 'declined';
      this.callMission('unregisterBook', id);
      const npc = plan.book.kopf.auftraggeber;
      const ws = this.game && this.game.weltstand;
      if (ws && typeof ws.npcMemory === 'function') {
        try { ws.npcMemory(npc, { ereignis: 'angebot_abgelehnt', text: `Die Crew hat „${plan.book.kopf.titel}“ abgelehnt.`, gewicht: 0.5, mission: id }); } catch (e) { this.countError('decline', e); }
      }
      this.log({ art: 'ablehnung', mission: id, quelle: plan.quelle, origin: plan.origin, begruendung: 'Angebot abgelehnt (leichter Gedächtnis-Eintrag)' });
      delete this.plans[plan.key];
      if (plan.archivName) { this.declinedArchiv = (this.declinedArchiv || []).filter((n) => n !== plan.archivName); this.declinedArchiv.push(plan.archivName); }
      if (plan.slot === 'archiv') this.ensureArchivOffer({ art: 'abgelehnt', nach: id });
      else this.startRound({ art: 'abgelehnt', nach: id });
      return null;
    } catch (e) { this.countError('decline', e); return 'Ablehnen fehlgeschlagen.'; }
  }
  planning() {
    const act = this.plansBy((p) => p.slot === 'sl' && ['planning', 'checking', 'retry'].includes(p.state));
    if (act.length) {
      const stage = act.some((p) => p.state !== 'planning' || p.versuche > 0) ? 1 : 0;
      return { stage, von: (act[0].anlass && act[0].anlass.auftraggeber) || 'tesk' };
    }
    if (this.time - this.lastSealAt < 3) return { stage: 2, von: 'tesk' };
    return null;
  }

  // ---------- Szenen ----------
  sceneId(plan, sceneOrStep) {
    if (!plan || !plan.grobplan || typeof sceneOrStep !== 'string') return null;
    if (plan.grobplan.szenen.some((s) => s.id === sceneOrStep)) return sceneOrStep;
    return Szenenbau.sceneOfStep(plan.grobplan, sceneOrStep);
  }
  onSceneEnter(missionId, sceneOrStep) {
    try {
      const plan = this.planById(missionId);
      if (!plan) return;
      const sid = this.sceneId(plan, sceneOrStep);
      if (!sid) return;
      if (/_anflug$/.test(String(sceneOrStep))) { this.requestScene(plan, sid); return; }
      this.markEntered(plan, sid);
    } catch (e) { this.countError('onSceneEnter', e); }
  }
  markEntered(plan, sid) {
    if (plan.entered.has(sid)) return;
    plan.entered.add(sid);
    const sc = plan.szenen[sid];
    if (sc) {
      if (sc.state === 'requested') this.cancelScene(plan, sid);
      sc.state = 'active';
    }
    this.requestSuccessors(plan, sid);
  }
  requestSuccessors(plan, sid) {
    const s = plan.grobplan.szenen.find((x) => x.id === sid);
    for (const w of (s && s.weiter) || []) { const n = String(w.nach || ''); if (!n.startsWith('ausgang:')) this.requestScene(plan, n); }
  }
  requestScene(plan, sid) {
    const sc = plan.szenen[sid];
    if (!sc || sc.state !== 'rohfassung' || plan.entered.has(sid)) return;
    const s = plan.grobplan.szenen.find((x) => x.id === sid);
    if (!s || !(s.molekuele || []).length) return;
    if (plan.origin !== 'sl' || plan.quelle === 'mock' || !this.transportUsable()) return;   // Archiv/Mock: Szenen stehen fest
    sc.state = 'requested'; sc.requestedAt = this.time; sc.versuche = sc.versuche || 0;
    this.enqueue({ type: 'szene', plan, sid });
  }
  cancelScene(plan, sid) {
    this.queue = this.queue.filter((j) => !(j.type === 'szene' && j.plan === plan && j.sid === sid));
    if (this.job && this.job.type === 'szene' && this.job.plan === plan && this.job.sid === sid) this.job = null;   // Antwort wird verworfen
  }
  sceneInput(job) {
    const plan = job.plan; const g = plan.grobplan;
    const s = g.szenen.find((x) => x.id === job.sid);
    const env = this.env2(); const k = plan.kontext || {};
    const npc = (k.npc || []).map((n) => `- ${n.id} (${[n.titel, n.name].filter(Boolean).join(' ')}, Haltung ${n.haltung}): ${(n.gedaechtnis || []).map((x) => x.text).join(' | ')}`).join('\n');
    const umsetzungen = (s.molekuele || []).map((m) => {
      const mol = env.katalog.molekuele[m.id]; const u = mol && mol.umsetzungen.find((x) => x.id === m.umsetzung);
      if (!u) return `### ${m.id} / ${m.umsetzung} – unbekannt`;
      const L = [`### ${mol.id} / ${u.id} – ${u.name}`, u.beschreibung, 'Parameter (* = Pflicht):'];
      for (const [n, d] of Object.entries(u.params)) {
        let hint = '';
        if (d.typ === 'loc') hint = ` → Ort der Szene: ${s.ort}`;
        if (d.typ === 'map') hint = ` → Karte der Szene: ${s.karte || '–'}`;
        if (d.typ === 'npc') hint = ` → eine von: ${env.npc.join(', ')}`;
        if (d.typ === 'find') hint = ` → Funde an ${s.ort}: ${((k.orte || []).find((l) => l.id === s.ort) || { funde: [] }).funde.filter((f) => f.status !== 'gefunden').map((f) => f.id).join(', ') || '–'}`;
        L.push(`- ${n}${d.pflicht ? '*' : ''} (${d.typ}${d.werte ? ': ' + d.werte.join('|') : ''}${d.min != null ? `, ${d.min}–${d.max}` : ''}${d.default !== undefined ? ', Standard ' + JSON.stringify(d.default) : ''})${d.beschreibung ? ' – ' + d.beschreibung : ''}${hint}`);
      }
      if (Array.isArray(u.liefert_flags) && u.liefert_flags.length) L.push(`liefert Flags: ${u.liefert_flags.join(', ')} ({{id}} = ${(s.molekuele.length > 1 ? s.id + '_<n>' : s.id)})`);
      return L.join('\n');
    }).join('\n\n');
    const plan2 = Object.assign({}, g, { szenen: g.szenen.map((x) => ({ id: x.id, ort: x.ort, molekuele: (x.molekuele || []).map((m) => m.umsetzung), sachverhalt: x.sachverhalt, weiter: x.weiter })) });
    const prompt = LLM.buildPrompt({
      katalog: require('./katalog.js').fuerSpielleiter(this.katalog(), 'kurz'),
      grobplan: plan2,
      variabel: [['weltstand', `Crew: ${(k.crew && k.crew.anzahl) || this.crew()}. NSC:\n${npc}`], ['szene', s], ['umsetzungen', umsetzungen]],
      schluss: `Arbeite jetzt die Szene '${s.id}' aus. Nur das JSON-Objekt.`,
      vorher: job.retry || null,
    });
    return { prompt, system: LLM.systemPromptFile('szene'), art: 'szene', welt: this.weltId(), mission: plan.id, szene: s.id, versuch: (plan.szenen[s.id].versuche || 0) + 1, grobplan: g };
  }
  handleScene(plan, job, r, dauer, quelle) {
    const sid = job.sid; const sc = plan.szenen[sid];
    this.stats.szenen++;
    if (!sc || !this.plans[plan.key] || plan.entered.has(sid) || sc.state !== 'requested') {
      this.log({ art: 'szene', mission: plan.id, szene: sid, quelle, dauer_s: dauer, tokens: r.tokens || 0, begruendung: 'Szene schon betreten bzw. Mission vorbei – Antwort verworfen' });
      return;
    }
    sc.versuche = (sc.versuche || 0) + 1;
    let a = null; const errs = [];
    try { a = Szenenbau.parseJsonAnswer(r.text); } catch (e) { errs.push('kein gültiges JSON: ' + e.message); }
    let built = null; const answers = Object.assign({}, plan.bookAnswers);
    if (a) {
      answers[sid] = { answer: a, quelle };
      built = this.buildPlanBook(plan, plan.grobplan, answers);
      const info = built.szenen[sid] || {};
      if (info.quelle === 'rohfassung') errs.push(...(info.fehler || []).filter((x) => !/^Rohfassung:/.test(x)));
      if (built.errors.length) errs.push(...built.errors.map((x) => (typeof x === 'string' ? x : `${x.code} ${x.p}: ${x.msg}`)));
      if (info.quelle === 'rohfassung' && !errs.length) errs.push('Szene ließ sich nicht zusammensetzen');
    }
    this.log({ art: 'szene', mission: plan.id, szene: sid, quelle, dauer_s: dauer, tokens: r.tokens || 0, fehler: errs.slice(0, 20), versuch: sc.versuche,
      begruendung: errs.length ? `Szene ungültig (Versuch ${sc.versuche})` : 'Szene ausgearbeitet, Rohfassung ersetzt' });
    if (errs.length) {
      if (sc.versuche <= this.C.retries) { this.enqueue({ type: 'szene', plan, sid, retry: { antwort: String(r.text).slice(0, 8000), fehler: errs.slice(0, 20) } }); return; }
      this.sceneFailed(plan, sid, 'zweimal ungültig');
      return;
    }
    const res = this.callMission('updateBook', plan.id, built.book);
    if (res && res.ok === false) { this.sceneFailed(plan, sid, 'updateBook abgelehnt: ' + ((res.errors || []).slice(0, 2).map((x) => x.code || x).join(', ') || res.error || '')); return; }
    plan.book = built.book; plan.bookAnswers = answers;
    sc.state = 'ready'; sc.quelle = quelle; sc.antwort = a; sc.key = r.key || null;
    this.ablageStore(plan, 'update');   // §8c: Szene ersetzt
    this.resolveWait(plan, sid, 'ready');
  }
  sceneFailed(plan, sid, reason) {
    const sc = plan.szenen[sid];
    if (!sc) return;
    if (sc.state === 'requested') sc.state = 'failed';
    sc.quelle = 'rohfassung';
    this.log({ art: 'rueckfall', mission: plan.id, szene: sid, quelle: 'rohfassung', begruendung: `Szene bleibt Rohfassung: ${reason}` });
    this.resolveWait(plan, sid, 'failed');
  }
  sceneReady(missionId, szene) {
    try {
      const plan = this.planById(missionId);
      if (!plan) return true;
      const sid = this.sceneId(plan, szene);
      const sc = sid && plan.szenen[sid];
      if (!sc || sc.state !== 'requested') return true;
      const w = this.waits[`${missionId}:${sid}`];
      return !!(w && this.time - w.t0 >= this.C.sceneWaitMax);
    } catch (e) { this.countError('sceneReady', e); return true; }
  }
  sceneTimeout(missionId, szene) {
    try {
      const plan = this.planById(missionId);
      const sid = plan && this.sceneId(plan, szene);
      if (!sid) return;
      this.cancelScene(plan, sid);
      this.sceneFailed(plan, sid, `nicht fertig nach ${this.C.sceneWaitMax} s Wartezeit`);
    } catch (e) { this.countError('sceneTimeout', e); }
  }
  resolveWait(plan, sid, how) {
    const k = `${plan.id}:${sid}`; const w = this.waits[k];
    if (!w) return;
    delete this.waits[k];
    const sec = Math.round((this.time - w.t0) * 10) / 10;
    this.stats.waits.push(sec); this.stats.maxWait = Math.max(this.stats.maxWait, sec);
    this.log({ art: 'sceneWait', mission: plan.id, szene: sid, dauer_s: sec, quelle: how === 'ready' ? 'llm' : 'rohfassung', begruendung: `Anflug gehalten ${sec} s (${how})` });
  }
  // Anflug-Schritt am Ziel, Szene noch angefragt: höchstens sceneWaitMax s „Kurs wird berechnet …“, dann Rohfassung
  updateWaits() {
    const m = this.mission(); if (!m || !m.activeId || !m.step) return;
    const plan = this.planById(m.activeId); if (!plan || !plan.grobplan) return;
    const stepId = m.step.id;
    if (!/_anflug$/.test(stepId)) return;
    const sid = stepId.slice(0, -7);
    const s = plan.grobplan.szenen.find((x) => x.id === sid); const sc = plan.szenen[sid];
    if (!s || !sc) return;
    if (sc.state === 'rohfassung' && !plan.entered.has(sid)) this.requestScene(plan, sid);
    if (sc.state !== 'requested') return;
    const ship = this.game.ship;
    if (!ship || ship.scene !== s.ort) return;
    const k = `${plan.id}:${sid}`;
    let w = this.waits[k];
    if (!w) {
      w = this.waits[k] = { t0: this.time };
      this.emit('sceneWait', { sec: this.C.sceneWaitMax });
      try { if (typeof this.game.oda === 'function') this.game.oda(WAIT_ODA, null); } catch (e) { this.countError('oda', e); }
    }
    if (this.time - w.t0 >= this.C.sceneWaitMax) this.sceneTimeout(plan.id, sid);
  }
  // Schrittwechsel beobachten: betretene Szenen markieren (auch ohne onSceneEnter der Engine)
  pollStep() {
    const m = this.mission(); if (!m) return;
    const key = m.activeId && m.step ? `${m.activeId}:${m.step.id}` : null;
    if (key === this.lastStep) return;
    this.lastStep = key;
    if (!key) return;
    const plan = this.planById(m.activeId); if (!plan || !plan.grobplan) return;
    if (plan.state === 'offered') plan.state = 'running';
    const stepId = m.step.id;
    const sid = this.sceneId(plan, stepId);
    if (!sid) return;
    if (/_anflug$/.test(stepId)) { this.requestScene(plan, sid); return; }
    this.markEntered(plan, sid);
  }

  // ---------- Tick ----------
  update(dt) {
    try {
      this.pollStep();
      this.drainInbox();
      this.checkJobTimeout();
      if (this.pendingStartAt != null && this.time >= this.pendingStartAt) { this.pendingStartAt = null; this.startRound({ art: 'kampagnenstart', tutorial: false }); }
      // Sicherheitsnetz: nach dem Tutorial immer mindestens ein Angebot, solange keine Mission läuft
      const m = this.mission();
      if (m && !m.activeId && this.pendingStartAt == null && this.time >= this.safetyAt && !this.plansBy((p) => ['planning', 'checking', 'retry', 'offered', 'fallback'].includes(p.state)).length
        && (this.zusammenfassung.length || this.tutorialDone())) { this.safetyAt = this.time + 10; this.startRound({ art: 'nachschub' }); }
      while (!this.job && this.queue.length && this.time >= this.pauseUntil && this.inflight < this.C.maxConcurrent) this.startJob(this.nextJob());
      this.updateWaits();
    } catch (e) { this.countError('update', e); }
  }

  // ---------- Weltstand ----------
  toSave() {
    const plaene = {};
    for (const p of Object.values(this.plans)) {
      if (!['offered', 'running'].includes(p.state) || !p.book || !p.id) continue;
      const szenen = {};
      for (const [sid, sc] of Object.entries(p.szenen)) {
        const e = { quelle: sc.quelle || 'rohfassung' };
        if (sc.antwort && sc.quelle !== 'rohfassung') e.antwort = clone(sc.antwort);
        if (sc.key) e.key = sc.key;
        szenen[sid] = e;
      }
      plaene[p.id] = { grobplan: clone(p.grobplan), anlass: Object.assign({}, p.anlass, { slot: p.slot, archiv: p.archivName || undefined, quelle: p.quelle, erinnerung_text: p.erinnerungText || undefined }),
        origin: p.origin, szenen, buch: clone(p.book) };
    }
    return { plaene, archiv_gespielt: this.archivGespielt.slice(), archiv_abgelehnt: this.declinedArchiv.slice(), zusammenfassung: this.zusammenfassung.map((x) => Object.assign({}, x)), naechste_id: this.nextId };
  }
  restore(obj) {
    try {
      if (!isObj(obj)) return false;
      if (Array.isArray(obj.archiv_gespielt)) this.archivGespielt = obj.archiv_gespielt.map(String);
      if (Array.isArray(obj.archiv_abgelehnt)) this.declinedArchiv = obj.archiv_abgelehnt.map(String);
      if (Array.isArray(obj.zusammenfassung)) this.zusammenfassung = obj.zusammenfassung.filter(isObj).map((x) => Object.assign({}, x));
      if (Number.isFinite(obj.naechste_id)) this.nextId = Math.max(this.nextId, obj.naechste_id);
      for (const [id, x] of Object.entries(isObj(obj.plaene) ? obj.plaene : {})) {
        if (!isObj(x) || !isObj(x.buch) || !isObj(x.grobplan) || !Array.isArray(x.grobplan.szenen)) { this.countError('restore', new Error('Plan ' + id + ' unvollständig')); continue; }
        const an = isObj(x.anlass) ? Object.assign({}, x.anlass) : {};
        const plan = this.newPlan(an.slot === 'archiv' ? 'archiv' : 'sl', an);
        plan.id = id; plan.origin = x.origin === 'archiv' ? 'archiv' : 'sl'; plan.grobplan = clone(x.grobplan); plan.book = clone(x.buch);
        plan.quelle = an.quelle || (plan.origin === 'archiv' ? 'archiv' : 'llm'); plan.archivName = an.archiv || null; plan.erinnerungText = an.erinnerung_text || null;
        plan.restored = true; plan.offeredAt = this.time; plan.state = 'offered';
        for (const s of plan.grobplan.szenen) {
          const sv = isObj(x.szenen) && isObj(x.szenen[s.id]) ? x.szenen[s.id] : {};
          const has = sv.antwort && sv.quelle !== 'rohfassung';
          plan.szenen[s.id] = { state: has ? 'ready' : 'rohfassung', quelle: has ? sv.quelle : 'rohfassung', antwort: has ? clone(sv.antwort) : null, key: sv.key || null };
          if (has) plan.bookAnswers[s.id] = { answer: clone(sv.antwort), quelle: sv.quelle };
        }
        const r = this.callMission('registerBook', plan.book, { origin: plan.origin, restore: true });
        if (r && r.ok === false) this.countError('restore', new Error(`${id}: registerBook abgelehnt`));
      }
      this.log({ art: 'laden', begruendung: `Spielleiter geladen: ${Object.keys(isObj(obj.plaene) ? obj.plaene : {}).length} Pläne, ${this.zusammenfassung.length} erledigt` });
      return true;
    } catch (e) { this.countError('restore', e); return false; }
  }

  // ---------- Debug ----------
  status() {
    const b = LLM.budget();
    const L = [`Spielleiter: Modus ${this.mode}${this.transportOff ? ' (aus: ' + this.transportOff + ')' : ''}, Tokens ${b.used}/${b.limit}, Job ${this.job ? this.job.type + (this.job.sid ? ':' + this.job.sid : '') : '–'}, Warteschlange ${this.queue.length}`];
    for (const p of Object.values(this.plans)) L.push(`${p.id || p.key} [${p.origin}/${p.quelle || '–'}] ${p.state}${p.grobplan ? ' „' + p.grobplan.titel + '“' : ''} – ${Object.entries(p.szenen).map(([s, x]) => `${s}:${x.state}`).join(' ')}`);
    L.push(`Archiv gespielt: ${this.archivGespielt.join(', ') || '–'}; erledigt: ${this.zusammenfassung.length}; längste Wartezeit ${this.stats.maxWait} s`);
    return L.join('\n');
  }
  debug(args, player) {
    try {
      const a = (Array.isArray(args) ? args : String(args || '').split(/\s+/)).filter(Boolean);
      if (a[0] === 'sl') a.shift();
      const say = (t) => { try { if (player && this.game && typeof this.game.notice === 'function') this.game.notice(player, t); else if (this.game && this.game.log) this.game.log(t); } catch (e) { this.countError('debug', e); } };
      switch (a[0]) {
        case 'status': case undefined: say(this.status()); return null;
        case 'plan': this.startRound({ art: 'debug' }, { force: true }); say('Spielleiter: neuer Grobplan angefragt.'); return null;
        case 'fail':
          if (a[1] !== 'grobplan' && a[1] !== 'szene') return 'sl fail grobplan|szene';
          this.failNext[a[1]] = true; say(`Spielleiter: nächster ${a[1]}-Aufruf schlägt fehl.`); return null;
        case 'archiv': {
          const plan = this.newPlan('archiv', { art: 'debug' });
          if (!this.planFromArchive(plan, 'Debug')) { delete this.plans[plan.key]; return 'Kein (weiteres) Archiv-Angebot verfügbar.'; }
          say(`Spielleiter: Archiv-Angebot ${plan.id}.`); return null;
        }
        default: return 'sl status | sl plan | sl fail grobplan|szene | sl archiv';
      }
    } catch (e) { this.countError('debug', e); return 'Debug fehlgeschlagen: ' + e.message; }
  }
}

// Beim Ende der Partie: laufende Antworten verwerfen, nichts mehr starten (der CLI-Prozess endet über sein Timeout)
Spielleiter.prototype.dispose = function dispose() {
  this.disposed = true;
  this.queue = []; this.job = null; this.inbox = []; this.pendingStartAt = null;
  this.update = () => {};
};

function create(game, opts) { return new Spielleiter(game, opts); }

module.exports = { create, Spielleiter, DEFAULTS, llmModeFromEnv, TEASER_TEXT, WAIT_ODA, katalog };
