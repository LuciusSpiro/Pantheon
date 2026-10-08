'use strict';
// S1 (CONTRACT-S1 §3, Team ENGINE): Tests für Registry, Loader, Prüfer, Objekte/Bereiche und Weltstand-Schnittstelle der
// Missions-Engine – ohne Netz, direkt gegen die Game-Klasse.  node tools/test-regiebuch.js  (npm run test:regiebuch)
const fs = require('fs');
const os = require('os');
const path = require('path');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Registry = require('../server/mission/registry.js');
const Loader = require('../server/mission/loader.js');
const Checker = require('../server/mission/checker.js');
const Objects = require('../server/mission/objects.js');
const MissionMod = require('../server/sim/mission.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const t0 = Date.now();

function setup(players, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'C' + i, name: 'C' + i, color: i });
    conns.push(c);
  }
  if (o.start !== false) for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.step(); if (each) each(); } };
  const send = (i, m) => g.handleMessage(conns[i], m);
  const place = (i, tx, ty) => { const p = g.players[i]; const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; };
  const events = (kind) => conns[0].inbox.filter((m) => m.kind === kind);
  return { g, conns, run, send, place, events };
}
// Partie für restore: Spieler da, Phase play, aber keine Kampagne gestartet
function freshForRestore(players) {
  const s = setup(players, { start: false });
  s.g.phase = 'play';
  s.g.stats.playTimeStart = s.g.time;
  for (const p of s.g.players) p.ready = true;
  return s;
}
function mockWeltstand() {
  const calls = [];
  return { calls, w: { id: 'w-test', name: 'Test', persistent: false, data: {},
    npcMemory: (npc, e) => calls.push(['npcMemory', npc, e]), npcAttitude: (npc, d) => calls.push(['npcAttitude', npc, d]),
    npcStatus: (npc, s, ort) => calls.push(['npcStatus', npc, s, ort]), fact: (k, v, q) => calls.push(['fact', k, v, q]),
    chronicle: (e) => calls.push(['chronicle', e]) } };
}

// -----------------------------------------------------------------------------------------------------------------
console.log('\n[Registry]');
{
  const d = Registry.describe();
  ok(d.length >= 50, `describe(): ${d.length} Bausteine (${d.filter((x) => x.art === 'aktion').length} Aktionen, ${d.filter((x) => x.art === 'pruefung').length} Prüfungen, ${d.filter((x) => x.intern).length} intern)`);
  ok(JSON.stringify(JSON.parse(JSON.stringify(d))) === JSON.stringify(d) && !JSON.stringify(d).includes('function'), 'describe() ist reines JSON ohne Funktionen');
  ok(d.every((x) => /^[a-z][a-z0-9_]*$/.test(x.id)), 'alle Kennungen snake_case');
  const bs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuch', 'bausteine.json'), 'utf8'));
  const all = Object.assign({}, bs.aktionen || {}, bs.pruefungen || {});
  const want = Object.keys(all);
  // S2 (Studioleitung): Einträge, die KATALOG als Vertrag einträgt (status 'vertrag' bzw. vertrag: true), sind bis zur
  // Lieferung durch SCHUETZLING/BAUSTEINE nur ein Hinweis. Seit QA-INTEGRATION S2 (alle geliefert) ist der strenge Modus
  // Standard; STRICT_BAUSTEINE=0 erlaubt Vertrags-Einträge wieder als Hinweis (für künftige Ausbaustufen).
  const isContract = (id) => !!all[id] && (all[id].status === 'vertrag' || all[id].vertrag === true);
  const strict = process.env.STRICT_BAUSTEINE !== '0';
  const missing = want.filter((id) => !Registry.get(id) && (strict || !isContract(id)));
  const pending = want.filter((id) => !Registry.get(id) && !strict && isContract(id));
  ok(!missing.length, `alle ${want.length - pending.length} Bausteine aus bausteine.json registriert${missing.length ? ' – fehlt: ' + missing.join(', ') : ''}`);
  if (pending.length) console.log(`  HINWEIS ${pending.length} Vertrags-Bausteine noch nicht registriert: ${pending.join(', ')}`);
  for (const id of ['npc_gedaechtnis', 'npc_haltung', 'npc_status', 'welt_fakt', 'chronik', 'remove_item']) ok(Registry.get(id) && Registry.get(id).art === 'aktion', `Weltstand-Baustein ${id}`);
  // jeder do/check in content/regiebuecher/* ist registriert (CONTRACT-S1 §8.3 Punkt 5)
  const dir = Loader.BOOK_DIR; const unknown = []; let uses = 0;
  const walk = (node, file, inCond) => {
    if (Array.isArray(node)) { node.forEach((x) => walk(x, file, inCond)); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.do === 'string') { uses++; const e = Registry.get(node.do); if (!e || e.art !== 'aktion') unknown.push(`${file}: do ${node.do}`); }
    if (node.check !== undefined) {
      const name = typeof node.check === 'string' ? node.check : node.check && node.check.name;
      uses++; const e = Registry.get(name); if (!e || e.art !== 'pruefung') unknown.push(`${file}: check ${name}`);
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'texte') walk(v, file, inCond);
  };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) walk(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f);
  ok(!unknown.length && uses > 50, `${uses} do/check in den Regiebüchern, alle registriert${unknown.length ? ' – ' + unknown.slice(0, 5).join('; ') : ''}`);
  // S1-QA: Übergangs-Aliasse der alten JS-Module sind gelöscht – alte Namen lösen nicht mehr auf
  ok(Registry.resolve('spawnSquad', { squad: 'squad1' }, 'aktion') === null && Registry.resolve('spawn_squad', { squad: 'squad1' }, 'aktion').entry.id === 'spawn_squad'
    && Registry.aliasTable === undefined, 'keine Übergangs-Aliasse mehr (spawnSquad unbekannt, spawn_squad registriert)');
  ok(['m1.js', 'm2.js', 'm3.js'].every((f) => !fs.existsSync(path.join(__dirname, '..', 'server', 'missions', f))), 'alte JS-Module server/missions/m1–m3.js gelöscht');
}

console.log('\n[Loader und Prüfer]');
{
  const tl = Date.now();
  const r = Loader.loadAll();
  const ms = Date.now() - tl;
  const ids = Object.keys(r.books).sort();
  ok(['m1', 'm2', 'm3'].every((id) => r.books[id]) && !r.invalid.length, `alle Bücher gültig: ${ids.join(', ')} (${ms} ms)`);
  ok(['sela', 'zaunkoenig'].every((id) => r.books[id] && r.books[id].kopf.art === 'nebenauftrag'), 'Nebenaufträge sela, zaunkoenig als Daten');
  const cat = MissionMod.catalog();
  ok(JSON.stringify(MissionMod.MISSION_ORDER) === JSON.stringify(['m1', 'm2', 'm3']), 'MISSION_ORDER aus angebot berechnet: ' + MissionMod.MISSION_ORDER.join(' → '));
  ok(!cat.jsModules.m1 && !cat.jsModules.m2 && !cat.jsModules.m3 && !!cat.jsModules.arena_space && cat.info.arena_space.art === 'intern', 'm1–m3 laufen aus Regiebüchern (kein JS), arena_space bleibt JS (intern)');
  const tc = Date.now(); for (let i = 0; i < 10; i++) Checker.check(r.books.m1); const per = (Date.now() - tc) / 10;
  ok(per < 30, `Prüfer m1: ${per.toFixed(1)} ms je Buch`);
  const def = Loader.prepare(r.books.m3, CONFIG);
  ok(def.title === 'Die Tafel von Kesh' && typeof def.steps.find((s) => s.id === 'warden').next[0].if.any[1].elapsed === 'number', 'prepare: Titel aus kopf, cfg-Zahlen aufgelöst');
  ok(Loader.text(def, '@ziel.raus') === def.texte['ziel.raus'] && Loader.text(def, 'Literal') === 'Literal', 'Loader.text: @-Verweis und Literal');
  let err = null; ok(Loader.text(def, '@gibt.es.nicht', (e) => { err = e; }) === '[gibt.es.nicht]' && !!err, 'Loader.text: unbekannt -> [kennung] + Fehler');
  const st = Checker.selftest();
  ok(st.ok, `Selbsttest Prüfer ${st.passed}/${st.total} (inkl. FLAG-FORM, FLAG-UNGESETZT, NEUSTART, MECHANIK-GEPLANT)`);
  // ungültiges Buch in einem eigenen Ordner -> invalid
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regiebuch-'));
  const bad = JSON.parse(JSON.stringify(r.books.m3)); bad.id = 'kaputt'; bad.steps.find((s) => s.id === 'flight').timers[0].oda = '@fehlt';
  fs.writeFileSync(path.join(tmp, 'kaputt.regiebuch.json'), JSON.stringify(bad));
  fs.writeFileSync(path.join(tmp, 'nojson.json'), '{ kaputt');
  const r2 = Loader.loadAll(tmp);
  ok(r2.invalid.length === 2 && r2.invalid.some((i) => i.errors.some((e) => e.code === 'REF-TEXT')) && r2.invalid.some((i) => i.errors[0].code === 'JSON'), 'loadAll: kaputtes Buch und kaputtes JSON landen in invalid');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n[Kampagne: Start, Bücher, Missionsbuch]');
{
  const { g, run } = setup(1);
  ok(g.mission.activeId === 'm1' && g.mission.state.stage === 'dock' && g.mission.isDrillStep(), 'Kampagne startet m1/dock (drill-Schritt)');
  ok(g.ship.fireList.length === 1 && g.ship.breachList.length === 1 && g.ship.systems.transfer === 'broken' && g.odaSeen.has('firstFire'), 'ship_incident: Übungsschäden, still (keine Ersthinweise)');
  ok(g.mission.beamDownBlocked('platform') === 'Erst die Boje scannen.' && g.mission.beamDownBlocked('wreck') === null, 'Beam-Regel aus Kartendaten (Plattform gesperrt, Wrack frei)');
  run(1);
  ok(g.errors === 0, 'keine Fehler nach Start');
  ok(JSON.stringify(g.mission.offers()) === JSON.stringify(['m1', 'm2', 'm3']), 'offers()');
}

console.log('\n[Kampagne ohne Tutorial]');
{
  const { g, run, events } = freshForRestore(1);
  const ws = mockWeltstand(); g.weltstand = ws.w;
  g.mission.startCampaign({ tutorial: false });
  const ms = g.mission.missions;
  ok(['m1', 'm2', 'm3'].every((id) => ms[id] && ms[id].state === 'done' && ms[id].ausgang === 'uebersprungen') && !g.mission.activeId, 'Tutorial (m1–m3) erledigt mit Ausgang uebersprungen, keine Mission aktiv');
  ok(g.inventory.marks === CONFIG.campaign.skipTutorialMarks, `Marken = campaign.skipTutorialMarks (${g.inventory.marks})`);
  ok(ws.calls.some((c) => c[0] === 'fact') && !ws.calls.some((c) => c[0] === 'npcMemory' || c[0] === 'chronicle'), `nur Fakten (${ws.calls.filter((c) => c[0] === 'fact').map((c) => c[1]).join(', ')}), kein Gedächtnis`);
  run((CONFIG.campaign.teskRumorAt || 8) + 1);
  const r = events('radio');
  ok(r.length === 1 && /Tesk/.test(r[0].from), `Tesk-Funk nach ${CONFIG.campaign.teskRumorAt} s: „${r[0] && r[0].text.slice(0, 50)}…“`);
  ok(g.mission.beamDownBlocked('platform') === 'Auf der Plattform gibt es nichts mehr zu tun.', 'Plattform nach übersprungenem m1 gesperrt („nichts mehr zu tun“)');
  ok(g.errors === 0 && !g.mission.activeId, 'frei fliegen, keine Fehler');
}

console.log('\n[Lobby-Start „free“ (Kampagne ohne Tutorial über game.startGame)]');
{
  const { g, send, run, events } = setup(1, { start: false });
  const calls = [];
  const proto = MissionMod.Mission.prototype;
  const orig = proto.startCampaign;
  proto.startCampaign = function (o) { calls.push(o); return orig.call(this, o); };   // reset() legt eine neue Mission an
  send(0, { t: 'lobbyOpt', startMission: 'free' });
  ok(g.lobbyOpts.startMission === 'free', 'lobbyOpt startMission free angenommen');
  try { send(0, { t: 'ready', ready: true }); } finally { proto.startCampaign = orig; }
  ok(g.phase === 'play' && calls.length === 1 && calls[0] && calls[0].tutorial === false, `startGame ruft mission.startCampaign({ tutorial: false }) (${JSON.stringify(calls)})`);
  ok(g.ship.docked && g.ship.scene === 'hafen' && !g.mission.activeId, 'angedockt im Hafen, keine Mission aktiv');
  const ms = g.mission.missions;
  ok(['m1', 'm2', 'm3'].every((id) => ms[id] && ms[id].state === 'done' && ms[id].ausgang === 'uebersprungen'), 'Tutorial erledigt mit Ausgang uebersprungen');
  ok(g.weltstand && g.weltstand.persistent === true && g.weltstand.data.tutorial === 'uebersprungen', 'Weltstand persistent, tutorial = uebersprungen');
  ok(g.inventory.marks === CONFIG.campaign.skipTutorialMarks, `Marken = campaign.skipTutorialMarks (${g.inventory.marks})`);
  ok(g.weltstand.data.fakten.tafel_von_kesh === 'konkordat_archiv', `Fakt tafel_von_kesh = ${g.weltstand.data.fakten.tafel_von_kesh}`);
  run((CONFIG.campaign.teskRumorAt || 8) - 1);
  ok(events('radio').length === 0, `vor teskRumorAt (${CONFIG.campaign.teskRumorAt} s) noch kein Funk`);
  run(2);
  const r = events('radio');
  ok(r.length === 1 && /Tesk/.test(r[0].from) && /Tafel/.test(r[0].text), `Tesk-Funk mit Tafel-Gerücht („${r[0] && r[0].text.slice(0, 60)}…“)`);
  ok(g.errors === 0, 'keine Fehler');
}

console.log('\n[Weltstand-Bausteine]');
{
  const { g } = setup(1);
  const m = g.mission;
  const e0 = g.errors;
  const def = m.defFor('m3');
  m.withContext(def, { mission: 'm3', ausgang: 'erfolg' }, () => m.run(def.ausgaenge.erfolg.folgen));
  ok(g.errors === e0, 'ohne game.weltstand: No-op ohne Fehler');
  const ws = mockWeltstand(); g.weltstand = ws.w;
  g.inventory.tafel = 1;
  m.withContext(def, { mission: 'm3', ausgang: 'erfolg' }, () => m.run(def.ausgaenge.erfolg.folgen));
  const mem = ws.calls.filter((c) => c[0] === 'npcMemory');
  ok(mem.length >= 1 && mem.every((c) => !c[2].text.startsWith('@') && c[2].mission === 'm3' && c[2].ereignis), `npcMemory: ${mem.length} Einträge, Text aufgelöst, mit mission/ereignis`);
  ok(ws.calls.some((c) => c[0] === 'chronicle' && c[1].ausgang === 'erfolg' && !c[1].text.startsWith('@')), 'chronicle mit Ausgang und aufgelöstem Text');
  ok(ws.calls.some((c) => c[0] === 'fact' && c[1] === 'tafel_von_kesh'), 'fact tafel_von_kesh');
  ok(g.inventory.tafel === 0, 'remove_item tafel');
  g.weltstand = { npcMemory() { throw new Error('kaputt'); } };
  const e1 = g.errors;
  Registry.get('npc_gedaechtnis').run(m, { npc: 'tesk', text: 'x' });
  ok(g.errors === e1 + 1, 'Fehler im Weltstand wird gezählt (mission-weltstand)');
}

console.log('\n[toSave/restore mitten in m2 (vaelen, angedockt)]');
{
  const { g, run } = setup(1);
  g.mission.forceStep('m2', 'vaelen');
  g.debugGoto('vaelen', true);
  run(2);
  ok(g.mission.state.stage === 'vaelen' && g.mission.state.choice && g.mission.state.choice.id === 'sela', 'm2/vaelen angedockt: Selas Angebot offen');
  g.mission.setFocus('m2');
  const save = g.mission.toSave();
  const js = JSON.stringify(save);
  ok(save.aktiv === 'm2' && save.missionen.m1.status === 'erledigt' && save.missionen.m2.schritt === 'vaelen' && Array.isArray(save.missionen.m2.ereignisse), `toSave: aktiv m2/vaelen, m1 erledigt (${Buffer.byteLength(js)} B)`);
  ok(!/arena/.test(js) && save.buchFokus === 'm2' && typeof save.flags === 'object', 'toSave: Flags, Buchfokus, kein Testgelände');
  const s2 = freshForRestore(1);
  s2.g.debugGoto('vaelen', true);
  ok(s2.g.mission.restore(JSON.parse(js)) === true, 'restore()');
  s2.run(1);
  const m2 = s2.g.mission;
  ok(m2.activeId === 'm2' && m2.state.stage === 'vaelen' && m2.missions.m1.state === 'done', 'nach restore: m2/vaelen aktiv, m1 erledigt');
  ok(m2.state.choice && m2.state.choice.id === 'sela', 'Neustart des Schritts: Selas Angebot wieder offen');
  ok(m2.book.focus === 'm2' && JSON.stringify(m2.toSave().flags) === JSON.stringify(save.flags), 'Flags und Buchfokus übernommen');
  const snap = s2.g.snapshot();
  ok(snap.mission && snap.mission.active && snap.mission.active.id === 'm2' && s2.g.errors === 0, 'Snapshot nach restore, keine Fehler');
  // Ein zweites Mal speichern ergibt dasselbe Missionsbild
  const again = m2.toSave();
  ok(again.missionen.m2.schritt === 'vaelen' && again.missionen.m1.ausgang === save.missionen.m1.ausgang, 'Rundlauf stabil');
}

console.log('\n[toSave/restore in m1 (return): Nachhut kommt nicht doppelt]');
{
  const { g, run } = setup(1);
  g.mission.forceStep('m1', 'return');
  run(7);
  const nh = g.space.enemies.filter((e) => e.tag === 'nachhut').length;
  ok(nh >= 1, `Nachhut gespawnt (${nh})`);
  g.space.enemies = [];
  run(1.5);
  ok(g.mission.flags.rearguardRepelled === true, 'Nachhut abgewehrt: Flag rearguardRepelled (DATEN-Absicherung)');
  run(6);
  ok(g.mission.flags.selaCalled === true, 'Selas Notruf kam');
  const save = JSON.parse(JSON.stringify(g.mission.toSave()));
  ok(save.missionen.m1.schritt === 'return', 'toSave in m1/return');
  // Laden: angedockt im Hafen (Kai-Entscheidung 5), Schritt ruht bis zum Ort, dann zurück nach B-7
  const s2 = freshForRestore(1);
  s2.g.mission.restore(save);
  ok(s2.g.mission.state.stage === 'return' && s2.g.mission.dormant === true, 'restore: m1/return ruht (Schiff im Hafen, Schritt-Ort b7)');
  s2.run(10);
  ok(!s2.g.space.enemies.length, 'im Hafen laufen keine Timer des Schritts (keine Gegner)');
  s2.g.debugGoto('b7');
  s2.run(12);
  const nh2 = s2.g.space.enemies.filter((e) => e.tag === 'nachhut').length;
  ok(!s2.g.mission.dormant && nh2 === 0, `am Ort: Schritt läuft, Nachhut kommt nicht noch einmal (${nh2})`);
  ok(!s2.g.mission.jumpBlocked('splitter'), 'Sprung nicht blockiert');
  ok(s2.g.errors === 0, 'keine Fehler');
  // Gegenprobe: Speichern vor der Nachhut -> nach dem Laden kommt sie (einmal)
  const s3 = setup(1);
  s3.g.mission.forceStep('m1', 'return');
  s3.run(1);
  const early = JSON.parse(JSON.stringify(s3.g.mission.toSave()));
  const s4 = freshForRestore(1);
  s4.g.debugGoto('b7');
  s4.g.mission.restore(early);
  s4.run(8);
  ok(s4.g.space.enemies.filter((e) => e.tag === 'nachhut').length >= 1, 'Gegenprobe: vor der Nachhut gespeichert -> sie kommt nach dem Laden');
}

console.log('\n[Geladen bei Vaelen in m1/return: Heimflug geht weiter, kein doppelter Funk (QA-Abnahme)]');
{
  const { g, run } = setup(1);
  g.mission.forceStep('m1', 'return');
  run(7); g.space.enemies = []; run(8);
  g.debugGoto('vaelen', true); run(1);
  const save = JSON.parse(JSON.stringify(g.mission.toSave()));
  ok(save.missionen.m1.schritt === 'return' && save.missionen.m1.v && save.missionen.m1.v.wave === true && g.mission.flags.rearguardRepelled, 'Stand: m1/return bei Vaelen, Nachhut abgewehrt (v.wave gespeichert)');
  // a) direkt heim: ruhender Schritt geht über `next` weiter (vorher: blieb in return hängen, bis man nach B-7 flog)
  const a = freshForRestore(1);
  a.g.debugGoto('vaelen', true);
  a.g.mission.restore(save); a.run(1);
  ok(a.g.mission.state.stage === 'return' && a.g.mission.dormant === true, 'nach dem Laden bei Vaelen: return ruht');
  a.g.debugGoto('hafen'); a.run(2);
  ok(a.g.mission.state.stage === 'port' && !a.g.mission.dormant, `Heimflug ohne Umweg über B-7: Schritt ${a.g.mission.state.stage}`);
  a.g.debugGoto('hafen', true); a.run(2);
  ok(a.g.mission.missions.m1.state === 'done' && a.g.errors === 0, 'angedockt: m1 erledigt, keine Fehler');
  // b) erst nach B-7: Schritt wacht auf, aber kein zweiter Funk/Gedächtniseintrag „nachhut_verloren“
  const b = freshForRestore(1);
  const ws = mockWeltstand(); b.g.weltstand = ws.w;
  b.g.debugGoto('vaelen', true);
  b.g.mission.restore(save); b.run(1);
  b.g.debugGoto('b7'); b.run(10);
  const mem = ws.calls.filter((c) => c[0] === 'npcMemory' && c[2].ereignis === 'nachhut_verloren').length;
  ok(!b.g.mission.dormant && b.g.mission.state.stage === 'return' && mem === 0 && !b.g.space.enemies.length, `an B-7 aufgewacht: keine Nachhut, kein zweites „nachhut_verloren“ (${mem}×)`);
  // c) m2/sonde im Hafen gespeichert, direkt in den Nebel: Schritt geht weiter (Sonde bleibt optional)
  const s = setup(1);
  s.g.mission.forceStep('m2', 'sonde'); s.run(1);
  s.g.debugGoto('hafen', true); s.run(1);
  const sv = JSON.parse(JSON.stringify(s.g.mission.toSave()));
  const c = freshForRestore(1);
  c.g.debugGoto('hafen', true);
  c.g.mission.restore(sv); c.run(1);
  const st0 = c.g.mission.state.stage, d0 = c.g.mission.dormant;
  c.g.debugGoto('nebel'); c.run(2);
  ok(sv.missionen.m2.schritt === 'sonde' && st0 === 'sonde' && d0 && c.g.mission.state.stage !== 'sonde' && c.g.errors === 0,
    `m2/sonde im Hafen geladen, Flug in den Nebel: ${st0} (ruht) -> ${c.g.mission.state.stage}`);
}

console.log('\n[Kampagnenübergang m2 -> m3: Angebot genau einmal (Timer-if, CONTRACT-S1 §12)]');
{
  // JS-Original ignorierte das `if` an Timern mit `do` -> in der Kampagne kamen ODA „Direkt zur Planetenmission!“ und das
  // m3-Angebot doppelt. Regiebuch: offerDirectAt nur mit m3Direct, offerAfter nur ohne.
  const { g, run, events } = setup(1);
  g.mission.forceStep('m2', 'finale');
  const offerText = g.mission.defFor('m3').texte['funk.angebot'];
  const direktText = g.mission.defFor('m3').texte['briefing.direkt'];
  const radios = () => events('radio').filter((r) => r.text === offerText).length;
  const direkt = () => events('oda').filter((o) => o.text === direktText || /Direkt zur Planetenmission/.test(o.text || '')).length;
  run(6);
  ok(g.mission.missions.m2 && g.mission.missions.m2.state === 'done' && g.mission.activeId === 'm3' && g.mission.state.stage === 'briefing', `m2 abgeschlossen, m3/briefing aktiv (aktiv ${g.mission.activeId}/${g.mission.state.stage})`);
  ok(g.mission.flags.m3Direct === false, 'Kampagne: m3Direct = false (Standard aus erwartet)');
  run(CONFIG.missionM3.offerAfter + 45);
  ok(radios() === 1, `Kampagne: m3-Angebot (Tesk-Funk) genau einmal (${radios()}×)`);
  ok(direkt() === 0, `Kampagne: keine ODA „Direkt zur Planetenmission!“ (${direkt()}×)`);
  ok(g.errors === 0, 'keine Fehler');
  // Gegenprobe Lobby-Direktstart m3: ODA und Angebot je genau einmal
  const d = setup(1, { start: false });
  d.send(0, { t: 'lobbyOpt', startMission: 'm3' });
  d.send(0, { t: 'ready', ready: true });
  d.run(CONFIG.missionM3.offerAfter + 45);
  const dr = d.events('radio').filter((r) => r.text === offerText).length;
  const dd = d.events('oda').filter((o) => o.text === direktText).length;
  ok(d.g.mission.activeId === 'm3' && d.g.mission.flags.m3Direct === true && dr === 1 && dd === 1, `Direktstart m3: Angebot ${dr}×, ODA „Direkt …“ ${dd}× (je genau einmal)`);
}

console.log('\n[Objekte und Bereiche auf Kesh]');
{
  const { g, send, place, run } = setup(1);
  send(0, { t: 'debug', cmd: 'kesh' });
  const m = g.mission; const aw = g.aways.kesh;
  ok(m.activeId === 'm3' && m.state.stage === 'courtyard' && g.players[0].zone === 'away' && g.away === aw, 'Debug kesh: m3/courtyard, Spieler unten');
  const T = (name, a) => Registry.get(name).test(m, a);
  place(0, 40, 10);
  ok(T('area_occupied', { map: 'kesh', area: 'halle' }) && !T('area_occupied', { map: 'kesh', area: 'hof' }), 'Spieler in der Halle (x=40): halle ja, hof nein');
  ok(Objects.inArea(g, 'kesh', 'halle', 37 * 32, 0) && !Objects.inArea(g, 'kesh', 'halle', 36 * 32 + 31, 0), 'Halle beginnt bei Spalte 37 (wie missionM3.hallX)');
  place(0, 10, 18);
  ok(T('area_occupied', { map: 'kesh', area: 'hof' }) && T('area_occupied', { map: 'kesh', area: 'landezone' }), 'Spieler im Hof/Landezone');
  ok(!T('area_occupied', { map: 'kesh', area: 'hof', min: 2 }), 'area_occupied min 2: nein (solo)');
  const js = Objects.state(g, 'kesh', 'jammer');
  ok(Array.isArray(js) && js.length === 2 && js.every((s) => s === 'on'), 'Störrelais: Liste [on, on]');
  aw.jammers[0].off = true;
  ok(m.tpl('{objectsInState:jammer:off}/{objectsCount:jammer}') === '1/2' && m.tpl('{jammersOff}') === '1', 'Platzhalter objectsInState/objectsCount (+ Altname jammersOff)');
  ok(T('object_state', { map: 'kesh', object: 'jammer', state: 'off' }) && !T('object_state', { map: 'kesh', object: 'jammer', state: 'off', all: true }), 'object_state: eins aus, nicht alle');
  aw.jammers[1].off = true;
  ok(T('object_state', { map: 'kesh', object: 'jammer', state: 'off', all: true }), 'object_state all: beide aus');
  const sq = m.tpl('{squadLeft:squad1}');
  ok(Number(sq) > 0 && !T('squad_cleared', { map: 'kesh', squad: 'squad1' }), `Trupp 1: ${sq} übrig, nicht geräumt`);
  Registry.get('debug_kill_squad').run(m, { map: 'kesh', squad: 'squad1' });
  ok(m.tpl('{squadLeft:squad1}') === '0' && T('squad_cleared', { map: 'kesh', squad: 'squad1' }), 'Trupp 1 geräumt');
  ok(Objects.state(g, 'kesh', 'vault') === 'closed', 'Tor zu');
  Registry.get('set_object_state').run(m, { map: 'kesh', object: 'vault', state: 'open' });
  ok(Objects.state(g, 'kesh', 'vault') === 'open' && aw.vault.open, 'set_object_state: Tor auf');
  ok(Objects.state(g, 'kesh', 'warden') === 'asleep', 'Wächter schläft');
  Registry.get('wake_unit').run(m, { map: 'kesh', unit: 'warden' });
  ok(Objects.state(g, 'kesh', 'warden') === 'awake', 'wake_unit: Wächter wach');
  {
    const odas = [];
    const marks0 = g.inventory.marks;
    const watch = { send: (o) => { if (o.t === 'event' && o.kind === 'oda') odas.push(o.text); } };
    g.addConnection(watch); watch.observer = true;
    m.onEvent('wardenKilled', {});
    m.onEvent('wardenKilled', {});   // zweites Mal: nichts (Flag wardenKilled)
    const want = `Der Wächter liegt! Er hinterlässt eine kleine Lamassu-Figur. ${CONFIG.awayCombat.rewards.warden} Marken, Deko: Lamassu-Figur.`;
    ok(odas.filter((t) => /Wächter liegt/.test(t)).length === 1 && odas.includes(want), `Wächter-ODA mit Belohnungstext wie im JS-Original („${odas.find((t) => /Wächter liegt/.test(t))}“)`);
    ok(g.inventory.marks === marks0 + CONFIG.awayCombat.rewards.warden, 'Wächter-Belohnung genau einmal');
  }
  ok(!T('item_in_area', { map: 'kesh', item: 'tafel', area: 'hof', carrierRule: 'carrierOrAnyIfCarrierUp' }), 'ohne Tafel: item_in_area nein');
  Registry.get('debug_take_item').run(m, { map: 'kesh', item: 'tafel' });
  ok(Objects.state(g, 'kesh', 'tablet') === 'taken' && g.inventory.tafel === 1, 'Tafel genommen');
  ok(T('item_in_area', { map: 'kesh', item: 'tafel', area: 'hof', carrierRule: 'carrierOrAnyIfCarrierUp' }), 'Tafel im Hof (Spieler im Hof)');
  place(0, 40, 10);
  ok(!T('item_in_area', { map: 'kesh', item: 'tafel', area: 'hof', carrierRule: 'carrierOrAnyIfCarrierUp' }), 'Spieler in der Halle: Tafel nicht im Hof');
  ok(T('team_down', { map: 'kesh' }) && T('team_down', {}) && !T('team_down', { map: 'platform' }), 'team_down je Karte');
  ok(Objects.state(g, 'platform', 'ivo') === 'injured' && Objects.state(g, 'wreck', 'hollow') === 'closed' && Array.isArray(Objects.state(g, 'wreck', 'container')), 'Plattform/Wrack-Objekte lesbar');
  run(0.5);
  ok(g.errors === 0, 'keine Fehler');
}

console.log('\n[Nebenaufträge aus Daten]');
{
  const { g } = setup(1);
  g.mission.flags.selaCalled = true;
  g.explore.reveal('wrack', false);
  const e = g.mission.bookEntries();
  const sela = e.find((x) => x.id === 'sela'); const zk = e.find((x) => x.id === 'zaunkoenig');
  ok(sela && sela.kind === 'nebenauftrag' && sela.state === 'aktiv' && /Sela/.test(sela.from) && sela.loc === 'vaelen', 'Sela-Eintrag aus sela.regiebuch.json');
  ok(zk && zk.state === 'aktiv' && zk.objectives.some((o) => /Container bergen \(0\/\d\)/.test(o.text)), `Zaunkönig-Eintrag mit Live-Zähler („${zk && zk.objectives[1] && zk.objectives[1].text}“)`);
  g.mission.flags.vaelenHelped = true;
  ok(g.mission.bookEntries().find((x) => x.id === 'sela').state === 'erledigt', 'Sela erledigt nach vaelenHelped');
}

// =================================================================================================================
// S2 (CONTRACT-S2 §3/§4): Bücher zur Laufzeit, Spielleiter-Nähte, Kapitelkarte, Plugins, Weltstand v2
// =================================================================================================================
const genBook = (id, extra) => Object.assign({
  format: 'regiebuch/1', id,
  kopf: { titel: 'Testauftrag', art: 'generiert', auftraggeber: 'tesk', zielspieldauer_min: 15 },
  erinnerung: { npc: 'tesk', ereignis: 'tafel_uebergeben' },
  buch: { von: [{ npc: 'tesk' }], briefing: '@b', belohnung: '@b', ziel: 'splitter', dauer_min: 15, erinnerung: '@b' },
  buehne: { orte: ['hafen', 'splitter'] }, besetzung: { npc: ['tesk'] },
  steps: [
    { id: 'anflug', umsetzung: 'anflug/sprung', objectives: [{ id: 'go', text: '@b', done: { atLocation: 'splitter' } }],
      timers: [{ at: 60, oda: '@b', garantie: 'hinweis' }],
      next: [{ if: { all: [{ atLocation: 'splitter' }, { check: { name: 'szene_bereit', szene: 's1' } }] }, goto: 's1' }],
      skip: [{ do: 'debug_jump', loc: 'splitter' }] },
    { id: 's1', loc: 'splitter', umsetzung: 'vertreiben/bis_zur_flucht', objectives: [], next: [{ if: { elapsed: 1 }, complete: 'erfolg' }], skip: [] },
  ],
  ausgaenge: { erfolg: { beschreibung: 'ok', folgen: [{ do: 'chronik', text: '@b' }, { do: 'npc_gedaechtnis', npc: 'tesk', ereignis: 'test', text: '@b' }] } },
  texte: { b: 'Text' },
}, extra || {});
function mockSl(g) {
  const calls = [];
  const sl = { calls, ready: false, declined: false,
    update: () => calls.push(['update', g.mission.stepTime]),
    offers: () => (sl.declined || g.mission.missions.sl_1_test ? [] : [{ id: 'sl_1_test', titel: 'Testauftrag', von: 'Hafenmeisterin Tesk', ziel: 'splitter',
      dauer_min: 15, belohnung: '50 Marken', erinnerung: 'Tesk erinnert sich an die Tafel.', origin: 'sl', state: 'offered' }]),
    accept: (id) => { calls.push(['accept', id]); g.mission.startMission(id); return null; },
    decline: (id) => { calls.push(['decline', id]); sl.declined = true; return null; },
    planning: () => ({ stage: 1, von: 'Hafenmeisterei' }),
    sceneReady: (mid, sid) => { calls.push(['sceneReady', mid, sid]); return sl.ready; },
    onSceneEnter: (mid, sid) => calls.push(['onSceneEnter', mid, sid]),
    onMissionDone: (o) => calls.push(['onMissionDone', o.id, o.ausgang]),
    onCampaignStart: (o) => calls.push(['onCampaignStart', o.tutorial]),
    debug: (args) => { calls.push(['debug', args.join(' ')]); return null; },
    toSave: () => ({ naechste_id: 7, archiv_gespielt: ['ar_zollfeuer'] }),
    restore: (o) => calls.push(['restore', o, !!g.mission.activeId]) };
  g.spielleiter = sl;
  return sl;
}

console.log('\n[S2: Prüfer – Schema, Schützling, liefert_flags]');
{
  ok(Checker.check(genBook('sl_1_test')).ok, `erzeugtes Testbuch besteht den Prüfer${Checker.check(genBook('sl_1_test')).errors.map((e) => ' ' + e.code + ' ' + e.p).join('')}`);
  const withShip = genBook('sl_2_ship', { besetzung: { npc: ['tesk'], schiffe: { konvoi: { kind: 'frachter', name: 'Konvoi Kel' } } } });
  const r1 = Checker.check(withShip);
  ok(!r1.ok && r1.errors.some((e) => e.code === 'SCHUETZLING-OHNE-VERLUST') && !r1.errors.some((e) => e.code === 'MECHANIK-GEPLANT'), 'besetzung.schiffe erlaubt, ohne Verlustweg: SCHUETZLING-OHNE-VERLUST');
  withShip.steps[1].next.unshift({ if: { flag: 'konvoi_verloren' }, complete: 'erfolg' });
  ok(Checker.check(withShip).ok, 'Schützling mit Weg über Flag konvoi_verloren: gültig (Flag gilt als gesetzt)');
  const lf = genBook('sl_3_lf');
  lf.steps[1].liefert_flags = ['ziel_vertrieben'];
  lf.steps[1].next.unshift({ if: { flag: 'ziel_vertrieben' }, complete: 'erfolg' });
  ok(Checker.check(lf).ok, 'liefert_flags zählen als gesetzt (kein FLAG-UNGESETZT)');
  const badShip = genBook('sl_4_bad', { besetzung: { npc: ['tesk'], schiffe: { konvoi: { kind: 'pilgerschiff', name: 'X' } } } });
  ok(Checker.check(badShip).errors.some((e) => e.code === 'SCHEMA'), 'unbekannte Schiffsklasse: SCHEMA');
  ok(Checker.check(genBook('sl_5_um', { steps: [Object.assign({}, genBook('x').steps[0], { umsetzung: 'Kein Format' }), genBook('x').steps[1]] })).errors.some((e) => e.code === 'SCHEMA'), 'umsetzung muss <molekuel>/<umsetzung> sein');
  const fd = genBook('sl_6_fd');
  fd.ausgaenge.erfolg.folgen.push({ do: 'welt_fakt', key: 'test_faden', value: 'offen', faden: true });
  ok(Checker.check(fd).ok, 'welt_fakt mit faden: true gültig');
}

console.log('\n[S2: Registry-Plugins]');
{
  ok(Array.isArray(Registry.PLUGINS) && typeof Registry.loadPlugins === 'function', `Plugin-Lader da (${Registry.PLUGINS.map((p) => p.name + (p.errors.length ? '!' : '')).join(', ') || 'keine Plugins'})`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-plugins-'));
  fs.writeFileSync(path.join(dir, 'a_ok.js'), "module.exports = (R) => { R.define({ id: 'test_plugin_ping', art: 'pruefung', beschreibung: 'Test', params: {}, test: () => true }); };");
  fs.writeFileSync(path.join(dir, 'b_kaputt.js'), "throw new Error('kaputt');");
  fs.writeFileSync(path.join(dir, 'c_doppelt.js'), "module.exports = (R) => { R.define({ id: 'no_fires', art: 'pruefung', params: {}, test: () => false }); };");
  const err0 = console.error; const logged = []; console.error = (...a) => logged.push(a.join(' '));
  try { Registry.loadPlugins(dir); } finally { console.error = err0; }
  ok(Registry.get('test_plugin_ping') && Registry.get('test_plugin_ping').art === 'pruefung', 'Plugin definiert Baustein');
  ok(logged.some((l) => /b_kaputt/.test(l)) && logged.some((l) => /c_doppelt/.test(l)), 'kaputtes Plugin und doppelte Kennung: geloggt, kein Absturz');
  ok(Registry.get('no_fires').test({ game: { ship: { fireList: [] } } }) === true, 'doppelte Kennung überschreibt nichts');
  ok(Registry.get('szene_bereit') && Registry.get('szene_bereit').test({ game: {}, activeId: null }, { szene: 's1' }) === true, 'szene_bereit ohne Spielleiter: true');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n[S2: Bücher zur Laufzeit, Angebote, Hooks]');
{
  const s = setup(1, { start: false });
  const { g, run, send, events } = s;
  send(0, { t: 'lobbyOpt', startMission: 'free' });
  send(0, { t: 'ready', ready: true });
  ok(g.phase === 'play' && !g.mission.activeId && g.weltstand.persistent, 'Kampagne ohne Tutorial läuft');
  const sl = mockSl(g);
  const m = g.mission;
  ok(!m.registerBook(genBook('sl_9_x', { kopf: { titel: 'X', art: 'mission', auftraggeber: 'tesk', zielspieldauer_min: 5 } })).ok, 'registerBook: kopf.art mission abgelehnt');
  const bad = genBook('sl_9_y'); bad.steps[0].next[0].goto = 'gibtsnicht';
  const rb = m.registerBook(bad);
  ok(!rb.ok && rb.errors.some((e) => e.code === 'REF-SCHRITT'), 'registerBook: Prüferfehler -> ok false mit Fehlerliste');
  ok(!m.registerBook(genBook('m2')).ok, 'registerBook: Kennung aus dem Katalog abgelehnt');
  const r = m.registerBook(genBook('sl_1_test'), { origin: 'sl' });
  ok(r.ok && m.info('sl_1_test').art === 'generiert' && !m.order.includes('sl_1_test') && !m.missions.sl_1_test, 'registerBook: ok, außerhalb von order, nicht gestartet');
  run(1);
  const e = m.bookEntries().find((x) => x.id === 'sl_1_test');
  ok(e && e.state === 'angeboten' && e.von === 'Hafenmeisterin Tesk' && e.ziel === 'splitter' && e.dauer_min === 15 && e.belohnung === '50 Marken' && /Tafel/.test(e.erinnerung), 'Bucheintrag angeboten mit von/ziel/dauer_min/belohnung/erinnerung');
  ok(e.origin === 'sl', 'origin im Bucheintrag (Debug-Server)');
  g.debug = false; ok(!('origin' in m.bookEntries().find((x) => x.id === 'sl_1_test')), 'origin fehlt ohne Debug'); g.debug = true;
  ok(events('offerIn').filter((x) => x.id === 'sl_1_test').length === 1, 'Ereignis offerIn genau einmal');
  const snap = g.snapshot();
  ok(snap.mission.planning && snap.mission.planning.stage === 1 && snap.mission.planning.von === 'Hafenmeisterei', 'Snapshot mission.planning');
  ok(sl.calls.some((c) => c[0] === 'update'), 'spielleiter.update im Tick');
  g.players[0].console = 'plan';
  const notices = () => s.conns[0].inbox.filter((x) => x.kind === 'notice').map((x) => x.text);
  send(0, { t: 'cmd', c: 'plan.decline', id: 'm3' });
  ok(notices().some((t) => /lässt sich nicht ablehnen|Unbekannter Eintrag/.test(t)), 'plan.decline auf Nicht-Angebot: Hinweis');
  // updateBook vor dem Betreten: alles darf sich ändern
  const b2 = genBook('sl_1_test'); b2.texte.b = 'Text neu';
  ok(m.updateBook('sl_1_test', b2).ok, 'updateBook vor dem Start: ok');
  send(0, { t: 'cmd', c: 'plan.accept', id: 'sl_1_test' });
  ok(sl.calls.some((c) => c[0] === 'accept' && c[1] === 'sl_1_test') && m.activeId === 'sl_1_test' && m.state.stage === 'anflug', 'plan.accept -> spielleiter.accept, Mission läuft (Spielleiter startet)');
  ok(m.flightV2() === true, 'flightV2() für kopf.art generiert');
  ok(sl.calls.some((c) => c[0] === 'onSceneEnter' && c[1] === 'sl_1_test' && c[2] === 'anflug'), 'onSceneEnter beim ersten Schritt mit umsetzung');
  // Szene nicht bereit: Anflug hält
  g.debugGoto('splitter');
  run(1);
  ok(m.state.stage === 'anflug' && sl.calls.some((c) => c[0] === 'sceneReady' && c[2] === 's1'), 'szene_bereit false: Anflug-Schritt hält');
  const b3 = genBook('sl_1_test'); b3.texte.b = 'Text neu'; b3.steps[0].timers[0].at = 61;
  const rb3 = m.updateBook('sl_1_test', b3);
  ok(!rb3.ok && rb3.errors[0].code === 'BETRETEN', 'updateBook: betretener Schritt darf sich nicht ändern');
  // QA-Abnahme S2b: nur die Flag-Rücksetzung im enter des betretenen Schritts ändert sich (andere Flags der ersetzten Szene)
  const b3r = genBook('sl_1_test'); b3r.texte.b = 'Text neu';
  b3r.steps[0].enter = (b3r.steps[0].enter || []).concat([{ setFlag: { s9_neu: null } }]);
  const rb3r = m.updateBook('sl_1_test', b3r);
  ok(rb3r.ok, 'updateBook: geänderte Flag-Rücksetzung im betretenen Schritt ist kein BETRETEN' + (rb3r.ok ? '' : ' – ' + JSON.stringify(rb3r.errors).slice(0, 300)));
  const b4 = genBook('sl_1_test'); b4.texte.b = 'Text neu'; b4.steps[1].next[0].if = { elapsed: 0.5 };
  const stepBefore = m.step;
  ok(m.updateBook('sl_1_test', b4).ok && m.step !== stepBefore && m.step.id === 'anflug' && m.def.steps[1].next[0].if.elapsed === 0.5, 'updateBook: unbetretener Schritt ersetzt, laufender Schritt neu gebunden');
  ok(!m.unregisterBook('sl_1_test').ok, 'unregisterBook: laufende Mission abgelehnt');
  sl.ready = true;
  run(0.2);
  ok(m.state.stage === 's1' && sl.calls.some((c) => c[0] === 'onSceneEnter' && c[2] === 's1'), 'Szene bereit -> s1, onSceneEnter');
  run(1.5);
  ok(!m.activeId && m.missions.sl_1_test.state === 'done' && sl.calls.some((c) => c[0] === 'onMissionDone' && c[1] === 'sl_1_test' && c[2] === 'erfolg'), 'Mission erledigt, onMissionDone({ id, ausgang })');
  ok(m.bookEntries().some((x) => x.id === 'sl_1_test' && x.state === 'erledigt') && m.snapshotList().some((x) => x.id === 'sl_1_test'), 'erledigte erzeugte Mission im Buch und in der Liste');
  ok(m.flightV2() === false, 'flightV2() ohne aktive erzeugte Mission: false');
  const sv = m.toSave();
  ok(sv.missionen.sl_1_test && sv.missionen.sl_1_test.status === 'erledigt', 'toSave enthält die erzeugte Mission');
  // decline
  sl.declined = false; m.missions.sl_1_test = undefined; delete m.missions.sl_1_test;
  send(0, { t: 'cmd', c: 'plan.decline', id: 'sl_1_test' });
  ok(sl.calls.some((c) => c[0] === 'decline' && c[1] === 'sl_1_test'), 'plan.decline -> spielleiter.decline');
  // Debug-Weiterleitung
  send(0, { t: 'debug', cmd: 'sl', args: 'status' });
  ok(sl.calls.some((c) => c[0] === 'debug' && c[1] === 'status'), 'Debug sl status -> spielleiter.debug([status])');
  send(0, { t: 'debug', cmd: 'escort', args: 'frachter' });
  ok(true, 'Debug escort frachter ohne Absturz');
  ok(/^\d+$/.test(m.tpl('{escortHp:konvoi}')), `Platzhalter {escortHp:konvoi} -> „${m.tpl('{escortHp:konvoi}')}“`);
  ok(g.errors === 0, `keine Fehler (${g.errors})`);
}

console.log('\n[S2: onCampaignStart, Teaser abgelöst]');
{
  const { g } = setup(1, { start: false });
  const sl = mockSl(g);
  // startGame -> reset() setzt spielleiter = null, danach createSpielleiter(): Ersatz-Fabrik liefert den Mock
  g.createSpielleiter = function () { this.spielleiter = sl; return sl; };
  g.handleMessage(s0conn(g), { t: 'ready', ready: true });
  ok(sl.calls.some((c) => c[0] === 'onCampaignStart' && c[1] === true), 'onCampaignStart({ tutorial: true })');
  g.startTeaser();
  ok(g.mission.state.teaser == null, 'startTeaser ist No-op (Altname)');
}
function s0conn(g) { return [...g.conns][0]; }

console.log('\n[S2: Karte ohne Tutorial, Routen zur Bühne (QA-INTEGRATION)]');
{
  const s = setup(1, { start: false });
  s.send(0, { t: 'lobbyOpt', startMission: 'free' });
  s.send(0, { t: 'ready', ready: true });
  const ex = s.g.explore;
  ok(ex.isLinked('hafen', 'kesh') && ex.isLinked('splitter', 'kesh') && ex.isLinked('nebel', 'relais'), 'ohne Tutorial: hafen–kesh, splitter–kesh, nebel–relais offen');
  ok(['b7', 'vaelen', 'wrack', 'nebel', 'relais', 'kesh'].every((id) => ex.isKnown(id)) && ex.visited.size <= 1, `ohne Tutorial: alle Orte bekannt, nicht besucht (besucht: ${[...ex.visited].join(',') || '–'})`);
  // generisch: Mission mit kopf.art archiv öffnet die Route zu ihren Bühnen-Orten (frischer Kartenstand)
  const t = setup(1);
  const ex2 = t.g.explore;
  ok(!ex2.isLinked('hafen', 'kesh') && !ex2.isKnown('relais'), 'Kampagne mit Tutorial: Kesh/Relais anfangs zu');
  mockSl(t.g);
  const book = genBook('ar_1_route', { kopf: { titel: 'Route', art: 'archiv', auftraggeber: 'tesk', zielspieldauer_min: 15 }, buehne: { orte: ['hafen', 'kesh', 'relais'] } });
  const r = t.g.mission.registerBook(book, { origin: 'archiv' });
  t.g.mission.activeId = null; t.g.mission.def = null;
  t.g.space.escorts = [{ id: 'es9', tag: 'konvoi', state: 'entkommen' }]; t.g.space.escortsGone = [{ id: 'es8', tag: 'konvoi' }];
  t.g.mission.startMission('ar_1_route');
  ok(t.g.space.escorts.length === 0 && t.g.space.escortsGone.length === 0, 'archiv-Mission: Schützlinge früherer Missionen geleert');
  ok(r.ok && ex2.isLinked('hafen', 'kesh') && ex2.isLinked('nebel', 'relais') && ex2.isKnown('relais') && ex2.isKnown('nebel') && ex2.isKnown('kesh'),
    `archiv-Mission: Route zu kesh/relais offen, Orte bekannt (${r.ok ? '' : JSON.stringify(r.errors && r.errors.slice(0, 2))})`);
  ok(!t.events('oda').some((e) => /Neuer Ort/.test(e.text || '')), 'Routen still geöffnet (kein ODA „Neuer Ort“)');
}

console.log('\n[S2: Kapitelkarte nach m3]');
{
  const { g, events } = setup(1);
  ok(!g.mission.forceStep('m3', 'extract'), 'Kampagne: m3/extract');
  g.mission.completeMission('erfolg');
  ok(events('chapter').length === 1 && /Kapitel/.test(events('chapter')[0].title) && g.phase === 'play' && events('ending').length === 0, 'Kampagne: Ereignis chapter, Spiel läuft weiter');
  const d = setup(1, { start: false });
  d.send(0, { t: 'lobbyOpt', startMission: 'm3' });
  d.send(0, { t: 'ready', ready: true });
  ok(!d.g.mission.forceStep('m3', 'extract'), 'Direktstart: m3/extract');
  d.g.mission.completeMission('erfolg');
  ok(d.g.phase === 'end' && d.events('chapter').length === 0 && d.events('ending').length === 1 && d.events('ending')[0].title === 'Die Tafel ist sicher', 'Direktstart m3: Ende wie bisher');
}

console.log('\n[S2: Weltstand v2 – Spielleiter.restore vor mission.restore]');
{
  const Weltstand = require('../server/weltstand.js');
  const { g } = setup(1);
  mockSl(g);
  const data = Weltstand.capture(g);
  ok(data.version === 2 && data.spielleiter.naechste_id === 7, 'capture: version 2, Block spielleiter aus toSave()');
  ok(Weltstand.validate(data).length === 0, `capture ist schemagültig${Weltstand.validate(data).slice(0, 1).map((x) => ' – ' + x).join('')}`);
  const f = freshForRestore(1);
  let sl2 = null;
  f.g.createSpielleiter = function () { sl2 = mockSl(this); sl2.calls.length = 0; return sl2; };
  Weltstand.apply(f.g, data);
  const rc = sl2 && sl2.calls.find((c) => c[0] === 'restore');
  ok(rc && rc[1].naechste_id === 7 && rc[2] === false && f.g.mission.activeId === 'm1', 'restore(data.spielleiter) vor mission.restore (aktive Mission danach)');
}

console.log(`\n${n - fails}/${n} Regiebuch-Tests bestanden (${((Date.now() - t0) / 1000).toFixed(1)} s).`);
process.exit(fails ? 1 : 0);
