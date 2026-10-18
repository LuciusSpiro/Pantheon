'use strict';
// PAN-01 Paket A: Messung des Raumkampfs mit der ECHTEN Energie-Implementierung (Module, Standardverteilung, technik.module).
// Preload für sim-headless (die Bots stellen die Technik sonst nie um):
//   node -r ./tools/pan01-energie-preload.js tools/sim-headless.js arena --pilot maneuver --seeds 1 --seed N --players 3
// Umgebung:
//   PAN01_MODUL=start|voll|<id,id,…>  Bestückung beim Spielstart (start = Frachtraum + Krankenstation, 2/2/2; voll = 4 Module per Debug `modul voll` mit
//                                 Werkstatt, 1/2/1; oder eine Liste von Modul-IDs für die Räume 1…4, z. B. frachtraum,krankenstation,frachtraum,krankenstation)
//   PAN01_POWER=e,s,w             Hauptsysteme fest erzwingen (sonst gilt die Standardverteilung der Bestückung)
//   PAN01_KAMPF=aus:<id,id,…>[;e,s,w]   „Technik im Kampf“: Solange Gegner da sind, schaltet die Technik die genannten Module ab (je Art alle, z. B.
//                                 frachtraum,frachtraum) und legt die frei gewordene Energie wie angegeben auf die Hauptsysteme (ohne Angabe: Standard
//                                 der Restbestückung); ohne Gegner läuft wieder alles wie eingestellt. Das ist die Technik-Aufgabe „Modul abschalten, Energie umlegen“.
//   PAN01_NOHEAT=1                Hitze bei Stufe 4 aus (Gegenprobe)
// Werkzeug für die Messung, kein Spielcode.
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Modul = require('../server/sim/module.js');
const modulMode = process.env.PAN01_MODUL || '';
const powerSet = (process.env.PAN01_POWER || '').split(',').map(Number);
const kampf = process.env.PAN01_KAMPF ? process.env.PAN01_KAMPF.split(';') : null;
const kampfAus = kampf && kampf[0].startsWith('aus:') ? kampf[0].slice(4).split(',').filter(Boolean) : [];
const kampfPower = kampf && kampf[1] ? kampf[1].split(',').map(Number) : null;
if (process.env.PAN01_NOHEAT) CONFIG.power.heatAt4 = 0;
const step = Game.prototype.step;
Game.prototype.step = function () {
  const ship = this.ship;
  if (ship && this.phase !== 'lobby') {
    if (this.__pan01ship !== ship) {   // neues Schiff nach reset(): Bestückung setzen
      this.__pan01ship = ship; this.__pan01fight = false;
      if (modulMode === 'voll' || modulMode === 'start') Modul.debug(this, [modulMode]);
      else if (modulMode) { ship.module = []; for (const id of modulMode.split(',')) Modul.bestuecken(this, id); Modul.verteilungSetzen(this); }
    }
    const fight = this.space.enemies.some((e) => e.kind !== 'relay');
    if (kampf && fight !== this.__pan01fight) {
      this.__pan01fight = fight;
      if (fight) {
        const rest = kampfAus.slice();
        for (const m of ship.module) { const i = rest.indexOf(m.id); if (i >= 0) { rest.splice(i, 1); m.an = false; m.lauf = false; } }
        if (kampfPower) ship.powerIntent = { engines: kampfPower[0], shields: kampfPower[1], weapons: kampfPower[2] };
        else ship.powerIntent = Modul.standardVerteilung(this, Math.max(0, CONFIG.power.reactor - Modul.energieWunsch(this)));
      } else {
        for (const m of ship.module) m.an = true;
        Modul.verteilungSetzen(this);
      }
    }
    if (powerSet.length === 3 && powerSet.every(Number.isFinite)) ship.powerIntent = { engines: powerSet[0], shields: powerSet[1], weapons: powerSet[2] };
  }
  return step.apply(this, arguments);
};
