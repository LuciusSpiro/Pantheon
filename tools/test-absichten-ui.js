'use strict';
// SUND-02b D: Terminal-Bereich „Lage“ (Absichten) ohne Browser: public/js/absicht.js (Storage, Löschsignal, Müll) und public/js/terminal-ui.js (Modell des Bereichs, Tasten und Klicks ->
// Befehle, Antworten, Zuschauer) mit Attrappen für Render/Pult/PultTerminal gegen einen ECHTEN Server (Game). Gezeichnet und mit echten Tasten prüft tools/sicht-absichten.js (Chromium).
//   node tools/test-absichten-ui.js   (npm run test:absichten-ui)
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
const AbsichtServer = require('../server/sim/absicht.js');
const AbsichtClient = require('../public/js/absicht.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const W = require('../content/welt/absichten.json').werte;
const TRIBUN = require('../content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === W.mindestrang.wert).ab;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-absichten-ui-'));
let seq = 0;

// ---------------------------------------------------------------- Browser-Umgebung (Attrappen)
const win = { Shared_Schiffskatalog: Katalog, Shared_Maps: Maps, Shared_Config: CONFIG, Shared_Protocol: Protocol, Shared_Locations: Locations, performance, Net: { reportError(w, e) { throw e; }, on() {} } };
win.window = win;
win.Render = { PAL: {}, text() {}, drawTooltip() {} };
win.Pult = {};
win.PultTerminal = { TOKENS: { RASTER: { deckName: ['Mitteldeck', 'Oberdeck', 'Unterdeck'] } }, kappe: (a, e) => e, tw: (s) => String(s).length * 6, zeichneTerminal() {} };
win.Consoles = { shopRows() { return []; }, denied() {} };
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'absicht.js'), 'utf8'), win, { filename: 'absicht.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'terminal-ui.js'), 'utf8'), win, { filename: 'terminal-ui.js' });
const TU = win.TerminalUI, AB = win.Absicht;
ok(TU && AB && typeof AB.modell === 'function' && typeof TU.keyDown === 'function', 'TerminalUI und Absicht geladen');

// ---------------------------------------------------------------- Partie (Freie Fahrt Sund, zwei Spieler), UI von Spieler 0 am Terminal
function partie(start) {
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: fs.mkdtempSync(path.join(TMP, 'w' + (++seq))), seed: 7, debug: true, log: () => {}, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') } });
  const conns = [0, 1].map((i) => { const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'U' + i, name: 'Ui' + i, color: i }); return c; });
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: start || 'freie_fahrt' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < CONFIG.tickHz; i++) g.step();
  g.space.enemies = [];
  g.players[0].console = 'shop';
  AB.lesen({ t: 'welcome' });   // neue Verbindung: leerer Speicher (wie im Browser)
  const T = { g, conns };
  T.view = (i) => ({ state: JSON.parse(JSON.stringify(g.snapshot())), me: g.players[i], send(m) { g.handleMessage(conns[i], m); T.nachlauf(i); }, actions: { sfx() {}, leave() {} } });
  // Ereignisse an die UI (wie client.js onEvent), world-Blöcke an absicht.js (wie Net.on)
  T.nachlauf = (i) => { const inbox = conns[i].inbox.splice(0); for (const m of inbox) if (m.t === 'event' && /^(werft|absichtAntwort)/.test(m.kind)) TU.onEvent(m); };
  T.lesen = () => { for (let i = 0; i < 40; i++) AB.lesen(Object.assign({ t: 'snap' }, g.snapshot())); };
  T.key = (code, i) => { T.lesen(); const v = T.view(i || 0); const r = TU.keyDown({ code, preventDefault() {} }, v); T.nachlauf(i || 0); return r; };
  T.m = (i) => { T.lesen(); return TU.modell(T.view(i || 0)); };
  T.tick = (k) => { for (let j = 0; j < (k || 1); j++) Kriegslage.tick(g, 'test'); };
  return T;
}
const warte = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* aktiv warten, Test ist synchron */ } };   // ansichtSenden entprellt auf 120 ms
const zeichnen = (T, i) => { win.Render.ui = { buttons: [], mouse: { x: 0, y: 0 } }; T.lesen(); TU.draw({}, T.view(i || 0)); T.nachlauf(i || 0); };

section('absicht.js: Storage, Löschsignal, Müll');
{
  AB.lesen({ t: 'welcome' });
  ok(AB.modell() === null, 'ohne Block: kein Modell');
  AB.lesen({ t: 'snap', world: { absicht: { frei: 1, ab: 'Tribun', angebot: [{ id: 'a', name: 'A', text: 'x', dauer: 5 }, { id: 'b', name: 'B', text: 'y', dauer: 6 }], rest: 4 } } });
  let m = AB.modell();
  ok(m && m.frei === true && m.ab === 'Tribun' && m.angebot.length === 2 && m.rest === 4 && m.laufend === null, 'Block -> Modell (frei, Karten, Restzeit)');
  AB.lesen({ t: 'snap', world: {} });
  ok(AB.modell() !== null, 'ein Snapshot ohne world.absicht lässt den Block stehen');
  AB.lesen({ t: 'snap', world: { absicht: null } });
  ok(AB.modell() === null, 'world.absicht = null (Löschsignal) leert');
  AB.lesen({ t: 'snap', world: { absicht: { frei: 1, ab: 'Tribun' } } }); AB.lesen({ t: 'welcome' });
  ok(AB.modell() === null, 'welcome leert (neue Verbindung, der Server sendet neu)');
  AB.lesen({ t: 'snap', world: { absicht: { frei: 1, ab: 'Tribun' } } }); AB.lesen({ t: 'snap', phase: 'lobby' });
  ok(AB.modell() === null, 'die Lobby leert');
  for (const bad of ['x', 5, [], { frei: 1, angebot: 'x' }, { angebot: [null, 5, {}, { id: 'a' }, { id: 'a', name: 'A', dauer: 'x' }] }, { laufend: { id: 'a' } }, { laufend: { id: 'a', name: 'A', text: 1, dauer: -3, rest: 'x' } }]) {
    AB.lesen({ t: 'snap', world: { absicht: bad } });
    let m2, fehler = null; try { m2 = AB.modell(); } catch (e) { fehler = e; }
    ok(!fehler && (m2 === null || (Array.isArray(m2.angebot) && m2.angebot.length <= 3)), 'Müll als Block ohne Ausnahme: ' + JSON.stringify(bad));
  }
  AB.lesen({ t: 'snap', world: { absicht: { frei: 1, ab: 'T', angebot: [1, 2, 3, 4, 5].map((i) => ({ id: 'a' + i, name: 'N', text: '', dauer: 1 })) } } });
  ok(AB.modell().angebot.length === 3, 'höchstens 3 Karten');
  AB.lesen({ t: 'welcome' });
}

section('Tasten und Texte');
{
  const tw = { localStorage: null }; tw.window = tw; vm.createContext(tw);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tasten.js'), 'utf8'), tw, { filename: 'tasten.js' });
  const Tasten = tw.Tasten;
  const ids = ['terminal.lage', 'terminal.annehmen', 'terminal.ablehnen'];
  ok(ids.every((id) => Tasten.AKTIONEN.some((a) => a.id === id)), 'tasten.js kennt terminal.lage, terminal.annehmen, terminal.ablehnen');
  ok(Tasten.BEREICHE['terminal.lage'] && Tasten.AKTIONEN.find((a) => a.id === 'terminal.annehmen').bereich === 'terminal.lage' && Tasten.AKTIONEN.find((a) => a.id === 'terminal.ablehnen').bereich === 'terminal.lage', 'Annehmen und Ablehnen gelten nur im Bereich Lage');
  ok(Tasten.AKTIONEN.find((a) => a.id === 'terminal.lage').std[0] === 'KeyL' && Tasten.AKTIONEN.find((a) => a.id === 'terminal.ablehnen').std[0] === 'KeyX', 'Standardtasten L und X');
}

section('Vor Tribun: der Bereich ist da, gedimmt, ohne Angebot');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T);
  let m = T.m();
  ok(m.bereichUmschalter.lage && m.bereichUmschalter.lage.gesperrt === true && /Tribun/.test(m.bereichUmschalter.lage.grund), 'Umschalter „Lage“ da, vor Tribun gesperrt (gedimmt), Grund nennt Tribun');
  T.key('KeyL'); m = T.m();
  ok(m.bereich === 'lage' && m.lage.zustand === 'gesperrt' && /Tribun/.test(m.lage.text) && m.lage.titel, 'L öffnet den Bereich: Hinweis „ab dem Rang Tribun“');
  ok(m.aktionen.haupt.disabled === true && /Tribun/.test(m.aktionen.haupt.grund) && m.aktionen.ausbau.label === 'Ablehnen' && m.aktionen.ausbau.disabled === true, 'Hauptknopf und Ablehnen gesperrt, Grund Rang');
  const gesendet = []; const v = T.view(0); const send0 = v.send; v.send = (q) => { gesendet.push(q); send0(q); };
  TU.keyDown({ code: 'Enter', preventDefault() {} }, v); TU.keyDown({ code: 'KeyX', preventDefault() {} }, v);
  ok(gesendet.length === 0 || gesendet.every((q) => q.c === 'werft.ansicht'), 'Enter und X vor Tribun senden keinen Befehl');
  T.key('KeyW'); m = T.m();
  ok(m.bereich === 'werft', 'W bringt zur Werft zurück');
}

section('Kampagne: kein Bereich');
{
  const T = partie('free'); TU.zuruecksetzen(); zeichnen(T);
  T.key('KeyL'); const m = T.m();
  ok(!T.g.weltsim && m.bereichUmschalter.lage === null && m.bereich !== 'lage', 'ohne Modus: kein Lage-Knopf, L tut nichts');
}

section('Angebot: Karten, Auswahl, Annehmen gegen den Server');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T); const g = T.g;
  g.weltsim.ruf.rom = TRIBUN; T.tick();
  T.key('KeyL'); let m = T.m();
  const karten = m.lage.karten;
  ok(m.bereich === 'lage' && m.lage.zustand === 'angebot' && karten.length === g.weltsim.absicht.angebot.ids.length && karten.length >= 2 && karten.length <= 3, 'Bereich Lage: ' + karten.length + ' Karten');
  ok(karten.every((k) => k.name && k.text && k.dauer > 0) && karten[0].gewaehlt === true && karten.filter((k) => k.gewaehlt).length === 1, 'Karten mit Name, Text, Dauer; die erste ist gewählt');
  ok(/Ablehnen oder Liegenlassen kostet nichts/.test(m.lage.info.text) && /noch \d+ Sprünge/.test(m.lage.info.text), 'Infozeile: gilt noch n Sprünge, Ablehnen kostet nichts');
  ok(m.aktionen.haupt.art === 'annehmen' && m.aktionen.haupt.text === 'Annehmen' && !m.aktionen.haupt.disabled && m.aktionen.hinweis.text.includes(karten[0].name.slice(0, 8)), 'Hauptknopf „Annehmen“, die Zeile darunter nennt die gewählte Karte');
  ok(m.aktionen.ausbau.label === 'Ablehnen' && !m.aktionen.ausbau.disabled && m.aktionen.teil.label === 'Option' && !m.aktionen.teil.disabled, 'Ablehnen und Option aktiv');
  ok(m.kreuz.gesperrt === true && m.module.gesperrt === true && m.schnitt === null, 'Kreuz und Module gedimmt wie im Handel');
  // Auswahl mit Pfeilen
  T.key('ArrowDown'); m = T.m();
  ok(m.lage.karten[1].gewaehlt === true && m.aktionen.hinweis.text.includes(karten[1].name.slice(0, 8)), 'Pfeil runter: zweite Karte gewählt, die Zeile unter dem Knopf nennt sie');
  T.key('ArrowUp'); T.key('ArrowUp'); m = T.m();
  ok(m.lage.karten[m.lage.karten.length - 1].gewaehlt === true, 'Pfeil hoch läuft um (von der ersten zur letzten)');
  m.lage.karten[0].onClick(); m = T.m();
  ok(m.lage.karten[0].gewaehlt === true, 'Klick auf eine Karte wählt sie');
  // Ansicht für die Zuschauer an den Server
  warte(130); zeichnen(T);
  ok(g.werftUi && g.werftUi.b === 'l' && g.werftUi.i === karten[0].id, 'der Server kennt die Ansicht des Nutzers: Bereich l, Karte ' + (g.werftUi && g.werftUi.i));
  // Annehmen
  const wahl = karten[0].id, ruf0 = JSON.stringify(g.weltsim.ruf);
  T.key('Enter');
  ok(g.weltsim.absicht.laufend && g.weltsim.absicht.laufend.id === wahl && g.weltsim.zustand.absichten.rom, 'Enter nimmt die gewählte Karte an: laufend ' + wahl + ', zustand.absichten.rom gesetzt');
  ok(TU.zustand.antwort && TU.zustand.antwort.ok === true && JSON.stringify(g.weltsim.ruf) === ruf0, 'absichtAntwort ok in der UI, Ruf unverändert');
  m = T.m();
  ok(m.lage.zustand === 'laeuft' && m.lage.laufend.id === wahl && m.lage.laufend.rest === m.lage.laufend.dauer && /Läuft noch/.test(m.aktionen.haupt.text) && m.aktionen.haupt.disabled === true, 'danach: Anzeige „läuft“, Restzeit, Hauptknopf gesperrt');
  const vor = JSON.stringify(g.weltsim.absicht);
  const cmds = []; { T.lesen(); const v = T.view(0); const s0 = v.send; v.send = (q) => { if (/^absicht/.test(q.c || '')) cmds.push(q); s0(q); }; for (const code of ['Enter', 'KeyX']) TU.keyDown({ code, preventDefault() {} }, v); }
  ok(JSON.stringify(g.weltsim.absicht) === vor && cmds.length === 0, 'Enter und X während der Absicht ändern nichts und senden keinen Befehl'); T.nachlauf(0);
  T.tick(3); m = T.m();
  ok(m.lage.laufend.rest === m.lage.laufend.dauer - 3, 'die Restzeit zählt mit den Sprüngen');
  T.tick(m.lage.laufend.rest); m = T.m();
  ok(m.lage.zustand === 'leer' && /KEINE FRAGE/.test(m.lage.titel) && m.aktionen.haupt.disabled === true, 'nach dem Ablauf: „Rom hat gerade keine Frage“, Hauptknopf gesperrt');
}

section('Ablehnen und „schon gewählt“');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T); const g = T.g;
  g.weltsim.ruf.rom = TRIBUN; T.tick();
  T.key('KeyL'); const ruf0 = JSON.stringify(g.weltsim.ruf);
  T.key('KeyX');
  ok(g.weltsim.absicht.angebot === null && !g.weltsim.zustand.absichten.rom && JSON.stringify(g.weltsim.ruf) === ruf0, 'X lehnt ab: Angebot weg, nichts gesetzt, Ruf gleich');
  ok(TU.zustand.antwort && TU.zustand.antwort.ok === true && /ohne Folgen/.test(TU.zustand.antwort.text), 'Rückmeldung „Abgelehnt, ohne Folgen.“');
  // Ein anderer hat schneller gewählt: die UI zeigt noch das Angebot, der Server sagt „schon gewählt“
  T.tick(W.abstand_nach_verfall.wert);
  T.key('KeyL'); let m = T.m();
  ok(m.lage.zustand === 'angebot', 'neues Angebot nach der Pause');
  const fremd = g.weltsim.absicht.angebot.ids[1];
  T.lesen(); const staleModell = AB.modell();   // die UI hat das Angebot gesehen ...
  AbsichtServer.waehlen(g, fremd);                // ... aber Spieler 2 war schneller
  AB.lesen({ t: 'snap', world: { absicht: { frei: 1, ab: 'Tribun', angebot: staleModell.angebot, rest: staleModell.rest } } });   // (der Block mit dem alten Angebot, bevor der neue Snapshot ankommt)
  const v = T.view(0);
  TU.keyDown({ code: 'Enter', preventDefault() {} }, v); T.nachlauf(0);
  ok(TU.zustand.antwort && TU.zustand.antwort.ok === false && TU.zustand.antwort.code === 'schon_gewaehlt' && /Schon gewählt/.test(TU.zustand.antwort.text), 'Antwort des Servers: „Schon gewählt …“ (code schon_gewaehlt)');
  ok(g.weltsim.absicht.laufend.id === fremd, 'gilt hat die Wahl des anderen');
  AB.lesen({ t: 'snap', world: { absicht: { frei: 1, ab: 'Tribun', angebot: staleModell.angebot, rest: staleModell.rest } } });
  m = TU.modell(T.view(0));
  ok(/Schon gewählt/.test(m.lage.info.grund || '') || m.lage.zustand === 'angebot', 'die Meldung steht rechts in der Infozeile');
}

section('Zuschauer sehen den Bereich, bedienen ihn nicht');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T); const g = T.g;
  g.weltsim.ruf.rom = TRIBUN; T.tick();
  T.key('KeyL'); T.key('ArrowDown'); warte(130); zeichnen(T);
  const gewaehlt = g.werftUi.i;
  g.handleMessage(T.conns[1], { t: 'cmd', c: 'werft.zusehen', on: true });
  TU.zusehen({ send() {} }, true);
  T.lesen();
  const mz = TU.modell(T.view(1));
  ok(mz.bereich === 'lage' && mz.lage.zustand === 'angebot' && mz.lage.karten.find((k) => k.gewaehlt).id === gewaehlt, 'Zuschauer: Bereich Lage mit der Karte des Nutzers');
  ok(mz.titel === 'ZUSEHEN' && mz.aktionen.haupt.disabled === true && mz.aktionen.haupt.onClick === null && mz.lage.karten.every((k) => k.onClick === null) && mz.aktionen.ausbau.disabled === true && mz.aktionen.teil.disabled === true, 'alles gesperrt, Titel ZUSEHEN, keine Klicks');
  const vor = JSON.stringify(g.weltsim.absicht);
  const v1 = T.view(1), cmds = []; const s1 = v1.send; v1.send = (q) => { if (/^absicht/.test(q.c || '')) cmds.push(q); s1(q); };
  for (const code of ['Enter', 'KeyX', 'ArrowDown']) TU.keyDown({ code, preventDefault() {} }, v1);
  mz.aktionen.ausbau.onClick && mz.aktionen.ausbau.onClick();
  T.nachlauf(1);
  ok(JSON.stringify(g.weltsim.absicht) === vor && cmds.length === 0, 'Tasten des Zuschauers ändern nichts und senden keinen Befehl'); 
  TU.zusehen({ send() {} }, false);
}

console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'ABSICHTEN-UI OK'}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
