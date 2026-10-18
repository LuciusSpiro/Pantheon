# CONTRACT-PAN01-B – Lerche neu: drei Decks, Plätze, Modulräume (PAN-01 Paket B)

Stand: 2026-10-18, Branch `pan01-b` (baut auf `pan01-a` 3c368d9 auf). Grundlage: Auftrag PAN-01 (Vault `Pantheon/Auftrag PAN-01 – Lerche-Ausbau, Werft, Waffen und Module.md`), `Schiffe/Lerche.md`, `Lerche – Grundriss-Varianten.md` (Variante A „Mittelgang“).
Vorgänger: `CONTRACT-PAN01-A.md` (Energie, Module als Daten). Folgepakete: C (Waffen auf den Lafetten), D (Werft setzt `ship.stufe`, `module`). Modellliste für das Voxelwerk: `CONTRACT-PAN01-B-MODELLE.md`.

## 1. Kachelplan

Rumpf **40 × 13 Kacheln je Deck**, Atlas 40 × 45 (`DECK_STRIDE` 16, drei leere Zeilen zwischen den Decks). Deck-Index (`deckOf`, Snapshot `players[].deck`): **0 Mitteldeck**, **1 Oberdeck**, **2 Unterdeck**; die Höhenlage (`SHIP_DECKS[].level`: Oberdeck +1, Mitteldeck 0, Unterdeck −1) bestimmt nur die Richtung der Liftblende. Dieselbe lokale Kachel liegt auf dem Nachbardeck bei y ± 16 (Mittel → Ober: +16, Mittel → Unter: +32). Die Brücke ist 10 × 11, der Maschinenraum 5 × 11 (wie zuvor); der Rumpf wuchs von 37 auf 40 Kacheln Länge (Antrieb 3 → 5, Lager/Transfer 5 → 7, Batterien 8 → 7), die Breite blieb 13: Draufsicht und Außenform ändern sich kaum.

Legende (neu in `SHIP_LEGEND`): `q` Modulplatz A, `r` Modulplatz B, `h` Modulplatz C (je Modulraum 2 / 2 / 1), `+` verschalte Pforte, `1 2 3 5 7 9` Lafetten der Waffenplätze (8, 4, 6 bleiben die Stationen `K`, `M`, `J`), `0` Spind; `^` Lift (2 × 3), `!` Notleiter; `O` (Lebenserhaltung) entfällt.

**Mitteldeck** (Atlas-Zeilen 0–12, lokale Zeile y = Atlas-Zeile − 0)

```
   x:  0         1         2         3
       0123456789012345678901234567890123456789
 0  ########################################
 1  #==u=f#..LLLLL#y===u#=F=M=U=#.........p#
 2  #A====#.......#=====#=======#..........#
 3  #=====#.......#==R==#=======#..........#
 4  #=====####D####=====##D##D####...W.....#
 5  #=====#^^.....#=====#.......^^.........#
 6  #E====D^^.....D==!==D.......^^.....H...#
 7  #=====#^^.....#i====#.......^^.........#
 8  #=====####D####=====##D##D####...C.....#
 9  #=====#.......#==G==#=======#..........#
10  #2====#.P.P...#=====#=======#..........#
11  #==u=f#X.P.T..#u===y#=Z=J=V=#.........p#
12  ########################################
```

**Oberdeck** (Atlas-Zeilen 16–28, lokale Zeile y = Atlas-Zeile − 16)

```
   x:  0         1         2         3
       0123456789012345678901234567890123456789
 0        ##################################
 1        #B,,,,,0#p:::p#B,,,,,0#::p:t:a:tj#
 2        #,,,,,,,#:YY::#,,,,,,,#::::::::::#
 3        #,,,,,,,#:YY::#,,,,,,,#::::::::::#
 4        ####D####:::::####D#####:::::::::#
 5        #^^:::::#:::::#:::::::^^:::::::::#
 6        #^^:::::D::!::D:::::::^^:::::::::#
 7        #^^:::::#:::::#:::::::^^:::::::::#
 8        ####D####:::::####D#####::::mm:::#
 9        #,,,,,,,#:S:::#,,,,,,,#:::::mm::z#
10        #,,,,,,,#:::::#,,,,,,,#::::::::::#
11        #B,,,,,0#p:::p#B,,,,,0#::p::::::e#
12        ##################################
```

**Unterdeck** (Atlas-Zeilen 32–44, lokale Zeile y = Atlas-Zeile − 32)

```
   x:  0         1         2         3
       0123456789012345678901234567890123456789
 0        ##################################
 1        #.q.h.q.#=====#.q.h.q.#==========#
 2        #.......#=7=1=#.......#========K=#
 3        #.r...r.#=====#.r...r.#==========#
 4        ####+####=====####D#####=========#
 5        #^^.....#=====#.......^^=========#
 6        #^^.....D==!==+.......^^=========#
 7        #^^.....#=====#.......^^=========#
 8        ####+####=====####D#####=========#
 9        #.r...r.#=====#.r...r.#==========#
10        #.......#=9=3=#.......#========5=#
11        #.q.h.q.#=====#.q.h.q.#======I===#
12        ##################################
```

### Räume (`SHIP_ROOMS`, Atlas-Zeile = lokales y + 16 · Deck)

| Raum (id) | Name | Deck | Kacheln (x, lokales y) | Sektor | Stufe |
|---|---|---|---|---|---|
| lift1 | Brückenlift | Mittel | x 28–29, y 5–7 | -1 | 0 |
| lift2 | Hecklift | Mittel | x 6–8, y 5–7 | -1 | 0 |
| antrieb | Antriebsraum | Mittel | x 1–5, y 1–11 | 2 | 0 |
| maschinenraum | Maschinenraum | Mittel | x 15–19, y 1–11 | -1 | 0 |
| bruecke | Brücke | Mittel | x 29–38, y 1–11 | 0 | 0 |
| lager | Lager | Mittel | x 7–13, y 1–3 | 3 | 0 |
| transfer | Transferkammer | Mittel | x 7–13, y 9–11 | 1 | 0 |
| heckgang | Heckgang | Mittel | x 9–14, y 4–8 | -1 | 0 |
| batterie_bb | Batteriedeck Backbord | Mittel | x 21–27, y 1–3 | 3 | 0 |
| batterie_stb | Batteriedeck Steuerbord | Mittel | x 21–27, y 9–11 | 1 | 0 |
| gang | Gang | Mittel | x 20–27, y 4–8 | -1 | 0 |
| lift1_ober | Brückenlift | Ober | x 28–29, y 5–7 | -1 | 0 |
| lift2_ober | Hecklift | Ober | x 6–8, y 5–7 | -1 | 0 |
| q0 | Quartier 1 | Ober | x 7–13, y 1–3 | -1 | 0 |
| q1 | Quartier 2 | Ober | x 7–13, y 9–11 | -1 | 0 |
| q2 | Quartier 3 | Ober | x 21–27, y 1–3 | -1 | 0 |
| q3 | Quartier 4 | Ober | x 21–27, y 9–11 | -1 | 0 |
| meeting | Meetingraum | Ober | x 15–19, y 1–11 | -1 | 0 |
| heckgang_ober | Heckgang | Ober | x 9–14, y 4–8 | -1 | 0 |
| gang_ober | Gang | Ober | x 20–27, y 4–8 | -1 | 0 |
| messe | Messe | Ober | x 29–38, y 1–11 | -1 | 0 |
| lift1_unter | Brückenlift | Unter | x 28–29, y 5–7 | -1 | 0 |
| lift2_unter | Hecklift | Unter | x 6–8, y 5–7 | -1 | 1 |
| modul1 | Modulraum 1 | Unter | x 21–27, y 1–3 | 3 | 0 |
| modul2 | Modulraum 2 | Unter | x 21–27, y 9–11 | 1 | 0 |
| modul3 | Modulraum 3 | Unter | x 7–13, y 1–3 | 3 | 1 |
| modul4 | Modulraum 4 | Unter | x 7–13, y 9–11 | 1 | 2 |
| weg_heck | Heckweg | Unter | x 9–14, y 4–8 | -1 | 1 |
| weg_ost | Bugweg | Unter | x 20–27, y 4–8 | -1 | 0 |
| lafetten_bb | Lafetten Backbord | Unter | x 15–19, y 1–5 | 3 | 1 |
| lafetten_mitte | Lafettengang | Unter | x 15–19, y 6–6 | -1 | 1 |
| lafetten_stb | Lafetten Steuerbord | Unter | x 15–19, y 7–11 | 1 | 1 |
| bugraum | Bugraum | Unter | x 29–38, y 1–11 | 0 | 0 |

Gangräume decken die Türkacheln mit ab, Modulräume sind `kind: 'modul'` (`modul` = 1–4), der Raum `messe` trägt `nutzung: ['quartier']` (Ivos Schlafecke, vorher im Frachtraum).

### Schächte, Brücke, Sektoren
- **L1** (Brückenlift, x 28–29, y 5–7) steht zwischen Gang und Brücke auf der Mittelachse; **L2** (Hecklift, x 7–8) am Ende des Gangs vor dem Antrieb; **Notleiter** `!` (17, 6) in der Mitte des Maschinenraums, darüber der Meetingraum, darunter der Lafettenbereich. Die Brücke ist **Kachel für Kachel symmetrisch** (Test), Steuer `H` (35, 6) auf der Achse, Ops `W` (33, 4) und Captain `C` (33, 8) einander gegenüber, **keine Tür außer L1**, keine Station (Lanze und Bug-Emitter wohnen im Bugraum).
- **Schildsektoren** gelten für Mittel- und Unterdeck gemeinsam (Treffer im Backbord-Sektor kann die Batterie oben oder Modulraum 1/3 und die Lafetten 7/1 unten treffen); das Unterdeck hat kein Heck (Sektor 2 nur im Antriebsraum). Kandidaten für Feuer und Lecks je Stufe: `World.regionFloorsFor(stufe, wallAdjacent)`.
- **Reparaturwege** des Mitteldecks liegen innerhalb ±1,5 s der alten Messwerte (`check-maps`: Batterie 4,7 s, Düse 4,7 s, Reaktor 6,3 s, Triebwerk 10,7 s, Regal 9,7 s, Heck-Emitter 12,0 s ab Captain-Platz); die **Lanze** liegt jetzt im Bugraum (6,8 s inkl. Lift hinunter). `SHIP_DRILL`: Feuer im Heckgang (11, 6), Leck im Lager (7, 3). `REACTOR_SWITCHES` A (15, 1), B (19, 11), `SHELVES` x 9–13 (Lager), Spawns und Bot-Spawns neu.

## 2. Lifts und Leiter (E, dann W/S)
- `Maps.SHIP_LIFTS` (`L1`, `L2`; `tiles` lokal, `gate`: Deck-Index → Mindeststufe), `Maps.SHIP_LADDERS`, `fahrtZiel(x, y, dir, stufe)` (dir +1 hoch, −1 runter, je ein Deck), `fahrtOptionen(x, y, stufe)` → `{ up, down }`, `deckLinks(x, y, { ladder, stufe })` (BFS-Kanten, Bots ohne Leiter). L1: alle drei Decks ab Stufe 0; L2 und Notleiter: Unterdeck ab Stufe 1.
- **Server** (`interior.js`): E auf der Liftkachel bzw. an/auf der Leiter öffnet die Wahl (`p.liftSel`), W/S sind die Bewegungstasten (`input.my` −1/+1): hoch bzw. runter, nur wenn möglich; A/D oder E schließt. Ein vor E gehaltenes W/S zählt erst nach dem Loslassen (`armed`). Die Fahrt (`startRide`): Lift `CONFIG.lift.rideTime` 1,5 s (Notstrom 3 s), Leiter `ladderTime` 2 s (`lift.via = 'ladder'`); nach der Ankunft ist die Wahl zu (für das nächste Deck wieder E). Bots: `startRide` mit dem Ziel aus dem BFS-Link. Die alte E-halten-Leiter gilt nur noch auf gebauten Außenkarten (B1 §6.2).
- **Snapshot:** `players[].lm` (Bitmaske 1 = W hoch, 2 = S runter) solange die Wahl offen ist, `players[].lift { to, t, T }` auch für die Leiter, Ereignis `lift` mit `via: 'ladder'` (Start und Ankunft). **Client:** Hinweiszeile „W hoch (Oberdeck) · S runter (Unterdeck) · E Abbruch“ und Pfeile über/unter der Figur (3D).
- Lifts und Leiter sind **nicht beschädigbar**: keine Station (`system`), `hazardAllowed` nie auf `lift`/`ladder`, nie Feuer oder Leck dort.

## 3. Ausbaustufen und Pforten (`server/sim/ausbau.js`)
- `game.ship.stufe` 0–3 (`Maps.STUFE_MAX`), `Ausbau.setStufe/stufe/plaetzeOffen/modulRaeumeOffen`. Snapshot **`ship.st`** nur ab 1 (Stufe 3 kostet ~7 B). Weltstand **`schiff.stufe`** (Schema `content/schema/weltstand.schema.json`, Version bleibt **3**: optionales Feld, Altstände laden mit Stufe 0; Wiederherstellung vor den Modulen, `Fracht.restore` danach).
- Tabelle (Auftrag): Stufe 0 Waffen 3 / Module 2 · 1: 5 / 3 · 2: 7 / 4 · 3: 9 / 4. Plätze und Räume: `Maps.WAFFENPLAETZE` (platz, art, stufe, sector, side, system, x, y), `Maps.MODUL_RAEUME` (raum, room, stufe), `Maps.SHIP_SEALS` (Pforten: Modulraum 3 → Stufe 1, Modulraum 4 → Stufe 2, Lafettenbereich → Stufe 1).
- **Pforten** (`+`, kind `door_sealed`, solide): `Maps.shipSolidFn(stufe)` macht sie bei ausreichender Stufe begehbar; Server (`World.shipSolidFor/shipWalkableFor`, Bewegung, Bots-BFS, `tp`), Client (`isSolidFor`) und Tests nutzen sie. In Räumen mit `stufe` größer als die aktuelle Stufe entstehen kein Feuer und kein Leck (`hazardAllowed(x, y, stufe)`).
- **Waffenplätze – Entscheidung:** jeder Platz ist ein **Ort mit Lafette** (Kachel im Grundriss, Tabelle). 8, 4, 6 behalten ihre Systeme `weapon_bow`, `battery_port`, `battery_stbd` (Treffer, Reparatur, Waffen unverändert, auch der Bolzenwerfer-Mount). Die übrigen sechs sind **Lafetten-Kacheln ohne System** (`kind sys_lafette`, `interact 'lafette'`, E zeigt „frei“ bzw. „verschlossen – Stufe n nötig“); `WAFFENPLAETZE[].system` nennt den späteren Systemnamen (`lafette_N`). Paket C hängt Waffen an diese Orte, ergänzt die Systeme in `SYSTEM_ORDER`/Weltstand und braucht **`maps.js` nicht mehr anzufassen** (Treffer und Reparaturwege kommen mit den Systemen; ohne Waffe wären sie sinnlos). Grund, die Systeme jetzt nicht anzulegen: sie würden Snapshot, Weltstand, HUD-Raster und die Trefferauswahl berühren, ohne dass etwas feuert.

## 4. Modulräume und Fracht
- **Vier gleich große Modulräume** (7 × 3, 21 Kacheln, je 16 Bodenkacheln, 2 `q`, 2 `r`, 1 `h`; Steuerbordräume gespiegelt) – Test in `check-maps`. Jedes der drei Module passt in jeden Raum, auch mehrfach (`Modul.bestuecken(game, id, raum)`, nur offene Räume; `Modul.frachtRaeume(game)`).
- **Ausstattung je Modul** (Client, 2D und Voxel, Platzhalter): `mod_a` = Frachtbucht | Krankenliege | Werkbank | Stauware, `mod_b` = Frachtbett | Krankenliege | Werkbank | Stauware, `mod_c` = Stapel | Scanner | Maschine | Stauware; Boden: Krankenstation `kind 5`, Werkstatt Gitter `kind 1`. Die Modul-Codes kommen aus `ship.mod` (`Maps.modulCodeImRaum`, `frachtRaeumeAusMod`).
- **Fracht:** `Fracht.capacity(game)` = 2 × Frachträume (`Maps.cargoCapacity`, `CARGO_PER_RAUM`), ohne Frachtraum 0 (nichts wird angenommen, Überhang nach dem Ausbau bleibt liegen). `CARGO_BAYS`/`CARGO_BEDS` hat die Karte für alle 4 Räume (je 2); aktiv sind die der Frachträume (`Maps.frachtPlaetze(raeume)`, Reihenfolge nach Raum und x). Personen (`personen-bord.js`): Bett-Index in den aktiven Betten. Der Client rechnet die Kapazität aus `ship.mod` (kein neues Snapshot-Feld). `CARGO_CAPACITY` entfällt.
- **Start-Lerche:** Frachtraum (Raum 1) + Krankenstation (Raum 2); die Werkstatt hat jetzt einen echten Raum.

## 5. Weitere Änderungen
- **Lebenserhaltung gestrichen:** Station `O`, System `life` (`SYSTEM_ORDER` 13, `Protocol.SYSTEMS`, Weltstand `systeme`), `INERT_SYSTEMS`, `CONFIG.o2.drainLifeBroken`; O₂ sinkt nur durch Lecks. Die Boje-Szene hängt nur noch an der Energie (die O₂-Uhr war seit Paket A weg).
- **Ivo** wohnt in der **Messe** (Schlafecke `e`/`z`), steigt unter der Handelskonsole im Meetingraum aus; ODA-Text und Regiebuchzeile `aussen.ivo_an_bord` angepasst. **Handelskonsole** (`S`, console `shop`) und **Planungstisch** (`Y`) stehen im Meetingraum (Oberdeck); Messe: Trophäen `t`, Schrein `a`, Tisch, Anrichte.
- **Gefechtsalarm:** ODA „Alle auf Station – zum Brückenlift!“ (wer auf dem Oberdeck ist).
- **Debug:** `ausbau [0..3]` (neu, `Protocol.DEBUG_CMDS`), `modul bau <id> [raum 1–4]` (nur offene Räume), `modul voll` hebt die Stufe auf 2, `tp <x> <y>` auch an Bord (Atlas-Kachel). Zurückstufen entfernt Module in zugemauerten Räumen und setzt Personen im gesperrten Bereich zum Bugweg (`ausbau.js`).
- **Andockpunkte** der Optik: `Maps.ANDOCKPUNKTE` (Bug, Triebwerk, Banner, Lafetten 1–9, nur Daten).
- **Client:** Pfeile und Hinweis zur Liftwahl, Modulplätze nach Modul, Pforten (zu: Warnband mit Stufenzahl, offen: Tür), Lafetten (verschlossen/frei), Spind (Anrichte), Lift 2 × 3 (Platzhalter: zwei 2 × 2-Modelle), Wandstil nur Oberdeck „privat“, Minikarte ohne Deck-Lücken (`Render.miniPlanSize`), Raumname der Modulräume nach Modul (`hud.roomOf`), Laufzeit-Spalte der Technik über alle Decks (Dijkstra mit Liftzeit).
- Tests: `tools/test-lerche.js` (neu, in `npm test`), `check-maps` (drei Decks, Stufen 0–3, Brücke, Modulräume), angepasst: test-features (Lift/Leiter/Feuer/Bots/Alarm für drei Decks), test-m3, test-lager, test-personen, test-rollen-r0, test-anzeige-u3, test-energie.

## 6. Prüfung und Messung (Stand dieses Branches)
- `npm test` (58 Befehle, darunter neu `node tools/test-lerche.js`), `npm run check` (check-maps 791 Prüfungen), `npm run snap:mess` grün.
- **Snapshot** (`npm run snap:mess`, Ziel ≤ 18 944 B, Grenze 20 480 B): Worst Case max 11 700 B, Wellenlauf 10 771, Raum-Alarm 11 654, Methalle 10 727, Endkampf 11 562, Konvoi 8 397, Flotte 11 482, Orbitschlacht 13 361 B. Auf `pan01-a` (3c368d9, gleiche Messung): 11 711 / 10 783 / 11 625 / 10 739 / 11 574 / 8 409 / 11 494 / 13 373 B. Die Werte liegen innerhalb ±30 B der Vorgängermessung (Raum-Alarm +29 B, Rauschen der Läufe, die übrigen sieben −9 bis −13 B, weil das System `life` entfällt); `ship.st` kostet bei Stufe 3 ~7 B (`"st":3`), `players[].lm` nur solange die Liftwahl offen ist.
- **Kampagnen-Bots (Start-Lerche):** `node tools/sim-headless.js kette` (Crew 1 und 3) grün; zusätzlich Crew 1 und Crew 3 je Seeds 1–3 grün (Crew 1: 43,2 / 36,0 / 39,6 min, Crew 3: 52,7 / 45,5 / 36,5 min Spielzeit). `node tools/sim-headless.js sl --paket alle` grün. `node tools/sim-sund.js --weg beide --crew 3` und `--kapitel alle --crew 3` grün (in `npm test`); mit Crew 1 grün (beide Wege, alle Kapitel). **Crew 2 scheitert wie auf `pan01-a`** (Kette k2_konvoi 3 von 3 Seeds, Sund `sl_gasriese/verkauf`): Vorbestand, die Bots sind nur für Crew 1 und 3 abgestimmt; identisch auf `pan01-a` nachgemessen. Die Fracht im Notstrom (Paket A, k2) bleibt unverändert.
- **Golden** (`--all --seeds 20`, neue Basis `tools/fixtures/golden/base-pan01b`, Allow `allow-pan01b.json`): gegen `base-pan01a` **rot mit 4 Befunden** (Erfolg true → false: m1/3 Seeds 6 und 20 und ihre Folgeläufe m2/3 Seeds 6 und 20); alle anderen Abweichungen sind erlaubt und erklärt (siehe `_kommentar` der Allow-Datei). Fehlschläge insgesamt: `pan01-a` 12 von 120 Traces, `pan01-b` 10 von 120; Seeds 21–40 (Crew 3): 7 von 20 gegen 7 von 20. Die Läufe laufen von der Hafen-Übung an auseinander (+0,7 s Laufweg), danach entscheiden Zufall und Bots über Gefechte: Modellfolge, kein Fehler (siehe Kommentar). Basis gegen einen frischen Lauf: byte-identisch (grün). Arena-Bot (12 Seeds, 3 Spieler): 5,3 von 6 Wellen gegen 5,7, Hülle −66,5 gegen −75,9, im Rauschen.
