'use strict';
// Kartenprüfung (CONTRACT.md §3, CONTRACT-M1 §3/§9.4): Zeilenlängen, Legende, Erreichbarkeit aller Interaktionspunkte (BFS).
// Plattform: Sonde ohne Tür, Datenkern NUR nach der Tür. Wrack: Container/Terminal erreichbar, Hohlraum-Container NUR
// nach Öffnen der dünnen Wand. Orte (shared/locations.js): seit B Welle 0 in tools/check-sektoren.js.
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

// links(x,y) -> [{x,y}]: zusätzliche Kanten (M4: Lift/Leiter zwischen den Decks)
function reachableSet(map, walkable, starts, links) {
  const seen = new Set();
  const q = [];
  for (const s of starts) { const k = s.y * map.w + s.x; if (!seen.has(k)) { seen.add(k); q.push(s); } }
  while (q.length) {
    const c = q.shift();
    const next = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).concat(links ? links(c.x, c.y) : []);
    for (const n of next) {
      const nx = n.x, ny = n.y;
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
// PAN-01 B „Drei Decks“: alles aus dem Schiffslayout (SHIP_ROWS, Legende, SHIP_ROOMS, SHELF_TILES, SHIP_DRILL, Decks, Lifts, Pforten, Waffenplätze) – keine festen Koordinaten,
// außer wo der Kachelplan selbst der Vertrag ist (Brücke, Schächte, Modulräume).
const ship = Maps.ship;
const shipLegend = ship.legend || Maps.LEGEND;
checkRows('ship', Maps.SHIP_ROWS, shipLegend);
const solidAtStufe = (st) => Maps.shipSolidFn(st);
const walkAtStufe = (st) => { const s = solidAtStufe(st); return (x, y) => !s(x, y); };
const shipWalk = walkAtStufe(Maps.STUFE_MAX);   // voll ausgebaut: alle Pforten offen
const shipChars = new Set(Maps.SHIP_ROWS.join(''));
// Erreichbarkeit über alle Decks – Spieler mit Lift und Leiter, Bots nur mit Lift (bei voller Ausbaustufe, die Stufen prüft der Abschnitt „Ausbau“)
const deckLinks = (x, y) => Maps.deckLinks(x, y);
const botLinks = (x, y) => Maps.deckLinks(x, y, { ladder: false });
const shipSet = reachableSet(ship, shipWalk, Maps.SHIP_SPAWNS, deckLinks);
const botSet = reachableSet(ship, shipWalk, Maps.BOT_SPAWNS.slice(0, 1), botLinks);
// BFS wie die Bots (mit Lift-Kanten)
const botBfs = (start, goal) => bfs(shipWalk, start, goal, ship.w, ship.h, null, botLinks);
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
// Regale (SHELF_TILES inkl. Zugang): jede Regalkachel der Karte hat einen Eintrag und umgekehrt
const shelfTilesOnMap = interactive.filter((t) => t.info.interact === 'shelf');
check(Maps.SHELF_TILES.length === shelfTilesOnMap.length, `SHELF_TILES (${Maps.SHELF_TILES.length}) = Regalkacheln der Karte (${shelfTilesOnMap.length})`);
check(new Set(Maps.SHELF_TILES.map((s) => s.item)).size === Maps.SHELF_TILES.length, 'jeder Gegenstand liegt in genau einem Regal');
for (const s of Maps.SHELF_TILES) {
  check(ship.info(s.x, s.y).interact === 'shelf', `Regal ${s.item} bei (${s.x},${s.y}) ist ein Regal`);
  check(Maps.shelfAt(s.x, s.y) === s, `shelfAt(${s.x},${s.y}) liefert ${s.item}`);
  const a = s.access;
  check(!!a && Math.abs(a.x - s.x) + Math.abs(a.y - s.y) === 1, `Regal ${s.item}: Zugang (${a && a.x},${a && a.y}) grenzt an das Regal`);
  check(!!a && shipSet.has(a.y * ship.w + a.x), `Regal ${s.item}: Zugangskachel (${a && a.x},${a && a.y}) erreichbar (Bots holen Teile)`);
}
for (const b of Maps.BEDS) {
  check(ship.info(b.x, b.y).interact === 'bed', `Koje Farbe ${b.color} bei (${b.x},${b.y}) ist eine Koje`);
  for (const s of b.slots) check(!ship.solid(s.x, s.y) || ship.info(s.x, s.y).interact === 'bed', `Deko-Slot ${s.id} (${s.x},${s.y}) liegt auf Boden`);
}
// Systemliste aus der Legende der Schiffskarte (alle info.system), Stationen = alle Kacheln je System
const systems = [...new Set([...shipChars].map((ch) => shipLegend[ch] && shipLegend[ch].system).filter(Boolean))];
check(systems.length >= 1, `Systeme laut Legende: ${systems.join(', ')}`);
for (const ch of Object.keys(shipLegend)) {
  const info = shipLegend[ch];
  if (info.system && shipLegend !== Maps.LEGEND) check(shipChars.has(ch), `Station '${ch}' (${info.system}) liegt auf der Karte`);
}
const stationsOf = (s) => interactive.filter((q) => q.info.system === s);
for (const s of systems) check(stationsOf(s).length >= 1, `Systempunkt ${s} vorhanden (${stationsOf(s).length} Kachel(n))`);
for (const c of ['helm', 'captain', 'weapons', 'transfer', 'shop', 'plan']) check(interactive.some((t) => t.info.console === c), `Konsole ${c} vorhanden`);
check(interactive.filter((t) => t.info.kind === 'pad').length === 3, 'drei Transferpads an Bord');
{   // PAN-01 B (Feedback 1): Fahrtrichtung. Der Deckindex (0 Mittel, 1 Ober, 2 Unter) ist NICHT die Höhe; oben/unten bestimmt SHIP_DECKS[].level (Client-Animation: deckLevel in voxel/actors.js).
  const lv = (d) => Maps.SHIP_DECKS.find((q) => q.idx === d).level;
  check(lv(2) < lv(0) && lv(0) < lv(1) && Maps.DECK_HOCH.map(lv).join() === '-1,0,1', 'Höhenlage: Unterdeck (Index 2) −1 < Mitteldeck (0) 0 < Oberdeck (1) +1, DECK_HOCH von unten nach oben');
  let richtungOk = true, n = 0;
  for (const lift of [...Maps.SHIP_LIFTS, ...Maps.SHIP_LADDERS]) {
    const t = lift.tiles ? lift.tiles[0] : { x: lift.x, y: lift.y };
    for (const d of Maps.DECK_HOCH) {
      const ty = Maps.deckLocalY(t.y) + d * Maps.DECK_STRIDE;
      const up = Maps.fahrtZiel(t.x, ty, 1, Maps.STUFE_MAX), down = Maps.fahrtZiel(t.x, ty, -1, Maps.STUFE_MAX);
      n++;
      if (up && lv(up.deck) <= lv(d)) richtungOk = false;
      if (down && lv(down.deck) >= lv(d)) richtungOk = false;
    }
  }
  check(richtungOk && n > 0, `fahrtZiel: W/hoch führt immer auf das Deck mit größerer Höhenlage, S/runter auf das mit kleinerer (${n} Prüfungen)`);
}
{   // PAN-01 B (Feedback 1): Lager und Transferkammer. Lager: die fünf Regale mittig an der Nordwand (symmetrisch zur Raummitte). Transferkammer: Pads links (Heckseite, kleineres x), Konsole und Station rechts (Bugseite).
  const lager = Maps.SHIP_ROOMS.find((r) => r.id === 'lager'), tk = Maps.SHIP_ROOMS.find((r) => r.id === 'transfer');
  const sx = Maps.SHELF_TILES.map((t) => t.x).sort((p, q) => p - q);
  check(sx.length === 5 && sx[4] - sx[0] === 4 && sx[0] + sx[4] === lager.x0 + lager.x1 && Maps.SHELF_TILES.every((t) => t.y === lager.y0), `Lager: fünf Regale nebeneinander, mittig (x ${sx.join(',')}, Raummitte ${(lager.x0 + lager.x1) / 2})`);
  const padsX = interactive.filter((t) => t.info.kind === 'pad').map((t) => t.x), tcon = interactive.find((t) => t.info.console === 'transfer'), tsys = interactive.find((t) => t.info.system === 'transfer');
  check(padsX.every((x) => x >= tk.x0 && x <= tk.x1) && tcon.x >= tk.x0 && tsys.x <= tk.x1, 'Transferkammer: Pads, Konsole und Station im Raum');
  check(Math.max(...padsX) < Math.min(tcon.x, tsys.x), `Transferkammer: Pads links (x bis ${Math.max(...padsX)}), Konsole (x ${tcon.x}) und Station (x ${tsys.x}) rechts`);
}
Maps.SECTOR_REGIONS.forEach((r, i) => {
  let floors = 0;
  for (let y = 0; y < ship.h; y++) for (let x = 0; x < ship.w; x++) if (!ship.solid(x, y) && r.test(x, y)) floors++;
  check(floors > 0, `Sektorbereich ${i} (${r.name}) hat Bodenkacheln (${floors})`);
  for (const s of r.systems) {
    const near = (t) => r.test(t.x, t.y) || r.test(t.x + 1, t.y) || r.test(t.x - 1, t.y) || r.test(t.x, t.y - 1) || r.test(t.x, t.y + 1);
    check(stationsOf(s).some(near), `System ${s} liegt im Bereich ${r.name}`);
  }
});

// BFS-Pfad (wie die Bots) vom Bot-Spawn zu jeder Stationskachel
for (const s of systems) for (const t of stationsOf(s)) {
  const path = botBfs(Maps.BOT_SPAWNS[0], (x, y) => shipWalk(x, y) && Math.abs(x - t.x) + Math.abs(y - t.y) === 1);
  check(!!path, `Bot-BFS zum System ${s} (${t.x},${t.y}): ${path ? path.length + ' Schritte' : 'kein Weg'}`);
}

// Räume (SHIP_ROOMS / roomAt): jede begehbare Schiffskachel liegt in einem Raum; Quartiere passen zu BEDS
{
  let uncovered = [];
  for (let y = 0; y < ship.h; y++) for (let x = 0; x < ship.w; x++) if (!ship.solid(x, y) && !Maps.roomAt(x, y)) uncovered.push(`(${x},${y})`);
  check(uncovered.length === 0, 'roomAt deckt jede begehbare Schiffskachel ab' + (uncovered.length ? ' – fehlt: ' + uncovered.slice(0, 8).join(' ') : ''));
  check(new Set(Maps.SHIP_ROOMS.map((r) => r.id)).size === Maps.SHIP_ROOMS.length, 'Raum-IDs eindeutig');
  for (const r of Maps.SHIP_ROOMS) check(typeof r.name === 'string' && r.name.length > 0 && [-1, 0, 1, 2, 3].includes(r.sector), `Raum ${r.id}: Name und Sektor gesetzt`);
  for (const b of Maps.BEDS) {
    const r = Maps.roomAt(b.x, b.y);
    check(!!r && r.kind === 'quarter' && r.id === b.room.id, `Koje ${b.room.id} liegt im Quartier-Raum ${b.room.id}`);
  }
}

// ---------- PAN-01 B: Modulräume (Unterdeck), Frachtbuchten und -betten ----------
{
  console.log('\n[PAN-01 B Modulräume]');
  const rooms = Maps.MODUL_RAEUME.map((m) => Maps.SHIP_ROOMS.find((r) => r.id === m.room));
  check(rooms.length === 4 && rooms.every((r) => r && r.kind === 'modul' && r.deck === 2), 'vier Modulräume auf dem Unterdeck (kind modul)');
  const tilesOf = (r) => { const out = []; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push({ x, y, ch: ship.at(x, y) }); return out; };
  const area = rooms.map((r) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1));
  check(area.every((a) => a === area[0]) && area[0] >= 20, `alle vier Modulräume gleich groß: ${area.join(' = ')} Kacheln (Raster ${rooms[0].x1 - rooms[0].x0 + 1} × ${rooms[0].y1 - rooms[0].y0 + 1})`);
  const count = (r, ch) => tilesOf(r).filter((t) => t.ch === ch).length;
  const floors = rooms.map((r) => tilesOf(r).filter((t) => !ship.solid(t.x, t.y)).length);
  check(floors.every((f) => f === floors[0]) && rooms.every((r) => count(r, 'q') === 2 && count(r, 'r') === 2 && count(r, 'h') === 1), `gleiche Ausstattung je Raum: ${floors[0]} Bodenkacheln, je 2 Plätze A (q), 2 Plätze B (r), 1 Platz C (h)`);
  // gleiche Lage der Plätze im Raum (relativ, Backbordräume gegen Steuerbordräume gespiegelt)
  const rel = (r) => tilesOf(r).filter((t) => 'qrh'.includes(t.ch)).map((t) => `${t.ch}${t.x - r.x0},${rooms[0].y1 - rooms[0].y0 - (t.y - r.y0)}`).sort().join(' ');
  const relFlip = (r) => tilesOf(r).filter((t) => 'qrh'.includes(t.ch)).map((t) => `${t.ch}${t.x - r.x0},${t.y - r.y0}`).sort().join(' ');
  const bb = rooms.filter((r) => r.sector === 3), stb = rooms.filter((r) => r.sector === 1);
  check(bb.length === 2 && stb.length === 2 && bb.every((r) => relFlip(r) === relFlip(bb[0])) && stb.every((r) => rel(r) === relFlip(bb[0])), 'Plätze liegen in allen vier Räumen an derselben Stelle (Steuerbord gespiegelt)');
  Maps.MODUL_RAEUME.forEach((m, i) => check(m.raum === i + 1, `Modulraum ${m.raum} = ${m.room}`));
  check(Maps.CARGO_BAYS.length === 8 && Maps.CARGO_BEDS.length === 8, '8 Frachtbuchten und 8 Frachtbetten (2 je Raum)');
  for (const m of Maps.MODUL_RAEUME) {
    const r = Maps.SHIP_ROOMS.find((q) => q.id === m.room);
    for (const [list, ch, what] of [[Maps.CARGO_BAYS, 'q', 'Bucht'], [Maps.CARGO_BEDS, 'r', 'Bett']]) {
      const mine = list.filter((b) => b.raum === m.raum);
      check(mine.length === 2 && mine.every((b) => ship.at(b.x, b.y) === ch && Maps.roomAt(b.x, b.y) === r && !ship.solid(b.access.x, b.access.y) && Math.abs(b.access.x - b.x) + Math.abs(b.access.y - b.y) <= 1 && Maps.roomAt(b.access.x, b.access.y) === r), `Raum ${m.raum}: zwei ${what}en mit freiem Zugang im Raum`);
      for (const b of mine) check(hasAccess(ship, shipSet, b), `Raum ${m.raum}: ${what} ${b.id} erreichbar (voll ausgebaut)`);
    }
  }
  check(Maps.cargoBayAt(22, 33) && !Maps.cargoBayAt(23, 33) && Maps.cargoBedAt(22, 35), 'cargoBayAt / cargoBedAt');
  // Kapazität je Frachtraum: 2 Plätze, mehrfach möglich
  check(Maps.cargoCapacity([]) === 0 && Maps.cargoCapacity([1]) === 2 && Maps.cargoCapacity([1, 3]) === 4 && Maps.cargoCapacity([1, 2, 4]) === 6 && Maps.cargoCapacity([1, 2, 3, 4]) === 8, 'cargoCapacity = 2 je Frachtraum (0, 2, 4, 6, 8)');
  const fp = Maps.frachtPlaetze([3, 1]);
  check(fp.bays.length === 4 && fp.beds.length === 4 && fp.bays.map((b) => b.raum).join() === '1,1,3,3', 'frachtPlaetze: Buchten und Betten der Frachträume, nach Raum sortiert');
  check(window_codeFracht() === 'f', "Modulcode des Frachtraums 'f' (CONFIG.module.codes)");
}
function window_codeFracht() { return CONFIG.module.codes.frachtraum; }

// ---------- M1: Schiff ----------
check(Maps.SHIP_ROWS.every((r) => r.length === ship.w) && ship.h === Maps.SHIP_ROWS.length, `Schiff ${ship.w}×${ship.h} (aus SHIP_ROWS)`);
check(Maps.BEDS.length === 4 && Maps.BEDS.map((b) => b.color).sort().join() === '0,1,2,3', '4 Quartiere (Farben 0–3, 3 = Quartier des 4. Spielers)');
for (const b of Maps.BEDS) {
  check(b.slots.length === 4, `Quartier ${b.room.id}: 4 Deko-Slots`);
  for (const sl of b.slots) check(sl.x >= b.room.x0 && sl.x <= b.room.x1 && sl.y >= b.room.y0 && sl.y <= b.room.y1, `Slot ${sl.id} liegt im Raum ${b.room.id}`);
  check(b.x >= b.room.x0 && b.x <= b.room.x1 && b.y >= b.room.y0 && b.y <= b.room.y1, `Koje ${b.room.id} liegt im Raum`);
  const w = b.room.x1 - b.room.x0 + 1, h = b.room.y1 - b.room.y0 + 1;
  check(w * h >= 18 && w > 3 && h >= 3, `Quartier ${b.room.id} ist ${w}×${h} (deutlich größer als 3×3)`);
  let spind = 0; for (let y = b.room.y0; y <= b.room.y1; y++) for (let x = b.room.x0; x <= b.room.x1; x++) if (ship.info(x, y).kind === 'locker') spind++;
  check(spind === 1, `Quartier ${b.room.id}: ein Spind`);
}
for (const sw of Maps.REACTOR_SWITCHES) {
  check(ship.info(sw.x, sw.y).interact === 'switch', `Reaktorschalter ${sw.id} (${sw.x},${sw.y}) ist ein Schalter`);
  check(hasAccess(ship, shipSet, sw), `Reaktorschalter ${sw.id} erreichbar (Spieler und Schrauber)`);
  const path = botBfs(Maps.BOT_SPAWNS[0], (x, y) => shipWalk(x, y) && Math.abs(x - sw.x) + Math.abs(y - sw.y) === 1);
  check(!!path, `Bot-BFS zu Schalter ${sw.id}: ${path ? path.length + ' Schritte' : 'kein Weg'}`);
}
const planTiles = interactive.filter((t) => t.info.console === 'plan');
check(planTiles.length === 4, 'Planungstisch ist 2×2');
check(planTiles.filter((t) => hasAccess(ship, shipSet, t)).length >= 3, 'Planungstisch von mehreren Seiten erreichbar (3 Plätze)');
for (const sp of Maps.SHIP_SPAWNS) check(shipSet.has(sp.y * ship.w + sp.x), `Spieler-Spawn (${sp.x},${sp.y}) im Hauptbereich`);

// ---------- M0: Maschinenräume (SHIP_ROOMS mit kind 'engine') ----------
{
  const DECO_KINDS = ['pipes', 'workbench', 'control_desk', 'barrel'];
  const engineRooms = Maps.SHIP_ROOMS.filter((r) => r.kind === 'engine');
  check(engineRooms.length >= 1, `Maschinenräume laut SHIP_ROOMS: ${engineRooms.map((r) => r.id).join(', ')}`);
  for (const r of engineRooms) {
    const tiles = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (Maps.roomAt(x, y) === r) tiles.push({ x, y });
    const decoCount = tiles.filter((t) => DECO_KINDS.includes(ship.info(t.x, t.y).kind)).length;
    check(decoCount <= 8, `${r.name}: ${decoCount} solide Kulissen-Kacheln (max. 8)`);
    const floors = tiles.filter((t) => !ship.solid(t.x, t.y));
    check(floors.length > 0 && floors.every((t) => shipSet.has(t.y * ship.w + t.x)), `${r.name}: alle ${floors.length} Bodenkacheln erreichbar (Gang frei)`);
    // Tür: eine Tür-Kachel im Raum oder direkt am Rand
    let door = null;
    for (let y = r.y0 - 1; y <= r.y1 + 1 && !door; y++) for (let x = r.x0 - 1; x <= r.x1 + 1; x++) if (ship.info(x, y).kind === 'door') { door = { x, y }; break; }
    check(!!door && shipSet.has(door.y * ship.w + door.x), `${r.name}: Tür ${door ? `(${door.x},${door.y})` : '—'} frei`);
    for (const t of interactive.filter((q) => q.info.system && Maps.roomAt(q.x, q.y) === r)) {
      check(hasAccess(ship, shipSet, t), `${r.name}: '${t.ch}' ${t.info.system} (${t.x},${t.y}) von mind. einer Seite erreichbar`);
    }
  }
  for (const ch of shipChars) {
    const info = shipLegend[ch];
    if (info && DECO_KINDS.includes(info.kind)) check(!!info.solid, `Legende: '${ch}' (${info.kind}) solid`);
  }
}

// ---------- M3a: neue Lerche (CONTRACT-M3 §2, §14), PAN-01 B ----------
{
  console.log('\n[M3a Lerche]');
  const Protocol = require('../shared/protocol.js');
  check(ship.w === 40 && ship.h === 45, `Lerche (PAN-01-B-Atlas) 40×45 (ist ${ship.w}×${ship.h})`);
  check(shipLegend !== Maps.LEGEND && shipLegend === Maps.SHIP_LEGEND, 'Schiffskarte nutzt die eigene Legende SHIP_LEGEND');
  // 19 Stationen = Protocol.SYSTEMS ohne den Altnamen 'weapons' (die Lebenserhaltung ist gestrichen; PAN-01 C: die sechs Lafetten sind echte Systeme)
  const want = Protocol.SYSTEMS.filter((s) => s !== 'weapons');
  check(want.length === 19, `Protocol.SYSTEMS: 19 Systeme ohne Altname weapons (${want.length}; 13 + Lafetten 5 7 9 1 3 2)`);
  check(!systems.includes('weapons') && !systems.includes('life') && !Protocol.SYSTEMS.includes('life'), 'Altname weapons und Lebenserhaltung haben keine Station mehr');
  check(want.every((s) => systems.includes(s)) && systems.every((s) => want.includes(s)), 'Stationen auf der Karte = 19 Systeme laut Protokoll' +
    (want.filter((s) => !systems.includes(s)).length ? ' – fehlt: ' + want.filter((s) => !systems.includes(s)).join(',') : ''));
  const SIDE_OF_SECTOR = { 0: 'bow', 1: 'stbd', 2: 'aft', 3: 'port', '-1': 'mid' };
  const EXPECT = { weapon_bow: 0, emitter_bow: 0, thruster_port: 3, battery_port: 3, emitter_port: 3, thruster_stbd: 1, battery_stbd: 1,
    emitter_stbd: 1, reactor: -1, shields: -1, engines: 2, emitter_aft: 2, transfer: 1,
    lafette_5: 0, lafette_7: 3, lafette_9: 1, lafette_1: 3, lafette_3: 1, lafette_2: 2 };   // PAN-01 C: Lafetten (Sektor des Platzes, WAFFENPLAETZE)
  for (const s of want) {
    const st = stationsOf(s);
    for (const t of st) {
      const i = t.info;
      check(i.system === s && [-1, 0, 1, 2, 3].includes(i.sector) && Protocol.SIDES.includes(i.side), `Station ${s} (${t.x},${t.y}): system, sector ${i.sector}, side ${i.side}`);
      check(i.sector === EXPECT[s], `Station ${s}: Sektor laut Vertrag (${EXPECT[s]})`);
      // Seite passt zum Sektor (Ausnahme Transfer: Sektor 1, Seite stbd)
      check(i.side === SIDE_OF_SECTOR[i.sector], `Station ${s}: Seite ${i.side} passt zu Sektor ${i.sector}`);
      check(hasAccess(ship, shipSet, t), `Station ${s} von einer begehbaren Nachbarkachel erreichbar`);
      check(i.solid && (i.interact === 'system' || (/^lafette_/.test(s) && i.interact === 'lafette')), `Station ${s}: solid + interact system (Lafetten: interact lafette)`);
    }
  }
  // Emitter je Sektor (§4.2): 0 bow, 1 stbd, 2 aft, 3 port – und jeweils im eigenen Sektor
  ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'].forEach((e, i) => {
    check(stationsOf(e).length >= 1 && stationsOf(e).every((t) => t.info.sector === i), `Emitter für Sektor ${i}: ${e}`);
  });
  // Jeder Sektor 0–3: Bodenkacheln und mindestens eine Station (Treffer -> Systemschaden möglich)
  for (let i = 0; i < 4; i++) {
    const r = Maps.SECTOR_REGIONS[i];
    let floors = 0;
    for (let y = 0; y < ship.h; y++) for (let x = 0; x < ship.w; x++) if (!ship.solid(x, y) && r.test(x, y)) floors++;
    const st = want.filter((s) => stationsOf(s).some((t) => t.info.sector === i));
    check(floors > 0 && st.length >= 1, `Sektor ${i} (${r.name}): ${floors} Bodenkacheln, Stationen ${st.join(',')}`);
    check(st.every((s) => r.systems.includes(s)), `SECTOR_REGIONS[${i}].systems enthält alle Stationen des Sektors`);
    check(!r.systems.some((s) => EXPECT[s] === -1), `SECTOR_REGIONS[${i}]: kein Mittschiffs-System`);
  }
  // Schildsektoren gelten für Mittel- und Unterdeck gemeinsam (Treffer kann eine Batterie oben oder ein Modul/eine Lafette unten treffen)
  for (let i = 0; i < 4; i++) {
    const decks = new Set();
    for (let y = 0; y < ship.h; y++) for (let x = 0; x < ship.w; x++) if (!ship.solid(x, y) && Maps.SECTOR_REGIONS[i].test(x, y)) decks.add(Maps.deckOf(y));
    // Heck (Sektor 2): das Unterdeck hat kein Heck, der Antriebsraum liegt auf dem Mitteldeck
    check(decks.has(0) && decks.has(2) === (i !== 2) && !decks.has(1), `Sektor ${i} (${Maps.SECTOR_NAMES[i]}) umfasst das Mitteldeck${i !== 2 ? ' und das Unterdeck' : ' (Unterdeck ohne Heck)'}, nicht das Oberdeck (${[...decks].sort().join(',')})`);
  }
  // Mittschiffs-Systeme liegen in Räumen mit Sektor -1 (alle beide im Maschinenraum)
  for (const s of ['reactor', 'shields']) {
    check(stationsOf(s).every((t) => { const r = Maps.roomAt(t.x, t.y); return r && r.sector === -1 && r.id === 'maschinenraum'; }), `${s} liegt im Maschinenraum (mittschiffs)`);
  }
  check(Maps.roomAt(17, 3) && Maps.roomAt(17, 3).id === 'maschinenraum' && Maps.roomAt(1, 6).id === 'antrieb', 'Maschinenraum mittschiffs, Antriebsraum am Heck');
  // Schalter A↔B: beide erreichbar, Weg ≤ 14 Kacheln (Vertrag: 12)
  const [swA, swB] = ['A', 'B'].map((id) => Maps.REACTOR_SWITCHES.find((s) => s.id === id));
  check(!!swA && !!swB, 'Reaktorschalter A und B vorhanden');
  if (swA && swB) {
    const accA = W_access(swA), accB = W_access(swB);
    check(accA.length > 0 && accB.length > 0, `Schalter A (${swA.x},${swA.y}) und B (${swB.x},${swB.y}) haben begehbare Nachbarkacheln`);
    let best = null;
    for (const a of accA) {
      const path = bfs(shipWalk, a, (x, y) => accB.some((b) => b.x === x && b.y === y), ship.w, ship.h);
      if (path && (best === null || path.length < best)) best = path.length;
    }
    check(best !== null && best <= 14, `Weg Schalter A↔B: ${best} Kacheln (≤ 14)`);
  }
  // Brücke: alle drei Brückenkonsolen im Raum bruecke
  for (const c of ['helm', 'captain', 'weapons']) {
    const t = interactive.find((q) => q.info.console === c);
    check(!!t && Maps.roomAt(t.x, t.y) && Maps.roomAt(t.x, t.y).id === 'bruecke', `Konsole ${c} liegt auf der Brücke`);
  }
  // Regale: Reihenfolge laut §2.3, Zugang y2
  check(Maps.SHELF_TILES.map((s) => s.item).join() === 'ersatzteil,loeschgel,flickblech,bolzen,medipack', 'Regal-Reihenfolge Ersatzteil, Löschgel, Flickblech, Bolzen, Medipack');
  check(Maps.SHELF_TILES.every((s) => s.access && Maps.roomAt(s.access.x, s.access.y) && Maps.roomAt(s.access.x, s.access.y).id === 'lager'), 'Regal-Zugänge im Lager');
  // Spawns
  for (const s of Maps.SHIP_SPAWNS.concat(Maps.BOT_SPAWNS)) check(shipWalk(s.x, s.y), `Spawn (${s.x},${s.y}) auf Boden`);
  for (const s of Maps.IVO_SPOTS || []) check(shipWalk(s.x, s.y) && shipSet.has(s.y * ship.w + s.x), `Ivo-Wegpunkt (${s.x},${s.y}) begehbar und erreichbar`);
  // Übung: Feuer im Heckgang, Leck im Lager – beide auf dem Mitteldeck
  const dr = Maps.SHIP_DRILL;
  check(Maps.roomAt(dr.fire.x, dr.fire.y).id === 'heckgang' && Maps.roomAt(dr.breach.x, dr.breach.y).id === 'lager', 'SHIP_DRILL: Feuer im Heckgang, Leck im Lager');
  check(Maps.hazardAllowed(dr.fire.x, dr.fire.y, 0) && Maps.hazardAllowed(dr.breach.x, dr.breach.y, 0), 'SHIP_DRILL: Feuer und Leck dürfen dort entstehen');
  // Deko-Slots: im eigenen Quartier (roomAt) und begehbar
  for (const b of Maps.BEDS) for (const sl of b.slots) {
    const r = Maps.roomAt(sl.x, sl.y);
    check(!!r && r.id === b.room.id && shipWalk(sl.x, sl.y), `Deko-Slot ${sl.id} (${sl.x},${sl.y}) auf Boden im Raum ${b.room.id}`);
  }
}

// ---------- PAN-01 B: drei Decks (aus M4 „Zwei Decks“, CONTRACT-M4 §2.5) ----------
{
  console.log('\n[PAN-01 B Drei Decks]');
  const S = Maps.DECK_STRIDE;
  check(S === 16 && Maps.SHIP_DECKS.length === 3, `DECK_STRIDE 16, drei Decks (${Maps.SHIP_DECKS.map((d) => d.name).join(', ')})`);
  check(Maps.SHIP_ROWS.every((r) => r.length === 40), 'alle Atlas-Zeilen 40 lang');
  const gap = [];
  for (let y = 0; y < ship.h; y++) if (Maps.deckOf(y) < 0) gap.push(y);
  check(gap.join() === '13,14,15,29,30,31' && gap.every((y) => /^ +$/.test(Maps.SHIP_ROWS[y])), `Spaltzeilen ${gap.join(',')} leer (void)`);
  check(Maps.deckOf(0) === 0 && Maps.deckOf(12) === 0 && Maps.deckOf(16) === 1 && Maps.deckOf(28) === 1 && Maps.deckOf(32) === 2 && Maps.deckOf(44) === 2 && Maps.deckOf(14) === -1, 'deckOf: 0–12 Mitteldeck, 16–28 Oberdeck, 32–44 Unterdeck, Lücken −1');
  check(Maps.deckLocalY(21) === 5 && Maps.deckLocalY(5) === 5 && Maps.deckLocalY(37) === 5 && Maps.deckOfPx(21 * 32 + 5) === 1 && Maps.deckOfPx(37 * 32) === 2, 'deckLocalY / deckOfPx');
  check(Maps.SHIP_DECKS.map((d) => d.level).join() === '0,1,-1', 'Höhenlage: Mitteldeck 0, Oberdeck +1, Unterdeck −1 (Liftblende)');
  // Schächte auf allen drei Decks an derselben Stelle
  for (const l of Maps.SHIP_LIFTS) {
    check(l.tiles.length === 6 && [0, 1, 2].every((d) => l.tiles.every(([x, y]) => ship.at(x, y + d * S) === '^')), `Lift ${l.id}: 2×3 auf allen drei Decks`);
    check([0, 1, 2].every((d) => l.tiles.every(([x, y]) => Maps.liftAt(x, y + d * S) === l)), `liftAt erkennt Lift ${l.id} auf allen Decks`);
  }
  check(ship.find('^').length === Maps.SHIP_LIFTS.length * 6 * 3, 'keine Liftkachel ohne Eintrag in SHIP_LIFTS');
  check(Maps.SHIP_LADDERS.length === 1 && [0, 1, 2].every((d) => Maps.SHIP_LADDERS.every((l) => ship.at(l.x, l.y + d * S) === '!')), 'SHIP_LADDERS = eine Notleiter, auf allen drei Decks');
  check(ship.find('!').length === Maps.SHIP_LADDERS.length * 3, 'keine Notleiter ohne Eintrag in SHIP_LADDERS');
  check(Maps.SHIP_LADDERS[0].x === 17 && Maps.roomAt(Maps.SHIP_LADDERS[0].x, Maps.SHIP_LADDERS[0].y).id === 'maschinenraum' && Maps.roomAt(17, 22).id === 'meeting' && Maps.roomAt(17, 38).id === 'lafetten_mitte', 'Notleiter mittig im Maschinenraum, darüber der Meetingraum, darunter der Lafettenbereich');
  const mr = Maps.roomAt(17, 6);
  check(17 === (mr.x0 + mr.x1) / 2 && Maps.SHIP_LADDERS[0].y === 6, 'Notleiter liegt in der Mitte des Maschinenraums (x, Mittelachse y 6)');
  for (const ch of ['^', '!', ':']) check(!!shipLegend[ch] && !shipLegend[ch].solid, `Legende '${ch}' (${shipLegend[ch] && shipLegend[ch].kind}) begehbar`);
  for (const ch of ['w', '%', 't', 'a', 'v', 'o', 's', 'j', 'q', 'r', 'h', '0', '+', '1', '2', '3', '5', '7', '9']) check(!!shipLegend[ch] && shipLegend[ch].solid, `Legende '${ch}' (${shipLegend[ch] && shipLegend[ch].kind}) solid`);
  // Fahrziele: Lift und Notleiter fahren je ein Deck, mit Ausbau-Sperre
  const t1 = Maps.SHIP_LIFTS[0].tiles[0], t2 = Maps.SHIP_LIFTS[1].tiles[0], L = Maps.SHIP_LADDERS[0];
  const z = (x, y, dir, st) => Maps.fahrtZiel(x, y, dir, st);
  check(z(t1[0], t1[1], 1, 0).deck === 1 && z(t1[0], t1[1], -1, 0).deck === 2 && z(t1[0], t1[1] + 16, -1, 0).deck === 0 && !z(t1[0], t1[1] + 16, 1, 0) && z(t1[0], t1[1] + 32, 1, 0).deck === 0 && !z(t1[0], t1[1] + 32, -1, 0),
    'L1 fährt von Anfang an alle drei Decks (Oberdeck ↔ Mitteldeck ↔ Unterdeck, je ein Deck weiter)');
  check(z(t2[0], t2[1], 1, 0).deck === 1 && !z(t2[0], t2[1], -1, 0) && z(t2[0], t2[1], -1, 1).deck === 2 && !z(L.x, L.y, -1, 0) && z(L.x, L.y, -1, 1).deck === 2 && z(L.x, L.y + 32, 1, 0).deck === 0,
    'Hecklift L2 und Notleiter erreichen das Unterdeck erst mit Stufe 1 (hinauf immer)');
  check(z(L.x, L.y, 1, 0).via === 'ladder' && z(t1[0], t1[1], 1, 0).via === 'lift' && z(t1[0], t1[1], 1, 0).y === t1[1] + 16 && z(t1[0], t1[1], -1, 0).y === t1[1] + 32, 'Ziel = dieselbe lokale Kachel auf dem Nachbardeck, via lift | ladder');
  const o = Maps.fahrtOptionen(t1[0], t1[1], 0), o2 = Maps.fahrtOptionen(t1[0], t1[1] + 16, 0), o3 = Maps.fahrtOptionen(t1[0], t1[1] + 32, 0);
  check(o.up && o.down && !o2.up && o2.down && o3.up && !o3.down, 'fahrtOptionen zeigt nur mögliche Richtungen (Oberdeck nur runter, Unterdeck nur hoch)');
  check(Maps.deckLinks(t2[0], t2[1], { stufe: 0 }).length === 1 && Maps.deckLinks(t2[0], t2[1], { stufe: 1 }).length === 2 && Maps.deckLinks(L.x, L.y, { ladder: false }).length === 0 && Maps.deckLinks(L.x, L.y).length === 2, 'deckLinks: Stufe sperrt, Bots ohne Leiter');
  check(Maps.fahrtZiel(5, 6, 1, 3) === null && Maps.fahrtZiel(t1[0], 14, 1, 3) === null, 'außerhalb von Lift/Leiter und in der Lücke: kein Fahrziel');
  // L1 ist der einzige Eingang zur Brücke: ohne L1 kommt von keinem Spawn aus jemand auf die Brücke (auch über andere Decks nicht), mit L1 schon
  const br = Maps.SHIP_ROOMS.find((r) => r.id === 'bruecke');
  const lift1 = new Set(Maps.SHIP_LIFTS[0].tiles.map(([x, y]) => `${x},${y}`));
  const brTiles = [];
  for (let y = br.y0; y <= br.y1; y++) for (let x = br.x0; x <= br.x1; x++) if (shipWalk(x, y) && !lift1.has(`${x},${y}`)) brTiles.push({ x, y });
  const noL1 = (x, y) => shipWalk(x, y) && !(lift1.has(`${x},${y}`) && Maps.deckOf(y) === 0);
  const reachNoL1 = reachableSet(ship, noL1, Maps.SHIP_SPAWNS, deckLinks);
  check(brTiles.length > 80 && brTiles.every((t) => !reachNoL1.has(t.y * ship.w + t.x)), `Brücke (${brTiles.length} Bodenkacheln) ohne den Brückenlift von keinem Spawn erreichbar: L1 ist die einzige Brückentür`);
  check(brTiles.every((t) => shipSet.has(t.y * ship.w + t.x)), 'Brücke über L1 von allen Spawns erreichbar');
  const brWallDoors = []; for (let y = br.y0 - 1; y <= br.y1 + 1; y++) for (let x = br.x0 - 1; x <= br.x1 + 1; x++) if (ship.info(x, y).kind === 'door') brWallDoors.push(`(${x},${y})`);
  check(brWallDoors.length === 0, 'keine Tür in der Brückenwand');
  // Brücke symmetrisch zur Mittelachse (Zeile 6): Kachel für Kachel gespiegelt, Ops W und Captain C stehen einander gegenüber
  {
    const SPIEGEL = { W: 'C', C: 'W' };
    const bad = [];
    for (let y = 1; y <= 5; y++) for (let x = br.x0; x <= br.x1; x++) { const a = ship.at(x, y), b = ship.at(x, 12 - y); if ((SPIEGEL[a] || a) !== b) bad.push(`(${x},${y})${a}≠${b}`); }
    check(bad.length === 0, 'Brücke symmetrisch zur Mittelachse' + (bad.length ? ': ' + bad.slice(0, 5).join(' ') : ''));
    const h = interactive.find((q) => q.info.console === 'helm'), w = interactive.find((q) => q.info.console === 'weapons'), c = interactive.find((q) => q.info.console === 'captain');
    check(h.y === 6 && w.y + c.y === 12 && w.x === c.x, `Steuer auf der Mittelachse (y ${h.y}), Ops (y ${w.y}) und Captain (y ${c.y}) spiegelbildlich`);
    check(!interactive.some((t) => t.info.system && Maps.roomAt(t.x, t.y) && Maps.roomAt(t.x, t.y).id === 'bruecke'), 'Brücke ohne Systeme und Waffen (nichts zu reparieren)');
  }
  // Lifts und Leitern sind nicht beschädigbar: keine Station, kein Feuer, kein Leck, in keiner Stufe
  {
    const bad = [];
    for (let y = 0; y < ship.h; y++) for (let x = 0; x < ship.w; x++) {
      const k = ship.info(x, y).kind;
      if (k !== 'lift' && k !== 'ladder') continue;
      for (const st of [0, 1, 2, 3]) if (Maps.hazardAllowed(x, y, st)) bad.push(`(${x},${y})@${st}`);
      if (ship.info(x, y).system) bad.push(`Station (${x},${y})`);
    }
    check(bad.length === 0, 'Lift- und Leiterkacheln: nie Feuer/Leck, nie ein System' + (bad.length ? ': ' + bad.slice(0, 4).join(' ') : ''));
    const W = require('../server/world.js');
    check(W.STATIONS.every((s) => !['lift', 'ladder'].includes(ship.info(s.x, s.y).kind)), 'keine Station auf Lift oder Leiter (Reparatur-/Treffer-Auswahl kennt keinen Lift)');
  }
  // Räume: jeder Raum hat ein deck, liegt ganz in diesem Deck, überspannt die Lücke nicht
  for (const r of Maps.SHIP_ROOMS) {
    const d = Maps.SHIP_DECKS.find((q) => q.idx === r.deck);
    check(!!d && r.y0 >= d.y0 && r.y1 <= d.y1, `Raum ${r.id}: deck ${r.deck} (${d ? d.name : '—'}), Zeilen ${r.y0}–${r.y1} im Deck`);
    if (r.deck === 1) check(r.sector === -1, `Raum ${r.id} (Oberdeck): Sektor −1`);
  }
  // Oberdeck privat: nie Feuer/Leck; Mittel- und Unterdeck ja (außer Lift/Leiter, solide Kacheln)
  {
    let hazBad = [], hazN = [0, 0, 0];
    for (let y = 0; y < ship.h; y++) for (let x = 0; x < ship.w; x++) {
      if (!Maps.hazardAllowed(x, y, Maps.STUFE_MAX)) continue;
      const d = Maps.deckOf(y);
      hazN[d]++;
      if (d === 1 || ship.solid(x, y) || ['lift', 'ladder'].includes(ship.info(x, y).kind)) hazBad.push(`(${x},${y})`);
    }
    check(hazBad.length === 0 && hazN[0] > 50 && hazN[2] > 50 && hazN[1] === 0, `hazardAllowed: Mitteldeck ${hazN[0]}, Unterdeck ${hazN[2]}, Oberdeck ${hazN[1]} Kacheln; nie auf Lift/Leiter` + (hazBad.length ? ' – ' + hazBad.slice(0, 6).join(' ') : ''));
    const W = require('../server/world.js');
    for (const st of [0, 1, 2, 3]) {
      const lists = W.regionFloorsFor(st, false).concat(W.regionFloorsFor(st, true)).flat();
      const bad = lists.filter((t) => !Maps.hazardAllowed(t.x, t.y, st));
      check(bad.length === 0 && W.regionFloorsFor(st, false).every((l) => l.length > 0) && W.regionFloorsFor(st, true).every((l) => l.length > 0), `Feuer-/Leck-Kandidaten je Sektor bei Stufe ${st} (${W.regionFloorsFor(st, false).map((l) => l.length).join('/')}): nur offene Räume, nicht auf Lift/Leiter`);
    }
  }
  // Ivo bleibt auf dem Oberdeck: alle Ivo-Spots auf Deck 1 und untereinander OHNE Lift/Leiter erreichbar
  const ivoSet = reachableSet(ship, shipWalk, [Maps.IVO_SPOTS[0]]);
  check(Maps.IVO_SPOTS.every((s) => Maps.deckOf(s.y) === 1 && ivoSet.has(s.y * ship.w + s.x)), 'Ivo-Spots auf dem Oberdeck, ohne Lift erreichbar');
  check(Maps.roomAt(Maps.IVO_AUSSTIEG.x, Maps.IVO_AUSSTIEG.y).id === 'meeting' && ship.at(Maps.IVO_AUSSTIEG.x, Maps.IVO_AUSSTIEG.y - 1) === 'S', 'Ivo steigt unter der Handelskonsole im Meetingraum aus');
  check(Maps.nutzungAt(37, 27).includes('quartier') && ship.at(38, 27) === 'e', 'Ivos Schlafecke in der Messe (nutzung quartier)');
  // Oberdeck: vier Quartiere, Meetingraum mit Planungstisch und Handelskonsole, Messe mit Trophäen; Atrium, Liftvorraum, Trophäennische entfallen
  {
    const R = (id) => Maps.SHIP_ROOMS.find((r) => r.id === id);
    const inRoom = (r, ch) => { let n = 0; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (ship.at(x, y) === ch) n++; return n; };
    check(Maps.SHIP_ROOMS.filter((r) => r.kind === 'quarter').length === 4 && !['atrium', 'liftvorraum', 'lararium', 'krankenstation', 'frachtraum', 'vorraum'].some((id) => R(id)), 'Oberdeck: vier Quartiere; Atrium, Liftvorraum, Trophäennische, feste Krankenstation/Frachtraum entfallen');
    const mt = R('meeting'), ms = R('messe');
    check(inRoom(mt, 'Y') === 4 && inRoom(mt, 'S') === 1 && inRoom(mt, '!') === 1, 'Meetingraum: Planungstisch (2×2), Handelskonsole, Notleiter');
    check(inRoom(ms, 'S') === 0 && inRoom(ms, 't') >= 2 && inRoom(ms, 'j') === 1, 'Messe ohne Handelskonsole, mit Trophäen (t) und Anrichte');
    const q = Maps.SHIP_ROOMS.filter((r) => r.kind === 'quarter');
    const qx = q.map((r) => `${r.x0}-${r.x1}`);
    check(q.every((r) => r.x1 < mt.x0 || r.x0 > mt.x1) && q.filter((r) => r.x1 < mt.x0).length === 2 && q.filter((r) => r.x0 > mt.x1).length === 2, `Quartiere links und rechts vom Meetingraum (${qx.join(' ')})`);
    check(ms.x0 > mt.x1 && ms.x1 === Math.max(...Maps.SHIP_ROOMS.filter((r) => r.deck === 1).map((r) => r.x1)), 'Messe liegt am Bug');
  }
  // Unterdeck: Bugraum unter der Brücke (Lanze 8 ab Start, Platz 5), Lafetten in der Mitte (7/9, 1/3), Module 1/2 am Bugende, 3/4 am Heck
  {
    const R = (id) => Maps.SHIP_ROOMS.find((r) => r.id === id);
    const bug = R('bugraum'), bruecke = R('bruecke');
    check(bug.x0 === bruecke.x0 && bug.x1 === bruecke.x1 && bug.sector === 0 && stationsOf('weapon_bow').every((t) => Maps.roomAt(t.x, t.y) === bug) && stationsOf('emitter_bow').every((t) => Maps.roomAt(t.x, t.y) === bug), 'Bugraum unter der Brücke: Lanze (weapon_bow) und Bug-Emitter');
    const lb = R('lafetten_bb'), ls = R('lafetten_stb'), mm = R('maschinenraum');
    check(lb.x0 === mm.x0 && lb.x1 === mm.x1 && ls.x0 === mm.x0, 'Lafetten liegen mittig unter dem Maschinenraum');
    check(R('modul1').x0 > lb.x1 && R('modul2').x0 > lb.x1 && R('modul3').x1 < lb.x0 && R('modul4').x1 < lb.x0, 'Modulräume 1 und 2 zum Bug, 3 und 4 zum Heck hin');
    check(R('modul1').x0 > mm.x1 && R('modul1').x1 < bug.x0, 'Modulräume 1 und 2 am Bugende, direkt am Lift');
    check(Maps.SHIP_ROWS.slice(32, 45).every((r) => /^ {6}#/.test(r)), 'Unterdeck ohne Heck: westlich von x 6 nichts');
  }
  // Laufzeiten vom Captain-Platz (BFS, 3 Kacheln/s; Lift = CONFIG.lift.rideTime, Notleiter = CONFIG.lift.ladderTime) – Messwerte der Studioleitung §2.5, neu gemessen für PAN-01 B.
  // Vorgänger (Stand SL0/UI-Sitz, Schiff 37×13): Lanze 2,7 · Batterie Bb 4,7 · Düse Stb 5,7 · Reaktor 6,7 · Triebwerk 9,7 · Regal 1 10,0 · Heck-Emitter 11,0 · Quartier 1 9,2 + Lift.
  // Das Mitteldeck ist fast unverändert (alle Wege der Reparatur liegen innerhalb ±1,5 s der alten Werte); die Lanze liegt jetzt im Bugraum unter der Brücke (Lift hinunter).
  {
    const speed = CONFIG.player.speed / 32;
    const links = (x, y) => Maps.deckLinks(x, y);
    const cap = interactive.find((t) => t.info.console === 'captain');
    const seat = W_access(cap).sort((a, b) => a.x - b.x || a.y - b.y)[0];
    const timeTo = (goalFn) => {
      const path = bfs(shipWalk, seat, goalFn, ship.w, ship.h, null, links);
      if (!path) return null;
      let walk = 0, ride = 0;
      for (const s of path) { if (s.via === 'lift') ride += CONFIG.lift.rideTime; else if (s.via === 'ladder') ride += CONFIG.lift.ladderTime; else walk++; }
      return { s: walk / speed + ride, walk, ride };
    };
    const nearSys = (sys) => (x, y) => shipWalk(x, y) && stationsOf(sys).some((t) => Math.abs(x - t.x) + Math.abs(y - t.y) === 1);
    const shelf1 = Maps.SHELF_TILES[0];
    const bed0 = Maps.BEDS[0];
    // [Name, Ziel, Vertrag neu, Wert davor (null = Wegstruktur neu)]
    const TARGETS = [['Lanze', nearSys('weapon_bow'), 6.8, null], ['Batterie Bb', nearSys('battery_port'), 4.7, 4.7], ['Düse Stb', nearSys('thruster_stbd'), 4.7, 5.7],
      ['Reaktor', nearSys('reactor'), 6.3, 6.7], ['Triebwerk', nearSys('engines'), 10.7, 9.7], ['Regal 1', (x, y) => x === shelf1.access.x && y === shelf1.access.y, 9.7, 10.0],
      ['Heck-Emitter', nearSys('emitter_aft'), 12.0, 11.0], ['Quartier 1', (x, y) => shipWalk(x, y) && Math.abs(x - bed0.x) + Math.abs(y - bed0.y) === 1, 12.3, null]];
    const parts = [];
    for (const [name, fn, want, vorher] of TARGETS) {
      const r = timeTo(fn);
      parts.push(`${name} ${r ? r.s.toFixed(1) + ' s' + (r.ride ? ' (inkl. Fahrt)' : '') : '—'}`);
      check(!!r && Math.abs(r.s - want) <= 0.5, `Laufzeit Captain-Platz (${seat.x},${seat.y}) → ${name}: ${r ? r.s.toFixed(1) : '—'} s (Vertrag ${want.toFixed(1)} s ±0,5)`);
      if (vorher != null) check(!!r && Math.abs(r.s - vorher) <= 1.5, `${name}: Reparaturweg wie zuvor (${r ? r.s.toFixed(1) : '—'} s gegen ${vorher.toFixed(1)} s, ±1,5 s)`);
    }
    console.log('  info Laufzeiten (BFS, 3 Kacheln/s): ' + parts.join(' · '));
    // Alle Systeme gegen den Stand vor PAN-01 B (Laufweg vom Captain-Platz zur Station, gemessen auf dem alten Schiff 37×13). Mitteldeck-Ziele ±1,5 s;
    // die Bugraum-Ziele (Lanze, Bug-Emitter) liegen jetzt unter der Brücke (Lift hinunter) und sind eine bewusste Ausnahme (gemessen +3,8 s Bug-Emitter, +4,8 s Lanze); die Heck-Ziele liegen wegen des längeren Schiffs bis +1,7 s darüber.
    const ALT = { weapon_bow: [2.0, 'Bugraum', 4.9], emitter_bow: [2.0, 'Bugraum', 4.9], emitter_stbd: [5.0], emitter_port: [5.0], battery_stbd: [4.0], battery_port: [4.0], shields: [6.0], transfer: [9.3],
      thruster_port: [5.0], thruster_stbd: [5.0], reactor: [6.0], engines: [9.0, 'Heck, Schiff 3 Kacheln länger', 2.0], emitter_aft: [10.3, 'Heck, Schiff 3 Kacheln länger', 2.0] };
    const alleSys = [];
    for (const [sys, [alt, ausnahme, grenze]] of Object.entries(ALT)) {
      const r = timeTo(nearSys(sys));
      alleSys.push(sys + ' ' + (r ? r.s.toFixed(1) : '—') + (ausnahme ? '*' : ''));
      if (!ausnahme) check(!!r && Math.abs(r.s - alt) <= 1.5, `Reparaturweg ${sys}: ${r ? r.s.toFixed(1) : '—'} s gegen ${alt.toFixed(1)} s (Mitteldeck-Ziel, ±1,5 s)`);
      else check(!!r && r.s > alt && r.s <= alt + grenze, `Reparaturweg ${sys}: ${r ? r.s.toFixed(1) : '—'} s gegen ${alt.toFixed(1)} s – bewusste Ausnahme (${ausnahme}, höchstens +${grenze.toFixed(1)} s)`);
    }
    console.log('  info alle Systeme (Neuwert, * = Bugraum-Ausnahme): ' + alleSys.join(' · '));
    const lz = {}; for (const [name, fn] of TARGETS) lz[name] = timeTo(fn).s;
    check(lz['Batterie Bb'] < lz['Reaktor'] && lz['Reaktor'] < lz['Triebwerk'] && lz['Triebwerk'] < lz['Heck-Emitter'] && lz['Lanze'] < lz['Triebwerk'], 'Reihenfolge der Laufwege: Batterie < Maschinenraum < Antrieb, Lanze (Lift hinunter) näher als der Antrieb');
  }
}

// ---------- PAN-01 B: Ausbau (Stufen 0–3), Pforten und Waffenplätze ----------
{
  console.log('\n[PAN-01 B Ausbau]');
  const P = Maps.WAFFENPLAETZE;
  check(P.length === 9 && new Set(P.map((p) => p.platz)).size === 9 && [1, 2, 3, 4, 5, 6, 7, 8, 9].every((n) => P.some((p) => p.platz === n)), 'neun Waffenplätze 1–9 (Ziffernblock)');
  const SOLL = { 0: [8, 4, 6], 1: [8, 4, 6, 7, 9], 2: [8, 4, 6, 7, 9, 2, 5], 3: [8, 4, 6, 7, 9, 2, 5, 1, 3] };
  for (const st of [0, 1, 2, 3]) check([...Maps.plaetzeOffen(st)].sort().join() === [...SOLL[st]].sort().join() && Maps.plaetzeOffen(st).length === [3, 5, 7, 9][st], `Stufe ${st}: ${[3, 5, 7, 9][st]} Waffen (Plätze ${SOLL[st].join(' ')})`);
  check([0, 1, 2, 3].map((st) => Maps.modulRaeumeOffen(st).length).join() === '2,3,4,4' && Maps.modulRaeumeOffen(0).join() === '1,2' && Maps.modulRaeumeOffen(1).join() === '1,2,3' && Maps.modulRaeumeOffen(2).join() === '1,2,3,4', 'Module 2 → 3 → 4: Raum 3 mit Stufe 1, Raum 4 mit Stufe 2');
  for (const p of P) {
    const ch = ship.at(p.x, p.y), info = ship.info(p.x, p.y);
    const ok = p.system && (info.system === p.system || (info.interact === 'lafette' && info.platz === p.platz));
    check(!!ok && info.solid && Maps.waffenplatzAt(p.x, p.y) === p, `Platz ${p.platz} (${p.art}, Stufe ${p.stufe}): Lafette '${ch}' bei (${p.x},${p.y})`);
    check(hasAccess(ship, shipSet, p), `Platz ${p.platz}: Lafette erreichbar (voll ausgebaut)`);
    const r = Maps.roomAt(p.x, p.y);
    check(r && (r.sector === p.sector || r.sector === -1) && (p.sector === (info.sector != null ? info.sector : p.sector)), `Platz ${p.platz}: Raum ${r && r.id}, Sektor ${p.sector}`);
  }
  check(P.filter((p) => p.art === 'bug').length === 2 && P.filter((p) => p.art === 'heck').length === 1 && P.filter((p) => p.art === 'seite').length === 6, 'Plätze: 2 Bug (8, 5), 1 Heck (2), 6 Seite (4 6 7 9 1 3)');
  check(P.find((p) => p.platz === 2).stufe === 2 && Maps.roomAt(P.find((p) => p.platz === 2).x, P.find((p) => p.platz === 2).y).id === 'antrieb', 'Heckwaffe 2 im Antriebsraum (Stufe 2)');
  check(['8', '5'].every((n) => Maps.roomAt(P.find((p) => p.platz === +n).x, P.find((p) => p.platz === +n).y).id === 'bugraum'), 'beide Bugwaffen (8, 5) im Bugraum');
  check(Maps.ANDOCKPUNKTE.length === 4 + 9 && ['bug', 'triebwerk', 'banner_bb', 'banner_stb'].every((id) => Maps.ANDOCKPUNKTE.some((a) => a.id === id)) && Maps.ANDOCKPUNKTE.filter((a) => a.art === 'lafette').length === 9, 'Andockpunkte der Optik: Bug, Triebwerk, Banner, 9 Lafetten (nur Daten)');
  // Pforten
  check(Maps.SHIP_SEALS.length === 3 && Maps.SHIP_SEALS.every((s) => ship.at(s.x, s.y) === '+' && Maps.deckOf(s.y) === 2) && ship.find('+').length === 3, 'drei verschalte Pforten (+) auf dem Unterdeck, jede mit Eintrag in SHIP_SEALS');
  check(Maps.sealOpen(10, 36, 0) === false && Maps.sealOpen(10, 36, 1) === true && Maps.sealOpen(10, 40, 1) === false && Maps.sealOpen(10, 40, 2) === true && Maps.sealOpen(20, 38, 0) === false && Maps.sealOpen(20, 38, 1) === true && Maps.sealOpen(5, 5, 0) === true, 'Pforten: Modulraum 3 und Lafettenbereich mit Stufe 1, Modulraum 4 mit Stufe 2');
  // Erreichbarkeit je Stufe (alle Spawns, Spieler mit Leiter): offene Räume und Stationen erreichbar, verschlossene nicht
  for (const st of [0, 1, 2, 3]) {
    const walk = walkAtStufe(st);
    const links = (x, y) => Maps.deckLinks(x, y, { stufe: st });
    const blinks = (x, y) => Maps.deckLinks(x, y, { stufe: st, ladder: false });
    const set = reachableSet(ship, walk, Maps.SHIP_SPAWNS, links);
    const bset = reachableSet(ship, walk, Maps.BOT_SPAWNS, blinks);
    const roomReach = (id, s) => { const r = Maps.SHIP_ROOMS.find((q) => q.id === id); let n = 0, m = 0; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (walk(x, y) && Maps.roomAt(x, y) === r) { n++; if (s.has(y * ship.w + x)) m++; } return n === 0 ? null : m === n; };
    const offen = Maps.modulRaeumeOffen(st);
    const mod = Maps.MODUL_RAEUME.map((m) => roomReach(m.room, set));
    check(Maps.MODUL_RAEUME.every((m, i) => mod[i] === offen.includes(m.raum)), `Stufe ${st}: Modulräume ${offen.join(', ')} begehbar, die übrigen verschlossen (${mod.map((x) => (x ? 'ja' : 'nein')).join(' ')})`);
    const bmod = Maps.MODUL_RAEUME.map((m) => roomReach(m.room, bset));
    check(Maps.MODUL_RAEUME.every((m, i) => bmod[i] === offen.includes(m.raum)), `Stufe ${st}: auch die Schrauber (nur Lift) kommen in die offenen Modulräume`);
    const laf = ['lafetten_bb', 'lafetten_stb'].map((id) => roomReach(id, set));
    check(laf.every((x) => x === (st >= 1)), `Stufe ${st}: Lafettenbereich ${st >= 1 ? 'offen' : 'verschlossen'}`);
    // Stationen und Lafetten: erreichbar, wo der Raum offen ist
    const bad = [];
    for (const t of interactive) {
      if (t.info.interact === 'lift' || t.info.interact === 'ladder') continue;
      const r = Maps.roomAt(t.x, t.y);
      const zu = r && r.stufe && st < r.stufe;
      const ok = hasAccess(ship, set, t);
      if (zu === ok && !(t.info.kind === 'pad')) bad.push(`${t.info.kind}(${t.x},${t.y}) ${zu ? 'erreichbar trotz zu' : 'unerreichbar'}`);
    }
    check(bad.length === 0, `Stufe ${st}: jede Station, Konsole und Lafette ist erreichbar, wenn ihr Raum offen ist, sonst nicht` + (bad.length ? ' – ' + bad.slice(0, 4).join('; ') : ''));
    const lanze = stationsOf('weapon_bow')[0];
    check(hasAccess(ship, set, lanze) && hasAccess(ship, bset, lanze), `Stufe ${st}: Lanze (Platz 8) im Bugraum immer erreichbar, auch für die Schrauber`);
    // Hecklift: ins Unterdeck erst mit Stufe 1
    const l2 = Maps.SHIP_LIFTS[1].tiles[0];
    check((Maps.fahrtZiel(l2[0], l2[1], -1, st) != null) === (st >= 1), `Stufe ${st}: Hecklift fährt ${st >= 1 ? 'auch' : 'noch nicht'} ins Unterdeck`);
    // Bots: nichts Unerreichbares
    const missing = Maps.SHIP_ROOMS.filter((r) => r.deck !== 1 && (!r.stufe || st >= r.stufe) && r.kind !== 'lift').filter((r) => { const x = roomReach(r.id, bset); return x === false; });
    check(missing.length === 0, `Stufe ${st}: alle offenen Räume auch mit Lift allein erreichbar (Reparaturwege)` + (missing.length ? ': ' + missing.map((r) => r.id).join(',') : ''));
  }
  // Hazards: bei Stufe 0 nichts in verschlossenen Räumen
  { let n = 0; for (let y = 32; y <= 44; y++) for (let x = 0; x < ship.w; x++) { const r = Maps.roomAt(x, y); if (r && r.stufe && Maps.hazardAllowed(x, y, 0)) n++; } check(n === 0, 'Stufe 0: in verschlossenen Räumen entstehen kein Feuer und kein Leck'); }
  { let n = 0; for (let y = 32; y <= 44; y++) for (let x = 0; x < ship.w; x++) { const r = Maps.roomAt(x, y); if (r && r.stufe && r.kind !== 'lift' && Maps.hazardAllowed(x, y, 3)) n++; } check(n > 0, 'Stufe 3: dort darf es wieder brennen'); }
}

function W_access(t) { return [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy })).filter((q) => !ship.solid(q.x, q.y)); }

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
// M3a: Hafen-Übung aus dem Schiffslayout (Maps.SHIP_DRILL; CONFIG.drill.fire/breach nur noch Altnamen)
const drill = Maps.SHIP_DRILL || (CONFIG.drill && { fire: CONFIG.drill.fire, breach: CONFIG.drill.breach });
for (const k of ['fire', 'breach']) {
  const t = drill && drill[k];
  check(!!t && !ship.solid(t.x, t.y) && shipSet.has(t.y * ship.w + t.x), `Übung ${k === 'fire' ? 'Feuer' : 'Leck'} ${t ? `(${t.x},${t.y})` : ''} auf erreichbarer Bodenkachel`);
}
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

// ---------- M1: Orte – Welle 0 (CONTRACT-B1 §1.2): verschoben nach tools/check-sektoren.js ----------

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
  // S1 (CONTRACT-S1 §4): Bereiche nicht leer, begehbar und von den Pads erreichbar (Gewölbe erst bei offenem Tor)
  const C = require('../shared/config.js');
  for (const [id] of Object.entries(Maps.MAP_AREAS.kesh)) {
    let n = 0, reach = 0;
    for (let y = 0; y < km.h; y++) for (let x = 0; x < km.w; x++) {
      if (!Maps.inArea('kesh', id, x, y) || km.solid(x, y)) continue;
      n++; if (os.has(y * km.w + x)) reach++;
    }
    check(n > 0 && reach > 0, `Bereich kesh.${id}: ${n} begehbare Kacheln, ${reach} erreichbar`);
  }
  check(Maps.MAP_AREAS.kesh.hof.cols[1] === C.missionM3.courtyardX && Maps.MAP_AREAS.kesh.halle.cols[0] === C.missionM3.hallX, 'kesh: hof/halle wie missionM3.courtyardX/hallX');
  check(['platform', 'wreck', 'kesh'].every((m) => Maps.MAP_OBJECTS[m] && Object.values(Maps.MAP_OBJECTS[m]).every((o) => o.zustaende.length >= 2)), 'MAP_OBJECTS: je Objekt mindestens zwei Zustände');
}

// ---------- B1 „Bühnen“ (CONTRACT-B1 §2, §3, §6.1, §11.3; Team BUEHNE) ----------
// Vokabular, Handkarten-Anker, Landepunkte, Module und Schablonen × Seeds 1..sweepSeeds.
// Inhaltsqualität der Kits (Modulfehler, Bestehensquote) ist bis zum Ende von Welle 1 nur Warnung; mit
// STRICT_BUEHNE=1 bzw. --strict wird sie zum Fehler (Abnahme). Fehlende Kits sind kein Fehler.
{
  const fs = require('fs');
  const path = require('path');
  const Buehne = require('../shared/buehne.js');
  const C = require('../shared/config.js');
  const Locations = require('../shared/locations.js');
  const STRICT = process.env.STRICT_BUEHNE === '1' || process.argv.includes('--strict');
  const dir = path.join(__dirname, '..', 'content', 'buehnen');
  const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  let warn = 0;
  const kit = (cond, text) => { if (STRICT) return check(cond, text); if (cond) console.log('  ok   ' + text); else { warn++; console.log('  WARNUNG ' + text); } return cond; };
  console.log('\n[B1 Vokabular]');
  const kach = json(path.join(dir, 'kacheln.json')), ank = json(path.join(dir, 'anker.json')), achsen = json(path.join(dir, 'achsen.json'));
  const zust = json(path.join(dir, 'zustaende.json'));
  check(kach.format === 'kacheln/1' && Object.keys(kach.zeichen).length >= 20, `kacheln.json (${Object.keys(kach.zeichen).length} Zeichen)`);
  check(Object.values(kach.zeichen).every((z) => ['begehbar', 'fest', 'tuer'].includes(z.kante)), 'jede Kachelart hat kante begehbar|fest|tuer');
  check(Object.values(kach.zeichen).every((z) => z.solid !== 'zustand' || (z.zustaende && z.begehbarIn && z.begehbarIn.every((q) => z.zustaende.includes(q)))), 'Zustandskacheln: begehbarIn ⊆ zustaende');
  check(ank.format === 'anker/1' && Object.keys(ank.rollen).length === 21, `anker.json (${Object.keys(ank.rollen).length} Rollen)`);
  check(Object.values(ank.rollen).every((r) => !r.halten || (C.anker.halten[r.halten] != null)), 'jede Halte-Interaktion hat CONFIG.anker.halten');
  check(zust.format === 'zustaende/1' && Object.keys(achsen.zustaende).every((z) => zust.zustaende[z]), 'zustaende.json deckt alle Zustände aus achsen.json');
  console.log('\n[B1 Handkarten-Anker]');
  for (const id of ['platform', 'wreck', 'kesh']) {
    const k = Buehne.hand(id);
    const pr = Buehne.pruefen(k);
    check(pr.ok, `hand(${id}) besteht pruefen${pr.ok ? '' : ': ' + pr.fehler.map((f) => f.code + ' ' + f.msg).join('; ')}`);
    check(k.anker.every((a) => ank.rollen[a.rolle]), `${id}: alle Rollen aus anker.json`);
    check(k.anker.every((a) => !a.alt || a.alt === 'pads' || (Maps.MAP_OBJECTS[id] && Maps.MAP_OBJECTS[id][a.alt]) || (id === 'platform' && a.alt === 'ivo') || (id === 'kesh' && a.alt === 'jammer')), `${id}: alt-Objekte existieren`);
    check(new Set(k.anker.map((a) => a.id)).size === k.anker.length, `${id}: Anker-IDs eindeutig`);
  }
  console.log('\n[B1 Landepunkte]');
  const lp = json(path.join(__dirname, '..', 'content', 'welt', 'landepunkte.json'));
  check(lp.format === 'landepunkte/1', 'landepunkte.json Format');
  const alle = []; for (const ort of Object.keys(lp.orte)) for (const e of lp.orte[ort]) alle.push(Object.assign({ ort }, e));
  const orteAllerKarten = new Set();
  { const Welt = require('../server/sim/welt.js'); for (const id of Welt.ids()) for (const h of Object.values(Welt.karte(id).hexe)) if (h.ort) orteAllerKarten.add(h.ort); }
  check(new Set(alle.map((e) => e.id)).size === alle.length, `${alle.length} Landepunkte, IDs eindeutig`);
  for (const h of ['platform', 'wreck', 'kesh']) check(alle.some((e) => e.id === h && e.art === 'hand'), `Handkarte ${h} als Landepunkt (art hand)`);
  for (const e of alle) {
    const okArt = e.art === 'hand' ? !!Maps[e.id] : !!achsen.kartenarten[e.art];
    const okAchsen = e.art === 'hand' || (achsen.bauweisen[e.bauweise] && achsen.besitz[e.besitz] && achsen.zustaende[e.zustand]);
    // SL1: Orte weiterer Karten (content/welt/<karte>.json, z. B. kantenstein auf Sund) zählen, auch wenn Limes aktiv ist
    const okOrt = !!Locations.get(e.ort) || e.gesperrt || orteAllerKarten.has(e.ort);
    check(okArt && okAchsen && okOrt && ['immer', 'nach_tutorial', 'nach_raumgefecht', 'labor'].includes(e.frei) && e.beam && e.beam.range > 0 &&
      (e.art === 'hand' || (Number.isInteger(e.seed) && e.id.startsWith(e.ort + '.'))), `${e.id}: Art/Achsen/Ort/frei/beam gültig`);
  }
  check(alle.filter((e) => e.ort === 'rostnest').length >= 1 && alle.filter((e) => e.ort === 'rostnest').every((e) => e.gesperrt), 'Rostnest: alle Landepunkte gesperrt (E33)');
  console.log('\n[B1 Module]');
  const mods = Buehne.module();
  let modFehler = 0;
  for (const m of mods) { const r = Buehne.pruefeModul(m); if (!r.ok) { modFehler++; kit(false, `${m.id}: ${r.fehler.map((f) => f.code + ' ' + f.msg).join('; ')}`); } }
  check(true, `${mods.length} Module geprüft, ${modFehler} mit Fehlern`);
  console.log('\n[B1 Schablonen × Seeds]');
  const n = (C.buehne && C.buehne.sweepSeeds) || 50;
  const kartenarten = Object.keys(achsen.kartenarten);
  for (const art of kartenarten) {
    const list = Buehne.schablonen(art);
    if (!list.length) { console.log(`  info ${art}: noch keine Schablonen (Kits in Arbeit)`); continue; }
    for (const sch of list) {
      let gut = 0; const codes = {}; let ms = 0; const hs = new Set();
      for (let s = 1; s <= n; s++) {
        const t0 = Date.now();
        let r; try { r = Buehne.bauRoh({ schablone: sch.id, seed: s }); } catch (e) { r = { karte: null, pruefung: { ok: false, fehler: [{ code: 'AUSNAHME', msg: e.message }] } }; }
        ms += Date.now() - t0;
        if (r.pruefung.ok) gut++;
        if (r.karte) hs.add(Buehne.hash(r.karte));
        for (const f of r.pruefung.fehler) codes[f.code] = (codes[f.code] || 0) + 1;
      }
      const q = gut / n;
      kit(q >= C.buehne.bestehensquote, `${sch.id}: Bestehensquote ${(q * 100).toFixed(0)} % (${gut}/${n}), ${hs.size} verschiedene, Ø ${(ms / n).toFixed(1)} ms` +
        (Object.keys(codes).length ? ' – ' + JSON.stringify(codes) : ''));
    }
  }
  if (warn) console.log(`  ${warn} Kit-Warnungen (STRICT_BUEHNE=1 macht sie zu Fehlern).`);
}

console.log(`\n${checks - failures}/${checks} Prüfungen bestanden.`);
if (failures) { console.log(`${failures} FEHLER.`); process.exit(1); }
console.log('Karten OK.');
