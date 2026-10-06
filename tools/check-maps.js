'use strict';
// Kartenprüfung (CONTRACT.md §3, CONTRACT-M1 §3/§9.4): Zeilenlängen, Legende, Erreichbarkeit aller Interaktionspunkte (BFS).
// Plattform: Sonde ohne Tür, Datenkern NUR nach der Tür. Wrack: Container/Terminal erreichbar, Hohlraum-Container NUR
// nach Öffnen der dünnen Wand. Orte (shared/locations.js): Verbindungen symmetrisch, 7 Orte, 9 Verstecke, alles erreichbar.
const Maps = require('../shared/maps.js');
const { bfs } = require('../server/util.js');
const CONFIG = require('../shared/config.js');
const Physics = require('../shared/physics.js');

let failures = 0, checks = 0;
function check(cond, text) {
  checks++;
  if (cond) console.log('  ok   ' + text);
  else { failures++; console.log('  FEHLER ' + text); }
}

function reachableSet(map, walkable, starts) {
  const seen = new Set();
  const q = [];
  for (const s of starts) { const k = s.y * map.w + s.x; if (!seen.has(k)) { seen.add(k); q.push(s); } }
  while (q.length) {
    const c = q.shift();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const k = ny * map.w + nx;
      if (seen.has(k) || !walkable(nx, ny)) continue;
      seen.add(k); q.push({ x: nx, y: ny });
    }
  }
  return seen;
}
function hasAccess(map, set, t) {
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => set.has((t.y + dy) * map.w + (t.x + dx)));
}

function checkRows(name, rows, legend) {
  console.log(`\n[${name}] ${rows[0].length}×${rows.length}`);
  const w = rows[0].length;
  check(rows.every((r) => r.length === w), `alle Zeilen gleich lang (${w})`);
  const unknown = new Set();
  rows.forEach((r) => { for (const ch of r) if (!legend[ch]) unknown.add(ch); });
  check(unknown.size === 0, 'alle Zeichen in der Legende' + (unknown.size ? ' – unbekannt: ' + [...unknown].join(' ') : ''));
  // Rand geschlossen (kein begehbarer Rand)
  const m = Maps.makeMap(name, rows, legend);
  let openEdge = 0;
  for (let x = 0; x < m.w; x++) { if (!m.solid(x, 0)) openEdge++; if (!m.solid(x, m.h - 1)) openEdge++; }
  for (let y = 0; y < m.h; y++) { if (!m.solid(0, y)) openEdge++; if (!m.solid(m.w - 1, y)) openEdge++; }
  check(openEdge === 0, 'Kartenrand geschlossen');
}

// ---------- Schiff ----------
checkRows('ship', Maps.SHIP_ROWS, Maps.LEGEND);
const ship = Maps.ship;
const shipWalk = (x, y) => !ship.solid(x, y);
const shipSet = reachableSet(ship, shipWalk, Maps.SHIP_SPAWNS);
for (const s of Maps.SHIP_SPAWNS) check(shipWalk(s.x, s.y), `Spawn (${s.x},${s.y}) begehbar`);
for (const s of Maps.BOT_SPAWNS) check(shipSet.has(s.y * ship.w + s.x), `Bot-Spawn (${s.x},${s.y}) erreichbar`);
const interactive = [];
for (let y = 0; y < ship.h; y++) for (let x = 0; x < ship.w; x++) {
  const info = ship.info(x, y);
  if (info.interact || info.kind === 'pad') interactive.push({ x, y, ch: ship.at(x, y), info });
}
for (const t of interactive) {
  if (t.info.kind === 'pad') check(shipSet.has(t.y * ship.w + t.x), `Transferpad (${t.x},${t.y}) erreichbar`);
  else check(hasAccess(ship, shipSet, t), `'${t.ch}' ${t.info.kind} (${t.x},${t.y}) von einer Nachbarkachel erreichbar`);
}
for (const x of Object.keys(Maps.SHELVES)) {
  check(ship.at(+x, 1) === 'L', `Regal ${Maps.SHELVES[x]} bei (${x},1) ist 'L'`);
  check(shipSet.has(2 * ship.w + (+x)), `Regal ${Maps.SHELVES[x]}: Zugangskachel (${x},2) erreichbar (Bots holen Teile)`);
}
for (const b of Maps.BEDS) {
  check(ship.at(b.x, b.y) === 'B', `Koje Farbe ${b.color} bei (${b.x},${b.y}) ist 'B'`);
  for (const s of b.slots) check(!ship.solid(s.x, s.y) || ship.at(s.x, s.y) === 'B', `Deko-Slot ${s.id} (${s.x},${s.y}) liegt auf Boden`);
}
const systems = ['reactor', 'engines', 'shields', 'weapons', 'life', 'transfer'];
for (const s of systems) check(interactive.some((t) => t.info.system === s), `Systempunkt ${s} vorhanden`);
for (const c of ['helm', 'captain', 'weapons', 'transfer', 'shop', 'plan']) check(interactive.some((t) => t.info.console === c), `Konsole ${c} vorhanden`);
check(ship.find('P').length === 3, 'drei Transferpads an Bord');
Maps.SECTOR_REGIONS.forEach((r, i) => {
  let floors = 0;
  for (let y = 0; y < ship.h; y++) for (let x = 0; x < ship.w; x++) if (!ship.solid(x, y) && r.test(x, y)) floors++;
  check(floors > 0, `Sektorbereich ${i} (${r.name}) hat Bodenkacheln (${floors})`);
  for (const s of r.systems) {
    const t = interactive.find((q) => q.info.system === s);
    check(t && r.test(t.x, t.y) || (t && r.test(t.x + 1, t.y)) || (t && r.test(t.x - 1, t.y)) || (t && r.test(t.x, t.y - 1)) || (t && r.test(t.x, t.y + 1)), `System ${s} liegt im Bereich ${r.name}`);
  }
});

// BFS-Pfad (wie die Bots) vom Bot-Spawn zu jedem Systempunkt
for (const s of systems) {
  const t = interactive.find((q) => q.info.system === s);
  const path = bfs(shipWalk, Maps.BOT_SPAWNS[0], (x, y) => shipWalk(x, y) && Math.abs(x - t.x) + Math.abs(y - t.y) === 1, ship.w, ship.h);
  check(!!path, `Bot-BFS zum System ${s}: ${path ? path.length + ' Schritte' : 'kein Weg'}`);
}

// ---------- M1: Schiff ----------
check(ship.w === 42 && ship.h === 13, 'Schiff 42×13');
check(Maps.BEDS.length === 4 && Maps.BEDS.map((b) => b.color).sort().join() === '0,1,2,3', '4 Quartiere (Farben 0–3, 3 = Gästequartier)');
for (const b of Maps.BEDS) {
  check(b.slots.length === 4, `Quartier ${b.room.id}: 4 Deko-Slots`);
  for (const sl of b.slots) check(sl.x >= b.room.x0 && sl.x <= b.room.x1 && sl.y >= b.room.y0 && sl.y <= b.room.y1, `Slot ${sl.id} liegt im Raum ${b.room.id}`);
  check(b.x >= b.room.x0 && b.x <= b.room.x1 && b.y >= b.room.y0 && b.y <= b.room.y1, `Koje ${b.room.id} liegt im Raum`);
}
for (const sw of Maps.REACTOR_SWITCHES) {
  check(ship.at(sw.x, sw.y) === 'y', `Reaktorschalter ${sw.id} (${sw.x},${sw.y}) ist 'y'`);
  check(hasAccess(ship, shipSet, sw), `Reaktorschalter ${sw.id} erreichbar (Spieler und Schrauber)`);
  const path = bfs(shipWalk, Maps.BOT_SPAWNS[0], (x, y) => shipWalk(x, y) && Math.abs(x - sw.x) + Math.abs(y - sw.y) === 1, ship.w, ship.h);
  check(!!path, `Bot-BFS zu Schalter ${sw.id}: ${path ? path.length + ' Schritte' : 'kein Weg'}`);
}
check(ship.find('Y').length === 4, 'Planungstisch Y ist 2×2');
check(ship.find('Y').filter((t) => hasAccess(ship, shipSet, t)).length >= 3, 'Planungstisch von mehreren Seiten erreichbar (3 Plätze)');
for (const sp of Maps.SHIP_SPAWNS) check(shipSet.has(sp.y * ship.w + sp.x), `Spieler-Spawn (${sp.x},${sp.y}) im Hauptbereich`);

// ---------- M0: Maschinenraum (x1–6, y1–11) ----------
{
  const deco = ['u', 'k', 'n', 'f'];
  let decoCount = 0;
  for (let y = 1; y <= 11; y++) for (let x = 1; x <= 6; x++) if (deco.includes(ship.at(x, y))) decoCount++;
  check(decoCount >= 1 && decoCount <= 8, `Maschinenraum: ${decoCount} neue solide Kulissen-Kacheln (max. 8)`);
  let gangFree = true;
  for (let x = 1; x <= 6; x++) if (ship.solid(x, 6)) gangFree = false;
  check(gangFree, 'Maschinenraum: Gang y6 (x1–6) frei');
  check(ship.at(7, 6) === 'D', 'Maschinenraum: Tür (7,6) frei');
  for (const ch of ['R', 'E']) { const t = ship.find(ch)[0]; check(!!t && hasAccess(ship, shipSet, t), `Maschinenraum: '${ch}' (${t.x},${t.y}) von mind. einer Seite erreichbar`); }
  for (const ch of deco) check(!!Maps.LEGEND[ch] && Maps.LEGEND[ch].solid, `Legende: '${ch}' (${Maps.LEGEND[ch] && Maps.LEGEND[ch].kind}) solid`);
}

// ---------- Plattform ----------
checkRows('platform', Maps.PLATFORM_ROWS, Maps.PLATFORM_LEGEND);
const pf = Maps.platform;
const closedWalk = (x, y) => !pf.solid(x, y);                       // Tür 'L' solid
const openWalk = (x, y) => pf.at(x, y) === 'L' || !pf.solid(x, y);   // Tür offen
for (const p of Maps.PLATFORM_PADS) check(pf.at(p.x, p.y) === 'P', `Plattform-Pad (${p.x},${p.y}) ist 'P'`);
const closedSet = reachableSet(pf, closedWalk, Maps.PLATFORM_PADS);
const openSet = reachableSet(pf, openWalk, Maps.PLATFORM_PADS);
const Z = pf.find('Z')[0], N = pf.find('N')[0], Q = pf.find('Q')[0];
check(!!Z && hasAccess(pf, closedSet, Z), 'Sonde Z ohne Tür erreichbar');
check(!!N && closedSet.has(N.y * pf.w + N.x), 'Techniker N ohne Tür erreichbar');
check(!!Q && !closedSet.has(Q.y * pf.w + Q.x), 'Datenkern Q bei geschlossener Tür NICHT erreichbar');
check(!!Q && openSet.has(Q.y * pf.w + Q.x), 'Datenkern Q nach Öffnen der Tür erreichbar');
check(pf.find('L').length >= 1, 'verriegelte Tür L vorhanden');
for (const d of pf.find('d')) check(openSet.has(d.y * pf.w + d.x), `Drohnen-Spawn (${d.x},${d.y}) auf begehbarer Fläche`);
const pathCore = bfs(openWalk, Maps.PLATFORM_PADS[0], (x, y) => x === Q.x && y === Q.y, pf.w, pf.h);
check(!!pathCore, `Pfad Pad → Datenkern bei offener Tür: ${pathCore ? pathCore.length + ' Schritte' : '—'}`);
const cores = pf.find('b');
check(cores.length === 4 && cores.some((c) => hasAccess(pf, closedSet, c)), 'Bojenkern b (2×2) ohne Tür erreichbar (Neustart nach Sonde)');
for (const g of (CONFIG.awayExtra && CONFIG.awayExtra.guardSpawns) || []) check(closedSet.has(g.y * pf.w + g.x), `Wächter-Spawn (${g.x},${g.y}) begehbar und ohne Tür erreichbar`);
const drillT = CONFIG.drill && CONFIG.drill.fire;
if (drillT) check(!ship.solid(drillT.x, drillT.y), `Übungsfeuer (${drillT.x},${drillT.y}) auf Bodenkachel`);
const pathZ = bfs(closedWalk, Maps.PLATFORM_PADS[0], (x, y) => closedWalk(x, y) && Math.abs(x - Z.x) + Math.abs(y - Z.y) === 1, pf.w, pf.h);
check(!!pathZ, `Pfad Pad → Sonde: ${pathZ ? pathZ.length + ' Schritte' : '—'}`);

// ---------- M1: Wrack „Zaunkönig“ (CONTRACT-M1 §9.4) ----------
checkRows('wreck', Maps.WRECK_ROWS, Maps.WRECK_LEGEND);
const wr = Maps.wreck;
const wClosed = (x, y) => !wr.solid(x, y);
const wOpen = (x, y) => wr.at(x, y) === 'V' || !wr.solid(x, y);
for (const p of Maps.WRECK_PADS) check(wr.at(p.x, p.y) === 'P', `Wrack-Pad (${p.x},${p.y}) ist 'P'`);
check(Maps.WRECK_PADS.length === 3 && wr.find('P').length === 3, 'Wrack: 3 Landepads');
const wcSet = reachableSet(wr, wClosed, Maps.WRECK_PADS);
const woSet = reachableSet(wr, wOpen, Maps.WRECK_PADS);
const V = wr.find('V');
check(V.length === 1, 'Wrack: genau eine dünne Wand V');
check(V.length === 1 && hasAccess(wr, wcSet, V[0]), 'dünne Wand V von außen erreichbar');
const hs = wr.find('h');
const hiddenH = hs.filter((t) => !hasAccess(wr, wcSet, t));
check(hiddenH.length === 1, 'genau ein Container nur hinter der dünnen Wand (Hohlraum)');
check(hiddenH.length === 1 && hasAccess(wr, woSet, hiddenH[0]), 'Hohlraum-Container nach Öffnen der Wand erreichbar');
check(hs.length - hiddenH.length >= 3 && hs.length - hiddenH.length <= 4, `${hs.length - hiddenH.length} Container ohne Hohlraum erreichbar (3–4)`);
const gs = wr.find('g');
check(gs.length === 1 && hasAccess(wr, wcSet, gs[0]), 'Logbuch-Terminal g erreichbar');
const as = wr.find('a');
check(as.length >= 2 && as.length <= 3, `${as.length} Plünderer-Spawns (2–3)`);
for (const a of as) check(wcSet.has(a.y * wr.w + a.x), `Plünderer-Spawn (${a.x},${a.y}) begehbar und erreichbar`);
for (const ch of ['h', 'g', 'V', 'x']) check(!!Maps.WRECK_LEGEND[ch] && Maps.WRECK_LEGEND[ch].solid, `Wrack-Legende '${ch}' (${Maps.WRECK_LEGEND[ch] && Maps.WRECK_LEGEND[ch].kind}) solid`);

// ---------- M1: Orte (shared/locations.js) ----------
{
  const L = require('../shared/locations.js');
  console.log('\n[locations]');
  check(L.LOCATIONS.length === 8, '8 Orte (M2: + Mond Kesh)');
  check(['hafen', 'splitter', 'b7', 'vaelen', 'wrack', 'nebel', 'relais', 'kesh'].every((id) => !!L.get(id)), 'Orts-IDs laut Vertrag');
  for (const l of L.LOCATIONS) {
    for (const b of l.links) check(L.get(b) && L.get(b).links.includes(l.id), `Verbindung ${l.id}–${b} symmetrisch`);
    if (l.id === 'kesh') check(l.hidden.length === 0, 'kesh: keine versteckten Objekte (CONTRACT-M2 §3.1)');
    else check(l.hidden.length >= 1 && l.hidden.length <= 3, `${l.id}: ${l.hidden.length} versteckte Objekte (1–3)`);
    const sc = l.scene;
    for (const h of l.hidden) check(h.x > 0 && h.y > 0 && h.x < sc.w && h.y < sc.h, `${h.id} liegt in der Szene`);
    check(sc.arrive.x > 0 && sc.arrive.x < sc.w && sc.arrive.y > 0 && sc.arrive.y < sc.h, `${l.id}: Ankunft in der Szene`);
    if (sc.beam) check(!!Maps[sc.beam.map], `${l.id}: Außenkarte ${sc.beam.map} vorhanden`);
  }
  check(L.totalHidden() === 12, `Entdeckungen gesamt: ${L.totalHidden()} (M1 nach QA: x/12)`);
  check(L.get('nebel').fog && L.get('relais').links.join() === 'nebel', 'Nebel mit fog, Relais nur über den Nebel');
  check(!!L.lockedKey('nebel', 'relais'), 'Verbindung nebel–relais zunächst gesperrt (Leitbake)');
  const seen = new Set(['hafen']); const q = ['hafen'];
  while (q.length) { const c = q.shift(); for (const nb of L.get(c).links) if (!seen.has(nb)) { seen.add(nb); q.push(nb); } }
  check(seen.size === 8, 'alle Orte vom Hafen aus erreichbar');
  check(!!L.lockedKey('hafen', 'kesh') && !!L.lockedKey('splitter', 'kesh'), 'Verbindungen zu Kesh zunächst gesperrt (Mission m3 öffnet)');
  check(L.get('kesh').scene.beam.map === 'kesh' && L.get('kesh').scene.station.kind === 'moon', 'kesh: Station moon, Außenkarte kesh');
}

// ---------- M2: Mond Kesh (CONTRACT-M2 §2) ----------
{
  const Los = require('../shared/los.js');
  const W = require('../server/world.js');
  checkRows('kesh', Maps.KESH_ROWS, Maps.KESH_LEGEND);
  const km = Maps.kesh;
  check(km.w === 48 && km.h === 26, 'Kesh 48×26');
  const closed = (x, y) => !km.solid(x, y);
  const open = (x, y) => km.at(x, y) === 'G' || !km.solid(x, y);
  for (const p of Maps.KESH_PADS) check(km.at(p.x, p.y) === 'P', `Kesh-Pad (${p.x},${p.y}) ist 'P'`);
  const cs = reachableSet(km, closed, Maps.KESH_PADS);
  const os = reachableSet(km, open, Maps.KESH_PADS);
  for (const ch of ['a', 'b', 'c', 'L']) for (const t of km.find(ch)) check(cs.has(t.y * km.w + t.x), `Spawn '${ch}' (${t.x},${t.y}) von den Pads erreichbar`);
  for (const ch of ['r', 'k']) for (const t of km.find(ch)) check(hasAccess(km, cs, t), `'${ch}' (${t.x},${t.y}) von den Pads erreichbar (Tor zu)`);
  const T = km.find('T')[0];
  check(!!T && !hasAccess(km, cs, T), 'Tafel bei geschlossenem Tor NICHT erreichbar (Tor ist Pflicht)');
  check(!!T && hasAccess(km, os, T), 'Tafel bei offenem Tor erreichbar');
  check(km.find('k').length === 2, 'zwei Archivschlüssel');
  const ks = km.find('k');
  check(ks.length === 2 && Math.abs(ks[0].x - ks[1].x) + Math.abs(ks[0].y - ks[1].y) >= 12, 'Archivschlüssel weit auseinander');
  check(km.find('r').length === 2 && km.find('G').length === 2, 'zwei Störrelais, Tor 2 breit');
  // Sichtlinie: kein Gegner-Spawn sieht ein Pad (Tor zu, Sicht wie shared/los.js)
  const blocked = Los.sightFn(km);
  let losBad = [];
  for (const ch of ['a', 'b', 'c', 'L']) for (const s of km.find(ch)) for (const p of Maps.KESH_PADS) {
    const a = Physics.tileCenter(s.x, s.y), b = Physics.tileCenter(p.x, p.y);
    if (Los.lineOfSight(blocked, a.x, a.y, b.x, b.y)) losBad.push(`${ch}(${s.x},${s.y})->(${p.x},${p.y})`);
  }
  check(losBad.length === 0, 'kein Gegner-Spawn hat Sichtlinie auf ein Pad' + (losBad.length ? ': ' + losBad.join(' ') : ''));
  const info = W.AWAY_MAPS.kesh;
  const lowCover = info.coverSpots.filter((s) => s.cover >= 1).length;
  check(info.coverSpots.length >= 100, `Deckungsplätze (inkl. Wände): ${info.coverSpots.length}`);
  check(info.coverSpots.every((s) => cs.has(s.y * km.w + s.x) || os.has(s.y * km.w + s.x)), `alle ${lowCover} Deckungsplätze begehbar und erreichbar`);
  check(info.combat === 'v2' && W.AWAY_MAPS.platform.combat === undefined && W.AWAY_MAPS.wreck.combat === undefined, 'Kampf v2 nur auf kesh');
  for (const ch of ['o', 'k', 'T']) check(Maps.KESH_LEGEND[ch].low && Maps.KESH_LEGEND[ch].cover === 1, `'${ch}' halbe Deckung (low, cover 1)`);
}

console.log(`\n${checks - failures}/${checks} Prüfungen bestanden.`);
if (failures) { console.log(`${failures} FEHLER.`); process.exit(1); }
console.log('Karten OK.');
