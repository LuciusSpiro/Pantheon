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

// ---------- Szenen-Prompt (CONTRACT-S2B §4.2): kein Katalog, nur Auszug der Umsetzung(en) + Grobplan-Kurzform + Kontextauszug ----------
function umsetzungAuszug(env, kontext, s, cast, buehne) {
  const k = kontext || {};
  const stimmen = [...cast.named].join(', ');
  return (s.molekuele || []).map((m) => {
    const mol = env.katalog.molekuele[m.id]; const u = mol && mol.umsetzungen.find((x) => x.id === m.umsetzung);
    if (!u) return `### ${m.id} / ${m.umsetzung} – unbekannt`;
    const L = [`### ${mol.id} / ${u.id} – ${u.name}`, u.beschreibung, 'Parameter (* = Pflicht):'];
    for (const [n, d] of Object.entries(u.params)) {
      let hint = '';
      if (d.typ === 'loc') hint = ` → ${s.ort}`;
      if (d.typ === 'map' || d.typ === 'landepunkt') hint = ` → ${Szenenbau.sceneMap(s) || '–'} (setzt das Spiel)`;
      if (['fraktion', 'staerke', 'haltung'].includes(n) && buehne && buehne.besetzung) hint = ` → ${buehne.besetzung[n]} (setzt das Spiel)`;
      if (d.typ === 'npc') hint = ` → ${s.stimme ? `Stimme der Szene: ${s.stimme}` : `Besetzung: ${stimmen}`}${n === 'npc' && !s.stimme ? ' (Gegner/Gegenüber: neu:Name, nie der Auftraggeber)' : ''}`;
      if (d.typ === 'find') hint = ` → Funde an ${s.ort}: ${((k.orte || []).find((l) => l.id === s.ort) || { funde: [] }).funde.filter((f) => f.status !== 'gefunden').map((f) => f.id).join(', ') || '–'}`;
      if (['name', 'fund_name', 'objekt_name', 'was'].includes(n) && s.ziel_name) hint = ` → „${s.ziel_name}“`;
      L.push(`- ${n}${d.pflicht ? '*' : ''} (${d.typ}${d.werte ? ': ' + d.werte.join('|') : ''}${d.min != null ? `, ${d.min}–${d.max}` : ''}${d.default !== undefined && d.typ !== 'aktionen' ? ', Standard ' + JSON.stringify(d.default) : ''})${d.beschreibung ? ' – ' + d.beschreibung : ''}${hint}`);
    }
    if (Array.isArray(u.liefert_flags) && u.liefert_flags.length) L.push(`liefert Flags: ${u.liefert_flags.join(', ')} ({{id}} = ${(s.molekuele.length > 1 ? s.id + '_<n>' : s.id)})`);
    return L.join('\n');
  }).join('\n\n');
}
function szenenBuehne(env, k, s) {
  const id = Szenenbau.sceneMap(s);
  if (!id) return null;
  const lp = ((k.orte || []).find((o) => o.id === s.ort) || { landepunkte: [] }).landepunkte || [];
  const d = lp.find((x) => x.id === id) || null;
  let besetzung = null;
  try { besetzung = Szenenbau.sceneBesetzung(s, env, env.lp ? env.lp() : null); } catch (e) { besetzung = null; }
  const teile = [`${id}${d ? ` – ${d.name || ''} (${[d.art, d.bauweise, d.besitz, d.zustand].filter(Boolean).join(', ')})` : ''}`];
  if (d && d.besucht) teile.push(`${d.besucht}× besucht`);
  if (d && d.alarm) teile.push('in Alarm');
  if (besetzung) teile.push(`Besetzung ${besetzung.fraktion}, ${besetzung.staerke}, ${besetzung.haltung}${besetzung.neue_rolle ? ', neu: ' + besetzung.neue_rolle : ''}`);
  return { id, text: teile.join('; '), besetzung };
}
function grobplanKurz(g, sid, cast) {
  const s = g.szenen.find((x) => x.id === sid) || {};
  const nah = new Set((s.weiter || []).map((w) => w.nach));
  return {
    titel: g.titel, auftraggeber: g.auftraggeber, besetzung: [...cast.named, ...[...cast.neu].map((n) => 'neu:' + n)],
    belohnung_marken: Number.isFinite(g.belohnung_marken) ? g.belohnung_marken : undefined, aufhaenger: g.aufhaenger,
    szenen: g.szenen.map((x) => {
      const e = { id: x.id, ort: x.ort, umsetzungen: (x.molekuele || []).map((m) => `${m.id}/${m.umsetzung}`) };
      if (x.stimme) e.stimme = x.stimme;
      if (nah.has(x.id)) e.sachverhalt = x.sachverhalt;
      e.weiter = [...new Set((x.weiter || []).map((w) => w.nach))];
      return e;
    }),
    ausgaenge: Object.fromEntries(Object.entries(g.ausgaenge || {}).map(([k, a]) => [k, (a && a.wann) || ''])),
  };
}
function scenePrompt(g, sid, env, kontext, opts) {
  const o = opts || {}; const k = kontext || {};
  const s = g.szenen.find((x) => x.id === sid);
  if (!s) throw new Error(`Szene '${sid}' fehlt im Grobplan`);
  const cast = Szenenbau.missionCast(g, env);
  const npc = (k.npc || []).filter((n) => cast.named.has(n.id))
    .map((n) => `- ${n.id} (${[n.titel, n.name].filter(Boolean).join(' ')}, Haltung ${n.haltung}): ${(n.gedaechtnis || []).slice(-3).map((x) => x.text).join(' | ') || '–'}`).join('\n');
  const fakten = Object.entries(k.fakten || {}).map(([a, b]) => `${a} = ${typeof b === 'string' ? b : JSON.stringify(b)}`).join('; ') || '–';
  const szene = Object.assign({}, s, { weiter: s.weiter });
  const ent = (g.entscheidungen || []).filter((e) => e.szene === sid);
  if (ent.length) szene.entscheidungen = ent;
  // B1: Bühne der Szene (Landepunkt aus dem Kontext, Besetzung aus dem Grobplan bzw. Besitz) – kurz, ohne Karte
  const buehne = szenenBuehne(env, k, s);
  const welt = `Crew: ${(k.crew && k.crew.anzahl) || o.crew || 3}. Fakten: ${fakten}\nNSC der Besetzung:\n${npc || '–'}${buehne ? `\nBühne: ${buehne.text}` : ''}`;
  return LLM.buildPrompt({
    grobplan: grobplanKurz(g, sid, cast),
    variabel: [['weltstand', welt], ['szene', szene], ['umsetzungen', umsetzungAuszug(env, k, s, cast, buehne)]],
    schluss: `Arbeite jetzt die Szene '${s.id}' aus. Nur das JSON-Objekt.`,
    vorher: o.retry || null,
  });
}

// ---------- B1: Bodenbilanz im Grobplan-Prompt (GD §5) ----------
// „Bodenbilanz (gespielt): vorletzte „…“: kein Boden · letzte „…“: Boden → PFLICHT: …“
function bodenbilanzText(bil) {
  if (!bil || typeof bil !== 'object') return '';
  const l = Array.isArray(bil.letzte) ? bil.letzte : [];
  const namen = ['drittletzte', 'vorletzte', 'letzte'];
  const teile = l.slice(-3).map((x, i, a) => `${namen[3 - a.length + i] || 'früher'} „${x.titel}“: ${x.boden === true ? 'Boden' : x.boden === false ? 'kein Boden' : '–'}${x.lang ? ' (lang)' : ''}${(x.landepunkte || []).length ? ' @ ' + x.landepunkte.join(', ') : ''}`);
  const head = `Bodenbilanz (gespielt): ${teile.join(' · ') || 'noch keine Mission gespielt'}.`;
  return bil.pflicht_jetzt
    ? `${head}\n→ PFLICHT: Diese Mission braucht eine Bodenszene (Quote), oder begründe in ohne_boden_grund, warum nicht.`
    : `${head} Mindestens jede zweite Mission und jede lange (ab ${bil.lang_ab_min || 25} min) hat eine Bodenszene.`;
}

// F14: Warnungen fürs Regielog – wichtige Codes vollständig und zuerst, der Rest je Code gezählt
const WARN_WICHTIG = ['KARTE-WIEDERHOLT', 'BODEN-QUOTE', 'BODEN-LANG', 'LANG-RUNDE', 'DAUER-ABWEICHUNG', 'BESITZ-REGION'];
function warnCode(w) { const m = /^([A-Z][A-Z0-9-]+):/.exec(String(w)); return m ? m[1] : (/^repariert:/.test(w) ? 'repariert' : 'sonstige'); }
function warnungenKurz(warns) {
  const wichtig = []; const rest = {};
  for (const w of warns || []) { const c = warnCode(w); if (WARN_WICHTIG.includes(c)) wichtig.push(w); else rest[c] = (rest[c] || 0) + 1; }
  wichtig.sort((a, b) => WARN_WICHTIG.indexOf(warnCode(a)) - WARN_WICHTIG.indexOf(warnCode(b)));
  const r = Object.entries(rest).map(([c, n]) => `${c} ×${n}`);
  return wichtig.concat(r.length ? [r.join(', ')] : []).join(' | ');
}
// F3 (d): Prüferfehler für den Neuversuch – ohne Dubletten, höchstens 12, je höchstens 400 Zeichen (Hinweise auf passende
// Landepunkte bleiben dran)
function fehlerKurz(errs) {
  const out = [];
  for (const e of errs || []) { const t = String(e).replace(/\s+/g, ' ').trim(); if (t && !out.includes(t)) out.push(t.length > 400 ? t.slice(0, 399) + '…' : t); }
  return out.length > 12 ? out.slice(0, 12).concat([`… und ${out.length - 12} weitere`]) : out;
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
  env2() {
    if (!this.envCache) {
      this.envCache = Szenenbau.buildEnv(this.katalog());
      this.envCache.lp = () => this.lp();   // B1: Landepunkte dieses Spiels (auch neu angelegte)
    }
    return this.envCache;
  }
  // B1: Landepunkt-Adapter auf server/sim/landepunkte.js für dieses Spiel (opts.lp in Tests)
  lp() {
    if (this.opts.lp !== undefined) return this.opts.lp;
    if (this.lpCache === undefined) { try { this.lpCache = Context.lpAdapter(this.game); } catch (e) { this.countError('landepunkte', e); this.lpCache = null; } }
    return this.lpCache;
  }
  bodenC() { return Object.assign(Context.bodenConfig(), this.C.boden || {}); }
  // Lange Mission schon im Angebot dieser Runde? -> Titel | null (E4: eine lange je Angebotsrunde)
  langImAngebot(ausser) {
    const p = this.plansBy((x) => x !== ausser && x.grobplan && ['offered', 'checking'].includes(x.state)).find((x) => this.planBoden(x).lang);
    return p ? (p.grobplan.titel || p.id) : null;
  }
  planBoden(plan) {
    if (!plan || !plan.grobplan) return { boden: false, lang: false, landepunkte: [], dauer_ziel_min: null };
    if (!plan.bodenInfo) { try { plan.bodenInfo = Szenenbau.bodenInfo(plan.grobplan, this.env2(), this.bodenC()); } catch (e) { this.countError('boden', e); plan.bodenInfo = { boden: false, lang: false, landepunkte: [], dauer_ziel_min: null }; } }
    return plan.bodenInfo;
  }
  // Szenenauflösung (B1 §11.2): Landepunkte wählen und gegen die gebaute Karte prüfen; neue Landepunkte erst anlegen,
  // wenn der Plan gültig ist (commit). -> { errors, warnings, neu }
  aufloesen(plan, g) {
    try { return Szenenbau.aufloesen(g, this.env2(), plan.kontext || {}, { lp: this.lp() }); } catch (e) { this.countError('aufloesen', e); return { errors: ['Szenenauflösung fehlgeschlagen: ' + e.message], warnings: [], neu: [] }; }
  }
  neueLandepunkteAnlegen(g, neu) {
    const lp = this.lp();
    for (const n of neu || []) {
      try {
        const id = lp.anlegen(n.ort, { art: n.art, besitz: n.besitz, seed: n.seed });
        const s = g.szenen.find((x) => x.id === n.sid);
        if (s) s.landepunkt = id;
        for (const x of g.szenen) if (x.buehne && x.buehne.neu && x.landepunkt === n.id) x.landepunkt = id;   // zweite Szene am selben neuen Landepunkt
        this.log({ art: 'landepunkt', begruendung: `Neuer Landepunkt ${id} (${n.art}${n.besitz ? '/' + n.besitz : ''}, Seed ${n.seed}) für Szene '${n.sid}'` });
      } catch (e) { this.countError('landepunkt-neu', e); }
    }
  }
  // B1 (OFFEN-STUDIO): Landepunkte der angenommenen Mission vorbauen (Karten-Cache), nie im Tick: setImmediate; der Bau selbst
  // läuft in landepunkte.vorbauen je Landepunkt in einem eigenen setImmediate. ENGINE baut bei der Ankunft die freien
  // Landepunkte des Orts (vorbauenOrt); hier kommen die Szenen-Landepunkte dazu (auch neu angelegte, auch an späteren Orten).
  vorbauen(plan) {
    const ids = [...new Set(((plan && plan.grobplan && plan.grobplan.szenen) || []).map(Szenenbau.sceneMap).filter(Boolean))];
    const lp = this.lp();
    if (!ids.length || !lp || typeof lp.vorbauen !== 'function') return 0;
    setImmediate(() => { try { lp.vorbauen(ids); } catch (e) { this.countError('landepunkte-vorbau', e); } });
    return ids.length;
  }
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
        // B1 §8: boden, lang, landepunkte, dauer_ziel_min (Bodenbilanz der gespielten Missionen)
        const bi = this.planBoden(plan);
        this.zusammenfassung.push({ id, titel: plan.book ? plan.book.kopf.titel : id, auftraggeber: plan.book ? plan.book.kopf.auftraggeber : null, ausgang: ausgang || null,
          boden: !!bi.boden, lang: !!bi.lang, landepunkte: (bi.landepunkte || []).slice(), dauer_ziel_min: bi.dauer_ziel_min != null ? bi.dauer_ziel_min : null });
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
    // Szenen vor Grobplänen; unter den Szenen die früheste im Grobplan zuerst (auch Nachbesserungen), laufende Mission zuerst
    let i = -1; let best = Infinity;
    this.queue.forEach((j, k) => {
      if (j.type !== 'szene') return;
      const idx = j.plan && j.plan.grobplan ? j.plan.grobplan.szenen.findIndex((x) => x.id === j.sid) : 99;
      const score = (j.plan && j.plan.state === 'running' ? 0 : 1000) + (idx < 0 ? 99 : idx);
      if (score < best) { best = score; i = k; }
    });
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
    // B1-FIX (F3): Landepunkte, Pflichtsätze und Spielstand-Flags stehen nicht mehr im Weltstand-Block – was der Prompt
    // dazu wissen muss, steht vorab berechnet unter <vorgaben> (kürzer und eindeutig)
    const kurz = Object.assign({}, k); delete kurz.verfuegbar; delete kurz.flags;
    if (Array.isArray(k.orte)) kurz.orte = k.orte.map((o) => { const x = Object.assign({}, o); delete x.landepunkte; return x; });
    if (Array.isArray(k.kartenarten)) kurz.kartenarten = k.kartenarten.map((a) => ({ id: a.id, kurz: a.kurz }));
    // E4: eine lange Mission je Angebotsrunde – die erste Spielleiter-Planung ohne lange Mission im Angebot plant lang
    if (plan.langErwuenscht === undefined) {
      plan.langErwuenscht = !this.langImAngebot(plan) && !this.plansBy((p) => p !== plan && p.slot === 'sl' && p.langErwuenscht && ['planning', 'checking', 'retry'].includes(p.state)).length;
    }
    const BC = this.bodenC();
    const dauer = this.planDauerVorgabe(plan);
    const ziel = plan.langErwuenscht
      ? `Ziel: eine **lange** Mission (${dauer.min}–${dauer.max} min), 5–6 Szenen, 1–2 Entscheidungen, mit Bodenszene (empfohlen zwei am selben Landepunkt: hinein/Ziel, dann Rückzug).`
      : `Ziel: etwa ${dauer.soll} min (unter ${BC.langAbMin} min), 4–6 Szenen, 1–2 Entscheidungen.${this.langImAngebot(plan) ? ` Eine lange Mission ist schon im Angebot („${this.langImAngebot(plan)}“).` : ''}`;
    let vorgaben = '';
    try { vorgaben = Szenenbau.grobplanVorgaben(this.env2(), k, { lp: this.lp(), dauer, szenen: plan.langErwuenscht ? [5, 6] : [4, 6] }); } catch (e) { this.countError('vorgaben', e); }
    const auftrag = [`Plane die nächste Mission für eine Crew von ${(k.crew && k.crew.anzahl) || this.crew()}.`,
      ziel, bodenbilanzText(k.bodenbilanz),
      plan.anlass && plan.anlass.nach ? `Anlass: Mission '${plan.anlass.nach}' ist gerade abgeschlossen (Ausgang ${plan.anlass.ausgang || '–'}).` : 'Anlass: Kampagnenstart.',
      `Schon im Angebot (bitte etwas anderes): ${this.offers().map((x) => `${x.titel} (${x.von})`).join('; ') || '–'}.`,
      plan.anlass && typeof plan.anlass.auftrag === 'string' ? `Vorgabe der Regie: ${plan.anlass.auftrag}` : '',
      plan.anlass && plan.anlass.auftraggeber ? `Auftraggeber: ${plan.anlass.auftraggeber}.` : ''].filter(Boolean).join('\n');
    const prompt = LLM.buildPrompt({
      katalog: require('./katalog.js').fuerSpielleiter(this.katalog(), 'kurz'),   // B1 §11.1: Bühnenbedarf steht je Umsetzung als Zeile „Bühne:“
      variabel: [['weltstand', JSON.stringify(kurz)], ...(vorgaben ? [['vorgaben', vorgaben]] : []), ['auftrag', auftrag]],
      schluss: 'Gib jetzt den Grobplan aus. Nur das JSON-Objekt.',
      vorher: job.retry || null,
    });
    // anlass/kontext stehen zusätzlich als Objekt im input (mock/script bauen daraus ihre Antwort; live sendet nur 'prompt')
    return { prompt, system: LLM.systemPromptFile('grobplan'), art: 'grobplan', welt: this.weltId(), plan: plan.key, versuch: plan.versuche + 1, anlass: plan.anlass, kontext: k };
  }
  // B1-FIX (F3): Zieldauer als hartes Feld – normal targetMinutes (±25 %), lang langAbMin–langMaxMin
  planDauerVorgabe(plan) {
    const BC = this.bodenC();
    if (plan && plan.langErwuenscht) return { soll: Math.round((BC.langAbMin + BC.langMaxMin) / 2), min: BC.langAbMin, max: BC.langMaxMin };
    const soll = this.C.targetMinutes;
    return { soll, min: Math.max(this.C.minPlanMinutes, Math.ceil(soll * 0.75)), max: Math.min(BC.langAbMin - 1, Math.floor(soll * 1.25)) };
  }
  handleGrobplan(plan, job, r, dauer, quelle) {
    plan.versuche++;
    this.stats.grobplaene++;
    let g = null; const errs = []; let warns = [];
    try { g = Szenenbau.parseJsonAnswer(r.text); } catch (e) { errs.push('kein gültiges JSON: ' + e.message); }
    let built = null; let repairs = [];
    if (g) {
      repairs = Szenenbau.normalizeGrobplan(g);   // S2b §4.5: Belohnung nur als belohnung_marken, doppelte weiter
      // B1-FIX (F3): eindeutige Fehler im Code reparieren statt Neuversuch (Umlaut-Kennungen, leere Dublette/Anflug-Szene,
      // Folgen für neue NSC, Zieldauer = Summe der Szenen)
      try { repairs.push(...Szenenbau.repairGrobplan(g, this.env2(), { minMinutes: this.C.minPlanMinutes, maxMinutes: this.bodenC().langMaxMin })); } catch (e) { this.countError('reparatur', e); }
      // B1 §11.2: Szenenauflösung vor der Prüfung (setzt s.landepunkt; die Altprüfung kennt dann die Karte)
      const auf = Array.isArray(g.szenen) ? this.aufloesen(plan, g) : { errors: [], warnings: [], neu: [] };
      errs.push(...Szenenbau.checkGrobplan(g, this.env2()));
      const s2 = Szenenbau.checkGrobplanS2(g, this.env2(), plan.kontext, { origin: 'sl', minMinutes: this.C.minPlanMinutes, maxThreads: this.C.maxOpenThreads, crew: this.crew() });
      const b1 = Szenenbau.checkGrobplanB1(g, this.env2(), plan.kontext, { boden: this.bodenC(), langImAngebot: this.langImAngebot(plan) });
      errs.push(...auf.errors, ...s2.errors, ...b1.errors); warns = auf.warnings.concat(s2.warnings, b1.warnings, repairs.map((x) => 'repariert: ' + x));
      if (!errs.length) {
        plan.state = 'checking';
        this.neueLandepunkteAnlegen(g, auf.neu);
        plan.bodenInfo = null;
        built = this.buildPlanBook(plan, g, {});
        if (built.errors.length) errs.push(...new Set(Szenenbau.explainBookErrors(g, built.errors, this.env2())));
      }
    }
    plan.warnungen = warns;
    // F14: wichtige Warnungen (KARTE-WIEDERHOLT, Boden, Dauer) zuerst und ganz, Besetzungs-Hinweise gezählt – die Begründung
    // im Regielog ist auf 500 Zeichen gekürzt, KARTE-WIEDERHOLT ging dort hinter den BESETZUNG-Warnungen verloren
    this.log({ art: 'grobplan', mission: built && !errs.length ? built.book.id : null, quelle, dauer_s: dauer, tokens: r.tokens || 0, fehler: errs.slice(0, 20),
      begruendung: errs.length ? `Grobplan ungültig (Versuch ${plan.versuche})${repairs.length ? ` – ${repairs.length} repariert` : ''}` : `Grobplan „${g.titel}“ gültig${warns.length ? ' – ' + warnungenKurz(warns) : ''}`,
      reparaturen: repairs, versuch: plan.versuche, plan: plan.key, budget: LLM.budget().used });
    if (g && Array.isArray(g.wuensche) && this.regie) for (const w of g.wuensche.slice(0, 5)) this.regie.wish(w, { mission: built && built.book ? built.book.id : plan.key, quelle });
    if (errs.length) {
      plan.fehler = errs;
      if (plan.versuche <= this.C.retries) {
        plan.state = 'retry';
        // B1-FIX (F3 d): beim Neuversuch nur die Prüferfehler, knapp und ohne Dubletten
        this.enqueue({ type: 'grobplan', plan, retry: { antwort: String(r.text).slice(0, 12000), fehler: fehlerKurz(errs) } });
        return;
      }
      this.fallbackPlan(plan, `Grobplan ${plan.versuche}× ungültig`);
      return;
    }
    plan.grobplan = g; plan.quelle = quelle; plan.bodenInfo = null;
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
      // B1 §11.2: Quote fällig -> Bodenmission bevorzugt; lange Mission nur, wenn keine andere lange im Angebot ist
      const vorzug = { boden: !!(plan.kontext && plan.kontext.bodenbilanz && plan.kontext.bodenbilanz.pflicht_jetzt), ohneLang: !!this.langImAngebot(plan),
        info: (x) => Szenenbau.bodenInfo(x.grobplan, this.env2(), this.bodenC()) };
      let e = Archiv.pick(entries, this.archivGespielt, plan.kontext, ausser.concat(this.declinedArchiv || []), vorzug);
      if (!e) { e = Archiv.pick(entries, this.archivGespielt, plan.kontext, ausser, vorzug); if (e) this.declinedArchiv = []; }   // alles andere gespielt/abgelehnt -> Liste leeren
      if (!e) return false;
      plan.triedArchiv.push(e.name);
      const er = Archiv.erinnerung(e, plan.kontext);
      const g = clone(e.grobplan);
      if (er.ref) g.erinnerung = er.ref; else delete g.erinnerung;
      g.erinnerung_text = er.text || g.erinnerung_text || null;
      const auf = this.aufloesen(plan, g);
      if (auf.errors.length) { this.log({ art: 'archiv', begruendung: `Archiv '${e.name}': Bühne nicht auflösbar`, fehler: auf.errors, quelle: 'archiv' }); continue; }
      const errs = Szenenbau.checkGrobplan(Object.assign({ erinnerung: er.text || '' }, g), this.env2());
      if (errs.length) { this.log({ art: 'archiv', begruendung: `Archiv '${e.name}' ungültig`, fehler: errs, quelle: 'archiv' }); continue; }
      this.neueLandepunkteAnlegen(g, auf.neu);
      plan.origin = 'archiv'; plan.archivName = e.name; plan.grobplan = g; plan.quelle = 'archiv'; plan.erinnerungText = g.erinnerung_text; plan.bodenInfo = null;
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
      const auf = this.aufloesen(plan, g);
      if (auf.errors.length) { this.countError('mock', new Error('Bühne: ' + auf.errors.slice(0, 2).join('; '))); return false; }
      this.neueLandepunkteAnlegen(g, auf.neu);
      plan.origin = plan.slot === 'archiv' ? 'archiv' : 'sl'; plan.grobplan = g; plan.quelle = 'mock'; plan.erinnerungText = g.erinnerung_text || (typeof g.erinnerung === 'string' ? g.erinnerung : null);
      plan.id = null; plan.bodenInfo = null;
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
      // Vorlauf (S2b §4.4): alle Szenen bis einschließlich der zweiten nach dem Hafen, dazu Szenen am selben Ort ohne Anflug
      this.requestAhead(plan, plan.grobplan.szenen[0].id, 2);
      this.vorbauen(plan);
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
      if (sc.state === 'requested') {
        this.cancelScene(plan, sid);
        sc.quelle = 'rohfassung';
        this.log({ art: 'rueckfall', mission: plan.id, szene: sid, quelle: 'rohfassung', plan: plan.key,
          begruendung: `Szene bleibt Rohfassung: zu spät – betreten nach ${Math.round((this.time - (sc.requestedAt || this.time)) * 10) / 10} s Anfrage (${sc.versuche || 0} Versuch(e) fertig)` });
      }
      sc.state = 'active';
    }
    this.requestAhead(plan, sid, 1);
  }
  requestSuccessors(plan, sid) { this.requestAhead(plan, sid, 1); }
  // Vorlauf (S2b §4.4): Nachfolger bis zur Tiefe `depth` anfragen; Nachfolger am selben Ort ohne Anflug-Schritt zählen nicht
  // als Stufe (sie beginnen ohne Sprung sofort), deren Nachfolger kommen also gleich mit.
  requestAhead(plan, sid, depth, seen) {
    const g = plan.grobplan; if (!g) return;
    const vis = seen || new Set([sid]);
    const s = g.szenen.find((x) => x.id === sid);
    const pre = Szenenbau.predecessors(g);
    for (const w of (s && s.weiter) || []) {
      const n = String(w.nach || '');
      if (n.startsWith('ausgang:') || vis.has(n)) continue;
      vis.add(n);
      this.requestScene(plan, n);
      const t = g.szenen.find((x) => x.id === n);
      const sameSpot = t && !Szenenbau.needsApproach(g, t, pre);
      const d = sameSpot ? depth : depth - 1;
      if (d > 0) this.requestAhead(plan, n, d, vis);
    }
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
    const prompt = scenePrompt(g, job.sid, this.env2(), plan.kontext || {}, { crew: this.crew(), retry: job.retry || null });
    return { prompt, system: LLM.systemPromptFile('szene'), art: 'szene', welt: this.weltId(), mission: plan.id, szene: job.sid, versuch: (plan.szenen[job.sid].versuche || 0) + 1, grobplan: g };
  }
  handleScene(plan, job, r, dauer, quelle) {
    const sid = job.sid; const sc = plan.szenen[sid];
    this.stats.szenen++;
    if (!sc || !this.plans[plan.key] || plan.entered.has(sid) || sc.state !== 'requested') {
      this.log({ art: 'szene', mission: plan.id, szene: sid, quelle, dauer_s: dauer, tokens: r.tokens || 0, begruendung: 'Szene schon betreten bzw. Mission vorbei – Antwort verworfen' });
      return;
    }
    sc.versuche = (sc.versuche || 0) + 1;
    let a = null; const errs = []; let repairs = [];
    try { a = Szenenbau.parseJsonAnswer(r.text); } catch (e) { errs.push('kein gültiges JSON: ' + e.message); }
    let built = null; const answers = Object.assign({}, plan.bookAnswers);
    if (a) {
      // S2b §4.3: einfache Fehler automatisch reparieren (Verzweigung, Flag ohne Folge, setFlag-Form, Wendung)
      const s = plan.grobplan.szenen.find((x) => x.id === sid);
      try {
        const others = Object.assign({}, plan.bookAnswers); delete others[sid];
        const rep = Szenenbau.repairSceneAnswer(plan.grobplan, s, a, this.env2(), { knownFlags: Szenenbau.planFlags(plan.grobplan, others, this.env2()) });
        a = rep.answer; repairs = rep.repairs;
      } catch (e) { this.countError('repair', e); }
      errs.push(...Szenenbau.factContradictions(Szenenbau.answerTexts(a), (plan.kontext && plan.kontext.fakten) || {}));
      answers[sid] = { answer: a, quelle };
      built = this.buildPlanBook(plan, plan.grobplan, answers);
      const info = built.szenen[sid] || {};
      if (info.quelle === 'rohfassung') errs.push(...(info.fehler || []).filter((x) => !/^Rohfassung:/.test(x)));
      if (built.errors.length) errs.push(...built.errors.map((x) => (typeof x === 'string' ? x : `${x.code} ${x.p}: ${x.msg}`)));
      if (info.quelle === 'rohfassung' && !errs.length) errs.push('Szene ließ sich nicht zusammensetzen');
    }
    this.log({ art: 'szene', mission: plan.id, szene: sid, quelle, dauer_s: dauer, tokens: r.tokens || 0, fehler: errs.slice(0, 20), versuch: sc.versuche, reparaturen: repairs.slice(0, 10),
      begruendung: (errs.length ? `Szene ungültig (Versuch ${sc.versuche})` : 'Szene ausgearbeitet, Rohfassung ersetzt') + (repairs.length ? ` – ${repairs.length} Reparatur(en): ${repairs.slice(0, 3).join(' | ')}` : '') });
    if (errs.length) {
      if (sc.versuche <= this.C.retries) { this.enqueue({ type: 'szene', plan, sid, retry: { antwort: String(r.text).slice(0, 8000), fehler: errs.slice(0, 20) } }); return; }
      this.sceneFailed(plan, sid, 'zweimal ungültig');
      return;
    }
    const res = this.callMission('updateBook', plan.id, built.book);
    if (res && res.ok === false) {
      const why = ((res.errors || []).slice(0, 2).map((x) => x.code || x).join(', ') || res.error || '');
      this.sceneFailed(plan, sid, (/BETRETEN/.test(why) ? 'zu spät – Szene schon betreten; ' : '') + 'updateBook abgelehnt: ' + why);
      return;
    }
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
        case 'plan': {
          // QA-Abnahme S2b: `sl plan [npc] [Vorgabe …]` – Auftraggeber/Vorgabe für die Live-Abnahme vorgeben (Debug)
          const an = { art: 'debug' };
          if (a[1]) an.auftraggeber = a[1];
          if (a.length > 2) an.auftrag = a.slice(2).join(' ');
          this.startRound(an, { force: true });
          say(`Spielleiter: neuer Grobplan angefragt${an.auftraggeber ? ' (Auftraggeber ' + an.auftraggeber + ')' : ''}.`);
          return null;
        }
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

module.exports = { create, Spielleiter, DEFAULTS, llmModeFromEnv, TEASER_TEXT, WAIT_ODA, katalog, scenePrompt, grobplanKurz };
