'use strict';
// LAD-01 Nacharbeit 2: Tarnung ohne Lecks, Belegung vom Server, Quartiermeister, Faden-Fracht (Platz, tote Pods).
// Alles, was der Spieler liest (ODA-Text, Netz-Ereignis, Snapshot), nennt die ANGEZEIGTE Art einer getarnten Ware, nie die echte; missionEvent (Regiebuch, serverintern) behaelt die echte.
// Der Reviewer-Fehlerfall: Waffen getarnt als Fracht, Client zeigte Fracht 1/4 und liess das Beamen zu, der Server lehnte ab (und nannte Waffen).   node tools/test-tarnung.js
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const FL = require('../shared/frachtliste.js');
const Waren = require('../shared/waren.js');
const Maps = require('../shared/maps.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Faden = require('../server/sim/faden.js');
const FF = require('../server/sim/faden-fracht.js');
const Fracht = require('../server/sim/fracht.js');
const Ladung = require('../server/sim/ladung.js');
const Modul = require('../server/sim/module.js');
const Ausbau = require('../server/sim/ausbau.js');
const X = require('./faden-fixture.js');
const { D, spiel, oeffne, grenzen, alsVorlage, registriere } = X;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ ' + (e && e.stack)); } };
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const angedockt = (g, hex) => { const ort = Sektoren.ortVonHex(hex || '0305'); Space.enterScene(g, ort, {}); Object.assign(g.ship, { vx: 0, vy: 0, speed: 0, docked: true, dockedAt: ort }); };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const WAFFEN = Waren.name('waffen'), FRACHT = Waren.name('fracht');
function bereit(seed) {
  const g = spiel({ crew: 1, seed }).g;
  g.space.enemies = []; g.god = true; g.players[0].console = 'weapons';
  ab(g); ankunft(g, '0305');
  g.odas = []; g.evts = []; g.mevts = [];
  const oda = g.oda.bind(g); g.oda = (t, k) => { g.odas.push(t); return oda(t, k); };
  const emit = g.emit.bind(g); g.emit = (k, d) => { g.evts.push({ k, d }); return emit(k, d); };
  const me = g.missionEvent.bind(g); g.missionEvent = (k, d) => { g.mevts.push({ k, d }); return me(k, d); };
  return g;
}
function raeume(g, liste) {
  Ausbau.setStufe(g, 3);
  g.ship.module = liste.map((r) => ({ id: 'frachtraum', raum: r, an: true, lauf: true }));
  Modul.verteilungSetzen(g);
  g.fracht.lager = []; g.fracht.draussen = []; g.fracht.halt = null;
}
const aufn = (g, art, eig) => Fracht.lagerAufnehmen(g, { art, quelle: 'debug', eigenschaften: eig });
const tarn = { getarnt: 'fracht', illegal: true };
const frachtSnap = (g) => g.snapshot().fracht || {};
const sieht = (g) => g.odas.concat(g.evts.map((e) => JSON.stringify(e))).join(' | ');   // alles, was der Spieler erfaehrt
const raumListe = (g) => Maps.frachtRaeumeAusMod(g.snapshot().ship.mod);

section('H3: Belegung vom Server (fracht.mb), Client und Server rechnen dieselbe', () => {
  const g = bereit(61);
  raeume(g, [1]);
  ok(aufn(g, 'waffen', tarn).ok, 'Waffen, getarnt als Fracht, im einzigen Modul');
  const f = frachtSnap(g);
  ok(JSON.stringify(f.mb) === JSON.stringify([['fracht', 1]]) && f.lager.join() === 'fracht', 'Snapshot: mb [["fracht",1]], lager zeigt die Tarnart: ' + JSON.stringify(f.mb));
  ok(!JSON.stringify(f).includes('waffen'), 'der ganze fracht-Snapshot nennt die echte Art nirgends');
  ok(FL.modulFuellung(f, raumListe(g))[0].text === FRACHT + ' 1/4', 'Client: Modul zeigt "' + FL.modulFuellung(f, raumListe(g))[0].text + '"');
  // der Reviewer-Fall: ein Pod mit ECHTER Fracht, angezeigt als Fracht, kann nicht in das Modul mit den Waffen
  const pod = Fracht.fracht_abwerfen(g, g.ship.x + 40, g.ship.y, 'fracht');
  const sp = frachtSnap(g).draussen.find((d) => d.id === pod.id);
  const err = Fracht.beamStart(g, null, pod.id);
  ok(typeof err === 'string' && /Kein Frachtraum frei/.test(err), 'Server lehnt das Beamen ab: ' + err);
  ok(!err.includes(WAFFEN) && !/waffen/i.test(err), 'Ablehnungstext nennt die echte Art nicht');
  ok(sp.nz === 1 && FL.platzGrund(frachtSnap(g), raumListe(g), sp.art, sp) !== null, 'Client sagt dasselbe wie der Server (Knopf gesperrt): ' + FL.platzGrund(frachtSnap(g), raumListe(g), sp.art, sp));
  ok(!/waffen/i.test(FL.platzGrund(frachtSnap(g), raumListe(g), sp.art, sp)), 'Knopf-Hinweis nennt die echte Art nicht');
  // umgekehrt: ein Pod, den der Server annimmt, wird vom Client nicht gesperrt (Waffen-Pod, angezeigt als Fracht, neben den Waffen)
  g.fracht.draussen = [];
  const pod2 = Fracht.fracht_abwerfen(g, g.ship.x + 40, g.ship.y, 'waffen'); pod2.eig = { getarnt: 'fracht' };
  const sp2 = frachtSnap(g).draussen[0];
  ok(Fracht.beamStart(g, null, pod2.id) === null && !sp2.nz && FL.platzGrund(frachtSnap(g), raumListe(g), sp2.art, sp2) === null, 'Waffen-Pod (getarnt) passt zu den Waffen: Server nimmt an, Client sperrt nicht');
  g.fracht.halt = null;
  // zwei Module: Server-Belegung = Anzeige, auch wenn die Tarnart einer anderen Gruppe gleicht
  raeume(g, [1, 3]);
  aufn(g, 'fracht'); aufn(g, 'waffen', tarn);
  const f2 = frachtSnap(g); const srv = Fracht.modulAnzeige(g);
  const cl = Maps.frachtBelegungAusSnapshot(g.snapshot());
  ok(cl.module.map((m) => m.art + ':' + m.anzahl).join() === srv.map((m) => m.art + ':' + m.anzahl).join(), 'Client-Belegung = Server-Belegung: ' + cl.module.map((m) => m.art + ':' + m.anzahl).join());
  ok(cl.module.length === 2 && cl.module.every((m) => m.art === 'fracht' && m.anzahl === 1), 'zwei Module, beide als Fracht angezeigt (Typ-Regel nach echter Art)');
  ok(f2.mb.length === 2, 'mb nur mit Ladung an Bord');
  g.fracht.lager = [];
  ok(frachtSnap(g).mb === undefined, 'ohne Ladung kein mb');
  // Personen
  Fracht.lagerAufnehmen(g, { art: 'person', person: 'evert', name: 'Evert', quelle: 'person' });
  ok(JSON.stringify(frachtSnap(g).mb) === JSON.stringify([['person', 1], 0]), 'Personen-Modul in mb: ' + JSON.stringify(frachtSnap(g).mb));
  ok(FL.platzGrund(frachtSnap(g), raumListe(g), 'person') === null, 'Person: Platz im selben Modul, kein Hinweis');
});

section('M4/M9/N11: Texte und Ereignisse nennen die Anzeigeart', () => {
  const g = bereit(62);
  raeume(g, [1, 3]);
  aufn(g, 'waffen', tarn);
  // Abwerfen: Ereignis, Meldung; abwerfen(art) mit der angezeigten Art
  ok(Ladung.abwerfen(g, 'waffen') !== null, 'abwerfen("waffen") (echte Art) findet nichts');
  g.odas = []; g.evts = []; g.mevts = [];
  ok(Ladung.abwerfen(g, 'fracht') === null, 'abwerfen("fracht") (Anzeigeart) wirft die getarnten Waffen ab');
  const ev = g.evts.find((e) => e.k === 'frachtAbgeworfen');
  ok(ev && ev.d.art === 'fracht' && !/waffen/i.test(sieht(g)), 'Ereignis frachtAbgeworfen trägt "fracht", nichts nennt Waffen: ' + sieht(g));
  ok(g.mevts.some((e) => e.k === 'frachtAbgeworfen' && e.d.art === 'waffen') && g.mevts.some((e) => e.k === 'frachtAbgeworfenVonBord' && e.d.art === 'waffen'), 'missionEvent (Regiebuch) behält die echte Art');
  const pod = g.fracht.draussen[0];
  ok(pod && pod.art === 'waffen' && pod.eig && pod.eig.getarnt === 'fracht', 'der Pod trägt Art und Tarnung');
  // wieder an Bord beamen: Ereignis frachtBeamen fertig
  g.odas = []; g.evts = [];
  ok(Fracht.beamStart(g, null, pod.id) === null, 'Beamen startet');
  for (let k = 0; k < 400 && g.fracht.halt; k++) g.step();
  const bf = g.evts.find((e) => e.k === 'frachtBeamen' && e.d.phase === 'fertig' && e.d.was === 'an');
  ok(bf && bf.d.art === 'fracht' && !/waffen/i.test(sieht(g)), 'Beamen fertig: Ereignis und Meldung mit Anzeigeart: ' + sieht(g));
  // Hüllentreffer im ungesicherten Frachtraum
  g.odas = []; g.evts = [];
  g.ship.module.forEach((m) => { m.an = false; }); Modul.verteilungSetzen(g);
  Fracht.huellenTreffer(g);
  ok(g.evts.some((e) => e.k === 'frachtVerloren' && e.d.art === 'fracht') && g.evts.some((e) => e.k === 'frachtAbgeworfen' && e.d.art === 'fracht') && !/waffen/i.test(sieht(g)), 'Hüllentreffer: frachtVerloren und frachtAbgeworfen mit Anzeigeart: ' + sieht(g));
  // Verkauf: Meldung mit Tarnbezeichnung, bezahlt nach echter Art
  g.ship.module.forEach((m) => { m.an = true; }); Modul.verteilungSetzen(g);
  g.fracht.lager = []; g.fracht.draussen = [];
  angedockt(g, '0305');
  aufn(g, 'waffen', tarn);
  const m0 = g.fracht && Ladung.verkaufOrt(g);
  ok(m0.ok, 'Händler am Ort');
  g.odas = []; g.evts = []; g.mevts = [];
  Ladung.verkaufStart(g, null);
  for (let k = 0; k < 600 && g.fracht.halt; k++) g.step();
  const vk = g.odas.find((t) => /^Verkauft/.test(t));
  ok(vk && new RegExp('1 × ' + FRACHT).test(vk) && !vk.includes(WAFFEN), 'Verkaufsmeldung nennt die Tarnbezeichnung: ' + vk);
  const vev = g.mevts.find((e) => e.k === 'frachtVerkauft');
  ok(vev && vev.d.arten.waffen === 1 && vev.d.marks > 0 && new RegExp(vev.d.marks + ' Marken').test(vk), 'bezahlt nach echter Art (Preis steht in der Meldung, gewollt): ' + (vev && vev.d.marks));
  ok(!/waffen/i.test(JSON.stringify(g.evts)), 'Netz-Ereignisse des Verkaufs nennen die echte Art nicht');
  // nach der Durchsuchung ist die Tarnung weg: alles zeigt die echte Art
  g.fracht.lager = []; aufn(g, 'waffen', tarn);
  Fracht.frachtDurchsuchen(g, { wer: 'zoll' });
  ok(frachtSnap(g).lager.join() === 'waffen' && frachtSnap(g).mb[0][0] === 'waffen', 'aufgedeckt: Snapshot und mb zeigen die echte Art');
  ok(Fracht.anzeigeName(g.fracht.lager[0]) === WAFFEN, 'anzeigeName nach der Durchsuchung = echter Name');
});

section('Ablehnungstexte (platzFuer) nennen bei Tarnung keine echte Art', () => {
  const g = bereit(63);
  raeume(g, [1]);
  aufn(g, 'waffen', tarn);
  const r = Fracht.platzFuer(g, 'erz');
  ok(!r.ok && r.grund === 'art_belegt' && /ein Modul ist mit anderer Ladung belegt/.test(r.text) && !/waffen/i.test(r.text), 'getarnte Ware im Modul: "ein Modul ist mit anderer Ladung belegt": ' + r.text);
  const ra = aufn(g, 'erz');
  ok(!ra.ok && !/waffen/i.test(ra.text), 'lagerAufnehmen: gleicher Text ohne echte Art');
  g.fracht.lager = []; aufn(g, 'erz');
  const r2 = Fracht.platzFuer(g, 'waffen');
  ok(!r2.ok && /belegt: /.test(r2.text) && r2.text.includes(Waren.name('erz')), 'ohne Tarnung bleibt die Aufstellung im Text: ' + r2.text);
  // ankommende Ladung getarnt: heisst wie angezeigt
  const r3 = Fracht.platzFuerLadung(g, { art: 'waffen', eig: { getarnt: 'fracht' } });
  ok(!r3.ok && r3.text.includes(FRACHT) && !/waffen/i.test(r3.text), 'getarnte ankommende Ladung heißt im Text wie angezeigt: ' + r3.text);
});

section('M5: Quartiermeister räumt nur das kleinste Fremd-Modul, mit Pod, Ereignis, Anzeigeart', () => {
  const g = bereit(64);
  raeume(g, [1, 2, 3]);
  for (let i = 0; i < 5; i++) aufn(g, 'erz');
  for (let i = 0; i < 4; i++) aufn(g, 'deuterium');
  ok(Fracht.anBord(g, 'erz') === 5 && Fracht.belegung(g).module.every((m) => m.art), 'Fixture: Erz 4+1, Deuterium 4, kein Modul frei');
  g.odas = []; g.evts = []; g.mevts = [];
  ok(Fracht.zuteilen(g, 'sprengstoff'), 'Zuteilung gelingt');
  ok(Fracht.anBord(g, 'erz') === 4 && Fracht.anBord(g, 'deuterium') === 4 && Fracht.anBord(g, 'sprengstoff') === 1, 'nur das kleinste Modul (1 Erz) geräumt, nicht alle 5: Erz ' + Fracht.anBord(g, 'erz'));
  const pods = g.fracht.draussen.filter((d) => d.art === 'erz');
  ok(pods.length === 1 && pods[0].eigene, 'die ausgeräumte Ladung liegt als Pod im All (kann neu gebeamt werden)');
  ok(g.evts.some((e) => e.k === 'frachtVerloren' && e.d.art === 'erz') && g.mevts.some((e) => e.k === 'frachtAusgeraeumt' && e.d.n === 1), 'Ereignis (Netz und Regiebuch)');
  ok(g.odas.some((t) => /Quartiermeister hat 1× /.test(t) && /Ladung treibt/.test(t)), 'Meldung: ' + g.odas.join(' | '));
  // angedockt: die Ladung bleibt im Hafen, kein Pod
  const h = bereit(65);
  raeume(h, [1]); aufn(h, 'deuterium'); aufn(h, 'deuterium');
  angedockt(h, '0305'); h.odas = [];
  ok(Fracht.zuteilen(h, 'sprengstoff') && h.fracht.draussen.length === 0 && h.odas.some((t) => /im Hafen/.test(t)), 'angedockt: kein Pod, Meldung "bleibt im Hafen zurück"');
  // getarnte Fremdware: Meldung mit Tarnbezeichnung
  const t = bereit(66);
  raeume(t, [1]); aufn(t, 'waffen', tarn); t.odas = [];
  ok(Fracht.zuteilen(t, 'sprengstoff') && !/waffen/i.test(sieht(t)) && t.odas.some((x) => x.includes(FRACHT)), 'getarnte Waffen: Quartiermeister nennt Fracht: ' + t.odas.join(' | '));
  // Auftragsware (Faden, Kampagne) bleibt unberührt, auch die kleinste
  const a = bereit(67);
  raeume(a, [1, 2]);
  Fracht.lagerAufnehmen(a, { art: 'erz', quelle: 'debug', eigenschaften: { auftrag: 'kunde' } });
  Fracht.lagerAufnehmen(a, { art: 'waffen', quelle: 'debug', eigenschaften: { auftrag: 'kunde2' } });
  ok(!Fracht.zuteilen(a, 'sprengstoff') && Fracht.anBord(a, 'erz') === 1 && Fracht.anBord(a, 'waffen') === 1 && a.fracht.draussen.length === 0, 'nur Auftragsware in den Modulen: bleibt, nichts wird geräumt');
  const k = bereit(68);
  raeume(k, [1]);
  Fracht.zuteilen(k, 'fracht');
  ok(!Fracht.zuteilen(k, 'sprengstoff') && Fracht.anBord(k, 'fracht') === 1, 'Kampagnen-Ware (Tag kampagne) bleibt unberührt');
  // Personen nie
  const p = bereit(69);
  raeume(p, [1]); Fracht.lagerAufnehmen(p, { art: 'person', person: 'evert', name: 'Evert', quelle: 'person' });
  ok(!Fracht.zuteilen(p, 'sprengstoff') && p.fracht.lager.length === 1, 'Personen werden nie ausgeräumt');
});

// ---- Faden (M6, M10)
function vorlage(id) {
  const r = registriere(alsVorlage(id, (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    v.beats = [
      { id: 'b_szene', typ: 'fracht', parameter: { nach: '0305' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['fracht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  if (!r.ok) throw new Error('Vorlage ungueltig: ' + r.fehler.join('; '));
}

section('M6: Faden-Fracht bei Fremdware im einzigen Frachtraum', () => {
  vorlage('tn_a');
  const g = bereit(70);
  raeume(g, [1]); aufn(g, 'deuterium'); aufn(g, 'deuterium');
  const f = oeffne(g, 'tn_a'); grenzen(g, 5);
  weiter(g, f);
  ok(!!f.fracht && f.phase === 'laeuft' && g.fracht.lager.map((l) => l.art).join() === 'fracht', 'Beat startet: der Quartiermeister räumt gewöhnliche Fremdware, die Faden-Ware liegt an Bord');
  ok(g.fracht.draussen.filter((d) => d.art === 'deuterium').length === 2, 'das Deuterium treibt als Pod hinter dem Schiff (nicht verloren)');
  // Person im einzigen Modul: nicht räumbar -> Beat scheitert mit dem richtigen Grund
  vorlage('tn_b');
  const h = bereit(71);
  raeume(h, [1]); Fracht.lagerAufnehmen(h, { art: 'person', person: 'evert', name: 'Evert', quelle: 'person' });
  const f2 = oeffne(h, 'tn_b'); grenzen(h, 5);
  const TX = require('../content/faeden/szenen-werte.json').texte.fracht;
  h.funkTexte = []; const em = h.emit.bind(h); h.emit = (k, d) => { if (k === 'radio' && d) h.funkTexte.push(d.text); return em(k, d); };
  weiter(h, f2);
  ok(!f2.fracht && h.funkTexte.some((t) => /Platz im Frachtraum/.test(t)) && !h.funkTexte.some((t) => /Kein Hafen für euch/.test(t)), 'Funk nennt den richtigen Grund (kein Platz), nicht "kein Hafen": ' + h.funkTexte.join(' | '));
  ok(h.fracht.lager.length === 1 && h.fracht.lager[0].art === 'person', 'die Person bleibt an Bord');
  ok(typeof TX.kein_platz === 'string' && /Platz/.test(TX.kein_platz) && !/Hafen für euch/.test(TX.kein_platz), 'Funktext kein_platz: ' + TX.kein_platz);
});

section('M10: tote Auftragsware nach dem Beat-Ende', () => {
  vorlage('tn_c');
  const g = bereit(72);
  raeume(g, [1, 3]);
  const f = oeffne(g, 'tn_c'); grenzen(g, 5);
  weiter(g, f);
  ok(!!f.fracht && Fracht.auftragAnBord(g, f.id) === 1, 'Faden-Ware an Bord (Tag ' + f.id + ')');
  // Hüllentreffer: die Faden-Ware treibt als Pod (eigene), der Beat endet dann
  g.ship.module.forEach((m) => { m.an = false; }); Modul.verteilungSetzen(g);
  Fracht.huellenTreffer(g);
  ok(g.fracht.draussen.some((d) => d.eig && d.eig.auftrag === f.id), 'Faden-Ware als Pod im All');
  Faden.beatAusgang(g, f.id, 'gescheitert');
  ok(!g.fracht.draussen.some((d) => d.eig && d.eig.auftrag === f.id), 'Beat-Ende entfernt auch den treibenden Pod (alle Szenen)');
  // ein Pod mit erloschenem Tag, der doch noch da ist (andere Szene), wird nicht mehr angenommen
  g.ship.module.forEach((m) => { m.an = true; }); Modul.verteilungSetzen(g);
  const r = Fracht.lagerAufnehmen(g, { art: 'fracht', quelle: 'beamen', eigenschaften: { auftrag: f.id } });
  ok(!r.ok && r.grund === 'erloschen' && g.fracht.lager.length === 0, 'Einlagern abgelehnt: ' + r.text);
  // und was schon an Bord liegt, räumt der nächste Tick auf
  Fracht.lagerAufnehmen(g, { art: 'fracht', quelle: 'laden', eigenschaften: { auftrag: f.id } });
  ok(g.fracht.lager.length === 1, 'Fixture: Ladung mit erloschenem Tag an Bord');
  g.step();
  ok(g.fracht.lager.length === 0, 'nächster Tick räumt sie auf');
  // ein Tag, den kein Faden kennt (Skript, Tests), bleibt unbeanstandet
  Fracht.lagerAufnehmen(g, { art: 'fracht', quelle: 'debug', eigenschaften: { auftrag: 'f9999' } });
  g.step();
  ok(g.fracht.lager.length === 1, 'unbekannter Tag bleibt (nichts zu beurteilen)');
});

console.log(`\n${n - fails}/${n} Prüfungen ok${fails ? ' – ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
