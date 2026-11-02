'use strict';
// OPS-01 C1: Anzeigeziel des Captains. Der Captain wählt selbst, welches Ziel er im Zielkasten ansieht (gescannter Gegner, Station, aufgedecktes verstecktes Objekt –
// dieselben IDs wie weapons.target). Es ist ein EIGENER Zustand: ship.target (Ziel der Ops) ändert sich dadurch nie, und die Ops-Anwahl ändert dieses Ziel nicht.
//   - ship.capZiel = { id, scene } (flüchtig, nicht im Weltstand; scene verwirft das Ziel nach einem Szenenwechsel, ohne dass space.js es löschen muss).
//   - gueltig(game) prüft zur Snapshot-Zeit, ob das Ziel noch existiert; stirbt ein Gegner, leert sich das Feld dort (konvoi.js/gegnertod.js bleiben unberührt).
//   - Der Captain scannt nicht selbst: Details (Zonen, Systeme, Wahl) gibt es nur, wenn das Ziel schiffsweit gescannt ist (e.scanned, derselbe Scan wie bei den Ops).
// Befehl: captain.anzeigeziel { id | null } (game.js, Konsole 'captain'). Snapshot: ship.cz.
const Space = require('./space.js');
const Station = require('./station.js');
const Sonden = require('./sonden.js');
const { dist } = require('../util.js');

function loeschen(game) { delete game.ship.capZiel; }

// Befehl: Ziel wählen. null/leer löscht. Ungültig (unbekannt, außer Sensorreichweite) lehnt ab UND löscht das bisherige Ziel. Gleiche Regeln wie space.weaponsTarget.
function setzen(game, id) {
  if (id === null || id === undefined || id === '') { loeschen(game); return null; }
  const rt = Space.resolveTarget(game, id);
  if (!rt) { loeschen(game); return 'Ziel nicht gefunden.'; }
  if ((rt.type === 'enemy' || rt.type === 'mine') && dist(game.ship.x, game.ship.y, rt.x, rt.y) > Space.sensorReichweite(game) && !Sonden.sieht(game, rt.x, rt.y)) {
    loeschen(game); return 'Ziel außerhalb der Sensoren.';
  }
  game.ship.capZiel = { id, scene: game.ship.scene };
  return null;
}

// Existiert das Ziel noch (und gilt es in dieser Szene)? Sonst wird es geleert. Gibt das Ziel oder null.
function gueltig(game) {
  const cz = game.ship.capZiel;
  if (!cz) return null;
  if (!game.space || cz.scene !== game.ship.scene || !Space.resolveTarget(game, cz.id)) { loeschen(game); return null; }
  return cz;
}

// Snapshot-Zeile ship.cz: nur bei gesetztem, gültigem Ziel und besetztem Captain-Pult.
//   { id }                       Ziel ungescannt, kein Gegner oder identisch mit dem Ops-Ziel (der Client nimmt dann zielSys/zielZon/zielWahl der Ops)
//   { id, sys, zon, wahl }       gescannter Gegner mit Systemmodell: wie zielSys/zielZon/zielWahl (game.zielDetail)
function snapshot(game) {
  if (!game.ship.capZiel || !Station.stationBesetzt(game, 'captain')) return null;
  const cz = gueltig(game);
  if (!cz) return null;
  if (cz.id === game.ship.target) return { id: cz.id };
  const e = game.space.enemies.find((q) => q.id === cz.id);
  const d = e ? game.zielDetail(e) : null;
  return d ? { id: cz.id, sys: d.zielSys, zon: d.zielZon, wahl: d.zielWahl } : { id: cz.id };
}

module.exports = { setzen, loeschen, gueltig, snapshot };
