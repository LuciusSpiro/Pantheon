'use strict';
// M3b Schritt A (CONTRACT-M3B §2, §3, §6, §8): Flugmodell und Gegner-Piloten.
//  - Teil 1: reine Funktionen aus shared/flight.js (Stufen, Beschleunigen/Bremsen, Wendekreis, Mindesttempo, Düsen-Kappung)
//  - Teil 2: Lerche im Spiel (helm.throttle, Altname thrust, Allstopp, unbesetzte Steuer, Snapshot)
//  - Teil 3: Gegner im Testgelände (flightV2.arena): Überflüge der Jäger, Mindestabstand, Randstreifen,
//    Breitseite des Kanonenboots gegen eine geradeaus fahrende Lerche, Snapshot vx/vy/state
// Gemessene Werte stehen als „info“-Zeilen in der Ausgabe (für den Bericht).
//   node tools/test-flight.js            -> alle Abschnitte
//   node tools/test-flight.js jäger rand -> nur Abschnitte, deren Name einen der Begriffe enthält
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const W = require('../server/world.js');
const space = require('../server/sim/space.js');
let Flight = null;
try { Flight = require('../shared/flight.js'); } catch (e) { Flight = null; }

const FILTER = process.argv.slice(2).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
const CLS = CONFIG.shipClasses;
const MODS = { speedFactor: 1, turnCapPort: 1, turnCapStbd: 1 };
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
const f1 = (v) => (v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toString());
const f2 = (v) => (v == null || !isFinite(v) ? '—' : (Math.round(v * 100) / 100).toString());
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
}

// ======================================================================
// Teil 1: reine Funktionen
// ======================================================================
const fwd = (b) => b.vx * Math.cos(b.angle) + b.vy * Math.sin(b.angle);
function makeBody(cls, stage, speed, angle) {
  const a = angle || 0;
  return { x: 0, y: 0, angle: a, vx: (speed || 0) * Math.cos(a), vy: (speed || 0) * Math.sin(a), turnVel: 0, stage };
}
function stepN(b, input, cls, sec, each, mods) {
  const steps = Math.round(sec / DT);
  for (let k = 0; k < steps; k++) {
    const r = Flight.stepBody(b, input, cls, mods || MODS, DT);
    if (r && r !== b) Object.assign(b, r);
    if (each && each(b, (k + 1) * DT) === true) return (k + 1) * DT;
  }
  return null;
}
// Fährt bei einer Stufe geradeaus ein (15 s), dann volles Ruder: Zeit für 90° und Wendekreis (Bahnlänge / Winkel im eingeschwungenen Zustand)
function turnTest(cls, stage, rudder) {
  const b = makeBody(cls, stage, Flight.stageSpeed(cls, stage), 0);
  stepN(b, { stage, rudder: 0 }, cls, 15);
  const a0 = b.angle; let turned = 0, prevA = b.angle;
  const t90 = stepN(b, { stage, rudder }, cls, 30, (bb) => { turned += Math.abs(Physics.normAngle(bb.angle - prevA)); prevA = bb.angle; return turned >= Math.PI / 2; });
  // eingeschwungen: weitere 6 s drehen, dann 3 s messen
  stepN(b, { stage, rudder }, cls, 6);
  let path = 0, ang = 0, px = b.x, py = b.y; prevA = b.angle;
  stepN(b, { stage, rudder }, cls, 3, (bb) => { path += dist(px, py, bb.x, bb.y); px = bb.x; py = bb.y; ang += Math.abs(Physics.normAngle(bb.angle - prevA)); prevA = bb.angle; });
  return { t90, radius: ang > 0 ? path / ang : Infinity, speed: Math.hypot(b.vx, b.vy), turnVel: b.turnVel, a0 };
}

section('Flugmodell: Modul und Stufen (§2)', () => {
  ok(!!Flight && ['stepBody', 'turnFactor', 'stageSpeed'].every((k) => typeof Flight[k] === 'function'), 'shared/flight.js: stepBody, turnFactor, stageSpeed');
  if (!Flight) throw new Error('shared/flight.js fehlt');
  for (const k of Object.keys(CLS)) {
    const c = CLS[k];
    const sp = c.stages.map((_, i) => Flight.stageSpeed(c, i));
    ok(sp.every((v, i) => near(v, c.stages[i] * c.maxSpeed, 0.01)), `${k}: stageSpeed = stages × maxSpeed (${sp.map(f1).join(' / ')} px/s)`);
  }
  const L = CLS.lerche;
  ok(L.stages.length === 6 && L.stages[0] < 0 && L.stages[1] === 0 && L.stages[5] === 1 && (L.stageNames || []).join() === 'R,STOPP,¼,½,¾,VOLL', 'Lerche: 6 Stufen R, STOPP, ¼, ½, ¾, VOLL');
  // Drehfaktor: bei ½ am wendigsten
  const tf = (s) => Flight.turnFactor(L, s * L.maxSpeed);
  const samples = [-0.23, 0, 0.1, 0.27, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
  ok(near(tf(0.5), 1, 1e-9) && samples.every((s) => tf(s) <= tf(0.5) + 1e-9), `turnFactor: Maximum 1 bei ½ (Stopp ${f2(tf(0))}, ¼ ${f2(tf(0.27))}, ¾ ${f2(tf(0.75))}, Voll ${f2(tf(1))})`);
  // Jede Stufe wird eingeregelt
  const reached = L.stages.map((s, i) => { const b = makeBody(L, i, 0, 0); stepN(b, { stage: i, rudder: 0 }, L, 15); return fwd(b); });
  ok(reached.every((v, i) => near(v, Flight.stageSpeed(L, i), 0.5)), `Lerche regelt jede Stufe ein (${reached.map(f1).join(' / ')} px/s)`);
  // Energie-/Triebwerksfaktor
  const bH = makeBody(L, 5, 0, 0); stepN(bH, { stage: 5, rudder: 0 }, L, 15, null, { speedFactor: 0.5 });
  ok(near(fwd(bH), 65, 0.5), `speedFactor 0,5: Voll -> ${f1(fwd(bH))} px/s`);
});

section('Flugmodell: Beschleunigen und Bremsen (§2, §6)', () => {
  const L = CLS.lerche; const full = Flight.stageSpeed(L, 5);
  const b = makeBody(L, 1, 0, 0);
  const tUp = stepN(b, { stage: 5, rudder: 0 }, L, 20, (bb) => fwd(bb) >= full - 1);
  ok(tUp != null && tUp >= 5 && tUp <= 7, `Stopp -> Voll in ${f2(tUp)} s (Soll 5–7 s, Prototyp ≈ 6 s)`);
  const tDown = stepN(b, { stage: 1, rudder: 0 }, L, 20, (bb) => Math.abs(fwd(bb)) < 1);
  ok(tDown != null && tDown >= 4 && tDown <= 5, `Voll -> Stopp in ${f2(tDown)} s (Soll 4–5 s, Prototyp ≈ 4,3 s)`);
  const b2 = makeBody(L, 5, full, 0);
  const tBrake = stepN(b2, { stage: 1, rudder: 0, brake: true }, L, 20, (bb) => Math.hypot(bb.vx, bb.vy) < 1);
  ok(tBrake != null && tBrake < tDown, `Allstopp (brake, × brakeFactor ${L.brakeFactor}): Voll -> 0 in ${f2(tBrake)} s (schneller als Stopp)`);
  const b3 = makeBody(L, 1, 0, 0);
  stepN(b3, { stage: 0, rudder: 0 }, L, 15);
  ok(near(fwd(b3), Flight.stageSpeed(L, 0), 0.5) && fwd(b3) < 0, `Rückwärts: ${f1(fwd(b3))} px/s`);
  // Querbewegung (Ausweichen) wird gedämpft, Allstopp bremst sie zusätzlich
  const lat = (bb) => -bb.vx * Math.sin(bb.angle) + bb.vy * Math.cos(bb.angle);
  const d1 = makeBody(L, 1, 0, 0); d1.vy = 350; stepN(d1, { stage: 1, rudder: 0 }, L, 1);
  const d2 = makeBody(L, 1, 0, 0); d2.vy = 350; stepN(d2, { stage: 1, rudder: 0, brake: true }, L, 1);
  ok(Math.abs(lat(d1)) < 350 * 0.2 && Math.abs(lat(d2)) < Math.abs(lat(d1)), `Querdrift 350 px/s nach 1 s: ${f1(lat(d1))} (frei), ${f1(lat(d2))} (Allstopp)`);
});

section('Flugmodell: Drehen und Wendekreis (§2, §6)', () => {
  const L = CLS.lerche;
  const half = turnTest(L, 3, 1), full = turnTest(L, 5, 1), quarter = turnTest(L, 2, 1), threeq = turnTest(L, 4, 1);
  const stop = (() => { const b = makeBody(L, 1, 0, 0); let turned = 0, pa = 0; const t = stepN(b, { stage: 1, rudder: 1 }, L, 40, (bb) => { turned += Math.abs(Physics.normAngle(bb.angle - pa)); pa = bb.angle; return turned >= Math.PI / 2; }); return t; })();
  info(`Lerche 90°: Stopp ${f2(stop)} s · ¼ ${f2(quarter.t90)} s · ½ ${f2(half.t90)} s · ¾ ${f2(threeq.t90)} s · Voll ${f2(full.t90)} s`);
  info(`Lerche Wendekreis (Radius): ¼ ${f1(quarter.radius)} · ½ ${f1(half.radius)} · ¾ ${f1(threeq.radius)} · Voll ${f1(full.radius)} px`);
  ok(half.t90 != null && near(half.t90, 2.6, 0.6), `90° bei ½ in ${f2(half.t90)} s (Prototyp 2,6 s ± 0,6)`);
  ok(full.t90 != null && near(full.t90, 4.4, 0.6), `90° bei Voll in ${f2(full.t90)} s (Prototyp 4,4 s ± 0,6)`);
  ok(near(half.radius, 108, 108 * 0.15), `Wendekreis bei ½: ${f1(half.radius)} px (Prototyp 108 ± 15 %)`);
  ok(near(full.radius, 361, 361 * 0.15), `Wendekreis bei Voll: ${f1(full.radius)} px (Prototyp 361 ± 15 %)`);
  ok(full.radius >= 3 * half.radius, `Wendekreis Voll ≥ 3 × Wendekreis ½ (${f2(full.radius / half.radius)} ×)`);
  ok([quarter, threeq, full].every((r) => r.t90 >= half.t90 - 1e-6), 'bei ½ am schnellsten durch 90°');
  // Düsen-Kappung je Seite (Backbord = Ruder negativ)
  const capP = (() => { const b = makeBody(L, 3, 65, 0); stepN(b, { stage: 3, rudder: -1 }, L, 8, null, { speedFactor: 1, turnCapPort: 0.5, turnCapStbd: 1 }); return b.turnVel; })();
  const capS = (() => { const b = makeBody(L, 3, 65, 0); stepN(b, { stage: 3, rudder: 1 }, L, 8, null, { speedFactor: 1, turnCapPort: 0.5, turnCapStbd: 1 }); return b.turnVel; })();
  ok(near(capP, -L.turnRate * 0.5, 0.01) && near(capS, L.turnRate, 0.01), `turnCapPort 0,5: Backbord ${f2(capP)} rad/s, Steuerbord ${f2(capS)} rad/s`);
  // Dreh-Strafe nach dem Ausweichen
  const bd = makeBody(L, 3, 65, 0); bd.dodgeT = 1; stepN(bd, { stage: 3, rudder: 1 }, L, 0.5);
  const bn = makeBody(L, 3, 65, 0); stepN(bn, { stage: 3, rudder: 1 }, L, 0.5);
  ok(bd.angle < bn.angle, `Ausweichen: 1 s Drehen × ${L.dodge.turnPenalty} (${f2(bd.angle)} statt ${f2(bn.angle)} rad nach 0,5 s)`);
  // Kanonenboot: gleiche Kurve, eigenes Tempo
  const G = CLS.gunboat; const gh = turnTest(G, 3, 1), gf = turnTest(G, 5, 1);
  info(`Kanonenboot Wendekreis: ½ ${f1(gh.radius)} px · Voll ${f1(gf.radius)} px; 90° bei ½ ${f2(gh.t90)} s`);
  ok(gf.radius >= 3 * gh.radius, `Kanonenboot: Wendekreis Voll ≥ 3 × ½ (${f2(gf.radius / gh.radius)} ×)`);
  const R = CLS.raider; const rf = turnTest(R, R.stages.length - 1, 1);
  info(`Jäger: Wendekreis bei Voll ${f1(rf.radius)} px, 90° in ${f2(rf.t90)} s`);
});

section('Flugmodell: Jäger nie unter minSpeed (§2, §6)', () => {
  const R = CLS.raider;
  let minV = Infinity;
  const b = makeBody(R, R.stages.length - 1, R.maxSpeed, 0);
  stepN(b, { stage: 0, rudder: 1, brake: true }, R, 20, (bb) => { minV = Math.min(minV, fwd(bb)); });
  stepN(b, { stage: 0, rudder: -1 }, R, 10, (bb) => { minV = Math.min(minV, fwd(bb)); });
  ok(minV >= R.minSpeed - 0.01, `Jäger mit Allstopp + Ruder: Vorwärtstempo nie unter ${R.minSpeed} (min ${f1(minV)})`);
  const b2 = makeBody(R, 0, R.maxSpeed, 0);
  stepN(b2, { stage: 0, rudder: 1 }, R, 6);
  const lat = -b2.vx * Math.sin(b2.angle) + b2.vy * Math.cos(b2.angle);
  info(`Jäger driftet: nach 6 s Kreisflug Quertempo ${f1(lat)} px/s (lateralDrag ${R.lateralDrag})`);
});

// ======================================================================
// Teil 2/3: im Spiel (Testgelände Raumkampf)
// ======================================================================
const STAND = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']];
function standSpots(tiles) {
  const list = Array.isArray(tiles) ? tiles : [tiles]; const out = [];
  for (const t of list) for (const [dx, dy, dir] of STAND) { const s = { x: t.x + dx, y: t.y + dy, dir }; if (!W.ship.solid(s.x, s.y) && !out.some((o) => o.x === s.x && o.y === s.y)) out.push(s); }
  return out;
}
const conSpot = (con) => standSpots(W.CONSOLE_TILES[con])[0];
function arena(players, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F' + i, name: 'F' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  const P = (i) => g.players[i];
  const send = (i, m) => g.handleMessage(conns[i], m);
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each) each(k * DT); g.step(); } };
  const place = (i, s) => { const p = P(i); const c = Physics.tileCenter(s.x, s.y); p.x = c.x; p.y = c.y; p.dir = s.dir || 'down'; p.input.mx = 0; p.input.my = 0; };
  const leave = (i) => { if (P(i).console) send(i, { t: 'leave' }); };
  const tap = (i) => { send(i, { t: 'act', down: true }); send(i, { t: 'act', down: false }); };
  const enter = (i, con) => { leave(i); place(i, conSpot(con)); tap(i); return P(i).console === con; };
  const cmd = (i, c, extra) => send(i, Object.assign({ t: 'cmd', c }, extra || {}));
  const notices = (i) => conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);
  return { g, conns, P, send, run, enter, leave, cmd, notices };
}
// Schiff unverwundbar halten und eigene Waffen leer (Messung der Flugbahnen, nicht des Kampfes)
function keepShip(g) {
  const sh = g.ship;
  sh.hull = sh.hullMax;
  for (const k of Object.keys(sh.systems)) { const d = Object.getOwnPropertyDescriptor(sh.systems, k); if (d && d.writable && sh.systems[k] !== 'ok') sh.systems[k] = 'ok'; }
  sh.offline = {};
  for (const f of ['fireList', 'breachList']) if (Array.isArray(sh[f])) sh[f].length = 0;
  if (sh.mount) for (const k of ['bow', 'port', 'stbd']) if (sh.mount[k]) { sh.mount[k].charge = 0; if ('charging' in sh.mount[k]) sh.mount[k].charging = false; }
  for (const e of g.space.enemies) e.hp = e.hpMax = 9999;
}
// Bezugssystem verschieben: Schiff (und alles um es herum) zurück zur Mitte, damit eine Lerche „ewig“ geradeaus fliegen kann
function recentre(g) {
  const sh = g.ship; const cx = g.space.w / 2, cy = g.space.h / 2;
  const dx = cx - sh.x, dy = cy - sh.y;
  if (Math.hypot(dx, dy) < 300) return;
  const mv = (o) => { if (o && typeof o.x === 'number') { o.x += dx; o.y += dy; } };
  mv(sh);
  for (const e of g.space.enemies) { mv(e); for (const k of ['home', 'pin', 'goal', 'wp', 'aim', 'station']) if (e[k] && typeof e[k] === 'object') mv(e[k]); if (e.pilot && typeof e.pilot === 'object') for (const k of Object.keys(e.pilot)) { const v = e.pilot[k]; if (v && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number') mv(v); } }
  for (const q of g.space.projectiles) mv(q);
  for (const b of g.space.beams || []) { mv(b); if (typeof b.x2 === 'number') { b.x2 += dx; b.y2 += dy; } }
}
// Zustand eines Gegners (Snapshot-Feld state): intern unter e.state oder e.pilot.state, sonst aus dem Snapshot
function stateReader(g) {
  let snap = null, snapT = -1;
  return (e) => {
    if (typeof e.state === 'string') return e.state;
    if (e.pilot && typeof e.pilot.state === 'string') return e.pilot.state;
    if (snapT !== g.time) { snap = g.snapshot(); snapT = g.time; }
    const s = snap.space.enemies.find((x) => x.id === e.id);
    return s ? s.state : null;
  };
}
const isState = (s, name) => typeof s === 'string' && (s === name || s.startsWith(name.slice(0, 3)));
const flightV2On = () => !!(CONFIG.spaceM3b && CONFIG.spaceM3b.flightV2 && CONFIG.spaceM3b.flightV2.arena);
function spawn(g, kind, angle, dist0) {
  const sh = g.ship; const d = dist0 || 700;
  const x = sh.x + Math.cos(angle) * d, y = sh.y + Math.sin(angle) * d;
  return space.spawnEnemy(g, kind, { tag: 'arena', x, y, facing: Math.atan2(sh.y - y, sh.x - x) });
}
const stopIdx = () => (Flight ? Flight.stopStage(CLS.lerche) : 1);

section('Lerche: Temporegler helm.throttle (§2)', () => {
  const { g, run, enter, cmd, leave } = arena(1);
  const sh = g.ship;
  const s0 = g.snapshot().ship.helm || {};
  ok(typeof s0.stage === 'number' && Array.isArray(s0.stages) && s0.stages.length === CLS.lerche.stages.length && 'autoStop' in s0, `Snapshot ship.helm: stage ${s0.stage}, stages [${(s0.stages || []).map(f1).join(', ')}], autoStop`);
  ok(sh.helm.stage === stopIdx(), `Start im Testgelände auf STOPP (Stufe ${sh.helm.stage})`);
  ok(enter(0, 'helm'), 'Steuer besetzt');
  cmd(0, 'helm.throttle', { delta: 1 }); const a = sh.helm.stage;
  cmd(0, 'helm.throttle', { delta: 1 }); const b = sh.helm.stage;
  cmd(0, 'helm.throttle', { delta: -1 }); const c = sh.helm.stage;
  ok(a === stopIdx() + 1 && b === stopIdx() + 2 && c === stopIdx() + 1, `delta ±1: ${stopIdx()} -> ${a} -> ${b} -> ${c}`);
  cmd(0, 'helm.throttle', { set: 5 }); const d = sh.helm.stage;
  cmd(0, 'helm.throttle', { delta: 1 }); const e = sh.helm.stage;
  cmd(0, 'helm.throttle', { set: 0 }); cmd(0, 'helm.throttle', { delta: -1 }); const f = sh.helm.stage;
  ok(d === 5 && e === 5 && f === 0, `set 5 = VOLL, nicht über VOLL (${e}), nicht unter R (${f})`);
  cmd(0, 'helm.throttle', { set: 5 });
  sh.angle = 0; sh.turnVel = 0;
  let t95 = null;
  run(9, (t) => { if (t95 == null && sh.speed >= space.maxSpeed(g) - 1) t95 = t; });
  // Energie Triebwerk 2 -> Faktor 0,8: VOLL = 104 px/s, Anfahrzeit = Tempo / accel
  const tExp = space.maxSpeed(g) / CLS.lerche.accel;
  ok(near(sh.speed, space.maxSpeed(g), 1) && t95 != null && near(t95, tExp, 0.4), `VOLL im Spiel: ${f1(sh.speed)} px/s (maxSpeed ${f1(space.maxSpeed(g))} mit Energiefaktor) nach ${f2(t95)} s (≈ ${f2(tExp)} s)`);
  ok(g.snapshot().ship.helm.stage === 5, 'Snapshot ship.helm.stage folgt (5)');
  // Altname: helm.input thrust > 0,5 wirkt einmalig als +1
  cmd(0, 'helm.throttle', { set: 2 });
  for (let k = 0; k < 10; k++) { cmd(0, 'helm.input', { turn: 0, thrust: 1 }); g.step(); }
  const up = sh.helm.stage;
  cmd(0, 'helm.input', { turn: 0, thrust: 0 }); g.step();
  cmd(0, 'helm.input', { turn: 0, thrust: -1 }); g.step(); cmd(0, 'helm.input', { turn: 0, thrust: -1 }); g.step();
  const down = sh.helm.stage;
  ok(up === 3 && down === 2, `Altname thrust: Dauerdruck > 0,5 nur +1 (2 -> ${up}), < −0,5 −1 (-> ${down})`);
  // Ruder dreht, Drehrate hängt vom Tempo ab
  cmd(0, 'helm.throttle', { set: 3 }); run(10, () => cmd(0, 'helm.input', { turn: 0, thrust: 0 }));
  run(5, () => cmd(0, 'helm.input', { turn: 1, thrust: 0 }));
  const tvHalf = sh.turnVel;
  ok(near(tvHalf, CLS.lerche.turnRate * Flight.turnFactor(CLS.lerche, sh.speed), 0.03), `Ruder 1 bei ½: turnVel ${f2(tvHalf)} rad/s (Soll ${f2(CLS.lerche.turnRate * Flight.turnFactor(CLS.lerche, sh.speed))})`);
  cmd(0, 'helm.input', { turn: 0, thrust: 0 });
  // Unbesetzte Steuer: Stufe bleibt, Ruder 0, keine Sonderbremse
  run(3);
  const stBefore = sh.helm.stage, vBefore = sh.speed;
  leave(0);
  run(6);
  ok(sh.helm.stage === stBefore && near(sh.speed, vBefore, 3) && near(sh.turnVel, 0, 1e-6), `unbesetzt: Stufe bleibt (${sh.helm.stage}), Tempo bleibt (${f1(vBefore)} -> ${f1(sh.speed)}), turnVel 0`);
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

section('Lerche: Allstopp und Ausweichen (§2)', () => {
  const { g, run, enter, cmd, leave } = arena(1);
  const sh = g.ship;
  enter(0, 'helm');
  cmd(0, 'helm.throttle', { set: 5 }); run(9);
  const v0 = sh.speed;
  cmd(0, 'helm.stop');
  ok(sh.helm.stage === stopIdx() && sh.helm.autoStop === true, `helm.stop: Stufe STOPP, autoStop an (aus ${f1(v0)} px/s)`);
  let tStop = null;
  run(8, (t) => { cmd(0, 'helm.input', { turn: 0, thrust: 0 }); if (tStop == null && sh.speed < 0.5) tStop = t; });
  const L = CLS.lerche; const expT = v0 / (L.decel * L.brakeFactor);
  ok(tStop != null && near(tStop, expT, 0.5), `Allstopp: steht nach ${f2(tStop)} s (≈ ${f2(expT)} s = Tempo / (decel × brakeFactor))`);
  ok(sh.speed < 0.5, 'steht danach still');
  sh.dodgeCd = 0;
  cmd(0, 'helm.dodge', { dir: 1 });
  ok(Math.hypot(sh.vx, sh.vy) > 300 && sh.helm.autoStop === false, `Ausweichen: Impuls ${f1(Math.hypot(sh.vx, sh.vy))} px/s, beendet Allstopp`);
  run(5);
  ok(sh.speed < 5, `Querdrift nach Ausweichen klingt ab (${f1(sh.speed)} px/s nach 5 s)`);
  // Allstopp bei unbesetzter Steuer bremst weiter
  cmd(0, 'helm.throttle', { set: 4 }); run(6);
  cmd(0, 'helm.stop'); leave(0);
  run(6);
  ok(sh.speed < 0.5, `Allstopp, dann Steuer verlassen: steht (${f1(sh.speed)} px/s)`);
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

section('Gegner: Snapshot vx/vy/state und Anfangstempo (§3, §7)', () => {
  ok(flightV2On(), 'CONFIG.spaceM3b.flightV2.arena = true');
  const { g, run } = arena(1);
  const kinds = ['raider', 'gunboat'];
  const es = kinds.map((k, i) => spawn(g, k, i * 2, 800));
  g.step();
  const s = g.snapshot();
  const se = s.space.enemies;
  ok(se.length === 2 && se.every((e) => typeof e.vx === 'number' && typeof e.vy === 'number' && typeof e.state === 'string' && e.state.length <= 10), `enemies[]: vx, vy, state (${se.map((e) => e.kind + ':' + e.state).join(', ')})`);
  const sp = es.map((e) => Math.hypot(e.vx || 0, e.vy || 0));
  info(`Tempo direkt nach dem Spawn: ${kinds.map((k, i) => k + ' ' + f1(sp[i])).join(', ')} px/s`);
  // Testgelände-Welle 1 laut §7: Kanonenboot + 2 Jäger, mit Anfangstempo
  const w1 = (CONFIG.arena.waves[0] || []).slice().sort().join();
  ok(w1 === 'gunboat,raider,raider', `Testgelände Welle 1 = Kanonenboot + 2 Jäger (${w1})`);
  const t = arena(1); t.g.arena.nextAt = t.g.time; t.g.step();
  const first = t.g.space.enemies.map((e) => e.kind + ' ' + f1(Math.hypot(e.vx || 0, e.vy || 0)));
  ok(t.g.space.enemies.length > 0 && t.g.space.enemies.filter((e) => e.kind !== 'pylon').every((e) => Math.hypot(e.vx || 0, e.vy || 0) > 10), `Welle startet mit Anfangstempo (${first.join(', ')})`);
  run(1);
  ok(g.errors === 0 && t.g.errors === 0, 'keine Server-Fehler');
});

// Jäger-Überflüge, Mindestabstand, Randstreifen, Mindesttempo – Lerche fährt geradeaus (Bezugssystem wird mitgeführt)
function raidRun(opts) {
  const o = opts || {};
  const { g, run, enter, cmd } = arena(1, { seed: o.seed || 21 });
  enter(0, 'helm');
  cmd(0, 'helm.throttle', { set: o.stage != null ? o.stage : 3 });
  const enemies = (o.kinds || ['raider', 'raider']).map((k, i) => spawn(g, k, (o.spawnA || 0.6) + i * 1.3, 800));
  const st = stateReader(g);
  const R = CLS.raider;
  const eps = {}; const done = [];
  let minSep = Infinity, minSepPair = '', minRaider = Infinity, edgeMax = 0, edgeWho = '';
  const edgeT = {}; const STRIP = o.strip || 100;
  const sp = g.space;
  const stateCount = {};
  run(o.sec || 120, () => {
    keepShip(g);
    if (o.recentre !== false) recentre(g);
    const sh = g.ship;
    const live = g.space.enemies;
    for (const e of live) {
      const s = st(e);
      stateCount[s] = (stateCount[s] || 0) + 1;
      const d = dist(e.x, e.y, sh.x, sh.y);
      // Mindestabstand: zur Lerche und zu den anderen Gegnern
      if (d < minSep) { minSep = d; minSepPair = e.kind + '–Lerche'; }
      for (const q of live) if (q !== e && q.id > e.id) { const dq = dist(e.x, e.y, q.x, q.y); if (dq < minSep) { minSep = dq; minSepPair = e.kind + '–' + q.kind; } }
      if (e.kind === 'raider') minRaider = Math.min(minRaider, Math.hypot(e.vx || 0, e.vy || 0));
      // Randstreifen
      const inStrip = e.x < STRIP || e.y < STRIP || e.x > sp.w - STRIP || e.y > sp.h - STRIP;
      edgeT[e.id] = inStrip ? (edgeT[e.id] || 0) + DT : 0;
      if (edgeT[e.id] > edgeMax) { edgeMax = edgeT[e.id]; edgeWho = e.kind; }
      // Überflug-Episoden (nur Jäger): approach -> overshoot -> turn -> approach
      if (e.kind !== 'raider') continue;
      let ep = eps[e.id];
      if (isState(s, 'approach')) {
        if (ep && ep.phase === 'after') { done.push(ep); ep = null; }
        if (!ep) ep = eps[e.id] = { phase: 'in', minD: Infinity, maxAfter: 0, t0: g.time };
        ep.minD = Math.min(ep.minD, d);
      } else if (ep) {
        if (isState(s, 'overshoot') && ep.phase === 'in') ep.minD = Math.min(ep.minD, d);
        else ep.phase = 'after';
        if (ep.phase === 'after' || isState(s, 'overshoot')) ep.maxAfter = Math.max(ep.maxAfter, d);
      }
    }
  });
  for (const id of Object.keys(eps)) if (eps[id] && eps[id].phase === 'after') done.push(eps[id]);
  return { g, done, minSep, minSepPair, minRaider, edgeMax, edgeWho, stateCount, enemies };
}

section('Jäger: Überflüge statt Kreisen (§3, §6)', () => {
  const runs = [21, 22, 23].map((seed, i) => raidRun({ seed, stage: [3, 4, 1][i], sec: 120 }));
  const all = runs.flatMap((r) => r.done);
  const pass = all.filter((ep) => ep.minD < 150 && ep.maxAfter > 300);
  const share = all.length ? pass.length / all.length : 0;
  info('Zustände (Ticks): ' + runs.map((r) => Object.entries(r.stateCount).map(([k, v]) => k + ' ' + v).join(', ')).join(' | '));
  info('Anflüge je Lauf (½ / ¾ / Stopp): ' + runs.map((r) => `${r.done.filter((ep) => ep.minD < 150 && ep.maxAfter > 300).length}/${r.done.length}`).join(' · ') +
    ' · nächster Abstand Ø ' + f1(all.reduce((a, ep) => a + ep.minD, 0) / Math.max(1, all.length)) + ' px');
  ok(all.length >= 6, `genug Anflüge gemessen (${all.length} in 3 × 120 s)`);
  ok(share >= 0.8, `Überflüge: ${pass.length}/${all.length} = ${f1(share * 100)} % mit Abstand < 150 und danach > 300 (Soll ≥ 80 %)`);
  const minR = Math.min(...runs.map((r) => r.minRaider));
  ok(minR >= CLS.raider.minSpeed - 1, `Jäger im Spiel nie unter minSpeed ${CLS.raider.minSpeed} (min ${f1(minR)} px/s)`);
  ok(runs.every((r) => r.g.errors === 0), 'keine Server-Fehler');
});

section('Abstand und Randstreifen (§3, §6)', () => {
  // Welle 1 (Kanonenboot + 2 Jäger) gegen geradeaus fahrende, stehende und kreisende Lerche
  const a = raidRun({ seed: 31, kinds: ['gunboat', 'raider', 'raider'], stage: 3, sec: 150 });
  const b = raidRun({ seed: 32, kinds: ['gunboat', 'raider', 'raider'], stage: 1, sec: 150 });
  // Lerche nahe am Rand geparkt (450 px): Gegner dürfen nicht im Randstreifen hängen bleiben
  const c = (() => {
    const t = arena(1, { seed: 33 });
    t.g.ship.x = 450; t.g.ship.y = 450;
    const es = ['gunboat', 'raider', 'raider'].map((k, i) => spawn(t.g, k, 0.3 + i * 0.5, 700));
    const edgeT = {}; let edgeMax = 0, who = ''; let minSep = Infinity; const S2 = 100;
    t.run(150, () => {
      keepShip(t.g);
      for (const e of t.g.space.enemies) {
        const sp = t.g.space;
        const inStrip = e.x < S2 || e.y < S2 || e.x > sp.w - S2 || e.y > sp.h - S2;
        edgeT[e.id] = inStrip ? (edgeT[e.id] || 0) + DT : 0;
        if (edgeT[e.id] > edgeMax) { edgeMax = edgeT[e.id]; who = e.kind; }
        minSep = Math.min(minSep, dist(e.x, e.y, t.g.ship.x, t.g.ship.y));
        for (const q of t.g.space.enemies) if (q !== e) minSep = Math.min(minSep, dist(e.x, e.y, q.x, q.y));
      }
    });
    return { edgeMax, edgeWho: who, minSep, minSepPair: '', g: t.g, n: es.length };
  })();
  const rows = [['geradeaus ½', a], ['steht', b], ['am Rand geparkt', c]];
  for (const [name, r] of rows) {
    ok(r.minSep >= 40, `${name}: Mindestabstand zwischen Schiffen ${f1(r.minSep)} px ${r.minSepPair ? '(' + r.minSepPair + ') ' : ''}(Soll ≥ 40)`);
    ok(r.edgeMax <= 5, `${name}: längste Zeit eines Gegners im Randstreifen (100 px) ${f1(r.edgeMax)} s ${r.edgeWho ? '(' + r.edgeWho + ') ' : ''}(Soll ≤ 5)`);
  }
  ok(rows.every(([, r]) => r.g.errors === 0), 'keine Server-Fehler');
});

section('Kanonenboot: Breitseite gegen geradeaus fahrende Lerche (§3, §6)', () => {
  const arcs = CONFIG.enemyWeapons.gunboat;
  const res = [];
  for (const [seed, stage] of [[41, 3], [42, 4], [43, 3], [44, 2]]) {
    const { g, run, enter, cmd } = arena(1, { seed });
    enter(0, 'helm'); cmd(0, 'helm.throttle', { set: stage });
    const gb = spawn(g, 'gunboat', 0.8 + seed * 0.7, 700);
    const st = stateReader(g);
    let tot = 0, inArc = 0, settled = null; const states = {};
    run(120, (t) => {
      keepShip(g); recentre(g);
      if (!g.space.enemies.includes(gb)) return;
      const sh = g.ship;
      const s = st(gb); states[s] = (states[s] || 0) + 1;
      const d = dist(gb.x, gb.y, sh.x, sh.y);
      if (settled == null && d < (CONFIG.spaceM3b.pilot.gunboatRange || 400) + 150) settled = t;
      if (settled == null || t < settled + 5) return;
      tot++;
      if (arcs.some((w) => Physics.inArc(gb.x, gb.y, gb.angle, w.facing, w.arc, w.range, sh.x, sh.y))) inArc++;
    });
    res.push({ seed, stage, share: tot ? inArc / tot : 0, settled, states, errors: g.errors });
  }
  for (const r of res) info(`Seed ${r.seed}, Lerche Stufe ${r.stage}: Breitseite ${f1(r.share * 100)} % (ab ${f1(r.settled)} s + 5 s) · Zustände ${Object.entries(r.states).map(([k, v]) => k + ' ' + v).join(', ')}`);
  const avg = res.reduce((a, r) => a + r.share, 0) / res.length;
  ok(avg >= 0.6, `Kanonenboot hält die Breitseite im Mittel ${f1(avg * 100)} % der Zeit (Soll ≥ 60 %)`);
  ok(res.every((r) => r.share >= 0.45), `jeder Lauf ≥ 45 % (${res.map((r) => f1(r.share * 100)).join(' / ')} %)`);
  ok(res.every((r) => r.errors === 0), 'keine Server-Fehler');
});

section('Missionen: flightV2.missions aus, Lerche mit Stufen (§2)', () => {
  ok(CONFIG.spaceM3b.flightV2.missions === false, 'flightV2.missions = false (Schritt A)');
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'X', name: 'X', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 30; k++) g.step();
  const h = g.snapshot().ship.helm || {};
  ok(typeof h.stage === 'number' && Array.isArray(h.stages), `Kampagne: ship.helm.stage ${h.stage}, stages vorhanden`);
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('QA M3b: Jäger schießen mit Vorhalt (spaceM3b.pilotFire)', () => {
  const PF = CONFIG.spaceM3b.pilotFire && CONFIG.spaceM3b.pilotFire.raider;
  ok(!!PF && PF.lead > 0, `pilotFire.raider: Vorhalt ${PF && PF.lead}, Intervall ${PF && PF.fireInterval} s`);
  // Lerche fährt ½ quer zur Schusslinie; Geschoss (enemyShotSpeed) aus 300 px seitlich
  const v = CONFIG.combat.enemyShotSpeed; const ship = { x: 0, y: 0, vx: 65, vy: 0 };
  const fly = (ang) => { let px = 0, py = 300, sx = 0, sy = 0, best = 1e9; for (let t = 0; t < 3; t += 1 / 60) { px += Math.cos(ang) * v / 60; py += Math.sin(ang) * v / 60; sx += ship.vx / 60; best = Math.min(best, Math.hypot(px - sx, py - sy)); } return best; };
  const plain = fly(Math.atan2(-300, 0)); const lead = fly(space.leadAngle(0, 300, ship, v, 1));
  ok(lead < CONFIG.flight.projectileHitDist && plain > CONFIG.flight.projectileHitDist, `mit Vorhalt trifft der Schuss (${f1(lead)} px), ohne nicht (${f1(plain)} px; Trefferradius ${CONFIG.flight.projectileHitDist})`);
});

section('S2: Schützlings-Klassen und Gegnerziele (CONTRACT-S2 §5)', () => {
  const Pilot = require('../server/sim/pilot.js');
  for (const k of ['frachter', 'karawane', 'bergungsboot']) {
    const c = CLS[k];
    ok(!!c && c.maxSpeed < CLS.lerche.maxSpeed + 1 && c.stages[0] === 0, `${k}: Klasse da, maxSpeed ${c && c.maxSpeed} (nicht schneller als die Lerche), Stopp-Stufe`);
    const b = makeBody(c, Flight.agileStage(c), 0, 0);
    stepN(b, { stage: c.stages.length - 1, rudder: 0 }, c, 30);
    ok(near(fwd(b), c.maxSpeed, 1), `${k}: erreicht Voll (${f1(fwd(b))} px/s)`);
  }
  const { g } = arena(1);
  const e = spawn(g, 'raider', 0.5);
  ok(Pilot.targetOf(g, e) === g.ship && !('targetId' in e), 'ohne ziel: targetOf = Lerche, kein targetId-Feld (Ablauf wie bisher)');
  ok(g.errors === 0, 'keine Server-Fehler');
});

console.log(`\n${n - fails}/${n} ok${fails ? ` – ${fails} FEHLER` : ''}`);
process.exit(fails ? 1 : 0);
