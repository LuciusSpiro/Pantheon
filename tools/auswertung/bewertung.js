'use strict';
// TEL-01 D1 (Nacharbeit): Bewertung der Kennzahlen. REINES Modul (kein I/O, keine Uhr): bericht.js stellt nur noch dar, D2 (Vergleich) nutzt dieselbe Bewertung.
//   bewerten(kz, { basis, ziele }) -> {
//     daten:    [{ k, n, name }]            Datenqualitaet: abgeschnittene/kaputte/unbekannte Zeilen, Session nicht sauber beendet, fremde Schema-Version, Warnungen des Lesers
//     basis:    null | { verglichen, liste, fehlt }   Abweichungen von der Basis, wichtigste zuerst (siehe abweichungen)
//     ziele:    [{ k, w, z, status, info }]  Ampel je Zielkennzahl (leer, wenn keine Ziele); rote davon stehen auch in den Auffaelligkeiten
//     technik:  [{ k, n, name, max }]       Technikspitzen: Ticks > 33 ms, Kappung, Protokollfehler, Spielleiter-Timeouts
//     verluste: [{ k, n, name }], erster    Verluste (Tod, Notrueckholung, Notfallprotokoll, Zonenausfall, ...). Ohne Basis alle; MIT Basis nur die ohne Gegenstueck in der
//                                           Basis (sonst erscheinen sie nur als Abweichung, damit der Normalzustand eines Bot-Grabens nicht ganz oben steht)
//     leerlauf: [{ slot, dauer, anteil }]   Leerlauf je Slot ueber der Schwelle; bei quelle bot immer leer (Bots erzeugen keine Eingaben), die Kennzahl bleibt
//   }
// Schwellen: je Kennzahl in KENNZAHL_INFO (rel, min: relative Abweichung UND absolute Mindestmenge in der Einheit der Kennzahl), dazu die benannten Konstanten unten.
// C kalibriert die Schwellen spaeter mit der Streuung; die Werte sind Vorschlaege.

const { flach, infoZu } = require('./kennzahlen.js');
const { SCHEMA_VERSION } = require('../../server/telemetrie/protokoll.js');

const LEERLAUF_AUFFAELLIG_S = 60;      // Leerlauf je Slot: mindestens so viele s in Strecken von >= 30 s ohne Eingabe ...
const LEERLAUF_AUFFAELLIG_ANTEIL = 20; // ... UND mindestens so viel Prozent der verbundenen Zeit (beides, sonst fallen kurze Raststrecken auf)
const TICK_SPITZE_MS = 33;             // Tick ueber dieser Dauer ist eine Technikspitze (zeitreihe.tick_ueber33)
const SCORE_MAX = 10;                  // Deckel des relativen Gewichts einer Abweichung (Basis ungleich 0)
const SCHLECHTER_FAKTOR = 1.5;         // Abweichungen in die schlechtere Richtung zaehlen so viel staerker

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
    if (!info) continue;
    verglichen++;
    const diff = Math.abs(a[k] - b[k]);
    const rel = b[k] === 0 ? (a[k] === 0 ? 0 : Infinity) : diff / Math.abs(b[k]);
    if (diff < info.min || rel < info.rel) continue;
    const schlechter = info.richtung === 'neutral' ? false : (info.richtung === 'schlechter' ? a[k] > b[k] : a[k] < b[k]);
    const gewicht = b[k] === 0 ? Math.abs(a[k]) / (info.min > 0 ? info.min : 1) : Math.min(rel, SCORE_MAX);
    liste.push({ k, a: a[k], b: b[k], rel, info, schlechter, score: gewicht * (schlechter ? SCHLECHTER_FAKTOR : 1) });
  }
  liste.sort((x, y) => y.score - x.score || (x.k < y.k ? -1 : 1));
  return { liste, verglichen, fehlt: Object.keys(b).filter((k) => !(k in a) && infoZu(k)).length };
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
function verluste(kz, basisF) {
  const out = [];
  for (const [k, name] of VERLUSTE) {
    const n = get(kz, k);
    if (!(n > 0)) continue;
    if (basisF && k in basisF) continue;   // mit Basis: nur als Abweichung (siehe oben)
    out.push({ k, n, name });
  }
  return out;
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

// K8: Kennzahl-Version von Lauf und Basis (nur wenn die Basis ein Kennzahlen-Objekt ist, nicht eine flache Map)
function versionsZeile(kz, basis) {
  if (!basis || typeof basis !== 'object' || !num(basis.version) || !num(kz.version) || basis.version === kz.version) return [];
  return [{ k: 'kennzahl_version', n: basis.version, name: 'Basis hat Kennzahl-Version ' + basis.version + ', Lauf ' + kz.version + ' – Vergleich nur über gemeinsame Schlüssel' }];
}

function bewerten(kz, opt) {
  opt = opt || {};
  const basisF = opt.basis ? basisFlach(opt.basis) : null;
  const ziele = zielBewertung(kz, opt.ziele);
  return {
    daten: datenQualitaet(kz).concat(versionsZeile(kz, opt.basis)),
    basis: opt.basis ? abweichungen(kz, opt.basis) : null,
    ziele,
    technik: technik(kz),
    verluste: verluste(kz, basisF),
    erster: get(kz, 'f3.erster_verlust_s'),
    leerlauf: leerlauf(kz),
  };
}

module.exports = {
  bewerten, abweichungen, ampel, zielBewertung, basisFlach,
  LEERLAUF_AUFFAELLIG_S, LEERLAUF_AUFFAELLIG_ANTEIL, TICK_SPITZE_MS, SCORE_MAX, SCHLECHTER_FAKTOR,
};
