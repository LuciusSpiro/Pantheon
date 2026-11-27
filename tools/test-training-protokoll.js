'use strict';
// TRA-01 A1: Protokoll und Tabelle der Trainingsmodi (training_fliegen, training_captain). Keine Partie nötig.
//   node tools/test-training-protokoll.js
//   1  shared/protocol.js: LOBBY_MODI, START_LABELS, START_HINTS; nie in CAMPAIGN_STARTS; START_MISSIONS (eingefroren) ohne sie
//   2  Tabelle TRAININGSMODI (server/sim/training.js): je Modus Buch, Ort (limes, Saumraum), CONSOLE_HELP aus; Sprachwahl nur Captain
//   3  arena.js: KINDS, isArena, istUebungsszene und istTraining (keine Testmarken/Werft-Testumgebung); kein Eintrag in UEBUNG_WELTEN
//   4  Platzhalter-Bücher: gültig (Checker), kopf.art intern, nicht im Angebotsbrett (Katalog-Reihenfolge, Angebote)
const fs = require('fs');
const path = require('path');
const Protocol = require('../shared/protocol.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Training = require('../server/sim/training.js');
const Arena = require('../server/sim/arena.js');
const Checker = require('../server/mission/checker.js');
const Mission = require('../server/sim/mission.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const MODI = ['training_fliegen', 'training_captain'];

console.log('[1 Protokoll]');
for (const m of MODI) {
  ok(Protocol.LOBBY_MODI.includes(m), m + ' steht in LOBBY_MODI');
  ok(!Protocol.CAMPAIGN_STARTS.includes(m), m + ' nie in CAMPAIGN_STARTS (kein Weltstand)');
  ok(!Protocol.START_MISSIONS.includes(m), m + ' nicht in der eingefrorenen Altliste START_MISSIONS');
  ok(typeof Protocol.START_HINTS[m] === 'string' && Protocol.START_HINTS[m].length > 5, m + ' hat einen Hinweistext');
}
ok(Protocol.START_LABELS.training_fliegen === 'Training Fliegen' && Protocol.START_LABELS.training_captain === 'Training Captain', 'Labels: „Training Fliegen“, „Training Captain“');
ok(new Set(Protocol.LOBBY_MODI).size === Protocol.LOBBY_MODI.length, 'LOBBY_MODI ohne Doppelte');
ok(Protocol.LOBBY_MODI.every((m) => Protocol.START_LABELS[m] && Protocol.START_HINTS[m]), 'jeder Lobby-Modus hat Label und Hinweis');

console.log('[2 Tabelle]');
ok(JSON.stringify(Training.KINDS) === JSON.stringify(MODI), 'Tabelle kennt genau die zwei Modi');
for (const m of MODI) {
  const d = Training.TRAININGSMODI[m];
  ok(typeof d.buch === 'string' && /^tra_/.test(d.buch), m + ': Buch ' + d.buch);
  ok(d.consoleHelpAus === true, m + ': CONSOLE_HELP unterdrückt');
  const loc = Locations.get(d.ort), hex = loc && (loc.hex || Sektoren.hexVonOrt(loc.id)), hd = hex && Sektoren.hexDaten(hex);
  ok(!!loc && !!hd && hd.region === 'saumraum', m + ': Startort ' + d.ort + ' (Hex ' + hex + ') liegt im Saumraum');
  ok(Training.istTraining(m), m + ': istTraining');
}
ok(Training.hatSprachwahl('training_captain') && !Training.hatSprachwahl('training_fliegen') && !Training.hatSprachwahl('arena_space'), 'Sprachwahl nur im Captain-Training');
ok(!Training.istTraining('arena_forschung') && !Training.istTraining('m1') && !Training.istTraining(undefined) && !Training.istTraining('toString'), 'istTraining: andere Modi, undefined und Object-Namen sind keins');
ok(Sektoren.hexDaten(Sektoren.hexVonOrt('b7')).region === 'saumraum' && Sektoren.hexVonOrt('b7') === '0406' && Sektoren.hexVonOrt('hafen') === '0206', 'Boje B-7 (0406) und Hafen Lichtkordon (0206) im Saumraum (für das Sprungziel von Fliegen)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'game.js'), 'utf8');
  const m = /const UEBUNG_WELTEN = (\{[^}]*\});/.exec(src);
  ok(!!m && !/training/.test(m[1]), 'UEBUNG_WELTEN (game.js) hat keinen Eintrag für die Trainingsmodi: Karte bleibt limes');
}

console.log('[3 arena.js]');
for (const m of MODI) {
  ok(Arena.KINDS.includes(m) && Arena.isArena(m), m + ' ist Arena-Art');
  ok(Arena.istUebungsszene(m), m + ' ist Übungsszene (keine Testmarken, keine Werft-Testumgebung)');
  ok(Arena.istTraining(m), m + ': arena.istTraining');
}
ok(!Arena.istTraining('arena_space') && !Arena.istTraining('arena_forschung') && Arena.istUebungsszene('arena_forschung') && !Arena.istUebungsszene('arena_space'), 'Gegenprobe: Wellen/Forschung unverändert');

console.log('[4 Platzhalter-Bücher, Angebotsbrett]');
const katalog = Mission.catalog();
for (const m of MODI) {
  const id = Training.TRAININGSMODI[m].buch;
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher', id + '.regiebuch.json'), 'utf8'));
  const r = Checker.check(doc);
  ok(r.ok && !r.errors.length, id + ': Checker akzeptiert das Buch');
  ok(doc.kopf.art === 'intern' && doc.steps.length >= 1, id + ': kopf.art intern, mindestens ein Schritt');
  ok(!!katalog.books[id] && !katalog.invalid.some((x) => x.id === id), id + ': im Katalog geladen, nicht ungültig');
  ok(katalog.info[id].art === 'intern', id + ': Katalog-Art intern');
  ok(!katalog.order.includes(id) && !katalog.sides.includes(id) && !(katalog.kapitel || []).includes(id), id + ': nicht in Angebotsreihenfolge, Nebenaufträgen, Kapiteln');
}
ok(katalog.order.includes('m1') && katalog.order.length >= 3, 'Gegenprobe: echte Missionen stehen in der Angebotsreihenfolge (' + katalog.order.length + ')');
ok(!katalog.order.some((id) => /^tra_/.test(id)), 'kein tra_*-Buch in der Angebotsreihenfolge');

console.log('\nTEST-TRAINING-PROTOKOLL: ' + (fails ? fails + ' FEHLER' : 'alle ' + n + ' bestanden'));
process.exit(fails ? 1 : 0);
