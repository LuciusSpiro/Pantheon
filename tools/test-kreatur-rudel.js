'use strict';
// MON-02 P1: Typ `rudeltier` (Größe 1, typCode 1), Rudel mit Kennung `gruppe`, Mission-Aktion `kreatur_besetzen`, Funktion Kreatur.erzeugenAuf, Baustein `aufgeben` (Hook beiWechsel, Auslöser `aufgegeben`).
// Echtes Spiel (Game), echte Wildnis-Karten aller drei Biome und Größen (Erzeuger wie im Spiel, Testgelände über tools/gel02-hilfen.js). Geprüft:
//   Typ lädt und validiert (Größe 1, typCode 1, Box 20, hitRadius 13, alle Bausteine), Reihenfolge ['probe','rudeltier'].
//   Rudel mit 4, 8 und 12 Tieren an 36 Karten (3 Biome × 3 Größen × 4 Seeds) über die Aktion: Anzahl, Kennung, aw.kreaturGruppen, Mitte der Kachel, nicht in solider Kachel, Box ohne Überlappung,
//   Abstand der Tiere (>= 1,5 Kacheln, auch zwischen Rudeln), alle vom Abholpunkt erreichbar, im Bereich, >= 10 Kacheln vom Abholpunkt, gleicher Seed = gleiche Plätze, game.rng unberührt.
//   Aktion lehnt unbekannten Bereich, Typ, Karte und Anzahl (0, 13, 2,5, -1) laut ab (countError, kein Tier, keine Buchführung); kein erreichbarer Platz (Wandecke, Abholpunkt-Nähe, abgeschnittene Kachel) = laute Meldung.
//   erzeugenAuf auf fremder Karte; Debug `kreatur rudeltier` unverändert (keine Gruppe, Kachelmitte).
//   aufgeben: Wasser und Lava (Tier gibt nach 3 Anläufen auf, ohne den Baustein nie), Treffer setzt den Zähler zurück, Verlust des Ziels setzt zurück, Hook beiWechsel, Validator.
//   Rammen in Baum und Fels (steckt, Position), Räumen beim Szenario-Start, kein Typname im Servercode, leere aw.kreaturen ändert nichts.
//   node tools/test-kreatur-rudel.js   (npm run test:kreatur-rudel)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Mon = require('../shared/monster.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const Monster = require('../server/sim/monster.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');
const W = require('../server/world.js');
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
const BIOME = ['wiesenwald', 'wueste', 'vulkan'], GROESSEN = ['klein', 'mittel', 'gross'];
const RT0 = KREATUREN.typen.rudeltier;
const BOX = RT0.kollision.box, AN = RT0.bausteine.aufgeben.anlaeufe;   // Werte stehen in den Daten (Spieltest justiert sie), der Test liest sie von dort

// Testtypen: das Rudeltier ohne den Baustein aufgeben (Kontrolle), und ein Typ mit einem Baustein, der beiWechsel meldet (Hook)
const RT = KREATUREN.typen.rudeltier;
if (RT) {
  const o = kopie(RT); o.name = 'kreatur.ohneaufgeben'; delete o.bausteine.aufgeben;
  o.zustaende.jagd.uebergang = o.zustaende.jagd.uebergang.filter((u) => u.auf !== 'aufgegeben'); delete o.zustaende.suche;
  KREATUREN.typen.ohneaufgeben = o;
  KREATUREN.typen.hookprobe = { name: 'kreatur.hookprobe', groesse: 1, kollision: { box: 20 }, sicht: 4, verlustZeit: 3, replan: 0.5, hitRadius: 13, schild: { seg: 2, max: 2 }, wunden: 1, frontArc: 0, tuerenAufbrechen: false, rammZeit: 1.2, start: 'a',
    zustaende: { a: { modus: 'steht', tempo: 0, dauer: 1, uebergang: [ { auf: 'ablauf', nach: 'b' } ] }, b: { modus: 'steht', tempo: 0, uebergang: [] } }, bausteine: { hookprobe: {} } };
  KREATUREN.typen.mitbindung = kopie(RT); KREATUREN.typen.mitbindung.name = 'kreatur.mitbindung'; KREATUREN.typen.mitbindung.bausteine.bindung = { quelle: { art: 'kreatur', typ: 'rudeltier' }, folge: { art: 'aufloesen' } };
}
const hookLog = [];
const hookAb = Kreatur.kreaturBausteinAnmelden('hookprobe', { beiWechsel(game, K, von, nach, par) { hookLog.push(von + '>' + nach + ':' + !!K.rammTreffer + ':' + K.z); } });   // abmelden verwirft die geprüften Daten: Testtypen werden beim nächsten Gebrauch geprüft

// ---------- Messhilfen ----------
function boxUeberlappt(E, x, y, b) {
  const x0 = Math.floor((x - b / 2) / TILE), x1 = Math.floor((x + b / 2 - 0.001) / TILE), y0 = Math.floor((y - b / 2) / TILE), y1 = Math.floor((y + b / 2 - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (E.solid(tx, ty)) return true;
  return false;
}
// Wildnis-Szene im echten Spiel: Spieler unverwundbar und nicht wahrnehmbar (downed), Banditen weg, Fehler der Missionsaktionen werden gesammelt
function szene(biom, seed, gr) {
  const s = H.neuesSpiel(1, { art: 'wildnis', seed, groesse: gr || 'mittel', biom });
  const g = s.g, p = g.players[0];
  g.away.drones = []; combat.ensureV2(g, g.away, s.map); g.away.kreaturen = [];
  g.god = true; p.downed = true;
  const fehler = []; g.countError = (w, e) => { fehler.push(w + ': ' + (e && e.message)); };
  return { g, k: s.k, map: s.map, p, aw: g.away, E: combat.env(g), m1: Monster.maskeVonGroesse(s.k, 1), fehler, biom, seed, gr: gr || 'mittel' };
}
const abholpunkte = (S) => S.k.anker.filter((a) => a.rolle === 'abholpunkt');
function erreichbarVomAbholpunkt(S) {
  const abh = abholpunkte(S); const ref = abh.find((a) => a.ankunft) || abh[0];
  return { abh, dist: Mon.bfs(S.m1, [Mon.naechster(S.m1, ref.x, ref.y, 4)]) };
}
const aktion = (S, o) => S.g.mission.act(Object.assign({ do: 'kreatur_besetzen', map: S.map }, o));
const inRects = (rects, tx, ty) => rects.some((r) => tx >= r[0] && tx < r[0] + r[2] && ty >= r[1] && ty < r[1] + r[3]);
function rudelProbleme(S, gruppe, anzahl, bereich) {
  const R = erreichbarVomAbholpunkt(S); const P = [];
  const L = S.aw.kreaturen.filter((K) => K.gruppe === gruppe);
  const rects = bereich ? S.k.bereiche[bereich].rects : null;
  if (L.length !== anzahl) P.push('Anzahl ' + L.length + ' statt ' + anzahl);
  const G = S.aw.kreaturGruppen && S.aw.kreaturGruppen[gruppe];
  if (!G || G.erschienen !== anzahl || G.typ !== 'rudeltier') P.push('kreaturGruppen ' + JSON.stringify(G));
  for (const K of L) {
    const tx = Math.floor(K.x / TILE), ty = Math.floor(K.y / TILE);
    if (K.typ !== 'rudeltier' || K.kind !== 'kreatur' || !K.alive || K.z !== 'patrouille') P.push('Feld ' + K.id);
    if (S.E.solid(tx, ty)) P.push('solid ' + K.id);
    if (boxUeberlappt(S.E, K.x, K.y, BOX)) P.push('Box ' + K.id);
    if (K.x % TILE !== 16 || K.y % TILE !== 16) P.push('Mitte ' + K.id);
    const a = Mon.ankerVonPosition(K.x, K.y, 1);
    if (!S.m1.geht(a.cx, a.cy) || R.dist[a.cy * S.m1.w + a.cx] < 0) P.push('unerreichbar ' + K.id);
    if (rects && !inRects(rects, tx, ty)) P.push('Bereich ' + K.id);
    if (R.abh.some((q) => Math.hypot(tx - q.x, ty - q.y) < 10)) P.push('Abholpunkt ' + K.id);
  }
  return P;
}
function minAbstand(S) {
  const L = S.aw.kreaturen; let m = Infinity;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) m = Math.min(m, Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y));
  return m / TILE;
}
function lauf(S, sek, each) { for (let i = 0, N = Math.round(sek / DT); i < N; i++) { if (each && each(i * DT) === true) return true; S.g.time += DT; Kreatur.update(S.g, DT); } return false; }
const kachelMitte = (a) => ({ x: (a.cx + 0.5) * TILE, y: (a.cy + 0.5) * TILE });

// ---------- Typ ----------
section('Typ rudeltier: Daten', () => {
  const t = KREATUREN.typen.rudeltier, ids = Object.keys(KREATUREN.typen);
  ok(!!t && Kreatur.pruefen(KREATUREN).length === 0, 'Typ lädt und der Validator hat keinen Befund (inklusive der Testtypen)');
  ok(t.groesse === 1 && t.kollision && t.kollision.box <= 24 && t.hitRadius >= 1, 'Größe 1, Box ' + t.kollision.box + ' px (höchstens 24), hitRadius ' + t.hitRadius + ' px (Startwerte aus Paket G: 20 und 13, über die Daten justierbar)');
  ok(ids[0] === 'probe' && ids[1] === 'rudeltier', 'typCode: probe 0, rudeltier 1 (Reihenfolge ist Protokoll, angehängt ans Ende)');
  ok(JSON.stringify(Object.keys(t.bausteine)) === JSON.stringify(['zyklus', 'ruecken', 'aufladung', 'koeder', 'rammschaden', 'aufgeben']), 'Bausteine zyklus, ruecken, aufladung, koeder, rammschaden, aufgeben');
  const z = t.zustaende;
  ok(t.start === 'patrouille' && ['patrouille', 'laerm', 'jagd', 'aufladen', 'rammen', 'steckt', 'pause', 'suche'].every((k) => z[k]), 'Zustandstabelle: patrouille, laerm, jagd, aufladen, rammen, steckt, pause, suche');
  ok(z.jagd.uebergang[0].auf === 'aufgegeben' && z.jagd.uebergang[0].nach === 'suche' && z.suche.uebergang.some((u) => u.auf === 'ablauf' && u.nach === 'patrouille'), 'jagd führt über `aufgegeben` in suche, suche nach Ablauf zurück in patrouille');
  const probe = KREATUREN.typen.probe;
  ok(t.schild.max <= probe.schild.max && t.wunden <= probe.wunden && t.frontArc === probe.frontArc, 'ein Tier ist nicht stärker als probe (Schild ' + t.schild.max + ' gegen ' + probe.schild.max + ', Wunden ' + t.wunden + ' gegen ' + probe.wunden + ')');
  ok(t.zustaende.rammen.tempo * t.zustaende.rammen.dauer / TILE >= t.zustaende.jagd.uebergang.find((u) => u.auf === 'nah').abstand, 'Rammstrecke (' + (t.zustaende.rammen.tempo * t.zustaende.rammen.dauer / TILE).toFixed(1) + ' Kacheln) reicht bis zum Auslöse-Abstand von nah');
});

// ---------- Rudel über die Aktion auf 36 Karten ----------
const ergebnis = { karten: 0, probleme: [], abstand: Infinity, fehler: [], keinePlaetze: 0 };
let ersterOrt = null;
for (const biom of BIOME) for (const gr of GROESSEN) for (let i = 0; i < 4; i++) {
  const S = szene(biom, 101 + i * 7919, gr);
  const lager = Object.keys(S.k.bereiche).filter((b) => b !== 'gelaende').sort();
  aktion(S, { bereich: lager[0], typ: 'rudeltier', anzahl: 4, gruppe: 'a' });
  aktion(S, { bereich: lager[lager.length - 1], typ: 'rudeltier', anzahl: 8, gruppe: 'b' });
  aktion(S, { bereich: 'gelaende', typ: 'rudeltier', anzahl: 12, gruppe: 'c' });
  ergebnis.karten++;
  ergebnis.probleme.push(...rudelProbleme(S, 'a', 4, lager[0]).map((x) => S.biom + S.gr + S.seed + ' a ' + x), ...rudelProbleme(S, 'b', 8, lager[lager.length - 1]).map((x) => S.biom + S.gr + S.seed + ' b ' + x), ...rudelProbleme(S, 'c', 12, 'gelaende').map((x) => S.biom + S.gr + S.seed + ' c ' + x));
  ergebnis.abstand = Math.min(ergebnis.abstand, minAbstand(S));
  ergebnis.fehler.push(...S.fehler);
  if (S.aw.kreaturen.length !== 24) ergebnis.keinePlaetze++;
  if (!ersterOrt) ersterOrt = { biom, gr, seed: 101, lager: lager[0], pos: S.aw.kreaturen.filter((K) => K.gruppe === 'a').map((K) => K.x + ',' + K.y).join(';') };
}
section('Rudel 4, 8 und 12 auf 36 Wildnis-Karten (alle Biome, alle Größen)', () => {
  ok(ergebnis.karten === 36, ergebnis.karten + ' Karten (3 Biome × 3 Größen × 4 Seeds), je ein Rudel von 4 (erstes Lager), 8 (letztes Lager) und 12 (ganze Karte)');
  ok(ergebnis.fehler.length === 0 && ergebnis.keinePlaetze === 0, 'alle 108 Aufrufe legen ihr Rudel an, kein Fehler (' + ergebnis.fehler.slice(0, 2).join(' | ') + '), Karten ohne 24 Tiere: ' + ergebnis.keinePlaetze);
  ok(ergebnis.probleme.length === 0, 'Anzahl, Kennung, aw.kreaturGruppen, Kachelmitte, keine solide Kachel, Box ohne Überlappung, vom Abholpunkt erreichbar, im Bereich, >= 10 Kacheln vom Abholpunkt (Probleme: ' + ergebnis.probleme.length + (ergebnis.probleme.length ? ': ' + ergebnis.probleme.slice(0, 3).join('; ') : '') + ')');
  ok(ergebnis.abstand >= 1.5 - 1e-9, 'kleinster Abstand zweier Tiere einer Karte, auch zwischen den Rudeln: ' + ergebnis.abstand.toFixed(2) + ' Kacheln (>= 1,5)');
});

section('Rudel: gleicher Seed = gleiche Plätze, game.rng unberührt, nur aw.rng', () => {
  const bau = () => {
    const S = szene('wiesenwald', 101, 'mittel'); const r0 = S.g.rng();
    const g2 = S.g; // Zufallsstrom von game.rng: ein Zug vor und einer nach dem Setzen müssen denselben Folgewert haben wie ein Spiel ohne Rudel
    aktion(S, { bereich: 'lager_1', typ: 'rudeltier', anzahl: 8, gruppe: 'a' });
    lauf(S, 10);
    return { pos: S.aw.kreaturen.map((K) => Math.round(K.x) + ',' + Math.round(K.y) + ',' + K.facing.toFixed(4)).join(';'), rng: g2.rng(), r0, awr: S.aw.rng() };
  };
  const A = bau(), B = bau();
  ok(A.pos.length > 50 && A.pos === B.pos, 'zwei Spiele mit gleichem Seed: dieselben 8 Plätze und Blickrichtungen');
  const ohne = (() => { const S = szene('wiesenwald', 101, 'mittel'); const r0 = S.g.rng(); lauf(S, 10); return { r0, rng: S.g.rng() }; })();
  ok(A.r0 === ohne.r0 && A.rng === ohne.rng, 'game.rng nach Rudel und 10 s Tick identisch zu einem Spiel ohne Rudel (' + A.rng.toFixed(6) + ')');
});

// ---------- Aktion: laute Fehler ----------
section('Aktion kreatur_besetzen lehnt laut ab', () => {
  const S = szene('vulkan', 101, 'mittel');
  const faelle = [
    [{ bereich: 'lager_99', typ: 'rudeltier', anzahl: 4, gruppe: 'x' }, /Bereich "lager_99" gibt es auf der Karte .* nicht/, 'unbekannter Bereich (kein stiller Rückfall auf die Karte)'],
    [{ bereich: 'constructor', typ: 'rudeltier', anzahl: 4, gruppe: 'x' }, /Bereich "constructor"/, 'Bereich mit dem Namen einer Objekt-Eigenschaft'],
    [{ bereich: 'lager_1', typ: 'gibtsnicht', anzahl: 4, gruppe: 'x' }, /unbekannter Typ "gibtsnicht"/, 'unbekannter Typ'],
    [{ bereich: 'lager_1', typ: 'constructor', anzahl: 4, gruppe: 'x' }, /unbekannter Typ "constructor"/, 'Typ mit dem Namen einer Objekt-Eigenschaft'],
    [{ map: 'nirgends', typ: 'rudeltier', anzahl: 4, gruppe: 'x' }, /Karte nirgends unbekannt/, 'unbekannte Karte'],
    [{ bereich: 'lager_1', typ: 'rudeltier', anzahl: 0, gruppe: 'x' }, /anzahl muss eine ganze Zahl von 1 bis 12 sein \(0\)/, 'Anzahl 0'],
    [{ bereich: 'lager_1', typ: 'rudeltier', anzahl: 13, gruppe: 'x' }, /anzahl muss eine ganze Zahl von 1 bis 12 sein \(13\)/, 'Anzahl 13'],
    [{ bereich: 'lager_1', typ: 'rudeltier', anzahl: 2.5, gruppe: 'x' }, /anzahl muss eine ganze Zahl/, 'Anzahl 2,5'],
    [{ bereich: 'lager_1', typ: 'rudeltier', anzahl: -1, gruppe: 'x' }, /anzahl muss eine ganze Zahl/, 'Anzahl -1'],
    [{ bereich: 'lager_1', typ: 'rudeltier', anzahl: 4, gruppe: '' }, /gruppe muss ein Text/, 'leere Gruppe'],
    [{ bereich: 'lager_1', typ: 'rudeltier', anzahl: 4, gruppe: '__proto__' }, /gruppe muss ein Text/, 'Gruppe __proto__'],
  ];
  for (const [o, re, was] of faelle) {
    S.fehler.length = 0;
    aktion(S, o);
    ok(S.fehler.length === 1 && /^mission-kreatur: kreatur_besetzen: /.test(S.fehler[0]) && re.test(S.fehler[0]) && S.aw.kreaturen.length === 0 && !S.aw.kreaturGruppen, was + ': ein countError mit Meldung, kein Tier, keine Buchführung' + (S.fehler[0] ? '' : ' (kein Fehler gemeldet)'));
  }
  // dieselben Prüfungen direkt an der Funktion: Rückgabe statt countError
  const r = Kreatur.rudelSetzen(S.g, { map: S.map, bereich: 'lager_99', typ: 'rudeltier', anzahl: 4, gruppe: 'x' });
  ok(r.n === 0 && r.ids.length === 0 && /lager_99/.test(r.fehler) && /gelaende, lager_1, lager_2/.test(r.fehler), 'rudelSetzen gibt { n: 0, fehler } zurück und nennt die bekannten Bereiche (' + r.fehler.slice(-40) + ')');
  ok(Kreatur.rudelSetzen(S.g, null).fehler !== null && Kreatur.rudelSetzen(S.g, {}).fehler !== null, 'rudelSetzen ohne Angaben: Fehler statt Wurf');
  // Gruppe: gleicher Typ addiert, anderer Typ scheitert
  S.fehler.length = 0;
  aktion(S, { bereich: 'lager_1', typ: 'rudeltier', anzahl: 4, gruppe: 'g1' });
  aktion(S, { bereich: 'lager_2', typ: 'rudeltier', anzahl: 3, gruppe: 'g1' });
  ok(S.fehler.length === 0 && S.aw.kreaturGruppen.g1.erschienen === 7 && S.aw.kreaturen.filter((K) => K.gruppe === 'g1').length === 7, 'dieselbe Gruppe zweimal: erschienen 7, 7 Tiere mit gruppe g1');
  S.fehler.length = 0; aktion(S, { bereich: 'lager_1', typ: 'probe', anzahl: 1, gruppe: 'g1' });
  ok(S.fehler.length === 1 && /Gruppe "g1" besteht schon mit dem Typ rudeltier/.test(S.fehler[0]) && S.aw.kreaturen.length === 7, 'dieselbe Gruppe mit anderem Typ: Fehler, nichts angelegt');
  ok(JSON.stringify(Object.keys(S.aw.kreaturGruppen)) === '["g1"]', 'aw.kreaturGruppen trägt nur g1 (kein Eintrag für Fehlschläge)');
});

section('Kein erreichbarer Platz: laute Meldung statt unerreichbarem Rudel', () => {
  const S = szene('vulkan', 101, 'mittel');
  const meldet = (bereichId, rects, anzahl, was, re) => {
    S.k.bereiche[bereichId] = { name: bereichId, rects };
    S.fehler.length = 0; S.aw.kreaturen = []; delete S.aw.kreaturGruppen;
    aktion(S, { bereich: bereichId, typ: 'rudeltier', anzahl, gruppe: 'e' });
    ok(S.fehler.length === 1 && /kein erreichbarer Platz/.test(S.fehler[0]) && re.test(S.fehler[0]) && S.aw.kreaturen.length === 0 && !S.aw.kreaturGruppen, was + ': "' + (S.fehler[0] || '').replace('mission-kreatur: kreatur_besetzen: ', '').slice(0, 110) + '"');
  };
  meldet('zz_wand', [[0, 0, 1, 1]], 1, 'Bereich aus der festen Randkachel (0, 0)', /Bereich zz_wand/);
  const abh = abholpunkte(S).find((a) => a.ankunft) || abholpunkte(S)[0];
  meldet('zz_abholpunkt', [[abh.x - 4, abh.y - 4, 9, 9]], 1, 'Bereich um den Abholpunkt (weniger als 10 Kacheln entfernt)', /Bereich zz_abholpunkt/);
  // abgeschnittene Kachel: auf einer Kopie der Karte (neue Maske) eine erreichbare Kachel mit vier festen Nachbarn umgeben; der Abholpunkt erreicht sie dann nicht mehr
  const R = erreichbarVomAbholpunkt(S); let gut = null;
  for (let cy = 4; cy < S.m1.h - 4 && !gut; cy++) for (let cx = 4; cx < S.m1.w - 4; cx++) if (S.m1.geht(cx, cy) && R.dist[cy * S.m1.w + cx] > 0 && !R.abh.some((q) => Math.hypot(cx - q.x, cy - q.y) < 10)) { gut = { cx, cy }; break; }
  const reg = W.AWAY_MAPS[S.map], orig = reg.karte, rows = orig.rows.slice();
  const setze = (x, y, c) => { rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1); };
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) setze(gut.cx + dx, gut.cy + dy, 'Y');
  reg.karte = Object.assign({}, orig, { rows, bereiche: Object.assign({}, orig.bereiche) });   // neues Kartenobjekt = neue Maske
  try {
    const m2 = Monster.maskeVonGroesse(reg.karte, 1);
    ok(m2.geht(gut.cx, gut.cy) && Mon.bfs(m2, [Mon.naechster(m2, R.abh[0].x, R.abh[0].y, 4)])[gut.cy * m2.w + gut.cx] < 0, 'Kachel ' + gut.cx + ',' + gut.cy + ' ist ein Maskenpunkt, den der Abholpunkt nicht mehr erreicht (vier feste Nachbarn)');
    S.k = reg.karte;
    meldet('zz_tasche', [[gut.cx, gut.cy, 1, 1]], 1, 'Bereich aus der vom Abholpunkt abgeschnittenen Kachel', /Bereich zz_tasche/);
  } finally { reg.karte = orig; S.k = orig; }
  // Kontrolle: dieselbe Kachel ohne die Wände klappt (der Fehler liegt am Ort, nicht am Aufruf)
  S.k.bereiche.zz_gut = { name: 'zz_gut', rects: [[gut.cx, gut.cy, 1, 1]] }; S.fehler.length = 0; S.aw.kreaturen = []; delete S.aw.kreaturGruppen;
  aktion(S, { bereich: 'zz_gut', typ: 'rudeltier', anzahl: 1, gruppe: 'e' });
  ok(S.fehler.length === 0 && S.aw.kreaturen.length === 1, 'Kontrolle: eine erreichbare Kachel als Bereich nimmt 1 Tier');
  S.fehler.length = 0; S.aw.kreaturen = []; delete S.aw.kreaturGruppen;
  aktion(S, { bereich: 'zz_gut', typ: 'rudeltier', anzahl: 2, gruppe: 'e' });
  ok(S.fehler.length === 1 && /kein erreichbarer Platz für 2 Tiere/.test(S.fehler[0]) && S.aw.kreaturen.length === 0, 'eine Kachel für 2 Tiere: Fehler, es entsteht kein halbes Rudel');
});

section('Abstand zu vorhandenen Kreaturen', () => {
  const S = szene('wueste', 101, 'mittel');
  const a = Kreatur.rudelSetzen(S.g, { map: S.map, bereich: 'lager_1', typ: 'rudeltier', anzahl: 12, gruppe: 'a' });
  const b = Kreatur.rudelSetzen(S.g, { map: S.map, bereich: 'lager_1', typ: 'rudeltier', anzahl: 12, gruppe: 'b' });
  ok(a.fehler === null && (b.fehler === null || /kein erreichbarer Platz/.test(b.fehler)) && minAbstand(S) >= 1.5 - 1e-9, 'zweites Rudel im selben Lager hält >= 1,5 Kacheln zum ersten (kleinster Abstand ' + minAbstand(S).toFixed(2) + ', zweites Rudel: ' + (b.fehler ? 'kein Platz, laut' : b.n + ' Tiere') + ')');
});

// ---------- erzeugenAuf, Debug ----------
section('Kreatur.erzeugenAuf', () => {
  const S = szene('wiesenwald', 101, 'mittel');
  const fremd = { map: 'fremd', laerm: [] };   // eine Außenkarte, die nicht game.away ist (Aktion vor der Landung)
  const K = Kreatur.erzeugenAuf(S.g, fremd, 'rudeltier', { x: 100, y: 100, gruppe: 'f' });
  ok(!!fremd.kreaturen && fremd.kreaturen.length === 1 && fremd.kreaturen[0] === K && K.id === 'K1' && K.gruppe === 'f' && S.aw.kreaturen.length === 0, 'legt die Kreatur auf der gegebenen Karte an, nicht auf game.away (Kennung K1, gruppe f)');
  const K2 = Kreatur.erzeugenAuf(S.g, fremd, 'rudeltier', { x: 200, y: 100 });
  ok(K2.id === 'K2' && !('gruppe' in K2), 'ohne gruppe: kein Feld gruppe');
  const alt = S.g.away; S.g.away = null;
  let ohne = null; try { ohne = Kreatur.erzeugenAuf(S.g, S.aw, 'rudeltier', { x: 300, y: 100 }); } finally { S.g.away = alt; }
  ok(ohne && S.aw.kreaturen.length === 1, 'braucht game.away nicht (Aufruf mit game.away = null)');
  const wirft = (f, re, was) => { let m = null; try { f(); } catch (e) { m = e.message; } ok(m !== null && re.test(m), was + (m ? ' (' + m.slice(0, 70) + ')' : ' (kein Wurf)')); };
  wirft(() => Kreatur.erzeugenAuf(S.g, fremd, 'rudeltier', {}), /x und y/, 'ohne x und y: Wurf');
  wirft(() => Kreatur.erzeugenAuf(S.g, fremd, 'rudeltier', { x: 1, y: 1, gruppe: '1 ungültig' }), /gruppe muss/, 'ungültige gruppe: Wurf');
  wirft(() => Kreatur.erzeugenAuf(S.g, fremd, 'gibtsnicht', { x: 1, y: 1 }), /unbekannter Typ/, 'unbekannter Typ: Wurf');
  wirft(() => Kreatur.erzeugenAuf(S.g, null, 'rudeltier', { x: 1, y: 1 }), /keine Außenkarte/, 'ohne Karte: Wurf');
  const n0 = fremd.kreaturen ? fremd.kreaturen.length : -1;
  wirft(() => Kreatur.erzeugenAuf(S.g, fremd, 'mitbindung', { x: 1, y: 1 }), /liest die aktive Außenkarte/, 'Typ mit Baustein bindung auf fremder Karte: Wurf statt stilles Lesen der falschen Karte');
  ok(!!fremd.kreaturen && fremd.kreaturen.length === n0 && fremd.kreaturSeq === 2, 'der gescheiterte Aufruf hinterlässt nichts (Liste und Nummer)');
  const E = Kreatur.erzeugen(S.g, 'rudeltier', 400, 100);
  ok(E.id === 'K2' && !('gruppe' in E) && S.aw.kreaturen.includes(E), 'erzeugen (game.away) unverändert: Kreatur auf der aktiven Karte, kein Feld gruppe');
});

section('Debug kreatur rudeltier bleibt wie er ist', () => {
  const S = szene('wueste', 101, 'mittel'); S.p.downed = false;
  const m = S.m1; const abh = abholpunkte(S)[0]; const a0 = Mon.naechster(m, abh.x, abh.y, 4); const q = kachelMitte(a0); S.p.x = q.x; S.p.y = q.y;
  Kreatur.debugKreatur(S.g, S.p, 'rudeltier');
  const K = S.aw.kreaturen[0];
  ok(!!K && K.typ === 'rudeltier' && !('gruppe' in K) && K.x % TILE === 16 && K.y % TILE === 16 && !S.aw.kreaturGruppen, 'Debug legt ein Tier ohne gruppe auf die Kachelmitte, ohne Buchführung');
  ok(/rudeltier/.test(Kreatur.debugKreatur(S.g, S.p, '')) && /probe/.test(Kreatur.debugKreatur(S.g, S.p, '')), 'ohne Typ: Liste der Typen nennt probe und rudeltier');
});

section('Snapshot: typCode 1, Größe 1', () => {
  const S = szene('wueste', 101, 'mittel'); S.p.downed = false;
  aktion(S, { bereich: 'lager_1', typ: 'rudeltier', anzahl: 4, gruppe: 'a' });
  const K = S.aw.kreaturen[0]; S.p.x = K.x + 40; S.p.y = K.y;
  const kr = Kreatur.snap(S.g);
  const r = kr && kr.find((q) => q[0] === Number(K.id.slice(1)));
  ok(!!r && r[1] === 1 && (r[5] >> 4) === 0 && (r[5] & 3) === 0, 'away.kr: typCode 1, Größe − 1 = 0 in den Bits 4-5 (' + JSON.stringify(r) + ')');
});

// ---------- aufgeben ----------
section('Baustein aufgeben: Validator und Hook', () => {
  const kaputt = (name, mut, erwartet) => { const k = kopie(KREATUREN); mut(k); const F = Kreatur.pruefen(k); ok(F.some((x) => x.includes(erwartet)), 'Validator lehnt ab: ' + name + (F.length ? ' (' + (F.find((x) => x.includes(erwartet)) || F[0]).slice(0, 90) + ')' : '')); };
  for (const v of [0, 1.5, '3', 51, -1, null]) kaputt('anlaeufe ' + JSON.stringify(v), (k) => { k.typen.rudeltier.bausteine.aufgeben.anlaeufe = v; }, 'anlaeufe muss eine ganze Zahl 1 bis 50');
  kaputt('anlaeufe fehlt', (k) => { k.typen.rudeltier.bausteine.aufgeben = {}; }, 'anlaeufe muss');
  kaputt('unbekanntes Feld', (k) => { k.typen.rudeltier.bausteine.aufgeben.pause = 2; }, 'pause: unbekanntes Feld');
  kaputt('Auslöser aufgegeben ohne den Baustein', (k) => { delete k.typen.rudeltier.bausteine.aufgeben; }, 'unbekannter Auslöser "aufgegeben"');
  ok(Kreatur.pruefen(KREATUREN).length === 0 && Number.isInteger(AN) && AN >= 1, 'Datei gültig, anlaeufe ' + AN);
  let m = null; try { Kreatur.kreaturBausteinAnmelden('zz_hook', { beiWechsel: 'kein Funktion' }); } catch (e) { m = e.message; }
  ok(m && /beiWechsel muss eine Funktion sein/.test(m), 'beiWechsel muss eine Funktion sein (Anmeldung wirft sonst)');
  // Hook: nicht beim Anlegen, bei jedem Wechsel, VOR dem Zurücksetzen der Zustandsfelder
  const S = szene('wueste', 101, 'mittel');
  hookLog.length = 0;
  const K = Kreatur.erzeugen(S.g, 'hookprobe', 100, 100);
  ok(hookLog.length === 0, 'beim Anlegen kein beiWechsel');
  K.rammTreffer = true; Kreatur.zustandSetzen(S.g, K, 'b');
  ok(JSON.stringify(hookLog) === '["a>b:true:a"]', 'zustandSetzen: beiWechsel(von a, nach b) sieht noch K.rammTreffer und den alten Zustand (' + hookLog.join(',') + ')');
  ok(K.rammTreffer === false && K.z === 'b', 'danach sind die Felder zurückgesetzt');
});

// Wasser- oder Lavapaar: Tier auf der einen Seite, Spieler 3 bis 5 Kacheln entfernt auf der anderen, nur Flüssigkeit dazwischen, freie Sicht. Ob es einen langen Weg ums Wasser gibt, spielt keine Rolle: im Abstand `nah` (5 Kacheln) rammt das Tier zuerst.
function fluessigPaar(S) {
  const leg = S.k.legende, m = S.m1, E = S.E;
  const fl = (x, y) => { const c = S.k.rows[y] && S.k.rows[y][x]; return !!c && leg[c] && leg[c].kind === 'fluessig'; };
  for (let y = 2; y < S.k.h - 2; y++) for (let x = 2; x < S.k.w - 8; x++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    for (let len = 2; len <= 4; len++) {
      const ax = x, ay = y, bx = x + dx * (len + 1), by = y + dy * (len + 1);
      if (bx >= S.k.w - 1 || by >= S.k.h - 1) continue;
      let wasser = true; for (let i = 1; i <= len; i++) if (!fl(x + dx * i, y + dy * i)) { wasser = false; break; }
      if (!wasser || !m.geht(ax, ay) || !m.geht(bx, by)) continue;
      const a = kachelMitte({ cx: ax, cy: ay }), b = kachelMitte({ cx: bx, cy: by });
      if (!combat.losBetween(E, { x: a.x, y: a.y }, { x: b.x, y: b.y })) continue;
      return { a: { cx: ax, cy: ay }, b: { cx: bx, cy: by }, len, art: S.k.rows[y + dy][x + dx] };
    }
  }
  return null;
}
const zustaendeLog = (S, K, sek, tick) => {   // Eintritte je Zustand und Zeitpunkte
  const ein = { rammen: [], suche: [], steckt: [], pause: [], jagd: [], aufladen: [], patrouille: [] }; let z0 = K.z;
  lauf(S, sek, (t) => { if (K.z !== z0) { (ein[K.z] || (ein[K.z] = [])).push(t); z0 = K.z; } if (tick) tick(t); return false; });
  return ein;
};
const paare = {};   // Szene je Flüssigkeit, für die Messungen
for (const [biom, seeds] of [['wiesenwald', [101, 8020, 15939, 23858, 31777, 39696]], ['vulkan', [101, 8020, 15939, 23858, 31777, 39696]], ['wueste', [101, 8020, 15939]]]) {
  for (const seed of seeds) {
    for (const gr of ['mittel', 'klein']) {
      const S = szene(biom, seed, gr); const P = fluessigPaar(S);
      if (!P) continue;
      const key = P.art === 'v' ? 'lava' : 'wasser';
      if (paare[key]) continue;
      paare[key] = { biom, seed, gr, P };
    }
  }
}
for (const key of ['wasser', 'lava']) {
  section('aufgeben: Spieler hinter ' + (key === 'lava' ? 'Lava' : 'Wasser') + ' (Dauerschleife wird beendet)', () => {
    const f = paare[key];
    ok(!!f, key + ': Stelle gefunden (' + (f ? f.biom + ' ' + f.seed + ' ' + f.gr + ', Tier ' + f.P.a.cx + ',' + f.P.a.cy + ' Spieler ' + f.P.b.cx + ',' + f.P.b.cy + ', ' + f.P.len + ' Kacheln Flüssigkeit' : 'keine') + ')');
    if (!f) return;
    const lauf1 = (typId, sek) => {
      const S = szene(f.biom, f.seed, f.gr); S.p.downed = false;
      const pb = kachelMitte(f.P.b), pa = kachelMitte(f.P.a); S.p.x = pb.x; S.p.y = pb.y;
      const K = Kreatur.erzeugen(S.g, typId, pa.x, pa.y);
      const ein = zustaendeLog(S, K, sek);
      return { S, K, ein };
    };
    const mit = lauf1('rudeltier', 70), ohne = lauf1('ohneaufgeben', 70);
    const suche1 = mit.ein.suche[0];
    const rammenVorSuche = mit.ein.rammen.filter((t) => t < suche1).length;
    ok(mit.ein.suche.length >= 2 && rammenVorSuche === AN, 'mit aufgeben: nach genau ' + rammenVorSuche + ' Anläufen (anlaeufe ' + AN + ') in `suche` bei ' + (suche1 || 0).toFixed(1) + ' s, in 70 s ' + mit.ein.suche.length + ' Mal');
    ok(mit.ein.steckt.filter((t) => t < suche1).length === AN, 'jeder der ' + AN + ' Anläufe endet in steckt (Flüssigkeit hält das Rammen an, kein Schaden)');
    ok(mit.ein.rammen.length <= AN * (mit.ein.suche.length + 1) && mit.ein.rammen.length >= AN * mit.ein.suche.length, 'danach beginnt eine neue Runde mit je ' + AN + ' Anläufen (' + mit.ein.rammen.length + ' Anläufe in 70 s bei ' + mit.ein.suche.length + ' Aufgeben)');
    ok(ohne.ein.suche.length === 0 && ohne.ein.rammen.length >= 10, 'Kontrolle ohne den Baustein: nie `suche`, ' + ohne.ein.rammen.length + ' Anläufe in 70 s (Dauerschleife)');
    ok(mit.S.fehler.length === 0 && mit.K.alive && mit.K.aufgeben && mit.K.aufgeben.n < AN, 'kein Fehler, Zähler am Tier unter der Schwelle (n ' + (mit.K.aufgeben && mit.K.aufgeben.n) + ')');
  });
}

section('aufgeben: Zähler zurück bei Treffer und Verlust des Ziels', () => {
  const S = szene('wueste', 101, 'mittel'); const m = S.m1; const E = S.E;
  // freie Bahn von 9 Kacheln (Maskenpunkte) für das Rammen
  let st = null;
  for (let cy = 3; cy < S.k.h - 3 && !st; cy++) for (let cx = 2; cx < S.k.w - 12 && !st; cx++) { let frei = true; for (let d = 0; d < 9; d++) if (!m.geht(cx + d, cy)) { frei = false; break; } if (frei) st = { cx, cy }; }
  ok(!!st, 'freie Bahn gefunden');
  const rammen = (god, n0) => {
    S.aw.kreaturen = []; S.g.god = god; S.p.downed = false; S.p.zustand = 'ok'; S.p.wunden = undefined;
    const von = kachelMitte(st), ziel = kachelMitte({ cx: st.cx + 3, cy: st.cy }); S.p.x = ziel.x; S.p.y = ziel.y;
    const K = Kreatur.erzeugen(S.g, 'rudeltier', von.x, von.y); K.facing = 0; K.letzte = { x: ziel.x, y: ziel.y }; K.aufgeben = { n: n0 };
    Kreatur.zustandSetzen(S.g, K, 'rammen'); K.facing = 0;
    let war = null; lauf(S, 1.5, () => { if (K.z !== 'rammen') { war = K.z; return true; } return false; });
    return { K, war };
  };
  const treffer = rammen(false, AN - 1);
  ok(treffer.war === 'pause' && treffer.K.aufgeben.n === 0, 'Rammen trifft den Spieler (Wunde): Zähler von ' + (AN - 1) + ' zurück auf 0, weiter in pause (' + treffer.war + ', n ' + treffer.K.aufgeben.n + ')');
  const leer = rammen(true, AN - 1);
  ok(leer.war === 'pause' && leer.K.aufgeben.n === AN, 'Rammen ohne Treffer (game.god): Zähler ' + (AN - 1) + ' -> ' + AN + ' (' + leer.war + ', n ' + leer.K.aufgeben.n + ')');
  const ent = (() => { let z = null; lauf(S, 6, () => { if (leer.K.z === 'suche') { z = 'suche'; return true; } return false; }); return z; })();
  ok(ent === 'suche' && leer.K.aufgeben.n === 0, 'danach in jagd: `aufgegeben` wird wahr, Zustand suche, Zähler verbraucht (n ' + leer.K.aufgeben.n + ')');
  S.g.god = true;
  // Verlust des Ziels
  S.aw.kreaturen = [];
  const von = kachelMitte(st);
  const V = Kreatur.erzeugen(S.g, 'rudeltier', von.x, von.y); V.aufgeben = { n: AN - 1 }; V.letzte = { x: von.x + 100, y: von.y }; V.verlust = KREATUREN.typen.rudeltier.verlustZeit + 1; S.p.downed = true;
  lauf(S, 0.1);
  ok(V.aufgeben.n === 0, 'Ziel verloren (verlustZeit überschritten): Zähler zurück auf 0');
  const Wt = Kreatur.erzeugen(S.g, 'rudeltier', von.x, von.y); Wt.aufgeben = { n: AN - 1 }; Wt.letzte = { x: von.x + 100, y: von.y }; W.verlust = 0;
  lauf(S, 0.1);
  ok(Wt.aufgeben.n === AN - 1, 'Kontrolle: Ziel nicht verloren: Zähler bleibt ' + (AN - 1));
});

// ---------- Rammen in Baum und Fels ----------
section('Rammen in Baum und Fels: steckt (echter Typ)', () => {
  const gefunden = { Y: null, F: null };
  for (const seed of [3, 11, 20, 29, 38, 47, 56, 65, 74, 83]) {
    if (gefunden.Y && gefunden.F) break;
    const S = szene('wiesenwald', seed);
    for (const z of ['Y', 'F']) {
      if (gefunden[z]) continue;
      const m = S.m1;
      for (let cy = 3; cy < S.k.h - 3 && !gefunden[z]; cy++) for (let cx = 2; cx < S.k.w - 9; cx++) {
        let frei = true; for (let d = 0; d < 6; d++) if (!m.geht(cx + d, cy)) { frei = false; break; }
        if (frei && S.k.rows[cy][cx + 6] === z) { gefunden[z] = { S, cx, cy, hx: cx + 6 }; break; }
      }
    }
  }
  for (const z of ['Y', 'F']) {
    const G = gefunden[z];
    ok(!!G, 'Stelle mit ' + (z === 'Y' ? 'Baum' : 'Fels') + ' in der Rammlinie gefunden');
    if (!G) continue;
    const S = G.S; const R = KREATUREN.typen.rudeltier.zustaende.rammen;
    const K = Kreatur.erzeugen(S.g, 'rudeltier', (G.cx + 0.5) * TILE, (G.cy + 0.5) * TILE);
    Kreatur.zustandSetzen(S.g, K, 'rammen'); K.facing = 0;
    let steckt = null, ueber = 0;
    lauf(S, 3, (t) => { if (boxUeberlappt(S.E, K.x, K.y, BOX)) ueber++; if (K.z === 'steckt') { steckt = { t, x: K.x }; return true; } return K.z !== 'rammen'; });
    const kante = G.hx * TILE - BOX / 2, schritt = R.tempo * DT;
    ok(!!steckt && steckt.t < R.dauer && steckt.x <= kante + 0.001 && steckt.x >= kante - schritt - 0.001 && ueber === 0 && K.aufgeben && K.aufgeben.n === 1,
      (z === 'Y' ? 'Baum' : 'Fels') + ': steckt nach ' + (steckt ? steckt.t.toFixed(2) : '-') + ' s bei x ' + (steckt ? steckt.x.toFixed(1) : '-') + ' (Kante der Box ' + kante + ', höchstens ' + schritt.toFixed(1) + ' px davor), Überlappung ' + ueber + ', Zähler aufgeben ' + (K.aufgeben ? K.aufgeben.n : '-'));
  }
});

// ---------- Räumen ----------
section('Räumen: Szenario-Start (Graben, Wellen) räumt Kreaturen und Buchführung', () => {
  const orig = combat.ensureV2;
  const spiel = (modus, opt) => {
    let gepflanzt = 0;
    combat.ensureV2 = function (game, aw, salt) { const r = orig.apply(this, arguments); if (aw && !gepflanzt) { aw.kreaturen = [{ id: 'KX', kind: 'kreatur', kreatur: true, typ: 'rudeltier', gruppe: 'a', alive: true, x: 100, y: 100 }]; aw.kreaturGruppen = { a: { erschienen: 1, typ: 'rudeltier' } }; gepflanzt = 1; } return r; };
    try {
      const g = new Game({ noStore: true, seed: 13, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
      const c = { inbox: [], send(m) { if (this.inbox.length < 500) this.inbox.push(m); } };
      g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'Z0', name: 'Z0', color: 0 });
      g.handleMessage(c, { t: 'lobbyOpt', startMission: modus, ...opt }); g.handleMessage(c, { t: 'ready', ready: true });
      return { g, gepflanzt };
    } finally { combat.ensureV2 = orig; }
  };
  for (const [modus, opt] of [['arena_graben', {}], ['arena_away', { wellen: 'kesh' }]]) {
    const r = spiel(modus, opt); const aw = r.g.away;
    ok(r.gepflanzt === 1 && aw && aw.kreaturen.length === 0 && aw.kreaturGruppen === undefined, modus + ': Rudel und aw.kreaturGruppen vor dem Start gepflanzt, danach beides weg (' + (aw ? aw.kreaturen.length + ' Tiere, Gruppen ' + JSON.stringify(aw.kreaturGruppen) : 'keine Karte') + ')');
  }
  const aw = { kreaturen: [], kreaturGruppen: { a: { erschienen: 3, typ: 'rudeltier' } }, drones: [] };
  Kreatur.raeumen(aw);
  ok(aw.kreaturGruppen === undefined, 'raeumen räumt aw.kreaturGruppen auch ohne lebende Tiere (alle ausgefallen oder aufgelöst)');
  const leer = { drones: [], kreaturen: [] }; Kreatur.raeumen(leer);
  ok(!('kreaturGruppen' in leer) && leer.kreaturen.length === 0 && Kreatur.raeumen(null) === undefined, 'raeumen legt kein Feld an (Karte ohne Rudel unverändert)');
});

// ---------- Ohne Rudel nichts verändert ----------
section('Leere aw.kreaturen: Verhalten bytegleich', () => {
  const S = szene('wueste', 101, 'mittel');
  const aw = S.aw; const r0 = aw.rng(); S.p.downed = false;
  const vorher = JSON.stringify(aw, (k, v) => (typeof v === 'function' ? undefined : v));
  lauf(S, 5);
  const nachher = JSON.stringify(aw, (k, v) => (typeof v === 'function' ? undefined : v));
  ok(vorher === nachher && aw.kreaturGruppen === undefined, 'ohne Kreaturen ändert 5 s Kreatur.update die Außenkarte nicht');
  ok(Kreatur.ziele(aw) === aw.drones, 'ziele(aw) ohne Kreaturen: dieselbe Referenz wie aw.drones');
  const T = Kreatur.snapFeld(S.g);
  ok(JSON.stringify(T) === '{}' && S.g.snapshot().away.kr === undefined, 'kein Snapshot-Feld kr ohne Kreaturen');
  const K = Kreatur.erzeugen(S.g, 'rudeltier', 100, 100);
  ok(!('gruppe' in K) && !('aufgeben' in K) && K.z === 'patrouille', 'ein Tier ohne gruppe trägt kein Rudel-Feld, der Zähler aufgeben entsteht erst beim ersten Rammen');
  ok(r0 !== undefined, 'aw.rng läuft');
});

// ---------- Kein Typname im Servercode ----------
section('Kein Typname im Servercode', () => {
  const namen = ['rudeltier', 'kreatur.rudeltier'];
  const dateien = [];
  const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) geh(p); else if (e.name.endsWith('.js')) dateien.push(p); } };
  geh(path.join(__dirname, '..', 'server'));
  const treffer = [];
  for (const f of dateien) { const text = fs.readFileSync(f, 'utf8'); for (const nm of namen) if (new RegExp('[\'"`]' + nm.replace('.', '\\.') + '[\'"`]|\\.' + nm.replace('.', '\\.') + '\\b').test(text)) treffer.push(path.relative(path.join(__dirname, '..'), f) + ' ~ ' + nm); }
  ok(dateien.length > 50 && treffer.length === 0, 'kein Typname im server/ (' + dateien.length + ' Dateien)' + (treffer.length ? ': ' + treffer.join('; ') : ''));
  const reg = fs.readFileSync(path.join(__dirname, '..', 'server', 'mission', 'bausteine', 'kreaturen.js'), 'utf8');
  ok(!/rudeltier|probe/i.test(reg.replace(/\/\/.*$/gm, '')), 'das Plugin kreaturen.js enthält keinen Typnamen im Code');
  const Registry = require('../server/mission/registry.js');
  const d = Registry.describe().find((x) => x.id === 'kreatur_besetzen');
  ok(!!d && d.art === 'aktion' && d.params.gruppe.typ === 'string' && d.params.typ.typ === 'string' && d.params.map.typ === 'map' && d.params.bereich.typ === 'area' && d.params.anzahl.min === 1 && d.params.anzahl.max === 12, 'Aktion kreatur_besetzen registriert: gruppe und typ als string (nicht squad), anzahl 1 bis 12, map, bereich als area');
});

hookAb();
delete KREATUREN.typen.ohneaufgeben; delete KREATUREN.typen.hookprobe; delete KREATUREN.typen.mitbindung;
console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
