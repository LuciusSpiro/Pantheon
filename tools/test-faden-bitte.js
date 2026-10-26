'use strict';
// SUND-04a-2 P2: Bitten der Geschichtsfaeden (server/sim/faden-bitte.js, Daten content/faeden/bitte-werte.json, Beat `bitte`). Prueft:
//   Daten (Zahlen, Texte, Weigerungen; Vorlage mit Ausgaengen; Pruefer: Gefahr und Scheinwahl) · Angebot (Text, Absender, Porträt, Hinweis erst mit dem Angebot, Schalter) · Deckel (eigener,
//   Option entfaellt statt Scheinwahl, Zurueckziehen beim Antworten) · erste Antwort gilt · Ablehnen und Annehmen (Ausgang des Beats, Haltung, Ruf) · Später (Zurückstellung) ·
//   Verfall in Tätigkeiten (faden.t, nicht Sprünge) · Wiederholung nach unruhiger Lage · Zurückziehen in unruhiger Lage · Weltstand (Runde, Altstand, Müll, Schema) · Snapshot (Löschsignal, Größe) ·
//   Porträt (Variante, Fraktion, Müll ohne Fehler) · Funkzeile mit Porträt · Schalter aus = nichts.
//   Erwartete Werte stehen im Test (aus den Daten und den Regeln hergeleitet), nicht aus dem Produktivcode.       node tools/test-faden-bitte.js   (npm run test:faden-bitte)
const fs = require('fs');
const path = require('path');
const X = require('./faden-fixture.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const B = require('../server/sim/faden-bitte.js');
const D = require('../server/sim/faden-daten.js');
const Pruefer = require('../server/sim/faden-pruefer.js');

const { Faden, alsVorlage, registriere } = X;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
const ws = (g) => g.weltsim;
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const liste = (g) => ws(g).faeden.liste;
const bitte = (g) => ws(g).faeden.bitte;
const BAS = 'test_bitte';
// Kopie der Testvorlage mit Ausgängen an Annahme und Ablehnung (nur für diese Tests; die Testvorlage der Faden-Tests bleibt unverändert)
function vorlageBitte() {
  registriere(alsVorlage(BAS, (v) => { v.beats[0].optionen[0].ausgang = 'gelungen'; }));
}
// Ein Spiel mit offener Bitte: Faden über den echten Notruf-Hook geöffnet, Abstand über echte Tätigkeitsgrenzen, Beat per Befehl gestartet
function bereit(vorlage) {
  const g = X.spiel({}).g;
  const f = X.oeffne(g, vorlage || BAS);
  if (!f) throw new Error('kein Faden');
  X.grenzen(g, 6, 'andocken');
  const r = weiter(g, f);
  if (!r.ok) throw new Error('Beat startet nicht: ' + r.grund);
  return { g, f: liste(g)[0] };
}
const roh = (g) => JSON.parse(JSON.stringify(g));

// ---------------------------------------------------------------------------------------------------------------------------
section('Daten: Zahlen, Texte, Weigerungen (bitte-werte.json)', () => {
  const W = D.BITTE;
  ok(W.fenster_taetigkeiten === 100, 'Fenster des Bitten-Deckels: 100 Tätigkeiten');
  ok(W.ruf_deckel === 0.25, 'Bitten-Deckel: 0,25 Ruf je 100 Tätigkeiten (Obergrenze fürs Ruf-Tempo, siehe Messbericht)');
  ok(W.frist_taetigkeiten === 4, 'Verfall nach 4 Tätigkeiten');
  ok(W.frist_taetigkeiten < D.WERTE.beat_frist, 'der Verfall liegt unter der Frist des Beats (sonst entscheidet die Frist)');
  ok(W.gleichzeitig_max === 1, 'höchstens ein Angebot gleichzeitig');
  ok(W.optionen.min === 2 && W.optionen.max === 3, 'zwei bis drei Optionen');
  ok(typeof W.spaeter_text === 'string' && W.spaeter_text.length > 0 && W.kopf === 'BITTE', 'Später und Kopf als Text');
  for (const k of ['hilfe_rom', 'hilfe_kon', 'bitte_mission']) {
    const t = W.texte[k];
    ok(typeof t === 'string' && t.length <= W.text_max + 40 && t.includes('{name}'), `Text ${k} da, mit Platzhalter {name}`);
  }
  for (const c of ['modus', 'kein_angebot', 'schon_beantwortet', 'unbekannt', 'unruhig', 'deckel', 'am_boden']) ok(typeof W.weigerung[c] === 'string', `Weigerung ${c} hat einen Text`);
  ok(B.weigerung('gibt_es_nicht').text === 'gibt_es_nicht', 'unbekannter Code: der Code selbst (kein Absturz)');
});

section('Vorlage: Beat bitte mit Ausgängen; Prüfer lehnt Gefahr und Scheinwahl ab', () => {
  vorlageBitte();
  const v = D.vorlage(BAS);
  const opts = v.beats[0].optionen;
  ok(v.beats[0].typ === 'bitte' && opts.length === 3, 'Beat 1 ist eine Bitte mit drei Optionen');
  ok(opts[0].ausgang === 'gelungen' && opts[1].ausgang === 'gescheitert' && opts[2].ausgang === undefined && opts[2].folge.length === 0, 'Annahme gelungen, Ablehnung gescheitert, Später ohne Ausgang und ohne Folge');
  const gefahr = registriere(alsVorlage('test_bitte_gefahr', (x) => { x.beats[0].gefahr = true; }));
  ok(!gefahr.ok && gefahr.fehler.some((t) => t.startsWith('OPTION_BEI_GEFAHR')), 'Bitte mit gefahr: der Prüfer lehnt Optionen ab (nie bei Gefahr)');
  const schein = registriere(alsVorlage('test_bitte_schein', (x) => { x.beats[0].optionen[0].folge = [{ typ: 'haltung_aenderung', grund: 'bitte_abgelehnt' }]; x.beats[0].optionen[0].ausgang = 'gescheitert'; }));
  const echt = registriere(alsVorlage('test_bitte_echt', (x) => { x.beats[0].optionen[0].folge = [{ typ: 'haltung_aenderung', grund: 'bitte_abgelehnt' }]; }));
  ok(echt.ok, 'gleiche Folge, anderer Ausgang: eine echte Wahl (der Beat geht anders weiter), kein Scheinwahl-Fehler');
  ok(!schein.ok && schein.fehler.some((t) => t.startsWith('SCHEINWAHL')), 'zwei Optionen mit gleicher Folge: Scheinwahl, abgelehnt');
});

section('Schalter: ohne FAEDEN=1 keine Bitte', () => {
  const g = X.spiel({ aus: true }).g;
  const r = B.anbieten(g, { fadenId: 'f1', beatId: 'b_bitte', absender: { name: 'X', fraktion: 'rom', portrait: 1 }, text: 'x', optionen: [] });
  ok(!r.ok && r.code === 'aus', 'anbieten ohne Schalter: aus');
  ok(B.snapshot(g) === null && B.schluessel(g) === null, 'kein Snapshot ohne Schalter');
  ok(B.beantworten(g, 'zusagen', 1) !== null, 'Antwort ohne Schalter: Weigerung');
});

section('Angebot: Text, Absender, Porträt, Hinweis erst mit dem Angebot', () => {
  const { g, f } = bereit();
  const o = bitte(g);
  ok(!!o, 'nach dem Start des Beats ist die Bitte offen (ruhige Lage)');
  ok(o && o.fadenId === f.id && o.beatId === 'b_bitte' && o.nr === 1, 'Faden, Beat und Nummer 1');
  ok(o && o.text.includes(f.nsc.name) && !o.text.includes('{name}') && !o.text.includes('{ort}'), 'Text mit NSC-Name, Platzhalter ersetzt');
  ok(o && o.optionen.map((x) => x.id).join(',') === 'zusagen,ablehnen,spaeter', 'die drei Optionen aus der Vorlage (keine Erfindung)');
  ok(o && o.optionen.every((x) => x.folge && typeof x.folge === 'object'), 'Folgen stehen am Angebot (server-seitig, nie im Snapshot)');
  ok(f.hinweise.includes('h_papiere'), 'der Hinweis des Beats gilt erst mit dem Angebot (B-S1)');
  const s = B.snapshot(g);
  ok(s && s.nr === 1 && s.kopf === 'BITTE' && s.spaeter === D.BITTE.spaeter_text && s.rest === 4, 'Snapshot: Nummer, Kopf, Später, Verfall in 4 Tätigkeiten');
  ok(s && s.optionen.every((x) => Object.keys(x).sort().join(',') === 'id,text'), 'Snapshot ohne Folgen');
  ok(s && /^f:[0-5]:(rom|kon|ger)$/.test(s.pid), 'Porträt-Kennung im Snapshot');
  ok(s && JSON.stringify(s).length < 700, `Snapshot klein (${JSON.stringify(s).length} Zeichen)`);
  const k1 = B.schluessel(g);
  X.grenzen(g, 1, 'andocken');
  ok(B.schluessel(g) !== k1, 'der Änderungsschlüssel ändert sich mit dem Verfall');
});

section('Angebot: Ablehnungsgründe (Prüfer, Gefahr, unruhig, Angebot schon offen, Text, Absender)', () => {
  const { g, f } = bereit();
  ok(B.anbieten(g, { fadenId: f.id, beatId: 'b_bitte', absender: { name: 'X', fraktion: 'rom', portrait: 1 }, text: 'x', optionen: [] }).code === 'schon_offen', 'zweites Angebot: schon offen (höchstens eines)');
  ws(g).faeden.bitte = null;
  const pr = (opts, extra) => { ws(g).faeden.bitte = null; return B.anbieten(g, Object.assign({ fadenId: f.id, beatId: 'b_bitte', absender: { name: 'Quintus Serran', fraktion: 'rom', portrait: 2 }, text: 'Hilfe', optionen: opts }, extra || {})); };
  const folge = (g2) => [{ typ: 'haltung_aenderung', grund: g2 }];
  ok(pr([{ id: 'a', text: 'A', folge: folge('geholfen'), ausgang: 'gelungen' }, { id: 'b', text: 'B', folge: folge('geholfen'), ausgang: 'gelungen' }]).code === 'optionen', 'gleiche Folge und gleicher Ausgang: Scheinwahl abgelehnt');
  ok(pr([{ id: 'a', text: 'A', folge: folge('geholfen'), ausgang: 'gelungen' }, { id: 'b', text: 'B', folge: folge('geholfen'), ausgang: 'gescheitert' }]).ok, 'gleiche Folge, anderer Ausgang: erlaubt (echte Wahl)');
  ok(pr([{ id: 'a', text: 'A', folge: folge('geholfen') }, { id: 'b', text: 'B', folge: folge('bitte_abgelehnt'), ausgang: 'gescheitert' }]).code === 'optionen', 'Option mit Folge ohne Ausgang: abgelehnt (sonst bliebe der Beat offen)');
  ok(pr([{ id: 'a', text: 'A', folge: [] }, { id: 'b', text: 'B', folge: [] }]).code === 'optionen', 'zwei folgenlose Optionen: Scheinwahl');
  ok(pr([{ id: 'a', text: 'A', folge: folge('geholfen'), ausgang: 'gelungen' }, { id: 'b', text: 'B', folge: folge('bitte_abgelehnt'), ausgang: 'gescheitert' }], { text: 'x'.repeat(D.BITTE.text_max + 1) }).code === 'text', 'Text zu lang');
  ok(pr([{ id: 'a', text: 'A', folge: folge('geholfen'), ausgang: 'gelungen' }, { id: 'b', text: 'B', folge: folge('bitte_abgelehnt'), ausgang: 'gescheitert' }], { absender: { name: 'X', fraktion: 'xyz', portrait: 1 } }).code === 'absender', 'unbekannte Fraktion des Absenders');
  g.simSzene = {};
  ok(pr([{ id: 'a', text: 'A', folge: folge('geholfen'), ausgang: 'gelungen' }, { id: 'b', text: 'B', folge: folge('bitte_abgelehnt'), ausgang: 'gescheitert' }]).code === 'unruhig', 'in einer Sim-Szene: nie eine Bitte (unruhig)');
  g.simSzene = null;
});

section('Deckel: eigener Deckel, Option entfällt statt Scheinwahl, Zurückziehen beim Antworten', () => {
  const { g, f } = bereit();
  // Deckel voll: die Option mit Ruf-Folge entfällt, die zwei übrigen (Ablehnen, Später) bleiben eine echte Wahl
  ws(g).faeden.bitte = null;
  ws(g).faeden.bitteLog = [[ws(g).faeden.t, 2]];
  const v = D.vorlage(BAS).beats[0].optionen;
  const r = B.anbieten(g, { fadenId: f.id, beatId: 'b_bitte', absender: { name: 'Quintus Serran', fraktion: 'rom', portrait: 2 }, text: 'Hilfe', optionen: v.map((o) => ({ id: o.id, text: o.text, folge: o.folge, ausgang: o.ausgang })) });
  ok(r.ok && r.bitte.optionen.map((x) => x.id).join(',') === 'ablehnen,spaeter', 'Deckel voll: nur die Optionen ohne Ruf-Folge (zusagen entfällt)');
  ws(g).faeden.bitte = null;
  ws(g).faeden.bitteLog = [];
  // Nur Optionen mit Ruf-Folge, Deckel voll: weniger als zwei Optionen, kein Angebot
  const nurRuf = [
    { id: 'a', text: 'A', folge: [{ typ: 'ruf_aenderung', grund: 'funk_rom_gruss' }], ausgang: 'gelungen' },
    { id: 'b', text: 'B', folge: [{ typ: 'ruf_aenderung', grund: 'funk_kon_nachricht' }], ausgang: 'gescheitert' },
    { id: 'c', text: 'C', folge: [{ typ: 'ruf_aenderung', grund: 'reise_havarie_rom' }], ausgang: 'gescheitert' },
  ];
  ws(g).faeden.bitteLog = [[ws(g).faeden.t, 2]];
  const r2 = B.anbieten(g, { fadenId: f.id, beatId: 'b_bitte', absender: { name: 'X', fraktion: 'rom', portrait: 2 }, text: 'Hilfe', optionen: nurRuf });
  ok(!r2.ok && r2.code === 'deckel', 'Deckel voll und keine Option ohne Ruf: kein Angebot (keine Scheinwahl)');
  ws(g).faeden.bitteLog = [];
  // zwischen Angebot und Antwort füllt sich der Deckel: zurückgezogen, ohne Folge, der Beat bleibt
  ws(g).faeden.bitte = null;
  ws(g).faeden.bitteLog = [];
  const rr = bereit();
  const o = bitte(rr.g);
  const haltungVor = liste(rr.g)[0].nsc.haltung, romVor = ws(rr.g).ruf.rom;
  ws(rr.g).faeden.bitteLog = [[ws(rr.g).faeden.t, 2]];
  const ant = B.beantworten(rr.g, 'zusagen', o.nr);
  ok(ant && ant.code === 'deckel', 'Antwort bei vollem Deckel: Weigerung deckel');
  ok(bitte(rr.g) === null && liste(rr.g)[0].phase === 'laeuft' && liste(rr.g)[0].laufend.gewaehlt === undefined, 'Angebot zurückgezogen, Beat unverändert');
  ok(liste(rr.g)[0].nsc.haltung === haltungVor && ws(rr.g).ruf.rom === romVor, 'keine Folge gebucht');
});

section('Antwort: erste Antwort gilt, Annahme, Ablehnung, Später', () => {
  // Annahme: Ausgang gelungen, Haltung +1, Ruf +0,25, der Beat geht zum nächsten
  const a = bereit(); const oa = bitte(a.g);
  const romVor = ws(a.g).ruf.rom;
  ok(B.beantworten(a.g, 'zusagen', oa.nr) === null, 'Annahme: Antwort ohne Weigerung');
  ok(liste(a.g)[0].nsc.haltung === 2, 'Annahme: Haltung +2 (geholfen +1 aus der Option, gedankt +1 aus dem Ausgang gelungen der Vorlage)');
  ok(Math.abs((ws(a.g).ruf.rom - romVor) - 0.25) < 1e-6, 'Annahme: Ruf Rom +0,25 (funk_rom_gruss)');
  ok(ws(a.g).faeden.bitteLog.length === 1 && Math.abs(ws(a.g).faeden.bitteLog[0][1] - 0.25) < 1e-9, 'Annahme bucht 0,25 im Bitten-Deckel (eigener Zähler)');
  ok(liste(a.g)[0].beat === 1 && liste(a.g)[0].phase === 'wartet', 'Annahme: Ausgang gelungen, der Faden wartet auf den nächsten Beat');
  ok(bitte(a.g) === null, 'nach der Antwort kein Angebot mehr');
  ok(B.beantworten(a.g, 'zusagen', oa.nr).code === 'schon_beantwortet', 'zweite Antwort: schon beantwortet (die erste gilt)');
  ok(B.beantworten(a.g, 'zusagen', 99).code === 'kein_angebot', 'Antwort ohne Angebot');
  // Ablehnung: Ausgang gescheitert, Haltung -1, Faden verändert sich (anderer Weg), endet nicht
  const b = bereit(); const ob = bitte(b.g);
  ok(B.beantworten(b.g, 'ablehnen', ob.nr) === null, 'Ablehnung: Antwort ohne Weigerung');
  ok(liste(b.g)[0].nsc.haltung === -1, 'Ablehnung: Haltung -1 (bitte_abgelehnt), nur die dokumentierte Haltung');
  ok(liste(b.g)[0].beat === 2 && liste(b.g)[0].nsc.status === 'gefangen' && liste(b.g)[0].phase !== 'abgeschlossen', 'Ablehnung: gescheitert, der Faden geht den anderen Weg (b_notruf) und endet nicht');
  // Später: die Bitte wird zurückgestellt, der Beat bleibt offen, ohne Folge
  const c = bereit(); const oc = bitte(c.g);
  ok(B.beantworten(c.g, 'spaeter', oc.nr) === null, 'Später (Daten): keine Weigerung');
  ok(bitte(c.g) === null && liste(c.g)[0].phase === 'laeuft' && liste(c.g)[0].nsc.haltung === 0, 'Später: kein Angebot mehr, der Beat läuft, keine Haltung');
  X.grenzen(c.g, 1, 'andocken');
  ok(bitte(c.g) !== null, 'Später: die Bitte kommt mit der nächsten Tätigkeit wieder (Wiederholung)');
  // Unbekannte Option
  const d = bereit(); const od = bitte(d.g);
  ok(B.beantworten(d.g, 'nicht_da', od.nr).code === 'unbekannt', 'unbekannte Option: Weigerung unbekannt');
  ok(bitte(d.g) !== null, 'unbekannte Option: das Angebot bleibt');
  ok(B.beantworten(d.g, 'zusagen', od.nr + 5).code === 'kein_angebot', 'ältere oder fremde Nummer: kein Angebot');
});

section('Verfall in Tätigkeiten (nicht Sprünge): ein Beat ohne Antwort gilt als gescheitert', () => {
  const { g, f } = bereit();
  const o = bitte(g);
  X.grenzen(g, 3, 'andocken');
  ok(bitte(g) === o && bitte(g) !== null, 'nach 3 von 4 Tätigkeiten: noch offen');
  X.grenzen(g, 1, 'andocken');
  ok(bitte(g) === null, 'nach der 4. Tätigkeit: verfallen');
  ok(liste(g)[0].beat === 2 && liste(g)[0].nsc.status === 'gefangen', 'verfallen = gescheitert (Ausgang des Beats): b_notruf, Status gefangen');
  ok(B.beantworten(g, 'zusagen', o.nr).code === 'kein_angebot', 'nach dem Verfall: keine Antwort mehr möglich');
  ok(ws(g).faeden.bitteLog.length === 0, 'Verfall bucht keinen Betrag im Bitten-Deckel');
});

section('Unruhige Lage: zurückziehen (ohne Folge) und Wiederholung', () => {
  const g = X.spiel({}).g;
  const f = X.oeffne(g, BAS);
  X.grenzen(g, 6, 'andocken');
  g.simSzene = {};
  const r = weiter(g, f);
  ok(r.ok && bitte(g) === null, 'Start in unruhiger Lage: kein Angebot, der Beat läuft trotzdem (nichts blockiert)');
  ok(liste(g)[0].phase === 'laeuft', 'der Beat läuft');
  g.simSzene = null;
  X.grenzen(g, 1, 'andocken');
  ok(bitte(g) !== null, 'ruhig und die nächste Tätigkeit: das Angebot kommt (Wiederholung)');
  g.simSzene = {};
  B.update(g);
  ok(bitte(g) === null && liste(g)[0].phase === 'laeuft', 'unruhig: das Angebot wird zurückgezogen, ohne Folge, der Beat bleibt');
  ok(B.beantworten(g, 'zusagen', 1).code === 'kein_angebot', 'Antwort nach dem Zurückziehen: kein Angebot mehr');
  g.simSzene = null;
});

section('Weltstand: Runde, Altstand, Müll, Schema', () => {
  const { g } = bereit();
  const o = bitte(g);
  const data = Weltstand.capture(g);
  const blk = data.welt.sim.faeden;
  ok(blk && blk.bitte && blk.bitte.nr === o.nr && blk.bitte.faden === o.fadenId && blk.bitte.beat === 'b_bitte', 'die offene Bitte steht im Block (nr, Faden, Beat)');
  ok(blk.bitte.optionen.length === 3 && !('folge' in blk.bitte.optionen[0]), 'optionen ohne Folge im Stand (die Folgen kommen aus der Vorlage)');
  ok(Weltstand.validate(data, g).length === 0, 'der Stand besteht das Weltstand-Schema: ' + Weltstand.validate(data, g).slice(0, 2).join('; '));
  const sim = roh(data.welt.sim);
  const g2 = X.spiel({}).g;
  Kriegslage.restore(g2, sim);
  const o2 = bitte(g2);
  ok(!!o2 && o2.nr === o.nr && o2.text === o.text && o2.optionen.length === 3, 'Laden: die Bitte ist wieder da (Nummer, Text, Optionen)');
  ok(o2 && o2.optionen[0].folge && o2.optionen[0].folge.length === 2, 'Laden: die Folgen kommen aus der Vorlage');
  ok(JSON.stringify(B.toSaveBitte(ws(g2).faeden)) === JSON.stringify(blk.bitte), 'Speichern und Laden ergibt denselben Block (Runde)');
  // Antwort nach dem Laden funktioniert
  ok(B.beantworten(g2, 'ablehnen', o2.nr) === null && liste(g2)[0].nsc.haltung === -1, 'nach dem Laden: die Antwort gilt und bucht die Folge');
  // Altstand ohne den Block: keine Bitte
  const alt = roh(sim); delete alt.faeden.bitte;
  const g3 = X.spiel({}).g; Kriegslage.restore(g3, alt);
  ok(bitte(g3) === null, 'Altstand ohne bitte: keine Bitte, kein Fehler');
  // Müll: unbrauchbare Bitte fällt weg, mit Meldung
  for (const [name, aendern] of [
    ['Nummer kaputt', (x) => { x.nr = 'x'; }],
    ['Faden unbekannt', (x) => { x.faden = 'f99'; }],
    ['falscher Beat', (x) => { x.beat = 'b_ende'; }],
    ['Option unbekannt', (x) => { x.optionen[0].id = 'gibt_es_nicht'; }],
    ['Text zu lang', (x) => { x.text = 'x'.repeat(500); }],
    ['Rest zu groß', (x) => { x.rest = 99; }],
    ['Optionen zu wenig', (x) => { x.optionen = x.optionen.slice(0, 1); }],
    ['Optionen zu viele', (x) => { x.optionen = x.optionen.concat(x.optionen); }],
  ]) {
    const m = roh(sim); aendern(m.faeden.bitte);
    const g4 = X.spiel({}).g;
    let fehler = null;
    try { Kriegslage.restore(g4, m); } catch (e) { fehler = e; }
    ok(!fehler && bitte(g4) === null, `Müll (${name}): verworfen, kein Absturz`);
  }
});

section('Porträt: Variante und Fraktion gültig, Müll ohne Fehler', () => {
  const npc = (fr, p) => ({ fraktion: fr, portrait: p });
  let alle = 0, gut = 0;
  for (const fr of ['rom', 'ger', 'kon']) for (let v = 0; v < 6; v++) {
    const pid = B.portraetPid(npc(fr, v));
    alle++;
    if (pid === 'f:' + v + ':' + fr && B.pidGueltig(pid)) gut++;
  }
  ok(gut === alle && alle === 18, `alle 6 Varianten x 3 Fraktionen gültig (${gut}/${alle})`);
  ok(B.portraetPid(npc('rom', 7)) === 'f:1:rom', 'Porträt-Seed wird auf die Variante geklemmt (7 mod 6 = 1)');
  ok(B.portraetPid(npc('xyz', 1)) === null, 'unbekannte Fraktion: kein Porträt');
  for (const m of ['f:6:rom', 'f:-1:rom', 'f:1:xyz', 'legat', 'mars', '', null, 'f:1:rom;x', 'f:01:rom', 42]) ok(!B.pidGueltig(m), `Müll-Kennung ${JSON.stringify(m)} gilt nicht`);
  const { g, f } = bereit();
  const sent = [];
  const g2 = { emit: (kind, ev) => sent.push([kind, ev]) };   // funkVon braucht nur emit
  const z = B.funkVon(g2, f.nsc, '  Hallo\n Ihr da  ');
  ok(z && z.von === f.nsc.name && z.text === 'Hallo Ihr da', 'Funkzeile: Name, Text ohne Zeilenumbruch');
  ok(sent.length === 1 && sent[0][0] === 'radio' && /^f:[0-5]:(rom|ger|kon)$/.test(sent[0][1].pid), 'Funkzeile mit gültigem Porträt (pid)');
  ok(B.funkVon(g2, { name: 'X', fraktion: 'xyz' }, 'x') !== null && sent[sent.length - 1][1].pid === undefined, 'unbekannte Fraktion: Funkzeile ohne Porträt (Rückfall)');
  ok(B.funkVon(g2, null, 'x') === null, 'kein NSC: keine Zeile');
});

section('Faden-Kompatibilität: Bitten ändern die Fadenzähler nicht ohne Angebot', () => {
  const g = X.spiel({ aus: true }).g;
  ok(Faden.aktiv(g) === false && Faden.toSave(ws(g)) === null, 'ohne Schalter kein Faden-Block');
  ok(B.snapshot(g) === null, 'ohne Schalter kein Angebot im Snapshot');
});

section('Verdrahtung: Funk-Angebot wartet während einer Bitte; der Takt zieht eine Bitte in unruhiger Lage zurück (echte Hooks)', () => {
  const RE = require('../server/sim/reise-ereignis.js');
  const FA = require('../server/sim/funk-antwort.js');
  const g = X.spiel({ env: { REISE_EREIGNISSE: '1' } }).g;
  const f = X.oeffne(g, BAS);
  X.grenzen(g, 6, 'andocken');
  weiter(g, f);
  const ev = RE.KATALOG.find((e) => Array.isArray(e.antworten) && e.antworten.length >= 2 && !e.gefahr);
  ok(!!ev, 'es gibt einen Funk-Katalogeintrag mit Antworten (Fixture)');
  ws(g).funkwahl = null;
  ws(g).faeden.bitte = null;
  const frei = FA.anbieten(g, ev);
  ok(!!frei, 'ohne Bitte: der Funk-Eintrag bietet seine Antwort an (Vergleich)');
  ws(g).funkwahl = null;
  ws(g).faeden.bitte = { nr: 9, fadenId: f.id, beatId: 'b_bitte', von: 'X', volk: 'rom', pid: null, text: 'x', optionen: [{ id: 'zusagen', text: 'A', folge: [] }, { id: 'ablehnen', text: 'B', folge: [] }], bis: ws(g).faeden.t + 3 };
  ok(FA.anbieten(g, ev) === null, 'mit offener Bitte: keine Funk-Antwort (eine Antwortleiste)');
  g.simSzene = {};
  RE.update(g);
  ok(bitte(g) === null, 'Takt in unruhiger Lage (RE.update): die Bitte wird zurückgezogen, ohne Folge');
  g.simSzene = null;
});

section('Schutzregeln: Gefahr, offene Funk-Antwort, Deckel-Fenster, Ruhe bei der Antwort, verlaufener Beat', () => {
  const { g, f } = bereit();
  const opts = D.vorlage(BAS).beats[0].optionen.map((o) => ({ id: o.id, text: o.text, folge: o.folge, ausgang: o.ausgang }));
  const angebot = (o) => B.anbieten(g, Object.assign({ fadenId: f.id, beatId: 'b_bitte', absender: { name: 'Quintus Serran', fraktion: 'rom', portrait: 2 }, text: 'Hilfe', optionen: opts }, o || {}));
  const alt = D.BEATS.bitte.gefahr;
  ws(g).faeden.bitte = null;
  D.BEATS.bitte.gefahr = true;
  try { ok(angebot().code === 'gefahr', 'Katalog sagt Gefahr: nie ein Angebot, auch wenn der Prüfer der Vorlage es nicht sähe'); } finally { D.BEATS.bitte.gefahr = alt; }
  ok(angebot().ok, 'ohne Gefahr: das Angebot kommt (Vergleich)');
  ws(g).faeden.bitte = null;
  ws(g).funkwahl = { offen: { lfd: 1, id: 'x', ev: null, von: 'x', optionen: [], bis: 99 }, reaktion: null, zuletzt: null, romLog: [] };
  ok(angebot().code === 'funk_offen', 'eine offene Funk-Antwort: keine Bitte daneben');
  ws(g).funkwahl = null;
  ws(g).faeden.bitteLog = [[ws(g).faeden.t - 200, 2]];
  const weit = angebot();
  ok(weit.ok && weit.bitte.optionen.some((x) => x.id === 'zusagen'), 'Deckel: ein Verbrauch vor dem Fenster (100 Tätigkeiten) zählt nicht mehr');
  ws(g).faeden.bitte = null; ws(g).faeden.bitteLog = [];
  const r = angebot();
  g.simSzene = {};
  ok(B.beantworten(g, 'zusagen', r.bitte.nr).code === 'unruhig', 'Antwort in einer Sim-Szene: unruhig, auch ohne den Takt (Prüfung in der Antwort)');
  g.simSzene = null;
  ws(g).faeden.bitte = null;
  const r3 = angebot();
  ws(g).faeden.liste[0].phase = 'wartet';
  ok(B.beantworten(g, 'zusagen', r3.bitte.nr).code === 'kein_angebot', 'verlaufener Beat: keine Antwort mehr');
  ws(g).faeden.liste[0].phase = 'laeuft'; ws(g).faeden.bitte = null;
});

console.log(`\n${n - fails} von ${n} Prüfungen bestanden` + (fails ? `, ${fails} FEHLER` : ''));
if (fails) process.exit(1);
