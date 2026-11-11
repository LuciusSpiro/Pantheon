'use strict';
// SPL-02 F: der Vorrat der Absichten mit Bezug und Gueltigkeitspruefung (server/sim/abenteuer-vorrat.js, Schnittstelle fuer FRE-02/03, Anbindung im Weltstand-Block abenteuer von abenteuer-brett.js, Schema
// content/schema/weltstand.schema.json, Datenwerte vorrat_max und vorrat_alter_max in content/faeden/absichten.json). Kein Netz, kein Modell. Die Erwartungen stehen hier selbst (Welten aus eigenen Fixtures: ein
// feindlicher NSC, ein Posten, verstrichene Ticks), nie aus dem Produktivcode abgeleitet. Geprueft wird:
// Eintrag (Form, Kennung wird Vollname, Plan und Ort aus dem Inszenierer) · gueltig (Welt aendert sich: NSC tot, verdraengt, ersetzt, nicht mehr grollend: BEZUG_VERALTET; Posten weg, Wiederholungsregel: Nein mit
// Code; Alter und Ablauf: ABGELAUFEN; der Ort wird neu aus der Lage gewaehlt) · anbieten (nur gueltig, ueber Brett.neuAnbieten mit bezug, locker, Eintrag wird entnommen) · Vorrat (Obergrenze, doppelt, ausVorrat,
// verwirfUngueltige) · Weltstand (additiv im Block abenteuer, Version 3, schemagueltig, Altstand ohne Block, Muell, Prototype-Keys, nie im Snapshot) · Logbuch ohne Spielername und Titel · Quelltext ohne Namen.
// Aufruf: node tools/test-abenteuer-vorrat.js [begriff ...]        (npm run test:abenteuer-vorrat)
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
const BP = require('../server/sim/faden-bauplan.js');
const AP = require('../server/sim/absicht-pruefer.js');
const V = require('../server/sim/abenteuer-vorrat.js');

const { D, Faden, F } = X;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const KAT = AP.katalogStandard();
const MAX = KAT.werte.vorrat_max.wert, ALTER = KAT.werte.vorrat_alter_max.wert;
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const TEXT = { titel: 'Zebrafalke Probe Titel', einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', preis: 'Ein Preis ohne Namen fuer den Test.' };

// ---------------------------------------------------------------- Welt
function neu(seed) {
  const t = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  return t;
}
const zust = (g) => Faden.zustandVon(g);
const offen = (g) => zust(g).abenteuerAngebote;
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const rangAb = (id) => lies('content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === id).ab;
function postenSetzen(g, hex, besitzer) {
  Object.assign(g.weltsim.zustand.hexe[hex], { besitzer, posten: true, garnison: 4, anspruch: {} });
  if (g.weltBesitz && g.weltBesitz.hexe[hex]) g.weltBesitz.hexe[hex] = { besitzer: { rom: 'rom', ger: 'ger', kon: 'saum' }[besitzer] || 'frei', posten: true };
}
function postenWeg(g, hex) {
  Object.assign(g.weltsim.zustand.hexe[hex], { besitzer: 'frei', posten: false, garnison: 0 });
  if (g.weltBesitz && g.weltBesitz.hexe[hex]) g.weltBesitz.hexe[hex] = { besitzer: 'frei', posten: false };
}
const plan = (typ, i) => ({ format: 'faden-bauplan/1', titel: typ + ' Probe ' + i, anlass: 'Probeanlass ' + typ + ' Nummer ' + i + ' ohne Namen fuer den Test', beats: [{ typ }, { typ: 'abschluss' }] });
function beende(g, f, ausgang) {
  const v = D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) {
    f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 };
    Faden.beatAusgang(g, f.id, ausgang);
  }
}
function spiele(g, p, ausgang) {
  const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  beende(g, r.faden, ausgang || 'gelungen');
  return r.faden;
}
function setze(g, f, name, status, haltung) {
  f.nsc.name = name; f.parameter.name = name; f.nsc.fraktion = 'rom'; f.nsc.status = status; f.nsc.haltung = haltung;
  const e = zust(g).kanon.find((x) => x.f === f.id);
  e.name = name; e.volk = 'rom'; e.status = status;
}
// Welt mit einem grollenden NSC (Quintus Varro, feindlich, Haltung -2) und einem freundlichen (Livia Serran)
function welt(seed) {
  const t = neu(seed), g = t.g;
  const f1 = spiele(g, plan('notruf', 1)), f2 = spiele(g, plan('spontanhilfe', 2));
  setze(g, f1, 'Quintus Varro', 'feindlich', -2); setze(g, f2, 'Livia Serran', 'verbuendet', 1);
  t.q = f1; t.l = f2;
  return t;
}
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const rache = (nsc) => ab('rache', { bezug: { nsc }, ton: 'bitter' });
const eintrag = (g, absicht, art, o) => { const r = V.eintrag(g, Object.assign({ absicht, art: art || 'angebot' }, o || {})); if (!r.ok) throw new Error('Eintrag nicht gebaut: ' + JSON.stringify(r)); return r.eintrag; };
const wiederholt = (g, t) => { for (let i = 0; i < t; i++) Kriegslage.tick(g, 'probe'); };

// ======================================================================
section('Daten und Form: Werte, Eintrag, Kennung wird Vollname', () => {
  ok(V.werteFehler().length === 0, 'die Werte vorrat_* sind stimmig');
  ok(Number.isInteger(MAX) && MAX >= 1 && Number.isInteger(ALTER) && ALTER >= 1, 'vorrat_max und vorrat_alter_max sind Datenwerte (' + MAX + ', ' + ALTER + ')');
  const kat = klon(KAT); kat.werte.vorrat_max.wert = 0; delete kat.werte.vorrat_alter_max;
  ok(V.werteFehler(kat).length === 2 && V.werteFehler(kat).every((x) => /vorrat_/.test(x)), 'falsche oder fehlende Werte werden gemeldet');
  const t = welt(11), g = t.g;
  const e = eintrag(g, rache('Quintus Varro'), 'angebot');
  ok(JSON.stringify(Object.keys(e).sort()) === JSON.stringify(['absicht', 'art', 'bezug', 'erstellt', 'hex', 'plan']), 'Eintrag: absicht, plan, hex, bezug, art, erstellt (' + Object.keys(e).join(',') + ')');
  ok(e.absicht.format === 'absicht/1' && e.absicht.absicht === 'rache' && e.bezug.nsc === 'Quintus Varro' && e.absicht.bezug.nsc === 'Quintus Varro', 'die Absicht ist im Eintrag (absicht/1, nicht der Plan allein), der Bezug ist der Vollname');
  ok(/^\d{4}$/.test(e.hex) && e.erstellt === g.weltsim.tickZahl && e.plan.format === 'faden-bauplan/1' && BP.pruefe(e.plan).ok, 'hex, erstellt = Tick der Weltsim, der Plan besteht den Expander');
  const k = Object.keys(require('../server/sim/abenteuer-geschichte.js').geschichteZeilen(g).kennungen).find((x) => require('../server/sim/abenteuer-geschichte.js').geschichteZeilen(g).kennungen[x] === 'Quintus Varro');
  const e2 = eintrag(g, rache(k), 'notruf');
  ok(e2.bezug.nsc === 'Quintus Varro' && e2.absicht.bezug.nsc === 'Quintus Varro' && e2.art === 'notruf', 'eine Kennung der Sitzung (' + k + ') wird im Eintrag zum Vollnamen');
  const fehl = V.eintrag(g, { absicht: rache('K9'), art: 'angebot' });
  ok(!fehl.ok && fehl.grund === 'BEZUG_UNBEKANNT', 'eine unbekannte Kennung: BEZUG_UNBEKANNT, kein Eintrag');
  const nein = V.eintrag(g, { absicht: rache('Livia Serran'), art: 'angebot' });
  ok(!nein.ok && /bezug/.test(JSON.stringify(nein.fehler)), 'ein NSC, der nicht grollt: Nein der Welt schon beim Aufnehmen (' + nein.grund + ')');
  ok(!V.eintrag(g, { absicht: ab('geruecht'), art: 'Falsch Art!' }).ok, 'eine Art ausserhalb von name_muster ist kein Eintrag');
  ok(!V.eintrag(g, { absicht: 'rache', art: 'angebot' }).ok && !V.eintrag(g, null).ok, 'keine Absicht, kein Eintrag');
  // gueltig prueft die Form eines beliebigen Eintrags
  const kaputt = (aendern) => { const x = klon(e); aendern(x); return V.gueltig(g, x); };
  const alle = [
    kaputt((x) => { x.extra = 1; }), kaputt((x) => { x.hex = '99'; }), kaputt((x) => { x.art = 'X'; }), kaputt((x) => { x.erstellt = -1; }), kaputt((x) => { x.ablauf = x.erstellt - 1; }),
    kaputt((x) => { x.absicht.absicht = 'gibt_es_nicht'; }), kaputt((x) => { x.bezug = { nsc: 'Livia Serran' }; }), kaputt((x) => { delete x.bezug; }), kaputt((x) => { x.absicht.bezug.nsc = 'K1'; x.bezug.nsc = 'K1'; }),
    kaputt((x) => { x.plan = 5; }), kaputt((x) => { x.bezug = { nsc: 'ab' }; }),
  ];
  ok(alle.every((r) => !r.ok && r.grund === 'VORRAT_FORM'), 'Eintraege mit falscher Form: VORRAT_FORM (' + alle.map((r) => r.grund).join(', ') + ')');
  ok(!V.gueltig(g, null).ok && !V.gueltig(g, 'x').ok && !V.gueltig(g, JSON.parse('{"__proto__":{"x":1},"absicht":1}')).ok, 'null, Text und Prototype-Schluessel: kein Absturz, ungueltig');
});

section('gueltig: die Welt aendert sich, der Bezug verfaellt (BEZUG_VERALTET)', () => {
  const faelle = [
    ['der NSC ist tot', (t) => { t.q.nsc.status = 'tot'; }],
    ['der NSC ist verdraengt (kein Faden mehr in der Liste, der Kanon kennt den Namen noch)', (t) => { const F0 = zust(t.g); F0.liste.splice(F0.liste.indexOf(t.q), 1); }],
    ['der NSC ist ersetzt (der Faden traegt jetzt eine andere Person)', (t) => { t.q.nsc.name = 'Gaius Neuer'; }],
    ['der NSC grollt nicht mehr (Haltung +1)', (t) => { t.q.nsc.haltung = 1; }],
    ['der NSC ist gefangen', (t) => { t.q.nsc.status = 'gefangen'; }],
  ];
  for (const [text, aendern] of faelle) {
    const t = welt(21), g = t.g;
    const e = eintrag(g, rache('Quintus Varro'));
    ok(V.gueltig(g, e).ok === true, text + ': vorher gueltig');
    aendern(t);
    const r = V.gueltig(g, e);
    ok(r.ok === false && r.grund === 'BEZUG_VERALTET' && !/Quintus|Varro/.test(JSON.stringify(r)), '  nachher BEZUG_VERALTET, der Grund nennt keinen Namen (' + r.grund + ')');
    const an = V.anbieten(g, e);
    ok(an.ok === false && an.grund === 'BEZUG_VERALTET' && offen(g).length === 0, '  anbieten: abgelehnt, kein Angebot am Brett');
    ok(g.errors === 0, '  keine Serverfehler');
  }
  // der Vorrat verwirft solche Eintraege (Abnahme 7, zweiter Teil)
  const t = welt(22), g = t.g;
  const ok1 = eintrag(g, ab('geruecht'), 'angebot'), veraltet = eintrag(g, rache('Quintus Varro'), 'notruf');
  ok(V.hinzufuegen(g, ok1).ok && V.hinzufuegen(g, veraltet).ok && V.liste(g).length === 2, 'zwei Eintraege im Vorrat');
  t.q.nsc.status = 'tot';
  const v = V.verwirfUngueltige(g);
  ok(v.length === 1 && v[0].art === 'notruf' && v[0].grund === 'BEZUG_VERALTET' && V.liste(g).length === 1 && V.liste(g)[0].art === 'angebot', 'verwirfUngueltige: der Plan mit dem toten Bezug faellt weg, der ohne Bezug bleibt');
  ok(!/Quintus/.test(JSON.stringify(v)), 'die Meldung nennt nur Art und Code');
});

section('gueltig: Ort, Weltbedingungen, Wiederholungsregeln, Alter', () => {
  // Lage: ein Posten ist das Ziel der Sabotage
  { const t = neu(31), g = t.g; postenSetzen(g, '0703', 'ger'); g.weltsim.ruf.rom = rangAb('miles');
    const e = eintrag(g, ab('sabotage', { titel: TEXT.titel }), 'angebot');
    ok(V.gueltig(g, e).ok, 'Sabotage mit Posten in Reichweite: gueltig');
    postenWeg(g, '0703');
    const r = V.gueltig(g, e);
    ok(!r.ok && r.grund === 'WELT_BEDINGUNG', 'der Posten ist weg: Nein der Welt (' + r.grund + ')');
    ok(V.anbieten(g, e).ok === false && offen(g).length === 0, '  anbieten: kein Angebot'); }
  // Wiederholungsregel: dieselbe Typenfolge wie eines der letzten Abenteuer
  { const t = neu(32), g = t.g;
    const e = eintrag(g, ab('geruecht'), 'angebot');
    ok(V.gueltig(g, e).ok, 'Gerucht: gueltig');
    spiele(g, plan('geruecht', 1));
    const r = V.gueltig(g, e);
    ok(!r.ok && r.grund === 'WELT_BEDINGUNG', 'dieselbe Typenfolge wurde gerade gespielt: Nein (' + r.grund + ')');
    ok(V.anbieten(g, e).ok === false, '  anbieten: abgelehnt'); }
  // Alter und Ablauf
  { const t = neu(33), g = t.g;
    const e = eintrag(g, ab('geruecht'), 'angebot'), f = eintrag(g, ab('spur'), 'angebot', { ablauf: g.weltsim.tickZahl + 2 });
    g.weltsim.tickZahl += ALTER;
    ok(V.gueltig(g, e).ok === true, 'genau vorrat_alter_max Ticks alt: noch gueltig');
    ok(V.gueltig(g, f).ok === false && V.gueltig(g, f).grund === 'ABGELAUFEN', 'der eigene Ablauf endete frueher: ABGELAUFEN');
    g.weltsim.tickZahl += 1;
    const r = V.gueltig(g, e);
    ok(!r.ok && r.grund === 'ABGELAUFEN', 'einen Tick mehr als vorrat_alter_max: ABGELAUFEN'); }
  // Ort: der Inszenierer waehlt ihn aus der Lage JETZT
  { const t = neu(34), g = t.g;
    const e = eintrag(g, ab('geruecht'), 'angebot');
    const neuHex = ['0306', '0304', '0405', '0205', '0404', '0204', '0406', '0206', '0105', '0505'].find((h) => h !== e.hex && Sektoren.spielbar(h) && Sektoren.ortVonHex(h));
    ok(!!neuHex, 'ein anderer Sektor zum Umziehen (' + neuHex + ')');
    g.ship.scene = Sektoren.ortVonHex(neuHex);
    const r = V.gueltig(g, e);
    ok(r.ok && r.hex === neuHex && e.hex !== neuHex, 'die Crew ist umgezogen: gueltig, der Ort ist der von jetzt (' + e.hex + ' > ' + r.hex + ')');
    const a = V.anbieten(g, e);
    ok(a.ok && a.angebot.hex === neuHex, 'das Angebot steht am neuen Ort'); }
});

section('anbieten: nur wenn gueltig, ueber Brett.neuAnbieten mit Bezug und locker; der Eintrag wird entnommen', () => {
  const t = welt(41), g = t.g;
  const e = eintrag(g, rache('Quintus Varro'), 'angebot');
  ok(V.hinzufuegen(g, e).ok, 'im Vorrat');
  const r = V.anbieten(g, V.liste(g)[0]);
  ok(r.ok && offen(g).length === 1 && r.angebot === offen(g)[0], 'anbieten: ein Angebot am Brett');
  ok(r.angebot.bezug && r.angebot.bezug.nsc === 'Quintus Varro' && r.angebot.locker === true, 'das Angebot traegt den Bezug (den NSC, nicht den juengsten) und locker (Fortsetzung)');
  ok(r.angebot.vorlage.beats[0].typ === e.plan.beats[0].typ && r.inszenierung.plan.format === 'faden-bauplan/1', 'der Plan ist der des Inszenierers');
  ok(V.liste(g).length === 1, 'der Eintrag in der Liste ist ein anderer Wert (Kopie): anbieten mit der Kopie nimmt ihn nicht aus dem Vorrat');
  const r2 = V.anbieten(g, e);
  ok(r2.ok === false, 'ein zweites Angebot desselben Plans lehnt das Brett ab (Wiederholungsregel, offenes Angebot): ' + r2.grund);
  // ein Eintrag aus dem Vorrat wird beim Anbieten entnommen
  const t2 = welt(42), g2 = t2.g, e2 = eintrag(g2, rache('Quintus Varro'), 'angebot');
  V.hinzufuegen(g2, e2);
  const inListe = zust(g2).vorrat[0];
  ok(V.anbieten(g2, inListe).ok && V.liste(g2).length === 0, 'der Eintrag selbst (aus dem Vorrat) wird beim Anbieten entnommen');
  // das angenommene Angebot nimmt den NSC des Bezugs (Brett.annehmen), nicht den juengsten
  const t3 = welt(43), g3 = t3.g;
  const ang = V.anbieten(g3, eintrag(g3, rache('Quintus Varro'), 'angebot'));
  const x = require('../server/sim/abenteuer-brett.js').annehmen(g3, 'a' + ang.angebot.nr);
  const fa = g3.weltsim.faeden.liste.find((f) => f.plan && f.phase !== 'abgeschlossen');
  ok(x === null && fa && fa.nsc.name === 'Quintus Varro', 'Annehmen: der NSC des Bezugs wird die Hauptfigur (' + (fa && fa.nsc.name) + '), nicht der juengste Kandidat');
  ok(g.errors === 0 && g2.errors === 0 && g3.errors === 0, 'keine Serverfehler');
});

section('Vorrat: Obergrenze, doppelte, ausVorrat, nur Gueltiges kommt hinein', () => {
  const t = neu(51), g = t.g;
  const arten = [['geruecht', 'a_eins'], ['spur', 'a_zwei'], ['konvoi', 'a_drei'], ['geleit', 'a_vier'], ['jagd', 'a_fuenf'], ['notruf', 'a_sechs'], ['rettung', 'a_sieben'], ['lieferung', 'a_acht']];
  const eintr = arten.map(([name, art]) => eintrag(g, ab(name), art));
  let hinein = 0;
  for (const e of eintr) { const r = V.hinzufuegen(g, e); if (r.ok) hinein++; }
  ok(hinein === eintr.length && V.liste(g).length === MAX, 'mehr als vorrat_max Eintraege: es bleiben ' + MAX + ' (' + V.liste(g).length + ')');
  ok(V.liste(g)[0].art === arten[eintr.length - MAX][1] && V.liste(g)[MAX - 1].art === arten[eintr.length - 1][1], 'der aelteste weicht, die neuesten bleiben');
  const vor = V.liste(g).length;
  ok(V.hinzufuegen(g, eintr[eintr.length - 1]).ok && V.liste(g).length === vor, 'derselbe Eintrag (Art und Absicht) kommt nicht doppelt hinein');
  const schlecht = klon(eintr[0]); schlecht.bezug = { nsc: 'Niemand Bekannt' };
  const r = V.hinzufuegen(g, schlecht);
  ok(!r.ok && r.grund === 'VORRAT_FORM' && V.liste(g).length === vor, 'ein ungueltiger Eintrag kommt nicht hinein');
  ok(!V.liste(g).some((e, i, l) => l.indexOf(e) !== i), 'liste liefert eine Kopie');
  V.liste(g).pop();
  ok(V.liste(g).length === vor, 'die Kopie veraendert den Vorrat nicht');
  // ausVorrat: die Art, der aelteste gueltige; Veraltetes davor wird verworfen
  const t2 = welt(52), g2 = t2.g;
  const veraltet = eintrag(g2, rache('Quintus Varro'), 'notruf'), gut = eintrag(g2, ab('geruecht'), 'notruf'), andere = eintrag(g2, ab('spur'), 'angebot');
  V.hinzufuegen(g2, veraltet); V.hinzufuegen(g2, andere); V.hinzufuegen(g2, gut);
  t2.q.nsc.status = 'tot';
  const a = V.ausVorrat(g2, 'notruf');
  ok(a.ok && a.angebot.vorlage.beats[0].typ === gut.plan.beats[0].typ, 'ausVorrat: das veraltete Rache-Angebot wird uebersprungen, das gueltige Geruecht der Art angeboten');
  ok(V.liste(g2).length === 1 && V.liste(g2)[0].art === 'angebot', 'das veraltete ist verworfen, das angebotene entnommen, die andere Art bleibt');
  const leer = V.ausVorrat(g2, 'notruf');
  ok(!leer.ok && leer.grund === 'VORRAT_LEER', 'nichts Gueltiges dieser Art: VORRAT_LEER');
  ok(V.ausVorrat(neu(53).g, 'notruf').grund === 'VORRAT_LEER', 'leerer Vorrat: VORRAT_LEER');
  const aus = F.neuesSpiel({ crew: 1, seed: 5, names: ['Ada'], env: {} }).g;
  ok(V.hinzufuegen(aus, gut).grund === 'INAKTIV' && V.liste(aus).length === 0 && V.gueltig(aus, gut).grund === 'INAKTIV' && V.verwirfUngueltige(aus).length === 0, 'ohne FAEDEN: INAKTIV, nichts im Vorrat, kein Absturz');
});

section('Weltstand: additiv im Block abenteuer, Version 3, schemagueltig, Altstand, Muell, nie im Snapshot', () => {
  const t = welt(61), g = t.g;
  const e1 = eintrag(g, rache('Quintus Varro'), 'angebot', { ablauf: g.weltsim.tickZahl + 10 }), e2 = eintrag(g, ab('spur'), 'notruf');
  V.hinzufuegen(g, e1); V.hinzufuegen(g, e2);
  const data = Weltstand.capture(g);
  const sim = JSON.parse(JSON.stringify(data.welt.sim));
  ok(data.version === 3 && Weltstand.validate(data, g).length === 0, 'Weltstand-Version 3, schemagueltig (mit Vorrat)' + Weltstand.validate(data, g).slice(0, 1).map((x) => ' - ' + x).join(''));
  const blk = sim.faeden.abenteuer;
  ok(blk && Array.isArray(blk.vorrat) && blk.vorrat.length === 2 && blk.vorrat[0].absicht.absicht === 'rache' && blk.vorrat[0].ablauf === e1.ablauf && blk.vorrat[1].art === 'notruf' && !('vorrat' in sim.faeden), 'Block abenteuer.vorrat: zwei Eintraege mit Absicht, Bezug, Art, Ablauf (additiv im Block abenteuer)');
  // laden
  const laden = (s, seed) => { const t2 = neu(seed || 62); Kriegslage.restore(t2.g, s); return t2; };
  D.zuruecksetzen();
  const t2 = laden(JSON.parse(JSON.stringify(sim)));
  ok(zust(t2.g).vorrat.length === 2 && zust(t2.g).ladeFehler.length === 0, 'nach dem Laden: zwei Eintraege, keine Ladefehler');
  ok(JSON.stringify(Faden.toSave(t2.g.weltsim).abenteuer) === JSON.stringify(sim.faeden.abenteuer), 'Speichern nach dem Laden ergibt denselben Block abenteuer (der Kanon ist abgeleitet und steht nur, wenn er davon abweicht)');
  ok(V.gueltig(t2.g, zust(t2.g).vorrat[0]).ok && V.gueltig(t2.g, zust(t2.g).vorrat[1]).ok, 'die geladenen Eintraege sind gegen die geladene Welt gueltig');
  // Altstand ohne Block
  const alt = JSON.parse(JSON.stringify(sim)); delete alt.faeden.abenteuer.vorrat;
  const t3 = laden(alt, 63);
  ok((zust(t3.g).vorrat || []).length === 0 && zust(t3.g).ladeFehler.length === 0 && !(Faden.toSave(t3.g.weltsim).abenteuer || {}).vorrat, 'Altstand ohne den Block laedt unveraendert (leerer Vorrat, kein Fehler, kein Block beim Speichern)');
  const alt2 = JSON.parse(JSON.stringify(sim)); delete alt2.faeden.abenteuer;
  ok((zust(laden(alt2, 64).g).vorrat || []).length === 0, 'auch ohne den ganzen Block abenteuer');
  // Muell
  const mit = (aendern) => { const s = JSON.parse(JSON.stringify(sim)); aendern(s.faeden.abenteuer); const tt = laden(s, 65); return { vorrat: zust(tt.g).vorrat || [], fehler: zust(tt.g).ladeFehler, g: tt.g }; };
  const m1 = mit((b) => { b.vorrat = 'kaputt'; });
  ok(m1.vorrat.length === 0 && m1.fehler.some((x) => /vorrat/.test(x)) && m1.g.errors === 0, 'Muell (Text statt Liste): verworfen, Meldung in ladeFehler, kein Absturz');
  const m2 = mit((b) => { b.vorrat = [5, null, { absicht: 1 }, Object.assign(klon(b.vorrat[1]), { hex: 'abcd' }), Object.assign(klon(b.vorrat[1]), { art: 'Falsch' }), Object.assign(klon(b.vorrat[1]), { extra: 1 }), b.vorrat[1]]; });
  ok(m2.vorrat.length === 1 && m2.vorrat[0].art === 'notruf' && m2.fehler.filter((x) => /vorrat/.test(x)).length === 5, 'Muell-Eintraege fallen weg, der gueltige bleibt (' + m2.vorrat.length + ', ' + m2.fehler.length + ' Meldungen)');
  const m3 = mit((b) => { b.vorrat = JSON.parse('[{"__proto__":{"x":1},"absicht":{"format":"absicht/1","absicht":"spur"},"hex":"0305","art":"angebot","erstellt":1}]'); });
  ok(m3.vorrat.length === 0 && !({}).x, 'Prototype-Schluessel: verworfen, Object.prototype unberuehrt');
  const m4 = mit((b) => { const x = b.vorrat[1]; b.vorrat = Array.from({ length: MAX + 4 }, (_, i) => Object.assign(klon(x), { art: 'a_' + ['eins', 'zwei', 'drei', 'vier', 'fuenf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'][i] })); });
  ok(m4.vorrat.length === MAX && m4.vorrat[MAX - 1].art === 'a_zehn', 'mehr als vorrat_max beim Laden: die neuesten ' + MAX + ' bleiben');
  const m5 = mit((b) => { b.vorrat[1].plan = { format: 'unsinn' }; });
  ok(m5.vorrat.length === 2 && m5.vorrat[1].plan === undefined && V.gueltig(m5.g, m5.vorrat[1]).ok, 'ein kaputter Plan faellt weg, die Absicht bleibt und ist weiter gueltig');
  // ungueltig gegen die Welt: wird beim Laden nicht geprueft, aber von verwirfUngueltige
  const m6 = mit((b) => { b.vorrat[0].absicht.bezug.nsc = 'Fremder Unbekannt'; b.vorrat[0].bezug.nsc = 'Fremder Unbekannt'; });
  ok(m6.vorrat.length === 2 && V.verwirfUngueltige(m6.g).length === 1 && zust(m6.g).vorrat.length === 1, 'ein NSC, den die Welt nicht kennt: bleibt beim Laden (nur Form), verwirfUngueltige entfernt ihn');
  // Snapshot: der Vorrat steht nie im Snapshot
  let gesehen = '';
  for (let i = 0; i < 40; i++) gesehen += JSON.stringify(g.snapshot());
  ok(!/vorrat/.test(Object.keys(JSON.parse(gesehen.slice(0, gesehen.indexOf('}{"') > 0 ? gesehen.indexOf('}{"') + 1 : undefined) || '{}')).join(' ')) && !gesehen.includes(TEXT.titel) && !gesehen.includes('"absicht/1"'), 'der Vorrat steht nie im Snapshot (40 Snapshots, weder Titel noch Absicht)');
});

section('Logbuch und Spielernamen: nie ein Spielername, nie Titel oder Anlass', () => {
  const t = welt(71), g = t.g;
  const e = eintrag(g, rache('Quintus Varro'), 'angebot');
  V.hinzufuegen(g, e); V.anbieten(g, V.liste(g)[0]);
  t.q.nsc.status = 'tot'; V.gueltig(g, e); V.verwirfUngueltige(g);
  const text = JSON.stringify(logbuch(g));
  ok(!NAMEN.some((x) => text.includes(x)) && !text.includes(TEXT.titel) && !text.includes(TEXT.einsatz) && !text.includes(TEXT.preis), 'das Logbuch enthaelt weder Spielername noch Titel, Einsatz oder Preis');
  const r = JSON.stringify([V.gueltig(g, e), V.eintrag(g, { absicht: rache('Livia Serran'), art: 'angebot' })]);
  ok(!NAMEN.some((x) => r.includes(x)) && !/Livia|Quintus/.test(JSON.stringify(V.gueltig(g, e))), 'die Rueckgaben nennen keinen Namen im Grund');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('Quelltext und Schnittstelle', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'abenteuer-vorrat.js'), 'utf8');
  const code = s.split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n').replace(/\/\/.*$/gm, '');
  const namen = Object.keys(KAT.absichten).concat(Object.keys(D.BEATS), [].concat(...Object.values(KAT.absichten).map((e) => e.wendungen || [])).filter((w) => w !== 'keine'));
  const treffer = namen.filter((w, i) => namen.indexOf(w) === i && new RegExp('[\'"`]' + w + '[\'"`]').test(code));
  ok(treffer.length === 0, 'kein Absichts-, Beat- oder Wendungsname als Zeichenkette' + (treffer.length ? ' (' + treffer.join(', ') + ')' : ''));
  const zahlen = code.match(/[^\w."'-](\d{2,})[^\w"']/g) || [];
  ok(zahlen.length === 0 && !/Math\.random/.test(code), 'keine Zahl ab zwei Stellen, kein Math.random' + (zahlen.length ? ' (' + zahlen.join(' ') + ')' : ''));
  ok(['eintrag', 'gueltig', 'anbieten', 'hinzufuegen', 'verwirfUngueltige', 'ausVorrat', 'liste', 'toSave', 'lesen', 'werteFehler'].every((k) => typeof V[k] === 'function'), 'die Schnittstelle: eintrag, gueltig, anbieten, hinzufuegen, verwirfUngueltige, ausVorrat, liste, toSave, lesen, werteFehler');
  const faden = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden.js'), 'utf8');
  ok(!/vorrat/i.test(faden.replace(/vorrat\.js/g, '')), 'die Fadenmaschine (faden.js) kennt den Vorrat nicht: er haengt am Block abenteuer des Bretts');
  void Brett; void BP;
});

(async () => {
  for (const [name, fn] of abschnitte) {
    if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
    console.log('\n== ' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e)); }
  }
  console.log(`\n${n - fails}/${n} gruen`);
  setTimeout(() => process.exit(fails ? 1 : 0), 20);
})();
