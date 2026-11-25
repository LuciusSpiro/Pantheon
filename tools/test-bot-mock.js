'use strict';
// BOT-04 C: Mock-Lauf des Befehlswegs. Jeder Katalogbefehl geht per Sprache (Fake-Mikrofon, Fake-STT, Fake-Matcher) durch den Client-Kern,
// ueber einen echten WebSocket zum Mock-Server (tools/bot-befehl-mock.js) und als bot.antwort zurueck: Untertitel und Clip-Wahl im selben Schritt,
// fehlender Clip faellt auf den Untertitel zurueck. Dazu: Texte-Datei, Protokoll, --log.
//   node tools/test-bot-mock.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const BS = require('../public/js/bot-sprache.js');
const { startMock, KATALOG, TEXTE, botIdFuer } = require('./bot-befehl-mock.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');
const tick = () => new Promise((r) => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const warteBis = async (f, ms) => { const t = Date.now(); while (!f()) { if (Date.now() - t > (ms || 3000)) return false; await new Promise((r) => setTimeout(r, 5)); } return true; };

(async () => {
  section('Katalog und Texte');
  const ids = KATALOG.map((k) => k.befehl);
  ok(ids.length === 23 && new Set(ids).size === 23, '23 Katalogbefehle des Vertrags (v1), eindeutig');
  ok(ids.every((id) => Array.isArray(TEXTE[id + '.ok']) && TEXTE[id + '.ok'].length >= 2 && TEXTE[id + '.ok'].every((t) => typeof t === 'string' && t.length > 3)), 'texte.json: ok-Texte fuer jeden Befehl, je mindestens 2 Varianten');
  ok(Array.isArray(TEXTE['bot.unklar']) && TEXTE['bot.unklar'].length >= 2, 'texte.json: bot.unklar mit 2 Varianten');
  ok(Object.keys(TEXTE).every((k) => k === 'bot.unklar' || /^bord[.]ansage[.](code|gegner|raetsel)$/.test(k) || ids.includes(k.replace(/\.ok$/, '')) || (/^[a-z]+([.][a-z_]+)?[.](abgelehnt|unmoeglich)[.][a-z_]+$/.test(k) && (k.startsWith('befehl.') || ids.includes(k.split('.').slice(0, 2).join('.'))))), 'texte.json: keine Texte ohne Befehl (BOT-02 B4: die Ansagen des Bord-Bots bord.ansage.<art> sind keine Befehle; BOT-01 C1: auch <befehl>.abgelehnt|unmoeglich.<grund>; tools/test-bot-annahme.js prueft die Gruende)');
  ok(botIdFuer('navigation') === 'b0' && botIdFuer('ops') === 'b1' && botIdFuer('technik') === 'b2' && botIdFuer('bord') === 'b3' && botIdFuer('alle') === 'b0' && botIdFuer('b2') === 'b2' && botIdFuer('x') === null, 'botId nach Rolle (navigation b0, ops b1, technik b2, bord b3, alle b0)');
  const ph = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bot-messung', 'phrasen.json'), 'utf8')).phrasen;
  ok(ph.length >= 24 && ph.every((p) => p.id && p.text && (p.erwartet === null || (p.erwartet && ids.includes(p.erwartet.befehl)))) && ids.every((id) => ph.some((p) => p.erwartet && p.erwartet.befehl === id) || KATALOG.find((k) => k.befehl === id).ohneMatcher), 'phrasen.json: mindestens 24 Phrasen, jede mit erwartetem Katalogbefehl, jeder Befehl abgedeckt');

  section('Mock-Lauf: jeder Katalogbefehl per Sprache');
  const logDatei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'botmock-')), 'mock.log');
  const mock = startMock({ port: 0, leise: true, log: logDatei });
  const port = await mock.bereit;
  const transport = BS.transportWebSocket('ws://127.0.0.1:' + port, WebSocket);
  ok(await warteBis(() => transport.offen()), 'Client-Transport verbunden');

  let aktuell = null, clipDa = false;
  const L = { ereignisse: [], untertitel: [], clips: [] };
  const matcher = { match: (t) => { const k = KATALOG.find((x) => x.spricht === t); return k ? { an: k.an, befehl: k.befehl, args: k.args || {}, konfidenz: 1 } : null; } };
  const kern = BS.erzeuge({
    transport, matcher: () => matcher, stt: async () => aktuell.spricht,
    mikrofon: { start: async () => ({ stop: async () => ({ blob: { size: 4000 }, mime: 'audio/webm', dauerMs: 900 }), abbruch() {} }) },
    audio: { spiele: (urls) => { L.ereignisse.push('clip'); L.clips.push(urls); return Promise.resolve(clipDa ? urls[0] : null); }, stumm() {}, stopp() {} },
    anzeige: { aufnahme() {}, untertitel: (t) => { L.ereignisse.push('untertitel'); L.untertitel.push(t); }, meldung() {} },
  });
  kern.schalte(true);

  for (const k of KATALOG) {
    aktuell = k;
    const vorher = L.untertitel.length, protVorher = mock.protokoll.length;
    kern.tasteRunter(); await tick(); await kern.tasteHoch();
    const da = await warteBis(() => L.untertitel.length > vorher);
    const p = mock.protokoll[protVorher];
    const rolle = k.an === 'alle' ? 'b0' : botIdFuer(k.an), stimme = BS.STIMMEN[rolle];
    const textId = k.befehl + '.ok';
    ok(da && p && p.ein.t === 'bot.befehl' && p.ein.befehl === k.befehl && p.ein.an === k.an && p.ein.quelle === 'sprache' && eq(p.ein.args || {}, k.args || {}), k.befehl + ': bot.befehl (quelle sprache) beim Mock angekommen');
    ok(p && p.aus.textId === textId && p.aus.status === 'ok' && p.aus.botId === rolle, k.befehl + ': bot.antwort ' + textId + ' von ' + rolle);
    const vi = p && p.aus.variante;
    ok(L.untertitel.at(-1) === TEXTE[textId][vi] && L.clips.at(-1)[0] === '/assets/bots/stimmen/' + stimme + '/' + textId + '.' + vi + '.wav', k.befehl + ': Untertitel "' + L.untertitel.at(-1) + '" und Clip ' + stimme + '/' + textId + '.' + vi);
    const e = L.ereignisse.slice(-2);
    ok(e[0] === 'untertitel' && e[1] === 'clip', k.befehl + ': Untertitel und Clip im selben Schritt (ohne Pause dazwischen)');
  }
  ok(mock.protokoll.length === 23, 'Mock hat genau 23 Befehle protokolliert (kein Befehl doppelt, keiner verloren)');
  ok(L.untertitel.length === 23, 'jede bot.antwort hat genau einen Untertitel, auch wenn der Clip fehlt (Clip fehlt: Untertitel bleibt)');

  section('Clip da: Wahl aus dem Vorrat; Mock: Reihum der Varianten, unbekannte Befehle');
  clipDa = true; aktuell = KATALOG[1];
  const v0 = mock.protokoll.length; kern.tasteRunter(); await tick(); await kern.tasteHoch(); await warteBis(() => mock.protokoll.length > v0);
  ok(mock.protokoll.at(-1).aus.variante === 1 && mock.protokoll[1].aus.variante === 0, 'Varianten laufen reihum (0, dann 1)');
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  const empfangen = [];
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (d) => empfangen.push(JSON.parse(d.toString())));
  ws.send(JSON.stringify({ t: 'bot.befehl', an: 'navigation', befehl: 'nav.gibtsnicht', quelle: 'text' }));
  ws.send(JSON.stringify({ t: 'anderes' })); ws.send('kein json');
  ws.send(JSON.stringify({ t: 'bot.befehl', an: 'ops', befehl: 'ops.scan', quelle: 'sprache' }));
  await warteBis(() => empfangen.length >= 2);
  ok(empfangen[0].status === 'abgelehnt' && empfangen[0].textId === 'nav.gibtsnicht.abgelehnt.unbekannt', 'unbekannter Befehl: abgelehnt mit Grund im textId');
  ok(empfangen[1].textId === 'ops.scan.ok' && empfangen[1].botId === 'b1' && empfangen.length === 2, 'Muell (kein JSON, fremder Typ) bleibt ohne Antwort, der Mock laeuft weiter');
  ws.close();

  section('Protokoll-Datei und Transport');
  const zeilen = fs.readFileSync(logDatei, 'utf8').trim().split('\n').map((z) => JSON.parse(z));
  ok(zeilen.length >= 25 && zeilen.filter((z) => z.ein && z.ein.befehl === 'nav.stopp').length >= 2 && zeilen.every((z) => z.zeit), '--log: JSON-Zeilen mit Zeit, Befehl und Antwort');
  ok(BS.transportNetStub().send({}) === false, 'Stub fuer net.js (Paket D): send meldet "nicht gesendet"');
  kern.schalte(false); transport.schliessen(); await mock.close();

  console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})();
