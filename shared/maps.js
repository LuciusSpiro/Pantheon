// Karten für Sternenschicht. Gemeinsamer Code (UMD): läuft im Browser (window.Shared_Maps)
// und in Node (require). Reine Daten + kleine Hilfsfunktionen, kein DOM.
// Vertrag: CONTRACT.md §4. Bug ist RECHTS (+x), Backbord OBEN (-y), Steuerbord UNTEN (+y).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Maps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Schiffsinneres der KRS Lerche (M1), 42 x 13 Kacheln à 32 px.
  // Räume: Maschinenraum x1–6 (Reaktorschalter y oben/unten), Lager x8–12 y1–4, Transfer x8–12 y8–11,
  // 4 Einzelquartiere x14–17 / x19–22 (oben y1–4, unten y8–11), Messe x24–30 mit Planungstisch YY,
  // Brücke x32–39.
  //           0         1         2         3         4
  //           012345678901234567890123456789012345678901
  const SHIP_ROWS = [
    '#####################################     ', // 0
    '#uy=n=f#LLLLL#B,,,#B,,,#O,,,,,S#.K..#     ', // 1
    '#======#.....#,,,,#,,,,#,,,,,,,#.....#    ', // 2
    '#======#.....#,,,,#,,,,#,,YY,,,#....W.#   ', // 3
    '#==R==u#c...c#,,,,#,,,,#,,YY,,,#........# ', // 4
    '#======###D#####D###D###,,,,,,,#........# ', // 5
    '#======D.....D.........D,,,,,,,D....C..H# ', // 6
    '#======###D#####D###D###,,,,,,,#........# ', // 7
    '#E====k#....T#,,,,#,,,,#,,mm,,,#........# ', // 8
    '#======#.P.P.#,,,,#,,,,#,,,,,,,#......#   ', // 9
    '#======#..P..#,,,,#,,,,#,,,,,G,#.....#    ', // 10
    '#f=y=nf#....X#B,,,#B,,,#p,,,,,p#....#     ', // 11
    '#####################################     ', // 12
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

  // Regale im Lager: x-Kachel -> Gegenstand (Zeile 1).
  const SHELVES = { 8: 'ersatzteil', 9: 'loeschgel', 10: 'flickblech', 11: 'bolzen', 12: 'medipack' };

  // M1: 4 Einzelquartiere. color 0–2 = Spielerfarbe, color 3 = Gästequartier (zieht Techniker Ivo ein,
  // wenn er gerettet wurde). room = Innenfläche (für Boden-/Wandstil und Licht). Deko-Slots sind Bodenkacheln,
  // Deko blockiert nicht.
  const BEDS = [
    { color: 0, x: 14, y: 1, room: { id: 'q0', x0: 14, y0: 1, x1: 17, y1: 4 },
      slots: [{ id: 'q0a', x: 16, y: 1 }, { id: 'q0b', x: 17, y: 1 }, { id: 'q0c', x: 17, y: 3 }, { id: 'q0d', x: 14, y: 4 }] },
    { color: 1, x: 19, y: 1, room: { id: 'q1', x0: 19, y0: 1, x1: 22, y1: 4 },
      slots: [{ id: 'q1a', x: 21, y: 1 }, { id: 'q1b', x: 22, y: 1 }, { id: 'q1c', x: 22, y: 3 }, { id: 'q1d', x: 19, y: 4 }] },
    { color: 2, x: 14, y: 11, room: { id: 'q2', x0: 14, y0: 8, x1: 17, y1: 11 },
      slots: [{ id: 'q2a', x: 16, y: 11 }, { id: 'q2b', x: 17, y: 11 }, { id: 'q2c', x: 17, y: 9 }, { id: 'q2d', x: 14, y: 8 }] },
    { color: 3, x: 19, y: 11, room: { id: 'q3', x0: 19, y0: 8, x1: 22, y1: 11 },
      slots: [{ id: 'q3a', x: 21, y: 11 }, { id: 'q3b', x: 22, y: 11 }, { id: 'q3c', x: 22, y: 9 }, { id: 'q3d', x: 19, y: 8 }] },
  ];
  // Reaktor-Neustartschalter: A oben (2,1), B unten (3,11) – gegenüberliegende Wände.
  const REACTOR_SWITCHES = [{ id: 'A', x: 2, y: 1 }, { id: 'B', x: 3, y: 11 }];

  const SHIP_SPAWNS = [{ x: 16, y: 6 }, { x: 18, y: 6 }, { x: 20, y: 6 }];
  const BOT_SPAWNS = [{ x: 5, y: 6 }, { x: 28, y: 6 }, { x: 11, y: 6 }];
  const PLATFORM_PADS = [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 4 }];

  // Schiffsbereiche je Schildsektor (für Treffer -> Schaden, Feuer, Hüllenbruch).
  // Sektor-Index: 0 = Bug (vorn), 1 = Steuerbord (rechts/unten), 2 = Heck, 3 = Backbord (links/oben).
  const SECTOR_REGIONS = [
    { name: 'bug', systems: ['weapons'], test: (x, y) => x >= 32 },
    { name: 'steuerbord', systems: ['shields', 'transfer'], test: (x, y) => x >= 8 && x <= 30 && y >= 7 },
    { name: 'heck', systems: ['reactor', 'engines'], test: (x, y) => x <= 6 },
    { name: 'backbord', systems: ['life'], test: (x, y) => x >= 8 && x <= 30 && y <= 5 },
  ];

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
    ship: makeMap('ship', SHIP_ROWS, LEGEND),
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
