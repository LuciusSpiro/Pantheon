'use strict';
// FRE-01 B: Lobby-Option „Live-Spielleiter“ (lobbyOpt { liveSpielleiter: bool }). Geprueft am echten Game ueber den echten Nachrichtenweg, ohne echten Aufruf:
// Default false · Umschalten nur in der Lobby, nur boolean, nur Modus freie_fahrt mit neuer Welt, durch jeden Mitspieler · Moduswechsel und gewaehlter Weltstand setzen zurueck ·
// Snapshot-Feld nur in der Lobby der Freien Fahrt (nie im Spiel) · Start mit Option an = wirksames Env live (process.env unveraendert, Kindprozess-Spion) ·
// Start mit Option aus = Rueckfall-Betrieb ohne Modell · zurLobby setzt die Option zurueck · Fortsetzen nie live.
// Aufruf: node tools/test-lobby-livespielleiter.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
process.chdir(path.join(__dirname, '..'));

const prozesse = [];
for (const k of ['spawn', 'spawnSync', 'exec', 'execFile', 'execSync', 'execFileSync', 'fork']) {
  cp[k] = function (...a) { prozesse.push(k + ' ' + String(a[0])); throw new Error('Test: Kindprozess verboten (' + k + ')'); };
}
delete process.env.LLM_LIVE;
const ENV_VOR = JSON.stringify(Object.assign({}, process.env));

const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fre01b-'));
let seq = 0;
function bauGame(extra) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const env = { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(dir, 'regie') };
  const g = new Game(Object.assign({ szenarioSchalter: true, noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env, log: () => {} }, extra || {}));
  const verbinde = (id, name, color) => { const c = { inbox: [], send() {}, sendRaw() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: id, name, color }); return c; };
  g.conn = verbinde('FF0', 'Kai', 0); g.conn2 = verbinde('FF1', 'Gast', 1);
  g.dir = dir;
  return g;
}
const opt = (g, m, c) => g.handleMessage(c || g.conn, Object.assign({ t: 'lobbyOpt' }, m));
const lobby = (g) => g.snapshot().lobby;
const alleBereit = (g) => { g.handleMessage(g.conn, { t: 'ready', ready: true }); g.handleMessage(g.conn2, { t: 'ready', ready: true }); };

console.log('Default und Umschalten');
{
  const g = bauGame();
  ok(g.lobbyOpts.liveSpielleiter === false, 'Default: false');
  ok(!('liveSpielleiter' in lobby(g)), 'Modus m1: kein Feld im Lobby-Snapshot');
  opt(g, { liveSpielleiter: true });
  ok(g.lobbyOpts.liveSpielleiter === false, 'Modus m1: Nachricht wirkt nicht');
  opt(g, { startMission: 'freie_fahrt' });
  ok(lobby(g).liveSpielleiter === false, 'freie_fahrt: Snapshot-Feld da, false');
  for (const v of ['true', 1, null, undefined, {}, 'an']) opt(g, { liveSpielleiter: v });
  ok(g.lobbyOpts.liveSpielleiter === false, 'nur boolean wirkt: String, Zahl, null, Objekt ignoriert');
  opt(g, { liveSpielleiter: true }, g.conn2);
  ok(g.lobbyOpts.liveSpielleiter === true && lobby(g).liveSpielleiter === true, 'ein Mitspieler (nicht der Gastgeber) schaltet an');
  opt(g, { liveSpielleiter: false });
  ok(g.lobbyOpts.liveSpielleiter === false, 'der Gastgeber schaltet aus');
  opt(g, { startMission: 'freie_fahrt', liveSpielleiter: true });
  ok(g.lobbyOpts.liveSpielleiter === true, 'Sammelnachricht (Modus gleich + Option) wirkt');
  opt(g, { startMission: 'm1', liveSpielleiter: true });
  ok(g.lobbyOpts.liveSpielleiter === false && !('liveSpielleiter' in lobby(g)), 'Sammelnachricht mit Moduswechsel: Option bleibt aus, Feld weg');
}

console.log('Moduswechsel setzt zurueck');
{
  const g = bauGame();
  opt(g, { startMission: 'freie_fahrt' }); opt(g, { liveSpielleiter: true });
  opt(g, { startMission: 'eisenwald' });
  ok(g.lobbyOpts.liveSpielleiter === false, 'Wechsel weg von freie_fahrt: false');
  opt(g, { startMission: 'freie_fahrt' });
  ok(g.lobbyOpts.liveSpielleiter === false && lobby(g).liveSpielleiter === false, 'zurueck nach freie_fahrt: weiter aus (bewusst neu einschalten)');
}

console.log('Weltstand gewaehlt setzt zurueck, Fortsetzen nie live');
{
  const g = bauGame();
  opt(g, { startMission: 'freie_fahrt' }); alleBereit(g);
  for (let k = 0; k < 30; k++) g.step();
  ok(g.phase === 'play' && Weltstand.save(g).ok, 'Vorbereitung: Freie Fahrt gestartet, Weltstand gespeichert');
  g.zurLobby();
  g.refreshWorldList();
  const id = (g.worldList.find((w) => w.state === 'ok') || {}).id;
  ok(!!id, 'Weltstand in der Liste');
  opt(g, { world: null }); opt(g, { startMission: 'freie_fahrt' }); opt(g, { liveSpielleiter: true });
  ok(g.lobbyOpts.liveSpielleiter === true, 'neue Welt: an');
  opt(g, { world: id });
  ok(g.lobbyOpts.world === id && g.lobbyOpts.liveSpielleiter === false, 'Weltstand gewaehlt: Option aus');
  opt(g, { liveSpielleiter: true });
  ok(g.lobbyOpts.liveSpielleiter === false, 'mit gewaehltem Weltstand wirkt die Nachricht nicht');
  alleBereit(g);
  for (let k = 0; k < 30; k++) g.step();
  ok(g.phase === 'play' && g.env.SPIELLEITER_LLM !== 'live' && g.env.LLM_LIVE === undefined, 'Fortsetzen: nicht live (' + g.env.SPIELLEITER_LLM + ')');
  g.zurLobby();
}

console.log('Snapshot im Spiel unveraendert');
{
  const g = bauGame();
  opt(g, { startMission: 'freie_fahrt' }); opt(g, { liveSpielleiter: true }); alleBereit(g);
  for (let k = 0; k < 5; k++) g.step();
  const l = g.snapshot().lobby;
  ok(g.phase === 'play' && !('liveSpielleiter' in l) && Object.keys(l).sort().join() === 'skipDrill,startMission', 'im Spiel nur skipDrill und startMission (' + Object.keys(l).join() + ')');
  g.zurLobby();
}

console.log('Start mit Option an: wirksames Env live, kein echter Aufruf');
{
  const g = bauGame();
  opt(g, { startMission: 'freie_fahrt' }); opt(g, { liveSpielleiter: true }); alleBereit(g);
  for (let k = 0; k < 5; k++) g.step();
  ok(g.env.SPIELLEITER_LLM === 'live' && g.env.LLM_LIVE === '1', 'game.env: SPIELLEITER_LLM=live, LLM_LIVE=1');
  ok(g.envBasis.LLM_LIVE === undefined && process.env.LLM_LIVE === undefined && JSON.stringify(Object.assign({}, process.env)) === ENV_VOR, 'Basis-Env und process.env unveraendert');
  ok(g.lageSpielleiter && g.lageSpielleiter.mode === 'live' && !g.lageSpielleiter.rueckfallBetrieb, 'Lage-Spielleiter im Modus live');
  ok(prozesse.length === 0, 'kein Kindprozess (kein echter Aufruf)');
  g.zurLobby();
  ok(g.env === g.envBasis && g.lobbyOpts.liveSpielleiter === false && lobby(g).liveSpielleiter === false, 'zurLobby: Basis-Env, Option aus (Lobby bleibt auf freie_fahrt)');
}

console.log('Start mit Option aus: Rueckfall-Betrieb ohne Modell');
{
  const g = bauGame();
  opt(g, { startMission: 'freie_fahrt' }); alleBereit(g);
  for (let k = 0; k < 5; k++) g.step();
  ok(g.env.SPIELLEITER_LLM === undefined && g.env.LLM_LIVE === undefined && g.env.SPIELLEITER_RUECKFALL === '1', 'game.env: kein SPIELLEITER_LLM, kein LLM_LIVE, SPIELLEITER_RUECKFALL=1');
  ok(g.lageSpielleiter && g.lageSpielleiter.mode === 'off' && g.lageSpielleiter.rueckfallBetrieb === true, 'Lage-Spielleiter mode off, rueckfallBetrieb');
  ok(prozesse.length === 0 && process.env.LLM_LIVE === undefined, 'kein Kindprozess, process.env.LLM_LIVE ungesetzt');
  g.zurLobby();
}

console.log('W1: Leerlauf-Reset loescht die Kostenentscheidung');
{
  const g = bauGame();
  opt(g, { startMission: 'freie_fahrt' }); opt(g, { liveSpielleiter: true }); alleBereit(g);
  for (let k = 0; k < 5; k++) g.step();
  ok(g.phase === 'play' && g.env.LLM_LIVE === '1', 'Vorbereitung: live gestartet');
  g.removeConnection(g.conn); g.removeConnection(g.conn2);
  for (let k = 0; k < Math.ceil((g.C.net.emptyResetAfter + 2) * 30) && g.players.length; k++) g.step();
  ok(g.phase === 'lobby' && g.players.length === 0, 'Alle weg: Partie zurueckgesetzt, Spielerliste leer (' + g.phase + ')');
  ok(g.lobbyOpts.liveSpielleiter === false, 'Option nach dem Leerlauf-Reset aus');
  const neu = { inbox: [], send() {}, sendRaw() {} }; g.addConnection(neu); g.handleMessage(neu, { t: 'hello', clientId: 'NEU', name: 'Neu', color: 2 });
  opt(g, { startMission: 'freie_fahrt' }, neu);
  g.handleMessage(neu, { t: 'ready', ready: true });
  for (let k = 0; k < 5; k++) g.step();
  ok(g.phase === 'play' && g.env.LLM_LIVE === undefined && g.env.SPIELLEITER_LLM === undefined && g.env.SPIELLEITER_RUECKFALL === '1', 'neue Gruppe startet im Rueckfall-Betrieb, kein LLM_LIVE');
  ok(g.lageSpielleiter && g.lageSpielleiter.mode === 'off' && prozesse.length === 0, 'Lage-Spielleiter mode off, kein Kindprozess');
  g.zurLobby();
}

console.log('W1: alle trennen in der Lobby loescht die Kostenentscheidung');
{
  const g = bauGame();
  opt(g, { startMission: 'freie_fahrt' }); opt(g, { liveSpielleiter: true });
  g.removeConnection(g.conn); g.removeConnection(g.conn2);
  ok(g.players.length === 0 && g.lobbyOpts.liveSpielleiter === false, 'Lobby leer: Option aus');
}

ok(JSON.stringify(Object.assign({}, process.env)) === ENV_VOR, 'process.env am Ende unveraendert');
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* Temp */ }
console.log('\n' + (n - fails) + ' von ' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
