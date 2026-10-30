'use strict';
// SYS-02a „Nachbesserungen aus Kais Antworten zum SYS-01-Bericht“ (Kai 2026-10-28):
//   1  Jäger reparieren nicht (gegner-systeme.json raider.repariert false).
//   2  Sturm = Unterdrückungswaffe (Lerche gegen Gegner und Gegner gegen Lerche): Regeneration gesperrt (wie bisher), Reparatursperre der getroffenen Zone
//      (sturm.reparaturSperre_s, Fortschritt sofort 0), bei Schild ≤ niedrig oder 0 Schaden gegen das System × sturm.systemFaktor, gegen den vollen Schild kaum Schildschaden
//      und kein Systemschaden (der Sturm nutzt volle Schilde nicht ab; die alte Abnahme „bricht den Schild in 15 s“ entfällt).
//   3  Torpedo tut weh (Lerche wie Gegner): nur bei Schild 0 (Lesart B), zerstört das getroffene System der Zone sicher und schlägt mit reaktorAnteil × Reaktor-Maximum auf den Reaktor
//      durch (zwei Treffer zerstören ihn, Countdown wie jede Reaktorzerstörung); Jäger sofort tot; leere Zone: nur der Reaktor wird getroffen; Zufall nur game.rng.
//   node tools/test-sys02a.js   (npm run test:sys02a)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const Space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gegnerreparatur = require('../server/sim/gegnerreparatur.js');
const BOTS = require('../server/sim/bots.js');
const W = require('../server/world.js');
const Testhilfe = require('./gegner-testhilfe.js');
const DATEN = require('../content/kampf/gegner-systeme.json');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); } };
const DT = 1 / CONFIG.tickHz;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sys02a-'));
let seq = 0;
const ST = Katalog.waffe('sturmbatterie').sturm;
const SM = CONFIG.systemModell;

// ---- Lerche: Spiel in der Freien Fahrt (kein Übungsgate), ohne Wellen
function lerche(spieler, seed) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < (spieler || 1); i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  run(1); g.space.enemies = []; g.space.projectiles = [];
  BOTS.setBotAuto(g, false);
  g.god = false;
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {};
  I.integritaetVoll(g);
  g.ship.shields.current = [6, 6, 6, 6]; g.ship.shields.regenHold = 0;
  return { g, run };
}
const ankern = (g, p, sys) => { const st = W.STATIONS.find((s) => s.system === sys); const c = W.tileCenter(st.x, st.y); p.x = c.x; p.y = c.y; p.zone = 'ship'; p.console = null; p.hold = null; p.moving = false; p.input.mx = 0; p.input.my = 0; };
const sturmHit = (g, sec, dmg) => Space.shipHit(g, sec, dmg == null ? 1.08 : dmg, { sperrfeuer: true, sturm: true });
const isum = (g) => I.SYSTEM_ORDER.reduce((a, k) => a + (I.systemAktiv(g, k) ? I.integOf(g, k) : 0), 0);
const zone0 = () => I.SYSTEM_ORDER.filter((k) => I.systemSector(k) === 0);
const brokenSet = (g) => I.SYSTEM_ORDER.filter((k) => g.ship.systems[k] === 'broken');

// ---- Gegner: Arena ohne Wellen, Lerche unverwundbar und ohne eigene Schüsse
function arena(seed) {
  const g = new Game({ noStore: true, seed: seed || 61, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'TD0', name: 'TD0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0; sh.speed = 0;
  g.god = true;
  const noWeapons = () => { for (const k of ['bow', 'port', 'stbd']) if (g.ship.mount[k]) { g.ship.mount[k].charge = 0; g.ship.mount[k].salvo = 0; } };
  const run = (sec, fn) => { for (let k = 0; k < Math.round(sec / DT); k++) { noWeapons(); if (fn) fn(); g.step(); } };
  return { g, run };
}
function gegner(g, kind, o) {
  const e = Space.spawnEnemy(g, kind, Object.assign({ x: g.ship.x + 250, y: g.ship.y, facing: Math.PI }, o || {}));
  e.vx = 0; e.vy = 0; e.pin = { x: e.x, y: e.y, angle: e.angle };
  return e;
}
const halte = (e) => { if (e.pin) { e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; e.tele = null; } };
// Quelle eines Treffers auf Seite 0 (Bug), 1 (Steuerbord), 2 (Heck), 3 (Backbord): Punkt vor/neben/hinter dem Gegner relativ zu seiner Ausrichtung
const quelle = (e, seite) => { const a = e.angle + [0, Math.PI / 2, Math.PI, -Math.PI / 2][seite]; return [e.x + Math.cos(a) * 100, e.y + Math.sin(a) * 100]; };
const treffer = (g, e, seite, dmg, opts) => { const [x, y] = quelle(e, seite); return Space.damageEnemy(g, e, dmg, x, y, opts); };
const sturmOpts = () => ({ sturm: ST, angriff: true });
const torpOpts = () => ({ huelle: true, nurOhneSchild: true, torpedo: true, angriff: true });
const nullSchild = (e) => { for (let i = 0; i < e.shields.length; i++) e.shields[i] = 0; };
const gebrochen = (e) => Gsys.ids(e).filter((id) => e.sys[id].z === 'broken');
const zustand = (e, id) => e.sys[id].z;

// =============================================================== 1 Jäger
section('1 Jäger reparieren nicht (Daten gegner-systeme.json)', () => {
  const flags = ['raider', 'korvette', 'fregatte', 'kreuzer', 'sentinel', 'pylon', 'frachter'].map((c) => c + ':' + DATEN.klassen[c].repariert).join();
  ok(flags === 'raider:false,korvette:true,fregatte:true,kreuzer:true,sentinel:false,pylon:false,frachter:false', 'repariert je Klasse (' + flags + ')');
  const { g, run } = arena(81);
  const j = gegner(g, 'raider'); const k = gegner(g, 'korvette');
  Testhilfe.setzeIntegritaet(j, 'antrieb', 0); Testhilfe.setzeIntegritaet(k, 'antrieb', 0);
  run(12, () => { halte(j); halte(k); });
  ok(!Gegnerreparatur.repariert(j) && zustand(j, 'antrieb') === 'broken', 'Jäger: zerstörter Antrieb bleibt nach 12 s zerstört');
  ok(Gegnerreparatur.repariert(k) && zustand(k, 'antrieb') === 'damaged', 'Korvette (Gegenprobe): Antrieb nach 12 s repariert (beschädigt)');
});

// =============================================================== 2 Sturm
section('2a Sturm: Werte als Daten (Katalog) und tunebar (Config), eine Zahl', () => {
  ok(typeof SM.sturm.reparaturSperre_s === 'number' && SM.sturm.reparaturSperre_s === 6 && ST.reparaturSperre_s === 6, 'reparaturSperre_s 6 (Config und Katalog)');
  ok(typeof SM.sturm.systemFaktor === 'number' && SM.sturm.systemFaktor === 1.5 && ST.systemFaktor === 1.5, 'systemFaktor 1,5 (Config und Katalog)');
  ok(ST.regenSperre === 6 && ST.niedrig === 1 && ST.schildFaktor === 0.25, 'regenSperre 6, niedrig 1, schildFaktor 0,25 unverändert');
});

section('2b Sturm gegen die Lerche: voller Schild – kaum Schildschaden, kein Systemschaden, Regeneration gesperrt', () => {
  const { g } = lerche(1, 11);
  const i0 = isum(g);
  for (let i = 0; i < 15; i++) sturmHit(g, 0);
  ok(isum(g) === i0 && g.ship.shields.current[0] > ST.niedrig && g.ship.shields.current[0] < 6, `15 Nadeln gegen Schild 6: Systeme unberührt (Integrität ${i0}), Schild nur ${(6 - g.ship.shields.current[0]).toFixed(2)} abgetragen (kaum Schildschaden, ${g.ship.shields.current[0].toFixed(2)} über „niedrig“)`);
  ok(g.ship.shields.regenHold > g.time, 'Regeneration gesperrt');
});

section('2c Sturm gegen die Lerche: bei Schild 0 wirkt der Schaden × systemFaktor gegen das System (tunebar)', () => {
  const { g } = lerche(1, 12);
  g.ship.shields.current = [0, 6, 6, 6];
  let v0 = isum(g); sturmHit(g, 0, 1.08);
  ok(near(v0 - isum(g), 1.08 * SM.sturm.systemFaktor, 0.06), `ein Treffer 1,08 bei Schild 0: −${(v0 - isum(g)).toFixed(3)} Integrität (1,08 × ${SM.sturm.systemFaktor})`);
  const f0 = SM.sturm.systemFaktor; SM.sturm.systemFaktor = 2;
  try { v0 = isum(g); sturmHit(g, 0, 1.08); ok(near(v0 - isum(g), 2.16, 0.06), `live per tune systemModell.sturm.systemFaktor 2: −${(v0 - isum(g)).toFixed(3)} (1,08 × 2)`); } finally { SM.sturm.systemFaktor = f0; }
  // Anzahl Nadeln bis zur Zerstörung eines Systems (nur noch ein System in der Zone): ceil(Maximum / (Schaden × Faktor))
  const g2 = lerche(1, 13).g; g2.ship.shields.current = [0, 6, 6, 6];
  for (const k of zone0().slice(1)) { g2.ship.systems[k] = 'broken'; I.setInteg(g2, k, 0); }
  const einziges = zone0()[0]; const max = I.integMax(g2, einziges); let nadeln = 0;
  while (g2.ship.systems[einziges] !== 'broken' && nadeln < 100) { sturmHit(g2, 0, 1.08); nadeln++; }
  ok(nadeln === Math.ceil(max / (1.08 * 1.5)), `Zeit bis Systemzerstörung bei Schild 0: ${nadeln} Nadeln (Maximum ${max}; ohne Faktor wären es ${Math.ceil(max / 1.08)})`);
});

section('2d Sturm gegen die Lerche: Reparatursperre der Zone (Spieler am Halten), andere Zonen ungestört', () => {
  const { g, run } = lerche(2, 14);
  const [p0, p1] = g.players;
  I.damageSystem(g, 'emitter_bow', 'damaged'); I.damageSystem(g, 'emitter_aft', 'damaged');
  const zA = I.systemSector('emitter_bow'), zB = I.systemSector('emitter_aft');
  ok(zA !== zB, `zwei Zonen (${zA}, ${zB})`);
  ankern(g, p0, 'emitter_bow'); I.onAct(g, p0, true);
  ankern(g, p1, 'emitter_aft'); I.onAct(g, p1, true);
  ok(p0.hold && p0.hold.kind === 'flick' && p1.hold && p1.hold.kind === 'flick', 'beide halten (Flicken)');
  run(0.7);
  ok(p0.hold && p0.hold.t > 0.5, `Fortschritt vor dem Treffer ${p0.hold.t.toFixed(2)} s`);
  const t0 = g.time;
  sturmHit(g, zA);   // voller Schild: nur Sperre, kein Systemschaden
  ok(p0.hold.t === 0, 'Sturm-Treffer: Fortschritt der Zone sofort 0 (voller Rückschlag, kein Halbieren)');
  run(1.0);
  ok(g.ship.systems.emitter_aft === 'ok', 'andere Zone: Reparatur läuft weiter und wird fertig');
  run(4.5);   // 5,5 s nach dem Treffer
  ok(p0.hold && p0.hold.t === 0 && g.ship.systems.emitter_bow === 'damaged', `gesperrte Zone: nach ${(g.time - t0).toFixed(1)} s kein Fortschritt, System bleibt beschädigt`);
  run(0.8);   // Sperre vorbei (6 s), danach läuft die Reparatur an
  run(1.8);
  ok(g.ship.systems.emitter_bow === 'ok', `nach der Sperre (${SM.sturm.reparaturSperre_s} s) wird repariert (${(g.time - t0).toFixed(1)} s nach dem Treffer)`);
  // ein weiterer Treffer verlängert die Sperre ab dem neuen Treffer
  I.damageSystem(g, 'emitter_bow', 'damaged'); ankern(g, p0, 'emitter_bow'); I.onAct(g, p0, true);
  sturmHit(g, zA); run(3); sturmHit(g, zA); const t1 = g.time; run(5.5);
  ok(g.ship.systems.emitter_bow === 'damaged' && p0.hold && p0.hold.t === 0, 'zweiter Treffer nach 3 s: Sperre läuft ab dem zweiten Treffer (5,5 s später noch gesperrt)');
  run(1.0 + 1.8);
  ok(g.ship.systems.emitter_bow === 'ok', `danach repariert (${(g.time - t1).toFixed(1)} s nach dem zweiten Treffer)`);
});

section('2e Sturm gegen die Lerche: Sperre gilt für die Sonderreparatur des Reaktors (Zone Mitte), der Countdown läuft weiter', () => {
  const { g, run } = lerche(1, 15); const p = g.players[0];
  // Zone 0 leer: der Sturm trifft bei Schild 0 die Mitte und sperrt sie mit
  g.ship.shields.current = [0, 6, 6, 6];
  for (const k of zone0()) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
  sturmHit(g, 0, 0.1);
  ok(g.ship.repSperre && g.ship.repSperre[0] > g.time && g.ship.repSperre[-1] > g.time, 'Treffer auf die leere Zone 0 läuft in die Mitte: beide Zonen gesperrt');
  g.ship.repSperre = {}; g.ship.shields.current = [6, 6, 6, 6];
  I.setzeZustand(g, 'reactor', 'ok'); I.damageSystem(g, 'reactor', 'broken');
  ankern(g, p, 'reactor'); I.onAct(g, p, true);
  run(3);
  ok(p.hold && p.hold.t > 2.5 && !!g.ship.reaktorCountdown, `Sonderreparatur läuft (${p.hold.t.toFixed(1)} s), Countdown ${g.ship.reaktorCountdown.t.toFixed(1)} s`);
  const cd0 = g.ship.reaktorCountdown.t;
  I.reparaturSperren(g, -1, 4);
  ok(p.hold.t === 0, 'Reaktor-Sonderreparatur: Fortschritt auf 0');
  run(3);
  ok(p.hold && p.hold.t === 0 && near(cd0 - g.ship.reaktorCountdown.t, 3, 0.1), `gesperrt: kein Fortschritt, der Countdown läuft weiter (−${(cd0 - g.ship.reaktorCountdown.t).toFixed(1)} s in 3 s)`);
});

section('2f Sturm gegen die Lerche: Schrauber-Bot in der Arbeit verliert den Fortschritt, gesperrt kein Fortschritt', () => {
  const { g } = lerche(1, 16);
  I.damageSystem(g, 'emitter_bow', 'damaged');
  const bot = g.bots[0];
  ok(!!bot, 'ein Bot da');
  const st = W.STATIONS.find((s) => s.system === 'emitter_bow'); const c = W.tileCenter(st.x, st.y);
  bot.x = c.x; bot.y = c.y; bot.task = { kind: 'repair', phase: 'work', system: 'emitter_bow', mode: 'flick', dur: 1.5, von: 'damaged', tx: st.x, ty: st.y }; bot.progress = 0.6;
  I.reparaturSperren(g, I.systemSector('emitter_bow'), 3);
  ok(bot.progress === 0, 'Bot: Fortschritt 0 bei Beginn der Sperre');
  let max = 0; for (let k = 0; k < 60; k++) { g.step(); if (bot.task && bot.task.system === 'emitter_bow' && bot.task.phase === 'work') max = Math.max(max, bot.progress); }
  ok(max === 0 && g.ship.systems.emitter_bow === 'damaged', 'Bot: 2 s gesperrt, Fortschritt bleibt 0, System beschädigt');
});

section('2g Sturm gegen Gegner: Reparatursperre der Zone (Fortschritt 0, andere Zonen und Systeme laufen weiter)', () => {
  const { g, run } = arena(82);
  const e = gegner(g, 'korvette');
  Testhilfe.setzeIntegritaet(e, 'antrieb', 0); Testhilfe.setzeIntegritaet(e, 'waffe_bug', 0);
  run(3, () => halte(e));
  ok(e.sys.antrieb.rp > 2.5, `Antrieb (Zone Heck) in Reparatur (${e.sys.antrieb.rp.toFixed(1)} s)`);
  const t0 = g.time;
  treffer(g, e, 2, 1.08, sturmOpts());   // Heck, Schild steht
  ok(e.sys.antrieb.rp === 0, 'Sturm-Treffer auf die Heckzone: Fortschritt der Heck-Systeme sofort 0');
  run(5.5, () => halte(e));
  ok(zustand(e, 'antrieb') === 'broken' && e.sys.antrieb.rp === 0, `Heckzone: ${(g.time - t0).toFixed(1)} s nach dem Treffer kein Fortschritt`);
  ok(e.sys.waffe_bug.rp > 8, `Zone Bug wird währenddessen weiter repariert (Fortschritt ${e.sys.waffe_bug.rp.toFixed(1)} s; ein gesperrtes System blockiert den Reparaturplatz nicht)`);
  run(1.0 + 10.3, () => halte(e));
  ok(zustand(e, 'antrieb') !== 'broken', `danach läuft die Reparatur wieder (${(g.time - t0).toFixed(1)} s nach dem Treffer)`);
});

section('2h Sturm gegen Gegner: voller Schild kaum Schildschaden und kein Systemschaden; bei Schild 0 × systemFaktor, Zeit bis Systemzerstörung', () => {
  const { g } = arena(83);
  const e = gegner(g, 'korvette'); e.gestellt = true;
  Testhilfe.setzeSchilde(e, [6, 6, 6, 6]);
  const hp0 = e.hp; const s0 = e.shields.slice();
  for (let i = 0; i < 10; i++) treffer(g, e, 0, 1.08, sturmOpts());
  ok(e.hp === hp0 && e.shields[0] > ST.niedrig && e.shields[0] < s0[0] && e.regenHold > g.time, `10 Nadeln gegen den vollen Schild: kein Systemschaden, Schild ${s0[0]} → ${e.shields[0].toFixed(2)} (steht), Regeneration gesperrt`);
  // genau ein Ziel in der Zone Bug: waffe_bug (emitter_bug ist zerstört); Schild 0
  const h = gegner(g, 'korvette'); h.gestellt = true; nullSchild(h);
  Testhilfe.setzeIntegritaet(h, 'emitter_bug', 0);
  const max = Gsys.maxOf(h, 'waffe_bug'); let nadeln = 0;
  while (zustand(h, 'waffe_bug') !== 'broken' && nadeln < 200) { treffer(g, h, 0, 1.08, sturmOpts()); nadeln++; }
  ok(nadeln === Math.ceil(max / (1.08 * SM.sturm.systemFaktor)), `Zeit bis Systemzerstörung bei Schild 0: ${nadeln} Nadeln (Maximum ${max.toFixed(1)}; ohne Faktor ${Math.ceil(max / 1.08)})`);
});

// ---- Nacharbeit (Review): Sturm bei niedrigem Schild (0 < Schild <= niedrig) und leerer Zone, Lerche und Gegner gleiche Regel (Spiegeltests)
const mitMitte = (fn) => { const c0 = ST.systemChance; ST.systemChance = 1; try { fn(); } finally { ST.systemChance = c0; } };   // Systemchance 1: der Treffer fällt sicher durch (Zufall bleibt game.rng)
const leereZoneBug = (e) => { for (const id of Gsys.ids(e)) if (Gsys.defOf(e.kind, id).zone === 'bug') Testhilfe.setzeIntegritaet(e, id, 0); };
section('2i Nacharbeit 1: Sturm bei niedrigem Schild und leerer Zone sperrt auch die Mitte (Lerche = Gegner)', () => {
  mitMitte(() => {
    const { g } = lerche(1, 31);
    for (const k of zone0()) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
    g.ship.shields.current = [0.5, 6, 6, 6];
    sturmHit(g, 0, 1.08);
    const mitte = I.SYSTEM_ORDER.filter((k) => I.systemSector(k) === -1 && I.integOf(g, k) < I.integMax(g, k));
    ok(mitte.length > 0, 'Lerche: der Treffer ist in die Mitte übergelaufen (' + mitte.join() + ')');
    ok(mitte.length > 0 && mitte.every((k) => I.reparaturGesperrt(g, k)) && g.ship.repSperre[0] > g.time, 'Lerche: Zone 0 und Mitte gesperrt');
    const { g: ga } = arena(91);
    const e = gegner(ga, 'korvette'); e.gestellt = true; leereZoneBug(e);
    Testhilfe.setzeSchilde(e, [0.5, 6, 6, 6]);
    const s0 = Gsys.summe(e);
    treffer(ga, e, 0, 1.08, sturmOpts());
    const mitteIds = Gsys.ids(e).filter((id) => Gsys.defOf('korvette', id).zone === 'mitte');
    ok(Gsys.summe(e) < s0, 'Gegner: der Treffer ist in die Mitte übergelaufen (Systemschaden ' + (s0 - Gsys.summe(e)).toFixed(2) + ')');
    ok(mitteIds.length > 0 && mitteIds.every((id) => Gegnerreparatur.gesperrt(ga, e, id)), 'Gegner: Mitte gesperrt');
  });
});

section('2j Nacharbeit 2: Sturm-Treffer auf Schild 0 < s <= niedrig trifft ein System der Zone × systemFaktor (Lerche = Gegner), darüber nicht', () => {
  mitMitte(() => {
    const L = (s) => { const { g } = lerche(1, 32); g.ship.shields.current = [s, 6, 6, 6]; const v0 = isum(g); sturmHit(g, 0, 1.08); return v0 - isum(g); };
    // G: Zone Bug nur mit waffe_bug (Maximum > Schaden), damit der Abzug nicht an 0 klemmt
    const G = (s) => { const { g } = arena(92); const e = gegner(g, 'korvette'); e.gestellt = true; Testhilfe.setzeIntegritaet(e, 'emitter_bug', 0); Testhilfe.setzeSchilde(e, [s, 6, 6, 6]); const v0 = Gsys.summe(e); treffer(g, e, 0, 1.08, sturmOpts()); return v0 - Gsys.summe(e); };
    const soll = SM.sturmSchaden * SM.sturm.systemFaktor;
    ok(near(L(0.5), soll, 0.06), 'Lerche, Schild 0,5: Integrität −' + L(0.5).toFixed(2) + ' (sturmSchaden × systemFaktor ' + soll + ')');
    ok(near(G(0.5), soll, 0.06), 'Gegner, Schild 0,5: Integrität −' + G(0.5).toFixed(2) + ' (gleich)');
    ok(near(G(ST.niedrig), soll, 0.06) && near(L(ST.niedrig), soll, 0.06), 'Schild genau niedrig (' + ST.niedrig + '): beide wirken');
    ok(L(ST.niedrig + 0.5) === 0 && G(ST.niedrig + 0.5) === 0, 'Schild über niedrig: kein Systemschaden (beide)');
    ok(L(6) === 0 && G(6) === 0, 'voller Schild: kein Systemschaden (beide)');
  });
  const c0 = ST.systemChance; ST.systemChance = 0;
  try {
    const { g } = arena(93); const e = gegner(g, 'korvette'); e.gestellt = true; Testhilfe.setzeSchilde(e, [0.5, 6, 6, 6]); const v0 = Gsys.summe(e);
    treffer(g, e, 0, 1.08, sturmOpts());
    ok(Gsys.summe(e) === v0, 'systemChance 0: kein Systemschaden beim Gegner (Zufall nur game.rng)');
  } finally { ST.systemChance = c0; }
  // der Schild nimmt den Treffer weiter ab (Schild 0,5 -> 0), Regeneration gesperrt
  const { g } = arena(94); const e = gegner(g, 'korvette'); e.gestellt = true; Testhilfe.setzeSchilde(e, [0.5, 6, 6, 6]);
  treffer(g, e, 0, 1.08, sturmOpts());
  ok(e.shields[0] === 0 && e.regenHold > g.time, 'Gegner: Schild 0,5 verbraucht, Regeneration gesperrt');
});

// =============================================================== 3 Torpedo
section('3a Torpedo gegen die Lerche: zwei Treffer zerstören den Reaktor (Countdown), ein Treffer System zerstört und Reaktor beschädigt', () => {
  ok(SM.torpedoLerche === undefined && SM.torpedo.reaktorAnteil === 0.5, 'torpedo.reaktorAnteil 0,5; torpedoLerche entfällt (eine Wahrheit)');
  const { g } = lerche(1, 21); g.ship.shields.current = [0, 0, 0, 0];
  const rmax = I.integMax(g, 'reactor');
  Space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y });
  const b1 = brokenSet(g);
  ok(b1.length === 1 && b1[0] !== 'reactor' && I.systemSector(b1[0]) === 0, `Treffer 1: genau ein System der Bugzone zerstört (${b1.join(',')})`);
  ok(g.ship.systems.reactor === 'damaged' && near(I.integOf(g, 'reactor'), rmax * 0.5) && I.integOf(g, 'reactor') < 0.6 * rmax, `Reaktor beschädigt: ${I.integOf(g, 'reactor')} von ${rmax} (unter 60 %)`);
  ok(!g.ship.reaktorCountdown, 'noch kein Countdown');
  Space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y });
  ok(g.ship.systems.reactor === 'broken' && I.integOf(g, 'reactor') === 0, 'Treffer 2: Reaktor zerstört');
  ok(!!g.ship.reaktorCountdown && near(g.ship.reaktorCountdown.t, 20, 1e-9) && g.ship.reaktorAusfaelle === 1, `Countdown läuft (${g.ship.reaktorCountdown && g.ship.reaktorCountdown.t} s, Ausfall 1)`);
  for (let k = 0; k < 21 * 30 && !g.ship.schiffZerstoert; k++) g.step();
  ok(g.ship.schiffZerstoert === true, 'ohne Rettung: Schiff nach dem Countdown zerstört');
});

section('3b Torpedo gegen die Lerche: stehender Schild prallt ab (Lesart B), leere Zone: nur der Reaktor wird getroffen', () => {
  const { g } = lerche(1, 22);
  const i0 = isum(g);
  Space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y });
  ok(isum(g) === i0 && brokenSet(g).length === 0 && g.ship.shields.current[0] === 6, 'Schild 6: abgeprallt, nichts verändert');
  g.ship.shields.current = [0, 0, 0, 0];
  for (const k of zone0()) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
  const vorher = brokenSet(g); const sum0 = isum(g); const rmax = I.integMax(g, 'reactor');
  Space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y });
  ok(brokenSet(g).join() === vorher.join() && near(sum0 - isum(g), 0.5 * rmax) && g.ship.systems.reactor === 'damaged', `Zone 0 leer: kein weiteres System zerstört, Reaktor direkt getroffen (−${(sum0 - isum(g)).toFixed(1)})`);
});

section('3c Torpedo: tunebar (torpedo.reaktorAnteil 1 = ein Treffer zerstört den Reaktor), Determinismus über game.rng', () => {
  const a0 = SM.torpedo.reaktorAnteil; SM.torpedo.reaktorAnteil = 1;
  try { const { g } = lerche(1, 23); g.ship.shields.current = [0, 0, 0, 0]; Space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y }); ok(g.ship.systems.reactor === 'broken' && !!g.ship.reaktorCountdown, 'reaktorAnteil 1: ein Treffer zerstört den Reaktor, Countdown'); } finally { SM.torpedo.reaktorAnteil = a0; }
  const lauf = (seed) => { const { g } = lerche(1, seed); g.ship.shields.current = [0, 0, 0, 0]; Space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y }); return brokenSet(g).join(); };
  ok(lauf(31) === lauf(31), 'gleicher Seed, gleiches getroffenes System (Zufall nur game.rng)');
  const seen = new Set(); for (let s = 1; s <= 30; s++) seen.add(lauf(s));
  ok(seen.size > 1, `verschiedene Seeds treffen verschiedene Systeme (${[...seen].join(' | ')})`);
  const src = ['server/sim/damage.js', 'server/sim/sturm.js', 'server/sim/gegnerreparatur.js', 'server/sim/gegnersystem.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  ok(!/Math\.random/.test(src), 'kein Math.random in Schaden/Sturm/Gegnersystem');
});

section('3d Torpedo gegen Gegner: Korvette, Fregatte, Kreuzer – ein Treffer System zerstört + Reaktor beschädigt, zwei Treffer Reaktor zerstört (Countdown)', () => {
  for (const kind of ['fregatte', 'kreuzer', 'korvette']) {
    const { g, run } = arena(84);
    const e = gegner(g, kind); e.gestellt = true; nullSchild(e);
    const rid = Gsys.idVon(e, 'reaktor'); const rmax = Gsys.maxOf(e, rid);
    treffer(g, e, 0, 9, torpOpts());
    const b1 = gebrochen(e);
    ok(b1.length === 1 && b1[0] !== rid && Gsys.defOf(kind, b1[0]).zone === 'bug', `${kind}: Treffer 1 zerstört ${b1.join(',')} (Zone Bug)`);
    ok(zustand(e, rid) === 'damaged' && near(e.sys[rid].i, rmax * 0.5) && e.sys[rid].i < 0.6 * rmax, `${kind}: Reaktor beschädigt (${e.sys[rid].i.toFixed(1)} von ${rmax.toFixed(1)}, unter 60 %)`);
    ok(!e.rt || e.rt.rest == null, `${kind}: noch kein Countdown`);
    treffer(g, e, 0, 9, torpOpts());
    ok(zustand(e, rid) === 'broken' && e.rt && near(e.rt.rest, 20, 1e-9), `${kind}: Treffer 2 zerstört den Reaktor, Countdown ${e.rt && e.rt.rest} s`);
    run(21);
    ok(!g.space.enemies.includes(e) && g.stats.kills === 1, `${kind}: stirbt nach dem Countdown`);
  }
});

section('3e Torpedo gegen Gegner: Jäger sofort tot, stehender Schild prallt ab, leere Zone trifft nur den Reaktor', () => {
  const { g } = arena(85);
  const j = gegner(g, 'raider'); nullSchild(j); treffer(g, j, 0, 45, torpOpts());
  ok(!g.space.enemies.includes(j) && g.stats.kills === 1 && SM.torpedoSofortTod.raider === true, 'Jäger bei Schild 0: sofort tot (systemModell.torpedoSofortTod.raider unverändert)');
  const k = gegner(g, 'korvette'); k.gestellt = true; const hp0 = k.hp;
  treffer(g, k, 0, 9, torpOpts());
  ok(k.hp === hp0 && gebrochen(k).length === 0, 'Korvette mit stehendem Schild: Torpedo prallt ab (Lesart B)');
  nullSchild(k); const rid = Gsys.idVon(k, 'reaktor'); const rmax = Gsys.maxOf(k, rid);
  for (const id of Gsys.ids(k)) if (Gsys.defOf('korvette', id).zone === 'bug') Testhilfe.setzeIntegritaet(k, id, 0);
  const vorher = gebrochen(k).join(); const sum0 = Gsys.summe(k);
  treffer(g, k, 0, 9, torpOpts());
  ok(gebrochen(k).join() === vorher && near(sum0 - Gsys.summe(k), 0.5 * rmax) && zustand(k, rid) === 'damaged', `Zone Bug leer: kein weiteres System zerstört, Reaktor direkt getroffen (−${(sum0 - Gsys.summe(k)).toFixed(1)})`);
  const e1 = gegner(g, 'fregatte'); e1.gestellt = true; nullSchild(e1);
  treffer(g, e1, 1, 9, torpOpts());
  ok(gebrochen(e1).length === 1 && Gsys.defOf('fregatte', gebrochen(e1)[0]).zone === 'stb', 'Torpedo auf die Steuerbordseite trifft ein Steuerbord-System (Zone folgt der Seite)');
});

console.log(`\ntest-sys02a: ${n - fails}/${n} Prüfungen bestanden${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
