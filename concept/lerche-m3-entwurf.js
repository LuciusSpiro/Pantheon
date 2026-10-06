// Entwurf 3: Lerche M3 mit Maschinenraum MITTIG (Kai, 2026-10-06). 44 x 13. Bug rechts (+x), Bb oben (-y), Stb unten (+y).
const W = 44, H = 13;
const g = Array.from({ length: H }, () => Array(W).fill(' '));
const rect = (x0, y0, x1, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = ch; };
const put = (list, ch) => list.forEach(([x, y]) => { g[y][x] = ch; });

rect(0, 0, 33, 12, '#');
rect(34, 1, 39, 11, '#'); rect(40, 2, 41, 10, '#'); rect(42, 4, 43, 8, '#');

// Antriebsraum (Heck) x1-3
rect(1, 1, 3, 11, '=');
put([[1, 6]], 'E');            // Triebwerk
put([[1, 2]], 'A');            // Heck-Emitter
put([[3, 11]], 'f');
put([[4, 6]], 'D');

// Mittelband y5-7 von x5 bis x32
rect(5, 5, 32, 7, '.');
rect(5, 5, 9, 7, ',');                                   // kleine Messe
put([[7, 5], [8, 5], [7, 6], [8, 6]], 'Y');              // Planungstisch 2x2
put([[9, 5]], 'S'); put([[5, 7]], 'O');                  // Terminal, Lebenserhaltung

// oben y1-3
rect(5, 1, 9, 3, '.'); put([[5, 1], [6, 1], [7, 1], [8, 1], [9, 1]], 'L'); // Lager
rect(11, 1, 13, 3, ','); put([[11, 1]], 'B');            // Quartier 0
rect(15, 1, 17, 3, ','); put([[15, 1]], 'B');            // Quartier 1
rect(25, 1, 32, 3, '=');                                 // Bb-Batteriedeck
put([[26, 1]], 'F'); put([[29, 1]], 'M'); put([[32, 1]], 'U');
put([[6, 4], [12, 4], [16, 4], [27, 4], [30, 4]], 'D');
// unten y9-11
rect(5, 9, 9, 11, '.'); put([[6, 10], [8, 10], [7, 11]], 'P'); put([[9, 11]], 'T'); put([[5, 11]], 'X'); // Transfer
rect(11, 9, 13, 11, ','); put([[11, 11]], 'B');          // Quartier 2
rect(15, 9, 17, 11, ','); put([[15, 11]], 'B');          // Quartier 3 (Gast)
rect(25, 9, 32, 11, '=');                                // Stb-Batteriedeck
put([[26, 11]], 'Z'); put([[29, 11]], 'J'); put([[32, 11]], 'V');
put([[8, 8], [12, 8], [16, 8], [27, 8], [30, 8]], 'D');

// Maschinenraum MITTIG x19-23, volle Höhe
rect(19, 1, 23, 11, '=');
put([[21, 3]], 'R'); put([[21, 9]], 'G');               // Reaktor, Schildgenerator
put([[19, 1]], 'y'); put([[23, 11]], 'y');              // Neustartschalter A/B (gegenüberliegende Ecken)
put([[23, 1], [19, 11]], 'u');                           // Rohre (Deko)
rect(18, 1, 18, 11, '#'); rect(24, 1, 24, 11, '#');
put([[18, 6], [24, 6]], 'D');

// Brücke x34-42
rect(34, 2, 39, 10, '.'); rect(40, 3, 41, 9, '.'); rect(42, 5, 42, 7, '.');
put([[33, 6]], 'D');
put([[35, 3]], 'W'); put([[37, 6]], 'C'); put([[40, 6]], 'H');
put([[42, 5]], 'K'); put([[42, 7]], 'I');
rect(40, 2, 41, 2, '#'); rect(40, 10, 41, 10, '#'); put([[42, 3], [42, 9], [42, 4], [42, 8]], '#');

const rows = g.map((r) => r.join('')); require('fs').writeFileSync(__dirname + '/lerche-m3c.json', JSON.stringify(rows));
console.log(rows.map((r, y) => `'${r}', // ${String(y).padStart(2)}`).join('\n'));

const SOLID = new Set(['#', ' ', 'E', 'A', 'u', 'k', 'f', 'Y', 'S', 'O', 'R', 'G', 'y', 'L', 'B', 'F', 'M', 'U', 'T', 'X', 'Z', 'J', 'V', 'C', 'W', 'H', 'K', 'I']);
const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? ' ' : rows[y][x];
const walk = (x, y) => !SOLID.has(at(x, y));
function bfsFrom(sx, sy) {
  const d = new Map([[sx + ',' + sy, 0]]); const q = [[sx, sy]];
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny; if (!d.has(k) && walk(nx, ny)) { d.set(k, d.get(x + ',' + y) + 1); q.push([nx, ny]); } } }
  return d;
}
const names = { E: 'Triebwerk', A: 'Heck-Emitter', R: 'Reaktor', G: 'Schildgenerator', F: 'Düse Bb', Z: 'Düse Stb', M: 'Batterie Bb', J: 'Batterie Stb', U: 'Emitter Bb', V: 'Emitter Stb', K: 'Bug-Waffe', I: 'Bug-Emitter',
  y: 'Reaktorschalter', L: 'Regal', T: 'Transferkonsole', X: 'Transfer-System', O: 'Lebenserhaltung', S: 'Terminal', B: 'Koje', H: 'Steuer', C: 'Captain', W: 'Taktik', Y: 'Planungstisch' };
const reach = (d, x, y) => Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => d.get((x + dx) + ',' + (y + dy)) ?? Infinity));
const dist = bfsFrom(38, 6);
let ok = rows.every((r) => r.length === W); const seenY = new Set();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ch = rows[y][x]; if (!names[ch]) continue;
  const best = reach(dist, x, y);
  if (ch === 'Y') { if (best !== Infinity) seenY.add(1); continue; }
  if (best === Infinity) { ok = false; console.log('NICHT ERREICHBAR', names[ch], x, y); }
  else if ('EARGFZMJUVKIy'.includes(ch)) console.log(`${names[ch].padEnd(16)} (${x},${y})  ${String(best).padStart(2)} Kacheln ≈ ${(best / 3).toFixed(1)} s`);
}
if (!seenY.size) { ok = false; console.log('Planungstisch nicht erreichbar'); }
for (const [x, y] of [[6, 10], [8, 10], [7, 11]]) if (!dist.has(x + ',' + y)) { ok = false; console.log('Pad nicht erreichbar'); }
// Schalter A <-> B Laufweg
const dA = bfsFrom(20, 1); console.log('Schalter A -> B:', reach(dA, 23, 11), 'Kacheln');
console.log(ok ? 'ALLE STATIONEN ERREICHBAR' : 'PRÜFUNG FEHLGESCHLAGEN');


