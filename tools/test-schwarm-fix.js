'use strict';
// MON-03 Nacharbeit (A, B, E): Streuung der Schwarmlinge, Ader-Totpunkt, Kleinteile. Echtes Spiel (Game), echte Höhle (art hoehle); die Client-Teile (C, D) stehen in tools/test-schwarm-scan.js (g1 bis g3).
// Geprüft: (a) Baustein `streuung`: nach 30 s Jagd nie mehr als 3 Schwarmlinge in derselben 6-px-Zelle (3 Seeds, Gegenprobe ohne den Baustein: Stapel), keine Kreatur in der Wand, nur Träger weichen einander aus
//   (Rudeltier und Probe nicht), keine Instanzfelder, Validator; (b) Ader-Totpunkt (seed 5, hoehle.abbau.4: der Spieler hinter der festen Ader): der Köder liegt auf begehbarem Boden, nach der Lockung gibt es einen Biss
//   (alle begehbaren Nachbarkacheln der Ader), die Sperre verfällt (Ader später abgebaut: der Weg ist wieder offen); (c) Nachwuchs steht nie übereinander; (d) gefolge: Suchradius kleiner als daheim (Invariante für
//   jeden erlaubten Wert) und Ankunft mit daheim 3; (e) brut ohne Außenteam (Crew an Bord: kein Nachwuchs, nach der Landung der Startbesatz), nest_besetzen vor der Landung.
//   node tools/test-schwarm-fix.js   (npm run test:schwarm-fix)
const CONFIG = require('../shared/config.js');
const combat = require('../server/sim/combat.js');
const interior = require('../server/sim/interior.js');
const Kreatur = require('../server/sim/kreatur.js');
const Monster = require('../server/sim/monster.js');
const Anker = require('../server/sim/anker.js');
const Mon = require('../shared/monster.js');
const Los = require('../shared/los.js');
const Physics = require('../shared/physics.js');
const KREATUREN = require('../content/kampf/kreaturen.json');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const { Game } = require('../server/game.js');
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

// ---------- Szene: echte Höhle (Arena), Drohnen weg, Königin am Nest ----------
function hoehle(seed, o) {
  o = o || {};
  const s = H.neuesSpiel(1, { art: 'hoehle', seed, groesse: 'mittel' });
  const g = s.g, aw = g.away;
  aw.drones = []; combat.ensureV2(g, aw, s.map);
  const S = { g, aw, id: s.map, k: s.k, p: g.players[0], fehler: [], ev: [] };
  g.countError = (w, e) => { S.fehler.push(w + ': ' + (e && e.message)); };
  const e0 = g.emit.bind(g); g.emit = (nm, d) => { S.ev.push({ nm, d, t: g.time }); return e0(nm, d); };
  g.god = !!o.god;
  S.E = combat.env(g);
  const r = Kreatur.nestBesetzen(g, { map: s.map, typ: 'koenigin', gruppe: 'n' });
  if (r.fehler) throw new Error(r.fehler);
  g.step();   // erster Abgleich: Startbesatz
  S.Q = aw.kreaturen.find((K) => K.typ === 'koenigin');
  S.schwarm = () => aw.kreaturen.filter((K) => K.typ === 'schwarmling' && K.alive && !K.weg);
  S.lauf = (sek, pro) => { for (let i = 0, N = Math.round(sek / DT); i < N; i++) { g.step(); if (o.aufrecht) { S.p.downed = false; } if (pro && pro(i) === true) return true; } return false; };
  S.treffer = () => S.ev.filter((e) => e.nm === 'kreaturTreffer').length;
  return S;
}
const tileOf = (o) => ({ cx: Math.floor(o.x / TILE), cy: Math.floor(o.y / TILE) });
const setzeSpieler = (S, tx, ty) => { const c = Physics.tileCenter(tx, ty); S.p.x = c.x; S.p.y = c.y; S.p.input.mx = 0; S.p.input.my = 0; };
// Platz 7 bis 9 Kacheln von der Königin, begehbar und mit Sichtlinie zu ihr
function platzMitSicht(S) {
  const m = Monster.maskeVonGroesse(S.k, 1), qt = tileOf(S.Q);
  for (let r = 7; r <= 9; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const tx = qt.cx + dx, ty = qt.cy + dy;
    if (!m.geht(tx, ty) || S.E.solid(tx, ty)) continue;
    const c = Physics.tileCenter(tx, ty);
    if (Los.lineOfSight(S.E.shotBlocked, c.x, c.y, S.Q.x, S.Q.y)) return { tx, ty };
  }
  throw new Error('kein Platz mit Sicht auf die Königin');
}
// Höchstzahl in einer 6-px-Zelle und Zahl in Wandkacheln
function zellen(S) {
  const c = {}; let wand = 0;
  for (const K of S.schwarm()) { const key = Math.round(K.x / 6) + ',' + Math.round(K.y / 6); c[key] = (c[key] || 0) + 1; if (S.E.solid(Math.floor(K.x / TILE), Math.floor(K.y / TILE))) wand++; }
  return { max: Math.max(0, ...Object.values(c)), wand };
}
// 30 s Jagd am Spieler: erst 12 s Ankunft, dann je Sekunde messen
function jagd(seed) {
  const S = hoehle(seed, { god: true, aufrecht: true });
  S.lauf(10);
  const pl = platzMitSicht(S); setzeSpieler(S, pl.tx, pl.ty);
  S.lauf(12);
  let max = 0, wand = 0, ticks = 0, imStand = 0;
  S.lauf(30, (i) => { if (i % 30) return; const z = zellen(S); max = Math.max(max, z.max); wand += z.wand; ticks++; for (const K of S.schwarm()) if (K.z === 'pause') imStand++; });
  return { S, max, wand, ticks, n: S.schwarm().length, imStand };
}

// ---------- (a) Streuung ----------
section('(a) Streuung: nach 30 s Jagd stapeln sich die Schwarmlinge nicht', () => {
  const T = KREATUREN.typen.schwarmling;
  ok(T.bausteine.streuung && KREATUREN.typen.rudeltier.bausteine.streuung === undefined && KREATUREN.typen.koenigin.bausteine.streuung === undefined, 'Daten: nur der Schwarmling trägt den Baustein streuung (Rudeltier, Königin nicht)');
  for (const seed of [3, 9, 11]) {
    const r = jagd(seed);
    ok(r.n >= 18 && r.max <= 3 && r.wand === 0 && r.S.fehler.length === 0, 'seed ' + seed + ': ' + r.n + ' Schwarmlinge, höchstens ' + r.max + ' in einer 6-px-Zelle (Grenze 3), ' + r.wand + ' in Wandkacheln, ' + r.S.fehler.length + ' Fehler');
    ok(r.imStand > 0 && r.ticks === 30, 'seed ' + seed + ': ein Teil steht in pause am Spieler (' + r.imStand + ' Messungen), die Jagd läuft wirklich');
  }
  // Gegenprobe: ohne den Baustein stapeln sie sich (der Test ist empfindlich)
  const alt = T.bausteine.streuung; delete T.bausteine.streuung;
  try { const r = jagd(9); ok(r.max >= 8, 'ohne den Baustein: ' + r.max + ' in einer Zelle (Gegenprobe, vorher gemessen 13)'); }
  finally { T.bausteine.streuung = alt; }
});

section('(a2) Streuung: nur Träger, keine Instanzfelder, Validator', () => {
  const S = hoehle(5, { god: true });
  const m = Monster.maskeVonGroesse(S.k, 1), qt = tileOf(S.Q);
  const a = Mon.naechster(m, qt.cx - 5, qt.cy, 4); const ort = Mon.mitteVon(a, 1);
  const alle = S.aw.kreaturen.filter((K) => K.typ === 'schwarmling');
  for (const K of alle) K.weg = true;   // der Startbesatz stört die Messung nicht (der nächste Nachwuchs kommt erst nach dem Takt)
  S.g.step();
  const neu = (typ) => { const K = Kreatur.erzeugen(S.g, typ, ort.x, ort.y); if (typ === 'schwarmling') { Kreatur.zustandSetzen(S.g, K, 'pause'); K.verlust = 99; K.letzte = null; } return K; };
  const A = neu('schwarmling'), B = neu('schwarmling');
  const x0 = A.x, y0 = A.y;
  S.lauf(0.5);
  ok(Math.hypot(A.x - x0, A.y - y0) > 3 && Math.hypot(B.x - x0, B.y - y0) > 3 && Math.hypot(A.x - B.x, A.y - B.y) > 6, 'zwei Schwarmlinge auf demselben Punkt weichen aus (Abstand nach 0,5 s: ' + Math.hypot(A.x - B.x, A.y - B.y).toFixed(1) + ' px)');
  const S2 = hoehle(5, { god: true });
  for (const K of S2.aw.kreaturen) if (K.typ === 'schwarmling') K.weg = true;
  S2.g.step();
  const o2 = Mon.mitteVon(Mon.naechster(Monster.maskeVonGroesse(S2.k, 1), tileOf(S2.Q).cx - 5, tileOf(S2.Q).cy, 4), 1);
  const A2 = Kreatur.erzeugen(S2.g, 'schwarmling', o2.x, o2.y); Kreatur.zustandSetzen(S2.g, A2, 'pause'); A2.verlust = 99; A2.letzte = null;
  Kreatur.erzeugen(S2.g, 'probe', o2.x, o2.y);   // dieselbe Stelle, aber ohne den Baustein: der Schwarmling sieht sie nicht als Gegenüber
  const ax = A2.x, ay = A2.y;
  S2.lauf(0.5);
  ok(Math.hypot(A2.x - ax, A2.y - ay) < 1e-6, 'ein Schwarmling und eine Kreatur ohne den Baustein auf demselben Punkt: er bleibt stehen (nur Träger weichen einander aus)');
  // Instanzfelder: nichts Neues an Schwarmlingen (der Instanz-Hash bleibt)
  const erlaubt = new Set(['id', 'kind', 'kreatur', 'typ', 'x', 'y', 'facing', 'alive', 'team', 'seg', 'max', 'hp', 'lastHitAt', 'regenT', 'wunden', 'frontArc', 'hitRadius', 'z', 'zt', 't', 'pfad', 'ziel', 'ramm', 'replan', 'blockiert', 'tuerGesperrt', 'verlust', 'letzte', 'stuckT', 'ref', 'gruppe', 'laermCursor', 'bindung', 'koeder', 'zielId', 'rammTreffer', 'weg', 'sperre',
    'waffe', 'hitze', 'gesperrtBis', 'ladung', 'ausholen', 'zustand', 'betaeubtBis', 'bewusstBis']);   // die letzten acht legt der Kämpfer-Vertrag (waffen.js) an jeder Kreatur an, Vorbestand
  const S3 = hoehle(9, { god: true });
  S3.lauf(25);
  const fremd = new Set(); for (const K of S3.aw.kreaturen) for (const k of Object.keys(K)) if (!erlaubt.has(k) && !(K.typ === 'koenigin' && k === 'brut')) fremd.add(k);
  ok(fremd.size === 0, 'Schwarmlinge und Königin tragen nach 25 s keine neuen Instanzfelder (' + (fremd.size ? [...fremd].join(',') : 'keine fremden') + ')');
  // Validator
  const F = (aend) => { const d = kopie(KREATUREN); d.typen.schwarmling.bausteine.streuung = Object.assign({}, d.typen.schwarmling.bausteine.streuung, aend); return Kreatur.pruefen(d); };
  ok(Kreatur.pruefen(KREATUREN).length === 0 && F({ abstand: 1 }).length === 1 && F({ abstand: 99 }).length === 1 && F({ tempo: 0 }).length === 1 && F({ extra: 1 }).length === 1, 'Validator streuung: Abstand und Tempo im Bereich, unbekannte Felder abgelehnt');
});

// ---------- (b) Ader-Totpunkt ----------
const ADER = 'hoehle.abbau.4';
function aderLauf(dx, dy, o) {
  o = o || {};
  const brut0 = BRUT.anfang; BRUT.anfang = 15;
  try {
    const S = hoehle(5, { god: false });
    const a = S.k.anker.find((x) => x.id === ADER);
    S.a = a; S.mitte = { x: (a.x + 0.5) * TILE, y: (a.y + 0.5) * TILE };
    setzeSpieler(S, a.x + dx, a.y + dy);
    S.p.downed = false;
    Kreatur.laermHoeren(S.g, { x: S.mitte.x, y: S.mitte.y, radius: 18 * TILE, stufe: 'laut' });
    return S;
  } finally { BRUT.anfang = brut0; }
}
section('(b) Ader-Totpunkt: Köder auf begehbarem Boden, nach der Lockung gibt es Bisse (seed 5, ' + ADER + ')', () => {
  const S = aderLauf(0, 1);
  const a = S.a;
  ok(!!a && S.E.solid(a.x, a.y) && Monster.maskeVonGroesse(S.k, 1).geht(a.x, a.y), 'Ausgangslage: die Ader ist für die Physik fest und für die Maske der Kreaturen begehbar (die Lücke ist Vorbestand)');
  const mit = S.schwarm().filter((K) => K.koeder);
  const k0 = mit[0].koeder;
  S.lauf(0.1, () => { S.p.downed = false; });
  ok(mit.length === 15 && mit.every((K) => K.z === 'laerm'), 'alle ' + S.schwarm().length + ' Schwarmlinge in Reichweite sind gelockt (' + mit.length + ' mit Köder, nach 0,1 s im Zustand laerm)');
  ok(!S.E.solid(Math.floor(k0.x / TILE), Math.floor(k0.y / TILE)) && Math.hypot(k0.x - S.mitte.x, k0.y - S.mitte.y) <= 1.5 * TILE, 'der Köder liegt auf begehbarem Boden, höchstens 1,5 Kacheln von der Ader-Mitte (' + k0.x + ',' + k0.y + ' statt ' + S.mitte.x + ',' + S.mitte.y + ')');
  let biss = null;
  S.lauf(40, () => { S.p.downed = false; if (biss == null && S.treffer() > 0) { biss = S.g.time; return true; } });
  ok(biss != null && S.treffer() >= 1, 'der Spieler hinter der Ader (Kachel ' + (a.x) + ',' + (a.y + 1) + ', diagonal erreichbar) wird innerhalb von 40 s gebissen (nach ' + (biss != null ? biss.toFixed(1) : '-') + ' s, vorher 0 Bisse in über 30 s)');
  const dmin = Math.min(...S.schwarm().map((K) => Math.hypot(K.x - S.p.x, K.y - S.p.y)));
  ok(dmin <= 20, 'ein Schwarmling steht in Reichweite (' + dmin.toFixed(1) + ' px, Bissradius ' + KREATUREN.typen.schwarmling.bausteine.rammschaden.radius + ')');
  ok(S.fehler.length === 0, 'keine Fehler (' + S.fehler.join('|') + ')');
});
section('(b2) Ader-Totpunkt: jeder begehbare Nachbarplatz der Ader wird erreicht', () => {
  const sonde = aderLauf(0, 1);
  const a = sonde.a; let geprueft = 0; const schlecht = [];
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    if (sonde.E.solid(a.x + dx, a.y + dy)) continue;
    const S = aderLauf(dx, dy); geprueft++;
    const t = S.lauf(40, () => { S.p.downed = false; return S.treffer() > 0; });
    if (!t) schlecht.push(dx + ',' + dy);
  }
  ok(geprueft >= 3 && schlecht.length === 0, geprueft + ' begehbare Plätze um die Ader, an jedem gibt es einen Biss' + (schlecht.length ? ' (nicht an: ' + schlecht.join(' ') + ')' : ''));
});
section('(b3) Sperre: wird gemerkt, verfällt, bleibt ohne Vorfall aus', () => {
  const S = aderLauf(0, 1);
  S.lauf(12, () => { S.p.downed = false; });
  const gesperrt = S.schwarm().filter((K) => K.sperre && Object.keys(K.sperre).length);
  ok(gesperrt.length >= 1, 'Schwarmlinge, die an der festen Ader hängenblieben, merken sich den Pfadpunkt (' + gesperrt.length + ' mit K.sperre)');
  const key = Object.keys(gesperrt[0].sperre)[0], [cx, cy] = key.split(',').map(Number);
  ok(S.E.solid(cx, cy), 'der gemerkte Punkt ist ein fester Kachel-Fußabdruck (' + key + ')');
  const alle = S.schwarm().filter((K) => K.sperre);
  S.lauf(25, () => { S.p.downed = false; });
  ok(S.schwarm().every((K) => !K.sperre || Object.values(K.sperre).every((t) => t > S.g.time)), 'abgelaufene Sperren sind entfernt (' + alle.length + ' Tiere hatten eine)');
  // ohne feste Hindernisse im Weg entsteht nie eine Sperre
  const S2 = hoehle(9, { god: true, aufrecht: true });
  S2.lauf(10); const pl = platzMitSicht(S2); setzeSpieler(S2, pl.tx, pl.ty); S2.lauf(30);
  ok(S2.aw.kreaturen.every((K) => !K.sperre), 'freie Höhle (seed 9, 30 s Jagd): keine Kreatur hat eine Sperre (kein Instanzfeld im Normalfall)');
});

// ---------- (c) Nachwuchs nicht übereinander ----------
section('(c) brut: Nachwuchs entsteht nie übereinander (8 Seeds)', () => {
  let paare = 0, minD = 1e9, zahl = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const S = hoehle(seed, { god: true });
    const sw = S.schwarm(); zahl += sw.length;
    for (let i = 0; i < sw.length; i++) for (let j = i + 1; j < sw.length; j++) { const d = Math.hypot(sw[i].x - sw[j].x, sw[i].y - sw[j].y); minD = Math.min(minD, d); if (d < 1) paare++; }
  }
  ok(zahl === 8 * BRUT.anfang && paare === 0 && minD >= TILE - 4, '8 Seeds, je ' + BRUT.anfang + ' Startbesatz: ' + paare + ' Paare auf demselben Punkt (vorher 8), kleinster Abstand ' + minD.toFixed(1) + ' px (mindestens eine Kachel)');
  const S = hoehle(5, { god: true });
  S.lauf(60);
  const sw = S.schwarm(); let minL = 1e9; for (let i = 0; i < sw.length; i++) for (let j = i + 1; j < sw.length; j++) minL = Math.min(minL, Math.hypot(sw[i].x - sw[j].x, sw[i].y - sw[j].y));
  ok(sw.length <= BRUT.max && sw.length >= BRUT.anfang, 'nach 60 s Brut ' + sw.length + ' von höchstens ' + BRUT.max);
  // Startbesatz gleich max: genau max, nicht max + 1 (Mutationsprobe `<` zu `<=`)
  const a0 = BRUT.anfang, m0 = BRUT.max; BRUT.anfang = 6; BRUT.max = 6;
  try { const S6 = hoehle(5, { god: true }); S6.lauf(10); ok(S6.schwarm().length === 6, 'anfang = max = 6: genau 6 Schwarmlinge (' + S6.schwarm().length + ')'); }
  finally { BRUT.anfang = a0; BRUT.max = m0; }
  // Nachkommen zählen je Gruppe: acht Schwarmlinge ohne Gruppe (eine andere Szene) nehmen der Königin keinen Platz weg
  const SG = hoehle(5, { god: true });
  const m = Monster.maskeVonGroesse(SG.k, 1), qt = tileOf(SG.Q);
  for (let i = 0; i < 8; i++) { const p = Mon.mitteVon(Mon.naechster(m, qt.cx - 4 - i, qt.cy + 3, 4), 1); const F = Kreatur.erzeugen(SG.g, 'schwarmling', p.x, p.y); F.verlust = 99; }
  SG.lauf(70);
  const eigene = SG.aw.kreaturen.filter((K) => K.typ === 'schwarmling' && K.gruppe === 'n' && K.alive && !K.weg).length, fremde = SG.aw.kreaturen.filter((K) => K.typ === 'schwarmling' && K.gruppe == null && K.alive && !K.weg).length;
  ok(eigene === BRUT.max && fremde === 8, 'Gruppe n erreicht max ' + BRUT.max + ' (' + eigene + '), obwohl 8 fremde Schwarmlinge ohne Gruppe da sind (' + fremde + '): gezählt wird je Gruppe');
});

// ---------- (d) gefolge: Suchradius kleiner als daheim ----------
section('(d) gefolge: Suchradius um den Hort bleibt unter daheim, Ankunft mit daheim 3', () => {
  let schlecht = [];
  for (let d = 3; d <= 20; d += 0.25) { const r = Kreatur.gefolgeSuchradius({ daheim: d }); if (!(r >= 1 && r <= 4 && Math.SQRT2 * (r + 0.5) < d)) schlecht.push(d); }
  ok(schlecht.length === 0, 'für jedes erlaubte daheim (3 bis 20, Schritt 0,25) liegt das weiteste Pfadziel (sqrt(2) * (Radius + 0,5)) unter daheim' + (schlecht.length ? ' (verletzt bei ' + schlecht.slice(0, 5).join(',') + ')' : ''));
  const alt = KREATUREN.typen.schwarmling.bausteine.gefolge.daheim;
  for (const daheim of [3, 4]) {
    KREATUREN.typen.schwarmling.bausteine.gefolge.daheim = daheim;
    try {
      const S = hoehle(5, { god: true });
      ok(Kreatur.pruefen(KREATUREN).length === 0, 'daheim ' + daheim + ' ist ein gültiger Wert (Validator)');
      const P = S.schwarm()[0]; for (const K of S.schwarm()) if (K !== P) K.weg = true;
      S.g.step();
      const m = Monster.maskeVonGroesse(S.k, 1), qt = tileOf(S.Q);
      const a = Mon.naechster(m, qt.cx - 14, qt.cy, 6) || Mon.naechster(m, qt.cx + 14, qt.cy, 6) || Mon.naechster(m, qt.cx, qt.cy + 14, 6);
      const o = Mon.mitteVon(a, 1);
      P.x = o.x; P.y = o.y; P.pfad = []; P.replan = 0; P.ref = { x: o.x, y: o.y }; P.verlust = 99; P.letzte = null; Kreatur.zustandSetzen(S.g, P, 'heim');
      let replan = 0, schritte = 0;
      S.lauf(60, () => { if (P.z === 'heim') { schritte++; if (P.pfad.length === 0 && P.replan > KREATUREN.typen.schwarmling.replan - 1e-9) replan++; } });
      const d = Math.hypot(P.x - S.Q.x, P.y - S.Q.y) / TILE;
      ok(P.z === 'schwaermen' && d <= daheim + 6, 'daheim ' + daheim + ': der Schwarmling kommt an und umkreist die Königin (Zustand ' + P.z + ', Abstand ' + d.toFixed(1) + ' Kacheln, ' + schritte + ' Ticks im Heimweg)');
    } finally { KREATUREN.typen.schwarmling.bausteine.gefolge.daheim = alt; }
  }
});

// ---------- (e) brut ohne Außenteam, nest_besetzen vor der Landung ----------
section('(e1) brut ohne Außenteam: Crew an Bord, kein Nachwuchs; nach der Landung der Startbesatz', () => {
  const s = H.neuesSpiel(1, { art: 'hoehle', seed: 5, groesse: 'mittel' });
  const g = s.g, aw = g.away; aw.drones = []; combat.ensureV2(g, aw, s.map);
  const fehler = []; g.countError = (w, e) => fehler.push(w + ': ' + (e && e.message));
  const r = Kreatur.nestBesetzen(g, { map: s.map, typ: 'koenigin', gruppe: 'n' });
  ok(!r.fehler && aw.kreaturen.length === 1, 'Königin angelegt, noch kein Nachwuchs');
  const zone0 = g.players.map((p) => p.zone);
  for (const p of g.players) p.zone = 'ship';
  for (let i = 0; i < 6 * CONFIG.tickHz; i++) Kreatur.update(g, DT);   // direkt: der Baustein darf auch ohne Außenteam laufen können (Abgleich), tut es aber nicht
  ok(aw.kreaturen.length === 1 && aw.kreaturen[0].brut === undefined && aw.kreaturSeq === 1, 'Crew an Bord, 6 s: kein Nachwuchs, kein Zähler an der Königin (' + aw.kreaturen.length + ' Kreaturen)');
  g.players.forEach((p, i) => { p.zone = zone0[i]; });
  for (let i = 0; i < 2 * CONFIG.tickHz; i++) Kreatur.update(g, DT);
  const sw = aw.kreaturen.filter((K) => K.typ === 'schwarmling');
  ok(sw.length === BRUT.anfang && fehler.length === 0, 'Crew wieder am Boden: der Startbesatz ' + BRUT.anfang + ' entsteht (' + sw.length + '), Fehler ' + fehler.length);
});
section('(e2) nest_besetzen vor der Landung, dann landen', () => {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'N0', name: 'Nest', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 6; i++) g.step();
  const fehler = []; g.countError = (w, e) => fehler.push(w + ': ' + (e && e.message));
  const id = L.neu(g, g.ship.scene, { art: 'hoehle', seed: 5 });
  const awBefore = g.away;
  const Registry = require('../server/mission/registry.js');
  const def = Registry.get ? Registry.get('nest_besetzen') : null;
  const r = Kreatur.nestBesetzen(g, { map: id, typ: 'koenigin', gruppe: 'v' });
  void def;
  const aw = L.get(g, id);
  ok(!r.fehler && g.away === awBefore && g.away !== aw && aw.kreaturen.length === 1 && aw.kreaturen[0].typ === 'koenigin' && aw.kreaturGruppen.v.erschienen === 1, 'vor der Landung: die Königin steht auf der (noch nicht aktiven) Karte, Buchführung geführt (' + (r.fehler || 'ok') + ')');
  for (let i = 0; i < 3 * CONFIG.tickHz; i++) g.step();
  ok(aw.kreaturen.length === 1 && fehler.length === 0, 'Schiff im Flug, Karte nicht aktiv: noch kein Nachwuchs, keine Fehler (' + aw.kreaturen.length + ')');
  g.setAwayMap(id); aw.active = true;
  for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
  g.away.drones.length = 0;
  for (let i = 0; i < 2 * CONFIG.tickHz; i++) { g.away.drones.length = 0; g.step(); }
  const sw = g.away.kreaturen.filter((K) => K.typ === 'schwarmling' && K.alive);
  ok(g.away === aw && sw.length === BRUT.anfang && g.away.kreaturen.filter((K) => K.typ === 'koenigin').length === 1 && fehler.length === 0, 'nach der Landung: der Startbesatz ' + BRUT.anfang + ' (' + sw.length + '), eine Königin, keine Fehler (' + fehler.join('|') + ')');
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
