// Karten für Sternenschicht. Gemeinsamer Code (UMD): läuft im Browser (window.Shared_Maps)
// und in Node (require). Reine Daten + kleine Hilfsfunktionen, kein DOM.
// Vertrag: CONTRACT.md §4. Bug ist RECHTS (+x), Backbord OBEN (-y), Steuerbord UNTEN (+y).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Maps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Schiffsinneres der KRS Lerche (PAN-01 B „Drei Decks“): Atlas mit drei Decks übereinander, 40 x 45 Kacheln à 32 px, je Deck 13 Zeilen, Abstand 16.
  // Mitteldeck Zeilen 0–12 (Index 0), Oberdeck 16–28 (Index 1), Unterdeck 32–44 (Index 2); die Zeilen dazwischen sind leer (void). Dieselbe lokale Kachel liegt auf
  // dem Nachbardeck bei y ± 16, die Schächte (Lifts L1/L2, Notleiter) stehen auf allen Decks übereinander. Heck links, Bug rechts, Backbord oben, Steuerbord unten.
  // Mittelgang (Variante A, 3 Kacheln breit) von Heck-Lift L2 (x7–8) über den Maschinenraum bis zum Brückenlift L1 (x28–29), L1 ist die einzige Brückentür.
  // MITTELDECK  Antriebsraum x1–5 (Triebwerk E, Heck-Emitter A, Heckwaffe 2) – L2 – Lager (Regale L) / Heckgang / Transferkammer x7–13 –
  //   Maschinenraum x15–19 (Reaktor R, Schildgenerator G, Schalter y, Technik i, Notleiter !) – Batteriedecks Bb/Stb und Gang x21–27 – L1 – Brücke x29–38 (symmetrisch zu y = 6).
  // OBERDECK (privat: kein Feuer, kein Leck)  Quartiere B/0 (Koje, Spind) x7–13 und x21–27, Meetingraum x15–19 (Planungstisch Y, Handelskonsole S, Notleiter), Messe x29–38.
  // UNTERDECK (Ausbaudeck, kein Heck)  Modulräume 3/4 x7–13 und 1/2 x21–27 (q r h = Modulplätze, Ausstattung je Modul), Lafetten x15–19 (7 9 / 1 3), Bugraum x29–38 (Lanze K, Platz 5).
  // Sichtbar verschlossen (+) bis zum Ausbau: Modulraum 3 (Stufe 1), 4 (Stufe 2) und der Lafettenbereich (Stufe 1).
  //           0         1         2         3
  //           0123456789012345678901234567890123456789
  const SHIP_ROWS = [
    '########################################', // 0
    '#==u=f#.LLLLL.#y===u#=F=M=U=#.........p#', // 1
    '#A====#.......#=====#=======#..........#', // 2
    '#=====#.......#==R==#=======#..........#', // 3
    '#=====####D####=====##D##D####...W.....#', // 4
    '#=====#^^.....#=====#.......^^.........#', // 5
    '#E====D^^.....D==!==D.......^^.....H...#', // 6
    '#=====#^^.....#i====#.......^^.........#', // 7
    '#=====####D####=====##D##D####...C.....#', // 8
    '#=====#.......#==G==#=======#..........#', // 9
    '#2====#P.P....#=====#=======#..........#', // 10
    '#==u=f#.P...TX#u===y#=Z=J=V=#.........p#', // 11
    '########################################', // 12
    '                                        ', // 13
    '                                        ', // 14
    '                                        ', // 15
    '      ##################################', // 16
    '      #B,,,,,0#p:::p#B,,,,,0#::p:t:a:tj#', // 17
    '      #,,,,,,,#:YY::#,,,,,,,#::::::::::#', // 18
    '      #,,,,,,,#:YY::#,,,,,,,#::::::::::#', // 19
    '      ####D####:::::####D#####:::::::::#', // 20
    '      #^^:::::#:::::#:::::::^^:::::::::#', // 21
    '      #^^:::::D::!::D:::::::^^:::::::::#', // 22
    '      #^^:::::#:::::#:::::::^^:::::::::#', // 23
    '      ####D####:::::####D#####::::mm:::#', // 24
    '      #,,,,,,,#:S:::#,,,,,,,#:::::mm::z#', // 25
    '      #,,,,,,,#:::::#,,,,,,,#::::::::::#', // 26
    '      #B,,,,,0#p:::p#B,,,,,0#::p::::::e#', // 27
    '      ##################################', // 28
    '                                        ', // 29
    '                                        ', // 30
    '                                        ', // 31
    '      ##################################', // 32
    '      #.q.h.q.#=====#.q.h.q.#==========#', // 33
    '      #.......#=7=1=#.......#========K=#', // 34
    '      #.r...r.#=====#.r...r.#==========#', // 35
    '      ####+####=====####D#####=========#', // 36
    '      #^^.....#=====#.......^^=========#', // 37
    '      #^^.....D==!==+.......^^=========#', // 38
    '      #^^.....#=====#.......^^=========#', // 39
    '      ####+####=====####D#####=========#', // 40
    '      #.r...r.#=====#.r...r.#==========#', // 41
    '      #.......#=9=3=#.......#========5=#', // 42
    '      #.q.h.q.#=====#.q.h.q.#======I===#', // 43
    '      ##################################', // 44
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
    'i': { kind: 'console_technik', solid: true, interact: 'console', console: 'technik' },   // R1: Technik (Maschinenraum)
    'T': { kind: 'console_transfer', solid: true, interact: 'console', console: 'transfer' },
    'S': { kind: 'terminal_shop', solid: true, interact: 'console', console: 'shop' },
    'L': { kind: 'shelf', solid: true, interact: 'shelf' },          // nur Schiff; auf der Plattform: siehe PLATFORM_LEGEND
    'B': { kind: 'bed', solid: true, interact: 'bed' },
    'R': { kind: 'sys_reactor', solid: true, interact: 'system', system: 'reactor' },
    'E': { kind: 'sys_engines', solid: true, interact: 'system', system: 'engines' },
    'G': { kind: 'sys_shields', solid: true, interact: 'system', system: 'shields' },
    'K': { kind: 'sys_weapons', solid: true, interact: 'system', system: 'weapons' },
    'X': { kind: 'sys_transfer', solid: true, interact: 'system', system: 'transfer' },
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
  // PAN-01 B: Lafette eines Waffenplatzes (Ziffer = Taste am Ziffernblock). PAN-01 C: jede Lafette ist ein System (lafette_N) mit Station auf ihrer Kachel; Treffer und
  // Reparatur gelten nur, wenn der Platz offen (Ausbaustufe) UND bestückt ist (interior.systemAktiv), sonst zeigt die Kachel „frei“ bzw. „verschlossen“.
  const lafette = (platz, sector, side) => ({ kind: 'sys_lafette', solid: true, interact: 'lafette', system: 'lafette_' + platz, platz, sector, side });   // PAN-01 C: echtes System (aktiv nur mit offenem, bestücktem Platz)
  const SHIP_LEGEND = Object.assign({}, LEGEND, {
    'R': station('sys_reactor', 'reactor', -1, 'mid'),
    'G': station('sys_shields', 'shields', -1, 'mid'),
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
    // ---- M4 „Zwei Decks“, PAN-01 B „Drei Decks“ (SHIP_LIFTS, SHIP_LADDERS) ----
    '^': { kind: 'lift', interact: 'lift' },              // Liftplattform (2×3): E aktiviert, W/S wechselt das Deck; auf dem Mitteldeck läuft man ohne E hindurch
    '!': { kind: 'ladder', interact: 'ladder' },          // Notleiter: E aktiviert, W/S wechselt das Deck (langsamer als der Lift)
    ':': { kind: 'floor_mosaic' },                        // Mosaikboden (Oberdeck)
    'w': { kind: 'light_shaft', solid: true },            // Lichtschacht mit Glasboden und Geländer
    '%': { kind: 'window', solid: true },                 // Panoramafenster (Außenwand)
    't': { kind: 'trophy_niche', solid: true },           // Trophäennische (Funde, Messe)
    'a': { kind: 'shrine', solid: true },                 // Hausschrein (Lararium, Messe)
    'v': { kind: 'med_bed', solid: true },                // Krankenliege (Kulisse)
    'o': { kind: 'bath', solid: true },                   // Becken (Kulisse)
    's': { kind: 'bench', solid: true },                  // Aussichtsbank (Kulisse)
    'j': { kind: 'sideboard', solid: true },              // Anrichte/Kombüse in der Messe
    // R0: Schlafecke in der Messe (Raum nutzung 'quartier', siehe SHIP_ROOMS). Immer solide; ohne Bewohner zeigt die Darstellung Stauware
    // statt Pritsche und Werkzeugwand, damit die Kachel nie unsichtbar blockiert.
    'e': { kind: 'cargo_cot', solid: true },              // Pritsche (Kulisse)
    'z': { kind: 'tool_wall', solid: true },              // Werkzeugwand (Kulisse)
    '0': { kind: 'locker', solid: true },                 // PAN-01 B: Spind im Quartier (Kulisse; Optik-Einstellungen später)
    // ---- PAN-01 B: Modulräume (vier gleich große Räume, jedes Modul in jedem Raum). Die Kacheln q/r/h stehen in jedem Raum an denselben Stellen und sind
    // immer solide; was sie darstellen, hängt vom Modul im Raum ab (Frachtraum: Bucht, Bett, Stapel · Krankenstation: Liege, Liege, Scanner · Werkstatt: Werkbank,
    // Werkzeugwand, Maschine · ohne Modul: Stauware). Zustand (Ware, Person) kommt aus snapshot.fracht, das Modul aus snapshot.ship.mod.
    'q': { kind: 'mod_a', solid: true },                  // Modulplatz A (2 je Raum): Frachtbucht (CARGO_BAYS)
    'r': { kind: 'mod_b', solid: true },                  // Modulplatz B (2 je Raum): Frachtbett (CARGO_BEDS)
    'h': { kind: 'mod_c', solid: true },                  // Modulplatz C (1 je Raum): Zierstück des Moduls
    '+': { kind: 'door_sealed', solid: true },            // verschalte Pforte (SHIP_SEALS): solide, bis die Ausbaustufe sie öffnet
    // Lafetten der Waffenplätze (WAFFENPLAETZE); 8, 4 und 6 sind die Stationen K, M und J
    '1': lafette(1, 3, 'port'), '2': lafette(2, 2, 'aft'), '3': lafette(3, 1, 'stbd'),
    '5': lafette(5, 0, 'bow'), '7': lafette(7, 3, 'port'), '9': lafette(9, 1, 'stbd'),
  });

  // Regale im Lager: x-Kachel -> Gegenstand (Zeile 1). Altname; maßgeblich ist SHELF_TILES.
  const SHELVES = { 8: 'ersatzteil', 9: 'loeschgel', 10: 'flickblech', 11: 'bolzen', 12: 'medipack' };   // PAN-01 B (Feedback 1): zentriert im Lager (x 7–13, Mitte x 10)

  // ---- PAN-01 B „Drei Decks“: Decks im Atlas ----
  // idx = Deck-Index (so zählen deckOf, Snapshot `deck`, Renderer), level = Höhenlage (Unterdeck −1, Mitteldeck 0, Oberdeck +1: bestimmt die Richtung der Liftblende).
  const DECK_STRIDE = 16;
  const SHIP_DECKS = [
    { id: 'mittel', name: 'Mitteldeck', idx: 0, level: 0, y0: 0, y1: 12 },
    { id: 'ober', name: 'Oberdeck', idx: 1, level: 1, y0: 16, y1: 28 },
    { id: 'unter', name: 'Unterdeck', idx: 2, level: -1, y0: 32, y1: 44 },
  ];
  const DECK_HOCH = [2, 0, 1];   // Deck-Indizes von unten nach oben
  const STUFE_MAX = 3;
  // Deck-Index einer Atlas-Kachelzeile (0 Mittel, 1 Ober, 2 Unter), -1 in der Lücke (oder außerhalb).
  function deckOf(ty) {
    for (const d of SHIP_DECKS) if (ty >= d.y0 && ty <= d.y1) return d.idx;
    return -1;
  }
  // Deck einer Spiel-Pixel-y-Koordinate (Schiff)
  function deckOfPx(py) { return deckOf(Math.floor(py / 32)); }
  // Zeile relativ zum eigenen Deck (Oberdeck: ty − 16, Unterdeck: ty − 32); in der Lücke ty − 0
  function deckLocalY(ty) { const d = deckOf(ty); return d > 0 ? ty - d * DECK_STRIDE : ty; }
  // Dieselbe lokale Kachel auf dem Deck `deck` (null in der Lücke).
  function deckTile(tx, ty, deck) {
    if (deckOf(ty) < 0 || !(deck >= 0 && deck < SHIP_DECKS.length)) return null;
    return { x: tx, y: deckLocalY(ty) + deck * DECK_STRIDE };
  }
  // Lifts: 2×3-Plattform auf allen Decks an derselben Stelle (Kacheln lokal zum Deck). gate = Deck-Index -> Ausbaustufe, ab der die Fahrt dorthin geht.
  // L1 (Brückenlift) fährt von Anfang an alle drei Decks. Hecklift L2 und Notleiter erreichen das Unterdeck erst mit Stufe 1.
  const SHIP_LIFTS = [
    { id: 'L1', name: 'Brückenlift', tiles: [[28, 5], [29, 5], [28, 6], [29, 6], [28, 7], [29, 7]], gate: {} },
    { id: 'L2', name: 'Hecklift', tiles: [[7, 5], [8, 5], [7, 6], [8, 6], [7, 7], [8, 7]], gate: { 2: 1 } },
  ];
  // Notleiter mittig im Maschinenraum (Mitteldeck), darüber der Meetingraum, darunter der Lafettenbereich.
  const SHIP_LADDERS = [{ id: 'H', name: 'Notleiter', x: 17, y: 6, gate: { 2: 1 } }];
  // Ist (tx,ty) eine Liftkachel (auf irgendeinem Deck)? -> Lift-Eintrag oder null
  function liftAt(tx, ty) {
    if (deckOf(ty) < 0) return null;
    const ly = deckLocalY(ty);
    return SHIP_LIFTS.find((l) => l.tiles.some((t) => t[0] === tx && t[1] === ly)) || null;
  }
  // Ist (tx,ty) eine Notleiterkachel? -> Leiter-Eintrag oder null
  function ladderAt(tx, ty) {
    if (deckOf(ty) < 0) return null;
    const ly = deckLocalY(ty);
    return SHIP_LADDERS.find((l) => l.x === tx && l.y === ly) || null;
  }
  // Fahrtziel von einer Lift-/Leiterkachel: dir +1 = nach oben (W), −1 = nach unten (S), je ein Deck weiter. stufe = Ausbaustufe (null: ohne Sperre).
  // -> { x, y, deck, via: 'lift'|'ladder' } oder null (kein Deck in dieser Richtung oder noch nicht ausgebaut)
  function fahrtZiel(tx, ty, dir, stufe) {
    const d = deckOf(ty);
    const lift = liftAt(tx, ty), lad = lift ? null : ladderAt(tx, ty);
    const ev = lift || lad;
    if (d < 0 || !ev) return null;
    const j = DECK_HOCH.indexOf(d) + (dir > 0 ? 1 : -1);
    if (j < 0 || j >= DECK_HOCH.length) return null;
    const nd = DECK_HOCH[j];
    if (stufe != null && stufe < ((ev.gate && ev.gate[nd]) || 0)) return null;
    return { x: tx, y: deckLocalY(ty) + nd * DECK_STRIDE, deck: nd, via: lad ? 'ladder' : 'lift' };
  }
  // Welche Richtungen zeigt der Lift/die Leiter an dieser Kachel? { up, down } (nur mögliche)
  function fahrtOptionen(tx, ty, stufe) { return { up: !!fahrtZiel(tx, ty, 1, stufe), down: !!fahrtZiel(tx, ty, -1, stufe) }; }
  // Übergänge zwischen den Decks als BFS-Kanten: links(x, y) -> [{x, y, via: 'lift'|'ladder'}].
  // opts.ladder = false: ohne Notleiter (Bots benutzen nie die Leiter). opts.stufe: Ausbaustufe (Standard: voll ausgebaut).
  function deckLinks(tx, ty, opts) {
    const out = [];
    const st = opts && opts.stufe != null ? opts.stufe : STUFE_MAX;
    const noLadder = !!(opts && opts.ladder === false);
    for (const dir of [1, -1]) {
      const z = fahrtZiel(tx, ty, dir, st);
      if (z && (z.via === 'lift' || !noLadder)) out.push({ x: z.x, y: z.y, via: z.via });
    }
    return out;
  }
  // Verschalte Pforten ('+', solide bis zur Ausbaustufe): Modulraum 3 (Stufe 1), Modulraum 4 (Stufe 2), Lafettenbereich (Stufe 1). Atlas-Kacheln auf dem Unterdeck.
  const SHIP_SEALS = [
    { id: 'modul3', name: 'Modulraum 3', x: 10, y: 36, stufe: 1 },
    { id: 'modul4', name: 'Modulraum 4', x: 10, y: 40, stufe: 2 },
    { id: 'lafetten', name: 'Lafettenbereich', x: 20, y: 38, stufe: 1 },
  ];
  function sealAt(tx, ty) { return SHIP_SEALS.find((s) => s.x === tx && s.y === ty) || null; }
  // Ist die Pforte bei dieser Ausbaustufe offen? (Kachel ohne Pforte: true)
  function sealOpen(tx, ty, stufe) { const s = sealAt(tx, ty); return !s || stufe >= s.stufe; }

  // PAN-01 B: Modulräume 1–4 (Unterdeck). raum = Nummer wie in module.js, room = SHIP_ROOMS-Id, stufe = Ausbaustufe, ab der der Raum offen ist.
  const MODUL_RAEUME = [
    { raum: 1, room: 'modul1', stufe: 0 }, { raum: 2, room: 'modul2', stufe: 0 },
    { raum: 3, room: 'modul3', stufe: 1 }, { raum: 4, room: 'modul4', stufe: 2 },
  ];
  // Offene Modulräume bei dieser Ausbaustufe (Stufe 0: 1, 2 · Stufe 1: + 3 · Stufe 2: + 4)
  function modulRaeumeOffen(stufe) { return MODUL_RAEUME.filter((r) => stufe >= r.stufe).map((r) => r.raum); }

  // PAN-01 B: die neun Waffenplätze (Taste am Ziffernblock). x/y = Lafettenkachel im Atlas; system = Name des Systems (8, 4, 6 sind die Startwaffen und tragen ihre
  // Station weiter; die übrigen bekommen ihr System, wenn Paket C sie mit Waffen belegt). stufe = Ausbaustufe, ab der der Platz offen ist.
  const WAFFENPLAETZE = [
    { platz: 8, art: 'bug', stufe: 0, sector: 0, side: 'bow', system: 'weapon_bow', x: 37, y: 34 },
    { platz: 4, art: 'seite', stufe: 0, sector: 3, side: 'port', system: 'battery_port', x: 24, y: 1 },
    { platz: 6, art: 'seite', stufe: 0, sector: 1, side: 'stbd', system: 'battery_stbd', x: 24, y: 11 },
    { platz: 7, art: 'seite', stufe: 1, sector: 3, side: 'port', system: 'lafette_7', x: 16, y: 34 },
    { platz: 9, art: 'seite', stufe: 1, sector: 1, side: 'stbd', system: 'lafette_9', x: 16, y: 42 },
    { platz: 2, art: 'heck', stufe: 2, sector: 2, side: 'aft', system: 'lafette_2', x: 1, y: 10 },
    { platz: 5, art: 'bug', stufe: 2, sector: 0, side: 'bow', system: 'lafette_5', x: 37, y: 42 },
    { platz: 1, art: 'seite', stufe: 3, sector: 3, side: 'port', system: 'lafette_1', x: 18, y: 34 },
    { platz: 3, art: 'seite', stufe: 3, sector: 1, side: 'stbd', system: 'lafette_3', x: 18, y: 42 },
  ];
  function waffenplatz(platz) { return WAFFENPLAETZE.find((p) => p.platz === platz) || null; }
  function waffenplatzAt(tx, ty) { return WAFFENPLAETZE.find((p) => p.x === tx && p.y === ty) || null; }
  // Offene Waffenplätze bei dieser Ausbaustufe (Stufe 0: 8 4 6 · 1: + 7 9 · 2: + 2 5 · 3: + 1 3), in Reihenfolge der Tabelle
  function plaetzeOffen(stufe) { return WAFFENPLAETZE.filter((p) => stufe >= p.stufe).map((p) => p.platz); }

  // PAN-01 B: Andockpunkte der Optik (Bug, Triebwerk, Banner, Lafetten), nur Datenpunkte: x/y in Kacheln der Draufsicht (0,0 = Heck/Backbord, Länge 40, Breite 13).
  const ANDOCKPUNKTE = [
    { id: 'bug', art: 'bugzier', x: 40, y: 6.5 },
    { id: 'triebwerk', art: 'triebwerk', x: 0, y: 6.5 },
    { id: 'banner_bb', art: 'banner', x: 8, y: 0 },
    { id: 'banner_stb', art: 'banner', x: 8, y: 13 },
  ].concat(WAFFENPLAETZE.map((p) => ({ id: 'lafette_' + p.platz, art: 'lafette', platz: p.platz, x: p.x + 0.5, y: (p.y % DECK_STRIDE) + 0.5 })));

  // 4 Einzelquartiere (7×3) auf dem Oberdeck. color 0–3 = Spielerfarbe. Deko-Slots sind Bodenkacheln. Das Quartier hat Koje B und Spind 0.
  const BEDS = [
    { color: 0, x: 7, y: 17, room: { id: 'q0', x0: 7, y0: 17, x1: 13, y1: 19 },
      slots: [{ id: 'q0a', x: 9, y: 17 }, { id: 'q0b', x: 11, y: 17 }, { id: 'q0c', x: 13, y: 19 }, { id: 'q0d', x: 7, y: 19 }] },
    { color: 1, x: 7, y: 27, room: { id: 'q1', x0: 7, y0: 25, x1: 13, y1: 27 },
      slots: [{ id: 'q1a', x: 9, y: 27 }, { id: 'q1b', x: 11, y: 27 }, { id: 'q1c', x: 13, y: 25 }, { id: 'q1d', x: 7, y: 25 }] },
    { color: 2, x: 21, y: 17, room: { id: 'q2', x0: 21, y0: 17, x1: 27, y1: 19 },
      slots: [{ id: 'q2a', x: 23, y: 17 }, { id: 'q2b', x: 25, y: 17 }, { id: 'q2c', x: 27, y: 19 }, { id: 'q2d', x: 21, y: 19 }] },
    { color: 3, x: 21, y: 27, room: { id: 'q3', x0: 21, y0: 25, x1: 27, y1: 27 },
      slots: [{ id: 'q3a', x: 23, y: 27 }, { id: 'q3b', x: 25, y: 27 }, { id: 'q3c', x: 27, y: 25 }, { id: 'q3d', x: 21, y: 25 }] },
  ];
  // Reaktor-Neustartschalter im Maschinenraum mittschiffs: A oben links (15,1), B unten rechts (19,11).
  const REACTOR_SWITCHES = [{ id: 'A', x: 15, y: 1 }, { id: 'B', x: 19, y: 11 }];

  // UI-Sitz (Kai 2026-10-14): Hauptschirm an der Bugwand der Brücke. Wandkacheln x, Reihen y0–y1 (Mitteldeck); dort hängen keine Wandleuchten.
  const HAUPTSCHIRM = { deck: 0, x: 39, y0: 4, y1: 8 };
  // Feste Ausrichtung je Konsolenart (Vorderseite des Modells: 'w' | 'o' | 'n' | 's'); sonst zeigt sie zur ersten freien Seite.
  // Brückenpulte: Bediener steht westlich und blickt zum Schirm; der Captainstuhl blickt mit der Sitzfläche zum Schirm.
  const KONSOLEN_FRONT = { helm: 'w', weapons: 'w', captain: 'o' };
  const SHIP_SPAWNS = [{ x: 21, y: 6 }, { x: 23, y: 6 }, { x: 25, y: 6 }, { x: 27, y: 6 }];   // R0: 4 Spieler, Gang auf dem Mitteldeck
  const BOT_SPAWNS = [{ x: 16, y: 6 }, { x: 10, y: 6 }, { x: 23, y: 7 }];
  const PLATFORM_PADS = [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 4 }];
  // Ivo (Techniker an Bord) schlendert zwischen diesen Bodenkacheln – alle auf dem Oberdeck, er benutzt weder Lift noch Leiter.
  // Erster und letzter Punkt = sein Platz neben der Pritsche in der Messe (R0; Raum mit nutzung 'quartier').
  const IVO_SPOTS = [{ x: 37, y: 27 }, { x: 17, y: 20 }, { x: 10, y: 22 }, { x: 24, y: 22 }, { x: 17, y: 25 }, { x: 36, y: 22 }, { x: 33, y: 19 }, { x: 37, y: 27 }];
  // R0: Hier verlässt Ivo das Schiff, wenn die Crew ihn an einer Station abgibt: Kachel unter dem Hafenterminal (Meetingraum, Oberdeck).
  const IVO_AUSSTIEG = { x: 16, y: 26 };

  // Räume in Prüfreihenfolge (erster Treffer gilt). kind 'engine' = Maschinen-/Antriebsraum, 'quarter' = Quartier, 'lift', 'modul' (Modulraum), 'lafetten'.
  // sector: Schildsektor 0–3 des Raums, -1 = mittschiffs (kein Sektor). deck: Deck-Index (0 Mitteldeck, 1 Oberdeck, 2 Unterdeck). stufe: Ausbaustufe, ab der der Raum offen ist
  // (Feuer und Lecks entstehen vorher dort nicht). Gangräume decken die Türkacheln mit ab.
  const SHIP_ROOMS = [
    // Mitteldeck
    { id: 'lift1', name: 'Brückenlift', kind: 'lift', sector: -1, deck: 0, x0: 28, y0: 5, x1: 29, y1: 7 },
    { id: 'lift2', name: 'Hecklift', kind: 'lift', sector: -1, deck: 0, x0: 6, y0: 5, x1: 8, y1: 7 },
    { id: 'antrieb', name: 'Antriebsraum', kind: 'engine', sector: 2, deck: 0, x0: 1, y0: 1, x1: 5, y1: 11 },
    { id: 'maschinenraum', name: 'Maschinenraum', kind: 'engine', sector: -1, deck: 0, x0: 15, y0: 1, x1: 19, y1: 11 },
    { id: 'bruecke', name: 'Brücke', kind: 'room', sector: 0, deck: 0, x0: 29, y0: 1, x1: 38, y1: 11 },
    { id: 'lager', name: 'Lager', kind: 'room', sector: 3, deck: 0, x0: 7, y0: 1, x1: 13, y1: 3 },
    { id: 'transfer', name: 'Transferkammer', kind: 'room', sector: 1, deck: 0, x0: 7, y0: 9, x1: 13, y1: 11 },
    { id: 'heckgang', name: 'Heckgang', kind: 'room', sector: -1, deck: 0, x0: 9, y0: 4, x1: 14, y1: 8 },
    { id: 'batterie_bb', name: 'Batteriedeck Backbord', kind: 'room', sector: 3, deck: 0, x0: 21, y0: 1, x1: 27, y1: 3 },
    { id: 'batterie_stb', name: 'Batteriedeck Steuerbord', kind: 'room', sector: 1, deck: 0, x0: 21, y0: 9, x1: 27, y1: 11 },
    { id: 'gang', name: 'Gang', kind: 'room', sector: -1, deck: 0, x0: 20, y0: 4, x1: 27, y1: 8 },
    // Oberdeck (alle Sektor -1: kein Feuer, kein Leck)
    { id: 'lift1_ober', name: 'Brückenlift', kind: 'lift', sector: -1, deck: 1, x0: 28, y0: 21, x1: 29, y1: 23 },
    { id: 'lift2_ober', name: 'Hecklift', kind: 'lift', sector: -1, deck: 1, x0: 6, y0: 21, x1: 8, y1: 23 },
    { id: 'q0', name: 'Quartier 1', kind: 'quarter', sector: -1, deck: 1, x0: 7, y0: 17, x1: 13, y1: 19 },
    { id: 'q1', name: 'Quartier 2', kind: 'quarter', sector: -1, deck: 1, x0: 7, y0: 25, x1: 13, y1: 27 },
    { id: 'q2', name: 'Quartier 3', kind: 'quarter', sector: -1, deck: 1, x0: 21, y0: 17, x1: 27, y1: 19 },
    { id: 'q3', name: 'Quartier 4', kind: 'quarter', sector: -1, deck: 1, x0: 21, y0: 25, x1: 27, y1: 27 },
    { id: 'meeting', name: 'Meetingraum', kind: 'room', sector: -1, deck: 1, x0: 15, y0: 17, x1: 19, y1: 27 },
    { id: 'heckgang_ober', name: 'Heckgang', kind: 'room', sector: -1, deck: 1, x0: 9, y0: 20, x1: 14, y1: 24 },
    { id: 'gang_ober', name: 'Gang', kind: 'room', sector: -1, deck: 1, x0: 20, y0: 20, x1: 27, y1: 24 },
    // R0: Aufenthaltsraum mit Schlafecke – nutzung: wofür der Raum dient (Darstellung und Regeln hängen daran, nicht an Ivo)
    { id: 'messe', name: 'Messe', kind: 'room', sector: -1, deck: 1, x0: 29, y0: 17, x1: 38, y1: 27, nutzung: ['quartier'] },
    // Unterdeck (Ausbaudeck): Module und Lafetten dürfen getroffen werden
    { id: 'lift1_unter', name: 'Brückenlift', kind: 'lift', sector: -1, deck: 2, x0: 28, y0: 37, x1: 29, y1: 39 },
    { id: 'lift2_unter', name: 'Hecklift', kind: 'lift', sector: -1, deck: 2, x0: 6, y0: 37, x1: 8, y1: 39, stufe: 1 },
    { id: 'modul1', name: 'Modulraum 1', kind: 'modul', modul: 1, sector: 3, deck: 2, x0: 21, y0: 33, x1: 27, y1: 35 },
    { id: 'modul2', name: 'Modulraum 2', kind: 'modul', modul: 2, sector: 1, deck: 2, x0: 21, y0: 41, x1: 27, y1: 43 },
    { id: 'modul3', name: 'Modulraum 3', kind: 'modul', modul: 3, sector: 3, deck: 2, x0: 7, y0: 33, x1: 13, y1: 35, stufe: 1 },
    { id: 'modul4', name: 'Modulraum 4', kind: 'modul', modul: 4, sector: 1, deck: 2, x0: 7, y0: 41, x1: 13, y1: 43, stufe: 2 },
    { id: 'weg_heck', name: 'Heckweg', kind: 'room', sector: -1, deck: 2, x0: 9, y0: 36, x1: 14, y1: 40, stufe: 1 },
    { id: 'weg_ost', name: 'Bugweg', kind: 'room', sector: -1, deck: 2, x0: 20, y0: 36, x1: 27, y1: 40 },
    { id: 'lafetten_bb', name: 'Lafetten Backbord', kind: 'lafetten', sector: 3, deck: 2, x0: 15, y0: 33, x1: 19, y1: 37, stufe: 1 },
    { id: 'lafetten_mitte', name: 'Lafettengang', kind: 'lafetten', sector: -1, deck: 2, x0: 15, y0: 38, x1: 19, y1: 38, stufe: 1 },
    { id: 'lafetten_stb', name: 'Lafetten Steuerbord', kind: 'lafetten', sector: 1, deck: 2, x0: 15, y0: 39, x1: 19, y1: 43, stufe: 1 },
    { id: 'bugraum', name: 'Bugraum', kind: 'room', sector: 0, deck: 2, x0: 29, y0: 33, x1: 38, y1: 43 },
  ];
  // PAN-01 B: Modulplätze je Modulraum aus der Karte (Kacheln q = Bucht, r = Bett) – eine Quelle mit der Karte, keine zweite Koordinatenliste.
  // Der Zugang liegt in der mittleren Reihe des Raums (dort ist immer Boden). Reihenfolge: Raum, dann x.
  function modulPlaetze(ch, prefix) {
    const out = [];
    for (const m of MODUL_RAEUME) {
      const r = SHIP_ROOMS.find((q) => q.id === m.room);
      const midY = (r.y0 + r.y1) >> 1;
      const list = [];
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (SHIP_ROWS[y][x] === ch) list.push({ x, y });
      list.sort((a, b) => a.x - b.x);
      list.forEach((t, i) => out.push({ id: prefix + ((m.raum - 1) * 2 + i), raum: m.raum, x: t.x, y: t.y, access: { x: t.x, y: midY } }));
    }
    return out;
  }
  // EK3 Teil A / PAN-01 B: Frachtbuchten in den Modulräumen (4 Räume × 2). Eine Bucht fasst genau eine Ladung. Belegt sind nur die Buchten der Räume, in denen das Modul
  // Frachtraum steht (frachtPlaetze), je Frachtraum 2 Plätze. Kein Schiffssystem (keine Treffer-Wirkung, nur die Energie des Moduls).
  const CARGO_BAYS = modulPlaetze('q', 'bay');
  const CARGO_PER_RAUM = 2;
  function cargoBayAt(tx, ty) { return CARGO_BAYS.find((b) => b.x === tx && b.y === ty) || null; }
  // SL0 / PAN-01 B: Betten für Personen (2 je Modulraum). Eine Person an Bord belegt einen Frachtplatz (gemeinsam mit den Buchten) und liegt auf einem Bett eines Frachtraums.
  const CARGO_BEDS = modulPlaetze('r', 'bett');
  function cargoBedAt(tx, ty) { return CARGO_BEDS.find((b) => b.x === tx && b.y === ty) || null; }
  // Aktive Buchten und Betten für die Modulräume `raeume` (Nummern der Räume, in denen ein Frachtraum steht): { bays, beds }, Reihenfolge nach Raum und x.
  function frachtPlaetze(raeume) {
    const set = new Set(raeume || []);
    return { bays: CARGO_BAYS.filter((b) => set.has(b.raum)), beds: CARGO_BEDS.filter((b) => set.has(b.raum)) };
  }
  // Frachtkapazität (Plätze für Waren und Personen) bei diesen Frachträumen: 2 je Raum
  function cargoCapacity(raeume) { return new Set(raeume || []).size * CARGO_PER_RAUM; }
  // Client: Module aus dem Snapshot-Feld ship.mod ([[code, raum, an, läuft]]; Codes CONFIG.module.codes: f Frachtraum, k Krankenstation, w Werkstatt)
  const MODUL_CODE_FRACHT = 'f';
  function frachtRaeumeAusMod(mod) { return (mod || []).filter((m) => m && m[0] === MODUL_CODE_FRACHT).map((m) => m[1]); }
  function modulCodeImRaum(mod, raum) { const m = (mod || []).find((q) => q && q[1] === raum); return m ? m[0] : null; }
  // Raum einer Kachel (oder null außerhalb aller Räume).
  function roomAt(tx, ty) {
    for (const r of SHIP_ROOMS) if (tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1) return r;
    return null;
  }
  // R0: Nutzung des Raums an dieser Kachel (Messe: ['quartier']); leer, wenn der Raum keine Nutzung vorgibt.
  function nutzungAt(tx, ty) { const r = roomAt(tx, ty); return (r && r.nutzung) || []; }

  // Schiffsbereiche je Schildsektor (Treffer -> Feuer, Hüllenbruch; systems = Stationen des Sektors).
  // Sektor-Index: 0 = Bug (vorn), 1 = Steuerbord (rechts/unten), 2 = Heck, 3 = Backbord (links/oben). Mittschiffs gehört zu keinem. Mittel- und Unterdeck gehören gemeinsam dazu.
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
  // PAN-01 B: Feuer im Heckgang (Mitteldeck), Leck im Lager
  const SHIP_DRILL = { fire: { x: 11, y: 6 }, breach: { x: 7, y: 3 } };
  // Kann auf dieser Schiffskachel ein Feuer oder Leck entstehen? Nur auf Mittel- und Unterdeck (das Oberdeck ist privat), nie auf Lift/Leiter, nie auf soliden
  // Kacheln. stufe (Ausbaustufe, optional): in Räumen, die noch nicht ausgebaut sind, entsteht nichts (dort kommt niemand hin).
  function hazardAllowed(tx, ty, stufe) {
    const d = deckOf(ty);
    if (d !== 0 && d !== 2) return false;
    const info = SHIP_LEGEND[(SHIP_ROWS[ty] || '')[tx]];
    if (!info || info.solid) return false;
    if (info.kind === 'lift' || info.kind === 'ladder') return false;
    if (stufe != null) { const r = roomAt(tx, ty); if (r && r.stufe && stufe < r.stufe) return false; }
    return true;
  }
  // Solid-Funktion der Schiffskarte bei dieser Ausbaustufe: verschalte Pforten sind offen, sobald die Stufe reicht.
  function shipSolidFn(stufe) {
    return (tx, ty) => {
      const info = SHIP_LEGEND[(SHIP_ROWS[ty] || '')[tx]] || SHIP_LEGEND['#'];
      if (!info.solid) return false;
      return info.kind === 'door_sealed' ? !sealOpen(tx, ty, stufe) : true;
    };
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
  // B1 (BUEHNE, CONTRACT-B1 §2): Bereiche gebauter Karten tragen Rechtecklisten { rects: [[x, y, w, h], …] }.
  function inArea(mapId, areaId, tx, ty) {
    const a = MAP_AREAS[mapId] && MAP_AREAS[mapId][areaId];
    if (!a) return false;
    if (a.rects) { for (const q of a.rects) if (tx >= q[0] && tx < q[0] + q[2] && ty >= q[1] && ty < q[1] + q[3]) return true; return false; }
    if (a.cols) return tx >= a.cols[0] && tx <= a.cols[1];
    if (a.rect) return tx >= a.rect[0] && tx < a.rect[0] + a.rect[2] && ty >= a.rect[1] && ty < a.rect[1] + a.rect[3];
    return false;
  }

  // ---- B1 (BUEHNE, CONTRACT-B1 §6.3): Anker der Handkarten (Rollen aus content/buehnen/anker.json) ----
  // alt = altes Objekt in MAP_OBJECTS (Adapter ENGINE); viele Objekte (container, key) in der Reihenfolge von find().
  // Handkarten-Anker dürfen auf Objektkacheln stehen (die Objekte sind dort Kacheln); IDs <bereich>.<rolle>[.<n>].
  function ankerAus(rows, ch) { const out = []; rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === ch) out.push({ x, y }); }); return out; }
  function nummeriert(list, id, rolle, extra) {
    return list.map((t, i) => Object.assign({ id: list.length > 1 ? `${id}.${rolle}.${i + 1}` : `${id}.${rolle}`, rolle, x: t.x, y: t.y }, extra));
  }
  const MAP_ANCHORS = {
    platform: [].concat(
      [{ id: 'landedeck.abholpunkt', rolle: 'abholpunkt', x: PLATFORM_PADS[0].x, y: PLATFORM_PADS[0].y, ankunft: true, alt: 'pads' }],
      nummeriert(ankerAus(PLATFORM_ROWS, 'Q'), 'kernraum', 'ziel', { alt: 'datenkern', bereich: 'kernraum' }),
      nummeriert(ankerAus(PLATFORM_ROWS, 'N'), 'nordraum', 'nsc', { alt: 'ivo', bereich: 'nordraum' }),
      nummeriert(ankerAus(PLATFORM_ROWS, 'd'), 'halle', 'wache', { bereich: 'halle' })),
    wreck: [].concat(
      [{ id: 'vorderdeck.abholpunkt', rolle: 'abholpunkt', x: WRECK_PADS[0].x, y: WRECK_PADS[0].y, ankunft: true, alt: 'pads' }],
      nummeriert(ankerAus(WRECK_ROWS, 'h'), 'laderaum', 'beute', { alt: 'container' }),
      nummeriert(ankerAus(WRECK_ROWS, 'g'), 'laderaum', 'terminal', { alt: 'lore', bereich: 'laderaum' }),
      nummeriert(ankerAus(WRECK_ROWS, 'V'), 'hohlraum', 'versteck', { alt: 'hollow', bereich: 'hohlraum' }),
      nummeriert(ankerAus(WRECK_ROWS, 'a'), 'laderaum', 'wache', { bereich: 'laderaum' })),
    kesh: [].concat(
      [{ id: 'landezone.abholpunkt', rolle: 'abholpunkt', x: KESH_PADS[0].x, y: KESH_PADS[0].y, ankunft: true, alt: 'pads', bereich: 'landezone' }],
      [{ id: 'hof.eingang', rolle: 'eingang', x: 9, y: 15, art: 'laut', bereich: 'landezone' }],
      nummeriert(ankerAus(KESH_ROWS, 'G').slice(0, 1), 'gewoelbe', 'tor', { alt: 'vault', bereich: 'gewoelbe' }),
      nummeriert(ankerAus(KESH_ROWS, 'k'), 'halle', 'raetsel', { paar: 'A', alt: 'key', bereich: 'halle' }),
      nummeriert(ankerAus(KESH_ROWS, 'T'), 'gewoelbe', 'fund', { alt: 'tablet', bereich: 'gewoelbe' }),
      nummeriert(ankerAus(KESH_ROWS, 'L'), 'halle', 'wache', { schwer: true, alt: 'warden', bereich: 'halle' }).map((a) => Object.assign(a, { id: 'halle.waechter' })),
      nummeriert(ankerAus(KESH_ROWS, 'a'), 'hof', 'wache', { bereich: 'hof' }),
      nummeriert(ankerAus(KESH_ROWS, 'r'), 'hof', 'ziel', { alt: 'jammer' })),
  };

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
    SHELVES, BEDS, REACTOR_SWITCHES, SHIP_SPAWNS, BOT_SPAWNS, HAUPTSCHIRM, KONSOLEN_FRONT, PLATFORM_PADS, SECTOR_REGIONS,
    // M3a Schritt 0: Schiffslayout als Daten (CONTRACT-M3 §3)
    SHIP_ROOMS, SHELF_TILES, SHIP_DRILL, roomAt, nutzungAt, shelfAt, CARGO_BAYS, CARGO_PER_RAUM, cargoBayAt, CARGO_BEDS, cargoBedAt, frachtPlaetze, cargoCapacity, frachtRaeumeAusMod, modulCodeImRaum, MODUL_CODE_FRACHT,
    // M3a: Schiffslegende mit Stationen, Ivo-Wegpunkte, Sektornamen
    SHIP_LEGEND, IVO_SPOTS, IVO_AUSSTIEG, SECTOR_NAMES,
    // M4 „Zwei Decks“ (CONTRACT-M4 §2.3), PAN-01 B „Drei Decks“: Decks, Lifts, Notleiter, Ausbaustufen, Waffenplätze, Modulräume
    DECK_STRIDE, SHIP_DECKS, DECK_HOCH, STUFE_MAX, SHIP_LIFTS, SHIP_LADDERS, SHIP_SEALS, deckOf, deckOfPx, deckLocalY, deckTile, liftAt, ladderAt, fahrtZiel, fahrtOptionen, deckLinks,
    sealAt, sealOpen, shipSolidFn, hazardAllowed, MODUL_RAEUME, modulRaeumeOffen, WAFFENPLAETZE, waffenplatz, waffenplatzAt, plaetzeOffen, ANDOCKPUNKTE,
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
    // B1 (BUEHNE): Anker der Handkarten
    MAP_ANCHORS,
    makeMap, shelfStock, shelfFill,
  };
});
