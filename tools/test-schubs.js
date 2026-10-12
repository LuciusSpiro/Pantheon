'use strict';
// Schubs (Spieltest 2026-10-12): kein Schaden, 1 s Betäubung, 3 s Abklingzeit, holt Mitspieler von der Konsole.   node tools/test-schubs.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-schubs-'));
const g = new Game({ noStore: true, seed: 3, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(dir, 'r') }, log: () => {} });
const conns = [];
for (let i = 0; i < 3; i++) {
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S' + i, name: 'P' + i, color: i }); conns.push(c);
}
for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
run(0.5);
const [a, b, far] = g.players;
const send = (i) => g.handleMessage(conns[i], { t: 'schubs' });
const T = (x, y) => ({ x: x * 32 + 16, y: y * 32 + 16 });   // Brücke (offene Fläche, Reihe 7)
const pa = T(28, 7), pb = T(29, 7), pf = T(12, 6);
a.x = pa.x; a.y = pa.y; b.x = pb.x; b.y = pb.y; far.x = pf.x; far.y = pf.y;

console.log('Schubs');
interior.enterConsole(g, b, 'helm'); const hp0 = b.hp;
send(0);
ok(b.console === null, 'holt den Mitspieler von der Konsole');
ok(interior.betaeubt(g, b) && g.snapshot ? true : interior.betaeubt(g, b), 'Mitspieler ist betäubt');
ok(b.hp === hp0, 'kein Schaden');
ok(b.x > pb.x, 'kleiner Rückstoß weg vom Schubser');
const bx = b.x; b.input.mx = 1; run(0.5);
ok(b.x === bx, 'betäubt: keine Bewegung');
interior.onAct(g, b, true);
ok(!b.console && !b.hold, 'betäubt: keine Interaktion');
run(0.7);
b.input.mx = 1; run(0.3);
ok(!interior.betaeubt(g, b) && b.x > bx, 'nach 1 s wieder beweglich');
b.input.mx = 0;
// Abklingzeit
a.x = pa.x; a.y = pa.y; b.x = pb.x; b.y = pb.y;
send(0);
ok(!interior.betaeubt(g, b), 'Abklingzeit: zweiter Schubs sofort wirkt nicht');
run(3);
send(0);
ok(interior.betaeubt(g, b), 'nach 3 s wieder möglich');
// Reichweite
run(1.2); a.schubsBereit = 0; far.stunBis = 0;
send(0);
ok(!interior.betaeubt(g, far), 'zu weit weg: nichts passiert');
// auch ohne Treffer ist der Schubs ausgeführt (Abklingzeit)
ok(a.schubsBereit > g.time, 'Fehlschlag löst die Abklingzeit aus');
// Betäubte schubsen nicht, Schubser an der Konsole auch nicht
a.schubsBereit = 0; interior.enterConsole(g, a, 'helm'); b.stunBis = 0; b.x = a.x + 20; b.y = a.y;
send(0);
ok(!interior.betaeubt(g, b), 'Schubser an einer Konsole schubst nicht');

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
