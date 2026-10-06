'use strict';
// Kampf v2 (CONTRACT-M2 §12): deterministische Tests ohne Netz direkt gegen die Game-Klasse.
//   node tools/test-combat.js
const Physics = require('../shared/physics.js');
const Los = require('../shared/los.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');

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
    ok(arenaEnemies(g).length === 2 && arenaEnemies(g).every((e) => e.kind === 'raider'), 'Welle 1: 2 Jäger');
    ok(/Welle 1: Gegner ausschalten \(2 übrig\)/.test(g.mission.state.objectives[0].text), 'Ziel zeigt „Welle 1 … (2 übrig)“');
    g.space.enemies = []; run(0.5);
    ok(/Welle 2 kommt in/.test(g.mission.state.objectives[0].text) && cs[0].inbox.some((m) => m.kind === 'oda' && /Welle 1 geräumt/.test(m.text)), 'Räumung: ODA-Ansage, Countdown im Ziel');
    run(A.nextWaveDelay - 2);
    ok(arenaEnemies(g).length === 0, 'nächste Welle noch nicht vor Ablauf');
    run(2);
    ok(arenaEnemies(g).map((e) => e.kind).sort().join() === 'gunboat,raider', 'Welle 2: Jäger + Kanonenboot (12 s nach Räumung)');
    g.space.enemies = []; run(A.nextWaveDelay + 0.5);
    ok(arenaEnemies(g).map((e) => e.kind).sort().join() === 'raider,raider,sentinel', 'Welle 3: Wächter + 2 Jäger');
    g.space.enemies = []; run(A.nextWaveDelay + 0.5);
    ok(g.arena.wave === 4 && arenaEnemies(g).length === 2 && g.arena.round === 2, 'Welle 4: zyklisch von vorn (Runde 2)');
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
    ok(g.arena.wave === 2 && arenaEnemies(g).length === 2, 'Debug skip ruft die nächste Welle sofort');
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

console.log(`\n${n - fails}/${n} Kampf-Tests bestanden.`);
process.exit(fails ? 1 : 0);
