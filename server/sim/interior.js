'use strict';
// Schiffsinneres + Außenkarten (B-7-Plattform, Wrack): Laufen, Interaktion (§4.2), Tragen, Feuer, Lecks, O₂-Folgen,
// Downed/Revive, Reaktorschalter (M1 §6), Planungstisch (M1 §8), Offline-Systeme (EMP, M1 §5).
const Physics = require('../../shared/physics.js');
const W = require('../world.js');
const { DIRS, NEIGHBOR_ORDER, dist } = require('../util.js');

const TILE = Physics.TILE;
let combatMod = null;   // M2: Kampf v2 (lazy, wegen Zirkelbezug combat -> interior)
const combat = () => combatMod || (combatMod = require('./combat.js'));
const SYSTEM_ORDER = ['reactor', 'engines', 'shields', 'weapons', 'life', 'transfer'];
const isDown = (st) => st === 'broken' || st === 'offline';

// ---------- Kollision ----------
function awayInfo(game) { return W.AWAY_MAPS[(game.away && game.away.map) || 'platform']; }
function awaySolid(game) {
  const aw = game.away; const map = awayInfo(game).map;
  return (tx, ty) => {
    const ch = map.at(tx, ty);
    if (ch === 'L' && aw.map === 'platform') return !aw.sonde.disabled;
    if (ch === 'V' && aw.map === 'wreck') return !(aw.hollow && aw.hollow.open);
    if (ch === 'G' && aw.map === 'kesh') return !(aw.vault && aw.vault.open);
    return map.solid(tx, ty);
  };
}
const platformSolid = awaySolid;   // Altname (Tests/Tools)
function solidFor(game, zone) {
  return zone === 'away' ? awaySolid(game) : (tx, ty) => W.ship.solid(tx, ty);
}
function mapFor(game, zone) { return zone === 'away' ? awayInfo(game).map : W.ship; }

// ---------- Spieler-Bewegung ----------
function updatePlayers(game, dt) {
  const C = game.C;
  for (const p of game.players) {
    if (!p.connected && !p.downed) { p.moving = false; continue; }
    if (p.downed) { if (p.wound) combat().updateWounded(game, p, dt); else updateDowned(game, p, dt); continue; }
    if (p.crouch) combat().checkCrouch(game, p);   // M2 §15: Konsole/Beamen/Zonenwechsel beenden das Ducken
    let mx = p.input.mx, my = p.input.my;
    if (p.console || p.beamLock) { mx = 0; my = 0; }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    p.moving = len > 0.05;
    if (p.moving) {
      if (Math.abs(mx) > Math.abs(my)) p.dir = mx > 0 ? 'right' : 'left';
      else p.dir = my > 0 ? 'down' : 'up';
      const speed = C.player.speed * (p.carry ? C.player.carrySpeedFactor : 1) * (p.crouch ? combat().speedFactor(game, p) : 1);
      const res = Physics.moveWithCollision(solidFor(game, p.zone), p.x, p.y, mx * speed * dt, my * speed * dt, C.player.hitbox);
      p.x = res.x; p.y = res.y;
    }
    if (p.zone === 'ship' && !p.console && !p.beamLock) applyBreachPull(game, p, dt);
    if (p.hold) updateHold(game, p, dt);
    if (p.zone === 'ship') {
      const t = Physics.toTile(p.x, p.y);
      if (game.ship.fireList.some((f) => f.tx === t.x && f.ty === t.y)) damagePlayer(game, p, C.fire.playerDps * dt, 'fire');
      if (game.ship.o2 <= 0) damagePlayer(game, p, C.o2.suffocateDps * dt, 'o2');
    }
    if (p.carry === 'medipack' && p.hp < 50 && !p.downed) { p.carry = null; healPlayer(game, p, C.support.supply.heal); }
  }
}

function applyBreachPull(game, p, dt) {
  const C = game.C;
  for (const b of game.ship.breachList) {
    const c = W.tileCenter(b.tx, b.ty);
    const d = dist(p.x, p.y, c.x, c.y);
    if (d < 4 || d > C.breach.pullRadius * TILE) continue;
    const s = C.breach.pullSpeed * dt;
    const res = Physics.moveWithCollision(solidFor(game, 'ship'), p.x, p.y, (c.x - p.x) / d * s, (c.y - p.y) / d * s, C.player.hitbox);
    p.x = res.x; p.y = res.y;
  }
}

// ---------- Schaden / Downed ----------
function damagePlayer(game, p, dmg, source) {
  if (p.downed || dmg <= 0) return;
  if (game.god) return;
  if (p.zone === 'away' && combat().isV2(game)) { combat().hitPlayer(game, p, 1, source); return; }   // M2: jeder Treffer = 1 Segment
  if (p.zone === 'away' && game.away.kuppelHp > 0 && game.time < game.away.kuppelUntil) {
    const a = Math.min(game.away.kuppelHp, dmg);
    game.away.kuppelHp -= a; dmg -= a;
    if (dmg <= 0) return;
  }
  p.hp = Math.max(0, p.hp - dmg);
  if (p.hp <= 0) downPlayer(game, p, source);
}

function healPlayer(game, p, amount) {
  p.hp = Math.min(game.C.player.hp, p.hp + amount);
  game.emit('sfx', { name: 'heal', zone: p.zone, x: Math.round(p.x), y: Math.round(p.y) });
}

function downPlayer(game, p, source) {
  p.downed = true; p.downedFor = 0; p.hp = 0;
  if (p.console) leaveConsole(game, p);
  p.console = null; p.hold = null; p.input.mx = 0; p.input.my = 0;
  if (p.carry) dropCarry(game, p);
  game.oda(p.zone === 'away'
    ? `${p.name} ist am Boden! E halten zum Wiederbeleben – sonst hole ich dich in 15 s.`
    : `${p.name} ist k.o.! Jemand E halten zum Aufhelfen – sonst rappelst du dich in 15 s auf.`, null);
}

function revivePlayer(game, p) {
  p.downed = false; p.downedFor = 0; p.hp = game.C.player.revivedHp;
  p.hold = null;
}

function updateDowned(game, p, dt) {
  p.moving = false;
  p.downedFor += dt;
  if (p.downedFor < game.C.player.autoReviveTime) return;
  if (p.zone === 'away') {
    if (!isDown(game.ship.systems.transfer)) {
      placeOnShipPad(game, p);
      game.emit('beam', { pids: [p.id], dir: 'up' });
      game.oda(`Notrückholung für ${p.name}. Willkommen zurück, ganz ohne Kratzer. Fast.`, null);
    } else {
      placeOnAwayPad(game, p);
    }
  }
  revivePlayer(game, p);
}

function placeOnShipPad(game, p, idx) {
  const pads = W.SHIP_PADS;
  const i = idx != null ? idx : game.players.filter((o) => o !== p && o.zone === 'ship').length;
  const c = W.tileCenter(pads[i % pads.length].x, pads[i % pads.length].y);
  if (p.zone === 'away' && combat().isV2(game)) combat().onLeave(game, p);   // M2: Medipack zurück, Wunde heilt
  p.zone = 'ship'; p.x = c.x; p.y = c.y; p.console = null; p.hold = null;
}
function placeOnAwayPad(game, p, idx) {
  const pads = awayInfo(game).pads;
  const i = idx != null ? idx : game.players.filter((o) => o !== p && o.zone === 'away').length;
  const c = W.tileCenter(pads[i % pads.length].x, pads[i % pads.length].y);
  const arriving = p.zone !== 'away';
  p.zone = 'away'; p.x = c.x; p.y = c.y; p.console = null; p.hold = null;
  if (arriving && combat().isV2(game)) combat().onArrive(game, p);   // M2: voller Schild + Medipack
}
const placeOnPlatformPad = placeOnAwayPad;

// ---------- Tragen ----------
function dropCarry(game, p) {
  if (!p.carry) return;
  const t = Physics.toTile(p.x, p.y);
  const c = W.tileCenter(t.x, t.y);
  const item = { id: game.nextId('i'), kind: p.carry, x: c.x, y: c.y };
  if (p.carry === 'loeschgel') item.charges = p.carryCharges;
  if (p.zone === 'away') game.away.items.push(item);
  else game.ship.groundItems.push(item);
  p.carry = null; p.carryCharges = 0;
  game.emit('sfx', { name: 'drop', zone: p.zone, x: c.x, y: c.y });
}

function onDrop(game, p) {
  if (p.downed || p.console) return;
  if (!p.carry) return game.notice(p, 'Du trägst nichts.');
  dropCarry(game, p);
}

// ---------- Interaktion (§4.2) ----------
const PRIORITY = { revive: 1, extinguish: 2, patch: 3, repair: 4, reboot: 4, switch: 4, salvage: 4, hollow: 4, jammer: 4, archkey: 4, tablet: 4, console: 5, lore: 5, shelf: 6, bed: 7, pickup: 8, npc: 8, npcHeal: 8, selfbeam: 9 };

function candidateTiles(p) {
  const t = Physics.toTile(p.x, p.y);
  const out = [];
  const add = (x, y) => { if (!out.some((o) => o.x === x && o.y === y)) out.push({ x, y }); };
  const d = DIRS[p.dir] || DIRS.down;
  add(t.x + d.x, t.y + d.y);
  add(t.x, t.y);
  for (const n of NEIGHBOR_ORDER) add(t.x + DIRS[n].x, t.y + DIRS[n].y);
  // QA M1: Toleranz an Kachelgrenzen. Steht die Figur nur wenige Pixel neben der Kachel, die der Client für den
  // E-Hinweis benutzt (Vorhersage vs. Server), sollen Hinweis und Aktion trotzdem übereinstimmen.
  for (const [ox, oy] of [[0, 4], [0, -4], [4, 0], [-4, 0]]) {
    const t2 = Physics.toTile(p.x + ox, p.y + oy);
    if (t2.x === t.x && t2.y === t.y) continue;
    add(t2.x + d.x, t2.y + d.y);
    for (const n of NEIGHBOR_ORDER) add(t2.x + DIRS[n].x, t2.y + DIRS[n].y);
  }
  return out;
}

function consoleOccupant(game, p, kind) {
  if (kind === 'plan') return null;   // Planungstisch: nicht exklusiv (bis zu 3)
  return game.players.find((o) => o !== p && o.console === kind && o.connected) || null;
}

function interactionsAt(game, p, tx, ty, own) {
  const list = [];
  const map = mapFor(game, p.zone);
  const ch = map.at(tx, ty);
  for (const o of game.players) {
    if (o === p || !o.downed || o.zone !== p.zone) continue;
    const ot = Physics.toTile(o.x, o.y);
    if (ot.x === tx && ot.y === ty) list.push({ kind: 'revive', target: o });
  }
  if (p.zone === 'ship') {
    if (game.ship.fireList.some((f) => f.tx === tx && f.ty === ty)) {
      if (p.carry === 'loeschgel') list.push({ kind: 'extinguish', tx, ty });
      else list.push({ kind: 'extinguish', blocked: 'Feuer! Hol Löschgel aus dem Lager (Regal 2).' });
    }
    if (game.ship.breachList.some((b) => b.tx === tx && b.ty === ty)) {
      if (p.carry === 'flickblech') list.push({ kind: 'patch', tx, ty });
      else list.push({ kind: 'patch', blocked: 'Hüllenbruch! Hol ein Flickblech aus dem Lager (Regal 3).' });
    }
    const info = map.info(tx, ty);
    if (info.system) {
      const st = game.ship.systems[info.system];
      if (st === 'damaged') list.push({ kind: 'repair', system: info.system });
      else if (st === 'broken') {
        if (p.carry === 'ersatzteil') list.push({ kind: 'repair', system: info.system });
        else list.push({ kind: 'repair', blocked: 'Zerstört: Ersatzteil aus dem Lager (Regal 1) nötig.' });
      } else if (st === 'offline') {
        const o = game.ship.offline[info.system];
        list.push({ kind: 'repair', blocked: `EMP: offline – startet in ${Math.ceil(o ? o.t : 1)} s von selbst neu.` });
      }
    }
    if (info.interact === 'switch') {
      const sw = W.REACTOR_SWITCHES.find((s) => s.x === tx && s.y === ty);
      if (game.ship.reactorCtl.state === 'offline') list.push({ kind: 'switch', sw: sw ? sw.id : 'A' });
      else list.push({ kind: 'switch', blocked: 'Reaktorschalter: nur für den Neustart nach einer Abschaltung.' });
    }
    if (info.console) {
      const occupant = consoleOccupant(game, p, info.console);
      if (occupant) list.push({ kind: 'console', blocked: `Konsole besetzt (${occupant.name}).` });
      else if (info.console === 'shop' && !game.ship.dockedAt) list.push({ kind: 'console', blocked: 'Hafenterminal: nur angedockt (Hafen oder Vaelen-Karawane).' });
      else if (info.console === 'plan' && game.players.filter((o) => o.console === 'plan' && o.connected).length >= game.C.plan.maxSeated) list.push({ kind: 'console', blocked: 'Am Tisch ist kein Platz mehr.' });
      else list.push({ kind: 'console', console: info.console });
    }
    if (ch === 'L') {
      const item = W.Maps.SHELVES[tx];
      if (item) {
        if (p.carry === item) list.push({ kind: 'shelf', op: 'put', item });
        else if (p.carry) list.push({ kind: 'shelf', blocked: 'Hände voll (G: ablegen).' });
        else if (item === 'loeschgel' ? (game.inventory.loeschgel > 0 || game.inventory.loeschgelCharges > 0) : game.inventory[item] > 0) list.push({ kind: 'shelf', op: 'take', item });
        else list.push({ kind: 'shelf', blocked: `Regal leer: kein ${itemName(item)} mehr. Nachschub gibt es im Hafen.` });
      }
    }
    if (ch === 'B') {
      const bed = W.Maps.BEDS.find((b) => b.x === tx && b.y === ty);
      if (bed && bed.color === p.color) list.push({ kind: 'bed' });
      else if (bed && bed.color === 3) list.push({ kind: 'bed', blocked: game.mission.flags.technikerRescued ? 'Ivos Koje. Er hat sie schon mit Schraubenschlüsseln dekoriert.' : 'Gästequartier – noch frei.' });
      else if (bed) list.push({ kind: 'bed', blocked: 'Nicht deine Koje.' });
    }
    for (const it of game.ship.groundItems) {
      const it2 = Physics.toTile(it.x, it.y);
      if (it2.x === tx && it2.y === ty) {
        if (p.carry) list.push({ kind: 'pickup', blocked: 'Hände voll (G: ablegen).' });
        else list.push({ kind: 'pickup', item: it, where: 'ship' });
      }
    }
    if (own && ch === 'P') list.push({ kind: 'selfbeam' });
  } else {
    const aw = game.away;
    if (aw.map === 'platform') {
      if (ch === 'Z') list.push({ kind: 'console', console: 'sonde' });
      if (ch === 'b' && !aw.coreRebooted) {
        if (aw.sonde.disabled) list.push({ kind: 'reboot' });
        else list.push({ kind: 'reboot', blocked: 'Der Bojenkern ist gesperrt – erst die Kustoden-Sonde abschalten.' });
      }
      const npc = aw.npc;
      if (npc.present && !npc.rescued) {
        const nt = Physics.toTile(npc.x, npc.y);
        if (nt.x === tx && nt.y === ty) {
          if (!npc.injured) list.push({ kind: 'npc' });
          else if (p.carry === 'medipack') list.push({ kind: 'npcHeal' });
          else list.push({ kind: 'npc', blocked: 'Ivo ist verletzt – er braucht ein Medipack (Lager an Bord oder Nachschub per Transfer auf die Markierung).' });
        }
      }
    } else if (aw.map === 'wreck') {
      if (ch === 'h') {
        const s = aw.salvage.find((q) => q.x === tx && q.y === ty);
        if (s && !s.done) list.push({ kind: 'salvage', sx: tx, sy: ty });
        else if (s) list.push({ kind: 'salvage', blocked: 'Leer geräumt. Gründlich wart ihr.' });
      }
      if (ch === 'g') list.push({ kind: 'lore' });
      if (ch === 'V' && aw.hollow && !aw.hollow.open) {
        if (aw.hollow.marked) list.push({ kind: 'hollow' });
        // QA M1: Hinweis statt Funkstille, wenn noch niemand aus dem Orbit gescannt hat
        else list.push({ kind: 'hollow', blocked: 'Die Wand klingt hohl … Ein Weitscan aus dem Orbit (Taktik, W) zeigt, was dahinter ist.' });
      }
    } else if (aw.map === 'kesh') {
      combat().interactionsAt(game, p, tx, ty, ch, list);   // M2: Störrelais, Archivschlüssel, Tafel
    }
    for (const it of aw.items) {
      const it2 = Physics.toTile(it.x, it.y);
      if (it2.x === tx && it2.y === ty) {
        if (it.kind === 'medipack') list.push({ kind: 'pickup', item: it, where: 'away' });
        else if (p.carry) list.push({ kind: 'pickup', blocked: 'Hände voll (G: ablegen).' });
        else list.push({ kind: 'pickup', item: it, where: 'away' });
      }
    }
    if (own && ch === 'P') list.push({ kind: 'selfbeam' });
  }
  list.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  return list;
}

function itemName(item) {
  return { ersatzteil: 'Ersatzteil', loeschgel: 'Löschgel', flickblech: 'Flickblech', bolzen: 'Bolzen', medipack: 'Medipack', datenkern: 'Datenkern', tafel: 'Vertragstafel' }[item] || item;
}

function onAct(game, p, down) {
  p.actDown = !!down;
  if (!down) { if (p.hold) { p.hold = null; } return; }
  if (p.downed || p.console || p.beamLock) return;
  const own = Physics.toTile(p.x, p.y);
  let blocked = null;
  for (const t of candidateTiles(p)) {
    const list = interactionsAt(game, p, t.x, t.y, t.x === own.x && t.y === own.y);
    if (!list.length) continue;
    const ok = list.find((i) => !i.blocked);
    if (ok) return performInteraction(game, p, ok);
    if (!blocked) blocked = list[0].blocked;
    break;
  }
  if (blocked) game.notice(p, blocked);
}

function holdDuration(game, p, kind, extra) {
  const C = game.C;
  const gear = p.gear.werkzeuggurt ? C.repair.werkzeuggurtFactor : 1;
  if (p.zone === 'away' && ['revive', 'jammer', 'archkey', 'tablet'].includes(kind) && combat().isV2(game)) return combat().holdDuration(game, p, kind);
  switch (kind) {
    case 'revive': return C.player.reviveTime;
    case 'extinguish': return C.fire.extinguishTime;
    case 'patch': return C.breach.patchTime;
    case 'repair': return (game.ship.systems[extra.system] === 'broken' ? C.repair.brokenToDamaged : C.repair.damagedToOk) * gear;
    case 'beam': return game.ship.systems.transfer === 'damaged' ? C.ship.beamTimeDamaged : C.ship.beamTime;
    case 'reboot': return C.awayExtra.rebootTime;
    case 'salvage': return C.wreckAway.salvageTime;
    case 'hollow': return C.wreckAway.hollowTime;
    case 'switch': return Infinity;
    default: return 1;
  }
}

function performInteraction(game, p, it) {
  switch (it.kind) {
    case 'revive': case 'extinguish': case 'patch': case 'repair': case 'reboot': case 'salvage': case 'hollow': case 'switch':
    case 'jammer': case 'archkey': case 'tablet': {
      p.hold = { kind: it.kind, t: 0, dur: holdDuration(game, p, it.kind, it), tx: it.tx, ty: it.ty, system: it.system, target: it.target, sw: it.sw, sx: it.sx, sy: it.sy,
        i: it.i, medkit: it.kind === 'revive' && !!p.medkit };
      if (it.kind === 'repair' && !game.flags.toldHold) { game.flags.toldHold = true; game.oda('E gedrückt halten und stillstehen – dann klappt\'s mit dem Schrauben.', null); }
      if (it.kind === 'switch') game.emit('sfx', { name: 'switch_hold', zone: 'ship', x: Math.round(p.x), y: Math.round(p.y) });
      return;
    }
    case 'selfbeam': {
      const check = game.transfer.canBeam(game, p.zone === 'ship' ? 'down' : 'up');
      if (!check.ok) return game.notice(p, check.reason);
      p.hold = { kind: 'beam', t: 0, dur: holdDuration(game, p, 'beam'), dir: p.zone === 'ship' ? 'down' : 'up' };
      return;
    }
    case 'console': return enterConsole(game, p, it.console);
    case 'bed': return enterConsole(game, p, 'quartier');
    case 'lore': return game.transfer.readLore(game, p);
    case 'shelf': {
      if (it.op === 'take') {
        if (it.item === 'loeschgel') {
          if (game.inventory.loeschgelCharges > 0) { p.carryCharges = game.inventory.loeschgelCharges; game.inventory.loeschgelCharges = 0; }
          else { game.inventory.loeschgel--; p.carryCharges = game.C.fire.gelCharges; }
        } else game.inventory[it.item]--;
        p.carry = it.item;
        game.emit('sfx', { name: 'pickup', zone: 'ship', x: Math.round(p.x), y: Math.round(p.y) });
        if (!game.flags.toldCarry) { game.flags.toldCarry = true; game.oda('Getragenes legst du mit G ab. Zurück ins Regal: einfach E am Regal.', null); }
      } else {
        if (it.item === 'loeschgel') {
          if (p.carryCharges >= game.C.fire.gelCharges) game.inventory.loeschgel++;
          else game.inventory.loeschgelCharges += p.carryCharges;
        } else game.inventory[it.item]++;
        p.carry = null; p.carryCharges = 0;
        game.emit('sfx', { name: 'drop', zone: 'ship', x: Math.round(p.x), y: Math.round(p.y) });
      }
      return;
    }
    case 'pickup': return pickupItem(game, p, it.item, it.where);
    case 'npcHeal': {
      const npc = game.away.npc;
      p.carry = null; npc.injured = false; npc.following = p.id; game.flags.npcMet = true;
      game.emit('sfx', { name: 'heal', zone: 'away', x: Math.round(npc.x), y: Math.round(npc.y) });
      game.emit('radio', { from: 'Techniker Ivo', text: 'Danke! Das Bein hält wieder. Ich bin Ivo, Wartung B-7 – ich folge dir zu den Pads!' });
      game.missionEvent('npcHealed', {});
      return;
    }
    case 'npc': {
      const npc = game.away.npc;
      if (npc.following === p.id) { npc.following = null; game.emit('radio', { from: 'Techniker Ivo', text: 'Gut, ich warte hier. Aber nicht vergessen, ja?' }); }
      else {
        npc.following = p.id;
        if (!game.flags.npcMet) { game.flags.npcMet = true; game.emit('radio', { from: 'Techniker Ivo', text: 'Endlich! Ich bin Ivo, Wartung B-7. Ich folge dir – bring mich zu den Pads!' }); }
        else game.emit('radio', { from: 'Techniker Ivo', text: 'Bin direkt hinter dir.' });
      }
      return;
    }
    default: return;
  }
}

function pickupItem(game, p, item, where) {
  const list = where === 'away' ? game.away.items : game.ship.groundItems;
  const idx = list.indexOf(item);
  if (idx < 0) return;
  if (item.kind === 'medipack' && where === 'away' && combat().isV2(game)) { combat().pickupMedkit(game, p, item); return; }
  if (item.kind === 'medipack' && where === 'away') {
    list.splice(idx, 1);
    healPlayer(game, p, game.C.support.supply.heal);
    return;
  }
  list.splice(idx, 1);
  p.carry = item.kind;
  p.carryCharges = item.charges || 0;
  game.emit('sfx', { name: 'pickup', zone: p.zone, x: Math.round(p.x), y: Math.round(p.y) });
  if (item.kind === 'datenkern') game.missionEvent('datenkernTaken', { p });
}

function enterConsole(game, p, kind) {
  p.console = kind; p.hold = null; p.input.mx = 0; p.input.my = 0; p.moving = false; p.crouch = false;
  game.emit('sfx', { name: kind === 'plan' ? 'table_sit' : 'console_on', zone: p.zone, x: Math.round(p.x), y: Math.round(p.y) });
  game.missionEvent('consoleEnter', { p, kind });
}

function leaveConsole(game, p) {
  if (!p.console) return;
  const kind = p.console;
  p.console = null;
  if (kind === 'helm') { game.ship.helm.turn = 0; game.ship.helm.thrust = 0; }
  if (kind === 'captain') game.ship.scanning = false;
  if (kind === 'weapons') game.ship.tscan.on = false;
  game.emit('sfx', { name: 'console_off', zone: p.zone, x: Math.round(p.x), y: Math.round(p.y) });
}

// ---------- Halten ----------
function updateHold(game, p, dt) {
  const h = p.hold;
  if (!p.actDown || p.moving || p.console) { p.hold = null; return; }
  if (!holdValid(game, p, h)) { p.hold = null; return; }
  h.t += dt;
  if ((h.kind === 'repair' || h.kind === 'reboot' || h.kind === 'salvage' || h.kind === 'hollow' || h.kind === 'jammer' || h.kind === 'archkey' || h.kind === 'tablet') && Math.floor((h.t - dt) / 0.5) !== Math.floor(h.t / 0.5)) game.emit('sfx', { name: 'repair_tick', zone: p.zone, x: Math.round(p.x), y: Math.round(p.y) });
  if (h.t < h.dur) return;
  p.hold = null;
  completeHold(game, p, h);
}

function holdValid(game, p, h) {
  switch (h.kind) {
    case 'revive': return h.target.downed && h.target.zone === p.zone;
    case 'extinguish': return p.carry === 'loeschgel' && game.ship.fireList.some((f) => f.tx === h.tx && f.ty === h.ty);
    case 'patch': return p.carry === 'flickblech' && game.ship.breachList.some((b) => b.tx === h.tx && b.ty === h.ty);
    case 'repair': {
      const st = game.ship.systems[h.system];
      if (st === 'ok' || st === 'offline') return false;
      if (st === 'broken') return p.carry === 'ersatzteil';
      return true;
    }
    case 'beam': return game.transfer.canBeam(game, h.dir).ok;
    case 'reboot': return p.zone === 'away' && game.away.map === 'platform' && game.away.sonde.disabled && !game.away.coreRebooted;
    case 'switch': return p.zone === 'ship' && game.ship.reactorCtl.state === 'offline';
    case 'salvage': { const s = game.away.salvage && game.away.salvage.find((q) => q.x === h.sx && q.y === h.sy); return p.zone === 'away' && !!s && !s.done; }
    case 'hollow': return p.zone === 'away' && game.away.map === 'wreck' && game.away.hollow.marked && !game.away.hollow.open;
    case 'jammer': case 'archkey': case 'tablet': return combat().holdValid(game, p, h);
    default: return false;
  }
}

function completeHold(game, p, h) {
  switch (h.kind) {
    case 'jammer': case 'archkey': case 'tablet': combat().completeHold(game, p, h); break;
    case 'revive':
      if (h.target && h.target.wound) { combat().completeRevive(game, p, h); break; }   // M2: v2-Wiederbeleben
      revivePlayer(game, h.target);
      game.oda(`${h.target.name} ist wieder auf den Beinen. Teamwork, wie es im Handbuch steht.`, null);
      break;
    case 'extinguish':
      removeFire(game, h.tx, h.ty, 'player');
      p.carryCharges--;
      game.emit('sfx', { name: 'extinguish', zone: 'ship', x: Math.round(p.x), y: Math.round(p.y) });
      if (p.carryCharges <= 0) { p.carry = null; p.carryCharges = 0; game.notice(p, 'Löschgel leer – Kanister entsorgt.'); }
      break;
    case 'patch':
      removeBreach(game, h.tx, h.ty, 'player');
      p.carry = null;
      break;
    case 'repair': {
      const wasBroken = game.ship.systems[h.system] === 'broken';
      if (wasBroken) p.carry = null;
      repairSystem(game, h.system, 'player');
      break;
    }
    case 'beam':
      game.transfer.selfBeam(game, p, h.dir);
      break;
    case 'reboot':
      game.away.coreRebooted = true;
      game.emit('sfx', { name: 'repair_done', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
      game.missionEvent('coreRebooted', { p });
      break;
    case 'salvage': game.transfer.openSalvage(game, p, h.sx, h.sy); break;
    case 'hollow': game.transfer.openHollow(game, p); break;
    default: break;
  }
}

// ---------- Systeme ----------
function damageSystem(game, sys, toState) {
  const s = game.ship.systems;
  if (!s[sys]) return;
  if (s[sys] === 'offline') {   // EMP-Pause: Schaden merken wir für danach
    const o = game.ship.offline[sys];
    if (o) o.prev = toState || (o.prev === 'ok' ? 'damaged' : 'broken');
    return;
  }
  const before = s[sys];
  if (toState) s[sys] = toState;
  else s[sys] = before === 'ok' ? 'damaged' : 'broken';
  if (s[sys] === before) return;
  game.emit('sfx', { name: 'hull_hit', zone: 'ship' });
  game.missionEvent('systemDamaged', { system: sys, state: s[sys] });
}

function repairSystem(game, sys, by) {
  const s = game.ship.systems;
  if (s[sys] === 'ok' || s[sys] === 'offline') return;
  s[sys] = s[sys] === 'broken' ? 'damaged' : 'ok';
  game.ship.noPartT[sys] = 0;
  game.stats.repairs++;
  game.emit('repairDone', { system: sys });
  game.emit('sfx', { name: 'repair_done', zone: 'ship' });
  game.missionEvent('repaired', { system: sys, by });
}

// EMP: System für secs offline (zählt wie broken), danach zurück auf den vorherigen Zustand.
function setOffline(game, sys, secs) {
  const s = game.ship.systems;
  if (!s[sys] || isDown(s[sys])) return;
  game.ship.offline[sys] = { t: secs, prev: s[sys] };
  s[sys] = 'offline';
  game.oda(`EMP-Treffer! ${cap(sysNameNom(sys))} ist ${Math.round(secs)} s offline und startet dann von selbst.`, null);
  game.missionEvent('systemOffline', { system: sys });
}
function updateOffline(game, dt) {
  const off = game.ship.offline;
  for (const sys of Object.keys(off)) {
    off[sys].t -= dt;
    if (off[sys].t > 0) continue;
    if (game.ship.systems[sys] === 'offline') game.ship.systems[sys] = off[sys].prev || 'ok';
    delete off[sys];
    game.emit('sfx', { name: 'reactor_up', zone: 'ship', volume: 0.4 });
  }
}

// ---------- Feuer & Lecks ----------
function addFire(game, tx, ty) {
  const C = game.C;
  if (game.ship.fireList.length >= C.fire.max) return false;
  if (W.ship.solid(tx, ty)) return false;
  if (game.ship.fireList.some((f) => f.tx === tx && f.ty === ty)) return false;
  game.ship.fireList.push({ tx, ty, spreadT: 0, dmgT: 0 });
  game.missionEvent('fire', { tx, ty });
  return true;
}
function removeFire(game, tx, ty, by) {
  const i = game.ship.fireList.findIndex((f) => f.tx === tx && f.ty === ty);
  if (i < 0) return;
  game.ship.fireList.splice(i, 1);
  game.stats.firesOut++;
  game.missionEvent('fireOut', { by });
}
function addBreach(game, tx, ty) {
  if (game.ship.breachList.some((b) => b.tx === tx && b.ty === ty)) return false;
  game.ship.breachList.push({ tx, ty, t: 0 });
  game.emit('sfx', { name: 'hull_hit', zone: 'ship' });
  game.missionEvent('breach', { tx, ty });
  return true;
}
function removeBreach(game, tx, ty, by) {
  const i = game.ship.breachList.findIndex((b) => b.tx === tx && b.ty === ty);
  if (i < 0) return;
  game.ship.breachList.splice(i, 1);
  game.emit('sfx', { name: 'patch', zone: 'ship', x: tx * TILE + 16, y: ty * TILE + 16 });
  game.missionEvent('breachPatched', { by });
}

function randomRegionFloor(game, region, wallAdjacent) {
  const list = (wallAdjacent ? W.REGION_WALL_FLOORS : W.REGION_FLOORS)[region];
  return list[game.rng.int(list.length)];
}

function updateHazards(game, dt) {
  const C = game.C;
  const ship = game.ship;
  const drill = game.mission && game.mission.isDrill();
  for (const f of ship.fireList.slice()) {
    if (drill) { f.spreadT = 0; f.dmgT = 0; continue; }
    f.spreadT += dt; f.dmgT += dt;
    if (f.spreadT >= C.fire.spreadInterval) {
      f.spreadT = 0;
      if (game.rng.chance(C.fire.spreadChance)) {
        const opts = NEIGHBOR_ORDER.map((n) => ({ x: f.tx + DIRS[n].x, y: f.ty + DIRS[n].y }))
          .filter((t) => !W.ship.solid(t.x, t.y) && !ship.fireList.some((o) => o.tx === t.x && o.ty === t.y));
        if (opts.length) { const t = game.rng.pick(opts); addFire(game, t.x, t.y); }
      }
    }
    if (f.dmgT >= C.fire.damageInterval) {
      f.dmgT = 0;
      for (const sys of SYSTEM_ORDER) {
        const st = W.SYSTEM_TILES[sys];
        if (Math.abs(st.x - f.tx) <= 1 && Math.abs(st.y - f.ty) <= 1) { damageSystem(game, sys); break; }
      }
    }
  }
  for (const b of ship.breachList) {
    b.t += dt;
    if (!game.god && !drill) ship.hull = Math.max(0, ship.hull - C.breach.hullPerSec * dt);
  }
  // Softlock-Schutz: Notreparatur, wenn kein Teil mehr verfügbar ist
  const carried = (kind) => game.players.some((p) => p.carry === kind) || game.bots.some((b) => b.carry === kind) ||
    ship.groundItems.some((i) => i.kind === kind);
  const noParts = game.inventory.ersatzteil <= 0 && !carried('ersatzteil');
  for (const sys of SYSTEM_ORDER) {
    if (ship.systems[sys] !== 'broken' || !noParts) { ship.noPartT[sys] = 0; continue; }
    ship.noPartT[sys] = (ship.noPartT[sys] || 0) + dt;
    if (ship.noPartT[sys] >= C.emergencyRepair.brokenDelay) {
      ship.noPartT[sys] = 0;
      ship.systems[sys] = 'damaged';
      game.emit('repairDone', { system: sys });
      game.oda(`Keine Ersatzteile mehr – ich habe ${sysName(sys)} mit Draht und Gebet notrepariert. Jetzt nur noch beschädigt.`, null);
    }
  }
  const noPlates = game.inventory.flickblech <= 0 && !carried('flickblech');
  if (noPlates && ship.breachList.length) {
    ship.noPlateT += dt;
    if (ship.noPlateT >= C.emergencyRepair.breachDelay) {
      ship.noPlateT = 0;
      for (const b of ship.breachList.slice()) removeBreach(game, b.tx, b.ty, 'oda');
      game.oda('Kein Flickblech mehr – ich habe die Lecks mit Notschaum abgedichtet. Hält. Hoffentlich.', null);
    }
  } else ship.noPlateT = 0;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function sysNameNom(sys) {
  return { reactor: 'der Reaktor', engines: 'der Antrieb', shields: 'der Schildgenerator', weapons: 'die Waffenbank', life: 'die Lebenserhaltung', transfer: 'der Transfer' }[sys] || sys;
}
function sysName(sys) {
  return { reactor: 'den Reaktor', engines: 'den Antrieb', shields: 'den Schildgenerator', weapons: 'die Waffenbank', life: 'die Lebenserhaltung', transfer: 'den Transfer' }[sys] || sys;
}

module.exports = {
  platformSolid, awaySolid, awayInfo, solidFor, mapFor, updatePlayers, damagePlayer, healPlayer, downPlayer, revivePlayer, placeOnShipPad,
  placeOnPlatformPad, placeOnAwayPad, dropCarry, onDrop, onAct, enterConsole, leaveConsole, interactionsAt, candidateTiles,
  damageSystem, repairSystem, setOffline, updateOffline, addFire, removeFire, addBreach, removeBreach, randomRegionFloor, updateHazards,
  sysName, sysNameNom, itemName, SYSTEM_ORDER, isDown,
};
