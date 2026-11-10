'use strict';
// LAD-01 E: Darstellungslogik der Frachtanzeige ohne Browser (shared/frachtliste.js): Name je Ware (content/waren.json), Füllstand je Frachtraum-Modul, Kennzeichen
// Illegal / Auftrag / enttarnt (Snapshot fracht.le), Rückfall bei unbekannter Ware, Verkaufsgründe (fracht.vg) und Typ-Regel-Hinweis; dazu die Server-Codes des Verkaufsgrunds
// (ladung.verkaufOrt -> Snapshot vg) und der Ablehnungstext beim Beamen.   node tools/test-frachtanzeige.js
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const FL = require('../shared/frachtliste.js');
const Waren = require('../shared/waren.js');
const Maps = require('../shared/maps.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Fracht = require('../server/sim/fracht.js');
const Ladung = require('../server/sim/ladung.js');
const Modul = require('../server/sim/module.js');
const Ausbau = require('../server/sim/ausbau.js');
const { spiel } = require('./faden-fixture.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ ' + (e && e.stack)); } };

section('Name je Ware aus waren.json, Rückfall bei unbekannter Ware', () => {
  const l = FL.frachtListe({ lager: ['erz', 'waffen'] }, 4);
  ok(l.eintraege[0].name === Waren.name('erz') && l.eintraege[0].name !== 'erz', 'erz -> Anzeigename "' + l.eintraege[0].name + '"');
  ok(l.eintraege[1].name === Waren.name('waffen') && /^FRACHTRAUM 2\/4: /.test(l.text), 'Titel und Liste: ' + l.text);
  const u = FL.frachtListe({ lager: ['gibtsnicht'] }, 4);
  ok(u.eintraege[0].name === 'gibtsnicht' && u.belegt === 1, 'unbekannte Ware: Kennung als Name, kein Absturz');
  ok(FL.artName('gibtsnicht') === 'gibtsnicht', 'artName Rückfall = Kennung');
  Waren.registrieren({ id: 'testkiste', name: 'Testkiste', grundpreis: 1, gewicht: 0, eigenschaften: [], darstellung: 'kiste', kategorie: 'ware' });
  ok(FL.frachtListe({ lager: ['testkiste'] }, 4).eintraege[0].name === 'Testkiste', 'neue Ware aus den Daten ohne Codeänderung');
  Waren.entfernen('testkiste');
});

section('Kennzeichen: illegal, Auftrag, enttarnt (le)', () => {
  const l = FL.frachtListe({ lager: ['waffen', 'erz', 'fracht', 'deuterium'], le: [3, 1, 4, 0] }, 8);
  const [a, b, c, d] = l.eintraege;
  ok(a.illegal && a.enttarnt && !a.auftrag && /ILLEGAL/.test(a.text) && /enttarnt/.test(a.text), 'le 3 = illegal und enttarnt: ' + a.text);
  ok(b.illegal && !b.enttarnt && !b.auftrag && /ILLEGAL/.test(b.text), 'le 1 = illegal: ' + b.text);
  ok(c.auftrag && !c.illegal && /Auftrag/.test(c.text) && !/ILLEGAL/.test(c.text), 'le 4 = Auftragsware: ' + c.text);
  ok(!d.illegal && !d.auftrag && !d.enttarnt && d.text === d.name, 'le 0 = nur der Name');
  ok(l.warnung === '2 × ILLEGAL', 'Sammelwarnung zählt illegale Posten: ' + l.warnung);
  const ohne = FL.frachtListe({ lager: ['erz'] }, 4);
  ok(ohne.warnung === '' && ohne.eintraege[0].text === ohne.eintraege[0].name, 'ohne le: keine Kennzeichen, keine Warnung');
  ok(FL.frachtListe({ lager: ['erz', 'erz'], le: [1] }, 4).eintraege[1].text === Waren.name('erz'), 'le kürzer als lager: fehlender Eintrag = 0');
  ok(FL.kennzeichen(7).join() === 'ILLEGAL,enttarnt,Auftrag', 'kennzeichen(7)');
  ok(FL.frachtListe({ lager: ['waffen'], pers: [{ id: 'p', n: 'Evert' }] }, 4).eintraege[1].text === 'Evert', 'Personen: Name ohne Kennzeichen');
});

section('Füllstand je Frachtraum-Modul (Maps.frachtBelegung) und Gesamtbelegung', () => {
  const l = FL.frachtListe({ lager: ['erz', 'erz', 'waffen'], pers: [{ id: 'a', n: 'A' }] }, 12, [1, 2, 3]);
  ok(l.belegt === 4 && l.cap === 12 && l.titel === 'FRACHTRAUM 4/12', 'Gesamtbelegung ' + l.titel);
  ok(l.module.length === 3 && l.module[0].art === 'person' && l.module[0].anzahl === 1 && l.module[0].kap === 4, 'Modul 1: Personen 1/4');
  ok(l.module[1].art === 'erz' && l.module[1].anzahl === 2 && l.module[1].text === Waren.name('erz') + ' 2/4', 'Modul 2: ' + l.module[1].text);
  ok(l.module[2].art === 'waffen' && l.module[2].anzahl === 1, 'Modul 3: eine Art je Modul (Typ-Regel)');
  ok(l.modulText.split(' · ').length === 3, 'modulText: ' + l.modulText);
  const fuenf = FL.frachtListe({ lager: ['erz', 'erz', 'erz', 'erz', 'erz'] }, 8, [1, 2]);
  ok(fuenf.module[0].text.endsWith(' 4/4') && fuenf.module[1].text.endsWith(' 1/4'), 'fünftes Stück läuft ins zweite Modul über (4/4 und 1/4)');
  const leer = FL.frachtListe({}, 4, [1]);
  ok(leer.module[0].art === null && leer.module[0].text === 'leer 0/4', 'leeres Modul: ' + leer.module[0].text);
  ok(FL.frachtListe({ lager: ['erz'] }, 4).module.length === 0 && FL.frachtListe({ lager: ['erz'] }, 4, []).modulText === '', 'ohne Räume keine Modulzeile');
  const bel = Maps.frachtBelegungAusSnapshot({ ship: { mod: [['f', 1, 1, 1]] }, fracht: { lager: ['erz'] } });
  ok(FL.modulFuellung({ lager: ['erz'] }, Maps.frachtRaeumeAusMod([['f', 1, 1, 1]]))[0].anzahl === bel.module[0].anzahl, 'gleiche Zahl wie die gemeinsame Belegungsfunktion');
});

section('Verkaufsgrund-Texte (fracht.vg)', () => {
  ok(FL.verkaufGrund({ lager: ['erz'], vk: 1 }) === null, 'vk: kein Grund nötig');
  ok(FL.verkaufGrund({}) === 'Keine Ware an Bord', 'ohne Ware');
  for (const c of [2, 3, 4, 5, 6, 7, 8]) { const t = FL.verkaufGrund({ lager: ['erz'], vg: c }); ok(typeof t === 'string' && t.length > 10 && t !== 'Kein Händler in Reichweite', 'Code ' + c + ': ' + t); }
  ok(/Auftragsware/.test(FL.verkaufGrund({ lager: ['fracht'], vg: 2 })), 'Code 2 nennt Auftragsware');
  ok(/zu weit/i.test(FL.verkaufGrund({ lager: ['erz'], vg: 5 })), 'Code 5 nennt zu weit');
  ok(FL.verkaufGrund({ lager: ['erz'] }) === 'Kein Händler in Reichweite' && FL.verkaufGrund({ lager: ['erz'], vg: 99 }) === 'Kein Händler in Reichweite', 'fehlender oder unbekannter Code: allgemeiner Satz');
});

section('Typ-Regel-Hinweis vor dem Beamen (platzGrund)', () => {
  const R = [1];
  ok(FL.platzGrund({ lager: ['erz'] }, R, 'erz') === null, 'gleiche Art passt');
  const t = FL.platzGrund({ lager: ['erz'] }, R, 'waffen');
  ok(/Kein Frachtraum frei für /.test(t) && t.includes(Waren.name('waffen')) && /nur eine Art/.test(t), 'andere Art im einzigen Modul: ' + t);
  ok(FL.platzGrund({ lager: ['erz'] }, [1, 2], 'waffen') === null, 'zweites Modul frei: passt');
  ok(/Personen/.test(FL.platzGrund({ lager: ['erz'] }, R, 'person')), 'Person neben Ware im einzigen Modul: abgelehnt');
  ok(FL.platzGrund({ lager: ['erz', 'erz', 'erz', 'erz'] }, R, 'waffen') === null, 'voll: eigener Hinweis Frachtraum voll, kein Typ-Text');
  ok(FL.platzGrund({}, [], 'erz') === null && FL.platzGrund({}, R, null) === null, 'ohne Räume oder Art: keine Aussage');
});

// Server: Codes des Verkaufsgrunds im Snapshot, Typ-Regel-Text als Beamen-Hinweis
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const aufn = (g, art, eig) => Fracht.lagerAufnehmen(g, { art, quelle: 'debug', eigenschaften: eig });
section('Server: Snapshot fracht.vg und Ablehnungstexte', () => {
  const g = spiel({ crew: 1, seed: 52 }).g;
  g.space.enemies = []; g.god = true; g.players[0].console = 'weapons';
  ab(g); Space.enterScene(g, Sektoren.ortVonHex('0305'), {}); ab(g);
  Ausbau.setStufe(g, 3);
  g.ship.module = [{ id: 'frachtraum', raum: 1, an: true, lauf: true }];
  Modul.verteilungSetzen(g);
  g.fracht.lager = []; g.fracht.draussen = []; g.fracht.halt = null;
  const vg = () => (g.snapshot().fracht || {}).vg;
  ok(vg() === undefined, 'ohne Ware: kein vg');
  aufn(g, 'erz', {});
  ok(!(g.snapshot().fracht.vk) && vg() > 0, 'Ware im freien Raum: kein vk, vg ' + vg() + ' (' + Ladung.verkaufOrt(g).reason + ')');
  ok(!!FL.VERKAUFSGRUND[vg()], 'jeder Server-Code hat einen Client-Text');
  g.fracht.lager = []; aufn(g, 'fracht', { auftrag: 'f1' });
  ok(vg() === 2 && FL.verkaufGrund(g.snapshot().fracht) === FL.VERKAUFSGRUND[2], 'nur Auftragsware: Code 2');
  g.fracht.lager = []; aufn(g, 'erz', {});
  // Typ-Regel: Beamen einer anderen Art in das belegte einzige Modul
  const pod = Fracht.fracht_abwerfen(g, g.ship.x + 40, g.ship.y, 'waffen');
  const err = Fracht.beamStart(g, null, pod.id);
  ok(typeof err === 'string' && /Kein Frachtraum frei/.test(err) && /nur eine Art/.test(err), 'Beamen: Ablehnungstext vom Server (kommt als Hinweis beim Spieler an): ' + err);
  ok(FL.platzGrund(g.snapshot().fracht, [1], 'waffen') !== null, 'Client erkennt denselben Fall vorab');
});

console.log(`\n${n - fails}/${n} Prüfungen ok${fails ? ' – ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
