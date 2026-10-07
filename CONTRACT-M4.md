# CONTRACT-M4 – „Lerche in Voxel“ (Stufen 1, 2, 4)

Stand 2026-10-07 · Studioleitung · baut auf CONTRACT.md … CONTRACT-M3B.md auf. Vorhandene Feldnamen werden **nicht**
gebrochen. Bei Widerspruch zwischen diesem Vertrag und dem Code gilt der Code – dann der Studioleitung melden.
Pitch: https://claude.ai/artifact/MpWAFf29WYccefBcNYUGfJ · Asset-Liste: `concept/ASSET-LISTE-VOXEL.md`.

## 0. Ziel und Umfang

**Kai-Entscheidungen 2026-10-07:**
- Umgesetzt werden **Stufe 1 „Zwei Decks“**, **Stufe 2 „Lerche innen in Voxel“** und **Stufe 4 „Außenmissionen in Voxel“**.
- **Nur die Bereiche, in denen man als Figur herumläuft**, werden Voxel: das Schiffsinnere (beide Decks), Plattform B-7, Wrack „Zaunkönig“ und Kesh.
- **UI bleibt, wie sie ist:** HUD, Konsolen, Minispiele, Lobby, Sternkarte, Planungstisch-Ansichten. **Raumkampf und Pilot-Frontsicht bleiben 2D** (Stufe 3 kommt später).
- Die Lerche bleibt klein (1 Kachel = 1 m). Privatdeck: im Gefecht sicher, die Krankenstation ist nur Kulisse.
- Crew an Bord ohne Helm, mit Gesicht. Helme nur fürs Außenteam.
- Das Kanonenboot bekommt später (Stufe 3) einen nordischen Rumpf. Für M4 nicht relevant.
- **Referenzgerät ist der Entwicklungslaptop** (dieser Rechner). Alle Mitspieler haben stärkere Geräte.
- Die Asset-Erstellung wird **stark parallelisiert**: acht Art-Teams.

## 1. Teams und Dateibesitz

Kein Team ändert fremde Dateien. Braucht ein Team eine Änderung in einer fremden Datei, meldet es das in seinem Abschlussbericht
(oder sofort per Nachricht an die Studioleitung). Keine Git-Commits durch Teams.

| Team | besitzt | Test-Port | Screenshots |
|---|---|---|---|
| **DECKS** (Stufe 1) | `shared/maps.js` (Schiffsteil), `shared/config.js`, `shared/protocol.js`, `shared/schema.js`, `server/**` **außer** `server/index.js`, `tools/check-maps.js`, `tools/test-*.js`, `tools/sim-headless.js`, `tools/ws-smoke.js`, `public/js/dev-mock.js`, in `public/js/art.js` **nur** die 2D-Zeichnung der neuen Kachelarten (§2.3), in `public/js/hud.js` nur Texte/Hinweise für Lift und Leiter | 3311 | `shots/decks/` |
| **PIPELINE** | `tools/sync-assets.mjs`, `tools/check-assets.mjs`, `server/index.js`, `package.json`, `public/vendor/three/**`, `public/voxel/**` (generiert), `public/voxel-gallery.html`, `assets/manifest/_schema.md` | 3312 | `shots/pipeline/` |
| **CORE** (Client Voxel) | `public/index.html`, `public/js/client.js`, `public/js/render.js`, `public/js/voxel/{boot,renderer,loader,ship}.js` | 3313 | `shots/core/` |
| **ACTORS** (Client Voxel) | `public/js/voxel/{actors,fx}.js` | 3314 | `shots/actors/` |
| **AWAY** (Client Voxel) | `public/js/voxel/away.js` | 3315 | `shots/away/` |
| **ART-A** Bausatz | voxelwerk `assets/models/lerche/kit/**` (außer `pad`), `assets/moods/ship_private.json`, Manifest `assets/manifest/art-a.json` | VW 3421 | voxelwerk `shots/art-a/` |
| **ART-B** Stationen I | `assets/models/lerche/station/{reactor,reactor_switch,shield_gen,life_support,engine,thruster,lance}.json` (+ eigene Teilmodelle unter `lerche/station/parts_b/`), Manifest `art-b.json` | VW 3422 | `shots/art-b/` |
| **ART-C** Stationen II + Konsolen | `assets/models/lerche/station/{battery,emitter,transfer}.json`, `lerche/console/**`, `lerche/kit/pad.json` (+ `lerche/station/parts_c/`), Manifest `art-c.json` | VW 3423 | `shots/art-c/` |
| **ART-D** Möbel + Deko | `assets/models/lerche/furn/**` außer den Dateien von ART-E, `lerche/deco/**`, Manifest `art-d.json` | VW 3424 | `shots/art-d/` |
| **ART-E** Lift, Lager, Maschinenraum | `assets/models/lerche/lift/**`, `lerche/furn/{shelf,pipes,workbench,control_desk,barrel,crate,floor_decal}.json`, Manifest `art-e.json` | VW 3425 | `shots/art-e/` |
| **ART-F** Crew, Bots, Posen, Gegenstände | `assets/figures/lerche/crew_*.json`, `figures/lerche/ivo.json`, `assets/models/fig/lerche/**` (Bordkleidung, Köpfe), `assets/models/lerche/actor/bot.json`, `assets/models/lerche/item/**` außer Waffen, **`assets/poses/human.json`**, Manifest `art-f.json` | VW 3426 | `shots/art-f/` |
| **ART-G** Gegner Außenteam | `assets/figures/lerche/scavenger.json`, `assets/models/fig/rostmeute/**`, `assets/models/lerche/actor/{drone,warden}.json`, `assets/models/lerche/item/{blaster,scav_rifle}.json`, Manifest `art-g.json` | VW 3427 | `shots/art-g/` |
| **ART-H** Außenmissionen | `assets/models/away/**`, `assets/palettes/{mond_kesh,wrack}.json`, `assets/moods/{kesh_dusk,wreck_dark,platform_space}.json`, Manifest `art-h.json` | VW 3428 | `shots/art-h/` |
| Studioleitung | `CONTRACT-M4.md`, `assets/palettes/lerche_rom.json` (Voxelwerk, schon angelegt), Verträge | – | – |

- **Pfade:** Sternenschicht = `C:\Users\k.klein\privat\Gametest\sternenschicht`, Voxelwerk = `C:\Users\k.klein\privat\Gametest\voxelwerk`.
- **Manifeste** liegen im Spiel: `sternenschicht/assets/manifest/<team>.json`.
- **Shell:** Git-Bash hängt in diesem Ordner → **PowerShell** benutzen.
- **Testserver:**
  - immer `PORT=<eigener Port>` und `ROOM_CODE=off`
  - vor dem Beenden der Arbeit den eigenen Testserver stoppen
- **Voxelwerk-Server:** `$env:PORT=34xx; node server.js`, Screenshots mit `node tools/shots.cjs --port 34xx --out shots/<team> model=<id>`.
- **Playwright:** `C:\tmp\pwtest` (playwright-core, Chromium unter `%LOCALAPPDATA%\ms-playwright\chromium-1234`). Eigene Skripte nach `C:\tmp\pwtest\sts\m4-<team>-*.js`.

## 2. Stufe 1 – Zwei Decks (DECKS)

### 2.1 Atlas

Beide Decks liegen **übereinander in einer Karte**:
- Deck I (Systemdeck) belegt die Zeilen 0–12, Deck II (Privatdeck) die Zeilen 16–28.
- Die Zeilen 13–15 sind leer (`' '` = void, solid). `DECK_STRIDE = 16`. Breite 37.
- `Maps.ship` bleibt **eine** Karte. Kollision, `solid`, Feuer und Sektoren funktionieren unverändert.
- Die Karte ist von der Studioleitung per BFS geprüft (`scratchpad/decks-bfs.js`, Ergebnis siehe §2.5).

```
SHIP_ROWS (Bug rechts, Backbord oben):
           0         1         2         3
           0123456789012345678901234567890123456
  0       '##########################           '
  1       '#===#LLLLL#y===u#=F==M==U#######     '
  2       '#A==#.....#=====#========#^^....##   '
  3       '#===#.....#==R==#========#^^.W....#  '
  4       '#===###D###=====##D##D###.........## '
  5       '#===#!....#=====#........#.YY......K#'
  6       '#E==D.....D=====D........D.YY.C..H..#'
  7       '#===#.....#=====#........#.........I#'
  8       '#===###D###=====##D##D###.........## '
  9       '#===#.....#O=G==#========#..q.....#  '
 10       '#===#.P.P.#=====#========#......##   '
 11       '#==f#X.P.T#u===y#=Z==J==V#######     '
 12       '##########################           '
 13-15    37 Leerzeichen
 16       '    ##########################       '
 17       '    #B,,#B,,#S,,,,,,j#t,t#:::#       '
 18       '    #,,,#,,,#,,,mm,,,#,,,#^^:#       '
 19       '    #,,,#,,,#,,,mm,,,#,a,#^^:#       '
 20       '    ##D###D####DD#####D###::##       '
 21       '    #!:::::::::::::::::::::::#       '
 22       '    #::::::::ww::::::::::::::#       '
 23       '    #::::::::::::::::::::::::#       '
 24       '    ##D###D####DD#####D###D###       '
 25       '    #,,,#,,,#........#:::#:::#       '
 26       '    #,,,#,,,#........#:o:#:s:#       '
 27       '    #B,,#B,,#.v.v.v..#:o:#:::#       '
 28       '    ######################%%%#       '
```

### 2.2 Neue Legende-Zeichen (in `SHIP_LEGEND`, Kinds englisch)

| Zeichen | kind | solid | Bedeutung |
|---|---|---|---|
| `^` | `lift` | nein | Liftplattform (2×2), `interact: 'lift'` |
| `!` | `ladder` | nein | Notleiter, `interact: 'ladder'` |
| `:` | `floor_mosaic` | nein | Mosaikboden (Privatdeck) |
| `w` | `light_shaft` | ja | Lichtschacht mit Glasboden, Geländer |
| `%` | `window` | ja | Panoramafenster (Außenwand) |
| `t` | `trophy_niche` | ja | Trophäennische (Funde) |
| `a` | `shrine` | ja | Hausschrein (Lararium) |
| `v` | `med_bed` | ja | Krankenliege (Kulisse) |
| `o` | `bath` | ja | Becken (Kulisse) |
| `s` | `bench` | ja | Aussichtsbank (Kulisse) |
| `j` | `sideboard` | ja | Anrichte/Kombüse in der Messe |

Unverändert gelten `L` Regal, `B` Bett, `S` Hafenterminal, `m` Tisch, `Y` Planungstisch, `y` Schalter, `u` Rohre, `f` Fass,
`q` freies Terminal und alle Stationen aus CONTRACT-M3 §2.

### 2.3 Konstanten (Atlas-Koordinaten, Deck II = y + 16)

- `DECK_STRIDE = 16`, `SHIP_DECKS = [{ id: 'system', name: 'Systemdeck', level: 0, y0: 0, y1: 12 }, { id: 'private', name: 'Privatdeck', level: 1, y0: 16, y1: 28 }]`
- Neue Hilfen:
  - `deckOf(ty)` → 0 oder 1 (−1 in der Lücke)
  - `deckOfPx(py)`
  - `deckLocalY(ty)`
  - `SHIP_LIFTS = [{ id: 'lift', tiles: [[26,2],[27,2],[26,3],[27,3]], other: dy ±16 }]`
  - `SHIP_LADDERS = [{ x: 5, y: 5 }, { x: 5, y: 21 }]`
- `SHELVES`/`SHELF_TILES`: wie bisher x 5–9, y 1, Zugang y 2 (unverändert).
- `REACTOR_SWITCHES`: A (11,1), B (15,11).
- `BEDS` (Raum 3×3, Slots = Bodenkacheln):
  - Farbe 0: Bett (5,17), Raum 5–7 × 17–19, Slots (6,17) (7,17) (7,19) (5,19)
  - Farbe 1: Bett (9,17), Raum 9–11 × 17–19, Slots (10,17) (11,17) (11,19) (9,19)
  - Farbe 2: Bett (5,27), Raum 5–7 × 25–27, Slots (6,27) (7,27) (7,25) (5,25)
  - Farbe 3 (Gast): Bett (9,27), Raum 9–11 × 25–27, Slots (10,27) (11,27) (11,25) (9,25)
- `SHIP_SPAWNS` (18,6) (20,6) (22,6) · `BOT_SPAWNS` (13,6) (7,6) (20,7)
- `IVO_SPOTS` (10,26) (15,18) (9,22) (20,22) (14,25) (26,26) (24,23) (10,26). Ivo bleibt auf Deck II.
- `SHIP_DRILL`: fire (7,6), breach (5,3).
- `SHIP_ROOMS` bekommt das Feld `deck`. Reihenfolge = Prüfreihenfolge:
  - Deck I:
    - antrieb (engine, Sektor 2) 1,1–3,11
    - maschinenraum (engine, −1) 11,1–15,11
    - bruecke (Sektor 0) 25,1–36,11
    - lager (3) 5,1–9,3
    - transfer (1) 5,9–9,11
    - vorraum „Vorraum“ (−1) 5,5–9,7
    - batterie_bb (3) 17,1–24,3
    - batterie_stb (1) 17,9–24,11
    - gang (−1) 16,4–24,8
  - Deck II (alle Sektor −1, also kein Feuer und kein Leck):
    - q0 „Quartier 1“ 5,17–7,19
    - q1 „Quartier 2“ 9,17–11,19
    - q2 „Quartier 3“ 5,25–7,27
    - q3 „Gästequartier“ 9,25–11,27
    - messe „Messe“ 13,17–20,19
    - lararium „Trophäennische“ 22,17–24,19
    - liftvorraum „Liftvorraum“ 26,17–28,20
    - krankenstation „Krankenstation“ 13,25–20,27
    - bad „Bad“ 22,25–24,27
    - aussicht „Aussicht“ 26,25–28,27
    - atrium „Atrium“ 5,20–28,24

**2D-Fallback:** `art.js` zeichnet die neuen Kinds schlicht (Lift = Gitterplattform mit Pfeilen, Leiter = Sprossen,
Mosaik = karierter heller Boden, übrige als einfache Möbel). Damit bleibt `?render=2d` spielbar. Der Mini-Plan und der
Schadensplan zeigen den Atlas, beide Decks übereinander. Mehr UI-Arbeit gibt es nicht.

### 2.4 Lift und Leiter (Server)

- **`CONFIG.lift`** = `{ rideTime: 1.5, rideTimeLowPower: 3.0, ladderTime: 2.0, arrivalClearRadius: 1 }`. Notstrom = Reaktor offline.
- **Lift:**
  - Wer auf einer `^`-Kachel steht und **E tippt**, bekommt `p.lift = { to: <deck>, t: 0, T: rideTime }`.
  - Eingaben gesperrt, kein Schaden.
  - Danach Teleport auf **dieselbe lokale Kachel** des anderen Decks. Ist sie belegt, die nächste freie Nachbarkachel.
  - Ereignis `{ type: 'lift', pid, deck }`.
- **Leiter:** **E halten** 2,0 s (Fortschrittsbalken wie bei anderen Halten-Aktionen), dann Teleport `!` ↔ `!`.
  Im Snapshot `p.ladder = { t, T }`.
- **Snapshot:** neu sind nur optionale Felder.
  - `players[i].lift`, `players[i].ladder`, `bots[i].lift`
  - `players[i].deck` (0 oder 1, abgeleitet; der Komfort für den Client)
  - Protokoll `VERSION` +1
- **Bots:**
  - `server/util.js` `bfs(…, links)` mit Lift- und Leiter-Kanten.
  - Bots fahren Lift (gleiche Zeit) und benutzen nie die Leiter.
  - Im Gefecht haben Bots auf Deck II nichts zu tun. Ivo bleibt auf Deck II.
- **Schaden:** Kacheln auf Deck II und `^`/`!` sind nie Feuer- oder Leck-Kandidaten.
- **Gefechtsalarm:** Spieler auf Deck II bekommen bei Gefechtsbeginn eine ODA-Zeile „Alle auf Station – Lift im Liftvorraum.“ über das vorhandene Meldungssystem.
- **Regel „erster Feindkontakt ≥ 8 s nach Alarm“:** nur, wenn das ohne großen Umbau geht. Sonst im Bericht als offen melden.
- **Raumnamen:** `roomAt` liefert für Deck-II-Räume die neuen Namen. Das HUD zeigt Raumnamen wie bisher (dort erscheinen z. B. „Atrium“, „Messe“).

### 2.5 Prüfung (`npm run check` erweitert)

- Alle Zeilen 37 lang, Spaltzeilen leer.
- `^` und `!` haben auf beiden Decks ein Gegenstück.
- BFS mit Lift- und Leiter-Kanten von jedem Spawn zu jeder Station, Konsole, jedem Regalzugang, Bett, Schalter, Deko-Slot und Ivo-Spot.
- Kein System auf Deck II. Jeder Raum hat ein `deck` und überspannt die Lücke nicht.

**Messwerte der Studioleitung** (BFS, 3 Kacheln/s), vom Captain-Platz:

| Ziel | Weg |
|---|---|
| Lanze | 2,0 s |
| Batterie Bb | 4,7 s |
| Düse Stb | 5,7 s |
| Reaktor | 6,7 s |
| Triebwerk | 9,7 s |
| Regal 1 | 10,0 s |
| Heck-Emitter | 11,0 s |
| Quartier 1 | 10,7 s + Lift |

## 3. Voxel im Client (CORE, ACTORS, AWAY)

### 3.1 Einbindung

- **`public/index.html`:**
  - Unter dem HUD-Canvas `#game` liegt ein `<canvas id="world3d">` in derselben CSS-Box.
  - Importmap: `{"three": "/vendor/three/three.module.js", "three/addons/": "/vendor/three/addons/", "voxelwerk/": "/voxel/"}`.
  - Danach `<script type="module" src="js/voxel/boot.js">`. Alle anderen Skripte bleiben klassisch und unverändert in der Reihenfolge.
- **Moduswahl:**
  - Schalter: `?render=voxel|2d`, Taste **F8** (Wahl in `localStorage`, gekapselt in try/catch).
  - **Standard bis zur Abnahme: `2d`.** Nach der Abnahme stellt die Studioleitung auf `voxel` um.
- **Wann 3D gezeichnet wird:**
  - Nur in den Zonen `ship`, `platform`, `wreck`, `kesh`.
  - In allen anderen Ansichten bleibt `world3d` leer bzw. verborgen, und alles läuft exakt wie heute: Raumkampf, Konsolen-Vollbild, Lobby, Sternkarte.
- **`window.VoxelRender`** (von `boot.js` gesetzt):
  ```js
  {
    ready, mode, setMode(m),
    frame(view, dt),          // zeichnet 3D für die aktuelle Zone/Deck
    worldToScreen(px, py),    // Spiel-Pixel → HUD-Koordinaten (640×360)
    screenToWorld(sx, sy),    // Strahl auf die Bodenebene des sichtbaren Decks
    handles(zone),            // true, wenn 3D diese Zone zeichnet
    errors                    // Zähler
  }
  ```
- **`client.js`:**
  - Wenn `VoxelRender.ready && mode === 'voxel' && handles(zone)`, wird `VoxelRender.frame(view, dt)` aufgerufen.
  - `R.drawWorld` läuft dann im Overlay-Modus: keine Kacheln, keine Figuren, keine Effekte. Gezeichnet werden nur punktförmige Overlays über `VoxelRender.worldToScreen`: Zustandsmarken, Fortschrittsbalken, Namen, Interaktionshinweise, Deckungs-Pips, „zuletzt gesehen“-Marken, Captain-Marker.
  - Der HUD-Canvas wird im 3D-Modus transparent geleert.
  - Während `p.lift` läuft keine Bewegungsvorhersage (Wunsch von DECKS).
- **Robustheit:**
  - Jeder 3D-Frame läuft in try/catch, Fehler werden **gezählt und geloggt** (`Net.reportError`, wenn vorhanden).
  - Bei 3 Fehlern in Folge, `webglcontextlost` oder fehlendem WebGL schaltet das Spiel automatisch auf 2D und zeigt einmal einen Hinweis.
  - Fehlendes Asset → Platzhalterbox in der Farbe der Kachelart (`?debug=1`: Magenta), gezählt.
  - FPS-Wächter: Ist der Median 10 s lang unter 25 fps, gilt `quality = 'low'` (keine Schatten, kein Bloom, `pixelRatio` 0,75).

### 3.2 Module und Schnittstelle

| Datei | Team | Aufgabe |
|---|---|---|
| `voxel/boot.js` | CORE | Einstieg, lädt three + Loader, setzt `window.VoxelRender`, F8 |
| `voxel/renderer.js` | CORE | WebGLRenderer, Szene, Kamera, Mood/Licht, Layer-Verwaltung, Projektion, FPS-Wächter |
| `voxel/loader.js` | CORE | `Library` aus `/voxel/core/library.js`, `io` per `fetch('/voxel/…')`, Objekt- und Figuren-Cache, Platzhalter |
| `voxel/ship.js` | CORE | Layer `ship`: Böden, Wände (Autotile), Türen, Objekte, Stationszustände, Licht/Alarm, Deckschnitt, Liftfahrt |
| `voxel/actors.js` | ACTORS | Layer `actors` (alle Zonen): Spieler, Bots, Ivo, NSC, Plünderer, Drohnen, Wächter, getragene Gegenstände |
| `voxel/fx.js` | ACTORS | Layer `fx` (alle Zonen) + `export function spawnFx(type, opts)` |
| `voxel/away.js` | AWAY | Layer `platform`, `wreck`, `kesh`: Gelände, Bausätze, Objekte mit Zuständen, Deckung, Nebel des Krieges |

Schnittstelle in `renderer.js` (exakt so):
```js
export function registerLayer(layer)
// layer = { id, zones: ['ship'|'platform'|'wreck'|'kesh'|'*'], build(ctx) → void|Promise, update(view, dt, ctx), dispose?(ctx) }
// ctx = {
//   THREE, root /* THREE.Group des Layers */, loader, zone, deck /* 0|1, nur ship */, map /* Shared_Maps-Karte der Zone */,
//   tile(tx, ty) → THREE.Vector3   // Kachelmitte, Boden y = 0 (Deck II wird ebenfalls bei y = 0 gezeigt)
//   toWorld(px, py) → THREE.Vector3 // Spiel-Pixel → Welt (1 Kachel = 32 px = 1 m; z = lokale Deckzeile)
//   quality: 'high'|'low', camera, setMood(id), countError(where, err)
// }
```

`loader.js` exportiert:
- `ready` (Promise)
- `object(id, params?, opts?) → THREE.Object3D`: Klon aus dem Cache. Unbekannt → Platzhalter.
- `figure(id, opts?) → { root, joints, pose(name, t) }`: Basis ist `figureObject`/`applyPose` aus `voxel-three.js`.
- `manifest(id) → Eintrag | null`
- `stats()`

Builds werden je `(id, params)` gecacht. Der Cache ist begrenzt (LRU, 256 Einträge).

**Koordinaten:**
- Welt x = px/32, z = (py − y0_deck·32)/32, y = 0 Boden.
- Bug zeigt nach +x, Backbord nach −z. Modelle sind mit Vorderseite +z gebaut.
- Gezeigt wird nur das Deck der eigenen Figur. Beide Deck-Gruppen bestehen, sichtbar ist eine.

**Kamera:**
- Perspektive, FOV 30°, Neigung 55–60°, keine Drehung, zwei Zoomstufen (Mausrad/`+`/`-`), folgt der eigenen Figur weich.
- Kesh mit FOV etwas weiter, gleiche Neigung.

**Liftfahrt:** Die Kamera fährt 0,6 s senkrecht mit Lichtband-Blende. Der Wechsel der sichtbaren Gruppe fällt in die Blende.

**Wände:**
**Wände:** Wandkacheln, die nördlich (−z) an keine begehbare Kachel grenzen, bleiben voll (`cut: 0`, 3 m). Das ist die obere Außenhülle. Alle anderen werden geschnitten (`cut: 1`, 1,25 m). CORE darf das nach Screenshots verfeinern und meldet es.

### 3.3 Kachel → Asset (Schiff, CORE)

Objekte stehen **mittig auf ihrer Kachel** und schauen mit +z zur ersten begehbaren Nachbarkachel (Reihenfolge der Suche: +z, −z, −x, +x).
2×2-Objekte (`Y`, `m`, `^`) werden einmal in die Blockmitte gesetzt.

| Zeichen/kind | Asset-ID | Parameter aus dem Spielzustand |
|---|---|---|
| `#` wall | `lerche/kit/wall` | `conn` (Bitmaske Nachbarwände N1 O2 S4 W8), `cut`, `style` (0 Systemdeck, 1 Privatdeck, 2 Brücke, 3/4 = Quartierwände, siehe unten) |
| `%` window | `lerche/kit/window` | – |
| Böden (unter jeder Nicht-Wand-Kachel) | `lerche/kit/floor` | `kind`: `.`→0 Bronze-Kassette · `=`/`_`→1 Gitter · `,`→2 Holz · `:`→3 Mosaik · `.` in Raum `bruecke`→4 Marmor · `.` in `krankenstation`→5 Klinik; `wear` 0–2 (Brandfleck nach Feuer) |
| `D` door | `lerche/kit/door` | `open` 0/1, `style` 0 System (Rundbogen) / 1 Privat (Doppeltür); quer → `rot` 90 |
| Leck (Hüllenbruch) | `lerche/kit/breach` | `patched` 0/1 |
| Wandleuchten (CORE verteilt alle ~4 m an Wänden) | `lerche/kit/light` | `mode` 0 normal / 1 Alarm / 2 Notstrom, `style` 0 Bronze / 1 warm |
| Plakette an Stationen | `lerche/kit/plaque` | `side` 0 Bug, 1 Stb, 2 Heck, 3 Bb, 4 Mitte |
| `w` light_shaft | `lerche/kit/light_shaft` | `glow` 0–2 (folgt Reaktor) |
| `P` pad | `lerche/kit/pad` | `phase` 0 ruhig / 1 lädt / 2 beamt / 3 kühlt |
| `R` | `lerche/station/reactor` | `state`, `power` 0 online / 1 überladen / 2 offline / 3 Notstart |
| `y` | `lerche/station/reactor_switch` | `pos` 0 ruht / 1 gehalten / 2 umgelegt |
| `G` | `lerche/station/shield_gen` | `state` |
| `O` | `lerche/station/life_support` | `state` |
| `E` | `lerche/station/engine` | `state`, `throttle` 0–4 |
| `F`/`Z` | `lerche/station/thruster` | `state`, `side` 0 Bb / 1 Stb |
| `K` | `lerche/station/lance` | `state`, `charge` 0–3 |
| `M`/`J` | `lerche/station/battery` | `state`, `side`, `tubes` 0–4 |
| `A`/`I`/`U`/`V` | `lerche/station/emitter` | `state`, `side` 0 Bug / 1 Stb / 2 Heck / 3 Bb, `strength` 0–4 |
| `X` | `lerche/station/transfer` | `state` |
| `T` | `lerche/console/transfer` | `occupied` 0/1, `alert` 0/1 |
| `H` | `lerche/console/helm` | `occupied`, `alert` |
| `W` | `lerche/console/tactical` | `occupied`, `alert` |
| `C` | `lerche/console/captain` | `occupied` |
| `Y` (2×2) | `lerche/console/plan_table` | `active` 0/1 |
| `q` | `lerche/console/spare` | – |
| `S` | `lerche/console/shop` | `docked` 0/1 |
| `L` | `lerche/furn/shelf` | `item` 0–4 (Reihenfolge SHELF_TILES), `fill` 0–3 |
| `u` | `lerche/furn/pipes` | – |
| `k` | `lerche/furn/workbench` | – |
| `n` | `lerche/furn/control_desk` | – |
| `f` | `lerche/furn/barrel` | – |
| `c`/`x` | `lerche/furn/crate` | `seed` |
| `B` | `lerche/furn/bed` | `color` 0–3 |
| `m` (2×2) | `lerche/furn/mess_table` | – |
| `j` | `lerche/furn/sideboard` | – |
| `t` | `lerche/furn/trophy_niche` | `filled` 0/1 |
| `a` | `lerche/furn/shrine` | – |
| `v` | `lerche/furn/med_bed` | – |
| `o` | `lerche/furn/bath` | – |
| `s` | `lerche/furn/bench` | – |
| `^` (2×2) | `lerche/lift/shaft` + `lerche/lift/platform` | Schacht: `deck` 0/1, `power` 0/1. Plattform: `moving` 0/1 |
| `!` | `lerche/lift/ladder` | – |
| Bodenkleinkram (CORE streut stabil per Hash, nur Deck I, nicht auf Laufwegen vor Stationen) | `lerche/furn/floor_decal` | `kind` 0–8, `seed` |

- **Quartiere:** Die Quartier-Optionen aus `CONFIG.quarters` werden abgebildet.
  - Boden: `lerche/deco/quarter_floor` mit `style` 0–4 = holz_hell, holz_dunkel, teppich_rot, teppich_blau, fliesen.
  - Wände des Quartiers: `lerche/kit/wall` mit `style` 3 = holz/paneel, 4 = tapete_gruen/tapete_creme, plus Parameter `variant` 0/1.
  - Licht: Punktlicht `warm`, `mint`, `bernstein`, `aus`.
- **Deko-Slots:** `lerche/deco/<id>` mit genau den IDs aus `CONFIG.deko`: `pflanze`, `poster`, `lampe`, `teppich`, `buecherregal`, `aquarium`, `sessel`, `sternkarte`, `trophaee_boje`, `kristalllampe`, `lamassu_figur`. Das sind Fachbegriffe aus dem Spiel, die IDs bleiben deshalb so.

**Zustands-Konvention für alle Stationen:** Parameter `state` 0 ok · 1 beschädigt · 2 zerstört · 3 geflickt · 4 Eskalation
(„brennt gleich“) · 5 EMP. Ableitung aus dem Snapshot so wie heute in der 2D-Zustandsmarke.

**Lesbarkeit in jedem Zustand mit drei Merkmalen:**

| Zustand | Statuskrone (Lichtring) | Form | Bewegung (in `fx`/`ship`) |
|---|---|---|---|
| ok | Farbe der Seite | – | Gerät animiert |
| beschädigt | gelb | Paneel offen | Funken |
| zerstört | rot | Teile fehlen | Rauch, kein Licht |
| geflickt | orange | Band quer | – |
| Eskalation | – | – | Boden glimmt |
| EMP | eisblau | Bögen | – |

### 3.4 Figuren (ACTORS mit ART-F/ART-G)

- **An Bord:** `lerche/crew_0..2` (Bordkleidung, Gesicht). Die Rolle `cloth2` wird per `colors` auf die Spielerfarbe gesetzt: #56B4E9 · #E69F00 · #CC79A7.
- **Außenmission:** `crew/nova`, `crew/juno`, `crew/tami` (vorhanden, mit Helm), mit derselben Farblogik.
- **Weitere Figuren und Modelle:**
  - Ivo: Figur `lerche/ivo`
  - Plünderer: Figur `lerche/scavenger` mit `role` 0 Schütze / 1 Flanker / 2 Funker
  - Bots: Modell `lerche/actor/bot` mit `mode` 0 bereit / 1 fährt / 2 repariert / 3 löscht / 4 trägt / 5 Rückschlag, ACTORS animiert Wippen und Drehen
  - Drohne: Modell `lerche/actor/drone` mit `wreck` 0/1
  - Wächter: Modell `lerche/actor/warden` mit `state` 0 aktiv / 1 Treffer / 2 zerstört, `front` 0/1
- **Posen** in `assets/poses/human.json` (ART-F), Namen exakt:
  - **Vorhanden:** `stand`, `walk`, `aim`, `talk`, `point`, `kneel`, `inspect`, `attention`, `guard`, `arms_crossed`
  - **Neu (Bord):** `sit`, `operate`, `repair`, `extinguish`, `carry`, `hold` (E halten), `minigame`, `climb`, `lift_ride`
  - **Neu (Außenteam):** `crouch`, `wounded` (liegt), `revive`, `hit`
  - Der Laufzyklus ist `walk` mit `t` (Phase). ACTORS dreht die Figur in Laufrichtung, 8 Richtungen weich.
- **Gegenstände in der Hand** (Anker `handR`), Modelle `lerche/item/<id>`:
  - `spare_part`, `extinguisher`, `patch_plate`, `bolts`, `medipack`, `datacore`, `wrench`, `tablet` (Tafel von Kesh), `salvage`
  - Waffen: `blaster` (Crew-Pistole, ART-G), `scav_rifle` (ART-G)
- ACTORS leitet Pose und Gegenstand aus dem Snapshot ab. Grundlage ist dieselbe Logik, die heute `render.js`/`art.js` für die 2D-Figur nutzt.

### 3.5 Effekte (ACTORS, `fx.js`)

**Zeichnung:** Effekte entstehen prozedural aus kleinen Würfelpartikeln (InstancedMesh, gepoolt, ≤ 2.000 Partikel) und Lichtern (≤ 4 dynamische).

**Pflicht-Effekte:**
- Feuer (3 Größen)
- Rauch, Funken, Leck/Ausgasung (Sog-Partikel zum Leck)
- Löschgel-Strahl, Löschschaum
- Reparaturfunken, Rückschlag-Splitter
- Beamen: Zerfall in Würfel und Aufbau, Dauer streckbar
- Personenschild (3 Segmente, Treffer, Bruch)
- Blasterschuss, Treffer auf Deckung (Splitter)
- Befehlssäulen des Captains (6 Arten, Farbe nach Befehl)
- Schildkuppel, Orbitalschlag, Sensorimpuls
- Heilen/Wiederbeleben, Drohnen-Explosion
- Wächter: Frontschild-Bogen mit Abprall, EMP-Welle
- Alarmlicht und Notstrom (gemeinsam mit `ship.js`: Licht-`mode`)

Die Trigger kommen aus dem Snapshot bzw. den Ereignissen, wie im 2D-Renderer.

### 3.6 Außenmissionen (AWAY mit ART-H)

**Plattform B-7 und Wrack:** Bausätze wie im Schiff (`away/platform/{floor,wall}`, `away/wreck/{floor,grate,wall}` mit `conn`/`cut`; Wrackwand `bent` 0/1). `~` ist das All: Sternenhimmel unterhalb und um die Plattform (`platform_space`-Stimmung), beim Wrack Dunkelheit (`wreck_dark`).

| Plattform | Asset | Parameter |
|---|---|---|
| `L` | `away/platform/door_locked` | `open` |
| `b` (2×2) | `away/platform/buoy_core` | `state` 0 aktiv / 1 offen / 2 leer |
| `Z` | `away/platform/sonde` | `color` 0–5, `on` |
| `x` | `lerche/furn/crate` | – |
| `P` | `lerche/kit/pad` | – |

| Wrack | Asset | Parameter |
|---|---|---|
| `V` | `away/wreck/wall_weak` | `state` 0 / 1 markiert / 2 offen |
| `h` | `away/wreck/salvage` | `open` |
| `g` | `away/wreck/lore_terminal` | `read` |
| `x` | `away/wreck/debris` | `seed` |

**Kesh:**
- Gelände mit 1 Voxel/m (Terrain von voxelwerk, Palette `mond_kesh`, Stimmung `kesh_dusk`):
  - `R` = Fels, 2–4 m hoch (Höhe per Hash variieren, Kanten zum Spielfeld mindestens 2 m)
  - `.` = Sand
  - `,` = Ruinenboden `away/kesh/floor_ruin` (Stufe 4)
- Objekte:

| Kesh | Asset | Parameter |
|---|---|---|
| `#` | `away/kesh/wall_ruin` | `conn`, `cut`, `decay` 0/1 |
| `o` | `away/kesh/cover_low` (halbe Deckung, **helle Oberkante**, ≤ 0,9 m) | `damaged` 0/1 |
| `I` | `away/kesh/pillar` (volle Deckung, ≥ 2,2 m) | – |
| `r` | `away/kesh/jammer` | `on` |
| `k` | `away/kesh/archive_key` | `pos` 0–2 |
| `G` (2 breit) | `away/kesh/vault_gate` | `open` 0–2 |
| `T` | `away/kesh/tablet_pedestal` | `present` |
| Streuung | `away/kesh/rubble` | `seed` |

- **Nebel des Krieges:** Nicht gesehene Bereiche werden in 3D abgedunkelt (Boden und Objekte, ca. 35 % Helligkeit). „Zuletzt gesehen“ bleibt als 2D-Overlay.
- **Deckung muss in beiden Zoomstufen eindeutig sein:** Halbe Deckung ist niedrig mit heller Oberkante, volle Deckung ist hoch mit dunkler Krone und Schatten. Deckung hat nie die Bodenfarbe.

## 4. Asset-Pipeline (PIPELINE)

**Entscheidung: Meshing zur Laufzeit statt Vorbacken.** Das weicht vom Vorschlag des Tech Leads ab.
- Für M4 gibt es nur Innenräume und kleine Szenen. Kiste 1 ms, Regal 7 ms, Figur 10–13 ms (gemessen).
- So sehen Art-Änderungen sofort im Spiel aus, und es braucht kein Binärformat.
- Große Schiffe (Stufe 3) bekommen später einen Bake-Schritt.

- **`npm run assets`** (`tools/sync-assets.mjs`):
  - Kopiert `voxelwerk/core/*.js` → `public/voxel/core/`, `voxelwerk/render/voxel-three.js` → `public/voxel/render/`.
  - Kopiert alle Paletten, Rigs, Posen, Moods sowie alle Modelle/Figuren, die ein Manifest nennt, samt Abhängigkeiten → `public/voxel/assets/…`.
  - Führt die Manifeste `assets/manifest/*.json` zu `public/voxel/manifest.json` zusammen.
  - Schreibt `public/voxel/VERSION.json` = `{ voxelwerkCommit, dirty, date }`.
  - Quelle: Umgebungsvariable `VOXELWERK_PATH`, Standard `../voxelwerk`.
  - Die Ausgabe wird später eingecheckt, damit `npm start` ohne Voxelwerk läuft.
- **`npm run assets:watch`:** dasselbe bei Dateiänderung (für Art-Teams und die QA).
- **`npm run check:assets`** (`tools/check-assets.mjs`):
  - Baut jedes Manifest-Asset in jedem Zustand in Node mit der voxelwerk-`Library`.
  - Prüft Pflichtfelder (§5), Dreiecks-Budgets (Warnung > 100 %, Fehler > 150 %) und ob `footprint`/`height` passen.
  - Prüft, ob jede ID aus §3.3, §3.4 und §3.6 im Manifest steht. Fehlende werden gelistet, sind aber noch kein Fehler.
- **`vendor`:** `voxelwerk/vendor/three.module.js`, `three.core.js`, `addons/**` und `three-LICENSE.txt` → `public/vendor/three/`, Revision in `VERSION`.
- **`server/index.js`:**
  - Statische Auslieferung von `/vendor/` und `/voxel/` mit richtigen MIME-Typen (`.js` als `text/javascript`, `.json`).
  - gzip für `.js` und `.json` (zlib, im Speicher gecacht).
  - Cache-Header kurz (`no-cache`) während der Entwicklung.
- **`public/voxel-gallery.html`:**
  - Zeigt jedes Manifest-Asset in allen Zuständen nebeneinander, mit **Spielkamera** (FOV 30°, Neigung 57°) und Stimmung `ship_interior`.
  - Filter `?team=art-b`, `?id=…`.
  - Damit prüfen Art-Teams und QA die Lesbarkeit von oben.

## 5. Manifest-Format (alle ART-Teams)

`sternenschicht/assets/manifest/<team>.json`:
```json
{
  "team": "art-b",
  "assets": [
    {
      "id": "lerche/station/reactor",
      "kind": "model",
      "tier": "detail",
      "palette": "lerche_rom",
      "footprint": [1, 1],
      "height": 1.9,
      "facing": "+z",
      "params": { "state": [0, 5], "power": [0, 3] },
      "states": { "ok": { "state": 0 }, "damaged": { "state": 1 }, "destroyed": { "state": 2 },
                  "patched": { "state": 3 }, "escalating": { "state": 4 }, "emp": { "state": 5 } },
      "sockets": { "use": [0, 0, 0.55], "fx_smoke": [0, 1.7, 0], "fx_spark": [0.3, 1.1, 0.4], "light": [0, 1.2, 0], "label": [0, 2.1, 0] },
      "tint": [],
      "budgetTris": 6000,
      "tags": ["lerche", "station", "system"]
    }
  ]
}
```

- **`kind`:** `model` oder `figure`.
- **`params`:** jeder Parameter, den das Spiel setzt, mit Bereich [min, max].
- **`sockets`:** in **Metern**, relativ zum Pivot (Mitte unten), Vorderseite +z.
- **Pflicht-Sockets:**
  - Station/Konsole: `use`, `fx_smoke`, `fx_spark`, `label`
  - Lichtquelle: `light`
  - Tür: keine
  - Figur: wie Rig (`handR`, `handL`, `back`)
  - Ortsobjekt: wenn sinnvoll `cover`, `terminal`
- **Footprint:**
  - Ein Asset darf seine Kacheln nicht überragen: Grundfläche ≤ `footprint`, Ausnahme Wandleuchten und Fenster.
  - Höhe ≤ 2,2 m, ausgenommen Wände (3 m), Lift-Schacht und Felsen.
  - **Kollision kommt nie aus dem Modell**, sondern aus `maps.js`.
- **Budgets** (Dreiecke je Zustand):

| Asset-Art | Budget |
|---|---|
| Bodenkachel | 150 |
| Wandkachel | 600 |
| Architekturmodul ≤ 4 m | 3.000 |
| Detail-Prop | 2.500 |
| Station/Konsole | 6.000 |
| Figur | 6.000 (≤ 16 Teile) |
| Kesh-Geländeblock 16×16 m | 8.000 |

- **IDs:** englisch. Deutsch bleiben nur Fachbegriffe und die Deko-IDs aus `CONFIG.deko`. Vorhandene voxelwerk-IDs (z. B. `rom/kiste`) werden nicht umbenannt; sie dürfen per `use` eingebunden werden.

## 6. Regeln für alle ART-Teams

1. **Vorher lesen:** `voxelwerk/AUTHORING.md` (Format), `sternenschicht/concept/ASSET-LISTE-VOXEL.md` (Stilsäulen, Palette, deine Zeilen) und diesen Vertrag §3, §5 und §6.
2. **Palette `lerche_rom`** für alles auf der Lerche. Außenmissionen bekommen eigene Paletten (ART-H), Plünderer `rostmeute`.
   **Mint #7FE0C2, Gelb #F2C94C, Orange #F08A3C, AUS-Rot #E0473C und Eisblau #A9D6E5 sind Zustandsfarben** und kommen in der Ausstattung nicht vor.
3. **Stufen:**
   - Wände, Böden, Türen, Lift-Schacht, Fenster: `architecture` (4 Voxel/m), Kachel 1 m = 4 Voxel.
   - Alles andere: `detail` (16 Voxel/m), Kachel = 16 Voxel.
4. **Stil Sci-Fi-Rom** (AUTHORING.md §Stilregeln + Stilsäulen):
   - Bronze trägt, Marmor schmückt, Rot markiert.
   - Rundbögen, Pilaster, Mäander, Lorbeer, Adler.
   - Eigene Zeichen, kein SPQR, keine fremden Logos.
   - Klein, freundlich, wohnlich auf dem Privatdeck. Kühl-technisch, aber edel auf dem Systemdeck.
5. **Lesbar von oben:**
   - Prüfe jedes Asset im Screenshot mit `&elev=57&az=0` (Spielwinkel) und aus der Nähe.
   - Jede Station hat eine **eigene Grundform** (Tholos, Säulenkranz, Spule, Trichter, Rohrbündel …).
6. **Zustände** gemäß §3.3 an drei Merkmalen erkennbar (Krone/Licht, Form, Bewegungsanker). Teile für die Bewegung (Funken, Rauch) baut ACTORS – du lieferst die Sockets.
7. **Jedes Asset gilt erst als fertig, wenn:**
   - `npm run check -- lerche/<dein Ordner>` (Voxelwerk) grün ist,
   - ein Screenshot in `voxelwerk/shots/<team>/` liegt,
   - der Manifest-Eintrag steht,
   - die Budgets eingehalten sind.
8. **Parallelität:** Lege Assets **in Prio-Reihenfolge** an (P1 zuerst) und trage jedes fertige Asset sofort ins Manifest ein. So können CORE, ACTORS und AWAY früh echte Assets sehen.
9. **Fremde Dateien:** Nichts in fremden Ordnern ändern. Wiederverwendung per `use` auf vorhandene Rezepte ist erlaubt und erwünscht (`rom/*`, `fig/basis/*`, `natur/*`).

## 7. Performance (CORE misst)

- **Referenzgerät:** dieser Entwicklungslaptop.
- **Messung:** echte GPU über Playwright **headed**, Chromium mit `--enable-gpu --use-angle=d3d11 --ignore-gpu-blocklist`. Vorher prüfen, dass nicht SwiftShader läuft (`WEBGL_debug_renderer_info`).
- **Ziel:** ≥ 30 fps im Normalmodus und ≥ 45 fps im Sparmodus, je auf diesem Laptop. Szene: Schiff, 3 Spieler, 3 Bots, 2 Feuer, 1 Leck. Kesh mit 2 Trupps.
- **Budgets je Frame:** ≤ 150 Draw Calls (InstancedMesh für gleiche Assets, Böden und Wände pro Deck zu wenigen Meshes zusammenfassen), ≤ 400k sichtbare Dreiecke, ≤ 4 dynamische Punktlichter, eine Schattenquelle.

## 8. Abnahme

**Stufe 1 (DECKS):**
- `npm run check` mit BFS über beide Decks grün.
- Lift 1,5 s ± 0,1 (Notstrom 3 s), Leiter 2 s, 3 Spieler gleichzeitig im Lift.
- Bots reparieren auf Deck I und holen Teile aus den Regalen. Ivo bleibt auf Deck II.
- Auf Deck II entstehen keine Feuer und keine Lecks (Test).
- Alle Tests grün: `npm test`, `node tools/test-m3.js`, `node tools/test-flight.js`, `npm run sim`, `node tools/ws-smoke.js`, `node --check` aller JS.
- `?render=2d` zeigt die neuen Kacheln.
- Bericht mit gemessenen Laufzeiten: QA-Skript, nicht nur BFS.

**Stufe 2 (CORE, ACTORS, ART-A…F):**
- `?render=voxel` zeigt beide Decks mit echten Assets.
  - Es gibt keine Platzhalter mehr für die P1-IDs aus §3.3/§3.4.
- Alle sechs Stationszustände sind in der Standard-Zoomstufe auf Screenshots unterscheidbar.
- Liftfahrt mit Kamerafahrt funktioniert.
- Figuren laufen, reparieren, löschen, tragen, bedienen.
- HUD und Konsolen sind unverändert.
- Leistung nach §7 erreicht, **gemessen**.
- 10 Minuten Spiel zu dritt (QA-Skript) mit Fehlerzähler 0.
- Ohne WebGL läuft das Spiel in 2D mit einem gezählten Fehler.

**Stufe 4 (AWAY, ACTORS, ART-G, ART-H):**
- Plattform, Wrack und Kesh erscheinen in Voxel.
- Halbe und volle Deckung sind in beiden Zoomstufen unterscheidbar (Screenshots), Nebel des Krieges ist lesbar.
- m1-Außenmission (Plattform), Wrack und m3 sind im QA-Skript mit `?render=voxel` durchspielbar.
- Leistung nach §7.

## 9. Ablauf

1. Alle 13 Teams starten **parallel**.
   - CORE, ACTORS und AWAY arbeiten zuerst gegen Platzhalter und die IDs aus diesem Vertrag.
   - PIPELINE liefert `npm run assets` und die Galerie so früh wie möglich und meldet das sofort der Studioleitung, die es weitergibt.
2. Abweichungen vom Vertrag meldet jedes Team in seinem Bericht (Abschnitt „Abweichungen“). Die Studioleitung gibt sie weiter.
3. Nach der Produktion folgt **QA und Integration** durch ein eigenes Team mit Schreibrecht auf alle Dateien:
   - ehrliches Durchspielen
   - Screenshots
   - FPS-Messung
   - README-Abschnitt „Voxel“
4. Danach Abnahme durch die Studioleitung und Bericht an Kai.
