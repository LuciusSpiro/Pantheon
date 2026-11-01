'use strict';
// CHA-01 E: Test des Startmenüs (public/js/menue.js, Zustand und Regeln in Node, ohne Browser).
//  1. Gruppierung: jeder Modus aus LOBBY_MODI gehört genau einem Menüeintrag (Eisenwald deckt zwei Modi ab), nichts geht verloren, nichts doppelt.
//  2. Sichtbarkeit: Sternenschicht-Modi (m1, free, m3) nur mit ?debug=1, Labor nur mit lobby.laborAn, Fortsetzen nur mit Weltstand.
//  3. Bildschirmfluss: Titel → Hauptmenü → Lobby, Esc zurück (bereit wird zurückgenommen), Einladungslink überspringt Titel und Hauptmenü, Direktstart in die Lobby, Rückkehr nach der Runde.
//  4. Navigation, Tasten 1–7, Eisenwald-Schalter (Tutorial), Moduswahl-Überlagerung der Lobby.
//  5. Nachrichten: jeder sichtbare Eintrag erzeugt ein lobbyOpt, das der echte Server (Game) annimmt; Wellen Boden/All tragen ihre Kartenwahl, Fortsetzen nur die Welt.
//  6. Crew: Gastgeber = erster verbundener Spieler, Bereit-Zählung.
//  7. Nacharbeit: Tutorial-Schalter (Merker im Menü, Modus der Runde in der Lobby), Einladung ablehnen verlässt den Raum, Weltstand-Belegung, sichtbarer Modus beim Eintritt,
//     Weltstand gewählt (Hauptmenü / Moduswahl), Labor-Auswahl, Startlogik (?menue, ?arena, webdriver), Tastenzuordnung von menue-ui.js taste() je Schirm.
//  7b. CHA-01 G (Designer-Review): Bereit-Knopf je Zustand, Titelumbruch, Chips „Name: Wert“ ohne verlorene Option (jeder Modus, schlimmster Wert), Grabenabschnitte und Laborsatz,
//     Einladungszählung ohne sich selbst, aktiver Modus der Überlagerung, Raumcode-Eingang nach Ablehnung, Kammer-Hauptknopf je Herkunft, Titel Eisenwald, Texte, Porträt-Platte.
//  8. Mutationsproben: Regeln werden im Quelltext verändert, der Test muss rot werden (Debug-Sichtbarkeit, Link überspringt Titel, Tutorial-Synchronisierung,
//     Rücknahme von „bereit“, Raum verlassen, sichtbarer Modus, Weltstand voll, Startlogik).
//   node tools/test-menue.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const QUELLE = path.join(__dirname, '..', 'public', 'js', 'menue.js');
const QUELLE_UI = path.join(__dirname, '..', 'public', 'js', 'menue-ui.js');
const TOKENS = require('../public/js/menue-tokens.js');
const PKT = require('../public/js/pult-kammer-tokens.js');
const QUELLE_BAUSTEINE = path.join(__dirname, '..', 'public', 'js', 'kammer-bausteine.js');
const ART = require('../public/js/art.js').Art;   // echte Textbreiten der Pixelschrift
const BR = (s, sk) => ART.measureText(String(s), sk || 1);

let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) { console.log('\n[' + name + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } }

const WELTEN = [{ id: 'w2', name: 'Sund · Kantenstein', playTime: 13000, state: 'ok' }, { id: 'w1', name: 'Alt', playTime: 100, state: 'ok' }];
const LOB = { startMission: 'm1', world: null, worlds: [], laborAn: true };
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Frische Instanz (Modul aus Quelltext, damit Mutationen greifen) mit Spion für gesendete Nachrichten
function modul(quelltext) {
  const m = { exports: {} };
  new Function('module', 'exports', 'self', quelltext)(m, m.exports, undefined);
  return m.exports;
}
function neu(api, o) {
  o = o || {};
  const gesendet = [];
  const wahl = { liste: [{ id: 'c1' }, { id: 'c2' }], gewaehlt: 'c1' };
  const waehle = [], verlassen = { n: 0 }, kammer = { auf: 0, neu: 0, offen: true };
  const F = api.erzeuge({
    protokoll: Protocol, senden: (m) => { gesendet.push(m); return true; }, debug: !!o.debug, szenenIds: () => ['s_eins', 's_zwei'], weltstandMax: 5, verlasseRaum: () => { verlassen.n++; return true; },
    oeffneKammer: () => { if (kammer.offen) kammer.auf++; return kammer.offen; },
    charaktere: { MAX: 4, neuAnlegen: () => { kammer.neu++; return { ok: true }; }, lies: () => wahl, waehle: (id) => { waehle.push(id); wahl.gewaehlt = id; return { ok: true, id }; } },
  });
  return { F, gesendet, waehle, wahl, verlassen, kammer };
}

// Alle Prüfungen gegen ein Modul; liefert die Anzahl der Fehlschläge (für die Mutationsproben mit stillem Lauf)
function pruefe(api, laut) {
  let schlecht = 0;
  const p = (c, msg) => { if (laut) ok(c, msg); else if (!c) schlecht++; };

  // ---- 1 Gruppierung
  { const modi = api.zugeordneteModi(), soll = Protocol.LOBBY_MODI.slice().sort();
    p(gleich(modi.slice().sort(), soll), 'jeder Modus aus LOBBY_MODI gehört genau einem Eintrag (' + modi.length + ' von ' + soll.length + ')');
    p(new Set(modi).size === modi.length, 'kein Modus doppelt zugeordnet');
    const fremde = modi.filter((m) => !Protocol.LOBBY_MODI.includes(m));
    p(!fremde.length, 'kein Eintrag nennt einen unbekannten Modus ' + fremde.join(','));
    const ids = api.GRUPPEN.flatMap((g) => g.eintraege.map((e) => e.id)), tasten = api.GRUPPEN.flatMap((g) => g.eintraege.map((e) => e.taste));
    p(new Set(ids).size === ids.length && new Set(tasten).size === tasten.length, 'Eintrags-IDs und Tasten sind eindeutig');
    p(api.eintragZuModus('eisenwald').id === 'eisenwald' && api.eintragZuModus('eisenwald_ohne').id === 'eisenwald', 'Eisenwald mit und ohne Tutorial ist ein Eintrag');
    p(api.GRUPPEN.find((g) => g.id === 'debug').eintraege.map((e) => e.modi[0]).sort().join() === 'free,m1,m3', 'Debug-Gruppe: genau die Sternenschicht-Modi m1, free, m3');
    p(api.GRUPPEN.find((g) => g.id === 'spielen').eintraege.map((e) => e.id).join() === 'schuld_der_lerche,freie_fahrt,eisenwald', 'Spielen: Schuld der Lerche, Freie Fahrt Sund, Kampagne Eisenwald');
    p(api.GRUPPEN.find((g) => g.id === 'uebung').eintraege.map((e) => e.id).join() === 'arena_graben,arena_away,arena_space,labor', 'Übungsplatz: Grabenangriff, Wellen Boden, Wellen All, Labor'); }

  // ---- 2 Sichtbarkeit
  { const sicht = (o, lob) => { const { F } = neu(api, o); return F.sichtbar(lob).flatMap((e) => e.modi); };
    const ohne = sicht({}, LOB), mit = sicht({ debug: true }, LOB);
    p(['m1', 'free', 'm3'].every((m) => !ohne.includes(m)), 'ohne ?debug=1: keine Sternenschicht-Modi im Menü');
    p(['m1', 'free', 'm3'].every((m) => mit.includes(m)), 'mit ?debug=1: Boje/Nebel/Kesh, Lichtkordon und Direkt Kesh sichtbar');
    p(ohne.includes('labor') && !sicht({}, Object.assign({}, LOB, { laborAn: false })).includes('labor'), 'Labor sichtbar, solange der Server es anbietet; ohne lobby.laborAn unsichtbar (Aus-Pfad bleibt)');
    const { F } = neu(api);
    p(!F.sichtbar(LOB).some((e) => e.fortsetzen) && F.sichtbar(Object.assign({}, LOB, { worlds: WELTEN })).some((e) => e.fortsetzen), 'Fortsetzen erscheint nur mit einem Weltstand');
    p(F.neuesteWelt(Object.assign({}, LOB, { worlds: [{ id: 'x', state: 'kaputt' }].concat(WELTEN) })).id === 'w2', 'Fortsetzen nimmt den neuesten ladbaren Weltstand'); }

  // ---- 3 Bildschirmfluss
  { let t = neu(api), F = t.F;
    p(F.starte({}).schirm === 'titel', 'Start ohne Besonderheit: Titelbild');
    p(F.starte({ link: true }).schirm === 'einladung', 'Einladungslink: Einladung (Titel und Hauptmenü entfallen)');
    p(F.starte({ direkt: true }).schirm === 'lobby', 'Direktstart (?arena=, Automation): Lobby');
    F.starte({}); F.weiter(); p(F.lies().schirm === 'menue', 'Enter im Titel: Hauptmenü');
    F.synchronisiere(LOB); F.waehleTaste('2', LOB);
    const r = F.bestaetige(LOB); p(r.ok && F.lies().schirm === 'lobby', 'Enter im Hauptmenü: Lobby');
    p(gleich(t.gesendet[0], { t: 'lobbyOpt', startMission: 'freie_fahrt', world: null }), 'Hauptmenü sendet Modus und „neuer Weltstand“ in einer Nachricht: ' + JSON.stringify(t.gesendet[0]));
    F.zurueck({ ready: true });
    p(F.lies().schirm === 'menue' && gleich(t.gesendet[1], { t: 'ready', ready: false }), 'Esc aus der Lobby: Hauptmenü, „bereit“ wird zurückgenommen (im Menü gilt man als nicht bereit)');
    F.zurueck(null); p(F.lies().schirm === 'titel', 'Esc im Hauptmenü: Titel');
    F.starte({ direkt: true }); t.gesendet.length = 0; F.zurueck({ ready: false }); p(F.lies().schirm === 'menue' && !t.gesendet.length, 'Esc ohne „bereit“ sendet nichts');
    F.starte({ link: true }); p(!F.zurueck(null).ok && F.lies().schirm === 'einladung', 'zurueck() gilt nicht für die Einladung (die hat einladungAblehnen)');
    F.starte({}); F.imRaum(); p(F.lies().schirm === 'lobby', 'nach der Runde: Lobby, nicht Titel'); }

  // ---- 4 Navigation, Eisenwald-Schalter, Moduswahl
  { const t = neu(api), F = t.F; F.starte({}); F.weiter(); F.synchronisiere(LOB);
    const ids = []; for (let i = 0; i < 20; i++) { ids.push(F.lies().auswahl); F.bewege(1, LOB); }
    p(ids[0] === ids[ids.length - 1] || new Set(ids).size === F.sichtbar(LOB).length, 'Pfeil runter läuft durch alle sichtbaren Einträge und springt um');
    F.waehleTaste('1', LOB); F.bewege(-1, LOB); p(F.lies().auswahl === F.sichtbar(LOB).slice(-1)[0].id, 'Pfeil hoch vom ersten Eintrag springt auf den letzten');
    p(!F.waehleTaste('8', LOB).ok && !F.waehleTaste('0', LOB).ok, 'Tasten 8/9/0 gibt es ohne Debug nicht');
    p(F.waehleTaste('7', LOB).ok && F.lies().auswahl === 'labor', 'Taste 7 wählt das Szenario-Labor');
    const t2 = neu(api, { debug: true }); t2.F.synchronisiere(LOB); p(t2.F.waehleTaste('8', LOB).ok && t2.F.lies().auswahl === 'm1', 'mit Debug wählt 8 die Kampagne Boje/Nebel/Kesh');
    F.waehleTaste('3', LOB); F.bestaetige(LOB);
    p(t.gesendet.slice(-1)[0].startMission === 'eisenwald', 'Eisenwald startet standardmäßig mit Tutorial');
    F.starte({}); F.weiter(); F.waehleTaste('3', LOB); F.schalteTutorialMerker(); F.bestaetige(LOB);
    p(t.gesendet.slice(-1)[0].startMission === 'eisenwald_ohne', 'Tutorial-Schalter aus: Eisenwald ohne Tutorial');
    const vor = t.gesendet.length; F.schalteTutorialMerker(); p(t.gesendet.length === vor && F.lies().tutorial === true, 'Schalter im Hauptmenü sendet noch nichts');
    F.schalteTutorialDerRunde({ startMission: 'eisenwald_ohne' }); p(t.gesendet.slice(-1)[0].startMission === 'eisenwald' && F.lies().tutorial === true, 'in der Lobby bei Eisenwald schaltet U den Lobby-Modus um (jeder darf)');
    p(!F.schalteTutorialDerRunde({ startMission: 'freie_fahrt' }).ok, 'in der Lobby ohne Eisenwald gibt es den Schalter nicht');
    F.starte({ direkt: true }); p(F.oeffneModusWahl({ startMission: 'freie_fahrt', worlds: [] }).ok && F.lies().modusOffen && F.lies().auswahl === 'freie_fahrt', 'M öffnet die Moduswahl auf dem aktuellen Modus');
    F.zurueck(null); p(!F.lies().modusOffen && F.lies().schirm === 'lobby', 'Esc schließt zuerst nur die Moduswahl');
    { const lobE = { startMission: 'eisenwald_ohne', worlds: [] }; F.starte({ direkt: true }); F.synchronisiere(lobE); p(F.oeffneModusWahl(lobE).ok && F.lies().auswahl === 'eisenwald' && F.lies().tutorial === false, 'Moduswahl bei Eisenwald ohne Tutorial: Eintrag Eisenwald, Schalter steht auf aus'); }
    const f2 = neu(api).F; f2.starte({}); p(!f2.oeffneModusWahl(LOB).ok, 'Moduswahl nur in der Lobby'); }

  // ---- 5 Nachrichten
  { const t = neu(api, { debug: true }), F = t.F, lob = Object.assign({}, LOB, { worlds: WELTEN });
    const msgs = {};
    for (const e of F.sichtbar(lob)) { const m = F.nachrichtFuer(e, lob); if (m) msgs[e.id] = m; }
    p(F.sichtbar(lob).every((e) => msgs[e.id]), 'jeder sichtbare Eintrag erzeugt eine Nachricht');
    p(msgs.arena_away.wellen === Protocol.WELLEN_KARTEN[0] && msgs.arena_space.szene === 's_eins', 'Wellen Boden/All tragen die Kartenwahl (sonst startet der Server den Altweg)');
    p(F.nachrichtFuer(F.eintragMitId('arena_away'), Object.assign({}, lob, { wellen: 'ruine' })).wellen === 'ruine', 'eine schon gewählte Karte bleibt');
    p(gleich(msgs.fortsetzen, { t: 'lobbyOpt', world: 'w2' }), 'Fortsetzen sendet nur den Weltstand');
    p(F.nachrichtFuer(F.eintragMitId('fortsetzen'), LOB) === null, 'Fortsetzen ohne Weltstand: keine Nachricht');
    // der echte Server nimmt sie an
    const alle = Protocol.LOBBY_MODI, gesehen = new Set();
    for (const e of F.sichtbar(lob).filter((x) => !x.fortsetzen)) {
      for (const tutorial of e.tutorial ? [true, false] : [true]) {
        const t2 = neu(api, { debug: true }); t2.F.lies().tutorial = tutorial;
        const m = t2.F.nachrichtFuer(e, lob), g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
        const c = { inbox: [], send(x) { this.inbox.push(x); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M0', name: 'M0', color: 0 });
        g.handleMessage(c, m);
        const gut = g.lobbyOpts.startMission === m.startMission && g.lobbyOpts.world === null;
        if (gut) gesehen.add(m.startMission); else p(false, 'Server lehnt ' + m.startMission + ' ab (ist ' + g.lobbyOpts.startMission + ')');
      }
    }
    p(gleich([...gesehen].sort(), alle.slice().sort()), 'der echte Server nimmt alle ' + alle.length + ' Modi aus den Menüeinträgen an (inkl. Eisenwald mit/ohne Tutorial)'); }

  // ---- 6 Crew
  { const F = neu(api).F, sp = [{ id: 'p2', connected: false, ready: true }, { id: 'p3', connected: true, ready: true }, { id: 'p1', connected: true, ready: false }];
    p(F.gastgeber(sp).id === 'p3', 'Gastgeber = erster verbundener Spieler der Liste (Beitrittsreihenfolge), getrennte zählen nicht');
    p(F.gastgeber([]) === null, 'ohne Spieler kein Gastgeber');
    const z = F.zaehlung(sp); p(z.an === 2 && z.bereit === 1 && !z.alleBereit && z.wartend[0].id === 'p1', 'Zählung: 2 an Bord, 1 bereit, wartet auf p1');
    p(F.zaehlung([{ connected: true, ready: true }]).alleBereit, 'alle bereit erkannt'); }

  // ---- 7 Einladung
  { const t = neu(api), F = t.F; F.starte({ link: true });
    F.bewegeEinladung(1); p(F.lies().einladungCursor === 1, 'Einladung: Cursor weiter');
    F.setzeEinladungCursor(0); const r0 = F.einladungAnnehmen(); p(r0.ok && F.lies().schirm === 'lobby' && !t.waehle.length, 'Charakter am Cursor ist schon gewählt: Lobby, keine neue Wahl nötig');
    F.starte({ link: true }); F.setzeEinladungCursor(1); const r1 = F.einladungAnnehmen(); p(r1.ok && gleich(t.waehle, ['c2']) && F.lies().schirm === 'lobby', 'anderer Charakter: Charaktere.waehle (sendet das hello), dann Lobby');
    F.starte({ link: true }); F.setzeEinladungCursor(3); const r2 = F.einladungAnnehmen(); p(!r2.ok && r2.grund === 'frei' && F.lies().schirm === 'einladung', 'freier Platz: nichts passiert, Einladung bleibt'); }

  // ---- 8 Zusatzoptionen je Modus
  { const F = neu(api).F, tasten = (m, lob, w) => F.optionenFuer(m, lob || {}, w).map((o) => o.taste).filter(Boolean).join(' ');
    p(tasten('arena_away') === 'K W', 'Wellen Boden: K Karte, W Waffe');
    p(tasten('arena_space') === 'K', 'Wellen All: K Szene');
    p(tasten('arena_graben', { grabenListe: [{ name: 'Wiese', varianten: [{}, {}] }, { name: 'Wald', varianten: [{}, {}] }, { name: 'Hang', varianten: [{}] }] }) === 'K N W', 'Grabenangriff: K/N für Abschnitte mit zwei Varianten, W Waffe');
    p(tasten('labor') === '↑↓ ←→ R G W', 'Labor: ↑↓ Umsetzung, ←→ Stärke, R Seed, G god, W Waffe');
    p(tasten('eisenwald') === 'U' && tasten('eisenwald_ohne') === 'U' && tasten('m1') === 'U', 'U: Tutorial bei Eisenwald, Hafen-Übung bei Kampagne (Debug)');
    p(tasten('freie_fahrt') === '' && tasten('arena_away', {}, { id: 'w' }) === '', 'Freie Fahrt ohne Optionen; mit gewähltem Weltstand entfällt die Startauswahl');
    p(F.optionFuerTaste('ArrowDown', 'labor', {}).arg === 1 && F.optionFuerTaste('KeyZ', 'labor', {}) === null, 'Taste → Option (auch die versteckten Pfeile)'); }
  // ---- 9 Nacharbeit: Tutorial-Schalter U (S1)
  { const lobE = { startMission: 'eisenwald', worlds: [] };
    // Hauptmenü: Lobby steht auf eisenwald, U schaltet den Merker, synchronisiere (jeder Frame) darf ihn nicht zurücksetzen
    { const t = neu(api), F = t.F; F.starte({}); F.weiter(); F.synchronisiere(lobE); F.waehleTaste('3', lobE);
      F.schalteTutorialMerker(); F.synchronisiere(lobE); F.synchronisiere(lobE); F.bestaetige(lobE);
      p(F.lies().tutorial === false && t.gesendet.slice(-1)[0].startMission === 'eisenwald_ohne', 'S1 Hauptmenü: Lobby-Modus eisenwald, U, synchronisiere, Enter → eisenwald_ohne (U wirkt)'); }
    // Moduswahl-Überlagerung in der Lobby: dasselbe
    { const t = neu(api), F = t.F; F.starte({ direkt: true }); F.synchronisiere(lobE); F.oeffneModusWahl(lobE);
      F.schalteTutorialMerker(); F.synchronisiere(lobE); F.bestaetige(lobE);
      p(t.gesendet.slice(-1)[0].startMission === 'eisenwald_ohne', 'S1 Moduswahl: Lobby-Modus eisenwald, U, synchronisiere, Enter → eisenwald_ohne'); }
    // Wechselt der Lobby-Modus (ein anderer Spieler schaltet), folgt der Merker
    { const F = neu(api).F; F.starte({}); F.weiter(); F.synchronisiere(lobE); F.schalteTutorialMerker(); F.synchronisiere({ startMission: 'eisenwald_ohne', worlds: [] }); const a = F.lies().tutorial; F.synchronisiere(lobE);
      p(a === false && F.lies().tutorial === true, 'S1: wechselt der Lobby-Modus (eisenwald_ohne, dann eisenwald), folgt der Merker dem neuen Modus'); }
    // Lobby: die Action der Runde sendet sofort und zeigt den Modus der Runde
    { const t = neu(api), F = t.F; F.starte({ direkt: true }); F.synchronisiere(lobE); const r = F.schalteTutorialDerRunde(lobE);
      p(r.ok && r.gesendet === 'eisenwald_ohne' && t.gesendet.slice(-1)[0].startMission === 'eisenwald_ohne', 'S1 Lobby: U sendet sofort den Modus der Runde'); }
    // Merker und Runde sind zwei Actions, keine Steuerparameter
    { const F = neu(api).F; p(F.schalteTutorialMerker.length === 0 && F.schalteTutorialDerRunde.length === 1 && F.schalteTutorial === undefined, 'S1: schalteTutorialMerker() und schalteTutorialDerRunde(lob) sind getrennte Actions'); } }

  // ---- 9b Nacharbeit Gesamt K1/K2: eine Action für N in der Einladung, Snapshot-Eingang statt Zeichnen
  { const t = neu(api), F = t.F; F.starte({ link: true });
    const r = F.einladungNeuerCharakter(); p(r.ok && t.kammer.auf === 1 && t.kammer.neu === 1, 'K1: einladungNeuerCharakter öffnet die Kleiderkammer und legt neu an');
    const t2 = neu(api); t2.F.starte({ link: true }); t2.kammer.offen = false; p(!t2.F.einladungNeuerCharakter().ok && t2.kammer.neu === 0, 'K1: ohne Kleiderkammer wird nichts angelegt');
    const t3 = neu(api); t3.F.starte({}); p(!t3.F.einladungNeuerCharakter().ok && t3.kammer.auf === 0, 'K1: außerhalb der Einladung wirkungslos');
    const t4 = neu(api), G = t4.F; G.starte({}); const vor = JSON.stringify(G.lies()); p(!G.snapshotEingang({ startMission: 'eisenwald', worlds: [] }).ok && JSON.stringify(G.lies()) === vor, 'K2: Snapshot im Titel ändert nichts');
    G.weiter(); const sn = G.snapshotEingang({ startMission: 'eisenwald', worlds: [] }); p(sn.ok && G.lies().tutorial === true && G.lies().auswahl, 'K2: Snapshot im Hauptmenü führt Auswahl und Tutorial-Merker nach'); }

  // ---- 9c Nacharbeit Gesamt (Prüfer 10): Direkteintritt sichert den sichtbaren Modus, einmalig und nur dort
  { const t = neu(api), F = t.F; F.starte({ direkt: true });
    const r = F.snapshotEingang({ startMission: 'm1', worlds: [] });
    p(r.ok && t.gesendet.length === 1 && t.gesendet[0].t === 'lobbyOpt' && t.gesendet[0].startMission !== 'm1', 'Direkteintritt ohne Debug: erster Lobby-Snapshot mit m1 setzt einen sichtbaren Modus');
    F.snapshotEingang({ startMission: 'm1', worlds: [] }); p(t.gesendet.length === 1, 'Direkteintritt: nur einmal, spätere Snapshots überschreiben nichts');
    const td = neu(api, { debug: true }); td.F.starte({ direkt: true }); td.F.snapshotEingang({ startMission: 'm1', worlds: [] }); p(!td.gesendet.length, 'Direkteintritt mit ?debug=1: m1 ist sichtbar, nichts wird gesendet');
    const te = neu(api); te.F.starte({ direkt: true }); te.F.snapshotEingang({ startMission: 'eisenwald', worlds: [] }); p(!te.gesendet.length, 'Direkteintritt mit sichtbarem Modus: nichts wird gesendet');
    const tt = neu(api); tt.F.starte({}); tt.F.weiter(); tt.F.snapshotEingang({ startMission: 'm1', worlds: [] }); p(!tt.gesendet.length, 'Titel → Hauptmenü: der Snapshot ändert den Server-Modus nicht (nur Direkteintritt)');
    const tl = neu(api); tl.F.starte({ link: true }); tl.F.einladungAnnehmen(); tl.F.snapshotEingang({ startMission: 'm1', worlds: [] }); p(!tl.gesendet.length, 'Einladung angenommen: der Modus der Crew wird nicht überschrieben'); }

  // ---- 10 Einladung ablehnen (S2)
  { const t = neu(api), F = t.F; F.starte({ link: true });
    const r = F.einladungAblehnen(); p(r.ok && r.verlassen && t.verlassen.n === 1 && F.lies().schirm === 'menue', 'S2: Esc in der Einladung verlässt den Raum (verlasseRaum) und führt ins Hauptmenü');
    p(!F.einladungAblehnen().ok && t.verlassen.n === 1, 'S2: außerhalb der Einladung verlässt nichts den Raum');
    const t2 = neu(api); t2.F.starte({}); t2.F.weiter(); t2.F.zurueck({ ready: false }); p(t2.verlassen.n === 0, 'S2: Esc im Menü verlässt den Raum nicht');
    const t3 = neu(api); t3.F.starte({ link: true }); t3.F.einladungAnnehmen(); p(t3.verlassen.n === 0 && t3.F.lies().schirm === 'lobby', 'S2: Annehmen bleibt im Raum'); }

  // ---- 11 Weltstand-Belegung, sichtbarer Modus, Weltstand gewählt, Labor, Start
  { const F = neu(api).F, ws = (n, voll) => Array.from({ length: n }, (_, i) => ({ id: 'w' + i, state: 'ok' }));
    const a = F.weltstaende({ worlds: ws(2) }), b = F.weltstaende({ worlds: ws(5) }), c = F.weltstaende({ worlds: ws(1), worldsFull: true });
    p(a.zaehler === '2/5' && a.naechste === 3 && !a.voll, 'Weltstand-Belegung: 2/5, nächster neuer Weltstand 3, nicht voll');
    p(b.zaehler === '5/5' && b.naechste === 5 && b.voll, 'Weltstand-Belegung: 5/5 ist voll (nächste Nummer bleibt 5)');
    p(c.voll, 'Weltstand-Belegung: lobby.worldsFull des Servers gilt auch bei weniger Einträgen'); }
  { // K2 sichtbarer Modus
    const t = neu(api), F = t.F; F.starte({}); F.weiter();
    const r = F.sichtbarenModusSichern({ startMission: 'm1', worlds: [] });
    p(r.gesendet === 'schuld_der_lerche' && gleich(t.gesendet.slice(-1)[0], { t: 'lobbyOpt', startMission: 'schuld_der_lerche', world: null }), 'K2: Lobby auf m1 ohne Debug → erster sichtbarer Eintrag wird als Modus gesetzt: ' + JSON.stringify(t.gesendet.slice(-1)[0]));
    const n0 = t.gesendet.length; F.sichtbarenModusSichern({ startMission: 'eisenwald', worlds: [] }); F.sichtbarenModusSichern({ startMission: 'freie_fahrt', worlds: [] });
    p(t.gesendet.length === n0, 'K2: ein sichtbarer Modus bleibt unangetastet');
    const td = neu(api, { debug: true }); td.F.sichtbarenModusSichern({ startMission: 'm1', worlds: [] }); p(!td.gesendet.length, 'K2: mit ?debug=1 ist m1 sichtbar, nichts wird gesetzt');
    const t2 = neu(api); t2.F.starte({}); t2.F.weiter(); const r2 = t2.F.neuerWeltstandGewaehlt({ startMission: 'm1', worlds: [] });
    p(t2.F.lies().schirm === 'lobby' && r2.modus === 'schuld_der_lerche', 'K2: „+ Neue Kampagne“ aus dem Hauptmenü: Lobby mit sichtbarem Modus'); }
  { // K3 Weltstand gewählt
    const t = neu(api), F = t.F; F.starte({}); F.weiter(); F.weltstandGewaehlt(); p(F.lies().schirm === 'lobby', 'K3: Weltstand im Hauptmenü gewählt → Lobby');
    F.oeffneModusWahl(LOB); p(F.lies().modusOffen, 'K3 Vorbedingung: Moduswahl offen'); F.weltstandGewaehlt(); p(!F.lies().modusOffen && F.lies().schirm === 'lobby', 'K3: Weltstand in der Moduswahl gewählt → Überlagerung schließt'); }
  { const F = neu(api).F, l = [{ id: 'a', name: 'Eins' }, { id: 'b', name: 'Zwei' }], la = F.laborAuswahl({ laborListe: l, labor: { id: 'b' } });
    p(la.position === 2 && la.n === 2 && la.eintrag.name === 'Zwei', 'Labor-Auswahl: Position 2 von 2, Eintrag Zwei');
    p(F.laborAuswahl({}).n === 0 && F.laborAuswahl({}).eintrag === null && F.laborAuswahl({ laborListe: l, labor: {} }).position === 1, 'Labor-Auswahl: leer bzw. ohne Wahl der erste Eintrag'); }
  { const S = api.startOptionen, A = (x) => JSON.stringify(x);
    p(A(S({})) === '{"link":false}' && A(S({ link: true })) === '{"link":true}', 'Start: ohne Besonderheit Titel, mit Einladungslink Einladung');
    p(A(S({ menue: '1', webdriver: true, arena: '', link: true })) === '{"link":true}' && A(S({ menue: '1', arena: 'graben', webdriver: true })) === '{"link":false}', 'Start: ?menue=1 erzwingt den Ablauf, auch bei ?arena= und Webdriver');
    p(A(S({ menue: '0', link: true })) === '{"direkt":true}', 'Start: ?menue=0 → Lobby');
    p(A(S({ arena: 'graben' })) === '{"direkt":true}' && A(S({ arena: '' })) === '{"direkt":true}' && A(S({ arena: null })) === '{"link":false}', 'Start: ?arena= → Lobby (auch leerer Wert), fehlend nicht');
    p(A(S({ webdriver: true })) === '{"direkt":true}' && A(S({ webdriver: true, link: true })) === '{"direkt":true}', 'Start: ferngesteuerter Browser (navigator.webdriver) → Lobby'); }

  // ---- 12 Tastenzuordnung von menue-ui.js taste() je Schirm
  { const quelleUi = fs.readFileSync(QUELLE_UI, 'utf8');
    const lade = (api2) => {
      const t = neu(api2, { debug: false }), win = { Render: {}, Pult: {}, Menue: TOKENS, MenueFluss: t.F, Hud: {}, Net: { serverRoomCode: 'AB' }, Tasten: { passt: (e, id) => id === 'allgemein.hilfe' && e.key === '?' } };
      new Function('window', 'Net', 'Tasten', quelleUi)(win, win.Net, win.Tasten);
      const log = [], A = { sfx: () => {} }; for (const n of ['openOptions', 'openHilfe', 'openKammer', 'openWorlds', 'toggleReady', 'setColor', 'toggleWellenKarte', 'copyInvite', 'laborWahl', 'lobbyWaffe', 'toggleSkipDrill']) A[n] = (x) => { log.push(n + (x !== undefined ? ':' + x : '')); };
      const lob = { startMission: 'm1', worlds: [], laborAn: true }, view = { actions: A, pid: 'p1', state: { lobby: lob, players: [{ id: 'p1', name: 'A', ready: true, connected: true, color: 0 }] } };
      const druecke = (code, extra) => win.MenueUi.taste(Object.assign({ code, key: code, repeat: false }, extra || {}), view);
      return Object.assign(t, { win, log, view, lob, druecke, F: t.F });
    };
    const ui = (api2) => { const u = lade(api2); const F = u.F, d = u.druecke;
      // Titel
      F.starte({}); d('KeyO'); d('KeyH'); d('Slash', { key: '?' }); d('Enter');
      const titel = u.log.join() === 'openOptions,openHilfe,openHilfe' && F.lies().schirm === 'menue';
      // Hauptmenü
      u.log.length = 0; F.synchronisiere(u.lob);
      d('Digit3'); const auswahl3 = F.lies().auswahl === 'eisenwald';
      d('KeyU'); const merker = F.lies().tutorial === false && !u.gesendet.length;
      d('KeyF'); d('ArrowDown'); const nachUnten = F.lies().auswahl === 'fortsetzen' || F.lies().auswahl === 'arena_graben';
      d('Digit3'); d('Enter'); const bestaetigt = F.lies().schirm === 'lobby' && u.gesendet.slice(-1)[0].startMission === 'eisenwald_ohne';
      const menue = auswahl3 && merker && u.log.includes('openWorlds:list') && nachUnten && bestaetigt;
      // Lobby (Modus eisenwald_ohne) und Hilfe
      u.lob.startMission = 'eisenwald_ohne'; u.log.length = 0; u.gesendet.length = 0;
      d('KeyU'); const lobbyU = u.gesendet.length === 1 && u.gesendet[0].startMission === 'eisenwald' && !u.log.length;
      d('Enter'); d('Digit2'); d('KeyL'); d('KeyF'); d('KeyH'); d('Slash', { key: '?' });
      const lobby = lobbyU && gleich(u.log, ['toggleReady', 'setColor:1', 'copyInvite', 'openWorlds:list', 'openHilfe', 'openHilfe']);
      u.log.length = 0; u.lob.startMission = 'arena_away'; d('KeyK'); d('KeyW'); const optionen = gleich(u.log, ['toggleWellenKarte', 'lobbyWaffe']);
      d('KeyM'); const modus = F.lies().modusOffen; d('Escape'); const modusZu = !F.lies().modusOffen && F.lies().schirm === 'lobby';
      u.gesendet.length = 0; d('Escape'); const esc = F.lies().schirm === 'menue' && gleich(u.gesendet, [{ t: 'ready', ready: false }]);   // Esc: Hauptmenü, „bereit“ zurückgenommen
      d('Escape'); const escTitel = F.lies().schirm === 'titel';
      // Einladung
      F.starte({ link: true }); d('ArrowRight'); d('Digit1'); d('Digit2'); const cur = F.lies().einladungCursor === 1; d('Enter');
      const angenommen = F.lies().schirm === 'lobby' && u.waehle.join() === 'c2';
      F.starte({ link: true }); u.kammer.auf = 0; u.kammer.neu = 0; d('KeyN'); const neuer = u.kammer.auf === 1 && u.kammer.neu === 1;
      F.starte({ link: true }); d('Escape'); const abgelehnt = F.lies().schirm === 'menue' && u.verlassen.n === 1;
      return { titel, menue, lobby, optionen, modus: modus && modusZu, esc: esc && escTitel, einladung: cur && angenommen && abgelehnt && neuer };
    };
    const r = ui(api);
    p(r.titel, 'Tasten Titel: O Optionen, H und ? Hilfe, Enter → Hauptmenü');
    p(r.menue, 'Tasten Hauptmenü: Ziffer wählt, U Tutorial-Merker (sendet nichts), F Weltstandliste, Pfeile, Enter bestätigt');
    p(r.lobby, 'Tasten Lobby: U Modus der Runde, Enter bereit, Ziffer Farbe, L Link, F Liste, H und ? Hilfe');
    p(r.optionen, 'Tasten Lobby (Wellen Boden): K Karte, W Waffe');
    p(r.modus, 'Tasten Lobby: M öffnet die Moduswahl, Esc schließt sie');
    p(r.esc, 'Tasten Lobby: Esc → Hauptmenü und „bereit“ zurück, Esc → Titel');
    p(r.einladung, 'Tasten Einladung: Ziffer/Pfeil wählt, N legt neu an (eine Action), Enter an Bord, Esc lehnt ab und verlässt den Raum');
    p(!/synchronisiere/.test(quelleUi.replace(/\/\/.*$/gm, '')), 'K2: menue-ui.js ruft synchronisiere nicht (Zeichnen ohne Seiteneffekt)');
    p(!/Charaktere\.neuAnlegen|openKammer\(\); *if/.test(quelleUi), 'K1: menue-ui.js verkettet keine Actions mehr für N'); }

  // ---- 13 CHA-01 G: Designer-Review des Startmenüs
  { // 1 Bereit-Knopf: abgeleiteter Zustand
    const F = neu(api).F, nicht = F.bereitAnzeige({ ready: false }), ja = F.bereitAnzeige({ ready: true });
    p(nicht.art === 'gold' && nicht.kappe === 'Enter' && nicht.text === 'Bereit melden' && !nicht.bereit, 'G1: nicht bereit → goldener Hauptknopf, Kappe Enter, „Bereit melden“');
    p(ja.art === 'mint' && ja.titel === 'BEREIT' && ja.zeile === 'Enter: zurück' && ja.bereit, 'G1: bereit → mintfarbene Fläche „BEREIT“ mit „Enter: zurück“');
    p(F.bereitAnzeige(null).art === 'gold' && F.bereitAnzeige(undefined).art === 'gold', 'G1: ohne eigenen Spieler (noch nicht im Raum) gilt „nicht bereit“'); }
  { // 4 Titel-Skala und Lobby-Kopf
    const F = neu(api).F, lobbyT = (t) => F.titelUmbruch(t, BR, 400, [3, 2]), detailT = (t) => F.titelUmbruch(t, BR, 220, [2]);
    p(lobbyT('SZENARIO-LABOR').skala === 3 && lobbyT('SZENARIO-LABOR').zeilen.length === 1, 'G4: „SZENARIO-LABOR“ steht in der Lobby in Skala 3 auf einer Zeile');
    const lang = lobbyT('DIE SCHULD DER LERCHE UND NOCH EIN SEHR LANGER ZUSATZ'), mittel = lobbyT('DIE SCHULD DER LERCHE UND EIN ZUSATZ');
    p(lang.skala === 2 && lang.zeilen.length === 2 && mittel.skala >= 2, 'G4: ein sehr langer Lobby-Titel fällt auf Skala 2 und bricht zweizeilig um, nie auf Skala 1 (Skala ' + lang.skala + ', ' + lang.zeilen.length + ' Zeilen)');
    const d = detailT('DIE SCHULD DER LERCHE'), k = detailT('FREIE FAHRT SUND');
    p(d.skala === 2 && d.zeilen.length === 2 && d.zeilen.join(' ') === 'DIE SCHULD DER LERCHE' && BR(d.zeilen[0], 2) <= 220, 'G4: „DIE SCHULD DER LERCHE“ bricht in der Detailkachel bei Skala 2 auf zwei Zeilen um (' + d.zeilen.join(' | ') + ')');
    p(k.skala === 2 && k.zeilen.length === 1, 'G4: ein kurzer Titel bleibt einzeilig in Skala 2');
    p(F.titelUmbruch('A B C D E F G H I J K L M N O P', (s) => s.length * 20, 100, [2]).zeilen.length === 2, 'G4: mehr als zwei Zeilen werden auf zwei begrenzt (der Rest hängt an der zweiten)');
    p(F.lobbyKopf(1).satzY === 38 && F.lobbyKopf(1).chipY === 51 && F.lobbyKopf(2).satzY === null && F.lobbyKopf(2).chipY < F.lobbyKopf(1).chipY, 'G4: zwei Titelzeilen → keine Satzzeile, Chips rücken auf'); }
  { // 5 Chips: jede Option jedes Modus sichtbar, „Name: Wert“, keine interne Bezeichner
    const F = neu(api).F, mass = { kappe: (k) => Math.max(13, BR(k) + 7) + 4, text: (s) => BR(s), kuerze: (s, w) => { while (s.length > 1 && BR(s) > w) s = s.slice(0, -1); return s; } };
    const graben = [{ abschnitt: 'a', name: 'Nordwall', varianten: [{ id: '1', name: 'Palisade' }, { id: '2', name: 'Graben' }] }, { abschnitt: 'b', name: 'Mittelstück', varianten: [{ id: '1', name: 'Tor' }, { id: '2', name: 'Turm' }] }, { abschnitt: 'c', name: 'Südflanke', varianten: [{ id: '1', name: 'Wall' }, { id: '2', name: 'Sumpf' }] }, { abschnitt: 'd', name: 'Hinterland', varianten: [{ id: '1', name: 'Wiese' }] }];
    const worst = () => 'WWWWWWWWWWWWWWWWWWWWWWWW', gesehen = [];
    for (const modus of Protocol.LOBBY_MODI) {
      const lob = { startMission: modus, worlds: [], laborAn: true, grabenListe: graben, laborListe: [{ id: 'x' }], labor: { id: 'x' } };
      const soll = F.optionenFuer(modus, lob, null).filter((o) => !o.versteckt), chips = F.lobbyChips(modus, lob, null, worst), lay = F.chipReihen(chips, mass, { maxB: 404, maxReihen: 2 });
      const platziert = lay.reihen.flat();
      const alle = soll.every((o) => platziert.some((c) => c.taste === o.taste && c.name === o.label)) && (platziert[0] || {}).taste === 'M';
      p(alle && lay.anzahl === chips.length && chips.length === soll.length + 1, 'G5: ' + modus + ': „M“ und alle ' + soll.length + ' Zusatzoptionen stehen als Chip da, keine fehlt');
      p(lay.reihen.length <= 2 && lay.ueberlauf === 0, 'G5: ' + modus + ': höchstens zwei Chip-Reihen bei längstem Wert (' + lay.reihen.length + ')');
      p(platziert.every((c) => c.x + c.w <= 404 + 0.5), 'G5: ' + modus + ': kein Chip ragt über die Textzone hinaus');
      gesehen.push(modus);
    }
    p(gesehen.length === Protocol.LOBBY_MODI.length, 'G5: alle ' + Protocol.LOBBY_MODI.length + ' Modi geprüft');
    const labor = F.lobbyChips('labor', { laborListe: [] }, null, () => 'x'), namen = labor.map((c) => c.name);
    p(namen.includes('Unverwundbar') && !namen.includes('god') && labor.every((c) => c.wert == null || !String(c.name).includes(':')), 'G5: Labor: „Unverwundbar“ statt „god“, Name und Wert getrennt („Name: Wert“)');
    const lw = { startMission: 'labor', worlds: [], laborListe: [] }, tut = F.lobbyChips('eisenwald_ohne', lw, null, () => 'aus').find((c) => c.taste === 'U');
    p(tut && tut.name === 'Tutorial' && tut.wert === 'aus', 'G5: Eisenwald: Chip „Tutorial: aus“ (Name Tutorial, Wert aus)');
    const wb = F.lobbyChips('arena_away', {}, null, (o) => (o.aktion === 'lobbyWaffe' ? 'Blaster' : 'Station')); p(wb.find((c) => c.taste === 'K').name === 'Karte' && wb.find((c) => c.taste === 'W').wert === 'Blaster', 'G5: Wellen Boden: „Karte: Station“, „Waffe: Blaster“');
    const kl = F.chipReihen([{ taste: 'M', name: 'Modus ändern (alle)', wert: null }].concat(Array.from({ length: 5 }, (_, i) => ({ taste: 'R', name: 'Option' + i, wert: 'WWWWWWWWWWWWWWWWWWWWWWWW' }))), mass, { maxB: 404, maxReihen: 2 });
    p(kl.reihen.length <= 2 && kl.reihen.flat().length === 6 && kl.reihen.flat().every((c) => c.wert == null || BR(c.wert) < BR('WWWWWWWWWWWWWWWWWWWWWWWW')), 'G5: reicht der Platz nicht, werden Werte gekürzt statt Optionen verworfen');
    // Abschnitte ohne Taste: Text, nichts geht verloren
    const ga = F.grabenAbschnitte({ grabenListe: graben.concat([{ abschnitt: 'e', name: 'Ostrand', varianten: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] }]), graben: { b: '2' } });
    p(ga.wahl.length === 3 && ga.wahl.map((w) => w.taste[0]).join('') === 'KNB' && ga.wahl.length + ga.texte.length === 5, 'G5: Grabenangriff: jeder Abschnitt hat eine Taste (K N B) oder steht als Text (' + ga.wahl.length + ' + ' + ga.texte.length + ' von 5)');
    p(ga.texte.includes('Hinterland: Wiese') && ga.texte.some((t) => /^Ostrand: /.test(t)), 'G5: Grabenangriff: Abschnitte ohne Taste stehen als „Name: Variante“ im Satz');
    // Satzzeile: der Stand bleibt, die Beschreibung entfällt zuerst, nie ein halbes Wort
    const sz = F.satzZeile(['Wiese: mit Graben', 'Wald: Weg durch den Wald', 'Römische Stellung angreifen und halten, bis alle Gräben genommen sind'], BR, 260);
    p(sz === 'Wiese: mit Graben · Wald: Weg durch den Wald' && F.satzZeile(['A sehr lang'.repeat(30), 'B'], BR, 100) === 'A sehr lang'.repeat(30) && F.satzZeile(['', 'x'], BR, 10) === 'x', 'G5: Satzzeile: Teile entfallen von hinten (' + sz + '), der erste bleibt immer');
    // Laborsatz
    const lesbar = { ort: (id) => ({ splitter: 'Splittergürtel' }[id] || id), karte: (k) => ({ aussenposten: 'Außenposten', station: 'Station', schiff: 'Schiff' }[k] || k) };
    const le = { id: 'ausbruch/z', name: 'Aus der Zelle, raus (Start: gefangen)', ort: 'splitter', landepunkt: 'splitter.schuerflager', kartenarten: ['aussenposten', 'station', 'schiff'], startzustand: 'gefangen' };
    const s1 = F.laborSatz(le, lesbar), s2 = F.laborSatz(Object.assign({}, le, { name: 'Aus der Zelle, raus' }), lesbar);
    p((s1.match(/gefangen/g) || []).length === 1 && (s2.match(/gefangen/g) || []).length === 1, 'G5: Labor: „Start: gefangen“ steht nur einmal (im Namen oder angehängt)');
    p(/Splittergürtel/.test(s1) && !/schuerflager|aussenposten|\./.test(s1.replace(/u\. a\./, '')), 'G5: Labor: Ort lesbar, keine internen Bezeichner (' + s1 + ')'); }
  { // 6 Einladung: Zählung ohne sich selbst
    const F = neu(api).F, sp = [{ id: 'a', connected: true }, { id: 'b', connected: true }, { id: 'c', connected: false }, { id: 'ich', connected: true }];
    const b = F.einladungBesatzung(sp, 'ich'); p(b.n === 2 && b.text === '2 an Bord + du' && b.andere.every((x) => x.id !== 'ich'), 'G6: Einladung zählt ohne sich selbst und ohne Getrennte: „2 an Bord + du“');
    p(F.einladungBesatzung([{ id: 'ich', connected: true }], 'ich').text === 'nur du', 'G6: allein: „nur du“'); }
  { // 7 Moduswahl: aktiver Modus
    const t = neu(api), F = t.F, lob = { startMission: 'eisenwald_ohne', worlds: [] }; F.starte({ direkt: true }); F.synchronisiere(lob);
    const ew = F.eintragMitId('eisenwald'), fd = F.eintragMitId('freie_fahrt');
    p(!F.eintragAktiv(ew, lob), 'G7: ohne offene Moduswahl trägt kein Eintrag „aktiv“');
    F.oeffneModusWahl(lob); p(F.eintragAktiv(ew, lob) && !F.eintragAktiv(fd, lob), 'G7: Moduswahl offen: nur der Eintrag des Lobby-Modus (Eisenwald ohne Tutorial) ist aktiv');
    const lw = { startMission: 'freie_fahrt', world: 'w2', worlds: WELTEN }; p(F.eintragAktiv(F.eintragMitId('fortsetzen'), lw) && !F.eintragAktiv(fd, lw), 'G7: bei gewähltem Weltstand ist „Fortsetzen“ aktiv'); }
  { // 8 Titel Eisenwald
    const F = neu(api).F;
    p(F.modusTitel('eisenwald') === 'Kampagne Eisenwald' && F.modusTitel('eisenwald_ohne') === 'Kampagne Eisenwald' && F.eintragTitel(F.eintragMitId('eisenwald')) === 'Kampagne Eisenwald', 'G8: Eisenwald heißt immer „Kampagne Eisenwald“ (Tutorial-Zustand nur im Chip)');
    p(F.modusTitel('m1') === 'Kampagne' && F.modusTitel('labor') === 'Szenario-Labor' && F.eintragTitel(F.eintragMitId('fortsetzen')) === '', 'G8: andere Titel unverändert, Fortsetzen hat keinen festen Titel'); }
  { // 3 Raumcode-Eingang
    const t = neu(api), F = t.F, voll = { badCode: true, verbunden: true, hatSpieler: false, roomCode: '' };
    p(F.raumcodeEingang({ badCode: false, verbunden: true, hatSpieler: false }) === null && F.raumcodeEingang({ badCode: true, verbunden: true, hatSpieler: true }) === null && F.raumcodeEingang({ badCode: true, verbunden: false, hatSpieler: false }) === null, 'G3: Eingang nur bei badcode, Verbindung und ohne Spieler');
    const e0 = F.raumcodeEingang(voll); p(e0.ueberschrift === 'RAUMCODE' && !e0.abgelehnt && e0.fehler === null && /Gastgeber/.test(e0.satz), 'G3: ohne Ablehnung: „RAUMCODE“, kein Fehlerton');
    F.starte({ link: true }); F.einladungAblehnen();
    const e1 = F.raumcodeEingang(voll); p(e1.ueberschrift === 'EINLADUNG ABGELEHNT' && e1.abgelehnt && e1.fehler === null, 'G3: nach „Einladung ablehnen“: „EINLADUNG ABGELEHNT“, kein „Dieses Schiff ist abgeschlossen“/Fehlerton');
    const e2 = F.raumcodeEingang(Object.assign({}, voll, { roomCode: 'ABCD' })); p(e2.ueberschrift === 'RAUMCODE' && e2.fehler && /Falsch/.test(e2.fehler), 'G3: ein eingegebener, falscher Code zeigt wieder „RAUMCODE“ und den Fehler');
    F.snapshotEingang({ startMission: 'eisenwald', worlds: [] }); p(F.raumcodeEingang(voll).ueberschrift === 'RAUMCODE', 'G3: wieder im Raum (Snapshot): die Ablehnung ist vergessen');
    F.starte({ link: true }); F.einladungAblehnen(); F.starte({}); p(!F.raumcodeEingang(voll).abgelehnt, 'G3: ein Neustart des Menüs vergisst die Ablehnung'); }
  { // 11 Kammer-Hauptknopf je Herkunft
    const F = neu(api).F, text = (o) => { F.starte(o); return F.kammerKnopfText(); };
    p(text({}) === 'Zum Titel', 'G11: aus dem Titel geöffnet: „Zum Titel“, nicht „In die Lobby“');
    F.weiter(); p(F.kammerKnopfText() === 'Zum Hauptmenü', 'G11: aus dem Hauptmenü geöffnet: „Zum Hauptmenü“');
    p(text({ direkt: true }) === 'In die Lobby' && text({ link: true }) === 'Zur Einladung', 'G11: aus der Lobby „In die Lobby“, aus der Einladung „Zur Einladung“'); }
  { // 10 Texte und Stempel
    const hinweise = Object.values(Protocol.START_HINTS);
    p(Protocol.START_HINTS.freie_fahrt === 'Rom gegen Germanen, die Welt tickt mit.', 'G10: Freie Fahrt Sund: „Rom gegen Germanen, die Welt tickt mit.“ (ohne „Sund:“, mit Punkt)');
    p(hinweise.every((h) => !/Taste|↑|↓|&|solo|\bok\b/i.test(h)), 'G10: keine Tasten-Klartexte, kein „&“, kein „solo ok“ in den Modushinweisen');
    p(TOKENS.TOKENS.STEMPEL.anBord.wort === 'BEREIT', 'G9: Stempel anBord heißt „BEREIT“ (Schlüssel bleibt)');
    p(PKT.TOKENS.TEXT.nameIstSpieler === 'Name = Charaktername' && api.TEXT.einladung.nameCharakter === 'Name = Charaktername', 'G11: einheitlich „Name = Charaktername“ in Kammer und Einladung'); }
  { // 6 Quelltext der Oberfläche: kein „GEWÄHLT“, Eisenwald-Titel nur über die Action
    const q = fs.readFileSync(QUELLE_UI, 'utf8').replace(/\/\/.*$/gm, '');
    p(!/lobby.gewaehlt|GEWÄHLT/i.test(q), 'G6: die Einladung zeigt kein „GEWÄHLT“, nur der Cursor bestimmt');
    p(/cursorRahmen/.test(q) && /MM\.cursor/.test(q), 'G6: der Einladungs-Cursor hat den Doppelrand der Kleiderkammer (MASS.cursor)'); }
  { // 2 Porträt-Platte (kammer-bausteine.js): nie ein Standardkopf als Platzhalter
    const quelleB = fs.readFileSync(QUELLE_BAUSTEINE, 'utf8');
    const lauf = (moeglich, bild) => {
      const z = { fill: 0, bild: 0, teil: 0 }, ctx = { fillStyle: '', fillRect() { z.fill++; }, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, drawImage() { z.bild++; } };
      const win = { KammerBild: { moeglich: () => moeglich, bild: () => bild }, Charaktere: { teil: () => { z.teil++; return { vorschau: 'v.png' }; } } };
      function Bild() { this.complete = true; this.naturalWidth = 10; this.width = 10; this.height = 10; }
      new Function('window', 'Image', 'Charaktere', quelleB)(win, Bild, win.Charaktere);
      win.KammerBausteine.portraetIn(ctx, { x: 0, y: 0, w: 20, h: 20 }, { gesicht: 'x' }, '#000'); return z;
    };
    const wartet = lauf(true, null), fertig = lauf(true, { width: 10, height: 10 }), ohne3d = lauf(false, null);
    p(wartet.fill === 1 && wartet.bild === 0 && wartet.teil === 0, 'G2: Live-Porträt noch nicht fertig: nur die neutrale Platte, kein Standardkopf (keine Gesichtsvorschau, kein Bild)');
    p(fertig.bild === 1, 'G2: ist das Live-Porträt da, wird genau dieses gezeichnet');
    p(ohne3d.teil === 1, 'G2: nur ohne WebGL (Live-Bilder unmöglich) greift die Gesichtsvorschau des Katalogs'); }

  return schlecht;
}

section('Menü-Zustand und -Regeln', () => pruefe(modul(fs.readFileSync(QUELLE, 'utf8')), true));

section('Labor-Schalter bleibt prüfbar', () => {
  ok(CONFIG.lobby && CONFIG.lobby.labor === true, 'CONFIG.lobby.labor Standard an (alle sehen das Szenario-Labor)');
  const g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const c = { inbox: [], send(x) { this.inbox.push(x); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M0', name: 'M0', color: 0 });
  g.step();
  const snap = g.snapshot();
  ok(snap.lobby && snap.lobby.laborAn === true, 'Snapshot der Lobby meldet laborAn: true ohne Server-Einstellung');
});

// ---------------------------------------------------------------- Mutationsproben: die Regel wird im Quelltext zerstört, der Test muss rot werden
section('Mutationsproben (Regeln im Quelltext zerstören)', () => {
  const quelle = fs.readFileSync(QUELLE, 'utf8');
  const muta = [
    ['Sternenschicht-Modi ohne Debug sichtbar', "if (e.gruppe === 'debug' && !dbg) return false;", 'if (false) return false;'],
    ['Einladungslink beginnt mit dem Titel statt der Einladung', "o.link ? 'einladung'", "o.link ? 'titel'"],
    ['synchronisiere überschreibt den Tutorial-Merker jeden Frame (S1)', 'if (mode !== store.lobbyModus) {', 'if (true) {'],
    ['Tutorial-Merker schaltet nichts um (S1)', 'function schalteTutorialMerker() { store.tutorial = !store.tutorial;', 'function schalteTutorialMerker() { store.tutorial = store.tutorial;'],
    ['Esc nimmt „bereit“ nicht zurück', 'if (ich && ich.ready) senden({ t: READY(), ready: false });', 'if (ich && ich.ready) { /* nichts */ }'],
    ['Einladung ablehnen verlässt den Raum nicht (S2)', 'const verlassen = !!(opt.verlasseRaum && opt.verlasseRaum());', 'const verlassen = false;'],
    ['kein sichtbarer Modus beim Eintritt (K2)', 'if (!s.length || (e && s.some((x) => x.id === e.id))) return', 'if (true) return'],
    ['Weltstand voll wird nicht erkannt', 'voll: !!(lob && lob.worldsFull) || n >= max,', 'voll: false,'],
    ["Moduswahl bleibt nach Weltstandwahl offen (K3)", "function weltstandGewaehlt() { return store.schirm === 'menue' ? imRaum() : schliesseModusWahl(); }", "function weltstandGewaehlt() { return store.schirm === 'menue' ? imRaum() : { ok: true }; }"],
    ['Snapshot im Titel führt das Menü nach (K2)', "if (store.schirm !== 'menue' && store.schirm !== 'lobby') return { ok: false };", 'if (false) return { ok: false };'],
    ['N in der Einladung öffnet die Kammer nicht (K1)', "if (!(opt.oeffneKammer && opt.oeffneKammer())) return { ok: false, grund: 'kammer' };", ''],
    ['Direkteintritt sichert den Modus nicht (Prüfer 10)', "if (store.modusPruefen && store.schirm === 'lobby' && lob) {", 'if (false) {'],
    ['Modus-Prüfung läuft bei jedem Snapshot (Prüfer 10)', 'store.modusPruefen = false; sichtbarenModusSichern(lob);', 'sichtbarenModusSichern(lob);'],
    ['Webdriver beginnt nicht in der Lobby', "|| p.webdriver) return", ") return"],
    ['G1 Bereit-Zustand wird nicht abgeleitet', 'if (ich && ich.ready) return { bereit: true', 'if (false) return { bereit: true'],
    ['G4 Titel bricht nie um', 'if (mass(titel, sk) <= maxB) return', 'if (true) return'],
    ['G5 Chips: die letzte Reihe geht verloren', 'if (r.length) reihen.push(r);', ''],
    ['G5 Grabenabschnitte ohne Taste gehen verloren', "else texte.push((a.name || TEXT.opt.abschnitt) + ': ' + (v ? v.name : TEXT.opt.leer));", 'else { /* verloren */ }'],
    ['G5 Labor „Start“ doppelt', "!String(le.name || '').toLowerCase().includes(String(le.startzustand).toLowerCase())", 'true'],
    ['G5 Satzzeile kürzt nicht von hinten', "while (t.length > 1 && mass(t.join(' · ')) > maxB) t.pop();", 'while (false) t.pop();'],
    ['G6 Einladung zählt sich selbst mit', 'verbunden(spieler).filter((p) => p.id !== pid)', 'verbunden(spieler)'],
    ['G7 Überlagerung kennzeichnet auch ohne Moduswahl', 'return !!(store.modusOffen && e && a && a.id === e.id);', 'return !!(e && a && a.id === e.id);'],
    ['G8 Eisenwald-Titel hängt am Tutorial', 'return e && e.modi.length ? eintragTitel(e) : START_LABEL(modus);', 'return START_LABEL(modus);'],
    ['G3 Ablehnung ändert den Raumcode-Eingang nicht', 'const abgelehnt = store.abgelehnt && !p.roomCode;', 'const abgelehnt = false;'],
    ['G11 Kammer-Hauptknopf kennt die Herkunft nicht', 'return TEXT.kammer[store.schirm] || TEXT.kammer.lobby;', 'return TEXT.kammer.lobby;'],
  ];
  for (const [name, von, nach] of muta) {
    ok(quelle.split(von).length === 2, 'Mutation anwendbar (Anker genau einmal): ' + name);
    const schlecht = pruefe(modul(quelle.replace(von, nach)), false);
    ok(schlecht > 0, 'Mutation erkannt (' + schlecht + ' Prüfungen rot): ' + name);
  }
  ok(pruefe(modul(quelle), false) === 0, 'unveränderter Quelltext besteht still');
});

console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
