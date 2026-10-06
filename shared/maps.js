// Karten für Sternenschicht. Gemeinsamer Code (UMD): läuft im Browser (window.Shared_Maps)
// und in Node (require). Reine Daten + kleine Hilfsfunktionen, kein DOM.
// Vertrag: CONTRACT.md §4. Bug ist RECHTS (+x), Backbord OBEN (-y), Steuerbord UNTEN (+y).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Maps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Schiffsinneres der KRS Lerche (M3a „Breitseite“), 44 x 13 Kacheln à 32 px. CONTRACT-M3 §2.
  // Antriebsraum am Heck x1–3 (Triebwerk E, Heck-Emitter A) – Lager/Quartiere/Transfer/Messe – Maschinenraum MITTSCHIFFS
  // x19–23 (Reaktor R, Schildgenerator G, Neustartschalter y A oben / B unten) – Batteriedecks Bb (oben) und Stb (unten)
  // x25–32 mit Düse, Batterie, Emitter – Brücke x34–42 mit Bug-Waffe K und Bug-Emitter I.
  //           0         1         2         3         4
  //           01234567890123456789012345678901234567890123
  const SHIP_ROWS = [
    '##################################          ', //  0
    '#===#LLLLL#B,,#B,,#y===u#=F==M==U#######    ', //  1
    '#A==#.....#,,,#,,,#=====#========#......##  ', //  2
    '#===#.....#,,,#,,,#==R==#========#.W......# ', //  3
    '#===##D#####D###D##=====###D##D###........##', //  4
    '#===#S,YY,........#=====#........#........K#', //  5
    '#E==D,,YY,........D=====D........D...C..H..#', //  6
    '#===#O,,,,........#=====#........#........I#', //  7
    '#===####D###D###D##=====###D##D###........##', //  8
    '#===#.....#,,,#,,,#==G==#========#........# ', //  9
    '#===#.P.P.#,,,#,,,#=====#========#......##  ', // 10
    '#==f#X.P.T#B,,#B,,#u===y#=Z==J==V#######    ', // 11
    '##################################          ', // 12
  ];

  // Bojenplattform B-7 (Außenmission), 32 x 18 Kacheln.
  //               0         1         2         3
  //               01234567890123456789012345678901
  const PLATFORM_ROWS = [
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 0
    '~##############################~', // 1
    '~#.......#..........#.....N...#~', // 2
    '~#.P.P...#.......d............#~', // 3
    '~#..P...............#.....d...#~', // 4
    '~#..................#.........#~', // 5
    '~#.......#....bb....#.........#~', // 6
    '~#.......#....bb....###########~', // 7
    '~#x......#..........#.........#~', // 8
    '~#########..........#.........#~', // 9
    '~~~~~~~~~#..d.......L.........#~', // 10
    '~~~~~~~~~#..........#......Q..#~', // 11
    '~~~~~~~~~#..........#.........#~', // 12
    '~~~~~~~~~######.#####.........#~', // 13
    '~~~~~~~~~#.......d..###########~', // 14
    '~~~~~~~~~#.....Z....#~~~~~~~~~~~', // 15
    '~~~~~~~~~############~~~~~~~~~~~', // 16
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 17
  ];

  // ---- M1 (Team SERVER): Wrack „Zaunkönig“ (Außenmission), 30 x 16 Kacheln. CONTRACT-M1 §9.4 ----
  // Vorderdeck mit Pads (oben links) – Gang – Brückenraum (oben rechts) – großer Laderaum unten mit
  // Bergungscontainern h, Logbuch-Terminal g, Plünderern a und einer dünnen Wand V vor einem Hohlraum (Container dahinter).
  //            0         1         2
  //            012345678901234567890123456789
  const WRECK_ROWS = [
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 0
    '~#########~~~~~~~~~##########~', // 1
    '~#.......#~~~~~~~~~#..x...h.#~', // 2
    '~#.P.P...###########........#~', // 3
    '~#..P....._________......x..#~', // 4
    '~#.......###########........#~', // 5
    '~####_###############_#######~', // 6
    '~#..._....a.........._..xx..#~', // 7
    '~#.xx.......####V####.......#~', // 8
    '~#..........#..h....#.......#~', // 9
    '~#..g.......#.......#....h..#~', // 10
    '~#..........#########.......#~', // 11
    '~#....a...........x.....a...#~', // 12
    '~#.h..........xx............#~', // 13
    '~############################~', // 14
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 15
  ];
  const WRECK_PADS = [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 4 }];

  // Legende (CONTRACT.md §4.1). solid = blockiert Bewegung.
  const LEGEND = {
    '#': { kind: 'wall', solid: true },
    ' ': { kind: 'void', solid: true },
    '~': { kind: 'space', solid: true },
    '.': { kind: 'floor_metal' },
    ',': { kind: 'floor_wood' },
    '=': { kind: 'floor_grate' },
    '_': { kind: 'floor_grate' },
    'D': { kind: 'door' },
    'P': { kind: 'pad' },
    'H': { kind: 'console_helm', solid: true, interact: 'console', console: 'helm' },
    'C': { kind: 'console_captain', solid: true, interact: 'console', console: 'captain' },
    'W': { kind: 'console_weapons', solid: true, interact: 'console', console: 'weapons' },
    'T': { kind: 'console_transfer', solid: true, interact: 'console', console: 'transfer' },
    'S': { kind: 'terminal_shop', solid: true, interact: 'console', console: 'shop' },
    'L': { kind: 'shelf', solid: true, interact: 'shelf' },          // nur Schiff; auf der Plattform: siehe PLATFORM_LEGEND
    'B': { kind: 'bed', solid: true, interact: 'bed' },
    'R': { kind: 'sys_reactor', solid: true, interact: 'system', system: 'reactor' },
    'E': { kind: 'sys_engines', solid: true, interact: 'system', system: 'engines' },
    'G': { kind: 'sys_shields', solid: true, interact: 'system', system: 'shields' },
    'K': { kind: 'sys_weapons', solid: true, interact: 'system', system: 'weapons' },
    'X': { kind: 'sys_transfer', solid: true, interact: 'system', system: 'transfer' },
    'O': { kind: 'sys_life', solid: true, interact: 'system', system: 'life' },
    'm': { kind: 'table', solid: true },
    'p': { kind: 'plant', solid: true },
    'c': { kind: 'crate', solid: true },
    'x': { kind: 'crate', solid: true },
    'b': { kind: 'buoy_core', solid: true },
    // M0: Maschinenraum-Ausstattung (nur Kulisse, blockiert)
    'u': { kind: 'pipes', solid: true },          // Rohrbündel mit Ventilblock
    'k': { kind: 'workbench', solid: true },      // Werkbank mit Schraubstock
    'n': { kind: 'control_desk', solid: true },   // Kontrollpult
    'f': { kind: 'barrel', solid: true },         // Ölfass / Kabeltrommel
    // M1
    'y': { kind: 'reactor_switch', solid: true, interact: 'switch' },          // Reaktor-Neustartschalter (oben A, unten B)
    'Y': { kind: 'plan_table', solid: true, interact: 'console', console: 'plan' }, // Planungstisch (2×2, mehrere Spieler gleichzeitig)
    'N': { kind: 'floor_metal', spawn: 'npc' },
    'Q': { kind: 'floor_metal', spawn: 'datenkern' },
    'd': { kind: 'floor_metal', spawn: 'drone' },
    'Z': { kind: 'sonde', solid: true, interact: 'sonde' },
  };
  // Auf der Plattform ist 'L' eine verriegelte Tür (öffnet, wenn die Sonde abgeschaltet ist).
  const PLATFORM_LEGEND = Object.assign({}, LEGEND, {
    'L': { kind: 'door_locked', solid: true, opensWhen: 'sondeDisabled' },
  });

  // M1 (Team SERVER): Wrack-Legende. 'V' ist solid, bis der Hohlraum geöffnet ist (Server: away.hollow.open).
  const WRECK_LEGEND = Object.assign({}, LEGEND, {
    'h': { kind: 'salvage', solid: true, interact: 'salvage' },       // Bergungscontainer: E halten 2 s -> Belohnung ins Inventar
    'g': { kind: 'lore_terminal', solid: true, interact: 'lore' },    // Logbuch-Terminal: E -> Lore + Logbuch
    'a': { kind: 'floor_metal', spawn: 'scavenger' },                 // Plünderer-Spawn (Boden)
    'V': { kind: 'wall_weak', solid: true, interact: 'hollow', opensWhen: 'hollowOpen' }, // dünne Wand (nach Weitscan markiert)
    'x': { kind: 'debris', solid: true },                             // Trümmer
  });

  // ---- M2 „Schildwall“ (Studioleitung): Mond Kesh, Kustoden-Archiv (Außenmission mit Kampf v2), 48 x 26. CONTRACT-M2 §2 ----
  // Landezone mit Pads (unten links) – Südtor – Hof der Ruine (Trupp 1 a) – Nord- (2 breit) und Südkorridor (4 breit) mit je
  // einem Störrelais r – Archivhalle mit Wächter L und zwei Archivschlüsseln k (weit auseinander, gleichzeitig halten) –
  // Tor G (zu, bis beide Schlüssel gedreht sind) – Gewölbe mit der Tafel T. Trupp 2 b und Nachhut c erscheinen erst per Missionsereignis.
  //            0         1         2         3         4
  //            012345678901234567890123456789012345678901234567
  const KESH_ROWS = [
    'RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', // 0
    'RRRRRR######################RRRRRRRR##k########R', // 1
    'RRRRRR#,,,,,,,,,,,,,,,,,,,,#RRRrRRRR#,,,,,,,,,#R', // 2
    'RRRRRR#,,,,,,c,,,,,,,,oo,,,,,,,,,,,b,,,,,,,,,,#R', // 3
    'RRRRRR#,,,,oo,,I,,,,,,a,,,,,,,,,,o,b,,,,,,,,,,#R', // 4
    'RRRRRR#,,,,,,,,,,,ooo,,,,I,#RRRRRRRR#,,I,,,I,,#R', // 5
    'RRRRRR#,c,,,,,,,,,,,,,,,a,,#RRRRRRRR#,,,,,,,,,#R', // 6
    'RRRRRR#,,,I,,,,,,,,,,I,,,,,#RRRRRRRR#,,,,,,,,,#R', // 7
    'RRRRRR#,,,,,,,oo,,,,,,,,o,,#RRRRRRRR#,,,oLo,,,#R', // 8
    'RRRRRR#,,,,,,,,,c,,,,a,,,,,,,,,,,,o,,,,,,,,,,,#R', // 9
    'RRRRRR#,oo,,,,,,,,,oo,,,,,,,,,o,,,,,,,,,,,,,,,#R', // 10
    'RRRRRR#,,,,,,,,,,I,,,,,a,,,,,,o,,,,b,,,I,,,I,,#R', // 11
    'RRRRRR#,,,,,oo,,,,,,,,,,I,,,,,,,,,o,,,,,,,,,,,#R', // 12
    'RRRRRR#,,,,,,,,,,,,,,,,,,,,#RRRRrRRR#,,,,,,,,,#R', // 13
    'RRRRRR###,,#################RRRRRRRR#,,,,,,,,,#R', // 14
    'RRR............RRRRRRRRRRRRRRRRRRRRR#####GG##k#R', // 15
    'R..............RRRRRRRRRRRRRRRRRRRRRRR#,,,,,,#RR', // 16
    'R...........R..RRRRRRRRRRRRRRRRRRRRRRR#,o,,o,#RR', // 17
    'R.....o........RRRRRRRRRRRRRRRRRRRRRRR#,,,,,,#RR', // 18
    'R.......RR.....RRRRRRRRRRRRRRRRRRRRRRR#,,T,,,#RR', // 19
    'R..............RRRRRRRRRRRRRRRRRRRRRRR#,,,,,,#RR', // 20
    'R..P.P....oo...RRRRRRRRRRRRRRRRRRRRRRR#,,,,,,#RR', // 21
    'R...P..........RRRRRRRRRRRRRRRRRRRRRRR########RR', // 22
    'R.............RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', // 23
    'RR...........RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', // 24
    'RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR', // 25
  ];
  const KESH_PADS = [{ x: 3, y: 21 }, { x: 5, y: 21 }, { x: 4, y: 22 }];
  // cover: 1 = halbe Deckung (niedrig, Sicht frei, low: true), 2 = volle Deckung (blockiert Sicht). CONTRACT-M2 §2.2
  const KESH_LEGEND = Object.assign({}, LEGEND, {
    'R': { kind: 'rock', solid: true, cover: 2 },
    '#': { kind: 'wall_ruin', solid: true, cover: 2 },
    '.': { kind: 'floor_sand' },
    ',': { kind: 'floor_ruin' },
    'o': { kind: 'cover_low', solid: true, low: true, cover: 1 },
    'I': { kind: 'pillar', solid: true, cover: 2 },
    'r': { kind: 'jammer', solid: true, cover: 2, interact: 'jammer' },          // Störrelais: E halten -> aus
    'k': { kind: 'archive_key', solid: true, low: true, cover: 1, interact: 'archkey' }, // Archivschlüssel (zwei gleichzeitig)
    'G': { kind: 'vault_gate', solid: true, cover: 2, opensWhen: 'vaultOpen' },  // Tor, offen = Boden
    'T': { kind: 'tablet_pedestal', solid: true, low: true, cover: 1, interact: 'tablet' }, // Tafel bergen
    'L': { kind: 'floor_ruin', spawn: 'warden' },
    'a': { kind: 'floor_ruin', spawn: 'squad1' },
    'b': { kind: 'floor_ruin', spawn: 'squad2' },
    'c': { kind: 'floor_ruin', spawn: 'rearguard' },
  });

  // ---- M3a (Studioleitung, CONTRACT-M3 §2): Schiffslegende mit Stationen ----
  // Jede Station: system, sector (0 Bug, 1 Stb, 2 Heck, 3 Bb, -1 mittschiffs), side (Beschriftung/Art).
  const station = (kind, system, sector, side) => ({ kind, solid: true, interact: 'system', system, sector, side });
  const SHIP_LEGEND = Object.assign({}, LEGEND, {
    'R': station('sys_reactor', 'reactor', -1, 'mid'),
    'G': station('sys_shields', 'shields', -1, 'mid'),
    'O': station('sys_life', 'life', -1, 'mid'),
    'E': station('sys_engines', 'engines', 2, 'aft'),
    'A': station('sys_emitter', 'emitter_aft', 2, 'aft'),
    'X': station('sys_transfer', 'transfer', 1, 'stbd'),
    'K': station('sys_weapon_bow', 'weapon_bow', 0, 'bow'),
    'I': station('sys_emitter', 'emitter_bow', 0, 'bow'),
    'F': station('sys_thruster', 'thruster_port', 3, 'port'),
    'M': station('sys_battery', 'battery_port', 3, 'port'),
    'U': station('sys_emitter', 'emitter_port', 3, 'port'),
    'Z': station('sys_thruster', 'thruster_stbd', 1, 'stbd'),
    'J': station('sys_battery', 'battery_stbd', 1, 'stbd'),
    'V': station('sys_emitter', 'emitter_stbd', 1, 'stbd'),
  });

  // Regale im Lager: x-Kachel -> Gegenstand (Zeile 1). Altname; maßgeblich ist SHELF_TILES.
  const SHELVES = { 5: 'ersatzteil', 6: 'loeschgel', 7: 'flickblech', 8: 'bolzen', 9: 'medipack' };

  // 4 Einzelquartiere (3×3). color 0–2 = Spielerfarbe, color 3 = Gästequartier (Ivo). Deko-Slots sind Bodenkacheln.
  const BEDS = [
    { color: 0, x: 11, y: 1, room: { id: 'q0', x0: 11, y0: 1, x1: 13, y1: 3 },
      slots: [{ id: 'q0a', x: 12, y: 1 }, { id: 'q0b', x: 13, y: 1 }, { id: 'q0c', x: 13, y: 3 }, { id: 'q0d', x: 11, y: 3 }] },
    { color: 1, x: 15, y: 1, room: { id: 'q1', x0: 15, y0: 1, x1: 17, y1: 3 },
      slots: [{ id: 'q1a', x: 16, y: 1 }, { id: 'q1b', x: 17, y: 1 }, { id: 'q1c', x: 17, y: 3 }, { id: 'q1d', x: 15, y: 3 }] },
    { color: 2, x: 11, y: 11, room: { id: 'q2', x0: 11, y0: 9, x1: 13, y1: 11 },
      slots: [{ id: 'q2a', x: 12, y: 11 }, { id: 'q2b', x: 13, y: 11 }, { id: 'q2c', x: 13, y: 9 }, { id: 'q2d', x: 11, y: 9 }] },
    { color: 3, x: 15, y: 11, room: { id: 'q3', x0: 15, y0: 9, x1: 17, y1: 11 },
      slots: [{ id: 'q3a', x: 16, y: 11 }, { id: 'q3b', x: 17, y: 11 }, { id: 'q3c', x: 17, y: 9 }, { id: 'q3d', x: 15, y: 9 }] },
  ];
  // Reaktor-Neustartschalter im Maschinenraum mittschiffs: A oben links (19,1), B unten rechts (23,11).
  const REACTOR_SWITCHES = [{ id: 'A', x: 19, y: 1 }, { id: 'B', x: 23, y: 11 }];

  const SHIP_SPAWNS = [{ x: 26, y: 6 }, { x: 28, y: 6 }, { x: 30, y: 6 }];
  const BOT_SPAWNS = [{ x: 21, y: 6 }, { x: 13, y: 6 }, { x: 28, y: 6 }];
  const PLATFORM_PADS = [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 4 }];
  // Ivo (Gast an Bord) schlendert zwischen diesen Bodenkacheln.
  const IVO_SPOTS = [{ x: 16, y: 10 }, { x: 13, y: 10 }, { x: 6, y: 7 }, { x: 9, y: 6 }, { x: 21, y: 5 }, { x: 14, y: 6 }, { x: 29, y: 7 }, { x: 16, y: 10 }];

  // Räume in Prüfreihenfolge (erster Treffer gilt). kind 'engine' = Maschinen-/Antriebsraum, 'quarter' = Quartier.
  // sector: Schildsektor 0–3 des Raums, -1 = mittschiffs (kein Sektor).
  const SHIP_ROOMS = [
    { id: 'antrieb', name: 'Antriebsraum', kind: 'engine', sector: 2, x0: 1, y0: 1, x1: 3, y1: 11 },
    { id: 'maschinenraum', name: 'Maschinenraum', kind: 'engine', sector: -1, x0: 19, y0: 1, x1: 23, y1: 11 },
    { id: 'bruecke', name: 'Brücke', kind: 'room', sector: 0, x0: 34, y0: 1, x1: 43, y1: 11 },
    { id: 'lager', name: 'Lager', kind: 'room', sector: 3, x0: 5, y0: 1, x1: 9, y1: 3 },
    { id: 'transfer', name: 'Transferkammer', kind: 'room', sector: 1, x0: 5, y0: 9, x1: 9, y1: 11 },
    { id: 'q0', name: 'Quartier 1', kind: 'quarter', sector: 3, x0: 11, y0: 1, x1: 13, y1: 3 },
    { id: 'q1', name: 'Quartier 2', kind: 'quarter', sector: 3, x0: 15, y0: 1, x1: 17, y1: 3 },
    { id: 'q2', name: 'Quartier 3', kind: 'quarter', sector: 1, x0: 11, y0: 9, x1: 13, y1: 11 },
    { id: 'q3', name: 'Gästequartier', kind: 'quarter', sector: 1, x0: 15, y0: 9, x1: 17, y1: 11 },
    { id: 'batterie_bb', name: 'Batteriedeck Backbord', kind: 'room', sector: 3, x0: 25, y0: 1, x1: 32, y1: 3 },
    { id: 'batterie_stb', name: 'Batteriedeck Steuerbord', kind: 'room', sector: 1, x0: 25, y0: 9, x1: 32, y1: 11 },
    { id: 'messe', name: 'Messe', kind: 'room', sector: -1, x0: 5, y0: 5, x1: 9, y1: 7 },
    { id: 'gang', name: 'Gang', kind: 'room', sector: -1, x0: 4, y0: 4, x1: 33, y1: 8 },
  ];
  // Raum einer Kachel (oder null außerhalb aller Räume).
  function roomAt(tx, ty) {
    for (const r of SHIP_ROOMS) if (tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1) return r;
    return null;
  }

  // Schiffsbereiche je Schildsektor (Treffer -> Feuer, Hüllenbruch; systems = Stationen des Sektors).
  // Sektor-Index: 0 = Bug (vorn), 1 = Steuerbord (rechts/unten), 2 = Heck, 3 = Backbord (links/oben). Mittschiffs gehört zu keinem.
  const SECTOR_NAMES = ['bug', 'steuerbord', 'heck', 'backbord'];
  const SECTOR_REGIONS = SECTOR_NAMES.map((name, i) => ({
    name,
    systems: Object.keys(SHIP_LEGEND).filter((ch) => SHIP_LEGEND[ch].system && SHIP_LEGEND[ch].sector === i && SHIP_ROWS.some((r) => r.includes(ch)))
      .map((ch) => SHIP_LEGEND[ch].system),
    test: (x, y) => { const r = roomAt(x, y); return !!r && r.sector === i; },
  }));

  // Regale: Reihenfolge = Regal 1..5 (ODA-Texte „Regal 1“ usw.). access = Kachel, von der Bots das Teil holen.
  const SHELF_TILES = Object.keys(SHELVES).map((x) => ({ x: +x, y: 1, item: SHELVES[x], access: { x: +x, y: 2 } }));
  function shelfAt(tx, ty) { return SHELF_TILES.find((s) => s.x === tx && s.y === ty) || null; }
  // Hafen-Übung: Kabelbrand und Leck (früher CONFIG.drill.fire/breach; die CONFIG-Schlüssel bleiben als Altnamen)
  const SHIP_DRILL = { fire: { x: 6, y: 6 }, breach: { x: 5, y: 3 } };

  // M0: Regal-Füllstand. Löschgel zählt ganze Dosen, eine angebrochene Ladung zählt als eine Dose.
  function shelfStock(inv, item) {
    if (!inv) return 0;
    if (item === 'loeschgel') return (inv.loeschgel || 0) + ((inv.loeschgelCharges || 0) > 0 ? 1 : 0);
    return inv[item] || 0;
  }
  // Füllgrad 0..1 (über der Kapazität geklemmt auf 1)
  function shelfFill(inv, item, capacity) {
    const cap = (capacity && capacity[item]) || 1;
    return Math.max(0, Math.min(1, shelfStock(inv, item) / cap));
  }

  function makeMap(id, rows, legend) {
    return {
      id, rows, legend,
      w: rows[0].length, h: rows.length,
      at(x, y) { return (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length) ? ' ' : rows[y][x]; },
      info(x, y) { return legend[this.at(x, y)] || legend['#']; },
      solid(x, y) { return !!this.info(x, y).solid; },
      find(ch) { const out = []; rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === ch) out.push({ x, y }); }); return out; },
    };
  }

  return {
    TILE: 32,
    SHIP_ROWS, PLATFORM_ROWS, LEGEND, PLATFORM_LEGEND,
    SHELVES, BEDS, REACTOR_SWITCHES, SHIP_SPAWNS, BOT_SPAWNS, PLATFORM_PADS, SECTOR_REGIONS,
    // M3a Schritt 0: Schiffslayout als Daten (CONTRACT-M3 §3)
    SHIP_ROOMS, SHELF_TILES, SHIP_DRILL, roomAt, shelfAt,
    // M3a: Schiffslegende mit Stationen, Ivo-Wegpunkte, Sektornamen
    SHIP_LEGEND, IVO_SPOTS, SECTOR_NAMES,
    ship: makeMap('ship', SHIP_ROWS, SHIP_LEGEND),
    platform: makeMap('platform', PLATFORM_ROWS, PLATFORM_LEGEND),
    // M1 (Team SERVER): Wrack
    WRECK_ROWS, WRECK_LEGEND, WRECK_PADS,
    wreck: makeMap('wreck', WRECK_ROWS, WRECK_LEGEND),
    // M2 (Studioleitung): Mond Kesh
    KESH_ROWS, KESH_LEGEND, KESH_PADS,
    kesh: makeMap('kesh', KESH_ROWS, KESH_LEGEND),
    makeMap, shelfStock, shelfFill,
  };
});
