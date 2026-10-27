'use strict';
// SUND-04a-3 Finale-UI: die Karte „Entscheidungsschlacht um Hrafnheim“ im Terminal-Bereich Kurs, ohne Browser.
//   Modell (public/js/finale.js: Storage aus world.finale, Löschsignal, welcome/Lobby, Müll, Frist als Gegenzähler) · Befehle und Tasten (public/js/terminal-ui.js gegen einen ECHTEN Server:
//   cmd { c: 'finale.waehlen' | 'finale.bestaetigen' | 'finale.ablehnen' }, zweistufig, Antworttexte, Mehrspieler, Zuschauer, laufendes Finale ohne Knöpfe) · Tastenbelegung ohne Kollision
//   (tasten.js, consoles.js) · Layout (echte pult-terminal-tokens.js: Karte und Knöpfe liegen im Bereich, überdecken nichts, kein Rot).
//   Gezeichnet und mit echten Tasten prüft tools/sicht-finale.js (Chromium).   node tools/test-finale-ui.js   (npm run test:finale-ui)
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const Maps = require('../shared/maps.js');
const Protocol = require('../shared/protocol.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const FinaleServer = require('../server/sim/finale.js');
const FinaleClient = require('../public/js/finale.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const J = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
const DATEN = require('../content/welt/finale-werte.json');
const FENSTER = DATEN.werte.bestaetigung.wert.fenster;
const ANZ = DATEN.texte.anzeige;
const TRIBUN = require('../content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === DATEN.werte.mindestrang.wert).ab;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-finale-ui-'));
let seq = 0;
const schneiden = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const drin = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

// ---------------------------------------------------------------- Browser-Umgebung (Attrappen für Render/Pult/PultTerminal, echtes consoles.js, tasten.js, absicht.js, finale.js, terminal-ui.js)
const win = { Shared_Schiffskatalog: Katalog, Shared_Maps: Maps, Shared_Config: CONFIG, Shared_Protocol: Protocol, Shared_Locations: Locations, performance, Net: { reportError(w, e) { throw e; }, on() {} }, Hud: {} };
win.window = win;
win.Render = { PAL: new Proxy({}, { get: () => '#000' }), text() {}, drawTooltip() {} };
win.Pult = {};
win.PultTerminal = { TOKENS: { RASTER: { deckName: ['Mitteldeck', 'Oberdeck', 'Unterdeck'] } }, kappe: (a, e) => e, tw: (s) => String(s).length * 6, zeichneTerminal() {} };
vm.createContext(win);
for (const f of ['tasten.js', 'consoles.js', 'absicht.js', 'finale.js', 'terminal-ui.js']) vm.runInContext(J(f), win, { filename: f });
const TU = win.TerminalUI, FI = win.Finale, AB = win.Absicht, TA = win.Tasten, CO = win.Consoles;
AB.store.texte = require('../content/flotte/absichten.json').anzeige;
const uhr = { t: 1000 }; FI.store.uhr = () => uhr.t;   // feste Uhr: der Gegenzähler der Frist ist prüfbar
ok(TU && FI && TA && CO && typeof FI.modell === 'function' && typeof TU.keyDown === 'function', 'TerminalUI, Finale, Tasten und Consoles geladen');
const snap = (finale) => ({ t: 'snap', phase: 'play', world: { finale } });
const block = (o) => Object.assign({ frei: 1, ab: 'Tribun', name: ANZ.name, text: ANZ.text }, o);

section('finale.js: Modell, Frist, Löschsignal, welcome, Lobby');
{
  for (const bad of [null, undefined, 'x', 5, []]) { let fehler = null, r; try { r = FI.modellAus(bad); } catch (e) { fehler = e; } ok(!fehler && r === null, 'modellAus(' + JSON.stringify(bad) + ') ist null, ohne Ausnahme'); }
  FI.lesen({ t: 'welcome' });
  ok(FI.modell() === null, 'ohne Block: keine Karte');
  FI.lesen(snap(block({ angebot: 1 })));
  let m = FI.modell();
  ok(m && m.zustand === 'angebot' && m.name === ANZ.name && m.text === ANZ.text && m.rest === 0 && m.phase === null, 'Angebot: Zustand angebot, Name und Text aus dem Block');
  FI.lesen({ t: 'snap', world: {} });
  ok(FI.modell() && FI.modell().zustand === 'angebot', 'ein Snapshot ohne world.finale lässt den Block stehen');
  FI.lesen(snap(block({ angebot: 1, anfrage: FENSTER })));
  m = FI.modell();
  ok(m.zustand === 'anfrage' && m.rest === FENSTER && m.frist === FENSTER, 'Anfrage: Frist ' + FENSTER + ' s, Rest ' + m.rest);
  uhr.t += 7500; m = FI.modell();
  ok(m.zustand === 'anfrage' && m.rest === FENSTER - 7, 'nach 7,5 s: Rest ' + m.rest + ' (aufgerundet, die Frist läuft ab dem Eintreffen)');
  uhr.t += FENSTER * 1000; m = FI.modell();
  ok(m.zustand === 'angebot' && m.rest === 0, 'Frist abgelaufen (Block noch da): wieder nur das Angebot, kein „Bestätigen“');
  FI.lesen(snap(block({ angebot: 1 })));
  FI.lesen(snap(block({ angebot: 1, anfrage: FENSTER })));
  ok(FI.modell().zustand === 'anfrage' && FI.modell().rest === FENSTER, 'neue Anfrage nach dem Verfall: die Frist beginnt neu');
  uhr.t += 3000;
  FI.lesen(snap(block({ angebot: 1, anfrage: FENSTER })));
  uhr.t += 1000;
  ok(FI.modell().rest === FENSTER - 4, 'derselbe Block noch einmal: die Frist läuft weiter (kein Neustart des Zählers)');
  FI.lesen(snap(block({ phase: 'orbit' })));
  m = FI.modell();
  ok(m.zustand === 'phase' && m.phase === 'orbit' && m.rest === 0, 'läuft: Phase orbit, kein Rest');
  FI.lesen(snap(block({ phase: 'boden' })));
  ok(FI.modell().phase === 'boden' && FI.modell().zustand === 'phase', 'Phase boden');
  FI.lesen(snap(block({ phase: 'ende', frei: 0 })));
  ok(FI.modell() && FI.modell().phase === 'ende', 'Phase ende bleibt sichtbar (auch ohne Rang)');
  FI.lesen(snap(block({ frei: 0 })));
  ok(FI.modell() === null, 'frei 0, kein Angebot, kein Finale: keine Karte');
  FI.lesen(snap(block({ frei: 1 })));
  ok(FI.modell() === null, 'frei, aber ohne Angebot (Pause nach Ablehnen): keine Karte');
  FI.lesen(snap(block({ angebot: 1 })));
  FI.lesen(snap(null));
  ok(FI.modell() === null, 'world.finale = null (Löschsignal) leert');
  FI.lesen(snap(block({ angebot: 1 }))); FI.lesen({ t: 'welcome' });
  ok(FI.modell() === null, 'welcome leert (neue Verbindung, der Server sendet neu)');
  FI.lesen(snap(block({ angebot: 1 }))); FI.lesen({ t: 'snap', phase: 'lobby' });
  ok(FI.modell() === null, 'die Lobby leert');
  const muell = [null, undefined, 'x', 5, [], {}, { name: 5 }, { name: 'X' }, { name: 'X', frei: 1, angebot: 1, anfrage: 'x', phase: 'zzz', text: 7 }, { name: 'X', frei: 1, angebot: 1, anfrage: -4 }, { name: 'X', frei: 1, angebot: 1, anfrage: NaN }, { name: 'X', phase: ['orbit'] }, { name: 'X', frei: 1, angebot: 1, anfrage: 1e9 }];
  for (const bad of muell) {
    let m2, fehler = null; try { m2 = FI.modellAus(bad); } catch (e) { fehler = e; }
    ok(!fehler && (m2 === null || (m2.name && ['angebot', 'anfrage', 'phase'].includes(m2.zustand) && m2.rest >= 0 && m2.rest <= m2.frist + 0)), 'Müll als Block ohne Ausnahme: ' + JSON.stringify(bad));
  }
  for (const bad of [null, 5, 'x', [], { t: 'snap', world: 'x' }, { t: 'snap', world: { finale: 'x' } }, { t: 'snap', world: { finale: 7 } }, { t: 'snap', world: { finale: [] } }]) {
    let fehler = null; try { FI.lesen(bad); FI.modell(); } catch (e) { fehler = e; }
    ok(!fehler, 'Müll als Nachricht ohne Ausnahme: ' + JSON.stringify(bad));
  }
  FI.lesen({ t: 'welcome' });
}

section('Tastenbelegung ohne Kollision');
{
  const ids = ['terminal.finale', 'terminal.finaleAblehnen'];
  const akt = (id) => TA.AKTIONEN.find((a) => a.id === id);
  ok(ids.every((id) => akt(id)), 'tasten.js kennt terminal.finale und terminal.finaleAblehnen');
  ok(ids.every((id) => akt(id).bereich === 'terminal.lage' && akt(id).gruppe === 'terminal'), 'beide gelten nur im Bereich Kurs (terminal.lage)');
  ok(akt('terminal.finale').std.join() === 'KeyE' && akt('terminal.finaleAblehnen').std.join() === 'KeyN', 'Standardtasten E (anfragen/bestätigen) und N (ablehnen)');
  ok(TA.konflikte('terminal').length === 0, 'Gruppe terminal ohne doppelt belegte Taste' + (TA.konflikte('terminal').length ? ': ' + TA.konflikte('terminal').map((x) => x.taste + '=' + x.ids.join('/')).join(', ') : ''));
  const andere = TA.AKTIONEN.filter((a) => !ids.includes(a.id) && (a.gruppe === 'terminal' || a.gruppe === 'allgemein') && (!a.bereich || a.bereich === 'terminal.lage'));
  ok(andere.every((a) => !a.std.some((t) => /^(Shift\+)?Key[EN]$/.test(t))), 'E und N sind im Bereich Kurs (mit allen bereichslosen und allgemeinen Tasten) sonst nicht belegt');
  ok(TA.AKTIONEN.find((a) => a.id === 'terminal.annehmen').std.includes('Enter') && TA.AKTIONEN.find((a) => a.id === 'terminal.ablehnen').std.join() === 'KeyX', 'die Absichten behalten Enter und X (nicht doppelt belegt)');
  // Umbelegung greift über Consoles.tastenKanon (der Bereich Kurs ist offen)
  const view = { me: { console: 'shop' }, state: {} };
  const bereich = (b) => { win.TerminalUI.zustand.bereich = b; };
  bereich('lage');
  FI.lesen(snap(block({ angebot: 1 }))); AB.lesen({ t: 'snap', world: { absicht: { frei: 1, ab: 'Tribun', angebot: [{ id: 'a', name: 'A', text: 'x', dauer: 5 }, { id: 'b', name: 'B', text: 'y', dauer: 6 }], rest: 4 } } });
  ok(CO.tastenBereiche('shop', view).has('terminal.lage'), 'Consoles.tastenBereiche: im Bereich Kurs gelten die Tasten von terminal.lage');
  TA.setze('terminal.finale', 0, 'KeyZ');
  const k1 = CO.tastenKanon({ code: 'KeyZ' }, 'shop', view, false), k2 = CO.tastenKanon({ code: 'KeyE' }, 'shop', view, false);
  ok(k1 && k1.code === 'KeyE' && k2 === null, 'umbelegt auf Z: Z wirkt wie E, die alte Taste E ist wegbelegt');
  TA.zuruecksetzen('terminal.finale');
  const k3 = CO.tastenKanon({ code: 'KeyE' }, 'shop', view, false);
  ok(k3 && k3.code === 'KeyE', 'zurückgesetzt: E gilt wieder');
  bereich('werft'); ok(!CO.tastenBereiche('shop', view).has('terminal.lage'), 'in der Werft gelten E und N nicht');
  TU.zuruecksetzen(); FI.lesen({ t: 'welcome' }); AB.lesen({ t: 'welcome' });
}

// ---------------------------------------------------------------- Partie (Freie Fahrt Sund, zwei Spieler), UI von Spieler 0 (und 1) am Terminal
let szenen = 0;
FinaleServer.ersetzen('szene', { finaleStarten: () => { szenen++; return { id: 1 }; } });
FinaleServer.ersetzen('boden', { bodenStarten: () => true });
FinaleServer.ersetzen('abspann', { beenden: () => true });
function partie(start) {
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: fs.mkdtempSync(path.join(TMP, 'w' + (++seq))), seed: 7, debug: true, log: () => {}, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') } });
  const conns = [0, 1].map((i) => { const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'U' + i, name: 'Ui' + i, color: i }); return c; });
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: start || 'freie_fahrt' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < CONFIG.tickHz; i++) g.step();
  g.space.enemies = [];
  g.players[0].console = 'shop'; g.players[1].console = 'shop';
  AB.lesen({ t: 'welcome' }); FI.lesen({ t: 'welcome' });
  const T = { g, conns, cmds: [] };
  T.view = (i) => ({ state: JSON.parse(JSON.stringify(g.snapshot())), me: g.players[i], send(m) { if (/^finale/.test(m.c || '')) T.cmds.push(m); g.handleMessage(conns[i], m); T.nachlauf(i); }, actions: { sfx() {}, leave() {} } });
  T.nachlauf = (i) => { const inbox = conns[i].inbox.splice(0); for (const m of inbox) if (m.t === 'event' && /^(werft|absichtAntwort|finaleAntwort)/.test(m.kind)) TU.onEvent(m); };
  T.lesen = () => { for (let i = 0; i < 40; i++) { const sn = Object.assign({ t: 'snap' }, g.snapshot()); AB.lesen(sn); FI.lesen(sn); } };
  T.key = (code, i) => { T.lesen(); const v = T.view(i || 0); const r = TU.keyDown({ code, preventDefault() {} }, v); T.nachlauf(i || 0); return r; };
  T.m = (i) => { T.lesen(); return TU.modell(T.view(i || 0)); };
  T.tick = (k) => { for (let j = 0; j < (k || 1); j++) Kriegslage.tick(g, 'test'); };
  T.anbieten = () => { g.weltsim.ruf.rom = TRIBUN; T.tick(); TU.zuruecksetzen(); T.zeichnen(); T.key('KeyK'); };
  T.zeichnen = (i) => { win.Render.ui = { buttons: [], mouse: { x: 0, y: 0 } }; T.lesen(); TU.draw({}, T.view(i || 0)); T.nachlauf(i || 0); };
  T.fcmds = () => T.cmds.splice(0);
  return T;
}
const warte = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* aktiv warten, Test ist synchron */ } };

section('Vor Tribun und in der Kampagne: keine Karte');
{
  const T = partie(); TU.zuruecksetzen(); T.zeichnen(); T.key('KeyK');
  let m = T.m();
  ok(m.bereich === 'lage' && !m.lage.finale && FI.modell() === null, 'vor Tribun: Bereich Kurs ohne Karte (kein Block)');
  T.key('KeyE'); T.key('KeyN');
  ok(T.fcmds().length === 0, 'E und N senden vor dem Angebot keinen Befehl');
  const K = partie('free'); TU.zuruecksetzen(); K.zeichnen(); K.key('KeyK');
  ok(!K.g.weltsim && FI.modell() === null && K.m().bereich !== 'lage', 'Kampagne: kein Modus, keine Karte, kein Bereich');
}

section('Angebot: Karte, Anfrage (E), Bestätigen (n s), Start');
{
  const T = partie(); T.anbieten();
  let m = T.m(); const g = T.g;
  ok(g.weltsim.finale.angebot === 1 && FI.modell() && FI.modell().zustand === 'angebot', 'Tribun: Server legt das Angebot an, der Block kommt an');
  const f = m.lage.finale;
  ok(m.bereich === 'lage' && f && f.zustand === 'angebot' && f.tag === 'FINALE · ANGEBOT' && f.name === ANZ.name && f.text === ANZ.text, 'Karte im Bereich Kurs: Tag ANGEBOT, Name und Text vom Server (finale-werte.json, anzeige)');
  ok(f.haupt.text === 'Anfragen' && f.haupt.disabled === false && f.ablehnen.text === 'Schlacht ablehnen' && f.ablehnen.disabled === false && typeof f.haupt.onClick === 'function', 'Knöpfe „Anfragen“ und „Schlacht ablehnen“ aktiv');
  ok(m.lage.zustand === 'angebot' || m.lage.zustand === 'leer', 'die Absichten daneben bleiben (Zustand ' + m.lage.zustand + ')');
  // E: Anfrage
  T.key('KeyE');
  const c1 = T.fcmds();
  ok(c1.length === 1 && JSON.stringify(c1[0]) === JSON.stringify({ t: 'cmd', c: 'finale.waehlen' }), 'E sendet genau cmd { c: "finale.waehlen" } ohne weitere Felder');
  ok(g.weltsim.finale.anfrage && TU.zustand.antwort && TU.zustand.antwort.ok === true && TU.zustand.antwort.text === FI.TEXTE.gewaehlt_waehlen, 'Server: Anfrage gestellt, Antwort ok mit Text aus der Datei');
  m = T.m(); const a = m.lage.finale;
  ok(a.zustand === 'anfrage' && a.tag === 'FINALE · ANFRAGE' && a.hinweis === 'Verstreicht die Frist, passiert nichts.' && a.haupt.text === 'Bestätigen (' + FENSTER + ' s)' && a.rest === FENSTER && a.frist === FENSTER, 'Karte: Anfrage, Knopf „Bestätigen (' + FENSTER + ' s)“');
  ok(a.ablehnen.disabled === false && g.weltsim.finale.phase === null && szenen === 0, 'Ablehnen bleibt möglich, das Finale läuft noch nicht');
  uhr.t += 4200; m = T.m();
  ok(m.lage.finale.haupt.text === 'Bestätigen (' + (FENSTER - 4) + ' s)', 'der Knopf zählt mit: ' + m.lage.finale.haupt.text);
  // Entprellen: ein Bestätigen gleich nach der eigenen Anfrage geht nicht hinaus
  T.key('KeyE');
  ok(T.fcmds().length === 0 && g.weltsim.finale.phase === null, 'E sofort nach der Anfrage (Doppeldruck): kein Befehl, nichts beginnt');
  warte(650);
  T.key('KeyE');
  const c2 = T.fcmds();
  ok(c2.length === 1 && JSON.stringify(c2[0]) === JSON.stringify({ t: 'cmd', c: 'finale.bestaetigen' }), 'E danach sendet genau cmd { c: "finale.bestaetigen" }');
  ok(g.weltsim.finale.phase === 'orbit' && szenen === 1 && TU.zustand.antwort.ok === true && TU.zustand.antwort.text === FI.TEXTE.gewaehlt_bestaetigen, 'Server: Finale läuft (Phase orbit), Antwort ok');
  m = T.m(); const l = m.lage.finale;
  ok(l.zustand === 'phase' && l.tag === 'FINALE · LÄUFT' && l.hinweis === FI.TEXTE.status_orbit && l.haupt === null && l.ablehnen === null, 'Karte: läuft (Orbit), Statushinweis, keine Knöpfe');
  ok(l.schritte.length === 2 && l.schritte[0].aktiv === true && l.schritte[1].aktiv === false, 'Schritte Orbit (aktiv) und Boden');
  T.key('KeyE'); T.key('KeyN');
  ok(T.fcmds().length === 0, 'E und N bei laufendem Finale: keine Befehle');
  FinaleServer.orbitEnde(g, 'sieg'); m = T.m();
  ok(m.lage.finale.zustand === 'phase' && m.lage.finale.hinweis === FI.TEXTE.status_boden && m.lage.finale.schritte[0].fertig === true && m.lage.finale.schritte[1].aktiv === true, 'nach dem Orbit-Sieg: Phase Boden, Orbit fertig');
}

section('Ablehnen (N) kostet nichts, auch aus der Anfrage');
{
  const T = partie(); T.anbieten(); const g = T.g;
  const ruf0 = JSON.stringify(g.weltsim.ruf);
  T.key('KeyN');
  const c = T.fcmds();
  ok(c.length === 1 && JSON.stringify(c[0]) === JSON.stringify({ t: 'cmd', c: 'finale.ablehnen' }), 'N sendet genau cmd { c: "finale.ablehnen" }');
  ok(g.weltsim.finale.angebot === 0 && JSON.stringify(g.weltsim.ruf) === ruf0 && TU.zustand.antwort.ok === true && TU.zustand.antwort.text === 'Entscheidungsschlacht abgelehnt. Sie kommt in ' + DATEN.werte.abstand_nach_ablehnen.wert + ' Sprüngen wieder.', 'Server: Angebot weg, Ruf gleich; Antwort „Entscheidungsschlacht abgelehnt. Sie kommt in ' + DATEN.werte.abstand_nach_ablehnen.wert + ' Sprüngen wieder.“ (Zahl aus den Daten, über den Block)');
  ok(T.m().lage.finale === undefined && FI.modell() === null, 'danach keine Karte (Pause), kein Platzhalter');
  const U = partie(); U.anbieten(); U.key('KeyE'); U.fcmds(); warte(10);
  const m = U.m();
  ok(m.lage.finale.zustand === 'anfrage', 'zweiter Lauf: Anfrage steht');
  m.lage.finale.ablehnen.onClick(); U.nachlauf(0);
  ok(U.fcmds().length === 1 && U.g.weltsim.finale.angebot === 0 && U.g.weltsim.finale.anfrage === null && U.g.weltsim.finale.phase === null, 'Ablehnen per Klick aus der Anfrage: Angebot und Anfrage weg, kein Finale');
}

section('Verfallene Anfrage: kein Bestätigen ohne Frist');
{
  const T = partie(); T.anbieten(); const g = T.g;
  T.key('KeyE'); T.fcmds(); T.m();
  uhr.t += (FENSTER + 1) * 1000;
  let m = T.m();
  ok(m.lage.finale.zustand === 'angebot' && m.lage.finale.haupt.text === 'Anfragen' && !/Bestätigen/.test(m.lage.finale.haupt.text), 'Frist um: der Knopf heißt wieder „Entscheidungsschlacht“, kein Bestätigen');
  warte(650); T.key('KeyE');
  const c = T.fcmds();
  ok(c.every((q) => q.c !== 'finale.bestaetigen') && g.weltsim.finale.phase === null, 'E nach der Frist sendet kein finale.bestaetigen');
  ok(TU.zustand.antwort && TU.zustand.antwort.ok === false && /Anfrage läuft schon/.test(TU.zustand.antwort.text), 'wenn der Server die Anfrage noch kennt, sagt er es: „' + (TU.zustand.antwort && TU.zustand.antwort.text) + '“ (Absage in der Infozeile)');
  m = T.m();
  ok(/Anfrage läuft schon/.test(m.lage.info.grund || ''), 'die Absage steht in der Infozeile (Warnfarbe)');
  // Der Server hält die Frist selbst: eine zu späte Bestätigung wird abgelehnt
  const V = partie(); V.anbieten(); V.key('KeyE'); V.fcmds(); V.g.time += FENSTER + 1;
  const v = V.view(0); v.send({ t: 'cmd', c: 'finale.bestaetigen' });
  ok(V.g.weltsim.finale.phase === null && TU.zustand.antwort.ok === false && /Frist|Anfrage/.test(TU.zustand.antwort.text), 'Gegenprobe Server: späte Bestätigung abgelehnt (' + TU.zustand.antwort.text + ')');
}

section('Mehrspieler: alle sehen die Anfrage, die erste Bestätigung gilt');
{
  const T = partie(); T.anbieten(); const g = T.g;
  T.key('KeyE', 0); T.fcmds();
  const m1 = T.m(1);
  ok(m1.lage.finale && m1.lage.finale.zustand === 'anfrage' && /^Bestätigen \(\d+ s\)$/.test(m1.lage.finale.haupt.text), 'Spieler 2 sieht dieselbe Anfrage mit „Bestätigen (n s)“ (der Block ist für alle gleich)');
  warte(650);
  T.key('KeyE', 1);
  ok(g.weltsim.finale.phase === 'orbit' && T.fcmds().length === 1, 'Spieler 2 bestätigt: das Finale läuft');
  // Spieler 1 hatte noch die Anfrage auf dem Schirm: seine Bestätigung kommt zu spät
  const alt = FI.store.finale; const kopie = JSON.parse(JSON.stringify(alt));
  FI.store.finale = Object.assign({}, kopie, { phase: undefined, angebot: 1, anfrage: FENSTER }); FI.store.anfrageStart = uhr.t;
  const v0 = T.view(0); TU.keyDown({ code: 'KeyE', preventDefault() {} }, v0); T.nachlauf(0);
  ok(TU.zustand.antwort && TU.zustand.antwort.ok === false && /läuft schon/.test(TU.zustand.antwort.text), 'die zweite Bestätigung: Absage „' + (TU.zustand.antwort && TU.zustand.antwort.text) + '“ in der Infozeile');
  ok(g.weltsim.finale.phase === 'orbit' && szenen >= 1, 'es startet nur einmal');
  FI.store.finale = alt;
}

section('Zuschauer sehen die Karte, bedienen sie nicht');
{
  const T = partie(); T.anbieten(); const g = T.g;
  T.key('KeyE', 0); T.fcmds(); warte(130); T.zeichnen();
  g.handleMessage(T.conns[1], { t: 'cmd', c: 'werft.zusehen', on: true });
  TU.zusehen({ send() {} }, true); T.lesen();
  const mz = TU.modell(T.view(1)); const f = mz.lage && mz.lage.finale;
  ok(mz.bereich === 'lage' && f && f.zustand === 'anfrage' && f.haupt.disabled === true && f.haupt.onClick === null && f.ablehnen.disabled === true && f.ablehnen.onClick === null, 'Zuschauer: Karte mit Anfrage, beide Knöpfe gesperrt, keine Klickfunktion');
  const v1 = T.view(1);
  for (const code of ['KeyE', 'KeyN']) TU.keyDown({ code, preventDefault() {} }, v1);
  ok(T.fcmds().length === 0 && g.weltsim.finale.phase === null && g.weltsim.finale.anfrage, 'E und N des Zuschauers senden nichts, die Anfrage bleibt');
  TU.zusehen({ send() {} }, false);
}

section('Zuschauer können nicht anfragen und nicht ablehnen');
{
  const T = partie(); T.anbieten(); const g = T.g;
  warte(130); T.zeichnen(); g.handleMessage(T.conns[1], { t: 'cmd', c: 'werft.zusehen', on: true });
  TU.zusehen({ send() {} }, true); T.lesen();
  const v1 = T.view(1);
  for (const code of ['KeyE', 'KeyN']) TU.keyDown({ code, preventDefault() {} }, v1);
  const mz = TU.modell(T.view(1)); if (mz.lage && mz.lage.finale) { mz.lage.finale.haupt.onClick && mz.lage.finale.haupt.onClick(); mz.lage.finale.ablehnen.onClick && mz.lage.finale.ablehnen.onClick(); }
  ok(mz.lage && mz.lage.finale && mz.lage.finale.zustand === 'angebot' && T.fcmds().length === 0 && g.weltsim.finale.angebot === 1 && g.weltsim.finale.anfrage === null, 'Zuschauer: E, N und Klicks im Angebot senden nichts, das Angebot steht unverändert');
  TU.zusehen({ send() {} }, false);
}

section('Löschsignal, Rangverlust, Modus-Ende');
{
  const T = partie(); T.anbieten(); const g = T.g;
  ok(T.m().lage.finale, 'Karte da');
  g.weltsim.ruf.rom = 0; T.tick();
  T.lesen();
  ok(FI.modell() === null && !TU.modell(T.view(0)).lage.finale, 'Rang weg: das Angebot ist zurückgezogen, die Karte verschwindet (Block null oder ohne Angebot)');
  const U = partie(); U.anbieten();
  const merk = U.g.weltsim; U.g.weltsim = null; U.lesen();
  ok(FI.modell() === null, 'Modus endet: Löschsignal world.finale = null, keine Karte mehr');
  U.g.weltsim = merk;
}

section('Welle 5 (S1, S3, S4): Tastenzeile, Tags, Ablehnen mit Pause, Neubeginn');
{
  const T = partie(); T.anbieten(); const g = T.g;
  let m = T.m();
  ok(/ · E Schlacht · N ablehnen$/.test(m.lage.hilfe || ''), 'Tastenzeile der Karte endet auf „E Schlacht · N ablehnen“ (' + m.lage.hilfe + ')');
  ok(/↑↓ wählen/.test(m.lage.hilfe), 'die Tasten der Absichten bleiben in der Zeile');
  ok(ANZ.text.indexOf('Ablehnen kostet nichts') < 0 && !/ablehn/i.test(ANZ.text), 'Anzeigetext (finale-werte.json) ohne „Ablehnen kostet nichts.“');
  T.key('KeyE'); T.fcmds(); m = T.m();
  ok(m.lage.finale.tag === 'FINALE · ANFRAGE' && m.lage.finale.hinweis === 'Verstreicht die Frist, passiert nichts.', 'Anfrage: Tag „FINALE · ANFRAGE“, Frist-Hinweis „Verstreicht die Frist, passiert nichts.“');
  warte(650); T.key('KeyE'); T.fcmds(); m = T.m();
  const l = m.lage.finale;
  ok(l.zustand === 'phase' && l.tag === 'FINALE · LÄUFT' && !/ablehn/i.test(l.text + ' ' + l.hinweis), 'läuft: Tag „FINALE · LÄUFT“, kein Ablehnen-Satz');
  ok(!/Schlacht/.test(m.lage.hilfe || ''), 'bei laufendem Finale steht E/N nicht in der Tastenzeile (ohne Wirkung)');
  ok(TU.zustand.antwort && TU.zustand.antwort.text === 'Die Schlacht beginnt.', 'Rückmeldung nach dem Bestätigen: „Die Schlacht beginnt.“');
  // Niederlage im Orbit: Neubeginn, das Angebot steht wieder da (Pause 0)
  FinaleServer.orbitEnde(g, 'niederlage'); T.tick(); m = T.m();
  const n1 = m.lage.finale;
  ok(!!n1 && n1.zustand === 'angebot' && n1.neuerAnlauf === true && n1.hinweis === 'Neuer Anlauf: Die Crew ist zurück.', 'Neubeginn nach der Niederlage: die Hinweiszeile sagt „Neuer Anlauf: Die Crew ist zurück.“' + (n1 ? ' (' + n1.hinweis + ')' : ''));
  ok(TU.zustand.antwort === null, 'die Rückmeldung „Die Schlacht beginnt.“ ist beim Wechsel von Phase auf Angebot geleert');
  ok(n1.tag === 'FINALE · ANGEBOT', 'Tag wieder „FINALE · ANGEBOT“');
  // neue Anfrage: kein „Neuer Anlauf“ mehr
  T.key('KeyE'); T.fcmds(); m = T.m();
  ok(m.lage.finale.zustand === 'anfrage' && m.lage.finale.hinweis === 'Verstreicht die Frist, passiert nichts.', 'nach der neuen Anfrage steht wieder der Frist-Hinweis');
  T.key('KeyN'); T.fcmds(); T.tick(); T.m();
  // Boden: gefallene Crew
  const U = partie(); U.anbieten(); U.key('KeyE'); U.fcmds(); warte(650); U.key('KeyE'); U.fcmds();
  U.m(); FinaleServer.orbitEnde(U.g, 'sieg'); U.m(); FinaleServer.bodenEnde(U.g, 'crew_gefallen'); U.tick(); const mu = U.m();
  ok(mu.lage.finale && mu.lage.finale.zustand === 'angebot' && mu.lage.finale.neuerAnlauf === true && mu.lage.finale.hinweis === 'Neuer Anlauf: Die Crew ist zurück.', 'Neubeginn nach dem Boden (Crew gefallen): ebenso');
  // ohne Neubeginn, nur ein neues Angebot: der normale Hinweis
  const V = partie(); V.anbieten();
  ok(V.m().lage.finale.neuerAnlauf === false && V.m().lage.finale.hinweis === 'Erst anfragen, dann bestätigen.', 'ohne Neubeginn: „Erst anfragen, dann bestätigen.“');
}

section('Welle 5 (S4): „Neuer Anlauf“ nur direkt nach einem Neubeginn');
{
  FI.lesen({ t: 'welcome' });
  const ist = () => FI.modell();
  FI.lesen(snap(block({ phase: 'orbit' })));
  ok(ist().zustand === 'phase' && ist().neuerAnlauf === false, 'laufende Phase: kein neuer Anlauf');
  const w0 = ist().wechsel;
  FI.lesen(snap(block({ angebot: 1 })));
  ok(ist().zustand === 'angebot' && ist().neuerAnlauf === true && ist().wechsel === w0 + 1, 'Phase orbit → Angebot: neuer Anlauf, der Wechsel ist gezählt');
  FI.lesen(snap(block({ angebot: 1, rest: 1 })));
  ok(ist().neuerAnlauf === true && ist().wechsel === w0 + 1, 'derselbe Block noch einmal: bleibt, zählt nicht doppelt');
  FI.lesen(snap(block({ angebot: 1, anfrage: FENSTER })));
  ok(ist().zustand === 'anfrage' && ist().neuerAnlauf === false, 'eine neue Anfrage beendet den neuen Anlauf');
  FI.lesen(snap(block({ angebot: 1 })));
  ok(ist().zustand === 'angebot' && ist().neuerAnlauf === false, 'zurück auf Angebot (Frist verfallen): kein „Neuer Anlauf“ mehr');
  FI.lesen(snap(block({ phase: 'boden' }))); FI.lesen(snap(block({})));
  ok(ist() === null, 'Neubeginn ohne Angebot (Pause): keine Karte');
  FI.lesen(snap(block({ angebot: 1 })));
  ok(ist().neuerAnlauf === false, 'das Angebot nach der Pause trägt keinen „Neuer Anlauf“ mehr');
  FI.lesen(snap(block({ phase: 'orbit' }))); FI.lesen(snap(block({ phase: 'ende' }))); FI.lesen(snap(block({ angebot: 1 })));
  ok(ist().neuerAnlauf === false, 'nach dem Ende (phase ende) ist kein Neubeginn');
  FI.lesen({ t: 'welcome' });
}

section('Welle 5 (S1): Rückmeldung zum Ablehnen mit der Pause aus dem Block');
{
  FI.lesen({ t: 'welcome' });
  ok(FI.antwortText('ablehnen') === 'Entscheidungsschlacht abgelehnt.', 'ohne bekannte Pause: „Entscheidungsschlacht abgelehnt.“ (ohne Zahl)');
  FI.lesen(snap(block({ angebot: 1, pause: 12 })));
  ok(FI.antwortText('ablehnen') === 'Entscheidungsschlacht abgelehnt. Sie kommt in 12 Sprüngen wieder.', 'Pause 12 aus dem Block: „… Sie kommt in 12 Sprüngen wieder.“');
  FI.lesen(snap(block({ angebot: 1, pause: 1 })));
  ok(FI.antwortText('ablehnen') === 'Entscheidungsschlacht abgelehnt. Sie kommt in 1 Sprung wieder.', 'Pause 1: „… in 1 Sprung wieder.“');
  FI.lesen(snap(block({ pause: 12 })));
  ok(FI.antwortText('ablehnen').indexOf('12 Sprüngen') > 0, 'die Pause bleibt auch erhalten, wenn das Angebot schon weg ist (die Antwort kommt nach dem Block)');
  FI.lesen(snap(block({ angebot: 1, pause: -3 }))); FI.lesen({ t: 'welcome' });
  ok(FI.antwortText('bestaetigen') === 'Die Schlacht beginnt.' && FI.antwortText('waehlen') === 'Angefragt: jetzt bestätigen.', 'die anderen Rückmeldungen bleiben');
  const blk = require('../server/sim/finale.js');
  ok(typeof blk.snapshot === 'function', 'Server liefert snapshot');
  const T = partie(); T.anbieten();
  ok(T.g.weltsim.finale && FI.store.finale && FI.store.finale.pause === DATEN.werte.abstand_nach_ablehnen.wert, 'der Block trägt die Pause aus den Daten (abstand_nach_ablehnen = ' + DATEN.werte.abstand_nach_ablehnen.wert + ')');
}

// ---------------------------------------------------------------- Layout mit der echten pult-terminal-tokens.js
section('Layout: Karte und Knöpfe im Bereich, ohne Überdeckung, kein Rot');
{
  const FN = { weapon: '#ff0001', shield: '#00ff02', nav: '#ffd203', warn: '#ffff04', drive: '#ffa005', sensor: '#00ffe6', neutral: '#888807' };
  const gezeichnet = { rects: [], texte: [], knoepfe: [] };
  let fill = null;
  const ctx = new Proxy({}, { get: (t, k) => (k === 'fillRect' ? (x, y, w, h) => gezeichnet.rects.push({ x, y, w, h, col: fill }) : () => {}), set: (t, k, v) => { if (k === 'fillStyle') fill = v; return true; } });
  const R2 = {
    measure: (s) => String(s).length * 6,
    wrap: (s, w) => { const out = []; let z = ''; for (const wort of String(s).split(' ')) { const t = z ? z + ' ' + wort : wort; if (t.length * 6 > w && z) { out.push(z); z = wort; } else z = t; } if (z) out.push(z); return out; },
    text: (c, s, x, y, o) => gezeichnet.texte.push({ s: String(s), x, y, w: String(s).length * 6, h: 7, col: o && o.color }),
    ui: { buttons: [], mouse: { x: -1, y: -1 } },
  };
  const P2 = { FN, SKINS: { rom: { screenBg: '#000008', bg: '#000009', text: '#fffff0', dim: '#888881', ink: '#000010', off: '#000011', offLine: '#000012', frame: '#000013' } }, mix: (a) => a, rgba: (a) => a, cham() {}, zelle() {}, titel() {},
    knopf(c, x, y, w, h, label, o) { const b = { x, y, w, h, label, fn: o && o.fn, kontur: !!(o && o.kontur), disabled: !!(o && o.disabled), onClick: o && o.onClick, hotkey: o && o.hotkey }; gezeichnet.knoepfe.push(b); R2.ui.buttons.push(b); return b; } };
  const w2 = { Render: R2, Pult: P2, Shared_Protocol: {}, performance, Tasten: TA };
  w2.window = w2; vm.createContext(w2);
  vm.runInContext(J('pult-terminal-tokens.js'), w2, { filename: 'pult-terminal-tokens.js' });
  const PT = w2.PultTerminal, L = PT.layout(640, 360), FARBE = PT.TOKENS.FARBE;
  ok(typeof PT.zeichneFinale === 'function' && typeof PT.finaleLayout === 'function', 'zeichneFinale und finaleLayout exportiert');
  const G = PT.finaleLayout(L.handel);
  ok(drin(G.karte, L.handel) && !schneiden(G.karte, L.handelInfo), 'Karte liegt im Bereich (' + G.karte.x + ',' + G.karte.y + ' ' + G.karte.w + 'x' + G.karte.h + ') und überdeckt die Infozeile nicht');
  ok([G.haupt, G.ablehnen].every((b) => drin(b, G.karte)) && !schneiden(G.haupt, G.ablehnen) && !schneiden(G.haupt, G.hinweis) && !schneiden(G.hinweis, G.text) && !schneiden(G.text, G.name) && !schneiden(G.tag, G.name) && !schneiden(G.schritte, G.hinweis), 'Geometrie: Knöpfe in der Karte, Zeilen überschneiden sich nicht');
  ok(G.haupt.h >= 14 && G.ablehnen.h >= 13 && G.haupt.w >= 120, 'Knöpfe so groß wie die übrigen Terminalknöpfe (≥ 13 px hoch)');

  // Welle 5 (S2, S5): Anfrage: Leiste auf hinweis.y − 5 über die ganze Breite, Text auf hinweis.y + 5, Ablehnen auf k.h − 22; Angebot: 1-px-Messingrahmen, Name in der Rolle titel
  {
    ok(G.ablehnen.y === G.karte.y + G.karte.h - 22 && G.ablehnen.y >= G.haupt.y + G.haupt.h, 'ablehnen.y = k.h − 22 und unter dem Hauptknopf (' + G.ablehnen.y + ' ≥ ' + (G.haupt.y + G.haupt.h) + ')');
    const T = partie(); T.anbieten(); T.key('KeyE'); T.fcmds(); const mA = T.m();
    const zeichneKarte = (lage) => { gezeichnet.rects.length = 0; gezeichnet.texte.length = 0; gezeichnet.knoepfe.length = 0; R2.ui.buttons.length = 0; PT.zeichneLage(ctx, L.handel, L.handelInfo, lage); };
    zeichneKarte(mA.lage);
    const leiste = gezeichnet.rects.filter((r) => r.h === 4 && r.y === G.hinweis.y - 5 && r.x >= G.hinweis.x);
    ok(leiste.length >= FENSTER, 'Anfrage: Segmentleiste auf hinweis.y − 5 (' + leiste.length + ' Rechtecke)');
    const rechtsEnde = Math.max(...leiste.map((r) => r.x + r.w)), linksAnfang = Math.min(...leiste.map((r) => r.x));
    ok(linksAnfang === G.hinweis.x && rechtsEnde === G.hinweis.x + G.hinweis.w, 'Segmentleiste verteilt die Breite: von ' + linksAnfang + ' bis ' + rechtsEnde + ' (Rand ' + (G.hinweis.x + G.hinweis.w) + ')');
    const hin = gezeichnet.texte.find((t) => /^Verstreicht die Frist/.test(t.s));
    ok(!!hin && hin.y === G.hinweis.y + 5 && hin.x === G.hinweis.x, 'Anfrage: Frist-Text auf hinweis.y + 5 (y ' + (hin && hin.y) + ')');
    ok(hin && hin.y + 7 <= G.haupt.y + 1, 'der Frist-Text liegt über dem Hauptknopf (Glyphe 7 px, Unterkante ' + (hin && hin.y + 7) + ' ≤ ' + (G.haupt.y + 1) + ')');
    // Anfrage: doppelter Rahmen, Angebot: einfacher
    const rahmen = (col) => gezeichnet.rects.filter((r) => r.col === col && ((r.w === G.karte.w && r.h === 1) || (r.h === G.karte.h && r.w === 1)));
    ok(rahmen(FARBE.warn).length === 4 && gezeichnet.rects.filter((r) => r.col === FARBE.warn && r.w === G.karte.w - 4 && r.h === 1).length === 2, 'Anfrage: doppelter Rahmen (außen und innen)');
    const U = partie(); U.anbieten(); const mG = U.m(); zeichneKarte(mG.lage);
    ok(rahmen(FARBE.preis).length === 4, 'Angebot: 1-px-Messingrahmen um die Karte (4 Linien in preis, ' + rahmen(FARBE.preis).length + ')');
    ok(gezeichnet.rects.filter((r) => r.col === FARBE.preis && r.w === G.karte.w - 4 && r.h === 1).length === 0, 'Angebot: kein zweiter (innerer) Rahmen, der doppelte bleibt der Anfrage');
    // K3: der Ablehnen-Knopf ist die Kontur-Variante (leiser), der Hauptknopf bleibt die Fläche
    const knA = gezeichnet.knoepfe;
    ok(knA.length === 2 && knA[0].kontur === false && knA[1].kontur === true && knA[1].label === 'Schlacht ablehnen', 'Hauptknopf als Fläche, „Schlacht ablehnen“ als Kontur-Variante (Welle 5, K3)');
    const nameZ = gezeichnet.texte.filter((t) => t.x >= G.name.x && t.y >= G.name.y && t.y < G.name.y + 20);
    const nameS = nameZ.map((t) => t.s).join('');
    ok(nameZ.length > 5 && nameZ.every((t) => t.s.length === 1) && nameS.replace(/ /g, '') === ANZ.name.toUpperCase().replace(/ /g, ''), 'Name in der Rolle titel: Versalien, einzeln gesperrt gesetzt („' + nameS + '“)');
    ok(new Set(nameZ.map((t) => t.y)).size <= 2 && nameZ.every((t) => t.x + t.w <= G.name.x + G.name.w + 7), 'der Name passt in höchstens zwei Zeilen innerhalb der Karte');
    const textZ = new Set(gezeichnet.texte.filter((t) => t.x === G.text.x && t.y >= G.text.y && t.y < G.text.y + G.text.h).map((t) => t.y));
    ok(textZ.size >= 3 && textZ.size <= 5, 'der Text der Karte braucht ' + textZ.size + ' Zeilen (höchstens 5)');
  }

  // K1: erledigter Schritt „Orbit frei“ in dim, kein „+ Orbit“
  {
    const T = partie(); T.anbieten(); T.key('KeyE'); T.fcmds(); warte(650); T.key('KeyE'); T.fcmds(); T.m(); FinaleServer.orbitEnde(T.g, 'sieg'); const mb = T.m();
    const sch = mb.lage.finale.schritte;
    ok(sch[0].fertig === true && sch[0].fertigLabel === 'Orbit frei' && sch[1].aktiv === true && sch[1].label === 'Boden', 'Modell: Schritt Orbit fertig mit fertigLabel „Orbit frei“, Boden aktiv');
    gezeichnet.rects.length = 0; gezeichnet.texte.length = 0; PT.zeichneLage(ctx, L.handel, L.handelInfo, mb.lage);
    const orb = gezeichnet.texte.find((t) => t.s === 'Orbit frei');
    ok(!!orb && orb.col === FARBE.dim, 'gezeichnet: „Orbit frei“ in dim (' + (orb && orb.col) + ')');
    ok(!gezeichnet.texte.some((t) => /^\+ /.test(t.s)), 'kein „+ Orbit“ mehr');
  }

  const farbenVonKnopf = new Set();
  function pruefe(name, zustand, karten, zuschauer) {
    // 1. das Modell kommt aus dem echten terminal-ui.js gegen einen echten Server
    const T = partie(); T.anbieten(); const g = T.g;
    if (karten === 3) { g.weltsim.absicht.angebot.ids = ['verteidigung', 'offensive', 'ausgreifen']; g.sentAbsichtKey = null; }
    else if (karten === 2) { g.weltsim.absicht.angebot.ids = ['bereitschaft', 'verteidigung']; g.sentAbsichtKey = null; }
    if (zustand !== 'angebot') { T.key('KeyE'); T.fcmds(); }
    if (zustand === 'phase') { warte(650); T.key('KeyE'); }
    if (zuschauer) { warte(130); T.zeichnen(); g.handleMessage(T.conns[1], { t: 'cmd', c: 'werft.zusehen', on: true }); TU.zusehen({ send() {} }, true); }
    let m = T.m(zuschauer ? 1 : 0);
    TU.zusehen({ send() {} }, false);
    const f = m.lage && m.lage.finale;
    ok(!!f && f.zustand === zustand, name + ': Modell im Zustand ' + zustand + (f ? '' : ' (keine Karte)'));
    if (!f) return;
    // 2. gezeichnet mit der echten Zeichenfunktion
    gezeichnet.rects.length = 0; gezeichnet.texte.length = 0; gezeichnet.knoepfe.length = 0; R2.ui.buttons.length = 0;
    PT.zeichneLage(ctx, L.handel, L.handelInfo, m.lage);
    const kn = gezeichnet.knoepfe, rechts = R2.ui.buttons.filter((b) => b.x >= G.karte.x), links = R2.ui.buttons.filter((b) => b.x < G.karte.x);
    ok(zustand === 'phase' ? rechts.length === 0 : (rechts.length === 2 && rechts.every((b) => drin(b, G.karte) && drin(b, L.handel)) && !schneiden(rechts[0], rechts[1])), name + ': ' + (zustand === 'phase' ? 'bei laufendem Finale gibt es keine Klickfläche auf der Karte' : 'zwei Knöpfe, beide in der Karte und im Bereich, ohne Überschneidung'));
    ok(links.every((b) => b.x + b.w <= G.karte.x - 4 && drin(b, L.handel)), name + ': Klickflächen der Absichten (' + links.length + ') bleiben links von der Karte (Abstand ≥ 4) und im Bereich');
    ok(links.every((b) => rechts.every((q) => !schneiden(b, q))), name + ': Absichten und Karte überdecken sich nicht');
    if (zustand !== 'phase') {
      ok(kn.length === 2 && kn[0].label === f.haupt.text && kn[1].label === 'Schlacht ablehnen' && /^[A-Z]$/.test(String(kn[0].hotkey)) && /^[A-Z]$/.test(String(kn[1].hotkey)), name + ': Knöpfe tragen die echte Taste: ' + kn.map((b) => b.label + ' [' + b.hotkey + ']').join(' · '));
      ok(kn[0].hotkey === 'E' && kn[1].hotkey === 'N', name + ': Tastenkappen E und N kommen aus tasten.js');
      kn.forEach((b) => farbenVonKnopf.add(b.fn));
      ok(zuschauer ? kn.every((b) => b.disabled && !b.onClick) : kn.every((b) => !b.disabled && typeof b.onClick === 'function'), name + ': ' + (zuschauer ? 'Zuschauer: Knöpfe gesperrt' : 'Knöpfe bedienbar'));
    }
    const T2 = gezeichnet.texte.filter((t) => t.w > 0 && t.y >= L.handel.y - 1 && t.y < L.handel.y + L.handel.h);   // Titelzeile (Tastenhilfe) und Infozeile liegen außerhalb des Bereichs
    const inKarte = T2.filter((t) => t.x >= G.karte.x), amRand = inKarte.filter((t) => !drin({ x: t.x, y: t.y, w: t.w, h: t.h }, G.karte));
    ok(amRand.length === 0, name + ': alle Texte der Karte liegen in der Karte' + (amRand.length ? ' (draußen: ' + amRand.map((t) => t.s).join(' | ') + ')' : ''));
    const links2 = T2.filter((t) => t.x < G.karte.x && t.y >= L.handel.y);
    ok(links2.every((t) => t.x + t.w <= G.karte.x - 2), name + ': Texte der Absichten reichen nicht in die Karte' + (links2.filter((t) => t.x + t.w > G.karte.x - 2).length ? ': ' + links2.filter((t) => t.x + t.w > G.karte.x - 2).map((t) => t.s).join(' | ') : ''));
    const boxen = inKarte.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, s: t.s }));
    let ueber = [];
    for (let i = 0; i < boxen.length; i++) for (let j = i + 1; j < boxen.length; j++) if (schneiden(boxen[i], boxen[j])) ueber.push(boxen[i].s + ' / ' + boxen[j].s);
    ok(ueber.length === 0, name + ': Texte der Karte überdecken sich nicht' + (ueber.length ? ': ' + ueber.slice(0, 3).join('; ') : ''));
    ok(rechts.every((b) => boxen.every((t) => !schneiden(b, t))), name + ': kein Text liegt unter einem Knopf');
    ok(inKarte.every((t) => t.y + t.h <= L.handel.y + L.handel.h), name + ': nichts reicht unter den Bereich');
    const zeilen = T2.filter((t) => t.x >= G.karte.x && t.y < G.text.y + G.text.h && t.y >= G.text.y);
    ok(!/…$/.test(m.lage.finale.text) && zeilen.every((t) => !/…$/.test(t.s)), name + ': der Text der Karte steht ohne Auslassung' + (zeilen.find((t) => /…$/.test(t.s)) ? ' (gekürzt: ' + zeilen.find((t) => /…$/.test(t.s)).s + ')' : ''));
    const rot = gezeichnet.rects.filter((r) => r.col === FN.weapon || r.col === FARBE.waffe).length + gezeichnet.texte.filter((t) => t.col === FN.weapon || t.col === FARBE.waffe).length + kn.filter((b) => b.fn === 'weapon').length;
    ok(rot === 0, name + ': Rot (Gefahr) kommt in der Karte nicht vor');
    return { zeilen: T2 };
  }
  for (const [nm, z, k, zu] of [['Angebot, 3 Absichten', 'angebot', 3, false], ['Angebot, 2 Absichten', 'angebot', 2, false], ['Anfrage, 3 Absichten', 'anfrage', 3, false], ['Anfrage, 2 Absichten', 'anfrage', 2, false], ['Läuft, 3 Absichten', 'phase', 3, false], ['Zuschauer: Anfrage', 'anfrage', 3, true]]) pruefe(nm, z, k, zu);
  ok(!farbenVonKnopf.has('weapon') && farbenVonKnopf.has('nav') && farbenVonKnopf.has('warn'), 'Funktionsfarben der Knöpfe: Angebot Messing (nav), Bestätigen Gelb (warn), nie Rot: ' + [...farbenVonKnopf].join(', '));

  // Antwortleiste (funkwahl.js): sie darf die Knöpfe der Karte nicht verdecken, wenn beides zugleich auf dem Schirm steht
  const FW = require('../public/js/funkwahl.js');
  const T = partie(); T.anbieten(); T.m();
  const fm = FW.modellAus({ nr: 5, von: 'Römische Streife', optionen: [{ id: 'a', text: 'Lage melden.' }, { id: 'b', text: 'Verstanden.' }], ignorieren: 'Nicht antworten', rest: 2 });
  for (const eing of [false, true]) {
    FW.store.eingeklappt = eing; FW.store.geoeffnetBei = null;
    const r = FW.rechteck(fm, { S: PT.TOKENS.S, station: 'shop' });
    const knoepfe = [G.haupt, G.ablehnen];
    const zu = FW.zu ? FW.zu({ S: PT.TOKENS.S, station: 'shop' }) : false;
    ok(zu || knoepfe.every((b) => !schneiden(r, b)), 'Antwortleiste' + (eing ? ' (Streifen)' : '') + ' ' + r.x + ',' + r.y + ' ' + r.w + 'x' + r.h + ': verdeckt die Knöpfe der Karte nicht (oder ist zugeklappt)');
  }
  FW.store.eingeklappt = false;
}

console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'FINALE-UI OK'}`);
FinaleServer.ersetzen('szene', null); FinaleServer.ersetzen('boden', null); FinaleServer.ersetzen('abspann', null);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
