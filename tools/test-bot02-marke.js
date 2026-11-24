'use strict';
// BOT-02 B5: nav.kurs / nav.abstand ziel marke = der Positions-Marker des Captains (ship.markers.captain, captain.marker; Sh+X loescht ihn), sonst das Anzeigeziel (ship.capZiel).
//   1. Marker gesetzt: der Bot faehrt hin und kommt an (zwei Seeds)
//   2. Marker und Anzeigeziel: der Marker gewinnt; nur Anzeigeziel: wie bisher (Objekt); nichts: kein_ziel; ziel bleibt die Ops-Marke; der taktische Marker zaehlt nicht
//   3. Marker weg waehrend der Fahrt (Sh+X): der Befehl endet (ziel_weg), der Bot haelt an; versetzter Marker: der Bot folgt
//   4. nav.abstand ohne ziel: derselbe Marker (Abstand am Punkt); danach Anzeigeziel
//   node tools/test-bot02-marke.js
//   Mutationsproben: BOT_MARKE_MUT=<name> (marker_ignorieren | anzeigeziel_vor_marker | marker_eingefroren | marker_weg_ignorieren) muss rot sein
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const space = require('../server/sim/space.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const Navziel = require('../server/bots/navziel.js');
const Navigation = require('../server/bots/befehle/navigation.js');
const { STOP } = require('../server/bots/kern.js');

const MUT = process.env.BOT_MARKE_MUT || '';
const ohneMarker = (g, f) => { const m = g.ship.markers.captain; g.ship.markers.captain = null; try { return f(); } finally { g.ship.markers.captain = m; } };
if (MUT === 'marker_ignorieren') { const alt = Navziel.aufloesen; Navziel.aufloesen = (g, nm) => ohneMarker(g, () => alt(g, nm)); }
if (MUT === 'anzeigeziel_vor_marker') { const alt = Navziel.aufloesen; Navziel.aufloesen = (g, nm) => (nm === 'marke' && g.ship.capZiel ? ohneMarker(g, () => alt(g, nm)) : alt(g, nm)); }
if (MUT === 'marker_eingefroren') { const alt = Navziel.standort; Navziel.standort = (g, z, f) => { if (z && z.art === 'punkt') { z.fest = z.fest || Object.assign({}, g.ship.markers.captain); return { x: z.fest.x, y: z.fest.y, typ: 'marke' }; } return alt(g, z, f); }; }
if (MUT === 'marker_weg_ignorieren') { const alt = Navziel.standort; Navziel.standort = (g, z, f) => { if (z && z.art === 'punkt') { z.letzt = g.ship.markers.captain || z.letzt; return { x: z.letzt.x, y: z.letzt.y, typ: 'marke' }; } return alt(g, z, f); }; }

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botmarke-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function partie(o) {
  o = o || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: o.seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.botZufall = (() => { let a = 42; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  BotSpieler.botHinzufuegen(g, null, 'navigation');
  BotSpieler.botHinzufuegen(g, null, 'technik');
  g.lobbyOpts.startMission = 'arena_space';
  g.handleMessage(c, { t: 'ready', ready: true });
  const P = { g, c, uhr: 1e12, fest: [] };
  if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  lauf(P, 30, () => Station.stationOf(bot(P)) === 'helm'); lauf(P, 1);
  return P;
}
function tick(P) {
  const g = P.g;
  for (const e of P.fest) if (g.space.enemies.includes(e)) { e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; e.fireT = -999; e.shields = [0, 0, 0, 0]; }
  g.space.projectiles = g.space.projectiles.filter((q) => q.kind === 'torpedo' || q.waffe || (q.kind !== 'enemy' && q.kind !== 'emp'));
  g.step();
  if (g.wantsSnapshot()) g.snapshot();
}
const lauf = (P, sec, bis) => { const t1 = P.g.time + sec; while (P.g.time < t1) { tick(P); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const bot = (P) => P.g.players.find((p) => p.bot && p.rolle === 'navigation');
const agent = (P) => Lauf.agent(P.g, bot(P));
const gegner = (P, x, y) => { const e = space.spawnEnemy(P.g, 'korvette', { x, y, facing: 0 }); e.pin = { x: e.x, y: e.y, angle: e.angle }; P.fest.push(e); return e; };
const capZiel = (g, id) => { g.ship.capZiel = { id, scene: g.ship.scene }; };
const marker = (g, x, y) => { g.ship.markers.captain = x == null ? null : { x, y }; };   // wie captain.marker (space.setMarker): Position im Schiffsraum
function setze(P, x, y, angle) { const s = P.g.ship; s.docked = false; s.dockedAt = null; s.dockArmed = true; s.x = x; s.y = y; s.angle = angle || 0; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.stage = STOP; s.helm.autoStop = false; lauf(P, 1.5); }
function befehl(P, name, args) {
  P.uhr += 5000;
  const m = { t: 'bot.befehl', an: 'navigation', befehl: name, quelle: 'menu' }; if (args !== undefined) m.args = args;
  const n0 = P.c.inbox.length; const echt = Date.now; Date.now = () => P.uhr;
  try { P.g.handleMessage(P.c, m); } finally { Date.now = echt; }
  const a = P.c.inbox.slice(n0).filter((x) => x.t === 'bot.antwort');
  return a.length === 1 ? a[0].textId : 'ANTWORTEN:' + a.length;
}
const dm = (g) => Math.hypot(g.ship.x - g.ship.markers.captain.x, g.ship.y - g.ship.markers.captain.y);
const d2 = (g, x, y) => Math.hypot(g.ship.x - x, g.ship.y - y);
const KURS_AN = 200;

section('1 Marker gesetzt: der Bot faehrt hin und kommt an');
for (const [seed, dx, dy] of [[7, 700, 0], [11, -500, 600]]) {
  const P = partie({ seed }); const { g } = P;
  setze(P, 1100, 1500, 0);
  const mx = g.ship.x + dx, my = g.ship.y + dy; marker(g, mx, my);
  const t0 = g.time; const antwort = befehl(P, 'nav.kurs', { ziel: 'marke' });
  const da = lauf(P, 80, () => agent(P).befehlGrund === 'angekommen');
  ok(antwort === 'nav.kurs.ok' && da && d2(g, mx, my) <= KURS_AN, `Seed ${seed}: ok, angekommen nach ${(g.time - t0).toFixed(1)} s, ${d2(g, mx, my).toFixed(0)} px vom Marker (Ankunft <= ${KURS_AN})`);
  lauf(P, 10);
  ok(g.ship.speed < 10 && !agent(P).absicht.befehl && g.errors === 0, `danach steht das Schiff (${g.ship.speed.toFixed(1)} px/s), Absicht beendet, keine Fehler`);
}

section('2 Marker gegen Anzeigeziel gegen nichts');
{
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  ok(befehl(P, 'nav.kurs', { ziel: 'marke' }) === 'nav.kurs.abgelehnt.kein_ziel' && !agent(P).absicht.befehl, 'nichts gesetzt: kein_ziel, keine Absicht');
  const e = gegner(P, g.ship.x, g.ship.y + 800); capZiel(g, e.id);
  ok(befehl(P, 'nav.kurs', { ziel: 'marke' }) === 'nav.kurs.ok' && agent(P).absicht.befehl.ziel.art === 'objekt' && agent(P).absicht.befehl.ziel.id === e.id, 'nur Anzeigeziel: wie bisher (Objekt)');
  agent(P).befehlVerwerfen('test');
  marker(g, g.ship.x + 700, g.ship.y);
  ok(befehl(P, 'nav.kurs', { ziel: 'marke' }) === 'nav.kurs.ok' && agent(P).absicht.befehl.ziel.art === 'punkt', 'Marker und Anzeigeziel: der Marker gewinnt');
  lauf(P, 40, () => agent(P).befehlGrund === 'angekommen');
  ok(dm(g) <= KURS_AN && d2(g, e.x, e.y) > 500, `der Bot ist am Marker (${dm(g).toFixed(0)} px), nicht am Anzeigeziel (${d2(g, e.x, e.y).toFixed(0)} px)`);
  marker(g, null); g.ship.capZiel = null; agent(P).befehlVerwerfen('test');
  const op = gegner(P, g.ship.x + 900, g.ship.y); g.ship.target = op.id;
  ok(befehl(P, 'nav.kurs', { ziel: 'marke' }) === 'nav.kurs.abgelehnt.kein_ziel' && befehl(P, 'nav.kurs', { ziel: 'ziel' }) === 'nav.kurs.ok', 'nur Ops-Marke: marke kein_ziel, ziel ok (ziel bleibt die Ops-Marke)');
  agent(P).befehlVerwerfen('test');
  g.ship.markers.tactical = { x: g.ship.x + 500, y: g.ship.y };
  ok(Navziel.aufloesen(g, 'marke') === null, 'nur der taktische Marker (Ops): zaehlt nicht, marke bleibt kein_ziel');
  marker(g, g.ship.x, g.ship.y + 800);
  ok(Navziel.aufloesen(g, 'marke').art === 'punkt' && Navziel.standort(g, { art: 'punkt' }).y === g.ship.y + 800, 'taktischer und Captain-Marker: marke ist der Captain-Marker');
  ok(Object.keys(Navigation).length === 7 && g.errors === 0, 'Registry unveraendert (sieben Befehle), keine Fehler');
}

section('3 Marker weg waehrend der Fahrt / versetzt');
{
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  marker(g, g.ship.x + 1400, g.ship.y);
  ok(befehl(P, 'nav.kurs', { ziel: 'marke' }) === 'nav.kurs.ok', 'Marker 1400 px voraus: ok');
  lauf(P, 5);
  ok(g.ship.speed > 20, `unterwegs (${g.ship.speed.toFixed(0)} px/s)`);
  marker(g, null);   // Sh+X
  lauf(P, 3);
  ok(agent(P).befehlGrund === 'ziel_weg' && !agent(P).absicht.befehl && agent(P).absicht.standard, 'Marker geloescht: der Befehl endet (ziel_weg), Standardverhalten');
  lauf(P, 25, () => g.ship.speed < 3);
  ok(g.ship.speed < 3 && g.errors === 0, `der Bot haelt an (${g.ship.speed.toFixed(1)} px/s)`);
}
{
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  marker(g, g.ship.x + 900, g.ship.y);
  befehl(P, 'nav.kurs', { ziel: 'marke' }); lauf(P, 3);
  const nx = g.ship.x, ny = g.ship.y + 900; marker(g, nx, ny);   // der Captain versetzt den Marker
  const da = lauf(P, 80, () => agent(P).befehlGrund === 'angekommen');
  ok(da && d2(g, nx, ny) <= KURS_AN, `Marker versetzt: der Bot folgt dem neuen Marker (${d2(g, nx, ny).toFixed(0)} px)`);
}

section('4 nav.abstand ohne ziel');
{
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  const e = gegner(P, g.ship.x + 1500, g.ship.y); capZiel(g, e.id);
  marker(g, g.ship.x, g.ship.y + 800);
  ok(befehl(P, 'nav.abstand', {}) === 'nav.abstand.ok' && agent(P).absicht.befehl.ziel.art === 'punkt', 'ohne ziel: der Marker gewinnt vor dem Anzeigeziel');
  lauf(P, 60, () => Math.abs(dm(g) - 400) < 80);
  ok(Math.abs(dm(g) - 400) < 120 && g.errors === 0, `der Bot haelt den Standardabstand am Punkt (${dm(g).toFixed(0)} px, Standard 400)`);
  marker(g, null); lauf(P, 3);
  ok(agent(P).befehlGrund === 'ziel_weg' && !agent(P).absicht.befehl, 'Marker weg: der Abstandsbefehl endet (ziel_weg)');
  ok(befehl(P, 'nav.abstand', {}) === 'nav.abstand.ok' && agent(P).absicht.befehl.ziel.id === e.id, 'ohne Marker: Anzeigeziel (Standardwert wie bisher)');
}

console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
