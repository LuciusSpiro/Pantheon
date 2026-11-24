'use strict';
// BOT-01 C2a: Ziele der Navigations-Befehle (Katalog v1: nav.kurs, nav.abstand, nav.andocken). Nur lesen, nie schreiben; kein Zustand.
// Die Aufloesung nimmt das Vorhandene: Captain-Marke (CaptainZiel), Ops-Marke (ship.target), Dock und Station der Szene (Besitz.dockLage, Szenendaten), Objekte per space.resolveTarget.
//   aufloesen(game, name)    name = marke | ziel | basis | objekt:<id> -> { art, id?, dock? } oder null (hex:<id> ist kein Ziel in der Szene: null)
//   standort(game, z)        aktuelle Lage des Ziels { x, y, typ, obj? } oder null (Ziel gibt es nicht mehr)
//   dockLage(game)           Liegeplatz der Szene, wenn die Crew hier andocken darf, sonst null
//   stationLage(game)        Mitte der Station der Szene (sonst der Liegeplatz) oder null
const Locations = require('../../shared/locations.js');
const Sektoren = require('../../shared/sektoren.js');
const Space = require('../sim/space.js');
const CaptainZiel = require('../sim/captainziel.js');
const Besitz = require('../sim/besitz.js');

const OBJEKT = /^objekt:(.+)$/;

function ortHier(game) { const l = Locations.get(game.ship.scene); return l && l.scene ? l : null; }

function dockLage(game) {
  const l = ortHier(game);
  if (!l || !Besitz.dockbar(game, l.id)) return null;
  if (game.space && game.space.dockOk === false) return null;   // Besitzer verweigert das Andocken (space.updateFlight)
  return Besitz.dockLage(game, l.scene, l.hex || Sektoren.hexVonOrt(l.id)) || null;
}
function stationLage(game) {
  const l = ortHier(game);
  if (!l) return null;
  return l.scene.station || dockLage(game);
}

function aufloesen(game, name) {
  if (name === 'marke') { const cz = CaptainZiel.gueltig(game); return cz ? { art: 'objekt', id: cz.id } : null; }
  if (name === 'ziel') { const t = game.ship.target; return t != null && Space.resolveTarget(game, t) ? { art: 'objekt', id: t } : null; }
  if (name === 'basis') return dockLage(game) ? { art: 'basis' } : null;
  const m = typeof name === 'string' ? OBJEKT.exec(name) : null;
  if (m) return Space.resolveTarget(game, m[1]) ? { art: 'objekt', id: m[1] } : null;
  return null;   // hex:<id>: ein anderer Sektor, kein Ziel fuer Kurs und Abstand
}

// Lage jetzt. Kurs auf die Basis zielt auf den Liegeplatz, Abstand zur Basis misst von der Station.
function standort(game, z, fuer) {
  if (!z) return null;
  if (z.art === 'basis') { const p = fuer === 'abstand' ? stationLage(game) : dockLage(game); return p ? { x: p.x, y: p.y, typ: 'basis' } : null; }
  const rt = Space.resolveTarget(game, z.id);
  return rt ? { x: rt.x, y: rt.y, typ: rt.type, obj: rt.obj } : null;
}

module.exports = { aufloesen, standort, dockLage, stationLage };
