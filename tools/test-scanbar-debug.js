'use strict';
// SCA-01 P4: Debug `scanfertig` (server/sim/scanbar.js debugScanfertig). Wirkt wie ein vollendeter Scan (derselbe Hook wie der echte Scan), nur mit Server --debug, nur am Boden, Stufe 0..3 (Standard 3).
//   node tools/test-scanbar-debug.js
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const R = CONFIG.scanner.reichweite;

function szene(debug, amBoden) {
  const g = new Game({ noStore: true, seed: 11, debug, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(x) { this.inbox.push(x); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'D0', name: 'Dbg', color: 0 });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  if (amBoden) { g.setAwayMap('kesh'); g.aways.kesh.active = true; const p = g.players[0]; interior.placeOnAwayPad(g, p, 0); combat.onArrive(g, p); }
  const notes = [];
  const n0 = g.notice.bind(g); g.notice = (p, t) => { notes.push(t); return n0(p, t); };
  const dbg = (cmd, extra) => g.handleMessage(c, Object.assign({ t: 'debug', cmd }, extra || {}));
  return { g, p: g.players[0], dbg, notes };
}

console.log('\nscanfertig');
ok(Protocol.DEBUG_CMDS.includes('scanfertig'), 'scanfertig ist ein Debug-Kommando');
{
  const S = szene(true, true); S.dbg('scantest'); S.dbg('scanfertig', { stufe: 1 });
  const sc = S.g.snapshot().away.sc;
  ok(sc && sc.length === 3 && sc.every((e) => e.length === 4 && e[3] === 1), 'Stufe 1: drei Einträge ohne Position');
  S.dbg('scanfertig');
  const s3 = S.g.snapshot().away.sc.find((e) => e[0] === 'tz1');
  ok(s3.length === 6 && s3[3] === 3 && s3[4] === Math.round(S.p.x + R * 0.3), 'Standard ohne Stufe = 3, mit Position (sk steigt)');
  ok(S.g.snapshot().away.sc.length === 3 && !JSON.stringify(S.g.snapshot().away.sc).includes('tz4'), 'außerhalb der Reichweite nichts');
}
{
  const S = szene(true, true); S.dbg('scantest'); S.dbg('scanfertig', { stufe: 0 });
  ok(S.g.away.sc === undefined && /Rauschen/.test(S.notes[S.notes.length - 1]), 'Stufe 0: Rauschen, nichts gesetzt (gleiche Wirkung wie der echte Scan)');
  S.dbg('scanfertig', { stufe: 7 });
  ok(S.g.away.sc === undefined && /0\.\.3/.test(S.notes[S.notes.length - 1]), 'Stufe 7 abgelehnt');
}
{
  const S = szene(true, true); S.dbg('scantest'); S.dbg('scanfertig', { args: '2' });
  ok(S.g.away.sc && S.g.away.sc['test:tz1'].sk === 2, 'Stufe auch als Argument (args)');
}
{
  const S = szene(false, true); S.dbg('scantest'); S.dbg('scanfertig', { stufe: 3 });
  ok(S.g.away.sc === undefined, 'ohne --debug wirkungslos');
}
{
  const S = szene(true, false); S.dbg('scanfertig', { stufe: 3 });
  ok(S.g.away === undefined || S.g.away === null || S.g.away.sc === undefined, 'nicht am Boden: keine Wirkung');
  ok(/nur am Boden/.test(S.notes[S.notes.length - 1] || ''), 'nicht am Boden: Hinweistext');
}
console.log(fails ? '\n' + fails + ' FEHLER' : '\nalles ok');
process.exit(fails ? 1 : 0);
