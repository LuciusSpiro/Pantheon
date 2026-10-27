'use strict';
// M3b Schritt A (CONTRACT-M3B §4), SYS-01 A1a: Schild- und Schadenslogik der Lerche.
//   resolveHit  – ein Treffer auf Sektor `sector`. Schild über 0 fängt ab (min(Schild, Schaden)), der Rest verfällt,
//                 kein Systemschaden. Ohne Schild (oder durchschlagen) trifft der Rest ein System der Zone
//                 (interior.trefferweg), Integritätsabzug = Rest × systemModell.schadenFaktor. Feuer nur bei Systemschaden.
//   onSystemHit – Rückschlag für laufende Reparaturen im Bereich des getroffenen Systems (spaceM3b.repairHitLoss).
//   update      – Eskalation (spaceM3b.escalation) und Reaktor-Autostart im Gefecht (spaceM3b.reactorAutoRestart).
// space.shipHit (SERVER-FLIGHT) ist eine dünne Hülle um resolveHit. Alle Werte live per `tune spaceM3b.<pfad>` bzw. `tune systemModell.<pfad>`.
const W = require('../world.js');
const interior = require('./interior.js');
const Katalog = require('../../shared/schiffskatalog.js');

let spaceMod = null;   // lazy wegen Zirkelbezug space -> damage
const space = () => spaceMod || (spaceMod = require('./space.js'));

const STAT_KEYS = ['leakHits', 'escalations', 'repairSetbacks'];
const REPAIR_HOLDS = ['flick', 'swap', 'minigame'];
const r1 = (v) => Math.round(v * 10) / 10;

function cfg(game) { return game.C.spaceM3b || {}; }
// Kampf = ein Gegner da, der kein Störrelais ist (wie bridgeLeaves/Hüllen-Regeneration)
function inCombat(game) { return !!(game.space && game.space.enemies && game.space.enemies.some((e) => e.kind !== 'relay')); }
function ensureStats(game) { for (const k of STAT_KEYS) if (game.stats[k] == null) game.stats[k] = 0; }

// ---------- Treffer (§4, SYS-01 A1a) ----------
// opts: { pierce: true (Schild ganz aus) | Zahl (Schild um so viele Punkte schwächer), durchschlag: 'zone' (Zone überspringen,
//         Mitte), emp, heavy, sturm, streu, source }
// Rückgabe: { absorbed, rest, systems: [{system, state, wechsel}], shield: S vor dem Treffer, empThrough }
function resolveHit(game, sector, dmg, opts) {
  const o = opts || {};
  const C = game.C; const sh = game.ship.shields; const B = cfg(game); const M = C.systemModell || {};
  ensureStats(game);
  if (!Number.isInteger(sector) || sector < 0 || sector > 3) sector = 0;
  dmg = Math.max(0, Number(dmg) || 0);
  // 1. Schild vor dem Treffer; wirksam ist er nach Durchschlag (Schild aus, oder um die Zahl schwächer)
  const s0 = Math.max(0, Number(sh.current[sector]) || 0);
  let s = s0;
  if (o.pierce === true || o.durchschlag === 'schild') s = 0;
  else if (Number(o.pierce) > 0) s = Math.max(0, s0 - Number(o.pierce));
  // PAN-01 C: Sturmbatterie (hoher Schild: kaum Schildschaden, der Schild regeneriert nicht) und Streu-Granate (eine = Schildschaden)
  const ST = o.sturm ? Katalog.waffe('sturmbatterie').sturm : null;
  if (ST) sh.regenHold = game.time + ST.regenSperre;
  if ((ST && s0 > ST.niedrig) || o.streu) {
    const take = Math.min(s0, dmg * (ST ? ST.schildFaktor : o.streu.schildFaktor));
    if (take > 0) sh.current[sector] = Math.max(0, r1(s0 - take));
    return { absorbed: r1(take), rest: 0, systems: [], shield: s0, empThrough: false };
  }
  // 2. Der Schild fängt ab; der Rest verfällt, solange er steht (kein Überlauf)
  const absorbed = r1(Math.min(s, dmg));
  if (absorbed > 0) sh.current[sector] = Math.max(0, r1(s0 - absorbed));
  let rest = r1(dmg - absorbed);
  if (rest < 0.05) rest = 0;
  const out = { absorbed, rest: s > 0 ? 0 : rest, systems: [], shield: s0, empThrough: false };   // Schild hält: der Rest verfällt (rest 0)
  // 3. Sturmbatterie bei niedrigem Schild: Systemchance, kleiner Integritätsschaden (Schild bleibt oben)
  if (ST && s0 > 0 && s0 <= ST.niedrig && game.rng.chance(ST.systemChance)) {
    const t = interior.trefferweg(game, sector, Number(M.sturmSchaden) || 0);
    if (t) out.systems.push(t);
    if (out.systems.length) game.stats.leakHits++;
  }
  if (s > 0 || rest <= 0) return out;   // Schild hält: ohne Systemschaden und ohne Überlauf
  // 4. Schild unten: EMP wie bisher (ein System offline statt Schaden)
  if (o.emp) {
    out.empThrough = true;
    const cand = interior.SYSTEM_ORDER.filter((k) => game.ship.systems[k] != null && !interior.isDown(game.ship.systems[k]) && interior.systemAktiv(game, k));
    if (cand.length) interior.setOffline(game, game.rng.pick(cand), C.emp.offlineTime);
    return out;
  }
  // 5. Trefferweg: Zone des Sektors, Mitte bei Durchschlag 'zone' oder bei leerer Zone (Integritätsabzug = Rest × Faktor)
  const zone = o.durchschlag === 'zone' ? -1 : sector;
  const t = interior.trefferweg(game, zone, rest * (Number(M.schadenFaktor) || 1));
  if (!t) return out;
  out.systems.push(t);   // t.wechsel: der Treffer hat den Zustand geändert (Zielsysteme prüfen das)
  const sysZone = interior.systemSector(t.system);
  // 6. Feuer nur bei Systemschaden (Zustandswechsel) in der Zone des getroffenen Systems; Lecks entfallen
  if (t.wechsel) {
    game.missionEvent('systemDamaged', { system: t.system, state: t.state });
    if (sysZone >= 0 && game.rng.chance(C.hitEffects.fireChance)) { const f = interior.randomRegionFloor(game, sysZone, false); if (f) interior.addFire(game, f.x, f.y); }
  }
  onSystemHit(game, sysZone);   // Rückschlag bei jedem Systemschaden: die Reparatur im Bereich verliert Fortschritt
  return out;
}

// ---------- Rückschlag (§4 „Arbeiten im Rhythmus“) ----------
// Systemschaden im Bereich (Zone) eines Systems, an dem gerade gearbeitet wird -> Fortschritt × (1 − repairHitLoss).
function onSystemHit(game, zone) {
  const loss = Number(cfg(game).repairHitLoss);
  if (!(loss > 0)) return 0;
  ensureStats(game);
  let n = 0;
  const inSector = (sys) => sys && interior.systemSector(sys) === zone;
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
    if (!interior.systemAktiv(game, sys)) { if (T[sys] != null) delete T[sys]; continue; }
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
  if (!rc) return;
  if (rc.autoRestartAt == null) { if (rc.autoRestartText !== undefined) delete rc.autoRestartText; return; }   // ein Text ohne Autostart-Zeit bliebe sonst hängen
  if (rc.state !== 'offline') { rc.autoRestartAt = null; delete rc.autoRestartText; return; }
  if (game.time < rc.autoRestartAt) return;
  rc.autoRestartAt = null;
  const text = rc.autoRestartText || 'Gefechtsstart: Der Reaktor zündet von selbst. Weiter geht\'s!';
  delete rc.autoRestartText;   // SUND-02a C: nur der Notfallsprung der Freien Fahrt setzt einen eigenen Text
  const s = space();
  if (typeof s.reactorOnline === 'function') s.reactorOnline(game, text);
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

module.exports = { resolveHit, onSystemHit, update, escalateSnapshot, reactorAutoLeft, inCombat, busy, igniteNear, STAT_KEYS };
