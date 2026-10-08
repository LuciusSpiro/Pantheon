'use strict';
// Weltstand-Tests (CONTRACT-S1 §5, §6, §10.4–§10.8) headless gegen die Game-Klasse, mit eigenem temporären WORLD_DIR.
//   node tools/test-weltstand.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Protocol = require('../shared/protocol.js');

let fails = 0, n = 0, skipped = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const skip = (t) => { skipped++; console.log('  --   übersprungen: ' + t); };
const section = (t) => console.log('\n' + t);

const ROOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-weltstand-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(ROOT_TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };
const worldFiles = (d) => fs.readdirSync(d).filter((f) => /^[a-z0-9-]+\.json$/.test(f) && !f.includes('.bak') && !f.includes('.kaputt'));

// Partie mit `players` verbundenen Spielern; Lobby-Optionen vor dem Bereit-Melden
function setup(dir, players, lobby, opts) {
  const g = new Game(Object.assign({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} }, opts || {}));
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'Crew' + i, color: i });
    conns.push(c);
  }
  const send = (i, m) => g.handleMessage(conns[i], m);
  if (lobby) send(0, Object.assign({ t: 'lobbyOpt' }, lobby));
  const ready = () => { for (let i = 0; i < conns.length; i++) send(i, { t: 'ready', ready: true }); };
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const events = (kind) => conns[0].inbox.filter((m) => m.t === 'event' && m.kind === kind);
  const notices = (i) => conns[i || 0].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);
  const clear = () => { for (const c of conns) c.inbox.length = 0; };
  return { g, conns, send, ready, run, events, notices, clear };
}

// Neue Kampagne anlegen und sofort im Hafen beenden (legt einen Stand an)
function makeCampaign(dir, startMission) {
  const t = setup(dir, 1, { startMission: startMission || 'm1' });
  t.ready(); t.run(0.2);
  const id = t.g.weltstand.id;
  t.send(0, { t: 'menu', op: 'end' });
  return id;
}

function main() {
  // ------------------------------------------------------------------------------------------------------------
  section('Protokoll');
  ok(Protocol.VERSION === 5, 'Protocol.VERSION = 5');
  ok(Protocol.C.WORLD === 'world' && Protocol.C.MENU === 'menu', 'C.WORLD / C.MENU');
  ok(JSON.stringify(Protocol.START_MISSIONS) === JSON.stringify(['m1', 'free', 'm3', 'arena_space', 'arena_away']), 'START_MISSIONS mit free');
  ok(Protocol.START_LABELS.m1 === 'Kampagne' && Protocol.START_LABELS.free === 'Kampagne ohne Tutorial', 'START_LABELS');

  // ------------------------------------------------------------------------------------------------------------
  section('Schema: Beispiel und Fixtures gültig');
  const beispiel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuch', 'weltstand.beispiel.json'), 'utf8'));
  ok(Weltstand.validate(beispiel).length === 0, 'weltstand.beispiel.json (Altform missionen) gültig');
  const fxDir = path.join(__dirname, 'fixtures', 'context');
  if (fs.existsSync(fxDir)) {
    for (const f of fs.readdirSync(fxDir).filter((x) => x.endsWith('.weltstand.json'))) {
      const errs = Weltstand.validate(JSON.parse(fs.readFileSync(path.join(fxDir, f), 'utf8')));
      ok(errs.length === 0, `Fixture ${f} gültig${errs.length ? ' – ' + errs[0] : ''}`);
    }
  } else skip('tools/fixtures/context fehlt');

  // ------------------------------------------------------------------------------------------------------------
  section('Lobby und neue Kampagne (m1)');
  {
    const dir = freshDir();
    const t = setup(dir, 1, { startMission: 'm1' });
    const s0 = t.g.snapshot();
    ok(Array.isArray(s0.lobby.worlds) && s0.lobby.worlds.length === 0 && s0.lobby.world === null && s0.lobby.worldsFull === false, 'Lobby-Snapshot: worlds [], world null, worldsFull false');
    ok(s0.paused === false && s0.campaign === false, 'Snapshot: paused false, campaign false (Lobby)');
    t.ready(); t.run(0.2);
    const ws = t.g.weltstand;
    ok(t.g.phase === 'play' && ws.persistent === true && /^w-[a-z0-9]{4}$/.test(ws.id), `Kampagne läuft, Weltstand persistent (${ws.id})`);
    ok(/^Lerche · \d\d\.\d\d\.$/.test(ws.name), `Name „${ws.name}“`);
    ok(worldFiles(dir).length === 1, 'direkt nach dem Start ein Stand auf der Platte');
    ok(fs.existsSync(path.join(dir, ws.id + '.lock')), 'Sperrdatei gesetzt');
    ok(t.events('worldSaved').length >= 1, 'Ereignis worldSaved');
    const s1 = t.g.snapshot();
    ok(!('worlds' in s1.lobby) && !('worldsFull' in s1.lobby) && s1.campaign === true, 'im Spiel keine Lobby-Weltstandfelder, campaign true');
    ok(ws.data.tutorial === 'laeuft', 'tutorial: laeuft');
    ok(Object.keys(ws.data.npc).length > 0, `NSC aus content/npc.json (${Object.keys(ws.data.npc).join(', ')})`);
    // Speichern nur bei Änderung
    const a = Weltstand.save(t.g, { ifChanged: true });
    const b = Weltstand.save(t.g, { ifChanged: true });
    ok(a.ok && b.ok && b.unchanged, 'ifChanged: zweites Speichern ohne Änderung schreibt nicht');
    t.g.inventory.marks += 1;
    const c = Weltstand.save(t.g, { ifChanged: true });
    ok(c.ok && !c.unchanged, 'nach Änderung wird geschrieben');
    ok(fs.existsSync(path.join(dir, ws.id + '.bak.json')), '.bak.json der Vorversion vorhanden');
    // Speicherzeit: im Tick nur Erfassen + Prüfen; Schreiben (Platte) danach
    const cap = [], wr = [];
    for (let i = 0; i < 20; i++) { t.g.inventory.marks += 1; const r = Weltstand.save(t.g); cap.push(r.captureMs); wr.push(r.ms); }
    cap.sort((x, y) => x - y); wr.sort((x, y) => x - y);
    const size = fs.statSync(path.join(dir, ws.id + '.json')).size;
    ok(cap[10] < 5 && cap[19] < 5, `Erfassen im Tick: Median ${cap[10]} ms, max ${cap[19]} ms (Schreiben danach: Median ${wr[10]} ms, max ${wr[19]} ms; Datei ${(size / 1024).toFixed(1)} KB)`);
    console.log(`  info Speichern: Erfassen ${cap[10]} ms, Schreiben ${wr[10]} ms (Median von 20)`);
    // Menü end: angedockt -> gesichert, Lobby, Spieler bleiben
    t.clear();
    t.send(0, { t: 'menu', op: 'end' });
    const se = t.events('sessionEnded')[0];
    ok(se && se.by === t.g.players[0].id && se.byName === 'Crew0' && se.saved === true, 'sessionEnded { by: ID, byName, saved: true }');
    ok(t.g.phase === 'lobby' && t.g.players.length === 1 && t.g.players[0].ready === false, 'zurück in der Lobby, Spieler verbunden, ready false');
    ok(!fs.existsSync(path.join(dir, ws.id + '.lock')), 'Sperre gelöst');
    const s2 = t.g.snapshot();
    ok(s2.lobby.worlds.length === 1 && s2.lobby.worlds[0].state === 'ok' && s2.lobby.worlds[0].loc === 'hafen', 'Lobby-Liste nach reset() neu gelesen (1 Stand, ok, hafen)');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Kampagne ohne Tutorial (free) + Ablauf CLIENT-Befund');
  {
    const dir = freshDir();
    const t = setup(dir, 1, { startMission: 'free' });
    t.ready(); t.run(10);
    const ws = t.g.weltstand;
    ok(ws.persistent && ws.data.tutorial === 'uebersprungen', 'Weltstand persistent, tutorial uebersprungen');
    ok(t.g.ship.docked && t.g.ship.dockedAt === 'hafen', 'startet angedockt im Hafen');
    const ms = t.g.mission.toSave ? t.g.mission.toSave() : null;
    ok(ms && ['m1', 'm2', 'm3'].every((id) => ms.missionen[id] && ms.missionen[id].status === 'erledigt'), 'm1–m3 gelten als erledigt');
    const skipMarks = t.g.C.campaign.skipTutorialMarks;
    ok(t.g.inventory.marks >= skipMarks, `Marken ≥ skipTutorialMarks (${t.g.inventory.marks})`);
    ok(t.events('radio').length >= 1, 'Tesk-Funk kam');
    ok(worldFiles(dir).length === 1, 'Stand angelegt');
    t.send(0, { t: 'menu', op: 'end' });
    ok(t.events('sessionEnded')[0].saved === true && t.g.snapshot().lobby.worlds.length === 1, 'Partie beenden angedockt: gesichert, Liste 1/5');
    const loaded = Weltstand.load(dir, ws.id);
    ok(loaded.ok && loaded.data.tutorial === 'uebersprungen', 'gespeichert: tutorial uebersprungen');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Rundlauf: capture -> save -> Neustart -> fortsetzen (§10.4)');
  {
    const dir = freshDir();
    const t = setup(dir, 2, { startMission: 'm1' });
    t.ready(); t.run(0.5);
    const g = t.g; const ws = g.weltstand;
    // Zustand verändern
    g.inventory.marks = 777; g.inventory.ersatzteil = 9; g.inventory.bolzen = 1; g.inventory.deko.push('lampe');
    g.upgrades.seitenturm = true;
    const slot = Object.keys(g.deco)[0]; g.deco[slot] = 'lampe';
    g.quarters.q1 = Object.assign({}, g.quarters.q1, { floor: 'fliesen', light: 'mint' });
    g.explore.reveal('b7', false); g.explore.reveal('vaelen', false); g.explore.visited.add('b7');
    g.explore.openLink('kesh');
    g.mission.flags.technikerRescued = true; g.mission.flags.decision = 'deliver'; g.mission.flags.bribed = false;
    g.ship.hull = 77; g.ship.systems.shields = 'damaged'; g.ship.systems.engines = 'offline'; g.ship.fragile.thruster_port = true;
    g.odaSeen.add('testKey'); g.scans.add('b7');
    g.plan.pins.push({ id: 'pin4', owner: 'p1', color: 0, map: 'platform', x: 3, y: 4, label: 'ziel' });
    const npcId = ws.data.npc.grauzahn ? 'grauzahn' : Object.keys(ws.data.npc)[0];
    for (let i = 0; i < 15; i++) ws.npcMemory(npcId, { ereignis: 'e' + i, text: 'Ereignis ' + i, gewicht: i === 0 ? 5 : 1 });
    ws.npcAttitude(npcId, -10);
    ws.npcStatus('ivo', 'vermisst');
    ws.fact('tafel_von_kesh', 'konkordat_archiv', 'm3');
    ws.chronicle({ text: 'Testchronik', mission: 'm1', ausgang: 'erfolg' });
    const mem = ws.data.npc[npcId].gedaechtnis;
    ok(mem.length === 12 && mem[0].ereignis === 'e0' && !mem.some((e) => e.ereignis === 'e1'), 'Gedächtnis max. 12, ältester mit kleinstem Gewicht fällt raus (Gewicht 5 bleibt)');
    ok(ws.data.npc[npcId].haltung === -3, 'Haltung auf −3 begrenzt');
    // angedockt -> docked-Ereignis -> am Tick-Ende speichern
    t.clear();
    g.missionEvent('docked', { loc: 'hafen' });
    g.step();
    ok(t.events('worldSaved').length === 1, 'docked -> worldSaved am Tick-Ende');
    const saved = Weltstand.load(dir, ws.id).data;
    ok(saved.schiff.systeme.engines === 'ok' && saved.schiff.systeme.thruster_port === 'damaged' && saved.schiff.systeme.shields === 'damaged', 'offline -> ok, fragile -> damaged');
    ok(saved.missionen && saved.missionen.missionen && saved.missionen.aktiv === 'm1', 'missionen = mission.toSave() (aktiv m1)');
    ok(saved.meta && saved.meta.spieler.length === 2, 'meta.spieler');
    t.send(0, { t: 'menu', op: 'end' });

    // „Server neu starten“: neue Game-Instanz auf demselben Ordner
    const t2 = setup(dir, 1, null);
    const list = t2.g.snapshot().lobby.worlds;
    ok(list.length === 1 && list[0].id === ws.id && list[0].state === 'ok', 'neuer Prozess sieht den Stand');
    ok(list[0].mission === 'm1' && Array.isArray(list[0].spieler) && list[0].spieler.length === 2 && list[0].chronikLast === 'Testchronik', 'Listeneintrag: mission, spieler, chronikLast');
    t2.send(0, { t: 'lobbyOpt', world: ws.id });
    ok(t2.g.snapshot().lobby.world === ws.id, 'lobbyOpt world gesetzt');
    t2.ready(); t2.run(0.2);
    const g2 = t2.g;
    ok(t2.events('worldLoaded').length === 1 && g2.phase === 'play', 'worldLoaded, Partie läuft');
    ok(g2.weltstand.id === ws.id && g2.weltstand.persistent, 'gleicher Weltstand, persistent');
    ok(g2.inventory.marks === 777 && g2.inventory.ersatzteil === 9 && g2.inventory.bolzen === 1 && g2.inventory.deko.includes('lampe'), 'Marken, Lager, Deko');
    ok(g2.upgrades.seitenturm === true && g2.deco[slot] === 'lampe', 'Ausbauten, Deko-Platz');
    ok(g2.quarters.q1.floor === 'fliesen' && g2.quarters.q1.light === 'mint', 'Quartier');
    ok(g2.explore.isKnown('b7') && g2.explore.isKnown('vaelen') && g2.explore.visited.has('b7') && g2.explore.linksOpen.has('kesh'), 'Orte bekannt/besucht, Verbindung offen');
    ok(g2.mission.flags.technikerRescued === true && g2.mission.flags.decision === 'deliver', 'Flags');
    ok(g2.ship.hull === 77 && g2.ship.systems.shields === 'damaged' && g2.ship.systems.engines === 'ok', 'Hülle, Systeme');
    ok(g2.odaSeen.has('testKey') && g2.scans.has('b7') && g2.plan.pins.some((p) => p.id === 'pin4') && g2.plan.seq >= 4, 'ODA-Merker, Scans, Pins');
    ok(g2.weltstand.data.npc[npcId].gedaechtnis.length === 12 && g2.weltstand.data.npc[npcId].haltung === -3, 'NSC-Gedächtnis und Haltung');
    ok(!g2.weltstand.data.npc.ivo || g2.weltstand.data.npc.ivo.status === 'vermisst', 'NSC-Status vermisst');
    ok(g2.weltstand.data.fakten.tafel_von_kesh === 'konkordat_archiv' && g2.weltstand.data.chronik.length === 1, 'Fakten, Chronik');
    ok(g2.ship.docked && g2.ship.dockedAt === 'hafen', 'angedockt im Hafen');
    ok(g2.mission.activeId === 'm1', 'm1 läuft weiter');
    ok(g2.stats.elapsed >= saved.spielzeit_s, `Spielzeit läuft weiter (${Math.round(g2.stats.elapsed)} s)`);
    // Chronik im Log-Slot
    let chron = null;
    for (let i = 0; i < 40 && !chron; i++) { const s = g2.snapshot(); if (s.mission.chronik) chron = s.mission.chronik; }
    ok(chron && chron.length === 1 && chron[0].text === 'Testchronik', 'mission.chronik im Log-Slot');
    // Sperre durch diesen Prozess -> zweiter „Prozess“ (anderer pid) simuliert über Sperrdatei
    ok(fs.existsSync(path.join(dir, ws.id + '.lock')), 'Sperre beim Laden gesetzt');
    t2.send(0, { t: 'menu', op: 'end' });
    ok(t2.g.weltstand.persistent === false && t2.g.phase === 'lobby', 'nach end: Lobby, Laufzeit-Weltstand nicht persistent');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Mitten in m2 angedockt bei Vaelen (§10.4)');
  {
    const dir = freshDir();
    const t = setup(dir, 1, { startMission: 'm1' });
    t.ready(); t.run(0.2);
    const g = t.g;
    if (typeof g.mission.toSave !== 'function' || typeof g.mission.restore !== 'function') skip('mission.toSave/restore fehlen (ENGINE)');
    else {
      const err = g.mission.forceStep('m2', 'vaelen');
      g.debugGoto('vaelen', true);
      t.run(0.5);
      g.missionEvent('docked', { loc: 'vaelen' }); g.step();
      ok(!err && g.mission.activeId === 'm2' && g.mission.state.stage === 'vaelen', 'm2/vaelen erreicht');
      const flagsBefore = JSON.stringify(g.mission.flags);
      const id = g.weltstand.id;
      t.send(0, { t: 'menu', op: 'end' });
      const t2 = setup(dir, 1, { world: id });
      t2.ready(); t2.run(0.5);
      ok(t2.g.mission.activeId === 'm2' && t2.g.mission.state.stage === 'vaelen', 'nach Laden: m2 bei Schritt vaelen');
      ok(t2.g.ship.docked && t2.g.ship.dockedAt === 'vaelen', 'angedockt bei Vaelen');
      ok(JSON.stringify(t2.g.mission.flags) === flagsBefore || Object.keys(JSON.parse(flagsBefore)).every((k) => JSON.stringify(t2.g.mission.flags[k]) === JSON.stringify(JSON.parse(flagsBefore)[k])), 'Flags gleich');
      const ms = t2.g.mission.toSave();
      ok(ms.missionen.m1 && ms.missionen.m1.status === 'erledigt', 'm1 bleibt erledigt');
      ok(t2.g.errors === 0, `keine Fehler (${t2.g.errors})`);
      t2.send(0, { t: 'menu', op: 'end' });
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  section('missionDone speichert auch ohne Dock');
  {
    const dir = freshDir();
    const t = setup(dir, 1, { startMission: 'm1' });
    t.ready(); t.run(0.2);
    t.g.debugGoto('b7', false);
    t.clear();
    t.g.emit('missionDone', { id: 'x', title: 'Test', ausgang: 'erfolg' });
    t.g.step();
    const ev = t.events('worldSaved');
    ok(ev.length === 1 && ev[0].loc === 'hafen', 'missionDone -> worldSaved mit letztem Andockort hafen');
    // abgedockt: Partie beenden speichert nicht
    t.clear();
    t.send(0, { t: 'menu', op: 'end' });
    ok(t.events('sessionEnded')[0].saved === false && t.events('worldSaved').length === 0, 'Partie beenden ohne Dock: saved false');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Testgelände und Direktstart m3 legen keinen Weltstand an (§10.6)');
  for (const sm of ['m3', 'arena_space', 'arena_away']) {
    const dir = freshDir();
    const t = setup(dir, 1, { startMission: sm });
    t.ready(); t.run(3);
    t.g.missionEvent('docked', { loc: 'hafen' }); t.g.emit('missionDone', { id: 'x' }); t.run(11);
    t.send(0, { t: 'menu', op: 'end' });
    ok(fs.readdirSync(dir).length === 0 && t.events('worldSaved').length === 0, `${sm}: kein Stand, kein worldSaved`);
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Fünf Weltstände, sechster verlangt Löschen (§10.5)');
  {
    const dir = freshDir();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(makeCampaign(dir, i % 2 ? 'free' : 'm1'));
    ok(worldFiles(dir).length === 5 && new Set(ids).size === 5, '5 verschiedene Stände');
    const t = setup(dir, 1, { startMission: 'm1' });
    ok(t.g.snapshot().lobby.worldsFull === true, 'worldsFull true');
    t.ready();
    ok(t.g.phase === 'lobby' && t.notices(0).some((x) => x.includes('Erst einen Weltstand löschen')), 'Start abgelehnt mit Hinweis');
    ok(t.g.players[0].ready === false, 'Spieler wieder nicht bereit');
    // Fortsetzen geht trotzdem
    t.send(0, { t: 'lobbyOpt', world: ids[0] });
    const nOda = t.events('oda').length;
    t.ready();
    ok(t.g.phase === 'play' && t.g.weltstand.id === ids[0], 'Fortsetzen bei 5 Ständen möglich');
    ok(!t.events('oda').slice(nOda).some((e) => /Lichtkordon|Neuer Ort/.test(e.text || '')), 'Fortsetzen: kein „Erstbesuch Hafen“ aus dem reset() (QA-Abnahme)');
    t.send(0, { t: 'menu', op: 'end' });
    ok(t.g.lobbyOpts.world === ids[0] && t.g.snapshot().lobby.world === ids[0], 'nach „Partie beenden“: gespielter Stand in der Lobby vorausgewählt (QA-Abnahme)');
    // Löschen
    t.send(0, { t: 'world', op: 'delete', id: ids[1] });
    ok(worldFiles(dir).length === 4 && !fs.existsSync(path.join(dir, ids[1] + '.bak.json')) && t.g.snapshot().lobby.worldsFull === false, 'world delete: 4 Stände, .bak mit gelöscht');
    t.send(0, { t: 'world', op: 'delete', id: '../../evil' });
    ok(t.notices(0).length > 0 && worldFiles(dir).length === 4, 'ungültige ID wird abgelehnt');
    t.send(0, { t: 'lobbyOpt', world: null });   // „Neu: Kampagne“ statt des vorausgewählten Stands
    t.ready();
    ok(t.g.phase === 'play' && worldFiles(dir).length === 5, 'danach neue Kampagne möglich');
    t.send(0, { t: 'menu', op: 'end' });
    // abwechselnd fortsetzen: nichts vermischt sich
    const a = setup(dir, 1, { world: ids[2] }); a.ready(); a.run(0.1); a.g.inventory.marks = 1111; a.send(0, { t: 'menu', op: 'end' });
    const b = setup(dir, 1, { world: ids[3] }); b.ready(); b.run(0.1); b.g.inventory.marks = 2222; b.send(0, { t: 'menu', op: 'end' });
    ok(Weltstand.load(dir, ids[2]).data.schiff.marken === 1111 && Weltstand.load(dir, ids[3]).data.schiff.marken === 2222, 'zwei Stände abwechselnd: Marken getrennt');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Eindeutige Namen am selben Tag (QA-Abnahme)');
  {
    const dir = freshDir();
    const ids = [makeCampaign(dir, 'm1'), makeCampaign(dir, 'free'), makeCampaign(dir, 'm1')];
    const names = ids.map((id) => Weltstand.list(dir).find((x) => x.id === id).name);
    ok(new Set(names).size === 3 && /^Lerche · \d\d\.\d\d\.$/.test(names[0]) && names[1] === names[0] + ' (2)' && names[2] === names[0] + ' (3)',
      `drei Stände, drei Namen: ${names.join(' | ')}`);
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Kaputte Stände (§10.7)');
  {
    const dir = freshDir();
    const id = makeCampaign(dir, 'm1');
    const main = path.join(dir, id + '.json'), bak = path.join(dir, id + '.bak.json');
    // ohne .bak: abgeschnitten
    if (fs.existsSync(bak)) fs.unlinkSync(bak);
    const full = fs.readFileSync(main, 'utf8');
    fs.writeFileSync(main, full.slice(0, Math.floor(full.length / 2)));
    let l = Weltstand.list(dir);
    ok(l.length === 1 && l[0].state === 'kaputt' && typeof l[0].grund === 'string', `abgeschnitten -> kaputt („${l[0] && l[0].grund}“)`);
    const t = setup(dir, 1, { startMission: 'm1' });
    t.g.lobbyOpts.world = id;   // Client hätte ihn nicht wählen dürfen – trotzdem kein Absturz
    t.ready();
    ok(t.g.phase === 'lobby' && t.events('worldLoadFailed').length === 1, 'Fortsetzen: worldLoadFailed, zurück in der Lobby');
    ok(fs.readdirSync(dir).some((f) => f.startsWith(id + '.kaputt-')) && !fs.existsSync(main), 'kaputte Datei umbenannt (.kaputt-<ts>.json)');
    l = Weltstand.list(dir);
    ok(l.length === 1 && l[0].state === 'kaputt', 'Liste zeigt beiseitegelegten Stand als kaputt');
    t.ready();
    ok(t.g.phase === 'play', 'neues Spiel möglich');
    t.send(0, { t: 'menu', op: 'end' });
    t.send(0, { t: 'world', op: 'delete', id });
    ok(!fs.readdirSync(dir).some((f) => f.startsWith(id + '.')), 'kaputten Stand löschen entfernt alle Dateien');
    // mit .bak
    const id2 = makeCampaign(dir, 'm1');
    const t3 = setup(dir, 1, { world: id2 }); t3.ready(); t3.g.inventory.marks = 4242; t3.send(0, { t: 'menu', op: 'end' });
    ok(fs.existsSync(path.join(dir, id2 + '.bak.json')), '.bak vorhanden');
    fs.writeFileSync(path.join(dir, id2 + '.json'), '{"version":1,"id":"' + id2 + '"');
    ok(Weltstand.list(dir).find((x) => x.id === id2).state === 'ok', 'Liste: kaputte Datei mit gültiger .bak -> ok');
    const r = Weltstand.load(dir, id2);
    ok(r.ok && r.fromBak && r.data.id === id2, 'load nutzt .bak');
    // Schemafehler
    const d3 = JSON.parse(fs.readFileSync(path.join(dir, id2 + '.bak.json'), 'utf8'));
    const id3 = 'w-sche';
    fs.writeFileSync(path.join(dir, id3 + '.json'), JSON.stringify(Object.assign({}, d3, { id: id3, schiff: { name: 'Lerche', marken: -5, lager: {} } })));
    const r3 = Weltstand.load(dir, id3);
    ok(!r3.ok && r3.state === 'kaputt' && /Format/.test(r3.error), 'Schemafehler -> kaputt mit Grund');
    // neuere Version
    const id4 = 'w-neu1';
    fs.writeFileSync(path.join(dir, id4 + '.json'), JSON.stringify(Object.assign({}, d3, { id: id4, version: 2 })));
    ok(Weltstand.list(dir).find((x) => x.id === id4).state === 'neuer', 'neuere Version -> neuer');
    const r4 = Weltstand.load(dir, id4);
    ok(!r4.ok && r4.state === 'neuer' && fs.existsSync(path.join(dir, id4 + '.json')), 'neuere Version wird nicht geladen und nicht umbenannt');
    // Unsinn
    ok(Weltstand.load(dir, '../x').ok === false && Weltstand.load(dir, 'w-gibtsnicht').ok === false, 'ungültige/fehlende ID: kein Wurf');
  }

  // ------------------------------------------------------------------------------------------------------------
  section('Sperre (zweiter Prozess, §10.5)');
  return lockTests().then(asyncTests).then(() => {
    // ----------------------------------------------------------------------------------------------------------
    section('Spielmenü: Pause nur solo (§10.8)');
    {
      const dir = freshDir();
      const t = setup(dir, 1, { startMission: 'm1' });
      t.ready(); t.run(0.2);
      const time0 = t.g.time;
      t.send(0, { t: 'menu', op: 'pause', on: true });
      t.run(2);
      ok(t.g.paused === true && t.g.time === time0 && t.g.snapshot().paused === true, 'solo: Pause hält die Simulation an');
      t.send(0, { t: 'menu', op: 'pause', on: false }); t.run(1);
      ok(t.g.paused === false && t.g.time > time0, 'Pause aus: läuft weiter');
      t.send(0, { t: 'menu', op: 'pause', on: true }); t.run(0.1);
      const c = { inbox: [], send(o) { this.inbox.push(o); } };
      t.g.addConnection(c); t.g.handleMessage(c, { t: 'hello', clientId: 'X2', name: 'Zweite' });
      t.run(0.5);
      ok(t.g.paused === false, 'zweiter Spieler kommt dazu -> Pause aus');
      t.g.handleMessage(c, { t: 'menu', op: 'pause', on: true }); t.run(0.5);
      ok(t.g.paused === false, 'zu zweit: Pause wirkungslos');
      t.g.removeConnection(c);
      t.send(0, { t: 'menu', op: 'pause', on: true }); t.run(0.1);
      ok(t.g.paused === true, 'wieder solo: Pause');
      t.g.removeConnection(t.conns[0]); t.run(0.1);
      ok(t.g.paused === false, 'Spieler trennt -> Pause aus');
      const lobbyT = setup(freshDir(), 1, null);
      lobbyT.send(0, { t: 'menu', op: 'pause', on: true });
      ok(lobbyT.g.paused === false, 'Lobby: keine Pause');
    }

    // ----------------------------------------------------------------------------------------------------------
    section('Menü end zu dritt (§10.8)');
    {
      const dir = freshDir();
      const t = setup(dir, 3, { startMission: 'm1' });
      t.ready(); t.run(1);
      t.send(2, { t: 'menu', op: 'end' });
      const se = t.events('sessionEnded')[0];
      ok(se && se.byName === 'Crew2' && t.g.phase === 'lobby' && t.g.players.length === 3 && t.g.players.every((p) => !p.ready && p.connected), 'alle in der Lobby, verbunden, nicht bereit; alle sehen, wer es war');
      t.send(0, { t: 'world', op: 'delete', id: 'x' });
      t.ready();
      ok(t.g.phase === 'play', 'neue Partie startet wieder');
      t.send(0, { t: 'menu', op: 'end' });
    }

    // ----------------------------------------------------------------------------------------------------------
    section('Snapshot-Größe im Spiel (< 13 KB)');
    {
      const dir = freshDir();
      const t = setup(dir, 3, { startMission: 'm1' });
      t.ready();
      const ws = t.g.weltstand;
      for (let i = 0; i < 10; i++) ws.chronicle({ text: 'Ein ziemlich langer Chronikeintrag Nummer ' + i + ' – '.padEnd(200, 'x'), mission: 'm1', ausgang: 'erfolg' });
      let max = 0, maxLobby = 0;
      for (let k = 0; k < 30 * 60; k++) {
        t.g.step();
        if (t.g.wantsSnapshot()) max = Math.max(max, Buffer.byteLength(JSON.stringify(t.g.snapshot())));
      }
      for (const sm of ['m3']) { t.g.mission.forceStep(sm, null); }
      for (let k = 0; k < 30 * 20; k++) { t.g.step(); if (t.g.wantsSnapshot()) max = Math.max(max, Buffer.byteLength(JSON.stringify(t.g.snapshot()))); }
      ok(max < 13 * 1024, `Snapshot im Spiel max ${(max / 1024).toFixed(2)} KB (inkl. 10 Chronik-Einträge im Log-Slot)`);
      t.send(0, { t: 'menu', op: 'end' });
      for (let i = 0; i < 4; i++) makeCampaign(dir, 'm1');
      const l = setup(dir, 3, null);
      maxLobby = Buffer.byteLength(JSON.stringify(l.g.snapshot()));
      ok(maxLobby < 13 * 1024, `Lobby-Snapshot mit 5 Ständen ${(maxLobby / 1024).toFixed(2)} KB`);
      console.log('  info Snapshot-Größe: Spiel ' + max + ' B, Lobby ' + maxLobby + ' B');
    }
  });
}

// Server-Normalbetrieb: Schreiben per setImmediate nach dem Tick
async function asyncTests() {
  section('Speichern im Normalbetrieb (Schreiben nach dem Tick)');
  const tick = () => new Promise((r) => setImmediate(r));
  const dir = freshDir();
  const t = setup(dir, 1, { startMission: 'm1' }, { worldSaveSync: false });
  t.ready();
  ok(worldFiles(dir).length === 0 && t.events('worldSaved').length === 0, 'direkt nach dem Start: erfasst, noch nicht geschrieben');
  await tick(); await tick();
  ok(worldFiles(dir).length === 1 && t.events('worldSaved').length === 1, 'nach setImmediate: Datei + worldSaved');
  ok(t.g.lastCaptureMs < 5, `Tick-Anteil (Erfassen) ${t.g.lastCaptureMs} ms`);
  // älterer asynchroner Stand darf einen neueren synchronen nicht überschreiben
  t.g.inventory.marks = 100; t.g.missionEvent('docked', { loc: 'hafen' }); t.g.step();   // async geplant (100)
  t.g.inventory.marks = 200; t.send(0, { t: 'menu', op: 'end' });                     // sync (200)
  await tick(); await tick();
  ok(Weltstand.load(dir, t.g.worldList[0].id).data.schiff.marken === 200, 'neuester Stand bleibt (200 Marken)');
}

// Zweiter Prozess: hält die Sperre (lock) eines Stands, solange er läuft
function lockTests() {
  const dir = freshDir();
  const id = makeCampaign(dir, 'm1');
  const child = spawn(process.execPath, ['-e', `
    const W = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'weltstand.js'))});
    const r = W.lock(${JSON.stringify(dir)}, ${JSON.stringify(id)}, { port: 9999 });
    process.stdout.write(r.ok ? 'locked\\n' : 'fail\\n');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => {
    let out = '';
    const timer = setTimeout(() => { ok(false, 'zweiter Prozess meldet sich nicht'); child.kill(); resolve(); }, 8000);
    child.stdout.on('data', (d) => {
      out += d;
      if (!out.includes('\n')) return;
      clearTimeout(timer);
      ok(out.startsWith('locked'), 'zweiter Prozess sperrt den Stand');
      const l = Weltstand.list(dir);
      ok(l[0].state === 'belegt' && l[0].grund, 'Liste: belegt');
      ok(Weltstand.lock(dir, id, {}).ok === false, 'lock() im ersten Prozess scheitert');
      const t = setup(dir, 1, null);
      t.send(0, { t: 'lobbyOpt', world: id });
      ok(t.g.lobbyOpts.world === null && t.notices(0).length === 1, 'lobbyOpt auf belegten Stand: abgelehnt mit Hinweis');
      t.send(0, { t: 'world', op: 'delete', id });
      const err = t.conns[0].inbox.find((m) => m.t === 'error');
      ok(err && err.code === 'worldbusy' && worldFiles(dir).length === 1, 'Löschen gesperrt -> error worldbusy');
      t.g.lobbyOpts.world = id; t.ready();
      ok(t.g.phase === 'lobby' && t.events('worldLoadFailed').length === 1, 'Fortsetzen trotz Sperre -> worldLoadFailed');
      child.kill();
      child.on('exit', () => {
        // verwaiste Sperre (pid läuft nicht mehr) wird übernommen
        const l2 = Weltstand.list(dir);
        ok(l2[0].state === 'ok', 'nach Ende des zweiten Prozesses: verwaiste Sperre -> ok');
        const t2 = setup(dir, 1, { world: id }); t2.ready();
        ok(t2.g.phase === 'play' && t2.g.weltstand.id === id, 'Fortsetzen übernimmt verwaiste Sperre');
        t2.send(0, { t: 'menu', op: 'end' });
        resolve();
      });
    });
  });
}

Promise.resolve().then(main).catch((e) => { fails++; console.error(e); }).finally(() => {
  try { fs.rmSync(ROOT_TMP, { recursive: true, force: true }); } catch (e) { console.warn('Aufräumen fehlgeschlagen:', e.message); }
  console.log(`\n${n - fails}/${n} Weltstand-Tests bestanden${skipped ? `, ${skipped} übersprungen` : ''}.`);
  process.exit(fails ? 1 : 0);
});
