'use strict';
// GEG-01 C: Die Lanze-Vollladung trifft das gültige Systemziel der Ops (Gegnersystem.vollladungZone), sonst wie bisher die Mitte (SYS-03 N1).
// Gültig = System vorhanden, nicht zerstört, auf der zugewandten Seite erreichbar, bei Vollladung treffbar (Reaktor: nicht im Reaktor-Fenster, lanze.reaktorStufen > 0).
// Abgedeckt: Transporter (frachter) Antrieb von hinten über viele Seeds; ohne Ziel nur Mitte; Ziel abgewandt/zerstört = Mitte; Ziel Reaktor wie bisher; alle Klassen mit Antrieb/Waffe; Teilladung und Batterie unverändert.
// Mutationsbeleg: in space.js die Zeile wieder auf zone = 'mitte' setzen -> Abschnitte 1 und 5 rot.
//   node tools/test-vollladung-ziel.js
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Integ = require('../server/sim/integritaet.js');
const { makeRng } = require('../server/util.js');
const Th = require('./gegner-testhilfe.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const SEEDS = 200;
const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
{ const c = { inbox: [], send() {}, sendRaw() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'V0', name: 'V0', color: 0 }); }
g.reset(); g.phase = 'play';
space.enterScene(g, 'splitter', {});
g.god = true; g.emit = () => {}; g.missionEvent = () => {};
const VOLL = () => ({ pierce: 2, durchschlag: 'zone', vollladung: true, angriff: true });
const TEIL = () => ({ pierce: 2, angriff: true });
const SEITE = { bug: 0, stb: 1, heck: 2, bb: 3 };
const zoneVon = (kind, id) => Gsys.defOf(kind, id).zone;

// frischer Gegner (Schild 0, alles ok), Schiff auf der Seite 'seite', Systemziel ziel (oder keines); der Seed wählt den Zufall der Trefferwahl
function neu(kind, seite, ziel, seed) {
  g.rng = makeRng(1000 + seed);
  g.space.enemies = []; g.space.projectiles = [];
  const e = space.spawnEnemy(g, kind, { x: 1500, y: 1100, angle: 0 });
  e.angle = 0; Th.schildNull(e); e.scanned = true;
  const a = [0, Math.PI / 2, Math.PI, -Math.PI / 2][SEITE[seite]];
  g.ship.x = e.x + Math.cos(a) * 300; g.ship.y = e.y + Math.sin(a) * 300;
  g.ship.target = e.id;
  if (ziel) g.ship.zielsystem = ziel; else delete g.ship.zielsystem;
  return e;
}
const schuss = (e, opts) => { g.time += 20; space.damageEnemy(g, e, 12, g.ship.x, g.ship.y, opts); };
const kaputt = (e) => Gsys.ids(e).filter((id) => e.sys[id].z === 'broken');
const stand = (e) => { const v = {}; for (const id of Gsys.ids(e)) v[id] = e.sys[id].z + e.sys[id].i.toFixed(4); return v; };
const geaendert = (e, vor) => Gsys.ids(e).filter((id) => e.sys[id].z + e.sys[id].i.toFixed(4) !== vor[id]);

console.log('\n[1 Transporter, Ziel Antrieb, Vollladung von hinten]');
{ let treff = 0, nurAntrieb = 0;
  for (let s = 0; s < SEEDS; s++) { const e = neu('frachter', 'heck', 'antrieb', s); schuss(e, VOLL()); if (e.sys.antrieb.z === 'broken') treff++; if (kaputt(e).join() === 'antrieb') nurAntrieb++; }
  ok(treff === SEEDS, 'Antrieb zerstört in ' + treff + '/' + SEEDS + ' Läufen');
  ok(nurAntrieb === SEEDS, 'nur der Antrieb zerstört (ein Treffer, ein System)'); }

console.log('\n[2 ohne Systemziel: Mitte wie bisher]');
{ const z = {}; let fremd = 0;
  for (const kind of ['raider', 'korvette', 'fregatte', 'kreuzer', 'frachter']) for (let s = 0; s < SEEDS; s++) {
    const e = neu(kind, 'heck', null, s); const vor = stand(e); schuss(e, VOLL());
    for (const id of geaendert(e, vor)) { const zz = zoneVon(kind, id); z[zz] = (z[zz] || 0) + 1; if (zz !== 'mitte') fremd++; }
  }
  ok(fremd === 0 && z.mitte > 0, 'nur Systeme der Mitte getroffen (' + JSON.stringify(z) + ')');
  ok(Gsys.vollladungZone(g, neu('frachter', 'heck', null, 1), null) === 'mitte', 'vollladungZone ohne Ziel = mitte'); }

console.log('\n[3 Ziel nicht erreichbar oder zerstört: Mitte]');
{ let fremd = 0, mitte = 0;
  for (let s = 0; s < SEEDS; s++) { const e = neu('frachter', 'bug', 'antrieb', s); const vor = stand(e); schuss(e, VOLL());   // Antrieb liegt hinten, Schiff vorn
    for (const id of geaendert(e, vor)) { if (zoneVon('frachter', id) === 'mitte') mitte++; else fremd++; } }
  ok(fremd === 0 && mitte === SEEDS, 'Antrieb abgewandt: nur Mitte (' + mitte + '/' + SEEDS + ')');
  fremd = 0; mitte = 0;
  for (let s = 0; s < SEEDS; s++) { const e = neu('frachter', 'heck', 'antrieb', s); e.sys.antrieb.z = 'broken'; e.sys.antrieb.i = 0; const vor = stand(e); schuss(e, VOLL());
    for (const id of geaendert(e, vor)) { if (zoneVon('frachter', id) === 'mitte') mitte++; else fremd++; } }
  ok(fremd === 0 && mitte === SEEDS, 'Antrieb schon zerstört: nur Mitte (' + mitte + '/' + SEEDS + ')'); }

console.log('\n[4 Ziel Reaktor: wie bisher (reaktorStufen Stufen, Fenster)]');
{ const rs = Integ.lanzeReaktorStufen(g);
  const e = neu('kreuzer', 'heck', 'reaktor', 3);   // Reaktor erst erreichbar, wenn die zugewandte Zone leer ist
  for (const id of Gsys.ids(e)) if (zoneVon('kreuzer', id) === 'heck') { e.sys[id].z = 'broken'; e.sys[id].i = 0; }
  ok(Gsys.vollladungZone(g, e, { id: 'reaktor', zugewandt: 'heck' }) === 'mitte', 'Zone des Reaktors = mitte');
  schuss(e, VOLL());
  ok(rs >= 1 && e.sys.reaktor.z !== 'ok', 'Reaktor nach einer Vollladung getroffen: ' + e.sys.reaktor.z + ' (reaktorStufen ' + rs + ')');
  ok(rs !== 1 || e.sys.reaktor.z === 'damaged', 'bei reaktorStufen 1: genau eine Stufe');
  g.time += 0.1; const vor = e.sys.reaktor.z; space.damageEnemy(g, e, 12, g.ship.x, g.ship.y, VOLL());   // im Reaktor-Fenster nicht erneut
  ok(e.sys.reaktor.z === vor, 'im Reaktor-Fenster bleibt der Reaktor stehen (der Treffer geht an ein anderes System der Mitte)');
  const e2 = neu('kreuzer', 'heck', 'reaktor', 4);   // Heck nicht leer: Reaktor nicht erreichbar -> Mitte, Heck unberührt
  const v2 = stand(e2); schuss(e2, VOLL());
  ok(geaendert(e2, v2).every((id) => zoneVon('kreuzer', id) === 'mitte'), 'Reaktor unerreichbar: Mitte wie bisher'); }

console.log('\n[5 alle Klassen: Ziel Antrieb bzw. Waffe wird getroffen]');
for (const kind of ['raider', 'korvette', 'fregatte', 'kreuzer', 'frachter']) {
  const ziele = [['antrieb', 'heck']];
  const w = Gsys.systemeVon(kind).filter((d) => d.art === 'waffe');
  if (w.length) ziele.push([w[0].id, w[0].zone]);
  for (const [ziel, seite] of ziele) {
    let treff = 0, nurDas = 0;
    for (let s = 0; s < 50; s++) { const e = neu(kind, seite, ziel, s); schuss(e, VOLL()); if (e.sys[ziel].z === 'broken') treff++; if (kaputt(e).join() === ziel) nurDas++; }
    ok(treff === 50 && nurDas === 50, kind + ': Ziel ' + ziel + ' (' + seite + ') zerstört, sonst nichts: ' + treff + '/50');
  }
}

console.log('\n[6 Teilladung und Batterie unverändert]');
{ let ok1 = 0, ok2 = 0;
  for (let s = 0; s < 50; s++) {
    const e = neu('frachter', 'heck', 'antrieb', s); space.damageEnemy(g, e, 3 + 9 * 0.6, g.ship.x, g.ship.y, TEIL());
    if (e.sys.antrieb.z !== 'ok' && kaputt(e).every((id) => id === 'antrieb')) ok1++;   // gezielt auf den Antrieb: zwei Stufen (SYS-01), wie vor der Änderung
    const e2 = neu('frachter', 'heck', null, s); space.damageEnemy(g, e2, 2.66, g.ship.x, g.ship.y, { angriff: true });
    if (!kaputt(e2).length) ok2++;
  }
  ok(ok1 === 50, 'Teilladung mit Ziel Antrieb: nur der Antrieb betroffen, wie vor der Änderung (' + ok1 + '/50)');
  ok(ok2 === 50, 'Batterie ohne Ziel: nichts zerstört (' + ok2 + '/50)'); }

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen grün'));
process.exit(fails ? 1 : 0);
