'use strict';
// Snapshot-Messung (CONTRACT-W1 §2.3 Punkt 2): Größe von g.snapshot() in zwei Aufbauten, gemessen in JEDEM Tick.
//   node tools/snap-mess.js            -> Tabelle
//   node tools/snap-mess.js --json     -> JSON (für Berichte)
//   node tools/snap-mess.js --seeds 5 --sek 20
//
// Aufbauten:
//   worst   wie test-combat.js „B2: Snapshot Außenposten, 4 Spieler, 12 Gegner“: Außenposten, 4 Spieler, 12 Gegner,
//           alle 15 Ticks zwei Granaten. Je Seed `--sek` Sekunden.
//   wellen  Bodenkampf: Wellen zu dritt (Außenposten und Kesh), Debug `welle 11`, bis CONFIG.wellen.maxLebend Gegner
//           stehen und darüber hinaus (`--sek`), alle 2 s fällt ein Gegner (Nachschub rückt nach).
//   methalle  EK5 Methalle: Labor-Umsetzung sabotieren/sprengstoff_platzieren, 4 Spieler, 6 + 2 Wachen (Obergrenze 8) auf Patrouille.
//   endkampf  EK6 Siedlung Eisenwald: Labor-Umsetzung stellung_nehmen/flagge_hissen, 4 Spieler, Feldzeichen gehisst -> 10 Gegner und der
//           Anführer (Modifikator, Bit gs) greifen von allen Seiten an, alle Spieler bleiben stehen (Worst Case: 4 Spieler + 11 Gegner).
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
// SUND-04a-3: Worst Case des Blocks world.finale (Angebot, offene Anfrage und Phase zugleich, in jedem Snapshot gesendet: der Schlüssel wird vor jedem Snapshot zurückgesetzt)
const finaleWorst = (g) => { g.sentFinaleKey = null; if (g.weltsim) g.weltsim.finale = { phase: 'boden', angebot: 1, anfrage: { bis: g.time + 10 }, frei_ab: 0, versuche: 0 }; };
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
  for (let i = 0; i < 4; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S' + i, name: 'S' + i, color: i }); g.handleMessage(c, { t: 'ready', ready: true }); }
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
  for (let i = 0; i < 4; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'W' + i, color: i }); cs.push(c); }
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
    if (k % 60 === 30) { const e = stehend()[0]; if (e) { for (let j = 0; j < 10 && e.alive; j++) combat.hitEnemy(g, e, 1, { pid: g.players[k % 4].id, wirkung: { schaden: 9, wunde: true } }); e.zustand = 'aus'; } }
  }
  return { karte, maxStehend: maxSt, maxLebendAbTick: erreicht, fehler: g.errors };
}

// ---------- Aufbau 3 (EK2): Raum-Alarm – Schleichfahrt mit 12 Minen (Weitscan), 4 Patrouillen, 8 gescannte Gegner, Alarm ----------
function raumAlarm(S, seed) {
  const space = require('../server/sim/space.js');
  const Alarm = require('../server/sim/alarm.js');
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log });
  for (let i = 0; i < 4; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'R' + i, name: 'R' + i, color: i }); }
  g.reset(); g.phase = 'play';
  space.enterScene(g, 'splitter', {});
  g.space.enemies = [];
  for (let i = 0; i < 4; i++) Alarm.patrouilleSetzen(g, { n: 1, x: 600 + i * 500, y: 300, x2: 600 + i * 500, y2: 1300, kind: 'korvette' });
  Alarm.an(g, { schleichfahrt: true });
  Alarm.zielSetzen(g, 2750, 800, 150);
  Alarm.minenSetzen(g, { n: 12, x: 1500, y: 800, radius: 1000 });
  g.ship.widescan.cd = 0; space.weaponsWidescan(g);
  for (let i = 0; i < 8; i++) { const e = space.spawnEnemy(g, i % 2 ? 'raider' : 'korvette', { x: 400 + i * 120, y: 1450 }); e.scanned = true; }
  Alarm.ausloeser(g, 'mine');
  for (let k = 0; k < TICKS; k++) {
    for (const p of g.players) { p.console = p.console || null; }
    g.ship.hull = 100;
    g.step();
    messen(S, g.snapshot());
  }
  return { fehler: g.errors };
}

// ---------- Aufbau 3/4: EK5 Methalle und EK6 Endkampf (Labor-Umsetzungen, 4 Spieler) ----------
function laborSpiel(id, seed) {
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log });
  const cs = [];
  for (let i = 0; i < 4; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'E' + i, name: 'E' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'labor', labor: { id, seed } });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 10; k++) g.step();
  return g;
}
function untenAuf(g, lp) {
  require('../server/sim/landepunkte.js').get(g, lp);
  g.transferZiel = { lp, scene: g.ship.scene }; g.setAwayMap(lp);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
}
const ankerVon = (lp, rolle) => require('../server/world.js').AWAY_MAPS[lp].karte.anker.find((x) => x.rolle === rolle);
function methalleLauf(S, seed) {
  const lp = 'splitter.methalle';
  const g = laborSpiel('sabotieren/sprengstoff_platzieren', seed);
  untenAuf(g, lp);
  const Anker = require('../server/sim/anker.js');
  let platziert = false;
  for (let k = 0; k < TICKS; k++) {
    g.step();
    for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
    if (!platziert && k > TICKS / 4) { platziert = true; Anker.completeHold(g, g.players[0], { kind: 'anker:sprengpunkt', anker: ankerVon(lp, 'sprengpunkt').id }); }   // Platzieren löst Welle 2 aus
    messen(S, g.snapshot());
  }
  return { lp, wachen: g.aways[lp].drones.filter((e) => e.alive).length, fehler: g.errors };
}
function endkampfLauf(S, seed) {
  const lp = 'splitter.eisenwald';
  const g = laborSpiel('stellung_nehmen/flagge_hissen', seed);
  untenAuf(g, lp);
  g.weltstand.data.rollen_gesehen = ['niederhalter', 'grenadier', 'schuetze', 'enterer'];
  require('../server/sim/anker.js').setzen(g, lp, ankerVon(lp, 'flagge').id, 'gehisst', g.players[0].id);   // die Szene startet daraufhin den Angriff
  let max = 0, boss = 0;
  for (let k = 0; k < TICKS; k++) {
    g.step();
    for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
    const sn = g.snapshot(); messen(S, sn);
    const ds = (sn.away && sn.away.drones) || [];
    max = Math.max(max, ds.length); if (ds.some((d) => d.gs)) boss = 1;
  }
  return { lp, gegner: max, boss, fehler: g.errors };
}

// ---------- Aufbau (SUND-04a-3 Boden): Schrein von Asgard – Freie Fahrt Sund, 4 Spieler landen auf hrafnheim.schrein, 10 Wachen und der Waechter greifen von allen Seiten an,
// alle Spieler bleiben stehen (Worst Case: 4 Spieler + 11 Gegner + world.finale mit allen Feldern) ----------
function bodenLauf(S, seed) {
  const fs = require('fs'), os = require('os'), path = require('path');
  const Finale = require('../server/sim/finale.js');
  const interior = require('../server/sim/interior.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-boden-'));
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(dir, 'regie') }, log });
  const cs = [];
  for (let i = 0; i < 4; i++) { const c = { send() {}, sendRaw() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'B' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 30; k++) g.step();
  g.space.enemies = [];
  g.debugGoto('hrafnheim', false); for (let k = 0; k < 40; k++) g.step();
  g.weltsim.ruf.rom = 1e9;
  Finale.ersetzen('szene', { finaleStarten: () => ({ id: 1 }) });
  Finale.ersetzen('abspann', { beenden: () => true });
  g.ship.speed = 0;
  Finale.starten(g); Finale.orbitEnde(g, 'sieg');
  g.players.forEach((p, i) => { interior.placeOnShipPad(g, p, i); p.console = 'transfer'; });
  g.handleMessage(cs[0], { t: 'cmd', c: 'transfer.down' });
  let max = 0, boss = 0;
  for (let k = 0; k < TICKS + 100; k++) {
    g.step();
    for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
    g.sentLageKey = null; g.sentAbsichtKey = null; finaleWorst(g); g.sentFunkKey = null;
    const sn = g.snapshot(); if (k >= 100) messen(S, sn);
    const ds = (sn.away && sn.away.drones) || [];
    max = Math.max(max, ds.length); if (ds.some((d) => d.gs)) boss = 1;
  }
  const unten = g.players.filter((p) => p.zone === 'away').length;
  Finale.ersetzen('szene', null); Finale.ersetzen('abspann', null);
  return { lp: 'hrafnheim.schrein', gegner: max, boss, unten, fehler: g.errors };
}

// ---------- Aufbau 4 (EK3 Teil B): Konvoi – 4 Spieler, Rabenpass, 3 Transporter mit Eskorte (alle gescannt), 2 Transporter zerstört (Fracht liegt),
// einer lädt den Sprung, Beamen läuft, eine Ladung schon an Bord ----------
function konvoi(S, seed) {
  const space = require('../server/sim/space.js');
  const Konvoi = require('../server/sim/konvoi.js');
  const Fracht = require('../server/sim/fracht.js');
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log });
  for (let i = 0; i < 4; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); }
  g.reset(); g.phase = 'play';
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = [];
  Konvoi.an(g, { n: 3, sieg: 'pluendern', eskorte: 'voll' });
  for (const e of g.space.enemies) e.scanned = true;
  g.players[0].console = 'weapons';
  Fracht.anBordLegen(g, 'sprengstoff');
  for (let k = 0; k < TICKS; k++) {
    if (k === 30) { const T = Konvoi.transporter(g); space.damageEnemy(g, T[0], 9999, T[0].x - 30, T[0].y); space.damageEnemy(g, T[1], 9999, T[1].x - 30, T[1].y); }
    if (k === 60) { const T = Konvoi.transporter(g)[0]; if (T) { T.sprung = 1; T.sprungDauer = 8; } const d = Fracht.draussen(g)[0]; if (d) { g.ship.x = d.x - 100; g.ship.y = d.y; Fracht.beamStart(g, g.players[0], null); } }
    g.ship.hull = 100;
    g.step();
    messen(S, g.snapshot());
  }
  return { fehler: g.errors };
}

// ---------- Aufbau (SUND-04a-1 A): Verfolgung – Worst Case: 4 Spieler, Rabenpass, Zielschiff (Fregatte) flieht und lädt den Sprung, gescannt, Systemziel Antrieb, Antrieb beschädigt dann ausgefallen,
// dazu 3 gescannte Gegner mit Antriebsschaden (Jäger, Korvetten) und Sperrfeuer ----------
function verfolgung(S, seed) {
  const space = require('../server/sim/space.js');
  const Verfolgung = require('../server/sim/verfolgung.js');
  const Zs = require('../server/sim/zielsysteme.js');
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log });
  for (let i = 0; i < 4; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'V' + i, name: 'V' + i, color: i }); }
  g.reset(); g.phase = 'play';
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = [];
  g.god = true;
  g.players[0].console = 'weapons';
  Verfolgung.starten(g, { klasse: 'fregatte', name: 'Brynja', volk: 'ger', wiederholung: true });
  const ziel = Verfolgung.ziel(g);
  const beg = [];
  for (const kind of ['raider', 'korvette', 'korvette']) beg.push(space.spawnEnemy(g, kind, { x: g.ship.x + 300 + beg.length * 90, y: g.ship.y + 200 - beg.length * 120, tag: 'vf_beg' }));
  for (const e of g.space.enemies) e.scanned = true;
  g.ship.target = ziel.id; Zs.waehle(g, 'antrieb');
  const treffer = (e) => space.damageEnemy(g, e, 3, e.x - Math.cos(e.angle) * 60, e.y - Math.sin(e.angle) * 60, { angriff: true });
  for (let k = 0; k < TICKS; k++) {
    if (k === 20) treffer(ziel);
    if (k === 80) { treffer(ziel); for (const e of beg) treffer(e); }
    if (k === 140) for (const e of beg) { g.ship.zielsystem = 'antrieb'; g.ship.target = e.id; treffer(e); }
    g.ship.hull = 100;
    g.step();
    messen(S, g.snapshot());
  }
  return { fehler: g.errors, ausgang: Verfolgung.ausgang(g) || '-' };
}

// ---------- Aufbau 4 (EK4): Flotte – Worst Case: Lerche (4 Spieler), 2 Verbündete mit KI, Gegner bis zur Grenze von 12 Schiffen (alle gescannt,
// Korvetten/Fregatten/Kreuzer mit Waffenlisten), Befehl mit Wegpunkten und Frist, Welle mit Nachschub, Sperrfeuer und Verbündetenfeuer ----------
function flotte(S, seed) {
  const space = require('../server/sim/space.js');
  const Flotte = require('../server/sim/flotte.js');
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log });
  for (let i = 0; i < 4; i++) { const c = { send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F' + i, name: 'F' + i, color: i }); }
  g.reset(); g.phase = 'play';
  space.enterScene(g, 'splitter', {});
  g.space.enemies = [];
  g.god = true;
  Flotte.aufstellen(g, { tag: 'fulminata', kind: 'korvette' });
  Flotte.aufstellen(g, { tag: 'audax', kind: 'fregatte' });
  Flotte.befehl(g, { art: 'durchbrechen', punkte: 'mitte;ost;nord', frist: 400 });
  Flotte.wellenStart(g, { wellen: 'korvette:3,fregatte:2,kreuzer:1,raider:6|kreuzer:2,raider:6', ziel: 'auto', richtung: 'alle', takt: 0, ueberdruck: true });
  let max = 0;
  for (let k = 0; k < TICKS; k++) {
    g.ship.hull = 100;
    g.step();
    for (const e of g.space.enemies) e.scanned = true;
    if (k % 90 === 60) { const e = g.space.enemies[0]; if (e) { e.hp = 1; space.damageEnemy(g, e, 99, e.x - 50, e.y); } }   // alle 3 s fällt einer: Nachschub rückt nach
    max = Math.max(max, Flotte.schiffe(g));
    messen(S, g.snapshot());
  }
  return { fehler: g.errors, schiffeMax: max };
}

// ---------- Aufbau 8 (VERK-ORBIT): Orbitschlacht Eisenwald – Kapitel 6 der Kette, Befehl 3 (Fregatte als Boss), 4 Spieler, Fulminata und Audax mit KI,
// Gegner bis zur Grenze von 12 Schiffen (Fregatte, Korvetten, Jäger, alle gescannt) plus Nachschub, Befehl mit Frist, Welle, Verbündetenfeuer ----------
function orbit(S, seed) {
  const fs = require('fs'), os = require('os'), path = require('path');
  const space = require('../server/sim/space.js');
  const Flotte = require('../server/sim/flotte.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-orbit-mess-'));
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(dir, 'regie') }, log });
  const cs = [];
  for (let i = 0; i < 4; i++) { const c = { send() {}, sendRaw() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'O' + i, name: 'O' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'eisenwald_ohne' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 15; k++) g.step();
  g.mission.kette.einstieg('k6_orbit'); for (let k = 0; k < 9; k++) g.step();
  space.enterScene(g, 'eisenwald', {}); g.god = true;
  for (let k = 0; k < 30 * 14; k++) g.step();   // Kette: Anflug, Ankunft (Verbündete tauchen auf)
  g.mission.setStep('befehl3_ausschalten');
  for (let k = 0; k < 30; k++) g.step();
  Flotte.wellenStart(g, { wellen: 'korvette:3,raider:6|korvette:2,raider:6', ziel: 'auto', richtung: 'alle', takt: 0, ueberdruck: true });
  let max = 0;
  for (let k = 0; k < TICKS; k++) {
    g.ship.hull = 100;
    g.step();
    for (const e of g.space.enemies) e.scanned = true;
    if (k % 90 === 60) { const e = g.space.enemies.find((x) => x.kind !== 'fregatte'); if (e) { e.hp = 1; space.damageEnemy(g, e, 99, e.x - 50, e.y); } }
    max = Math.max(max, Flotte.schiffe(g));
    messen(S, g.snapshot());
  }
  const fehler = g.errors;
  g.releaseWorldLock && g.releaseWorldLock();
  return { fehler, schiffeMax: max, fregatte: g.space.enemies.some((e) => e.kind === 'fregatte') };
}

// ---------- Aufbau 9 (SUND-01 B): Freie Fahrt Sund – 4 Spieler, Modus gestartet, 40 Sim-Ticks gelaufen (Posten stehen), erst im Hafen Vulcania
// (Station mit Banner fr, Dock-Marker), dann an einem Posten (kleine Station mit Fahne); je Szene 8 gescannte Jäger. Die Sim selbst gehört nie
// in den Snapshot: gemessen wird, was die Marker (fr, posten) und der Modus an Bytes kosten. ----------
function freieFahrt(S, seed) {
  const fs = require('fs'), os = require('os'), path = require('path');
  const space = require('../server/sim/space.js');
  const Kriegslage = require('../server/sim/kriegslage.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-ff-mess-'));
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(dir, 'regie') }, log });
  const cs = [];
  for (let i = 0; i < 4; i++) { const c = { send() {}, sendRaw() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'FF' + i, name: 'FF' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 15; k++) g.step();
  for (let i = 0; i < 40; i++) Kriegslage.tick(g, 'sprung');
  const posten = Object.entries(g.weltsim.zustand.hexe).filter(([, h]) => h.posten).map(([c]) => c);
  const Sektoren = require('../shared/sektoren.js');
  // SUND-02b D: Worst Case des Blocks world.absicht: Tribun, Angebot mit 3 Karten (die längsten Namen und Texte), in jedem Snapshot gesendet (der Schlüssel wird vor jedem Snapshot zurückgesetzt)
  const Absicht = require('../server/sim/absicht.js');
  g.weltsim.ruf.rom = 100;
  g.weltsim.absicht.angebot = { ids: Absicht.KATALOG.slice().sort((x, y) => (y.name.length + y.text.length) - (x.name.length + x.text.length)).slice(0, 3).map((k) => k.id), t: g.weltsim.tickZahl, bis: g.weltsim.tickZahl + 100000 };
  let absichtMax = 0, absichtMitMax = 0;
  // SUND-03b A: Worst Case des Blocks world.funkwahl: Angebot mit 3 Optionen (je 40 Zeichen), der längste Sprecher des Katalogs, in jedem Snapshot gesendet (der Schlüssel wird vor jedem Snapshot zurückgesetzt); der Schalter der Reise-Ereignisse ist dafür an
  const FunkAntwort = require('../server/sim/funk-antwort.js'), RE = require('../server/sim/reise-ereignis.js');
  g.env.REISE_EREIGNISSE = '1';
  g.weltsim.funkwahl = FunkAntwort.neu();
  g.weltsim.funkwahl.offen = { lfd: 99999, id: 'funk_lage_ger', ev: {}, von: RE.KATALOG.map((e) => e.sprecher).sort((x, y) => y.length - x.length)[0], bis: g.weltsim.reise.n + 100000, optionen: ['a', 'b', 'c'].map((i) => ({ id: 'option_' + i, text: ('Erzählt es den Kontoren im Saumhafen ' + i).slice(0, 40).padEnd(40, 'x') })) };
  let funkMax = 0, funkMitMax = 0;
  // SUND-01 C: Worst Case des Anzeigeblocks world.lage (12 Flotten mit allen Feldern, 6 Meldungen, Altstand und eigene Flotten gemischt), in jedem Snapshot gesendet,
  // der nach den Slots (Asteroiden, Ortsliste, Logbuch, Buch) Platz hat: der Schlüssel wird vor jedem Snapshot zurückgesetzt
  const wi = g.weltsim.wissen, KT = require('../public/js/karte-tokens.js'), codes = KT.hexReihenfolge(require('../content/welt/sund_frei.json')), T = wi.t = wi.t || 40;
  const arten = ['s', 'm', 'b', 'u', 'r', 'h'];
  wi.flotten = []; wi.meldungen = [];
  for (let i = 0; i < 12; i++) { const fk = ['g', 'r', 'k', 'p'][i % 4]; wi.flotten.push({ f: fk, h: codes[i + 3], k: 1 + (i % 3), p: arten[i % 6], a: i % 4 === 3 ? T - 11 : i % 3 === 0 ? T : T - 1, [fk === 'r' ? 'n' : 'v']: codes[i + 4], z: codes[i + 6], d: 3, ids: [i], an: [i] }); }   // eigene Flotten tragen n, fremde v (SUND-01 E)
  for (let i = 0; i < 6; i++) wi.meldungen.push({ e: ['sa', 'ma', 'be', 'hf', 'hh', 'pv'][i], h: codes[i], t: T - (i % 2), f: 'g', k: 3 });
  wi.ver++;
  let lageMax = 0, lageMitMax = 0;
  const orte = ['vulcania'].concat(posten.length ? [Sektoren.ortVonHex(posten[0])] : []);
  g.god = true;
  // das Angebot gibt es nur in ruhiger Lage (ohne Gegner): gemessen wird es deshalb vor den Szenen mit den Jägern, im selben Snapshot wie world.lage und world.absicht
  g.space.enemies = [];
  for (let k = 0; k < 30; k++) { g.step(); g.sentLageKey = null; g.sentAbsichtKey = null; finaleWorst(g); g.sentFunkKey = null; const sn = g.snapshot(); if (sn.world && sn.world.funkwahl) { funkMax = Math.max(funkMax, bytes(sn.world.funkwahl)); funkMitMax = Math.max(funkMitMax, bytes(sn)); } messen(S, sn); }
  const je = Math.floor(TICKS / orte.length);
  let maxMarker = 0;
  for (const ort of orte) {
    space.enterScene(g, ort, {});
    g.space.enemies = [];
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; space.spawnEnemy(g, 'raider', { x: g.ship.x + Math.cos(a) * 500, y: g.ship.y + Math.sin(a) * 500, facing: a + Math.PI, tag: 'mess' }); }
    for (const e of g.space.enemies) e.scanned = true;
    for (let k = 0; k < je; k++) {
      g.ship.hull = 100;
      g.step();
      maxMarker = Math.max(maxMarker, (g.space.markers || []).length);
      g.sentLageKey = null; g.sentAbsichtKey = null; finaleWorst(g); g.sentFunkKey = null;
      const sn = g.snapshot();
      if (sn.world && sn.world.absicht) { absichtMax = Math.max(absichtMax, bytes(sn.world.absicht)); absichtMitMax = Math.max(absichtMitMax, bytes(sn)); }
      if (sn.world && sn.world.lage) { lageMax = Math.max(lageMax, bytes(sn.world.lage)); lageMitMax = Math.max(lageMitMax, bytes(sn)); }
      messen(S, sn);
    }
  }
  // SUND-03b I: Worst Case des Blocks world.info: Konkordat-Hafen Concordia, jemand am Terminal, 3 Themen (drei Feldzüge der Sim), beide letzten Ergebnisse (die längsten Texte), in jedem Snapshot
  // gesendet (der Schlüssel wird vor jedem Snapshot zurückgesetzt), zusammen mit world.lage und world.absicht
  let infoMax = 0, infoMitMax = 0;
  {
    const Info = require('../server/sim/handel-info.js'), z = g.weltsim.zustand, ws = g.weltsim;
    space.enterScene(g, Sektoren.ortVonHex('0604'), {}); g.space.enemies = [];
    Object.assign(g.ship, { docked: true, dockedAt: Sektoren.ortVonHex('0604'), vx: 0, vy: 0, speed: 0 }); g.players[0].console = 'shop';
    z.angriffe.length = 0;
    ['sammeln', 'marsch', 'belagert'].forEach((art, i) => {
      const fl = z.flotten[i], id = 9000 + i; fl.angriff = id;
      z.angriffe.push({ id, t0: z.tick, ziel: ['0603', '0403', '0803'][i], von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: art === 'belagert' ? z.tick - 3 : null, t_ende: null, ausgang: null, phase: art === 'sammeln' ? 'sammeln' : 'marsch', t_marsch: null, stuetz: null, flotten: [fl.id] });
    });
    ws.infoLetzte = [{ s: 'b', x: 'Beleg des Konkordats: ' + 'x'.repeat(100) }, { s: 'g', x: 'Gerücht, unbestätigt: Es heißt: ' + 'x'.repeat(100) }];
    for (let k = 0; k < 30; k++) {
      g.ship.hull = 100; g.step();
      g.sentLageKey = null; g.sentAbsichtKey = null; finaleWorst(g); g.sentInfoKey = null;
      const sn = g.snapshot();
      if (sn.world && sn.world.info) { infoMax = Math.max(infoMax, bytes(sn.world.info)); infoMitMax = Math.max(infoMitMax, bytes(sn)); }
      messen(S, sn);
    }
    g.players[0].console = null;
  }
  // SUND-02a Client-Runde M2: Sim-Szene im Hafen (Debug szene 40 ger belagerung, bis 12 Schiffe, Vorwarnung, Wellen, Finale): flotte.sz, flotte.wl und fg stehen im Snapshot
  const SimSzene = require('../server/sim/kriegslage-szene.js');
  let szeneMax = 0, szeneSz = 0, szeneTicks = 0;
  space.enterScene(g, 'vulcania', {});
  g.ship.docked = false; g.ship.dockedAt = null; g.space.enemies = [];
  SimSzene.debug(g, ['40', 'ger', 'belagerung']);
  const phasen = new Set();
  for (let k = 0; k < Math.round(60 * CONFIG.tickHz) && g.simSzene; k++) {
    g.ship.hull = 100;
    g.step();
    if (k % 45 === 0) for (const e of g.space.enemies.slice(0, 2)) { e.hp = 1; space.damageEnemy(g, e, 500, e.x - 100, e.y, {}); }   // laufend Verluste, damit Wellen und Finale kommen
    g.sentLageKey = null; g.sentAbsichtKey = null; finaleWorst(g); g.sentFunkKey = null;   // Worst Case: die Blöcke world.lage und world.absicht stehen im selben Snapshot
    const sn = g.snapshot();
    const sz = sn.flotte && sn.flotte.sz;
    if (sz) { szeneTicks++; phasen.add(sz.p); szeneSz = Math.max(szeneSz, bytes(sz)); szeneMax = Math.max(szeneMax, bytes(sn)); }
    messen(S, sn);
  }
  // Fixrunde H7: auch die Ergebniszeile nach dem Ende (Phase s Sieg, n Niederlage) wird gemessen: die ersten Sekunden nach dem Ende, dann eine zweite Szene bis zur Niederlage
  const messSz = (sek) => {
    for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) {
      g.step(); g.sentLageKey = null; g.sentAbsichtKey = null; finaleWorst(g); g.sentFunkKey = null;
      const sn = g.snapshot(); const sz = sn.flotte && sn.flotte.sz;
      if (sz) { szeneTicks++; phasen.add(sz.p); szeneSz = Math.max(szeneSz, bytes(sz)); szeneMax = Math.max(szeneMax, bytes(sn)); }
      messen(S, sn);
    }
  };
  messSz(3);   // Sieg (oder Niederlage der ersten Szene), Ergebniszeile steht
  g.simSzene = null; g.simSzeneEnde = null;
  SimSzene.debug(g, ['40', 'ger', 'belagerung']);
  messSz(21);   // Vorwarnung und Beginn des Kampfes
  for (const q of (g.space.escorts || []).filter((x) => x.sim)) require('../server/sim/escort.js').hit(g, q, 99999, {});   // alle Verteidiger fallen
  g.ship.hull = 0; messSz(0.4); g.ship.hull = 0; messSz(3);   // Notfallprotokoll der Lerche: Niederlage (Phase n)
  const fehler = g.errors;
  g.releaseWorldLock && g.releaseWorldLock();
  return { infoBlock: infoMax, infoSnapshotMax: infoMitMax, fehler, posten: posten.length, orte: orte.join('+'), marker: maxMarker, lageBlock: lageMax, lageSnapshotMax: lageMitMax, absichtBlock: absichtMax, absichtSnapshotMax: absichtMitMax, funkBlock: funkMax, funkSnapshotMax: funkMitMax, szeneMax, szeneSz, szeneTicks, szenePhasen: [...phasen].join('') };
}

// ---------- Aufbau 10 (SUND-04a-3 Orbit): Orbit-Szene des Finales über Hrafnheim, 4 Spieler (die Szene skaliert auf höchstens 3), Rang Tribun, Finale gestartet: Vorwarnung, Flaggschiff, Wachschiffe,
// 3 römische Verbündete, laufende Treffer; der Block world.finale steht in jedem Snapshot (Worst Case). ----------
function finaleOrbit(S, seed) {
  const fs = require('fs'), os = require('os'), path = require('path');
  const space = require('../server/sim/space.js');
  const Finale = require('../server/sim/finale.js');
  const Kriegslage = require('../server/sim/kriegslage.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-finorbit-mess-'));
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(dir, 'regie') }, log });
  const cs = [];
  for (let i = 0; i < 4; i++) { const c = { send() {}, sendRaw() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F' + i, name: 'F' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 30; k++) g.step();
  g.space.enemies = [];
  g.weltsim.ruf.rom = require('../content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === 'tribun').ab;
  Kriegslage.tick(g, 'test');
  const fehlerStart = Finale.waehlen(g) || Finale.bestaetigen(g);
  let max = 0, flagg = false;
  for (let k = 0; k < Math.max(TICKS, 40 * CONFIG.tickHz); k++) {
    g.ship.hull = 100;
    g.step();
    if (k % 60 === 30) { const e = g.space.enemies.find((x) => !x.flagg); if (e) { e.hp = Math.max(1, e.hp - 5); space.damageEnemy(g, e, 1, e.x - 50, e.y); } }
    if (g.space.enemies.some((e) => e.flagg)) flagg = true;
    max = Math.max(max, g.space.enemies.length + (g.space.escorts || []).length);
    g.sentFinaleKey = null;
    messen(S, g.snapshot());
  }
  const fehler = g.errors + (fehlerStart ? 1 : 0) + (g.simSzene && g.simSzene.modus === 'finale' && flagg ? 0 : 1);
  g.releaseWorldLock && g.releaseWorldLock();
  return { fehler, schiffeMax: max };
}

// ---------- Lauf ----------
const t0 = Date.now();
const W = sammler('worst'), WL = sammler('wellen'), RA = sammler('raum-alarm'), WM = sammler('methalle'), WE = sammler('endkampf'), WB = sammler('boden'), KV = sammler('konvoi'), FL = sammler('flotte'), OB = sammler('orbit'), FF = sammler('freie_fahrt'), VF = sammler('verfolgung'), FO = sammler('finale_orbit');
const laeufe = { worst: [], wellen: [], raum: [], methalle: [], endkampf: [], boden: [], konvoi: [], flotte: [], orbit: [], freieFahrt: [], verfolgung: [], finaleOrbit: [] };
for (let s = 1; s <= SEEDS; s++) laeufe.worst.push(Object.assign({ seed: s }, worstCase(W, s)));
for (const karte of ['aussenposten', 'kesh']) for (let s = 1; s <= SEEDS; s++) laeufe.wellen.push(Object.assign({ seed: s }, wellenlauf(WL, 20 + s, karte)));
for (let s = 1; s <= SEEDS; s++) laeufe.raum.push(Object.assign({ seed: s }, raumAlarm(RA, 40 + s)));
for (let s = 1; s <= SEEDS; s++) laeufe.methalle.push(Object.assign({ seed: s }, methalleLauf(WM, 30 + s)));
for (let s = 1; s <= SEEDS; s++) laeufe.endkampf.push(Object.assign({ seed: s }, endkampfLauf(WE, 40 + s)));
for (let s = 1; s <= SEEDS; s++) laeufe.boden.push(Object.assign({ seed: s }, bodenLauf(WB, 100 + s)));
for (let s = 1; s <= SEEDS; s++) laeufe.konvoi.push(Object.assign({ seed: s }, konvoi(KV, 60 + s)));
for (let s = 1; s <= SEEDS; s++) laeufe.flotte.push(Object.assign({ seed: s }, flotte(FL, 60 + s)));
for (let s = 1; s <= SEEDS; s++) laeufe.orbit.push(Object.assign({ seed: s }, orbit(OB, 70 + s)));
for (let s = 1; s <= SEEDS; s++) laeufe.freieFahrt.push(Object.assign({ seed: s }, freieFahrt(FF, 80 + s)));
for (let s = 1; s <= SEEDS; s++) laeufe.verfolgung.push(Object.assign({ seed: s }, verfolgung(VF, 90 + s)));
for (let s = 1; s <= SEEDS; s++) laeufe.finaleOrbit.push(Object.assign({ seed: s }, finaleOrbit(FO, 100 + s)));
const res = { ziel: ZIEL, grenze: MAX, luft: LUFT, seeds: SEEDS, sek: SEK, worst: auswerten(W), wellen: auswerten(WL), raum: auswerten(RA), methalle: auswerten(WM), endkampf: auswerten(WE), boden: auswerten(WB), konvoi: auswerten(KV), flotte: auswerten(FL), orbit: auswerten(OB), freieFahrt: auswerten(FF), verfolgung: auswerten(VF), finaleOrbit: auswerten(FO), laeufe, ms: Date.now() - t0 };

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
zeigen(res.raum);
console.log('  Läufe: ' + laeufe.raum.map((l) => `s${l.seed}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.methalle);
console.log('  Läufe: ' + laeufe.methalle.map((l) => `s${l.seed} ${l.lp} ${l.wachen} Wachen${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.endkampf);
console.log('  Läufe: ' + laeufe.endkampf.map((l) => `s${l.seed} ${l.lp} ${l.gegner} Gegner im Snapshot, Anführer ${l.boss ? 'ja' : 'NEIN'}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.boden);
console.log('  Läufe: ' + laeufe.boden.map((l) => `s${l.seed} ${l.lp} ${l.gegner} Gegner im Snapshot, ${l.unten} Spieler unten, Wächter ${l.boss ? 'ja' : 'NEIN'}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.konvoi);
console.log('  Läufe: ' + laeufe.konvoi.map((l) => `s${l.seed}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.flotte);
console.log('  Läufe: ' + laeufe.flotte.map((l) => `s${l.seed} Schiffe max ${l.schiffeMax}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.orbit);
console.log('  Läufe: ' + laeufe.orbit.map((l) => `s${l.seed} Schiffe max ${l.schiffeMax}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.freieFahrt);
console.log('  Läufe: ' + laeufe.freieFahrt.map((l) => `s${l.seed} ${l.orte} (${l.posten} Posten, ${l.marker} Marker, world.lage ${l.lageBlock} B, world.absicht ${l.absichtBlock} B (Snapshot mit beiden max ${l.absichtSnapshotMax} B), world.funkwahl ${l.funkBlock} B (Snapshot mit Block max ${l.funkSnapshotMax} B), world.info ${l.infoBlock} B (Snapshot mit allen drei max ${l.infoSnapshotMax} B), Snapshot mit Block max ${l.lageSnapshotMax} B, Szene max ${l.szeneMax} B, sz max ${l.szeneSz} B, Phasen ${l.szenePhasen})${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.verfolgung);
console.log('  Läufe: ' + laeufe.verfolgung.map((l) => `s${l.seed} Ausgang ${l.ausgang}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
zeigen(res.finaleOrbit);
console.log('  Läufe: ' + laeufe.finaleOrbit.map((l) => `s${l.seed} Schiffe max ${l.schiffeMax}${l.fehler ? ' Fehler ' + l.fehler : ''}`).join(', '));
const phasenOk = laeufe.freieFahrt.every((l) => 'vkfsn'.split('').every((p) => l.szenePhasen.includes(p)));   // H7: alle fünf Phasen der Szenenzeile (inkl. n) wurden gemessen
if (!phasenOk) console.log('  VERFEHLT: nicht alle Phasen v k f s n der Szenenzeile gemessen');
const alleOk = phasenOk && res.orbit.ok && res.freieFahrt.ok && res.verfolgung.ok && res.finaleOrbit.ok && laeufe.finaleOrbit.every((l) => !l.fehler) && res.worst.ok && res.wellen.ok && res.raum.ok && res.methalle.ok && res.endkampf.ok && res.boden.ok && res.konvoi.ok && res.flotte.ok && laeufe.endkampf.every((l) => l.boss && l.gegner >= 11) && laeufe.boden.every((l) => l.boss && l.gegner >= 11 && l.unten === 4);
console.log(`
${alleOk ? 'ok' : 'VERFEHLT'}: Worst Case max ${res.worst.max} B, Wellenlauf max ${res.wellen.max} B, Raum-Alarm max ${res.raum.max} B, Methalle max ${res.methalle.max} B, Endkampf (10 Gegner + Anführer, 4 Spieler) max ${res.endkampf.max} B, Boden Schrein (10 Wachen + Wächter, 4 Spieler) max ${res.boden.max} B, Konvoi max ${res.konvoi.max} B, Flotte max ${res.flotte.max} B, Orbitschlacht max ${res.orbit.max} B, Freie Fahrt Sund max ${res.freieFahrt.max} B, Orbit des Finales max ${res.finaleOrbit.max} B (Ziel ≤ ${ZIEL} B) – ${res.ms} ms`);
process.exit(alleOk ? 0 : 1);
