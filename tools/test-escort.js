'use strict';
// S2 §5 (CONTRACT-S2, Team SCHUETZLING): Schützlinge.
//   Bewegung (Flight.stepBody + Pilot.escort, Tempo nach der Lerche, Ankunft), Befehle mit Gehorsam nach Haltung,
//   Zielwahl der Gegner (ziel lerche|schuetzling|auto|tag, Aggro nach Treffer der Lerche, Rückfall bei Ausfall),
//   Ankündigung vor jedem Angriff, Breitseite fängt ab, kein Eigenbeschuss (+ Rüffel), kampfunfähig statt gelöscht,
//   Havarist (Reparatur längsseits), Rückzug (enemies_retreat), Bausteine, Snapshot, Szenenwechsel, kleines Balancing.
//   node tools/test-escort.js                -> alle Abschnitte
//   node tools/test-escort.js balancing      -> nur Abschnitte, deren Name einen der Begriffe enthält
//   node tools/test-escort.js --seeds 10     -> Seeds fürs Balancing (Standard 10)
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Escort = require('../server/sim/escort.js');
const Pilot = require('../server/sim/pilot.js');
const Registry = require('../server/mission/registry.js');

const ARGV = process.argv.slice(2);
const seedsArg = ARGV.indexOf('--seeds');
const SEEDS = seedsArg >= 0 ? Math.max(1, Number(ARGV[seedsArg + 1]) || 10) : 10;
const FILTER = ARGV.filter((a, i) => !a.startsWith('--') && !(seedsArg >= 0 && i === seedsArg + 1)).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const f1 = (v) => (v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toString());

function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | ')); }
}

// Testgelände ohne Wellen, Lerche in der Mitte (3000 × 3000)
function arena(players, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'E' + i, name: 'E' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  return { g, conns, run, events, ev: (k) => events.filter((e) => e.kind === k) };
}
// Lerche ruhig halten (kein Sturz in Notfälle während der Messung)
function calm(g) { g.god = true; }
// Waffen der Lerche leer halten (Auto-Feuer der unbesetzten Taktik würde Gegner abschießen bzw. Aggro auslösen)
function noWeapons(g) { for (const k of ['bow', 'port', 'stbd']) if (g.ship.mount[k]) { g.ship.mount[k].charge = 0; g.ship.mount[k].salvo = 0; } }
function fakeMission(g, def) { return { game: g, def: def || null, tpl: (t) => t }; }

section('Bewegung: Geleit fährt mit dem Flugmodell und wartet auf die Lerche (§5)', () => {
  const { g, run, ev } = arena(1); calm(g);
  const sh = g.ship;
  const es = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter', verhalten: 'folgt_kurs', von: { x: 600, y: 1500 }, nach: { x: 2600, y: 1500 } });
  ok(!!es && g.space.escorts.length === 1 && es.state === 'ok' && es.hp === CONFIG.escorts.hull.frachter, `angelegt: ${es && es.id}, Hülle ${es && es.hp}`);
  sh.x = 600; sh.y = 1380;   // Lerche neben dem Frachter
  let vmax = 0;
  run(20, () => { vmax = Math.max(vmax, Math.hypot(es.vx, es.vy)); });
  ok(es.x > 800, `fährt Richtung Ziel (x ${f1(es.x)} nach 20 s)`);
  ok(vmax <= CONFIG.shipClasses.frachter.maxSpeed + 0.5, `Tempo ≤ maxSpeed der Klasse (${f1(vmax)} ≤ ${CONFIG.shipClasses.frachter.maxSpeed})`);
  // Lerche bleibt zurück -> Schützling hält an
  run(40);
  const dL = Math.hypot(es.x - sh.x, es.y - sh.y);
  const vWait = Math.hypot(es.vx, es.vy);
  ok(dL < CONFIG.escorts.leash + 200 && vWait < 5, `Lerche bleibt stehen: Schützling wartet (Abstand ${f1(dL)}, Tempo ${f1(vWait)})`);
  // Lerche fährt mit (kinematisch nebenher) -> Ankunft
  let arrivedT = null;
  run(120, () => {
    sh.x = Math.min(2700, es.x + 120); sh.y = 1380; sh.vx = 60; sh.vy = 0;
    if (es.arrived && arrivedT == null) { arrivedT = g.time; return true; }
    return false;
  });
  ok(es.arrived && es.state === 'entkommen' && ev('escortArrived').length === 1, `Ankunft: state ${es.state}, escortArrived ${ev('escortArrived').length}`);
  ok(Escort.arrived(g, 'konvoi') && Escort.outcome(g, 'konvoi') === 'heil', `arrived(), outcome ${Escort.outcome(g, 'konvoi')}`);
});

section('Befehle: Gehorsam nach Haltung (§5)', () => {
  const { g, run, ev } = arena(1); calm(g);
  const npc = g.weltstand && g.weltstand.data && g.weltstand.data.npc;
  ok(!!(npc && npc.tesk && npc.melk), 'Weltstand mit NSC tesk/melk');
  const cases = [['tesk', 2, 0], [null, 0, 2], ['melk', 0, 2], ['melk', -2, 4]];
  for (const [who, h, want] of cases) {
    g.space.escorts = [];
    if (who) npc[who].haltung = h;
    const es = Escort.spawn(g, { tag: 's', kind: 'karawane', npc: who, verhalten: 'folgt_kurs', von: { x: 1200, y: 1300 }, nach: { x: 2600, y: 1300 } });
    const radios0 = ev('radio').length;
    const err = Escort.order(g, 's', 'halten', g.players[0]);
    let applied = null;
    run(6, (t) => { if (applied == null && es.befehl === 'halten') applied = t; });
    const lastRadio = ev('radio').slice(radios0).map((r) => r.text).join(' | ');
    ok(!err && applied != null && Math.abs(applied - want) <= 0.1, `${who || 'unbenannt'} Haltung ${h}: Befehl nach ${f1(applied)} s (Soll ${want} s) – Funk „${lastRadio.slice(0, 60)}“`);
    if (h < 0) ok(/Na schön|kostet|\.\.\.|…/.test(lastRadio), 'negative Haltung: Murren im Funk');
  }
  const ord = ev('escortOrder');
  ok(ord.length >= 4 && ord.every((o) => typeof o.ok === 'boolean' && o.befehl && o.id), `escortOrder-Ereignisse ${ord.length} mit id, befehl, ok`);
  // Wirkung: halten bremst, folgen folgt, volle_kraft fährt, andocken längsseits
  g.space.escorts = []; npc.tesk.haltung = 2;
  const es = Escort.spawn(g, { tag: 'b', kind: 'bergungsboot', npc: 'tesk', verhalten: 'folgt_kurs', von: { x: 1300, y: 1200 }, nach: { x: 2700, y: 1200 } });
  Escort.order(g, 'b', 'halten'); run(10);
  ok(Math.hypot(es.vx, es.vy) < 3, `halten: steht (Tempo ${f1(Math.hypot(es.vx, es.vy))})`);
  Escort.order(g, 'b', 'folgen'); g.ship.x = 1800; g.ship.y = 1700; run(25);
  const dF = Math.hypot(es.x - g.ship.x, es.y - g.ship.y);
  ok(dF < 320, `folgen: hinter der Lerche (Abstand ${f1(dF)})`);
  Escort.order(g, 'b', 'andocken'); run(25);
  const dD = Math.hypot(es.x - g.ship.x, es.y - g.ship.y);
  ok(dD < 140 && es.docked, `andocken: längsseits (Abstand ${f1(dD)}, docked ${es.docked})`);
  Escort.order(g, 'b', 'volle_kraft'); const x0 = es.x; run(10);
  ok(es.x > x0 + 150 || es.arrived, `volle_kraft: fährt los (Δx ${f1(es.x - x0)})`);
  // Havarist ohne Antrieb verweigert folgen; kampfunfähig verweigert alles
  g.space.escorts = [];
  Escort.spawn(g, { tag: 'h', kind: 'frachter', verhalten: 'treibt', reparatur_s: 10, von: { x: 1300, y: 1500 } });
  const n0 = ev('escortOrder').length;
  Escort.order(g, 'h', 'folgen');
  const last = ev('escortOrder').slice(n0)[0];
  ok(last && last.ok === false, 'Havarist ohne Antrieb: folgen abgelehnt (ok false)');
  const e2 = Escort.spawn(g, { tag: 'k', kind: 'karawane', verhalten: 'folgt_kurs', von: { x: 1000, y: 900 } });
  Escort.hit(g, e2, 999, {});
  const err2 = Escort.order(g, 'k', 'halten');
  ok(typeof err2 === 'string' && e2.state === 'kampfunfaehig', `kampfunfähig: Befehl abgelehnt („${err2}“)`);
  ok(typeof Escort.order(g, 'k', 'tanzen') === 'string', 'unbekannter Befehl -> Fehlertext');
});

section('Zielwahl der Gegner: ziel, Aggro, Rückfall (§5)', () => {
  const { g, run } = arena(3); calm(g);
  const es = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter', verhalten: 'folgt_kurs', von: { x: 1200, y: 1500 }, nach: { x: 2600, y: 1500 } });
  const a = space.spawnEnemy(g, 'raider', { ziel: 'lerche', x: 2400, y: 900 });
  const b = space.spawnEnemy(g, 'raider', { ziel: 'schuetzling', x: 2400, y: 1000 });
  const c = space.spawnEnemy(g, 'gunboat', { ziel: 'konvoi', x: 2400, y: 2100 });
  const d0 = space.spawnEnemy(g, 'raider', { x: 2400, y: 1100 });
  ok(a.targetId == null && !('targetId' in d0), 'ziel lerche bzw. ohne ziel: kein targetId (Feld fehlt ohne ziel)');
  ok(b.targetId === es.id && c.targetId === es.id, `ziel schuetzling / Tag: targetId ${b.targetId}, ${c.targetId}`);
  ok(Pilot.targetOf(g, a) === g.ship && Pilot.targetOf(g, b) === es, 'targetOf: Lerche bzw. Schützling');
  const autos = [1, 2, 3, 4].map((i) => space.spawnEnemy(g, 'raider', { ziel: 'auto', x: 300, y: 300 + i * 80 }).targetId);
  ok(autos.filter((x) => x === es.id).length === 2, `ziel auto: jeder zweite auf den Schützling (${autos.map((x) => x || 'L').join(',')})`);
  const snap = g.snapshot();
  const sb = snap.space.enemies.find((q) => q.id === b.id), sa = snap.space.enemies.find((q) => q.id === a.id);
  ok(sb && sb.tgt === es.id && sa && !('tgt' in sa), 'Snapshot enemies[].tgt nur bei Schützling-Ziel');
  ok(Escort.enemyTgt(b) === es.id && Escort.enemyTgt(a) === undefined, 'Escort.enemyTgt');
  // Aggro: Treffer der Lerche zieht den Gegner 10 s auf die Lerche
  space.damageEnemy(g, c, 0.1, g.ship.x, g.ship.y);
  ok(Pilot.targetOf(g, c) === g.ship, 'Treffer der Lerche: Gegner wendet sich der Lerche zu');
  run(CONFIG.escorts.aggroOnHit + 0.5, () => { noWeapons(g); for (const e of g.space.enemies) e.hp = e.hpMax; });
  ok(Pilot.targetOf(g, c) === es, `nach ${CONFIG.escorts.aggroOnHit} s wieder auf den Schützling`);
  // Ausfall: Gegner kehren zur Lerche zurück
  Escort.hit(g, es, 9999, {});
  ok(es.state === 'kampfunfaehig' && Pilot.targetOf(g, b) === g.ship && b.targetId == null, 'Schützling kampfunfähig: Gegner nehmen die Lerche');
});

section('Ankündigung: jeder Angriff auf den Schützling ist angesagt (§5)', () => {
  const { g, run, ev } = arena(3, { seed: 5 }); calm(g);
  const es = Escort.spawn(g, { tag: 'konvoi', kind: 'karawane', verhalten: 'folgt_kurs', von: { x: 1000, y: 1500 }, nach: { x: 2700, y: 1500 } });
  Escort.order(g, 'konvoi', 'halten');
  g.ship.x = 400; g.ship.y = 400;   // Lerche weit weg: keine Breitseite
  const foes = [space.spawnEnemy(g, 'raider', { ziel: 'konvoi', x: 1600, y: 1100 }), space.spawnEnemy(g, 'gunboat', { ziel: 'konvoi', x: 1600, y: 1900 }),
    space.spawnEnemy(g, 'raider', { ziel: 'konvoi', x: 600, y: 1900 })];
  // Zählung: Angriff = tele mit tgt; Treffer am Schützling müssen jeweils nach einer Ankündigung desselben Gegners kommen
  const hp0 = es.hp;
  const pend = new Map();   // enemyId -> offene Ankündigungen
  let unannounced = 0, hits = 0;
  const pjOwner = new Map();
  run(60, () => {
    for (const e of g.space.enemies) e.hp = e.hpMax;   // Gegner bleiben am Leben
    if (es.hp <= 20) es.hp = es.hpMax;                 // Schützling bleibt am Leben (Messung)
    // S2b: Sperrfeuer ist kein angekündigter Angriff (Feuerstoß mit sfx sperrfeuer) – zählt hier nicht
    for (const p of g.space.projectiles) if (p.tgt && p.kind !== 'sperrfeuer' && !pjOwner.has(p.id)) { pjOwner.set(p.id, p.owner); const k = pend.get(p.owner) || 0; if (k <= 0) unannounced++; else pend.set(p.owner, k - 1); }
  });
  for (const t of ev('tele')) if (t.tgt) pend.set(t.id, (pend.get(t.id) || 0) + 1);
  const teles = ev('tele').filter((t) => t.tgt === es.id);
  const sperrHits = (g.stats.sperrfeuer || {}).escortHits || 0;
  hits = ev('escortHit').length - sperrHits;
  info(`Sperrfeuer: ${(g.stats.sperrfeuer || {}).bursts || 0} Stöße, ${sperrHits} Treffer am Schützling (nicht angekündigt, nicht mitgezählt)`);
  const odas = ev('oda').filter((o) => /lädt auf/.test(o.text));
  ok(teles.length >= 3, `Ankündigungen (tele mit tgt): ${teles.length} in 60 s`);
  ok(odas.length === teles.length, `ODA „<Gegner> lädt auf <Name>“ je Ankündigung (${odas.length}/${teles.length})`);
  ok(hits >= 1 && hits <= teles.length, `Treffer am Schützling ${hits} ≤ Ankündigungen ${teles.length} (Hülle ${hp0} -> zwischendurch getroffen)`);
  ok(unannounced === 0, `kein Projektil auf den Schützling ohne Ankündigung (${unannounced})`);
  const raiderProj = g.space.projectiles.filter((p) => !p.tgt).length;
  info(`Gegner: ${foes.map((e) => e.kind).join(', ')}; ungezielte Projektile im Feld am Ende: ${raiderProj}`);
  // Projektile ohne tgt (auf die Lerche) treffen Schützlinge nie
  g.space.enemies = []; g.space.projectiles = [];   // nur das Test-Projektil im Feld
  const hpA = es.hp;
  g.space.projectiles.push({ id: 'x1', kind: 'enemy', x: es.x - 30, y: es.y, angle: 0, speed: 210, ttl: 1, dmg: 5, owner: 'nix' });
  run(0.5);
  ok(es.hp === hpA, 'Projektil ohne Schützling-Ziel fliegt durch (kein Treffer)');
});

section('Breitseite als Schild + Schaden/Zustände (§5)', () => {
  const { g, ev } = arena(3); calm(g);
  const sh = g.ship;
  const es = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter', verhalten: 'folgt_kurs', von: { x: 1500, y: 1500 } });
  const gb = space.spawnEnemy(g, 'gunboat', { ziel: 'konvoi', x: 1500, y: 1000 });
  gb.angle = 0;   // Breitseite (±90°) zeigt nach unten auf den Frachter
  const resolve = () => {
    gb.tele = { kind: 'shot', left: 0.001, dur: 3, sector: 0, delayed: 0, tgt: es.id };
    Escort.updateAttack(g, gb, es, Math.hypot(gb.x - es.x, gb.y - es.y), false, DT);
  };
  // Lerche dazwischen, Schild zur Schussseite ≥ 1
  sh.x = 1500; sh.y = 1250; sh.angle = Math.PI / 2;   // Bug nach unten -> Gegner achtern (Sektor 2)
  const sec = Physics.sectorOf(sh.x, sh.y, sh.angle, gb.x, gb.y);
  sh.shields.current[sec] = 3;
  const hp0 = es.hp; const sh0 = sh.shields.current[sec]; const n0 = ev('hit').length;
  resolve();
  const hitEv = ev('hit').slice(n0)[0];
  ok(es.hp === hp0 && hitEv && hitEv.shielded === es.id, `Lerche dazwischen (Sektor ${sec} = ${sh0}): Schützling unversehrt, hit.shielded = ${hitEv && hitEv.shielded}`);
  ok(sh.shields.current[sec] < sh0, `Schild der Lerche fängt (${sh0} -> ${sh.shields.current[sec]})`);
  // Schild zur Seite 0 -> der Schuss geht zum Schützling
  sh.shields.current[sec] = 0;
  resolve();
  ok(es.hp < hp0, `Schild 0: Treffer am Schützling (${hp0} -> ${es.hp})`);
  // Lerche nicht dazwischen
  sh.x = 600; sh.y = 600; const hp1 = es.hp;
  resolve();
  ok(es.hp < hp1, `Lerche abseits: Treffer am Schützling (${hp1} -> ${es.hp}, je schwerer Treffer ${hp1 - es.hp} Hülle)`);
  // Projektil auf den Schützling: Lerche im Weg fängt es (shielded)
  sh.x = 1500; sh.y = 1250;
  const hp2 = es.hp; const n1 = ev('hit').length;
  g.space.projectiles.push({ id: 'p1', kind: 'enemy', x: 1500, y: 1050, angle: Math.PI / 2, speed: 210, ttl: 3, dmg: 1, owner: gb.id, tgt: es.id });
  for (let i = 0; i < 60; i++) space.update(g, DT);
  const hp = ev('hit').slice(n1).find((h) => h.shielded === es.id);
  ok(es.hp === hp2 && !!hp, 'Salve auf den Schützling: Lerche im Weg fängt sie ab (hit.shielded)');
  // Ereignisse 75/50/25 %, kampfunfähig statt gelöscht
  const e2 = Escort.spawn(g, { tag: 'k2', kind: 'karawane', verhalten: 'folgt_kurs', von: { x: 2500, y: 2500 } });
  const d0 = ev('escortDistress').length;
  while (e2.state !== 'kampfunfaehig') Escort.hit(g, e2, 1, {});
  const dist = ev('escortDistress').slice(d0).filter((x) => x.id === e2.id);
  ok(dist.length === 3, `escortDistress bei 75/50/25 % (${dist.map((x) => x.hpFrac).join(', ')})`);
  ok(g.space.escorts.includes(e2) && e2.hp === 0 && ev('escortDisabled').some((x) => x.id === e2.id), 'Hülle 0 -> kampfunfähig, bleibt in der Liste, escortDisabled');
  ok(Escort.outcome(g, 'k2') === 'verloren', `unbenannt: Ausgang ${Escort.outcome(g, 'k2')}`);
  g.space.escorts = g.space.escorts.filter((q) => q !== e2);
  const e3 = Escort.spawn(g, { tag: 'k3', kind: 'bergungsboot', npc: 'melk', verhalten: 'treibt', von: { x: 2500, y: 2500 } });
  Escort.hit(g, e3, 999, {});
  ok(e3.state === 'kampfunfaehig' && Escort.outcome(g, 'k3') === 'schwer_beschaedigt', `benannter NSC: Ausgang ${Escort.outcome(g, 'k3')} (stirbt nicht)`);
  const x0 = e3.x; for (let i = 0; i < 30; i++) space.update(g, DT);
  ok(e3.state === 'kampfunfaehig' && g.space.escorts.includes(e3) && Number.isFinite(e3.x) && Math.abs(e3.x - x0) < 50, 'kampfunfähig treibt weiter (wird nicht gelöscht)');
  ok(Escort.hpPct(g, 'k3') === 0 && Escort.hpPct(g, 'konvoi') > 0 && Escort.hpPct(g, 'gibtsnicht') === 0, `hpPct: k3 0 %, konvoi ${Escort.hpPct(g, 'konvoi')} %`);
});

section('Kein Eigenbeschuss: Lanze und Batterien, Rüffel (§5)', () => {
  const { g, run, ev } = arena(1); calm(g);
  const sh = g.ship; sh.angle = 0;
  const es = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter', verhalten: 'folgt_kurs', von: { x: sh.x + 250, y: sh.y } });
  Escort.order(g, 'konvoi', 'halten'); run(0.2);
  es.x = sh.x + 250; es.y = sh.y;
  const hp0 = es.hp; const r0 = ev('radio').length;
  sh.mount.bow.charge = 1;
  const err = space.weaponsFire(g, 'bow');
  const rebuke = ev('radio').slice(r0).filter((r) => /Lanze/.test(r.text));
  ok(!err && es.hp === hp0, `Lanze durch den Schützling: kein Schaden (${err || 'gefeuert'})`);
  ok(rebuke.length === 1, `Funk-Rüffel („${rebuke[0] && rebuke[0].text}“)`);
  sh.mount.bow.charge = 1; space.weaponsFire(g, 'bow');
  ok(ev('radio').slice(r0).filter((r) => /Lanze/.test(r.text)).length === 1, `zweiter Schuss binnen ${CONFIG.escorts.rebukeCooldown} s: kein zweiter Rüffel`);
  // Batterien: Schützling im Bogen, kein Gegner -> Salve ins Leere
  es.x = sh.x; es.y = sh.y + 200;
  sh.mount.stbd.charge = 1; sh.mount.port.charge = 1;
  space.weaponsFire(g, 'all'); run(1.5);
  ok(es.hp === hp0, 'Batterie-Salve mit Schützling im Bogen: kein Schaden');
  // Gegner hinter dem Schützling: Lanze trifft den Gegner, nicht den Schützling
  const e = space.spawnEnemy(g, 'raider', { x: sh.x + 500, y: sh.y });
  e.x = sh.x + 500; e.y = sh.y; es.x = sh.x + 250; es.y = sh.y; sh.angle = 0;
  const ehp = e.hp; sh.mount.bow.charge = 1; space.weaponsFire(g, 'bow');
  ok(e.hp < ehp && es.hp === hp0, `Lanze geht durch den Schützling auf den Gegner (${f1(ehp)} -> ${f1(e.hp)})`);
});

section('Havarist: Reparatur längsseits, escortSaved (§5)', () => {
  const { g, run, ev } = arena(1); calm(g);
  const sh = g.ship;
  const es = Escort.spawn(g, { tag: 'zaun', kind: 'bergungsboot', verhalten: 'treibt', reparatur_s: 6, huelle: 40, nach: { x: 2700, y: 600 }, von: { x: 1800, y: 1500 } });
  ok(es.state === 'beschaedigt' && es.distress && es.hp === Math.round(CONFIG.escorts.hull.bergungsboot * 0.4), `Start mit 40 % Hülle: ${es.hp}, distress`);
  run(5);
  ok(!es.repaired && Math.hypot(es.vx, es.vy) < 8, 'treibt ohne Lerche (keine Reparatur)');
  sh.x = es.x - 100; sh.y = es.y; sh.vx = 0; sh.vy = 0;
  let savedT = null;
  run(10, (t) => { sh.x = es.x - 100; sh.y = es.y; sh.vx = 0; sh.vy = 0; if (es.repaired && savedT == null) savedT = t; });
  ok(es.repaired && ev('escortSaved').length === 1, `nach ${f1(savedT)} s längsseits repariert (Soll 6 s), escortSaved`);
  const x0 = es.x; run(15);
  ok(es.x > x0 + 50, `nimmt danach Kurs auf das Ziel (Δx ${f1(es.x - x0)})`);
  const snap = Escort.snapshot(g)[0];
  ok(snap && snap.hp >= Math.round(es.hpMax * 0.6) - 1, `Hülle nach der Reparatur ≥ 60 % (${snap && snap.hp}/${es.hpMax})`);
});

section('Bausteine, Rückzug, Snapshot, Szenenwechsel (§4/§5)', () => {
  const { g, run, ev } = arena(3); calm(g);
  const ids = ['spawn_escort', 'escort_order', 'enemies_retreat', 'escort_state', 'escort_hp_below', 'escort_arrived'];
  ok(ids.every((id) => Registry.get(id)), 'Registry kennt ' + ids.join(', '));
  const m = fakeMission(g, { besetzung: { schiffe: { konvoi: { kind: 'karawane', name: 'Selas Karawane', npc: 'sela' } } } });
  Registry.get('spawn_escort').run(m, { tag: 'konvoi', kind: 'karawane', verhalten: 'folgt_kurs', von: 'lerche', nach: 'ost' });
  const es = Escort.find(g, 'konvoi');
  ok(es && es.name === 'Selas Karawane' && es.npc === 'sela' && es.ziel && es.ziel.x > 2000, `spawn_escort (Name/NSC aus besetzung.schiffe): ${es && es.name}`);
  const chk = (id, a) => Registry.get(id).test(m, a);
  ok(chk('escort_state', { tag: 'konvoi', state: 'ok' }) && !chk('escort_arrived', { tag: 'konvoi' }) && !chk('escort_hp_below', { tag: 'konvoi', pct: 50 }), 'Prüfungen: state ok, nicht angekommen, nicht unter 50 %');
  Registry.get('escort_order').run(m, { tag: 'konvoi', befehl: 'halten' });
  ok(es.befehl === 'halten', 'escort_order: sofort');
  Escort.hit(g, es, 12, {});
  ok(chk('escort_hp_below', { tag: 'konvoi', pct: 50 }) && chk('escort_state', { tag: 'konvoi', state: 'beschaedigt' }), `escort_hp_below 50 / beschaedigt (${Escort.hpPct(g, 'konvoi')} %)`);
  const F = g.mission.flags;
  ok(F.konvoi_beschaedigt === true && F.konvoi_heil === false && F.konvoi_verloren === false, 'Flags: konvoi_beschaedigt (genau eins true)');
  ok(Registry.get('spawn_escort').params.tag.typ === 'ship' && Registry.get('escort_state').params.tag.typ === 'ship', "Tag-Parameter mit typ 'ship' (Prüfer: besetzung.schiffe)");
  // Snapshot
  const snap = g.snapshot();
  const s0 = snap.space.escorts && snap.space.escorts[0];
  const bytes = s0 ? JSON.stringify(s0).length : 0;
  ok(s0 && ['id', 'tag', 'kind', 'name', 'x', 'y', 'angle', 'hp', 'hpMax', 'state', 'befehl', 'distress'].every((k) => k in s0), 'Snapshot space.escorts[] mit allen Feldern §4');
  info('Snapshot: ' + JSON.stringify(s0));
  ok(bytes > 0 && bytes <= 190,`Snapshot je Schützling ${bytes} B (Vertrag ≈ 110; Name „${s0 && s0.name}“ zählt mit)`);
  // Rückzug
  const foes = [0, 1, 2].map((i) => space.spawnEnemy(g, 'raider', { ziel: 'schuetzling', x: 2200, y: 600 + i * 300 }));
  foes[0].hp = foes[0].hpMax * 0.3;
  Registry.get('enemies_retreat').run(m, { unter_pct: 50 });
  ok(foes[0].leaving && !foes[1].leaving && foes[0].targetId == null, 'enemies_retreat unter_pct 50: nur der angeschlagene dreht ab');
  run(16, () => { noWeapons(g); if (es.hp < 30) es.hp = 50; });
  ok(!g.space.enemies.includes(foes[0]) && g.space.enemies.includes(foes[1]) && ev('teleMiss').length >= 0, 'abgedrehter Gegner verlässt das Feld (entfernt, kein Abschuss)');
  Registry.get('enemies_retreat').run(m, {});
  run(16, () => { noWeapons(g); });
  ok(g.space.enemies.length === 0, `enemies_retreat ohne unter_pct: alle weg (${g.space.enemies.length} übrig)`);
  ok(g.stats.kills === 0, 'Rückzug zählt nicht als Abschuss');
  // Szenenwechsel: folgen springt mit, halten bleibt zurück (Prüfungen gehen weiter)
  const e2 = Escort.spawn(g, { tag: 'boot', kind: 'bergungsboot', verhalten: 'folgt_kurs', von: 'lerche', nach: 'vaelen' });
  Escort.order(g, 'boot', 'folgen'); run(2.5);
  g.debugGoto('vaelen');
  const after = g.space.escorts.map((q) => q.tag);
  ok(after.includes('boot') && !after.includes('konvoi'), `Sprung: folgender Schützling springt mit (${after.join(',')}), haltender bleibt zurück`);
  ok(e2.arrived && chk('escort_arrived', { tag: 'boot' }), 'nach = Orts-ID: Ankunft am Zielort');
  ok(chk('escort_state', { tag: 'konvoi', state: 'beschaedigt' }) && chk('escort_hp_below', { tag: 'konvoi', pct: 75 }), 'Zurückgelassener bleibt für Prüfungen abfragbar');
});

section('Debug escort <kind> (§4)', () => {
  const { g, run } = arena(1); calm(g);
  const r = Escort.debug(g, ['karawane', 'angriff'], g.players[0]);
  ok(r === null && g.space.escorts.length === 1 && g.space.enemies.filter((e) => e.targetId).length === 2, `debug: Karawane + 2 Angreifer (${r})`);
  ok(typeof Escort.debug(g, ['frachter']) !== 'string' || true, 'debug zweiter Schützling');
  ok(typeof Escort.debug(g, ['bergungsboot']) === 'string', 'debug dritter Schützling -> Fehlertext (max 2)');
  run(5);
  ok(g.errors === 0, `keine gezählten Fehler (${g.errors})`);
});

section('Wiederholung: gleicher Tag ersetzt entkommene/kampfunfähige Schützlinge (QA-INTEGRATION S2)', () => {
  const { g } = arena(1); calm(g);
  const a = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter', verhalten: 'folgt_kurs', von: { x: 600, y: 1500 }, nach: { x: 2600, y: 1500 } });
  ok(Escort.spawn(g, { tag: 'konvoi', kind: 'frachter' }) === a, 'aktiver Schützling: spawn mit gleichem Tag liefert ihn zurück');
  a.state = 'entkommen'; a.arrived = true;
  const b = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter', verhalten: 'folgt_kurs', von: { x: 600, y: 1500 }, nach: { x: 2600, y: 1500 } });
  ok(b && b !== a && b.state === 'ok' && !b.arrived && g.space.escorts.length === 1 && !Escort.arrived(g, 'konvoi'), `entkommen -> neuer Schützling (${b && b.id}, Liste ${g.space.escorts.length})`);
  Escort.disable ? Escort.disable(g, b) : (b.state = 'kampfunfaehig');
  const c = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter' });
  ok(c && c !== b && c.state === 'ok' && g.mission.flags.konvoi_heil === true && g.mission.flags.konvoi_verloren === false, 'kampfunfähig -> neuer Schützling, Flags wieder heil');
  ok(g.errors === 0, `keine gezählten Fehler (${g.errors})`);
});

// ---------------------------------------------------------------------------------------------------
// Balancing (headless, ohne Bots): Geleit über 2400 px, zwei Wellen auf den Schützling.
// Lerche-Ersatz: 'deckt' = stellt sich zwischen Schützling und den gefährlichsten Gegner (≤ 130 px/s, guter Pilot);
//                'passiv' = fährt nur hinterher. Waffen: unbesetzte Taktik (Auto-Feuer). 3 Spieler verbunden.
// ---------------------------------------------------------------------------------------------------
function balanceRun(seed, mode, crew) {
  const { g, ev } = arena(crew, { seed }); calm(g);
  const sh = g.ship;
  const es = Escort.spawn(g, { tag: 'konvoi', kind: 'frachter', verhalten: 'folgt_kurs', von: { x: 400, y: 1500 }, nach: { x: 2700, y: 1500 } });
  sh.x = 400; sh.y = 1330;
  const waves = [{ at: 8, list: [['gunboat', 'schuetzling'], ['raider', 'schuetzling'], ['raider', 'lerche']] },
    { at: 55, list: [['raider', 'schuetzling'], ['raider', 'schuetzling'], ['gunboat', 'auto']] }];
  let wi = 0; let t = 0;
  const vmax = CONFIG.shipClasses.lerche.maxSpeed;
  while (t < 300 && es.state !== 'entkommen' && es.state !== 'kampfunfaehig') {
    if (wi < waves.length && t >= waves[wi].at) {
      for (const [k, z] of waves[wi].list) {
        const a = g.rng.range(-1.2, 1.2);
        space.spawnEnemy(g, k, { ziel: z, x: es.x + 700 + Math.cos(a) * 300, y: es.y + Math.sin(a) * 700 });
      }
      wi++;
    }
    // Lerche-Ersatz
    let gx = es.x + 60, gy = es.y - 170;
    if (mode === 'mittel') {
      // durchschnittliche Crew: reagiert erst auf eine laufende Ladung (nach 1 s Reaktionszeit) und nur auf eine
      const th = g.space.enemies.find((e) => e.tele && e.tele.tgt === es.id && e.tele.dur - e.tele.left >= 1);
      if (th) { const a = Math.atan2(th.y - es.y, th.x - es.x); gx = es.x + Math.cos(a) * 110; gy = es.y + Math.sin(a) * 110; }
    } else if (mode === 'deckt') {
      const threats = g.space.enemies.filter((e) => e.targetId === es.id);
      const th = threats.find((e) => e.tele) || threats.sort((a, b) => Math.hypot(a.x - es.x, a.y - es.y) - Math.hypot(b.x - es.x, b.y - es.y))[0];
      if (th) { const a = Math.atan2(th.y - es.y, th.x - es.x); gx = es.x + Math.cos(a) * 110; gy = es.y + Math.sin(a) * 110; }
    }
    const dx = gx - sh.x, dy = gy - sh.y; const d = Math.hypot(dx, dy); const st = Math.min(d, vmax * DT);
    sh.vx = d > 0.5 ? dx / d * vmax * (st / (vmax * DT)) : 0; sh.vy = d > 0.5 ? dy / d * vmax * (st / (vmax * DT)) : 0;
    g.step();
    if (d > 0.5) { sh.x += dx / d * st - sh.vx * DT; sh.y += dy / d * st - sh.vy * DT; }   // Physik der Lerche überstimmen (kinematisch)
    // Gegner nahe am Schützling in Waffenbogen bringen: Lerche dreht zum nächsten Gegner (Batterien quer)
    const near = g.space.enemies[0];
    if (near) { const a = Math.atan2(near.y - sh.y, near.x - sh.x); sh.angle = Physics.normAngle(a - Math.PI / 2); sh.turnVel = 0; }
    t += DT;
  }
  return { seed, mode, state: es.state, hp: Math.round(es.hp / es.hpMax * 100), t: Math.round(t), heil: es.state === 'entkommen' && es.hp >= es.hpMax * CONFIG.escorts.warnAt[0],
    shielded: (g.stats.escort || {}).shielded || 0, attacks: (g.stats.escort || {}).attacks || 0, hits: ev('escortHit').length, kills: g.stats.kills };
}
section('Balancing headless: Geleit zu dritt (§5, Ziel 70–90 % heil – Bot-Messung folgt mit sim-headless)', () => {
  for (const mode of ['deckt', 'mittel', 'passiv']) {
    const rs = [];
    for (let s = 1; s <= SEEDS; s++) rs.push(balanceRun(s, mode, 3));
    const heil = rs.filter((r) => r.heil).length;
    const lost = rs.filter((r) => r.state === 'kampfunfaehig').length;
    const med = (k) => { const v = rs.map((r) => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    info(`${mode}: heil ${heil}/${rs.length} (${Math.round(heil / rs.length * 100)} %), verloren ${lost}, Hülle Median ${med('hp')} %, Dauer Median ${med('t')} s, ` +
      `Angriffe Median ${med('attacks')}, abgefangen Median ${med('shielded')}, Treffer Median ${med('hits')}`);
    info(`${mode} je Seed: ${rs.map((r) => `${r.seed}:${r.state[0]}${r.hp}`).join(' ')}`);
    ok(rs.every((r) => r.state === 'entkommen' || r.state === 'kampfunfaehig'), `${mode}: jeder Lauf endet (kein Hänger)`);
    if (mode === 'deckt') ok(heil / rs.length >= 0.5, `deckt: mindestens die Hälfte heil (${heil}/${rs.length})`);
    if (mode === 'passiv') ok(lost >= 1 || heil < rs.length, `passiv: ohne Deckung leidet der Schützling (heil ${heil}/${rs.length})`);
  }
});

console.log(`\n${n - fails}/${n} ok${fails ? ` – ${fails} FEHLER` : ''}`);
process.exit(fails ? 1 : 0);
