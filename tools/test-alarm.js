'use strict';
// EK2 Raum-Alarm: Alarmstufen, Lärm, Patrouillen mit Sensorkreisen, Einsprung, Minen (zünden, abschießen, Besitzer, ohne Strom),
// Signatur und Schilde-Knopf, Weitscan, Schleichfahrt im Labor (durchlaufen, mit Entdeckung, Rückzug), Snapshot, Katalog/Prüfer.
//   node tools/test-alarm.js [begriff …]   -> nur Abschnitte, deren Name einen der Begriffe enthält
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Alarm = require('../server/sim/alarm.js');
const Katalog = require('../server/mission/katalog.js');
const Labor = require('../server/mission/labor.js');
const Registry = require('../server/mission/registry.js');
const interior = require('../server/sim/interior.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const DT = 1 / CONFIG.tickHz;
const A = CONFIG.alarm;

// Partie im Raum (Splittergürtel), ohne Mission: Alarm aus, Lerche am Ankunftspunkt, Systeme heil
function raum(loc, seed, np) {
  const g = new Game({ noStore: true, seed: seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 600) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); cs.push(c);
  }
  g.reset(); g.phase = 'play';
  space.enterScene(g, loc || 'splitter', {});
  g.space.enemies = []; g.space.projectiles = [];
  return { g, cs };
}
const ticks = (g, sek, each) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) { if (each) each(i * DT); g.step(); } };
const heil = (g) => { const sh = g.ship; sh.hull = 100; for (const k of interior.SYSTEM_ORDER) sh.systems[k] = 'ok'; sh.fireList.length = 0; sh.breachList.length = 0; };
const punkte = (g) => interior.SYSTEM_ORDER.reduce((a, k) => a + ({ ok: 0, damaged: 1, broken: 2, offline: 1 }[g.ship.systems[k]] || 0), 0);
// Lerche auf einen Punkt setzen, ruhig
function platz(g, x, y, ang) { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; if (ang != null) s.angle = ang; }
// Schuss mit der Lanze in Bugrichtung (Aufladen übersprungen)
function lanze(g) { g.ship.mount.bow.charge = 1; return space.weaponsFire(g, 'bow'); }
// Steuern zum Punkt (Stufe 0..5: STOPP = 1, ¼ = 2, ½ = 3 …)
function steuere(g, tx, ty, stufe) {
  const s = g.ship; let d = Math.atan2(ty - s.y, tx - s.x) - s.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
  space.helmInput(g, Math.max(-1, Math.min(1, d * 2.5)), 0);
  space.helmThrottle(g, { set: stufe });
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

section('Ohne Alarm in der Szene: nichts ändert sich', () => {
  const { g } = raum();
  ticks(g, 0.2);
  ok(g.space.alarm === null && g.space.minen.length === 0, 'Szene ohne Alarmzustand und Minen');
  platz(g, 800, 800, 0); lanze(g); space.weaponsFire(g, 'all');
  g.ship.module = []; g.ship.powerIntent = { engines: 4, shields: 2, weapons: 2 }; ticks(g, 6);   // PAN-01 A: ohne Module bleibt Energie für Antrieb 4
  ok(Alarm.stufe(g) === 0 && g.space.alarm === null, 'Waffenfeuer und Antrieb Energie 4 lösen ohne Alarmbaustein nichts aus');
  const snap = g.snapshot();
  ok(!('mines' in snap.space) && !('al' in snap.space) && !('sf' in snap.ship), 'Snapshot ohne mines, al, sf (Standardwerte fehlen)');
  const e = space.spawnEnemy(g, 'raider', { x: 1500, y: 800 });
  ok(snap.space.enemies.length === 0 && g.snapshot().space.enemies.some((q) => q.id === e.id) && g.snapshot().space.enemies.every((q) => !('pat' in q)), 'normale Gegner sichtbar, ohne Patrouillenfeld');
});

section('Alarmstufen: Lärm (Waffenfeuer, Antrieb Energie 4, Reaktor überladen)', () => {
  const { g } = raum();
  Alarm.an(g, {});
  ok(Alarm.stufe(g) === 0 && Alarm.stufeName(g) === 'ruhig', 'eingeschaltet: ruhig');
  platz(g, 800, 800, 0);
  lanze(g);
  ok(Alarm.stufe(g) === 1 && Alarm.stufeName(g) === 'misstrauisch', 'ein Schuss: misstrauisch');
  ticks(g, A.laerm.takt + 0.5);
  g.ship.mount.port.charge = 1; space.weaponsFire(g, 'port');
  ok(Alarm.stufe(g) === 2 && g.space.alarm.grund === 'laerm', 'zweiter Schuss kurz danach: alarmiert (Grund laerm)');
  // Abklingen: ein Schuss, dann Ruhe
  const r = raum(); const h = r.g; Alarm.an(h, {}); platz(h, 800, 800, 0); lanze(h);
  ticks(h, A.laerm.misstrauenDauer + 3);
  ok(Alarm.stufe(h) === 0, `ohne weiteren Lärm beruhigt sich die Szene nach ${A.laerm.misstrauenDauer} s`);
  // gleichzeitiger Doppelschuss (Takt) zählt einmal
  const r2 = raum(); const k = r2.g; Alarm.an(k, {}); platz(k, 800, 800, 0);
  k.ship.mount.port.charge = 1; k.ship.mount.stbd.charge = 1;
  space.weaponsFire(k, 'all');
  ok(Alarm.stufe(k) === 1, 'beide Batterien im selben Moment: ein Lärm-Ereignis, misstrauisch');
  // Antrieb auf Energie 4
  const r3 = raum(); const a3 = r3.g; Alarm.an(a3, {}); platz(a3, 800, 800, 0); a3.ship.module = []; a3.ship.powerIntent = { engines: 4, shields: 2, weapons: 2 };   // PAN-01 A: ohne Module Energie für Antrieb 4
  ticks(a3, A.laerm.antriebTakt + 1);
  ok(Alarm.stufe(a3) === 1, 'Antrieb auf Energie 4: nach einem Takt misstrauisch');
  ticks(a3, A.laerm.antriebTakt + 1);
  ok(Alarm.stufe(a3) === 2, 'Antrieb bleibt auf Energie 4: nach dem nächsten Takt alarmiert');
  // Reaktor überladen: gewichtet 2 = sofort alarmiert
  const r4 = raum(); const a4 = r4.g; Alarm.an(a4, {}); heil(a4);
  const err = space.technikOverload(a4);
  ok(!err && Alarm.stufe(a4) === 2, 'Reaktor überladen: sofort alarmiert');
  // Gegner wissen von der Lerche
  const r5 = raum(); const a5 = r5.g; Alarm.an(a5, { wissen: true });
  ok(Alarm.stufe(a5) === 1, 'wissen: ja – Start misstrauisch');
  ticks(a5, A.laerm.misstrauenDauer + 5);
  ok(Alarm.stufe(a5) === 1, 'wissen: ja – beruhigt sich nicht');
  platz(a5, 800, 800, 0); lanze(a5);
  ok(Alarm.stufe(a5) === 2, 'wissen: ja – ein einziger Schuss alarmiert');
  // Alarmiert bleibt
  ticks(a5, 90);
  ok(Alarm.stufe(a5) === 2, 'alarmiert bleibt bis zum Verlassen der Szene');
  space.enterScene(a5, 'nebel', {});
  ok(a5.space.alarm === null && Alarm.stufe(a5) === 0 && a5.space.minen.length === 0, 'neue Szene: Alarm und Minen zurückgesetzt');
});

section('Patrouillen: Strecke, Sensorkreis, Entdeckung, Angriff', () => {
  const { g } = raum();
  const pat = Alarm.patrouilleSetzen(g, { n: 2, x: 1500, y: 400, x2: 1500, y2: 1200, tag: 'p' });
  const e0 = pat[0];
  const y0 = e0.y; ticks(g, 4);
  ok(pat.length === 2 && g.space.alarm.aktiv && pat.every((e) => e.pat && e.patrolle), 'zwei Patrouillen, Alarm eingeschaltet');
  ok(Math.abs(e0.y - y0) > 100 && Math.abs(e0.x - 1500) < 1, 'Patrouille läuft ihre Strecke ab (x fest, y wandert)');
  ok(g.space.enemies.every((e) => !e.tele && g.space.projectiles.length === 0), 'ruhige Patrouille feuert nicht');
  // Lerche weit weg: nichts
  platz(g, 200, 800, 0); ticks(g, 3);
  ok(Alarm.stufe(g) === 0 && pat.every((e) => !(e.verdacht > 0)), 'Lerche weit weg: kein Verdacht');
  // Lerche steht am Rand des Sensorkreises bei Tempo 0 (Signatur nur "ruhe", ohne Schleichfahrt = 1)
  const e = pat[0];
  platz(g, e.x - 300, e.y, 0);
  const r = Alarm.sensorRadius(g, e);
  ok(Math.abs(r - A.patrouille.sensor) < 1, `Sensorkreis ohne Schleichfahrt = sensor (${Math.round(r)} px)`);
  ticks(g, A.patrouille.zeit + 0.6, () => platz(g, e.x - 250, e.y, 0));
  ok(Alarm.stufe(g) === 2 && g.space.alarm.grund === 'entdeckt', 'Lerche im Sensorkreis > zeit: entdeckt, alarmiert');
  ok(g.space.enemies.every((q) => !q.pat && q.alarmiert), 'alle Patrouillen greifen an (Strecke verlassen)');
  ok(g.space.alarm.einsprungAt == null && !g.space.alarm.einsprungFertig, 'mit Patrouillen kein Einsprung');
  ticks(g, 6);
  ok(g.space.enemies.length === 2, 'kein Einsprung nach 6 s (nur die beiden Patrouillen)');
  // Treffer auf eine ruhige Patrouille verrät uns
  const r2 = raum(); const k = r2.g;
  const p2 = Alarm.patrouilleSetzen(k, { n: 1, x: 1500, y: 800 });
  platz(k, 100, 100, 0);
  space.damageEnemy(k, p2[0], 0.1, 1400, 800);
  ok(Alarm.stufe(k) === 2 && k.space.alarm.grund === 'entdeckt', 'Treffer auf eine Patrouille: entdeckt');
});

section('Einsprung: ohne Patrouille springen nach 5 s zwei Jäger ein (mit Ansage)', () => {
  const { g, cs } = raum();
  Alarm.an(g, {});
  platz(g, 1500, 800, 0);
  const t0 = g.time;
  Alarm.ausloeser(g, 'entdeckt');
  ok(Alarm.stufe(g) === 2 && g.space.alarm.einsprungAt != null && Math.abs(g.space.alarm.einsprungAt - t0 - A.einsprung.verzoegerung) < 0.05, `alarmiert: Einsprung in ${A.einsprung.verzoegerung} s eingeplant`);
  const ansage = cs[0].inbox.some((m) => m.kind === 'oda' && /springen in 5 Sekunden ein/.test(m.text || ''));
  ok(ansage, 'Ansage (ODA) sofort: „… springen in 5 Sekunden ein“');
  ok(cs[0].inbox.some((m) => m.kind === 'einsprungAnsage'), 'Ereignis einsprungAnsage');
  ticks(g, A.einsprung.verzoegerung - 0.5);
  ok(g.space.enemies.length === 0, 'vor Ablauf noch keine Jäger');
  ticks(g, 1);
  const raiders = g.space.enemies.filter((e) => e.kind === 'raider' && e.tag === 'einsprung');
  ok(raiders.length === 2 && g.space.alarm.einsprungFertig, 'nach 5 s: zwei Jäger (Tag einsprung)');
  const sp = Alarm.naechsterSprungpunkt(g);
  const nah = raiders.every((e) => dist(e, sp) < 300 || e.x < 400 || e.y < 400 || e.x > g.space.w - 400 || e.y > g.space.h - 400);
  ok(nah, `Jäger tauchen am Sprungpunkt auf (nächster Sprungpunkt ${Math.round(sp.x)}/${Math.round(sp.y)})`);
  ok(cs[0].inbox.some((m) => m.kind === 'einsprung'), 'Ereignis einsprung');
  const ds = Alarm.sprungpunkte(g).map((p) => dist(p, g.ship)).sort((a, b) => a - b);
  ok(Math.abs(dist(sp, g.ship) - ds[0]) < 1, 'es ist der Sprungpunkt mit dem kleinsten Abstand zur Lerche');
  ticks(g, 30);
  ok(g.space.enemies.length === 2 && g.errors === 0, 'nur einmal pro Szene, keine Server-Fehler');
  // einsprung: false
  const r2 = raum(); const k = r2.g; Alarm.an(k, { einsprung: false }); Alarm.ausloeser(k, 'mine'); ticks(k, 8);
  ok(k.space.enemies.length === 0, 'einsprung: false – es springt nichts ein');
  // jaeger: 3
  const r3 = raum(); const m = r3.g; Alarm.an(m, { jaeger: 3 }); Alarm.ausloeser(m, 'mine'); ticks(m, 6);
  ok(m.space.enemies.length === 3, 'jaeger: 3 – drei Jäger');
  // Patrouille vorhanden, aber schon tot: Einsprung
  const r4 = raum(); const q = r4.g; Alarm.patrouilleSetzen(q, { n: 1, x: 1500, y: 800 });
  q.space.enemies = []; Alarm.ausloeser(q, 'mine');
  ok(q.space.alarm.einsprungAt != null, 'keine lebende Patrouille mehr (verloren): Einsprung');
});

section('Minen: zünden (ignoriert Schilde, 6 Punkte Systemschaden, Alarm)', () => {
  const { g, cs } = raum();
  heil(g);
  const [m] = Alarm.minenSetzen(g, { n: 1, positionen: [{ x: 1500, y: 800 }] });
  ok(g.space.minen.length === 1 && m.besitzer === 'gegner' && g.space.alarm.aktiv, 'Mine gesetzt (Besitzer gegner), Alarm eingeschaltet');
  platz(g, 1500 - A.mine.zuend - 80, 800, 0);
  ticks(g, 0.3);
  ok(g.space.minen.length === 1 && Alarm.stufe(g) === 0, 'außerhalb des Zündradius passiert nichts');
  platz(g, 1500 - A.mine.zuend + 10, 800, 0);
  heil(g);
  const sc0 = g.ship.shields.current.slice(); const h0 = g.ship.hull;
  g.step();
  ok(g.space.minen.length === 0, 'zu nahe: Mine explodiert');
  ok(punkte(g) === A.mine.punkte, `6 Punkte Systemschaden (beschädigt 1, zerstört 2): ${punkte(g)}`);
  ok(g.ship.hull === h0 && g.ship.shields.current.every((v, i) => v === sc0[i]) && sc0.some((v) => v > 0), `ignoriert Schilde: Schildpunkte (${sc0.join('/')}) und Hülle unberührt`);
  ok(Alarm.stufe(g) === 2 && g.space.alarm.grund === 'mine', 'löst Alarm aus (Grund mine)');
  ok(cs[0].inbox.some((e) => e.kind === 'explosion') && cs[0].inbox.some((e) => e.kind === 'oda' && /Minentreffer/.test(e.text || '')), 'Explosion und Ansage');
  // Verteilung auf zufällige Systeme: über mehrere Seeds nie mehr als 14 Systeme, immer genau 6 Punkte, und nicht immer dieselben
  const verteilungen = new Set();
  for (let s = 1; s <= 12; s++) {
    const r = raum('splitter', s); const q = r.g; heil(q);
    Alarm.minenSetzen(q, { n: 1, positionen: [{ x: 1500, y: 800 }] }); platz(q, 1500, 800, 0); ticks(q, 0.1);
    if (punkte(q) !== 6) { ok(false, `Seed ${s}: ${punkte(q)} Punkte`); }
    verteilungen.add(interior.SYSTEM_ORDER.filter((k) => q.ship.systems[k] !== 'ok').join(','));
  }
  ok(verteilungen.size > 3, `Systeme zufällig verteilt (${verteilungen.size} verschiedene Muster in 12 Seeds)`);
  // Teilweise schon beschädigt: beschädigt -> zerstört
  const r2 = raum(); const k2 = r2.g; heil(k2);
  for (const sy of interior.SYSTEM_ORDER) k2.ship.systems[sy] = 'broken';
  k2.ship.systems.engines = 'ok'; k2.ship.systems.reactor = 'damaged';
  Alarm.minenSetzen(k2, { n: 1, positionen: [{ x: 1500, y: 800 }] }); platz(k2, 1500, 800, 0); ticks(k2, 0.1);
  ok(k2.ship.systems.engines === 'broken' && k2.ship.systems.reactor === 'broken' && interior.SYSTEM_ORDER.filter((k) => k !== 'engines' && k !== 'reactor').every((k) => k2.ship.systems[k] === 'broken'), 'Systeme gehen eine Stufe tiefer (ok → beschädigt → zerstört), bereits zerstörte bleiben unberührt');
});

section('Minen: abschießen (Explosion auf Distanz, macht trotzdem Alarm)', () => {
  // Lanze aus 450 px: außerhalb des Sprengradius – kein Schaden, aber Alarm
  const { g } = raum();
  heil(g);
  Alarm.minenSetzen(g, { n: 1, positionen: [{ x: 1500, y: 800 }] });
  platz(g, 1050, 800, 0);
  const sr = lanze(g);
  ok(!sr && g.space.minen.length === 0, 'Lanze trifft die Mine, sie explodiert');
  ok(punkte(g) === 0, 'Lerche außerhalb des Sprengradius: kein Systemschaden');
  ok(Alarm.stufe(g) === 2 && g.space.alarm.grund === 'mine', 'trotzdem Alarm');
  // Lanze aus 120 px: die Lerche steht im Sprengradius
  const r2 = raum(); const k = r2.g; heil(k);
  Alarm.minenSetzen(k, { n: 1, positionen: [{ x: 1500, y: 800 }] });
  platz(k, 1500 - 120, 800, 0);
  lanze(k);
  ok(k.space.minen.length === 0 && punkte(k) === 6, `im Sprengradius (120 < ${A.mine.spreng}): Systemschaden ${punkte(k)}`);
  // Mine hinter einem Gegner: der Gegner steht davor und wird getroffen, die Mine bleibt
  const r3 = raum(); const q = r3.g;
  Alarm.minenSetzen(q, { n: 1, positionen: [{ x: 1500, y: 800 }] });
  const e = space.spawnEnemy(q, 'korvette', { x: 1200, y: 800 });
  platz(q, 900, 800, 0); lanze(q);
  ok(q.space.minen.length === 1 && e.hp < e.hpMax, 'Gegner vor der Mine fängt den Strahl');
  // Bolzen (Projektil) trifft Mine
  const r4 = raum(); const b = r4.g; heil(b);
  Alarm.minenSetzen(b, { n: 1, positionen: [{ x: 1500, y: 800 }] });
  platz(b, 1000, 800, 0);
  b.space.projectiles.push({ id: 'pr_t', kind: 'bolzen', x: 1450, y: 800, angle: 0, speed: 500, ttl: 2, dmg: 3, target: null });
  ticks(b, 0.3);
  ok(b.space.minen.length === 0 && Alarm.stufe(b) === 2, 'Bolzen trifft die Mine: Explosion, Alarm');
  // Batterie auf angewählte (gesehene) Mine
  const r5 = raum(); const t = r5.g; heil(t);
  const [mm] = Alarm.minenSetzen(t, { n: 1, positionen: [{ x: 1500, y: 1100 }] });
  platz(t, 1500 - 300, 1100 - 300 + 300, 0);   // Mine steuerbord-voraus? Ausrichtung: Bug nach +x, Steuerbord = +y
  t.ship.angle = 0; t.ship.x = 1450; t.ship.y = 800;
  mm.gesehen = true;
  const ter = space.weaponsTarget(t, mm.id);
  ok(!ter && t.ship.target === mm.id, `gesehene Mine ist anwählbar (${ter || 'ok'})`);
  t.ship.mount.stbd.charge = 1; t.ship.mount.stbd.alloc = 2;
  const fe = space.weaponsFire(t, 'stbd');
  ticks(t, 2);
  ok(!fe && t.space.minen.length === 0 && Alarm.stufe(t) === 2, `Batterie schießt die angewählte Mine ab (${fe || 'ok'})`);
  // Nicht gesehene Mine ist nicht anwählbar
  const r6 = raum(); const u = r6.g;
  const [m6] = Alarm.minenSetzen(u, { n: 1, positionen: [{ x: 2400, y: 1400 }] });
  ok(space.weaponsTarget(u, m6.id) === 'Ziel nicht gefunden.', 'ungesehene Mine nicht anwählbar');
});

section('Minen: zünden nicht bei ihrem Besitzer, ohne Strom', () => {
  // Mine des Gegners: ein Gegner darüber – nichts
  const { g } = raum(); heil(g);
  const [m] = Alarm.minenSetzen(g, { n: 1, besitzer: 'gegner', positionen: [{ x: 1500, y: 800 }] });
  const e = space.spawnEnemy(g, 'korvette', { x: 1500, y: 800 });
  platz(g, 100, 100, 0);
  e.pat = { a: { x: 1500, y: 800 }, b: { x: 1500, y: 800 }, s: 0, d: 1, v: 0 };   // steht über der Mine
  ticks(g, 1);
  ok(g.space.minen.length === 1 && m.besitzer === 'gegner' && Alarm.stufe(g) === 0, 'Mine des Gegners zündet nicht bei einem Gegner');
  // Mine der Lerche: Lerche darüber – nichts, Gegner darüber – Explosion
  const r2 = raum(); const k = r2.g; heil(k);
  Alarm.minenSetzen(k, { n: 1, besitzer: 'lerche', positionen: [{ x: 1500, y: 800 }] });
  platz(k, 1500, 800, 0); ticks(k, 0.5);
  ok(k.space.minen.length === 1 && punkte(k) === 0, 'Mine der Lerche zündet nicht bei der Lerche');
  platz(k, 100, 100, 0);
  const g1 = space.spawnEnemy(k, 'korvette', { x: 1500, y: 800 });
  g1.hp = g1.hpMax = 100;
  const hp0 = g1.hp;
  ticks(k, 0.2);
  ok(k.space.minen.length === 0 && g1.hp < hp0, `Mine der Lerche zündet beim Gegner (Hülle ${hp0} → ${g1.hp}, Schilde ignoriert)`);
  // ohne Strom: Blindgänger
  const r3 = raum(); const q = r3.g; heil(q);
  const [m3] = Alarm.minenSetzen(q, { n: 2, ohneStrom: true, positionen: [{ x: 1500, y: 800 }, { x: 1500, y: 1200 }] });
  platz(q, 1500, 800, 0); ticks(q, 0.5);
  ok(q.space.minen.length === 2 && punkte(q) === 0 && Alarm.stufe(q) === 0, 'Mine ohne Strom zündet nicht bei Annäherung');
  platz(q, 1500 - 300, 800, 0); q.ship.angle = 0;
  lanze(q);
  ok(q.space.minen.length === 1 && !q.space.minen.includes(m3), 'abgeschossen: die Mine verschwindet');
  ok(punkte(q) === 0 && Alarm.stufe(q) < 2 && q.space.alarm.grund !== 'mine', 'Blindgänger: kein Schaden, kein Minen-Alarm (der Schuss selbst ist Lärm: höchstens misstrauisch)');
});

section('Weitscan zeigt Minen und Patrouillen; Ping verrät die Lerche', () => {
  const { g } = raum();
  Alarm.minenSetzen(g, { n: 3, positionen: [{ x: 1300, y: 800 }, { x: 1700, y: 900 }, { x: 2800, y: 1400 }] });
  const pat = Alarm.patrouilleSetzen(g, { n: 1, x: 1500, y: 300, x2: 1500, y2: 400 });
  platz(g, 1000, 800, 0);
  let s = g.snapshot();
  ok(!s.space.mines && !s.space.enemies.some((e) => e.id === pat[0].id), 'vor dem Weitscan: keine Mine (außer nah), keine Patrouille im Snapshot');
  g.ship.widescan.cd = 0;
  const err = space.weaponsWidescan(g);
  s = g.snapshot();
  ok(!err && s.space.mines && s.space.mines.length === 2, `Weitscan (Radius ${CONFIG.widescan.radius}): zwei Minen im Radius sichtbar, die ferne nicht (${(s.space.mines || []).length})`);
  ok(s.space.enemies.some((e) => e.id === pat[0].id && e.pat > 0), 'Patrouille im Radius sichtbar, mit Sensorkreis (pat)');
  ticks(g, 1);
  ok(g.snapshot().space.mines.length === 2, 'Minen bleiben für den Rest der Szene sichtbar');
  ticks(g, A.patrouille.pingSicht + 1);
  ok(!g.snapshot().space.enemies.some((e) => e.id === pat[0].id), `Patrouille nach ${A.patrouille.pingSicht} s wieder unsichtbar`);
  // nah sichtbar
  platz(g, 1500, 300 + A.patrouille.sichtNah - 40, 0);
  ok(g.snapshot().space.enemies.some((e) => e.id === pat[0].id), 'nahe Patrouille sichtbar');
  // nahe Mine ohne Weitscan sichtbar
  platz(g, 2800 - A.mine.sicht + 20, 1400 - 200, 0); g.ship.y = 1400 - 60; g.ship.x = 2800 - A.mine.sicht + 30;
  ok(g.snapshot().space.mines.some((m) => m.x === 2800), 'sehr nahe Mine auch ohne Weitscan sichtbar');
});

section('Signatur: Tempo, Schilde, Asteroiden, Ping, Nebel-Schalter', () => {
  const { g } = raum();
  Alarm.an(g, { schleichfahrt: true });
  const K = A.signatur;
  // freie Stelle ohne Brocken: eine Position mit Abstand > 110 zu allen Brocken suchen
  const brocken = space.brocken(g);
  let frei = null;
  for (let x = 400; x < 2800 && !frei; x += 50) for (let y = 200; y < 1500 && !frei; y += 50) if (brocken.every((a) => Math.hypot(a.x - x, a.y - y) - a.r > K.asteroid.abstand + 60)) frei = { x, y };
  let nahe = null;
  for (const a of brocken) { const x = a.x + a.r + 40, y = a.y; if (brocken.every((b) => Math.hypot(b.x - x, b.y - y) - b.r > 0) ) { nahe = { x, y }; break; } }
  platz(g, frei.x, frei.y, 0);
  g.ship.vx = 0; g.ship.vy = 0;
  const s0 = Alarm.signatur(g);
  ok(Math.abs(s0 - K.ruhe) < 1e-6, `Stand: Signatur = ruhe (${s0})`);
  g.ship.vx = 130 * 0.27;
  const s1 = Alarm.signatur(g);
  g.ship.vx = 130;
  const s2 = Alarm.signatur(g);
  ok(s0 < s1 && s1 < s2 && Math.abs(s2 - 1) < 1e-6, `wächst mit dem Tempo: Stand ${s0.toFixed(2)} < ¼ ${s1.toFixed(2)} < Voll ${s2.toFixed(2)}`);
  g.ship.vx = 130 * 0.5;
  const sMid = Alarm.signatur(g);
  space.helmStop(g);
  // Schilde runter
  g.ship.vx = 130 * 0.5;
  ok(!Alarm.schildeSchalten(g, true) && Alarm.schildeUnten(g), 'Schilde runter');
  const sDown = Alarm.signatur(g);
  ok(Math.abs(sDown - sMid * K.schildeUnten) < 1e-6 && sDown < sMid * 0.6, `Schilde runter senkt die Signatur deutlich (${sMid.toFixed(2)} → ${sDown.toFixed(2)})`);
  // Asteroiden
  if (nahe) {
    platz(g, nahe.x, nahe.y, 0); g.ship.vx = 130 * 0.5;
    const sA = Alarm.signatur(g);
    ok(Math.abs(sA - sDown * K.asteroid.faktor) < 1e-6, `Asteroiden dämpfen (× ${K.asteroid.faktor}): ${sDown.toFixed(2)} → ${sA.toFixed(2)}`);
  } else ok(false, 'kein Brocken gefunden');
  // Ping
  g.ship.widescan.cd = 0; space.weaponsWidescan(g);
  ok(Alarm.signatur(g) === K.pingSig, `Weitscan verrät die Lerche: Signatur ${K.pingSig} für ${K.pingDauer} s`);
  ticks(g, K.pingDauer + 0.3, () => { g.ship.vx = 130 * 0.5; });
  ok(Alarm.signatur(g) < 0.5, 'nach dem Ping wieder gedämpft');
  // Nebel: nur mit Schalter
  const r2 = raum('nebel'); const n2 = r2.g; Alarm.an(n2, { schleichfahrt: true });
  platz(n2, 300, 1200, 0); n2.ship.vx = 130 * 0.5;
  const nOhne = Alarm.signatur(n2);
  CONFIG.alarm.signatur.nebel.schalter = true;
  const nMit = Alarm.signatur(n2);
  CONFIG.alarm.signatur.nebel.schalter = false;
  ok(nMit < nOhne && Math.abs(nMit - nOhne * K.nebel.faktor) < 1e-6, `Nebel dämpft nur mit Schalter (E4: Schalter aus in der Kampagne): ${nOhne.toFixed(2)} → ${nMit.toFixed(2)}`);
  ok(CONFIG.sensors.nebelServer === 'wellen' && CONFIG.alarm.signatur.nebel.schalter === false, "nebelServer bleibt 'wellen', Signatur-Nebel aus");
  // Sensorkreis wächst mit der Signatur
  const r3 = raum(); const k = r3.g;
  const [p] = Alarm.patrouilleSetzen(k, { n: 1, x: 1500, y: 800 });
  Alarm.an(k, { schleichfahrt: true }); platz(k, 100, 100, 0);
  k.ship.vx = 0; k.space.alarm.sig = Alarm.signatur(k);
  const rStand = Alarm.sensorRadius(k, p);
  k.ship.vx = 130; k.space.alarm.sig = Alarm.signatur(k);
  const rVoll = Alarm.sensorRadius(k, p);
  ok(rStand < rVoll * 0.25 && Math.abs(rVoll - A.patrouille.sensor) < 1, `Sensorkreis wächst mit der Signatur: Stand ${Math.round(rStand)} px, Voll ${Math.round(rVoll)} px`);
  // misstrauisch und Vorwissen weiten den Kreis
  Alarm.laerm(k, 'waffen');
  const rMis = Alarm.sensorRadius(k, p);
  ok(Math.abs(rMis - rVoll * (1 + A.patrouille.misstrauenBonus)) < 1, `misstrauisch: Sensorkreis +${A.patrouille.misstrauenBonus * 100} %`);
});

section('Schilde hoch/runter: Treffer gehen an den Schilden vorbei', () => {
  const { g } = raum();
  heil(g);
  ok(Alarm.schildeSchalten(g, true) === 'Die Schilde lassen sich nur in einer Schleichfahrt herunterfahren.', 'außerhalb einer Schleichfahrt abgelehnt');
  Alarm.an(g, { schleichfahrt: true, einsprung: false });
  platz(g, 800, 800, 0);
  for (let k = 0; k < 4; k++) g.ship.shields.current[k] = 4;
  const hull0 = g.ship.hull;
  space.shipHit(g, 0, 1, {});
  ok(g.ship.hull === hull0 && g.ship.shields.current[0] === 3, 'Schilde oben: Treffer geht in den Schild');
  Alarm.schildeSchalten(g, true);
  space.shipHit(g, 0, 1, {});
  ok(g.ship.hull < hull0 && g.ship.shields.current[0] === 3, 'Schilde unten: Treffer geht in die Hülle, Schildpunkte bleiben');
  const sf = g.snapshot().ship.sf;
  ok(sf && sf.d === 1 && sf.sig >= 0, 'Snapshot ship.sf: d = 1 (unten)');
  Alarm.schildeSchalten(g, false);
  ok(Alarm.schildeUnten(g) && g.space.alarm.hochBis > g.time, 'hoch: Schilde fahren hoch (noch ohne Schutz)');
  const h1 = g.ship.hull; space.shipHit(g, 0, 1, {});
  ok(g.ship.hull < h1, 'während des Hochfahrens noch ungeschützt');
  ticks(g, A.signatur.schildeHoch + 0.3);
  ok(!Alarm.schildeUnten(g), `nach ${A.signatur.schildeHoch} s wieder oben`);
  const h2 = g.ship.hull; space.shipHit(g, 0, 1, {});
  ok(g.ship.hull === h2, 'wieder oben: Treffer geht in den Schild');
  // Kommando
  const r = raum(); const k = r.g; Alarm.an(k, { schleichfahrt: true });
  const p0 = k.players[0]; p0.console = 'weapons'; p0.zone = 'ship';
  const c = r.cs[0]; k.handleMessage(c, { t: 'cmd', c: 'weapons.schilde', unten: true });
  ok(Alarm.schildeUnten(k), 'Kommando weapons.schilde { unten: true } an der Taktik');
  p0.console = 'helm';
  k.handleMessage(c, { t: 'cmd', c: 'weapons.schilde', unten: false });
  ok(Alarm.schildeUnten(k) && !k.space.alarm.hochBis, 'nur die Taktik darf (Pilot wird abgewiesen)');
});

// ---------- Schleichfahrt im Labor ----------
const SCHLEICH = 'unbemerkt_durchfliegen/patrouillen_schleichfahrt';
const MINEN = 'kurs_durch_gefahr/minenfeld';
function laborRaum(id, params, seed) {
  const { g, cs } = raum('hafen', seed || 5);
  const r = Labor.laborStart(g, id, Object.assign({ seed: seed || 5 }, params || {}));
  ticks(g, 1);
  return { g, cs, r };
}
function mission(g) { return g.mission.missions[g.labor.buch] || {}; }

section('Katalog, Prüfer, Labor: Schleichfahrt und Minen freigeschaltet', () => {
  const k = Katalog.load({});
  ok(k.fehler.length === 0, 'Katalog lädt ohne Fehler (Prüfer besteht die neuen Umsetzungen)');
  ok(k.mechaniken.schleichfahrt.status === 'verfuegbar' && k.mechaniken.minen.status === 'verfuegbar' && k.mechaniken.raum_alarm.status === 'verfuegbar', 'Mechaniken schleichfahrt, minen, raum_alarm verfügbar');
  const a13 = Object.values(k.szenentypen).find((s) => s.kennung === 'A13');
  ok(a13 && a13.status === 'verfuegbar' && a13.verfuegbare_molekuele.includes('unbemerkt_durchfliegen'), 'Szenentyp A13 Schleichfahrt verfügbar mit Molekül unbemerkt_durchfliegen');
  const u = k.molekuele.unbemerkt_durchfliegen.umsetzungen[0];
  const um = k.molekuele.kurs_durch_gefahr.umsetzungen.find((x) => x.id === 'minenfeld');
  ok(u.status === 'verfuegbar' && um.status === 'verfuegbar', 'Umsetzungen patrouillen_schleichfahrt und minenfeld verfügbar');
  const liste = Labor.laborListe(k).map((e) => e.id);
  ok(liste.includes(SCHLEICH) && liste.includes(MINEN), 'beide im Szenario-Labor');
  const kurz = require('../server/mission/katalog.js').fuerSpielleiter(k, 'kurz');
  ok(/unbemerkt_durchfliegen\/patrouillen_schleichfahrt/.test(kurz) && /kurs_durch_gefahr\/minenfeld/.test(kurz) && /A13/.test(kurz), 'Grobplan-Katalog nennt Schleichfahrt (A13) und Minenfeld');
  for (const id of ['raum_alarm_an', 'spawn_patrouille', 'minenfeld', 'schleichfahrt_an']) ok(Registry.get(id) && Registry.get(id).art === 'aktion', `Baustein ${id}`);
  for (const id of ['alarm_stufe', 'schiff_bei', 'rueckzug', 'minen_uebrig']) ok(Registry.get(id) && Registry.get(id).art === 'pruefung', `Prüfung ${id}`);
  // Prüfer: falscher Parameter wird erkannt
  const Checker = require('../server/mission/checker.js');
  const buch = Katalog.testRegiebuch(Katalog.instantiate(u, { loc: 'splitter' }, 's1', 'test_ende').frag, 'unbemerkt_durchfliegen', u);
  ok(Checker.check(buch).errors.length === 0, 'Prüfer: Testbuch der Schleichfahrt fehlerfrei');
  const schlecht = JSON.parse(JSON.stringify(buch)); schlecht.steps[0].enter[0].patrouillen = 99;
  ok(Checker.check(schlecht).errors.some((e) => e.code === 'PARAM-WERT'), 'Prüfer: patrouillen = 99 außerhalb des Bereichs');
  const schlecht2 = JSON.parse(JSON.stringify(buch)); schlecht2.steps[0].enter[0].do = 'minefeld';
  ok(Checker.check(schlecht2).errors.some((e) => e.code === 'REF-BAUSTEIN'), 'Prüfer: unbekannter Baustein abgelehnt');
});

section('Schleichfahrt durchlaufen (Labor, Patrouillen und Minen, ohne Entdeckung)', () => {
  const { g, r } = laborRaum(SCHLEICH, { loc: 'splitter' });
  ok(r.ok && g.ship.scene === 'splitter' && g.space.alarm && g.space.alarm.aktiv && g.space.alarm.schleich, `Labor-Start: Schleichfahrt aktiv (${r.fehler || ''})`);
  const al = g.space.alarm;
  const pats = g.space.enemies.filter((e) => e.pat);
  ok(pats.length === 2 && g.space.minen.length === 3 && al.ziel && al.ziel.x === 2750, `2 Patrouillen, 3 Minen, Ziel ${JSON.stringify(al.ziel)}`);
  ok(g.ship.markers.captain && g.ship.markers.captain.x === 2750, 'Zielkreis liegt auf dem Captain-Marker');
  ok(g.mission.state.objectives.some((o) => /Zielkreis/.test(o.text || '')), 'Ziel in der Aufgabenliste');
  // Taktik pingt einmal, fährt Schilde runter; Pilot fliegt langsam um Minen herum
  g.ship.widescan.cd = 0; space.weaponsWidescan(g);
  Alarm.schildeSchalten(g, true);
  const minen = g.space.minen.map((m) => ({ x: m.x, y: m.y }));
  const ziel = al.ziel;
  let t = 0; let wp = { x: ziel.x, y: ziel.y }; let maxSig = 0;
  // Flugweg: Wegpunkte, die alle bekannten Minen (≥ 160 px Abstand) umgehen
  const frei = (x, y) => minen.every((m) => Math.hypot(m.x - x, m.y - y) > 170) && space.brocken(g).every((a) => Math.hypot(a.x - x, a.y - y) > a.r + 70);
  const wege = [];
  { let cur = { x: g.ship.x, y: g.ship.y };
    while (Math.hypot(ziel.x - cur.x, ziel.y - cur.y) > 130 && wege.length < 40) {
      const ang = Math.atan2(ziel.y - cur.y, ziel.x - cur.x);
      let best = null;
      for (let da = 0; da < 1.4 && !best; da += 0.1) for (const sg of [1, -1]) {
        const a = ang + da * sg; const nx = cur.x + Math.cos(a) * 140, ny = cur.y + Math.sin(a) * 140;
        let ok2 = frei(nx, ny);
        for (let f = 0.25; f < 1 && ok2; f += 0.25) ok2 = frei(cur.x + (nx - cur.x) * f, cur.y + (ny - cur.y) * f);
        if (ok2) { best = { x: nx, y: ny }; break; }
      }
      if (!best) break;
      wege.push(best); cur = best;
    }
  }
  ok(wege.length > 5, `Flugweg um Minen und Brocken gefunden (${wege.length} Wegpunkte)`);
  let i = 0; let entdeckt = false;
  while (t < 400 && mission(g).state !== 'done') {
    if (i < wege.length) { wp = wege[i]; if (Math.hypot(g.ship.x - wp.x, g.ship.y - wp.y) < 60) i++; } else wp = { x: ziel.x, y: ziel.y };
    steuere(g, wp.x, wp.y, 2);
    g.step(); t += DT; maxSig = Math.max(maxSig, g.space.alarm ? g.space.alarm.sig : 0);
    if (Alarm.stufe(g) >= 2) { entdeckt = true; if (process.env.DBG) console.log('DBG', Math.round(t), g.ship.x, g.ship.y, Math.hypot(g.ship.vx, g.ship.vy), g.space.alarm.sig, g.space.alarm.grund, g.space.enemies.map((e) => Math.round(e.x) + '/' + Math.round(e.y) + ' pat ' + !!e.pat + ' ' + Math.round(Alarm.sensorRadius(g, e)))); break; }
    if (g.ship.scene !== 'splitter') break;
  }
  ticks(g, 2);
  const ms = mission(g);
  ok(!entdeckt, `Patrouillen und Minen ohne Alarm passiert (Grund ${g.space.alarm.grund} bei ${Math.round(g.ship.x)}/${Math.round(g.ship.y)}, höchste Signatur ${maxSig.toFixed(2)}, ${Math.round(t)} s)`);
  ok(ms.state === 'done' && ms.ausgang === 'erfolg', `Ziel erreicht: Mission beendet mit Ausgang ${ms.ausgang} nach ${Math.round(t)} s`);
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Schleichfahrt mit Entdeckung (Einsprung nach 5 s, Lerche kämpft sich durch)', () => {
  // ohne Patrouillen: Lärm löst Alarm aus, Jäger springen ein
  const { g, cs, r } = laborRaum(SCHLEICH, { loc: 'splitter', seed: 9 });
  ok(r.ok, 'Labor-Start');
  // Patrouillen entfernen (Szene ohne lebende Patrouille), Lerche macht Lärm
  g.space.enemies = [];
  platz(g, 600, 800, 0);
  lanze(g);
  ticks(g, A.laerm.takt + 0.5);
  g.ship.mount.stbd.charge = 1; space.weaponsFire(g, 'stbd');
  ok(Alarm.stufe(g) === 2, 'zweimal Waffenfeuer: alarmiert');
  ticks(g, 4.5);
  ok(g.space.enemies.filter((e) => e.tag === 'einsprung').length === 0, 'nach 4,5 s noch keine Jäger');
  ticks(g, 1);
  const e = g.space.enemies.filter((q) => q.tag === 'einsprung');
  ok(e.length === 2, `nach 5 s: zwei Jäger am Sprungpunkt (${e.length})`);
  ok(cs[0].inbox.some((m) => m.kind === 'oda' && /springen in 5 Sekunden ein/.test(m.text || '')), 'Ansage kam');
  // Entdeckung durch Patrouille mit Pilot-Bot: Lerche fliegt Voll auf die Patrouille zu
  const r2 = laborRaum(SCHLEICH, { loc: 'splitter', seed: 11 }); const q = r2.g;
  platz(q, 100, 800, 0);
  let alarmT = null; let beiAlarm = null;
  ticks(q, 120, () => { steuere(q, 2700, 800, 5); if (alarmT == null && Alarm.stufe(q) >= 2) { alarmT = q.time; beiAlarm = { n: q.space.enemies.length, frei: q.space.enemies.every((x) => !x.pat) }; } });
  ok(alarmT != null && q.space.alarm.grund === 'entdeckt', `volle Fahrt in die Patrouille: entdeckt (nach ${alarmT == null ? '–' : Math.round(alarmT - 0)} s)`);
  ok(beiAlarm && beiAlarm.n === 2 && beiAlarm.frei, 'alle Patrouillen greifen an (Strecke verlassen), kein Einsprung');
  ok(q.space.enemies.filter((x) => x.tag === 'einsprung').length === 0, 'ohne Einsprung, weil Patrouillen da waren');
  ok(q.errors === 0, 'keine Server-Fehler');
});

section('Rückzug: Notfallsprung beendet die Schleichfahrt mit Ausgang Rückzug', () => {
  const { g, r } = laborRaum(SCHLEICH, { loc: 'splitter' });
  ok(r.ok, 'Labor-Start');
  const kat = Katalog.load({});
  const u = kat.molekuele.unbemerkt_durchfliegen.umsetzungen[0];
  ok(JSON.stringify(u.vorlage).includes('{{rueckzug}}'), 'Vorlage kennt den Ausgang {{rueckzug}}');
  const buch = g.mission.rawBook ? g.mission.rawBook(g.labor.buch) : null;
  ok(buch && buch.ausgaenge && buch.ausgaenge.rueckzug && buch.ausgaenge.erfolg, 'Testbuch hat die Ausgänge erfolg und rueckzug');
  // ohne Rückzug-Ziel im Grobplan entfällt die Kante
  const buch0 = Labor.testBuch(kat, [{ key: SCHLEICH, rueckzug: false }], 'x0');
  const nexts0 = JSON.stringify(buch0.steps.map((s) => s.next));
  ok(!/"rueckzug"/.test(nexts0) && !buch0.ausgaenge.rueckzug, 'Szene ohne rueckzug im Grobplan: keine Rückzug-Kante, kein Ausgang');
  const nexts1 = JSON.stringify(buch.steps.map((s) => s.next));
  ok(/"complete":"rueckzug"/.test(nexts1) && /"name":"rueckzug"/.test(nexts1), 'Szene mit rueckzug: Kante „Prüfung rueckzug → complete rueckzug“');
  ticks(g, 2);
  ok(mission(g).state !== 'done', 'Mission läuft');
  // Notfallsprung (Pilot am Steuer)
  const p0 = g.players[0]; p0.console = 'helm'; p0.zone = 'ship';
  g.ship.reactorCtl.state = 'online';
  g.handleMessage({ inbox: [], send() {} }, { t: 'noop' });
  const err = require('../server/sim/sprung.js').notsprung(g);
  ok(!err, `Notfallsprung ausgelöst (${err || 'ok'})`);
  ticks(g, 2);
  const ms = mission(g);
  ok(ms.state === 'done' && ms.ausgang === 'rueckzug', `Mission beendet mit Ausgang rueckzug (${ms.state}/${ms.ausgang})`);
  const flags = g.mission.v || {};
  ok(!Object.keys(flags).some((k) => /_ziel$/.test(k) && flags[k]), 'Ziel nicht als erreicht gewertet');
  ok(g.errors === 0, 'keine Server-Fehler');
  // Prüfung rueckzug kennt die Zeit: ein früherer Notfallsprung zählt nicht für einen späteren Schritt
  const r3 = laborRaum(SCHLEICH, { loc: 'splitter', seed: 8 }); const q = r3.g;
  q.notsprungVon = 'splitter'; q.notsprungT = q.time - 100;
  ticks(q, 2);
  ok(mission(q).state !== 'done', 'ein Notfallsprung vor Beginn des Schritts zählt nicht');
});

section('Minenfeld im Labor: zünden bzw. abschießen, Einsprung', () => {
  const { g, cs, r } = laborRaum(MINEN, { loc: 'splitter' });
  ok(r.ok && g.space.minen.length === 6 && g.space.alarm.aktiv && !g.space.alarm.schleich, `Minenfeld: 6 Minen, Alarm an (${r.fehler || ''})`);
  heil(g);
  const m = g.space.minen[0];
  platz(g, m.x, m.y, 0);
  ticks(g, 0.2);
  ok(punkte(g) === 6 && g.space.minen.length === 5 && Alarm.stufe(g) === 2, 'Mine gezündet: 6 Punkte, Alarm');
  ticks(g, 6);
  ok(g.space.enemies.filter((e) => e.tag === 'einsprung').length === 2, 'Alarm ohne Patrouille: zwei Jäger sind eingesprungen');
  // zweite Partie: Mine abschießen
  const r2 = laborRaum(MINEN, { loc: 'splitter', seed: 6 }); const k = r2.g; heil(k);
  const mi = k.space.minen[0];
  platz(k, mi.x - 500, mi.y, 0);
  lanze(k);
  ok(k.space.minen.length === 5 && punkte(k) === 0 && Alarm.stufe(k) === 2, 'Mine abgeschossen: kein Schaden, Alarm');
  // Durchflug (Zone) beendet die Mission
  const r4 = laborRaum(MINEN, { loc: 'splitter', seed: 7 }); const q = r4.g;
  q.space.minen = [];
  platz(q, 1700, 800, 0);
  ticks(q, 3);
  ok(mission(q).state === 'done' && mission(q).ausgang === 'erfolg', 'zweite Hälfte der Szene erreicht: Mission durch');
});

section('Snapshot: Alarm und Minen kompakt, im Budget', () => {
  const NET = CONFIG.net; const ZIEL = NET.snapMax - NET.snapLuft;
  const { g } = raum();
  for (let i = 0; i < 4; i++) Alarm.patrouilleSetzen(g, { n: 1, x: 600 + i * 500, y: 300, x2: 600 + i * 500, y2: 1300, kind: 'korvette' });
  Alarm.an(g, { schleichfahrt: true });
  Alarm.minenSetzen(g, { n: 12, x: 1500, y: 800, radius: 1000 });
  g.ship.widescan.cd = 0; space.weaponsWidescan(g);
  for (let i = 0; i < 8; i++) space.spawnEnemy(g, i % 2 ? 'raider' : 'korvette', { x: 400 + i * 120, y: 1450 });
  for (const e of g.space.enemies) e.scanned = true;
  ticks(g, 1);
  const s = g.snapshot();
  const bytes = Buffer.byteLength(JSON.stringify(s));
  ok(bytes <= ZIEL, `Snapshot mit 12 Minen, 4 Patrouillen, 8 Gegnern: ${bytes} B (Ziel ≤ ${ZIEL})`);
  ok(s.space.mines.length <= 12 && s.space.mines.every((m) => Object.keys(m).join() === 'id,x,y'), 'Minen kompakt: { id, x, y } (s nur bei ohne Strom)');
  ok(s.space.al === undefined || s.space.al > 0, 'al nur wenn > 0');
  Alarm.ausloeser(g, 'mine');
  ok(g.snapshot().space.al === 2, 'al = 2 bei Alarm');
});

console.log(`\n${n - fails}/${n} bestanden${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
