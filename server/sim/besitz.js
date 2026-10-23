'use strict';
// SUND-01 D: Besitz der Hexe im Modus „Freie Fahrt Sund“ (Banner, Posten, Andocken). Reines Lesemodul, ändert nie etwas.
// Quelle ist die optionale Overlay-Struktur am Game, die später die Weltsimulation (Paket B) füllt:
//   game.weltBesitz = { hexe: { '0305': { besitzer: 'rom', posten: false }, '0505': { besitzer: 'ger', posten: true } } }
// Fehlt sie (oder das Hex darin), gilt das statische Feld `fraktion` der Karte, `posten` ist dann falsch.
// Andocken wird nur eingeschränkt, wenn der Modus aktiv ist: Karte sund_frei oder ein Overlay am Game. In Limes und in der
// Kampagne (Karte sund) ohne Overlay ist darfAndocken immer wahr, alles bleibt wie heute.
// SUND-02b A1: Stützpunkt der Crew (Overlay-Merkmal crew true: römischer Posten mit Garnison, den die Crew gegründet oder ausgebaut hat) hat Dock und Werft,
// ein Sim-Posten ohne crew bleibt Kulisse. Das Dock eines Postens gibt es nicht in den Szenendaten (die Szene ist ein geteiltes, gecachtes Objekt und wird nie verändert),
// sondern berechnet: dockLage() ersetzt an allen Stellen, die sc.dock lesen, das statische Feld.
const fs = require('fs');
const path = require('path');
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');
const POSTEN = require('../../content/welt/posten-werte.json').werte;
let texteCache = null;
const texte = () => {
  if (texteCache) return texteCache;
  try { texteCache = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'flotte', 'posten.json'), 'utf8')); } catch (e) { texteCache = {}; }
  return texteCache;
};

const FREI_KARTE = 'sund_frei';
// Besitzer, deren Häfen die Crew nicht anläuft (Kampfziel)
const GESPERRT = { ger: 'Germanischer Hafen – Andocken verweigert', pirat: 'Piratenhafen – Andocken verweigert' };

const overlay = (game) => (game && game.weltBesitz && game.weltBesitz.hexe) || null;
const eintrag = (game, hex) => { const o = overlay(game); return (o && hex && o[hex]) || null; };
const modusAktiv = (game) => !!overlay(game) || Sektoren.kartenId() === FREI_KARTE;

// Aktueller Besitzer (Fraktions-Id wie in `fraktionen` der Karte) oder null
function besitzer(game, hex) {
  const e = eintrag(game, hex);
  if (e && e.besitzer) return e.besitzer;
  const d = Sektoren.hexDaten(hex);
  return (d && d.fraktion) || null;
}

// Posten: kleine Station ohne Hafenklasse, laut Overlay gegründet. Ohne Overlay nie.
function istPosten(game, hex) {
  const e = eintrag(game, hex);
  return !!(e && e.posten === true);
}

// SUND-02b A1: Stützpunkt der Crew: Posten laut Overlay, Besitzer Rom, Merkmal crew (das Overlay setzt crew nur bei Garnison > 0, kriegslage.js overlayFuellen)
function crewPosten(game, hex) {
  const e = eintrag(game, hex);
  return !!(e && e.posten === true && e.besitzer === 'rom' && e.crew === true);
}

// SUND-02a A2: Läuft in diesem Hex eine Sim-Szene (Feindkontakt, game.simSzene), ist Andocken gesperrt, bis sie endet oder die Crew abspringt.
const SZENE_TEXT = 'Andocken gesperrt – Feindkontakt, erst die Gegner abwehren';
const szeneAn = (game, hex) => !!(game && game.simSzene && game.simSzene.hex === hex && game.simSzene.phase !== 'ende');

// Darf die Crew in diesem Hex andocken? Posten nur als Stützpunkt der Crew (sonst Kulisse), germanische und Piratenhäfen nie, während einer Sim-Szene nie, sonst ja.
function darfAndocken(game, hex) {
  if (!modusAktiv(game)) return true;
  if (szeneAn(game, hex)) return false;
  if (istPosten(game, hex) && !(Sektoren.hexDaten(hex) || {}).hafen) return crewPosten(game, hex);
  return !GESPERRT[besitzer(game, hex)];
}

// Hinweistext für ein verweigertes Andocken (oder null)
function verbotText(game, hex) {
  if (darfAndocken(game, hex)) return null;
  if (szeneAn(game, hex)) return SZENE_TEXT;
  if (istPosten(game, hex) && besitzer(game, hex) === 'rom' && !crewPosten(game, hex)) return (texte().dock || {}).kein_dock || 'Andocken verweigert';   // römischer Posten ohne Stützpunkt: erklärter Grund
  return GESPERRT[besitzer(game, hex)] || 'Andocken verweigert';
}

// Lage eines Postens in einer Szene: fester Punkt nahe der Mitte, der Planeten, Ankunft und Sprungpunkt-Streifen meidet.
// Deterministisch (Kandidatenliste), ändert die Szene nicht. -> { x, y, r }
function postenLage(sc) {
  const r = 34;
  const w = sc.w, h = sc.h;
  const kand = [[0.5, 0.5], [0.58, 0.46], [0.42, 0.54], [0.62, 0.58], [0.38, 0.42], [0.66, 0.4], [0.34, 0.6], [0.5, 0.7], [0.5, 0.3], [0.72, 0.5], [0.28, 0.5]];
  for (const [fx, fy] of kand) {
    const x = Math.round(w * fx), y = Math.round(h * fy);
    if ((sc.planeten || []).some((p) => Math.hypot(x - p.x, y - p.y) < p.r + 260)) continue;
    if (sc.arrive && Math.hypot(x - sc.arrive.x, y - sc.arrive.y) < 420) continue;
    return { x, y, r };
  }
  return { x: Math.round(w * 0.5), y: Math.round(h * 0.5), r };
}

// Liegeplatz in der Szene: das feste sc.dock (Häfen, Karawane) oder, an einem Stützpunkt der Crew ohne Station, ein Punkt unter dem Posten. Sonst null.
// Alle Leser von sc.dock gehen hierüber (Dockerkennung, Aufbau, Asteroiden-Freihalten, Sprung-Mindestabstand, Escort, Alarm).
function dockLage(game, sc, hex) {
  if (!sc) return null;
  if (sc.dock) return sc.dock;
  if (!sc.station && hex && crewPosten(game, hex)) { const pl = postenLage(sc); return { x: pl.x, y: pl.y + pl.r + POSTEN.dock.wert.abstand }; }
  return null;
}

// Kann die Crew an diesem Ort (Orts-ID) jetzt andocken? (Laden: war der gespeicherte Stützpunkt nicht mehr da, greift der Rückfall auf den Startort)
function dockbar(game, ortId) {
  const l = Locations.get(ortId);
  if (!l || !l.scene) return false;
  const hex = l.hex || Sektoren.hexVonOrt(ortId);
  return !!dockLage(game, l.scene, hex) && (!hex || darfAndocken(game, hex));
}

// Handel am Stützpunkt der Crew gesperrt (Text) oder null: der Posten hat Werft, aber keinen Markt
function handelSperre(game, hex) {
  return crewPosten(game, hex) ? ((texte().dock || {}).handel || 'Dieser Posten verkauft nichts.') : null;
}

module.exports = { modus: modusAktiv, besitzer, istPosten, crewPosten, darfAndocken, verbotText, postenLage, dockLage, dockbar, handelSperre };
