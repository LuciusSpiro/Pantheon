'use strict';
// MON-01 Nacharbeit M1: Sollwerte für das Station-Monster (server/sim/monster.js, `gehen`) aus main da8d19c, VOR dem Umbau gehen -> gehenMit. tools/fixtures/mon01-station-bahn.json
// ist der feste Sollwert; tools/test-kreatur.js misst mit messen() den heutigen Code und vergleicht. Szenen (Station Helix, Seed 21, Spieler weit weg und unverwundbar):
//   patrouille  30 s freie Bahn des Station-Monsters (Hash über alle Ticks)
//   schott      Schott zu, Monster in der Jagd mit Ziel dahinter: Zeit, bis es das Schott aufbricht (Rammzeit), Spur bis zum Ziel
//   wand        Schritt gegen eine Wand in einem langen Gang (Endlage hängt an der Kollisionsbox 28×28)
// Aufruf:  node tools/fixture-station-bahn.js [<Wurzel eines Pantheon-Checkouts, Standard dieses Repo>] [--schreiben]
// Ohne --schreiben nur Ausgabe; mit --schreiben wird die Fixture dieses Repos überschrieben (nur mit dem Code von da8d19c tun, z. B. `git worktree add --detach <Pfad> da8d19c`).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SEED = 21, TILE = 32;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function messen(wurzel) {
  const R = (rel) => require(path.join(wurzel, rel));
  const CONFIG = R('shared/config.js');
  const Mon = R('shared/monster.js');
  const Locations = R('shared/locations.js');
  const { Game } = R('server/game.js');
  const space = R('server/sim/space.js');
  const Welt = R('server/sim/welt.js');
  const away = R('server/sim/away.js');
  const Anker = R('server/sim/anker.js');
  const Monster = R('server/sim/monster.js');
  const DT = 1 / CONFIG.tickHz;

  function neu() {
    const g = new Game({ noStore: true, worlds: false, seed: SEED, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send() {}, sendRaw() {} };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Kre', color: 0 });
    g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' }); g.handleMessage(c, { t: 'ready', ready: true });
    Welt.waehle(g, 'sund'); g.god = true; space.enterScene(g, 'helix', {});
    const sc = Locations.get('helix').scene; g.ship.x = sc.station.x - 100; g.ship.y = sc.station.y;
    const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT, k) === true) return k; g.step(); } return -1; };
    run(0.2);
    g.chooseLandepunkt(g.players[0], 'helix.station');
    away.executeBeam(g, g.players.map((q) => q.id), 'down');
    run(0.3);
    g.players[0].x = 3 * TILE; g.players[0].y = 3 * TILE; g.god = true;
    return { g, run, aw: g.away, M: g.away.monster, k: g.karteOf(g.away.map) };
  }

  function patrouille() {
    const T = neu(); const spur = [];
    T.run(30, () => { spur.push(T.M.x.toFixed(2) + ',' + T.M.y.toFixed(2) + ',' + T.M.z); return false; });
    return { ticks: spur.length, zustaende: [...new Set(spur.map((s) => s.split(',')[2]))], sha256: sha(spur.join(';')), probe: spur.filter((_, i) => i % 30 === 0) };
  }

  // Schott mit Ankerpunkt davor/dahinter, Weg zwischen beiden führt über das Schott
  function schottWeg(k) {
    const m = Monster.maskeVon(k);
    for (const [kid, kt] of Object.entries(k.kanten || {})) {
      if (kt.typ !== 'schott' || !kt.tiles || kt.tiles.length < 2) continue;
      const [a, b] = kt.tiles;
      const senkrecht = a[0] === b[0];
      const mx = Math.round((a[0] + b[0]) / 2) + (senkrecht ? 1 : 0), my = Math.round((a[1] + b[1]) / 2) + (senkrecht ? 0 : 1);
      const vor = Mon.naechster(m, senkrecht ? a[0] - 3 : mx, senkrecht ? my : a[1] - 3, 1);
      const hin = Mon.naechster(m, senkrecht ? a[0] + 4 : mx, senkrecht ? my : a[1] + 4, 1);
      if (!vor || !hin) continue;
      const w = Mon.weg(m, vor, hin, 4000);
      if (!w || w.length < 4 || w.length > 14) continue;
      const kreuzt = w.some((s) => [[-1, -1], [0, -1], [-1, 0], [0, 0]].some(([dx, dy]) => (s.cx + dx) + ',' + (s.cy + dy) === a[0] + ',' + a[1] || (s.cx + dx) + ',' + (s.cy + dy) === b[0] + ',' + b[1]));
      if (kreuzt) return { kid, vor, hin, w };
    }
    return null;
  }
  function schott() {
    const T = neu(); const { g, aw, M } = T;
    const sw = schottWeg(T.k); if (!sw) return { fehler: 'kein Schott mit Weg' };
    Anker.setzen(g, aw.map, sw.kid, 'zu', null, { still: true });
    const pos = Mon.mitte(sw.vor); M.x = pos.x; M.y = pos.y; M.pfad = []; M.ramm = null; M.z = 'jagd'; M.replan = 0; M.ref = { x: pos.x, y: pos.y }; M.stuckT = 0;
    const ziel = Mon.mitte(sw.hin);
    const spur = []; let rammAb = -1, offenAb = -1, zielAb = -1;
    T.run(14, (t, i) => {
      M.verlust = 0; M.letzte = { x: ziel.x, y: ziel.y }; M.z = 'jagd';
      if (rammAb < 0 && M.ramm) rammAb = i;
      if (offenAb < 0 && Anker.zustand(g, aw.map, sw.kid) === 'offen') offenAb = i;
      spur.push(M.x.toFixed(2) + ',' + M.y.toFixed(2) + ',' + (M.ramm ? 1 : 0));
      if (Math.hypot(M.x - ziel.x, M.y - ziel.y) < 40) { zielAb = i; return true; }
      return false;
    });
    return { schott: sw.kid, wegLaenge: sw.w.length, rammAbTick: rammAb, offenAbTick: offenAb, rammSekunden: Math.round((offenAb - rammAb) * DT * 1000) / 1000, zielAbTick: zielAb,
      ticks: spur.length, sha256: sha(spur.join(';')), probe: spur.filter((_, i) => i % 20 === 0) };
  }

  // Längster waagerechter Gang von Ankerpunkten der Maske, der an einer Sperre endet
  function wand() {
    const T = neu(); const { aw, M, k } = T; const m = Monster.maskeVon(k);
    let best = null;
    for (let cy = 2; cy < m.h - 1; cy++) {
      let cx = 1;
      while (cx < m.w) {
        if (!m.geht(cx, cy)) { cx++; continue; }
        let e = cx; while (m.geht(e + 1, cy)) e++;
        if (e + 1 < m.w && !m.geht(e + 1, cy) && (!best || e - cx > best.cx1 - best.cx0)) best = { cy, cx0: cx, cx1: e };
        cx = e + 1;
      }
    }
    const start = Mon.mitte({ cx: best.cx1 - 2, cy: best.cy }), ziel = { cx: best.cx1 + 4, cy: best.cy };   // Pfadknoten sind Ankerpunkte; dieser liegt hinter der Sperre
    M.x = start.x; M.y = start.y; M.pfad = [ziel]; M.ramm = null; M.z = 'patrouille'; M.wait = 99; M.ref = { x: M.x, y: M.y }; M.stuckT = 0;
    const spur = [];
    T.run(3, () => { M.pfad = M.pfad.length ? M.pfad : [ziel]; spur.push(M.x.toFixed(2) + ',' + M.y.toFixed(2)); return false; });
    return { gang: best, endeX: Math.round(M.x * 100) / 100, endeY: Math.round(M.y * 100) / 100, sperreX: (best.cx1 + 1) * TILE, ticks: spur.length, sha256: sha(spur.join(';')) };
  }

  return { patrouille: patrouille(), schott: schott(), wand: wand(), maskeHash: maskeHash(Mon, neu().k) };
}

// Maske der Station (Größe 2): ok-Raster als Hash und Anzahl
function maskeHash(Mon, k) {
  const m = Mon.maske(k); let n = 0; const z = [];
  for (let cy = 0; cy <= m.h; cy++) for (let cx = 0; cx <= m.w; cx++) { const v = m.geht(cx, cy) ? 1 : 0; n += v; z.push(v); }
  return { w: m.w, h: m.h, ankerpunkte: n, sha256: sha(z.join('')) };
}

module.exports = { messen };

if (require.main === module) {
  const args = process.argv.slice(2);
  const wurzel = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..'));
  const r = messen(wurzel);
  const out = Object.assign({ hinweis: 'Sollwerte aus main da8d19c (Station-Monster, vor dem Umbau gehen -> gehenMit), erzeugt mit tools/fixture-station-bahn.js', seed: SEED }, r);
  console.log('Wurzel ' + wurzel);
  console.log(JSON.stringify({ patrouille: [r.patrouille.ticks, r.patrouille.zustaende.join(','), r.patrouille.sha256.slice(0, 12)], schott: Object.assign({}, r.schott, { probe: undefined }), wand: Object.assign({}, r.wand, { sha256: r.wand.sha256.slice(0, 12) }), maske: r.maskeHash }, null, 1));
  if (args.includes('--schreiben')) {
    const ziel = path.join(__dirname, 'fixtures', 'mon01-station-bahn.json');
    fs.writeFileSync(ziel, JSON.stringify(out, null, 1) + '\n');
    console.log('geschrieben: ' + ziel);
  }
}
