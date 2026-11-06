'use strict';
// MON-02 G: Größe 1 im Kreaturen-Rahmen (Mitte je Größe, Box und Trefferradius je Größe aus den Daten, Maske ohne Randfehler, Validator 1 und 2).
// Echtes Spiel (Game): Station Helix (Gänge, Schotts) und echte Wildnis-Karten (Wiesenwald, Wüste, Vulkan). Je Größe (1 und 2):
//   Mitte (Kachelmitte bzw. Kachelecke), Position beim Anlegen, Bewegung (Streife, Verfolgen auf 8 Wegen), Box überlappt nie eine feste Kachel, kein Festfahren (Anti-Hängen löst nicht aus),
//   Rammen in Baum und Fels mit Positionsmessung (steckt), Kreatur-Treffer mit eigenem hitRadius, Validator (Größe, kollision.box). Station-Monster und `probe` bitgleich: tools/test-kreatur.js (Fixture).
// Die Typen mit Größe 1 sind Testzeilen (der Server kennt keine Typnamen); `probe` ist Größe 2.
//   node tools/test-kreatur-groesse.js   (npm run test:kreatur-groesse)
const CONFIG = require('../shared/config.js');
const Mon = require('../shared/monster.js');
const Physics = require('../shared/physics.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const space = require('../server/sim/space.js');
const Welt = require('../server/sim/welt.js');
const away = require('../server/sim/away.js');
const Anker = require('../server/sim/anker.js');
const Monster = require('../server/sim/monster.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');
const H = require('./gel02-hilfen.js');

const DT = 1 / CONFIG.tickHz;
const TILE = 32;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const kopie = (o) => JSON.parse(JSON.stringify(o));

// ---------- Testtypen (Datenzeilen): Größe 1 mit Box und hitRadius des echten Rudeltiers (MON-02 O3a: Werte aus content/kampf/kreaturen.json, nicht fest), Größe 1 ohne kollision (Rückfall 14), Größe 1 mit großem Radius; probe ist Größe 2 ----------
const probe = KREATUREN.typen.probe;
const RUD = KREATUREN.typen.rudeltier, KB = RUD.kollision.box, KH = RUD.hitRadius;   // Box (px) und Trefferradius (px) des echten Rudeltiers
KREATUREN.typen.klein = Object.assign(kopie(probe), { name: 'kreatur.klein', groesse: 1, hitRadius: KH, kollision: { box: KB } });
KREATUREN.typen.kleinrueck = Object.assign(kopie(probe), { name: 'kreatur.kleinrueck', groesse: 1, hitRadius: 13 });
const STILL = { name: 'kreatur.kleinstill', groesse: 1, sicht: 4, verlustZeit: 3, replan: 0.5, hitRadius: KH, kollision: { box: KB }, schild: { seg: 3, max: 3 }, wunden: 2, frontArc: 0, tuerenAufbrechen: false, rammZeit: 1.2, start: 'steht',
  zustaende: { steht: { modus: 'steht', tempo: 0, uebergang: [] } }, bausteine: {} };
KREATUREN.typen.kleinstill = STILL;
KREATUREN.typen.kleinbreit = Object.assign(kopie(STILL), { name: 'kreatur.kleinbreit', hitRadius: 30 });
Kreatur.kreaturBausteinAnmelden('__cache__', {})();   // Anmelden/Abmelden verwirft die geprüften Daten: die Testtypen werden beim nächsten Gebrauch geprüft und geladen
const GROESSEN = { 1: 'klein', 2: 'probe' };
const boxVon = (typId) => { const t = KREATUREN.typen[typId]; return t.kollision && t.kollision.box != null ? t.kollision.box : t.groesse * 14; };

// ---------- Messhilfen ----------
// Überlappt die Box (Kantenlänge b, Mitte x/y) eine feste Kachel? Messung wie bei Physics.boxHits (E.solid(tx, ty))
function boxUeberlappt(E, x, y, b) {
  const x0 = Math.floor((x - b / 2) / TILE), x1 = Math.floor((x + b / 2 - 0.001) / TILE), y0 = Math.floor((y - b / 2) / TILE), y1 = Math.floor((y + b / 2 - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (E.solid(tx, ty)) return true;
  return false;
}
// Kreatur ohne g.step bewegen (nur Kreatur.update): kein Spieler am Boden in Sicht (downed), Zeit läuft mit
function lauf(g, sek, each) { for (let i = 0, N = Math.round(sek / DT); i < N; i++) { if (each && each(i * DT) === true) return true; g.time += DT; Kreatur.update(g, DT); } return false; }
function neueKreatur(g, typId, anker) {
  const typ = KREATUREN.typen[typId]; const pos = Mon.mitteVon(anker, typ.groesse);
  return Kreatur.erzeugen(g, typId, pos.x, pos.y);
}
function stationRoh() {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Kre', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' }); g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund'); g.god = true; space.enterScene(g, 'helix', {});
  const sc = Locations.get('helix').scene; g.ship.x = sc.station.x - 100; g.ship.y = sc.station.y;
  for (let k = 0; k < Math.round(0.2 / DT); k++) g.step();
  g.chooseLandepunkt(g.players[0], 'helix.station');
  away.executeBeam(g, g.players.map((q) => q.id), 'down');
  for (let k = 0; k < Math.round(0.3 / DT); k++) g.step();
  g.away.monster = null;   // kein Station-Monster
  return fertig(g, g.karteOf(g.away.map), 'Helix');
}
// Station mit offenen Schotts: die Wege der Maske sind begehbar (die Türen prüft ein eigener Abschnitt)
function stationSzene() {
  const S = stationRoh();
  for (const kid of Object.keys(S.k.kanten || {})) Anker.setzen(S.g, S.g.away.map, kid, 'offen', null, { still: true });
  S.E = combat.env(S.g);
  return S;
}
function wildnisSzene(biom, seed, groesse) {
  const s = H.neuesSpiel(1, { art: 'wildnis', seed, groesse: groesse || 'mittel', biom });
  s.g.away.drones = [];
  return fertig(s.g, s.k, 'Wildnis ' + biom + ' ' + seed);
}
function fertig(g, k, name) {
  const p = g.players[0]; g.god = true; p.downed = true;   // weder wahrgenommen noch verwundbar: die Kreatur geht nur dorthin, wohin der Test sie schickt
  combat.ensureV2(g, g.away); g.away.kreaturen = [];
  return { g, k, p, name, E: combat.env(g), m: { 1: Monster.maskeVonGroesse(k, 1), 2: Monster.maskeVonGroesse(k, 2) } };
}
// Startanker: nächster Ankerpunkt zum Abholpunkt (Radius 4, wie Mon.pruefen)
function startVon(S, fuss) {
  const m = S.m[fuss];
  const A = S.k.anker.find((a) => a.ankunft) || S.k.anker.find((a) => a.rolle === 'abholpunkt') || { x: Math.floor(S.p.x / TILE), y: Math.floor(S.p.y / TILE) };
  return Mon.naechster(m, A.x, A.y, 4);
}
// Weg kreuzt eine GESCHLOSSENE Tür (Schott): dann entscheidet das Türen-Verhalten, nicht die Bewegung (eigener Test in test-kreatur.js). In der Station sind alle Schotts offen.
function kreuztKante(E, weg, fuss) {
  const kanteAt = E.info && E.info.kanteAt; if (!kanteAt) return false;
  return weg.some((a) => Mon.fussKacheln(a, fuss).some((t) => kanteAt.get(t.x + ',' + t.y) && E.solid(t.x, t.y)));
}
// 8 Wege: Start und Ziel aus den erreichbaren Ankerpunkten (gleichmäßig gestreut, deterministisch), Weglänge 10 bis 120 Schritte, ohne Türkante
function wege(S, fuss, anzahl) {
  const m = S.m[fuss]; const s0 = startVon(S, fuss); const d = Mon.bfs(m, [s0]);
  const pool = []; for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) if (d[cy * m.w + cx] >= 0) pool.push({ cx, cy });
  const out = [];
  const schritt = Math.max(1, Math.floor(pool.length / (anzahl * 5)));
  for (let i = 0, j = Math.floor(pool.length / 3); out.length < anzahl && i < pool.length * 2; i++, j = (j + schritt * 7 + 3) % pool.length) {
    const a = pool[(i * schritt) % pool.length], b = pool[j];
    const w = Mon.weg(m, a, b, 20000);
    if (!w || w.length < 10 || w.length > 120 || kreuztKante(S.E, w, fuss)) continue;
    out.push({ von: a, nach: b, laenge: w.length });
  }
  return out;
}
// Ein Weg im Zustand jagd: die Kreatur verfolgt `letzte` (Kachelmitte des Ziels, wie ein Spieler dort); gemessen werden Ankunft, Überlappung der Box mit festen Kacheln und stuckT
function wegLaufen(S, typId, w) {
  const typ = KREATUREN.typen[typId], b = boxVon(typId);
  S.g.away.kreaturen = [];
  const K = neueKreatur(S.g, typId, w.von);
  Kreatur.zustandSetzen(S.g, K, 'jagd');
  const ziel = Mon.mitteVon(w.nach, typ.groesse);
  const R = { ueberlappt: 0, maxStuck: 0, ankunftS: null, errors: 0 };
  const grenze = w.laenge * TILE / typ.zustaende.jagd.tempo * 2.5 + 4;   // 2,5 × die reine Laufzeit
  const fertig = lauf(S.g, grenze, (t) => {
    K.verlust = 0; K.letzte = { x: (w.nach.cx + 0.5) * TILE, y: (w.nach.cy + 0.5) * TILE };
    if (boxUeberlappt(S.E, K.x, K.y, b)) R.ueberlappt++;
    R.maxStuck = Math.max(R.maxStuck, K.stuckT);
    const a = Mon.ankerVonPosition(K.x, K.y, typ.groesse);   // angekommen = im Ankerpunkt des Ziels (liegt er schon im Zielpunkt, plant verfolge keinen Schritt mehr)
    if (a.cx === w.nach.cx && a.cy === w.nach.cy) { R.ankunftS = t; return true; }
    return false;
  });
  R.ok = fertig; R.abstand = Math.round(Math.hypot(K.x - ziel.x, K.y - ziel.y));
  return R;
}

// Die Wildnis-Karte liegt je Spiel unter einer gemeinsamen Karten-ID (W.AWAY_MAPS): ein neues Spiel ersetzt die Karte des vorigen. Darum immer nur EINE Szene zugleich benutzen und je Szene alles in einem Zug messen.
const SZENEN = [['Helix', () => stationSzene()], ['Wildnis wiesenwald 3', () => wildnisSzene('wiesenwald', 3)], ['Wildnis wueste 11', () => wildnisSzene('wueste', 11)], ['Wildnis vulkan 20', () => wildnisSzene('vulkan', 20)]];
const fuerSzenen = (fn) => { for (let i = 0; i < SZENEN.length; i++) fn(SZENEN[i][1](), i); };

// ---------- Mitte je Größe (reine Funktionen) ----------
section('Mitte je Größe', () => {
  ok(Mon.FUSS === 2 && JSON.stringify(Mon.mitteVon({ cx: 5, cy: 7 }, 1)) === '{"x":176,"y":240}', 'Größe 1: Mitte = Kachelmitte ((5+½)·32, (7+½)·32 = 176, 240)');
  ok(JSON.stringify(Mon.mitteVon({ cx: 5, cy: 7 }, 2)) === '{"x":160,"y":224}' && JSON.stringify(Mon.mitteVon({ cx: 5, cy: 7 })) === '{"x":160,"y":224}', 'Größe 2 (und ohne Angabe): Mitte = Kachelecke (160, 224)');
  ok(JSON.stringify(Mon.mitte({ cx: 5, cy: 7 })) === JSON.stringify(Mon.mitteVon({ cx: 5, cy: 7 }, 2)) && JSON.stringify(Mon.ankerVon(176, 240)) === '{"cx":6,"cy":8}' && JSON.stringify(Mon.ankerVonPosition(176, 240, 2)) === '{"cx":6,"cy":8}', 'mitte/ankerVon bleiben der Fußabdruck 2 der Station (Position 176, 240 liegt zwischen den Ecken und rundet auf (6, 8), nicht auf die Kachel (5, 7))');
  ok(JSON.stringify(Mon.ankerVonPosition(176, 240, 1)) === '{"cx":5,"cy":7}' && JSON.stringify(Mon.ankerVonPosition(161, 255.9, 1)) === '{"cx":5,"cy":7}' && JSON.stringify(Mon.ankerVonPosition(160, 224, 1)) === '{"cx":5,"cy":7}' && JSON.stringify(Mon.ankerVonPosition(159.9, 223.9, 1)) === '{"cx":4,"cy":6}', 'Größe 1: Position -> die Kachel, in der sie liegt');
  const F1 = Mon.fussKacheln({ cx: 3, cy: 4 }, 1), F2 = Mon.fussKacheln({ cx: 3, cy: 4 }, 2);
  ok(JSON.stringify(F1) === '[{"x":3,"y":4}]' && JSON.stringify(F2) === '[{"x":2,"y":3},{"x":3,"y":3},{"x":2,"y":4},{"x":3,"y":4}]', 'Fußabdruck: Größe 1 = die Kachel, Größe 2 = (cx−1…cx, cy−1…cy) in der Reihenfolge der Station');
  // naechster: Ankerpunkt zu einer Kachel (Referenzkarte 5×5, Wandkacheln wie in test-kreatur.js; Größe 2 gegen den Stand von main 5956007 gerechnet, Größe 1 von Hand)
  const legende = { '.': { kind: 'boden', solid: false }, '#': { kind: 'wand', solid: true } };
  const k2 = { w: 5, h: 5, rows: ['.....', '.....', '..#..', '.....', '.....'], legende, anker: [] };
  const k1 = { w: 5, h: 5, rows: ['.....', '.....', '#.#..', '.....', '.....'], legende, anker: [] };
  const m2k = Mon.maske(k2), m1k = Mon.maske(k1, 1); const J = JSON.stringify;
  ok(J(Mon.naechster(m2k, 2, 2, 1)) === '{"cx":2,"cy":1}' && Mon.naechster(m2k, 2, 2, 0) === null && J(Mon.naechster(m2k, 0, 0, 1)) === '{"cx":1,"cy":1}' && J(Mon.naechster(m2k, 4, 4, 2)) === '{"cx":4,"cy":4}' && J(Mon.naechster(m2k, 2, 2, 3)) === '{"cx":2,"cy":1}', 'naechster Größe 2 unverändert (5 Referenzfälle, gegen main gerechnet)');
  ok(J(Mon.naechster(m1k, 2, 2, 1)) === '{"cx":2,"cy":1}' && Mon.naechster(m1k, 2, 2, 0) === null && J(Mon.naechster(m1k, 0, 2, 1)) === '{"cx":0,"cy":1}' && J(Mon.naechster(m1k, 4, 4, 1)) === '{"cx":4,"cy":4}' && J(Mon.naechster(m1k, 3, 3, 0)) === '{"cx":3,"cy":3}', 'naechster Größe 1: die Kachel selbst, sonst der nächste Nachbar nach Abstand zur Kachelmitte (Wand (2,2) -> (2,1))');
  const S = stationSzene();
  for (const f of [1, 2]) {
    const m = S.m[f]; let nA = 0, hin = true, mod = true;
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
      if (!m.geht(cx, cy)) continue; nA++;
      const p = Mon.mitteVon({ cx, cy }, f), a = Mon.ankerVonPosition(p.x, p.y, f);
      if (a.cx !== cx || a.cy !== cy) hin = false;
      if (f === 1 ? (p.x % TILE !== 16 || p.y % TILE !== 16) : (p.x % TILE !== 0 || p.y % TILE !== 0)) mod = false;
    }
    ok(nA > 100 && hin && mod, 'Helix, Größe ' + f + ': alle ' + nA + ' Ankerpunkte der Maske: Position -> Anker -> Position stimmt, Mitte auf ' + (f === 1 ? 'Kachelmitte (16 px)' : 'Kachelecke (0 px)'));
  }
});

// ---------- Maske und Fußabdruck gegen die Karte ----------
section('Maske: Fußabdruck frei, Größe 1 deckt jede Spielerkachel', () => {
  fuerSzenen((S) => {
    for (const f of [1, 2]) {
      const m = S.m[f]; let nA = 0, schlecht = 0, rand = 0;
      for (let cy = -1; cy <= m.h; cy++) for (let cx = -1; cx <= m.w; cx++) {
        const g = m.geht(cx, cy);
        const inKarte = Mon.fussKacheln({ cx, cy }, f).every((t) => t.x >= 0 && t.y >= 0 && t.x < m.w && t.y < m.h);
        if (g && !inKarte) rand++;
        if (!g) continue; nA++;
        if (!Mon.fussKacheln({ cx, cy }, f).every((t) => m.frei[t.y * m.w + t.x] === 1)) schlecht++;
      }
      ok(nA > 0 && schlecht === 0 && rand === 0, S.name + ', Größe ' + f + ': ' + nA + ' Ankerpunkte, jeder Fußabdruck frei und innerhalb der Karte (Fehler ' + schlecht + ', Rand ' + rand + ')');
    }
    let frei = 0, g1 = 0; const m1 = S.m[1]; for (let y = 0; y < m1.h; y++) for (let x = 0; x < m1.w; x++) { if (m1.frei[y * m1.w + x]) { frei++; if (m1.geht(x, y)) g1++; } }
    ok(frei === g1, S.name + ': Größe 1 = jede freie Kachel ist ein Ankerpunkt (' + g1 + ' von ' + frei + ')');
  });
});

// ---------- Anlegen: Debug und erzeugen liegen auf der Mitte je Größe ----------
section('Position beim Anlegen (Debug kreatur <typ>)', () => {
  for (const [f, typId] of [[1, 'klein'], [2, 'probe']]) {
    const S = stationSzene(); const g = S.g; S.p.downed = false;
    // Spieler in einen freien Gang der Maske
    const a0 = startVon(S, f); const q = Mon.mitteVon(a0, 1); S.p.x = q.x; S.p.y = q.y;
    const alt = g.debug; g.debug = true;
    Kreatur.debugKreatur(g, S.p, typId);
    g.debug = alt;
    const K = g.away.kreaturen[0];
    const a = Mon.ankerVonPosition(K.x, K.y, f);
    ok(!!K && KREATUREN.typen[typId].groesse === f && S.m[f].geht(a.cx, a.cy) && Mon.mitteVon(a, f).x === K.x && Mon.mitteVon(a, f).y === K.y, 'Größe ' + f + ': Debug legt die Kreatur auf die Mitte eines Maskenpunkts (' + K.x + ', ' + K.y + ')');
    ok(f === 1 ? (K.x % TILE === 16 && K.y % TILE === 16) : (K.x % TILE === 0 && K.y % TILE === 0), 'Größe ' + f + ': ' + (f === 1 ? 'Kachelmitte' : 'Kachelecke'));
    ok(boxVon(typId) === (f === 1 ? KB : 28) && K.hitRadius === KREATUREN.typen[typId].hitRadius, 'Größe ' + f + ': Box ' + boxVon(typId) + ' px, hitRadius ' + K.hitRadius + ' aus den Daten');
  }
});

// ---------- Kontrolle der Messung: eine Box auf der Kachelecke neben einer Wand ragt in sie (so sah der Fehler vorher aus) ----------
section('Kontrolle der Überlappungs-Messung', () => {
  const S = stationSzene();
  // Ecke: freier Ankerpunkt (Größe 1) mit fester Kachel rechts: Box 28 auf der Kachelecke dazwischen überlappt, Box KB auf der Kachelmitte nicht
  const m = S.m[1]; let gef = null;
  for (let cy = 1; cy < m.h - 1 && !gef; cy++) for (let cx = 1; cx < m.w - 1; cx++) if (m.geht(cx, cy) && !m.frei[cy * m.w + cx + 1] && S.E.solid(cx + 1, cy)) { gef = { cx, cy }; break; }
  ok(!!gef, 'Stelle mit fester Kachel neben einem Ankerpunkt gefunden');
  ok(boxUeberlappt(S.E, (gef.cx + 1) * TILE, (gef.cy + 0.5) * TILE, 28), 'Kontrolle: Box 28 auf der Kachelecke vor der festen Kachel überlappt (die Messung schlägt an)');
  ok(!boxUeberlappt(S.E, (gef.cx + 0.5) * TILE, (gef.cy + 0.5) * TILE, KB), 'Box ' + KB + ' auf der Kachelmitte: keine Überlappung');
});

// ---------- Bewegung: Streife (Patrouille) und Verfolgen auf 8 Wegen, je Szene ----------
fuerSzenen((S) => {
  section('Bewegung in der Szene ' + S.name, () => {
    for (const f of [1, 2]) {
      const typId = GROESSEN[f]; const b = boxVon(typId);
      // Streife: 60 s Patrouille (streife wählt Ziele über aw.rng)
      S.g.away.kreaturen = [];
      const K = neueKreatur(S.g, typId, startVon(S, f));
      let ueber = 0, maxStuck = 0, weit = 0; const x0 = K.x, y0 = K.y;
      lauf(S.g, 60, () => { if (boxUeberlappt(S.E, K.x, K.y, b)) ueber++; maxStuck = Math.max(maxStuck, K.stuckT); weit = Math.max(weit, Math.hypot(K.x - x0, K.y - y0)); return false; });
      ok(ueber === 0 && maxStuck < 3 && weit > 3 * TILE, 'Größe ' + f + ': 60 s Streife: Box überlappt 0 mal feste Kacheln (' + ueber + '), höchstens ' + maxStuck.toFixed(2) + ' s ohne Fortschritt (< 3, Anti-Hängen löst nicht aus), weiteste Entfernung ' + Math.round(weit) + ' px');
      // Verfolgen: 8 Wege
      const W = wege(S, f, 8);
      let erreicht = 0, uebW = 0, stuck = 0; const schlecht = [];
      for (const w of W) {
        const r = wegLaufen(S, typId, w);
        if (r.ok) erreicht++; else schlecht.push(JSON.stringify(w.von) + '->' + JSON.stringify(w.nach) + ' Abstand ' + r.abstand);
        uebW += r.ueberlappt; if (r.maxStuck >= 3) stuck++;
      }
      ok(W.length === 8 && erreicht === 8 && uebW === 0 && stuck === 0, 'Größe ' + f + ': ' + erreicht + ' von ' + W.length + ' Wegen erreichen das Ziel (Längen ' + W.map((w) => w.laenge).join('/') + '), Überlappungen ' + uebW + ', Anti-Hängen ausgelöst ' + stuck + (schlecht.length ? ' | ' + schlecht.slice(0, 2).join('; ') : ''));
    }
  });
});

// ---------- Gehen aus der Mitte heraus: 1 breiter Gang, Start 5 px neben der Mitte (die Box muss in die Kachel passen) ----------
let engGefunden = 0;
fuerSzenen((S) => {
  section('Engstelle (1 breiter Gang) in der Szene ' + S.name, () => {
    // waagerechter Lauf von 7 Kacheln, oben und unten fest
    const m = S.m[1]; let st = null;
    for (let cy = 1; cy < m.h - 1 && !st; cy++) for (let cx = 1; cx < m.w - 8 && !st; cx++) {
      let gut = true; for (let d = 0; d < 7 && gut; d++) if (!m.geht(cx + d, cy) || S.E.solid(cx + d, cy - 1) === false || S.E.solid(cx + d, cy + 1) === false) gut = false;
      if (gut) st = { cx, cy };
    }
    if (!st) { console.log('  (kein 1 breiter Gang in dieser Szene)'); return; }
    engGefunden++;
    const typ = KREATUREN.typen.klein, b = boxVon('klein');
    for (const aufbrechen of [false, true]) for (const dy of [Math.min(5, (TILE - KB) / 2 - 1), -Math.min(5, (TILE - KB) / 2 - 1)]) {   // Start neben der Mitte, die Box bleibt in der Kachel
      typ.tuerenAufbrechen = aufbrechen;
      try {
        S.g.away.kreaturen = [];
        const von = Mon.mitteVon({ cx: st.cx, cy: st.cy }, 1);
        const K = Kreatur.erzeugen(S.g, 'klein', von.x, von.y + dy); Kreatur.zustandSetzen(S.g, K, 'jagd');
        const ziel = { cx: st.cx + 6, cy: st.cy }; let ueber = 0;
        const fertig = lauf(S.g, 6, () => { K.verlust = 0; K.letzte = { x: (ziel.cx + 0.5) * TILE, y: (ziel.cy + 0.5) * TILE }; if (boxUeberlappt(S.E, K.x, K.y, b)) ueber++; const a = Mon.ankerVonPosition(K.x, K.y, 1); return a.cx === ziel.cx && a.cy === ziel.cy; });
        ok(fertig && ueber === 0, 'Größe 1 (Box ' + b + '), tuerenAufbrechen ' + aufbrechen + ', Start ' + dy + ' px neben der Mitte: geht 6 Kacheln durch den 1 breiten Gang (' + (fertig ? 'angekommen' : 'steckt bei x ' + Math.round(K.x)) + ', Überlappung ' + ueber + ')');
      } finally { typ.tuerenAufbrechen = false; }
    }
  });
});
section('Engstelle: mindestens ein 1 breiter Gang gefunden', () => { ok(engGefunden >= 1, 'in ' + engGefunden + ' von ' + SZENEN.length + ' Szenen (Wildnis-Wege sind 1 bis 2 Kacheln breit)'); });

// ---------- Türen: Größe 1 prüft die Kachel des Ankerpunkts ----------
section('Türen: Größe 1 vor einem geschlossenen Schott', () => {
  const S = stationRoh(); const m = S.m[1];
  let sw = null;   // gerader Weg über eine Tür-Kachel eines Schotts: 3 Kacheln davor bis 3 Kacheln dahinter
  for (const [kid, kt] of Object.entries(S.k.kanten || {})) {
    if (sw || kt.typ !== 'schott' || !kt.tiles) continue;
    for (const [tx, ty] of kt.tiles) for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const vor = { cx: tx - 3 * dx, cy: ty - 3 * dy }, hin = { cx: tx + 3 * dx, cy: ty + 3 * dy };
      if (sw || !m.geht(vor.cx, vor.cy) || !m.geht(hin.cx, hin.cy)) continue;
      const w = Mon.weg(m, vor, hin, 4000);
      if (w && w.length <= 8 && w.some((a) => a.cx === tx && a.cy === ty)) sw = { kid, vor, hin, w, tx, ty };
    }
  }
  ok(!!sw, 'Schott mit geradem Weg über eine Tür-Kachel gefunden (' + (sw ? sw.kid + ', ' + sw.w.length + ' Schritte' : '-') + ')');
  if (!sw) return;
  const typ = KREATUREN.typen.klein;
  // beide Richtungen: in der einen liegt die Tür-Kachel im 2×2-Fußabdruck schon des Knotens davor (Fußabdruck-Fehler fiele dort auf), in der anderen erst im Knoten selbst
  const rueck = { kid: sw.kid, vor: sw.hin, hin: sw.vor, w: Mon.weg(m, sw.hin, sw.vor, 4000), tx: sw.tx, ty: sw.ty };
  for (const [name, r] of [['hin', sw], ['zurück', rueck]]) {
    const knoten = [r.vor].concat(r.w); const iTuer = knoten.findIndex((a) => a.cx === r.tx && a.cy === r.ty);
    const davor = Mon.mitteVon(knoten[iTuer - 1], 1);   // die Kreatur bleibt auf dem Knoten vor der Tür stehen
    for (const aufbrechen of [false, true]) {
      const T = stationRoh(); T.g.away.kreaturen = [];
      typ.tuerenAufbrechen = aufbrechen;
      try {
        ok(!Anker.setzen(T.g, T.g.away.map, r.kid, 'zu', null, { still: true }), 'Schott geschlossen (' + name + ')');
        const K = neueKreatur(T.g, 'klein', r.vor); Kreatur.zustandSetzen(T.g, K, 'jagd');
        const ziel = Mon.mitteVon(r.hin, 1);
        lauf(T.g, 9, () => { K.verlust = 0; K.letzte = { x: (r.hin.cx + 0.5) * TILE, y: (r.hin.cy + 0.5) * TILE }; return Math.hypot(K.x - ziel.x, K.y - ziel.y) < 3; });
        const z = Anker.zustand(T.g, T.g.away.map, r.kid);
        if (aufbrechen) ok(z === 'offen' && Math.hypot(K.x - ziel.x, K.y - ziel.y) < 3, 'Größe 1 (' + name + '), tuerenAufbrechen true: Schott aufgebrochen (' + z + '), Kreatur durch');
        else ok(z === 'zu' && Math.hypot(K.x - davor.x, K.y - davor.y) < 2, 'Größe 1 (' + name + '), tuerenAufbrechen false: Schott bleibt zu (' + z + '), Kreatur steht auf dem Ankerpunkt vor der Tür (' + K.x.toFixed(1) + ', ' + K.y.toFixed(1) + ' statt ' + davor.x + ', ' + davor.y + ')');
      } finally { typ.tuerenAufbrechen = false; }
    }
  }
});

// ---------- Rammen gegen Baum und Fels: steckt, Position an der Kante der Box ----------
section('Rammen: steckt vor Baum und Fels (Positionsmessung)', () => {
  const gefunden = { Y: null, F: null };
  for (const seed of [3, 11, 20, 29, 38, 47, 56, 65]) {
    if (gefunden.Y && gefunden.F) break;
    const S = wildnisSzene('wiesenwald', seed);
    for (const z of ['Y', 'F']) {
      if (gefunden[z]) continue;
      const stelle = (f) => { const m = S.m[f];
        for (let cy = 3; cy < S.k.h - 3; cy++) for (let cx = 2; cx < S.k.w - 9; cx++) {
          let frei = true; for (let d = 0; d < 6; d++) if (!m.geht(cx + d, cy)) { frei = false; break; }
          if (!frei) continue;
          const hx = cx + 6; const ch = (x, y) => S.k.rows[y][x];
          if (ch(hx, cy) === z && (f === 1 || ch(hx, cy - 1) === z)) return { cx, cy, hx };
        } return null; };
      const s1 = stelle(1), s2 = stelle(2);
      if (s1 && s2) gefunden[z] = { S, s: { 1: s1, 2: s2 } };
    }
  }
  for (const z of ['Y', 'F']) {
    const G = gefunden[z];
    ok(!!G, 'Stelle mit Hindernis ' + z + ' ' + (z === 'Y' ? '(Baum)' : '(Fels)') + ' in der Rammlinie gefunden');
    if (!G) continue;
    for (const [f, typId] of [[1, 'klein'], [2, 'probe'], [1, 'kleinrueck']]) for (const langsam of [false, true]) {
      const S = G.S; const st = G.s[f]; const b = boxVon(typId); const R = KREATUREN.typen[typId].zustaende.rammen;
      const tempo0 = R.tempo, dauer0 = R.dauer;
      if (langsam) { R.tempo = 60; R.dauer = 4; }   // 2 px je Tick: die Endlage zeigt die Box auf etwa 2 px genau (bei 260 px/s nur auf 8,7 px)
      try {
        S.g.away.kreaturen = [];
        const K = neueKreatur(S.g, typId, { cx: st.cx + (langsam ? 3 : 0), cy: st.cy });
        Kreatur.zustandSetzen(S.g, K, 'rammen'); K.facing = 0;
        const x0 = K.x, y0 = K.y; let steckt = null, ueber = 0;
        lauf(S.g, 3, (t) => { if (boxUeberlappt(S.E, K.x, K.y, b)) ueber++; if (K.z === 'steckt') { steckt = { t, x: K.x, y: K.y }; return true; } if (K.z !== 'rammen') return true; return false; });
        const kante = st.hx * TILE - b / 2;   // Mitte, bei der die Box die Kante der festen Kachel berührt
        const schritt = R.tempo * DT;
        ok(!!steckt && (langsam || steckt.t < 0.9 * 0.9) && steckt.x <= kante + 0.001 && steckt.x >= kante - schritt - 0.001 && ueber === 0 && steckt.y === y0,
          'Größe ' + f + ' (' + typId + ', Box ' + b + '), ' + z + ', ' + R.tempo + ' px/s: steckt nach ' + (steckt ? steckt.t.toFixed(2) : '-') + ' s bei x ' + (steckt ? steckt.x.toFixed(1) : '-') + ' (Kante der Box ' + kante + ', höchstens ' + schritt.toFixed(1) + ' px davor), Überlappung ' + ueber + ', Weg ' + (steckt ? Math.round(steckt.x - x0) : '-') + ' px');
      } finally { R.tempo = tempo0; R.dauer = dauer0; }
    }
  }
});

// ---------- Kreatur-Treffer: Projektil mit eigenem hitRadius (Größe 1) ----------
section('Treffer: Projektil auf Größe 1 mit eigenem hitRadius', () => {
  const szeneKesh = () => {
    const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Kre', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
    for (let k = 0; k < 6; k++) g.step();
    g.setAwayMap('kesh'); g.aways.kesh.active = true;
    const p = g.players[0]; require('../server/sim/interior.js').placeOnAwayPad(g, p, 0); combat.onArrive(g, p); g.god = true;
    const aw = g.aways.kesh; aw.drones.length = 0; aw.kreaturen = [];
    const E = combat.env(g), kart = g.karteOf(aw.map); let bahn = null;
    for (let ty = 2; ty < kart.h - 2 && !bahn; ty++) for (let tx = 2; tx < kart.w - 16; tx++) {
      let frei = true; for (let i = 0; i <= 14 && frei; i++) if (E.solid(tx + i, ty) || E.shotBlocked(tx + i, ty)) frei = false;
      if (frei) { bahn = { tx, ty }; break; }
    }
    if (!bahn) throw new Error('keine freie Bahn auf kesh');
    return { g, c, p, aw, bahn };
  };
  const schuss = (typId, dy) => {
    const S = szeneKesh(); const q = Physics.tileCenter(S.bahn.tx, S.bahn.ty); S.p.x = q.x; S.p.y = q.y; S.p.input.mx = 0; S.p.input.my = 0;
    const kp = Physics.tileCenter(S.bahn.tx + 6, S.bahn.ty);
    const K = Kreatur.erzeugen(S.g, typId, kp.x, kp.y + dy); K.facing = Math.PI;
    const kf = combat.kaempfer(S.g, S.p); kf.waffe = 'blaster'; kf.hitze = 0; kf.gesperrtBis = 0; kf.bereitAt = 0; kf.ladung = null; kf.ausholen = null;
    away.shoot(S.g, S.p, 0);
    for (let k = 0; k < Math.round(1.0 / DT); k++) S.g.step();
    return K;
  };
  const Kn = schuss('kleinstill', 6), Kf = schuss('kleinstill', 26), Kb = schuss('kleinbreit', 26);
  ok(Kn.hitRadius === KH && Kn.seg === 2, 'Größe 1, hitRadius ' + KH + ': Schuss 6 px neben der Linie trifft (seg ' + Kn.seg + ')');
  ok(Kf.seg === 3, 'Größe 1, hitRadius ' + KH + ': Schuss 26 px neben der Linie trifft nicht (seg ' + Kf.seg + ')');
  ok(Kb.hitRadius === 30 && Kb.seg === 2, 'Größe 1, hitRadius 30 (eigener Wert aus den Daten): derselbe Schuss 26 px daneben trifft (seg ' + Kb.seg + ')');
});

// ---------- Validator: Größe und kollision ----------
section('Validator: Größe 1 und 2, kollision.box', () => {
  const kaputt = (name, mut, erwartet) => { const k = kopie(KREATUREN); mut(k); const F = Kreatur.pruefen(k); ok(F.length > 0 && F.some((x) => x.includes(erwartet)), 'Validator lehnt ab: ' + name + (F.length ? ' (' + F.filter((x) => x.includes(erwartet))[0] + ')' : '')); };
  const gut = (name, mut) => { const k = kopie(KREATUREN); mut(k); const F = Kreatur.pruefen(k); ok(F.length === 0, 'Validator lässt zu: ' + name + (F.length ? ' (' + F[0] + ')' : '')); };
  for (const gr of [3, 4, 0, '1', 1.5, -1]) kaputt('klein.groesse ' + JSON.stringify(gr), (k) => { k.typen.klein.groesse = gr; }, 'muss 1 oder 2 sein');
  gut('Größe 1 mit kollision.box 20', () => {});
  gut('Größe 1 ohne kollision (Rückfall)', (k) => { delete k.typen.klein.kollision; });
  gut('probe (Größe 2) ohne kollision', () => {});
  gut('Größe 2 mit kollision.box 28', (k) => { k.typen.probe.kollision = { box: 28 }; });
  gut('Größe 1 mit kollision.box 24 (Obergrenze 32 − 8)', (k) => { k.typen.klein.kollision = { box: 24 }; });
  kaputt('Größe 1 mit kollision.box 25 (ragt zu nah an die Kachelkante)', (k) => { k.typen.klein.kollision = { box: 25 }; }, 'kollision.box');
  kaputt('Größe 1 mit kollision.box 3', (k) => { k.typen.klein.kollision = { box: 3 }; }, 'kollision.box');
  kaputt('kollision.box als Text', (k) => { k.typen.klein.kollision = { box: '20' }; }, 'kollision.box');
  kaputt('kollision ohne box', (k) => { k.typen.klein.kollision = {}; }, 'kollision.box');
  kaputt('kollision mit unbekanntem Feld', (k) => { k.typen.klein.kollision = { box: 20, form: 'rund' }; }, 'kollision.form');
  kaputt('kollision kein Objekt', (k) => { k.typen.klein.kollision = 20; }, 'kollision');
  kaputt('Größe 2 mit kollision.box 57', (k) => { k.typen.probe.kollision = { box: 57 }; }, 'kollision.box');
  ok(Kreatur.pruefen(KREATUREN).length === 0, 'Testtypen der Datei sind gültig (Validator ohne Befund)');
});

delete KREATUREN.typen.klein; delete KREATUREN.typen.kleinrueck; delete KREATUREN.typen.kleinstill; delete KREATUREN.typen.kleinbreit;
console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
