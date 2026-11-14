'use strict';
// WRK-01 B (Nacharbeit): gemeinsamer Rahmen der Boden-Beats (landung, wrack, spaeter rettung). Action-Layer-Teile, die jeder Beat am Boden-Verteiler (faden-boden.js) braucht: der laufende Beat, der Ort (Landeplatz), "niemand mehr unten", die Besetzung (Tabelle besetzung in content/faeden/boden-werte.json), Funk-Formatierung und das Logbuch der Regie.
// Kein Beat-Wissen: die Beats reichen ihre Art mit (laufenderBeatArt, besetzenFuer) bzw. den Namen ihres Fehlerzaehlers (logbuch), damit ein Fehler im Logbuch eines Beats unter dem Namen DIESES Beats gezaehlt wird (faden-landung-logbuch, faden-wrack-logbuch).
const D = require('./faden-daten.js');
const Sektoren = require('../../shared/sektoren.js');
const W = require('../world.js');
const WERTE = require('../../content/faeden/boden-werte.json').werte;

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (has(v, k) ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };
const Orte = () => require('./abenteuer-orte.js');
const Landepunkte = () => require('./landepunkte.js');
const Combat = () => require('./combat.js');

// Logbuch der Regie. wo = Zaehlername des rufenden Beats (z. B. 'faden-wrack'); ein Fehler beim Schreiben laeuft unter wo + '-logbuch'
const logbuch = (game, e, wo) => { try { require('./regie-befehle.js').schreibe(game, Object.assign({ art: 'faden_baustein', quelle: 'regie' }, e)); } catch (err) { fehlerZaehlen(game, wo + '-logbuch', err); } };

// Der laufende Beat dieses Fadens, wenn er ein Beat der Art ist (sonst null)
function laufenderBeatArt(f, art) {
  if (!f || f.phase !== 'laeuft' || !f.laufend) return null;
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat || beat.id !== f.laufend.beat || beat.typ !== art || f.laufend.variante) return null;
  return beat;
}
// Karten-Id des Landeplatzes dieses Beats (nur solange der Ort da ist), sonst null
function ortVon(game, f, beat) {
  const id = beat && beat.parameter ? beat.parameter.landeplatz : undefined;
  return typeof id === 'string' ? Orte().landeplatzVon(game, f.id, id) : null;
}
// Name des Landeplatzes fuer den Funk: der Name im Plan, sonst der Standardname der Kartenart (abenteuer-orte.json)
function platzName(f, beat) {
  const id = beat.parameter.landeplatz;
  const def = ((f.plan && f.plan.landeplaetze) || []).find((x) => x && x.id === id);
  return (def && def.name) || (def && Orte().DATEN.standardname[def.art]) || 'Landeplatz';
}
// game-weit: ein away, alle Spieler teilen die Karte (wie abenteuer-orte.unten)
const niemandUnten = (game, lp) => !(game.players || []).some((p) => p.zone === 'away' && game.away && game.away.map === lp);

// ---------- Besetzung (idempotent je Karte)
const besetztAn = (game, lp) => { const aw = game.aways && game.aways[lp]; return !!(aw && W.AWAY_MAPS[lp] && aw.besetzt && aw.besetzt[WERTE.besetzung_tag.wert]); };   // lebende Karte: nach landepunkte.zuruecksetzen steht das alte Objekt noch in game.aways, ist aber nicht mehr registriert
const besetzungsSchluessel = (beat) => {
  const k = beat && beat.parameter && beat.parameter.besetzung;
  return typeof k === 'string' && has(WERTE.besetzung.wert, k) ? k : WERTE.besetzung_standard.wert;
};
const besetzungVon = (beat) => WERTE.besetzung.wert[besetzungsSchluessel(beat)];   // {} = keine Besetzung
const verlangt = (e) => !!e && typeof e.fraktion === 'string';
// Direkt nach dem Beat-Start ist die Karte meist noch nicht gebaut (landepunkte baut ausserhalb des Ticks): sobaldGeladen fuehrt die Besetzung sofort aus, wenn die Karte registriert werden kann, sonst bei der Registrierung (ein Schluessel je Karte, nie doppelt). Der Merker (besetzt) macht combat.besetzen je Karte idempotent. -> Zahl der Gegner, wenn sie jetzt entstanden sind (0: spaeter, nicht verlangt oder schon besetzt)
// art = Katalogtyp des rufenden Beats (Schluessel der Registrierung und Name im Fehlerzaehler)
function besetzenFuer(game, beat, lp, art) {
  const e = besetzungVon(beat), schluessel = besetzungsSchluessel(beat);
  if (!verlangt(e) || besetztAn(game, lp)) return 0;
  let n = 0;
  const stand = Landepunkte().sobaldGeladen(game, lp, art, () => {
    if (besetztAn(game, lp)) return;
    n = Combat().besetzen(game, { map: lp, fraktion: e.fraktion, staerke: e.staerke, haltung: e.haltung, tag: WERTE.besetzung_tag.wert });
    if (n <= 0) fehlerZaehlen(game, 'faden-' + art, new Error(`Besetzung ${schluessel} an ${lp} ergab keinen Gegner`));
  });
  if (stand === 'unbekannt') fehlerZaehlen(game, 'faden-' + art, new Error(`Landeplatz ${lp} ist dem Spiel unbekannt, keine Besetzung`));
  return n;
}

module.exports = { has, fmt, hexName, logbuch, laufenderBeatArt, ortVon, platzName, niemandUnten, besetzungsSchluessel, besetzungVon, besetzenFuer, WERTE };
