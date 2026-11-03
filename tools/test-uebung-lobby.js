'use strict';
// UEB-01 C1: Lobby-Modus arena_forschung (Direktstart Forschungsstation) über den ECHTEN Lobby-Weg, mit zwei Spielern:
//   lobbyOpt startMission 'arena_forschung' -> ready aller Spieler -> game.js wählt Karte Sund selbst (kein Welt.waehle von Hand).
//
// Wer tut was (Abschnitt "Durchlauf"):
//   Spieler 0 (Ops, Konsole weapons): Zonen-Scan (Gravimetrie), Landepunkt-Scan; am Boden hackt er die vier Pulte nacheinander.
//   Spieler 1 (Navigation, Konsole helm): fliegt die Lerche nach Ansage durch die Gravimetrie (T.fliege) und durch den langen Kanal
//     des Finales; am Boden läuft er je Pult zu einem fernen Punkt, schießt dort (Lärm seiner Waffe, Lärmquelle dort gesetzt) und kehrt zurück.
//   Beide: gehen beim Landepunkt hinunter (Außenteam) und wieder hoch. Beide schießen am Boden (Waffenprobe).
//
// Abschnitte und Abnahmekriterien:
//   Start             Menümodus: phase play, Karte sund, Schritt gravimetrie am Helix, 2 Spieler an Bord, Marken wie im Kapitel-7-Einstieg (nicht werft.testmarken), Werft nicht aktiv, keine Anflug-Ansage, keine Kette
//   Durchlauf         bis zum Szenenende (done/erfolg, Meldung genau einmal); Waffe jedes Außenteam-Spielers nutzbar (Standardwaffe)
//   Weltstand         g.weltstand nicht persistent, worldDir unverändert (Tempverzeichnis), kein Lock, keine neue Datei im Weltstand-Verzeichnis
//   Verlust           alle Außenteam-Spieler verwundet -> done/verloren -> Engine holt hoch -> Szene von vorn im Schritt gravimetrie
//   Fallback 30 s     Spieler bleiben künstlich zone away/downed: Neustart kommt erst nach NEUSTART_MAX_WARTEN (30 s) und holt sie an Bord
//   Kapitel 7         Vergleich mit dem Referenzweg schuld_der_lerche -> kette.einstieg('k7_geld') -> kette.szeneStarten('sl_forschung')
//                     (dort mit debugGoto('helix') + forceStep('gravimetrie')). Verglichene Größen: aktives Buch, Schritt, Kante Pulverhorn->Helix
//                     (Kante nur bewusst abweichend, s. u.), Marken, Werft-Status, Zahl der Spieler an Bord, Schiffsszene und Abstand zum Gravimetrie-Start, Szene-Zonen (ZonenSim.szeneZonen,
//                     Id-Liste), Zonen/Landepunkt unbekannt. EHRLICH: Das Buch liest keine Kette-Flags (Erkundung: keine Voraussetzungen). Der
//                     Vergleich beweist den gleichen Szenenverlauf, NICHT gleiche Flags.
//   g.errors          in allen Läufen 0.
// Nur temporäre Verzeichnisse: worldDir zeigt auf ein Tempverzeichnis (Weltstände sind dort AN, damit ein Fehlschreiben auffiele).
//   node tools/test-uebung-lobby.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Zonen = require('../shared/zonen.js');
const Mon = require('../shared/monster.js');
const Locations = require('../shared/locations.js');
const Sektoren = require('../shared/sektoren.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const Welt = require('../server/sim/welt.js');
const Weltstand = require('../server/weltstand.js');
const away = require('../server/sim/away.js');
const Anker = require('../server/sim/anker.js');
const Monster = require('../server/sim/monster.js');
const ZonenSim = require('../server/sim/zonen.js');
const Lpscan = require('../server/sim/lpscan.js');
const Wf = require('../server/sim/waffen.js');
const Kampagne = require('../server/mission/kampagne.js');
const Werft = require('../server/sim/werft.js');
const ANFLUG_ANSAGE = (t) => /Forschungsstation Helix hinter Pulverhorn/.test(t);
const k7Marken = () => Kampagne.laden('schuld-der-lerche').kapitel.find((c) => c.id === 'k7_geld').einstieg.marken;

const DT = 1 / CONFIG.tickHz;
const MODUS = 'arena_forschung';
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-ueb-lobby-'));
const dateien = (d) => { try { return fs.readdirSync(d).sort(); } catch (e) { return null; } };
const echtesDir = Weltstand.dir(process.env);   // nur lesen: darf sich durch den Test nicht ändern
const echtVorher = JSON.stringify(dateien(echtesDir));

// Partie über den Lobby-Weg: modus = Lobby-Modus, np Spieler, alle ready. Kein Welt.waehle, kein startMission 'free'.
function lobbySpiel(modus, np, name) {
  const wd = path.join(TMP, name); fs.mkdirSync(wd, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldDir: wd, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'L' + name + i, name: 'Lo' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: modus });
    cs.push(c);
  }
  const odas = []; const o0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(String(t)); return o0(t, x); };   // Mitschnitt VOR dem Start: auch die Meldungen von Start und Neustart gehören dazu
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  const T = { g, cs, run, odas, wd };
  T.cmd = (i, cmd, f) => { cs[i].inbox.length = 0; g.handleMessage(cs[i], Object.assign({ t: 'cmd', c: cmd }, f || {})); return cs[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.rolle = (i, r) => { g.players[i].console = r; };
  T.energie = (o) => { Object.assign(g.ship.powerIntent || (g.ship.powerIntent = {}), o); Object.assign(g.ship.power, o); };
  // Navigation nach Ansage (Drift 120 px voraus ausgleichen, Querfehler regeln); die Navigatorin ist Spieler idx
  T.fliege = (idx, ziele, grenzeS, abbruch) => {
    T.rolle(idx, 'helm');
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
const gvOrt = () => Locations.get('helix').scene.gravimetrie;
const lbl = (g) => (g.mission.step && g.mission.step.id);
const kanteOffen = (g) => !!g.explore.tempKante(Sektoren.kanteId('0605', '0506'));
const an = (g, p) => p.zone === 'ship';

// Zustand, der nach Direktstart und Kapitel-7-Einstieg gleich sein muss
function vergleichsgroessen(g) {
  const gv = gvOrt();
  return {
    buch: g.mission.activeId, schritt: lbl(g),
    szene: g.ship.scene, anBord: g.players.filter((p) => an(g, p)).length,
    abstandStart: Math.hypot(g.ship.x - gv.start.x, g.ship.y - gv.start.y),
    zonen: ZonenSim.szeneZonen(g).map((z) => z.id).sort().join(','),
    gravi: ZonenSim.istBekannt(g, 'gravi_feld0'), lp: Lpscan.gescannt(g, 'helix.station'),
  };
}

section('Start (Menümodus, 2 Spieler)', () => {
  ok(Protocol.LOBBY_MODI.includes(MODUS) && !Protocol.CAMPAIGN_STARTS.includes(MODUS), 'Modus ist Lobbymodus, keine Kampagne');
  const T = lobbySpiel(MODUS, 2, 'start'); const g = T.g;
  ok(g.lobbyOpts.startMission === MODUS, 'lobbyOpt angenommen');
  ok(g.phase === 'play', 'Phase play');
  ok(g.weltId === 'sund' && Welt.kartenId() === 'sund', 'Karte sund (von game.js gewählt)');
  ok(g.mission.activeId === 'sl_forschung' && lbl(g) === 'gravimetrie', 'Buch sl_forschung im Schritt gravimetrie (' + g.mission.activeId + '/' + lbl(g) + ')');
  ok(g.ship.scene === 'helix', 'Schiff am Helix (' + g.ship.scene + ')');
  const gv = gvOrt();
  ok(Math.abs(g.ship.x - gv.start.x) < 40 && Math.abs(g.ship.y - gv.start.y) < 40, 'Schiff am Start der Gravimetrie');
  ok(g.players.length === 2 && g.players.every((p) => an(g, p)), 'beide Spieler an Bord');
  const k7 = k7Marken();   // eine Quelle: Kapitel-7-Einstieg
  ok(Number.isFinite(k7) && g.inventory.marks === k7 && k7 !== g.C.werft.testmarken, 'Marken = Einstieg k7_geld (' + g.inventory.marks + '), nicht Testmarken ' + g.C.werft.testmarken);
  ok(Werft.status(g).aktiv === false && !Werft.status(g).test, 'Werft nicht aktiv (keine Testumgebung): ' + Werft.status(g).grund);
  ok(!T.odas.some(ANFLUG_ANSAGE), 'Start: keine Anflug-Ansage "Ziel: Forschungsstation Helix hinter Pulverhorn" (' + T.odas.length + ' ODA-Meldungen seit dem Start mitgeschnitten)');
  ok(T.odas.some((t) => /Übung Forschungsstation: Gravimetrie/.test(t)), 'Mitschnitt reicht bis zur Startmeldung zurück (sonst wäre die Prüfung wertlos)');
  ok(!kanteOffen(g), 'Kante Pulverhorn -> Helix NICHT geöffnet (die Gravimetrie braucht sie nicht)');
  ok(!g.mission.kette, 'keine Kampagnenkette (mission.kette ' + g.mission.kette + ')');
  ok(g.errors === 0, 'g.errors 0 (' + g.errors + ')');
  Welt.waehle(g, 'limes');
});

let weltstandSicht = null;
section('Durchlauf bis zum Szenenende (2 Spieler)', () => {
  const T = lobbySpiel(MODUS, 2, 'lauf'); const g = T.g; const m = g.mission; g.god = true;
  const vorherDateien = JSON.stringify(dateien(T.wd)); const dir0 = g.worldDir;
  weltstandSicht = { T, vorherDateien, dir0 };
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  try {
    const gv = gvOrt();
    ok(m.activeId === 'sl_forschung' && lbl(g) === 'gravimetrie', 'Start im Schritt gravimetrie');
    T.energie({ engines: 3, shields: 2, weapons: 1 });
    // Ops (Spieler 0) scannt
    T.rolle(0, 'weapons'); T.run(0.2);
    ok(T.cmd(0, 'weapons.zonenscan').length === 0, 'Ops (Spieler 0) startet den Zonen-Scan');
    T.run(3.5);
    ok(ZonenSim.istBekannt(g, 'gravi_feld0'), 'Scan fertig: gravi_feld0 bekannt');
    // Navigation (Spieler 1) fliegt nach Ansage
    T.fliege(1, gv.weg.slice(1), 90, () => lbl(g) === 'station');
    T.run(1);
    ok(lbl(g) === 'station' && !mev.some((e) => e.kind === 'zoneRuecksetzen'), 'Station erreicht ohne Rücksetzer, Schritt station (x ' + Math.round(g.ship.x) + ')');
    g.ship.helm.stage = 1; g.ship.helm.turn = 0; g.ship.vx = 0; g.ship.vy = 0;
    // Landepunkt-Scan der Ops
    T.rolle(0, 'weapons'); T.run(0.3);
    ok(Lpscan.ziele(g).some((q) => q.id === 'helix.station'), 'Landepunkt helix.station in Scanreichweite');
    ok(T.cmd(0, 'weapons.landescan').length === 0, 'Ops startet den Landepunkt-Scan');
    T.run(4.5);
    ok(Lpscan.gescannt(g, 'helix.station'), 'Landepunkt gescannt');
    // beide hinunter
    T.rolle(0, null); T.rolle(1, null);
    const err = g.chooseLandepunkt(g.players[0], 'helix.station');
    away.executeBeam(g, g.players.map((q) => q.id), 'down');
    T.run(1);
    const aw = g.away;
    ok(!err && aw.map === 'helix.station' && aw.monster && aw.monsterPulte, 'Team auf der Station, Monster und Pulte eingerichtet');
    ok(g.players.every((p) => p.zone === 'away'), 'BEIDE Spieler am Boden');
    // Waffe (Punkt 6): jeder hat die Standardwaffe und kann damit schießen
    T.run(0.3);
    for (const p of g.players) {
      const vor = (g.away.projectiles || []).length;
      g.handleMessage(T.cs[p.id === g.players[0].id ? 0 : 1], { t: 'shoot', angle: 0 });
      ok(p.waffe === 'blaster' && Wf.def(g, p.waffe), 'Spieler ' + p.id + ' hat Standardwaffe ' + p.waffe);
      ok((g.away.projectiles || []).length > vor || p.schussAt != null || p.schussInputAt != null, 'Spieler ' + p.id + ' schießt (Projektile ' + vor + ' -> ' + (g.away.projectiles || []).length + ')');
      T.run(1.2);
    }
    // vier Pulte: Spieler 0 hackt, Spieler 1 lenkt ab (Schuss am fernen Punkt, Lärmquelle dort, danach zurück zum Pult)
    const k = g.karteOf(aw.map); const mk = Monster.maskeVon(k); const P = aw.monsterPulte; const M = aw.monster;
    const zustaende = new Set();
    const hacken = (id) => {
      const pos = P.pos[id]; const pa = Mon.naechster(mk, pos[0], pos[1], 2); const pc = Mon.mitte(pa);
      const p0 = g.players[0], p1 = g.players[1];
      p0.x = pc.x; p0.y = pc.y;
      Anker.setzen(g, aw.map, id, 'laedt', p0.id);
      const dp = Mon.bfs(mk, [pa]); let fern = null, fd = -1;
      for (let cy = 1; cy < mk.h; cy++) for (let cx = 1; cx < mk.w; cx++) { const d = dp[cy * mk.w + cx]; const q = Mon.mitte({ cx, cy });
        if (d > fd && Math.hypot(q.x - M.x, q.y - M.y) > 500) { fd = d; fern = { cx, cy }; } }   // fern vom Pult UND vom Monster (sonst läuft Spieler 1 hinein)
      const fp = Mon.mitte(fern);
      // Spieler 1 geht zum fernen Punkt, schießt dort (echter Lärm seiner Waffe) und kehrt zum Pult zurück, bevor das Monster ihn erreicht
      p1.x = fp.x; p1.y = fp.y;
      g.handleMessage(T.cs[1], { t: 'shoot', angle: 1 });
      T.run(0.3);
      p1.x = pc.x; p1.y = pc.y;
      T.run(5.9, () => {
        M.laerm = { x: fp.x, y: fp.y, t: g.time, w: 900, art: 'fertig' };   // Lärmquelle am Ort seines Schusses
        if (M.z === 'jagd') { M.z = 'laerm'; M.verlust = 0; }
        zustaende.add(M.z);
        return false;
      });
      Anker.completeHold(g, p0, { kind: 'anker:terminal', anker: id, op: 'download', tx: pos[0], ty: pos[1] });
      T.run(0.5);
    };
    const reihenfolge = [];
    for (let i = 0; i < 4; i++) {
      const id = P.order[i];
      reihenfolge.push(P.order.slice(i + 1).every((q) => Anker.zustand(g, aw.map, q) === 'gesperrt'));
      hacken(id);
      if (g.players[0].downed) break;
    }
    ok(reihenfolge.every(Boolean), 'Reihenfolge: je Hack waren die späteren Pulte gesperrt');
    ok(P.erledigt === 4 && P.fertig, 'vier Pulte gehackt (' + P.erledigt + '/4)');
    ok(zustaende.has('laerm'), 'Monster reagiert auf die Ablenkung (Zustände ' + [...zustaende].join(',') + ')');
    T.run(1.5);
    const sv = (g.snapshot().zonen || {}).sv || [];
    ok(lbl(g) === 'rueckbeamen' && ZonenSim.szeneZonen(g).some((z) => z.id === 'halt_feld') && sv.includes('halt_feld') && sv.includes('halt_kanal_lang'), 'Daten da: Haltefeld an, Feldkarte sichtbar, Schritt rueckbeamen (' + lbl(g) + ')');
    // Team hoch
    away.executeBeam(g, g.players.map((q) => q.id), 'up'); g.players.forEach((q) => { q.zone = 'ship'; });
    T.run(2);
    ok(lbl(g) === 'finale', 'Team an Bord: Schritt finale (' + lbl(g) + ')');
    // Finale: aus der Mitte durch den langen Kanal, Spieler 1 fliegt
    g.ship.x = gv.station.x; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0;
    T.energie({ engines: 4, shields: 1, weapons: 1 });
    T.fliege(1, gv.fluchtweg, 60, () => lbl(g) === 'abliefern_anflug' || (m.missions.sl_forschung && m.missions.sl_forschung.state === 'done'));
    T.run(2);
    const ms = m.missions.sl_forschung;
    ok(ms && ms.state === 'done' && ms.ausgang === 'erfolg', 'Szenenende: Mission done/erfolg (' + JSON.stringify(ms) + ')');
    ok(T.odas.filter((t) => /Szene durch/.test(t)).length === 1, 'Meldung "Szene durch" genau einmal');
    T.run(5);
    ok(T.odas.filter((t) => /Szene durch/.test(t)).length === 1, '... auch nach weiteren Ticks');
    ok(g.arena && g.arena.forschung.versuch === 1, 'kein Neustart nach dem Ende');
    ok(g.errors === 0, 'g.errors 0 (' + g.errors + ' ' + JSON.stringify(g.errorLog || {}) + ')');
  } finally { /* Karte bleibt bis zum Abschnitt Weltstand */ }
});

section('Weltstand-Neutralität', () => {
  ok(!!weltstandSicht, 'Lauf des Durchlaufs vorhanden');
  if (!weltstandSicht) return;
  const { T, vorherDateien, dir0 } = weltstandSicht; const g = T.g;
  ok(g.worldsEnabled === true, 'Weltstände im Testlauf AN (ein Fehlschreiben würde auffallen)');
  ok(g.weltstand && g.weltstand.persistent === false, 'Weltstand nicht persistent');
  ok(g.worldDir === dir0 && g.worldDir === T.wd, 'worldDir unverändert (Tempverzeichnis)');
  ok(g.worldLock == null, 'kein Weltstand-Lock');
  const nachher = JSON.stringify(dateien(T.wd));
  ok(nachher === vorherDateien, 'Weltstand-Verzeichnis unverändert (vorher ' + vorherDateien + ', nachher ' + nachher + ')');
  ok(g.saveWorld('test').skipped === true, 'saveWorld überspringt (nichts geschrieben)');
  ok(JSON.stringify(dateien(T.wd)) === vorherDateien, '... auch nach saveWorld');
  ok(JSON.stringify(dateien(echtesDir)) === echtVorher, 'echtes Weltstand-Verzeichnis unverändert');
  Welt.waehle(g, 'limes');
});

// beide Spieler zum Landepunkt hinunter, Monster neben das Team, bis alle am Boden sind (echte Wunden, kein god)
function zumBodenUndVerloren(T) {
  const g = T.g; const m = g.mission; g.god = false;
  const gv = gvOrt();
  T.run(1);
  g.ship.x = gv.station.x - 100; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0;
  m.forceStep('sl_forschung', 'station'); T.run(1);
  Lpscan.markieren(g, 'helix.station');
  const err = g.chooseLandepunkt(g.players[0], 'helix.station');
  away.executeBeam(g, g.players.map((q) => q.id), 'down'); T.run(1);
  return err;
}

section('Verlustpfad über den Lobby-Weg', () => {
  const T = lobbySpiel(MODUS, 2, 'verlust'); const g = T.g; const m = g.mission; const gv = gvOrt();
  try {
    ok(!zumBodenUndVerloren(T) && g.away.monster && g.away.monsterPulte && g.players.every((p) => p.zone === 'away'), 'Team auf der Station, Monster und Pulte da');
    const P = g.away.monsterPulte; P.erledigt = 2;
    Anker.setzen(g, g.away.map, Object.keys(P.pos)[0], 'laedt', g.players[0].id);
    // Monster neben beide Spieler (beide an derselben Stelle), Beschuss wirkungslos
    const k = g.karteOf(g.away.map); const mk = Monster.maskeVon(k); const p0 = g.players[0], p1 = g.players[1];
    const a = Mon.naechster(mk, Math.floor(p0.x / 32), Math.floor(p0.y / 32), 2); const pc = Mon.mitte(a);
    p0.x = pc.x; p0.y = pc.y; p1.x = pc.x; p1.y = pc.y;
    const dn = Mon.bfs(mk, [a]); let mp = null;
    for (let cy = 1; cy < mk.h && !mp; cy++) for (let cx = 1; cx < mk.w; cx++) if (dn[cy * mk.w + cx] === 3) { mp = { cx, cy }; break; }
    const M = g.away.monster; const mpos = Mon.mitte(mp); M.x = mpos.x; M.y = mpos.y; M.pfad = []; M.pause = 0;
    let beide = false;
    const verloren = T.run(25, () => { const ms = m.missions.sl_forschung; if (ms && ms.state === 'done') { beide = g.players.every((p) => p.downed && p.zone === 'away'); return true; } return false; });
    const ms = m.missions.sl_forschung;
    ok(verloren && ms.ausgang === 'verloren' && beide, 'alle am Boden (verwundet): Mission done/verloren (' + (ms && ms.ausgang) + ', beide liegen verwundet am Boden: ' + beide + ')');
    const neu = T.run(40, () => g.arena.forschung.versuch === 2);
    ok(neu, 'Neustart nach dem Hochholen durch die Engine (Versuch ' + g.arena.forschung.versuch + ')');
    ok(!T.odas.some(ANFLUG_ANSAGE), 'Start und Neustart: keine Anflug-Ansage "Ziel: Forschungsstation Helix hinter Pulverhorn"');
    ok(T.odas.some((t) => /Szene von vorn/.test(t)), 'Mitschnitt enthält die Neustart-Meldung');
    ok(g.inventory.marks === k7Marken() && !Werft.status(g).aktiv, 'Neustart: Marken wieder auf dem Startwert, Werft nicht aktiv');
    T.run(0.2);
    ok(m.activeId === 'sl_forschung' && lbl(g) === 'gravimetrie' && g.ship.scene === 'helix', 'Szene von vorn: Schritt gravimetrie am Helix (' + lbl(g) + ')');
    ok(g.players.every((p) => p.zone === 'ship' && !p.downed && p.hp > 0), 'Team an Bord und aufrecht');
    ok(Math.abs(g.ship.x - gv.start.x) < 40 && Math.abs(g.ship.y - gv.start.y) < 40, 'Schiff am Start der Gravimetrie');
    const M2 = g.away.monster; const P2 = g.away.monsterPulte;
    ok(!M2 || (M2.z !== 'jagd' && M2.z !== 'suche'), 'Monster zurückgesetzt (' + (M2 ? M2.z : 'neu') + ')');
    ok(!P2 || P2.erledigt === 0, 'Pulte zurückgesetzt (' + (P2 ? P2.erledigt : 'neu') + '/4)');
    ok(!Lpscan.gescannt(g, 'helix.station') && !ZonenSim.istBekannt(g, 'gravi_feld0'), 'Landepunkt ungescannt, Zonen unbekannt');
    ok(g.weltstand.persistent === false && g.worldLock == null && JSON.stringify(dateien(T.wd)) === '[]', 'weiterhin kein Weltstand');
    ok(g.errors === 0, 'g.errors 0 (' + g.errors + ' ' + JSON.stringify(g.errorLog || {}) + ')');
  } finally { Welt.waehle(g, 'limes'); }
});

section('Fallback: Neustart nach 30 s trotz Spieler am Boden', () => {
  const T = lobbySpiel(MODUS, 2, 'fallback'); const g = T.g; const m = g.mission; const gv = gvOrt();
  try {
    ok(!zumBodenUndVerloren(T) && g.players.every((p) => p.zone === 'away'), 'Team unten');
    for (const p of g.players) { p.hp = 0; p.downed = true; p.downedFor = 0; }
    // Mission -> verloren, dann die Notrückholung der Engine künstlich verhindern: jeder Tick setzt beide wieder auf zone away/downed
    const halten = () => { for (const p of g.players) { p.zone = 'away'; p.downed = true; p.hp = 0; } if (g.away) g.away.recallT = 0; };   // verhindert auch den Squad-Recall (combat.updateSquadRecall)
    let tVerlust = null; let versuchBei = null; const t0 = g.time;
    T.run(120, () => {
      const ms = m.missions.sl_forschung;
      if (ms && ms.state === 'done' && ms.ausgang === 'verloren' && tVerlust == null) tVerlust = g.time;
      if (g.arena.forschung.versuch === 2) { versuchBei = g.time; return true; }
      halten();
      return false;
    });
    ok(tVerlust != null, 'Mission done/verloren erreicht (nach ' + (tVerlust != null ? (tVerlust - t0).toFixed(1) : '-') + ' s)');
    ok(versuchBei != null, 'Neustart kam (Versuch ' + g.arena.forschung.versuch + ')');
    const wait = versuchBei != null && tVerlust != null ? versuchBei - tVerlust : -1;
    // verlustAb wird im ersten update-Tick nach dem Verlust gesetzt; Fallback also ab ca. tVerlust + 30 s
    ok(wait >= 29.5 && wait <= 33, 'Neustart nicht vor, aber kurz nach 30 s (' + wait.toFixed(1) + ' s nach dem Verlust)');
    T.run(0.3);
    ok(g.players.every((p) => p.zone === 'ship' && !p.downed && p.hp > 0), 'Neustart holt die Spieler an Bord (Zonen ' + g.players.map((p) => p.zone + (p.downed ? '/downed' : '')).join(',') + ')');
    ok(m.activeId === 'sl_forschung' && lbl(g) === 'gravimetrie' && g.ship.scene === 'helix', 'Schritt gravimetrie am Helix');
    ok(Math.abs(g.ship.x - gv.start.x) < 40 && Math.abs(g.ship.y - gv.start.y) < 40, 'Schiff am Start');
    T.run(20);
    ok(g.arena.forschung.versuch === 2 && lbl(g) === 'gravimetrie' && g.players.every((p) => p.zone === 'ship' && !p.downed), 'danach stabil, kein zweiter Neustart');
    ok(g.errors === 0, 'g.errors 0 (' + g.errors + ' ' + JSON.stringify(g.errorLog || {}) + ')');
  } finally { Welt.waehle(g, 'limes'); }
});

section('Gleicher Verlauf wie über Kapitel 7', () => {
  const D = lobbySpiel(MODUS, 2, 'direkt'); const dg = D.g;
  D.run(2);   // ein paar Ticks: Zonen.update wendet scene.zonenAus erst im ersten Tick an
  const direkt = vergleichsgroessen(dg);
  Welt.waehle(dg, 'limes');
  const K = lobbySpiel('schuld_der_lerche', 2, 'kapitel'); const g = K.g; const m = g.mission;
  try {
    ok(!!m.kette, 'Referenz: Kampagne mit Kette (schuld_der_lerche)');
    const e1 = m.kette.einstieg('k7_geld');
    ok(!e1, 'kette.einstieg(k7_geld) ohne Fehler (' + e1 + ')');
    K.run(3);
    const e2 = m.kette.szeneStarten('sl_forschung');
    ok(!e2 && m.activeId === 'sl_forschung', 'kette.szeneStarten(sl_forschung): Buch aktiv (' + e2 + '/' + m.activeId + ')');
    K.run(5);
    g.debugGoto('helix', false); K.run(2);
    const e3 = m.forceStep('sl_forschung', 'gravimetrie'); K.run(1);
    ok(!e3 && lbl(g) === 'gravimetrie', 'Kapitelseite im Schritt gravimetrie (' + e3 + '/' + lbl(g) + ')');
    const kap = vergleichsgroessen(g);
    ok(kap.buch === direkt.buch && direkt.buch === 'sl_forschung', 'aktives Buch gleich: ' + kap.buch);
    ok(kap.schritt === direkt.schritt, 'Schritt gleich: ' + kap.schritt);
    // BEWUSST ANDERS: Auf der Kapitelseite läuft der enter von "auftrag" (Anflug-Ansage, Kante Pulverhorn->Helix offen); der Direktstart überspringt
    // ihn, die Gravimetrie braucht weder Ansage noch Kante. Verglichen werden nur Größen, die beide Wege wirklich gleich herstellen.
    ok(kanteOffen(g) && !kanteOffen(dg), 'bewusst abweichend: Kante Pulverhorn->Helix nur auf der Kapitelseite offen');
    ok(!D.odas.some(ANFLUG_ANSAGE) && K.odas.some(ANFLUG_ANSAGE), 'bewusst abweichend: Anflug-Ansage nur auf der Kapitelseite');
    // Marken: nur der Direktstart wird gegen den Einstiegswert geprüft; die Kapitelseite hat danach szeneStarten/debugGoto/Ankunft durchlaufen (Erstbesuchs- und Kettenmarken), das ist kein Szenenzustand
    ok(dg.inventory.marks === k7Marken(), 'Marken des Direktstarts = Einstieg k7_geld (' + dg.inventory.marks + ')');
    ok(!Werft.status(dg).aktiv && !Werft.status(g).aktiv, 'Werft auf beiden Seiten nicht aktiv (abgedockt)');
    ok(kap.anBord === direkt.anBord && direkt.anBord === 2, 'Spieler an Bord gleich: ' + kap.anBord);
    ok(kap.szene === direkt.szene, 'Schiffsszene gleich: ' + kap.szene);
    ok(kap.zonen === direkt.zonen, 'Szene-Zonen gleich (' + kap.zonen + ' | ' + direkt.zonen + ')');
    ok(kap.gravi === direkt.gravi && kap.lp === direkt.lp, 'Zonen/Landepunkt unbekannt auf beiden Seiten');
    // Schiffsposition: am Start der Gravimetrie, Toleranz; auf der Kapitelseite bringt debugGoto das Schiff nur in die Szene
    console.log('  info Abstand zum Gravimetrie-Start: direkt ' + direkt.abstandStart.toFixed(1) + ' px, Kapitel ' + kap.abstandStart.toFixed(1) + ' px');
    ok(direkt.abstandStart < 40, 'Direktstart: Schiff am Gravimetrie-Start (' + direkt.abstandStart.toFixed(1) + ' px)');
    ok(kap.abstandStart < 40 || Math.abs(kap.abstandStart - direkt.abstandStart) < 400, 'Kapitelseite: Schiffsposition innerhalb Toleranz (' + kap.abstandStart.toFixed(1) + ' px)');
    ok(g.errors === 0 && dg.errors === 0, 'g.errors 0 auf beiden Seiten (' + g.errors + '/' + dg.errors + ')');
  } finally { Welt.waehle(g, 'limes'); }
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* Temp aufräumen ist nur Komfort */ }
console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
