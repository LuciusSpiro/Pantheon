'use strict';
// Gegner-KI für Kampf v2 (CONTRACT-M2 §5): Utility-Entscheidung mit aiHz, Bewegung jeden Tick.
// Rollen: pin (Deckung halten, mit Ankündigung feuern) · flank (max. 1 je Trupp, Deckungsplatz ohne Zieldeckung) ·
// retreat (seg ≤ 1: Deckung ohne Sicht, bis Schild voll) · push (Spieler verwundet/ohne Schild: nachsetzen) ·
// advance (kein Ziel sichtbar, aber lastKnown) · idle (unbemerkt: Patrouille um den Spawn).
// Trupp-Wissen (squad.alert, lastKnown je Spieler), Funksprüche (bark) vor der Aktion, Anti-Hängen (4 s -> neuer Plan).
// Wächter (kind 'warden'): schläft bis wake, dreht mit turnRate zum Ziel, schießt nur geradeaus, funkt nicht.
const Physics = require('../../shared/physics.js');
const Los = require('../../shared/los.js');
const W = require('../world.js');
const { bfs, dist } = require('../util.js');

const TILE = Physics.TILE;
const HITBOX = { w: 14, h: 10 };
let combatMod = null;
const combat = () => combatMod || (combatMod = require('./combat.js'));
let interiorMod = null;
const interior = () => interiorMod || (interiorMod = require('./interior.js'));

const cfg = (game) => game.C.awayCombat;
const tileOf = (x, y) => Physics.toTile(x, y);
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const manh = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
// Sichtlinie zwischen zwei Figuren inkl. Ducken (CONTRACT-M2 §15, combat.losBetween)
const los = (E, a, b) => combat().losBetween(E, a, b);

// ---------- Aufbau ----------
function makeEnemy(game, aw, kind, id, c, squadName) {
  const C = cfg(game); const ec = C.enemy[kind] || C.enemy.scavenger;
  return {
    id, kind, x: c.x, y: c.y, hp: ec.segments, dir: 'down', revealed: false, alive: true, home: { x: c.x, y: c.y },
    fireT: 0.6 + aw.rng() * 0.8, wander: null, wanderT: 0, hitT: -9,
    squad: squadName, seg: ec.segments, max: ec.segments, lastHitAt: -99, regenT: 0,
    role: 'idle', roleAt: 0, aim: null, vis: false, seenAt: -99, seenX: c.x, seenY: c.y, ghost: null,
    path: null, goal: null, goalAt: -99, stopNear: 0, stuckT: 0, stuckRef: { x: c.x, y: c.y }, replanAt: -99,
    facing: Math.PI / 2, asleep: kind === 'warden', focusUntil: 0, target: null, shootTarget: null, sees: [],
  };
}

function squadOf(game, e) {
  const aw = game.away;
  if (!aw.squads) aw.squads = {};
  let s = aw.squads[e.squad];
  if (!s) s = aw.squads[e.squad] = newSquad(e.squad, 1);
  return s;
}
function newSquad(name, n) {
  return { name, alert: false, lastKnown: {}, barkAt: -99, initial: n, halfBarked: false, contactAt: -99, lostBarked: true,
    flanker: null, flankAt: -99, noBark: name === 'warden', seesNow: false };
}
function isAlert(game, e) {
  const s = game.away.squads && game.away.squads[e.squad];
  return !!(s && s.alert);
}

function crewSize(game) { return Math.max(1, Math.min(3, game.players.filter((p) => p.connected).length)); }

// Trupp erscheinen lassen (Missionsereignis/Debug). Anzahl = Anteil squadScale je Crewgröße (aufgerundet, min. 1).
function spawnSquad(game, name, opts) {
  const o = opts || {};
  const aw = game.aways.kesh; const C = cfg(game);
  if (!aw) return 0;
  if (aw.spawned[name] && !o.force) return 0;
  const spots = (W.AWAY_MAPS.kesh.spawns[name] || []).slice();
  if (!spots.length) return 0;
  const scale = C.squadScale[crewSize(game)] != null ? C.squadScale[crewSize(game)] : 1;
  const n = Math.max(1, Math.min(spots.length, Math.ceil(spots.length * scale)));
  aw.spawned[name] = true;
  const s = aw.squads[name] = newSquad(name, n);
  for (let i = 0; i < n; i++) {
    const t = spots[i];
    const e = makeEnemy(game, aw, 'scavenger', name.charAt(0) + (name === 'rearguard' ? 'r' : name.slice(-1)) + '-' + game.nextId(''), W.tileCenter(t.x, t.y), name);
    aw.drones.push(e);
  }
  if (o.alert) alertSquad(game, aw, s);
  return n;
}
function alertSquad(game, aw, s) {
  s.alert = true; s.contactAt = game.time; s.lostBarked = false;
  for (const p of game.players) if (p.zone === 'away' && p.connected) s.lastKnown[p.id] = { x: p.x, y: p.y, t: game.time };
}
function wakeWarden(game) {
  const aw = game.aways.kesh;
  if (!aw) return false;
  const w = aw.drones.find((d) => d.kind === 'warden' && d.alive);
  if (!w || !w.asleep) return false;
  w.asleep = false; w.lastHitAt = -99;
  if (!aw.squads.warden) aw.squads.warden = newSquad('warden', 1);
  alertSquad(game, aw, aw.squads.warden);
  game.emit('wardenWake', { id: w.id, x: Math.round(w.x), y: Math.round(w.y) });
  game.emit('sfx', { name: 'warden_wake', zone: 'away', x: Math.round(w.x), y: Math.round(w.y) });
  return true;
}

// ---------- Funksprüche (CONTRACT-M2 §5) ----------
function bark(game, s, e, kind) {
  const C = cfg(game); const aw = game.away;
  if (!C.barksOn || !s || s.noBark || !e || e.kind === 'warden') return false;
  if (game.time - s.barkAt < C.barkCooldown) return false;
  const list = (C.barks && C.barks[kind]) || [];
  if (!list.length) return false;
  const text = list[Math.floor(aw.rng() * list.length)];
  s.barkAt = game.time;
  if (aw.stats) aw.stats.barks++;
  game.emit('bark', { from: 'Plünderer', id: e.id, text, x: Math.round(e.x), y: Math.round(e.y), cause: kind });
  const sfx = { name: 'bark', zone: 'away', x: Math.round(e.x), y: Math.round(e.y), text, n: text.length };
  if (/\?\s*$/.test(text)) sfx.q = true;
  game.emit('sfx', sfx);
  return true;
}

// ---------- Ereignisse aus combat.js ----------
function onEnemyHit(game, e, src) {
  const s = squadOf(game, e);
  if (src && src.pid) {
    const p = game.playerById(src.pid);
    if (p) s.lastKnown[p.id] = { x: p.x, y: p.y, t: game.time };
  }
  if (!s.alert && !e.asleep) { s.alert = true; s.contactAt = game.time; s.lostBarked = false; bark(game, s, e, 'contact'); }
}
function onEnemyDown(game, e) {
  const aw = game.away; const s = squadOf(game, e);
  if (s.flanker === e.id) s.flanker = null;
  const alive = aw.drones.filter((d) => d.alive && d.squad === e.squad);
  if (!s.halfBarked && s.initial >= 2 && alive.length > 0 && alive.length <= s.initial / 2) {
    s.halfBarked = true;
    s.barkAt = -99;   // dieser Funkspruch geht immer raus
    bark(game, s, alive[0], 'half');
  }
}
function onShieldFull(game, e) {
  if (e.role === 'retreat') { setRole(game, e, 'pin'); bark(game, squadOf(game, e), e, 'shieldUp'); e.goal = null; e.path = null; }
}
function onPlayerWounded(game, p) {
  const aw = game.away; const E = combat().env(game); const R = cfg(game).sightTiles * TILE;
  for (const e of aw.drones) {
    if (!e.alive || e.kind === 'warden') continue;
    if (dist(e.x, e.y, p.x, p.y) > R || !los(E, e, p)) continue;
    const s = squadOf(game, e);
    s.barkAt = Math.min(s.barkAt, game.time - cfg(game).barkCooldown);   // „Einer liegt!“ hat Vorrang
    bark(game, s, e, 'playerDown');
    return;
  }
}

function setRole(game, e, role) {
  if (e.role === role) return;
  const s = squadOf(game, e);
  if (e.role === 'flank' && s.flanker === e.id) s.flanker = null;
  e.role = role; e.roleAt = game.time;
  if (role !== 'pin' && role !== 'push') e.shootTarget = null;
}

// ---------- Hauptschleife ----------
function update(game, dt) {
  const aw = game.away; const C = cfg(game);
  const E = combat().env(game);
  E.team = game.players.filter((p) => p.zone === 'away' && p.connected);
  E.walk = (x, y) => !E.solid(x, y);
  E.R = C.sightTiles * TILE;
  aw.aiT = (aw.aiT || 0) + dt;
  const think = aw.aiT >= 1 / Math.max(0.5, C.aiHz);
  if (think) {
    aw.aiT = 0;
    perceive(game, E);
    for (const e of aw.drones) if (e.alive && !e.asleep && !e.frozen) { try { decide(game, E, e); } catch (err) { game.countError('squad-decide', err); } }
  }
  for (const e of aw.drones) if (e.alive && !e.asleep && !e.frozen) act(game, E, e, dt);   // frozen: nur Tests
}

function perceive(game, E) {
  const aw = game.away; const C = cfg(game);
  for (const s of Object.values(aw.squads || {})) if (s) s.seesNow = false;
  for (const e of aw.drones) {
    e.sees = [];
    if (!e.alive || e.asleep) continue;
    for (const p of E.team) {
      if (dist(e.x, e.y, p.x, p.y) > E.R) continue;
      if (!los(E, e, p)) continue;   // §15: geduckt hinter low-Deckung unsichtbar
      e.sees.push(p);
    }
    if (!e.sees.length) continue;
    const s = squadOf(game, e);
    for (const p of e.sees) s.lastKnown[p.id] = { x: p.x, y: p.y, t: game.time };
    s.seesNow = true;
    if (!s.alert || s.lostBarked) {
      s.alert = true; s.lostBarked = false;
      bark(game, s, e, 'contact');
    }
    s.contactAt = game.time;
  }
  for (const s of Object.values(aw.squads || {})) {
    if (!s) continue;
    for (const [pid, lk] of Object.entries(s.lastKnown)) {
      const p = game.playerById(pid);
      if (!p || p.zone !== 'away' || game.time - lk.t > C.lastKnownTtl) delete s.lastKnown[pid];
    }
    if (s.alert && !s.seesNow && !s.lostBarked && game.time - s.contactAt > C.lostAfter) {
      const m = aw.drones.find((d) => d.alive && d.squad === s.name);
      bark(game, s, m, 'lost');
      s.lostBarked = true;
    }
  }
}

function inBox(C, ax, ay, bx, by) { return Math.abs(bx - ax) <= C.engageBox.w / 2 && Math.abs(by - ay) <= C.engageBox.h / 2; }

function decide(game, E, e) {
  const C = cfg(game); const s = squadOf(game, e);
  if (e.kind === 'warden') return decideWarden(game, E, e, s);
  if (!s.alert) { setRole(game, e, 'idle'); return; }
  const vis = e.sees;
  // Rückzug, bis der Schild wieder voll ist (daraus entsteht Unterdrückung)
  if (e.role === 'retreat') {
    if (e.seg >= e.max) { onShieldFull(game, e); }
    else {
      if (!e.goal || (vis.length && game.time - e.goalAt > 1.5)) planRetreat(game, E, e, s);
      return;
    }
  } else if (e.seg <= 1 && e.max > 1) {
    bark(game, s, e, 'retreat');
    setRole(game, e, 'retreat');
    planRetreat(game, E, e, s);
    return;
  }
  // Nachsetzen: Spieler verwundet oder ohne Schild in Sicht
  const weak = vis.find((p) => p.downed) || vis.find((p) => p.shield && p.shield.seg === 0);
  if (weak) {
    if (e.role !== 'push') setRole(game, e, 'push');
    e.target = weak.id;
    const shootable = vis.filter((p) => !p.downed);
    e.shootTarget = shootable.length ? pickTarget(e, shootable, C).id : null;
    if (!e.goal || game.time - e.goalAt > 2) planPush(game, E, e, weak);
    return;
  }
  // Flankieren läuft weiter (max. flankMaxTime s, dann pin)
  if (e.role === 'flank') {
    if (game.time - e.roleAt > C.flankMaxTime) setRole(game, e, 'pin');
    else if (e.path && e.path.length) return;
    else setRole(game, e, 'pin');
  }
  const targets = vis.filter((p) => !p.downed);
  if (targets.length) {
    const t = pickTarget(e, targets, C);
    e.target = t.id;
    const alive = game.away.drones.filter((d) => d.alive && d.squad === e.squad).length;
    const flankerBusy = s.flanker && game.away.drones.some((d) => d.alive && d.id === s.flanker && d.role === 'flank');
    if (e.role !== 'flank' && !flankerBusy && alive >= 2 && game.time - s.flankAt > 10 &&
        Los.coverAgainst(E.map, E.solid, e.x, e.y, t.x, t.y, !!t.crouch) > 0) {
      const spot = findFlankSpot(game, E, e, t);
      if (spot) {
        const side = sideOf(e, t, spot);
        bark(game, s, e, side === 'left' ? 'flankLeft' : 'flankRight');
        setRole(game, e, 'flank');
        s.flanker = e.id; s.flankAt = game.time;
        e.shootTarget = null;
        if (setGoal(game, E, e, spot)) return;
        setRole(game, e, 'pin');
      }
    }
    setRole(game, e, 'pin');
    e.shootTarget = t.id;
    planPin(game, E, e, t);
    return;
  }
  // kein Ziel sichtbar, aber Trupp-Wissen: vorrücken
  const lk = freshestKnown(s);
  if (lk) {
    if (e.role !== 'advance') { setRole(game, e, 'advance'); e.goal = null; }
    e.shootTarget = null;
    if (!e.goal || game.time - e.goalAt > 3) planAdvance(game, E, e, lk);
    if (!e.path || !e.path.length) {
      // angekommen und nichts zu sehen: diese Spur ist kalt
      if (dist(e.x, e.y, lk.x, lk.y) < 3 * TILE) delete s.lastKnown[lk.pid];
    }
    return;
  }
  setRole(game, e, 'idle');
  e.shootTarget = null;
}

function pickTarget(e, list, C) {
  const inb = list.filter((p) => inBox(C, e.x, e.y, p.x, p.y));
  const pool = inb.length ? inb : list;
  return pool.slice().sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
}
function freshestKnown(s) {
  let best = null;
  for (const [pid, lk] of Object.entries(s.lastKnown)) if (!best || lk.t > best.t) best = Object.assign({ pid }, lk);
  return best;
}
// Links/rechts aus Sicht des Gegners, der auf das Ziel schaut (y nach unten: Kreuzprodukt > 0 = rechts)
function sideOf(e, t, spot) {
  const c = W.tileCenter(spot.x, spot.y);
  const cross = (t.x - e.x) * (c.y - e.y) - (t.y - e.y) * (c.x - e.x);
  return cross > 0 ? 'right' : 'left';
}

function reserved(game, e, spot) {
  for (const d of game.away.drones) {
    if (d === e || !d.alive) continue;
    if (d.goal && d.goal.x === spot.x && d.goal.y === spot.y) return true;
    const t = tileOf(d.x, d.y);
    if (t.x === spot.x && t.y === spot.y) return true;
  }
  return false;
}

// Deckungsplatz mit Sicht auf das Ziel halten (pin)
function planPin(game, E, e, t) {
  const C = cfg(game);
  const here = tileOf(e.x, e.y);
  const curCover = Los.coverAgainst(E.map, E.solid, t.x, t.y, e.x, e.y);
  if (e.goal && game.time - e.goalAt < 3) {
    const gc = W.tileCenter(e.goal.x, e.goal.y);
    if (los(E, gc, t)) return;
  }
  if ((!e.path || !e.path.length) && curCover >= 1 && inBox(C, e.x, e.y, t.x, t.y)) { e.goal = null; return; }
  let best = null, bs = -Infinity;
  const tt = tileOf(t.x, t.y);
  for (const sp of W.AWAY_MAPS[game.away.map].coverSpots || []) {
    if (cheb(sp, here) > 7 || E.solid(sp.x, sp.y)) continue;
    const c = W.tileCenter(sp.x, sp.y);
    const d = dist(c.x, c.y, t.x, t.y);
    if (d < 3 * TILE || !inBox(C, c.x, c.y, t.x, t.y)) continue;
    if (reserved(game, e, sp)) continue;
    if (!los(E, c, t)) continue;
    const cov = Los.coverAgainst(E.map, E.solid, t.x, t.y, c.x, c.y);
    const score = cov * 4 - manh(sp, here) * 0.5 - Math.abs(d / TILE - 6) * 0.3 - (manh(sp, tt) < 3 ? 2 : 0);
    if (score > bs) { bs = score; best = sp; }
  }
  if (best && (best.x !== here.x || best.y !== here.y) && setGoal(game, E, e, best)) return;
  if (!inBox(C, e.x, e.y, t.x, t.y)) setGoal(game, E, e, tt, 5 * TILE, t);
}

// Flankenplatz: Sicht auf das Ziel, Ziel hat dort keine Deckung (coverAgainst == 0)
function findFlankSpot(game, E, e, t) {
  const C = cfg(game);
  const here = tileOf(e.x, e.y); const tt = tileOf(t.x, t.y);
  const cands = [];
  for (const sp of W.AWAY_MAPS[game.away.map].coverSpots || []) {
    if (cheb(sp, tt) > 9 || cheb(sp, here) > 10 || E.solid(sp.x, sp.y)) continue;
    if (sp.x === here.x && sp.y === here.y) continue;
    const c = W.tileCenter(sp.x, sp.y);
    const d = dist(c.x, c.y, t.x, t.y);
    if (d < 3 * TILE || !inBox(C, c.x, c.y, t.x, t.y)) continue;
    if (reserved(game, e, sp)) continue;
    if (!los(E, c, t)) continue;
    if (Los.coverAgainst(E.map, E.solid, c.x, c.y, t.x, t.y, !!t.crouch) !== 0) continue;
    cands.push({ sp, score: -manh(sp, here) - Math.abs(d / TILE - 5) * 0.5 + Los.coverAgainst(E.map, E.solid, t.x, t.y, c.x, c.y) * 2 });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 4)) {
    const path = bfs(E.walk, here, (x, y) => x === c.sp.x && y === c.sp.y, E.map.w, E.map.h);
    if (path && path.length <= 22) return c.sp;
  }
  return null;
}

// Rückzug: Deckungsplatz ohne Sicht auf bekannte Spieler
function planRetreat(game, E, e, s) {
  const here = tileOf(e.x, e.y);
  const known = Object.values(s.lastKnown);
  for (const p of e.sees) known.push({ x: p.x, y: p.y });
  // §15: Plünderer ducken sich an low-Deckung -> solche Plätze gelten als verborgen, wenn die Deckung die Sicht sperrt
  const ducks = !!(cfg(game).crouch && cfg(game).crouch.enemyCrouch);
  const hidden = (x, y) => { const me = { x, y, crouch: ducks && Los.nextToLow(E.map, E.solid, x, y) }; return known.every((k) => !los(E, k, me)); };
  if (known.length && hidden(e.x, e.y) && (!e.path || !e.path.length)) { e.goal = null; return; }
  const cands = [];
  for (const sp of W.AWAY_MAPS[game.away.map].coverSpots || []) {
    if (cheb(sp, here) > 8 || E.solid(sp.x, sp.y) || reserved(game, e, sp)) continue;
    const c = W.tileCenter(sp.x, sp.y);
    if (!hidden(c.x, c.y)) continue;
    const md = known.length ? Math.min(...known.map((k) => dist(k.x, k.y, c.x, c.y))) : 0;
    cands.push({ sp, score: -manh(sp, here) * 0.6 + md / TILE * 0.3 });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 4)) if (setGoal(game, E, e, c.sp)) return;
  const home = tileOf(e.home.x, e.home.y);
  setGoal(game, E, e, home);
}

function planPush(game, E, e, t) {
  const tt = tileOf(t.x, t.y);
  setGoal(game, E, e, tt, 2.5 * TILE, t);
}

// Vorrücken über Deckungsplätze Richtung lastKnown
function planAdvance(game, E, e, lk) {
  const here = tileOf(e.x, e.y); const lt = tileOf(lk.x, lk.y);
  let best = null, bs = -Infinity;
  for (const sp of W.AWAY_MAPS[game.away.map].coverSpots || []) {
    if (cheb(sp, lt) > 4 || E.solid(sp.x, sp.y) || reserved(game, e, sp)) continue;
    const score = -manh(sp, lt) - manh(sp, here) * 0.2;
    if (score > bs) { bs = score; best = sp; }
  }
  if (best && setGoal(game, E, e, best)) return;
  if (!E.solid(lt.x, lt.y)) setGoal(game, E, e, lt);
}

function setGoal(game, E, e, tile, stopNear, stopTarget) {
  const here = tileOf(e.x, e.y);
  const path = bfs(E.walk, here, (x, y) => x === tile.x && y === tile.y, E.map.w, E.map.h);
  if (!path) return false;
  e.path = path; e.goal = { x: tile.x, y: tile.y }; e.goalAt = game.time;
  e.stopNear = stopNear || 0; e.stopTarget = stopTarget ? stopTarget.id : null;
  return true;
}

// ---------- Wächter ----------
function decideWarden(game, E, e, s) {
  const C = cfg(game);
  const targets = e.sees.filter((p) => !p.downed);
  const leash = C.wardenLeash * TILE;
  if (targets.length) {
    const t = pickTarget(e, targets, C);
    e.target = t.id; e.shootTarget = t.id;
    setRole(game, e, 'pin');
    if (dist(e.x, e.y, t.x, t.y) > 5 * TILE && dist(t.x, t.y, e.home.x, e.home.y) < leash + 5 * TILE) {
      if (!e.goal || game.time - e.goalAt > 2) {
        const tt = tileOf(t.x, t.y);
        if (setGoal(game, E, e, tt, 4 * TILE, t)) {
          // Leine: nicht weiter als wardenLeash vom Platz
          e.path = e.path.filter((n) => dist(W.tileCenter(n.x, n.y).x, W.tileCenter(n.x, n.y).y, e.home.x, e.home.y) <= leash);
        }
      }
    } else { e.path = null; e.goal = null; }
    return;
  }
  e.shootTarget = null;
  const lk = freshestKnown(s);
  e.target = lk ? lk.pid : null;
  setRole(game, e, lk ? 'advance' : 'idle');
  if (dist(e.x, e.y, e.home.x, e.home.y) > leash && (!e.goal || game.time - e.goalAt > 3)) setGoal(game, E, e, tileOf(e.home.x, e.home.y));
}

// ---------- Ausführen (jeden Tick) ----------
// §15: Plünderer im Rückzug ducken sich, sobald sie an niedriger Deckung stehen; aufstehen bei vollem Schild
// (Rolle wechselt), zum Schießen oder zum Weiterlaufen. Der Wächter duckt sich nie.
function updateEnemyCrouch(game, E, e) {
  const cc = cfg(game).crouch;
  const want = !!(cc && cc.enemyCrouch) && e.kind !== 'warden' && e.role === 'retreat' && !e.aim &&
    (!e.path || !e.path.length) && e.seg < e.max && Los.nextToLow(E.map, E.solid, e.x, e.y);
  e.crouch = want;
}

function act(game, E, e, dt) {
  const C = cfg(game); const ec = C.enemy[e.kind] || C.enemy.scavenger;
  updateEnemyCrouch(game, E, e);
  // Wächter dreht sich mit turnRate zum Ziel (sichtbar) bzw. zur letzten bekannten Position
  if (e.kind === 'warden') {
    let tp = null;
    const t = e.aim ? game.playerById(e.aim.target) : (e.target ? game.playerById(e.target) : null);
    if (t && t.zone === 'away') tp = { x: t.x, y: t.y };
    else { const lk = freshestKnown(squadOf(game, e)); if (lk) tp = lk; }
    if (tp) {
      const want = Math.atan2(tp.y - e.y, tp.x - e.x);
      const d = Physics.normAngle(want - e.facing);
      const step = (ec.turnRate || 70) * Math.PI / 180 * dt;
      e.facing = Math.abs(d) <= step ? want : Physics.normAngle(e.facing + Math.sign(d) * step);
    }
  }
  // Ankündigung läuft: nicht bewegen; Sicht verloren / Ziel weg -> abbrechen (kein Schuss)
  if (e.aim) {
    const t = game.playerById(e.aim.target);
    const ok = t && t.zone === 'away' && !t.downed && inBox(C, e.x, e.y, t.x, t.y) && los(E, e, t);
    if (!ok) { e.aim = null; e.fireT = Math.max(e.fireT, 0.5); }
    else if (game.time - e.aim.t0 >= e.aim.dur) {
      const aimOk = e.kind !== 'warden' || Math.abs(Physics.normAngle(Math.atan2(t.y - e.y, t.x - e.x) - e.facing)) < 0.6;
      if (aimOk) combat().fireEnemy(game, e, t);
      e.aim = null; e.fireT = ec.fireInterval;
    }
    trackStuck(game, e, dt, false);
    return;
  }
  e.fireT -= dt;
  if (e.fireT <= 0 && e.shootTarget && e.role !== 'retreat' && !(e.role === 'flank' && e.path && e.path.length)) {
    const t = game.playerById(e.shootTarget);
    // Kein Treffer aus dem Off: nur mit Sichtlinie UND Ziel im engageBox (CONTRACT-M2 §4.3)
    if (t && t.zone === 'away' && !t.downed && inBox(C, e.x, e.y, t.x, t.y) && los(E, e, t) &&
        (e.kind !== 'warden' || Math.abs(Physics.normAngle(Math.atan2(t.y - e.y, t.x - e.x) - e.facing)) < 0.6)) {
      e.aim = { target: t.id, t0: game.time, dur: ec.aim };
      game.emit('enemyAim', { id: e.id, target: t.id, x: Math.round(e.x), y: Math.round(e.y) });
      game.emit('sfx', { name: e.kind === 'warden' ? 'warden_aim' : 'enemy_aim', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) });
      trackStuck(game, e, dt, false);
      return;
    }
    e.fireT = 0.2;
  }
  if (e.role === 'idle' && !isAlert(game, e)) { wander(game, E, e, dt); return; }
  if (e.role === 'idle' && (!e.path || !e.path.length)) { wander(game, E, e, dt); return; }
  moveAlong(game, E, e, dt);
}

function moveAlong(game, E, e, dt) {
  const C = cfg(game); const ec = C.enemy[e.kind] || C.enemy.scavenger;
  if (!e.path || !e.path.length) { trackStuck(game, e, dt, false); return; }
  if (e.stopNear && e.stopTarget) {
    const t = game.playerById(e.stopTarget);
    if (t && dist(t.x, t.y, e.x, e.y) <= e.stopNear && los(E, e, t)) { e.path = null; trackStuck(game, e, dt, false); return; }
  }
  let budget = ec.speed * dt;
  let guard = 0;
  while (budget > 0.01 && e.path.length && guard++ < 4) {
    const n = e.path[0]; const c = W.tileCenter(n.x, n.y);
    const dx = c.x - e.x, dy = c.y - e.y; const d = Math.hypot(dx, dy);
    if (d < 1) { e.path.shift(); continue; }
    const s = Math.min(d, budget);
    const res = Physics.moveWithCollision(E.solid, e.x, e.y, dx / d * s, dy / d * s, HITBOX);
    const moved = Math.hypot(res.x - e.x, res.y - e.y);
    e.x = res.x; e.y = res.y;
    e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (e.kind !== 'warden') e.facing = Math.atan2(dy, dx);
    budget -= Math.max(moved, 0.01);
    if (moved < s * 0.3) break;
    if (Math.hypot(c.x - e.x, c.y - e.y) < 1) e.path.shift();
  }
  trackStuck(game, e, dt, true);
}

// Anti-Hängen: bewegt sich ein Gegner 4 s nicht, obwohl er sollte -> neuer Plan (CONTRACT-M2 §5)
function trackStuck(game, e, dt, shouldMove) {
  const C = cfg(game); const aw = game.away;
  if (!shouldMove) { e.stuckT = 0; e.stuckRef = { x: e.x, y: e.y }; return; }
  if (dist(e.x, e.y, e.stuckRef.x, e.stuckRef.y) > 6) { e.stuckRef = { x: e.x, y: e.y }; e.stuckT = 0; return; }
  e.stuckT += dt;
  if (aw.stats && e.stuckT > aw.stats.maxStuck) aw.stats.maxStuck = e.stuckT;
  if (e.stuckT >= C.stuckReplan && game.time - e.replanAt >= C.stuckReplan) {
    e.replanAt = game.time;
    unstick(game, e);
  }
}
function unstick(game, e) {
  const aw = game.away; const E = combat().env(game);
  const walk = (x, y) => !E.solid(x, y);
  const here = tileOf(e.x, e.y);
  // auf die Mitte der eigenen (oder einer freien Nachbar-)Kachel zurück und neu planen
  const opts = [here, { x: here.x + 1, y: here.y }, { x: here.x - 1, y: here.y }, { x: here.x, y: here.y + 1 }, { x: here.x, y: here.y - 1 }]
    .filter((t) => walk(t.x, t.y));
  const t = opts[Math.floor(aw.rng() * opts.length)] || here;
  const c = W.tileCenter(t.x, t.y);
  if (!Physics.boxHits(E.solid, c.x, c.y, HITBOX.w, HITBOX.h)) { e.x = c.x; e.y = c.y; }
  e.path = null; e.goal = null; e.goalAt = -99;
  if (e.role === 'flank') setRole(game, e, 'pin');
  e.stuckRef = { x: e.x, y: e.y };
}

// Unbemerkt: leichtes Patrouillieren um den Spawn (wie die vorhandene Drohnenlogik)
function wander(game, E, e, dt) {
  const C = cfg(game); const aw = game.away; const ec = C.enemy[e.kind] || C.enemy.scavenger;
  if (e.kind === 'warden') { trackStuck(game, e, dt, false); return; }
  e.wanderT -= dt;
  if (!e.wander || e.wanderT <= 0) {
    const a = aw.rng() * Math.PI * 2, r = aw.rng() * 64;
    e.wander = { x: e.home.x + Math.cos(a) * r, y: e.home.y + Math.sin(a) * r };
    e.wanderT = 2 + aw.rng() * 2;
  }
  const wd = dist(e.x, e.y, e.wander.x, e.wander.y);
  if (wd > 4) {
    const mx = (e.wander.x - e.x) / wd * 0.5, my = (e.wander.y - e.y) / wd * 0.5;
    const res = Physics.moveWithCollision(E.solid, e.x, e.y, mx * ec.speed * dt, my * ec.speed * dt, HITBOX);
    if (res.x === e.x && res.y === e.y) e.wanderT = 0;
    e.x = res.x; e.y = res.y;
    e.dir = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
  }
  trackStuck(game, e, dt, false);
}

module.exports = {
  makeEnemy, spawnSquad, wakeWarden, update, onEnemyHit, onEnemyDown, onShieldFull, onPlayerWounded, isAlert, bark, squadOf,
  inBox, perceive,
};
