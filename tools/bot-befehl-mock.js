'use strict';
// BOT-04 C: Mock-Server fuer den Bot-Befehlsweg (Vertrag Bot-Befehle). Nimmt { t: 'bot.befehl', an, befehl, args?, quelle } an, protokolliert
// (stdout, optional --log <datei> als JSON-Zeilen) und antwortet { t: 'bot.antwort', botId, befehl, status: 'ok', textId: '<befehl>.ok', text, variante }.
// Texte: content/bots/texte.json ({ "<textId>": ["Variante 0", ...] }). botId nach Rolle: navigation b0, ops b1, technik b2, bord b2 (der Server vergibt nie b3; in der Partie haelt meist die Technik den Bord-Dienst), alle b0; eine botId bleibt.
// "variante" (Index in der Textliste) ist ein Vorschlag fuer den Vertrag: so spielt der Client den Clip zu genau dem Text, den der Untertitel zeigt.
// Aufruf:  node tools/bot-befehl-mock.js [--port 8710] [--log mock.log]      (npm run bot:mock)     Client: ?botmock=ws://localhost:8710
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const KATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bot-messung', 'katalog.json'), 'utf8'));
const TEXTE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', 'texte.json'), 'utf8'));
const ROLLEN = { navigation: 'b0', ops: 'b1', technik: 'b2', bord: 'b2', alle: 'b0' };
const QUELLEN = ['menu', 'taste', 'sprache', 'text'];

function botIdFuer(an) { return ROLLEN[an] || (/^b\d$/.test(String(an)) ? an : null); }

function startMock(opt) {
  const o = opt || {};
  const texte = o.texte || TEXTE;
  const zaehler = {};   // textId -> naechste Variante (reihum, damit Tests deterministisch bleiben)
  const protokoll = [];
  const logDatei = o.log || null;
  const logge = (obj) => {
    protokoll.push(obj);
    const zeile = JSON.stringify(obj);
    if (!o.leise) console.log('[bot-mock] ' + zeile);
    if (logDatei) { try { fs.appendFileSync(logDatei, zeile + '\n'); } catch (e) { /* Log ist Beiwerk */ } }
  };
  const wss = new WebSocketServer({ port: o.port != null ? o.port : 8710, host: o.host || '127.0.0.1', maxPayload: 16 * 1024 });

  function antworte(m) {
    const bekannt = KATALOG.some((k) => k.befehl === m.befehl);
    const botId = botIdFuer(m.an);
    if (!bekannt || !botId || !QUELLEN.includes(m.quelle)) {
      const grund = !bekannt ? 'unbekannt' : !botId ? 'adressat' : 'quelle';
      return { t: 'bot.antwort', botId: botId || 'b0', befehl: String(m.befehl), status: 'abgelehnt', textId: String(m.befehl) + '.abgelehnt.' + grund };
    }
    const textId = m.befehl + '.ok', liste = texte[textId] || [];
    const variante = liste.length ? (zaehler[textId] = ((zaehler[textId] == null ? -1 : zaehler[textId]) + 1) % liste.length) : null;
    return Object.assign({ t: 'bot.antwort', botId, befehl: m.befehl, status: 'ok', textId }, liste.length ? { text: liste[variante], variante } : {});
  }

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch (e) { return logge({ zeit: new Date().toISOString(), fehler: 'kein-json' }); }
      if (!m || m.t !== 'bot.befehl') return logge({ zeit: new Date().toISOString(), ignoriert: m && m.t });
      const a = antworte(m);
      logge({ zeit: new Date().toISOString(), ein: m, aus: a });
      if (ws.readyState === 1) ws.send(JSON.stringify(a));
    });
    ws.on('error', () => { /* close folgt */ });
  });
  const bereit = new Promise((resolve) => wss.on('listening', () => resolve(wss.address().port)));
  return { wss, bereit, protokoll, close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }) };
}

if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const port = +arg('port', 8710), log = arg('log', null);
  const m = startMock({ port, log });
  m.bereit.then((p) => console.log(`[bot-mock] lauscht auf ws://127.0.0.1:${p}${log ? ', Log ' + log : ''}  (Client: ?botmock=ws://localhost:${p})`));
}

module.exports = { startMock, KATALOG, TEXTE, botIdFuer };
