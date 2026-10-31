'use strict';
// VOX-01 Paket 4: neue Kachelarten Y (baum), H (brustwehr), ; (grabensohle) mit exakt den Regelwerten von F (fels), o (deckung_halb), , (boden2).
// Kernidee Ersatz-Äquivalenz: dasselbe Testraster (Wiese, Graben mit o-Brustwehr und ,-Sohle, Wald aus F, Lager) einmal original und
// einmal mit F->Y, o->H, ,->; über Buehne.ausRaster(roh, { spiel: true }) bauen. Nachweis, dass Regeln, Sicht, Deckung, Begehbarkeit
// und Schuss gleich sind. Die Gegenprobe (H->O) zeigt, dass der Vergleich Unterschiede auch findet.
//   node tools/test-vox01-kacheln.js
const fs = require('fs');
const path = require('path');
const Physics = require('../shared/physics.js');
const Los = require('../shared/los.js');
const Buehne = require('../shared/buehne.js');
const W = require('../server/world.js');
const interior = require('../server/sim/interior.js');
const away = require('../server/sim/away.js');
const squad = require('../server/sim/squad.js');
const combat = require('../server/sim/combat.js');
const { Game } = require('../server/game.js');
const AC = require('../shared/config.js').awayCombat;
const ROOT = path.join(__dirname, '..');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const NEU = { F: 'Y', o: 'H', ',': ';' };
const REGELFELDER = ['solid', 'cover', 'low', 'sperrtSicht', 'kante', 'stopptSchuesse', 'zustaende', 'begehbarIn', 'sperrtSichtGeschlossen'];

// ---------------------------------------------------------------------------------------------- kacheln.json
console.log('\n[kacheln.json: drei neue Zeichen mit den Werten von F, o, ,]');
const kj = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/buehnen/kacheln.json'), 'utf8'));
const KIND = { Y: 'baum', H: 'brustwehr', ';': 'grabensohle' };
for (const [alt, neu] of Object.entries(NEU)) {
  const a = kj.zeichen[alt], b = kj.zeichen[neu];
  ok(!!b && b.kind === KIND[neu] && typeof b.hinweis === 'string' && b.hinweis.length > 0, `"${neu}": kind ${KIND[neu]}, mit hinweis`);
  ok(REGELFELDER.every((f) => JSON.stringify(a[f]) === JSON.stringify(b[f])), `"${neu}" hat alle Regelfelder wie "${alt}" (${a.kind}): ` + JSON.stringify(REGELFELDER.filter((f) => a[f] !== undefined).map((f) => [f, a[f]])));
  ok(Object.keys(b).filter((k) => k !== 'kind' && k !== 'hinweis').sort().join() === Object.keys(a).filter((k) => k !== 'kind' && k !== 'hinweis').sort().join(), `"${neu}": keine zusätzlichen/fehlenden Felder gegenüber "${alt}"`);
}
ok(Object.keys(kj.zeichen).length === new Set(Object.keys(kj.zeichen)).size && !Object.values(kj.zeichen).some((z, i, l) => l.some((q, j) => i !== j && q.kind === z.kind)), 'jede Art kommt genau einmal vor');

// Client-Rückfälle (kit.js, render.js) spiegeln die Zuordnung (Quelltext-Prüfung: kit.js braucht three und läuft nicht in Node)
console.log('\n[Rückfalldarstellung: Voxel (kit.js) und 2D (render.js)]');
{
  const kit = fs.readFileSync(path.join(ROOT, 'public/js/voxel/kit.js'), 'utf8');
  // 5a: die Rückfalltabelle RUECKFALL_KIND ist weg, baum/brustwehr/grabensohle haben eigene Kit-Teile (Zuordnung: tools/test-vox01-kit.js)
  ok(!kit.includes('RUECKFALL_KIND'), 'kit.js: keine Rückfall-Ersetzung der Kachelart mehr (baum, brustwehr, grabensohle bleiben eigene Arten)');
  ok(/Y: \['baum'\], H: \['brustwehr'\], ';': \['grabensohle'\]/.test(kit), 'kit.js KACHELN_FB kennt Y, H, ;');
  const rd = fs.readFileSync(path.join(ROOT, 'public/js/render.js'), 'utf8');
  const fb = (ch) => { const q = new RegExp("'" + ch.replace(/[;]/g, '\\$&') + "': \\[([^\\]]*)\\]").exec(rd.slice(rd.indexOf('const KACHELN_FB'))); return q ? q[1].split(',').map((s) => s.trim()) : null; };
  const wie = { Y: 'F', H: 'o', ';': ',' };
  for (const ch of ['Y', 'H', ';']) {
    const a = fb(ch), b = fb(wie[ch]);
    ok(!!a && !!b && a.slice(1).join() === b.slice(1).join() && a[0] === "'" + KIND[ch] + "'", `render.js KACHELN_FB "${ch}" wie "${wie[ch]}" (${a && a.join(' ')})`);
  }
  const farbe = (k) => new RegExp('\\b' + k + ": '(#[0-9A-Fa-f]{6})'").exec(rd.slice(rd.indexOf('const BUEHNE_FARBE')));
  ok(farbe('baum')[1] === farbe('fels')[1] && farbe('brustwehr')[1] === farbe('deckung_halb')[1] && farbe('grabensohle')[1] === farbe('boden2')[1], 'render.js BUEHNE_FARBE: dieselben Farben wie fels, deckung_halb, boden2');
}

// ---------------------------------------------------------------------------------------------- Testraster (Probe graben-probe.js)
const W_ = 100, H_ = 36;
function roh(abwandlung) {
  const g = []; for (let y = 0; y < H_; y++) g.push(new Array(W_).fill(':'));
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W_ && y < H_) g[y][x] = c; };
  for (let x = 0; x < W_; x++) { set(x, 0, 'F'); set(x, H_ - 1, 'F'); } for (let y = 0; y < H_; y++) { set(0, y, 'F'); set(W_ - 1, y, 'F'); }
  // Graben x30..33, Brustwehr o auf x30 (Wiesenseite) und x33, Sohle , x31..32, y8..27; Übergänge in der Wiesenbrustwehr bei y=14 und y=21
  for (let y = 8; y <= 27; y++) { set(30, y, (y === 14 || y === 21) ? ',' : 'o'); set(31, y, ','); set(32, y, ','); set(33, y, (y === 11 || y === 24) ? ',' : 'o'); }
  // Wald x42..72: Baumgruppen als F, dazwischen Gassen (deterministischer Zufall)
  let s = 12345; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 70; i++) { const x = 42 + Math.floor(rnd() * 30), y = 2 + Math.floor(rnd() * 32), w = 1 + Math.floor(rnd() * 3), h = 1 + Math.floor(rnd() * 3); for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set(x + dx, y + dy, 'F'); }
  // Lager x78..94, y11..24: Wand, Tor links, Innen ,, Kisten O/o
  for (let x = 78; x <= 94; x++) for (let y = 11; y <= 24; y++) { const rand = x === 78 || x === 94 || y === 11 || y === 24; set(x, y, rand ? '#' : ','); }
  set(78, 17, ','); set(78, 18, ','); set(86, 15, 'O'); set(89, 20, 'O'); set(84, 21, 'o'); set(91, 14, 'o'); set(91, 21, 'o');
  for (let y = 15; y <= 20; y++) for (let x = 41; x <= 77; x++) if (g[y][x] === 'F') set(x, y, ':');   // Hauptgasse durch den Wald
  if (abwandlung) abwandlung(set, g);
  const rows = g.map((r) => r.join(''));
  const A = (id, rolle, x, y, extra) => Object.assign({ id, rolle, x, y }, extra || {});
  const anker = [A('wiese.abholpunkt', 'abholpunkt', 4, 18, { ankunft: true }), A('lager.eingang.1', 'eingang', 77, 17, { art: 'laut' }), A('lager.eingang.2', 'eingang', 77, 18, { art: 'laut' }),
    ...[[31, 9], [32, 12], [31, 16], [32, 19], [31, 23], [32, 26]].map((p, i) => A('graben.wache.' + (i + 1), 'wache', p[0], p[1])),
    ...[[82, 14], [82, 21], [88, 17], [90, 22]].map((p, i) => A('lager.wache.' + (i + 1), 'wache', p[0], p[1])),
    A('lager.beute', 'beute', 92, 17)];
  return { id: 'test.vox01', erzeuger: 'hand-raster/1', art: 'aussenposten', bauweise: 'germanen', besitz: 'raubzug', zustand: 'intakt', seed: 1, bauversion: 'probe1', schablone: 'probe',
    spiegel: null, w: W_, h: H_, rows, legende: null, anker, bereiche: { gefecht: { name: 'Gefecht', rects: [[28, 6, 8, 24]], rolle: null, gefecht: true }, lager: { name: 'Lager', rects: [[78, 11, 17, 14]], rolle: null, gefecht: false } },
    plaetze: {}, eingaenge: ['lager.eingang.1', 'lager.eingang.2'], abholpunkte: ['wiese.abholpunkt'], ankunft: 'wiese.abholpunkt', patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
    meta: { versuche: 1, kennzahlen: null, linear: false, pflicht: {}, zellen: null, schiffDecks: null, torStart: 'offen', huelle: true, typ: 'militaer', titel: {} } };
}
// Ersatz: dasselbe Raster mit anderen Zeichen (map: Zeichen -> Zeichen)
function ersetzt(r, map) {
  const c = JSON.parse(JSON.stringify(r));
  c.rows = c.rows.map((row) => Array.from(row, (ch) => map[ch] || ch).join(''));
  return c;
}
const bauen = (r) => Buehne.ausRaster(JSON.parse(JSON.stringify(r)), { spiel: true });
const zurueck = (rows) => rows.map((row) => Array.from(row, (ch) => ({ Y: 'F', H: 'o', ';': ',' })[ch] || ch).join(''));

const ROH = roh();
const A = bauen(ROH), B = bauen(ersetzt(ROH, NEU));
const nz = (rows, ch) => rows.join('').split(ch).length - 1;
console.log('\n[Testraster: Prüfer, Karte, coverSpots, Kanten, Erreichbarkeit]');
ok(nz(ROH.rows, 'F') > 300 && nz(ROH.rows, 'o') > 30 && nz(ROH.rows, ',') > 200, `Raster enthält F/o/, reichlich (${nz(ROH.rows, 'F')} / ${nz(ROH.rows, 'o')} / ${nz(ROH.rows, ',')})`);
ok(nz(B.karte.rows, 'F') === 0 && nz(B.karte.rows, 'o') === 0 && nz(B.karte.rows, ',') === 0 && nz(B.karte.rows, 'Y') === nz(A.karte.rows, 'F') && nz(B.karte.rows, 'H') === nz(A.karte.rows, 'o') && nz(B.karte.rows, ';') === nz(A.karte.rows, ','), 'Ersatzraster enthält nur noch Y/H/; statt F/o/,');
ok(A.pruefung.ok === B.pruefung.ok && JSON.stringify(A.fehler) === JSON.stringify(B.fehler), `Prüfer: ok ${A.pruefung.ok} = ${B.pruefung.ok}, Fehler gleich (${A.fehler.length})`);
ok(JSON.stringify(A.karte.coverSpots) === JSON.stringify(B.karte.coverSpots) && A.karte.coverSpots.length > 20, `coverSpots gleich (${A.karte.coverSpots.length})`);
ok(JSON.stringify(A.karte.kanten) === JSON.stringify(B.karte.kanten) && JSON.stringify(A.karte.patrouillen) === JSON.stringify(B.karte.patrouillen), 'Kanten und Patrouillen gleich');
{
  // Befund 1: ohne `spiel` laufen Kennzahlen/Prüferwarnungen über andere Namenslisten; original und ersetzt müssen gleich sein
  const ohne = (r) => Buehne.ausRaster(JSON.parse(JSON.stringify(r)), {});
  const oa = ohne(ROH), ob = ohne(ersetzt(ROH, NEU));
  const codes = (r) => JSON.stringify(((r.pruefung && r.pruefung.warnungen) || r.warnungen || []).map((w) => w.code).sort());
  ok(!!oa.karte.meta.kennzahlen && JSON.stringify(oa.karte.meta.kennzahlen) === JSON.stringify(ob.karte.meta.kennzahlen), 'ohne spiel: meta.kennzahlen gleich (' + JSON.stringify(ob.karte.meta.kennzahlen && ob.karte.meta.kennzahlen.deckung) + ')');
  ok(codes(oa) === codes(ob) && JSON.stringify(oa.fehler.map((f) => f.code)) === JSON.stringify(ob.fehler.map((f) => f.code)), 'ohne spiel: Warnungs- und Fehlercodes gleich ' + codes(ob));
}
const ohneRL = (k) => { const c = Object.assign({}, k); delete c.rows; delete c.legende; return JSON.stringify(c); };
ok(ohneRL(A.karte) === ohneRL(B.karte), 'ganze Karte bis auf rows und legende byte-gleich');
ok(JSON.stringify(zurueck(B.karte.rows)) === JSON.stringify(A.karte.rows), 'rows: Rückersetzung Y/H/; -> F/o/, ergibt das Original');
ok(Object.keys(A.karte.legende).every((c) => JSON.stringify(A.karte.legende[c]) === JSON.stringify(B.karte.legende[c])) && Object.keys(B.karte.legende).length === Object.keys(A.karte.legende).length, 'Legende: alle vorhandenen Einträge unverändert (Y, H, ; stehen in beiden Karten; Zahl der Einträge gleich)');
// Legendenwerte je Kachel der Karte gleich (nur kind/hinweis dürfen abweichen)
{
  let bad = 0;
  for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) {
    const a = A.karte.legende[A.karte.rows[y][x]], b = B.karte.legende[B.karte.rows[y][x]];
    if (!REGELFELDER.every((f) => JSON.stringify(a[f]) === JSON.stringify(b[f]))) bad++;
  }
  ok(bad === 0, 'je Kachel dieselben Regelfelder (solid, cover, low, sperrtSicht, kante) in beiden Karten');
}
// Erreichbarkeit (4er-Nachbarschaft über Kachel-Festigkeit) vom Abholpunkt und Prüfer-Gegenprobe mit Anker auf fester Kachel
const erreicht = (karte) => {
  const map = interior.kartenMap(karte); const seen = new Uint8Array(karte.w * karte.h); const q = [[4, 18]]; seen[18 * karte.w + 4] = 1; let c = 0;
  while (q.length) { const [x, y] = q.pop(); c++; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= karte.w || ny >= karte.h || seen[ny * karte.w + nx] || map.solid(nx, ny)) continue; seen[ny * karte.w + nx] = 1; q.push([nx, ny]); } }
  return { c, h: require('crypto').createHash('sha1').update(Buffer.from(seen)).digest('hex') };
};
{
  const ea = erreicht(A.karte), eb = erreicht(B.karte);
  ok(ea.h === eb.h && ea.c > 2000, `Erreichbarkeit vom Abholpunkt: identische Fläche (${ea.c} Kacheln)`);
}
{
  // Prüfer-Fehlerpfad: Wache auf einer F-Kachel / Y-Kachel -> derselbe Fehler; Leitstück (leit) auf F/Y -> dieselbe Behandlung wie fels (K-ANKER-WAND)
  const fehlerRoh = (r, ch) => { const c = JSON.parse(JSON.stringify(r)); const row = c.rows[10]; c.rows[10] = row.slice(0, 20) + ch + row.slice(21); c.anker = c.anker.concat([{ id: 'x.wache.9', rolle: 'wache', x: 20, y: 10 }, { id: 'x.leit.9', rolle: 'leit', x: 20, y: 10 }]); return Buehne.ausRaster(c, { spiel: true }); };
  const kurz = (r) => JSON.stringify(r.fehler.map((f) => [f.code, f.x, f.y, f.id]));   // Meldungstexte nennen das Zeichen, Code und Ort zählen
  const fa = fehlerRoh(ROH, 'F'), fb = fehlerRoh(ersetzt(ROH, NEU), 'Y');
  ok(!fa.pruefung.ok && !fb.pruefung.ok && kurz(fa) === kurz(fb) && fb.fehler.length === 2, `Prüfer-Fehlerfall (Wache und Leitstück auf Fels/Baum): gleiche Fehler (${fa.fehler.map((f) => f.code).join(' ')})`);
  const fo = fehlerRoh(ROH, 'o'), fh = fehlerRoh(ersetzt(ROH, NEU), 'H');
  ok(kurz(fo) === kurz(fh), `Prüfer: Anker auf o/H: gleiche Fehler (${fo.fehler.map((f) => f.code).join(' ') || 'keine'})`);
}

// ---------------------------------------------------------------------------------------------- Spiel (Kampf, Sicht, Bewegung)
const LP = 'test.vox01';
function spiel(roh_) {
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'V0', name: 'V0', color: 0 });
  g.handleMessage(c, { t: 'ready', ready: true });
  W.AWAY_MAPS[LP] = { id: LP, karte: bauen(roh_).karte };
  g.aways[LP] = away.makeLandepunkt(g, LP);
  g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  g.god = true;
  const P = g.players[0];
  const place = (tx, ty) => { const q = Physics.tileCenter(tx, ty); P.x = q.x; P.y = q.y; P.dir = 'right'; P.input.mx = 0; P.input.my = 0; };
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.step(); if (each) each(); } };
  return { g, P, place, run, aw: () => g.aways[LP] };
}

console.log('\n[Sicht und Deckung: dichte Stichprobe]');
function sichtprobe(roh_) {
  const { g } = spiel(roh_);
  const E = combat.env(g);
  const T = Physics.tileCenter;
  const h = require('crypto').createHash('sha1');
  let nSicht = 0, nBlockiert = 0, nCover1 = 0, nCover2 = 0, nCrouch2 = 0;
  const tiles = [];
  for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) if (!E.solid(x, y)) tiles.push([x, y]);
  let s = 777; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const paar = (a, b) => {
    const pa = T(a[0], a[1]), pb = T(b[0], b[1]);
    const los = Los.lineOfSight(E.blocked, pa.x, pa.y, pb.x, pb.y), sb = !Los.walk(pa.x, pa.y, pb.x, pb.y, (tx, ty) => E.shotBlocked(tx, ty) && !(tx === b[0] && ty === b[1]));
    const c0 = Los.coverAgainst(E.map, E.solid, pa.x, pa.y, pb.x, pb.y, false), c1 = Los.coverAgainst(E.map, E.solid, pa.x, pa.y, pb.x, pb.y, true);
    h.update([los ? 1 : 0, sb ? 1 : 0, c0, c1].join(''));
    nSicht++; if (!los) nBlockiert++; if (c0 === 1) nCover1++; if (c0 === 2) nCover2++; if (c1 === 2 && c0 !== 2) nCrouch2++;
  };
  for (let i = 0; i < 30000; i++) paar(tiles[Math.floor(rnd() * tiles.length)], tiles[Math.floor(rnd() * tiles.length)]);
  // Fenster um Graben und Waldrand: alle Paare
  const fenster = tiles.filter(([x, y]) => (x >= 27 && x <= 36 && y >= 5 && y <= 30) || (x >= 40 && x <= 46 && y >= 2 && y <= 12));
  for (const a of fenster) for (const b of fenster) paar(a, b);
  // Sichtfeld (Nebel) von mehreren Punkten
  for (const [x, y] of [[31, 10], [26, 18], [44, 10], [60, 22], [85, 18]]) { const p = T(x, y); h.update([...Los.visibleTiles(E.blocked, p.x, p.y, 12, W_, H_)].sort().join('|')); }
  // Festigkeit, Sichtsperre und Schussstopp jeder Kachel
  for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) h.update([E.solid(x, y) ? 1 : 0, E.blocked(x, y) ? 1 : 0, E.shotBlocked(x, y) ? 1 : 0].join(''));
  return { hash: h.digest('hex'), nSicht, nBlockiert, nCover1, nCover2, nCrouch2 };
}
const sa = sichtprobe(ROH), sb = sichtprobe(ersetzt(ROH, NEU));
ok(sa.hash === sb.hash, `Sichtsperre, coverAgainst (auch geduckt), Schussstopp, Sichtfeld: identisch über ${sa.nSicht} Paare`);
ok(sa.nBlockiert > 3000 && sa.nCover1 > 200 && sa.nCover2 > 200 && sa.nCrouch2 > 100, `Stichprobe ist aussagekräftig (Sicht blockiert ${sa.nBlockiert}, halbe Deckung ${sa.nCover1}, volle ${sa.nCover2}, geduckt volle durch low ${sa.nCrouch2})`);
{
  // Gegenprobe: H statt o wäre falsch, wenn die Brustwehr wie eine volle Deckung (O) wirkte -> der Vergleich muss das merken
  const sc = sichtprobe(ersetzt(ROH, { o: 'O' }));
  ok(sc.hash !== sa.hash, 'Gegenprobe: o -> O (volle Deckung) ändert den Sicht-/Deckungshash (der Vergleich hat Schärfe)');
}

console.log('\n[Begehbarkeit: niemand kommt in Y- oder H-Kachel, ;-Kachel begehbar]');
function lauf(roh_, ziel) {
  const { g, P, place, run } = spiel(roh_);
  const spur = [];
  for (const [sx, sy, dx, dy, sek] of ziel) {
    place(sx, sy); P.input.mx = dx; P.input.my = dy;
    run(sek, () => { const t = Physics.toTile(P.x, P.y); spur.push(t.x + ',' + t.y + ':' + Math.round(P.x) + ':' + Math.round(P.y)); });
    P.input.mx = 0; P.input.my = 0;
  }
  return { spur, g };
}
{
  // Gehe von der Wiese in die Brustwehr (x30,y10), vom Wald-Rand in einen Baum, entlang der Sohle (;) und aus der Sohle in die Brustwehr
  const baumXY = (() => { for (let y = 3; y < 14; y++) for (let x = 43; x < 72; x++) if (ROH.rows[y][x] === 'F' && ROH.rows[y][x - 1] === ':') return [x, y]; return null; })();
  ok(!!baumXY, 'Testbaum am Waldrand gefunden ' + JSON.stringify(baumXY));
  const ziele = [[28, 10, 1, 0, 3], [baumXY[0] - 2, baumXY[1], 1, 0, 3], [31, 9, 0, 1, 3], [31, 12, 1, 0, 3], [32, 12, -1, 0, 2]];
  const la = lauf(ROH, ziele), lb = lauf(ersetzt(ROH, NEU), ziele);
  ok(JSON.stringify(la.spur) === JSON.stringify(lb.spur), `Bewegung Schritt für Schritt identisch (${la.spur.length} Ticks)`);
  const inYH = lb.spur.some((s) => { const [tx, ty] = s.split(':')[0].split(',').map(Number); return ['Y', 'H'].includes(B.karte.rows[ty][tx]); });
  ok(!inYH, 'nie eine Y- oder H-Kachel betreten');
  const solidB = (tx, ty) => interior.kartenMap(B.karte).solid(tx, ty);
  ok(solidB(30, 10) && solidB(baumXY[0], baumXY[1]) && !solidB(31, 10) && B.karte.rows[10][31] === ';', 'Y und H sind solid, ; ist nicht solid');
  const t = lb.spur[lb.spur.length - 1]; const q = lb.spur.filter((s) => s.startsWith('31,12') || s.startsWith('32,12')).length;
  ok(q > 10 && t, 'Lauf über die Sohle (;) möglich (' + q + ' Ticks auf Sohle)');
}

console.log('\n[Schuss: halbe Deckung blockt wie o (60 %), geduckt 100 %, gleicher Zufallsstrom]');
function schuss(roh_, geduckt) {
  const { g, P, place, run, aw } = spiel(roh_);
  AC.enemy.scavenger.spreadDeg = 0;
  place(31, 10);   // Ziel in der Sohle, Brustwehr (30,10) westlich auf der Linie
  const q = Physics.tileCenter(26, 10);
  const shooter = squad.makeEnemy(g, aw(), 'scavenger', 'T' + g.nextId(''), q, 'test');
  shooter.asleep = false; shooter.frozen = true; aw().drones.push(shooter);
  const shots = 300, folge = [];
  const s0 = Object.assign({}, aw().stats);
  for (let i = 0; i < shots; i++) {
    P.crouch = !!geduckt;
    const b0 = aw().stats.coverBlocks, h0 = aw().stats.playerHits;
    combat.fireEnemy(g, shooter, P); run(1.0);
    folge.push((aw().stats.coverBlocks - b0) + '/' + (aw().stats.playerHits - h0));
  }
  return { folge, blocks: aw().stats.coverBlocks - s0.coverBlocks, hits: aw().stats.playerHits - s0.playerHits, shots, errors: g.errors };
}
{
  const a = schuss(ROH, false), b = schuss(ersetzt(ROH, NEU), false);
  const frac = b.blocks / b.shots;
  ok(JSON.stringify(a.folge) === JSON.stringify(b.folge), `Schuss je Schuss identisch (Original ${a.blocks} geblockt / ${a.hits} Treffer, mit H ${b.blocks} / ${b.hits})`);
  ok(b.blocks + b.hits === b.shots && Math.abs(frac - AC.halfCoverBlock) < 0.08, `Brustwehr H von vorn schluckt ${(frac * 100).toFixed(1)} % (Soll ${AC.halfCoverBlock * 100} %)`);
  const c = schuss(ROH, true), d = schuss(ersetzt(ROH, NEU), true);
  ok(JSON.stringify(c.folge) === JSON.stringify(d.folge) && d.blocks === d.shots && d.hits === 0, `geduckt hinter H: alle ${d.blocks}/${d.shots} geblockt (100 %), identisch zu o`);
  ok(a.errors === 0 && b.errors === 0 && c.errors === 0 && d.errors === 0, 'keine Server-Fehler');
}
delete W.AWAY_MAPS[LP];

console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
