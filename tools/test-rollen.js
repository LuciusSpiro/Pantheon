'use strict';
// R1 (CONTRACT-ROLLEN §4): Technik-Station, Tab-Wechsel (Interface statt Ort), Waffenautomatik nur bei ≤ 2 Spielern, Bot-Automatik.
//   node tools/test-rollen.js
// Die Testfixture ist das Raumkampf-Testgelände (Lobby-Start arena_space, ohne Wellen); die Spielerzahl der Fixtures ist 1–3
// (maxPlayers). Die Zahl 4 wird über Spielerlisten ohne Server geprüft (reine Funktionen in server/sim/station.js).
const Physics = require('../shared/physics.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const W = require('../server/world.js');
const space = require('../server/sim/space.js');
const Station = require('../server/sim/station.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
};

const STAND = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']];
function standSpots(tiles) {
  const out = [];
  for (const t of (Array.isArray(tiles) ? tiles : [tiles])) for (const [dx, dy, dir] of STAND) {
    const s = { x: t.x + dx, y: t.y + dy, dir };
    if (!W.ship.solid(s.x, s.y) && !out.some((o) => o.x === s.x && o.y === s.y)) out.push(s);
  }
  return out;
}
const conSpot = (con) => standSpots(W.CONSOLE_TILES[con])[0];

function arena(players, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'R' + i, name: 'R' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = 1100; sh.y = 1500; sh.angle = 0; sh.vx = 0; sh.vy = 0; if ('turnVel' in sh) sh.turnVel = 0;
  const P = (i) => g.players[i];
  const send = (i, m) => g.handleMessage(conns[i], m);
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec * 30); k++) { if (each) each(); g.step(); } };
  const place = (i, s) => { const p = P(i); const c = Physics.tileCenter(s.x, s.y); p.x = c.x; p.y = c.y; p.dir = s.dir || 'down'; p.input.mx = 0; p.input.my = 0; };
  const leave = (i) => { if (P(i).console) send(i, { t: 'leave' }); };
  const tap = (i) => { send(i, { t: 'act', down: true }); send(i, { t: 'act', down: false }); };
  const enter = (i, con) => { leave(i); place(i, conSpot(con)); tap(i); return P(i).console === con; };
  const cmd = (i, c, extra) => send(i, Object.assign({ t: 'cmd', c }, extra || {}));
  const tab = (i, dir) => cmd(i, Protocol.CMD_STATION_TAB, { dir: dir || 1 });
  const notices = (i) => conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);
  const odas = () => conns[0].inbox.filter((m) => m.kind === 'oda').map((m) => m.text);
  return { g, conns, P, send, run, place, leave, tap, enter, cmd, tab, notices, odas };
}
const stationsOf = (g) => g.players.map((p) => Station.stationOf(p));

section('Technik-Konsole: Karte, Legende, Betreten, Exklusivität', () => {
  ok(Protocol.CONSOLES.includes('technik') && Protocol.STATION_KREIS.join() === 'helm,weapons,captain,technik', 'Protocol: Konsole technik, Stationskreis Navigation → Ops → Captain → Technik');
  const tiles = W.CONSOLE_TILES.technik || [];
  ok(tiles.length === 1, 'genau eine Technik-Konsole auf dem Schiff');
  const t = tiles[0];
  const room = require('../shared/maps.js').roomAt(t.x, t.y);
  ok(room && room.id === 'maschinenraum', `liegt im Maschinenraum (${room && room.id}, Kachel ${t.x},${t.y})`);
  // Durchgang bleibt frei: von der Westtür (10,6) zur Osttür (16,6) führt ein Weg
  const { bfs } = require('../server/util.js');
  const path = bfs((x, y) => !W.ship.solid(x, y), { x: 10, y: 6 }, (x, y) => x === 16 && y === 6, 37, 29);
  ok(path && path.length > 0, 'Durchgang des Maschinenraums (Westtür bis Osttür) bleibt begehbar');
  const { g, P, enter, send, place, tap } = arena(2);
  ok(enter(0, 'technik'), 'Spieler 0 betritt die Technik-Konsole');
  ok(Station.stationOf(P(0)) === 'technik' && P(0).station == null, 'Station = Ort technik (p.station bleibt null)');
  place(1, conSpot('technik')); tap(1);
  ok(P(1).console == null, 'zweiter Spieler kommt nicht an die belegte Technik-Konsole (exklusiv)');
  const s = g.snapshot().players[0];
  ok(s.console === 'technik' && !('station' in s), 'Snapshot: players[].station fehlt, solange Interface = Ort');
  send(0, { t: 'leave' });
  ok(P(0).console == null && Station.stationOf(P(0)) === null, 'Verlassen räumt Ort und Station');
});

section('Befehle: technik.* wirken, captain.* weisen ab, Rechteprüfung gegen die Station', () => {
  const { g, P, enter, cmd, notices, run, leave, tab } = arena(2);
  g.ship.botAutoChosen = false;
  // technik.power / shield / botAuto an der Technik-Konsole
  enter(0, 'technik');
  const e0 = g.ship.power.engines, w0 = g.ship.power.weapons;
  cmd(0, 'technik.power', { sys: 'weapons', delta: -1 }); cmd(0, 'technik.power', { sys: 'engines', delta: 1 });
  ok(g.ship.power.weapons === w0 - 1 && g.ship.power.engines === e0 + 1, 'technik.power verschiebt Energie');
  const a0 = g.ship.shields.alloc.slice();
  cmd(0, 'technik.shield', { sector: 3, delta: -1 }); cmd(0, 'technik.shield', { sector: 0, delta: 1 });
  ok(g.ship.shields.alloc[3] === Math.max(0, a0[3] - 1) || g.ship.shields.alloc.join() !== a0.join(), 'technik.shield verteilt Schildpunkte');
  cmd(0, 'technik.botAuto', { on: true });
  ok(g.ship.botAuto === true && g.ship.botAutoChosen === true, 'technik.botAuto an');
  cmd(0, 'technik.priority', { target: 'fire' });
  ok(g.ship.priority === 'fire', 'technik.priority');
  cmd(0, 'technik.repair', { system: 'engines', mode: 'flick' });
  ok(notices(0).some((t) => /heil|schon/i.test(t)) || g.ship.repairQueue.length === 0, 'technik.repair läuft durch den Server (heiles System: Hinweis)');
  // alte Befehle weisen ab – auch an der Technik-Konsole, nur Hinweis
  for (const alt of Protocol.CMD_CAPTAIN_ALT_TECHNIK) {
    leave(0); enter(0, 'captain');
    const n0 = notices(0).length; const pw = JSON.stringify(g.ship.power); const bo = g.ship.botAuto;
    cmd(0, alt, { sys: 'engines', delta: 1, sector: 0, target: null, system: 'engines', mode: 'flick', on: !bo });
    ok(notices(0).slice(n0).includes('Das macht jetzt die Technik.') && JSON.stringify(g.ship.power) === pw && g.ship.botAuto === bo, `${alt}: nur „Das macht jetzt die Technik.“, kein Effekt`);
  }
  // Rechteprüfung: technik.* an der Captain-Konsole (Station captain) und ohne Konsole abgelehnt
  const n1 = notices(0).length; const pw1 = JSON.stringify(g.ship.power);
  cmd(0, 'technik.power', { sys: 'life', delta: 1 });
  ok(notices(0).slice(n1).some((t) => /passenden Konsole/.test(t)) && JSON.stringify(g.ship.power) === pw1, 'technik.power an der Captain-Konsole (Station captain): abgelehnt');
  leave(0);
  const n2 = notices(0).length;
  cmd(0, 'technik.power', { sys: 'life', delta: 1 });
  ok(notices(0).slice(n2).some((t) => /passenden Konsole/.test(t)), 'technik.power ohne Konsole: abgelehnt');
  // gegen die STATION geprüft, nicht gegen den Ort: Captain-Ort, Interface per Tab auf Technik
  enter(0, 'captain');
  tab(0, 1);
  ok(P(0).console === 'captain' && Station.stationOf(P(0)) === 'technik', 'Tab: Ort bleibt captain, Station technik');
  const p1 = g.ship.power.engines; const n5 = notices(0).length;
  cmd(0, 'technik.power', { sys: 'engines', delta: -1 });
  ok(g.ship.power.engines === p1 - 1 && !notices(0).slice(n5).some((t) => /passenden Konsole/.test(t)), 'technik.power am Captain-Ort mit Station technik: angenommen');
  const n3 = notices(0).length;
  cmd(0, 'captain.scan', { on: true });
  ok(notices(0).slice(n3).some((t) => /passenden Konsole/.test(t)), 'captain.scan mit Station technik: abgelehnt (Captain-Station nicht aktiv)');
  const n4 = notices(0).length;
  cmd(0, 'helm.stop');
  ok(notices(0).slice(n4).some((t) => /passenden Konsole/.test(t)), 'helm.stop mit Station technik: abgelehnt');
  // direkt aufrufbare, umbenannte Server-Funktionen
  ok(typeof space.technikPower === 'function' && typeof space.technikShield === 'function' && typeof space.technikOverload === 'function'
    && !space.captainPower && !space.captainShield && !space.captainOverload, 'space: technikPower/technikShield/technikOverload (captain* entfallen)');
  g.ship.reactorCtl.state = 'online'; g.ship.systems.reactor = 'ok';
  cmd(0, 'technik.overload');
  ok(g.ship.reactorCtl.state === 'overload', 'technik.overload überlädt den Reaktor');
});

section('Tab: Reihenfolge, Ort bleibt, Grenzen', () => {
  const { g, P, enter, tab, notices, run, send, cmd, leave } = arena(1);
  // Reihenfolge vorwärts ab Steuer: Ops, Captain, Technik, Steuer
  enter(0, 'helm');
  const seq = [];
  for (let i = 0; i < 4; i++) { tab(0, 1); seq.push(Station.stationOf(P(0))); }
  ok(seq.join() === 'weapons,captain,technik,helm', `Tab vorwärts: ${seq.join(' → ')}`);
  ok(P(0).console === 'helm' && P(0).station == null, 'Ort bleibt Steuer; zurück auf den Ort: p.station = null');
  const rev = [];
  for (let i = 0; i < 4; i++) { tab(0, -1); rev.push(Station.stationOf(P(0))); }
  ok(rev.join() === 'technik,captain,weapons,helm', `Shift+Tab rückwärts: ${rev.join(' → ')}`);
  tab(0, 1);
  const sn = g.snapshot().players[0];
  ok(sn.console === 'helm' && sn.station === 'weapons', 'Snapshot: players[].station = weapons, console = helm (nur bei Abweichung)');
  // Interface weg vom Steuer: das Ruder fällt (unbesetzte Steuer), neues Interface darf Ops-Befehle
  leave(0); enter(0, 'helm');
  cmd(0, 'helm.input', { turn: 1, thrust: 0 });
  ok(g.ship.helm.turn === 1, 'Steuer: Ruder gesetzt');
  tab(0, 1);
  ok(g.ship.helm.turn === 0, 'Tab weg von der Steuer: Ruder zurück auf 0');
  const n0 = notices(0).length;
  cmd(0, 'weapons.target', { id: null });
  ok(!notices(0).slice(n0).some((t) => /passenden Konsole/.test(t)), 'Ops-Befehle am Steuer-Ort mit Station weapons: angenommen');
  cmd(0, 'helm.stop');
  ok(notices(0).slice(n0).some((t) => /passenden Konsole/.test(t)), 'Steuer-Befehle mit Station weapons: abgelehnt');
  // Verlassen räumt die Station
  send(0, { t: 'leave' });
  ok(P(0).console == null && P(0).station == null, 'Verlassen räumt p.station');
  // Grenzen: keine Konsole, Konsolen außerhalb des Kreises, niedergeschlagen
  tab(0, 1);
  ok(notices(0).slice(-1)[0] && /nur an/.test(notices(0).slice(-1)[0]), 'Tab ohne Konsole: Hinweis');
  for (const con of ['transfer', 'plan']) {
    leave(0);
    if (enter(0, con)) { tab(0, 1); ok(P(0).station == null && P(0).console === con, `Konsole ${con} gehört nicht zum Kreis (Tab wirkt nicht)`); }
    else ok(false, `${con} betreten`);
  }
  leave(0); enter(0, 'captain');
  P(0).downed = true; tab(0, 1);
  ok(P(0).station == null, 'Niedergeschlagen: Tab wirkt nicht');
  P(0).downed = false; P(0).beamLock = true; tab(0, 1);
  ok(P(0).station == null, 'beamLock: Tab wirkt nicht');
  P(0).beamLock = false; P(0).zone = 'away'; tab(0, 1);
  ok(P(0).station == null, 'Zone away: Tab wirkt nicht');
  P(0).zone = 'ship';
  // Niederschlag räumt die Station
  tab(0, 1);
  ok(P(0).station === 'technik', 'Captain-Ort → Tab → Technik');
  require('../server/sim/interior.js').downPlayer(g, P(0), 'test');
  ok(P(0).console == null && P(0).station == null && Station.stationOf(P(0)) === null, 'Niederschlag räumt Ort und Station');
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Sperre belegter Stationen (zu dritt)', () => {
  const { g, P, enter, tab, notices, place, tap } = arena(3);
  enter(0, 'helm'); enter(1, 'captain');
  tab(0, 1);   // Steuer-Ort → Ops (frei)
  ok(Station.stationOf(P(0)) === 'weapons' && P(0).console === 'helm', 'Spieler 0: Ort Steuer, Interface Ops');
  ok(Station.stationBesetzt(g, 'weapons') && !Station.stationBesetzt(g, 'helm'), 'besetzt = aktives Interface: Ops ja, Steuer (Ort, aber umgeschaltet) nein');
  // Spieler 2 versucht die Ops-Konsole zu betreten: Konsole selbst frei, das Interface hält Spieler 0
  place(2, conSpot('weapons')); tap(2);
  ok(P(2).console == null, 'Ops-Konsole nicht betretbar, solange Spieler 0 die Ops per Tab hält');
  // Spieler 1 schaltet rückwärts: Ops ist gesperrt (P0), Steuer frei -> Steuer
  tab(1, -1);
  ok(Station.stationOf(P(1)) === 'helm' && P(1).console === 'captain', 'Spieler 1 (Captain-Ort) Shift+Tab: Ops gesperrt, springt auf die freie Steuer-Station');
  // Spieler 0 schaltet zurück auf den Kreis: Ops wird frei
  tab(0, 1);
  ok(Station.stationOf(P(0)) !== 'weapons' && !Station.stationBesetzt(g, 'weapons'), 'Spieler 0 verlässt die Ops: unbesetzt');
  // Hinweistext, wenn alles gesperrt ist: vier Spieler ohne Server
  const mk = (name, console, station) => ({ name, connected: true, zone: 'ship', downed: false, beamLock: false, console, station: station || null });
  const a = mk('Ada', 'helm', 'weapons'), b = mk('Bo', 'captain', 'helm'), c = mk('Cem', 'weapons', 'technik'), d = mk('Dan', 'technik', 'captain');
  const fake = { players: [a, b, c, d], C: CONFIG, emit() {}, notice() {} };
  const txt = Station.tab(fake, a, 1);
  ok(typeof txt === 'string' && /durch Bo besetzt/.test(txt) && /durch Cem besetzt/.test(txt) && /durch Dan besetzt/.test(txt), `alle Stationen belegt: Hinweis „${txt}“`);
  ok(a.station === 'weapons', 'bei vollständiger Sperre bleibt das Interface unverändert');
});

section('Waffenautomatik nur bei 1–2 verbundenen Spielern, Ops unbesetzt', () => {
  const fake = (n, conn) => ({ players: Array.from({ length: n }, (_, i) => ({ connected: conn ? conn[i] !== false : true, console: null, station: null })), C: CONFIG });
  ok(Station.waffenAutomatikAktiv(fake(1)) && Station.waffenAutomatikAktiv(fake(2)), 'Funktion: 1 und 2 Spieler, Ops unbesetzt: Automatik aktiv');
  ok(!Station.waffenAutomatikAktiv(fake(3)) && !Station.waffenAutomatikAktiv(fake(4)), 'Funktion: 3 und 4 Spieler: keine Automatik');
  ok(Station.waffenAutomatikAktiv(fake(3, [true, true, false])), 'nur verbundene Spieler zählen (3 Spieler, einer getrennt: Automatik)');
  const man = fake(2); man.players[0].console = 'weapons';
  ok(!Station.waffenAutomatikAktiv(man), 'Ops besetzt: keine Automatik');
  man.players[0].console = 'helm'; man.players[0].station = 'weapons';
  ok(!Station.waffenAutomatikAktiv(man), 'Ops per Tab besetzt (Ort Steuer): keine Automatik');
  man.players[0].station = 'technik'; man.players[0].console = 'weapons';
  ok(Station.waffenAutomatikAktiv(man), 'Ort Ops, Interface Technik: Ops unbesetzt, Automatik aktiv');
  ok(Station.botAutomatikStandard(fake(1)) && Station.botAutomatikStandard(fake(2)) && !Station.botAutomatikStandard(fake(3)) && !Station.botAutomatikStandard(fake(4)), 'Bot-Automatik-Standard: genau 1 oder 2 Spieler');
  ok(CONFIG.waffenAutomatikMaxSpieler === 2 && CONFIG.botAutomatikMaxSpieler === 2, 'Konfiguration: waffenAutomatikMaxSpieler / botAutomatikMaxSpieler = 2');
  ok(typeof space.waffenAutomatikAktiv === 'function', 'space.waffenAutomatikAktiv(game) vorhanden');

  // Spiel: Raider fest in der Linie vor dem Bug, Lanze geladen -> Automatikschuss nur bis 2 Spieler
  const lanceDmg = (players, prep) => {
    const f = arena(players);
    const { g, run } = f;
    if (prep) prep(f);
    const sh = g.ship;
    const e = space.spawnEnemy(g, 'raider', { x: sh.x + 400, y: sh.y, facing: Math.PI, waffen: {} });
    e.hp = e.hpMax = 999; e.shields = [0, 0, 0, 0];
    const pin = { x: e.x, y: e.y, a: e.angle };
    g.ship.mount.bow.charge = 1;
    run(2.5, () => { e.x = pin.x; e.y = pin.y; e.angle = pin.a; e.fireT = -999; e.shields = [0, 0, 0, 0]; g.space.projectiles = g.space.projectiles.filter((q) => q.kind === 'bolzen'); });
    return { dmg: 999 - e.hp, g, f };
  };
  for (const n of [1, 2]) { const r = lanceDmg(n); ok(r.dmg > 0, `${n} Spieler, Ops unbesetzt: Lanze schießt automatisch (${r.dmg.toFixed(1)} Schaden)`); }
  const r3 = lanceDmg(3);
  ok(r3.dmg === 0 && r3.g.ship.mount.bow.charge >= 1, '3 Spieler, Ops unbesetzt: kein Automatikschuss, Lanze bleibt geladen');
  const rb = r3.g.ship.mount;
  ok(['port', 'stbd'].every((k) => !rb[k].salvo), '3 Spieler: auch keine Batteriesalve');
  // Ops besetzt: wie bisher kein Automatikfeuer (2 Spieler)
  const rm = lanceDmg(2, (f) => f.enter(0, 'weapons'));
  ok(rm.dmg === 0, '2 Spieler, Ops besetzt: kein Automatikfeuer');
  // Ops-Ort, Interface per Tab auf Technik: Ops unbesetzt -> Automatik greift wieder (2 Spieler)
  const rt = lanceDmg(2, (f) => { f.enter(0, 'weapons'); f.tab(0, 1); f.tab(0, 1); });   // weapons → captain → technik
  ok(rt.f.P(0).console === 'weapons' && Station.stationOf(rt.f.P(0)) === 'technik' && rt.dmg > 0, `2 Spieler, Ops-Ort aber Interface Technik: Automatik schießt (${rt.dmg.toFixed(1)})`);
  // Ladepunkte: unbesetzt+Automatik = gleichmäßig reihum; ohne Automatik (3 Spieler) bleibt die zuletzt gesetzte Verteilung stehen
  {
    const f = arena(2); f.run(0.2);
    const al2 = Object.assign({}, f.g.ship.mount.bow && { bow: f.g.ship.mount.bow.alloc, port: f.g.ship.mount.port.alloc, stbd: f.g.ship.mount.stbd.alloc });
    ok(al2.bow + al2.port + al2.stbd === f.g.ship.power.weapons + 2, `2 Spieler unbesetzt: alle Ladepunkte automatisch verteilt (${JSON.stringify(al2)})`);
    const f3 = arena(3);
    f3.g.ship.wAllocIntent = { bow: 0, port: 3, stbd: 1 };
    f3.run(0.2);
    const m = f3.g.ship.mount;
    ok(m.bow.alloc === 0 && m.port.alloc === 3 && m.stbd.alloc === 1, `3 Spieler unbesetzt: zuletzt gesetzte Verteilung bleibt (${m.bow.alloc}/${m.port.alloc}/${m.stbd.alloc})`);
  }
});

section('ODA bei Wechsel der Waffenautomatik', () => {
  const f = arena(2); const { g, run, enter, leave, odas } = f;
  enter(0, 'weapons'); run(0.5);
  leave(0); run(0.5);
  ok(odas().some((t) => /Ops unbesetzt, Automatik an/.test(t)), 'Ops verlassen (2 Spieler): „Ops unbesetzt, Automatik an.“');
  const f3 = arena(3);
  f3.run(0.5);
  f3.enter(0, 'weapons'); f3.run(0.5);
  f3.leave(0); f3.run(0.5);
  ok(f3.odas().some((t) => /Ops unbesetzt, Automatik aus/.test(t)), 'Ops verlassen (3 Spieler): „Ops unbesetzt, Automatik aus …“');
  ok(g.errors === 0 && f3.g.errors === 0, 'keine Server-Fehler');
});

section('Bot-Automatik: an bei genau 1 oder 2 verbundenen Spielern', () => {
  for (const [players, want] of [[1, true], [2, true], [3, false]]) {
    const { g, run } = arena(players); run(0.3);
    ok(g.snapshot().ship.botAuto === want, `${players} Spieler: ship.botAuto ${want ? 'an' : 'aus'}`);
  }
  // die Wahl der Technik gilt danach weiter
  const { g, run, enter, cmd } = arena(3); run(0.2);
  enter(0, 'technik'); cmd(0, 'technik.botAuto', { on: true }); run(0.2);
  ok(g.ship.botAuto === true && g.ship.botAutoChosen, 'zu dritt: technik.botAuto an, bleibt an');
});

console.log(`\n${n - fails}/${n} Rollen-Tests bestanden.`);
process.exit(fails ? 1 : 0);
