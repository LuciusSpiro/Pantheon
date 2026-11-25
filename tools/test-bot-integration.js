'use strict';
// BOT-04 Integration: der Browser-Pfad des Matchers. Der Server liefert Kanon und Muster aus (nicht texte.json), die Daten aus dem Netz
// reichen im Browser-Global (ohne Dateizugriff) für Kanon-Formen; die Stimmen-Ordner im Client passen zum Clip-Vorrat.
//   node tools/test-bot-integration.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer } = require('../server/index.js');
const BS = require('../public/js/bot-sprache.js');
const ROOT = path.join(__dirname, '..');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };

(async () => {
  const srv = await startServer({ port: 0, roomCode: 'off', noStore: true, quiet: true });
  const http = srv && (srv.server || srv.httpServer || srv);
  const port = (http && http.address && http.address().port) || srv.port;
  const base = 'http://127.0.0.1:' + port;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };

  const ka = await get('/content/bots/kanon.json'), mu = await get('/content/bots/muster.json'), te = await get('/content/bots/texte.json'), ma = await get('/shared/bot-matcher.js'), fi = await get('/content/bots/figuren.json');
  ok(ka.status === 200 && mu.status === 200 && fi.status === 200, 'Server liefert kanon.json, muster.json und figuren.json (BOT-05 A2: die Figurnamen sind Adressen)');
  ok(te.status !== 200, 'texte.json bleibt auf dem Server (' + te.status + ')');
  ok(ma.status === 200, 'Server liefert shared/bot-matcher.js');

  // Browser-Simulation: Skript als Global laden (kein module), Daten wie im Client setzen
  const ctx = { window: {}, console };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(ma.text, ctx);
  const M = ctx.Shared_BotMatcher;
  ok(M && typeof M.match === 'function', 'Browser-Global Shared_BotMatcher da');
  let ohneFiguren = null; M.setzeMuster(Object.assign({}, JSON.parse(mu.text), { kanon: JSON.parse(ka.text) })); try { M.match('Schilde Steuerbord'); } catch (e) { ohneFiguren = e; }
  ok(!!ohneFiguren && /Figuren/.test(ohneFiguren.message), 'Browser ohne figuren.json: der Matcher meldet es laut statt still ohne Namen zu laufen');
  M.setzeMuster(Object.assign({}, JSON.parse(mu.text), { kanon: JSON.parse(ka.text), figuren: JSON.parse(fi.text) }));
  const r = M.match('Schilde Steuerbord');
  ok(r && r.befehl === 'tech.schild' && r.args && r.args.sektor === 'stb', 'Browser-Matcher mit geholten Daten: Schilde Steuerbord -> tech.schild stb');
  ok(M.match('Kapitän an Deck') === null, 'Browser-Matcher: Kapitän an Deck -> null');

  // Stimmen: Clip-Ordner im Vorrat = Standard des Clients
  const vorrat = fs.readdirSync(path.join(ROOT, 'assets', 'bots', 'stimmen')).sort();
  ok(JSON.stringify(vorrat) === JSON.stringify(['b0', 'b1', 'b2']), 'Clip-Vorrat hat b0 bis b2: ' + vorrat);
  for (const id of ['b0', 'b1', 'b2']) ok(vorrat.includes(BS.STIMMEN[id]), 'Standard-Stimme von ' + id + ' = ' + BS.STIMMEN[id] + ' liegt im Vorrat');
  ok(!('b3' in BS.STIMMEN) && Object.keys(BS.STIMMEN).join() === 'b0,b1,b2', 'b3 hat keine Stimme (wird nie vergeben): nur b0 bis b2, ohne Figur kein Clip');

  if (http && http.close) await new Promise((rs) => { http.closeAllConnections && http.closeAllConnections(); http.close(rs); });
  console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'test-bot-integration: ' + n + ' Pruefungen gruen'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER ' + (e && e.stack || e)); process.exit(1); });
