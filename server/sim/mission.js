'use strict';
// Missions-Engine (CONTRACT-M1 §9.3): führt Missionen aus Datenobjekten aus (server/missions/*.js).
// Bausteine: Bedingungen (atLocation, enemiesCleared/-Left, scanDone, itemAboard, flag, choiceMade, event, elapsed …)
// und Aktionen (radio, oda, spawn, choice, reveal, reward, setFlag, set, after, goto, complete, startMission, do …).
// Ein Schritt (step) hat: enter, timers, rules, objectives, next, jumpBlock, choices, scan, onAccept, on, allowBeam, skip.
const Physics = require('../../shared/physics.js');
const Locations = require('../../shared/locations.js');
const W = require('../world.js');
const interior = require('./interior.js');
const space = require('./space.js');
const { dist } = require('../util.js');

// arena_space: Pseudo-Mission des Testgeländes (nicht in MISSION_ORDER, keine Missionsliste, kein Ende)
const DEFS = { m1: require('../missions/m1.js'), m2: require('../missions/m2.js'), m3: require('../missions/m3.js'), arena_space: require('../missions/arena.js') };
const MISSION_ORDER = ['m1', 'm2', 'm3'];
let combatMod = null;
const combat = () => combatMod || (combatMod = require('./combat.js'));
let arenaMod = null;
const arena = () => arenaMod || (arenaMod = require('./arena.js'));
const { ITEM_NAMES, DEKO_NAMES } = require('./explore.js');
// §21.2 Missionsbuch
const BOOK_LOG_MAX = 6;   // Log-Einträge je Buch-Eintrag (die jüngsten)
const BOOK_TEXT_MAX = 120;   // Zeichen je Log-Text im Buch (volle Texte im Logbuch)
const TESK = 'Hafenmeisterin Tesk';
const SELA = 'Sela (Vaelen-Händlerin)';
// Größenbudget des Buchs im Snapshot (Bytes JSON). Grundlast im Kesh-Kampf zu dritt ≈ 8 KB, Snapshot muss < 12 KB bleiben.
const BOOK_BUDGET = 3000;
const jsonBytes = (o) => Buffer.byteLength(JSON.stringify(o));
// Kürzt das Buch stufenweise, bis es ins Budget passt. Laufende/angebotene Einträge behalten ihre Ziele immer.
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
const objOut = (text, done, optional) => (optional ? { text, done: !!done, optional: true } : { text, done: !!done });
function rewardText(r) {
  if (!r) return '';
  const parts = [];
  if (r.marks) parts.push(r.marks + ' Marken');
  for (const [k, n] of Object.entries(r.items || {})) parts.push(n + '× ' + (ITEM_NAMES[k] || k));
  for (const d of r.deko || []) parts.push('Deko: ' + (DEKO_NAMES[d] || d));
  return parts.join(', ');
}
const kesh = (m) => m.game.aways.kesh;
const keshTeam = (m) => m.game.players.filter((p) => p.zone === 'away' && m.game.away.map === 'kesh');

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

// ---------- Registrierte Prüfungen (für { check: name, ... }) ----------
const CHECKS = {
  drillDone: (m) => m.drillDone(),
  noFires: (m) => !m.game.ship.fireList.length,
  noBreaches: (m) => !m.game.ship.breachList.length,
  systemOk: (m, a) => m.game.ship.systems[a.system] === 'ok',
  consoleManned: (m, a) => m.game.players.some((p) => p.console === a.console && p.connected),
  salvageDone: (m) => (m.game.salvaged || 0) >= m.game.C.salvage.count || (m.v.salvageSpawned && !m.game.space.salvage.length && m.game.ship.scene === 'splitter'),
  shipX: (m, a) => (a.gt == null || m.game.ship.x > a.gt) && (a.lt == null || m.game.ship.x < a.lt),
  marksBelow: (m, a) => m.game.inventory.marks < a.n,
  anyAway: (m) => m.game.players.some((p) => p.zone === 'away'),
  awayActive: (m) => m.game.aways.platform.active,
  awaySince: (m, a) => m.game.aways.platform.active && m.game.time - m.game.aways.platform.firstBeamAt >= a.sec && m.game.ship.scene === 'b7',
  sondeDisabled: (m) => m.game.aways.platform.sonde.disabled,
  coreRebooted: (m) => m.game.aways.platform.coreRebooted,
  npcRescued: (m) => m.game.aways.platform.npc.rescued,
  npcInjured: (m) => m.game.aways.platform.npc.injured,
  nearInjuredNpc: (m) => { const n = m.game.aways.platform.npc; return n.injured && n.present && m.game.away.map === 'platform' && m.game.players.some((p) => p.zone === 'away' && dist(p.x, p.y, n.x, n.y) < 80); },
  awayComplete: (m) => m.game.aways.platform.active && m.datenkernAboard() && !CHECKS.anyAway(m) && m.game.aways.platform.coreRebooted,
  players: (m, a) => m.game.players.filter((p) => p.connected).length <= (a.max != null ? a.max : 99),
  widescanUsed: (m) => m.events.has('widescan'),
  // ---- M2: Mission 3 „Die Tafel von Kesh“ ----
  keshTeamDown: (m) => keshTeam(m).length > 0,
  squadCleared: (m, a) => !!kesh(m).spawned[a.squad] && !kesh(m).drones.some((d) => d.alive && d.squad === a.squad),
  playerInHall: (m) => keshTeam(m).some((p) => Math.floor(p.x / 32) >= m.game.C.missionM3.hallX),
  jammersAllOff: (m) => kesh(m).jammers.every((j) => j.off),
  vaultOpen: (m) => kesh(m).vault.open,
  tabletTaken: (m) => kesh(m).tablet.taken,
  // QA M2: zählt nur, wer die Tafel geborgen hat (sonst überspringt ein im Hof wartender Kamerad den Wächter-Schritt).
  // Ist der Träger nicht mehr unten (Rückholung, getrennt), reicht jeder Kamerad im Hof.
  tabletInCourtyard: (m) => {
    if ((m.game.inventory.tafel || 0) < 1) return false;
    const team = keshTeam(m); const by = kesh(m).tablet.by;
    const carrierDown = by && team.some((p) => p.id === by);
    return team.some((p) => !p.downed && Math.floor(p.x / 32) <= m.game.C.missionM3.courtyardX && (!carrierDown || p.id === by));
  },
  keshExtracted: (m) => (m.game.inventory.tafel || 0) >= 1 && kesh(m).active && !m.game.players.some((p) => p.zone === 'away'),
};

// ---------- Registrierte Aktionen (für { do: name, ... }) ----------
const HOOKS = {
  drillSetup(m) {
    const g = m.game; const d = g.C.drill;
    if (g.lobbyOpts && g.lobbyOpts.skipDrill) {
      const sk = g.C.drillSkip || { radioAt: 6 };
      m.v.skip = true; m.v.radio = true;
      m.later(3, [{ oda: 'Übung übersprungen – alte Hasen also. Lager oben links, Brücke ganz vorn rechts.' }]);
      m.later(sk.radioAt, [m.def.radioTesk]);
      m.later(sk.radioAt + 22, [{ if: { not: { event: 'accepted' } }, oda: 'Der Funkspruch wartet: Captain-Konsole auf der Brücke, Reiter „Funk“, Enter.' }]);
      return;
    }
    g.odaSeen.add('firstFire'); g.odaSeen.add('firstBreach'); g.odaSeen.add('firstBroken');
    // M3a: Positionen aus dem Schiffslayout (Maps.SHIP_DRILL); CONFIG.drill.fire/breach nur noch Altnamen/Fallback
    const pos = W.Maps.SHIP_DRILL || d;
    interior.addFire(g, pos.fire.x, pos.fire.y);
    interior.addBreach(g, pos.breach.x, pos.breach.y);
    g.ship.systems[d.system] = 'broken';
  },
  clearDrill(m) {
    const g = m.game;
    if (!m.isDrillStep()) return;
    g.ship.fireList = []; g.ship.breachList = []; g.ship.systems[g.C.drill.system] = 'ok';
  },
  guaranteeFire(m) {
    const g = m.game; const region = g.rng.int(4);
    const t = interior.randomRegionFloor(g, region, false);
    interior.addFire(g, t.x, t.y);
    g.emit('hit', { sector: region, shield: false, dmg: 1 });
    g.oda('Ein Streifschuss hat einen Kabelbaum entzündet. Feuer an Bord!', null);
  },
  guaranteeBreach(m, a) {
    const g = m.game; const t = interior.randomRegionFloor(g, a.region != null ? a.region : 3, true);
    interior.addBreach(g, t.x, t.y);
    g.emit('hit', { sector: a.region != null ? a.region : 3, shield: false, dmg: 2 });
    if (a.text) g.oda(a.text, null);
  },
  breakShields(m, a) {
    interior.damageSystem(m.game, 'shields', 'broken');
    m.game.emit('hit', { sector: 1, shield: false, dmg: 2 });
    if (a.text) m.game.oda(a.text, null);
  },
  damage(m, a) { interior.damageSystem(m.game, a.system, a.state); },
  pay(m, a) { m.game.inventory.marks = Math.max(0, m.game.inventory.marks - a.marks); },
  endAway(m) { m.game.aways.platform.active = false; },
  removeDatenkern(m) {
    const g = m.game;
    for (const p of g.players) if (p.carry === 'datenkern') p.carry = null;
    g.ship.groundItems = g.ship.groundItems.filter((i) => i.kind !== 'datenkern');
  },
  putDatenkern(m) {
    const g = m.game;
    if (m.datenkernAboard()) return;
    g.aways.platform.items = g.aways.platform.items.filter((i) => i.kind !== 'datenkern');
    const c = W.tileCenter(W.SHIP_PADS[2].x, W.SHIP_PADS[2].y);
    g.ship.groundItems.push({ id: 'core', kind: 'datenkern', x: c.x, y: c.y });
  },
  spawnGuards(m) {
    const n = m.game.transfer.spawnGuards(m.game);
    if (n) m.game.oda('Uh-oh. Der Neustart hat die Wächter-Routine geweckt: ' + n + ' Drohnen starten neu. Zurück zu den Pads!', null);
  },
  selaCall(m) {
    const g = m.game;
    if (m.flags.selaCalled) return;
    m.flags.selaCalled = true;
    g.explore.reveal('vaelen', false);
    m.radio('Sela (Vaelen-Händlerin)', 'Lerche? Hier Sela, Vaelen-Karawane. Mein Reaktor hustet. Kommt vorbei – wir liegen gleich beim Hafen. Bitte?');
    g.oda('Ein Notruf! Optional: Die Vaelen-Karawane ist jetzt auf der Sternkarte – dort andocken hilft Sela.', null);
  },
  killAll(m) { m.game.space.enemies = []; },
  killKind(m, a) { m.game.space.enemies = m.game.space.enemies.filter((e) => e.kind !== a.kind); },
  markScan(m, a) { m.game.scans.add(a.id); },
  revealHidden(m, a) {
    const ex = m.game.explore; const h = ex.findHidden(a.id);
    if (h && !ex.isRevealed(h.id)) ex.revealHidden(h, true);
  },
  scanHidden(m, a) {
    const ex = m.game.explore; const h = ex.findHidden(a.id);
    if (!h) return;
    if (!ex.isRevealed(h.id)) ex.revealHidden(h, true);
    m.game.scans.add(h.id);
    ex.onHiddenScanned(h);
  },
  beaconHint(m) {
    const g = m.game; const h = g.explore.findHidden('nebel_beacon');
    const a = Math.atan2(h.y - g.ship.y, h.x - g.ship.x);
    const dirs = ['östlich', 'südöstlich', 'südlich', 'südwestlich', 'westlich', 'nordwestlich', 'nördlich', 'nordöstlich'];
    const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    g.oda(`Das Echo kommt von ${dirs[i]} von uns. Hinfliegen und nochmal Weitscan (W)!`, null);
  },
  skipAway(m) {
    const g = m.game; const aw = g.aways.platform;
    aw.active = true; aw.firstBeamAt = aw.firstBeamAt || g.time; aw.coreRebooted = true; aw.sonde.disabled = true; aw.doorOpen = true;
    for (const p of g.players) if (p.zone === 'away') interior.placeOnShipPad(g, p);
    HOOKS.putDatenkern(m);
  },
  debugJump(m, a) { m.game.debugGoto(a.loc); },
  debugDock(m) { m.game.debugGoto('hafen', true); },
  choose(m, a) { if (m.state.choice) m.choice(a.option); },
  acceptNow(m) { if (m.state.radio && m.state.radio.needsAccept) m.accept(); },
  forceRadio(m, a) { m.radio(a.from, a.text, true); },
  // ---- M2: Mission 3 ----
  revealKesh(m, a) {
    const ex = m.game.explore;
    ex.openLink('kesh');
    ex.reveal('kesh', a && a.text !== undefined ? a.text : false);
  },
  spawnSquad(m, a) { combat().spawnSquad(m.game, a.squad, { alert: !!a.alert }); },
  killSquad(m, a) {
    const aw = kesh(m);
    if (!aw.spawned[a.squad]) combat().spawnSquad(m.game, a.squad, {});
    for (const d of aw.drones) if (d.alive && d.squad === a.squad) { d.alive = false; d.aim = null; }
  },
  // QA M2: Das erste abgeschaltete Störrelais schlägt Alarm – Verstärkung kommt durch die Korridore (nur solange das Tor zu ist)
  reliefSquad(m) {
    const aw = kesh(m);
    if (!aw || aw.spawned.relief || aw.vault.open) return;
    const n = combat().spawnSquad(m.game, 'relief', { alert: true });
    if (n) m.game.oda('Das Relais hat Alarm geschlagen – Verstärkung aus dem Camp kommt durch die Gänge!', null);
  },
  wakeWarden(m) { combat().wakeWarden(m.game); },
  openVault(m) { combat().openVault(m.game); },
  takeTablet(m) { combat().takeTablet(m.game, null); },
  m3Reward(m, a) {
    const r = m.game.C.awayCombat.rewards;
    if (a.key === 'warden') {
      if (m.flags.wardenKilled) return;
      m.flags.wardenKilled = true;
      const deko = (m.game.C.deko || []).includes('lamassu_figur') ? ['lamassu_figur'] : [];
      const txt = m.game.explore.reward({ marks: r.warden, deko });
      m.game.oda(`Der Wächter liegt! Er hinterlässt eine kleine Lamassu-Figur. ${txt}.`, null);
      m.game.explore.addLog('Kesh: Kustoden-Wächter ausgeschaltet (' + txt + ').', 'kesh');
      return;
    }
    if (a.key === 'jammer') m.game.explore.reward({ marks: r.jammer });
    if (a.key === 'complete') m.game.explore.reward({ marks: r.complete });
  },
  m3Prep(m, a) {
    const g = m.game; const order = ['courtyard', 'archive', 'tablet', 'warden', 'extract'];
    const n = order.indexOf(a.upTo);
    if (n >= 1) HOOKS.killSquad(m, { squad: 'squad1' });
    if (n >= 2) combat().openVault(g);
    if (n >= 3 && !kesh(m).tablet.taken) combat().takeTablet(g, null);
    if (n >= 4) { combat().wakeWarden(g); HOOKS.killSquad(m, { squad: 'squad2' }); }
  },
  // Testgelände Raumkampf: Debug `skip` räumt die laufende Welle bzw. ruft die nächste sofort
  arenaSkip(m) { arena().skipWave(m.game); },
  // Debug/Skip: alle Außenteam-Spieler hoch (Tafel bleibt im Inventar)
  keshRecallAll(m) {
    const g = m.game;
    const list = g.players.filter((p) => p.zone === 'away');
    list.forEach((p, i) => { interior.placeOnShipPad(g, p, i); p.beamLock = false; });
    if (!(g.inventory.tafel >= 1)) g.inventory.tafel = 1;
    kesh(m).active = true;
  },
};

class Mission {
  constructor(game) {
    this.game = game;
    this.state = { stage: null, objectives: [], radio: null, choice: null, teaser: null,
      flags: { bribed: null, decision: null, technikerRescued: false } };
    this.flags = this.state.flags;
    this.missions = {};          // id -> { id, title, state: 'active'|'done' }
    this.activeId = null; this.def = null; this.step = null;
    this.stepTime = 0; this.v = {}; this.events = new Set(); this.done = new Set();
    this.timers = []; this.firedTimers = new Set(); this.firedRules = new Set();
    this.choicesMade = new Set(); this.kills = {}; this.ev = null;
    this.scanPoint = null;
    // §21.2 Missionsbuch: abgehakte Ziele je Mission (bleiben über Schrittwechsel erhalten), Fokus, Version
    this.doneLog = {};           // missionId -> [{ id, text, optional }]
    this.book = { version: 1, focus: null, key: null };
  }

  get stageTime() { return this.stepTime; }   // Altname (Tests/Tools)

  // ---------- Lebenszyklus ----------
  start() { this.startMission('m1'); }

  // M2: Lobby-Direktstart (CONTRACT-M2 §3.3): frühere Missionen gelten als erledigt, Schiff im Hafen (nicht angedockt),
  // Kesh bekannt, Auftrag kommt sofort als Funk zum Annehmen.
  startDirect(id) {
    const g = this.game;
    if (!DEFS[id]) return this.start();
    for (const mid of MISSION_ORDER) {
      if (mid === id) break;
      this.missions[mid] = { id: mid, title: DEFS[mid].title, state: 'done' };
      g.stats.missions[mid] = { start: this.playTime(), end: this.playTime() };
      if (DEFS[mid].debugDone) this.run(DEFS[mid].debugDone);
    }
    this.flags.m3Direct = true;
    space.enterScene(g, 'hafen', { docked: false });
    if (id === 'm3') HOOKS.revealKesh(this, { text: false });
    this.startMission(id);
  }

  startMission(id) {
    const def = DEFS[id];
    if (!def) return;
    this.missions[id] = { id, title: def.title, state: 'active' };
    this.activeId = id; this.def = def;
    const st = this.game.stats;
    st.missions[id] = { start: this.playTime(), end: null };
    this.game.emit('missionStart', { id, title: def.title });
    this.setStep(def.steps[0].id);
  }

  completeMission() {
    const id = this.activeId; const def = this.def;
    if (!id) return;
    this.collectStepEnd();
    this.missions[id].state = 'done';
    this.game.stats.missions[id].end = this.playTime();
    this.game.emit('missionDone', { id, title: def.title });
    this.game.log(`Mission ${id} abgeschlossen nach ${Math.round(this.game.stats.missions[id].end - this.game.stats.missions[id].start)} s.`);
    this.activeId = null; this.def = null; this.step = null; this.state.stage = null; this.state.choice = null;
    this.refreshObjectives();
    if (def.onComplete) this.run(def.onComplete);
  }

  playTime() { return Math.round((this.game.time - this.game.stats.playTimeStart) * 10) / 10; }

  setStep(id) {
    const g = this.game;
    const step = this.def.steps.find((s) => s.id === id);
    if (!step) { g.countError('mission-step', new Error('Unbekannter Schritt ' + id)); return; }
    this.collectStepEnd();
    this.step = step; this.state.stage = id;
    this.stepTime = 0; this.v = {}; this.events = new Set(); this.timers = []; this.firedTimers = new Set(); this.firedRules = new Set();
    this.kills = {}; this.state.choice = null; this.scanPoint = null;
    g.ship.scan.progress = 0; g.ship.scan.done = false; g.ship.scanning = false;
    g.stats.stages[id] = this.playTime();
    g.emit('stage', { stage: id, mission: this.activeId });
    if (step.enter) this.run(step.enter);
    this.refreshObjectives();
  }

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
      case 'itemAboard': return v === 'datenkern' ? this.datenkernAboard() : false;
      case 'choiceMade': return this.choicesMade.has(v);
      case 'event': return this.events.has(v);
      case 'known': return ex.isKnown(v);
      case 'visited': return ex.visited.has(v);
      case 'revealed': return ex.isRevealed(v);
      case 'found': return ex.isFound(v);
      case 'dest': return ship.jump.dest === v;
      case 'near': { const s = space.stationPoint(g); return dist(ship.x, ship.y, s.x, s.y) <= v.station; }
      case 'evKind': return !!(this.ev && this.ev.enemy && this.ev.enemy.kind === v);
      case 'check': {
        const name = typeof v === 'string' ? v : v.name;
        const fn = CHECKS[name];
        if (!fn) { g.countError('mission-check', new Error('Unbekannte Prüfung ' + name)); return false; }
        return !!fn(this, typeof v === 'string' ? {} : v);
      }
      default:
        if (CHECKS[k]) return !!CHECKS[k](this, typeof v === 'object' ? v : { value: v });
        g.countError('mission-cond', new Error('Unbekannte Bedingung ' + k));
        return false;
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
    if (a.radio) this.radio(a.radio.from, this.tpl(a.radio.text), !!a.radio.accept);
    if (a.sfx) g.emit('sfx', { name: a.sfx });
    if (a.set) Object.assign(this.v, a.set);
    if (a.setFlag) Object.assign(this.flags, a.setFlag);
    if (a.reveal) for (const l of [].concat(a.reveal)) g.explore.reveal(l, a.text);
    if (a.openLink) g.explore.openLink(a.openLink);
    if (a.reward) { const t = g.explore.reward(a.reward); if (a.rewardNotice && t) this.noticeAll('Belohnung: ' + t); }
    if (a.log) g.explore.addLog(this.tpl(a.log), a.loc || g.ship.scene);
    if (a.spawn) this.spawn(a.spawn);
    if (a.spawnSalvage) { space.spawnSalvage(g, a.spawnSalvage); this.v.salvageSpawned = true; g.salvaged = 0; }
    if (a.choice) this.openChoice(a.choice);
    if (a.after) this.later(a.after.sec, a.after.do || [a.after]);
    if (a.startTeaser) g.startTeaser();
    if (a.do) {
      const fn = HOOKS[a.do];
      if (!fn) g.countError('mission-hook', new Error('Unbekannte Aktion ' + a.do));
      else fn(this, a);
    }
    if (a.complete) { this.completeMission(); }
    if (a.startMission) this.startMission(a.startMission);
    if (a.end) g.endGame(a.title || a.text ? { title: a.title, text: a.text } : undefined);
    if (a.goto) this.setStep(a.goto);
  }
  noticeAll(text) { for (const p of this.game.players) this.game.notice(p, text); }

  spawn(s) {
    const g = this.game;
    if (this.step && this.step.loc && g.ship.scene !== this.step.loc) return;   // nur am Ort des Schritts
    const crew = Math.max(1, Math.min(3, g.players.filter((p) => p.connected).length));
    let n = s.crew ? (s.crew[crew] || 1) : (s.n || (s.angles ? s.angles.length : (s.atStation ? s.atStation.length : 1)));
    const st = space.stationPoint(g);
    for (let i = 0; i < n; i++) {
      const opts = { tag: s.tag || null };
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

  // Textbausteine: {salvaged}, {killed:relay}, {left:pylon}, {found}, {total}
  tpl(text) {
    if (typeof text !== 'string') return text;
    const g = this.game;
    return text.replace(/\{(\w+)(?::(\w+))?\}/g, (all, k, arg) => {
      if (k === 'salvaged') return String(Math.min(g.C.salvage.count, g.salvaged || 0));
      if (k === 'killed') return String(this.kills[arg] || 0);
      if (k === 'left') return String(g.space.enemies.filter((e) => e.kind === arg || e.tag === arg).length);
      if (k === 'found') return String(g.explore.discoveries().found);
      if (k === 'total') return String(g.explore.discoveries().total);
      if (k === 'awayLeft') return String(g.aways.kesh.drones.filter((d) => d.alive && d.squad === arg).length);
      if (k === 'jammersOff') return String(g.aways.kesh.jammers.filter((j) => j.off).length);
      if (k === 'arena') return arena().objectiveText(g);
      return all;
    });
  }

  // ---------- Entscheidungen ----------
  openChoice(id) {
    const c = this.step && this.step.choices && this.step.choices[id];
    if (!c) return;
    this.state.choice = { id, prompt: c.prompt, options: c.options.map((o) => ({ id: o.id, label: this.tpl(o.label), disabled: !!(o.disabledIf && this.cond(o.disabledIf)) })) };
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
    for (const o of this.step.objectives || []) {
      if (o.show !== undefined && !this.cond(o.show)) continue;
      let done = this.done.has(this.activeId + ':' + o.id);
      if (!done && o.done !== undefined && this.cond(o.done)) { done = true; if (o.sticky !== false) this.done.add(this.activeId + ':' + o.id); }
      const text = this.tpl(o.text);
      if (done) this.collectDone(o.id, text, !!o.optional);
      list.push({ id: o.id, text, done, optional: !!o.optional });
    }
    this.state.objectives = list;
  }

  // ---------- §21.2 Missionsbuch: erledigte Ziele sammeln ----------
  collectDone(id, text, optional) {
    const mid = this.activeId;
    if (!mid) return;
    const list = this.doneLog[mid] || (this.doneLog[mid] = []);
    if (!list.some((x) => x.id === id)) list.push({ id, text, optional });
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
    this.globalComments();
    if (!this.step) { this.refreshObjectives(); return; }
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
          if (n.complete) this.completeMission();
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
    return { id: s.id, label: s.label, x: st.x, y: st.y, range: s.range, time: s.time, requires: s.requires, blocked: s.blocked };
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
      if (this.step && this.step.on && this.step.on[name]) this.run(this.step.on[name]);
      if (this.def && this.def.on && this.def.on[name]) this.run(this.def.on[name]);
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
        g.oda('Willkommen auf B-7! Leertaste/Klick: Blaster. Q: Markierung für Hilfe von oben.', 'beamDown1');
        g.oda('Die Sonde unten links steuert die Drohnen. Den Code sieht man an der Captain-Konsole.', 'beamDown2');
        break;
      case 'overload': g.oda('Tipp: Nach der Überladung braucht der Neustart zwei Hände – oder eine Hand und einen Schrauber.', 'overloadTip'); break;
      case 'systemOffline': break;
      default: break;
    }
  }

  // ---------- Regeln für Sprung / Beamen ----------
  jumpBlocked(dest) {
    if (!this.step || !this.step.jumpBlock) return null;
    for (const b of this.step.jumpBlock) {
      if (b.dest && b.dest !== dest) continue;
      if (this.cond(b.if)) return b.reason;
    }
    return null;
  }
  destBlocked(dest) {
    if (!this.step || !this.step.destBlock) return null;
    for (const b of this.step.destBlock) {
      if (b.dest && b.dest !== dest) continue;
      if (this.cond(b.if)) return b.reason;
    }
    return null;
  }
  beamDownBlocked(map) {
    if (map !== 'platform') return null;   // Wrack: jederzeit (Erkunden)
    if (this.step && (this.step.allowBeam || []).includes(map)) return null;
    const m1 = this.missions.m1;
    if (m1 && m1.state === 'done') return 'Auf der Plattform gibt es nichts mehr zu tun.';
    if (this.activeId === 'm1' && this.def.steps.findIndex((s) => s.id === this.state.stage) > this.def.steps.findIndex((s) => s.id === 'away')) return 'Auf der Plattform gibt es nichts mehr zu tun.';
    return 'Erst die Boje scannen.';
  }

  // ---------- Hilfen ----------
  isDrillStep() { return this.activeId === 'm1' && this.state.stage === 'dock'; }
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
    return MISSION_ORDER.filter((id) => this.missions[id]).map((id) => ({ id, title: this.missions[id].title, state: this.missions[id].state }));
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
  // Alle Einträge, die die Crew als Auftrag kennt (Reihenfolge: Missionen, Nebenaufträge, Ausblick, Hinweise)
  bookEntries() {
    const g = this.game; const ex = g.explore; const out = [];
    const val = (x) => (typeof x === 'function' ? x(this) : x);
    for (const id of MISSION_ORDER) {
      const ms = this.missions[id];
      if (!ms) continue;
      const def = DEFS[id]; const b = def.book || {};
      const running = id === this.activeId;
      let state = 'aktiv';
      if (ms.state === 'done') state = 'erledigt';
      else if (running && this.offerPending()) state = 'angeboten';
      else if (running && this.preOffer()) continue;
      const done = (this.doneLog[id] || []).map((o) => objOut(o.text, true, o.optional));
      const open = running && this.step ? this.state.objectives.filter((o) => !o.done && !(this.doneLog[id] || []).some((x) => x.id === o.id)).map((o) => objOut(o.text, false, o.optional)) : [];
      out.push({ id, title: def.title, from: val(b.from) || null, kind: 'mission', state, briefing: val(b.briefing) || '', reward: val(b.reward) || '',
        objectives: done.concat(open), log: this.entryLog(id), loc: running && this.step && this.step.loc ? this.step.loc : null });
    }
    // Nebenauftrag: Selas Notruf (Mission 1, optional)
    const f = this.flags;
    if (f.selaCalled) {
      const cfg = g.C.mission.vaelen;
      out.push({ id: 'sela', title: 'Selas Notruf', from: SELA, kind: 'nebenauftrag', state: f.vaelenHelped ? 'erledigt' : 'aktiv',
        briefing: 'Der Reaktor der Vaelen-Karawane hustet. Sie liegt gleich beim Hafen – andocken, unsere Schrauber helfen.',
        reward: rewardText({ marks: cfg.marks, deko: [cfg.deko] }),
        objectives: [objOut('Bei der Vaelen-Karawane andocken', !!f.vaelenHelped)], log: this.entryLog('sela'), loc: 'vaelen' });
    }
    // Nebenauftrag: Wrack „Zaunkönig“ (Gerücht von Tesk bzw. selbst entdeckt)
    if (ex.isKnown('wrack')) {
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
  acceptEntry(id) {
    const e = this.bookEntries().find((x) => x.id === id);
    if (!e) return 'Unbekannter Eintrag im Missionsbuch.';
    if (id === 'teaser') return 'Nur ein Ausblick – Fortsetzung folgt.';
    if (e.state !== 'angeboten' || id !== this.activeId || !this.offerPending()) return 'Hier gibt es nichts anzunehmen.';
    return this.doAccept();
  }

  // ---------- Debug ----------
  forceStep(missionId, stepId) {
    const g = this.game;
    const def = DEFS[missionId];
    if (!def) return 'Unbekannte Mission.';
    const step = stepId ? def.steps.find((s) => s.id === stepId) : def.steps[0];
    if (!step) return 'Unbekannter Schritt.';
    HOOKS.clearDrill(this);
    for (const id of MISSION_ORDER) {
      if (id === missionId) break;
      if (!this.missions[id] || this.missions[id].state !== 'done') {
        this.missions[id] = { id, title: DEFS[id].title, state: 'done' };
        g.stats.missions[id] = g.stats.missions[id] || { start: this.playTime(), end: this.playTime() };
        if (DEFS[id].debugDone) this.run(DEFS[id].debugDone);
      }
    }
    if (this.activeId !== missionId) {
      this.missions[missionId] = { id: missionId, title: def.title, state: 'active' };
      this.activeId = missionId; this.def = def;
      g.stats.missions[missionId] = g.stats.missions[missionId] || { start: this.playTime(), end: null };
    }
    const prep = def.debugPrep && def.debugPrep[step.id];
    if (prep) this.run(prep);
    if (step.loc && g.ship.scene !== step.loc) g.debugGoto(step.loc, step.loc === 'hafen' && ['dock', 'briefing'].includes(step.id));
    this.setStep(step.id);
    return null;
  }
  forceStage(stage) {
    for (const id of MISSION_ORDER) if (DEFS[id].steps.some((s) => s.id === stage)) return this.forceStep(id, stage);
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

module.exports = { Mission, DEFS, CHECKS, HOOKS, MISSION_ORDER, CONSOLE_HELP };
