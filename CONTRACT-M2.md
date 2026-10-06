# CONTRACT-M2 – „Schildwall“: Kampfsystem für Außenmissionen

Ergänzung zu `CONTRACT.md`, `CONTRACT-M0.md` und `CONTRACT-M1.md` (diese gelten weiter). Vorhandene Feldnamen und
Nachrichten werden **nicht gebrochen**, nur ergänzt. Bei Widerspruch zwischen Vertrag und Code gilt der Code. Weicht ein
Team vom Vertrag ab, meldet es das im Abschlussbericht. Die Studioleitung gibt es an die anderen Teams weiter.

Pitch: https://claude.ai/artifact/N6eeuuSA2SMbtgNdgJRR4A · Konzept: Brain-Vault `Coop-Spiel/Mechanik/Außenmission-Kampf.md`

## 0. Ziel, Rahmen, Abnahme

**Ziel.** Bis **2026-10-06, 18:00** spielen drei Menschen eine neue Planetenmission **„Die Tafel von Kesh“** (Mission
`m3`). Ein Captain bleibt an Bord, zwei gehen ins Außenteam (auch 3 unten ist erlaubt). Sie kämpfen sich in **Echtzeit**
durch Deckung und Korridore. Grundlage ist das neue Kampfsystem **v2**:
- Personenschild in Segmenten statt Lebenspunkten
- Treffer ohne Schild → verwundet
- Deckung je nach Richtung
- Gegner-Trupps mit Rollen und Funksprüchen
- Fog of War
- Captain als Kommandant
- Notrückholung statt Game Over

**Entscheidungen von Kai (2026-10-05):**
- Grafik und Kamera bleiben wie heute (2D, Top-down).
- Echtzeit.
- Volle Dreierbesetzung, die Solo-Lösung ist zurückgestellt.
- Keine Voxelansicht in diesem Meilenstein.

**Leitplanken:**
- Keine Schleppaufgaben: Die Tafel wandert direkt ins Inventar.
- Die Zwei-Personen-Aufgabe (Archivschlüssel) liegt in einem ruhigen Moment.
- Kampf höchstens etwa die Hälfte der Mission.
- Bots bleiben bei Reparatur und Unterstützung.

**Nicht brechen:**
- M1 (Boje, Plattform) und M2 (Wrack, Nebel, Relais) spielen sich exakt wie bisher.
- Kampf v2 gilt **nur** auf Karten mit `combat: 'v2'` (zunächst nur `kesh`).
- `npm run sim`, `node tools/test-features.js`, `node tools/ws-smoke.js` und `npm run check` bleiben grün.

**Inhalte pro Minute (Ziel, nicht gemessen):** etwa alle 1,5–2,5 min etwas Neues. Die Mission soll zu dritt **10–14 min**
dauern. Die QA misst das.

## 1. Dateibesitz

| Team | Dateien (nur diese ändern) |
|---|---|
| Studioleitung (fertig) | `CONTRACT-M2.md`, `shared/maps.js` (Abschnitt Kesh), `shared/los.js` |
| SERVER | `server/**` (neu: `server/sim/combat.js`, `server/sim/squad.js`, `server/missions/m3.js`), `shared/{config,protocol,schema,locations}.js`, `tools/**` |
| CLIENT | `public/index.html` (`<script src="/shared/los.js">` nach `physics.js` einbinden), `public/js/{net,client,render,hud,consoles,dev-mock}.js` |
| ART | `public/js/art.js`, `public/art-preview.html` |
| AUDIO | `public/js/audio.js`, `public/audio-preview.html` |
| QA (danach) | alle Dateien |

Testserver immer auf **freiem Port** mit `ROOM_CODE=off` starten (z. B. SERVER 3311, CLIENT 3312, QA 3313).
Screenshots gehören nach `shots/<team>/`, Playwright-Skripte nach `C:\tmp\pwtest\sts\`.

## 2. Karte `kesh` (Mond Kesh, Kustoden-Archiv)

Steht in `shared/maps.js` (`KESH_ROWS`, `KESH_LEGEND`, `KESH_PADS`, `Maps.kesh`), 48 × 26 Kacheln. Die Karte ist per
BFS geprüft:
- Alle Spawns, beide Relais und beide Schlüssel sind von den Pads erreichbar.
- Die Tafel ist nur bei offenem Tor erreichbar, das Tor ist also Pflicht.
- **Kein** Gegner-Spawn hat Sichtlinie auf ein Pad.
- 128 Deckungsplätze.

### 2.1 Ablauf auf der Karte
Landezone (Sand, unten links) → Südtor → **Hof der Ruine** (Trupp 1, `a` ×4) → zwei Wege nach Osten, die sich zum
Flankieren eignen:
- **Nordkorridor** (2 breit, Störrelais `r` bei 31,2)
- **Südkorridor** (4 breit, mit Deckung, Störrelais `r` bei 32,13)

Beide führen in die **Archivhalle**:
- Wächter `L` schläft in der Mitte, umgeben von 4 Pfeilern.
- Zwei **Archivschlüssel** `k` bei (38,1) und (45,15), weit auseinander.
- **Tor** `G` (41–42,15) zum **Gewölbe** mit der **Tafel** `T` (41,19).

Die Spawns `b` (Trupp 2: Nord- und Südkorridor-Ende) und `c` (Nachhut im Hof) sind beim Start **leer** und werden erst
durch Missionsereignisse besetzt (§3).

### 2.2 Legende (neu, nur `KESH_LEGEND`)
| Zeichen | kind | solid | Sicht | cover | Interaktion |
|---|---|---|---|---|---|
| `R` | `rock` | ja | blockiert | 2 | – |
| `#` | `wall_ruin` | ja | blockiert | 2 | – |
| `.` | `floor_sand` | – | frei | – | – |
| `,` | `floor_ruin` | – | frei | – | – |
| `o` | `cover_low` | ja (`low: true`) | **frei** | **1 (halb)** | – |
| `I` | `pillar` | ja | blockiert | 2 (voll) | – |
| `r` | `jammer` | ja | blockiert | 2 | `jammer`: E halten → aus |
| `k` | `archive_key` | ja (`low`) | frei | 1 | `archkey` |
| `G` | `vault_gate` | ja, bis `away.vault.open` | blockiert, bis offen | 2 | – (öffnet per Schlüssel) |
| `T` | `tablet_pedestal` | ja (`low`) | frei | 1 | `tablet` |
| `L` `a` `b` `c` | `floor_ruin` | – | frei | – | Spawns: `warden`, `squad1`, `squad2`, `rearguard` |
| `P` | `pad` | – | frei | – | Pads (Selbst-Transfer wie gehabt) |

**Sichtregel** (`shared/los.js`): Eine Kachel blockiert die Sicht, wenn sie (im aktuellen Zustand) solid **und nicht**
`low` ist. Den aktuellen Zustand liefert der Aufrufer per `isSolid(tx,ty)`, z. B. Tor offen oder zu.

### 2.3 `shared/los.js` (UMD `Shared_Los`, fertig)
- `sightFn(map, isSolid?) -> blocked(tx,ty)`
- `walk(x0,y0,x1,y1, visit(tx,ty)->bool)`: exakte Rasterdurchquerung
- `lineOfSight(blocked, x0,y0,x1,y1) -> bool`: Die Zielkachel zählt nicht.
- `coverAgainst(map, isSolid, sx,sy, x,y) -> 0|1|2`: Deckung des Ziels bei (x,y) gegen einen Schützen bei (sx,sy). Es
  zählen nur Deckungskacheln in der 8er-Nachbarschaft der Zielkachel, die auf der Schusslinie liegen. Liegt die Deckung
  in der Flanke, nicht auf der Linie, ergibt das 0.
- `visibleTiles(blocked, x,y, radiusTiles, w,h) -> Set("tx,ty")`

## 3. Ort, Mission `m3`, Start

### 3.1 Ort (SERVER, `shared/locations.js`)
```js
{ id: 'kesh', name: 'Mond Kesh', kind: 'moon', x: 160, y: 120, links: ['hafen', 'splitter'], fog: false,
  desc: 'Ein staubiger Mond mit einer Kustoden-Ruine. Plünderer graben dort seit Wochen.',
  first: 'Mond Kesh. Unten liegt ein Kustoden-Archiv – und ein Plünderercamp. Transferpads: Landezone im Südwesten.',
  scene: { w: 2400, h: 1800, arrive: { x: 300, y: 900, angle: 0 }, station: { kind: 'moon', x: 1500, y: 900, r: 180 },
    beam: { map: 'kesh', range: 360 }, asteroids: 0 },
  hidden: [] }
```
- `kesh` ist am Start unbekannt. `reveal: 'kesh'` geschieht über die Mission.
- `W.AWAY_MAPS.kesh = { id: 'kesh', map: Maps.kesh, pads: KESH_PADS, combat: 'v2', ... }` und `game.aways.kesh`.
- `HIDDEN_KINDS` bleibt unverändert. Die Raumszene braucht ein Stations-Objekt `kind: 'moon'` (ART, Fallback: großer Kreis).

### 3.2 Mission `m3` „Die Tafel von Kesh“ (SERVER, `server/missions/m3.js`, Format wie m1/m2)
Auftraggeberin ist Hafenmeisterin Tesk. Funksprüche, ODA-Texte und Ziele formuliert SERVER selbst, im Ton von M1/M2:
deutsch, warm, kurz.

| Schritt | Inhalt | weiter, wenn |
|---|---|---|
| `briefing` | Funk Tesk: Plünderer graben auf Kesh in einem Kustoden-Archiv; eine Vertragstafel darf nicht verkauft werden. Annehmen → `reveal kesh`. | angenommen |
| `flight` | Ziel: nach Kesh springen, in Transferreichweite gehen. ODA erklärt kurz Schild und Deckung. | Außenteam unten (`beamedDown` auf `kesh`) |
| `courtyard` | Trupp 1 (4 Plünderer) im Hof. Optional: beide Störrelais aus (Captain-Scan wird scharf). | alle 4 aus Trupp 1 ausgeschaltet **oder** ein Spieler in der Halle (x ≥ 37) |
| `archive` | Ruhe. Ziel: beide Archivschlüssel **gleichzeitig** halten (§4.7) → Tor auf. | `vaultOpened` |
| `tablet` | Ziel: Tafel bergen (E halten 3 s, dann ins Inventar `tafel`). | `tabletTaken` |
| `warden` | **Wächter erwacht** + **Trupp 2** (3 Plünderer, Spawns `b`) kommt durch beide Korridore (Zange). Optional: Wächter ausschalten (+Belohnung). | ein Spieler mit Tafel-Inventar betritt den Hof (x ≤ 27) **oder** 90 s vergangen |
| `extract` | **Nachhut** (3 Plünderer, Spawns `c`) im Hof. Ziel: zurück zu den Pads und hochbeamen. | alle Außenteam-Spieler an Bord und `inventory.tafel ≥ 1` → Mission erledigt |

- **Belohnungen** (CONFIG): Abschluss 120 Marken, Wächter ausgeschaltet +60 Marken plus Deko `lamassu_figur`
  (falls Deko-Katalog vorhanden, sonst nur Marken), je Relais +10.
- `onComplete: [{ end: true }]` mit eigenem Ende-Text.
- **Notrückholung aller (§4.6) setzt den Schritt nicht zurück.** Gegner bleiben, wie sie sind; ausgeschaltete bleiben aus.
- **Kampagne:** Nach `m2` bietet Tesk `m3` an (Timer wie bei m2, `MISSION_ORDER = ['m1','m2','m3']`).

### 3.3 Direktstart für den Spieleabend (SERVER + CLIENT)
- Lobby-Option **`startMission`**: `'m1'` (Standard, Kampagne) oder `'m3'` („Direkt zur Planetenmission“).
  Nachricht `lobbyOpt { startMission: 'm3' }`, jeder darf umschalten, wie `skipDrill`. Der Snapshot in der Lobby zeigt
  `lobby.startMission`.
- Bei `m3`:
  - Hafen-Übung entfällt, m1/m2 gelten als erledigt.
  - Das Schiff liegt im Hafen, nicht angedockt.
  - `kesh` ist bekannt, der Auftrag steht als Funk zum Annehmen bereit.
- Debug: `mission m3 [step]` (vorhandener Befehl) muss für m3 funktionieren. Dazu `debugPrep`-Einträge wie bei m2.

## 4. Kampfregeln v2 (SERVER; Werte in `CONFIG.awayCombat`, alle per `tune` live änderbar)

```js
awayCombat: {
  shield: { segments: 3, regenDelay: 4, regenStep: 1.2 },          // Spieler
  wounded: { bleedout: 45, reviveTime: 4, reviveSegments: 1, medkitReviveTime: 1.5, medkitSegments: 2,
             pistolCooldown: 0.7, squadRecallDelay: 5, recallBeamLock: 20 },
  blaster: { cooldown: 0.3, speed: 380, ttl: 1.1 },                 // 1 Treffer = 1 Segment
  halfCoverBlock: 0.6,                                              // Chance, dass halbe Deckung einen Schuss schluckt
  enemy: {
    scavenger: { segments: 2, regenDelay: 4, regenStep: 1.5, speed: 70, aim: 0.8, fireInterval: 1.6, shotSpeed: 230, spreadDeg: 4 },
    warden:    { segments: 6, regenDelay: 6, regenStep: 2, speed: 32, turnRate: 70, frontArc: 120, aim: 1.4, fireInterval: 2.6,
                 shotSpeed: 260, shotSegments: 2 },
  },
  engageBox: { w: 600, h: 330 },     // Gegner schießen nur, wenn das Ziel in diesem Rechteck um den Gegner liegt (≈ Bildschirm)
  sightTiles: 10,                     // Sichtradius des Außenteams (Fog of War) und der Gegner
  aiHz: 5, barkCooldown: 4, ghostTime: 3,
  scanQualityJammed: 0.35,            // Captain-Scan, solange ein Störrelais an ist
  jammerTime: 2.5, archkeyTime: 3, archkeyWindow: 1.5, tabletTime: 3,
  squadScale: { 1: 0.5, 2: 0.75, 3: 1 },   // Anteil der Spawns je Anzahl verbundener Spieler (aufgerundet, min. 1)
  orders: { max: 3, ttl: 30, focusTime: 8 },
  rewards: { complete: 120, warden: 60, jammer: 10 },
}
```

### 4.1 Schild (Spieler auf `combat: 'v2'`-Karten)
- `p.shield = { seg, max, lastHitAt, regenT }`. Beim Herunterbeamen wird `seg = max`.
- **Treffer:**
  - Bei `seg > 0`: `seg--`, Event `shieldHit`. Bei 0 zusätzlich `shieldBreak`.
  - Bei `seg == 0`: **verwundet** (`downPlayer`, Event `wounded`).
- `damagePlayer(game, p, dmg, source)` bekommt auf v2-Karten diese Bedeutung: Jeder Treffer zählt **ein** Segment, beim
  Wächter `shotSegments`. Die Schildkuppel des Captains fängt **ganze Treffer** ab; jeder abgefangene Treffer kostet
  10 `kuppelHp`.
- **Laden:** Nach `regenDelay` s ohne Treffer kommt alle `regenStep` s ein Segment dazu (Event `shieldUp`). Ist es voll,
  folgt `shieldFull`.
- `p.hp` bleibt im Snapshot erhalten (Rückwärtskompatibilität), wird auf v2-Karten aber nicht benutzt. Das HUD zeigt dort
  Segmente statt HP.

### 4.2 Verwundet
- Der Spieler liegt (`downed: true`) und kann sich nicht bewegen und nicht interagieren.
- Er **kann** zielen und mit der **Pistole** schießen: `pistolCooldown`, Projektil `kind: 'pistol'`, 1 Segment Schaden.
- Er kann weiter **Q markieren**.
- Ein automatisches Aufstehen nach 15 s gibt es auf v2-Karten **nicht**. Nach `bleedout` s folgt die Einzel-Notrückholung
  an Bord (Pad), mit vollem Schild. Die Rückholung landet im Logbuch.
- **Wiederbeleben:** E halten neben dem Verwundeten, `reviveTime` s. Der Verwundete steht mit `reviveSegments` auf.
- **Medipack:**
  - Beim Herunterbeamen nimmt jedes Außenteam-Mitglied 1 Medipack aus `inventory.medipack` mit, solange vorhanden
    (`p.medkit = 1`).
  - Wer einen Medipack trägt, belebt in `medkitReviveTime` s mit `medkitSegments` wieder; das verbraucht den Medipack.
  - Liegen gelassene Medipacks (Nachschub vom Transfer) hebt man durch Darüberlaufen auf (max. 1 tragen).

### 4.3 Schießen, Projektile, Deckung
- Projektile wie bisher (`updateAwayProjectiles`), neue Arten: `blaster`, `pistol`, `enemy`, `warden`.
- **Wände** (Sicht blockierend) stoppen jedes Projektil.
- **Halbe Deckung** (`low`, `cover: 1`):
  - Fliegt ein Projektil in eine solche Kachel, die **an die Kachel des Ziels grenzt** (8er-Nachbarschaft des nächsten
    möglichen Ziels in Flugrichtung), schluckt sie es mit `halfCoverBlock`. Event `coverHit` (Splitter).
  - Steht die Kachel **innerhalb 1 Kachel um den Schützen**, wird sie ignoriert; man schießt aus der Deckung heraus.
  - Sonst fliegt das Projektil darüber hinweg.
  - Umsetzung frei, z. B. pro Projektil `coverChecked` merken.
- **Flanke** entsteht ohne eigene Regel aus der Geometrie.
- **Zielen der Gegner (Ankündigung):**
  - Vor jedem Schuss setzt der Gegner `aim = { target: pid, t0, dur }`. Erst nach `aim` s fällt der Schuss, in Richtung
    der dann aktuellen Zielposition, mit `spreadDeg` Streuung.
  - Verliert der Gegner in dieser Zeit die Sichtlinie, bricht er ab (kein Schuss).
  - Events: `enemyAim` beim Start und `sfx enemy_aim`.
- **Kein Treffer aus dem Off:** Gegner beginnen das Zielen nur, wenn das Ziel in `engageBox` um den Gegner liegt **und**
  Sichtlinie besteht.

### 4.4 Wächter (`kind: 'warden'`, „Lamassu“)
- Schläft (`asleep: true`, unverwundbar, schießt nicht) bis zum Schritt `warden`. Erwacht mit Event `wardenWake`.
- Hat eine **Blickrichtung** `facing` (rad) und dreht sich mit `turnRate` °/s zum nächsten sichtbaren Spieler.
- **Treffer im Frontbogen** (`frontArc`, Richtung Schütze relativ zu `facing`) werden absorbiert: Event
  `wardenDeflect`, kein Schaden. Von der Seite und von hinten kostet jeder Treffer 1 Segment.
- **Schuss:** Projektil `kind: 'warden'` (dick, langsam), Treffer kostet `shotSegments`.
- Wird der Wächter ausgeschaltet: Event `wardenDown`, Missionsereignis `wardenKilled`.

### 4.5 Gegner-Schild
Plünderer und Wächter haben `seg/max` wie Spieler und laden nach `regenDelay` nach. Bei `seg == 0` schaltet der nächste
Treffer sie aus (`alive = false`, Missionsereignis `droneKilled { kind }` wie bisher, zusätzlich `enemyDown`).

### 4.6 Notrückholung aller
- Liegen **alle** Außenteam-Spieler (verbunden, `zone 'away'`) verwundet, startet nach `squadRecallDelay` s automatisch die
  Notrückholung aller.
- Ablauf: Event `squadRecall`, alle auf die Schiffspads, vollen Schild, ODA-Kommentar. Danach ist der Transfer für
  `recallBeamLock` s gesperrt (`canBeam`-Grund: „Transfer kühlt nach der Notrückholung ab“).
- Kein Game Over. Mission und Gegnerzustand bleiben.
- Das vorhandene `transfer.recall` (einzeln) funktioniert weiter und holt einen Verwundeten ebenfalls mit vollem Schild
  hoch.

### 4.7 Interaktionen
- `jammer` (Störrelais): E halten `jammerTime` s. Ergebnis: `away.jammers[i].off = true`, Event `jammerOff`.
- `archkey`:
  - E halten `archkeyTime` s.
  - Das Tor öffnet erst, wenn **beide** Schlüssel innerhalb von `archkeyWindow` s fertig gehalten wurden. Sonst
    ODA-Hinweis („Beide Schlüssel gleichzeitig – einer allein reicht dem Archiv nicht“) und Rücksetzen.
  - Event `vaultOpen`, Missionsereignis `vaultOpened`.
- `tablet`: E halten `tabletTime` s → `inventory.tafel += 1`, Missionsereignis `tabletTaken`. **Kein Tragen**, die Tafel
  geht direkt ins Inventar (`ITEMS` um `'tafel'` ergänzen; kein Regal).
- `revive` wie bisher, mit Zeiten aus §4.2.

## 5. Gegner-KI (SERVER, `server/sim/squad.js`)

Utility-KI, Entscheidung mit `aiHz`, Bewegung jeden Tick. Gegner haben dieselben Sicht- und Deckungsregeln wie die
Spieler.

- **Wahrnehmung:**
  - Ein Gegner bemerkt einen Spieler, wenn dieser in `sightTiles` liegt **und** Sichtlinie besteht, oder wenn der
    Gegner getroffen wird.
  - Bemerkt ein Truppmitglied etwas, wissen es alle (`squad.alert`, `lastKnown {x,y,t}` je Spieler).
- **Deckungsplätze:** Einmal pro Karte vorberechnet, das sind begehbare Kacheln mit Nachbar-`cover`.
- **Rollen** (`e.role`):
  - `pin`: Deckungsplatz mit Sicht auf ein Ziel halten und mit Ankündigung feuern.
  - `flank`: per BFS zu einem Deckungsplatz, von dem aus `coverAgainst(...)` für das Ziel 0 ergibt. Höchstens **1**
    Flankierer je Trupp. Wer nach 8 s nicht angekommen ist, wechselt zu `pin`.
  - `retreat`: bei `seg ≤ 1`. Zu einem Deckungsplatz ohne Sicht auf bekannte Spieler, bleiben, bis `seg == max`, dann
    `pin`. **Daraus entsteht Unterdrückung.**
  - `push`: wenn ein Spieler verwundet ist oder `seg == 0` hat und Sicht besteht → näher ran, bevorzugt auf dieses Ziel.
  - `advance`: kein Ziel sichtbar, aber `lastKnown` → in Richtung `lastKnown` über Deckungsplätze.
  - `idle`: unbemerkt, leichtes Patrouillieren um den Spawn (vorhandene Logik).
- **Hängenbleiben:** Bewegt sich ein Gegner 4 s lang nicht, obwohl er sollte, bekommt er einen neuen Plan. Im Sim gilt:
  kein Gegner länger als 8 s eingeklemmt.
- **Funksprüche** (`bark`):
  - Event `{ kind: 'bark', from: 'Plünderer', id, text, x, y }`, je Trupp höchstens alle `barkCooldown` s, gesendet
    **vor** der Aktion.
  - Mindestens diese Anlässe:
    - Kontakt („Kontakt! Da drüben!“)
    - Flankieren („Halt sie unten – ich geh links rum!“ bzw. „rechts“, aus der Lage abgeleitet)
    - Rückzug („Mein Schild ist weg, ich zieh mich zurück!“)
    - Schild wieder voll („Schild steht wieder!“)
    - Spieler verwundet („Einer liegt! Drauf!“)
    - Ziel verloren („Wo sind die hin?“)
    - Trupp halbiert („Rückzug zur zweiten Linie!“)
  - Mehrere Varianten je Anlass in `CONFIG.awayCombat.barks`.
- Der Wächter funkt nicht. Er kündigt sich nur durch `wardenWake` und Zielen an.

## 6. Captain als Kommandant, Fog of War

- **Fog of War (Sichtbarkeit):**
  - Der Server setzt pro Gegner `vis = true`, wenn **ein** Außenteam-Spieler ihn im `sightTiles`-Radius mit Sichtlinie
    sieht.
  - Ist er nicht sichtbar, aber vor weniger als `ghostTime` s gesehen worden, schickt der Server `ghost: { x, y, t }`
    (letzte bekannte Position).
  - Im Koop gibt es kein Anti-Cheat-Problem, deshalb wird **nicht** pro Empfänger gefiltert. Der Client des Außenteams
    zeichnet nur `vis`-Gegner und Geister, die Konsolen an Bord zeigen alle.
- **Scan-Qualität:**
  - `away.scanQuality` = 1, wenn alle Störrelais aus sind, sonst `scanQualityJammed`.
  - Bei Qualität < 1 zeigt die Captain-Karte die Gegner **verrauscht**: Position mit Jitter, keine Schildwerte, Blips
    flackern.
  - `sensorUntil` (Sensorimpuls) setzt für seine Dauer `vis = true` für alle (wie bisher „revealed“).
- **Befehle** (neu, Captain-Konsole, Reiter „Außenteam“): `cmd captain.order { kind, x, y, target? }`.
  - `kind` ∈ `sammeln | halten | flanke | rueckzug | fokus | gefahr`, zusätzlich `clear: true` zum Löschen.
  - Höchstens `orders.max`, gleiche Art ersetzt die alte, Ablauf nach `orders.ttl` s.
  - `fokus` mit `target: enemyId` macht diesen Gegner für `focusTime` s für das Außenteam sichtbar (`vis`, auch durch
    Wände, mit Umriss).
  - Event `order` (für Ton und Funkzeile).
- Orbit-Hilfen (Sensor, Kuppel, Nachschub, Orbitalschlag, Notrückholung) bleiben, wie sie sind. Sie funktionieren auch auf
  `kesh`.

## 7. Protokoll und Snapshot (Ergänzungen)

**Client → Server:**
- `lobbyOpt { startMission: 'm1'|'m3' }`
- `cmd { cmd: 'captain.order', kind, x, y, target?, clear? }`
- `SHOOT` funktioniert für Verwundete auf v2-Karten (Pistole).

**Snapshot-Erweiterungen:**
- `players[]`:
  - `sh: [seg, max] | null`: `null` außerhalb von v2-Karten
  - `shR: 0..1`: Fortschritt zum nächsten Segment, 0 während der Verzögerung
  - `cv: 0|1|2`: Deckung gegen den gefährlichsten sichtbaren Gegner
  - `fl: bool`: Ein bemerkender Gegner mit Sichtlinie trifft ohne Deckung, das ist die offene Flanke.
  - `medkit: 0|1`, `bleed: Sekunden bis Rückholung | null`
- `away`:
  - `combat: 'v2' | null`, `scanQuality`
  - `vault: { open }`
  - `jammers: [{ x, y, off }]`, `keys: [{ x, y, t }]`: `t` ist der Haltefortschritt 0..1
  - `tablet: { x, y, taken }`
  - `orders: [{ id, kind, x, y, target, until }]`
- `away.drones[]` (bestehende Felder bleiben):
  - `kind: 'scavenger'|'warden'`, `sh: [seg,max]`, `role`, `vis`
  - `ghost: {x,y,t} | null`
  - `aim: { target, p: 0..1 } | null`
  - `facing` (nur Wächter), `asleep`
- `lobby.startMission`
- `inventory.tafel`

**Events** (`t: 'event'`, alle mit Position, wo sinnvoll):
- Schild und Verwundung: `shieldHit {pid,seg}`, `shieldBreak {pid}`, `shieldUp {pid,seg}`, `shieldFull {pid}`,
  `wounded {pid}`, `revived {pid}`, `squadRecall {pids}`
- Gegner: `enemyAim {id,target}`, `enemyDown {id,kind}`, `enemyShieldHit {id,seg}`, `bark {...}`
- Wächter: `wardenWake`, `wardenDeflect {id}`, `wardenDown`
- Deckung und Interaktion: `coverHit {x,y}`, `jammerOff {i}`, `vaultOpen`, `tabletTaken`
- Captain: `order {kind}`

**`sfx`-Namen** (AUDIO liefert sie, SERVER sendet sie mit `zone/x/y` wie gehabt):
`shield_hit`, `shield_break`, `shield_up`, `shield_full`, `wounded`, `revive_done`, `pistol`, `enemy_aim`, `enemy_shot`,
`warden_wake`, `warden_aim`, `warden_shot`, `warden_deflect`, `cover_hit`, `jammer_off`, `archkey`, `vault_open`,
`tablet`, `bark` (Piepsprache, Plünderer-Timbre), `order`, `squad_recall`.

## 8. Debug und Tuning (SERVER + CLIENT-Debugkonsole)

**`tune <pfad> <wert>`** setzt einen Wert unter `CONFIG.awayCombat` live.
- Whitelist: alle Zahlen aus §4, Pfad mit Punkten, z. B. `tune shield.regenDelay 3`, `tune enemy.scavenger.aim 1.0`.
- Zusätzlich `tune barks off|on`, damit sich der F.E.A.R.-Effekt im A/B-Vergleich prüfen lässt.
- `tune` ohne Argumente listet die aktuellen Werte.

**Weitere Befehle:**
- `kesh` = `mission m3 courtyard` und alle verbundenen Spieler auf die Kesh-Pads (Captain bleibt an Bord, wenn er an der
  Captain-Konsole sitzt).
- `squad <1|2|rear>` spawnt den Trupp sofort.
- `wake` weckt den Wächter.
- `shield <n>` für sich selbst, `wound` für sich selbst.
- `god` wie bisher.

`?debug=1` zeigt über jedem Gegner Rolle, Segmente und Zielfortschritt. `DEBUG_CMDS` wird ergänzt.

## 9. CLIENT

**HUD:**
- Eigene **Schildsegmente**: 3 Würfel/Kästchen in Schild-Cyan `#7FF3FF`, leer nur als Umriss, Ladefortschritt füllt sich
  von unten. Dazu die Schilde der Mitspieler im Teamstreifen.
- **Deckungsanzeige**: „DECKUNG: HALB / VOLL / KEINE“ und rot „FLANKE OFFEN“, wenn `fl`.
- Verwundet: Bleed-Countdown und „E halten: wiederbeleben“ bei Kameraden.
- Medipack-Symbol.
- **Funkzeile** für `bark` (Untertitel 3 s, Absender „PLÜNDERER“ in Rost).

**Welt (render.js):**
- Bodenring mit Segmenten unter jeder Figur auf v2-Karten. Leer: grau gestrichelt, Umriss pulsiert weiß-rot.
- Verwundete Figur liegt, mit rotem schrumpfendem Ring und Medi-Kreuz. Das Kreuz ist für das Team auch im Nebel sichtbar.
- **Ziellinie** jedes zielenden Gegners: dünn → dick, rot `#E0473C`, plus Mündungsglühen.
- **Fog of War:** Kacheln außerhalb der gemeinsamen Teamsicht (`Shared_Los.visibleTiles` je Außenteam-Spieler, vereinigt;
  höchstens 5× pro Sekunde neu rechnen) werden abgedunkelt und entsättigt. Nicht sichtbare Gegner werden nicht gezeichnet,
  Geister als blasse Gitter-Silhouette mit Alter.
- **Deckung lesbar:** Steht der eigene Spieler neben `cover_low`/`pillar`, wird die Deckungskachel hervorgehoben: hohler
  Pip = halb, voller Pip = voll.
- **Captain-Befehle** in der Welt des Außenteams als senkrechte Lichtsäulen mit Beschriftung.
- Wächter mit sichtbarer Front: Schildbogen vorn.
- Pistole: Verwundete können per Maus zielen und schießen.

**Konsolen:**
- Captain, Reiter **Außenteam**:
  - Kartenansicht `kesh` mit allen Gegnern, verrauscht bei `scanQuality < 1`; Schildwerte nur bei Qualität 1.
  - **Befehle per Klick** (Auswahlleiste für die 6 Arten, Klick auf Karte bzw. Gegner).
  - Liste der Außenteam-Schilde.
- Transfer und Taktik wie gehabt. Der Orbitalschlag nutzt weiter die Q-Markierung.

**Lobby:** Umschalter „Start: Kampagne / Direkt zur Planetenmission“ (wie „Übung überspringen“).

**Mock:** `?mock=1&loc=kesh&console=…` muss die Karte und Beispielzustände zeigen: Schilde, ein zielender Gegner, ein
Verwundeter, ein Geist, Befehle.

Alle Aufrufe in `art.js`/`audio.js` laufen in try/catch über die vorhandenen Helfer. **Fallbacks** sind Pflicht.

## 10. ART (`art.js`)

**Kacheln** (`drawTile` mit den Zeichen aus §2.2 auf der Karte `kesh`):
- Mond-Sand, Ruinenboden
- Fels und Ruinenmauer mit sichtbarer Höhe (Mauer > niedrige Deckung)
- niedrige Mauerreste (`cover_low`, klar **niedriger** als Wand/Pfeiler, mit heller Oberkante)
- Pfeiler
- Störrelais (an/aus)
- Archivschlüssel (Leuchtfortschritt)
- Tor (zu/offen)
- Tafelsockel (mit/ohne Tafel)

Kustoden-Ornamentik, der Akzent darf Violett `#B57CFF` sein (Vorläufer).

**Figuren:**
- `drawDrone` mit `kind: 'scavenger'` (vorhanden): Varianten für Rolle (Ziel-Pose), verwundbar/Schild.
- **`kind: 'warden'`**: Lamassu-artiger geflügelter Stier-Wächter, etwa 2×2 Kacheln groß, mit Frontschild-Bogen. Dazu
  `facing`, `asleep` (dunkel) und `wake` (Augen glühen).

**Spieler** (`drawCharacter`, opts erweitert um `downed`, `shieldSeg`, `shieldMax`, `shieldHitT`):
- liegende Pose
- Schildblase beim Treffer: kurzes Hex-Flackern in `#7FF3FF`

**FX** (`drawFx`): `shield_hit`, `shield_break` (Würfelsplitter), `cover_hit` (Steinsplitter), `muzzle_aim` (anschwellendes
Glühen), `warden_deflect`, `revive`, `order_pillar`.

**Projektile:** `pistol`, `enemy`, `warden` (dick, violett-weiß).

**Raumszene und Sternkarte:** Station `moon` (großer Mond mit Ruinenschimmer) und Kartenicon `loc_moon`.

**Items:** `tafel` (Keilschrift-Tafel, Gold auf Lehm). Ebenfalls `art-preview.html` erweitern.

## 11. AUDIO (`audio.js`)

Alle `sfx`-Namen aus §7.
- `shield_hit` steigt in der Tonhöhe je verlorenem Segment (Parameter `seg` mitgeben, sonst mittlere Höhe).
- `shield_break` ist Glasbruch mit Sub-Drop.
- `shield_up` ist ein kurzer Ding pro Segment, `shield_full` ein sauberer Akkord.
- `enemy_aim` ist ein räumlicher Lade-Whine, **der wichtigste Warnton**.
- `bark` ist Piepsprache mit verzerrtem Plünderer-Timbre und variierender Silbenzahl je nach Textlänge.
- `warden_*` tief und schwer.
- Optional eine neue Kampfstimmung für `kesh` (Mood `ruin`), die bei Kontakt die Intensität erhöht.

Alles ist vor `init()` ein No-op, Pegel wie die vorhandenen. `audio-preview.html` erweitern.

## 12. Tests und Abnahmekriterien

**SERVER:**
- `tools/test-combat.js` (deterministisch, ohne Netz) prüft mindestens:
  - Segmente, Laden, Treffer bei 0 → verwundet
  - halbe Deckung schluckt von vorn (statistisch ≈ `halfCoverBlock`), von der Flanke nie
  - Schütze direkt hinter der eigenen Deckung wird nicht blockiert
  - Pfeiler stoppt
  - Wächter-Front absorbiert, Seite trifft
  - Notrückholung aller
  - Archivschlüssel nur gleichzeitig
  - Tafel ins Inventar
  - `tune` ändert Werte
  - `vis`/`ghost` korrekt
  - Gegner zielt nie ohne Sicht und nie außerhalb der `engageBox`
- `npm run check` prüft zusätzlich `kesh` (BFS wie §2, inkl. Spawn-Sichtlinie auf die Pads).
- `npm run sim` bekommt einen Lauf **m3 zu dritt** mit Kampf-Bots: Captain-Bot an Bord, 2 Außenteam-Bots, die Deckung
  nutzen. Gemessen werden Dauer, Verwundungen, Rückholungen. Invarianten: kein Treffer aus mehr als `engageBox`, kein
  Gegner > 8 s eingeklemmt.

Bestehende Tests bleiben grün.

**CLIENT, ART, AUDIO:** `node --check` aller Dateien. Mock-Screenshots in `shots/<team>/`: Hof mit Kampf, Halle mit
Wächter, Captain-Außenteam-Karte, Verwundeter, Lobby-Umschalter.

**QA (mit allen finalen Dateien):**
- Browser, drei Seiten, ehrlich gespielt mit menschlichen Pausen und ohne God-Mode, m3 per Lobby-Direktstart.
- **Gemessene** Dauer zu dritt.
- Robustheit ohne `art.js` und `audio.js`.
- Prüfen: Softlocks (Tor, Tafel, Rückholung, Reconnect während verwundet), z-Order (liegende Figur, Ringe, Lichtsäulen,
  Nebel), Skalierung.
- Spielt M1 noch an (Regressionstest).
- `README.md` ergänzen: Planetenmission, Steuerung, `tune`-Befehle für den Spieleabend.

**Abnahme** (Studioleitung):
- m3 ist zu dritt durchspielbar.
- Kein Treffer aus dem Off.
- Deckung und Flanke sind ohne Erklärung erkennbar.
- Die Notrückholung funktioniert.
- `tune` wirkt live.
- M1/M2 sind unverändert.

## 14. Nachträge aus der Produktion (gelten vor §1–§12)

**SERVER:**
- **Event-Felder:**
  - Bei `enemyDown` heißt das Feld `enemyKind`, bei `order` heißt es `orderKind`. Grund: `kind` ist der Eventname.
  - Zusätzliche Felder: `cause` am `bark`, `text` am `ending`. Titel bei m3: „Die Tafel ist sicher“.
- **Befehl:** Er läuft wie alle anderen über `{ t:'cmd', c:'captain.order', … }`. Die Form `cmd:` wird auch angenommen.
- **Kesh auf der Sternkarte:** `hafen`/`splitter` → `kesh` steht als gesperrter Link (`LOCKED_LINKS` mit Schlüssel `'kesh'`) und wird erst von der Mission geöffnet. Dadurch bleibt die Sternkarte in M1/M2 unverändert.
- **`fl`** wird nur gesetzt, wenn der Spieler an einer Deckungskachel steht und trotzdem offen getroffen werden kann. Im freien Feld gilt `cv 0`, `fl false`.
- **Projektile in v2** haben ihre `x/y` auf Fußhöhe; der Client zeichnet sie etwa 10 px höher.
- **`ghost.t`** ist die Spielzeit der letzten Sichtung, also kein Alter.
- **Medipacks** gehen beim Hochbeamen zurück ins Lager.
- **Treffer-Regeln:**
  - Der Wächter-Schuss kostet 2 Segmente. Verwundet ist man erst, wenn der Schild **vor** dem Treffer 0 war.
  - Ein Orbitalschlag gegen v2-Gegner zählt `strikeSegments` (4) und ignoriert die Front des Wächters.
- **Kampagne:** m3 folgt auf m2, und erst m3 zeigt den Ende-Bildschirm.
- **Weitere CONFIG-Schlüssel** (alle per `tune` einstellbar): `barksOn`, `shotTtl`, `hitRadius`, `strikeSegments`, `kuppelPerHit`, `flankMaxTime`, `stuckReplan`, `lostAfter`, `lastKnownTtl`, `wardenLeash`, `missionM3`.
- **Tests:** `tools/test-combat.js` (89 Prüfungen). `npm test` führt `test-features` und `test-combat` aus. Bot-Sim m3 zu dritt: 2,2–3,7 min. Das ist ein **Bot-Wert**; wie lange Menschen brauchen, misst die QA.

**QA (2026-10-06):**
- **Balancing** (`CONFIG.awayCombat`, alles weiter per `tune`): `enemy.scavenger.segments` 2 → 3, `enemy.scavenger.fireInterval`
  1.6 → 1.3. Neu: `archkeySoloWindow: 15` (nur ein Spieler verbunden → erster Schlüssel bleibt so lange gedreht).
- **Inhalt:** Neuer Trupp `relief` (2 Plünderer, Spawns `b` Nord und Süd, `W.AWAY_MAPS.kesh.spawns.relief`). Das erste
  abgeschaltete Störrelais schlägt Alarm (Hook `reliefSquad`, `m3.on.jammerOff`), nur solange das Tor zu ist.
- **`tabletInCourtyard`** zählt nur den Spieler, der die Tafel geborgen hat (`away.tablet.by`); ist er nicht mehr unten,
  reicht jeder Kamerad. Vorher übersprang ein im Hof wartender Kamerad den Wächter-Schritt sofort.
- `tools/test-combat.js` liest die Plünderer-Segmente aus der CONFIG.

**Ducken (§15, Umsetzung 2026-10-06):**
- **Taste C** war frei (Außenzone und Konsolen); an Konsolen gehen Tasten ohnehin an die Konsole.
- **`shared/los.js`** ergänzt: `coverAgainst(..., crouched)` (optionaler 7. Parameter), `lowGuard`, `nextToLow`,
  `crouchSight(map, isSolid, blocked, crouchAt[])`, `sightFnFor(map, isSolid, a, b)`. Server: `combat.losBetween(E, a, b)`
  für alle Sichtlinien Spieler ↔ Gegner (vis, Wahrnehmung, Zielen, Zielabbruch, Planung der KI).
- **`cmd { c: 'crouch', on }`** läuft ohne Konsole (vor der Konsolenprüfung). An Bord: Hinweis „Ducken geht nur im
  Außeneinsatz (Kesh).“ Die Tick-Prüfung beendet das Ducken bei Konsole, Verwundung, `beamLock` und Zonenwechsel.
- **Projektile:** Gestoppt wird an einer `low`-Kachel, die (a) an die **Abschusskachel** eines geduckten Schützen grenzt
  oder (b) an ein geducktes Ziel der **Gegenseite in Flugrichtung** grenzt. Schüsse von Kameraden über die Deckung eines
  geduckten Kameraden fliegen weiter. Ausweichen: ein Wurf je Projektil und Ziel; ein verfehlender Schuss fliegt weiter.
  Neue Statistik `stats.dodges`, `stats.crouchBlocks`.
- **`cv`:** Die Gefahrenliste rechnet die Sicht ohne Ducken, die Deckung mit Ducken (vorn → 2, Flanke → 0 + `fl`). Ohne
  Gegner in Sicht gilt `cv 2`, solange man geduckt neben niedriger Deckung steht (HUD „VOLL“).
- **Gegner:** ducken sich nur in `retreat`, stehend (kein Pfad), ohne Zielen, mit `seg < max` und neben `low`. In der
  Rückzugsplanung zählen solche Plätze als verborgen (wenn `enemyCrouch`). `tune crouch.enemyCrouch on|off`
  (`tune` nimmt jetzt auch Wahrheitswerte).
- **Sim-Bots** (`tools/sim-headless.js`) beachten geduckte Gegner (`cr`) bei der Sichtlinie; vorher schossen sie blind auf
  verborgene Gegner (Bot-Lauf m3 7,4 statt 3,1 min).
- **ART/CLIENT:** Duck-Pose in `art.js` (kniend, Oberkörper 8 px tiefer; Plünderer abgesetzt und flach). Der Client prüft per
  Bildvergleich, ob `art.js` die Pose kennt, sonst Stauchung auf 65 %. Stehend neben niedriger Deckung zeigt der hohle Pip
  ein „C“, geduckt wird er voll mit Ring und Häkchen.

## 15. Ducken (Kai, 2026-10-06)

Gilt nur für Spieler und Gegner auf v2-Karten (`kesh`). Neue Werte in `CONFIG.awayCombat.crouch`, alle per `tune`
einstellbar:

```js
crouch: { speedFactor: 0.5, dodge: 0.2, enemyCrouch: true }
```

**Steuerung:**
- **Taste C** schaltet das Ducken an und aus. Das gilt nur in der Außenzone auf v2-Karten und nicht, wenn man verwundet
  ist oder an einer Konsole steht.
- Nachricht `cmd { c: 'crouch', on: bool }`; Wechsel an der Konsole, Verwundung und Beamen beenden das Ducken.
- Interaktionen (E halten) bleiben geduckt möglich.

**Regeln** (Server, autoritativ):
1. Geduckt bewegt man sich mit `speedFactor` × Grundgeschwindigkeit. Die Client-Vorhersage nutzt denselben Faktor.
2. **Kleineres Ziel:** Jeder Treffer auf einen Geduckten verfehlt mit `dodge` (20 %), unabhängig von Deckung und Richtung.
   Diese Prüfung kommt zu allen anderen Deckungsprüfungen hinzu.
3. **Hinter niedriger Deckung voll gedeckt:** Für einen Geduckten wirken `low`-Kacheln in seiner 8er-Nachbarschaft wie
   **volle Deckung**:
   - **Sicht:** Sie blockieren die Sicht in **beide** Richtungen. Gegner sehen ihn nicht und zielen nicht auf ihn. Er sieht
     nicht darüber hinweg; das gilt für seinen Nebel und für `vis`.
   - **Projektile:** Sie stoppen jedes Projektil, das sie auf dem Weg zu ihm durchqueren, zu 100 %.
   - **Eigene Schüsse:** Seine eigenen Schüsse, die durch eine solche Kachel gehen, werden ebenfalls gestoppt (Event
     `coverHit`). Wer schießen will, muss aufstehen.
   - Umsetzung bevorzugt über die vorhandenen Funktionen in `shared/los.js`: eine Sichtsperre `blocked`, die zusätzlich die
     `low`-Kacheln rund um geduckte Endpunkte als Sperre zählt. Die Studioleitung erlaubt dafür eine kleine Ergänzung in
     `shared/los.js` (z. B. `sightFnFor(map, isSolid, a, b)` oder ein Parameter `crouchAt`), solange die bestehenden
     Signaturen erhalten bleiben.
   - `coverAgainst` liefert für einen Geduckten hinter niedriger Deckung **2**.
4. **Laden des Schildes** funktioniert unverändert.
5. **Gegner** (wenn `enemyCrouch`):
   - Plünderer in der Rolle `retreat` ducken sich, sobald sie an einem Deckungsplatz mit niedriger Deckung stehen.
   - Sie stehen auf, wenn ihr Schild voll ist oder sie schießen wollen.
   - Für geduckte Gegner gelten dieselben Regeln 2 und 3.
   - Der Wächter duckt sich nie.

**Snapshot:** `players[].cr: bool`, `away.drones[].cr: bool`. HUD-Deckung `cv` = 2, wenn man geduckt hinter niedriger
Deckung steht.

**Client:**
- Geduckte Figur gestaucht/kniend zeichnen; ART liefert dafür `drawCharacter` opts `crouch: true` und `drawDrone` opts
  `crouch: true`. Fallback: Figur auf 65 % Höhe stauchen.
- HUD-Zeile „GEDUCKT – C: aufstehen“ und Hinweis in der Steuerungszeile („C: ducken“).
- Hinter einer Deckung erhält der volle Pip einen Zusatzhinweis.
- Die Sicht (Nebel) folgt Regel 3.

**Tests** (`tools/test-combat.js`):
- Tempo-Faktor
- dodge statistisch ≈ 20 %
- hinter niedriger Deckung von vorn 100 % gestoppt und keine Sichtlinie; von der Flanke nur dodge
- eigener Schuss über die eigene niedrige Deckung gestoppt
- Gegner verliert `vis` und Ziel
- retreat-Gegner duckt sich
- `tune crouch.dodge` wirkt

Bestehende Tests bleiben grün.

## 13. Nicht in M2

Voxel/three.js, Schulter-/Ego-Kamera, Solo-Drohne, Nabu-Schreiber, Energie-Regler „Außenteam“, Granaten, zerstörbare
Deckung, Speicherstände.
