# CONTRACT-EK3 – Lagerraum, Ladung, Beamen, Weltstand (EK3 Teil A)

Grundlage: `Briefing Eisenwald-Kampagne (EK1-EK9)` (EK3) und `Planung Eisenwald-Kampagne (EK1-EK9)` (EK3, E6) im Vault
(`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`). Branch `ek2-lager` (Basis `ek1`), Voxelwerk-Branch `ek2-lager` (Worktree `..\voxelwerk-lager`).
**Teil B (Konvoi-Szene)** berührt `space.js` und folgt, wenn EK2 gemerged ist. Er ist hier **nicht** gebaut.

## 1. Stand
| Schritt | Inhalt | Stand |
|---|---|---|
| A1 | Grundriss: Frachtraum auf Deck II ersetzt Bad und Aussicht, zwei Frachtbuchten, Karte, Räume, Prüfer | fertig |
| A2 | `server/sim/fracht.js`: Fracht im Raum, Beamen (Halteprozess), Abliefern, Szenenwechsel, Snapshot, Weltstand | fertig |
| A3 | Taktik-Anzeige (Leiste, Balken, Strahl), Frachtraum in 2D und Voxel, Voxel-Modell `lerche/furn/cargo_bay` | fertig |
| A4 | Regiebuch-Bausteine, Katalog (`ladung_transfer` verfügbar), Prüfer, Protokoll, Debug | fertig |
| B | Konvoi-Szene (1 Jäger, 1 Korvette, 1–3 Transporter als Gegner, Route, Sprung), Siegbedingungen Aufhalten/Plündern | **offen (nach EK2)** |

## 2. Befund Grundriss (Antwort auf „Welche Räume entfallen?“)
Das **Quartierdeck** ist Deck II (Privatdeck, Atlas-Zeilen 16–28, in der Karte oben im Schiff, `level 1`). Es hatte 13 Räume.
- **Entfallen: `bad` (Bad, 22–24 × 25–27) und `aussicht` (Aussicht, 26–28 × 25–27)** samt Trennwand x = 25, Panoramafenster (`%`, drei
  Kacheln) und Aussichtsbank. Das Becken (`o`) ist weg.
- **Neu: `frachtraum` (Frachtraum), 22–28 × 25–27**, Sektor −1 (kein Feuer, kein Leck, `hazardAllowed` bleibt falsch). Beide Türen zum
  Atrium (22,24) und (26,24) bleiben. Zwei Frachtbuchten `g` (Legende `cargo_bay`, solide) an der Nordwand: `bay0` (23,25), `bay1` (27,25),
  Zugangskacheln (23,26) und (27,26). Bodenart `floor_metal`.
- Raumzahl Deck II 11, gesamt 20 → 19 (zwei Räume weg, einer neu). Der Name ist **Frachtraum**, nicht „Lager“: Das **Lager** (Regale mit Ersatzteilen) ist der
  Raum `lager` auf Deck I und bleibt, die Verwechslung wäre in Ansagen und Hinweisen („Lager an Bord“) real. Das Briefing nennt beides „Lagerraum“.
- **Kollision:** zwei neue solide Kacheln, vier alte (Becken ×2, Bank, Wand-Segment) weniger. Mosaikboden `:` im Bad/Aussicht ist Metallboden.
- **Wege:** Deck II bleibt vom Lift (und über Atrium) vollständig erreichbar (Test BFS), Ivo-Plätze unverändert begehbar (der Platz (26,26) liegt jetzt im Frachtraum).
- **Reparaturpunkte:** keine betroffen. Deck II hat **keine Stationen** (Systeme stehen auf Deck I), und der Frachtraum ist kein Schiffssystem.
- **Regal-Zuordnung:** keine betroffen. Die fünf Regale (`SHELF_TILES`) stehen im Raum `lager` auf Deck I.
- **Bots:** nutzen Deck II nie (kein Lift), Wegsuche unverändert.
- **Voxel:** neues Modell `lerche/furn/cargo_bay` (Voxelwerk, Manifest `art-e.json`, Parameter `art` 0 leer / 1 Sprengstoff / 2 Fracht, `gesichert` 0/1),
  gebaut im Voxel-Layer `ship.js` aus `snapshot.fracht.lager`. Die Modelle `bath`, `bench` und die Asset-Listen-Einträge C28/C29 bleiben im Voxelwerk
  ungenutzt (als „entfällt (EK3)“ markiert).
- **`concept/deckplan.svg`** ist die alte Außenansicht (Entwurf vor M4, keine Raumbeschriftung) und wurde **nicht** angepasst. Maßgeblicher Deckplan ist die
  Karte (`SHIP_ROWS`), die 2D- und Voxel-Ansicht lesen.

## 3. Entscheidungen
| # | Entscheidung | Grund |
|---|---|---|
| D1 | Frachtraum heißt `frachtraum` / „Frachtraum“, Kachel `g` = `cargo_bay`; Kapazität = Anzahl der Buchten (`Maps.CARGO_CAPACITY` = 2) | Verwechslung mit dem Regal-Lager (Deck I) vermeiden; Kapazität an einer Stelle |
| D2 | Frachtbuchten an der **Nordwand**, nicht an der Südwand | In der Voxel-Kamera verdeckt die vordere Wand die Südseite, die Ladung wäre unsichtbar (Screenshot-Befund) |
| D3 | Fracht im Raum liegt **nicht** im Weltstand, die mitgeführte Ladung schon (`schiff.fracht = ['sprengstoff', …]`, nur wenn vorhanden) | Briefing; Ladung im Raum verfällt mit dem System; alte Stände bleiben bit-gleich |
| D4 | „System verlassen“ = die Szene (`ship.scene`) wechselt. Das erkennt `fracht.update` selbst (kein Eingriff in `space.js`) | Konflikt mit Team RAUM2 vermeiden |
| D5 | Haltezeit = `ship.beamTime` (3 s), bei beschädigtem Transfer `ship.beamTimeDamaged` (6 s) | gleiche Regel wie das Beamen des Teams; Systemtabelle „Transfer beschädigt: Beamen dauert länger“ |
| D6 | Reichweite `CONFIG.fracht.beamRange` = **320**, gleich `scene.beam.range` der Außenkarten (B-7, Wrack; Kesh 360). Keine Tempogrenze (`beamMaxSpeed`) | Antwort auf die Frage des Briefings; im Gefecht wäre „Steuer auf Stopp“ ein zusätzlicher Zwang, den das Briefing nicht verlangt |
| D7 | Beamen belegt **nicht** `ship.beaming` (die Schilde bleiben oben); Systemtreffer = tatsächlicher Systemschaden (`interior.damageSystem` mit Zustandswechsel), Schildtreffer ohne Durchlass nicht | Briefing „Schildtreffer nicht“ |
| D8 | Zusätzliche Abbruchgründe: Transfer ausgefallen/EMP, Fracht außer Reichweite, Taktik-Konsole verlassen, Szenenwechsel | sonst liefe ein Vorgang ohne Bediener weiter |
| D9 | **Abliefern ist derselbe Halteprozess** (3 s, Systemtreffer bricht ab) und gibt alle Ladungen auf einmal ab | „Abliefern ebenfalls von der Taktik“, gleiche Lesbarkeit; Skript-Abgabe ohne Halten per `fracht_abliefern` |
| D10 | Abnehmer: `fracht_abnehmer { ort, name }` begrenzt die Abgabe auf diesen Ort, ohne Abnehmer nimmt **jede Station** (`scene.station.kind` ∈ `station`, `vaelen`) im Umkreis `fracht.stationRange` (320) an | Briefing: Auftraggeber bzw. bei Zufallsereignissen jede Station |
| D11 | `itemAboard: 'sprengstoff'` zählt die Fracht im Frachtraum (Gegenstandstyp = Art) | Regiebücher können ohne neuen Baustein fragen |
| D12 | Das Lager ist kein Schiffssystem: nicht in `ship.systems`, `SYSTEM_ORDER`, `power`, nicht von `hitSystems` wählbar | Briefing |
| D13 | Mechanik `ladung_transfer` im Katalog auf `verfuegbar` (Fracht per Transfer); **Personen** per Transfer bleiben geplant | Katalog ehrlich halten |

## 4. Schnittstellen
### 4.1 Server (`server/sim/fracht.js`)
- `fracht_abwerfen(game, x, y, art)` (auch `abwerfen`): legt Fracht in der aktuellen Szene ab. `art` ∈ `CONFIG.fracht.arten` (`sprengstoff` | `fracht`), sonst `null`.
  **Aufruf der Konvoi-Szene (Teil B):** beim Zerstören eines Transporters `Fracht.fracht_abwerfen(game, e.x, e.y, 'sprengstoff')`. Höchstens
  `CONFIG.fracht.maxDraussen` (6) je Szene, die älteste fällt weg.
- `beamStart(game, p, id?)`, `abliefernStart(game, p)`, `beamStop(game, grund)`, `update(game, dt)` (im Tick nach `space.update`), `systemTreffer(game, sys)`
  (aus `interior.damageSystem`).
- Abfragen: `anBord(game, art?)`, `frei(game)`, `capacity()`, `lagerArten(game)`, `draussen(game)`, `abgeliefert(game, art?)`, `ablieferOrt(game)`.
- Schreiben für Skripte und Tests: `anBordLegen(game, art)`, `skriptAbliefern(game, art?, n?)`, `setAbnehmer(game, ort, name)`, `toSave/restore`.
- **AP9 „Lager ohne Strom“:** `gesichert(game)` (Standard `true`) und `setGesichert(game, bool)`. Heute **ohne Wirkung**, nur im Snapshot (`fracht.g = false`) und in der
  Anzeige (rotes Sicherungslicht, Taktik „UNGESICHERT“, Voxel-Parameter `gesichert`). AP9 hängt „Energie aus → `setGesichert(false)`“ und das Ausbrechen daran.
- Zustand: `game.fracht = { lager: [{ art }], draussen: [{ id, x, y, art, szene }], halt: { kind, id, t, dur } | null, gesichert, abnehmer, abgeliefert, szene, seq }`.

### 4.2 Befehle, Ereignisse, Snapshot
- `weapons.fracht { id? }` startet das Beamen (nächste Fracht in Reichweite, oder `id`); `{ off: true }` bricht ab. `weapons.abliefern` startet die Abgabe. Beide nur an der Taktik-Konsole.
- Ereignis `frachtBeamen { phase: 'start'|'abbruch'|'fertig', was: 'an'|'ab', grund?, art?, n? }`, `frachtAbgeworfen { id, x, y, art }`.
  Gründe: `systemtreffer`, `transfer`, `reichweite`, `taktik`, `szene`, `weg`, `voll`, `ort`, `abgebrochen`.
- missionEvent: `frachtAbgeworfen`, `frachtAnBord { art, n, id }`, `frachtAbgeliefert { n, arten, ort, name }`.
- Snapshot `fracht` (fehlt, wenn nichts da ist): `{ lager: [art], draussen: [{ id, x, y, art }] (nur diese Szene), halt: { kind, id?, p }, ab: 1, abn: Name, g: false }`.
- Debug (`npm run debug`): `fracht abwerfen [art] [dx dy]`, `fracht an [art]`, `fracht leer`, `fracht gesichert an|aus`, `fracht abnehmer [ort] [name]`, `fracht status`.

### 4.3 Weltstand
`schiff.fracht`: Array der Arten je belegter Bucht (höchstens 4 laut Schema, beim Laden auf die Kapazität gekappt, unbekannte Arten gefiltert). Fehlt das Feld
(alte Stände, leerer Frachtraum), ist der Frachtraum leer. Keine neue Versionsnummer nötig (additiv, optional). Abnehmer, Zähler `abgeliefert` und Ladung im Raum sind Laufzeit.

### 4.4 Regiebuch
| Baustein | Art | Parameter |
|---|---|---|
| `fracht_abwerfen` | Aktion | `art?`, `x?`, `y?` (ohne Position 160 px vor der Lerche) |
| `fracht_abnehmer` | Aktion | `ort?` (loc), `name?` |
| `fracht_abliefern` | Aktion | `art?`, `n?` (Skript-Abgabe ohne Taktik) |
| `fracht_an_bord` | Prüfung | `art?`, `min?` (Standard 1) |
| `fracht_abgeliefert` | Prüfung | `art?`, `min?` (Standard 1) |
Registriert in `server/mission/bausteine/fracht.js`, Vertrag in `content/regiebuch/bausteine.json`, Prüfer-Probe in `tools/test-lager.js`.

## 5. Bedienung (Taktik)
Oben links in der Taktik-Karte erscheint die **Fracht-Leiste**, sobald Fracht in der Szene liegt, an Bord ist oder ein Vorgang läuft: `FRACHT n/2`, Taste **F**
(„Fracht beamen“ / „Beamen abbrechen“), Taste **G** („Abliefern“), Balken und Text „Beame an Bord … 54 %“. Gesperrte Knöpfe nennen den Grund (Transfer ausgefallen, Frachtraum
voll, keine Fracht in Reichweite, kein Abnehmer hier). In der Karte (und in der Frontsicht als Randpfeil) erscheint die Fracht als Kiste mit Ring, beim Halten mit Strahl und Fortschrittsring.

## 6. Abnahme
Siehe §7 (Messwerte). Bewusst **nicht** Teil dieser Abnahme: Konvoi-Szene (Teil B), Bots für Fracht, Balancing der Ladung.

## 7. Messwerte und Golden
_wird bei der Abnahme ergänzt_
