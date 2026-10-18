'use strict';
// M3b Schritt A (CONTRACT-M3B §4): Schild- und Schadenslogik der Lerche.
//   resolveHit  – ein Treffer auf Sektor `sector`: Absorbieren mit Überlauf, schwere Treffer, Durchschlag, EMP,
//                 Systemschaden nach Schild-Durchlass-Tabelle (spaceM3b.shieldLeak), Feuer/Lecks nur bei Rest > 0.
//   onHullHit   – Rückschlag für laufende Reparaturen im getroffenen Sektor (spaceM3b.repairHitLoss).
//   update      – Eskalation (spaceM3b.escalation) und Reaktor-Autostart im Gefecht (spaceM3b.reactorAutoRestart).
// space.shipHit (SERVER-FLIGHT) ist eine dünne Hülle um resolveHit. Alle Werte live per `tune spaceM3b.<pfad>`.
const W = require('../world.js');
const interior = require('./interior.js');

let spaceMod = null;   // lazy wegen Zirkelbezug space -> damage
const space = () => spaceMod || (spaceMod = require('./space.js'));

const STAT_KEYS = ['leakHits', 'escalations', 'repairSetbacks', 'overflowHull'];
const REPAIR_HOLDS = ['flick', 'swap', 'minigame'];
const r1 = (v) => Math.round(v * 10) / 10;

function cfg(game) { return game.C.spaceM3b || {}; }
// Kampf = ein Gegner da, der kein Störrelais ist (wie bridgeLeaves/Hüllen-Regeneration)
function inCombat(game) { return !!(game.space && game.space.enemies && game.space.enemies.some((e) => e.kind !== 'relay')); }
function ensureStats(game) { for (const k of STAT_KEYS) if (game.stats[k] == null) game.stats[k] = 0; }
function leakRow(game, s) {
  const L = cfg(game).shieldLeak || {};
  const k = Math.max(0, Math.min(4, Math.floor(s)));
  return L[k] || L[String(k)] || { chance: 0 };
}

// ---------- Treffer (§4) ----------
// opts: { pierce: true (Schild ganz umgehen) | Zahl (Schild um so viele Punkte schwächer), emp, heavy, source }
// Rückgabe: { absorbed, hull, systems: [{system, state}], shield: S vor dem Treffer (wirksam), rest }
function resolveHit(game, sector, dmg, opts) {
  const o = opts || {};
  const C = game.C; const ship = game.ship; const sh = ship.shields; const B = cfg(game);
  ensureStats(game);
  // stats.hits, Ereignis 'hit', sfx, shieldDown/hullHit macht die Hülle space.shipHit (SERVER-FLIGHT)
  const heavy = !!o.heavy; const emp = !!o.emp;
  if (!Number.isInteger(sector) || sector < 0 || sector > 3) sector = 0;
  dmg = Math.max(0, Number(dmg) || 0);
  // 1. S = Schildstärke des Sektors vor dem Treffer (Durchschlag schwächt sie für diesen Treffer)
  const s0 = Math.max(0, Number(sh.current[sector]) || 0);
  let s = s0;
  if (o.pierce === true) s = 0;
  else if (Number(o.pierce) > 0) s = Math.max(0, s0 - Number(o.pierce));
  const row = leakRow(game, s);
  // 2. schwerer Treffer gegen S ≥ 3: Schaden − heavyReduce vor dem Absorbieren
  if (heavy && s >= 3 && row.heavyReduce) dmg = Math.max(0, dmg - row.heavyReduce);
  let absorbed = Math.min(s, dmg);
  let rest = r1(dmg - absorbed);
  if (B.shieldOverflow === false && s > 0) {   // Altverhalten: ein Schildpunkt schluckt den ganzen Treffer
    absorbed = Math.min(s, dmg); rest = 0;
  }
  if (rest < 0.05) rest = 0;
  absorbed = r1(absorbed);
  if (absorbed > 0) sh.current[sector] = Math.max(0, r1(s0 - absorbed));
  const out = { absorbed, hull: 0, systems: [], shield: s, rest, empThrough: false };
  // 3. EMP: Schild durchschlagen -> ein System offline statt Hüllenschaden (wie bisher)
  if (emp && rest > 0) {
    out.empThrough = true;
    const cand = interior.SYSTEM_ORDER.filter((k) => ship.systems[k] != null && !interior.isDown(ship.systems[k]));
    if (cand.length) interior.setOffline(game, game.rng.pick(cand), C.emp.offlineTime);
    return out;
  }
  if (rest > 0) {
    out.hull = r1(5 * rest);
    if (!game.god) ship.hull = Math.max(0, ship.hull - out.hull);
    if (s > 0) game.stats.overflowHull = r1(game.stats.overflowHull + out.hull);
  }
  // 4. Systemschaden nach Durchlass-Tabelle – bei jedem Treffer, auch voll gefangen
  const heavyOnly = !!row.heavyOnly && !heavy;
  let chance = heavyOnly ? 0 : (Number(row.chance) || 0);
  // S2b: Sperrfeuer ist ein leichter Treffer – mit Schild kein Systemschaden, ohne Schild nur × leakFactor
  // (sonst würfelte jedes der vielen kleinen Geschosse die volle Durchlass-Tabelle)
  if (o.sperrfeuer) {
    const SF = (C.spaceS2b && C.spaceS2b.sperrfeuer) || {};
    chance = s > 0 ? 0 : chance * (SF.leakFactor != null ? Number(SF.leakFactor) : 1);
  }
  out.systems = interior.hitSystems(game, sector, {
    chance, maxState: row.maxState || 'broken', centre: !!row.centre, breakFragile: !!row.breakFragile && !heavyOnly && !(o.sperrfeuer && s > 0),
    fragileAlways: s === 0 && rest > 0,   // ohne Schild bricht Geflicktes im Sektor sicher (wie M3a)
  });
  if (s > 0 && out.systems.length) game.stats.leakHits++;
  // 5. Feuer und Lecks nur bei Rest > 0
  if (rest > 0) {
    if (game.rng.chance(C.hitEffects.fireChance)) { const t = interior.randomRegionFloor(game, sector, false); if (t) interior.addFire(game, t.x, t.y); }
    if (game.rng.chance(C.hitEffects.breachChance)) { const t = interior.randomRegionFloor(game, sector, true); if (t) interior.addBreach(game, t.x, t.y); }
    onHullHit(game, sector);
  }
  return out;
}

// ---------- Rückschlag (§4 „Arbeiten im Rhythmus“) ----------
// Hüllentreffer im Sektor eines Systems, an dem gerade gearbeitet wird -> Fortschritt × (1 − repairHitLoss).
function onHullHit(game, sector) {
  const loss = Number(cfg(game).repairHitLoss);
  if (!(loss > 0)) return 0;
  ensureStats(game);
  let n = 0;
  const inSector = (sys) => sys && interior.systemSector(sys) === sector;
  for (const p of game.players) {
    const h = p.hold;
    if (!h || !REPAIR_HOLDS.includes(h.kind) || !inSector(h.system) || !(h.t > 0)) continue;
    h.t *= (1 - loss);
    n++;
    game.emit('repairSetback', { system: h.system, pid: p.id });
  }
  for (const b of game.bots) {
    const t = b.task;
    if (!t || t.kind !== 'repair' || t.phase !== 'work' || !inSector(t.system) || !(b.progress > 0)) continue;
    b.progress *= (1 - loss);
    n++;
    game.emit('repairSetback', { system: t.system, bot: b.id });
  }
  game.stats.repairSetbacks += n;
  if (n) game.oda('Treffer im Sektor – die Reparatur ist halb wieder auf. Zwischen den Salven schrauben!', 'repairSetback');
  return n;
}

// ---------- Eskalation (§4) ----------
// Arbeitet gerade jemand an sys? Spieler hält/spielt dort, oder ein Bot arbeitet (phase work) daran.
function busy(game, sys) {
  return game.players.some((p) => p.hold && REPAIR_HOLDS.includes(p.hold.kind) && p.hold.system === sys) ||
    game.bots.some((b) => b.task && b.task.kind === 'repair' && b.task.system === sys && b.task.phase === 'work');
}
// Feuer auf einer Bodenkachel neben einer Station des Systems (8er-Nachbarschaft, wie fire.damageInterval sie prüft)
function igniteNear(game, sys) {
  const fires = game.ship.fireList;
  const cand = [];
  for (const st of W.STATIONS) {
    if (st.system !== sys) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = st.x + dx, y = st.y + dy;
      if ((dx || dy) && !W.ship.solid(x, y) && !fires.some((f) => f.tx === x && f.ty === y) && !cand.some((c) => c.x === x && c.y === y)) cand.push({ x, y });
    }
  }
  if (!cand.length) return null;
  const t = game.rng.pick(cand);
  return interior.addFire(game, t.x, t.y) ? t : null;
}
function updateEscalation(game, dt) {
  const ship = game.ship; const E = cfg(game).escalation || {};
  const after = Number(E.after) || 0;
  if (!ship.escalateT) ship.escalateT = {};
  const T = ship.escalateT;
  const fight = after > 0 && inCombat(game) && !(game.mission && typeof game.mission.isDrill === 'function' && game.mission.isDrill());
  for (const sys of interior.SYSTEM_ORDER) {
    const st = ship.systems[sys];
    if (!fight || (st !== 'damaged' && st !== 'broken') || busy(game, sys)) { if (T[sys] != null) delete T[sys]; continue; }
    T[sys] = (T[sys] || 0) + dt;
    if (T[sys] < after) continue;
    T[sys] = 0;   // Zähler beginnt neu
    // QA S2b: Seit Jäger 3× so viel aushalten, dauern Gefechte länger; ungedeckelt zündete jede Eskalation weiter, bis das
    // Schiff an der Feuer-Obergrenze brannte (Arena Seed 4: 32 Eskalationen, 170× Flicken im Kreis). Ab maxFires Bränden
    // an Bord entsteht durch Eskalation kein weiteres Feuer – der Druck bleibt, die Spirale nicht.
    if (Number(E.maxFires) > 0 && ship.fireList.length >= Number(E.maxFires)) continue;
    const at = igniteNear(game, sys);
    if (!at) continue;
    ensureStats(game);
    game.stats.escalations++;
    game.emit('escalated', { system: sys, tx: at.x, ty: at.y });
    queueEscalationAnnounce(game, sys);
  }
  updateEscalationAnnounce(game);
}
// ODA gebündelt (Abklingzeit wie die Schadensansagen)
function queueEscalationAnnounce(game, sys) {
  const ship = game.ship;
  if (!ship.escAnnounce) ship.escAnnounce = { list: [], next: 0 };
  if (!ship.escAnnounce.list.includes(sys)) ship.escAnnounce.list.push(sys);
}
function updateEscalationAnnounce(game) {
  const a = game.ship.escAnnounce;
  if (!a || !a.list.length || game.time < a.next) return;
  const cd = (game.C.spaceM3 && game.C.spaceM3.repair && game.C.spaceM3.repair.odaCooldown) || 3;
  const names = a.list.slice(0, 3).map((k) => interior.SYS_LABEL[k] || k);
  const more = a.list.length > 3 ? ` und ${a.list.length - 3} weitere` : '';
  a.list = [];
  game.oda(`Liegengeblieben – es brennt neben ${names.length > 1 ? 'den Stationen' : 'der Station'} ${names.join(', ')}${more}! Löschgel und Werkzeug, bitte.`, null);
  a.next = game.time + cd;
}
// Snapshot ship.escalate = { [sys]: Restsekunden } nur für laufende Zähler
function escalateSnapshot(game) {
  const T = game.ship.escalateT; const after = Number((cfg(game).escalation || {}).after) || 0;
  const out = {};
  if (!T || !(after > 0)) return out;
  for (const k of Object.keys(T)) if (T[k] > 0) out[k] = Math.max(0, Math.ceil(after - T[k]));
  return out;
}

// ---------- Reaktor-Autostart im Gefecht (§4) ----------
// interior.reactorNeedsRestart setzt reactorCtl.autoRestartAt, wenn beim Reparieren Gegner da sind.
function updateReactorAuto(game) {
  const rc = game.ship.reactorCtl;
  if (!rc || rc.autoRestartAt == null) return;
  if (rc.state !== 'offline') { rc.autoRestartAt = null; return; }
  if (game.time < rc.autoRestartAt) return;
  rc.autoRestartAt = null;
  const s = space();
  if (typeof s.reactorOnline === 'function') s.reactorOnline(game, 'Gefechtsstart: Der Reaktor zündet von selbst. Weiter geht\'s!');
  game.stats.reactorAutoStarts = (game.stats.reactorAutoStarts || 0) + 1;
}
function reactorAutoLeft(game) {
  const rc = game.ship.reactorCtl;
  return rc && rc.autoRestartAt != null && rc.state === 'offline' ? Math.max(0, Math.round((rc.autoRestartAt - game.time) * 10) / 10) : null;
}

function update(game, dt) {
  ensureStats(game);
  updateEscalation(game, dt);
  updateReactorAuto(game);
}

module.exports = { resolveHit, onHullHit, update, escalateSnapshot, reactorAutoLeft, inCombat, busy, igniteNear, STAT_KEYS };
