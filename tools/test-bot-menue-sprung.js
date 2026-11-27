'use strict';
// TRA-01 C3: Sender für nav.sprung am Captain-Pult (Befehlstafel Navigation, Feld X + Direkttaste Shift+J). nav.sprung ist nicht sprechbar (Vertrag Bot-Befehle): es steht in
// BotMenue.MENUE_ZUSATZ (public/js/bot-menue.js), NICHT im Kanon; Matcher und Sprechfamilie kennen es nicht.
//  1. Daten: Kanon ohne nav.sprung (Inhalt), Matcher/Sprechfamilie ohne nav.sprung, Zusatz-Tabelle, Taste Shift+J frei (alle Gruppen) und verträglich mit den Konsolentasten
//  2. Tafel: Eintrag unter Navigation (Feld X), sendet nav.sprung { ziel: marke } mit quelle menu; Taste sendet quelle taste; gesperrt ohne Navigations-Bot / mit Mensch am Steuer; Sprache und Text nie
//  3. Tafel-Maße unverändert (240/258, Raster 3x3, Crew-Zeile 6 Knöpfe, keine neue Zeile)
//  4. Server: echte Annahme (Game + Navigations-Bot): ohne gewähltes Sprungziel abgelehnt kein_ziel, mit Ziel ok, per Sprache/Text quelle; Antworttexte ohne Argumente; Antwort im Client-Kern
//   node tools/test-bot-menue-sprung.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
process.chdir(path.join(__dirname, '..'));
const BM = require('../public/js/bot-menue.js');
const TK = require('../public/js/pult-befehl-tokens.js');
const Protocol = require('../shared/protocol.js');
const KANON = require('../content/bots/kanon.json');
const TEXTE = require('../content/bots/texte.json');
const Matcher = require('../shared/bot-matcher.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const lies = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ------------------------------------------------------------------ Werkzeug (wie test-bot-menue.js)
let botNr = 0;
const bot = (rolle) => ({ id: 'b' + (botNr++), bot: 1, rolle, connected: true });
const mensch = (konsole) => ({ id: 'm' + (botNr++), connected: true, console: konsole || null, station: null });
function mk(crew) {
  const L = { senden: [], untertitel: [], denied: [] };
  let t = 100000;
  const m = BM.erzeuge({
    kanon: KANON, tokens: TK, uhr: () => t, befehlTyp: Protocol.C.BOT_BEFEHL,
    senden: (msg) => { L.senden.push(msg); return true; },
    anzeige: { untertitel: (text, info) => L.untertitel.push({ text, info }), denied: (x) => L.denied.push(x), ton: () => {} },
    kappe: () => '',
  });
  m.synchron(crew || [mensch('captain'), bot('navigation'), bot('ops')], 'play');
  return { m, L, warte: (ms) => { t += ms; } };
}
const SOLL = (quelle) => ({ t: 'bot.befehl', an: 'navigation', befehl: 'nav.sprung', quelle, args: { ziel: 'marke' } });
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortiert = (v) => (Array.isArray(v) ? v.map(sortiert) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortiert(v[k])])) : v);
const eq = (a, b) => gleich(sortiert(a), sortiert(b));

(async () => {
  // ================================================================= 1. Daten
  section('1. Daten: Kanon und Matcher unverändert, Taste frei');
  ok(KANON.befehle.every((e) => e.befehl !== 'nav.sprung'), 'kanon.json: kein Eintrag nav.sprung');
  ok(!KANON.befehle.some((e) => JSON.stringify(e).toLowerCase().includes('sprung')), 'kanon.json: kein Eintrag erwähnt „Sprung“ (weder anzeige noch kurz noch werte)');
  const info = Matcher.info();
  ok(!info.befehle['nav.sprung'] && !info.familien.includes('nav.sprung'), 'Matcher/Sprechfamilie: nav.sprung hat keine Sprechform');
  ok(['Sprung', 'Sprung zum gewählten Ziel', 'Springe zur Markierung', 'Navigation, Sprung', 'Schnellsprung', 'Sprung (gewähltes Ziel)'].every((t) => { const r = Matcher.match(t); return r === null || r.befehl !== 'nav.sprung'; }), 'Matcher: kein Sprachsatz führt auf nav.sprung');
  ok(BM.MENUE_ZUSATZ.length === 1 && BM.MENUE_ZUSATZ[0].befehl === 'nav.sprung' && BM.MENUE_ZUSATZ[0].an === 'navigation' && eq(BM.MENUE_ZUSATZ[0].args, { ziel: 'marke' }) && BM.MENUE_ZUSATZ[0].nichtSprechbar === true, 'MENUE_ZUSATZ: genau nav.sprung an navigation, ziel marke, nichtSprechbar');
  ok(!/(?:befehl|cmd|name)\s*[:=]\s*'nav\.sprung'|'nav\.sprung'\s*[,\]]/.test(lies('public/js/bot-sprache.js') + lies('shared/bot-matcher.js')), 'bot-sprache.js und Matcher haben keinen Sender/Eintrag für nav.sprung (nur Kommentare)');
  // Tasten: frei in jeder Gruppe, verträglich
  const win = { localStorage: undefined }; vm.runInNewContext(lies('public/js/tasten.js'), { window: win, console }, { filename: 'tasten.js' });
  const T = win.Tasten;
  const A = T.aktion('captain.bot.sprung');
  ok(A && A.gruppe === 'captain' && eq(A.std, ['Shift+KeyJ']), 'Taste captain.bot.sprung = Shift+J (Gruppe captain)');
  ok(T.AKTIONEN.filter((a) => a.std.includes('Shift+KeyJ')).length === 1, 'Kollisionsprobe: Shift+J ist in keiner anderen Aktion (keine Gruppe) belegt');
  ok(T.konflikte('captain').length === 0 && T.konflikte('allgemein').length === 0, 'keine Tastenkonflikte in captain und allgemein');
  ok(!/Shift\+KeyJ|shiftKey[^\n]{0,60}KeyJ|KeyJ[^\n]{0,60}shiftKey/.test(lies('public/js/consoles.js')), 'consoles.js: kein Shift+J-Sonderfall; die J-Tasten der Konsolen (Notsprung, Überladen, Sonde) sind ohne Shift');
  ok(TK.LAGE.direkt.filter((d) => d.aktion === 'captain.bot.sprung').length === 1 && TK.LAGE.direkt.find((d) => d.aktion === 'captain.bot.sprung').key === 'nav.sprung:ziel=marke' && !TK.LAGE.direktOhneKnopf, 'S4: Shift+J Sprung ist ein Knopf der Crew-Zeile (sieben Knöpfe in 572 px)');
  ok(TK.LAGE.stufe2.navigation.X === 'nav.sprung:ziel=marke' && TK.FN_BEFEHL['nav.sprung'] === 'nav', 'Tafel: Navigation Feld X = Sprung, Funktionsfarbe nav');

  // ================================================================= 2. Tafel
  section('2. Tafel und Taste');
  {
    const x = mk();
    x.m.oeffnen(); x.m.waehle('Q');   // Navigation
    const z = x.m.ansicht().zellen.find((c) => c.feld === 'X');
    ok(z && z.zustand === 'bereit' && z.text === 'Sprung (gewähltes Ziel)' && z.fn === 'nav' && z.weiter === false, 'Navigation, Feld X: „Sprung (gewähltes Ziel)“, bereit, kein Unterfeld');
    ok(x.m.ansicht().pfad.startsWith('BEFEHL') && x.m.ansicht().pfad.includes('NAVIGATION'), 'Pfad der Tafel: BEFEHL · NAVIGATION');
    const r = x.m.waehle('X');
    ok(r.art === 'gesendet' && x.L.senden.length === 1 && gleich(x.L.senden[0], SOLL('menu')), 'Feld X sendet nav.sprung an navigation, args { ziel: marke }, quelle menu: ' + JSON.stringify(x.L.senden[0]));
    ok(x.m.istOffen() === false, 'Tafel schließt nach dem Senden');
    const y = mk();
    const t = y.m.taste('captain.bot.sprung');
    ok(t.ok === true && y.L.senden.length === 1 && gleich(y.L.senden[0], SOLL('taste')), 'Taste sendet quelle taste: ' + JSON.stringify(y.L.senden[0]));
    const ist = (id) => id === 'captain.bot.sprung';
    const y2 = mk(); const d = y2.m.tastenDruck(ist);
    ok(d.geschluckt === true && gleich(y2.L.senden[0], SOLL('taste')), 'tastenDruck (Tafel zu): Shift+J geschluckt, sendet quelle taste');
    const y3 = mk(); y3.m.oeffnen(); const d3 = y3.m.tastenDruck(ist);
    ok(d3.geschluckt === true && gleich(y3.L.senden[0], SOLL('taste')), 'tastenDruck (Tafel offen): die Direkttaste gilt weiter');
    const y4 = mk(); y4.m.taste('captain.bot.sprung', 'menu');
    ok(gleich(y4.L.senden[0], SOLL('menu')), 'Klick mit Quelle menu trägt quelle menu');
    ok(x.L.senden.concat(y.L.senden, y2.L.senden).every((m) => m.quelle === 'menu' || m.quelle === 'taste'), 'quelle ist nie sprache oder text');
    // gesperrt
    const g1 = mk([mensch('captain'), bot('ops')]);
    ok(g1.m.taste('captain.bot.sprung').ok === false && g1.L.senden.length === 0 && g1.L.denied.length === 1 && /Kein Bot/.test(g1.L.denied[0]), 'ohne Navigations-Bot: nichts gesendet, Grund „Kein Bot an der Navigation“');
    const g2 = mk([mensch('captain'), mensch('helm'), bot('navigation')]);
    ok(g2.m.taste('captain.bot.sprung').ok === false && g2.L.senden.length === 0 && /Mensch/.test(g2.L.denied[0]), 'Mensch am Steuer: nichts gesendet („sag es ihm“)');
    const g3 = mk([mensch('captain')]);
    ok(g3.m.tastenDruck(ist).geschluckt === false && g3.L.senden.length === 0, 'ohne Bots: die Taste ist nicht belegt (gehört den Reitern)');
    // Sprache und Text
    const s = mk();
    ok(s.m.sprachBefehl({ t: 'bot.befehl', an: 'navigation', befehl: 'nav.sprung', args: { ziel: 'marke' }, quelle: 'sprache' }) === null && s.m.sprachBefehl({ t: 'bot.befehl', an: 'navigation', befehl: 'nav.sprung', args: { ziel: 'marke' }, quelle: 'text' }) === null, 'sprachBefehl (Sprache und Textzeile): nav.sprung legt keinen Eintrag an');
    ok(s.L.senden.length === 0, 'Sprache/Text senden nichts von nav.sprung');
    ok(BM.eintragFuerArgs('nav.sprung', { ziel: 'marke' }, BM.indexVon(KANON)) === null, 'Kanon-Index kennt nav.sprung nicht (eintragFuerArgs null)');
    // ohne Kanon: Tafel „lädt“
    const e = BM.erzeuge({ kanon: null, tokens: TK, senden: () => true, anzeige: {}, kappe: () => '' }); e.synchron([mensch('captain'), bot('navigation')], 'play');
    ok(e.geladen() === false && e.oeffnen() === false, 'Kanon noch nicht geladen: Tafel bleibt „lädt“ (der Zusatz täuscht kein Laden vor)');
  }

  // ================================================================= 3. Maße
  section('3. Tafel-Maße');
  {
    const Ms = TK.MASS;
    ok(Ms.S.ohneBots === 258 && Ms.S.mitBots === 240, 'Statusleiste 258 ohne, 240 mit Bots (unverändert; test-ui-03b liest sie aus den Tokens)');
    ok(Ms.tafel.h === 64 && Ms.raster.reihen === 3 && Ms.raster.spalten === 3 && Ms.crew.x + Ms.crew.breiten.reduce((s, b) => s + b, 0) + (Ms.crew.breiten.length - 1) * Ms.crew.sx === Ms.tafel.x + Ms.tafel.w, 'Tafel 64 px hoch, Raster 3x3, Crew-Zeile 7 Knöpfe: der Eintrag nimmt Feld X einer vorhandenen Reihe');
    const x = mk(); x.m.oeffnen(); x.m.waehle('Q');
    const zs = x.m.ansicht().zellen;
    ok(zs.length === 9 && zs.filter((c) => c.zustand !== 'leer').length === 8, 'Navigation: 9 Felder, 8 belegt (vorher 7)');
    ok(x.m.crew().length === 7 && x.m.crew()[3].aktion === 'captain.bot.sprung' && x.m.crew()[3].text === 'Sprung', 'Crew-Zeile: 7 Knöpfe (Befehle + 6), Sprung an Stelle 4');
  }

  // ================================================================= 4. Server
  section('4. Server: echte Annahme');
  {
    const { Game } = require('../server/game.js');
    const Sprung = require('../server/sim/sprung.js');
    const BotSpieler = require('../server/bots/spieler.js');
    const Station = require('../server/sim/station.js');
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-spr-c3-'));
    process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
    const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: TMP, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
    const conn = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(conn);
    g.handleMessage(conn, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
    BotSpieler.botHinzufuegen(g, null, 'navigation');
    g.lobbyOpts.startMission = 'free';
    g.handleMessage(conn, { t: 'ready', ready: true });
    g.space.enemies = []; g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0;
    const navBot = () => g.players.find((p) => p.bot && p.rolle === 'navigation');
    const lauf = (sec, bis) => { const t1 = g.time + sec; while (g.time < t1) { g.step(); if (g.wantsSnapshot()) g.snapshot(); if (bis && bis()) return true; } return !!(bis && bis()); };
    lauf(30, () => Station.stationOf(navBot()) === 'helm'); lauf(1);
    g.explore.erkunde('0306');
    const s = g.ship; s.docked = false; s.dockedAt = null; s.dockArmed = true;
    const sp = Sprung.sprungpunkt(g, '0306'); s.x = sp.x - 500; s.y = sp.y + 200; s.vx = 0; s.vy = 0; s.speed = 0; lauf(1.5);
    let uhr = 1e12;
    // Die Nachricht ist EXAKT die, die der Client-Kern sendet (aus der Tafel gewonnen, nicht von Hand gebaut)
    const vomClient = (quelle) => { const x = mk(); if (quelle === 'taste') x.m.taste('captain.bot.sprung'); else { x.m.oeffnen(); x.m.waehle('Q'); x.m.waehle('X'); } return x.L.senden[0]; };
    const sende = (msg) => { uhr += 5000; const n0 = conn.inbox.length; const echt = Date.now; Date.now = () => uhr; try { g.handleMessage(conn, msg); } finally { Date.now = echt; } return conn.inbox.slice(n0).filter((m) => m.t === 'bot.antwort'); };
    const eine = (a) => (a.length === 1 ? a[0] : null);
    const a1 = eine(sende(vomClient('menu')));
    ok(a1 && a1.status === 'abgelehnt' && a1.textId === 'nav.sprung.abgelehnt.kein_ziel' && typeof a1.text === 'string' && a1.text.length > 0, 'Menü ohne gewähltes Sprungziel: abgelehnt kein_ziel mit Text (' + (a1 && a1.textId) + ')');
    const a1t = eine(sende(vomClient('taste')));
    ok(a1t && a1t.status === 'abgelehnt' && a1t.textId === 'nav.sprung.abgelehnt.kein_ziel', 'Taste ohne gewähltes Sprungziel: abgelehnt kein_ziel');
    Sprung.selectDest(g, '0306'); lauf(1);
    const aSprache = eine(sende(Object.assign({}, vomClient('menu'), { quelle: 'sprache' })));
    ok(aSprache && aSprache.status === 'abgelehnt' && aSprache.textId === 'nav.sprung.abgelehnt.quelle', 'dieselbe Nachricht mit quelle sprache: abgelehnt quelle');
    const aText = eine(sende(Object.assign({}, vomClient('menu'), { quelle: 'text' })));
    ok(aText && aText.textId === 'nav.sprung.abgelehnt.quelle', 'mit quelle text: abgelehnt quelle');
    const a2 = eine(sende(vomClient('menu')));
    ok(a2 && a2.status === 'ok' && a2.textId === 'nav.sprung.ok' && a2.befehl === 'nav.sprung' && typeof a2.text === 'string', 'Menü mit gewähltem Ziel: ok (' + (a2 && a2.textId) + ')');
    const sprang = lauf(150, () => g.ship.scene !== 'hafen');
    ok(sprang && g.ship.scene === 'splitter', 'der Bot fliegt zum Sprungpunkt und springt (Szene ' + g.ship.scene + ')');
    ok(g.errors === 0, 'keine Spielfehler');
    // Taste mit gewähltem Ziel: zweite Partie (frischer Ausgangszustand)
    {
      const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-spr-c3b-'));
      process.on('exit', () => { try { fs.rmSync(TMP2, { recursive: true, force: true }); } catch (e) { /* egal */ } });
      const h = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: TMP2, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP2, 'regie') }, log: () => {} });
      const c2 = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(x) { this.inbox.push(JSON.parse(x)); } };
      h.addConnection(c2); h.handleMessage(c2, { t: 'hello', clientId: 'K1', name: 'K1', color: 0 });
      BotSpieler.botHinzufuegen(h, null, 'navigation');
      h.lobbyOpts.startMission = 'free'; h.handleMessage(c2, { t: 'ready', ready: true });
      h.space.enemies = []; h.C.reise.neutralChance = 0; h.C.reise.neutralPlus = 0;
      const l2 = (sec, bis) => { const t1 = h.time + sec; while (h.time < t1) { h.step(); if (h.wantsSnapshot()) h.snapshot(); if (bis && bis()) return true; } return !!(bis && bis()); };
      l2(30, () => Station.stationOf(h.players.find((p) => p.bot && p.rolle === 'navigation')) === 'helm'); l2(1);
      h.explore.erkunde('0306');
      const s2 = h.ship; s2.docked = false; s2.dockedAt = null; s2.dockArmed = true;
      const p2 = Sprung.sprungpunkt(h, '0306'); s2.x = p2.x - 500; s2.y = p2.y + 200; s2.vx = 0; s2.vy = 0; s2.speed = 0; l2(1.5);
      Sprung.selectDest(h, '0306'); l2(1);
      uhr += 5000; const n0 = c2.inbox.length; const echt = Date.now; Date.now = () => uhr;
      try { h.handleMessage(c2, vomClient('taste')); } finally { Date.now = echt; }
      const aT = c2.inbox.slice(n0).filter((m) => m.t === 'bot.antwort');
      ok(aT.length === 1 && aT[0].status === 'ok' && aT[0].textId === 'nav.sprung.ok', 'Taste (quelle taste) mit gewähltem Ziel: ok');
      ok(l2(150, () => h.ship.scene !== 'hafen') && h.ship.scene === 'splitter', 'nach der Taste springt der Bot (Szene ' + h.ship.scene + ')');
    }
    // Texte: vorhanden, ohne Argumente
    const ids = ['nav.sprung.ok', 'nav.sprung.abgelehnt.kein_ziel', 'nav.sprung.abgelehnt.nicht_jetzt', 'nav.sprung.abgelehnt.quelle', 'nav.sprung.unmoeglich.kein_bot'];
    ok(ids.every((id) => Array.isArray(TEXTE[id]) && TEXTE[id].length >= 2 && TEXTE[id].every((t) => typeof t === 'string' && t.length > 3)), 'texte.json: ok, kein_ziel, nicht_jetzt, quelle, kein_bot mit je mindestens 2 Varianten');
    ok(ids.every((id) => TEXTE[id].every((t) => !/\bmarke\b|0306|hex:|objekt:|\{|\d/.test(t))), 'Antworttexte nennen keine Argumente (kein Argumentwort marke, keine Ziffer, kein Platzhalter)');
    // Antwort im Client: echte Server-Antworten gehen durch den Client-Kern
    const cl = mk();
    cl.m.taste('captain.bot.sprung');
    const r1 = cl.m.antwort(a2);
    ok(r1.verarbeitet && r1.angezeigt && cl.L.untertitel.length === 1 && cl.L.untertitel[0].text === a2.text && cl.L.untertitel[0].info.rolle === 'navigation', 'Client: ok-Antwort des Servers erscheint als Untertitel der Navigation');
    ok(cl.m.giltVon('navigation') && cl.m.giltVon('navigation').key === 'nav.sprung:ziel=marke', 'Client: „gilt“ der Navigation = Sprung');
    const cl2 = mk();
    cl2.m.taste('captain.bot.sprung');
    const r2 = cl2.m.antwort(a1);
    ok(r2.verarbeitet && cl2.L.untertitel.length === 1 && cl2.L.untertitel[0].text === a1.text && cl2.m.crew()[0].quittung === 'nein' && !cl2.m.giltVon('navigation'), 'Client: kein_ziel zeigt den Text, Quittung „abgelehnt“, kein „gilt“');
  }

  console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLER' : 'alle ' + n + ' Prüfungen ok'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
