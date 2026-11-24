'use strict';
// BOT-02 B1 Nacharbeit: Hash dreier reiner Menschenpartien (Snapshots, Nachrichten, Zufallsstand, Spieler) eines Baums.
//   node tools/mess-bot02-menschenpartie.js [Wurzel]     Wurzel = Verzeichnis mit server/ (Standard: dieses Repo); Ausgabe eine Zeile JSON { hash, snapshots, errors }
// tools/test-bot02-bord.js Abschnitt 8 ruft es fuer diesen Stand und fuer einen mit git archive entpackten Basisbaum (73f93ed0) und vergleicht. Das Skript ist baumunabhaengig: es laedt nur server/ der Wurzel.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const wurzel = path.resolve(process.argv[2] || path.join(__dirname, '..'));
process.chdir(wurzel);
const { Game } = require(path.join(wurzel, 'server', 'game.js'));
const interior = require(path.join(wurzel, 'server', 'sim', 'interior.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-bot02hash-'));
const h = crypto.createHash('sha1'); let nSnap = 0, fehler = 0;
const oR = Math.random, oN = Date.now; let r = 12345; let tt = 1.7e12;
Math.random = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
Date.now = () => (tt += 16);
let seq = 0;
try {
  for (const [start, seed, menschen] of [['arena_space', 5, 2], ['m3', 6, 2], ['arena_space', 9, 3]]) {
    const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
    const g = new Game({ noStore: true, seed, worldDir: dir, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
    const cs = []; for (let i = 0; i < menschen; i++) { const c = { send: (o) => h.update(JSON.stringify(o)), sendRaw: (s) => h.update(s) }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'M' + i, color: i }); cs.push(c); }
    g.lobbyOpts.startMission = start;
    for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
    for (let i = 0; i < 900; i++) {
      if (i === 100) interior.enterConsole(g, cs[0].player, 'transfer');
      if (i === 300) cs[1].player.zone = 'away';
      if (i === 500) g.handleMessage(cs[0], { t: 'leave' });
      if (i === 700) interior.placeOnShipPad(g, cs[1].player);
      g.step();
      if (g.wantsSnapshot()) { h.update(JSON.stringify(g.snapshot())); nSnap++; }
    }
    fehler += g.errors;
    h.update(JSON.stringify([g.errors, g.time, g.rng(), g.players.map((p) => [p.x, p.y, p.console, p.station, p.zone])]));
  }
} finally { Math.random = oR; Date.now = oN; }
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(JSON.stringify({ hash: h.digest('hex'), snapshots: nSnap, errors: fehler }));
