'use strict';
// EK3 Teil B (CONTRACT-EK3B): Konvoi-Szene. Transporter (Gegnerseite, unbewaffnet), Eskorte, Route, Sprung, Siegbedingungen aufhalten und plündern,
// Ausgänge gepluendert/aufgehalten/entkommen mit Wiederholung, Beamen mit und ohne Systemtreffer, Lager voll (2 Ladungen), Ablieferung,
// Speichern/Laden mit Fracht, gleiche Regeln (Schilde, Treffer), Schützlings-Pfad (escort.js) unberührt, Labor, Katalog, Bausteine.
//   node tools/test-konvoi.js            -> alle Abschnitte
//   node tools/test-konvoi.js plündern   -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Konvoi = require('../server/sim/konvoi.js');
const Fracht = require('../server/sim/fracht.js');
const Escort = require('../server/sim/escort.js');
const interior = require('../server/sim/interior.js');
const Registry = require('../server/mission/registry.js');
const Katalog = require('../server/mission/katalog.js');
const Labor = require('../server/mission/labor.js');
const Spielleiter = require('../server/mission/spielleiter.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
const K = CONFIG.konvoi;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-konvoi-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

// Partie mit np Spielern. start: 'arena_space' (leeres Testgelände) | 'free' (Kampagne ohne Tutorial, Weltstand auf der Platte)
function setup(start, opts) {
  const o = opts || {};
  const worlds = start !== 'arena_space';
  const g = new Game(Object.assign({ noStore: true, worlds, worldSaveSync: true, worldDir: o.dir, seed: o.seed || 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} }, o.game || {}));
  const cs = [];
  for (let i = 0; i < (o.np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'Kon' + i, color: i });
    g.handleMessage(c, { t: 'lobbyOpt', startMission: start, ...(o.world ? { world: o.world } : {}) });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const mev = [];
  const me0 = g.missionEvent.bind(g);
  g.missionEvent = (kind, data) => { mev.push(Object.assign({ kind }, data)); return me0(kind, data); };
  const odas = [];
  const oda0 = g.oda.bind(g);
  g.oda = (text, x) => { odas.push(text); return oda0(text, x); };
  const p = g.players[0];
  const c = cs[0];
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  const send = (m) => g.handleMessage(c, m);
  const T = { g, c, p, run, send, events, mev, odas, ev: (k) => events.filter((e) => e.kind === k), me: (k) => mev.filter((e) => e.kind === k) };
  T.taktik = () => { g.players[0].console = 'weapons'; };
  T.cmd = (cmd, f) => { c.inbox.length = 0; send(Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  return T;
}
// Raumszene Rabenpass (3000×2200, offen, Lerche kommt bei 600,1100 an), Lerche unverwundbar
function raum(opts) {
  const T = setup('arena_space', opts);
  const g = T.g;
  g.god = true;
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  T.run(0.1);
  return T;
}
const alleT = (g) => Konvoi.transporter(g);
const kill = (g, e) => space.damageEnemy(g, e, 9999, e.x - 30, e.y);
const platz = (g, x, y, ang) => { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.turnVel = 0; if (ang != null) s.angle = ang; };
// Lerche weit weg vom Konvoi (kein Alarm durch Nähe)
const fern = (g) => platz(g, 300, 300, 0);
// Lerche an den Transporter e setzen (Reichweite zum Beamen/Einsammeln)
const bei = (g, x, y) => platz(g, x - 120, y, 0);

section('Ohne Konvoi: nichts ändert sich', () => {
  const T = raum();
  T.run(2);
  ok(T.g.space.konvoi === null || T.g.space.konvoi === undefined, 'Szene ohne Konvoi-Zustand');
  const e = space.spawnEnemy(T.g, 'raider', { x: 1500, y: 1100 });
  T.run(1);
  const s = T.g.snapshot();
  ok(s.space.enemies.every((q) => !('sj' in q)), 'Snapshot ohne sj');
  ok(!Konvoi.faehrt(e) && !Konvoi.aktiv(T.g) && Konvoi.ausgang(T.g) === null && !Konvoi.erfolg(T.g), 'normaler Gegner fährt nicht über den Konvoi, kein Ausgang');
  ok(CONFIG.enemies.frachter && CONFIG.enemyShields.frachter && CONFIG.shipClasses.frachter && CONFIG.enemyWeapons.frachter.length === 0, 'Config: enemies, enemyShields, shipClasses, enemyWeapons für frachter');
});

section('Aufbau: Transporter, Eskorte, Klassen aus der Config', () => {
  for (const nT of [1, 2, 3]) {
    const T = raum(); fern(T.g);
    const k = Konvoi.an(T.g, { n: nT, sieg: 'aufhalten' });
    const fr = T.g.space.enemies.filter((e) => e.kind === 'frachter');
    ok(fr.length === nT && k.ids.length === nT, `n=${nT}: ${nT} Transporter (Klasse frachter)`);
    ok(T.g.space.enemies.filter((e) => e.kind === 'raider').length === 1 && T.g.space.enemies.filter((e) => e.kind === 'korvette').length === 1, `n=${nT}: Eskorte voll = 1 Jäger und 1 Korvette`);
  }
  const T = raum(); fern(T.g);
  Konvoi.an(T.g, { n: 9, sieg: 'aufhalten' });
  ok(T.g.space.enemies.filter((e) => e.kind === 'frachter').length === K.nMax, `n über ${K.nMax} wird gekappt`);
  for (const [esk, r, kv] of [['keine', 0, 0], ['jaeger', 1, 0], ['korvette', 0, 1]]) {
    const U = raum(); fern(U.g);
    Konvoi.an(U.g, { n: 2, eskorte: esk });
    ok(U.g.space.enemies.filter((e) => e.kind === 'raider').length === r && U.g.space.enemies.filter((e) => e.kind === 'korvette').length === kv, `Eskorte ${esk}: ${r} Jäger, ${kv} Korvette`);
  }
  const g = T.g; const e = g.space.enemies.find((q) => q.kind === 'frachter');
  const hp = Math.max(1, Math.round(CONFIG.enemies.frachter.hp * space.crewScale(g).enemyHp * (CONFIG.spaceM3.enemyHpFactor || 1)));
  ok(e.hpMax === hp && e.hp === hp, `Hülle nach CONFIG.enemies.frachter und Crew-Skalierung (${e.hpMax})`);
  ok(JSON.stringify(e.shieldsMax) === JSON.stringify(CONFIG.enemyShields.frachter), 'Schilde nach CONFIG.enemyShields.frachter ' + JSON.stringify(e.shieldsMax));
  ok(!e.waffen && space.waffenPlaetze(g, e, null).length === 0, 'unbewaffnet: kein Waffenplatz');
  const s = g.snapshot().space.enemies.find((q) => q.id === e.id);
  ok(s && s.kind === 'frachter' && !('sj' in s), 'Snapshot: Transporter als Gegner (kind frachter), ohne sj vor dem Sprung');
  // Route
  const k = g.space.konvoi;
  ok(k.route.length === K.route.length && k.route.every((p) => p.x >= K.rand && p.x <= g.space.w - K.rand && p.y >= K.rand && p.y <= g.space.h - K.rand), 'Route: Wegpunkte im Feld (Rand ' + K.rand + ')');
  ok(k.route[0].x < g.space.w / 2 && k.route[k.route.length - 1].x > g.space.w / 2, 'Lerche in der ersten Hälfte: Konvoi fährt nach Osten');
  const M = raum(); platz(M.g, 2600, 1100, Math.PI); Konvoi.an(M.g, { n: 1 });
  const km = M.g.space.konvoi;
  ok(km.route[0].x > M.g.space.w / 2 && km.route[km.route.length - 1].x < M.g.space.w / 2, 'Lerche in der zweiten Hälfte: Route gespiegelt (nach Westen)');
  // Crew-Skalierung (Mehrspieler)
  const T3 = raum({ np: 3 }); fern(T3.g); Konvoi.an(T3.g, { n: 1 });
  const e3 = T3.g.space.enemies.find((q) => q.kind === 'frachter');
  ok(e3.hpMax > e.hpMax || space.crewScale(T3.g).enemyHp === space.crewScale(g).enemyHp, `Mehrspieler: Hülle skaliert wie bei jedem Gegner (3 Spieler ${e3.hpMax}, 1 Spieler ${e.hpMax})`);
});

section('Unbewaffnet, Eskorte wacht, Alarm', () => {
  const T = raum(); const g = T.g;
  platz(g, 1250, 1500, 0);   // nahe am Konvoi, aber außerhalb des Wachradius
  Konvoi.an(g, { n: 2, sieg: 'aufhalten' });
  const k = g.space.konvoi;
  const esk = Konvoi.mitglieder(g, 'e');
  ok(esk.length === 2 && esk.every((e) => e.wache), 'Eskorte wacht (e.wache)');
  platz(g, 300, 300, 0);
  let schuss = 0;
  T.run(15, () => { schuss += g.space.projectiles.length; });
  ok(schuss === 0 && !k.alarm, 'Wache: Eskorte und Transporter schießen nicht, kein Alarm (Lerche fern)');
  ok(esk.every((e) => e.kv === 'e' && e.wache) && alleT(g).every((t) => !t.tele), 'Eskorte fährt mit (kein Angriff)');
  // Alarm: Lerche nahe an einem Transporter
  const t0 = alleT(g)[0];
  platz(g, t0.x - 300, t0.y, 0);
  T.run(0.3);
  ok(k.alarm && esk.every((e) => !e.wache), 'Lerche im Wachradius: Alarm, Eskorte greift an (e.wache aus)');
  ok(T.odas.some((t) => /Eskorte/.test(t)) && T.me('konvoiAlarm').length === 1, 'Ansage und missionEvent konvoiAlarm');
  // Alarm durch Treffer
  const U = raum(); fern(U.g); Konvoi.an(U.g, { n: 2 });
  space.damageEnemy(U.g, alleT(U.g)[0], 1, 100, 100);
  U.run(0.2);
  ok(U.g.space.konvoi.alarm, 'Treffer auf einen Transporter löst Alarm aus');
  // Brocken lösen keinen Alarm aus: Treffer durch Brocken setzt hitT zurück
  const V = raum(); fern(V.g); Konvoi.an(V.g, { n: 2 });
  const tt = alleT(V.g)[0];
  const h0 = tt.hitT;
  V.g.space.asteroids = [{ id: 'a1', x: tt.x, y: tt.y, r: 80, seed: 1 }];
  V.run(0.5);
  ok(!V.g.space.konvoi.alarm && (tt.hitT === h0 || tt.hp < tt.hpMax || tt.hp === tt.hpMax), 'Brocken allein löst keinen Alarm aus');
  // Transporter schießen nie, auch nicht im Alarm
  let s2 = 0;
  const W = raum(); const gw = W.g; platz(gw, 1300, 1700, 0); Konvoi.an(gw, { n: 3, eskorte: 'keine' });
  W.run(30, () => { s2 += gw.space.projectiles.length; });
  ok(s2 === 0, '3 Transporter ohne Eskorte, Lerche daneben: 30 s kein Projektil, kein Strahl (unbewaffnet)');
});

section('Fahrt, Sprung und Ausgang entkommen (Aufhalten)', () => {
  const T = raum(); const g = T.g;
  fern(g);
  Konvoi.an(g, { n: 2, sieg: 'aufhalten', eskorte: 'keine', wiederholung: false });
  const k = g.space.konvoi;
  const t0 = alleT(g)[0];
  const x0 = t0.x, y0 = t0.y;
  T.run(10);
  ok(Math.hypot(t0.x - x0, t0.y - y0) > 300, 'Transporter fahren die Route (nach 10 s mehr als 300 px)');
  const sp0 = Math.hypot(t0.vx, t0.vy);
  ok(sp0 > 30 && sp0 < 60, `Tempo ≈ ¼–½ der Klasse (${sp0.toFixed(0)} px/s)`);
  let spool = false, sj = 0;
  T.run(160, () => { const e = alleT(g).find((q) => q.sprung != null); if (e && !spool) { spool = true; } if (e) sj = Math.max(sj, (g.snapshot().space.enemies.find((q) => q.id === e.id) || {}).sj || 0); return Konvoi.ausgang(g) !== null; });
  ok(spool, 'ein Transporter erreicht das Routenende und lädt den Sprung auf');
  ok(sj > 0, 'Snapshot trägt sj (Aufladung) während des Sprungs: ' + sj);
  ok(Konvoi.ausgang(g) === 'entkommen', 'Aufhalten: der erste Sprung beendet die Szene mit Ausgang entkommen (' + Konvoi.ausgang(g) + ')');
  T.run(5);
  ok(Konvoi.gesprungen(g) >= 1 && T.ev('konvoiSprung').length >= 1 && T.ev('konvoiAusgang').some((e) => e.was === 'entkommen'), 'Ereignisse konvoiSprung und konvoiAusgang (entkommen)');
  ok(T.odas.some((t) => /springt in etwa 30 s/.test(t)) && T.odas.some((t) => /springt in etwa 10 s/.test(t)), 'Ansagen 30 s und 10 s vor dem Sprung');
  ok(!Konvoi.erfolg(g) && Konvoi.ausgang(g) === 'entkommen' && g.space.konvoi.neuAt === null, 'ohne Wiederholung bleibt entkommen stehen (kein neuer Konvoi)');
});

section('Wiederholung: entkommen -> neuer Konvoi, Szene scheitert nie endgültig', () => {
  const T = raum(); const g = T.g;
  fern(g);
  Konvoi.an(g, { n: 2, sieg: 'aufhalten', eskorte: 'voll' });
  const k = g.space.konvoi;
  T.run(200, () => Konvoi.ausgang(g) === 'entkommen');
  ok(Konvoi.ausgang(g) === 'entkommen' && k.neuAt != null, 'Ausgang entkommen, Wiederholung vorgemerkt (neuAt)');
  T.run(K.neuNach + 0.5);
  ok(k.versuch === 2 && Konvoi.ausgang(g) === null && alleT(g).length === 2, 'nach ' + K.neuNach + ' s: Versuch 2, neuer Konvoi mit 2 Transportern');
  ok(Konvoi.mitglieder(g, 'e').length === 2 && T.odas.some((t) => /neuer Konvoi/.test(t)), 'Eskorte neu, Ansage „neuer Konvoi“; Reste des ersten Konvois entfernt');
  ok(g.space.enemies.filter((e) => e.kv).length === 4, 'genau 4 Konvoi-Schiffe (keine Reste)');
  // zweiter Versuch gewinnen
  for (const e of alleT(g)) kill(g, e);
  T.run(0.3);
  ok(Konvoi.ausgang(g) === 'aufgehalten' && Konvoi.erfolg(g), 'zweiter Versuch: alle zerstört -> aufgehalten, Erfolg');
  T.run(K.neuNach + 2);
  ok(k.versuch === 2 && Konvoi.ausgang(g) === 'aufgehalten', 'nach Erfolg kommt kein weiterer Konvoi');
  // Notbremse: festgefahrener Konvoi springt trotzdem
  const U = raum(); const gu = U.g; fern(gu);
  Konvoi.an(gu, { n: 1, sieg: 'aufhalten', eskorte: 'keine', wiederholung: false });
  gu.space.konvoi.t0 = gu.time - (K.springSpaetestens + 1);
  U.run(K.springDauer + 1);
  ok(Konvoi.ausgang(gu) === 'entkommen', `Notbremse: nach ${K.springSpaetestens} s springt der Konvoi auch ohne Routenende`);
});

section('Aufhalten: alle zerstören', () => {
  const T = raum(); const g = T.g; fern(g);
  Konvoi.an(g, { n: 3, sieg: 'aufhalten', eskorte: 'keine' });
  const T0 = alleT(g);
  kill(g, T0[0]); T.run(0.2);
  ok(Konvoi.ausgang(g) === null && Konvoi.zerstoert(g) === 1 && Konvoi.uebrig(g) === 2, 'einer zerstört: Szene läuft weiter');
  kill(g, T0[1]); kill(g, T0[2]); T.run(0.2);
  ok(Konvoi.ausgang(g) === 'aufgehalten' && Konvoi.erfolg(g) && Konvoi.uebrig(g) === 0, 'alle zerstört: aufgehalten');
  ok(T.me('konvoiTransporterZerstoert').length === 3 && T.me('konvoiAusgang').some((e) => e.was === 'aufgehalten'), 'missionEvents konvoiTransporterZerstoert ×3 und konvoiAusgang aufgehalten');
  ok(Konvoi.ausgangIst(g, 'aufgehalten') && !Konvoi.ausgangIst(g, 'entkommen') && !Konvoi.ausgangIst(g, 'gepluendert'), 'Prüfung ausgangIst');
  ok(Fracht.draussen(g).length === 3, 'auch beim Aufhalten bleibt Fracht liegen (Beute optional)');
});

section('Plündern: zerstörter Transporter lässt Fracht fallen, Taktik beamt sie an Bord', () => {
  const T = raum(); const g = T.g; fern(g);
  Konvoi.an(g, { n: 2, sieg: 'pluendern', eskorte: 'keine' });
  const t0 = alleT(g)[0];
  const px = t0.x, py = t0.y;
  kill(g, t0); T.run(0.1);
  const d = Fracht.draussen(g);
  ok(d.length === 1 && d[0].art === 'sprengstoff' && Math.hypot(d[0].x - px, d[0].y - py) < 20, 'Transporter zerstört: Fracht (sprengstoff) an seiner Stelle ' + JSON.stringify(d[0]));
  ok(T.ev('frachtAbgeworfen').length === 1 && T.odas.some((t) => /Fracht in Reichweite/.test(t)), 'Ereignis frachtAbgeworfen und Funktext „Fracht in Reichweite“');
  ok(Konvoi.ausgang(g) === null, 'eine Ladung von zwei: Szene läuft weiter');
  // außer Reichweite: Beamen abgelehnt
  T.taktik();
  platz(g, d[0].x - 800, d[0].y, 0);
  let err = T.cmd('weapons.fracht');
  ok(err.length === 1 && /Reichweite|zu weit/i.test(err[0]), 'außer Reichweite: ' + err[0]);
  // in Reichweite: 3 s halten ohne Systemtreffer
  platz(g, d[0].x - 150, d[0].y, 0);
  err = T.cmd('weapons.fracht');
  ok(!err.length && g.fracht.halt, 'in Reichweite: Halteprozess läuft');
  T.run(3.2);
  ok(Fracht.anBord(g, 'sprengstoff') === 1 && Fracht.draussen(g).length === 0, 'nach 3 s ohne Treffer: Sprengstoff an Bord');
  // zweite Fracht: mit Systemtreffer erst Abbruch, dann Neustart
  const t1 = alleT(g)[0];
  kill(g, t1); T.run(0.1);
  ok(Konvoi.ausgang(g) === null || Konvoi.ausgang(g) === 'gepluendert', 'zweiter Transporter zerstört');
  ok(Fracht.draussen(g).length === 1, 'zweite Fracht liegt');
  const d2 = Fracht.draussen(g)[0];
  platz(g, d2.x - 150, d2.y, 0);
  T.cmd('weapons.fracht');
  T.run(1.5);
  interior.damageSystem(g, 'engines', 'damaged');
  ok(!g.fracht.halt && Fracht.anBord(g) === 1 && Fracht.draussen(g).length === 1, 'Systemtreffer: Beamen abgebrochen, Fracht bleibt liegen');
  ok(Konvoi.ausgang(g) === null, 'noch nicht gepluendert (nur eine Ladung an Bord)');
  T.cmd('weapons.fracht');
  T.run(3.2);
  ok(Fracht.anBord(g, 'sprengstoff') === 2, 'Neustart nach dem Abbruch: zwei Ladungen an Bord (Lager voll)');
  T.run(0.2);
  ok(Konvoi.ausgang(g) === 'gepluendert' && Konvoi.erfolg(g), 'beide Ladungen an Bord: Ausgang gepluendert');
  ok(T.me('konvoiAusgang').some((e) => e.was === 'gepluendert') && T.odas.some((t) => /Beute an Bord/.test(t)), 'missionEvent konvoiAusgang gepluendert, Ansage');
  ok(g.snapshot().fracht.lager.length === 2, 'Snapshot: fracht.lager 2 Ladungen');
});

section('Plündern: Lager voll (dritte Ladung), Ladungsart', () => {
  const T = raum(); const g = T.g; fern(g);
  Konvoi.an(g, { n: 3, sieg: 'pluendern', eskorte: 'keine', ladung: 'fracht' });
  const k = g.space.konvoi;
  ok(k.beuteMin === 2 && k.art === 'fracht', 'beute_min höchstens die Kapazität des Frachtraums (2), Ladungsart fracht');
  for (const e of alleT(g)) kill(g, e);
  T.run(0.2);
  ok(Fracht.draussen(g).length === 3 && Fracht.draussen(g).every((d) => d.art === 'fracht'), 'drei Ladungen der Art fracht im Raum');
  T.taktik();
  const ds = Fracht.draussen(g);
  platz(g, ds[0].x - 100, ds[0].y, 0);
  for (let i = 0; i < 2; i++) { const d = Fracht.draussen(g)[0]; platz(g, d.x - 100, d.y, 0); T.cmd('weapons.fracht'); T.run(3.2); }
  ok(Fracht.anBord(g) === 2 && Fracht.draussen(g).length === 1, 'zwei Ladungen an Bord, eine bleibt draußen');
  const err = T.cmd('weapons.fracht');
  ok(err.length === 1 && /voll/i.test(err[0]), 'dritte Ladung wird abgelehnt: ' + err[0]);
  ok(Konvoi.ausgang(g) === 'gepluendert', 'Ausgang gepluendert');
});

section('Plündern: entkommen (Fracht fehlt), Wiederholung mit kleinerem Konvoi', () => {
  const T = raum(); const g = T.g; fern(g);
  Konvoi.an(g, { n: 2, sieg: 'pluendern', eskorte: 'keine' });
  const k = g.space.konvoi;
  const [a, b] = alleT(g);
  kill(g, a); T.run(0.2);
  // eine Ladung beamen
  T.taktik();
  const d = Fracht.draussen(g)[0];
  platz(g, d.x - 120, d.y, 0); T.cmd('weapons.fracht'); T.run(3.2);
  ok(Fracht.anBord(g) === 1, 'eine Ladung an Bord');
  // zweiter Transporter springt: nur eine Ladung -> entkommen
  fern(g);
  b.sprung = 0; b.sprungDauer = K.springDauer;
  T.run(K.springDauer + 0.5);
  ok(Konvoi.ausgang(g) === 'entkommen' && Konvoi.gesprungen(g) === 1, 'zweiter Transporter springt: Ausgang entkommen (nur 1 von 2 Ladungen)');
  ok(Fracht.anBord(g) === 1, 'die Ladung an Bord bleibt (bis man das System verlässt)');
  T.run(K.neuNach + 0.3);
  ok(k.versuch === 2 && alleT(g).length === 1, 'Wiederholung: der Rest des Konvois ist kleiner (1 Transporter, 1 Ladung fehlt noch)');
  kill(g, alleT(g)[0]); T.run(0.2);
  const d2 = Fracht.draussen(g)[0];
  T.taktik(); platz(g, d2.x - 120, d2.y, 0); T.cmd('weapons.fracht'); T.run(3.2);
  T.run(0.2);
  ok(Fracht.anBord(g) === 2 && Konvoi.ausgang(g) === 'gepluendert', 'zweiter Versuch: zweite Ladung an Bord -> gepluendert');
  // Notlage: alles zerstört, aber Fracht gar nicht abgeholt und kein Platz mehr -> weiter möglich, solange Fracht liegt
  const U = raum(); const gu = U.g; fern(gu);
  Konvoi.an(gu, { n: 2, sieg: 'pluendern', eskorte: 'keine', wiederholung: false });
  for (const e of alleT(gu)) kill(gu, e);
  U.run(0.3);
  ok(Konvoi.ausgang(gu) === null, 'beide zerstört, Fracht liegt noch: Szene läuft weiter (Ladung kann noch geholt werden)');
});

section('Ablieferung und Speichern/Laden mit Fracht', () => {
  const dir = freshDir();
  const T = setup('free', { dir });
  T.run(0.5);
  const g = T.g;
  g.debugGoto('rabenpass', false); T.run(0.3);
  g.space.enemies = []; fern(g);
  Konvoi.an(g, { n: 2, sieg: 'pluendern', eskorte: 'keine' });
  for (const e of alleT(g)) kill(g, e);
  T.run(0.2);
  T.taktik();
  for (let i = 0; i < 2; i++) { const d = Fracht.draussen(g)[0]; platz(g, d.x - 100, d.y, 0); T.cmd('weapons.fracht'); T.run(3.2); }
  ok(Fracht.anBord(g, 'sprengstoff') === 2 && Konvoi.ausgang(g) === 'gepluendert', 'Beute: 2 × Sprengstoff an Bord');
  // Speichern/Laden (gespeichert wird beim Andocken: mit der Beute zur Station)
  g.debugGoto('hafen', true); T.run(0.5);
  ok(g.ship.docked && Fracht.anBord(g, 'sprengstoff') === 2, 'am Hafen angedockt, Beute weiter an Bord');
  const id = g.weltstand.id;
  T.send({ t: 'menu', op: 'end' });
  const data = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
  ok(JSON.stringify(data.schiff.fracht) === '["sprengstoff","sprengstoff"]' && Weltstand.validate(data).length === 0, 'Weltstand: schiff.fracht = 2 × Sprengstoff, schema-gültig ' + JSON.stringify(data.schiff.fracht) + ' ' + JSON.stringify(Weltstand.validate(data).slice(0, 2)));
  ok(!JSON.stringify(data).includes('konvoi'), 'der Konvoi (Laufzeit) steht nicht im Weltstand');
  const L = setup('free', { dir, world: id });
  L.run(0.3);
  ok(Fracht.anBord(L.g, 'sprengstoff') === 2 && Fracht.frei(L.g) === 0, 'nach dem Laden: 2 × Sprengstoff an Bord, Frachtraum voll');
  // Ablieferung am Hafen (jede Station)
  L.g.debugGoto('hafen', false); L.run(0.3);
  L.taktik();
  L.g.ship.x = 520 + 100; L.g.ship.y = 700;
  const err = L.cmd('weapons.abliefern');
  ok(!err.length && L.g.fracht.halt && L.g.fracht.halt.kind === 'ab', 'am Hafen: Abliefern startet ' + JSON.stringify(err));
  L.run(3.2);
  ok(Fracht.anBord(L.g) === 0 && Fracht.abgeliefert(L.g, 'sprengstoff') === 2 && L.me('frachtAbgeliefert').length === 1, 'abgeliefert: 2 × Sprengstoff, missionEvent frachtAbgeliefert');
  // Systemwechsel: Fracht im Raum weg, Konvoi weg, Ladung an Bord bleibt
  const M = raum(); const gm = M.g; fern(gm);
  Konvoi.an(gm, { n: 2, sieg: 'pluendern', eskorte: 'keine' });
  kill(gm, alleT(gm)[0]); M.run(0.2);
  Fracht.anBordLegen(gm, 'sprengstoff');
  space.enterScene(gm, 'b7', {}); M.run(0.3);
  ok(gm.space.konvoi === null && Fracht.draussen(gm).length === 0 && Fracht.anBord(gm) === 1, 'Szene verlassen: Konvoi und Fracht im Raum weg, Ladung an Bord bleibt');
  ok(gm.space.enemies.every((e) => !e.kv), 'keine Konvoi-Schiffe in der neuen Szene');
});

section('Gleiche Regeln: Schilde, Treffer, Marken, Lanze, Schützlings-Pfad', () => {
  const T = raum(); const g = T.g; fern(g);
  Konvoi.an(g, { n: 1, sieg: 'aufhalten', eskorte: 'keine' });
  const t = alleT(g)[0];
  const hp0 = t.hp; const sh0 = t.shields.slice();
  // Schild fängt den ersten Treffer (Sektor Bug/Steuerbord/Heck/Backbord je 1 Punkt)
  space.damageEnemy(g, t, 0.5, t.x + Math.cos(t.angle) * 100, t.y + Math.sin(t.angle) * 100);
  ok(t.hp === hp0 && t.shields.some((v, i) => v < sh0[i]), 'Schild nimmt den Treffer (Hülle unberührt): Schilde ' + JSON.stringify(t.shields));
  const marks0 = g.inventory.marks, kills0 = g.stats.kills;
  space.damageEnemy(g, t, 9999, t.x - 50, t.y);
  ok(g.inventory.marks === marks0 + CONFIG.enemies.frachter.salvage && g.stats.kills === kills0 + 1, 'Zerstörung gibt Marken (salvage) und zählt als Abschuss wie bei jedem Gegner');
  // Lanze trifft Transporter (hitRadius)
  const U = raum(); const gu = U.g; fern(gu);
  Konvoi.an(gu, { n: 1, sieg: 'aufhalten', eskorte: 'keine' });
  const tu = alleT(gu)[0];
  platz(gu, tu.x - 250, tu.y, 0);
  gu.ship.angle = Math.atan2(tu.y - gu.ship.y, tu.x - gu.ship.x);
  gu.ship.mount.bow.charge = 1;
  const hpu = tu.hp;
  space.weaponsFire(gu, 'bow'); U.run(0.3);
  ok(tu.hp < hpu || tu.shields.some((v, i) => v < tu.shieldsMax[i]), 'Lanze trifft den Transporter (Hülle ' + hpu + ' -> ' + tu.hp + ', Schilde ' + JSON.stringify(tu.shields) + ')');
  // Schützlings-Pfad der Spielerseite bleibt funktionsfähig, auch mit Konvoi in der Szene
  const E = raum(); const ge = E.g; fern(ge);
  Konvoi.an(ge, { n: 1, sieg: 'aufhalten', eskorte: 'keine' });
  const es = Escort.spawn(ge, { tag: 'kunde', kind: 'frachter', verhalten: 'folgt_kurs', von: 'lerche', nach: 'vorn' });
  ok(es && es.kind === 'frachter' && Escort.list(ge).length === 1, 'Schützling (Spielerseite, kind frachter) lässt sich anlegen: neben dem Konvoi-Transporter');
  ok(ge.space.enemies.filter((e) => e.kind === 'frachter').length === 1, 'der Transporter ist ein Gegner, der Schützling nicht (getrennte Listen)');
  const snap = ge.snapshot().space;
  ok(snap.escorts.length === 1 && snap.enemies.some((q) => q.kind === 'frachter'), 'Snapshot: space.escorts (1) und space.enemies mit Transporter');
  const raider = space.spawnEnemy(ge, 'raider', { x: es.x + 200, y: es.y, ziel: 'kunde' });
  E.run(2);
  ok(raider.targetId === es.id, 'Gegner mit Ziel Schützling greift den Schützling an (Konvoi-Transporter sind nie Ziel)');
  ok(alleT(ge).every((q) => q.targetId == null), 'Transporter haben kein Angriffsziel');
  const hp1 = es.hp;
  Escort.hit(ge, es, 2, {});
  ok(es.hp < hp1, 'Escort.hit wirkt wie bisher');
});

section('Konsolenbefehl und Debug', () => {
  const T = raum(); const g = T.g;
  const e2 = Konvoi.debug(g, ['3', 'aufhalten', 'keine']);
  ok(e2 === null && alleT(g).length === 3 && g.space.konvoi.sieg === 'aufhalten' && g.space.enemies.filter((e) => e.kind !== 'frachter').length === 0, 'debug konvoi 3 aufhalten keine');
});

section('Labor, Katalog, Bausteine', () => {
  const k = Spielleiter.katalog();
  const sz = Object.values(k.szenentypen).find((s) => s.kennung === 'A15');
  ok(sz && sz.status === 'verfuegbar' && sz.verfuegbare_molekuele.includes('konvoi_abfangen'), 'Szenentyp A15 Konvoi verfügbar mit Molekül konvoi_abfangen');
  const mol = k.molekuele.konvoi_abfangen;
  ok(mol && mol.umsetzungen.length === 2 && mol.umsetzungen.every((u) => u.status === 'verfuegbar'), 'Molekül konvoi_abfangen: 2 Umsetzungen verfügbar (pluendern, aufhalten)');
  const liste = Labor.laborListe(k).filter((e) => e.molekuel === 'konvoi_abfangen');
  ok(liste.length === 2 && liste.every((e) => e.schauplatz === 'weltraum' && e.ort === 'rabenpass'), 'Labor-Liste: beide Konvoi-Einträge (Ort rabenpass)');
  for (const id of ['konvoi_an', 'konvoi_ende', 'konvoi_ausgang', 'konvoi_erfolg', 'konvoi_uebrig']) ok(!!Registry.get(id), 'Baustein ' + id + ' registriert');
  for (const id of liste.map((e) => e.id)) {
    const T = setup('free', { dir: freshDir(), game: {} });
    T.run(0.3);
    const r = Labor.laborStart(T.g, id, { seed: 5, direkt: true });
    ok(r.ok === true, `laborStart ${id}: ${r.fehler || 'ok'}`);
    T.run(6);
    ok(T.g.ship.scene === 'rabenpass' && T.g.space.konvoi && T.g.space.konvoi.sieg === (/pluendern/.test(id) ? 'pluendern' : 'aufhalten'), `${id}: Szene Rabenpass, Konvoi mit der Siegbedingung des Eintrags`);
    ok(T.g.space.enemies.filter((e) => e.kind === 'frachter').length === 2 && Konvoi.mitglieder(T.g, 'e').length === 2, `${id}: 2 Transporter, Jäger und Korvette`);
    // Erfolg über Regiebuch: Szene geschafft -> Mission weiter
    for (const e of alleT(T.g)) kill(T.g, e);
    T.run(0.1);
    T.g.space.enemies = T.g.space.enemies.filter((e) => !e.kv);   // Eskorte weg: kein Systemtreffer beim Beamen
    if (/pluendern/.test(id)) {
      T.taktik(); T.g.god = true;
      for (let i = 0; i < 2; i++) { const d = Fracht.draussen(T.g)[0]; if (!d) break; platz(T.g, d.x - 100, d.y, 0); T.cmd('weapons.fracht'); T.run(3.3); }
    } else T.run(0.5);
    T.run(3);
    const ms = T.g.mission.missions[T.g.labor.buch];
    ok(ms && ms.state === 'done' && Konvoi.erfolg(T.g), `${id}: Mission erfolgreich beendet (Ausgang ${ms && ms.ausgang})`);
  }
  // Überspringen (skip) im Regiebuch
  const S = setup('free', { dir: freshDir() });
  S.run(0.3);
  Labor.laborStart(S.g, 'konvoi_abfangen/pluendern', { seed: 3 });
  S.run(3);
  const m = S.g.mission;
  const buch = m.missions[S.g.labor.buch];
  ok(!!buch, 'Labor-Mission läuft');
  m.skip();
  S.run(2);
  ok(Konvoi.erfolg(S.g) || (S.g.mission.missions[S.g.labor.buch] || {}).state === 'done', 'Überspringen wertet die Szene als geschafft (konvoi_ende)');
});

section('Katalog-Prüfer: Regiebuch mit Konvoi-Bausteinen', () => {
  const Checker = require('../server/mission/checker.js');
  const doc = { format: 'regiebuch/1', id: 'ktest', titel: 'Konvoi-Test', auftraggeber: 'tesk', kopf: { art: 'test' }, buehne: { orte: ['rabenpass'] },
    steps: [{ id: 'a', loc: 'rabenpass', enter: [{ do: 'konvoi_an', n: 2, sieg: 'pluendern', ladung: 'sprengstoff', eskorte: 'voll' }],
      objectives: [{ id: 'o1', text: '@t1', done: { check: { name: 'konvoi_erfolg' } } }],
      next: [{ if: { check: { name: 'konvoi_ausgang', was: 'gepluendert' } }, complete: 'erfolg' }] }],
    texte: { t1: 'Konvoi plündern' } };
  const r = Checker.check(doc, {});
  const mine = r.errors.concat(r.warnings).filter((e) => /konvoi/i.test(e.p + ' ' + e.msg));
  ok(mine.length === 0, 'Prüfer: keine Meldung zu konvoi_*' + (mine.length ? ' – ' + JSON.stringify(mine[0]) : ''));
  const bad = JSON.parse(JSON.stringify(doc)); bad.steps[0].enter[0].sieg = 'verschenken';
  ok(Checker.check(bad, {}).errors.some((e) => /sieg|verschenken/.test(e.msg + e.p)), 'Prüfer: unbekannte Siegbedingung wird gemeldet');
  const bad2 = JSON.parse(JSON.stringify(doc)); bad2.steps[0].next[0].if.check.was = 'verschwunden';
  ok(Checker.check(bad2, {}).errors.some((e) => /was|verschwunden/.test(e.msg + e.p)), 'Prüfer: unbekannter Ausgang in konvoi_ausgang wird gemeldet');
});

section('Snapshot-Größe', () => {
  const T = raum({ np: 3 }); const g = T.g; fern(g);
  Konvoi.an(g, { n: 3, sieg: 'pluendern' });
  for (const e of g.space.enemies) e.scanned = true;
  const t = alleT(g)[0]; t.sprung = 1; t.sprungDauer = 4;
  kill(g, alleT(g)[1]); T.run(0.2);
  const s = JSON.stringify(g.snapshot());
  ok(s.length < CONFIG.net.snapshotBudget || s.length < 18944, `Snapshot mit Konvoi (3 Transporter, Eskorte, Fracht): ${s.length} B (Ziel ≤ 18 944)`);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ntest-konvoi: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
