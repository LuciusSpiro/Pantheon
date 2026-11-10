'use strict';
// MON-03 B: Nest (Anker-Rolle `nest`, verdeckt), Abbau-Lärm als eigene Quelle für Kreaturen (Kreatur.laermHoeren), Baustein `gefolge` (Heimweg zur Königin). Echtes Spiel (Game), echte Höhle (art hoehle).
// Geprüft: (a) Nest ist genau ein Anker der Rolle nest (jede Größe, viele Seeds, Deck), auf freiem Boden ohne Kollision, NICHT im awayMap-Payload und in keinem Snapshot, Raster/übrige Anker bleiben (Fensterform);
//   nestBesetzen setzt die Königin an den Anker; (b) Abbau lockt Schwarmlinge innerhalb der Reichweite (Stufe aus CONFIG, koeder.faktor), nicht außerhalb (zwei Entfernungen), sie laufen zum Abbauenden;
//   (c) höchstens 3 Lärm-Ereignisse je Halt (Takt 2 s, Abbau 5 s), Dauerabbau (viele Halte, mit Verlusten) überschreitet max nie, Lärm erzeugt nie eine Kreatur; (d) Heimweg: nach Lockung läuft der
//   Schwarmling ohne Ziel zur Königin zurück (laerm, heim, schwaermen; Weg nachvollziehbar); (e) Drohnentrupps werden durch abbauLaerm NICHT geweckt (aw.laerm bleibt leer; Gegenprobe mit waffen.laerm weckt);
//   (f) kein Typname im Servercode und in shared/ (Wirkung aus Daten); Validator von gefolge.
//   node tools/test-schwarm-nest.js   (npm run test:schwarm-nest)
const fs = require('fs');
const path = require('path');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const Kreatur = require('../server/sim/kreatur.js');
const Monster = require('../server/sim/monster.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const Physics = require('../shared/physics.js');
const Mon = require('../shared/monster.js');
const Buehne = require('../shared/buehne.js');
const GenHoehle = require('../shared/gen-hoehle.js');
const CONFIG = require('../shared/config.js');
const KREATUREN = require('../content/kampf/kreaturen.json');
const Waffen = require('../server/sim/waffen.js');
const H = require('./gel02-hilfen.js');

const DT = 1 / CONFIG.tickHz;
const TILE = Physics.TILE;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const kopie = (o) => JSON.parse(JSON.stringify(o));
const BRUT = KREATUREN.typen.koenigin.bausteine.brut;
const KOEDER = KREATUREN.typen.schwarmling.bausteine.koeder;
const TAKT = CONFIG.anker.abbauLaermTakt, DAUER = CONFIG.anker.halten.abbau;
const STUFE = Buehne.daten().anker.rollen.abbau.laermStufe;   // Daten (content/buehnen/anker.json), nicht CONFIG: Tuning-Hash
const REICHWEITE = CONFIG.awayCombat.laerm[STUFE] * KOEDER.faktor;   // Kacheln, die ein Schwarmling den Abbau hört

// ---------- Szene: echte Höhle, Spieler unverwundbar, Königin am Nest ----------
function szene(seed, o) {
  o = o || {};
  let g, c, id, aw;
  if (o.drohnen) {   // Arena-Szene mit Lagern und Drohnentrupps (wie ?arena=away&art=hoehle)
    const s = H.neuesSpiel(1, { art: 'hoehle', seed, groesse: 'mittel' });
    g = s.g; c = g.cs[0]; id = s.map; aw = g.away;
  } else {
    g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
    c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'N0', name: 'Nest', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
    for (let i = 0; i < 6; i++) g.step();
    id = L.neu(g, g.ship.scene, { art: 'hoehle', seed });
    aw = L.get(g, id);
    g.setAwayMap(id); aw.active = true;
    for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
  }
  g.god = true;
  const S = { g, c, id, aw, k: W.AWAY_MAPS[id].karte, p: g.players[0], fehler: [], me: [], ev: [], drohnen: !!o.drohnen };
  g.countError = (w, e) => { S.fehler.push(w + ': ' + (e && e.message)); };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { S.me.push({ nm, d, t: g.time }); return m0(nm, d); };
  const e0 = g.emit.bind(g); g.emit = (nm, d) => { S.ev.push({ nm, d }); return e0(nm, d); };
  S.lauf = (sek, pro) => { for (let i = 0, N = Math.round(sek / DT); i < N; i++) { if (!S.drohnen) g.away.drones.length = 0; g.step(); if (pro) pro(i); } };
  S.me_ = (nm) => S.me.filter((x) => x.nm === nm);
  S.ev_ = (nm) => S.ev.filter((x) => x.nm === nm);
  S.nest = () => S.k.anker.find((a) => a.rolle === 'nest');
  S.koenigin = () => aw.kreaturen.find((K) => K.typ === 'koenigin');
  S.schwarm = () => aw.kreaturen.filter((K) => K.typ === 'schwarmling' && Kreatur.nichtEndgueltigErledigt(K));
  return S;
}
function mitKoenigin(S, gruppe) {
  const r = Kreatur.nestBesetzen(S.g, { map: S.id, typ: 'koenigin', gruppe: gruppe || 'nest' });
  if (r.fehler) throw new Error(r.fehler);
  if (!S.drohnen) S.g.away.drones.length = 0;
  S.g.step();   // erster Abgleich: Startbesatz
  return S.koenigin();
}
const tileOf = (o) => ({ cx: Math.floor(o.x / TILE), cy: Math.floor(o.y / TILE) });
const luft = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / TILE;
// Erreichbare Bodenkachel (Maske Größe 1) von (sx, sy) aus mit Luftlinie nahe `d` Kacheln zu (ox, oy); BFS über die Maske, deterministisch
function ortInAbstand(S, von, ox, oy, d) {
  const m = Monster.maskeVonGroesse(S.k, 1);
  const start = Mon.naechster(m, von.cx, von.cy, 3); if (!start) return null;
  const seen = new Set([start.cx + ',' + start.cy]), q = [start]; let best = null;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const dd = Math.hypot(a.cx + 0.5 - ox, a.cy + 0.5 - oy);
    if (Math.abs(dd - d) <= 0.6 && (!best || Math.abs(dd - d) < best.e)) best = { a, e: Math.abs(dd - d) };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = { cx: a.cx + dx, cy: a.cy + dy }; const key = b.cx + ',' + b.cy; if (!seen.has(key) && m.geht(b.cx, b.cy)) { seen.add(key); q.push(b); } }
  }
  return best ? Mon.mitteVon(best.a, 1) : null;
}
const aderIds = (S) => S.k.anker.filter((a) => GenHoehle.istAderKandidat(a)).map((a) => a.id);
const aderDa = (S) => aderIds(S).filter((id) => Anker.zustand(S.g, S.id, id) === 'da');
function zuAder(S, id) {
  const a = S.k.anker.find((q) => q.id === id), solid = interior.awaySolid(S.g);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!solid(a.x + dx, a.y + dy)) { const c = Physics.tileCenter(a.x + dx, a.y + dy); S.p.x = c.x; S.p.y = c.y; S.p.input.mx = 0; S.p.input.my = 0; return Physics.tileCenter(a.x, a.y); }
  throw new Error('keine freie Nachbarkachel an ' + id);
}
const act = (S, down) => S.g.handleMessage(S.c, { t: 'act', down });
const setzeAuf = (S, K, pos) => { K.x = pos.x; K.y = pos.y; K.pfad = []; K.replan = 0; K.ref = { x: pos.x, y: pos.y }; K.stuckT = 0; K.verlust = 99; K.letzte = null; K.koeder = null; Kreatur.zustandSetzen(S.g, K, 'schwaermen'); };

// ---------- (a) Nest ----------
section('(a) Nest: Rolle, Anker, verdeckt, ohne Kollision', () => {
  const A = require('../content/buehnen/anker.json');
  ok(A.rollen.nest && A.rollen.nest.objekt === null && A.rollen.nest.zustaende.length === 0 && A.rollen.nest.halten === null, 'anker.json: Rolle nest ohne Objekt, Zustand und Halten');
  ok(GenHoehle.VERSION === 3 && GenHoehle.PFLICHT.nest === 1 && GenHoehle.PFLICHT_DECK.nest === 1, 'Erzeuger: VERSION 3, Pflichtsatz nest 1 (Höhle und Deck)');
  let alle = 0, falsch = [];
  const gen = GenHoehle.erzeuger();
  for (const gr of ['klein', 'mittel', 'gross']) for (let s = 1; s <= 25; s++) {
    for (const art of ['karte', 'deck']) {
      let r; try { r = art === 'karte' ? gen.karteRoh(s, { groesse: gr }) : gen.deckRoh(s, { w: GenHoehle.GROESSEN[gr].w, h: Math.min(GenHoehle.GROESSEN[gr].h, 42), eingangX: 20 }); } catch (e) { falsch.push(gr + s + art + ': ' + e.message); continue; }
      alle++;
      const ne = r.anker.filter((a) => a.rolle === 'nest');
      const rows = r.rows;
      const fenster = ne.length === 1 && (() => { for (let y = ne[0].y - 1; y <= ne[0].y + 1; y++) for (let x = ne[0].x - 1; x <= ne[0].x + 1; x++) if (rows[y][x] !== ',') return false; return true; })();
      const frei = ne.length === 1 && r.anker.every((a) => a === ne[0] || Math.max(Math.abs(a.x - ne[0].x), Math.abs(a.y - ne[0].y)) >= 3);
      if (!(ne.length === 1 && fenster && frei && /^hoehle\.nest$/.test(ne[0].id))) falsch.push(gr + s + art);
    }
  }
  ok(alle === 150 && falsch.length === 0, 'genau ein Anker nest (hoehle.nest) auf freiem 3x3-Boden, Abstand >= 3 zu jedem anderen Anker: ' + alle + ' Karten und Decks, Fehler: ' + falsch.slice(0, 3).join(' | '));
  const S = szene(5);
  const ne = S.nest();
  ok(!!ne && !Buehne.ankerBlockiert(ne) && !interior.awaySolid(S.g)(ne.x, ne.y), 'Nest ohne Kollision (ankerBlockiert falsch, Server-Kollision frei)');
  const pay = S.g.awayMapPayload(S.k);
  const text = JSON.stringify(pay);
  ok(!pay.anker.some((z) => z[1] === 'nest') && !text.includes('"nest"') && !text.includes(ne.id), 'awayMap-Payload: kein Anker der Rolle nest, weder Rolle noch Id im Payload');
  ok(Anker.payloadAnker(S.k).every((a) => a.rolle !== 'nest') && Anker.ankerListe(S.g, S.aw, S.k).every((a) => a.rolle !== 'nest'), 'payloadAnker und ankerListe (Index für ao, sp, cd) enthalten keinen nest');
  const Q = mitKoenigin(S);
  ok(!!Q && Math.hypot(Q.x - (ne.x + 0.5) * TILE, Q.y - (ne.y + 0.5) * TILE) <= 4 * TILE, 'nestBesetzen: die Königin sitzt am Nest (Abstand ' + (Math.hypot(Q.x - (ne.x + 0.5) * TILE, Q.y - (ne.y + 0.5) * TILE) / TILE).toFixed(1) + ' Kacheln)');
  ok(S.aw.kreaturGruppen.nest.erschienen === 1 && S.schwarm().length === BRUT.anfang && S.fehler.length === 0, 'Buchführung der Gruppe und Startbesatz ' + BRUT.anfang + ' nach dem ersten Abgleich (Fehler: ' + S.fehler.join('|') + ')');
  // Position der Königin steht nirgends in Karten- oder Scandaten (Scan-Qualität 3 ist Paket C): Snapshot ohne Scan, Anker, Karte
  const sn = JSON.stringify(S.g.snapshot().away || {});
  S.lauf(1);
  const sn2 = S.g.snapshot().away || {};
  ok(!JSON.stringify(sn2.sc || []).includes('"koenigin"') && !(sn2.sc || []).some((r) => r[0] && /koenigin/.test(String(r[0]))), 'Snapshot ohne Scan: kein Scan-Eintrag der Königin (Position erst über den Scan)');
  const xs = [Math.round(S.koenigin().x), Math.round(S.koenigin().y)];
  ok(!text.includes(',' + xs[0] + ',' + xs[1]) && !JSON.stringify(S.k.rows).includes('nest'), 'Königsposition (px) steht nicht im Kartenpayload');
  const e1 = S.g.awayMapPayload(S.k).anker.length;
  const Q2 = Kreatur.nestBesetzen(S.g, { map: 'nirgends', typ: 'koenigin', gruppe: 'x' });
  const ohneNest = Object.assign({}, S.k, { anker: S.k.anker.filter((a) => a.rolle !== 'nest') });
  const saved = W.AWAY_MAPS[S.id].karte; W.AWAY_MAPS[S.id].karte = ohneNest;
  let Q3; try { Q3 = Kreatur.nestBesetzen(S.g, { map: S.id, typ: 'koenigin', gruppe: 'y' }); } finally { W.AWAY_MAPS[S.id].karte = saved; }
  ok(Q2.fehler && Q2.n === 0 && Q3.fehler && /keinen Anker der Rolle nest/.test(Q3.fehler) && Q3.n === 0 && e1 === S.g.awayMapPayload(S.k).anker.length, 'nestBesetzen ohne Karte oder ohne Nest: Fehlertext, nichts angelegt');
});

// ---------- (b) Lärm lockt innerhalb der Reichweite, nicht außerhalb ----------
section('(b) abbauLaerm lockt innerhalb der Reichweite (zwei Entfernungen), nicht außerhalb', () => {
  const S = szene(5);
  const Q = mitKoenigin(S);
  ok(REICHWEITE === 15, 'Reichweite aus den Daten: Stufe ' + STUFE + ' (' + CONFIG.awayCombat.laerm[STUFE] + ') x koeder.faktor ' + KOEDER.faktor + ' = ' + REICHWEITE + ' Kacheln');
  const W0 = S.schwarm();
  const ader = aderDa(S)[0];
  const m = zuAder(S, ader); const a = { x: m.x / TILE - 0.5, y: m.y / TILE - 0.5 };
  const innen = ortInAbstand(S, tileOf(m), m.x / TILE, m.y / TILE, REICHWEITE - 3);
  const aussen = ortInAbstand(S, tileOf(m), m.x / TILE, m.y / TILE, REICHWEITE + 4);
  ok(!!innen && !!aussen, 'Prüforte gefunden: ' + (innen ? luft(innen, m).toFixed(1) : '-') + ' und ' + (aussen ? luft(aussen, m).toFixed(1) : '-') + ' Kacheln von der Ader');
  const PI = W0[0], PA = W0[1];
  for (const K of W0) setzeAuf(S, K, Mon.mitteVon(tileOf(Q), 1));   // alle zurück zur Königin (weit genug: sie hören nichts), dann die beiden Proben an die Prüforte
  setzeAuf(S, PI, innen); setzeAuf(S, PA, aussen);
  const aw0 = JSON.stringify(S.aw.laerm || []);
  S.p.hold = null; act(S, true);
  S.lauf(0.1);
  ok(S.me_('abbauLaerm').length === 1, 'Abbau gestartet: ein abbauLaerm beim Start');
  const solidK = interior.awaySolid(S.g);
  ok(!!PI.koeder && Math.hypot(PI.koeder.x - m.x, PI.koeder.y - m.y) <= 1.5 * TILE && !solidK(Math.floor(PI.koeder.x / TILE), Math.floor(PI.koeder.y / TILE)) && PI.z === 'laerm', 'innerhalb der Reichweite: Schwarmling hat den Köder (begehbare Kachel an der Ader, MON-03 Nacharbeit B: die Ader selbst ist fest), Zustand laerm (' + PI.z + ')');
  ok(!PA.koeder && PA.z !== 'laerm', 'außerhalb der Reichweite: kein Köder, nicht im Zustand laerm (' + PA.z + ')');
  const d0 = luft(PI, m);
  S.lauf(2.0);
  ok(luft(PI, m) <= d0 - 2 || PI.z === 'jagd', 'der gelockte Schwarmling läuft zum Abbauenden (' + d0.toFixed(1) + ' -> ' + luft(PI, m).toFixed(1) + ' Kacheln, Zustand ' + PI.z + ')');
  ok(!PA.koeder, 'der Schwarmling außerhalb bleibt ungelockt auch nach den Lärmereignissen bei 0 und 2 s');
  ok(JSON.stringify(S.aw.laerm || []) === aw0, 'aw.laerm unverändert (abbauLaerm schreibt nicht in den Lärmpuffer)');
  act(S, false);
  ok(S.fehler.length === 0, 'keine Fehler im Lauf (' + S.fehler.join('|') + ')');
});

// ---------- (c) höchstens 3 Ereignisse je Halt, Dauerabbau über max ----------
section('(c) bis zu 3 Lärmereignisse je Halt, Dauerabbau überschreitet max nie, Lärm erzeugt nie Tiere', () => {
  const S = szene(5);
  const Q = mitKoenigin(S);
  let aufrufe = 0; const orig = Kreatur.laermHoeren; const takt0 = BRUT.takt;
  Kreatur.laermHoeren = function () { aufrufe++; return orig.apply(this, arguments); };
  BRUT.takt = 0.5;   // schnelle Brut: der Bestand hält sich an max, jede Überschreitung wäre sichtbar (Takt aus den Daten, hier nur für diesen Abschnitt geändert)
  try {
    const ader = aderDa(S)[0];
    zuAder(S, ader); act(S, true);
    S.lauf(DAUER + 2 * TAKT);
    const halt = S.me_('abbauLaerm').length;
    ok(halt === 3 && aufrufe === 3 && halt === Math.floor((DAUER - 1e-6) / TAKT) + 1, 'ein ganzer Halt (' + DAUER + ' s, Takt ' + TAKT + ' s): genau 3 Lärmereignisse und 3 Aufrufe von laermHoeren (' + halt + '/' + aufrufe + ')');
    ok(Anker.zustand(S.g, S.id, ader) === 'abgebaut', 'Ader nach dem Halt abgebaut (kein weiterer Lärm danach)');
    // direkter Lärm erzeugt keine Kreatur
    const seq = S.aw.kreaturSeq, len = S.aw.kreaturen.length;
    for (let i = 0; i < 50; i++) Kreatur.laermHoeren(S.g, { x: Q.x, y: Q.y, radius: 18 * TILE, stufe: 'laut' });
    ok(S.aw.kreaturSeq === seq && S.aw.kreaturen.length === len, 'laermHoeren x 50: keine neue Kreatur (kreaturSeq und Liste unverändert)');
    // Dauerabbau: Halte beginnen und abbrechen, abwechselnd an den übrigen Adern, dazu Verluste durch Beschuss
    const ids = aderDa(S); if (ids.length < 1) throw new Error('keine Ader im Zustand da');
    let max = 0, ueber = 0, runden = 0, aufrufe0 = aufrufe, lebendMin = 99;
    const pro = () => { const l = S.schwarm().length; max = Math.max(max, l); lebendMin = Math.min(lebendMin, l); if (l > BRUT.max) ueber++; };
    for (let r = 0; r < 14; r++) {
      const id = ids[r % ids.length]; if (Anker.zustand(S.g, S.id, id) !== 'da') continue;
      act(S, false); zuAder(S, id); act(S, true);
      S.lauf(TAKT + 1.9, pro);   // zwei Ereignisse (0 s und 2 s), Abbruch vor dem Ende
      act(S, false);
      // Verluste: bis zu vier Schwarmlinge fallen, die Brut füllt nach (nie über max)
      for (const K of S.schwarm().slice(0, 4)) { K.facing = 0; for (let i = 0; i < 60 && K.alive; i++) combat.hitEnemy(S.g, K, 1, { x: K.x - 100, y: K.y, pid: S.p.id, wirkung: { waffe: 'blaster', schaden: 1, art: 'direkt', x: K.x - 100, y: K.y, quelle: { id: S.p.id, pid: S.p.id, team: 'crew', x: K.x - 100, y: K.y } } }); }
      S.lauf(2.5, pro);
      runden++;
    }
    ok(runden >= 6 && aufrufe - aufrufe0 >= 2 * runden, 'Dauerabbau: ' + runden + ' Halte mit Abbruch, ' + (aufrufe - aufrufe0) + ' Lärmereignisse');
    ok(ueber === 0 && max <= BRUT.max, 'gleichzeitig lebende Schwarmlinge nie über max ' + BRUT.max + ' (Höchststand ' + max + ', Tiefststand ' + lebendMin + ', Ticks über max: ' + ueber + ')');
    ok(lebendMin < BRUT.max && max === BRUT.max, 'echte Verluste (Tiefststand ' + lebendMin + ') und die Brut füllt bis genau max nach (Höchststand ' + max + ')');
    ok(S.aw.kreaturen.length <= BRUT.max + 1 + 4, 'die Liste wächst nicht (' + S.aw.kreaturen.length + ' Einträge): tote werden still entfernt');
    ok(S.fehler.length === 0, 'keine Fehler (' + S.fehler.join('|') + ')');
  } finally { Kreatur.laermHoeren = orig; BRUT.takt = takt0; }
});

// ---------- (d) Heimweg ----------
section('(d) Heimweg: nach Lockung ohne Ziel zurück zur Königin (laerm, heim, schwaermen)', () => {
  const S = szene(5);
  const Q = mitKoenigin(S);
  const gef = KREATUREN.typen.schwarmling.bausteine.gefolge;
  const P = S.schwarm()[0];
  for (const K of S.schwarm()) if (K !== P) K.weg = true;   // nur die Probe, die übrigen stören die Messung nicht
  S.lauf(0.1);
  const ziel = ortInAbstand(S, tileOf(Q), Q.x / TILE, Q.y / TILE, gef.fern + 3);
  ok(!!ziel, 'Lockort in ' + (ziel ? luft(ziel, Q).toFixed(1) : '-') + ' Kacheln Entfernung von der Königin (fern ' + gef.fern + ', daheim ' + gef.daheim + ')');
  setzeAuf(S, P, Mon.mitteVon(tileOf(Q), 1)); S.lauf(0.2);
  const reihe = []; let z0 = null; const spur = [];
  const pro = () => { if (P.z !== z0) { z0 = P.z; reihe.push(P.z); } if (P.z === 'heim') spur.push(luft(P, Q)); };
  Kreatur.laermHoeren(S.g, { x: ziel.x, y: ziel.y, radius: 18 * TILE, stufe: 'laut' });
  S.lauf(1, pro);
  ok(P.z === 'laerm' && !!P.koeder, 'Lockung: Schwarmling im Zustand laerm, Köder gesetzt');
  const dZiel = []; S.lauf(0.01);
  let dMin = 1e9;
  S.lauf(60, () => { dMin = Math.min(dMin, luft(P, ziel)); pro(); });
  ok(dMin <= 3, 'er erreichte den Lockort (kleinster Abstand ' + dMin.toFixed(1) + ' Kacheln)');
  ok(reihe.join('>') === 'schwaermen>laerm>heim>schwaermen' || reihe.join('>') === 'laerm>heim>schwaermen', 'Zustandsfolge nach Lockung ohne Ziel: ' + reihe.join(' > '));
  ok(spur.length > 20 && spur[0] > gef.fern - 1 && spur[spur.length - 1] <= gef.daheim + 1.5, 'Heimweg beginnt weit (' + (spur[0] || 0).toFixed(1) + ' Kacheln) und endet am Nest (' + (spur[spur.length - 1] || 0).toFixed(1) + ' Kacheln, daheim ' + gef.daheim + ')');
  let steigt = 0; for (let i = 1; i < spur.length; i++) steigt = Math.max(steigt, spur[i] - spur[i - 1]);
  const net = spur[0] - spur[spur.length - 1];
  ok(net >= spur[0] * 0.5 && spur.filter((d, i) => i > 0 && d > spur[i - 1] + 1e-9).length < spur.length * 0.3, 'der Weg führt zum Nest: Abstand fällt um ' + net.toFixed(1) + ' Kacheln, nur in ' + spur.filter((d, i) => i > 0 && d > spur[i - 1] + 1e-9).length + ' von ' + spur.length + ' Ticks steigt er (stärkster Sprung ' + steigt.toFixed(2) + ')');
  ok(P.z === 'schwaermen' && luft(P, Q) <= gef.daheim + 1.5, 'am Ende wieder im Zustand schwaermen um die Königin (Abstand ' + luft(P, Q).toFixed(1) + ')');
  ok(S.fehler.length === 0, 'keine Fehler (' + S.fehler.join('|') + ')');
});

// ---------- (e) Drohnentrupps ----------
// Ein Raubzug-Trupp (combat.besetzen, wie in der Höhle) wird neben die Ader gestellt, außer Sicht des Abbauenden (Sichtlinie versperrt, sonst weckte ihn der Anblick und der Grund läge nicht am Lärm).
function trupp(S, ader) {
  const lager = Object.keys(S.k.bereiche).find((bid) => /lager_/.test(bid));
  const nBes = combat.besetzen(S.g, { map: S.id, bereich: lager, fraktion: 'raubzug', staerke: 'klein', tag: 'nt' });
  const mitglieder = S.g.away.drones.filter((e) => e.alive && e.squad);
  if (!nBes || !mitglieder.length) throw new Error('kein Trupp aufgestellt');
  const name = mitglieder[0].squad;
  const m = zuAder(S, ader);
  const E = combat.env(S.g);
  const orte = [];
  const mk = Monster.maskeVonGroesse(S.k, 1);
  const start = Mon.naechster(mk, Math.floor(m.x / TILE), Math.floor(m.y / TILE), 3);
  const seen = new Set([start.cx + ',' + start.cy]), q = [start];
  for (let i = 0; i < q.length; i++) {
    const a = q[i], c = Mon.mitteVon(a, 1), d = luft(c, m);
    if (d >= 4 && d <= 8 && !combat.losBetween(E, { x: c.x, y: c.y }, S.p) && !combat.losBetween(E, { x: c.x, y: c.y }, { x: m.x, y: m.y })) orte.push(c);   // dieselbe Sichtprüfung wie squad.js
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = { cx: a.cx + dx, cy: a.cy + dy }, key = b.cx + ',' + b.cy; if (!seen.has(key) && mk.geht(b.cx, b.cy)) { seen.add(key); q.push(b); } }
  }
  if (!orte.length) throw new Error('kein Ort ohne Sichtlinie in 4 bis 8 Kacheln von der Ader');
  const T = orte[0];
  const pin = () => S.g.away.drones.filter((e) => e.squad === name).forEach((e, i) => { e.x = T.x + i * 5; e.y = T.y; e.home = { x: e.x, y: e.y }; e.wander = null; e.path = []; e.goal = null; e.asleep = false; });
  pin();   // die Drohnen werden jeden Tick an den Ort zurückgestellt (sonst wandern sie in Sicht, und der Alarmgrund läge nicht am Lärm)
  const sq = S.g.away.squads[name]; sq.alert = false; sq.gemeldet = false;
  return { name, m, pin, abstand: luft(T, m), n: S.g.away.drones.filter((e) => e.squad === name).length };
}
section('(e) Drohnentrupps werden durch abbauLaerm nicht geweckt', () => {
  const S = szene(5, { drohnen: true });
  mitKoenigin(S);
  const ader = aderDa(S)[0];
  const t = trupp(S, ader);
  ok(t.n > 0 && t.abstand >= 4 && t.abstand <= 8, 'Raubzug-Trupp (' + t.n + ' Drohnen) in ' + t.abstand.toFixed(1) + ' Kacheln Entfernung, innerhalb der Hörweite von Stufe mittel (' + CONFIG.awayCombat.laerm.mittel + '), ohne Sichtlinie zum Abbauenden');
  const laerm0 = JSON.stringify(S.aw.laerm || []);
  zuAder(S, ader); act(S, true);
  S.lauf(0.6, t.pin);   // erstes Ereignis bei 0 s, die Wahrnehmung der Trupps läuft mit 5 Hz
  ok(S.me_('abbauLaerm').length === 1 && !S.g.away.squads[t.name].gemeldet && !S.g.away.squads[t.name].alert && S.ev_('truppAlarm').length === 0, 'nach dem ersten Abbau-Lärm: Trupp nicht alarmiert (kein truppAlarm, alert und gemeldet falsch)');
  S.lauf(DAUER + 1, t.pin);
  const grund = S.ev_('truppAlarm').filter((x) => x.d.trupp === t.name).map((x) => x.d.grund);
  ok(S.me_('abbauLaerm').length === 3, 'Abbau lief mit 3 Lärmereignissen');
  ok(!grund.includes('laerm') && JSON.stringify(S.aw.laerm || []) === laerm0, 'über den ganzen Halt kein Alarm mit Grund laerm (Gründe: ' + (grund.join(',') || 'keine') + '; die Drohnen stehen fest und ohne Sichtlinie), aw.laerm unverändert');
  // Gegenprobe: gleicher Aufbau, echter Waffenlärm (waffen.laerm schreibt in aw.laerm) am selben Ort weckt denselben Trupp
  const S2 = szene(5, { drohnen: true });
  mitKoenigin(S2);
  const t2 = trupp(S2, aderDa(S2)[0]);
  Waffen.laerm(S2.g, t2.m.x, t2.m.y, 'mittel');
  S2.lauf(0.5, t2.pin);
  ok(S2.ev_('truppAlarm').some((x) => x.d.trupp === t2.name && x.d.grund === 'laerm'), 'Gegenprobe: Waffenlärm am selben Ort weckt denselben Trupp über den Grund laerm (der Test ist empfindlich)');
});

// ---------- (f) Typnamen, Validator gefolge ----------
section('(f) kein Typname im Servercode, Validator gefolge, Fremdtyp-Paar', () => {
  const namen = ['schwarmling', 'koenigin', 'rudeltier'];
  const dateien = [];
  const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) geh(p); else if (e.name.endsWith('.js')) dateien.push(p); } };
  geh(path.join(__dirname, '..', 'server')); geh(path.join(__dirname, '..', 'shared'));
  const treffer = [];
  for (const f of dateien) { const text = fs.readFileSync(f, 'utf8'); for (const nm of namen) if (new RegExp('[\'"`]' + nm + '[\'"`]|[\'"`]kreatur\\.' + nm + '[\'"`]|\\.' + nm + '\\b').test(text)) treffer.push(path.relative(path.join(__dirname, '..'), f) + ' ~ ' + nm); }
  ok(dateien.length > 80 && treffer.length === 0, 'kein Typname (schwarmling, koenigin, rudeltier) in server/ und shared/ (' + dateien.length + ' Dateien)' + (treffer.length ? ': ' + treffer.join('; ') : ''));
  const F = (aend) => { const d = kopie(KREATUREN); Object.assign(d.typen.schwarmling.bausteine.gefolge, aend); return Kreatur.pruefen(d); };
  ok(Kreatur.pruefen(KREATUREN).length === 0, 'Daten gültig');
  ok(F({ hort: 'gibtsnicht' }).length === 1 && F({ daheim: 2 }).length >= 1 && F({ fern: 5 }).length === 1 && F({ fern: 3 }).length >= 1 && F({ extra: 1 }).length === 1, 'Validator gefolge: unbekannter Hort, daheim unter 3, fern nicht über daheim, unbekanntes Feld abgelehnt');
  const d = kopie(KREATUREN); delete d.typen.schwarmling.bausteine.gefolge;
  ok(Kreatur.pruefen(d).some((t) => /zumHort|umkreise|heim/.test(t) || /unbekannter (Modus|Auslöser)/.test(t)), 'Zustände mit umkreise, zumHort, fern, daheim ohne den Baustein gefolge werden abgelehnt');
  // Fremdtyp-Paar: dieselbe Wirkung unter anderen Namen
  KREATUREN.typen.kolonie = kopie(KREATUREN.typen.koenigin); KREATUREN.typen.kolonie.name = 'kreatur.kolonie';
  KREATUREN.typen.kolonie.bausteine.brut = Object.assign(kopie(BRUT), { typ: 'arbeiter', anfang: 3, max: 5, takt: 2 });
  KREATUREN.typen.arbeiter = kopie(KREATUREN.typen.schwarmling); KREATUREN.typen.arbeiter.name = 'kreatur.arbeiter';
  KREATUREN.typen.arbeiter.bausteine.bindung.quelle.typ = 'kolonie'; KREATUREN.typen.arbeiter.bausteine.gefolge.hort = 'kolonie';
  try {
    ok(Kreatur.pruefen(KREATUREN).length === 0, 'Fremdnamen-Paar kolonie/arbeiter gültig');
    const S = szene(5);
    Kreatur.nestBesetzen(S.g, { map: S.id, typ: 'kolonie', gruppe: 'k' }); S.g.away.drones.length = 0; S.g.step();
    const ar = () => S.aw.kreaturen.filter((K) => K.typ === 'arbeiter' && Kreatur.nichtEndgueltigErledigt(K));
    ok(ar().length === 3, 'Startbesatz 3 aus den Daten des Fremdtyps');
    const A0 = ar()[0], Kq = S.aw.kreaturen.find((K) => K.typ === 'kolonie');
    const ziel = ortInAbstand(S, tileOf(Kq), Kq.x / TILE, Kq.y / TILE, 17);
    setzeAuf(S, A0, ziel); S.lauf(0.1);
    ok(A0.z === 'heim', 'Fremdtyp: weit vom Hort (fern) läuft er heim (Zustand ' + A0.z + ')');
    S.lauf(40);
    ok(A0.z === 'schwaermen' && luft(A0, Kq) <= 6.5, 'Fremdtyp: kommt am Hort an und umkreist ihn (Abstand ' + luft(A0, Kq).toFixed(1) + ')');
  } finally { delete KREATUREN.typen.kolonie; delete KREATUREN.typen.arbeiter; }
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
