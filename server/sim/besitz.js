'use strict';
// SUND-01 D: Besitz der Hexe im Modus „Freie Fahrt Sund“ (Banner, Posten, Andocken). Reines Lesemodul, ändert nie etwas.
// Quelle ist die optionale Overlay-Struktur am Game, die später die Weltsimulation (Paket B) füllt:
//   game.weltBesitz = { hexe: { '0305': { besitzer: 'rom', posten: false }, '0505': { besitzer: 'ger', posten: true } } }
// Fehlt sie (oder das Hex darin), gilt das statische Feld `fraktion` der Karte, `posten` ist dann falsch.
// Andocken wird nur eingeschränkt, wenn der Modus aktiv ist: Karte sund_frei oder ein Overlay am Game. In Limes und in der
// Kampagne (Karte sund) ohne Overlay ist darfAndocken immer wahr, alles bleibt wie heute.
const Sektoren = require('../../shared/sektoren.js');

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

// Darf die Crew in diesem Hex andocken? Posten nie (Kulisse), germanische und Piratenhäfen nie, sonst ja.
function darfAndocken(game, hex) {
  if (!modusAktiv(game)) return true;
  if (istPosten(game, hex) && !(Sektoren.hexDaten(hex) || {}).hafen) return false;
  return !GESPERRT[besitzer(game, hex)];
}

// Hinweistext für ein verweigertes Andocken (oder null)
function verbotText(game, hex) {
  if (darfAndocken(game, hex)) return null;
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

module.exports = { modus: modusAktiv, besitzer, istPosten, darfAndocken, verbotText, postenLage };
