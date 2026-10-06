'use strict';
// Sternenschicht-Server: statische Auslieferung (http + fs), WebSocket /ws (ws, noServer), 30-Hz-Loop, 15-Hz-Snapshots.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('./game.js');

const ROOT = path.join(__dirname, '..');
const STATIC_DIRS = [
  { prefix: '/shared/', dir: path.join(ROOT, 'shared') },
  { prefix: '/', dir: path.join(ROOT, 'public') },
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff2': 'font/woff2',
};

function resolveStatic(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch (e) { return null; }
  if (p.includes('\0')) return null;
  for (const s of STATIC_DIRS) {
    if (!p.startsWith(s.prefix)) continue;
    let rel = p.slice(s.prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const full = path.resolve(s.dir, '.' + path.sep + rel);
    // Kein Directory-Traversal: Ergebnis muss innerhalb des Ordners liegen
    if (full !== s.dir && !full.startsWith(s.dir + path.sep)) return null;
    return full;
  }
  return null;
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const file = resolveStatic(req.url);
  if (!file) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Verboten'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

// M0: Raumcode. ROOM_CODE=off -> aus, ROOM_CODE=<Code> -> fest, sonst zufällig (4 Zeichen ohne 0/O/1/I).
function makeRoomCode(rand) {
  const rc = CONFIG.roomCode || { length: 4, alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' };
  const r = rand || (() => require('crypto').randomInt(rc.alphabet.length));
  let s = '';
  for (let i = 0; i < rc.length; i++) s += rc.alphabet[r()];
  return s;
}
function resolveRoomCode(value) {
  if (value === undefined || value === null || String(value).trim() === '') return makeRoomCode();
  const v = String(value).trim();
  if (/^(off|aus|0|false|none)$/i.test(v)) return null;
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || makeRoomCode();
}

function startServer(opts) {
  const o = opts || {};
  const port = o.port != null ? o.port : (Number(process.env.PORT) || CONFIG.port);
  const debug = o.debug != null ? o.debug : (process.argv.includes('--debug') || process.env.DEBUG === '1');
  const roomCode = resolveRoomCode(o.roomCode !== undefined ? o.roomCode : process.env.ROOM_CODE);
  const game = new Game({ debug, noStore: o.noStore, roomCode, log: o.quiet ? () => {} : undefined });
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = (req.url || '').split('?')[0];
    if (url !== Protocol.WS_PATH) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const conn = {
      ws,
      send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
      sendRaw(str) { if (ws.readyState === 1) ws.send(str); },
      close() { try { ws.close(); } catch (e) { /* egal */ } },
    };
    game.addConnection(conn);
    ws.on('message', (data) => game.handleRaw(conn, data.toString()));
    ws.on('close', () => game.removeConnection(conn));
    ws.on('error', () => { /* close folgt */ });
  });

  // Fester Timestep mit Akkumulator
  const dtMs = 1000 / CONFIG.tickHz;
  let last = performance.now(), acc = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    acc += now - last; last = now;
    if (acc > 250) acc = 250; // nach Hängern nicht durchrasen
    while (acc >= dtMs) {
      acc -= dtMs;
      game.step();
      if (game.wantsSnapshot()) {
        try { game.broadcast(game.snapshot()); } catch (e) { game.countError('snapshot', e); }
      }
    }
  }, 5);

  return new Promise((resolve) => {
    server.listen(port, () => {
      if (!o.quiet) {
        console.log(`Sternenschicht-Server läuft: http://localhost:${port}  (WebSocket ${Protocol.WS_PATH}${debug ? ', DEBUG aktiv' : ''})`);
        console.log(`Teaser-Quelle: ${(process.env.MISSION_SOURCE || 'fallback')}`);
        const realPort = server.address().port;
        if (roomCode) {
          const bar = '='.repeat(64);
          console.log(`\n${bar}\n  Raumcode: ${roomCode}   Link: http://localhost:${realPort}/?code=${roomCode}`);
          console.log(`  Übers Internet (Cloudflare-Tunnel): an die trycloudflare-Adresse einfach ?code=${roomCode} anhängen.`);
          console.log(`  Fester Code: ROOM_CODE=ABCD in .env · ohne Code: ROOM_CODE=off\n${bar}\n`);
        } else {
          console.log('Raumcode: aus (ROOM_CODE=off) – jeder mit der Adresse kann beitreten.');
        }
      }
      resolve({ server, wss, game, roomCode, port: server.address().port, close: () => new Promise((r) => { clearInterval(loop); for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()); }) });
    });
  });
}

if (require.main === module) {
  startServer().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { startServer, resolveStatic, resolveRoomCode, makeRoomCode };
