'use strict';
// SPT-02 12: ein Notruf-Faden darf nicht dauerhaft in `rettung` haengen und notruf_aktiv_max (3) belegen. Die Frist des Beats (beats.json, 16) zaehlt TAETIGKEITEN (szene_ende, andocken, absicht, notruf), keine Zeit:
// ohne Taetigkeit steht laufend.n bei 0 (Crew sitzt am Ort, ist weggesprungen oder kam nie runter), und im Betrieb mit Modell startet niemand den Beat rettung, wenn das Modell schweigt. Ein Sprung ist ein Sim-Tick
// (weltsim.tickZahl). Die Daten-Frist notruf_faden_frist_spruenge (content/faeden/notruf-brett.json) zaehlt ab dem Annehmen (f.begonnen); danach beendet Brett.notrufHaengerBeenden den Faden als gescheitert
// (Beat gescheitert, Strafe wie sonst, Abschluss gescheitert mit Text "zuletzt"), der Platz ist frei und das Brett bietet wieder einen Notruf an.
//   A: Daten   B: Rueckfall-Betrieb, Crew am Ort ohne Rettung   C: Betrieb mit Modell, rettung laeuft   D: Betrieb mit Modell, rettung wird nie gestartet   E: Crew weggesprungen
//   F: Schutz (vor der Frist, Gefahr laeuft, Crew am Boden, Spielleiter aus)   G: Laden mittendrin   H: erfuellte Rettung schliesst ab wie bisher   I: Im-Stich-Lassen beendet auch einen laufenden Beat rettung
//   J: Takt (g.step) verdrahtet   node tools/test-faden-rettung-haenger.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const RE = require('../server/sim/reise-ereignis.js');
const Faden = require('../server/sim/faden.js');
const D = require('../server/sim/faden-daten.js');
const P = require('../server/sim/faden-pruefer.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const FP3 = require('../server/sim/faden-p3.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); f(); };
const HZ = CONFIG.tickHz;
const NBD = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content/faeden/notruf-brett.json'), 'utf8'));
const FRIST = NBD.werte.notruf_faden_frist_spruenge ? NBD.werte.notruf_faden_frist_spruenge.wert : 24;
const NOTRUF = RE.KATALOG.find((e) => e.art === 'notruf' && !e.gefahr);
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };
const Fz = (g) => Faden.zustandVon(g);
const R = (g) => g.weltsim.reise;
const HEX = '0603';
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const nFaden = (g) => P.notrufAktiv(Fz(g)).length;
const typ = (f) => D.vorlage(f.vorlage).beats[f.beat].typ;
const hatFunktion = typeof Brett.notrufHaengerBeenden === 'function';
const haenger = (g) => (hatFunktion ? Brett.notrufHaengerBeenden(g) : 0);
const spruenge = (g, k) => { g.weltsim.tickZahl += k; };   // k Spruenge (Sim-Ticks) vergehen
const modell = (g) => { g.lageSpielleiter.rueckfallBetrieb = false; g.lageSpielleiter.mode = 'mock'; };

function neu() {
  const g = F.neuesSpiel({ crew: 1, seed: 7, env: ENV }).g;
  g.weltsim.zustand.flotten = [];
  g.ship.scene = Sektoren.ortVonHex('0305');
  Fz(g).abenteuerAngebote.length = 0;
  return g;
}
function notrufAn(g, i, hex) {
  return Brett.notrufAnbieten(g, { nr: -(200 + i), id: NOTRUF.id, hex: hex || HEX, variante: NOTRUF.parameter.variante, sprecher: 'Probeschiff ' + i, marke: 'reise:n-' + (200 + i), ankunft: '0305' });
}
// angenommener Notruf-Faden, Crew angekommen: der Beat rettung laeuft (Rueckfall-Betrieb, wie im Server-Standard) -> { g, f }
function inRettung(mitModell) {
  const g = neu();
  const a = notrufAn(g, 0);
  Brett.annehmen(g, 'a' + a.nr);
  const f = Fz(g).liste.find((x) => P.notrufBrettFaden(x));
  g.ship.scene = Sektoren.ortVonHex(HEX);   // die Crew kommt am Ort an: der Beat notruf endet gelungen, rettung beginnt
  lauf(g, 1);
  if (mitModell) modell(g);
  return { g, f, a };
}

section('A: Daten: Frist in Spruengen steht in notruf-brett.json, nicht im Code', () => {
  const w = NBD.werte.notruf_faden_frist_spruenge;
  ok(!!w && Number.isInteger(w.wert) && w.wert >= 1, 'werte.notruf_faden_frist_spruenge ist eine ganze Zahl >= 1 (' + (w && w.wert) + ')');
  ok(!!w && typeof w.einheit === 'string' && /spr(ue|ü)nge/i.test(w.einheit) && typeof w._hinweis === 'string' && w._hinweis.length > 40, 'Einheit nennt Spruenge, der Hinweis erklaert die Frist');
  ok(hatFunktion, 'Brett.notrufHaengerBeenden existiert (Action-Layer)');
  const rb = D.BEATS.rettung;
  ok(rb.frist === 16, 'Gegenprobe: die vorhandene Beat-Frist von rettung (16) zaehlt Taetigkeiten und bleibt unveraendert');
});

section('B: Rueckfall-Betrieb: Crew am Ort, Rettung wird nie erfuellt, keine Taetigkeit: der Faden haengt nicht mehr', () => {
  const { g, f } = inRettung(false);
  ok(typ(f) === 'rettung' && f.phase === 'laeuft' && f.laufend.n === 0, 'Ausgangslage: rettung laeuft, n=' + f.laufend.n + ' (Taetigkeiten 0: die Beat-Frist greift nie)');
  lauf(g, 60);
  ok(f.phase === 'laeuft' && f.laufend.n === 0 && nFaden(g) === 1, 'eine Minute Spielzeit ohne Taetigkeit: der Beat laeuft unveraendert weiter');
  spruenge(g, FRIST);
  lauf(g, 2);
  ok(f.phase === 'abgeschlossen' && f.ausgang && f.ausgang.art === 'gescheitert', 'nach ' + FRIST + ' Spruengen ist der Faden abgeschlossen und gescheitert (Phase ' + f.phase + ', Beat ' + typ(f) + ')');
  ok(nFaden(g) === 0, 'der Platz in notruf_aktiv_max ist frei');
  const z = Brett.snapshot(g);
  ok(z && z.zuletzt && z.zuletzt.ausgang === 'gescheitert' && z.zuletzt.text.length > 3, 'der Abschluss steht als zuletzt (gescheitert, Text "' + (z && z.zuletzt && z.zuletzt.text) + '")');
  const g3 = neu();
  for (let i = 0; i < 3; i++) Brett.annehmen(g3, 'a' + notrufAn(g3, i, ['0603', '0504', '0403'][i]).nr);
  ok(Brett.notrufGrenzeErreicht(g3) === true && notrufAn(g3, 3) === null, 'drei Faeden: Grenze erreicht, kein weiterer Notruf');
  spruenge(g3, FRIST); lauf(g3, 2);
  ok(nFaden(g3) === 0 && !!notrufAn(g3, 3), 'nach Ablauf der Frist sind alle drei frei, das Brett bietet wieder einen Notruf an');
});

section('C: Betrieb mit Modell: rettung laeuft, das Modell hilft nicht, keine Taetigkeit', () => {
  const { g, f } = inRettung(true);
  ok(typ(f) === 'rettung' && f.phase === 'laeuft', 'Ausgangslage: rettung laeuft (Modell-Betrieb)');
  lauf(g, 30);
  ok(f.phase === 'laeuft' && nFaden(g) === 1, 'ohne Frist-Ablauf bleibt der Faden (kein Rueckfall, kein Abschluss)');
  spruenge(g, FRIST);
  lauf(g, 2);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && nFaden(g) === 0, 'nach der Frist: abgeschlossen, gescheitert, Platz frei (Phase ' + f.phase + ')');
  ok(f.nsc.gedaechtnis.some((e) => e.ereignis === 'rettung_gescheitert'), 'der NSC erinnert sich an die gescheiterte Rettung (Beat endete gescheitert: Strafe wie sonst)');
  const strafe = D.BEATS.rettung.bauplan.aus.gescheitert.folge;
  ok(strafe.some((x) => x.grund === 'im_stich_gelassen'), 'Katalog: der Ausgang gescheitert von rettung traegt die Folge im_stich_gelassen (' + JSON.stringify(strafe) + ')');
});

section('D: Betrieb mit Modell: der Beat rettung wird nie gestartet (Modell schweigt), Faden wartet vor rettung', () => {
  const { g, f } = inRettung(true);
  // Zustand: notruf-Beat gelungen, rettung wartet, nichts startet sie
  f.phase = 'wartet'; f.laufend = null; f.beat = 1; f.zaehler = f.abstand;
  lauf(g, 5);
  ok(f.phase === 'wartet' && typ(f) === 'rettung' && nFaden(g) === 1, 'Ausgangslage: rettung wartet, im Modell-Betrieb startet es niemand');
  spruenge(g, FRIST);
  lauf(g, 2);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && nFaden(g) === 0, 'nach der Frist abgeschlossen (gescheitert) und der Platz frei (Phase ' + f.phase + ')');
});

section('E: Crew springt nach der Ankunft weg (keine Gefahr, kein Eintrag in R.laufend)', () => {
  const { g, f } = inRettung(false);
  g.ship.scene = Sektoren.ortVonHex('0305'); R(g).n++;
  lauf(g, 3);
  ok(f.phase === 'laeuft' && typ(f) === 'rettung', 'die Crew ist weg, der Beat rettung laeuft weiter (nichts beendet ihn von selbst)');
  spruenge(g, FRIST - 1); lauf(g, 2);
  ok(f.phase === 'laeuft', 'eine Frist minus einen Sprung: noch offen');
  spruenge(g, 1); lauf(g, 2);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && nFaden(g) === 0, 'nach der Frist beendet');
});

section('F: Schutz: nicht vor der Frist, nicht mitten im Kampf, nicht mit der Crew am Boden, nicht bei ausgeschaltetem Spielleiter', () => {
  const { g, f } = inRettung(false);
  spruenge(g, FRIST - 1);
  ok(haenger(g) === 0 && f.phase === 'laeuft', 'FRIST-1 Spruenge: unberuehrt');
  spruenge(g, 1);
  R(g).laufend.push({ nr: 900, id: 'x', phase: 'kampf', notruf: true, ev: { hex: f.parameter.ort } });
  ok(haenger(g) === 0 && f.phase === 'laeuft', 'Gefahr laeuft am Ort: unberuehrt');
  R(g).laufend.length = 0;
  g.players = [{ zone: 'away' }]; g.away = { map: f.parameter.ort };
  const lp = require('../server/sim/faden-boden-rahmen.js').ortVon(g, f, D.vorlage(f.vorlage).beats[f.beat]);
  g.away = { map: lp };
  ok(haenger(g) === 0 && f.phase === 'laeuft', 'Crew steht am Landeplatz (' + lp + '): unberuehrt');
  g.players = []; g.away = null;
  g.lageSpielleiter.mode = 'off'; g.lageSpielleiter.rueckfallBetrieb = false;
  ok(haenger(g) === 0 && f.phase === 'laeuft', 'Spielleiter aus: unberuehrt');
  g.lageSpielleiter.mode = 'mock';
  ok(haenger(g) === 1 && f.phase === 'abgeschlossen', 'alle Schutzgruende weg: der Faden wird beendet');
  ok(haenger(g) === 0, 'ein beendeter Faden wird nicht noch einmal angefasst');
  // ein regulaerer Faden (kein Notruf) wird nie angefasst, auch weit nach der Frist
  const r = neu();
  const rf = Faden.abenteuerAnbieten(r, { format: 'faden-bauplan/1', titel: 'Auftrag Nummer 1', anlass: 'Ein Test ohne Namen fuer das Brett.', beats: [{ typ: 'geruecht' }, { typ: 'abschluss' }], volk_erlaubt: ['rom'] }, { hex: '0305' });
  Brett.annehmen(r, 'a' + rf.angebot.nr);
  const reg = Fz(r).liste.find((x) => x.plan && !x.notruf);
  const fehlerVor = r.errors;
  spruenge(r, FRIST * 3);
  ok(!!reg && haenger(r) === 0 && reg.phase !== 'abgeschlossen' && r.errors === fehlerVor, 'regulaerer Faden: weit nach der Frist unberuehrt, kein Fehler gezaehlt (' + (r.errors - fehlerVor) + ')');
});

section('G: Laden mittendrin: die Frist bleibt (begonnen steht im Weltstand)', () => {
  const { g, f } = inRettung(false);
  const save = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim)));
  const F2 = Faden.lesen(save);
  const f2 = F2.liste.find((x) => P.notrufBrettFaden(x));
  ok(!!f2 && f2.begonnen === f.begonnen && f2.phase === 'laeuft', 'nach dem Laden: derselbe Faden, begonnen ' + (f2 && f2.begonnen) + ', laeuft');
  // Weltstand-Schema: kein neues Feld noetig
  ok(!Object.keys(f).some((k) => /frist|haenger/i.test(k)), 'der Faden traegt kein neues Feld (kein Schemawechsel)');
  g.weltsim.faeden = F2;
  spruenge(g, FRIST); lauf(g, 2);
  ok(f2.phase === 'abgeschlossen' && P.notrufAktiv(F2).length === 0, 'der geladene Faden wird nach der Frist beendet');
});

section('H: eine erfuellte Rettung schliesst ab wie bisher (gelungen), auch lange vor und nach der Frist', () => {
  const { g, f } = inRettung(false);
  Faden.beatAusgang(g, f.id, 'gelungen');
  lauf(g, 2);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen' && nFaden(g) === 0, 'rettung gelungen: der Rueckfall schliesst den Faden gelungen ab (' + (f.ausgang && f.ausgang.art) + ')');
  const m = inRettung(true);
  Faden.beatAusgang(m.g, m.f.id, 'gelungen');
  ok(m.f.phase === 'wartet' && m.f.zaehler < m.f.abstand && typ(m.f) === 'abschluss', 'Modell-Betrieb, Rettung gelungen: der Abschluss wartet auf Taetigkeiten (Zaehler ' + m.f.zaehler + ' von ' + m.f.abstand + '), es kommen keine');
  lauf(m.g, 5);
  ok(m.f.phase === 'wartet', 'vor der Frist bleibt er stehen (Abstand nicht umgangen)');
  spruenge(m.g, FRIST); lauf(m.g, 2);
  ok(m.f.phase === 'abgeschlossen' && m.f.ausgang.art === 'gelungen' && nFaden(m.g) === 0, 'nach der Frist schliesst er ab und bleibt GELUNGEN (die erfuellte Rettung kippt nicht) (' + (m.f.ausgang && m.f.ausgang.art) + ')');
  const ge = m.f.nsc.gedaechtnis.map((e) => e.ereignis);
  ok(ge.includes('notruf_gelungen') && !ge.includes('notruf_gescheitert') && ge.includes('rettung_gelungen'), 'das Gedaechtnis bleibt unberichtigt (notruf_gelungen, rettung_gelungen): ' + ge.join(','));
});

section('I: Im-Stich-Lassen (Sprung vor/waehrend einer Gefahr) beendet auch einen laufenden Beat rettung', () => {
  const { g, f } = inRettung(false);
  const marke = f.notruf.marke;
  ok(typ(f) === 'rettung' && f.phase === 'laeuft', 'Ausgangslage: rettung laeuft');
  ok(FP3.notrufImStich(g, marke) === true, 'notrufImStich nimmt den Faden');
  ok(f.phase !== 'laeuft' && f.ausgang !== undefined, 'der laufende Beat ist beendet (Phase ' + f.phase + ', Beat ' + typ(f) + ')');
  lauf(g, 2);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && nFaden(g) === 0, 'der Abschluss kommt gescheitert, der Platz ist frei');
});

section('J: im Betrieb verdrahtet: g.step ruft den Takt, kein Test ruft die Funktion selbst', () => {
  const { g, f } = inRettung(true);
  spruenge(g, FRIST);
  lauf(g, 2);
  ok(f.phase === 'abgeschlossen' && nFaden(g) === 0, 'der Takt beendet den haengenden Faden (Phase ' + f.phase + ')');
  ok(g.errors === 0, 'keine Fehler gezaehlt (' + g.errors + ')');
});

console.log('\n' + (n - fails) + '/' + n + ' Pruefungen ok');
if (fails) { console.log('FADEN-RETTUNG-HAENGER: ' + fails + ' FEHLER'); process.exit(1); }
console.log('FADEN-RETTUNG-HAENGER OK');
