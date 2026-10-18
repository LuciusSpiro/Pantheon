'use strict';
// SL6/SL7/SL10 Bot-Pfade (T4) für tools/sim-headless.js (Unterbefehl `sl`) und andere Aufrufer (Kette, Labor, Tests).
// Die Bots benutzen die echten Befehle der Konsolen (weapons.zonenscan, weapons.landescan, weapons.verkaufen, weapons.glyphen.*), die Hold-Mechanik der
// Außenkarte (Pulte: p.hold) und die Ruderbefehle der Steuerung; nur das Hinunterbeamen und das Versetzen auf Orte (debugGoto) laufen direkt.
//
//   const R = require('./sl-bots.js');
//   R.laufGasriese({ seed })                      Gasfeld: schöpfen, auftauchen, in Concordia verkaufen (Buch sl_gasriese)
//   R.laufForschung({ seed, ablenkung: true })    Helix: scannen, nach Ansage fliegen, Landepunkt-Scan, Station (4 Pulte, Monster), Finale, Concordia (Buch sl_forschung)
//   R.laufBoje({ seed, weg: 'A'|'B' })            Bojenfeld: Adresse (Captain sagt an, Ops setzt), Energie, Feld, wecken, Vorläufer-Sektor (Buch k10_boje)
//   R.alle({ seed })                              alle vier Läufe; Rückgabe [{ name, ok, sek, info }]
// Jeder Lauf liefert { name, ok, sek (Spielsekunden), info, fehler }. Ohne Ablenkung versuchen die Bots die Station bis zu `versuche` mal (jedes Scheitern
// ist der Ausgang `verloren`, die Szene beginnt von vorn – wie in der Kette).
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
const Boje = require('../server/sim/boje.js');
const Fracht = require('../server/sim/fracht.js');
const space = require('../server/sim/space.js');

const DT = 1 / CONFIG.tickHz;
const DIR = path.join(__dirname, '..', 'content', 'regiebuecher-sund');
const buchDatei = (id) => { for (const d of [DIR, path.join(__dirname, '..', 'content', 'regiebuecher')]) { const f = path.join(d, id + '.regiebuch.json'); if (fs.existsSync(f)) return f; } return null; };

function spiel(np, seed) {
  const g = new Game({ noStore: true, worlds: false, seed: seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'SL' + i, name: 'Bot' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund');
  g.god = true;
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { if (mev.length < 4000) mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  const T = { g, cs, run, mev, t0: g.time };
  T.cmd = (cmd, f, i) => { const c = cs[i || 0]; c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.rolle = (r, i) => { g.players[i || 0].console = r; };
  // PAN-01 A: Module ziehen je 1 Energie; die Technik schaltet sie ab (technik.module), damit Reaktorpunkte frei werden (Boje)
  T.moduleAus = () => { for (const m of g.ship.module.slice()) require('../server/sim/space.js').technikModul(g, m.id, false, m.raum); };
  T.moduleAn = () => { for (const m of g.ship.module.slice()) require('../server/sim/space.js').technikModul(g, m.id, true, m.raum); };
  T.energie = (o) => { Object.assign(g.ship.powerIntent || (g.ship.powerIntent = {}), o); Object.assign(g.ship.power, o); };
  T.sek = () => Math.round(g.time - T.t0);
  // Navigation nach Ansage: Wegpunkte der Reihe nach, Drift 120 px voraus ausgleichen (die Ops sagt Stärke und Richtung an)
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
function buch(T, id) {
  const f = buchDatei(id); if (!f) throw new Error('Buch ' + id + ' nicht gefunden');
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  doc.kopf.art = 'generiert';   // registerBook (Labor-Weg) nimmt nur generiert/archiv; die Kette startet Kapitel selbst
  const m = T.g.mission; m.startCampaign({ tutorial: false });
  m.registerBook(doc, { origin: 'sl' }); m.startMission(doc.id);
  return { m, doc, ms: () => m.missions[doc.id], schritt: () => m.step && m.step.id };
}
function ergebnis(name, T, ok, info) { return { name, ok: !!ok, sek: T.sek(), info: info || '', fehler: T.g.errorCount != null ? T.g.errorCount : undefined }; }

// ---------------------------------------------------------------------------------------------------------------- Gasriese
function laufGasriese(o) {
  const T = spiel(2, o && o.seed); const g = T.g;
  try {
    g.debugGoto('pulverhorn', false); T.run(0.5);
    const B = buch(T, 'sl_gasriese'); T.run(5);
    g.debugGoto('gasfeld', false); T.run(2);
    const pl = Locations.get('gasfeld').scene.planeten.find((p) => p.art === 'gasriese');
    T.energie({ engines: 2, shields: 2, weapons: 2 });
    // Technik: Schilde hoch, Navigation: in der Förderschicht halten (Zug und Strömung treiben, der Bot setzt nach = der Antrieb hält die Höhe),
    // Ops: STARTET das Schöpfen (weapons.schoepfen; nichts füllt sich von selbst), beobachtet die Ladung. Echter Schaden (kein god): der Bot muss überleben.
    g.god = false; const em0 = g.stats.emergencies;
    T.rolle('weapons');
    const halt = () => { g.ship.x = pl.x + pl.r * 0.8; g.ship.y = pl.y; g.ship.vx = 0; g.ship.vy = 0; };
    halt(); T.run(3, () => { halt(); return false; });
    const leer = Fracht.anBord(g) === 0;   // ohne Aktion bleibt der Frachtraum leer
    g.ship.hull = 100;   // Reparatur nach dem Eintauchen (Technik)
    const startErr = T.cmd('weapons.schoepfen');
    const gestartet = !startErr.length && !!(g.fracht.halt && g.fracht.halt.kind === 'schoepf');
    T.run(240, () => { halt(); return Fracht.anBord(g, 'deuterium') >= 2 && !g.fracht.halt; });   // nach der zweiten Einheit beendet sich das Schöpfen von selbst (Frachtraum voll)
    const geschoepft = Fracht.anBord(g, 'deuterium');
    const lebt = g.stats.emergencies === em0 && g.ship.hull > 0;
    const hull = Math.round(g.ship.hull);
    g.god = true;
    T.cmd('weapons.abwerfen');
    const nachAbwurf = Fracht.anBord(g, 'deuterium');
    Fracht.anBordLegen(g, 'deuterium');
    g.debugGoto('concordia', true); T.run(3);
    T.rolle('weapons');
    const err = T.cmd('weapons.verkaufen');
    T.run(4);
    T.run(3);
    const ms = B.ms();
    return ergebnis('gasriese', T, leer && gestartet && lebt && geschoepft >= 1 && nachAbwurf === geschoepft - 1 && ms && ms.state === 'done' && ms.ausgang === 'erfolg',
      `${leer ? 'nichts ohne Aktion' : 'FÜLLT SICH VON SELBST'}, Schöpfen ${gestartet ? 'gestartet' : 'NICHT gestartet ' + startErr[0]}, ${geschoepft} Einheiten, Hülle ${hull}${lebt ? '' : ' (TOT)'}, Abwurf ok, Verkauf ${err.length ? err[0] : 'ok'}, Ausgang ${ms && ms.ausgang}`);
  } catch (e) { return { name: 'gasriese', ok: false, sek: T.sek(), info: 'Ausnahme', fehler: String(e.stack || e).split('\n').slice(0, 3).join(' | ') }; } finally { Welt.waehle(g, 'limes'); }
}

// ---------------------------------------------------------------------------------------------------------------- Forschungsstation
// Hack eines Pults über die echte Hold-Mechanik; ablenkung = die zweite Spielerin lockt das Monster auf dem Weg von den Pulten weg
function pultHacken(T, id, ablenkung, P, mk) {
  const g = T.g; const aw = g.away; const p = g.players[0]; const p2 = g.players[1];
  const pos = P.pos[id]; const pa = Mon.naechster(mk, pos[0], pos[1], 2); const pc = Mon.mitte(pa);
  p.x = pc.x; p.y = pc.y; p.downed = false;
  const dp = Mon.bfs(mk, [pa]); let fern = null, fd = -1;
  for (let cy = 1; cy < mk.h; cy++) for (let cx = 1; cx < mk.w; cx++) { const d = dp[cy * mk.w + cx]; if (d > fd) { fd = d; fern = { cx, cy }; } }
  p.hold = { kind: 'anker:terminal', op: 'download', anker: id, t: 0, dur: 6, tx: pos[0], ty: pos[1] };
  const M = aw.monster;
  let ok = false;
  T.run(14, (t) => {
    if (p.downed) return true;
    p.actDown = true;   // E gehalten
    if (Anker.zustand(g, aw.map, id) === 'geladen') { ok = true; return true; }
    if (!p.hold) p.hold = { kind: 'anker:terminal', op: 'download', anker: id, t: 0, dur: 6, tx: pos[0], ty: pos[1] };
    if (ablenkung && M && !p2.downed && Math.floor(t * 2) !== Math.floor((t - DT) * 2)) {
      // die Ablenkung bleibt in Sichtweite vor dem Monster und läuft von den Pulten weg: 6 Ankerpunkte weiter, immer weg vom Pult (aufsteigende Pfadentfernung)
      let c = Mon.ankerVon(M.x, M.y);
      if (!mk.geht(c.cx, c.cy)) c = Mon.naechster(mk, Math.floor(M.x / 32), Math.floor(M.y / 32), 2) || c;
      for (let k = 0; k < 6; k++) {
        let best = null, bd = dp[c.cy * mk.w + c.cx];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = c.cx + dx, ny = c.cy + dy; if (mk.geht(nx, ny) && dp[ny * mk.w + nx] > bd) { bd = dp[ny * mk.w + nx]; best = { cx: nx, cy: ny }; } }
        if (!best) break; c = best;
      }
      const q = Mon.mitte(c); p2.x = q.x; p2.y = q.y;
    }
    return false;
  });
  p.hold = null; p.actDown = false;
  return ok || Anker.zustand(g, aw.map, id) === 'geladen';
}

function laufForschung(o) {
  const ablenkung = !(o && o.ablenkung === false);
  const name = 'forschung' + (ablenkung ? '-mit-ablenkung' : '-ohne-ablenkung');
  const versuche = (o && o.versuche) || (ablenkung ? 3 : 8);
  const T = spiel(2, o && o.seed); const g = T.g;
  try {
    g.debugGoto('pulverhorn', false); T.run(0.5);
    const B = buch(T, 'sl_forschung'); T.run(5);
    g.debugGoto('helix', false); T.run(2);
    const gv = Locations.get('helix').scene.gravimetrie;
    g.ship.x = gv.start.x; g.ship.y = gv.start.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0;
    T.energie({ engines: 3, shields: 2, weapons: 1 });
    T.rolle('weapons'); T.run(0.2); T.cmd('weapons.zonenscan'); T.run(3.5);
    T.fliege(gv.weg.slice(1), 120, () => B.schritt() === 'station'); T.run(1);
    if (B.schritt() !== 'station') return ergebnis(name, T, false, 'Gravimetrie nicht durchflogen (Schritt ' + B.schritt() + ')');
    g.ship.helm.stage = 1; g.ship.helm.turn = 0; g.ship.vx = 0; g.ship.vy = 0;
    T.rolle('weapons'); T.run(0.3); T.cmd('weapons.landescan'); T.run(4.5);
    // Außenteam hinunter; bei „verloren“ beginnt die Szene von vorn (die Kette wiederholt)
    let versuch = 0, fertig = false;
    for (; versuch < versuche && !fertig; versuch++) {
      if (versuch > 0) { T.run(2); B.m.startMission(B.doc.id); T.run(1); B.m.forceStep(B.doc.id, 'station'); T.run(1); g.ship.x = gv.station.x - 100; g.ship.y = gv.station.y; }
      for (const q of g.players) { q.downed = false; }
      away.executeBeam(g, g.players.map((q) => q.id), 'up'); g.players.forEach((q) => { q.zone = 'ship'; });
      T.run(1);
      g.chooseLandepunkt(g.players[0], 'helix.station');
      away.executeBeam(g, g.players.map((q) => q.id), 'down'); T.run(1);
      const aw = g.away; if (!aw || !aw.monsterPulte) continue;
      const mk = Monster.maskeVon(g.karteOf(aw.map)); const P = aw.monsterPulte;
      for (let i = 0; i < P.order.length; i++) {
        if (!pultHacken(T, P.order[i], ablenkung, P, mk)) break;
        T.run(0.5);
      }
      T.run(1.5);
      const ms = B.ms();
      if (process.env.SL_BOTS_V) console.log('  Versuch', versuch + 1, 'Pulte', P.erledigt, 'unten', g.players.map((q) => q.downed), 'Monster', aw.monster && aw.monster.z, 'Schritt', B.schritt(), 'Ausgang', ms && ms.ausgang);
      if (P.fertig && B.schritt() === 'rueckbeamen') fertig = true;
      else if (ms && ms.state === 'done' && ms.ausgang === 'verloren') { /* nächster Versuch */ }
    }
    if (!fertig) return ergebnis(name, T, false, `Station nach ${versuch} Versuchen nicht geschafft`);
    away.executeBeam(g, g.players.map((q) => q.id), 'up'); g.players.forEach((q) => { q.zone = 'ship'; q.downed = false; });
    T.run(2);
    g.ship.x = gv.station.x; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0;
    T.energie({ engines: 4, shields: 1, weapons: 1 });
    T.fliege(gv.fluchtweg, 90, () => B.schritt() === 'abliefern_anflug'); T.run(1);
    if (B.schritt() !== 'abliefern_anflug') return ergebnis(name, T, false, 'Finale: nicht aus dem Haltefeld (Schritt ' + B.schritt() + ')');
    g.debugGoto('concordia', true); T.run(3);
    const ms = B.ms();
    return ergebnis(name, T, ms && ms.state === 'done' && ms.ausgang === 'erfolg', `Station im ${versuch}. Versuch${ablenkung ? ' (mit Ablenkung)' : ' (ohne Ablenkung)'}, Ausgang ${ms && ms.ausgang}`);
  } catch (e) { return { name, ok: false, sek: T.sek(), info: 'Ausnahme', fehler: String(e.stack || e).split('\n').slice(0, 3).join(' | ') }; } finally { Welt.waehle(g, 'limes'); }
}

// ---------------------------------------------------------------------------------------------------------------- Boje
function laufBoje(o) {
  const weg = (o && o.weg) || 'B';
  const name = 'boje-weg-' + weg;
  const T = spiel(2, o && o.seed); const g = T.g;
  try {
    g.weltstand.data.fakten.lerche_weg = weg === 'A' ? 'loesegeld' : 'soeldner';
    g.debugGoto('pulverhorn', false); T.run(0.5);
    const B = buch(T, 'k10_boje'); T.run(5);
    g.debugGoto('bojenfeld', false); T.run(2);
    const sc = Locations.get('bojenfeld').scene;
    const halten = () => { g.ship.x = sc.bojeFeld.x + 30; g.ship.y = sc.bojeFeld.y; g.ship.vx = 0; g.ship.vy = 0; };
    // Captain (Spieler 2) liest die Konstellation aus dem Snapshot vor, die Ops (Spieler 1) setzt Stern für Stern und sendet
    T.rolle('weapons', 0); T.rolle('captain', 1);
    const gl = g.snapshot().gl;
    if (!gl || !gl.m) return ergebnis(name, T, false, 'keine Glyphen-Aufgabe');
    for (let i = 0; i < 9; i++) if (gl.m[i] === '1') T.cmd('weapons.glyphen.waehle', { i });
    T.cmd('weapons.glyphen.senden');
    // Technik: Waffen herunterfahren und Bordmodule abschalten (4 Punkte frei), Navigation: im Feld halten
    T.energie({ weapons: 0 }); T.moduleAus();
    halten(); T.run(120, () => { halten(); return Boje.geweckt(g); });
    if (!Boje.geweckt(g)) return ergebnis(name, T, false, 'Boje nicht erwacht (Zähler ' + Math.round(ZonenSim.zaehler(g, 'boje')) + ')');
    T.energie({ weapons: 2 }); T.moduleAn();
    const piraten = g.space.enemies.filter((e) => e.kind === 'raider').length;
    T.run(2);
    g.debugGoto('vorlaeufer', false); T.run(2);
    const ms = B.ms();
    const wettlaufOk = weg === 'A' ? piraten >= 2 : piraten === 0;
    return ergebnis(name, T, wettlaufOk && ms && ms.state === 'done' && ms.ausgang === 'erfolg' && g.explore.kanteOffen(Sektoren.kanteId('0706', '0806')), `${piraten} Piraten, Ausgang ${ms && ms.ausgang}, Kante offen ${g.explore.kanteOffen(Sektoren.kanteId('0706', '0806'))}`);
  } catch (e) { return { name, ok: false, sek: T.sek(), info: 'Ausnahme', fehler: String(e.stack || e).split('\n').slice(0, 3).join(' | ') }; } finally { Welt.waehle(g, 'limes'); }
}

function alle(o) {
  return [laufGasriese(o), laufForschung(Object.assign({}, o, { ablenkung: true })), laufForschung(Object.assign({}, o, { ablenkung: false })), laufBoje(Object.assign({}, o, { weg: 'A' })), laufBoje(Object.assign({}, o, { weg: 'B' }))];
}

module.exports = { laufGasriese, laufForschung, laufBoje, alle, spiel };
