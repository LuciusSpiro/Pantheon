'use strict';
// BOT-04 C: Server-Route POST /api/stt (server/stt.js) und POST /api/bot-messung gegen einen Fake-Upstream.
//  - ohne STT_URL: Route aus (503), nichts geht nach aussen
//  - Audio roh -> multipart (file, model=whisper-1, language=de) an STT_URL/v1/audio/transcriptions -> { text }
//  - Limit 1 MB (413), Rate-Limit je Adresse (429), Timeout (504), Upstream-Fehler (502), Content-Type (415), Methode (405)
//  - nur lokale Browser, ausser STT_REMOTE=1 (Proxy-Kopfzeile -> 403)
//  - Einhaengen in server/index.js: echter Spielserver, echter Fake-Upstream; statische Clips/Phrasen; WS-maxPayload unveraendert
//   node tools/test-bot-stt.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const Stt = require('../server/stt.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');

function server(handler) { return new Promise((r) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); }); }
const zu = (s) => new Promise((r) => { s.closeAllConnections && s.closeAllConnections(); s.close(r); });
async function post(port, pfad, body, headers) {
  const r = await fetch('http://127.0.0.1:' + port + pfad, { method: 'POST', headers: headers || { 'Content-Type': 'audio/webm;codecs=opus' }, body });
  let j = null; try { j = await r.json(); } catch (e) { /* kein JSON */ }
  return { status: r.status, json: j };
}
const AUDIO = Buffer.alloc(3000, 7);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// roher Post mit frei waehlbaren Kopfzeilen (fetch erlaubt Origin nicht in jedem Fall)
function roh(port, pfad, body, headers) {
  return new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port, path: pfad, method: 'POST', headers }, (r) => { const t = []; r.on('data', (c) => t.push(c)); r.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(t).toString('utf8')); } catch (e) { /* kein JSON */ } resolve({ status: r.statusCode, json: j }); }); });
    q.on('error', reject); q.end(body);
  });
}

(async () => {
  section('Route aus ohne STT_URL');
  {
    let aufrufe = 0;
    const stt = Stt.erzeuge({ env: {}, fetch: () => { aufrufe++; return Promise.reject(new Error('nie')); } });
    const s = await server((req, res) => { if (!stt.route(req, res)) { res.writeHead(404); res.end(); } });
    const p = s.address().port;
    const r = await post(p, '/api/stt', AUDIO);
    ok(r.status === 503 && r.json.fehler === 'stt-aus' && aufrufe === 0, 'POST /api/stt ohne STT_URL: 503, kein Upstream-Aufruf');
    ok((await post(p, '/api/bot-messung', JSON.stringify({ sitzung: 'a', eintrag: {} }), { 'Content-Type': 'application/json' })).status === 503, 'POST /api/bot-messung ohne STT_URL: 503');
    ok((await fetch('http://127.0.0.1:' + p + '/api/anderes')).status === 404, 'andere Pfade gehoeren der Route nicht');
    await zu(s);
  }

  section('Weiterreichen, Fehlerbilder, Limit, Rate-Limit');
  {
    const env = { STT_URL: 'http://127.0.0.1:8300', STT_PRO_MINUTE: '4' };
    const L = { url: null, form: null, aufrufe: 0 };
    let modus = 'ok', zeit = 1000;
    const fakeFetch = async (url, init) => {
      L.aufrufe++; L.url = url; L.form = init.body; L.signal = !!init.signal;
      if (modus === 'fehler') return { ok: false, status: 500, json: async () => ({}) };
      if (modus === 'zeit') { const e = new Error('Zeit'); e.name = 'TimeoutError'; throw e; }
      if (modus === 'netz') throw new TypeError('fetch failed');
      return { ok: true, status: 200, json: async () => ({ text: ' Schilde Steuerbord ' }) };
    };
    const stt = Stt.erzeuge({ env, fetch: fakeFetch, now: () => zeit });
    const s = await server((req, res) => { if (!stt.route(req, res)) { res.writeHead(404); res.end(); } });
    const p = s.address().port;
    let r = await post(p, '/api/stt', AUDIO);
    ok(r.status === 200 && r.json.text === 'Schilde Steuerbord', 'Audio -> { text } (getrimmt)');
    const f = L.form;
    ok(L.url === 'http://127.0.0.1:8300/v1/audio/transcriptions' && L.signal, 'Ziel STT_URL + /v1/audio/transcriptions, mit Timeout-Signal');
    ok(f.get('model') === 'whisper-1' && f.get('language') === 'de', 'multipart: model=whisper-1, language=de');
    ok(f.get('file').size === AUDIO.length && f.get('file').type === 'audio/webm;codecs=opus' && f.get('file').name === 'aufnahme.webm', 'multipart: file mit durchgereichtem Content-Type und Inhalt');
    ok(Stt.sttZiel('http://x:8300/v1/audio/transcriptions') === 'http://x:8300/v1/audio/transcriptions' && Stt.sttZiel('http://x:8300/') === 'http://x:8300/v1/audio/transcriptions', 'STT_URL als Basis oder volle Adresse');

    const vorher = L.aufrufe;
    r = await post(p, '/api/stt', Buffer.alloc(Stt.MAX_BYTES + 1, 1));
    ok(r.status === 413 && L.aufrufe === vorher, 'ueber 1 MB: 413, nichts an den STT');
    r = await post(p, '/api/stt', Buffer.alloc(Stt.MAX_BYTES, 1));
    ok(r.status === 200, 'genau 1 MB geht noch');
    r = await post(p, '/api/stt', AUDIO, { 'Content-Type': 'application/json' });
    ok(r.status === 415, 'kein Audio-Content-Type: 415');
    r = await post(p, '/api/stt', Buffer.alloc(0));
    ok(r.status === 400, 'leerer Body: 400');
    ok((await fetch('http://127.0.0.1:' + p + '/api/stt')).status === 405, 'GET: 405');

    // Rate-Limit: 4 pro Minute (bisher verbraucht: 1 Erfolg, 1 genau-1MB, 1 oberhalb 415? 415/400/413 zaehlen nicht -> 2 verbraucht)
    r = await post(p, '/api/stt', AUDIO); r = await post(p, '/api/stt', AUDIO);
    const sperre = await post(p, '/api/stt', AUDIO);
    ok(sperre.status === 429, 'Rate-Limit je Adresse: 5. gueltige Anfrage in der Minute -> 429');
    zeit += 61000;
    ok((await post(p, '/api/stt', AUDIO)).status === 200, 'nach einer Minute wieder frei');

    zeit += 61000; modus = 'fehler';
    ok((await post(p, '/api/stt', AUDIO)).status === 502, 'STT antwortet mit Fehler: 502');
    modus = 'zeit'; ok((await post(p, '/api/stt', AUDIO)).status === 504, 'STT zu langsam (Timeout): 504');
    zeit += 61000; modus = 'netz'; r = await post(p, '/api/stt', AUDIO);
    ok(r.status === 502 && r.json.fehler === 'stt-nicht-erreichbar', 'STT nicht erreichbar (Tunnel weg): 502');

    // nur lokal
    zeit += 61000; modus = 'ok';
    ok((await post(p, '/api/stt', AUDIO, { 'Content-Type': 'audio/webm', 'X-Forwarded-For': '203.0.113.5' })).status === 403, 'Anfrage ueber Proxy/Tunnel (X-Forwarded-For): 403');
    ok((await post(p, '/api/stt', AUDIO, { 'Content-Type': 'audio/webm', 'CF-Connecting-IP': '203.0.113.5' })).status === 403, 'Anfrage ueber Cloudflare-Tunnel (CF-Connecting-IP): 403');
    await zu(s);
    env.STT_REMOTE = '1';
    // S6: Kopfzeilen sind nie der Rate-Limit-Schluessel (mit STT_REMOTE=1 duerfen sie da sein, helfen aber nicht beim Umgehen)
    zeit += 61000;
    const sx = await server((req, res) => { if (!stt.route(req, res)) { res.writeHead(404); res.end(); } });
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post(sx.address().port, '/api/stt', AUDIO, { 'Content-Type': 'audio/webm', 'X-Forwarded-For': '203.0.113.' + i, 'CF-Connecting-IP': '198.51.100.' + i })).status);
    ok(eq(codes, [200, 200, 200, 200, 429, 429]), 'Rate-Limit: wechselnde X-Forwarded-For/CF-Connecting-IP umgehen das Limit nicht (' + codes + ')');
    await zu(sx); zeit += 61000;
    // S6: Tabelle der Adressen bleibt begrenzt (viele verschiedene Socket-Adressen, alle aktiv)
    {
      const { EventEmitter } = require('events');
      const st2 = Stt.erzeuge({ env: { STT_URL: 'http://127.0.0.1:1', STT_REMOTE: '1' }, fetch: async () => ({ ok: true, json: async () => ({ text: 'x' }) }), now: () => 5000 });
      for (let i = 0; i < 700; i++) {
        const q = new EventEmitter(); q.method = 'POST'; q.url = '/api/stt'; q.headers = { 'content-type': 'audio/webm' }; q.socket = { remoteAddress: '10.0.' + (i >> 8) + '.' + (i & 255) }; q.resume = () => {};
        const res = { headersSent: false, writeHead() { this.headersSent = true; }, end() {} };
        st2.route(q, res); q.emit('data', Buffer.alloc(10, 1)); q.emit('end');
      }
      await new Promise((r) => setTimeout(r, 50));
      ok(st2.fensterGroesse() > 0 && st2.fensterGroesse() <= 500, 'Rate-Limit-Tabelle bleibt bei 700 Adressen auf hoechstens 500 Eintraegen (' + st2.fensterGroesse() + ')');
    }
    const s2 = await server((req, res) => { if (!stt.route(req, res)) { res.writeHead(404); res.end(); } });
    ok((await post(s2.address().port, '/api/stt', AUDIO, { 'Content-Type': 'audio/webm', 'X-Forwarded-For': '203.0.113.5' })).status === 200, 'mit STT_REMOTE=1 duerfen Mitspieler');
    await zu(s2);
  }

  section('Messung schreiben (nur mit STT_URL)');
  {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'botmess-')), 'messungen');
    const stt = Stt.erzeuge({ env: { STT_URL: 'http://127.0.0.1:1' }, messDir: dir });
    const s = await server((req, res) => { if (!stt.route(req, res)) { res.writeHead(404); res.end(); } });
    const p = s.address().port, J = { 'Content-Type': 'application/json' };
    let r = await post(p, '/api/bot-messung', JSON.stringify({ sitzung: '../messung 1', eintrag: { rohtext: 'a' } }), J);
    ok(r.status === 200 && r.json.n === 1 && fs.existsSync(path.join(dir, 'messung1.jsonl')), 'Eintrag geschrieben, Sitzungsname bereinigt (kein ../, keine Leerzeichen)');
    r = await post(p, '/api/bot-messung', JSON.stringify({ sitzung: 'messung1', eintrag: { rohtext: 'b\nzeile2' } }), J);
    const zeilen = fs.readFileSync(path.join(dir, 'messung1.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    ok(r.json.n === 2 && zeilen.length === 2 && zeilen[1].eintrag.rohtext === 'b\nzeile2' && zeilen[1].sitzung === 'messung1', 'zweiter Eintrag wird als eine JSON-Zeile angehaengt (Zeilenumbruch im Inhalt bleibt escaped)');
    ok(fs.readdirSync(dir).length === 1, 'nur eine Datei unter messungen/');
    // S5: nur JSON, nur gleicher Ursprung, Obergrenzen, messDir statt cwd
    ok((await post(p, '/api/bot-messung', JSON.stringify({ sitzung: 'x', eintrag: {} }), { 'Content-Type': 'text/plain' })).status === 415 && (await roh(p, '/api/bot-messung', JSON.stringify({ sitzung: 'x', eintrag: {} }), {})).status === 415, 'Messung ohne application/json (text/plain, ohne Typ): 415');
    ok((await roh(p, '/api/bot-messung', JSON.stringify({ sitzung: 'o1', eintrag: {} }), { 'Content-Type': 'application/json', Origin: 'https://boese.example' })).status === 403, 'fremder Origin: 403');
    ok((await roh(p, '/api/bot-messung', JSON.stringify({ sitzung: 'o2', eintrag: {} }), { 'Content-Type': 'application/json', Origin: 'null' })).status === 403, 'Origin null: 403');
    ok((await roh(p, '/api/bot-messung', JSON.stringify({ sitzung: 'o3', eintrag: {} }), { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:' + p })).status === 200 && (await roh(p, '/api/bot-messung', JSON.stringify({ sitzung: 'o4', eintrag: {} }), { 'Content-Type': 'application/json; charset=utf-8' })).status === 200, 'gleicher Origin und fehlender Origin (lokales Skript): 200');
    ok(!fs.existsSync(path.join(process.cwd(), 'messungen', 'o3.jsonl')) && fs.existsSync(path.join(dir, 'o3.jsonl')), 'geschrieben wird nach messDir, nicht nach cwd');
    ok(/path\.join\(ROOT, 'messungen'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'stt.js'), 'utf8')) && !/process\.cwd\(\)/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'stt.js'), 'utf8')), 'Standard-messDir liegt unter ROOT, kein process.cwd()');
    {
      const dir2 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'botmess2-')), 'm');
      const st = Stt.erzeuge({ env: { STT_URL: 'http://127.0.0.1:1', STT_PRO_MINUTE: '100000' }, messDir: dir2 });
      const s3 = await server((req, res) => { if (!st.route(req, res)) { res.writeHead(404); res.end(); } });
      const q = s3.address().port;
      let letzte = null;
      for (let i = 0; i < 2001; i++) letzte = await post(q, '/api/bot-messung', JSON.stringify({ sitzung: 'voll', eintrag: { i } }), J);
      ok(letzte.status === 413 && letzte.json.fehler === 'sitzung-voll' && fs.readFileSync(path.join(dir2, 'voll.jsonl'), 'utf8').split('\n').filter(Boolean).length === 2000, 'Sitzung: ab 2000 Eintraegen 413, Datei bleibt bei 2000 Zeilen');
      const gross = { x: 'y'.repeat(60000) }; let g = null;
      for (let i = 0; i < 20; i++) { g = await post(q, '/api/bot-messung', JSON.stringify({ sitzung: 'gross', eintrag: gross }), J); if (g.status !== 200) break; }
      ok(g.status === 413 && fs.statSync(path.join(dir2, 'gross.jsonl')).size <= 1024 * 1024, 'Sitzung: ueber 1 MB 413, Datei bleibt unter 1 MB');
      const st2 = Stt.erzeuge({ env: { STT_URL: 'http://127.0.0.1:1' }, messDir: dir2 });   // wie nach Neustart: Zaehlung kommt aus der Datei
      const s4 = await server((req, res) => { if (!st2.route(req, res)) { res.writeHead(404); res.end(); } });
      ok((await post(s4.address().port, '/api/bot-messung', JSON.stringify({ sitzung: 'voll', eintrag: {} }), J)).status === 413, 'nach Neustart zaehlt die vorhandene Datei weiter');
      // Messung teilt das Rate-Limit mit /api/stt
      const st3 = Stt.erzeuge({ env: { STT_URL: 'http://127.0.0.1:1', STT_PRO_MINUTE: '2' }, messDir: dir2 });
      const s5 = await server((req, res) => { if (!st3.route(req, res)) { res.writeHead(404); res.end(); } });
      const c3 = []; for (let i = 0; i < 3; i++) c3.push((await post(s5.address().port, '/api/bot-messung', JSON.stringify({ sitzung: 'r' + i, eintrag: {} }), J)).status);
      ok(eq(c3, [200, 200, 429]), 'Messung wird wie /api/stt gedrosselt (' + c3 + ')');
      await zu(s3); await zu(s4); await zu(s5);
    }
    ok((await post(p, '/api/bot-messung', 'kein json', J)).status === 400 && (await post(p, '/api/bot-messung', JSON.stringify({ eintrag: {} }), J)).status === 400, 'kaputtes oder unvollstaendiges JSON: 400');
    ok((await post(p, '/api/bot-messung', JSON.stringify({ sitzung: 'x', eintrag: { t: 'x'.repeat(70000) } }), J)).status === 413, 'Messung ueber 64 KB: 413');
    ok(/messungen\//.test(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8')), 'messungen/ steht in .gitignore');
    await zu(s);
  }

  section('Spielserver (server/index.js): Haken, echter Upstream, statische Dateien');
  {
    // echter Fake-STT mit Prueffeldern im Multipart-Body
    const roh = { body: '', typ: '', pfad: '' };
    const up = await server((req, res) => { const t = []; roh.pfad = req.url; roh.typ = req.headers['content-type']; req.on('data', (c) => t.push(c)); req.on('end', () => { roh.body = Buffer.concat(t).toString('latin1'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: 'Feuer frei' })); }); });
    const alt = process.env.STT_URL; delete process.env.STT_URL;
    const { startServer } = require('../server/index.js');
    const sp = await startServer({ port: 0, quiet: true, noStore: true, worlds: false });
    const P = sp.port;
    ok((await post(P, '/api/stt', AUDIO)).status === 503, 'Spielserver ohne STT_URL: /api/stt antwortet 503');
    process.env.STT_URL = 'http://127.0.0.1:' + up.address().port;
    const r = await post(P, '/api/stt', AUDIO);
    ok(r.status === 200 && r.json.text === 'Feuer frei' && roh.pfad === '/v1/audio/transcriptions' && /^multipart\/form-data; boundary=/.test(roh.typ), 'Spielserver mit STT_URL: Audio kommt als multipart beim Upstream an, { text } zurueck');
    ok(/name="model"\r\n\r\nwhisper-1/.test(roh.body) && /name="language"\r\n\r\nde/.test(roh.body) && /name="file"; filename="aufnahme\.webm"/.test(roh.body), 'echter multipart-Body: model, language, file');
    const ph = await fetch('http://127.0.0.1:' + P + '/bot-messung/phrasen.json');
    ok(ph.status === 200 && (await ph.json()).phrasen.length >= 24, 'GET /bot-messung/phrasen.json liefert die Phrasenliste');
    ok((await fetch('http://127.0.0.1:' + P + '/bot-messung/../../package.json')).status !== 200 && (await fetch('http://127.0.0.1:' + P + '/bot-messung/katalog.json')).status === 403, 'dort nur phrasen.json');
    ok((await fetch('http://127.0.0.1:' + P + '/assets/bots/stimmen/navigation/nav.stopp.ok.0.ogg')).status === 404, 'Clip fehlt: 404 (der Client faellt auf den Untertitel zurueck)');
    ok((await fetch('http://127.0.0.1:' + P + '/assets/bots/stimmen/x/y.json')).status === 403, 'unter /assets/bots/stimmen/ nur ogg und wav');
    ok((await fetch('http://127.0.0.1:' + P + '/version.json')).status === 200, 'uebrige Auslieferung unberuehrt');
    ok(/maxPayload: 16 \* 1024/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8')), 'WebSocket-maxPayload unveraendert (16 KB)');
    if (alt === undefined) delete process.env.STT_URL; else process.env.STT_URL = alt;
    await sp.close(); await zu(up);
  }

  console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})();
