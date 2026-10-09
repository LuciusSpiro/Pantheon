'use strict';
// Gegner-KI als Pilot (CONTRACT-M3B §3). Pilot.update erzeugt nur die Eingabe { stage, rudder } – die Bewegung macht
// Flight.stepBody (shared/flight.js), dieselbe Physik wie bei der Lerche. Deterministisch, Zufall nur über game.rng.
//  - Kanonenboot: Stationshalten querab der Lerche (Bezugssystem der Lerche, mit Vorhalt), Seitenwechsel auf ¾
//  - Jäger: approach (Voll, Vorhaltepunkt + seitlicher Versatz) -> overshoot (Ruder 0) -> turn (Wende langsam) -> …
//  - Pylon: Turm (maxSpeed 0). Relais und Wächter bleiben kinematisch (space.js, alte Logik).
//  - Alle: Randvermeidung, Mindestabstand, Stuck-Timer, Rückzug auf Voll.
// Keine Abhängigkeit zu space.js (sonst Zirkelbezug) – alles kommt über game.
const Flight = require('../../shared/flight.js');
const Physics = require('../../shared/physics.js');
const Drift = require('../../shared/drift.js');   // W2 AP3b: Brocken-Lage (Freigabe Studioleitung: nur avoid/keepApart)

const norm = Physics.normAngle;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const FLYING = ['gunboat', 'raider', 'pylon'];   // Relais und Wächter: kinematisch (Schritt A)
const EDGE_MARGIN = 140;   // px: so weit vom Rand soll die Vorausschau bleiben
const EDGE_STRIP = 100;    // px: Randstreifen für den Stuck-Timer (vgl. test-flight)

function M3B(game) { return game.C.spaceM3b || {}; }
function P(game) {
  return Object.assign({ kP: 2.5, kD: 1.2, gunboatRange: 400, lead: 1.5, approachOffset: 60, overshootDist: 380, overshootTime: 3,
    raiderStagger: 2, edgeLook: 2, minSeparation: 60, stuckTime: 4 }, M3B(game).pilot || {});
}
function shipClass(game, kind) { const SC = game.C.shipClasses; return SC ? SC[kind] || null : null; }

// S2 §5: Ziel eines Gegners. e.targetId == null -> die Lerche (game.ship, unverändert wie bisher). Sonst der Schützling
// mit dieser ID, solange er kampffähig ist; Treffer der Lerche (e.aggroUntil) ziehen den Gegner auf die Lerche.
// Ist der Schützling ausgefallen/entkommen, nimmt der Gegner einen anderen aktiven Schützling oder wieder die Lerche.
function targetOf(game, e) {
  if (e.targetId == null) return game.ship;
  if (e.aggroUntil != null && e.aggroUntil > game.time) return game.ship;
  const L = game.space.escorts || [];
  const ok = (q) => q.state === 'ok' || q.state === 'beschaedigt';
  const es = L.find((q) => q.id === e.targetId);
  if (es && ok(es)) return es;
  const alt = L.find(ok);
  e.targetId = alt ? alt.id : null;
  return alt || game.ship;
}

// S2 §5: Wegpunkt-Steuerung eines Schützlings. goal = { x, y, speed (px/s), stopDist } oder null (anhalten).
// Liefert { stage, rudder, brake } für Flight.stepBody (gleiche Physik wie Lerche und Gegner).
function escort(game, es, c, goal) {
  if (!goal) return { stage: Flight.stopStage(c), rudder: rudderFor(game, es, c, es.angle), brake: true };
  const dx = goal.x - es.x, dy = goal.y - es.y; const d = Math.hypot(dx, dy);
  let speed = Math.max(0, Number(goal.speed) || 0);
  const stopDist = goal.stopDist || 0;
  if (stopDist > 0) speed = d < stopDist ? 0 : Math.min(speed, (d - stopDist) * 0.6 + 8);
  let head = d > 2 ? Math.atan2(dy, dx) : es.angle;
  // große Kursänderung: wendigste Stufe statt Vollgas (im Stand dreht ein Schiff kaum)
  if (speed > 0 && Math.abs(norm(head - es.angle)) > 1.0) speed = Math.max(Math.min(speed, Flight.stageSpeed(c, Flight.agileStage(c))), 8);
  head = avoid(game, es, c, head);
  const stage = speed > 0 ? Math.max(stageFor(c, speed), speed > 4 ? 1 : 0) : Flight.stopStage(c);
  return { stage, rudder: speed > 0 || d > 2 ? rudderFor(game, es, c, head) : 0, brake: speed === 0 };
}

// Neues Flugmodell an? Testgelände: flightV2.arena, sonst flightV2.missions (per tune umschaltbar)
function active(game) {
  const F = M3B(game).flightV2;
  if (!F) return false;
  const arena = !!(game.arena && game.arena.kind === 'arena_space');
  // S2 §0.17: erzeugte Missionen (kopf.art 'generiert'|'archiv') fliegen mit der neuen KI (ENGINE liefert mission.flightV2)
  if (!arena && game.mission && typeof game.mission.flightV2 === 'function' && game.mission.flightV2()) return true;
  return arena ? !!F.arena : !!F.missions;
}
// Fliegt dieser Gegner über das Flugmodell?
function flies(game, e) {
  const kind = typeof e === 'string' ? e : e.kind;
  return active(game) && FLYING.includes(kind) && !!shipClass(game, kind);
}

// Flugzustand am Gegner ergänzen (auch für Gegner, die vor einem tune-Wechsel entstanden sind)
function ensure(game, e) {
  if (e._pilot) return;
  e._pilot = true;
  const c = shipClass(game, e.kind);
  if (e.vx == null) e.vx = 0;
  if (e.vy == null) e.vy = 0;
  if (e.turnVel == null) e.turnVel = 0;
  if (e.stage == null) e.stage = c ? Flight.stopStage(c) : 0;
  e.pstate = e.pstate || (e.kind === 'raider' ? 'approach' : e.kind === 'gunboat' ? 'station' : null);
  e.pT = 0; e.stuckT = 0; e.edgeT = 0;
  if (e.kind === 'gunboat' && !e.side) e.side = game.rng.chance(0.5) ? 1 : -1;
}

// Anfangstempo beim Spawn (§7): Kanonenboot auf ½, Jäger auf Voll, Blick wie gespawnt
function initSpawn(game, e) {
  const c = shipClass(game, e.kind);
  if (!c) return;
  ensure(game, e);
  let stage = Flight.stopStage(c);
  if (e.kind === 'gunboat') stage = Flight.agileStage(c);
  else if (e.kind === 'raider') stage = c.stages.length - 1;
  e.stage = stage;
  const v = Math.max(c.minSpeed || 0, Flight.stageSpeed(c, stage));
  e.vx = Math.cos(e.angle) * v; e.vy = Math.sin(e.angle) * v;
  if (e.kind === 'raider') {
    // gestaffelt: der erste Jäger einer Welle fliegt an, der nächste wartet raiderStagger s (Zustand turn)
    if (mayApproach(game, e)) startApproach(game, e);
    else { setState(e, 'turn'); newPass(game, e); }
  }
  if (e.kind === 'gunboat') {
    const L = targetOf(game, e);
    const rel = norm(Math.atan2(e.y - L.y, e.x - L.x) - L.angle);
    e.side = rel >= 0 ? 1 : -1;
  }
}

// PD-Ruder auf einen Wunschkurs
function rudderFor(game, e, c, head) {
  const p = P(game);
  const err = norm(head - e.angle);
  const tr = c.turnRate || 1;
  return clamp(p.kP * err - p.kD * (e.turnVel || 0) / tr, -1, 1);
}
// Stufe, deren Tempo am besten zu einer Wunschgeschwindigkeit passt (nur Stopp und vorwärts)
function stageFor(c, speed) {
  const st = c.stages; const s0 = Flight.stopStage(c);
  let best = s0, bd = Infinity;
  for (let i = 0; i < st.length; i++) {
    if (st[i] < 0) continue;
    const d = Math.abs(st[i] * c.maxSpeed - speed);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function stageNear(c, frac) {
  let best = 0, bd = Infinity;
  c.stages.forEach((s, i) => { const d = Math.abs(s - frac); if (d < bd) { bd = d; best = i; } });
  return best;
}
function setState(e, s) { if (e.pstate !== s) { e.pstate = s; e.pT = 0; } }

// Umweg: Liegt der Punkt (ox, oy) näher als clear an der Strecke a -> b, Wegpunkt seitlich am Kreis vorbei
function detour(ax, ay, bx, by, ox, oy, clear) {
  const sx = bx - ax, sy = by - ay; const l2 = sx * sx + sy * sy;
  if (l2 < 1) return null;
  const t = ((ox - ax) * sx + (oy - ay) * sy) / l2;
  if (t <= 0 || t >= 1) return null;
  const cx = ax + sx * t, cy = ay + sy * t;
  let nx = cx - ox, ny = cy - oy; let nd = Math.hypot(nx, ny);
  if (nd >= clear) return null;
  if (nd < 1) { nx = -sy; ny = sx; nd = Math.hypot(nx, ny); }   // genau mittig: links herum
  return { x: ox + nx / nd * (clear + 60), y: oy + ny / nd * (clear + 60) };
}

// ---------- Kanonenboot: Stationshalten im Bezugssystem der Lerche ----------
function gunboat(game, e, c, dt) {
  const p = P(game); const L = targetOf(game, e);
  // W2 AP3b (Freigabe Studioleitung): Abstand höchstens wirksame Breitseitenreichweite − 40 (im Nebel kürzer, wie bei der Lerche)
  const bs = Math.max(0, ...((game.C.enemyWeapons && game.C.enemyWeapons.gunboat) || []).map((w) => w.range || 0));
  const R = bs > 0 && typeof game.waffenReichweite === 'function' ? Math.min(p.gunboatRange, game.waffenReichweite(bs) - 40) : p.gunboatRange;
  const lead = p.lead;
  const tv = Math.hypot(L.vx, L.vy);
  const base = tv > 15 ? Math.atan2(L.vy, L.vx) : L.angle;   // Bezugsrichtung: Fahrtrichtung, sonst Bug
  const dx = L.x - e.x, dy = L.y - e.y; const d = Math.hypot(dx, dy) || 1;
  const bearing = Math.atan2(dy, dx);
  const relL = norm(bearing - e.angle);          // wo liegt die Lerche, vom Kanonenboot aus
  e.switchCd = Math.max(0, (e.switchCd || 0) - dt);

  if (e.pstate === 'station') {
    // Seitenwechsel 1: der Breitseitensektor zur Lerche ist schwach (≤ 1), die andere Seite deutlich stärker
    const sec = Physics.sectorOf(e.x, e.y, e.angle, L.x, L.y);
    const other = sec === 1 ? 3 : sec === 3 ? 1 : null;
    const weak = other != null && e.shields && e.shields[sec] <= 1 && e.shields[other] >= e.shields[sec] + 2;
    // Seitenwechsel 2: die Lerche liegt lange vor dem Bug oder hinter dem Heck (keine Breitseite möglich)
    // (nur in der Nähe des Sollpunkts – auf dem Weg dorthin liegt die Lerche natürlich oft vorn)
    const sa = base + e.side * Math.PI / 2;
    const nearSt = Math.hypot(L.x + Math.cos(sa) * R - e.x, L.y + Math.sin(sa) * R - e.y) < 180;
    const offBeam = nearSt && Math.abs(Math.abs(relL) - Math.PI / 2) > Math.PI / 4;
    e.offBeamT = offBeam ? (e.offBeamT || 0) + dt : Math.max(0, (e.offBeamT || 0) - dt);
    if (e.switchCd <= 0 && ((weak && nearSt) || e.offBeamT > 6)) {
      // vor oder hinter der Lerche herum – je nachdem, wohin der Bug des Kanonenboots zeigt (keine Wende über die Lerche)
      e.crossFront = Math.cos(norm(e.angle - base)) >= 0;
      e.side = -e.side; e.offBeamT = 0; e.switchCd = 12;
      setState(e, 'cross');
    }
  }
  let px, py;
  if (e.pstate === 'cross') {
    const a = base + (e.crossFront ? 0 : Math.PI);
    px = L.x + Math.cos(a) * R + L.vx * lead; py = L.y + Math.sin(a) * R + L.vy * lead;
    // Zwischenpunkt vor dem Bug / hinter dem Heck erreicht (oder zu lange unterwegs): weiter zur neuen Seite
    if (Math.hypot(px - e.x, py - e.y) < 160 || e.pT > 14) { setState(e, 'station'); }
  }
  if (e.pstate !== 'cross') {
    const sw = game.space; const mg = 150;
    const pt = (s) => { const a = base + s * Math.PI / 2; return { x: L.x + Math.cos(a) * R + L.vx * lead, y: L.y + Math.sin(a) * R + L.vy * lead }; };
    const outOf = (q) => Math.max(0, mg - q.x, q.x - (sw.w - mg), mg - q.y, q.y - (sw.h - mg));
    let q = pt(e.side);
    // Sollpunkt jenseits des Randes (Lerche fährt am Rand entlang): andere Seite nehmen, sonst in das Feld klemmen
    if (outOf(q) > 0 && outOf(pt(-e.side)) < outOf(q) && e.switchCd <= 0) { e.side = -e.side; e.switchCd = 6; q = pt(e.side); }
    px = clamp(q.x, mg, sw.w - mg); py = clamp(q.y, mg, sw.h - mg);
  }
  // Nicht quer durch die Lerche: schneidet der Weg zum Sollpunkt den Kreis um die Lerche, über einen Tangentenpunkt
  const wp = detour(e.x, e.y, px, py, L.x, L.y, 210);
  if (wp) { px = wp.x; py = wp.y; }
  const ex = px - e.x, ey = py - e.y; const err = Math.hypot(ex, ey);
  const k = 0.35;
  const dvx = L.vx + clamp(k * ex, -c.maxSpeed, c.maxSpeed), dvy = L.vy + clamp(k * ey, -c.maxSpeed, c.maxSpeed);
  const sp = Math.hypot(dvx, dvy);
  let head = sp > 8 ? Math.atan2(dvy, dvx) : base;
  if (err < 60 && e.pstate === 'station') {
    head = base;   // nah am Sollpunkt: parallel zur Lerche = Breitseite
    // dreht die Lerche um das Boot herum, reicht „parallel“ nicht: Breitseite direkt zu ihr drehen
    if (Math.abs(Math.abs(relL) - Math.PI / 2) > 0.35) {
      const h1 = norm(bearing + Math.PI / 2), h2 = norm(bearing - Math.PI / 2);
      head = Math.abs(norm(h1 - e.angle)) <= Math.abs(norm(h2 - e.angle)) ? h1 : h2;
    }
  }
  // Lerche (fast) im Stand, Boot nah am Sollpunkt: quer liegen bleiben (Bug parallel oder antiparallel – beides ist
  // Breitseite) und nur mit ¼ / Stopp / Rückwärts nachrücken, statt Kreise zu fahren
  // (W2: nur, solange die Lerche in Reichweite der Breitseite liegt – sonst nachrücken statt außer Reichweite liegen bleiben)
  if (e.pstate === 'station' && tv < 15 && err < 150 && d >= 190 && (R >= p.gunboatRange || d <= R + 40)) {
    const hd = Math.cos(norm(base - e.angle)) >= 0 ? base : norm(base + Math.PI);
    const along = ex * Math.cos(e.angle) + ey * Math.sin(e.angle);
    const stage = along > 40 ? stageNear(c, 0.25) : along < -40 ? 0 : Flight.stopStage(c);
    return { stage, head: hd };
  }
  // Viel zu nah (die Lerche dreht eng auf das Boot zu): erst Abstand gewinnen
  if (d < 190) {
    const away = bearing + Math.PI;
    const turnSide = norm(away - e.angle) >= 0 ? 1 : -1;
    return { stage: stageNear(c, 0.75), head: e.angle + turnSide * Math.min(Math.abs(norm(away - e.angle)), 1.2) };
  }
  // Große Wende mit der Lerche auf der Innenseite: andersherum drehen (der Wendekreis würde über sie führen)
  const herr = norm(head - e.angle);
  // (nur wenn sie seitlich liegt – genau vorn/achtern ist es egal, sonst pendelt die Drehrichtung)
  const sideOn = Math.abs(relL) > 0.5 && Math.abs(relL) < Math.PI - 0.5;
  if (Math.abs(herr) > 1.2 && d < 480 && sideOn && Math.sign(herr) === Math.sign(relL)) head = e.angle - Math.sign(relL) * 1.5;
  const proj = sp * Math.max(0, Math.cos(norm(head - e.angle)));
  let stage = stageFor(c, proj);
  // Große Kursänderung: auf die wendigste Stufe (½) – im Stand dreht ein Schiff kaum
  if (Math.abs(norm(head - e.angle)) > 0.8) stage = Math.max(stage, Flight.agileStage(c));
  if (e.pstate === 'cross') stage = Math.max(stage, stageNear(c, 0.75));   // Kreuzen auf ¾
  return { stage, head };
}

// ---------- Jäger: Zustandsautomat ----------
function newPass(game, e) {
  const p = P(game);
  e.passSide = game.rng.chance(0.5) ? 1 : -1;
  e.passOff = p.approachOffset + game.rng.range(20, 50);   // seitlicher Versatz ≥ approachOffset (von der Lerchen-Mitte)
  e.passMin = Infinity;
}
function raiders(game) { return game.space.enemies.filter((q) => q.kind === 'raider' && q._pilot); }
// Darf dieser Jäger jetzt anfliegen? Höchstens einer in approach innerhalb 300 px, Staffelung raiderStagger s
function mayApproach(game, e) {
  const p = P(game); const sp = game.space;
  if (sp._lastApproachT != null && game.time - sp._lastApproachT < p.raiderStagger && sp._lastApproachId !== e.id) return false;
  for (const q of raiders(game)) {
    if (q === e || q.pstate !== 'approach') continue;
    const L = targetOf(game, q);   // S2: Ziel des anderen Jägers (Lerche oder Schützling)
    if (Math.hypot(q.x - L.x, q.y - L.y) < 300) return false;
  }
  return true;
}
function startApproach(game, e) {
  setState(e, 'approach');
  newPass(game, e);
  game.space._lastApproachT = game.time; game.space._lastApproachId = e.id;
}
function raider(game, e, c) {
  const p = P(game); const L = targetOf(game, e);
  const dx = L.x - e.x, dy = L.y - e.y; const d = Math.hypot(dx, dy) || 1;
  const bearing = Math.atan2(dy, dx);
  const top = c.stages.length - 1;
  if (e.pstate === 'approach') {
    e.passMin = Math.min(e.passMin == null ? Infinity : e.passMin, d);
    // Vorhaltepunkt: wo die Lerche bei Ankunft ist (höchstens 2,5 s voraus)
    const vClose = Math.max(80, Math.hypot(e.vx, e.vy));
    const t = Math.min(2.5, d / vClose);
    const lx = L.x + L.vx * t, ly = L.y + L.vy * t;
    const la = Math.atan2(ly - e.y, lx - e.x);
    const off = e.passOff || p.approachOffset;
    const sp = game.space; const mg = 160;
    let ax = lx + Math.cos(la + Math.PI / 2) * off * (e.passSide || 1);
    let ay = ly + Math.sin(la + Math.PI / 2) * off * (e.passSide || 1);
    ax = clamp(ax, mg, sp.w - mg); ay = clamp(ay, mg, sp.h - mg);   // nie auf einen Punkt am Rand zielen
    // Kurs so, dass die GESCHWINDIGKEIT (Jäger driften) auf den Zielpunkt zeigt: Driftwinkel vorhalten
    const want = Math.atan2(ay - e.y, ax - e.x);
    const vel = Math.hypot(e.vx, e.vy) > 20 ? Math.atan2(e.vy, e.vx) : e.angle;
    let head = want + clamp(norm(want - vel), -0.6, 0.6);
    // Nächster Punkt der Begegnung (relativ zur Lerche): fliegt der Jäger zu nah vorbei, von der Lerche wegdrehen
    const rx = L.x - e.x, ry = L.y - e.y, rvx = e.vx - L.vx, rvy = e.vy - L.vy;
    const rv2 = rvx * rvx + rvy * rvy;
    if (rv2 > 1) {
      const tc = (rx * rvx + ry * rvy) / rv2;
      if (tc > 0 && tc < 2.5) {
        const mx = rx - rvx * tc, my = ry - rvy * tc;
        if (Math.hypot(mx, my) < Math.max(75, off * 0.8)) {
          const s = Math.sign(rvx * ry - rvy * rx) || (e.passSide || 1);
          head = Math.atan2(rvy, rvx) - s * 0.7;
        }
      }
    }
    const passed = Math.abs(norm(bearing - e.angle)) > Math.PI / 2 && d < 320;
    // Überflug würde aus dem Feld führen: Anflug abbrechen, wenden
    const ox = e.x + e.vx * 1.5, oy = e.y + e.vy * 1.5;
    const outSoon = ox < 60 || oy < 60 || ox > sp.w - 60 || oy > sp.h - 60;
    if (d < 130 || passed || e.pT > 12 || (outSoon && d < 400)) {
      e.passes = (e.passes || 0) + 1;
      game.stats.raiderPasses = (game.stats.raiderPasses || 0) + 1;
      setState(e, 'overshoot');
      e.overHead = e.angle;
    }
    return { stage: top, head };
  }
  if (e.pstate === 'overshoot') {
    if (d > p.overshootDist || e.pT > p.overshootTime) setState(e, 'turn');
    return { stage: top, head: e.angle, rudder0: true };
  }
  // turn: Wende langsam (wendigste Stufe), Bug zur Lerche; freigegeben -> approach
  const stage = stageNear(c, 0.5);   // „Wende bei ½“ – beim Jäger die langsamste Stufe (≥ minSpeed)
  // Noch zu nah für eine Wende (Lerche dreht hinterher): tangential weg, bis Abstand da ist
  if (d < 260) return { stage: top, head: bearing + (e.passSide || 1) * (Math.PI / 2 + 0.6) };
  const aligned = Math.abs(norm(bearing - e.angle)) < 0.35;
  if (aligned && mayApproach(game, e)) { startApproach(game, e); return { stage: top, head: bearing }; }
  if (aligned || e.holding) {
    // Warteschleife: tangential um die Lerche auf ~480 px, bis der Anflug frei ist
    e.holding = !mayApproach(game, e);
    if (e.holding) {
      const dir = e.passSide || 1;
      const head = bearing - dir * (Math.PI / 2 - Math.atan((d - 480) / 150));
      return { stage, head };
    }
  }
  if (e.pT > 9 && mayApproach(game, e)) { startApproach(game, e); return { stage: top, head: bearing }; }   // Stuck-Schutz
  return { stage, head: bearing };
}

// ---------- Pylon: Turm ----------
function pylon(game, e) {
  const L = targetOf(game, e);
  return { stage: 0, head: Math.atan2(L.y - e.y, L.x - e.x), noAvoid: true };
}

// ---------- Randvermeidung + Abstand (für alle fliegenden Gegner) ----------
function avoid(game, e, c, head) {
  const p = P(game); const sp = game.space; const L = game.ship;
  let hx = Math.cos(head), hy = Math.sin(head);
  // Rand: Position in edgeLook s außerhalb des Randes -> Kurs zur Mitte beimischen
  const fx = e.x + e.vx * p.edgeLook, fy = e.y + e.vy * p.edgeLook;
  let out = 0;
  out = Math.max(out, EDGE_MARGIN - fx, fx - (sp.w - EDGE_MARGIN), EDGE_MARGIN - fy, fy - (sp.h - EDGE_MARGIN));
  if (out > 0 || (e.forceCenterT || 0) > 0) {
    const cx = sp.w / 2 - e.x, cy = sp.h / 2 - e.y; const cd = Math.hypot(cx, cy) || 1;
    const w = (e.forceCenterT || 0) > 0 ? 6 : clamp(out / 150, 0.3, 4);
    hx += w * cx / cd; hy += w * cy / cd;
  }
  // Abstand zu anderen Schiffen (Gegner und Lerche): Vorausschau 0,6 s, wegsteuern
  const myR = c.radius || 20;
  const others = [{ id: '', x: L.x, y: L.y, vx: L.vx, vy: L.vy, r: (game.C.flight && game.C.flight.radius) || 36 }];
  for (const q of sp.enemies) if (q !== e) others.push({ id: q.id, x: q.x, y: q.y, vx: q.vx || 0, vy: q.vy || 0, r: (shipClass(game, q.kind) || {}).radius || 20 });
  if (sp.escorts) for (const q of sp.escorts) if (q !== e) others.push({ id: q.id, x: q.x, y: q.y, vx: q.vx || 0, vy: q.vy || 0, r: (shipClass(game, q.kind) || {}).radius || 30 });   // S2
  // W2 AP3b (E4): Brocken sind Hindernisse wie Schiffe (bewegte mit ihrer Drift-Geschwindigkeit). Lage aus shared/drift.js –
  // dieselbe Funktion wie space.js und Client. Berühren wird nicht hier verhindert: das macht space.js für alle gleich
  // (hinausschieben, Treffer wie bei der Lerche).
  if (sp.asteroids && sp.asteroids.length) {
    for (const a of Drift.jetzt(sp.asteroids, game.time)) {
      if (Math.abs(a.x - e.x) > 700 || Math.abs(a.y - e.y) > 700) continue;
      others.push({ id: a.id, x: a.x, y: a.y, vx: a.vx || 0, vy: a.vy || 0, r: a.r });
    }
  }
  for (const o of others) {
    const thr = Math.max(p.minSeparation, myR + o.r) + 40;
    const look = clamp(1.2 / (c.turnRate || 1), 0.6, 2);   // träge Schiffe schauen weiter voraus
    const rx = (e.x + e.vx * look) - (o.x + o.vx * look), ry = (e.y + e.vy * look) - (o.y + o.vy * look);
    const rd = Math.hypot(rx, ry);
    const nowD = Math.hypot(e.x - o.x, e.y - o.y);
    const dd = Math.min(rd, nowD);
    if (dd >= thr) continue;
    let ux = (rd > 1 ? rx / rd : (e.x - o.x) / (nowD || 1)), uy = (rd > 1 ? ry / rd : (e.y - o.y) / (nowD || 1));
    // nur seitlich ausweichen (ein Rückwärts-Anteil würde den Kurs umdrehen, z. B. bei zwei Jägern hintereinander)
    const h0x = Math.cos(e.angle), h0y = Math.sin(e.angle);
    const along = ux * h0x + uy * h0y;
    let lx = ux - along * h0x, ly = uy - along * h0y; let ll = Math.hypot(lx, ly);
    if (ll < 0.2) { const s = (String(e.id) < String(o.id || '')) ? 1 : -1; lx = -h0y * s; ly = h0x * s; ll = 1; }
    ux = lx / ll; uy = ly / ll;
    const w = 3 * (1 - dd / thr) + 0.5;
    hx += w * ux; hy += w * uy;
  }
  return Math.atan2(hy, hx);
}

// ---------- Hauptfunktion ----------
// Liefert { stage, rudder } (und setzt e.pstate). Rückzug: auf Voll vom Schiff weg.
function update(game, e, dt) {
  ensure(game, e);
  const c = shipClass(game, e.kind);
  const p = P(game); const sp = game.space; const L = targetOf(game, e);
  e.pT =(e.pT || 0) + dt;
  e.forceCenterT = Math.max(0, (e.forceCenterT || 0) - dt);
  let cmd;
  if (e.kind === 'pylon') cmd = pylon(game, e);
  else if (e.retreatUntil > game.time) {
    if (e.pstate !== 'retreat') e.preRetreat = e.pstate;
    setState(e, 'retreat');
    cmd = { stage: c.stages.length - 1, head: Math.atan2(e.y - L.y, e.x - L.x) };
  } else {
    if (e.pstate === 'retreat') setState(e, e.preRetreat === 'station' || e.preRetreat === 'cross' ? 'station' : 'turn');
    cmd = e.kind === 'gunboat' ? gunboat(game, e, c, dt) : raider(game, e, c);
  }
  // Stuck-Timer: zu lange im Randstreifen -> einige Sekunden hart zur Mitte
  const inStrip = e.x < EDGE_STRIP || e.y < EDGE_STRIP || e.x > sp.w - EDGE_STRIP || e.y > sp.h - EDGE_STRIP;
  e.edgeT = inStrip && e.kind !== 'pylon' ? (e.edgeT || 0) + dt : 0;
  if (e.edgeT > p.stuckTime * 0.5) { e.forceCenterT = 2.5; e.edgeT = 0; }
  // Stuck-Timer: kaum Fahrt, obwohl die Stufe Fahrt verlangt
  const spd = Math.hypot(e.vx, e.vy);
  const wants = c.stages[cmd.stage] * c.maxSpeed;
  e.stuckT = wants > 20 && spd < 8 ? (e.stuckT || 0) + dt : 0;
  if (e.stuckT > p.stuckTime) { e.stuckT = 0; e.forceCenterT = 2; if (e.kind === 'raider') setState(e, 'turn'); }
  let head = cmd.head;
  if (!cmd.noAvoid) head = avoid(game, e, c, head);
  const rudder = cmd.rudder0 && Math.abs(norm(head - cmd.head)) < 1e-6 ? 0 : rudderFor(game, e, c, head);
  return { stage: cmd.stage, rudder, brake: false };
}

// Letzte Sicherung gegen Zusammenstöße: unter max(minSeparation, Radiensumme) wird der Gegner hinausgeschoben und
// verliert den Geschwindigkeitsanteil zum anderen Schiff (wie an einem Brocken). Normalerweise greift vorher avoid().
function keepApart(game, e, c) {
  const p = P(game); const L = game.ship;
  const myR = c.radius || 20;
  const list = [{ x: L.x, y: L.y, r: (game.C.flight && game.C.flight.radius) || 36 }];
  for (const q of game.space.enemies) if (q !== e) list.push({ kind: q.kind + ':' + q.pstate, x: q.x, y: q.y, r: (shipClass(game, q.kind) || {}).radius || 20 });
  if (game.space.escorts) for (const q of game.space.escorts) list.push({ kind: 'escort', x: q.x, y: q.y, r: (shipClass(game, q.kind) || {}).radius || 30 });   // S2
  for (const o of list) {
    const min = Math.max(p.minSeparation, myR + o.r);
    let dx = e.x - o.x, dy = e.y - o.y; let d = Math.hypot(dx, dy);
    if (d >= min) continue;
    if (d < 0.01) { dx = Math.cos(e.angle); dy = Math.sin(e.angle); d = 1; }
    const nx = dx / d, ny = dy / d;
    e.x = o.x + nx * min; e.y = o.y + ny * min;
    const vn = e.vx * nx + e.vy * ny;
    if (vn < 0) {
      // Anteil zum anderen Schiff weg, Betrag behalten (Jäger fallen nie unter minSpeed)
      const v0 = Math.hypot(e.vx, e.vy);
      e.vx -= vn * nx; e.vy -= vn * ny;
      const v1 = Math.hypot(e.vx, e.vy);
      if (v1 > 1) { e.vx *= v0 / v1; e.vy *= v0 / v1; } else { e.vx = nx * v0; e.vy = ny * v0; }
    }
    game.stats.pilotPushes = (game.stats.pilotPushes || 0) + 1;
    if (game.pilotDebug) game.pilotDebug.push({ t: game.time, a: e.kind + ':' + e.pstate, b: o.kind || 'L', d });
  }
}

// Einen Gegner fliegen (Pilot + stepBody + Rand). Aufrufer: space.updateEnemies
function fly(game, e, dt) {
  const c = shipClass(game, e.kind);
  const input = update(game, e, dt);
  Flight.stepBody(e, input, c, null, dt);
  if (e.kind === 'pylon' && e.home) { e.x = e.home.x; e.y = e.home.y; e.vx = 0; e.vy = 0; }
  else keepApart(game, e, c);
  const sp = game.space; const m = 30;
  if (e.x < m) { e.x = m; e.vx = Math.max(0, e.vx); }
  if (e.x > sp.w - m) { e.x = sp.w - m; e.vx = Math.min(0, e.vx); }
  if (e.y < m) { e.y = m; e.vy = Math.max(0, e.vy); }
  if (e.y > sp.h - m) { e.y = sp.h - m; e.vy = Math.min(0, e.vy); }
  // am Rand abgebremst: Jäger behalten trotzdem ihr Mindesttempo (entlang des Randes)
  const vmin = c.minSpeed || 0; const v = Math.hypot(e.vx, e.vy);
  if (vmin > 0 && v < vmin) {
    if (v > 1) { e.vx *= vmin / v; e.vy *= vmin / v; }
    else { e.vx = Math.cos(e.angle) * vmin; e.vy = Math.sin(e.angle) * vmin; }
  }
}

// Snapshot-Kürzel des Zustands (für die Taktik: Anfluglinie bei 'approach')
function snapState(e) {
  if (!e._pilot || !e.pstate) return null;
  return e.pstate === 'cross' ? 'station' : e.pstate;
}

module.exports = { update, fly, flies, active, ensure, initSpawn, snapState, rudderFor, FLYING,
  targetOf, escort, avoid, stageFor };   // S2 §5 (SCHUETZLING)
