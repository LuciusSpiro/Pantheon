'use strict';
// Missions-Engine (CONTRACT-M1 §9.3, S1 CONTRACT-S1 §3.5): führt Missionen aus Regiebüchern aus (content/regiebuecher/*.json,
// geladen und geprüft über server/mission/loader.js + checker.js). Jeder { do: … } / { check: … } läuft über die
// Baustein-Registry (server/mission/registry.js). Die alten JS-Module m1–m3 sind seit S1-QA gelöscht (kein Fallback mehr);
// nur das Testgelände arena_space bleibt ein JS-Modul (server/missions/arena.js) mit internen Bausteinen.
// Bedingungen (atLocation, enemiesCleared/-Left, scanDone, itemAboard, flag, choiceMade, event, elapsed, missionDone, lobby …)
// und Aktionen (radio, oda, spawn, choice, reveal, reward, setFlag, set, after, goto, complete, wirkung/wendung, do …).
// Ein Schritt (step) hat: enter, timers, rules, objectives, next, jumpBlock, choices, scan, onAccept, on, allowBeam, skip,
// drill, wiederaufnahme.
const path = require('path');
const Locations = require('../../shared/locations.js');
const interior = require('./interior.js');
const space = require('./space.js');
const { dist } = require('../util.js');
const Registry = require('../mission/registry.js');
const Loader = require('../mission/loader.js');
const Checker = require('../mission/checker.js');
const Objects = require('../mission/objects.js');
const Lexikon = require('../mission/lexikon.js');

let arenaMod = null;
const arena = () => arenaMod || (arenaMod = require('./arena.js'));
// S2: Schützlinge (escort.js, Team SCHUETZLING) – defensiv, fehlt das Modul: 0 %
let escortMod;
function escortHpPct(g, tag) {
  if (escortMod === undefined) { try { escortMod = require('./escort.js'); } catch (e) { escortMod = null; } }
  if (!escortMod || typeof escortMod.hpPct !== 'function') return 0;
  try { const v = Number(escortMod.hpPct(g, tag)); return Number.isFinite(v) ? Math.round(v) : 0; } catch (e) { g.countError('mission-escortHp', e); return 0; }
}
const { ITEM_NAMES, DEKO_NAMES } = require('./explore.js');

// B1 F1 (B1-FIX-LP): Aktionen mit Kartenparameter (params typ 'map') auf einer gebauten Karte, die noch nicht registriert ist
// (game.aways[lp] entsteht sonst erst bei der Wahl an der Transfer-Konsole), laufen erst nach der Registrierung:
// landepunkte.sobaldGeladen registriert sofort aus dem Karten-Cache bzw. baut außerhalb des Ticks und holt die Aktion nach
// (spätestens beim Betreten), je Aktion+Argumente nur einmal. Handkarten und unbekannte Karten: sofort (wie bisher).
// Das ist der einzige Weg aller Bausteine auf eine Landepunkt-Karte – Bausteine prüfen game.aways[lp] nicht selbst.
let lpMod;
function landepunkte() {
  if (lpMod === undefined) { try { lpMod = require('./landepunkte.js'); if (!lpMod || lpMod.stub || typeof lpMod.sobaldGeladen !== 'function') lpMod = null; } catch (e) { lpMod = null; } }
  return lpMod;
}
function aufKarten(g, entry, args, fn) {
  const L = landepunkte();
  const keys = Object.keys((entry && entry.params) || {}).filter((k) => entry.params[k] && entry.params[k].typ === 'map');
  const maps = L ? [...new Set(keys.map((k) => args && args[k]).filter((x) => typeof x === 'string' && x))] : [];
  if (!maps.length) return fn();
  const key = entry.id + ':' + JSON.stringify(args);
  const weiter = (i) => {
    if (i >= maps.length) return fn();
    if (L.sobaldGeladen(g, maps[i], key, () => weiter(i + 1)) === 'unbekannt') weiter(i + 1);
    return undefined;
  };
  return weiter(0);
}
// §21.2 Missionsbuch
const BOOK_LOG_MAX = 6;   // Log-Einträge je Buch-Eintrag (die jüngsten)
const BOOK_TEXT_MAX = 120;   // Zeichen je Log-Text im Buch (volle Texte im Logbuch)
const TESK = 'Hafenmeisterin Tesk';
const SELA = 'Sela (Vaelen-Händlerin)';
// Größenbudget des Buchs im Snapshot (Bytes JSON). Grundlast im Kesh-Kampf zu dritt ≈ 8 KB, Snapshot muss < 12 KB bleiben.
const BOOK_BUDGET = 3000;
const jsonBytes = (o) => Buffer.byteLength(JSON.stringify(o));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// ---------- Missionskatalog: Regiebücher + interne JS-Module ----------
// Interne Szenarien, die (noch) JS-Module sind: nur das Testgelände Raumkampf (art 'intern', nie in der Kampagne)
const INTERN_JS = { arena_space: '../missions/arena.js' };
function tryRequire(p) {
  try { return require(p); } catch (e) { if (e && e.code !== 'MODULE_NOT_FOUND') console.error('[Pantheon] ' + p + ':', e.message); return null; }
}
function wrapInternJs(id, mod) {
  return Object.assign({}, mod, {
    id, isBook: false, art: 'intern', tutorial: false, angebot: {}, buehne: {}, ausgaenge: {}, erwartet: {},
    debugPrep: mod.debugPrep || {}, debugDone: mod.debugDone || null, steps: mod.steps || [],
  });
}
let CATALOG = null;
function catalog() {
  if (CATALOG) return CATALOG;
  const t0 = Date.now();
  const { books, invalid, warnings } = Loader.loadAll();
  const jsModules = {};
  for (const [id, p] of Object.entries(INTERN_JS)) {
    if (books[id]) continue;
    const mod = tryRequire(p);
    if (mod) jsModules[id] = wrapInternJs(id, mod);
  }
  for (const inv of invalid) {
    console.error(`[Pantheon] Regiebuch '${inv.id}' ungültig – wird nicht angeboten (${path.basename(inv.file)}):`);
    for (const e of inv.errors.slice(0, 8)) console.error(`  ${e.code} ${e.p}: ${e.msg}`);
    if (inv.errors.length > 8) console.error(`  … ${inv.errors.length - 8} weitere`);
  }
  const info = {};
  for (const [id, b] of Object.entries(books)) info[id] = { id, title: (b.kopf && b.kopf.titel) || id, art: (b.kopf && b.kopf.art) || 'mission', tutorial: !!(b.kopf && b.kopf.tutorial), angebot: b.angebot || {}, isBook: true };
  for (const [id, d] of Object.entries(jsModules)) info[id] = { id, title: d.title, art: d.art, tutorial: d.tutorial, angebot: d.angebot, isBook: false };
  // Angebotsreihenfolge: Start-Missionen, dann Ketten über angebot.nach.missionDone, Rest nach Kennung
  const missions = Object.values(info).filter((x) => x.art === 'mission');
  const order = [];
  const add = (x) => { if (!order.includes(x.id)) order.push(x.id); };
  missions.filter((x) => x.angebot.start).sort((a, b) => a.id.localeCompare(b.id)).forEach(add);
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of missions.sort((a, b) => a.id.localeCompare(b.id))) {
      const n = x.angebot.nach;
      if (!order.includes(x.id) && isObj(n) && typeof n.missionDone === 'string' && order.includes(n.missionDone)) { add(x); grew = true; }
    }
  }
  missions.sort((a, b) => a.id.localeCompare(b.id)).forEach(add);
  const sides = Object.values(info).filter((x) => x.art === 'nebenauftrag').map((x) => x.id).sort();
  CATALOG = { books, invalid, warnings, jsModules, info, order, sides, ms: Date.now() - t0 };
  return CATALOG;
}
// Für Tests: Katalog neu laden (z. B. nach dem Schreiben eines Buchs)
function reloadCatalog() { CATALOG = null; return catalog(); }

function fitBook(entries, budget) {
  const steps = [
    () => { for (const e of entries) if (e.state === 'erledigt') e.log = []; },
    () => { for (const e of entries) if (e.kind === 'hinweis' && e.id !== 'teaser') e.briefing = ''; },
    () => { for (const e of entries) if (e.briefing.length > 140) e.briefing = e.briefing.slice(0, 139) + '…'; },
    () => { for (const e of entries) if (e.log.length > 3) e.log = e.log.slice(-3); },
    () => { for (const e of entries) if (e.state === 'erledigt' && e.objectives.length > 1) e.objectives = [objOut(e.objectives.length + ' Ziele erledigt', true)]; },
    () => { for (const e of entries) if (e.state === 'erledigt') e.briefing = ''; },
    () => { for (const e of entries) e.log = []; },
    () => { for (const e of entries) if (e.state !== 'erledigt' && e.objectives.length > 8) e.objectives = e.objectives.slice(-8); },
    () => { for (const e of entries) if (e.state === 'erledigt') e.objectives = []; },
  ];
  for (const s of steps) { if (jsonBytes(entries) <= budget) break; s(); }
  // Notfalls Hinweise (Entdeckungen) von hinten weglassen – sie stehen auch auf der Taktik-Karte
  while (jsonBytes(entries) > budget) {
    let i = -1;
    for (let k = entries.length - 1; k >= 0; k--) if (entries[k].id.startsWith('h:')) { i = k; break; }
    if (i < 0) break;
    entries.splice(i, 1);
  }
  return entries;
}
// B1 F2: {fund} ohne bekannten Fund; gemerkte Funde beginnen klein (Artikel), groß schreibt tpl am Satzanfang
const FUND_NEUTRAL = 'die Beute';
const fundText = (t) => String(t || '').trim().replace(/^(Der|Die|Das|Ein|Eine)\b/, (w) => w.toLowerCase()) || FUND_NEUTRAL;
const objOut = (text, done, optional) => (optional ? { text, done: !!done, optional: true } : { text, done: !!done });
function rewardText(r) {
  if (!r) return '';
  const parts = [];
  if (r.marks) parts.push(r.marks + ' Marken');
  for (const [k, n] of Object.entries(r.items || {})) parts.push(n + '× ' + (ITEM_NAMES[k] || k));
  for (const d of r.deko || []) parts.push('Deko: ' + (DEKO_NAMES[d] || d));
  return parts.join(', ');
}

const CONSOLE_HELP = {
  helm: 'Steuer: W/S Tempostufe (½ = wendig), A/D Ruder, X Allstopp, Shift+A/D ausweichen, F Faltsprung. Lanze: Bug drauf!',
  captain: 'Captain: Funk, Karte, Lage, Energie & Schilde (ab 3 dicht, 1–2 lassen Kratzer durch), Schäden, Außenteam.',
  weapons: 'Taktik: 1 halten = Lanze laden, loslassen = Feuer. 2/3/Leertaste Batterien. T Ziel, Q/E+A/D Punkte, S/W Scan.',
  transfer: 'Transfer: Leute auf die Pads, dann Runter/Hoch. Nachschub und Notrückholung gibt\'s hier auch.',
  shop: 'Terminal: Marken gegen Kram. Angedockt bei der Karawane zeigt es das Vaelen-Sortiment.',
  quartier: 'Dein Quartier! Boden, Wand, Licht und vier Deko-Plätze. Gemütlichkeit ist ein Schiffssystem.',
  sonde: 'Kustoden-Sonde: Farben 1–6 in der Reihenfolge der Symbole. Die Tabelle hat der Captain oben.',
  plan: 'Planungstisch: Sternkarte und gescannte Karten. Pins setzen und gemeinsam planen. Esc steht auf.',
};
// Fallback, solange content/npc.json keinen Funk für „Kampagne ohne Tutorial“ hat
const FREE_RADIO_FALLBACK = { from: 'tesk', text: 'Lerche, hier Tesk. Willkommen im Lichtkordon. Man munkelt, die Tafel von Kesh liege jetzt im Konkordat-Archiv. Neue Aufträge folgen.' };

class Mission {
  constructor(game) {
    this.game = game;
    this.state = { stage: null, objectives: [], radio: null, choice: null, teaser: null,
      flags: { bribed: null, decision: null, technikerRescued: false } };
    this.flags = this.state.flags;
    this.missions = {};          // id -> { id, title, state: 'active'|'done', ausgang? }
    this.activeId = null; this.def = null; this.step = null;
    this.stepTime = 0; this.v = {}; this.events = new Set(); this.done = new Set();
    this.timers = []; this.firedTimers = new Set(); this.firedRules = new Set();
    this.choicesMade = new Set(); this.kills = {}; this.ev = null;
    this.scanPoint = null;
    // §21.2 Missionsbuch: abgehakte Ziele je Mission (bleiben über Schrittwechsel erhalten), Fokus, Version
    this.doneLog = {};           // missionId -> [{ id, text, optional }]
    this.book = { version: 1, focus: null, key: null };
    // S1
    this.mode = null;            // 'campaign' | 'direct' | 'arena' | null (noch nicht gestartet)
    this.pending = [];           // missionsunabhängige Zeitpunkte (game.time), z. B. Tesk-Funk ohne Tutorial
    this.defCache = {};          // id -> Laufzeit-Def (Bücher: beim Missionsstart neu vorbereitet, damit tune wirkt)
    this.textDef = null;         // Def für @-Texte außerhalb der aktiven Mission (Folgen, danach, Nebenaufträge)
    this.writeCtx = null;        // { mission, ausgang } für Weltstand-Bausteine
    this.dormant = false;        // Schritt nach dem Laden noch nicht am Ort (siehe wakeIfThere)
    // S2 §3.1: zur Laufzeit registrierte Bücher (Spielleiter/Archiv), außerhalb von order
    this.extra = {};             // id -> { book, origin: 'sl'|'archiv' }
    this.funde = {};             // B1 F2: missionId -> Fund der Mission (Aktion fund, Textbaustein {fund}), Nominativ mit Artikel
    this.entered = new Set();    // 'missionId:schrittId' – betretene Schritte (updateBook ändert nur unbetretene)
    this.seenOffers = new Set(); this.offerCheckT = 0;
    const cat = catalog();
    // Entscheidung 14: ungültiges Regiebuch mit --debug -> Abbruch, sonst laut loggen und nicht anbieten
    const fatal = cat.invalid;
    if (game && game.debug && fatal.length) {
      throw new Error('Ungültige Regiebücher: ' + fatal.map((i) => `${i.id} (${i.errors.map((e) => e.code + ' ' + e.p).slice(0, 3).join('; ')})`).join(', '));
    }
  }

  get stageTime() { return this.stepTime; }   // Altname (Tests/Tools)
  get order() { return catalog().order; }

  // ---------- Katalog ----------
  info(id) {
    const x = this.extra[id];
    if (x) {
      const k = x.book.kopf || {};
      return { id, title: k.titel || id, art: k.art || 'generiert', tutorial: false, angebot: x.book.angebot || {}, isBook: true, origin: x.origin };
    }
    return catalog().info[id] || null;
  }
  // Rohes Regiebuch (statischer Katalog oder zur Laufzeit registriert)
  rawBook(id) { return this.extra[id] ? this.extra[id].book : (catalog().books[id] || null); }
  // Alle Missionskennungen: Angebotsreihenfolge, danach die Spielleiter-Bücher (in Registrierungsreihenfolge)
  allIds() { const o = this.order; return o.concat(Object.keys(this.extra).filter((id) => !o.includes(id))); }
  // Frische Laufzeit-Def (Bücher: cfg mit game.C aufgelöst)
  loadDef(id) {
    const cat = catalog();
    let def = null;
    const raw = this.extra[id] ? this.extra[id].book : cat.books[id];
    if (raw) {
      def = Loader.prepare(raw, this.game.C);
      if (this.extra[id]) def.origin = this.extra[id].origin;
      for (const e of def.cfgErrors) this.game.countError('mission-cfg', new Error(`${id}: ${e}`));
    } else if (cat.jsModules[id]) def = cat.jsModules[id];
    if (def) this.defCache[id] = def;
    return def;
  }
  defFor(id) { return this.defCache[id] || this.loadDef(id); }
  offers() { return this.order.slice(); }

  // ---------- Lebenszyklus ----------
  start() { this.startCampaign({ tutorial: true }); }

  // S1 §3.5: Kampagne mit Tutorial (erste Mission mit angebot.start) oder ohne (Tutorial gilt als erledigt)
  startCampaign(opts) {
    const g = this.game; const C = g.C;
    const tutorial = !(opts && opts.tutorial === false);
    this.mode = 'campaign';
    if (tutorial) {
      const first = this.order.find((id) => this.info(id).angebot.start) || this.order[0];
      if (first) this.startMission(first);
      this.sl('onCampaignStart', { tutorial: true });   // S2 §2.1
      return;
    }
    for (const id of this.order) {
      const inf = this.info(id);
      if (!inf.tutorial || this.missions[id]) continue;
      const def = this.defFor(id);
      this.missions[id] = { id, title: inf.title, state: 'done', ausgang: 'uebersprungen' };
      g.stats.missions[id] = { start: this.playTime(), end: this.playTime() };
      // nur Fakten aus dem Ausgang 'uebersprungen' (kein Gedächtnis, keine Chronik)
      const ag = def && def.ausgaenge && def.ausgaenge.uebersprungen;
      if (ag) this.withContext(def, { mission: id, ausgang: 'uebersprungen' }, () => this.run((ag.folgen || []).filter((a) => a && a.do === 'welt_fakt')));
    }
    // S2 (QA-INTEGRATION): Kartenstand wie nach dem Tutorial – alle Orte bekannt (nicht besucht), gesperrte Verbindungen
    // (nebel–relais, kesh), die m2/m3 öffnen, offen. Still: kein ODA, kein Logbuch.
    this.openTutorialMap();
    const camp = C.campaign || {};
    g.inventory.marks = camp.skipTutorialMarks != null ? camp.skipTutorialMarks : C.economy.startMarks;
    const kamp = (Loader.npcData().kampagne || {}).ohne_tutorial || {};
    for (const [k, v] of Object.entries(kamp.fakten || {})) {
      const value = isObj(v) && 'value' in v ? v.value : v;
      const quelle = isObj(v) && v.quelle ? v.quelle : 'ohne_tutorial';
      this.callWeltstand('fact', k, value, quelle);
    }
    const funk = kamp.funk && kamp.funk.text ? kamp.funk : FREE_RADIO_FALLBACK;
    this.pending.push({ at: g.time + (camp.teskRumorAt != null ? camp.teskRumorAt : 8), actions: [{ radio: { from: funk.from || 'tesk', text: funk.text } }] });
    this.refreshObjectives();
    this.checkOffers();
    this.sl('onCampaignStart', { tutorial: false });   // S2 §2.1: Planung nach dem Tesk-Funk (Spielleiter plant selbst)
  }

  // ---------- S2: Spielleiter-Nähte ----------
  // Aufruf in game.spielleiter (defensiv, Fehler gezählt); ohne Spielleiter undefined
  sl(method, ...args) {
    const g = this.game;
    if (!g || !g.spielleiter) return undefined;
    if (typeof g.callSpielleiter === 'function') return g.callSpielleiter(method, ...args);
    const s = g.spielleiter;
    if (typeof s[method] !== 'function') return undefined;
    try { return s[method](...args); } catch (e) { g.countError('spielleiter-' + method, e); return undefined; }
  }
  // Neue Gegner-KI (flightV2) für erzeugte Missionen (kopf.art generiert|archiv); Tutorial unverändert (pilot.js fragt)
  flightV2() {
    const a = this.def && this.def.kopf && this.def.kopf.art;
    return a === 'generiert' || a === 'archiv';
  }
  // §3.1: Buch zur Laufzeit registrieren. -> { ok, errors?, warnings? }. Prüft (Checker) und bereitet vor (Loader.prepare).
  registerBook(book, opts) {
    const fail = (code, p, msg, extra) => Object.assign({ ok: false, errors: [{ code, p, msg }] }, extra || {});
    if (!isObj(book) || typeof book.id !== 'string') return fail('SCHEMA', 'id', 'Buch ohne id');
    const id = book.id;
    const art = book.kopf && book.kopf.art;
    if (art !== 'generiert' && art !== 'archiv') return fail('ART', 'kopf.art', `kopf.art muss 'generiert' oder 'archiv' sein (ist ${JSON.stringify(art)})`);
    if (catalog().info[id]) return fail('DOPPELT', 'id', `Mission '${id}' gibt es schon im Katalog`);
    if (this.missions[id]) return fail('LAEUFT', 'id', `Mission '${id}' läuft schon bzw. ist erledigt – updateBook benutzen`);
    let r;
    try { r = Checker.check(book); } catch (e) { return fail('PRUEFER', '$', 'Prüfer abgestürzt: ' + e.message); }
    if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings };
    const copy = JSON.parse(JSON.stringify(book));
    const def = Loader.prepare(copy, this.game.C);
    if (def.cfgErrors.length) return fail('REF-CFG', '$', def.cfgErrors.join('; '));
    const origin = (opts && opts.origin) || (art === 'archiv' ? 'archiv' : 'sl');
    this.extra[id] = { book: copy, origin };
    delete this.defCache[id];
    return { ok: true, warnings: r.warnings };
  }
  // §3.1: Buch ersetzen (zwischen zwei Ticks). Nur unbetretene Schritte dürfen sich ändern; der laufende Schritt wird per
  // ID neu gebunden (Timer/Regeln-Zustand bleibt, weil der Schritt selbst unverändert ist).
  updateBook(id, book) {
    const fail = (code, p, msg) => ({ ok: false, errors: [{ code, p, msg }] });
    const x = this.extra[id];
    if (!x) return fail('UNBEKANNT', 'id', `Kein Spielleiter-Buch '${id}'`);
    if (!isObj(book) || book.id !== id) return fail('SCHEMA', 'id', 'id passt nicht');
    if (this.missions[id] && this.missions[id].state === 'done') return fail('ERLEDIGT', 'id', `Mission '${id}' ist erledigt`);
    const art = book.kopf && book.kopf.art;
    if (art !== 'generiert' && art !== 'archiv') return fail('ART', 'kopf.art', "kopf.art muss 'generiert' oder 'archiv' sein");
    let r;
    try { r = Checker.check(book); } catch (e) { return fail('PRUEFER', '$', 'Prüfer abgestürzt: ' + e.message); }
    if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings };
    // QA-Abnahme S2b: Die Flag-Rücksetzung im enter des ersten Schritts ({ setFlag: { a: null, … } }) listet alle Flags des
    // Buchs; bringt eine ersetzte Szene andere Flags mit, änderte sich dadurch der schon betretene Hafen-Schritt und die
    // ausgearbeitete Szene wurde mit BETRETEN abgelehnt (live: s3_begegnung). Ein bereits gelaufenes enter wirkt nicht mehr –
    // reine Rücksetzungen zählen beim Vergleich daher nicht.
    const isReset = (a) => isObj(a) && isObj(a.setFlag) && Object.keys(a).length === 1 && Object.values(a.setFlag).every((v) => v === null);
    const norm = (s) => {
      if (!Array.isArray(s.enter)) return JSON.stringify(s);
      const o = Object.assign({}, s, { enter: s.enter.filter((a) => !isReset(a)) });
      if (!o.enter.length) delete o.enter;
      return JSON.stringify(o);
    };
    const oldSteps = new Map((x.book.steps || []).map((s) => [s.id, norm(s)]));
    const newSteps = new Map((book.steps || []).map((s) => [s.id, norm(s)]));
    for (const key of this.entered) {
      const [mid, sid] = key.split(':');
      if (mid !== id) continue;
      if (oldSteps.get(sid) !== newSteps.get(sid)) return fail('BETRETEN', `steps.${sid}`, `Schritt '${sid}' wurde schon betreten und darf sich nicht ändern`);
    }
    const copy = JSON.parse(JSON.stringify(book));
    const def = Loader.prepare(copy, this.game.C);
    if (def.cfgErrors.length) return fail('REF-CFG', '$', def.cfgErrors.join('; '));
    def.origin = x.origin;
    if (this.activeId === id && this.def) {
      const st = this.step ? def.steps.find((s) => s.id === this.step.id) : null;
      if (this.step && !st) return fail('BETRETEN', 'steps', `laufender Schritt '${this.step.id}' fehlt im neuen Buch`);
      this.def = def; this.defCache[id] = def;
      if (st) this.step = st;
      this.missions[id].title = def.title;
    } else delete this.defCache[id];
    x.book = copy;
    return { ok: true, warnings: r.warnings };
  }
  unregisterBook(id) {
    if (!this.extra[id]) return { ok: false, errors: [{ code: 'UNBEKANNT', p: 'id', msg: `Kein Spielleiter-Buch '${id}'` }] };
    if (this.activeId === id) return { ok: false, errors: [{ code: 'LAEUFT', p: 'id', msg: `Mission '${id}' läuft gerade` }] };
    delete this.extra[id]; delete this.defCache[id];
    if (this.missions[id] && this.missions[id].state !== 'done') delete this.missions[id];
    return { ok: true };
  }
  // §3.1: Missionsbuch-Einträge 'angeboten' aus game.spielleiter.offers()
  offerList() {
    const list = this.sl('offers');
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const o of list) {
      if (!isObj(o) || typeof o.id !== 'string' || this.missions[o.id]) continue;
      if (['running', 'done', 'declined', 'abgelehnt', 'aktiv', 'erledigt'].includes(o.state)) continue;
      const str = (v, n) => (v == null ? null : String(v).slice(0, n));
      const vonName = o.von != null ? this.npcName(String(o.von)) : null;   // QA-INTEGRATION S2: Anzeigename statt Kennung
      const e = { id: o.id, title: str(o.titel || o.title, 60) || o.id, from: str(vonName, 40), kind: 'mission', state: 'angeboten',
        briefing: str(o.briefing, 300) || '', reward: str(o.belohnung, 80) || '', objectives: [], log: [], loc: str(o.ziel, 40),
        von: str(vonName, 40), ziel: str(o.ziel, 40), dauer_min: Number.isFinite(o.dauer_min) ? o.dauer_min : null,
        belohnung: str(o.belohnung, 80), erinnerung: str(o.erinnerung, 160) };
      if (this.game.debug && o.origin) e.origin = o.origin === 'archiv' ? 'archiv' : 'sl';
      out.push(e);
    }
    return out;
  }
  // Neue Angebote melden (Ereignis offerIn) – höchstens alle 0,5 s nachsehen
  checkNewOffers(dt) {
    if (!this.game.spielleiter) return;
    this.offerCheckT -= dt;
    if (this.offerCheckT > 0) return;
    this.offerCheckT = 0.5;
    for (const o of this.offerList()) {
      if (this.seenOffers.has(o.id)) continue;
      this.seenOffers.add(o.id);
      this.game.emit('offerIn', { id: o.id, title: o.title, from: o.from });
      this.game.emit('sfx', { name: 'offer_in' });
    }
  }
  // Ereignis chapter (Kapitelkarte): Kampagne läuft weiter
  chapter(a) {
    const g = this.game;
    const title = this.tpl(a.title) || 'Kapitel abgeschlossen';
    const text = a.text != null ? this.tpl(a.text) : null;
    g.emit('chapter', { title, text });
    g.log(`Kapitelkarte: ${title}`);
  }
  // Anflug/sceneWait (Absprache Studioleitung): Der Spielleiter hält seine Anflug-Schritte selbst über die Prüfung
  // szene_bereit { szene } (registry.js) und sendet sceneWait selbst. Die Engine hält nicht zusätzlich.

  // M2: Lobby-Direktstart (CONTRACT-M2 §3.3): frühere Missionen gelten als erledigt, Schiff im Hafen (nicht angedockt),
  // angebot.direktstart.setFlag/prep, Auftrag kommt als Funk zum Annehmen. Ohne Weltstand (S1 Entscheidung 18).
  startDirect(id) {
    const g = this.game;
    const inf = this.info(id);
    if (!inf) return this.start();
    this.mode = 'direct';
    for (const mid of this.order) {
      if (mid === id) break;
      const d = this.defFor(mid);
      this.missions[mid] = { id: mid, title: this.info(mid).title, state: 'done' };
      g.stats.missions[mid] = { start: this.playTime(), end: this.playTime() };
      if (d && d.debugDone) this.withContext(d, null, () => this.run(d.debugDone));
    }
    const ds = inf.angebot.direktstart || {};
    Object.assign(this.flags, ds.setFlag || {});
    space.enterScene(g, 'hafen', { docked: false });
    const def = this.defFor(id);
    if (ds.prep) this.withContext(def, null, () => this.run(ds.prep));
    this.startMission(id);
  }

  openTutorialMap() {
    const ex = this.game.explore;
    if (!ex || typeof ex.knowSilently !== 'function') return;
    try {
      for (const l of Locations.LOCKED_LINKS) ex.openLink(l.key);
      for (const l of Locations.LOCATIONS) ex.knowSilently(l.id);
    } catch (e) { this.game.countError('openTutorialMap', e); }
  }
  // S2 (QA-INTEGRATION): erzeugte/Archiv-Missionen – Route zu allen Orten der Bühne herstellen (still), sonst sind z. B.
  // Kesh oder das Relais ohne Tutorial unerreichbar.
  openStageRoutes(id, def) {
    const ex = this.game.explore;
    if (!ex || typeof ex.ensureRoute !== 'function' || !def || (def.art !== 'generiert' && def.art !== 'archiv')) return;
    try {
      const raw = this.rawBook(id) || {};
      const orte = ((raw.buehne && raw.buehne.orte) || (def.buehne && def.buehne.orte) || []);
      for (const o of orte) if (typeof o === 'string') ex.ensureRoute(o);
    } catch (e) { this.game.countError('openStageRoutes', e); }
  }
  startMission(id) {
    const def = this.loadDef(id);
    if (!def) { this.game.countError('mission-start', new Error('Unbekannte Mission ' + id)); return; }
    if (def.isBook) {
      // §3.3: Prüfer beim Missionsstart noch einmal (das Buch ist geladen und gültig – Sicherung gegen Laufzeitänderungen)
      const r = Checker.check(this.rawBook(id));
      if (!r.ok) { this.game.countError('mission-book', new Error(`${id}: ${r.errors.map((e) => e.code + ' ' + e.p).slice(0, 3).join('; ')}`)); return; }
    }
    if (def.art === 'intern') this.mode = this.mode || 'arena';
    this.applyExpected(def);
    this.openStageRoutes(id, def);
    // QA-INTEGRATION S2: Schützlinge einer früheren Mission gehören nicht in die neue (Tags wiederholen sich)
    if ((def.art === 'generiert' || def.art === 'archiv') && this.game.space) { this.game.space.escorts = []; this.game.space.escortsGone = []; }
    this.missions[id] = { id, title: def.title, state: 'active' };
    this.activeId = id; this.def = def;
    delete this.funde[id];
    // S2 (Bericht SPIELLEITER): Entscheidungen gelten je Mission – sonst überspringt ein wiederholtes Archiv-Buch mit
    // gleicher Entscheidungs-ID die Wahl. restore() überlagert danach wie bisher.
    this.choicesMade = new Set();
    const st = this.game.stats;
    st.missions[id] = { start: this.playTime(), end: null };
    this.game.emit('missionStart', { id, title: def.title });
    this.setStep(def.steps[0].id);
  }
  // erwartet: fehlende Flags (undefiniert/null) bekommen den Standard
  applyExpected(def) {
    for (const [k, v] of Object.entries((def && def.erwartet) || {})) if (this.flags[k] == null) this.flags[k] = v;
  }

  completeMission(ausgangIn) {
    const id = this.activeId; const def = this.def;
    if (!id) return;
    const ausgang = ausgangIn == null || ausgangIn === true ? 'erfolg' : String(ausgangIn);
    this.collectStepEnd();
    this.missions[id].state = 'done';
    this.missions[id].ausgang = ausgang;
    this.game.stats.missions[id].end = this.playTime();
    this.game.emit('missionDone', { id, title: def.title, ausgang });
    // B3 §4: temporäre Sprungpunkte mit bis 'mission' schließen (sprung.js, SEKTOR); fehlt die Funktion: nichts
    try { const S = require('./sprung.js'); if (S && typeof S.missionEnde === 'function') S.missionEnde(this.game); } catch (e) { this.game.countError('mission-sprung', e); }
    this.game.log(`Mission ${id} abgeschlossen (${ausgang}) nach ${Math.round(this.game.stats.missions[id].end - this.game.stats.missions[id].start)} s.`);
    const ag = def.ausgaenge && def.ausgaenge[ausgang];
    if (def.isBook && !ag) this.game.countError('mission-ausgang', new Error(`${id}: Ausgang '${ausgang}' fehlt`));
    // Folgen schreiben in den Weltstand (Mission und Ausgang im Kontext)
    if (ag) this.withContext(def, { mission: id, ausgang }, () => this.run(ag.folgen || []));
    this.activeId = null; this.def = null; this.step = null; this.state.stage = null; this.state.choice = null;
    this.refreshObjectives();
    if (def.onComplete) this.run(def.onComplete);   // nur Altmodule
    if (ag && ag.danach) this.withContext(def, { mission: id, ausgang }, () => this.run(ag.danach));
    if (this.mode !== 'direct' && this.mode !== 'arena') this.checkOffers();
    this.sl('onMissionDone', { id, ausgang });   // S2 §3.1: für jede Mission, der Spielleiter filtert
  }

  // Angebote: nächste Mission starten, deren angebot.nach gilt (sofort aktiv wie bisher)
  checkOffers() {
    if (this.activeId) return;
    for (const id of this.order) {
      if (this.missions[id]) continue;
      const a = this.info(id).angebot || {};
      if (a.start || !a.nach) continue;
      if (a.nicht_wenn && this.cond(a.nicht_wenn)) continue;
      if (this.cond(a.nach)) { this.startMission(id); return; }
    }
  }

  playTime() { return Math.round((this.game.time - this.game.stats.playTimeStart) * 10) / 10; }

  // opts.dormant (nur restore): Schritt mit loc fern vom Schiff – enter/timers/rules/next laufen erst am Ort (update)
  setStep(id, opts) {
    const g = this.game;
    const step = this.def.steps.find((s) => s.id === id);
    if (!step) { g.countError('mission-step', new Error('Unbekannter Schritt ' + id)); return; }
    this.collectStepEnd();
    const prevStep = this.step && this.def && this.def.steps.includes(this.step) ? this.step : null;
    this.dormant = !!(opts && opts.dormant);
    this.step = step; this.state.stage = id;
    if (this.activeId) this.entered.add(this.activeId + ':' + id);
    this.stepTime = 0; this.v = {}; this.events = new Set(); this.timers = []; this.firedTimers = new Set(); this.firedRules = new Set();
    this.kills = {}; this.state.choice = null; this.scanPoint = null;
    g.ship.scan.progress = 0; g.ship.scan.done = false; g.ship.scanning = false;
    g.stats.stages[id] = this.playTime();
    g.emit('stage', { stage: id, mission: this.activeId });
    // S2 §3.1: Wechsel auf einen Schritt mit neuer Umsetzung -> Spielleiter fragt die Nachfolgeszene(n) an (Vorlauf)
    if (step.umsetzung && (!prevStep || prevStep.umsetzung !== step.umsetzung || prevStep === step)) this.sl('onSceneEnter', this.activeId, step.szene || step.id);
    if (step.enter && !this.dormant) this.run(step.enter);
    this.refreshObjectives();
  }
  // W1 AP4 (§5.4 Nr. 4, CONTRACT-B2 §4): Darf ein verlorener Bodenkampf in diesem Schritt in den Ausbruch kippen?
  // Schrittfeld ausbruch_erlaubt, Standard true; im Tutorial (m1–m3) immer false. Liest combat.ausbruchMoeglich.
  ausbruchErlaubt() {
    const inf = this.activeId ? this.info(this.activeId) : null;
    if (inf && inf.tutorial) return false;
    return !(this.step && this.step.ausbruch_erlaubt === false);
  }
  // QA-Abnahme S1: Auch ein ruhender Schritt darf weitergehen, wenn sein `next` schon gilt – sonst hängt z. B. m1 `return`
  // (nach dem Laden bei Vaelen, Schritt-Ort b7) beim Heimflug fest, und m2 `sonde` (geladen im Hafen) beim Flug in den Nebel.
  // Enter/Timer/Regeln laufen weiterhin erst am Ort. Ein Ziel-Schritt mit fremdem Ort ruht seinerseits.
  dormantNext() {
    const step = this.step;
    for (const n of step.next || []) {
      if (!this.cond(n.if)) continue;
      if (n.do) this.run(n.do);
      if (this.step === step) {
        if (n.complete) this.completeMission(n.complete);
        else if (n.goto) {
          const t = this.def.steps.find((s) => s.id === n.goto);
          this.setStep(n.goto, { dormant: !!(t && t.loc && this.game.ship.scene !== t.loc) });
        }
      }
      break;
    }
  }
  // Ruhender Schritt (nach dem Laden): erst am Ort des Schritts loslaufen – dann enter, Zeit ab 0
  wakeIfThere() {
    if (!this.dormant || !this.step) return false;
    if (this.step.loc && this.game.ship.scene !== this.step.loc) return false;
    this.dormant = false; this.stepTime = 0;
    if (this.step.enter) this.run(this.step.enter);
    return true;
  }

  // ---------- S1: Weltstand (toSave/restore) ----------
  toSave() {
    const missionen = {};
    for (const [id, ms] of Object.entries(this.missions)) {
      const inf = this.info(id);
      if (inf && inf.art === 'intern') continue;
      const st = this.game.stats.missions[id] || {};
      const active = id === this.activeId;
      const e = { status: ms.state === 'done' ? 'erledigt' : (active && this.offerPending() ? 'angeboten' : 'aktiv') };
      if (ms.ausgang) e.ausgang = ms.ausgang;
      if (st.start != null) e.start_s = st.start;
      if (st.end != null) e.ende_s = st.end;
      e.erledigte_ziele = (this.doneLog[id] || []).map((o) => Object.assign({ id: o.id, text: o.text }, o.optional ? { optional: true } : {}, o.schritt ? { schritt: o.schritt } : {}));
      if (active && ms.state !== 'done') {
        e.schritt = this.state.stage;
        e.v = JSON.parse(JSON.stringify(this.v));
        e.ereignisse = [...this.events];
        e.entscheidungen = [...this.choicesMade];
        if (this.funde[id]) e.fund = this.funde[id];   // B1: gemerkter Fund ({fund})
        // S2: betretene Schritte erzeugter Missionen (updateBook ändert nur unbetretene)
        if (this.extra[id]) e.betreten = [...this.entered].filter((k) => k.startsWith(id + ':')).map((k) => k.slice(id.length + 1));
      }
      missionen[id] = e;
    }
    const inf = this.activeId ? this.info(this.activeId) : null;
    return { missionen, aktiv: inf && inf.art !== 'intern' ? this.activeId : null,
      flags: JSON.parse(JSON.stringify(this.flags)), buchFokus: this.book.focus || null };
  }
  // Laden: Zustand übernehmen; aktive Mission startet den gespeicherten Schritt neu (bzw. wiederaufnahme.ab), danach
  // v (nur gleicher Schritt) / Ereignisse / Entscheidungen / erledigte Ziele überlagern, dann wiederaufnahme.prep.
  restore(obj) {
    const g = this.game;
    if (!isObj(obj)) return false;
    this.mode = 'campaign';
    if (isObj(obj.flags)) Object.assign(this.flags, obj.flags);
    if (obj.buchFokus !== undefined) this.book.focus = obj.buchFokus || null;
    const ms = isObj(obj.missionen) ? obj.missionen : {};
    for (const [id, m] of Object.entries(ms)) {
      if (!isObj(m)) continue;
      const inf = this.info(id);
      g.stats.missions[id] = { start: m.start_s != null ? m.start_s : this.playTime(), end: m.ende_s != null ? m.ende_s : null };
      this.doneLog[id] = (m.erledigte_ziele || []).filter(isObj).map((x) => Object.assign({ id: x.id, text: x.text, optional: !!x.optional }, x.schritt ? { schritt: x.schritt } : {}));
      if (m.status === 'erledigt') this.missions[id] = { id, title: inf ? inf.title : id, state: 'done', ausgang: m.ausgang || null };
    }
    const aid = obj.aktiv;
    const m = aid && ms[aid];
    if (m && m.status !== 'erledigt') {
      const def = this.loadDef(aid);
      if (!def) { g.countError('mission-restore', new Error('Unbekannte Mission ' + aid)); return false; }
      this.applyExpected(def);
      this.missions[aid] = { id: aid, title: def.title, state: 'active' };
      this.activeId = aid; this.def = def;
      const sid = m.schritt && def.steps.some((s) => s.id === m.schritt) ? m.schritt : def.steps[0].id;
      if (m.schritt && sid !== m.schritt) g.countError('mission-restore', new Error(`${aid}: Schritt ${m.schritt} unbekannt`));
      const st = def.steps.find((s) => s.id === sid);
      const resume = st && st.wiederaufnahme && def.steps.some((s) => s.id === st.wiederaufnahme.ab) ? st.wiederaufnahme : null;
      const target = resume ? resume.ab : sid;
      // B1 F13: Schlüssel je Schritt; alte Stände ohne schritt gelten für jeden Schritt mit dieser Ziel-ID (wie bisher)
      for (const z of this.doneLog[aid] || []) {
        const sids = z.schritt ? [z.schritt] : def.steps.filter((s) => (s.objectives || []).some((o) => o.id === z.id)).map((s) => s.id);
        for (const s of sids) this.done.add(aid + ':' + s + ':' + z.id);
      }
      for (const sidB of Array.isArray(m.betreten) ? m.betreten : []) this.entered.add(aid + ':' + sidB);
      const tStep = def.steps.find((s) => s.id === target);
      this.setStep(target, { dormant: !!(tStep && tStep.loc && g.ship.scene !== tStep.loc) });
      if (target === sid && isObj(m.v)) Object.assign(this.v, m.v);
      for (const e of m.ereignisse || []) this.events.add(e);
      for (const c of m.entscheidungen || []) this.choicesMade.add(c);
      if (typeof m.fund === 'string' && m.fund) this.funde[aid] = fundText(m.fund);   // B1: ohne Feld -> „die Beute“
      if (resume && resume.prep) this.run(resume.prep);
      this.refreshObjectives();
    } else this.refreshObjectives();
    return true;
  }

  // ---------- Kontext für Texte und Weltstand ----------
  withContext(def, write, fn) {
    const pd = this.textDef; const pw = this.writeCtx;
    this.textDef = def || pd; this.writeCtx = write || pw;
    try { return fn(); } finally { this.textDef = pd; this.writeCtx = pw; }
  }
  writeContext() {
    const w = this.writeCtx || {};
    return { mission: w.mission || this.activeId || null, ausgang: w.ausgang || null, schritt: w.ausgang ? null : this.state.stage };
  }
  callWeltstand(method, ...args) {
    const w = this.game.weltstand;
    if (!w || typeof w !== 'object' || typeof w[method] !== 'function') return;
    try { w[method](...args); } catch (e) { this.game.countError('mission-weltstand', e); }
  }
  npcName(id) { return Loader.npcName(id, this.textDef || this.def); }

  // ---------- Bedingungen ----------
  cond(c) {
    if (c == null) return true;
    if (c === true || c === false) return c;
    if (Array.isArray(c)) return c.every((x) => this.cond(x));
    for (const [k, v] of Object.entries(c)) if (!this.atom(k, v)) return false;
    return true;
  }
  atom(k, v) {
    const g = this.game; const ship = g.ship; const ex = g.explore;
    switch (k) {
      case 'all': return v.every((x) => this.cond(x));
      case 'any': return v.some((x) => this.cond(x));
      case 'not': return !this.cond(v);
      case 'atLocation': return ship.scene === v;
      case 'docked': return v === true ? ship.docked : v === false ? !ship.docked : ship.dockedAt === v;
      case 'elapsed': return this.stepTime >= v;
      case 'flag': return typeof v === 'string' ? !!this.flags[v] : Object.entries(v).every(([fk, fv]) => this.flags[fk] === fv);
      case 'v': return typeof v === 'string' ? !!this.v[v] : Object.entries(v).every(([fk, fv]) => this.v[fk] === fv);
      case 'enemiesCleared': return !g.space.enemies.some((e) => v === true || e.tag === v || e.kind === v);
      case 'enemiesLeft': return g.space.enemies.filter((e) => (!v.kind || e.kind === v.kind) && (!v.tag || e.tag === v.tag)).length <= (v.max || 0);
      case 'killed': return (this.kills[v.tag || v.kind] || 0) >= (v.min || 1);
      case 'enemyHpBelow': return g.space.enemies.some((e) => (!v.tag || e.tag === v.tag) && (!v.kind || e.kind === v.kind) && e.hp <= e.hpMax * v.frac);
      case 'scanDone': return g.scans.has(v);
      case 'itemAboard': return v === 'datenkern' ? this.datenkernAboard() : (g.inventory[v] || 0) > 0;
      case 'choiceMade': return this.choicesMade.has(v);
      case 'event': return this.events.has(v);
      case 'known': return ex.isKnown(v);
      case 'visited': return ex.visited.has(v);
      case 'revealed': return ex.isRevealed(v);
      case 'found': return ex.isFound(v);
      case 'dest': return ship.jump.dest === v;
      case 'near': { const s = space.stationPoint(g); return dist(ship.x, ship.y, s.x, s.y) <= v.station; }
      case 'evKind': return !!(this.ev && this.ev.enemy && this.ev.enemy.kind === v);
      case 'missionDone': return !!(this.missions[v] && this.missions[v].state === 'done');
      case 'lobby': {
        const o = g.lobbyOpts || {};
        return typeof v === 'string' ? !!o[v] : isObj(v) && Object.entries(v).every(([lk, lv]) => o[lk] === lv);
      }
      case 'check': {
        const name = typeof v === 'string' ? v : v && v.name;
        const r = Registry.resolve(name, typeof v === 'string' ? {} : v, 'pruefung');
        if (!r) { g.countError('mission-check', new Error('Unbekannte Prüfung ' + name)); return false; }
        return !!r.entry.test(this, r.args);
      }
      default: {
        const r = Registry.resolve(k, typeof v === 'object' && v ? v : { value: v }, 'pruefung');
        if (r) return !!r.entry.test(this, r.args);
        g.countError('mission-cond', new Error('Unbekannte Bedingung ' + k));
        return false;
      }
    }
  }

  // ---------- Aktionen ----------
  run(list) {
    for (const a of [].concat(list || [])) {
      if (!a) continue;
      if (a.if !== undefined && !this.cond(a.if)) continue;
      try { this.act(a); } catch (e) { this.game.countError('mission-action', e); }
      if (a.goto || a.complete) break;   // nach Schrittwechsel keine Restaktionen des alten Schritts
    }
  }
  act(a) {
    const g = this.game;
    if (a.oda) g.oda(this.tpl(a.oda), a.once || null);
    if (a.radio) this.radio(this.npcName(a.radio.from), this.tpl(a.radio.text), !!a.radio.accept);
    if (a.sfx) g.emit('sfx', { name: a.sfx });
    if (a.set) Object.assign(this.v, a.set);
    if (a.setFlag) Object.assign(this.flags, a.setFlag);
    if (typeof a.fund === 'string' && this.activeId) this.funde[this.activeId] = fundText(this.tpl('· ' + a.fund).slice(2));   // B1 F2: {fund}
    if (a.reveal) for (const l of [].concat(a.reveal)) g.explore.reveal(l, typeof a.text === 'string' ? this.tpl(a.text) : a.text);
    if (a.openLink) g.explore.openLink(a.openLink);
    if (a.reward) { const t = g.explore.reward(a.reward); this.lastReward = t || ''; if (a.rewardNotice && t) this.noticeAll('Belohnung: ' + t); }
    if (a.log) g.explore.addLog(this.tpl(a.log), a.loc || g.ship.scene);
    if (a.spawn) this.spawn(a.spawn);
    if (a.spawnSalvage) { space.spawnSalvage(g, a.spawnSalvage); this.v.salvageSpawned = true; g.salvaged = 0; }
    if (a.choice) this.openChoice(a.choice);
    if (a.after) this.later(a.after.sec, a.after.do || [a.after]);
    if (a.startTeaser) g.startTeaser();
    if (a.do) {
      const r = Registry.resolve(a.do, a, 'aktion');
      if (!r) g.countError('mission-hook', new Error('Unbekannte Aktion ' + a.do));
      else aufKarten(g, r.entry, r.args, () => r.entry.run(this, r.args));   // B1 F1: Karte erst registrieren
    }
    if (a.wirkung) this.runEffect(a);
    if (a.complete) { this.completeMission(a.complete); }
    if (a.startMission) this.startMission(a.startMission);
    if (a.chapter) this.chapter(a);   // S2: Kapitelkarte, Spiel läuft weiter
    if (a.end) g.endGame(a.title || a.text ? { title: this.tpl(a.title), text: this.tpl(a.text) } : undefined);
    if (a.goto) this.setStep(a.goto);
  }
  // Wirkung (Gruppe) bzw. Wendung mit Ankündigung: 'vorher' mit vorlauf_s kündigt an und wirkt später;
  // sonst wirkt sie und die Ankündigung folgt im selben Tick (wie die JS-Module: erst Spawn, dann ODA).
  runEffect(a) {
    const an = a.wendung ? a.ankuendigung : null;
    const announce = () => {
      if (!an) return;
      if (an.oda) this.game.oda(this.tpl(an.oda), null);
      if (an.radio && an.radio.text) this.radio(this.npcName(an.radio.from), this.tpl(an.radio.text), false);
    };
    if (an && an.art === 'vorher') {
      announce();
      if (an.vorlauf_s > 0) this.later(an.vorlauf_s, a.wirkung);
      else this.run(a.wirkung);
      return;
    }
    this.run(a.wirkung);
    announce();
  }
  noticeAll(text) { for (const p of this.game.players) this.game.notice(p, text); }

  spawn(s) {
    const g = this.game;
    if (this.step && this.step.loc && g.ship.scene !== this.step.loc) return;   // nur am Ort des Schritts
    const crew = Math.max(1, Math.min(3, g.players.filter((p) => p.connected).length));
    const n = s.crew ? (s.crew[crew] || 1) : (s.n || (s.angles ? s.angles.length : (s.atStation ? s.atStation.length : 1)));
    const st = space.stationPoint(g);
    for (let i = 0; i < n; i++) {
      const opts = { tag: s.tag || null };
      if (s.ziel != null) opts.ziel = s.ziel;   // S2: lerche|schuetzling|auto|<escort-tag> (space.js, SCHUETZLING)
      if (s.angles) opts.angle = s.angles[i % s.angles.length];
      else if (s.behind) opts.angle = g.ship.angle + Math.PI + (n > 1 ? (i ? 0.35 : -0.35) : 0);   // M3a: klar achtern (Hecksektor)
      if (s.atStation) {
        const p = s.atStation[i % s.atStation.length];
        opts.x = st.x + p.dx; opts.y = st.y + p.dy;
        opts.orbitA = Math.atan2(p.dy, p.dx);
        if (s.face === 'out') opts.facing = Math.atan2(p.dy, p.dx);
        else if (s.face === 'in') opts.facing = Math.atan2(-p.dy, -p.dx);   // QA M1: Front zum Relaiskern
      }
      space.spawnEnemy(g, s.kind, opts);
    }
  }

  later(sec, actions) { this.timers.push({ at: this.stepTime + sec, actions: [].concat(actions) }); }

  radio(from, text, needsAccept) {
    this.state.radio = { from, text, needsAccept: !!needsAccept };
    this.game.emit('radio', { from, text });
    this.game.emit('sfx', { name: 'radio' });
  }

  // Textbausteine: '@kennung' (texte des Buchs), {salvaged}, {killed:relay}, {left:pylon}, {found}, {total}, {arena}, {fund} (B1: Aktion fund, sonst „die Beute“),
  // {squadLeft:gruppe}, {objectsInState:objekt:zustand}, {objectsCount:objekt}; Altnamen {awayLeft:x}, {jammersOff};
  // {reward} = Text der zuletzt ausgeführten reward-Aktion (z. B. „60 Marken, Deko: Lamassu-Figur“), sonst leer
  tpl(text, defIn) {
    if (typeof text !== 'string') return text;
    const g = this.game;
    const def = defIn || this.textDef || this.def;
    if (text[0] === '@') text = Loader.text(def, text, (e) => g.countError('mission-text', e));
    if (typeof text === 'string' && text.indexOf('{{') >= 0) text = Lexikon.aufloesen(text, this.lexBauweise(def));   // B1 F2
    const mapOfObject = (o) => {
      const ks = ((def && def.buehne && def.buehne.aussenkarten) || []).concat(Objects.MAP_IDS);
      return ks.find((m) => Objects.declared(m)[o]) || null;
    };
    return Lexikon.satzanfaenge(text.replace(/\{(\w+)(?::(\w+))?(?::(\w+))?\}/g, (all, k, arg, arg2, pos, whole) => {
      if (k === 'fund') return Lexikon.einsetzen(whole.slice(0, pos), (this.activeId && this.funde[this.activeId]) || FUND_NEUTRAL, whole.slice(pos + all.length));   // B1 F2
      if (k === 'salvaged') return String(Math.min(g.C.salvage.count, g.salvaged || 0));
      if (k === 'killed') return String(this.kills[arg] || 0);
      if (k === 'left') return String(g.space.enemies.filter((e) => e.kind === arg || e.tag === arg).length);
      if (k === 'found') return String(g.explore.discoveries().found);
      if (k === 'total') return String(g.explore.discoveries().total);
      if (k === 'squadLeft' || k === 'awayLeft') {
        const grp = def && def.besetzung && def.besetzung.gruppen && def.besetzung.gruppen[arg];
        const aw = g.aways[(grp && grp.map) || 'kesh'];
        return String(aw ? aw.drones.filter((d) => d.alive && d.squad === arg).length : 0);
      }
      if (k === 'objectsInState') { const m = mapOfObject(arg); return String(m ? Objects.countInState(g, m, arg, arg2) : 0); }
      if (k === 'objectsCount') { const m = mapOfObject(arg); return String(m ? Objects.countAll(g, m, arg) : 0); }
      if (k === 'jammersOff') return String(Objects.countInState(g, 'kesh', 'jammer', 'off'));
      if (k === 'arena') return arena().objectiveText(g);
      if (k === 'reward') return this.lastReward || '';
      if (k === 'escortHp') return String(escortHpPct(g, arg));   // S2: Hülle eines Schützlings in % (escort.js)
      return all;
    }));
  }

  // B1 F2: Bauweise für {{lex.*}} – Landepunkt des laufenden Schritts (allowBeam; die Karte, auf der das Außenteam gerade
  // ist, zuerst), sonst die einzige Außenkarte der Bühne; ohne Landepunkt bzw. Handkarte ohne Bauweise: null (neutral)
  lexBauweise(def) {
    const g = this.game;
    let maps = [];
    if (this.step && (!def || def === this.def)) maps = [].concat(this.step.allowBeam || []);
    if (!maps.length) { const ak = (def && def.buehne && def.buehne.aussenkarten) || []; if (ak.length === 1) maps = ak; }
    if (!maps.length) return null;
    const aktiv = maps.find((m) => g.aways && g.aways[m] && g.aways[m].active);
    return Lexikon.bauweiseVon(g, aktiv || maps[0]);
  }

  // ---------- Entscheidungen ----------
  openChoice(id) {
    const c = this.step && this.step.choices && this.step.choices[id];
    if (!c) return;
    this.state.choice = { id, prompt: this.tpl(c.prompt), options: c.options.map((o) => ({ id: o.id, label: this.tpl(o.label), disabled: !!(o.disabledIf && this.cond(o.disabledIf)) })) };
  }
  refreshChoice() {
    const ch = this.state.choice;
    if (!ch) return;
    const c = this.step && this.step.choices && this.step.choices[ch.id];
    if (!c) { this.state.choice = null; return; }
    for (const o of ch.options) { const d = c.options.find((q) => q.id === o.id); o.disabled = !!(d && d.disabledIf && this.cond(d.disabledIf)); }
  }
  choice(option) {
    const ch = this.state.choice;
    if (!ch) return 'Gerade gibt es nichts zu entscheiden.';
    const opt = ch.options.find((o) => o.id === option);
    if (!opt) return 'Unbekannte Option.';
    if (opt.disabled) return 'Nicht genug Marken.';
    const c = this.step.choices[ch.id];
    this.state.choice = null;
    this.choicesMade.add(ch.id);
    this.events.add('choice:' + ch.id);
    this.game.emit('sfx', { name: 'ui_click' });
    this.run((c.on && c.on[option]) || []);
    if (c.after) this.run(c.after);
    return null;
  }

  accept() {
    const r = this.state.radio;
    if (!r || !r.needsAccept) return 'Kein Funkspruch zum Annehmen.';
    return this.doAccept();
  }
  doAccept() {
    if (this.state.radio) this.state.radio.needsAccept = false;
    this.events.add('accepted');
    this.game.emit('sfx', { name: 'ui_click' });
    if (this.step && this.step.onAccept) this.run(this.step.onAccept);
    return null;
  }

  // ---------- Ziele ----------
  refreshObjectives() {
    if (!this.step) {
      this.state.objectives = [{ id: 'explore', text: this.tpl('Frei erkunden – Entdeckungen {found}/{total}'), done: false, optional: true }];
      return;
    }
    const list = [];
    // B1 F13: abgehakt gilt je Schritt (Mission:Schritt:Ziel). Szenenbücher nutzen in jedem Schritt dieselben Ziel-IDs
    // (runter, ziel, hoch) – ohne Schritt im Schlüssel stand das Ziel des neuen Schritts beim Start schon auf done.
    const sid = this.state.stage;
    for (const o of this.step.objectives || []) {
      if (o.show !== undefined && !this.cond(o.show)) continue;
      const key = this.activeId + ':' + sid + ':' + o.id;
      let done = this.done.has(key);
      if (!done && o.done !== undefined && this.cond(o.done)) { done = true; if (o.sticky !== false) this.done.add(key); }
      const text = this.tpl(o.text);
      if (done) this.collectDone(o.id, text, !!o.optional);
      list.push({ id: o.id, text, done, optional: !!o.optional });
    }
    this.state.objectives = list;
  }

  // ---------- §21.2 Missionsbuch: erledigte Ziele sammeln ----------
  // B1 F13: je Schritt (schritt); dasselbe Ziel mit gleichem Text aus einem früheren Schritt steht nur einmal im Buch
  collectDone(id, text, optional) {
    const mid = this.activeId;
    if (!mid) return;
    const list = this.doneLog[mid] || (this.doneLog[mid] = []);
    const schritt = this.state.stage || null;
    if (list.some((x) => x.id === id && ((x.schritt || null) === schritt || x.text === text))) return;
    list.push(schritt ? { id, text, optional, schritt } : { id, text, optional });
  }
  // Vor einem Schrittwechsel bzw. Missionsende: Ziele des alten Schritts ein letztes Mal prüfen (die Bedingung, die den
  // Wechsel auslöst, wurde im laufenden Tick noch nicht abgehakt). Ziele ohne Haken-Bedingung (done: false, z. B.
  // „Rostmeute abwehren“) gelten mit dem Schrittwechsel als erledigt.
  collectStepEnd() {
    if (!this.step || !this.def || !this.def.steps.includes(this.step)) return;
    try { this.refreshObjectives(); } catch (e) { this.game.countError('mission-book', e); return; }
    for (const o of this.state.objectives) {
      if (o.done) continue;
      const d = (this.step.objectives || []).find((x) => x.id === o.id);
      if (d && d.done === false) this.collectDone(o.id, o.text, o.optional);
    }
  }

  // ---------- Update ----------
  update(dt) {
    this.stepTime += dt;
    // missionsunabhängige Zeitpunkte (Kampagne ohne Tutorial: Tesk-Funk)
    if (this.pending.length) {
      for (const t of this.pending.slice()) {
        if (this.game.time < t.at) continue;
        this.pending.splice(this.pending.indexOf(t), 1);
        this.run(t.actions);
      }
    }
    this.globalComments();
    this.checkNewOffers(dt);   // S2: Ereignis offerIn
    if (!this.step) {
      if (this.mode === 'campaign') this.checkOffers();
      if (!this.step) { this.refreshObjectives(); return; }
    }
    if (this.dormant && !this.wakeIfThere()) { this.stepTime = 0; this.dormantNext(); this.refreshObjectives(); return; }
    const stepAtStart = this.step;
    // eingeplante Aktionen
    for (const t of this.timers.slice()) {
      if (this.step !== stepAtStart || !this.step) break;
      if (this.stepTime >= t.at) { this.timers.splice(this.timers.indexOf(t), 1); this.run(t.actions); }
    }
    // Zeitplan des Schritts
    const tl = (this.step && this.step.timers) || [];
    for (let i = 0; i < tl.length && this.step === stepAtStart; i++) {
      if (this.firedTimers.has(i) || this.stepTime < tl[i].at) continue;
      this.firedTimers.add(i);
      if (tl[i].do && tl[i].if !== undefined && !this.cond(tl[i].if)) continue;
      this.run(tl[i].do || [tl[i]]);
    }
    // Regeln (einmalig, sobald die Bedingung gilt)
    const rules = (this.step && this.step.rules) || [];
    for (let i = 0; i < rules.length && this.step === stepAtStart; i++) {
      if (this.firedRules.has(i) || !this.cond(rules[i].if)) continue;
      this.firedRules.add(i);
      this.run(rules[i].do);
    }
    if (this.step === stepAtStart) this.updateScan(dt);
    if (this.step === stepAtStart) this.refreshChoice();
    // Weiter?
    if (this.step && this.step === stepAtStart) {
      for (const n of this.step.next || []) {
        if (!this.cond(n.if)) continue;
        if (n.do) this.run(n.do);
        if (this.step === stepAtStart) {
          if (n.complete) this.completeMission(n.complete);
          else if (n.goto) this.setStep(n.goto);
        }
        break;
      }
    }
    this.refreshObjectives();
  }

  globalComments() {
    const g = this.game; const ship = g.ship;
    if (ship.o2 < 50) g.oda('Sauerstoff unter 50 %! Lebenserhaltung prüfen und Lecks flicken.', 'o2low');
    if (ship.hull < 40) g.oda('Hülle unter 40 %. Ich will nicht drängeln, aber… doch, ich dränge.', 'hulllow');
    if (g.space.enemies.some((e) => e.kind === 'raider' && ['bow', 'port', 'stbd'].some((k) => space.inMountArc(g, k, e.x, e.y)))) {
      g.oda('Jäger im Feuerbogen! Taktik: Ziel mit T, 1 Lanze, 2/3 Batterien, Leertaste alles.', 'raiderInArc');
    }
  }

  // ---------- Captain-Scan (Missionsziel) ----------
  scanTarget() {
    const s = this.step && this.step.scan;
    if (!s || (this.step.loc && this.game.ship.scene !== this.step.loc)) return null;
    const st = space.stationPoint(this.game);
    return { id: s.id, label: this.tpl(s.label), x: st.x, y: st.y, range: s.range, time: s.time, requires: s.requires, blocked: s.blocked ? this.tpl(s.blocked) : s.blocked };
  }
  scan(p, on) {
    const g = this.game; const t = this.scanTarget();
    if (!t || g.scans.has(t.id)) { g.ship.scanning = false; return on ? 'Gerade gibt es nichts zu scannen.' : null; }
    g.ship.scanning = !!on; g.ship.scanAt = g.time;
    if (on) {
      if (t.requires && !this.cond(t.requires)) return t.blocked || 'Scan blockiert.';
      if (dist(g.ship.x, g.ship.y, t.x, t.y) > t.range) return `Zu weit weg für den Scan (max. ${t.range}).`;
    }
    return null;
  }
  updateScan(dt) {
    const g = this.game; const ship = g.ship; const t = this.scanTarget();
    if (!t) return;
    const captain = g.players.some((p) => p.console === 'captain' && p.connected);
    if (ship.scanning && (!captain || g.time - ship.scanAt > g.C.mission.scanHoldTimeout + 1)) ship.scanning = false;
    if (g.scans.has(t.id)) { ship.scan.done = true; ship.scan.progress = 1; return; }
    const ok = (!t.requires || this.cond(t.requires)) && dist(ship.x, ship.y, t.x, t.y) <= t.range;
    if (ship.scanning && ok) {
      ship.scan.progress = Math.min(1, ship.scan.progress + dt / t.time);
      if (ship.scan.progress >= 1) {
        ship.scan.done = true; ship.scanning = false;
        g.scans.add(t.id);
        g.emit('sfx', { name: 'scan_done' });
        this.onEvent('scanned', { id: t.id });
      }
    }
  }

  // ---------- Ereignisse ----------
  onEvent(name, data) {
    const g = this.game;
    this.events.add(name);
    if (name === 'enemyKilled' && data.enemy) {
      this.kills[data.enemy.kind] = (this.kills[data.enemy.kind] || 0) + 1;
      if (data.enemy.tag && data.enemy.tag !== data.enemy.kind) this.kills[data.enemy.tag] = (this.kills[data.enemy.tag] || 0) + 1;
    }
    if (name === 'bought') this.events.add('bought');
    // Schritte mit restartOnReturn beginnen neu, wenn man ihren Ort verlassen hat und zurückkehrt (z. B. Relais)
    if (name === 'jumped' && this.step && this.step.loc) {
      if (data.from === this.step.loc) this.v._left = true;
      else if (data.loc === this.step.loc && this.v._left && this.step.restartOnReturn) { this.setStep(this.step.id); g.oda('Zurück am Einsatzort – alles wie vorher. Na ja, fast.', null); return; }
    }
    // Daten-Handler: Schritt, dann Mission
    this.ev = data;
    try {
      if (this.step && !this.dormant && this.step.on && this.step.on[name]) this.run(this.step.on[name]);
      if (this.def && this.def.on && this.def.on[name]) this.run(this.def.on[name]);
      else if (!this.def) {
        // keine Mission aktiv (zwischen Missionen, frei fliegend): Handler der zuletzt erledigten Mission
        const last = this.lastDoneDef();
        if (last && last.on && last.on[name]) this.withContext(last, { mission: last.id }, () => this.run(last.on[name]));
      }
      // Nebenaufträge aus Daten dürfen eigene Handler haben (immer, solange sichtbar)
      for (const sid of catalog().sides) {
        const sd = this.defFor(sid);
        if (sd && sd.on && sd.on[name]) this.withContext(sd, { mission: sid }, () => this.run(sd.on[name]));
      }
    } finally { this.ev = null; }
    // allgemeine ODA-Kommentare
    switch (name) {
      case 'consoleEnter': if (CONSOLE_HELP[data.kind]) g.oda(CONSOLE_HELP[data.kind], 'console_' + data.kind); break;
      case 'undocked': g.oda('Abgelegt! Sanft wie eine Feder. Eine ziemlich schwere Feder.', 'undocked'); break;
      case 'docked': if (data.loc === 'vaelen') g.oda('Angedockt bei der Karawane! Das Hafenterminal in der Messe (Privatdeck) zeigt jetzt das Vaelen-Sortiment.', 'dockVaelen'); break;
      case 'jumpReady': g.oda('Faltsprung bereit – Steuer: F drücken!', 'jumpReady_' + (this.state.stage || 'free') + '_' + g.ship.scene); break;
      case 'asteroid': g.oda('Autsch. Der Brocken hatte Vorfahrt.', 'asteroid'); break;
      case 'salvage': g.oda('Bergungsgut an Bord: ' + data.what + '. ' + (data.n >= g.C.salvage.count ? 'Das war alles!' : 'Weiter, da treibt noch mehr.'), null); break;
      case 'fire': g.oda('Feuer an Bord! Löschgel aus dem Lager holen und E halten. Die Bots helfen auch.', 'firstFire'); break;
      case 'breach': g.oda('Hüllenbruch! Er zieht – Flickblech holen, E halten 3 s. Sonst: Bots.', 'firstBreach'); break;
      case 'systemDamaged':
        // M3a §8.1: drei Reparaturwege
        if (data.state === 'broken') g.oda(`${cap(interior.sysNameNom(data.system))} ist zerstört! E halten: flicken (hält nicht) · R: reparieren · mit Ersatzteil: voll.`, 'firstBroken');
        else g.oda('Ein System ist beschädigt – E halten: flicken (schnell, hält nicht) · R: reparieren · mit Ersatzteil: voll.', 'firstDamaged');
        break;
      case 'shieldDown': g.oda('Schildsektor leer! Captain: Punkte umverteilen oder mehr Energie auf Schilde.', 'shieldDown'); break;
      case 'repaired':
        if (this.isDrillStep() && data.system === g.C.drill.system && g.ship.systems[data.system] === 'damaged') g.oda('Teil sitzt! Jetzt ist er nur noch beschädigt – noch einmal E halten, dann läuft er wieder.', 'drillHalf');
        if (data.by === 'bot') g.oda('Ein Schrauber hat repariert. Ich bin stolz auf die Kleinen.', 'botRepair');
        break;
      case 'fireOut': if (data.by === 'bot') g.oda('Feuer gelöscht – von einem Bot mit eingebautem Löscher. Fleißig!', 'botFire'); break;
      case 'enemyKilled':
        if (data.enemy.kind === 'raider' || data.enemy.kind === 'gunboat') g.oda(data.enemy.kind === 'gunboat' ? 'Kanonenboot zerlegt! Das gibt ordentlich Bergungsmarken.' : 'Jäger erledigt! +20 Marken Bergegut.', 'kill_' + data.enemy.kind);
        if (data.enemy.kind === 'pylon') g.oda('Pylon fällt! Seitlich anfliegen wirkt also. Notiert.', 'kill_pylon');
        break;
      case 'enemyShieldHit': if (data.enemy.kind === 'pylon') g.oda('Treffer auf den Frontschild des Pylons – verpufft. Pilot: an die Seite!', 'pylonFront'); break;
      case 'droneKilled': g.oda(data.kind === 'scavenger' ? 'Plünderer erledigt. Der hatte eh nur Schrott in den Taschen.' : 'Drohne erledigt. Die Kustoden bauen solide – aber nicht solide genug.', 'droneKill_' + data.kind); break;
      case 'beamedDown':
        if (data.map === 'kesh') {
          g.oda('Kesh, Landezone. Klick/Leertaste: Blaster. Deckung neben Mauerresten, Schild lädt in Ruhe nach.', 'keshDown');
          break;
        }
        if (data.map === 'wreck') { g.oda('Willkommen an Bord der „Zaunkönig“. Container: E halten. Vorsicht, Plünderer!', 'wreckDown'); break; }
        // B1 (OFFEN-STUDIO): Tutorial-Begrüßung nur auf B-7 selbst, nie auf gebauten Karten (Landepunkte aus awayMap)
        if (data.map && data.map !== 'platform') break;
        g.oda('Willkommen auf B-7! Leertaste/Klick: Blaster. Q: Markierung für Hilfe von oben.', 'beamDown1');
        g.oda('Die Sonde unten links steuert die Drohnen. Den Code sieht man an der Captain-Konsole.', 'beamDown2');
        break;
      case 'overload': g.oda('Tipp: Nach der Überladung braucht der Neustart zwei Hände – oder eine Hand und einen Schrauber.', 'overloadTip'); break;
      case 'systemOffline': break;
      default: break;
    }
  }

  lastDoneDef() {
    let best = null; let bestEnd = -Infinity;
    for (const id of this.allIds()) {
      const ms = this.missions[id];
      if (!ms || ms.state !== 'done') continue;
      const end = (this.game.stats.missions[id] && this.game.stats.missions[id].end) || 0;
      if (end >= bestEnd) { bestEnd = end; best = id; }
    }
    return best ? this.defFor(best) : null;
  }

  // ---------- Regeln für Sprung / Beamen ----------
  jumpBlocked(dest) {
    if (!this.step || !this.step.jumpBlock || this.dormant) return null;
    for (const b of this.step.jumpBlock) {
      if (b.dest && b.dest !== dest) continue;
      if (this.cond(b.if)) return this.tpl(b.reason);
    }
    return null;
  }
  destBlocked(dest) {
    if (!this.step || !this.step.destBlock || this.dormant) return null;
    for (const b of this.step.destBlock) {
      if (b.dest && b.dest !== dest) continue;
      if (this.cond(b.if)) return this.tpl(b.reason);
    }
    return null;
  }
  // Kartenregel (objects.js BEAM_RULES) bzw. allowBeam des Schritts – keine Missionssonderlogik
  beamDownBlocked(map) {
    const rule = Objects.BEAM_RULES[map];
    if (!rule || !rule.nurMitAllowBeam) return null;   // Wrack, Kesh: jederzeit
    if (this.step && (this.step.allowBeam || []).includes(map)) return null;
    const usesMap = (d) => !!(d && ((d.buehne && (d.buehne.aussenkarten || []).includes(map)) || (d.steps || []).some((s) => (s.allowBeam || []).includes(map))));
    const doneWithMap = Object.values(this.missions).some((ms) => ms.state === 'done' && usesMap(this.defFor(ms.id)));
    if (doneWithMap) return rule.erledigt;
    if (this.def && this.step) {
      const steps = this.def.steps;
      const k = steps.findIndex((s) => (s.allowBeam || []).includes(map));
      if (k >= 0 && steps.indexOf(this.step) > k) return rule.erledigt;
    }
    return rule.vorher;
  }

  // ---------- Hilfen ----------
  isDrillStep() { return !!(this.step && this.step.drill); }
  isDrill() { return this.isDrillStep() && !this.v.skip; }
  drillDone() {
    if (!this.isDrillStep()) return true;
    const g = this.game;
    return g.ship.fireList.length === 0 && g.ship.breachList.length === 0 && g.ship.systems[g.C.drill.system] === 'ok';
  }
  datenkernAboard() {
    const g = this.game;
    return g.players.some((p) => p.zone === 'ship' && p.carry === 'datenkern') || g.ship.groundItems.some((i) => i.kind === 'datenkern');
  }

  listen() {
    const g = this.game; const t = this.state.teaser;
    if (g.phase !== 'end') return 'Kein neuer Funkspruch.';
    if (!t || t.status !== 'ready') return 'Der Funkspruch kommt noch rein … einen Moment.';
    this.radio(t.from, `${t.title}: ${t.briefing} (Belohnung: ${t.reward} Marken)`);
    g.oda(`Quelle: ${t.source === 'claude' ? 'frisch generiert' : 'Archiv'}. Das ist ein Ausblick – Fortsetzung folgt!`, 'teaserSource');
    return null;
  }

  // ---------- Snapshot ----------
  snapshotList() {
    return this.allIds().filter((id) => this.missions[id]).map((id) => ({ id, title: this.missions[id].title, state: this.missions[id].state }));
  }

  // ---------- §21.2 Missionsbuch ----------
  // Angebot offen: erster Schritt mit onAccept, noch nicht angenommen, Funk mit needsAccept bzw. v.offer (m2/m3).
  offerPending() {
    const s = this.step;
    if (!s || !this.def || s !== this.def.steps[0] || !s.onAccept || this.events.has('accepted')) return false;
    return !!((this.state.radio && this.state.radio.needsAccept) || this.v.offer);
  }
  // Vor dem Angebot kennt die Crew die Mission noch nicht – außer der Schritt zeigt schon Pflichtziele (Hafen-Übung).
  preOffer() {
    const s = this.step;
    if (!s || !this.def || s !== this.def.steps[0] || !s.onAccept || this.events.has('accepted')) return false;
    return !this.state.objectives.some((o) => !o.optional);
  }
  entryLog(id) {
    const out = [];
    const log = this.game.explore.log;
    for (let i = log.length - 1; i >= 0 && out.length < BOOK_LOG_MAX; i--) {
      const e = log[i];
      if (e.mission === id) out.push({ t: e.t || 0, loc: e.loc || null, text: e.text.length > BOOK_TEXT_MAX ? e.text.slice(0, BOOK_TEXT_MAX - 1) + '…' : e.text });
    }
    return out.reverse();
  }
  // Auftraggeber, Briefing, Belohnung eines Eintrags (Buch: buch.von mit Bedingung; Altmodul: book.from als Funktion)
  bookInfo(def) {
    if (def.isBook) {
      const b = def.buch || {};
      const von = (b.von || []).find((x) => x.if === undefined || this.cond(x.if));
      return { from: von ? Loader.npcName(von.npc, def) : null, briefing: this.tpl(b.briefing, def) || '', reward: this.tpl(b.belohnung, def) || '' };
    }
    const b = def.book || {};
    const val = (x) => (typeof x === 'function' ? x(this) : x);
    return { from: val(b.from) || null, briefing: val(b.briefing) || '', reward: val(b.reward) || '' };
  }
  // Nebenauftrag aus Daten (kopf.art 'nebenauftrag'): sichtbar ab buch.sichtbar bzw. angebot.nach, Ziele aus buch.ziele
  // bzw. dem ersten Schritt, erledigt nach buch.erledigt bzw. wenn alle Pflichtziele erledigt sind
  sideEntry(def) {
    const b = def.buch || {};
    const vis = b.sichtbar !== undefined ? b.sichtbar : (def.angebot && def.angebot.nach);
    const first = (def.steps || [])[0] || {};
    return this.withContext(def, { mission: def.id }, () => {
      if (vis != null && !this.cond(vis)) return null;
      const ziele = b.ziele || first.objectives || [];
      const objectives = []; let all = true;
      for (const o of ziele) {
        if (o.show !== undefined && !this.cond(o.show)) continue;
        const done = o.done !== undefined && o.done !== false && this.cond(o.done);
        if (!o.optional && !done) all = false;
        objectives.push(objOut(this.tpl(o.text, def), done, !!o.optional));
      }
      const erledigt = b.erledigt !== undefined ? this.cond(b.erledigt) : all;
      const bi = this.bookInfo(def);
      return { id: def.id, title: def.title, from: bi.from, kind: 'nebenauftrag', state: erledigt ? 'erledigt' : 'aktiv', briefing: bi.briefing,
        reward: bi.reward, objectives, log: this.entryLog(def.id), loc: b.ort || first.loc || null };
    });
  }
  // Alle Einträge, die die Crew als Auftrag kennt (Reihenfolge: Missionen, Nebenaufträge, Ausblick, Hinweise)
  bookEntries() {
    const g = this.game; const ex = g.explore; const out = [];
    for (const id of this.allIds()) {
      const ms = this.missions[id];
      if (!ms) continue;
      const def = id === this.activeId && this.def ? this.def : this.defFor(id);
      if (!def) continue;
      const running = id === this.activeId;
      let state = 'aktiv';
      if (ms.state === 'done') state = 'erledigt';
      else if (running && this.offerPending()) state = 'angeboten';
      else if (running && this.preOffer()) continue;
      const done = (this.doneLog[id] || []).map((o) => objOut(o.text, true, o.optional));
      const open = running && this.step ? this.state.objectives.filter((o) => !o.done && !(this.doneLog[id] || []).some((x) => x.id === o.id && (!x.schritt || x.schritt === this.state.stage))).map((o) => objOut(o.text, false, o.optional)) : [];
      const bi = this.bookInfo(def);
      const entry = { id, title: def.title, from: bi.from, kind: 'mission', state, briefing: bi.briefing, reward: bi.reward,
        objectives: done.concat(open), log: this.entryLog(id), loc: running && this.step && this.step.loc ? this.step.loc : null };
      if (g.debug && this.extra[id]) entry.origin = this.extra[id].origin;   // S2: nur Debug
      out.push(entry);
    }
    // S2 §3.1: Angebote des Spielleiters (state 'angeboten', mit von/ziel/dauer_min/belohnung/erinnerung)
    for (const e of this.offerList()) out.push(e);
    // Nebenaufträge aus Daten; Übergang: Sela/Zaunkönig fest, solange es kein Buch mit dieser Kennung gibt
    const sides = catalog().sides;
    for (const id of sides) {
      const def = this.defFor(id);
      if (!def) continue;
      try { const e = this.sideEntry(def); if (e) out.push(e); } catch (err) { g.countError('mission-book', err); }
    }
    const f = this.flags;
    if (!sides.includes('sela') && f.selaCalled) {
      const cfg = g.C.mission.vaelen;
      out.push({ id: 'sela', title: 'Selas Notruf', from: SELA, kind: 'nebenauftrag', state: f.vaelenHelped ? 'erledigt' : 'aktiv',
        briefing: 'Der Reaktor der Vaelen-Karawane hustet. Sie liegt gleich beim Hafen – andocken, unsere Schrauber helfen.',
        reward: rewardText({ marks: cfg.marks, deko: [cfg.deko] }),
        objectives: [objOut('Bei der Vaelen-Karawane andocken', !!f.vaelenHelped)], log: this.entryLog('sela'), loc: 'vaelen' });
    }
    if (!sides.includes('zaunkoenig') && ex.isKnown('wrack')) {
      const aw = g.aways.wreck;
      const boxes = aw.salvage.filter((s) => !s.hidden); const hollow = aw.salvage.find((s) => s.hidden);
      const nBox = boxes.filter((s) => s.done).length;
      const allBoxes = nBox >= boxes.length; const hollowDone = !hollow || hollow.done;
      out.push({ id: 'zaunkoenig', title: 'Wrack „Zaunkönig“', from: TESK, kind: 'nebenauftrag', state: allBoxes && hollowDone ? 'erledigt' : 'aktiv',
        briefing: 'Hinter dem Splittergürtel treibt das Wrack der „Zaunkönig“. Plünderer waren da – aber nicht gründlich. Optional, aber lohnend.',
        reward: 'Bergegut aus Containern und Hohlraum',
        objectives: [objOut('Zum Wrack fliegen', ex.visited.has('wrack')), objOut(`Container bergen (${nBox}/${boxes.length})`, allBoxes),
          objOut('Logbuch der „Zaunkönig“ lesen', !!aw.loreRead, true), objOut('Hohlraum finden (Weitscan) und ausräumen', hollowDone)],
        log: this.entryLog('zaunkoenig'), loc: 'wrack' });
    }
    // Ausblick („Fortsetzung folgt“)
    const t = this.state.teaser;
    if (t && t.status === 'ready') {
      out.push({ id: 'teaser', title: t.title || 'Ausblick', from: t.from || null, kind: 'hinweis', state: 'angeboten', briefing: t.briefing || '',
        reward: t.reward != null ? t.reward + ' Marken' : '', objectives: [objOut('Ausblick – Fortsetzung folgt', false)], log: [], loc: null });
    }
    // Entdeckungen mit Auftragscharakter: per Weitscan aufgedeckt und noch einzusammeln bzw. zu scannen. Eingesammelte
    // stehen nur im Logbuch (kein Auftrag mehr, spart Snapshot). Leitbake = Mission 2, Hohlraum = Zaunkönig.
    for (const l of Locations.LOCATIONS) {
      for (const h of l.hidden) {
        if (h.kind === 'beacon' || h.kind === 'hollow' || !ex.isRevealed(h.id) || ex.isFound(h.id)) continue;
        const how = h.kind === 'cache' ? 'Einsammeln (drüberfliegen)' : 'Scannen (Taktik: T, S halten)';
        out.push({ id: 'h:' + h.id, title: h.name, from: 'Weitscan', kind: 'hinweis', state: 'aktiv',
          briefing: `Entdeckt bei ${l.name}.`, reward: rewardText(h.reward), objectives: [objOut(how, false)], log: [], loc: l.id });
      }
    }
    return out;
  }
  // mission.book = { version, focus, entries } – version steigt nur, wenn sich Inhalt oder Fokus ändern
  bookSnapshot() {
    const entries = fitBook(this.bookEntries(), this.game.C.net.bookBudget || BOOK_BUDGET);
    const b = this.book;
    if (b.focus) { const e = entries.find((x) => x.id === b.focus); if (!e || e.state === 'erledigt') b.focus = null; }
    const key = JSON.stringify([b.focus, entries]);
    if (key !== b.key) { b.key = key; b.version++; }
    this.lastEntries = entries;
    return { version: b.version, focus: b.focus, entries };
  }
  // HUD: Ziele der fokussierten Mission (ohne Fokus bzw. bei Fokus auf die laufende Mission: deren aktuelle Ziele)
  focusSnapshot() {
    const b = this.book;
    const entries = this.lastEntries || this.bookEntries();
    const e = b.focus ? entries.find((x) => x.id === b.focus) : null;
    if (e && e.id !== this.activeId) return { focusId: e.id, focusTitle: e.title, focusObjectives: e.objectives, focusLoc: e.loc };
    const inBook = this.activeId && entries.some((x) => x.id === this.activeId);
    return { focusId: inBook ? this.activeId : null, focusTitle: this.def ? this.def.title : null, focusObjectives: this.state.objectives,
      focusLoc: this.step && this.step.loc ? this.step.loc : null };
  }
  setFocus(id) {
    const b = this.book;
    if (id == null) { b.focus = null; this.game.emit('sfx', { name: 'ui_click' }); return null; }
    const e = this.bookEntries().find((x) => x.id === id);
    if (!e) return 'Unbekannter Eintrag im Missionsbuch.';
    if (e.state === 'erledigt') return 'Schon erledigt – da gibt es nichts mehr zu verfolgen.';
    b.focus = id;
    this.game.emit('sfx', { name: 'ui_click' });
    return null;
  }
  // S2: Angebot des Spielleiters? -> Eintrag aus offerList()
  slOffer(id) { return this.game.spielleiter ? this.offerList().find((x) => x.id === id) || null : null; }
  acceptEntry(id) {
    // S2 (Absprache): Spielleiter-Angebot -> nur spielleiter.accept(id); er startet die Mission selbst (startMission)
    if (this.slOffer(id)) {
      if (this.activeId && this.missions[this.activeId] && this.missions[this.activeId].state !== 'done') return 'Erst die laufende Mission abschließen.';
      const r = this.sl('accept', id);
      if (typeof r === 'string' && r) return r;
      this.game.emit('sfx', { name: 'ui_click' });
      return null;
    }
    const e = this.bookEntries().find((x) => x.id === id);
    if (!e) return 'Unbekannter Eintrag im Missionsbuch.';
    if (id === 'teaser') return 'Nur ein Ausblick – Fortsetzung folgt.';
    if (e.state !== 'angeboten' || id !== this.activeId || !this.offerPending()) return 'Hier gibt es nichts anzunehmen.';
    return this.doAccept();
  }
  // S2 §4: cmd plan.decline – nur Spielleiter-Angebote (ohne Malus; Gedächtnis-Eintrag macht der Spielleiter)
  declineEntry(id) {
    if (!this.slOffer(id)) return this.bookEntries().some((x) => x.id === id) ? 'Das lässt sich nicht ablehnen.' : 'Unbekannter Eintrag im Missionsbuch.';
    const r = this.sl('decline', id);
    if (typeof r === 'string' && r) return r;
    this.game.emit('sfx', { name: 'ui_click' });
    return null;
  }

  // ---------- Debug ----------
  forceStep(missionId, stepId) {
    const g = this.game;
    const def0 = this.activeId === missionId && this.def ? this.def : this.info(missionId) ? this.loadDef(missionId) : null;
    if (!def0) return 'Unbekannte Mission.';
    const step = stepId ? def0.steps.find((s) => s.id === stepId) : def0.steps[0];
    if (!step) return 'Unbekannter Schritt.';
    const clear = Registry.get('debug_clear_incidents');
    if (clear) clear.run(this, {});
    for (const id of this.order) {
      if (id === missionId) break;
      if (!this.missions[id] || this.missions[id].state !== 'done') {
        const d = this.defFor(id);
        this.missions[id] = { id, title: this.info(id).title, state: 'done' };
        g.stats.missions[id] = g.stats.missions[id] || { start: this.playTime(), end: this.playTime() };
        if (d && d.debugDone) this.withContext(d, null, () => this.run(d.debugDone));
      }
    }
    if (this.activeId !== missionId) {
      this.applyExpected(def0);
      this.missions[missionId] = { id: missionId, title: def0.title, state: 'active' };
      this.activeId = missionId; this.def = def0;
      g.stats.missions[missionId] = g.stats.missions[missionId] || { start: this.playTime(), end: null };
    }
    const def = this.def;
    const prep = def.debugPrep && def.debugPrep[step.id];
    if (prep) this.run(prep);
    const portStart = step.loc && def.steps[0] === step && (Locations.get(step.loc) || {}).kind === 'port';
    if (step.loc && g.ship.scene !== step.loc) g.debugGoto(step.loc, !!portStart);
    this.setStep(step.id);
    return null;
  }
  forceStage(stage) {
    for (const id of this.order) { const d = this.defFor(id); if (d && d.steps.some((s) => s.id === stage)) return this.forceStep(id, stage); }
    if (stage === 'end') { if (!this.state.teaser) this.game.startTeaser(); this.game.endGame(); return null; }
    return 'Unbekannte Stage.';
  }
  skip() {
    if (!this.step) return 'Keine aktive Mission.';
    const s = this.step;
    if (s.skip) this.run(s.skip);
    return null;
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Altname: Missionsreihenfolge (berechnet aus angebot). DEFS: Laufzeit-Defs mit Standard-CONFIG (nur lesen).
const MISSION_ORDER = catalog().order.slice();
const DEFS = {};
for (const id of Object.keys(catalog().info)) {
  Object.defineProperty(DEFS, id, { enumerable: true, get() {
    const cat = catalog();
    return cat.books[id] ? Loader.prepare(cat.books[id], require('../../shared/config.js')) : cat.jsModules[id];
  } });
}

module.exports = { Mission, DEFS, MISSION_ORDER, CONSOLE_HELP, Registry, catalog, reloadCatalog };
