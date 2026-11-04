#!/usr/bin/env node
'use strict';
// CAR-01 Paket A: römische Außenposten mit Cardo-Layout (shared/gen-siedlung.js, layoutCardo). Geprüft über je 30 Seeds, Größen 8/10/12 Häuser,
// Typ handel und militaer: Prüfer und Pflichtsatz, Cardo und Decumanus als durchgehende Achsen durchs Forum in der Mitte, vier Tore (Militär: in
// der geschlossenen Mauer, Handel: freistehende Torbögen ohne Mauer), Symmetrie der Achsen, Determinismus, Campus (Abholpunkt ankunft) innerhalb des
// Grundrisses und von allen Toren erreichbar, awayMap-Größe, Mutationsprobe (kaputte Layouts müssen rot werden).
//   node tools/test-cardo.js
const Buehne = require('../shared/buehne.js');
const GenSiedlung = require('../shared/gen-siedlung.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');

let n = 0, fehler = 0;
const ok = (c, t) => { n++; if (!c) { fehler++; console.log('  FEHLER ' + t); } };
const abschnitt = (t) => console.log('[' + t + ']');
const SEEDS = 30, GROESSEN = [8, 10, 12], TYPEN = ['handel', 'militaer'];

const zaehl = (k) => { const z = {}; for (const a of k.anker) z[a.rolle] = (z[a.rolle] || 0) + 1; return z; };
const pflichtDerArt = (art) => { const l = Buehne.schablonen(art); let p = null; for (const s of l) { if (!p) p = Object.assign({}, s.pflicht); else for (const r of Object.keys(p)) p[r] = Math.min(p[r], s.pflicht[r] || 0); } return p; };
const fehlt = (k, soll) => { const z = zaehl(k); return Object.keys(soll).filter((r) => (z[r] || 0) < soll[r]).map((r) => r + ' ' + (z[r] || 0) + '/' + soll[r]); };
const roh = (seed, N, typ) => GenSiedlung.erzeuger(130, 90).karteRoh(seed, N, { bauweise: 'rom', typ, besitz: 'raubzug', zustand: 'umkaempft', id: 't' });
const bau = (seed, N, typ) => Buehne.ausRaster(roh(seed, N, typ), { spiel: true });
const setT = (rows, x, y, c) => rows.map((r, j) => (j === y ? r.slice(0, x) + c + r.slice(x + 1) : r));

// Grundriss aus den vier Tor-Plätzen: [x0, y0, x1, y1] (Kanten, Mauerlinie bei Militär)
function grundriss(k) {
  const t = (id) => k.plaetze[id] && k.plaetze[id].rect;
  const w = t('tor'), nn = t('tor_n'), o = t('tor_o'), s = t('tor_s');
  if (!w || !nn || !o || !s) return null;
  return { x0: w[0], x1: o[0], y0: nn[1], y1: s[1] };
}

// Strukturprüfung eines Cardo-Außenpostens: leere Liste = in Ordnung (wird von den Seeds und von der Mutationsprobe benutzt)
function strukturFehler(k, typ) {
  const f = [], G = grundriss(k);
  if (!G) return ['Tore fehlen (tor, tor_n, tor_o, tor_s)'];
  const tile = (x, y) => (k.rows[y] || '')[x];
  // vier Tore: je 4 Kacheln G auf der Kante
  const gKacheln = []; k.rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === 'G') gKacheln.push([x, y]); });
  if (gKacheln.length !== 16) f.push('Tor-Kacheln: ' + gKacheln.length + ' statt 16');
  for (const id of ['tor', 'tor_n', 'tor_o', 'tor_s']) {
    const [rx, ry, rw, rh] = k.plaetze[id].rect; let g = 0;
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) if (tile(x, y) === 'G') g++;
    if (g !== 4) f.push(id + ': ' + g + ' Tor-Kacheln im Platz (4 erwartet)');
    // Pfeiler (Turm) beidseits des Tores
    const hz = rw > rh, a = hz ? [rx - 1, ry] : [rx, ry - 1], b = hz ? [rx + rw, ry] : [rx, ry + rh];
    if (tile(a[0], a[1]) !== '#' || tile(b[0], b[1]) !== '#') f.push(id + ': Pfeiler neben dem Tor fehlen');
  }
  // Forum in der Mitte
  const fr = k.plaetze.platz.rect, fx = fr[0] + (fr[2] - 1) / 2, fy = fr[1] + (fr[3] - 1) / 2;
  const mx = (G.x0 + G.x1) / 2, my = (G.y0 + G.y1) / 2;
  if (Math.abs(fx - mx) > 1 || Math.abs(fy - my) > 1) f.push(`Forum (${fx},${fy}) nicht in der Mitte (${mx},${my})`);
  // Cardo und Decumanus: durchgehende Reihe/Spalte von Tor zu Tor, die durchs Forum läuft
  const r = Buehne.raster(k);
  let dec = false, car = false;
  for (let y = fr[1]; y < fr[1] + fr[3]; y++) { let all = true; for (let x = G.x0; x <= G.x1 && all; x++) if (!r.durchgang(x, y)) all = false; if (all) dec = true; }
  for (let x = fr[0]; x < fr[0] + fr[2]; x++) { let all = true; for (let y = G.y0; y <= G.y1 && all; y++) if (!r.durchgang(x, y)) all = false; if (all) car = true; }
  if (!dec) f.push('kein durchgehender Decumanus (Ost-West) durchs Forum');
  if (!car) f.push('kein durchgehender Cardo (Nord-Süd) durchs Forum');
  // Mauer: Militär geschlossen (Kante nur # und G), Handel keine (Torbögen frei stehend, dazwischen offener Boden)
  let rand = 0, offen = 0;
  const kante = (x, y) => { rand++; const c = tile(x, y); if (c !== '#' && c !== 'G') offen++; };
  for (let x = G.x0; x <= G.x1; x++) { kante(x, G.y0); kante(x, G.y1); }
  for (let y = G.y0 + 1; y < G.y1; y++) { kante(G.x0, y); kante(G.x1, y); }
  if (typ === 'militaer' && offen) f.push('Mauer nicht geschlossen (' + offen + ' offene Kantenkacheln)');
  if (typ === 'handel' && offen < rand / 2) f.push('Handel hat eine Mauer (' + (rand - offen) + ' von ' + rand + ' Kantenkacheln fest)');
  // Eingänge: einer laut am Westtor, drei leise an den anderen Toren
  const ein = k.anker.filter((a) => a.rolle === 'eingang');
  if (ein.length !== 4 || ein.filter((a) => a.art === 'laut').length !== 1 || ein.filter((a) => a.art === 'leise').length !== 3) f.push('Eingänge: ' + ein.map((a) => a.art).join(','));
  const laut = ein.find((a) => a.art === 'laut');
  if (laut && (laut.x !== G.x0 || tile(laut.x, laut.y) !== 'G')) f.push('lauter Eingang nicht am Westtor');
  // Campus innerhalb des Grundrisses, von allen Toren erreichbar
  const ank = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
  if (!ank || ank.x <= G.x0 || ank.x >= G.x1 || ank.y <= G.y0 || ank.y >= G.y1) f.push('Abholpunkt ankunft liegt nicht im Grundriss');
  else {
    for (const e of ein) {
      const seen = new Set([e.y * k.w + e.x]), q = [[e.x, e.y]];
      while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, key = ny * k.w + nx; if (nx < 0 || ny < 0 || nx >= k.w || ny >= k.h || seen.has(key) || !r.durchgang(nx, ny)) continue; seen.add(key); q.push([nx, ny]); } }
      if (!seen.has(ank.y * k.w + ank.x)) f.push('Abholpunkt von ' + e.id + ' nicht erreichbar');
    }
  }
  // Symmetrie: Achsen von Cardo (strasse_2) und Decumanus (strasse_1) liegen in der Mitte des Grundrisses ± 1; Tore gespiegelt
  const dec1 = k.plaetze.strasse_1.rect, car1 = k.plaetze.strasse_2.rect;
  if (Math.abs(car1[0] + (car1[2] - 1) / 2 - mx) > 1) f.push('Cardo-Achse nicht in der Mitte');
  if (Math.abs(dec1[1] + (dec1[3] - 1) / 2 - my) > 1) f.push('Decumanus-Achse nicht in der Mitte');
  const gn = k.plaetze.tor_n.rect, gs = k.plaetze.tor_s.rect, gw = k.plaetze.tor.rect, go = k.plaetze.tor_o.rect;
  if (gn[0] !== gs[0] || gn[2] !== gs[2] || gw[1] !== go[1] || gw[3] !== go[3]) f.push('Tore nicht achsensymmetrisch');
  return f;
}

abschnitt('Prüfer, Pflichtsatz, Häuser und Struktur über 30 Seeds × Größen 8/10/12 × handel/militaer');
const soll = pflichtDerArt('aussenposten');
const mass = {}; let awayMax = 0, awayVon = '';
{
  const bad = [], strukt = []; let gesamt = 0;
  for (const typ of TYPEN) for (const N of GROESSEN) for (let seed = 1; seed <= SEEDS; seed++) {
    gesamt++;
    const k0 = roh(seed, N, typ), r = Buehne.ausRaster(k0, { spiel: true }), id = `${typ}/${N}/${seed}`;
    const m = mass[typ + N] = mass[typ + N] || { w: 0, h: 0, maxW: 0, maxH: 0, n: 0 };
    if (!r.pruefung.ok) { bad.push(`${id}: ${r.fehler.slice(0, 2).map((x) => x.code + ' ' + x.msg).join(',')}`); continue; }
    const k = r.karte, fl = fehlt(k, soll);
    if (fl.length) bad.push(`${id}: Pflicht ${fl.join(', ')}`);
    if (k.meta.haeuser < N) bad.push(`${id}: ${k.meta.haeuser} Häuser statt ${N}`);
    const sf = strukturFehler(k, typ); if (sf.length) strukt.push(`${id}: ${sf.join('; ')}`);
    // Grundrissgröße = Torabstand (ohne Rand)
    const G = grundriss(k); if (G) { const gw = G.x1 - G.x0 + 1, gh = G.y1 - G.y0 + 1; m.w += gw; m.h += gh; m.maxW = Math.max(m.maxW, gw); m.maxH = Math.max(m.maxH, gh); m.n++; }
    const bytes = Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
    if (bytes > awayMax) { awayMax = bytes; awayVon = id; }
  }
  ok(bad.length === 0, `Prüfer ok, Pflichtsatz erfüllt, mindestens N Häuser (${gesamt - bad.length}/${gesamt})${bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''}`);
  ok(strukt.length === 0, `Struktur: Cardo/Decumanus durchs Forum in der Mitte, vier Tore, Mauer (Militär) bzw. keine (Handel), Eingänge, Campus erreichbar, Symmetrie (${gesamt - strukt.length}/${gesamt})${strukt.length ? ': ' + strukt.slice(0, 4).join(' | ') : ''}`);
  for (const typ of TYPEN) for (const N of GROESSEN) { const m = mass[typ + N]; console.log(`  Grundriss ${typ} N=${N}: Ø ${(m.w / m.n).toFixed(1)}×${(m.h / m.n).toFixed(1)}, max ${m.maxW}×${m.maxH} (Grenze ${130 - 8}×${90 - 8})`); }
  ok(Object.values(mass).every((m) => m.maxW <= 130 - 8 && m.maxH <= 90 - 8), 'Grundriss höchstens 122×82');
  console.log(`  awayMap max ${awayMax} B (${awayVon}), Grenze ${Protocol.AWAY_MAP_MAX_BYTES} B`);
  ok(awayMax <= Protocol.AWAY_MAP_MAX_BYTES, `awayMap ${awayMax} B ≤ ${Protocol.AWAY_MAP_MAX_BYTES} B`);
}

abschnitt('Determinismus');
{
  let gleich = true;
  for (const typ of TYPEN) for (const seed of [1, 7, 19]) if (JSON.stringify(roh(seed, 10, typ)) !== JSON.stringify(roh(seed, 10, typ))) gleich = false;
  ok(gleich, 'gleicher Seed, gleiche Karte');
  ok(JSON.stringify(roh(1, 10, 'handel')) !== JSON.stringify(roh(2, 10, 'handel')), 'verschiedene Seeds, verschiedene Karten');
  ok(JSON.stringify(roh(3, 10, 'handel').rows) !== JSON.stringify(roh(3, 10, 'militaer').rows), 'Handel und Militär unterscheiden sich');
}

abschnitt('Mutationsprobe: kaputte Layouts müssen rot werden');
{
  const ausgang = bau(5, 10, 'militaer'), hand = bau(5, 10, 'handel');
  ok(strukturFehler(ausgang.karte, 'militaer').length === 0 && strukturFehler(hand.karte, 'handel').length === 0, 'Ausgang ist grün (militaer und handel, Seed 5)');
  const mut = (basis, fn) => { const k = JSON.parse(JSON.stringify(basis.karte)); fn(k); return k; };
  // 1) Tor entfernt (Nordtor zugemauert)
  const m1 = mut(ausgang, (k) => { const [rx, ry, rw] = k.plaetze.tor_n.rect; for (let x = rx; x < rx + rw; x++) k.rows = setT(k.rows, x, ry, '#'); });
  ok(strukturFehler(m1, 'militaer').length > 0, 'Nordtor zugemauert: Struktur rot');
  const m1b = JSON.parse(JSON.stringify(roh(5, 10, 'militaer'))); { const [rx, ry, rw] = m1b.plaetze.tor_n.rect; for (let x = rx; x < rx + rw; x++) m1b.rows = setT(m1b.rows, x, ry, '#'); }
  ok(!Buehne.ausRaster(m1b, { spiel: true }).pruefung.ok, 'Nordtor zugemauert: auch der Prüfer wird rot');
  // 2) Mauer mit Loch
  const m2 = mut(ausgang, (k) => { const G = grundriss(k); k.rows = setT(k.rows, G.x0 + 10, G.y0, '.'); });
  ok(strukturFehler(m2, 'militaer').length > 0, 'Loch in der Mauer: Struktur rot');
  // 3) Handel mit Mauer
  const m3 = mut(hand, (k) => { const G = grundriss(k); for (let x = G.x0; x <= G.x1; x++) { k.rows = setT(k.rows, x, G.y0, k.rows[G.y0][x] === 'G' ? 'G' : '#'); k.rows = setT(k.rows, x, G.y1, k.rows[G.y1][x] === 'G' ? 'G' : '#'); } for (let y = G.y0; y <= G.y1; y++) { k.rows = setT(k.rows, G.x0, y, k.rows[y][G.x0] === 'G' ? 'G' : '#'); k.rows = setT(k.rows, G.x1, y, k.rows[y][G.x1] === 'G' ? 'G' : '#'); } });
  ok(strukturFehler(m3, 'handel').length > 0, 'Handel mit Mauer: Struktur rot');
  // 4) Forum aus der Mitte: Platz-Rechteck verschoben
  const m4 = mut(hand, (k) => { k.plaetze.platz.rect[0] += 6; });
  ok(strukturFehler(m4, 'handel').length > 0, 'Forum verschoben: Struktur rot');
  // 5) Decumanus gesperrt (Tore bleiben)
  const m5 = mut(hand, (k) => { const G = grundriss(k), y0 = k.plaetze.strasse_1.rect[1]; for (let y = y0; y < y0 + 6; y++) k.rows = setT(k.rows, G.x0 + 12, y, '#'); });
  ok(strukturFehler(m5, 'handel').length > 0, 'Decumanus durch eine Wand unterbrochen: Struktur rot');
  // 6) Abholpunkt außerhalb des Grundrisses
  const m6 = mut(hand, (k) => { const a = k.anker.find((q) => q.rolle === 'abholpunkt' && q.ankunft); a.x = grundriss(k).x0 - 2; });
  ok(strukturFehler(m6, 'handel').length > 0, 'Abholpunkt außerhalb des Grundrisses: Struktur rot');
}

console.log(`\ntest-cardo: ${n - fehler}/${n} Prüfungen bestanden.`);
process.exit(fehler ? 1 : 0);
