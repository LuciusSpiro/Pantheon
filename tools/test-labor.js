'use strict';
// Szenario-Labor (CONTRACT-W2 §1.4 Nr. 7, AP3a): server/mission/labor.js, Lobby-Modus 'labor', Waffenwahl vor dem Start.
//  - Eine Test-Umsetzung im Fixture-Katalog (tools/fixtures/labor/mod-labor-test, als Mod geladen) erscheint ohne
//    Codeänderung in laborListe und startet.
//  - Jede Umsetzung aus laborListe des echten Katalogs baut mit laborStart fehlerfrei: Start, 30 s Simulation, keine Server-Fehler.
//  - CONFIG.lobby.labor aus: kein Eintrag in der Lobby, der Server lehnt den Start ab.
//  - Lobby-Waffe (lobbyOpt { waffe }) gilt beim Start von Wellen Boden und Labor.
//   node tools/test-labor.js [begriff …]   -> nur Abschnitte, deren Name einen der Begriffe enthält
const path = require('path');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const Katalog = require('../server/mission/katalog.js');
const Labor = require('../server/mission/labor.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const FIXTURE = path.join(__dirname, 'fixtures', 'labor', 'mod-labor-test');
const FIXTURE_ID = 'vernichten/labor_fixture_pylonen';
const SIM_SEK = 30;
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}

// Spiel in der Lobby mit np Spielern (Fake-Verbindungen)
function lobbySpiel(np, seed) {
  const g = new Game({ noStore: true, seed: seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'L' + i, name: 'L' + i, color: i }); cs.push(c);
  }
  return { g, cs };
}
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };

section('Protokoll und Schalter', () => {
  ok(JSON.stringify(Protocol.LOBBY_MODI) === JSON.stringify(['m1', 'free', 'm3', 'arena_away', 'arena_space', 'labor']), 'LOBBY_MODI: Kampagne, ohne Tutorial, m3, Wellen Boden, Wellen All, Labor');
  ok(Protocol.START_LABELS.arena_away === 'Wellen Boden' && Protocol.START_LABELS.arena_space === 'Wellen All' && Protocol.START_LABELS.labor === 'Szenario-Labor', 'Labels Wellen Boden / Wellen All / Szenario-Labor');
  ok(CONFIG.lobby && CONFIG.lobby.labor === true, 'CONFIG.lobby.labor Standard an');
  ok(Labor.an(CONFIG) && !Labor.an({ lobby: { labor: false } }), 'Labor.an folgt dem Schalter');
});

section('laborListe aus dem Katalog (Fixture ohne Codeänderung)', () => {
  const echt = Labor.laborListe();
  const k = Katalog.load({});
  const verf = Object.values(k.molekuele).flatMap((m) => m.umsetzungen.filter((u) => u.status === 'verfuegbar' && u.test && u.test.params).map((u) => m.id + '/' + u.id));
  ok(echt.length === verf.length && verf.every((id) => echt.some((e) => e.id === id)), `echter Katalog: alle ${verf.length} verfügbaren Umsetzungen mit test.params in der Liste`);
  ok(echt.every((e) => e.id && e.name && e.schauplatz && Array.isArray(e.kartenarten)), 'Einträge mit ID, Name, Schauplatz, Kartenarten');
  ok(echt.some((e) => e.schauplatz === 'aussen') && echt.some((e) => e.schauplatz === 'weltraum'), 'Boden und Raum in der Liste');
  ok(!echt.some((e) => e.id === FIXTURE_ID), 'Fixture-Umsetzung nicht im echten Katalog');
  const kf = Katalog.load({ mods: [FIXTURE] });
  ok(!kf.fehler.some((f) => /labor_fixture/.test(f.msg)), 'Fixture besteht den Prüfer');
  const mitF = Labor.laborListe(kf);
  const e = mitF.find((x) => x.id === FIXTURE_ID);
  ok(!!e && e.schauplatz === 'weltraum' && e.name === 'Labor-Fixture: Pylonen am Relais', 'Fixture-Umsetzung erscheint in laborListe (ohne Codeänderung)');
  ok(mitF.length === echt.length + 1, 'genau ein Eintrag mehr');
  // Fixture startet über denselben Einstieg
  const { g } = lobbySpiel(1);
  g.reset(); g.phase = 'play';   // laufende Partie ohne Modus, dann Labor direkt (API statt Lobby, eigener Katalog)
  const r = Labor.laborStart(g, FIXTURE_ID, { seed: 3, katalog: kf });
  ticks(g, 5);
  ok(r.ok && g.mission.activeId === 'bot_lab' && g.ship.scene === 'relais' && g.errors === 0, `laborStart(Fixture) läuft am Relais (${r.fehler || g.mission.step && g.mission.step.id}, Fehler ${g.errors})`);
  // Startzustand (AP4: team_gefangen im enter) -> eigener Eintrag mit Kennzeichen
  ok(Labor.startzustand({ vorlage: { steps: [{ id: 's', enter: [{ do: 'team_gefangen', landepunkt: 'x' }] }] } }) === 'gefangen', 'Startzustand gefangen aus der Vorlage erkannt');
  ok(Labor.startzustand({ vorlage: { steps: [{ id: 's', enter: [{ set: { a: 1 } }] }] } }) === null, 'ohne team_gefangen kein Startzustand');
});

section(`jede Umsetzung aus laborListe startet (Lobby, ${SIM_SEK} s Simulation, keine Server-Fehler)`, () => {
  const liste = Labor.laborListe();
  const schlecht = [];
  for (const e of liste) {
    const { g, cs } = lobbySpiel(1, 11);
    g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'labor', labor: { id: e.id, seed: 5 } });
    g.handleMessage(cs[0], { t: 'ready', ready: true });
    const start = g.phase === 'play' && !!g.labor && g.mission.activeId === 'bot_lab';
    let err = null;
    try { ticks(g, SIM_SEK); } catch (x) { err = x.message; }
    const fehler = Object.keys(g.errorLog || {});
    if (!start || err || g.errors || g.phase !== 'play') schlecht.push(`${e.id}: start ${start} phase ${g.phase} Fehler ${g.errors} ${fehler.join(',')} ${err || ''}`);
  }
  ok(!schlecht.length, `${liste.length - schlecht.length}/${liste.length} Umsetzungen starten und laufen ${SIM_SEK} s ohne Server-Fehler${schlecht.length ? ': ' + schlecht.join(' | ') : ''}`);
});

section('Lobby: Parameter, Snapshot, Seed/Stärke/god', () => {
  const { g, cs } = lobbySpiel(2);
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'labor' });
  let L = g.snapshot().lobby;
  ok(L.startMission === 'labor' && L.laborAn === true && Array.isArray(L.laborListe) && L.laborListe.length === Labor.laborListe().length, 'Modus labor: Liste im Lobby-Snapshot');
  ok(L.labor && L.labor.id === L.laborListe[0].id, 'ohne Wahl: erster Eintrag vorgewählt');
  g.handleMessage(cs[1], { t: 'lobbyOpt', labor: { id: 'stellung_nehmen/trupp_raeumen', seed: 1234, staerke: 'gross', god: true } });
  g.handleMessage(cs[0], { t: 'lobbyOpt', labor: { id: 'gibt/es_nicht', staerke: 'riesig' } });
  L = g.snapshot().lobby;
  ok(L.labor.id === 'stellung_nehmen/trupp_raeumen' && L.labor.seed === 1234 && L.labor.staerke === 'gross' && L.labor.god === true, 'Parameter zusammengeführt, ungültige Werte ignoriert');
  g.handleMessage(cs[0], { t: 'lobbyOpt', waffe: 'lanze' });
  g.handleMessage(cs[1], { t: 'lobbyOpt', waffe: 'kanone' });
  L = g.snapshot().lobby;
  ok(L.waffen && L.waffen[g.players[0].id] === 'lanze' && !L.waffen[g.players[1].id], 'Lobby-Waffe je Spieler (ungültige verworfen)');
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ok(g.phase === 'play' && g.labor && g.seed === 1234 && g.god === true && g.labor.staerke === 'gross', 'Start: Seed, god und Stärke wirken');
  const raw = g.mission.rawBook('bot_lab');
  const besetzen = JSON.stringify(raw).match(/"do":"besetzen"[^}]*"staerke":"(\w+)"/);
  ok(besetzen && besetzen[1] === 'gross', 'Stärke landet in der Besetzung der Szene');
  ok(g.players[0].waffe === 'lanze', 'Lobby-Waffe beim Start gesetzt (Labor)');
  ok(!g.snapshot().lobby || !('laborListe' in g.snapshot().lobby), 'im Spiel keine Labor-Liste im Snapshot');
});

section('Wellen Boden: Lobby-Waffe gilt beim Beamen', () => {
  const { g, cs } = lobbySpiel(3);
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_away', wellen: 'aussenposten' });
  const wahl = ['granatwerfer', 'nahkampf', 'betaeuber'];
  cs.forEach((c, i) => g.handleMessage(c, { t: 'lobbyOpt', waffe: wahl[i] }));
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ticks(g, 3);
  ok(g.players.every((p, i) => p.zone === 'away' && p.waffe === wahl[i]), `alle unten mit ihrer Lobby-Waffe (${g.players.map((p) => p.zone + ':' + p.waffe).join(', ')})`);
  const snap = g.snapshot();
  ok(snap.players.every((p, i) => p.wf === wahl[i]), 'Snapshot wf = gewählte Waffe');
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Schalter aus: kein Eintrag, Start abgelehnt', () => {
  const alt = CONFIG.lobby.labor;
  CONFIG.lobby.labor = false;
  try {
    const { g, cs } = lobbySpiel(1);
    g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'labor' });
    const L = g.snapshot().lobby;
    ok(L.startMission !== 'labor' && L.laborAn === false && !L.laborListe && !L.labor, 'Modus labor nicht wählbar, nicht im Snapshot');
    ok(cs[0].inbox.some((m) => m.t === 'event' && m.kind === 'notice' && /Labor/.test(m.text)), 'Hinweis an den Spieler');
    g.lobbyOpts.startMission = 'labor';   // erzwungen (z. B. alter Stand): Start wird trotzdem abgelehnt
    g.handleMessage(cs[0], { t: 'ready', ready: true });
    ok(g.phase === 'lobby' && !g.labor, 'Start abgelehnt, bleibt in der Lobby');
    const g2 = lobbySpiel(1).g; g2.reset(); g2.phase = 'play';
    const r = Labor.laborStart(g2, 'stellung_nehmen/trupp_raeumen', {});
    ok(r.ok === false && /ausgeschaltet/.test(r.fehler), 'laborStart lehnt ab');
  } finally { CONFIG.lobby.labor = alt; }
});

section('Startfehler führen zurück in die Lobby', () => {
  const { g, cs } = lobbySpiel(1);
  g.lobbyOpts.startMission = 'labor'; g.lobbyOpts.labor.id = 'gibt/es_nicht';
  g.handleMessage(cs[0], { t: 'ready', ready: true });
  ok(g.phase === 'lobby' && cs[0].inbox.some((m) => m.t === 'event' && m.kind === 'notice' && /Labor-Start fehlgeschlagen/.test(m.text)), 'unbekannte Umsetzung: Hinweis, Lobby');
});

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log(`TEST-LABOR: ${fails} FEHLER`); process.exit(1); }
console.log('TEST-LABOR OK');
