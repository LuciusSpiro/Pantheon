'use strict';
// SL7 (CONCEPT-SL7): das ganze Buch sl_forschungsstation auf Sund durch den Bot: Gravimetrie (scannen, nach Ansage fliegen), Landepunkt-Scan,
// Außenteam hinunter, vier Pulte in Reihenfolge hacken (mit Ablenkung), Finale (Haltefeld, Feldkarte, langer Kanal), Concordia. Dazu der Verlustpfad
// (alle am Boden -> Ausgang verloren, Szene von vorn) und die temporäre Kante.
//   node tools/test-forschungsstation.js
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Zonen = require('../shared/zonen.js');
const Mon = require('../shared/monster.js');
const Locations = require('../shared/locations.js');
const Sektoren = require('../shared/sektoren.js');
const { Game } = require('../server/game.js');
const Welt = require('../server/sim/welt.js');
const away = require('../server/sim/away.js');
const Anker = require('../server/sim/anker.js');
const Monster = require('../server/sim/monster.js');
const ZonenSim = require('../server/sim/zonen.js');
const Lpscan = require('../server/sim/lpscan.js');
const combat = require('../server/sim/combat.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

function spiel(np) {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'F' + i, name: 'Fo' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund');
  g.god = true;
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  const T = { g, cs, run, mev };
  T.cmd = (cmd, f) => { cs[0].inbox.length = 0; g.handleMessage(cs[0], Object.assign({ t: 'cmd', c: cmd }, f || {})); return cs[0].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.rolle = (r) => { g.players[0].console = r; };
  T.energie = (o) => { Object.assign(g.ship.powerIntent || (g.ship.powerIntent = {}), o); Object.assign(g.ship.power, o); };
  // Navigation nach Ansage (Drift 120 px voraus ausgleichen, Querfehler regeln)
  T.fliege = (ziele, grenzeS, abbruch) => {
    T.rolle('helm');
    let i = 0; let prev = { x: g.ship.x, y: g.ship.y };
    return run(grenzeS, () => {
      const sh = g.ship; const z = ziele[i];
      if (!z) return true;
      const sx = z.x - prev.x, sy = z.y - prev.y, sl = Math.hypot(sx, sy) || 1;
      if (((sh.x - z.x) * sx + (sh.y - z.y) * sy) / sl >= -30) { prev = z; i++; return false; }
      const dd = Math.max(1, Math.hypot(z.x - sh.x, z.y - sh.y)); const ux = (z.x - sh.x) / dd, uy = (z.y - sh.y) / dd;
      const v = Zonen.wirkung(ZonenSim.szeneZonen(g), sh.x + ux * 120, sh.y + uy * 120);
      const e = ((sh.x - prev.x) * -sy + (sh.y - prev.y) * sx) / sl; const nx = -sy / sl, ny = sx / sl;
      const want = Math.atan2(uy * 140 - v.vy - ny * e * 0.5, ux * 140 - v.vx - nx * e * 0.5);
      let d = want - sh.angle; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      sh.helm.stage = 5; sh.helm.turn = Math.max(-1, Math.min(1, d * 2.5));
      return abbruch ? abbruch() : false;
    });
  };
  return T;
}

function buchLaden(g) {
  const buch = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher-sund', 'sl_forschung.regiebuch.json'), 'utf8'));
  buch.kopf.art = 'generiert';   // registerBook (Labor-Weg) nimmt nur generiert/archiv; die Kette startet Kapitel selbst
  const m = g.mission;
  m.startCampaign({ tutorial: false });
  const r = m.registerBook(buch, { origin: 'sl' });
  return { m, buch, r };
}

section('Buch: Prüfer, Kante, Gravimetrie, Station, Finale, Concordia', () => {
  const T = spiel(2); const g = T.g;
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher-sund', 'sl_forschung.regiebuch.json'), 'utf8'));
    const pr = require('../server/mission/checker.js').check(doc);
    ok(pr.ok, 'Buch besteht den Prüfer auf Sund ' + JSON.stringify(pr.errors.slice(0, 2)));
    g.debugGoto('pulverhorn', false); T.run(0.5);
    const { m, buch, r } = buchLaden(g);
    m.startMission(buch.id);
    ok(m.activeId === buch.id, 'Buch registriert und gestartet' + (r && r.ok === false ? ' ' + JSON.stringify(r.errors || []).slice(0, 200) : ''));
    T.run(5);
    ok(m.step && m.step.id === 'anflug_helix', 'Schritt anflug_helix (nach dem Auftrag)');
    ok(g.explore.tempKante(Sektoren.kanteId('0605', '0506')), 'temporärer Sprungpunkt Pulverhorn -> Helix ist offen (sprungpunkt_oeffnen)');
    g.debugGoto('helix', false); T.run(2);
    ok(m.step && m.step.id === 'gravimetrie', 'am Helix: Schritt gravimetrie');
    const loc = Locations.get('helix'); const gv = loc.scene.gravimetrie;
    g.ship.x = gv.start.x; g.ship.y = gv.start.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0;
    T.energie({ engines: 3, shields: 2, weapons: 1, life: 2 });
    // Ops scannt
    T.rolle('weapons'); T.run(0.2);
    ok(T.cmd('weapons.zonenscan').length === 0, 'Ops startet den Zonen-Scan');
    T.run(3.5);
    ok(ZonenSim.istBekannt(g, 'gravi_feld0'), 'Scan fertig: gravi_feld0 bekannt');
    // Navigation fliegt nach Ansage zur Station
    T.fliege(gv.weg.slice(1), 90, () => m.step && m.step.id === 'station');
    T.run(1);
    ok(m.step && m.step.id === 'station' && !T.mev.some((e) => e.kind === 'zoneRuecksetzen'), 'Station erreicht ohne Rücksetzer, Schritt station (x ' + Math.round(g.ship.x) + ')');
    g.ship.helm.stage = 1; g.ship.helm.turn = 0; g.ship.vx = 0; g.ship.vy = 0;   // die Lerche steht im Orbit über der Station
    // Landepunkt-Scan der Ops
    T.rolle('weapons'); g.ship.vx = 0; g.ship.vy = 0; T.run(0.3);
    ok(Lpscan.ziele(g).some((q) => q.id === 'helix.station'), 'Landepunkt helix.station in Scanreichweite');
    ok(T.cmd('weapons.landescan').length === 0, 'Ops startet den Landepunkt-Scan');
    T.run(4.5);
    ok(Lpscan.gescannt(g, 'helix.station'), 'Landepunkt gescannt: Karte am Planungstisch');
    // Außenteam hinunter
    const err = g.chooseLandepunkt(g.players[0], 'helix.station');
    away.executeBeam(g, g.players.map((q) => q.id), 'down');
    T.run(1);
    const aw = g.away;
    ok(!err && aw.map === 'helix.station' && aw.monster && aw.monsterPulte, 'Team auf der Station, Monster und Pulte eingerichtet');
    // vier Pulte in Reihenfolge mit Ablenkung: die zweite Spielerin lenkt das Monster von den Pulten ab (Lärm weit weg)
    const k = g.karteOf(aw.map); const mk = Monster.maskeVon(k); const P = aw.monsterPulte;
    const hacken = (id) => {
      const pos = P.pos[id]; const pa = Mon.naechster(mk, pos[0], pos[1], 2); const pc = Mon.mitte(pa);
      g.players[0].x = pc.x; g.players[0].y = pc.y;
      Anker.setzen(g, aw.map, id, 'laedt', g.players[0].id);
      // Ablenkung: Monster zu einem Punkt weit vom Pult (Lärm der zweiten Spielerin)
      const dp = Mon.bfs(mk, [pa]); let fern = null, fd = -1;
      for (let cy = 1; cy < mk.h; cy++) for (let cx = 1; cx < mk.w; cx++) { const d = dp[cy * mk.w + cx]; if (d > fd) { fd = d; fern = { cx, cy }; } }
      const M = aw.monster; const fp = Mon.mitte(fern);
      T.run(6.2, () => { M.laerm = { x: fp.x, y: fp.y, t: g.time, w: 900, art: 'fertig' }; if (M.z === 'jagd') { M.z = 'laerm'; M.verlust = 0; } return false; });
      Anker.completeHold(g, g.players[0], { kind: 'anker:terminal', anker: id, op: 'download', tx: pos[0], ty: pos[1] });
      T.run(0.5);
    };
    const reihenfolge = [];
    for (let i = 0; i < 4; i++) {
      const id = P.order[i];
      const vorher = P.order.slice(i + 1).every((q) => Anker.zustand(g, aw.map, q) === 'gesperrt');
      reihenfolge.push(vorher);
      hacken(id);
      if (g.players[0].downed) break;
    }
    ok(reihenfolge.every(Boolean), 'Reihenfolge: je Hack waren die späteren Pulte gesperrt');
    ok(P.erledigt === 4 && P.fertig, 'vier Pulte gehackt (' + P.erledigt + '/4, Monster-Zustand ' + aw.monster.z + ')');
    T.run(1.5);
    ok(m.step && m.step.id === 'rueckbeamen' && ZonenSim.szeneZonen(g).some((z) => z.id === 'halt_feld') && g.snapshot().zonen.sv && g.snapshot().zonen.sv.includes('halt_feld') && g.snapshot().zonen.sv.includes('halt_kanal_lang'), 'Daten da: Haltefeld an, Feldkarte für alle sichtbar, Schritt rueckbeamen (Schritt ' + (m.step && m.step.id) + ', sv ' + JSON.stringify((g.snapshot().zonen || {}).sv) + ')');
    // Team hoch
    away.executeBeam(g, g.players.map((q) => q.id), 'up'); g.players.forEach((q) => { q.zone = 'ship'; });
    T.run(2);
    ok(m.step && m.step.id === 'finale', 'Team an Bord: Schritt finale (' + (m.step && m.step.id) + ')');
    // Finale: aus der Mitte durch den langen Kanal
    g.ship.x = gv.station.x; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0;
    T.energie({ engines: 4, shields: 1, weapons: 1, life: 2 });
    T.fliege(gv.fluchtweg, 60, () => m.step && m.step.id === 'abliefern_anflug');
    T.run(1);
    ok(m.step && m.step.id === 'abliefern_anflug', 'aus dem Haltefeld heraus: Schritt abliefern_anflug (Abstand ' + Math.round(Math.hypot(g.ship.x - gv.station.x, g.ship.y - gv.station.y)) + ')');
    // Concordia
    const m0 = g.inventory.marks;
    g.debugGoto('concordia', true); T.run(3);
    ok(m.step === null || m.missions[buch.id].state === 'done', 'in Concordia angedockt: Buch fertig');
    const ms = m.missions[buch.id];
    ok(ms && ms.state === 'done' && ms.ausgang === 'erfolg', 'Ausgang erfolg');
    ok(g.inventory.marks >= m0 + 120 && m.state.flags && m.state.flags.forschungFertig === true, 'Lohn (120 Marken) gutgeschrieben, Flag forschungFertig');
  } finally { Welt.waehle(g, 'limes'); }
});

section('Buch: alle am Boden -> verloren, Szene von vorn', () => {
  const T = spiel(1); const g = T.g;
  try {
    g.debugGoto('pulverhorn', false); T.run(0.5);
    const { m, buch } = buchLaden(g);
    m.startMission(buch.id); T.run(4);
    g.debugGoto('helix', false); T.run(1.5);
    const gv = Locations.get('helix').scene.gravimetrie;
    g.ship.x = gv.station.x - 100; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0;
    m.forceStep(buch.id, 'station'); T.run(1);
    Lpscan.markieren(g, 'helix.station');
    g.chooseLandepunkt(g.players[0], 'helix.station'); away.executeBeam(g, g.players.map((q) => q.id), 'down'); T.run(1);
    ok(m.step && m.step.id === 'station' && g.away.monster, 'Station: Team unten, Monster aktiv');
    // Monster neben das Team stellen, Beschuss wirkungslos, Treffer
    const k = g.karteOf(g.away.map); const mk = Monster.maskeVon(k); const p = g.players[0];
    const a = Mon.naechster(mk, Math.floor(p.x / 32), Math.floor(p.y / 32), 2); const pc = Mon.mitte(a); p.x = pc.x; p.y = pc.y;
    const dn = Mon.bfs(mk, [a]); let mp = null;
    for (let cy = 1; cy < mk.h && !mp; cy++) for (let cx = 1; cx < mk.w; cx++) if (dn[cy * mk.w + cx] === 3) { mp = { cx, cy }; break; }
    const M = g.away.monster; const mpos = Mon.mitte(mp); M.x = mpos.x; M.y = mpos.y; M.pfad = []; M.pause = 0;
    T.run(15, () => m.missions[buch.id].state === 'done' || (m.step && m.step.id !== 'station'));
    const ms = m.missions[buch.id];
    ok(ms && ms.state === 'done' && ms.ausgang === 'verloren', 'alle am Boden: Ausgang verloren (' + (ms && ms.ausgang) + ')');
    const nz = Monster.zuruecksetzen(g);
    ok(nz >= 0 && g.away.monster === undefined, 'monster_zuruecksetzen: Monster und Pulte zurück auf Anfang');
  } finally { Welt.waehle(g, 'limes'); }
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
