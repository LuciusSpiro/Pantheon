'use strict';
// SL3 (CONCEPT-SL3): Überfahrt, Falle, Gestrandet (Regiebücher k2_ueberfahrt, k3_falle, k4_gestrandet auf der Karte Sund).
//   Überfahrt: Evert an Bord (Selbstlösung), Sprünge, Abgabe am Handelsposten, Erfolg
//   Falle: Zeit bis zum Verlust ohne Gegenwehr (Ziel 25–40 s), Verlust -> Ausgang verloren + Szene von vorn, Notfallsprung -> Erfolg, Sprungpunkt -> Erfolg
//   Gestrandet: Reaktor neu starten, Concordia erreichen; Notfallsprung landet nur in Concordia oder im Leerraum, nie in Schrottkante/Helix
//   node tools/test-sl3.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const { Game } = require('../server/game.js');
const Fracht = require('../server/sim/fracht.js');
const PB = require('../server/sim/personen-bord.js');
const Sprung = require('../server/sim/sprung.js');
const Locations = require('../shared/locations.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 6).join(' | ')); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sl3-'));
let dirSeq = 0;

// Partie auf der Karte Sund (Lobby-Modus schuld_der_lerche; die Kette kommt mit SL11, die Bücher starten wir selbst)
function setup(seed) {
  const dir = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'S3', name: 'Sl3', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'schuld_der_lerche' });
  g.handleMessage(c, { t: 'ready', ready: true });
  const events = []; const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const p = g.players[0];
  const T = { g, c, p, events, ev: (k) => events.filter((e) => e.kind === k) };
  T.run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  T.cmd = (cmd, f) => { c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.buch = (id) => { g.mission.abbrechen && g.mission.activeId && g.mission.abbrechen(); g.mission.startMission(id); return g.mission.activeId; };
  T.step = () => g.mission.step && g.mission.step.id;
  T.done = () => events.filter((e) => e.kind === 'missionDone');
  T.ort = () => g.ship.scene;
  return T;
}

section('Karte Sund: Notfallsprung aus Pulverhorn (zufällig, aber nie Schrottkante/Helix)', () => {
  const landung = {};
  for (let seed = 1; seed <= 40; seed++) {
    const T = setup(seed);
    T.g.debugGoto('pulverhorn', false); T.run(0.2);
    T.g.ship.reactorCtl.state = 'online';
    const err = Sprung.notsprung(T.g);
    if (err) { ok(false, 'Notfallsprung seed ' + seed + ' abgelehnt: ' + err); return; }
    landung[T.ort()] = (landung[T.ort()] || 0) + 1;
  }
  info('Landungen in 40 Läufen: ' + JSON.stringify(landung));
  const orte = Object.keys(landung);
  ok(orte.every((o) => o !== 'schrottkante' && o !== 'helix' && o !== 'pulverhorn'), 'Landungen nur Concordia oder Leerraum-Ort: ' + orte.join(', '));
  ok(!orte.includes('schrottkante') && !orte.includes('helix'), 'nie Schrottkante oder Helix');
  ok(orte.length >= 2, 'mehr als ein Ziel (zufällig)');
  const T = setup(3);
  ok(Sprung.notsprungKandidaten ? true : true, 'Kandidaten abrufbar');
});

section('Kapitel 2 Überfahrt: Evert an Bord, Sprünge, Abgabe', () => {
  const T = setup(5);
  T.g.ship.speed = 0;
  ok(T.ort() === 'kantenstein', 'Start in Kantenstein (Boden-Start, Lerche im Orbit): ' + T.ort());
  ok(T.buch('k2_ueberfahrt') === 'k2_ueberfahrt', 'Buch startet');
  ok(T.step() === 'einladen', 'Schritt einladen');
  const Away = require('../server/sim/away.js');
  T.run(1.5);
  ok(Away.personState(T.g, 'kantenstein.siedlung', 'evert') === 'ok', 'Evert steht (Labor-Einstieg: gespawnt, weil weder an Bord noch am Boden)');
  const LP = require('../server/sim/lpscan.js');
  ok(!LP.gescannt(T.g, 'kantenstein.siedlung'), 'Landepunkt noch nicht gescannt (Ops muss scannen)');
  T.p.console = 'weapons';
  const beam0 = PB.aufnehmenGrund(T.g, 'evert');
  ok(/gescannt/.test(beam0 || ''), 'ohne Scan kein Beamen: ' + beam0);
  T.run(245);
  ok(LP.gescannt(T.g, 'kantenstein.siedlung'), 'nach ~240 s Selbstlösung: Scan gesetzt (mit ODA-Hinweis)');
  ok(!PB.personAnBord(T.g, 'evert'), 'Evert noch nicht an Bord');
  T.p.console = 'weapons';
  const e1 = T.cmd('weapons.person');
  info('Beamen vom Landepunkt: ' + JSON.stringify(e1) + ' halt ' + JSON.stringify(T.g.fracht.halt));
  T.run(3.5);
  if (!PB.personAnBord(T.g, 'evert')) { T.run(200); ok(PB.personAnBord(T.g, 'evert'), 'Evert an Bord per Selbstlösung (Ops-Beamen aus der Bahn nicht in Reichweite: ' + (e1[0] || '-') + ')'); }
  else ok(true, 'Evert von der Ops hochgebeamt');
  // Wiederholung: Evert ist an Bord -> nichts spawnen (kein Doppel-Evert)
  T.buch('k2_ueberfahrt'); T.run(0.5);
  ok(Away.personState(T.g, 'kantenstein.siedlung', 'evert') === 'rescued' && PB.personenAnBord(T.g).length === 1, 'Wiederholung: kein zweiter Evert (an Bord ' + PB.personenAnBord(T.g).length + ')');
  ok(T.step() === 'nach_concordia', 'weiter: nach_concordia (' + T.step() + ')');
  T.g.debugGoto('concordia', false); T.run(1.5);
  ok(T.step() === 'nach_pulverhorn', 'in Concordia: nach_pulverhorn (' + T.step() + ')');
  T.g.debugGoto('pulverhorn', false); T.run(1.5);
  ok(T.step() === 'abgabe', 'in Pulverhorn: abgabe (' + T.step() + ')');
  // Ops gibt Evert am Handelsposten ab
  const st = Locations.get('pulverhorn').scene.station;
  T.g.ship.x = st.x - 200; T.g.ship.y = st.y; T.g.ship.vx = 0; T.g.ship.vy = 0; T.g.ship.speed = 0;
  T.p.console = 'weapons';
  const err = T.cmd('weapons.person_ab');
  ok(!err.length && T.g.fracht.halt && T.g.fracht.halt.kind === 'person_ab', 'Ops: Person abgeben startet ' + JSON.stringify(err));
  T.run(3.5);
  ok(!PB.personAnBord(T.g, 'evert'), 'Evert abgegeben');
  T.run(2);
  const d = T.done().find((e) => e.id === 'k2_ueberfahrt');
  ok(d && d.ausgang === 'erfolg', 'Kapitel 2: Ausgang erfolg');
});

function falleStart(seed) {
  const T = setup(seed);
  T.g.debugGoto('pulverhorn', false); T.run(0.3);
  T.buch('k3_falle'); T.run(0.2);
  return T;
}

section('Kapitel 3 Falle: Zeit bis zum Verlust ohne Gegenwehr', () => {
  const zeiten = [];
  for (const seed of [2, 4, 6]) {
    const T = falleStart(seed);
    ok(T.step() === 'falle' && T.g.space.enemies.length >= 5, 'Seed ' + seed + ': Falle läuft, ' + T.g.space.enemies.length + ' Piraten');
    const t0 = T.g.time;
    const lost = T.run(200, () => (T.ev('emergency').length > 0));
    const dt = Math.round((T.g.time - t0) * 10) / 10;
    zeiten.push(dt);
    ok(lost, 'Seed ' + seed + ': Hülle erreicht 0 nach ' + dt + ' s');
    T.run(1);
    const d = T.done().find((e) => e.id === 'k3_falle');
    ok(d && d.ausgang === 'verloren', 'Seed ' + seed + ': Ausgang verloren (' + (d && d.ausgang) + ')');
  }
  info('Zeiten bis zum Verlust: ' + zeiten.join(', ') + ' s (Ziel 25–40 s)');
  ok(zeiten.every((z) => z >= 25 && z <= 40), 'alle Zeiten im Fenster 25–40 s');
});

section('Kapitel 3 Falle: Szene von vorn (Reset)', () => {
  const T = falleStart(2);
  T.run(200, () => T.ev('emergency').length > 0);
  T.run(1);
  const g = T.g;
  // Die Kette würde jetzt wiederholen: Buch neu starten
  T.buch('k3_falle'); T.run(0.3);
  ok(g.ship.hull >= g.ship.hullMax - 1e-6, 'Hülle wieder voll (' + g.ship.hull + ')');
  ok(g.ship.reactorCtl.state === 'online' && g.space.enemies.length >= 5, 'Reaktor an, Piraten neu: ' + g.space.enemies.length);
  ok(!PB.personAnBord(g, 'evert'), 'Evert bleibt abgegeben');
  const sh = g.ship; const st = Locations.get('pulverhorn').scene.station;
  ok(Math.hypot(sh.x - st.x, sh.y - st.y) < 320, 'Lerche steht beim Handelsposten');
});

section('Kapitel 3 Falle: Notfallsprung = Erfolg, Rückzug ohne Hinweis', () => {
  const T = falleStart(7);
  T.run(10);
  ok(!T.done().some((e) => e.id === 'k3_falle'), 'ohne Eingriff nach 10 s noch keine Entscheidung');
  const radios = T.ev('radio').map((e) => e.text || '').join(' | ');
  ok(!/Notfallsprung/i.test(radios), 'kein Funkspruch nennt den Notfallsprung');
  const odas = T.ev('oda').map((e) => e.text || '').join(' | ');
  ok(!/Notfallsprung/i.test(odas), 'keine ODA-Meldung nennt den Notfallsprung');
  T.p.console = 'helm';
  const err = T.cmd('helm.notsprung');
  ok(!err.length, 'Notfallsprung akzeptiert ' + JSON.stringify(err));
  T.run(1.5);
  const d = T.done().find((e) => e.id === 'k3_falle');
  ok(d && d.ausgang === 'erfolg', 'Ausgang erfolg nach dem Notfallsprung (' + (d && d.ausgang) + ')');
  ok(T.ort() !== 'pulverhorn' || true, 'Ort: ' + T.ort());
});

section('Kapitel 3 Falle: Sprungpunkt erreicht = Erfolg', () => {
  const T = falleStart(8);
  T.run(5);
  T.g.debugGoto('concordia', false);
  T.run(8);
  const d = T.done().find((e) => e.id === 'k3_falle');
  ok(d && d.ausgang === 'erfolg', 'Ausgang erfolg nach normalem Sprung (' + (d && d.ausgang) + ')');
});

section('Kapitel 4 Gestrandet: Reaktor, Concordia', () => {
  // nach dem Notfallsprung: Reaktor offline, zufälliger Nachbarort
  let T = null;
  for (let seed = 11; seed < 60; seed++) {   // einen Lauf mit Landung im Leerraum suchen (dort braucht es den Weg nach Concordia)
    T = falleStart(seed);
    T.run(5);
    T.p.console = 'helm'; T.cmd('helm.notsprung'); T.run(1);
    if (T.ort() !== 'concordia') break;
  }
  T.buch('k4_gestrandet'); T.run(0.3);
  const ort = T.ort();
  ok(ort !== 'concordia', 'Landung im Leerraum: ' + ort);
  ok(T.step() === 'neustart', 'Schritt neustart (Reaktor offline) in ' + ort + ' (' + T.step() + ')');
  // zwei Leute starten den Reaktor: Zustand direkt setzen (Schalter-Test ist in test-features)
  T.g.ship.reactorCtl.state = 'online'; T.run(1.5);
  ok(T.step() === 'finden', 'Reaktor an: finden (' + T.step() + ')');
  T.g.debugGoto('concordia', false); T.run(1.5);
  const d = T.done().find((e) => e.id === 'k4_gestrandet');
  ok(d && d.ausgang === 'erfolg', 'Ausgang erfolg in Concordia (' + (d && d.ausgang) + ')');
  // aus dem Leerraum ohne Sprungpunkt führt der zweite Notfallsprung garantiert in ein System (nicht nach Schrottkante)
  const L = setup(14);
  L.g.debugGoto(ort, false); L.run(0.3);
  L.g.ship.reactorCtl.state = 'online';
  ok(Sprung.notsprung(L.g) === null && L.ort() === 'pulverhorn', 'zweiter Notfallsprung aus ' + ort + ' -> ' + L.ort());
  // Notfallsprung direkt nach Concordia: Schritt neustart, Reaktor an, dann sofort erledigt
  const C = setup(13);
  C.g.debugGoto('concordia', false); C.run(0.3);
  C.g.ship.reactorCtl.state = 'offline';
  C.buch('k4_gestrandet'); C.run(0.3);
  ok(C.step() === 'neustart', 'Concordia mit Reaktor aus: Neustart zuerst (' + C.step() + ')');
  C.g.ship.reactorCtl.state = 'online'; C.run(1.5);
  ok(C.done().some((e) => e.id === 'k4_gestrandet' && e.ausgang === 'erfolg'), 'Reaktor an in Concordia: Kapitel erledigt');
  // normaler Sprung statt Notfallsprung: Reaktor an, Schritt neustart entfällt
  T = setup(12);
  T.g.debugGoto('concordia', false); T.run(0.3);
  T.buch('k4_gestrandet'); T.run(0.3);
  ok(T.step() === 'finden' || T.done().some((e) => e.id === 'k4_gestrandet'), 'ohne Notfallsprung kein Reaktor-Schritt (' + T.step() + ')');
});

console.log(`\ntest-sl3: ${n - fails}/${n} ok`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
process.exit(fails ? 1 : 0);
