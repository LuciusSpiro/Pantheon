'use strict';
// SUND-03 A: gemeinsame Hilfen der Tests und Messwerkzeuge zu den Befehlen des Lage-Spielleiters (test-befehle.js, test-regie.js, test-lage-ausschnitt.js, sim-regie.js, mutation-regie.js).
//   neuesSpiel({ crew, seed, names, dir }) -> { g, cs, funk, aufraeumen }   ein Spiel im Modus Freie Fahrt Sund mit einem Weltstand im Temp-Verzeichnis (Spielernamen frei wählbar)
//   neueSim(seed) -> Sim-Zustand des Kerns (Standard-KI, ohne Spiel);  klon(x), gleich(a, b)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const CONFIG = require('../shared/config.js');
const Daten = require('../server/weltsim/daten.js');
const Kern = require('../server/weltsim/kern.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-regie-'));
let seq = 0;
const klon = (o) => JSON.parse(JSON.stringify(o));
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };

function neuesSpiel(o) {
  o = o || {};
  const { Game } = require('../server/game.js');
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: o.dir || freshDir(), seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (o.crew || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: (o.names && o.names[i]) || 'A' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'freie_fahrt', ...(o.world ? { world: o.world } : {}) });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < CONFIG.tickHz; i++) g.step();
  g.space.enemies = [];
  const funk = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
  return { g, cs, funk };
}
function neueSim(seed) {
  const { karte, werte } = Daten.laden();
  return Kern.erzeuge({ karte, werte, seed });
}
module.exports = { TMP, klon, gleich, freshDir, neuesSpiel, neueSim };
