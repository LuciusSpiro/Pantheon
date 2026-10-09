'use strict';
// S1 (CONTRACT-S1 §3.1): Baustein-Registry. Jeder { do: name } und { check: name } eines Regiebuchs läuft hier durch.
//   Registry.define(entry)  entry = { id, art: 'aktion'|'pruefung', beschreibung, params, ereignisse?, effekt?, intern?, run?, test? }
//   Registry.get(id)        -> entry | null
//   Registry.describe()     -> JSON ohne Funktionen (Prüfer, Katalog, Spielleiter)
//   Registry.resolve(name, args, art?) -> { entry, args } | null
// Kennungen in snake_case (content/regiebuch/helfer-inventar.md, bausteine.json). Schwere Module (combat, space, arena,
// interior, world) werden erst beim Aufruf geladen – describe() und der Prüfer laufen ohne Server.
// run/test bekommen die laufende Mission (server/sim/mission.js) und die Parameter des Aufrufs.
const Objects = require('./objects.js');

let mods = {};
const lazy = (name, p) => () => mods[name] || (mods[name] = require(p));
const combat = lazy('combat', '../sim/combat.js');
const interior = lazy('interior', '../sim/interior.js');
const arena = lazy('arena', '../sim/arena.js');
const world = lazy('world', '../world.js');

const ENTRIES = new Map();
const PARAM_TYPES = ['map', 'loc', 'squad', 'unit', 'object', 'area', 'item', 'npc', 'text', 'system', 'number', 'bool', 'string',
  'state', 'mission', 'hidden', 'console', 'option', 'region', 'sector', 'zone', 'ship'];   // S2: ship = Tag aus besetzung.schiffe

function define(entry) {
  if (!entry || !/^[a-z][a-z0-9_]*$/.test(entry.id || '')) throw new Error('Baustein ohne gültige snake_case-Kennung: ' + (entry && entry.id));
  if (entry.art !== 'aktion' && entry.art !== 'pruefung') throw new Error(`Baustein ${entry.id}: art muss aktion|pruefung sein`);
  for (const [n, p] of Object.entries(entry.params || {})) {
    if (!PARAM_TYPES.includes(p.typ)) throw new Error(`Baustein ${entry.id}: Parameter ${n} mit unbekanntem Typ ${p.typ}`);
  }
  const e = Object.assign({ beschreibung: '', params: {}, ereignisse: [], effekt: null, intern: false }, entry);
  ENTRIES.set(e.id, e);
  return e;
}
function get(id) { return ENTRIES.get(id) || null; }
function describe() {
  return [...ENTRIES.values()].map((e) => ({
    id: e.id, art: e.art, beschreibung: e.beschreibung, params: JSON.parse(JSON.stringify(e.params)),
    ereignisse: e.ereignisse.slice(), effekt: e.effekt, intern: !!e.intern,
  }));
}

// ---------- Hilfen ----------
const g_ = (m) => m.game;
const txt = (m, t) => (t == null ? t : m.tpl(t));
function weltstand(m) {
  const w = m.game && m.game.weltstand;
  return w && typeof w === 'object' ? w : null;
}
// Weltstand-Methode defensiv aufrufen: fehlt sie, No-op; wirft sie, zählen
function callWeltstand(m, method, ...args) {
  const w = weltstand(m);
  if (!w || typeof w[method] !== 'function') return;
  try { w[method](...args); } catch (e) { m.game.countError('mission-weltstand', e); }
}
const DIRS = ['östlich', 'südöstlich', 'südlich', 'südwestlich', 'westlich', 'nordwestlich', 'nördlich', 'nordöstlich'];
const awayTeam = (m, map) => Objects.teamOn(m.game, map);

// =================================================================================================================
// Aktionen (generisch)
// =================================================================================================================
define({ id: 'ship_incident', art: 'aktion', effekt: 'schaden', ereignisse: ['fire', 'breach'],
  beschreibung: 'Bordschäden setzen (Feuer, Lecks, System) – z. B. Hafen-Übung. pos: drill = erstes Feuer/Leck an den Übungsplätzen (Maps.SHIP_DRILL), random = zufällig; quiet: ohne ODA-Ersthinweise (Feuer/Leck/zerstört), Standard: im drill-Schritt still.',
  params: { fires: { typ: 'number', min: 0, max: 4 }, breaches: { typ: 'number', min: 0, max: 4 }, system: { typ: 'system' },
    state: { typ: 'string', werte: ['damaged', 'broken'] }, pos: { typ: 'string', werte: ['drill', 'random'] }, quiet: { typ: 'bool' } },
  run(m, a) {
    const g = g_(m); const W = world(); const I = interior();
    const pos = a.pos === 'random' ? {} : (W.Maps.SHIP_DRILL || g.C.drill);
    if (a.quiet !== undefined ? a.quiet : m.isDrillStep()) { g.odaSeen.add('firstFire'); g.odaSeen.add('firstBreach'); g.odaSeen.add('firstBroken'); }
    for (let i = 0; i < (a.fires || 0); i++) {
      const t = i === 0 && pos.fire ? pos.fire : I.randomRegionFloor(g, g.rng.int(4), false);
      I.addFire(g, t.x, t.y);
    }
    for (let i = 0; i < (a.breaches || 0); i++) {
      const t = i === 0 && pos.breach ? pos.breach : I.randomRegionFloor(g, g.rng.int(4), true);
      I.addBreach(g, t.x, t.y);
    }
    if (a.system) g.ship.systems[a.system] = a.state || 'broken';
  } });
define({ id: 'ship_fire', art: 'aktion', effekt: 'schaden', ereignisse: ['fire', 'hit'],
  beschreibung: 'Feuer an Bord in einer Region (0–3 oder zufällig), optional ODA-Text',
  params: { region: { typ: 'region' }, text: { typ: 'text', oda: true } },
  run(m, a) {
    const g = g_(m); const I = interior();
    const region = a.region == null || a.region === 'random' ? g.rng.int(4) : a.region;
    const t = I.randomRegionFloor(g, region, false);
    I.addFire(g, t.x, t.y);
    g.emit('hit', { sector: region, shield: false, dmg: 1 });
    if (a.text) g.oda(txt(m, a.text), null);
  } });
define({ id: 'ship_breach', art: 'aktion', effekt: 'schaden', ereignisse: ['breach', 'hit'],
  beschreibung: 'Hüllenbruch in einer Region (Standard 3 = backbord achtern), optional ODA-Text',
  params: { region: { typ: 'region' }, text: { typ: 'text', oda: true } },
  run(m, a) {
    const g = g_(m); const I = interior();
    const region = a.region == null || a.region === 'random' ? (a.region === 'random' ? g.rng.int(4) : 3) : a.region;
    const t = I.randomRegionFloor(g, region, true);
    I.addBreach(g, t.x, t.y);
    g.emit('hit', { sector: region, shield: false, dmg: 2 });
    if (a.text) g.oda(txt(m, a.text), null);
  } });
define({ id: 'damage_system', art: 'aktion', effekt: 'schaden', ereignisse: ['systemDamaged'],
  beschreibung: 'Schiffssystem beschädigen oder zerstören (optional Treffer in einem Schildsektor + ODA-Text)',
  params: { system: { typ: 'system', pflicht: true }, state: { typ: 'string', werte: ['damaged', 'broken'], pflicht: true },
    hitSector: { typ: 'sector' }, text: { typ: 'text', oda: true } },
  run(m, a) {
    const g = g_(m);
    interior().damageSystem(g, a.system, a.state);
    if (a.hitSector != null) g.emit('hit', { sector: a.hitSector, shield: false, dmg: 2 });
    if (a.text) g.oda(txt(m, a.text), null);
  } });
define({ id: 'pay_marks', art: 'aktion', beschreibung: 'Marken abziehen (Bestechung, Kauf)',
  params: { marks: { typ: 'number', pflicht: true, min: 0 } },
  run(m, a) { const inv = g_(m).inventory; inv.marks = Math.max(0, inv.marks - a.marks); } });
define({ id: 'end_away', art: 'aktion', beschreibung: 'Außenmission auf einer Karte beenden',
  params: { map: { typ: 'map', pflicht: true } },
  run(m, a) { const aw = g_(m).aways[a.map]; if (aw) aw.active = false; } });
define({ id: 'remove_item', art: 'aktion', beschreibung: 'Gegenstand aus Schiff/Inventar entfernen (Datenkern: getragen und abgelegt; sonst Lager/Inventar, n Stück oder alle)',
  params: { item: { typ: 'item', pflicht: true }, n: { typ: 'number', min: 1 } },
  run(m, a) {
    const g = g_(m);
    if (a.item === 'datenkern') {
      for (const p of g.players) if (p.carry === 'datenkern') p.carry = null;
      g.ship.groundItems = g.ship.groundItems.filter((i) => i.kind !== 'datenkern');
      return;
    }
    const have = g.inventory[a.item] || 0;
    if (typeof have === 'number') g.inventory[a.item] = Math.max(0, have - (a.n != null ? a.n : have));
  } });
define({ id: 'activate_away_group', art: 'aktion', effekt: 'gegner',
  beschreibung: 'Ruhende Gruppe auf einer Außenkarte aktivieren ({n} im Text = Anzahl)',
  params: { map: { typ: 'map', pflicht: true }, group: { typ: 'squad', pflicht: true }, text: { typ: 'text', oda: true } },
  run(m, a) {
    const g = g_(m);
    let n = 0;
    if (a.map === 'platform') n = g.transfer.spawnGuards(g);
    else n = combat().spawnSquad(g, a.group, { alert: true }) || 0;
    if (n && a.text) g.oda(String(txt(m, a.text)).replace(/\{n\}/g, String(n)), null);
  } });
define({ id: 'reveal_find', art: 'aktion', beschreibung: 'Versteckten Fund aufdecken (wie Weitscan)',
  params: { id: { typ: 'hidden', pflicht: true } },
  run(m, a) { const ex = g_(m).explore; const h = ex.findHidden(a.id); if (h && !ex.isRevealed(h.id)) ex.revealHidden(h, true); } });
define({ id: 'complete_find', art: 'aktion', beschreibung: 'Fund als gescannt/eingesammelt werten (Garantie bei Stillstand)',
  params: { id: { typ: 'hidden', pflicht: true } },
  run(m, a) {
    const g = g_(m); const ex = g.explore; const h = ex.findHidden(a.id);
    if (!h) return;
    if (!ex.isRevealed(h.id)) ex.revealHidden(h, true);
    // Versteck (cache) wird nicht gescannt, sondern eingesammelt – Scan allein setzt 'found' nie (sonst Softlock)
    if (h.kind === 'cache') { ex.collectCache(h); return; }
    g.scans.add(h.id);
    ex.onHiddenScanned(h);
  } });
define({ id: 'direction_hint', art: 'aktion', beschreibung: 'ODA-Richtungshinweis zu einem Fund ({dir} im Text)',
  params: { find: { typ: 'hidden', pflicht: true }, text: { typ: 'text', pflicht: true, oda: true } },
  run(m, a) {
    const g = g_(m); const h = g.explore.findHidden(a.find);
    if (!h) return;
    const ang = Math.atan2(h.y - g.ship.y, h.x - g.ship.x);
    const i = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
    g.oda(String(txt(m, a.text)).replace(/\{dir\}/g, DIRS[i]), null);
  } });
define({ id: 'force_choice', art: 'aktion', beschreibung: 'Offene Entscheidung erzwingen (Garantie: Schweigen ist auch eine Antwort)',
  params: { option: { typ: 'option', pflicht: true } },
  run(m, a) { if (m.state.choice) m.choice(a.option); } });
define({ id: 'reveal_location', art: 'aktion', beschreibung: 'Ort auf der Sternkarte aufdecken, optional gesperrte Verbindung öffnen und ODA-Text',
  params: { loc: { typ: 'loc', pflicht: true }, openLink: { typ: 'string' }, text: { typ: 'text', oda: true } },
  run(m, a) {
    const ex = g_(m).explore;
    if (a.openLink) ex.openLink(a.openLink);
    ex.reveal(a.loc, a.text !== undefined && a.text !== false ? txt(m, a.text) : false);
  } });
define({ id: 'spawn_squad', art: 'aktion', effekt: 'gegner', beschreibung: 'Trupp auf einer Außenkarte erscheinen lassen',
  params: { map: { typ: 'map', pflicht: true }, squad: { typ: 'squad', pflicht: true }, alert: { typ: 'bool' } },
  run(m, a) { combat().spawnSquad(g_(m), a.squad, { alert: !!a.alert }); } });
define({ id: 'wake_unit', art: 'aktion', effekt: 'gegner', ereignisse: ['wardenWake'], beschreibung: 'Ruhende Einheit wecken (Wächter)',
  params: { map: { typ: 'map', pflicht: true }, unit: { typ: 'unit', pflicht: true } },
  run(m, a) {
    if (a.unit === 'warden') combat().wakeWarden(g_(m));
    else m.game.countError('mission-hook', new Error(`wake_unit: Einheit ${a.map}.${a.unit} unbekannt`));
  } });
define({ id: 'set_object_state', art: 'aktion', ereignisse: ['vaultOpened', 'tabletTaken'],
  beschreibung: 'Zustand eines Kartenobjekts setzen (Tor öffnen …)',
  params: { map: { typ: 'map', pflicht: true }, object: { typ: 'object', pflicht: true }, state: { typ: 'state', pflicht: true } },
  run(m, a) { Objects.setState(g_(m), a.map, a.object, a.state); } });

// ---------- Weltstand (CONTRACT-S1 §5.4; ohne game.weltstand No-op) ----------
define({ id: 'npc_gedaechtnis', art: 'aktion', beschreibung: 'Eintrag ins Gedächtnis eines NSC (Text wird beim Schreiben aufgelöst)',
  params: { npc: { typ: 'npc', pflicht: true }, ereignis: { typ: 'string' }, text: { typ: 'text', pflicht: true },
    haltung: { typ: 'number', min: -3, max: 3 }, gewicht: { typ: 'number', min: 0, max: 10 } },
  run(m, a) {
    const ctx = m.writeContext();
    const entry = { ereignis: a.ereignis || `${ctx.mission || 'welt'}:${ctx.ausgang || ctx.schritt || 'ereignis'}`, text: txt(m, a.text),
      mission: ctx.mission, spielzeit_s: m.playTime() };
    if (ctx.schritt) entry.schritt = ctx.schritt;
    if (a.haltung != null) entry.haltung = a.haltung;
    if (a.gewicht != null) entry.gewicht = a.gewicht;
    callWeltstand(m, 'npcMemory', a.npc, entry);
  } });
define({ id: 'npc_haltung', art: 'aktion', beschreibung: 'Haltung eines NSC zur Crew ändern (−3 … +3)',
  params: { npc: { typ: 'npc', pflicht: true }, delta: { typ: 'number', pflicht: true, min: -2, max: 2 } },
  run(m, a) { callWeltstand(m, 'npcAttitude', a.npc, a.delta); } });
define({ id: 'npc_status', art: 'aktion', beschreibung: 'Status eines NSC setzen (lebt, vermisst, tot …)',
  params: { npc: { typ: 'npc', pflicht: true }, status: { typ: 'string', pflicht: true, werte: ['lebt', 'vermisst', 'verletzt', 'tot', 'unbekannt'] },
    ort: { typ: 'string' } },
  run(m, a) { if (a.ort !== undefined) callWeltstand(m, 'npcStatus', a.npc, a.status, a.ort); else callWeltstand(m, 'npcStatus', a.npc, a.status); } });
define({ id: 'welt_fakt', art: 'aktion', beschreibung: 'Fakt im Weltstand setzen (key = value)',
  params: { key: { typ: 'string', pflicht: true }, value: { typ: 'string' }, wert: { typ: 'string' }, quelle: { typ: 'string' },
    faden: { typ: 'bool' } },   // S2: faden = offener Erzählfaden (höchstens 1 je Grobplan; Spielleiter greift ihn später auf)
  run(m, a) {
    const ctx = m.writeContext();
    const value = a.value !== undefined ? a.value : a.wert;
    if (a.faden !== undefined) callWeltstand(m, 'fact', a.key, value === undefined ? true : value, a.quelle || ctx.mission || null, { faden: !!a.faden });
    else callWeltstand(m, 'fact', a.key, value === undefined ? true : value, a.quelle || ctx.mission || null);
  } });
define({ id: 'chronik', art: 'aktion', beschreibung: 'Eintrag in die Chronik der Kampagne',
  params: { text: { typ: 'text', pflicht: true } },
  run(m, a) {
    const ctx = m.writeContext();
    const entry = { text: txt(m, a.text), mission: ctx.mission, spielzeit_s: m.playTime() };
    if (ctx.ausgang) entry.ausgang = ctx.ausgang;
    callWeltstand(m, 'chronicle', entry);
  } });

// =================================================================================================================
// Aktionen (intern: Debug, skip, Testgelände, Übung)
// =================================================================================================================
define({ id: 'debug_clear_incidents', art: 'aktion', intern: true, beschreibung: 'Übungsschäden entfernen (nur im drill-Schritt)', params: {},
  run(m) {
    const g = g_(m);
    if (!m.isDrillStep()) return;
    g.ship.fireList = []; g.ship.breachList = []; g.ship.systems[g.C.drill.system] = 'ok';
  } });
define({ id: 'debug_item_aboard', art: 'aktion', intern: true, beschreibung: 'Gegenstand direkt an Bord legen (Datenkern auf das Pad)',
  params: { item: { typ: 'item', pflicht: true } },
  run(m, a) {
    const g = g_(m);
    if (a.item !== 'datenkern') { g.inventory[a.item] = Math.max(1, g.inventory[a.item] || 0); return; }
    if (m.datenkernAboard()) return;
    const W = world();
    g.aways.platform.items = g.aways.platform.items.filter((i) => i.kind !== 'datenkern');
    const c = W.tileCenter(W.SHIP_PADS[2].x, W.SHIP_PADS[2].y);
    g.ship.groundItems.push({ id: 'core', kind: 'datenkern', x: c.x, y: c.y });
  } });
define({ id: 'debug_clear_enemies', art: 'aktion', intern: true, beschreibung: 'Gegner im Raum entfernen (alle oder eine Art)',
  params: { kind: { typ: 'string' } },
  run(m, a) { const sp = g_(m).space; sp.enemies = a.kind ? sp.enemies.filter((e) => e.kind !== a.kind) : []; } });
define({ id: 'debug_mark_scanned', art: 'aktion', intern: true, beschreibung: 'Scan als erledigt markieren',
  params: { id: { typ: 'string', pflicht: true } },
  run(m, a) { g_(m).scans.add(a.id); } });
define({ id: 'debug_skip_away', art: 'aktion', intern: true, beschreibung: 'Außenmission als erledigt überspringen (alle hoch, Datenkern an Bord)',
  params: { map: { typ: 'map', pflicht: true } },
  run(m, a) {
    const g = g_(m); const aw = g.aways[a.map || 'platform'];
    if (!aw) return;
    aw.active = true; aw.firstBeamAt = aw.firstBeamAt || g.time;
    if ((a.map || 'platform') === 'platform') { aw.coreRebooted = true; aw.sonde.disabled = true; aw.doorOpen = true; }
    for (const p of g.players) if (p.zone === 'away') interior().placeOnShipPad(g, p);
    if ((a.map || 'platform') === 'platform') get('debug_item_aboard').run(m, { item: 'datenkern' });
  } });
define({ id: 'debug_jump', art: 'aktion', intern: true, beschreibung: 'Schiff sofort an einen Ort versetzen',
  params: { loc: { typ: 'loc', pflicht: true } },
  run(m, a) { g_(m).debugGoto(a.loc); } });
define({ id: 'debug_dock', art: 'aktion', intern: true, beschreibung: 'Schiff sofort an einem Ort andocken',
  params: { loc: { typ: 'loc', pflicht: true } },
  run(m, a) { g_(m).debugGoto(a.loc || 'hafen', true); } });
define({ id: 'debug_accept', art: 'aktion', intern: true, beschreibung: 'Offenen Funkspruch annehmen', params: {},
  run(m) { if (m.state.radio && m.state.radio.needsAccept) m.accept(); } });
define({ id: 'debug_force_radio', art: 'aktion', intern: true, beschreibung: 'Funkspruch zum Annehmen erzwingen',
  params: { from: { typ: 'npc', pflicht: true }, text: { typ: 'text', pflicht: true } },
  run(m, a) { m.radio(m.npcName(a.from), txt(m, a.text), true); } });
define({ id: 'debug_kill_squad', art: 'aktion', intern: true, beschreibung: 'Trupp ausschalten (vorher erscheinen lassen, falls nötig)',
  params: { map: { typ: 'map', pflicht: true }, squad: { typ: 'squad', pflicht: true } },
  run(m, a) {
    const g = g_(m); const aw = g.aways[a.map || 'kesh'];
    if (!aw) return;
    if (!aw.spawned[a.squad]) combat().spawnSquad(g, a.squad, {});
    for (const d of aw.drones) if (d.alive && d.squad === a.squad) { d.alive = false; d.aim = null; }
  } });
define({ id: 'debug_take_item', art: 'aktion', intern: true, beschreibung: 'Gegenstand auf der Außenkarte sofort aufnehmen (Tafel)',
  params: { map: { typ: 'map', pflicht: true }, item: { typ: 'item', pflicht: true } },
  run(m, a) {
    const g = g_(m);
    if (a.item === 'tafel') { if (!g.aways.kesh.tablet.taken) combat().takeTablet(g, null); return; }
    g.countError('mission-hook', new Error(`debug_take_item: ${a.map}.${a.item} unbekannt`));
  } });
define({ id: 'debug_recall_all', art: 'aktion', intern: true, beschreibung: 'Alle Außenteam-Spieler hochholen (optional Gegenstand sichern)',
  params: { map: { typ: 'map', pflicht: true }, ensureItem: { typ: 'item' } },
  run(m, a) {
    const g = g_(m);
    const list = g.players.filter((p) => p.zone === 'away');
    list.forEach((p, i) => { interior().placeOnShipPad(g, p, i); p.beamLock = false; });
    if (a.ensureItem && !(g.inventory[a.ensureItem] >= 1)) g.inventory[a.ensureItem] = 1;
    if (g.aways[a.map]) g.aways[a.map].active = true;
  } });
define({ id: 'debug_arena_skip', art: 'aktion', intern: true, beschreibung: 'Testgelände: laufende Welle räumen bzw. nächste sofort', params: {},
  run(m) { arena().skipWave(g_(m)); } });
define({ id: 'tutorial_drill_setup', art: 'aktion', intern: true, effekt: 'schaden',
  beschreibung: 'Hafen-Übung wie im JS-Modul m1 (mit „Übung überspringen“-Zweig) – nur für den JS-Übergang',
  params: {},
  run(m) {
    const g = g_(m); const d = g.C.drill;
    if (g.lobbyOpts && g.lobbyOpts.skipDrill) {
      const sk = g.C.drillSkip || { radioAt: 6 };
      m.v.skip = true; m.v.radio = true;
      m.later(3, [{ oda: 'Übung übersprungen – alte Hasen also. Lager oben links, Brücke ganz vorn rechts.' }]);
      if (m.def && m.def.radioTesk) m.later(sk.radioAt, [m.def.radioTesk]);
      m.later(sk.radioAt + 22, [{ if: { not: { event: 'accepted' } }, oda: 'Der Funkspruch wartet: Captain-Konsole auf der Brücke, Reiter „Funk“, Enter.' }]);
      return;
    }
    get('ship_incident').run(m, { fires: 1, breaches: 1, system: d.system, state: 'broken', pos: 'drill', quiet: true });
  } });

// =================================================================================================================
// Prüfungen
// =================================================================================================================
define({ id: 'no_fires', art: 'pruefung', beschreibung: 'Kein Feuer an Bord', params: {}, test: (m) => !g_(m).ship.fireList.length });
define({ id: 'no_breaches', art: 'pruefung', beschreibung: 'Kein Leck an Bord', params: {}, test: (m) => !g_(m).ship.breachList.length });
define({ id: 'system_ok', art: 'pruefung', beschreibung: 'Schiffssystem ist heil', params: { system: { typ: 'system', pflicht: true } },
  test: (m, a) => g_(m).ship.systems[a.system] === 'ok' });
define({ id: 'console_manned', art: 'pruefung', beschreibung: 'Konsole ist besetzt', params: { console: { typ: 'console', pflicht: true } },
  test: (m, a) => g_(m).players.some((p) => p.console === a.console && p.connected) });
define({ id: 'salvage_done', art: 'pruefung', beschreibung: 'Bergungsgut im Raum eingesammelt', params: {},
  test: (m) => { const g = g_(m); return (g.salvaged || 0) >= g.C.salvage.count || (m.v.salvageSpawned && !g.space.salvage.length && g.ship.scene === 'splitter'); } });
define({ id: 'ship_in_zone', art: 'pruefung', beschreibung: 'Schiff ist in einer benannten Zone einer Raumszene (objects.js SPACE_ZONES)',
  params: { loc: { typ: 'loc', pflicht: true }, zone: { typ: 'zone', pflicht: true } },
  test: (m, a) => Objects.inZone(g_(m), a.loc, a.zone) });
define({ id: 'ship_x', art: 'pruefung', beschreibung: 'Schiff liegt in x jenseits einer Pixelgrenze (gt/lt) – lieber ship_in_zone benutzen',
  params: { gt: { typ: 'number' }, lt: { typ: 'number' } },
  test: (m, a) => (a.gt == null || g_(m).ship.x > a.gt) && (a.lt == null || g_(m).ship.x < a.lt) });
define({ id: 'marks_below', art: 'pruefung', beschreibung: 'Weniger als n Marken', params: { n: { typ: 'number', pflicht: true, min: 0 } },
  test: (m, a) => g_(m).inventory.marks < a.n });
define({ id: 'team_down', art: 'pruefung', beschreibung: 'Jemand ist unten (auf der Karte bzw. irgendwo)', params: { map: { typ: 'map' } },
  test: (m, a) => awayTeam(m, a.map || null).length > 0 });
define({ id: 'away_active', art: 'pruefung', beschreibung: 'Außenmission auf der Karte läuft (einmal gebeamt)', params: { map: { typ: 'map', pflicht: true } },
  test: (m, a) => !!(g_(m).aways[a.map] && g_(m).aways[a.map].active) });
define({ id: 'away_since', art: 'pruefung', beschreibung: 'Außenmission läuft seit sec Sekunden und das Schiff ist am Ort der Karte',
  params: { map: { typ: 'map', pflicht: true }, sec: { typ: 'number', pflicht: true, min: 0 } },
  test: (m, a) => {
    const g = g_(m); const aw = g.aways[a.map];
    return !!(aw && aw.active && g.time - aw.firstBeamAt >= a.sec && g.ship.scene === Objects.locOfMap(a.map));
  } });
define({ id: 'object_state', art: 'pruefung', beschreibung: 'Kartenobjekt ist im Zustand (viele: eins bzw. alle mit all: true)',
  params: { map: { typ: 'map', pflicht: true }, object: { typ: 'object', pflicht: true }, state: { typ: 'state', pflicht: true }, all: { typ: 'bool' } },
  test: (m, a) => Objects.inState(g_(m), a.map, a.object, a.state, !!a.all) });
define({ id: 'near_object', art: 'pruefung', beschreibung: 'Ein Spieler der Karte ist höchstens dist Pixel vom Objekt entfernt',
  params: { map: { typ: 'map', pflicht: true }, object: { typ: 'object', pflicht: true }, dist: { typ: 'number', pflicht: true, min: 0 } },
  test: (m, a) => {
    const g = g_(m);
    if (!g.away || g.away.map !== a.map) return false;
    const pos = Objects.positions(g, a.map, a.object);
    return awayTeam(m, a.map).some((p) => pos.some((o) => Math.hypot(p.x - o.x, p.y - o.y) < a.dist));
  } });
define({ id: 'area_occupied', art: 'pruefung', beschreibung: 'Mindestens min Spieler (Standard 1) im Bereich der Karte',
  params: { map: { typ: 'map', pflicht: true }, area: { typ: 'area', pflicht: true }, min: { typ: 'number', min: 1 } },
  test: (m, a) => awayTeam(m, a.map).filter((p) => Objects.inArea(g_(m), a.map, a.area, p.x, p.y)).length >= (a.min || 1) });
define({ id: 'item_in_area', art: 'pruefung',
  beschreibung: 'Gegenstand im Inventar und ein Spieler (nicht verwundet) damit im Bereich; carrierRule: any | carrier | carrierOrAnyIfCarrierUp',
  params: { map: { typ: 'map', pflicht: true }, item: { typ: 'item', pflicht: true }, area: { typ: 'area', pflicht: true },
    carrierRule: { typ: 'string', werte: ['any', 'carrier', 'carrierOrAnyIfCarrierUp'] } },
  test: (m, a) => {
    const g = g_(m);
    if ((g.inventory[a.item] || 0) < 1) return false;
    const team = awayTeam(m, a.map); const by = Objects.carrierOf(g, a.item); const rule = a.carrierRule || 'any';
    const carrierDown = by && team.some((p) => p.id === by);
    return team.some((p) => !p.downed && Objects.inArea(g, a.map, a.area, p.x, p.y)
      && (rule === 'any' || (rule === 'carrier' ? p.id === by : (!carrierDown || p.id === by))));
  } });
define({ id: 'item_count', art: 'pruefung', beschreibung: 'Mindestens min Stück im Inventar',
  params: { item: { typ: 'item', pflicht: true }, min: { typ: 'number', pflicht: true, min: 0 } },
  test: (m, a) => (g_(m).inventory[a.item] || 0) >= a.min });
define({ id: 'crew_max', art: 'pruefung', beschreibung: 'Höchstens max Spieler verbunden', params: { max: { typ: 'number', pflicht: true, min: 1 } },
  test: (m, a) => g_(m).players.filter((p) => p.connected).length <= a.max });
define({ id: 'squad_cleared', art: 'pruefung', beschreibung: 'Trupp ist erschienen und ausgeschaltet',
  params: { map: { typ: 'map', pflicht: true }, squad: { typ: 'squad', pflicht: true } },
  test: (m, a) => { const aw = g_(m).aways[a.map]; return !!(aw && aw.spawned && aw.spawned[a.squad]) && !aw.drones.some((d) => d.alive && d.squad === a.squad); } });

// S2 (CONTRACT-S2 §2.1 „Szene nicht fertig bei Ankunft“): Szene des Spielleiters ausgearbeitet bzw. nicht mehr zu erwarten.
// Ohne Spielleiter (Direktstart, Testgelände, Tests) gilt jede Szene als bereit.
define({ id: 'szene_bereit', art: 'pruefung', beschreibung: 'Spielleiter-Szene ist bereit (ausgearbeitet oder Rohfassung endgültig) – für Anflug-Schritte',
  params: { szene: { typ: 'string', pflicht: true } },
  test: (m, a) => {
    const sl = m.game && m.game.spielleiter;
    if (!sl || typeof sl.sceneReady !== 'function') return true;
    try { return !!sl.sceneReady(m.activeId, a.szene); } catch (e) { m.game.countError('spielleiter-sceneReady', e); return true; }
  } });

// Name -> { entry, args } | null. Seit S1-QA gibt es keine Übergangs-Aliasse der alten JS-Module m1–m3 mehr
// (gelöscht nach grünem Golden-Trace-Vergleich); nur noch registrierte snake_case-Bausteine.
function resolve(name, args, art) {
  const e = ENTRIES.get(name);
  if (e && (!art || e.art === art)) return { entry: e, args: args || {} };
  return null;
}

// ---------- S2 §3.3: Plugins aus server/mission/bausteine/*.js ----------
// Je Datei: module.exports = (Registry) => { Registry.define(...) }. Reihenfolge nach Dateiname; ein kaputtes Plugin wird
// laut geloggt und übersprungen (der Rest der Registry bleibt nutzbar). Doppelte Kennungen: Plugin gewinnt nicht –
// eine schon definierte Kennung wird abgelehnt (Fehler in PLUGINS[].errors).
const PLUGINS = [];
function loadPlugins(dirIn) {
  const fs = require('fs');
  const path = require('path');
  const dir = dirIn || path.join(__dirname, 'bausteine');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch (e) { return PLUGINS; }
  for (const f of files) {
    const file = path.join(dir, f);
    if (PLUGINS.some((p) => p.file === file)) continue;
    const rec = { file, name: f, ids: [], errors: [] };
    const api = Object.assign({}, module.exports, {
      define(entry) {
        if (entry && ENTRIES.has(entry.id) && !rec.ids.includes(entry.id)) { rec.errors.push(`Kennung '${entry.id}' gibt es schon`); return ENTRIES.get(entry.id); }
        const e = define(entry); rec.ids.push(e.id); return e;
      },
    });
    try {
      const mod = require(file);
      const fn = typeof mod === 'function' ? mod : (mod && typeof mod.register === 'function' ? mod.register : null);
      if (!fn) rec.errors.push('exportiert keine Funktion (Registry) => { … }');
      else fn(api);
    } catch (e) { rec.errors.push(e.message); }
    if (rec.errors.length) console.error(`[Pantheon] Baustein-Plugin ${f}: ${rec.errors.join('; ')}`);
    PLUGINS.push(rec);
  }
  return PLUGINS;
}

module.exports = { define, get, describe, resolve, PARAM_TYPES, PLUGINS, loadPlugins };
loadPlugins();
