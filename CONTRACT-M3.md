# CONTRACT-M3 – Etappe M3a „Breitseite & Schaden“

Ergänzung zu `CONTRACT.md` und `CONTRACT-M0.md` bis `CONTRACT-M2.md`. Diese Verträge gelten weiter. Vorhandene Feldnamen
und Nachrichten werden **nicht gebrochen**, nur ergänzt, außer dort, wo dieser Vertrag ausdrücklich einen Altnamen ablöst.
Bei Widerspruch zwischen Vertrag und Code gilt der Code. Weicht ein Team ab, meldet es das im Abschlussbericht.

- Pitch: https://claude.ai/artifact/VZTG4jnCEyUJECtSoNAmvk
- Brain-Vault: `Coop-Spiel/Ausbaustufe Raumkampf.md`, `Briefing Ausbaustufe Raumkampf.md`, `Mechanik/Raumkampf.md`,
  `Mechanik/Schiffssysteme & Reparatur.md`
- Entwurf der Karte mit BFS-Prüfung: `concept/lerche-m3-entwurf.js`

## 0. Ziel, Rahmen, Abnahme

**Ziel.** Raumkampf wird ein Manöver, das man absprechen muss:
- Das Schiff ist träge und feuert über die Seiten.
- Schwere Angriffe kündigen sich an.
- Treffer zerlegen das Schiff Station für Station, sodass jemand die Brücke verlassen muss.

M3a liefert dafür den Unterbau. M3b (Jäger-Anflüge, Zange, Trefferspur, Minispiele je Systemtyp) folgt nach einem
Spieleabend und ist **nicht** Teil dieses Vertrags.

**Entscheidungen von Kai (2026-10-06):**
1. Bug-Waffe: Kurs halten nur in einer **Zielphase von 1,5 s**.
2. Reparatur: **E = Flicken** (schnell, eine Stufe, fragil), **Minispiel = eine Stufe dauerhaft**,
   **Ersatzteil = direkt voll repariert**.
3. **Taktik feuert alle Waffen**, der **Pilot steuert und weicht aus**.
4. Bots löschen Feuer und dichten Lecks selbst ab, Systeme reparieren sie **nur auf Befehl**.
5. **Maschinenraum mittschiffs** mit Reaktor, Schildgenerator und Neustartschaltern; Triebwerk und Heck-Emitter liegen im
   Antriebsraum am Heck. Die Lerche wird 44 × 13.
6. Etappen: erst M3a, dann M3b. Gebaut wird im 2D-Code.

**Leitplanken (gelten weiter):**
- Keine Schleppaufgaben: Ein Ersatzteil ist ein Gang zum Regal, kein Transport über das ganze Schiff.
- Zwei-Personen-Aufgaben (Reaktor-Neustart) nur in ruhigen Momenten.
- Bots helfen, retten aber nicht allein.
- Nichts geht dauerhaft verloren, der Notreparatur-Schutz (`emergencyRepair`) bleibt.

**Nicht brechen:**
- Die Außenmissionen (Plattform, Wrack, Kesh mit Kampf v2) spielen sich exakt wie bisher. Einzige Ausnahme ist der
  Orbitalschlag (§5.6).
- Alle Missionen m1–m3 bleiben bis zum Ende spielbar.
- Grün bleiben: `npm run check`, `npm run sim`, `npm test` und `node tools/ws-smoke.js`. Neu kommt
  `node tools/test-m3.js` dazu.

## 1. Ablauf und Dateibesitz

### 1.1 Phase A: Umbau ohne Kartenänderung (ein Agent, UMBAU)
Die alte Lerche bleibt. Alle fest verdrahteten Schiffskoordinaten im Code werden durch Daten aus `shared/maps.js`
ersetzt (§3). Danach müssen alle Tests **mit der alten Karte** grün sein. UMBAU darf dafür jede Datei anfassen, aber nur
für diesen Umbau. Neue Mechanik kommt in Phase A nicht dazu.

### 1.2 Zwischenschritt: Studioleitung
Die Studioleitung setzt die neue Lerche (§2) in `shared/maps.js` ein. Sie ergänzt außerdem:
- den Block `spaceM3` in `shared/config.js` und die geänderten Startwerte (§10)
- die Konstanten in `shared/protocol.js` (§9.1)

Danach ist `npm run check` grün. `sim` und die Tests dürfen an dieser Stelle rot sein, TOOLS repariert sie.

### 1.3 Phase B: Teams parallel

| Team | Dateien (nur diese ändern) |
|---|---|
| Studioleitung | `CONTRACT-M3.md`, `shared/maps.js`, `shared/physics.js`, `shared/los.js`; in Phase B nur nach Absprache |
| SERVER-SHIP | `server/game.js`, `server/world.js`, `server/sim/interior.js`, `server/sim/bots.js`, `server/sim/onboard.js`, `shared/protocol.js` (nur ergänzen), `shared/schema.js` |
| SERVER-COMBAT | `server/sim/space.js`, `server/sim/arena.js`, `server/sim/mission.js`, `server/missions/*.js`, `server/sim/away.js` (nur `weaponsStrike`), `shared/config.js` (nur ergänzen), `shared/locations.js` |
| TOOLS | `tools/**` (neu `tools/test-m3.js`), `package.json` |
| CLIENT | `public/index.html`, `public/js/{net,client,render,hud,consoles,dev-mock}.js` |
| ART | `public/js/art.js`, `public/art-preview.html` |
| AUDIO | `public/js/audio.js`, `public/audio-preview.html` |
| QA (danach) | alle Dateien |

**Naht zwischen SERVER-SHIP und SERVER-COMBAT:**
- SERVER-COMBAT liefert in `space.js` die Funktionen aus §9.4. SERVER-SHIP ruft sie in `game.js` auf (Befehle, Snapshot)
  und in `interior.js` (Treffer → Systemschaden über `interior.hitSystems`).
- SERVER-SHIP liefert in `interior.js` die Funktionen aus §9.5. SERVER-COMBAT ruft sie auf.
- Wer eine Funktion des anderen braucht, die noch fehlt, schreibt sich einen dünnen Platzhalter mit `// TODO M3 <team>`
  und meldet das. Die Studioleitung führt zusammen.

**Testserver:** immer auf freiem Port mit `ROOM_CODE=off` starten (UMBAU 3320, SERVER-SHIP 3321, SERVER-COMBAT 3322,
TOOLS 3323, CLIENT 3324, ART 3325, AUDIO 3326, QA 3327). **Port 3300 gehört Kai, nie anfassen.**
Screenshots gehören nach `shots/<team>/`, Playwright-Skripte nach `C:\tmp\pwtest\sts\`.

## 2. Die neue Lerche (44 × 13)

Bug rechts (+x), Backbord oben (−y), Steuerbord unten (+y). Die Karte ist per BFS geprüft
(`concept/lerche-m3-entwurf.js`): Alle Stationen sind erreichbar, und der Weg zwischen den Schaltern A und B beträgt
12 Kacheln.

```
           0         1         2         3         4
           01234567890123456789012345678901234567890123
 0        '##################################          '
 1        '#===#LLLLL#B,,#B,,#y===u#=F==M==U#######    '
 2        '#A==#.....#,,,#,,,#=====#========#......##  '
 3        '#===#.....#,,,#,,,#==R==#========#.W......# '
 4        '#===##D#####D###D##=====###D##D###........##'
 5        '#===#S,YY,........#=====#........#........K#'
 6        '#E==D,,YY,........D=====D........D...C..H..#'
 7        '#===#O,,,,........#=====#........#........I#'
 8        '#===####D###D###D##=====###D##D###........##'
 9        '#===#.....#,,,#,,,#==G==#========#........# '
10        '#===#.P.P.#,,,#,,,#=====#========#......##  '
11        '#==f#X.P.T#B,,#B,,#u===y#=Z==J==V#######    '
12        '##################################          '
```

### 2.1 Räume (`SHIP_ROOMS`, Prüfreihenfolge)

| id | Name | kind | Sektor | Bereich |
|---|---|---|---|---|
| `antrieb` | Antriebsraum | engine | 2 Heck | x1–3, y1–11 |
| `maschinenraum` | Maschinenraum | engine | −1 mittschiffs | x19–23, y1–11 |
| `bruecke` | Brücke | room | 0 Bug | x34–43, y1–11 |
| `lager` | Lager | room | 3 Bb | x5–9, y1–3 |
| `transfer` | Transferkammer | room | 1 Stb | x5–9, y9–11 |
| `q0` / `q1` | Quartier 1 / 2 | quarter | 3 Bb | x11–13 / x15–17, y1–3 |
| `q2` / `q3` | Quartier 3 / Gästequartier | quarter | 1 Stb | x11–13 / x15–17, y9–11 |
| `batterie_bb` | Batteriedeck Backbord | room | 3 Bb | x25–32, y1–3 |
| `batterie_stb` | Batteriedeck Steuerbord | room | 1 Stb | x25–32, y9–11 |
| `messe` | Messe | room | −1 | x5–9, y5–7 |
| `gang` | Gang | room | −1 | x4–33, y4–8 (Rest inkl. Türen) |

### 2.2 Stationen (`SHIP_LEGEND`, eigene Legende nur für das Schiff)

| Zeichen | System-ID | kind (Art) | Sektor | Kachel | Laufweg von der Brücke |
|---|---|---|---|---|---|
| `K` | `weapon_bow` | `sys_weapon_bow` | 0 | 42,5 | 1,3 s |
| `I` | `emitter_bow` | `sys_emitter` | 0 | 42,7 | 1,3 s |
| `F` | `thruster_port` | `sys_thruster` | 3 | 26,1 | 6,0 s |
| `M` | `battery_port` | `sys_battery` | 3 | 29,1 | 5,0 s |
| `U` | `emitter_port` | `sys_emitter` | 3 | 32,1 | 5,3 s |
| `Z` | `thruster_stbd` | `sys_thruster` | 1 | 26,11 | 6,0 s |
| `J` | `battery_stbd` | `sys_battery` | 1 | 29,11 | 5,0 s |
| `V` | `emitter_stbd` | `sys_emitter` | 1 | 32,11 | 5,3 s |
| `R` | `reactor` | `sys_reactor` | −1 | 21,3 | 7,0 s |
| `G` | `shields` (Schildgenerator) | `sys_shields` | −1 | 21,9 | 7,0 s |
| `E` | `engines` (Triebwerk) | `sys_engines` | 2 | 1,6 | 13,3 s |
| `A` | `emitter_aft` | `sys_emitter` | 2 | 1,2 | 14,7 s |
| `O` | `life` | `sys_life` | −1 | 5,7 | — |
| `X` | `transfer` | `sys_transfer` | 1 | 5,11 | — |
| `y` | Reaktorschalter A (19,1), B (23,11) | `reactor_switch` | — | | |

Jeder Legendeneintrag eines Systems trägt `{ kind, solid: true, interact: 'system', system, sector, side }`. Dabei ist
`side` eines von `'bow'|'stbd'|'aft'|'port'|'mid'` und dient für Beschriftung und Art. Die übrigen Zeichen bleiben wie in
`LEGEND`. Konsolen: Taktik `W` (35,3), Captain `C` (37,6), Steuer `H` (40,6). Dazu kommen Terminal `S` (5,5),
Planungstisch `Y` (7–8, 5–6), Transferkonsole `T` (9,11) und die Pads (6,10), (8,10) und (7,11).

### 2.3 Weitere Layoutdaten (alle in `shared/maps.js`)
- `SHELF_TILES`: Regale 1–5 bei x5–9, y1, Zugang y2. Gegenstände in dieser Reihenfolge: Ersatzteil, Löschgel,
  Flickblech, Bolzen, Medipack.
- `BEDS`:
  - q0 Koje (11,1)
  - q1 Koje (15,1)
  - q2 Koje (11,11)
  - q3 Koje (15,11), Gästequartier
  - Je 4 Deko-Slots auf Boden im Raum.
- `REACTOR_SWITCHES`: A (19,1), B (23,11).
- `SHIP_SPAWNS`: (26,6), (28,6), (30,6).
- `BOT_SPAWNS`: (21,6), (13,6), (28,6).
- `SHIP_DRILL`: Feuer (6,6) in der Messe, Leck (5,3) im Lager.
- `SECTOR_REGIONS`: wird aus den Räumen abgeleitet (`test(x,y)` = Raumsektor gleich i). `systems` wird aus den Stationen
  mit diesem Sektor abgeleitet. Mittschiffs gehört zu keinem Sektor.

## 3. Phase A – Umbau ohne Kartenänderung (UMBAU)

Schon vorhanden in `shared/maps.js` (Studioleitung, alte Lerche):
- `SHIP_ROOMS`, `roomAt(tx,ty)`
- `SHELF_TILES` (`{x,y,item,access}`), `shelfAt(tx,ty)`
- `SHIP_DRILL`

UMBAU ersetzt **jede** Stelle, die mit festen Schiffskoordinaten oder festen Schiffszeichen rechnet:

| Stelle | Ersatz |
|---|---|
| `server/world.js` `SHELF_TILES` (y fest 1) | `Maps.SHELF_TILES` |
| `server/sim/bots.js` `shelfAccess` (y+1) | `shelf.access` |
| `server/game.js` Snapshot `ty = 1` bei Bot-Aufgabe `fetch` | `shelf.access` bzw. `shelf.y` |
| `server/sim/interior.js` `SHELVES[tx]` | `Maps.shelfAt(tx,ty)` |
| `public/js/client.js:653`, `render.js` (`Maps.SHELVES[tx]`, `for x in SHELVES`) | `Maps.shelfAt` / `Maps.SHELF_TILES` |
| `public/js/client.js:627` (`ty<6?'A':'B'`) | nur `REACTOR_SWITCHES`-Suche, kein Ersatzwert |
| `public/js/hud.js` `roomOf` (x-Grenzen) | `Maps.roomAt(tx,ty).name` (Quartiere: Name aus `SHIP_ROOMS`) |
| `public/js/art.js:1355` (Maschinenraum x1–6) | `Maps.roomAt(...).kind === 'engine'` |
| `public/js/render.js:217` Zeichen→Art-Kind-Tabelle, `SYS_BY_CHAR` | aus `map.legend[ch].kind` / `.system` ableiten (Fallback-Tabelle nur, wenn die Legende nichts sagt) |
| `public/art-preview.html` `SHELVES[x]` | `Maps.shelfAt` |
| `CONFIG.drill.fire/breach` in Server und `check-maps` | `Maps.SHIP_DRILL`; die Config-Schlüssel bleiben als Altnamen stehen |
| `tools/check-maps.js` Maschinenraum x1–6, Tür (7,6), Größe 42×13, feste Systemliste | Raum `kind: 'engine'` aus `SHIP_ROOMS`; Größe aus `SHIP_ROWS`; Systemliste aus der Legende |
| `tools/sim-headless.js` `interact(S,2,1)`, `(9,1)`, `(10,1)`, `(12,1)` und Tabelle System→Zeichen | Koordinaten aus `REACTOR_SWITCHES`, `SHELF_TILES`, `W.SYSTEM_TILES`, Konsolen aus `CONSOLE_TILES` |
| `public/js/dev-mock.js` gleiche Muster | wie oben |
| Alle weiteren Treffer von `grep` nach festen Schiffskoordinaten | Daten aus `maps.js`; fehlt ein Feld, meldet UMBAU das |

Zusätzlich führt UMBAU **Mehrfach-Kacheln je System** ein: `W.SYSTEM_TILES[sys]` bleibt (erste Kachel), neu kommt
`W.STATIONS = [{ system, x, y, sector, side }]` aus der Legende dazu. Bots und Feuer-Nähe benutzen `STATIONS`.

**Abnahme Phase A:**
- `npm run check`, `npm run sim`, `npm test` und `node tools/ws-smoke.js` sind grün, mit identischer alter Karte.
- `grep` nach Zahlen wie `tx <= 6`, `ty < 6`, `, 1)` im Client und den Tools findet keine Schiffskoordinaten mehr.
- Bericht mit der Liste aller geänderten Stellen.

## 4. Systeme

### 4.1 IDs und Zustände
`Protocol.SYSTEMS` wird ergänzt (alte IDs bleiben):
```
['reactor','engines','shields','weapons','life','transfer',
 'thruster_port','thruster_stbd','emitter_bow','emitter_stbd','emitter_aft','emitter_port',
 'weapon_bow','battery_port','battery_stbd']
```
- Die **12 Kampfsysteme** sind reactor, engines, 2 Düsen, shields (Generator), 4 Emitter, weapon_bow und 2 Batterien.
  Dazu kommen `life` und `transfer` wie bisher.
- `weapons` ist ab M3a ein **Altname**: Er hat keine Station mehr und wird nie direkt beschädigt. Im Snapshot ist
  `systems.weapons` der schlechteste Zustand von weapon_bow, battery_port und battery_stbd. Die **Energieleitung**
  `power.weapons` bleibt unter diesem Namen bestehen (`POWER_SYSTEMS` unverändert).
- Zustände wie bisher: `ok`, `damaged`, `broken`, `offline` (EMP). **Neu ist `fragile`**, ein Flag je System und kein
  eigener Zustand: `ship.fragile = { [sys]: true }`.

### 4.2 Wirkung

| System | beschädigt | zerstört |
|---|---|---|
| Reaktor | Leistung 8 → 6 | Notstrom `spaceM3.reactorBrokenOutput` = 2. Wird er von zerstört repariert, geht `reactorCtl` auf `offline`: Neustart zu zweit an den Schaltern. |
| Triebwerk | maxSpeed × 0,5 | kein Schub, kein Faltsprung, Bolzenwerfer aus |
| Düse Bb / Stb | Drehen **zu dieser Seite** × 0,5 | × 0,15 |
| Schildgenerator (`shields`) | Regeneration halb so schnell, Pool −2 | keine Schilde, kein Schildstoß |
| Emitter (je Sektor) | Sektor hält höchstens die Hälfte (`cap` 4 → 2) | Sektor offen (`cap` 0), Schildstoß dort unmöglich |
| Bug-Waffe | Ladezeit × 1,5 | lädt nicht, feuert nicht |
| Batterie Bb / Stb | 2 von 4 Rohren je Salve | lädt nicht, feuert nicht |
| Lebenserhaltung, Transfer | wie bisher | wie bisher |

Hitze bei Energie 4 trifft weiter das passende System:
- `engines` → engines
- `shields` → shields
- `life` → life
- `weapons` → zufällig eines von weapon_bow, battery_port, battery_stbd, das noch nicht zerstört ist

Zuordnung Sektor ↔ Emitter: 0 = `emitter_bow`, 1 = `emitter_stbd`, 2 = `emitter_aft`, 3 = `emitter_port`.
Seiten der Düsen: Ein negatives `helm.turn` dreht nach Backbord (Winkel nimmt ab) und benutzt `thruster_port`.

### 4.3 Trefferauswahl (Hüllentreffer im Sektor s, also nach den Schilden)
1. **Fragile Systeme in s brechen zuerst.** Jedes System mit `fragile` und Sektor s wird sofort `broken`, das Flag
   fällt weg. Gab es mindestens eines, ist die Systemwirkung dieses Treffers damit erledigt.
2. Sonst wird mit Wahrscheinlichkeit `systemChance` (0,45) ein System beschädigt:
   - Mit `centreChance` (0,15) wird es ein mittschiffs liegendes System (reactor, shields, life).
   - Sonst wird gewichtet gezogen: Systeme im Sektor s mit Gewicht 3, in den beiden Nachbarsektoren (s±1) mit Gewicht 1.
     Der gegenüberliegende Sektor ist ausgeschlossen.
   - Nicht gezogen werden Systeme, die gesperrt sind (`systemLock` 10 s seit dem letzten Systemtreffer) oder `offline`.
3. Beschädigen heißt eine Stufe: ok → damaged → broken. Von beschädigt auf zerstört braucht es also einen zweiten
   Treffer.
4. Feuer und Lecks entstehen weiter nach `hitEffects`, auf Bodenkacheln der Räume mit Sektor s.

## 5. Waffen

### 5.1 Halterungen (`mounts`), Altnamen
| id | Name | Bogen | Reichweite | Schaden | Ladezeit je Punkt |
|---|---|---|---|---|---|
| `bow` | Bug-Waffe „Lanze“ | facing 0°, 16° | 650 | 8, durchschlagend 2 | 24 s |
| `port` | Batterie Backbord | facing −90°, 70° | 520 | Salve 4 × 1,5 | 16 s |
| `stbd` | Batterie Steuerbord | facing +90°, 70° | 520 | Salve 4 × 1,5 | 16 s |
| `bolzen` | Bolzenwerfer (Upgrade) | wie bisher, Heck | wie bisher | wie bisher | wie bisher |

- `phase_l`/`phase_r` fallen weg. Eingehende Befehle mit Altnamen werden umgesetzt:
  `phase_l` → `port`, `phase_r` → `stbd`, `both` → `all`.
- Ladezeit = `secPerPoint / alloc` (2 Punkte auf der Lanze ergeben 12 s), bei beschädigtem System × 1,5.
- `alloc` 0 bedeutet, dass die Waffe nicht lädt.
- **Durchschlagend 2:** Der Schildsektor des Gegners zählt bei diesem Treffer 2 Punkte weniger.

### 5.2 Ladepunkte (Taktik)
- `chargePoints` = `power.weapons > 0 ? power.weapons + 2 : 0`. Mit Energie 2 sind das 4 Punkte.
- Die Taktik verteilt sie mit `weapons.alloc { mount, delta }`. Je Halterung sind 0–4 Punkte erlaubt, die Summe darf
  `chargePoints` nicht übersteigen.
- Sinkt `chargePoints`, wird bei der Halterung mit den meisten Punkten gekürzt (bei Gleichstand zuerst die Batterien).
- Start: `{ bow: 2, port: 1, stbd: 1 }`.

### 5.3 Bug-Schuss mit Zielphase
1. `weapons.fire { mount: 'bow' }` braucht Ladung 1, ein gewähltes Gegnerziel und ein heiles System.
2. Dann beginnt die **Zielphase** `aim = { left: 1.5, angle0 }`.
3. Weicht der Schiffswinkel in der Zielphase um mehr als `aimTolerance` (5°) von `angle0` ab, wird abgebrochen:
   Die Ladung fällt auf `aimAbortCharge` (0,7), es gibt das Ereignis `aim { state: 'abort' }`.
4. Am Ende der Zielphase wird geprüft:
   - Ziel im 16°-Bogen und in Reichweite → Treffer, Strahl `kind: 'lance'`.
   - Sonst Fehlschuss: Ladung 0, Strahl bis zur maximalen Reichweite.

### 5.4 Batterien
- `hold: false` („Feuer frei“): Eine geladene Batterie feuert selbst auf das Taktik-Ziel, wenn es in ihrem Bogen liegt,
  sonst auf den nächsten Gegner im Bogen.
- `hold: true` („Halten“): Sie feuert nur auf `weapons.fire { mount }`.
- Umschalten mit `weapons.hold { mount, hold }`.
- Eine Salve besteht aus N Treffern zu je 1,5 Schaden, im Abstand von 0,15 s (Strahl `kind: 'battery'`).
- N = 4, mit Upgrade **„Zusatzrohre“** 5 (Upgrade-ID bleibt `seitenturm`, neuer Anzeigename, Preis 300). Bei
  beschädigter Batterie ist N = 2.

### 5.5 Unbesetzte Taktik
- Die Ladepunkte werden gleichmäßig verteilt, reihum ab `bow`.
- Alle Waffen feuern automatisch mit `autoFactor` 0,5 auf den nächsten Gegner im Bogen.
- Die Lanze durchläuft dabei ebenfalls die Zielphase.

### 5.6 Orbitalschlag und Bolzenwerfer
- `weapons.strike` (Außenmission) verbraucht eine volle Ladung, zuerst von `bow`, sonst `port`, sonst `stbd`.
  Ist keine Waffe voll geladen, kommt die Fehlermeldung „Keine Waffe voll geladen.“. Die Abklingzeit bleibt 40 s.
- Der Bolzenwerfer funktioniert wie bisher, fällt aber bei zerstörtem Triebwerk aus.

## 6. Flug
- Neues Drehmodell mit Winkelgeschwindigkeit `ship.turnVel`. Sie nähert sich mit `ship.turnAccel` (0,8 rad/s²) dem Ziel
  `helm.turn × ship.turnRate × turnCap[Seite]`.
- Startwerte:
  - `turnRate` 1,6 → **0,5** rad/s (90° in etwa 3 s)
  - `maxSpeed` 160 → 130
  - `accel` 70 → 50
  - `dodgeCooldown` 6 → 10
- Ist die Steuer unbesetzt, fällt `turnVel` mit `turnAccel` auf 0.
- Gegner-HP werden mit `spaceM3.enemyHpFactor` 0,8 multipliziert (zusätzlich zu `crewScaling`, nicht bei `relay`).

## 7. Ansage und Schildstoß

### 7.1 Angekündigte Angriffe (`tele`)
Kanonenboot, Pylon und Wächter schießen nicht mehr sofort. Ist ihr Feuerintervall abgelaufen und das Schiff in Bogen
und Reichweite, beginnt eine **Ladung**: `e.tele = { kind, left, dur, sector }`. Dabei ist `sector` der Schiffssektor,
der Stand jetzt getroffen würde, und wird jeden Tick neu berechnet.

| Gegner | Ladedauer | Treffer am Ende |
|---|---|---|
| gunboat | 3 s | 4 Schaden |
| pylon | 2 s | 3 Schaden |
| sentinel | 2,5 s | EMP (wie bisher) |

- **Ende der Ladung:** Liegt das Schiff dann noch in Bogen und Reichweite, trifft der Angriff sofort
  (`shipHit(sector, dmg, { heavy: true, emp })`, Strahl `kind: 'enemy_heavy'`). Sonst verfehlt er (Ereignis `teleMiss`).
- **Taktik trifft vorher:** Schaden an einem ladenden Gegner verlängert die Ladung um 1 s, insgesamt um höchstens 2 s.
- Jäger (`raider`) schießen in M3a weiter wie bisher. Erst M3b baut die Angriffsläufe.
- **Solo** (1 Spieler verbunden) sagt ODA jede Ladung an, zum Beispiel „Kanonenboot lädt – Backbord!“, mit 4 s
  Abklingzeit je Gegner.
- **Sichtbarkeit (Client):** Die Taktik sieht die Ladung ab Beginn. Der Captain sieht sie erst in den letzten
  `captainSeesLast` (1,2) s. Der Server schickt `tele` an alle, die Konsole filtert.

### 7.2 Schildstoß (Captain)
`captain.burst { sector }` legt einen Stoß auf einen Sektor.

**Schildstoß ist nicht möglich, wenn:**
- die Abklingzeit `burstCooldown` (8 s ab Start) läuft
- der Schildgenerator zerstört ist
- der Emitter des Sektors zerstört ist

**Wirkung:**
- `ship.shields.burst = { sector, t0, until: t0 + 1.5, absorb }`
- `absorb` ist 5, bei beschädigtem Emitter des Sektors 2.
- **Perfekt:** Fällt ein Treffer auf diesen Sektor höchstens 0,5 s nach `t0`, wird er ganz geschluckt, auch wenn er
  durchschlagend ist oder ein EMP. Der Sektor bekommt dann +1 Schildpunkt (bis `cap`), und es kommt das Ereignis
  `burst { sector, perfect: true }`.
- **Danach** bis `until`: Treffer verbrauchen zuerst `absorb`, der Rest geht normal auf Schild und Hülle.
- Zähler: `stats.bursts`, `stats.burstsPerfect`.

## 8. Reparatur und Bots

### 8.1 Drei Wege an jeder Station

| Weg | Eingabe | Dauer | Wirkung |
|---|---|---|---|
| **Flicken** | E halten, ohne Ersatzteil | `flickTime` 1,5 s (Werkzeuggürtel × 0,7) | eine Stufe hoch (broken → damaged, damaged → ok) und `fragile` |
| **Austauschen** | E halten **mit** getragenem Ersatzteil | `partTime` 3 s (Werkzeuggürtel × 0,7) | direkt `ok`, `fragile` fällt weg, Teil verbraucht |
| **Minispiel** | R an der Station | im Client, typisch 3–5 s | eine Stufe hoch, dauerhaft, `fragile` fällt weg |

- Bei `offline` (EMP) bleibt der bisherige Hinweis, es gibt keine Reparatur.
- Für `p.hold` gibt es die Arten `flick`, `swap` und `minigame`.
- **Minispiel-Ablauf:**
  1. Client sendet `cmd { c: 'repair.start', system }`. Wie `crouch` ist das ohne Konsole erlaubt.
  2. Der Server prüft: Spieler an Bord, Station in Reichweite (gleiche Kandidatenkacheln wie bei E), System beschädigt
     oder zerstört und nicht offline, kein anderer Spieler im Minispiel an diesem System.
  3. Ist alles gültig, setzt der Server `p.hold = { kind: 'minigame', system, t: 0 }`. Bewegung oder eine Konsole
     brechen das ab.
  4. Client sendet `repair.done { system, errors }`. Der Server nimmt das nur an, wenn das Minispiel aktiv ist und
     `t ≥ minigameMinTime` (2,5 s) gilt.
  5. `repair.cancel` bricht ab.
- **Das Minispiel** (CLIENT, ein gemeinsames für alle Systeme): eine Leiste mit wanderndem Zeiger und grünem Feld.
  - Leertaste im grünen Feld zählt als Treffer. Nach 3 Treffern ist es fertig.
  - Ein Fehlgriff kostet 1 s Sperre. Man kann nie scheitern.
  - Esc bricht ab.
  - Das Feld wird bei zerstörtem System kleiner.
- Zähler: `stats.flicks`, `stats.swaps`, `stats.minigames`.

### 8.2 Bots auf Befehl
- Bots löschen Feuer und dichten Lecks weiter **selbst** ab (Klassen wie bisher).
- **Systeme** reparieren sie nur aus der **Reparaturliste** `ship.repairQueue = [{ system, mode, bot }]` (höchstens 3
  Einträge). `mode` ist `'flick'` oder `'part'`, `bot` die ID des Bots, der den Eintrag bearbeitet, oder `null`.
  - `captain.repair { system, mode }` hängt einen Eintrag an. Ist das System schon in der Liste, wird nur `mode` ersetzt.
    `mode: null` entfernt den Eintrag.
  - `flick`: Der Bot geht hin und flickt (`flickTime × bot.repairFactor`).
  - `part`: Der Bot holt ein Ersatzteil, tauscht aus (`partTime × bot.repairFactor`) und erledigt den Eintrag. Liegt
    kein Ersatzteil im Lager, gibt es die Meldung wie bisher, und der Eintrag wird zu `flick`.
  - Ein Eintrag fällt weg, sobald das System `ok` ist und nicht `fragile`.
- **Automatik** `ship.botAuto`: Ist sie an, füllen die Bots die Liste selbst. Zuerst kommen zerstörte Systeme (`part`,
  wenn ein Ersatzteil im Lager liegt, sonst `flick`), dann beschädigte (`flick`).
  - Standard: an, solange genau 1 Spieler verbunden ist, sonst aus.
  - Der Captain schaltet sie mit `captain.botAuto { on }` um; danach gilt seine Wahl bis zum Ende der Sitzung.
- `captain.priority` bleibt: `fire` und `breach` wie bisher. Eine System-ID stellt einen `flick`-Eintrag an die Spitze
  der Liste.
- **ODA-Ansagen** bei Systemschaden, mit Abklingzeit 3 s und bei mehreren Schäden gebündelt:
  - „Steuerbord-Batterie beschädigt.“
  - „Bug-Emitter zerstört – Bugsektor offen!“
- **Notreparatur-Schutz** (`emergencyRepair.brokenDelay`) gilt für alle 14 Systeme. Gemeint ist: kein Ersatzteil, und
  niemand ist da.

### 8.3 Zähler für die Abnahme
`stats.bridgeLeaves` zählt um 1 hoch, wenn ein Spieler den Raum `bruecke` verlässt, während mindestens ein Gegner da ist,
der kein `relay` ist (je Verlassen einmal).

## 9. Protokoll und Snapshot

### 9.1 `shared/protocol.js` (Studioleitung im Zwischenschritt)
- `VERSION: 3`
- `SYSTEMS` wie in §4.1
- `MOUNTS: ['bow','port','stbd','bolzen','phase_l','phase_r','seitenturm']` (Altnamen bleiben in der Liste)
- `REPAIR_MODES: ['flick','part']`
- `BEAM_KINDS: ['phase','lance','battery','enemy_heavy','bolzen']`
- `SIDES: ['bow','stbd','aft','port','mid']`
- `CMD_REPAIR: ['repair.start','repair.done','repair.cancel']`: Diese Befehle sind ohne Konsole erlaubt, nur in der Zone
  `ship`.
- `DEBUG_CMDS` ergänzt um `'tele'` (`{ id? }` = sofort laden), `'fragile'` (`{ system }`) und `'burst'`
  (`{ sector }`, ohne Prüfung).

### 9.2 Neue Befehle (`cmd`)
| c | Konsole | Felder |
|---|---|---|
| `weapons.fire` | weapons | `{ mount: 'bow'|'port'|'stbd'|'all'|'bolzen' }` (Altnamen siehe §5.1) |
| `weapons.alloc` | weapons | `{ mount: 'bow'|'port'|'stbd', delta: ±1 }` |
| `weapons.hold` | weapons | `{ mount: 'port'|'stbd', hold: bool }` |
| `captain.burst` | captain | `{ sector: 0..3 }` |
| `captain.repair` | captain | `{ system, mode: 'flick'|'part'|null }` |
| `captain.botAuto` | captain | `{ on: bool }` |
| `repair.start` / `repair.done` / `repair.cancel` | keine | `{ system }`, bei `done` zusätzlich `errors: number` |

### 9.3 Snapshot (Ergänzungen, Beispiel)
```json
{
  "ship": {
    "turnVel": 0.21, "turnCap": { "port": 1, "stbd": 0.5 },
    "systems": { "reactor": "ok", "engines": "ok", "shields": "damaged", "weapons": "damaged", "life": "ok", "transfer": "ok",
      "thruster_port": "ok", "thruster_stbd": "damaged", "emitter_bow": "ok", "emitter_stbd": "broken", "emitter_aft": "ok",
      "emitter_port": "ok", "weapon_bow": "ok", "battery_port": "ok", "battery_stbd": "damaged" },
    "fragile": ["thruster_stbd"],
    "repairQueue": [{ "system": "emitter_stbd", "mode": "part", "bot": "s1" }],
    "botAuto": false,
    "shields": { "pool": 6, "alloc": [2, 0, 1, 3], "current": [2, 0, 1, 2], "cap": [4, 0, 4, 4],
      "burst": { "sector": 3, "left": 1.1, "perfectLeft": 0.1, "absorb": 5 }, "burstCd": 7.4 },
    "chargePoints": 4,
    "mounts": [
      { "id": "bow", "facing": 0, "arc": 16, "range": 650, "charge": 1, "alloc": 2, "state": "ok",
        "aim": { "left": 0.8, "dev": 2.1 } },
      { "id": "port", "facing": -90, "arc": 70, "range": 520, "charge": 0.42, "alloc": 1, "state": "ok",
        "hold": false, "salvo": 0, "salvoMax": 4 },
      { "id": "stbd", "facing": 90, "arc": 70, "range": 520, "charge": 0.1, "alloc": 1, "state": "damaged",
        "hold": true, "salvo": 0, "salvoMax": 2 }
    ]
  },
  "space": {
    "enemies": [{ "id": "e3", "kind": "gunboat", "tele": { "kind": "shot", "left": 1.7, "dur": 3, "sector": 3 } }],
    "beams": [{ "kind": "lance" }]
  },
  "players": [{ "action": { "kind": "minigame", "system": "emitter_stbd", "progress": 0 } }]
}
```
- `aim.dev` ist die aktuelle Abweichung in Grad.
- `salvo` zählt die noch ausstehenden Schüsse einer laufenden Salve.
- `tele.kind` ist `'shot'` oder `'emp'`.
- Felder, die es schon gibt, behalten Name und Bedeutung. Ausnahme: `mounts[].id` heißt jetzt `bow`/`port`/`stbd`
  statt `phase_*`.

**Ereignisse** (`event`):
- `tele { id, kind, sector, dur }`
- `teleMiss { id }`
- `aim { state: 'start'|'abort'|'fire'|'miss' }`
- `burst { sector, perfect }`
- `systemHit { system, state }`
- `repairDone { system, how: 'flick'|'swap'|'minigame'|'bot' }` (das Feld `how` ist neu)

**sfx-Namen** (neu):
- `lance_charge`, `lance_aim`, `lance_fire`, `aim_abort`
- `battery_salvo`
- `tele_charge`, `heavy_hit`
- `burst`, `burst_perfect`
- `flick`, `swap`
- `minigame_tick`, `minigame_hit`, `minigame_miss`, `minigame_done`
- `system_break`

### 9.4 Funktionen in `server/sim/space.js` (SERVER-COMBAT)
```
weaponsFire(game, mount) -> err|null           // neue Logik inkl. Altnamen
weaponsAlloc(game, mount, delta) -> err|null
weaponsHold(game, mount, hold) -> err|null
captainBurst(game, sector) -> err|null
chargePoints(game) -> number
shieldCaps(game) -> [4]
turnCaps(game) -> { port, stbd }
mountsSnapshot(game) -> Array                   // ersetzt den Mount-Block in game.snapshot
shieldsSnapshot(game) -> { pool, alloc, current, cap, burst, burstCd }
enemyTeleSnap(e) -> null | { kind, left, dur, sector }
consumeFullCharge(game) -> mountId|null         // für weaponsStrike
```
In `shipHit` ruft SERVER-COMBAT nach Schild und Hülle `interior.hitSystems(game, sector)` auf (§9.5). Feuer und Lecks
behält `shipHit` selbst.

### 9.5 Funktionen in `server/sim/interior.js` (SERVER-SHIP)
```
hitSystems(game, sector)              // §4.3 vollständig (fragile, Chance, Gewichte, Sperre, ODA-Ansage)
systemSector(sys) -> -1..3            // aus W.STATIONS
emitterFor(sector) -> sysId
isFragile(game, sys) -> bool
repairSystem(game, sys, by, how)      // how: 'flick'|'swap'|'minigame'|'bot'|'oda'; setzt/löscht fragile
SYSTEM_ORDER                          // alle 14 Systeme (ohne Altname weapons)
sysName / sysNameNom                  // deutsche Namen aller 14 Systeme
```
- `damageSystem` bleibt (Debug, Hitze, Feuer).
- Ein zerstörter Reaktor, der repariert wird, setzt `reactorCtl.state = 'offline'` (§4.2).

## 10. CONFIG (`shared/config.js`, Studioleitung im Zwischenschritt)

Geänderte Startwerte:
- `ship.turnRate` 0,5
- `ship.maxSpeed` 130
- `ship.accel` 50
- `ship.dodgeCooldown` 10
- `hitEffects.systemChance` 0,45
- `hitEffects.systemCooldown` 10
- `stateFactor.engines.broken` 0

Neu:
```js
ship.turnAccel: 0.8,
spaceM3: {
  enemyHpFactor: 0.8, reactorBrokenOutput: 2, centreChance: 0.15, sectorWeight: 3, neighbourWeight: 1,
  turnCap: { ok: 1, damaged: 0.5, broken: 0.15 }, emitterCap: { ok: 1, damaged: 0.5, broken: 0 }, generatorDamagedPool: -2,
  mounts: {
    bow:  { facing: 0,   arc: 16, range: 650, damage: 8,   pierce: 2, secPerPoint: 24, damagedFactor: 1.5 },
    port: { facing: -90, arc: 70, range: 520, damage: 1.5, tubes: 4, tubesDamaged: 2, tubesUpgrade: 5, secPerPoint: 16, salvoGap: 0.15 },
    stbd: { facing: 90,  arc: 70, range: 520, damage: 1.5, tubes: 4, tubesDamaged: 2, tubesUpgrade: 5, secPerPoint: 16, salvoGap: 0.15 },
  },
  allocMax: 4, allocDefault: { bow: 2, port: 1, stbd: 1 }, autoFactor: 0.5,
  aimTime: 1.5, aimTolerance: 5, aimAbortCharge: 0.7,
  tele: { gunboat: { dur: 3, damage: 4 }, pylon: { dur: 2, damage: 3 }, sentinel: { dur: 2.5, emp: true },
    delayPerHit: 1, delayMax: 2, captainSeesLast: 1.2, odaCooldown: 4 },
  burst: { duration: 1.5, perfect: 0.5, absorb: 5, absorbDamaged: 2, cooldown: 8 },
  repair: { flickTime: 1.5, partTime: 3, minigameMinTime: 2.5, queueMax: 3, odaCooldown: 3 },
},
```
Alle Werte lassen sich mit `tune spaceM3.<pfad> <wert>` live ändern. Der Shop-Eintrag `seitenturm` bekommt den Namen
„Zusatzrohre“ und kostet 300.

## 11. Client (CLIENT)

- **Steuer:**
  - Der Drehpfeil zeigt `turnVel` und wird je Seite halbiert (beschädigte Düse) oder mit Schloss gesperrt (zerstörte).
  - In der Zielphase der Lanze erscheinen ein Countdown und eine ±5°-Marke mit `aim.dev`, groß und mittig.
  - Der Pilot hat **keine** Feuertaste.
- **Taktik:**
  - Die Lanze ist ein schmaler Kegel, die Batterien sind breite Fächer, gefüllt nach Ladung.
  - Ladepunkte verteilen: Q/E wählt die Waffe, A/D gibt −/+.
  - 1 / 2 / 3 feuert Lanze / Bb / Stb, Leertaste feuert alles.
  - H schaltet die gewählte Batterie zwischen „Halten“ und „Feuer frei“.
  - Feindliche Bögen werden nur gezeigt, solange der Gegner lädt, dazu ein roter Fächer mit Countdown.
  - Höchstens 3 Countdowns gleichzeitig; eigene Bögen bleiben blass, solange sie nicht geladen sind.
  - Bestehende Tasten (T, S, W, M, X, R, O, Z) bleiben.
- **Captain:**
  - Schildanzeige je Sektor mit `cap`: schraffiert mit „½“ bei beschädigtem Emitter, rotes X mit „AUS“ bei zerstörtem.
  - Je Sektor eine Stoß-Taste. Auf der Tastatur: B, dann 1–4 für Bug/Stb/Heck/Bb, oder Shift + Pfeil.
  - Abklingzeit sichtbar.
  - Ladungen erst in den letzten 1,2 s.
- **Schadensplan (Listenversion):**
  - Alle 14 Systeme mit Ort (BB/STB/BUG/HECK/MITTE), Zustand dreifach codiert (Farbe, Muster, Kürzel OK/BESCH/AUS/FLICK)
    und Laufzeit von der Brücke.
  - Je Zeile Knöpfe „Flicken“ / „Teil“ / „—“ für die Reparaturliste, dazu der Schalter „Bots automatisch“.
  - Die Liste ersetzt die bisherige Schadensseite des Captains, die Tastenlogik bleibt (W/S wählen).
- **Im Schiff:**
  - Neben jeder Station eine Seitenmarke (BB/STB/BUG/HECK/MITTE) und der Zustand.
  - Der E-Hinweis unterscheidet: „E halten: flicken“, „E halten: Teil einbauen“, „R: reparieren (Minispiel)“.
  - Raumname über `Maps.roomAt`.
- **Minispiel-Overlay** wie in §8.1, mittig, für 640 × 360 lesbar. Solange es offen ist, ist Bewegung gesperrt, und E
  geht nicht an den Server.
- **Bericht** und `dev-mock.js`: Mock-Zustände für alle neuen Snapshot-Felder (`?mock=1&console=weapons|helm|captain`).

## 12. Art (ART)

Palette:
- Hintergrund #0B0E1A, Fläche #1A2E2A, Text #F4EEDC, gedämpft #8EA3B5
- Messing #C9974A, Mint #7FE0C2, Warnung #E0473C, Erfolg #8FD06A
- Feindglühen #FF5A4A, Stoß #E8F8FF
- Zustände: beschädigt #F2C94C schraffiert, zerstört rotes X, geflickt #F08A3C mit Klebeband

**Neue Objekte** für `Art.drawObject(g, kind, x, y, opts)` mit `opts.state`, `opts.fragile`, `opts.side`, `opts.time`:
- `sys_thruster`: Düse, Ausrichtung nach `side`
- `sys_battery`: Batterie mit 4 Rohren; beschädigt sind 2 Rohre dunkel
- `sys_emitter`: Emitter-Spule, Farbe nach `side`
- `sys_weapon_bow`: Lanzenkammer
- `sys_reactor` und `sys_shields` neu für den mittigen Maschinenraum
- `sys_engines`: Triebwerk am Heck

**Weiteres:**
- Bodenstil `engine` für beide Maschinenräume.
- Stationsmarken (Seitenschild) als kleine Messingplakette mit Kürzel.
- Zustands-Overlays „BESCH“, „AUS“ und „FLICK“ (Klebeband).
- **Außenansicht:** Rumpf mit Batterien an beiden Flanken und Lanze am Bug. Ein beschädigtes oder zerstörtes System
  sieht man außen (Rauch, Funken).
- **Strahlen:** `lance` (weiß-mint, dick, kurzes Nachglühen), `battery` (kurze messingfarbene Bolzen) und
  `enemy_heavy` (rot).
- **Ladeglühen** an Gegnern (`tele`, pulsierend, rot gestrichelt).
- **Schildstoß:** weißer Sektorbogen, perfekt mit Ring.
- **`art-preview.html`:** zeigt die neue Lerche mit allen Zuständen.

## 13. Audio (AUDIO)

- Alle sfx-Namen aus §9.3, jeweils mit klarer Lesbarkeit:
  - Ladung: steigender Ton, je Gegnerart anders
  - Lanze: tiefes Laden, in der Zielphase ein Halte-Ton, harter Schuss
  - Abbruch: Absacken
  - Salve: 4 oder 5 kurze Schläge
  - Schildstoß: Wusch; perfekt: zusätzlich ein heller Glockenton
  - Flicken: Klebeband
  - Austauschen: Ratsche
  - Minispiel: Tick, Treffer, Fehlgriff, fertig
- `system_break` ist ein dumpfer Bruch mit Funken.
- Alles läuft prozedural wie bisher, ohne Dateien. `audio-preview.html` bekommt die neuen Klänge.

## 14. Werkzeuge und Tests (TOOLS)

- **`tools/check-maps.js`:**
  - neue Lerche 44 × 13
  - alle 14 Stationen erreichbar
  - jede Station hat `system`, `sector` und `side`
  - beide Schalter erreichbar, Weg A↔B ≤ 14 Kacheln
  - jeder Sektor 0–3 hat Bodenkacheln und mindestens eine Station
  - `SHIP_DRILL` auf Boden
  - Deko-Slots im Raum
  - Planungstisch von mindestens 3 Seiten erreichbar
  - `roomAt` deckt jede begehbare Kachel ab
- **`tools/sim-headless.js`:**
  - Die Bots spielen das neue Waffen- und Reparatursystem.
  - Die Taktik verteilt die Ladepunkte und feuert alles.
  - Die Steuer kennt die zwei Strategien `nose` (Bug auf das Ziel, halten) und `maneuver` (Breitseite: Ziel bei ±90°,
    Seite wechseln, wenn der Sektor schwach ist, Kurs halten in der Zielphase, Wegdrehen bei einer Ladung).
  - Der Captain setzt Schildstöße bei Ladungen.
  - Mindestens ein Spieler-Bot geht zum Flicken, Austauschen oder ins Minispiel; das Minispiel ist als `repair.done`
    nach 3,5 s simuliert.
  - `npm run sim` bleibt der Lauf für m1, m2 und m3.
  - Neu `node tools/sim-headless.js arena --pilot nose|maneuver --seeds 10`: misst im Testgelände Hüllenverlust, Dauer,
    `bridgeLeaves`, Schildstöße (perfekt) und Flicken.
- **`tools/test-m3.js`** (neu, in `npm test` aufnehmen):
  - Wirkung jedes der 12 Systeme im Zustand beschädigt und zerstört.
  - Fragil: Der nächste Sektortreffer zerstört.
  - Minispiel: Mindestzeit, eine Stufe hoch.
  - Austauschen: direkt `ok`.
  - Schildstoß: perfekt und nicht perfekt, gesperrt bei zerstörtem Emitter oder Generator.
  - Ladung: Verlängerung durch Treffer, Fehlschuss nach dem Wegdrehen.
  - Zielphase: Abbruch auf 0,7.
  - Ladepunkte: Grenzen, Kürzung, Verteilung bei unbesetzter Taktik.
  - Bots fassen ohne Liste kein System an; Automatik solo.
  - Trefferauswahl statistisch über 2000 Würfe: Sektor s ≥ 50 %, Gegenseite 0 %, Mitte ≈ 15 % ± 4.
  - Zerstörter Reaktor braucht nach der Reparatur einen Neustart.
  - Altnamen-Befehle.
  - Alle Snapshot-Felder aus §9.3 vorhanden.
- `test-features.js` und `test-combat.js` werden an die neuen Namen angepasst, ohne Abdeckung zu verlieren.

## 15. Missionen (SERVER-COMBAT)

Alle drei Missionen bleiben spielbar und werden neu balanciert. Ziel ist: kein Notfallprotokoll solo in der Sim, höchstens
1–2 zu dritt.
- **m1 Splittergürtel:** ein Jäger ohne Staffelung.
- **m1 Boje B-7:** Das Kanonenboot kündigt an (automatisch über `tele`), der Rückzug bei 50 % bleibt.
- **m1 Nachhut:** Die Jäger kommen von achtern (Spawn hinter dem Heck), sonst wie bisher.
- **m2:** Der Hinterhalt bleibt. Die Pylonen laden 2 s. Die Pylon-Positionen bleiben, wenn die Sim damit grün ist; sonst
  nach außen verlegen.
- **m3 Kesh (Orbit):** wie bisher.
- **Testgelände Raumkampf:**
  - Die Wellen bleiben.
  - Neu: Welle 4 mit `['gunboat','raider']` und Welle 5 mit `['pylon','gunboat']` (Pylon an fester Position).
  - Beim Start ist das Schiff unbeschädigt.

## 16. Abnahme M3a

| Kriterium | Prüfung |
|---|---|
| Alle 12 Systeme gehen kaputt und wieder heil, mit sichtbarer Wirkung | `test-m3.js` grün; Screenshots je Konsole (Steuer, Taktik, Captain-Schilde, Schadensplan) mit beschädigten und zerstörten Systemen |
| Drei Reparaturwege funktionieren | Test und ein Browser-Lauf: Flicken, Minispiel, Austauschen |
| Ansage und Schildstoß lesbar | Screenshot Taktik mit Ladung, Captain mit Stoß; perfekter Stoß im Test |
| „Nase drauf“ verliert messbar | Sim im Testgelände, 10 Seeds je Strategie: Hüllenverlust `nose` ≥ 1,3 × `maneuver`. **Ehrlich melden**, falls das in M3a noch nicht erreicht ist (gilt für M3a/b zusammen) |
| Solo ohne Softlock | Sim solo 10 min im Testgelände und m1 solo bis zum Ende |
| Bestehendes grün | `check`, `sim`, `npm test`, `ws-smoke`, `node --check` aller JS |
| Messwerte | QA meldet Kampfdauer je Welle, `bridgeLeaves`, Schildstöße (perfekt), Flicken, Minispiele, Austausche aus einem Lauf zu dritt |

## 17. Debug
`npm run debug` + `?debug=1`:
- `damage <system> <state>` gilt für alle 14 Systeme.
- `fragile <system>`
- `tele [id]`
- `burst <sector>`
- `tune spaceM3.<pfad> <wert>`

## 18. Stand nach Phase A und Zwischenschritt (2026-10-06)

- **Phase A (UMBAU) ist fertig.** Mit der alten Karte waren alle Prüfungen grün: check 311, features 174, combat 167, sim
  und smoke OK. Was neu dazukam:
  - **Server:**
    - `W.STATIONS = [{system,x,y,sector,side}]`
    - `W.SYSTEM_TILES` = erste Kachel
    - Bots fahren Stationen über `stationTilesOf` an.
    - Regale über `Maps.shelfAt` und `shelf.access`.
    - Die Übung nutzt `Maps.SHIP_DRILL`.
    - Ivo läuft über `Maps.IVO_SPOTS`.
  - **render.js:** Neue Helfer, die aus der Schiffslegende gebaut werden: `legendOf`, `sysOf`, `consoleOf`, `objKindOf`,
    `shelfItemAt`, `shelfTiles`.
  - **hud.js:** Raumnamen über `Maps.roomAt`.
  - **art.js:** `engineRoomAt` über `roomAt` mit `kind === 'engine'`.
  - **Tools:** `check-maps`, `sim-headless` und `test-features` arbeiten mit Stehplatz-Helfern statt mit Koordinaten.
- **Zwischenschritt (Studioleitung) ist fertig.**
  - Die neue Lerche steht in `shared/maps.js`:
    - `Maps.ship` benutzt `SHIP_LEGEND`.
    - `SECTOR_REGIONS` wird aus Räumen und Stationen abgeleitet.
    - Neu: `IVO_SPOTS`, `SECTOR_NAMES`.
    - Abweichung von §2: Das Terminal `S` liegt auf (5,5), damit jede Kachel des Planungstischs erreichbar ist.
  - `config.js`: §10 ist eingetragen.
  - `protocol.js`: §9.1 ist eingetragen.
  - `npm run check`: **358/358**.
- **Noch offen für Phase B:**
  - `interior.SYSTEM_ORDER`, `hud.SYS_NAMES` und die deutschen Systemnamen kennen nur die alten IDs (SERVER-SHIP, CLIENT).
  - `sim`, `npm test` und `ws-smoke` dürfen rot sein, bis TOOLS und die Server-Teams nachziehen.

## 19. QA-Nachträge (2026-10-06)

Bei Widerspruch gilt der Code. Alle Balancing-Werte sind per `tune <pfad> <wert>` live änderbar (siehe 19.1, Punkt 1).

### 19.1 Behobene Fehler
1. **`tune spaceM3.<pfad>` ging nicht** (§10, §17): `combat.tune` kannte nur `awayCombat`. Jetzt gilt: Pfade unter
   `awayCombat` wie bisher ohne Präfix; jeder andere Pfad, dessen erster Schlüssel in der Konfiguration liegt
   (`spaceM3.*`, `combat.*`, `crewScaling.*`, `enemies.*`, `ship.*` …), ändert die ganze Konfiguration. Nur Zahlen/Schalter,
   keine Objekte oder Listen. Test in `test-m3.js`.
2. **`space.js damageEnemy`** rundete HP und Schildpunkte auf 0,1 – Teiltreffer (z. B. 0,75 der unbesetzten Taktik)
   verloren oder gewannen je Treffer bis 0,05. Jetzt exakt mit Gleitkomma-Rest-Schutz (`EPS`), gerundet wird nur im
   Snapshot. Test in `test-m3.js`.
3. **Taktik-Karte:** Beschriftungen wie „LANZE BEREIT“ wurden am Kartenrand abgeschnitten. `render.js flushLabels` schiebt
   jedes Label vor der Überlappungsprüfung in den Kartenrahmen (keine übereinanderliegenden Randlabels).
4. **Schadensplan:** Feuer-/Leckzeile nannte Räume mehrfach. Jetzt zusammengefasst mit Anzahl („Antriebsraum 2×,
   Batteriedeck Steuerbord 2×“), höchstens 3–4 Räume, dann „…“.
5. **Captain-Schilde:** Während eines Stoßes war „PERFEKT!“/„STOSS 1,2“ neben dem Tastenkürzel abgeschnitten; das Kürzel
   B1–B4 wird während des Stoßes ausgeblendet.
6. **Neu (Lesbarkeit):** Die Taktik zeigt bei geladener Lanze „DREHT NOCH“ (bernstein) statt „BEREIT“, solange
   `|turnVel| > 0,12` – wegen der Trägheit (0,8 rad/s²) bricht eine Zielphase sonst fast sicher ab.
7. `test-m3.js` liest den Kanonenboot-Schaden aus der Konfiguration statt fest 4.

### 19.2 Balancing (alt → neu, Grund)

| Wert | alt | neu | Grund |
|---|---|---|---|
| `combat.raiderOrbit` | 250 | 320 | Jäger kreisten mit ~0,48 rad/s fast so schnell, wie die Lerche dreht (0,5) – keine Breitseite möglich. Jetzt ~0,38 rad/s. |
| `spaceM3.tele.gunboat.damage` | 4 | 3 | Ein Treffer kostete 20 Hülle, jetzt 15. |
| `enemies.gunboat.fireInterval` | 3 | 4 | Im Browser kosteten Kanonenboot-Wellen zu dritt bis 60 Hülle (6–7 schwere Treffer je Lauf in leere Sektoren). |
| `crewScaling.3.enemyFireInterval` | 1,5 | 1,7 | Zu dritt 5–6 Notfallprotokolle je Testgelände-Lauf. |
| `crewScaling.3.enemyHp` | 0,85 | 0,7 | Kanonenboot-Wellen dauerten im Browser 80–150 s. |
| `ship.hullRegen` | 0,4 | 1,5 | Kaskade: nach einem Notfallprotokoll kam die Hülle in 12 s Wellenpause kaum über 30, jede weitere Welle löste das nächste aus. Wirkt nur ohne Gegner und ohne Lecks, bis `hullRegenMax` 70. |
| `spaceM3.raiderFlip` | 9 | 9 | geprüft (6), kein klarer Vorteil – bleibt. |

Solo-Werte (`crewScaling.1`) sind unverändert; `npm run sim` (m1/m2 solo, zu dritt, solo ohne Übung) bleibt bei
0 Notfallprotokollen.

**Bot-Werkzeug (`tools/sim-headless.js`):** Die Ausnahme „gegen Jäger Kurs halten“ gilt jetzt nur noch, solange Jäger
schneller kreisen als 90 % des Drehtempos (`speed/raiderOrbit ≥ 0,9 × turnRate`) – mit den neuen Werten hält „maneuver“
auch Jäger in der Breitseite. „nose“ behält gegen Jäger das Kurshalten, weil das seine bessere Variante ist (Bug auf den
Jäger drehen kostete in Welle 1 fast dreimal so lange). Das ist bewusst kein Nachteil für „nose“.

### 19.3 Abnahme §16 „Nase drauf verliert messbar“
`node tools/sim-headless.js arena --pilot both --seeds 10`, zu dritt, 5 Wellen, Wellenlimit 180 s:

| Wert | vorher nose | vorher maneuver | nachher nose | nachher maneuver |
|---|---|---|---|---|
| Hüllenverlust gesamt | 207,2 | 217,7 | 160,1 | 19,6 |
| je Minute | 17,3 | 22,8 | 14,4 | 3,6 |
| je geschaffte Welle | 76,7 | 48,4 | 59,3 | 3,9 |
| Wellen je 10 min | 2,2 | 4,5 | 2,4 | 5,0 |
| Notfallprotokolle | 4,7 | 5,8 | 1,8 | 0 |
| Faktor nose/maneuver gesamt · je min · je Welle | 0,95 · 0,76 · 1,58 | | 8,2 · 4,0 · 15 | |

**Erreicht** (≥ 1,3 in allen drei Lesarten). Ehrlich: Ein Teil des Abstands kommt daher, dass „maneuver“ Jäger jetzt in
der Breitseite halten kann (Wert- und Bot-Änderung zusammen). Die Bots spielen fehlerfrei; „maneuver“ ist für Bots fast
schadlos, Menschen liegen deutlich darüber (19.4). Solo (`--players 1`) ist der Vergleich nicht aussagekräftig: Der
Solo-Bot mit „nose“ bleibt am Kanonenboot hängen (Welle 2 läuft ins 180-s-Limit), Faktor 0,32.

### 19.4 Browser-Läufe (QA-Skript, ohne Debug/God-Mode, menschliche Pausen; Skripte sind schneller als Menschen)
Testgelände zu dritt, je 4 Wellen; Steuer 1280×720, Taktik 1920×1080, Captain 1280×720 (danach Taktik auf 1280×720 und
Captain auf 1920×1080 umgeschaltet). Spielzeit aus dem Server.

| Lauf | Werte | W1 | W2 | W3 | W4 | Notfälle | bridgeLeaves | Stöße (perfekt) | Flicken/Minispiel/Austausch |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Orbit 320, Kanonenboot 3, 1,7 | 25,9 | 82,5 | 180,0 | 135,4 | 3 | 3 | 23 (13) | 3/3/3 |
| 2 | wie 1 | 27,1 | 100,2 | 57,3 | 145,7 | 0 | 1 | 24 (8) | 1/1/0 |
| 3 | wie 1 | 28,3 | 142,2 | 142,1 | 152,1 | 4 | 6 | 14 (5) | 2/3/3 |
| 4 | + Kanonenboot-Intervall 4 | 42,3 | 142,8 | 69,2 | 154,3 | 3 | 2 | 11 (2) | 6/1/1 |
| 5 | + enemyHp 0,7 | 23,0 | 120,4 | 109,8 | 186,8 | 5 | 6 | 17 (5) | 3/3/2 |
| 6 | wie 5 | 22,1 | 147,4 | 113,1 | 48,9 | 2 | 4 | 15 (6) | 2/3/1 |
| 7 | **Endwerte** (+ hullRegen 1,5) | 42,7 | 55,2 | 53,1 | 65,6 | 0 | 0 | 7 (1) | 0/0/0 |
| 8 | **Endwerte** | 20,0 | 171,0 | 60,6 | 90,0 | 0 | 3 | 14 (5) | 1/1/1 |

- In Lauf 6 und 8 mitgeschnitten: Hüllenschaden zu 67–87 % aus 6–7 schweren Kanonenboot-Treffern in leere Schildsektoren
  (Pool 4 = 1 Punkt je Sektor).
- Lauf 5: zerstörter Reaktor per Austausch repariert → offline → Neustart am Schalter A, Schrauber an B nach 3 s, 9,7 s.
- Lanze im Browser: 5–12 Zielphasen je Lauf (Lauf 1: 0 – der Skript-Pilot drehte noch nie den Bug auf ein Ziel; ab Lauf 2
  dreht er bei geladener Lanze kurz ein); Batterie „Halten“ + manuell feuern, Leertaste (alles) je einmal; 21–46
  Ausweichrollen.
- Solo (Endwerte): W1 58 s, W2 222 s, W3 127 s, 0 Notfälle (das Skript nutzt die Lanze solo kaum).
- m1 bis zum ersten Kampf an B-7 zu dritt (Anreise per Debug `mission m1 combat` übersprungen): Kanonenboot kündigt an,
  Kampf 97 s bis zum Schritt `scan`, 9 Ladungen, 6 Stöße (5 perfekt), 0 Notfälle (Werte vor `enemyHp`/`hullRegen`).
- Kesh (Testgelände Außenteam): Kampf v2 unverändert (Schild 3/3, Ducken, Deckung); Orbitalschlag verbraucht die volle
  Lanzenladung (1,0 → 0), Batterien bleiben voll – wie §5.6.
- Fehler: Server-Fehlerzähler 0, Client-Fehlerzähler 0, keine Konsolenfehler in allen Läufen.

### 19.5 Offen / Empfehlungen für M3b
- **Varianz:** Zwischen den Läufen 0–5 Notfallprotokolle bei gleichen Werten. Die Endwerte sind zweimal gemessen (0/0) –
  zu wenig für eine sichere Aussage. Beim Spieleabend Notfälle zählen; Stellschrauben: `crewScaling.3.enemyFireInterval`,
  `spaceM3.tele.gunboat.damage`, `ship.hullRegen`.
- **Schildpool 4** (Energie 2 × 2) ist dünn: ein schwerer Treffer trifft fast immer einen leeren Sektor, wenn der Captain
  nicht vorher umverteilt. Schildstoß rettet viel – evtl. Captain-Hinweis „Sektor leer, Ladung läuft“.
- **Lanze gegen Jäger** praktisch wirkungslos (Bot „nose“: ~6 Treffer bei ~50 Fehlschüssen je Lauf); das gehört zu den
  Jäger-Anflügen in M3b.
- **Reaktor-Neustart mitten im Kampf** widerspricht der Leitplanke „Zwei-Personen-Aufgaben nur in ruhigen Momenten“.
  Vorschlag: Wird ein zerstörter Reaktor repariert, solange Gegner da sind, startet er selbst (oder erst nach dem Kampf).
- Die ODA-Kurzhilfe der Taktik („Taktik: T Ziel, 1 Lanze …“) erscheint auch beim Außenteam, wenn jemand die Taktik
  betritt – kosmetisch.
- Der Kanonenboot-Kampf solo dauert lange (Breitseite mit 4er-Schilden); solo eher Lanze von vorn/hinten nutzen – Hinweis
  von ODA wäre hilfreich.
