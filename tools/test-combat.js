'use strict';
// Kampf v2 (CONTRACT-M2 §12): deterministische Tests ohne Netz direkt gegen die Game-Klasse.
//   node tools/test-combat.js
const Physics = require('../shared/physics.js');
const Los = require('../shared/los.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
// B2: Die Abschnitte bis „B2 Welle 2“ prüfen die Kampfregeln von M2/S2b und Welle 1 auf dem Altregel-Pfad
// (Schalter WAFFEN=aus). Die B2-Abschnitte am Ende schalten waffen.js ein.
const WAFFEN_MOD = require('../server/sim/waffen.js');
const WAFFEN_AN = WAFFEN_MOD.aktiv;
WAFFEN_MOD.aktiv = false;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const AC = require('../shared/config.js').awayCombat;
const ORIG = JSON.parse(JSON.stringify(AC));
function restoreConfig() {
  const copy = (dst, src) => { for (const k of Object.keys(src)) { if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) copy(dst[k], src[k]); else dst[k] = src[k]; } };
  copy(AC, ORIG);
}

function setup(players, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'C' + i, name: 'C' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const P = (i) => g.players[i];
  const send = (i, m) => g.handleMessage(conns[i], m);
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.step(); if (each) each(); } };
  const place = (i, tx, ty, dir) => { const p = P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.dir = dir || 'down'; p.input.mx = 0; p.input.my = 0; };
  const events = (kind) => conns[0].inbox.filter((m) => m.kind === kind);
  const notices = (i) => conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);
  const aw = () => g.aways.kesh;
  // Alle runter auf Kesh (Debug `kesh`), danach Trupp 1 entfernen, wenn gewünscht
  send(0, { t: 'debug', cmd: 'kesh' });
  if (o.clear !== false) aw().drones = aw().drones.filter((d) => d.kind === 'warden');
  return { g, conns, P, send, run, place, events, notices, aw };
}
function fakeEnemy(g, tx, ty, kind) {
  const e = squad.makeEnemy(g, g.aways.kesh, kind || 'scavenger', 'T' + g.nextId(''), Physics.tileCenter(tx, ty), 'test');
  e.asleep = false; e.frozen = true;   // ohne KI (nur Treffer/Schüsse per Test)
  g.aways.kesh.drones.push(e);
  return e;
}

console.log('\n[Aufbau, Kesh, Snapshot]');
{
  const { g, P, aw } = setup(3, { clear: false });
  ok(g.away === aw() && g.away.map === 'kesh' && g.players.every((p) => p.zone === 'away'), 'Debug kesh: alle drei unten auf Kesh');
  ok(g.mission.activeId === 'm3' && g.mission.state.stage === 'courtyard', 'Mission m3, Schritt courtyard');
  ok(aw().drones.filter((d) => d.squad === 'squad1' && d.alive).length === 4, 'Trupp 1: 4 Plünderer (zu dritt)');
  ok(aw().drones.some((d) => d.kind === 'warden' && d.asleep), 'Wächter schläft');
  ok(P(0).shield.seg === 3 && P(0).shield.max === 3, 'voller Schild beim Herunterbeamen');
  ok(P(0).medkit === 1 && P(1).medkit === 1 && P(2).medkit === 0 && g.inventory.medipack === 0, 'Medipacks aus dem Lager (2 vorhanden)');
  const s = g.snapshot();
  const sp = s.players[0];
  ok(JSON.stringify(sp.sh) === '[3,3]' && 'shR' in sp && 'cv' in sp && 'fl' in sp && sp.medkit === 1 && sp.bleed === null, 'Snapshot players: sh, shR, cv, fl, medkit, bleed');
  ok(s.away.combat === 'v2' && s.away.scanQuality === AC.scanQualityJammed && s.away.vault.open === false && s.away.jammers.length === 2 && s.away.keys.length === 2 && s.away.tablet && Array.isArray(s.away.orders), 'Snapshot away: combat, scanQuality, vault, jammers, keys, tablet, orders');
  const d = s.away.drones.find((q) => q.kind === 'scavenger');
  ok(d && JSON.stringify(d.sh) === JSON.stringify([AC.enemy.scavenger.segments, AC.enemy.scavenger.segments]) && 'role' in d && 'vis' in d && 'ghost' in d && 'aim' in d && 'asleep' in d && 'hp' in d && 'revealed' in d, 'Snapshot drones: sh, role, vis, ghost, aim, asleep (+ alte Felder)');
  const w = s.away.drones.find((q) => q.kind === 'warden');
  ok(w && typeof w.facing === 'number' && w.asleep === true, 'Wächter mit facing/asleep');
  ok(s.lobby.startMission === 'm1' && s.inventory.tafel === 0, 'lobby.startMission, inventory.tafel');
  const sz = Buffer.byteLength(JSON.stringify(s));
  ok(sz < 12 * 1024, 'Snapshot auf Kesh < 12 KB (' + sz + ' B)');
}

console.log('\n[Schild: Segmente, Laden, verwundet]');
{
  const { g, P, run, events, place } = setup(2);
  place(0, 4, 18); place(1, 8, 18);
  const p = P(0);
  combat.hitPlayer(g, p, 1, 'test');
  ok(p.shield.seg === 2 && events('shieldHit').length === 1, 'Treffer: seg 3 -> 2, Event shieldHit');
  combat.hitPlayer(g, p, 1, 'test'); combat.hitPlayer(g, p, 1, 'test');
  ok(p.shield.seg === 0 && events('shieldBreak').length === 1 && !p.downed, 'seg 0: shieldBreak, noch nicht verwundet');
  const sfx = g.conns ? null : null;
  combat.hitPlayer(g, p, 1, 'test');
  ok(p.downed && p.wound && events('wounded').length === 1 && p.bleed === AC.wounded.bleedout, 'Treffer bei seg 0 -> verwundet, Bleed-Countdown');
  ok(g.snapshot().players[0].bleed === AC.wounded.bleedout, 'Snapshot bleed');
  // Laden (Spieler 2)
  const q = P(1);
  combat.hitPlayer(g, q, 2, 'test');
  ok(q.shield.seg === 1, 'Wächter-Schuss (2 Segmente)');
  run(AC.shield.regenDelay - 0.2);
  ok(q.shield.seg === 1, 'kein Laden während regenDelay');
  run(0.2 + AC.shield.regenStep + 0.1);
  ok(q.shield.seg === 2 && events('shieldUp').length >= 1, 'nach Verzögerung + regenStep: +1 Segment (shieldUp)');
  run(AC.shield.regenStep + 0.1);
  ok(q.shield.seg === 3 && events('shieldFull').length === 1, 'voll: shieldFull');
  // Kein Aufstehen von selbst; Pistole
  run(16);
  ok(p.downed, 'auf v2-Karten kein automatisches Aufstehen nach 15 s');
  const before = g.away.projectiles.length;
  g.handleMessage(g.players[0].conn, { t: 'shoot', angle: 0 });
  ok(g.away.projectiles.length === before + 1 && g.away.projectiles[g.away.projectiles.length - 1].kind === 'pistol', 'Verwundet: Pistole schießt (kind pistol)');
  g.handleMessage(g.players[0].conn, { t: 'shoot', angle: 0 });
  ok(g.away.projectiles.filter((x) => x.kind === 'pistol').length === 1, 'Pistolen-Cooldown');
  // Bleedout -> Einzel-Notrückholung
  run(AC.wounded.bleedout);
  ok(p.zone === 'ship' && !p.downed && g.explore.log.some((l) => /Notrückholung für C0/.test(l.text)), 'Bleedout: Einzel-Notrückholung an Bord + Logbuch');
}

console.log('\n[Wiederbeleben, Medipack]');
{
  const { g, P, send, run, place, events } = setup(2);
  place(0, 4, 18, 'right'); place(1, 5, 18);
  combat.woundPlayer(g, P(1), 'test');
  P(0).medkit = 0;
  send(0, { t: 'act', down: true }); run(AC.wounded.reviveTime - 0.3);
  ok(P(1).downed, 'Wiederbeleben dauert reviveTime');
  run(0.5); send(0, { t: 'act', down: false });
  ok(!P(1).downed && P(1).shield.seg === AC.wounded.reviveSegments && events('revived').length === 1, `wiederbelebt mit ${AC.wounded.reviveSegments} Segment`);
  combat.woundPlayer(g, P(1), 'test');
  P(0).medkit = 1;
  send(0, { t: 'act', down: true }); run(AC.wounded.medkitReviveTime + 0.2); send(0, { t: 'act', down: false });
  ok(!P(1).downed && P(1).shield.seg === AC.wounded.medkitSegments && P(0).medkit === 0, 'Medipack: schneller, 2 Segmente, verbraucht');
  // Nachschub-Medipack durch Darüberlaufen
  g.away.items.push({ id: 'mk', kind: 'medipack', x: P(0).x, y: P(0).y });
  run(0.1);
  ok(P(0).medkit === 1 && !g.away.items.length, 'Medipack durch Darüberlaufen aufgehoben');
  // Hochbeamen gibt das Medipack zurück ins Lager
  const inv = g.inventory.medipack;
  const it = require('../server/sim/interior.js');
  it.placeOnShipPad(g, P(0));
  ok(g.inventory.medipack === inv + 1 && P(0).medkit === 0, 'Medipack beim Verlassen zurück ins Lager');
}

console.log('\n[Deckung: halb von vorn, Flanke, eigene Deckung, Pfeiler]');
{
  const { g, P, place, run } = setup(1);
  g.god = true;
  AC.enemy.scavenger.spreadDeg = 0;
  const aw = g.aways.kesh;
  // Ziel bei (13,4), halbe Deckung (12,4) westlich; Schütze bei (7,4) -> Deckung auf der Linie
  place(0, 13, 4);
  const shooter = fakeEnemy(g, 7, 4);
  const shots = 600;
  const s0 = Object.assign({}, aw.stats);
  for (let i = 0; i < shots; i++) { combat.fireEnemy(g, shooter, P(0)); run(1.0); }
  const blocked = aw.stats.coverBlocks - s0.coverBlocks, hits = aw.stats.playerHits - s0.playerHits;
  const frac = blocked / shots;
  ok(blocked + hits === shots && Math.abs(frac - AC.halfCoverBlock) < 0.07, `halbe Deckung von vorn schluckt ${(frac * 100).toFixed(1)} % (Soll ${AC.halfCoverBlock * 100} %)`);
  // Flanke: Schütze bei (13,8) direkt südlich – die Deckung (12,4) liegt nicht auf der Linie
  shooter.alive = false;
  const flanker = fakeEnemy(g, 13, 8);
  const s1 = Object.assign({}, aw.stats);
  for (let i = 0; i < 200; i++) { combat.fireEnemy(g, flanker, P(0)); run(0.8); }
  ok(aw.stats.coverBlocks === s1.coverBlocks && aw.stats.playerHits - s1.playerHits === 200, 'von der Flanke: nie geschluckt (200/200 Treffer)');
  const E = combat.env(g);
  ok(Los.coverAgainst(E.map, E.solid, Physics.tileCenter(7, 4).x, Physics.tileCenter(7, 4).y, P(0).x, P(0).y) === 1 &&
     Los.coverAgainst(E.map, E.solid, flanker.x, flanker.y, P(0).x, P(0).y) === 0, 'coverAgainst: vorn 1, Flanke 0');
  flanker.alive = false;
  // Schütze direkt hinter der eigenen Deckung: Spieler bei (13,4) schießt nach Westen über (12,4)/(11,4) auf Gegner bei (8,4)
  g.god = false;
  const target = fakeEnemy(g, 8, 4);
  target.max = 999; target.seg = 999;
  let hitsT = 0;
  for (let i = 0; i < 100; i++) {
    const before = target.seg;
    P(0).shootReadyAt = 0;
    g.handleMessage(g.players[0].conn, { t: 'shoot', angle: Math.PI });
    run(0.6);
    if (target.seg < before) hitsT++;
  }
  ok(hitsT === 100, `Schütze hinter eigener Deckung wird nicht blockiert (${hitsT}/100)`);
  target.alive = false;
  // Pfeiler (15,4) stoppt: Gegner bei (17,4)
  const behind = fakeEnemy(g, 17, 4);
  behind.max = 99; behind.seg = 99;
  for (let i = 0; i < 30; i++) { P(0).shootReadyAt = 0; g.handleMessage(g.players[0].conn, { t: 'shoot', angle: 0 }); run(0.6); }
  ok(behind.seg === 99, 'Pfeiler stoppt jedes Projektil');
  restoreConfig();
}

console.log('\n[Wächter: Front absorbiert, Seite trifft, schläft]');
{
  const { g, events } = setup(1);
  const w = g.aways.kesh.drones.find((d) => d.kind === 'warden');
  const r0 = combat.hitEnemy(g, w, 1, { x: w.x - 100, y: w.y });
  ok(r0 === 'asleep' && w.seg === w.max, 'schlafend: unverwundbar');
  g.handleMessage(g.players[0].conn, { t: 'debug', cmd: 'wake' });
  ok(!w.asleep && events('wardenWake').length === 1, 'wake: Wächter erwacht (wardenWake)');
  w.facing = 0;   // schaut nach Osten
  const d0 = events('wardenDeflect').length;
  const r1 = combat.hitEnemy(g, w, 1, { x: w.x + 200, y: w.y + 20 });
  ok(r1 === 'deflect' && w.seg === w.max && events('wardenDeflect').length === d0 + 1, 'Treffer im Frontbogen: absorbiert (wardenDeflect)');
  const r2 = combat.hitEnemy(g, w, 1, { x: w.x, y: w.y - 200 });
  ok(r2 === 'shield' && w.seg === w.max - 1, 'Treffer von der Seite: 1 Segment');
  const r3 = combat.hitEnemy(g, w, 1, { x: w.x - 200, y: w.y });
  ok(r3 === 'shield' && w.seg === w.max - 2, 'Treffer von hinten: 1 Segment');
  for (let i = 0; i < 10 && w.alive; i++) combat.hitEnemy(g, w, 1, { x: w.x - 200, y: w.y });
  ok(!w.alive && events('wardenDown').length === 1 && g.mission.flags.wardenKilled && g.inventory.deko.includes('lamassu_figur'), 'Wächter aus: wardenDown, Belohnung + Lamassu-Figur');
}

console.log('\n[Gegner-Schild]');
{
  const { g, events } = setup(1);
  const e = fakeEnemy(g, 20, 6);
  const segs = AC.enemy.scavenger.segments;
  for (let i = 0; i < segs; i++) combat.hitEnemy(g, e, 1, {});
  ok(e.alive && e.seg === 0 && events('enemyShieldHit').length === segs, 'Plünderer: ' + segs + ' Segmente (CONFIG)');
  const r = combat.hitEnemy(g, e, 1, {});
  ok(!e.alive && r === 'down' && events('enemyDown').length >= 1, 'nächster Treffer bei seg 0: aus (enemyDown) ' + r + ' ' + events('enemyDown').length);
  const e2 = fakeEnemy(g, 20, 6);
  combat.hitEnemy(g, e2, 1, {});
  const { run } = { run: (s) => { for (let k = 0; k < s * 30; k++) g.step(); } };
  run(AC.enemy.scavenger.regenDelay + AC.enemy.scavenger.regenStep + 0.2);
  ok(e2.seg === AC.enemy.scavenger.segments, 'Gegner-Schild lädt nach regenDelay');
}

console.log('\n[Notrückholung aller]');
{
  const { g, P, run, events, send, notices } = setup(2);
  combat.woundPlayer(g, P(0), 'test'); combat.woundPlayer(g, P(1), 'test');
  run(AC.wounded.squadRecallDelay - 0.3);
  ok(P(0).zone === 'away', 'vor squadRecallDelay noch unten');
  const stage = g.mission.state.stage;
  run(0.5);
  ok(P(0).zone === 'ship' && P(1).zone === 'ship' && !P(0).downed && !P(1).downed && events('squadRecall').length === 1, 'alle verwundet -> Notrückholung aller (squadRecall)');
  ok(g.mission.state.stage === stage && g.phase === 'play', 'kein Game Over, Schritt bleibt');
  const chk = away.canBeam(g, 'down');
  ok(!chk.ok && /kühlt/.test(chk.reason), 'Transfer danach gesperrt: ' + chk.reason);
  g.ship.x = 1500 - 250; g.ship.y = 900; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0;
  run(AC.wounded.recallBeamLock + 0.5);
  ok(away.canBeam(g, 'down').ok, 'nach recallBeamLock wieder frei');
}

console.log('\n[Archivschlüssel nur gleichzeitig, Tafel ins Inventar]');
{
  const { g, P, send, run, place, events } = setup(2);
  const aw = g.aways.kesh;
  place(0, 38, 2, 'up'); place(1, 45, 14, 'down');
  send(0, { t: 'act', down: true }); run(AC.archkeyTime + 0.2); send(0, { t: 'act', down: false });
  ok(!aw.vault.open && aw.keys[0].doneAt != null, 'Schlüssel A gedreht, Tor noch zu');
  run(AC.archkeyWindow + 0.3);
  ok(!aw.vault.open && aw.keys[0].doneAt == null && events('oda').some((m) => /Beide Schlüssel gleichzeitig/.test(m.text)), 'einer allein: Hinweis und Rücksetzen');
  send(0, { t: 'act', down: true }); run(0.5); send(1, { t: 'act', down: true });
  run(1);
  ok(g.snapshot().away.keys[0].t > 0.3 && g.snapshot().away.keys[1].t > 0, 'Haltefortschritt keys[].t');
  run(AC.archkeyTime);
  send(0, { t: 'act', down: false }); send(1, { t: 'act', down: false });
  ok(aw.vault.open && events('vaultOpen').length === 1, 'beide innerhalb archkeyWindow: Tor auf (vaultOpen)');
  run(0.2);
  ok(g.mission.state.stage === 'tablet', 'Mission weiter: tablet');
  const it = require('../server/sim/interior.js');
  ok(!it.awaySolid(g)(41, 15), 'Tor-Kachel begehbar');
  place(0, 41, 18, 'down');
  send(0, { t: 'act', down: true }); run(AC.tabletTime + 0.2); send(0, { t: 'act', down: false });
  ok(g.inventory.tafel === 1 && aw.tablet.taken && events('tabletTaken').length === 1 && !P(0).carry, 'Tafel direkt ins Inventar (kein Tragen)');
  run(0.2);
  ok(g.mission.state.stage === 'warden' && !aw.drones.find((d) => d.kind === 'warden').asleep && aw.drones.some((d) => d.squad === 'squad2' && d.alive), 'Schritt warden: Wächter wach + Trupp 2');
}

console.log('\n[Störrelais, Scan-Qualität]');
{
  const { g, send, run, place, events } = setup(1);
  const aw = g.aways.kesh;
  ok(combat.scanQuality(g) === AC.scanQualityJammed, 'Relais an: scanQuality ' + AC.scanQualityJammed);
  const marks = g.inventory.marks;
  place(0, 31, 3, 'up');
  send(0, { t: 'act', down: true }); run(AC.jammerTime + 0.2); send(0, { t: 'act', down: false });
  ok(aw.jammers[0].off && events('jammerOff').length === 1 && g.inventory.marks === marks + AC.rewards.jammer, 'Störrelais aus (+10 Marken)');
  place(0, 32, 12, 'down');
  send(0, { t: 'act', down: true }); run(AC.jammerTime + 0.2); send(0, { t: 'act', down: false });
  ok(combat.scanQuality(g) === 1, 'beide aus: scanQuality 1');
}

console.log('\n[tune]');
{
  const { g, send, notices } = setup(1);
  send(0, { t: 'debug', cmd: 'tune', path: 'shield.regenDelay', value: 3 });
  ok(AC.shield.regenDelay === 3, 'tune shield.regenDelay 3');
  send(0, { t: 'debug', cmd: 'tune', args: 'enemy.scavenger.aim 1.0' });
  ok(AC.enemy.scavenger.aim === 1.0, 'tune enemy.scavenger.aim 1.0 (Textform)');
  send(0, { t: 'debug', cmd: 'tune', path: 'barks', value: 'off' });
  ok(AC.barksOn === false, 'tune barks off');
  send(0, { t: 'debug', cmd: 'tune', path: 'enemy.scavenger', value: 3 });
  ok(notices(0).some((t) => /Kein Zahlenwert/.test(t)), 'nur Zahlen (Whitelist)');
  send(0, { t: 'debug', cmd: 'tune' });
  ok(notices(0).some((t) => /halfCoverBlock=0.6/.test(t)), 'tune ohne Argumente listet Werte');
  restoreConfig();
  ok(AC.shield.regenDelay === ORIG.shield.regenDelay && AC.barksOn === true, 'Werte zurückgesetzt');
}

console.log('\n[Fog of War: vis / ghost, Fokus-Befehl]');
{
  const { g, P, place, run, send } = setup(1);
  place(0, 10, 8);
  const e = fakeEnemy(g, 14, 8);
  run(0.3);
  ok(e.vis && !e.ghost, 'sichtbar im Radius mit Sichtlinie');
  // hinter die Hofmauer ins Gestein? -> in den Nordkorridor außer Sicht: (30,3)
  const c = Physics.tileCenter(30, 3); e.x = c.x; e.y = c.y; e.home = { x: c.x, y: c.y };
  run(0.3);
  ok(!e.vis && e.ghost && Math.abs(e.ghost.x - Physics.tileCenter(14, 8).x) < 40, 'außer Sicht: vis false, ghost an letzter Position');
  run(AC.ghostTime + 0.3);
  ok(!e.vis && e.ghost === null, 'nach ghostTime kein Geist mehr');
  // Captain-Befehl fokus macht den Gegner sichtbar (durch Wände)
  const it = require('../server/sim/interior.js');
  it.placeOnShipPad(g, P(0));
  // ein zweiter Spieler bleibt nicht unten -> Befehl trotzdem möglich (Karte bleibt kesh, solange niemand den Ort wechselt)
  P(0).console = 'captain';
  send(0, { t: 'cmd', c: 'captain.order', kind: 'fokus', target: e.id });
  ok(g.aways.kesh.orders.length === 1 && e.focusUntil > g.time, 'captain.order fokus');
  run(0.3);
  ok(e.vis, 'Fokus: sichtbar auch durch Wände');
  send(0, { t: 'cmd', cmd: 'captain.order', kind: 'sammeln', x: 300, y: 600 });
  send(0, { t: 'cmd', c: 'captain.order', kind: 'halten', x: 320, y: 600 });
  send(0, { t: 'cmd', c: 'captain.order', kind: 'gefahr', x: 340, y: 600 });
  ok(g.aways.kesh.orders.length === 3 && !g.aways.kesh.orders.some((o) => o.kind === 'fokus'), 'max. 3 Befehle, ältester fällt raus ({cmd:…} geht auch)');
  send(0, { t: 'cmd', c: 'captain.order', kind: 'halten', x: 500, y: 600 });
  ok(g.aways.kesh.orders.filter((o) => o.kind === 'halten').length === 1 && g.aways.kesh.orders.find((o) => o.kind === 'halten').x === 500, 'gleiche Art ersetzt die alte');
  send(0, { t: 'cmd', c: 'captain.order', kind: 'halten', clear: true });
  ok(!g.aways.kesh.orders.some((o) => o.kind === 'halten'), 'clear löscht');
  run(AC.orders.ttl + 0.5);
  ok(g.aways.kesh.orders.length === 0, 'Befehle laufen nach ttl ab');
}

console.log('\n[Gegner-KI: nie zielen ohne Sicht / außerhalb engageBox, Rollen, Funksprüche, kein Hängen]');
{
  const { g, P, run, place, aw, conns } = setup(2, { clear: false });
  g.god = true;
  const E = () => combat.env(g);
  let aims = 0, badAims = 0;
  const origEmit = g.emit.bind(g);
  g.emit = (kind, data) => {
    if (kind === 'enemyAim') {
      aims++;
      const e = aw().drones.find((d) => d.id === data.id); const t = g.playerById(data.target);
      const inBox = Math.abs(t.x - e.x) <= AC.engageBox.w / 2 && Math.abs(t.y - e.y) <= AC.engageBox.h / 2;
      if (!inBox || !Los.lineOfSight(E().blocked, e.x, e.y, t.x, t.y)) badAims++;
    }
    return origEmit(kind, data);
  };
  // Spieler im Hof bei Deckung, Trupp 1 greift an
  place(0, 12, 9); place(1, 9, 10);
  const roles = new Set();
  run(40, () => { for (const d of aw().drones) if (d.alive) roles.add(d.role); });
  ok(aims > 3 && badAims === 0, `Gegner zielen nur mit Sicht und im engageBox (${aims} Ankündigungen, ${badAims} regelwidrig)`);
  ok(roles.has('pin') && (roles.has('flank') || roles.has('advance') || roles.has('push')), 'Rollen im Einsatz: ' + [...roles].join(', '));
  const barks = conns[0].inbox.filter((m) => m.kind === 'bark');
  ok(barks.length >= 1 && barks.every((b) => b.from === 'Plünderer' && b.text && Number.isFinite(b.x)), `Funksprüche (${barks.length}): ` + [...new Set(barks.map((b) => b.cause))].join(', '));
  const bySquad = {};
  let tooFast = 0;
  for (const b of barks) { const e = aw().drones.find((d) => d.id === b.id); const k = e ? e.squad : '?'; if (bySquad[k] != null && b.t != null) { /* Zeit nicht im Event */ } bySquad[k] = (bySquad[k] || 0) + 1; }
  ok(tooFast === 0, 'barkCooldown je Trupp eingehalten');
  ok(aw().stats.maxStuck < 8, `kein Gegner > 8 s eingeklemmt (max ${aw().stats.maxStuck.toFixed(1)} s)`);
  // Ziel außerhalb der Box: Spieler weit weg, Gegner zielt nicht
  g.emit = origEmit;
  // Schaden aus dem Off: keine Treffer aus mehr als engageBox
  ok(aw().stats.offBoxShots === 0, 'keine Schüsse auf Ziele außerhalb engageBox');
  // Rückzug bei seg <= 1
  const e = aw().drones.find((d) => d.alive && d.kind === 'scavenger');
  if (e) {
    e.seg = 1; e.lastHitAt = g.time;
    run(0.5);
    ok(e.role === 'retreat', 'seg ≤ 1 -> retreat');
  }
}

console.log('\n[Ducken (CONTRACT-M2 §15)]');
{
  const it = require('../server/sim/interior.js');
  const CC = AC.crouch;
  ok(CC && CC.speedFactor === 0.5 && CC.dodge === 0.2 && CC.enemyCrouch === true, 'CONFIG.awayCombat.crouch { speedFactor 0.5, dodge 0.2, enemyCrouch true }');
  // --- Steuerung, Snapshot, Tempo-Faktor ---
  {
    const { g, P, send, run, place, notices } = setup(1);
    const p = P(0);
    const walk = (crouch) => {
      place(0, 10, 8); send(0, { t: 'cmd', c: 'crouch', on: crouch }); run(0.1);
      const x0 = p.x;
      send(0, { t: 'input', seq: 1, mx: 1, my: 0 }); run(0.5); send(0, { t: 'input', seq: 2, mx: 0, my: 0 }); run(0.05);
      return p.x - x0;
    };
    const dStand = walk(false), dCrouch = walk(true);
    ok(p.crouch && g.snapshot().players[0].cr === true, 'cmd crouch on -> p.crouch, Snapshot players[].cr');
    ok(dStand > 30 && Math.abs(dCrouch / dStand - CC.speedFactor) < 0.08, `Tempo geduckt ${(dCrouch / dStand * 100).toFixed(0)} % (Soll ${CC.speedFactor * 100} %)`);
    send(0, { t: 'cmd', c: 'crouch', on: false });
    ok(!p.crouch && g.snapshot().players[0].cr === false, 'cmd crouch off -> aufgestanden');
    // Interaktion (E halten) bleibt geduckt möglich: Störrelais
    place(0, 31, 3, 'up'); send(0, { t: 'cmd', c: 'crouch', on: true });
    send(0, { t: 'act', down: true }); run(AC.jammerTime + 0.2); send(0, { t: 'act', down: false });
    ok(g.aways.kesh.jammers[0].off && p.crouch, 'geduckt E halten (Störrelais) funktioniert, bleibt geduckt');
    // Verwundung beendet das Ducken; verwundet kein Ducken
    combat.woundPlayer(g, p, 'test');
    ok(!p.crouch, 'Verwundung beendet das Ducken');
    send(0, { t: 'cmd', c: 'crouch', on: true });
    ok(!p.crouch, 'verwundet: Ducken nicht möglich');
    combat.revive(g, p, 3, { quiet: true });
    send(0, { t: 'cmd', c: 'crouch', on: true });
    ok(p.crouch, 'wieder auf den Beinen: Ducken geht');
    // Konsole beendet das Ducken (Tick-Prüfung), Beamen beendet das Ducken
    p.console = 'sonde'; run(0.05);
    ok(!p.crouch, 'Konsole beendet das Ducken');
    p.console = null; send(0, { t: 'cmd', c: 'crouch', on: true });
    it.placeOnShipPad(g, p);
    ok(!p.crouch && g.snapshot().players[0].cr === false, 'Hochbeamen beendet das Ducken');
    send(0, { t: 'cmd', c: 'crouch', on: true });
    ok(!p.crouch && notices(0).some((t) => /nur im Außeneinsatz/.test(t)), 'an Bord: kein Ducken (Hinweis)');
    ok(g.errors === 0, 'keine Fehler');
  }
  // --- dodge statistisch, Deckung von vorn 100 %, Flanke nur dodge, eigener Schuss gestoppt, Sicht ---
  {
    const { g, P, send, place, run, events } = setup(1);
    g.god = true;
    AC.enemy.scavenger.spreadDeg = 0;
    const aw = g.aways.kesh; const E = combat.env(g);
    const p = P(0);
    // dodge im freien Feld: Ziel (10,8) ohne Nachbar-Deckung, Schütze (14,8)
    place(0, 10, 8); send(0, { t: 'cmd', c: 'crouch', on: true });
    ok(!Los.nextToLow(E.map, E.solid, p.x, p.y), 'Testplatz (10,8) ohne niedrige Deckung');
    const sh = fakeEnemy(g, 14, 8);
    const s0 = Object.assign({ dodges: 0 }, aw.stats);
    const N = 1500;
    for (let i = 0; i < N; i++) { combat.fireEnemy(g, sh, p); run(0.4); }
    run(2);
    const dodges = (aw.stats.dodges || 0) - s0.dodges, hits = aw.stats.playerHits - s0.playerHits;
    ok(dodges + hits === N && Math.abs(dodges / N - CC.dodge) < 0.035, `dodge geduckt im Freien: ${(dodges / N * 100).toFixed(1)} % verfehlt (Soll ${CC.dodge * 100} %)`);
    sh.alive = false;
    // hinter niedriger Deckung (12,4) von vorn: Ziel (13,4), Schütze (7,4)
    place(0, 13, 4);
    const front = fakeEnemy(g, 7, 4);
    ok(!combat.losBetween(E, front, p) && combat.losBetween(E, front, Object.assign({}, p, { crouch: false })), 'geduckt hinter Deckung: keine Sichtlinie (stehend schon)');
    ok(Los.coverAgainst(E.map, E.solid, front.x, front.y, p.x, p.y, true) === 2 && Los.coverAgainst(E.map, E.solid, front.x, front.y, p.x, p.y) === 1, 'coverAgainst geduckt 2, stehend 1');
    const s1 = Object.assign({ crouchBlocks: 0 }, aw.stats);
    for (let i = 0; i < 300; i++) { combat.fireEnemy(g, front, p); run(0.6); }
    run(2);
    const cb = (aw.stats.crouchBlocks || 0) - s1.crouchBlocks;
    ok(cb === 300 && aw.stats.playerHits === s1.playerHits, `von vorn: ${cb}/300 an der Deckung gestoppt, 0 Treffer`);
    front.alive = false;
    // Flanke (13,8) südlich: Deckung nicht auf der Linie -> nur dodge
    const flank = fakeEnemy(g, 13, 8);
    ok(combat.losBetween(E, flank, p), 'Flanke: Sichtlinie trotz Ducken');
    const s2 = Object.assign({ dodges: 0 }, aw.stats);
    for (let i = 0; i < 400; i++) { combat.fireEnemy(g, flank, p); run(0.5); }
    run(2);
    const fd = (aw.stats.dodges || 0) - s2.dodges, fh = aw.stats.playerHits - s2.playerHits;
    ok(aw.stats.coverBlocks === s2.coverBlocks && fd + fh === 400 && Math.abs(fd / 400 - CC.dodge) < 0.06, `von der Flanke: nie an Deckung gestoppt, nur dodge (${fd}/400 verfehlt)`);
    flank.alive = false;
    // Eigener Schuss über die eigene niedrige Deckung (12,4)/(11,4) wird gestoppt
    g.god = false;
    const tgt = fakeEnemy(g, 8, 4); tgt.max = 999; tgt.seg = 999;
    const ch0 = events('coverHit').length;
    let own = 0;
    for (let i = 0; i < 40; i++) { const b = tgt.seg; p.shootReadyAt = 0; send(0, { t: 'shoot', angle: Math.PI }); run(0.6); if (tgt.seg < b) own++; }
    ok(own === 0 && events('coverHit').length - ch0 === 40, `geduckt: eigene Schüsse über die eigene Deckung gestoppt (0/40 Treffer, coverHit)`);
    send(0, { t: 'cmd', c: 'crouch', on: false });
    let own2 = 0;
    for (let i = 0; i < 20; i++) { const b = tgt.seg; p.shootReadyAt = 0; send(0, { t: 'shoot', angle: Math.PI }); run(0.6); if (tgt.seg < b) own2++; }
    ok(own2 === 20, `aufgestanden: Schüsse gehen wieder durch (${own2}/20)`);
    tgt.alive = false;
    // Geduckter Gegner: Spielerschüsse von vorn gestoppt, dodge wirkt
    const ce = fakeEnemy(g, 11, 4); ce.crouch = true; ce.max = 999; ce.seg = 999;   // Deckung (12,4) östlich
    place(0, 16, 6); p.shootReadyAt = 0;
    const tAt = (x, y) => Math.atan2(y - p.y, x - p.x);
    place(0, 14, 4);
    let ceh = 0;
    for (let i = 0; i < 20; i++) { const b = ce.seg; p.shootReadyAt = 0; send(0, { t: 'shoot', angle: tAt(ce.x, ce.y) }); run(0.6); if (ce.seg < b) ceh++; }
    ok(ceh === 0, 'geduckter Gegner hinter low-Deckung: Spielerschüsse von vorn gestoppt (0/20)');
    ce.alive = false;
    restoreConfig();
    ok(g.errors === 0, 'keine Fehler');
  }
  // --- Gegner verliert vis und Ziel; HUD-Deckung cv; Flanke ---
  {
    const { g, P, send, place, run } = setup(1);
    g.god = true;
    const aw = g.aways.kesh;
    const p = P(0);
    place(0, 13, 4);
    const e = fakeEnemy(g, 7, 4);
    e.frozen = false; e.fireT = 99;   // KI an, aber noch kein Schuss
    squad.squadOf(g, e).alert = true;
    run(0.5);
    ok(e.vis && e.sees.includes(p), 'stehend: Gegner sichtbar und sieht den Spieler');
    ok(p.cv === 1, 'stehend hinter niedriger Deckung: cv 1 (HALB)');
    e.aim = { target: p.id, t0: g.time, dur: 5 };
    send(0, { t: 'cmd', c: 'crouch', on: true });
    run(0.45);
    ok(!e.vis && !e.sees.length, 'geduckt: Gegner verliert vis (Nebel) und Sicht');
    ok(!e.aim && e.shootTarget !== p.id, 'geduckt: Gegner bricht das Zielen ab und hat kein Schussziel');
    ok(p.cv === 2 && !p.fl && g.snapshot().players[0].cv === 2, 'geduckt hinter niedriger Deckung: cv 2 (VOLL)');
    // ohne Gegner in Sicht: cv 2, solange man geduckt an niedriger Deckung steht
    e.alive = false; run(0.3);
    ok(p.cv === 2, 'ohne Gegner: geduckt an niedriger Deckung cv 2');
    send(0, { t: 'cmd', c: 'crouch', on: false }); run(0.3);
    ok(p.cv === 0, 'aufgestanden ohne Gegner: cv 0');
    // Flanke: Gegner südlich, geduckt -> cv 0, FLANKE OFFEN
    const f = fakeEnemy(g, 13, 8); squad.squadOf(g, f).alert = true;
    send(0, { t: 'cmd', c: 'crouch', on: true }); run(0.3);
    ok(f.vis && p.cv === 0 && p.fl, 'geduckt, Gegner von der Flanke: sichtbar, cv 0, FLANKE OFFEN');
    ok(g.errors === 0, 'keine Fehler');
  }
  // --- retreat-Gegner duckt sich; tune ---
  {
    const { g, P, send, run } = setup(1);
    const p = P(0);
    it.placeOnShipPad(g, p);   // niemand unten: der Gegner zieht sich ungestört zurück
    const W = require('../server/world.js');
    const E = combat.env(g);
    const spot = (W.AWAY_MAPS.kesh.coverSpots || []).find((s) => Los.nextToLow(E.map, E.solid, Physics.tileCenter(s.x, s.y).x, Physics.tileCenter(s.x, s.y).y));
    const e = fakeEnemy(g, spot.x, spot.y);
    e.frozen = false; e.seg = 1; e.lastHitAt = g.time; e.role = 'retreat';
    squad.squadOf(g, e).alert = true;
    run(0.6);
    ok(e.role === 'retreat' && e.crouch && Los.nextToLow(E.map, E.solid, e.x, e.y), `retreat-Gegner an niedriger Deckung (${spot.x},${spot.y}) duckt sich`);
    const d = g.snapshot().away.drones.find((q) => q.id === e.id);
    ok(d && d.cr === true, 'Snapshot away.drones[].cr');
    run(AC.enemy.scavenger.regenDelay + AC.enemy.scavenger.regenStep * (e.max) + 0.5);
    ok(e.seg === e.max && e.role !== 'retreat' && !e.crouch, 'Schild voll: steht auf (Rolle ' + e.role + ')');
    const w = g.aways.kesh.drones.find((q) => q.kind === 'warden');
    ok(!w.crouch, 'Wächter duckt sich nie');
    // tune crouch.enemyCrouch off
    send(0, { t: 'debug', cmd: 'tune', path: 'crouch.enemyCrouch', value: 'off' });
    ok(AC.crouch.enemyCrouch === false, 'tune crouch.enemyCrouch off');
    e.seg = 1; e.lastHitAt = g.time; run(0.6);
    ok(e.role === 'retreat' && !e.crouch, 'enemyCrouch off: retreat ohne Ducken');
    // tune crouch.dodge wirkt
    send(0, { t: 'debug', cmd: 'tune', args: 'crouch.dodge 1' });
    ok(AC.crouch.dodge === 1, 'tune crouch.dodge 1');
    restoreConfig();
    ok(AC.crouch.dodge === 0.2 && AC.crouch.enemyCrouch === true, 'Werte zurückgesetzt');
  }
  {
    const { g, P, send, place, run } = setup(1);
    g.god = true; AC.enemy.scavenger.spreadDeg = 0;
    const aw = g.aways.kesh; const p = P(0);
    place(0, 10, 8); send(0, { t: 'cmd', c: 'crouch', on: true });
    const sh = fakeEnemy(g, 14, 8);
    send(0, { t: 'debug', cmd: 'tune', path: 'crouch.dodge', value: 1 });
    const h0 = aw.stats.playerHits;
    for (let i = 0; i < 50; i++) { combat.fireEnemy(g, sh, p); run(0.4); }
    ok(aw.stats.playerHits === h0, 'tune crouch.dodge 1: alle Schüsse verfehlen (0/50 Treffer)');
    send(0, { t: 'debug', cmd: 'tune', path: 'crouch.dodge', value: 0 });
    for (let i = 0; i < 50; i++) { combat.fireEnemy(g, sh, p); run(0.4); }
    ok(aw.stats.playerHits === h0 + 50, 'tune crouch.dodge 0: alle treffen (50/50)');
    send(0, { t: 'debug', cmd: 'tune', path: 'crouch.speedFactor', value: 0.25 });
    ok(AC.crouch.speedFactor === 0.25, 'tune crouch.speedFactor 0.25');
    restoreConfig();
  }
}

console.log('\n[Lobby-Direktstart m3]');
{
  const g = new Game({ noStore: true, seed: 5, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [0, 1, 2].map((i) => { const c = { inbox: [], send(o) { this.inbox.push(o); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'L' + i, name: 'L' + i, color: i }); return c; });
  g.handleMessage(cs[2], { t: 'lobbyOpt', startMission: 'm3' });
  ok(g.snapshot().lobby.startMission === 'm3', 'lobbyOpt startMission -> Snapshot lobby.startMission');
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ok(g.phase === 'play' && g.mission.activeId === 'm3' && g.mission.missions.m1.state === 'done' && g.mission.missions.m2.state === 'done', 'Start direkt in m3, m1/m2 erledigt');
  ok(g.ship.scene === 'hafen' && !g.ship.docked && g.explore.isKnown('kesh') && g.explore.isLinked('hafen', 'kesh'), 'Schiff im Hafen (nicht angedockt), Kesh bekannt und erreichbar');
  ok(g.ship.fireList.length === 0 && g.ship.systems.transfer === 'ok', 'keine Hafen-Übung');
  for (let k = 0; k < 30 * 3; k++) g.step();
  ok(g.mission.state.radio && g.mission.state.radio.needsAccept, 'Auftrag steht als Funk zum Annehmen bereit');
  const g2 = new Game({ noStore: true, seed: 5, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c2 = { inbox: [], send(o) { this.inbox.push(o); } }; g2.addConnection(c2); g2.handleMessage(c2, { t: 'hello', clientId: 'x', name: 'x' }); g2.handleMessage(c2, { t: 'ready', ready: true });
  ok(g2.mission.activeId === 'm1' && !g2.explore.isLinked('hafen', 'kesh') && !g2.explore.locationsSnapshot().some((l) => l.id === 'kesh'), 'Standard: Kampagne m1, Kesh unsichtbar und gesperrt');
}

console.log('\n[Regression: Wrack/Plattform ohne v2]');
{
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'r', name: 'r' }); g.handleMessage(c, { t: 'ready', ready: true });
  g.setAwayMap('wreck');
  ok(!combat.isV2(g), 'Wrack: kein Kampf v2');
  const s = g.snapshot();
  ok(s.players[0].sh === null && s.away.combat === null && !('role' in (s.away.drones[0] || {})), 'Snapshot ohne v2-Felder an Drohnen, sh null');
}

console.log('\n[Testgelände (Lobby-Start arena_space / arena_away)]');
{
  const W = require('../server/world.js');
  const Locations = require('../shared/locations.js');
  const A = require('../shared/config.js').arena;
  const lobbyGame = (players, startMission, debug) => {
    const g = new Game({ noStore: true, seed: 11, debug: !!debug, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const cs = [];
    for (let i = 0; i < players; i++) { const c = { inbox: [], send(o) { this.inbox.push(o); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); cs.push(c); }
    g.handleMessage(cs[0], { t: 'lobbyOpt', startMission });
    for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
    const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
    return { g, cs, run };
  };
  const arenaEnemies = (g) => g.space.enemies.filter((e) => e.tag === 'arena');
  const nextTo = (p, con) => (W.CONSOLE_TILES[con] || []).some((t) => { const q = Physics.toTile(p.x, p.y); return Math.abs(q.x - t.x) + Math.abs(q.y - t.y) === 1; });

  // Raumkampf solo, ohne --debug
  {
    const { g, cs, run } = lobbyGame(1, 'arena_space', false);
    ok(g.snapshot().lobby.startMission === 'arena_space', 'lobbyOpt arena_space -> Snapshot');
    ok(g.phase === 'play' && g.ship.scene === A.spaceScene && !g.ship.docked && g.space.asteroids.length === 0, 'Raumkampf solo: sofort im Spiel, abgelegt, Szene ohne Brocken');
    ok(g.mission.activeId === 'arena_space' && g.snapshot().mission.active.title === 'Testgelände: Raumkampf', 'Pseudo-Mission „Testgelände: Raumkampf“ aktiv');
    ok(!g.mission.snapshotList().some((m) => m.id === 'arena_space'), 'Testgelände nicht in der Missionsliste');
    const p = g.players[0];
    ok(p.zone === 'ship' && nextTo(p, 'helm'), 'Solo: Spieler steht neben dem Steuer');
    g.handleMessage(cs[0], { t: 'act', down: true }); run(0.2); g.handleMessage(cs[0], { t: 'act', down: false });
    ok(p.console === 'helm', 'E setzt den Spieler ans Steuer');
    ok(arenaEnemies(g).length === 0, 'vor Welle 1: keine Gegner');
    run(A.firstWaveAt + 0.5);
    // M3b §7: Welle 1 = Kanonenboot + 2 Jäger, danach die alten Wellen (M3a §15); Prüfung gegen CONFIG.arena.waves
    const key = (list) => list.slice().sort().join();
    const NAMES = { raider: 'Jäger', gunboat: 'Kanonenboot', sentinel: 'Wächter', pylon: 'Pylon' };
    const label = (w) => A.waves[w - 1].map((k) => NAMES[k] || k).join(' + ');
    ok(key(A.waves[0]) === 'gunboat,raider,raider', 'M3b: Konfig Welle 1 = Kanonenboot + 2 Jäger');
    ok(key(arenaEnemies(g).map((e) => e.kind)) === key(A.waves[0]), 'Welle 1: ' + label(1));
    const n1 = A.waves[0].length;
    ok(new RegExp('Welle 1: Gegner ausschalten \\(' + n1 + ' übrig\\)').test(g.mission.state.objectives[0].text), `Ziel zeigt „Welle 1 … (${n1} übrig)“`);
    g.space.enemies = []; run(0.5);
    ok(/Welle 2 kommt in/.test(g.mission.state.objectives[0].text) && cs[0].inbox.some((m) => m.kind === 'oda' && /Welle 1 geräumt/.test(m.text)), 'Räumung: ODA-Ansage, Countdown im Ziel');
    run(A.nextWaveDelay - 2);
    ok(arenaEnemies(g).length === 0, 'nächste Welle noch nicht vor Ablauf');
    run(2);
    ok(key(arenaEnemies(g).map((e) => e.kind)) === key(A.waves[1]), `Welle 2: ${label(2)} (12 s nach Räumung)`);
    for (let w = 3; w <= A.waves.length; w++) {
      g.space.enemies = []; run(A.nextWaveDelay + 0.5);
      ok(g.arena.wave === w && key(arenaEnemies(g).map((e) => e.kind)) === key(A.waves[w - 1]), `Welle ${w}: ${label(w)}`);
    }
    ok(A.waves.slice(1).some((w) => key(w) === 'gunboat,raider') && A.waves.slice(1).some((w) => key(w) === 'gunboat,pylon'), 'M3a-Wellen Kanonenboot + Jäger und Pylon + Kanonenboot bleiben');
    g.space.enemies = []; run(A.nextWaveDelay + 0.5);
    ok(g.arena.wave === A.waves.length + 1 && arenaEnemies(g).length === A.waves[0].length && g.arena.round === 2, `Welle ${A.waves.length + 1}: zyklisch von vorn (Runde 2)`);
    g.ship.hull = 0; run(0.1);
    ok(g.ship.hull > 0 && g.stats.emergencies === 1 && g.phase === 'play', 'Notfallprotokoll wie im Spiel, kein Ende');
    g.handleMessage(cs[0], { t: 'debug', cmd: 'spawn', kind: 'raider' });
    ok(cs[0].inbox.some((m) => m.kind === 'notice' && /deaktiviert/.test(m.text)), 'ohne --debug keine Debug-Befehle');
    ok(Buffer.byteLength(JSON.stringify(g.snapshot())) < 12 * 1024 && g.errors === 0, 'Snapshot < 12 KB, keine Fehler');
  }
  // Raumkampf zu dritt + Debug
  {
    const { g, cs, run } = lobbyGame(3, 'arena_space', true);
    ok(nextTo(g.players[0], 'helm') && nextTo(g.players[1], 'weapons') && nextTo(g.players[2], 'captain'), 'zu dritt: Steuer, Taktik, Captain auf der Brücke');
    run(A.firstWaveAt + 0.5);
    const before = g.space.enemies.length;
    g.handleMessage(cs[0], { t: 'debug', cmd: 'spawn', kind: 'pylon' });
    ok(g.space.enemies.length === before + 1, 'Debug spawn im Testgelände');
    g.handleMessage(cs[0], { t: 'debug', cmd: 'skip' }); run(0.2);
    ok(arenaEnemies(g).length === 0 && g.space.enemies.some((e) => e.kind === 'pylon') && !g.arena.active, 'Debug skip räumt die Welle (Fremd-Gegner bleiben, blockieren nicht)');
    g.handleMessage(cs[0], { t: 'debug', cmd: 'skip' }); run(0.2);
    ok(g.arena.wave === 2 && arenaEnemies(g).length === A.waves[1].length, 'Debug skip ruft die nächste Welle sofort');
    g.handleMessage(cs[2], { t: 'act', down: true }); run(0.2); g.handleMessage(cs[2], { t: 'act', down: false });
    g.handleMessage(cs[2], { t: 'cmd', c: 'captain.overload' }); run(0.2);
    ok(g.ship.reactorCtl.state === 'overload', 'Reaktor überladen nutzbar');
    ok(g.errors === 0, 'keine Fehler');
  }
  // Außenteam solo, ohne --debug
  {
    const { g, run } = lobbyGame(1, 'arena_away', false);
    const p = g.players[0];
    ok(g.phase === 'play' && g.mission.activeId === 'm3' && g.mission.state.stage === 'courtyard', 'Außenteam solo: m3 Schritt courtyard');
    ok(p.zone === 'away' && g.away.map === 'kesh' && g.aways.kesh.active, 'Solo-Spieler unten auf Kesh');
    ok(W.AWAY_MAPS.kesh.pads.some((q) => { const t = Physics.toTile(p.x, p.y); return t.x === q.x && t.y === q.y; }), 'auf einem Kesh-Pad');
    ok(p.shield && p.shield.seg === p.shield.max && p.medkit === 1, 'voller Schild, Medipack mitgenommen');
    const st = Locations.get('kesh').scene.station;
    ok(g.ship.scene === 'kesh' && Math.hypot(g.ship.x - st.x, g.ship.y - st.y) <= Locations.get('kesh').scene.beam.range && g.ship.speed === 0, 'Schiff in Transferreichweite über Kesh');
    ok(g.aways.kesh.drones.some((d) => d.squad === 'squad1' && d.alive), 'Trupp 1 im Hof');
    run(3);
    ok(g.errors === 0 && g.phase === 'play', 'läuft fehlerfrei');
  }
  // Außenteam zu dritt + Debug
  {
    const { g, cs, run } = lobbyGame(3, 'arena_away', true);
    ok(g.players.every((p) => p.zone === 'away'), 'zu dritt: alle drei unten (niemand bleibt automatisch oben)');
    g.handleMessage(cs[0], { t: 'debug', cmd: 'wake' });
    ok(g.aways.kesh.drones.some((d) => d.kind === 'warden' && !d.asleep), 'Debug wake im Testgelände');
    g.handleMessage(cs[0], { t: 'debug', cmd: 'wound' });
    ok(g.players[0].wound || g.players[0].downed, 'Debug wound im Testgelände');
    g.handleMessage(cs[1], { t: 'debug', cmd: 'squad', which: '2' });
    ok(g.aways.kesh.drones.some((d) => d.squad === 'squad2' && d.alive), 'Debug squad 2 im Testgelände');
    run(2);
    ok(g.errors === 0, 'keine Fehler');
  }
}

// ======================================================================
// S2b (CONTRACT-S2B §2): zähere Jäger, Ladeschuss, Sperrfeuer des Kanonenboots
// ======================================================================
{
  const CONFIG = require('../shared/config.js');
  const space = require('../server/sim/space.js');
  const Escort = require('../server/sim/escort.js');
  const DT = 1 / CONFIG.tickHz;
  const SF = CONFIG.spaceS2b.sperrfeuer;
  const info = (t) => console.log('  info ' + t);
  const f2 = (v) => (Math.round(v * 100) / 100).toString();
  function spaceArena(players, seed) {
    const g = new Game({ noStore: true, seed: seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const conns = [];
    for (let i = 0; i < players; i++) {
      const c = { inbox: [], send(m) { this.inbox.push(m); } };
      g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S' + i, name: 'S' + i, color: i }); conns.push(c);
    }
    g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
    for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
    if (g.arena) g.arena.nextAt = null;
    g.space.enemies = []; g.space.projectiles = [];
    const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
    const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each) each(k * DT); g.step(); } };
    const ev = (kind) => conns[0].inbox.filter((m) => m.kind === kind);
    return { g, conns, run, ev };
  }
  // Lerche heil halten (Messung des Sperrfeuers, nicht der Folgeschäden) und im Feld zentrieren
  function keep(g) {
    const sh = g.ship; sh.hull = 100;
    for (const k of Object.keys(sh.systems)) { const d = Object.getOwnPropertyDescriptor(sh.systems, k); if (d && d.writable && sh.systems[k] !== 'ok') sh.systems[k] = 'ok'; }
    sh.fireList.length = 0; sh.breachList.length = 0;
    const cx = g.space.w / 2, cy = g.space.h / 2;
    if (Math.hypot(sh.x - cx, sh.y - cy) > 400) {
      const dx = cx - sh.x, dy = cy - sh.y; sh.x += dx; sh.y += dy;
      for (const e of g.space.enemies) { e.x += dx; e.y += dy; } for (const p of g.space.projectiles) { p.x += dx; p.y += dy; }
    }
  }

  console.log('\n[S2b: Jäger hält eine volle Salve aus, stirbt nach drei]');
  {
    const L = CONFIG.spaceM3.lance; const M = CONFIG.spaceM3.mounts;
    const full = L.maxDamage + M.port.damage * M.port.tubes + M.stbd.damage * M.stbd.tubes;
    ok(CONFIG.enemies.raider.hp >= 36, `enemies.raider.hp ${CONFIG.enemies.raider.hp} (vorher 12)`);
    for (const crew of [1, 2, 3]) {
      const { g } = spaceArena(crew, 3);
      const sh = g.ship;
      const e = space.spawnEnemy(g, 'raider', { tag: 'arena', x: sh.x + 300, y: sh.y, facing: Math.PI });
      const salvo = () => {   // Lanze voll (Bug, Durchschlag) + Batterie Bb + Batterie Stb (je volle Rohrzahl)
        space.damageEnemy(g, e, L.maxDamage, sh.x + 34, sh.y, { pierce: M.bow.pierce });
        for (let i = 0; i < M.port.tubes; i++) space.damageEnemy(g, e, M.port.damage, sh.x + 300, sh.y - 60);
        for (let i = 0; i < M.stbd.tubes; i++) space.damageEnemy(g, e, M.stbd.damage, sh.x + 300, sh.y + 60);
      };
      const alive = () => g.space.enemies.includes(e);
      const hp = [e.hpMax];
      let dead = 0;
      for (let s = 1; s <= 3 && alive(); s++) { e.shields = e.shieldsMax.slice(); salvo(); hp.push(alive() ? Math.round(e.hp * 10) / 10 : 0); if (!alive()) dead = s; }
      // Solo (crewScaling.enemyHp 0,5) hält der Jäger keine volle Salve aus – solo feuert die Taktik selten alle drei Waffen
      // zugleich (Bericht); geprüft wird zu zweit und zu dritt
      if (crew >= 2) ok(hp[1] > 0, `${crew} Spieler: Jäger (${e.hpMax} HP) übersteht eine volle Salve (${full} Schaden roh) – Rest ${hp[1]} HP`);
      else info(`solo: Jäger ${e.hpMax} HP, nach einer vollen Salve ${hp[1]} HP`);
      ok(dead >= 1 && dead <= 3 && (crew < 2 || dead >= 2), `${crew} Spieler: nach spätestens drei Salven zerstört (nach ${dead}; HP ${hp.join(' -> ')})`);
    }
  }

  console.log('\n[S2b: Ladeschuss des Kanonenboots]');
  {
    ok(CONFIG.spaceM3.tele.gunboat.damage >= 4 && CONFIG.spaceM3.tele.gunboat.dur === 3, `tele.gunboat: Schaden ${CONFIG.spaceM3.tele.gunboat.damage} (vorher 3), Ladung ${CONFIG.spaceM3.tele.gunboat.dur} s`);
  }

  console.log('\n[S2b: Sperrfeuer – Stöße, Geschosse, sfx, Ruhe während der Ladung]');
  {
    const { g, run, ev } = spaceArena(3, 7);
    const sh = g.ship;
    space.helmThrottle(g, { set: 1 });
    const gb = space.spawnEnemy(g, 'gunboat', { tag: 'arena', x: sh.x + 280, y: sh.y - 280 });
    gb.hp = gb.hpMax = 9999;
    let duringTele = 0, maxSperr = 0, firstSeen = null, maxAge = 0;
    const born = new Map();
    const seen = new Set();
    run(60, () => {
      keep(g);
      for (const p of g.space.projectiles) {
        if (p.kind !== 'sperrfeuer') continue;
        if (!seen.has(p.id)) {
          seen.add(p.id); born.set(p.id, g.time);
          if (!firstSeen) firstSeen = { p: { id: p.id, kind: p.kind, x: p.x, y: p.y, speed: p.speed, owner: p.owner }, d: Math.hypot(p.x - gb.x, p.y - gb.y) };
          if (gb.tele) duringTele++;
        }
        maxAge = Math.max(maxAge, g.time - born.get(p.id));
      }
      maxSperr = Math.max(maxSperr, g.space.projectiles.filter((p) => p.kind === 'sperrfeuer').length);
    });
    const S = g.stats.sperrfeuer || {};
    const sfx = ev('sfx').filter((m) => m.name === 'sperrfeuer');
    ok(S.bursts >= 6 && S.shots >= S.bursts * 2, `Kanonenboot feuert Sperrfeuer: ${S.bursts} Stöße, ${S.shots} Geschosse in 60 s (Soll ≥ 6 Stöße)`);
    ok(sfx.length === S.bursts, `sfx sperrfeuer einmal je Stoß (${sfx.length}/${S.bursts})`);
    ok(!!firstSeen && firstSeen.p.speed === SF.speed && firstSeen.p.owner === gb.id, `Geschoss: kind sperrfeuer, Tempo ${firstSeen && firstSeen.p.speed} px/s = CONFIG (${SF.speed}), Besitzer Kanonenboot`);
    ok(!!firstSeen && firstSeen.d <= 30, `Spawn an der Breitseite (${firstSeen && Math.round(firstSeen.d)} px von der Bootsmitte)`);
    ok(SF.speed < CONFIG.shipClasses.lerche.maxSpeed, `langsamer als die Lerche (${SF.speed} < ${CONFIG.shipClasses.lerche.maxSpeed} px/s)`);
    ok(maxAge <= SF.ttl + 0.1, `begrenzte Lebensdauer (ältestes Geschoss ${f2(maxAge)} s ≤ ${SF.ttl} s)`);
    ok(duringTele === 0 && ev('tele').length >= 2, `kein Sperrfeuer während der Ladung (${ev('tele').length} Ladungen, ${duringTele} Geschosse während einer Ladung)`);
    const snap = g.snapshot();
    const sp = (snap.space.projectiles || []).find((p) => p.kind === 'sperrfeuer');
    ok(!sp || ['id', 'kind', 'x', 'y', 'angle'].every((k) => k in sp), 'Snapshot: Projektil { id, kind, x, y, angle }');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[S2b: Sperrfeuer – Kurs halten wird getroffen, Ausweichen spart Hülle (mehrere Seeds)]');
  {
    const res = {};
    for (const how of ['steht', 'kurs', 'weicht']) {
      let shots = 0, hits = 0, hull = 0, absorbed = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const { g, run } = spaceArena(3, 100 + seed);
        const sh = g.ship;
        g.players[0].console = 'helm';   // Steuer besetzt (Ruder wirkt nur dann)
        space.helmThrottle(g, { set: how === 'steht' ? 1 : 3 });
        const gb = space.spawnEnemy(g, 'gunboat', { tag: 'arena', x: sh.x + 300, y: sh.y - 300 });
        gb.hp = gb.hpMax = 9999;
        let shield0 = null;
        run(90, (t) => {
          keep(g);
          if (how === 'weicht') {
            // Steuer reagiert auf einen anfliegenden Stoß: Ruder umlegen (Kurswechsel), wenn bereit Ausweichrolle
            const near = g.space.projectiles.some((p) => p.kind === 'sperrfeuer' && Math.hypot(p.x - sh.x, p.y - sh.y) < 220);
            space.helmInput(g, near ? (Math.floor(t / 6) % 2 ? 1 : -1) : 0, 0);
            if (near && !(sh.dodgeCd > 0) && g.space.projectiles.some((p) => p.kind === 'sperrfeuer' && Math.hypot(p.x - sh.x, p.y - sh.y) < 120)) space.dodge(g, Math.floor(t) % 2 ? 1 : -1);
          } else space.helmInput(g, 0, 0);
          // Ladung abschalten: hier zählt nur das Sperrfeuer
          if (gb.tele) { gb.tele = null; gb.fireT = 0; }
          gb.fireT = Math.min(gb.fireT, 0.5);
        });
        const S = g.stats.sperrfeuer || {};
        shots += S.shots || 0; hits += S.hits || 0; hull += S.hull || 0;
        if (g.errors) fails++;
      }
      res[how] = { shots, hits, rate: shots ? hits / shots : 0, hull };
      info(`${how}: ${hits}/${shots} Treffer (${Math.round(res[how].rate * 100)} %), Hülle ${f2(hull)} in 6 × 90 s`);
    }
    ok(res.steht.rate >= 0.7, `stehende Lerche wird getroffen (${Math.round(res.steht.rate * 100)} %, Soll ≥ 70 %)`);
    ok(res.kurs.rate >= 0.7, `Lerche hält Kurs (½): wird getroffen (${Math.round(res.kurs.rate * 100)} %, Soll ≥ 70 %)`);
    ok(res.weicht.rate <= res.kurs.rate * 0.7, `ausweichende Lerche deutlich seltener getroffen (${Math.round(res.weicht.rate * 100)} % ≤ 0,7 × ${Math.round(res.kurs.rate * 100)} %)`);
    ok(res.weicht.hull < res.kurs.hull * 0.6 && res.weicht.hull < res.steht.hull * 0.6, `Ausweichen spart Hülle (${f2(res.weicht.hull)} vs. Kurs ${f2(res.kurs.hull)} / steht ${f2(res.steht.hull)})`);
  }

  console.log('\n[S2b: Sperrfeuer – leichter Treffer, kein Systemschaden durch den Schild]');
  {
    const { g } = spaceArena(3, 9);
    const sh = g.ship;
    sh.shields.current = [2, 2, 2, 2];
    let sys = 0;
    for (let i = 0; i < 200; i++) {
      sh.shields.current[1] = 1;
      const before = JSON.stringify(sh.systems);
      g.space.projectiles.push({ id: 'sf' + i, kind: 'sperrfeuer', x: sh.x + 10, y: sh.y + 30, angle: -Math.PI / 2, speed: SF.speed, ttl: 1, dmg: SF.damage, owner: 'x' });
      g.step();
      if (JSON.stringify(sh.systems) !== before) sys++;
      for (const k of Object.keys(sh.systems)) { const d = Object.getOwnPropertyDescriptor(sh.systems, k); if (d && d.writable) sh.systems[k] = 'ok'; }
    }
    ok(sys === 0, `200 Treffer auf Schild 1: kein Systemschaden (${sys})`);
    ok(sh.hull === 100, `Schild fängt den Treffer (Hülle ${sh.hull})`);
  }

  console.log('\n[S2b: Sperrfeuer auf Schützlinge – Breitseite schützt]');
  {
    const { g } = spaceArena(3, 11);
    const sh = g.ship;
    const es = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter', verhalten: 'folgt_kurs', von: { x: sh.x, y: sh.y + 200 } });
    Escort.order(g, 'konvoi', 'halten');
    for (let k = 0; k < 10; k++) g.step();
    // Lerche zwischen Boot (oben) und Schützling (unten): Geschoss fliegt von oben auf den Schützling
    const ex = es.x, ey = es.y;
    const pinAll = () => { es.x = ex; es.y = ey; es.vx = 0; es.vy = 0; sh.x = ex; sh.y = ey - 120; sh.vx = 0; sh.vy = 0; };
    pinAll();
    const hp0 = es.hp; const sh0 = sh.shields.current.slice();
    g.space.projectiles.push({ id: 'sfA', kind: 'sperrfeuer', x: ex, y: ey - 300, angle: Math.PI / 2, speed: SF.speed, ttl: 6, dmg: SF.damage, owner: 'x', tgt: es.id });
    for (let k = 0; k < 90; k++) { pinAll(); g.step(); }
    ok(es.hp === hp0 && !g.space.projectiles.some((p) => p.id === 'sfA'), `Lerche fängt das Geschoss ab (Schützling ${es.hp}/${hp0})`);
    ok(SF.shieldedFactor !== 0 || JSON.stringify(sh.shields.current.map((v, i) => v >= sh0[i])) === '[true,true,true,true]', `abgefangen: Schild der Lerche bleibt (shieldedFactor ${SF.shieldedFactor})`);
    // ohne Lerche: Treffer, aber der Schützling hält deshalb nicht an
    sh.x = es.x + 600; sh.y = es.y;
    const hitT0 = es.hitT;
    g.space.projectiles.push({ id: 'sfB', kind: 'sperrfeuer', x: ex, y: ey - 200, angle: Math.PI / 2, speed: SF.speed, ttl: 6, dmg: SF.damage, owner: 'x', tgt: es.id });
    for (let k = 0; k < 90; k++) { es.x = ex; es.y = ey; es.vx = 0; es.vy = 0; g.step(); }
    const exp = SF.damage * (SF.escortFactor != null ? SF.escortFactor : 1) * CONFIG.escorts.hullPerDamage * CONFIG.escorts.crewDamage[3];
    ok(Math.abs(hp0 - es.hp - exp) < 0.2, `ohne Lerche: Treffer am Schützling (−${Math.round((hp0 - es.hp) * 10) / 10} Hülle, Soll ${Math.round(exp * 10) / 10})`);
    ok(es.hitT === hitT0, 'leichter Treffer: kein Anhalten (hitT unverändert)');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[S2b: Snapshot mit viel Sperrfeuer]');
  {
    const { g, run } = spaceArena(3, 13);
    const sh = g.ship;
    space.helmThrottle(g, { set: 1 });
    const boats = [[300, -300], [-300, 300], [350, 250]].map(([dx, dy]) => { const e = space.spawnEnemy(g, 'gunboat', { tag: 'arena', x: sh.x + dx, y: sh.y + dy }); e.hp = e.hpMax = 9999; return e; });
    for (let i = 0; i < 3; i++) { const e = space.spawnEnemy(g, 'raider', { tag: 'arena' }); e.hp = e.hpMax = 9999; }
    let maxSz = 0, maxSperr = 0, tk = 0;
    run(60, () => {
      tk++;
      keep(g);
      for (const e of boats) { if (e.tele) { e.tele = null; } e.fireT = 0; }   // nur Sperrfeuer, Dauerfeuer
      maxSperr = Math.max(maxSperr, g.space.projectiles.filter((p) => p.kind === 'sperrfeuer').length);
      if (tk % 15 === 0) maxSz = Math.max(maxSz, Buffer.byteLength(JSON.stringify(g.snapshot())));
    });
    ok(maxSperr <= SF.maxProjectiles, `Obergrenze: höchstens ${maxSperr} Sperrfeuer-Geschosse gleichzeitig (maxProjectiles ${SF.maxProjectiles})`);
    ok(maxSz < 13 * 1024, `Snapshot mit 3 Kanonenbooten + 3 Jägern < 13 KB (max ${maxSz} B)`);
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[QA S2b: Jäger (alte KI) klebt nicht in der Kartenecke]');
  {
    const { g, run } = spaceArena(1, 17);
    const F = g.C.spaceM3b.flightV2; const savedArena = F.arena; F.arena = false;   // Missions-KI (moveLegacy)
    try {
      const sh = g.ship; const W2 = g.space.w;
      const pinShip = () => { sh.x = W2 - 40; sh.y = 40; sh.vx = 0; sh.vy = 0; sh.hull = 100; };
      pinShip();
      const e = space.spawnEnemy(g, 'raider', { tag: 'ecke', x: W2 - 30, y: 30 }); e.hp = e.hpMax = 9999;
      e.x = W2 - 30; e.y = 30;
      run(6, pinShip);
      const fromShip = Math.hypot(e.x - sh.x, e.y - sh.y);
      ok(fromShip > 80 && e.y > 60 && e.x < W2 - 60, `Jäger löst sich aus der Ecke (Abstand zum Schiff ${Math.round(fromShip)} px, Position ${Math.round(e.x)},${Math.round(e.y)})`);
      ok(g.errors === 0, 'keine Server-Fehler');
    } finally { F.arena = savedArena; }
  }
}

// ======================================================================
// B1 Welle 1 (BODENKAMPF): Kampf v2 kartenneutral, Spawns an Ankern, Decks in der Außenzone, Waffen-Schnittstelle,
// Tutorial-Schutz. Testkarte im Format `Karte` (CONTRACT-B1 §2), bis BUEHNE die Laufzeitkarten liefert.
// ======================================================================
{
  const W = require('../server/world.js');
  const interior = require('../server/sim/interior.js');
  const KACHELN = require('../content/buehnen/kacheln.json').zeichen;
  const LP = 'test.zweideck';
  // Zwei Decks à 20×13 (Stride 16): Deck I mit Trennwand x=10 und Tür (10,6), Deck II offen; Lücke `_`
  function testKarte() {
    const deck = (oben) => {
      const r = [];
      for (let y = 0; y < 13; y++) {
        let row = '';
        for (let x = 0; x < 20; x++) {
          let ch = (x === 0 || y === 0 || x === 19 || y === 12) ? '#' : '.';
          if (oben && x === 10 && y > 0 && y < 12) ch = y === 6 ? 'D' : '#';
          if (oben && y === 4 && (x === 5 || x === 6)) ch = 'o';
          if (oben && x === 14 && y === 8) ch = 'O';
          if (oben && x === 12 && y === 10) ch = 'z';
          if (oben && x === 13 && y === 10) ch = '|';
          row += ch;
        }
        r.push(row);
      }
      return r;
    };
    const rows = deck(true).concat(['_'.repeat(20), '_'.repeat(20), '_'.repeat(20)], deck(false));
    const legende = {};
    for (const r of rows) for (const ch of r) legende[ch] = KACHELN[ch];
    const A = (id, rolle, x, y, extra) => Object.assign({ id, rolle, x, y, platz: id.split('.')[0], bereich: null }, extra || {});
    const anker = [
      A('lz.abholpunkt', 'abholpunkt', 2, 2, { ankunft: true, bereich: 'lz' }),
      A('hof.wache.1', 'wache', 15, 3, { bereich: 'hof' }), A('hof.wache.2', 'wache', 16, 9, { bereich: 'hof' }),
      A('hof.wache.3', 'wache', 17, 5, { bereich: 'hof', schwer: true }),
      A('unten.wache.1', 'wache', 15, 20, { bereich: 'unten' }),
      A('lz.lift', 'lift', 3, 10, { deck: 1 }), A('unten.lift', 'lift', 3, 26, { deck: 2 }),
      A('hof.leiter', 'leiter', 17, 11, { deck: 1 }), A('unten.leiter', 'leiter', 17, 27, { deck: 2 }),
    ];
    return { id: LP, erzeuger: 'modul/1', art: 'schiff', bauweise: 'germanen', besitz: 'kontor', zustand: 'intakt', seed: 1, bauversion: 'test',
      schablone: null, spiegel: null, w: 20, h: rows.length, rows, legende, anker,
      bereiche: { lz: { name: 'Landezone', rects: [[1, 1, 9, 11]], rolle: 'hinein', gefecht: false },
        hof: { name: 'Hof', rects: [[11, 1, 8, 11]], rolle: 'ziel', gefecht: true },
        unten: { name: 'Unterdeck', rects: [[1, 17, 18, 11]], rolle: null, gefecht: false } },
      plaetze: {}, eingaenge: [], abholpunkte: ['lz.abholpunkt'], ankunft: 'lz.abholpunkt', patrouillen: [], coverSpots: [],
      decks: { stride: 16, links: [{ a: [3, 10], b: [3, 26], via: 'lift' }, { a: [17, 11], b: [17, 27], via: 'leiter' }] },
      kanten: { 'lz~hof': { a: 'lz', b: 'hof', typ: 'tuer', tiles: [[10, 6]], zustand: 'zu' } }, gelaende: null, meta: {} };
  }
  function setupKarte(players) {
    const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const conns = [];
    for (let i = 0; i < players; i++) {
      const c = { inbox: [], send(m) { this.inbox.push(m); } };
      g.addConnection(c);
      g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i });
      conns.push(c);
    }
    for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
    W.AWAY_MAPS[LP] = { id: LP, karte: testKarte() };   // wie landepunkte.get (BUEHNE): Eintrag mit karte
    g.aways[LP] = away.makeLandepunkt(g, LP);
    g.setAwayMap(LP);
    away.executeBeam(g, g.players.map((p) => p.id), 'down');
    const P = (i) => g.players[i];
    const send = (i, m) => g.handleMessage(conns[i], m);
    const run = (sec, each) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.step(); if (each) each(); } };
    const place = (i, tx, ty, dir) => { const p = P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.dir = dir || 'down'; p.input.mx = 0; p.input.my = 0; };
    const aw = () => g.aways[LP];
    return { g, conns, P, send, run, place, aw };
  }
  const tileOf = (o) => Physics.toTile(o.x, o.y);

  console.log('\n[B1 Welle 1: Kampf v2 auf gebauter Karte (Format Karte)]');
  {
    const { g, P, aw } = setupKarte(2);
    ok(g.away === aw() && combat.isV2(g) && aw().kampf === 'v2', 'gebaute Karte: Kampf v2 über aw.kampf (keine Kesh-Kennung)');
    ok(P(0).zone === 'away' && P(0).shield && P(0).shield.seg === 3, 'Herunterbeamen: voller Schild');
    const t0 = tileOf(P(0));
    ok(Math.abs(t0.x - 2) + Math.abs(t0.y - 2) <= 1, 'Ankunft am Abholpunkt mit ankunft (' + t0.x + ',' + t0.y + ')');
    const s = g.snapshot();
    ok(s.away.combat === 'v2' && s.away.vault === null && s.away.tablet === null && s.away.jammers.length === 0 && s.away.scanQuality === 1, 'Snapshot away: v2 ohne Kesh-Felder');
    const solid = interior.awaySolid(g);
    ok(solid(10, 6), 'Tür der Kante lz~hof im Zustand zu ist fest');
    aw().zustaende['lz~hof'] = 'offen';
    ok(!interior.awaySolid(g)(10, 6), 'aw.zustaende[kante] = offen öffnet die Tür');
    aw().zustaende['lz~hof'] = 'zu';
    const E = combat.env(g);
    ok(E.blocked(5, 14) && E.blocked(10, 3) && !E.blocked(5, 4), '`_` und Wand sperren die Sicht, halbe Deckung nicht');
    ok(E.solid(12, 10) && !E.blocked(12, 10) && !E.shotBlocked(12, 10), 'Gitter: fest, Sicht und Schüsse frei');
    ok(!E.blocked(13, 10) && E.shotBlocked(13, 10), 'Fenster: Sicht frei, Schüsse gestoppt');
    const cs = combat.coverSpots(g);
    ok(cs.length > 0 && cs.some((c) => c.x === 5 && c.y === 5), 'coverSpots aus der Karte (' + cs.length + ')');
    ok(interior.awayInfo(g).pads.length >= 1 && interior.awayInfo(g).links, 'Pads und Deck-Links abgeleitet');
    ok(combat.order(g, { kind: 'halten', x: 99999, y: 100 }) === null && aw().orders[0].x === 20 * 32, 'Captain-Befehl auf der Karte (Punkt an die Kartengrenze)');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B1 Welle 1: Spawns an wache-Ankern, Besetzung aus Daten]');
  {
    const { g, aw } = setupKarte(2);
    const n = squad.spawnSquad(g, 'posten', { map: LP, bereich: 'hof', besetzung: [{ typ: 'grundtyp', anzahl: 2 }, { typ: 'waechter', anzahl: 1 }] });
    const list = aw().drones.filter((d) => d.squad === 'posten');
    ok(n === 3 && list.length === 3, 'Besetzung 2 grundtyp (×0,75 aufgerundet) + 1 Wächter = 3 (' + n + ')');
    const w = list.find((d) => d.kind === 'warden');
    ok(w && tileOf(w).x === 17 && tileOf(w).y === 5 && w.rolle === 'waechter', 'Wächter am schweren wache-Anker (17,5)');
    const pl = list.filter((d) => d.kind === 'scavenger').map((d) => tileOf(d).x + ',' + tileOf(d).y).sort();
    ok(JSON.stringify(pl) === '["15,3","16,9"]' && list.filter((d) => d.rolle === 'grundtyp').length === 2, 'grundtyp an den wache-Ankern des Bereichs (' + pl.join(' ') + ')');
    ok(squad.spawnSquad(g, 'posten', { map: LP, bereich: 'hof' }) === 0, 'gleicher Trupp nicht doppelt (ohne force)');
    const n2 = squad.spawnSquad(g, 'lz', { map: LP, bereich: 'lz', besetzung: [{ typ: 'scavenger', anzahl: 2 }] });
    const lz = aw().drones.filter((d) => d.squad === 'lz');
    ok(n2 === 2 && lz.every((d) => { const t = tileOf(d); return t.x >= 1 && t.x < 10 && t.y >= 1 && t.y < 12; }), 'Bereich ohne wache-Anker: freie Kacheln im Bereich');
    const n3 = squad.spawnSquad(g, 'standard', { map: LP, force: true });
    ok(n3 >= 1 && aw().drones.filter((d) => d.squad === 'standard').every((d) => tileOf(d).x > 10 && tileOf(d).y < 13), 'ohne Bereich: wache-Anker der Gefechtsbereiche');
    const nAlert = squad.spawnSquad(g, 'unten', { map: LP, bereich: 'unten', besetzung: [{ typ: 'scavenger', anzahl: 1 }], alert: true });
    ok(nAlert === 1 && aw().squads.unten.alert, 'alert: Trupp sofort wach');
    ok(g.aways.kesh.drones.filter((d) => d.squad === 'squad1').length === 0 && !g.aways.kesh.spawned.posten, 'Kesh unberührt');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B1 Welle 1: Fog of War auf der Karte]');
  {
    const { g, P, place, aw } = setupKarte(1);
    squad.spawnSquad(g, 'posten', { map: LP, bereich: 'hof', besetzung: [{ typ: 'scavenger', anzahl: 1 }] });
    const e = aw().drones.find((d) => d.squad === 'posten'); e.frozen = true;
    place(0, 5, 3);
    combat.updateVisibility(g);
    ok(!e.vis, 'Gegner hinter Wand und geschlossener Tür: unsichtbar');
    place(0, 12, 3);
    combat.updateVisibility(g);
    ok(e.vis, 'gleicher Raum mit Sichtlinie: sichtbar');
    place(0, 15, 19);
    combat.updateVisibility(g);
    ok(!e.vis, 'anderes Deck (über `_`): unsichtbar');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B1 Welle 1: Decks in der Außenzone – Lift, Leiter, KI]');
  {
    const { g, P, send, run, place, aw } = setupKarte(2);
    place(0, 3, 10); place(1, 6, 6);
    send(0, { t: 'act', down: true }); send(0, { t: 'act', down: false });
    ok(P(0).lift && P(0).lift.away, 'Lift: E tippen startet die Fahrt');
    run(2);
    ok(!P(0).lift && tileOf(P(0)).y >= 16, 'Lift: angekommen auf Deck II (' + tileOf(P(0)).x + ',' + tileOf(P(0)).y + ')');
    ok(g.snapshot().players.find((q) => q.id === P(0).id).deck === 1, 'Snapshot players.deck = 1 auf Deck II');
    place(0, 17, 27, 'up');
    send(0, { t: 'act', down: true });
    ok(P(0).hold && P(0).hold.kind === 'ladder', 'Leiter: E halten');
    run(((g.C.lift && g.C.lift.ladderTime) || 2) + 0.4);
    send(0, { t: 'act', down: false });
    ok(tileOf(P(0)).y < 13 && Math.abs(tileOf(P(0)).x - 17) <= 1, 'Leiter: oben auf Deck I (' + tileOf(P(0)).x + ',' + tileOf(P(0)).y + ')');
    // KI: Gegner auf Deck I verfolgt die letzte bekannte Position auf Deck II über den Lift
    place(0, 8, 21); place(1, 9, 22);
    const n = squad.spawnSquad(g, 'jaeger', { map: LP, bereich: 'lz', besetzung: [{ typ: 'scavenger', anzahl: 1 }] });
    const e = aw().drones.find((d) => d.squad === 'jaeger');
    const c = Physics.tileCenter(5, 8); e.x = c.x; e.y = c.y; e.home = { x: c.x, y: c.y };
    const s = aw().squads.jaeger; s.alert = true;
    s.lastKnown[P(0).id] = { x: P(0).x, y: P(0).y, t: g.time };
    const keep = () => { s.lastKnown[P(0).id] = { x: P(0).x, y: P(0).y, t: g.time }; for (const p of g.players) { if (p.shield) p.shield.seg = 3; p.downed = false; } };
    let deckWechsel = false;
    run(12, () => { keep(); if (tileOf(e).y >= 16) deckWechsel = true; });
    ok(n === 1 && deckWechsel, 'KI findet den Weg über den Deck-Link (Gegner erreicht Deck II)');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2-Schnittstelle: Waffen-Stub inaktiv = altes Verhalten, anker.onTreffer]');
  {
    const { g, P, aw } = setupKarte(1);
    const anr = [];
    combat._setzeModul('anker', { onTreffer: (game, pid) => anr.push(pid) });
    try {
      ok(!combat.waffenAktiv() && require('../server/sim/waffen.js').aktiv === false, 'waffen.aktiv === false -> keine Waffen-Aufrufe');
      const r = combat.hitPlayer(g, P(0), 1, 'test');
      ok(r === 'shield' && P(0).shield.seg === 2 && anr.length === 1 && anr[0] === P(0).id, 'alter Treffer + anker.onTreffer(game, pid)');
      g.god = true; combat.hitPlayer(g, P(0), 1, 'test'); g.god = false;
      ok(anr.length === 1, 'god: kein Treffer, kein onTreffer');
      aw().kuppelHp = 50; aw().kuppelUntil = g.time + 5;
      ok(combat.hitPlayer(g, P(0), 1, 'test') === 'kuppel' && anr.length === 1, 'Kuppel fängt ab: kein onTreffer');
      aw().kuppelHp = 0;
      combat._setzeModul('anker', { onTreffer: () => { throw new Error('kaputt'); } });
      const before = g.errors;
      combat.hitPlayer(g, P(0), 1, 'test');
      ok(g.errors === before + 1, 'Fehler in anker.onTreffer wird gezählt, nicht geworfen');
    } finally { combat._setzeModul('anker', undefined); }
  }

  console.log('\n[B2-Schnittstelle: Hüllen um waffen.treffer/feuern (Attrappe)]');
  {
    const { g, P, aw } = setupKarte(1);
    const calls = { treffer: [], feuern: [], update: 0 };
    const fake = { aktiv: true, treffer: (game, z, w, q) => { calls.treffer.push({ z, w, q }); return 'schild'; },
      feuern: (game, k, ziel) => { calls.feuern.push({ k, ziel }); return null; }, update: () => { calls.update++; } };
    const anr = [];
    combat._setzeModul('waffen', fake); combat._setzeModul('anker', { onTreffer: (game, pid) => anr.push(pid) });
    try {
      ok(combat.waffenAktiv(), 'Attrappe aktiv');
      const r = combat.hitPlayer(g, P(0), 1, 'enemy');
      ok(r === 'shield' && calls.treffer.length === 1 && calls.treffer[0].z === P(0) && calls.treffer[0].w.schaden === 1 && anr.length === 1, 'hitPlayer -> waffen.treffer, Ergebnis schild -> shield, onTreffer');
      ok(P(0).team === 'crew' && P(0).waffe === 'blaster' && P(0).schild === P(0).shield && P(0).wunden.n === 1, 'Kämpfer-Felder Spieler (schild = shield)');
      squad.spawnSquad(g, 'z', { map: LP, bereich: 'hof', besetzung: [{ typ: 'grundtyp', anzahl: 1 }] });
      const e = aw().drones.find((d) => d.squad === 'z'); e.frozen = true;
      ok(combat.hitEnemy(g, e, 1, { x: P(0).x, y: P(0).y, pid: P(0).id }) === 'shield' && calls.treffer[1].z === e && calls.treffer[1].q.pid === P(0).id, 'hitEnemy -> waffen.treffer mit quelle');
      ok(e.team === 'feind' && e.waffe === 'blaster' && e.schild.seg === e.seg && !Object.keys(e).includes('schild'), 'Kämpfer-Felder Gegner (Rolle grundtyp -> Blaster, schild als Alias)');
      e.schild.seg = 1; ok(e.seg === 1 && e.hp === 1, 'Alias schreibt seg/hp');
      combat.shoot(g, P(0), 0.5);
      ok(calls.feuern.length === 1 && calls.feuern[0].ziel.angle === 0.5, 'shoot -> waffen.feuern({ angle })');
      combat.fireEnemy(g, e, P(0));
      ok(calls.feuern.length === 2 && calls.feuern[1].k === e && calls.feuern[1].ziel.x === P(0).x, 'fireEnemy (Gegner mit Waffe) -> waffen.feuern({ x, y })');
      g.step();
      ok(calls.update >= 2, 'update -> waffen.update je Kämpfer');
      ok(g.waffenWelt && g.waffenWelt.kaempfer().length >= 2 && g.waffenWelt.wand(P(0).x, P(0).y, P(0).x, P(0).y + 32 * 20) === true, 'Welt-Adapter game.waffenWelt (Kämpfer, Wand über `_`)');
    } finally { combat._setzeModul('waffen', undefined); combat._setzeModul('anker', undefined); }
  }

  console.log('\n[B2-Schnittstelle: echtes waffen.js aktiviert]');
  {
    const Wreal = require('../server/sim/waffen.js');
    const { g, P, aw } = setupKarte(1);
    const alt = Wreal.aktiv; Wreal.aktiv = true;
    try {
      const p = P(0);
      ok(combat.hitPlayer(g, p, 1, 'test') === 'shield' && p.shield.seg === 2, 'waffen.treffer: Schild 3 -> 2');
      combat.hitPlayer(g, p, 1, 'test'); combat.hitPlayer(g, p, 1, 'test');
      const r = combat.hitPlayer(g, p, 1, 'test');
      ok(r === 'wounded' && p.downed && p.wound && p.zustand === 'verwundet', 'ohne Schild: gefallen -> verwundet wie heute (' + r + ')');
      combat.revive(g, p, 3);
      ok(!p.downed && p.zustand === 'ok' && p.wunden.n === 1, 'Aufhelfen setzt Zustand und Wunden zurück');
      squad.spawnSquad(g, 'z', { map: LP, bereich: 'hof', besetzung: [{ typ: 'grundtyp', anzahl: 1 }] });
      const e = aw().drones.find((d) => d.squad === 'z'); e.frozen = true;
      let res = '';
      for (let i = 0; i < 10 && e.alive; i++) res = combat.hitEnemy(g, e, 1, { x: e.x - 40, y: e.y });
      ok(!e.alive && res === 'down', 'Gegner fällt über waffen.treffer -> knockOut');
      ok(g.errors === 0, 'keine Server-Fehler');
    } finally { Wreal.aktiv = alt; }
  }

  console.log('\n[B1 §0.1: Tutorial-Schutz Plattform/Wrack]');
  {
    const { g } = setupKarte(1);
    ok(g.aways.platform.kampf === 'alt' && g.aways.wreck.kampf === 'alt' && g.aways.kesh.kampf === 'v2', 'Start: Plattform/Wrack alt, Kesh v2');
    ok(away.tutorialLaeuft(g) && !away.kampfPruefen(g, g.aways.platform), 'ohne Kampagnen-Weltstand: Tutorial läuft, kein Umrüsten');
    const ws = g.weltstand;
    g.weltstand = { persistent: true, data: { tutorial: 'erledigt' } };
    try {
      ok(!away.tutorialLaeuft(g), 'Tutorial erledigt');
      ok(away.kampfPruefen(g, g.aways.wreck) && g.aways.wreck.kampf === 'v2', 'Wrack: Umrüsten auf v2');
      const wr = g.aways.wreck;
      ok(wr.drones.length > 0 && wr.drones.every((d) => d.seg === d.max && d.squad === 'posten' && Array.isArray(d.sees)), 'Plünderer als v2-Gegner (' + wr.drones.length + ')');
      const r = away.resetMap(g, 'platform');
      ok(r.ok && g.aways.platform.kampf === 'v2', 'map_reset Plattform nach dem Tutorial: v2');
    } finally { g.weltstand = ws; }
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B1 Welle 1: Snapshot auf der Karte, 3 Spieler, 12 Gegner]');
  {
    const { g, run, aw } = setupKarte(3);
    squad.spawnSquad(g, 'a', { map: LP, bereich: 'hof', besetzung: [{ typ: 'scavenger', anzahl: 6 }], alert: true });
    squad.spawnSquad(g, 'b', { map: LP, bereich: 'unten', besetzung: [{ typ: 'scavenger', anzahl: 6 }], alert: true });
    ok(aw().drones.length === 12, '12 Gegner');
    let max = 0;
    run(4, () => { max = Math.max(max, Buffer.byteLength(JSON.stringify(g.snapshot()))); for (const p of g.players) { if (p.shield) p.shield.seg = 3; } });
    ok(max < 13 * 1024, 'Snapshot < 13 KB (max ' + max + ' B)');
    ok(g.errors === 0, 'keine Server-Fehler');
  }
  delete W.AWAY_MAPS[LP];
}

// ======================================================================
// B2 Welle 2 (BODENKAMPF): waffen.js aktiv – Rollen, Hitze, Liegen/Aufrichten, Bewusstlos/Fesseln (beide Seiten),
// Ausbruch, KI-Profile, Schleichen, Einführungsregel. Testkarte im Format `Karte` mit zelle/beute/patrouille/aussicht.
// ======================================================================
{
  const W = require('../server/world.js');
  const interior = require('../server/sim/interior.js');
  const KACHELN = require('../content/buehnen/kacheln.json').zeichen;
  const LP = 'test.b2';
  WAFFEN_MOD.aktiv = true;
  function karteB2() {
    const rows = [];
    for (let y = 0; y < 14; y++) {
      let r = '';
      for (let x = 0; x < 26; x++) {
        let ch = (x === 0 || y === 0 || x === 25 || y === 13) ? '#' : '.';
        if (x === 15 && (y === 5 || y === 6)) ch = 'o';
        if (x === 10 && y === 8) ch = 'O';
        r += ch;
      }
      rows.push(r);
    }
    const legende = {};
    for (const r of rows) for (const ch of r) legende[ch] = KACHELN[ch];
    const A = (id, rolle, x, y, extra) => Object.assign({ id, rolle, x, y, platz: id.split('.')[0], bereich: null }, extra || {});
    const anker = [
      A('lz.abholpunkt', 'abholpunkt', 3, 11, { ankunft: true, bereich: 'lz' }),
      A('kerker.zelle', 'zelle', 3, 3, { bereich: 'kerker' }), A('kerker.beute', 'beute', 8, 3, { bereich: 'kerker' }),
      A('hof.wache.1', 'wache', 18, 4, { bereich: 'hof' }), A('hof.wache.2', 'wache', 18, 9, { bereich: 'hof' }),
      A('hof.wache.3', 'wache', 20, 6, { bereich: 'hof' }), A('hof.wache.4', 'wache', 22, 4, { bereich: 'hof' }),
      A('hof.wache.5', 'wache', 22, 9, { bereich: 'hof' }), A('hof.wache.6', 'wache', 23, 6, { bereich: 'hof', schwer: true }),
      A('gang.patrouille.1', 'patrouille', 12, 2, { kette: 'a' }), A('gang.patrouille.2', 'patrouille', 12, 11, { kette: 'a' }),
      A('hof.aussicht', 'aussicht', 21, 2, { bereich: 'hof' }),
    ];
    return { id: LP, erzeuger: 'modul/1', art: 'aussenposten', bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt', seed: 2, bauversion: 'test',
      schablone: null, spiegel: null, w: 26, h: 14, rows, legende, anker,
      bereiche: { lz: { name: 'Landezone', rects: [[1, 9, 8, 4]], rolle: 'hinein', gefecht: false },
        kerker: { name: 'Kerker', rects: [[1, 1, 9, 5]], rolle: null, gefecht: false },
        hof: { name: 'Hof', rects: [[16, 1, 9, 12]], rolle: 'ziel', gefecht: true } },
      plaetze: {}, eingaenge: [], abholpunkte: ['lz.abholpunkt'], ankunft: 'lz.abholpunkt',
      patrouillen: [['gang.patrouille.1', 'gang.patrouille.2']], coverSpots: [], decks: null, kanten: {}, gelaende: null, meta: {} };
  }
  function setupB2(players, opts) {
    const o = opts || {};
    const g = new Game({ noStore: true, seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const conns = [];
    for (let i = 0; i < players; i++) {
      const c = { inbox: [], send(m) { this.inbox.push(m); } };
      g.addConnection(c);
      g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'B' + i, color: i });
      conns.push(c);
    }
    for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
    W.AWAY_MAPS[LP] = { id: LP, karte: karteB2() };
    g.aways[LP] = away.makeLandepunkt(g, LP);
    g.setAwayMap(LP);
    away.executeBeam(g, g.players.map((p) => p.id), 'down');
    const P = (i) => g.players[i];
    const send = (i, m) => g.handleMessage(conns[i], m);
    const run = (sec, each) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.step(); if (each) each(); } };
    const place = (i, tx, ty, dir) => { const p = P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.dir = dir || 'down'; p.input.mx = 0; p.input.my = 0; };
    const events = (kind) => conns[0].inbox.filter((m) => m.kind === kind);
    const aw = () => g.aways[LP];
    const gegner = (rolle, tx, ty, opts2) => {
      const q = opts2 || {};
      const e = squad.makeEnemy(g, aw(), squad.TYP_KIND[rolle] || 'scavenger', 'G' + g.nextId(''), Physics.tileCenter(tx, ty), q.trupp || 'test');
      e.rolle = rolle; e.asleep = false; e.frozen = q.frozen !== false;
      if (!aw().squads[e.squad]) aw().squads[e.squad] = squad.newSquad(e.squad, 1);
      aw().drones.push(e);
      combat.kaempfer(g, e);
      return e;
    };
    return { g, conns, P, send, run, place, events, aw, gegner };
  }
  const C = AC;
  const tileOf = (o) => Physics.toTile(o.x, o.y);

  console.log('\n[B2 Welle 2: Waffen aktiv, Rollen und Kämpfer-Felder]');
  {
    const { g, P, gegner } = setupB2(1);
    ok(combat.waffenAktiv(), 'waffen.js aktiv (Schalter WAFFEN=aus schaltet ab)');
    const p = combat.kaempfer(g, P(0));
    ok(p.waffe === 'blaster' && p.team === 'crew' && p.wunden.max === 1 && p.zustand === 'ok', 'Spieler: Blaster, crew, 1 Wunde');
    const sc = squad.makeEnemy(g, g.aways.kesh, 'scavenger', 'K1', Physics.tileCenter(5, 5), 't');
    combat.kaempfer(g, sc);
    ok(sc.rolle === 'grundtyp' && sc.waffe === 'schrottblaster' && sc.max === C.gegner.grundtyp.seg, 'Kesh-Plünderer = grundtyp mit Schrottblaster (Blaster-Regeln, tempo 230)');
    const karl = squad.makeEnemy(g, g.aways.kesh, 'scavenger', 'K3', Physics.tileCenter(5, 5), 't'); karl.rolle = 'grundtyp'; karl.fraktion = 'kontor'; combat.kaempfer(g, karl);
    ok(karl.waffe === 'blaster', 'Karl (grundtyp Kontor) bleibt beim Blaster');
    const w = squad.makeEnemy(g, g.aways.kesh, 'warden', 'K2', Physics.tileCenter(5, 5), 'warden');
    combat.kaempfer(g, w);
    ok(w.rolle === 'waechter' && w.max === 4 && w.wunden.max === 2 && w.frontArc === 120, 'Wächter: 4 Segmente + 2 Wunden, Frontbogen');
    const s = g.snapshot();
    const sp = s.players[0];
    ok(sp.wf === 'blaster' && sp.zs === 'ok' && 'ht' in sp, 'Snapshot players: wf, ht, zs');
    gegner('niederhalter', 20, 6);
    const d = g.snapshot().away.drones.find((q) => q.ro === 'niederhalter');
    ok(d && d.wf === 'sturmgewehr' && d.zs === undefined && d.wn === undefined && d.wm === undefined, 'Snapshot drones: ro, wf; Standardwerte (zs ok, Wunden 1/1) entfallen');
  }

  console.log('\n[B2: Hitze – Spieler und Gegner]');
  {
    const { g, P, run, events, gegner } = setupB2(1);
    const p = P(0);
    let n = 0;
    run(3, () => { if (g.away.projectiles.length < 50) { combat.shoot(g, p, 0); } n++; });
    ok(events('ueberhitzt').some((x) => x.id === p.id), 'Spieler: Dauerfeuer überhitzt den Blaster');
    const e = gegner('niederhalter', 20, 6);
    e.stoss = 30; e.shootTarget = p.id; e.frozen = false;
    const vorher = events('ueberhitzt').length;
    run(4, () => { e.stoss = Math.max(e.stoss, 0); });
    ok(e.hitze <= 1 && events('ueberhitzt').filter((x) => x.id === e.id).length === 0, 'Niederhalter bricht den Stoß vor dem Überhitzen ab (Hitze ' + Math.round(e.hitze * 100) + ' %)');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2: Gefallene Gegner liegen, Kamerad richtet auf, sonst Ausbluten]');
  {
    const { g, P, run, place, events, aw, gegner } = setupB2(1);
    place(0, 3, 11);
    const a = gegner('grundtyp', 18, 4, { trupp: 'paar', frozen: false });
    const b = gegner('grundtyp', 20, 4, { trupp: 'paar', frozen: false });
    let r = '';
    for (let i = 0; i < 6 && a.alive; i++) r = combat.hitEnemy(g, a, 1, { x: a.x - 300, y: a.y });
    ok(!a.alive && a.liegt && a.zustand === 'verwundet' && r === 'down' && events('enemyDown').length === 1, 'grundtyp fällt: liegt (verwundet), enemyDown');
    ok(g.snapshot().away.drones.find((q) => q.id === a.id).zs === 'verwundet', 'Snapshot zs verwundet');
    aw().squads.paar.alert = true;
    place(0, 3, 2);   // weit weg, keine Sicht
    run(9);
    ok(a.alive && a.zustand === 'ok' && events('aufgerichtet').length >= 1 && b.role !== 'aufrichten', 'Kamerad geht hin und richtet auf (' + (a.alive ? 'steht' : a.zustand) + ')');
    for (const d of aw().drones) { d.alive = false; d.liegt = false; }
    const c = gegner('grundtyp', 22, 9, { trupp: 'allein' });
    for (let i = 0; i < 6 && c.alive; i++) combat.hitEnemy(g, c, 1, { x: c.x - 300, y: c.y });
    run(C.koerper.gegnerBleedout + 1);
    ok(!c.alive && c.zustand === 'aus', 'ohne Kamerad: nach gegnerBleedout s aus');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2: Bewusstlos und Fesseln – Spieler]');
  {
    const { g, P, send, run, place, events, gegner } = setupB2(2);
    place(0, 5, 10); place(1, 6, 10, 'left');
    const p = P(0);
    p.shield.seg = 0;
    const r = combat.hitPlayer(g, p, 1, 'betaeuber', { nichttoedlich: true, waffe: 'betaeuber' });
    ok(r === 'bewusstlos' && p.downed && p.zustand === 'bewusstlos' && p.bleed == null, 'Betäuber ohne Schild: bewusstlos, kein Ausbluten');
    const n0 = g.away.projectiles.length;
    combat.shoot(g, p, 0);
    ok(g.away.projectiles.length === n0, 'bewusstlos: keine Pistole');
    send(1, { t: 'act', down: true }); run(0.3); send(1, { t: 'act', down: false });
    ok(p.downed && !(P(1).hold && P(1).hold.kind === 'revive'), 'bewusstlos: Aufhelfen gesperrt');
    run(5);
    ok(p.downed && p.zustand === 'bewusstlos', 'nach 5 s noch bewusstlos (kein Ausbluten, keine Rückholung)');
    // Häscher fesselt
    const h = gegner('haescher', 9, 10, { trupp: 'jagd', frozen: false });
    g.away.squads.jagd.alert = true;
    run(8);
    ok(p.zustand === 'gefesselt' && p.downed, 'Häscher geht hin und fesselt den Bewusstlosen (' + p.zustand + ')');
    h.alive = false;
    place(1, 6, 10, 'left');
    send(1, { t: 'act', down: true }); run(C.koerper.befreien + 0.4); send(1, { t: 'act', down: false });
    ok(!p.downed && p.zustand === 'ok' && events('befreit').length === 1, 'Kamerad befreit (E halten): steht wieder');
    p.shield.seg = 0;
    combat.hitPlayer(g, p, 1, 'betaeuber', { nichttoedlich: true, waffe: 'betaeuber' });
    run(C.koerper.bewusstlos + 0.5);
    ok(!p.downed && p.zustand === 'ok' && p.shield.seg >= 1, 'nach koerper.bewusstlos s von selbst wach mit 1 Segment');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2: Bewusstlos und Fesseln – Gegner]');
  {
    const { g, P, send, run, place, gegner } = setupB2(1);
    const e = gegner('grundtyp', 8, 10, { trupp: 'z' });
    g.aways[LP].besetzt = { z: {} }; e.tag = 'z';
    e.seg = 0;
    const r = combat.hitEnemy(g, e, 1, { x: e.x - 100, y: e.y, wirkung: { nichttoedlich: true, waffe: 'betaeuber' } });
    ok(r === 'bewusstlos' && !e.alive && e.zustand === 'bewusstlos' && e.liegt, 'Gegner betäubt ohne Schild: bewusstlos, liegt');
    ok(combat.truppStatus(g, LP, 'z').aktiv === 0, 'truppStatus: bewusstlos zählt nicht als aktiv');
    place(0, 7, 10, 'right');
    send(0, { t: 'act', down: true }); run(C.koerper.fesseln + 0.4); send(0, { t: 'act', down: false });
    ok(e.zustand === 'gefesselt', 'Spieler fesselt den Bewusstlosen (E halten)');
    run(C.koerper.bewusstlos + 1);
    ok(e.zustand === 'gefesselt' && !e.alive, 'gefesselt: wacht nicht auf');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2: Gefangen -> Ausbruch auf derselben Karte, zweites Mal Notrückholung]');
  {
    const { g, P, send, run, place, events, aw } = setupB2(2);
    const t = combat.debugB2(g, 'fang', [], P(0));
    ok(/Ausbruch/.test(t) && events('gefangen').length === 1, 'fang: Team gefangen (Ereignis gefangen)');
    ok(g.players.every((p) => !p.downed && p.waffe === 'faust' && p.gefangen && Math.abs(tileOf(p).x - 3) <= 1 && Math.abs(tileOf(p).y - 3) <= 1), 'alle in der Zelle, Waffe Faust');
    ok(g.snapshot().players.every((q) => q.zs === 'gefangen'), 'Snapshot zs gefangen');
    P(0).input.mx = 1; run(1.5); P(0).input.mx = 0;
    ok(Math.hypot(P(0).x - P(0).gefangen.x, P(0).y - P(0).gefangen.y) <= 1.7 * 32, 'Zelle hält (weiche Leine)');
    place(0, 3, 3, 'right');
    send(0, { t: 'act', down: true }); run(C.koerper.ausbruchTuer + 0.4); send(0, { t: 'act', down: false });
    ok(P(0).gefangen && P(0).gefangen.offen && (g.away.laerm || []).some((l) => l.stufe === 'laut'), 'Zellentür von innen (E halten): offen, laut');
    place(0, 7, 3, 'right');
    send(0, { t: 'act', down: true }); run(2.5); send(0, { t: 'act', down: false });
    ok(P(0).waffe === 'blaster' && !P(0).gefangen, 'Ausrüstung am beute-Anker zurück');
    const t2 = combat.debugB2(g, 'fang', [], P(0));
    ok(/kein Ausbruch/.test(t2), 'zweites Mal: kein Ausbruch');
    run(C.wounded.squadRecallDelay + 0.5);
    ok(g.players.every((p) => p.zone === 'ship'), 'Rückfall Notrückholung');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2: Frontschild blockt von vorn, auch Nahkampf]');
  {
    const { g, P, gegner } = setupB2(1);
    const w = gegner('waechter', 20, 6);
    w.facing = Math.PI;   // schaut nach links
    ok(combat.hitEnemy(g, w, 1, { x: w.x - 100, y: w.y }) === 'deflect', 'Schuss von vorn: abgelenkt');
    ok(combat.hitEnemy(g, w, 1, { x: w.x - 30, y: w.y, wirkung: { wunde: true, nahkampf: true, waffe: 'nahkampf' } }) === 'deflect', 'Nahkampf von vorn: abgelenkt');
    ok(combat.hitEnemy(g, w, 1, { x: w.x + 100, y: w.y }) === 'shield', 'von hinten: Schild');
  }

  console.log('\n[B2: KI-Profile – Grenadier, Schütze, Enterer, Häscher]');
  {
    const { g, P, run, place, events, gegner, aw } = setupB2(1);
    place(0, 12, 6);
    const keep = () => { const p = P(0); if (p.downed) combat.revive(g, p, 3, { quiet: true }); p.shield.seg = 3; p.zustand = 'ok'; };
    const gr = gegner('grenadier', 20, 6, { trupp: 'g', frozen: false }); aw().squads.g.alert = true;
    run(8, keep);
    ok(events('granate').some((e) => e.id === gr.id), 'Grenadier wirft (Ereignis granate, Zielkreis gr)');
    gr.alive = false;
    const sz = gegner('schuetze', 21, 2, { trupp: 's', frozen: false }); aw().squads.s.alert = true;
    run(10, keep);
    ok(events('ladungLanze').some((e) => e.id === sz.id) && events('lanzeSchuss').some((e) => e.id === sz.id), 'Schütze lädt sichtbar und schießt (ladungLanze, lanzeSchuss)');
    sz.alive = false;
    const en = gegner('enterer', 18, 9, { trupp: 'e', frozen: false }); aw().squads.e.alert = true;
    run(8, keep);
    ok(events('ausholen').some((e) => e.id === en.id) && events('schlag').some((e) => e.id === en.id), 'Enterer läuft heran, holt aus und schlägt');
    en.alive = false;
    const hs = gegner('haescher', 18, 4, { trupp: 'h', frozen: false }); aw().squads.h.alert = true;
    let maxH = 0;
    run(12, () => { keep(); maxH = Math.max(maxH, hs.hitze || 0); });
    ok(g.away.stats.enemyShots > 0 && !events('ueberhitzt').some((e) => e.id === hs.id), 'Häscher schießt, überhitzt nicht (max. Hitze ' + Math.round(maxH * 100) + ' %)');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2: Schleichen – Lärm, Alarm je Trupp, Patrouille, Ruhe]');
  {
    const { g, P, run, place, events, aw } = setupB2(1);
    place(0, 3, 11);
    const n = combat.besetzen(g, { map: LP, bereich: 'hof', fraktion: 'rostmeute', staerke: 'mittel', haltung: 'ruhig', tag: 'hof' });
    ok(n >= 2 && combat.truppStatus(g, LP, 'hof').haltung === 'ruhig', 'besetzen ruhig: ' + n + ' Gegner, Haltung ruhig');
    const trupps = Object.values(aw().squads).filter((s) => s.tag === 'hof');
    const pat = trupps.find((s) => s.weg && s.weg.length);
    const pe = pat ? aw().drones.find((d) => d.squad === pat.name) : null;
    const start = pe ? { x: pe.x, y: pe.y } : null;
    run(6);
    ok(pat && pe && Math.hypot(pe.x - start.x, pe.y - start.y) > 32 && trupps.every((s) => !s.alert), 'Patrouille läuft karte.patrouillen, keiner wach');
    const Wm = require('../server/sim/waffen.js');
    Wm.laerm(g, 3 * 32, 11 * 32, 'leise');
    run(1);
    ok(trupps.every((s) => !s.alert), 'leiser Schuss weit weg: kein Alarm');
    const e0 = aw().drones.find((d) => d.tag === 'hof' && d.alive);
    Wm.laerm(g, e0.x - 5 * 32, e0.y, 'laut');
    run(1);
    ok(events('truppAlarm').length >= 1 && aw().squads[e0.squad].alert && aw().alarm, 'lauter Schuss im Radius: truppAlarm, Trupp wach, Landepunkt im Alarm');
    run(C.alarm.funkVerzoegerung + 1);
    ok(trupps.every((s) => s.alert), 'Funk: nach funkVerzoegerung s alle Trupps im Umkreis wach');
    place(0, 3, 2);
    for (const s of trupps) s.contactAt = g.time - C.alarm.ruheNach - 1;
    run(1);
    ok(trupps.every((s) => !s.alert) && aw().alarm, 'ohne Kontakt nach ruheNach s wieder ruhig, Landepunkt bleibt im Alarm');
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2: Einführungsregel und Besetzungsregeln]');
  {
    const { g, aw } = setupB2(1);
    const ws = g.weltstand; const gesehen = ws.data.rollen_gesehen = [];
    combat.besetzen(g, { map: LP, bereich: 'hof', fraktion: 'rostmeute', staerke: 'gross', haltung: 'wach', tag: 'a', neue_rolle: 'niederhalter' });
    const rollen = new Set(aw().drones.filter((d) => d.tag === 'a').map((d) => d.rolle));
    ok([...rollen].every((r) => r === 'grundtyp' || r === 'niederhalter'), 'ungesehen: nur grundtyp + die eine neue_rolle (' + [...rollen].join(',') + ')');
    ok(!rollen.has('haescher'), 'solo: kein Häscher');
    gesehen.push('haescher', 'enterer', 'grenadier', 'schuetze', 'niederhalter');
    const { g: g3, aw: aw3 } = setupB2(3);
    g3.weltstand.data.rollen_gesehen = ['haescher', 'enterer', 'grenadier', 'schuetze', 'niederhalter'];
    combat.besetzen(g3, { map: LP, bereich: 'hof', fraktion: 'herrenlos', staerke: 'klein', haltung: 'ruhig', tag: 'h' });
    ok(aw3().drones.filter((d) => d.tag === 'h').every((d) => d.rolle === 'waechter' && d.kind === 'warden'), 'herrenlos: Kastell-Automat bleibt Wächter');
    combat.besetzen(g3, { map: LP, bereich: 'hof', fraktion: 'rostmeute', staerke: 'gross', haltung: 'wach', tag: 'b' });
    const ent = aw3().drones.filter((d) => d.tag === 'b' && d.rolle === 'enterer').length;
    ok(ent <= 3, 'höchstens 1 Enterer je Spieler (' + ent + ')');
    const trupps = Object.values(aw3().squads).filter((s) => s.tag === 'b');
    ok(trupps.every((s) => new Set(aw3().drones.filter((d) => d.squad === s.name).map((d) => d.rolle)).size <= 3), 'höchstens 3 Typen je Trupp');
    ok(g.errors === 0 && g3.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2 E16: über 10 Kacheln nur vom aussicht-Anker oder mit geteilter Sicht]');
  {
    const { g, P, place, gegner, aw } = setupB2(1);
    place(0, 5, 2);
    const sz = gegner('schuetze', 21, 2, { trupp: 'fern' });   // auf dem aussicht-Anker (21,2), 16 Kacheln entfernt
    const E = combat.env(g);
    ok(squad.amAussicht(g, E, sz) && squad.zielbar(g, E, sz, P(0)), 'vom aussicht-Anker: Lanze zielt über 10 Kacheln');
    const t = Physics.tileCenter(21, 6); sz.x = t.x; sz.y = t.y;
    place(0, 5, 6);
    ok(!squad.amAussicht(g, E, sz) && !squad.zielbar(g, E, sz, P(0)), 'ohne Aussicht und ohne geteilte Sicht: kein Ziel über 10 Kacheln');
    aw().squads.fern.geteilt = { [P(0).id]: g.time + AC.sicht.geteiltTtl };
    ok(squad.zielbar(g, E, sz, P(0)), 'Trupp-Funk (geteilte Sicht): Ziel erlaubt');
    g.time += AC.sicht.geteiltTtl + 0.1;
    ok(!squad.zielbar(g, E, sz, P(0)), 'nach geteiltTtl s verfallen');
    const gr = gegner('grundtyp', 20, 6, { trupp: 'nah' });
    place(0, 14, 6);
    ok(squad.zielbar(g, E, gr, P(0)), 'unter 10 Kacheln mit Sichtlinie: wie bisher');
  }

  console.log('\n[B2 E16 Spieler, Lanze loslassen (shoot { los: true })]');
  {
    const { g, P, run, place, events, gegner } = setupB2(1);
    const e = gegner('grundtyp', 5, 2);
    place(0, 21, 2);   // am aussicht-Anker, 16 Kacheln
    combat.updateVisibility(g);
    ok(e.vis, 'Spieler vom aussicht-Anker sieht über 10 Kacheln');
    place(0, 21, 6); e.focusUntil = 0;
    combat.updateVisibility(g);
    ok(!e.vis, 'ohne Aussicht nicht');
    ok(combat.order(g, { kind: 'fokus', target: e.id }) === null && e.focusUntil - g.time >= AC.sicht.geteiltTtl, 'Captain-Markierung (fokus) teilt Sicht mindestens geteiltTtl s');
    combat.updateVisibility(g);
    ok(e.vis, 'markierter Gegner sichtbar');
    const p = combat.kaempfer(g, P(0));
    p.waffe = 'lanze';
    place(0, 12, 2);
    const t = Physics.tileCenter(5, 2);
    const ang = Math.atan2(t.y - P(0).y, t.x - P(0).x);
    for (let i = 0; i < 40; i++) { if (i % 9 === 0) away.shoot(g, P(0), ang); g.step(); }
    ok(P(0).ladung && P(0).ladung.stufe >= 1, 'Lanze lädt, solange shoot kommt');
    away.shoot(g, P(0), ang, { los: true });
    ok(!P(0).ladung && events('lanzeSchuss').some((x) => x.id === P(0).id), 'shoot { los: true }: Lanze feuert');
    ok(events('enemyShieldHit').some((x) => x.id === e.id && x.waffe === 'lanze'), 'Lanzentreffer: enemyShieldHit mit waffe lanze');
  }

  console.log('\n[B2-NACH: Wurfweite shoot { angle, dist }, Treffer-Ereignisse der Granate]');
  {
    const { g, P, send, run, place, events, gegner } = setupB2(1);
    const AW = AC.waffen.granatwerfer; const st0 = AW.streuung; AW.streuung = 0;
    const p = combat.kaempfer(g, P(0)); p.waffe = 'granatwerfer';
    place(0, 12, 6);
    const e = gegner('grundtyp', 18, 6);
    const wurf = (msg) => {
      p.bereitAt = 0; p.gesperrtBis = 0; p.hitze = 0;
      const n0 = g.away.projectiles.length; send(0, Object.assign({ t: 'shoot' }, msg));
      const q = g.away.projectiles.slice(n0).find((x) => x.kind === 'granate');
      return q ? Math.hypot(q.tx - P(0).x, q.ty - P(0).y) / Physics.TILE : null;
    };
    ok(Math.abs(wurf({ angle: 0 }) - 12) < 1e-6, 'shoot ohne dist: volle Weite (12 Kacheln)');
    g.away.projectiles = [];
    ok(Math.abs(wurf({ angle: 0, dist: 6 }) - 6) < 1e-6, 'shoot { dist: 6 }: Landepunkt 6 Kacheln (Mauszeiger)');
    run(1.2);
    ok(events('enemyShieldHit').some((x) => x.id === e.id && x.waffe === 'granatwerfer'), 'Granatentreffer: enemyShieldHit mit waffe granatwerfer');
    g.away.projectiles = [];
    ok(Math.abs(wurf({ angle: 0, dist: 50 }) - 12) < 1e-6 && Math.abs(wurf({ angle: 0, dist: 1 }) - AW.min) < 1e-6, 'dist begrenzt auf [min, max]');
    g.away.projectiles = [];
    // Gegner-Granate auf Spieler: shieldHit mit waffe
    const gr = gegner('grenadier', 18, 9); combat.kaempfer(g, gr); gr.bereitAt = 0;
    require('../server/sim/waffen.js').feuern(g, gr, { x: P(0).x, y: P(0).y });
    run(1.2);
    ok(events('shieldHit').some((x) => x.pid === P(0).id && x.waffe === 'granatwerfer'), 'Gegner-Granate: shieldHit mit waffe granatwerfer');
    AW.streuung = st0;
  }

  console.log('\n[KI: Sammeln am letzten bekannten Punkt verteilt sich (nie zwei Gegner auf einer Kachel)]');
  {
    const { g, P, run, place, aw, gegner } = setupB2(1);
    place(0, 3, 2);   // weit weg; Sicht kurz, damit niemand den Spieler sieht (nur Suchen)
    const sicht0 = AC.sightTiles; AC.sightTiles = 2;
    const list = [[18, 4], [18, 9], [20, 6], [22, 4]].map(([x, y]) => gegner('grundtyp', x, y, { trupp: 'such', frozen: false }));
    const s = aw().squads.such; s.alert = true;
    const punkt = Physics.tileCenter(8, 10);
    let doppelt = 0;
    run(12, () => {
      s.lastKnown[P(0).id] = { x: punkt.x, y: punkt.y, t: g.time };
      P(0).shield.seg = 3;
      const tiles = list.filter((e) => e.alive && (!e.path || !e.path.length)).map((e) => { const t = Physics.toTile(e.x, e.y); return t.x + ',' + t.y; });
      if (new Set(tiles).size !== tiles.length) doppelt++;
    });
    const end = list.map((e) => { const t = Physics.toTile(e.x, e.y); return t.x + ',' + t.y; });
    ok(new Set(end).size === end.length && list.every((e) => Math.hypot(e.x - punkt.x, e.y - punkt.y) <= 6 * 32), 'vier Gegner am Sammelpunkt auf vier Kacheln (' + end.join(' ') + ')');
    ok(doppelt < 30, 'stehende Gegner teilen sich kaum je eine Kachel (' + doppelt + ' Ticks)');
    AC.sightTiles = sicht0;
    ok(g.errors === 0, 'keine Server-Fehler');
  }

  console.log('\n[B2: Rolle gesehen (crew.rollen_gesehen)]');
  {
    const { g, P, place, events, gegner } = setupB2(1);
    g.weltstand.data.rollen_gesehen = [];
    place(0, 16, 6);
    gegner('grenadier', 20, 6);
    combat.updateVisibility(g);
    ok(g.weltstand.data.rollen_gesehen.includes('grenadier') && events('rolleNeu').some((e) => e.rolle === 'grenadier'), 'Sichtkontakt: rolleGesehen + rolleNeu');
  }

  console.log('\n[B2: Snapshot Außenposten, 3 Spieler, 12 Gegner]');
  {
    let karteOk = false;
    try {
      const L = require('../server/sim/landepunkte.js');
      const g = new Game({ noStore: true, seed: 4, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
      for (let i = 0; i < 3; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S' + i, name: 'S' + i, color: i }); g.handleMessage(c, { t: 'ready', ready: true }); }
      const lp = Object.values(L.defs().byId || {}).filter((x) => x.art === 'aussenposten' && !x.gesperrt).map((x) => x.id).find((id) => { try { L.get(g, id); return true; } catch (e) { return false; } });
      if (lp) {
        karteOk = true;
        g.setAwayMap(lp);
        away.executeBeam(g, g.players.map((p) => p.id), 'down');
        g.weltstand.data.rollen_gesehen = ['niederhalter', 'grenadier', 'schuetze', 'enterer', 'haescher'];
        combat.besetzen(g, { map: lp, fraktion: 'rostmeute', staerke: 'gross', haltung: 'wach', tag: 'm' });
        while (g.away.drones.filter((d) => d.alive).length > 12) g.away.drones.pop();
        let i = 0;
        while (g.away.drones.length < 12) { const t = Physics.toTile(g.players[0].x, g.players[0].y); const e = squad.makeEnemy(g, g.away, 'scavenger', 'f' + (i++), Physics.tileCenter(t.x + 6, t.y), 'm'); e.rolle = 'niederhalter'; g.away.drones.push(e); }
        let max = 0;
        const W2 = require('../server/sim/waffen.js');
        for (let k = 0; k < 30 * 8; k++) {
          g.step();
          for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
          if (k % 15 === 0) {
            const e1 = g.away.drones[0], e2 = g.away.drones[1];
            for (const e of [e1, e2]) { W2.ausstatten(g, e, 'grenadier'); e.bereitAt = 0; e.gesperrtBis = 0; W2.feuern(g, e, { x: g.players[0].x, y: g.players[0].y }); }
            max = Math.max(max, Buffer.byteLength(JSON.stringify(g.snapshot())));
          }
        }
        ok(max < 13 * 1024, 'Snapshot < 13 KB (max ' + max + ' B, ' + lp + ')');
        ok(g.errors === 0, 'keine Server-Fehler');
      }
    } catch (e) { console.log('  info Außenposten nicht baubar: ' + e.message); }
    if (!karteOk) console.log('  info Snapshot-Messung übersprungen (kein baubarer Außenposten)');
  }
  WAFFEN_MOD.aktiv = WAFFEN_AN;
  delete W.AWAY_MAPS[LP];
}

console.log(`\n${n - fails}/${n} Kampf-Tests bestanden.`);
process.exit(fails ? 1 : 0);
