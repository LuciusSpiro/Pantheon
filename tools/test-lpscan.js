'use strict';
// SL7b (CONCEPT-SL7 §7b): Landepunkt per Scan. Ops scannt vom Orbit, erst dann liegt die Karte des Landepunkts auf dem Planungstisch
// (Pin möglich, Karte an die Clients, Orts-Snapshot lp, Weltstand), Captain-Außenkarte unverändert (erst nach dem Beamen).
//   node tools/test-lpscan.js
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Lpscan = require('../server/sim/lpscan.js');
const Registry = require('../server/mission/registry.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

function setup(np) {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 1500) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'L' + i, name: 'Lp' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  g.god = true;
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  const T = { g, cs, c: cs[0], run };
  T.cmd = (cmd, f, c) => { const cc = c || cs[0]; cc.inbox.length = 0; g.handleMessage(cc, Object.assign({ t: 'cmd', c: cmd }, f || {})); return cc.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.ops = () => { g.players[0].console = 'weapons'; };
  return T;
}

section('Landepunkt-Scan: Ablauf', () => {
  const T = setup(2); const g = T.g;
  space.enterScene(g, 'methalle', {}); T.run(0.2);
  const lpId = 'methalle.siedlung';
  ok(!Lpscan.gescannt(g, lpId) && g.explore.lpScan.size === 0, 'zu Beginn nicht gescannt');
  g.ship.x = 100; g.ship.y = 100; T.run(0.2);
  ok(g.snapshot().lpscan === undefined, 'weit weg: kein lpscan im Snapshot');
  T.ops(); g.explore.known.add('methalle'); g.explore.version++;
  ok(T.cmd('weapons.landescan').length === 1, 'außerhalb der Scanreichweite: Fehlermeldung');
  g.ship.x = 1349 - 400; g.ship.y = 928; g.ship.vx = 0; g.ship.vy = 0; T.run(0.2);
  const s0 = g.snapshot();
  ok(s0.lpscan && s0.lpscan.n === 1 && s0.lpscan.p === undefined, 'in Reichweite: Snapshot lpscan { n: 1 }');
  g.players[0].console = 'plan';
  const pre = T.cmd('plan.pin', { label: 'ziel', map: lpId, x: 800, y: 800 });
  ok(pre.length === 1, 'vor dem Scan: Pin auf der Landekarte abgelehnt (' + pre[0] + ')');
  T.ops();
  ok(T.cmd('weapons.landescan').length === 0 && g.lpscan, 'Scan startet (Halteprozess)');
  T.run(2);
  ok(g.snapshot().lpscan.p > 0.3 && g.snapshot().lpscan.p < 0.7, 'Fortschritt im Snapshot (' + g.snapshot().lpscan.p + ')');
  T.run(2.4);
  ok(!g.lpscan && Lpscan.gescannt(g, lpId) && g.explore.lpScan.has(lpId), 'nach 4 s: gescannt');
  ok(g.snapshot().lpscan === undefined, 'danach nichts mehr zu scannen: lpscan weg');
  const evs = T.c.inbox.filter((m) => m.kind === 'awayMap');
  const ev2 = T.cs[1].inbox.filter((m) => m.kind === 'awayMap');
  ok(evs.length >= 1 && ev2.length >= 1 && evs[0].id === lpId, 'Karte ging als awayMap an BEIDE Spieler (Planungstisch), ' + evs.length + '/' + ev2.length);
  const loc = g.explore.locationsSnapshot().find((l) => l.id === 'methalle');
  ok(loc && loc.lp && loc.lp[0].id === lpId && loc.lp[0].name, 'Orts-Snapshot trägt lp: ' + JSON.stringify(loc && loc.lp));
  g.players[0].console = 'plan';
  const post = T.cmd('plan.pin', { label: 'ziel', map: lpId, x: 800, y: 800 });
  ok(post.length === 0 && g.plan.pins.some((q) => q.map === lpId), 'nach dem Scan: Pin auf der Landekarte möglich');
  ok(g.plan.pins.find((q) => q.map === lpId).x === 800, 'Pin liegt in Kartenkoordinaten');
  ok(g.snapshot().away === undefined || !g.snapshot().away.active, 'Captain: keine aktive Außenmission, Außenkarte erst nach dem Beamen');
  // Weltstand
  const save = g.explore.toSave ? g.explore.toSave() : null;
  const sv = save || {};
  ok(JSON.stringify(sv.karten || []).includes(lpId), 'Weltstand karten enthält den Landepunkt');
  const g2 = setup().g;
  g2.explore.restore ? g2.explore.restore(JSON.parse(JSON.stringify(sv))) : null;
  ok(g2.explore.lpScan.has(lpId) && !('methalle.siedlung' in g2.explore.mapsKnown), 'Laden: Landepunkt bleibt gescannt, mapsKnown unverändert');
  // Bausteine
  const m = { game: g };
  ok(!!Registry.get('landepunkt_gescannt') && !!Registry.get('landepunkt_scannen'), 'Registry kennt landepunkt_gescannt/landepunkt_scannen');
  ok(Registry.get('landepunkt_gescannt').test(m, { lp: lpId }) && !Registry.get('landepunkt_gescannt').test(m, { lp: 'eisenwald.siedlung' }), 'Prüfung landepunkt_gescannt');
  Registry.get('landepunkt_scannen').run(m, { lp: 'eisenwald.siedlung' });
  ok(Lpscan.gescannt(g, 'eisenwald.siedlung'), 'Aktion landepunkt_scannen setzt das Flag');
  ok(Lpscan.markieren(g, lpId) === false, 'doppelt markieren: false');
});

section('Landepunkt-Scan: Abbruch und Sonderfälle', () => {
  const T = setup(); const g = T.g;
  space.enterScene(g, 'methalle', {}); T.run(0.2);
  g.ship.x = 1349 - 300; g.ship.y = 928; T.run(0.2);
  T.ops();
  T.cmd('weapons.landescan'); T.run(1);
  g.ship.x = 100; g.ship.y = 100; T.run(0.3);
  ok(!g.lpscan && !Lpscan.gescannt(g, 'methalle.siedlung'), 'Reichweite verlassen: Scan abgebrochen, nichts gescannt');
  g.ship.x = 1349 - 300; g.ship.y = 928; T.run(0.2);
  T.cmd('weapons.landescan'); T.run(1);
  g.players[0].console = 'helm'; T.run(0.3);
  ok(!g.lpscan && !Lpscan.gescannt(g, 'methalle.siedlung'), 'Ops verlässt die Konsole: Scan abgebrochen');
  T.ops(); T.cmd('weapons.landescan'); T.cmd('weapons.landescan', { off: true });
  ok(!g.lpscan, 'Scan mit off abbrechen');
  T.cmd('weapons.landescan'); T.run(4.3);
  ok(Lpscan.gescannt(g, 'methalle.siedlung') && T.cmd('weapons.landescan').length === 1, 'zweiter Scan desselben Landepunkts: nichts mehr zu scannen');
  // Handkarte (mapsKnown) läuft über denselben Weg
  const U = setup(); const h = U.g;
  space.enterScene(h, 'b7', {}); U.run(0.2); h.ship.x = 2000 - 300; h.ship.y = 1500; U.run(0.2); U.ops();
  ok(Lpscan.ziele(h).some((q) => q.id === 'platform') && !h.explore.mapsKnown.platform, 'B-7: Handkarte platform ist scannbar');
  Lpscan.markieren(h, 'platform');
  ok(h.explore.mapsKnown.platform === true && !h.explore.lpScan.has('platform'), 'Handkarte: mapsKnown statt lpScan');
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
