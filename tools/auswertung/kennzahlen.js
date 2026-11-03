'use strict';
// TEL-01 D1: Kennzahlen aus einem Protokoll. EINE reine Funktion kennzahlen(protokoll) -> Objekt (kein I/O, kein Zufall, keine Uhr).
// DAS OBJEKT IST DER VERTRAG fuer D2 (Vergleich, SQLite) und C (Basis-Datei = genau dieses Objekt als JSON):
//   { version, kopf: {Auszug des Sessionkopfs}, f1, f2, f2b, f3, f4, f5, f6, listen }
//   f1..f6/f2b  verschachtelt, jedes Blatt eine Zahl (Kennzahl); flach(kz) liefert { 'f2.quote.boden.lanze': 50, ... } fuer eine Differenztabelle.
//   listen      Nicht-Zahlen (Szenen, Verluste mit Zeitpunkt, Rollen je Slot) fuer Bericht und Bild; gehoert NICHT in einen Vergleich.
//   Schlüssel stabil und sprechend, Teile aus Daten (Slot, Waffe, Rolle, Ort) sind auf [A-Za-z0-9_-] bereinigt. Was in einem Lauf nicht vorkommt, fehlt
//   (keine Nullzeilen). KENNZAHL_INFO beschreibt jede Kennzahl (Einheit, Frage, Richtung, Schwelle fuer "auffaellig"); infoZu(schluessel) loest ein Muster auf.
// Eingabe: { zeilen: [Protokollzeilen], abgeschnitten, kaputt, unbekannt } wie lesen.js es liefert (nur zeilen ist Pflicht).
// Alle Zeiten in s Spielzeit, Anteile in Prozent (2 Nachkommastellen).
//
// Festlegungen (Begruendung im Bericht an den Entwicklungsleiter):
//  - "in Deckung" = deckung.cv > 0 (Rohzustand, siehe Schema); geduckt (p.crouch) und verdeckt getrennt ausgewiesen, nie vermischt.
//  - Quote = Schüsse mit >= 1 Treffer / Schüsse (Schema); Treffer je Schuss = Treffer / Schüsse; je ort, waffe und Seite (eigen: p1..p4, lerche, crew | gegner).
//  - Leerlauf = zusammenhaengende Strecke ohne JEDE Eingabe (ein_bew + ein_akt = 0) eines verbundenen Slots von mindestens LEERLAUF_S = 30 s.
//  - Rollenzeit = Fenster (2 s) mal Station des Slots am Fensterende; nur solange verbunden (Abgang zaehlt nicht); Nachzügler erst ab dem Fenster, in dem er in slots steht.
//
// VERTRAG SPIELERZAHL UND NACHZUEGLER (das Protokoll setzt spieler_bei.nachzuegler schon, sobald die Phase nicht mehr lobby ist, also auch beim Start bei Tick 0; siehe Schema):
//  - Die Spielerzahl der Session ist f1.spieler.start = verbundene Spieler im ERSTEN Zeitreihenfenster (Kopf spielerzahl nur, wenn es kein Fenster gibt).
//    kopf.spielerzahl im Kopfauszug ist diese bereinigte Zahl; der Rohwert aus dem Sessionkopf steht daneben als kopf.spielerzahl_kopf.
//  - Die Spielerzahl je Szene (listen.szenen[].spielerzahl) kommt aus dem ersten Zeitreihenfenster der Szene (t > Start der Szene und <= ihr Ende), sonst aus szene_start.
//  - NACHZUEGLER ist ein spieler_bei mit nachzuegler true, das NACH dem ersten Zeitreihenfenster liegt (t > t des ersten Fensters). Bei einer Szene sinngemaess:
//    nach dem ersten Fenster der Szene und vor ihrem Ende (listen.szenen[].nachzuegler = Zahl). Ohne Zeitreihe zaehlt t > 0. f1.spieler.nachzuegler zaehlt genau diese.
//  - Hitzegrenze (listen.reihen.hitzegrenze) = shared/config.js power.heatLimit, nicht abgeschrieben.
// listen.reihen (EINMAL hier gerechnet, mit Raumfilter; profil.js zeichnet nur daraus): { raum: { t, integ, schild, hitze }, boden: { t, mittel, min }, hitzegrenze }
//    raum   nur Fenster, in denen jemand im Schiff ist (ort enthaelt raum) und r_integ, r_schild, r_hitze Zahlen sind; integ = Summe r_integ, schild = Summe r_schild, hitze = groesste r_hitze
//    boden  Fenster mit Bodenschild: Mittel und Minimum der Segmente der Spieler draussen
// Die Lerche hat keinen Huellenwert: f3.integritaet.min (Summe r_integ in % des Maximums der Raumfenster) ist der Ersatz und steht nur, wenn es Raumfenster gibt.

const Config = require('../../shared/config.js');

const KENNZAHL_VERSION = 1;
const LEERLAUF_S = 30;       // Leerlauf: mindestens so lange ohne jede Eingabe
const PEEK_S = 3;            // Peek-and-Shoot: Deckung kurz verlassen und wieder betreten in weniger als so vielen s
const HITZEGRENZE = Config.power.heatLimit;   // Hitzepunkte, bei denen ein System durchschlaegt (shared/config.js)
const SLOT = /^p[1-4]$/;

const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const sk = (v) => String(v == null ? 'unbekannt' : v).replace(/[^A-Za-z0-9_-]/g, '_');
const summe = (a) => a.reduce((x, y) => x + y, 0);
// Schleifen statt Math.max(...a): ein Spread mit zehntausenden Eintraegen sprengt den Stack (lange Sessions)
function maxV(a) { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; }
function minV(a) { let m = Infinity; for (const v of a) if (v < m) m = v; return m; }
const pct = (a, b) => (b > 0 ? r2((100 * a) / b) : null);
function median(a) {
  const s = a.filter(num).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Blatt setzen; null/NaN fehlen einfach (keine Nullzeilen)
function put(o, pfad, wert, stellen) {
  if (!num(wert)) return;
  const t = pfad.split('.');
  let c = o;
  for (let i = 0; i < t.length - 1; i++) c = c[t[i]] || (c[t[i]] = {});
  const f = Math.pow(10, stellen || 2);
  c[t[t.length - 1]] = Math.round(wert * f) / f;
}
const zaehle = (o, k) => { o[k] = (o[k] || 0) + 1; };

// ---------- KENNZAHL_INFO: Muster ('*' = ein Schlüsselteil) -> Beschreibung ----------
// richtung: 'besser' (höher ist besser) | 'schlechter' (höher ist schlechter) | 'neutral'. rel/min: Schwelle fuer "wesentlich anders als die Basis":
// relative Abweichung >= rel UND absolute Abweichung >= min (in der Einheit; 1 -> 2 Kills fällt so nicht auf). C kalibriert das spaeter mit der Streuung.
const EINHEIT_MIN = { s: 10, '%': 10, n: 3, ms: 5, kacheln: 2, marken: 20, 'stück': 2, 'je schuss': 0.5, punkte: 5, 'mb/h': 5, 'zeilen/min': 20 };
const KENNZAHL_INFO = {
  'f1.dauer.session': { einheit: 's', frage: '1', richtung: 'neutral', text: 'Dauer der Session (Spielzeit)' },
  'f1.dauer.*.summe': { einheit: 's', frage: '1', richtung: 'neutral', text: 'Summe der Szenendauer je Modus (dauer_gesamt)' },
  'f1.dauer.*.mittel': { einheit: 's', frage: '1', richtung: 'neutral', text: 'mittlere Dauer einer Szene je Modus' },
  'f1.dauer.*.n': { einheit: 'n', frage: '1', richtung: 'neutral', text: 'Zahl der Szenen je Modus' },
  'f1.ausgang.*': { einheit: 'n', frage: '1', richtung: 'neutral', text: 'Szenen je Ausgang' },
  'f1.wellen.geschafft': { einheit: 'n', frage: '1', richtung: 'besser', text: 'geschaffte Wellen' },
  'f1.wellen.dauer_mittel': { einheit: 's', frage: '1', richtung: 'neutral', text: 'mittlere Dauer einer geschafften Welle' },
  'f1.spieler.start': { einheit: 'n', frage: '1', richtung: 'neutral', text: 'Spielerzahl der Session = verbundene Spieler im ersten Zeitreihenfenster (Kopf: spielerzahl, wenn es keins gibt); gleich kopf.spielerzahl im Kopfauszug' },
  'f1.spieler.max': { einheit: 'n', frage: '1', richtung: 'neutral', text: 'größte Zahl verbundener Spieler' },
  'f1.spieler.beitritte': { einheit: 'n', frage: '1', richtung: 'neutral', text: 'spieler_bei (neu, uebernahme, wieder)' },
  'f1.spieler.nachzuegler': { einheit: 'n', frage: '1', richtung: 'neutral', text: 'Nachzügler: spieler_bei mit nachzuegler true, das NACH dem ersten Zeitreihenfenster liegt (Beitritte beim Start zählen nicht)' },
  'f1.spieler.abgaenge': { einheit: 'n', frage: '1', richtung: 'neutral', text: 'spieler_weg' },
  'f2.gefecht.*': { einheit: 's', frage: '2', richtung: 'neutral', text: 'Gefechtsdauer: Zeitreihenfenster mit Gegnern (Raum: r_gegner > 0, Boden: b_gg > 0)' },
  'f2.schaden.*.*.*': { einheit: 'punkte', frage: '2', richtung: 'neutral', text: 'Schaden je ort, aus (Spieler/Lerche -> Gegner) oder ein (Gegner/Objekt -> Spieler/Lerche); Eigenbeschuss und Treffer Gegner -> Gegner zählen nicht. roh = vor Schild; schild und wirkt sind getrennte Posten, nie addieren (Definition je Ort darunter)' },
  'f2.schaden.raum.aus.*': { einheit: 'punkte', frage: '2', richtung: 'neutral', text: 'Raum, Lerche -> Gegner: roh = Schaden vor Schild; schild = Schildverlust des Gegners (Summe der Segmente); wirkt = schaden - schild = nur der Rest über den Schild hinaus (Systemtreffer, Sofort-Tod); das Schema-Feld schaden enthält den Schildverlust schon, deshalb wird er hier abgezogen. Posten nicht addieren' },
  'f2.schaden.raum.ein.*': { einheit: 'punkte', frage: '2', richtung: 'neutral', text: 'Raum, Gegner/Objekt -> Lerche: roh = Schaden vor Schild; schild = vom Schild aufgenommen; wirkt = Rest nach Schild (Schema-Feld schaden, damage.resolveHit); schild und wirkt zusammen sind nicht roh. Posten nicht addieren' },
  'f2.schaden.boden.*.*': { einheit: 'punkte', frage: '2', richtung: 'neutral', text: 'Boden: roh = Schaden vor Schild; schild = verlorene Schildsegmente (Segmente, keine Schadenspunkte, nicht mit roh verrechenbar); wirkt = Schaden, der den Körper erreicht (Ergebnis wunde, gefallen, bewusstlos), sonst 0. Posten nicht addieren' },
  'f2.treffer_n.*.*': { einheit: 'n', frage: '2', richtung: 'neutral', text: 'Zahl der Treffer-Zeilen je ort (aus/ein)' },
  'f2.schuesse.*.*': { einheit: 'n', frage: '2', richtung: 'neutral', text: 'Schüsse je ort und Waffe (eigene Seite: Spieler, Lerche)' },
  'f2.quote.*.*': { einheit: '%', frage: '2', richtung: 'besser', text: 'Trefferquote nach Schema = Schüsse mit >= 1 Treffer / Schüsse (eigene Seite, je ort und Waffe); abgeprallte und ausgewichene Treffer zählen mit' },
  'f2.quote_wirkt.*.*': { einheit: '%', frage: '2', richtung: 'besser', text: 'Wirkungsquote = Schüsse mit >= 1 Treffer, der weder abgeprallt noch ausgewichen ist / Schüsse (eigene Seite). Schüsse ohne pid (Lanze Raum): das Ergebnis steht im Schuss, abgeprallt ist dort nicht erkennbar, sie zählen bei Treffer als wirkend' },
  'f2.treffer_je_schuss.*.*': { einheit: 'je schuss', frage: '2', richtung: 'neutral', text: 'Treffer / Schüsse (Flächenwaffen > 1)' },
  'f2.schuesse_gegner.*.*': { einheit: 'n', frage: '2', richtung: 'neutral', text: 'Schüsse der Gegner je ort und Waffe' },
  'f2.quote_gegner.*.*': { einheit: '%', frage: '2', richtung: 'schlechter', text: 'Trefferquote der Gegner (Schüsse mit >= 1 Treffer / Schüsse)' },
  'f2.quote_wirkt_gegner.*.*': { einheit: '%', frage: '2', richtung: 'schlechter', text: 'Wirkungsquote der Gegner (Treffer weder abgeprallt noch ausgewichen)' },
  'f2.treffer_je_schuss_gegner.*.*': { einheit: 'je schuss', frage: '2', richtung: 'neutral', text: 'Treffer je Gegnerschuss' },
  'f2.kills.*.*': { einheit: 'n', frage: '2', richtung: 'neutral', text: 'Abschüsse je ort und Gegnerrolle (gesamt = alle)' },
  'f2.kills_von.*': { einheit: 'n', frage: '2', richtung: 'neutral', text: 'Abschüsse je Schuetze (Slot, lerche, gegner, sonstige)' },
  'f2.zeit_bis_kill.*.*': { einheit: 's', frage: '2', richtung: 'neutral', text: 'Median der Lebenszeit bis zum Abschuss (kill.lebte) je ort und Gegnerrolle' },
  'f2.ueberhitzt.*.*': { einheit: 'n', frage: '2', richtung: 'neutral', text: 'Überhitzungen je ort und Seite (spieler, gegner, lerche, andere)' },
  'f2.gegner_neu.*': { einheit: 'n', frage: '2', richtung: 'neutral', text: 'erschienene Gegner je ort' },
  'f2.gegner_weg.*': { einheit: 'n', frage: '2', richtung: 'neutral', text: 'Gegner, die ohne Abschuss verschwanden, je ort' },
  'f2b.deckung.*.cv_s': { einheit: 's', frage: '2b', richtung: 'neutral', text: 'Zeit in Deckung je Slot (deckung.cv > 0). cv = Deckung gegen den gefährlichsten SICHTBAREN Gegner: wechselt der Gegner oder verliert er die Sicht, ändert sich cv, ohne dass der Spieler sich bewegt' },
  'f2b.deckung.*.cv_anteil': { einheit: '%', frage: '2b', richtung: 'neutral', text: 'Zeit in Deckung / Zeit am Boden des Slots' },
  'f2b.deckung.*.geduckt_s': { einheit: 's', frage: '2b', richtung: 'neutral', text: 'Zeit geduckt je Slot (getrennt von Deckung)' },
  'f2b.deckung.*.verdeckt_s': { einheit: 's', frage: '2b', richtung: 'neutral', text: 'Zeit verdeckt je Slot (kein Gegner hat Sicht, Spieler an Deckung; getrennt von Deckung)' },
  'f2b.verlassen.n': { einheit: 'n', frage: '2b', richtung: 'neutral', text: 'Zahl der Deckung-verlassen-Episoden (cv > 0 -> 0)' },
  'f2b.verlassen.bewegt_n': { einheit: 'n', frage: '2b', richtung: 'neutral', text: 'davon Episoden, in denen der Spieler sich wirklich löste: Kachelwechsel gegenüber der Zeile davor ODER nicht verdeckt zu Beginn der Episode; der Rest ist nur ein Wechsel des gefährlichsten sichtbaren Gegners (cv bezieht sich auf ihn)' },
  'f2b.verlassen.mit_treffer': { einheit: 'n', frage: '2b', richtung: 'neutral', text: 'davon mit erlittenem Treffer vor der Rueckkehr in Deckung' },
  'f2b.verlassen.bis_treffer_median': { einheit: 's', frage: '2b', richtung: 'besser', text: 'Median: Deckung verlassen bis zum ersten erlittenen Treffer' },
  'f2b.peek.episoden': { einheit: 'n', frage: '2b', richtung: 'neutral', text: 'Deckung verlassen und in weniger als 3 s wieder betreten' },
  'f2b.peek.mit_schuss': { einheit: 'n', frage: '2b', richtung: 'neutral', text: 'davon mit eigenem Schuss dazwischen (Peek-and-Shoot)' },
  'f2b.treffer_auf_spieler.n': { einheit: 'n', frage: '2b', richtung: 'neutral', text: 'Treffer auf Spieler am Boden' },
  'f2b.treffer_auf_spieler.in_deckung_anteil': { einheit: '%', frage: '2b', richtung: 'neutral', text: 'Anteil der Treffer auf Spieler, die in Deckung (ziel_deckung) trafen' },
  'f2b.treffer_von_spieler.n': { einheit: 'n', frage: '2b', richtung: 'neutral', text: 'Treffer von Spielern am Boden' },
  'f2b.treffer_von_spieler.aus_deckung_anteil': { einheit: '%', frage: '2b', richtung: 'neutral', text: 'Anteil der eigenen Treffer, die aus Deckung (von_deckung) fielen' },
  'f2b.schuesse_spieler.aus_deckung_anteil': { einheit: '%', frage: '2b', richtung: 'neutral', text: 'Anteil der Spielerschüsse am Boden aus Deckung' },
  'f2b.schuesse_gegner.aus_deckung_anteil': { einheit: '%', frage: '2b', richtung: 'neutral', text: 'Anteil der Gegnerschüsse am Boden aus Deckung (geduckt oder Stellung)' },
  'f2b.gegner_abstand.nn_mittel': { einheit: 'kacheln', frage: '2b', richtung: 'neutral', text: 'mittlerer Abstand der Gegner zum nächsten Nachbarn (Zeitreihe, Mittel der Fenster)' },
  'f2b.gegner_abstand.min': { einheit: 'kacheln', frage: '2b', richtung: 'neutral', text: 'kleinster Abstand zweier Gegner' },
  'f2b.gegner_geduckt_anteil': { einheit: '%', frage: '2b', richtung: 'neutral', text: 'Anteil der Gegner (ueber alle Fenster), die geduckt waren' },
  'f3.gefallen.*': { einheit: 'n', frage: '3', richtung: 'schlechter', text: 'Spieler zu Boden (verwundet); n = alle, sonst je Slot' },
  'f3.bodenschild_leer.n': { einheit: 'n', frage: '3', richtung: 'schlechter', text: 'Bodenschild eines Spielers auf 0' },
  'f3.notrueckholung.*': { einheit: 'n', frage: '3', richtung: 'schlechter', text: 'Notrückholungen am Boden je Art (n = alle)' },
  'f3.notfall.n': { einheit: 'n', frage: '3', richtung: 'schlechter', text: 'Notfallprotokoll der Lerche', min: 1 },
  'f3.zone_aus.*': { einheit: 'n', frage: '3', richtung: 'schlechter', text: 'Zonensystem fällt aus oder wird beschädigt (n = alle, kaputt = Zustand broken)' },
  'f3.schiff_zerstoert.n': { einheit: 'n', frage: '3', richtung: 'schlechter', text: 'Schiff zerstört', min: 1 },
  'f3.neustarts': { einheit: 'n', frage: '3', richtung: 'schlechter', text: 'Neustarts nach Niederlage (Grabenangriff)' },
  'f3.erster_verlust_s': { einheit: 's', frage: '3', richtung: 'besser', text: 'Zeitpunkt des ersten Verlusts (Spielzeit)' },
  'f3.integritaet.min': { einheit: '%', frage: '3', richtung: 'besser', text: 'Systemintegrität: kleinste Summe r_integ in % des Maximums der Raumfenster (die Lerche hat keinen Hüllenwert, das ist der Ersatz); nur gesetzt, wenn es Raumfenster gibt' },
  'f4.dabei.*': { einheit: 's', frage: '4', richtung: 'neutral', text: 'Zeit, die der Slot verbunden war (Fenster der Zeitreihe)' },
  'f4.rolle.*.*': { einheit: 's', frage: '4', richtung: 'neutral', text: 'Rollenzeit je Slot: Station (captain, helm ...) im Raum, boden = draussen, ohne = im Schiff an keiner Konsole; nur verbunden' },
  'f4.wechsel.*': { einheit: 'n', frage: '4', richtung: 'neutral', text: 'Wechsel der aktiven Station je Slot (konsole, grund tab)' },
  'f4.leerlauf.*.dauer': { einheit: 's', frage: '4', richtung: 'schlechter', text: 'Summe der Leerlauf-Strecken (mindestens 30 s ohne jede Eingabe). Bei quelle bot nicht aussagekräftig: Bots erzeugen keine Eingaben, es gibt dort keine Leerlauf-Auffälligkeit' },
  'f4.leerlauf.*.episoden': { einheit: 'n', frage: '4', richtung: 'schlechter', text: 'Zahl der Leerlauf-Strecken' },
  'f4.leerlauf.*.anteil': { einheit: '%', frage: '4', richtung: 'schlechter', text: 'Leerlauf / verbundene Zeit des Slots' },
  'f4.reparatur.n': { einheit: 'n', frage: '4', richtung: 'neutral', text: 'Reparaturspiele' },
  'f4.reparatur.erfolg_anteil': { einheit: '%', frage: '4', richtung: 'besser', text: 'Anteil erfolgreicher Reparaturspiele' },
  'f4.reparatur.dauer_mittel': { einheit: 's', frage: '4', richtung: 'neutral', text: 'mittlere Dauer eines Reparaturspiels' },
  'f4.reparatur.notflicken': { einheit: 'n', frage: '4', richtung: 'neutral', text: 'Notflicken (flick mit Stufe + fragil)' },
  'f5.buchung.marks.*': { einheit: 'marken', frage: '5', richtung: 'neutral', text: 'Summe der Wirtschaftsbuchungen (art buchung, ohne Stand setzen) in Marken je Grund' },
  'f5.buchung.*.*': { einheit: 'stück', frage: '5', richtung: 'neutral', text: 'Summe der Buchungen (art buchung) eines Verbrauchsguts in Stück je Grund' },
  'f5.konto.marks.*': { einheit: 'marken', frage: '5', richtung: 'neutral', text: 'Marken: anfang = Stand nach der letzten stand-Zeile vor der ersten Buchung (sonst Stand minus Betrag der ersten Buchung), netto = Summe der Buchungen (ohne stand), gesetzt = jede Änderung des Stands, die keine Buchung erklärt (stand-Zeilen nach der ersten Buchung, kaputter Betrag, nicht protokollierter Sprung; fehlt, wenn 0), ende = letzter Stand; es gilt immer anfang + netto + gesetzt = ende' },
  'f5.konto.*.*': { einheit: 'stück', frage: '5', richtung: 'neutral', text: 'Verbrauchsgut in Stück: anfang, netto, gesetzt, ende wie bei den Marken (anfang + netto + gesetzt = ende)' },
  'f5.stand.marks.*': { einheit: 'marken', frage: '5', richtung: 'neutral', text: 'Stand gesetzt (art stand: Anfang, Laden, Test, Debug): zuletzt gesetzter Wert je Grund in Marken; keine Wirtschaftsbuchung' },
  'f5.stand.*.*': { einheit: 'stück', frage: '5', richtung: 'neutral', text: 'Stand eines Verbrauchsguts gesetzt (art stand): zuletzt gesetzter Wert je Grund in Stück' },
  'f5.ruf.*': { einheit: 'punkte', frage: '5', richtung: 'neutral', text: 'Summe der Rufänderungen je Fraktion' },
  'f5.energie.*_anteil': { einheit: '%', frage: '5', richtung: 'neutral', text: 'mittlerer Anteil des Systems an der Energieverteilung (r_energie, nur Fenster mit jemandem im Schiff)' },
  'f5.energie.*_n': { einheit: 'n', frage: '5', richtung: 'neutral', text: 'Änderungen der Energieverteilung je Grund (technik = Konsole, automatik = Reaktor)' },
  'f6.tick.n': { einheit: 'n', frage: '6', richtung: 'neutral', text: 'Ticks in der Zeitreihe' },
  'f6.tick.med': { einheit: 'ms', frage: '6', richtung: 'schlechter', text: 'Median der Fenster-Medianwerte der Tickzeit (game.step)', min: 0.05 },
  'f6.tick.max': { einheit: 'ms', frage: '6', richtung: 'schlechter', text: 'längster Tick' },
  'f6.tick.ueber*': { einheit: 'n', frage: '6', richtung: 'schlechter', text: 'Ticks ueber 5, 16 bzw. 33 ms', min: 1 },
  'f6.snap.med': { einheit: 'ms', frage: '6', richtung: 'schlechter', text: 'Median Snapshot-Bau + Broadcast (nur im Server)' },
  'f6.snap.max': { einheit: 'ms', frage: '6', richtung: 'schlechter', text: 'längster Snapshot' },
  'f6.kappung.*': { einheit: 'n', frage: '6', richtung: 'schlechter', text: 'Kappung der Tickschleife (n Aufrufe, ticks verworfen, nachholt)', min: 1 },
  'f6.spielleiter.n': { einheit: 'n', frage: '6', richtung: 'neutral', text: 'Wartezeiten auf den Spielleiter' },
  'f6.spielleiter.dauer_median': { einheit: 's', frage: '6', richtung: 'schlechter', text: 'Median der Wartezeit auf den Spielleiter' },
  'f6.spielleiter.dauer_max': { einheit: 's', frage: '6', richtung: 'schlechter', text: 'längste Wartezeit auf den Spielleiter' },
  'f6.spielleiter.timeout': { einheit: 'n', frage: '6', richtung: 'schlechter', text: 'Spielleiter-Timeouts', min: 1 },
  'f6.spielleiter.fehler': { einheit: 'n', frage: '6', richtung: 'schlechter', text: 'Spielleiter-Fehler (ohne Timeout)', min: 1 },
  'f6.fehler.*': { einheit: 'n', frage: '6', richtung: 'schlechter', text: 'Schreibfehler, verworfene Zeilen, Fehler der Zeitreihe', min: 1 },
  'f6.daten.ohne_ende': { einheit: 'n', frage: '6', richtung: 'schlechter', text: '1 = kein session_ende im Protokoll (Session nicht sauber beendet), sonst 0', min: 1 },
  'f6.daten.*': { einheit: 'n', frage: '6', richtung: 'schlechter', text: 'abgeschnittene/kaputte Zeilen, unbekannte Typen', min: 1 },
  'f6.protokoll.zeilen': { einheit: 'n', frage: '6', richtung: 'neutral', text: 'Zeilen gesamt (session_ende.zeilen)' },
  'f6.protokoll.zeilen_je_min': { einheit: 'zeilen/min', frage: '6', richtung: 'neutral', text: 'Zeilen je Minute Spielzeit' },
  'f6.protokoll.mb_je_h': { einheit: 'mb/h', frage: '6', richtung: 'neutral', text: 'Protokollgröße in MB je Stunde Spielzeit (1 MB = 1048576 Byte)' },
};
for (const k of Object.keys(KENNZAHL_INFO)) {
  const i = KENNZAHL_INFO[k];
  if (i.rel == null) i.rel = 0.25;
  if (i.min == null) i.min = EINHEIT_MIN[i.einheit] != null ? EINHEIT_MIN[i.einheit] : 1;
}
const MUSTER = Object.keys(KENNZAHL_INFO).map((m) => ({ m, teile: m.split('.') }));
const infoMerk = new Map();
// Pattern fuer einen Schlüssel: Teil == Teil oder Teil == '*' oder 'xyz*' (Praefix) bzw. '*xyz' (Suffix); das mit den meisten festen Teilen gewinnt
function infoZu(schluessel) {
  if (infoMerk.has(schluessel)) return infoMerk.get(schluessel);
  const t = String(schluessel).split('.');
  let best = null, bestPunkte = -1;
  for (const m of MUSTER) {
    if (m.teile.length !== t.length) continue;
    let punkte = 0, ok = true;
    for (let i = 0; i < t.length && ok; i++) {
      const p = m.teile[i];
      if (p === t[i]) punkte += 2;
      else if (p === '*') punkte += 0;
      else if (p.endsWith('*') && t[i].startsWith(p.slice(0, -1))) punkte += 1;
      else if (p.startsWith('*') && t[i].endsWith(p.slice(1))) punkte += 1;
      else ok = false;
    }
    if (ok && punkte > bestPunkte) { best = KENNZAHL_INFO[m.m]; bestPunkte = punkte; }
  }
  infoMerk.set(schluessel, best);
  return best;
}

// ---------- Index ----------
function indizieren(zeilen) {
  const d = { kopf: null, ende: null, nach: {}, zr: [], tEnde: 0 };
  for (const z of zeilen) {
    if (!z || typeof z.typ !== 'string') continue;
    if (z.typ === 'kopf' && !d.kopf) d.kopf = z;
    else if (z.typ === 'session_ende') d.ende = z;
    (d.nach[z.typ] || (d.nach[z.typ] = [])).push(z);
    if (num(z.t) && z.t > d.tEnde) d.tEnde = z.t;
  }
  d.zr = d.nach.zeitreihe || [];
  d.fenster1 = d.zr.length && num(d.zr[0].t) ? d.zr[0].t : 0;   // t des ersten Zeitreihenfensters (Vertrag Spielerzahl/Nachzuegler)
  d.dauer = d.ende && num(d.ende.dauer) ? d.ende.dauer : d.tEnde;
  return d;
}
const L = (d, typ) => d.nach[typ] || [];
const fensterVon = (r) => (num(r.fenster) && r.fenster > 0 ? r.fenster : 2);
const verbunden = (r) => (Array.isArray(r.verbunden) ? r.verbunden.filter((x) => x === true).length : null);
// Nachzuegler laut Vertrag (Kopf): spieler_bei mit nachzuegler true, das NACH dem ersten Fenster liegt (nach = t des ersten Fensters)
const istNachzuegler = (z, nach) => z.nachzuegler === true && num(z.t) && z.t > nach;

// Je Slot aus der Zeitreihe: verbundene Zeit, Rollenzeit, Zeit am Boden, Leerlauf-Strecken
function proSlot(d) {
  const m = {};
  const flush = (e) => { if (e.lauf >= LEERLAUF_S) e.leer.push(e.lauf); e.lauf = 0; };
  for (const r of d.zr) {
    const sl = Array.isArray(r.slots) ? r.slots : [];
    const f = fensterVon(r);
    const aktiv = new Set();
    sl.forEach((s, i) => {
      if (!SLOT.test(s)) return;
      const e = m[s] || (m[s] = { dabei: 0, boden: 0, rolle: {}, leer: [], lauf: 0, erstes: r.t });
      const verbunden = Array.isArray(r.verbunden) ? r.verbunden[i] === true : true;
      if (!verbunden) { e.abgang = r.t; return; }   // Abgang: zaehlt nirgends
      e.dabei += f;
      const ort = Array.isArray(r.ort) ? r.ort[i] : null;
      const rolle = ort === 'boden' ? 'boden' : (Array.isArray(r.station) && r.station[i] ? sk(r.station[i]) : 'ohne');
      e.rolle[rolle] = (e.rolle[rolle] || 0) + f;
      if (ort === 'boden') e.boden += f;
      const a = Array.isArray(r.ein_bew) ? r.ein_bew[i] : null, b = Array.isArray(r.ein_akt) ? r.ein_akt[i] : null;
      if (num(a) && num(b) && a + b === 0) { e.lauf += f; aktiv.add(s); } else flush(e);
    });
    for (const s of Object.keys(m)) if (!aktiv.has(s)) flush(m[s]);
  }
  for (const s of Object.keys(m)) flush(m[s]);
  return m;
}

// ---------- F1: Dauer ----------
function f1(d, ps) {
  const o = {};
  put(o, 'dauer.session', d.dauer);
  const proModus = {};
  for (const z of L(d, 'szene_ende')) {
    const g = proModus[sk(z.modus)] || (proModus[sk(z.modus)] = []);
    // K3: die leere Abschlussszene (Ausgang session_ende, Dauer unter 1 s) zaehlt weder in n noch im Mittel; in der Szenenliste und im Ausgang bleibt sie
    if (num(z.dauer_gesamt) && !(z.ausgang === 'session_ende' && z.dauer_gesamt < 1)) g.push(z.dauer_gesamt);
    const a = o.ausgang || (o.ausgang = {});
    zaehle(a, sk(z.ausgang));
  }
  for (const m of Object.keys(proModus)) {
    put(o, 'dauer.' + m + '.n', proModus[m].length);
    put(o, 'dauer.' + m + '.summe', summe(proModus[m]));
    if (proModus[m].length) put(o, 'dauer.' + m + '.mittel', summe(proModus[m]) / proModus[m].length);
  }
  const wg = L(d, 'welle_geschafft');
  if (wg.length) { put(o, 'wellen.geschafft', wg.length); const wd = wg.filter((z) => num(z.dauer)).map((z) => z.dauer); if (wd.length) put(o, 'wellen.dauer_mittel', summe(wd) / wd.length); }   // K4: Nenner = Wellen MIT Dauer
  // Spielerzahl: erstes Fenster der Zeitreihe (Beitritte beim Start stehen als spieler_bei mit nachzuegler, siehe Schema), sonst der Kopf
  const verb = verbunden;
  const start = d.zr.length ? verb(d.zr[0]) : null;
  put(o, 'spieler.start', num(start) ? start : (d.kopf && num(d.kopf.spielerzahl) ? d.kopf.spielerzahl : null));
  let max = d.kopf && num(d.kopf.spielerzahl) ? d.kopf.spielerzahl : 0;
  for (const r of d.zr) { const v = verb(r); if (num(v) && v > max) max = v; }
  for (const z of L(d, 'spieler_bei')) if (num(z.spielerzahl) && z.spielerzahl > max) max = z.spielerzahl;
  if (max) put(o, 'spieler.max', max);
  put(o, 'spieler.beitritte', L(d, 'spieler_bei').length);
  put(o, 'spieler.nachzuegler', L(d, 'spieler_bei').filter((z) => istNachzuegler(z, d.fenster1)).length);
  put(o, 'spieler.abgaenge', L(d, 'spieler_weg').length);
  return o;   // Neustarts: nur f3.neustarts (K5, sonst erscheint eine Abweichung doppelt)
}

// ---------- F2: Gefecht ----------
const eigen = (v) => SLOT.test(v) || v === 'lerche' || v === 'crew';
const istSpieler = (v) => SLOT.test(v) || v === 'crew';
const seite = (von) => (eigen(von) ? 'eigen' : von === 'gegner' ? 'gegner' : null);

const NICHT_WIRKEND = new Set(['abgeprallt', 'ausgewichen']);
// Schüsse und Treffer zu Schusszeilen verbinden (Schema: pid je ort; ohne pid steht das Ergebnis im schuss selbst)
function schussGruppen(d) {
  const gr = {};   // 'seite|ort|waffe' -> { schuesse, mit, treffer, unbestimmt }
  const offen = new Map();   // 'ort|pid' -> aktueller Schuss dieser Kennung (Zeilenreihenfolge = zeitliche Reihenfolge)
  for (const z of d.zeilen) {
    if (z.typ === 'schuss') {
      const s = seite(z.von);
      if (!s) continue;
      const k = s + '|' + sk(z.ort) + '|' + sk(z.waffe);
      const g = gr[k] || (gr[k] = { schuesse: 0, mit: 0, treffer: 0, wirkt: 0 });
      const rec = { g, treffer: 0, wirkt: false, bestimmt: true };
      if (z.pid == null) {
        if (z.treffer === true) rec.treffer = 1; else if (z.treffer !== false) rec.bestimmt = false;   // ohne pid und ohne Ergebnis: nicht beurteilbar
      } else offen.set(z.sitzung + '|' + s + '|' + sk(z.ort) + '|' + z.pid, rec);   // K6: je Sitzung und Seite (aneinandergehaengte Sessions, gleiche pid)
      if (!rec.bestimmt) continue;
      g.schuesse++;
      if (rec.treffer) { g.mit++; g.treffer++; if (z.pid == null) { rec.wirkt = true; g.wirkt++; } }   // ohne pid: abgeprallt nicht erkennbar, zaehlt als wirkend
    } else if (z.typ === 'treffer' && z.pid != null) {
      const sv = seite(z.von);
      const rec = sv ? offen.get(z.sitzung + '|' + sv + '|' + sk(z.ort) + '|' + z.pid) : null;
      if (!rec) continue;   // Treffer ohne bekannten Schuss (z. B. Schuss außerhalb der Aufzeichnung)
      if (!rec.treffer) rec.g.mit++;
      rec.treffer++; rec.g.treffer++;
      if (!rec.wirkt && !NICHT_WIRKEND.has(z.ergebnis)) { rec.wirkt = true; rec.g.wirkt++; }   // Wirkungsquote: abgeprallt und ausgewichen zaehlen nicht
    }
  }
  return gr;
}
function f2(d) {
  const o = {};
  // Gefechtsdauer aus der Zeitreihe
  let raum = 0, boden = 0;
  for (const r of d.zr) { const f = fensterVon(r); if (num(r.r_gegner) && r.r_gegner > 0) raum += f; if (num(r.b_gg) && r.b_gg > 0) boden += f; }
  if (raum) put(o, 'gefecht.raum', raum);
  if (boden) put(o, 'gefecht.boden', boden);
  // Schaden und Treffer
  const sch = {}, tn = {};
  for (const z of L(d, 'treffer')) {
    const ort = sk(z.ort);
    const aus = eigen(z.von) && z.ziel === 'gegner';
    const ein = eigen(z.ziel);
    const richtung = aus ? 'aus' : ein ? (eigen(z.von) ? 'eigen' : 'ein') : null;   // eigen = Eigenbeschuss (Spieler trifft Spieler): nur gezaehlt, kein Schaden aus/ein
    if (!richtung) continue;
    const k = ort + '.' + richtung;
    zaehle(tn, k);
    if (richtung === 'eigen') continue;
    const s = sch[k] || (sch[k] = { roh: 0, schild: 0, wirkt: 0 });
    if (num(z.schaden_roh)) s.roh += z.schaden_roh;
    if (num(z.schild)) s.schild += z.schild;
    // wirkt: Raum aus enthaelt schaden den Schildverlust schon (Schema SCHADEN): nur der Rest zaehlt; sonst ist schaden der Rest/Koerperschaden
    if (num(z.schaden)) s.wirkt += ort === 'raum' && richtung === 'aus' ? Math.max(0, z.schaden - (num(z.schild) ? z.schild : 0)) : z.schaden;
  }
  for (const k of Object.keys(sch)) for (const w of ['roh', 'schild', 'wirkt']) put(o, 'schaden.' + k + '.' + w, sch[k][w]);
  for (const k of Object.keys(tn)) put(o, 'treffer_n.' + k, tn[k]);
  // Quote je Waffe
  const gr = schussGruppen(d);
  for (const k of Object.keys(gr)) {
    const [s, ort, waffe] = k.split('|');
    const g = gr[k];
    if (!g.schuesse) continue;
    const suf = s === 'gegner' ? '_gegner' : '';
    put(o, 'schuesse' + suf + '.' + ort + '.' + waffe, g.schuesse);
    put(o, 'quote' + suf + '.' + ort + '.' + waffe, pct(g.mit, g.schuesse));
    put(o, 'quote_wirkt' + suf + '.' + ort + '.' + waffe, pct(g.wirkt, g.schuesse));
    put(o, 'treffer_je_schuss' + suf + '.' + ort + '.' + waffe, g.treffer / g.schuesse);
  }
  // Abschüsse
  const ks = {}, zeiten = {}, von = {};
  for (const z of L(d, 'kill')) {
    const ort = sk(z.ort), rolle = sk(z.rolle);
    zaehle(ks, ort + '.' + rolle); zaehle(ks, ort + '.gesamt');
    if (num(z.lebte)) (zeiten[ort + '.' + rolle] || (zeiten[ort + '.' + rolle] = [])).push(z.lebte);
    zaehle(von, SLOT.test(z.von) || z.von === 'lerche' || z.von === 'gegner' ? z.von : 'sonstige');
  }
  for (const k of Object.keys(ks)) put(o, 'kills.' + k, ks[k]);
  for (const k of Object.keys(von)) put(o, 'kills_von.' + k, von[k]);
  for (const k of Object.keys(zeiten)) put(o, 'zeit_bis_kill.' + k, median(zeiten[k]));
  // Überhitzung
  const ue = {};
  for (const z of L(d, 'ueberhitzt')) zaehle(ue, sk(z.ort) + '.' + (istSpieler(z.von) ? 'spieler' : z.von === 'gegner' ? 'gegner' : z.von === 'lerche' ? 'lerche' : 'andere'));
  for (const k of Object.keys(ue)) put(o, 'ueberhitzt.' + k, ue[k]);
  const gn = {}, gw = {};
  for (const z of L(d, 'gegner_neu')) zaehle(gn, sk(z.ort));
  for (const z of L(d, 'gegner_weg')) zaehle(gw, sk(z.ort));
  for (const k of Object.keys(gn)) put(o, 'gegner_neu.' + k, gn[k]);
  for (const k of Object.keys(gw)) put(o, 'gegner_weg.' + k, gw[k]);
  return o;
}

// ---------- F2b: Deckung ----------
// kleinster Eintrag von sortiertem arr mit a <= x <= b (oder null)
function ersterIn(arr, a, b) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < a) lo = m + 1; else hi = m; }
  return lo < arr.length && arr[lo] <= b ? arr[lo] : null;
}
function f2b(d, ps) {
  const o = {};
  const tEnde = d.tEnde;
  const schuesse = {}, treffer = {};   // je Slot: sortierte Zeiten (Boden)
  for (const z of L(d, 'schuss')) if (z.ort === 'boden' && SLOT.test(z.von)) (schuesse[z.von] || (schuesse[z.von] = [])).push(z.t);
  for (const z of L(d, 'treffer')) if (z.ort === 'boden' && SLOT.test(z.ziel)) if (!eigen(z.von)) (treffer[z.ziel] || (treffer[z.ziel] = [])).push(z.t);   // Eigenbeschuss ist kein erlittener Treffer
  const proSl = {};
  for (const z of L(d, 'deckung')) if (SLOT.test(z.slot)) (proSl[z.slot] || (proSl[z.slot] = [])).push(z);
  let verlassen = 0, mitTreffer = 0, peek = 0, peekSchuss = 0, bewegt = 0;
  const bisTreffer = [];
  for (const slot of Object.keys(proSl)) {
    const rows = proSl[slot];
    let cv = 0, gd = 0, vd = 0;
    let ep = null;   // offene Verlassen-Episode { t }
    const abschliessen = (bis, rueckkehr) => {
      if (!ep) return;
      verlassen++;
      if (ep.bewegt) bewegt++;
      const tr = ersterIn(treffer[slot] || [], ep.t, bis - 1e-9);
      if (tr !== null) { mitTreffer++; bisTreffer.push(tr - ep.t); }
      if (rueckkehr && bis - ep.t < PEEK_S) { peek++; if (ersterIn(schuesse[slot] || [], ep.t, bis) !== null) peekSchuss++; }
      ep = null;
    };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const bis = i + 1 < rows.length ? rows[i + 1].t : tEnde;
      const dauer = Math.max(0, bis - r.t);
      const inDeckung = num(r.cv) && r.cv > 0;
      if (inDeckung) cv += dauer;
      if (r.geduckt === true) gd += dauer;
      if (r.verdeckt === true) vd += dauer;
      // Episoden: Zeile ohne Deckung nach einer Zeile in Deckung, kein Abschluss (ende) -> Verlassen
      const vor = i > 0 && num(rows[i - 1].cv) && rows[i - 1].cv > 0;
      if (inDeckung && ep) abschliessen(r.t, true);
      else if (!inDeckung && r.ende != null) abschliessen(r.t, false);
      else if (!inDeckung && vor && !ep) ep = { t: r.t, bewegt: rows[i - 1].x !== r.x || rows[i - 1].y !== r.y || r.verdeckt !== true };   // bewegt: Kachelwechsel oder nicht verdeckt zu Beginn (cv bezieht sich auf den gefaehrlichsten sichtbaren Gegner)
    }
    abschliessen(tEnde, false);
    put(o, 'deckung.' + slot + '.cv_s', cv);
    put(o, 'deckung.' + slot + '.geduckt_s', gd);
    put(o, 'deckung.' + slot + '.verdeckt_s', vd);
    if (ps[slot] && ps[slot].boden > 0) put(o, 'deckung.' + slot + '.cv_anteil', pct(cv, ps[slot].boden));
  }
  // K9: ein Slot, der am Boden war, aber keine Deckungszeile hat, war 0 s in Deckung (nicht: unbekannt)
  for (const slot of Object.keys(ps)) {
    if (proSl[slot] || !(ps[slot].boden > 0)) continue;
    for (const k of ['cv_s', 'geduckt_s', 'verdeckt_s', 'cv_anteil']) put(o, 'deckung.' + slot + '.' + k, 0);
  }
  if (verlassen) {
    put(o, 'verlassen.n', verlassen);
    put(o, 'verlassen.bewegt_n', bewegt);
    put(o, 'verlassen.mit_treffer', mitTreffer);
    put(o, 'verlassen.bis_treffer_median', median(bisTreffer));
    put(o, 'peek.episoden', peek);
    put(o, 'peek.mit_schuss', peekSchuss);
  }
  // Treffer und Schüsse in/aus Deckung (Boden)
  const tb = L(d, 'treffer').filter((z) => z.ort === 'boden');
  const auf = tb.filter((z) => SLOT.test(z.ziel) && !eigen(z.von)), von = tb.filter((z) => SLOT.test(z.von) && !SLOT.test(z.ziel));   // ohne Eigenbeschuss (Spieler trifft Spieler)
  if (auf.length) { put(o, 'treffer_auf_spieler.n', auf.length); put(o, 'treffer_auf_spieler.in_deckung_anteil', pct(auf.filter((z) => z.ziel_deckung === true).length, auf.length)); }
  if (von.length) { put(o, 'treffer_von_spieler.n', von.length); put(o, 'treffer_von_spieler.aus_deckung_anteil', pct(von.filter((z) => z.von_deckung === true).length, von.length)); }
  const sb = L(d, 'schuss').filter((z) => z.ort === 'boden');
  const sp = sb.filter((z) => SLOT.test(z.von)), sg = sb.filter((z) => z.von === 'gegner');
  if (sp.length) put(o, 'schuesse_spieler.aus_deckung_anteil', pct(sp.filter((z) => z.von_deckung === true).length, sp.length));
  if (sg.length) put(o, 'schuesse_gegner.aus_deckung_anteil', pct(sg.filter((z) => z.von_deckung === true).length, sg.length));
  // Gegnerabstand aus der Zeitreihe
  const nn = d.zr.map((r) => r.b_gg_abst_nn).filter(num), mn = d.zr.map((r) => r.b_gg_abst_min).filter(num);
  if (nn.length) put(o, 'gegner_abstand.nn_mittel', summe(nn) / nn.length);
  if (mn.length) put(o, 'gegner_abstand.min', minV(mn));
  let gg = 0, ggd = 0;
  for (const r of d.zr) if (num(r.b_gg) && r.b_gg > 0) { gg += r.b_gg; ggd += num(r.b_gg_duck) ? r.b_gg_duck : 0; }
  if (gg) put(o, 'gegner_geduckt_anteil', pct(ggd, gg));
  return o;
}

// ---------- Reihen fuer Bild und f3.integritaet (EINMAL gerechnet, mit Raumfilter) ----------
function reihen(d) {
  const raum = { t: [], integ: [], schild: [], hitze: [] }, boden = { t: [], mittel: [], min: [] };
  for (const r of d.zr) {
    if (!num(r.t)) continue;
    const imRaum = Array.isArray(r.ort) && r.ort.includes('raum');
    if (imRaum && [r.r_integ, r.r_schild, r.r_hitze].every((a) => Array.isArray(a) && a.length > 0 && a.every(num))) {
      raum.t.push(r2(r.t)); raum.integ.push(r2(summe(r.r_integ))); raum.schild.push(r2(summe(r.r_schild))); raum.hitze.push(r2(maxV(r.r_hitze)));
    }
    if (Array.isArray(r.b_schild)) {
      const w = r.b_schild.filter(num);
      if (w.length) { boden.t.push(r2(r.t)); boden.mittel.push(r2(summe(w) / w.length)); boden.min.push(r2(minV(w))); }
    }
  }
  return { raum, boden, hitzegrenze: HITZEGRENZE };
}

// ---------- Verluste (F3, auch fuer Listen und Bild) ----------
function verlusteListe(d) {
  const v = [];
  const art = (typ, f) => { for (const z of L(d, typ)) v.push(Object.assign({ t: z.t, art: typ }, f(z))); };
  art('gefallen', (z) => ({ slot: z.slot || null, waffe: z.waffe || null }));
  art('bodenschild_leer', (z) => ({ slot: z.slot || null }));
  art('notrueckholung', (z) => ({ unterart: z.art || null, slot: z.slot || null }));
  art('notfall', (z) => ({ grund: z.grund || null }));
  art('zone_aus', (z) => ({ system: z.system || null, zone: z.zone || null, zustand: z.zustand || null }));
  art('schiff_zerstoert', () => ({}));
  art('szene_neustart', (z) => ({ versuch: z.versuch == null ? null : z.versuch }));
  v.sort((a, b) => a.t - b.t);
  return v;
}
function f3(d) {
  const o = {};
  put(o, 'gefallen.n', L(d, 'gefallen').length);
  const gs = {};
  for (const z of L(d, 'gefallen')) if (SLOT.test(z.slot)) zaehle(gs, z.slot);
  for (const k of Object.keys(gs)) put(o, 'gefallen.' + k, gs[k]);
  put(o, 'bodenschild_leer.n', L(d, 'bodenschild_leer').length);
  const nr = L(d, 'notrueckholung');
  put(o, 'notrueckholung.n', nr.length);
  const na = {};
  for (const z of nr) zaehle(na, sk(z.art));
  for (const k of Object.keys(na)) put(o, 'notrueckholung.' + k, na[k]);
  put(o, 'notfall.n', L(d, 'notfall').length);
  const za = L(d, 'zone_aus');
  put(o, 'zone_aus.n', za.length);
  put(o, 'zone_aus.kaputt', za.filter((z) => z.zustand === 'broken').length);
  put(o, 'schiff_zerstoert.n', L(d, 'schiff_zerstoert').length);
  put(o, 'neustarts', L(d, 'szene_neustart').length);
  const v = verlusteListe(d);
  if (v.length) put(o, 'erster_verlust_s', v[0].t);
  // Die Lerche hat keinen Huellenwert: Systemintegritaet (Summe r_integ der Raumfenster) in % ihres Maximums; nur mit Raumfenstern
  const sums = d.reihen.raum.integ;
  if (sums.length) { const mx = maxV(sums); if (mx > 0) put(o, 'integritaet.min', pct(minV(sums), mx)); }
  return o;
}

// ---------- F4: Menschen ----------
function f4(d, ps) {
  const o = {};
  for (const s of Object.keys(ps)) {
    const e = ps[s];
    put(o, 'dabei.' + s, e.dabei);
    for (const k of Object.keys(e.rolle)) put(o, 'rolle.' + s + '.' + k, e.rolle[k]);
    const leer = summe(e.leer);
    put(o, 'leerlauf.' + s + '.dauer', leer);
    put(o, 'leerlauf.' + s + '.episoden', e.leer.length);
    if (e.dabei > 0) put(o, 'leerlauf.' + s + '.anteil', pct(leer, e.dabei));
  }
  const tab = {};
  for (const z of L(d, 'konsole')) if (z.grund === 'tab' && SLOT.test(z.slot)) zaehle(tab, z.slot);
  for (const s of Object.keys(ps)) put(o, 'wechsel.' + s, tab[s] || 0);
  const rp = L(d, 'reparatur');
  if (rp.length) {
    put(o, 'reparatur.n', rp.length);
    put(o, 'reparatur.erfolg_anteil', pct(rp.filter((z) => z.erfolg === true).length, rp.length));
    const du = rp.map((z) => z.dauer).filter(num);
    if (du.length) put(o, 'reparatur.dauer_mittel', summe(du) / du.length);
    put(o, 'reparatur.notflicken', rp.filter((z) => z.notflicken === true).length);
  }
  return o;
}

// ---------- F5: Wirtschaft ----------
function f5(d) {
  const o = {};
  // art buchung = Wirtschaft (Summen je Grund), art stand = Stand gesetzt (keine Buchung, nie in den Summen; Schema buchung). Unbekannte Arten werden ignoriert.
  // anfang = stand der LETZTEN stand-Zeile vor der ersten echten Buchung, sonst stand - betrag der ersten Buchung (ist deren Betrag kaputt: ihr stand).
  // netto = Summe der Betraege der Buchungen. gesetzt = jede Aenderung des Stands, die KEINE Buchung erklaert: stand-Zeilen nach der ersten Buchung, ein kaputter Betrag,
  // ein nicht protokollierter Sprung (stand passt nicht zum Stand davor + betrag). Daraus folgt immer: anfang + netto + gesetzt = ende (gesetzt fehlt, wenn es 0 ist).
  const konten = {}, summen = {}, gesetzt = {};
  for (const z of L(d, 'buchung')) {
    const k = sk(z.konto);
    const c = konten[k] || (konten[k] = { netto: 0, gesetzt: 0, anfang: null, vorStand: null, ende: null, buchungen: 0 });   // ende = laufender Stand nach der letzten Zeile
    const st = num(z.stand), bt = num(z.betrag);
    if (z.art === 'stand') {
      if (!st) continue;   // kaputter Wert (null)
      if (c.buchungen === 0) c.vorStand = z.stand;
      else if (c.ende !== null) c.gesetzt += z.stand - c.ende;
      c.ende = z.stand;
      gesetzt[k + '.' + sk(z.grund)] = z.stand;
    } else if (z.art === 'buchung') {
      if (c.buchungen === 0) {
        c.anfang = c.vorStand !== null ? c.vorStand : (st && bt ? z.stand - z.betrag : (st ? z.stand : null));
        if (c.anfang !== null) c.ende = c.anfang;
      }
      c.buchungen++;
      if (bt) { c.netto += z.betrag; summen[k + '.' + sk(z.grund)] = (summen[k + '.' + sk(z.grund)] || 0) + z.betrag; }
      if (st) {
        if (c.ende !== null) c.gesetzt += z.stand - (bt ? c.ende + z.betrag : c.ende);   // 0, solange die Kette stimmt
        c.ende = z.stand;
      } else if (bt && c.ende !== null) c.ende += z.betrag;
    }
  }
  for (const k of Object.keys(summen)) put(o, 'buchung.' + k, summen[k]);
  for (const k of Object.keys(gesetzt)) put(o, 'stand.' + k, gesetzt[k]);
  for (const k of Object.keys(konten)) {
    const c = konten[k];
    put(o, 'konto.' + k + '.anfang', c.buchungen === 0 ? c.vorStand : c.anfang); put(o, 'konto.' + k + '.ende', c.ende); put(o, 'konto.' + k + '.netto', c.netto);
    if (c.gesetzt !== 0) put(o, 'konto.' + k + '.gesetzt', c.gesetzt);
  }
  const ruf = {};
  for (const z of L(d, 'ruf')) if (num(z.betrag)) ruf[sk(z.fraktion)] = (ruf[sk(z.fraktion)] || 0) + z.betrag;
  for (const k of Object.keys(ruf)) put(o, 'ruf.' + k, ruf[k]);
  // Energieverteilung: mittlere Werte in Fenstern, in denen jemand im Schiff ist
  const e = [[], [], []];
  for (const r of d.zr) {
    if (!Array.isArray(r.ort) || !r.ort.includes('raum') || !Array.isArray(r.r_energie) || r.r_energie.length !== 3 || !r.r_energie.every(num)) continue;
    r.r_energie.forEach((v, i) => e[i].push(v));
  }
  if (e[0].length) {
    const m = e.map((a) => summe(a) / a.length), g = summe(m);
    ['engines', 'shields', 'weapons'].forEach((n, i) => { if (g > 0) put(o, 'energie.' + n + '_anteil', (100 * m[i]) / g); });
  }
  const en = {};
  for (const z of L(d, 'energie')) zaehle(en, sk(z.grund));
  for (const k of Object.keys(en)) put(o, 'energie.' + k + '_n', en[k]);
  return o;
}

// ---------- F6: Technik ----------
function f6(d, p) {
  const o = {};
  const zr = d.zr;
  if (zr.length) {
    put(o, 'tick.n', summe(zr.map((r) => (num(r.tick_n) ? r.tick_n : 0))));
    put(o, 'tick.med', median(zr.filter((r) => num(r.tick_n) && r.tick_n > 0).map((r) => r.tick_med)), 3);
    const mx = zr.map((r) => r.tick_max).filter(num);
    if (mx.length) put(o, 'tick.max', maxV(mx), 3);
    for (const g of ['5', '16', '33']) put(o, 'tick.ueber' + g, summe(zr.map((r) => (num(r['tick_ueber' + g]) ? r['tick_ueber' + g] : 0))));
    const sm = zr.filter((r) => num(r.snap_n) && r.snap_n > 0);
    if (sm.length) { put(o, 'snap.med', median(sm.map((r) => r.snap_med)), 3); put(o, 'snap.max', maxV(sm.map((r) => r.snap_max).filter(num)), 3); }
    put(o, 'kappung.n', summe(zr.map((r) => (num(r.kappung_n) ? r.kappung_n : 0))));
    put(o, 'kappung.ticks', summe(zr.map((r) => (num(r.kappung_ticks) ? r.kappung_ticks : 0))));
    put(o, 'kappung.nachholt', summe(zr.map((r) => (num(r.nachhol_ticks) ? r.nachhol_ticks : 0))));
    put(o, 'fehler.zeitreihe', summe(zr.map((r) => (num(r.fehler_n) ? r.fehler_n : 0))));
  }
  const sw = L(d, 'spielleiter_warten');
  if (sw.length) {
    put(o, 'spielleiter.n', sw.length);
    put(o, 'spielleiter.dauer_median', median(sw.map((z) => z.dauer)));
    const du = sw.map((z) => z.dauer).filter(num);
    if (du.length) put(o, 'spielleiter.dauer_max', maxV(du));
    put(o, 'spielleiter.timeout', sw.filter((z) => z.ausgang === 'timeout').length);
    put(o, 'spielleiter.fehler', sw.filter((z) => z.ausgang === 'fehler').length);
  }
  if (d.ende) {
    put(o, 'fehler.schreiben', d.ende.fehler);
    put(o, 'fehler.verworfen', d.ende.verworfen);
    put(o, 'protokoll.zeilen', d.ende.zeilen);
    if (d.dauer > 0) {
      put(o, 'protokoll.zeilen_je_min', (d.ende.zeilen * 60) / d.dauer);
      if (num(d.ende.bytes)) put(o, 'protokoll.mb_je_h', (d.ende.bytes * 3600) / d.dauer / 1048576);
    }
  }
  put(o, 'daten.ohne_ende', d.ende || !d.zeilen.length ? 0 : 1);   // kein session_ende: Session nicht sauber beendet
  put(o, 'daten.abgeschnitten', p.abgeschnitten || 0);
  put(o, 'daten.kaputt', p.kaputt || 0);
  put(o, 'daten.unbekannte_typen', summe(Object.values(p.unbekannt || {})));
  return o;
}

// ---------- Listen (keine Kennzahlen) ----------
function szenenListe(d) {
  const offen = [], fertig = [];
  for (const z of d.zeilen) {
    if (z.typ === 'szene_start') offen.push({ modus: z.modus, szene: z.szene, start: z.t, ende: null, ausgang: null, dauer: null, spielerzahl: z.spielerzahl });
    else if (z.typ === 'szene_ende') {
      let i = -1;
      for (let k = offen.length - 1; k >= 0; k--) if (offen[k].modus === z.modus && offen[k].szene === z.szene) { i = k; break; }
      const s = i >= 0 ? offen.splice(i, 1)[0] : { modus: z.modus, szene: z.szene, start: null };
      Object.assign(s, { ende: z.t, ausgang: z.ausgang, dauer: num(z.dauer_gesamt) ? z.dauer_gesamt : null });
      fertig.push(s);
    }
  }
  for (const s of offen) { s.ende = d.tEnde; s.ausgang = 'offen'; fertig.push(s); }
  // Spielerzahl je Szene: erstes Zeitreihenfenster der Szene (t > Start, t <= Ende); Nachzuegler: spieler_bei mit nachzuegler nach diesem Fenster (Vertrag im Kopf)
  for (const sz of fertig) {
    sz.spielerzahl_start = sz.spielerzahl == null ? null : sz.spielerzahl;
    const von = sz.start == null ? -Infinity : sz.start, bis = sz.ende == null ? Infinity : sz.ende;
    const f = d.zr.find((r) => num(r.t) && r.t > von && r.t <= bis);
    if (f && num(verbunden(f))) sz.spielerzahl = verbunden(f);
    const nach = f ? f.t : (sz.start == null ? 0 : sz.start);
    sz.nachzuegler = L(d, 'spieler_bei').filter((z) => istNachzuegler(z, nach) && z.t <= bis).length;
  }
  return fertig.sort((a, b) => (a.start == null ? a.ende : a.start) - (b.start == null ? b.ende : b.start));
}
function rollenListe(d, ps) {
  const spieler = {};
  for (const z of L(d, 'spieler_bei')) if (SLOT.test(z.slot)) { const e = spieler[z.slot] || (spieler[z.slot] = { nachzuegler: false }); if (istNachzuegler(z, d.fenster1)) e.nachzuegler = true; }
  const out = {};
  for (const s of Object.keys(ps)) {
    const e = ps[s];
    const sp = spieler[s] || { nachzuegler: false };
    const weg = L(d, 'spieler_weg').filter((z) => z.slot === s).map((z) => z.t);
    out[s] = { dabei: e.dabei, rolle: Object.assign({}, e.rolle), erstes_fenster: e.erstes, nachzuegler: sp.nachzuegler, abgang: weg.length ? weg[weg.length - 1] : (e.abgang == null ? null : e.abgang) };
  }
  return out;
}

function kopfAuszug(d, p, f1o) {
  const k = d.kopf || {};
  const sp = f1o && f1o.spieler && num(f1o.spieler.start) ? f1o.spieler.start : (k.spielerzahl == null ? null : k.spielerzahl);
  return {
    sitzung: k.sitzung || p.kennung || null, quelle: k.quelle || null, commit: k.commit || null, plattform: k.plattform || null, node: k.node || null,
    modus: k.modus || null, szenario: k.szenario || null, seed: k.seed == null ? null : k.seed, spielerzahl: sp, spielerzahl_kopf: k.spielerzahl == null ? null : k.spielerzahl,
    regielog: k.regielog || null, weltstand: k.weltstand || null, tuning_hash: k.tuning_hash || null, schema_version: k.v == null ? null : k.v,
    grund: d.ende ? d.ende.grund || null : null, dauer: d.dauer,
  };
}

function kennzahlen(protokoll) {
  const zeilen = (protokoll && protokoll.zeilen) || [];
  const d = indizieren(zeilen);
  d.zeilen = zeilen;
  const ps = proSlot(d);
  d.reihen = reihen(d);
  const k1 = f1(d, ps);
  return {
    version: KENNZAHL_VERSION,
    kopf: kopfAuszug(d, protokoll || {}, k1),
    f1: k1, f2: f2(d), f2b: f2b(d, ps), f3: f3(d), f4: f4(d, ps), f5: f5(d), f6: f6(d, protokoll || {}),
    listen: { szenen: szenenListe(d), verluste: verlusteListe(d), rollen: rollenListe(d, ps), reihen: d.reihen, warnungen: Array.isArray(protokoll && protokoll.warnungen) ? protokoll.warnungen.slice() : [] },
  };
}

const GRUPPEN = ['f1', 'f2', 'f2b', 'f3', 'f4', 'f5', 'f6'];
// Flache Sicht fuer Differenztabellen: { 'f2.quote.boden.lanze': 50, ... } (nur die Gruppen, nicht listen/kopf)
function flach(kz) {
  const out = {};
  const geh = (o, pfad) => { for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') geh(v, pfad + '.' + k); else if (num(v)) out[pfad + '.' + k] = v; } };
  for (const g of GRUPPEN) if (kz && kz[g]) geh(kz[g], g);
  return out;
}

module.exports = { kennzahlen, flach, KENNZAHL_INFO, infoZu, KENNZAHL_VERSION, LEERLAUF_S, PEEK_S, HITZEGRENZE };
