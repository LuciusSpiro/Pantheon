// Entwurf 2: umgebaute KRS Lerche für M3, 42 x 13 (wie heute). Bug rechts (+x), Backbord oben (-y), Steuerbord unten (+y).
const W = 42, H = 13;
const g = Array.from({ length: H }, () => Array(W).fill(' '));
const rect = (x0, y0, x1, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = ch; };
const put = (list, ch) => list.forEach(([x, y]) => { g[y][x] = ch; });

rect(0, 0, 31, 12, '#');                       // Rumpf mittschiffs
rect(32, 1, 37, 11, '#'); rect(38, 2, 39, 10, '#'); rect(40, 4, 41, 8, '#'); // Bug verjüngt

// Maschinenraum x1-6
rect(1, 1, 6, 11, '=');
put([[1, 6]], 'E');                            // Triebwerk
put([[6, 1]], 'A');                            // Heck-Emitter
put([[3, 1], [4, 11]], 'u'); put([[2, 11]], 'k'); put([[1, 10], [6, 11]], 'f');
put([[7, 6]], 'D');

// Mittelband y5-7: Messe (klein) + Gang + Kern
rect(8, 5, 30, 7, '.');
rect(8, 5, 13, 7, ',');
put([[11, 5], [12, 5], [11, 6], [12, 6]], 'Y'); // Planungstisch 2x2
put([[13, 5]], 'S'); put([[8, 7]], 'O');        // Terminal, Lebenserhaltung
put([[23, 5]], 'R'); put([[23, 7]], 'G');       // Reaktor, Schildgenerator (Kern)
put([[20, 5]], 'y'); put([[26, 7]], 'y');       // Reaktor-Neustartschalter A/B

// Backbord y1-3
rect(8, 1, 12, 3, '.'); put([[8, 1], [9, 1], [10, 1], [11, 1], [12, 1]], 'L'); // Lager (Regale x8-12, Zeile 1 wie heute)
rect(14, 1, 16, 3, ','); put([[14, 1]], 'B');   // Quartier 0
rect(18, 1, 20, 3, ','); put([[18, 1]], 'B');   // Quartier 1
rect(22, 1, 30, 3, '=');                        // Bb-Batteriedeck
put([[23, 1]], 'F'); put([[26, 1]], 'M'); put([[29, 1]], 'U');
put([[10, 4], [15, 4], [19, 4], [24, 4], [28, 4]], 'D');

// Steuerbord y9-11
rect(8, 9, 12, 11, '.'); put([[9, 10], [11, 10], [10, 11]], 'P'); put([[12, 11]], 'T'); put([[8, 11]], 'X'); // Transfer
rect(14, 9, 16, 11, ','); put([[14, 11]], 'B'); // Quartier 2
rect(18, 9, 20, 11, ','); put([[18, 11]], 'B'); // Quartier 3 (Gast)
rect(22, 9, 30, 11, '=');                       // Stb-Batteriedeck
put([[23, 11]], 'Z'); put([[26, 11]], 'J'); put([[29, 11]], 'V');
put([[10, 8], [15, 8], [19, 8], [24, 8], [28, 8]], 'D');

// Brücke x32-40
rect(32, 2, 37, 10, '.'); rect(38, 3, 39, 9, '.'); rect(40, 5, 40, 7, '.');
put([[31, 6]], 'D');
put([[33, 3]], 'W'); put([[35, 6]], 'C'); put([[38, 6]], 'H');
put([[40, 5]], 'K'); put([[40, 7]], 'I');       // Bug-Waffe, Bug-Emitter in der Bugspitze

const rows = g.map((r) => r.join(''));
console.log(rows.map((r, y) => `'${r}', // ${String(y).padStart(2)}`).join('\n'));

const SOLID = new Set(['#', ' ', 'E', 'A', 'u', 'k', 'f', 'Y', 'S', 'O', 'R', 'G', 'y', 'L', 'B', 'F', 'M', 'U', 'T', 'X', 'Z', 'J', 'V', 'C', 'W', 'H', 'K', 'I']);
const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? ' ' : rows[y][x];
const walk = (x, y) => !SOLID.has(at(x, y));
function bfsFrom(sx, sy, blocked) {
  const d = new Map([[sx + ',' + sy, 0]]); const q = [[sx, sy]];
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny; if (!d.has(k) && walk(nx, ny) && k !== blocked) { d.set(k, d.get(x + ',' + y) + 1); q.push([nx, ny]); } } }
  return d;
}
const names = { E: 'Triebwerk', A: 'Heck-Emitter', R: 'Reaktor', G: 'Schildgenerator', F: 'Düse Bb', Z: 'Düse Stb', M: 'Batterie Bb', J: 'Batterie Stb', U: 'Emitter Bb', V: 'Emitter Stb', K: 'Bug-Waffe', I: 'Bug-Emitter',
  y: 'Reaktorschalter', L: 'Regal', T: 'Transferkonsole', X: 'Transfer-System', O: 'Lebenserhaltung', S: 'Terminal', B: 'Koje', H: 'Steuer', C: 'Captain', W: 'Taktik' };
const reach = (d, x, y) => Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => d.get((x + dx) + ',' + (y + dy)) ?? Infinity));
const dist = bfsFrom(36, 6);
let ok = rows.every((r) => r.length === W);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ch = rows[y][x]; if (!names[ch]) continue;
  const best = reach(dist, x, y);
  if (best === Infinity) { ok = false; console.log('NICHT ERREICHBAR', names[ch], x, y); }
  else if ('EARGFZMJUVKI'.includes(ch)) console.log(`${names[ch].padEnd(16)} (${x},${y})  ${String(best).padStart(2)} Kacheln ≈ ${(best / 3).toFixed(1)} s`);
}
for (const [x, y] of [[9, 10], [11, 10], [10, 11]]) if (!dist.has(x + ',' + y)) { ok = false; console.log('Pad nicht erreichbar'); }
// Lecktest: jede einzelne Bodenkachel blockieren -> bleiben alle Stationen erreichbar?
let leakFail = 0;
for (const k of dist.keys()) {
  if (k === '36,6') continue;
  const d2 = bfsFrom(36, 6, k);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if ('EARGFZMJUVKIyLTX'.includes(rows[y][x]) && reach(d2, x, y) === Infinity) { leakFail++; if (leakFail <= 6) console.log(`Leck auf ${k} trennt ${names[rows[y][x]]}`); } }
}
console.log('Leck-Engstellen (Treffer):', leakFail);
console.log(ok ? 'ALLE STATIONEN ERREICHBAR' : 'PRÜFUNG FEHLGESCHLAGEN');

