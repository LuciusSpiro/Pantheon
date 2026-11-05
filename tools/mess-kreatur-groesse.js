#!/usr/bin/env node
'use strict';
// MON-02 G: Erreichbarkeit der Kreaturen-Fußabdrücke (Größe 1 und 2) auf echten Wildnis-Karten (Messskript, kein Test).
// Bau wie landepunkte.wildnisBauen (Erzeuger -> Buehne.ausRaster({spiel:true}), bei Prüferfehler Seed+1, bis 6 Versuche). Je Biom × Größe der Karte × SEEDS Seeds (101 + i·7919, wie die Erkundung MON-02).
//   node tools/mess-kreatur-groesse.js [SEEDS=50] [--json]       (SEEDS auch als Umgebungsvariable)
// Je Fußabdruck (Mon.maske(karte, fuss)): Start = nächster Ankerpunkt zum Abholpunkt (Radius 4, wie Mon.pruefen), BFS über Ankerpunkte.
//   flaeche     erreichbare Fläche des Tieres / Fläche, die ein Spieler vom Abholpunkt erreicht (Kacheln im Fußabdruck eines erreichbaren Ankerpunkts)
//   ankerAnteil erreichbare Ankerpunkte / Ankerpunkte der Maske
//   lager       alle Lager-Bereiche (gefecht:true) haben mindestens einen erreichbaren Ankerpunkt im Rechteck (+1 Kachel)
//   funde       alle Fundorte (Rolle fund) liegen höchstens 1 Kachel von einem erreichbaren Ankerpunkt (naechster, Radius 1)
//   ring        im Ring 6..10 Kacheln um den Abholpunkt ist Platz für 3 Tiere (Chebyshev-Abstand >= 3)
//   alles       lager && funde && ring;  eingesperrt = flaeche < 0,25;  keinLager = kein einziges Lager erreichbar
const Gelaende = require('../shared/gen-gelaende.js');
const Buehne = require('../shared/buehne.js');
const Mon = require('../shared/monster.js');

const SEEDS = Math.max(1, +(process.argv.find((a) => /^\d+$/.test(a)) || process.env.SEEDS) || 50);
const seedVon = (i) => 101 + i * 7919;
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (n, d) => (d ? Math.round(n / d * 100) : null);

function bauen(seed, biom, groesse) {
  const o = { biom, groesse, bauweise: 'germanen', besitz: null, zustand: 'intakt', id: 'kesh.wildnis-1' };
  for (let i = 0; i < 6; i++) {
    const roh = Gelaende.erzeuger().karteRoh(seed + i, o);
    const r = Buehne.ausRaster(roh, { spiel: true });
    if (r.pruefung.ok) return r.karte;
  }
  return null;
}
function spielerBfs(m, ax, ay) {
  const w = m.w, h = m.h; const d = new Int32Array(w * h).fill(-1); const q = [ax, ay]; d[ay * w + ax] = 0;
  for (let i = 0; i < q.length; i += 2) {
    const x = q[i], y = q[i + 1];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!m.frei[ny * w + nx] || d[ny * w + nx] >= 0) continue;
      d[ny * w + nx] = d[y * w + x] + 1; q.push(nx, ny);
    }
  }
  return d;
}
const platz = (pool, n, abst) => {
  for (let versuch = 0; versuch < Math.min(20, pool.length || 1); versuch++) {
    const gew = []; const reihe = pool.slice(versuch).concat(pool.slice(0, versuch));
    for (const p of reihe) { if (gew.every((q) => Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) >= abst)) { gew.push(p); if (gew.length === n) return true; } }
  }
  return false;
};

function messen(karte, fuss) {
  const m = Mon.maske(karte, fuss); const w = karte.w, h = karte.h;
  const A = karte.anker.find((a) => a.ankunft) || karte.anker.find((a) => a.rolle === 'abholpunkt');
  const sp = spielerBfs(m, A.x, A.y);
  let spielerFlaeche = 0; for (let i = 0; i < w * h; i++) if (sp[i] >= 0) spielerFlaeche++;
  let maskeAnker = 0; for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if (m.geht(cx, cy)) maskeAnker++;
  const start = Mon.naechster(m, A.x, A.y, 4);
  const R = { start: !!start, lager: false, funde: false, ring: false, flaeche: 0, ankerAnteil: 0, keinLager: true, nLager: 0 };
  if (!start) return R;
  const d = Mon.bfs(m, [start]);
  let erreichbar = 0; for (let i = 0; i < w * h; i++) if (d[i] >= 0) erreichbar++;
  const deckt = new Uint8Array(w * h);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if (d[cy * w + cx] >= 0) for (const t of Mon.fussKacheln({ cx, cy }, fuss)) deckt[t.y * w + t.x] = 1;
  let abgedeckt = 0; for (let i = 0; i < w * h; i++) if (sp[i] >= 0 && deckt[i]) abgedeckt++;
  R.flaeche = abgedeckt / spielerFlaeche; R.ankerAnteil = erreichbar / maskeAnker;
  const lager = Object.values(karte.bereiche).filter((b) => b.gefecht);
  R.nLager = lager.length;
  const lagerOk = lager.map((b) => { const [x0, y0, bw, bh] = b.rects[0]; for (let cy = y0; cy < y0 + bh + 1; cy++) for (let cx = x0; cx < x0 + bw + 1; cx++) if (m.geht(cx, cy) && d[cy * w + cx] >= 0) return true; return false; });
  R.lager = lagerOk.every(Boolean); R.keinLager = !lagerOk.some(Boolean);
  const funde = karte.anker.filter((a) => a.rolle === 'fund');
  R.funde = funde.every((a) => { const n = Mon.naechster(m, a.x, a.y, 1); return !!n && d[n.cy * w + n.cx] >= 0; });
  const ring = [];
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) if (d[cy * w + cx] >= 0) { const dd = Math.hypot(cx - A.x, cy - A.y); if (dd >= 6 && dd <= 10) ring.push([cx, cy]); }
  R.ring = platz(ring, 3, 3);
  return R;
}

const FUESSE = [1, 2];
const zeilen = [];
for (const biom of Gelaende.BIOME) for (const gr of Object.keys(Gelaende.GROESSEN)) {
  const karten = [];
  for (let i = 0; i < SEEDS; i++) { const k = bauen(seedVon(i), biom, gr); if (k) karten.push(k); }
  for (const fuss of FUESSE) {
    const L = karten.map((k) => messen(k, fuss));
    zeilen.push({ biom, groesse: gr, fuss, karten: L.length,
      flaecheMed: Math.round(median(L.map((r) => r.flaeche)) * 100) / 100, flaecheMin: Math.round(Math.min(...L.map((r) => r.flaeche)) * 100) / 100,
      ankerAnteilMed: Math.round(median(L.map((r) => r.ankerAnteil)) * 100) / 100,
      eingesperrt: pct(L.filter((r) => r.flaeche < 0.25).length, L.length), alleLager: pct(L.filter((r) => r.lager).length, L.length), keinLager: pct(L.filter((r) => r.keinLager).length, L.length),
      alleFunde: pct(L.filter((r) => r.funde).length, L.length), ring3: pct(L.filter((r) => r.ring).length, L.length), alles: pct(L.filter((r) => r.lager && r.funde && r.ring).length, L.length), startFehlt: L.filter((r) => !r.start).length });
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(zeilen));
else {
  console.log('Fuß | Biom/Größe | Karten | Fläche med/min | Anker-Anteil med | eingesperrt % | alle Lager % | kein Lager % | alle Funde % | Ring 3 % | alles %');
  for (const z of zeilen) console.log([z.fuss, z.biom + ' ' + z.groesse, z.karten, z.flaecheMed + '/' + z.flaecheMin, z.ankerAnteilMed, z.eingesperrt, z.alleLager, z.keinLager, z.alleFunde, z.ring3, z.alles].join(' | '));
}
