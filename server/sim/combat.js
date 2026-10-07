'use strict';
// Kampfsystem v2 für Außenmissionen (CONTRACT-M2 §4/§6/§7). Gilt NUR auf Außenkarten mit combat: 'v2' (Mond Kesh).
// Plattform B-7 und Wrack laufen unverändert über server/sim/away.js (HP, alter Kampf).
// Inhalt: Personenschild in Segmenten, verwundet/Pistole/Bleedout/Wiederbeleben/Medipack, Notrückholung aller,
// Projektile mit Wänden + halber Deckung, Gegner-Schilde, Wächter-Frontbogen, Fog of War (vis/ghost), Scan-Qualität,
// Captain-Befehle, Kesh-Interaktionen (Störrelais, Archivschlüssel, Tafel), Debug `tune`.
// Gegner-KI: server/sim/squad.js. Alle Balancing-Werte: CONFIG.awayCombat.
const Physics = require('../../shared/physics.js');
const Los = require('../../shared/los.js');
const Protocol = require('../../shared/protocol.js');
const W = require('../world.js');
const squad = require('./squad.js');
const { dist, makeRng, r1, r2, clamp } = require('../util.js');

const TILE = Physics.TILE;
const isDown = (st) => st === 'broken' || st === 'offline';
let interiorMod = null;
const interior = () => interiorMod || (interiorMod = require('./interior.js'));

function cfg(game) { return game.C.awayCombat; }
function infoOf(aw) { return W.AWAY_MAPS[aw && aw.map]; }
function isV2Away(aw) { const i = infoOf(aw); return !!(i && i.combat === 'v2'); }
function isV2(game) { return isV2Away(game.away); }
function playerOnV2(game, p) { return p.zone === 'away' && isV2(game); }
function teamOf(game) { return game.players.filter((p) => p.zone === 'away' && p.connected); }

// Kontext für Sicht/Deckung auf der aktuellen Außenkarte (Tor zu/offen usw. über awaySolid)
function env(game) {
  const map = infoOf(game.away).map;
  const solid = interior().awaySolid(game);
  return { map, solid, blocked: Los.sightFn(map, solid), C: cfg(game) };
}

// ---------- Ducken (CONTRACT-M2 §15) ----------
function crouchCfg(game) { return cfg(game).crouch || { speedFactor: 0.5, dodge: 0.2, enemyCrouch: true }; }
// Sichtlinie zwischen zwei Figuren (Spieler/Gegner, Feld `crouch`): low-Kacheln um geduckte Endpunkte sperren beidseitig
function losBetween(E, a, b) {
  const pts = [];
  if (a && a.crouch) pts.push(a);
  if (b && b.crouch) pts.push(b);
  const blocked = pts.length ? Los.crouchSight(E.map, E.solid, E.blocked, pts) : E.blocked;
  return Los.lineOfSight(blocked, a.x, a.y, b.x, b.y);
}
function canCrouch(game, p) {
  return !!(p && p.zone === 'away' && isV2(game) && !p.downed && !p.console && !p.beamLock);
}
// cmd { c: 'crouch', on } – nur Außenzone auf v2-Karten, nicht verwundet, nicht an einer Konsole
function setCrouch(game, p, on) {
  if (!on) { p.crouch = false; return null; }
  if (!(p.zone === 'away' && isV2(game))) { p.crouch = false; return 'Ducken geht nur im Außeneinsatz (Kesh).'; }
  if (!canCrouch(game, p)) { p.crouch = false; return null; }
  p.crouch = true;
  return null;
}
// Jeden Tick (interior.updatePlayers): Konsole, Verwundung, Beamen, andere Zone beenden das Ducken
function checkCrouch(game, p) {
  if (p.crouch && !canCrouch(game, p)) p.crouch = false;
}
function speedFactor(game, p) {
  return p.crouch ? clamp(Number(crouchCfg(game).speedFactor) || 0, 0, 1) : 1;
}

// ---------- Aufbau ----------
function makeKesh(game, base) {
  const info = W.AWAY_MAPS.kesh;
  const aw = Object.assign(base, {
    combat: 'v2', vault: { open: false },
    jammers: info.jammers.map((t) => ({ x: t.x, y: t.y, off: false })),
    keys: info.keys.map((t) => ({ x: t.x, y: t.y, t: 0, doneAt: null })),
    tablet: { x: info.tablet.x, y: info.tablet.y, taken: false },
    orders: [], squads: {}, spawned: {}, recallT: 0, recallLockUntil: 0, keyHintAt: -99, aiT: 0,
    rng: makeRng((game.seed ^ 0x5C0B1) >>> 0),
    stats: { wounds: 0, revives: 0, squadRecalls: 0, bleedRecalls: 0, playerHits: 0, offBoxHits: 0, offBoxShots: 0, maxStuck: 0,
      enemyShots: 0, coverBlocks: 0, barks: 0, deflects: 0, aimNoLos: 0, kuppelBlocks: 0 },
  });
  const L = info.spawns.warden[0];
  aw.drones.push(squad.makeEnemy(game, aw, 'warden', 'L1', W.tileCenter(L.x, L.y), 'warden'));
  return aw;
}

// ---------- Spieler: Schild ----------
function initShield(game, p) {
  const n = cfg(game).shield.segments;
  p.shield = { seg: n, max: n, lastHitAt: -99, regenT: 0 };
}
function fullShield(game, p) { initShield(game, p); }

// Spieler betritt eine v2-Karte (Herunterbeamen): voller Schild, ein Medipack aus dem Lager (falls vorhanden)
function onArrive(game, p) {
  fullShield(game, p);
  p.wound = false; p.bleed = null; p.cv = 0; p.fl = false; p.crouch = false;
  p.medkit = 0;
  if ((game.inventory.medipack || 0) > 0) { game.inventory.medipack--; p.medkit = 1; }
}
// Spieler verlässt die v2-Karte (Beamen, Rückholung, Verbindungsabbruch): Medipack zurück ins Lager, Wunde heilt
function onLeave(game, p) {
  if (p.medkit) { game.inventory.medipack = (game.inventory.medipack || 0) + p.medkit; p.medkit = 0; }
  if (p.wound || p.downed) { p.downed = false; p.downedFor = 0; p.hp = game.C.player.hp; }
  p.wound = false; p.bleed = null; p.cv = 0; p.fl = false; p.crouch = false;
  if (p.shield) fullShield(game, p);
}

// Treffer auf einen Spieler (CONTRACT-M2 §4.1). segs = Segmente je Treffer (Wächter: shotSegments).
function hitPlayer(game, p, segs, source) {
  const C = cfg(game); const aw = game.away;
  if (p.downed || p.zone !== 'away') return 'ignored';
  if (game.god) return 'god';
  if (aw.kuppelHp > 0 && game.time < aw.kuppelUntil) {
    aw.kuppelHp = Math.max(0, aw.kuppelHp - C.kuppelPerHit);
    if (aw.stats) aw.stats.kuppelBlocks++;
    game.emit('sfx', { name: 'shield_hit', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
    return 'kuppel';
  }
  if (!p.shield) initShield(game, p);
  const sh = p.shield;
  sh.lastHitAt = game.time; sh.regenT = 0;
  if (sh.seg > 0) {
    sh.seg = Math.max(0, sh.seg - Math.max(1, segs || 1));
    game.emit('shieldHit', { pid: p.id, seg: sh.seg, x: Math.round(p.x), y: Math.round(p.y) });
    game.emit('sfx', { name: 'shield_hit', zone: 'away', x: Math.round(p.x), y: Math.round(p.y), seg: sh.seg, max: sh.max });
    if (sh.seg === 0) {
      game.emit('shieldBreak', { pid: p.id, x: Math.round(p.x), y: Math.round(p.y) });
      game.emit('sfx', { name: 'shield_break', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
    }
    return 'shield';
  }
  woundPlayer(game, p, source);
  return 'wounded';
}

function woundPlayer(game, p, source) {
  const C = cfg(game); const it = interior();
  if (p.downed) return;
  if (p.console) it.leaveConsole(game, p);
  if (p.carry) it.dropCarry(game, p);
  p.downed = true; p.downedFor = 0; p.wound = true; p.hp = 0; p.crouch = false;
  p.bleed = C.wounded.bleedout;
  p.console = null; p.hold = null; p.input.mx = 0; p.input.my = 0;
  if (!p.shield) initShield(game, p);
  p.shield.seg = 0; p.shield.regenT = 0;
  if (game.away.stats) game.away.stats.wounds++;
  game.emit('wounded', { pid: p.id, x: Math.round(p.x), y: Math.round(p.y), source: source || null });
  game.emit('sfx', { name: 'wounded', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
  game.oda(`${p.name} ist verwundet! Kameraden: E halten zum Aufhelfen. Liegend geht noch die Pistole.`, null);
  squad.onPlayerWounded(game, p);
  game.missionEvent('playerWounded', { pid: p.id });
}

function revive(game, p, segs, opts) {
  const o = opts || {};
  p.downed = false; p.downedFor = 0; p.wound = false; p.bleed = null; p.hold = null;
  p.hp = game.C.player.hp;
  if (!p.shield) initShield(game, p);
  p.shield.max = cfg(game).shield.segments;
  p.shield.seg = clamp(segs == null ? p.shield.max : segs, 0, p.shield.max);
  p.shield.lastHitAt = game.time; p.shield.regenT = 0;
  if (o.quiet) return;
  if (game.away.stats) game.away.stats.revives++;
  game.emit('revived', { pid: p.id, x: Math.round(p.x), y: Math.round(p.y) });
  game.emit('sfx', { name: 'revive_done', zone: p.zone, x: Math.round(p.x), y: Math.round(p.y) });
}

// Verwundet: kein Aufstehen von selbst, nach bleedout s Einzel-Notrückholung (CONTRACT-M2 §4.2)
function updateWounded(game, p, dt) {
  p.moving = false;
  if (p.zone !== 'away' || !isV2(game)) { revive(game, p, null, { quiet: true }); return; }
  p.downedFor += dt;
  p.bleed = Math.max(0, (p.bleed == null ? cfg(game).wounded.bleedout : p.bleed) - dt);
  if (p.bleed > 0) return;
  const it = interior();
  if (isDown(game.ship.systems.transfer)) {
    revive(game, p, cfg(game).wounded.reviveSegments);
    game.oda(`Transfer ausgefallen – ${p.name}, ich flicke deinen Schild aus der Ferne. Steh auf!`, null);
    return;
  }
  const map = game.away.map;
  it.placeOnShipPad(game, p);
  revive(game, p, null, { quiet: true });
  if (game.away.stats) game.away.stats.bleedRecalls++;
  game.emit('beam', { pids: [p.id], dir: 'up', map });
  game.emit('sfx', { name: 'beam' });
  game.explore.addLog(`Kesh: Notrückholung für ${p.name} – zu lange verwundet. Schild wieder voll.`, 'kesh');
  game.oda(`Notrückholung für ${p.name}! Schild wieder voll – über die Pads geht's zurück nach unten.`, null);
  game.missionEvent('beamedUp', { players: [p], map });
}

// Liegen alle Außenteam-Spieler verwundet: nach squadRecallDelay s Notrückholung aller (CONTRACT-M2 §4.6)
function updateSquadRecall(game, dt) {
  const aw = game.away; const C = cfg(game);
  const team = teamOf(game);
  if (!team.length || !team.every((p) => p.downed)) { aw.recallT = 0; return; }
  aw.recallT += dt;
  if (aw.recallT < C.wounded.squadRecallDelay) return;
  squadRecall(game);
}
function squadRecall(game) {
  const aw = game.away; const C = cfg(game); const it = interior();
  const list = game.players.filter((p) => p.zone === 'away');
  const map = aw.map;
  list.forEach((p, i) => { it.placeOnShipPad(game, p, i); p.beamLock = false; revive(game, p, null, { quiet: true }); });
  aw.recallT = 0;
  aw.recallLockUntil = game.time + C.wounded.recallBeamLock;
  if (aw.stats) aw.stats.squadRecalls++;
  const pids = list.map((p) => p.id);
  game.emit('squadRecall', { pids });
  game.emit('sfx', { name: 'squad_recall' });
  game.emit('beam', { pids, dir: 'up', map });
  game.explore.addLog('Kesh: Notrückholung des ganzen Außenteams. Niemand verloren – nur Stolz.', 'kesh');
  game.oda(`Notrückholung! Alle an Bord, Schilde voll. Der Transfer kühlt ${Math.round(C.wounded.recallBeamLock)} s ab.`, null);
  game.missionEvent('squadRecall', { pids });
  game.missionEvent('beamedUp', { players: list, map });
}

function updatePlayerShields(game, dt) {
  const C = cfg(game);
  for (const p of game.players) {
    if (p.zone !== 'away' || p.downed) continue;
    if (!p.shield) initShield(game, p);
    const sh = p.shield;
    sh.max = C.shield.segments;
    if (sh.seg > sh.max) sh.seg = sh.max;
    if (sh.seg >= sh.max) { sh.regenT = 0; continue; }
    if (game.time - sh.lastHitAt < C.shield.regenDelay) { sh.regenT = 0; continue; }
    sh.regenT += dt;
    if (sh.regenT < C.shield.regenStep) continue;
    sh.regenT = 0; sh.seg++;
    game.emit('shieldUp', { pid: p.id, seg: sh.seg });
    game.emit('sfx', { name: 'shield_up', zone: 'away', x: Math.round(p.x), y: Math.round(p.y), seg: sh.seg, max: sh.max });
    if (sh.seg >= sh.max) {
      game.emit('shieldFull', { pid: p.id });
      game.emit('sfx', { name: 'shield_full', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
    }
  }
}
function shieldProgress(game, p) {
  const sh = p.shield; const C = cfg(game);
  if (!sh || p.downed || sh.seg >= sh.max || game.time - sh.lastHitAt < C.shield.regenDelay) return 0;
  return Math.min(1, sh.regenT / Math.max(0.01, C.shield.regenStep));
}

// Medipacks (Nachschub vom Transfer) durch Darüberlaufen aufheben, höchstens 1 tragen (CONTRACT-M2 §4.2)
function updateMedkitPickup(game) {
  const aw = game.away;
  for (const p of game.players) {
    if (p.zone !== 'away' || p.downed || p.medkit) continue;
    const it = aw.items.find((i) => i.kind === 'medipack' && dist(i.x, i.y, p.x, p.y) <= 20);
    if (!it) continue;
    aw.items.splice(aw.items.indexOf(it), 1);
    p.medkit = 1;
    game.emit('sfx', { name: 'pickup', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
    game.notice(p, 'Medipack eingesteckt – damit belebst du schneller wieder (E halten).');
  }
}
function pickupMedkit(game, p, item) {
  if (p.medkit) { game.notice(p, 'Du trägst schon ein Medipack.'); return false; }
  const list = game.away.items; const i = list.indexOf(item);
  if (i < 0) return false;
  list.splice(i, 1); p.medkit = 1;
  game.emit('sfx', { name: 'pickup', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
  return true;
}

// ---------- Schießen und Projektile (CONTRACT-M2 §4.3) ----------
// v2-Projektile fliegen auf Fußhöhe (x/y = Füße wie Spieler/Gegner), damit Treffer, Sichtlinie und Deckung gleich rechnen.
function shoot(game, p, angle) {
  const C = cfg(game);
  if (p.zone !== 'away' || p.console || p.beamLock) return;
  if (!Number.isFinite(angle)) return;
  if (game.time < (p.shootReadyAt || 0)) return;
  const pistol = !!p.downed;
  p.shootReadyAt = game.time + (pistol ? C.wounded.pistolCooldown : C.blaster.cooldown);
  spawnProjectile(game, { kind: pistol ? 'pistol' : 'blaster', x: p.x, y: p.y, angle, speed: C.blaster.speed, ttl: C.blaster.ttl,
    dmg: 1, owner: p.id, team: 'player', crouch: !pistol && !!p.crouch });   // §15: geduckt -> eigene low-Deckung stoppt den Schuss
  game.emit('sfx', { name: pistol ? 'pistol' : 'blaster', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
}

function spawnProjectile(game, o) {
  const t = Physics.toTile(o.x, o.y);
  const q = Object.assign({ id: game.nextId('ap'), stx: t.x, sty: t.y, sx: o.x, sy: o.y, checked: [] }, o);
  game.away.projectiles.push(q);
  return q;
}

// Gegner feuert (nach abgeschlossener Ankündigung, CONTRACT-M2 §4.3)
function fireEnemy(game, e, target) {
  const C = cfg(game); const aw = game.away;
  const ec = C.enemy[e.kind] || C.enemy.scavenger;
  const spread = ((ec.spreadDeg || 0) * Math.PI / 180) * (aw.rng() * 2 - 1);
  const a = Math.atan2(target.y - e.y, target.x - e.x) + spread;
  const warden = e.kind === 'warden';
  const box = C.engageBox;
  const inBox = Math.abs(target.x - e.x) <= box.w / 2 && Math.abs(target.y - e.y) <= box.h / 2;
  if (aw.stats) { aw.stats.enemyShots++; if (!inBox) aw.stats.offBoxShots++; }
  spawnProjectile(game, { kind: warden ? 'warden' : 'enemy', x: e.x, y: e.y, angle: a, speed: ec.shotSpeed, ttl: C.shotTtl,
    dmg: warden ? (ec.shotSegments || 2) : 1, owner: e.id, team: 'enemy', target: target.id });
  game.emit('sfx', { name: warden ? 'warden_shot' : 'enemy_shot', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) });
}

// Schützt die halbe Deckung bei (tx,ty) ein mögliches Ziel in Flugrichtung? (8er-Nachbarschaft der Zielkachel)
function coverGuardsTarget(game, q, tx, ty) {
  const ca = Math.cos(q.angle), sa = Math.sin(q.angle);
  const ahead = (x, y) => (x - q.x) * ca + (y - q.y) * sa > 0;
  const near = (x, y) => { const t = Physics.toTile(x, y); return Math.abs(t.x - tx) <= 1 && Math.abs(t.y - ty) <= 1 && !(t.x === tx && t.y === ty); };
  if (q.team === 'player') return game.away.drones.some((e) => e.alive && near(e.x, e.y) && ahead(e.x, e.y));
  return game.players.some((p) => p.zone === 'away' && !p.downed && near(p.x, p.y) && ahead(p.x, p.y));
}

// §15: Liegt die low-Kachel (tx,ty) direkt neben einem geduckten Ziel des Projektils (Gegenseite, in Flugrichtung)?
function crouchGuardsTarget(game, E, q, tx, ty) {
  const ca = Math.cos(q.angle), sa = Math.sin(q.angle);
  const ahead = (o) => (o.x - q.x) * ca + (o.y - q.y) * sa > 0;
  const guards = (o) => o.crouch && ahead(o) && Los.lowGuard(E.map, E.solid, o.x, o.y, tx, ty);
  if (q.team === 'player') return game.away.drones.some((e) => e.alive && guards(e));
  return game.players.some((p) => p.zone === 'away' && !p.downed && guards(p));
}
// §15: Ausweichwurf eines geduckten Ziels, einmal je Projektil und Ziel (true = verfehlt)
function dodged(game, q, id) {
  if (!q.dodge) q.dodge = {};
  if (q.dodge[id] == null) {
    const miss = game.away.rng() < clamp(Number(crouchCfg(game).dodge) || 0, 0, 1);
    q.dodge[id] = miss;
    if (miss && game.away.stats) game.away.stats.dodges = (game.away.stats.dodges || 0) + 1;
  }
  return q.dodge[id];
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

function updateProjectiles(game, dt) {
  const C = cfg(game); const aw = game.away; const E = env(game);
  const keep = [];
  for (const q of aw.projectiles) {
    q.ttl -= dt;
    const len = q.speed * dt;
    const steps = Math.max(1, Math.ceil(len / 8));
    const ca = Math.cos(q.angle), sa = Math.sin(q.angle);
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      const x0 = q.x, y0 = q.y;
      const x1 = x0 + ca * len / steps, y1 = y0 + sa * len / steps;
      // Kacheln auf dem Teilstück: Wand stoppt immer, halbe Deckung schluckt mit halfCoverBlock (CONTRACT-M2 §4.3)
      let stop = null;
      Los.walk(x0, y0, x1, y1, (tx, ty) => {
        if (E.blocked(tx, ty)) { stop = { kind: 'wall', tx, ty }; return true; }
        if (!E.solid(tx, ty)) return false;
        const info = E.map.info(tx, ty);
        if (!(info.low && info.cover)) return false;
        // §15 Ducken: low-Kachel neben dem geduckten Schützen bzw. neben einem geduckten Ziel stoppt zu 100 %
        if (q.crouch && Math.max(Math.abs(tx - q.stx), Math.abs(ty - q.sty)) <= 1) { stop = { kind: 'cover', tx, ty, crouch: true }; return true; }
        if (crouchGuardsTarget(game, E, q, tx, ty)) { stop = { kind: 'cover', tx, ty, crouch: true }; return true; }
        if (Math.max(Math.abs(tx - q.stx), Math.abs(ty - q.sty)) <= 1) return false;   // Deckung am Schützen: drüber hinweg
        const key = tx + ',' + ty;
        if (q.checked.includes(key)) return false;
        if (!coverGuardsTarget(game, q, tx, ty)) return false;                           // keine Zieldeckung: drüber hinweg
        q.checked.push(key);
        if (aw.rng() < C.halfCoverBlock) { stop = { kind: 'cover', tx, ty }; return true; }
        return false;
      });
      if (stop) {
        dead = true;
        if (stop.kind === 'cover') {
          if (aw.stats) { aw.stats.coverBlocks++; if (stop.crouch) aw.stats.crouchBlocks = (aw.stats.crouchBlocks || 0) + 1; }
          const cx = stop.tx * TILE + TILE / 2, cy = stop.ty * TILE + TILE / 2;
          game.emit('coverHit', { x: cx, y: cy });
          game.emit('sfx', { name: 'cover_hit', zone: 'away', x: cx, y: cy });
        }
        break;
      }
      // Treffer
      if (q.team === 'player') {
        for (const e of aw.drones) {
          if (!e.alive) continue;
          const r = (C.hitRadius && C.hitRadius[e.kind]) || 13;
          if (segDist(e.x, e.y, x0, y0, x1, y1) < r) {
            if (e.crouch && dodged(game, q, e.id)) continue;   // §15: kleineres Ziel – Schuss fliegt vorbei
            dead = true; hitEnemy(game, e, q.dmg || 1, { x: q.sx, y: q.sy, pid: q.owner }); break; }
        }
      } else {
        for (const p of game.players) {
          if (p.zone !== 'away' || p.downed) continue;
          if (segDist(p.x, p.y, x0, y0, x1, y1) < ((C.hitRadius && C.hitRadius.player) || 12)) {
            if (p.crouch && dodged(game, q, p.id)) continue;   // §15: kleineres Ziel – Schuss fliegt vorbei
            dead = true;
            const box = C.engageBox;
            if (aw.stats) {
              aw.stats.playerHits++;
              if (Math.abs(p.x - q.sx) > box.w / 2 + 48 || Math.abs(p.y - q.sy) > box.h / 2 + 48) aw.stats.offBoxHits++;
            }
            hitPlayer(game, p, q.dmg || 1, q.kind);
            break;
          }
        }
      }
      q.x = x1; q.y = y1;
    }
    if (!dead && q.ttl > 0) keep.push(q);
  }
  aw.projectiles = keep;
}

// ---------- Gegner: Treffer, Schilde (CONTRACT-M2 §4.4/§4.5) ----------
function hitEnemy(game, e, segs, src) {
  const C = cfg(game); const aw = game.away;
  if (!e.alive) return 'dead';
  const s = src || {};
  squad.onEnemyHit(game, e, s);
  if (e.asleep) {
    if (e.kind === 'warden') { game.emit('wardenDeflect', { id: e.id, x: Math.round(e.x), y: Math.round(e.y) }); game.emit('sfx', { name: 'warden_deflect', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) }); }
    return 'asleep';
  }
  if (e.kind === 'warden' && !s.strike && Number.isFinite(s.x)) {
    const rel = Physics.normAngle(Math.atan2(s.y - e.y, s.x - e.x) - e.facing);
    if (Math.abs(rel) <= (C.enemy.warden.frontArc * Math.PI / 180) / 2) {
      if (aw.stats) aw.stats.deflects++;
      game.emit('wardenDeflect', { id: e.id, x: Math.round(e.x), y: Math.round(e.y) });
      game.emit('sfx', { name: 'warden_deflect', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) });
      return 'deflect';
    }
  }
  e.lastHitAt = game.time; e.regenT = 0; e.hitT = game.time;
  const n = Math.max(1, segs || 1);
  if (e.seg > 0) {
    e.seg = Math.max(0, e.seg - n); e.hp = e.seg;
    game.emit('enemyShieldHit', { id: e.id, seg: e.seg, x: Math.round(e.x), y: Math.round(e.y) });
    if (n <= 1 || s.strike) return 'shield';
    return 'shield';
  }
  knockOut(game, e);
  return 'down';
}
function knockOut(game, e) {
  e.alive = false; e.aim = null; e.seg = 0; e.hp = 0; e.path = null; e.vis = false; e.ghost = null; e.crouch = false;
  // Abweichung §7: Feld heißt enemyKind, weil `kind` im Event-Objekt der Ereignisname ist ({ t:'event', kind:'enemyDown' })
  game.emit('enemyDown', { id: e.id, enemyKind: e.kind, x: Math.round(e.x), y: Math.round(e.y) });
  game.emit('sfx', { name: 'drone_die', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) });
  game.emit('explosion', { x: Math.round(e.x), y: Math.round(e.y), zone: 'away' });
  game.missionEvent('droneKilled', { kind: e.kind });
  if (e.kind === 'warden') {
    game.emit('wardenDown', { id: e.id, x: Math.round(e.x), y: Math.round(e.y) });
    game.missionEvent('wardenKilled', {});
  }
  squad.onEnemyDown(game, e);
}
// Orbitalschlag: strikeSegments Treffer, unabhängig von der Wächter-Front (schlafender Wächter bleibt unverwundbar)
function strikeEnemy(game, e) {
  const n = cfg(game).strikeSegments;
  for (let i = 0; i < n && e.alive; i++) hitEnemy(game, e, 1, { strike: true });
}

function updateEnemyShields(game, dt) {
  const C = cfg(game);
  for (const e of game.away.drones) {
    if (!e.alive || e.asleep || e.seg >= e.max) { e.regenT = 0; continue; }
    const ec = C.enemy[e.kind] || C.enemy.scavenger;
    if (game.time - e.lastHitAt < ec.regenDelay) { e.regenT = 0; continue; }
    e.regenT += dt;
    if (e.regenT < ec.regenStep) continue;
    e.regenT = 0; e.seg++; e.hp = e.seg;
    if (e.seg >= e.max) squad.onShieldFull(game, e);
  }
}

// ---------- Fog of War, Deckung der Spieler (CONTRACT-M2 §6, §7 cv/fl) ----------
function updateVisibility(game) {
  const C = cfg(game); const aw = game.away; const E = env(game);
  const team = teamOf(game);
  const R = C.sightTiles * TILE;
  const sensor = game.time < aw.sensorUntil;
  for (const e of aw.drones) {
    if (!e.alive) { e.vis = false; e.ghost = null; continue; }
    let seen = false;
    for (const p of team) {
      if (dist(p.x, p.y, e.x, e.y) <= R && losBetween(E, p, e)) { seen = true; break; }   // §15: Ducken sperrt beidseitig
    }
    if (seen) { e.seenAt = game.time; e.seenX = e.x; e.seenY = e.y; }
    e.vis = seen || sensor || game.time < (e.focusUntil || 0);
    e.ghost = !e.vis && e.seenAt > -50 && game.time - e.seenAt < C.ghostTime ? { x: r1(e.seenX), y: r1(e.seenY), t: r2(e.seenAt) } : null;
  }
  // Deckung gegen den gefährlichsten sichtbaren Gegner (zielt auf mich > nächster), offene Flanke
  for (const p of game.players) {
    if (p.zone !== 'away') { p.cv = 0; p.fl = false; continue; }
    const danger = [];
    for (const e of aw.drones) {
      if (!e.alive || e.asleep || !squad.isAlert(game, e)) continue;
      if (dist(p.x, p.y, e.x, e.y) > R) continue;
      if (!Los.lineOfSight(E.blocked, e.x, e.y, p.x, p.y)) continue;
      danger.push(e);
    }
    // §15: Geduckt hinter niedriger Deckung zählt als volle Deckung (cv 2), auch solange kein Gegner in Sicht ist.
    // Die Gefahrenliste nutzt die Sicht ohne Ducken, damit cv die Deckung gegen den Gegner vor der Mauer zeigt.
    const crouched = !!p.crouch && !p.downed;
    if (!danger.length) { p.cv = crouched && Los.nextToLow(E.map, E.solid, p.x, p.y) ? 2 : 0; p.fl = false; continue; }
    danger.sort((a, b) => ((b.aim && b.aim.target === p.id) ? 1 : 0) - ((a.aim && a.aim.target === p.id) ? 1 : 0) || dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
    const covers = danger.map((e) => Los.coverAgainst(E.map, E.solid, e.x, e.y, p.x, p.y, crouched));
    p.cv = covers[0];
    // Offene Flanke: ein bemerkender Gegner mit Sichtlinie trifft ohne Deckung, obwohl der Spieler an Deckung steht
    p.fl = covers.some((c) => c === 0) && nextToCover(E, p);
  }
}
function nextToCover(E, p) {
  const t = Physics.toTile(p.x, p.y);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const info = E.map.info(t.x + dx, t.y + dy);
    if (info.cover && E.solid(t.x + dx, t.y + dy) && info.kind !== 'rock' && info.kind !== 'wall_ruin') return true;
  }
  return false;
}

function scanQuality(game, aw) {
  const a = aw || game.away;
  if (!a.jammers || !a.jammers.length) return 1;
  return a.jammers.every((j) => j.off) ? 1 : cfg(game).scanQualityJammed;
}

// ---------- Captain-Befehle (CONTRACT-M2 §6) ----------
function order(game, msg) {
  const C = cfg(game); const aw = game.away;
  const kind = typeof msg.kind === 'string' ? msg.kind : '';
  if (!aw.orders) aw.orders = [];
  if (msg.clear) {
    if (msg.id != null) aw.orders = aw.orders.filter((o) => o.id !== String(msg.id));
    else if (kind) aw.orders = aw.orders.filter((o) => o.kind !== kind);
    else aw.orders = [];
    return null;
  }
  if (!Protocol.ORDER_KINDS.includes(kind)) return 'Unbekannter Befehl.';
  const map = infoOf(aw).map;
  let x = Number(msg.x), y = Number(msg.y);
  let target = null;
  if (kind === 'fokus') {
    const e = aw.drones.find((d) => d.id === String(msg.target) && d.alive);
    if (!e) return 'Fokus: Bitte einen Gegner anklicken.';
    target = e.id;
    if (!Number.isFinite(x) || !Number.isFinite(y)) { x = e.x; y = e.y; }
    e.focusUntil = game.time + C.orders.focusTime;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Befehl braucht einen Punkt auf der Karte.';
  x = Math.round(clamp(x, 0, map.w * TILE)); y = Math.round(clamp(y, 0, map.h * TILE));
  aw.orders = aw.orders.filter((o) => o.kind !== kind);
  while (aw.orders.length >= Math.max(1, C.orders.max)) aw.orders.shift();
  const o = { id: game.nextId('o'), kind, x, y, target, until: game.time + C.orders.ttl };
  aw.orders.push(o);
  game.emit('order', { orderKind: kind, x, y, target, id: o.id });   // Abweichung §7: orderKind statt kind (s. enemyDown)
  game.emit('sfx', { name: 'order', zone: 'away', x, y });
  game.missionEvent('order', { kind });
  return null;
}

// ---------- Kesh-Interaktionen (CONTRACT-M2 §4.7) ----------
function interactionsAt(game, p, tx, ty, ch, list) {
  const aw = game.away;
  if (aw.map !== 'kesh') return;
  if (ch === 'r') {
    const i = aw.jammers.findIndex((j) => j.x === tx && j.y === ty);
    if (i >= 0 && !aw.jammers[i].off) list.push({ kind: 'jammer', i });
    else if (i >= 0) list.push({ kind: 'jammer', blocked: 'Störrelais ist schon aus.' });
  }
  if (ch === 'k') {
    const i = aw.keys.findIndex((k) => k.x === tx && k.y === ty);
    if (i < 0) return;
    if (aw.vault.open) list.push({ kind: 'archkey', blocked: 'Das Tor steht schon offen.' });
    else if (aw.keys[i].doneAt != null) list.push({ kind: 'archkey', blocked: 'Gedreht! Jetzt muss der zweite Schlüssel – sofort.' });
    else list.push({ kind: 'archkey', i });
  }
  if (ch === 'T') {
    if (!aw.vault.open) list.push({ kind: 'tablet', blocked: 'Das Gewölbe ist verschlossen.' });
    else if (aw.tablet.taken) list.push({ kind: 'tablet', blocked: 'Der Sockel ist leer – die Tafel ist schon bei uns.' });
    else list.push({ kind: 'tablet' });
  }
}
function holdDuration(game, p, kind) {
  const C = cfg(game);
  if (kind === 'revive') return p.medkit ? C.wounded.medkitReviveTime : C.wounded.reviveTime;
  if (kind === 'jammer') return C.jammerTime;
  if (kind === 'archkey') return C.archkeyTime;
  if (kind === 'tablet') return C.tabletTime;
  return 1;
}
function holdValid(game, p, h) {
  const aw = game.away;
  if (p.zone !== 'away' || aw.map !== 'kesh') return false;
  if (h.kind === 'jammer') return !!aw.jammers[h.i] && !aw.jammers[h.i].off;
  if (h.kind === 'archkey') return !aw.vault.open && !!aw.keys[h.i] && aw.keys[h.i].doneAt == null;
  if (h.kind === 'tablet') return aw.vault.open && !aw.tablet.taken;
  return false;
}
function completeHold(game, p, h) {
  if (h.kind === 'jammer') jammerOff(game, p, h.i);
  else if (h.kind === 'archkey') keyTurned(game, p, h.i);
  else if (h.kind === 'tablet') takeTablet(game, p);
}
// Wiederbeleben auf v2-Karten (Zeiten/Segmente aus §4.2; Medipack wird verbraucht)
function completeRevive(game, p, h) {
  const C = cfg(game); const t = h.target;
  if (!t || !t.downed) return;
  const kit = h.medkit && p.medkit > 0;
  if (kit) p.medkit = 0;
  revive(game, t, kit ? C.wounded.medkitSegments : C.wounded.reviveSegments);
  game.oda(`${t.name} ist wieder auf den Beinen${kit ? ' – dank Medipack mit zwei Segmenten' : ''}. Deckung suchen!`, null);
}

function jammerOff(game, p, i) {
  const aw = game.away; const j = aw.jammers[i];
  if (!j || j.off) return;
  j.off = true;
  const x = j.x * TILE + TILE / 2, y = j.y * TILE + TILE / 2;
  game.emit('jammerOff', { i, x, y });
  game.emit('sfx', { name: 'jammer_off', zone: 'away', x, y });
  if (aw.jammers.every((q) => q.off)) game.oda('Beide Störrelais aus – der Captain sieht jetzt scharf. Schilde, Rollen, alles.', null);
  else game.oda('Störrelais aus! Eins fehlt noch, dann ist der Captain-Scan klar.', null);
  game.missionEvent('jammerOff', { i });
}
// QA M2: Ist nur noch ein Spieler verbunden, reicht das Zeitfenster zum Hinüberlaufen (sonst Sackgasse am Tor)
function keyWindow(game) {
  const C = cfg(game);
  const solo = game.players.filter((p) => p.connected).length <= 1;
  return solo ? Math.max(C.archkeyWindow, C.archkeySoloWindow || 0) : C.archkeyWindow;
}
function keyTurned(game, p, i) {
  const C = cfg(game); const aw = game.away; const k = aw.keys[i];
  if (!k || aw.vault.open) return;
  k.doneAt = game.time;
  const x = k.x * TILE + TILE / 2, y = k.y * TILE + TILE / 2;
  game.emit('sfx', { name: 'archkey', zone: 'away', x, y });
  const other = aw.keys.find((o, j) => j !== i && o.doneAt != null && game.time - o.doneAt <= keyWindow(game));
  if (other) openVault(game);
  else game.missionEvent('archkeyTurned', { i });
}
function openVault(game) {
  const aw = game.aways.kesh;
  if (aw.vault.open) return;
  aw.vault.open = true;
  for (const k of aw.keys) { k.doneAt = null; k.t = 1; }
  const g = W.AWAY_MAPS.kesh.gate;
  const x = g.length ? Math.round(g.reduce((s, t) => s + t.x, 0) / g.length * TILE + TILE / 2) : 0;
  const y = g.length ? g[0].y * TILE + TILE / 2 : 0;
  game.emit('vaultOpen', { x, y });
  game.emit('sfx', { name: 'vault_open', zone: 'away', x, y });
  game.missionEvent('vaultOpened', {});
}
function takeTablet(game, p) {
  const aw = game.aways.kesh;
  if (aw.tablet.taken) return;
  aw.tablet.taken = true; aw.tablet.by = p ? p.id : null;   // QA M2: Träger für den Wächter-Schritt (tabletInCourtyard)
  game.inventory.tafel = (game.inventory.tafel || 0) + 1;
  const x = aw.tablet.x * TILE + TILE / 2, y = aw.tablet.y * TILE + TILE / 2;
  game.emit('tabletTaken', { pid: p ? p.id : null, x, y });
  game.emit('sfx', { name: 'tablet', zone: 'away', x, y });
  game.missionEvent('tabletTaken', { p });
}
// Schlüssel: Fortschritt 0..1 für den Snapshot; einer allein -> Hinweis und Rücksetzen (§4.7)
function updateKeys(game) {
  const C = cfg(game); const aw = game.away;
  if (!aw.keys) return;
  for (let i = 0; i < aw.keys.length; i++) {
    const k = aw.keys[i];
    if (aw.vault.open) { k.t = 1; continue; }
    if (k.doneAt != null) {
      if (game.time - k.doneAt > keyWindow(game)) {
        k.doneAt = null; k.t = 0;
        if (game.time - aw.keyHintAt > 6) { aw.keyHintAt = game.time; game.oda('Beide Schlüssel gleichzeitig – einer allein reicht dem Archiv nicht.', null); }
        game.emit('sfx', { name: 'code_fail', zone: 'away', x: k.x * TILE + 16, y: k.y * TILE + 16 });
      } else { k.t = 1; continue; }
    }
    let t = 0;
    for (const p of game.players) if (p.zone === 'away' && p.hold && p.hold.kind === 'archkey' && p.hold.i === i) t = Math.max(t, p.hold.t / p.hold.dur);
    k.t = Math.min(1, t);
  }
}

// ---------- Trupps / Wächter (Mission, Debug) ----------
function spawnSquad(game, name, opts) { return squad.spawnSquad(game, name, opts); }
function wakeWarden(game) { return squad.wakeWarden(game); }

// ---------- Update (alle Ticks, nur v2-Karten, nur wenn away.active) ----------
function update(game, dt) {
  const aw = game.away;
  game.safe('combat-shields', () => updatePlayerShields(game, dt));
  game.safe('combat-squadRecall', () => updateSquadRecall(game, dt));
  game.safe('combat-medkit', () => updateMedkitPickup(game));
  game.safe('combat-ai', () => squad.update(game, dt));
  game.safe('combat-enemyShields', () => updateEnemyShields(game, dt));
  game.safe('combat-projectiles', () => updateProjectiles(game, dt));
  game.safe('combat-keys', () => updateKeys(game));
  aw.visT = (aw.visT || 0) + dt;
  if (aw.visT >= 1 / Math.max(1, cfg(game).aiHz)) { aw.visT = 0; game.safe('combat-vis', () => updateVisibility(game)); }
  if (aw.orders && aw.orders.length) aw.orders = aw.orders.filter((o) => o.until > game.time);
}

// ---------- Debug `tune` (CONTRACT-M2 §8) ----------
function tuneList(C) {
  const out = [];
  const walk = (o, pre) => {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'barks') continue;
      if (typeof v === 'number') out.push(pre + k + '=' + v);
      else if (typeof v === 'boolean' && k !== 'barksOn') out.push(pre + k + '=' + (v ? 'on' : 'off'));
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, pre + k + '.');
    }
  };
  walk(C, '');
  return 'barks=' + (C.barksOn ? 'on' : 'off') + ' · ' + out.join(' · ');
}
function tune(game, path, value) {
  const C = cfg(game);
  if (!path) return { ok: true, text: tuneList(C) };
  if (path === 'barks') {
    const v = String(value).toLowerCase();
    if (!['on', 'off', '1', '0', 'true', 'false'].includes(v)) return { ok: false, text: 'tune barks on|off' };
    C.barksOn = v === 'on' || v === '1' || v === 'true';
    return { ok: true, text: 'barks = ' + (C.barksOn ? 'on' : 'off') };
  }
  const keys = String(path).split('.');
  // QA M3a: Pfade, die nicht unter awayCombat liegen (spaceM3.*, combat.*, crewScaling.* …), gelten für die ganze
  // Konfiguration – CONTRACT-M3 §10/§17 verlangt `tune spaceM3.<pfad> <wert>`. awayCombat-Pfade haben Vorrang (wie bisher).
  let o = (C[keys[0]] === undefined && game.C[keys[0]] !== undefined && keys[0] !== 'awayCombat') ? game.C : C;
  for (let i = 0; i < keys.length - 1; i++) {
    o = o[keys[i]];
    if (!o || typeof o !== 'object' || Array.isArray(o) || keys[i] === 'barks') return { ok: false, text: 'Unbekannter Pfad: ' + path };
  }
  const last = keys[keys.length - 1];
  if (typeof o[last] === 'boolean') {   // §15: z. B. tune crouch.enemyCrouch off
    const v = String(value).toLowerCase();
    if (!['on', 'off', '1', '0', 'true', 'false'].includes(v)) return { ok: false, text: 'tune ' + path + ' on|off' };
    o[last] = v === 'on' || v === '1' || v === 'true';
    return { ok: true, text: path + ' = ' + (o[last] ? 'on' : 'off') };
  }
  if (typeof o[last] !== 'number') return { ok: false, text: 'Kein Zahlenwert: ' + path };
  const v = Number(value);
  if (!Number.isFinite(v)) return { ok: false, text: 'Wert muss eine Zahl sein.' };
  o[last] = v;
  return { ok: true, text: path + ' = ' + v };
}

// ---------- Snapshot-Teile (CONTRACT-M2 §7) ----------
function playerSnap(game, p) {
  const v2 = p.zone === 'away' && isV2(game);
  return {
    sh: v2 && p.shield ? [p.shield.seg, p.shield.max] : null,
    shR: v2 ? r2(shieldProgress(game, p)) : 0,
    cv: v2 ? (p.cv || 0) : 0,
    fl: v2 ? !!p.fl : false,
    medkit: p.medkit ? 1 : 0,
    bleed: v2 && p.downed && p.bleed != null ? r1(p.bleed) : null,
    cr: v2 && !!p.crouch && !p.downed,   // §15
  };
}
function droneSnap(game, e, base) {
  const C = cfg(game);
  base.sh = [e.seg, e.max];
  base.role = e.role || 'idle';
  base.vis = !!e.vis;
  base.ghost = e.ghost || null;
  base.aim = e.aim ? { target: e.aim.target, p: r2(Math.min(1, (game.time - e.aim.t0) / Math.max(0.01, e.aim.dur))) } : null;
  if (e.kind === 'warden') base.facing = Math.round(e.facing * 1000) / 1000;
  base.asleep = !!e.asleep;
  base.cr = !!e.crouch && e.alive !== false;   // §15
  if (C) base.squad = e.squad || null;
  // M4 (Wunsch ACTORS): festes Ausrüstungs-Kit je Plünderer 0 Schütze / 1 Flanker / 2 Funker – einmal vergeben
  // (Reihenfolge im Trupp), bleibt stabil, unabhängig von der wechselnden Rolle (role).
  if (e.kind === 'scavenger') {
    if (e.kit == null) e.kit = game.away.drones.filter((d) => d !== e && d.kind === 'scavenger' && (d.squad || null) === (e.squad || null) && d.kit != null).length % 3;
    base.kit = e.kit;
  }
  return base;
}
function awaySnap(game, aw) {
  if (!isV2Away(aw)) return { combat: null, scanQuality: 1, vault: null, jammers: [], keys: [], tablet: null, orders: [] };
  return {
    combat: 'v2', scanQuality: scanQuality(game, aw),
    vault: { open: aw.vault.open },
    jammers: aw.jammers.map((j) => ({ x: j.x, y: j.y, off: j.off })),
    keys: aw.keys.map((k) => ({ x: k.x, y: k.y, t: r2(k.t || 0) })),
    tablet: { x: aw.tablet.x, y: aw.tablet.y, taken: aw.tablet.taken },
    orders: (aw.orders || []).map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y, target: o.target, until: r2(o.until) })),
  };
}

module.exports = {
  makeKesh, isV2, isV2Away, playerOnV2, onArrive, onLeave, hitPlayer, woundPlayer, revive, updateWounded, squadRecall,
  shoot, fireEnemy, hitEnemy, strikeEnemy, knockOut, order, interactionsAt, holdDuration, holdValid, completeHold, completeRevive,
  jammerOff, keyTurned, openVault, takeTablet, spawnSquad, wakeWarden, update, updateVisibility, scanQuality, tune, tuneList,
  playerSnap, droneSnap, awaySnap, pickupMedkit, fullShield, env, teamOf,
  losBetween, setCrouch, checkCrouch, canCrouch, speedFactor, crouchCfg,
};
