'use strict';
// SON-01 B: der Beat sondersektor (server/sim/faden-sondersektor.js, Daten content/welt/sondersektoren.json, Beat in content/faeden/beats.json). Ende zu Ende im ECHTEN Modus Freie Fahrt Sund (FAEDEN=1, Spielleiter
// im Mock, nur die Schleife der Ereignisse antwortet: je Spielsekunde ein setImmediate): der Beat startet das UNVERAENDERTE Regiebuch sl_forschung, der Bot spielt es (Muster tools/test-forschungsstation.js: Gravimetrie, Landepunkt-Scan,
// vier Pulte mit Ablenkung, Finale, Concordia) und der Faden erfaehrt den Ausgang. Der Weg ueber das Brett-Angebot ist Paket C: hier startet der Test den Beat wie ein Faden es tut (Faden.weiterSetzen).
//   A  Katalog: Beat nur_inszenierer, nicht im Prompt-Katalog (Katalogtext mit und ohne den Eintrag gleich), Bauplan-Katalog gueltig, Daten und Parameter passen zusammen, Baustein registriert
//   B  Bot-Lauf durch das ganze Buch bis erfolg auf dem REALEN Weg (echte Spruenge Ostia Nova -> Porta Australis -> Brachland -> Pulverhorn -> Helix -> Pulverhorn -> Concordia, echtes Andocken, Reise-Ereignisse): Crew 1 und Crew 3 (Beat gelungen, 220 Marken, Flag, Fehler 0, Frist traegt den gemessenen Verbrauch mit doppelter Reserve)
//   C  Ausgang verloren: Beat gescheitert, kein Neustart; Neustart nach dem Verlust (neuer Faden) und durch das Buch bis erfolg
//   D  Einmaligkeit nach Erfolg
//   E  Voraussetzungen: zu weit, Szene, andere Mission, unbekannter Sektor: Beat gescheitert mit Logbuch, Buch nie gestartet
//   F  Speichern angedockt und Laden mitten im Beat, danach bis zum Ausgang
//   G  Frist: Ablauf raeumt das Buch ab (kein Zombie), danach ist ein neuer Start moeglich
//   H  Zielwahl unberuehrt: Helix wird in 100 Zielwuerfen je Hafen nie Ziel
//   node tools/test-sondersektor-beat.js [--nur A,B1,B3,C,D,E,F,G,H]      Mutationsprobe: tools/mutation-sondersektor-beat.js
const fs = require('fs');
const path = require('path');
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const CONFIG = require('../shared/config.js');
const Zonen = require('../shared/zonen.js');
const Mon = require('../shared/monster.js');
const Locations = require('../shared/locations.js');
const Sektoren = require('../shared/sektoren.js');
const away = require('../server/sim/away.js');
const Anker = require('../server/sim/anker.js');
const Monster = require('../server/sim/monster.js');
const ZonenSim = require('../server/sim/zonen.js');
const Lpscan = require('../server/sim/lpscan.js');
const Faden = require('../server/sim/faden.js');
const Bausteine = require('../server/sim/faden-bausteine.js');
const Sond = require('../server/sim/sondersektoren.js');
const SB = require('../server/sim/faden-sondersektor.js');
const B1 = require('../server/sim/faden-b1.js');
const Ziel = require('../server/sim/abenteuer-ziel.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');
const Mock = require('../server/sim/abenteuer-mock.js');
const Dat = require('../server/weltsim/daten.js');
const { F, D } = X;

const DT = 1 / CONFIG.tickHz;
const NUR = (process.argv.indexOf('--nur') > 0 ? process.argv[process.argv.indexOf('--nur') + 1] : '').split(',').filter(Boolean);
const gewollt = (k) => !NUR.length || NUR.includes(k);
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const frei = () => new Promise((r) => setImmediate(r));
async function abschnitt(name, key, body) {
  if (!gewollt(key)) return;
  console.log('\n[' + name + ']');
  try { await body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund', 'Dara_Voss'];
const BUCH = 'sl_forschung';
const BEAT = 'b_helix';
// Testvorlage: der Beat, dahinter der Abschluss (eine Vorlage mit Beat sondersektor ist Paket C)
const vorlage = (id, sektor) => ({
  format: 'faden-vorlage/1', id, titel: 'Helix-Test', ausloeser: [{ art: 'notruf', ausgang: 'gelungen' }], volk_erlaubt: ['rom'], nsc: { status: 'aktiv', haltung: 0, klassen: ['korvette'] }, hinweise: {},
  beats: [
    { id: BEAT, typ: 'sondersektor', parameter: { sektor }, aus: { gelungen: { status: 'aktiv' }, gescheitert: { status: 'geflohen' } } },
    { id: 'b_abschluss', typ: 'abschluss', erfolg: { ereignis: ['sondersektor_gelungen'] }, aus: { gelungen: { folge: [] }, gescheitert: { folge: [] } } },
  ],
});
let vNr = 0;
function neuesSpiel(crew, seed, o) {
  const g = F.neuesSpiel(Object.assign({ crew, seed, names: NAMEN.slice(0, crew), env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: '1' } }, o || {}));
  mitLage(g.g);
  return g;
}
function mitLage(g) {
  const sl = LS.create(g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 9999 } });
  g.lageSpielleiter = sl; g.lageSchalter = true;
  return sl;
}
const liste = (g) => g.weltsim.faeden.liste;
const logbuch = (g) => ((g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || []).filter((e) => e.art === 'faden_baustein' && e.key === 'sondersektor');
function funkMit(g) {
  const out = []; const orig = g.emit.bind(g);
  g.emit = (...a) => { if (a[0] === 'radio' && a[1]) out.push(a[1]); return orig(...a); };
  return out;
}
// SON-01 C: das ANGEBOT prueft die Lage (faden-pruefer.js pruefeLage: schon gelungen, Pulverhorn zu weit, unbekannter Sektor, tools/test-sondersektor-angebot.js). Dieser Test prueft den START des Beats unter genau diesen
// Bedingungen (der Baustein darf sich nie auf das Angebot verlassen): der Faden wird darum ohne die Lage geoeffnet
function ohneAngebotsLage(fn) { const P = require('../server/sim/faden-pruefer.js'), o = P.pruefeLage; P.pruefeLage = () => null; try { return fn(); } finally { P.pruefeLage = o; } }
// Ein Faden mit dem Beat sondersektor, geoeffnet ueber den echten Weg (Angebot, faden_oeffnen); der Beat startet mit weiterSetzen, dem Schritt von faden_weiter
function faden(g, sektor) {
  const id = 'helix_test_' + (++vNr);
  const r = D.registriere(vorlage(id, sektor || 'helix'));
  if (!r.ok) throw new Error('Testvorlage ungueltig: ' + r.fehler.join('; '));
  const f = ohneAngebotsLage(() => X.oeffne(g, id));
  if (!f) throw new Error('Faden nicht geoeffnet');
  return f;
}
const starte = (g, f) => Faden.weiterSetzen(g, { typ: 'faden_weiter', faden: f.id, beat: BEAT });
// Eigene Rechnung des Fadens: Phase, Beat und letztes Ereignis des Gedaechtnisses
const stand = (g, f) => { const x = liste(g).find((y) => y.id === f.id); return { phase: x.phase, beat: x.beat, ereignis: (x.nsc.gedaechtnis[x.nsc.gedaechtnis.length - 1] || {}).ereignis, laufend: x.laufend, n: x.laufend ? x.laufend.n : null }; };
const mStand = (g) => g.mission.missions[BUCH] || null;

// ---------- Bot: das Buch durchspielen (Muster tools/test-forschungsstation.js, hier ueber den Beat gestartet und async wegen des Mock-Spielleiters)
function hilfe(g, cs) {
  g.god = true;
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  const HZ = Math.max(1, Math.round(CONFIG.tickHz));
  const T = { g, cs, mev };
  T.run = async (sec, each) => { const ticks = Math.round(sec / DT); for (let k = 0; k < ticks; k++) { if (each && each(k * DT) === true) return true; g.step(); if (k % HZ === 0) await frei(); } return false; };
  T.cmd = (cmd, f) => { cs[0].inbox.length = 0; g.handleMessage(cs[0], Object.assign({ t: 'cmd', c: cmd }, f || {})); return cs[0].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.rolle = (r) => { g.players[0].console = r; };
  T.energie = (o) => { Object.assign(g.ship.powerIntent || (g.ship.powerIntent = {}), o); Object.assign(g.ship.power, o); };
  T.fliege = (ziele, grenzeS, abbruch) => {   // Navigation nach Ansage (Drift 120 px voraus ausgleichen, Querfehler regeln)
    T.rolle('helm');
    let i = 0; let prev = { x: g.ship.x, y: g.ship.y };
    return T.run(grenzeS, () => {
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
// SON-01 Nacharbeit (Befund 2): der REALE Weg, damit die Frist an echten Taetigkeiten gemessen wird. Spruenge ueber den Server (Sprung.selectDest, Antrieb laden, Sprung.doJump) und echtes Andocken am Dock-Ring (langsam anfliegen)
// statt debugGoto: Andocken zaehlt eine Taetigkeit (game.lageGrenze), Spruenge ziehen die Reise-Ereignisse (Notrufe, Szenen) nach sich. Steuerung: sprungkette.steuere (Bot wie ein Spieler am Steuer)
const Sprung = require('../server/sim/sprung.js');
const Besitz = require('../server/sim/besitz.js');
const Kette = require('./sprungkette.js');
// Ein Reise-Ereignis mit Gegnern (Piratenueberfall am Notruf-Ort) wird NICHT gespielt: die Crew gewinnt (Gegner weg wie in tools/test-reise-ereignis.js), der Ereignis-Takt des Spiels laeuft normal weiter und liefert seine Taetigkeiten
const gegnerWeg = (g) => { if (g.space.enemies && g.space.enemies.length) g.space.enemies = []; };
async function echterSprung(T, ziel) {
  const g = T.g, sh = g.ship, S = { g, c: T.cs[0] };
  T.rolle('helm'); gegnerWeg(g);
  const err = Sprung.selectDest(g, ziel);
  if (err) return 'selectDest ' + ziel + ': ' + err;
  let fertig = false, grund = null;
  const radius = (g.C.sektoren.sprungpunktRadius || 250) - 40;
  await T.run(600, () => {
    const pt = Sprung.sprungpunkt(g, ziel);
    if (!pt) { grund = 'kein Sprungpunkt'; return true; }
    gegnerWeg(g);
    if (sh.jump.ready) { grund = Sprung.doJump(g); fertig = !grund; sh.vx = sh.vy = 0; return true; }
    if (Math.hypot(sh.x - pt.x, sh.y - pt.y) <= radius) g.handleMessage(S.c, { t: 'cmd', c: 'helm.stop' });
    else Kette.steuere(S, Math.max(180, Math.min(pt.x, g.space.w - 180)), Math.max(180, Math.min(pt.y, g.space.h - 180)));
    return false;
  });
  return fertig ? null : (grund || 'Zeitueberschreitung beim Sprung nach ' + ziel + ' (' + sh.jump.blockedReason + ', Szene ' + sh.scene + ', Abstand ' + Math.round(Math.hypot(sh.x - ((Sprung.sprungpunkt(g, ziel) || {}).x || 0), sh.y - ((Sprung.sprungpunkt(g, ziel) || {}).y || 0))) + ')');
}
async function echtAndocken(T) {
  const g = T.g, sh = g.ship, S = { g, c: T.cs[0] };
  T.rolle('helm');
  const loc = Locations.get(sh.scene), hex = Sektoren.hexVonOrt(loc.id);
  await T.run(300, () => {
    gegnerWeg(g);
    if (sh.docked) return true;
    const dl = Besitz.dockLage(g, loc.scene, hex);
    if (!dl) return true;
    const d = Math.hypot(sh.x - dl.x, sh.y - dl.y);
    Kette.steuere(S, dl.x, dl.y);
    if (d < 260) g.handleMessage(S.c, { t: 'cmd', c: 'helm.throttle', set: sh.speed > 20 ? 1 : 2 });   // das letzte Stueck langsam: Andocken verlangt Tempo unter C.travel.dockSpeed
    return false;
  });
  return sh.docked ? null : 'nicht angedockt in ' + loc.id;
}
// Hin: Ostia Nova (angedockt) -> Porta Australis (andocken) -> Brachland (kein Hafen) -> Pulverhorn (andocken); Rueckweg: Helix -> Pulverhorn (kein Halt) -> Concordia (andocken)
async function wegHin(T) {
  const fehler = [];
  for (const [ziel, dock] of [['0405', true], ['0505', false], ['0605', true]]) {
    const e = await echterSprung(T, ziel); if (e) { fehler.push(e); break; }
    if (dock) { const d = await echtAndocken(T); if (d) { fehler.push(d); break; } }
    await T.run(2);
  }
  return fehler;
}
async function wegZurueck(T) {
  const fehler = [];
  // Das Haltefeld (Radius 800 um die Station) liegt zwischen Fluchtweg und Sprungpunkt: wie ein Spieler fliegt der Bot darum ueber den oberen Rand (y 150) um das Feld herum
  await T.fliege([{ x: 1300, y: 150 }, { x: 2500, y: 150 }], 200);
  await T.run(1);
  for (const [ziel, dock] of [['0605', false], ['0604', true]]) {
    const e = await echterSprung(T, ziel); if (e) { fehler.push(e); break; }
    if (dock) { const d = await echtAndocken(T); if (d) { fehler.push(d); break; } }
    await T.run(2);
  }
  return fehler;
}
// Vom Schritt anflug_helix (nach dem Auftrag) bis zur Ablieferung in Concordia. pre = Text vor jeder Pruefung; echt = der reale Weg (Sprung zum Helix, Rueckweg ueber Pulverhorn nach Concordia mit echtem Andocken) statt debugGoto
async function buchSpielen(T, pre, echt) {
  const g = T.g, m = g.mission, p = pre ? pre + ': ' : '';
  await T.run(5);
  ok(m.step && m.step.id === 'anflug_helix', p + 'Schritt anflug_helix (nach dem Auftrag)');
  ok(!!g.explore.tempKante(Sektoren.kanteId('0605', '0506')), p + 'der temporaere Sprungpunkt Pulverhorn -> Helix ist offen (das Buch oeffnet ihn)');
  if (echt) { const e = await echterSprung(T, '0506'); ok(!e, p + 'echter Sprung Pulverhorn -> Helix ueber den temporaeren Sprungpunkt' + (e ? ': ' + e : '')); await T.run(2); }
  else { g.debugGoto('helix', false); await T.run(2); }
  ok(m.step && m.step.id === 'gravimetrie', p + 'am Helix: Schritt gravimetrie');
  const gv = Locations.get('helix').scene.gravimetrie;
  g.ship.x = gv.start.x; g.ship.y = gv.start.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0;
  T.energie({ engines: 3, shields: 2, weapons: 1 });
  T.rolle('weapons'); await T.run(0.2);
  ok(T.cmd('weapons.zonenscan').length === 0, p + 'Ops startet den Zonen-Scan');
  await T.run(3.5);
  ok(ZonenSim.istBekannt(g, 'gravi_feld0'), p + 'Scan fertig: gravi_feld0 bekannt');
  await T.fliege(gv.weg.slice(1), 90, () => m.step && m.step.id === 'station');
  await T.run(1);
  ok(m.step && m.step.id === 'station' && !T.mev.some((e) => e.kind === 'zoneRuecksetzen'), p + 'Station erreicht ohne Ruecksetzer, Schritt station');
  g.ship.helm.stage = 1; g.ship.helm.turn = 0; g.ship.vx = 0; g.ship.vy = 0;
  T.rolle('weapons'); g.ship.vx = 0; g.ship.vy = 0; await T.run(0.3);
  if (Lpscan.gescannt(g, 'helix.station')) ok(true, p + 'Landepunkt helix.station war schon gescannt (bleibt es, auch nach einem Verlust)');   // nur beim Neustart nach Verlust
  else {
    ok(Lpscan.ziele(g).some((q) => q.id === 'helix.station'), p + 'Landepunkt helix.station in Scanreichweite');
    ok(T.cmd('weapons.landescan').length === 0, p + 'Ops startet den Landepunkt-Scan');
    await T.run(4.5);
    ok(Lpscan.gescannt(g, 'helix.station'), p + 'Landepunkt gescannt');
  }
  const err = g.chooseLandepunkt(g.players[0], 'helix.station');
  away.executeBeam(g, g.players.map((q) => q.id), 'down');
  await T.run(1);
  const aw = g.away;
  ok(!err && aw.map === 'helix.station' && aw.monster && aw.monsterPulte, p + 'Team auf der Station, Monster und Pulte eingerichtet');
  const k = g.karteOf(aw.map); const mk = Monster.maskeVon(k); const P = aw.monsterPulte;
  const hacken = async (id) => {
    const pos = P.pos[id]; const pa = Mon.naechster(mk, pos[0], pos[1], 2); const pc = Mon.mitte(pa);
    g.players[0].x = pc.x; g.players[0].y = pc.y;
    Anker.setzen(g, aw.map, id, 'laedt', g.players[0].id);
    const dp = Mon.bfs(mk, [pa]); let fern = null, fd = -1;
    for (let cy = 1; cy < mk.h; cy++) for (let cx = 1; cx < mk.w; cx++) { const d = dp[cy * mk.w + cx]; if (d > fd) { fd = d; fern = { cx, cy }; } }
    const M = aw.monster; const fp = Mon.mitte(fern);
    await T.run(6.2, () => { M.laerm = { x: fp.x, y: fp.y, t: g.time, w: 900, art: 'fertig' }; if (M.z === 'jagd') { M.z = 'laerm'; M.verlust = 0; } M.x = fp.x; M.y = fp.y; M.pfad = []; return false; });   // Ablenkung wie im Muster; dazu bleibt das Monster fern (mit Crew 1 gibt es keine zweite Spielerin, die es ablenkt)
    Anker.completeHold(g, g.players[0], { kind: 'anker:terminal', anker: id, op: 'download', tx: pos[0], ty: pos[1] });
    await T.run(0.5);
  };
  const reihenfolge = [];
  for (let i = 0; i < 4; i++) {
    const id = P.order[i];
    reihenfolge.push(P.order.slice(i + 1).every((q) => Anker.zustand(g, aw.map, q) === 'gesperrt'));
    await hacken(id);
    if (g.players[0].downed) break;
  }
  ok(reihenfolge.every(Boolean), p + 'Reihenfolge: je Hack waren die spaeteren Pulte gesperrt');
  ok(P.erledigt === 4 && P.fertig, p + 'vier Pulte gehackt (' + P.erledigt + '/4)');
  await T.run(1.5);
  ok(m.step && m.step.id === 'rueckbeamen' && ZonenSim.szeneZonen(g).some((z) => z.id === 'halt_feld'), p + 'Haltefeld an, Schritt rueckbeamen (Schritt ' + (m.step && m.step.id) + ', Pulte ' + P.erledigt + ')');
  away.executeBeam(g, g.players.map((q) => q.id), 'up'); g.players.forEach((q) => { q.zone = 'ship'; });
  await T.run(2);
  ok(m.step && m.step.id === 'finale', p + 'Team an Bord: Schritt finale');
  g.ship.x = gv.station.x; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0;
  T.energie({ engines: 4, shields: 1, weapons: 1 });
  await T.fliege(gv.fluchtweg, 60, () => m.step && m.step.id === 'abliefern_anflug');
  await T.run(1);
  ok(m.step && m.step.id === 'abliefern_anflug', p + 'aus dem Haltefeld heraus: Schritt abliefern_anflug');
  const m0 = g.inventory.marks;
  if (echt) { const f = await wegZurueck(T); ok(f.length === 0, p + 'Rueckweg Helix -> Pulverhorn -> Concordia mit echten Spruengen und echtem Andocken' + (f.length ? ': ' + f.join('; ') : '')); await T.run(3); }
  else { g.debugGoto('concordia', true); await T.run(3); }
  const ms = mStand(g);
  ok(ms && ms.state === 'done' && ms.ausgang === 'erfolg', p + 'in Concordia angedockt: Buch fertig, Ausgang erfolg');
  ok(g.inventory.marks >= m0 + 220 && m.state.flags && m.state.flags.forschungFertig === true, p + 'Lohn 220 Marken, Flag forschungFertig');
}
// Verlust: alle am Boden (Muster test-forschungsstation.js), Buch endet mit Ausgang verloren
async function buchVerlieren(T) {
  const g = T.g, m = g.mission;
  await T.run(4);
  g.debugGoto('helix', false); await T.run(1.5);
  const gv = Locations.get('helix').scene.gravimetrie;
  g.ship.x = gv.station.x - 100; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0;
  m.forceStep(BUCH, 'station'); await T.run(1);
  Lpscan.markieren(g, 'helix.station');
  g.chooseLandepunkt(g.players[0], 'helix.station'); away.executeBeam(g, g.players.map((q) => q.id), 'down'); await T.run(1);
  const k = g.karteOf(g.away.map); const mk = Monster.maskeVon(k); const p = g.players[0];
  const a = Mon.naechster(mk, Math.floor(p.x / 32), Math.floor(p.y / 32), 2); const pc = Mon.mitte(a); p.x = pc.x; p.y = pc.y;
  const dn = Mon.bfs(mk, [a]); let mp = null;
  for (let cy = 1; cy < mk.h && !mp; cy++) for (let cx = 1; cx < mk.w; cx++) if (dn[cy * mk.w + cx] === 3) { mp = { cx, cy }; break; }
  const M = g.away.monster; const mpos = Mon.mitte(mp); M.x = mpos.x; M.y = mpos.y; M.pfad = []; M.pause = 0;
  await T.run(15, () => mStand(g).state === 'done' || (m.step && m.step.id !== 'station'));
}
// PAR-01 Empfehlung 7: kein Test mit fester Zaehlung. "Der Beat kostet den Prompt-Katalog 0 Zeichen" heisst: der Katalogtext ist mit und ohne den Eintrag im Speicher derselbe Text (Mengenbeziehung, unabhaengig von der Zahl der
// anderen planbaren Beats). Der Eintrag wird nur im Speicher entfernt (Reihenfolge der uebrigen bleibt) und im finally samt Katalog-Cache wiederhergestellt
function katalogOhneBeat(typ) {
  const alle = Object.entries(D.BEATS);
  try {
    delete D.BEATS[typ]; Prompt.katalogNeuLesen();
    return Prompt.katalogText();
  } finally {
    for (const k of Object.keys(D.BEATS)) delete D.BEATS[k];
    for (const [k, v] of alle) D.BEATS[k] = v;
    Prompt.katalogNeuLesen();
  }
}
const Zahl = (g) => g.errors || 0;   // g.errors ist eine Zahl (game.js countError)

(async () => {
  // ---------------- A: Katalog
  await abschnitt('A  Katalog, Daten, Prompt', 'A', async () => {
    const b = D.BEATS.sondersektor;
    ok(!!b && b.nur_inszenierer === true && b.verlegt_ort === true && b.baustein === 'sondersektor' && Number.isInteger(b.frist) && b.frist > D.WERTE.beat_frist, 'Beat sondersektor: nur_inszenierer, verlegt_ort, eigene Frist ueber dem Standard (' + (b && b.frist) + ' statt ' + D.WERTE.beat_frist + ')');
    ok(b.gefahr === true && b.optionen === 'keine' && b.bauplan && b.bauplan.aus && b.bauplan.aus.gelungen && b.bauplan.aus.gescheitert && b.bauplan.aus.gelungen.status.join() !== b.bauplan.aus.gescheitert.status.join(), 'Gefahr (Gravitation, Monster), keine Optionen, bauplan mit aus.gelungen und aus.gescheitert');
    ok(JSON.stringify(b.parameter) === JSON.stringify({ pflicht: ['sektor'], optional: [] }) && JSON.stringify(b.bauplan.parameter.sektor.erlaubt) === JSON.stringify(Sond.ids()) && b.bauplan.parameter.sektor.standard === Sond.ids()[0], 'Parameter sektor (Pflicht): erlaubt = die Ids der Sondersektor-Daten (' + Sond.ids().join(',') + ')');
    ok(Bausteine.vonId('sondersektor') && !Bausteine.istPlatzhalter('sondersektor') && Bausteine.vonId('sondersektor') === SB.sondersektor, 'der Baustein ist registriert (kein Platzhalter)');
    const kat = Prompt.katalogText();
    ok(!/sondersektor/.test(kat) && !/Sondersektor/.test(kat), 'der Beat steht nicht im Prompt-Katalog');
    const ohne = katalogOhneBeat('sondersektor');
    ok(ohne === kat && Prompt.katalogText() === kat, 'der Beat kostet den Prompt-Katalog 0 Zeichen: der Katalogtext ist mit und ohne den Eintrag sondersektor im Speicher derselbe (' + kat.length + ' = ' + ohne.length + ' Zeichen) und nach dem Wiederherstellen unveraendert');
    let mitBeat = 0;
    for (let i = 0; i < 300; i++) { const p = Mock.gueltigerPlan(Mock.rngVon('son01-' + i), {}); if (JSON.stringify(p).includes('sondersektor')) mitBeat++; }
    ok(mitBeat === 0, 'Mock-Plankette: in 300 Zufallsplaenen kein Beat sondersektor');
    const pl = Object.keys(D.BEATS).filter((t) => D.BEATS[t].bauplan && !D.BEATS[t].abschluss && D.BEATS[t].nur_inszenierer !== true);
    ok(!pl.includes('sondersektor') && pl.length > 0, 'sondersektor gehoert nicht zu den planbaren Beat-Typen (Katalog des Modells, Mock; ' + pl.length + ' Typen)');
    ok(require('../server/sim/faden-pruefer.js').katalogFehler().length === 0, 'Beat-Katalog besteht den Pruefer (katalogFehler leer)');
    const bp = require('../server/sim/faden-bauplan.js');
    ok(bp.katalogFehler().length === 0, 'Bauplan-Katalog gueltig (katalogFehler leer)');
    ok(!/Sprung\.oeffnen|sprungpunkt_oeffnen|oeffnen\(/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-sondersektor.js'), 'utf8').replace(/\/\/.*$/gm, '')), 'der Baustein oeffnet den Sprungpunkt nie selbst (das Buch tut es im Schritt auftrag)');
    const r = D.registriere(vorlage('helix_pruef', 'helix'));
    ok(r.ok, 'Vorlage mit dem Beat besteht den Pruefer' + (r.ok ? '' : ': ' + r.fehler.join('; ')));
  });

  // ---------------- B: Bot-Laeufe, Crew 1 und Crew 3
  for (const crew of [1, 3]) {
    await abschnitt('B  Bot-Lauf Buch bis erfolg, Crew ' + crew, 'B' + crew, async () => {
      const { g, cs } = neuesSpiel(crew, 21);
      const funk = funkMit(g);
      const T = hilfe(g, cs);
      const f = faden(g);
      for (let i = 0; i < 12; i++) g.lageGrenze('andocken');
      const t0 = g.weltsim.faeden.t;
      ok(g.ship.docked && SB.voraussetzungen(g, Sond.sektor('helix')) === null, 'Voraussetzungen erfuellt: Crew im Hafen, Pulverhorn in hoechstens 3 Spruengen');
      const stg = g.mission.activeId;
      starte(g, f);
      const s0 = stand(g, f);
      ok(s0.phase === 'laeuft' && s0.laufend && s0.laufend.beat === BEAT, 'Beat laeuft (Phase ' + s0.phase + ')');
      ok(g.mission.activeId === BUCH && !stg && mStand(g).state === 'active', 'das Buch ' + BUCH + ' laeuft (Mission aktiv)');
      ok(funk.some((r) => /Hier Forschungsstation Helix/.test(r.text) && /0506/.test(r.text) && r.from === 'Forschungsstation Helix'), 'die Station spricht zum Start (Sprecher Station, Koordinate eingesetzt)');
      ok(logbuch(g).some((e) => e.ausgang === 'sondersektor'), 'Regie-Logbuch: Buch gestartet');
      const arten = {}; const lg0 = g.lageGrenze.bind(g); g.lageGrenze = (art) => { arten[art] = (arten[art] || 0) + 1; return lg0(art); };   // Taetigkeitsgrenzen nach Art (der echte Hook bleibt)
      const sprung0 = T.mev.filter((e) => e.kind === 'jumped' && !e.debug).length;
      const hin = await wegHin(T);   // der Beat laeuft schon: drei echte Spruenge von Ostia Nova nach Pulverhorn, Andocken in Porta Australis und Pulverhorn
      ok(hin.length === 0 && g.ship.scene === 'pulverhorn' && g.ship.docked, 'Crew ' + crew + ': Hinweg Ostia Nova -> Porta Australis -> Brachland -> Pulverhorn (3 echte Spruenge, 2 echte Docks)' + (hin.length ? ': ' + hin.join('; ') : ''));
      const tHin = g.weltsim.faeden.t - t0;
      await buchSpielen(T, 'Crew ' + crew, true);
      await T.run(1);
      const s1 = stand(g, f);
      ok(s1.beat === 1 && s1.phase === 'wartet' && s1.ereignis === 'sondersektor_gelungen', 'der Faden hat den Ausgang gelungen erhalten (Gedaechtnis ' + s1.ereignis + ', naechster Beat ' + s1.beat + ')');
      ok(f.parameter.ort === Sond.sektor('helix').ausgang.hex, 'SON-01 C: der Ortsparameter ist der Ausgangs-Hex der Daten (faden.parameter.ort ' + f.parameter.ort + ', Details: tools/test-sondersektor-angebot.js)');
      ok(Zahl(g) === 0 && (g.mission.pending || []).length === 0, 'Serverfehler 0, keine offenen Angebote (pending 0)');
      ok(funk.some((r) => /Messreihe ist gerettet/.test(r.text)), 'die Station meldet den Erfolg');
      const verbraucht = g.weltsim.faeden.t - t0, frist = D.BEATS.sondersektor.frist;
      const sprunge = T.mev.filter((e) => e.kind === 'jumped' && !e.debug).length - sprung0, docks = arten.andocken || 0;
      console.log('  MESSUNG Crew ' + crew + ' (realer Weg): Taetigkeiten im ganzen Buch (Faden-Zaehler t): ' + verbraucht + ' (davon bis Pulverhorn ' + tHin + '), nach Art ' + JSON.stringify(arten) + ', echte Spruenge ' + sprunge + ', Frist ' + frist + ', Spielzeit ' + Math.round(g.stats.missions[BUCH].end - g.stats.missions[BUCH].start) + ' s');
      ok(sprunge >= 6 && docks >= 3, 'Crew ' + crew + ': der Weg war echt (' + sprunge + ' Spruenge, ' + docks + ' Docks statt Teleport)');
      ok(verbraucht >= 1 && verbraucht < frist && s1.ereignis === 'sondersektor_gelungen', 'Crew ' + crew + ': die Frist traegt den realen Weg: nach ' + verbraucht + ' Taetigkeiten von ' + frist + ' lief der Beat noch und endete gelungen (nicht durch Fristablauf)');
      ok(verbraucht * 2 <= frist, 'Crew ' + crew + ': mindestens doppelte Reserve ueber dem gemessenen Verbrauch (' + verbraucht + ' x 2 <= ' + frist + ')');
    });
  }

  // ---------------- C: verloren, kein Neustart, Neustart nach Verlust
  await abschnitt('C  Ausgang verloren, kein Neustart; Neustart nach Verlust', 'C', async () => {
    const { g, cs } = neuesSpiel(1, 22);
    const funk = funkMit(g);
    const T = hilfe(g, cs);
    const f = faden(g);
    for (let i = 0; i < 12; i++) g.lageGrenze('andocken');
    starte(g, f);
    await buchVerlieren(T);
    const ms = mStand(g);
    ok(ms && ms.state === 'done' && ms.ausgang === 'verloren', 'alle am Boden: Ausgang verloren des Buchs');
    await T.run(2);
    const s = stand(g, f);
    ok(s.beat === 1 && s.phase === 'wartet' && s.ereignis === 'sondersektor_gescheitert', 'der Beat meldet gescheitert (Gedaechtnis ' + s.ereignis + ', Faden geht weiter, nicht beendet)');
    ok(funk.some((r) => /Messreihe ist verloren/.test(r.text)), 'die Station meldet den Verlust');
    const starts = T.mev.filter((e) => e.kind === 'missionStart').length;
    await T.run(40);
    ok(g.mission.activeId === null && !!mStand(g) && mStand(g).state === 'done' && mStand(g).ausgang === 'verloren' && T.mev.filter((e) => e.kind === 'missionStart').length === starts, 'kein Neustart des Buchs: 40 s spaeter noch Ende verloren, keine aktive Mission');
    ok(Zahl(g) === 0, 'kein Serverfehler');
    // Neustart: die Crew verlaesst den Helix (Notsprung), der Faden ist zu Ende, ein neuer Faden mit dem Beat startet das Buch neu
    Faden.weiterSetzen(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_abschluss' });
    g.debugGoto('pulverhorn', false); await T.run(1);
    const f2 = faden(g);
    ok(SB.voraussetzungen(g, Sond.sektor('helix')) === null, 'nach dem Verlust bleibt ein neuer Start moeglich (einmal bei_erfolg)');
    starte(g, f2);
    ok(stand(g, f2).phase === 'laeuft' && g.mission.activeId === BUCH && mStand(g).state === 'active' && mStand(g).ausgang === undefined, 'neuer Start: der Missionsstand ist neu angelegt (aktiv, ohne alten Ausgang)');
    await buchSpielen(T, 'Neustart');
    await T.run(1);
    ok(stand(g, f2).ereignis === 'sondersektor_gelungen' && Zahl(g) === 0, 'der zweite Anlauf endet gelungen, kein Serverfehler');
  });

  // ---------------- D: Einmaligkeit
  await abschnitt('D  Einmaligkeit nach Erfolg', 'D', async () => {
    const { g, cs } = neuesSpiel(1, 23);
    const funk = funkMit(g);
    const T = hilfe(g, cs);
    const f = faden(g);
    for (let i = 0; i < 12; i++) g.lageGrenze('andocken');
    starte(g, f);
    await buchSpielen(T, 'Erfolg');
    await T.run(1);
    Faden.weiterSetzen(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_abschluss' });
    g.debugGoto('pulverhorn', false); await T.run(1);
    const stand0 = JSON.stringify(g.mission.missions[BUCH]);
    const starts = T.mev.filter((e) => e.kind === 'missionStart').length;
    const hinten = funk.length;
    ok(/schon gelungen/.test(SB.voraussetzungen(g, Sond.sektor('helix')) || ''), 'Voraussetzung meldet: schon gelungen');
    const f2 = faden(g);
    starte(g, f2);
    const s2 = stand(g, f2);
    ok(s2.beat === 1 && s2.ereignis === 'sondersektor_gescheitert', 'direkter Start nach Erfolg: Beat gescheitert');
    ok(logbuch(g).some((e) => e.ausgang === 'abgelehnt' && /schon gelungen/.test(e.begruendung)), 'Regie-Logbuch nennt den Grund (schon gelungen)');
    ok(JSON.stringify(g.mission.missions[BUCH]) === stand0 && g.mission.activeId === null && T.mev.filter((e) => e.kind === 'missionStart').length === starts, 'das Buch wurde nicht neu gestartet, der Missionsstand blieb');
    ok(!funk.slice(hinten).some((r) => /Hier Forschungsstation Helix/.test(r.text)), 'keine Ansage der Station');
  });

  // ---------------- E: Voraussetzungen
  await abschnitt('E  Voraussetzungen: gescheitert mit Logbuch, Buch nie gestartet', 'E', async () => {
    const pruefe = (name, vorbereiten, muster, aufraeumen, sektor) => {
      const { g, cs } = neuesSpiel(1, 24);
      const funk = funkMit(g);
      hilfe(g, cs);
      const f = faden(g, sektor);
      for (let i = 0; i < 12; i++) g.lageGrenze('andocken');
      vorbereiten(g);
      const starts = [];
      const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { starts.push(k); return me0(k, d); };
      const aktivVorher = g.mission.activeId;
      starte(g, f);
      const s = stand(g, f);
      const l = logbuch(g).filter((e) => e.ausgang === 'abgelehnt');
      ok(s.beat === 1 && s.phase === 'wartet' && s.ereignis === 'sondersektor_gescheitert', name + ': Beat gescheitert');
      ok(l.length === 1 && muster.test(l[0].begruendung), name + ': Logbuch nennt den Grund (' + (l[0] && l[0].begruendung.slice(0, 90)) + ')');
      ok(!g.mission.missions[BUCH] && g.mission.activeId === aktivVorher && !funk.some((r) => /Forschungsstation Helix/.test(r.text)), name + ': Buch nicht gestartet, keine Ansage');
      if (aufraeumen) aufraeumen(g);
    };
    // zu weit: ein Ort der Karte, von dem aus Pulverhorn mehr als 3 Spruenge entfernt ist
    const weit = (() => { const t = neuesSpiel(1, 24).g; for (const h of Object.keys(t.weltsim.zustand.hexe)) { const o = Sektoren.ortVonHex(h); if (o && Sektoren.spielbar(h) && !B1.erreichbar(t, h, 3).has('0605') && B1.erreichbar(t, h, 20).has('0605')) return o; } return null; })();
    ok(!!weit, 'ein Ort mit mehr als 3 Spruengen bis Pulverhorn existiert (' + weit + ')');
    pruefe('Pulverhorn zu weit', (g) => { g.debugGoto(weit, false); }, /nicht in hoechstens 3 Spruengen/);
    pruefe('Sim-Szene laeuft', (g) => { g.simSzene = { phase: 'kampf' }; }, /Szene oder Gefahr/, (g) => { g.simSzene = null; });
    pruefe('Faden-Szene laeuft', (g) => { g.fadenSzene = { phase: 'kampf' }; }, /Szene oder Gefahr/, (g) => { g.fadenSzene = null; });
    pruefe('andere Mission laeuft', (g) => { g.mission.activeId = 'fremd'; }, /andere Mission/, (g) => { g.mission.activeId = null; });
    pruefe('unbekannter Sektor', () => {}, /unbekannter Sektor/, null, 'gibtesnicht');
    // eine laufende Gefahr der Reise zaehlt ebenfalls
    const { g } = neuesSpiel(1, 25);
    const Reise = require('../server/sim/reise-ereignis.js');
    const orig = Reise.gefahrLaeuft;
    Reise.gefahrLaeuft = () => true;
    try { ok(/Szene oder Gefahr/.test(SB.voraussetzungen(g, Sond.sektor('helix')) || ''), 'laufende Gefahr der Reise: Voraussetzung verweigert'); } finally { Reise.gefahrLaeuft = orig; }
    ok(SB.voraussetzungen(g, Sond.sektor('helix')) === null, 'Gegenprobe: ohne Hindernis sind alle Voraussetzungen erfuellt');
  });

  // ---------------- F: Speichern und Laden mitten im Beat
  await abschnitt('F  Speichern angedockt, Laden mitten im Beat', 'F', async () => {
    const dir = require('./regie-fixture.js').freshDir();
    const { g, cs } = neuesSpiel(1, 26, { dir });
    const T = hilfe(g, cs);
    const f = faden(g);
    for (let i = 0; i < 12; i++) g.lageGrenze('andocken');
    starte(g, f);
    await T.run(5);
    ok(g.mission.step && g.mission.step.id === 'anflug_helix' && g.ship.docked, 'Buch laeuft (Schritt anflug_helix), die Crew liegt im Hafen');
    const kante = Sektoren.kanteId('0605', '0506');
    const vor = { n: stand(g, f).n, kante: !!g.explore.tempKante(kante) };
    const r = g.saveWorld('test', { sync: true });
    ok(r && r.ok !== false && !r.error, 'angedockt speichern geht (' + JSON.stringify(r && { ok: r.ok, error: r.error }) + ')');
    const id = g.weltstand && g.weltstand.id;
    const { g: g2, cs: cs2 } = neuesSpiel(1, 27, { dir, world: id });
    const funk2 = funkMit(g2);
    const T2 = hilfe(g2, cs2);
    const s = liste(g2).find((x) => x.id === f.id);
    ok(!!s && s.phase === 'laeuft' && s.laufend && s.laufend.beat === BEAT && s.beat === 0, 'nach dem Laden: der Faden steht im Beat ' + BEAT + ' (laeuft)');
    ok(g2.mission.activeId === BUCH && g2.mission.step && g2.mission.step.id === 'anflug_helix', 'Mission und Schritt bleiben (' + g2.mission.activeId + ' / ' + (g2.mission.step && g2.mission.step.id) + ')');
    ok(vor.kante && !!g2.explore.tempKante(kante), 'die temporaere Kante bleibt');
    ok(s.laufend.n === vor.n, 'der Frist-Zaehler des Beats bleibt (' + s.laufend.n + ')');
    await buchSpielen(T2, 'geladen');
    await T2.run(1);
    const e = liste(g2).find((x) => x.id === f.id);
    ok(e.beat === 1 && e.phase === 'wartet' && e.nsc.gedaechtnis[e.nsc.gedaechtnis.length - 1].ereignis === 'sondersektor_gelungen', 'der Beat meldet nach dem Laden am Ende gelungen');
    ok(Zahl(g2) === 0, 'kein Serverfehler');
  });

  // ---------------- G: Frist
  await abschnitt('G  Frist: Ablauf raeumt das Buch ab', 'G', async () => {
    const { g, cs } = neuesSpiel(1, 28);
    const funk = funkMit(g);
    const T = hilfe(g, cs);
    const f = faden(g);
    for (let i = 0; i < 12; i++) g.lageGrenze('andocken');
    starte(g, f);
    await T.run(5);
    const frist = D.BEATS.sondersektor.frist;
    ok(Faden.fristVon(liste(g)[liste(g).length - 1]) === frist, 'die Frist des Beats ist der Katalogwert (' + frist + ')');
    for (let i = 0; i < frist - 1; i++) g.lageGrenze('andocken');
    ok(stand(g, f).phase === 'laeuft' && g.mission.activeId === BUCH, 'kurz vor der Frist (' + (frist - 1) + ' Taetigkeiten) laeuft Beat und Buch weiter');
    g.lageGrenze('andocken');
    ok(stand(g, f).ereignis === 'sondersektor_gescheitert', 'die Frist laeuft ab: Beat gescheitert');
    await T.run(2);
    ok(g.mission.activeId === null && !g.mission.missions[BUCH] && !g.mission.step, 'der Takt hat das verwaiste Buch abgeraeumt (keine aktive Mission, kein Missionsstand)');
    ok(funk.some((r) => /Messreihe ist verloren/.test(r.text)) && logbuch(g).some((e) => e.ausgang === 'abgeraeumt'), 'die Station meldet den Verlust, Regie-Logbuch: abgeraeumt');
    await T.run(30);
    ok(g.mission.activeId === null && !g.mission.missions[BUCH] && Zahl(g) === 0, '30 s spaeter noch alles ruhig (kein Zombie-Buch, kein Serverfehler)');
    ok(!!g.explore.tempKante(Sektoren.kanteId('0605', '0506')), 'der Sprungpunkt bleibt offen (wie nach dem Buch)');
    Faden.weiterSetzen(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_abschluss' });
    const f2 = faden(g);
    ok(SB.voraussetzungen(g, Sond.sektor('helix')) === null, 'nach dem Fristablauf ist ein neuer Start moeglich');
    starte(g, f2);
    ok(stand(g, f2).phase === 'laeuft' && g.mission.activeId === BUCH, 'der neue Faden startet das Buch erneut');
  });

  // ---------------- H: Zielwahl unberuehrt
  await abschnitt('H  Zielwahl unberuehrt', 'H', async () => {
    const { g } = neuesSpiel(1, 29);
    const d = Dat.datenVon(g.weltsim.zustand);
    const haefen = Object.keys(g.weltsim.zustand.hexe).filter((h) => d.hex[h] && d.hex[h].hafen).sort();
    ok(haefen.length >= 3, 'Haefen der Karte: ' + haefen.join(','));
    // auch mit offenem Sprungpunkt nach Helix
    g.mission.startMission(BUCH);
    for (let i = 0; i < 400; i++) g.step();
    ok(!!g.explore.tempKante(Sektoren.kanteId('0605', '0506')), 'der Sprungpunkt nach Helix ist offen');
    let wuerfe = 0, helix = 0, ziele = 0;
    for (const h of haefen) {
      if (Ziel.kandidaten(g, h).includes('0506')) helix++;
      for (let i = 0; i < 100; i++) { g.weltsim.faeden.angNr = i; const z = Ziel.zielImUmkreis(g, h, { belegt: [] }); wuerfe++; if (z === '0506') helix++; if (z) ziele++; }
    }
    ok(wuerfe === haefen.length * 100 && ziele > 0 && helix === 0, wuerfe + ' Zielwuerfe (' + ziele + ' mit Ziel): Helix nie Ziel, nie Kandidat');
    ok(!B1.erreichbar(g, '0605', 3).has('0506'), 'erreichbar() kennt die temporaere Kante weiterhin nicht (unveraendert)');
  });

  console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));

  process.exit(fails ? 1 : 0);
})();
