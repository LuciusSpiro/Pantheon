'use strict';
// S2 §5 (CONTRACT-S2): Schützlinge – zu schützende NSC-Schiffe im Raumkampf (Team SCHUETZLING).
//
//   game.space.escorts = [{ id, tag, kind, name, npc?, x, y, angle, vx, vy, turnVel, stage, hp, hpMax,
//                           state: 'ok'|'beschaedigt'|'kampfunfaehig'|'entkommen', befehl, verhalten, ziel, reparatur_s, … }]
//   Bewegung immer über Flight.stepBody mit CONFIG.shipClasses.<kind>, Steuerung über Pilot.escort (Wegpunkt).
//   Verhalten: treibt (Havarist, Antrieb tot) | folgt_kurs (Geleit zum Ziel, Tempo nach der Lerche) | flieht.
//   Befehle des Captains (halten, folgen, volle_kraft, andocken) mit Gehorsam nach Haltung des NSC (Weltstand).
//   Gegner mit e.targetId (Pilot.targetOf) greifen Schützlinge an – jeder Angriff ist angekündigt (tele + ODA).
//   Liegt die Lerche dazwischen und hält ihr Schild zur Schussseite ≥ 1, fängt sie die Ladung (Breitseite als Schild).
//   Hülle 0 -> kampfunfähig (treibt, Wrack), nie gelöscht. Kein Eigenbeschuss, nur ein Funk-Rüffel.
//
// Aufrufer: space.js (update, Angriffe, Treffer, Szenenwechsel, Lanze), game.js/ENGINE (snapshot, enemyTgt, command,
// debug, hpPct), server/mission/bausteine/escort.js (Bausteine). Ohne Schützlinge ändert nichts am bisherigen Ablauf.
const Flight = require('../../shared/flight.js');
const Physics = require('../../shared/physics.js');
const Locations = require('../../shared/locations.js');
const Pilot = require('./pilot.js');

let spaceMod = null;   // lazy (Zirkelbezug space -> escort)
const space = () => spaceMod || (spaceMod = require('./space.js'));

const norm = Physics.normAngle;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

const KINDS = ['frachter', 'karawane', 'bergungsboot'];
const VERHALTEN = ['treibt', 'folgt_kurs', 'flieht'];
const BEFEHLE = ['halten', 'folgen', 'volle_kraft', 'andocken'];
const STATES = ['ok', 'beschaedigt', 'kampfunfaehig', 'entkommen'];
const POINTS = ['west', 'ost', 'nord', 'sued', 'mitte', 'station', 'dock', 'lerche', 'vorn', 'achtern', 'rand'];
const KIND_LABEL = { frachter: 'Frachter', karawane: 'Karawane', bergungsboot: 'Bergungsboot' };
const ENEMY_LABEL = { raider: 'Jäger', gunboat: 'Kanonenboot', sentinel: 'Wächter', pylon: 'Pylon', relay: 'Störrelais' };
const BEFEHL_LABEL = { halten: 'Position halten', folgen: 'uns folgen', volle_kraft: 'volle Kraft voraus', andocken: 'Andocken' };

const DEFAULTS = {
  max: 2, hull: { frachter: 120, karawane: 100, bergungsboot: 70 }, obeyDelay: { pos: 0, neutral: 2, neg: 4 },
  warnAt: [0.75, 0.5, 0.25], aggroOnHit: 10, rebukeCooldown: 30, distressBelow: 0.5, distressFastBelow: 0.3,
  hullPerDamage: 5, tele: { dur: 2 }, empStall: 6, underFireHold: 4, followDist: 200, leash: 480, arriveDist: 130,
  dockGap: 30, dockSpeed: 35, repairDist: 180, repairSpeed: 40, shieldRadius: 46, hitRadius: 8, spawnDist: 260,
};
function cfg(game) {
  const c = (game.C && game.C.escorts) || {};
  return Object.assign({}, DEFAULTS, c, { tele: Object.assign({}, DEFAULTS.tele, c.tele || {}) });
}
function cls(game, kind) { const SC = game.C.shipClasses || {}; return SC[kind] || SC.frachter || null; }
function list(game) { return (game.space && game.space.escorts) || []; }
function ensureList(game) { if (!game.space.escorts) game.space.escorts = []; return game.space.escorts; }
const active = (es) => !!es && (es.state === 'ok' || es.state === 'beschaedigt');
function find(game, tag) {
  const L = list(game);
  if (tag == null || tag === '') return L.length === 1 ? L[0] : (L.find(active) || L[0] || null);
  return L.find((q) => q.tag === tag || q.id === tag) || null;
}
function findGone(game, tag) {
  const G = (game.space && game.space.escortsGone) || [];
  for (let i = G.length - 1; i >= 0; i--) if (G[i].tag === tag || G[i].id === tag) return G[i];
  return null;
}
function stats(game) {
  const s = game.stats;
  if (!s.escort) s.escort = { hits: 0, hullLost: 0, shielded: 0, attacks: 0, disabled: 0, arrived: 0, saved: 0, rebukes: 0, orders: 0 };
  return s.escort;
}
const hpFrac = (es) => (es.hpMax > 0 ? Math.max(0, es.hp) / es.hpMax : 0);
const crewN = (game) => Math.max(1, Math.min(3, game.players.filter((p) => p.connected).length));

// ---------- Funk ohne Missionszustand (mission.radio würde einen offenen Funkspruch überschreiben) ----------
function radio(game, es, text) {
  game.emit('radio', { from: es.name, text });
  game.emit('sfx', { name: 'radio' });
}
function npcRecord(game, npc) {
  const w = game.weltstand;
  return npc && w && w.data && w.data.npc ? w.data.npc[npc] || null : null;
}
function haltung(game, es) {
  const n = npcRecord(game, es.npc);
  return n && Number.isFinite(Number(n.haltung)) ? Number(n.haltung) : 0;
}

// ---------- Punkte im Raum ----------
// spec: { x, y } | { dx, dy } (relativ zur Lerche) | 'west'|'ost'|'nord'|'sued'|'mitte'|'station'|'dock'|'lerche'|'vorn'|'achtern'|'rand'
//       | Orts-ID (Locations) -> { loc } (Ziel ist ein anderer Ort: der Schützling springt mit der Lerche)
function point(game, spec) {
  if (spec == null || spec === '') return null;
  const sp = game.space; const L = game.ship; const m = 150;
  if (typeof spec === 'object') {
    if (Number.isFinite(spec.x) && Number.isFinite(spec.y)) return { x: clamp(spec.x, 60, sp.w - 60), y: clamp(spec.y, 60, sp.h - 60) };
    if (Number.isFinite(spec.dx) && Number.isFinite(spec.dy)) return { x: clamp(L.x + spec.dx, 60, sp.w - 60), y: clamp(L.y + spec.dy, 60, sp.h - 60) };
    return null;
  }
  const s = String(spec);
  const loc = Locations.get(game.ship.scene); const sc = (loc && loc.scene) || {};
  switch (s) {
    case 'west': return { x: m, y: sp.h / 2 };
    case 'ost': return { x: sp.w - m, y: sp.h / 2 };
    case 'nord': return { x: sp.w / 2, y: m };
    case 'sued': return { x: sp.w / 2, y: sp.h - m };
    case 'mitte': return { x: sp.w / 2, y: sp.h / 2 };
    case 'station': return sc.station ? { x: sc.station.x, y: sc.station.y } : { x: sp.w / 2, y: sp.h / 2 };
    case 'dock': return sc.dock ? { x: sc.dock.x, y: sc.dock.y } : null;
    case 'lerche': {
      const a = L.angle + Math.PI / 2; const d = cfg(game).spawnDist;
      return { x: clamp(L.x + Math.cos(a) * d, 60, sp.w - 60), y: clamp(L.y + Math.sin(a) * d, 60, sp.h - 60) };
    }
    case 'vorn': return { x: clamp(L.x + Math.cos(L.angle) * 600, m, sp.w - m), y: clamp(L.y + Math.sin(L.angle) * 600, m, sp.h - m) };
    case 'achtern': return { x: clamp(L.x - Math.cos(L.angle) * 400, m, sp.w - m), y: clamp(L.y - Math.sin(L.angle) * 400, m, sp.h - m) };
    case 'rand': return null;   // flieht: nächster Rand (siehe goalFor)
    default:
      if (Locations.get(s) && Locations.get(s).id === s) return { loc: s };
      return null;
  }
}
// Richtungsziel zum nächsten Rand, weg von den Gegnern
function edgeAway(game, es) {
  const sp = game.space;
  let ax = 0, ay = 0;
  for (const e of sp.enemies) { const d = Math.hypot(es.x - e.x, es.y - e.y) || 1; ax += (es.x - e.x) / (d * d); ay += (es.y - e.y) / (d * d); }
  let a = (ax || ay) ? Math.atan2(ay, ax) : es.angle;
  const x = es.x + Math.cos(a) * 3000, y = es.y + Math.sin(a) * 3000;
  return { x: clamp(x, 60, sp.w - 60), y: clamp(y, 60, sp.h - 60), edge: true };
}

// ---------- Flags <tag>_heil | _beschaedigt | _verloren für Verzweigungen (genau eins ist true) ----------
// heil = Hülle ≥ warnAt[0] und nicht kampfunfähig; beschaedigt = darunter; verloren = kampfunfähig (auch bei benannten NSC,
// deren Ausgang im Weltstand dann schwer_beschaedigt heißt)
function syncFlags(game, es) {
  const f = game.mission && game.mission.flags;
  if (!f || !es || !es.tag) return;
  const lost = es.state === 'kampfunfaehig';
  const heil = !lost && es.hp >= es.hpMax * cfg(game).warnAt[0];
  f[es.tag + '_heil'] = heil;
  f[es.tag + '_beschaedigt'] = !lost && !heil;
  f[es.tag + '_verloren'] = lost;
}

// ---------- Anlegen ----------
// opts: { tag, kind, name?, npc?, verhalten, von?, nach?, reparatur_s?, huelle? (Prozent der Klassenhülle), befehl? }
function spawn(game, opts) {
  const o = opts || {};
  const C = cfg(game);
  const L = ensureList(game);
  const tag = String(o.tag || 'schuetzling');
  const old = L.find((q) => q.tag === tag);
  if (old && active(old)) return old;
  // QA-INTEGRATION S2: entkommene/kampfunfähige Einträge mit gleichem Tag ersetzen (wiederholte Szene/Mission am selben Ort)
  if (old) L.splice(L.indexOf(old), 1);
  if (game.space.escortsGone) game.space.escortsGone = game.space.escortsGone.filter((g) => g.tag !== tag);
  if (L.filter((q) => q.state !== 'entkommen').length >= C.max) {
    if (game.countError) game.countError('escort-spawn', new Error(`Höchstens ${C.max} Schützlinge – ${tag} nicht angelegt`));
    return null;
  }
  const kind = KINDS.includes(o.kind) ? o.kind : 'frachter';
  const c = cls(game, kind);
  const verhalten = VERHALTEN.includes(o.verhalten) ? o.verhalten : 'folgt_kurs';
  const npcRec = npcRecord(game, o.npc);
  const name = String(o.name || (npcRec && npcRec.name) || KIND_LABEL[kind]);
  const hpMax = Math.max(1, Math.round(Number((C.hull || {})[kind]) || 100));
  const pct = Number(o.huelle);
  const hp = Number.isFinite(pct) && pct > 0 ? Math.max(1, Math.round(hpMax * Math.min(100, pct) / 100)) : hpMax;
  const from = point(game, o.von != null ? o.von : 'lerche');
  const pos = from && from.x != null ? from : point(game, 'lerche');
  const nach = point(game, o.nach);
  const to = nach && nach.x != null ? nach : null;
  const angle = to ? Math.atan2(to.y - pos.y, to.x - pos.x) : game.ship.angle;
  const es = {
    id: game.nextId('es'), tag, kind, name, npc: o.npc || null, x: pos.x, y: pos.y, angle, vx: 0, vy: 0, turnVel: 0,
    stage: Flight.stopStage(c), hp, hpMax, state: hp / hpMax < C.warnAt[0] ? 'beschaedigt' : 'ok', befehl: o.befehl && BEFEHLE.includes(o.befehl) ? o.befehl : null,
    verhalten, ziel: to, zielLoc: nach && nach.loc ? nach.loc : null, nachSpec: o.nach != null ? o.nach : null,
    reparatur_s: Number(o.reparatur_s) > 0 ? Number(o.reparatur_s) : 0, repairLeft: Number(o.reparatur_s) > 0 ? Number(o.reparatur_s) : 0,
    repaired: false, hitT: -99, empT: 0, distress: false, pending: null, rebukeAt: -99, warned: [], arrived: false, saved: false,
    docked: false, spawnT: game.time, ausgang: null,
  };
  // Startfahrt: Geleit fährt schon (¼), Havarist treibt langsam
  if (verhalten === 'folgt_kurs' || verhalten === 'flieht') {
    const v = Flight.stageSpeed(c, stageNear(c, 0.25));
    es.vx = Math.cos(angle) * v; es.vy = Math.sin(angle) * v;
  } else if (verhalten === 'treibt') {
    es.vx = Math.cos(angle) * 6; es.vy = Math.sin(angle) * 6;
  }
  for (const w of C.warnAt) if (hp / hpMax < w) es.warned.push(w);
  es.distress = hpFrac(es) < C.distressBelow;
  L.push(es);
  syncFlags(game, es);
  game.missionEvent('escortSpawn', { escort: es });
  return es;
}
function stageNear(c, frac) {
  let best = 0, bd = Infinity;
  (c.stages || [0]).forEach((s, i) => { const d = Math.abs(s - frac); if (d < bd) { bd = d; best = i; } });
  return best;
}

// ---------- Befehle (cmd captain.escort) ----------
// Rückgabe: Fehlertext (Notice an den Spieler) oder null
function command(game, p, msg) {
  const m = msg || {};
  const befehl = String(m.befehl || '');
  if (!BEFEHLE.includes(befehl)) return 'Unbekannter Befehl (halten, folgen, volle_kraft, andocken).';
  const es = find(game, m.tag != null ? String(m.tag) : null);
  if (!es) return 'Kein Schützling im Funkbereich.';
  const C = cfg(game);
  stats(game).orders++;
  const refuse = (text, notice) => {
    game.emit('escortOrder', { id: es.id, befehl, ok: false });
    if (text) radio(game, es, text);
    game.missionEvent('escortOrder', { escort: es, befehl, ok: false });
    return notice || null;
  };
  if (es.state === 'kampfunfaehig') return refuse(null, `${es.name} antwortet nicht – kampfunfähig.`);
  if (es.state === 'entkommen') return refuse(null, `${es.name} ist schon in Sicherheit.`);
  if (es.verhalten === 'treibt' && !es.repaired && (befehl === 'folgen' || befehl === 'volle_kraft')) {
    return refuse('Antrieb ist tot – wir kommen keinen Meter vom Fleck. Erst flicken!', null);
  }
  const h = es.npc ? haltung(game, es) : 0;
  const D = C.obeyDelay || {};
  const delay = h >= 1 ? Number(D.pos) || 0 : h === 0 ? Number(D.neutral) || 0 : Number(D.neg) || 0;
  es.pending = { befehl, at: game.time + delay };
  if (delay <= 0) applyOrder(game, es);
  const label = BEFEHL_LABEL[befehl];
  if (h < 0) radio(game, es, murmur(befehl));
  else if (h >= 1) radio(game, es, `Verstanden, ${label}. Sofort.`);
  else radio(game, es, `${label[0].toUpperCase() + label.slice(1)} … gut, einen Moment.`);
  game.emit('escortOrder', { id: es.id, befehl, ok: true, delay: r1(delay) });
  game.missionEvent('escortOrder', { escort: es, befehl, ok: true });
  return null;
}
// Form, wie game.js (ENGINE) den cmd captain.escort weiterreicht
function order(game, tag, befehl, p) { return command(game, p, { tag, befehl }); }
function murmur(befehl) {
  const t = {
    halten: 'Halten? Mitten im Feuer? … Na schön. Aber das kostet.',
    folgen: 'Euch hinterher, ja? Hoffentlich wisst ihr, wohin. … Wir kommen.',
    volle_kraft: 'Volle Kraft – auf eure Verantwortung. … Triebwerk läuft hoch.',
    andocken: 'Andocken? Ihr seid nicht unsere Werft. … Na gut, kommt längsseits.',
  };
  return t[befehl] || 'Hm. Wenn’s sein muss.';
}
// Befehl aus dem Regiebuch (Baustein escort_order): sofort, ohne Gehorsamsprüfung und ohne Funk
function setOrder(game, tag, befehl) {
  const es = find(game, tag);
  if (!es || !active(es)) return false;
  const b = BEFEHLE.includes(befehl) ? befehl : null;
  es.pending = null; es.befehl = b; es.docked = false;
  game.emit('escortOrder', { id: es.id, befehl: b, ok: true });
  return true;
}
// Verhalten neu setzen (Baustein spawn_escort auf vorhandenen Tag, Missionen): treibt | folgt_kurs | flieht
function setBehaviour(game, tag, verhalten, nach) {
  const es = find(game, tag);
  if (!es || !VERHALTEN.includes(verhalten)) return false;
  es.verhalten = verhalten;
  if (nach !== undefined) { const p = point(game, nach); es.ziel = p && p.x != null ? p : null; es.zielLoc = p && p.loc ? p.loc : null; es.nachSpec = nach; }
  return true;
}
function applyOrder(game, es) {
  const p = es.pending; if (!p) return;
  es.pending = null;
  es.befehl = p.befehl;
  es.docked = false;
}

// ---------- Ziele der Gegner ----------
// ziel: 'lerche' | 'schuetzling' | 'auto' | <tag eines Schützlings>  -> Escort-ID oder null (= Lerche)
function pickTarget(game, ziel) {
  if (ziel == null || ziel === '' || ziel === 'lerche') return null;
  const act = list(game).filter(active);
  if (!act.length) return null;
  const byTag = act.find((q) => q.tag === ziel || q.id === ziel);
  if (byTag) return byTag.id;
  // am wenigsten anvisierter Schützling
  const load = (q) => game.space.enemies.filter((e) => e.targetId === q.id).length;
  const least = act.slice().sort((a, b) => load(a) - load(b))[0];
  if (ziel === 'schuetzling') return least.id;
  if (ziel === 'auto') {
    const sp = game.space;
    sp.escortAutoN = (sp.escortAutoN || 0) + 1;
    return sp.escortAutoN % 2 === 1 ? least.id : null;   // jeder zweite Gegner auf den Schützling
  }
  return null;
}
// Snapshot space.enemies[].tgt (Feld fehlt bei Ziel Lerche)
function enemyTgt(e) {
  return e && e.targetId != null && !(e.aggroT > 0) ? e.targetId : undefined;
}
// Treffer der Lerche: Gegner mit Schützling-Ziel wendet sich 10 s der Lerche zu (aggroOnHit)
function onLercheHit(game, e) {
  if (!e || e.targetId == null) return;
  e.aggroUntil = game.time + cfg(game).aggroOnHit;
}

// ---------- Angriffe auf Schützlinge (aus space.updateEnemies) ----------
function enemyCanHitEscort(game, e, es) {
  const W = game.C.enemyWeapons[e.kind] || [];
  return W.some((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, w.range, es.x, es.y));
}
// Liegt die Lerche auf der Linie e -> es (zwischen beiden)? -> { sector } sonst null
function interposed(game, e, es) {
  const L = game.ship; const R = cfg(game).shieldRadius;
  const sx = es.x - e.x, sy = es.y - e.y; const l2 = sx * sx + sy * sy;
  if (l2 < 1) return null;
  const t = ((L.x - e.x) * sx + (L.y - e.y) * sy) / l2;
  if (t <= 0 || t >= 1) return null;
  const px = e.x + sx * t, py = e.y + sy * t;
  if (Math.hypot(L.x - px, L.y - py) > R) return null;
  return { sector: Physics.sectorOf(L.x, L.y, L.angle, e.x, e.y) };
}
function teleFor(game, e) {
  const T = (game.C.spaceM3 && game.C.spaceM3.tele) || {};
  if (T[e.kind]) return { heavy: true, dur: T[e.kind].dur, damage: T[e.kind].damage, emp: !!T[e.kind].emp };
  const ec = game.C.enemies[e.kind] || {};
  const d = cfg(game).tele;
  return { heavy: false, dur: d.dur, damage: d.damage != null ? d.damage : ec.damage, emp: !!ec.emp, shots: d.shots || 1 };
}
function startTele(game, e, es) {
  const t = teleFor(game, e);
  const sector = Physics.sectorOf(game.ship.x, game.ship.y, game.ship.angle, e.x, e.y);
  e.tele = { kind: t.emp ? 'emp' : 'shot', left: t.dur, dur: t.dur, sector, delayed: 0, tgt: es.id };
  stats(game).attacks++;
  game.emit('tele', { id: e.id, tkind: e.tele.kind, sector, dur: t.dur, enemy: e.kind, tgt: es.id });
  game.emit('sfx', { name: 'tele_charge', enemy: e.kind, dur: t.dur, key: e.id });
  game.missionEvent('tele', { enemy: e, escort: es });
  // Jeder Angriff auf einen Schützling wird angesagt (auch zu dritt – anders als Ladungen auf die Lerche)
  e.teleOdaAt = game.time;
  game.oda(`${ENEMY_LABEL[e.kind] || 'Gegner'} lädt auf ${es.name}!`, null);
}
// Ein Tick Angriffslogik eines Gegners, dessen Ziel der Schützling es ist (d = Abstand e -> es)
function updateAttack(game, e, es, d, retreating, dt) {
  const S = space(); const ship = game.ship; const cfgE = game.C.enemies[e.kind] || {};
  if (e.tele) {
    if (retreating || ship.docked || e.tele.tgt !== es.id) { e.tele = null; e.fireT = 0; game.emit('teleMiss', { id: e.id }); return; }
    e.tele.sector = Physics.sectorOf(ship.x, ship.y, ship.angle, e.x, e.y);
    e.tele.left -= dt;
    if (e.tele.left > 0) return;
    const emp = e.tele.kind === 'emp';
    e.tele = null; e.fireT = 0;
    const t = teleFor(game, e);
    const range = cfgE.range || 400;
    if (!(d <= range * 1.15 && enemyCanHitEscort(game, e, es))) {
      game.stats.teleMisses = (game.stats.teleMisses || 0) + 1;
      game.emit('teleMiss', { id: e.id });
      return;
    }
    if (!t.heavy) {
      // Jäger: Salve als Projektil(e) auf den Schützling – die Lerche kann sie mit dem Rumpf abfangen (space.updateProjectiles)
      const C = game.C;
      const ang = S.leadAngle(e.x, e.y, es, C.combat.enemyShotSpeed, 1);
      for (let i = 0; i < (t.shots || 1); i++) {
        game.space.projectiles.push({ id: game.nextId('pr'), kind: emp ? 'emp' : 'enemy', x: e.x, y: e.y, angle: ang + (i ? (i % 2 ? 0.04 : -0.04) : 0),
          speed: C.combat.enemyShotSpeed, ttl: C.combat.enemyShotTtl, dmg: t.damage, owner: e.id, tgt: es.id });
      }
      game.emit('sfx', { name: 'blaster' });
      return;
    }
    // schwerer Treffer: Strahl. Breitseite als Schild?
    const ip = interposed(game, e, es);
    const C = game.C;
    if (ip && (Number(ship.shields.current[ip.sector]) || 0) >= 1) {
      game.space.beams.push({ x1: e.x, y1: e.y, x2: ship.x, y2: ship.y, ttl: C.combat.beamTtl * 1.6, kind: 'enemy_heavy', owner: e.id });
      game.emit('sfx', { name: 'heavy_hit', enemy: e.kind });
      game.stats.heavyHits = (game.stats.heavyHits || 0) + 1;
      stats(game).shielded++;
      S.shipHit(game, ip.sector, t.damage != null ? t.damage : cfgE.damage, { heavy: true, emp, shielded: es.id });
      game.missionEvent('escortShielded', { escort: es, enemy: e });
      return;
    }
    game.space.beams.push({ x1: e.x, y1: e.y, x2: es.x, y2: es.y, ttl: C.combat.beamTtl * 1.6, kind: 'enemy_heavy', owner: e.id });
    game.emit('sfx', { name: 'heavy_hit', enemy: e.kind });
    hit(game, es, t.damage != null ? t.damage : cfgE.damage, { heavy: true, emp, enemy: e });
    return;
  }
  e.fireT += dt;
  const PF = Pilot.flies(game, e) ? (((game.C.spaceM3b || {}).pilotFire || {})[e.kind] || null) : null;
  const interval = (PF && PF.fireInterval != null ? PF.fireInterval : cfgE.fireInterval) * S.crewScale(game).enemyFireInterval;
  if (!retreating && !ship.docked && !S.holdingFire(game) && e.fireT >= interval && d <= (cfgE.range || 0) && enemyCanHitEscort(game, e, es)) startTele(game, e, es);
}

// ---------- Schaden ----------
// opts: { heavy, emp, enemy }
function hit(game, es, dmg, opts) {
  if (!active(es)) return null;
  const o = opts || {}; const C = cfg(game);
  const st = stats(game);
  es.hitT = game.time;
  const f0 = hpFrac(es);
  let hull = 0;
  if (o.emp) {
    es.empT = C.empStall;
    game.emit('sfx', { name: 'emp' });
  } else {
    const cd = (C.crewDamage || {})[crewN(game)];   // QA-INTEGRATION S2: Härte skaliert mit der Crewgröße
    hull = r1((Number(dmg) || 0) * C.hullPerDamage * (Number(cd) > 0 ? Number(cd) : 1));
    es.hp = Math.max(0, r1(es.hp - hull));
  }
  st.hits++; st.hullLost = r1(st.hullLost + hull);
  const f1 = hpFrac(es);
  if (es.hp > 0) { if (f1 < C.warnAt[0] && es.state === 'ok') es.state = 'beschaedigt'; syncFlags(game, es); }
  game.emit('escortHit', { id: es.id, hpFrac: r2(f1), emp: !!o.emp || undefined });
  game.emit('sfx', { name: 'escort_hit' });
  game.missionEvent('escortHit', { escort: es });
  if (es.hp <= 0) { disable(game, es); return { hull }; }
  for (const w of C.warnAt) {
    if (f0 >= w && f1 < w && !es.warned.includes(w)) {
      es.warned.push(w);
      game.emit('escortDistress', { id: es.id, hpFrac: r2(f1) });
      game.emit('sfx', { name: 'distress' });
      game.missionEvent('escortDistress', { escort: es, pct: Math.round(w * 100) });
      radio(game, es, w <= 0.25 ? `Hülle bei ${Math.round(f1 * 100)} %! Noch ein Treffer und wir sind erledigt!`
        : w <= 0.5 ? `Hülle bei ${Math.round(f1 * 100)} % – wir brauchen Deckung, sofort!` : `Treffer! Hülle bei ${Math.round(f1 * 100)} %. Haltet sie uns vom Leib!`);
    }
  }
  if (f1 < C.warnAt[0] && es.state === 'ok') es.state = 'beschaedigt';
  es.distress = f1 < C.distressBelow;
  return { hull };
}
function disable(game, es) {
  es.hp = 0; es.state = 'kampfunfaehig'; es.distress = false; es.befehl = null; es.pending = null; es.docked = false;
  es.ausgang = es.npc ? 'schwer_beschaedigt' : 'verloren';
  syncFlags(game, es);
  stats(game).disabled++;
  for (const e of game.space.enemies) if (e.targetId === es.id && e.tele && e.tele.tgt === es.id) { e.tele = null; e.fireT = 0; game.emit('teleMiss', { id: e.id }); }
  game.emit('escortDisabled', { id: es.id });
  game.emit('sfx', { name: 'escort_lost' });
  game.emit('explosion', { x: Math.round(es.x), y: Math.round(es.y), zone: 'space' });
  game.oda(`${es.name} ist kampfunfähig – treibt ohne Antrieb.`, null);
  game.missionEvent('escortDisabled', { escort: es });
}

// ---------- Kein Eigenbeschuss: Rüffel, wenn die Lanze durch einen Schützling ging ----------
// tr = space.lanceTrace(): { o, dx, dy, t } – t = Länge des Strahls bis zum Treffer bzw. Reichweite
function lanceCrossed(game, tr) {
  const L = list(game); if (!L.length || !tr) return null;
  const C = cfg(game); const width = ((game.C.spaceM3 && game.C.spaceM3.lance) || {}).width || 10;
  for (const es of L) {
    if (es.state === 'entkommen') continue;
    const rx = es.x - tr.o.x, ry = es.y - tr.o.y;
    const t = rx * tr.dx + ry * tr.dy;
    const rad = ((cls(game, es.kind) || {}).radius || 30) + width;
    if (t < -rad || t > tr.t + rad) continue;
    if (Math.abs(-rx * tr.dy + ry * tr.dx) >= rad) continue;
    stats(game).rebukes++;
    game.missionEvent('escortRebuke', { escort: es });
    if (game.time - (es.rebukeAt == null ? -99 : es.rebukeAt) >= C.rebukeCooldown) {
      es.rebukeAt = game.time;
      radio(game, es, es.state === 'kampfunfaehig' ? 'Wir treiben hier noch! Nehmt die Lanze von uns weg!' : 'He! Eure Lanze ging durch unseren Rumpf – zielt gefälligst woanders hin!');
    }
    return es;
  }
  return null;
}

// ---------- Projektil trifft Schützling? (space.updateProjectiles, nur Projektile mit tgt) ----------
function projectileHit(game, p) {
  const es = list(game).find((q) => q.id === p.tgt);
  if (!es || !active(es)) return false;
  const r = ((cls(game, es.kind) || {}).radius || 30) + cfg(game).hitRadius;
  if (Math.hypot(p.x - es.x, p.y - es.y) >= r) return false;
  hit(game, es, p.dmg, { emp: p.kind === 'emp' });
  return true;
}

// ---------- Rückzug (Baustein enemies_retreat) ----------
// Gegner (alle bzw. mit tag) unter unter_pct % Hülle drehen ab und verlassen das Feld. Regel gilt bis zum Szenenwechsel.
function retreat(game, opts) {
  const o = opts || {};
  const pct = Number(o.unter_pct);
  game.space.retreatRule = { tag: o.tag || null, pct: Number.isFinite(pct) && pct > 0 ? pct : 101 };
  applyRetreat(game);
}
function applyRetreat(game) {
  const R = game.space.retreatRule; if (!R) return;
  for (const e of game.space.enemies) {
    if (e.leaving || e.kind === 'relay' || e.kind === 'pylon') continue;
    if (R.tag && e.tag !== R.tag && e.kind !== R.tag) continue;
    if (!(e.hp / (e.hpMax || 1) * 100 < R.pct)) continue;
    e.leaving = true; e.leaveT = 0; e.retreatUntil = game.time + 9999; e.targetId = null;
    if (e.tele) { e.tele = null; game.emit('teleMiss', { id: e.id }); }
    game.missionEvent('enemyRetreat', { enemy: e });
  }
}
function updateLeaving(game, dt) {
  const sp = game.space; const out = [];
  for (const e of sp.enemies) {
    if (!e.leaving) continue;
    e.leaveT = (e.leaveT || 0) + dt;
    const m = 90;
    if (e.leaveT > 14 || e.x < m || e.y < m || e.x > sp.w - m || e.y > sp.h - m) out.push(e);
  }
  if (!out.length) return;
  sp.enemies = sp.enemies.filter((e) => !out.includes(e));
  for (const e of out) {
    if (game.ship.target === e.id) game.ship.target = null;
    game.emit('teleMiss', { id: e.id });
    game.missionEvent('enemyLeft', { enemy: e });
  }
  if (!sp.enemies.length) game.oda('Sie drehen ab – Kontakt verloren.', null);
}

// ---------- Bewegung ----------
function underFire(game, es) {
  if (game.time - es.hitT < cfg(game).underFireHold) return true;
  return game.space.enemies.some((e) => e.tele && e.tele.tgt === es.id);
}
function mode(es) {
  if (es.verhalten === 'treibt' && !es.repaired) return 'treibt';
  return es.befehl || es.verhalten;
}
// Wunschpunkt + Wunschtempo (px/s) je Modus; null = halten (bremsen)
function goalFor(game, es, c) {
  const C = cfg(game); const L = game.ship;
  const Lv = Math.hypot(L.vx || 0, L.vy || 0);
  const max = c.maxSpeed;
  const md = mode(es);
  const dL = Math.hypot(L.x - es.x, L.y - es.y);
  const follow = () => {
    const back = L.angle + Math.PI;
    const side = es.followSide || (es.followSide = (String(es.id).length % 2 ? 1 : -1));
    const gx = L.x + Math.cos(back) * C.followDist + Math.cos(back + Math.PI / 2) * 60 * side;
    const gy = L.y + Math.sin(back) * C.followDist + Math.sin(back + Math.PI / 2) * 60 * side;
    const d = Math.hypot(gx - es.x, gy - es.y);
    return { x: gx, y: gy, speed: clamp(Lv + d * 0.4, 0, max), stopDist: 30 };
  };
  if (md === 'treibt') return { drift: true };
  if (md === 'halten') return null;
  if (md === 'folgen') return follow();
  if (md === 'andocken') {
    const a = L.angle + Math.PI / 2;
    const gap = ((game.C.flight && game.C.flight.radius) || 36) + (c.radius || 30) + C.dockGap;
    const gx = L.x + Math.cos(a) * gap, gy = L.y + Math.sin(a) * gap;
    const d = Math.hypot(gx - es.x, gy - es.y);
    if (d < 40 && Lv < C.dockSpeed) es.docked = true;
    return { x: gx, y: gy, speed: clamp(Lv + d * 0.5, 0, max * 0.6), stopDist: 20 };
  }
  if (md === 'volle_kraft' || md === 'flieht') {
    const g = es.ziel || (es.zielLoc ? null : edgeAway(game, es));
    if (!g) return Object.assign(follow(), { speed: max });
    return { x: g.x, y: g.y, speed: max, stopDist: 0, edge: !!g.edge };
  }
  // folgt_kurs: zum Ziel, Tempo nach der Lerche
  if (!es.ziel) return follow();
  const toG = Math.atan2(es.ziel.y - es.y, es.ziel.x - es.x);
  const lAhead = ((L.x - es.x) * Math.cos(toG) + (L.y - es.y) * Math.sin(toG)) > 0;   // Lerche liegt in Fahrtrichtung voraus
  const cr = C.cruise || {};
  const cruiseMin = max * (Number(cr.min) || 0.25), cruiseMax = max * (Number(cr.max) || 0.75);
  let speed;
  if (dL > C.leash && !lAhead) speed = 0;                                  // Lerche zurückgefallen: warten
  else if (lAhead) speed = cruiseMax;
  else speed = clamp(Lv + 10, cruiseMin, cruiseMax);
  return { x: es.ziel.x, y: es.ziel.y, speed, stopDist: 0 };
}
function stepEscort(game, es, dt) {
  const C = cfg(game); const c = cls(game, es.kind); const sp = game.space; const L = game.ship;
  if (es.pending && game.time >= es.pending.at) applyOrder(game, es);
  es.empT = Math.max(0, (es.empT || 0) - dt);
  let input;
  let g = null;
  if (es.state === 'kampfunfaehig' || es.state === 'entkommen') input = { stage: Flight.stopStage(c), rudder: 0, brake: es.state === 'entkommen' };
  else {
    g = goalFor(game, es, c);
    if (g && g.drift) input = { stage: Flight.stopStage(c), rudder: 0, brake: false };
    else {
      const md = mode(es);
      if (g && underFire(game, es) && md !== 'volle_kraft' && md !== 'flieht') g = null;   // unter Beschuss: anhalten
      input = Pilot.escort(game, es, c, g);
    }
  }
  Flight.stepBody(es, input, c, { speedFactor: es.empT > 0 ? 0 : 1 }, dt);
  // Rand und Abstand zur Lerche
  const m = 40;
  if (es.x < m) { es.x = m; es.vx = Math.max(0, es.vx); }
  if (es.x > sp.w - m) { es.x = sp.w - m; es.vx = Math.min(0, es.vx); }
  if (es.y < m) { es.y = m; es.vy = Math.max(0, es.vy); }
  if (es.y > sp.h - m) { es.y = sp.h - m; es.vy = Math.min(0, es.vy); }
  const min = ((game.C.flight && game.C.flight.radius) || 36) + (c.radius || 30);
  const dx = es.x - L.x, dy = es.y - L.y; const d = Math.hypot(dx, dy);
  if (d < min) {
    const nx = d > 0.01 ? dx / d : Math.cos(L.angle + Math.PI / 2), ny = d > 0.01 ? dy / d : Math.sin(L.angle + Math.PI / 2);
    es.x = L.x + nx * min; es.y = L.y + ny * min;
    const vn = (es.vx - (L.vx || 0)) * nx + (es.vy - (L.vy || 0)) * ny;
    if (vn < 0) { es.vx -= vn * nx; es.vy -= vn * ny; }
  }
  if (!active(es)) return;
  // Reparatur des Havaristen: Lerche nah und langsam, kein Beschuss
  if (es.verhalten === 'treibt' && !es.repaired && es.reparatur_s > 0) {
    const Lv = Math.hypot(L.vx || 0, L.vy || 0);
    const near = d < C.repairDist && Lv < C.repairSpeed && !underFire(game, es);
    if (near) {
      if (!es.repairing) { es.repairing = true; game.emit('sfx', { name: 'repair_start' }); }
      es.repairLeft = Math.max(0, es.repairLeft - dt);
      if (es.repairLeft <= 0) {
        es.repaired = true; es.repairing = false;
        es.verhalten = 'folgt_kurs';   // ohne Ziel: folgt der Lerche (goalFor)
        es.hp = Math.max(es.hp, Math.round(es.hpMax * 0.6));
        if (hpFrac(es) >= C.warnAt[0]) es.state = 'ok';
        es.distress = hpFrac(es) < C.distressBelow;
        syncFlags(game, es);
        es.befehl = es.befehl === 'halten' || es.befehl === 'andocken' ? null : es.befehl;
        stats(game).saved++;
        es.saved = true;
        game.emit('escortSaved', { id: es.id });
        game.emit('sfx', { name: 'escort_saved' });
        radio(game, es, es.ziel || es.zielLoc ? 'Antrieb läuft wieder! Danke – wir nehmen Kurs auf.' : 'Antrieb läuft wieder! Wir bleiben an euch dran.');
        game.missionEvent('escortSaved', { escort: es });
      }
    } else es.repairing = false;
  }
  // Ankunft
  const md = mode(es);
  if ((md === 'folgt_kurs' || md === 'volle_kraft' || md === 'flieht') && md !== 'treibt') {
    let arrived = false;
    if (es.ziel && Math.hypot(es.ziel.x - es.x, es.ziel.y - es.y) < C.arriveDist) arrived = true;
    else if (!es.ziel && !es.zielLoc && (md === 'flieht' || md === 'volle_kraft')) {
      const e = 110; arrived = es.x < e || es.y < e || es.x > sp.w - e || es.y > sp.h - e;
    }
    if (arrived) arrive(game, es);
  }
  es.distress = active(es) && hpFrac(es) < C.distressBelow;
}
function arrive(game, es) {
  if (es.arrived) return;
  es.arrived = true; es.state = 'entkommen'; es.distress = false; es.befehl = null; es.pending = null;
  es.ausgang = es.hp >= es.hpMax * cfg(game).warnAt[0] ? 'heil' : 'beschaedigt';
  syncFlags(game, es);
  stats(game).arrived++;
  game.emit('escortArrived', { id: es.id });
  game.emit('sfx', { name: 'escort_saved' });
  radio(game, es, 'Wir sind durch! Danke für das Geleit – das vergessen wir nicht.');
  game.missionEvent('escortArrived', { escort: es });
}

// ---------- Tick (aus space.update, nur wenn Schützlinge oder eine Rückzugsregel existieren) ----------
function update(game, dt) {
  const sp = game.space;
  if (sp.retreatRule) applyRetreat(game);
  if (sp.enemies.some((e) => e.leaving)) updateLeaving(game, dt);
  for (const e of sp.enemies) if (e.aggroUntil != null) e.aggroT = Math.max(0, e.aggroUntil - game.time);
  for (const es of list(game)) {
    try { stepEscort(game, es, dt); } catch (err) { if (game.countError) game.countError('escort', err); }
  }
}

// ---------- Szenenwechsel (aus space.enterScene) ----------
// Aktive Schützlinge springen mit (außer Havarist ohne Antrieb und „halten“); die anderen bleiben zurück und werden als
// Erinnerung (escortsGone) behalten, damit Prüfungen und Ausgang weiter funktionieren.
function onSceneChange(game, fromScene) {
  const sp = game.space; const L = list(game);
  if (!L.length) return;
  const keep = []; const gone = sp.escortsGone || (sp.escortsGone = []);
  L.forEach((es, i) => {
    const comes = active(es) && mode(es) !== 'treibt' && es.befehl !== 'halten';
    if (!comes) { gone.push(memo(es)); return; }
    const back = game.ship.angle + Math.PI + (i ? 0.5 : -0.5);
    es.x = clamp(game.ship.x + Math.cos(back) * 220, 60, sp.w - 60); es.y = clamp(game.ship.y + Math.sin(back) * 220, 60, sp.h - 60);
    es.vx = 0; es.vy = 0; es.turnVel = 0; es.angle = game.ship.angle; es.docked = false;
    // Ziel im alten Ort gilt nicht mehr; Ziel-Ort erreicht -> angekommen
    if (es.zielLoc && es.zielLoc === game.ship.scene) { keep.push(es); arrive(game, es); return; }
    es.ziel = es.nachSpec && typeof es.nachSpec === 'string' && !es.zielLoc ? point(game, es.nachSpec) : null;
    if (es.ziel && es.ziel.loc) es.ziel = null;
    keep.push(es);
  });
  sp.escorts = keep;
  while (gone.length > 8) gone.shift();
  if (fromScene) for (const es of keep) game.missionEvent('escortJumped', { escort: es, from: fromScene });
}
function memo(es) {
  return { id: es.id, tag: es.tag, kind: es.kind, name: es.name, npc: es.npc, state: es.state, hp: es.hp, hpMax: es.hpMax,
    arrived: es.arrived, saved: es.saved, ausgang: outcomeOf(es) };
}
function outcomeOf(es) {
  if (!es) return null;
  if (es.state === 'kampfunfaehig') return es.npc ? 'schwer_beschaedigt' : 'verloren';
  return es.hp >= es.hpMax * (DEFAULTS.warnAt[0]) ? 'heil' : 'beschaedigt';
}

// ---------- Abfragen (Bausteine, Platzhalter) ----------
function record(game, tag) { return find(game, tag) || findGone(game, tag); }
function hpPct(game, tag) {
  const r = record(game, tag);
  return r && r.hpMax > 0 ? Math.round(Math.max(0, r.hp) / r.hpMax * 100) : 0;
}
// 'heil' | 'beschaedigt' | 'verloren' | 'schwer_beschaedigt' | null (unbekannt)
function outcome(game, tag) {
  const r = record(game, tag);
  return r ? (r.ausgang && r.state === 'kampfunfaehig' ? r.ausgang : outcomeOf(r)) : null;
}
function stateOf(game, tag) { const r = record(game, tag); return r ? r.state : null; }
function arrived(game, tag) { const r = record(game, tag); return !!(r && r.arrived); }

// ---------- Snapshot space.escorts[] (≈ 110 B je Schützling) ----------
function snapshot(game) {
  return list(game).slice(0, 2).map((es) => {
    const o = { id: es.id, tag: es.tag, kind: es.kind, name: es.name, x: Math.round(es.x), y: Math.round(es.y), angle: r2(es.angle),
      hp: Math.ceil(es.hp), hpMax: es.hpMax, state: es.state, befehl: es.befehl, distress: !!es.distress };
    if (es.pending) o.pending = es.pending.befehl;
    if (es.verhalten === 'treibt' && !es.repaired && es.reparatur_s > 0) o.repair = r2(1 - es.repairLeft / es.reparatur_s);
    return o;
  });
}

// ---------- Debug `escort <kind> [angriff]` ----------
function debug(game, args, p) {   // eslint-disable-line no-unused-vars
  const a = Array.isArray(args) ? args.map(String) : (typeof args === 'string' ? args.trim().split(/\s+/).filter(Boolean) : []);
  return debugSpawn(game, a[0], a.slice(1));
}
function debugSpawn(game, kind, extra) {
  if (game.ship.docked) return 'Nicht angedockt.';
  const k = KINDS.includes(kind) ? kind : 'frachter';
  const ex = extra || [];
  const verhalten = ex.find((x) => VERHALTEN.includes(x)) || (k === 'bergungsboot' ? 'treibt' : 'folgt_kurs');
  const n = list(game).length;
  if (list(game).filter((q) => q.state !== 'entkommen').length >= cfg(game).max) return `Höchstens ${cfg(game).max} Schützlinge.`;
  const hpArg = ex.map((x) => /^hp(\d+)$/.exec(x)).find(Boolean);   // QA: „escort frachter hp30“ = Start mit 30 % Hülle (Notruf)
  const es = spawn(game, { tag: 'debug' + (n + 1), kind: k, verhalten, von: 'lerche', nach: verhalten === 'folgt_kurs' ? 'vorn' : null,
    reparatur_s: verhalten === 'treibt' ? 20 : 0, huelle: hpArg ? Number(hpArg[1]) : undefined });
  if (!es) return `Höchstens ${cfg(game).max} Schützlinge.`;
  if (ex.includes('angriff')) {
    const S = space();
    S.spawnEnemy(game, 'raider', { ziel: es.tag });
    S.spawnEnemy(game, 'gunboat', { ziel: es.tag });
  }
  return null;
}

module.exports = {
  spawn, command, order, setOrder, setBehaviour, update, hit, disable, snapshot, enemyTgt, pickTarget, onLercheHit, updateAttack, interposed, lanceCrossed,
  projectileHit, retreat, onSceneChange, hpPct, outcome, stateOf, arrived, find, list, debug, debugSpawn, point,
  targetOf: Pilot.targetOf, KINDS, VERHALTEN, BEFEHLE, STATES, POINTS,
};
