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
// M3a: alles aus dem Schiffslayout (SHIP_ROWS, Legende der Schiffskarte, SHIP_ROOMS, SHELF_TILES, SHIP_DRILL) – keine festen Koordinaten.
const ship = Maps.ship;
const shipLegend = ship.legend || Maps.LEGEND;
checkRows('ship', Maps.SHIP_ROWS, shipLegend);
const shipWalk = (x, y) => !ship.solid(x, y);
const shipChars = new Set(Maps.SHIP_ROWS.join(''));
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
  const path = bfs(shipWalk, Maps.BOT_SPAWNS[0], (x, y) => shipWalk(x, y) && Math.abs(x - t.x) + Math.abs(y - t.y) === 1, ship.w, ship.h);
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

// ---------- M1: Schiff ----------
check(Maps.SHIP_ROWS.every((r) => r.length === ship.w) && ship.h === Maps.SHIP_ROWS.length, `Schiff ${ship.w}×${ship.h} (aus SHIP_ROWS)`);
check(Maps.BEDS.length === 4 && Maps.BEDS.map((b) => b.color).sort().join() === '0,1,2,3', '4 Quartiere (Farben 0–3, 3 = Gästequartier)');
for (const b of Maps.BEDS) {
  check(b.slots.length === 4, `Quartier ${b.room.id}: 4 Deko-Slots`);
  for (const sl of b.slots) check(sl.x >= b.room.x0 && sl.x <= b.room.x1 && sl.y >= b.room.y0 && sl.y <= b.room.y1, `Slot ${sl.id} liegt im Raum ${b.room.id}`);
  check(b.x >= b.room.x0 && b.x <= b.room.x1 && b.y >= b.room.y0 && b.y <= b.room.y1, `Koje ${b.room.id} liegt im Raum`);
}
for (const sw of Maps.REACTOR_SWITCHES) {
  check(ship.info(sw.x, sw.y).interact === 'switch', `Reaktorschalter ${sw.id} (${sw.x},${sw.y}) ist ein Schalter`);
  check(hasAccess(ship, shipSet, sw), `Reaktorschalter ${sw.id} erreichbar (Spieler und Schrauber)`);
  const path = bfs(shipWalk, Maps.BOT_SPAWNS[0], (x, y) => shipWalk(x, y) && Math.abs(x - sw.x) + Math.abs(y - sw.y) === 1, ship.w, ship.h);
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

// ---------- M3a: neue Lerche (CONTRACT-M3 §2, §14) ----------
{
  console.log('\n[M3a Lerche]');
  const Protocol = require('../shared/protocol.js');
  check(ship.w === 44 && ship.h === 13, `Lerche 44×13 (ist ${ship.w}×${ship.h})`);
  check(shipLegend !== Maps.LEGEND && shipLegend === Maps.SHIP_LEGEND, 'Schiffskarte nutzt die eigene Legende SHIP_LEGEND');
  // 14 Stationen = Protocol.SYSTEMS ohne den Altnamen 'weapons'
  const want = Protocol.SYSTEMS.filter((s) => s !== 'weapons');
  check(want.length === 14, `Protocol.SYSTEMS: 14 Systeme ohne Altname weapons (${want.length})`);
  check(!systems.includes('weapons'), 'Altname weapons hat keine Station mehr');
  check(want.every((s) => systems.includes(s)) && systems.every((s) => want.includes(s)), 'Stationen auf der Karte = 14 Systeme laut Protokoll' +
    (want.filter((s) => !systems.includes(s)).length ? ' – fehlt: ' + want.filter((s) => !systems.includes(s)).join(',') : ''));
  const SIDE_OF_SECTOR = { 0: 'bow', 1: 'stbd', 2: 'aft', 3: 'port', '-1': 'mid' };
  const EXPECT = { weapon_bow: 0, emitter_bow: 0, thruster_port: 3, battery_port: 3, emitter_port: 3, thruster_stbd: 1, battery_stbd: 1,
    emitter_stbd: 1, reactor: -1, shields: -1, engines: 2, emitter_aft: 2, life: -1, transfer: 1 };
  for (const s of want) {
    const st = stationsOf(s);
    for (const t of st) {
      const i = t.info;
      check(i.system === s && [-1, 0, 1, 2, 3].includes(i.sector) && Protocol.SIDES.includes(i.side), `Station ${s} (${t.x},${t.y}): system, sector ${i.sector}, side ${i.side}`);
      check(i.sector === EXPECT[s], `Station ${s}: Sektor laut Vertrag (${EXPECT[s]})`);
      // Seite passt zum Sektor (Ausnahme Transfer: Sektor 1, Seite stbd)
      check(i.side === SIDE_OF_SECTOR[i.sector], `Station ${s}: Seite ${i.side} passt zu Sektor ${i.sector}`);
      check(hasAccess(ship, shipSet, t), `Station ${s} von einer begehbaren Nachbarkachel erreichbar`);
      check(i.solid && i.interact === 'system', `Station ${s}: solid + interact system`);
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
  // Mittschiffs-Systeme liegen in Räumen mit Sektor -1 (Maschinenraum / Messe)
  for (const s of ['reactor', 'shields', 'life']) {
    check(stationsOf(s).every((t) => { const r = Maps.roomAt(t.x, t.y); return r && r.sector === -1; }), `${s} liegt in einem Raum mittschiffs`);
  }
  check(Maps.roomAt(21, 3) && Maps.roomAt(21, 3).id === 'maschinenraum' && Maps.roomAt(1, 6).id === 'antrieb', 'Maschinenraum mittschiffs, Antriebsraum am Heck');
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
  // Laufweg Brücke -> jede Station (Plausibilität, Vertrag §2.2: Antrieb am weitesten)
  const helmT = interactive.find((q) => q.info.console === 'helm');
  const fromBridge = {};
  for (const s of want) {
    let best = null;
    for (const t of stationsOf(s)) {
      const path = bfs(shipWalk, W_access(helmT)[0], (x, y) => shipWalk(x, y) && Math.abs(x - t.x) + Math.abs(y - t.y) === 1, ship.w, ship.h);
      if (path && (best === null || path.length < best)) best = path.length;
    }
    fromBridge[s] = best;
  }
  check(Object.values(fromBridge).every((v) => v !== null), 'Laufweg Steuer -> Station (Kacheln): ' + Object.entries(fromBridge).map(([k, v]) => k + ' ' + v).join(', '));
  check(fromBridge.weapon_bow < fromBridge.battery_port && fromBridge.battery_port < fromBridge.reactor && fromBridge.reactor < fromBridge.engines,
    'Reihenfolge der Laufwege: Bug < Batterie < Maschinenraum < Antrieb');
  // Regale: Reihenfolge laut §2.3, Zugang y2
  check(Maps.SHELF_TILES.map((s) => s.item).join() === 'ersatzteil,loeschgel,flickblech,bolzen,medipack', 'Regal-Reihenfolge Ersatzteil, Löschgel, Flickblech, Bolzen, Medipack');
  check(Maps.SHELF_TILES.every((s) => s.access && Maps.roomAt(s.access.x, s.access.y) && Maps.roomAt(s.access.x, s.access.y).id === 'lager'), 'Regal-Zugänge im Lager');
  // Spawns
  for (const s of Maps.SHIP_SPAWNS.concat(Maps.BOT_SPAWNS)) check(shipWalk(s.x, s.y), `Spawn (${s.x},${s.y}) auf Boden`);
  for (const s of Maps.IVO_SPOTS || []) check(shipWalk(s.x, s.y) && shipSet.has(s.y * ship.w + s.x), `Ivo-Wegpunkt (${s.x},${s.y}) begehbar und erreichbar`);
  // Übung: Feuer in der Messe, Leck im Lager
  const dr = Maps.SHIP_DRILL;
  check(Maps.roomAt(dr.fire.x, dr.fire.y).id === 'messe' && Maps.roomAt(dr.breach.x, dr.breach.y).id === 'lager', 'SHIP_DRILL: Feuer in der Messe, Leck im Lager');
  // Deko-Slots: im eigenen Quartier (roomAt) und begehbar
  for (const b of Maps.BEDS) for (const sl of b.slots) {
    const r = Maps.roomAt(sl.x, sl.y);
    check(!!r && r.id === b.room.id && shipWalk(sl.x, sl.y), `Deko-Slot ${sl.id} (${sl.x},${sl.y}) auf Boden im Raum ${b.room.id}`);
  }
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
