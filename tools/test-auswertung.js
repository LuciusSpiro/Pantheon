'use strict';
// TEL-01 D1: Test der Auswertung (tools/auswertung/*.js, tools/auswerten.js).
//   1. Handgebautes Mini-Protokoll mit von Hand ausgerechneten Werten (exakte Gleichheit): Quote je Waffe (Flaechenwaffe, Raum-Lanze ohne pid, Gegner),
//      Zeit bis Kill, Rollenzeiten mit Nachzuegler und Abgang, Leerlauf, Deckungszeit, Verlassen-bis-Treffer, Peek-and-Shoot, Buchungssummen, Tickspitzen.
//   2. Rotierte Session (zwei Teile) = gleiche Kennzahlen wie ungeteilt; abgeschnittene letzte Zeile wird gezaehlt, nicht abgebrochen; unbekannte Typen gezaehlt.
//   3. Echte Bot-Laeufe mit Telemetrie an (Graben zu dritt, Wellen, Kampagne zu dritt): Bericht <= 60 Zeilen, Auffaelligkeiten oben, Block je Frage, SVG gueltig,
//      Quoten <= 100 %, kein NaN/undefined/Infinity, keine Bot-Namen, keine clientId.
//   4. Basis-Abweichung (eine Quote x2 -> genau diese Kennzahl in den Auffaelligkeiten) und Ziele (leer: keine Ampel; Test-Ziel: Ampel).
//   node tools/test-auswertung.js   (npm run test:auswertung)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const Lesen = require('./auswertung/lesen.js');
const { kennzahlen, flach, infoZu, KENNZAHL_INFO } = require('./auswertung/kennzahlen.js');
const { bericht } = require('./auswertung/bericht.js');
const { profil } = require('./auswertung/profil.js');
const { auswerten } = require('./auswerten.js');
const { SCHEMA } = require('../server/telemetrie/schema.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const LIMIT = 60;   // Zeilendeckel laut Briefing; bewusst NICHT aus bericht.js gelesen, sonst würde die Mutationsprobe am Limit nichts bemerken
const gleich = (a, b, t) => ok(a === b, t + (a === b ? '' : ' (ist ' + JSON.stringify(a) + ', soll ' + JSON.stringify(b) + ')'));
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-auswertung-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });

// ===================== 1. Mini-Protokoll =====================
// 20 Zeitreihenfenster (je 2 s, t = 2 ... 40). p1: Fenster 1-12 im Schiff (captain), 13-20 am Boden. p2: Nachzuegler, steht ab Fenster 8 in slots,
// verbunden in 8-14 (weapons), ab Fenster 15 Abgang (verbunden false, die Station steht noch auf weapons: zaehlt NICHT).
const SID = 'mini-1';
const zeilen = [];
const Z = (t, typ, f) => zeilen.push(Object.assign({ v: 1, typ, sitzung: SID, tick: Math.round(t * 30), t }, f));
Z(0, 'kopf', { commit: 'abcdef0123456789', server_version: '0.2.0', plattform: 'win32-x64', node: 'v22', run_id: SID, seed: 1, modus: 'wellen_boden', szenario: 'kesh', graben: null, weltstand: null, regielog: 'mini.jsonl', quelle: 'bot', spielerzahl: 1, slots: [{ slot: 'p1', belegung: 1, konsole: null, verbunden: true }], schiff: {}, schalter: {}, tuning_hash: 'x', tuning_teile: {} });
Z(0, 'szene_start', { modus: 'wellen_boden', szene: 'kesh', spielerzahl: 1, seed: 1, gegner: null, hex: null, klasse: null });
Z(0, 'buchung', { konto: 'marks', art: 'stand', grund: 'anfang', betrag: 0, stand: 150 });
Z(1, 'buchung', { konto: 'marks', art: 'buchung', grund: 'erkundung', betrag: 20, stand: 170 });
Z(3, 'buchung', { konto: 'marks', art: 'buchung', grund: 'kauf', betrag: -50, stand: 120 });
Z(3, 'buchung', { konto: 'bolzen', art: 'buchung', grund: 'schuss', betrag: -5, stand: 95 });
Z(3.5, 'buchung', { konto: 'bolzen', art: 'buchung', grund: 'schuss', betrag: -3, stand: 92 });
Z(5, 'spieler_bei', { slot: 'p2', art: 'neu', belegung: 1, nachzuegler: true, spielerzahl: 2 });
Z(28, 'spieler_weg', { slot: 'p2', belegung: 1, spielerzahl: 1 });
// Zeitreihe: 20 Fenster
for (let k = 1; k <= 20; k++) {
  const t = 2 * k;
  const mitP2 = k >= 8;
  const p1Boden = k >= 13;
  const r = {
    fenster: 2, tick_n: 60, tick_med: 0.1, tick_max: k === 5 ? 41.5 : 0.5, tick_ueber5: k === 5 ? 1 : 0, tick_ueber16: k === 5 ? 1 : 0, tick_ueber33: k === 5 ? 1 : 0, snap_n: 0, snap_med: null, snap_max: null,
    kappung_n: 0, kappung_ticks: 0, nachhol_ticks: 0, fehler_n: 0, fehler_wo: [], szene: 'kesh',
    r_zustand: '0', r_integ: [10, 10], r_reaktor: 'online', r_energie: [2, 2, 2], r_leistung: 6, r_verbrauch: 6, r_hitze: [0, 0, 0], r_schild: [4, 4, 4, 4], r_gegner: k >= 3 && k <= 6 ? 2 : 0,
    slots: mitP2 ? ['p1', 'p2'] : ['p1'],
    verbunden: mitP2 ? [true, k <= 14] : [true],
    ort: mitP2 ? [p1Boden ? 'boden' : 'raum', 'raum'] : [p1Boden ? 'boden' : 'raum'],
    konsole: mitP2 ? [p1Boden ? null : 'captain', 'weapons'] : [p1Boden ? null : 'captain'],
    station: mitP2 ? [p1Boden ? null : 'captain', 'weapons'] : [p1Boden ? null : 'captain'],
    // p1: Eingaben nur in den Fenstern 1-2 und 19-20 -> Leerlauf Fenster 3-18 = 16 Fenster = 32 s (>= 30 s); p2 immer aktiv, ausser Fenster 8-14 komplett (14 s, keine Strecke)
    ein_bew: mitP2 ? [k <= 2 || k >= 19 ? 1 : 0, 0] : [k <= 2 ? 1 : 0],
    ein_akt: mitP2 ? [0, 0] : [0],
    b_schild: mitP2 ? [p1Boden ? 3 : null, null] : [p1Boden ? 3 : null], b_wunden: null, b_liegt: null, b_cv: null, b_geduckt: null, b_sp: null,
    b_gg: p1Boden && k <= 16 ? 4 : (p1Boden ? 0 : null), b_gg_duck: p1Boden && k <= 16 ? 1 : (p1Boden ? 0 : null), b_gg_abst_min: p1Boden && k <= 16 ? 2 : null, b_gg_abst_nn: p1Boden && k <= 16 ? 6 : null, b_gg_pos: null,
  };
  Z(t, 'zeitreihe', r);
}
Z(11, 'konsole', { slot: 'p1', konsole: 'captain', station: 'helm', rein: true, grund: 'tab' });
Z(12, 'konsole', { slot: 'p1', konsole: 'captain', station: 'captain', rein: true, grund: 'tab' });
Z(12.5, 'konsole', { slot: 'p1', konsole: 'captain', station: 'captain', rein: true, grund: 'betreten' });
// Schuesse und Treffer (Boden): blaster von p1: a1 (1 Treffer), a2 (kein), a3 (2 Treffer), a4 (kein) -> 4 Schuesse, 2 mit Treffer = 50 %, 3 Treffer = 0,75 je Schuss
const sch = (t, f) => Z(t, 'schuss', Object.assign({ ort: 'boden', waffe: 'blaster', von: 'p1', mount: null, pid: null, ziel: null, gegner: null, rolle: null, kraft: null, treffer: null, hitze: 0.2, von_deckung: false, geduckt: false }, f));
const tre = (t, f) => Z(t, 'treffer', Object.assign({ ort: 'boden', waffe: 'blaster', von: 'p1', ziel: 'gegner', gegner: 'w-1', rolle: 'grundtyp', pid: null, ergebnis: 'schild', schaden_roh: 2, schild: 2, schaden: 0, wunde: false, von_deckung: false, ziel_deckung: false, flaeche: false }, f));
sch(26.5, { pid: 'a1', von_deckung: true }); tre(26.7, { pid: 'a1', von_deckung: true });
sch(27, { pid: 'a2' });
sch(27.5, { pid: 'a3' }); tre(27.8, { pid: 'a3', gegner: 'w-1' }); tre(27.9, { pid: 'a3', gegner: 'w-2', schaden_roh: 3, schild: 1, schaden: 2, ergebnis: 'wunde' });
sch(28, { pid: 'a4', von_deckung: true });
// Flaechenwaffe: 1 Schuss, 3 Treffer -> Quote 100 %, Treffer je Schuss 3
sch(29, { waffe: 'granatwerfer', von: 'p2', pid: 'g1' });
for (const g of ['w-1', 'w-2', 'w-3']) tre(29.4, { waffe: 'granatwerfer', von: 'p2', pid: 'g1', gegner: g });
// Raum-Lanze ohne pid: Ergebnis steht im Schuss -> 2 Schuesse, 1 Treffer = 50 %
Z(6, 'schuss', { ort: 'raum', waffe: 'lanze', von: 'lerche', mount: 'bow', pid: null, ziel: 'gegner', gegner: 'e1', rolle: 'raider', kraft: 0.4, treffer: true });
Z(7, 'schuss', { ort: 'raum', waffe: 'lanze', von: 'lerche', mount: 'bow', pid: null, ziel: 'gegner', gegner: 'e1', rolle: 'raider', kraft: 0.4, treffer: false });
// Gegnerschuesse: 2 Schuesse, 1 Treffer
Z(30, 'schuss', { ort: 'boden', waffe: 'sturmgewehr', von: 'gegner', pid: 'e1', gegner: 'w-1', rolle: 'grundtyp', hitze: null, von_deckung: true, geduckt: false });
Z(30.5, 'schuss', { ort: 'boden', waffe: 'sturmgewehr', von: 'gegner', pid: 'e2', gegner: 'w-1', rolle: 'grundtyp', hitze: null, von_deckung: true, geduckt: false });
// Treffer auf p1: t=31 (ziel_deckung false), t=39 (ziel_deckung true)
Z(30.6, 'treffer', { ort: 'boden', waffe: 'sturmgewehr', von: 'gegner', ziel: 'p1', gegner: 'w-1', rolle: 'grundtyp', pid: 'e2', ergebnis: 'gefallen', schaden_roh: 2, schild: 0, schaden: 2, wunde: true, von_deckung: true, ziel_deckung: false, flaeche: false });
Z(39, 'treffer', { ort: 'boden', waffe: 'sturmgewehr', von: 'gegner', ziel: 'p1', gegner: 'w-1', rolle: 'grundtyp', pid: null, ergebnis: 'schild', schaden_roh: 1, schild: 1, schaden: 0, wunde: false, von_deckung: false, ziel_deckung: true, flaeche: false });
Z(30.6, 'gefallen', { slot: 'p1', waffe: 'sturmgewehr', von: 'gegner' });
Z(35, 'notrueckholung', { art: 'einzel', slot: 'p1', slots: null });
Z(36, 'notfall', { grund: 'test' });
Z(37, 'zone_aus', { system: 'engines', zone: 'heck', zustand: 'broken', vorher: 'ok' });
// Kills: grundtyp 10/20/30 s -> Median 20; zinne 5 s
const kill = (t, rolle, lebte, von) => Z(t, 'kill', { ort: 'boden', gegner: 'w-' + t, rolle, von: von || 'p1', waffe: 'blaster', lebte, nr: 1 });
kill(31, 'grundtyp', 10); kill(32, 'grundtyp', 20); kill(33, 'grundtyp', 30, 'p2'); kill(34, 'zinne', 5);
// Deckung p1 (Rohzustand): siehe Kopf der Auswertung; Zeiten wie im Kommentar der Erwartung unten
const dk = (t, f) => Z(t, 'deckung', Object.assign({ slot: 'p1', gegner: null, rolle: null, cv: 0, geduckt: false, verdeckt: false, flanke: false, stellung: false, x: 5, y: 5, ende: null }, f));
dk(26, { cv: 2 }); dk(30, {}); dk(32, { geduckt: true }); dk(34, { verdeckt: true }); dk(35.5, { cv: 1 }); dk(36.5, {}); dk(37.5, { cv: 1 }); dk(40, { ende: 'session' });
// Peek: eigener Schuss zwischen 36.5 und 37.5
sch(37, { pid: 'a5' });
// Reparaturspiele
Z(20, 'reparatur', { slot: 'p1', system: 'engines', wie: 'minigame', dauer: 4, erfolg: true, notflicken: false });
Z(22, 'reparatur', { slot: 'p1', system: 'engines', wie: 'flick', dauer: 2, erfolg: false, notflicken: true });
Z(40, 'szene_ende', { modus: 'wellen_boden', szene: 'kesh', ausgang: 'unten', dauer: 40, dauer_gesamt: 40, spielerzahl: 1, welle: 2, geschafft: 1, debug: false, versuche: null, hex: null, verrat: null });
Z(40, 'session_ende', { grund: 'test', dauer: 40, zeilen: zeilen.length + 1, fehler: 0, verworfen: 0, bytes: 12345 });
zeilen.sort((a, b) => a.t - b.t);   // das Protokoll ist zeitlich geordnet (Stabilsortierung)
const TEXT = zeilen.map((z) => JSON.stringify(z)).join('\n') + '\n';

section('1. Mini-Protokoll: Kennzahlen von Hand gerechnet');
const P = Lesen.ausText(TEXT, { kennung: SID });
ok(P.zeilen.length === zeilen.length && P.kaputt === 0 && P.abgeschnitten === 0 && P.schemaOk, 'ausText liest alle ' + zeilen.length + ' Zeilen ohne Fehler');
const K = kennzahlen(P);
const F = flach(K);
const soll = (k, v) => gleich(F[k], v, k + ' = ' + v);
// F2: Quote, Treffer je Schuss
soll('f2.schuesse.boden.blaster', 5);          // a1..a5 (a5 ohne Treffer)
soll('f2.quote.boden.blaster', 40);            // a1 und a3 haben Treffer: 2 / 5
soll('f2.treffer_je_schuss.boden.blaster', 0.6);   // 3 Treffer / 5 Schuesse
soll('f2.quote.boden.granatwerfer', 100);      // 1 Schuss, 3 Treffer
soll('f2.treffer_je_schuss.boden.granatwerfer', 3);
soll('f2.quote.raum.lanze', 50);               // ohne pid: Ergebnis im Schuss
soll('f2.schuesse_gegner.boden.sturmgewehr', 2);
soll('f2.quote_gegner.boden.sturmgewehr', 50); // e2 trifft p1, e1 nicht
soll('f2.treffer_je_schuss_gegner.boden.sturmgewehr', 0.5);
// F2: Schaden aus/ein (Boden): aus = 5 Treffer von p1/p2 auf gegner (roh 2+2+3+2*... siehe Zeilen)
soll('f2.treffer_n.boden.aus', 6);             // a1, a3 x2, g1 x3
soll('f2.schaden.boden.aus.roh', 13);          // 2 + 2 + 3 + 3 * 2
soll('f2.schaden.boden.aus.schild', 11);       // 2 + 2 + 1 + 3 * 2
soll('f2.schaden.boden.aus.wirkt', 2);         // nur der wunde-Treffer
soll('f2.treffer_n.boden.ein', 2);
soll('f2.schaden.boden.ein.roh', 3);
soll('f2.schaden.boden.ein.wirkt', 2);
// F2: Kills und Zeit bis Kill
soll('f2.kills.boden.gesamt', 4);
soll('f2.kills.boden.grundtyp', 3);
soll('f2.zeit_bis_kill.boden.grundtyp', 20);   // Median von 10, 20, 30
soll('f2.zeit_bis_kill.boden.zinne', 5);
soll('f2.kills_von.p1', 3);
soll('f2.kills_von.p2', 1);
soll('f2.gefecht.raum', 8);                    // Fenster 3-6 mit r_gegner > 0
soll('f2.gefecht.boden', 8);                   // Fenster 13-16 mit b_gg > 0
// F2b: Deckung (cv > 0 / geduckt / verdeckt getrennt)
soll('f2b.deckung.p1.cv_s', 7.5);              // 26-30 (4) + 35,5-36,5 (1) + 37,5-40 (2,5)
soll('f2b.deckung.p1.geduckt_s', 2);           // 32-34
soll('f2b.deckung.p1.verdeckt_s', 1.5);        // 34-35,5
soll('f2b.deckung.p1.cv_anteil', 46.88);       // 7,5 s / 16 s am Boden
soll('f2b.verlassen.n', 2);                    // Verlassen bei 30 und bei 36,5
soll('f2b.verlassen.mit_treffer', 1);          // Treffer bei 30,6 vor der Rueckkehr (35,5); der Treffer bei 39 liegt nach der Rueckkehr
soll('f2b.verlassen.bis_treffer_median', 0.6);
soll('f2b.peek.episoden', 1);                  // 36,5 -> 37,5 (1 s < 3 s)
soll('f2b.peek.mit_schuss', 1);                // Schuss a5 bei 37
soll('f2b.treffer_auf_spieler.n', 2);
soll('f2b.treffer_auf_spieler.in_deckung_anteil', 50);
soll('f2b.treffer_von_spieler.n', 6);
soll('f2b.treffer_von_spieler.aus_deckung_anteil', 16.67);   // 1 von 6 (a1)
soll('f2b.schuesse_spieler.aus_deckung_anteil', 33.33);      // a1, a4 aus Deckung von 6 Schuessen am Boden (a1..a5, g1)
soll('f2b.schuesse_gegner.aus_deckung_anteil', 100);
soll('f2b.gegner_abstand.nn_mittel', 6);
soll('f2b.gegner_abstand.min', 2);
soll('f2b.gegner_geduckt_anteil', 25);
// F3
soll('f3.gefallen.n', 1); soll('f3.gefallen.p1', 1); soll('f3.notrueckholung.einzel', 1); soll('f3.notfall.n', 1); soll('f3.zone_aus.n', 1); soll('f3.zone_aus.kaputt', 1);
soll('f3.erster_verlust_s', 30.6);
// F4: Rollenzeiten mit Nachzuegler und Abgang
soll('f4.dabei.p1', 40);
soll('f4.rolle.p1.captain', 24);               // Fenster 1-12
soll('f4.rolle.p1.boden', 16);                 // Fenster 13-20
soll('f4.dabei.p2', 14);                       // Fenster 8-14 verbunden; ab 15 Abgang (station steht noch auf weapons, zaehlt nicht)
soll('f4.rolle.p2.weapons', 14);
ok(F['f4.rolle.p2.ohne'] === undefined && F['f4.rolle.p2.boden'] === undefined, 'p2: keine anderen Rollen');
soll('f4.leerlauf.p1.dauer', 32);              // Fenster 3-18
soll('f4.leerlauf.p1.episoden', 1);
soll('f4.leerlauf.p1.anteil', 80);
soll('f4.leerlauf.p2.dauer', 0);               // 14 s ohne Eingabe: unter 30 s, keine Strecke
soll('f4.wechsel.p1', 2);                      // zwei Tabwechsel (betreten zaehlt nicht)
soll('f4.reparatur.n', 2); soll('f4.reparatur.erfolg_anteil', 50); soll('f4.reparatur.dauer_mittel', 3); soll('f4.reparatur.notflicken', 1);
ok(K.listen.rollen.p2.nachzuegler === true && K.listen.rollen.p2.abgang === 28 && K.listen.rollen.p1.nachzuegler === false, 'Rollenliste: p2 Nachzügler, Abgang bei 28 s, p1 nicht');
// F1
soll('f1.dauer.session', 40); soll('f1.dauer.wellen_boden.summe', 40); soll('f1.dauer.wellen_boden.n', 1); soll('f1.ausgang.unten', 1);
soll('f1.spieler.start', 1); soll('f1.spieler.max', 2); soll('f1.spieler.nachzuegler', 1); soll('f1.spieler.abgaenge', 1);
// F5: Buchungen (nur art buchung), Anfangsstand aus der ersten Buchung
soll('f5.buchung.marks.erkundung', 20); soll('f5.buchung.marks.kauf', -50); soll('f5.buchung.bolzen.schuss', -8);
soll('f5.konto.marks.anfang', 150); soll('f5.konto.marks.ende', 120); soll('f5.konto.marks.netto', -30);
soll('f5.energie.engines_anteil', 33.33);
// F6: Tickspitzen
soll('f6.tick.med', 0.1); soll('f6.tick.max', 41.5); soll('f6.tick.ueber33', 1); soll('f6.tick.ueber5', 1); soll('f6.tick.n', 1200);
soll('f6.protokoll.mb_je_h', Math.round(12345 * 3600 / 40 / 1048576 * 100) / 100);
// Info-Tabelle: jede Kennzahl des Laufs hat ein Muster mit Einheit, Frage, Richtung
const ohneInfo = Object.keys(F).filter((k) => !infoZu(k));
ok(ohneInfo.length === 0, 'jede Kennzahl hat einen KENNZAHL_INFO-Eintrag' + (ohneInfo.length ? ' (fehlt: ' + ohneInfo.slice(0, 5).join(', ') + ')' : ''));
ok(Object.values(KENNZAHL_INFO).every((i) => ['besser', 'schlechter', 'neutral'].includes(i.richtung) && i.einheit && i.frage && i.text), 'KENNZAHL_INFO: Einheit, Frage, Richtung, Text');
ok(Object.keys(F).every((k) => Number.isFinite(F[k])) && JSON.stringify(K).indexOf('NaN') < 0, 'alle Kennzahlen sind endliche Zahlen');
const K2 = kennzahlen(P);
ok(JSON.stringify(K) === JSON.stringify(K2), 'kennzahlen ist rein: zweimal gerechnet = gleich');

section('2. Rotierte Session, abgeschnittene Zeile, unbekannter Typ');
{
  const dir = path.join(TMP, 'rot');
  fs.mkdirSync(dir);
  const teile = TEXT.split('\n').filter(Boolean);
  const k = Math.floor(teile.length / 2);
  fs.writeFileSync(path.join(dir, SID + '.jsonl'), teile.slice(0, k).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, SID + '.2.jsonl'), teile.slice(k).join('\n') + '\n');
  const R = Lesen.lesen(SID, { dirs: [dir] });
  gleich(R.dateien.length, 2, 'Kennung findet beide Teile');
  ok(JSON.stringify(kennzahlen(R)) === JSON.stringify(K), 'zwei Teile = gleiche Kennzahlen wie ungeteilt');
  const R2 = Lesen.lesen(path.join(dir, SID + '.2.jsonl'));
  gleich(R2.dateien.length, 2, 'eine Teildatei als Eingabe liest die ganze Session');
  // abgeschnittene letzte Zeile (Prozess hart beendet) und eine kaputte Zeile mitten drin, dazu ein unbekannter Typ
  const kaputt = path.join(dir, 'k');
  fs.mkdirSync(kaputt);
  fs.writeFileSync(path.join(kaputt, SID + '.jsonl'), teile.slice(0, 20).join('\n') + '\n{"v":1,"typ":"zukunft","t":1}\nnicht json\n' + teile.slice(20, 30).join('\n') + '\n{"v":1,"typ":"treff');
  const R3 = Lesen.lesen(SID, { dirs: [kaputt] });
  gleich(R3.abgeschnitten, 1, 'abgeschnittene letzte Zeile gezählt');
  gleich(R3.kaputt, 1, 'kaputte Zeile mitten in der Datei gezählt');
  gleich(R3.unbekannt.zukunft, 1, 'unbekannter Typ gezählt, nicht abgebrochen');
  const K3 = kennzahlen(R3);
  gleich(K3.f6.daten.abgeschnitten, 1, 'Kennzahl f6.daten.abgeschnitten = 1');
  const B3 = bericht(K3, { svg: 'x.svg' });
  ok(/abgeschnittene Zeile/.test(B3) && /unbekannten Typs/.test(B3), 'Bericht nennt abgeschnittene und unbekannte Zeilen in den Auffälligkeiten');
  const fremd = Lesen.ausText(TEXT.replace(/"v":1/g, '"v":2'));
  ok(fremd.schemaOk === false && fremd.warnungen.some((w) => /Schema-Version/.test(w)), 'fremde Schema-Version wird gemeldet');
  let wirft = false;
  try { Lesen.lesen('gibt-es-nicht', { dirs: [dir] }); } catch (e) { wirft = /nicht gefunden/.test(e.message); }
  ok(wirft, 'unbekannte Session: klare Fehlermeldung');
  ok(Lesen.letzteKennung([dir]) === SID, 'letzteKennung findet die Session (Teile zählen als eine)');
}

section('Bericht und Bild des Mini-Protokolls');
{
  const txt = bericht(K, { svg: 'mini-1.svg' });
  const zl = txt.split('\n').length - 1;
  ok(zl <= LIMIT, 'Bericht hat ' + zl + ' Zeilen (<= ' + LIMIT + ')');
  ok(txt.indexOf('## Auffälligkeiten') > 0 && txt.indexOf('## Auffälligkeiten') < txt.indexOf('## F1'), 'Auffälligkeiten stehen vor den Fragenblöcken');
  ok(/keine Basis angegeben/.test(txt), 'ohne Basis steht: keine Basis angegeben');
  ok(!/Leerlauf \(>= 30 s/.test(txt), 'Leerlauf von p1 (32 s, 80 %) liegt unter der Auffälligkeits-Schwelle von 60 s: nicht in den Auffälligkeiten');
  {
    const k2 = JSON.parse(JSON.stringify(K));
    k2.f4.leerlauf.p1 = { dauer: 100, episoden: 3, anteil: 50 };
    k2.f4.leerlauf.p2 = { dauer: 100, episoden: 3, anteil: 10 };   // viel Zeit, aber unter 20 %
    const ll = bericht(k2, { svg: 'x.svg' }).split('\n').find((l) => /Leerlauf \(>= 30 s/.test(l));
    ok(!!ll && /p1 100 s \(50 %\)/.test(ll) && !/p2/.test(ll), 'Leerlauf über Schwelle (>= 60 s und >= 20 %): p1 steht in den Auffälligkeiten, p2 (10 %) nicht');
  }
  ok(/Verluste: 1 gefallen, 1 Notrückholung/.test(txt), 'Verluste stehen in den Auffälligkeiten');
  ok(/!\[Gefechtsprofil\]\(mini-1\.svg\)/.test(txt), 'Bild ist relativ eingebunden');
  ok(/p2: dabei 14 s .*Nachzügler ab .*Abgang bei 28 s/.test(txt), 'Rollenzeile von p2 nennt Nachzügler und Abgang');
  ok(!/\b(Ada|Bo|Cem)\b/.test(txt), 'nur Slots im Bericht');
  const svg = profil(P, K);
  ok(/^<svg /.test(svg) && /<\/svg>\s*$/.test(svg) && /<polyline/.test(svg) && /stroke-dasharray/.test(svg) && /<polygon/.test(svg), 'SVG: Linien, Szenengrenze, Verlustmarken');
  ok(/Hülle/.test(svg) && /Hitze/.test(svg) && /Bodenschild/.test(svg) && /Spielzeit/.test(svg), 'SVG: Legende und Achsenbeschriftung (Raum und Boden)');
}

// ===================== 3. Echte Bot-Läufe =====================
section('3. Echte Bot-Läufe mit Telemetrie');
const BOT_NAME = /\b(Ada|Bo|Cem)\b/;
const BOT_ID = /sim-\d+/;
const laeufe = [
  ['graben', ['graben', '--players', '3', '--seed', '1', '--max', '200']],
  ['wellen', ['wellen', '--karte', 'kesh', '--players', '3', '--seeds', '1', '--max', '120']],
  ['kampagne', ['3', '--seed', '7']],
];
const ergebnisse = {};
// AUSWERTUNG_SCHNELL=1 (Mutationsprobe): ohne die Bot-Läufe, nur Mini-Protokoll, Basis und Ziele
const SCHNELL = !!process.env.AUSWERTUNG_SCHNELL;
for (const [name, args] of SCHNELL ? [] : laeufe) {
  const dir = path.join(TMP, 'lauf-' + name);
  const r = spawnSync(process.execPath, [path.join('tools', 'sim-headless.js'), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 480000, env: Object.assign({}, process.env, { TELEMETRIE: 'an', TELEMETRIE_DIR: dir }) });
  ok(r.status === 0, name + ': Bot-Lauf endet mit Exit 0' + (r.status === 0 ? '' : ' (' + r.status + ': ' + ((r.stdout || '') + (r.stderr || '')).slice(-200).replace(/\s+/g, ' ') + ')'));
  const datei = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')) : [];
  ok(datei.length >= 1, name + ': Protokoll da');
  if (!datei.length) continue;
  const aus = path.join(TMP, 'bericht-' + name);
  const A = auswerten(path.join(dir, datei[0]), { aus });
  ergebnisse[name] = A;
  const zl = A.text.split('\n').length - 1;
  ok(zl <= LIMIT && zl > 10, name + ': Bericht hat ' + zl + ' Zeilen (<= ' + LIMIT + ')');
  ok(fs.existsSync(A.md) && fs.existsSync(A.svg) && /!\[Gefechtsprofil\]\(.*\.svg\)/.test(fs.readFileSync(A.md, 'utf8')), name + ': .md und .svg geschrieben, Bild eingebunden');
  const kopfPos = A.text.indexOf('## Auffälligkeiten');
  ok(kopfPos > 0 && kopfPos < A.text.indexOf('## F1'), name + ': Auffälligkeiten stehen oben');
  const hat = (b) => A.text.indexOf('## ' + b) > 0;
  const k = A.kz;
  ok(hat('F1') && hat('F2') && hat('F2b') && hat('F3') && hat('F4') && hat('F5') && hat('F6') && hat('Gefechtsprofil'), name + ': ein Block je Frage');
  ok(!/NaN|undefined|Infinity|\[object/.test(A.text + A.svgText + JSON.stringify(k)), name + ': kein NaN/undefined/Infinity in Bericht, Bild und Kennzahlen');
  const quoten = Object.entries(flach(k)).filter(([key]) => /^f2\.quote/.test(key));
  ok(quoten.length > 0 && quoten.every(([, v]) => v >= 0 && v <= 100), name + ': ' + quoten.length + ' Quoten, alle zwischen 0 und 100 %');
  ok(!BOT_NAME.test(A.text + A.svgText) && !BOT_ID.test(A.text + A.svgText + JSON.stringify(k)), name + ': keine Bot-Namen, keine clientId in Bericht, Bild, Kennzahlen');
  ok(/<polyline/.test(A.svgText) && (A.svgText.match(/<polyline/g) || []).length >= 2, name + ': SVG enthält Linien');
  // SVG parst als XML (einfacher Wohlgeformtheits-Check ohne Abhängigkeit: Tags gleichmäßig geöffnet/geschlossen)
  const tags = A.svgText.replace(/<\?[^>]*\?>/g, '').match(/<\/?[A-Za-z][^>]*>/g) || [];
  let tiefe = 0, wohl = true;
  for (const t of tags) { if (/^<\//.test(t)) tiefe--; else if (!/\/>$/.test(t)) tiefe++; if (tiefe < 0) wohl = false; }
  ok(wohl && tiefe === 0, name + ': SVG ist wohlgeformt (Tags ausgeglichen)');
  ok(Object.keys(flach(k)).every((key) => infoZu(key)), name + ': jede Kennzahl hat einen Info-Eintrag');
  ok(k.f6.fehler.schreiben === 0 && k.f6.daten.abgeschnitten === 0 && k.f6.daten.unbekannte_typen === 0, name + ': keine Schreibfehler, nichts abgeschnitten, keine unbekannten Typen');
}
if (!SCHNELL) {
  const k = ergebnisse.graben && ergebnisse.graben.kz;
  ok(k && k.f4.rolle && Object.keys(k.f4.rolle).length === 3, 'Graben zu dritt: Rollenzeiten für drei Slots (Abnahme 10)');
  ok(k && Object.keys(k.f4.rolle).every((s) => Object.values(k.f4.rolle[s]).reduce((a, b) => a + b, 0) > 0), 'Graben zu dritt: jeder Slot hat eigene Zeiten');
  ok(k && Object.keys(k.f2b).length > 0, 'Graben: Kennzahlen zu Deckung/Gegnern vorhanden');
  const w = ergebnisse.wellen && ergebnisse.wellen.kz, c = ergebnisse.kampagne && ergebnisse.kampagne.kz;
  ok(w && Object.keys(w.f2.quote || {}).length > 0, 'Wellen: Trefferquote je Waffe');
  ok(c && Object.keys(c.f4.rolle || {}).length === 3 && c.f4.rolle.p1 && Object.keys(c.f4.rolle.p1).some((r) => r !== 'boden' && r !== 'ohne'), 'Kampagne zu dritt: Rollen je Slot (Stationen)');
  ok(c && c.f2.quote.raum && Object.keys(c.f2.quote.raum).length > 0, 'Kampagne: Raum-Quote je Waffe');
}

// ===================== 4. Basis und Ziele =====================
section('4. Basis-Abweichung und Ziele');
{
  const miniDatei = path.join(TMP, SID + '.jsonl');
  fs.writeFileSync(miniDatei, TEXT);
  const A = { kz: K, protokoll: { dateien: [miniDatei] } };
  {
    const kz = A.kz;
    const basis = JSON.parse(JSON.stringify(kz));
    // gleiche Basis -> keine Abweichung
    const t0 = bericht(kz, { basis, svg: 'x.svg' });
    ok(/0 wesentlich anders/.test(t0), 'Basis = Lauf: 0 Abweichungen');
    ok(!/keine Basis angegeben/.test(t0), 'mit Basis steht nicht "keine Basis angegeben"');
    // eine Quote verdoppeln (Basis halbieren): genau diese Kennzahl in den Auffälligkeiten
    const schluessel = 'f2.quote.boden.blaster';
    const alt = basis.f2.quote.boden.blaster;
    basis.f2.quote.boden.blaster = alt / 2;
    const t1 = bericht(kz, { basis, svg: 'x.svg' });
    const aufl = t1.split('## Auffälligkeiten')[1].split('\n## ')[0];
    ok(aufl.includes(schluessel), 'Basis mit halber Quote: ' + schluessel + ' steht in den Auffälligkeiten');
    ok(/1 wesentlich anders/.test(aufl), 'genau eine Kennzahl weicht ab');
    ok((aufl.match(/f\d+b?\.[a-z_]+\./g) || []).length === 1, 'nur diese Kennzahl wird genannt');
    // kleine Abweichung (unter der Schwelle) und kleine Menge fallen nicht auf
    const basis2 = JSON.parse(JSON.stringify(kz));
    basis2.f2.quote.boden.blaster = alt * 0.9;
    ok(/0 wesentlich anders/.test(bericht(kz, { basis: basis2, svg: 'x.svg' })), '10 % Abweichung fällt nicht auf');
    const basis3 = JSON.parse(JSON.stringify(kz));
    basis3.f3.gefallen.n = (kz.f3.gefallen.n || 0) + 1;   // 1 Ereignis Unterschied: unter der Mindestmenge
    ok(/0 wesentlich anders/.test(bericht(kz, { basis: basis3, svg: 'x.svg' })), 'ein Ereignis mehr/weniger fällt nicht auf (Mindestmenge)');
    // große Werte mit kleiner relativer Abweichung (9 %): Mindestmenge erfüllt, relative Schwelle nicht
    const gk = JSON.parse(JSON.stringify(kz)), gb = JSON.parse(JSON.stringify(kz));
    gk.f1.dauer.session = 1000; gb.f1.dauer.session = 1100;
    ok(/0 wesentlich anders/.test(bericht(gk, { basis: gb, svg: 'x.svg' })), 'große Zahl, nur 9 % Abweichung: fällt nicht auf (relative Schwelle)');
    gb.f1.dauer.session = 2000;
    ok(/1 wesentlich anders/.test(bericht(gk, { basis: gb, svg: 'x.svg' })), 'große Zahl, 50 % Abweichung: fällt auf');
    // Ziele
    const t2 = bericht(kz, { svg: 'x.svg', ziele: { version: 1, ziele: {} } });
    ok(!/\[(rot|grün|grau)\]/.test(t2) && !/## Ziele/.test(t2), 'leere Zieldatei: keine Ampel');
    const t3 = bericht(kz, { svg: 'x.svg', ziele: { version: 1, ziele: { 'f2.quote.boden.blaster': { min: 99 }, 'f2.kills.boden.gesamt': { min: 1 } } } });
    ok(/\[rot\] f2\.quote\.boden\.blaster/.test(t3) && /\[grün\] f2\.kills\.boden\.gesamt/.test(t3), 'Ziele: rote und grüne Ampel an der Kennzahl');
    ok(/Ziel verfehlt: f2\.quote\.boden\.blaster/.test(t3.split('## F1')[0]), 'verfehltes Ziel steht in den Auffälligkeiten');
    const t4 = bericht(kz, { svg: 'x.svg', ziele: { version: 1, ziele: { 'f2.quote.boden.gibtsnicht': { max: 1 } } } });
    ok(/\[grau\] f2\.quote\.boden\.gibtsnicht/.test(t4), 'Ziel ohne Wert im Lauf: grau');
    const ziel = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'telemetrie', 'ziele.json'), 'utf8'));
    ok(ziel.version === 1 && Object.keys(ziel.ziele).length === 0, 'eingecheckte ziele.json ist leer (Kai legt die Werte fest)');
    // Zeilendeckel: ein künstlich riesiges Kennzahlenobjekt wird auf LIMIT gekürzt
    const gross = JSON.parse(JSON.stringify(kz));
    for (let i = 0; i < 40; i++) { gross.f2.quote.boden['waffe' + i] = 10; gross.f2.schuesse.boden['waffe' + i] = 10; gross.f2.treffer_je_schuss.boden['waffe' + i] = 1; }
    gross.f4.dabei = { p1: 1, p2: 2, p3: 3, p4: 4 }; gross.f4.rolle = { p1: { a: 1 }, p2: { a: 1 }, p3: { a: 1 }, p4: { a: 1 } };
    const ziele = {}; for (let i = 0; i < 80; i++) ziele['f2.quote.boden.waffe' + (i % 40)] = { min: 1 + i };
    const t5 = bericht(gross, { svg: 'x.svg', ziele: { version: 1, ziele } });
    ok(t5.split('\n').length - 1 <= LIMIT, 'Zeilendeckel: Bericht mit riesiger Zielliste hat höchstens ' + LIMIT + ' Zeilen (' + (t5.split('\n').length - 1) + ')');
    // CLI: --json schreibt das Kennzahlen-Objekt, --basis liest es wieder
    const jf = path.join(TMP, 'basis.json');
    auswerten(A.protokoll.dateien[0], { aus: path.join(TMP, 'b2'), json: jf });
    const geladen = JSON.parse(fs.readFileSync(jf, 'utf8'));
    ok(JSON.stringify(flach(geladen)) === JSON.stringify(flach(kz)), 'Kennzahlen-JSON (Basis-Datei) enthält genau das Kennzahlen-Objekt');
    const cli = spawnSync(process.execPath, [path.join('tools', 'auswerten.js'), A.protokoll.dateien[0], '--basis', jf, '--aus', path.join(TMP, 'b3')], { cwd: ROOT, encoding: 'utf8' });
    ok(cli.status === 0 && /Bericht:/.test(cli.stdout) && !/NaN/.test(cli.stdout), 'CLI mit --basis: Exit 0');
    const cli2 = spawnSync(process.execPath, [path.join('tools', 'auswerten.js'), 'gibt-es-nicht-xyz', '--aus', path.join(TMP, 'b4')], { cwd: ROOT, encoding: 'utf8' });
    ok(cli2.status === 2, 'CLI: unbekannte Session -> Exit 2');
  }
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n + ' Prüfungen' : 'OK: ' + n + ' Prüfungen'));
process.exit(fails ? 1 : 0);
