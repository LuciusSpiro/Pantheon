'use strict';
// R1 (CONTRACT-ROLLEN §4.4): Stationen = aktive Interfaces. `p.console` ist der ORT (physische Konsole: Exklusivität, Verlassen,
// Kollision), `p.station` das aktive Interface (null = wie der Ort). Tab/Shift+Tab schaltet nur das Interface; der Spieler bleibt stehen.
// Dieses Modul ist die einzige Stelle, die „welche Station bedient dieser Spieler“ beantwortet (Rechteprüfung in game.onCmd,
// Besetzt-Prüfungen in space/fracht/away/wellen/mission). Es lädt weder interior noch space (kein Zirkelbezug).
const Protocol = require('../../shared/protocol.js');

const KREIS = Protocol.STATION_KREIS;
const NAME = { helm: 'Navigation', weapons: 'Taktik', captain: 'Captain', technik: 'Technik' };

// Aktives Interface des Spielers; ohne Konsole null (ein veraltetes p.station zählt nie).
function stationOf(p) {
  if (!p || !p.console) return null;
  return p.station || p.console;
}
// Hält ein verbundener Spieler (außer `ausser`) die Station als aktives Interface?
function halter(game, kind, ausser) {
  return game.players.find((o) => o !== ausser && o.connected && stationOf(o) === kind) || null;
}
function stationBesetzt(game, kind) { return !!halter(game, kind, null); }
function stationName(kind) { return NAME[kind] || kind; }
function verbunden(game) { return game.players.filter((p) => p.connected).length; }

// Aufräumen, wenn ein Interface verlassen wird (Tab weg oder Konsole verlassen): was nur bei Bedienung läuft, endet.
// Hält ein anderer Spieler dieselbe Station (kann nicht vorkommen, schützt aber den Zustand), bleibt alles.
function stationFreigeben(game, kind, p) {
  if (!kind || halter(game, kind, p)) return;
  const ship = game.ship;
  if (kind === 'helm') { ship.helm.turn = 0; ship.helm.thrust = 0; }
  if (kind === 'captain') ship.scanning = false;
  if (kind === 'weapons') ship.tscan.on = false;
}

// Tab (dir 1) / Shift+Tab (dir -1): nächste freie Station im Kreis. Rückgabe: Fehlertext oder null.
function tab(game, p, dir) {
  if (p.zone !== 'ship' || p.downed || p.beamLock) return 'Hier lässt sich nichts umschalten.';
  if (!p.console || !KREIS.includes(p.console)) return 'Stationswechsel geht nur an Steuer, Taktik, Captain- oder Technik-Konsole.';
  const von = stationOf(p);
  const i0 = KREIS.indexOf(von);
  const d = dir < 0 ? -1 : 1;
  const belegt = [];
  for (let k = 1; k < KREIS.length; k++) {
    const kind = KREIS[(i0 + d * k + KREIS.length * 2) % KREIS.length];
    const h = halter(game, kind, p);
    if (h) { belegt.push(`${stationName(kind)}: durch ${h.name} besetzt`); continue; }
    stationFreigeben(game, von, p);
    p.station = kind === p.console ? null : kind;
    game.emit('sfx', { name: 'ui_click', zone: p.zone, x: Math.round(p.x), y: Math.round(p.y) });
    return null;
  }
  return belegt.length ? belegt.join(' · ') : 'Keine andere Station frei.';
}

// Snapshot: nur bei Abweichung vom Ort (Budget)
function snapFelder(p) {
  return p.console && p.station && p.station !== p.console ? { station: p.station } : {};
}

// Waffenautomatik (§4.5): nur bei 1 oder 2 verbundenen Spielern UND unbesetzter Taktik.
function waffenAutomatikAktiv(game) {
  return verbunden(game) <= game.C.waffenAutomatikMaxSpieler && !stationBesetzt(game, 'weapons');
}
// Bot-Automatik der Technik (§4.5): an bei genau 1 oder 2 verbundenen Spielern.
function botAutomatikStandard(game) {
  const n = verbunden(game);
  return n >= 1 && n <= game.C.botAutomatikMaxSpieler;
}

module.exports = { KREIS, stationOf, halter, stationBesetzt, stationName, stationFreigeben, tab, snapFelder, waffenAutomatikAktiv, botAutomatikStandard, verbunden };
