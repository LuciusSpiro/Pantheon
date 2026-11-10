'use strict';
// LIV-02 P2: Frage „Limit erhöhen?“ im Client, ohne Browser.
//  1. public/js/kontingent-frage.js (Modell): keine Frage ohne Ereignis, nur für die eigene pid, schließt bei kontingentErledigt, Doppelklick sendet einmal,
//     Fehlerpfad (code fehler / notice), Wartezeit, welcome leert, keine Zahlen im Text, Befehle im Protokollformat
//  2. public/js/kontingent-frage-ui.js (Popup) gegen ein Fake-DOM: kein Element ohne Frage, Aufbau (Dialog, nicht modal, Ja/Nein), Klicks, schließt bei Erledigt
//  3. Reste: keine Taste allgemein.kontingentFreigeben, keine Reste von world.kontingent / KontingentUi / kontingent-ui im public/
// Die Erwartungen stehen hier selbst. Aufruf: node tools/test-kontingent-frage.js   (npm run test:kontingent-frage)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
process.chdir(path.join(__dirname, '..'));
const Protocol = require('../shared/protocol.js');
const K = require('../public/js/kontingent-frage.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const welcome = (pid) => K.lesen({ t: 'welcome', pid });
const ev = (kind, o) => K.lesen(Object.assign({ t: 'event', kind, pid: 0 }, o));
const gesendet = () => { const l = []; l.send = (m) => { l.push(m); return true; }; return l; };

section('Modell: keine Frage ohne Ereignis');
welcome(0);
ok(K.modell(0) === null && !K.offen(), 'nach welcome: keine Frage');
K.lesen({ t: 'snap', phase: 'play', world: {} });
ok(K.modell(0) === null, 'Snapshot ohne Ereignis: keine Frage');
ev('notice', { text: 'x' });
ev('kontingentAntwort', { ok: true, op: 'freigeben' });
ev('kontingentErledigt');
ok(K.modell(0) === null, 'Antwort und Erledigt ohne offene Frage: nichts');
{ const l = gesendet(); ok(K.freigeben(l.send, 0) === false && K.ablehnen(l.send, 0) === false && l.length === 0, 'ohne Frage senden die Funktionen nichts'); }

section('Modell: Frage nur für die eigene pid');
welcome(0);
ev('kontingentFrage', { pid: 1 });
ok(K.modell(0) === null, 'Frage für fremde pid: kein Popup');
ev('kontingentFrage', { pid: undefined });
ok(K.modell(0) === null, 'Frage ohne pid: kein Popup');
welcome(2);
ev('kontingentFrage', { pid: 0 });
ok(K.modell(0) === null, 'eigene pid 2, Frage an 0: kein Popup');
welcome(0);
ev('kontingentFrage', { pid: 0 });
let m = K.modell(0);
ok(m && K.offen(), 'Frage für die eigene pid: Popup');
ok(m.titel === 'Limit erhöhen?' && m.ja === 'Ja' && m.nein === 'Nein' && m.aktiv && m.fehler === '', 'Titel, Ja/Nein, Knöpfe aktiv, kein Fehler');
ok(!/\d/.test(m.titel + m.text + m.ja + m.nein + K.TEXT.fehler), 'keine Zahlen in den Texten');
ok(/Spielleiter/.test(m.text) && /erreicht/.test(m.text), 'Text nennt Spielleiter und erreicht');

section('Befehle, Doppelklick');
{
  const l = gesendet();
  ok(K.freigeben(l.send, 1000) === true && l.length === 1, 'Ja: ein Befehl');
  ok(l[0].t === 'cmd' && l[0].c === Protocol.CMD_KONTINGENT_FREIGEBEN && l[0].c === 'kontingent.freigeben' && Object.keys(l[0]).length === 2, 'Befehl { t: cmd, c: kontingent.freigeben }, sonst nichts');
  ok(K.freigeben(l.send, 1100) === false && K.ablehnen(l.send, 1100) === false && l.length === 1, 'Doppelklick (auch Nein danach): kein zweiter Befehl');
  m = K.modell(1200);
  ok(m && m.wartet && !m.aktiv, 'während der Wartezeit: Knöpfe gesperrt');
  m = K.modell(1000 + K.WARTE_MS + 1);
  ok(m && !m.wartet && m.aktiv, 'bleibt die Antwort aus: nach der Wartezeit wieder frei');
  ok(K.ablehnen(l.send, 1000 + K.WARTE_MS + 2) === true && l.length === 2, 'danach ein neuer Versuch (Nein)');
  ok(l[1].c === Protocol.CMD_KONTINGENT_ABLEHNEN && l[1].c === 'kontingent.ablehnen' && Object.keys(l[1]).length === 2, 'Befehl { t: cmd, c: kontingent.ablehnen }');
}

section('Antworten, Erledigt');
{
  welcome(0); ev('kontingentFrage', { pid: 0 });
  const l = gesendet(); K.freigeben(l.send, 0);
  ev('kontingentAntwort', { ok: true, op: 'freigeben', pid: 1 });
  ok(K.modell(10) && K.modell(10).wartet, 'Antwort an eine fremde pid wird ignoriert');
  ev('kontingentErledigt', { pid: 1 });
  ok(K.modell(10) !== null, 'Erledigt einer fremden pid schließt nicht');
  ev('kontingentAntwort', { ok: true, op: 'freigeben' });
  ok(K.modell(10) !== null, 'Antwort ok allein schließt nicht (das tut kontingentErledigt)');
  ev('kontingentErledigt');
  ok(K.modell(20) === null && !K.offen() && !K.store.wartet, 'kontingentErledigt: Popup zu');
  ev('kontingentFrage', { pid: 0 });
  ok(K.modell(30) !== null && K.modell(30).aktiv, 'neue Frage (nächste Schwelle): Popup wieder da, Knöpfe frei');
}

section('Fehlerpfad');
{
  welcome(0); ev('kontingentFrage', { pid: 0 });
  let l = gesendet(); K.freigeben(l.send, 0);
  ev('kontingentAntwort', { ok: false, op: 'freigeben', code: 'fehler', text: 'Limit 560000 nicht gesetzt' });
  m = K.modell(5);
  ok(m && m.aktiv && !m.wartet && m.fehler === K.TEXT.fehler, 'code fehler: Popup bleibt, kurzer Fehlertext, Knöpfe frei');
  ok(!/\d/.test(m.fehler), 'Fehlertext ohne Zahlen (der Servertext wird nicht angezeigt)');
  ok(K.ablehnen(l.send, 6) === true && K.modell(7).fehler === '', 'neuer Versuch löscht den Fehlertext');
  ev('notice', { text: 'Nur die Captain-Konsole.' });
  m = K.modell(8);
  ok(m && m.aktiv && m.fehler === K.TEXT.fehler, 'notice als Antwort auf den Befehl: Popup bleibt, Fehlertext, Knöpfe frei');
  ev('notice', { text: 'irgendwas', pid: 5 });
  ok(K.modell(9).fehler === K.TEXT.fehler, 'notice an andere pid wird ignoriert (Zustand unverändert)');
  welcome(0); ev('kontingentFrage', { pid: 0 });
  ev('notice', { text: 'ohne Befehl' });
  ok(K.modell(0).fehler === '' && K.modell(0).aktiv, 'notice ohne laufenden Befehl ändert nichts');
}

section('welcome leert');
welcome(0); ev('kontingentFrage', { pid: 0 });
{ const l = gesendet(); K.freigeben(l.send, 0); }
welcome(0);
ok(K.modell(1) === null && !K.store.wartet && !K.store.fehler, 'welcome: Popup zu, Zustand leer (der Server stellt neu zu, falls offen)');
ev('kontingentFrage', { pid: 0 });
ok(K.modell(2) !== null && K.modell(2).aktiv, 'Neu zugestellte Frage: Popup, Knöpfe frei');
K.lesen(null); K.lesen('x'); K.lesen({ t: 'event' }); K.lesen({ t: 'event', kind: 'kontingentFrage', pid: {} });
ok(K.modell(3) !== null, 'Müll wirft nicht');

section('Popup (Fake-DOM)');
function dom() {
  const elems = [];
  const knoten = (tag) => {
    const k = { tag, attrs: {}, style: {}, children: [], handlers: {}, disabled: false, textContent: '', innerHTML: '', className: '', id: '' };
    k.setAttribute = (a, v) => { k.attrs[a] = v; };
    k.addEventListener = (ev2, f) => { k.handlers[ev2] = f; };
    k.blur = () => { k.blurred = true; };
    k.appendChild = (c) => { k.children.push(c); return c; };
    k.sub = {};
    k.querySelector = (sel) => k.sub[sel] || (k.sub[sel] = knoten('sub'));
    elems.push(k);
    return k;
  };
  const doc = { createElement: knoten, head: knoten('head'), body: knoten('body'), listeners: [] };
  doc.addEventListener = (e, f) => doc.listeners.push(e); doc.elems = elems;
  return doc;
}
{
  const doc = dom();
  const handler = [], sends = [];
  const sb = { document: doc, Date, setTimeout: () => 0, clearTimeout: () => {}, console, Net: { on: (f) => handler.push(f), send: (m) => { sends.push(m); return true; } }, Shared_Protocol: Protocol };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync('public/js/kontingent-frage.js', 'utf8'), sb);
  vm.runInContext(fs.readFileSync('public/js/kontingent-frage-ui.js', 'utf8'), sb);
  const feed = (msg) => handler.forEach((f) => f(msg));
  ok(handler.length === 2, 'Modell und Popup hängen sich an Net.on');
  const Kf = sb.KontingentFrage;
  feed({ t: 'welcome', pid: 0 });
  feed({ t: 'snap', phase: 'play', world: {} });
  feed({ t: 'event', kind: 'kontingentFrage', pid: 1 });
  ok(doc.elems.length === 2 && !sb.KontingentFrageUi.element(), 'kein Elementbau ohne Frage (auch nicht für fremde pid)');
  feed({ t: 'event', kind: 'kontingentFrage', pid: 0 });
  const el = sb.KontingentFrageUi.element();
  ok(!!el && el.style.display === '', 'Frage für die eigene pid: Popup gebaut und sichtbar');
  ok(el.attrs.role === 'dialog' && !('aria-modal' in el.attrs), 'role dialog, aria-modal nicht gesetzt (nicht modal)');
  ok(/<button type="button" class="kf-ja">/.test(el.innerHTML) && /class="kf-nein"/.test(el.innerHTML) && !/tabindex/i.test(el.innerHTML), 'zwei Knöpfe, kein tabindex (fokussierbar, kein Fokusfang)');
  const css = doc.head.children[0].textContent;
  ok(/position:fixed/.test(css) && !/backdrop|100vh|inset:0|pointer-events:none/.test(css), 'feste kleine Box, kein Backdrop, kein Vollflächen-Element');
  ok(/max-width:min\(420px/.test(css), 'schmal (max 420 px)');
  ok(!el.handlers.keydown && !doc.listeners.length && !/keydown|keyup|focus\(\)/.test(fs.readFileSync('public/js/kontingent-frage-ui.js', 'utf8')), 'keine Tastenbehandlung, kein Fokus-Aufruf');
  const ja = el.sub['.kf-ja'], nein = el.sub['.kf-nein'];
  ok(ja.textContent === 'Ja' && nein.textContent === 'Nein' && !ja.disabled && !nein.disabled, 'Knöpfe „Ja“ / „Nein“ aktiv');
  let pd = 0; const klick = (k) => k.handlers.click({ preventDefault: () => { pd++; } });
  klick(ja); klick(ja); klick(nein);
  ok(sends.length === 1 && sends[0].c === 'kontingent.freigeben', 'Doppelklick: ein Befehl, Ja = kontingent.freigeben');
  ok(ja.disabled && nein.disabled, 'nach dem Senden: beide Knöpfe gesperrt');
  feed({ t: 'event', kind: 'kontingentAntwort', pid: 0, op: 'freigeben', ok: false, code: 'fehler', text: 'x' });
  ok(!ja.disabled && !nein.disabled && el.sub['.kf-fehler'].textContent === Kf.TEXT.fehler && el.style.display === '', 'Fehler: Popup bleibt, Fehlertext, Knöpfe frei');
  klick(nein);
  ok(sends.length === 2 && sends[1].c === 'kontingent.ablehnen', 'Nein = kontingent.ablehnen');
  feed({ t: 'event', kind: 'kontingentAntwort', pid: 0, op: 'ablehnen', ok: true });
  feed({ t: 'event', kind: 'kontingentErledigt', pid: 0 });
  ok(el.style.display === 'none', 'kontingentErledigt: Popup zu');
  feed({ t: 'event', kind: 'kontingentFrage', pid: 0 });
  feed({ t: 'welcome', pid: 0 });
  ok(el.style.display === 'none', 'welcome: Popup zu');
  ok(!/\d/.test(el.sub['.kf-titel'].textContent + el.sub['.kf-text'].textContent + ja.textContent + nein.textContent), 'sichtbare Texte ohne Zahlen');
}

section('Reste');
{
  const tasten = fs.readFileSync('public/js/tasten.js', 'utf8');
  ok(!/kontingentFreigeben/.test(tasten), 'tasten.js: keine Aktion allgemein.kontingentFreigeben');
  global.window = { localStorage: null };
  require('../public/js/tasten.js');
  const T = global.window.Tasten; delete global.window;
  ok(!!T && !JSON.stringify(T.AKTIONEN || T.aktionen || []).includes('kontingent'), 'Tasten-Modul lädt ohne Kontingent-Aktion');
  const treffer = [];
  const lauf = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) lauf(p); else if (/\.(js|html|css)$/.test(f.name)) { const t = fs.readFileSync(p, 'utf8'); if (/world\.kontingent|KontingentUi\b|kontingent-ui|Kontingent\.(store|modell)|kontingentFreigeben|500 000 Tokens/.test(t)) treffer.push(p); } } };
  lauf('public');
  ok(treffer.length === 0, 'public/: keine Reste von world.kontingent / KontingentUi / kontingent-ui / Streifen-Text ' + treffer.join(','));
  const html = fs.readFileSync('public/index.html', 'utf8');
  ok(/js\/kontingent-frage\.js/.test(html) && /js\/kontingent-frage-ui\.js/.test(html) && html.indexOf('kontingent-frage.js') < html.indexOf('kontingent-frage-ui.js'), 'index.html: Modell vor Popup eingebunden');
  ok(!fs.existsSync('public/js/kontingent.js') && !fs.existsSync('public/js/kontingent-ui.js'), 'alte Dateien kontingent.js / kontingent-ui.js weg');
}

console.log('\n' + (n - fails) + '/' + n + ' bestanden' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
