'use strict';
// BOD-02 P4: Stellungen und Sichtbonus (Server). Regeln und Raster stehen in shared/stellung.js (Client rechnet dasselbe);
// hier die Anbindung an die laufende Außenkarte und CONFIG.awayCombat. Folgepakete (Halten, Rückzug, BOD-03 Bunkerscharten) nutzen:
//   istIn(karte, tx, ty)              Kachel liegt in einer Stellung (Bereich mit rolle 'stellung')
//   plaetze(karte[, solid])           [{ x, y, posten }] alle Stellungsplätze; solid(tx,ty) filtert Unbegehbares (z. B. E.solid)
//   karteVon(game)                    gebaute Karte des aktuellen Landepunkts (null bei Handkarten)
//   sichtKacheln(game, k)             Sichtradius in Kacheln für einen Kämpfer (10 / Stellung 16 / Posten 22)
//   engageBox(game, k)                Schussfenster { w, h } px, skaliert mit sichtKacheln / sightTiles
//   inStellung(game, k)               steht k jetzt in einer Stellung (inkl. Posten)?
const Shared = require('../../shared/stellung.js');
const W = require('../world.js');

function karteVon(game) {
  const id = game && game.away && game.away.map;
  const e = id && W.AWAY_MAPS[id];
  return (e && e.karte) || null;
}
function cfgVon(game) {
  const C = (game.C && game.C.awayCombat) || {};
  return { normal: Number(C.sightTiles) || 10, stellung: Number(C.sicht && C.sicht.stellung) || 0, aussicht: Number(C.sicht && C.sicht.aussicht) || 22 };
}
function sichtKacheln(game, k) {
  const karte = karteVon(game);
  const c = cfgVon(game);
  if (!karte || !k) return c.normal;
  return Shared.sichtKacheln(karte, k.x, k.y, c);
}
function engageBox(game, k) {
  const box = game.C.awayCombat.engageBox;
  const c = cfgVon(game);
  const f = Shared.faktor(sichtKacheln(game, k), c.normal);
  return f === 1 ? box : { w: box.w * f, h: box.h * f };
}
function inStellung(game, k) {
  const karte = karteVon(game);
  return !!(karte && k && (Shared.istIn(karte, Math.floor(k.x / 32), Math.floor(k.y / 32)) || Shared.amPosten(karte, k.x, k.y)));
}

module.exports = { istIn: Shared.istIn, plaetze: Shared.plaetze, rects: Shared.rects, karteVon, sichtKacheln, engageBox, inStellung, ROLLE: Shared.ROLLE };
