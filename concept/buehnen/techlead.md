# Konzept Tech Lead – Bühnen & Bodenkampf (B1–B3)

Stand 2026-10-08 · Grundlage: Briefing (verbindlich), Code auf `main` @ 80b4c8f, Verträge M2/M4/S1/S2/S2b.
Nur Text, kein Produktionscode geändert. Wegwerf-Messungen im Scratchpad (`limescheck.js`, LOS-Benchmark).

## 0. Startbedingung S2b

- S2b ist als Commit 80b4c8f eingecheckt (Autor Kai), README enthält die QA-Abnahme mit Messwerten und Live-Messung
  (175k Tokens). **Baseline heute grün:** `npm run check` 596/596, `npm test` komplett grün (Exit 0, gemessen).
- Eine ausdrückliche Notiz „Kai hat S2b abgenommen“ habe ich nirgends gefunden. Kais Befund „nach S2b“ im Vault spricht
  dafür, dass die Stufe abgeschlossen ist. **Bitte vor dem Vertrag kurz von Kai bestätigen lassen.**

## 1. Ist-Stand

### 1.1 Außenkarten (`shared/maps.js`)
| Karte | Format | Größe | Objekte (`MAP_OBJECTS`) | Bereiche (`MAP_AREAS`) | Kampf |
|---|---|---|---|---|---|
| `platform` (B-7) | ASCII-Zeilen + `PLATFORM_LEGEND` | 32×18 | sonde, core, ivo, datenkern | nsc, landedeck, halle, nordraum, kernraum, sondenraum | alt (`away.js`, Drohnen mit HP) |
| `wreck` (Zaunkönig) | ASCII + `WRECK_LEGEND` | 30×16 | hollow, lore, container (viele) | nsc, vorderdeck, bruecke, laderaum, hohlraum | alt (Plünderer `hp: 5`) |
| `kesh` | ASCII + `KESH_LEGEND` (mit `cover`, `low`) | 48×26 | jammer, vault, key, tablet, warden | nsc, landezone, hof (Spalten), halle (Spalten), gewoelbe | **v2** |

- Bereiche sind nur Rechtecke oder Spaltenbereiche. Spawns hängen an Legendenzeichen (`a`, `b`, `c`, `L`, `d`).
  Es gibt **keine Anker**. Pads sind feste Listen (`*_PADS`).
- `server/world.js` baut beim Laden ein festes `AWAY_MAPS` (3 Einträge, Kesh mit vorberechneten `coverSpots`).
  `server/game.js:343` legt alle drei Laufzeitkarten fest an: `this.aways = { platform, wreck, kesh }`.
- **Fest verdrahtet:** 38 Stellen im Server (`aways.kesh`, `map === 'kesh'`, `AWAY_MAPS.kesh` in game, away, combat,
  squad, interior, mission, registry, objects, explore, weltstand, world, bausteine/welt) und 38 im Client
  (`render.js`, `voxel/away.js`, `dev-mock.js`). Der Client nimmt die Karte aus dem **statischen** `Shared_Maps[id]`.
  Eine zur Laufzeit gebaute Karte kennt er also nicht.

### 1.2 Wo Katalog-Umsetzungen an Karten hängen
9 Umsetzungen haben `schauplatz: aussen`. Alle binden über Parameter `map` (`typ: map`, `werte: [...]`) und meist `loc`.
Dazu kommen `buehne.aussenkarten` und `buehne.objekte.<map>`:

| Umsetzung | Karte | an Anker umstellbar? |
|---|---|---|
| `artefakt_freilegen/fund_aus_gewoelbe` | kesh | ja: `fund` (+ `tor`) |
| `raetsel_loesen/zwei_schluessel` | kesh | ja: Rätselpaar + `tor` |
| `entkommen/zu_den_pads` | kesh | ja: `abholpunkt` + Gefechtsbereich |
| `stellung_nehmen/trupp_raeumen` | kesh | ja: `wache` + Gefechtsbereich (braucht die Squad-Entkopplung) |
| `ausschlachten/wrack_container` | wreck | ja: `beute` (viele) |
| `rekonstruieren/wrack_logbuch` | wreck | teilweise: `terminal` ja; der Hohlraum braucht einen neuen Anker `versteck` (schwache Wand) oder fällt weg |
| `personen_bergen/techniker_retten` | platform, wreck, kesh | ja: `zelle`/NSC-Anker + `abholpunkt` |
| `datenkern_bergen/plattform_kern` | platform | ja: `ziel` |
| `raetsel_loesen/sonden_code` | platform | **nein** (Sonde mit Codetafel ist B-7-spezifisch); bleibt an `platform` |

Das Briefing spricht von 10 Umsetzungen, ich zähle 9 mit `schauplatz: aussen` (je nach Zählweise ist es eine
Raum-Umsetzung mit Außenbezug). Geprüft wird an zwei Stellen: `server/mission/checker.js` (REF-KARTE, REF-OBJEKT,
REF-BEREICH gegen `objects.js`/`AWAY_LEGENDS`) und `server/mission/szenenbau.js:382–395`
(`s.karte`, `MAP_OF_LOC`, `u.params.map.werte`). Der Kontext (`context.js:126`) gibt dem Spielleiter `karten: [...]`.

### 1.3 Warum Kampf v2 nur auf Kesh läuft
1. **Daten:** Nur `KESH_LEGEND` hat `cover`/`low`. Nur Kesh hat `coverSpots`, aus denen die KI Deckung, Flanke und
   Rückzug wählt.
2. **Code:** `combat.isV2` liest `AWAY_MAPS[map].combat === 'v2'`. `squad.spawnSquad`/`wakeWarden` greifen hart auf
   `game.aways.kesh` und `AWAY_MAPS.kesh.spawns` zu. Interaktionen (Störrelais, Schlüssel, Tafel) prüfen
   `aw.map === 'kesh'`.
3. **Tutorial-Schutz:** m1 (Plattform) läuft über den alten Kampf in `away.js` (Drohnen, Spieler-HP, Sonde).
   `check-maps` prüft sogar „Kampf v2 nur auf kesh“. Die Golden-Traces m1–m3 sind darauf aufgenommen.

### 1.4 Weltstand (`server/weltstand.js`, Schema `content/schema/weltstand.schema.json`)
- Version 2 (S2), Migrationskette `MIGRATIONS[n]`. Blöcke: `tutorial, meta, ort, schiff, welt, missionen, npc,
  chronik, spielleiter`.
- `welt`: `orte {bekannt, besucht, aufgedeckt, gefunden}`, `verbindungen_offen` (Schlüssel aus `LOCKED_LINKS`),
  `karten` (kartierte Außenkarten), `flags`, `fakten`, `faeden`. Außenkarten-Zustand wird **nicht** gespeichert, sondern
  aus Fakten hergestellt (`away.applyWorldFacts`, z. B. Tafel weg, Wächter tot). Die Wrack-Container stehen extra drin.
- Spieler sind nur Anzeige (`meta.spieler`, Namen). Eine Zuordnung je Spieler gibt es nur über Quartiere/Farben. Die
  stabile `clientId` des Browsers gibt es im Server (`game.js:505`), sie wird aber nicht gespeichert.

### 1.5 Sektorkarte (Punktnetz)
- `shared/locations.js` (UMD): 8 Orte mit `x,y` in Kartenpixeln, `links`, `LOCKED_LINKS` (kesh, nebel-relais),
  `scene` (Raumszene inkl. `beam: { map, range }`).
- Server: `server/sim/explore.js` (bekannt/besucht/`linksOpen`, `isLinked`), `server/sim/space.js`
  `selectDest/updateJump/doJump` (Faltsprung von überall, ≥ 300 px von der Station, Ziel muss verlinkt sein).
- Client: `render.js:3419 drawStarMap` (Punkte und Linien), Auswahl in `consoles.js` (Captain) und `hud.js:851`.
- **Abgleich mit Karte Limes** (Skript `limescheck.js`): Die Saumraum-Kanten sind dieselben bis auf eine: **`nebel–wrack`
  fällt weg, `b7–wrack` kommt dazu.** Das deckt sich mit der Vault-Note. Das Python-Skript hat 38 Einträge (37 Systeme
  und Rostnest), Daten als JSON ≈ 5,8 KB.

## 2. B1 Modulsystem

### 2.1 Grundsätze
- **Ein Ergebnisformat für alle Erzeuger.** Handkarten (Tutorial), Modul-Zusammenbau (B1) und später G1 liefern
  dieselbe **`Karte`** (§4). Sim, Prüfer, Spielleiter und Client kennen nur dieses Format.
- **Kanten werden aus den Kacheln abgeleitet, nicht deklariert.** Der Typ eines Anschlusses ergibt sich aus den beiden
  Mittelkacheln (Index 3/4 bei 8 Kacheln). Damit können Deklaration und Zeichnung nicht auseinanderlaufen.
- **Deterministisch:** eigener PRNG (mulberry32 o. ä.) in `shared/`, nur Ganzzahlen, Kandidatenlisten nach ID sortiert,
  kein `Math.random`, keine Abhängigkeit von der Reihenfolge der Objektschlüssel.

### 2.2 Datenformate (Vorschlag)

**Modul** – `content/buehnen/<art>/module/<id>.json`, von Hand als ASCII gebaut:
```json
{ "format": "modul/1", "id": "station.korridor.knick_a", "art": "station", "typ": "korridor",
  "groesse": [1, 1], "drehen": true, "spiegeln": true, "gewicht": 1,
  "rows":  ["##....##", "#......#", "...", "... 8 Zeilen à 8 Zeichen je Zelle"],
  "anker": ["........", "..t.....", "...", "Overlay gleicher Größe, '.' = kein Anker"],
  "anker_legende": { "t": { "rolle": "terminal" }, "e": { "rolle": "eingang", "art": "technisch" },
                     "1": { "rolle": "raetsel", "paar": "A" }, "2": { "rolle": "raetsel", "paar": "A" } },
  "bereich_vorschlag": "ziel", "kampf": { "min_deckung": 2 } }
```
- `rows` nutzen die **Kit-Legende** der Kartenart (`content/buehnen/<art>/legende.json`, Aufbau wie `KESH_LEGEND` mit
  `cover`/`low`/`interact`). Besitz und Zustand ändern nur Palette und Requisiten, nicht die Kacheln.
- Anker als **zweite ASCII-Ebene**. Beim Bauen per Hand lesbar, und beim Drehen gilt dieselbe Transformation.
- Ein 2×1-Modul ist 16×8 und kann gedreht 8×16 sein. Ein 2×2-Modul ist 16×16. Innen unterteilte Zellen sind einfach Wände
  in den Zeilen.

**Anschluss-Typen:** `offen` (2 Bodenkacheln), `tuer` (Tür/Schott), `wand`. **Technischer Zusatz:** `frei` für
Geländekanten unter freiem Himmel (die ganze Kante ist begehbar: Außenposten-Hof, Ruinen-Vorhof). Ohne `frei` hätte jede
Außenfläche Mauern bis auf ein 2-Kachel-Loch. Verträglichkeit je Kit: `offen↔offen|tuer`, `tuer↔tuer|offen`,
`wand↔wand`, `frei↔frei`. Kartenrand: nur `wand` oder `frei` (bei Planetenkarten mit Felsrand).

**Schablone** – `content/buehnen/<art>/schablonen/<id>.json`:
```json
{ "format": "schablone/1", "id": "aussenposten.talsperre", "art": "aussenposten", "zellen": [9, 5],
  "fuellung": "fels",
  "plaetze": [
    { "id": "tor_nord", "typ": "tor", "x": 4, "y": 0, "w": 1, "h": 1, "bereich": "hinein", "eingang": "laut" },
    { "id": "abfluss", "typ": "abfluss", "x": 0, "y": 3, "w": 1, "h": 1, "bereich": "hinein", "eingang": "leise" },
    { "id": "halle", "typ": "lagerhalle", "x": 3, "y": 2, "w": 2, "h": 2, "bereich": "ziel" },
    { "id": "landeplatz", "typ": "landeplatz", "x": 8, "y": 4, "w": 1, "h": 1, "bereich": "rueckzug" } ],
  "kanten_fest": [ { "a": "halle", "b": "hof_ost", "typ": "tuer" } ],
  "pflicht": { "eingang": 3, "abholpunkt": 2, "sprengpunkt": 1, "aussicht": 1 },
  "gefecht": ["hof_west", "hof_ost"] }
```

**Kompilierte `Karte`** (Ergebnis, im Speicher und an den Client):
`{ id, art, besitz, zustand, seed, bauversion, w, h, rows[], legende, anker: [{ id, rolle, x, y, platz, bereich, paar?,
art? }], bereiche: { <id>: { rects: [[x,y,w,h], …] } }, eingaenge, abholpunkte, pads, coverSpots, decks?, meta: { schablone,
versuche } }`. Bereiche bekommen **Rechtecklisten**, `Maps.inArea` lernt `rects`.

### 2.3 Zusammenbau (`shared/buehne.js`, UMD)
1. RNG = `hash(schablone.id, seed)`. Plätze sortiert: zuerst 2×2, dann solche mit festen Kanten, dann der Rest.
2. Je Platz Kandidaten: Module mit passendem `typ` und passender Größe, alle erlaubten Lagen (bis zu 8 Symmetrien,
   bei 2×1 nur die, die in den Platz passen), Reihenfolge nach Gewicht und RNG gemischt.
3. Lage passt, wenn alle Kanten zu bereits gesetzten Nachbarn und zum Rand passen. **Begrenztes Backtracking**
   (≤ 200 Schritte), danach gilt der Versuch als gescheitert.
4. Kompilieren: Zeilen zusammensetzen, Füllzellen, Anker mit globalen IDs (`<platz>.<rolle>[n]`), Bereiche aus den
   Plätzen, `coverSpots` mit derselben Funktion wie Kesh (verallgemeinert aus `world.js keshCoverSpots`).
5. **Prüfen** (`Buehne.pruefen(karte)`, dieselbe Funktion in `check-maps`, Server und Tests):
   - BFS von jedem `eingang` aus: alle Pflichtanker erreichbar, Paaranker beide erreichbar.
   - ≥ 2 erreichbare Eingänge, ≥ 1 `abholpunkt` (Pad-Fläche 3 Kacheln frei).
   - Deckung im Gefechtsbereich: Anteil der Bodenkacheln mit Deckung in ≤ 2 Kacheln ≥ 35 % (Startwert, tune-fähig),
     keine freie Sichtgasse > 12 Kacheln ohne Deckung (Lanze bleibt stark, aber nicht übermächtig).
   - keine Insel begehbarer Kacheln ohne Zugang (Gegner-Spawn im Nirgendwo).
6. Besteht die Karte nicht, wird mit `seed + 1` neu gebaut (≤ 20 Versuche). Der wirksame Seed wird gespeichert, damit
   der zweite Besuch nicht neu würfelt. Klappt es 20-mal nicht, ist das ein **Fehler der Schablone** und kein
   Laufzeitfall: Die Tests verlangen je Schablone eine Bestehensquote ≥ 80 % über die Seeds 1–200.

Die Laufzeit ist unkritisch. Die LOS-Messung auf Kesh ergibt ≈ 0,5 µs je Sichtlinie. BFS auf 72×40 (2880 Kacheln) liegt
im Bereich unter einer Millisekunde.

### 2.4 Wo lebt was
| Datei | Inhalt |
|---|---|
| `shared/buehne.js` (neu, UMD) | PRNG, Transformationen, Zusammenbau, Kompilieren, `pruefen`, `inArea` für Rechtecklisten |
| `content/buehnen/anker.json` (neu) | **Ankervokabular**: Rolle → Objektart, Zustände, Interaktion, Haltezeit (eine Liste für Sim, Prüfer, Spielleiter, G1) |
| `content/buehnen/<art>/{legende.json, module/*.json, schablonen/*.json}` | Kits |
| `content/buehnen/paletten/*.json` | Besitz × Zustand (Client/Voxel; Server kennt nur die IDs) |
| `content/welt/landepunkte.json` (neu) | Ort → Landepunkte `{ id, art, besitz, zustand, seed, beam: { x, y, range }, schablone? }` |
| `server/sim/landepunkte.js` (neu) | Laufzeitkarten `game.aways[<lpId>]` **dynamisch** anlegen, Zustände anwenden, `toSave/restore` |
| `server/sim/anker.js` (neu) | generische Anker-Interaktionen (E halten → Zustand) für alle neuen Karten |
| `server/world.js` | `AWAY_MAPS` wird zur Registry (`register(karte)`), die drei Handkarten registrieren sich wie bisher |
| `tools/check-maps.js` | + alle Schablonen × Seeds 1–50 bauen und prüfen, + Tutorial-Anker |
| `tools/buehne.js` (neu) | CLI: `bauen <schablone> <seed>` → ASCII/PNG, `sweep <schablone>` → Bestehensquote, `modul <id>` → Vorschau aller Lagen |

**Modulbau von Hand:** ASCII im JSON, wie die heutigen Karten. Das Werkzeug `tools/buehne.js modul <id>` zeigt alle
Lagen, die abgeleiteten Kanten und Fehler (falsche Zeilenlänge, Anker auf Wand, Kante nicht 2 breit). Ein grafischer
Editor ist in B1 nicht nötig und würde nur Zeit kosten.

### 2.5 Sonderfall Schiff
- Statt Zellen **Sektionen über die volle Deckhöhe** (13 Zeilen). Breiten aus einer festen Menge (z. B. 5/6/8/12).
  Heck/Antrieb (links), Mitte/Reaktor, Bug/Brücke (rechts) sind feste Plätze, dazwischen und auf Deck II freie Plätze.
- Anschluss = **Längsgang an fester Höhe** (Zeile 6 wie bei der Lerche) plus optional Zeile 2/10.
- Zwei Decks als **Atlas wie bei der Lerche** (37×29, Deck II = Zeile + 16, Lücke = Void). Lift und Notleiter sind Anker
  in den festen Sektionen, damit sie auf beiden Decks übereinander liegen.
- **Neu und aufwendig:** Außenteams kennen bisher keine Decks. `Maps.deckLinks`/`SHIP_LIFTS` sind fest an die Lerche
  gebunden und müssen kartenbezogen werden (`karte.decks`). Die Void-Lücke muss Sicht sperren, sonst sieht man durch
  den Fog of War auf das andere Deck (Sichtweite 10, Lücke 3). Nötig sind außerdem Lift-Interaktion in der Außenzone,
  Kamera und Voxel je Deck. **Fallback, falls es knapp wird:** Schiff in B1 mit einem Deck (Deck II als zweite Karte
  gleicher Art), zwei Decks erst in einer Nachrunde.

### 2.6 Determinismus und Weltstand
- Gleicher `(schablone, seed, bauversion)` ⇒ gleiche Karte, im Server wie im Werkzeug (Test: Hash der Zeilen).
- `bauversion` = Hash über die Module und Schablonen der Kartenart. Ändert sich ein Modul, kann derselbe Seed eine andere
  Karte ergeben. Dann gilt: neu bauen, Zustände über **Anker-IDs** übertragen, Unbekanntes verwerfen, Eintrag im
  Regie-Logbuch. Kai hat das Zurücksetzen einer Karte als normal erklärt, deshalb reicht das.
- **Der Client würfelt nicht selbst.** Der Server schickt die kompilierte Karte einmal beim Betreten als Ereignis
  `awayMap { id, w, h, rows, legendeId, anker, bereiche, decks }` (3–6 KB, nicht im Snapshot). Der Client registriert
  sie in `Shared_Maps`. So bleibt der Snapshot unter 13 KB und es gibt keine Abweichung zwischen Client und Server.

### 2.7 Zahl der Schablonen und Varianten (technische Sicht, Lead GD entscheidet)
| Kartenart | Schablonen | Platztypen | Varianten je Typ | Module etwa |
|---|---|---|---|---|
| Außenposten | 3 | ~11 | 2 (Hof, Zaun, Füllung 3) | 24–30 |
| Raumstation | 3 | ~9 | 2 (Korridor, Kreuzung 3) | 20–24 |
| Ruine | 3 | ~7 | 2 (Vorhof, Säulengang 3) | 16–20 |
| Schiff | 2 | ~9 Sektionen | 2 | 18–20 |
| **Summe** | **11** | | | **≈ 80–95** |

Begründung: Erkannt werden Karten an der Großform (Schablone), nicht an Modulvarianten. Mit Drehen/Spiegeln ist die
Zahl der Kombinationen schon bei 2 Varianten riesig. Eine dritte Schablone bringt mehr als eine dritte Variante je
Platztyp und kostet weniger (JSON statt Zeichnung).

## 3. Anbindung an den Spielleiter

### 3.1 Schema der Umsetzungen (`content/katalog/schema/molekuel.schema.json`)
- Neu `buehne_braucht: { kartenarten?: ["ruine", "kesh"], anker: ["tor", "fund", { "rolle": "raetsel", "paar": 1 }],
  min: { "eingang": 2 } }`. Das löst `params.map.werte` ab.
- Parameter `map` (Typ `map`) wird zu `landepunkt` (Typ `landepunkt`). **Der Szenenbau** setzt ihn ein, nicht das LLM.
- Objektbezüge in Vorlagen über Anker: `{ "check": { "name": "object_state", "map": "{{landepunkt}}", "anker": "beute",
  "state": "taken", "all": true } }`. Das heutige `object` bleibt als Altname für die Handkarten.
- Die Tutorial-Karten bekommen `MAP_ANCHORS` in `maps.js`. Die alten Objekte werden als Anker-Adapter abgebildet
  (Kesh: `vault` → `tor`, `key` → Rätselpaar, `tablet` → `fund`). Die Kesh-Logik in `combat.js` bleibt dabei unverändert
  (Golden m3).

### 3.2 Prüfer (`server/mission/checker.js`, `szenenbau.checkGrobplan`)
| Code | Art | Regel |
|---|---|---|
| `BUEHNE-ANKER` | Fehler | Die Karte des Landepunkts (gebaut mit dem gespeicherten Seed) hat die von der Umsetzung verlangten Anker nicht |
| `BUEHNE-ART` | Fehler | Kartenart passt nicht zu `buehne_braucht.kartenarten` |
| `LANDEPUNKT` | Fehler | Ort hat keinen Landepunkt dieser Art/dieses Besitzes und `neu` ist nicht gesetzt |
| `KOORDINATE` | Fehler | Grobplan oder Szene enthält `x/y/tile`-Angaben für die Bühne (Leitplanke §6) |
| `QUOTE-BODEN` | Warnung → einmal Nachbesserung | letzte gespielte Mission ohne Bodenszene **oder** Zieldauer ≥ 25 min, und der Plan hat keine Bodenszene; ausgenommen mit `boden_ausnahme: "<grund>"` |

Der Prüfer muss Karten bauen können. Das geht, weil `shared/buehne.js` ohne Server läuft und in unter 5 ms fertig ist.

**Quote durchsetzen:** Eine reine Warnung setzt Kais Regel nicht durch. Vorschlag „weiche Pflicht“: Erster Verstoß →
Nachbesserung mit Prüferfehler (wie SPRECHER). Zweiter Verstoß → Plan wird mit Warnung angenommen und ins Regie-Logbuch
geschrieben. Ist die Quote fällig, müssen **beide** Spielleiter-Angebote eine Bodenszene haben, und das Archiv bietet
bevorzugt eine Bodenmission an. **Lücke:** Die 4 Archivmissionen haben keine Bodenszene. KATALOG muss 2 Archivmissionen
mit Bodenszene auf neuen Karten liefern, sonst bricht der Rückfall die Quote.

### 3.3 Landepunkte und Weltstand
- `content/welt/landepunkte.json`: Für die 8 Orte je 1–2 Landepunkte (z. B. `wrack.a` = `wreck` (Handkarte),
  `wrack.b` = `schiff`/`rostmeute`, `hafen.station` = `station`/`konkordat`, `kesh.ruine` = `kesh`, `kesh.sued` =
  `ruine`). Die Lead GD wählt aus, die Technik braucht nur das Format.
- Der Spielleiter fordert an: `{ ort, landepunkt }` **oder** `{ ort, kartenart, besitz, neu: true }`. Mit `neu` vergibt
  der Server einen neuen Seed und legt den Landepunkt an, wenn der Ort das erlaubt (`max_landepunkte`). Koordinaten gibt
  es im Grobplan nicht (Prüfregel `KOORDINATE`).
- **Weltstand v3** (`MIGRATIONS[2]`):
  `welt.landepunkte: { <lpId>: { seed, bauversion, art, besitz, zustand, zustaende: { "<ankerId>": "verschlossen" },
  alarm: bool, besuche, letzte_mission } }`. Bausteine `anker_zustand_setzen` / `landepunkt_alarm` schreiben dorthin.
  Damit funktioniert „Durchgang West verschlossen“ beim zweiten Besuch.
- Tutorial-Karten: Der Zustand kommt weiter aus den Fakten (`applyWorldFacts`). Neue Karten speichern ihren Zustand
  direkt.

### 3.4 Was der Kontext des Spielleiters neu enthält (`server/mission/context.js`)
- `orte[].landepunkte: [{ id, art, besitz, zustand, besucht, anker: { eingang: 3, terminal: 2, … }, zustaende: [...],
  alarm }]`. Die Ankerzahlen stammen aus der gebauten Karte, nicht aus Koordinaten.
- `bodenquote: { letzte_missionen: [true, false, …], pflicht_jetzt, lang_ab_min: 25 }`.
- `kartenarten: [{ id, kurz, anker_moeglich, besitz_moeglich }]`. In den Umsetzungen ersetzt `braucht_anker` das Feld
  `karten`.
- `gegnertypen` (Registry B2) und `fraktionen: { <id>: mix }`.
- Optional `crew.bewaffnung: { lanze: 1, blaster: 2 }` ohne Namen (S2-Regel 14 bleibt).
- **Kosten:** Der Kontext wächst um etwa 1–2k Tokens. Die Kontext-Goldens werden einmal bewusst mit `--update`
  erneuert.

## 4. G1-Schnittstelle (was jetzt stimmen muss)
1. **Die `Karte` ist der Vertrag** (§2.2). G1 ersetzt nur den Erzeuger, nicht die Verbraucher. Felder, die G1 später
   braucht, sind jetzt schon vorgesehen: `decks`, `gelaende` (Biom, zunächst `null`), `meta.erzeuger: 'modul/1'|'g1/1'`.
2. **Eine Prüffunktion** `Buehne.pruefen(karte)` gilt für Handkarte, Modulkarte und G1. Neue Qualitätsregeln kommen nur
   hierhin.
3. **Ein Ankervokabular** (`content/buehnen/anker.json`). Weder G1 noch der Spielleiter erfinden Rollen.
4. **Der Landepunkt speichert Erzeuger und Parameter, keine Kacheln:** `{ erzeuger, parameter: { art, schablone?,
   biom? }, seed, bauversion }`.
5. **Die Sim ist kartenneutral.** Kein `aways.kesh`, kein `map === '…'` in neuem Code. Laufzeitkarten werden dynamisch
   über `game.aways[lpId]` angelegt. Diese Entkopplung ist der eigentliche Wert für G1.
6. Die Anfrage des Spielleiters (`ort + kartenart + besitz [+ neu]`) bleibt unter G1 gleich.

## 5. B2 Bodenkampf

### 5.1 Umbau
- **Neu `server/sim/waffen.js`:** Waffendefinitionen aus `CONFIG.awayCombat.waffen.<id>` und zwei Funktionen für
  **beide Seiten**: `feuern(game, kaempfer, waffe, ziel)` und `treffer(game, ziel, wirkung, quelle)`. Ein „Kämpfer“ ist
  Spieler oder Gegner mit denselben Feldern: `team, x, y, crouch, waffe, hitze, ueberhitzt, laden, ausholen,
  schild {seg, max}, wunden {n, max}, betaeubt_bis, bewusstlos, frontschild?`.
- **Hitze:** `hitze += pro_schuss`, Abkühlung je Sekunde, bei 1 überhitzt bis `sperre_s`. Die Form der Kurve kommt aus
  den Werten je Waffe (Blaster 5 Schuss, Sturmgewehr viele kleine, Lanze 1 Ladung).
- **Schaden:** Segmente als Zahl (½ beim Sturmgewehr). `reset_schildladen` setzt `lastHitAt`. Nahkampf `ignoriert_schild`
  → direkt eine Wunde. Lanze `durchschlag_front`. Betäuber `nichttoedlich` → `bewusstlos` statt Wunde. Granate:
  Fläche, `ueber_deckung`, Betäubung, **trifft alle Teams**.
- **Wunden statt HP:** `wunden.max` je Typ (Spieler 1, Normale 1, Enterer 2, Wächter 2–3). „Fällt“ heißt: Spieler →
  verwundet (Pistole, Bleedout, Wiederbeleben wie heute), Gegner → außer Gefecht.
- **Lautstärke:** Jeder Schuss erzeugt ein Geräusch mit Radius (laut 14, mittel 8, leise 3 Kacheln). Gegner im Radius
  werden alarmiert und kennen die Position (`squad.alertSquad` gibt es schon). Der Landepunkt merkt sich `alarm` für den
  Weltstand.
- `combat.js` behält Aufbau, Fog of War, Captain-Befehle, Wiederbeleben und Projektilflug und ruft für Schuss und
  Treffer `waffen.js` auf. `hitPlayer`/`hitEnemy` werden dünne Hüllen um `treffer` (Signatur und Ereignisse bleiben).
- **Tune:** `tune waffen.lanze.laden_s 1.2` usw. über den bestehenden `tune`-Pfad (`awayCombat` hat Vorrang).
- Die Pistole der Verwundeten bleibt unverändert (eigener Eintrag `pistole`, ohne Hitze).

### 5.2 Gegner-KI für 5 Rollen (`server/sim/squad.js`)
Die Utility-KI mit den Rollen pin/flank/retreat/push/advance trägt das. Neu sind **Profile je Typ** (Gewichte und
Zusatzaktionen) statt eigener KIs:

| Typ | Profil | Neu im Code |
|---|---|---|
| Niederhalter | pin bevorzugt, Dauerfeuer auf die letzte bekannte Position auch ohne Sicht | Feuer ohne Sicht, Bark „Ich halt sie fest!“, löst Flanke beim Truppkollegen aus |
| Grenadier | wählt Ziele **in Deckung**, hält Abstand | ballistischer Wurf, `gr: { x, y, t }` im Snapshot für Bogen und Aufschlag, meidet eigene Leute im Radius (nicht perfekt) |
| Schütze | sucht `aussicht`-Anker bzw. Deckungsplatz mit längster Sicht, bleibt zum Laden stehen | Ladezustand im Snapshot (Leuchten), weicht bei Nähe zurück |
| Enterer | push ohne Deckungssuche, kürzester Weg, nutzt Engstellen | Ausholen (Ankündigung) + Nahkampf, 2 Wunden |
| Häscher | sucht betäubte/isolierte Spieler | Betäuber + **Gefangennahme** (s. u.) |

- **Spawns** an `wache`-Ankern bzw. im Bereich statt an Legendenzeichen: `squad.spawnSquad(game, name, { map, bereich,
  besetzung: [{ typ, anzahl }] })`. Die Fraktion bestimmt den Mix, wenn die Besetzung nur „Trupp, Stärke 3“ sagt.
  Registry `content/katalog/gegner/*.json` (Typ, Waffe, Wunden, Profil, Fraktionen), Prüfer-Referenz wie bei
  Szenentypen.
- **Gefangennahme (Vorschlag, schlank):** Der Häscher hält 3 s an einem bewusstlosen Spieler → Spieler `gefangen`,
  versetzt an den nächsten `zelle`-Anker (Tür zu). Kameraden befreien ihn per Anker-Interaktion. Sind alle gefangen oder
  verwundet → Notrückholung wie heute („scheitern mit Würde“). Ohne `zelle`-Anker wirkt der Häscher nur betäubend.
  Das ist der Einstieg in *Ausbruch*. Den vollen Szenentyp sehe ich nicht in B2.

### 5.3 Waffenwahl am Transporter
- An der Transfer-Konsole (`T`, Transferkammer) oder am Pad: Auswahl 1–6. Cmd `loadout.waffe { waffe }`, Ereignis
  `loadout { pid, waffe }`, Snapshot `players[].wf` (+ `ht` Hitze 0–1, `ov` überhitzt).
- Weltstand: `crew.waffen: { <clientId-Hash>: "lanze" }`. Unbekannter Spieler → Blaster (Briefing). Hash statt Name,
  damit nichts davon ans LLM geht.

### 5.4 Risiken für das Tutorial m1–m3
| Punkt | Wirkung | Vorschlag |
|---|---|---|
| Blaster bekommt Hitze (auch in m3) | Dauerfeuer wie heute (0,3 s) überhitzt nach 5 Schuss; m3 fühlt sich anders an | Werte so legen, dass ein normaler Rhythmus (≈ 1 Schuss/0,6 s) nie überhitzt. Golden m3 **bewusst neu aufnehmen** wie in S2b, vorher Vergleich „gleiche Schrittfolge“ |
| Plünderer schießen mit Blaster-Regeln | KI-Feuerrhythmus 1,3 s überhitzt nie, also kaum Änderung | messen (BOTS) |
| Wunden statt `p.hp` | Spieler auf v2-Karten sind schon heute „Schild + 1 Wunde“, also keine Änderung | – |
| m1 (Plattform, alter Kampf) | unberührt, solange die Plattform im Tutorial beim alten Kampf bleibt (s. Frage 1) | – |
| Waffenwahl in m3 möglich | Wer in m3 den Granatwerfer nimmt, spielt m3 anders | gewollt (alle Waffen ab Start); Bots nehmen den Blaster |

## 6. B3 Sektorkarte
- **Daten:** `content/welt/limes.json` (`format: sektorkarte/1`, `hexe { SSZZ: { name, fraktion, art, hafen, einfluss,
  symbole, region, spielbar } }`, `kanten [{ a, b, art: open|locked:<key>|hidden|far:<key> }]`). Einmalig per
  Konvertierung aus `karte_limes.py` (Regex-Lesen habe ich getestet). Ab dann ist das **JSON die Quelle**, und
  `tools/check-sektoren.js` übernimmt die Prüfungen aus dem Python-Skript (Nachbarschaft, Erreichbarkeit) und die SVG.
- **Neu `shared/sektoren.js`** (UMD, reine Funktionen): Nachbarn (Formel aus dem Skript), Kanten-IDs, Hex→Pixel,
  Richtung je Kante. `shared/locations.js` bekommt `hex` je Ort, und `links`/`LOCKED_LINKS` werden aus den Kanten
  abgeleitet. Die API (`get`, `lockedKey`, `LOCATIONS`) bleibt, damit Missionen, Prüfer und Bots weiterlaufen.
- **Sprungregeln** in neuer Datei `server/sim/sprung.js` (`space.js` delegiert nur):
  - Normal: nur über offene oder geöffnete Kanten. Der **Sprungpunkt ist ein Szenenobjekt** am Szenenrand in Richtung
    des Nachbarhexes (Boje). Laden nur im Radius R (Startwert 250 px).
  - Fernsprung: `far:<key>`-Kante, in B3 alle gesperrt (Eridu).
  - Leerraum: Hex ohne System. Normal nicht erreichbar, nur per temporärem Sprungpunkt (Baustein
    `sprungpunkt_oeffnen { von, nach, temp }`) oder Notfallsprung.
  - **Notfallsprung:** Cmd `helm.notsprung`, Reaktor wird überladen (danach Neustart nötig, die Mechanik gibt es seit
    M1), Kante zufällig gewichtet nach Flugrichtung. Ziele sind nur spielbare Hexe: Saumraum oder angrenzender Leerraum.
    Leerraum bekommt eine **generische leere Raumszene aus Daten**. **Ausweg**, damit es keinen Softlock gibt: Nach dem
    Reaktor-Neustart ist ein zweiter Notfallsprung erlaubt.
- **Erkundung:** Weltstand `welt.sektoren: { erkundet: [hex], bojen_bekannt: [kantenId], temp: [...] }`. Weitscan findet
  Bojen. Unerkundete Hexe zeigen nur den Umriss, Hexe außerhalb des Saumraums gelten als `gesperrt`.
- **Migration der 8 Orte:** Weltstand v3 bildet `orte.bekannt/besucht` und `verbindungen_offen` auf Hexe/Kanten ab.
  Alte Stände laden weiter (Test mit S1- und S2-Fixtures).
- **Client:** neue Datei `public/js/starmap.js` (Hexraster, Fraktionsfarben, Hafenklasse, Symbole, Kantenmarken,
  Bojen-Zustände). `render.drawStarMap` delegiert dorthin. In der Raumszene erscheinen die Bojen als Marker und auf der
  Captain-Karte. Die Karte kommt einmal im `welcome` mit (≈ 6 KB).
- **Was im Tutorial bricht:**
  1. `nebel–wrack` entfällt, `b7–wrack` kommt dazu. Das trifft Routen in `sim-headless.js:426` und den Sternkarten-Text
     von m2 („wrack_notiert“). Gering, aber Golden-relevant.
  2. **Sprungpunkt anfliegen** verlängert jede Reise in m1–m3 und ändert die Schrittfolge (Ziel wählen → anfliegen →
     laden). Das widerspricht „spielt sich wie heute“, s. Frage 2.
  3. `check-maps` prüft „7 Orte, Verbindungen symmetrisch“ und wird auf Hexe umgestellt.

## 7. Teams, Dateibesitz, Wellen

### 7.1 Teams
| Welle | Team | Teilstufe | Dateien |
|---|---|---|---|
| 0 | Studioleitung | alle | `CONTRACT-B1/B2/B3.md`, `shared/config.js` Startwerte (Blöcke `buehne`, `awayCombat.waffen`, `awayCombat.gegner`, `sektoren`), `content/buehnen/anker.json`, **Schnitte**: leere Delegationen in `space.js` → `sprung.js`, `render.js` → `starmap.js`, `combat.js` → `waffen.js`; `package.json` |
| 1 | BUEHNE | B1 | **neu** `shared/buehne.js`, `server/sim/{landepunkte,anker}.js`, `server/world.js`, `tools/{check-maps,buehne,test-buehne}.js`, `content/welt/landepunkte.json`, `shared/maps.js` (nur `MAP_ANCHORS`, `inArea`) |
| 1 | KITS-OFFEN | B1 | `content/buehnen/{aussenposten,ruine}/**` |
| 1 | KITS-INNEN | B1 | `content/buehnen/{station,schiff}/**` |
| 1 | BODENKAMPF | B1→B2 | `server/sim/{combat,squad,away,interior}.js`. Welle 1: **Entkopplung** (kartenneutral, Kampf v2 auf allen Karten, Spawns an Ankern, Decks in der Außenzone); Welle 2: Gegner-KI-Profile |
| 1 | WAFFEN | B2 | **neu** `server/sim/waffen.js` + `tools/test-waffen.js` (Welle 1 reine Funktionen mit Tests, Welle 2 Einbau über die Schnittstelle in `combat.js`, die BODENKAMPF bereitstellt) |
| 1 | ENGINE | B1/B2/B3 | `server/mission/{checker,objects,registry,katalog,loader}.js`, `server/sim/mission.js`, `server/game.js`, `server/weltstand.js`, `content/schema/**`, `content/katalog/schema/**`, `shared/protocol.js` (**alleiniger Stift**, andere melden) |
| 1 | SEKTOR | B3 | `content/welt/limes.json`, **neu** `shared/sektoren.js`, `shared/locations.js`, `server/sim/{explore,sprung}.js`, `tools/check-sektoren.js` |
| 1 | KARTE | B3 | **neu** `public/js/starmap.js` |
| 1 | VOXEL | B1/B2 | `public/js/voxel/**` (Bau aus Kit-Legende + Palette statt je Zone, neue Figuren, Waffen-Effekte) |
| 1 | ART-* / AUDIO | alle | Voxelwerk-Assets, Manifeste, `public/js/{art,audio}.js` (Aufteilung durch den Art Director) |
| 1 | ENTERN | B1 | **neu** `server/sim/entern.js` (s. §10), Hook in `space.damageEnemy` setzt die Studioleitung in Welle 0 |
| 2 | KATALOG | B1/B2 | `content/katalog/{molekuele,szenentypen,gegner}/**`, `content/regiebuch/bausteine.json`, `content/spielleiter/archiv/*` (+ 2 Bodenmissionen) |
| 2 | SPIELLEITER | B1 | `server/mission/{spielleiter,szenenbau,context,llm}.js`, `content/spielleiter/prompts/**`, `tools/test-spielleiter.js`, Fixtures |
| 2 | CLIENT | B1/B2 | `public/index.html`, `public/js/{client,hud,consoles,render,net,dev-mock}.js` (`awayMap` registrieren, Waffenwahl, Hitze/Wunden-HUD, Granatbogen 2D) |
| 3 | BOTS | alle | `tools/{sim-headless,golden-trace}.js` (Agenten für neue Karten und Waffen, Seeds-Sweep im Spiel) |
| 3 | QA-INTEGRATION | alle | alle; Golden neu (m3 Hitze, B3-Route), Balancing, Performance (Tick und Snapshot) |
| 4 | QA-ABNAHME | je Teilstufe | alle; Browser-Durchläufe, 6 Live-Missionen (Budget ≈ 300k Tokens, unter dem 500k-Deckel je Serverlauf, also eventuell zwei Läufe), README |

### 7.2 Konfliktzonen
| Datei | Regel |
|---|---|
| `shared/config.js` | je Team eigener Block, Startwerte setzt die Studioleitung in Welle 0 |
| `shared/protocol.js` | nur ENGINE ergänzt (`VERSION 7`), andere liefern ihre Felder im Bericht |
| `server/weltstand.js` + Schema | nur ENGINE. Teams liefern `toSave/restore` (wie der Spielleiter in S2): `landepunkte`, `sektoren`, `crew.waffen` |
| `server/game.js` | nur ENGINE (Cmd-Routing `loadout.waffe`, `helm.notsprung`, dynamische `aways`) |
| `server/sim/space.js` | in B nur Delegationen (Welle 0), Logik in `sprung.js` (SEKTOR) und `entern.js` (ENTERN) |
| `server/sim/combat.js` | BODENKAMPF besitzt, WAFFEN baut erst in Welle 2 ein. **Größter Engpass** |
| `public/js/render.js` | CLIENT besitzt, KARTE und VOXEL arbeiten in eigenen Dateien |
| `shared/maps.js` | BUEHNE (nur Anker und `inArea`). Handkarten bleiben unverändert (Golden) |

### 7.3 Reihenfolge
- **B3 läuft komplett parallel** und kann zuerst abgenommen werden (kleinste Stufe, eigene Dateien).
- **B1 und B2 teilen sich `combat.js`/`squad.js`.** Die Entkopplung (BODENKAMPF, Welle 1) ist die Voraussetzung für
  Kampf v2 auf neuen Karten **und** für die KI-Profile. WAFFEN arbeitet in Welle 1 an der eigenen Datei vor.
- Der KATALOG wartet auf das Ankermodell (ENGINE) und die ersten gebauten Karten (BUEHNE + 1 Kit). Er kann mit der
  Ruine starten, weil die Kesh-Umsetzungen dorthin wandern.
- Abnahmen: B3 → B1 → B2. Die Rollen-Lesbarkeit (B2) lässt sich nur mit menschlichen Testern abnehmen, also mit Kai am
  Spieleabend. Agenten können das nicht ehrlich bestätigen.

## 8. Schätzung

### 8.1 Tatsächlicher Verlauf (aus Git, Wandzeit zwischen Commits, ohne Kais Abnahmezeit)
| Stufe | Wandzeit etwa | Zeilen (ohne Fixtures/Erzeugtes) | Plan im Fahrplan |
|---|---|---|---|
| M2 | ~1 Tag | 28k (Gesamtstand) | – |
| M4 (Voxel) | ~1 Tag | 27k | – |
| S1 | ~5 h | +8,5k / −1,9k | 2–3 Studio-Tage |
| S2 | ~10 h | +12k | 3–5 Studio-Tage |
| S2b | ~4 h | +1,9k | – |

Das Studio war 3–5-mal schneller als der Fahrplan. Agent-Stunden lassen sich aus Git nicht ablesen. Meine Schätzung für S2
liegt bei ≈ 50–70 Agent-Stunden (8 Teams in Welle 1, nicht alle die ganze Zeit).

### 8.2 Schätzung B (Agent-Stunden, Spanne)
| Team | B1 | B2 | B3 |
|---|---|---|---|
| Studioleitung (Verträge, Schnitte) | 3–4 | 1–2 | 1–2 |
| BUEHNE | 10–16 | – | – |
| KITS-OFFEN + KITS-INNEN (≈ 85 Module, 11 Schablonen) | 18–30 | – | – |
| BODENKAMPF (Entkopplung, Decks; KI-Profile) | 10–16 | 10–16 | – |
| WAFFEN | – | 8–12 | – |
| ENGINE | 8–12 | 2–4 | 2–3 |
| ENTERN (kampfunfähiges Schiff) | 4–6 | – | – |
| KATALOG (umstellen, ≥ 12 neue Umsetzungen, Gegner-Registry, 2 Archiv-Boden) | 8–12 | 2–4 | – |
| SPIELLEITER | 6–10 | 1–2 | – |
| SEKTOR + KARTE | – | – | 14–22 |
| CLIENT / VOXEL (ohne Art-Assets) | 12–18 | 8–12 | 2–4 |
| BOTS | 6–10 | 4–6 | 2–4 |
| QA-INTEGRATION + QA-ABNAHME | 12–18 | 8–12 | 4–6 |
| **Summe** | **≈ 97–152** | **≈ 44–70** | **≈ 25–41** |

**Studio-Tage** (Vertrag, Produktion, QA, Abnahme): B3 ≈ 1, B2 ≈ 1,5–2, B1 ≈ 2,5–4. Parallel gefahren sind das
insgesamt **≈ 4–6 Studio-Tage**, dazu Spieleabende mit Kai. B1 ist 1,5–2-mal so groß wie S2. Die Unsicherheit liegt
beim **Kit-Inhalt** (gute taktische Module lassen sich nicht beliebig parallelisieren) und beim Schiff mit zwei Decks.
Die Art-Assets schätzt der Art Director, sie sind hier nicht enthalten.

## 9. Risiken und offene Entscheidungen für Kai

### 9.1 Risiken
| Risiko | Gegenmittel |
|---|---|
| BFS-gültig ≠ gute Karte (Sichtgassen, tote Höfe) | Deckungs- und Sichtgassen-Metrik im Prüfer, `tools/buehne.js`-Galerie für Kai, 3 Seeds je Art im Browser gespielt (Abnahme) |
| 76 harte Kartenbezüge (Server + Client), Regression in m1–m3 | Entkopplung als eigene Welle, Golden nach jeder Welle, Handkarten-Pfade bleiben über Adapter bestehen |
| Voxel-Bau großer Karten (Außenposten = 2,3 × Kesh-Fläche) | M4-Performance-Budget messen. Notfalls geringere Dekorationsdichte |
| Snapshot > 13 KB (Mischtrupps, Sturmgewehr-Projektile, Granaten) | Projektile kürzen und kappen, Messung in QA |
| Seed-Drift bei Moduländerungen | `bauversion` + Zustände über Anker-IDs (§2.6) |
| Zwei Decks auf der Außenkarte | Fallback mit einem Deck (§2.5) |
| Live-Abnahme 6 Missionen ≈ 300k Tokens | auf zwei Serverläufe verteilen, Budget im Vertrag festlegen |
| Rollen-Lesbarkeit nur mit Menschen prüfbar | Abnahmepunkt am Spieleabend mit Kai, nicht durch QA-Agenten |

### 9.2 Fragen an Kai (Frage → Empfehlung)
1. **Kampf v2 auf der Plattform in m1?** Das Briefing will v2 auf allen Karten, aber m1 soll sich spielen wie heute.
   → *Empfehlung:* Im Tutorial-Buch m1 bleibt der alte Kampf, bei jedem späteren Besuch gilt v2.
2. **Sprungpunkt anfliegen auch im Tutorial?** Es verlängert jede Reise und ändert die Schrittfolge in m1–m3.
   → *Empfehlung:* In m1–m3 bleibt der Faltsprung von überall (Schalter je Buch), im freien Spiel muss man anfliegen.
3. **Hitze verändert m3.** → *Empfehlung:* Hinnehmen, Werte so wählen, dass ein normaler Rhythmus nicht überhitzt,
   Golden bewusst neu aufnehmen wie in S2b.
4. **Friendly Fire nur beim Granatwerfer?** → *Empfehlung:* Flächenwirkungen treffen alle, direkte Schüsse für beide
   Seiten nicht die eigenen Leute (gleiche Regel für alle, keine KI-Schusslinienlogik, kein Frust zu dritt).
5. **Quelle der Karte Limes:** → *Empfehlung:* Das JSON im Repo ist maßgeblich (Node-Werkzeug mit Prüfung und SVG).
   Das Python-Skript im Vault bleibt der Entwurf.
6. **Notfallsprung in Leerraum:** → *Empfehlung:* Nur in Saumraum- oder Leerraum-Nachbarn, Leerraum als leere Szene
   aus Daten, zweiter Notfallsprung nach Reaktor-Neustart als Ausweg (kein Softlock).
7. **Rostnest (0107, verborgen):** → *Empfehlung:* In B3 nicht erreichbar, später ein Fall für den Spielleiter.
8. **Gegner am Boden:** → *Empfehlung:* Ein gefallener Gegner bleibt außer Gefecht, Gegner beleben sich nicht gegenseitig
   (spart KI). Die Lead GD kann das anders sehen.
9. **Waffenwahl je Spieler:** → *Empfehlung:* gespeichert über einen Hash der Browser-Kennung, nicht über Farbe oder
   Namen. Neuer Browser startet mit dem Blaster.
10. **Bodenquote:** → *Empfehlung:* „lang“ ab 25 min Zieldauer. Durchgesetzt als weiche Pflicht (eine Nachbesserung,
    dann Warnung), beide Spielleiter-Angebote mit Bodenszene, wenn die Quote fällig ist.
11. **Schiff mit zwei Decks in B1** oder einem Deck mit Nachrunde? → *Empfehlung:* zwei Decks anstreben, Fallback mit einem
    Deck im Vertrag erlauben.

## 10. Schiffskarte erreichen
**Was es gibt:** Feindschiffe (`space.js`) haben nur `hp` und 4 Schildsektoren (`CONFIG.enemyShields`) und werden bei
`hp ≤ 0` aus der Liste entfernt (`damageEnemy`, Zeile 1301). **Keine Systeme, kein Schildgenerator.** Beamen geht nur
zum festen `scene.beam` eines Ortes (Reichweite von der Station). Wiederverwendbar ist der Zustand `kampfunfaehig`
der Schützlinge (`escort.js`: treibt, Wrackoptik, wird nie gelöscht) und die Transfer-Logik.

| Variante | Aufwand | Wirkung auf den Raumkampf |
|---|---|---|
| **A: kampfunfähiges Feindschiff betreten** (Kanonenboot/Wächter bei hp ≤ 25 % → treibt, feuert nicht, Rauch; Beamziel = Schiff im Radius; Landepunkt `schiff` mit Seed aus der Gegner-ID und Besitz aus der Fraktion; bleibt bis zum Verlassen der Szene, danach als Wrack-Landepunkt am Ort im Weltstand) | 4–6 h Server + Darstellung des treibenden Kanonenboots | keine im Tutorial (nur außerhalb von m1–m3 aktiv), sonst nur ein neuer Endzustand |
| **B: gezielte Systemtreffer + volle Enterregel** (Systemmodell je Gegner, Zielen auf Systeme mit Lanze/Batterien, Beamen bei Ausfall des Schildgenerators **während** des Gefechts) | 20–30 h, dazu Designfragen: Wer fliegt die Lerche, während das Außenteam drüben ist? Was macht der Gegner weiter? | **verändert den Raumkampf** (§6: bleibt unverändert) und gehört eigentlich mit der Enterabwehr zusammen (§5: nicht in diesem Paket) |

**Empfehlung:** Variante A in B1, dazu Wrack-Landepunkte an Orten (z. B. `wrack.b`). Variante B als eigene Stufe zusammen
mit der Enterabwehr. Das ist dieselbe Mechanik von beiden Seiten und folgt dem Grundsatz „gleiche Regeln für alle“.

## 11. Nachrunde nach Kais Feedback

Kai (verbindlich): S2b ist abgenommen. Rom und Germanen bekommen eigene Bauweisen und Bodentruppen. Die neuen Gegner
sind zuerst Germanen. Station = Germanen, Ruine = Römer. Und: „lieber Systeme schaffen, die uns die Arbeit auf Dauer
erleichtern“.

### 11.1 Systeme für den Kartenbau (neu bewertet)
Mein „grafischer Editor in B1 nicht nötig“ nehme ich zurück, allerdings in einer **schlanken Form**. Agenten schreiben
ASCII schneller als über eine Oberfläche. Der Editor spart Zeit im **Prüfen und Nachbessern** und beim **Mitbauen durch
Kai/Menschen**, und das wird mit jeder neuen Fraktion und Kartenart wichtiger.

| Kandidat | Kosten | Ersparnis je künftiger Kartenart/Fraktion | Empfehlung |
|---|---|---|---|
| **Gemeinsame Kit-Legende** über alle Fraktionen (Zeichen → neutrale `kind`: `wand`, `deckung_halb`, `tuer`, `schott` …; Bauweise ordnet die Voxel-Bauteile zu) | 2–4 h (BUEHNE, Welle 0/1) | Voraussetzung für die nächste Zeile. Ohne sie kostet jede Fraktion eine eigene Legende samt Prüfer-, KI- und Renderer-Anpassung (~6–10 h) | **jetzt** |
| **Schablonen und Module fraktionsneutral, Bauweise als Parameter** (`bauen({ art, seed, besitz, bauweise })`). Module dürfen optional `bauweise: [...]` tragen, z. B. für Leitstücke wie Langhaus-Tor oder Castra-Tor | 3–5 h (BUEHNE + VOXEL-Abbildung) | **24–38 h KITS je weiterer Fraktion** entfallen (keine neuen ASCII-Module). Es bleiben Art-Bauteile und Palette | **jetzt** |
| **Kartengalerie mit Seed-Sweep und Bewertung** (`tools/buehne.js sweep` + Browserseite `?galerie=station`: Vorschaubilder, Bestehensquote, Kennzahlen: Deckungsanteil, längste Sichtgasse, Weglänge Eingang → Ziel, Engstellen, Zahl der Wege) | 6–10 h (BUEHNE + VOXEL/CLIENT, nutzt den Kit-Renderer) | 3–5 h QA je Kartenart; schwache Schablonen fallen vor dem Spieltest auf. Kai kann Karten ansehen, ohne zu spielen | **jetzt** |
| **Modul- und Schablonen-Werkstatt im Browser** (Raster, Zeichenpalette aus der Kit-Legende, Ankerebene, Kanten farbig, Live-Prüfung mit `shared/buehne.js`, Drehvorschau; speichert über eine Debug-Route nach `content/buehnen/` oder als Download) | 10–14 h (neu `public/werkstatt.html` + `public/js/werkstatt.js`, Team WERKSTATT) | 20–30 % der Kit-Zeit je Kartenart (Fehler sieht man sofort statt im CLI-Durchlauf), dazu ein Weg für Kai, selbst Module zu bauen | **jetzt, schlank** (keine Undo-Historie, kein Mehrbenutzer) |
| **Besetzung aus Fraktionsregeln** (`content/katalog/fraktionen/*.json`: Mix, Stärke je Crewgröße, bevorzugte Anker `wache`/`aussicht`, Patrouillen) → der Spielleiter nennt nur Fraktion und Stärke | 3–5 h (KATALOG + BODENKAMPF, zum Teil schon in B2 geplant) | 2–4 h je Fraktion; weniger Fehlerquellen im LLM-Plan | **jetzt** (B2) |
| **Automatische Deckungsvorschläge** (Lint: „Sichtgasse 15 Kacheln in Hof Ost, Vorschlag `o` bei 12,7“, in Werkstatt und Galerie angezeigt, nicht automatisch eingebaut) | 4–6 h | 1–2 h je Kartenart | **später** (erst wenn die Galerie-Kennzahlen zeigen, wo es hakt; die Kennzahl selbst ist schon in der Galerie) |

Die Werkstatt macht den Kit-Renderer (AD, +10–16 h aus der Nachschätzung) zur gemeinsamen Grundlage für Spiel,
Galerie und Werkstatt. Deshalb muss VOXEL in **Welle 1** starten.

### 11.2 Was die Fraktionszuordnung ändert
- **Gegner-Registry:** Typen bleiben rollen- und fraktionsneutral (Niederhalter, Grenadier, …). Die Fraktion bestimmt
  Mix, Bauweise der Figur und Palette. „Zuerst Germanen“ heißt: Fraktion `germanen` mischt alle 5 neuen Typen,
  Rostmeute und Konkordat bekommen sie später nur über den Mix. **Code-Mehraufwand ≈ 0**, der Aufwand liegt bei Art
  (Figuren).
- **Präsenz im Saumraum:** Spielbar ist nur der Saumraum, Germanen und Römer leben dort nicht (GD-Befund 7). Technisch ist
  `besitz` je Landepunkt frei wählbar. Damit der Spielleiter das nicht beliebig setzt, braucht die Hexkarte eine
  Präsenzangabe je Fraktion (`limes.json`: `praesenz: { germanen: ["0405", …] }`) und der Prüfer eine Warnung
  `BESITZ-REGION`. Das kostet 1–2 h (SEKTOR + ENGINE). **Abnahmerisiko B2:** Ohne Germanen-Landepunkte im Saumraum (z. B.
  Kundschafter-Station) lassen sich die neuen Gegner im echten Spiel nicht zeigen. Die Lead GD muss solche Landepunkte
  setzen.
- **Station = Germanen, Ruine = Römer:** Vom ersten Tag an braucht es mindestens 4 Bauweisen (Konkordat/Rostmeute für
  Außenposten und Schiff, Germanen, Rom, Vorläufer bleibt als Ruinen-Unterbau). Das bestätigt die neutrale Legende
  (§11.1), ein Sonderweg je Kartenart wäre teurer. Code +2–4 h im Kit-Renderer (Bauweisen-Tabelle statt einer Palette).
- **Landepunkte:** Format unverändert. `content/welt/landepunkte.json` bekommt `bauweise` (Standard aus `besitz`).

### 11.3 Neue Gesamtschätzung Code (Agent-Stunden, ohne Art)
| Teilstufe | vorher (+ GD-Nachschätzung) | + Systeme §11.1/§11.2 | neu | Studio-Tage |
|---|---|---|---|---|
| B1 | 120–187 | Legende 2–4, neutral/Bauweise 3–5, Galerie 6–10, Werkstatt 10–14, Bauweisen 2–4, Präsenz 1–2; abzüglich QA-Ersparnis 3–5 | **≈ 141–221** | 3,5–5 |
| B2 | 74–116 | Besetzung aus Fraktionsregeln 3–5 | **≈ 77–121** | 2,5–3 |
| B3 | 25–41 | – | **25–41** | ≈ 1 |
| **Summe** | | | **≈ 243–383** | parallel **≈ 6–8** |

Der Mehraufwand von etwa 25–40 h zahlt sich ab der **zweiten neuen Fraktion bzw. Kartenart** aus: Je Fraktion fallen
24–38 h KITS weg, und jede neue Kartenart spart etwa 8–15 h (Werkstatt, Galerie, Besetzung). G1 nutzt dieselbe Galerie
und dieselben Kennzahlen.
