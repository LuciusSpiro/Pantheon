'use strict';
// SL7c (CONCEPT-SL7 §7c): Monster-Station Helix. Größenklasse statt Kachelart (Maske), Prüfregeln K-MONSTER-*, Zustandsmaschine (Patrouille, Lärm,
// Jagd, Suche), Treffer = Spieler verwundet, Pult-Reihenfolge, Kriechgang sicher, Monster nicht verwundbar, Snapshot, Weltstand-Neutralität.
//   node tools/test-monster.js
const CONFIG = require('../shared/config.js');
const GenStation = require('../shared/gen-station.js');
const Buehne = require('../shared/buehne.js');
const Mon = require('../shared/monster.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Welt = require('../server/sim/welt.js');
const away = require('../server/sim/away.js');
const Anker = require('../server/sim/anker.js');
const Monster = require('../server/sim/monster.js');
const Registry = require('../server/mission/registry.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

section('Karte: Monster-Station, Maske und Prüfregeln', () => {
  let ohnePruef = 0, sicher = 0, mitPulten = 0, fluchtMax = 0;
  for (let seed = 1; seed <= 40; seed++) {
    // wie landepunkte.genBauen: scheitert der Prüfer, Seed + 1 (bis zu 6 Versuche)
    let r = null;
    for (let i = 0; i < 6 && !(r && r.pruefung.ok); i++) { const roh = GenStation.erzeuger(96, 56).karteRoh(seed * 11 + 5 + i, 8, { monster: true, id: 'm' + seed }); r = Buehne.ausRaster(roh, { spiel: true }); }
    if (!r.pruefung.ok) { ohnePruef++; continue; }
    const k = r.karte;
    if (k.anker.filter((a) => a.rolle === 'terminal').length === 4 && k.meta.monster === true) mitPulten++;
    const m = Mon.maske(k);
    // Kein Ankerpunkt des Monsters deckt eine Kriechgang-/Luken-Kachel ab: Fußabdruck nur auf Gänge/Räume/Türen (2 breit)
    let kriechBelegt = 0;
    for (let cy = 1; cy < m.h; cy++) for (let cx = 1; cx < m.w; cx++) if (m.geht(cx, cy)) {
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const i = k.legende[k.rows[cy + dy][cx + dx]]; if (i && i.kind === 'luke') kriechBelegt++; }
    }
    if (kriechBelegt === 0) sicher++;
    fluchtMax = Math.max(fluchtMax, Mon.pruefen(k).length);
  }
  ok(ohnePruef === 0, 'alle 40 Seeds bestehen den Bühnen-Prüfer inkl. K-MONSTER-* (' + ohnePruef + ' durchgefallen)');
  ok(mitPulten === 40, 'jede Monster-Karte hat genau 4 Pulte und meta.monster');
  ok(sicher === 40, 'kein Monster-Ankerpunkt deckt eine Luke ab (Luken 1 breit bleiben dicht)');
  ok(fluchtMax === 0, 'Mon.pruefen liefert für gültige Karten keine Fehler');
  // Negativ: ein Pult in einem abgeschotteten Raum -> K-MONSTER-PULT
  const roh = GenStation.erzeuger(96, 56).karteRoh(16, 8, { monster: true, id: 'neg' });
  const k = Buehne.ausRaster(roh, { spiel: true }).karte;
  const kopie = JSON.parse(JSON.stringify(k));
  const pult = kopie.anker.find((a) => a.rolle === 'terminal');
  // Pult in den Kriechgang verlegen: Kriechgang-Boden suchen (begehbar, nicht von der Maske abgedeckt)
  const m = Mon.maske(kopie);
  let kriech = null;
  for (let y = 1; y < kopie.h - 1 && !kriech; y++) for (let x = 1; x < kopie.w - 1; x++) {
    if (kopie.legende[kopie.rows[y][x]] && m.raster.begehbar(x, y) && !m.raster.tuer(x, y) && ![[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dy]) => m.geht(x + dx, y + dy))) { kriech = { x, y }; break; }
  }
  ok(!!kriech, 'Kriechgang-Boden gefunden (1 breit, für das Monster dicht)');
  pult.x = kriech.x; pult.y = kriech.y;
  ok(Mon.pruefen(kopie).some((f) => f.code === 'K-MONSTER-PULT'), 'Pult im Kriechgang: K-MONSTER-PULT schlägt an (das Monster erreicht es nicht)');
});

function station(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: false, seed: o.seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  const np = o.np || 1;
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 4000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'Mon' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund');
  g.god = true;
  space.enterScene(g, 'helix', {});
  const sc = Locations.get('helix').scene;
  g.ship.x = sc.station.x - 100; g.ship.y = sc.station.y;
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  run(0.2);
  const err = g.chooseLandepunkt(g.players[0], 'helix.station');
  away.executeBeam(g, g.players.map((q) => q.id), 'down');
  run(0.3);
  return { g, cs, run, err };
}

section('Monster: Patrouille, Maske, Kriechgang', () => {
  const T = station(); const g = T.g; const aw = g.away; const p = g.players[0];
  ok(T.err === null || T.err === undefined, 'Landepunkt helix.station wählbar');
  ok(aw.map === 'helix.station' && aw.active && p.zone === 'away', 'Außenteam unten auf der Station');
  const M = aw.monster;
  ok(!!M && M.kind === 'monster' && M.z === 'patrouille', 'Monster angelegt, patrouilliert sofort (ununterbrochen aktiv)');
  const k = g.karteOf(aw.map); const m = Monster.maskeVon(k);
  ok(k.meta.monster === true && k.anker.filter((a) => a.rolle === 'terminal').length === 4, 'Karte: meta.monster, 4 Pulte');
  // Es hat keinen Drohnen-Eintrag und keine Lebenspunkte: nicht verwundbar
  ok(!aw.drones.some((d) => d.kind === 'monster') && M.hp === undefined, 'nicht verwundbar: kein Gegner-Eintrag, keine Lebenspunkte');
  // Patrouille 40 s: bewegt sich, steht immer auf einem Ankerpunkt-Fußabdruck der Maske und nie auf Luke/Kriechgang
  let bewegt = 0, daneben = 0, last = { x: M.x, y: M.y };
  const posen = new Set();
  g.god = true; p.x = 3 * 32; p.y = 3 * 32;   // Spieler weit weg
  T.run(40, () => {
    bewegt += Math.hypot(M.x - last.x, M.y - last.y); last = { x: M.x, y: M.y };
    const cx = Math.round(M.x / 32), cy = Math.round(M.y / 32);
    // ≤ 0.5 Kachel vom Ankerpunkt: alle vier Fußabdruck-Kacheln um die Mitte begehbar
    for (const [dx, dy] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
      const tx = Math.floor(M.x / 32 + dx), ty = Math.floor(M.y / 32 + dy);
      if (!m.raster.durchgang(tx, ty) && !m.raster.tuer(tx, ty)) { daneben++; break; }
      const info = k.legende[k.rows[ty][tx]]; if (info && info.kind === 'luke') { daneben++; break; }
    }
    posen.add(Math.floor(M.x / 160) + ',' + Math.floor(M.y / 160));
    return false;
  });
  ok(bewegt > 600, 'Patrouille: das Monster legt Strecke zurück (' + Math.round(bewegt) + ' px in 40 s)');
  ok(daneben === 0, 'Maske: Fußabdruck nie in Wand, Luke oder Kriechgang');
  ok(posen.size >= 4, 'Patrouille führt durch mehrere Bereiche (' + posen.size + ' Felder)');
  // Kriechgang: Spieler direkt hinter der Wand, Monster steht daneben -> kein Treffer, Jagd bleibt ohne Weg
  let kriech = null;
  for (let y = 1; y < k.h - 1 && !kriech; y++) for (let x = 1; x < k.w - 1; x++) {
    if (m.raster.begehbar(x, y) && !m.raster.tuer(x, y) && ![[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dy]) => m.geht(x + dx, y + dy))) {
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => m.geht(x + dx * 3, y + dy * 3)).some(Boolean);
      if (nb) { kriech = { x, y }; break; }
    }
  }
  ok(!!kriech, 'Kriechgang-Kachel neben einem Monster-Gang gefunden');
  p.x = kriech.x * 32 + 16; p.y = kriech.y * 32 + 16; p.downed = false;
  const nah = Mon.naechster(m, kriech.x, kriech.y, 5); const pos = Mon.mitte(nah);
  M.x = pos.x; M.y = pos.y; M.pfad = []; M.z = 'patrouille'; M.pause = 0;
  let treffer = 0; const w0 = aw.stats ? aw.stats.wounds : 0;
  g.god = false;
  T.run(15, () => { if (p.downed) treffer++; return false; });
  ok(treffer === 0 && !p.downed, 'Spieler im Kriechgang: das Monster kommt nicht heran, kein Treffer in 15 s (Abstand ' + Math.round(Math.hypot(M.x - p.x, M.y - p.y)) + ' px)');
  ok(Math.hypot(M.x - p.x, M.y - p.y) >= 30, 'Monster bleibt außerhalb der Trefferreichweite');
  void w0;
});

section('Monster: Pulte, Lärm, Jagd, Treffer = verwundet', () => {
  const T = station({ np: 2 }); const g = T.g; const aw = g.away; const M = aw.monster;
  const P = aw.monsterPulte; const [p1, p2] = g.players;
  ok(P.order.length === 4 && P.erledigt === 0, 'Pult-Reihenfolge: 4 Pulte, keines gehackt');
  ok(Anker.zustand(g, aw.map, P.order[0]) !== 'gesperrt' && P.order.slice(1).every((id) => Anker.zustand(g, aw.map, id) === 'gesperrt'), 'nur das erste Pult ist frei, die anderen gesperrt');
  const snap = g.snapshot().away;
  ok(snap.mo && snap.mo.z === 'p' && snap.mp && snap.mp.id === P.order[0] && snap.mp.n === 0 && snap.mp.t === 4, 'Snapshot away.mo (Monster) und away.mp (nächstes Pult für den Captain)');
  // Spieler zum ersten Pult stellen (weit weg vom Monster), Hack
  const ersterPult = P.pos[P.order[0]];
  p1.x = ersterPult[0] * 32 + 16; p1.y = ersterPult[1] * 32 + 48; p2.x = p1.x + 20; p2.y = p1.y;
  g.god = true;
  M.x = Mon.mitte(Mon.naechster(Monster.maskeVon(g.karteOf(aw.map)), 40, 40, 30) || { cx: 2, cy: 2 }).x; M.y = M.y;   // unbedeutend, gleich ersetzt
  const k = g.karteOf(aw.map); const m = Monster.maskeVon(k);
  // Monster in einen weit entfernten Raum setzen
  const dist = Mon.bfs(m, [Mon.naechster(m, ersterPult[0], ersterPult[1], 3)]);
  let fern = null, fd = -1;
  for (let cy = 1; cy < m.h; cy++) for (let cx = 1; cx < m.w; cx++) { const d = dist[cy * m.w + cx]; if (d > fd) { fd = d; fern = { cx, cy }; } }
  const pf = Mon.mitte(fern); M.x = pf.x; M.y = pf.y; M.pfad = []; M.z = 'patrouille'; M.pause = 0; M.wait = 99;
  T.run(0.5);
  Anker.setzen(g, aw.map, P.order[0], 'laedt', p1.id);
  T.run(1);
  ok(M.z === 'laerm' && M.laerm && M.laerm.art === 'hack', 'Hack (Pult lädt) lockt das Monster an: Lärm');
  const pa = Mon.naechster(m, ersterPult[0], ersterPult[1], 2);
  const dp = Mon.bfs(m, [pa]); const pfadD = () => { const a = Mon.ankerVon(M.x, M.y); return dp[a.cy * m.w + a.cx]; };
  const d0 = pfadD();
  // fertig
  Anker.completeHold(g, p1, { kind: 'anker:terminal', anker: P.order[0], op: 'download', tx: ersterPult[0], ty: ersterPult[1] });
  T.run(0.5);
  ok(P.erledigt === 1 && Anker.zustand(g, aw.map, P.order[1]) === 'bereit' && T.cs[0].inbox.some((m2) => m2.kind === 'pultGehackt'), 'erstes Pult gehackt: Ereignis pultGehackt, zweites Pult jetzt frei');
  ok(M.laerm.art === 'fertig', 'fertiger Hack ist lauter');
  T.run(12);
  const d1 = pfadD();
  ok(d1 < d0 - 8 || M.z === 'jagd', 'das Monster kommt dem Lärm entgegen (Pfadlänge ' + d0 + ' -> ' + d1 + ' Schritte)');
  ok(g.snapshot().away.mp.n === 1 && g.snapshot().away.mp.id === P.order[1], 'Snapshot: nächstes Pult = zweites');
  // Jagd und Treffer: Monster neben dem Spieler im offenen Raum
  const nah = Mon.naechster(m, ersterPult[0], ersterPult[1], 2); const pn = Mon.mitte(nah);
  p1.x = pn.x; p1.y = pn.y; p2.x = pn.x + 12; p2.y = pn.y;
  // Monster 4 Schritte entfernt auf einem freien Ankerpunkt (BFS-Abstand 4)
  const dn = Mon.bfs(m, [nah]); let mp = null;
  for (let cy = 1; cy < m.h && !mp; cy++) for (let cx = 1; cx < m.w; cx++) if (dn[cy * m.w + cx] === 4) { mp = { cx, cy }; break; }
  const mpos = Mon.mitte(mp); M.x = mpos.x; M.y = mpos.y; M.pfad = []; M.pause = 0; M.z = 'patrouille'; M.laerm = null;
  g.god = false;
  const w0 = aw.stats ? aw.stats.wounds : 0;
  T.run(10, () => p1.downed);
  ok(p1.downed || p2.downed, 'Treffer verwundet einen Spieler (zu Boden)');
  ok(T.cs[0].inbox.some((m2) => m2.kind === 'monsterTreffer'), 'Ereignis monsterTreffer');
  ok(!Monster.alleVerwundet(g) || (p1.downed && p2.downed), 'alleVerwundet erst, wenn alle unten sind');
  T.run(20, () => p1.downed && p2.downed);
  ok(p1.downed && p2.downed && Monster.alleVerwundet(g), 'alle am Boden: alleVerwundet (Szene wiederholt sich im Regiebuch) ' + ((aw.stats ? aw.stats.wounds : 0) - w0) + ' Wunden');
  // Waffen helfen nicht: Schüsse treffen kein Monster (keine Drohne/Lebenspunkte)
  ok(aw.drones.every((d) => d.kind !== 'monster'), 'kein Gegner-Eintrag vom Typ monster, Beschuss kann nichts treffen');
  // Registry
  ok(!!Registry.get('team_alle_verwundet') && Registry.get('team_alle_verwundet').test({ game: g }, {}), 'Prüfung team_alle_verwundet trifft zu');
  ok(!!Registry.get('pulte_gehackt') && Registry.get('pulte_gehackt').test({ game: g }, { min: 1 }) && !Registry.get('pulte_gehackt').test({ game: g }, { min: 4 }), 'Prüfung pulte_gehackt (min 1 ja, min 4 nein)');
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
