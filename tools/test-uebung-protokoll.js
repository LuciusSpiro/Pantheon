'use strict';
// UEB-01 Paket A2: Lobby-Modus arena_forschung (Direktstart Forschungsstation) im Protokoll und in startGame.
// Teil (b) braucht den Startpfad aus A1 (arena.KINDS kennt den Modus) und scheitert klar, solange er fehlt.
//   node tools/test-uebung-protokoll.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const Welt = require('../server/sim/welt.js');
const arena = require('../server/sim/arena.js');
const Werft = require('../server/sim/werft.js');
const Kampagne = require('../server/mission/kampagne.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const M = 'arena_forschung';

section('Protokoll', () => {
  const lm = Protocol.LOBBY_MODI;
  ok(lm.includes(M), 'arena_forschung in LOBBY_MODI');
  ok(lm.indexOf('arena_graben') === lm.indexOf('arena_away') + 1 && lm.indexOf(M) === lm.indexOf('arena_graben') + 1 && lm.indexOf('arena_space') === lm.indexOf(M) + 1, 'Reihenfolge: arena_away, arena_graben, arena_forschung, arena_space');
  ok(Protocol.START_LABELS[M] === 'Forschungsstation', 'START_LABELS: Forschungsstation');
  ok(typeof Protocol.START_HINTS[M] === 'string' && Protocol.START_HINTS[M].length > 5, 'START_HINTS vorhanden');
  ok(!Protocol.CAMPAIGN_STARTS.includes(M), 'nicht in CAMPAIGN_STARTS (kein Weltstand)');
  ok(!Protocol.START_MISSIONS.includes(M), 'START_MISSIONS bleibt die alte Liste (gültig ist jeder LOBBY_MODI-Eintrag)');
});

function spiel(modus) {
  const g = new Game({ noStore: true, worlds: false, seed: 21, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 2; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'U' + i, name: 'Ue' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: modus || M });
    cs.push(c);
  }
  return { g, cs };
}

section('Lobbywahl und Start (b)', () => {
  const { g, cs } = spiel();
  ok(g.lobbyOpts.startMission === M, 'Server akzeptiert lobbyOpt startMission arena_forschung');
  ok(arena.KINDS.includes(M), 'arena.KINDS kennt den Modus (Paket A1, erst nach dem Merge)');
  if (!arena.KINDS.includes(M)) return;
  const dir0 = g.worldDir;
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ok(g.phase === 'play', 'Partie läuft (phase play)');
  ok(g.weltId === 'sund' && Welt.kartenId() === 'sund', 'Karte Sund');
  ok(g.weltstand && g.weltstand.persistent === false, 'Weltstand nicht persistent');
  ok(g.worldDir === dir0, 'worldDir unverändert');
  ok(g.worldLock == null, 'kein Weltstand-Lock');
  ok(!g.explore.visited.has(Welt.startOrt()), 'kein Erstbesuch am Startort (' + Welt.startOrt() + ', keine Ansage, keine Erstbesuchsmarken)');
  const k7 = Kampagne.laden('schuld-der-lerche').kapitel.find((c) => c.id === 'k7_geld').einstieg.marken;
  ok(Number.isFinite(k7) && g.inventory.marks === k7 && g.inventory.marks !== g.C.werft.testmarken, 'Marken = Einstieg k7_geld (' + g.inventory.marks + '), nicht Testmarken');
  ok(arena.istUebungsszene(M) && !arena.istUebungsszene('arena_space') && !arena.istUebungsszene('arena_away') && !arena.istUebungsszene('arena_graben'), 'istUebungsszene: nur arena_forschung');
  ok(Werft.status(g).aktiv === false, 'werft.status(g).aktiv ist false (keine Testumgebung): ' + Werft.status(g).grund);
  // Neustart: Marken wieder auf dem Startwert (Ausbauten sind ohne Werft in dieser Szene nicht möglich, also nichts weiter zurückzusetzen)
  g.inventory.marks = 3;
  require('../server/sim/uebung-forschung.js').neustart(g);
  ok(g.inventory.marks === k7, 'Neustart: Marken wieder ' + k7 + ' (' + g.inventory.marks + ')');
});

section('Gegenprobe Testgelände unverändert', () => {
  for (const modus of ['arena_space', 'arena_away', 'arena_graben']) {
    const { g, cs } = spiel(modus);
    for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
    ok(g.phase === 'play' && !!g.arena && g.arena.kind !== M, modus + ': Partie läuft (arena.kind ' + (g.arena && g.arena.kind) + ')');   // Grabenangriff läuft intern als arena_away
    ok(g.inventory.marks === g.C.werft.testmarken, modus + ': Marken = C.werft.testmarken (' + g.inventory.marks + ')');
    ok(Werft.status(g).aktiv === true && Werft.status(g).test === true, modus + ': Werft aktiv als Testumgebung');
  }
});

section('Marken ohne A1 (c)', () => {
  ok(CONFIG.werft.testmarken === 5000, 'CONFIG.werft.testmarken vorhanden');
});

console.log('\n' + (fails ? fails + ' Fehler' : 'alle ok'));
process.exit(fails ? 1 : 0);
