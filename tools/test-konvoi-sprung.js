'use strict';
// GEG-01 A: Ein Konvoi-Transporter springt nur mit heilem Antrieb und Reaktor (Konvoi.kannSpringen) – weder regulär am Routenende noch per
// Notbremse (springSpaetestens), und eine laufende Sprungladung bricht ab (genau eine ODA-Meldung, genau ein Ereignis konvoiSprungAbgebrochen).
//   node tools/test-konvoi-sprung.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Konvoi = require('../server/sim/konvoi.js');
const Gtod = require('../server/sim/gegnertod.js');

const DT = 1 / CONFIG.tickHz;
const K = CONFIG.konvoi;
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-konvoi-sprung-'));

// Raumszene Rabenpass mit genau einem Transporter ohne Eskorte; Lerche unverwundbar und weit weg
function szene() {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Spr', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = true;
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  const mev = []; const odas = [];
  const me0 = g.missionEvent.bind(g); g.missionEvent = (kind, d) => { mev.push(Object.assign({ kind }, d)); return me0(kind, d); };
  const oda0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(t); return oda0(t, x); };
  for (let i = 0; i < 3; i++) g.step();
  g.space.enemies = []; g.space.projectiles = [];
  const s = g.ship; s.x = 300; s.y = 300; s.vx = 0; s.vy = 0; s.speed = 0; s.target = null;
  Konvoi.an(g, { n: 1, sieg: 'aufhalten', eskorte: 'keine', wiederholung: false });
  const k = g.space.konvoi; const id = k.ids[0];
  const T = { g, k, id, mev, odas, t0: g.time };
  T.e = () => g.space.enemies.find((q) => q.id === id) || null;
  T.amEnde = () => { const e = T.e(); const last = k.route.length - 1; e.wp = last; e.x = k.route[last].x - 20; e.y = k.route[last].y; };
  T.brechen = (art) => Gtod.brechen(g, T.e(), art);
  // Läuft bis Ende (Transporter weg) oder sec Simzeit; liefert { t, fertig } (t = null, wenn er noch da ist)
  T.lauf = (sec) => {
    for (let i = 0; i < sec / DT; i++) {
      g.step(); g.god = true;
      if (!T.e()) return { t: g.time - T.t0, fertig: k.fertig[id] || 'weg' };
    }
    return { t: null, fertig: k.fertig[id] || null };
  };
  return T;
}
const kurz = (r) => (r.t == null ? 'noch da' : r.fertig + ' nach ' + r.t.toFixed(0) + ' s');

console.log('\n[Ohne Schaden: springt]');
{
  const T = szene(); const r = T.lauf(200);
  ok(r.fertig === 'gesprungen' && r.t > 60 && r.t < 120, 'springt nach der Route (' + kurz(r) + ')');
  ok(T.mev.filter((m) => m.kind === 'konvoiSprungAbgebrochen').length === 0, 'keine Abbruchmeldung');
}
console.log('\n[Antrieb zerstört von Anfang an: springt nie, auch nicht per Notbremse]');
{
  const T = szene(); T.brechen('antrieb'); const r = T.lauf(K.springSpaetestens + 60);
  ok(r.t == null && r.fertig === null, 'springt nach ' + (K.springSpaetestens + 60) + ' s nicht (' + kurz(r) + ')');
  ok(T.e() && Konvoi.uebrig(T.g) === 1, 'bleibt als Ziel erhalten');
  ok(T.e().sprung == null, 'lädt nie');
  ok(T.mev.filter((m) => m.kind === 'konvoiSprungAbgebrochen').length === 1 && T.odas.filter((o) => o === 'Transporter kann nicht mehr springen!').length === 1, 'vereitelte Notbremse: genau eine Meldung und ein Ereignis');
}
console.log('\n[Reaktor zerstört von Anfang an: Countdown, kein Sprung]');
{
  const T = szene(); T.brechen('reaktor'); const r = T.lauf(60);
  ok(r.fertig === 'zerstoert' && r.t > 10 && r.t < 30, 'explodiert über den Countdown (' + kurz(r) + ')');
  ok(!Object.values(T.k.fertig).includes('gesprungen'), 'springt nie');
}
console.log('\n[Am Routenende Antrieb zerstört]');
{
  const T = szene(); T.amEnde(); T.brechen('antrieb'); const r = T.lauf(40);
  ok(r.t == null && T.e().sprung == null, 'springt nicht (' + kurz(r) + ')');
  ok(T.mev.filter((m) => m.kind === 'konvoiSprungAbgebrochen').length === 1, 'genau ein Abbruchereignis');
}
console.log('\n[Am Routenende Reaktor zerstört]');
{
  const T = szene(); T.amEnde(); T.brechen('reaktor'); const r = T.lauf(40);
  ok(r.fertig === 'zerstoert' && r.t > 10 && r.t < 30, 'Countdown tötet ihn, kein Sprung (' + kurz(r) + ')');
}
console.log('\n[Am Routenende beide tot]');
{
  const T = szene(); T.amEnde(); T.brechen('antrieb'); T.brechen('reaktor'); const r = T.lauf(40);
  ok(r.fertig !== 'gesprungen', 'springt nicht (' + kurz(r) + ')');
}
console.log('\n[Laufende Sprungladung, dann Antrieb zerstört: Abbruch]');
{
  const T = szene(); T.amEnde();
  let n = 0; while (T.e().sprung == null && n++ < 600) { T.g.step(); T.g.god = true; }
  ok(T.e().sprung != null && T.e().sprung > 0, 'Sprungladung läuft (sprung ' + (T.e().sprung || 0).toFixed(2) + ')');
  T.brechen('antrieb');
  const r = T.lauf(30);
  ok(r.t == null && T.e().sprung == null, 'Ladung abgebrochen, kein Sprung (' + kurz(r) + ')');
  ok(T.odas.filter((o) => o === 'Transporter kann nicht mehr springen!').length === 1, 'genau eine ODA-Meldung');
  ok(T.mev.filter((m) => m.kind === 'konvoiSprungAbgebrochen').length === 1, 'genau ein Ereignis konvoiSprungAbgebrochen');
}

console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ok');
process.exit(fails ? 1 : 0);
