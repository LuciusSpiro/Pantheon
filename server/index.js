'use strict';
// Pantheon-Server (früher Sternenschicht): statische Auslieferung (http + fs), WebSocket /ws (ws, noServer), 30-Hz-Loop, 15-Hz-Snapshots.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('./game.js');
const Weltstand = require('./weltstand.js');

const ROOT = path.join(__dirname, '..');
const STATIC_DIRS = [
  { prefix: '/shared/', dir: path.join(ROOT, 'shared') },
  // B1 §9 (Wunsch VOXEL): Vokabular und Art-Daten für den Kit-Renderer – nur .json, nur lesen, kein Listing
  { prefix: '/content/buehnen/', dir: path.join(ROOT, 'content', 'buehnen'), only: ['.json'] },
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
    if (s.only && (full === s.dir || !s.only.includes(path.extname(full).toLowerCase()))) return null;
    return full;
  }
  return null;
}

// M4 (PIPELINE): /vendor/ (three.js) und /voxel/ (Voxelwerk-Kern + Assets) liegen unter public/ und werden
// über '/' ausgeliefert. .js/.json dort gehen gzip-komprimiert raus; das Ergebnis wird im Speicher gecacht
// (Schlüssel Datei + mtime + Größe, begrenzt auf GZIP_CACHE_MAX Bytes, älteste fliegen zuerst).
const GZIP_PREFIXES = ['/vendor/', '/voxel/'];
const GZIP_EXT = new Set(['.js', '.json']);
const GZIP_CACHE_MAX = 48 * 1024 * 1024;
const gzipCache = new Map();
let gzipCacheBytes = 0;

function gzipEligible(req, file) {
  if (!GZIP_EXT.has(path.extname(file).toLowerCase())) return false;
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return false;
  const p = (req.url || '').split('?')[0];
  return GZIP_PREFIXES.some((x) => p.startsWith(x));
}

function gzipped(file, st, cb) {
  const hit = gzipCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    gzipCache.delete(file); gzipCache.set(file, hit); // LRU: nach hinten
    return cb(null, hit.buf);
  }
  fs.readFile(file, (err, raw) => {
    if (err) return cb(err);
    zlib.gzip(raw, { level: 6 }, (err2, buf) => {
      if (err2) return cb(err2);
      if (hit) { gzipCacheBytes -= hit.buf.length; gzipCache.delete(file); }
      gzipCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, buf });
      gzipCacheBytes += buf.length;
      for (const [k, v] of gzipCache) { if (gzipCacheBytes <= GZIP_CACHE_MAX) break; gzipCache.delete(k); gzipCacheBytes -= v.buf.length; }
      cb(null, buf);
    });
  });
}

// B1 (Wunsch WERKSTATT): /content/buehnen/index.json – Module und Schablonen je Kartenart, zur Laufzeit aus den Dateinamen
// { <art>: { module: [ids], schablonen: [ids] } } (ID = Dateiname ohne .json). Kein Listing beliebiger Ordner.
const BUEHNEN_ARTEN = ['aussenposten', 'station', 'ruine', 'schiff'];
function buehnenIndex() {
  const out = {};
  for (const art of BUEHNEN_ARTEN) {
    const ids = (sub) => {
      try { return fs.readdirSync(path.join(ROOT, 'content', 'buehnen', art, sub)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch (e) { return []; }
    };
    out[art] = { module: ids('module'), schablonen: ids('schablonen') };
  }
  return out;
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if ((req.url || '').split('?')[0] === '/content/buehnen/index.json') {
    const body = JSON.stringify(buehnenIndex());
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  const file = resolveStatic(req.url);
  if (!file) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Verboten'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
    if (gzipEligible(req, file)) {
      // no-cache = jedes Mal nachfragen; ETag erspart dann die Übertragung unveränderter Dateien
      const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}-gz"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding' }); return res.end(); }
      return gzipped(file, st, (gzErr, buf) => {
        if (gzErr) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Fehler'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()], 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding', 'Content-Length': buf.length, 'Cache-Control': 'no-cache', 'ETag': etag });
        res.end(req.method === 'HEAD' ? undefined : buf);
      });
    }
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
  // S1 §5.2: Weltstände in WORLD_DIR (Standard data/worlds); noStore schaltet sie ab (Tests), worlds: true erzwingt
  const worldDir = o.worldDir || Weltstand.dir(process.env);
  const game = new Game({ debug, noStore: o.noStore, worlds: o.worlds, worldDir, port, roomCode, log: o.quiet ? () => {} : undefined });
  // B1 (OFFEN-STUDIO): Landepunkte beim Serverstart laden; vorwaermen (Bühnendaten, ein Probebau je Kartenart ≈ 0,4 s)
  // läuft per setImmediate vor dem ersten Spiel und nie im Tick. Fehlt das Modul, läuft der Server ohne gebaute Karten.
  try {
    const L = require('./sim/landepunkte.js');
    if (L && typeof L.vorwaermen === 'function') { const t = setImmediate(() => { try { L.vorwaermen(); } catch (e) { game.countError('landepunkte-vorwaermen', e); } }); if (t && t.unref) t.unref(); }
  } catch (e) { console.warn('[Pantheon] server/sim/landepunkte.js nicht geladen:', e && e.message); }
  // B1 (CONTRACT-B1 §4, Abnahme F8): Werkstatt-Routen immer (Lesen: Galerie, Werkstatt nur lesen); Speichern nur mit
  // WERKSTATT=1 bzw. --werkstatt (npm run werkstatt). Nach dem Speichern lädt werkstatt.js den Modulbestand neu (F9).
  const werkstattSpeichern = process.env.WERKSTATT === '1' || process.argv.includes('--werkstatt');
  let werkstatt = null;
  try { werkstatt = require('./werkstatt.js'); } catch (e) { console.warn('[Pantheon] server/werkstatt.js nicht geladen:', e && e.message); }
  const werkstattOpts = { speichern: werkstattSpeichern };
  const server = http.createServer(werkstatt
    ? (req, res) => { if (!werkstatt.route(req, res, werkstattOpts)) serveStatic(req, res); }
    : serveStatic);
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
      const realPort = server.address().port;
      game.port = realPort;
      if (!o.quiet) {
        console.log(`[Pantheon] Server läuft: http://localhost:${realPort}  (WebSocket ${Protocol.WS_PATH}${debug ? ', DEBUG aktiv' : ''})`);
        console.log(`[Pantheon] Teaser-Quelle: ${(process.env.MISSION_SOURCE || 'fallback')}`);
        console.log(game.worldsEnabled ? `[Pantheon] Weltstände: ${worldDir} (${game.worldList.length}/${game.worldMax()})` : '[Pantheon] Weltstände: aus');
        if (roomCode) {
          const bar = '='.repeat(64);
          console.log(`\n${bar}\n  Raumcode: ${roomCode}   Link: http://localhost:${realPort}/?code=${roomCode}`);
          console.log(`  Übers Internet (Cloudflare-Tunnel): an die trycloudflare-Adresse einfach ?code=${roomCode} anhängen.`);
          console.log(`  Fester Code: ROOM_CODE=ABCD in .env · ohne Code: ROOM_CODE=off\n${bar}\n`);
        } else {
          console.log('[Pantheon] Raumcode: aus (ROOM_CODE=off) – jeder mit der Adresse kann beitreten.');
        }
      }
      resolve({ server, wss, game, roomCode, port: server.address().port, close: () => new Promise((r) => { clearInterval(loop); game.releaseWorldLock(); for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()); }) });
    });
  });
}

if (require.main === module) {
  startServer().then((s) => {
    // S1 §5.2: Sperrdatei des offenen Weltstands beim Beenden lösen (verwaiste Sperren erkennt auch der nächste Start)
    process.on('exit', () => s.game.releaseWorldLock());
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { s.game.releaseWorldLock(); process.exit(0); });
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { startServer, resolveStatic, resolveRoomCode, makeRoomCode };
