// Karten für Sternenschicht. Gemeinsamer Code (UMD): läuft im Browser (window.Shared_Maps)
// und in Node (require). Reine Daten + kleine Hilfsfunktionen, kein DOM.
// Vertrag: CONTRACT.md §4. Bug ist RECHTS (+x), Backbord OBEN (-y), Steuerbord UNTEN (+y).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Maps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Schiffsinneres der KRS Lerche (M4 „Zwei Decks“, CONTRACT-M4 §2.1): Atlas mit zwei Decks übereinander, 37 x 29 Kacheln à 32 px.
  // Deck I (Systemdeck) Zeilen 0–12, Deck II (Privatdeck) Zeilen 16–28, Zeilen 13–15 leer (void). Deck II = Deck-I-Zeile + 16.
  // Deck I: Antriebsraum am Heck x1–3 (Triebwerk E, Heck-Emitter A) – Lager (Regale) / Vorraum (Notleiter !) / Transferkammer –
  // Maschinenraum MITTSCHIFFS x11–15 (Reaktor R, Lebenserhaltung O, Schildgenerator G, Schalter y A oben / B unten) –
  // Batteriedecks Bb (oben) und Stb (unten) x17–24 – Brücke x25–36 mit Lift ^, Bug-Waffe K und Bug-Emitter I.
  // Deck II: vier Quartiere, Messe mit Hafenterminal S, Trophäennische, Liftvorraum, Atrium mit Lichtschacht, Krankenstation,
  // Bad, Aussicht mit Panoramafenster. Kein System auf Deck II.
  //           0         1         2         3
  //           0123456789012345678901234567890123456
  const SHIP_ROWS = [
    '##########################           ', //  0
    '#===#LLLLL#y===u#=F==M==U#######     ', //  1
    '#A==#.....#=====#========#^^....##   ', //  2
    '#===#.....#==R==#========#^^..W...#  ', //  3  (Kai 2026-10-07: Taktik, Captain, Terminal in einer Spalte x=30)
    '#===###D###=====##D##D###.........## ', //  4
    '#===#!....#=====#........#.YY......K#', //  5
    '#E==D.....D=====D........D.YY.C..H..#', //  6
    '#===#.....#=====#........#.........I#', //  7
    '#===###D###=====##D##D###.........## ', //  8
    '#===#.....#O=G==#========#....q...#  ', //  9
    '#===#.P.P.#=====#========#......##   ', // 10
    '#==f#X.P.T#u===y#=Z==J==V#######     ', // 11
    '##########################           ', // 12
    '                                     ', // 13
    '                                     ', // 14
    '                                     ', // 15
    '    ##########################       ', // 16
    '    #B,,#B,,#S,,,,,,j#t,t#:::#       ', // 17
    '    #,,,#,,,#,,,mm,,,#,,,#^^:#       ', // 18
    '    #,,,#,,,#,,,mm,,,#,a,#^^:#       ', // 19
    '    ##D###D####DD#####D###::##       ', // 20
    '    #!:::::::::::::::::::::::#       ', // 21
    '    #::::::::ww::::::::::::::#       ', // 22
    '    #::::::::::::::::::::::::#       ', // 23
    '    ##D###D####DD#####D###D###       ', // 24
    '    #,,,#,,,#........#:::#:::#       ', // 25
    '    #,,,#,,,#........#:o:#:s:#       ', // 26
    '    #B,,#B,,#.v.v.v..#:o:#:::#       ', // 27
    '    ######################%%%#       ', // 28
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
    // Brückenumbau (Kai): freies Terminal unten links, noch ohne Funktion
    'q': { kind: 'terminal_spare', solid: true, interact: 'spare' },
    // ---- M4 Stufe 1 „Zwei Decks“ (CONTRACT-M4 §2.2) ----
    '^': { kind: 'lift', interact: 'lift' },              // Liftplattform (2×2): E tippen -> anderes Deck
    '!': { kind: 'ladder', interact: 'ladder' },          // Notleiter: E halten -> anderes Deck
    ':': { kind: 'floor_mosaic' },                        // Mosaikboden (Privatdeck)
    'w': { kind: 'light_shaft', solid: true },            // Lichtschacht mit Glasboden und Geländer
    '%': { kind: 'window', solid: true },                 // Panoramafenster (Außenwand)
    't': { kind: 'trophy_niche', solid: true },           // Trophäennische (Funde)
    'a': { kind: 'shrine', solid: true },                 // Hausschrein (Lararium)
    'v': { kind: 'med_bed', solid: true },                // Krankenliege (Kulisse)
    'o': { kind: 'bath', solid: true },                   // Becken (Kulisse)
    's': { kind: 'bench', solid: true },                  // Aussichtsbank (Kulisse)
    'j': { kind: 'sideboard', solid: true },              // Anrichte/Kombüse in der Messe
  });

  // Regale im Lager: x-Kachel -> Gegenstand (Zeile 1). Altname; maßgeblich ist SHELF_TILES.
  const SHELVES = { 5: 'ersatzteil', 6: 'loeschgel', 7: 'flickblech', 8: 'bolzen', 9: 'medipack' };

  // ---- M4 „Zwei Decks“ (CONTRACT-M4 §2.3): Decks im Atlas ----
  const DECK_STRIDE = 16;
  const SHIP_DECKS = [
    { id: 'system', name: 'Systemdeck', level: 0, y0: 0, y1: 12 },
    { id: 'private', name: 'Privatdeck', level: 1, y0: 16, y1: 28 },
  ];
  // Deck einer Atlas-Kachelzeile: 0 oder 1, -1 in der Lücke (oder außerhalb).
  function deckOf(ty) {
    for (const d of SHIP_DECKS) if (ty >= d.y0 && ty <= d.y1) return d.level;
    return -1;
  }
  // Deck einer Spiel-Pixel-y-Koordinate (Schiff)
  function deckOfPx(py) { return deckOf(Math.floor(py / 32)); }
  // Zeile relativ zum eigenen Deck (Deck II: ty − 16); in der Lücke ty − 0
  function deckLocalY(ty) { const d = deckOf(ty); return d > 0 ? ty - d * DECK_STRIDE : ty; }
  // Lift: 2×2-Plattform auf Deck I; das Gegenstück liegt auf Deck II bei y + 16 (other = dy ±16 je nach Startdeck).
  const SHIP_LIFTS = [{ id: 'lift', tiles: [[26, 2], [27, 2], [26, 3], [27, 3]], other: DECK_STRIDE }];
  // Notleitern: Deck I (5,5) <-> Deck II (5,21)
  const SHIP_LADDERS = [{ x: 5, y: 5 }, { x: 5, y: 21 }];
  // Kachel auf dem anderen Deck (gleiche lokale Kachel). null in der Lücke.
  function otherDeckTile(tx, ty) {
    const d = deckOf(ty);
    if (d < 0) return null;
    return { x: tx, y: d === 0 ? ty + DECK_STRIDE : ty - DECK_STRIDE };
  }
  // Ist (tx,ty) eine Liftkachel (auf irgendeinem Deck)? -> Lift-Eintrag oder null
  function liftAt(tx, ty) {
    const d = deckOf(ty);
    if (d < 0) return null;
    const ly = d === 0 ? ty : ty - DECK_STRIDE;
    return SHIP_LIFTS.find((l) => l.tiles.some((t) => t[0] === tx && t[1] === ly)) || null;
  }
  // Gegenstück einer Notleiter (oder null)
  function ladderPartner(tx, ty) {
    const i = SHIP_LADDERS.findIndex((l) => l.x === tx && l.y === ty);
    if (i < 0) return null;
    const me = SHIP_LADDERS[i];
    return SHIP_LADDERS.find((l) => l !== me && l.x === me.x && Math.abs(l.y - me.y) === DECK_STRIDE) || null;
  }
  // Übergänge zwischen den Decks als BFS-Kanten: links(x, y) -> [{x, y, via: 'lift'|'ladder'}].
  // opts.ladder = false: ohne Notleiter (Bots benutzen nie die Leiter).
  function deckLinks(tx, ty, opts) {
    const out = [];
    if (liftAt(tx, ty)) { const o = otherDeckTile(tx, ty); if (o) out.push({ x: o.x, y: o.y, via: 'lift' }); }
    if (!(opts && opts.ladder === false)) { const l = ladderPartner(tx, ty); if (l) out.push({ x: l.x, y: l.y, via: 'ladder' }); }
    return out;
  }

  // 4 Einzelquartiere (3×3) auf dem Privatdeck. color 0–2 = Spielerfarbe, color 3 = Gästequartier (Ivo). Deko-Slots sind Bodenkacheln.
  const BEDS = [
    { color: 0, x: 5, y: 17, room: { id: 'q0', x0: 5, y0: 17, x1: 7, y1: 19 },
      slots: [{ id: 'q0a', x: 6, y: 17 }, { id: 'q0b', x: 7, y: 17 }, { id: 'q0c', x: 7, y: 19 }, { id: 'q0d', x: 5, y: 19 }] },
    { color: 1, x: 9, y: 17, room: { id: 'q1', x0: 9, y0: 17, x1: 11, y1: 19 },
      slots: [{ id: 'q1a', x: 10, y: 17 }, { id: 'q1b', x: 11, y: 17 }, { id: 'q1c', x: 11, y: 19 }, { id: 'q1d', x: 9, y: 19 }] },
    { color: 2, x: 5, y: 27, room: { id: 'q2', x0: 5, y0: 25, x1: 7, y1: 27 },
      slots: [{ id: 'q2a', x: 6, y: 27 }, { id: 'q2b', x: 7, y: 27 }, { id: 'q2c', x: 7, y: 25 }, { id: 'q2d', x: 5, y: 25 }] },
    { color: 3, x: 9, y: 27, room: { id: 'q3', x0: 9, y0: 25, x1: 11, y1: 27 },
      slots: [{ id: 'q3a', x: 10, y: 27 }, { id: 'q3b', x: 11, y: 27 }, { id: 'q3c', x: 11, y: 25 }, { id: 'q3d', x: 9, y: 25 }] },
  ];
  // Reaktor-Neustartschalter im Maschinenraum mittschiffs: A oben links (11,1), B unten rechts (15,11).
  const REACTOR_SWITCHES = [{ id: 'A', x: 11, y: 1 }, { id: 'B', x: 15, y: 11 }];

  const SHIP_SPAWNS = [{ x: 18, y: 6 }, { x: 20, y: 6 }, { x: 22, y: 6 }];
  const BOT_SPAWNS = [{ x: 13, y: 6 }, { x: 7, y: 6 }, { x: 20, y: 7 }];
  const PLATFORM_PADS = [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 4 }];
  // Ivo (Gast an Bord) schlendert zwischen diesen Bodenkacheln – alle auf Deck II, er benutzt weder Lift noch Leiter.
  const IVO_SPOTS = [{ x: 10, y: 26 }, { x: 15, y: 18 }, { x: 9, y: 22 }, { x: 20, y: 22 }, { x: 14, y: 25 }, { x: 26, y: 26 }, { x: 24, y: 23 }, { x: 10, y: 26 }];

  // Räume in Prüfreihenfolge (erster Treffer gilt). kind 'engine' = Maschinen-/Antriebsraum, 'quarter' = Quartier.
  // sector: Schildsektor 0–3 des Raums, -1 = mittschiffs (kein Sektor). deck: 0 Systemdeck, 1 Privatdeck.
  // Abweichung von CONTRACT-M4 §2.3: der Vorraum reicht 4,4–10,8, damit auch die vier Türen um ihn herum einen Raum haben
  // (früher deckte der Gang sie ab). Lager/Transfer/Antrieb/Maschinenraum stehen davor, ändern sich also nicht.
  const SHIP_ROOMS = [
    // Deck I
    { id: 'antrieb', name: 'Antriebsraum', kind: 'engine', sector: 2, deck: 0, x0: 1, y0: 1, x1: 3, y1: 11 },
    { id: 'maschinenraum', name: 'Maschinenraum', kind: 'engine', sector: -1, deck: 0, x0: 11, y0: 1, x1: 15, y1: 11 },
    { id: 'bruecke', name: 'Brücke', kind: 'room', sector: 0, deck: 0, x0: 25, y0: 1, x1: 36, y1: 11 },
    { id: 'lager', name: 'Lager', kind: 'room', sector: 3, deck: 0, x0: 5, y0: 1, x1: 9, y1: 3 },
    { id: 'transfer', name: 'Transferkammer', kind: 'room', sector: 1, deck: 0, x0: 5, y0: 9, x1: 9, y1: 11 },
    { id: 'vorraum', name: 'Vorraum', kind: 'room', sector: -1, deck: 0, x0: 4, y0: 4, x1: 10, y1: 8 },
    { id: 'batterie_bb', name: 'Batteriedeck Backbord', kind: 'room', sector: 3, deck: 0, x0: 17, y0: 1, x1: 24, y1: 3 },
    { id: 'batterie_stb', name: 'Batteriedeck Steuerbord', kind: 'room', sector: 1, deck: 0, x0: 17, y0: 9, x1: 24, y1: 11 },
    { id: 'gang', name: 'Gang', kind: 'room', sector: -1, deck: 0, x0: 16, y0: 4, x1: 24, y1: 8 },
    // Deck II (alle Sektor -1: kein Feuer, kein Leck)
    { id: 'q0', name: 'Quartier 1', kind: 'quarter', sector: -1, deck: 1, x0: 5, y0: 17, x1: 7, y1: 19 },
    { id: 'q1', name: 'Quartier 2', kind: 'quarter', sector: -1, deck: 1, x0: 9, y0: 17, x1: 11, y1: 19 },
    { id: 'q2', name: 'Quartier 3', kind: 'quarter', sector: -1, deck: 1, x0: 5, y0: 25, x1: 7, y1: 27 },
    { id: 'q3', name: 'Gästequartier', kind: 'quarter', sector: -1, deck: 1, x0: 9, y0: 25, x1: 11, y1: 27 },
    { id: 'messe', name: 'Messe', kind: 'room', sector: -1, deck: 1, x0: 13, y0: 17, x1: 20, y1: 19 },
    { id: 'lararium', name: 'Trophäennische', kind: 'room', sector: -1, deck: 1, x0: 22, y0: 17, x1: 24, y1: 19 },
    { id: 'liftvorraum', name: 'Liftvorraum', kind: 'room', sector: -1, deck: 1, x0: 26, y0: 17, x1: 28, y1: 20 },
    { id: 'krankenstation', name: 'Krankenstation', kind: 'room', sector: -1, deck: 1, x0: 13, y0: 25, x1: 20, y1: 27 },
    { id: 'bad', name: 'Bad', kind: 'room', sector: -1, deck: 1, x0: 22, y0: 25, x1: 24, y1: 27 },
    { id: 'aussicht', name: 'Aussicht', kind: 'room', sector: -1, deck: 1, x0: 26, y0: 25, x1: 28, y1: 27 },
    { id: 'atrium', name: 'Atrium', kind: 'room', sector: -1, deck: 1, x0: 5, y0: 20, x1: 28, y1: 24 },
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
  // M4: Feuer im Vorraum (Systemdeck), Leck im Lager
  const SHIP_DRILL = { fire: { x: 7, y: 6 }, breach: { x: 5, y: 3 } };
  // M4 §2.4: Kann auf dieser Schiffskachel ein Feuer oder Leck entstehen? Nur auf Deck I, nie auf Lift/Leiter, nie auf soliden Kacheln.
  function hazardAllowed(tx, ty) {
    if (deckOf(ty) !== 0) return false;
    const info = SHIP_LEGEND[(SHIP_ROWS[ty] || '')[tx]];
    if (!info || info.solid) return false;
    return info.kind !== 'lift' && info.kind !== 'ladder';
  }

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

  // ---- S1 (Studioleitung, CONTRACT-S1 §4): Objekte und Bereiche der Außenkarten ----
  // Objekte: logische Kennung -> { legend (Interaktion bzw. Laufzeitobjekt), zustaende, viele? }. Den Laufzeitzustand liest
  // und setzt server/mission/objects.js (Team ENGINE); hier steht nur, was es gibt.
  const MAP_OBJECTS = {
    platform: {
      sonde: { legend: 'sonde', zustaende: ['on', 'off'] },
      core: { legend: 'buoy_core', zustaende: ['off', 'rebooted'] },
      ivo: { legend: 'npc', zustaende: ['injured', 'ok', 'rescued'] },
      datenkern: { legend: 'datenkern', zustaende: ['present', 'taken'] },
    },
    wreck: {
      hollow: { legend: 'hollow', zustaende: ['closed', 'open'] },
      lore: { legend: 'lore', zustaende: ['unread', 'read'] },
      container: { legend: 'salvage', zustaende: ['full', 'taken'], viele: true },   // S1: Bergungscontainer 'h'
    },
    kesh: {
      jammer: { legend: 'jammer', zustaende: ['on', 'off'], viele: true },
      vault: { legend: 'vault_gate', zustaende: ['closed', 'open'] },
      key: { legend: 'archkey', zustaende: ['idle', 'held'], viele: true },
      tablet: { legend: 'tablet', zustaende: ['present', 'taken'] },
      warden: { legend: 'warden', zustaende: ['asleep', 'awake', 'dead'] },
    },
  };
  // Bereiche in Kachelkoordinaten: { rect: [x, y, w, h] } oder { cols: [min, max] } (alle Zeilen, x von min bis max).
  // Kesh: hof/halle sind bewusst Spaltenbereiche wie bisher (CONFIG.missionM3.courtyardX = 27, hallX = 37) – der Hof umfasst
  // damit auch die Landezone und die Halle das Gewölbe. So spielt sich m3 genau wie vorher.
  // S2 (Team BAUSTEINE): Räume auf B-7 und im Wrack als Bereiche (Anker für spawn_person, area_occupied …).
  // kernraum (B-7) liegt hinter der Sondentür, hohlraum (Wrack) hinter der dünnen Wand – beide erst nach dem Öffnen begehbar.
  // nsc = NSC-Anker der Karte (eine Kachel; Standardplatz für spawn_person). Als Bereich statt Objekt, weil Wrack/Kesh keine
  // NSC-Kachel in der Legende haben (ein Objekt ohne Kachel meldet der Prüfer als REF-KACHEL). B-7: Ivos Platz 'N'.
  const MAP_AREAS = {
    platform: {
      nsc: { rect: [26, 2, 1, 1] },
      landedeck: { rect: [2, 2, 7, 7] },
      halle: { rect: [10, 2, 10, 11] },
      nordraum: { rect: [21, 2, 9, 5] },
      kernraum: { rect: [21, 8, 9, 6] },
      sondenraum: { rect: [10, 14, 10, 2] },
    },
    wreck: {
      nsc: { rect: [26, 3, 1, 1] },
      vorderdeck: { rect: [2, 2, 7, 4] },
      bruecke: { rect: [20, 2, 8, 4] },
      laderaum: { rect: [2, 7, 26, 7] },
      hohlraum: { rect: [13, 9, 7, 2] },
    },
    kesh: {
      nsc: { rect: [8, 4, 1, 1] },
      landezone: { rect: [1, 15, 14, 10] },
      hof: { cols: [0, 27] },
      halle: { cols: [37, 47] },
      gewoelbe: { rect: [39, 16, 6, 6] },
    },
  };
  function inArea(mapId, areaId, tx, ty) {
    const a = MAP_AREAS[mapId] && MAP_AREAS[mapId][areaId];
    if (!a) return false;
    if (a.cols) return tx >= a.cols[0] && tx <= a.cols[1];
    if (a.rect) return tx >= a.rect[0] && tx < a.rect[0] + a.rect[2] && ty >= a.rect[1] && ty < a.rect[1] + a.rect[3];
    return false;
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
    // M4 Stufe 1 „Zwei Decks“ (CONTRACT-M4 §2.3)
    DECK_STRIDE, SHIP_DECKS, SHIP_LIFTS, SHIP_LADDERS, deckOf, deckOfPx, deckLocalY, otherDeckTile, liftAt, ladderPartner, deckLinks, hazardAllowed,
    ship: makeMap('ship', SHIP_ROWS, SHIP_LEGEND),
    platform: makeMap('platform', PLATFORM_ROWS, PLATFORM_LEGEND),
    // M1 (Team SERVER): Wrack
    WRECK_ROWS, WRECK_LEGEND, WRECK_PADS,
    wreck: makeMap('wreck', WRECK_ROWS, WRECK_LEGEND),
    // M2 (Studioleitung): Mond Kesh
    KESH_ROWS, KESH_LEGEND, KESH_PADS,
    kesh: makeMap('kesh', KESH_ROWS, KESH_LEGEND),
    // S1: Objekte und Bereiche (CONTRACT-S1 §4)
    MAP_OBJECTS, MAP_AREAS, inArea,
    makeMap, shelfStock, shelfFill,
  };
});
