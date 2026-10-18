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
//   PAN01_WAFFEN=n<k>|<spec>      PAN-01 C: Bestückung der Waffenplätze beim Start. n3, n5, n7, n9 = die ersten k Plätze der Reihenfolge 8 4 6 7 9 5 1 3 2 mit Standardbestückung
//                                 (8 Lanze, Seiten Standardbatterie, 5 Standardkanone, 2 Abwehrturm; Stufe nach Bedarf, übrige offene Plätze leer); oder <spec> =
//                                 „stufe=3;8=lanze;4=sturmbatterie;…“ (Platz=Waffe-Id|leer); Standard: Start-Lerche
//   PAN01_TORPEDO=<opt>           PAN-01 C: Torpedowerfer auf Heck 2 zusätzlich einbauen (Stufe ≥ 2); opt = bogen:90,cd:10,lager:12 (Katalogwerte setzen, alles optional, z. B. 1)
// Werkzeug für die Messung, kein Spielcode.
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Modul = require('../server/sim/module.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const Ausbau = require('../server/sim/ausbau.js');
const Katalog = require('../shared/schiffskatalog.js');
const modulMode = process.env.PAN01_MODUL || '';
const waffenMode = process.env.PAN01_WAFFEN || '';
const torpedoMode = process.env.PAN01_TORPEDO || '';
const powerSet = (process.env.PAN01_POWER || '').split(',').map(Number);
const kampf = process.env.PAN01_KAMPF ? process.env.PAN01_KAMPF.split(';') : null;
const kampfAus = kampf && kampf[0].startsWith('aus:') ? kampf[0].slice(4).split(',').filter(Boolean) : [];
const kampfPower = kampf && kampf[1] ? kampf[1].split(',').map(Number) : null;
if (process.env.PAN01_NOHEAT) CONFIG.power.heatAt4 = 0;
let torpedoLager = 0;   // Startlager der Messung (sonst 6)
for (const kv of torpedoMode.split(',')) {
  const [k, v] = kv.split(':'); const x = Number(v);
  if (k === 'bogen' && x > 0) Katalog.waffe('torpedowerfer').bogen = x;
  else if (k === 'cd' && x > 0) Katalog.TORPEDO.cooldown = x;
  else if (k === 'schild' && v === 'nur') Katalog.TORPEDO.schildUmgehung = 'nur-ohne-schild';   // Lesart B (Standard: A, immer an den Schilden vorbei)
  else if (k === 'lager' && x > 0) { Katalog.TORPEDO.lagerMax = Math.max(Katalog.TORPEDO.lagerMax, x); torpedoLager = x; }
}
const PRIO = [8, 4, 6, 7, 9, 5, 1, 3, 2];
function waffenSetzen(g) {
  const ART = (p) => (p === 8 ? 'lanze' : p === 5 ? 'standardkanone' : p === 2 ? 'abwehrturm' : 'standardbatterie');
  let spec = null;
  if (/^n[0-9]$/.test(waffenMode)) { const k = Number(waffenMode.slice(1)); spec = { stufe: 0 }; PRIO.slice(0, k).forEach((p) => { spec[p] = ART(p); spec.stufe = Math.max(spec.stufe, require('../server/world.js').Maps.waffenplatz(p).stufe); }); }
  else if (waffenMode) { spec = {}; for (const kv of waffenMode.split(';')) { const [a, b] = kv.split('='); spec[a.trim()] = b.trim(); } spec.stufe = Number(spec.stufe) || 0; }
  if (torpedoMode) { spec = spec || { stufe: 0 }; spec.stufe = Math.max(spec.stufe || 0, 2); }
  if (!spec) return;
  Ausbau.setStufe(g, spec.stufe || 0);
  for (const p of Maps().WAFFENPLAETZE) {
    if ((g.ship.stufe | 0) < p.stufe) continue;
    const id = spec[p.platz];
    const e = Waffen.bestuecken(g, p.platz, id || (waffenMode ? 'leer' : (Katalog.START_BESTUECKUNG[p.platz] || 'leer')));
    if (e) throw new Error('PAN01_WAFFEN: ' + e);
  }
  if (torpedoMode) { const e = Waffen.bestuecken(g, 2, 'torpedowerfer'); if (e) throw new Error('PAN01_TORPEDO: ' + e); if (torpedoLager) g.inventory.bolzen = torpedoLager; }
}
function Maps() { return require('../server/world.js').Maps; }
const step = Game.prototype.step;
Game.prototype.step = function () {
  const ship = this.ship;
  if (ship && this.phase !== 'lobby') {
    if (this.__pan01ship !== ship) {   // neues Schiff nach reset(): Bestückung setzen
      this.__pan01ship = ship; this.__pan01fight = false;
      if (modulMode === 'voll' || modulMode === 'start') Modul.debug(this, [modulMode]);
      else if (modulMode) { ship.module = []; for (const id of modulMode.split(',')) Modul.bestuecken(this, id); Modul.verteilungSetzen(this); }
      if (waffenMode || torpedoMode) waffenSetzen(this);
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
