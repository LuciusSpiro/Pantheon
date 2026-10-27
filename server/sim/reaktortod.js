'use strict';
// SYS-01 A2a „Tod der Lerche“ (Kai, 2026-10-26): Reaktor zerstört = Countdown, dann zerstört das Schiff.
//   zerstoert(game, opts)  – der Reaktor ist zerstört (interior.damageSystem): Ausfallzähler +1, Countdown startet.
//                            Keine Wirkung in einer Übung (game.mission.isDrill()), bei game.god und bei opts.debug (Debug-Befehle).
//   update(game, dt)       – Countdown läuft mit dt (nur im Spielzweig von game.step: die Solo-Menüpause hält ihn an). Ist der Reaktor nicht mehr zerstört,
//                            endet er (gerettet, der Zähler bleibt). Läuft er ab, ist das Schiff zerstört: Naht space.verlustAusloesen
//                            (Verbraucher wie beim Notfallprotokoll) plus Ereignis schiffZerstoert und ship.schiffZerstoert.
//   zuruecksetzen(game)    – jeder Sprung (normal, Notsprung) und jede Szene, die die Lerche neu aufstellt: Zähler 0, Countdown aus, Zerstört-Flag aus (Alias sprungZurueck).
//   dauer(game, n)         – Countdown des n-ten Ausfalls seit dem letzten Sprung: start × faktor^(n−1), mindestens minimum (s).
//   snapshot(game)         – ship.reaktorTod { rest (Zehntelsekunden, -1 kein Countdown), n, dauer (s, Countdown dieses Ausfalls), next (s, Countdown des nächsten), tot: 1 nach dem Tod }.
//   SYS-01 A2b: der Tod bleibt gelatcht (game.zerstoertOffen, bis die Partie in der Lobby ist): Szene von vorn und Sprung setzen den Zerstört-Flag nicht zurück.
// Sitzungszustand: Countdown und Zähler stehen nicht im Weltstand (der speichert nur die Systemzustände).
const interior = require('./interior.js');

function cfg(game) { return game.C.reaktorTod; }
function gilt(game) {
  const m = game.mission;
  return !(m && typeof m.isDrill === 'function' && m.isDrill()) && !game.god;
}
function dauer(game, n) {
  const C = cfg(game);
  return Math.max(C.minimum, C.start * Math.pow(C.faktor, Math.max(0, n - 1)));
}

// Der Reaktor ist eben zerstört geworden (wird aus interior.damageSystem gerufen, nur beim Übergang auf zerstört)
function zerstoert(game, opts) {
  if (opts && opts.debug) return null;
  if (!gilt(game)) return null;
  const ship = game.ship;
  ship.reaktorAusfaelle = (ship.reaktorAusfaelle || 0) + 1;
  const t = dauer(game, ship.reaktorAusfaelle);
  ship.reaktorCountdown = { t };
  game.oda(`Reaktor zerstört! In ${Math.round(t * 10) / 10} s ist das Schiff verloren. Reparatur am Reaktor (E halten) oder Notsprung!`, null);
  return t;
}

// Countdown läuft ab: das Schiff ist zerstört. Die Naht ruft die Verbraucher des Notfallprotokolls (Zähler stats.emergencies, Ereignis emergency).
function tod(game) {
  const ship = game.ship;
  const n = ship.reaktorAusfaelle || 0;
  ship.reaktorCountdown = null;
  ship.schiffZerstoert = true;
  game.zerstoertOffen = { ok: new Set() };   // SYS-01 A2b: Einblendung bis OK (zerstoertOk) bzw. Lobby; Weltstand wird dabei nicht gespeichert
  game.emit('schiffZerstoert', { grund: 'reaktor', n });
  require('./space.js').verlustAusloesen(game, 'reaktor');
}

function update(game, dt) {
  const ship = game.ship;
  const cd = ship.reaktorCountdown;
  if (!cd) return;
  if (interior.effZustand(game, 'reactor') !== 'broken') {   // gerettet: Reparatur auf beschädigt (oder Ersatz durch andere Wege)
    ship.reaktorCountdown = null;
    game.oda('Reaktor wieder ganz – der Countdown ist aus.', null);
    return;
  }
  if (!gilt(game)) { ship.reaktorCountdown = null; return; }   // Übung oder Gottmodus: kein Tod
  cd.t -= dt;
  if (cd.t > 0) return;
  tod(game);
}

// Zähler 0, Countdown aus, Zerstört-Flag aus: nach jedem Sprung und wenn eine Szene die Lerche neu aufstellt (szenenreset.js, arena.js)
function zuruecksetzen(game) {
  const ship = game.ship;
  ship.reaktorAusfaelle = 0;
  ship.reaktorCountdown = null;
  if (!game.zerstoertOffen) ship.schiffZerstoert = false;   // SYS-01 A2b: der Tod bleibt bis zur Lobby
}

function snapshot(game) {
  const ship = game.ship;
  const cd = ship.reaktorCountdown;
  const n = ship.reaktorAusfaelle || 0;
  const o = { rest: cd ? Math.max(0, Math.round(cd.t * 10)) : -1, n, dauer: Math.round(dauer(game, Math.max(1, n)) * 10) / 10, next: Math.round(dauer(game, n + 1) * 10) / 10 };
  if (ship.schiffZerstoert) o.tot = 1;
  return o;
}

const sprungZurueck = zuruecksetzen;

module.exports = { zerstoert, update, zuruecksetzen, sprungZurueck, snapshot, dauer, gilt };
