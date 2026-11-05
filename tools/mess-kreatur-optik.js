#!/usr/bin/env node
'use strict';
// MON-02 O3a: Messung zu Kollisionsbox und Trefferradius des Rudeltiers (Messskript, kein Test, kein Gate-Wert).
// Regel „was man sieht, trifft und blockiert“: das Modell ist 1,0 m lang (32 px), die Box war 20 px, der Trefferradius 13 px.
//   node tools/mess-kreatur-optik.js [--box N] [--radius N] [--json]
// Ohne Optionen gelten die Werte aus content/kampf/kreaturen.json (Typ rudeltier); --box und --radius übersteuern sie NUR im Lauf (Vorher-Nachher).
// Misst im echten Spiel (Game, Karte kesh, Blaster):
//   statisch    Breite der Schusslinie, auf der ein ruhendes Tier getroffen wird (Versatz −30..+30 px, 1-px-Schritte): trifft = Schild sinkt
//   querlaufend Tier läuft mit 45 und 90 px/s (Patrouille, Jagd) quer zur Schusslinie; Zielpunkt = Tierposition beim Abdrücken (ohne Vorhalt), Trefferquote über Startphasen
const CONFIG = require('../shared/config.js');
const Mon = require('../shared/monster.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const away = require('../server/sim/away.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : null; };
const RT = KREATUREN.typen.rudeltier;
const BOX = arg('--box') || RT.kollision.box, RADIUS = arg('--radius') || RT.hitRadius;
const DT = 1 / CONFIG.tickHz, TILE = 32;
// ruhende Testzeile mit den Maßen des Rudeltiers (Modus steht: bewegt sich nicht von selbst)
KREATUREN.typen.messstill = { name: 'kreatur.messstill', groesse: 1, sicht: 4, verlustZeit: 3, replan: 0.5, hitRadius: RADIUS, kollision: { box: BOX }, schild: { seg: 3, max: 3 }, wunden: 2, frontArc: 0, tuerenAufbrechen: false, rammZeit: 1.2, start: 'steht',
  zustaende: { steht: { modus: 'steht', tempo: 0, uebergang: [] } }, bausteine: {} };
Kreatur.kreaturBausteinAnmelden('__cache__', {})();

function szene() {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Mess', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  g.setAwayMap('kesh'); g.aways.kesh.active = true;
  const p = g.players[0]; require('../server/sim/interior.js').placeOnAwayPad(g, p, 0); combat.onArrive(g, p); g.god = true;
  const aw = g.aways.kesh; aw.drones.length = 0; aw.kreaturen = [];
  const E = combat.env(g), kart = g.karteOf(aw.map); let bahn = null;
  for (let ty = 3; ty < kart.h - 3 && !bahn; ty++) for (let tx = 2; tx < kart.w - 16; tx++) {
    let frei = true; for (let i = 0; i <= 14 && frei; i++) if (E.solid(tx + i, ty) || E.shotBlocked(tx + i, ty)) frei = false;
    if (frei) { bahn = { tx, ty }; break; }
  }
  if (!bahn) throw new Error('keine freie Bahn auf kesh');
  return { g, c, p, aw, bahn };
}
// Ein Schuss entlang +x; das Tier steht 6 Kacheln vor dem Schützen, seitlich um dy versetzt, und läuft optional mit vy px/s quer (+y) ab dem Abdrücken.
let SZ = null;
function schuss(dy, vy, phase) {
  const S = SZ || (SZ = szene()); const { g, p } = S;
  S.aw.kreaturen = [];
  const q = Physics.tileCenter(S.bahn.tx, S.bahn.ty); p.x = q.x; p.y = q.y; p.input.mx = 0; p.input.my = 0;
  const kp = Physics.tileCenter(S.bahn.tx + 6, S.bahn.ty);
  const K = Kreatur.erzeugen(g, 'messstill', kp.x, kp.y + dy + (vy ? -vy * phase : 0)); K.facing = Math.PI;
  const kf = combat.kaempfer(g, p); kf.waffe = 'blaster'; kf.hitze = 0; kf.gesperrtBis = 0; kf.bereitAt = 0; kf.ladung = null; kf.ausholen = null;
  away.shoot(g, p, 0);
  for (let k = 0; k < Math.round(1.0 / DT); k++) { if (vy) K.y += vy * DT; g.step(); }
  return K.seg < 3;
}
const ergebnis = { box: BOX, hitRadius: RADIUS };
// statisch
let lo = null, hi = null, n = 0;
for (let dy = -30; dy <= 30; dy++) { if (schuss(dy, 0, 0)) { n++; if (lo === null) lo = dy; hi = dy; } }
ergebnis.statisch = { trefferBreitePx: n, von: lo, bis: hi };
// querlaufend: Startphasen so, dass das Tier die Linie zu verschiedenen Zeiten kreuzt (Kreuzung nach 0,1..0,5 s); Trefferquote = Anteil der Phasen mit Treffer
ergebnis.quer = {};
for (const v of [45, 90]) {
  let t = 0, m = 0;
  for (let ph = 0.02; ph <= 0.5; ph += 0.02) { m++; if (schuss(0, v, ph)) t++; }
  ergebnis.quer[v + ' px/s'] = { phasen: m, treffer: t, quote: Math.round(t / m * 100) + ' %' };
}
console.log(process.argv.includes('--json') ? JSON.stringify(ergebnis) : 'Box ' + BOX + ' px, hitRadius ' + RADIUS + ' px\n  statisch: Schusslinie trifft auf ' + n + ' px Breite (' + lo + '..' + hi + ')\n' + Object.entries(ergebnis.quer).map(([k, r]) => '  quer ' + k + ': ' + r.treffer + ' von ' + r.phasen + ' Phasen (' + r.quote + ')').join('\n'));
void Mon; void away;
