'use strict';
// TEC-01 A1: Komponenten der Schildkette (Technik Stufe 1).
// Die Systeme `shields` (Generator: Steuerkern K, Spannungsregler S, Relais R) und die vier Emitter (Relais R, Leitung L) bestehen aus Komponenten.
// Zustand je Komponente: ok | defekt | geflickt (geflickt zählt als funktionierend). Der Systemzustand wird abgeleitet:
// 0 defekt = ok, 1 = damaged, ab 2 = broken. ship.systems[sys] bleibt die Schnittstelle für alle Leser; hier lebt nur die Ableitung.
// Rezepte, Zuordnung System -> Rezept und das Überlastziel je Rezept sind Daten (config.systemModell.komponenten); ein neues System = eine Datenzeile.
//
// Zustand: ship.komp[sys] = [{ t: 'K'|'S'|'R'|'L', z: 'ok'|'defekt'|'geflickt', n: Ausfallzähler, sp: Flicken-Sprungzähler }]  (nur Systeme mit Rezept)
// Der Zufall kommt aus einem eigenen Strom (ship.kompRng, aus dem Spielseed), nie aus game.rng: Komponentenwahl darf die Strecke der Simulation nicht verschieben.
//
// Wahrheit bei Konflikt: schreibt jemand ship.systems[sys] direkt, gilt der geschriebene Zustand; konsistent() erzeugt die Komponenten dann neu.
// EMP-Zustand 'offline' wird nie überschrieben: während offline gilt die Ableitung für ship.offline[sys].prev.
const { makeRng } = require('../util.js');
// TEC-01 Nacharbeit 1.2: Namen, Konstanten, Kodieren/Dekodieren, Zulässigkeit der Ziele und die Bruchformel kommen aus dem gemeinsamen Modul (einzige Quelle, auch für den Client)
const F = require('../../shared/komponenten-format.js');

const OK = 'ok'; const DEFEKT = 'defekt'; const GEFLICKT = 'geflickt';
const RANG = { ok: 0, damaged: 1, broken: 2 };
const MAX_DEFEKT_BROKEN = F.MAX_DEFEKT_BROKEN;
const MINISPIEL_ART = F.MINISPIEL_ART;   // TEC-01 B1: nur das Relais hat in Stufe 1 ein Reparatur-Minispiel (Leertasten-Spiel), die anderen Arten nur Flicken und Tausch

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
// Komponentenart, die die Überlast (Hitze bei Energie 4) zuerst trifft; null = das System hat kein Überlastziel (Datum: komponenten.ueberlast[rezeptname])
function ueberlastZiel(game, sys) {
  const d = daten(game); const r = rezept(game, sys);
  const t = r && d.ueberlast && d.ueberlast[d.systeme[sys]];
  return typeof t === 'string' && r.includes(t) ? t : null;
}

function strom(game) {
  const ship = game.ship;
  if (!ship.kompRng) Object.defineProperty(ship, 'kompRng', { enumerable: false, writable: true, configurable: true, value: makeRng((((game.seed >>> 0) * 6151 + 977) >>> 0)) });
  return ship.kompRng;
}
function liste(game, sys) {   // legt die Liste bei Bedarf aus dem Systemzustand an; null ohne Rezept
  const r = rezept(game, sys);
  if (!r) return null;
  const K = game.ship.komp || (game.ship.komp = {});
  if (!Array.isArray(K[sys]) || K[sys].length !== r.length) erzeugeAusZustand(game, sys);
  return K[sys];
}

// Stellt sicher, dass die Komponentenliste eines Systems mit Rezept besteht (aus dem aktuellen Systemzustand, ohne Wächterzählung); vor jedem Schreiben des Zustands aufrufen
function anlegen(game, sys) { return liste(game, sys); }

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
  const K = game.ship.komp || (game.ship.komp = {});
  const neu = ausZustandRein(game, sys, K[sys]);
  if (!neu) return null;
  K[sys] = neu;
  return neu;
}
// Reine Berechnung (schreibt nichts): Komponenten eines Systems aus dem Systemzustand (Format-Modul F.ausZustand, eine Quelle); Zähler n/sp je Platz aus `alt`, wenn die Art dieselbe ist. null ohne Rezept.
function ausZustandRein(game, sys, alt) {
  const r = rezept(game, sys);
  if (!r) return null;
  const vorher = Array.isArray(alt) ? alt : [];
  return F.ausZustand(r, interior().effZustand(game, sys)).map((k, i) => {
    if (vorher[i] && vorher[i].t === k.t) { k.n = vorher[i].n | 0; k.sp = vorher[i].sp | 0; }
    return k;
  });
}
function erzeugeAlleAusZustand(game) { for (const sys of systeme(game)) erzeugeAusZustand(game, sys); }
// Neu aufgestellte Lerche (Szenenreset, Arena): Komponenten aus dem Zustand UND Ausfall-/Sprungzähler 0 (wie reaktortod.zuruecksetzen).
// erzeugeAlleAusZustand dagegen behält die Zähler bei gleicher Art (Wächter, Laden).
function neuAufstellen(game) { game.ship.komp = {}; erzeugeAlleAusZustand(game); }

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
  if (k.z === OK && F.hatZaehler(k.t)) k.n = (k.n | 0) + 1;
  k.z = DEFEKT;
}
// Auswahl der getroffenen Komponente (gemeinsam für Treffer und hebeAufZustand): per Zufallsstrom unter den funktionierenden (ok oder geflickt);
// die Art `bevorzugt` kommt zuerst dran, solange eine davon funktioniert. null, wenn nichts mehr funktioniert.
function waehleFrei(game, L, bevorzugt) {
  const frei = L.filter((k) => k.z !== DEFEKT);
  if (!frei.length) return null;
  const bev = bevorzugt ? frei.filter((k) => k.t === bevorzugt) : [];
  const pool = bev.length ? bev : frei;
  return pool.length === 1 ? pool[0] : strom(game).pick(pool);
}
function trefferMit(game, sys, bevorzugt) {
  const L = liste(game, sys);
  if (!L || defekteZahl(game, sys) >= MAX_DEFEKT_BROKEN) return null;
  const wahl = waehleFrei(game, L, bevorzugt);
  if (!wahl) return null;
  const vorher = wahl.z;
  faelltAus(wahl);
  synchronisieren(game, sys);
  return { index: L.indexOf(wahl), t: wahl.t, vorher };
}
// Ein Komponententreffer: EINE funktionierende Komponente zufällig (Zufallsstrom). Ein zerstörtes System (ab 2 defekt) nimmt keinen weiteren Schaden.
// Rückgabe: { index, t, vorher } der getroffenen Komponente oder null.
function trefferAuf(game, sys) { return trefferMit(game, sys, null); }
// Überlasttreffer: trifft die konfigurierte Überlastkomponente (ueberlastZiel, z. B. den Spannungsregler S), solange sie funktioniert, sonst zufällig. Sonst wie trefferAuf.
function ueberlastTreffer(game, sys) { return trefferMit(game, sys, ueberlastZiel(game, sys)); }

// TEC-01 F: Treffer auf bestimmte Komponenten (Skript, z. B. das Tutorial m1: der Korvetten-Treffer zerlegt immer dieselben zwei). arten = Typbuchstaben in der Reihenfolge der Treffer.
// Je Art trifft es die erste funktionierende Komponente dieser Art (wie ein Treffer: ok -> defekt zählt für R und K im Ausfallzähler, geflickt bricht nur den Flicken);
// ein zerstörtes System (ab 2 defekt) nimmt nichts mehr. Kein Zufall. Rückgabe: Liste der getroffenen { index, t, vorher }.
function trefferArten(game, sys, arten) {
  const L = liste(game, sys);
  const getroffen = [];
  if (!L) return getroffen;
  for (const art of arten) {
    if (defekteZahl(game, sys) >= MAX_DEFEKT_BROKEN) break;
    const k = L.find((q) => q.t === art && q.z !== DEFEKT);
    if (!k) continue;
    const vorher = k.z;
    faelltAus(k);
    getroffen.push({ index: L.indexOf(k), t: k.t, vorher });
  }
  if (getroffen.length) synchronisieren(game, sys);
  return getroffen;
}

// Hebt die Zahl der defekten Komponenten auf den Wert des Zielzustands ('damaged' = 1, 'broken' = 2). Senkt nie.
// Wählt wie ein Treffer (waehleFrei): nur unter den funktionierenden Komponenten, zufällig (ohne Vorzugsart; die gilt nur für den Überlasttreffer).
// Rückgabe: Zahl der neu ausgefallenen Komponenten.
function hebeAufZustand(game, sys, ziel) {
  const L = liste(game, sys);
  if (!L) return 0;
  const soll = zielZahl(ziel);
  let neu = 0;
  while (defekteZahl(game, sys) < soll) {
    const wahl = waehleFrei(game, L, null);
    if (!wahl) break;
    faelltAus(wahl);
    neu++;
  }
  if (neu) synchronisieren(game, sys);
  return neu;
}

// ---------- TEC-01 B1: Reparatur je Komponente ----------
// Zustand und Zähler: Flicken = defekt -> geflickt (sp 0); Tausch = nur diese Komponente -> ok (n 0, sp 0); Relais-Minispiel = Relais -> ok (n bleibt, sp 0).
// Eine Komponente wird durch ihre Art (Typbuchstabe) gewählt; ohne Wunsch gilt die Regel der Aktion. Alle Funktionen geben null zurück, wenn nichts zu tun ist.
function ausfallSperre(game) { return F.sperreVon(daten(game)); }   // Datum: komponenten.ausfallSperre
const name = F.name;
// Ist am System etwas zu reparieren (eine Komponente defekt oder geflickt)?
function reparierbar(game, sys) {
  if (!hatKomponenten(game, sys)) return false;
  konsistent(game, sys);
  return liste(game, sys).some((k) => k.z !== OK);
}
// TEC-01 E: Lesesicht für Bots und Pläne: Kopie der Komponenten [{ t, z, n, sp }] in Rezeptreihenfolge; null ohne Rezept.
// TEC-01 Endreview N2: NEBENWIRKUNGSFREI. Kein Wächter, kein Schreiben (weder ship.komp noch kompKorrekturen): ist ship.komp[sys] vorhanden und passt zum Systemzustand, gilt es;
// fehlt es oder widerspricht es dem geschriebenen Systemzustand, kommt dasselbe Ergebnis, das der Wächter erzeugen würde, aus der reinen Berechnung (ausZustandRein).
function lage(game, sys) {
  if (!hatKomponenten(game, sys)) return null;
  const alt = game.ship.komp && game.ship.komp[sys];
  const st = interior().effZustand(game, sys);
  const passt = Array.isArray(alt) && alt.length === rezept(game, sys).length && (!(st in RANG) || zustandZahl(alt.filter((k) => k.z === DEFEKT).length) === st);
  return (passt ? alt : ausZustandRein(game, sys, alt)).map((k) => ({ t: k.t, z: k.z, n: k.n | 0, sp: k.sp | 0 }));
}
// Geht das Relais-Minispiel jetzt (Relais defekt und nicht verschlissen)? Lesend (über lage), schreibt nichts.
function minispielMoeglich(game, sys) { const L = lage(game, sys); return !!L && F.zulaessigeZiele(L, 'minigame', ausfallSperre(game)).length > 0; }
// Hat das System einen Flicken? (liest nur: ohne Liste keiner) – daraus leitet interior.isFragile für die Schildkette ab
function hatGeflickte(game, sys) { const L = game.ship.komp && game.ship.komp[sys]; return Array.isArray(L) && L.some((k) => k.z === GEFLICKT); }
// Zielkomponente einer Aktion ('flick' | 'swap' | 'minigame'): { index, t } oder { hinweis }. wunsch = Typbuchstabe oder leer (Standard).
// Standard: flick = erste defekte (Rezeptreihenfolge); swap = erste defekte, sonst erste geflickte; minigame = immer das Relais. Ein Wunsch, der nicht im Rezept steht, zählt als kein Wunsch;
// ein Wunsch, der für die Aktion nicht zulässig ist, ergibt einen Hinweis (nie ein stiller Ersatz).
function reparaturZiel(game, sys, aktion, wunsch) {
  const r = rezept(game, sys);
  if (!r) return { hinweis: 'Dieses System hat keine Komponenten.' };
  konsistent(game, sys);
  const L = liste(game, sys);
  const w = typeof wunsch === 'string' && r.includes(wunsch) ? wunsch : null;
  const treffer = (art) => ({ index: L.findIndex((q) => q.t === art), t: art });
  if (!['minigame', 'flick', 'swap'].includes(aktion)) return { hinweis: 'Unbekannte Reparatur.' };
  // Zulässigkeit: die Regel des gemeinsamen Moduls (Client und Server gleich); der Standard ist das erste zulässige Ziel. Hier entstehen nur die Hinweistexte.
  const ziele = F.zulaessigeZiele(L, aktion, ausfallSperre(game));
  if (w ? ziele.includes(w) : ziele.length) return treffer(w || ziele[0]);
  if (aktion === 'minigame') {
    const k = L.find((q) => q.t === MINISPIEL_ART);
    if (!k) return { hinweis: 'Hier gibt es kein Minispiel: E halten zum Flicken oder Tauschen.' };
    if (w && w !== MINISPIEL_ART) return { hinweis: name(w) + ' hat kein Minispiel: E halten zum Flicken oder Tauschen.' };
    if (k.z === OK) return { hinweis: 'Relais ist heil.' };
    return { hinweis: 'Relais verschlissen: nur noch Flicken oder Tausch.' };
  }
  if (aktion === 'flick') return { hinweis: w ? name(w) + ' ist nicht defekt.' : 'Nichts zu flicken: nichts ist defekt.' };
  return { hinweis: w ? name(w) + ' ist heil.' : 'Nichts zu tauschen: alles heil.' };
}
// Während des Haltens und am Ende: ist die gewählte Komponente noch im nötigen Zustand? (komp = Art, die der Hold trägt)
function reparaturGueltig(game, sys, aktion, komp) {
  const z = reparaturZiel(game, sys, aktion, komp);
  return z.index != null && (!komp || z.t === komp);
}
function setzeRepariert(game, sys, ziel, z, mitN0) {
  const k = liste(game, sys)[ziel.index];
  const vorher = k.z;
  k.z = z; k.sp = 0;
  if (mitN0) k.n = 0;
  synchronisieren(game, sys);
  return { index: ziel.index, t: k.t, vorher };
}
// Flicken: eine defekte Komponente -> geflickt (Sprungzähler 0)
function flickenKomponente(game, sys, wunsch) {
  const ziel = reparaturZiel(game, sys, 'flick', wunsch);
  return ziel.index != null ? setzeRepariert(game, sys, ziel, GEFLICKT, false) : null;
}
// Tausch (Ersatzteil): NUR diese Komponente -> ok, Ausfallzähler 0, Sprungzähler 0; auch eine geflickte kann getauscht werden
function tauschenKomponente(game, sys, wunsch) {
  const ziel = reparaturZiel(game, sys, 'swap', wunsch);
  return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, true) : null;
}
// Relais-Minispiel gelungen: das Relais -> ok (kein Flicken, Ausfallzähler bleibt, Sprungzähler 0); gesperrt ab n >= ausfallSperre
function reparierenRelais(game, sys) {
  const ziel = reparaturZiel(game, sys, 'minigame', MINISPIEL_ART);
  return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, false) : null;
}

// ---------- TEC-01 C: Sprungbruch der Notflicken ----------
// Jeder Systemsprung (springeNach, Notsprung, Finale-Orbit) bricht jeden Flicken der Schildkette mit p = grund + proSprung * sp (höchstens 1; Daten: komponenten.sprungBruch).
// Ein zerstörtes System (ab 2 defekt) nimmt keinen weiteren Komponentenschaden: sind vor einem Wurf schon 2 Komponenten defekt, wird für diesen Flicken nicht gewürfelt, er bleibt geflickt und
// zählt den Sprung als überstanden (sp + 1). Bricht der erste Flicken eines Systems mit 1 defekten Komponente, sind damit die folgenden Flicken dieses Sprungs geschützt.
// Überstanden (nicht gebrochen): sp + 1. Gebrochen: Komponente wieder defekt (wie vor dem Flicken, Ausfallzähler n unverändert), sp 0. Zufall nur aus ship.kompRng, ein Wurf je Flicken.
// Bruchwahrscheinlichkeit eines Flickens, der sp Sprünge überstanden hat (Formel und Standardwerte im gemeinsamen Modul, Daten: komponenten.sprungBruch)
function sprungBruchChance(game, sp) { return F.bruchChance(sp, daten(game)); }
// Ein Sprung für die ganze Schildkette. Reihenfolge fest: System laut Konfig, dann Rezeptreihenfolge. Die Nachbehandlung eines geänderten Systemzustands (Ereignis, Integrität, Zone aus, ODA)
// ist die des Treffers (interior.sprungBruchSchaden). Rückgabe: Liste der gebrochenen Flicken [{ system, komp }].
function sprungBruch(game) {
  const gebrochen = [];
  for (const sys of systeme(game)) {
    if (!hatGeflickte(game, sys)) continue;
    interior().sprungBruchSchaden(game, sys, (g, s) => {
      const L = liste(g, s);
      for (const k of L) {
        if (k.z !== GEFLICKT) continue;
        if (defekteZahl(g, s) < MAX_DEFEKT_BROKEN && strom(g)() < sprungBruchChance(g, k.sp)) {
          faelltAus(k); k.sp = 0;
          gebrochen.push({ system: s, komp: k.t });
          g.emit('flickGebrochen', { system: s, komp: k.t });
        } else k.sp = (k.sp | 0) + 1;
      }
      synchronisieren(g, s);
    });
  }
  if (gebrochen.length) interior().flickBruchAnsage(game, gebrochen);
  return gebrochen;
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
// Je System ein String: ein Zustandscode je Komponente (o ok, d defekt, g geflickt, - unbekannt) in Rezeptreihenfolge; sind Zähler gesetzt, folgt ';n1,n2..;sp1,sp2..'.
// '-' steht im Weltstand dort, wo die Codes dem gespeicherten Systemzustand widersprechen: nur die Zähler gelten, die Zustände folgen dem Systemzustand.
function kodiere(game, sys) {
  const L = liste(game, sys);
  if (!L) return null;
  return F.kodiere(L);
}
const zaehlerTeil = F.zaehlerTeil;
// Zurück in eine Liste (z ist null bei '-'); null, wenn der Text nicht zum Rezept passt
function dekodiere(game, sys, text) { return F.dekodiere(text, rezept(game, sys)); }
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

// Weltstand: Block schiff.komp, nur wo die Komponenten vom Standard (aus dem gespeicherten Systemzustand erzeugt) abweichen.
// `gespeichert`: System -> gespeicherter Zustand (Weltstand bildet offline und geflickt ab). Passt die Ableitung nicht dazu, werden die Zustandscodes verworfen ('-'),
// die Zähler (n, sp) bleiben erhalten.
function fuerSpeicher(game, gespeichert) {
  let out = null;
  for (const sys of systeme(game)) {
    const L = game.ship.komp && game.ship.komp[sys];
    if (!Array.isArray(L) || !L.some((k) => k.z !== OK || k.n > 0 || k.sp > 0)) continue;
    if (zustandZahl(L.filter((k) => k.z === DEFEKT).length) !== gespeichert[sys]) {
      const zt = zaehlerTeil(L);
      if (zt) (out || (out = {}))[sys] = '-'.repeat(L.length) + zt;
      continue;
    }
    const standard = F.kodiere(F.ausZustand(L.map((k) => k.t), gespeichert[sys]));   // der Standard: aus dem gespeicherten Systemzustand erzeugt, ohne Zähler
    if (kodiere(game, sys) === standard) continue;
    (out || (out = {}))[sys] = kodiere(game, sys);
  }
  return out;
}
// Laden: Komponenten aus dem Systemzustand erzeugen, dann den gespeicherten Block darüberlegen: Zustandscodes nur, wo sie zum Systemzustand passen, Zähler immer. Ein Altstand ohne Block ist der Normalfall.
// TEC-01 Endreview M4: der Block ist abgeleitete, entbehrliche Information. Das Schema prüft ihn nicht (sonst machte ein kaputter Eintrag den ganzen Weltstand unladbar); hier wird er STRENG geprüft
// (Muster, Länge je Rezept, Zähler bis 9999, Typ) und alles Ungültige verworfen: der Eintrag fällt auf die Komponenten aus dem Systemzustand zurück. Nie Absturz, nie Ablehnen des Weltstands.
function ausSpeicher(game, block) {
  erzeugeAlleAusZustand(game);
  if (!block || typeof block !== 'object' || Array.isArray(block)) return;
  for (const sys of systeme(game)) {
    if (!Object.prototype.hasOwnProperty.call(block, sys)) continue;
    const L = F.dekodiereStreng(block[sys], rezept(game, sys));
    if (!L) continue;
    if (L.every((k) => k.z) && zustandZahl(L.filter((k) => k.z === DEFEKT).length) === interior().effZustand(game, sys)) game.ship.komp[sys] = L;
    else game.ship.komp[sys].forEach((k, i) => { k.n = L[i].n; k.sp = L[i].sp; });
  }
}

module.exports = {
  rezept, hatKomponenten, systeme, ueberlastZiel, anlegen, erzeugeAusZustand, erzeugeAlleAusZustand, neuAufstellen, abgeleitet, synchronisieren, defekteZahl, funktionierende,
  MINISPIEL_ART, lage, minispielMoeglich, reparierbar, hatGeflickte, sprungBruch, sprungBruchChance, name, reparaturZiel, reparaturGueltig, flickenKomponente, tauschenKomponente, reparierenRelais, ausfallSperre,
  setzeKomponente, hebeAufZustand, trefferAuf, trefferArten, ueberlastTreffer, konsistent, konsistentAlle, kodiere, dekodiere, snapshot, fuerSpeicher, ausSpeicher,
};
