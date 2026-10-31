'use strict';
// VOX-01 Paket 5b: Auswahl der ausgeblendeten Baumkronen-Zellen (kit-regeln.js kronenAus, rein, ohne three.js).
// Spielkamera: FOV 30°, Neigung 57°, Blick von Süden (+z), Ziel etwas über den Füßen. Die Kamera sitzt südlich und über der Figur.
//   node tools/test-vox01-kronen.js
const path = require('path');
const { pathToFileURL } = require('url');
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

async function main() {
  const R = await import(pathToFileURL(path.join(__dirname, '..', 'public/js/voxel/kit-regeln.js')).href);
  // Kamera: Abstand 22 m vom Ziel, Neigung 57° über dem Boden, von Süden
  const kam = (x, z, y = 0.9) => { const d = 22, n = 57 * Math.PI / 180; return { x, y: y + d * Math.sin(n), z: z + d * Math.cos(n) }; };
  // Zelle A: Krone 3×3 Kacheln bei x 30..33, z 10..13, Höhe 2,2..5 (Box wie kronenObjs.box)
  const A = { key: '10,3', bx0: 29.5, bx1: 33.5, bz0: 9.5, bz1: 13.5, by0: 2.2, by1: 5 };
  const B = { key: '12,3', bx0: 35.5, bx1: 39.5, bz0: 9.5, bz1: 13.5, by0: 2.2, by1: 5 };   // Nachbarzelle, 2 m daneben
  const Z = [A, B];
  const mk = (ziele, cam, t, zust, opt) => R.kronenAus(zust || new Map(), cam, Z, ziele, t == null ? 0 : t, opt);

  console.log('\n[Figur unter der Krone]');
  let a = mk([{ x: 31.5, y: 0.9, z: 11.5 }], kam(31.5, 11.5));
  ok(a.has('10,3') && !a.has('12,3'), 'Figur unter A: A aus, B bleibt');

  console.log('\n[Figur frei]');
  a = mk([{ x: 31.5, y: 0.9, z: 20.5 }], kam(31.5, 20.5));
  ok(a.size === 0, 'Figur auf freiem Feld: nichts aus');
  a = mk([], kam(31.5, 20.5));
  ok(a.size === 0, 'keine Figur: nichts aus');

  console.log('\n[Figur vom Blickwinkel aus hinter der Krone]');
  // Figur nördlich der Krone (z 7), Kamera noch weiter südlich: die Sichtlinie läuft durch A
  a = mk([{ x: 31.5, y: 0.9, z: 7.5 }], kam(31.5, 7.5));
  ok(a.has('10,3'), 'Figur 3 m nördlich hinter A (Kamera südlich): A aus');
  // Figur südlich der Krone: Kamera noch südlicher, Sichtlinie kreuzt A nicht
  a = mk([{ x: 31.5, y: 0.9, z: 17.5 }], kam(31.5, 17.5));
  ok(a.size === 0, 'Figur südlich vor A: A bleibt');
  // Figur seitlich weit weg
  a = mk([{ x: 25.5, y: 0.9, z: 11.5 }], kam(25.5, 11.5));
  ok(a.size === 0, 'Figur 4 m westlich neben A: A bleibt');

  console.log('\n[Gegner zählt wie Spieler]');
  const kamSpieler = kam(31.5, 20.5);
  a = mk([{ x: 31.5, y: 0.9, z: 20.5 }, { x: 36.5, y: 0.9, z: 11.5 }], kamSpieler);
  ok(a.has('12,3') && !a.has('10,3'), 'Spieler frei, Gegner unter B: B aus');
  a = mk([{ x: 31.5, y: 0.9, z: 11.5 }, { x: 36.5, y: 0.9, z: 11.5 }], kamSpieler);
  ok(a.has('10,3') && a.has('12,3'), 'zwei Figuren unter zwei Zellen: beide aus');

  console.log('\n[Nachlauf gegen Flackern]');
  const zust = new Map();
  const unter = [{ x: 31.5, y: 0.9, z: 11.5 }], frei = [{ x: 31.5, y: 0.9, z: 20.5 }];
  mk(unter, kam(31.5, 11.5), 0, zust);
  ok(mk(frei, kam(31.5, 20.5), 100, zust).has('10,3'), '100 ms nach Verlassen: A bleibt aus');
  ok(mk(frei, kam(31.5, 20.5), 240, zust).has('10,3'), '240 ms nach Verlassen: A bleibt aus');
  ok(!mk(frei, kam(31.5, 20.5), 260, zust).has('10,3'), '260 ms nach Verlassen: A wieder da');
  mk(unter, kam(31.5, 11.5), 300, zust);
  ok(mk(frei, kam(31.5, 20.5), 400, zust).has('10,3'), 'Nachlauf beginnt nach erneutem Eintritt neu');
  ok(R.mitNachlauf({ tief: false, seit: 0 }, false, 10) === false, 'mitNachlauf: nie betreten bleibt aus');

  console.log('\n[segmentBox: Vorfilter und Slab-Test ohne Zwischenfelder = Referenz (Slab-Test mit Feldern)]');
  {
    // Referenz: der ursprüngliche Slab-Test (vier Felder je Aufruf)
    const ref = (x0, y0, z0, x1, y1, z1, bx0, by0, bz0, bx1, by1, bz1) => {
      let tmin = 0, tmax = 1; const d = [x1 - x0, y1 - y0, z1 - z0], o = [x0, y0, z0], lo = [bx0, by0, bz0], hi = [bx1, by1, bz1];
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return false; continue; }
        let p = (lo[i] - o[i]) / d[i], q = (hi[i] - o[i]) / d[i]; if (p > q) { const t = p; p = q; q = t; }
        if (p > tmin) tmin = p; if (q < tmax) tmax = q; if (tmin > tmax) return false;
      }
      return true;
    };
    let seed = 99, abw = 0, treffer = 0; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 200000; i++) {
      const g = (m) => Math.round(rnd() * m * 4) / 4;   // Raster, damit achsenparallele und Randfälle vorkommen
      const A = [g(8), g(8), g(8), g(8), g(8), g(8)], bx = g(6), by = g(6), bz = g(6), B = [bx, by, bz, bx + g(3), by + g(3), bz + g(3)];
      const r1 = ref(...A, ...B), r2 = R.segmentBox(...A, ...B);
      if (r1 !== r2) abw++; if (r1) treffer++;
    }
    ok(abw === 0 && treffer > 5000 && treffer < 195000, `200000 Zufallsstrecken (inkl. Rand- und achsenparallele Fälle): ${abw} Abweichungen, ${treffer} Treffer`);
    // Wiederverwendete Ergebnismenge und Zielzahl (Kit reicht beides je Frame durch)
    const aus = new Set(), opt = { aus, n: 1 };
    const r1 = R.kronenAus(new Map(), kam(31.5, 11.5), Z, [{ x: 31.5, y: 0.9, z: 11.5 }, { x: 36.5, y: 0.9, z: 11.5 }], 0, opt);
    ok(r1 === aus && aus.has('10,3') && !aus.has('12,3'), 'opt.aus: dieselbe Menge wird wiederverwendet, opt.n: nur das erste Ziel zählt');
    const r2 = R.kronenAus(new Map(), kam(31.5, 20.5), Z, [{ x: 31.5, y: 0.9, z: 20.5 }], 0, opt);
    ok(r2 === aus && aus.size === 0, 'opt.aus wird je Aufruf geleert');
  }

  console.log(fails ? `\n${fails} FEHLER` : '\nalle ok');
  process.exit(fails ? 1 : 0);
}
main();
