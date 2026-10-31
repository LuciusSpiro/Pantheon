'use strict';
// SYS-03 B-Nacharbeit: Messung des Dauerdrucks (Zonenschaden ohne Schild) in Stufen. Eine Zone mit `schaden` Punkten je Sekunde liegt auf der Lerche (Schild 0, ohne Regeneration);
// gemessen werden die verlorenen Stufen (beschädigt = 1, zerstört = 2, Summe über alle Systeme) nach `sek` Sekunden und die Zeit bis zur 1. / 3. Stufe.
// Läuft gegen jeden Stand (auch den vor SYS-03, 2bd7137): nutzt nur die öffentliche Sim.
//   node tools/sys03-dauerdruck.js [--seeds 5] [--schaden 1] [--sek 60] [--seed0 1] [--ziel lerche|gegner]
// ziel gegner: ein Kreuzer ohne Schild in der Zone (nur Stand ab SYS-03 B2 aussagekräftig; vorher zählt die Integrität, nicht die Stufe).
const path = require('path');
const root = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg('seeds', 5)), SCHADEN = Number(arg('schaden', 1)), SEK = Number(arg('sek', 60)), SEED0 = Number(arg('seed0', 1)), ZIEL = arg('ziel', 'lerche');
const CONFIG = require(path.join(root, 'shared/config.js'));
const Locations = require(path.join(root, 'shared/locations.js'));
const { Game } = require(path.join(root, 'server/game.js'));
const space = require(path.join(root, 'server/sim/space.js'));
const I = require(path.join(root, 'server/sim/interior.js'));
const DT = 1 / CONFIG.tickHz;
const RANG = { ok: 0, damaged: 1, broken: 2 };

function lauf(seed) {
  const SZENE = Locations.get('rabenpass').scene; const alt = { zonen: SZENE.zonen, station: SZENE.station, hafen: SZENE.hafen, kauft: SZENE.kauft };
  try {
    SZENE.zonen = [{ id: 'dd', form: 'kreis', x: 1500, y: 800, r: 40000, schaden: SCHADEN, sicht: 1 }]; delete SZENE.station; delete SZENE.hafen; delete SZENE.kauft;
    const g = new Game({ noStore: true, worlds: false, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(m) { if (this.inbox.length < 50) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'D0', name: 'D0', color: 0 });
    g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
    if (g.arena) g.arena.nextAt = null;
    space.enterScene(g, 'rabenpass', {}); g.space.enemies = []; g.space.projectiles = [];
    for (let k = 0; k < 10; k++) g.step();
    for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok'; g.ship.fragile = {}; g.ship.trefferT = {}; I.integritaetVoll(g);
    g.ship.shields.current = [0, 0, 0, 0]; g.ship.shields.regenHold = 1e9; g.god = ZIEL === 'gegner'; g.ship.x = 1700; g.ship.y = 800;
    let e = null;
    if (ZIEL === 'gegner') {
      g.ship.x = 100; g.ship.y = 100;   // Lerche weit weg (außerhalb der Zone ist nichts: Radius 40000 überdeckt alles, aber der Gegner ist das Ziel)
      e = space.spawnEnemy(g, 'kreuzer', { x: 1700, y: 800, facing: 0 }); e.shields = e.shields.map(() => 0); e.shieldsMax = e.shieldsMax.map(() => 0);
      g.space.enemies = [e]; e.pat = null;
    }
    // verlorene Stufen kumulativ (Reparatur und Notfallprotokoll setzen Systeme zurück; nur Verschlechterungen zählen)
    const rang = () => (e ? Object.values(e.sys).map((s) => RANG[s.z]) : I.SYSTEM_ORDER.map((k) => RANG[g.ship.systems[k]] || 0));
    let prev = rang(), verloren = 0;
    const stufen = () => verloren;
    const t0 = g.time; let t1 = null, t3 = null;
    for (let k = 0; k < Math.round(SEK / DT); k++) {
      if (!e) { g.ship.x = 1700; g.ship.y = 800; } else { e.x = 1700; e.y = 800; e.vx = 0; e.vy = 0; e.shields = e.shields.map(() => 0); e.hitT = -99; }
      g.step();
      const nu = rang(); for (let j = 0; j < nu.length; j++) if (nu[j] > prev[j]) verloren += nu[j] - prev[j]; prev = nu;
      const s = verloren;
      if (t1 == null && s >= 1) t1 = g.time - t0;
      if (t3 == null && s >= 3) t3 = g.time - t0;
    }
    return { stufen: stufen(), t1, t3 };
  } finally { for (const k of Object.keys(alt)) { if (alt[k] === undefined) delete SZENE[k]; else SZENE[k] = alt[k]; } }
}
const med = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const rs = [];
for (let s = 0; s < SEEDS; s++) rs.push(lauf(SEED0 + s));
console.log(`Dauerdruck ${ZIEL}: Schaden ${SCHADEN}/s, ${SEK} s, Seeds ${SEED0}..${SEED0 + SEEDS - 1}, zonen.druckPunkte ${(CONFIG.zonen || {}).druckPunkte}, druckAbkling_s ${(CONFIG.zonen || {}).druckAbkling_s}`);
console.log('  Stufen nach ' + SEK + ' s je Seed: ' + rs.map((r) => r.stufen).join(' ') + '  (Median ' + med(rs.map((r) => r.stufen)) + ')');
console.log('  1. Stufe nach (Median) ' + med(rs.map((r) => r.t1)) + ' s, 3. Stufe nach ' + med(rs.map((r) => r.t3)) + ' s');
