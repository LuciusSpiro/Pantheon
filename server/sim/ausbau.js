'use strict';
// PAN-01 Paket B: Ausbaustufe der Lerche (0–3) als Daten.
//
//   game.ship.stufe   0 Start (Waffen 8 · 4 · 6, Module in Raum 1 und 2) · 1 + Waffen 7 · 9, Modulraum 3, Lafettenbereich, Hecklift/Notleiter ins Unterdeck
//                     · 2 + Waffen 2 · 5, Modulraum 4 · 3 + Waffen 1 · 3 (neun Waffen, vier Module)
//
// Die Karte (shared/maps.js) hat alle Plätze und Räume von Anfang an; die Stufe öffnet sie: verschalte Pforten (SHIP_SEALS) werden begehbar, Waffenplätze
// (WAFFENPLAETZE) und Modulräume (MODUL_RAEUME) sind ab ihrer Stufe frei, Lift und Notleiter fahren ins Unterdeck (SHIP_LIFTS gate). In Paket B feuern die neuen
// Plätze noch nicht (Waffenkatalog: Paket C), die Werft (Paket D) setzt die Stufe gegen Marken; bis dahin gilt der Debug-Befehl `ausbau`.
//
// Weltstand: schiff.stufe (weltstand.js). Snapshot: ship.st (nur wenn > 0).
const W = require('../world.js');
const Modul = require('./module.js');

const Maps = W.Maps;
const clampStufe = (n) => Math.max(0, Math.min(Maps.STUFE_MAX, Math.round(Number(n)) || 0));

function stufe(game) { return (game.ship.stufe | 0); }
function plaetzeOffen(game) { return Maps.plaetzeOffen(stufe(game)); }
function modulRaeumeOffen(game) { return Maps.modulRaeumeOffen(stufe(game)); }
function platzOffen(game, platz) { const p = Maps.waffenplatz(platz); return !!p && stufe(game) >= p.stufe; }

// Wer in einem Raum steht, der bei der neuen Stufe zu ist, wird zum Bugweg gesetzt (nur beim Zurückstufen, Debug).
function raeumeRaeumen(game) {
  const st = stufe(game);
  const zu = (t) => { const r = Maps.roomAt(t.x, t.y); return !!(r && r.stufe && st < r.stufe); };
  const ziel = W.tileCenter(25, 38);
  for (const o of game.players.concat(game.bots)) {
    if (o.zone && o.zone !== 'ship') continue;
    if (zu({ x: Math.floor(o.x / 32), y: Math.floor(o.y / 32) })) { o.x = ziel.x; o.y = ziel.y; o.lift = null; o.liftDest = null; o.liftSel = null; if (o.path) o.path = null; if (o.task) o.task = null; }
  }
}

// Stufe setzen. Module in Räumen, die bei dieser Stufe noch zu sind, entfallen (Debug: zurückstufen); danach Standardverteilung der Energie.
function setStufe(game, n) {
  game.ship.stufe = clampStufe(n);
  const offen = modulRaeumeOffen(game);
  const liste = Modul.liste(game);
  for (let i = liste.length - 1; i >= 0; i--) if (!offen.includes(liste[i].raum)) liste.splice(i, 1);
  Modul.verteilungSetzen(game);
  raeumeRaeumen(game);
  game.emit('ausbau', { stufe: stufe(game) });
  return stufe(game);
}

function snapshot(game) { return stufe(game) || undefined; }
function toSave(game) { return stufe(game); }
// fehlt das Feld (Altstand): Start-Stufe
function restore(game, n) { game.ship.stufe = clampStufe(n); }

// Debug: ausbau [0..3]
function debug(game, args) {
  if (args[0] == null || args[0] === 'status') {
    const o = plaetzeOffen(game);
    game.log(`Ausbau: Stufe ${stufe(game)}, Waffenplätze ${o.join(' ')} (${o.length}), Modulräume ${modulRaeumeOffen(game).join(' ')}`);
    return null;
  }
  const n = Number(args[0]);
  if (!Number.isInteger(n) || n < 0 || n > Maps.STUFE_MAX) return `ausbau <0..${Maps.STUFE_MAX}>: Ausbaustufe (0 Start, 3 voll ausgebaut).`;
  setStufe(game, n);
  return null;
}

module.exports = { stufe, plaetzeOffen, modulRaeumeOffen, platzOffen, setStufe, snapshot, toSave, restore, debug };
