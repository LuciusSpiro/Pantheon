'use strict';
// GEG-01 Abnahme 6: Messung "Reaktorbruch bis Schiff weg" unter Beschuss (Treffer halbieren den Reaktor-Countdown, Paket B).
//
// Start:   node tools/mess-geg01-countdown.js
//          N=200 OUT=C:/pfad/messung-countdown.json node tools/mess-geg01-countdown.js      (N = Läufe je Fall, OUT = Rohdaten-JSON; ohne OUT nur Konsole)
//          SEED=7 (Zufallssaat der Trefferverteilung), PHASE=0 (nur der Satz "erster Schuss genau beim Bruch" statt beider Sätze)
//
// Was gemessen wird: Zeit in s vom Reaktorbruch (t = 0) bis
//   - Gegner: Gegnertod.tick meldet true (= Aufruf von space.enemyDown im Spiel; Treffer unter reaktorTod.restGrenze setzen Rest 0, Tod im nächsten Tick),
//   - Lerche: reaktortod.tod (ship.schiffZerstoert; ein Treffer unter restGrenze löst es sofort aus).
// Dazu: Zahl der Treffer, die den laufenden Countdown halbiert haben ("Treffer bis Tod"; gezählt über einen Wrapper auf Gegnertod.treffer / Reaktortod.treffer).
// Echte Module (server/sim/*.js) aus diesem Worktree, ein Game-Objekt als Hülle. Es wird nichts ins Repo geschrieben.
//
// Beschussarten (Treffer je Zeitpunkt; echter Weg: space.damageEnemy bzw. space.shipHit, dazu für die Streubatterie schiffswaffen.streuExplosion):
//   keine        kein Beschuss (Kontrolle: Start 20 s)
//   lanze        Lanze Teilladung (Schaden 3 + 9 × 0,6), ein Treffer alle 9 s
//   lanzeVoll    Lanze Vollladung (Schaden 12, durchschlag zone), ein Treffer alle 9 s
//   batterie     Standardbatterie, ein Treffer (2,66) alle 3,9 s
//   streu        Streubatterie, eine Salve = 3 Granaten im Abstand salvoGap (0,4 s); Intervall 12 s (Katalog ladekosten 12, 1 Punkt), Zeitpunkt = Explosion.
//                Gegner: echte Explosionen (streuExplosion), Fenster-Regel: Granate 1 = 1 Treffer, Granate 2 und 3 = je 2 Treffer (Schaden + Durchschlag) = 5 Treffer je Salve.
//                Lerche: dieselbe Trefferfolge (5 Treffer je Salve) als shipHit
//   batterie+lanzeVoll   Batterie alle 3,9 s plus Lanze-Vollladung alle 9 s gleichzeitig
//   Nur Lerche zusätzlich: gegnerfeuer22 / gegnerfeuer17 (ein Treffer alle 2,2 s bzw. 1,7 s = crewScaling.enemyFireInterval solo / 2-3 Spieler), burst (Sperrfeuer: 3 Treffer
//                im Abstand 0,25 s alle 3 s, spaceS2b.sperrfeuer).
//   Zusatz "+5s": derselbe Beschuss, aber der erste Schuss fällt frühestens 5 s nach dem Bruch.
//
// Zwei Sätze: "zufall" = Phase des ersten Schusses gleichverteilt in [0, Intervall) (Beschuss läuft schon, der Bruch fällt irgendwo in den Takt; Standard der Tabelle),
//             "null"   = der erste Schuss fällt genau auf den Bruchzeitpunkt (+ Verzögerung); ungünstigster Fall für das Schiff, entspricht der Kopfrechnung.
//
// Annahmen und Grenzen:
//   - Kein Spieler, keine Zielgeometrie, keine Reichweite/Bögen/Energie: die Waffen treffen jeden Zyklus sicher und im angegebenen festen Intervall (Annahme!).
//     Echte Spieler treffen seltener (Ausweichen, Bogen, Schild) oder öfter (mehrere Waffen, Spieler im Mehrspielerbetrieb feuern parallel).
//   - Intervalle sind Annahmen aus config/Katalog (Batterie 3,9 s laut Briefing, real 3,9 + 0,2 s Nachlauf; Lanze 9 s; Streu 12 s); Aufladung, Energiezuteilung und Zielwechsel fehlen.
//   - Reparatur ist nicht simuliert (Gegner: systemModell.reparatur.reaktor = false; Lerche: kein Spieler, der E hält, kein Notsprung).
//   - Sim-Takt dt = 1/tickHz (30 Hz, 0,033 s): Tod wird tick-genau gemessen (Auflösung 0,033 s). Gegner und Lerche laufen nicht über game.step, sondern über die Aufrufe
//     Gegnertod.tick(dt) / Reaktortod.update(dt), die auch game.step bzw. updateEnemies aufruft. Bewegung, Feuer, Fluchtverhalten der Gegner fehlen.
//   - Schilde der Gegner stehen auf 0 (jeder Treffer trifft Systeme; Schilde ändern an der Halbierung nichts, sie zählt auch bei gehaltenem Treffer). Quelle der Treffer: zufällige Seite.
//     Stirbt ein Gegner durch Systemzerstörung vor dem Countdown-Ende, wird das als "tot durch Systeme" gezählt und mit der Zeit in die Statistik genommen (Spalte "Systeme").
//   - Lerche: Schilde 0 je Treffer, Sektor zufällig 0..3, Gottmodus aus (reaktortod.gilt). Verlustauslösung (space.verlustAusloesen) wird ausgestubt: gemessen wird nur der Zeitpunkt.
//   - Spielerzahl: der Countdown und die Gegnersysteme skalieren nicht mit der Crew (crewScaling kennt nur enemyFireInterval: solo 2,2 s, 2-3 Spieler 1,7 s). Die Messung gilt damit für
//     1, 2 und 3 Spieler gleich; nur die Eingangsgröße "Treffer pro Sekunde" hängt vom Spielerverhalten ab und ist als Beschussart gegeben.
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = path.join(__dirname, '..');
process.chdir(R);
const CONFIG = require(R + '/shared/config.js');
const { Game } = require(R + '/server/game.js');
const space = require(R + '/server/sim/space.js');
const Gsys = require(R + '/server/sim/gegnersystem.js');
const Gtod = require(R + '/server/sim/gegnertod.js');
const Rtod = require(R + '/server/sim/reaktortod.js');
const Waffen = require(R + '/server/sim/schiffswaffen.js');
const I = require(R + '/server/sim/interior.js');
const Katalog = require(R + '/shared/schiffskatalog.js');

const N = Number(process.env.N || 200);
const OUT = process.env.OUT || null;
const SEED = Number(process.env.SEED || 1);
const NUR_NULL = process.env.PHASE === '0';
const DT = 1 / CONFIG.tickHz;
const CAP = 120;   // s, Abbruch (Schiff "geht nie unter")

// ---- Zufall (mulberry32) für Phase und Trefferseite
let rs = SEED >>> 0;
function rnd() { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

// ---- Spiel-Hülle
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mess-geg01-'));
const g = new Game({ noStore: true, worlds: false, seed: 77, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
const c = { inbox: [], send() {}, sendRaw() {} };
g.addConnection(c);
g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'M', color: 0 });
g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
g.handleMessage(c, { t: 'ready', ready: true });
if (g.arena) g.arena.nextAt = null;
space.enterScene(g, 'rabenpass', {});
g.space.enemies = []; g.space.projectiles = [];
g.emit = () => {}; g.oda = () => {}; g.missionEvent = () => {};
space.verlustAusloesen = () => {};   // Tod der Lerche: nur der Zeitpunkt zählt (reaktortod.tod ruft die Naht über das Modul-Objekt)

// Zähler: Treffer, die einen laufenden Countdown halbiert haben
let halbiert = 0;
const gtT = Gtod.treffer, rtT = Rtod.treffer;
Gtod.treffer = (game, e) => { const z = e.rt; const lief = z && z.rest != null && Gsys.idVon(e, 'reaktor') && e.sys[Gsys.idVon(e, 'reaktor')].z === 'broken'; gtT(game, e); if (lief) halbiert++; };
Rtod.treffer = (game) => { const lief = !!game.ship.reaktorCountdown; rtT(game); if (lief) halbiert++; };

// ---- Beschussmuster: Liste von Quellen { iv (Intervall), hits: [[Versatz s, Wirkung]] }
const M_LANZE = { dmg: 3 + 9 * 0.6, opts: { pierce: 2, angriff: true } };
const M_LVOLL = { dmg: 12, opts: { pierce: 2, durchschlag: 'zone', vollladung: true, angriff: true } };
const M_BAT = { dmg: 2.66, opts: { angriff: true } };
const STREU = Katalog.waffe('streubatterie');
const STREU_IV = STREU.ladekosten;   // 12 s (1 Punkt)
const GAP = STREU.salvoGap || 0.4;
const MUSTER = {
  keine: [],
  lanze: [{ iv: 9, hits: [[0, { w: M_LANZE }]] }],
  lanzeVoll: [{ iv: 9, hits: [[0, { w: M_LVOLL }]] }],
  batterie: [{ iv: 3.9, hits: [[0, { w: M_BAT }]] }],
  streu: [{ iv: STREU_IV, hits: [0, 1, 2].map((k) => [k * GAP, { streu: true }]) }],
  'batterie+lanzeVoll': [{ iv: 3.9, hits: [[0, { w: M_BAT }]] }, { iv: 9, hits: [[0, { w: M_LVOLL }]] }],
};
const MUSTER_LERCHE = Object.assign({}, MUSTER, {
  gegnerfeuer22: [{ iv: 2.2, hits: [[0, { w: M_BAT }]] }],
  gegnerfeuer17: [{ iv: 1.7, hits: [[0, { w: M_BAT }]] }],
  burst: [{ iv: 3, hits: [0, 1, 2].map((k) => [k * 0.25, { w: { dmg: CONFIG.spaceS2b.sperrfeuer.damage, opts: {} } }]) }],
});
// Ereignisliste (Zeit, Wirkung) bis CAP; phase 'zufall' | 'null'; start = Verzögerung des ersten Schusses
function ereignisse(muster, phase, start) {
  const ev = [];
  for (const q of muster) {
    const t0 = start + (phase === 'zufall' ? rnd() * q.iv : 0);
    for (let t = t0; t < CAP + 1; t += q.iv) for (const [dv, w] of q.hits) ev.push({ t: t + dv, w });
  }
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

// ---- Läufe
const ABST = 300;
function treffeGegner(e, w) {
  const a = [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(rnd() * 4)];
  const sx = e.x + Math.cos(a) * ABST, sy = e.y + Math.sin(a) * ABST;
  for (let i = 0; i < e.shields.length; i++) e.shields[i] = 0;
  space.damageEnemy(g, e, w.dmg, sx, sy, Object.assign({}, w.opts));
}
function laufGegner(kind, muster, phase, start) {
  g.space.enemies = []; g.space.projectiles = [];
  const e = space.spawnEnemy(g, kind, { x: 1500, y: 1100, angle: 0 }); e.angle = 0;
  for (let i = 0; i < e.shields.length; i++) e.shields[i] = 0;
  Gtod.brechen(g, e, 'reaktor');
  if (!e.rt || e.rt.rest == null) return { fehler: 'kein Countdown' };
  const ev = ereignisse(muster, phase, start);
  halbiert = 0; let i = 0; let k = 0;
  const maxK = Math.round(CAP / DT);
  while (k < maxK) {
    const tNext = (k + 1) * DT;
    // Treffer, die vor dem Ende dieses Ticks fallen (Takt: erst Treffer, dann tick, wie Waffen vor updateEnemies)
    while (i < ev.length && ev[i].t <= tNext - 1e-9) {
      g.time += 0; // Spielzeit läuft unten weiter
      if (ev[i].w.streu) Waffen.streuExplosion(g, { x: e.x, y: e.y, dmg: STREU.schaden });
      else treffeGegner(e, ev[i].w.w);
      i++;
      if (!g.space.enemies.includes(e)) return { t: +(ev[i - 1].t).toFixed(4), treffer: halbiert, grund: 'systeme' };
    }
    g.time += DT; k++;
    if (Gtod.tick(g, e, DT)) return { t: +(k * DT).toFixed(4), treffer: halbiert, grund: 'countdown' };
  }
  return { t: null, treffer: halbiert, grund: 'nie' };
}
function laufLerche(muster, phase, start) {
  g.god = false;
  const sh = g.ship;
  sh.schiffZerstoert = false; g.zerstoertOffen = null; Rtod.zuruecksetzen(g);
  I.damageSystem(g, 'reactor', 'ok');
  I.damageSystem(g, 'reactor', 'broken');
  if (!sh.reaktorCountdown) return { fehler: 'kein Countdown (gilt=' + Rtod.gilt(g) + ')' };
  const ev = ereignisse(muster, phase, start);
  halbiert = 0; let i = 0; let k = 0;
  const maxK = Math.round(CAP / DT);
  while (k < maxK) {
    const tNext = (k + 1) * DT;
    while (i < ev.length && ev[i].t <= tNext - 1e-9) {
      const w = ev[i].w.w; i++;
      sh.shields.current.fill(0);
      space.shipHit(g, Math.floor(rnd() * 4), w.dmg, Object.assign({}, w.opts));
      if (sh.schiffZerstoert) return { t: +(ev[i - 1].t).toFixed(4), treffer: halbiert, grund: 'countdown' };
    }
    g.time += DT; k++;
    Rtod.update(g, DT);
    if (sh.schiffZerstoert) return { t: +(k * DT).toFixed(4), treffer: halbiert, grund: 'countdown' };
  }
  return { t: null, treffer: halbiert, grund: 'nie' };
}
// Streu gegen die Lerche: Granate 1 = 1 Treffer, Granate 2 und 3 = je 2 Treffer; wird als eigene Ereignisse eingehängt (siehe expandiereStreu)
function expandiereStreu(muster) {
  return muster.map((q) => ({ iv: q.iv, hits: q.hits.flatMap(([dv, w], idx) => (w.streu ? (idx === 0 ? [[dv, { w: { dmg: STREU.schaden, opts: {} } }]] : [[dv, { w: { dmg: STREU.schaden, opts: {} } }], [dv, { w: { dmg: STREU.streu.durchschlag, opts: { huelle: true } } }]]) : [[dv, w]])) }));
}

function stat(a) {
  const s = a.slice().sort((x, y) => x - y); const n = s.length;
  if (!n) return null;
  const q = (p) => s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  const med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { n, mean: s.reduce((x, y) => x + y, 0) / n, median: med, p90: q(0.9), min: s[0], max: s[n - 1] };
}

const KLASSEN = ['raider', 'korvette', 'fregatte', 'kreuzer', 'frachter'];
const ARTEN = Object.keys(MUSTER);
const out = { meta: { N, SEED, tickHz: CONFIG.tickHz, dt: DT, reaktorTod: CONFIG.reaktorTod, streuIntervall: STREU_IV, salvoGap: GAP, repair_gegner_reaktor: CONFIG.systemModell.gegner.reparatur.reaktor, crewScaling: CONFIG.crewScaling, datum: new Date().toISOString() }, saetze: {} };
const PHASEN = NUR_NULL ? ['null'] : ['zufall', 'null'];
console.log('gilt(Lerche) =', (g.god = false, Rtod.gilt(g)), '| God an =', (g.god = true, Rtod.gilt(g)), '(muss false sein)');
g.god = false;

for (const phase of PHASEN) {
  out.saetze[phase] = {};
  for (const klasse of KLASSEN.concat(['lerche'])) {
    for (const art of (klasse === 'lerche' ? Object.keys(MUSTER_LERCHE) : ARTEN)) {
      for (const start of art === 'keine' ? [0] : [0, 5]) {
        const name = art + (start ? '+5s' : '');
        const zeiten = [], treffer = []; const gruende = {}; let nie = 0;
        const muster = klasse === 'lerche' ? expandiereStreu(MUSTER_LERCHE[art]) : MUSTER[art];
        for (let r = 0; r < (art === 'keine' ? Math.min(N, 5) : N); r++) {
          const res = klasse === 'lerche' ? laufLerche(muster, phase, start) : laufGegner(klasse, muster, phase, start);
          if (res.fehler) { gruende[res.fehler] = (gruende[res.fehler] || 0) + 1; continue; }
          gruende[res.grund] = (gruende[res.grund] || 0) + 1;
          if (res.t == null) { nie++; continue; }
          zeiten.push(res.t); treffer.push(res.treffer);
        }
        out.saetze[phase][klasse + '|' + name] = { klasse, art: name, zeit: stat(zeiten), treffer: stat(treffer), gruende, nie };
      }
    }
  }
}

// ---- Markdown
const f1 = (x) => (x == null ? '-' : x.toFixed(1));
function tabelle(phase) {
  const cols = [];
  for (const a of ARTEN) { cols.push(a); if (a !== 'keine') cols.push(a + '+5s'); }
  const lines = ['| Klasse | ' + cols.join(' | ') + ' |', '|---|' + cols.map(() => '---').join('|') + '|'];
  for (const k of KLASSEN) {
    lines.push('| ' + k + ' | ' + cols.map((cn) => { const r = out.saetze[phase][k + '|' + cn]; if (!r || !r.zeit) return r && r.nie ? 'nie' : '-'; const sys = (r.gruende.systeme || 0); return `${f1(r.zeit.mean)} / ${f1(r.zeit.p90)} s, ${f1(r.treffer.mean)} Tr.` + (sys ? ` (${sys}/${r.zeit.n} Systeme)` : ''); }).join(' | ') + ' |');
  }
  const lc = Object.keys(MUSTER_LERCHE).flatMap((a) => (a === 'keine' ? [a] : [a, a + '+5s']));
  lines.push('', '| Lerche | ' + lc.join(' | ') + ' |', '|---|' + lc.map(() => '---').join('|') + '|');
  lines.push('| Lerche | ' + lc.map((cn) => { const r = out.saetze[phase]['lerche|' + cn]; if (!r || !r.zeit) return r && r.nie ? 'nie' : '-'; return `${f1(r.zeit.mean)} / ${f1(r.zeit.p90)} s, ${f1(r.treffer.mean)} Tr.`; }).join(' | ') + ' |');
  return lines.join('\n');
}
for (const phase of PHASEN) console.log(`\n## Phase ${phase} (Mittel / P90, mittlere Treffer bis Tod; N=${N})\n\n` + tabelle(phase));
out.markdown = {}; for (const phase of PHASEN) out.markdown[phase] = tabelle(phase);
if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log('\nRohdaten:', OUT); }
process.exit(0);
