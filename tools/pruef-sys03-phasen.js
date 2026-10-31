'use strict';
// SYS-03 Prüfer: die Phasen von tools/pruef-sys03.js (node tools/pruef-sys03.js <phase> [--shots <Ordner>]), je ein Abnahmepunkt im laufenden System.
const { PHASEN, boot, startFlug, zoneSys, stand, diff, technikTab, sleep, J } = require('./pruef-sys03.js');
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const space = require('../server/sim/space.js');
const I = require('../server/sim/interior.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const SM = CONFIG.systemModell;

function lerchFrisch(g) {
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {}; g.ship.trefferT = {};
  g.ship.shields.current = [0, 0, 0, 0]; Schilde.pause.loeschen(g.ship.shields);
  I.integritaetVoll(g);
}
async function bilder(P, tag) {
  await technikTab(P); await P.shot(tag + '-technik');
  await P.sitz('captain'); await sleep(300); await P.shot(tag + '-captain');
}

// Abnahme 1/2 Lerche
PHASEN.lerche = async () => {
  const P = await boot('2d'); const g = P.game;
  await startFlug(P);
  lerchFrisch(g);
  g.ship.shields.alloc = [0, 0, 0, 0]; g.ship.shields.allocIntent = [0, 0, 0, 0];
  await sleep(500);
  const z = 1; // Steuerbord
  console.log('Zone ' + z + ' Systeme: ' + J(zoneSys(g, z)));
  const v0 = stand(g);
  console.log('SCHILD current=' + J(g.ship.shields.current));
  await bilder(P, 'lerche-0-vorher');
  const s0 = await P.snap(); console.log('SNAP vorher integ=' + J(s0.ship.integ) + ' zonen=' + J(s0.ship.zonen));
  const r1 = space.shipHit(g, z, 1, {}); await sleep(450);
  const v1 = stand(g); console.log('TREFFER 1 (dmg 1):', J(diff(v0, v1)), 'rest=', r1 && r1.rest);
  const s1 = await P.snap(); console.log('SNAP nach 1 integ=' + J(s1.ship.integ) + ' zonen=' + J(s1.ship.zonen));
  await bilder(P, 'lerche-1-nach-treffer1');
  g.time += SM.trefferFenster_s + 0.1;
  const r2 = space.shipHit(g, z, 1, {}); await sleep(450);
  const v2 = stand(g); console.log('TREFFER 2 (dmg 1):', J(diff(v1, v2)));
  const s2 = await P.snap(); console.log('SNAP nach 2 integ=' + J(s2.ship.integ) + ' zonen=' + J(s2.ship.zonen));
  await bilder(P, 'lerche-2-nach-treffer2');
  // Gegenprobe: hoher Schaden soll nicht mehr als eine Stufe machen
  lerchFrisch(g); await sleep(300);
  const w0 = stand(g); space.shipHit(g, 2, 50, {}); await sleep(400);
  console.log('GEGENPROBE dmg 50 auf Heck:', J(diff(w0, stand(g))));
  console.log('FEHLER Browser: ' + J(P.fehler));
  await P.schliessen();
};

// Abnahme 1/2 Gegner + Verbündete
PHASEN.gegner = async () => {
  const P = await boot('2d'); const g = P.game;
  await startFlug(P);
  g.god = true;
  const mk = (kind, ally) => {
    if (!ally) { const e = space.spawnEnemy(g, kind, { x: g.ship.x + 260, y: g.ship.y - 40, facing: 0 }); return e; }
    const es = Flotte.aufstellen(g, { tag: 'v_' + kind, kind }); es.skript = { modus: 'halten' }; es.gestellt = true; es.x = g.ship.x + 260; es.y = g.ship.y - 40; es.angle = 0; es.vx = es.vy = 0; return es;
  };
  const treff = (e, d) => { e.angle = 0; e.vx = 0; e.vy = 0; if (e.facing != null) e.facing = 0; const q = { x: e.x + 300, y: e.y }; if (e.ally) Escort.hit(g, e, d, { von: q }); else space.damageEnemy(g, e, d, q.x, q.y, {}); };
  const zust = (e) => Object.fromEntries(Gsys.ids(e).map((id) => [id, e.sys[id].z]));
  const dif = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} -> ${b[k]}`);
  for (const [kind, ally] of [['fregatte', false], ['korvette', false], ['raider', false], ['kreuzer', false], ['fregatte', true]]) {
    const e = mk(kind, ally);
    await sleep(300);
    // frei: alle Systeme ok, Schild 0
    for (const id of Gsys.ids(e)) { e.sys[id].i = Gsys.maxOf(e, id); e.sys[id].z = 'ok'; delete e.sys[id].sp; delete e.sys[id].imm; delete e.sys[id].tf; delete e.sys[id].rp; }
    e.hp = Gsys.summe(e); e.shieldsMax = e.shieldsMax.map(() => 0); e.shields = e.shields ? e.shields.map(() => 0) : e.shields; if (e.shield) e.shield = e.shield.map(() => 0);
    Schilde.pause.loeschen(e);
    const gesehen = {}; for (const id of Gsys.ids(e)) { const z = Gsys.defOf(e.kind, id).zone; if (z === 'mitte') continue; if (gesehen[z]) { e.sys[id].i = 0; e.sys[id].z = 'broken'; } else gesehen[z] = id; } e.hp = Gsys.summe(e); console.log('je Zone nur 1 System lebt:', J(gesehen));
    const tag = (ally ? 'ally-' : 'gegner-') + kind;
    if (!ally) {
      await P.dbg({ cmd: 'scanall' }); await sleep(300);
      await P.sitz('weapons'); await P.page.evaluate((x) => __game.send({ t: 'cmd', c: 'weapons.target', id: x }), e.id); await sleep(500);
    }
    const a0 = zust(e); console.log(tag, 'id', e.id, 'schilde', J(e.shields || e.shield), 'systeme', J(a0));
    if (!ally) await P.shot(tag + '-0-vorher');
    treff(e, 1); await sleep(450);
    const a1 = zust(e); console.log(tag, 'TREFFER 1:', J(dif(a0, a1)));
    if (!ally) await P.shot(tag + '-1-nach1');
    g.time += 1.6;
    treff(e, 1); await sleep(450);
    const a2 = zust(e); console.log(tag, 'TREFFER 2:', J(dif(a1, a2)));
    if (!ally) await P.shot(tag + '-2-nach2');
    if (!ally) g.space.enemies = g.space.enemies.filter((q) => q !== e);
    g.space.enemies = g.space.enemies.filter((q) => !q.ally || q === e);
  }
  console.log('FEHLER Browser: ' + J(P.fehler));
  await P.schliessen();
};

// Ziel-Scan an einer unversehrten Fregatte (Kasten rechts im Ops-Pult), 2 Treffer ohne Schild
PHASEN.scan = async () => {
  const P = await boot('2d'); const g = P.game;
  await startFlug(P); g.god = true;
  const e = space.spawnEnemy(g, 'fregatte', { x: g.ship.x + 260, y: g.ship.y - 40, facing: 0 });
  await sleep(300);
  for (const id of Gsys.ids(e)) { e.sys[id].i = Gsys.maxOf(e, id); e.sys[id].z = 'ok'; delete e.sys[id].sp; delete e.sys[id].imm; delete e.sys[id].tf; }
  e.hp = Gsys.summe(e); e.shieldsMax = e.shieldsMax.map(() => 0); if (e.shields) e.shields = e.shields.map(() => 0); Schilde.pause.loeschen(e);
  await P.dbg({ cmd: 'scanall' }); await sleep(300);
  await P.sitz('weapons'); await P.page.evaluate((x) => __game.send({ t: 'cmd', c: 'weapons.target', id: x }), e.id); await sleep(500);
  const zust = () => Object.fromEntries(Gsys.ids(e).map((id) => [id, e.sys[id].z]));
  const dif = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} -> ${b[k]}`);
  const clip = { x: 940, y: 4, width: 340, height: 380 };
  const fix = () => { e.angle = 0; e.vx = 0; e.vy = 0; };
  let a = zust(); await P.shot('scan-0-vorher', { clip }); console.log('Schild', J(e.shields), 'Zustand', J(a));
  for (let i = 1; i <= 3; i++) {
    fix(); space.damageEnemy(g, e, 1, e.x + 300, e.y, {}); await sleep(450);
    const b = zust(); console.log('TREFFER ' + i + ':', J(dif(a, b)), ' hp=' + e.hp); a = b;
    await P.shot('scan-' + i + '-nach' + i, { clip }); g.time += 1.6;
  }
  console.log('FEHLER Browser: ' + J(P.fehler));
  await P.schliessen();
};

// Technik-Pult, Tab Energie & Schilde: Legende „Treffer auf einen Sektor“ (ganzes Fenster als Bild)
PHASEN.technik = async () => {
  const P = await boot('2d');
  await startFlug(P);
  await P.sitz('technik'); await P.page.evaluate(() => { if (window.Consoles) Consoles.ttab = 0; }); await P.page.mouse.move(5, 5); await sleep(500);
  await P.shot('technik-energie');
  console.log('FEHLER Browser: ' + J(P.fehler));
  await P.schliessen();
};

// Ziel-Scan mit leeren Zonen (Bug und Backbord zerstört): das Wort LEER darf kein Systemkürzel überdecken
PHASEN.scanleer = async () => {
  const P = await boot('2d'); const g = P.game;
  await startFlug(P); g.god = true;
  const e = space.spawnEnemy(g, 'fregatte', { x: g.ship.x + 260, y: g.ship.y - 40, facing: 0 });
  await sleep(300);
  for (const id of Gsys.ids(e)) { e.sys[id].i = Gsys.maxOf(e, id); e.sys[id].z = 'ok'; delete e.sys[id].sp; delete e.sys[id].imm; delete e.sys[id].tf; }
  e.shieldsMax = e.shieldsMax.map(() => 0); if (e.shields) e.shields = e.shields.map(() => 0); Schilde.pause.loeschen(e);
  for (const id of Gsys.ids(e)) { const z = Gsys.defOf(e.kind, id).zone; if (z === 'bug' || z === 'bb') { e.sys[id].i = 0; e.sys[id].z = 'broken'; } }
  e.hp = Gsys.summe(e);
  await P.dbg({ cmd: 'scanall' }); await sleep(300);
  await P.sitz('weapons'); await P.page.evaluate((x) => __game.send({ t: 'cmd', c: 'weapons.target', id: x }), e.id); await sleep(500);
  e.angle = 0; e.vx = 0; e.vy = 0; await sleep(500);
  await P.shot('scanleer', { clip: { x: 940, y: 4, width: 340, height: 380 } });
  console.log('FEHLER Browser: ' + J(P.fehler));
  await P.schliessen();
};

// Abnahme 4: Regenerationspause, Pool 12, Anzeigen
PHASEN.schild = async () => {
  const P = await boot('2d'); const g = P.game;
  await startFlug(P);
  const SS = g.ship.shields;
  console.log('Konfig shields:', J(g.C.shields), ' power.shields=', g.ship.power.shields, ' pool=', SS.pool, ' alloc=', J(SS.alloc), ' cap=', J(SS.cap));
  // Pool-Anzeige: Technik Tab Energie & Schilde, Pool voll verteilt 3/3/3/3, dann 4/4/0/4
  await P.sitz('technik'); await P.page.evaluate(() => { if (window.Consoles) Consoles.ttab = 0; }); await P.page.mouse.move(5, 5); await sleep(500);
  await P.shot('schild-technik-energie-start');
  const sn = await P.snap(); console.log('SNAP shields', J(sn.ship.shields), 'power', J(sn.ship.power));
  SS.allocIntent = [3, 3, 3, 3]; await sleep(600); await P.shot('schild-technik-energie-3333');
  SS.allocIntent = [8, 4, 0, 0]; await sleep(600); await P.shot('schild-technik-energie-8400');
  SS.allocIntent = [4, 4, 0, 4]; await sleep(600);
  // HUD-Mini / Captain-Streifen
  await P.sitz('captain'); await sleep(400); await P.shot('schild-captain');
  await P.sitz('helm'); await sleep(400); await P.shot('schild-helm');
  // Regeneration messen: current [1,1,0,1], Treffer auf Sektor 1 (dmg 1 -> Schild 0), dann Verlauf
  I.integritaetVoll(g);
  SS.current = [1, 1, 0, 1]; Schilde.pause.loeschen(SS);
  const t0 = g.time;
  space.shipHit(g, 1, 1, {});
  console.log('TREFFER Sektor 1 dmg 1 bei t=0; current direkt danach', J(SS.current), 'delay=', g.C.shields.regenDelay, 'interval=', g.C.shields.regenInterval);
  const rows = [];
  let shotA = false;
  while (g.time - t0 < 14) {
    await sleep(500);
    const t = g.time - t0; rows.push(`t=${t.toFixed(1)}s ${J(SS.current.map((v) => Math.round(v * 100) / 100))}`);
    if (!shotA && t > 2.5) { shotA = true; await P.sitz('captain'); await P.shot('schild-regen-t3-captain'); await P.sitz('technik'); await P.page.evaluate(() => { Consoles.ttab = 0; }); await sleep(300); await P.shot('schild-regen-t3-technik'); }
  }
  console.log(rows.join('\n'));
  // tune: regenDelay auf 1
  const tp = ['shields.regenDelay', 'spaceM3b.shields.regenDelay'];
  for (const path of tp) { await P.dbg({ cmd: 'tune', path, value: '1' }); await sleep(300); console.log('tune', path, '-> regenDelay=', g.C.shields.regenDelay); }
  SS.current = [1, 1, 0, 1]; Schilde.pause.loeschen(SS);
  const t1 = g.time; space.shipHit(g, 1, 1, {});
  const rows2 = [];
  while (g.time - t1 < 6) { await sleep(500); rows2.push(`t=${(g.time - t1).toFixed(1)}s ${J(SS.current.map((v) => Math.round(v * 100) / 100))}`); }
  console.log('Mit regenDelay=' + g.C.shields.regenDelay + ':\n' + rows2.join('\n'));
  console.log('FEHLER Browser: ' + J(P.fehler));
  await P.schliessen();
};

// Abnahme 8: HUD oben rechts (Schiffsinneres, nicht am Pult), 2D und Voxel
PHASEN.hud = async () => {
  for (const render of ['2d', 'voxel']) {
    const P = await boot(render, 3); const g = P.game;
    if (render === 'voxel') await P.page.waitForFunction(() => window.VoxelRender && VoxelRender.ready, null, { timeout: 60000 }).catch(() => console.log('Voxel nicht bereit'));
    await startFlug(P);
    await P.dbg({ cmd: 'marken', n: 137 });
    await P.sitz('captain');
    await P.page.evaluate(() => __game.send({ t: 'cmd', c: 'captain.selectDest', dest: 'splitter' }));
    await sleep(600);
    await P.page.keyboard.press('Escape'); await sleep(800); await P.page.mouse.move(5, 5);
    const info = await P.page.evaluate(() => { const s = __game.state.ship; const me = (__game.state.players || []).find((p) => p.id === __game.state.you) || {}; return { o2inShip: 'o2' in s, keys: Object.keys(s).filter((k) => /o2|huell|hull|sauer/i.test(k)), jump: (s.jump || {}).dest, console: me.console, zone: me.zone }; });
    console.log(render, 'INFO', J(info));
    const box = await P.page.evaluate(() => { const c = document.getElementById('game') || document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    console.log(render, 'Canvas', J(box));
    await P.shot('hud-' + render + '-voll');
    await P.shot('hud-' + render + '-oben-rechts', { clip: { x: box.x + box.w - 330, y: box.y, width: 330, height: 150 } });
    // mit Schildschaden und beschädigtem Reaktor
    for (const s of g.ship.shields.current.keys()) g.ship.shields.current[s] = [2, 0, 0, 3][s];
    await P.dbg({ cmd: 'damage', system: 'reactor', state: 'damaged' }); await P.dbg({ cmd: 'damage', system: 'engines', state: 'broken' }); await sleep(700);
    await P.shot('hud-' + render + '-geschaedigt', { clip: { x: box.x + box.w - 330, y: box.y, width: 330, height: 150 } });
    console.log(render, 'FEHLER Browser: ' + J(P.fehler));
    await P.schliessen();
    await sleep(500);
  }
};

const Waffen = require('../server/sim/schiffswaffen.js');
const Katalog = require('../shared/schiffskatalog.js');
const zustandE = (e) => Object.fromEntries(Gsys.ids(e).map((id) => [id, e.sys[id].z]));
const difE = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} -> ${b[k]}`);
function frischE(e) {
  for (const id of Gsys.ids(e)) { e.sys[id].i = Gsys.maxOf(e, id); e.sys[id].z = 'ok'; delete e.sys[id].sp; delete e.sys[id].imm; delete e.sys[id].tf; delete e.sys[id].rp; }
  e.hp = Gsys.summe(e); e.shields = e.shields.map(() => 0); e.rt = null; delete e.druckZ; Schilde.pause.loeschen(e);
}

// Abnahme 3: Lanze, Torpedo (Lerche -> Gegner mit echtem Waffenaufruf; Gegner -> Lerche)
PHASEN.waffen = async () => {
  const P = await boot('2d'); const g = P.game;
  await startFlug(P); await P.dbg({ cmd: 'goto', loc: 'splitter' }); await sleep(1500); g.space.enemies = []; g.space.projectiles = []; g.god = true;
  console.log('docked=', g.ship.docked, 'loc=', g.loc || (g.space && g.space.loc));
  require('../server/sim/ausbau.js').setStufe(g, 2); Waffen.bestuecken(g, 2, 'torpedowerfer'); Waffen.ensureMounts(g);
  g.inventory.bolzen = 12;
  const sh = g.ship; sh.vx = sh.vy = 0;
  // --- Lanze: Gegner 250 px vor dem Bug
  sh.angle = -Math.PI / 2;
  const e = space.spawnEnemy(g, 'fregatte', { x: sh.x, y: sh.y - 250, facing: Math.PI / 2 });
  const pin = setInterval(() => { sh.vx = sh.vy = 0; e.x = sh.x; e.y = sh.y - 250; e.angle = Math.PI / 2; e.vx = e.vy = 0; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; e.tele = null; }, 20);
  await sleep(300);
  await P.dbg({ cmd: 'scanall' }); await P.sitz('weapons'); await P.page.evaluate((x) => __game.send({ t: 'cmd', c: 'weapons.target', id: x }), e.id); await sleep(400);
  const clip = { x: 940, y: 4, width: 340, height: 380 };
  frischE(e); let a = zustandE(e);
  Waffen.fireLance(g, 'bow', 1, false); await sleep(450);
  let b = zustandE(e); console.log('LANZE Vollladung (power 1; SYS-03 N1: Reaktor nur eine Stufe, sonst ein System der Mitte zerstört):', J(difE(a, b)), ' Reaktor-Countdown e.rt=', J(e.rt)); await P.shot('waffen-lanze-voll', { clip });
  if (e.rt) e.rt = null; frischE(e); await sleep(300); a = zustandE(e); g.time += 1;
  Waffen.fireLance(g, 'bow', 0.5, false); await sleep(450);
  b = zustandE(e); console.log('LANZE Teilladung (power 0.5):', J(difE(a, b))); await P.shot('waffen-lanze-teil', { clip });
  // --- Torpedo Lerche -> Gegner, echt: Gegner 400 px hinter der Lerche (Heckwerfer)
  sh.angle = 0; clearInterval(pin);
  const pin2 = setInterval(() => { sh.vx = sh.vy = 0; sh.angle = 0; e.x = sh.x - 400; e.y = sh.y; e.angle = 0; e.vx = e.vy = 0; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; e.tele = null; e.shields = e.shields.map(() => 0); }, 20);
  frischE(e); if (e.rt) e.rt = null; await sleep(300); g.ship.target = e.id;
  a = zustandE(e); let n0 = g.stats.torpedoTreffer || 0;
  console.log('Torpedo-Fire Fehler:', Waffen.weaponsFire(g, 'bolzen'));
  for (let i = 0; i < 100 && (g.stats.torpedoTreffer || 0) === n0; i++) await sleep(100);
  await sleep(500);
  b = zustandE(e); console.log('TORPEDO Lerche->Fregatte:', J(difE(a, b)), ' treffer=', (g.stats.torpedoTreffer || 0) - n0, ' e.rt=', J(e.rt)); await P.shot('waffen-torpedo-gegner', { clip });
  clearInterval(pin2);
  // --- Gegner-Torpedo -> Lerche (Schild 0 im Sektor): ein System der Zone zerstört, Reaktor eine Stufe
  g.god = false; space.reactorOnline && 0;
  lerchFrisch(g); sh.angle = 0; sh.x = sh.x; g.space.enemies = g.space.enemies.filter((q) => q !== e);
  await sleep(300);
  const v0 = stand(g);
  space.etorpedoTreffer(g, { x: sh.x + 30, y: sh.y, dmg: 1 }); await sleep(450);
  const v1 = stand(g); console.log('TORPEDO Gegner->Lerche (Bug, Schild 0):', J(diff(v0, v1)));
  await technikTab(P); await P.shot('waffen-torpedo-lerche-technik');
  await P.dbg({ cmd: 'damage', system: 'reactor', state: 'ok' });
  console.log('FEHLER Browser: ' + J(P.fehler));
  await P.schliessen();
};

// Reaktor-Fenster 6 s: Lerche (Torpedo-Durchschlag), Gegner (Torpedo), Verbündeter
PHASEN.reaktor = async () => {
  const P = await boot('2d'); const g = P.game;
  await startFlug(P); const sh = g.ship; sh.vx = sh.vy = 0;
  console.log('reaktorFenster_s =', CONFIG.systemModell.reaktorFenster_s, ' torpedo.reaktorStufen =', CONFIG.systemModell.torpedo.reaktorStufen, ' trefferFenster_s =', SM.trefferFenster_s);
  // Lerche: zwei Torpedos binnen 6 s
  lerchFrisch(g); await sleep(300);
  const rs = () => g.ship.systems.reactor;
  const tp = () => space.etorpedoTreffer(g, { x: sh.x + 30, y: sh.y, dmg: 1 });
  console.log('LERCHE Reaktor vorher:', rs());
  tp(); await sleep(400); console.log('LERCHE Torpedo 1 (t=0):', rs());
  await technikTab(P); await P.shot('reaktor-lerche-1-nach-t1');
  g.time += 1.0; tp(); await sleep(400); console.log('LERCHE Torpedo 2 (t=+1,0 s, im Fenster):', rs(), '| Bug-Zone:', J(zoneSys(g, 0).map((k) => k + '=' + g.ship.systems[k])));
  await P.shot('reaktor-lerche-2-nach-t2');
  g.time += 3.5; tp(); await sleep(400); console.log('LERCHE Torpedo 3 (t=+4,5 s, im Fenster):', rs());
  g.time += 1.6; tp(); await sleep(400); console.log('LERCHE Torpedo 4 (t=+6,1 s, ausserhalb):', rs(), ' reaktorTod=', J(g.ship.reaktorTod && { tot: g.ship.reaktorTod.tot, n: g.ship.reaktorTod.n, rest: g.ship.reaktorTod.rest }));
  await P.shot('reaktor-lerche-3-nach-t4');
  await P.dbg({ cmd: 'damage', system: 'reactor', state: 'ok' }); g.god = true;
  // Gegner: damageEnemy mit torpedo
  const e = space.spawnEnemy(g, 'fregatte', { x: sh.x + 300, y: sh.y - 200, facing: 0 });
  const pin = setInterval(() => { e.x = sh.x + 300; e.y = sh.y - 200; e.angle = 0; e.vx = e.vy = 0; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; e.tele = null; }, 20);
  await sleep(200); frischE(e);
  const rg = () => e.sys.reaktor.z;
  const et = () => space.damageEnemy(g, e, 5, e.x + 300, e.y, { huelle: true, nurOhneSchild: true, torpedo: true });
  console.log('GEGNER Reaktor vorher:', rg());
  et(); console.log('GEGNER Torpedo 1:', rg());
  g.time += 1.0; et(); console.log('GEGNER Torpedo 2 (+1,0 s):', rg(), 'rt=', J(e.rt));
  g.time += 4.5; et(); console.log('GEGNER Torpedo 3 (+5,5 s):', rg());
  g.time += 0.7; et(); console.log('GEGNER Torpedo 4 (+6,2 s):', rg(), 'rt=', J(e.rt && { rest: e.rt.rest, n: e.rt.n }));
  clearInterval(pin);
  // Verbündeter
  const es = Flotte.aufstellen(g, { tag: 'v_fre', kind: 'fregatte' }); es.skript = { modus: 'halten' }; es.gestellt = true; es.x = sh.x - 300; es.y = sh.y - 200; es.angle = 0; es.vx = es.vy = 0;
  frischE(es);
  const ra = () => es.sys.reaktor.z; const at = () => Escort.hit(g, es, 5, { von: { x: es.x + 300, y: es.y }, huelle: true, torpedo: true, nurOhneSchild: true });
  console.log('VERBUENDET Reaktor vorher:', ra());
  at(); console.log('VERBUENDET Torpedo 1:', ra());
  g.time += 1.0; at(); console.log('VERBUENDET Torpedo 2 (+1,0 s):', ra());
  g.time += 5.2; at(); console.log('VERBUENDET Torpedo 3 (+6,2 s):', ra());
  console.log('FEHLER Browser: ' + J(P.fehler));
  await P.schliessen();
};

// Reaktor-Fenster mit normalen Treffern (leere Zone -> Durchschlag in die Mitte, nur Reaktor lebt)
PHASEN.reaktor2 = async () => {
  const P = await boot('2d'); const g = P.game;
  await startFlug(P); await P.dbg({ cmd: 'goto', loc: 'splitter' }); await sleep(1500); g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.vx = sh.vy = 0;
  // Lerche
  lerchFrisch(g);
  for (const k of I.SYSTEM_ORDER) { const z = I.systemSector(k); if ((z === 0 || (z === I.systemSector('reactor') && k !== 'reactor')) && I.systemAktiv(g, k)) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); } }
  console.log('LERCHE Zonen-Sektoren der Systeme: bug', J(zoneSys(g, 0)), ' mitte (aktiv, nicht zerstoert):', J(I.SYSTEM_ORDER.filter((k) => I.systemSector(k) === I.systemSector('reactor') && g.ship.systems[k] !== 'broken')));
  await sleep(300);
  const hit = () => space.shipHit(g, 0, 3, {});
  console.log('LERCHE Reaktor vorher:', g.ship.systems.reactor);
  hit(); console.log('LERCHE Treffer 1 (t=0):', g.ship.systems.reactor); 
  g.time += 0.5; hit(); console.log('LERCHE Treffer 2 (t=+0,5 s):', g.ship.systems.reactor);
  g.time += 2.5; hit(); console.log('LERCHE Treffer 3 (t=+3,0 s):', g.ship.systems.reactor);
  g.time += 2.9; hit(); console.log('LERCHE Treffer 4 (t=+5,9 s):', g.ship.systems.reactor);
  g.time += 0.3; hit(); console.log('LERCHE Treffer 5 (t=+6,2 s):', g.ship.systems.reactor, ' countdown:', J(g.ship.reaktorTod && { n: g.ship.reaktorTod.n, rest: g.ship.reaktorTod.rest }));
  await P.shot('reaktor2-lerche-5');
  await P.dbg({ cmd: 'damage', system: 'reactor', state: 'ok' }); g.god = true;
  // Gegner
  const mk = (e) => { frischE(e); for (const id of Gsys.ids(e)) { const z = Gsys.defOf(e.kind, id).zone; if (z === 'bug' || (z === 'mitte' && id !== 'reaktor')) { e.sys[id].i = 0; e.sys[id].z = 'broken'; } } e.hp = Gsys.summe(e); };
  const e = space.spawnEnemy(g, 'fregatte', { x: sh.x + 300, y: sh.y - 200, facing: 0 });
  const pin = setInterval(() => { e.x = sh.x + 300; e.y = sh.y - 200; e.angle = 0; e.vx = e.vy = 0; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; e.tele = null; }, 20);
  await sleep(200); mk(e);
  const st = () => e.sys.reaktor.z; const eh = () => space.damageEnemy(g, e, 3, e.x + 300, e.y, {});
  console.log('GEGNER Reaktor vorher:', st());
  eh(); console.log('GEGNER Treffer 1:', st()); g.time += 0.5; eh(); console.log('GEGNER Treffer 2 (+0,5 s):', st());
  g.time += 2.5; eh(); console.log('GEGNER Treffer 3 (+3,0 s):', st()); g.time += 2.9; eh(); console.log('GEGNER Treffer 4 (+5,9 s):', st());
  g.time += 0.3; eh(); console.log('GEGNER Treffer 5 (+6,2 s):', st(), 'rt=', J(e.rt));
  clearInterval(pin);
  // Verbündeter
  const es = Flotte.aufstellen(g, { tag: 'v_fre', kind: 'fregatte' }); es.skript = { modus: 'halten' }; es.gestellt = true; es.x = sh.x - 300; es.y = sh.y - 200; es.angle = 0; es.vx = es.vy = 0; mk(es);
  const ah = () => Escort.hit(g, es, 3, { von: { x: es.x + 300, y: es.y } }); const sa = () => es.sys.reaktor.z;
  console.log('VERBUENDET Reaktor vorher:', sa());
  ah(); console.log('VERBUENDET Treffer 1:', sa()); g.time += 0.5; ah(); console.log('VERBUENDET Treffer 2 (+0,5 s):', sa());
  g.time += 2.5; ah(); console.log('VERBUENDET Treffer 3 (+3,0 s):', sa()); g.time += 3.2; ah(); console.log('VERBUENDET Treffer 4 (+6,2 s):', sa());
  console.log('FEHLER Browser: ' + J(P.fehler));
  await P.schliessen();
};
