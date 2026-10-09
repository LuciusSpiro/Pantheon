'use strict';
// Wellen All (CONTRACT-W2 §3, AP3b): Drift-Funktion (shared/drift.js), Nebel-Faktor auf dem Server (Lerche und Gegner gleich),
// Brocken für alle (Gegner prallen ab und nehmen Schaden, Geschosse und Strahlen schlagen ein), Szenenwahl in der Lobby,
// gemeinsamer Wellen-Ablauf (Welle, Zeit, Abschüsse, Ende beim Notfallprotokoll), Snapshot-Budget mit bewegten Brocken.
//   node tools/test-wellen-all.js            -> alle Abschnitte
//   node tools/test-wellen-all.js drift      -> nur Abschnitte, deren Name einen der Begriffe enthält
const CONFIG = require('../shared/config.js');
const Drift = require('../shared/drift.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Wellen = require('../server/sim/wellen.js');
const { makeRng } = require('../server/util.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const BUDGET = CONFIG.net.snapMax - CONFIG.net.snapLuft;
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Spiel mit np Spielern, Lobby-Start Wellen All in Szene sz (null = Altweg)
function allSpiel(np, sz, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_space', szene: sz });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const events = (kind) => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === kind);
  return { g, cs, events, S: () => g.arena && g.arena.wellen };
}
const ruhe = (g) => { g.ship.holdFireUntil = g.time + 1e6; };

// ---------------------------------------------------------------------------------------------------------------------
section('drift: reine Funktion der Spielzeit, beschränkt, Tempo stimmt', () => {
  const a = { id: 'a0', x: 1000, y: 500, r: 30, seed: 1, b: [785, 30, 150, 400, 500] };
  const l1 = Drift.lage(a, 12.34), l2 = Drift.lage(a, 12.34);
  ok(l1.x === l2.x && l1.y === l2.y && l1.rot === l2.rot, 'gleiche Zeit -> gleiche Lage (deterministisch)');
  let maxD = 0, maxV = 0, vOk = true;
  for (let t = 0; t < 120; t += 0.37) {
    const l = Drift.lage(a, t);
    maxD = Math.max(maxD, Math.hypot(l.x - a.x, l.y - a.y));
    maxV = Math.max(maxV, Math.hypot(l.vx, l.vy));
    const h = 1e-4; const lb = Drift.lage(a, t + h);
    if (Math.abs((lb.x - l.x) / h - l.vx) > 0.05 || Math.abs((lb.y - l.y) / h - l.vy) > 0.05) vOk = false;
  }
  ok(maxD <= 150 + 1e-9 && maxD > 140, `Auslenkung ≤ Amplitude (max ${maxD.toFixed(1)} px von 150)`);
  ok(maxV <= 30 + 1e-9 && maxV > 28, `Tempo ≤ Höchsttempo (max ${maxV.toFixed(1)} px/s von 30)`);
  ok(vOk, 'vx/vy = Ableitung der Lage (Kollision mit Relativtempo)');
  ok(Math.abs(Drift.lage(a, 2).rot - 1) < 1e-9, 'Eigendrehung = drehung · t');
  const still = [{ id: 'a0', x: 5, y: 6, r: 20 }];
  ok(Drift.jetzt(still, 99) === still && Drift.lage(still[0], 50).x === 5, 'ohne Bahn: Liste selbst, Lage = (x, y) (Kampagne unverändert)');
  const L = [a];
  ok(Drift.jetzt(L, 3) === Drift.jetzt(L, 3) && Drift.jetzt(L, 3) !== Drift.jetzt(L, 4), 'jetzt(): je Zeit zwischengespeichert');
  const hit = Drift.strahlTrifft([{ x: 50, y: 0, r: 10 }], 0, 0, 100, 0);
  ok(hit && Math.abs(hit.t - 0.4) < 1e-9 && !Drift.strahlTrifft([{ x: 50, y: 30, r: 10 }], 0, 0, 100, 0), 'Strahl: erster Schnitt bei t 0,4, daneben kein Treffer');
});

section('drift: erzeugte Bahnen berühren sich nie, Start bleibt frei', () => {
  const g = new Game({ noStore: true, seed: 3, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const loc = Locations.get('splitter');
  const L = space.makeDriftAsteroids(g, loc);
  const L2 = space.makeDriftAsteroids(g, loc);
  ok(L.length >= 30 && L.every((a) => Array.isArray(a.b) && a.b.length === 5), `Splitter bewegt: ${L.length} Brocken mit Bahn (still: ${loc.scene.asteroids})`);
  ok(JSON.stringify(L) === JSON.stringify(L2), 'gleicher Seed -> gleiche Bahnen');
  let minPaar = Infinity, minStart = Infinity;
  const start = loc.scene.arrive;
  for (let t = 0; t < 300; t += 0.5) {
    const P = Drift.jetzt(L, t);
    for (let i = 0; i < P.length; i++) {
      minStart = Math.min(minStart, d2(P[i], start) - P[i].r);
      for (let j = i + 1; j < P.length; j++) minPaar = Math.min(minPaar, d2(P[i], P[j]) - P[i].r - P[j].r);
    }
  }
  ok(minPaar >= 30 - 1e-6, `kleinster Abstand zweier Brocken über 300 s: ${minPaar.toFixed(1)} px (≥ 30)`);
  ok(minStart >= 280, `Startpunkt (Ankunft) über 300 s frei: ${minStart.toFixed(0)} px (≥ 280)`);
  const speeds = L.map((a) => a.b[1]);
  ok(Math.min(...speeds) >= CONFIG.arena.drift.tempo[0] && Math.max(...speeds) <= CONFIG.arena.drift.tempo[1], `Tempo ${Math.min(...speeds)}–${Math.max(...speeds)} px/s laut CONFIG.arena.drift`);
});

section('nebel: Faktor auf dem Server, gleich für Lerche und Gegner', () => {
  const { g } = allSpiel(1, 'nebel');
  const f = CONFIG.sensors.fogFactor;
  ok(g.ship.scene === 'nebel' && space.nebelFaktor(g) === f, `Wellen All Nebel: Faktor ${f}`);
  ok(space.sensorReichweite(g) === CONFIG.sensors.range * f && space.erfassung(g) === CONFIG.tscan.range * f,
    `Sensor ${space.sensorReichweite(g)} (von ${CONFIG.sensors.range}), Zielerfassung ${space.erfassung(g)} (von ${CONFIG.tscan.range})`);
  // Kampagne im Nebel (ohne Wellen All): unverändert, solange nebelServer = 'wellen'
  const k = new Game({ noStore: true, seed: 2, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  space.enterScene(k, 'nebel', { docked: false });
  ok(CONFIG.sensors.nebelServer === 'wellen' && space.nebelFaktor(k) === 1, 'Kampagne im Nebel: Faktor 1 (nebelServer „wellen“)');
  k.C = JSON.parse(JSON.stringify(k.C)); k.C.sensors.nebelServer = 'immer';
  ok(space.nebelFaktor(k) === f, 'nebelServer „immer“: Faktor auch in der Kampagne');
  // Symmetrie: Lerche (Batterie Bb, Reichweite 520) und Gegner (Kanonenboot 500) – im Nebel beide auf 400 begrenzt
  ruhe(g); g.space.enemies = []; g.space.asteroids = [];
  const sh = g.ship; sh.angle = 0;
  const gb = space.spawnEnemy(g, 'gunboat', { x: sh.x, y: sh.y - 450, facing: 0 });   // Backbord der Lerche, Breitseite zur Lerche
  ok(!space.inMountArc(g, 'port', gb.x, gb.y), 'Lerche: Gegner auf 450 px im Nebel außerhalb der Batterie (520 × Erfassung 400)');
  ok(!space.enemyCanHit(g, gb), 'Gegner: Lerche auf 450 px im Nebel außerhalb der Breitseite (500 × Erfassung 400)');
  gb.y = sh.y - 380;
  ok(space.inMountArc(g, 'port', gb.x, gb.y) && space.enemyCanHit(g, gb), 'auf 380 px: beide Seiten treffen');
  gb.y = sh.y - 900;
  ok(space.weaponsTarget(g, gb.id) === 'Ziel außerhalb der Sensoren.', 'Ziel auf 900 px im Nebel nicht aufschaltbar (Sensor 700)');
  gb.y = sh.y - 600;
  ok(space.weaponsTarget(g, gb.id) === null, 'Ziel auf 600 px aufschaltbar');
  ok(/max\. 400, Nebel/.test(space.weaponsScan(g, true) || ''), 'Ziel-Scan auf 600 px: zu weit (max. 400, Nebel)');
  // ohne Nebel (Szene frei): volle Reichweite
  const fr = allSpiel(1, 'frei').g;
  ruhe(fr); fr.space.enemies = [];
  const s2 = fr.ship; s2.angle = 0;
  const gb2 = space.spawnEnemy(fr, 'gunboat', { x: s2.x, y: s2.y - 450, facing: 0 });
  ok(space.nebelFaktor(fr) === 1 && space.inMountArc(fr, 'port', gb2.x, gb2.y) && space.enemyCanHit(fr, gb2), 'Szene frei: 450 px in Reichweite für beide');
  // Ladung des Gegners: im Nebel auf 450 px keine, auf 380 px ja
  const T = CONFIG.spaceM3.tele.gunboat;
  gb.y = sh.y - 450; gb.fireT = 999; gb.angle = 0; gb.retreatUntil = 0;
  g.ship.holdFireUntil = null;
  g.C = JSON.parse(JSON.stringify(g.C)); g.C.spaceM3b.flightV2.arena = false;   // kinematisch, damit die Lage steht
  g.space.enemies = [gb];
  space.update(g, 1 / 30);
  const tele450 = !!gb.tele;
  gb.tele = null; gb.fireT = 999; gb.x = sh.x; gb.y = sh.y - 380; gb.angle = 0;
  space.update(g, 1 / 30);
  ok(T && !tele450 && !!gb.tele, 'Kanonenboot lädt im Nebel erst innerhalb der Zielerfassung (450 nein, 380 ja)');
});

section('brocken: Gegner prallen ab und nehmen Schaden, Geschosse und Strahlen schlagen ein', () => {
  const { g } = allSpiel(1, 'asteroiden');
  ruhe(g); g.space.enemies = [];
  const a = g.space.asteroids[5];
  const e = space.spawnEnemy(g, 'raider', { x: a.x + a.r + 200, y: a.y });
  ok(d2(e, a) >= a.r, 'Spawn nicht im Brocken');
  e.x = a.x + a.r * 0.5; e.y = a.y; e.vx = -80; e.vy = 0;
  const hp0 = e.hp + e.shields.reduce((s, v) => s + v, 0);
  const st0 = (g.stats.brocken && g.stats.brocken.gegner) || 0;
  space.update(g, 1 / 30);
  const hp1 = e.hp + e.shields.reduce((s, v) => s + v, 0);
  ok(d2(e, a) >= a.r + 15, `Gegner hinausgeschoben (Abstand ${d2(e, a).toFixed(0)} px, Radius ${a.r})`);
  ok(hp1 < hp0 && g.stats.brocken.gegner === st0 + 1, 'Gegner nimmt Brocken-Schaden (wie die Lerche)');
  e.x = a.x + a.r * 0.5; e.y = a.y;
  space.update(g, 1 / 30);
  ok(g.stats.brocken.gegner === st0 + 1, 'Sperre je Brocken (asteroidImmunity) gilt auch für Gegner');
  // Geschoss eines Gegners fliegt in einen Brocken
  g.space.projectiles = [{ id: 'prX', kind: 'enemy', x: a.x - a.r - 4, y: a.y, angle: 0, speed: 210, ttl: 4, dmg: 1, owner: e.id }];
  const s0 = g.stats.brocken.schuesse;
  space.update(g, 1 / 30);
  ok(!g.space.projectiles.some((p) => p.id === 'prX') && g.stats.brocken.schuesse === s0 + 1, 'Gegner-Geschoss schlägt im Brocken ein');
  g.space.projectiles = [{ id: 'prY', kind: 'bolzen', x: a.x - a.r - 4, y: a.y, angle: 0, speed: 300, ttl: 3, dmg: 2, target: null }];
  space.update(g, 1 / 30);
  ok(!g.space.projectiles.some((p) => p.id === 'prY') && g.stats.brocken.schuesse === s0 + 2, 'Bolzen der Lerche schlägt im Brocken ein');
  // Lanze: Brocken zwischen Bug und Gegner hält den Strahl auf
  const sh = g.ship;
  sh.x = a.x - a.r - 120; sh.y = a.y; sh.angle = 0;
  g.space.enemies = []; const z = space.spawnEnemy(g, 'raider', { x: a.x + a.r + 80, y: a.y, facing: Math.PI });
  z.x = a.x + a.r + 80; z.y = a.y;
  const tr = space.lanceTrace(g);
  ok(!tr.hit && tr.rock && tr.rock.a.id === a.id, 'Lanze: Brocken im Strahl, Gegner dahinter nicht getroffen');
  // Batterie: Brocken zwischen Rohr und Ziel fängt die Salve
  sh.x = a.x; sh.y = a.y + a.r + 150; sh.angle = 0;   // Backbord (−90°) zeigt nach oben, durch den Brocken
  z.x = a.x; z.y = a.y - a.r - 120;
  const zh = z.hp + z.shields.reduce((s, v) => s + v, 0);
  const b0 = g.stats.brocken.strahlen;
  sh.mount.port.charge = 1;
  g.players[0].console = null;
  space.weaponsFire(g, 'port');
  space.update(g, 1 / 30);   // erster Schuss der Salve (Ziel bewegt sich danach weiter)
  const bm = g.space.beams.find((b) => b.kind === 'battery');
  ok(z.hp + z.shields.reduce((s, v) => s + v, 0) >= zh && g.stats.brocken.strahlen === b0 + 1 && bm && bm.miss && Math.hypot(bm.x2 - a.x, bm.y2 - a.y) <= a.r + 1,
    'Batterie: Schuss endet am Brocken, Ziel unversehrt');
});

section('brocken: Gegner weichen aus (Flugmodell und kinematisch)', () => {
  // Ein Jäger fliegt auf einen Brocken zu; mit Ausweichen weniger Berührungen als die Durchflüge
  const { g } = allSpiel(1, 'asteroiden', { seed: 11 });
  ruhe(g);
  let hits = 0; const runs = 12;
  for (let k = 0; k < runs; k++) {
    g.space.enemies = [];
    const a = g.space.asteroids[k % g.space.asteroids.length];
    const e = space.spawnEnemy(g, 'raider', { x: a.x - 420, y: a.y + (k % 3 - 1) * 8, facing: 0 });
    e.x = a.x - 420; e.y = a.y + (k % 3 - 1) * 8; e.angle = 0; e.vx = 150; e.vy = 0;
    e.pstate = 'overshoot'; e.pT = 0; e.overHead = 0;
    g.ship.x = a.x + 900; g.ship.y = a.y + 600;
    const b0 = (g.stats.brocken && g.stats.brocken.gegner) || 0;
    for (let i = 0; i < 90; i++) space.update(g, 1 / 30);
    hits += ((g.stats.brocken && g.stats.brocken.gegner) || 0) - b0;
  }
  ok(hits <= runs / 2, `Jäger im Flugmodell auf Kollisionskurs: ${hits} Berührungen in ${runs} Anflügen (≤ ${runs / 2})`);
  // kinematisch (Kampagne, flightV2.missions aus): Ziel hinter einem Brocken, Weg führt herum
  const k = new Game({ noStore: true, seed: 4, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  space.enterScene(k, 'splitter', { docked: false });
  k.ship.holdFireUntil = k.time + 1e6;
  const a = k.space.asteroids[3];
  const e = space.spawnEnemy(k, 'sentinel', { x: a.x - 300, y: a.y });
  e.x = a.x - 300; e.y = a.y;
  k.ship.x = a.x + 540; k.ship.y = a.y;   // Wächter will auf 240 px an die Lerche, mitten durch den Brocken
  const b0 = (k.stats.brocken && k.stats.brocken.gegner) || 0;
  for (let i = 0; i < 30 * 12; i++) { space.update(k, 1 / 30); k.ship.x = a.x + 540; k.ship.y = a.y; k.ship.vx = 0; k.ship.vy = 0; }
  ok(((k.stats.brocken && k.stats.brocken.gegner) || 0) - b0 <= 1 && e.x > a.x, `Wächter (kinematisch) umfliegt den Brocken (Berührungen ${((k.stats.brocken && k.stats.brocken.gegner) || 0) - b0}, jetzt x ${Math.round(e.x - a.x)} px hinter der Mitte)`);
});

section('lobby: Szenenwahl, Start frei von Brocken, bewegte Brocken im Snapshot nur als Parameter', () => {
  for (const z of CONFIG.arena.szenen) {
    const { g } = allSpiel(1, z.id);
    const snapL = g.phase === 'play';
    const loc = Locations.get(z.ort);
    const rocks = space.brocken(g);
    const minD = rocks.length ? Math.min(...rocks.map((a) => d2(a, g.ship) - a.r)) : Infinity;
    ok(snapL && g.ship.scene === z.ort && g.arena.szene === z.id && g.arena.kind === 'arena_space' && g.arena.wellen && g.arena.wellen.karte === 'all:' + z.id,
      `${z.id}: Ort ${loc.id}, Wellen-Ablauf läuft (karte all:${z.id})`);
    ok(minD > CONFIG.flight.radius + 100, `${z.id}: Start frei von Brocken (${minD === Infinity ? 'keine' : Math.round(minD) + ' px'})`);
    if (z.brocken === false) ok(g.space.asteroids.length === 0, `${z.id}: ohne Brocken`);
    if (z.brocken === 'bewegt') {
      ok(g.space.asteroids.every((a) => a.b), `${z.id}: jeder Brocken hat Bahnparameter`);
      // 15er-Schema: Brocken nur alle asteroidSnapEvery Snapshots, und dann nur Parameter (x, y = Bahnmitte)
      let mit = 0, ohne = 0, gleich = true; let erst = null;
      for (let i = 0; i < 60; i++) {
        g.step(); if (!g.wantsSnapshot()) continue;
        const s = g.snapshot();
        if (s.space.asteroids) { mit++; const j = JSON.stringify(s.space.asteroids); if (erst == null) erst = j; else if (j !== erst) gleich = false; } else ohne++;
      }
      ok(mit >= 1 && mit <= Math.ceil((mit + ohne) / CONFIG.net.asteroidSnapEvery) + 1, `${z.id}: Brocken im 15er-Schema (${mit} von ${mit + ohne} Snapshots)`);
      ok(gleich, `${z.id}: gesendete Brocken ändern sich nicht (nur Parameter, Lage rechnet der Client)`);
    }
  }
  const g = allSpiel(1, 'nebel').g;
  ok(g.phase === 'play', 'Start ok');
  const lob = new Game({ noStore: true, seed: 1, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  lob.addConnection(c); lob.handleMessage(c, { t: 'hello', clientId: 'L', name: 'L', color: 0 });
  lob.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space', szene: 'asteroiden_bewegt' });
  ok(lob.snapshot().lobby.szene === 'asteroiden_bewegt', 'Snapshot lobby.szene');
  lob.handleMessage(c, { t: 'lobbyOpt', szene: 'gibtsnicht' });
  ok(lob.lobbyOpts.szene === 'asteroiden_bewegt', 'unbekannte Szene wird ignoriert');
  lob.handleMessage(c, { t: 'lobbyOpt', szene: null });
  ok(lob.lobbyOpts.szene === null && !('szene' in lob.snapshot().lobby), 'szene null = Altweg (Feld fehlt)');
  const alt = allSpiel(1, null).g;
  ok(alt.arena && !alt.arena.wellen && alt.arena.wave === 0 && alt.ship.scene === CONFIG.arena.spaceScene, 'ohne Szene: Altweg Testgelände Raumkampf (feste Wellen)');
});

section('ablauf: Welle, Pause, Ende beim Notfallprotokoll, Ergebnis, Lobby', () => {
  const { g, events, S } = allSpiel(1, 'asteroiden_bewegt', { seed: 9 });
  const C = CONFIG.wellen;
  ok(S().ph === 'countdown' && g.snapshot().wellen && g.snapshot().wellen.k === 'all:asteroiden_bewegt', 'Countdown, Snapshot wellen.k = all:<szene>');
  g.step();
  ok(/Welle 1 in \d+ s/.test((g.snapshot().mission.objectives || []).map((o) => o.text).join(' ')), 'Zielanzeige zeigt den Countdown');
  ruhe(g);
  for (let i = 0; i < 30 * (C.countdown + 1); i++) g.step();
  const soll = Wellen.anzahl(CONFIG.wellen.all, 1, 1);
  ok(S().ph === 'kampf' && S().n === 1 && S().gesamt === soll && events('welle').length === 1, `Welle 1: ${soll} Gegner (aus der Tabelle)`);
  // alle abschießen (Spieler an der Taktik bekommt die Abschüsse)
  g.players[0].console = 'weapons';
  for (const e of g.space.enemies.slice()) space.damageEnemy(g, e, 999, null, null);
  for (let i = 0; i < 30; i++) g.step();
  ok(S().ph === 'pause' && S().abschuesse === soll && S().kills[g.players[0].id] === soll && events('welleGeschafft').length === 1, `Pause nach Welle 1, ${soll} Abschüsse für die Taktik`);
  for (let i = 0; i < 30 * (C.pause + 1); i++) g.step();
  ok(S().n === 2 && S().ph === 'kampf', 'Welle 2 beginnt nach der Pause');
  // Notfallprotokoll -> Ende
  g.ship.hull = 0;
  for (let i = 0; i < 30 * (C.endeNach + 1); i++) g.step();
  const ende = events('wellenEnde');
  ok(S().ph === 'ende' && ende.length === 1 && ende[0].welle === 2 && ende[0].karte === 'all:asteroiden_bewegt' && ende[0].brocken, 'Notfallprotokoll beendet die Runde (Ergebnis mit Welle und Brocken-Treffern)');
  ok(g.space.enemies.every((e) => e.retreatUntil > g.time + 1000), 'Ende: Gegner drehen ab');
  for (let i = 0; i < 30 * (C.ergebnisZeit + 1); i++) g.step();
  ok(g.phase === 'lobby' && g.lobbyOpts.szene === 'asteroiden_bewegt', 'nach der Ergebnisanzeige zurück in der Lobby (Szene bleibt gewählt)');
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('planAll: Eskalation nur über Zahl und Typ', () => {
  const A = CONFIG.wellen.all;
  let neuOk = true, anzahlOk = true, jaegerOk = true, pylonOk = true, typOk = true;
  for (let w = 1; w <= 20; w++) for (const sp of [1, 3]) {
    const P = Wellen.planAll(A, w, sp, makeRng(w * 7 + sp));
    if (P.liste.length !== Wellen.anzahl(A, w, sp)) anzahlOk = false;
    const nt = Object.keys(A.typenAb).find((k) => A.typenAb[k] === w && k !== 'raider');
    if ((nt && w > 1) ? P.neu.typ !== nt : !!P.neu.typ) neuOk = false;
    if (P.liste.filter((e) => e.typ === 'raider').length < Math.min(P.liste.length - (P.neu.typ ? 1 : 0), Math.ceil(P.liste.length * A.jaegerAnteil))) jaegerOk = false;
    if (P.liste.filter((e) => e.typ === 'pylon').length > 1) pylonOk = false;
    if (P.liste.some((e) => !(A.typenAb[e.typ] <= w))) typOk = false;
  }
  ok(anzahlOk, `Zahl laut CONFIG.wellen.all.anzahl (W1 solo ${Wellen.anzahl(A, 1, 1)}, W10 zu dritt ${Wellen.anzahl(A, 10, 3)})`);
  ok(neuOk, 'je Welle höchstens ein neuer Typ, in seiner Welle genau angekündigt');
  ok(typOk, 'nur freigeschaltete Typen');
  ok(jaegerOk, `mindestens ${A.jaegerAnteil * 100} % Jäger`);
  ok(pylonOk, 'höchstens ein Pylon je Welle');
});

section('snapshot: Wellen All mit bewegten Brocken im Budget', () => {
  const { g, S } = allSpiel(3, 'asteroiden_bewegt', { seed: 5 });
  g.god = true;
  for (let i = 0; i < 30 * (CONFIG.wellen.countdown + 1); i++) g.step();
  Wellen.debugWelle(g, 12);   // viele Gegner (maxLebend)
  let max = 0, maxAst = 0;
  for (let i = 0; i < 30 * 40; i++) {
    g.step();
    if (!g.wantsSnapshot()) continue;
    const s = g.snapshot(); const b = Buffer.byteLength(JSON.stringify(s));
    if (s.space.asteroids) maxAst = Math.max(maxAst, b); else max = Math.max(max, b);
  }
  ok(S().maxLebend >= CONFIG.wellen.all.maxLebend - 1, `bis zu ${S().maxLebend} Gegner gleichzeitig`);
  ok(Math.max(max, maxAst) <= BUDGET, `Snapshot max ${max} B, mit Brocken ${maxAst} B (Budget ${BUDGET} B)`);
});

console.log(`\ntest-wellen-all: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
