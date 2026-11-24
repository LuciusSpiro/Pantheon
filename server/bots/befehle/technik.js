'use strict';
// BOT-01 C2b: Registry der Bot-Befehle fuer die Rolle technik (Vertrag Bot-Befehle, Katalog v1). Jede Funktion: (game, bot, args) => { ok: true } | { ok: false, code }.
// Codes (content/bots/gruende.json): nicht_jetzt (geht in dieser Lage nicht), system (System oder Station ausgefallen bzw. nicht eingebaut). Alles andere zaehlt C1 als Fehler.
// Schichten: die Registry prueft Voraussetzungen und setzt gehaltene Einstellungen (prio, schild) als Absicht des Agenten bzw. sendet die Einmal-Aktionen (reparieren, energie, ueberladen) ueber ihn (einmalig, Wachposten).
// Die Ausfuehrung liegt im Agenten (server/bots/mannschaft.js: schildHalten, queueRepairs). args kommen normalisiert aus der Annahme: ziel feuer|leck|<system>, system <Spiel-ID>, sektor bug|stb|heck|bb, delta 1|-1 (Zahl).
const Station = require('../../sim/station.js');
const interior = require('../../sim/interior.js');
const Lauf = require('../lauf.js');

const NICHT_JETZT = { ok: false, code: 'nicht_jetzt' };
const SYSTEM = { ok: false, code: 'system' };
const OK = { ok: true };

const aus = (st) => st === 'broken' || st === 'offline';
const SEKTOR = { bug: 0, stb: 1, heck: 2, bb: 3 };   // Sektor-Index der Schilde (Bug, Steuerbord, Heck, Backbord)
const PRIO = { feuer: 'fire', leck: 'breach' };

// Gemeinsame Vorpruefung. o.station: der Bot muss jetzt an der Technik-Konsole sitzen (Einmal-Aktionen gehen als cmd sofort raus). -> { agent } oder { fehler }
function vorab(game, bot, o) {
  const agent = Lauf.agent(game, bot);
  if (!agent || bot.downed || bot.zone !== 'ship') return { fehler: NICHT_JETZT };
  if (o.station && Station.stationOf(bot) !== 'technik') return { fehler: NICHT_JETZT };
  return { agent };
}
// Zustand eines Systems fuer die Pruefung (Altname weapons = alle drei Waffen: nur ausgefallen, wenn jede aktive Waffe es ist)
function systemAus(game, sys) {
  if (sys === 'weapons') { const w = interior.WEAPON_SYSTEMS.filter((s) => interior.systemAktiv(game, s)); return w.length > 0 && w.every((s) => aus(game.ship.systems[s])); }
  return aus(game.ship.systems[sys]);
}

const tech = {};

// feuer/leck: Prioritaet der Schrauber; <system>: dieses System zuerst. Gehalten, bis bot.automatik, ein anderer tech.prio, die Menschenuebernahme oder das Ende der Partie (die Standard-Prioritaeten sind dann aus).
tech['tech.prio'] = (game, bot, args) => {
  const v = vorab(game, bot, {});
  if (v.fehler) return v.fehler;
  const wert = PRIO[args.ziel] || args.ziel;
  if (!PRIO[args.ziel]) {
    if (!interior.systemAktiv(game, wert)) return SYSTEM;
    if (game.ship.systems[wert] === 'ok' && !interior.isFragile(game, wert)) return NICHT_JETZT;   // nichts zu reparieren
  }
  v.agent.haltenSetzen('prio', { wert });
  return OK;
};

// Reparaturliste (technik.repair): Ersatzteil, wenn das System zerstoert ist und eines im Lager liegt, sonst Flicken (wie die Standard-Technik). Liste voll oder System heil: nicht_jetzt.
tech['tech.reparieren'] = (game, bot, args) => {
  const v = vorab(game, bot, { station: true });
  if (v.fehler) return v.fehler;
  if (!interior.systemAktiv(game, args.system)) return SYSTEM;   // Lafette/Modul nicht eingebaut
  const mode = game.ship.systems[args.system] === 'broken' && game.inventory.ersatzteil > 0 ? 'part' : 'flick';
  return v.agent.einmalig('technik.repair', { system: args.system, mode }) ? NICHT_JETZT : OK;
};

// Schild auf den Sektor verlagern: der Agent schiebt Punkte dorthin (bis zur Bot-Obergrenze) und haelt das, statt der Verteilung nach Bedrohung. Schilde oder der Emitter dieses Sektors ausgefallen: system.
tech['tech.schild'] = (game, bot, args) => {
  const v = vorab(game, bot, {});
  if (v.fehler) return v.fehler;
  const sek = SEKTOR[args.sektor];
  if (aus(game.ship.systems.shields) || aus(game.ship.systems[['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'][sek]])) return SYSTEM;
  v.agent.haltenSetzen('schild', sek);
  return OK;
};

// Energie +1/-1 auf ein Hauptsystem (technik.power; die Standard-Technik verteilt nie Energie, die Einstellung bleibt, bis ein Mensch oder ein Gegenbefehl sie aendert). Grenze/Reaktor ausgelastet: nicht_jetzt.
tech['tech.energie'] = (game, bot, args) => {
  const v = vorab(game, bot, { station: true });
  if (v.fehler) return v.fehler;
  if (systemAus(game, args.system)) return SYSTEM;
  return v.agent.einmalig('technik.power', { sys: args.system, delta: args.delta }) ? NICHT_JETZT : OK;
};

// Der Server fuehrt aus (Nachfrage/Bestaetigung macht nur der Client). Reaktor ausgefallen: system; schon ueberladen oder in Pause: nicht_jetzt.
tech['tech.ueberladen'] = (game, bot) => {
  const v = vorab(game, bot, { station: true });
  if (v.fehler) return v.fehler;
  if (aus(game.ship.systems.reactor)) return SYSTEM;
  return v.agent.einmalig('technik.overload') ? NICHT_JETZT : OK;
};

module.exports = tech;
