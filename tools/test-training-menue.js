'use strict';
// TRA-01 A2: Trainingsmenü – Eintrag TRAINING (Taste T) im Hauptmenü, Unterseite mit fünf Kacheln (Fliegen, Captain startbar; Ops, Technik, Außeneinsatz gesperrt „folgt“),
// Captain-Eingabewahl (Befehlstafel/Tasten oder mit Sprache → lobbyOpt trainingSprache). Zustand und Regeln: public/js/menue.js (Node, ohne Browser), Tastenzuordnung: public/js/menue-ui.js taste().
//   Eintrag     TRAINING, Taste T, Übungsplatz-Gruppe, ohne Debug sichtbar, deckt genau die Trainingsmodi ab; T wählt, Enter öffnet die Unterseite (sendet nichts), Esc schließt sie
//   Kacheln     fünf; drei gesperrt: weder per Taste noch per Klick-Action wählbar, nie startbar; Abzeichen-Stand (Paket C) vorerst false
//   Start       Fliegen/Captain senden Modus wie jeder Menüeintrag und wechseln in die Lobby; Captain trägt die Eingabewahl (Standard false), der echte Server nimmt sie an
//   Lobby       training_captain hat die Option S (Eingabe) als Chip und Taste; Moduswahl der Lobby öffnet dieselbe Unterseite
//   Tasten      Strg/Alt/Meta+Buchstabe/Ziffer startet nichts und wird nicht verbraucht
//   Mutationen  Regeln im Quelltext zerstören, der Test muss rot werden
//   node tools/test-training-menue.js
const fs = require('fs');
const path = require('path');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const TOKENS = require('../public/js/menue-tokens.js');
const QUELLE = path.join(__dirname, '..', 'public', 'js', 'menue.js');
const QUELLE_UI = path.join(__dirname, '..', 'public', 'js', 'menue-ui.js');

let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) { console.log('\n[' + name + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } }
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TRAINING_MODI = ['training_fliegen', 'training_captain'];

function modul(quelltext) { const m = { exports: {} }; new Function('module', 'exports', 'self', quelltext)(m, m.exports, undefined); return m.exports; }
// Menü-Instanz mit Spion für gesendete Nachrichten; mit quelleUi zusätzlich die echte Tastenzuordnung (taste()) mit protokollierten Actions
function neu(api, quelleUi) {
  const gesendet = [], log = [];
  const F = api.erzeuge({ protokoll: Protocol, senden: (m) => { gesendet.push(m); return true; }, debug: false, szenenIds: () => [], weltstandMax: 5, verlasseRaum: () => true, oeffneKammer: () => true, charaktere: null });
  const t = { F, gesendet, log, lob: { startMission: 'm1', worlds: [], laborAn: true } };
  if (quelleUi) {
    const win = { Render: {}, Pult: {}, Menue: TOKENS, MenueFluss: F, Hud: {}, Net: { serverRoomCode: 'AB' }, Tasten: { passt: (e, id) => id === 'allgemein.hilfe' && e.key === '?' } };
    new Function('window', 'Net', 'Tasten', quelleUi)(win, win.Net, win.Tasten);
    const A = { sfx: (s) => { log.push('sfx:' + s); } };
    for (const a of ['openOptions', 'openHilfe', 'openKammer', 'openWorlds', 'toggleReady', 'setColor', 'toggleTrainingSprache', 'toggleLiveSpielleiter']) A[a] = (x) => { log.push(a + (x !== undefined ? ':' + x : '')); };
    t.view = { actions: A, pid: 'p1', state: { lobby: t.lob, players: [{ id: 'p1', name: 'A', ready: false, connected: true, color: 0 }] } };
    t.druecke = (code, extra) => win.MenueUi.taste(Object.assign({ code, key: code, repeat: false }, extra || {}), t.view);
  }
  return t;
}
const imMenue = (t) => { t.F.starte({}); t.F.weiter(); t.F.synchronisiere(t.lob); return t; };
const imTraining = (t) => { imMenue(t); t.druecke('KeyT'); t.druecke('Enter'); t.gesendet.length = 0; t.log.length = 0; return t; };

function pruefe(api, quelleUi, laut) {
  let schlecht = 0;
  const p = (c, msg) => { if (laut) ok(c, msg); else if (!c) schlecht++; };

  // ---- Eintrag im Hauptmenü
  { const t = imMenue(neu(api, quelleUi)), F = t.F, e = F.eintragMitId('training');
    p(!!e && e.taste === 'T' && e.gruppe === 'uebung' && e.unterseite === 'training', 'Eintrag TRAINING: Taste T, Gruppe Übungsplatz, öffnet eine Unterseite');
    p(gleich(e.modi, TRAINING_MODI) && F.eintragZuModus('training_fliegen').id === 'training' && F.eintragZuModus('training_captain').id === 'training', 'der Eintrag deckt genau die zwei Trainingsmodi ab');
    p(F.sichtbar(t.lob).some((x) => x.id === 'training'), 'ohne Debug und ohne Weltstand sichtbar');
    p(F.eintragTitel(e) === 'Training' && F.modusTitel('training_fliegen') === 'Training Fliegen' && F.modusTitel('training_captain') === 'Training Captain', 'Titel: Eintrag „Training“, Lobby zeigt „Training Fliegen“/„Training Captain“');
    p(F.modusVon(e) === null && F.nachrichtFuer(e, t.lob) === null, 'der Eintrag ist selbst kein Modus und erzeugt keine Nachricht');
    const sicht = F.gruppen(t.lob).find((g) => g.id === 'uebung').eintraege.map((x) => x.id);
    p(sicht[sicht.length - 1] === 'training', 'TRAINING steht am Ende der Übungsplatz-Gruppe (' + sicht.join() + ')');
    // Tasten
    p(t.druecke('KeyT') === true && F.lies().auswahl === 'training', 'T wählt den Eintrag (wie S die Forschungsstation)');
    p(!F.lies().unterseite && !t.gesendet.length, 'T allein öffnet noch nichts');
    t.druecke('Enter');
    p(F.lies().unterseite === 'training' && F.lies().schirm === 'menue' && F.unterseiteOffen() && !t.gesendet.length, 'Enter öffnet die Unterseite: Hauptmenü bleibt der Schirm, nichts wird gesendet');
    t.druecke('Escape');
    p(!F.lies().unterseite && F.lies().schirm === 'menue', 'Esc schließt die Unterseite und führt ins Hauptmenü (nicht in den Titel)');
    t.druecke('Escape');
    p(F.lies().schirm === 'titel', 'ein zweites Esc geht wie gewohnt zum Titel');
    // Klick auf den Eintrag = waehleEintragId, Enter-Knopf der Detailkachel = bestaetige
    const t2 = imMenue(neu(api, quelleUi)); t2.F.waehleEintragId('training', t2.lob); const r = t2.F.bestaetige(t2.lob);
    p(r.ok && r.unterseite === 'training' && t2.F.lies().unterseite === 'training', 'bestaetige (Knopf „Training öffnen“) öffnet die Unterseite'); }

  // ---- Kacheln
  { const F = neu(api, quelleUi).F, ks = F.trainingKacheln();
    p(ks.map((k) => k.id).join() === 'fliegen,captain,ops,technik,aussen', 'fünf Kacheln: Fliegen, Captain, Ops, Technik, Außeneinsatz');
    p(ks.filter((k) => k.startbar).map((k) => k.id).join() === 'fliegen,captain' && ks.filter((k) => k.gesperrt).map((k) => k.id).join() === 'ops,technik,aussen', 'Fliegen und Captain startbar, Ops/Technik/Außeneinsatz gesperrt');
    p(ks.every((k) => k.startbar !== k.gesperrt) && ks.filter((k) => k.gesperrt).every((k) => !k.modus), 'gesperrte Kacheln haben keinen Modus, keine ist beides');
    p(ks.filter((k) => k.startbar).every((k) => Protocol.LOBBY_MODI.includes(k.modus)) && gleich(ks.filter((k) => k.startbar).map((k) => k.modus), TRAINING_MODI), 'startbare Kacheln tragen Modi aus LOBBY_MODI');
    p(new Set(ks.map((k) => k.taste)).size === 5 && ks.every((k) => F.TEXT.training.kacheln[k.id] && F.TEXT.training.kacheln[k.id].name), 'Tasten 1–5 eindeutig, jede Kachel hat Name und Zeile');
    p(F.TEXT.training.folgt === 'folgt', 'Beschriftung gesperrter Kacheln: „folgt“');
    p(ks.every((k) => k.abzeichen === false) && F.abzeichenStand('fliegen') === false && F.abzeichenStand('captain') === false, 'Abzeichen-Stand (Paket C): vorerst für alle Kacheln false');
    const ohne = api.erzeuge({ protokoll: { LOBBY_MODI: ['m1'] }, senden: () => true, debug: false });
    p(ohne.trainingKacheln().every((k) => k.gesperrt), 'kennt das Protokoll die Trainingsmodi nicht, ist alles gesperrt (startbar nur mit Lobby-Modus)'); }

  // ---- Auswahl und Sperre
  { const t = imTraining(neu(api, quelleUi)), F = t.F;
    p(F.lies().trainingAuswahl === 'fliegen' && F.trainingGewaehlt().id === 'fliegen', 'Unterseite beginnt bei Fliegen');
    t.druecke('ArrowRight'); p(F.trainingGewaehlt().id === 'captain', 'Pfeil rechts: Captain');
    t.druecke('ArrowRight'); p(F.trainingGewaehlt().id === 'fliegen' && F.lies().trainingAuswahl === 'fliegen', 'Pfeil rechts springt über die gesperrten Kacheln zurück zu Fliegen');
    t.druecke('ArrowLeft'); p(F.trainingGewaehlt().id === 'captain', 'Pfeil links: Captain (nur startbare Kacheln)');
    t.druecke('Digit1'); p(F.trainingGewaehlt().id === 'fliegen', 'Ziffer 1 wählt Fliegen');
    t.druecke('Digit2'); p(F.trainingGewaehlt().id === 'captain', 'Ziffer 2 wählt Captain');
    for (const [code, id] of [['Digit3', 'ops'], ['Digit4', 'technik'], ['Digit5', 'aussen'], ['Numpad3', 'ops']]) {
      t.druecke('Digit2'); t.gesendet.length = 0;
      const verbraucht = t.druecke(code);
      p(verbraucht === true && F.trainingGewaehlt().id === 'captain' && F.lies().trainingAuswahl === 'captain', 'Taste ' + code + ' (' + id + ' gesperrt): Auswahl bleibt, nichts wählbar');
      t.druecke('Enter'); p(!t.gesendet.some((m) => m.startMission === undefined || !TRAINING_MODI.includes(m.startMission)), 'Taste ' + code + ' + Enter startet keine gesperrte Kachel');
      imTraining(t); }
    // Klick-Weg (die Kachel ruft trainingWaehleId): gesperrt → abgewiesen, ohne Wirkung
    for (const id of ['ops', 'technik', 'aussen']) { const r = F.trainingWaehleId(id); p(!r.ok && r.grund === 'gesperrt' && F.lies().trainingAuswahl !== id, 'Klick auf ' + id + ' (gesperrt): abgewiesen, Auswahl unverändert'); }
    p(F.trainingWaehleId('captain').ok && F.lies().trainingAuswahl === 'captain', 'Klick auf eine startbare Kachel wählt sie');
    // auch ein manipulierter Zustand startet nie eine gesperrte Kachel
    F.lies().trainingAuswahl = 'ops'; t.gesendet.length = 0;
    const g = F.trainingGewaehlt(); p(g && g.startbar, 'selbst bei Auswahl „ops“ im Store gilt nur eine startbare Kachel');
    p(F.trainingNachricht(F.trainingKacheln().find((k) => k.id === 'ops')) === null && F.trainingNachricht(F.trainingKacheln().find((k) => k.id === 'aussen')) === null, 'für gesperrte Kacheln gibt es keine Lobby-Nachricht'); }

  // ---- Start Fliegen
  { const t = imTraining(neu(api, quelleUi)), F = t.F;
    t.druecke('Digit1'); t.druecke('Enter');
    p(gleich(t.gesendet, [{ t: 'lobbyOpt', startMission: 'training_fliegen', world: null }]), 'Fliegen: sendet nur Modus und world:null (wie jeder Menüeintrag, keine Sprachwahl)');
    p(F.lies().schirm === 'lobby' && !F.lies().unterseite && !F.lies().modusOffen && F.lies().auswahl === 'training', 'danach Lobby, Unterseite zu, Eintrag TRAINING bleibt der gewählte');
    const t2 = imTraining(neu(api, quelleUi)); t2.druecke('Digit1'); const r = t2.F.trainingStarte();
    p(r.ok && r.modus === 'training_fliegen' && r.sprache === null, 'trainingStarte (Knopf) für Fliegen: Modus training_fliegen, keine Sprache'); }

  // ---- Captain: Eingabewahl
  { const t = imTraining(neu(api, quelleUi)), F = t.F;
    t.druecke('Digit2');
    p(F.lies().trainingSprache === false && F.trainingSprachwahl().map((o) => o.aktiv).join() === 'true,false', 'Standard: Befehlstafel/Tasten');
    p(F.TEXT.training.tafel === 'Befehlstafel/Tasten' && F.TEXT.training.sprache === 'mit Sprache', 'Beschriftung: „Befehlstafel/Tasten“ und „mit Sprache“');
    t.druecke('Enter');
    p(gleich(t.gesendet, [{ t: 'lobbyOpt', startMission: 'training_captain', world: null, trainingSprache: false }]) && F.lies().schirm === 'lobby', 'Captain ohne Wahl: trainingSprache false wird mitgesendet, Lobby');
    const t2 = imTraining(neu(api, quelleUi)); t2.druecke('Digit2'); t2.druecke('KeyS');
    p(t2.F.lies().trainingSprache === true && !t2.gesendet.length, 'S schaltet auf „mit Sprache“ (Merker, sendet noch nichts)');
    p(t2.F.trainingSprachwahl().map((o) => o.aktiv).join() === 'false,true', 'die Chips zeigen „mit Sprache“ aktiv');
    t2.druecke('Enter');
    p(gleich(t2.gesendet, [{ t: 'lobbyOpt', startMission: 'training_captain', world: null, trainingSprache: true }]), 'Captain mit Sprache: trainingSprache true im lobbyOpt');
    const t3 = imTraining(neu(api, quelleUi)); t3.druecke('Digit2'); t3.F.setzeTrainingSprache(true); t3.F.setzeTrainingSprache(false); t3.F.setzeTrainingSprache(true);
    p(t3.F.lies().trainingSprache === true && t3.F.trainingStarte().sprache === true, 'Klick auf die Chips (setzeTrainingSprache) setzt die Wahl');
    const t4 = imTraining(neu(api, quelleUi)); t4.druecke('Digit1'); const r = t4.F.setzeTrainingSprache(true);
    p(!r.ok && r.grund === 'keine-sprachwahl' && t4.F.lies().trainingSprache === false, 'bei Fliegen gibt es keine Eingabewahl (S/Klick ohne Wirkung)');
    t4.druecke('KeyS'); p(t4.F.lies().trainingSprache === false, 'S bei Fliegen schaltet nichts um');
    // Wahl bleibt beim Wechsel der Kachel; beim erneuten Öffnen aus einer Captain-Lobby gilt deren Zustand
    const t5 = imTraining(neu(api, quelleUi)); t5.druecke('Digit2'); t5.druecke('KeyS'); t5.druecke('Digit1'); t5.druecke('Digit2');
    p(t5.F.lies().trainingSprache === true, 'die Eingabewahl bleibt beim Hin- und Herwechseln der Kachel');
    t5.F.starte({}); t5.F.weiter(); t5.F.waehleEintragId('training', t5.lob); t5.F.bestaetige({ startMission: 'training_captain', trainingSprache: false });
    p(t5.F.lies().trainingSprache === false, 'aus einer Captain-Lobby geöffnet gilt deren Eingabewahl'); }

  // ---- der echte Server nimmt Modus und Eingabewahl aus der Kachel an
  { for (const sprache of [false, true]) {
      const t = imTraining(neu(api, quelleUi)); t.druecke('Digit2'); if (sprache) t.druecke('KeyS'); t.druecke('Enter');
      const g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
      const c = { inbox: [], send(x) { this.inbox.push(x); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'T0', color: 0 });
      g.handleMessage(c, t.gesendet[0]);
      p(g.lobbyOpts.startMission === 'training_captain' && g.lobbyOpts.trainingSprache === sprache, 'Server: Captain-Kachel ergibt training_captain, trainingSprache ' + sprache); }
    const t = imTraining(neu(api, quelleUi)); t.druecke('Digit1'); t.druecke('Enter');
    const g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
    const c = { inbox: [], send(x) { this.inbox.push(x); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T1', name: 'T1', color: 0 }); g.handleMessage(c, t.gesendet[0]);
    p(g.lobbyOpts.startMission === 'training_fliegen' && g.lobbyOpts.trainingSprache === false, 'Server: Fliegen-Kachel ergibt training_fliegen ohne Sprache'); }

  // ---- Lobby: Option S, Moduswahl
  { const t = imMenue(neu(api, quelleUi)), F = t.F;
    const o = F.optionenFuer('training_captain', {}, null);
    p(o.length === 1 && o[0].taste === 'S' && o[0].code === 'KeyS' && o[0].aktion === 'toggleTrainingSprache' && o[0].label === 'Eingabe', 'training_captain: genau die Option S (Eingabe) in der Lobby');
    p(F.optionenFuer('training_fliegen', {}, null).length === 0, 'training_fliegen: keine Zusatzoption');
    const ch = F.lobbyChips('training_captain', {}, null, (x) => x.aktion);
    p(ch.length === 2 && ch[1].taste === 'S' && ch[1].name === 'Eingabe', 'Chips der Captain-Lobby: „M Modus ändern“ und „S Eingabe“');
    imMenue(t); t.F.waehleEintragId('fliegen', t.lob);
    t.F.lies().schirm = 'lobby'; t.lob.startMission = 'training_captain'; t.log.length = 0;
    t.druecke('KeyS'); p(gleich(t.log, ['toggleTrainingSprache']), 'Lobby (training_captain): S ruft die Action toggleTrainingSprache (lobbyOpt trainingSprache)');
    t.lob.startMission = 'training_fliegen'; t.log.length = 0; t.druecke('KeyS'); t.lob.startMission = 'arena_away'; t.druecke('KeyS');
    p(!t.log.includes('toggleTrainingSprache'), 'in anderen Modi tut S nichts');
    // Moduswahl der Lobby öffnet dieselbe Unterseite
    const u = neu(api, quelleUi); u.F.starte({ direkt: true }); u.lob.startMission = 'training_fliegen'; u.F.synchronisiere(u.lob);
    u.druecke('KeyM'); p(u.F.lies().modusOffen && u.F.lies().auswahl === 'training' && u.F.eintragAktiv(u.F.eintragMitId('training'), u.lob), 'Moduswahl: TRAINING ist der aktive Eintrag, wenn die Lobby ein Training zeigt');
    u.druecke('Enter'); p(u.F.unterseiteOffen() && u.F.lies().schirm === 'lobby' && !u.gesendet.length, 'Enter in der Moduswahl öffnet die Unterseite, sendet nichts');
    u.druecke('Escape'); p(!u.F.unterseiteOffen() && u.F.lies().modusOffen, 'Esc: zurück in die Moduswahl');
    u.druecke('Enter'); u.druecke('Digit2'); u.druecke('Enter');
    p(gleich(u.gesendet, [{ t: 'lobbyOpt', startMission: 'training_captain', world: null, trainingSprache: false }]) && !u.F.lies().modusOffen && !u.F.lies().unterseite && u.F.lies().schirm === 'lobby', 'Start aus der Moduswahl: Modus gesetzt, Überlagerung und Unterseite zu'); }

  // ---- Tasten: Modifikatoren
  { const t = imMenue(neu(api, quelleUi)), F = t.F, vorher = F.lies().auswahl;
    const res = {}; for (const m of ['ctrlKey', 'altKey', 'metaKey']) res[m] = t.druecke('KeyT', { [m]: true });
    p(F.lies().auswahl === vorher && vorher !== 'training' && !F.lies().unterseite && !t.gesendet.length, 'Hauptmenü: Strg/Alt/Meta+T wählt nichts, öffnet nichts, startet nichts');
    p(res.ctrlKey === false && res.altKey === false && res.metaKey === false, 'Hauptmenü: Strg/Alt/Meta+T werden nicht verbraucht (Browser-Kürzel „neuer Tab“ bleibt)');
    t.druecke('KeyT', { shiftKey: true }); p(F.lies().auswahl === 'training', 'Umschalt+T zählt wie T');
    const u = imTraining(neu(api, quelleUi)); u.druecke('Digit2');
    const r2 = {}; for (const m of ['ctrlKey', 'altKey', 'metaKey']) { r2['s' + m] = u.druecke('KeyS', { [m]: true }); r2['z' + m] = u.druecke('Digit1', { [m]: true }); }
    p(Object.values(r2).every((v) => v === false), 'Unterseite: Strg/Alt/Meta+S und +Ziffer werden nicht verbraucht');
    p(u.F.lies().trainingSprache === false && u.F.trainingGewaehlt().id === 'captain' && !u.gesendet.length, 'Unterseite: Strg+S schaltet die Eingabe nicht, Strg+1 wählt nichts, nichts wird gesendet');
    const rep = u.druecke('Enter', { repeat: true }); p(rep === true && !u.gesendet.length && u.F.unterseiteOffen(), 'Unterseite: Enter als Tastenwiederholung startet nichts'); }

  // ---- Zurück, Neustart des Flusses
  { const t = imTraining(neu(api, quelleUi)), F = t.F;
    F.starte({}); p(!F.lies().unterseite, 'starte() schließt eine offene Unterseite');
    const u = imTraining(neu(api, quelleUi)); u.F.imRaum(); p(!u.F.lies().unterseite && u.F.lies().schirm === 'lobby', 'Runde beginnt (imRaum): Unterseite zu');
    const v = imMenue(neu(api, quelleUi)); v.F.lies().unterseite = 'training'; v.F.lies().schirm = 'lobby';
    p(!v.F.unterseiteOffen(), 'eine liegen gebliebene Unterseite erscheint nicht über der Lobby'); }
  return schlecht;
}

const quelle = fs.readFileSync(QUELLE, 'utf8'), quelleUi = fs.readFileSync(QUELLE_UI, 'utf8');
section('Trainingsmenü (Eintrag, Unterseite, Kacheln, Start, Eingabewahl, Tasten)', () => {
  pruefe(modul(quelle), quelleUi, true);
  // Quelltext-Prüfungen (Darstellung): gesperrte Kacheln haben keine Klickfläche, Abzeichen-Platz ist benannt
  const a0 = quelleUi.indexOf('function trainingKachel('), a1 = quelleUi.indexOf('kachelM(c, x, y, w, h); if (an)', a0), gesperrt = quelleUi.slice(a0, a1);
  ok(a0 > 0 && a1 > a0 && /k\.gesperrt/.test(gesperrt) && !/klick\(/.test(gesperrt) && /return;/.test(gesperrt), 'Darstellung: der Zweig der gesperrten Kachel registriert keine Klickfläche');
  ok(/function abzeichenFeld\(/.test(quelleUi) && /function abzeichenStand\(/.test(quelle), 'Paket C: benannter Platz (abzeichenFeld) und Funktion (abzeichenStand) sind da');
});

section('Mutationsproben (Regeln im Quelltext zerstören)', () => {
  const muta = [
    ['menue.js', 'Ops ist startbar', "{ id: 'ops', taste: '3', modus: null }", "{ id: 'ops', taste: '3', modus: 'training_fliegen' }"],
    ['menue.js', 'alle Kacheln gelten als startbar', 'const startbar = !!(k.modus && modi.includes(k.modus));', 'const startbar = true;'],
    ['menue.js', 'gesperrte Kachel ist per Klick/Taste wählbar', 'const k = trainingStartbare().find((x) => x.id === id); if (!k) return', 'const k = trainingKacheln().find((x) => x.id === id); if (!k) return'],
    ['menue.js', 'Cursor springt auch auf gesperrte Kacheln', 'const s = trainingStartbare(); if (!s.length) return { ok: false };\n', 'const s = trainingKacheln(); if (!s.length) return { ok: false };\n'],
    ['menue.js', 'Captain sendet keine Eingabewahl', 'if (k.sprachwahl) msg.trainingSprache = store.trainingSprache === true;', ''],
    ['menue.js', 'Eingabewahl sendet immer true', 'msg.trainingSprache = store.trainingSprache === true;', 'msg.trainingSprache = true;'],
    ['menue.js', 'Enter öffnet die Unterseite nicht', 'if (e.unterseite) return oeffneUnterseite(e, lob);', ''],
    ['menue.js', 'Esc schließt die Unterseite nicht', 'if (unterseiteOffen()) { store.unterseite = null;', 'if (false) { store.unterseite = null;'],
    ['menue.js', 'Start wechselt nicht in die Lobby', "store.schirm = 'lobby'; store.modusOffen = false; store.unterseite = null; store.auswahl = (eintragZuModus", "store.schirm = 'menue'; store.modusOffen = false; store.unterseite = null; store.auswahl = (eintragZuModus"],
    ['menue.js', 'Start sendet nichts', "      senden(msg);\n      store.schirm = 'lobby'; store.modusOffen = false; store.unterseite = null;", "      store.schirm = 'lobby'; store.modusOffen = false; store.unterseite = null;"],
    ['menue.js', 'Eingabewahl schaltet nicht um', 'function schalteTrainingSprache() { return setzeTrainingSprache(!store.trainingSprache); }', 'function schalteTrainingSprache() { return setzeTrainingSprache(store.trainingSprache); }'],
    ['menue.js', 'Eingabewahl auch bei Fliegen', 'if (!(g && g.sprachwahl)) return { ok: false, grund: \'keine-sprachwahl\' };', ''],
    ['menue.js', 'Lobby-Option S fehlt im Captain-Training', "if (modus === 'training_captain') o.push(", "if (modus === 'training_captain_x') o.push("],
    ['menue.js', 'Unterseite überlebt den Start des Flusses', "store.modusOffen = false; store.unterseite = null; store.abgelehnt = false;", "store.modusOffen = false; store.abgelehnt = false;"],
    ['menue.js', 'Unterseite liegt auch über der Lobby', "function unterseiteOffen() { return !!store.unterseite && (store.schirm === 'menue' || (store.schirm === 'lobby' && store.modusOffen)); }", 'function unterseiteOffen() { return !!store.unterseite; }'],
    ['menue.js', 'Training hat die Taste U', "{ id: 'training', taste: 'T',", "{ id: 'training', taste: 'U',"],
    ['menue-ui.js', 'Strg+Taste wird auf der Unterseite verbraucht', 'if (e.ctrlKey || e.altKey || e.metaKey) return false;\n    if (code === \'KeyS\') { tue(\'trainingSprache\'', 'if (code === \'KeyS\') { tue(\'trainingSprache\''],
    ['menue-ui.js', 'Unterseite hat keine eigene Tastenbehandlung', 'if (F.unterseiteOffen()) return trainingTaste(e, view, gemeinsam);', ''],
  ];
  for (const [datei, name, von, nach] of muta) {
    const q = datei === 'menue.js' ? quelle : quelleUi, qn = q.replace(/\r\n/g, '\n');
    ok(qn.split(von).length === 2, 'Mutation anwendbar (Anker genau einmal): ' + name);
    const gemutet = qn.replace(von, nach);
    let schlecht;
    try { schlecht = datei === 'menue.js' ? pruefe(modul(gemutet), quelleUi, false) : pruefe(modul(quelle), gemutet, false); } catch (e) { schlecht = 1; }
    ok(schlecht > 0, 'Mutation erkannt (' + schlecht + ' Prüfungen rot): ' + name);
  }
  ok(pruefe(modul(quelle), quelleUi, false) === 0, 'unveränderter Quelltext besteht still');
});

console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
