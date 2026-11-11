'use strict';
// FRE-02 C: der Vorrat der Absichten ist verdrahtet (server/sim/abenteuer-vorrat.js einlegenAus und ausVorratOhneSperre, abenteuer-brett.js beiTaetigkeit/ablehnen/beiAndocken/ausVorratEinsAnbieten,
// abenteuer-spielleiter.js beiGrenze, weltstand.js verwirfUngueltige nach dem Laden). Alles nur im Modus Absichten (ABENTEUER_ABSICHTEN=1, Opt-in); ohne ihn bleibt alles wie vorher.
// Geprueft (an eigenen Welten, Erwartungen aus den Daten und dem Test selbst):
//  Einlegen: Verfall nach angebot_gilt_taetigkeiten und Ablehnen legen ein, ein veraltetes Angebot und eines ohne Absicht nie · Entnehmen vor dem Komponisten (Zaehler aufrufe) beim Andocken und an den anderen Grenzen ·
//  Sperre: das abgelehnte Angebot kommt nicht sofort wieder, die anderen schon · Gueltigkeit mit echten Ereignissen (NSC tot, Posten gefallen) · vorrat_max · Speichern und Laden (verwirfUngueltige) ·
//  das Alter bleibt beim Einlegen (kreist nicht ewig) · ohne Modus Absichten: Vorrat leer, Verlauf wie mit dem alten Ablauf des Andockens · Obergrenzen · verschiedene Ziele, Herkunft Hafen · Telemetrie sieht andocken einmal.
// Aufruf: node tools/test-abenteuer-vorrat-verdrahtet.js        (npm run test:abenteuer-vorrat-verdrahtet)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const INS = require('../server/sim/inszenierer.js');
const AP = require('../server/sim/absicht-pruefer.js');
const V = require('../server/sim/abenteuer-vorrat.js');

const { D, Faden, F } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const KAT = AP.katalogStandard();
const MAX = KAT.werte.vorrat_max.wert, ALTER = KAT.werte.vorrat_alter_max.wert;
const WERTE = lies('content/faeden/werte.json').werte.abenteuer.wert;
const MAXA = WERTE.angebote_max, GILT = WERTE.angebot_gilt_taetigkeiten, RADIUS = WERTE.angebot_radius_spruenge;
const BW = lies('content/faeden/abenteuer-brett.json').werte;
const ART = BW.vorrat_art.wert;
const SPRECHER = BW.hinweis_funk_sprecher.wert;
const NAMEN = ['Mireille_Kas'];
const TEXT = { titel: 'Zebrafalke Probe Titel', einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', preis: 'Ein Preis ohne Namen fuer den Test.' };
const rangAb = (id) => lies('content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === id).ab;

// ---------------------------------------------------------------- Welt
// Spiel mit Lage-Spielleiter (Mock) und Hafen 0305; der Rueckfall ist AUS (ABENTEUER_ANSCHLUSS=0), die Angebote des Spielstarts weg. o.ohne: ohne ABENTEUER_ABSICHTEN, o.deckel: Aufrufe des Komponisten, o.rueckfall: Rueckfall an
function neu(seed, o) {
  o = o || {};
  const env = Object.assign({ FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' }, o.rueckfall ? {} : { ABENTEUER_ANSCHLUSS: '0' }, o.ohne ? {} : { ABENTEUER_ABSICHTEN: '1' });
  const t = F.neuesSpiel({ crew: 1, seed: seed || 7, names: NAMEN, env });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: o.deckel || 0 } });
  t.g.lageSchalter = true;
  hafenSetzen(t.g, '0305');
  zust(t.g).abenteuerAngebote.length = 0;
  return t;
}
const zust = (g) => Faden.zustandVon(g);
const brett = (g) => zust(g).abenteuerAngebote;
const hafenSetzen = (g, hex) => { g.ship.scene = Sektoren.ortVonHex(hex); };
const funkAlle = (t) => t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio');
const andocken = (t) => t.g.missionEvent('docked', {});
const sl = (g) => g.lageSpielleiter.abenteuer;
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const rache = (nsc) => ab('rache', { bezug: { nsc }, ton: 'bitter' });
function biete(g, absicht) {
  const r = INS.anbietenAusAbsicht(g, absicht, KAT);
  if (!r.ok) throw new Error('Angebot nicht gebaut: ' + JSON.stringify(r.fehler));
  return r.angebot;
}
const planOhneAbsicht = { format: 'faden-bauplan/1', titel: 'Probe Auftrag ohne Absicht', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats: [{ typ: 'geruecht' }, { typ: 'abschluss' }] };
// Taetigkeiten direkt ueber die Maschine (ohne Spielleiter-Grenze): es entsteht nichts nebenbei
const tick = (g, k) => { for (let i = 0; i < k; i++) Faden.taetigkeit(g, 'szene_ende'); };
const verfallen = (g) => tick(g, GILT + 1);
const vorrat = (g) => V.liste(g);
const arten = (g) => vorrat(g).map((e) => e.absicht.absicht).sort().join(',');
const ablehnen = (g, a) => Brett.ablehnen(g, 'a' + a.nr);
const sperreLoesen = (g) => { zust(g).brett.abgelehnt.length = 0; };

// Welt mit einem grollenden NSC (Quintus Varro), wie im Test des Vorrats
const plan = (typ, i) => ({ format: 'faden-bauplan/1', titel: typ + ' Probe ' + i, anlass: 'Probeanlass ' + typ + ' Nummer ' + i + ' ohne Namen fuer den Test', beats: [{ typ }, { typ: 'abschluss' }] });
function beende(g, f, ausgang) {
  const v = D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) {
    f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 };
    Faden.beatAusgang(g, f.id, ausgang);
  }
}
function spiele(g, p) {
  const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  beende(g, r.faden, 'gelungen');
  return r.faden;
}
function welt(seed, o) {
  const t = neu(seed, o), g = t.g;
  const f1 = spiele(g, plan('notruf', 1));
  f1.nsc.name = f1.parameter.name = 'Quintus Varro'; f1.nsc.fraktion = 'rom'; f1.nsc.status = 'feindlich'; f1.nsc.haltung = -2;
  const e = zust(g).kanon.find((x) => x.f === f1.id); e.name = 'Quintus Varro'; e.volk = 'rom'; e.status = 'feindlich';
  t.q = f1;
  brett(g).length = 0;
  return t;
}
function postenSetzen(g, hex, besitzer) {
  Object.assign(g.weltsim.zustand.hexe[hex], { besitzer, posten: true, garnison: 4, anspruch: {} });
  if (g.weltBesitz && g.weltBesitz.hexe[hex]) g.weltBesitz.hexe[hex] = { besitzer: { rom: 'rom', ger: 'ger', kon: 'saum' }[besitzer] || 'frei', posten: true };
}
// das echte Ereignis: der Posten faellt an Rom (Wirkung ort_gefallen mit laufender Belagerung, wie tools/test-posten.js)
function postenFaellt(g, hex) {
  const st = g.weltsim.zustand;
  const fl = { id: st.naechsteId++, fraktion: 'rom', heimat: hex, ort: hex, staerke: 20, kap: 20, befehl: 'angriff', ziel: hex, warte: 0, versorgung: 1, angriff: null };
  st.flotten.push(fl);
  const id = st.naechsteAngriffId++;
  st.angriffe.push({ id, t0: st.tick, ziel: hex, von: 'rom', art: 'reich', relevant: true, zielArt: 'posten', t_an: st.tick, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: st.tick, stuetz: null, flotten: [fl.id] });
  fl.angriff = id;
  return Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'ort_gefallen', ort: hex, an: 'rom' }], wo: 'test' });
}

// ======================================================================
console.log('\nDaten und Schnittstelle');
{
  ok(typeof ART === 'string' && new RegExp(KAT.werte.name_muster.wert).test(ART), 'die Art der Vorrat-Eintraege des Bretts steht in abenteuer-brett.json (vorrat_art: ' + ART + ') und passt zu name_muster');
  ok(typeof V.einlegenAus === 'function' && typeof V.ausVorratOhneSperre === 'function' && typeof Brett.ausVorratEinsAnbieten === 'function', 'benannte Funktionen: einlegenAus, ausVorratOhneSperre, ausVorratEinsAnbieten');
  ok(V.eintrag.length === 2 && V.hinzufuegen.length === 2 && V.ausVorrat.length === 2, 'eintrag, hinzufuegen, ausVorrat behalten ihre Parameter (die Schnittstelle fuer FRE-03 bleibt)');
  ok(MAXA === 3 && GILT === 12 && MAX === 6 && ALTER === 24, 'Obergrenzen aus den Daten: ' + MAXA + ' Angebote, Verfall ' + GILT + ', vorrat_max ' + MAX + ', vorrat_alter_max ' + ALTER);
}

console.log('\nEinlegen: Verfall und Ablehnen ja, veraltet und ohne Absicht nie');
{
  const t = welt(21), g = t.g;
  const R = biete(g, ab('rettung')), L = biete(g, ab('lieferung'));
  const X1 = Brett.neuAnbieten(g, planOhneAbsicht, { hex: '0304', herkunft: '0305' }).angebot;
  ok(brett(g).length === MAXA && !!R.absicht && !!L.absicht && !X1.absicht, 'drei Angebote am Brett: zwei mit Absicht, eines ohne');
  ok(R.erstellt === g.weltsim.tickZahl && L.erstellt === g.weltsim.tickZahl && X1.erstellt === undefined, 'das Angebot mit Absicht traegt erstellt (Tick des ersten Erzeugens), eines ohne Absicht nicht');
  ok(vorrat(g).length === 0, 'Vorrat am Anfang leer');
  g.weltsim.tickZahl += 5;
  ok(ablehnen(g, R) === null, 'Ablehnen kostet nichts');
  ok(vorrat(g).length === 1 && vorrat(g)[0].art === ART && vorrat(g)[0].absicht.absicht === 'rettung', 'das abgelehnte Angebot liegt im Vorrat (Art ' + ART + ')');
  ok(vorrat(g)[0].erstellt === R.erstellt && vorrat(g)[0].erstellt < g.weltsim.tickZahl, 'es behaelt sein erstes Alter (erstellt ' + vorrat(g)[0].erstellt + ', jetzt ' + g.weltsim.tickZahl + ')');
  // ein veraltetes Angebot: der NSC des Bezugs ist tot, Annehmen nimmt es vom Brett
  const Vr = biete(g, rache('Quintus Varro'));
  t.q.nsc.status = 'tot';
  const r = Brett.annehmen(g, 'a' + Vr.nr);
  ok(!!r && r.code === 'veraltet' && !brett(g).includes(Vr), 'ein Angebot mit totem Bezug wird beim Annehmen veraltet vom Brett genommen');
  ok(arten(g) === 'rettung', 'ein veraltetes Angebot kommt NICHT in den Vorrat (' + arten(g) + ')');
  verfallen(g);
  ok(brett(g).length === 0, 'nach ' + (GILT + 1) + ' Taetigkeiten ist alles verfallen');
  ok(arten(g) === 'lieferung,rettung', 'das verfallene Angebot mit Absicht liegt im Vorrat, das ohne Absicht nicht (' + arten(g) + ')');
  ok(vorrat(g).length === 2 && vorrat(g).every((e) => e.art === ART), 'zwei Eintraege (abgelehnt und verfallen), beide unter der Art aus den Daten');
  ok(g.errors === 0, 'keine Serverfehler');
}

console.log('\nBeim naechsten Andocken aus dem Vorrat, ohne Komponistenaufruf; verschiedene Ziele, Herkunft Hafen, Telemetrie einmal');
{
  const t = neu(7, { deckel: 4 }), g = t.g;
  const R = biete(g, ab('rettung')), L = biete(g, ab('lieferung')), H = biete(g, ab('falscher_haendler'));
  g.weltsim.tickZahl += 3;
  verfallen(g);
  ok(brett(g).length === 0 && vorrat(g).length === 3 && arten(g) === 'falscher_haendler,lieferung,rettung', 'drei verfallene Angebote liegen im Vorrat');
  const aufrufe0 = sl(g).aufrufe;
  let ruf = 0; const alt = sl(g).beiGrenze.bind(sl(g)); sl(g).beiGrenze = (art) => { ruf++; return alt(art); };
  const f0 = funkAlle(t).length;
  andocken(t);
  const a = brett(g), hex = a.map((x) => x.hex);
  ok(a.length === MAXA, 'beim Andocken ist das Brett voll (' + a.length + ')');
  ok(sl(g).aufrufe === aufrufe0 && sl(g).zustand === 'idle', 'KEIN neuer Komponistenaufruf (aufrufe ' + aufrufe0 + ' -> ' + sl(g).aufrufe + ', Zustand ' + sl(g).zustand + ')');
  ok(ruf === 1, 'der Komponist (Telemetrie-Haken beiGrenze) sieht andocken genau einmal (' + ruf + ')');
  ok(arten(g) === '' && vorrat(g).length === 0, 'die Eintraege sind entnommen, der Vorrat ist leer');
  ok(a.map((x) => x.absicht.absicht).sort().join(',') === 'falscher_haendler,lieferung,rettung', 'es sind die Absichten aus dem Vorrat');
  ok(new Set(hex).size === MAXA && hex.every((h) => h !== '0305'), 'verschiedene Ziele, keines der Hafen (' + hex.join(', ') + ')');
  ok(a.every((x) => x.herkunft && x.herkunft.hex === '0305'), 'Herkunft ist der Hafen');
  ok(a.every((x) => x.erstellt === R.erstellt), 'das erste Alter bleibt am Angebot (erstellt ' + R.erstellt + ')');
  const neuF = funkAlle(t).slice(f0).filter((m) => m.from === SPRECHER);
  ok(neuF.length === 1 && neuF[0].text === BW.sammel_text.wert.split('{n}').join(String(MAXA)), 'genau ein Sammelfunk (' + (neuF[0] && neuF[0].text) + ')');
  ok(logbuch(g).some((e) => e.art === 'abenteuer_anschluss' && e.modus === 'vorrat') && !/Zebrafalke|Mireille/.test(JSON.stringify(logbuch(g).filter((e) => e.modus === 'vorrat'))), 'Logbuch: modus vorrat, ohne Titel und Spielername');
  ok(g.errors === 0, 'keine Serverfehler');
  // Gegentest: ohne Vorrat startet der Komponist wie zuvor
  const t2 = neu(7, { deckel: 4 }), g2 = t2.g;
  ok(vorrat(g2).length === 0 && sl(g2).aufrufe === 0, 'Gegentest: leerer Vorrat, kein Aufruf bisher');
  andocken(t2);
  ok(sl(g2).aufrufe === 1, 'Gegentest: ohne Vorrat startet der Komponist (aufrufe ' + sl(g2).aufrufe + ')');
}

console.log('\nAn den anderen Grenzen: ein Angebot je Grenze aus dem Vorrat, vor dem Komponisten');
{
  const t = neu(7, { deckel: 4 }), g = t.g;
  V.hinzufuegen(g, V.eintrag(g, { absicht: ab('rettung'), art: ART }).eintrag);
  V.hinzufuegen(g, V.eintrag(g, { absicht: ab('lieferung'), art: ART }).eintrag);
  ok(vorrat(g).length === 2, 'zwei Eintraege');
  g.lageGrenze('szene_ende');
  ok(brett(g).length === 1 && vorrat(g).length === 1 && sl(g).aufrufe === 0, 'erste Grenze (szene_ende): ein Angebot aus dem Vorrat, kein Aufruf (aufrufe ' + sl(g).aufrufe + ')');
  g.lageGrenze('szene_ende');
  ok(brett(g).length === 2 && vorrat(g).length === 0 && sl(g).aufrufe === 0, 'zweite Grenze: das zweite, kein Aufruf');
  g.lageGrenze('szene_ende');
  ok(sl(g).aufrufe === 1, 'dritte Grenze: der Vorrat ist leer, jetzt startet der Komponist (aufrufe ' + sl(g).aufrufe + ')');
  ok(g.errors === 0, 'keine Serverfehler');
}

console.log('\nSperre: das abgelehnte Angebot kommt nicht sofort wieder, die anderen schon');
{
  const t = neu(7), g = t.g;
  const R = biete(g, ab('rettung')), L = biete(g, ab('lieferung')), H = biete(g, ab('falscher_haendler'));
  ok(ablehnen(g, R) === null && arten(g) === 'rettung', 'rettung abgelehnt und im Vorrat');
  g.lageGrenze('szene_ende');
  ok(brett(g).length === 2 && arten(g) === 'rettung', 'an der naechsten Grenze mit freiem Platz kommt es NICHT zurueck (es bleibt im Vorrat, gesperrt)');
  // die beiden anderen verfallen: sie kommen beim Andocken wieder, das abgelehnte nicht
  verfallen(g);
  ok(brett(g).length === 0 && arten(g) === 'falscher_haendler,lieferung,rettung', 'die anderen beiden sind verfallen und liegen auch im Vorrat');
  andocken(t);
  const namen = brett(g).map((x) => x.absicht.absicht).sort().join(',');
  ok(namen === 'falscher_haendler,lieferung', 'Andocken: die anderen beiden werden angeboten, das abgelehnte nicht (' + namen + ')');
  ok(arten(g) === 'rettung', 'das gesperrte bleibt im Vorrat (' + arten(g) + ')');
  // die Sperre weicht (Laufzeit, drei Plaetze): jetzt darf es wieder
  sperreLoesen(g);
  Brett.ablehnen(g, 'a' + brett(g)[0].nr);
  const frei = brett(g).length;
  sperreLoesen(g);
  g.lageGrenze('szene_ende');
  ok(brett(g).some((x) => x.absicht.absicht === 'rettung') && brett(g).length === frei + 1, 'ohne Sperre darf es wieder angeboten werden');
  ok(g.errors === 0, 'keine Serverfehler');
}

console.log('\nGueltigkeit: gefallener Ort und toter Bezug werden verworfen (echte Ereignisse)');
{
  const t = welt(41), g = t.g;
  postenSetzen(g, '0703', 'ger'); g.weltsim.ruf.rom = rangAb('miles');
  const eS = V.eintrag(g, { absicht: ab('sabotage'), art: ART }), eR = V.eintrag(g, { absicht: rache('Quintus Varro'), art: ART }), eG = V.eintrag(g, { absicht: ab('geruecht'), art: ART });
  ok(eS.ok && eR.ok && eG.ok, 'drei Eintraege gebaut (Sabotage mit Posten in Reichweite, Rache mit Bezug, Geruecht)');
  for (const e of [eS, eR, eG]) V.hinzufuegen(g, e.eintrag);
  ok(vorrat(g).length === 3, 'alle drei im Vorrat');
  const r = postenFaellt(g, '0703');
  ok(r.ok && g.weltsim.zustand.hexe['0703'].posten === false, 'das Ereignis: der Posten ist gefallen (Wirkung ort_gefallen)');
  t.q.nsc.status = 'tot';
  ok(V.gueltig(g, vorrat(g).find((e) => e.absicht.absicht === 'sabotage')).ok === false && V.gueltig(g, vorrat(g).find((e) => e.absicht.absicht === 'rache')).grund === 'BEZUG_VERALTET', 'gueltig: Sabotage ohne Posten ungueltig, Rache mit totem NSC BEZUG_VERALTET');
  andocken(t);
  const namen = brett(g).map((x) => x.absicht.absicht).sort();
  ok(!namen.includes('sabotage') && !namen.includes('rache') && namen.includes('geruecht'), 'beim Andocken wird nur das Gueltige angeboten (' + namen.join(',') + ')');
  ok(arten(g) === '', 'die ungueltigen sind aus dem Vorrat verworfen, das gueltige ist entnommen (' + arten(g) + ')');
  ok(g.errors === 0, 'keine Serverfehler');
}

console.log('\nVorrat bleibt hoechstens vorrat_max');
{
  const t = neu(7), g = t.g;
  const titel = [];
  for (let i = 0; i < MAX + 3; i++) {
    const a = biete(g, ab('geruecht', { titel: 'Zebrafalke Probe Nummer ' + i }));
    titel.push('Zebrafalke Probe Nummer ' + i);
    ablehnen(g, a);
    if (vorrat(g).length > MAX) break;
  }
  ok(vorrat(g).length === MAX, 'nach ' + (MAX + 3) + ' abgelehnten Angeboten liegen genau vorrat_max Eintraege im Vorrat (' + vorrat(g).length + ')');
  ok(vorrat(g)[0].absicht.titel === titel[3] && vorrat(g)[MAX - 1].absicht.titel === titel[MAX + 2], 'der aelteste weicht (die letzten ' + MAX + ' bleiben)');
}

console.log('\nUeberlebt Speichern und Laden; nach dem Laden verwirft verwirfUngueltige Ungueltiges');
{
  const t = welt(61), g = t.g;
  const G1 = biete(g, ab('geruecht')), Rc = biete(g, rache('Quintus Varro')), Ls = biete(g, ab('lieferung'));
  ablehnen(g, G1); ablehnen(g, Rc);   // beide im Vorrat; Ls bleibt am Brett (mit Absicht und erstellt)
  ok(vorrat(g).length === 2 && brett(g).length === 1, 'zwei Eintraege im Vorrat, ein Angebot am Brett');
  t.q.nsc.status = 'tot';   // der Bezug stirbt, bevor gespeichert wird
  const data = Weltstand.capture(g);
  ok(Weltstand.validate(data, g).length === 0 && data.version === 3, 'Weltstand Version 3, schemagueltig (mit Vorrat und erstellt am Angebot)' + Weltstand.validate(data, g).slice(0, 1).map((x) => ' - ' + x).join(''));
  const blk = data.welt.sim.faeden.abenteuer;
  ok(Array.isArray(blk.vorrat) && blk.vorrat.length === 2 && blk.angebote.length === 1 && blk.angebote[0].erstellt === Ls.erstellt, 'der Block abenteuer traegt den Vorrat und erstellt am Angebot');
  D.zuruecksetzen();
  const t2 = neu(62), g2 = t2.g;
  Weltstand.apply(g2, JSON.parse(JSON.stringify(data)));
  ok(zust(g2).ladeFehler.length === 0 && g2.errors === 0, 'geladen ohne Ladefehler und ohne Serverfehler');
  ok(vorrat(g2).length === 1 && vorrat(g2)[0].absicht.absicht === 'geruecht', 'nach dem Laden: der Eintrag mit totem Bezug ist verworfen (verwirfUngueltige), der gueltige bleibt (' + arten(g2) + ')');
  ok(vorrat(g2)[0].erstellt === vorrat(g)[0].erstellt, 'das erste Alter ueberlebt das Laden');
  ok(brett(g2).length === 1 && brett(g2)[0].erstellt === Ls.erstellt && !!brett(g2)[0].absicht, 'das Angebot am Brett traegt nach dem Laden Absicht und erstellt');
  // Alter: ein Eintrag, der beim Laden zu alt ist, faellt weg
  D.zuruecksetzen();
  const t3 = neu(63), g3 = t3.g;
  const d3 = JSON.parse(JSON.stringify(data)); d3.welt.sim.faeden.abenteuer.vorrat.forEach((e) => { e.erstellt = 0; });
  Weltstand.apply(g3, d3);
  g3.weltsim.tickZahl = ALTER + 5;
  ok(vorrat(g3).length === 1, 'geladen: ein Eintrag (der mit totem Bezug fiel schon beim Laden weg)');
  const weg = V.verwirfUngueltige(g3);
  ok(weg.length === 1 && weg[0].grund === 'ABGELAUFEN' && vorrat(g3).length === 0, 'ein Eintrag, der zu alt ist (mehr als vorrat_alter_max Ticks), faellt bei verwirfUngueltige weg (' + weg.map((x) => x.grund).join(',') + ')');
  // ein Altstand ohne erstellt am Angebot laedt weiter
  D.zuruecksetzen();
  const t4 = neu(64), g4 = t4.g;
  const d4 = JSON.parse(JSON.stringify(data)); delete d4.welt.sim.faeden.abenteuer.angebote[0].erstellt;
  Weltstand.apply(g4, d4);
  ok(brett(g4).length === 1 && brett(g4)[0].erstellt === undefined && zust(g4).ladeFehler.length === 0, 'Altstand ohne erstellt am Angebot: geladen, kein Fehler');
}

console.log('\nDas Alter bleibt erhalten: das Angebot kreist nicht ewig');
{
  const t = neu(7), g = t.g;
  const R = biete(g, ab('rettung')), tag0 = R.erstellt;
  g.weltsim.tickZahl = tag0 + 10;
  ablehnen(g, R); sperreLoesen(g);
  ok(vorrat(g).length === 1 && vorrat(g)[0].erstellt === tag0, 'zum ersten Mal eingelegt (Tick ' + g.weltsim.tickZahl + '): erstellt bleibt ' + tag0);
  const an = V.ausVorratOhneSperre(g, ART);
  ok(an.ok && an.angebot.erstellt === tag0 && vorrat(g).length === 0, 'entnommen: das Angebot traegt erstellt ' + tag0);
  g.weltsim.tickZahl = tag0 + 20;
  verfallen(g);
  ok(vorrat(g).length === 1 && vorrat(g)[0].erstellt === tag0, 'ein zweites Mal verfallen (Tick ' + g.weltsim.tickZahl + ', Alter ' + (g.weltsim.tickZahl - tag0) + ' <= ' + ALTER + '): wieder im Vorrat, noch immer erstellt ' + tag0);
  const an2 = V.ausVorratOhneSperre(g, ART);
  ok(an2.ok && an2.angebot.erstellt === tag0, 'ein zweites Mal entnommen');
  g.weltsim.tickZahl = tag0 + ALTER + 1;
  verfallen(g);
  ok(vorrat(g).length === 0, 'ein drittes Mal verfallen nach mehr als vorrat_max Ticks seit dem ERSTEN Erzeugen (Tick ' + g.weltsim.tickZahl + '): nicht mehr im Vorrat');
  ok(g.errors === 0, 'keine Serverfehler');
}

console.log('\nOhne ABENTEUER_ABSICHTEN: Vorrat leer, Verlauf wie mit dem alten Ablauf des Andockens');
{
  const sicht = (t) => JSON.stringify({ a: brett(t.g).map((a) => [a.nr, a.hex, a.ref, a.alter, a.herkunft && a.herkunft.hex, a.absicht, a.erstellt]), f: funkAlle(t).map((m) => [m.from, m.text]), z: zust(t.g).t, v: zust(t.g).vorrat || null, e: t.g.errors, log: logbuch(t.g).length });
  // alt: der Ablauf von beiAndocken vor Paket C (Grenze, dann Rueckfall), nur aus den Bausteinen der Module nachgebaut
  function andockenAlt(t) {
    const g = t.g, FZ = zust(g);
    FZ.brett = FZ.brett || { antworten: [], abgelehnt: [], pruefung: -1e9 };
    FZ.brett.hinweisStumm = true;
    try { g.lageGrenze('andocken'); Brett.anschlussFuellen(g); } finally { FZ.brett.hinweisStumm = false; }
    Brett.sammelHinweis(g);
  }
  const lauf = (alt) => {
    const t = neu(7, { ohne: true, rueckfall: true });
    const dock = alt ? andockenAlt : andocken;
    dock(t); const nach1 = sicht(t);
    Brett.ablehnen(g0(t), 'a' + brett(t.g)[0].nr);
    dock(t); tick(t.g, GILT + 1); dock(t);
    return { nach1, ende: sicht(t), t };
  };
  const g0 = (t) => t.g;
  const neuLauf = lauf(false), altLauf = lauf(true);
  ok(neuLauf.nach1 === altLauf.nach1 && neuLauf.ende === altLauf.ende, 'Andocken, Ablehnen, Verfall, Andocken: Angebote, Funk, Zaehler und Logbuch gleich dem alten Ablauf');
  const g = neuLauf.t.g;
  ok(vorrat(g).length === 0 && !zust(g).vorrat && brett(g).every((a) => a.absicht === undefined && a.erstellt === undefined), 'der Vorrat bleibt leer, kein Angebot traegt Absicht oder erstellt');
  ok(!logbuch(g).some((e) => e.modus === 'vorrat') && !('vorrat' in (Faden.toSave(g.weltsim).abenteuer || {})), 'kein Logbucheintrag aus dem Vorrat, kein Vorrat im Weltstand');
  const e = V.einlegenAus(g, { absicht: ab('geruecht') }, ART);
  ok(e.ok === false && e.grund === 'INAKTIV' && vorrat(g).length === 0, 'einlegenAus ohne den Modus: INAKTIV, nichts liegt im Vorrat');
  ok(zust(g).brett.gesehen === undefined, 'kein Merker im Brett ohne den Modus');
  // auch mit eingeschaltetem Modus: ein Angebot ohne Absicht (Beat-Plan) wird nie eingelegt, auch nicht beim Ablehnen
  const t2 = neu(7), g2 = t2.g;
  const x = Brett.neuAnbieten(g2, planOhneAbsicht, { hex: '0304', herkunft: '0305' }).angebot;
  ablehnen(g2, x);
  ok(vorrat(g2).length === 0, 'mit Modus: ein abgelehntes Angebot ohne Absicht kommt nicht in den Vorrat');
}

console.log('\nObergrenzen bleiben: 3 Angebote, 1 laufendes, Verfall nach ' + GILT);
{
  const t = neu(7, { deckel: 4 }), g = t.g;
  for (const nm of ['rettung', 'lieferung', 'falscher_haendler']) V.hinzufuegen(g, V.eintrag(g, { absicht: ab(nm), art: ART }).eintrag);
  V.hinzufuegen(g, V.eintrag(g, { absicht: ab('geruecht'), art: ART }).eintrag);
  ok(vorrat(g).length === 4, 'vier Eintraege im Vorrat');
  andocken(t);
  ok(brett(g).length === MAXA && vorrat(g).length === 1, 'das Brett nimmt hoechstens ' + MAXA + ' (ein Eintrag bleibt liegen)');
  const id1 = 'a' + brett(g)[0].nr, id2 = 'a' + brett(g)[1].nr;
  ok(Brett.annehmen(g, id1) === null, 'Annehmen startet den Faden');
  const r2 = Brett.annehmen(g, id2);
  ok(!!r2 && r2.code === 'laeuft_schon', 'ein zweites laeuft nicht (laeuft_schon)');
  const vor = brett(g).length;
  andocken(t);
  ok(brett(g).length <= vor && vorrat(g).length === 1, 'bei einem laufenden Abenteuer fuellt der Vorrat das Brett nicht nach');
  ok(brett(g).every((a) => a.alter <= GILT), 'Verfall: kein Angebot ist aelter als ' + GILT + ' Taetigkeiten');
  tick(g, GILT + 1);
  ok(brett(g).length === 0, 'nach ' + (GILT + 1) + ' Taetigkeiten ist das Brett leer (Verfall wie bisher)');
  ok(g.errors === 0, 'keine Serverfehler');
}

console.log('\nQuelltext: keine Beat-, Absichts- oder Hafennamen im Servercode dieses Pakets');
{
  const quelltext = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const namen = Object.keys(KAT.absichten).filter((x) => x.length >= 5).concat(['0305', '0703', 'Ostia']);
  const code = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\/.*$/gm, '');
  const stellen = [['server/sim/abenteuer-vorrat.js', 'function einlegenAus', '// ---------- Weltstand'], ['server/sim/abenteuer-brett.js', 'function ausVorratEinsAnbieten', 'function anschlussFuellen']];
  for (const [f, von, bis] of stellen) {
    const s = quelltext(f), i = s.indexOf(von), j = s.indexOf(bis, i);
    const stueck = code(s.slice(i, j));
    ok(i >= 0 && j > i && !namen.some((x) => stueck.includes("'" + x + "'") || stueck.includes('"' + x + '"')), f + ': ' + von + ' nennt keinen Namen');
  }
  ok(!/vorrat/i.test(code(quelltext('server/sim/faden.js'))), 'die Fadenmaschine kennt den Vorrat nicht');
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'ALLE ' + n + ' OK'));
process.exit(fails ? 1 : 0);
