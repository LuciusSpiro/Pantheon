'use strict';
// UEB-01 A1: Übungsplatz arena_forschung (server/sim/uebung-forschung.js): Start im Schritt gravimetrie am Helix, wiederholbarer
// Ausgangszustand, Neustart nach Verlust, Szenenende bei abliefern_anflug. Die Partie läuft ohne den Lobby-Modus (der kommt mit A2),
// das Modul wird über arena.start an einer Sund-Partie getestet.
//   node tools/test-uebung-forschung.js
const CONFIG = require('../shared/config.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const Welt = require('../server/sim/welt.js');
const arena = require('../server/sim/arena.js');
const Uebung = require('../server/sim/uebung-forschung.js');
const Anker = require('../server/sim/anker.js');
const ZonenSim = require('../server/sim/zonen.js');
const Lpscan = require('../server/sim/lpscan.js');
const away = require('../server/sim/away.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

function spiel(np) {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'F' + i, name: 'Fo' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund');
  g.spielleiter = null;   // der Testlauf startet im Modus free (Platzhalter bis A2); die Übung hat keinen Spielleiter
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  const odas = []; const o0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(String(t)); return o0(t, x); };
  arena.start(g, 'arena_forschung', null, {});
  return { g, run, odas };
}
const zustand = (g) => {
  const m = g.mission; const sh = g.ship;
  return JSON.stringify({
    schritt: m.step && m.step.id, aktiv: m.activeId, scene: sh.scene, x: Math.round(sh.x), y: Math.round(sh.y), v: [sh.vx, sh.vy],
    gravi: ZonenSim.istBekannt(g, 'gravi_feld0'), lp: Lpscan.gescannt(g, 'helix.station'),
    spieler: g.players.map((p) => [p.zone, !!p.downed, p.hp]), monster: !!(g.away && g.away.monster), pulte: !!(g.away && g.away.monsterPulte),
  });
};

section('Start', () => {
  const { g } = spiel(2); const m = g.mission;
  ok(arena.isArena('arena_forschung') && g.arena && g.arena.kind === 'arena_forschung', 'arena_forschung ist ein Testgelände, game.arena gesetzt');
  ok(m.activeId === 'sl_forschung' && m.step && m.step.id === 'gravimetrie', 'Buch sl_forschung läuft im Schritt gravimetrie');
  ok(g.ship.scene === 'helix', 'Schiff am Helix (Szene ' + g.ship.scene + ')');
  ok(g.players.length === 2 && g.players.every((p) => p.zone === 'ship'), '2 Spieler an Bord');
  ok(!m.kette, 'keine Kette');
  ok(g.ship.reactorCtl.state !== 'offline', 'Reaktor läuft, Schiff unbeschädigt');
  ok(g.errors === 0, 'g.errors 0 nach dem Start (' + g.errors + ')');
});

section('Ausgangszustand wiederholbar', () => {
  const T = spiel(2); const g = T.g;
  T.run(2);
  const z1 = zustand(g);
  // Zustand verderben: Schiff weg, Zonen/Landepunkt bekannt, Spieler am Boden
  g.ship.x += 900; g.ship.vx = 50; ZonenSim.bekanntMachen(g, 'alle'); Lpscan.markieren(g, 'helix.station');
  g.players[0].downed = true; g.players[0].hp = 0;
  Uebung.forschungAusgangszustand(g); const a = zustand(g);
  Uebung.forschungAusgangszustand(g); const b = zustand(g);
  ok(a === b, 'zweimal aufgerufen: gleicher Zustand');
  ok(a === z1, 'Zustand entspricht dem Zustand nach dem Start' + (a === z1 ? '' : '\n    ' + a + '\n    ' + z1));
  ok(g.errors === 0, 'g.errors 0 (' + g.errors + ')');
});

section('Verlust: Szene von vorn', () => {
  const T = spiel(2); const g = T.g; const m = g.mission; g.god = false;
  const gv = Locations.get('helix').scene.gravimetrie;
  T.run(1);
  g.ship.x = gv.station.x - 100; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0;
  m.forceStep('sl_forschung', 'station'); T.run(1);
  Lpscan.markieren(g, 'helix.station');
  ok(!g.chooseLandepunkt(g.players[0], 'helix.station'), 'Landepunkt gewählt');
  away.executeBeam(g, g.players.map((q) => q.id), 'down'); T.run(1);
  ok(g.away.monster && g.away.monsterPulte && g.players.every((p) => p.zone === 'away'), 'Team auf der Station, Monster und Pulte da');
  Anker.setzen(g, g.away.map, Object.keys(g.away.monsterPulte.pos)[0], 'laedt', g.players[0].id);
  g.away.monsterPulte.erledigt = 2;
  // alle zu Boden -> Mission verloren
  for (const p of g.players) { p.hp = 0; p.downed = true; p.downedFor = 0; }
  let verloren = false;
  T.run(5, () => { const ms = m.missions.sl_forschung; if (ms && ms.state === 'done') { verloren = ms.ausgang === 'verloren'; return true; } return false; });
  ok(verloren, 'Mission done mit Ausgang verloren');
  T.run(2);
  ok(m.missions.sl_forschung.state === 'done' && g.players.some((p) => p.zone === 'away'), 'kein Neustart, solange Spieler am Boden liegen');
  const neu = T.run(25, () => g.arena.forschung.versuch === 2);
  ok(neu, 'Neustart nach dem Hochholen (Versuch ' + g.arena.forschung.versuch + ')');
  T.run(0.2);
  ok(m.activeId === 'sl_forschung' && m.step.id === 'gravimetrie' && g.ship.scene === 'helix', 'Schritt gravimetrie am Helix');
  ok(g.players.every((p) => p.zone === 'ship' && !p.downed && p.hp > 0), 'Team an Bord und aufrecht');
  ok(Math.abs(g.ship.x - gv.start.x) < 40 && Math.abs(g.ship.y - gv.start.y) < 40, 'Schiff am Start der Gravimetrie');
  const M = g.away.monster; const P = g.away.monsterPulte;
  ok(!M || (M.z !== 'jagd' && M.z !== 'suche'), 'Monster zurückgesetzt (' + (M ? M.z : 'neu') + ')');
  ok(!P || P.erledigt === 0, 'Pulte zurückgesetzt (' + (P ? P.erledigt : 'neu') + '/4)');
  ok(!Lpscan.gescannt(g, 'helix.station') && !ZonenSim.istBekannt(g, 'gravi_feld0'), 'Landepunkt und Zonen wieder unbekannt');
  ok(m.missions.sl_forschung.state !== 'done', 'Missionseintrag wieder aktiv');
  T.run(30);
  ok(m.step.id === 'gravimetrie' && g.arena.forschung.versuch === 2, 'nach 30 s weiter im Schritt gravimetrie, kein zweiter Neustart');
  ok(g.errors === 0, 'g.errors 0 (' + g.errors + ' ' + JSON.stringify(g.errorLog || {}) + ')');
});

section('Szenenende', () => {
  const T = spiel(2); const g = T.g; const m = g.mission; g.god = true;
  const marks = g.inventory.marks;
  m.forceStep('sl_forschung', 'abliefern_anflug');
  T.run(3);
  const ms = m.missions.sl_forschung;
  ok(ms && ms.state === 'done' && ms.ausgang === 'erfolg', 'Mission done/erfolg bei abliefern_anflug (' + JSON.stringify(ms) + ')');
  ok(T.odas.filter((t) => /Szene durch/.test(t)).length === 1, 'Meldung "Szene durch" genau einmal');
  T.run(5);
  ok(T.odas.filter((t) => /Szene durch/.test(t)).length === 1, '... auch nach weiteren Ticks');
  ok(g.inventory.marks === marks && !m.flags.forschungFertig, 'keine Marken, kein Flag');
  ok(g.ship.scene === 'helix' && g.arena.forschung.versuch === 1, 'kein Rueckflug, kein Neustart');
  ok(g.errors === 0, 'g.errors 0 (' + g.errors + ')');
});

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log(fails + ' Fehler'); process.exit(1); }
