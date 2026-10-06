# CONTRACT – Sternenschicht, Demo „Die stumme Boje“

Schnittstellenvertrag für die parallele Produktion. **Wer eine Datei nicht besitzt, fasst sie
nicht an.** Unklarheiten nicht raten, sondern im Abschlussbericht als „Vertragsfrage“ melden und
die naheliegendste vertragskonforme Lösung wählen.

Sprache: UI-Texte deutsch. Code-Bezeichner englisch, deutsch nur Fachbegriffe/Eigennamen
(Lanze, Bolzen, Schrauber, Datenkern, Sonde, Messe …). Kommentare dürfen deutsch sein.

Konzeptgrafiken als Stilreferenz: `concept/hero.svg`, `concept/deckplan.svg`, `concept/tactical.svg`,
`concept/raider.svg`, `concept/crew.svg` (+ PNG-Renders). Pitch-Deck:
https://claude.ai/artifact/3jhuz4JKQkigjLfBJcKWXX

---

## 1. Was die Demo ist

Online-Koop für 1–3 Spieler, jeder im eigenen Browser. Ein Node-Server ist maßgeblich
(autoritativ). 2D top-down Pixel-Art (32-px-Kacheln, interne Auflösung 640×360). Die Crew läuft
im Schiffsinneren herum; an Konsolen öffnen sich eigene Ansichten. Zwei Schrauber-Bots helfen
bei Reparatur. Eine Außenmission läuft **gleichzeitig** zum Schiff.

Zielspieldauer **12–15 min** (die QA misst). Kein Game Over: Gemütlich, man scheitert mit Würde.

Start: `cd sternenschicht && npm install && npm start` → `http://localhost:3300`.
Mitspieler im LAN: `http://<IP>:3300`.

## 2. Dateiaufteilung (Besitz)

```
sternenschicht/
  CONTRACT.md                 Studioleitung (dieser Vertrag)
  shared/maps.js              Studioleitung (Karten, fest) – Änderungen nur via Vertragsfrage
  shared/config.js            Studioleitung angelegt; Team SERVER darf Schlüssel ERGÄNZEN (nie umbenennen)
  shared/protocol.js          Studioleitung (Konstanten)
  shared/physics.js           Studioleitung (Kollision, Winkel, Sektoren, Feuerbögen)
  shared/schema.js            Team SERVER (Mini-JSON-Validator für Claude-Missionen)
  package.json, .env.example  Team SERVER
  server/**                   Team SERVER
  data/                       Laufzeit (Server schreibt campaign.json; nicht einchecken)
  tools/**                    Team SERVER (check-maps.js, sim-headless.js)
  public/index.html           Team CLIENT
  public/js/net.js            Team CLIENT
  public/js/client.js         Team CLIENT
  public/js/render.js         Team CLIENT
  public/js/hud.js            Team CLIENT
  public/js/consoles.js       Team CLIENT
  public/js/dev-mock.js       Team CLIENT (nur mit ?mock=1 aktiv)
  public/js/art.js            Team ART
  public/art-preview.html     Team ART
  public/js/audio.js          Team AUDIO
  public/audio-preview.html   Team AUDIO
  README.md                   QA
  concept/                    Art-Referenz (nicht ändern)
```

Screenshots/Testausgaben je Team in eigenem Ordner: `shots/server/`, `shots/client/`,
`shots/art/`, `shots/audio/`, `shots/qa/`. Playwright: `require('C:/tmp/pwtest/node_modules/playwright-core')`,
Chromium `executablePath: process.env.LOCALAPPDATA + '/ms-playwright/chromium-1234/chrome-win/chrome.exe'`
(Pfad prüfen, ggf. `chrome-win64`). Nichts im Projekt installieren außer den Server-Abhängigkeiten.

## 3. Technische Standards

- **Server:** Node 24, Abhängigkeiten nur `ws` (kein Express: statische Dateien mit `http` + `fs`
  ausliefern). `npm start` = `node --env-file-if-exists=.env server/index.js`,
  `npm run debug` = dasselbe mit `--debug`, `npm run check` = `node tools/check-maps.js`,
  `npm run sim` = `node tools/sim-headless.js`. Port aus `PORT` oder `CONFIG.port` (3300).
- Statisch ausgeliefert: `public/` unter `/`, `shared/` unter `/shared/`. WebSocket unter `/ws`.
  Kein Directory-Traversal (Pfade normalisieren, nur innerhalb dieser Ordner).
- **Client:** kein Build, keine ES-Module, keine CDNs, keine externen Assets. Klassische
  `<script src>` in dieser Reihenfolge:
  `/shared/config.js, /shared/maps.js, /shared/protocol.js, /shared/physics.js,
  js/art.js, js/audio.js, js/net.js, js/render.js, js/hud.js, js/consoles.js, js/dev-mock.js, js/client.js`.
  Globale Objekte: `Shared_Config, Shared_Maps, Shared_Protocol, Shared_Physics, Art, GameAudio,
  Net, Render, Hud, Consoles, DevMock, Client`.
- Rendering: Canvas 2D, interne Auflösung 640×360, `imageSmoothingEnabled=false`,
  `image-rendering:pixelated`. Ganzzahlige Skalierung nur, wenn sie ≥ 80 % des Fensters füllt,
  sonst gebrochene Skalierung. Client-Loop mit festem 60-Hz-Timestep + Akkumulator (Interpolation/Animation).
- Server-Tick 30 Hz (fester Timestep), Snapshots 15 Hz an alle.
- **Robustheit:** `client.js` läuft ohne `Art` (Fallback-Renderer mit Rechtecken/Farben) und ohne
  `GameAudio` (No-op). Aufrufe in fremde Module in try/catch; abgefangene Fehler **zählen**
  (`window.__game.errors`) und per `console.warn` loggen (gedrosselt), nie still schlucken.
  Server: Fehler in einem Tick-Teilsystem fangen, zählen (`game.errors`), loggen, weiterlaufen.
  Verbindungsabbruch → Overlay „Verbindung verloren – verbinde neu …“, automatischer Reconnect
  (gleiche `clientId` aus localStorage → Server gibt denselben Spieler zurück).
- Audio erst nach erster Nutzereingabe (`GameAudio.init()`); vorher ist jede Audio-Funktion No-op.
- Debug: Client `?debug=1` (Overlay: FPS, Ping, Tick, Stage, Fehlerzähler, Hitboxen, Feuerbögen).
  `window.__game = { state, pid, send(msg), errors, fps, ping }` immer vorhanden.
  Server akzeptiert `debug`-Nachrichten nur mit `--debug` oder `DEBUG=1`.
- Karten werden per Skript geprüft (`tools/check-maps.js`: Zeilenlängen, Erreichbarkeit aller
  Interaktionspunkte, Plattform: Datenkern nur nach Öffnen der Tür erreichbar, Sonde ohne).

## 4. Welt, Karten, Koordinaten

### 4.1 Kartenlegende (`shared/maps.js`)
Kachel = 32 px. Pixelkoordinate einer Figur = **Füße** (Mittelpunkt der Hitbox 18×12).

| Zeichen | Art | solid | Interaktion |
|---|---|---|---|
| `#` | Wand | ja | – |
| ` ` / `~` | Leere / Weltraum | ja | – |
| `.` `,` `=` `_` | Boden Metall / Holz / Gitter | nein | – |
| `D` | offene Tür (Boden) | nein | – |
| `P` | Transferpad (Boden) | nein | auf Pad E halten = Selbst-Transfer |
| `H C W T` | Konsole Steuer / Captain / Waffen / Transfer | ja | E: Konsole betreten |
| `S` | Hafenterminal (Shop, nur angedockt) | ja | E: Konsole `shop` |
| `L` (Schiff) | Lagerregal, Gegenstand nach x: 8 ersatzteil, 9 loeschgel, 10 flickblech, 11 bolzen, 12 medipack | ja | E: nehmen / zurücklegen |
| `L` (Plattform) | verriegelte Tür, offen nach Sonde | ja→nein | – |
| `B` | Koje (Farbe 0,1,2 laut `BEDS`) | ja | E (nur Besitzer): Konsole `quartier` |
| `R E G K X O` | Systempunkt Reaktor / Antrieb / Schildgenerator / Waffenbank / Transfer / Lebenserhaltung | ja | E halten: reparieren |
| `m p c x b` | Tisch / Pflanze / Kiste / Kiste / Bojenkern | ja | – |
| `N Q d` | Spawn Techniker / Datenkern / Drohne (Boden) | nein | – |
| `Z` | Kustoden-Sonde | ja | E: Konsole `sonde` |

Schiff: Bug rechts (+x), Backbord oben (−y), Steuerbord unten (+y). Räume: Maschinenraum x1–6,
Lager x8–12 y1–4, Transferkammer x8–12 y8–11, Gang y6, Quartiere x14–19 (oben/unten),
Messe x21–25, Brücke x27–33.

### 4.2 Interaktionsregel (Server)
`act down` → Ziel = Kachel in Blickrichtung; ist dort nichts Interaktives, die nächste der 4
Nachbarkacheln (Reihenfolge: Blickrichtung, dann oben, rechts, unten, links). Priorität bei
mehreren Möglichkeiten auf derselben Kachel: Wiederbeleben > Feuer löschen > Leck flicken >
Reparieren > Konsole > Regal > Koje > Aufheben.
- **Tippen** (wirkt bei `down`): Konsole betreten, Regal nehmen/zurücklegen, Koje, Aufheben
  (Datenkern, Bodengegenstand), Techniker „folgen/warten“.
- **Halten** (Fortschritt solange gedrückt und Spieler steht still): Reparieren, Löschen,
  Flicken, Wiederbeleben, Selbst-Transfer auf Pad. Loslassen bricht ab (Fortschritt verfällt).
- Jeder trägt höchstens **einen** Gegenstand (`carry`). Tragend: Geschwindigkeit ×0,85.
  `drop` legt ihn auf die eigene Kachel (Bodengegenstand).

### 4.3 Raum (Taktik)
Raumkoordinaten in px, y nach unten. Winkel in Radiant, 0 = +x, **im Uhrzeigersinn** positiv.
Sektoren relativ zum Bug: 0 Bug (±45°), 1 Steuerbord (45°…135°), 2 Heck, 3 Backbord (−135°…−45°).
Szenen (`CONFIG.scenes`): `port` (Hafen, Start angedockt), `route` (Asteroidenfeld),
`buoy` (Boje B-7). Szenenwechsel per Faltsprung.

### 4.4 `shared/physics.js` (fertig)
`moveWithCollision(isSolid, x, y, dx, dy, hitbox)`, `boxHits`, `normAngle`,
`sectorOf(sx, sy, angle, px, py) → 0..3`, `inArc(sx, sy, angle, facingDeg, arcDeg, range, tx, ty)`,
`tileCenter`, `toTile`. Client-Vorhersage und Server nutzen dieselben Funktionen.
`isSolid` auf der Plattform: `L` ist solid, solange `away.sonde.disabled === false`.

## 5. Protokoll (`shared/protocol.js`)

JSON über WebSocket `/ws`. Jede Nachricht `{ t: <typ>, ... }`.

### 5.1 Client → Server
| t | Felder | Bedeutung |
|---|---|---|
| `hello` | `clientId, name, color` (0–2 oder null) | Beitritt/Reconnect. Farbe belegt? Server vergibt freie. |
| `ready` | `ready: bool` | Lobby: bereit. Start, sobald alle verbundenen Spieler bereit sind. |
| `input` | `seq, mx, my` (−1…1) | Laufen (Schiff/Plattform), ~30 Hz solange ≠ 0, plus einmal 0 beim Loslassen. Ignoriert, solange in Konsole. |
| `act` | `down: bool` | Interaktionstaste E gedrückt/losgelassen. |
| `shoot` | `angle` | Blaster (nur Außenmission). |
| `mark` | `x, y` | Markierung für Orbit-Unterstützung (Plattform-px). |
| `drop` | – | Getragenen Gegenstand ablegen. |
| `leave` | – | Konsole verlassen. |
| `cmd` | `c, ...` | Konsolenbefehl, siehe 5.2. Server prüft, ob der Spieler an der passenden Konsole ist. |
| `ping` | `ts` | → `pong {ts}` |
| `debug` | `cmd, ...` | nur Debug-Server: `stage {stage}`, `damage {system, state}`, `fire {x,y}`, `breach`, `spawn {kind}`, `marks {n}`, `hull {n}`, `skip` (aktuelle Stage-Ziele erfüllen), `god {on}` |

### 5.2 Konsolenbefehle (`cmd.c`)
| Konsole | c | Felder | Wirkung |
|---|---|---|---|
| helm | `helm.input` | `turn, thrust` (−1…1) | Lenken/Schub (bei Änderung + 10 Hz solange ≠ 0) |
| helm | `helm.dodge` | `dir` (−1 Backbord, +1 Steuerbord) | Ausweichrolle, Cooldown |
| helm | `helm.jump` | – | Faltsprung, wenn `ship.jump.ready` |
| captain | `captain.accept` | – | Funkspruch annehmen |
| captain | `captain.choice` | `option` | Entscheidung wählen |
| captain | `captain.selectDest` | `dest`: `b7` \| `hafen` | Sprungziel |
| captain | `captain.power` | `sys, delta` (±1) | Energie verteilen |
| captain | `captain.shield` | `sector` (0–3), `delta` | Schildpunkte verschieben |
| captain | `captain.priority` | `target`: System-ID \| `fire` \| `breach` \| null | Priorität für Bots |
| captain | `captain.scan` | `on: bool` | Boje scannen (halten) |
| captain | `captain.support` | `kind`: `sensor` \| `kuppel` | Orbit-Hilfe |
| captain | `captain.listen` | – | neuen Funkspruch (Teaser) abhören |
| weapons | `weapons.target` | `id` \| null | Ziel wählen |
| weapons | `weapons.fire` | `mount`: `lanze` \| `bolzen` \| `seitenturm` | feuern (nur wenn geladen + Ziel im Bogen) |
| weapons | `weapons.reload` | – | Bolzen nachladen (verbraucht Inventar) |
| weapons | `weapons.strike` | – | Orbitalschlag auf `away.marker` |
| transfer | `transfer.down` | – | alle Spieler auf Schiffs-Pads runterbeamen |
| transfer | `transfer.up` | – | alle Außenteam-Spieler auf Plattform-Pads (+ Techniker/Datenkern dort) hochbeamen |
| transfer | `transfer.recall` | `pid` | Notrückholung eines Spielers |
| transfer | `transfer.supply` | – | Medipack zur Markierung beamen (−1 medipack) |
| shop | `shop.buy` | `item` | kaufen (gear gilt für den Käufer) |
| quartier | `deco.place` | `slot, item` | Deko aus Inventar in eigenen Slot setzen (`item: null` = entfernen, zurück ins Inventar) |
| sonde | `sonde.input` | `color` | Codefarbe eingeben |

Ungültige Befehle: Server ignoriert und schickt `event notice {pid, text}` mit Grund (z. B.
„Nicht genug Marken“, „Ziel außerhalb des Feuerbogens“).

### 5.3 Server → Client
- `welcome { pid, serverVersion, debug: bool }`
- `full { text }` – Server voll (3 Spieler).
- `pong { ts }`
- `event { kind, ... }` mit `kind`:
  `oda {text}` (Bordintelligenz, Tutorial/Hinweise) · `radio {from, text}` · `notice {pid, text}` ·
  `sfx {name, zone?, x?, y?}` · `hit {sector, shield: bool, dmg}` · `explosion {x, y}` ·
  `beam {pids, dir: 'down'|'up'}` · `jump {scene}` · `repairDone {system}` · `alarm {level}` ·
  `stage {stage}` · `emergency {}` · `strike {x, y}` · `codeResult {ok}`
- `snap` – vollständiger Zustand, 15 Hz, an alle gleich:

```js
{
  t: 'snap', tick, time,                 // time = Sekunden seit Serverstart der Partie
  phase: 'lobby' | 'play' | 'end',
  players: [{ id, name, color, ready, connected,
    zone: 'ship' | 'away', x, y, dir: 'up'|'down'|'left'|'right', moving,
    console: null | 'helm'|'captain'|'weapons'|'transfer'|'shop'|'quartier'|'sonde',
    carry: null | itemId, hp, downed, downedFor,
    action: null | { kind: 'repair'|'extinguish'|'patch'|'revive'|'beam', progress: 0..1 },
    gear: { werkzeuggurt: bool }, lastSeq }],
  bots: [{ id, variant, x, y, dir, moving, carry, task: null | { kind, x, y }, progress }],
  ship: {
    scene: 'port'|'route'|'buoy', docked, x, y, angle, vx, vy, speed,
    hull, hullMax, o2, alert: 'normal'|'yellow'|'red',
    helm: { turn, thrust, manned },
    power: { engines, shields, weapons, life }, reactor: { output, used },
    heat: { engines, shields, weapons, life },
    shields: { pool, alloc: [4], current: [4] },
    systems: { reactor, engines, shields, weapons, life, transfer },   // je 'ok'|'damaged'|'broken'
    fires: [[tx, ty], ...], breaches: [{ tx, ty }], groundItems: [{ id, kind, x, y }],
    dodgeCd, jump: { dest: null|'b7'|'hafen', charge: 0..1, ready, blockedReason },
    mounts: [{ id: 'lanze'|'bolzen'|'seitenturm', facing, arc, range, charge: 0..1, ammo?, loaded? }],
    target: null | enemyId, priority: null | string,
    scan: { progress: 0..1, done }
  },
  space: { w, h,
    enemies: [{ id, kind: 'raider'|'gunboat'|'relay', x, y, angle, hp, hpMax }],
    projectiles: [{ id, kind: 'enemy'|'bolzen', x, y, angle }],
    beams: [{ x1, y1, x2, y2, ttl, kind: 'lanze'|'seitenturm' }],
    asteroids: [{ id, x, y, r, seed }],
    markers: [{ kind: 'station'|'exit'|'buoy'|'dock'|'vaelen', x, y, r }],
    salvage: [{ id, x, y, kind }] },          // QA-Ergänzung: Bergungsgut (nur Szene route)
  away: { active,
    drones: [{ id, x, y, hp, dir, revealed, alive }],
    projectiles: [{ id, kind: 'blaster'|'drone', x, y, angle }],
    npc: { x, y, dir, following: null|pid, rescued, present, injured },   // injured: braucht Medipack (tragen + E, oder Nachschub ≤ 48 px)
    items: [{ id, kind: 'datenkern'|'medipack', x, y }],
    marker: null | { x, y }, strikes: [{ x, y, t }],
    sonde: { disabled, symbols: [3], entered: [], lockout },
    codeTable: { kreis: 'mint', ... },          // Anzeige NUR an der Captain-Konsole (bzw. Sonde nach ODA-Hilfe)
    odaCodeHelp: bool, kuppelUntil, sensorUntil, doorOpen, coreRebooted },
  support: { sensor: cd, strike: cd, supply: cd, recall: cd, kuppel: cd },   // Restsekunden
  inventory: { ersatzteil, loeschgel, loeschgelCharges, flickblech, bolzen, medipack, marks, deko: [itemId] },
  upgrades: { seitenturm, schildpool, schrauber3 },
  deco: { q0a: null|itemId, ... },
  mission: { stage, objectives: [{ id, text, done, optional }],
    radio: null | { from, text, needsAccept },
    choice: null | { id, prompt, options: [{ id, label, disabled }] },
    teaser: null | { status: 'pending'|'ready', source: 'claude'|'archiv', title, from, briefing, reward },
    flags: { bribed, decision, technikerRescued } },
  stats: { elapsed, kills, repairs, firesOut, hits, emergencies, playTimeStart },
  errors
}
```
Snapshotgröße im Blick behalten (Ziel < 12 KB). Asteroiden sind statisch: Server darf sie nur in
jedem 15. Snapshot und beim Szenenwechsel mitsenden (sonst `asteroids` weglassen → Client behält die letzte Liste).

## 6. Regeln (Server setzt um, Werte in `CONFIG`)

**Spieler:** 96 px/s, HP 100. HP 0 → `downed`. Wiederbeleben: Mitspieler hält E 3 s. Sonst nach
15 s automatisch: an Bord an Ort und Stelle, Außenteam → hochgebeamt, falls Transfer nicht
`broken`, sonst Respawn auf den Plattform-Pads. Nach Wiederbeleben HP 50.

**Energie:** Reaktor liefert 8 (damaged 6, broken 3). Captain verteilt auf engines, shields,
weapons, life (je 0–4, Summe ≤ Reaktor; sinkt der Reaktor, reduziert der Server von oben).
Stufe 4 erzeugt Hitze (+8/s, sonst −4/s); bei 100 → System `damaged`, Hitze 0.
Antrieb: maxSpeed × [0, .5, .8, 1, 1.15][power] × (damaged .5 / broken .2).
Waffen: Ladezeit × [∞, 1.6, 1, .8, .65][power] × (damaged 1.5 / broken: lädt nicht).
Lebenserhaltung: power 0 oder broken → O₂ −1/s; sonst +2/s bis 100 (Lecks −0,5/s je Leck).
O₂ = 0 → Spieler an Bord −2 HP/s.

**Schilde:** Pool = power.shields × 2 (+2 mit Upgrade `schildpool`). `alloc[i]` 0–4, Summe ≤ Pool.
`current[i]` lädt alle 4 s um 1 Richtung `alloc[i]` (Generator damaged: 8 s; broken: alles 0).
Treffer in Sektor i: `current[i] > 0` → −dmg Punkte (`hit {shield:true}`); sonst Hülle −5×dmg
und Folgen im Schiffsbereich des Sektors (`SECTOR_REGIONS`): 35 % Systemschaden (ok→damaged→broken)
an einem System des Bereichs (40 % davon springen auf ein System eines Nachbarbereichs über; dasselbe System
frühestens nach 12 s erneut – QA-Balance, `CONFIG.hitEffects`), 30 % Feuer auf zufälliger Bodenkachel des Bereichs, 15 % Hüllenbruch
an wandnaher Bodenkachel des Bereichs.

Ohne Gegner und ohne Lecks flicken die Schrauber die Außenhaut: +0,4 Hülle/s bis 70 (`CONFIG.ship.hullRegen`).

**Hülle 0 → Notfallprotokoll** (`event emergency`): Hülle 30, alle Feuer aus, Gegner ziehen sich
30 s auf Abstand zurück, −50 Marken, `stats.emergencies++`. Kein Game Over.

**Waffen:** Mounts laut `CONFIG.weapons`. Feuern nur mit Ziel im Bogen (`inArc`) und `charge = 1`.
Lanze: Sofortstrahl. Bolzen: Projektil (leicht zielsuchend), Magazin 2, `weapons.reload` nimmt 1
aus `inventory.bolzen` (4 s). Seitenturm nur mit Upgrade. **Unbesetzte Waffenkonsole:** Lanze feuert
automatisch auf das nächste Ziel im Bogen mit 50 % Schaden; Bolzen nicht.
**Unbesetzte Steuer:** ODA hält Kurs und Geschwindigkeit (kein Abbremsen, kein Ausweichen).
**Unbesetzte Captain-Konsole:** Energie/Schilde bleiben wie zuletzt eingestellt.

**Gegner:** Jäger (`raider`) kreist in ~250 px um das Schiff, schießt in Reichweite. Kanonenboot
(`gunboat`) hält ~380 px Abstand und versucht, das Schiff auf einer Seite zu halten (Breitseite).
Projektile treffen bei Abstand < 40 px zum Schiff; Sektor über `sectorOf` aus der Projektilposition.
Asteroiden: Kollision (Schiffsradius 36) → 1 Schaden auf den Sektor, Abprall, 1 s Immunität je Brocken.

**Schäden an Bord:** Feuer breitet sich alle 6 s mit 35 % auf eine Nachbar-Bodenkachel aus (max. 12),
beschädigt alle 10 s ein angrenzendes System, Spieler auf Feuer −5 HP/s. Löschen: `loeschgel`
tragen, E halten 1,5 s an Feuer (Blickrichtung/Nachbar oder eigene Kachel), 5 Ladungen je Gel.
Hüllenbruch: Hülle −0,5/s, O₂ −0,5/s, zieht Spieler im Radius 4 Kacheln mit 20 px/s an.
Flicken: `flickblech` tragen, E halten 3 s (verbraucht). Reparieren: damaged→ok E halten 4 s;
broken→damaged braucht ein getragenes `ersatzteil` (verbraucht) + 5 s; Werkzeuggürtel ×0,7.
Alarmstufe: red bei Gegnern in der Szene oder Hülle < 40 oder O₂ < 50; yellow bei Feuer/Leck/
broken System; sonst normal.

**Schrauber (Bots):** 2 (3 mit Upgrade). Nur Reparatur, Löschen (eingebaut, ohne Gel, 2,5 s),
Flicken, Teile holen. Nie Konsolen. 60 % Spielertempo, Reparaturzeit ×1,75. Wegfindung BFS auf
Kacheln. Aufgabenwahl: Captain-Priorität > broken System > Feuer > Leck > damaged System;
nie zwei Bots am selben Ziel. Braucht die Aufgabe ein Teil (`ersatzteil`/`flickblech`), holt der
Bot es aus dem Regal (Inventar −1); ist keins da, überspringt er die Aufgabe. Ohne Aufgabe: zurück
zur Spawnkachel, idle. Bots gehen nie auf die Plattform.

**Transfer:** Beamen nur, wenn System `transfer` ≠ broken, Schiff in Szene `buoy`, ≤ 320 px von der
Boje, Geschwindigkeit ≤ 30. Dauer 3 s (damaged 6 s), währenddessen Schilde `current` = 0 (Sektoren
öffnen sich kurz). Runter: Spieler auf Schiffs-Pads → Plattform-Pads. Hoch: Außenteam-Spieler auf
Plattform-Pads (+ folgender Techniker in ≤ 2 Kacheln, + Datenkern, wenn getragen oder auf Pad).
Bedienung über Konsole `transfer` oder **Selbst-Transfer**: auf Pad E halten (3 s), auch solo.

**Außenmission (Plattform):** Blaster (Leertaste/Klick) 2 Schaden, Cooldown 0,35 s. 4 Drohnen, je
6 HP, patrouillieren, verfolgen in 160 px, schießen (8 Schaden). Techniker `N`: E → folgt dem
Spieler (E erneut = warten). Sonde `Z`: Konsole `sonde` zeigt 3 Symbole; richtige Farbreihenfolge
laut `codeTable` eingeben → Sonde aus, **alle Drohnen abgeschaltet**, Tür `L` offen. Falsche
Farbe → 10 s Sperre, Drohnen alarmiert. Ist **kein Mensch an Bord**, zeigt die Sonde nach 20 s die
Codetabelle selbst (`odaCodeHelp`, ODA-Hilfe). Datenkern `Q`: aufheben, tragen.

**Orbit-Unterstützung (nur mit Außenteam unten):**
- Captain `sensor`: Drohnen 10 s für das Außenteam sichtbar (Minimap + durch Wände), Cd 30 s.
- Captain `kuppel`: Außenteam bekommt 20 s lang einen Schild (40 Schaden), Schiff verliert solange
  2 Punkte Schildpool. Cd 45 s.
- Captain: Codetabelle lesen (Code knacken) – rein Anzeige.
- Waffen `strike`: nach 1,5 s Treffer am Marker, Radius 80 px, 10 Schaden; verbraucht die Lanzen-
  Ladung, Schiff ≤ 30 px/s. Cd 40 s.
- Transfer `supply`: Medipack (Bodengegenstand, heilt 50 beim Aufheben) am Marker, −1 Inventar. Cd 15 s.
- Transfer `recall {pid}`: Spieler sofort hoch (Transfer ≠ broken). Cd 60 s.

**Wirtschaft/Shop:** Start 150 Marken, Inventar laut `CONFIG.economy`. Shop nur `docked`
(Szene `port`). Jäger zerstört +20, Kanonenboot +60. Deko liegt im Inventar und wird über die
eigene Koje (`quartier`) in einen der 2 Slots gesetzt.

## 7. Mission „Die stumme Boje“ (Stage-Maschine, `server/sim/mission.js`)

Jede Stage setzt `mission.objectives` (deutsche Texte) und schickt `event stage`. ODA-Texte sind
kurz (≤ 120 Zeichen), führen die Spieler und erklären Tasten beim ersten Mal.

| Stage | Ziele (Text) | Weiter wenn | Server-Skript |
|---|---|---|---|
| `dock` | „Übung: Löschgel holen, Kabelbrand löschen“, „Übung: Ersatzteil holen, Transfer reparieren“, dann „Brücke: Captain-Konsole betreten (E)“, „Funkspruch annehmen“ | `captain.accept` | Start in `port`, angedockt. ODA-Tutorial (Laufen WASD, E, Esc, Lager, Tragen, Löschen, Reparieren): Kabelbrand in der Messe (breitet sich im Hafen nicht aus), Transfer `broken`; Bots machen „Hafen-Check“ (helfen nicht). Funkspruch Tesk erst nach der Übung, spätestens nach 150 s (`CONFIG.drill`). Shop offen. |
| `undock` | „Steuer: ablegen (W)“, „Captain: Ziel Boje B-7 wählen“, „Steuer: Faltsprung (F)“ | Sprung | Abdocken bei Schub. Sprung lädt 8 s, sobald Ziel gewählt und ≥ 300 px von der Station. Ziel `b7` → Szene `route`. |
| `route` | „Bergungsgut im Feld einsammeln (n/3)“, „Durchs Asteroidenfeld zum Sprungpunkt“ | Schiff im Exit-Radius + Bergungsgut (oder > 150 s) | 38 Asteroiden (seeded), Exit rechts. 3 Bergungskisten abseits der Linie (`space.salvage`, drüberfliegen: Ersatzteil, Flickblech, 40 Marken; `CONFIG.salvage`). Bei x > 1500: Funkspruch Grauzahn („Die Boje gehört uns.“). |
| `grauzahn` | „Captain: auf Grauzahn antworten“, „Steuer: Faltsprung (F)“ | Wahl + Sprung | `choice`: `bribe` „Bestechen (100 Marken)“ (disabled ohne Marken) / `fight` „Kämpfen“. Sprung erst nach Wahl. → Szene `buoy`. |
| `combat` | „Rostmeute abwehren“ (+ Hinweise) | alle Gegner zerstört | fight: 2 Jäger, nach Zerstörung oder 50 s Kanonenboot. bribe: 1 Jäger. **Garantien:** spätestens 40 s nach Kampfbeginn ein Feuer an Bord; beim Auftauchen des Kanonenboots Schildgenerator `broken` (bribe: nach 25 s); bei 50 % Boot-HP ein Hüllenbruch Backbord. |
| `scan` | „Zur Boje fliegen“, „Waffen: Störrelais abschießen (n/3)“, „Captain: Boje scannen (halten)“ | Scan fertig | 3 Störrelais (`enemies` kind `relay`, 2 HP, schießen nicht, kreisen um die Boje) blockieren den Scan. Scan nur ≤ 420 px, 5 s halten (Client erneuert `captain.scan` alle 0,3 s). Danach ODA: Kustoden-Signatur, Lebenszeichen. Teaser-Generierung starten (§8). |
| `away` | „Außenteam auf die Pads, Transfer auslösen“, dann „Sonde abschalten“, „Bojenkern neu starten (E halten)“, „Datenkern bergen“, „Techniker retten“ (optional), „Alle zurück an Bord“ | Datenkern an Bord + Bojenkern neu gestartet + kein Spieler mehr unten | 90 s nach dem ersten Runterbeamen: Nachzügler-Jäger in `buoy`; sein erster Hüllentreffer setzt Transfer `broken` (Garantie). Techniker an Bord: +50 Marken, Flag. Bojenkern `b` (nach der Sonde, E 5 s): +40 Marken, Funk Tesk, weckt 2 alarmierte Wächter-Drohnen (`CONFIG.awayExtra.guardSpawns`). |
| `decision` | „Captain: über den Datenkern entscheiden“ | Wahl | `choice`: `deliver` „Ans Konkordat (+200)“ / `decode` „Selbst entschlüsseln (+80, Spur zu den Kustoden)“. |
| `return` | „Nachhut der Rostmeute abwehren“, „Captain: Ziel Hafen wählen“, „Steuer: Faltsprung (F)“ | Sprung | Nach 6 s Jäger von achtern (solo 1, sonst 2; auch nach Bestechung); Sprung blockiert, bis sie weg sind. Danach optionaler Notruf: Vaelen-Händlerin Sela (Marker `vaelen`), langsam längsseits = +40 Marken + Messinglampe (`CONFIG.mission.vaelen`). Ziel `hafen` → Szene `port`, Ankunft **nicht** angedockt. |
| `port` | „Steuer: am Liegeplatz andocken (langsam!)“, dann „Hafenterminal: einkaufen (optional)“, „Quartier einrichten (optional)“, „Captain: neuen Funkspruch abhören“ | `captain.listen` | Andocken: ≤ 70 px vom Liegeplatz (Marker `dock`) und ≤ 25 px/s (`CONFIG.flight.dockDist/dockSpeed`). Teaser als `radio` mit Quelle, erst nach dem Andocken. |
| `end` | – | – | `phase = 'end'`: Client zeigt „Ende der Demo“ mit `stats` und Teaser-Titel; Weiterspielen (Laufen, Shop) bleibt möglich. |

Inhaltsdichte: Jede Stage hat ODA-Kommentare zu Ereignissen (erstes Feuer, erstes Leck, erster
broken-Schaden, Schilde unten, Bot repariert etwas, Jäger im Bogen). Zeitstempel je Stage in
`stats` mitführen, damit die QA die Dauer pro Abschnitt misst.

## 8. Claude-Bridge (Teaser-Mission, `server/mission/generator.js`)

- `.env`: `MISSION_SOURCE=fallback|bridge` (Default `fallback`), `CLAUDE_BRIDGE_URL`
  (Default `http://localhost:5505`), `CLAUDE_BRIDGE_TOKEN`, `CLAUDE_MAX_BUDGET_USD` (Default `0.30`,
  Budget pro Session noch offen `[€__]`). Token nie an Clients, nie loggen.
- Aufruf `POST {URL}/v1/run`, `Authorization: Bearer <token>`, Body
  `{ args: ["-p","--output-format","json","--json-schema",<schema>,"--model","sonnet","--no-session-persistence","--max-budget-usd",<budget>], prompt, timeoutMs: 90000 }`
  (Antwort `{stdout, stderr, exitCode}`; `stdout` ist CLI-JSON, die validierte Ausgabe steht in
  `structured_output`, sonst `result` als JSON parsen). Kein `--tools ""` (Windows-Shim verliert leere Argumente).
- Schema (kompakt): `{ title ≤60, from ≤40, briefing ≤500, reward 50–500 int, hook ≤200 }`.
  Prompt: Setting (Saumraum, Konkordat, Rostmeute, Vaelen, Kustoden), Ton, Flags der Crew
  (bestochen/gekämpft, Datenkern-Entscheidung, Techniker gerettet), Bitte um eine Folgemission.
  Spielertexte (Namen) gehen nicht in den Prompt.
- Validieren (`shared/schema.js`), klemmen; Fehler/Timeout → `server/mission/fallback.json`
  (6 Missionen mit `requires`-Flags, beste Übereinstimmung). Nur ein Aufruf gleichzeitig.
- `mission.teaser.status` `pending` → `ready`, `source` `claude`|`archiv`. Im Demo-Umfang ist der
  Teaser **nur Text** (nicht spielbar) – das ist ehrlich so zu benennen.

## 9. Client-Ansichten (Team CLIENT)

- **Lobby:** Name (max. 12 Zeichen), Farbe 0–2 (belegte grau), Liste der Verbundenen, „Bereit“.
  Hinweis „Klick/Taste aktiviert Ton“. Join während laufender Partie möglich (direkt ins Spiel).
- **Innenraum/Plattform:** Kamera folgt der eigenen Figur (an Kartenrand geklemmt), y-sortierte
  Objekte/Figuren, Fenster mit Parallax-Sternen an Außenwänden (optional). Eigene Figur per
  Vorhersage (Inputs mit `seq`, Abgleich mit `lastSeq`), Fremde interpoliert (100 ms).
- **HUD:** Alarmlampe + Stufe oben links, darunter Ziele (Stage-Objectives), Systemicons mit
  Zustand oben rechts, Hülle/O₂/Schilde-Mini, Mini-Schiffsplan unten rechts mit Spielerpunkten
  (Farbe + Form), ODA-Box unten mitte (Schreibmaschinen-Effekt, Warteschlange), Tastenhinweis
  „E“ über interaktiven Dingen in Reichweite, Halte-Fortschrittsring, getragener Gegenstand,
  Randpfeile zu Feuer/Leck/broken-System außerhalb des Bildes. Außenteam: HP, Schiffsstatus-Mini
  (Hülle, Schilde, Alarm), Marker-Hinweis „Q: Markierung setzen“.
- **Konsolen** (Overlay über dem Spielbild, Esc schließt):
  - *Steuer:* Taktikansicht, Schiff mittig, Radar-Gitter, Asteroiden, Gegner, Marker (Station,
    Exit, Boje), Schildbögen je Sektor (Stärke), Tempo/Kurs-Anzeige, Sprungladung. A/D lenken,
    W/S Schub, Shift+A/D Ausweichen, F Sprung.
  - *Captain:* Tabs „Funk“, „Karte“, „Energie & Schilde“, „Schäden“, „Außenteam“ (nur aktiv
    während Außenmission). Tastatur + Maus. Funk: Funkspruch/Entscheidung/Teaser. Karte: Ziele
    `b7`/`hafen`, Scan (Leertaste halten). Energie: 4 Balken ±, Schildsektoren um ein Schiffssymbol ±.
    Schäden: Systemliste mit Zustand, Feuer/Lecks mit Raum, Priorität für Bots setzen.
    Außenteam: Codetabelle (Symbol → Farbe), Sensor, Kuppel, HP des Teams, Cooldowns.
  - *Waffen:* Taktikansicht mit Feuerbögen (Kegel, Ziel im Bogen = Bernstein-Kante),
    Ladebalken, Bolzen-Magazin/Vorrat. T/Klick Ziel, 1 Lanze, 2 Bolzen, 3 Seitenturm, R Nachladen,
    O Orbitalschlag (nur Außenmission, zeigt Plattform-Minikarte mit Marker).
  - *Transfer:* Pads-Belegung, Außenteam-Liste mit HP, Buttons Runter/Hoch/Nachschub/Notrückholung,
    Hinweis, warum gesperrt (zu schnell, zu weit, System kaputt).
  - *Shop:* Liste aus `CONFIG.shop` mit Preis, Marken, Kaufen.
  - *Quartier:* 2 Slots, Deko aus dem Inventar wählen.
  - *Sonde:* 3 Symbole, 6 Farbtasten (1–6, mit Farbnamen als Text, nicht nur Farbe), Sperr-Timer,
    ggf. ODA-Codetabelle.
- **Ende:** Overlay „Ende der Demo“, Spielzeit, Abschüsse, Reparaturen, gelöschte Feuer,
  Notfälle, Teaser-Titel + Quelle, „Weiter erkunden“.
- **Tasten:** WASD/Pfeile laufen, E interagieren (halten), Esc Konsole verlassen, G ablegen,
  Leertaste/Linksklick Blaster (Plattform), Q Markierung (Plattform, an Mausposition), Tab
  Crew/Status. Steuerung in jeder Konsole unten als Zeile eingeblendet.
- `?mock=1`: `dev-mock.js` erzeugt lokale Snapshots (alle Stages/Konsolen ansteuerbar) – zum
  Entwickeln ohne Server. Im Normalbetrieb inaktiv.

## 10. Art-API (`public/js/art.js`, globales `Art`)

Alles prozedural, gecacht in Offscreen-Canvases, Palette aus dem Art-Konzept (siehe §12). Alle
Funktionen zeichnen in Kontext-Pixeln der internen Auflösung (1 px = 1 Pixel-Art-Pixel).
Unbekannte `kind` → sichtbarer Platzhalter (Magenta-Rahmen), kein Fehler.

```js
Art.TILE = 32
Art.init()                                  // baut Caches; idempotent; true bei Erfolg
Art.palette                                 // { name: '#hex' }
Art.drawTile(ctx, ch, px, py, env)          // Boden/Wand/Tür/Pad/Leere für Kartenzeichen ch an Pixel px,py (oben links).
                                            // env = { map, tx, ty, time, alert, doorOpen } – map.at(x,y) für Nachbarn (Wandkanten, 3/4-Ansicht)
Art.drawObject(ctx, kind, px, py, opts)     // Objekte auf Kachel (px,py = oben links der Kachel; darf nach oben überstehen).
  // kind: 'console_helm'|'console_captain'|'console_weapons'|'console_transfer'|'terminal_shop'|
  //       'shelf' (opts.item)|'bed' (opts.color)|'sys_reactor'|'sys_engines'|'sys_shields'|'sys_weapons'|
  //       'sys_transfer'|'sys_life'|'table'|'plant'|'crate'|'buoy_core'|'sonde'|'door_locked'|
  //       'deco_pflanze'|'deco_poster'|'deco_lampe'|'deco_teppich'
  // opts: { time, state: 'ok'|'damaged'|'broken', active (Konsole besetzt), alert, disabled, open }
Art.drawCharacter(ctx, x, y, opts)          // x,y = Füße. opts: { color 0..2, dir, moving, time, action: null|'repair'|'console'|'carry',
                                            //   carry: itemId|null, downed, beam: 0..1 (Auflösen/Erscheinen), flash }
Art.drawBot(ctx, x, y, opts)                // Schrauber. opts: { variant 0..2, dir, moving, working, time, carry }
Art.drawNpc(ctx, x, y, opts)                // Techniker. opts: { dir, moving, time }
Art.drawDrone(ctx, x, y, opts)              // Kustoden-Drohne. opts: { time, alive, revealed, hit }
Art.drawItem(ctx, kind, x, y, opts)         // 16×16-Icon zentriert: ersatzteil|loeschgel|flickblech|bolzen|medipack|datenkern
Art.drawFx(ctx, kind, x, y, t, opts)        // 'fire'|'breach'|'sparks'|'smoke'|'beam'|'strike'|'explosion'|'muzzle'|'repair'|'heal'; t = Sekunden seit Start
Art.drawShip(ctx, x, y, angle, opts)        // Lerche top-down (wie concept/tactical.svg), Länge ≈ 72 px.
                                            //   opts: { thrust 0..1, shields: [4] current, shieldMax: 4, hitSector, hitT, time }
Art.drawEnemy(ctx, kind, x, y, angle, opts) // 'raider' (≈ 28 px) | 'gunboat' (≈ 64 px). opts: { hpFrac, hitT, time }
Art.drawAsteroid(ctx, x, y, r, seed)
Art.drawStation(ctx, kind, x, y, opts)      // 'port' (Hafenstation) | 'buoy' (Bojenplattform). opts: { time }
Art.drawProjectile(ctx, kind, x, y, angle, t) // 'enemy'|'bolzen'|'blaster'|'drone'
Art.drawBeam(ctx, x1, y1, x2, y2, kind, ttl)  // 'lanze'|'seitenturm'
Art.drawStarfield(ctx, camX, camY, w, h, t) // Parallax-Sterne
Art.drawText(ctx, text, x, y, opts)         // Pixelfont 5×7 mit ÄÖÜäöüß, Ziffern, Satzzeichen. opts: { color, scale 1|2, align 'left'|'center'|'right', shadow }
Art.measureText(text, scale)                // Breite in px
Art.drawPanel(ctx, x, y, w, h, opts)        // Konsolen-Rahmen „Instrumententafel“. opts: { style: 'screen'|'brass'|'plain', title }
Art.drawIcon(ctx, name, x, y, opts)         // 12×12 zentriert: reactor|engines|shields|weapons|life|transfer|fire|breach|o2|hull|marks|
                                            //   circle|triangle|diamond|kreis|dreieck|raute|stern|welle|kreuz|lock|arrow. opts: { color }
Art.drawOverlay(ctx, w, h, opts)            // Lichtstimmung: { alert: 'normal'|'yellow'|'red', time, dim }
```

`art-preview.html`: zeigt alle Kacheln, Objekte (alle Zustände), Figuren (alle Richtungen, Farben,
Aktionen, animiert), Bots, Drohne, Items, FX, Schiff/Gegner/Asteroiden/Stationen, Pixelfont mit
Umlauten, Panels, Icons, Overlay-Stufen – skaliert ×2/×3. Öffnet per Doppelklick (file://) und lädt
`/shared/maps.js` über relativen Pfad `../shared/maps.js`, um die Schiffskarte komplett gerendert zu zeigen.

## 11. Audio-API (`public/js/audio.js`, globales `GameAudio`)

WebAudio-Synthese, keine Samples, keine bekannten Melodien. Vor `init()` alles No-op.

```js
GameAudio.init()                 // bei erster Nutzereingabe; idempotent
GameAudio.play(name, opts)       // opts: { volume 0..1, pan -1..1 }
  // name: ui_click|ui_back|console_on|console_off|step|pickup|drop|repair_tick|repair_done|extinguish|patch|
  //       shield_hit|hull_hit|explosion_small|explosion_big|lanze|bolzen|seitenturm|dodge|jump_charge|jump|
  //       alarm_yellow|alarm_red|beam|oda_blip|radio|blaster|drone_shot|drone_die|code_ok|code_fail|buy|
  //       strike|error|emergency|bot_beep|heal|door
  //   M1 (CONTRACT-M1 §12): phase|scan_tick|scan_done|widescan|marker_set|overload_start|overload_warn|
  //       reactor_down|reactor_up|switch_hold|discovery|salvage|emp|pylon_down|trade|table_sit|lore
GameAudio.setLoop(name, on, opts) // name: 'fire'|'breach'|'engine'|'reactor_hum'; opts.volume
GameAudio.setMusic(mood)          // 'ship'|'explore'|'combat'|'port'|'mystery'|'none' – weiche Übergänge
                                  // M1: 'mystery' = Nebel/Relais/Wrack, schwebend, eigene Motive
GameAudio.setIntensity(x)         // 0..1, Kampfmusik-Stufe
GameAudio.setVolume(master)       // 0..1
GameAudio.mute(bool)
```
`audio-preview.html`: Buttons für alle Sounds, Loops, Musikstimmungen, Intensitätsregler.

## 12. Grafikvorgaben (Kurzfassung Art Direction)

Stilsäulen: heimeliges Schiff · lesbar vor schön · analoge Raumfahrt (Messing, Röhrenschirme,
Phosphor) · das Schiff lebt. 3/4-top-down, Licht von oben links, farbige dunkle Outlines (kein
reines Schwarz). Figur 24×40 px (steht auf einer Kachel, ragt 8 px in die Kachel dahinter).
Laufen 4 Richtungen × 4 Frames, Idle 2, Konsole 2, Reparieren 3, Beamen (Streifen-Auflösen in Mint).
Spieler unterscheidbar per Farbe UND Formsymbol (S1 Kreis, S2 Dreieck, S3 Raute).

Palette: Holzdeck #8A5A3B · Messing #C9974A · Terrakotta #B4573E · Hüllenstahl #2E3A4A ·
Paneelgrau #4F6178 · Paneel hell #8EA3B5 · Phosphor-Mint #7FE0C2 · Bernstein #FFC66B ·
Warngelb #F2C94C · Alarmrot #E0473C · Funke #FFF1B8 · Rauch #5A5560 · Tiefraum #0B0E1A ·
Nebel-Indigo #2A2350 · Sternenweiß #F4EEDC · Moosgrün #5E8C4A · Rostsand #C2703D · Eisblau #A9D6E5 ·
Haut #F1C7A0/#C68A5E/#7A4A2E · Spieler #56B4E9/#E69F00/#CC79A7.

Zustände: normal (warme Lichtinseln) · gelb (Wandleisten pulsieren 2 s, 8 % Gelb) · rot (35 %
dunkler, rotes Pulsieren 1 Hz). Schaden: damaged = Funken/Rauch, broken = Flammen/Rauchsäule/
Warnsymbol. Konsolen blinken immer leicht; besetzt = heller.

## 13. Abnahmekriterien (QA)

1. `npm install && npm start`, 3 Browserkontexte verbinden, Lobby → Spiel.
2. Komplette Mission solo **und** zu dritt ohne Debug-Befehle durchspielbar; gemessene Dauer je Stage.
3. Keine Softlocks (z. B. Ersatzteile alle verbraucht → Shop/Bots/Stage muss weiter möglich sein;
   Transfer kaputt und niemand an Bord → Selbst-Transfer nach Reparatur durch Bots möglich).
4. Ohne `art.js`/`audio.js` läuft das Spiel (Fallback). Ohne Bridge: Archiv-Teaser.
5. Reconnect funktioniert; vierter Spieler bekommt „Server voll“.
6. Fehlerzähler Client/Server nach einem Durchlauf = 0 (oder erklärt).
