'use strict';
// SYS-01 A2a „Tod der Lerche“ (Kai, 2026-10-26): Reaktor zerstört = Countdown 20 s, jede weitere Zerstörung halbiert (bis 1,25 s Minimum),
// Rettung durch Reparatur am Reaktor, Sonderreparatur 12/7/5 s mit 1/2/3 Arbeitern, Notsprung rettet (sofort, Außenteam per Notrückholung),
// Zähler setzt beim Sprung zurück, Übung und Gottmodus lösen nichts aus, die Solo-Menüpause hält den Countdown an, der Weltstand speichert ihn nicht.
// Verbraucher des Notfallprotokolls: Die Naht (space.verlustAusloesen) erhöht stats.emergencies und meldet das Ereignis emergency; alle Verbraucher lesen daran.
//   node tools/test-reaktortod.js   (npm run test:reaktortod)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Sprung = require('../server/sim/sprung.js');
const I = require('../server/sim/interior.js');
const Space = require('../server/sim/space.js');
const Damage = require('../server/sim/damage.js');
const Reaktortod = require('../server/sim/reaktortod.js');
const W = require('../server/world.js');
const Protokoll = require('../shared/protocol.js');
const BOTS = require('../server/sim/bots.js');
const Flotte = require('../server/sim/flotte.js');

let fails = 0;
let n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-reaktortod-'));
let seq = 0;
const SCHRITT = 1 / 30;

// spieler Anzahl Spieler (Verbindungen), start: Startmission (freie_fahrt = Kampagne mit Freier Fahrt, keine Übung)
function setup(start, spieler) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < (spieler || 1); i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i });
    conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: start });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1); g.space.enemies = [];
  BOTS.setBotAuto(g, false);   // der Schrauber-Bot repariert sonst selbst (Technik-Bot ist Thema von test-reaktortod-bot.js)
  return { g, run, c: conns[0], conns };
}
const brechen = (g) => I.damageSystem(g, 'reactor', 'broken');
const reparieren = (g) => I.repairSystem(g, 'reactor', 'player', 'flick');   // zerstört -> beschädigt (Flicken, Sonderreparatur)
// Sekunden, bis das Schiff zerstört ist (max. max Sekunden)
function zeitBisTod(g, max) { let k = 0; while (!g.ship.schiffZerstoert && k < Math.round(max * 30)) { g.step(); k++; } return k * SCHRITT; }
// Wiederherstellen eines Reaktors, der nach einem Ausfall beschädigt ist (Neustart über die Steuerung)
function neustart(g) { Space.reactorOnline(g, 'Test'); }
function ankern(g, p) { const st = W.STATIONS.find((s) => s.system === 'reactor'); const c = W.tileCenter(st.x, st.y); p.x = c.x; p.y = c.y; p.zone = 'ship'; p.console = null; p.hold = null; p.moving = false; p.input.mx = 0; p.input.my = 0; }
// n-ten Ausfall vorbereiten: n−1 Zerstörungen mit Rettung dazwischen, dann die n-te (Countdown läuft)
function ausfall(g, nr) { for (let i = 1; i < nr; i++) { brechen(g); reparieren(g); neustart(g); } brechen(g); }

section('Countdown-Dauer: 20 s, halbiert je Ausfall, Untergrenze 1,25 s');
{
  const { g } = setup('freie_fahrt', 1);
  const soll = [20, 10, 5, 2.5, 1.25, 1.25];
  for (let i = 1; i <= 6; i++) ok(Math.abs(Reaktortod.dauer(g, i) - soll[i - 1]) < 1e-9, `dauer(${i}) = ${soll[i - 1]} s`);
}
const TODE = [];
for (const nr of [1, 2, 3, 4]) {
  const { g, run } = setup('freie_fahrt', 1);
  ausfall(g, nr);
  const erwartet = Reaktortod.dauer(g, nr);
  ok(g.ship.reaktorAusfaelle === nr, `Ausfall ${nr}: Zähler ${g.ship.reaktorAusfaelle}`);
  ok(g.ship.reaktorCountdown && Math.abs(g.ship.reaktorCountdown.t - erwartet) < 1e-9, `Ausfall ${nr}: Countdown ${erwartet} s`);
  const snap = Reaktortod.snapshot(g);
  ok(snap.rest === Math.round(erwartet * 10) && snap.n === nr && snap.tot === undefined, `Ausfall ${nr}: Snapshot rest ${snap.rest} (Zehntel), n ${snap.n}`);
  const t = zeitBisTod(g, erwartet + 2);
  TODE.push(t);
  ok(Math.abs(t - erwartet) <= 0.1, `Ausfall ${nr}: Schiff zerstört nach ${t.toFixed(2)} s (Soll ${erwartet} s)`);
  ok(g.ship.schiffZerstoert === true && g.ship.reaktorCountdown === null, `Ausfall ${nr}: Zerstört-Flag gesetzt, Countdown beendet`);
  ok(g.stats.emergencies >= 1, `Ausfall ${nr}: Naht verlustAusloesen (stats.emergencies ${g.stats.emergencies})`);
  ok(Reaktortod.snapshot(g).tot === 1 && Reaktortod.snapshot(g).rest === -1, `Ausfall ${nr}: Snapshot tot 1, rest -1 nach dem Tod`);
}
ok(TODE.length === 4, 'vier Ausfälle bis zum Tod gemessen: ' + TODE.map((x) => x.toFixed(2)).join(' / ') + ' s');

section('Verbraucher: der Tod läuft über die Naht und das Ereignis emergency');
{
  const { g } = setup('freie_fahrt', 1);
  const gemeldet = [];
  const altEreignis = g.missionEvent.bind(g);
  g.missionEvent = (name, data) => { if (name === 'emergency') gemeldet.push(data); return altEreignis(name, data); };
  const em0 = g.stats.emergencies;
  brechen(g);
  const t = zeitBisTod(g, 25);
  ok(g.stats.emergencies === em0 + 1, `Countdown abgelaufen (${t.toFixed(1)} s): stats.emergencies +1`);
  ok(gemeldet.length === 1 && gemeldet[0] && gemeldet[0].grund === 'reaktor', 'missionEvent emergency mit grund „reaktor“ (Hook on.emergency der Regiebücher)');
  ok(g.players.length === 1, 'eine Verbindung bleibt verbunden');
}

section('Rettung: Reparatur vor Ablauf beendet den Countdown, der Zähler bleibt');
{
  const { g, run } = setup('freie_fahrt', 1);
  brechen(g); run(5);
  ok(g.ship.reaktorCountdown && g.ship.reaktorCountdown.t > 14, 'nach 5 s läuft der Countdown noch (' + g.ship.reaktorCountdown.t.toFixed(1) + ' s)');
  reparieren(g);
  run(0.1);
  ok(g.ship.reaktorCountdown === null, 'Reaktor beschädigt -> Countdown beendet');
  run(30);
  ok(!g.ship.schiffZerstoert && g.ship.reaktorAusfaelle === 1, 'nach 30 s kein Tod, Zähler steht auf 1');
  ok(Reaktortod.snapshot(g).rest === -1 && Reaktortod.snapshot(g).n === 1, 'Snapshot rest -1, n 1');
}

section('Zähler setzt beim Sprung zurück (Notsprung)');
{
  const { g, run } = setup('freie_fahrt', 1);
  ausfall(g, 2);
  ok(g.ship.reaktorAusfaelle === 2, 'zwei Ausfälle: Zähler 2');
  g.ship.reaktorCountdown = null;   // der Countdown stört hier nicht
  reparieren(g); neustart(g);
  ok(g.ship.systems.reactor === 'damaged', 'Reaktor beschädigt vor dem Sprung');
  g.ship.docked = false; g.ship.dockedAt = null; g.ship.x = 1000; g.ship.y = 1000; g.space.enemies = [];
  ok(Sprung.notsprung(g) === null, 'Notsprung mit beschädigtem Reaktor (ohne Ausfall) möglich');
  ok(g.ship.reaktorAusfaelle === 0, 'Notsprung setzt den Zähler auf 0');
  brechen(g);
  ok(Math.abs(g.ship.reaktorCountdown.t - 20) < 1e-9, 'nächster Ausfall wieder 20 s');
}

section('Zähler setzt beim normalen Sprung zurück');
{
  const { g } = setup('freie_fahrt', 1);
  ausfall(g, 2);
  reparieren(g); neustart(g);
  g.ship.docked = false; g.ship.dockedAt = null;
  const ziel = Sprung.nachbarOrte(g, g.ship.scene)[0];
  ok(!!ziel, 'ein Nachbarort für den Sprung gefunden (' + ziel + ')');
  if (ziel) {
    g.ship.jump.dest = ziel; g.ship.jump.ready = true; g.ship.jump.charge = 1;
    const err = Sprung.doJump(g);
    ok(!err, 'normaler Sprung ausgeführt' + (err ? ': ' + err : ''));
    ok(g.ship.reaktorAusfaelle === 0 && g.ship.reaktorCountdown === null, 'normaler Sprung: Zähler 0, kein Countdown');
  }
}

section('Notsprung bei zerstörtem Reaktor: sofort, beendet den Countdown, Reaktor beschädigt, Steuerung offline');
{
  const { g, run } = setup('freie_fahrt', 1);
  brechen(g); run(2);
  ok(g.ship.reaktorCountdown && g.ship.reaktorCountdown.t < 19, 'Countdown läuft vor dem Notsprung');
  g.ship.docked = false; g.ship.dockedAt = null; g.ship.x = 1000; g.ship.y = 1000; g.ship.vx = 0; g.ship.vy = 0; g.space.enemies = [];
  g.ship.jump.ready = false; g.ship.jump.charge = 0;   // ohne Aufladung
  ok(Sprung.notsprungGrund(g) === null, 'notsprungGrund blockt nicht bei zerstörtem Reaktor');
  ok(Sprung.notsprung(g) === null, 'Notsprung sofort ausgeführt (Sprungantrieb ungeladen)');
  ok(g.ship.reaktorCountdown === null && g.ship.reaktorAusfaelle === 0, 'Countdown beendet, Zähler 0');
  ok(g.ship.systems.reactor === 'damaged', 'Reaktor danach beschädigt (Integrität Grundwert)');
  ok(g.ship.reactorCtl.state === 'offline', 'Steuerung offline (Neustart über die Schalter)');
  const kosten = I.SYSTEM_ORDER.filter((k) => k !== 'reactor' && g.ship.systems[k] !== 'ok');
  ok(kosten.length === 1 && g.ship.systems[kosten[0]] === 'damaged', 'genau ein ok-System ist beschädigt (Kosten)');
  const t0 = g.stats.emergencies;
  run(25);
  ok(!g.ship.schiffZerstoert && g.stats.emergencies === t0, 'nach 25 s kein Tod (Countdown ist beendet)');
}

section('Notsprung: Außenteam wird per Notrückholung zurückgeholt, ein Beamvorgang bricht ab');
{
  const { g, run } = setup('freie_fahrt', 1);
  const p = g.players[0];
  brechen(g); run(1);
  g.ship.docked = false; g.ship.dockedAt = null; g.space.enemies = [];
  p.zone = 'away'; p.beamLock = true;
  g.ship.beaming = { dir: 'down', t: 0, dur: 5, pids: [p.id] };
  ok(Sprung.notsprungGrund(g) === null, 'Außenteam unten blockt den Notsprung nicht mehr');
  ok(Sprung.notsprung(g) === null, 'Notsprung mit Außenteam unten ausgeführt');
  ok(p.zone === 'ship', 'Außenteam an Bord (Notrückholung)');
  ok(g.ship.beaming === null && p.beamLock === false, 'laufender Beamvorgang abgebrochen');
  ok(g.ship.systems.transfer === 'broken', 'Transfer danach zerstört (Notrückholung)');
}

section('Notsprung bleibt gesperrt: Reaktor offline durch die Steuerung (ohne Zerstörung) und angedockt');
{
  const { g } = setup('freie_fahrt', 1);
  g.ship.docked = false; g.ship.dockedAt = null; g.space.enemies = [];
  g.ship.reactorCtl.state = 'offline';
  ok(/Reaktor offline/.test(Sprung.notsprungGrund(g) || ''), 'Reaktor offline (Steuerung): gesperrt');
  g.ship.reactorCtl.state = 'online';
  g.ship.docked = true; g.ship.dockedAt = g.ship.scene;
  ok(/Erst ablegen/.test(Sprung.notsprungGrund(g) || ''), 'angedockt: gesperrt');
}

section('Übung und Gottmodus lösen keinen Countdown aus');
{
  const { g } = setup('freie_fahrt', 1);
  g.god = true; brechen(g);
  ok(g.ship.reaktorCountdown === null && g.ship.reaktorAusfaelle === 0, 'Gottmodus: kein Countdown, kein Zähler');
  g.god = false; reparieren(g); neustart(g);
  const alt = g.mission.isDrill;
  g.mission.isDrill = () => true;
  brechen(g);
  ok(g.ship.reaktorCountdown === null && g.ship.reaktorAusfaelle === 0, 'Übung: kein Countdown, kein Zähler');
  g.mission.isDrill = alt;
}
section('Debug-Befehl (damage reactor broken) löst keinen Countdown aus');
{
  const { g, c } = setup('freie_fahrt', 1);
  g.handleMessage(c, { t: Protokoll.C.DEBUG, cmd: 'damage', system: 'reactor', state: 'broken' });
  ok(g.ship.systems.reactor === 'broken', 'Debug hat den Reaktor zerstört');
  ok(g.ship.reaktorCountdown === null && g.ship.reaktorAusfaelle === 0, 'Debug-Schaden: kein Countdown');
}

section('Sonderreparatur: 1 Arbeiter 12 s (20-s-Fenster ja, 10-s-Fenster nein)');
{
  const { g, run } = setup('freie_fahrt', 1);
  const p = g.players[0];
  ausfall(g, 1); ankern(g, p);
  I.onAct(g, p, true);
  ok(p.hold && p.hold.kind === 'flick' && Math.abs(p.hold.dur - 12) < 1e-9, `Halten am zerstörten Reaktor: Flicken, Dauer ${p.hold && p.hold.dur} s (nicht 1,5 s)`);
  run(11.5);
  ok(g.ship.systems.reactor === 'broken' && !!g.ship.reaktorCountdown, 'nach 11,5 s noch zerstört');   // 20-s-Fenster: Countdown läuft noch
  run(1);
  ok(g.ship.systems.reactor === 'damaged' && g.ship.reaktorCountdown === null, 'nach 12 s beschädigt, Countdown beendet (20-s-Fenster gerettet)');
  I.onAct(g, p, false);
  run(1);
  reparieren(g); neustart(g);
  brechen(g); ankern(g, p);   // zweiter Ausfall: der Zähler lief von 1 weiter
  I.onAct(g, p, true);
  const z = zeitBisTod(g, 15);
  ok(g.ship.schiffZerstoert && Math.abs(z - 10) <= 0.2, `10-s-Fenster: ein Arbeiter reicht nicht, Tod nach ${z.toFixed(2)} s`);
}

section('Sonderreparatur: 2 Arbeiter 7 s (10-s-Fenster ja, 5-s-Fenster nein)');
{
  const { g, run } = setup('freie_fahrt', 2);
  const [a, b] = g.players;
  ausfall(g, 2); ankern(g, a); ankern(g, b);
  I.onAct(g, a, true); I.onAct(g, b, true);
  ok(I.sonderArbeiter(g) === 2 && Math.abs(I.sonderRate(g, 'reactor') - 12 / 7) < 1e-9, 'zwei Arbeiter: Rate 12/7');
  run(6.5);
  ok(g.ship.systems.reactor === 'broken' && !!g.ship.reaktorCountdown, 'nach 6,5 s noch zerstört');
  run(1.5);
  ok(g.ship.systems.reactor === 'damaged' && g.ship.reaktorCountdown === null, 'zwei Arbeiter: nach 7 s beschädigt, 10-s-Fenster gerettet');
  I.onAct(g, a, false); I.onAct(g, b, false);
  run(0.1);
  reparieren(g); neustart(g);
  brechen(g); ankern(g, a); ankern(g, b);   // dritter Ausfall (Zähler lief weiter)
  I.onAct(g, a, true); I.onAct(g, b, true);
  const z = zeitBisTod(g, 8);
  ok(g.ship.schiffZerstoert && Math.abs(z - 5) <= 0.2, `5-s-Fenster: zwei Arbeiter reichen nicht, Tod nach ${z.toFixed(2)} s`);
}

section('Sonderreparatur: 3 Arbeiter 5 s (5-s-Fenster ja)');
{
  const { g, run } = setup('freie_fahrt', 3);
  const ps = g.players;
  ausfall(g, 3);
  for (const p of ps) { ankern(g, p); I.onAct(g, p, true); }
  ok(I.sonderArbeiter(g) === 3, 'drei Arbeiter: Rate 12/5');
  run(4.5);
  ok(g.ship.systems.reactor === 'broken', 'nach 4,5 s noch zerstört');
  run(0.7);
  ok(g.ship.systems.reactor === 'damaged' && g.ship.reaktorCountdown === null, 'drei Arbeiter: nach 5 s beschädigt, 5-s-Fenster gerettet');
}

section('Kein Schnellweg am zerstörten Reaktor: Ersatzteil, Minispiel, Notreparatur');
{
  const { g, run } = setup('freie_fahrt', 1);
  const p = g.players[0];
  g.god = true;   // ohne Countdown, damit allein die Reparaturwege zählen
  brechen(g); ankern(g, p);
  g.inventory.ersatzteil = 3; p.carry = 'ersatzteil';
  I.onAct(g, p, true);
  ok(p.hold && p.hold.kind === 'flick' && Math.abs(p.hold.dur - 12) < 1e-9, 'mit Ersatzteil: trotzdem Sonderreparatur (flick, 12 s), kein Tausch (3 s)');
  I.onAct(g, p, false); p.hold = null;
  p.carry = null;
  const fehler = I.repairCmd(g, p, 'repair.start', { system: 'reactor' });
  ok(!!fehler && /Sonderreparatur/.test(fehler) && !(p.hold && p.hold.kind === 'minigame'), 'Minispiel am zerstörten Reaktor abgelehnt');
  g.inventory.ersatzteil = 0;
  run(60);
  ok(g.ship.systems.reactor === 'broken', 'Notreparatur ohne Ersatzteil nach 60 s repariert den Reaktor nicht');
  ok(I.repairSystem(g, 'reactor', 'oda', 'swap') === false, 'repairSystem mit swap am zerstörten Reaktor abgelehnt');
  g.god = false;
}

section('Rückschlag: Treffer im Mitte-Bereich zieht den Fortschritt der Sonderreparatur zurück');
{
  const { g, run } = setup('freie_fahrt', 1);
  const p = g.players[0];
  ausfall(g, 1); ankern(g, p); I.onAct(g, p, true);
  run(6);
  const vor = p.hold.t;
  const k = Damage.onSystemHit(g, -1);
  ok(k === 1 && Math.abs(p.hold.t - vor * 0.5) < 0.05, `Mitte-Treffer: Fortschritt ${vor.toFixed(2)} -> ${p.hold.t.toFixed(2)} (halb)`);
  I.onAct(g, p, false);
}

section('Weltstand speichert keinen Countdown; geladener Reaktor hat keinen');
{
  const { g, run } = setup('freie_fahrt', 1);
  ausfall(g, 2);
  const W2 = require('../server/weltstand.js');
  let json = '';
  try { json = JSON.stringify(W2.capture(g)); } catch (e) { json = 'FEHLER ' + e.message; }
  ok(json.length > 10 && !/reaktorCountdown|reaktorAusfaelle|schiffZerstoert|reaktorTod/.test(json), 'capture: kein Countdown, kein Zähler, kein Zerstört-Flag im Weltstand');
  // Laden setzt Zustände direkt (ohne Übergang): der geladene zerstörte Reaktor startet keinen Countdown
  g.ship.systems.reactor = 'broken'; g.ship.reaktorCountdown = null; g.ship.reaktorAusfaelle = 0;
  run(25);
  ok(!g.ship.schiffZerstoert && g.ship.reaktorCountdown === null, 'geladener zerstörter Reaktor: nach 25 s kein Tod');
}

section('Solo-Menüpause hält den Countdown an');
{
  const { g, run, c } = setup('freie_fahrt', 1);
  brechen(g); run(2);
  const rest0 = g.ship.reaktorCountdown.t;
  g.handleMessage(c, { t: Protokoll.C.MENU, op: 'pause', on: true });
  ok(g.paused === true, 'Solo-Pause gesetzt');
  const zeit0 = g.time;
  run(30);   // länger als der ganze Countdown
  ok(g.time === zeit0 && g.paused === true, 'Spielzeit steht in der Pause');
  ok(!g.ship.schiffZerstoert && g.ship.reaktorCountdown && g.ship.reaktorCountdown.t === rest0, `in der Pause: kein Tod, Countdown steht (${rest0.toFixed(2)} s)`);
  ok(Reaktortod.snapshot(g).rest === Math.round(rest0 * 10) && g.stats.emergencies === 0, 'Snapshot zeigt den stehenden Rest, kein Notfallprotokoll');
  g.handleMessage(c, { t: Protokoll.C.MENU, op: 'pause', on: false });
  ok(g.paused === false, 'Pause aus');
  const t = zeitBisTod(g, 25);
  ok(g.ship.schiffZerstoert && Math.abs(t - rest0) <= 0.1, `nach der Pause läuft der Rest weiter: Tod nach ${t.toFixed(2)} s (Rest ${rest0.toFixed(2)} s)`);
}

section('Szene stellt die Lerche neu auf: Zähler, Countdown und Zerstört-Flag zurück');
{
  const SR = require('../server/sim/szenenreset.js');
  const { g } = setup('freie_fahrt', 1);
  ausfall(g, 3);
  ok(g.ship.reaktorAusfaelle === 3 && !!g.ship.reaktorCountdown, 'Vorbereitung: dritter Ausfall, Countdown läuft');
  SR.zuruecksetzen(g);   // Szene von vorn (Regiebuch-Baustein schiff_zuruecksetzen)
  ok(g.ship.reaktorAusfaelle === 0 && g.ship.reaktorCountdown === null && g.ship.schiffZerstoert === false, 'Szenen-Reset: Zähler 0, kein Countdown, nicht zerstört');
  ok(g.ship.systems.reactor === 'ok' && Reaktortod.snapshot(g).n === 0 && Reaktortod.snapshot(g).rest === -1, 'Reaktor heil, Snapshot n 0 / rest -1');
  brechen(g);
  ok(Math.abs(g.ship.reaktorCountdown.t - 20) < 1e-9, 'der nächste Ausfall beginnt wieder bei 20 s');
  const t = zeitBisTod(g, 25);
  ok(g.ship.schiffZerstoert && Math.abs(t - 20) <= 0.1, `Tod nach ${t.toFixed(2)} s`);
  SR.zuruecksetzen(g);
  ok(g.ship.schiffZerstoert === false && g.ship.reaktorAusfaelle === 0, 'Szenen-Reset nach dem Tod: Flag und Zähler zurück');
}

section('Neue Partie (reset) startet mit Zähler 0 – auch das Testgelände (arena.js) braucht keinen eigenen Reset');
{
  const g = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'A0', color: 0 });
  g.ship.reaktorAusfaelle = 3; g.ship.schiffZerstoert = true; g.ship.reaktorCountdown = { t: 4 };   // Reste einer früheren Partie
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space', szene: 'asteroiden_bewegt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 30; k++) g.step();
  ok(g.ship.reaktorAusfaelle === 0 && g.ship.schiffZerstoert === false && g.ship.reaktorCountdown === null, 'Partie-/Arena-Start: Zähler 0, nicht zerstört, kein Countdown (das Schiff wird dabei neu gebaut)');
}

section('Ereignis schiffZerstoert wird gesendet');
{
  const { g, run, c } = setup('freie_fahrt', 1);
  brechen(g); run(21);
  ok(c.inbox.some((m) => m.t === 'event' && m.kind === 'schiffZerstoert' && m.grund === 'reaktor'), 'Ereignis schiffZerstoert { grund: reaktor } im Strom');
  const snap = g.snapshot();
  ok(snap.ship && snap.ship.reaktorTod && snap.ship.reaktorTod.tot === 1 && snap.ship.reaktorTod.rest === -1, 'Snapshot ship.reaktorTod: tot 1, rest -1');
}

section('Verbraucher Flotte: Notfallprotokoll scheitert den Befehl (Countdown statt Naht)');
{
  const { g } = setup('freie_fahrt', 1);
  g.ship.docked = false; g.ship.dockedAt = null; g.space.enemies = [];
  const e = Flotte.befehl(g, { art: 'durchbrechen', punkte: 'ost' });
  ok(!!e && e.st !== 2, 'Befehl läuft vor dem Ausfall');
  brechen(g);
  const t = zeitBisTod(g, 25);
  ok(g.ship.schiffZerstoert && Math.abs(t - 20) <= 0.2, `Reaktor-Countdown abgelaufen (${t.toFixed(2)} s)`);
  for (let k = 0; k < 6; k++) g.step();   // die Flotte wertet den Befehl im Tick nach dem Tod aus
  ok(e.st === 2 && e.grund === 'notfall', 'Befehl gescheitert (notfall), wie beim Notfallprotokoll');
}

section('Verbraucher Wellen (Arena): Notfallprotokoll beendet die Runde (Countdown statt Naht)');
{
  const g = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'A0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space', szene: 'asteroiden_bewegt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  BOTS.setBotAuto(g, false);
  const S = () => g.arena && g.arena.wellen;
  const bis = (fn, max) => { let k = 0; while (!fn() && k < Math.round(max * 30)) { g.step(); k++; } return fn(); };
  ok(bis(() => !!S() && S().ph === 'kampf', 90), 'Welle 1 läuft');
  g.space.enemies.forEach((e) => { e.x = 9000; });   // Gegner außer Reichweite: nur der Reaktor entscheidet
  brechen(g);
  ok(bis(() => !!S() && S().ph === 'ende', 40), 'Countdown-Tod beendet die Runde (Ende beim Notfallprotokoll)');
  ok(c.inbox.filter((m) => m.t === 'event' && m.kind === 'wellenEnde').length === 1, 'wellenEnde genau einmal');
  ok(g.errors === 0, 'keine Server-Fehler');
}

console.log(`\ntest-reaktortod: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
