'use strict';
// Rennen (Kai 2026-10-15): Shift = 33 % schneller laufen (CONFIG.player.runFactor), geduckt nicht.   node tools/test-rennen.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Game } = require('../server/game.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-rennen-'));
const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(dir, 'r') }, log: () => {} });
const conns = [];
for (let i = 0; i < 2; i++) {
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'R' + i, name: 'R' + i, color: i }); conns.push(c);
}
for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
run(0.5);
const [a, b] = g.players;
const T = (x, y) => ({ x: x * 32 + 16, y: y * 32 + 16 });
// Brücke Deck I, freie Reihen 5 und 7 (x 26–35)
const pa = T(26, 5), pb = T(26, 7);
a.x = pa.x; a.y = pa.y; b.x = pb.x; b.y = pb.y;

console.log('Rennen');
g.handleMessage(conns[0], { t: 'input', seq: 1, mx: 1, my: 0 });
g.handleMessage(conns[1], { t: 'input', seq: 1, mx: 1, my: 0, run: 1 });
run(1);
const da = a.x - pa.x, db = b.x - pb.x;
ok(da > 60, 'Gehen bewegt sich (' + Math.round(da) + ' px/s)');
const f = db / da, soll = g.C.player.runFactor;
ok(Math.abs(f - soll) < 0.04, 'Rennen ist ' + Math.round((f - 1) * 100) + ' % schneller (Soll ' + Math.round((soll - 1) * 100) + ' %)');
g.handleMessage(conns[1], { t: 'input', seq: 2, mx: 0, my: 0, run: 1 });
const bx = b.x; run(0.3);
ok(Math.abs(b.x - bx) < 0.01, 'Shift allein bewegt nicht');
g.handleMessage(conns[1], { t: 'input', seq: 3, mx: -1, my: 0 });
ok(b.input.run === false, 'ohne Shift wird wieder gegangen');

console.log(fails ? `\n${fails}/${n} FEHLER` : `\ntest-rennen: ${n}/${n} ok`);
process.exit(fails ? 1 : 0);
