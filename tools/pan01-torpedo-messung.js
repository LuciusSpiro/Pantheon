'use strict';
// PAN-01 Paket C: Messung des Torpedowerfers (Rohdaten für CONTRACT-PAN01-C.md). Wiederverwendbar.
//   node tools/pan01-torpedo-messung.js                    Teil 1 und 2 (deterministisch, Sekunden)
//   node tools/pan01-torpedo-messung.js --bot [--seeds 12] [--jobs 4]   zusätzlich Teil 3 (Arena-Bot, dauert Minuten)
//
// Teil 1  Wirkung: Treffer bis Zerstörung je Zielklasse und Crewgröße (Hüllenwerte aus CONFIG.enemies × crewScaling × enemyHpFactor), dazu die Zeit bei Cooldown
//         8 / 10 / 12 s (n − 1 Cooldowns plus Flugzeit). Das Ziel steht still im Heckbogen, der Werfer feuert, sobald er bereit ist.
// Teil 2  Gegner-Torpedo gegen die Lerche: Hüllenverlust je Treffer (Auslegung: höchstens ein Drittel der Hülle, ohne Schild- und Poolwirkung) und Ausweichfenster.
// Teil 3  Heckbogen 60° gegen 90° bei Cooldown 8 / 10 / 12 s im Arena-Bot (3 Spieler): Torpedos je Lauf, Treffer, Wellen, Dauer – wie viel der Bogen hergibt.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Waffen = require('../server/sim/schiffswaffen.js');

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const DT = 1 / CONFIG.tickHz;
const f1 = (v) => (Math.round(v * 10) / 10).toString();

function neuesSpiel(players) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pan01-torpedo-'));
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T' + i, name: 'T' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  g.god = true;
  require('../server/sim/ausbau.js').setStufe(g, 2);
  Waffen.bestuecken(g, 2, 'torpedowerfer');
  g.players[0].console = 'weapons';
  for (let i = 0; i < 5; i++) g.step();
  return g;
}

// Teil 1: ein Ziel steht still 400 px hinter der Lerche; so lange feuern, bis es zerstört ist
function treffer(kind, crew, seite, schildNull) {
  const g = neuesSpiel(crew);
  const sh = g.ship;
  g.inventory.bolzen = 99;
  const e = space.spawnEnemy(g, kind, { x: sh.x - 400, y: sh.y, facing: seite === 'heck' ? Math.PI : 0 });   // bug: Schildseite (Bug des Ziels) zur Lerche, heck: ungeschützte Seite
  const hp0 = e.hp, schild0 = e.shields.reduce((a, b) => a + b, 0);
  g.ship.target = e.id;
  let t = 0, schuesse = 0, tZerstoert = null;
  const pin = () => { if (schildNull) e.shields = e.shields.map(() => 0); e.x = sh.x - 400; e.y = sh.y; e.angle = seite === 'heck' ? Math.PI : 0; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; e.tele = null; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.vx = sh.vy = 0; };
  while (g.space.enemies.includes(e) && t < (!schildNull && Katalog.TORPEDO.schildUmgehung !== 'immer' ? 60 : 400)) {
    pin();
    if (g.ship.mount.p2.cd <= 0 && !g.space.projectiles.some((q) => q.kind === 'torpedo')) { const err = Waffen.weaponsFire(g, 'bolzen'); if (!err) schuesse++; }
    g.step(); t += DT;
  }
  tZerstoert = t;
  return { kind, crew, hp: hp0, schild: schild0, treffer: g.stats.torpedoTreffer || 0, schuesse, flug: schuesse ? tZerstoert - (schuesse - 1) * Katalog.TORPEDO.cooldown : 0, dmg: Katalog.torpedoSchaden(kind), toetet: !g.space.enemies.includes(e) };
}

function teil1() {
  console.log('\n## Teil 1 – Treffer bis Zerstörung (Lesart B: Schild 0 im getroffenen Sektor, kein Schildschaden, Katalog TORPEDO.schaden)');
  console.log('| Ziel | Crew | Hülle | Schild (Summe) | Schaden/Treffer | Treffer bis Zerstörung | Zeit bei Cooldown 8 s | 10 s | 12 s |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  const klassen = ['raider', 'korvette', 'fregatte', 'kreuzer', 'sentinel', 'pylon', 'frachter'];
  const rows = [];
  for (const kind of klassen) for (const crew of [1, 3]) {
    const r = treffer(kind, crew, 'bug', true); rows.push(r);
    const zeit = (cd) => f1(Math.max(0, r.treffer - 1) * cd + (r.flug > 0 ? Math.min(r.flug, 2.5) : 1.2));
    console.log(`| ${kind} | ${crew} | ${f1(r.hp)} | ${f1(r.schild)} | ${r.dmg} | ${r.treffer} | ${zeit(8)} s | ${zeit(10)} s | ${zeit(12)} s |`);
  }
  const jaeger = rows.filter((r) => r.kind === 'raider');
  console.log(`Jäger: ${jaeger.map((r) => `Crew ${r.crew}: ${r.treffer} Treffer`).join(', ')} (Soll: 1 Treffer, sofort zerstört).`);
  return rows;
}

// Lesarten: A (Testschalter 'immer': an Schilden vorbei) gegen B (Katalogwert 'nur-ohne-schild', Kai 2026-10-18, alle Ziele): Treffer bis Zerstörung je Klasse, Crew 3, Ziel mit Schildseite zur Lerche
function teilLesarten() {
  console.log('## Lesarten des Torpedo-Schilds (Crew 3, Schildseite des Ziels zur Lerche; — = kein Schaden, solange der Schild steht)');
  console.log('| Ziel | Lesart A (Testschalter: immer an Schilden vorbei) | Lesart B, Schild steht | Lesart B, Schild 0 |');
  console.log('|---|---|---|---|');
  for (const kind of ['raider', 'korvette', 'fregatte', 'kreuzer', 'pylon', 'sentinel']) {
    Katalog.TORPEDO.schildUmgehung = 'immer'; const a = treffer(kind, 3, 'bug', false);
    Katalog.TORPEDO.schildUmgehung = 'nur-ohne-schild'; const b = treffer(kind, 3, 'bug', false); const c = treffer(kind, 3, 'bug', true);
    console.log(`| ${kind} | ${a.toetet ? a.treffer : '—'} | ${b.toetet ? b.treffer : '—'} | ${c.toetet ? c.treffer : '—'} |`);
  }
}
function teil2() {
  console.log('\n## Teil 2 – Gegner-Torpedo gegen die Lerche (Katalog TORPEDO.gegenLerche; Lesart B: wirkt nur bei Schild 0 im getroffenen Sektor)');
  const T = Katalog.TORPEDO;
  const g = neuesSpiel(3); const sh = g.ship; g.god = false;
  const mess = (opt) => {
    g.ship.hull = g.ship.hullMax; for (let i = 0; i < 4; i++) g.ship.shields.current[i] = opt.schildNull ? 0 : 4;
    g.ship.lastDodgeT = opt.ausweichen ? g.time : -99;
    const h0 = g.ship.hull; const s0 = g.ship.shields.current.slice();
    space.etorpedoTreffer(g, { x: sh.x + 30, y: sh.y, dmg: T.gegenLerche });
    return { huelle: h0 - g.ship.hull, schild: s0.map((v, i) => v - g.ship.shields.current[i]).reduce((a, b) => a + b, 0) };
  };
  const r0 = mess({});
  console.log(`Lesart B (Kai 2026-10-18) gilt auch für die Lerche: ein Treffer bei vollen Schilden (4 je Sektor): Hülle −${f1(r0.huelle)} (abgeprallt), Schildabzug ${f1(r0.schild)}.`);
  const r = mess({ schildNull: true });
  console.log(`Ein Treffer bei Schild 0 im getroffenen Sektor: Hülle −${f1(r.huelle)} von ${sh.hullMax} (${f1(r.huelle / sh.hullMax * 100)} %), Schildabzug ${f1(r.schild)}.`);
  const a = mess({ ausweichen: true, schildNull: true });
  console.log(`Treffer direkt nach einer Ausweichrolle (Fenster ${CONFIG.spaceM3.dodgeWindow} s): Hülle −${f1(a.huelle)} (verfehlt).`);
  const dreimal = (() => { g.ship.hull = g.ship.hullMax; g.ship.lastDodgeT = -99; for (let i = 0; i < 4; i++) g.ship.shields.current[i] = 0; for (let i = 0; i < 3; i++) space.etorpedoTreffer(g, { x: sh.x + 30, y: sh.y, dmg: T.gegenLerche }); return g.ship.hullMax - g.ship.hull; })();
  console.log(`Drei Treffer in Folge (Schild 0): Hülle −${f1(dreimal)} (Notfallprotokoll bei 0, nie Game Over; ${f1(dreimal)} < ${sh.hullMax}).`);
  return r;
}

// Teil 3: Heckbogen und Cooldown im Arena-Bot
function teil3() {
  const seeds = Number(arg('--seeds', 12)), jobs = Number(arg('--jobs', 4));
  const sets = ['start'];
  for (const pre of ['tor', 'tor12', 'tor12B']) for (const bogen of [60, 90]) for (const cd of [8, 10, 12]) sets.push(`${pre}-${bogen}-${cd}`);   // tor = Startlager 6, tor12 = Lager 12 (sonst wie der Start: 6 Torpedos sind in einem Lauf verbraucht)
  console.log(`\n## Teil 3 – Arena-Bot (3 Spieler, ${seeds} Seeds, Steuer maneuver), Heckbogen 60/90 Grad, Cooldown 8/10/12 s`);
  return new Promise((res) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'pan01-energie-bot.js'), '--seeds', String(seeds), '--jobs', String(jobs), '--set', sets.join(';')], { cwd: path.join(__dirname, '..') });
    let out = ''; p.stdout.on('data', (d) => { out += d; process.stdout.write(d); }); p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('close', () => res(out));
  });
}

(async () => {
  console.log('PAN-01 C Torpedo-Messung (Katalog: Cooldown ' + Katalog.TORPEDO.cooldown + ' s, Lager ' + Katalog.TORPEDO.lagerMax + ', Bogen ' + Katalog.waffe('torpedowerfer').bogen + ' Grad)');
  teil1(); teil2(); teilLesarten();
  if (argv.includes('--bot')) await teil3();
})();
