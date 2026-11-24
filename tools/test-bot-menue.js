'use strict';
// BOT-01 C3: Befehlsmenü der Bots am Captain-Pult – Kern ohne Browser (public/js/bot-menue.js, Tokens public/js/pult-befehl-tokens.js, Tasten in tasten.js).
//  1. Daten: Abdeckung des Kanons (jeder Eintrag genau ein Platz, jeder Platz ein Eintrag, jeder Wert ein Feld), Crew-Zeile = Sprechformen, Farben, Kontraste, Tasten (Std, Bereich, keine Konflikte), keine Sprechform im Code
//  2. Ohne Bots ist nichts aktiv (keine Tafel, keine Nachricht, keine Zustandsreste)
//  3. Rollen: verfügbar / gesperrt (kein Bot, Mensch an Station, Bord nur Außenmission), Stufe 1
//  4. Stufen 1 bis 3, jedes Feld erzeugt genau die erwartete bot.befehl (quelle menu), Schließen nach Senden, Zurück, Blättern, Nachfrage, leere Felder
//  5. Direkttasten (quelle taste), gesperrte Rollen senden nichts
//  6. Zeit: 6 s Auto-Schließen (jede Tafeltaste setzt zurück), Sperrgrund, Quittung (gesendet, aye, abgelehnt, keine Antwort), Alle
//  7. Antworten: ok / abgelehnt / unmoeglich, Untertitel genau einmal, keine Doppelverarbeitung mit Sprache an
//  8. „gilt“: gesetzt nur von ok, verfällt bei Mensch an Station, Automatik, Reset
//  9. Einbindung (Quelltext): Reihenfolge in index.html, Tasten vor dem Reiter-Zweig, Esc vor leave(), tastenBereiche, Sprechspalte ohne Sprache, kein hartkodierter Tastencode, Kern ohne DOM/Netz
//   node tools/test-bot-menue.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BM = require('../public/js/bot-menue.js');
const TK = require('../public/js/pult-befehl-tokens.js');
const PS = require('../public/js/pult-systeme-tokens.js');
const BS = require('../public/js/bot-sprache.js');
const Protocol = require('../shared/protocol.js');
const KANON = require('../content/bots/kanon.json');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const sortiert = (v) => (Array.isArray(v) ? v.map(sortiert) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortiert(v[k])])) : v);
const eq = (a, b) => JSON.stringify(sortiert(a)) === JSON.stringify(sortiert(b));   // tief gleich, Reihenfolge der Schlüssel egal
const PUB = path.join(__dirname, '..', 'public', 'js');

// ------------------------------------------------------------------ Werkzeug
const ROLLEN3 = ['navigation', 'ops', 'technik'];
let botNr = 0;
const bot = (rolle) => ({ id: 'b' + (botNr++), bot: 1, rolle, connected: true });
const mensch = (konsole, station) => ({ id: 'm' + (botNr++), connected: true, console: konsole || null, station: station || null });
function mk(o) {
  o = o || {};
  const L = { senden: [], untertitel: [], denied: [], ton: [] };
  let t = 100000;
  const env = {
    kanon: KANON, tokens: TK, uhr: () => t,
    senden: (m) => { L.senden.push(m); return o.sendeFehler ? false : true; },
    anzeige: { untertitel: (text, info) => L.untertitel.push({ text, info }), denied: (x) => L.denied.push(x), ton: (x) => L.ton.push(x) },
    antwortenAnzeigen: o.antwortenAnzeigen, wertFrei: o.wertFrei, wertInfo: o.wertInfo, sprache: o.sprache,
    kappe: (id) => ({ 'captain.befehl.d': 'D', 'allgemein.sprechen': '^' }[id] || ''),
    befehlTyp: Protocol.C.BOT_BEFEHL,
  };
  const m = BM.erzeuge(env);
  const crew = o.crew || [bot('navigation'), bot('ops')];
  m.synchron(crew, 'play');
  return { m, L, warte: (ms) => { t += ms; }, jetzt: () => t, crew };
}
const letzte = (L) => L.senden[L.senden.length - 1];
const zelle = (m, f) => m.ansicht().zellen.find((z) => z.feld === f);
const texte = (m) => m.ansicht().zellen.map((z) => z.text).join('|');
const antwort = (botId, befehl, status, extra) => Object.assign({ t: Protocol.C.BOT_ANTWORT, botId, befehl, status, textId: befehl + '.' + status, text: 'Antwort ' + befehl }, extra || {});
// erwartete Nachricht aus dem Kanon (unabhängig vom Kern gerechnet)
function erwartet(e, wertId, quelle) {
  const args = {};
  for (const k of Object.keys(e.args)) { const pm = /^\{(\w+)\}$/.exec(String(e.args[k])); args[k] = pm ? (/^\d+$/.test(wertId) ? Number(wertId) : wertId) : e.args[k]; }
  const msg = { t: 'bot.befehl', an: e.an, befehl: e.befehl, quelle };
  if (Object.keys(args).length) msg.args = args;
  return msg;
}
const platz = (e) => { for (const k of Object.keys(e.args)) { const pm = /^\{(\w+)\}$/.exec(String(e.args[k])); if (pm) return { arg: k, name: pm[1], werte: (e.werte || {})[pm[1]] }; } return null; };

// Echtes pult.js (Skin je Aufruf) und pult-befehl.js im vm-Kontext mit Rastersimulation: fillRect malt in ein Pixelfeld, R.text wird aufgezeichnet.
// Damit lässt sich die Schriftfarbe gegen die Fläche UNTER dem Text messen (Designer-Review W1/K8).
function bauePult(skin, ship) {
  const px = new Array(640 * 360).fill('#000000'), texte = [];
  const ctx = { fillStyle: '#000000', strokeStyle: '', lineWidth: 1, globalAlpha: 1, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, strokeRect() {}, drawImage() {}, setTransform() {}, clearRect() {},
    fillRect(x, y, w, h) { if (/^#/.test(this.fillStyle)) for (let j = Math.max(0, y | 0); j < Math.min(360, (y + h) | 0); j++) for (let i = Math.max(0, x | 0); i < Math.min(640, (x + w) | 0); i++) px[j * 640 + i] = this.fillStyle; } };
  const ui = { buttons: [], mouse: { x: -1, y: -1 }, tooltip: null };
  const R = { PAL: new Proxy({}, { get: () => '#808080' }), ui, measure: (t) => String(t).length * 4, text: (c, t, x, y, o) => texte.push({ s: String(t), x, y, farbe: o.color, align: o.align }), button() {}, backdrop() {} };
  const view = { state: { ship: Object.assign({ systems: {}, fragile: [], mod: [1, 1, 1, 1] }, ship || {}) }, send() {}, actions: {}, time: 0 };
  const win = { Render: R, Shared_Config: {}, Shared_Protocol: Protocol, location: { search: '?pult=' + skin }, localStorage: { getItem() { return null; } }, URLSearchParams, console, performance: { now: () => 1000 }, Net: { send: () => true, on() {} } };
  win.window = win; vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(PUB, 'tasten.js'), 'utf8'), win);
  vm.runInContext(fs.readFileSync(path.join(PUB, 'pult.js'), 'utf8'), win);
  win.Consoles = { view, stationOf: () => null, denied() {}, helmInfo: () => ({ stages: [0, 1, 2, 3, 4, 5, 6], stop: 0, names: ['STOPP'], stage: 0 }), waffeAmPlatz: () => true };
  win.PultBefehlTokens = TK; win.BotMenue = BM;
  vm.runInContext(fs.readFileSync(path.join(PUB, 'pult-befehl.js'), 'utf8'), win);
  return { win, ctx, px, texte, ui, view };
}

(async () => {
  // ================================================================= 1. Daten
  section('1. Daten und Abdeckung');
  const index = BM.indexVon(KANON);
  const keys = KANON.befehle.map(BM.schluesselVon);
  ok(index.size === KANON.befehle.length && new Set(keys).size === keys.length, 'Schlüssel der Kanon-Einträge eindeutig (' + keys.length + ')');
  const st2 = []; for (const r of Object.keys(TK.LAGE.stufe2)) for (const [f, k] of Object.entries(TK.LAGE.stufe2[r])) st2.push({ r, f, k });
  ok(TK.FELDER.length === 9 && new Set(TK.FELDER).size === 9, '3x3 Felder Q W E A S D Y X C');
  ok(st2.every((x) => TK.FELDER.includes(x.f)), 'Stufe 2: nur gültige Felder');
  const gezaehlt = {}; for (const x of st2) gezaehlt[x.k] = (gezaehlt[x.k] || 0) + 1;
  ok(keys.every((k) => gezaehlt[k] === 1), 'jeder Kanon-Eintrag hat genau einen Platz in Stufe 2' + keys.filter((k) => gezaehlt[k] !== 1).map((k) => ' · ' + k).join(''));
  ok(st2.every((x) => index.has(x.k)), 'jeder Platz zeigt auf einen Kanon-Eintrag' + st2.filter((x) => !index.has(x.k)).map((x) => ' · ' + x.k).join(''));
  ok(st2.every((x) => index.get(x.k).an === x.r || (x.r === 'alle' && index.get(x.k).an === 'alle')), 'jede Rolle nur mit Befehlen ihres Kanon-Feldes an');
  ok(!KANON.befehle.some((e) => e.befehl === 'nav.sprung') && !st2.some((x) => /sprung/.test(x.k)), 'nav.sprung kommt nicht ins Menü');
  ok(Object.keys(TK.LAGE.stufe2).every((r) => Object.keys(TK.LAGE.stufe2[r]).length === new Set(Object.keys(TK.LAGE.stufe2[r])).size), 'kein Feld doppelt je Tabelle');
  // Werte (Stufe 3)
  const mitPlatz = KANON.befehle.filter((e) => platz(e));
  ok(mitPlatz.every((e) => TK.LAGE.stufe3[BM.schluesselVon(e)]), 'jeder Eintrag mit Wert hat eine Stufe-3-Tabelle (' + mitPlatz.length + ')');
  ok(Object.keys(TK.LAGE.stufe3).every((k) => index.has(k) && platz(index.get(k))), 'jede Stufe-3-Tabelle gehört zu einem Eintrag mit Wert');
  let wertOk = true, wertTxt = '';
  for (const e of mitPlatz) {
    const k = BM.schluesselVon(e), seiten = [].concat(TK.LAGE.stufe3[k]), p = platz(e), ids = [];
    for (const s of seiten) { for (const [f, id] of Object.entries(s)) { if (!TK.FELDER.includes(f) || !p.werte[id]) { wertOk = false; wertTxt += ' · ' + k + ':' + f + '=' + id; } ids.push(id); } if (Object.keys(s).length !== new Set(Object.keys(s)).size) wertOk = false; }
    const fehlt = Object.keys(p.werte).filter((id) => !ids.includes(id)), doppelt = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (fehlt.length || doppelt.length) { wertOk = false; wertTxt += ' · ' + k + ' fehlt ' + fehlt + ' doppelt ' + doppelt; }
  }
  ok(wertOk, 'jeder Kanon-Wert hat genau ein Feld (Seiten eingerechnet), jedes Feld einen Kanon-Wert' + wertTxt);
  ok(KANON.befehle.every((e) => TK.FN_BEFEHL[e.befehl]) && Object.values(TK.FN_BEFEHL).every((f) => ['drive', 'shield', 'weapon', 'sensor', 'nav', 'cmd', 'warn', 'neutral'].includes(f)), 'Funktionsfarbe für jeden Befehl, nur bekannte Schlüssel');
  ok(Object.values(TK.FARBE.rolle).every((f) => ['nav', 'weapon', 'shield', 'neutral', 'cmd'].includes(f)), 'Rollenfarben');
  ok(eq(Object.keys(TK.TEXT.seiten).sort(), ['tech.prio:ziel', 'tech.reparieren:system']) && TK.TEXT.seiten['tech.reparieren:system'].length === [].concat(TK.LAGE.stufe3['tech.reparieren:system']).length && TK.TEXT.seiten['tech.prio:ziel'].length === 2, 'Seitennamen passen zu den Seiten');
  // Crew-Zeile: Kurzformen sind Sprechformen aus dem Kanon
  const z0 = mk();
  const crew0 = z0.m.crew();
  ok(crew0.length === 6 && crew0[0].aktion === 'captain.befehl' && eq(crew0.slice(1).map((c) => c.text), ['Stopp', 'Ausweichen', 'Feuer frei', 'Feuer halt', 'Status']), 'Crew-Zeile: Befehle, Stopp, Ausweichen, Feuer frei, Feuer halt, Status (' + crew0.map((c) => c.text).join(', ') + ')');
  ok(TK.LAGE.direkt.every((d) => { const e = index.get(d.key), c = crew0.find((x) => x.aktion === d.aktion); return e && [e.anzeige].concat(e.kurz || []).includes(c.text) && c.label === e.anzeige; }), 'jede Kurzform der Crew-Zeile steht im Kanon, label = anzeige');
  ok(eq(crew0.slice(1).map((c) => c.fn), ['weapon', 'drive', 'weapon', 'weapon', 'sensor']), 'Farben der Direkttasten: Stopp rot, Ausweichen bernstein, Feuer rot, Status blau');
  // Kontraste (Spezifikation 6): roter Text nur titelRot
  const skinBg = {}; { const src = fs.readFileSync(path.join(PUB, 'pult.js'), 'utf8'); for (const sk of ['rom', 'germanen']) skinBg[sk] = new RegExp('SKINS\\.' + sk + ' = \\{[^}]*?\\bbg: \'(#[0-9A-Fa-f]{6})\'').exec(src)[1]; }
  ok(skinBg.rom && skinBg.germanen && Object.values(skinBg).every((bg) => PS.kontrast(TK.FARBE.titelRot, bg) >= 4.5), 'titelRot auf dem Grund beider Skins >= 4,5:1 (' + Object.values(skinBg).map((bg) => PS.kontrast(TK.FARBE.titelRot, bg).toFixed(1)).join(' / ') + ')');
  // Maße: alles innerhalb des Pult-Rahmens (Spezifikation 2)
  const Ms = TK.MASS;
  ok(Ms.S.ohneBots === 258 && Ms.S.mitBots === 240 && Ms.tafel.y === Ms.S.mitBots + 22, 'S 258 ohne, 240 mit Bots; Tafel beginnt am Pult (S + 22)');
  ok(Ms.raster.x + 3 * Ms.raster.zw + 2 * Ms.raster.sx === Ms.tafel.x + Ms.tafel.w && Ms.raster.y + 3 * Ms.raster.zh + 2 * Ms.raster.sy <= Ms.tafel.y + Ms.tafel.h && Ms.crew.y > Ms.tafel.y + Ms.tafel.h && Ms.crew.y + Ms.crew.zh <= 346 && Ms.crew.x + 6 * Ms.crew.zw + 5 * Ms.crew.sx === Ms.tafel.x + Ms.tafel.w, 'Raster 3x3 füllt die Tafel, Crew-Zeile darunter, 6 Knöpfe füllen 572 px');
  // Tasten
  const win = { localStorage: undefined }; vm.runInNewContext(fs.readFileSync(path.join(PUB, 'tasten.js'), 'utf8'), { window: win, console }, { filename: 'tasten.js' });
  const T = win.Tasten;
  const std = { 'captain.befehl': ['KeyB'], 'captain.bot.stopp': ['Shift+KeyX'], 'captain.bot.ausweichen': ['Shift+KeyA', 'Shift+KeyD'], 'captain.bot.feuerFrei': ['Shift+KeyF'], 'captain.bot.feuerHalt': ['Shift+KeyG'], 'captain.bot.status': ['Shift+KeyS'],
    'captain.befehl.q': ['KeyQ'], 'captain.befehl.w': ['KeyW'], 'captain.befehl.e': ['KeyE'], 'captain.befehl.a': ['KeyA'], 'captain.befehl.s': ['KeyS'], 'captain.befehl.d': ['KeyD'], 'captain.befehl.y': ['KeyZ'], 'captain.befehl.x': ['KeyX'], 'captain.befehl.c': ['KeyC'],
    'captain.befehl.weiter': ['KeyR'], 'captain.befehl.zurueck': ['Backspace'] };
  ok(Object.entries(std).every(([id, s]) => T.aktion(id) && T.aktion(id).gruppe === 'captain' && eq(T.aktion(id).std, s)), 'Tasten: Aktionen und Standardtasten laut Spezifikation (B, Sh+X, Sh+A/D, Sh+F, Sh+G, Sh+S, Q W E A S D Z X C, R, Rück)');
  ok(Object.keys(std).filter((id) => /^captain\.befehl\./.test(id)).every((id) => T.aktion(id).bereich === 'captain.befehl') && T.BEREICHE['captain.befehl'].vorrang === true, 'Tafelfelder gehören dem Vorrang-Bereich captain.befehl');
  ok(T.konflikte('captain').length === 0 && T.konflikte('allgemein').length === 0, 'keine Tastenkonflikte (captain, allgemein)');
  ok(!T.AKTIONEN.some((a) => a.gruppe === 'captain' && a.std.some((t) => /Escape/.test(t))), 'Esc ist keine Aktion des Bereichs (sonst Konflikt mit allgemein.verlassen)');
  ok(TK.FELDER.every((f) => TK.FELD_AKTION[f] && T.aktion(TK.FELD_AKTION[f])) && TK.LAGE.direkt.every((d) => T.aktion(d.aktion)), 'jedes Feld und jede Direkttaste hat eine Aktion in tasten.js');
  ok(T.kappe('captain.befehl') === 'B' && T.kappe('captain.bot.stopp') === 'Sh+X' && T.kappe('captain.bot.ausweichen') === 'Sh+A' && T.kappe('captain.befehl.y') === 'Z', 'Tastenkappen aus Tasten.kappe (Y zeigt ohne Layout-Karte Z)');
  // Beschriftung nur aus dem Kanon: keine Sprechform als Literal im Code
  const quellen = ['bot-menue.js', 'pult-befehl.js', 'pult-befehl-tokens.js'].map((f) => fs.readFileSync(path.join(PUB, f), 'utf8').split(String.fromCharCode(13)).join('').split('\n').map((z) => z.replace(/\/\/.*$/, '')).join('\n'));
  const woerter = new Set(); for (const e of KANON.befehle) { woerter.add(e.anzeige); for (const k of e.kurz || []) woerter.add(k); for (const w of Object.values(e.werte || {})) for (const v of Object.values(w)) { woerter.add(v.wort); for (const k of v.kurz || []) woerter.add(k); } }
  const doppelt = [...woerter].filter((w) => w.length > 3 && quellen.some((q) => q.includes("'" + w + "'") || q.includes('"' + w + '"')));
  ok(doppelt.length === 0, 'keine Sprechform des Kanons als Literal im Menücode (' + doppelt.join(', ') + ')');

  // ================================================================= 2. ohne Bots
  section('2. Ohne Bots ist nichts aktiv');
  {
    const x = mk({ crew: [mensch('captain'), mensch('helm')] });
    ok(!x.m.hatBots() && x.m.botsZahl() === 0 && !x.m.lies().aktiv, 'Menschen allein: hatBots false, Zustand nicht aktiv');
    ok(x.m.ansicht() === null && !x.m.istOffen(), 'keine Tafel');
    ok(x.m.oeffnen() === false && eq(x.L.denied, ['Keine Bots an Bord']) && x.L.senden.length === 0, 'B: nichts öffnet sich, Hinweis Keine Bots an Bord, nichts gesendet');
    const r = x.m.taste('captain.bot.stopp');
    ok(r.ok === false && x.L.senden.length === 0, 'Direkttaste ohne Bots sendet nichts');
    ok(x.m.waehle('Q').art === 'zu' && x.m.blaettern() === false && x.m.zurueck() === false, 'Tafelfunktionen ohne offene Tafel tun nichts');
    x.m.synchron([mensch('captain')], 'play');
    ok(JSON.stringify(x.m.lies()) === JSON.stringify({ offen: false, stufe: 1, rolle: null, key: null, seite: 0, gilt: {}, ausstehend: 0, aktiv: false }), 'Zustand unverändert (leer)');
    ok(x.m.antwort({ t: 'bot.antwort', botId: null, befehl: null, status: 'abgelehnt', textId: 'befehl.abgelehnt.unbekannt' }).verarbeitet === true && x.m.crew()[0].quittung === null, 'eine fremde Antwort ohne Befehl ändert keine Quittung');
    // Bots, die nicht verbunden sind, zählen nicht
    const y = mk({ crew: [mensch('captain'), Object.assign(bot('ops'), { connected: false })] });
    ok(!y.m.hatBots(), 'getrennter Bot zählt nicht');
    // Schleife über die Spieler ohne Zuteilung: dieselben Objekte, keine neuen Arrays (Rollenstand wird wiederverwendet)
    const rs = x.m.rollenStand(); x.m.synchron([mensch('captain')], 'play');
    ok(x.m.rollenStand() === rs, 'Rollenstand wird wiederverwendet (keine Zuteilung je Bild)');
  }

  // ================================================================= 3. Rollen
  section('3. Rollen und Stufe 1');
  {
    const x = mk({ crew: [mensch('captain'), bot('navigation'), bot('ops')] });
    ok(x.m.hatBots() && x.m.botsZahl() === 2, 'zwei Bots erkannt');
    ok(x.m.oeffnen() === true && x.m.lies().stufe === 1 && x.m.istOffen(), 'B öffnet auf Stufe 1');
    const a = x.m.ansicht();
    ok(a.pfad === 'BEFEHL' && a.fn === 'cmd' && a.rechts.text === 'B / Esc schließt', 'Titel BEFEHL, rechts B / Esc schließt');
    const q = zelle(x.m, 'Q'), w = zelle(x.m, 'W'), e = zelle(x.m, 'E'), aa = zelle(x.m, 'A'), s = zelle(x.m, 'S');
    ok(q.text === 'Navigation' && q.zustand === 'bereit' && q.fn === 'nav' && w.text === 'Ops' && w.fn === 'weapon' && w.zustand === 'bereit', 'Q Navigation, W Ops bereit in Rollenfarbe');
    ok(e.text === 'Technik' && e.zustand === 'aus' && e.info === 'kein Bot' && e.fn === 'shield', 'E Technik: kein Bot, gesperrt');
    ok(aa.text === 'Bord' && aa.zustand === 'aus' && aa.info === 'nur Außenmission', 'A Bord: nur Außenmission');
    ok(s.text === 'Alle' && s.zustand === 'bereit' && s.info === '2 Bots' && s.fn === 'cmd', 'S Alle: 2 Bots');
    ok(['D', 'Y', 'X', 'C'].every((f) => zelle(x.m, f).zustand === 'leer'), 'D Y X C leer');
    ok(a.fuss === null, 'Sprache aus: keine Fußzeile');
    const y = mk({ crew: [mensch('captain'), bot('ops')], sprache: () => true });
    y.m.oeffnen();
    ok(y.m.ansicht().fuss === '^ halten und sagen, was hier steht: dieselben Befehle per Sprache' && zelle(y.m, 'S').info === '1 Bot', 'Sprache an: Fußzeile mit Sprechtaste; ein Bot: „1 Bot“');
    // Mensch an Station: der Bot wartet
    const h = mk({ crew: [mensch('captain'), mensch('helm'), bot('navigation'), bot('technik')] });
    h.m.oeffnen();
    ok(zelle(h.m, 'Q').zustand === 'aus' && zelle(h.m, 'Q').info === 'Mensch an Station' && zelle(h.m, 'E').zustand === 'bereit', 'Mensch am Steuer: Navigation gesperrt (Mensch an Station), Technik bereit');
    ok(h.m.waehle('Q').art === 'sperre' && h.m.lies().stufe === 1 && h.L.denied.length === 1 && /Mensch/.test(h.L.denied[0]) && h.L.senden.length === 0, 'Taste auf gesperrtem Feld: Grund, nichts gesendet, Stufe bleibt');
    ok(h.m.ansicht().rechts.stil === 'warn' && h.m.ansicht().rechts.text === h.L.denied[0], 'Grund steht 2 s rechts im Titel (Warnfarbe)');
    // Mensch per Tab (station weicht von console ab)
    const t = mk({ crew: [mensch('captain'), mensch('captain', 'weapons'), bot('ops')] });
    t.m.oeffnen();
    ok(zelle(t.m, 'W').zustand === 'aus' && zelle(t.m, 'W').grund === 'mensch', 'Mensch per Tab auf Ops: Ops gesperrt (station zählt vor console)');
    // Bord mit Bot der Rolle bord
    const b = mk({ crew: [mensch('captain'), bot('bord')] });
    b.m.oeffnen();
    ok(zelle(b.m, 'A').zustand === 'bereit', 'Bord mit Bot der Rolle bord: bereit');
    // Mensch an der Station, aber der Bot fehlt: Rolle bleibt „kein Bot“
    const k = mk({ crew: [mensch('captain'), mensch('technik'), bot('ops')] });
    k.m.oeffnen();
    ok(zelle(k.m, 'E').info === 'kein Bot', 'Mensch an Technik, kein Technik-Bot: kein Bot');
  }

  // ================================================================= 4. Stufen und Felder
  section('4. Stufen, Felder und gesendete Nachrichten');
  {
    const x = mk({ crew: [mensch('captain'), bot('navigation'), bot('ops'), bot('technik')] });
    x.m.oeffnen(); x.m.waehle('W');
    ok(x.m.lies().stufe === 2 && x.m.lies().rolle === 'ops', 'B W: Stufe 2 Ops');
    const a = x.m.ansicht();
    ok(a.pfad === 'BEFEHL · OPS' && a.fn === 'weapon' && a.rechts.text === 'B zurück · Esc zu', 'Titel BEFEHL · OPS, rechts B zurück · Esc zu');
    ok(texte(x.m) === 'Feuer frei|Feuer einstellen|Feuer frei …|Nächstes Ziel|Ziel markieren|Scannen|Landepunkt scannen|… an Bord|', 'Ops: Texte aus dem Kanon, „…“ für Werte (' + texte(x.m) + ')');
    ok(eq(a.zellen.map((z) => z.fn), ['weapon', 'weapon', 'weapon', 'sensor', 'sensor', 'sensor', 'sensor', 'neutral', 'neutral']), 'Ops: Funktionsfarben (Spezifikation Tabelle)');
    x.m.waehle('E');
    ok(x.m.lies().stufe === 3 && x.m.ansicht().pfad === 'BEFEHL · OPS · FEUER FREI …', 'B W E: Stufe 3, Titel mit ganzer Sprechform');
    ok(texte(x.m) === '|Bugwaffen||Backbordbatterie|alle Waffen|Steuerbordbatterie||Torpedo|' && zelle(x.m, 'Q').zustand === 'leer', 'Feuer frei …: Kompass W Bug, A Backbord, D Steuerbord, X Torpedo, S alle');
    const r = x.m.waehle('W');
    ok(r.art === 'gesendet' && eq(letzte(x.L), { t: 'bot.befehl', an: 'ops', befehl: 'ops.feuer_frei', args: { waffen: 'bug' }, quelle: 'menu' }), 'B W E W sendet bot.befehl ops.feuer_frei waffen=bug quelle menu');
    ok(!x.m.istOffen(), 'Tafel schließt nach dem Senden');
    // leeres Feld
    x.m.oeffnen(); x.m.waehle('W'); x.m.waehle('E');
    ok(x.m.waehle('Q').art === 'leer' && x.m.lies().stufe === 3 && x.L.senden.length === 1, 'leeres Feld: nichts passiert');
    // zurück
    ok(x.m.zurueck() && x.m.lies().stufe === 2 && x.m.zurueck() && x.m.lies().stufe === 1 && x.m.zurueck() && !x.m.istOffen(), 'B / Rück: Stufe 3 → 2 → 1 → zu');
    x.m.oeffnen(); x.m.waehle('Q'); x.m.umschalten();
    ok(x.m.lies().stufe === 1 && x.m.istOffen(), 'B bei offener Tafel geht eine Stufe zurück');
    ok(x.m.schliessen() === true && !x.m.istOffen() && x.m.schliessen() === false, 'schliessen (Esc): Tafel zu');
  }
  {
    // jedes Feld, jeder Wert: genau die erwartete Nachricht
    const x = mk({ crew: [mensch('captain'), bot('navigation'), bot('ops'), bot('technik'), bot('bord')] });
    const rollenFeld = { navigation: 'Q', ops: 'W', technik: 'E', bord: 'A', alle: 'S' };
    let anzahl = 0, falsch = [];
    const pruefe = (e, wertId, pfad) => {
      const soll = erwartet(e, wertId, 'menu'), vor = x.L.senden.length;
      if (x.L.senden.length !== vor + 1 || !eq(letzte(x.L), soll)) falsch.push(pfad + ' → ' + JSON.stringify(letzte(x.L)) + ' statt ' + JSON.stringify(soll));
      anzahl++;
    };
    for (const [rolle, tab] of Object.entries(TK.LAGE.stufe2)) {
      for (const [f, key] of Object.entries(tab)) {
        const e = index.get(key), p = platz(e);
        if (key === 'tech.ueberladen') continue;   // fragt nach (eigener Test)
        if (!p) {
          x.m.oeffnen(); x.m.waehle(rollenFeld[rolle]); const vor = x.L.senden.length; const r = x.m.waehle(f);
          if (r.art !== 'gesendet' || x.L.senden.length !== vor + 1 || !eq(letzte(x.L), erwartet(e, null, 'menu'))) falsch.push(rolle + '/' + f + ' ' + key + ' → ' + JSON.stringify(letzte(x.L)));
          anzahl++;
        } else {
          const seiten = [].concat(TK.LAGE.stufe3[key]);
          seiten.forEach((tabelle, si) => {
            for (const [f3, id] of Object.entries(tabelle)) {
              x.m.oeffnen(); x.m.waehle(rollenFeld[rolle]); x.m.waehle(f);
              for (let i = 0; i < si; i++) x.m.blaettern();
              const vor = x.L.senden.length; const r = x.m.waehle(f3);
              if (r.art !== 'gesendet' || x.L.senden.length !== vor + 1 || !eq(letzte(x.L), erwartet(e, id, 'menu'))) falsch.push(rolle + '/' + f + '/' + si + '/' + f3 + ' ' + key + '=' + id + ' → ' + JSON.stringify(letzte(x.L)));
              anzahl++;
            }
          });
        }
        x.warte(1);
      }
    }
    // Zähler der Erwartung: Felder ohne Wert + alle Werte (ohne tech.ueberladen)
    const sollAnzahl = KANON.befehle.filter((e) => e.befehl !== 'tech.ueberladen').reduce((a, e) => a + (platz(e) ? Object.keys(platz(e).werte).length : 1), 0);
    ok(falsch.length === 0, 'jedes Menüfeld sendet genau die erwartete bot.befehl' + falsch.slice(0, 3).map((s) => '\n         ' + s).join(''));
    ok(anzahl === sollAnzahl, 'alle Befehle und Werte des Kanons sind per Menü erreichbar (' + anzahl + ' von ' + sollAnzahl + ')');
    ok(x.L.senden.every((m) => m.t === 'bot.befehl' && m.quelle === 'menu' && ['navigation', 'ops', 'technik', 'bord', 'alle'].includes(m.an) && !/sprung/.test(m.befehl)), 'alle Nachrichten: t bot.befehl, quelle menu, an Rolle oder alle, nie nav.sprung');
    ok(Protocol.C.BOT_BEFEHL === 'bot.befehl' && Protocol.C.BOT_ANTWORT === 'bot.antwort', 'Protokollkonstanten BOT_BEFEHL / BOT_ANTWORT');
    // Schubstufen als Wort (BOT-01 D: rueckwaerts, viertel, halb, dreiviertel, voll)
    x.m.oeffnen(); x.m.waehle('Q'); x.m.waehle('E'); x.m.waehle('S');
    ok(eq(letzte(x.L).args, { stufe: 'rueckwaerts' }), 'Rückwärts: stufe rueckwaerts');
    x.m.oeffnen(); x.m.waehle('Q'); x.m.waehle('E'); x.m.waehle('A');
    ok(eq(letzte(x.L).args, { stufe: 'viertel' }), 'Viertel Kraft: stufe viertel');
    x.m.oeffnen(); x.m.waehle('Q'); x.m.waehle('E'); x.m.waehle('E');
    ok(eq(letzte(x.L).args, { stufe: 'halb' }), 'Halbe Kraft: stufe halb');
    x.m.oeffnen(); x.m.waehle('Q'); x.m.waehle('E'); x.m.waehle('W');
    ok(eq(letzte(x.L).args, { stufe: 'dreiviertel' }), 'Dreiviertel Kraft: stufe dreiviertel');
    x.m.oeffnen(); x.m.waehle('Q'); x.m.waehle('E'); x.m.waehle('Q');
    ok(eq(letzte(x.L).args, { stufe: 'voll' }), 'Volle Kraft: stufe voll');
    x.m.oeffnen(); x.m.waehle('E'); x.m.waehle('E'); x.m.waehle('W');
    ok(eq(letzte(x.L).args, { system: 'shields', delta: -1 }), 'Weniger Energie auf Schilde: system shields, delta -1');
    // Nachfrage
    x.m.oeffnen(); x.m.waehle('E'); const n0 = x.L.senden.length;
    const f1 = x.m.waehle('D');
    ok(f1.art === 'frage' && x.L.senden.length === n0 && zelle(x.m, 'D').zustand === 'frage' && zelle(x.m, 'D').text === 'Reaktor überladen?' && zelle(x.m, 'D').info === 'nochmal D' && zelle(x.m, 'D').fn === 'weapon', 'Reaktor überladen: erster Druck fragt (Zelle, Info nochmal D), sendet nicht');
    ok(x.m.ansicht().rechts.text === 'D nochmal = senden' && x.m.ansicht().rechts.stil === 'rot', 'Titel rechts: D nochmal = senden (rot)');
    const f2 = x.m.waehle('D');
    ok(f2.art === 'gesendet' && eq(letzte(x.L), { t: 'bot.befehl', an: 'technik', befehl: 'tech.ueberladen', quelle: 'menu' }) && !x.m.istOffen(), 'zweiter Druck binnen 3 s sendet und schließt');
    x.m.oeffnen(); x.m.waehle('E'); x.m.waehle('D'); x.warte(3100); const n1 = x.L.senden.length;
    ok(x.m.istOffen() && zelle(x.m, 'D').zustand === 'bereit' && x.m.waehle('D').art === 'frage' && x.L.senden.length === n1, 'nach 3 s ist die Nachfrage vergessen: erneut fragen statt senden');
    x.m.zurueck(); x.m.schliessen();
    // Blättern
    x.m.oeffnen(); x.m.waehle('E'); x.m.waehle('A');
    ok(x.m.ansicht().pfad === 'BEFEHL · TECHNIK · … REPARIEREN' && x.m.ansicht().rechts.text === 'R Seite 1/4 · Hauptsysteme' && texte(x.m) === 'Reaktor|Antrieb|Schilde|Transfer|Waffen||||', '… reparieren Seite 1: Hauptsysteme');
    ok(x.m.blaettern() && x.m.ansicht().rechts.text === 'R Seite 2/4 · Düsen und Emitter' && zelle(x.m, 'W').text === 'Bug Emitter' && zelle(x.m, 'C').text === 'Steuerbord Düse', 'R: Seite 2 Düsen und Emitter (Kompass)');
    x.m.blaettern();
    ok(zelle(x.m, 'Q').text === 'Lafette sieben' && zelle(x.m, 'S').text === 'Lafette fünf' && zelle(x.m, 'C').text === 'Lafette drei' && zelle(x.m, 'W').text === 'Bugwaffe', 'Seite 3 Waffenplätze wie das Waffenkreuz der Ops');
    x.m.blaettern(); x.m.blaettern();
    ok(x.m.ansicht().rechts.text === 'R Seite 1/4 · Hauptsysteme', 'nach der letzten Seite wieder Seite 1');
    x.m.blaettern(); x.m.blaettern(); x.m.waehle('Q');
    ok(eq(letzte(x.L), { t: 'bot.befehl', an: 'technik', befehl: 'tech.reparieren', args: { system: 'lafette_7' }, quelle: 'menu' }), 'Seite 3 Q: tech.reparieren lafette_7');
    x.m.oeffnen(); x.m.waehle('E'); x.m.waehle('S');
    ok(x.m.ansicht().rechts.text === 'R Seite 1/2' && x.m.blaettern() && x.m.ansicht().rechts.text === 'R Seite 2/2 · Waffen einzeln', '… zuerst: 2 Seiten (Seite 1 ohne Namen)');
    x.m.zurueck(); x.m.waehle('S'); ok(x.m.lies().seite === 0, 'zurück und neu: wieder Seite 1');
    x.m.zurueck(); x.m.waehle('Q'); x.m.waehle('W');
    ok(x.m.blaettern() === false, 'R ohne Seiten tut nichts (Schilde …)');
    x.m.schliessen();
    // Alle
    x.m.oeffnen(); x.m.waehle('S');
    ok(x.m.ansicht().pfad === 'BEFEHL · ALLE' && texte(x.m) === 'Statusbericht|Automatik|||||||', 'Alle: Statusbericht, Automatik');
    x.m.waehle('W');
    ok(eq(letzte(x.L), { t: 'bot.befehl', an: 'alle', befehl: 'bot.automatik', quelle: 'menu' }), 'B S W: bot.automatik an alle');
  }
  {
    // Werte, die das Schiff nicht hat: leere Felder, Plätze bleiben
    const x = mk({ crew: [mensch('captain'), bot('navigation'), bot('technik')], wertFrei: (key, id) => !(key === 'nav.schub:stufe' && id === 'rueckwaerts') && id !== 'modul_4' });
    x.m.oeffnen(); x.m.waehle('Q'); x.m.waehle('E');
    ok(zelle(x.m, 'A').text === 'Viertel Kraft voraus' && zelle(x.m, 'S').zustand === 'leer' && zelle(x.m, 'Y').zustand === 'leer' && zelle(x.m, 'Q').text === 'Volle Kraft voraus', 'Rückwärtsstufe fehlt dem Schiff: leeres Feld, Platz bleibt');
    ok(x.m.waehle('S').art === 'leer' && x.L.senden.length === 0, 'Taste auf leerem Feld sendet nichts');
    x.m.schliessen();
    const t = mk({ crew: [mensch('captain'), bot('technik')], wertInfo: (key, id) => (id === 'engines' ? { text: 'besch.', stil: 'besch' } : id === 'reactor' ? { text: 'zer.', stil: 'zer' } : null) });
    t.m.oeffnen(); t.m.waehle('E'); t.m.waehle('A');
    ok(zelle(t.m, 'W').info === 'besch.' && zelle(t.m, 'W').infoStil === 'besch' && zelle(t.m, 'Q').info === 'zer.' && zelle(t.m, 'E').info === '', 'Info rechts bei Systemwerten: beschädigt, zerstört, heil ohne');
  }

  // ================================================================= 5. Direkttasten
  section('5. Direkttasten');
  {
    const x = mk({ crew: [mensch('captain'), bot('navigation'), bot('ops')] });
    const erw = { 'captain.bot.stopp': { an: 'navigation', befehl: 'nav.stopp' }, 'captain.bot.ausweichen': { an: 'navigation', befehl: 'nav.ausweichen' }, 'captain.bot.feuerFrei': { an: 'ops', befehl: 'ops.feuer_frei' }, 'captain.bot.feuerHalt': { an: 'ops', befehl: 'ops.feuer_halt' }, 'captain.bot.status': { an: 'alle', befehl: 'bot.status' } };
    for (const [id, e] of Object.entries(erw)) {
      const r = x.m.taste(id);
      ok(r.ok && eq(letzte(x.L), { t: 'bot.befehl', an: e.an, befehl: e.befehl, quelle: 'taste' }), id + ' sendet ' + e.befehl + ' an ' + e.an + ' (quelle taste, ohne args)');
    }
    x.m.oeffnen(); x.m.taste('captain.bot.stopp');
    ok(!x.m.istOffen(), 'Direkttaste schließt eine offene Tafel');
    const r2 = x.m.crew();
    ok(r2.every((c) => !c.gesperrt), 'Crew-Zeile: alle Knöpfe frei (Navigation, Ops, Alle)');
    const y = mk({ crew: [mensch('captain'), bot('ops')] });
    const c = y.m.crew();
    ok(c[1].gesperrt && /Kein Bot/.test(c[1].grund) && c[2].gesperrt && !c[3].gesperrt && !c[4].gesperrt && !c[5].gesperrt, 'ohne Navigation-Bot: Stopp und Ausweichen gesperrt (mit Grund), Ops und Status frei');
    ok(y.m.taste('captain.bot.stopp').ok === false && y.L.senden.length === 0 && y.L.denied.length === 1 && /Kein Bot/.test(y.L.denied[0]), 'gesperrte Direkttaste: Grund, nichts gesendet');
    const z = mk({ crew: [mensch('captain'), mensch('helm'), bot('navigation')] });
    ok(z.m.taste('captain.bot.ausweichen').ok === false && z.L.senden.length === 0 && /Mensch/.test(z.L.denied[0]), 'Mensch am Steuer: Direkttaste sendet nichts („sag es ihm“)');
    ok(x.m.taste('gibt.es.nicht').ok === false, 'unbekannte Aktion tut nichts');
    const e = mk({ crew: [mensch('captain'), bot('ops')], sendeFehler: true });
    ok(e.m.taste('captain.bot.feuerFrei').ok === false && /Verbindung/.test(e.L.denied[0]) && e.m.crew()[0].quittung === null, 'Netz weg: Hinweis, keine Quittung „gesendet“');
    // quelle beim Klick auf den Knopf der Crew-Zeile
    const k = mk({ crew: [mensch('captain'), bot('ops')] }); k.m.taste('captain.bot.feuerHalt', 'menu');
    ok(letzte(k.L).quelle === 'menu', 'Klick auf den Knopf: quelle menu');
  }

  // ================================================================= 6. Zeit, Quittung
  section('6. Zeit und Quittung');
  {
    const x = mk({ crew: [mensch('captain'), bot('navigation'), bot('ops')] });
    x.m.oeffnen();
    ok(Math.abs(x.m.ansicht().rest - 1) < 1e-9, 'frisch geöffnet: Restzeit voll');
    x.warte(3000);
    ok(Math.abs(x.m.ansicht().rest - 0.5) < 1e-9 && x.m.istOffen(), 'nach 3 s: Restzeit halb');
    x.warte(2900);
    ok(x.m.istOffen(), 'nach 5,9 s noch offen');
    x.warte(200);
    ok(!x.m.istOffen() && x.m.ansicht() === null, 'nach 6,1 s schließt die Tafel von selbst');
    x.m.oeffnen(); x.warte(5000); x.m.waehle('W');
    ok(Math.abs(x.m.ansicht().rest - 1) < 1e-9, 'jede Tafeltaste setzt die Zeit zurück');
    x.warte(5000);
    ok(x.m.istOffen(), '5 s nach der letzten Taste noch offen');
    x.m.waehle('E'); x.warte(5900); x.m.waehle('Q');
    ok(x.m.istOffen() && x.m.lies().stufe === 3, 'jede Taste zählt neu (Stufe 3 bleibt offen, auch eine Taste auf leerem Feld zählt)');
    x.warte(6100);
    ok(!x.m.istOffen() && x.m.lies().stufe === 1 && x.m.lies().rolle === null, 'Auto-Schließen setzt auf Stufe 1 zurück');
    // B nach dem Auto-Schließen: wieder Stufe 1
    x.m.oeffnen();
    ok(x.m.lies().stufe === 1, 'B öffnet wieder auf Stufe 1');
    x.m.schliessen();
    // Sperrgrund 2 s
    x.m.oeffnen(); x.m.waehle('E'); ok(x.m.ansicht().rechts.stil === 'warn', 'Grund steht im Titel');
    x.warte(1900); ok(x.m.ansicht().rechts.stil === 'warn', 'Grund nach 1,9 s noch da');
    x.warte(200); ok(x.m.ansicht().rechts.stil === 'dim', 'Grund nach 2,1 s weg (wieder der Hinweis)');
    x.m.schliessen();
    // Quittung: gesendet, keine Antwort
    const y = mk({ crew: [mensch('captain'), bot('ops')] });
    ok(y.m.crew()[0].text === 'Befehle' && y.m.crew()[0].fn === 'cmd' && y.m.crew()[0].quittung === null, 'Knopf Befehle ohne Quittung');
    y.m.taste('captain.bot.feuerFrei');
    ok(y.m.crew()[0].text === 'OPS …' && y.m.crew()[0].fn === 'neutral' && y.m.crew()[0].quittung === 'gesendet', 'gesendet: „OPS …“ in neutral');
    y.warte(2900); ok(y.m.crew()[0].text === 'OPS …', 'bis 3 s „gesendet“');
    y.warte(200); ok(y.m.crew()[0].text === 'OPS keine Antwort' && y.m.crew()[0].quittung === 'still', 'nach 3 s: „OPS keine Antwort“');
    y.warte(1800); ok(y.m.crew()[0].quittung === 'still', 'keine Antwort bleibt 2 s');
    y.warte(300); ok(y.m.crew()[0].text === 'Befehle' && y.m.crew()[0].quittung === null, 'danach wieder „Befehle“');
  }

  // ================================================================= 7. Antworten
  section('7. Antworten');
  {
    const x = mk({ crew: [mensch('captain'), bot('navigation'), bot('ops')] });
    x.m.taste('captain.bot.feuerFrei');
    const r = x.m.antwort(antwort('b1', 'ops.feuer_frei', 'ok', { text: 'Aye, Feuer frei.' }));
    ok(r.verarbeitet && r.angezeigt && x.L.untertitel.length === 1 && x.L.untertitel[0].text === 'Aye, Feuer frei.' && x.L.untertitel[0].info.sprecher === 'OPS', 'ok: Untertitel genau einmal, Sprecher OPS');
    ok(x.m.crew()[0].text === 'OPS aye' && x.m.crew()[0].fn === 'shield' && x.m.crew()[0].quittung === 'aye', 'Quittung „OPS aye“ in shield');
    x.warte(1900); ok(x.m.crew()[0].text === 'OPS aye', 'aye bis 2 s'); x.warte(200); ok(x.m.crew()[0].text === 'Befehle', 'aye nach 2 s weg');
    x.m.taste('captain.bot.feuerFrei');
    x.m.antwort(antwort('b1', 'ops.feuer_frei', 'abgelehnt', { textId: 'ops.feuer_frei.abgelehnt.kein_ziel', text: 'Es ist kein Ziel markiert.' }));
    ok(x.m.crew()[0].text === 'OPS abgelehnt' && x.m.crew()[0].fn === 'weapon' && x.L.untertitel.length === 2 && x.L.untertitel[1].text === 'Es ist kein Ziel markiert.', 'abgelehnt: „OPS abgelehnt“ in weapon, der Grund steht im Untertitel');
    x.warte(3900); ok(x.m.crew()[0].text === 'OPS abgelehnt', 'abgelehnt bis 4 s'); x.warte(200); ok(x.m.crew()[0].text === 'Befehle', 'abgelehnt nach 4 s weg');
    x.m.taste('captain.bot.stopp');
    x.m.antwort(antwort('b0', 'nav.stopp', 'unmoeglich', { text: 'Das geht nicht.' }));
    ok(x.m.crew()[0].text === 'NAVIGATION abgelehnt' && x.m.crew()[0].fn === 'weapon', 'unmoeglich wie abgelehnt');
    x.warte(5000);
    // erledigt nach ok: eigene aye-Quittung
    x.m.taste('captain.bot.stopp'); x.m.antwort(antwort('b0', 'nav.stopp', 'ok')); x.warte(2500);
    x.m.antwort(antwort('b0', 'nav.stopp', 'erledigt'));
    ok(x.m.crew()[0].text === 'NAVIGATION aye', 'erledigt zählt wie angenommen');
    // Antwort ohne Text: textId als Untertitel; ohne beides nichts
    const n0 = x.L.untertitel.length;
    x.m.antwort({ t: 'bot.antwort', botId: 'b1', befehl: 'ops.scan', status: 'ok', textId: 'ops.scan.ok' });
    ok(x.L.untertitel.length === n0 + 1 && x.L.untertitel[n0].text === 'ops.scan.ok', 'ohne text: die textId (wie in der Bot-Sprache)');
    x.m.antwort({ t: 'bot.antwort', botId: 'b1', befehl: 'ops.scan', status: 'ok' });
    ok(x.L.untertitel.length === n0 + 1, 'ohne text und textId: kein Untertitel');
    ok(x.m.antwort({ t: 'bot.befehl' }).verarbeitet === false && x.m.antwort(null).verarbeitet === false, 'fremde Nachrichten werden nicht verarbeitet');
    // Rolle des Sprechers aus früheren Antworten (alle-Befehl)
    x.m.taste('captain.bot.status');
    x.m.antwort(antwort('b1', 'bot.status', 'ok', { text: 'Ops bereit.' })); x.m.antwort(antwort('b0', 'bot.status', 'ok', { text: 'Kurs liegt an.' }));
    const sp = x.L.untertitel.slice(-2).map((u) => u.info.sprecher);
    ok(eq(sp, ['OPS', 'NAVIGATION']), 'Sprecher bei „alle“: Rolle des Bots, gelernt aus früheren Antworten (' + sp + ')');
    ok(x.m.crew()[0].text === 'ALLE aye', 'Status an alle: nach beiden Antworten „ALLE aye“');
    // alle: erst gesendet, dann aye; eine Ablehnung gewinnt
    const y = mk({ crew: [mensch('captain'), bot('navigation'), bot('ops'), bot('technik')] });
    y.m.taste('captain.bot.status');
    y.m.antwort(antwort('b0', 'bot.status', 'ok')); ok(y.m.crew()[0].text === 'ALLE …', 'alle: eine von drei Antworten – noch „gesendet“');
    y.m.antwort(antwort('b1', 'bot.status', 'abgelehnt')); ok(y.m.crew()[0].text === 'ALLE abgelehnt', 'alle: lehnt einer ab, „ALLE abgelehnt“');
    y.m.antwort(antwort('b2', 'bot.status', 'ok')); ok(y.m.crew()[0].text === 'ALLE abgelehnt', 'die letzte Zusage überschreibt die Ablehnung nicht');
    // Antwort ohne passenden Befehl (rate, phase): trifft den letzten offenen
    const z = mk({ crew: [mensch('captain'), bot('ops')] });
    z.m.taste('captain.bot.feuerHalt');
    z.m.antwort({ t: 'bot.antwort', botId: null, befehl: null, status: 'abgelehnt', textId: 'befehl.abgelehnt.rate', text: 'Langsam.' });
    ok(z.m.crew()[0].text === 'OPS abgelehnt', 'Antwort ohne Befehl (rate) quittiert den letzten ausstehenden Befehl');
    // Untertitel nur einmal, wenn ein anderer Verarbeiter sie zeigt (Sprache an)
    const s = mk({ crew: [mensch('captain'), bot('ops')], antwortenAnzeigen: () => false });
    s.m.taste('captain.bot.feuerFrei');
    const rs = s.m.antwort(antwort('b1', 'ops.feuer_frei', 'ok'));
    ok(rs.verarbeitet && rs.angezeigt === false && s.L.untertitel.length === 0 && s.m.crew()[0].text === 'OPS aye', 'Sprache zeigt die Antwort: hier kein Untertitel, Quittung und Zustand trotzdem');
    const a1 = mk({ crew: [mensch('captain'), bot('ops')], antwortenAnzeigen: () => true });
    a1.m.taste('captain.bot.feuerFrei'); a1.m.antwort(antwort('b1', 'ops.feuer_frei', 'ok'));
    ok(a1.L.untertitel.length === 1, 'sonst genau ein Untertitel');
    ok(typeof BS.netAntworten === 'function' && BS.netAntworten() === false, 'BotSprache.netAntworten(): ohne laufende Sprache false (dann zeigt das Menü die Antworten)');
    // Quelltext: genau ein Net-Zuhörer für bot.antwort im Menücode, die Sprache bindet den Stub (kein Net)
    const pb = fs.readFileSync(path.join(PUB, 'pult-befehl.js'), 'utf8');
    ok((pb.match(/Net\.on\(/g) || []).length === 1 && /netAntworten/.test(pb), 'pult-befehl.js: ein Net.on, Sprache an wird über BotSprache.netAntworten() berücksichtigt');
  }

  // ================================================================= 8. gilt
  section('8. „gilt“');
  {
    const x = mk({ crew: [mensch('captain'), bot('navigation'), bot('ops'), bot('technik')] });
    x.m.taste('captain.bot.feuerHalt'); x.m.antwort(antwort('b1', 'ops.feuer_halt', 'abgelehnt'));
    ok(x.m.giltVon('ops') === null, 'abgelehnt setzt kein „gilt“');
    x.warte(5000);
    x.m.taste('captain.bot.feuerHalt'); x.m.antwort(antwort('b1', 'ops.feuer_halt', 'ok'));
    ok(x.m.giltVon('ops') && x.m.giltVon('ops').key === 'ops.feuer_halt', 'ok setzt „gilt“ für die Rolle');
    x.m.oeffnen();
    ok(zelle(x.m, 'W').info === 'Feuer einstellen' && zelle(x.m, 'Q').info === '' , 'Stufe 1: Info = Sprechform des letzten angenommenen Befehls (Ops)');
    x.m.waehle('W');
    ok(zelle(x.m, 'W').zustand === 'gewaehlt' && zelle(x.m, 'W').info === 'gilt' && zelle(x.m, 'Q').zustand === 'bereit', 'Stufe 2: Feld „Feuer einstellen“ gilt');
    x.m.schliessen();
    // Wert: feuer_frei bug
    x.m.oeffnen(); x.m.waehle('W'); x.m.waehle('E'); x.m.waehle('W'); x.m.antwort(antwort('b1', 'ops.feuer_frei', 'ok'));
    x.m.oeffnen();
    ok(zelle(x.m, 'W').info === 'Feuer frei Bugwaffen', 'Stufe 1: Info mit Wert (Feuer frei Bugwaffen)');
    x.m.waehle('W');
    ok(zelle(x.m, 'E').zustand === 'gewaehlt' && zelle(x.m, 'W').zustand === 'bereit' && zelle(x.m, 'Q').zustand === 'bereit', 'Stufe 2: „Feuer frei …“ gilt, „Feuer einstellen“ nicht mehr (neuerer Befehl)');
    x.m.waehle('E');
    ok(zelle(x.m, 'W').zustand === 'gewaehlt' && zelle(x.m, 'W').info === 'gilt' && zelle(x.m, 'A').zustand === 'bereit', 'Stufe 3: der Wert Bugwaffen gilt');
    x.m.schliessen();
    // Schub: Titel „Dreiviertel Kraft voraus“
    x.m.oeffnen(); x.m.waehle('Q'); x.m.waehle('E'); x.m.waehle('W'); x.m.antwort(antwort('b0', 'nav.schub', 'ok'));
    x.m.oeffnen(); ok(zelle(x.m, 'Q').info === 'Dreiviertel Kraft voraus', 'Dreiviertel: Sprechform aus dem Kanon-Wort'); x.m.schliessen();
    // bot.status ändert nichts, Automatik löscht alles
    x.m.taste('captain.bot.status'); x.m.antwort(antwort('b1', 'bot.status', 'ok')); x.m.antwort(antwort('b0', 'bot.status', 'ok'));
    ok(x.m.giltVon('ops') && x.m.giltVon('navigation'), 'bot.status verändert „gilt“ nicht');
    x.warte(5000);
    x.m.oeffnen(); x.m.waehle('S'); x.m.waehle('W'); x.m.antwort(antwort('b0', 'bot.automatik', 'ok'));
    ok(x.m.giltVon('ops') === null && x.m.giltVon('navigation') === null, 'Automatik löscht alle Absichten');
    // Mensch an Station: verfällt
    x.m.taste('captain.bot.feuerHalt'); x.m.antwort(antwort('b1', 'ops.feuer_halt', 'ok'));
    ok(x.m.giltVon('ops') !== null, 'wieder gesetzt');
    x.m.synchron([mensch('captain'), mensch('weapons'), bot('navigation'), bot('ops'), bot('technik')], 'play');
    ok(x.m.giltVon('ops') === null, 'Mensch setzt sich an Ops: „gilt“ der Rolle verfällt');
    x.m.synchron([mensch('captain'), bot('navigation'), bot('ops'), bot('technik')], 'play');
    ok(x.m.giltVon('ops') === null, 'Mensch geht wieder: nichts lebt auf');
    // Reset: Lobby / Partie verlassen
    x.m.taste('captain.bot.feuerHalt'); x.m.antwort(antwort('b1', 'ops.feuer_halt', 'ok')); x.m.oeffnen();
    x.m.synchron([mensch('captain'), bot('navigation'), bot('ops'), bot('technik')], 'lobby');
    ok(x.m.giltVon('ops') === null && !x.m.istOffen() && x.m.crew()[0].quittung === null && x.m.lies().ausstehend === 0 && !x.m.lies().aktiv, 'Lobby: „gilt“, Tafel, Quittung und ausstehende Befehle zurückgesetzt');
    x.m.synchron([mensch('captain'), bot('navigation'), bot('ops'), bot('technik')], 'play');
    x.m.taste('captain.bot.feuerHalt'); x.m.antwort(antwort('b1', 'ops.feuer_halt', 'ok'));
    x.m.synchron([mensch('captain')], 'play');
    ok(x.m.giltVon('ops') === null && !x.m.hatBots(), 'Bots weg: alles zurückgesetzt');
    // Kanon nachgeladen
    const leer = BM.erzeuge({ kanon: { befehle: [] }, tokens: TK, uhr: () => 1, senden: () => true, anzeige: { denied() {} } });
    leer.synchron([mensch('captain'), bot('ops')], 'play');
    ok(!leer.geladen() && leer.oeffnen() === false && leer.crew().every((c, i) => i === 0 || c.gesperrt), 'ohne Kanon: Tafel öffnet nicht, Direkttasten gesperrt');
    leer.setzeKanon(KANON);
    ok(leer.geladen() && leer.oeffnen() === true, 'Kanon nachgeladen: Tafel öffnet');
  }

  // ================================================================= 9. Einbindung (Quelltext)
  section('9. Einbindung im Client (Quelltext)');
  {
    const lies = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').split(String.fromCharCode(13)).join('');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const pos = (n) => html.indexOf('js/' + n + '.js');
    ok(pos('pult-befehl-tokens') > pos('pult-stationen') && pos('bot-menue') > pos('pult-befehl-tokens') && pos('pult-befehl') > pos('bot-menue') && pos('pult-befehl') < pos('client') && pos('tasten') < pos('pult-befehl-tokens') && pos('hud') < pos('pult-befehl-tokens') && pos('consoles') < pos('pult-befehl-tokens'), 'index.html: Tokens, Kern, Anschluss nach tasten/hud/consoles/pult-stationen und vor client.js');
    const K = lies('consoles.js'), kd = K.slice(K.indexOf('keyDown(e, view) {'), K.indexOf('keyUp(e, view) {'));
    const iCap = kd.indexOf("case 'captain': {"), iBot = kd.indexOf('PultBefehl.taste(e, view)'), iReiter = kd.indexOf('if (tab === 0) {', iCap);
    const iZiffer = kd.indexOf('if (d >= 1 && d <= 6)', iCap);
    ok(iBot > iZiffer && iZiffer > iCap && iBot < iReiter, 'consoles.js: PultBefehl.taste steht im Captain-Zweig VOR dem Reiter-Zweig (der Shift ignoriert), die Reiterziffern 1-6 davor (bleiben bei offener Tafel erlaubt)');
    ok(/kartenZoom/.test(kd) && /!kartenZoom && window[.]PultBefehl && PultBefehl[.]taste[(]e, view[)]/.test(kd), 'consoles.js: der Zoom der Lage-Karte (+/-) geht an der Tafel vorbei');
    ok(/PultBefehl[.]escape[(]e[)]/.test(kd), 'consoles.js: Esc übergibt das Ereignis (Wiederholung wird erkannt)');
    ok(kd.indexOf('PultBefehl.escape(e)') > 0 && kd.indexOf('PultBefehl.escape(e)') < kd.indexOf('view.actions.leave()'), 'consoles.js: Esc schließt die Tafel, bevor leave() die Konsole verlässt');
    ok(/stationAbbau\(view\) \{\s*if \(window\.PultBefehl\) PultBefehl\.schliessen\(\)/.test(K), 'consoles.js: stationAbbau schließt die Tafel (Tab, Verlassen)');
    ok(/b\.add\(window\.PultBefehl && PultBefehl\.sichtbar\(\) \? 'captain\.befehl'/.test(K), 'consoles.js: tastenBereiche liefert bei offener Tafel nur captain.befehl (die Reiter-Bereiche ruhen)');
    ok(/PultBefehl\.statusY\(\) : 258/.test(lies('pult-stationen.js')) && /PultBefehl\.zeichne\(ctx, view, g\)/.test(lies('pult-stationen.js')), 'pult-stationen.js: Statusleiste 240/258 und Zeichnen über PultBefehl');
    ok(lies('hud.js').includes('(this.sprech.aktiv || this.sprech.bots) && !inConsole') && lies('client.js').includes('H.sprech.aktiv || H.sprech.bots') && lies('client.js').includes('PultBefehl.rahmen(st)'), 'hud.js/client.js: Sprechspalte auch ohne Sprache, wenn Bots im Spiel sind; Crew-Lage je Bild');
    ok(/PultBefehl\.sichtbar\(\)\) PultBefehl\.einblenden\(ctx, pultCanvas\)/.test(lies('sitz.js')), 'sitz.js: Einblendung im Blick VORN/CREW');
    ok(lies('dev-mock.js').includes('mockbots=') && lies('dev-mock.js').includes("case 'bot.befehl'"), 'dev-mock.js: Bots im Snapshot (mockbots) und Antworten auf bot.befehl');
    // kein hartkodierter Tastencode im Menücode (Tasten laufen über tasten.js)
    const pb = lies('pult-befehl.js').split('\n').map((z) => z.replace(/\/\/.*$/, '')).join('\n');
    ok(!/e\.code|\.code\s*===|'Key[A-Z]'/.test(pb), 'pult-befehl.js: kein hartkodierter Tastencode (alles über Tasten.aktion/ausEvent)');
    const kern = lies('bot-menue.js').split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n');
    ok(!/Net\.|WebSocket|document\.|window\.|fetch\(/.test(kern), 'bot-menue.js: kein Netz, kein DOM (reiner Kern)');
  }

  // ================================================================= 10. Tasten, Esc und Klickfänger als Verhalten (Nacharbeit)
  section('10. Tasten, Esc und Klickfänger (Verhalten im Kern und im Zeichnen mit Attrappen)');
  {
    const STD = { 'captain.befehl': ['KeyB'], 'captain.bot.stopp': ['Shift+KeyX'], 'captain.bot.ausweichen': ['Shift+KeyA', 'Shift+KeyD'], 'captain.bot.feuerFrei': ['Shift+KeyF'], 'captain.bot.feuerHalt': ['Shift+KeyG'], 'captain.bot.status': ['Shift+KeyS'],
      'captain.befehl.q': ['KeyQ'], 'captain.befehl.w': ['KeyW'], 'captain.befehl.e': ['KeyE'], 'captain.befehl.a': ['KeyA'], 'captain.befehl.s': ['KeyS'], 'captain.befehl.d': ['KeyD'], 'captain.befehl.y': ['KeyZ'], 'captain.befehl.x': ['KeyX'], 'captain.befehl.c': ['KeyC'],
      'captain.befehl.weiter': ['KeyR'], 'captain.befehl.zurueck': ['Backspace'] };
    const druck = (x, taste) => x.m.tastenDruck((id) => (STD[id] || []).includes(taste));
    const zu0 = (x) => x.L.senden.length + '|' + JSON.stringify(x.m.lies());
    // ohne Bots: nichts geschluckt (B, Sh+X, Q, beliebig), nichts gesendet
    {
      const x = mk({ crew: [mensch('captain')] });
      ok(['KeyB', 'Shift+KeyX', 'Shift+KeyS', 'KeyQ', 'Enter'].every((t) => druck(x, t).geschluckt === false) && x.L.senden.length === 0 && x.L.denied.length === 0, 'ohne Bots: B, Sh+X, Sh+S, Q, Enter werden nicht geschluckt, kein Hinweis, nichts gesendet');
      ok(x.m.escape(false) === false && x.m.escape(true) === false, 'ohne Bots: Esc ist nie verbraucht (die Konsole wird verlassen wie bisher)');
    }
    // Tafel zu: B öffnet, Direkttasten senden (quelle taste), alles andere gehört den Reitern
    {
      const x = mk();
      ok(['KeyQ', 'KeyW', 'KeyZ', 'KeyX', 'Enter', 'Space'].every((t) => druck(x, t).geschluckt === false) && x.L.senden.length === 0, 'Tafel zu: Q W Z X Enter Space werden nicht geschluckt (Reiter-Bereich)');
      const r = druck(x, 'Shift+KeyX');
      ok(r.geschluckt && r.ton && letzte(x.L) && letzte(x.L).befehl === 'nav.stopp' && letzte(x.L).quelle === 'taste' && !x.m.istOffen(), 'Tafel zu: Sh+X sendet nav.stopp (quelle taste), geschluckt');
      x.warte(100);
      ok(druck(x, 'KeyB').geschluckt && x.m.istOffen() && x.m.lies().stufe === 1, 'Tafel zu: B öffnet auf Stufe 1');
    }
    // Tafel offen: gewählt wird über die Felder, ALLES andere wird geschluckt und ändert nichts
    {
      const x = mk();
      druck(x, 'KeyB');
      const vorher = zu0(x);
      const fremd = ['Enter', 'Shift+KeyQ', 'Shift+KeyW', 'Shift+KeyE', 'KeyL', 'Space', 'KeyT', 'Shift+KeyT', 'KeyH', 'KeyF', 'KeyV', 'KeyN', 'KeyK', 'KeyM', 'Shift+KeyZ', 'ArrowLeft'];
      ok(fremd.every((t) => { const r = druck(x, t); return r.geschluckt === true && r.ton === false; }) && zu0(x) === vorher, 'Tafel offen: Enter, Sh+Q/W/E, L, Space, T, Sh+T, H, F, V, N, K, M, Sh+Z, Pfeil werden geschluckt und ändern nichts (M13)');
      ok(druck(x, 'KeyC').geschluckt && zu0(x) === vorher, 'Tafel offen, Stufe 1: C (leeres Feld) wird geschluckt, nichts ändert sich, nichts gesendet (M13)');
      ok(druck(x, 'KeyZ').geschluckt && druck(x, 'KeyX').geschluckt && zu0(x) === vorher, 'Tafel offen, Stufe 1: Z und X (leere Felder) geschluckt, nichts ändert sich (M13)');
      ok(druck(x, 'KeyR').geschluckt && zu0(x) === vorher, 'Tafel offen, Stufe 1: R (kein Blättern möglich) geschluckt, ohne Ton');
      const w = druck(x, 'KeyW');
      ok(w.geschluckt && w.ton && x.m.lies().stufe === 2 && x.m.lies().rolle === 'ops', 'Tafel offen: W wählt das Feld (Stufe 2 Ops), mit Ton');
      ok(druck(x, 'Backspace').ton && x.m.lies().stufe === 1, 'Tafel offen: Rück geht eine Stufe zurück');
      ok(druck(x, 'KeyB').ton && !x.m.istOffen(), 'Tafel offen, Stufe 1: B schließt');
    }
    // Tafel offen: Direkttasten gelten weiter und schließen nach dem Senden
    {
      const x = mk();
      druck(x, 'KeyB'); druck(x, 'Shift+KeyS');
      ok(letzte(x.L) && letzte(x.L).befehl === 'bot.status' && !x.m.istOffen(), 'Tafel offen: Sh+S sendet bot.status und schließt die Tafel');
    }
    // Blättern über R (Stufe 3, mehrere Seiten): geschluckt, mit Ton
    {
      const x = mk({ crew: [bot('navigation'), bot('ops'), bot('technik')] });
      druck(x, 'KeyB'); druck(x, 'KeyE'); druck(x, 'KeyA');
      const s0 = x.m.lies().seite, r = druck(x, 'KeyR');
      ok(x.m.lies().stufe === 3 && r.geschluckt && r.ton && x.m.lies().seite === s0 + 1, 'Stufe 3 (Technik reparieren): R blättert eine Seite, mit Ton');
    }
    // Esc: neuer Druck schließt die offene Tafel, danach (zweites Esc) darf die Konsole verlassen werden; Wiederholung tut nichts (M9)
    {
      const x = mk();
      ok(x.m.escape(false) === false, 'Esc mit Bots, Tafel zu: nicht verbraucht, die Konsole wird verlassen (M9)');
      druck(x, 'KeyB');
      ok(x.m.escape(true) === true && x.m.istOffen(), 'Esc als Wiederholung bei offener Tafel: verbraucht, Tafel bleibt');
      ok(x.m.escape(false) === true && !x.m.istOffen(), 'Esc (neuer Druck) bei offener Tafel: verbraucht, Tafel zu');
      ok(x.m.escape(true) === true, 'Esc als Wiederholung nach dem Schließen: verbraucht, die Konsole wird nicht verlassen (gehaltenes Esc)');
      ok(x.m.escape(false) === false, 'zweites Esc (neuer Druck) bei geschlossener Tafel: nicht verbraucht, die Konsole wird verlassen (M9)');
    }
    // Klickfänger: die Ansicht trägt ihn, er deckt Titelzeile, alle neun Felder und die Lücken
    {
      const x = mk(), RA = TK.MASS.raster, TA = TK.MASS.tafel;
      ok(x.m.ansicht() === null, 'Tafel zu: keine Ansicht, kein Fänger');
      druck(x, 'KeyB');
      const fg = x.m.ansicht().faenger;
      const feldRechtecke = []; for (let r = 0; r < RA.reihen; r++) for (let s = 0; s < RA.spalten; s++) feldRechtecke.push({ x: RA.x + s * (RA.zw + RA.sx), y: RA.y + r * (RA.zh + RA.sy), w: RA.zw, h: RA.zh });
      ok(fg && fg.x <= TA.x && fg.y <= TA.y && fg.x + fg.w >= TA.x + TA.w && fg.y + fg.h >= TA.y + TA.h && feldRechtecke.every((f) => fg.x <= f.x && fg.y <= f.y && fg.x + fg.w >= f.x + f.w && fg.y + fg.h >= f.y + f.h), 'Fänger deckt die Tafel samt Titelzeile und alle neun Felder samt Lücken');
      ok(fg.x === 60 && fg.y === 261 && fg.x + fg.w === 636 && fg.y + fg.h === 326, 'Fänger x 60-636, y 261-326 (' + JSON.stringify(fg) + ')');
    }
    // Zeichnen mit Attrappen: ein Reiter-Knopf liegt unter der Tafel; ein Klick auf leeres Feld und Lücke trifft den Fänger, nicht den Reiter-Knopf (Befund 1)
    {
      const ctxStub = new Proxy({}, { get: () => () => {}, set: () => true });
      const ui = { buttons: [], mouse: null, tooltip: null };
      const Pult = {
        FN: new Proxy({}, { get: (_, k) => '#' + String(k) }), tw: (t) => String(t).length * 4, rgba: () => '#000', mix: () => '#000', txt: () => {}, titel: () => {}, kappe: () => '',
        knopf: (c, bx, by, bw, bh, label, o) => { const b = { x: bx, y: by, w: bw, h: bh, label, disabled: !!(o && o.disabled), onClick: o && o.onClick, hotkey: null }; ui.buttons.push(b); return b; },
      };
      const sandbox = { window: {}, console, performance: { now: () => 1000 }, fetch: undefined };
      const w = sandbox.window;
      Object.assign(w, { Render: { ui }, Pult, Consoles: { view: null, stationOf: () => null, denied: () => {} }, Hud: null, Tasten: null, PultBefehlTokens: TK, BotMenue: BM, Shared_Protocol: Protocol, Net: undefined });
      vm.runInNewContext(fs.readFileSync(path.join(PUB, 'pult-befehl.js'), 'utf8'), sandbox, { filename: 'pult-befehl.js' });
      const PB = w.PultBefehl;
      PB.menue.setzeKanon(KANON);
      PB.rahmen({ players: [bot('navigation'), bot('ops')], phase: 'play' });
      const skin = { bg: '#101010', dim: '#888888', id: 'rom', ink: '#ffffff', text: '#ffffff' };
      const RA = TK.MASS.raster;
      const treffer = (px, py) => { for (let i = ui.buttons.length - 1; i >= 0; i--) { const b = ui.buttons[i]; if (px >= b.x && py >= b.y && px < b.x + b.w && py < b.y + b.h) return b; } return null; };   // wie Render.clickUi: der zuletzt registrierte Treffer gewinnt
      const zeichne = () => { ui.buttons.length = 0; ui.buttons.push({ x: 62, y: 262, w: 570, h: 60, label: 'REITER', disabled: false, onClick: () => {} }); PB.zeichne(ctxStub, null, { skin }); };
      const mitte = (f) => { const r = Math.floor(f / 3), s = f % 3; return [RA.x + s * (RA.zw + RA.sx) + RA.zw / 2, RA.y + r * (RA.zh + RA.sy) + RA.zh / 2]; };
      const luecken = [[RA.x + RA.zw + RA.sx / 2, RA.y + 5], [RA.x + 2 * RA.zw + 1.5 * RA.sx, RA.y + 20], [RA.x + 50, RA.y + RA.zh + RA.sy / 2], [RA.x + 50, RA.y + 2 * RA.zh + 1.5 * RA.sy], [TK.MASS.tafel.x + 100, TK.MASS.tafel.y + 2], [TK.MASS.faenger.x + 1, TK.MASS.tafel.y + 30]];
      const pruefe = (stufeName) => {
        zeichne();
        const a = PB.menue.ansicht(), leereFelder = a.zellen.map((z, i) => (z.zustand === 'leer' ? i : -1)).filter((i) => i >= 0);
        const punkte = leereFelder.map(mitte).concat(luecken);
        const reiterGetroffen = punkte.filter(([px, py]) => { const b = treffer(px, py); return !b || b.label === 'REITER'; });
        const faengerOk = punkte.filter(([px, py]) => { const b = treffer(px, py); return b && b.label === '' && !b.disabled && !b.onClick; });
        ok((leereFelder.length > 0 || /^Stufe 3/.test(stufeName)) && reiterGetroffen.length === 0 && faengerOk.length === punkte.length, stufeName + ': ' + leereFelder.length + ' leere Felder und ' + luecken.length + ' Lückenpunkte treffen den Fänger (kein onClick), nie den Reiter-Knopf (' + reiterGetroffen.length + ' Fehltreffer)');
        const bereit = a.zellen.map((z, i) => (z.zustand !== 'leer' ? i : -1)).filter((i) => i >= 0);
        ok(bereit.length > 0 && bereit.every((i) => { const [px, py] = mitte(i), b = treffer(px, py); return b && b.label !== '' && b.label !== 'REITER' && typeof b.onClick === 'function'; }), stufeName + ': belegte Felder bleiben anklickbar (eigener Knopf liegt über dem Fänger)');
      };
      PB.menue.oeffnen(); pruefe('Stufe 1');
      PB.menue.waehle('Q'); pruefe('Stufe 2 Navigation');
      PB.menue.waehle('E'); pruefe('Stufe 3 Schub');
      PB.menue.schliessen();
      zeichne();
      ok(treffer(300, 300) && treffer(300, 300).label === 'REITER', 'Tafel zu: kein Fänger, der Reiter-Knopf ist wieder erreichbar');
      PB.rahmen({ players: [mensch('captain')], phase: 'play' });
      zeichne();
      ok(ui.buttons.length === 1 && ui.buttons[0].label === 'REITER', 'ohne Bots: PultBefehl zeichnet nichts und registriert nichts (kein Fänger)');
    }
  }

  // ================================================================= 11. Designer-Review (W1, W2, K6, K7, K8)
  section('11. Designer-Review: Grund je Rolle (K7), gesperrte Direkttaste in der Quittung (K6), Zustandsinfo (W2), Info-Farben (W1, K8)');
  {
    // K7: der Grund nennt die Rolle, an der die Sperre hängt; nirgends bleibt ein Platzhalter stehen
    const x = mk({ crew: [mensch('captain'), bot('ops'), bot('technik')] });
    const r = x.m.taste('captain.bot.stopp');
    ok(r.ok === false && r.grund === 'keinBot' && x.L.denied.at(-1) === 'Kein Bot an der Navigation' && x.m.crew()[1].grund === 'Kein Bot an der Navigation', 'Sh+X ohne Navigation-Bot: „Kein Bot an der Navigation“ (Denied und Tooltip der Crew-Zeile)');
    ok(x.m.crew()[2].grund === 'Kein Bot an der Navigation' && x.m.crew()[3].gesperrt === false, 'Ausweichen hat denselben Grund wie Stopp (gleiche Rolle), Feuer frei ist frei');
    x.m.oeffnen(); x.m.waehle('Q');
    ok(x.L.denied.at(-1) === 'Kein Bot an der Navigation' && x.m.ansicht().rechts.text === 'Kein Bot an der Navigation', 'Tafel: Feld Navigation ohne Bot: derselbe Satz im Titelhinweis');
    x.m.schliessen(); x.m.oeffnen(); x.m.waehle('A');
    ok(x.L.denied.at(-1) === 'Nur während der Außenmission', 'Bord: „Nur während der Außenmission“ (kein Platzhalter nötig)');
    const m2 = mk({ crew: [mensch('captain'), mensch('weapons'), bot('navigation'), bot('ops'), bot('technik')] });
    m2.m.oeffnen(); m2.m.waehle('W');
    ok(m2.L.denied.at(-1) === 'Ein Mensch sitzt an Ops – sag es ihm', 'Ops mit Mensch: „Ein Mensch sitzt an Ops – sag es ihm“');
    const m3 = mk({ crew: [mensch('captain'), bot('navigation'), bot('ops')] });
    m3.m.oeffnen(); m3.m.waehle('E');
    ok(m3.L.denied.at(-1) === 'Kein Bot an der Technik', 'Technik ohne Bot: „Kein Bot an der Technik“');
    const alle = []; for (const g of ['keinBot', 'mensch', 'aussen', 'keineBots']) for (const ro of Object.keys(TK.TEXT.rolleAn)) alle.push(m3.L.denied.length >= 0 && TK.TEXT.grundLang[g].replace(/\{rolle\}/g, TK.TEXT.rolleAn[ro]));
    ok(alle.every((t) => !/[{}]/.test(t)) && Object.keys(TK.TEXT.rolleAn).sort().join() === Object.keys(TK.TEXT.rolleName).sort().join(), 'rolleAn deckt jede Rolle ab, kein Satz behält einen Platzhalter');
    // K10: die Einblendung steht nur im Ego-Sitz (Blick VORN/CREW) bei offener Tafel mit Bots
    {
      const P1 = bauePult('rom', {}), PB = P1.win.PultBefehl;
      PB.menue.setzeKanon(KANON);
      PB.rahmen({ players: [mensch('captain'), bot('ops')], phase: 'play' });
      ok(PB.einblendungOben() === 0, 'Einblendung: Tafel zu = 0');
      PB.menue.oeffnen(); ok(PB.einblendungOben() === 0, 'Tafel offen, aber kein Ego-Sitz (2D-Pult): 0');
      P1.win.Sitz = { station: 'captain', blick: 'vorn' }; ok(PB.einblendungOben() === TK.MASS.tafel.y - 1, 'Ego-Sitz, Blick VORN, Tafel offen: Oberkante ' + PB.einblendungOben() + ' (y 261)');
      P1.win.Sitz.blick = 'crew'; ok(PB.einblendungOben() === 261, 'Blick CREW: ebenso');
      P1.win.Sitz.blick = 'pult'; ok(PB.einblendungOben() === 0, 'Blick auf das Pult: keine Einblendung, 0');
      P1.win.Sitz.blick = 'vorn'; PB.rahmen({ players: [mensch('captain')], phase: 'play' }); ok(PB.einblendungOben() === 0, 'ohne Bots: 0 (Pult unverändert)');
    }
    // K6: die gesperrte Direkttaste steht 2 s in der Quittung am Knopf „Befehle“, auch bei geschlossener Tafel
    const k = mk({ crew: [mensch('captain'), bot('ops')] });
    ok(k.m.crew()[0].quittung === null && !k.m.istOffen(), 'K6 Ausgang: Tafel zu, keine Quittung');
    const kr = k.m.taste('captain.bot.stopp');
    const q0 = k.m.crew()[0];
    ok(kr.ok === false && k.L.senden.length === 0 && q0.quittung === 'gesperrt' && q0.text === 'NAVIGATION gesperrt' && q0.textKurz === 'NAV gesperrt' && q0.fn === 'warn', 'Sh+X gesperrt, Tafel zu: Quittung „NAV gesperrt“ in warn (nichts gesendet)');
    k.warte(1900); ok(k.m.crew()[0].quittung === 'gesperrt', 'Quittung nach 1,9 s noch da');
    k.warte(200); ok(k.m.crew()[0].quittung === null && k.m.crew()[0].text === 'Befehle' && k.m.crew()[0].fn === 'cmd', 'nach 2,1 s weg (wieder „Befehle“)');
    k.m.taste('captain.bot.feuerFrei'); ok(k.m.crew()[0].quittung === 'gesendet', 'ein freier Befehl quittiert wie bisher (gesendet), nicht gesperrt');
    k.warte(5200); k.m.crew();
    const mensch2 = mk({ crew: [mensch('captain'), mensch('weapons'), bot('navigation')] });
    mensch2.m.taste('captain.bot.feuerFrei');
    ok(mensch2.m.crew()[0].quittung === 'gesperrt' && mensch2.m.crew()[0].textKurz === 'OPS gesperrt', 'Mensch an Ops: Direkttaste Feuer frei zeigt „OPS gesperrt“');
  }
  {
    // W2: Zustandsinfo aus dem Snapshot, dieselbe Abbildung wie die Abzeichen (render.js STATE_SHORT): broken = AUS = zer., damaged = BESCH = besch., geflickt ohne Wort
    const rs = fs.readFileSync(path.join(PUB, 'render.js'), 'utf8').split(String.fromCharCode(13)).join('');
    ok(/STATE_SHORT = \{ ok: 'OK', damaged: 'BESCH', broken: 'AUS', offline: 'EMP' \}/.test(rs), 'Quelle der Abbildung: render.js STATE_SHORT (damaged = BESCH, broken = AUS) unverändert');
    const sys = { reactor: 'ok', engines: 'damaged', shields: 'broken', transfer: 'ok', weapons: 'damaged', thruster_port: 'damaged', emitter_bow: 'broken',
      lafette_5: 'damaged', lafette_7: 'broken', lafette_9: 'ok', lafette_1: 'ok', weapon_bow: 'broken', battery_port: 'ok', battery_stbd: 'damaged',
      modul_1: 'damaged', modul_2: 'broken', modul_3: 'ok', modul_4: 'ok', offline_sys: 'offline' };
    const fragile = ['reactor', 'lafette_9', 'battery_port', 'modul_3'];   // geflickt (ship.fragile), Zustand ok
    const P1 = bauePult('rom', { systems: sys, fragile });
    const wi = (id, key) => P1.win.PultBefehl.wertInfo(key || 'tech.reparieren:system', id);
    const info = (id, key) => { const i = wi(id, key); return i ? i.text + '/' + i.stil : null; };
    ok(info('reactor') === null && info('transfer') === null, 'Hauptsystem heil (und geflickt): keine Info');
    ok(info('engines') === 'besch./besch' && info('weapons') === 'besch./besch', 'Hauptsystem damaged (Antrieb, Waffen): „besch.“');
    ok(info('shields') === 'zer./zer', 'Hauptsystem broken (Schilde): „zer.“');
    ok(info('thruster_port') === 'besch./besch' && info('emitter_bow') === 'zer./zer', 'Düse damaged = besch., Emitter broken = zer.');
    ok(info('lafette_5') === 'besch./besch' && info('lafette_7') === 'zer./zer' && info('lafette_9') === null && info('lafette_1') === null, 'Lafetten: damaged = besch., broken = zer., geflickt und heil ohne Info');
    ok(info('weapon_bow') === 'zer./zer' && info('battery_port') === null && info('battery_stbd') === 'besch./besch', 'Waffenplätze: Bug zer., Backbord (heil, geflickt) ohne Info, Steuerbord besch.');
    ok(info('modul_1') === 'besch./besch' && info('modul_2') === 'zer./zer' && info('modul_3') === null && info('modul_4') === null, 'Module: damaged = besch., broken = zer., geflickt und heil ohne Info');
    ok(info('offline_sys') === null && info('gibt_es_nicht') === null && info('engines', 'nav.kurs:ziel') === null && info('engines', 'tech.prio:ziel') === 'besch./besch', 'offline und unbekannte Kennung: keine Info; nur Reparieren und Priorität tragen Zustandswörter');
    ok(info('constructor') === null && info('toString') === null, 'Kennungen wie Objekteigenschaften liefern keine Info');
    // dieselbe Abbildung im Feld der Tafel (Stufe 3, alle Seiten)
    const M = P1.win.PultBefehl.menue;
    M.setzeKanon(KANON); M.synchron([mensch('captain'), bot('technik')], 'play');
    M.oeffnen(); M.waehle('E'); M.waehle('A');
    const seiten = []; for (let i = 0; i < 4; i++) { seiten.push(M.ansicht().zellen.filter((z) => z.zustand !== 'leer').map((z) => z.wert + ':' + z.info).join(' ')); M.blaettern(); }
    ok(seiten[0] === 'reactor: engines:besch. shields:zer. transfer: weapons:besch.', 'Tafel Seite 1 (Hauptsysteme): Antrieb, Schilde, Waffen zeigen den Zustand, Reaktor (geflickt) nicht – ' + seiten[0]);
    ok(/lafette_7:zer\./.test(seiten[2]) && /lafette_5:besch\./.test(seiten[2]) && /lafette_9: /.test(seiten[2]) && /battery_port: /.test(seiten[2]) && /battery_stbd:besch\./.test(seiten[2]), 'Tafel Seite 3 (Waffenplätze): Zustand je Lafette – ' + seiten[2]);
    ok(seiten[3] === 'modul_1:besch. modul_2:zer. modul_3: modul_4:', 'Tafel Seite 4 (Module): Zustand je Modul – ' + seiten[3]);
  }
  {
    // W1, K8: Info-Farbe gegen die tatsächliche Fläche (Rasterprobe im echten pult.js, beide Skins)
    const FARBEN = Object.values(TK.FN_BEFEHL).concat(Object.values(TK.FARBE.rolle), ['weapon']);
    const fns = [...new Set(FARBEN)];
    for (const skinName of ['rom', 'germanen']) {
      const P1 = bauePult(skinName, { systems: {}, fragile: [] }), K = P1.win.Pult.SKINS[skinName], F = P1.win.Pult.FN, IF = P1.win.PultBefehl.infoFarbe;
      const flaeche = (zfn, o) => (o.aus ? (skinName === 'rom' ? K.bg : K.off) : skinName === 'rom' ? F[zfn] : o.aktiv ? P1.win.Pult.mix(K.plate, F[zfn], 0.22) : K.plate);   // Fläche unter der Schrift (wie Skin.knopf sie malt)
      let min = 99, minWo = '';
      for (const zfn of fns) for (const o of [{}, { aktiv: true }, { aus: true }, { stil: 'zer' }, { stil: 'besch' }, { aktiv: true, stil: 'zer' }]) {
        const c = PS.kontrast(IF(K, zfn, o), flaeche(zfn, o));
        if (c < min) { min = c; minWo = zfn + ' ' + JSON.stringify(o); }
      }
      ok(min >= 4.5, skinName + ': Info-Schrift auf der Fläche in jedem Zustand und jeder Funktionsfarbe >= 4,5:1 (kleinster Wert ' + min.toFixed(2) + ' bei ' + minWo + ')');
    }
    {
      const R1 = bauePult('rom', {}), G1 = bauePult('germanen', {});
      const rom = R1.win.Pult.SKINS.rom, ger = G1.win.Pult.SKINS.germanen;
      const IR = R1.win.PultBefehl.infoFarbe, IG = G1.win.PultBefehl.infoFarbe;
      ok(IR(rom, 'neutral', { stil: 'zer' }) === IR(rom, 'neutral', {}) && IR(rom, 'neutral', { stil: 'besch' }) === IR(rom, 'neutral', {}), 'rom: zer./besch. behalten die Skin-Farbe (das Wort trägt die Bedeutung), keine Stilfarbe');
      ok(IG(ger, 'neutral', { stil: 'zer' }) === TK.FARBE.titelRot && IG(ger, 'neutral', { stil: 'besch' }) === G1.win.Pult.FN.warn, 'germanen: zer. in titelRot, besch. in warn (auf der dunklen Platte 5,6 und 9,8:1)');
      ok(IG(ger, 'weapon', { aktiv: true }) === ger.text && IG(ger, 'weapon', {}) === TK.FARBE.titelRot, 'germanen: auf der aktiven Platte die Schriftfarbe des Skins, sonst titelRot');
    }
    // am gezeichneten Bild: was PultBefehl.zeichne malt, gemessen an der Fläche unter dem Text (Rastersimulation)
    for (const skinName of ['rom', 'germanen']) {
      const sys = { engines: 'damaged', shields: 'broken', weapons: 'damaged', transfer: 'ok' };
      const P1 = bauePult(skinName, { systems: sys, fragile: [] });
      const PB = P1.win.PultBefehl, M = PB.menue;
      M.setzeKanon(KANON); PB.rahmen({ players: [mensch('captain'), bot('technik'), bot('ops'), bot('navigation')], phase: 'play' });
      const g = P1.win.Pult.rahmen(P1.ctx, P1.view, { titel: 'CAPTAIN', S: 240, station: 'captain' });
      const sonde = (woerter) => P1.texte.filter((t) => woerter.includes(t.s)).map((t) => ({ s: t.s, farbe: t.farbe, flaeche: P1.px[(t.y + 3) * 640 + (t.x - 2)], kontrast: PS.kontrast(t.farbe, P1.px[(t.y + 3) * 640 + (t.x - 2)]) }));
      const frisch = () => { P1.texte.length = 0; P1.ui.buttons.length = 0; PB.zeichne(P1.ctx, P1.view, g); };
      M.oeffnen(); M.waehle('E'); M.waehle('A'); frisch();
      let t = sonde(['zer.', 'besch.']);
      ok(t.length === 3 && t.every((e) => e.kontrast >= 4.5), skinName + ': Reparieren Seite 1: „zer.“ und „besch.“ gezeichnet, Kontrast gemessen ' + t.map((e) => e.s + ' ' + e.kontrast.toFixed(2)).join(', '));
      if (skinName === 'rom') ok(t.every((e) => e.farbe !== TK.FARBE.titelRot && e.farbe !== P1.win.Pult.FN.warn), 'rom: weder Rot noch Gelb als Schriftfarbe der Zustandswörter');
      M.schliessen(); M.oeffnen(); M.waehle('E'); M.waehle('D'); frisch();   // Reaktor überladen? (Nachfrage: Feld in weapon, Info „nochmal D“ auf der aktiven Fläche)
      t = sonde(['nochmal D']);
      ok(t.length === 1 && t[0].kontrast >= 4.5, skinName + ': Nachfrage „nochmal D“ auf aktiver Fläche, Kontrast gemessen ' + (t[0] ? t[0].kontrast.toFixed(2) : 'nicht gezeichnet'));
      M.schliessen(); M.taste('captain.bot.feuerHalt'); M.antwort(antwort('b2', 'ops.feuer_halt', 'ok')); M.taste('captain.bot.ausweichen'); M.antwort(antwort('b3', 'nav.ausweichen', 'ok'));
      M.oeffnen(); M.waehle('W'); frisch();   // Ops: „Feuer einstellen“ gilt (weapon)
      t = sonde(['gilt']);
      ok(t.length === 1 && t[0].kontrast >= 4.5, skinName + ': „gilt“ (Ops, weapon) auf aktiver Fläche, Kontrast gemessen ' + (t[0] ? t[0].kontrast.toFixed(2) : 'nicht gezeichnet'));
      M.zurueck(); M.waehle('Q'); frisch();   // Navigation: Ausweichen gilt (drive)
      t = sonde(['gilt']);
      ok(t.length === 1 && t[0].kontrast >= 4.5, skinName + ': „gilt“ (Navigation, drive) auf aktiver Fläche, Kontrast gemessen ' + (t[0] ? t[0].kontrast.toFixed(2) : 'nicht gezeichnet'));
    }
  }

  console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLGESCHLAGEN' : 'alle ' + n + ' Prüfungen ok'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
