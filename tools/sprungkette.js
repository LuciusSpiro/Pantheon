'use strict';
// EK7: Bot-Durchlauf der Sprungkette Statio Limitis -> ... -> Eisenwald (ohne Gefechte), Ausgabe als Tabelle.
//   node tools/sprungkette.js            Tabelle der Sprünge (Flugzeit, Strecke, Brocken-Treffer) und Szenen
//   node tools/sprungkette.js --json     zusätzlich als JSON
// Der Bot fliegt wie ein Spieler am Steuer: Befehle helm.input / helm.throttle / helm.jump über game.handleMessage, Ziel über
// den Server (Sprung.selectDest), Anflug des Sprungpunkts mit Ausweichen vor Brocken (wie sim-headless steer). Schiff und
// Reaktor bleiben unverwundbar (Brocken zählen, kosten nichts). Auch als Modul: fahreKette() -> { zeilen, gesperrt, szenen }.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Sprung = require('../server/sim/sprung.js');

const DT = 1 / 30;
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function neuePartie(seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-kette-'));
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 7, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(dir, 'regie') }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); if (this.inbox.length > 50) this.inbox.shift(); }, sendRaw() {} };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'KETTE', name: 'Bot', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
  g.handleMessage(c, { t: 'ready', ready: true });
  g.players[0].console = 'helm';
  return { g, c, dir };
}

// ein Zeitschritt: Bot steuert zum Punkt (tx, ty); stage 1 = STOPP, 2 = ¼, 3 = ½, 4 = ¾
function steuere(S, tx, ty) {
  const { g, c } = S; const sh = g.ship;
  const gd = dist(sh.x, sh.y, tx, ty) || 1;
  const goalA = Math.atan2(ty - sh.y, tx - sh.x);
  const rocks = g.space.asteroids || [];
  const frei = (a, len) => {
    const cx = Math.cos(a), cy = Math.sin(a);
    for (const r of rocks) {
      const rx = r.x - sh.x, ry = r.y - sh.y; const along = rx * cx + ry * cy;
      if (along < -10 || along > len + r.r) continue;
      if (Math.abs(-rx * cy + ry * cx) < r.r + 36 + 22) return false;
    }
    return true;
  };
  let want = goalA; const look = Math.min(280, gd);
  for (let k = 0; k <= 16; k++) {
    const cand = (k === 0 ? [goalA] : [goalA + k * 0.12, goalA - k * 0.12]).filter((a) => frei(a, look)).sort((a, b) => Math.abs(norm(a - sh.angle)) - Math.abs(norm(b - sh.angle)));
    if (cand.length) { want = cand[0]; break; }
  }
  const diff = norm(want - sh.angle);
  const turn = Math.round(clamp(diff * 2.2 - (sh.turnVel || 0) * 1.1, -1, 1) * 20) / 20;
  const stage = Math.abs(diff) > 1.0 ? 2 : gd > 500 ? 4 : gd > 200 ? 3 : 2;
  if (sh.helm.stage !== stage) g.handleMessage(c, { t: 'cmd', c: 'helm.throttle', set: stage });
  g.handleMessage(c, { t: 'cmd', c: 'helm.input', turn, thrust: 0 });
}

// Einen Sprung fliegen: ziel = Hex (SSZZ). -> { ok, grund?, t, strecke, brocken }
function springe(S, ziel) {
  const { g } = S; const sh = g.ship;
  const von = Sektoren.hexVonOrt(sh.scene);
  const err = Sprung.selectDest(g, ziel);
  if (err) return { ok: false, grund: err, t: 0, strecke: 0, brocken: 0 };
  const t0 = g.time; let strecke = 0; let px = sh.x, py = sh.y; const b0 = (g.stats.brocken || {}).lerche || 0;
  for (let i = 0; i < 30 * 600; i++) {
    sh.hull = sh.hullMax;
    const p = Sprung.sprungpunkt(g, ziel);
    if (!p) return { ok: false, grund: 'kein Sprungpunkt', t: g.time - t0, strecke, brocken: 0 };
    if (sh.jump.ready) {
      const e = Sprung.doJump(g);
      if (e) return { ok: false, grund: e, t: g.time - t0, strecke, brocken: 0 };
      sh.vx = sh.vy = 0;
      return { ok: true, von, nach: Sektoren.hexVonOrt(sh.scene), t: g.time - t0, strecke: Math.round(strecke), brocken: ((g.stats.brocken || {}).lerche || 0) - b0 };
    }
    const nah = dist(sh.x, sh.y, p.x, p.y) <= (g.C.sektoren.sprungpunktRadius || 250) - 40;
    if (nah) { g.handleMessage(S.c, { t: 'cmd', c: 'helm.stop' }); }   // am Sprungpunkt stehen bleiben, Antrieb lädt
    else steuere(S, clamp(p.x, 180, g.space.w - 180), clamp(p.y, 180, g.space.h - 180));
    g.step();
    strecke += dist(px, py, sh.x, sh.y); px = sh.x; py = sh.y;
  }
  return { ok: false, grund: 'Zeitüberschreitung: ' + (sh.jump.blockedReason || '?'), t: g.time - t0, strecke: Math.round(strecke), brocken: 0 };
}

// kürzester Weg über offene Kanten (Orte aus Daten und Saumraum)
function weg(g, vonHex, nachHex) {
  const prev = { [vonHex]: null }; const q = [vonHex];
  while (q.length) {
    const c = q.shift(); if (c === nachHex) break;
    for (const n of Sprung.nachbarOrte(g, Sektoren.ortVonHex(c)).map((o) => Sektoren.hexVonOrt(o))) if (!(n in prev)) { prev[n] = c; q.push(n); }
  }
  if (!(nachHex in prev)) return null;
  const pfad = []; for (let h = nachHex; h; h = prev[h]) pfad.unshift(h);
  return pfad.slice(1);
}

function fahreKette(opts) {
  const S = neuePartie(opts && opts.seed); const { g } = S;
  const zeilen = []; const gesperrt = []; const szenen = [];
  const name = (h) => Sektoren.hexName(h);
  // Start in Statio Limitis (Weg aus dem Tutorial: tutorial-ende; hier direkt per Debug, die Kante prüft check/test)
  g.debugGoto('statio_limitis', false);
  const ex = g.explore;
  Sprung.debugErkundeAlle(g);   // Sternkarte und Bojen bekannt (die Erkundung per Weitscan prüft test-sektoren)
  const besuche = (hex) => {
    const o = Locations.get(Sektoren.ortVonHex(hex)); const sc = o.scene;
    szenen.push({ hex, name: o.name, ort: o.id, kind: o.kind, brocken: g.space.asteroids.length, planeten: (sc.planeten || []).length, station: !!sc.station, dock: !!sc.dock,
      fog: !!o.fog, snap: Buffer.byteLength(JSON.stringify(g.snapshot())), w: sc.w, h: sc.h });
  };
  besuche('0305');
  const ZIELE = ['0304', '0303', '0202', '0203', '0403', '0402', '0502', '0503', '0504', '0505', '0605', '0705', 'SPERRRIEGEL', '0604', '0704'];
  let hier = '0305';
  const versuch = (ziel, erwartet) => {   // gesperrte Ziele aus der aktuellen Szene
    const e = Sprung.selectDest(g, ziel); g.ship.jump.dest = null;
    gesperrt.push({ von: hier, ziel, erwartet: erwartet, grund: e || 'WÄHLBAR' });
  };
  for (const z of ZIELE) {
    if (z === 'SPERRRIEGEL') {
      // vor der Sprengung: Wolfstor von Methalle, Nebelheim und Vorfeld aus gesperrt
      versuch('0604', 'gesperrt (Methalle -> Wolfstor)');
      ex.sperrriegelOeffnen();
      zeilen.push({ von: '', nach: '', hinweis: 'Sperrriegel öffnen (Methalle-Sprengung)' });
      continue;
    }
    const pfad = weg(g, hier, z);
    if (!pfad) { zeilen.push({ von: hier, nach: z, ok: false, grund: 'kein Weg' }); break; }
    for (const h of pfad) {
      const r = springe(S, h);
      if (!r.ok) { zeilen.push({ von: hier, nach: h, ok: false, grund: r.grund, t: r.t }); return { zeilen, gesperrt, szenen, abbruch: true, g }; }
      zeilen.push({ von: hier, nach: h, ok: true, t: r.t, strecke: r.strecke, brocken: r.brocken });
      hier = h; besuche(h);
    }
  }
  // gesperrte Ziele: Eisenwald -> Kernland (Wolfsgrund 0803), Rabenpass -> Krähenwacht (0602), Castra Martis -> Vigilia (0302), Splittergürtel
  const probe = (von, ziel, text) => { g.debugGoto(Sektoren.ortVonHex(von), false); hier = von; versuch(ziel, text); };
  probe('0704', '0803', 'gesperrt (Kernland)');
  probe('0502', '0602', 'gesperrt (Krähenwacht)');
  probe('0202', '0302', 'gesperrt (Vigilia)');
  probe('0305', '0306', 'gesperrt (tutorial-ende, Boje)');
  return { zeilen, gesperrt, szenen, abbruch: false, g };
}

function tabelle(R) {
  const f = (t) => (Math.round(t * 10) / 10).toFixed(1);
  const pad = (s, n) => String(s).padEnd(n);
  const out = [];
  out.push('Sprungkette (Bot, ohne Gefechte)');
  out.push(pad('von', 24) + pad('nach', 24) + pad('Zeit s', 8) + pad('Strecke px', 11) + pad('Brocken', 8) + 'Ergebnis');
  for (const z of R.zeilen) {
    if (z.hinweis) { out.push('  -- ' + z.hinweis); continue; }
    out.push(pad(Sektoren.hexName(z.von) + ' ' + z.von, 24) + pad(Sektoren.hexName(z.nach) + ' ' + z.nach, 24) + pad(f(z.t || 0), 8) + pad(z.strecke || 0, 11) + pad(z.brocken || 0, 8) + (z.ok ? 'ok' : 'FEHLER ' + z.grund));
  }
  const ok = R.zeilen.filter((z) => z.ok);
  out.push(`Sprünge: ${ok.length}, Flugzeit gesamt ${f(ok.reduce((s, z) => s + z.t, 0))} s, Strecke ${ok.reduce((s, z) => s + z.strecke, 0)} px, Brocken-Treffer ${ok.reduce((s, z) => s + z.brocken, 0)}`);
  out.push('');
  out.push('Szenen (Snapshot je Szene)');
  out.push(pad('Hex', 6) + pad('Ort', 16) + pad('Art', 10) + pad('Größe', 11) + pad('Brocken', 8) + pad('Planeten', 9) + pad('Station', 8) + pad('Dock', 5) + pad('Nebel', 6) + 'Snapshot B');
  for (const s of R.szenen) out.push(pad(s.hex, 6) + pad(s.name, 16) + pad(s.kind, 10) + pad(s.w + 'x' + s.h, 11) + pad(s.brocken, 8) + pad(s.planeten, 9) + pad(s.station ? 'ja' : '-', 8) + pad(s.dock ? 'ja' : '-', 5) + pad(s.fog ? 'ja' : '-', 6) + s.snap);
  out.push('');
  out.push('Gesperrte Ziele');
  out.push(pad('von', 18) + pad('Ziel', 6) + pad('erwartet', 34) + 'Antwort des Servers');
  for (const s of R.gesperrt) out.push(pad(Sektoren.hexName(s.von), 18) + pad(s.ziel, 6) + pad(s.erwartet, 34) + s.grund);
  return out.join('\n');
}

module.exports = { fahreKette, tabelle, neuePartie, springe };

if (require.main === module) {
  const R = fahreKette();
  console.log(tabelle(R));
  if (process.argv.includes('--json')) { delete R.g; console.log(JSON.stringify(R)); }
  process.exit(R.abbruch || R.zeilen.some((z) => z.ok === false) || R.gesperrt.some((s) => s.grund === 'WÄHLBAR') ? 1 : 0);
}
