'use strict';
// CHA-01 E: Test des Startmenüs (public/js/menue.js, Zustand und Regeln in Node, ohne Browser).
//  1. Gruppierung: jeder Modus aus LOBBY_MODI gehört genau einem Menüeintrag (Eisenwald deckt zwei Modi ab), nichts geht verloren, nichts doppelt.
//  2. Sichtbarkeit: Sternenschicht-Modi (m1, free, m3) nur mit ?debug=1, Labor nur mit lobby.laborAn, Fortsetzen nur mit Weltstand.
//  3. Bildschirmfluss: Titel → Hauptmenü → Lobby, Esc zurück (bereit wird zurückgenommen), Einladungslink überspringt Titel und Hauptmenü, Direktstart in die Lobby, Rückkehr nach der Runde.
//  4. Navigation, Tasten 1–7, Eisenwald-Schalter (Tutorial), Moduswahl-Überlagerung der Lobby.
//  5. Nachrichten: jeder sichtbare Eintrag erzeugt ein lobbyOpt, das der echte Server (Game) annimmt; Wellen Boden/All tragen ihre Kartenwahl, Fortsetzen nur die Welt.
//  6. Crew: Gastgeber = erster verbundener Spieler, Bereit-Zählung.
//  7. Mutationsproben: zwei Regeln werden im Quelltext verändert, der Test muss rot werden (Debug-Sichtbarkeit, Link überspringt Titel).
//   node tools/test-menue.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const QUELLE = path.join(__dirname, '..', 'public', 'js', 'menue.js');

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
  const waehle = [];
  const F = api.erzeuge({
    protokoll: Protocol, senden: (m) => { gesendet.push(m); return true; }, debug: !!o.debug, szenenIds: () => ['s_eins', 's_zwei'],
    charaktere: { MAX: 4, lies: () => wahl, waehle: (id) => { waehle.push(id); wahl.gewaehlt = id; return { ok: true, id }; } },
  });
  return { F, gesendet, waehle, wahl };
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
    F.starte({ link: true }); F.zurueck(null); p(F.lies().schirm === 'menue', 'Esc in der Einladung: Hauptmenü');
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
    F.starte({}); F.weiter(); F.waehleTaste('3', LOB); F.schalteTutorial(null); F.bestaetige(LOB);
    p(t.gesendet.slice(-1)[0].startMission === 'eisenwald_ohne', 'Tutorial-Schalter aus: Eisenwald ohne Tutorial');
    const vor = t.gesendet.length; F.schalteTutorial(LOB); p(t.gesendet.length === vor, 'Schalter im Hauptmenü sendet noch nichts');
    F.schalteTutorial({ startMission: 'eisenwald_ohne' }); p(t.gesendet.slice(-1)[0].startMission === 'eisenwald' && F.lies().tutorial === true, 'in der Lobby bei Eisenwald schaltet U den Lobby-Modus um (jeder darf)');
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
section('Mutationsproben (zwei Regeln)', () => {
  const quelle = fs.readFileSync(QUELLE, 'utf8');
  const muta = [
    ['Sternenschicht-Modi ohne Debug sichtbar', "if (e.gruppe === 'debug' && !dbg) return false;", 'if (false) return false;'],
    ['Einladungslink beginnt mit dem Titel statt der Einladung', "o.link ? 'einladung'", "o.link ? 'titel'"],
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
