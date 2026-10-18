'use strict';
// PAN-01 Paket C (Abnahme 11): Feuerkraft bei 3, 5, 7 und 9 Energiewaffen mit GLEICHEM Ladepool. Deterministisch (feste Attrappen, kein Bot-Rauschen).
//   node tools/pan01-feuerkraft-messung.js [--pool 4|5|6] [--sek 180] [--verteilung reihum|best|ziel] [--einseitig] [--noheat]   (ab Pool 6 ohne Hitze, sonst überhitzen die Waffen bei Energie 4)
// Aufbau: Die Lerche steht still, je Richtung (Bug, Backbord, Steuerbord) steht eine unzerstörbare Attrappe ohne Schilde im Bogen aller Waffen dieser Richtung, dazu ein Jäger-
// Attrappe im Nahbereich für den Abwehrturm. Die „Ops“ feuert jede Waffe, sobald sie bereit ist (Lanzen werden voll aufgeladen). Gemessen wird der Schaden an den Attrappen
// (game.stats.waffenSchaden) je Zeitfenster: Anfangsstoß (0–10 s, volle Rohre), Dauerfeuer (60–180 s). Verteilung: reihum (Standard des Spiels) oder best (Punkte auf die
// Waffen mit dem meisten Schaden je Ladepunkt: die Obergrenze, die ein guter Ops erreicht).
// Plätze nach Zahl (Reihenfolge 8 4 6 7 9 5 1 3 2): 8 Lanze, Seiten Standardbatterie, 5 Standardkanone, 2 Abwehrturm (Energie). Der Pool ändert sich nicht (Energie + 2).
const path = require('path');
const fs = require('fs');
const os = require('os');
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const Ausbau = require('../server/sim/ausbau.js');
const Maps = require('../shared/maps.js');

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const POOL = Number(arg('--pool', 4)), SEK = Number(arg('--sek', 180)), VERT = arg('--verteilung', 'reihum');
const DT = 1 / CONFIG.tickHz;
const EINSEITIG = argv.includes('--einseitig');   // Gegner nur an einer Seite: Waffen auf der anderen Seite und am Bug haben kein Ziel (Magazin darf trotzdem keine Punkte stilllegen)
if (POOL >= 6 || argv.includes('--noheat')) CONFIG.power.heatAt4 = 0;   // Waffen-Energie 4 überhitzt nach 12,5 s (Erkundung PAN-01): für die Messung aus
const PRIO = [8, 4, 6, 7, 9, 5, 1, 3, 2];
const ART = (p) => (p === 8 ? 'lanze' : p === 5 ? 'standardkanone' : p === 2 ? 'abwehrturm' : 'standardbatterie');
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

function messe(k) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pan01-feuerkraft-'));
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F0', name: 'F0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = true; g.players[0].console = 'weapons';
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = sh.vy = 0;
  // Bestückung: die ersten k Plätze
  const wahl = PRIO.slice(0, k);
  const stufe = Math.max(0, ...wahl.map((p) => Maps.waffenplatz(p).stufe));
  Ausbau.setStufe(g, stufe);
  for (const p of Maps.WAFFENPLAETZE) if (stufe >= p.stufe) Waffen.bestuecken(g, p.platz, wahl.includes(p.platz) ? ART(p.platz) : 'leer');
  // Pool: Energie + 2 = POOL -> Waffen-Energie POOL − 2
  const wp = POOL - 2;   // Reaktor 8: zwei Module + sechs Energie für die Hauptsysteme; mehr Waffenenergie geht von Antrieb und Schilden ab (Standard 2/2/2)
  g.ship.powerIntent = { engines: Math.max(0, Math.floor((6 - wp) / 2)), shields: Math.max(0, 6 - wp - Math.floor((6 - wp) / 2)), weapons: wp };
  Object.assign(g.ship.power, g.ship.powerIntent);
  const ids = Waffen.energieMounts(g).map((a) => a.id);
  // Attrappen (still, ohne Schilde, unzerstörbar)
  g.space.enemies = []; g.space.projectiles = [];
  const mk = (kind, dx, dy) => { const e = space.spawnEnemy(g, kind, { x: sh.x + dx, y: sh.y + dy, facing: Math.PI }); e.shields = e.shields.map(() => 0); e.hp = e.hpMax = 1e9; e.pin = { x: e.x, y: e.y, angle: e.angle }; return e; };
  if (EINSEITIG) { mk('korvette', 0, 300); mk('raider', -120, 90); }   // nur Steuerbord (plus Jäger für den Abwehrturm)
  else { mk('korvette', 400, 0); mk('korvette', 0, -300); mk('korvette', 0, 300); mk('raider', -120, 90); }
  const pin = () => { sh.vx = sh.vy = 0; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; for (const e of g.space.enemies) { e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.hp = 1e9; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; e.tele = null; } };
  const sprung = (id) => { const w = Waffen.waffeAn(g, id); return w && w.art === 'lanze'; };
  // Verteilung wählen
  const verteile = () => {
    if (VERT === 'ziel') {   // Ops verteilt gezielt: nur auf Waffen, die ein Ziel im Bogen haben (einseitig: Steuerbord), nach Schaden je Punkt
      const rate = (id) => { const w = Waffen.waffeAn(g, id); return w.stoss / w.ladekosten; };
      const mc = (id) => Waffen.mountCfg(g, id);
      const treffen = ids.filter((id) => (EINSEITIG ? mc(id).facing === 90 : true)).sort((a, b) => rate(b) - rate(a));
      const want = {}; for (const id of ids) want[id] = 0; let left = POOL;
      for (const id of treffen) { const q = Math.min(CONFIG.spaceM3.allocMax, left); want[id] = q; left -= q; }
      g.ship.wAllocIntent = want;
    } else if (VERT === 'best') {
      const rate = (id) => { const w = Waffen.waffeAn(g, id); return w.stoss / w.ladekosten; };
      const order = ids.slice().sort((a, b) => rate(b) - rate(a));
      const want = {}; let left = POOL; for (const id of order) { const q = Math.min(CONFIG.spaceM3.allocMax, left); want[id] = q; left -= q; }
      g.ship.wAllocIntent = want;
    } else g.ship.wAllocIntent = Waffen.standardVerteilung(g);
  };
  verteile();
  const fenster = [[0, 10], [10, 60], [60, SEK]]; const sum = fenster.map(() => 0);
  let lastGes = 0, t = 0;
  const zaehl = () => ((g.stats.waffenSchaden || {}).gesamt || 0);
  // Start: volle Rohre (Magazindeckel begrenzt den Vorrat bei vielen Waffen)
  const vorrat0 = Waffen.vorrat(g);
  while (t < SEK) {
    pin();
    // Ops: jede bereite Waffe feuern, Lanzen voll aufladen
    for (const id of ids) {
      const m = g.ship.mount[id]; const w = Waffen.waffeAn(g, id);
      if (w.art === 'lanze') {
        if (m.charging && m.power >= 1) Waffen.weaponsCharge(g, id, false);
        else if (!m.charging && m.charge >= 1) Waffen.weaponsCharge(g, id, true);
      } else if (m.charge >= 1 && !(m.salvo > 0)) Waffen.weaponsFire(g, id);
    }
    g.step(); t += DT;
    const z = zaehl(); const d = z - lastGes; lastGes = z;
    fenster.forEach((f, i) => { if (t > f[0] && t <= f[1]) sum[i] += d; });
  }
  const dauer = (f, i) => sum[i] / (Math.min(f[1], SEK) - f[0]);
  return { k, ids, stufe, anfang: sum[0], vorrat0, rate0: dauer(fenster[0], 0), rate1: dauer(fenster[1], 1), rate2: dauer(fenster[2], 2), alloc: ids.map((id) => g.ship.mount[id].alloc).join(',') };
}

console.log(`PAN-01 C Feuerkraft: Pool ${POOL} Ladepunkte (Energie ${POOL - 2} + 2), Verteilung ${VERT}, ${SEK} s, feste Attrappen; Magazindeckel ${Katalog.MAGAZINDECKEL.stossMax} (1,5 × ${Katalog.MAGAZINDECKEL.stossStart})`);
console.log('| Energiewaffen | Plätze | Anfangsstoß (Vorrat) | Schaden 0–10 s | Schaden/s 10–60 s | Schaden/s 60–180 s | Faktor Dauerfeuer gegen 3 Waffen |');
console.log('|---|---|---|---|---|---|---|');
const ergeb = [3, 5, 7, 9].map(messe);
for (const r of ergeb) console.log(`| ${r.k} | ${PRIO.slice(0, r.k).join(' ')} | ${f1(r.vorrat0)} | ${f1(r.anfang)} | ${f2(r.rate1)} | ${f2(r.rate2)} | ${f2(r.rate2 / ergeb[0].rate2)}× |`);
console.log('Verteilung am Ende (Ladepunkte je Waffe in Reihenfolge ' + ergeb[3].ids.join(' ') + '): ' + ergeb[3].alloc);
