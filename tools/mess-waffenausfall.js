'use strict';
// SPT-02 9: Messung „Waffe der zugewandten Seite zerstört“ (Wenden bei Waffenausfall), vorher/nachher mit gleichem Seed. Nur messen, schreibt nichts ins Repo.
//   node tools/mess-waffenausfall.js [--seed 161354297] [--seeds 10] [--dauer 180] [--art korvette|fregatte] [--fahrt] [--aus]   (--aus: Schalter waffenWechsel.an false = Stand vor Paket 9)
// Eine Korvette (alle Plätze Bolzen) gegen die stehende, unverwundbare Lerche in der Szene splitter (Freie Fahrt, V2). Ab t=60 s (sobald eine Seite zur Lerche steht) wird die Waffe der der Lerche
// zugewandten Seite zerstört und dort gehalten (der Gegner repariert sonst selbst); danach --dauer s: Schüsse der Korvette, Seitenwechsel (Wechsel des zugewandten Sektors,
// ohne Rauschen innerhalb 1 s), Zeit mit funktionierender Waffe im Bogen. Zweiter Lauf „frei“: ohne Halten (Gegner repariert, 10 s), Wechselhäufigkeit = Flattern.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Space = require('../server/sim/space.js');
const Physics = require('../shared/physics.js');
const Testhilfe = require('./gegner-testhilfe.js');
const args = process.argv.slice(2);
const val = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const SEED0 = Number(val('--seed', 161354297)) | 0;
const SEEDS = Math.max(1, Number(val('--seeds', 10)) | 0);
const DAUER = Number(val('--dauer', 180));
const ART = val('--art', 'korvette');
const FAHRT = args.includes('--fahrt');   // die Lerche kreist langsam (Radius 500 px, 40 px/s) statt zu stehen
if (args.includes('--aus')) CONFIG.spaceM3b.pilot.waffenWechsel.an = false;
const DT = 1 / CONFIG.tickHz;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messwaffe-'));
const SEITE = ['bug', 'stbd', 'heck', 'bb'];

function lauf(seed, halten) {
  const dir = path.join(TMP, 'w' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie'), TELEMETRIE: 'aus' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 3; i++) { const c = { inbox: [], send() {}, sendRaw() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); cs.push(c); }
  g.lobbyOpts.startMission = 'freie_fahrt';
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 2 * CONFIG.tickHz; i++) g.step();
  g.ship.docked = false; g.ship.dockedAt = null;
  Space.enterScene(g, 'splitter', {});
  g.space.enemies = []; g.space.projectiles = []; g.god = true;
  const sh = g.ship;
  sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0;
  const waffen = {}; for (const w of g.C.enemyWeapons[ART]) waffen[w.platz] = 'bolzen';
  const e = Space.spawnEnemy(g, ART, { angle: 0.7, tag: 'sonde', waffen });
  const seen = new Set(); let schuss = 0, wechsel = 0, last = null, tBruch = null, imBogenOk = 0, tAus = 0;
  const T0 = 60;
  let ang = 0; const om = 0.08, R0 = 500;
  for (let i = 0, N = Math.round((T0 + DAUER) / DT); i < N; i++) {
    if (FAHRT) { ang += om * DT; sh.x = g.space.w / 2 + Math.cos(ang) * R0; sh.y = g.space.h / 2 + Math.sin(ang) * R0; sh.angle = ang + Math.PI / 2; sh.vx = -Math.sin(ang) * R0 * om; sh.vy = Math.cos(ang) * R0 * om; }
    g.step();
    const t = i * DT;
    if (!g.space.enemies.includes(e)) break;
    const sec = Physics.sectorOf(e.x, e.y, e.angle, sh.x, sh.y);
    if (tBruch === null && t >= T0 && (sec === 1 || sec === 3)) {   // erst wenn die Seite wirklich zur Lerche steht
      tBruch = t;
      const ids = Object.keys(e.sys).filter((k) => k.startsWith('waffe_' + SEITE[sec]));
      for (const id of ids) Testhilfe.setzeIntegritaet(e, id, 0);
      e.__tot = ids; last = sec;
    }
    if (tBruch !== null) {
      // nur die ursprünglich zerstörte Seite wird gehalten (die Gegenseite bleibt heil)
      if (halten) for (const id of e.__tot) if (e.sys[id].z !== 'broken') Testhilfe.setzeIntegritaet(e, id, 0);
      for (const p of g.space.projectiles) if (p.owner === e.id && !seen.has(p.id)) { seen.add(p.id); schuss++; }
      if (sec !== last && (sec === 1 || sec === 3)) { wechsel++; last = sec; }
      const plaetze = Space.waffenPlaetze(g, e, null).filter((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, w.range, sh.x, sh.y));
      if (plaetze.length) imBogenOk += DT; else tAus += DT;
    } else for (const p of g.space.projectiles) if (p.owner === e.id) seen.add(p.id);
  }
  return { seed, schuss, wechsel, imBogenOk: Math.round(imBogenOk), tAus: Math.round(tAus), fehler: g.errors || 0 };
}
const stand = args.includes('--aus') ? 'VORHER (waffenWechsel aus)' : 'NACHHER (waffenWechsel an)';
console.log(`Waffe zugewandter Seite zerstört – ${ART}, Lerche ${FAHRT ? 'kreist' : 'steht'}, ${DAUER} s nach Bruch, ${stand}`);
let fehler = 0;
for (const [name, halten] of [['gehalten (Gegner repariert nicht)', true], ['frei (Gegner repariert selbst)', false]]) {
  console.log(`\n${name}`);
  let s = 0, w = 0, ok = 0, aus = 0, mitSchuss = 0, mitWechsel = 0;
  for (let k = 0; k < SEEDS; k++) {
    const r = lauf(SEED0 + k, halten); fehler += r.fehler; s += r.schuss; w += r.wechsel; ok += r.imBogenOk; aus += r.tAus; if (r.schuss > 0) mitSchuss++; if (r.wechsel > 0) mitWechsel++;
    console.log(`  Seed ${r.seed}: Schüsse ${r.schuss}, Seitenwechsel ${r.wechsel}, Lerche im Bogen einer funktionierenden Waffe ${r.imBogenOk} s, ohne ${r.tAus} s, Fehler ${r.fehler}`);
  }
  console.log(`  SUMME: Schüsse ${s} (mittel ${(s / SEEDS).toFixed(1)}), Seitenwechsel ${w} (mittel ${(w / SEEDS).toFixed(2)}, ${mitWechsel}/${SEEDS} Läufe), Läufe mit Schüssen ${mitSchuss}/${SEEDS}, Zeit im Bogen ${(ok / SEEDS).toFixed(0)} s / ohne ${(aus / SEEDS).toFixed(0)} s`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fehler ? 1 : 0);
