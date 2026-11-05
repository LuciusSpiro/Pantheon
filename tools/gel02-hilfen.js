'use strict';
// GEL-02 F: gemeinsame Hilfen für Gruppenlauf, Tick-Messung und Abnahme-Skript (kein Produktcode).
const Physics = require('../shared/physics.js');
const W = require('../server/world.js');
const Arena = require('../server/sim/arena.js');
const { Game } = require('../server/game.js');

const fehlerZahl = (g) => (Array.isArray(g.errors) ? g.errors.length : g.errors | 0);
const tileVon = (o) => Physics.toTile(o.x, o.y);

// Neues Spiel (frischer Server-Zustand) mit np gescripteten Spielern auf einem Testgelände (Arena.start wie ?arena=away&art=...).
function neuesSpiel(np, params) {
  const g = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  g.cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 200) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'G' + i, name: 'G' + i, color: i }); g.handleMessage(c, { t: 'ready', ready: true });
    g.cs.push(c);
  }
  Arena.start(g, 'arena_away', params);
  const map = g.away.map;
  return { g, map, k: W.AWAY_MAPS[map].karte };
}
// Deck einer Kachel/eines Objekts (0 ohne Decks)
const deckVon = (k, o) => (k.decks ? Math.floor(tileVon(o).y / k.decks.stride) : 0);
const stat = (a) => { const s = a.slice().sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))]; return { med: q(0.5), p95: q(0.95), max: s[s.length - 1], min: s[0] }; };

module.exports = { neuesSpiel, deckVon, tileVon, fehlerZahl, stat };
