'use strict';
// Bodenkampf: Wellen (server/sim/wellen.js, CONFIG.wellen): Plan eskaliert laut Tabelle, nie mehr als maxLebend stehend,
// Nachschub, Spawns außer Sicht/mit Abstand, Aufrichten/Befreien in der Pause, Ende bei Crew unten -> Lobby, Snapshot < 13 KB.
//   node tools/test-wellen.js            -> alle Abschnitte
//   node tools/test-wellen.js plan       -> nur Abschnitte, deren Name einen der Begriffe enthält
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Physics = require('../shared/physics.js');
const Los = require('../shared/los.js');
const { Game } = require('../server/game.js');
const Wellen = require('../server/sim/wellen.js');
const combat = require('../server/sim/combat.js');
const { makeRng } = require('../server/util.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const C = CONFIG.wellen;
const TILE = Physics.TILE;
const SNAP_MAX = CONFIG.net.snapMax;   // W1 AP1: zentrale Snapshot-Grenze
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}

// Spiel mit np Spielern, Lobby-Start Bodenkampf: Wellen auf karte
function wellenSpiel(np, karte, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 13, debug: o.debug !== false, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'W' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_away', wellen: karte, ...(o.arena ? { arena: o.arena } : {}) });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const events = (kind) => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === kind);
  return { g, cs, events, S: () => g.arena && g.arena.wellen };
}
const welle = (g) => (g.away.drones || []).filter((e) => e.tag === Wellen.TAG);
const stehend = (g) => welle(g).filter((e) => e.alive);
// Crew unverwundbar halten (Messläufe): wer liegt, steht still wieder auf
const heile = (g) => { for (const p of g.players) if (p.downed) combat.revive(g, p, null, { quiet: true }); };
function niederschlagen(g, p, zustand) {
  combat.kaempfer(g, p); p.zustand = zustand || 'verwundet';
  if (p.zustand === 'bewusstlos') p.bewusstBis = g.time + CONFIG.awayCombat.koerper.bewusstlos;   // wie waffen.treffer (Betäuber)
  combat.folgenAbgleich(g);
}
function erledigen(g, e, pid) {
  for (let i = 0; i < 10 && e.alive; i++) combat.hitEnemy(g, e, 1, { pid, wirkung: { schaden: 9, wunde: true } });
}

// ---------------------------------------------------------------------------------------------------------------------
section('plan: Eskalation laut Tabelle (Zahl, Rollen, Waffen, Rang, Trupps)', () => {
  let neuJe = true, rollenOk = true, waffenOk = true, anzahlOk = true, einfuehrung = true, soloOk = true, rangOk = true;
  const ab = (tab, k) => Number(tab[k]);
  for (let w = 1; w <= 20; w++) {
    for (const sp of [1, 3]) {
      const P = Wellen.plan(C, w, sp, makeRng(w * 31 + sp));
      const soll = Math.min(C.anzahl.max, Math.round(C.anzahl.basis + C.anzahl.jeWelle * w + C.anzahl.jeSpielerWelle * (sp - 1) * w));
      if (P.gesamt !== soll || P.liste.length !== soll) anzahlOk = false;
      if (Object.keys(P.neu).length > 1) neuJe = false;
      for (const e of P.liste) {
        if (!(ab(C.rollenAb, e.rolle) <= w)) rollenOk = false;
        if (e.waffe && !(ab(C.waffenAb, e.waffe) <= w)) waffenOk = false;
        if (e.rolle !== 'grundtyp' && e.waffe) waffenOk = false;
        if (sp === 1 && e.rolle === 'haescher') soloOk = false;
      }
      if (P.neu.rolle && P.liste.filter((e) => e.rolle === P.neu.rolle).length !== 1) einfuehrung = false;
      if (P.neu.waffe && P.liste.filter((e) => e.waffe === P.neu.waffe).length !== 1) einfuehrung = false;
      const h = P.liste.filter((e) => e.rang).length;
      if ((w < C.rang.ab && h) || (w >= C.rang.ab && h !== Math.min(Wellen.haeuptlinge(C, w), P.liste.length))) rangOk = false;
    }
  }
  ok(anzahlOk, `Gesamtzahl = basis + jeWelle·n + jeSpielerWelle·(Spieler−1)·n (W1 solo ${Wellen.anzahl(C, 1, 1)}, W10 zu dritt ${Wellen.anzahl(C, 10, 3)})`);
  ok(rollenOk && waffenOk, 'nur freigeschaltete Rollen/Karl-Waffen, andere Rollen tragen ihre eigene Waffe');
  ok(neuJe && einfuehrung, 'höchstens eine Neuheit je Welle, neue Rolle/Waffe genau einmal in ihrer Einführungswelle');
  ok(soloOk, 'solo kein Wergeld-Fänger (Besetzungsregel)');
  ok(rangOk, `Häuptlinge ab Welle ${C.rang.ab}, +1 je ${C.rang.alleWellen} Wellen`);
  const reihe = Object.keys(C.rollenAb).sort((a, b) => C.rollenAb[a] - C.rollenAb[b]);
  ok(reihe.join(',') === 'grundtyp,schuetze,niederhalter,grenadier,enterer,haescher', 'Rollen-Reihenfolge Karl → Jäger → Bolzer → Donnerwerfer → Berserker → Wergeld-Fänger');
  const wr = Object.keys(C.waffenAb).sort((a, b) => C.waffenAb[a] - C.waffenAb[b]);
  ok(wr.join(',') === 'schrottblaster,blaster,sturmgewehr,granatwerfer,lanze', 'Waffen-Reihenfolge Schrottblaster → Blaster → Sturmgewehr → Granatwerfer → Lanze');
  const W1 = Wellen.plan(C, 1, 1, makeRng(1));
  ok(W1.liste.every((e) => e.rolle === 'grundtyp' && e.waffe === 'schrottblaster'), 'Welle 1: nur Karl mit Schrottblaster');
  const g0 = Wellen.plan(C, C.gemischtAb - 1, 3, makeRng(5)), g1 = Wellen.plan(C, C.gemischtAb, 3, makeRng(5));
  const wechsel = (P) => P.liste.reduce((a, e, i) => a + (i && e.rolle !== P.liste[i - 1].rolle ? 1 : 0), 0);
  ok(!g0.gemischt && g1.gemischt && g1.neu.gemischt && wechsel(g1) > wechsel(g0), `gemischte Trupps ab Welle ${C.gemischtAb} (Rollenwechsel ${wechsel(g0)} -> ${wechsel(g1)})`);
  // tune wirkt (Tabelle ist live)
  const alt = C.rollenAb.schuetze;
  const g = new Game({ noStore: true, seed: 1, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const r = combat.tune(g, 'wellen.rollenAb.schuetze', 5);
  ok(r.ok && C.rollenAb.schuetze === 5 && !Wellen.plan(C, 3, 1, makeRng(2)).liste.some((e) => e.rolle === 'schuetze'), 'tune wellen.rollenAb.schuetze 5 wirkt');
  C.rollenAb.schuetze = alt;
});

// ---------------------------------------------------------------------------------------------------------------------
section('lobby: Kartenwahl, Altweg ohne Wahl, neuer Seed je Start', () => {
  ok(Protocol.START_LABELS.arena_away === 'Bodenkampf: Wellen' && Protocol.WELLEN_KARTEN.join(',') === 'aussenposten,station,ruine,schiff,kesh', 'Label und Kartenliste im Protokoll');
  const t = wellenSpiel(2, 'station');
  ok(t.g.phase === 'play' && t.S() && t.S().karte === 'station' && t.g.away.map === t.S().lp && /station/.test(t.S().lp), `Start auf gebauter Station (${t.S() && t.S().lp})`);
  ok(t.g.players.every((p) => p.zone === 'away'), 'Team unten');
  const info = require('../server/sim/interior.js').awayInfoOf(t.S().lp);
  ok(info.karte.zustand === 'umkaempft' && info.karte.besitz === 'kontor', `Zustand umkaempft, Besitz ${info.karte.besitz}`);
  const s = t.g.snapshot();
  ok(s.wellen && s.wellen.ph === 'countdown' && s.wellen.k === 'station' && s.wellen.s === t.S().seed && s.wellen.t > 0, 'Snapshot wellen (Countdown, Karte, Seed)');
  const seed1 = t.S().seed;
  t.g.handleMessage(t.cs[0], { t: 'menu', op: 'end' });
  ok(t.g.phase === 'lobby' && t.g.snapshot().lobby.wellen === 'station', 'Partie beenden -> Lobby, Kartenwahl bleibt (lobby.wellen)');
  for (const c of t.cs) t.g.handleMessage(c, { t: 'ready', ready: true });
  ok(t.S() && t.S().seed !== seed1, `neuer Seed beim nächsten Start (${seed1} -> ${t.S() && t.S().seed})`);
  t.g.handleMessage(t.cs[0], { t: 'menu', op: 'end' });
  t.g.handleMessage(t.cs[1], { t: 'lobbyOpt', wellen: 'quatsch' });
  ok(t.g.lobbyOpts.wellen === 'station', 'unbekannte Karte wird ignoriert');
  // URL-Variante: feste Karte, fester Seed
  const u = wellenSpiel(1, 'ruine', { arena: { art: 'ruine', seed: 3 } });
  ok(u.S() && u.S().seed === 3 && u.S().karte === 'ruine', 'URL ?arena=away&art=ruine&seed=3 -> Wellen mit festem Seed 3');
  // Altweg ohne Kartenwahl bleibt (Kesh/m3-Hof)
  const g = new Game({ noStore: true, seed: 11, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A', name: 'A', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_away' }); g.handleMessage(c, { t: 'ready', ready: true });
  ok(g.mission.activeId === 'm3' && !g.arena.wellen && !g.snapshot().wellen, 'ohne Kartenwahl: Altweg m3-Hof, kein wellen-Block');
});

// ---------------------------------------------------------------------------------------------------------------------
section('kampf: nie mehr als maxLebend stehend, Nachschub, Spawns außer Sicht, Snapshot (3 Spieler, Welle 10+)', () => {
  for (const karte of ['aussenposten', 'kesh']) {
    const t = wellenSpiel(3, karte, { seed: 21 });
    const g = t.g;
    ok(!g.away.drones.some((e) => e.kind === 'warden'), `${karte}: keine Fremdgegner (Kesh-Wächter raus)`);
    t.g.handleMessage(t.cs[0], { t: 'debug', cmd: 'welle', args: [11] });
    const S = t.S();
    ok(S.n === 11 && S.ph === 'kampf' && S.gesamt > C.maxLebend, `${karte}: Debug welle 11 -> ${S.gesamt} Gegner`);
    ok(stehend(g).length === C.maxLebend && stehend(g).some((e) => e.rank === 1 && e.wunden.max === C.rang.wunden) && g.snapshot().away.drones.some((d) => d.rk === 1),
      `${karte}: Erstbesetzung ${stehend(g).length}, Häuptling (rank, ${C.rang.wunden} Wunden) im Snapshot rk`);
    let maxSt = 0, maxSnap = 0, spawnFehler = 0, spawns = 0;
    const gesehen = new Set();
    const E = () => combat.env(g);
    for (let i = 0; i < 30 * 60; i++) {
      g.step(); heile(g);
      // neue Gegner: Abstand und Sicht im Moment des Erscheinens
      for (const e of welle(g)) {
        if (gesehen.has(e.id)) continue;
        gesehen.add(e.id); spawns++;
        const crew = g.players.filter((p) => p.zone === 'away');
        const d = Math.min(...crew.map((p) => Math.hypot(p.x - e.x, p.y - e.y) / TILE));
        const sicht = crew.some((p) => Los.lineOfSight(E().blocked, p.x, p.y, e.x, e.y));
        if (d < C.spawnAbstand - 0.5 || sicht) spawnFehler++;
      }
      maxSt = Math.max(maxSt, stehend(g).length);
      if (i % 6 === 0) maxSnap = Math.max(maxSnap, Buffer.byteLength(JSON.stringify(g.snapshot())));
      // alle 2 s fällt ein Gegner (Nachschub muss nachrücken)
      // (endgültig: 'aus' wie nach dem Ausbluten, sonst richten Kameraden ihn wieder auf)
      if (i % 60 === 30) { const e = stehend(g)[0]; if (e) { erledigen(g, e, g.players[i % 3].id); e.zustand = 'aus'; } }
    }
    ok(maxSt <= C.maxLebend, `${karte}: höchstens ${C.maxLebend} stehend (max ${maxSt})`);
    const soll = Wellen.anzahl(C, S.n, g.players.length);   // aus der Tabelle, nicht fest verdrahtet
    ok(spawns >= soll && S.gesamt === soll,`${karte}: Nachschub rückt nach, alle ${S.gesamt} der Welle kamen (${spawns} erschienen, ${S.abschuesse} gefallen)`);
    ok(spawnFehler === 0, `${karte}: Spawns ≥ ${C.spawnAbstand} Kacheln und außer Sicht (${spawnFehler} Verstöße)`);
    ok(maxSnap < SNAP_MAX, `${karte}: Snapshot max ${maxSnap} B < ${SNAP_MAX} B`);
    const zug = Object.values(S.kills).reduce((a, b) => a + b, 0);
    ok(zug > 0 && zug <= S.abschuesse, `${karte}: Abschüsse je Spieler zugeordnet ${JSON.stringify(S.kills)} (${zug}/${S.abschuesse}; ohne Projektil: nächster Spieler mit Sichtlinie)`);
    ok(g.errors === 0, `${karte}: keine Serverfehler`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
section('pause: Wellenende richtet auf, befreit, füllt auf', () => {
  const t = wellenSpiel(3, 'aussenposten', { seed: 5 });
  const g = t.g;
  for (let i = 0; i < 30 * (C.countdown + 1); i++) g.step();
  ok(t.S().n === 1 && t.S().ph === 'kampf' && t.events('welle').length === 1, 'Countdown -> Welle 1');
  const [a, b, c] = g.players;
  niederschlagen(g, a, 'verwundet'); niederschlagen(g, b, 'gefesselt');
  c.wunden.n = 0; c.shield.seg = 0;   // angeschlagen, steht aber
  ok(a.downed && b.downed && b.zustand === 'gefesselt', 'zwei liegen (verwundet, gefesselt)');
  for (let i = 0; i < 30 * 30 && t.S().ph === 'kampf'; i++) { for (const e of stehend(g)) erledigen(g, e, c.id); g.step(); }
  const S = t.S();
  ok(S.ph === 'pause' && t.events('welleGeschafft').length === 1, 'Welle 1 geschafft -> Pause');
  ok(g.players.every((p) => !p.downed && p.zustand === 'ok' && p.wunden.n === p.wunden.max && p.shield.seg === p.shield.max), 'alle aufgerichtet/befreit, Wunden und Schild voll');
  ok(welle(g).length === 0, 'Körper der Welle weg');
  const s = g.snapshot().wellen;
  ok(s.ph === 'pause' && s.t >= C.pause - 1 && s.n === 1, `Pausen-Countdown im Snapshot (${s.t} s)`);
  for (let i = 0; i < 30 * (C.pause + 1); i++) g.step();
  ok(t.S().n === 2 && t.S().ph === 'kampf', 'nach der Pause Welle 2');
  const ev = t.events('welle')[1];
  ok(ev && ev.neu && ev.neu.rolle === 'schuetze' && t.events('rolleNeu').some((e) => e.rolle === 'schuetze'), 'Welle 2 kündigt den Jäger an (welle.neu, rolleNeu)');
});

// ---------------------------------------------------------------------------------------------------------------------
section('ende: Crew unten -> Ergebnis -> Lobby', () => {
  const t = wellenSpiel(2, 'schiff', { seed: 9 });
  const g = t.g;
  for (let i = 0; i < 30 * (C.countdown + 2); i++) g.step();
  niederschlagen(g, g.players[0], 'verwundet');
  for (let i = 0; i < 30 * 3; i++) g.step();
  ok(t.S().ph === 'kampf', 'einer unten: Runde läuft weiter');
  niederschlagen(g, g.players[1], 'bewusstlos');
  for (let i = 0; i < 30 * (C.endeNach + 0.5); i++) g.step();
  const ev = t.events('wellenEnde')[0];
  ok(t.S().ph === 'ende' && ev && ev.welle === 1 && ev.karte === 'schiff' && Array.isArray(ev.kills) && ev.kills.length === 2 && ev.zeit > 0, `wellenEnde ${JSON.stringify(ev)}`);
  ok(!t.events('squadRecall').length && g.players.every((p) => p.zone === 'away'), 'keine Notrückholung während der Ergebnisanzeige');
  ok(g.snapshot().wellen.ph === 'ende', 'Snapshot ph ende');
  for (let i = 0; i < 30 * (C.ergebnisZeit + 1); i++) g.step();
  const se = t.events('sessionEnded').pop();
  ok(g.phase === 'lobby' && se && se.grund === 'wellen', 'nach ergebnisZeit zurück in die Lobby (sessionEnded grund wellen)');
  ok(g.errors === 0, 'keine Serverfehler');
});

// ---------------------------------------------------------------------------------------------------------------------
section('debug: welle <n> nur mit --debug', () => {
  const t = wellenSpiel(1, 'kesh', { debug: false });
  t.g.handleMessage(t.cs[0], { t: 'debug', cmd: 'welle', args: [8] });
  ok(t.S().n === 0, 'ohne --debug kein Sprung');
  const u = wellenSpiel(1, 'kesh');
  u.g.handleMessage(u.cs[0], { t: 'debug', cmd: 'welle', args: [8] });
  ok(u.S().n === 8 && u.S().ph === 'kampf' && stehend(u.g).length > 0, 'mit --debug: Welle 8 sofort');
});

console.log(`\ntest-wellen: ${n - fails}/${n} ok${fails ? `, ${fails} FEHLER` : ''}`);
process.exit(fails ? 1 : 0);
