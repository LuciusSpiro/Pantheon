'use strict';
// SUND-02a C: Notfallsprung in der Freien Fahrt (weltsim gesetzt): Reaktor kurz offline, Neustart von selbst nach notsprung.autoNeustartFrei s,
// Hülle −15 bleibt, zweiter Notfallsprung bis dahin gesperrt, danach wieder möglich. Kampagne (kein weltsim): unverändert, Reaktor bleibt offline.
//   node tools/test-notsprung-frei.js   (npm run test:notsprung-frei)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Sprung = require('../server/sim/sprung.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-notsprung-frei-'));
let seq = 0;

function setup(start) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Crew', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: start }); g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1); g.space.enemies = [];
  return { g, run, c };
}
// SYS-01 A1b: Kosten des Notfallsprungs = genau ein System (nicht der Reaktor) ist von ok auf beschädigt gegangen
function kostenSystem(g) {
  const I = require('../server/sim/interior.js');
  const nicht = I.SYSTEM_ORDER.filter((k) => g.ship.systems[k] !== 'ok' && k !== 'reactor');
  return nicht.length === 1 && g.ship.systems[nicht[0]] === 'damaged';
}
function frei(g) { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = 1000; s.y = 1000; s.vx = 0; s.vy = 0; s.speed = 0; g.space.enemies = []; g.ship.reactorCtl.state = 'online';  }

section('Freie Fahrt: Notfallsprung, Reaktor startet von selbst');
{
  const { g, run, c } = setup('freie_fahrt');
  const N = g.C.sektoren.notsprung;
  ok(!!g.weltsim && N.autoNeustartFrei > 0 && N.autoNeustartFrei <= 12, 'weltsim gesetzt, autoNeustartFrei ' + N.autoNeustartFrei + ' s (Konfig)');
  frei(g); c.inbox.length = 0;
  ok(Sprung.notsprung(g) === null, 'Notfallsprung ausgeführt');
  ok(kostenSystem(g), 'Notsprung: genau ein zufälliges ok-System ist beschädigt, der Reaktor zählt nicht (SYS-01 A1b)');
  ok(g.ship.reactorCtl.state === 'offline', 'Reaktor direkt nach dem Sprung offline');
  ok(/Reaktor offline/.test(Sprung.notsprung(g) || ''), 'zweiter Notfallsprung bis zum Neustart gesperrt');
  const funk = c.inbox.filter((m) => /Notfallsprung/.test(JSON.stringify(m))).map((m) => JSON.stringify(m)).join(' ');
  ok(/kurz offline, Neustart läuft/.test(funk), 'Funkspruch: „Reaktor kurz offline, Neustart läuft“');
  run(N.autoNeustartFrei - 1);
  ok(g.ship.reactorCtl.state === 'offline', 'nach ' + (N.autoNeustartFrei - 1) + ' s noch offline');
  run(3);
  ok(g.ship.reactorCtl.state === 'online', 'nach ' + (N.autoNeustartFrei + 2) + ' s Spielzeit online, ohne Schalter und Debug');
  ok(!g.ship.reactorCtl.autoRestartAt && g.ship.reactorCtl.autoRestartText === undefined, 'Hilfsfelder aufgeräumt');
  frei(g); 
  ok(Sprung.notsprung(g) === null, 'Crew kann weiterspielen: erneuter Notfallsprung möglich');
}

section('Freie Fahrt: manueller Neustart vor Ablauf räumt auf');
{
  const { g, run } = setup('freie_fahrt');
  frei(g); Sprung.notsprung(g);
  require('../server/sim/space.js').reactorOnline(g, 'Test');
  run(0.2);
  ok(g.ship.reactorCtl.state === 'online' && g.ship.reactorCtl.autoRestartAt == null && g.ship.reactorCtl.autoRestartText === undefined, 'Hilfsfelder nach Handneustart weg');
}

section('Freie Fahrt: Reaktorsystem wird im Neustartfenster repariert (Review H5)');
{
  // Der Reaktor geht erst nach dem Notfallsprung kaputt (davor sperrt der Sprung) und wird innerhalb des Fensters repariert: reactorNeedsRestart kehrt bei
  // schon abgeschaltetem Reaktor zurück, die Autostart-Zeit bleibt also stehen, der Neustart kommt pünktlich, nichts hängt.
  const { g, run } = setup('freie_fahrt');
  const I = require('../server/sim/interior.js');
  const N = g.C.sektoren.notsprung; const rc = g.ship.reactorCtl;
  frei(g); Sprung.notsprung(g);
  const bis = rc.autoRestartAt;
  g.ship.systems.reactor = 'broken';
  run(1);
  ok(I.repairSystem(g, 'reactor', 'bot', 'swap') === true && g.ship.systems.reactor === 'ok', 'Reaktorsystem im Fenster repariert');
  ok(rc.autoRestartAt === bis && rc.autoRestartText === 'Reaktor läuft wieder – Neustart durch.', 'Autostart-Zeit und Text unverändert (nicht überschrieben)');
  run(N.autoNeustartFrei + 1);
  ok(rc.state === 'online' && rc.autoRestartAt == null && rc.autoRestartText === undefined, 'Autoneustart kam pünktlich, Hilfsfelder aufgeräumt');
  // Text ohne Zeit (Altlast): wird weggeräumt
  rc.autoRestartText = 'Rest'; run(0.2);
  ok(rc.autoRestartText === undefined, 'ein Text ohne Autostart-Zeit wird aufgeräumt');
}

section('Kampagne: Reaktor bleibt offline (Handneustart)');
{
  const { g, run, c } = setup('free');
  ok(!g.weltsim, 'kein weltsim');
  frei(g); c.inbox.length = 0;
  ok(Sprung.notsprung(g) === null, 'Notfallsprung ausgeführt');
  ok(kostenSystem(g), 'Notsprung: genau ein zufälliges ok-System ist beschädigt (SYS-01 A1b)');
  ok(g.ship.reactorCtl.autoRestartAt == null && g.ship.reactorCtl.autoRestartText === undefined, 'kein Autoneustart gesetzt');
  ok(/Reaktor überladen und offline/.test(c.inbox.map((m) => JSON.stringify(m)).join(' ')), 'Funkspruch unverändert');
  run(30);
  ok(g.ship.reactorCtl.state === 'offline', 'nach 30 s weiterhin offline');
  ok(/Reaktor offline/.test(Sprung.notsprung(g) || ''), 'zweiter Notfallsprung gesperrt');
}

console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests grün');
process.exit(fails ? 1 : 0);
