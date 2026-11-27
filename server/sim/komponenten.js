'use strict';
// TEC-01 A1: Komponenten der Schildkette (Technik Stufe 1).
// Die Systeme `shields` (Generator: Steuerkern K, Spannungsregler S, Relais R) und die vier Emitter (Relais R, Leitung L) bestehen aus Komponenten.
// Zustand je Komponente: ok | defekt | geflickt (geflickt zählt als funktionierend). Der Systemzustand wird abgeleitet:
// 0 defekt = ok, 1 = damaged, ab 2 = broken. ship.systems[sys] bleibt die Schnittstelle für alle Leser; hier lebt nur die Ableitung.
// Rezepte und Zuordnung System -> Rezept sind Daten (config.systemModell.komponenten); ein neues System = eine Datenzeile.
//
// Zustand: ship.komp[sys] = [{ t: 'K'|'S'|'R'|'L', z: 'ok'|'defekt'|'geflickt', n: Ausfallzähler, sp: Flicken-Sprungzähler }]  (nur Systeme mit Rezept)
// Der Zufall kommt aus einem eigenen Strom (ship.kompRng, aus dem Spielseed), nie aus game.rng: Komponentenwahl darf die Strecke der Simulation nicht verschieben.
//
// Wahrheit bei Konflikt: schreibt jemand ship.systems[sys] direkt, gilt der geschriebene Zustand; konsistent() erzeugt die Komponenten dann neu.
// EMP-Zustand 'offline' wird nie überschrieben: während offline gilt die Ableitung für ship.offline[sys].prev.
const { makeRng } = require('../util.js');

const OK = 'ok'; const DEFEKT = 'defekt'; const GEFLICKT = 'geflickt';
const CODE = { [OK]: 'o', [DEFEKT]: 'd', [GEFLICKT]: 'g' };
const VON_CODE = { o: OK, d: DEFEKT, g: GEFLICKT };
const RANG = { ok: 0, damaged: 1, broken: 2 };
const MAX_DEFEKT_BROKEN = 2;
const ZAEHLT_AUSFALL = ['R', 'K'];   // Relais und Steuerkern: ein Treffer (ok -> defekt) zählt im Ausfallzähler n mit

let interiorMod = null;   // Zirkelbezug interior -> komponenten: lazy
const interior = () => interiorMod || (interiorMod = require('./interior.js'));

function daten(game) { return (game.C.systemModell && game.C.systemModell.komponenten) || { rezepte: {}, systeme: {} }; }
// Rezept (Liste der Komponentenarten) eines Systems; null = das System hat keine Komponenten (systemweit wie bisher)
function rezept(game, sys) {
  const d = daten(game);
  const name = d.systeme && d.systeme[sys];
  return name && d.rezepte && Array.isArray(d.rezepte[name]) ? d.rezepte[name] : null;
}
function hatKomponenten(game, sys) { return !!rezept(game, sys); }
function systeme(game) { return Object.keys(daten(game).systeme || {}); }

function strom(game) {
  const ship = game.ship;
  if (!ship.kompRng) Object.defineProperty(ship, 'kompRng', { enumerable: false, writable: true, configurable: true, value: makeRng((((game.seed >>> 0) * 6151 + 977) >>> 0)) });
  return ship.kompRng;
}
function neueKomponente(t) { return { t, z: OK, n: 0, sp: 0 }; }
function liste(game, sys) {   // legt die Liste bei Bedarf aus dem Systemzustand an; null ohne Rezept
  const r = rezept(game, sys);
  if (!r) return null;
  const K = game.ship.komp || (game.ship.komp = {});
  if (!Array.isArray(K[sys]) || K[sys].length !== r.length) erzeugeAusZustand(game, sys);
  return K[sys];
}

function zustandZahl(zahl) { return zahl >= MAX_DEFEKT_BROKEN ? 'broken' : zahl >= 1 ? 'damaged' : 'ok'; }
function zielZahl(ziel) { return ziel === 'broken' ? MAX_DEFEKT_BROKEN : ziel === 'damaged' ? 1 : 0; }

function defekteZahl(game, sys) {
  const L = liste(game, sys);
  return L ? L.filter((k) => k.z === DEFEKT).length : 0;
}
// Abgeleiteter Systemzustand: 'ok' | 'damaged' | 'broken'
function abgeleitet(game, sys) { return zustandZahl(defekteZahl(game, sys)); }
// Funktionierende Komponenten (ok oder geflickt), als Verweise auf die Einträge
function funktionierende(game, sys) {
  const L = liste(game, sys);
  return L ? L.filter((k) => k.z !== DEFEKT) : [];
}

// Komponenten aus dem Systemzustand neu erzeugen (Wahrheit = Zustand): damaged -> 1 defekt, broken -> 2 defekt, ohne Zufall (die Rezeptenden fallen zuerst aus).
// Ausfallzähler und Sprungzähler bleiben je Platz erhalten, wenn die Art dieselbe ist.
function erzeugeAusZustand(game, sys) {
  const r = rezept(game, sys);
  if (!r) return null;
  const K = game.ship.komp || (game.ship.komp = {});
  const alt = Array.isArray(K[sys]) ? K[sys] : [];
  const st = interior().effZustand(game, sys);
  const zahl = Math.min(zielZahl(st), r.length);
  const neu = r.map((t, i) => {
    const k = neueKomponente(t);
    if (alt[i] && alt[i].t === t) { k.n = alt[i].n | 0; k.sp = alt[i].sp | 0; }
    if (i >= r.length - zahl) k.z = DEFEKT;
    return k;
  });
  K[sys] = neu;
  return neu;
}
function erzeugeAlleAusZustand(game) { for (const sys of systeme(game)) erzeugeAusZustand(game, sys); }

// Systemzustand (systems bzw. offline.prev) und Integrität folgen den Komponenten
function synchronisieren(game, sys) {
  if (!hatKomponenten(game, sys)) return;
  const abgl = abgeleitet(game, sys);
  const s = game.ship.systems;
  if (s[sys] === 'offline') {
    const o = game.ship.offline && game.ship.offline[sys];
    if (o) o.prev = abgl;   // EMP-Pause bleibt, nur die vorgemerkte Stufe folgt
  } else if (s[sys] != null) s[sys] = abgl;
  if (abgl === 'broken' && game.ship.fragile) delete game.ship.fragile[sys];
  interior().syncInteg(game, sys);
}

// Eine Komponente setzen (Index im Rezept). Ein zerstörtes System (ab 2 defekt) nimmt keinen weiteren Komponentenschaden.
// Rückgabe: true, wenn sich der Zustand der Komponente geändert hat.
function setzeKomponente(game, sys, index, z) {
  const L = liste(game, sys);
  if (!L || !L[index] || ![OK, DEFEKT, GEFLICKT].includes(z) || L[index].z === z) return false;
  if (z === DEFEKT && defekteZahl(game, sys) >= MAX_DEFEKT_BROKEN) return false;
  L[index].z = z;
  synchronisieren(game, sys);
  return true;
}

// Eine Komponente fällt durch einen Treffer aus. Ein geflickter Platz bricht nur den Flicken (n bleibt), ein heiler zählt für R und K im Ausfallzähler.
function faelltAus(k) {
  if (k.z === OK && ZAEHLT_AUSFALL.includes(k.t)) k.n = (k.n | 0) + 1;
  k.z = DEFEKT;
}
// Ein Komponententreffer: wählt per Zufallsstrom EINE funktionierende Komponente (ok oder geflickt); opts.bevorzugt = Art, die zuerst drankommt, solange sie funktioniert (Überlast: 'S').
// Ein zerstörtes System (ab 2 defekt) nimmt keinen weiteren Schaden. Rückgabe: { index, t, vorher } der getroffenen Komponente oder null.
function trefferAuf(game, sys, opts) {
  const L = liste(game, sys);
  if (!L || defekteZahl(game, sys) >= MAX_DEFEKT_BROKEN) return null;
  const frei = L.filter((k) => k.z !== DEFEKT);
  if (!frei.length) return null;
  const bevorzugt = opts && opts.bevorzugt;
  const bev = bevorzugt ? frei.filter((k) => k.t === bevorzugt) : [];
  const pool = bev.length ? bev : frei;
  const wahl = pool.length === 1 ? pool[0] : strom(game).pick(pool);
  const vorher = wahl.z;
  faelltAus(wahl);
  synchronisieren(game, sys);
  return { index: L.indexOf(wahl), t: wahl.t, vorher };
}

// Hebt die Zahl der defekten Komponenten auf den Wert des Zielzustands ('damaged' = 1, 'broken' = 2). Senkt nie.
// Wählt per Zufallsstrom nur unter den funktionierenden Komponenten; bevorzugt optional die Art `bevorzugt` (z. B. 'S' bei Überlast).
// Rückgabe: Zahl der neu ausgefallenen Komponenten.
function hebeAufZustand(game, sys, ziel, bevorzugt) {
  const L = liste(game, sys);
  if (!L) return 0;
  const soll = zielZahl(ziel);
  let neu = 0;
  while (defekteZahl(game, sys) < soll) {
    const frei = L.filter((k) => k.z !== DEFEKT);
    if (!frei.length) break;
    const bev = bevorzugt ? frei.filter((k) => k.t === bevorzugt) : [];
    const pool = bev.length ? bev : frei;
    const wahl = pool.length === 1 ? pool[0] : strom(game).pick(pool);
    faelltAus(wahl);
    neu++;
  }
  if (neu) synchronisieren(game, sys);
  return neu;
}

// Wächter: weicht der (effektive) Systemzustand von der Ableitung ab, hat jemand ship.systems direkt geschrieben.
// Der geschriebene Zustand gilt, die Komponenten werden daraus neu erzeugt. Rückgabe: true, wenn nachgezogen wurde.
function konsistent(game, sys) {
  if (!hatKomponenten(game, sys)) return false;
  const st = interior().effZustand(game, sys);
  if (!(st in RANG)) return false;   // unbekannter Wert: nichts anfassen
  const L = game.ship.komp && game.ship.komp[sys];
  if (Array.isArray(L) && L.length === rezept(game, sys).length && zustandZahl(L.filter((k) => k.z === DEFEKT).length) === st) return false;
  erzeugeAusZustand(game, sys);
  korrekturZaehlen(game);
  return true;
}
// Testhilfe: wie oft der Wächter nachziehen musste (nicht aufgezählt, nicht im Snapshot). Im sauberen Trefferpfad bleibt er 0.
function korrekturZaehlen(game) { Object.defineProperty(game.ship, 'kompKorrekturen', { enumerable: false, writable: true, configurable: true, value: (game.ship.kompKorrekturen | 0) + 1 }); }
function konsistentAlle(game) { for (const sys of systeme(game)) konsistent(game, sys); }

// ---------- Kompaktform (Snapshot und Weltstand) ----------
// Je System ein String: ein Zustandscode je Komponente (o ok, d defekt, g geflickt) in Rezeptreihenfolge; sind Zähler gesetzt, folgt ';n1,n2..;sp1,sp2..'.
function kodiere(game, sys) {
  const L = liste(game, sys);
  if (!L) return null;
  let s = L.map((k) => CODE[k.z] || 'o').join('');
  if (L.some((k) => k.n > 0 || k.sp > 0)) s += ';' + L.map((k) => k.n | 0).join(',') + ';' + L.map((k) => k.sp | 0).join(',');
  return s;
}
// Zurück in eine Liste; null, wenn der Text nicht zum Rezept passt
function dekodiere(game, sys, text) {
  const r = rezept(game, sys);
  if (!r || typeof text !== 'string') return null;
  const teile = text.split(';');
  const codes = teile[0];
  if (codes.length !== r.length || ![...codes].every((c) => c in VON_CODE)) return null;
  const zahlen = (t) => { const a = String(t || '').split(',').map((x) => Math.max(0, Math.min(9999, parseInt(x, 10) || 0))); return a.length === r.length ? a : r.map(() => 0); };
  const n = zahlen(teile[1]); const sp = zahlen(teile[2]);
  return r.map((t, i) => ({ t, z: VON_CODE[codes[i]], n: n[i], sp: sp[i] }));
}
// Snapshot: nur Systeme mit Abweichung (Komponente nicht ok oder Zähler > 0); null, wenn nichts abweicht
function snapshot(game) {
  let out = null;
  for (const sys of systeme(game)) {
    const L = game.ship.komp && game.ship.komp[sys];
    if (!Array.isArray(L) || !L.some((k) => k.z !== OK || k.n > 0 || k.sp > 0)) continue;
    (out || (out = {}))[sys] = kodiere(game, sys);
  }
  return out;
}

// Weltstand: Block schiff.komp, nur wo die Komponenten vom Standard (aus dem gespeicherten Systemzustand erzeugt) abweichen und zu ihm passen.
// `gespeichert`: System -> gespeicherter Zustand (Weltstand bildet offline und geflickt ab; passt die Ableitung nicht dazu, gilt der Standard).
function fuerSpeicher(game, gespeichert) {
  let out = null;
  for (const sys of systeme(game)) {
    const L = game.ship.komp && game.ship.komp[sys];
    if (!Array.isArray(L) || !L.some((k) => k.z !== OK || k.n > 0 || k.sp > 0)) continue;
    if (zustandZahl(L.filter((k) => k.z === DEFEKT).length) !== gespeichert[sys]) continue;
    const standard = L.map((k, i) => (i >= L.length - Math.min(zielZahl(gespeichert[sys]), L.length) ? 'd' : 'o')).join('');
    if (kodiere(game, sys) === standard) continue;
    (out || (out = {}))[sys] = kodiere(game, sys);
  }
  return out;
}
// Laden: Komponenten aus dem Systemzustand erzeugen, dann den gespeicherten Block darüberlegen, wo er zum Zustand passt. Ein Altstand ohne Block ist der Normalfall.
function ausSpeicher(game, block) {
  erzeugeAlleAusZustand(game);
  if (!block || typeof block !== 'object') return;
  for (const sys of systeme(game)) {
    const L = dekodiere(game, sys, block[sys]);
    if (!L || zustandZahl(L.filter((k) => k.z === DEFEKT).length) !== interior().effZustand(game, sys)) continue;
    game.ship.komp[sys] = L;
  }
}

module.exports = {
  rezept, hatKomponenten, systeme, erzeugeAusZustand, erzeugeAlleAusZustand, abgeleitet, synchronisieren, defekteZahl, funktionierende,
  setzeKomponente, hebeAufZustand, trefferAuf, konsistent, konsistentAlle, kodiere, dekodiere, snapshot, fuerSpeicher, ausSpeicher,
};
