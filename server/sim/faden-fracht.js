'use strict';
// SUND-04a-2 P1: Frachtauftrag light, NUR Faden-intern (kein allgemeines Auftragssystem, das kommt in 04b).
// Ein Beat „fracht“ (Baustein fracht) laedt eine Ware des NSC (Daten: content/faeden/szenen-werte.json, waren) und liefert sie am Zielhafen ab.
// Die Ware steht als eigenes Feld im Fadenzustand (faden.fracht = { ware, von, nach, tick }), NICHT im Frachtraum (fracht.js) und NICHT im Handel:
// ein Frachtraum hat Plaetze, Beamen und Verlust bei Gefahr, das passt nicht zu einem Gegenstand ohne Gewicht. Gewicht 0 steht in den Daten.
//
//   laden(game, { fadenId, ware, vonHafen?, nachHafen })  -> { ok, grund? }   der laufende Beat „fracht“ bekommt die Ware (Hex-Codes; ware aus den Daten)
//   andocken(game)                                        Hook am Andock-Ereignis (game.js, missionEvent docked): liegt die Ware im Ziel-Hex, wird sie abgeliefert -> Ausgang gelungen
//   verloren(game, fadenId)                               die Ware geht verloren -> Ausgang gescheitert (Hook: Notsprung, game.js, über notsprung)
//   notsprung(game)                                       alle Waren an Bord gehen verloren (Hook in game.js, nach einem gelungenen Notfallsprung)
//   inventar(game)                                        die Waren an Bord, Name und Gewicht aus den Daten (nur Anzeige und Tests; kein Handel)
//   leseFracht(x)                                         Lesen aus dem Weltstand (muellfest): null bei unbrauchbaren Feldern
// Frist und Scheitern kommen aus dem Beat-Takt (beat_frist Taetigkeiten, faden.js): die Ware wird beim Ende des Beats ohnehin aus dem Faden entfernt (faden.beatAusgang).
const Sektoren = require('../../shared/sektoren.js');
const W = require('../../content/faeden/szenen-werte.json').werte;

const HEX = /^\d{4}$/;
const WAREN = W.waren.wert;
let faden = null;   // lazy (Zirkelbezug faden.js -> faden-fracht.js)
const F = () => faden || (faden = require('./faden.js'));

function leseFracht(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const ware = typeof x.ware === 'string' && Object.prototype.hasOwnProperty.call(WAREN, x.ware) ? x.ware : null;
  const nach = typeof x.nach === 'string' && HEX.test(x.nach) ? x.nach : null;
  const von = typeof x.von === 'string' && (x.von === '' || HEX.test(x.von)) ? x.von : '';
  if (!ware || !nach) return null;
  return { ware, von, nach, tick: Number.isFinite(x.tick) && x.tick >= 0 ? Math.floor(x.tick) : 0 };
}

function laden(game, o) {
  const q = o || {};
  if (!F().aktiv(game)) return { ok: false, grund: 'INAKTIV' };
  const f = F().zustandVon(game).liste.find((x) => x.id === q.fadenId);
  if (!f || f.phase !== 'laeuft' || !f.laufend) return { ok: false, grund: 'kein laufender Beat' };
  if (f.fracht) return { ok: false, grund: 'schon eine Ware an Bord' };
  const ware = q.ware || 'fracht_kiste';
  if (!Object.prototype.hasOwnProperty.call(WAREN, ware)) return { ok: false, grund: 'unbekannte Ware' };
  const hex = Sektoren.hexVonOrt(game.ship.scene) || '';
  const von = q.vonHafen !== undefined ? q.vonHafen : hex;
  const fr = leseFracht({ ware, von, nach: q.nachHafen, tick: game.weltsim.tickZahl });
  if (!fr) return { ok: false, grund: 'Zielhafen ungültig' };
  f.fracht = fr;
  return { ok: true, grund: null };
}

// Abliefern: der Faden liegt im Ziel-Hex und der Beat „fracht“ laeuft. Beim Andocken im Zielhafen gilt die Ware als abgeliefert.
function andocken(game) {
  if (!F().aktiv(game)) return [];
  const hex = Sektoren.hexVonOrt(game.ship.scene);
  const out = [];
  for (const f of F().zustandVon(game).liste.slice()) {
    if (!f.fracht || f.phase !== 'laeuft' || f.fracht.nach !== hex) continue;
    out.push(f.id);
    F().beatAusgang(game, f.id, 'gelungen');
  }
  return out;
}

function verloren(game, fadenId) {
  if (!F().aktiv(game)) return { ok: false, grund: 'INAKTIV' };
  const f = F().zustandVon(game).liste.find((x) => x.id === fadenId);
  if (!f || !f.fracht || f.phase !== 'laeuft') return { ok: false, grund: 'keine Ware an Bord' };
  F().beatAusgang(game, f.id, 'gescheitert');   // der Ausgang entfernt die Ware (faden.beatAusgang)
  return { ok: true, grund: null };
}

// Notsprung: jede Ware an Bord geht verloren (Hook in game.js bei einem Notsprung)
function notsprung(game) {
  if (!F().aktiv(game)) return [];
  const out = [];
  for (const f of F().zustandVon(game).liste.slice()) if (f.fracht && f.phase === 'laeuft') { out.push(f.id); verloren(game, f.id); }
  return out;
}

function inventar(game) {
  const ws = game && game.weltsim; const liste = ws && ws.faeden ? ws.faeden.liste : [];
  return liste.filter((f) => f.fracht).map((f) => ({ faden: f.id, id: f.fracht.ware, name: WAREN[f.fracht.ware].name, gewicht: WAREN[f.fracht.ware].gewicht, nach: f.fracht.nach }));
}

module.exports = { laden, andocken, verloren, notsprung, inventar, leseFracht, WAREN };
