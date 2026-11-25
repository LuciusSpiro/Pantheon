'use strict';
// BOT-05 B3: Fake-Dienste fuer das Gespraech (aus test-bot-gespraech.js herausgeloest, damit auch mess-bot-gespraech --trocken sie nutzt).
// Fake Ollama streamt NDJSON wie /api/chat, Fake Voicebox liefert eine kleine WAV; beide auf freiem Port in 127.0.0.1.
const http = require('http');

// ---------- Fake Ollama ----------
function fakeOllama() {
  const f = { anfragen: [], modus: 'ok', chunkMs: 1, antwort: () => 'Kurs 270 Grad, Captain. Die Schilde stehen gut.', gleichzeitig: 0, maxGleichzeitig: 0, haengtNach: 1, sockets: new Set(), port: 0 };
  f.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let b = {}; try { b = JSON.parse(body); } catch (e) { /* egal */ }
      f.anfragen.push({ url: req.url, methode: req.method, body: b });
      if (req.url !== '/api/chat') { res.writeHead(404); return res.end(); }
      f.gleichzeitig++; f.maxGleichzeitig = Math.max(f.maxGleichzeitig, f.gleichzeitig);
      let zu = false;
      const fertig = () => { if (!zu) { zu = true; f.gleichzeitig--; } };
      res.on('close', fertig);
      if (f.modus === 'haengt') return;   // nie antworten
      if (f.modus === 'fehler') { res.writeHead(500); return res.end('kaputt'); }
      if (!b.stream) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ done: true })); }
      const text = typeof f.antwort === 'function' ? f.antwort(b) : f.antwort;
      const stuecke = text.match(/[\s\S]{1,7}/g) || [];
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      let i = 0;
      const schritt = () => {
        if (zu) return;
        if (i < stuecke.length) {
          res.write(JSON.stringify({ model: b.model, message: { role: 'assistant', content: stuecke[i++] }, done: false }) + '\n');
          if (f.modus === 'haengt-nach' && i === f.haengtNach) return;
          return setTimeout(schritt, f.chunkMs);
        }
        res.end(JSON.stringify({ model: b.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }) + '\n');
      };
      schritt();
    });
  });
  f.server.on('connection', (s) => { f.sockets.add(s); s.on('close', () => f.sockets.delete(s)); });
  f.start = () => new Promise((r) => f.server.listen(f.port, '127.0.0.1', () => { f.port = f.server.address().port; r(f); }));
  f.stop = () => new Promise((r) => { for (const s of f.sockets) s.destroy(); f.server.close(() => r()); });
  f.reset = () => { f.anfragen.length = 0; f.modus = 'ok'; f.chunkMs = 1; f.maxGleichzeitig = 0; f.haengtNach = 1; };
  return f;
}
// ---------- Fake Voicebox ----------
const wavVon = (text) => {
  const daten = Buffer.from('DATEN:' + text, 'utf8');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + daten.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(daten.length, 40);
  return Buffer.concat([h, daten]);
};
function fakeVoicebox() {
  const f = { anfragen: [], modus: 'ok', verzoegerung: 0, sockets: new Set(), port: 0 };
  f.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let b = {}; try { b = JSON.parse(body); } catch (e) { /* egal */ }
      f.anfragen.push({ url: req.url, methode: req.method, body: b, auth: req.headers.authorization || null });
      if (f.modus === 'haengt') return;
      if (f.modus === '401') { res.writeHead(401); return res.end('nein'); }
      const antworten = () => { const w = wavVon(String(b.input)); res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': w.length }); res.end(w); };
      if (f.verzoegerung) setTimeout(antworten, typeof f.verzoegerung === 'function' ? f.verzoegerung(b) : f.verzoegerung); else antworten();
    });
  });
  f.server.on('connection', (s) => { f.sockets.add(s); s.on('close', () => f.sockets.delete(s)); });
  f.start = () => new Promise((r) => f.server.listen(f.port, '127.0.0.1', () => { f.port = f.server.address().port; r(f); }));
  f.stop = () => new Promise((r) => { for (const s of f.sockets) s.destroy(); f.server.close(() => r()); });
  f.reset = () => { f.anfragen.length = 0; f.modus = 'ok'; f.verzoegerung = 0; };
  return f;
}

module.exports = { fakeOllama, fakeVoicebox, wavVon };
