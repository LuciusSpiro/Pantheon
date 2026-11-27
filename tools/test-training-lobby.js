'use strict';
// TRA-01 A1: Trainingsmodi über den ECHTEN Lobby-Weg (lobbyOpt startMission -> ready), headless gegen die Game-Klasse.
//   node tools/test-training-lobby.js
//   Start        Karte limes, Schiff im Saumraum (hafen, Hex 0206), Platzhalter-Buch aktiv, kein Weltstand persistent, kein Testgeld, keine Kette
//   Brett        das Trainingsbuch steht nicht im Missionsbuch (bookEntries), nicht in Angeboten; HUD-Ziel „Platzhalter“ ist da
//   Neustart     Ausgang verloren -> Szene von vorn (Versuch 2, Buch neu aktiv); Ausgang erfolg -> Meldung genau einmal, kein Neustart
//   CONSOLE_HELP im Training keine ODA-Zeile beim Konsolenbetritt; Gegenprobe: im Testgelände Raumkampf kommt sie
//   Reaktor-Tod  Reaktortod.gilt/zerstoert im Training wirkungslos; Gegenprobe: im Testgelände Raumkampf gilt der Tod
//   Option       trainingSprache: nur Captain, Standard false, geht in game.arena.training.sprache; Modus-Wechsel setzt zurück; Lobby-Snapshot
//   Snapshot     kein neues Feld im Spiel-Snapshot (kein „training“)
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const { Game } = require('../server/game.js');
const Reaktortod = require('../server/sim/reaktortod.js');
const Mission = require('../server/sim/mission.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

// Partie über den Lobby-Weg; opts.sprache sendet trainingSprache true NACH dem Modus; Lobby bleibt offen, wenn opts.lobby
function lobbySpiel(modus, np, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'T' + i, name: 'Tr' + i, color: i });
    if (i === 0) { g.handleMessage(c, { t: 'lobbyOpt', startMission: modus }); if (o.sprache) g.handleMessage(c, { t: 'lobbyOpt', trainingSprache: true }); }
    cs.push(c);
  }
  const odas = []; const o0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(String(t)); return o0(t, x); };
  if (!o.lobby) for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec, bis) => { for (let k = 0; k < Math.round(sec / DT); k++) { g.step(); if (bis && bis()) return true; } return !bis; };
  return { g, cs, run, odas };
}
const MODI = [['training_fliegen', 'tra_fliegen'], ['training_captain', 'tra_captain']];

for (const [modus, buch] of MODI) {
  section('Start ' + modus, () => {
    const T = lobbySpiel(modus, 2); const g = T.g;
    T.run(2);
    ok(g.phase === 'play' && g.arena && g.arena.kind === modus, 'Menümodus läuft: phase play, arena.kind ' + modus);
    ok(g.weltId === 'limes', 'Karte limes (Standard), nicht sund (' + g.weltId + ')');
    ok(g.ship.scene === 'hafen' && Sektoren.hexDaten(Sektoren.hexVonOrt(g.ship.scene)).region === 'saumraum', 'Schiff im Saumraum: Szene ' + g.ship.scene + ', Hex ' + Sektoren.hexVonOrt(g.ship.scene));
    ok(g.mission.activeId === buch && g.mission.step && g.mission.step.id === g.mission.def.steps[0].id, 'Trainingsbuch ' + buch + ' aktiv im ersten Schritt');
    ok(!g.weltstand || g.weltstand.persistent === false, 'kein persistenter Weltstand');
    ok(!g.mission.kette && g.mission.mode === 'arena' && !g.mission.pending.length, 'keine Kampagnenkette, Modus arena, kein Kampagnen-Gerücht');
    ok(g.inventory.marks !== g.C.werft.testmarken, 'kein Testgeld (' + g.inventory.marks + ' Marken, Testmarken wären ' + g.C.werft.testmarken + ')');
    ok(g.players.every((p) => p.zone === 'ship'), 'beide Spieler an Bord');
    ok(g.arena.training && g.arena.training.modus === modus && g.arena.training.versuch === 1 && g.arena.training.sprache === false, 'game.arena.training = { modus, sprache false, versuch 1 }');
    ok(g.errors === 0, 'g.errors 0 (' + g.errors + ')');
  });
}

section('Brett: nicht im Angebotsbrett', () => {
  const T = lobbySpiel('training_fliegen', 1); const g = T.g; T.run(3);
  const ids = g.mission.bookEntries().map((e) => e.id);
  ok(!ids.some((id) => /^tra_/.test(id)), 'Missionsbuch (bookEntries) enthält kein tra_*-Buch (' + ids.join(',') + ')');
  ok(!g.mission.offers().some((id) => /^tra_/.test(id)), 'Angebote (offers) enthalten kein tra_*-Buch');
  ok(!g.mission.offerPending(), 'kein Angebot offen');
  ok(!g.mission.toSave().missionen.tra_fliegen && g.mission.toSave().aktiv === null, 'Weltstand-Speicherform lässt das interne Buch weg');
  ok(g.mission.state.objectives.length > 0 && g.mission.state.objectives.every((o) => o.text && !/^@/.test(o.text)), 'HUD-Checkliste ist da (Ziele aus dem Buch, Texte aufgelöst)');
  const g2 = lobbySpiel('arena_space', 1).g;   // Gegenprobe: das Testgelände-Buch (JS-Modul, intern) verhält sich gleich
  ok(!g2.mission.bookEntries().some((e) => e.id === 'arena_space'), 'Gegenprobe: auch arena_space (intern) steht nicht im Brett');
});

section('Neustart und Szenenende', () => {
  const T = lobbySpiel('training_fliegen', 2); const g = T.g; T.run(2);
  const tr = g.arena.training;
  g.mission.completeMission('verloren');
  ok(g.mission.missions.tra_fliegen.state === 'done' && g.mission.missions.tra_fliegen.ausgang === 'verloren', 'Buch endet mit verloren');
  T.run(3, () => tr.versuch === 2);
  ok(tr.versuch === 2 && g.mission.activeId === 'tra_fliegen' && g.mission.missions.tra_fliegen.state === 'active', 'Neustart: Versuch 2, Buch wieder aktiv');
  ok(g.mission.step.id === g.mission.def.steps[0].id && g.ship.scene === 'hafen' && g.ship.docked === true && g.players.every((p) => p.zone === 'ship'), 'Szene von vorn: erster Schritt des Buchs, Schiff am Hafen angedockt, Crew an Bord');
  ok(g.mission.state.objectives.length > 0 && g.mission.state.objectives.some((o) => !o.done), 'Ziel wieder offen');
  // Erfolg: das Buch setzt trainingFertig (Platzhalter: der Test), update schließt ab und meldet genau einmal
  const vorher = T.odas.length;
  g.mission.flags.trainingFertig = true;
  T.run(3);
  ok(g.mission.missions.tra_fliegen.state === 'done' && g.mission.missions.tra_fliegen.ausgang === 'erfolg', 'Flag trainingFertig schließt das Buch mit erfolg ab');
  ok(T.odas.slice(vorher).filter((t) => /Training geschafft/.test(t)).length === 1 && tr.gemeldet === true, 'Meldung „Training geschafft“ genau einmal');
  T.run(5);
  ok(tr.versuch === 2 && T.odas.filter((t) => /Training geschafft/.test(t)).length === 1, 'nach Erfolg vor Ablauf der Frist kein Neustart und keine zweite Meldung');
  T.run(5, () => tr.versuch === 3);   // TRA-01 B2: nach NEUSTART_NACH_ERFOLG (8 s) geht die Szene von vorn los
  ok(tr.versuch === 3 && g.mission.activeId === 'tra_fliegen' && g.mission.missions.tra_fliegen.state === 'active', 'nach Erfolg und Frist: Neustart (Versuch 3), Buch wieder aktiv');
  ok(g.errors === 0, 'g.errors 0');
  // 30-s-Rückfall: die Spieler bleiben künstlich unten (jeder Tick setzt sie zurück), Neustart erst nach NEUSTART_MAX_WARTEN und holt sie an Bord
  const U = lobbySpiel('training_captain', 2); const u = U.g; U.run(2);
  const ut = u.arena.training;
  const halten = () => { for (const p of u.players) { p.zone = 'away'; p.downed = true; p.hp = 0; } if (u.away) u.away.recallT = 0; };
  u.mission.completeMission('verloren');
  halten();
  const t0 = u.time; let tNeu = null;
  U.run(60, () => { if (ut.versuch === 2) { tNeu = u.time; return true; } halten(); return false; });
  ok(tNeu != null && tNeu - t0 >= 29.5 && tNeu - t0 <= 33, 'Fallback: Neustart nicht vor, aber kurz nach 30 s (' + (tNeu != null ? (tNeu - t0).toFixed(1) : '-') + ' s)');
  U.run(0.3);
  ok(u.players.every((p) => p.zone === 'ship' && !p.downed && p.hp > 0), 'Fallback: Neustart holt alle an Bord');
});

section('CONSOLE_HELP', () => {
  const zeile = Mission.CONSOLE_HELP.helm;
  for (const [modus] of MODI) {
    const T = lobbySpiel(modus, 1); const g = T.g; T.run(1);
    g.missionEvent('consoleEnter', { kind: 'helm' }); g.missionEvent('consoleEnter', { kind: 'captain' });
    ok(!T.odas.some((t) => t === zeile || t === Mission.CONSOLE_HELP.captain), modus + ': Konsolenbetritt löst keine CONSOLE_HELP-Zeile aus');
  }
  const G = lobbySpiel('arena_space', 1); G.run(1);
  G.g.missionEvent('consoleEnter', { kind: 'helm' });
  ok(G.odas.filter((t) => t === zeile).length === 1, 'Gegenprobe (Raumkampf): dieselbe Zeile kommt genau einmal');
});

section('Reaktor-Tod', () => {
  for (const [modus] of MODI) {
    const T = lobbySpiel(modus, 1); const g = T.g; T.run(1);
    ok(!g.god, modus + ': Gottmodus aus (der Test misst das Gate, nicht god)');
    ok(Reaktortod.gilt(g) === false, modus + ': Reaktortod.gilt false');
    ok(Reaktortod.zerstoert(g) === null && !g.ship.reaktorCountdown, modus + ': zerstoert() startet keinen Countdown');
  }
  const G = lobbySpiel('arena_space', 1); G.run(1);
  ok(Reaktortod.gilt(G.g) === true, 'Gegenprobe (Raumkampf): Reaktortod.gilt true');
  ok(typeof Reaktortod.zerstoert(G.g) === 'number' && !!G.g.ship.reaktorCountdown, 'Gegenprobe: zerstoert() startet den Countdown');
});

section('Option trainingSprache', () => {
  const S = (T) => T.g.arena && T.g.arena.training && T.g.arena.training.sprache;
  ok(S(lobbySpiel('training_captain', 1)) === false, 'Captain: Standard ohne Sprache');
  ok(S(lobbySpiel('training_captain', 1, { sprache: true })) === true, 'Captain mit trainingSprache true: sprache true im Trainingszustand');
  ok(S(lobbySpiel('training_fliegen', 1, { sprache: true })) === false, 'Fliegen: trainingSprache wird ignoriert');
  const L = lobbySpiel('training_captain', 2, { lobby: true }); const g = L.g;
  g.handleMessage(L.cs[1], { t: 'lobbyOpt', trainingSprache: true });
  ok(g.lobbyOpts.trainingSprache === true, 'jeder darf umschalten: Option gesetzt');
  ok(g.snapshot().lobby.trainingSprache === true, 'Lobby-Snapshot trägt trainingSprache im Captain-Modus');
  g.handleMessage(L.cs[0], { t: 'lobbyOpt', trainingSprache: 'ja' });
  ok(g.lobbyOpts.trainingSprache === true, 'kein Boolean: ignoriert');
  g.handleMessage(L.cs[0], { t: 'lobbyOpt', startMission: 'training_fliegen' });
  ok(g.lobbyOpts.trainingSprache === false && !('trainingSprache' in g.snapshot().lobby), 'Wechsel zu Fliegen setzt zurück, Lobby-Snapshot ohne das Feld');
  g.handleMessage(L.cs[0], { t: 'lobbyOpt', trainingSprache: true });
  ok(g.lobbyOpts.trainingSprache === false, 'Fliegen: Option wird abgelehnt');
  const M = lobbySpiel('arena_space', 1, { lobby: true }); M.g.handleMessage(M.cs[0], { t: 'lobbyOpt', trainingSprache: true });
  ok(M.g.lobbyOpts.trainingSprache === false && !('trainingSprache' in M.g.snapshot().lobby), 'andere Modi: Option wirkungslos, Feld nicht im Lobby-Snapshot');
});

section('Snapshot', () => {
  const T = lobbySpiel('training_captain', 2, { sprache: true }); T.run(2);
  const s = JSON.stringify(T.g.snapshot());
  ok(!/"training"/.test(s) && !/trainingSprache/.test(s), 'Spiel-Snapshot ohne neues Feld (kein training, kein trainingSprache)');
  ok(T.g.errors === 0, 'g.errors 0');
});

console.log('\nTEST-TRAINING-LOBBY: ' + (fails ? fails + ' FEHLER' : 'alle ' + n + ' bestanden'));
process.exit(fails ? 1 : 0);
