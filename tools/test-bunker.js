'use strict';
// BOD-03 Paket B (B1-B3): Deck 1 = römischer Bunker auf der festen Karte Grabenangriff, Lift, Pad am Bunkereingang, Lüftungsrohr. Headless:
//  - B1 Bunker: Deck 1 ist EXAKT die Ausgabe von tools/gen-bunker.js (Seed 3, Station 48x44 gespiegelt), zwei Decks, Stride 44, alle Zeilen gleich
//    breit, Prüfer ok (ohne K-MAUER-DICHT, K-INSEL, K-PFLICHT), Pflicht-Anker erfüllt (auch sprengpunkt im Reaktorraum), keine Station-Anker
//    abholpunkt/eingang/ziel im Bunker, Payload unter der Grenze und unter 14 KB (keine Lauflängen nötig)
//  - B2 Oberfläche: Lift oben im Bunkertor, Pad am Bunkereingang = zweiter abholpunkt OHNE ankunft (in pads, nicht in ankunftPads, immer aktiv),
//    die Oberfläche ist sonst unverändert (nur das Pad und die Rohr-Kisten), Kollision der neuen Gegenstände
//  - B3 Rohr: Standardkachel + Anker leiter (keine r-Kachel), Kriechgang auf Deck 1; eine r-Kachel am Eingang würde K-MAUER-DICHT auslösen
//  - Spiel: Lift Oberfläche -> Deck 1 -> zurück (1,5 s, Snapshot players[].deck), Rohr beide Richtungen (2,0 s), Beamen: Ankunft bleibt oben,
//    zweites Pad bietet das Hochbeamen; Szenario Grabenangriff: Start mit der Besetzung wie bisher, der Bunker ist leer von Gegnern
//   node tools/test-bunker.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Physics = require('../shared/physics.js');
const Buehne = require('../shared/buehne.js');
const GenFest = require('../shared/gen-fest.js');
const GenStation = require('../shared/gen-station.js');
const GenBunker = require('./gen-bunker.js');
const fs = require('fs');
const path = require('path');
const { Game } = require('../server/game.js');
const L = require('../server/sim/landepunkte.js');
const interior = require('../server/sim/interior.js');
const away = require('../server/sim/away.js');
const W = require('../server/world.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const fehlerZahl = (g) => (Array.isArray(g.errors) ? g.errors.length : g.errors | 0);
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const codes = (r) => r.fehler.map((f) => f.code + ' ' + f.msg);

const DEF = L.festkarte('grabenangriff');
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'festkarte-ein-deck.json'), 'utf8'));   // Karte vor B1 (ein Deck)
const bauen = (def, opts) => Buehne.ausRaster(GenFest.karteRoh(def, Object.assign({ id: 'test.bunker', bauweise: 'rom_feld' }, opts || {})), { spiel: true });
const R = bauen(DEF);
const K = R.karte;
const H0 = DEF.hoehe, STRIDE = K.decks && K.decks.stride;
const anker = (id) => K.anker.find((a) => a.id === id);
const tileInfo = (x, y) => K.legende[(K.rows[y] || '')[x]] || null;

section('B1 Bunker: Deck 1 ist die gebackene Station (tools/gen-bunker.js)', () => {
  ok(GenBunker.SEED === 3, 'Seed der Station ist eine Konstante: 3');
  ok(JSON.stringify(DEF.decks[1]) === JSON.stringify(GenBunker.bunkerDeck()), 'content/grabenangriff.json decks[1] = Ausgabe des Werkzeugs (reproduzierbar, nichts von Hand verändert)');
  ok(JSON.stringify(GenBunker.bunkerDeck()) === JSON.stringify(GenBunker.bunkerDeck()), 'zweimal erzeugt: gleiche Ausgabe');
  const st = GenStation.erzeuger(96, 56).karteRoh(3, 8, { bauweise: 'rom_feld', id: 'bunker' });
  ok(st.w === 48 && st.h === 44, 'Station Seed 3 ist 48x44 (kleinste Station)');
  const spiegel = st.rows.map((r) => '_'.repeat(GenBunker.VOR) + r.split('').reverse().join(''));
  ok(K.rows.slice(STRIDE, STRIDE + 44).map((r) => r.slice(1, 99)).every((r, i) => r === spiegel[i]) && K.rows.slice(STRIDE, STRIDE + 44).every((r) => r[0] === '_' && r[99] === '_'), 'Deck 1 Zeile für Zeile = gespiegelte Station, links mit _ aufgefüllt, Rand _');
  ok(DEF.format === 'festkarte/2' && DEF.decks.length === 2 && DEF.decks[1].id === 'bunker' && DEF.decks[1].abschnitte.bunker.waehlbar === false, 'festkarte/2, Deck 1 = bunker, Abschnitt nicht wählbar');
  ok(K.w === 100 && K.h === 88 && STRIDE === 44 && K.rows.length === 88 && K.rows.every((r) => r.length === 100), 'Raster 100x88, Stride 44, alle Zeilen gleich breit');
  ok(K.rows.slice(H0, STRIDE).every((r) => /^_+$/.test(r)), 'Lücke zwischen den Decks (Zeile 36..43) nur _');
  ok(K.decks.links.length === 2 && K.decks.links[0].via === 'lift' && K.decks.links[1].via === 'leiter', 'Deck-Links: Lift und Leiter (Rohr)');
  ok(K.erzeuger === 'gen-fest/2' && K.ankunft === 'landung.abholpunkt' && K.meta.fest === 'grabenangriff', 'Kennung gen-fest/2, Ankunft bleibt der Abholpunkt der Landung');
  // Bunker: Anker der Station
  const unten = K.anker.filter((a) => a.y >= STRIDE);
  ok(!unten.some((a) => a.rolle === 'abholpunkt' || a.rolle === 'eingang' || a.rolle === 'ziel'), 'im Bunker keine Station-Anker abholpunkt, eingang, ziel');
  const sp = unten.filter((a) => a.rolle === 'sprengpunkt');
  const reaktor = K.bereiche.bk_kern.rects;
  ok(sp.length === 1 && sp[0].id === 'bk.reaktor.sprengpunkt' && reaktor.some((q) => sp[0].x >= q[0] && sp[0].x < q[0] + q[2] && sp[0].y >= q[1] && sp[0].y < q[1] + q[3]), 'Sprengpunkt im Reaktorraum (' + (sp[0] && sp[0].x + ',' + sp[0].y) + ')');
  ok(unten.every((a) => !a.gruppe) && Object.values(K.meta.gruppen).every((ids) => ids.every((id) => anker(id).y < H0)) && JSON.stringify(Object.keys(K.meta.wellen)) === '["1","2"]', 'Bunker ohne Gruppe: meta.wellen bleibt 1 und 2, alle Gruppen-Anker auf der Oberfläche (Bunker leer von Gegnern)');
  ok(unten.some((a) => a.rolle === 'wache') && unten.some((a) => a.rolle === 'patrouille') && unten.some((a) => a.rolle === 'terminal') && unten.some((a) => a.rolle === 'tor') && unten.some((a) => a.rolle === 'versteck'), 'Station-Anker bleiben: Wachen, Patrouillen, Terminals, Tor, Versteck');
  const ids = K.anker.map((a) => a.id);
  ok(new Set(ids).size === ids.length, 'Anker-IDs über beide Decks eindeutig');
  ok(!K.rows.some((r) => r.includes('r')), 'keine r-Kachel (Rohr) irgendwo in der Karte');
  ok(Object.keys(K.kanten).length > 10 && Object.values(K.kanten).some((k) => k.typ === 'tuer'), `Kanten (Türen, Schotts) aus dem Raster abgeleitet (${Object.keys(K.kanten).length})`);
});

section('B1/B3 Prüfer', () => {
  ok(R.pruefung.ok && R.fehler.length === 0, 'Prüfer ok:true, keine Fehler' + (R.fehler.length ? ' ' + JSON.stringify(codes(R).slice(0, 3)) : ''));
  ok(!codes(R).some((c) => /K-MAUER-DICHT|K-INSEL|K-PFLICHT|K-DECK|K-ERREICHBAR|K-ROHR/.test(c)), 'kein K-MAUER-DICHT, K-INSEL, K-PFLICHT, K-DECK, K-ERREICHBAR, K-ROHR');
  const pf = K.meta.pflicht;
  const zahl = (r) => K.anker.filter((a) => a.rolle === r).length;
  ok(Object.keys(pf).filter((r) => r !== 'lift' && r !== 'leiter').every((r) => zahl(r) >= pf[r]) && K.decks.links.filter((l) => l.via === 'lift').length >= pf.lift && K.decks.links.filter((l) => l.via === 'leiter').length >= pf.leiter, 'Pflicht-Anker erfüllt: ' + Object.keys(pf).map((r) => r + ' ' + pf[r]).join(', '));
  ok(pf.sprengpunkt === 1 && pf.lift === 1 && pf.leiter === 1, 'Pflicht ergänzt: sprengpunkt, lift, leiter (je 1)');
  // Mutation: das Rohr als r-Kachel am Eingang (Mund, Mauerstück, Mund) macht die offene Wiese undicht -> K-MAUER-DICHT (deshalb Standardkachel + Anker)
  const d = clone(DEF); const wald = d.decks[0].abschnitte.wald.varianten.weg;
  for (const y of [18, 19, 20]) wald.rows[y] = wald.rows[y].slice(0, 22) + 'r' + wald.rows[y].slice(23);
  const rm = bauen(d);
  ok(codes(rm).some((c) => /K-MAUER-DICHT/.test(c)), 'Gegenprobe: dieselbe Stelle als r-Kacheln -> K-MAUER-DICHT (' + (codes(rm).find((c) => /K-MAUER-DICHT/.test(c)) || 'keine').slice(0, 60) + ')');
  // Negativ: Lift ohne Gegenstück-Link
  const d2 = clone(DEF); d2.links = d2.links.filter((l) => l.via === 'leiter');
  ok(codes(bauen(d2)).some((c) => /K-DECK bunker\.lift\.oben: kein Deck-Link/.test(c)), 'Gegenprobe: Lift ohne Link wird abgewiesen (K-DECK)');
});

section('Payload', () => {
  const B = payloadB(K);
  console.log(`  Messung: awayMap-Payload ${B} B (Grenze ${Protocol.AWAY_MAP_MAX_BYTES} B), Oberfläche allein vor B1 ${payloadB(bauen(FIX).karte)} B`);
  ok(B <= Protocol.AWAY_MAP_MAX_BYTES, `Payload ${B} B <= AWAY_MAP_MAX_BYTES ${Protocol.AWAY_MAP_MAX_BYTES}`);
  ok(B <= 14336, `Payload ${B} B <= 14336 (14 KB): keine Lauflängen für die Deck-Zeilen nötig`);
});

section('B2 Oberfläche: Bunkertor, Lift oben, Pad, nur wenige Kacheln verändert', () => {
  // Oberfläche gegen die Karte vor B1: genau 6 Pad-Kacheln (Bunkertor) und 3 Kisten (Rohr), sonst Zeichen für Zeichen gleich
  const alt = GenFest.karteRoh(FIX, { id: 'x' }).rows;
  const diff = []; for (let y = 0; y < H0; y++) for (let x = 0; x < 100; x++) if (alt[y][x] !== K.rows[y][x]) diff.push(`${K.rows[y][x]}${x},${y}`);
  ok(diff.length === 9 && diff.filter((d) => d[0] === 'P').length === 6 && diff.filter((d) => d[0] === 'o').length === 3, 'Oberfläche gegenüber vor B1: 6 Pad-Kacheln P und 3 Kisten o, sonst unverändert (' + diff.join(' ') + ')');
  const lift = anker('bunker.lift.oben'), halle = K.bereiche.eingang.rects[0];
  ok(lift && lift.rolle === 'lift' && lift.x >= halle[0] && lift.x < halle[0] + halle[2] && tileInfo(lift.x, lift.y).kind === 'boden2', `Lift oben im Bunkertor (Bereich eingang) bei (${lift.x},${lift.y}), auf Boden`);
  const ziel = anker('bunker.ziel');
  ok(Math.max(Math.abs(lift.x - ziel.x), Math.abs(lift.y - ziel.y)) >= 3, 'Lift liegt nicht in Reichweite (8 Nachbarn) des Ziels: E am Ziel startet keine Liftfahrt');
  const pad = anker('bunker.pad'), lk = anker('landung.abholpunkt');
  ok(pad.rolle === 'abholpunkt' && !pad.ankunft && lk.ankunft && K.abholpunkte.length === 2 && K.ankunft === 'landung.abholpunkt', 'zweiter abholpunkt bunker.pad ohne ankunft, Ankunft bleibt die Landung');
  W.AWAY_MAPS['test.bunker'] = { id: 'test.bunker', karte: K };
  const info = interior.awayInfoOf('test.bunker');
  delete W.AWAY_MAPS['test.bunker'];
  const inPads = (t) => info.pads.some((q) => q.x === t.x && q.y === t.y);
  const padKacheln = Buehne.padTiles(K, pad);
  ok(padKacheln.length >= 3 && padKacheln.every(inPads) && padKacheln.every((t) => !info.ankunftPads.some((q) => q.x === t.x && q.y === t.y)), `zweites Pad (${padKacheln.length} Kacheln) in pads, nicht in ankunftPads`);
  ok(info.ankunftPads.every((t) => t.x < 10), 'ankunftPads nur am Landefeld links (Hinunterbeamen landet nie am Bunker)');
  ok(Math.abs(pad.x - lift.x) + Math.abs(pad.y - lift.y) <= 16 && pad.x > halle[0], 'Pad im Bunkertor, nahe dem Lift');
  // Gegenstände brauchen Kollision: Kisten und Hallenwände fest, die Pad-Kacheln begehbar
  const kisten = [[61, 19], [62, 19], [62, 20]];
  ok(kisten.every(([x, y]) => K.rows[y][x] === 'o' && tileInfo(x, y).solid), 'Rohr-Verkleidung (Kisten o) ist fest (Kollision)');
  ok(padKacheln.every((t) => !tileInfo(t.x, t.y).solid), 'Pad-Kacheln begehbar');
  // Wege nicht zugemauert: von der Ankunft aus erreichbar bleiben alle Wachen und Eingänge (Oberfläche, ohne Deck-Links), Wald-Weg zu Fuß
  const seen = new Set(), q = [[lk.x, lk.y]]; seen.add(lk.y * 100 + lk.x);
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = y + dy, kk = b * 100 + a; if (a < 0 || b < 0 || a > 99 || b >= H0 || seen.has(kk) || tileInfo(a, b).solid) continue; seen.add(kk); q.push([a, b]); } }
  const oben = K.anker.filter((a) => a.y < H0 && ['wache', 'aussicht', 'eingang', 'ziel', 'lift', 'leiter', 'abholpunkt'].includes(a.rolle));
  const nicht = oben.filter((a) => !seen.has(a.y * 100 + a.x) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((a.y + dy) * 100 + a.x + dx)));
  ok(nicht.length === 0, `zu Fuß ohne Lift erreichbar: alle ${oben.length} Anker der Oberfläche (Wachen, Posten, Tor, Lift, Rohr, Pads)` + (nicht.length ? ' FEHLT ' + nicht.map((a) => a.id).join() : ''));
});

section('B3 Rohr: Mündung in der Waldmitte, Kriechgang auf Deck 1', () => {
  const o = anker('rohr.oben'), u = anker('rohr.unten'), wald = K.bereiche.wald.rects[0];
  ok(o.rolle === 'leiter' && u.rolle === 'leiter' && tileInfo(o.x, o.y).kind === 'gelaende', `Mündung oben (${o.x},${o.y}): Standardkachel (Gelände) + Anker leiter`);
  const mitte = wald[0] + wald[2] / 2;
  ok(Math.abs(o.x - mitte) <= 6 && o.y > 8 && o.y < H0 - 8, `Mündung in der Mitte des Waldstücks (x ${o.x} bei Mitte ${mitte}, y ${o.y})`);
  ok(Math.abs(u.x - o.x) <= 4 && Math.abs((u.y - STRIDE) - o.y) <= 2, `Rohr-Ende unten (${u.x},${u.y}) liegt ungefähr unter der Mündung (Deck-Koordinaten ${u.x},${u.y - STRIDE})`);
  // Kriechgang: Boden, links und rechts bzw. oben und unten Wand (1 breit), nur über Luken von den Räumen aus
  const w = (x, y) => tileInfo(x, y) && tileInfo(x, y).kind === 'wand';
  ok(tileInfo(u.x, u.y).kind === 'boden' && w(u.x, u.y - 1) && w(u.x, u.y + 1), 'Rohr-Ende liegt in einem 1 breiten Kriechgang (Wand oben und unten)');
  ok(tileInfo(u.x - 1, u.y).kind === 'boden' && tileInfo(u.x + 1, u.y).kind === 'boden', 'Kriechgang läuft nach beiden Seiten weiter');
  const raum = Object.keys(K.bereiche).filter((b) => /^bk_/.test(b));
  ok(raum.length === 3 && !K.bereiche.bk_kern.rects.some((r) => u.x >= r[0] && u.x < r[0] + r[2] && u.y >= r[1] && u.y < r[1] + r[3]), 'Rohr-Ende liegt in keinem Raum (Kriechgang um die Räume)');
  ok(!K.rows.some((r) => r.includes('r')) && tileInfo(o.x, o.y).kind !== 'rohr', 'keine r-Kachel am Eingang (Prüfer K-MAUER-DICHT)');
});

// ---------------------------------------------------------------------------------------------------------------------
// Spiel: die Karte über landepunkte im Spiel (wie test-grabenangriff-karte), Spieler per Game-Simulation
function spiel(np, seed) {
  const g = new Game({ noStore: true, seed: seed || 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'B' + i, color: i }); g.handleMessage(c, { t: 'ready', ready: true }); cs.push(c); }
  const lp = L.testgelaende(g, { ort: g.ship.scene || 'kesh', id: 'test.bunker.spiel' + seed, art: 'aussenposten', seed: 3, besitz: 'rom', gen: { fest: 'grabenangriff' } });
  L.get(g, lp);
  g.transferZiel = { lp, scene: g.ship.scene }; g.setAwayMap(lp);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  const k = W.AWAY_MAPS[lp].karte;
  const P = (i) => g.players[i];
  const send = (i, m) => g.handleMessage(cs[i], m);
  const place = (i, tx, ty, dir) => { const p = P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.dir = dir || 'down'; p.input.mx = 0; p.input.my = 0; };
  const tileOf = (o) => Physics.toTile(o.x, o.y);
  const deckSnap = (i) => g.snapshot().players.find((q) => q.id === P(i).id).deck;
  // läuft bis cond() wahr ist; -> Sekunden (max. maxS), schützt die Spieler vor Ausfällen
  const bis = (cond, maxS) => { let t = 0; while (!cond() && t < Math.round(maxS * CONFIG.tickHz)) { for (const p of g.players) { if (p.shield) p.shield.seg = 3; } g.step(); t++; } return t / CONFIG.tickHz; };
  return { g, cs, lp, k, P, send, place, tileOf, deckSnap, bis };
}

section('Spiel: Lift Oberfläche -> Deck 1 -> zurück (1,5 s), Snapshot players[].deck', () => {
  const { g, k, P, send, place, tileOf, deckSnap, bis } = spiel(2, 11);
  const lo = k.anker.find((a) => a.id === 'bunker.lift.oben'), lu = k.anker.find((a) => a.id === 'bunker.lift.unten');
  const ab = k.anker.find((a) => a.id === 'landung.abholpunkt');
  ok(P(0).zone === 'away' && deckSnap(0) === 0 && Math.abs(tileOf(P(0)).x - ab.x) <= 4, 'Spieler beamen weiterhin auf der Oberfläche an (Ankunft-Pad, Deck 0)');
  ok(g.snapshot().players.every((q) => q.deck === 0), 'Snapshot players[].deck = 0 für alle');
  place(0, lo.x, lo.y);
  send(0, { t: 'act', down: true }); send(0, { t: 'act', down: false });
  ok(P(0).lift && P(0).lift.away, 'Lift oben: E tippen startet die Fahrt');
  const T = bis(() => !P(0).lift, 4);
  const t = tileOf(P(0));
  ok(Math.abs(T - (g.C.lift.rideTime || 1.5)) <= 0.2 && T >= 1.3, `Fahrt nach unten ${T.toFixed(2)} s (etwa 1,5 s)`);
  ok(Math.abs(t.x - lu.x) <= 1 && Math.abs(t.y - lu.y) <= 1 && t.y >= k.decks.stride, `angekommen im Bunker bei (${t.x},${t.y}), Lift unten (${lu.x},${lu.y})`);
  ok(deckSnap(0) === 1 && deckSnap(1) === 0, 'Snapshot players[].deck = 1 unten, der andere Spieler bleibt auf 0');
  send(0, { t: 'act', down: true }); send(0, { t: 'act', down: false });
  ok(P(0).lift && P(0).lift.away, 'Lift unten: E tippen startet die Fahrt nach oben');
  const T2 = bis(() => !P(0).lift, 4);
  const t2 = tileOf(P(0));
  ok(Math.abs(T2 - 1.5) <= 0.2 && Math.abs(t2.x - lo.x) <= 1 && Math.abs(t2.y - lo.y) <= 1 && deckSnap(0) === 0, `zurück oben bei (${t2.x},${t2.y}) nach ${T2.toFixed(2)} s, deck = 0`);
  ok(fehlerZahl(g) === 0, 'keine Server-Fehler');
});

section('Spiel: Rohr (Leiter) in beide Richtungen, etwa 2,0 s', () => {
  const { g, k, P, send, place, tileOf, deckSnap, bis } = spiel(1, 12);
  const ro = k.anker.find((a) => a.id === 'rohr.oben'), ru = k.anker.find((a) => a.id === 'rohr.unten');
  const lt = (g.C.lift && g.C.lift.ladderTime) || 2;
  place(0, ro.x, ro.y, 'up');
  send(0, { t: 'act', down: true });
  ok(P(0).hold && P(0).hold.kind === 'ladder', 'Rohr oben: E halten startet die Leiter');
  const T = bis(() => deckSnap(0) === 1, 4); send(0, { t: 'act', down: false });
  let t = tileOf(P(0));
  ok(Math.abs(T - lt) <= 0.25 && Math.abs(lt - 2) < 0.01, `Fahrt nach unten ${T.toFixed(2)} s (ladderTime ${lt} s, etwa 2,0 s)`);
  ok(Math.abs(t.x - ru.x) <= 1 && Math.abs(t.y - ru.y) <= 1 && t.y >= k.decks.stride, `unten im Kriechgang bei (${t.x},${t.y}), Rohr-Ende (${ru.x},${ru.y})`);
  ok(!k.bereiche.bk_kern.rects.some((r) => t.x >= r[0] && t.x < r[0] + r[2] && t.y >= r[1] && t.y < r[1] + r[3]), 'Ankunft im Kriechgang, nicht in einem Raum');
  P(0).input.mx = 0; P(0).input.my = 0;
  place(0, ru.x, ru.y, 'up');
  send(0, { t: 'act', down: true });
  ok(P(0).hold && P(0).hold.kind === 'ladder', 'Rohr unten: E halten startet die Leiter');
  const T2 = bis(() => deckSnap(0) === 0, 4); send(0, { t: 'act', down: false });
  t = tileOf(P(0));
  ok(Math.abs(T2 - lt) <= 0.25 && Math.abs(t.x - ro.x) <= 1 && Math.abs(t.y - ro.y) <= 1, `Fahrt nach oben ${T2.toFixed(2)} s, oben bei (${t.x},${t.y}), Mündung (${ro.x},${ro.y})`);
  place(0, ro.x, ro.y, 'up');
  send(0, { t: 'act', down: true });
  bis(() => false, 1.0); send(0, { t: 'act', down: false });
  ok(deckSnap(0) === 0 && !P(0).hold, 'zu kurz gehalten (1 s): keine Fahrt, die Leiter braucht die volle Zeit');
  ok(fehlerZahl(g) === 0, 'keine Server-Fehler');
});

section('Spiel: Pad am Bunkereingang (zweiter abholpunkt) und Ankunft', () => {
  const { g, k, lp, P, send, place, tileOf, deckSnap, bis } = spiel(2, 13);
  const info = interior.awayInfoOf(lp);
  const pad = k.anker.find((a) => a.id === 'bunker.pad');
  ok(info.pads.some((q) => q.x === pad.x && q.y === pad.y) && !info.ankunftPads.some((q) => q.x === pad.x && q.y === pad.y), 'Pad in pads, nicht in ankunftPads (Server-Ableitung)');
  // das Pad ist immer aktiv: E auf dem Pad bietet das Hochbeamen (selfbeam), auch ohne Sprengung
  place(0, pad.x, pad.y);
  const liste = interior.interactionsAt(g, P(0), pad.x, pad.y, true);
  ok(liste.some((i) => i.kind === 'selfbeam' && !i.blocked), 'auf dem Pad: selfbeam angeboten (immer aktiv)');
  const lo = k.anker.find((a) => a.id === 'bunker.lift.oben');
  ok(!interior.interactionsAt(g, P(0), lo.x, lo.y, true).some((i) => i.kind === 'selfbeam'), 'auf dem Lift: kein selfbeam');
  // hochbeamen vom Pad, wieder hinunter: Landung am Ankunft-Pad der Oberfläche links, nie am Bunkerpad
  away.executeBeam(g, [P(0).id], 'up');
  bis(() => false, 0.5);
  ok(P(0).zone === 'ship', 'Hochbeamen vom Pad am Bunkereingang bringt den Spieler an Bord');
  away.executeBeam(g, [P(0).id], 'down');
  const ab = k.anker.find((a) => a.id === 'landung.abholpunkt');
  const t = tileOf(P(0));
  ok(P(0).zone === 'away' && Math.abs(t.x - ab.x) <= 4 && deckSnap(0) === 0, `Hinunterbeamen landet wieder am Landefeld links (${t.x},${t.y}), Deck 0`);
  ok(fehlerZahl(g) === 0, 'keine Server-Fehler');
});

section('Szenario Grabenangriff: Start unverändert, Bunker leer von Gegnern', () => {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 2; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 2000) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S' + i, name: 'S' + i, color: i }); cs.push(c); }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_graben' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const S = g.arena && g.arena.wellen, aw = S && g.aways[S.lp], k = S && W.AWAY_MAPS[S.lp].karte;
  ok(S && S.buehne === 'graben' && k.decks && k.decks.stride === 44 && k.h === 88, 'Szenario startet mit der Zwei-Deck-Karte');
  for (let i = 0; i < 5 * CONFIG.tickHz; i++) g.step();
  const gegner = aw.drones.filter((e) => e.alive);
  ok(gegner.length === 9 && S.gesamt === 9, 'Besetzung wie bisher: 9 Gegner für 2 Spieler (Welle 1 und 2 unverändert)');
  ok(gegner.every((e) => Physics.toTile(e.x, e.y).y < k.decks.stride), 'kein Gegner im Bunker (Deck 1)');
  const ab = k.anker.find((a) => a.id === 'landung.abholpunkt');
  ok(g.players.every((p) => p.zone === 'away' && Math.abs(Physics.toTile(p.x, p.y).x - ab.x) <= 4 && Physics.toTile(p.x, p.y).y < k.decks.stride), 'Crew beamt am Landefeld auf der Oberfläche an');
  for (let i = 0; i < 60 * CONFIG.tickHz; i++) g.step();
  ok(aw.drones.filter((e) => e.alive).every((e) => Physics.toTile(e.x, e.y).y < k.decks.stride), 'nach 60 s weiter kein Gegner unten (kein Link-Gebrauch ohne Alarm)');
  ok(fehlerZahl(g) === 0, 'keine Server-Fehler');
});

console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
