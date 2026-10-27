'use strict';
// SYS-01 A2 Nacharbeit (Review, Befunde 1-9): jeder Test ist ohne den Fix rot (belegt im Wegwerf-Klon auf 464a379).
//   1  Schnellweg: eine Reparatur, die am beschädigten Reaktor beginnt, behält ihre Dauer nicht, wenn er zerstört wird (Spieler-Hold, Minispiel, Bot)
//   2  Tod in Phase end bzw. nach endGame: die Partie hängt nicht (beide Reihenfolgen)
//   3  EMP und Zerstörung: die Zerstörung hebt die EMP-Pause auf (Notsprung, Reparatur, 1. und 2. Ausfall)
//   4  Werkzeuggürtel gilt nicht für die Sonderreparatur
//   5  Lobby bei Verbindungsverlust, „wartet auf n Spieler“ im Snapshot (nur während tot)
//   6  Sitz VORN: Restzeit und Ausfallzähler in der Kantenleiste (Quelltext, Tokens, Kontrast)
//   7  Arena-Wellen: OK vor wellenLobby (Quelltext)
//   8  Snapshot ship.reaktorTod fehlt im Ruhezustand
//   9  Technik: Waffensysteme heißen nach dem Waffentyp (Katalog)
//   node tools/test-reaktortod-nach.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const W = require('../server/world.js');
const BOTS = require('../server/sim/bots.js');
const Reaktortod = require('../server/sim/reaktortod.js');
const PS = require('../public/js/pult-systeme-tokens.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-reaktortod-nach-'));
let seq = 0;
const SCHRITT = 1 / 30;

function setup(spieler, botAuto) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < (spieler || 1); i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i });
    conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1); g.space.enemies = [];
  if (!botAuto) BOTS.setBotAuto(g, false);
  return { g, run, conns };
}
const brechen = (g) => I.damageSystem(g, 'reactor', 'broken');
const beschaedigen = (g) => I.damageSystem(g, 'reactor', 'damaged');
const reparieren = (g) => I.repairSystem(g, 'reactor', 'player', 'flick');
const neustart = (g) => Space.reactorOnline(g, 'Test');
function ankern(g, p) { const st = W.STATIONS.find((s) => s.system === 'reactor'); const c = W.tileCenter(st.x, st.y); p.x = c.x; p.y = c.y; p.zone = 'ship'; p.console = null; p.hold = null; p.moving = false; p.input.mx = 0; p.input.my = 0; }
const zeitBisTod = (g, max) => { let k = 0; while (!g.ship.schiffZerstoert && k < Math.round(max * 30)) { g.step(); k++; } return k * SCHRITT; };
// Sekunden, bis der Reaktor nicht mehr zerstört ist (oder das Schiff tot ist); null = nie in max Sekunden
function zeitBisRettung(g, max) { let k = 0; while (k < Math.round(max * 30)) { if (g.ship.schiffZerstoert) return null; if (g.ship.systems.reactor !== 'broken') return k * SCHRITT; g.step(); k++; } return null; }

section('1 Schnellweg: Flicken beginnt am beschädigten Reaktor, dann Zerstörung (Spieler-Hold)');
{
  const { g, run } = setup(1);
  const p = g.players[0];
  beschaedigen(g); ankern(g, p);
  I.onAct(g, p, true);
  ok(p.hold && p.hold.kind === 'flick' && Math.abs(p.hold.dur - 1.5) < 1e-9, `Flicken am beschädigten Reaktor: Dauer ${p.hold && p.hold.dur} s`);
  run(1.0);
  brechen(g);
  ok(g.ship.systems.reactor === 'broken' && !!g.ship.reaktorCountdown, 'Reaktor zerstört, Countdown läuft');
  run(0.6);   // ohne Fix: nach 1,5 s Gesamtzeit repariert
  ok(g.ship.systems.reactor === 'broken' && !!g.ship.reaktorCountdown, 'nach 1,6 s Gesamtzeit noch zerstört (kein Schnellweg)');
  ok(!p.hold || p.hold.dur === 12, `das alte Halten ist abgebrochen oder auf 12 s umgestellt (hold ${p.hold ? p.hold.dur : 'null'})`);
  // frisches Halten: volle 12 s
  I.onAct(g, p, false); I.onAct(g, p, true);
  const rt = zeitBisRettung(g, 15);
  ok(rt !== null && rt >= 11.8 && rt <= 12.3, `neues Halten braucht die Sonderzeit (${rt === null ? 'nie' : rt.toFixed(2)} s, Soll 12 s)`);
}

section('1 Schnellweg: Minispiel beginnt am beschädigten Reaktor, dann Zerstörung');
{
  const { g, run } = setup(1);
  const p = g.players[0];
  beschaedigen(g); ankern(g, p);
  g.handleMessage(g.players[0].conn, { t: 'cmd', c: 'repair.start', system: 'reactor' });
  ok(p.hold && p.hold.kind === 'minigame', 'Minispiel am beschädigten Reaktor gestartet');
  run(3);
  brechen(g);
  g.handleMessage(g.players[0].conn, { t: 'cmd', c: 'repair.done', system: 'reactor', errors: 0 });
  ok(g.ship.systems.reactor === 'broken', 'Minispiel-Abschluss nach der Zerstörung repariert nichts (nur Sonderreparatur)');
}

section('1 Schnellweg: Schrauber-Bot beginnt am beschädigten Reaktor, dann Zerstörung');
{
  const { g, run } = setup(1, true);
  beschaedigen(g);
  let k = 0;
  const bot = () => g.bots[0];
  while (k < 60 * 30 && !(bot() && bot().task && bot().task.phase === 'work' && bot().task.system === 'reactor')) { g.step(); k++; }
  ok(bot() && bot().task && bot().task.phase === 'work' && bot().task.system === 'reactor', 'Schrauber arbeitet am beschädigten Reaktor');
  const dur1 = bot().task.dur;
  ok(dur1 < 12, `Arbeitszeit am beschädigten Reaktor ${dur1} s`);
  run(Math.min(0.5, dur1 / 2));
  brechen(g);
  const t0 = g.time;
  let gerettet = null; k = 0;
  while (k < 25 * 30 && !g.ship.schiffZerstoert) { g.step(); k++; if (g.ship.systems.reactor !== 'broken') { gerettet = g.time - t0; break; } }
  ok(gerettet !== null && gerettet >= 11.9, `der Bot braucht nach der Zerstörung die volle Sonderzeit (${gerettet === null ? 'tot' : gerettet.toFixed(2)} s, Soll >= 12 s)`);
}

section('2 Tod, dann endGame, dann menu end: die Partie endet');
{
  const { g } = setup(1);
  g.ship.docked = false; g.ship.dockedAt = null;
  brechen(g); zeitBisTod(g, 25);
  ok(g.ship.schiffZerstoert && !!g.zerstoertOffen, 'Tod, Einblendung gelatcht');
  g.endGame();
  ok(g.phase === 'end', 'endGame: Phase end');
  g.handleMessage(g.players[0].conn, { t: 'menu', op: 'end' });
  ok(g.phase === 'lobby' && !g.zerstoertOffen, `menu end nach Tod und endGame führt in die Lobby (phase ${g.phase})`);
}
section('2 endGame, dann Tod, dann menu end');
{
  const { g, run } = setup(1);
  g.ship.docked = false; g.ship.dockedAt = null;
  g.endGame();
  brechen(g);
  ok(!g.ship.reaktorCountdown, 'Phase end: kein Countdown');
  run(25);
  ok(!g.ship.schiffZerstoert && !g.zerstoertOffen, 'Phase end: kein Tod, keine Sperre');
  g.handleMessage(g.players[0].conn, { t: 'menu', op: 'end' });
  ok(g.phase === 'lobby', `menu end in der Phase end führt in die Lobby (phase ${g.phase})`);
}
section('2 Countdown läuft, dann endGame');
{
  const { g, run } = setup(1);
  g.ship.docked = false; g.ship.dockedAt = null;
  brechen(g); run(2);
  g.endGame(); run(25);
  ok(!g.ship.schiffZerstoert && !g.zerstoertOffen, 'laufender Countdown: nach endGame kein Tod mehr');
  g.handleMessage(g.players[0].conn, { t: 'menu', op: 'end' });
  ok(g.phase === 'lobby', 'menu end führt in die Lobby');
}

section('3 EMP-Reaktor wird zerstört: Pause aufgehoben, Notsprung, Reparatur, 1. und 2. Ausfall');
{
  const { g, run } = setup(1);
  const p = g.players[0];
  g.ship.docked = false; g.ship.dockedAt = null;
  I.setOffline(g, 'reactor', 30);
  ok(g.ship.systems.reactor === 'offline', 'Reaktor per EMP offline');
  brechen(g);
  ok(g.ship.systems.reactor === 'broken' && !g.ship.offline.reactor, `Zerstörung hebt die EMP-Pause auf (Zustand ${g.ship.systems.reactor}, offline-Eintrag ${!!g.ship.offline.reactor})`);
  ok(g.ship.reaktorAusfaelle === 1 && g.ship.reaktorCountdown && Math.abs(g.ship.reaktorCountdown.t - 20) < 1e-9, '1. Ausfall: Countdown 20 s');
  ok(Sprung.notsprungGrund(g) === null, `Notsprung möglich (Grund: ${Sprung.notsprungGrund(g)})`);
  ankern(g, p); I.onAct(g, p, true);
  ok(p.hold && p.hold.kind === 'flick' && Math.abs(p.hold.dur - 12) < 1e-9, 'Reparatur geht: Sonderreparatur 12 s');
  const rt = zeitBisRettung(g, 20);
  ok(rt !== null && rt >= 11.8 && rt <= 12.3 && g.ship.systems.reactor === 'damaged', `1. Ausfall nach EMP gerettet in ${rt === null ? 'nie' : rt.toFixed(2)} s`);
  I.onAct(g, p, false); neustart(g);
  // 2. Ausfall: wieder unter EMP
  I.setOffline(g, 'reactor', 30);
  brechen(g);
  ok(g.ship.reaktorAusfaelle === 2 && g.ship.reaktorCountdown && Math.abs(g.ship.reaktorCountdown.t - 10) < 1e-9, '2. Ausfall nach EMP: Countdown 10 s');
  g.ship.docked = false; g.ship.dockedAt = null;
  ok(Sprung.notsprungGrund(g) === null, '2. Ausfall: Notsprung möglich (Grund: ' + Sprung.notsprungGrund(g) + ')');
  const tod = zeitBisTod(g, 15);
  ok(g.ship.schiffZerstoert && Math.abs(tod - 10) <= 0.2, `2. Ausfall: ohne Rettung Tod nach ${tod.toFixed(2)} s (der Countdown pausiert nicht unter EMP)`);
}
{
  const { g } = setup(1);
  g.ship.docked = false; g.ship.dockedAt = null;
  I.setOffline(g, 'reactor', 30); brechen(g);
  const err = Sprung.notsprung(g);
  ok(!err && !g.ship.reaktorCountdown && g.ship.reaktorAusfaelle === 0, `Notsprung beim zerstörten EMP-Reaktor rettet (Rückgabe ${err})`);
}
{
  // EMP ohne Zerstörung bleibt gesperrt (unverändert)
  const { g } = setup(1);
  g.ship.docked = false; g.ship.dockedAt = null;
  I.setOffline(g, 'reactor', 30);
  ok(/offline/i.test(Sprung.notsprungGrund(g) || ''), 'EMP-offline ohne Zerstörung: Notsprung weiter gesperrt');
}

section('4 Werkzeuggürtel gilt nicht für die Sonderreparatur');
{
  const { g, run } = setup(1);
  const p = g.players[0];
  p.gear.werkzeuggurt = true;
  beschaedigen(g); ankern(g, p); I.onAct(g, p, true);
  ok(Math.abs(p.hold.dur - 1.5 * g.C.repair.werkzeuggurtFactor) < 1e-9, `Flicken mit Gürtel bleibt verkürzt (${p.hold.dur} s)`);
  I.onAct(g, p, false); p.hold = null;
  I.setzeZustand(g, 'reactor', 'ok');
  brechen(g); ankern(g, p); I.onAct(g, p, true);
  ok(p.hold && Math.abs(p.hold.dur - 12) < 1e-9, `Sonderreparatur mit Gürtel: ${p.hold && p.hold.dur} s (Soll 12 s)`);
  ok(g.C.reaktorTod.sonderreparatur.zeiten[0] === 12 && /fest/.test(src('shared/config.js').split('reaktorTod:')[0].slice(-400)), 'Config-Kommentar nennt feste Zeiten');
}
section('4 Gürtel, 2. Ausfall: ein Spieler allein rettet nicht (10 s)');
{
  const { g } = setup(1);
  const p = g.players[0];
  p.gear.werkzeuggurt = true;
  brechen(g); reparieren(g); neustart(g); brechen(g);
  ankern(g, p); I.onAct(g, p, true);
  const z = zeitBisTod(g, 15);
  ok(g.ship.schiffZerstoert && Math.abs(z - 10) <= 0.2, `Tod nach ${z.toFixed(2)} s trotz Gürtel`);
}

section('5 Lobby bei Verbindungsverlust; Snapshot wartet');
{
  const { g, conns } = setup(2);
  g.ship.docked = false; g.ship.dockedAt = null;
  brechen(g); zeitBisTod(g, 25);
  const snap = () => g.snapshot().ship.reaktorTod;
  ok(snap().tot === 1 && snap().wartet === 2, `Snapshot nach dem Tod: wartet ${snap().wartet} (Soll 2)`);
  g.handleMessage(conns[0], { t: 'menu', op: 'zerstoertOk' });
  ok(g.phase !== 'lobby' && snap().wartet === 1, `nach dem OK von A: wartet ${snap().wartet} (Soll 1)`);
  g.removeConnection(conns[1]);
  ok(g.phase === 'lobby' && !g.zerstoertOffen, `B trennt: Lobby (phase ${g.phase})`);
}
{
  // umgekehrt: B trennt zuerst, dann OK von A
  const { g, conns } = setup(2);
  g.ship.docked = false; g.ship.dockedAt = null;
  brechen(g); zeitBisTod(g, 25);
  g.removeConnection(conns[1]);
  ok(g.phase !== 'lobby' && g.snapshot().ship.reaktorTod.wartet === 1, 'B trennt vor dem OK: A wird erwartet');
  g.handleMessage(conns[0], { t: 'menu', op: 'zerstoertOk' });
  ok(g.phase === 'lobby', 'A drückt OK: Lobby');
}
{
  // wartet nur während tot
  const { g } = setup(1);
  g.ship.docked = false; g.ship.dockedAt = null;
  brechen(g);
  ok(g.snapshot().ship.reaktorTod.wartet === undefined, 'Countdown läuft: kein Feld wartet im Snapshot');
}

section('6 Sitz VORN: Restzeit und Ausfallzähler in der Kantenleiste');
{
  const sitz = src('public/js/sitz.js'), hud = src('public/js/hud.js');
  ok(/PultSysteme\.banderole\(ship\.reaktorTod/.test(sitz) && /kanteWert/.test(sitz) && /TOKENS\.FARBE\.zerText/.test(sitz), 'sitz.js: zeichneKante zeigt Countdown aus den Tokens (PultSysteme.banderole, kanteWert, zerText)');
  ok(PS.TOKENS.TEXT.kanteLabel === 'COUNTDOWN' && /\{s\}/.test(PS.TOKENS.TEXT.kanteWert) && /\{n\}/.test(PS.TOKENS.TEXT.kanteWert), 'Tokens: kanteLabel, kanteWert mit Sekunden und Ausfallzähler');
  const F = PS.farben('rom'), G = PS.farben('germanen');
  ok(PS.kontrast(F.zerText, '#0B0E1A') >= 4.5 && PS.kontrast(G.zerText, '#0B0E1A') >= 4.5, `zerText auf der Kantenleiste >= 4,5:1 (${PS.kontrast(F.zerText, '#0B0E1A').toFixed(1)})`);
  ok(/schiffWartet/.test(hud) && /zerstoertOkGesendet/.test(hud) && /wartet auf \{n\} Spieler/.test(PS.TOKENS.TEXT.schiffWartet), 'hud.js: Einblendung „wartet auf n Spieler“');
}

section('7 Arena-Wellen: Enter nach dem Tod geht in den OK-Zweig');
{
  const cl = src('public/js/client.js');
  const iOk = cl.indexOf("if (zerstoertOffen(st) && (code === 'Enter' || code === 'KeyE'))"), iW = cl.indexOf("st.wellen.ph === 'ende' && code === 'Enter'");
  ok(iOk > 0 && iW > 0 && iOk < iW, `client.js: zerstoertOffen-Zweig (${iOk}) vor wellenLobby (${iW})`);
}

section('8 Snapshot: ship.reaktorTod fehlt im Ruhezustand');
{
  const { g } = setup(1);
  g.ship.docked = false; g.ship.dockedAt = null;
  ok(g.snapshot().ship.reaktorTod === undefined, 'Ruhezustand: kein Feld reaktorTod');
  brechen(g);
  ok(g.snapshot().ship.reaktorTod && g.snapshot().ship.reaktorTod.rest === 200, 'Countdown: Feld da');
  reparieren(g); g.step();
  ok(g.snapshot().ship.reaktorTod && g.snapshot().ship.reaktorTod.n === 1 && g.snapshot().ship.reaktorTod.rest === -1, 'nach Rettung (Zähler 1): Feld da, rest -1');
  neustart(g); brechen(g); g.ship.docked = false; g.ship.dockedAt = null;
  const ns = Sprung.notsprung(g); g.step();
  ok(g.snapshot().ship.reaktorTod === undefined, 'nach dem Sprung (Zähler 0): Feld fehlt wieder (' + ns + ')');
}

section('9 Technik: Waffensysteme heißen nach dem Waffentyp (Katalog)');
{
  const co = src('public/js/consoles.js');
  ok(/waffeAmPlatz/.test(co) && /SU\.waffeVon\(m\)/.test(co) && /w\.kurz/.test(co), 'consoles.js: Name aus dem Katalog (SchiffsUI.waffeVon, kurz), keine zweite Tabelle');
}

console.log(`\ntest-reaktortod-nach: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
