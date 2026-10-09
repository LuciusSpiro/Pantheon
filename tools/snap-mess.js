'use strict';
// Snapshot-Messung (CONTRACT-W1 §2.3 Punkt 2): Größe von g.snapshot() in zwei Aufbauten, gemessen in JEDEM Tick.
//   node tools/snap-mess.js            -> Tabelle
//   node tools/snap-mess.js --json     -> JSON (für Berichte)
//   node tools/snap-mess.js --seeds 5 --sek 20
//
// Aufbauten:
//   worst   wie test-combat.js „B2: Snapshot Außenposten, 3 Spieler, 12 Gegner“: Außenposten, 3 Spieler, 12 Gegner,
//           alle 15 Ticks zwei Granaten. Je Seed `--sek` Sekunden.
//   wellen  Bodenkampf: Wellen zu dritt (Außenposten und Kesh), Debug `welle 11`, bis CONFIG.wellen.maxLebend Gegner
//           stehen und darüber hinaus (`--sek`), alle 2 s fällt ein Gegner (Nachschub rückt nach).
// Ausgabe je Aufbau: Max, p95, Mittel; Bytes je Top-Level-Schlüssel (Mittel und im Max-Snapshot); Bytes je Gegner
// (Mittel) und je Gegnerfeld bzw. Spielerfeld (Mittel, Anteil am Gegner bzw. Spieler).
// Gemessen wird wie im Vertrag: Buffer.byteLength(JSON.stringify(g.snapshot())). Grenze: CONFIG.net.snapMax − snapLuft.
const CONFIG = require('../shared/config.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const W2 = require('../server/sim/waffen.js');

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const JSON_OUT = has('--json');
const SEEDS = Math.max(1, Number(val('--seeds', 5)) || 5);
const SEK = Math.max(1, Number(val('--sek', 20)) || 20);
const TICKS = Math.round(SEK * CONFIG.tickHz);
const MAX = CONFIG.net.snapMax;
const LUFT = CONFIG.net.snapLuft;
const ZIEL = MAX - LUFT;
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
const log = () => {};

// ---------- Sammler ----------
function sammler(name) {
  return { name, sizes: [], max: 0, maxSnap: null, keySum: {}, droneSum: 0, droneN: 0, dFeld: {}, pFeld: {}, playerSum: 0, playerN: 0, maxDrones: 0 };
}
function messen(S, snap) {
  const b = bytes(snap);
  S.sizes.push(b);
  if (b > S.max) { S.max = b; S.maxSnap = snap; }
  for (const [k, v] of Object.entries(snap)) S.keySum[k] = (S.keySum[k] || 0) + bytes(v) + Buffer.byteLength(k) + 4;
  const ds = (snap.away && snap.away.drones) || [];
  S.maxDrones = Math.max(S.maxDrones, ds.length);
  for (const d of ds) {
    S.droneSum += bytes(d) + 1; S.droneN++;
    for (const [k, v] of Object.entries(d)) S.dFeld[k] = (S.dFeld[k] || 0) + (v === undefined ? 0 : bytes(v) + Buffer.byteLength(k) + 4);
  }
  for (const p of snap.players || []) {
    S.playerSum += bytes(p) + 1; S.playerN++;
    for (const [k, v] of Object.entries(p)) S.pFeld[k] = (S.pFeld[k] || 0) + (v === undefined ? 0 : bytes(v) + Buffer.byteLength(k) + 4);
  }
}
function auswerten(S) {
  const s = S.sizes.slice().sort((a, b) => a - b);
  const n = s.length;
  const p95 = s[Math.min(n - 1, Math.floor(n * 0.95))];
  const mittel = Math.round(s.reduce((a, b) => a + b, 0) / Math.max(1, n));
  const keys = Object.entries(S.keySum).map(([k, v]) => ({ k, mittel: Math.round(v / n), imMax: S.maxSnap && k in S.maxSnap ? bytes(S.maxSnap[k]) + Buffer.byteLength(k) + 4 : 0 }))
    .sort((a, b) => b.mittel - a.mittel);
  const feld = (sum, cnt) => Object.entries(sum).map(([k, v]) => ({ k, mittel: Math.round(v / Math.max(1, cnt) * 10) / 10 })).sort((a, b) => b.mittel - a.mittel);
  return {
    aufbau: S.name, snapshots: n, max: S.max, p95, mittel, ziel: ZIEL, grenze: MAX, ok: S.max <= ZIEL,
    gegnerMax: S.maxDrones,
    jeGegner: Math.round(S.droneSum / Math.max(1, S.droneN) * 10) / 10,
    jeSpieler: Math.round(S.playerSum / Math.max(1, S.playerN) * 10) / 10,
    gegnerImMax: S.maxSnap && S.maxSnap.away ? S.maxSnap.away.drones.length : 0,
    keys, gegnerFelder: feld(S.dFeld, S.droneN), spielerFelder: feld(S.pFeld, S.playerN),
  };
}

// ---------- Aufbau 1: Worst Case (wie test-combat.js, B2 Snapshot Außenposten) ----------
function worstCase(S, seed) {
  const L = require('../server/sim/landepunkte.js');
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log });
  for (let i = 0; i < 3; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S' + i, name: 'S' + i, color: i }); g.handleMessage(c, { t: 'ready', ready: true }); }
  const lp = Object.values(L.defs().byId || {}).filter((x) => x.art === 'aussenposten' && !x.gesperrt).map((x) => x.id).find((id) => { try { L.get(g, id); return true; } catch (e) { return false; } });
  if (!lp) throw new Error('kein baubarer Außenposten');
  g.setAwayMap(lp);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  g.weltstand.data.rollen_gesehen = ['niederhalter', 'grenadier', 'schuetze', 'enterer', 'haescher'];
  combat.besetzen(g, { map: lp, fraktion: 'rostmeute', staerke: 'gross', haltung: 'wach', tag: 'm' });
  while (g.away.drones.filter((d) => d.alive).length > 12) g.away.drones.pop();
  let i = 0;
  while (g.away.drones.length < 12) { const t = Physics.toTile(g.players[0].x, g.players[0].y); const e = squad.makeEnemy(g, g.away, 'scavenger', 'f' + (i++), Physics.tileCenter(t.x + 6, t.y), 'm'); e.rolle = 'niederhalter'; g.away.drones.push(e); }
  for (let k = 0; k < TICKS; k++) {
    g.step();
    for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
    if (k % 15 === 0) {
      for (const e of [g.away.drones[0], g.away.drones[1]]) { if (!e) continue; W2.ausstatten(g, e, 'grenadier'); e.bereitAt = 0; e.gesperrtBis = 0; W2.feuern(g, e, { x: g.players[0].x, y: g.players[0].y }); }
    }
    messen(S, g.snapshot());
  }
  return { lp, fehler: g.errors };
}

// ---------- Aufbau 2: Wellenlauf (wie test-wellen.js „kampf“) ----------
function wellenlauf(S, seed, karte) {
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log });
  const cs = [];
  for (let i = 0; i < 3; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'W' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_away', wellen: karte });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  g.handleMessage(cs[0], { t: 'debug', cmd: 'welle', args: [11] });
  const WTAG = require('../server/sim/wellen.js').TAG;
  const stehend = () => (g.away.drones || []).filter((e) => e.tag === WTAG && e.alive);
  let maxSt = 0, erreicht = -1;
  for (let k = 0; k < TICKS; k++) {
    g.step();
    for (const p of g.players) if (p.downed) combat.revive(g, p, null, { quiet: true });
    const st = stehend().length;
    maxSt = Math.max(maxSt, st);
    if (erreicht < 0 && st >= CONFIG.wellen.maxLebend) erreicht = k;
    messen(S, g.snapshot());
    if (k % 60 === 30) { const e = stehend()[0]; if (e) { for (let j = 0; j < 10 && e.alive; j++) combat.hitEnemy(g, e, 1, { pid: g.players[k % 3].id, wirkung: { schaden: 9, wunde: true } }); e.zustand = 'aus'; } }
  }
  return { karte, maxStehend: maxSt, maxLebendAbTick: erreicht, fehler: g.errors };
}

// ---------- Lauf ----------
const t0 = Date.now();
const W = sammler('worst'), WL = sammler('wellen');
const laeufe = { worst: [], wellen: [] };
for (let s = 1; s <= SEEDS; s++) laeufe.worst.push(Object.assign({ seed: s }, worstCase(W, s)));
for (const karte of ['aussenposten', 'kesh']) for (let s = 1; s <= SEEDS; s++) laeufe.wellen.push(Object.assign({ seed: s }, wellenlauf(WL, 20 + s, karte)));
const res = { ziel: ZIEL, grenze: MAX, luft: LUFT, seeds: SEEDS, sek: SEK, worst: auswerten(W), wellen: auswerten(WL), laeufe, ms: Date.now() - t0 };

if (JSON_OUT) { console.log(JSON.stringify(res, null, 1)); process.exit(0); }

function zeigen(r) {
  console.log(`\n[${r.aufbau}] ${r.snapshots} Snapshots: max ${r.max} B, p95 ${r.p95} B, Mittel ${r.mittel} B  (Ziel ≤ ${r.ziel} B: ${r.ok ? 'ok' : 'VERFEHLT um ' + (r.max - r.ziel) + ' B'})`);
  console.log(`  Gegner: höchstens ${r.gegnerMax} im Snapshot, ${r.gegnerImMax} im Max-Snapshot, je Gegner ${r.jeGegner} B (Mittel); je Spieler ${r.jeSpieler} B`);
  console.log('  Top-Level (Mittel / im Max-Snapshot): ' + r.keys.filter((x) => x.mittel >= 40).map((x) => `${x.k} ${x.mittel}/${x.imMax}`).join(', '));
  console.log('  Gegnerfelder (B je Gegner): ' + r.gegnerFelder.map((x) => `${x.k} ${x.mittel}`).join(', '));
  console.log('  Spielerfelder (B je Spieler): ' + r.spielerFelder.map((x) => `${x.k} ${x.mittel}`).join(', '));
}
console.log(`Snapshot-Messung: Grenze ${MAX} B, Luft ${LUFT} B -> Ziel ≤ ${ZIEL} B; ${SEEDS} Seeds × ${SEK} s, jeder Tick`);
zeigen(res.worst);
console.log('  Läufe: ' + laeufe.worst.map((l) => `s${l.seed} ${l.lp}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.wellen);
console.log('  Läufe: ' + laeufe.wellen.map((l) => `${l.karte}/s${l.seed} stehend max ${l.maxStehend}${l.maxLebendAbTick >= 0 ? ' (maxLebend ab Tick ' + l.maxLebendAbTick + ')' : ' (maxLebend NICHT erreicht)'}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
console.log(`\n${res.worst.ok && res.wellen.ok ? 'ok' : 'VERFEHLT'}: Worst Case max ${res.worst.max} B, Wellenlauf max ${res.wellen.max} B (Ziel ≤ ${ZIEL} B) – ${res.ms} ms`);
process.exit(0);
