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

  console.log(fails ? `\n${fails} FEHLER` : '\nalle ok');
  process.exit(fails ? 1 : 0);
}
main();
