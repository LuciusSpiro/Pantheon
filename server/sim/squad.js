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
// B1 §6.4/B2 §5: opts { map, bereich?, besetzung?: [{ typ, anzahl }], alert?, force? } -> Spawns an `wache`-Ankern der
// Karte (bzw. im Bereich), Besetzung aus Daten. Ohne map/besetzung/bereich: Kesh-Spawns aus der Legende wie bisher.
function spawnSquad(game, name, opts) {
  const o = opts || {};
  if (o.map || o.besetzung || o.bereich) return spawnAnKarte(game, name, o);
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
// Typen der Besetzung: Altnamen des Kampfs v2 (scavenger/warden) und B2-Rollen. Rollen ohne eigene Kampfwerte in
// CONFIG.awayCombat.enemy laufen bis B2 Welle 2 als Plünderer bzw. Wächter (e.rolle trägt die Rolle).
const TYP_KIND = { scavenger: 'scavenger', pluenderer: 'scavenger', grundtyp: 'scavenger', niederhalter: 'scavenger', grenadier: 'scavenger',
  schuetze: 'scavenger', enterer: 'scavenger', haescher: 'scavenger', warden: 'warden', waechter: 'warden' };
function kindVon(game, typ) {
  if (cfg(game).enemy[typ]) return typ;
  return TYP_KIND[typ] || 'scavenger';
}
function inRects(rects, x, y) { return (rects || []).some((r) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]); }
// Handkarten: Bereiche aus shared/maps.js (MAP_AREAS/inArea)
function handBereich(info, bereich) {
  const M = W.Maps;
  if (!M || !M.inArea || !M.MAP_AREAS || !M.MAP_AREAS[info.id] || !M.MAP_AREAS[info.id][bereich]) return null;
  return (x, y) => M.inArea(info.id, bereich, x, y);
}
// Spawn-Kandidaten: wache-Anker (schwer getrennt, nach id sortiert), dazu begehbare Kacheln des Bereichs als Ersatz.
// Ohne Bereich: Anker in den Gefechtsbereichen, sonst alle wache-Anker.
function spawnPlaetze(game, info, bereich) {
  const k = info.karte; const anker = (k && k.anker) || [];
  const bereiche = (k && k.bereiche) || {};
  const b = bereich ? bereiche[bereich] : null;
  let inB;
  let gefRects = null;
  if (bereich) inB = (a) => a.bereich === bereich || (b && inRects(b.rects, a.x, a.y));
  else {
    const gef = Object.keys(bereiche).sort().filter((id) => bereiche[id] && bereiche[id].gefecht);
    if (gef.length) gefRects = gef.flatMap((id) => bereiche[id].rects || []);
    inB = gef.length ? (a) => gef.some((id) => a.bereich === id || inRects(bereiche[id].rects, a.x, a.y)) : () => true;
  }
  let wachen = anker.filter((a) => a.rolle === 'wache' && inB(a));
  if (!wachen.length && !bereich) wachen = anker.filter((a) => a.rolle === 'wache');
  const sort = (p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
  const map = info.map;
  const pads = new Set((info.pads || []).map((q) => q.x + ',' + q.y));
  const hb = bereich && !b ? handBereich(info, bereich) : null;
  const frei = [];
  for (let y = 1; y < map.h - 1; y++) for (let x = 1; x < map.w - 1; x++) {
    if (map.solid(x, y) || pads.has(x + ',' + y)) continue;
    if (b && !inRects(b.rects, x, y)) continue;
    if (gefRects && !inRects(gefRects, x, y)) continue;   // ohne Bereich: Ersatzplätze in den Gefechtsbereichen
    if (hb && !hb(x, y)) continue;
    frei.push({ x, y });
  }
  return { normal: wachen.filter((a) => !a.schwer).sort(sort), schwer: wachen.filter((a) => a.schwer).sort(sort), frei };
}
function spawnAnKarte(game, name, o) {
  const C = cfg(game);
  const mapId = o.map || (game.away && game.away.map);
  const aw = game.aways && game.aways[mapId];
  if (!aw || !W.AWAY_MAPS[mapId]) return 0;
  combat().ensureV2(game, aw);
  if (aw.spawned[name] && !o.force) return 0;
  const info = interior().awayInfoOf(mapId);
  // Handkarte mit Legenden-Spawns unter diesem Namen und ohne Besetzung/Bereich: Legenden-Spawns
  if (!o.besetzung && !o.bereich && info.spawns && info.spawns[name]) return spawnLegende(game, aw, info, name, o);
  const P = spawnPlaetze(game, info, o.bereich || null);
  let bes = Array.isArray(o.besetzung) && o.besetzung.length ? o.besetzung
    : [{ typ: 'scavenger', anzahl: P.normal.length || 3 }].concat(P.schwer.length ? [{ typ: 'warden', anzahl: P.schwer.length }] : []);
  bes = bes.filter((q) => q && q.typ && !(q.anzahl <= 0));
  const scale = C.squadScale[crewSize(game)] != null ? C.squadScale[crewSize(game)] : 1;
  const used = new Set(aw.drones.filter((d) => d.alive).map((d) => { const t = tileOf(d.x, d.y); return t.x + ',' + t.y; }));   // schon besetzt
  const take = (list) => { const a = list.find((q) => !used.has(q.x + ',' + q.y)); if (a) used.add(a.x + ',' + a.y); return a || null; };
  const takeFrei = () => {
    const rest = P.frei.filter((q) => !used.has(q.x + ',' + q.y));
    if (!rest.length) return null;
    const q = rest[Math.floor(aw.rng() * rest.length)];
    used.add(q.x + ',' + q.y);
    return q;
  };
  const list = [];
  for (const q of bes) {
    const kind = kindVon(game, q.typ);
    const want = Math.max(1, Math.floor(q.anzahl == null ? 1 : q.anzahl));
    const n = kind === 'warden' ? want : Math.max(1, Math.ceil(want * scale));   // Wächter werden nicht skaliert
    for (let i = 0; i < n; i++) {
      const t = kind === 'warden' ? (take(P.schwer) || take(P.normal) || takeFrei()) : (take(P.normal) || takeFrei() || take(P.schwer));
      if (!t) break;
      list.push({ kind, typ: q.typ, t });
    }
  }
  if (!list.length) return 0;
  aw.spawned[name] = true;
  const s = aw.squads[name] = newSquad(name, list.length);
  const pre = String(name).replace(/[^a-z0-9]/gi, '').slice(0, 3) || 't';
  for (const it of list) {
    const e = makeEnemy(game, aw, it.kind, pre + '-' + game.nextId(''), W.tileCenter(it.t.x, it.t.y), name);
    if (it.typ !== it.kind) e.rolle = it.typ;
    if (o.alert && e.kind === 'warden') e.asleep = false;
    aw.drones.push(e);
  }
  if (list.every((it) => it.kind === 'warden')) s.noBark = true;
  if (o.alert) alertSquad(game, aw, s);
  return list.length;
}
// Legenden-Spawns einer Handkarte (Format info.spawns[name] wie Kesh) auf beliebiger Handkarte
function spawnLegende(game, aw, info, name, o) {
  const C = cfg(game);
  const spots = info.spawns[name].slice();
  if (!spots.length) return 0;
  const scale = C.squadScale[crewSize(game)] != null ? C.squadScale[crewSize(game)] : 1;
  const n = Math.max(1, Math.min(spots.length, Math.ceil(spots.length * scale)));
  aw.spawned[name] = true;
  const s = aw.squads[name] = newSquad(name, n);
  for (let i = 0; i < n; i++) {
    const t = spots[i];
    aw.drones.push(makeEnemy(game, aw, 'scavenger', name.charAt(0) + name.slice(-1) + '-' + game.nextId(''), W.tileCenter(t.x, t.y), name));
  }
  if (o.alert) alertSquad(game, aw, s);
  return n;
}
function alertSquad(game, aw, s) {
  s.alert = true; s.contactAt = game.time; s.lostBarked = false;
  for (const p of game.players) if (p.zone === 'away' && p.connected) s.lastKnown[p.id] = { x: p.x, y: p.y, t: game.time };
}
function wakeWarden(game, map) {
  const aw = map ? game.aways[map] : game.aways.kesh;   // ohne map: Kesh (m3) wie bisher
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
// B2: Funk aus den Funksätzen der Rolle (KATALOG gegner/<rolle>.json, Schlüssel allgemein, ueberhitzt, kamerad_liegt,
// spieler_gefesselt, alarm_laerm, friendly_fire); sonst die alten Plünderer-Sätze (CONFIG.awayCombat.barks).
const FUNK_ART = { contact: 'allgemein', flankLeft: 'allgemein', flankRight: 'allgemein', playerDown: 'allgemein' };
function funkVon(game, e, kind) {
  const r = e.rolle;
  if (!r || !combat().waffenAktiv()) return null;
  const g = (combat().katalogDaten(game).gegner || {})[r];
  if (!g || !g.funk) return null;
  const list = g.funk[kind] || g.funk[FUNK_ART[kind]] || null;
  if (!list || !list.length) return null;
  const namen = g.namen || {};
  return { list, from: namen[e.fraktion] || namen.germanen || Object.values(namen)[0] || 'Gegner' };
}
function bark(game, s, e, kind) {
  const C = cfg(game); const aw = game.away;
  if (!C.barksOn || !s || s.noBark || !e || e.kind === 'warden') return false;
  if (game.time - s.barkAt < C.barkCooldown) return false;
  const f = funkVon(game, e, kind);
  const list = f ? f.list : ((C.barks && C.barks[kind]) || []);
  if (!list.length) return false;
  const text = list[Math.floor(aw.rng() * list.length)];
  s.barkAt = game.time;
  if (aw.stats) aw.stats.barks++;
  game.emit('bark', { from: f ? f.from : 'Plünderer', id: e.id, text, x: Math.round(e.x), y: Math.round(e.y), cause: kind });
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
  e.haltT = 0;   // B2 E13: Treffer unterbricht Aufrichten/Fesseln
  if (!s.alert && !e.asleep) {
    if (s.schleich) alarmiere(game, game.away, s, src && Number.isFinite(src.x) ? src.x : e.x, src && Number.isFinite(src.y) ? src.y : e.y, 'treffer');
    else { s.alert = true; s.contactAt = game.time; s.lostBarked = false; }
    bark(game, s, e, 'contact');
  }
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
  const Wf = waffenMod();
  for (const e of aw.drones) {
    if (!e.alive || e.asleep || e.frozen) continue;   // frozen: nur Tests
    if (Wf && Wf.betaeubt(game, e)) { e.aim = null; continue; }   // B2: betäubt -> keine Bewegung, kein Schuss
    act(game, E, e, dt);
  }
}

function perceive(game, E) {
  const aw = game.away; const C = cfg(game);
  for (const s of Object.values(aw.squads || {})) if (s) s.seesNow = false;
  for (const e of aw.drones) {
    e.sees = [];
    if (!e.alive || e.asleep) continue;
    const R = waffenMod() && amAussicht(game, E, e) ? (Number(cfg(game).sicht && cfg(game).sicht.aussicht) || 22) * TILE : E.R;   // E16
    for (const p of E.team) {
      if (dist(e.x, e.y, p.x, p.y) > R) continue;
      if (!los(E, e, p)) continue;   // §15: geduckt hinter low-Deckung unsichtbar
      e.sees.push(p);
    }
    if (!e.sees.length) continue;
    const s = squadOf(game, e);
    for (const p of e.sees) s.lastKnown[p.id] = { x: p.x, y: p.y, t: game.time };
    if (waffenMod()) {   // E16 Trupp-Funk: was ein Mitglied sieht, gilt geteiltTtl s für den ganzen Trupp
      if (!s.geteilt) s.geteilt = {};
      const ttl = Number(cfg(game).sicht && cfg(game).sicht.geteiltTtl) || 6;
      for (const p of e.sees) s.geteilt[p.id] = game.time + ttl;
    }
    s.seesNow = true;
    if (!s.alert || s.lostBarked) {
      if (!s.alert && s.schleich) alarmiere(game, aw, s, e.sees[0].x, e.sees[0].y, 'sicht');
      s.alert = true; s.lostBarked = false;
      bark(game, s, e, 'contact');
    }
    s.contactAt = game.time;
  }
  if (waffenMod()) perceiveB2(game, E);
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
  const prof = waffenMod() ? (e.rolle || 'grundtyp') : null;
  if (prof && decideB2(game, E, e, s, prof)) return;
  if (!s.alert) { setRole(game, e, 'idle'); if (s.schleich) planRuhig(game, E, e, s); return; }
  const vis = sichtbareZiele(game, E, e, s);
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
    const flankCd = prof && game.away.drones.some((d) => d.alive && d.squad === e.squad && d.rolle === 'niederhalter' && d.role === 'pin') ? 5 : 10;
    if (e.role !== 'flank' && !flankerBusy && alive >= 2 && game.time - s.flankAt > flankCd && !(prof && KEINE_FLANKE[prof]) &&
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
// ---------- E16: Zielen über 10 Kacheln nur vom aussicht-Anker oder mit geteilter Sicht (waffen.sichtPruefen) ----------
function amAussicht(game, E, e) {
  const k = E.info && E.info.karte;
  if (!k) return false;
  const t = tileOf(e.x, e.y);
  return k.anker.some((a) => a.rolle === 'aussicht' && Math.abs(a.x - t.x) <= 1 && Math.abs(a.y - t.y) <= 1);
}
function geteiltSicht(game, s, p) { return !!(s && s.geteilt && s.geteilt[p.id] > game.time); }
// Eigene Sicht + Ziele, die der Trupp gemeldet hat (Sichtlinie von hier, in Waffenreichweite)
function sichtbareZiele(game, E, e, s) {
  const Wf = waffenMod();
  if (!Wf || !s.geteilt) return e.sees;
  const d = Wf.def(game, e.waffe) || {};
  const reich = (Number(d.max != null ? d.max : d.reichweite) || 10) * TILE;
  const out = e.sees.slice();
  for (const p of E.team) {
    if (out.includes(p) || !geteiltSicht(game, s, p) || dist(p.x, p.y, e.x, e.y) > reich || !los(E, e, p)) continue;
    out.push(p);
  }
  return out;
}
// Darf e jetzt auf t zielen? Ohne Waffen: wie bisher (Sichtlinie + engageBox). Mit Waffen: Sichtlinie und
// waffen.sichtPruefen (≤ 10 Kacheln, darüber nur Aussicht bzw. geteilte Sicht); außerhalb der engageBox nur mit Hilfe.
function zielbar(game, E, e, t) {
  const C = cfg(game); const Wf = waffenMod();
  if (!los(E, e, t)) return false;
  if (!Wf) return inBox(C, e.x, e.y, t.x, t.y);
  const aussicht = amAussicht(game, E, e); const geteilt = geteiltSicht(game, squadOf(game, e), t) && dist(e.x, e.y, t.x, t.y) > (E.R || C.sightTiles * TILE);
  if (Wf.sichtPruefen(game, e, t, { sichtlinie: true, aussicht, geteilt })) return false;
  return inBox(C, e.x, e.y, t.x, t.y) || aussicht || geteilt;
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
  for (const sp of E.coverSpots || []) {
    if (cheb(sp, here) > 7 || E.solid(sp.x, sp.y)) continue;
    const c = W.tileCenter(sp.x, sp.y);
    const d = dist(c.x, c.y, t.x, t.y);
    if (d < 3 * TILE || !inBox(C, c.x, c.y, t.x, t.y)) continue;
    if (reserved(game, e, sp)) continue;
    if (!los(E, c, t)) continue;
    const cov = Los.coverAgainst(E.map, E.solid, t.x, t.y, c.x, c.y);
    const score = cov * 4 - manh(sp, here) * 0.5 - Math.abs(d / TILE - (IDEAL[e.rolle] || 6)) * 0.3 - (manh(sp, tt) < 3 ? 2 : 0);
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
  for (const sp of E.coverSpots || []) {
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
    const path = bfs(E.walk, here, (x, y) => x === c.sp.x && y === c.sp.y, E.map.w, E.map.h, undefined, E.links || undefined);
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
  for (const sp of E.coverSpots || []) {
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
  for (const sp of E.coverSpots || []) {
    if (cheb(sp, lt) > 4 || E.solid(sp.x, sp.y) || reserved(game, e, sp)) continue;
    const score = -manh(sp, lt) - manh(sp, here) * 0.2;
    if (score > bs) { bs = score; best = sp; }
  }
  if (best && setGoal(game, E, e, best)) return;
  if (!E.solid(lt.x, lt.y)) setGoal(game, E, e, lt);
}

// Zielkachel verteilen: ist die Kachel belegt oder schon Ziel eines anderen Gegners, die nächste freie begehbare Kachel
// im Umkreis 3 (Deckungsplätze bevorzugt). So stehen nie zwei Gegner auf einer Kachel (Sammeln/Suchen am letzten Punkt).
// Steht ein anderer (stehender oder früher eingetragener) Gegner auf meiner Kachel?
function teiltKachel(game, e) {
  const h = tileOf(e.x, e.y);
  const list = game.away.drones;
  const i = list.indexOf(e);
  return list.some((d, j) => d !== e && d.alive && (j < i || !d.path || !d.path.length) && (() => { const t = tileOf(d.x, d.y); return t.x === h.x && t.y === h.y; })());
}
// Stehend auf einer geteilten Kachel: zur nächsten freien Kachel ausweichen (der früher eingetragene bleibt)
function entstapeln(game, E, e) {
  if ((e.path && e.path.length) || e.aim || e.ausholen || e.ladung || !teiltKachel(game, e)) return false;
  const here = tileOf(e.x, e.y);
  const f = freieKachel(game, E, e, here);
  if (f.x === here.x && f.y === here.y) return false;
  const g0 = e.goal ? { x: e.goal.x, y: e.goal.y } : null;
  if (!setGoal(game, E, e, f)) return false;
  if (g0 && e.role !== 'idle') e.goalAt = -99;   // danach neu planen
  return true;
}
function freieKachel(game, E, e, tile) {
  if (!E.solid(tile.x, tile.y) && !reserved(game, e, tile)) return tile;
  const cover = new Set((E.coverSpots || []).map((c) => c.x + ',' + c.y));
  let best = null, bs = Infinity;
  for (let r = 1; r <= 3 && !best; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const t = { x: tile.x + dx, y: tile.y + dy };
      if (t.x < 0 || t.y < 0 || t.x >= E.map.w || t.y >= E.map.h || E.solid(t.x, t.y) || reserved(game, e, t)) continue;
      const sc = Math.hypot(dx, dy) - (cover.has(t.x + ',' + t.y) ? 0.75 : 0);
      if (sc < bs) { bs = sc; best = t; }
    }
  }
  return best || tile;
}
function setGoal(game, E, e, tile, stopNear, stopTarget) {
  tile = freieKachel(game, E, e, tile);
  const here = tileOf(e.x, e.y);
  const path = bfs(E.walk, here, (x, y) => x === tile.x && y === tile.y, E.map.w, E.map.h, undefined, E.links || undefined);   // B1 §6.2: Deck-Links
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
  const g = gegnerCfg(game, e);
  updateEnemyCrouch(game, E, e);
  const Wf = waffenMod();
  if ((!e.path || !e.path.length) && entstapeln(game, E, e)) { moveAlong(game, E, e, dt); return; }
  if (Wf && actB2(game, E, e, dt, Wf, g)) return;
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
    const ok = t && t.zone === 'away' && !t.downed && zielbar(game, E, e, t);
    if (!ok) { e.aim = null; e.fireT = Math.max(e.fireT, 0.5); }
    else if (game.time - e.aim.t0 >= e.aim.dur) {
      const aimOk = e.kind !== 'warden' || Math.abs(Physics.normAngle(Math.atan2(t.y - e.y, t.x - e.x) - e.facing)) < 0.6;
      if (aimOk) feuerB2(game, E, e, t, g);
      e.aim = null; e.fireT = g ? (Number(g.rhythmus || g.stossPause) || ec.fireInterval) : ec.fireInterval;
    }
    trackStuck(game, e, dt, false);
    return;
  }
  e.fireT -= dt;
  if (e.fireT <= 0 && e.shootTarget && e.role !== 'retreat' && !(e.role === 'flank' && e.path && e.path.length)) {
    const t = game.playerById(e.shootTarget);
    // Kein Treffer aus dem Off: nur mit Sichtlinie UND Ziel im engageBox (CONTRACT-M2 §4.3)
    if (t && t.zone === 'away' && !t.downed && zielbar(game, E, e, t) &&
        (e.kind !== 'warden' || Math.abs(Physics.normAngle(Math.atan2(t.y - e.y, t.x - e.x) - e.facing)) < 0.6)) {
      if (Wf && g && e.rolle === 'haescher' && e.hitze > 0.6) { e.fireT = 0.5; return moveAlong(game, E, e, dt); }   // Häscher achtet auf Hitze
      e.aim = { target: t.id, t0: game.time, dur: g && g.aim ? g.aim : ec.aim };
      if (Wf && e.rolle === 'grenadier') e.granatZiel = { x: t.x, y: t.y, t: game.time };
      game.emit('enemyAim', { id: e.id, target: t.id, x: Math.round(e.x), y: Math.round(e.y) });
      game.emit('sfx', { name: e.kind === 'warden' ? 'warden_aim' : 'enemy_aim', zone: 'away', x: Math.round(e.x), y: Math.round(e.y) });
      trackStuck(game, e, dt, false);
      return;
    }
    e.fireT = 0.2;
  }
  if (e.role === 'idle' && !isAlert(game, e)) { if (squadOf(game, e).schleich) { if (e.path && e.path.length) moveAlong(game, E, e, dt); else trackStuck(game, e, dt, false); return; } wander(game, E, e, dt); return; }
  if (e.role === 'idle' && (!e.path || !e.path.length)) { wander(game, E, e, dt); return; }
  moveAlong(game, E, e, dt);
}

function moveAlong(game, E, e, dt) {
  const C = cfg(game); const ec = C.enemy[e.kind] || C.enemy.scavenger;
  if (!e.path || !e.path.length) { trackStuck(game, e, dt, false); return; }
  if (e.stopNear && e.stopTarget) {
    const t = game.playerById(e.stopTarget);
    if (t && dist(t.x, t.y, e.x, e.y) <= e.stopNear && los(E, e, t) && !teiltKachel(game, e)) { e.path = null; trackStuck(game, e, dt, false); return; }
  }
  let budget = speedOf(game, e) * dt;
  let guard = 0;
  while (budget > 0.01 && e.path.length && guard++ < 4) {
    const n = e.path[0]; const c = W.tileCenter(n.x, n.y);
    if (n.via) {   // B1 §6.2: Deck-Übergang (Lift/Leiter) – Gegner wechselt das Deck, der Rest des Ticks verfällt
      e.x = c.x; e.y = c.y; e.path.shift(); e.stuckRef = { x: e.x, y: e.y }; budget = 0;
      game.emit('enemyDeck', { id: e.id, via: n.via, x: Math.round(e.x), y: Math.round(e.y) });
      break;
    }
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
  if (!e.path.length) entstapeln(game, E, e);   // Laufen-Ende: nie zwei auf einer Kachel
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

// =====================================================================================================================
// B2 Welle 2 (BODENKAMPF): KI-Profile je Rolle, Aufrichten/Fesseln, Schleich-Grundstufe. Utility-KI bleibt; Profile
// ändern Gewichte und hängen Zusatzaktionen an (CONTRACT-B2 §5, §6). Aktiv nur mit waffen.js (combat.waffenAktiv).
// =====================================================================================================================
function waffenMod() { const c = combat(); return c.waffenAktiv && c.waffenAktiv() ? require('./waffen.js') : null; }
function gegnerCfg(game, e) {
  if (!waffenMod()) return null;
  const G = cfg(game).gegner || {};
  return G[e.rolle || combat().rolleVon(e)] || null;
}
function speedOf(game, e) {
  const C = cfg(game); const ec = C.enemy[e.kind] || C.enemy.scavenger;
  const g = gegnerCfg(game, e);
  const v = g && g.speed ? g.speed : ec.speed;
  return e.patrouilliert ? v * 0.6 : v;   // B2 §6: Patrouille mit Tempo × 0,6
}
const KEINE_FLANKE = { niederhalter: 1, grenadier: 1, schuetze: 1, haescher: 1, enterer: 1 };
const IDEAL = { grenadier: 8, schuetze: 9, niederhalter: 7, haescher: 6 };   // Wunschabstand in Kacheln (planPin)

// ---------- Schleichen: Alarm je Trupp (B2 §6) ----------
// Trupp wird wach; Ereignis truppAlarm; nach funkVerzoegerung s alle Trupps im Umkreis alarm.funk; Landepunkt-Alarm.
function alarmiere(game, aw, s, x, y, grund) {
  if (!s) return false;
  const neu = !s.alert;
  s.alert = true; s.contactAt = game.time; s.lostBarked = false;
  let best = null, bd = Infinity;
  for (const p of game.players) if (p.zone === 'away' && p.connected) { const d = dist(p.x, p.y, x, y); if (d < bd) { bd = d; best = p; } }
  if (best && !s.lastKnown[best.id]) s.lastKnown[best.id] = { x, y, t: game.time };
  for (const e of aw.drones) if (e.squad === s.name) e.patrouilliert = false;
  if (!neu) return false;
  game.emit('truppAlarm', { map: aw.map, trupp: s.name, x: Math.round(x), y: Math.round(y), grund: grund || null });
  const A = cfg(game).alarm || {};
  if (!aw.funk) aw.funk = [];
  aw.funk.push({ at: game.time + (Number(A.funkVerzoegerung) || 0), x, y, von: s.name });
  if (!aw.alarm) {
    aw.alarm = true;
    try { const an = require('./anker.js'); if (typeof an.alarm === 'function') an.alarm(game, aw.map, true); } catch (err) { /* Handkarte bzw. ohne anker.js */ }
  }
  game.missionEvent('truppAlarm', { map: aw.map, trupp: s.name, tag: s.tag || null, grund: grund || null });
  return true;
}
function perceiveB2(game, E) {
  const aw = game.away; const C = cfg(game); const A = C.alarm || {};
  const Wf = waffenMod();
  const squads = Object.values(aw.squads || {}).filter((s) => s && s.name !== 'warden');
  const mitglieder = (s) => aw.drones.filter((e) => e.alive && !e.asleep && e.squad === s.name);
  // Lärm (waffen.laerm -> aw.laerm): Trupps mit einem Mitglied im Radius werden wach
  const neu = (aw.laerm || []).filter((ev) => ev.t > (aw.laermGelesen == null ? -1e9 : aw.laermGelesen));
  if (neu.length) {
    aw.laermGelesen = Math.max(...neu.map((ev) => ev.t));
    for (const ev of neu) for (const s of squads) {
      if (s.alert) continue;
      const m = mitglieder(s).find((e) => Wf.hoert(ev, e.x, e.y));
      if (m && alarmiere(game, aw, s, ev.x, ev.y, 'laerm')) bark(game, s, m, 'alarm_laerm');
    }
  }
  // Liegender Kamerad in Sicht
  for (const s of squads) {
    if (s.alert) continue;
    for (const e of mitglieder(s)) {
      const d = aw.drones.find((q) => !q.alive && q.liegt && dist(q.x, q.y, e.x, e.y) <= E.R && Los.lineOfSight(E.blocked, e.x, e.y, q.x, q.y));
      if (d) { alarmiere(game, aw, s, d.x, d.y, 'liegender'); break; }
    }
  }
  // Funk nach Verzögerung
  if (aw.funk && aw.funk.length) {
    const due = aw.funk.filter((f) => game.time >= f.at);
    aw.funk = aw.funk.filter((f) => game.time < f.at);
    for (const f of due) for (const s of squads) {
      if (s.alert) continue;
      if (mitglieder(s).some((e) => dist(e.x, e.y, f.x, f.y) <= (Number(A.funk) || 20) * TILE)) alarmiere(game, aw, s, f.x, f.y, 'funk');
    }
  }
  // Ruhe nach ruheNach s ohne Kontakt (nur Schleich-Trupps; der Landepunkt bleibt im Alarm)
  for (const s of squads) {
    if (!s.schleich || !s.alert || s.seesNow) continue;
    if (game.time - s.contactAt > (Number(A.ruheNach) || 60)) {
      s.alert = false; s.lastKnown = {}; s.lostBarked = true;
      for (const e of mitglieder(s)) { e.role = 'idle'; e.goal = null; e.path = null; e.aim = null; e.shootTarget = null; }
    }
  }
}
// Ruhig: Posten bleiben am Platz, Patrouillen laufen ihren Weg (karte.patrouillen) im Kreis
function planRuhig(game, E, e, s) {
  if (s.weg && s.weg.length) {
    e.patrouilliert = true;
    if (e.path && e.path.length) return;
    if (e.wegI == null) e.wegI = (game.away.drones.filter((d) => d.squad === s.name).indexOf(e) + 0) % s.weg.length;
    else e.wegI = (e.wegI + 1) % s.weg.length;
    setGoal(game, E, e, s.weg[e.wegI]);
    return;
  }
  e.patrouilliert = false;
  const h = tileOf(e.home.x, e.home.y);
  const here = tileOf(e.x, e.y);
  if ((h.x !== here.x || h.y !== here.y) && (!e.path || !e.path.length)) setGoal(game, E, e, h);
}

// ---------- Profile (decide) ----------
// true = entschieden (Rest von decide entfällt)
function decideB2(game, E, e, s, prof) {
  const aw = game.away; const K = cfg(game).koerper || {};
  // Aufrichten: liegender Kamerad (verwundet, noch nicht ausgeblutet), selbst nicht unter Feuer, kein Spieler sehr nah
  if (prof !== 'enterer' && prof !== 'waechter') {
    if (e.role === 'aufrichten') {
      const d = aw.drones.find((q) => q.id === e.hilft);
      if (d && !d.alive && d.zustand === 'verwundet') return true;
      setRole(game, e, 'pin'); e.hilft = null;
    }
    const unterFeuer = game.time - (e.lastHitAt || -99) < 3;
    const nah = e.sees.some((p) => !p.downed && dist(p.x, p.y, e.x, e.y) < 5 * TILE);
    if (!unterFeuer && !nah) {
      const d = aw.drones.filter((q) => !q.alive && q.liegt && q.zustand === 'verwundet' && (!q.helfer || q.helfer === e.id || !aw.drones.some((h) => h.id === q.helfer && h.alive && h.role === 'aufrichten')) &&
        dist(q.x, q.y, e.x, e.y) <= 10 * TILE).sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
      if (d && setGoal(game, E, e, tileOf(d.x, d.y))) {
        setRole(game, e, 'aufrichten'); e.hilft = d.id; d.helfer = e.id; e.haltT = 0; e.shootTarget = null;
        bark(game, s, e, 'kamerad_liegt');
        return true;
      }
    }
  }
  // Häscher: bewusstlose Spieler fesseln
  if (prof === 'haescher') {
    if (e.role === 'fesseln') {
      const p = game.playerById(e.fesselt);
      if (p && p.zone === 'away' && p.zustand === 'bewusstlos') return true;
      setRole(game, e, 'pin'); e.fesselt = null;
    }
    const p = game.players.filter((q) => q.zone === 'away' && q.zustand === 'bewusstlos' && dist(q.x, q.y, e.x, e.y) <= 12 * TILE)
      .sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
    if (p && setGoal(game, E, e, tileOf(p.x, p.y))) { setRole(game, e, 'fesseln'); e.fesselt = p.id; e.haltT = 0; e.shootTarget = null; return true; }
  }
  if (!s.alert) return false;
  const targets = sichtbareZiele(game, E, e, s).filter((p) => !p.downed);
  // Enterer: direkt und ohne Deckung auf den nächsten Spieler
  if (prof === 'enterer') {
    let t = targets.slice().sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
    if (!t) { const lk = freshestKnown(s); if (lk) t = { id: lk.pid, x: lk.x, y: lk.y }; }
    if (!t) return false;
    setRole(game, e, 'push');
    e.target = t.id; e.shootTarget = targets.includes(t) ? t.id : null;
    if (!e.goal || game.time - e.goalAt > 1) setGoal(game, E, e, tileOf(t.x, t.y), 0.9 * TILE, targets.includes(t) ? t : null);
    return true;
  }
  // Niederhalter: ohne Sicht auf die letzte bekannte Position halten (Unterdrückung)
  if (prof === 'niederhalter' && !targets.length) {
    const lk = freshestKnown(s);
    if (lk && game.time - lk.t < 4) { setRole(game, e, 'pin'); e.unterdrueck = { x: lk.x, y: lk.y }; e.shootTarget = null; return true; }
    e.unterdrueck = null;
  }
  // Schütze: Abstand halten, Aussicht bevorzugen
  if (prof === 'schuetze' && targets.length) {
    const g = cfg(game).gegner.schuetze || {};
    const t = targets.slice().sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
    if (dist(t.x, t.y, e.x, e.y) < (g.abstand || 5) * TILE) {
      const here = tileOf(e.x, e.y);
      let best = null, bs = -Infinity;
      for (const sp of E.coverSpots || []) {
        if (cheb(sp, here) > 8 || E.solid(sp.x, sp.y) || reserved(game, e, sp)) continue;
        const c = W.tileCenter(sp.x, sp.y); const d = dist(c.x, c.y, t.x, t.y);
        if (d < ((g.abstand || 5) + 2) * TILE || !los(E, c, t)) continue;
        const sc = d / TILE - manh(sp, here) * 0.3;
        if (sc > bs) { bs = sc; best = sp; }
      }
      if (best && setGoal(game, E, e, best)) { setRole(game, e, 'pin'); e.target = t.id; e.shootTarget = t.id; return true; }
    }
    const aus = ((E.info && E.info.karte && E.info.karte.anker) || []).filter((a) => a.rolle === 'aussicht' && dist(W.tileCenter(a.x, a.y).x, W.tileCenter(a.x, a.y).y, e.x, e.y) <= 15 * TILE && !reserved(game, e, a));
    if (aus.length && !aus.some((a) => { const h = tileOf(e.x, e.y); return a.x === h.x && a.y === h.y; }) && (!e.goal || game.time - e.goalAt > 4)) {
      if (setGoal(game, E, e, aus[0])) { setRole(game, e, 'pin'); e.shootTarget = t.id; e.target = t.id; return true; }
    }
  }
  // Häscher folgt dem Niederhalter, solange er niemanden sieht
  if (prof === 'haescher' && !targets.length) {
    const n = game.away.drones.find((d) => d.alive && d.squad === e.squad && d.rolle === 'niederhalter');
    if (n && dist(n.x, n.y, e.x, e.y) > 3 * TILE && (!e.goal || game.time - e.goalAt > 2)) { setRole(game, e, 'advance'); setGoal(game, E, e, tileOf(n.x, n.y), 2 * TILE); return true; }
  }
  return false;
}

// ---------- Profile (act, jeden Tick) ----------
// true = Tick erledigt
function actB2(game, E, e, dt, Wf, g) {
  const K = cfg(game).koerper || {};
  if (e.ladung) {   // Schütze lädt die Lanze: stehen, Ziel nachführen, bei Stufe 2 (bzw. Ziel weg) lösen
    const t = game.playerById(e.shootTarget || e.target);
    const sicht = t && t.zone === 'away' && !t.downed && los(E, e, t);
    if (sicht) Wf.feuern(game, e, { x: t.x, y: t.y });
    const d = Wf.def(game, e.waffe);
    const max = d && Array.isArray(d.laden) ? d.laden.length : 1;
    if (e.ladung && (e.ladung.stufe >= max || (!sicht && e.ladung.stufe >= 1))) Wf.loslassen(game, e);
    else if (e.ladung && !sicht && !e.ladung.stufe && e.ladung.t > 1.5) Wf.unterbrechen(game, e, 'ziel');
    trackStuck(game, e, dt, false);
    return true;
  }
  if (e.ausholen) { trackStuck(game, e, dt, false); return true; }   // Ausholen: stehen bleiben, Schlag folgt in waffen.update
  if (e.stoss > 0) {   // Niederhalter: langer Stoß auf eine Deckung bzw. die letzte bekannte Position
    const t = game.playerById(e.shootTarget);
    const ziel = t && t.zone === 'away' && !t.downed && los(E, e, t) ? t : e.unterdrueck;
    if (!ziel || e.hitze > 0.85 || Wf.ueberhitzt(game, e)) { if (e.hitze > 0.85) bark(game, squadOf(game, e), e, 'ueberhitzt'); e.stoss = 0; e.fireT = (g && g.stossPause) || 2; }
    else if (!Wf.kannFeuern(game, e)) { combat().fireEnemy(game, e, ziel); e.stoss--; if (e.stoss <= 0) e.fireT = (g && g.stossPause) || 2; }
    trackStuck(game, e, dt, false);
    return true;
  }
  if (e.role === 'aufrichten' || e.role === 'fesseln') {
    const ziel = e.role === 'aufrichten' ? game.away.drones.find((q) => q.id === e.hilft) : game.playerById(e.fesselt);
    if (!ziel) { setRole(game, e, 'pin'); return false; }
    if (dist(ziel.x, ziel.y, e.x, e.y) <= 1.4 * TILE) {
      e.path = null; e.haltT = (e.haltT || 0) + dt;
      const dauer = Number(e.role === 'aufrichten' ? K.aufrichten : K.fesseln) || 3;
      if (e.haltT >= dauer) {
        e.haltT = 0;
        if (e.role === 'aufrichten') { if (!Wf.aufrichten(game, ziel, e)) { ziel.helfer = null; combat().folgenAbgleich(game); } }
        else if (!Wf.fesseln(game, ziel, e)) { bark(game, squadOf(game, e), e, 'spieler_gefesselt'); combat().folgenAbgleich(game); game.missionEvent('spielerGefesselt', { pid: ziel.id }); }
        setRole(game, e, 'pin'); e.hilft = null; e.fesselt = null;
      }
      trackStuck(game, e, dt, false);
      return true;
    }
    e.haltT = 0;
    moveAlong(game, E, e, dt);
    return true;
  }
  if (e.rolle === 'enterer') {   // kein Zielen: Ausholen ist die Ankündigung
    const t = game.playerById(e.target);
    const d = Wf.def(game, e.waffe);
    if (t && t.zone === 'away' && !t.downed && d && dist(t.x, t.y, e.x, e.y) <= ((Number(d.reichweite) || 1.3) * TILE + 8) && !Wf.kannFeuern(game, e)) {
      Wf.feuern(game, e, { x: t.x, y: t.y });
      e.facing = Math.atan2(t.y - e.y, t.x - e.x);
      trackStuck(game, e, dt, false);
      return true;
    }
    moveAlong(game, E, e, dt);
    return true;
  }
  // Niederhalter ohne Sicht: Stoß auf die letzte bekannte Position (ohne Ankündigung durch Zielen – Lärm/Leuchtspur reicht)
  if (e.rolle === 'niederhalter' && e.unterdrueck && !e.shootTarget) {
    e.fireT -= dt;
    if (e.fireT <= 0) e.stoss = (g && g.stoss) || 8;
    trackStuck(game, e, dt, false);
    return true;
  }
  return false;
}
// Feuern nach der Ankündigung je Rolle
function feuerB2(game, E, e, t, g) {
  const Wf = waffenMod();
  if (!Wf) { combat().fireEnemy(game, e, t); return; }
  if (e.rolle === 'niederhalter') { e.stoss = (g && g.stoss) || 8; return; }
  if (e.rolle === 'grenadier') {
    const r = (Number((Wf.def(game, e.waffe) || {}).radius) || 1.5) * TILE + TILE / 2;
    const eigene = game.away.drones.some((d) => d !== e && d.alive && dist(d.x, d.y, t.x, t.y) <= r);
    if (eigene && game.away.rng() >= ((g && g.fehlwurf) || 0)) return;   // meidet eigene Leute (absichtlich nicht perfekt)
    e.granatZiel = { x: t.x, y: t.y, t: game.time };
  }
  combat().fireEnemy(game, e, t);
  if (Wf.ueberhitzt(game, e)) bark(game, squadOf(game, e), e, 'ueberhitzt');
}

module.exports = {
  makeEnemy, spawnSquad, wakeWarden, update, onEnemyHit, onEnemyDown, onShieldFull, onPlayerWounded, isAlert, bark, squadOf,
  inBox, perceive, newSquad, alertSquad, spawnPlaetze, TYP_KIND, alarmiere, zielbar, amAussicht, sichtbareZiele,
};
