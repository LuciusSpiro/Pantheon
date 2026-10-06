'use strict';
// Echtbetrieb-Smoke-Test: Server auf freiem Port starten, per WebSocket verbinden, Lobby -> Spiel,
// Snapshot-Größe messen, Reconnect und "Server voll" prüfen, statische Auslieferung + Traversal-Schutz testen.
//   node tools/ws-smoke.js
const http = require('http');
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');

let fails = 0;
const ok = (c, t) => { console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(port, path) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', () => resolve(0)); req.end();
  });
}

const CODE = 'T3ST';
function client(port, hello, noHello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, msgs: [], snaps: [], sizes: [], welcome: null, full: null, errors: [] };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'snap') { c.snaps.push(m); c.sizes.push(Buffer.byteLength(s)); if (c.snaps.length > 5) c.snaps.shift(); }
      else c.msgs.push(m);
      if (m.t === 'welcome') c.welcome = m;
      if (m.t === 'full') c.full = m;
      if (m.t === 'error') c.errors.push(m);
    });
    ws.on('open', () => { if (!noHello) ws.send(JSON.stringify(Object.assign({ t: 'hello', code: CODE }, hello))); resolve(c); });
  });
}

(async () => {
  // Testserver-Port des Teams TOOLS (CONTRACT-M3 §1.3); Port 3300 gehört dem Spielbetrieb. PORT=0 -> freier Port.
  const srv = await startServer({ port: process.env.PORT != null ? Number(process.env.PORT) : 3323, quiet: true, noStore: true, debug: true, roomCode: CODE });
  const port = srv.port;
  console.log(`Server auf Port ${port}`);
  ok(await get(port, '/shared/config.js') === 200, 'GET /shared/config.js -> 200');
  ok(await get(port, '/shared/maps.js') === 200, 'GET /shared/maps.js -> 200');
  const trav = [await get(port, '/../package.json'), await get(port, '/%2e%2e/package.json'), await get(port, '/shared/..%2f..%2fpackage.json'), await get(port, '/shared/%2e%2e/server/game.js')];
  ok(trav.every((s) => s === 403 || s === 404), 'Traversal blockiert (' + trav.join(',') + ')');

  // M0: Raumcode – ohne hello keine Snapshots, falscher/fehlender Code -> badcode, Verbindung bleibt offen
  const x = await client(port, null, true);
  await sleep(400);
  ok(x.snaps.length === 0, 'ohne hello keine Snapshots (' + x.snaps.length + ')');
  x.ws.send(JSON.stringify({ t: 'hello', clientId: 'X', name: 'Xaver', color: 2 }));
  await sleep(200);
  ok(x.errors.some((m) => m.code === 'badcode') && !x.welcome && x.ws.readyState === 1, 'hello ohne Code -> badcode, Verbindung offen');
  x.ws.send(JSON.stringify({ t: 'hello', clientId: 'X', name: 'Xaver', color: 2, code: 'ZZZZ' }));
  await sleep(200);
  ok(x.errors.length >= 2 && !x.welcome && x.snaps.length === 0, 'falscher Code -> badcode, kein Spieler, keine Snapshots');
  x.ws.send(JSON.stringify({ t: 'hello', clientId: 'X', name: 'Xaver', color: 2, code: CODE.toLowerCase() }));
  await sleep(300);
  ok(!!x.welcome && x.welcome.roomCode === CODE && x.snaps.length > 0, 'richtiger Code (Kleinschreibung) -> welcome mit roomCode + Snapshots');
  x.ws.close();
  await sleep(300);
  ok(srv.game.players.length === 0, 'Lobby-Spieler nach Trennen entfernt');

  const a = await client(port, { clientId: 'A', name: 'Ada', color: 0 });
  const b = await client(port, { clientId: 'B', name: 'Bo', color: 0 });
  const c = await client(port, { clientId: 'C', name: 'Cem', color: null });
  await sleep(300);
  ok(a.welcome && b.welcome && c.welcome, 'drei welcome erhalten');
  const s0 = a.snaps[a.snaps.length - 1];
  ok(s0 && s0.phase === 'lobby', 'Lobby-Snapshot');
  const colors = s0.players.map((p) => p.color).sort();
  ok(JSON.stringify(colors) === '[0,1,2]', 'Farben eindeutig vergeben ' + JSON.stringify(colors));
  const d = await client(port, { clientId: 'D', name: 'Dora', color: 1 });
  await sleep(200);
  ok(!!d.full, '4. Spieler bekommt "full": ' + (d.full && d.full.text));

  for (const x of [a, b, c]) x.ws.send(JSON.stringify({ t: 'ready', ready: true }));
  await sleep(500);
  ok(a.snaps[a.snaps.length - 1].phase === 'play', 'Spiel gestartet');
  // Snapshot-Rate messen
  a.sizes = [];
  await sleep(2000);
  ok(a.sizes.length >= 26 && a.sizes.length <= 34, `Snapshot-Rate ~15 Hz (${a.sizes.length} in 2 s)`);
  // In die Route (Asteroiden) springen und Größe messen (Debug-Befehl nur für diese Messung)
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'stage', stage: 'route' }));
  await sleep(300);
  a.sizes = [];
  await sleep(2500);
  const maxR = Math.max(...a.sizes), avgR = Math.round(a.sizes.reduce((s, v) => s + v, 0) / a.sizes.length);
  console.log(`  Route: Snapshot max ${maxR} B, Ø ${avgR} B`);
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'stage', stage: 'combat' }));
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'spawn', kind: 'gunboat' }));
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'fire' })); a.ws.send(JSON.stringify({ t: 'debug', cmd: 'fire' })); a.ws.send(JSON.stringify({ t: 'debug', cmd: 'breach' }));
  await sleep(300);
  a.sizes = [];
  await sleep(2500);
  const maxC = Math.max(...a.sizes), avgC = Math.round(a.sizes.reduce((s, v) => s + v, 0) / a.sizes.length);
  console.log(`  Kampf: Snapshot max ${maxC} B, Ø ${avgC} B`);
  // M1: Relais-Kampf (Pylonen + Wächter) und Snapshot-Felder
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'mission', id: 'm2', step: 'relay' }));
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'spawn', kind: 'sentinel' }));
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'scanall' }));
  await sleep(300);
  a.sizes = []; a.snaps.length = 0;
  let sawWorld = false, sawLog = false;
  const seen = (m) => { if (m.world && m.world.locations) sawWorld = true; if (m.mission && m.mission.log) sawLog = true; };
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) { await sleep(50); a.snaps.forEach(seen); }
  const maxM = Math.max(...a.sizes), avgM = Math.round(a.sizes.reduce((s, v) => s + v, 0) / a.sizes.length);
  console.log(`  Relais (M1): Snapshot max ${maxM} B, Ø ${avgM} B`);
  const sl = a.snaps[a.snaps.length - 1];
  ok(sl.world.location === 'relais' && sl.space.enemies.some((e) => e.kind === 'pylon' && e.scanned && e.weapons), 'M1: Ort relais, Pylonen gescannt mit Feuerbögen');
  ok(sawWorld && sawLog, 'M1: world.locations und mission.log kommen regelmäßig (alle ≤ 1 s)');
  ok(['reactor', 'markers', 'tscan', 'widescan', 'dockedAt'].every((k) => k in sl.ship) && 'plan' in sl && 'quarters' in sl, 'M1: Snapshot-Felder ship.reactor/markers/tscan/widescan, plan, quarters');
  // M3a §9.3: neue Snapshot-Felder kommen über das Netz an
  const sh3 = sl.ship;
  ok(['turnVel', 'turnCap', 'fragile', 'repairQueue', 'botAuto', 'chargePoints'].every((k) => k in sh3) && 'cap' in sh3.shields && 'burstCd' in sh3.shields,
    'M3a: ship.turnVel/turnCap/fragile/repairQueue/botAuto/chargePoints, shields.cap/burstCd');
  ok(sh3.mounts.map((m) => m.id).slice(0, 3).join() === 'bow,port,stbd' && 'battery_port' in sh3.systems && 'weapons' in sh3.systems, 'M3a: mounts bow/port/stbd, 15 Systemeinträge inkl. Altname weapons');
  // M3a: Ladung im Netz (Debug tele) und Schildstoß
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'spawn', kind: 'gunboat' }));
  await sleep(200);
  const gbId = a.snaps[a.snaps.length - 1].space.enemies.filter((e) => e.kind === 'gunboat').map((e) => e.id).pop();
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'tele', id: gbId }));
  a.ws.send(JSON.stringify({ t: 'debug', cmd: 'burst', sector: 1 }));
  await sleep(300);
  const sTele = a.snaps[a.snaps.length - 1];
  const teleE = sTele.space.enemies.find((e) => e.id === gbId);
  ok(teleE && teleE.tele && teleE.tele.kind && a.msgs.some((m) => m.t === 'event' && m.kind === 'tele'), 'M3a: enemies[].tele und Ereignis tele über das Netz');
  ok(sTele.ship.shields.burst && sTele.ship.shields.burst.sector === 1, 'M3a: shields.burst über das Netz');
  ok(Math.max(maxR, maxC, maxM) < 12 * 1024, 'Snapshot < 12 KB');

  // Reconnect: A trennt, verbindet mit gleicher clientId neu
  const pidA = a.welcome.pid;
  a.ws.close();
  await sleep(300);
  const sNow = b.snaps[b.snaps.length - 1];
  ok(sNow.players.find((p) => p.id === pidA).connected === false, 'A als getrennt markiert');
  const bad = await client(port, { clientId: 'A', name: 'Ada', color: 0, code: 'NOPE' });
  await sleep(250);
  ok(!bad.welcome && bad.errors.some((m) => m.code === 'badcode'), 'Reconnect ohne gültigen Code abgelehnt');
  bad.ws.close();
  const a2 = await client(port, { clientId: 'A', name: 'Ada', color: 0 });
  await sleep(300);
  ok(a2.welcome && a2.welcome.pid === pidA, 'Reconnect liefert denselben Spieler ' + (a2.welcome && a2.welcome.pid));
  const last = a2.snaps[a2.snaps.length - 1];
  ok(last.errors === 0, 'Server-Fehlerzähler 0 (' + last.errors + ')');
  // Ping
  a2.ws.send(JSON.stringify({ t: 'ping', ts: 123 }));
  await sleep(150);
  ok(a2.msgs.some((m) => m.t === 'pong' && m.ts === 123), 'pong');

  for (const x of [a2, b, c, d]) try { x.ws.close(); } catch (e) { /* egal */ }
  await srv.close();
  console.log(fails ? `\n${fails} FEHLER` : '\nWS-SMOKE OK');
  process.exit(fails ? 1 : 0);
})();
