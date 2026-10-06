'use strict';
// Kleine Hilfsfunktionen für den Server: Zufall (seeded), BFS, Sichtlinie, Rundung.
const Physics = require('../shared/physics.js');

const TILE = Physics.TILE;
const DIRS = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const NEIGHBOR_ORDER = ['up', 'right', 'down', 'left'];

// mulberry32 – deterministischer Zufall (für Asteroiden, Code, Tests).
function makeRng(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.chance = (p) => rng() < p;
  rng.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return rng;
}

// Breitensuche auf Kacheln (4-Nachbarschaft). walkable(x,y) -> bool, isGoal(x,y) -> bool.
// Start darf unbegehbar sein. Rückgabe: Pfad [{x,y}] ohne Start, mit Ziel; [] wenn Start = Ziel; null wenn unerreichbar.
function bfs(walkable, start, isGoal, w, h, maxNodes) {
  if (isGoal(start.x, start.y)) return [];
  const limit = maxNodes || w * h + 1;
  const prev = new Map();
  const key = (x, y) => y * w + x;
  const q = [start];
  prev.set(key(start.x, start.y), null);
  let head = 0;
  while (head < q.length && head < limit) {
    const c = q[head++];
    for (const d of NEIGHBOR_ORDER) {
      const nx = c.x + DIRS[d].x, ny = c.y + DIRS[d].y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const k = key(nx, ny);
      if (prev.has(k)) continue;
      const goal = isGoal(nx, ny);
      if (!goal && !walkable(nx, ny)) continue;
      prev.set(k, c);
      if (goal) {
        const path = [{ x: nx, y: ny }];
        let p = c;
        while (p && !(p.x === start.x && p.y === start.y)) { path.unshift({ x: p.x, y: p.y }); p = prev.get(key(p.x, p.y)); }
        return path;
      }
      q.push({ x: nx, y: ny });
    }
  }
  return null;
}

// Sichtlinie in px: true, wenn keine solide Kachel zwischen a und b liegt.
function lineOfSight(isSolid, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 8));
  for (let i = 1; i < steps; i++) {
    const x = ax + dx * i / steps, y = ay + dy * i / steps;
    if (isSolid(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
  }
  return true;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const f2 = (v) => Math.floor(v * 100) / 100; // Ladebalken: nie 1 anzeigen, bevor es wirklich 1 ist
const r3 = (v) => Math.round(v * 1000) / 1000;

// Dreht a in Richtung b um höchstens maxStep (Radiant).
function turnToward(a, b, maxStep) {
  const d = Physics.normAngle(b - a);
  if (Math.abs(d) <= maxStep) return b;
  return Physics.normAngle(a + Math.sign(d) * maxStep);
}

module.exports = { TILE, DIRS, NEIGHBOR_ORDER, makeRng, bfs, lineOfSight, clamp, dist, r1, r2, r3, f2, turnToward };
