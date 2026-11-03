'use strict';
// TEL-01 M: Das Protokoll erfasst die neuen Spielpfade aus GEG-01 und OPS-01 (Integration mit main 75ab5a7). Headless gegen die Game-Klasse.
//   node tools/test-telemetrie-geg.js  (npm run test:telemetrie-geg)
//   A  Lanzen-Vollladung gegen das Systemziel der Ops: treffer mit waffe lanze, zone und system des Ziels (GEG-01 C)
//   B  Gegner-Reaktor-Countdown: jeder Treffer halbiert die Restzeit, der Tod kommt als kill (GEG-01 B, gegnertod.js)
//   C  Lerche: Reaktor zerstoert, Treffer halbieren den Countdown, Ende als schiff_zerstoert (GEG-01 B, reaktortod.js)
//   D  Konvoi-Transporter: Sprung am Routenende = gegner_weg konvoi_ende; mit zerstoertem Antrieb genau ein konvoi_sprung_abgebrochen (GEG-01 A)
//   E  Der Spielverlauf ist mit und ohne Protokoll bit-gleich (Konvoi-Lauf), jede Zeile steht im Schema, keine verworfenen Felder
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gtod = require('../server/sim/gegnertod.js');
const Konvoi = require('../server/sim/konvoi.js');
const Rt = require('../server/sim/reaktortod.js');
const { SCHEMA } = require('../server/telemetrie/schema.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-geg-'));
const lesen = (d) => { const f = fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')); return f.length ? fs.readFileSync(path.join(d, f[0]), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []; };

// Arena-Raumszene Rabenpass, Lerche unverwundbar (god), Protokoll an (dir) oder aus (null)
function szene(dir, name) {
  const env = { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(root, 'regie-' + name), TELEMETRIE: dir ? 'an' : 'aus', TELEMETRIE_QUELLE: 'bot' };
  if (dir) env.TELEMETRIE_DIR = dir;
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Geheimname', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = true;
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  for (let i = 0; i < 3; i++) g.step();
  g.space.enemies = []; g.space.projectiles = [];
  const s = g.ship; s.x = 300; s.y = 300; s.vx = 0; s.vy = 0; s.speed = 0; s.target = null;
  const run = (sec, god) => { for (let i = 0; i < sec / DT; i++) { g.step(); if (god !== false) g.god = true; } };
  const fertig = () => { g.telemetrie.sessionBeenden('test'); return dir ? lesen(dir) : []; };
  return { g, run, fertig };
}
const gegner = (g, kind, x, y) => { const e = space.spawnEnemy(g, kind, { x, y, facing: 0 }); e.vx = 0; e.vy = 0; e.angle = 0; e.gestellt = true; return e; };

console.log('A  Lanzen-Vollladung gegen das Systemziel der Ops');
{
  const d = path.join(root, 'a'); const S = szene(d, 'a'); const g = S.g;
  const e = gegner(g, 'fregatte', 600, 300); e.scanned = true; g.ship.target = e.id;
  g.ship.zielsystem = Gsys.idVon(e, 'antrieb');
  Waffen.schade(g, e, 12, g.ship.x, g.ship.y, { pierce: 2, durchschlag: 'zone', vollladung: true }, 'lanze');
  const z = S.fertig();
  const t = z.filter((x) => x.typ === 'treffer' && x.waffe === 'lanze' && x.gegner === e.id);
  ok(t.length === 1 && t[0].von === 'lerche' && t[0].ziel === 'gegner' && t[0].rolle === 'fregatte', 'ein treffer der Lanze von der Lerche auf den Gegner');
  ok(t.length === 1 && t[0].system === 'antrieb' && t[0].zone === 'heck' && t[0].zustand === 'broken', 'treffer nennt das gezielte System (antrieb, heck, zerstoert)');
}

console.log('B  Gegner-Reaktor-Countdown und Tod');
{
  const d = path.join(root, 'b'); const S = szene(d, 'b'); const g = S.g;
  const e = gegner(g, 'raider', 600, 300);
  S.run(0.5);
  Gtod.brechen(g, e, Gsys.idVon(e, 'reaktor'));
  const rest0 = e.rt && e.rt.rest;
  Waffen.schade(g, e, 5, g.ship.x, g.ship.y, {}, 'lanze');
  ok(rest0 > 0 && e.rt.rest <= rest0 / 2 + 1e-9, 'der Treffer halbiert die Restzeit (' + rest0 + ' -> ' + e.rt.rest + ')');
  S.run(40);
  const z = S.fertig();
  const k = z.filter((x) => x.typ === 'kill' && x.gegner === e.id);
  ok(k.length === 1 && k[0].rolle === 'raider' && k[0].waffe === 'lanze' && k[0].von === 'lerche', 'genau ein kill (Tod durch den Countdown), Waffe des letzten Treffers: lanze');
  ok(!z.some((x) => x.typ === 'gegner_weg' && x.gegner === e.id), 'kein zusaetzliches gegner_weg');
}

console.log('C  Lerche: Reaktor zerstoert, Countdown halbiert, Schiff zerstoert');
{
  const d = path.join(root, 'c'); const S = szene(d, 'c'); const g = S.g;
  g.god = false; g.ship.systems.reactor = 'broken'; Rt.zerstoert(g, {});
  S.run(1, false);
  const vor = g.ship.reaktorCountdown && g.ship.reaktorCountdown.t;
  space.shipHit(g, 0, 5, {});
  ok(vor > 0 && g.ship.reaktorCountdown && g.ship.reaktorCountdown.t <= vor / 2 + 1e-9, 'ein Treffer halbiert den Countdown der Lerche');
  for (let i = 0; i < 20 && !g.ship.schiffZerstoert; i++) { space.shipHit(g, 0, 5, {}); g.step(); }
  const z = S.fertig();
  const sz = z.filter((x) => x.typ === 'schiff_zerstoert');
  ok(g.ship.schiffZerstoert === true && sz.length === 1 && sz[0].grund === 'reaktor' && sz[0].n === 1, 'genau ein schiff_zerstoert (grund reaktor, n 1)');
}

console.log('D  Konvoi: Sprung und vereitelter Sprung');
function konvoi(dir, name, antriebBrechen) {
  const S = szene(dir, name); const g = S.g;
  Konvoi.an(g, { n: 1, sieg: 'aufhalten', eskorte: 'keine', wiederholung: false });
  const k = g.space.konvoi; const id = k.ids[0];
  if (antriebBrechen) {
    const e = g.space.enemies.find((q) => q.id === id); const last = k.route.length - 1;
    e.wp = last; e.x = k.route[last].x - 20; e.y = k.route[last].y;
    Gtod.brechen(g, e, 'antrieb');
  }
  S.run(200);
  const e = g.space.enemies.find((q) => q.id === id) || null;
  return { S, g, id, k, e };
}
let zD = [];
{
  const d = path.join(root, 'd1'); const R = konvoi(d, 'd1', false); const z = R.S.fertig();
  const w = z.filter((x) => x.typ === 'gegner_weg' && x.gegner === R.id);
  ok(!R.e && R.k.fertig[R.id] === 'gesprungen', 'der Transporter ist gesprungen');
  ok(w.length === 1 && w[0].grund === 'konvoi_ende' && w[0].rolle === 'frachter', 'gegner_weg konvoi_ende');
  ok(!z.some((x) => x.typ === 'konvoi_sprung_abgebrochen'), 'kein konvoi_sprung_abgebrochen');
}
{
  const d = path.join(root, 'd2'); const R = konvoi(d, 'd2', true); const z = R.S.fertig();
  const a = z.filter((x) => x.typ === 'konvoi_sprung_abgebrochen');
  ok(!!R.e && !R.k.fertig[R.id], 'mit zerstoertem Antrieb bleibt der Transporter (springt nicht)');
  ok(a.length === 1 && a[0].gegner === R.id && a[0].rolle === 'frachter' && a[0].grund === 'antrieb' && a[0].ort === 'raum', 'genau ein konvoi_sprung_abgebrochen (grund antrieb), trotz 200 s Warten');
  ok(!z.some((x) => x.typ === 'gegner_weg' && x.gegner === R.id), 'kein gegner_weg');
  zD = z;
}

console.log('E  Spielverlauf mit und ohne Protokoll, Schema');
{
  const sig = (R) => JSON.stringify({ t: R.g.time.toFixed(3), tick: R.g.tick, e: R.e ? [R.e.x.toFixed(3), R.e.y.toFixed(3), R.e.hp] : null, sp: R.e ? R.e.sprung : null, kills: R.g.stats.kills, fertig: R.k.fertig, marks: R.g.inventory.marks });
  const an = konvoi(path.join(root, 'e1'), 'e1', true); an.S.fertig();
  const aus = konvoi(null, 'e2', true);
  ok(sig(an) === sig(aus), 'Konvoi-Lauf mit zerstoertem Antrieb: Zustand mit und ohne Protokoll gleich');
  const an2 = konvoi(path.join(root, 'e3'), 'e3', false); an2.S.fertig();
  const aus2 = konvoi(null, 'e4', false);
  ok(sig(an2) === sig(aus2), 'Konvoi-Lauf mit Sprung: Zustand mit und ohne Protokoll gleich');
  const fremd = [];
  for (const x of zD) {
    const s = SCHEMA[x.typ];
    if (!s) { fremd.push(x.typ); continue; }
    for (const k of Object.keys(x)) if (!['v', 'typ', 'sitzung', 'tick', 't'].includes(k) && !s.felder.includes(k)) fremd.push(x.typ + '.' + k);
  }
  ok(!fremd.length, 'alle Typen und Felder stehen im Schema' + (fremd.length ? ' (fremd: ' + fremd.join(',') + ')' : ''));
  const ende = zD.find((x) => x.typ === 'session_ende');
  ok(ende && ende.verworfen === 0 && ende.fehler === 0, 'session_ende: verworfen 0, fehler 0');
  ok(!JSON.stringify(zD).includes('Geheimname'), 'kein Spielername im Protokoll');
}

try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ok');
process.exit(fails ? 1 : 0);
