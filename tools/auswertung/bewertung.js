'use strict';
// TEL-01 D1 (Nacharbeit): Bewertung der Kennzahlen. REINES Modul (kein I/O, keine Uhr): bericht.js stellt nur noch dar, D2 (Vergleich) nutzt dieselbe Bewertung.
//   bewerten(kz, { basis, ziele }) -> {
//     daten:    [{ k, n, name }]            Datenqualitaet: abgeschnittene/kaputte/unbekannte Zeilen, Session nicht sauber beendet, fremde Schema-Version, Warnungen des Lesers
//     basis:    null | { verglichen, liste, fehlt }   Abweichungen von der Basis, wichtigste zuerst: gegen einen Einzellauf (abweichungen) oder, mit opt.basisGruppe,
//                                           gegen die Statistik einer Basis-Gruppe (abweichungGegenBasisGruppe; dann zusaetzlich gruppe, laeufe, zuwenig, nurImLauf, amLimit).
//                                           Mit opt.basisKeine { grund } steht nur { keine: grund } da (keine passende Gruppe).
//     ziele:    [{ k, w, z, status, info }]  Ampel je Zielkennzahl (leer, wenn keine Ziele); rote davon stehen auch in den Auffaelligkeiten
//     technik:  [{ k, n, name, max }]       Technikspitzen: Ticks > 33 ms, Kappung, Protokollfehler, Spielleiter-Timeouts
//     verluste: [{ k, n, name, basis? }], erster   Verluste (Tod, Notrueckholung, Notfallprotokoll, Zonenausfall, ...). Ohne Basis alle. Gegen einen Einzellauf nur die ohne Gegenstueck in der Basis.
//                                           Gegen eine Basis-Gruppe (B1): immer, mit basis = Median der Gruppe ("(Basis-Median x)"); NUR WENN alle Verlustwerte <= Basis-Median sind (Normalzustand eines
//                                           Bot-Grabens), entfallen sie, ausser Tod/gefallen, Notfallprotokoll und Schiff zerstoert: die stehen bei > 0 immer da
//     leerlauf: [{ slot, dauer, anteil }]   Leerlauf je Slot ueber der Schwelle; bei quelle bot immer leer (Bots erzeugen keine Eingaben), die Kennzahl bleibt
//   }
// Schwellen: je Kennzahl in KENNZAHL_INFO (rel, min: relative Abweichung UND absolute Mindestmenge in der Einheit der Kennzahl), dazu die benannten Konstanten unten.
// Kennzahlen mit determ: false in KENNZAHL_INFO (Technik: Tickzeit, Snapshot, Kappung, Protokollgroesse) werden nie gegen eine Basis verglichen, nur als Spitzen (technik) gemeldet.
// TEL-01 C: Schwelle gegen eine Basis-Gruppe siehe abweichungGegenBasisGruppe (Abstand zur Spanne [Min, Max] der Basis-Seeds groesser als max(rel x Median, k x IQR), UND Mindestmenge).
//
// WAS DER EINZELLAUF GEGEN DIE BASIS ERKENNT UND WAS NICHT (S6; Rueckwaertsprobe, 6 frische Seeds 101-106 je Gruppe, gezielt verschobene Kennzahlen, Tabelle im Basis-Bericht und in der README):
//   Ein Lauf gegen die Basis aus 12 Seeds ist schwach: die Spanne [Min, Max] fasst schon die meisten Seeds ein, und jede Streuung weitet den Normalbereich. Gemeldet wird deshalb nur, was
//   eindeutig ausserhalb liegt. Erkannt werden meist grosse Spruenge (Quote halbiert, Zeit bis Kill x2 im Raumkampf und in der Kampagne), nie Kleinigkeiten. Meist NICHT erkannt: Dauer +-30 %
//   (nur im Graben, wo alle Seeds am selben Limit enden; sonst liegt sie in der Spanne), Schaden x2 (meist nur Raum und Kampagne), Kills halbiert, Gegnerquote ausser im Graben.
//   Fehlalarme sind dagegen selten (siehe Basis-Bericht). Fuer Balance-Aenderungen deshalb NICHT einen Lauf gegen die Basis nehmen, sondern Gruppe gegen Gruppe vergleichen
//   (`npm run vergleich`, Paket D2; Kerben nach McGill, die mit der Zahl der Laeufe schaerfer werden).

const { flach, infoZu } = require('./kennzahlen.js');
const { SCHEMA_VERSION } = require('../../server/telemetrie/protokoll.js');

const LEERLAUF_AUFFAELLIG_S = 60;      // Leerlauf je Slot: mindestens so viele s in Strecken von >= 30 s ohne Eingabe ...
const LEERLAUF_AUFFAELLIG_ANTEIL = 20; // ... UND mindestens so viel Prozent der verbundenen Zeit (beides, sonst fallen kurze Raststrecken auf)
const TICK_SPITZE_MS = 33;             // Tick ueber dieser Dauer ist eine Technikspitze (zeitreihe.tick_ueber33)
const SCORE_MAX = 10;                  // Deckel des relativen Gewichts einer Abweichung (Basis ungleich 0)
const SCHLECHTER_FAKTOR = 1.5;         // Abweichungen in die schlechtere Richtung zaehlen so viel staerker
const MIN_BASIS_N = 4;                 // Basis-Gruppe: Kennzahlen mit weniger Basis-Laeufen (n in der Statistik) werden nicht verglichen (zu wenig Basis)
const VERLUST_IMMER = new Set(['f3.gefallen.n', 'f3.notfall.n', 'f3.schiff_zerstoert.n']);   // B1: Tod/gefallen, Notfallprotokoll, Schiff zerstoert stehen bei > 0 immer da
const STREUUNG_K = 2;                  // Basis-Gruppe: Normalbereich-Breite = max(rel x |Median|, STREUUNG_K x IQR) UEBER die Basis-Spanne hinaus; Wahl und Fehlalarme: Bericht TEL-01 C
// S4: Hinweis, wenn alle Basis-Laeufe einer Gruppe am Zeitlimit enden (basis.js amLimit): die Spannen sagen dann nichts ueber Balance
const amLimitText = (modus) => 'alle Läufe am Zeitlimit, Bot schafft ' + (modus === 'arena_graben' ? 'den Graben' : 'das Szenario') + ' nicht; Spannen sind kein Balance-Maß';
const BASIS_ART_TEXT = 'Basis = Bot-Läufe (Bots spielen anders als Menschen)';
const PLATTFORM_TEXT = 'Basis von anderer Plattform, Raumkampf nicht bit-gleich, nur grob vergleichbar';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const get = (o, pfad) => { let c = o; for (const k of pfad.split('.')) { if (c == null || typeof c !== 'object') return undefined; c = c[k]; } return c; };
const keys = (o) => (o && typeof o === 'object' ? Object.keys(o).sort() : []);

// Basis: Kennzahlen-Objekt (mit f1..f6) oder schon die flache Map { schluessel: zahl }
function basisFlach(basis) {
  if (!basis || typeof basis !== 'object') return null;
  return basis.f1 || basis.f2 || basis.f6 ? flach(basis) : basis;
}

// Kennzahlen, die wesentlich von der Basis abweichen: relativ >= info.rel UND absolut >= info.min. Gewicht (score): Basis ungleich 0 -> relative Abweichung (Deckel SCORE_MAX);
// Basis = 0 -> |Wert| / info.min (Mindestmenge als Massstab, sonst haetten alle Neuzugaenge dasselbe Gewicht); in die schlechtere Richtung mal SCHLECHTER_FAKTOR.
function abweichungen(kz, basis) {
  const a = flach(kz), b = basisFlach(basis) || {};
  const liste = [];
  let verglichen = 0;
  for (const k of Object.keys(a)) {
    if (!(k in b) || !num(b[k])) continue;
    const info = infoZu(k);
    if (!info || info.determ === false) continue;   // Technik ist nicht deterministisch: keine Basis-Abweichung, nur Spitzen (technik)
    verglichen++;
    const diff = Math.abs(a[k] - b[k]);
    const rel = b[k] === 0 ? (a[k] === 0 ? 0 : Infinity) : diff / Math.abs(b[k]);
    if (diff < info.min || rel < info.rel) continue;
    const schlechter = info.richtung === 'neutral' ? false : (info.richtung === 'schlechter' ? a[k] > b[k] : a[k] < b[k]);
    const gewicht = b[k] === 0 ? Math.abs(a[k]) / (info.min > 0 ? info.min : 1) : Math.min(rel, SCORE_MAX);
    liste.push({ k, a: a[k], b: b[k], rel, info, schlechter, score: gewicht * (schlechter ? SCHLECHTER_FAKTOR : 1) });
  }
  liste.sort((x, y) => y.score - x.score || (x.k < y.k ? -1 : 1));
  return { liste, verglichen, fehlt: Object.keys(b).filter((k) => !(k in a) && infoZu(k) && infoZu(k).determ !== false).length };
}

// TEL-01 C: Abweichung gegen die Statistik einer Basis-Gruppe (tools/auswertung/basis.js). gruppe.kz[schluessel] = [n, min, q1, median, q3, max] ueber die Basis-Seeds.
// AUFFAELLIG ist eine Kennzahl nur, wenn BEIDE Bedingungen gelten:
//   1. ihr Abstand zur Spanne [min, max] der Basis-Seeds ist groesser als der Normalbereich max(rel x |Median|, STREUUNG_K x IQR) (rel aus KENNZAHL_INFO, Standard 25 %).
//      Innerhalb der Spanne ist nie etwas auffaellig (so ein Wert war in der Basis schon normal); knapp ausserhalb auch nicht (bei 12 Seeds liegt jeder 7. frische Lauf ausserhalb).
//   2. der Abstand zum Median ist mindestens info.min (die Einheit-Mindestmenge: 1 -> 2 Kills faellt nicht auf).
//   Das ist strenger als "ausserhalb [Min, Max] UND ausserhalb Median +- Breite" (Vorschlag im Briefing): dort meldeten frische Seeds 3,2 Kennzahlen je Lauf, hier 0,7 (Bericht TEL-01 C).
// determ: false (Technik) wird nie verglichen. Fehlt der Wert im Lauf, gilt er bei Zaehlern und Summen (info.summe) als 0, sonst als "keine Daten" (zaehlt in fehlt).
// Hat die Basis zu einer Kennzahl weniger als MIN_BASIS_N Laeufe (n < 4), gibt es keinen Vergleich (zaehlt in zuwenig). Kennzahlen, die nur im Lauf vorkommen (neue Waffe, neue Gegnerrolle), stehen in nurImLauf.
// Gewicht (score) = Abstand zum Median / max(Breite, info.min), gedeckelt, in die schlechtere Richtung mal SCHLECHTER_FAKTOR. Rueckgabe wie abweichungen, jeder Eintrag mit min, max, n der Basis.
function abweichungGegenBasisGruppe(kz, gruppe) {
  const a = flach(kz);
  const st = (gruppe && gruppe.kz) || {};
  const liste = [];
  let verglichen = 0, fehlt = 0, zuwenig = 0;
  for (const k of Object.keys(st).sort()) {
    const s = st[k];
    const info = infoZu(k);
    if (!Array.isArray(s) || s.length < 6 || !info || info.determ === false) continue;
    if (s[0] < MIN_BASIS_N) { zuwenig++; continue; }
    let w = a[k];
    if (!num(w)) { if (info.summe) w = 0; else { fehlt++; continue; } }
    verglichen++;
    const [, mn, q1, med, q3, mx] = s;
    const breite = Math.max(info.rel * Math.abs(med), STREUUNG_K * (q3 - q1));
    const aussen = w > mx ? w - mx : (w < mn ? mn - w : 0);             // Abstand zur Spanne der Basis-Seeds (0 = innerhalb)
    if (aussen <= breite) continue;                                     // 1. nicht weiter ausserhalb als der Normalbereich
    const diff = Math.abs(w - med);
    if (diff < info.min) continue;                                      // 2. Mindestmenge
    const schlechter = info.richtung === 'neutral' ? false : (info.richtung === 'schlechter' ? w > med : w < med);
    const gewicht = Math.min(SCORE_MAX, diff / Math.max(breite, info.min > 0 ? info.min : 1));
    liste.push({ k, a: w, b: med, rel: med === 0 ? Infinity : diff / Math.abs(med), info, schlechter, score: gewicht * (schlechter ? SCHLECHTER_FAKTOR : 1), min: mn, max: mx, n: s[0] });
  }
  liste.sort((x, y) => y.score - x.score || (x.k < y.k ? -1 : 1));
  const nurImLauf = Object.keys(a).filter((k) => !(k in st) && infoZu(k) && infoZu(k).determ !== false).sort();   // K3: gibt es in keinem Basis-Lauf
  return { liste, verglichen, fehlt, zuwenig, nurImLauf, amLimit: gruppe && gruppe.am_limit ? amLimitText(gruppe.modus) : null, gruppe: gruppe && gruppe.id, laeufe: gruppe && gruppe.laeufe };
}

// Datenzeile "Basis von anderer Plattform": gilt fuer Einzellauf- und Gruppen-Basis (basisKopf.plattform). Raumkampf ist zwischen win32-x64 und arm64/linux nicht bit-gleich.
function plattformZeile(kz, basisKopf) {
  const p = kz && kz.kopf && kz.kopf.plattform, bp = basisKopf && basisKopf.plattform;
  if (!p || !bp || p === bp) return [];
  return [{ k: 'plattform', n: 1, name: PLATTFORM_TEXT + ' (Basis ' + bp + ', Lauf ' + p + ')' }];
}

// Ampel einer Zielkennzahl: grau = kein Wert im Lauf, rot = ausserhalb von min/max, sonst gruen
function ampel(z, w) {
  if (!num(w)) return 'grau';
  if ((num(z.min) && w < z.min) || (num(z.max) && w > z.max)) return 'rot';
  return 'gruen';
}
function zielBewertung(kz, ziele) {
  const a = flach(kz);
  return Object.keys(ziele || {}).map((k) => ({ k, w: a[k], z: ziele[k] || {}, status: ampel(ziele[k] || {}, a[k]), info: infoZu(k) }));
}

function datenQualitaet(kz) {
  const f6 = kz.f6 || {};
  const d = [];
  const add = (k, name) => { const n = get(f6, k.slice(3)); if (n > 0) d.push({ k, n, name }); };
  add('f6.daten.ohne_ende', 'Session nicht sauber beendet (kein session_ende)');
  add('f6.daten.abgeschnitten', 'abgeschnittene Zeile(n)');
  add('f6.daten.kaputt', 'kaputte Zeile(n)');
  add('f6.daten.unbekannte_typen', 'Zeile(n) unbekannten Typs');
  const v = kz.kopf && kz.kopf.schema_version;
  if (v != null && v !== SCHEMA_VERSION) d.push({ k: 'schema_version', n: v, name: 'Schema-Version ' + v + ' statt ' + SCHEMA_VERSION });
  // Warnungen des Lesers, soweit nicht schon oben erfasst (kein session_ende, Schema-Version)
  for (const w of (kz.listen && kz.listen.warnungen) || []) if (!/session_ende|^Schema-Version/.test(w)) d.push({ k: 'warnung', n: 1, name: String(w) });
  return d;
}

const VERLUSTE = [
  ['f3.gefallen.n', 'gefallen'], ['f3.notrueckholung.n', 'Notrückholung(en)'], ['f3.notfall.n', 'Notfallprotokoll(e)'],
  ['f3.zone_aus.n', 'Zonenausfall/-ausfälle'], ['f3.schiff_zerstoert.n', 'Schiff zerstört'], ['f3.neustarts', 'Neustart(s)'],
];
function verluste(kz, basisF, gruppe) {
  const out = [];
  for (const [k, name] of VERLUSTE) {
    const n = get(kz, k);
    if (!(n > 0)) continue;
    if (!gruppe && basisF && k in basisF) continue;   // gegen einen Einzellauf: nur als Abweichung (siehe oben)
    out.push({ k, n, name });
  }
  if (!gruppe) return out;
  // B1: gegen eine Basis-Gruppe stehen Verluste immer da, mit dem Median der Basis; sie entfallen nur, wenn ALLE <= Basis-Median sind (ausser den immer sichtbaren)
  const st = gruppe.kz || {};
  for (const x of out) x.basis = st[x.k] && num(st[x.k][3]) ? st[x.k][3] : 0;
  return out.some((x) => x.n > x.basis) ? out : out.filter((x) => VERLUST_IMMER.has(x.k));
}

function technik(kz) {
  const f6 = kz.f6 || {};
  const t = [];
  if (get(f6, 'tick.ueber33') > 0) t.push({ k: 'f6.tick.ueber33', n: get(f6, 'tick.ueber33'), name: 'Ticks > ' + TICK_SPITZE_MS + ' ms', max: get(f6, 'tick.max') });
  if (get(f6, 'kappung.n') > 0) t.push({ k: 'f6.kappung.n', n: get(f6, 'kappung.n'), name: 'Kappung', ticks: get(f6, 'kappung.ticks') });
  const sf = (get(f6, 'fehler.schreiben') || 0) + (get(f6, 'fehler.verworfen') || 0) + (get(f6, 'fehler.zeitreihe') || 0);
  if (sf > 0) t.push({ k: 'f6.fehler', n: sf, name: 'Protokollfehler/verworfene Zeilen' });
  if (get(f6, 'spielleiter.timeout') > 0) t.push({ k: 'f6.spielleiter.timeout', n: get(f6, 'spielleiter.timeout'), name: 'Spielleiter-Timeout(s)' });
  return t;
}

function leerlauf(kz) {
  if (kz.kopf && kz.kopf.quelle === 'bot') return [];   // Bots erzeugen keine Eingaben: Leerlauf ist dort kein Befund (die Kennzahl bleibt)
  const ll = [];
  const f4 = kz.f4 || {};
  for (const s of keys(f4.leerlauf)) {
    const e = f4.leerlauf[s];
    if (e.dauer >= LEERLAUF_AUFFAELLIG_S && e.anteil >= LEERLAUF_AUFFAELLIG_ANTEIL) ll.push({ slot: s, dauer: e.dauer, anteil: e.anteil });
  }
  return ll;
}

// S2: Basis-Gruppen sind Bot-Laeufe. Ein Lauf von Menschen (quelle nicht bot) darf damit verglichen werden, aber Bots spielen anders: Datenzeile
function basisArtZeile(kz) {
  const q = kz && kz.kopf && kz.kopf.quelle;
  return q && q !== 'bot' ? [{ k: 'basis_art', n: 1, name: BASIS_ART_TEXT }] : [];
}

// K8: Kennzahl-Version von Lauf und Basis (nur wenn die Basis ein Kennzahlen-Objekt ist, nicht eine flache Map)
function versionsZeile(kz, basis) {
  if (!basis || typeof basis !== 'object' || !num(basis.version) || !num(kz.version) || basis.version === kz.version) return [];
  return [{ k: 'kennzahl_version', n: basis.version, name: 'Basis hat Kennzahl-Version ' + basis.version + ', Lauf ' + kz.version + ' – Vergleich nur über gemeinsame Schlüssel' }];
}

function bewerten(kz, opt) {
  opt = opt || {};
  const bg = opt.basisGruppe || null;   // { id, laeufe, seeds, kz, kopf } aus der Basis-Datei (basis.js gruppeWaehlen)
  const basisF = bg ? (bg.kz || {}) : (opt.basis ? basisFlach(opt.basis) : null);
  const ziele = zielBewertung(kz, opt.ziele);
  const basisKopf = bg ? bg.kopf : (opt.basis && opt.basis.kopf);
  return {
    daten: datenQualitaet(kz).concat(bg ? versionsZeile(kz, { version: basisKopf && basisKopf.kennzahl_version }) : versionsZeile(kz, opt.basis), plattformZeile(kz, basisKopf), bg ? basisArtZeile(kz) : []),
    basis: bg ? abweichungGegenBasisGruppe(kz, bg) : (opt.basisKeine ? { keine: String(opt.basisKeine.grund || opt.basisKeine), liste: [], verglichen: 0, fehlt: 0 } : (opt.basis ? abweichungen(kz, opt.basis) : null)),
    ziele,
    technik: technik(kz),
    verluste: verluste(kz, basisF, bg),
    erster: get(kz, 'f3.erster_verlust_s'),
    leerlauf: leerlauf(kz),
  };
}

module.exports = {
  bewerten, abweichungen, abweichungGegenBasisGruppe, plattformZeile, basisArtZeile, ampel, zielBewertung, basisFlach,
  STREUUNG_K, MIN_BASIS_N, amLimitText, VERLUST_IMMER, BASIS_ART_TEXT, PLATTFORM_TEXT, LEERLAUF_AUFFAELLIG_S, LEERLAUF_AUFFAELLIG_ANTEIL, TICK_SPITZE_MS, SCORE_MAX, SCHLECHTER_FAKTOR,
};
