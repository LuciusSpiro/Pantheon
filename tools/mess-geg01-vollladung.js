'use strict';
// GEG-01 C: Messung der Lanze-Vollladung vorher/nachher (Systemziel lenkt die Vollladung). Aus der Erkundung Trefferweg (mess-trefferweg.js) abgeleitet.
//   node tools/mess-geg01-vollladung.js [N=500]      (Umgebung N=...; Ausgabe: Markdown-Tabelle)
// Annahmen: Lanze feuert alle 9 s (Vollladung, Schaden 12, pierce 2); kein Spieler, keine Geometrie: Schiff steht 300 px hinter dem Gegner (Seite Heck, Antrieb zugewandt);
// Schild des Gegners an (die Vollladung durchschlägt ihn ohnehin ganz); Gegnerreparatur wird NICHT simuliert (Gegnerreparatur.tick läuft nicht), Gegnerwaffen und Schildregeneration
// laufen in Teilschritten von 0,5 s (Gsys.schildTick, nachholen, Gegnertod.tick). Tod = Reaktor-Countdown abgelaufen oder Prise-Übergang; "Antrieb" = Schuss, nach dem der Antrieb zerstört ist.
// Das Systemziel bleibt die ganze Messung gesetzt; ist das Ziel zerstört, trifft die Vollladung wieder die Mitte (vollladungZone).
// "vorher" = Stand 18a1f2d: Gsys.vollladungZone wird auf die alte Regel (immer 'mitte') gesetzt; "nachher" = die echte Funktion.
// Zahl der Spieler (Crew 2 oder 3): die Crewgröße skaliert nur das Feuerintervall der Gegner, nicht ihre Systeme (test-direkttreffer-gegner.js, Crew 1 und 3) -> die Werte hängen nicht davon ab.
const fs = require('fs'), os = require('os'), path = require('path');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gtod = require('../server/sim/gegnertod.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mess-geg01-'));
const g = new Game({ noStore: true, worlds: false, seed: 77, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
const c = { inbox: [], send() {}, sendRaw() {} };
g.addConnection(c);
g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'E', color: 0 });
g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
g.handleMessage(c, { t: 'ready', ready: true });
if (g.arena) g.arena.nextAt = null;
g.god = true;
space.enterScene(g, 'rabenpass', {});
g.space.enemies = []; g.space.projectiles = [];
g.emit = () => {}; g.oda = () => {}; g.missionEvent = () => {};

const ECHT = Gsys.vollladungZone;
const DT = 9, MAXN = 40;
const OPTS = () => ({ pierce: 2, durchschlag: 'zone', vollladung: true, angriff: true });
function lauf(kind, ziel) {
  g.space.enemies = [];
  const e = space.spawnEnemy(g, kind, { x: 1500, y: 1100, angle: 0 }); e.angle = 0;
  g.ship.x = e.x - 300; g.ship.y = e.y; g.ship.target = e.id; e.scanned = true;
  if (ziel) g.ship.zielsystem = ziel; else delete g.ship.zielsystem;
  let antrieb = null, tod = null;
  for (let i = 1; i <= MAXN; i++) {
    let gestorben = false;
    for (let w = 0; w < DT - 1e-9; w += 0.5) { const h = Math.min(0.5, DT - w); g.time += h; Gsys.schildTick(g, e, h); Gsys.nachholen(g, e); if (Gtod.tick(g, e, h)) { gestorben = true; break; } }
    if (gestorben) { tod = i; break; }
    space.damageEnemy(g, e, 12, g.ship.x, g.ship.y, OPTS());
    if (antrieb == null && e.sys.antrieb && e.sys.antrieb.z === 'broken') antrieb = i;
    if (!g.space.enemies.includes(e)) { tod = i; break; }
  }
  return { antrieb, tod };
}
const N = Number(process.env.N || process.argv[2] || 500);
const KL = [['raider', 'Jäger'], ['korvette', 'Korvette'], ['fregatte', 'Fregatte'], ['kreuzer', 'Kreuzer'], ['frachter', 'Transporter']];
const ZIELE = [[null, 'ohne Ziel'], ['antrieb', 'Ziel Antrieb'], ['reaktor', 'Ziel Reaktor (von hinten nicht anwählbar, solange Heck-Systeme leben)']];
const mw = (a) => { const v = a.filter((x) => x != null); return v.length ? (v.reduce((s, x) => s + x, 0) / v.length) : null; };
const f = (x) => x == null ? '-' : x.toFixed(2);
console.log('| Klasse | Ziel | Stand | Schüsse bis Antrieb zerstört | Anteil Antrieb | Schüsse bis Tod | Zeit bis Tod (s) |');
console.log('|---|---|---|---|---|---|---|');
for (const [k, kn] of KL) for (const [z, zn] of ZIELE) for (const stand of ['vorher', 'nachher']) {
  Gsys.vollladungZone = stand === 'vorher' ? () => 'mitte' : ECHT;
  const ra = [], rt = [];
  for (let i = 0; i < N; i++) { const r = lauf(k, z); ra.push(r.antrieb); rt.push(r.tod); }
  const t = mw(rt);
  console.log('| ' + kn + ' | ' + zn + ' | ' + stand + ' | ' + f(mw(ra)) + ' | ' + Math.round(ra.filter((x) => x != null).length / N * 100) + ' % | ' + f(t) + ' | ' + (t == null ? '-' : (t * DT).toFixed(0)) + ' |');
}
Gsys.vollladungZone = ECHT;
