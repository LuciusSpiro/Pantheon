'use strict';
// HYG-02 A: Versionsnummer im Startmenü. package.json ist die EINE Quelle.
//  1. Server: GET /version.json liefert {"version": <package.json>} (application/json, no-cache); SERVER_VERSION (server/game.js) = package.json, kein zweiter Eintrag im Quelltext.
//  2. Menü (menue.js): ladeVersion() setzt lies().version aus dem Server; Fehler, Unsinn oder fehlende Quelle lassen die Version leer und das Menü unberührt.
//  3. Menü (menue-ui.js): zeichne() legt die Zeile „v<Version>“ unten rechts an (Gold, rechtsbündig, innerhalb 640×360) NUR auf Titel und Hauptmenü; Lobby, Raumcode-Eingang, Einladung und Moduswahl-Überlagerung zeichnen sie nicht; ohne Version nichts.
//  4. Mutationsprobe: Versionsnummer im Server von Hand gesetzt bzw. Zeile aus dem Menü entfernt → der Test wird rot. Der Server wird dafür im Speicher geladen (keine Dateien im Repo).
//   node tools/test-version.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const Module = require('module');
const PKG = require('../package.json');
const Protocol = require('../shared/protocol.js');
const TOKENS = require('../public/js/menue-tokens.js');
const ROOT = path.join(__dirname, '..');
const Q = { game: path.join(ROOT, 'server', 'game.js'), index: path.join(ROOT, 'server', 'index.js'), menue: path.join(ROOT, 'public', 'js', 'menue.js'), ui: path.join(ROOT, 'public', 'js', 'menue-ui.js') };

let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name) { console.log('\n[' + name + ']'); }
const lies = (p) => fs.readFileSync(p, 'utf8');

function modul(quelltext, extern) {
  const m = { exports: {} };
  new Function('module', 'exports', 'self', 'require', quelltext)(m, m.exports, undefined, extern || require);
  return m.exports;
}
// Quelltext als Modul mit dem echten Pfad kompilieren (ohne Datei im Repo); landet unter dem Pfad im require.cache, damit index.js dasselbe game.js bekommt
function ladeImSpeicher(datei, quelltext) {
  const m = new Module(datei, module);
  m.filename = datei;
  m.paths = Module._nodeModulePaths(path.dirname(datei));
  require.cache[datei] = m;
  m._compile(quelltext, datei);
  m.loaded = true;
  return m.exports;
}
function holen(port, pfad) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pfad }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }).on('error', reject);
  });
}

// Menü-Oberfläche in Node: Render zeichnet nichts, merkt sich aber jeden Text (Zeichenkette, x, y, Farbe, Ausrichtung)
function ui(F, quelltext) {
  const texte = [];
  const noop = () => {};
  const R = { text: (c, s, x, y, o) => { texte.push({ s: String(s), x, y, farbe: o && o.color, align: o && o.align }); }, measure: (s, sk) => String(s).length * 6 * (sk || 1), wrap: (s) => [String(s)], shape: noop, ui: { buttons: [] } };
  const ctx = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop), set: () => true });
  const win = { Render: R, Pult: { rgba: () => '#000000', cham: noop }, Menue: TOKENS, MenueFluss: F, Hud: { fit: (s) => String(s) }, Net: { status: 'open' }, Tasten: { passt: () => false } };
  new Function('window', 'Net', 'Tasten', quelltext)(win, win.Net, win.Tasten);
  return { net: win.Net, texte, zeichne: (view) => { texte.length = 0; R.ui.buttons.length = 0; win.MenueUi.zeichne(ctx, view); return texte.slice(); } };
}
const VIEW = { actions: {}, pid: 'p1', state: { lobby: { startMission: 'm1', worlds: [] }, players: [{ id: 'p1', name: 'A', ready: false, connected: true, color: 0 }] } };

// Alle Prüfungen gegen die Quelltexte; liefert die Zahl der Fehlschläge (für die Mutationsproben)
async function pruefe(q, laut) {
  let schlecht = 0;
  const p = (c, msg) => { if (laut) ok(c, msg); else if (!c) schlecht++; };

  // 1 Server
  if (laut) section('1 Server: /version.json und SERVER_VERSION');
  const gameQ = q.game, indexQ = q.index;
  p(/const SERVER_VERSION = require\('\.\.\/package\.json'\)\.version;/.test(gameQ), 'server/game.js liest SERVER_VERSION aus package.json (kein zweiter Eintrag)');
  p(!/SERVER_VERSION = '\d/.test(gameQ), 'server/game.js hat keine fest eingetragene Versionsnummer');
  p(/const PKG_VERSION = require\('\.\.\/package\.json'\)\.version;/.test(indexQ), 'server/index.js liest PKG_VERSION aus package.json (kein zweiter Eintrag)');
  p(!/PKG_VERSION = '\d/.test(indexQ), 'server/index.js hat keine fest eingetragene Versionsnummer');
  // Der Server wird aus dem (ggf. veränderten) Quelltext IM SPEICHER geladen, damit die Mutationsprobe greift; es wird nichts ins Repo geschrieben.
  // Echter Pfad als Dateiname, damit relative requires wie im Original auflösen; Cache-Einträge werden danach wieder entfernt.
  const dateiIndex = Q.index, dateiGame = Q.game;
  let h = null;
  try {
    const G = ladeImSpeicher(dateiGame, gameQ);
    const S = ladeImSpeicher(dateiIndex, indexQ);
    h = await S.startServer({ port: 0, quiet: true, noStore: true, roomCode: null });
    p(G.SERVER_VERSION === PKG.version, 'SERVER_VERSION = package.json (' + G.SERVER_VERSION + ' = ' + PKG.version + ')');
    const r = await holen(h.port, '/version.json');
    let d = null; try { d = JSON.parse(r.body); } catch (e) { /* bleibt null */ }
    p(r.status === 200, 'GET /version.json → 200');
    p(d && d.version === PKG.version && Object.keys(d).length === 1, 'GET /version.json = {"version":"' + PKG.version + '"} (package.json)');
    p(/^application\/json/.test(r.headers['content-type'] || ''), 'Content-Type application/json (' + r.headers['content-type'] + ')');
    p(r.headers['cache-control'] === 'no-cache', 'Cache-Control no-cache');
    const w = await holen(h.port, '/index.html');
    p(w.status === 200, 'die übrige Auslieferung bleibt unberührt (/index.html → 200)');
  } catch (e) { p(false, 'Server-Prüfung abgestürzt: ' + (e && e.message)); } finally {
    if (h) await h.close();
    for (const f of [dateiIndex, dateiGame]) delete require.cache[f];
  }

  // 2 Menü-Zustand
  if (laut) section('2 Menü: ladeVersion()');
  const A = modul(q.menue);
  const bau = (extra) => A.erzeuge(Object.assign({ protokoll: Protocol, senden: () => true, debug: false, szenenIds: () => [], weltstandMax: 5, verlasseRaum: () => true, oeffneKammer: () => true, charaktere: { MAX: 4, lies: () => ({ liste: [], gewaehlt: null }) } }, extra || {}));
  { const F = bau({ ladeVersion: () => Promise.resolve({ version: PKG.version }) });
    p(F.lies().version === null, 'vor dem Laden ist die Version leer');
    await F.ladeVersion(); p(F.lies().version === PKG.version, 'ladeVersion() übernimmt die Version des Servers');
    const schirm = F.lies().schirm; F.weiter(); p(schirm === 'titel' && F.lies().schirm === 'menue', 'das Menü läuft unverändert weiter (Titel → Hauptmenü)'); }
  for (const [name, quelle] of [['Netzfehler (Promise abgelehnt)', () => Promise.reject(new Error('x'))], ['Ausnahme beim Holen', () => { throw new Error('x'); }], ['Antwort ohne Version', () => Promise.resolve({})], ['keine Antwort (null)', () => Promise.resolve(null)], ['Unsinn statt Nummer', () => Promise.resolve({ version: '<b>1</b>' })], ['Zahl statt Text', () => Promise.resolve({ version: 1 })]]) {
    const F = bau({ ladeVersion: quelle }); let geworfen = false; try { await F.ladeVersion(); } catch (e) { geworfen = true; }
    p(!geworfen && F.lies().version === null && F.lies().schirm === 'titel', 'Version bleibt leer, Menü unberührt: ' + name);
  }
  { const F = bau(); let geworfen = false; try { await F.ladeVersion(); } catch (e) { geworfen = true; }
    p(!geworfen && F.lies().version === null, 'ohne Quelle (Node, kein fetch) bleibt die Version leer'); }

  // 3 Menü-Oberfläche
  if (laut) section('3 Menü: die Zeile wird angelegt');
  const erwartet = TOKENS.TOKENS.FARBE.gold, text = 'v' + PKG.version;
  const zeile = (ts) => ts.find((t) => t.s === text) || null;
  for (const schirm of ['titel', 'menue']) {
    const F = bau(); F.setzeVersion(PKG.version);
    if (schirm === 'menue') F.weiter();
    const U = ui(F, q.ui);
    const mit = U.zeichne(VIEW), z = zeile(mit);
    p(F.lies().schirm === schirm, schirm + ': Schirm erreicht');
    p(!!z, schirm + ': Zeile „' + text + '“ wird gezeichnet' + (z ? ' (x ' + z.x + ', y ' + z.y + ')' : ''));
    if (z) {
      p(z.align === 'right' && z.x >= 600 && z.x <= 640, schirm + ': rechtsbündig am rechten Rand (x ' + z.x + ')');
      p(z.y >= 342 && z.y + 7 <= 360, schirm + ': in der unteren Zeile (y ' + z.y + '), innerhalb 640×360');
      p(z.farbe === erwartet, schirm + ': Gold aus den Tokens (' + z.farbe + ')');
      p(z.x - 6 * text.length >= 560, schirm + ': schmal, beginnt rechts von x 560 (Textbreite ' + 6 * text.length + ' px)');
    }
    F.setzeVersion(null); p(!zeile(U.zeichne(VIEW)), schirm + ': ohne Version keine Zeile');
  }
  // nicht auf den übrigen Schirmen: Lobby, Moduswahl-Überlagerung, Einladung, Raumcode-Eingang (auch mit geladener Version)
  const ohne = (name, hinfuehren) => { const F = bau(); F.setzeVersion(PKG.version); const U = ui(F, q.ui); const r = hinfuehren(F, U); const ts = U.zeichne(r.view || VIEW); p(r.ok, name + ': Schirm erreicht'); p(!ts.some((t) => /^v\d/.test(t.s)), name + ': keine Versionszeile'); };
  ohne('Lobby', (F) => { F.imRaum(); return { ok: F.lies().schirm === 'lobby' && !F.lies().modusOffen }; });
  ohne('Moduswahl-Überlagerung', (F) => { F.imRaum(); F.oeffneModusWahl(VIEW.state.lobby); return { ok: F.lies().modusOffen === true }; });
  ohne('Einladung', (F) => { F.starte({ link: true }); return { ok: F.lies().schirm === 'einladung' }; });
  ohne('Raumcode-Eingang', (F, U) => { U.net.badCode = true; return { ok: F.lies().schirm === 'titel' && !!F.raumcodeEingang({ badCode: true, verbunden: true, hatSpieler: false, roomCode: '' }), view: { actions: {}, pid: 'x', state: { lobby: { worlds: [] }, players: [] } } }; });
  { const F = bau(); F.setzeVersion(PKG.version); const U = ui(F, q.ui), a = U.zeichne(VIEW).filter((t) => t.s !== text), b = (F.setzeVersion(null), U.zeichne(VIEW));
    p(JSON.stringify(a) === JSON.stringify(b), 'alle übrigen Texte des Titels sind mit und ohne Version gleich (nichts verschoben)'); }
  return schlecht;
}

(async () => {
  const q = { game: lies(Q.game), index: lies(Q.index), menue: lies(Q.menue), ui: lies(Q.ui) };
  try { await pruefe(q, true); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }

  // 4 Mutationsproben: Quelltext verändern, der Test muss rot werden
  section('4 Mutationsproben (Quelltext zerstören)');
  const mut = [
    ['SERVER_VERSION fest eingetragen', 'game', (s) => s.replace(/require\('\.\.\/package\.json'\)\.version;/, "'9.9.9';")],
    ['/version.json liefert fremde Version', 'index', (s) => s.replace('JSON.stringify({ version: PKG_VERSION })', "JSON.stringify({ version: '9.9.9' })")],
    ['index.js: PKG_VERSION fest eingetragen', 'index', (s) => s.replace(/const PKG_VERSION = require\('\.\.\/package\.json'\)\.version;/, "const PKG_VERSION = '0.1.0';")],
    ['Menü zeichnet die Zeile nicht', 'ui', (s) => s.replace('versionZeile(ctx);', '')],
    ['Menü zeichnet die Zeile auch in der Lobby', 'ui', (s) => s.replace("if (!ein && (s === 'titel' || s === 'menue')) versionZeile(ctx);", 'versionZeile(ctx);')],
    ['Zeile nicht in Gold', 'ui', (s) => s.replace("MF.gold, 'right'", "MF.messing, 'right'")],
    ['Menü übernimmt die Version nicht', 'menue', (s) => s.replace('store.version = typeof v', 'store.version = null && typeof v')],
  ];
  for (const [name, wo, f] of mut) {
    const neuQ = Object.assign({}, q); const alt = q[wo]; neuQ[wo] = f(alt);
    const anwendbar = neuQ[wo] !== alt;
    let rot = 0; try { rot = await pruefe(neuQ, false); } catch (e) { rot = 1; }
    ok(anwendbar && rot > 0, 'Mutation „' + name + '“ → Test rot (' + rot + ' Fehlschläge)');
  }

  console.log('\n' + (n - fails) + '/' + n + ' ok');
  process.exit(fails ? 1 : 0);
})();
