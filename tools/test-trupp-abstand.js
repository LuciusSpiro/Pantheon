'use strict';
// BOD-02 P5: Abstand und Reservierung der Boden-KI (server/sim/squad.js platzStrafe, CONFIG.awayCombat.trupp).
// 1) Einheitstest der Platzwertung auf synthetischer Karte (Mindestabstand, Inselgrenze, Mauern, Config)
// 2) Messlauf mit festem Seed (tools/mess-klumpen.js): Klumpenanteil im Gefecht deutlich unter dem Ausgangswert (0,84 / 0,64)
const path = require('path');
const { spawnSync } = require('child_process');
const CONFIG = require('../shared/config.js');
const W = require('../server/world.js');
const squad = require('../server/sim/squad.js');

let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }

// Synthetische Karte: 30 x 12, Boden '.', Fels 'R' (fest, volle Deckung), Wand '#'
function karte(zeilen) {
  const legend = { '.': { kind: 'floor' }, R: { kind: 'rock', solid: true, cover: 2 }, '#': { kind: 'wall_ruin', solid: true, cover: 2 } };
  const FEST = { kind: 'rock', solid: true };
  const map = { w: zeilen[0].length, h: zeilen.length, at: (x, y) => (y < 0 || y >= zeilen.length || x < 0 || x >= zeilen[y].length ? '_' : zeilen[y][x]) };
  map.info = (x, y) => legend[map.at(x, y)] || FEST;
  map.solid = (x, y) => !!map.info(x, y).solid;
  return map;
}
const leer = (w, h) => Array.from({ length: h }, () => '.'.repeat(w));
function mit(zeilen, y, x0, text) { zeilen[y] = zeilen[y].slice(0, x0) + text + zeilen[y].slice(x0 + text.length); return zeilen; }
function drone(id, tx, ty, goal) {
  const c = W.tileCenter(tx, ty);
  return { id, alive: true, x: c.x, y: c.y, goal: goal || null, path: goal ? [goal] : null };
}
function spiel(drones, trupp) {
  const C = JSON.parse(JSON.stringify(CONFIG.awayCombat));
  if (trupp) Object.assign(C.trupp, trupp);
  return { C: { awayCombat: C }, away: { drones }, time: 0 };
}
const strafe = (g, E, e, x, y) => squad._platzStrafe(g, E, e, { x, y });

console.log('\n[Config]');
ok(CONFIG.awayCombat.trupp && CONFIG.awayCombat.trupp.mindestAbstand >= 3 && CONFIG.awayCombat.trupp.inselMax === 2, 'awayCombat.trupp mit mindestAbstand >= 3 und inselMax 2 vorhanden');

console.log('\n[Mindestabstand]');
{
  const E = { map: karte(leer(30, 12)) };
  const ich = drone('ich', 2, 2), a = drone('a', 10, 6);
  const g = spiel([ich, a]);
  ok(strafe(g, E, ich, 20, 6) === 0, 'weit weg von jedem Kameraden: keine Strafe');
  ok(strafe(g, E, ich, 11, 6) > 0, '1 Kachel neben dem Kameraden: Strafe');
  ok(strafe(g, E, ich, 12, 8) > 0, '2 Kacheln (Chebyshev) neben dem Kameraden: Strafe');
  ok(strafe(g, E, ich, 13, 6) === 0, '3 Kacheln Abstand = Mindestabstand: frei');
  a.alive = false; ok(strafe(g, E, ich, 11, 6) === 0, 'toter Kamerad zählt nicht');
  a.alive = true;
  ok(strafe(g, E, a, 10, 6) === 0, 'der Gegner selbst zählt nicht gegen sich');
  const b = drone('b', 25, 10, { x: 15, y: 3 });
  const g2 = spiel([ich, a, b]);
  ok(strafe(g2, E, ich, 16, 3) > 0, 'Ziel-Platz eines laufenden Kameraden ist reserviert (Nachbarplätze im Mindestabstand)');
  ok(strafe(g2, E, ich, 18, 3) === 0, '... ab Mindestabstand frei');
  const c2 = drone('c', 25, 10, null); c2.goal = { x: 15, y: 3 };   // stehend: Altziel ohne Pfad zählt nicht
  ok(strafe(spiel([ich, a, c2]), E, ich, 16, 3) === 0, 'stehender Kamerad mit Altziel reserviert nichts');
  ok(strafe(spiel([ich, a], { mindestAbstand: 5 }), E, ich, 13, 6) > 0, 'tune: mindestAbstand 5 sperrt Abstand 3 (Config wirkt)');
  const zwei = spiel([ich, a, drone('b2', 14, 6)]);
  ok(strafe(zwei, E, ich, 12, 6) > strafe(g, E, ich, 11, 6), 'mehr Kameraden in Reichweite: höhere Strafe (weicher Rückfall wählt den am wenigsten belegten Platz)');
}

console.log('\n[Inselgrenze]');
function inselKarte(text) { const z = leer(30, 12); mit(z, 5, 8, text); return { map: karte(z) }; }
// zwei Kameraden stehen an den Enden der Insel (>= 3 Kacheln auseinander und >= 3 vom Prüfplatz), der Prüfplatz liegt über der Mitte
function inselTest(text, erwartetStrafe, name) {
  const E = inselKarte(text);
  const ich = drone('ich', 28, 11), a = drone('a', 7, 5), b = drone('b', 8 + text.length, 5);
  const g = spiel([ich, a, b]);
  const platz = { x: 8 + Math.floor(text.length / 2), y: 4 };
  const d = squad._platzStrafe(g, E, ich, platz);
  ok(erwartetStrafe ? d > 0 : d === 0, name + ' (Strafe ' + d + ')');
  return { E, ich, platz, text };
}
{
  const t = inselTest('RRRRRRRR', true, 'freistehende Insel (8 Kacheln) mit 2 Gegnern: dritter Platz gilt als belegt');
  const g1 = spiel([t.ich, drone('a', 7, 5)]);
  ok(squad._platzStrafe(g1, t.E, t.ich, t.platz) === 0, 'mit nur 1 Gegner an der Insel bleibt der Platz frei');
  inselTest('########', false, 'Wand (#) ist keine Insel im Sinne der Grenze');
  inselTest('RRRRRRRRRRRRR', false, 'Mauer aus 13 Kacheln (> inselKachelnMax) ist keine Insel');
  inselTest('RRRRRRRRRRRR', true, '12 Kacheln gelten noch als Insel');
  const ins = squad._inselnVon(t.E, 12);
  ok(ins.size === 8 && new Set(ins.values()).size === 1, 'inselnVon: eine Insel mit 8 Kacheln');
  const g3 = spiel([t.ich, drone('a', 7, 5), drone('b', 16, 5)], { inselMax: 3 });
  ok(squad._platzStrafe(g3, t.E, t.ich, t.platz) === 0, 'tune: inselMax 3 erlaubt den dritten Gegner');
  const g5 = spiel([t.ich, drone('a', 7, 5), drone('b', 28, 2, { x: 16, y: 5 })]);
  ok(squad._platzStrafe(g5, t.E, t.ich, t.platz) > 0, 'ein Gegner steht an der Insel, einer will hin: dritter Platz belegt');
}

console.log('\n[Messlauf, fester Seed]');
function mess(args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'mess-klumpen.js')].concat(args), { encoding: 'utf8', timeout: 240000 });
  const out = r.stdout || '';
  const m = /Anteil Gegner mit Kamerad <= 2 Kacheln ([0-9.]+)/.exec(out), f = /freistehende Inseln \(ohne Mauern\) im Gefecht: Gegner je Insel Maximum (\d+)/.exec(out);
  return { code: r.status, anteil: m ? +m[1] : NaN, inselMax: f ? +f[1] : NaN, out };
}
{
  const gr = mess(['graben', '--seeds', '2', '--sek', '60', '--lauf', '--alarm']);
  ok(gr.code === 0 && gr.anteil <= 0.45, 'Grabenangriff alarmiert, Seeds 1-2, 60 s: Anteil <= 2 Kacheln ' + gr.anteil + ' (Ausgangswert 0,84; Ziel 0,40 über 8 Seeds/120 s)');
  ok(gr.inselMax <= 2, 'Grabenangriff: höchstens 2 Gegner je freistehender Insel (' + gr.inselMax + ')');
  const ek = mess(['endkampf', '--seeds', '2', '--sek', '45']);
  ok(ek.code === 0 && ek.anteil <= 0.4, 'Eisenwald-Endkampf, Seeds 1-2, 45 s: Anteil <= 2 Kacheln ' + ek.anteil + ' (Ausgangswert 0,64)');
  ok(ek.inselMax <= 2, 'Endkampf: höchstens 2 Gegner je freistehender Insel (' + ek.inselMax + ')');
}

console.log(fails ? `\n${fails} von ${n} FEHLER` : `\nalle ${n} ok`);
process.exit(fails ? 1 : 0);
