'use strict';
// SUND-04a-2 P1: Frachtauftrag light, NUR Faden-intern (kein allgemeines Auftragssystem, das kommt in 04b).
// Ein Beat „fracht“ (Baustein fracht) laedt eine Ware des NSC (Daten: content/faeden/szenen-werte.json, waren) und liefert sie am Zielhafen ab.
// Die Ware steht als eigenes Feld im Fadenzustand (faden.fracht = { ware, von, nach, tick }), NICHT im Frachtraum (fracht.js) und NICHT im Handel:
// ein Frachtraum hat Plaetze, Beamen und Verlust bei Gefahr, das passt nicht zu einem Gegenstand ohne Gewicht. Gewicht 0 steht in den Daten.
//
//   laden(game, { fadenId, ware, vonHafen?, nachHafen })  -> { ok, grund? }   der laufende Beat „fracht“ bekommt die Ware (Hex-Codes; ware aus den Daten). Nacharbeit SUND-04a-2 (F6): der Zielhafen muss
//                                                         ANDOCKBAR sein (sonst ok false, nie eine Scheinfracht), die Crew hoert „Ware an Bord: <Ware> fuer <Hafenname>“ (Funk, Daten szenen-werte texte.fracht)
//   zielFuer(game, ort) -> Hex | null                     der naechste andockbare roemische/Konkordat-Hafen in Reichweite (Daten fracht_reichweite) um den Ort (Hex-Abstand, bei Gleichstand kleinerer Code);
//                                                         die Liste der andockbaren Orte kommt aus Karte, Szene (dock) und Besitz, nie aus dem Code
//   andockbar(game, hex) -> bool                          hat der Hex einen Hafen mit Liegeplatz, gehoert er Rom oder dem Konkordat (Besitz-Overlay zaehlt)
//   verlustMelden(game, faden)                            Funk „Die Ware ist verloren“ (Hook in faden.beatAusgang, wenn ein Beat mit Ware scheitert)
//   andocken(game)                                        Hook am Andock-Ereignis (game.js, missionEvent docked): liegt die Ware im Ziel-Hex, wird sie abgeliefert -> Ausgang gelungen
//   verloren(game, fadenId)                               die Ware geht verloren -> Ausgang gescheitert (Hook: Notsprung, game.js, über notsprung)
//   notsprung(game)                                       alle Waren an Bord gehen verloren (Hook in game.js, nach einem gelungenen Notfallsprung)
//   inventar(game)                                        die Waren an Bord, Name und Gewicht aus den Daten (nur Anzeige und Tests; kein Handel)
//   leseFracht(x)                                         Lesen aus dem Weltstand (muellfest): null bei unbrauchbaren Feldern
// Frist und Scheitern kommen aus dem Beat-Takt (beat_frist Taetigkeiten, faden.js): die Ware wird beim Ende des Beats ohnehin aus dem Faden entfernt (faden.beatAusgang).
const Sektoren = require('../../shared/sektoren.js');
const Besitz = require('./besitz.js');
const Locations = require('../../shared/locations.js');
const DATEN = require('../../content/faeden/szenen-werte.json');
const W = DATEN.werte, TX = DATEN.texte;

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

// ---------- Ziel (Nacharbeit F6)
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
function andockbar(game, hex) {
  const d = Sektoren.hexDaten(hex);
  if (!d || !d.hafen) return false;
  if (!W.fracht_ziel_fraktionen.wert.includes(Besitz.besitzer(game, hex))) return false;
  const ort = Sektoren.ortVonHex(hex), l = ort && Locations.get(ort);
  return !!(l && l.scene && Besitz.dockLage(game, l.scene, hex));
}
function zielFuer(game, ort) {
  if (typeof ort !== 'string' || !HEX.test(ort) || !Sektoren.imRaster(ort)) return null;
  const dist = new Map([[ort, 0]]);
  let rand = [ort];
  for (let d = 1; d <= W.fracht_reichweite.wert; d++) {
    const neu = [];
    for (const h of rand) for (const n of Sektoren.nachbarn(h)) if (!dist.has(n)) { dist.set(n, d); neu.push(n); }
    rand = neu;
  }
  const reihe = Array.from(dist.entries()).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  for (const [hex] of reihe) if (andockbar(game, hex)) return hex;
  return null;
}

// ---------- Funk (Sprecher aus den Daten: dieselbe Aufklaerung wie die Szenen; Lagefunk, an alle)
const bitte = () => require('./faden-bitte.js');
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
function funk(game, key, v) {
  try { return bitte().funkSprecher(game, TX.sprecher, fmt(TX.fracht[key], v)); } catch (e) { if (game && game.countError) game.countError('faden-fracht-funk', e); return null; }
}
const frachtVars = (fr, extra) => Object.assign({ ware: WAREN[fr.ware].name, hafen: hexName(fr.nach) }, extra || {});
function verlustMelden(game, f) {
  if (f && f.fracht) funk(game, 'verloren', frachtVars(f.fracht));
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
  if (!andockbar(game, fr.nach)) return { ok: false, grund: 'Zielhafen nicht andockbar' };   // nie eine Scheinfracht: die Crew koennte dort nicht abliefern
  f.fracht = fr;
  funk(game, 'laden', frachtVars(fr));
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
    funk(game, 'abgeliefert', frachtVars(f.fracht));
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

module.exports = { laden, andocken, verloren, notsprung, inventar, leseFracht, zielFuer, andockbar, verlustMelden, funk, WAREN };
