'use strict';
// PAN-01 D2: Terminal-UI ohne Browser (Modell-Aufbau aus dem Snapshot, Tasten und Klicks -> Befehle, Antworten, Zuschauer, Tastenbelegung).
// public/js/terminal-ui.js läuft in Node mit Attrappen für Render/Pult/PultTerminal (nur Modell und Eingabe, nichts gezeichnet) gegen einen ECHTEN Server (Game):
// die UI sendet ihre Befehle an die Game-Klasse, deren Ereignisse (werftAntwort, werftVorschau, werft) gehen zurück an die UI. Gezeichnet und mit echten Tasten
// prüft das tools/pw-werft-ui.js (Playwright, Debug-Server).   node tools/test-werft-ui.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const Maps = require('../shared/maps.js');
const Protocol = require('../shared/protocol.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const Werft = require('../server/sim/werft.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');

// ---------------------------------------------------------------- Browser-Umgebung (Attrappen)
const win = { Shared_Schiffskatalog: Katalog, Shared_Maps: Maps, Shared_Config: CONFIG, Shared_Protocol: Protocol, Shared_Locations: Locations, performance, Net: { reportError(w, e) { throw e; } } };
win.window = win;
win.Render = { PAL: {}, text() {}, drawTooltip() {} };
win.Pult = {};
const tokens = { RASTER: { deckName: ['Mitteldeck', 'Oberdeck', 'Unterdeck'] } };
win.PultTerminal = { TOKENS: tokens, kappe: (a, e) => e, tw: (s) => String(s).length * 6, zeichneTerminal() {} };
// Handelszeilen wie Consoles.shopRows (nur die Felder, die das Terminal liest)
win.Consoles = { shopRows(view) {
  const st = view.state, inv = st.inventory || {};
  return CONFIG.shop.filter((it) => !it.where || it.where.includes('hafen')).map((it) => {
    let reason = null;
    if (inv.marks < it.price) reason = 'Nicht genug Marken';
    else if (it.kind === 'item' && it.limit && (inv[it.id] || 0) >= it.limit) reason = 'Lager voll (' + it.limit + ')';
    return Object.assign({}, it, { price: it.price, reason, owned: it.kind === 'item' ? 'Lager: ' + (inv[it.id] || 0) + (it.limit ? '/' + it.limit : '') : '', cheaper: false });
  });
}, denied() {} };
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'terminal-ui.js'), 'utf8'), win, { filename: 'terminal-ui.js' });
const TU = win.TerminalUI;
ok(TU && typeof TU.modell === 'function' && typeof TU.keyDown === 'function', 'TerminalUI geladen');

// ---------------------------------------------------------------- Partie mit zwei Spielern, UI von Spieler 0
function partie(opt) {
  const g = new Game({ noStore: true, seed: 33, debug: true, log: () => {}, env: { MISSION_SOURCE: 'fallback' } });
  const conns = [0, 1].map((i) => { const c = { inbox: [], send(m) { this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'U' + i, name: 'Ui' + i, color: i }); return c; });
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  g.space.enemies = [];
  if (!(opt && opt.test)) g.arena = null;   // Bühne ohne Testumgebung: Kampagnen-Verhalten (Werft nur an Flottenbasen)
  g.ship.docked = true; g.ship.dockedAt = 'castra_martis';
  g.players[0].console = 'shop';
  g.inventory.marks = 1000;
  const T = { g, conns };
  const sicht = (i) => ({ state: JSON.parse(JSON.stringify(g.snapshot())), me: g.players[i], send(m) { g.handleMessage(conns[i], m); T.nachlauf(i); }, actions: { sfx() {}, leave() {} } });
  T.view = sicht;
  // Ereignisse an die UI geben (wie client.js onEvent) und den Snapshot neu holen
  T.nachlauf = (i) => { const inbox = conns[i].inbox.splice(0); for (const m of inbox) if (m.t === 'event' && /^werft/.test(m.kind)) TU.onEvent(m); };
  T.key = (code, i) => { const v = sicht(i || 0); const r = TU.keyDown({ code, preventDefault() {} }, v); T.nachlauf(i || 0); return r; };
  T.m = (i) => TU.modell(sicht(i || 0));
  return T;
}
// Entprellung: die Vorschau wird erst nach 150 ms angefordert; im Test über draw() ausgelöst (Zeichnen übernimmt die Attrappe)
function zeichnen(T, i) { win.Render.ui = { buttons: [], mouse: { x: 0, y: 0 } }; const v = T.view(i || 0); TU.draw({}, v); T.nachlauf(i || 0); }
const warte = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* aktiv warten, Test ist synchron */ } };

section('Modell: Werft an Castra Martis');
{
  const T = partie(); TU.zuruecksetzen();
  zeichnen(T);
  let m = T.m();
  ok(m.bereich === 'werft' && m.ansicht === 'platz' && m.kopf.art === 'werft' && m.kopf.marken === 1000 && m.kopf.ort === 'Castra Martis', 'Start an der Flottenbasis: Werft, Platzansicht, Ort und Marken ' + m.kopf.ort);
  ok(m.schnitt.plaetze[8].zustand === 'bestueckt' && m.schnitt.plaetze[8].waffe === 'lanze' && m.schnitt.plaetze[7].zustand === 'zu' && m.schnitt.plaetze[7].stufe === 1, 'Schnitt aus ship.mounts und Stufe: 8 Lanze, 7 noch zu (Stufe 1)');
  ok(m.schnitt.module[1].modul === 'frachtraum' && m.schnitt.module[2].modul === 'krankenstation' && m.schnitt.module[3].zustand === 'zu', 'Module aus ship.mod, Raum 3 zu');
  ok(m.liste.teile.map((t) => t.id).join() === 'lanze,standardkanone,leer' && m.liste.teile[0].zustand === 'eingebaut' && m.liste.teile[1].zustand === 'kostet' && m.liste.teile[1].preis === CONFIG.werft.preise.waffe.standardkanone && m.liste.teile[2].zustand === 'frei', 'Teilliste Platz 8 (Bug): Lanze eingebaut, Kanone kostet, Leer frei');
  ok(m.aktionen.haupt.disabled === true && /eingebaut/i.test(m.aktionen.haupt.text), 'Hauptknopf beim eingebauten Teil gesperrt');
  ok(m.status.amGeraet === 0 && m.status.zusehen.length === 0, 'Status: Am Gerät = Farbe 0');
  // Katalogtexte für Module
  T.key('F1'); m = T.m();
  ok(m.ansicht === 'modul' && m.platzKopf.kappe === 'F1' && m.liste.teile.length === 4 && m.liste.teile.every((t) => t.id === 'leer' || (t.wirkung && t.wirkung === Katalog.MODUL_WIRKUNG[t.id])), 'Modulraum F1: Wirkungstexte aus dem Katalog, Eintrag Leer');
}

section('Eingabe: Auswahl, Freischalten, Umbauen gegen den Server');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T);
  const g = T.g;
  T.key('KeyA'); let m = T.m();
  ok(m.ansicht === 'stufe' && m.stufen.ziel === 1 && m.aktionen.haupt.art === 'freischalten' && m.stufen.marken[1] === 1000 - CONFIG.werft.preise.stufe[1], 'A: Ausbau-Ansicht, Ziel Stufe 1, Marken 1000 -> ' + m.stufen.marken[1]);
  const vorMarks = g.inventory.marks;
  T.key('KeyF');
  ok(g.inventory.marks === vorMarks - CONFIG.werft.preise.stufe[1] && g.ship.stufe === 1, 'F kauft Stufe 1 (Server bucht, Schiff auf Stufe 1)');
  ok(TU.zustand.antwort && TU.zustand.antwort.ok, 'Antwort werftAntwort ok in der UI');
  ok(TU.zustand.auswahl === 'platz', 'nach dem Stufenkauf zurück zur Platzansicht (ein zweites F kauft nicht still die nächste Stufe)');
  T.key('KeyA'); T.key('KeyF');   // bewusst: Ausbau, Stufe 2 kostet 180
  ok(g.ship.stufe === 2, 'Stufe 2 der Reihe nach');
  T.key('KeyA');
  T.key('Digit7'); m = T.m();
  ok(m.platzKopf.kappe === '7' && m.liste.teile.map((t) => t.id).join() === 'standardbatterie,sturmbatterie,streubatterie,lanzenbatterie,leer', 'Taste 7: Platz 7 (Seite), Liste der Seitenwaffen');
  // Platz 7 ist leer: Leer ist „eingebaut“; Pfeil hoch = Lanzenbatterie (kostet), Enter lehnt ab, F schaltet frei
  T.key('ArrowUp'); m = T.m();
  ok(m.liste.gewaehlt === 'lanzenbatterie' && m.aktionen.haupt.art === 'freischalten' && /120 M/.test(m.aktionen.haupt.text), 'Pfeil hoch: Lanzenbatterie gewählt, Hauptknopf F Freischalten 120 M');
  const m0 = g.inventory.marks;
  T.key('Enter');
  ok(g.inventory.marks === m0 && !g.ship.waffen[7] && TU.zustand.antwort && !TU.zustand.antwort.ok, 'Enter bei einem Teil, das noch kostet: nichts passiert, Hinweis "erst freischalten"');
  T.key('KeyF');
  ok(g.inventory.marks === m0 - 120, 'F schaltet die Lanzenbatterie frei (120)');
  zeichnen(T); warte(160); zeichnen(T);   // Vorschau anfordern und Antwort verarbeiten
  m = T.m();
  ok(m.vorschau.zeilen.length === 2 && /LADEPOOL/.test(m.vorschau.zeilen[0].label) && m.vorschau.seiten.length === 2, 'Vorschau vom Server: Ladepool und Seiten (BB, STB)');
  ok(m.vorschau.seiten[0].teile.some((q) => q.neu && /Lanz/.test(q.t)), 'Vorschau: die neue Lanzenbatterie steht links (BB) und ist als neu markiert');
  const mu = g.inventory.marks;
  T.key('Enter');
  ok(g.ship.waffen[7] === 'lanzenbatterie' && g.inventory.marks === mu, 'Enter baut um: Lanzenbatterie auf Platz 7, gratis');
  ok(!g.ship.waffen[8] || g.ship.waffen[8] === 'lanze', 'Platz 8 unverändert');
  // Leer lassen
  T.key('ArrowDown'); m = T.m();   // Lanzenbatterie -> Leer
  ok(m.liste.gewaehlt === 'leer' && /leeren/i.test(m.aktionen.haupt.text), 'Leer lassen: Hauptknopf "Platz leeren"');
  T.key('Enter');
  ok(!g.ship.waffen[7], 'Enter leert Platz 7');
  // Module
  T.key('F3'); m = T.m();
  ok(m.ansicht === 'modul' && m.platzKopf.kappe === 'F3', 'F3 wählt Modulraum 3');
  const v = (T.key('ArrowUp'), T.m());   // Leer -> Werkstatt (kostet)
  ok(v.liste.gewaehlt === 'werkstatt' && v.aktionen.haupt.art === 'freischalten', 'Werkstatt kostet, Hauptknopf Freischalten');
  T.key('KeyF'); T.key('Enter');
  ok(g.ship.module.some((q) => q.id === 'werkstatt' && q.raum === 3), 'Werkstatt freigeschaltet und in Raum 3 eingebaut');
  // Klick auf ein Teil wählt, Klick auf den Hauptknopf löst aus (Modell-onClick wie die Pult-Zellen)
  T.key('F4'); m = T.m();
  const frachtraum = m.liste.teile.find((t) => t.id === 'frachtraum');
  frachtraum.onClick();
  m = T.m();
  ok(m.liste.gewaehlt === 'frachtraum', 'Klick auf ein Teil wählt es');
  m.aktionen.haupt.onClick(); T.nachlauf(0);
  ok(g.ship.module.some((q) => q.id === 'frachtraum' && q.raum === 4), 'Klick auf den Hauptknopf baut den Frachtraum in Raum 4 ein');
  // Zielplatz gesperrt
  T.key('Digit1'); m = T.m();
  ok(m.ansicht === 'stufe' && m.stufen.ziel === 3 && m.aktionen.haupt.art === 'freischalten' && /^Stufe 3 öffnen · \d+ M$/.test(m.aktionen.haupt.text) && /1 öffnet mit Stufe 3/.test(m.aktionen.hinweis.text), 'Platz 1 (Stufe 3) noch zu: rechts der Block Stufe 3, Hauptknopf kauft den nächsten Schritt mit Preis: ' + m.aktionen.haupt.text + ' / ' + m.aktionen.hinweis.text);
}

section('Fehler: Text und Code vom Server, nichts lokal vorweggenommen');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T);
  const g = T.g;
  T.key('KeyA'); g.inventory.marks = 20;
  T.key('KeyF');   // F sendet trotz zu weniger Marken: der Server entscheidet
  ok(g.ship.stufe === 0 && g.inventory.marks === 20 && TU.zustand.antwort && !TU.zustand.antwort.ok && /Marken/.test(TU.zustand.antwort.text), 'zu wenig Marken: Server lehnt ab, Text in der UI: ' + (TU.zustand.antwort && TU.zustand.antwort.text));
  const m = T.m();
  ok(m.aktionen.haupt.disabled === true && /^Nicht genug Marken \(fehlen \d+\)$/.test(m.aktionen.haupt.grund), 'Hauptknopf zeigt den Grund mit fehlendem Betrag: ' + m.aktionen.haupt.grund);
  ok(m.aktionen.hinweis.fn === 'warn' && /Marken/.test(m.aktionen.hinweis.text), 'Rückmeldung unter dem Knopf (warn)');
}

section('Handel überall, Werft gesperrt mit Grund');
{
  const T = partie(); TU.zuruecksetzen();
  T.g.ship.dockedAt = 'hafen'; zeichnen(T);
  let m = T.m();
  ok(m.bereich === 'handel' && m.handel.artikel.length >= 10 && m.handel.gewaehlt, 'Lichtkordon: das Terminal öffnet im Handel (' + m.handel.artikel.length + ' Artikel)');
  ok(!m.handel.artikel.some((a) => /seitenturm|schildpool|bot2|bolzenwerfer/.test(a.id)), 'keine alten Werft-Artikel im Handel');
  const bolzen = m.handel.artikel.find((a) => a.id === 'bolzen');
  ok(bolzen && /12/.test(bolzen.besitz) && bolzen.preis === 10, 'Torpedo mit Lager x/12 und 10 Marken');
  T.key('KeyW'); m = T.m();
  ok(m.bereich === 'werft' && m.ansicht === 'gesperrt' && /Nur an Flottenbasen/.test(m.gesperrt.grund) && m.bereichUmschalter.werftZu === true, 'W im Lichtkordon: Werft gesperrt, Grund "' + m.gesperrt.grund + '"');
  ok(m.aktionen.haupt.art === 'handel' && m.aktionen.ausbau.disabled === true, 'Hauptknopf Zum Handel, Ausbau gesperrt');
  const mk = T.g.inventory.marks; T.key('KeyF'); T.key('Enter'); T.key('Digit9');
  ok(T.g.inventory.marks === mk && T.m().ansicht === 'gesperrt', 'gesperrt: F, Enter und Platzwahl ändern nichts');
  T.key('KeyH'); m = T.m();
  const gew = m.handel.gewaehlt, vor = T.g.inventory.marks;
  T.key('Enter');
  ok(T.g.inventory.marks < vor, 'Handel: Enter kauft ' + gew + ' (shop.buy)');
  // Torpedos nur bis 12
  T.g.inventory.bolzen = 12; T.g.inventory.marks = 500;
  m = T.m(); const tb = m.handel.artikel.find((a) => a.id === 'bolzen');
  ok(tb.grund && /voll/i.test(tb.grund), 'Torpedo bei Lager 12: Artikel gesperrt mit Grund "' + tb.grund + '"');
}

section('Zuschauer: Ansicht des Nutzers, keine Bedienung');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T);
  const g = T.g;
  T.key('KeyA');   // Nutzer wechselt in die Ausbau-Ansicht
  warte(130); zeichnen(T); warte(130); zeichnen(T);   // Ansicht an den Server (werft.ansicht)
  const sn = g.snapshot().werft;
  ok(sn.ui && sn.ui.a === 's' && sn.ui.b === 'w', 'Snapshot werft.ui trägt die Ansicht des Nutzers ' + JSON.stringify(sn.ui));
  // Spieler 1 sieht zu
  g.handleMessage(T.conns[1], { t: 'cmd', c: 'werft.zusehen', on: true });
  ok(g.snapshot().werft.zu && g.snapshot().werft.zu.join() === '1', 'werft.zusehen: Snapshot nennt die Farbe des Zuschauers (zu [1])');
  const nutzerUi = TU.zustand;   // dieselbe Moduleinheit steht für beide Rollen: Zuschauer-Modus umschalten
  TU.zusehen({ send() {} }, true);
  const mz = TU.modell(T.view(1));
  ok(mz.ansicht === 'stufe' && mz.status.zusehen.join() === '1' && mz.status.amGeraet === 0, 'Zuschauer sieht die Ausbau-Ansicht des Nutzers; Status Am Gerät 0, Zuschauen 1');
  ok(mz.aktionen.haupt.disabled === true && mz.aktionen.hinweis.text.indexOf('siehst zu') >= 0, 'Zuschauer: Hauptknopf gesperrt, Hinweis "Du siehst zu"');
  const marks = g.inventory.marks, stufe = g.ship.stufe;
  TU.keyDown({ code: 'KeyF' }, T.view(1)); TU.keyDown({ code: 'Enter' }, T.view(1)); TU.keyDown({ code: 'Digit4' }, T.view(1));
  T.nachlauf(1);
  ok(g.inventory.marks === marks && g.ship.stufe === stufe && nutzerUi.auswahl === 'stufe', 'Zuschauer-Tasten ändern weder Marken noch die Ansicht des Nutzers');
  // der Server nimmt von Zuschauern nur zusehen und vorschau an
  g.handleMessage(T.conns[1], { t: 'cmd', c: 'werft.freischalten', art: 'stufe', id: 1 });
  ok(g.inventory.marks === marks && g.ship.stufe === stufe, 'Server: werft.freischalten von einem Spieler ohne Terminal wird abgelehnt');
  TU.zusehen({ send() {} }, false);
  g.players[0].console = null;
  g.snapshot();
  ok(!g.snapshot().werft, 'Nutzer steht auf: Block werft fehlt, Zuschauerflag zurückgesetzt');
  ok(g.players[1].zusehen === false, 'Zuschauerflag nach dem Aufstehen gelöscht');
}

section('Review: Vorschau-Zuordnung, gesperrter Raum, Zuschauer-Modell, voll ausgebaut, Handel');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T);
  // N2: Antworten werden über rid zugeordnet, nicht nach Reihenfolge
  TU.onEvent({ kind: 'werftVorschau', rid: 'waffe|9|sturmbatterie', vorschau: { moeglich: true, marker: 'B' } });
  TU.onEvent({ kind: 'werftVorschau', rid: 'waffe|9|streubatterie', vorschau: { moeglich: true, marker: 'A' } });
  ok(TU.zustand.vorschau.cache['waffe|9|streubatterie'].marker === 'A' && TU.zustand.vorschau.cache['waffe|9|sturmbatterie'].marker === 'B', 'werftVorschau: Zuordnung über rid, auch bei vertauschter Reihenfolge');
  TU.zuruecksetzen();
  // gesperrter Raum F4 auf Stufe 0: der Hauptknopf kauft den nächsten Schritt mit Preis, Hinweis nennt den Rest
  T.key('F4'); let m = T.m();
  ok(m.ansicht === 'stufe' && m.aktionen.haupt.text === 'Stufe 1 öffnen · ' + CONFIG.werft.preise.stufe[1] + ' M' && !m.aktionen.haupt.disabled, 'F4 noch zu: Hauptknopf "' + m.aktionen.haupt.text + '"');
  ok(m.aktionen.hinweis.text === 'F4 ab Stufe 2 · dann ' + CONFIG.werft.preise.stufe[2] + ' M', 'Hinweis "' + m.aktionen.hinweis.text + '"');
  ok(m.stufen.ziel === 1 && m.stufen.oeffnet.length > 0 && m.schnitt.plaetze[7].zustand === 'neu', 'rechts der Block "Stufe 1 öffnet", Plätze 7 und 9 als neu im Plan');
  // Zuschauer: Titel, Rahmen, gesperrte Zellen
  TU.zusehen({ send() {} }, true);
  m = TU.modell(T.view(1));
  ok(m.titel === 'ZUSEHEN' && m.rahmenFarbe === 0 && m.kreuz.gesperrt === true && m.module.gesperrt === true && m.aktionen.haupt.disabled === true, 'Zuschauer-Modell: Titel ZUSEHEN, Rahmen in der Farbe des Nutzers, Kreuz und Module gedimmt');
  TU.zusehen({ send() {} }, false);
  // voll ausgebaut
  T.g.inventory.marks = 5000; T.debug && null;
  Werft.debug(T.g, ['freischalten', 'alle']);
  T.key('KeyA'); m = T.m();
  ok(m.stufen && m.stufen.voll === true && m.stufen.oeffnet.length === 0 && m.aktionen.haupt.disabled === true && /Voll ausgebaut/.test(m.aktionen.haupt.text), 'voll ausgebaut: kein "öffnet", kein Kauf');
  // Handel: gedimmtes Kreuz, Klick wechselt in die Werft, Grund einmal in der Infozeile
  T.g.inventory.marks = 5; T.key('KeyH'); m = T.m();
  ok(m.kreuz.gesperrt === true && m.module.gesperrt === true && typeof m.kreuz.onPlatz === 'function', 'Handel: Kreuz und Module gedimmt, Klick vorhanden');
  ok(/^Nicht genug Marken \(fehlen \d+\)$/.test(m.handel.info.grund || ''), 'Handel: Grund in der Infozeile mit fehlendem Betrag: ' + m.handel.info.grund);
  m.kreuz.onPlatz(8); ok(TU.zustand.bereich === 'werft' && TU.zustand.platz === 8, 'Klick auf das Kreuz im Handel wechselt in die Werft');
  // Sonderzeichen-Ids aus dem Snapshot stören nicht
  const v = T.view(0); v.state.ship.mounts.push({ id: 'constructor', typ: '__proto__' });
  let fehlerText = null; try { TU.modell(v); } catch (e) { fehlerText = e.message; }
  ok(fehlerText === null, 'Modell übersteht unbekannte Mount-Ids ' + (fehlerText || ''));
}

section('Testumgebung: Terminal in Wellen All mit Rüstphase');
{
  const g = new Game({ noStore: true, seed: 33, debug: true, ruestphase: true, log: () => {}, env: { MISSION_SOURCE: 'fallback' } });
  const conns = [0, 1].map((i) => { const c = { inbox: [], send(m) { this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'Wa' + i, color: i }); return c; });
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space', szene: 'frei' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  g.players[0].console = 'shop';
  const sicht = (i) => ({ state: JSON.parse(JSON.stringify(g.snapshot())), me: g.players[i], send(m) { g.handleMessage(conns[i], m); const ib = conns[i].inbox.splice(0); for (const e of ib) if (e.t === 'event' && /^werft/.test(e.kind)) TU.onEvent(e); }, actions: { sfx() {}, leave() {} } });
  TU.zuruecksetzen();
  let m = TU.modell(sicht(0));
  ok(m.kopf.art === 'test' && m.kopf.ort === 'Lerche' && m.bereich === 'werft' && m.kopf.marken === CONFIG.werft.testmarken, 'Kopf: Testumgebung, Marken ' + m.kopf.marken);
  ok(m.start && m.start.text === 'Szene starten' && !m.start.disabled && typeof m.start.onClick === 'function', 'Rüstphase: Knopf "Szene starten" (Taste G)');
  ok(m.ansicht === 'platz' && m.aktionen.haupt, 'Werft ist nutzbar (kein "gesperrt")');
  TU.zusehen({ send() {} }, true); const mz = TU.modell(sicht(1)); TU.zusehen({ send() {} }, false);
  ok(mz.start && mz.start.disabled === true && !mz.start.onClick, 'Zuschauer: Startknopf gesperrt');
  TU.keyDown({ code: 'KeyG' }, sicht(0));
  ok(g.arena.wellen.ph === 'countdown', 'Taste G startet die Szene (werft.start)');
  m = TU.modell(sicht(0));
  ok(!m.start, 'danach kein Startknopf mehr');
}

section('Klickziele: jede Zelle in jedem Zustand wählbar (Bug: leere Plätze und Räume waren nicht anklickbar)');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T);
  const g = T.g; g.inventory.marks = 5000;
  T.key('KeyA'); T.key('KeyF'); T.key('KeyA');   // Stufe 1: 7 und 9 offen und leer, 1 bis 3 zu
  let m = T.m();
  const zust = (p) => m.kreuz.plaetze[p].zustand;
  ok(zust(8) === 'bestueckt' && zust(7) === 'offen' && zust(1) === 'zu', 'Voraussetzung: bestückt (8), leer (7), gesperrt (1): ' + [8, 7, 1].map(zust).join('/'));
  for (const quelle of ['kreuz', 'schnitt']) {
    for (let p = 1; p <= 9; p++) {
      TU.zuruecksetzen(); m = T.m();
      ok(typeof m[quelle].onPlatz === 'function', `${quelle}: Handler für Platz ${p} vorhanden`);
      m[quelle].onPlatz(p);
      ok(TU.zustand.platz === p && TU.zustand.auswahl === 'platz' && TU.zustand.bereich === 'werft', `${quelle}: Klick wählt Platz ${p} (${m.kreuz.plaetze[p].zustand})`);
    }
  }
  for (const quelle of ['module', 'schnitt']) {
    for (let r = 1; r <= 4; r++) {
      TU.zuruecksetzen(); m = T.m();
      m[quelle].onModul(r);
      ok(TU.zustand.raum === r && TU.zustand.auswahl === 'modul', `${quelle}: Klick wählt Modulraum ${r} (${m.module.module[r].zustand})`);
    }
  }
  // leerer Platz: wählbar, Waffe einbauen per Klick auf Zeile und Hauptknopf
  TU.zuruecksetzen(); T.m().kreuz.onPlatz(7); m = T.m();
  ok(m.ansicht === 'platz' && m.liste.teile.length > 1, 'leerer Platz 7: Teilliste da');
  m.liste.teile.find((t) => t.id === 'standardbatterie').onClick(); m = T.m();
  m.aktionen.haupt.onClick(); T.nachlauf(0);
  ok(g.ship.waffen[7] === 'standardbatterie', 'Platz 7 per Klick bestückt');
  // gesperrter Platz: zeigt „Stufe n öffnen · Preis“
  TU.zuruecksetzen(); T.m().kreuz.onPlatz(1); m = T.m();
  ok(m.ansicht === 'stufe' && /^Stufe \d öffnen · \d+ M$/.test(m.aktionen.haupt.text), 'gesperrter Platz 1 per Klick: ' + m.aktionen.haupt.text);
  // Zuschauer: keine Handler
  TU.zusehen({ send() {} }, true); m = TU.modell(T.view(1)); TU.zusehen({ send() {} }, false);
  ok(!m.kreuz.onPlatz && !m.module.onModul && !m.schnitt.onPlatz && !m.schnitt.onModul, 'Zuschauer: keine Klickhandler');
}

section('Tastenbelegung (tasten.js, Gruppe terminal)');
{
  const tw = { window: null, localStorage: null };
  const ctx2 = vm.createContext(Object.assign({ navigator: {}, console }, tw)); ctx2.window = ctx2;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tasten.js'), 'utf8'), ctx2, { filename: 'tasten.js' });
  const Tasten = ctx2.Tasten;
  const ids = ['terminal.platz1', 'terminal.platz9', 'terminal.modul1', 'terminal.modul4', 'terminal.teilHoch', 'terminal.teilRunter', 'terminal.bestaetigen', 'terminal.freischalten', 'terminal.ausbau', 'terminal.handel', 'terminal.werft', 'terminal.kaufen'];
  ok(ids.every((id) => Tasten.aktion(id) && Tasten.aktion(id).gruppe === 'terminal'), 'Aktionen der Gruppe terminal vorhanden');
  ok(Tasten.GRUPPEN.some((g) => g.id === 'terminal') && Tasten.konflikte('terminal').length === 0, 'Gruppe im Menü, keine Standardkonflikte');
  ok(Tasten.kappe('terminal.bestaetigen') === 'Ent' && Tasten.kappe('terminal.modul4') === 'F4' && Tasten.kappe('terminal.freischalten') === 'F', 'Kappen: Ent, F4, F');
  ok(Tasten.belegung('terminal.werft')[0] === 'KeyW' && Tasten.belegung('terminal.handel')[0] === 'KeyH', 'W = Werft, H = Handel');
  ok(Tasten.AKTIONEN.filter((a) => /^terminal\.platz/.test(a.id)).length === 9 && Tasten.AKTIONEN.filter((a) => /^terminal\.modul/.test(a.id)).length === 4, '9 Platz- und 4 Modultasten');
}

// SUND-02b C: Stufe am Rang. Der Server liefert den Grund je Stufe (werft.sperre), die UI zeigt ihn an der Stufe und am Hauptknopf; ohne Grund (Kampagne) bleibt alles wie in PAN-01.
section('Stufe am Rang: gesperrt mit Grund');
{
  const T = partie(); TU.zuruecksetzen(); zeichnen(T);
  const g = T.g;
  const stufe2Alt = g.C.werft.ruf.stufe[2];   // wiederherstellen, nicht löschen (SUND-02b C trägt die Bindung in den Daten)
  g.C.werft.ruf.stufe[2] = 'centurio'; g.rufErreicht = () => false;   // Modus Freie Fahrt Sund, Rang Miles (ohne den Modus selbst zu starten)
  T.key('KeyA'); T.key('KeyF');   // Stufe 1 ist frei
  ok(g.ship.stufe === 1, 'Stufe 1 ohne Rang gekauft');
  T.key('KeyA'); let m = T.m();
  ok(m.ansicht === 'stufe' && m.stufen.ziel === 2 && m.stufen.sperre === 'Rang Centurio nötig' && m.stufen.stufen[2].sperre === 'Rang Centurio nötig' && !m.stufen.stufen[1].sperre, 'Ausbau-Ansicht: Grund "Rang Centurio nötig" an Stufe 2, nicht an Stufe 1');
  ok(m.aktionen.haupt.disabled && m.aktionen.haupt.grund === 'Rang Centurio nötig', 'Hauptknopf gesperrt mit dem Rang-Grund (vor „Marken fehlen“)');
  const marks = g.inventory.marks; T.key('KeyF');
  ok(g.ship.stufe === 1 && g.inventory.marks === marks, 'F bei gesperrter Stufe kauft nichts');
  g.rufErreicht = () => true; m = T.m();
  ok(!m.stufen.sperre && m.aktionen.haupt.grund !== 'Rang Centurio nötig', 'Rang erreicht: Rang-Grund weg');
  // Darstellung (echte Zeichenfunktion mit aufzeichnender Attrappe): gesperrte Stufe mit „!“ in Warnfarbe, Grundzeile im Block
  g.rufErreicht = () => false; TU.zustand.antwort = null; m = T.m();
  ok(m.aktionen.hinweis.text === 'Rang Centurio nötig' && m.aktionen.hinweis.fn === 'warn', 'Hinweiszeile unter dem Knopf zeigt den Rang-Grund statt „… Marken, einmalig“ (Warnfarbe)');
  const zeichne = (stufenModell) => { const rec = []; const ctx = new Proxy({}, { get: () => () => {}, set: () => true }); const R2 = { measure: (t) => String(t).length * 6, wrap: (t) => [t], ui: { buttons: [], mouse: { x: 0, y: 0 } }, text: (c, t, x, y, o) => rec.push([t, o.color]) };
    const P2 = new Proxy({ FN: new Proxy({}, { get: (t, k) => 'fn:' + String(k) }), SKINS: { rom: new Proxy({}, { get: (t, k) => 'sk:' + String(k) }) }, mix: (a) => a, rgba: () => '#000' }, { get: (t, k) => (k in t ? t[k] : () => {}) });
    const w2 = { Render: R2, Pult: P2 }; w2.window = w2; vm.createContext(w2);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pult-terminal-tokens.js'), 'utf8'), w2, { filename: 'pult-terminal-tokens.js' });
    w2.PultTerminal.zeichneStufen(ctx, { x: 0, y: 30, w: 260, h: 196 }, stufenModell); return rec; };
  let rec = zeichne(m.stufen);
  ok(rec.some(([t, c]) => t === '! 180 M' && c === 'fn:warn') && rec.some(([t, c]) => t === '! 900 M' && c === 'fn:warn') && !rec.some(([t]) => t === '180 M'), 'Zeichnung: gesperrte Stufen 2 und 3 als "! Preis" in Warnfarbe');
  ok(rec.some(([t, c]) => t === 'Rang Centurio nötig' && c === 'fn:warn'), 'Zeichnung: Grundzeile "Rang Centurio nötig" in Warnfarbe im Block');
  g.rufErreicht = () => true; rec = zeichne(T.m().stufen);
  ok(rec.some(([t, c]) => t === '180 M' && c !== 'fn:warn') && !rec.some(([t]) => /^!|Rang/.test(t)), 'Zeichnung ohne Sperre: Preis in Preisfarbe, kein "!", keine Grundzeile');
  // gesperrter Platz/Raum (Platzansicht): der Hauptknopf nennt den Rang-Grund, auch bei zu wenigen Marken
  g.rufErreicht = () => false; g.inventory.marks = 20; TU.zuruecksetzen(); T.key('F4'); m = T.m();
  ok(m.ansicht === 'stufe' && m.stufen.ziel === 2, 'F4 (gesperrter Raum) öffnet die Stufenansicht');
  ok(m.aktionen.haupt.disabled && m.aktionen.haupt.grund === 'Rang Centurio nötig', 'Platzansicht gesperrt: Hauptknopf nennt den Rang-Grund statt "Nicht genug Marken" (' + m.aktionen.haupt.grund + ')');
  g.inventory.marks = 1000;
  if (stufe2Alt === undefined) delete g.C.werft.ruf.stufe[2]; else g.C.werft.ruf.stufe[2] = stufe2Alt;
  delete g.rufErreicht;
}

console.log(`\ntest-werft-ui: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
