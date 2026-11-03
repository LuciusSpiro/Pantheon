'use strict';
// TEL-01 B2 Nacharbeit (E5): die Tickschleife in server/index.js meldet dem Protokoll die Dauer von Snapshot-Bau + Broadcast, die durch die 250-ms-Kappung verworfene Zeit und die
// nachgeholten Ticks (Haken.snapshotZeit / tickKappung / nachgeholt); die Zeitreihe gibt sie je Fenster aus, dazu die Tick-Zaehler ueber 5, 16 und 33 ms.
// Am ECHTEN Server (WebSocket-Clients, Wanduhr): der Event-Loop wird einmal 600 ms blockiert -> mehr als 250 ms Rueckstand -> Kappung und Nachholen.
//   node tools/test-telemetrie-server.js   (npm run test:telemetrie-server)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-server-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
process.env.TELEMETRIE = 'an'; process.env.TELEMETRIE_DIR = dir; process.env.TELEMETRIE_QUELLE = 'bot';
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ } });
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const { SCHEMA } = require('../server/telemetrie/schema.js');

let fails = 0;
const ok = (c, t) => { console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'TEL1';
const client = (port, hello) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const c = { ws, send: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', () => { /* Snapshots werden nur empfangen */ });
  ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
});

(async () => {
  const srv = await startServer({ port: 0, quiet: true, noStore: true, debug: true, roomCode: CODE });
  const g = srv.game;
  const a = await client(srv.port, { clientId: 'SrvA', name: 'Serverina', color: 0 });
  const b = await client(srv.port, { clientId: 'SrvB', name: 'Servando', color: 1 });
  await sleep(200);
  for (const x of [a, b]) x.send({ t: 'ready', ready: true });
  await sleep(1500);
  console.log('Tickschleife am echten Server');
  ok(g.phase === 'play' && g.telemetrie.offen, 'Spiel laeuft, Protokoll offen (Phase ' + g.phase + ')');
  const t0 = Date.now(); while (Date.now() - t0 < 600) { /* Event-Loop blockieren: 600 ms Stillstand */ }
  await sleep(5500);
  g.telemetrie.sessionBeenden('test');
  const f = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'));
  const z = fs.readFileSync(path.join(dir, f[0]), 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((x) => x.typ === 'zeitreihe');
  const sum = (k) => z.reduce((s, x) => s + (x[k] || 0), 0);
  ok(z.length >= 3, 'Zeitreihenzeilen vorhanden (' + z.length + ')');
  ok(z.every((x) => Object.keys(x).length === 5 + SCHEMA.zeitreihe.felder.length), 'alle Felder des Schemas in jeder Zeile');
  ok(sum('snap_n') >= 30 && z.some((x) => x.snap_med > 0 && x.snap_max >= x.snap_med), 'Snapshot-Zeit gemessen (' + sum('snap_n') + ' Snapshots, Median > 0, Max >= Median)');
  ok(sum('kappung_n') >= 1 && sum('kappung_ticks') >= 3, 'Kappung: ' + sum('kappung_n') + ' Aufruf(e), ' + sum('kappung_ticks').toFixed(1) + ' Ticks verworfen (600 ms Stillstand - 250 ms)');
  ok(sum('nachhol_ticks') >= 5, 'Nachholen: ' + sum('nachhol_ticks') + ' Ticks nach dem ersten im selben Aufruf');
  ok(z.every((x) => x.tick_ueber5 >= x.tick_ueber16 && x.tick_ueber16 >= x.tick_ueber33 && x.tick_ueber33 >= 0 && x.tick_ueber5 <= x.tick_n), 'Zaehler ueber 5/16/33 ms: absteigend verschachtelt und nie mehr als tick_n');
  ok(g.telemetrie.stand().verworfeneFelder === 0 && g.telemetrie.stand().fehler === 0, 'verworfene Felder 0, Fehlerzaehler 0');
  ok(!fs.readFileSync(path.join(dir, f[0]), 'utf8').match(/Serverina|Servando|SrvA|SrvB/), 'keine Namen und keine clientId im Protokoll');
  for (const x of [a, b]) x.ws.terminate();
  await srv.close();
  console.log(fails ? `\n${fails} FEHLER` : '\nTELEMETRIE SERVER OK');
  process.exit(fails ? 1 : 0);
})();
