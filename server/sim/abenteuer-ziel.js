'use strict';
// FRE-02 A1: Zielwahl fuer Abenteuer-Angebote (Freie Fahrt Sund, nur mit FAEDEN=1). Action-Layer wie abenteuer-rueckfall.js: reine Regeln auf Karte, Weltstand und dem Strom der Faeden (kein Modell, kein Math.random,
// kein eigener Zustand). Ein Angebot hat einen Ort der Geschichte (angebot.hex, wird faden.parameter.ort); er liegt in der UMGEBUNG des Hafens, an dem die Crew ist, nicht im Hafen selbst: mindestens 1 und hoechstens
// `angebot_radius_spruenge` (Daten: content/faeden/werte.json abenteuer.wert) Spruenge im Kartengraph ueber OFFENE Sprungpunkte (faden-b1.js erreichbar, derselbe Graph wie der Inszenierer), nicht Hex-Distanz.
// Der Sperrtext einer Region filtert hier NICHT (er ist die Meldung einer geschlossenen Kante, kein Flugverbot: sprung.js hexGrund; Kai, 2026-11-11). Ein Ziel ist ein spielbarer Sektor mit Szene und mindestens einer
// landbaren Kartenart (abenteuer-orte.js moeglicheArten): sonst fehlt einem Abenteuer dort der Landeplatz. Kein Beat-, Absichts- oder Hafenname in diesem Modul.
//
//   radius() -> Zahl                                   Spruenge (Daten)
//   kandidaten(game, hafen) -> [hex]                   alle gueltigen Ziele im Umkreis, sortiert (der Hafen selbst nie)
//   belegt(game) -> [hex]                              Ziele, die schon vergeben sind: offene Abenteuer-Angebote und der Ort des laufenden Abenteuers
//   zielFolge(game, hafen, { belegt? }) -> [hex]       die freien Ziele in gezogener Reihenfolge (Strom `angebot_ziel`, Zaehler = naechste Angebotsnummer): der erste ist die Wahl, die uebrigen die Ersatzwahl, wenn ein
//                                                      Plan dort nicht spielbar ist (derselbe Weg wie die Planwahl des Rueckfalls: Anfang aus dem Strom, danach der Reihe nach)
//   zielImUmkreis(game, hafen, { belegt? }) -> hex | null   das gewaehlte Ziel; null = kein freies Ziel (ehrlich weniger Angebote, der Aufrufer erfindet keines)
//   werteFehler() -> [Text]                            der Radius ist eine ganze Zahl >= 0
const D = require('./faden-daten.js');
const Sektoren = require('../../shared/sektoren.js');

const Faden = () => require('./faden.js');
const B1 = () => require('./faden-b1.js');
const Orte = () => require('./abenteuer-orte.js');
const HEX = /^\d{4}$/;
const SALZ = 'angebot_ziel';

const radius = () => D.WERTE.abenteuer.angebot_radius_spruenge;

function kandidaten(game, hafen) {
  const r = radius();
  if (!Number.isInteger(r) || r < 1 || typeof hafen !== 'string' || !HEX.test(hafen)) return [];
  const out = [];
  for (const [hex, s] of B1().erreichbar(game, hafen, r)) {
    if (s < 1 || s > r || !Sektoren.hatSzene(hex) || !Orte().moeglicheArten(hex).length) continue;
    out.push(hex);
  }
  return out.sort();
}

function belegt(game) {
  const F = Faden().zustandVon(game);
  if (!F) return [];
  const out = (F.abenteuerAngebote || []).map((a) => a.hex);
  for (const f of F.liste || []) if (f.plan && f.phase !== 'abgeschlossen' && f.parameter && f.parameter.ort) out.push(f.parameter.ort);
  return out.filter((h, i) => typeof h === 'string' && out.indexOf(h) === i);
}

function zielFolge(game, hafen, o) {
  const b = o && Array.isArray(o.belegt) ? o.belegt : [];
  const frei = kandidaten(game, hafen).filter((h) => !b.includes(h));
  if (!frei.length) return [];
  const F = Faden().zustandVon(game);
  const start = Math.floor(Faden().strom(game, (F ? F.angNr : 0) + 1, SALZ)() * frei.length) % frei.length;
  return frei.map((_, k) => frei[(start + k) % frei.length]);
}

function zielImUmkreis(game, hafen, o) {
  const f = zielFolge(game, hafen, o);
  return f.length ? f[0] : null;
}

function werteFehler() {
  const r = radius();
  return Number.isInteger(r) && r >= 0 && r <= 8 ? [] : [`angebot_radius_spruenge ist keine ganze Zahl von 0 bis 8: ${JSON.stringify(r)}`];
}

module.exports = { radius, kandidaten, belegt, zielFolge, zielImUmkreis, werteFehler };
