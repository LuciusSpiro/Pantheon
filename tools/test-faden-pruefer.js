'use strict';
// SUND-04a-2 P3: kein Platzhalter mehr (der Baustein bitte ist echt, faden-bausteine.js registriert ihn)
// SUND-04a-1 B: Daten, Beat-Katalog und der EINE Pruefer fuer alle Faeden (server/sim/faden-pruefer.js). Jede Regel wird einzeln gebrochen: die Testvorlage (reine Daten, tools/fixtures/faeden) laeuft
// unveraendert durch, jede Abwandlung bricht GENAU die eine Regel (erwartet wird der Code der Regel, nicht eine Zahl aus dem Produktivcode). Dazu: ein neuer Beat nur als Katalogeintrag, die Wirkung
// haltung_aenderung (Katalog, Kern bleibt bitgleich), die Kurve der Haltung.        node tools/test-faden-pruefer.js
const X = require('./faden-fixture.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Wirkungen = require('../server/weltsim/wirkungen.js');
const Kern = require('../server/weltsim/kern.js');
const Daten = require('../server/weltsim/daten.js');

const { D, Faden, klon, vorlageTest } = X;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
const codes = (v) => Pruefer.pruefeVorlage(v).fehler.map((t) => t.split(':')[0]);
const hat = (v, code) => codes(v).includes(code);
const beat = (v, id) => v.beats.find((b) => b.id === id);

section('Daten und Beat-Katalog', () => {
  // SUND-04a-2 P1: der Katalog wächst um raumschlacht, befreiung, fracht (neun Typen); bitte, enthuellung, notruf, abschluss bleiben Platzhalter bis P3
  ok(JSON.stringify(Object.keys(D.BEATS).sort()) === JSON.stringify(['abschluss', 'befreiung', 'bitte', 'enthuellung', 'fracht', 'notruf', 'raumschlacht', 'spontanhilfe', 'verfolgung']), 'neun Beat-Typen im Katalog (Daten, nicht im Code): ' + Object.keys(D.BEATS).join(', '));
  const Bs = require('../server/sim/faden-bausteine.js');
  require('../server/sim/faden-szene.js');   // registriert die Bausteine der P1-Szenen
  // SUND-04a-2 P3: alle Katalog-Bausteine sind echt (P1: Szenen und Fracht, P2: bitte, P3: notruf, enthuellung, abschluss); kein Platzhalter bleibt
  ok(Object.values(D.BEATS).every((e) => Bs.vonId(e.baustein) && !Bs.istPlatzhalter(e.baustein)), 'zu jedem Beat gibt es einen benannten Baustein, und alle sind echt (keine Platzhalter mehr)');
  ok(Object.values(D.BEATS).every((e) => ['keine', 'erlaubt'].includes(e.optionen) && typeof e.gefahr === 'boolean'), 'jeder Beat sagt, ob er Gefahr bringt und ob er Optionen erlaubt');
  ok(D.BEATS.verfolgung.gefahr === true && D.BEATS.spontanhilfe.gefahr === true && D.BEATS.bitte.gefahr === false, 'Verfolgung und Spontanhilfe bringen Gefahr, die Bitte nicht');
  ok(D.WERTE.aktiv_max === 3 && D.WERTE.abstand.min === 2 && D.WERTE.abstand.max === 4 && D.WERTE.gedaechtnis_max === 12, 'Zahlen der Vorgabe: hoechstens 3 aktive Faeden, Abstand 2 bis 4, Gedaechtnis 12');
  for (const vk of D.WERTE.voelker) {
    const L = D.NAMEN[vk];
    ok(L && ['vornamen', 'nachnamen', 'schiffe', 'klassen'].every((k) => Array.isArray(L[k]) && L[k].length >= (k === 'klassen' ? 2 : 6) && new Set(L[k]).size === L[k].length), `Namenlisten ${vk}: Vornamen, Nachnamen, Schiffe, Klassen ohne Doppelte`);
  }
  ok(!require('fs').readdirSync(D.DIR + '/vorlagen').some((f) => /test/.test(f)), 'content/faeden/vorlagen enthaelt keine Testvorlage');
});

section('Die Testvorlage laeuft ohne Codeaenderung durch den Pruefer', () => {
  const r = Pruefer.pruefeVorlage(vorlageTest());
  ok(r.ok && r.fehler.length === 0, 'gueltig: ' + r.fehler.join('; '));
  ok(D.registriere(vorlageTest()).ok && D.vorlage('test_geschichte').beats.length === 6, 'registriert, sechs Beats');
  ok(Object.isFrozen(D.vorlage('test_geschichte')) && Object.isFrozen(D.vorlage('test_geschichte').beats[0]), 'das Register haelt eingefrorene Kopien (nichts veraendert eine geprueft Vorlage)');
  const typen = vorlageTest().beats.map((b) => b.typ);
  ok(JSON.stringify(typen) === JSON.stringify(['bitte', 'spontanhilfe', 'notruf', 'enthuellung', 'verfolgung', 'abschluss']), 'sie benutzt alle sechs Katalog-Beats');
  const roh = JSON.parse(JSON.stringify(vorlageTest())); roh.beats[0].zusatz = 1;
  ok(hat(roh, 'FORM'), 'Form: ein unbekanntes Feld wird abgelehnt (FORM)');
  const roh2 = vorlageTest(); delete roh2.titel;
  ok(hat(roh2, 'FORM'), 'Form: ein fehlendes Pflichtfeld wird abgelehnt (FORM)');
  const r3 = D.registriere(Object.assign(vorlageTest(), { id: 'schlecht', beats: [] }));
  ok(!r3.ok && D.vorlage('schlecht') === null, 'eine ungueltige Vorlage kommt nie ins Register (wird nie gespielt)');
});

// [Text, Aenderung der Testvorlage, erwarteter Code]
const REGELN = [
  ['kein Hinweis vor der Enthuellung', (v) => { delete beat(v, 'b_bitte').hinweise; }, 'HINWEIS_FEHLT'],
  ['Hinweis erst NACH der Enthuellung', (v) => { delete beat(v, 'b_bitte').hinweise; beat(v, 'b_ende').hinweise = ['h_papiere']; }, 'HINWEIS_FEHLT'],
  ['Hinweis nur auf einem von zwei Wegen zur Enthuellung', (v) => { delete beat(v, 'b_bitte').hinweise; beat(v, 'b_notruf').hinweise = ['h_papiere']; }, 'HINWEIS_FEHLT'],
  ['Hinweis ist nicht beschrieben', (v) => { beat(v, 'b_bitte').hinweise = ['gibt_es_nicht']; }, 'HINWEIS_UNBEKANNT'],
  ['Hinweis mit unbekanntem Kanal', (v) => { v.hinweise.h_papiere.kanal = 'telepathie'; }, 'HINWEIS_UNBEKANNT'],
  ['Enthuellung ohne verborgene Wahrheit', (v) => { delete v.wahrheit; }, 'ENTHUELLUNG_OHNE_WAHRHEIT'],
  ['verborgene Wahrheit ohne Enthuellung', (v) => { beat(v, 'b_enthuell').typ = 'notruf'; }, 'WAHRHEIT_OHNE_ENTHUELLUNG'],
  ['Abschluss nicht als letzter Beat', (v) => { beat(v, 'b_spontan').typ = 'abschluss'; }, 'ABSCHLUSS_NICHT_LETZT'],
  ['letzter Beat ist kein Abschluss', (v) => { beat(v, 'b_ende').typ = 'notruf'; }, 'ABSCHLUSS_FEHLT'],
  ['Verfolgung ohne Fluchtziel', (v) => { delete beat(v, 'b_jagd').parameter; }, 'FLUCHTZIEL_FEHLT'],
  ['Verfolgung mit unsinnigem Fluchtziel', (v) => { beat(v, 'b_jagd').parameter.fluchtziel = 'irgendwo'; }, 'FLUCHTZIEL_FEHLT'],
  ['Ausgang gescheitert fehlt', (v) => { delete beat(v, 'b_notruf').aus.gescheitert; }, 'AUSGANG_FEHLT'],
  ['Ausgang gelungen fehlt', (v) => { delete beat(v, 'b_spontan').aus.gelungen; }, 'AUSGANG_FEHLT'],
  ['Abschluss ohne Ausgaenge', (v) => { beat(v, 'b_ende').aus = {}; }, 'AUSGANG_FEHLT'],
  ['Scheitern aendert nichts (gleicher Zustand, gleicher Weg)', (v) => { beat(v, 'b_spontan').aus.gescheitert = klon(beat(v, 'b_spontan').aus.gelungen); }, 'SCHEITERN_FOLGENLOS'],
  ['Scheitern ohne Zustand des NSC', (v) => { delete beat(v, 'b_spontan').aus.gescheitert.status; }, 'AUSGANG_UNGUELTIG'],
  ['Ausgang mit unbekanntem Zustand', (v) => { beat(v, 'b_spontan').aus.gescheitert.status = 'verschwunden'; }, 'AUSGANG_UNGUELTIG'],
  ['weiter zeigt auf keinen Beat', (v) => { beat(v, 'b_spontan').aus.gescheitert.weiter = 'b_nirgends'; }, 'WEITER_UNGUELTIG'],
  ['weiter geht zurueck', (v) => { beat(v, 'b_notruf').aus.gescheitert.weiter = 'b_bitte'; }, 'WEITER_UNGUELTIG'],
  ['Abschluss fuehrt irgendwohin weiter', (v) => { beat(v, 'b_ende').aus.gelungen.weiter = 'b_bitte'; }, 'AUSGANG_UNGUELTIG'],
  ['unbekannter Beat-Typ (nur Katalogbausteine)', (v) => { beat(v, 'b_spontan').typ = 'wunder'; }, 'TYP_UNBEKANNT'],
  ['doppelte Beat-Id', (v) => { beat(v, 'b_notruf').id = 'b_spontan'; }, 'ID_DOPPELT'],
  ['NSC im falschen Zustand fuer den Beat (tot, dann Spontanhilfe)', (v) => { beat(v, 'b_bitte').aus.gelungen.status = 'tot'; }, 'STATUS_PASST_NICHT'],
  ['ein toter NSC wird wieder lebendig', (v) => { beat(v, 'b_bitte').aus.gelungen.status = 'tot'; beat(v, 'b_bitte').aus.gelungen.weiter = 'b_notruf'; }, 'TOT_BLEIBT_TOT'],
  ['ein Beat wird auf keinem Weg erreicht', (v) => { beat(v, 'b_bitte').aus.gescheitert.weiter = 'b_spontan'; }, 'UNERREICHBAR'],
  ['Optionen bei Gefahr (Spontanhilfe)', (v) => { beat(v, 'b_spontan').optionen = klon(beat(v, 'b_bitte').optionen); }, 'OPTION_BEI_GEFAHR'],
  ['Optionen bei Gefahr (Vorlage setzt gefahr an der Bitte)', (v) => { beat(v, 'b_bitte').gefahr = true; }, 'OPTION_BEI_GEFAHR'],
  ['Optionen bei einem Beat-Typ ohne Optionen (Notruf)', (v) => { beat(v, 'b_notruf').optionen = klon(beat(v, 'b_bitte').optionen); }, 'OPTIONEN_NICHT_ERLAUBT'],
  ['die Vorlage schwaecht die Gefahr der Verfolgung ab', (v) => { beat(v, 'b_jagd').gefahr = false; }, 'GEFAHR_ABGESCHWAECHT'],
  ['Scheinwahl: zwei Optionen mit derselben Wirkung', (v) => { beat(v, 'b_bitte').optionen[1].folge = [{ typ: 'haltung_aenderung', grund: 'gedankt' }]; beat(v, 'b_bitte').optionen[0].folge = [{ typ: 'haltung_aenderung', grund: 'geholfen' }]; delete beat(v, 'b_bitte').optionen[1].ausgang; }, 'SCHEINWAHL'],
  ['Scheinwahl: zwei folgenlose Optionen', (v) => { beat(v, 'b_bitte').optionen[0].folge = []; delete beat(v, 'b_bitte').optionen[1].ausgang; beat(v, 'b_bitte').optionen[1].folge = []; }, 'SCHEINWAHL'],
  ['nur eine Option', (v) => { beat(v, 'b_bitte').optionen = beat(v, 'b_bitte').optionen.slice(0, 1); }, 'OPTIONEN_ANZAHL'],
  ['vier Optionen', (v) => { const o = beat(v, 'b_bitte').optionen; o.push({ id: 'vierte', text: 'Noch eine.', folge: [{ typ: 'haltung_aenderung', grund: 'verraten' }] }); }, 'OPTIONEN_ANZAHL'],
  ['Option mit unbekanntem Grund', (v) => { beat(v, 'b_bitte').optionen[0].folge = [{ typ: 'haltung_aenderung', grund: 'gibt_es_nicht' }]; }, 'FOLGE_UNGUELTIG'],
  ['Option mit Wirkung ausserhalb der erlaubten (flotte_verlust)', (v) => { beat(v, 'b_bitte').optionen[0].folge = [{ typ: 'flotte_verlust', grund: 'x' }]; }, 'FOLGE_UNGUELTIG'],
  ['Ausgang mit unbekanntem Ruf-Grund', (v) => { beat(v, 'b_notruf').aus.gelungen.folge = [{ typ: 'ruf_aenderung', grund: 'gibt_es_nicht' }]; }, 'FOLGE_UNGUELTIG'],
  ['unbekannter Parameter am Beat', (v) => { beat(v, 'b_bitte').parameter.zauberei = 'ja'; }, 'PARAMETER'],
  ['Parameter mit Objekt als Wert (das Schema greift vor dem Pruefer)', (v) => { beat(v, 'b_bitte').parameter.text_key = { a: 1 }; }, 'FORM'],
  ['Abstand ausserhalb 2 bis 4 (erweitern ist verboten)', (v) => { v.abstand = { min: 1, max: 5 }; }, 'ABSTAND'],
  ['Abstand min groesser als max', (v) => { v.abstand = { min: 4, max: 2 }; }, 'ABSTAND'],
  ['unbekanntes Volk', (v) => { v.volk_erlaubt = ['rom', 'atlantis']; }, 'VOLK'],
  ['Ausloeser mit unbekannter Art', (v) => { v.ausloeser = [{ art: 'lotterie', ausgang: 'gelungen' }]; }, 'AUSLOESER'],
  ['unbekannte Schiffsklasse', (v) => { v.nsc.klassen = ['schlachtschiff']; }, 'NSC'],
  ['unbekannter Start-Zustand des NSC', (v) => { v.nsc.status = 'schlaeft'; }, 'NSC'],
];
section('Jede Regel des Pruefers einzeln (die Aenderung bricht genau diese Regel)', () => {
  for (const [text, aendern, code] of REGELN) {
    const v = vorlageTest(); aendern(v);
    ok(hat(v, code), `${text} -> ${code}  (Fehler: ${codes(v).join(', ') || 'keiner'})`);
    ok(!D.registriere(Object.assign(v, { id: 'abgelehnt_' + code.toLowerCase() })).ok, '    und die Vorlage kommt nicht ins Register');
  }
});

section('Was NICHT bricht (Gegenproben: die Regeln sind keine Pauschalverbote)', () => {
  const g = (aendern) => { const v = vorlageTest(); aendern(v); return Pruefer.pruefeVorlage(v); };
  ok(g((v) => { beat(v, 'b_jagd').parameter.fluchtziel = '0305'; }).ok, 'ein Hex-Code ist ein gueltiges Fluchtziel');
  ok(g((v) => { beat(v, 'b_jagd').parameter.fluchtziel = 'heimat'; }).ok, 'ein Symbol aus den Daten ist ein gueltiges Fluchtziel');
  ok(g((v) => { v.abstand = { min: 3, max: 3 }; }).ok, 'eine Vorlage darf den Abstand verengen (3 bis 3)');
  ok(g((v) => { beat(v, 'b_bitte').hinweise = ['h_papiere', 'h_papiere']; }).ok, 'derselbe Hinweis zweimal ist kein Fehler');
  ok(g((v) => { delete beat(v, 'b_bitte').hinweise; beat(v, 'b_spontan').hinweise = ['h_papiere']; beat(v, 'b_notruf').hinweise = ['h_papiere']; }).ok, 'der Hinweis kann auch spaeter kommen, solange jeder Weg vor der Enthuellung einen hat');
  ok(g((v) => { delete beat(v, 'b_bitte').optionen; }).ok, 'ein Beat darf ohne Optionen sein');
  ok(g((v) => { delete v.nsc; }).ok, 'nsc ist optional (Standard: aktiv, Haltung 0)');
  ok(g((v) => { delete v.wahrheit; beat(v, 'b_enthuell').typ = 'notruf'; delete v.hinweise; delete beat(v, 'b_bitte').hinweise; }).ok, 'eine Vorlage ohne verborgene Wahrheit braucht keinen Hinweis');
});

section('Ein neuer Beat ist nur ein Katalogeintrag (kein Umbau)', () => {
  D.BEATS.gespraech = { zweck: 'Probe', baustein: 'bitte', gefahr: false, optionen: 'erlaubt', braucht: { nsc_status: ['aktiv', 'verbuendet'] }, parameter: { pflicht: [], optional: ['text_key'] } };
  try {
    const v = vorlageTest(); v.id = 'mit_gespraech'; beat(v, 'b_spontan').typ = 'gespraech';
    ok(Pruefer.pruefeVorlage(v).ok, 'ein Beat des Typs gespraech (neuer Katalogeintrag, vorhandener Baustein) laeuft durch denselben Pruefer');
    D.BEATS.gespraech.gefahr = true;
    const v2 = vorlageTest(); beat(v2, 'b_spontan').typ = 'gespraech'; beat(v2, 'b_spontan').optionen = klon(beat(v2, 'b_bitte').optionen);
    ok(hat(v2, 'OPTION_BEI_GEFAHR'), 'steht im Eintrag gefahr: true, gilt die Regel „nie Optionen bei Gefahr“ fuer ihn, ohne dass der Pruefer ihn kennt');
    D.BEATS.gespraech.baustein = 'gibt_es_nicht';
    ok(hat(v2, 'BAUSTEIN_FEHLT'), 'ein Eintrag mit unbekanntem Baustein wird abgelehnt (BAUSTEIN_FEHLT)');
  } finally { delete D.BEATS.gespraech; }
  ok(hat(Object.assign(vorlageTest(), { beats: vorlageTest().beats.map((b) => (b.id === 'b_spontan' ? Object.assign(b, { typ: 'gespraech' }) : b)) }), 'TYP_UNBEKANNT'), 'ohne den Eintrag ist der Typ wieder unbekannt');
  const alt = D.WERTE.beats_max; D.WERTE.beats_max = 5;
  try { ok(hat(vorlageTest(), 'BEATS_ANZAHL'), 'mehr Beats als beats_max (Daten) -> BEATS_ANZAHL'); } finally { D.WERTE.beats_max = alt; }
});

section('Faden im Zustand (pruefeFaden)', () => {
  D.registriere(vorlageTest());
  const f = () => ({ id: 'f1', vorlage: 'test_geschichte', parameter: { volk: 'rom', ort: '0305', name: 'Lucius Varro' }, beat: 0, phase: 'wartet', zaehler: 0, abstand: 2, laufend: null, hinweise: [], ausgang: null, begonnen: 0,
    nsc: { id: 'n1', name: 'Lucius Varro', fraktion: 'rom', schiff: 'Fortuna', schiffsklasse: 'frachter', status: 'aktiv', haltung: 0, gedaechtnis: [], wahrheit: { id: 'ist_germane', offenbart: false }, portrait: 5 } });
  ok(Pruefer.pruefeFaden(f()).length === 0, 'ein gueltiger Faden hat keine Fehler');
  let x = f(); x.phase = 'abgeschlossen'; x.beat = 5;
  ok(Pruefer.pruefeFaden(x).some((t) => /^FADEN_OHNE_AUSGANG/.test(t)), 'abgeschlossen ohne Ausgang -> FADEN_OHNE_AUSGANG (kein Faden ohne Ausgang)');
  x = f(); x.phase = 'abgeschlossen'; x.beat = 2; x.ausgang = { art: 'gelungen', status: 'aktiv', tick: 1 };
  ok(Pruefer.pruefeFaden(x).some((t) => /^FADEN_OHNE_ABSCHLUSS/.test(t)), 'abgeschlossen ausserhalb des Abschluss-Beats -> FADEN_OHNE_ABSCHLUSS (ein Faden endet nur im Abschluss)');
  x = f(); x.nsc.wahrheit.offenbart = true;
  ok(Pruefer.pruefeFaden(x).some((t) => /^HINWEIS_FEHLT/.test(t)), 'enthuellt ohne je einen Hinweis -> HINWEIS_FEHLT');
  x.hinweise = ['h_papiere'];
  ok(Pruefer.pruefeFaden(x).length === 0, 'mit Hinweis ist es gueltig');
  x = f(); x.abstand = 9;
  ok(Pruefer.pruefeFaden(x).some((t) => /^ABSTAND/.test(t)), 'Abstand ausserhalb 2 bis 4 -> ABSTAND');
  x = f(); x.nsc.gedaechtnis = Array.from({ length: 13 }, (_, i) => ({ tick: i, ereignis: 'e', text_key: 'k' }));
  ok(Pruefer.pruefeFaden(x).some((t) => /^NSC/.test(t)), 'Gedaechtnis ueber 12 Eintraege -> NSC');
  x = f(); x.vorlage = 'gibt_es_nicht';
  ok(Pruefer.pruefeFaden(x)[0].startsWith('FADEN_OHNE_VORLAGE'), 'unbekannte Vorlage -> FADEN_OHNE_VORLAGE');
});

section('Wirkung haltung_aenderung (Katalog, Aufsatz)', () => {
  const k = Wirkungen.KATALOG.haltung_aenderung;
  ok(k && Wirkungen.istAufsatz('haltung_aenderung') && typeof k.pruefe === 'function' && k.anwenden.length === 0, 'im Katalog, als Aufsatz-Wirkung markiert (Anwender leer)');
  const pr = (w) => Wirkungen.pruefe(Kern.erzeuge({ karte: Daten.laden().karte, werte: Daten.laden().werte, seed: 1 }), w);
  const gut = { typ: 'haltung_aenderung', npc: 'n1', delta: 1, grund: 'geholfen' };
  ok(pr(gut).ok, 'gueltig: npc, kleines delta, bekannter Grund');
  ok(!pr(Object.assign({}, gut, { npc: 'Lucius' })).ok && !pr(Object.assign({}, gut, { npc: 7 })).ok && !pr(Object.assign({}, gut, { npc: undefined })).ok, 'npc muss eine Kennung n<Zahl> sein');
  ok(!pr(Object.assign({}, gut, { delta: 0 })).ok && !pr(Object.assign({}, gut, { delta: 'viel' })).ok && !pr(Object.assign({}, gut, { delta: NaN })).ok, 'delta: nicht 0, keine Zahl, NaN abgelehnt');
  ok(!pr(Object.assign({}, gut, { delta: 4, grund: 'gerettet' })).ok, 'delta 4 ueberschreitet die Grenze (delta_max 3)');
  ok(!pr(Object.assign({}, gut, { grund: 'gibt_es_nicht' })).ok && !pr(Object.assign({}, gut, { grund: undefined })).ok, 'unbekannter Grund abgelehnt');
  ok(!pr(Object.assign({}, gut, { delta: -1 })).ok, 'das Vorzeichen muss zum Grund passen (geholfen ist positiv)');
  ok(!pr(Object.assign({}, gut, { delta: 2 })).ok && pr(Object.assign({}, gut, { delta: 0.5 })).ok, 'der Betrag darf den des Grundes nicht uebersteigen, weniger ist erlaubt');
  ok(pr({ typ: 'haltung_aenderung', npc: 'n2', delta: -2, grund: 'im_stich_gelassen' }).ok, 'negative Gruende gelten mit negativem delta');
  // Der Kern bleibt rein: ein Tick mit der Wirkung ist bitgleich zu einem ohne
  const frisch = () => Kern.erzeuge({ karte: Daten.laden().karte, werte: Daten.laden().werte, seed: 11 });
  const a = frisch(), b = frisch();
  for (let i = 0; i < 12; i++) { Kern.tick(a, { wirkungen: [] }); Kern.tick(b, { wirkungen: i % 3 === 0 ? [gut] : [] }); }
  const ohneKarte = (z) => JSON.stringify(Object.assign({}, z, { werte: undefined, karte: undefined }));
  ok(ohneKarte(a) === ohneKarte(b), 'Kern.tick mit haltung_aenderung: der Sim-Zustand ist bitgleich zu einem Tick ohne (der Kern ignoriert die Wirkung)');
  ok(Kern.filtereWirkungen(frisch(), [gut, { typ: 'haltung_aenderung', npc: 'x', delta: 1, grund: 'geholfen' }]).gueltig.length === 1, 'filtereWirkungen: die gueltige geht durch, die ungueltige wird verworfen');
});

section('Haltung: Kurve, Ton, feindliche Wiederkehr (Daten)', () => {
  const K = D.HALTUNG.kurve_spontanhilfe;
  ok(K.every((p, i) => i === 0 || (p[0] > K[i - 1][0] && p[1] >= K[i - 1][1])), 'die Kurve in den Daten ist aufsteigend');
  const c = (h) => Faden.chanceSpontanhilfe({ haltung: h });
  ok(c(-10) === 0 && c(-5) === 0, 'sehr schlechte Haltung: keine Spontanhilfe');
  ok(Math.abs(c(0) - 0.25) < 1e-9 && Math.abs(c(4) - 0.6) < 1e-9 && Math.abs(c(10) - 0.95) < 1e-9, 'an den Stuetzpunkten genau die Datenwerte (0 -> 0,25; 4 -> 0,6; 10 -> 0,95)');
  ok(Math.abs(c(2) - 0.425) < 0.011, 'dazwischen linear: 2 -> etwa 0,425 (Mitte von 0,25 und 0,6), ' + c(2));
  let mono = true; for (let h = -10; h < 10; h += 0.5) if (c(h + 0.5) < c(h) - 1e-9) mono = false;
  ok(mono, 'je besser die Haltung, desto hoeher die Chance (nie fallend)');
  ok(c(99) === 0.95 && c(-99) === 0 && c(undefined) === c(0), 'ausserhalb der Grenzen geklemmt, ohne Wert wie 0');
  ok(Faden.tonVon({ haltung: -5 }) === 'kalt' && Faden.tonVon({ haltung: 0 }) === 'sachlich' && Faden.tonVon({ haltung: 6 }) === 'herzlich', 'Ton: kalt, sachlich, herzlich je Haltung');
  ok(Faden.kehrtFeindlichWieder({ haltung: -7 }) && !Faden.kehrtFeindlichWieder({ haltung: -5 }) && !Faden.kehrtFeindlichWieder({ haltung: 3 }), 'feindlich wiederkehren: nur unter -6');
  ok(Faden.haltungVon({ haltung: 55 }) === 10 && Faden.haltungVon(null) === 0, 'haltungVon: geklemmt, ohne NSC 0');
  ok(Faden.portraetVon({ portrait: 100003 }) >= 0 && Faden.portraetVon({ portrait: 100003 }) < D.WERTE.portrait.varianten, 'Portraet-Seed waehlt eine von wenigen Varianten');
});

section('text_key und Beat-Katalog gegen das Gedaechtnis-Schema (Review B-M1)', () => {
  for (const schlecht of ['Ende_Verpasst', 'ende-verpasst', 'ende verpasst', 'ende!', '']) {
    const v = vorlageTest(); beat(v, 'b_bitte').aus.gescheitert.text_key = schlecht;
    ok(codes(v).some((c) => c === 'TEXT_KEY' || c === 'FORM'), `text_key "${schlecht}" im Ausgang: TEXT_KEY (Schema verlangt ^[a-z0-9_]{1,40}$)`);
    ok(!D.registriere(Object.assign(v, { id: 'tk_' + (schlecht.length) + '_' + Math.random().toString(36).slice(2, 6) })).ok, '    und die Vorlage kommt nicht ins Register');
  }
  const gut = vorlageTest(); beat(gut, 'b_bitte').aus.gescheitert.text_key = 'ende_verpasst_2';
  ok(!hat(gut, 'TEXT_KEY'), 'gueltiger text_key (a-z, 0-9, _): kein TEXT_KEY');
  const lang = vorlageTest(); beat(lang, 'b_bitte').aus.gescheitert.text_key = 'a'.repeat(41);
  ok(codes(lang).some((c) => c === 'TEXT_KEY' || c === 'FORM'), 'text_key mit 41 Zeichen: TEXT_KEY');
  // B-M1 (Prueferbefund 2): text_key im Beat-PARAMETER folgt demselben Muster wie im Ausgang (nicht nur die Laenge)
  for (const schlecht of ['Bitte_Mission', 'bitte-mission', 'bitte mission', 'ä_mission', 5]) {
    const v = vorlageTest(); beat(v, 'b_bitte').parameter.text_key = schlecht;
    ok(codes(v).some((c) => c === 'TEXT_KEY' || c === 'FORM'), `text_key ${JSON.stringify(schlecht)} im Beat-Parameter: abgelehnt (Muster ^[a-z0-9_]{1,40}$; Schema und Pruefer)`);
    ok(!D.registriere(Object.assign(v, { id: 'tkp_' + Math.random().toString(36).slice(2, 8) })).ok, '    und die Vorlage kommt nicht ins Register');
  }
  for (const schlecht of ['a'.repeat(41), '']) {
    const v = vorlageTest(); beat(v, 'b_bitte').parameter.text_key = schlecht;
    ok(codes(v).some((c) => c === 'TEXT_KEY' || c === 'PARAMETER' || c === 'FORM'), `text_key ${schlecht.length} Zeichen im Beat-Parameter: abgelehnt`);
  }
  const gutP = vorlageTest(); beat(gutP, 'b_bitte').parameter.text_key = 'bitte_mission_2';
  ok(!hat(gutP, 'TEXT_KEY') && !codes(gutP).includes('FORM'), 'gueltiger text_key im Beat-Parameter (a-z, 0-9, _): kein TEXT_KEY, keine Formfehler');
  // Die beiden Schichten einzeln: das Schema allein (Formpruefung) und der Pruefer allein (Schema-Pruefung kurzgeschlossen).
  // Ohne diese Trennung wuerde eine Regel-Mutation in einer der Schichten unbemerkt bleiben, weil die andere sie abfaengt.
  {
    const WS = require('../server/weltstand.js');
    const S = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'content', 'schema', 'faden-vorlage.schema.json'), 'utf8'));
    const schlechteTK = ['Bitte_Mission', 'bitte-mission', 'bitte mission', 5];
    for (const schlecht of schlechteTK) {
      const v = vorlageTest(); beat(v, 'b_bitte').parameter.text_key = schlecht;
      ok(WS.fallbackValidate(v, S).some((t) => /text_key/.test(t)), `Schema (Schicht 1): text_key ${JSON.stringify(schlecht)} im Beat-Parameter wird abgelehnt`);
    }
    const vg = vorlageTest(); beat(vg, 'b_bitte').parameter.text_key = 'bitte_mission_2';
    ok(!WS.fallbackValidate(vg, S).some((t) => /text_key/.test(t)), 'Schema (Schicht 1): gueltiger text_key im Beat-Parameter wird nicht abgelehnt');
    const original = WS.fallbackValidate;
    try {
      WS.fallbackValidate = () => [];   // Schicht 1 kurzschliessen: nur der Pruefer (Schicht 2) entscheidet
      for (const schlecht of schlechteTK) {
        const v = vorlageTest(); beat(v, 'b_bitte').parameter.text_key = schlecht;
        ok(Pruefer.pruefeVorlage(v).fehler.some((t) => t.startsWith('TEXT_KEY')), `Pruefer (Schicht 2): text_key ${JSON.stringify(schlecht)} im Beat-Parameter -> TEXT_KEY`);
      }
      ok(!Pruefer.pruefeVorlage(vg).fehler.some((t) => t.startsWith('TEXT_KEY')), 'Pruefer (Schicht 2): gueltiger text_key im Beat-Parameter -> kein TEXT_KEY');
    } finally { WS.fallbackValidate = original; }
  }
  ok(Pruefer.katalogFehler().length === 0, 'der Beat-Katalog passt zum Gedaechtnis-Schema');
  const B = D.BEATS;
  B['Mit-Bindestrich'] = Object.assign({}, B.bitte, { baustein: 'bitte' });
  try {
    ok(Pruefer.katalogFehler().some((t) => /KATALOG_EREIGNIS/.test(t) && /Mit-Bindestrich/.test(t)), 'ein Beat-Typ mit Bindestrich: KATALOG_EREIGNIS (der Katalog wird geprueft)');
  } finally { delete B['Mit-Bindestrich']; }
  B['Gross'] = Object.assign({}, B.bitte, { baustein: 'bitte' });
  try { ok(Pruefer.katalogFehler().some((t) => /Gross/.test(t)), 'Beat-Typ mit Grossbuchstaben: KATALOG_EREIGNIS'); } finally { delete B['Gross']; }
  B['mit leer'] = Object.assign({}, B.bitte, { baustein: 'bitte' });
  try { ok(Pruefer.katalogFehler().some((t) => /mit leer/.test(t)), 'Beat-Typ mit Leerzeichen: KATALOG_EREIGNIS'); } finally { delete B['mit leer']; }
  ok(Pruefer.katalogFehler().length === 0, 'nach dem Aufraeumen wieder ohne Befund');
});


console.log(`\n${n - fails}/${n} Pruefungen ok`);
if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
console.log('FADEN-PRUEFER OK');
