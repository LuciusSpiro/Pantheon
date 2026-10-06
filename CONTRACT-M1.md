# CONTRACT-M1 – Brücke neu + offene Welt (Ausbaustufe 2, Meilenstein 1)

Ergänzt `CONTRACT.md` und `CONTRACT-M0.md` (beide gelten weiter, soweit hier nichts anderes steht).
Freigabe durch Kai am 2026-10-04 („M0 und dann M1 mit den Änderungen“), M1 ohne Sleipnir und ohne
Spielstände. Hosting bleibt `npm start` + Cloudflare-Quick-Tunnel, Raumcode aus M0 bleibt.
Nur kostenlose/eigene Assets. **Last niedrig halten:** keine Schlepp-/Transportaufgaben dazu.

Ziel der Version: ein Spieleabend von **30–45 min** (QA misst solo und zu dritt), danach
„Fortsetzung folgt“ – in M2 füllt Claude die Welt mit Entdeckungen und Missionen.

---

## 1. Kais Vorgaben (verbindlich) und Studio-Entscheidungen

Kai:
1. **Pilot sieht nur die Frontsicht.** Der **Taktik-Offizier** (bisher Waffen) hat die weite Taktikkarte,
   Waffen und **Scanner** und leitet den Piloten an.
2. **Marker** für den Piloten setzen Captain (**Mint**) und Taktik (**Bernstein**) – beide gleichzeitig sichtbar.
3. **Gegner scannen**: ihre Waffen (Feuerbögen) und Schilde sehen, um den Piloten anzuweisen.
4. **Startbewaffnung: 2 Phasenkanonen**, je 60° Feuerwinkel, eine nach vorn-links, eine nach vorn-rechts,
   20° Überlappung (Bögen −50°…+10° und −10°…+50° relativ zum Bug).
5. **Reaktor überladen**: 3 Minuten mehr Energie, danach Abschaltung. **Neustart zu zweit** (gedacht für
   ruhige Momente).
6. **4 einzelne Quartiere** mit mehr Gestaltungsoptionen.
7. **Messe mit Planungstisch**: wer sich setzt, sieht Karten bekannter Sektoren/Stationen/Planeten und kann
   mit den anderen einen Plan machen.
8. **Geleitete offene Welt**: klare Orte, Reisen zwischen ihnen, Missionen leiten zum Erkunden an,
   Neugier lohnt sich.

Studio (Kai sieht das morgen und kann es ändern):
- Der Bolzenwerfer am Heck ist nicht mehr Startausrüstung, sondern ein Shop-Upgrade (wie der Seitenturm).
  Orbitalschlag nutzt jetzt die Ladung einer Phasenkanone.
- Allein beim Reaktor-Neustart hält ein Schrauber den zweiten Schalter (Unterstützung, erlaubt).
- Das 4. Quartier ist das Gästequartier: Ist Techniker Ivo gerettet, wohnt er dort (NPC läuft herum).
- Andocken geht im Hafen **und** bei der Vaelen-Karawane; das Hafenterminal zeigt dort das Vaelen-Sortiment.
- Gegner haben eigene Schildsektoren (wie das eigene Schiff) – das macht Scannen und Pilotenanweisung spielrelevant.

## 2. Teams und Dateibesitz (parallel)

| Team | besitzt |
|---|---|
| **SERVER** | `server/**`, `tools/**`, `shared/config.js` (Schlüssel ergänzen/ändern erlaubt), `shared/protocol.js`, `shared/schema.js`, **neu** `shared/locations.js`, in `shared/maps.js` **nur** den neuen Abschnitt `WRECK_ROWS`/`wreck` (§9.4) |
| **CLIENT** | `public/index.html`, `public/js/{net,client,render,hud,consoles,dev-mock}.js` |
| **ART** | `public/js/art.js`, `public/art-preview.html` |
| **AUDIO** | `public/js/audio.js`, `public/audio-preview.html` |
| Studioleitung | `CONTRACT*.md`, `shared/maps.js` (Schiff ist fertig, s. §3), `shared/physics.js` |

Wer eine Datei nicht besitzt, fasst sie nicht an; Vertragsfragen in den Bericht. Feldnamen exakt wie hier.
Client und Art arbeiten gegen diesen Vertrag (Client mit `dev-mock.js`, bis der Server steht).
Screenshots: `shots/m1-server/`, `shots/m1-client/`, `shots/m1-art/`, `shots/m1-audio/`, QA `shots/m1-qa/`.

## 3. Schiff (fertig in `shared/maps.js`, BFS geprüft)

42×13 Kacheln. Maschinenraum x1–6 mit **Reaktorschaltern `y`** (A oben (2,1), B unten (3,11),
`REACTOR_SWITCHES`), Lager x8–12, Transfer x8–12 unten, **4 Quartiere** (`BEDS[0..3]` mit `room` und je
4 Deko-Slots), Gang y6, **Messe** x24–30 mit **Planungstisch `Y`** (2×2 bei x26–27, y3–4), Brücke x32–39:
`K` (33,1), Taktik `W` (36,3), Captain `C` (36,6), Steuer `H` (39,6). `SECTOR_REGIONS` angepasst.
Neue Legende: `y` reactor_switch (solid, interact `switch`), `Y` plan_table (solid, interact `console`,
console `plan`). Konsolen-ID der Taktik bleibt intern **`weapons`** (Anzeige „TAKTIK“).

## 4. Brücke

### 4.1 Steuer – Frontsicht
- Client zeichnet die Raumszene **gedreht**: Bug zeigt nach oben, Schiff im unteren Drittel mittig.
  Sichtweite nach vorn ≈ 700 px, seitlich ± 420 px (Welt-px), Zoom fest, hinten nur ≈ 120 px.
  Kein Rundumradar, keine Sternkarte. Im Nebel (`location.fog`) Sicht ×0,5 mit Nebel-Overlay.
- Sichtbar: Asteroiden, Gegner, Projektile, Stationen, Dock-/Exit-Ringe, **Marker** (Captain Mint,
  Taktik Bernstein: Raute im Raum + Randpfeil mit Entfernung, wenn außerhalb), eingehende Treffer als
  Blitz am Schildsektor, Tempo, Kurs, Sprungladung, kleine Schildanzeige.
- Steuerung wie bisher (A/D, W/S, Shift+A/D, F).

### 4.2 Taktik (Konsole `weapons`)
- **Weite Taktikkarte**: Standardzoom 0,35, Stufen 0,25/0,35/0,5/0,75. Zeigt alles in Sensorreichweite
  (`CONFIG.sensors.range` 1400 px, Nebel ×0,5), eigene Feuerbögen, Gegner mit Kennung.
- **Waffen**: Phasenkanonen `phase_l` / `phase_r` (Tasten 1/2, Leertaste = beide feuern, die bereit sind),
  optional `bolzen` (3) und `seitenturm` (4) nach Kauf. T/Klick Ziel. O Orbitalschlag (Außenmission).
- **Ziel-Scan** (S halten, Ziel nötig, Reichweite 800, 2 s): Gegner `scanned = true` → seine Feuerbögen und
  Schildsektoren werden sichtbar (bei Taktik und Captain). Auch Orte/Objekte scannbar (Pylonen, Relais, Wrack).
- **Weitscan** (W, Cooldown 20 s): Puls 1000 px, deckt **versteckte Objekte** im Radius dauerhaft auf
  (Verstecke, Leitbaken, Hohlräume im Wrack).
- **Marker** setzen: Rechtsklick auf die Karte (oder M = Marker auf Ziel), X löscht. Je ein Taktik-Marker.

### 4.3 Captain
- Tabs: **Funk** (Funksprüche, Entscheidungen, Missionen + Logbuch der Entdeckungen x/y), **Sternkarte**
  (Orte, Verbindungen, Sprungziel wählen, Plan-Pins vom Tisch sichtbar), **Lage** (lokale Karte der Szene
  wie Taktik, aber ohne Waffen; Linksklick setzt Captain-Marker, X löscht), **Energie & Schilde**
  (+ Knopf „Reaktor überladen“ mit Bestätigung), **Schäden**, **Außenteam**.
- Scan-Info gescannter Gegner ist auch hier sichtbar.

### 4.4 Unbesetzt
Steuer: ODA hält Kurs. Taktik: Phasenkanonen feuern automatisch mit 50 % auf das nächste Ziel im Bogen,
kein Scan, keine Marker. Captain: Einstellungen bleiben.

## 5. Kampf

- **Phasenkanonen** (`CONFIG.weapons.phase_l/phase_r`): facing −20° / +20°, arc 60°, range 560,
  damage 2, charge 2,0 s (Energie-/Zustandsfaktoren wie bisher), Sofortstrahl (Beam-Kind `phase`).
- **Gegner-Schilde**: jedes Gegnerschiff hat `shields: [bug, steuerbord, heck, backbord]` (aktuell) und
  `shieldsMax`. Treffer auf Sektor (aus Schussursprung relativ zum Gegner-Bug, `Shared_Physics.sectorOf`):
  Schildpunkte zuerst, dann Hülle. Regeneration 1 Punkt / 5 s je Sektor bis Max.
  Werte: Jäger `[2,1,0,1]`, Kanonenboot `[2,4,1,4]` (Breitseite stark, Heck schwach),
  Kustoden-Wächter `[3,3,3,3]`, Pylon `[4,0,0,0]` (nur Front geschützt – von der Seite angreifen).
- Gegner-Waffen als Daten: `weapons: [{ facing, arc, range }]` (Jäger vorn 40°; Kanonenboot je Breitseite
  90°; Wächter rundum 360° kurz). Im Snapshot nur, wenn `scanned`.
- **Kustoden-Wächter** (`sentinel`, neu): langsam, EMP-Schüsse – ein Treffer durch die Schilde setzt ein
  zufälliges System 12 s auf `offline` (zählt wie broken, repariert sich selbst) statt Hüllenschaden.
- Bestehende Regeln (eigene Schildsektoren, Schäden, Feuer, Lecks, Notfallprotokoll) bleiben.

## 6. Reaktor überladen und Neustart

- `captain.overload`: nur wenn Reaktor `online` und nicht broken. Reaktorleistung +4 für 180 s
  (`state: 'overload'`, `overloadLeft`). 30 s vorher ODA-Warnung, Alarm-Sound.
- Danach `state: 'offline'`: Leistung 2 (Notstrom), Energie wird von oben gekürzt (Lebenserhaltung zuletzt).
- **Neustart:** Beide Schalter `y` (A, B) gleichzeitig halten (E halten, je ein Spieler oder Schrauber),
  3 s gemeinsam → `online`. Lässt einer los, verfällt der Fortschritt. Hält ein Spieler einen Schalter und
  niemand den anderen, schickt der Server nach 3 s einen freien Schrauber zum anderen Schalter.
- Snapshot `ship.reactor = { state: 'online'|'overload'|'offline', output, used, overloadLeft, switches: { A: bool, B: bool }, restartProgress }`.

## 7. Quartiere

- 4 Räume laut `BEDS`. Konsole `quartier` an der eigenen Koje (Gästequartier: niemand).
- Gestaltung kostenlos: `floor`: `holz_hell` | `holz_dunkel` | `teppich_rot` | `teppich_blau` | `fliesen`;
  `wall`: `holz` | `paneel` | `tapete_gruen` | `tapete_creme`; `light`: `warm` | `mint` | `bernstein` | `aus`.
- 4 Deko-Slots je Quartier, Deko aus dem Inventar. Neue Deko: `buecherregal`, `aquarium`, `sessel`,
  `sternkarte`, `trophaee_boje` (Belohnung Mission 1), `kristalllampe` (nur Vaelen), dazu die alten
  (`pflanze`, `poster`, `lampe`, `teppich`). Deko blockiert nicht.
- Snapshot `quarters: { q0: { floor, wall, light }, … }`, `deco: { q0a: item|null, … }` (16 Slots).

## 8. Planungstisch (Messe)

- Konsole `plan` am Tisch `Y`, **nicht exklusiv** (bis zu 3 gleichzeitig). Figur sitzt (Art: Aktion `sit`).
- Ansicht: Sternkarte der bekannten Orte mit Infokarten (Art, bekannte Gefahren, gescannte Infos,
  Entdeckungen dort). Wahl eines Orts → Detailkarte: Szenenübersicht (Station/Asteroiden/Gegnerlager)
  bzw. bei bekannten Außenkarten die Kachelkarte (B-7-Plattform nach dem Scan, Wrack nach dem Scan).
- **Pins**: jeder Spieler setzt bis zu 5 Pins mit Label `ziel` | `gefahr` | `landeplatz` | `treffpunkt` |
  `frage`, Farbe = Spielerfarbe. Pins sind für alle am Tisch, in der Captain-Sternkarte und (für
  Außenkarten) im Außenteam-HUD sichtbar. Eigene Pins entfernbar.
- Snapshot `plan: { seated: [pid], pins: [{ id, owner, map: 'star'|<mapId>, x, y, label }] }`.

## 9. Offene Welt

### 9.1 Orte (`shared/locations.js`, Team SERVER) – Inhalt verbindlich
| id | Name | kind | Sternkarte x,y | Verbindungen | bekannt ab |
|---|---|---|---|---|---|
| `hafen` | Hafen Lichtkordon | port | 100,300 | splitter, vaelen | Start |
| `splitter` | Splittergürtel | asteroids | 260,220 | hafen, b7, wrack | Start |
| `b7` | Boje B-7 | buoy | 420,150 | splitter, nebel | Mission 1 angenommen |
| `vaelen` | Vaelen-Karawane | trader | 230,430 | hafen, nebel | Selas Notruf oder Erkunden |
| `wrack` | Wrack „Zaunkönig“ | wreck | 400,330 | splitter, nebel | Gerücht im Hafen / Erkunden |
| `nebel` | Graue Weite | nebula (fog) | 570,280 | b7, vaelen, wrack, relais* | Mission 2 / Erkunden |
| `relais` | Kustoden-Relais | relay | 730,230 | nebel* | Leitbake im Nebel gefunden |

\* Verbindung nebel–relais erst nach Fund der Leitbake (Weitscan im Nebel).
Unbekannte, aber verbundene Orte erscheinen als „Unbekanntes Signal ?“ und sind anfliegbar (Erkunden).
Jeder Ort hat eine Szene (Größe, Start, Station/Marker, Gegner-Regeln), 1–3 **versteckte Objekte** (nur per
Weitscan) und beim ersten Besuch eine kurze ODA-/Funk-Beschreibung. Erstbesuch und jeder Fund geben
Belohnung (Marken, Items, Deko) und einen Logbuch-Eintrag.

### 9.2 Reisen
`captain.selectDest {dest: locId}` (bekannt oder „unbekannt, aber verbunden“), Sprungladung wie bisher
(8 s), Steuer F. Ankunft in der Szene des Ziels. Andocken im Hafen und bei der Vaelen-Karawane
(Dock-Ring anfliegen, langsam) → `ship.dockedAt = 'hafen'|'vaelen'|null`; Shop nur angedockt.
Snapshot `world = { location, locations: [{ id, name, kind, x, y, known, visited, links: [ids], unknown, fog, desc, discoveries: {found, total} }] }`.

### 9.3 Missionen als Daten (Engine)
- Missionen sind **Datenobjekte** (`server/missions/*.js`): Schritte mit Zielen, Bedingungen und Aktionen
  (z. B. `atLocation`, `enemiesCleared`, `scanDone`, `itemAboard`, `flag`, `choiceMade`; Aktionen `radio`,
  `oda`, `spawn`, `choice`, `reveal`, `reward`, `setFlag`, Garantien mit Deadline). Die Engine führt sie aus.
  Ziel: M2 kann Claude-Missionen aus denselben Bausteinen erzeugen. Hart verdrahtete Stage-Logik entfernen
  bzw. in Daten überführen; `tools/sim-headless.js` spielt weiterhin komplett durch.
- **Mission 1 „Die stumme Boje“** wie bisher, aber über Orte: Hafen (Übung optional) → Splittergürtel
  (Bergung, Grauzahn) → B-7 (Kampf, Relais-Scan, Außenmission, Entscheidung) → zurück zum Hafen
  (Nachhut, Selas Notruf → **Vaelen bekannt**). Belohnung u. a. Deko `trophaee_boje`.
- **Mission 2 „Echo im Nebel“** (startet nach Mission 1 im Hafen, Funk Tesk bzw. Ivo):
  Graue Weite anfliegen (Nebel, Rostmeute-Hinterhalt 2 Jäger) → per Weitscan **Leitbake** finden und scannen
  → Relais wird bekannt → Relais: 3 **Pylonen** (nur Front geschützt – Taktik scannt, lotst Pilot an die
  Seite) + 1 **Kustoden-Wächter** → Relaiskern scannen (Captain, 6 s, in Reichweite) → Finale-Funkspruch,
  Logbuch, **Ende-Screen M1** („Fortsetzung folgt“) – Weiterspielen/Erkunden bleibt möglich.
- **Erkunden (optional, lohnt sich):** Wrack-Außenmission (§9.4), Vaelen-Handel (Kristalllampe, Bolzenwerfer
  günstiger), versteckte Verstecke (Splittergürtel 2, B-7 1, Nebel 1 Lore-Bake, Relais 1 Lore), ODA-Kommentare.
  Captain-Logbuch zeigt „Entdeckungen 3/9“.
- Missionsziele führen mit Orts-Hinweisen; nie mehr als ein Pflichtziel unklar.

### 9.4 Wrack „Zaunkönig“ (Außenmission, Team SERVER entwirft die Karte)
- Neue Karte `WRECK_ROWS` (~30×16) in `shared/maps.js` (nur dieser Abschnitt + `wreck`-Map-Export +
  `WRECK_LEGEND`, BFS in `check-maps.js`). Zerstörtes Frachtschiff, dunkel. Zeichen:
  `#` Wand, `.` Boden, `_` Gitter, `~` All, `P` Landepads (3), `h` Bergungscontainer (solid, E halten 2 s →
  Belohnung direkt ins Inventar, **kein Tragen**), `g` Logbuch-Terminal (solid, E → Lore + Logbuch),
  `a` Plünderer-Spawn (Boden; Gegner `scavenger`, wie Drohne, rostig), `V` dünne Wand (solid; nach
  **Weitscan aus dem Orbit** als „Hohlraum“ markiert → E halten 4 s → Boden; dahinter Belohnung),
  `x` Trümmer (solid). 3–4 Container, 1 Terminal, 1 Hohlraum, 2–3 Plünderer.
- Beamen wie auf B-7 (Szene `wrack`, Abstand/Tempo/Transfer-Regeln gleich). Orbit-Hilfen gelten.

## 10. Protokoll-Ergänzungen

Neue `cmd.c`:
| Konsole | c | Felder |
|---|---|---|
| captain | `captain.marker` | `x, y` (Welt-px der aktuellen Szene) oder `clear: true` |
| captain | `captain.overload` | – |
| captain | `captain.selectDest` | `dest`: Orts-ID (ersetzt `b7`/`hafen`) |
| weapons | `weapons.fire` | `mount`: `phase_l`\|`phase_r`\|`both`\|`bolzen`\|`seitenturm` |
| weapons | `weapons.scan` | `on: bool` (hält Ziel-Scan; Client erneuert alle 0,3 s) |
| weapons | `weapons.widescan` | – |
| weapons | `weapons.marker` | `x, y` oder `clear: true` |
| plan | `plan.pin` | `map, x, y, label` |
| plan | `plan.unpin` | `id` |
| quartier | `quartier.style` | `part`: `floor`\|`wall`\|`light`, `value` |

Interaktionen (E): `switch` (halten), `salvage` (`h`, halten 2 s), `lore` (`g`, tippen), `V` (halten 4 s,
nur wenn markiert). Plan-Konsole: E am Tisch, Esc steht auf.
Debug (nur `--debug`): `goto {loc}`, `reveal {loc}`, `mission {id, step}`, `reactor {state}`, `scanall`.

Snapshot-Ergänzungen (zusätzlich zu §5.3/M0):
```js
world: { location, locations: [...] },               // §9.2
ship: { …, dockedAt, reactor: {...},                 // §6
  markers: { captain: null|{x,y}, tactical: null|{x,y} },
  tscan: { targetId, progress },                      // Ziel-Scan der Taktik
  widescan: { cd, pulseAt },                          // pulseAt = Zeit des letzten Pulses (für Effekt)
  mounts: [{ id:'phase_l', facing:-20, arc:60, range, charge }, { id:'phase_r', … }, …] },
space: { …, enemies: [{ id, kind:'raider'|'gunboat'|'sentinel'|'pylon', x, y, angle, hp, hpMax,
            shields:[4], shieldsMax:[4], scanned, weapons: null|[{facing,arc,range}] }],
         hidden: [{ id, kind:'cache'|'beacon'|'lore'|'hollow', x, y, found }],   // nur aufgedeckte
         beams: [{ …, kind:'phase'|'seitenturm' }] },
away: { …, map: 'platform'|'wreck', salvage: [{ x, y, done }], hollow: { x, y, marked, open } },
ship.npcs: [{ id:'ivo', x, y, dir, moving }],
quarters: {...}, deco: {...}, plan: {...},
mission: { …, active: { id, title, objectives }, list: [{ id, title, state }], log: [{ id, text, loc }], discoveries: { found, total } },
shopContext: null|'hafen'|'vaelen'
```
Snapshotgröße bleibt < 12 KB (statische Ortsdaten nur alle 15 Snapshots oder bei Änderung).

## 11. Art-Ergänzungen (`art.js`)

- Kacheln/Objekte: `reactor_switch` (opts `held`, `reactorState`), `plan_table` (2×2 via `qx/qy`, `active`),
  Quartier-Stile: `drawTile` erhält `env.roomStyle = { floor, wall }` für Kacheln in Quartieren (alle Werte §7),
  `drawOverlay` mit `rooms: [{ x0,y0,x1,y1 (px), light }]` für Lichtfarbe je Quartier.
- Neue Deko (§7) als `deco_<id>`; `drawCharacter` Aktion `sit` (am Tisch).
- Wrack-Biom: Kacheln für `WRECK_LEGEND` (dunkel, beschädigt, flackerndes Notlicht), Objekte `salvage`
  (opts `done`), `lore_terminal`, `wall_weak` (opts `marked`, `open`), `debris`. Gegner `drawDrone` mit
  `opts.kind = 'scavenger'` (rostig, Greifarm).
- Raum: `drawStation` Kinds `vaelen` (Karawanenschiff), `wreck` (großes Wrack), `relay` (Kustoden-Relais);
  `drawEnemy` Kinds `sentinel` (kristallin, Leuchtring), `pylon` (Säule mit Schildfront); `drawBeam` Kind
  `phase` (zwei versetzte Strahlen bernstein-weiß); `drawItem` Kinds `cache`, `beacon`; Nebel:
  `drawStarfield(…, { fog: true })` + `drawOverlay` Option `fog`.
- Schiff `drawShip`: zwei Kanonen vorn links/rechts sichtbar.
- Icons: `marker` (Raute, opts.color), `scan`, `widescan`, `overload`, `loc_port|loc_asteroids|loc_buoy|loc_trader|loc_wreck|loc_nebula|loc_relay|loc_unknown`, `pin_ziel|pin_gefahr|pin_landeplatz|pin_treffpunkt|pin_frage`.
- Alles in `art-preview.html` zeigen. Stil: warm, lesbar, Palette aus CONTRACT §12.

## 12. Audio-Ergänzungen (`audio.js`)

Neue Sounds: `phase`, `scan_tick`, `scan_done`, `widescan`, `marker_set`, `overload_start`, `overload_warn`,
`reactor_down`, `reactor_up`, `switch_hold`, `discovery`, `salvage`, `emp`, `pylon_down`, `trade`,
`table_sit`, `lore`. Neue Musikstimmung `mystery` (Nebel/Relais, schwebend, eigene Motive).
Vorschau ergänzen.

## 13. Abnahme M1

1. `node --check`, `npm run check` (Schiff, Plattform, Wrack), `npm run sim` (solo + 3, Mission 1 **und** 2
   komplett mit echten Befehlen), `tools/test-features.js`, `tools/ws-smoke.js` grün.
2. QA spielt im echten Browser solo und zu dritt (Rollen Steuer/Taktik/Captain), misst Dauer je Mission und
   Erkundung (`stats`), sucht Softlocks (Reaktor offline und niemand da, Leitbake übersehen, Wrack ohne
   Weitscan, Disconnect am Tisch), prüft Frontsicht/Marker/Scan-Kommunikation praktisch.
3. Ohne art.js/audio.js lauffähig, Fehlerzähler 0, Raumcode/Reconnect/„voll“ funktionieren.
4. README aktualisiert (Rollen, Steuerung je Konsole, Orte, Erkunden-Tipps).

## 14. QA-Nachträge (2026-10-05)

- **Mission 2 erweitert** (Inhalt für 30–45 min, keine Transportaufgaben): Schritte jetzt
  `briefing → vaelen → (sonde) → nebelFlight → ambush → parley → beacon → toRelais → relay → finale`.
  `vaelen`: bei der Karawane andocken, Entscheidung `sela` (Nebelkarte 60 Marken | Messsonde per Weitscan suchen → Schritt
  `sonde`, verstecktes Objekt `vaelen_sonde`). Wer direkt in den Nebel springt, landet ohne Umweg in `ambush`.
  `parley`: Funkduell mit Grauzahn, Entscheidung `parley` (`bluff` wirkt nur bei `decision: 'deliver'`, sonst 1 Jäger;
  `share` = +30 Marken, deckt `nebel_lore` auf, kein Echo-Jäger; `silent` = wie bisher, nach 75 s automatisch).
  `relay`: nach dem Wächter eine **Prüfung** – 2 Pylonen (`tag: 'pylon2'`, `face: 'in'`, Front zum Kern); erst danach Kernscan.
- **Entdeckungen 12** statt 9: neu `b7_fragment` (lore), `vaelen_sonde` (lore), `wrack_kapsel` (cache).
- Mission 1, Schritt `port`: optionales Vaelen-Ziel bleibt sichtbar. Wrack-Außenmission endet (`away.active = false`),
  wenn niemand mehr unten ist.
- Andocken: Wer beim Andocken W hält, legt nicht sofort wieder ab (`ship.dockHold`); nach versehentlichem Ablegen ist der
  Dock-Ring nach 4 s wieder scharf. Reaktor-Neustart: Schrauber helfen auch während der Hafen-Übung.
- `shared/physics.js`: Ecken-Hilfe (bis 10 px) an Türkanten; Server-Interaktion mit 4-px-Toleranz an Kachelgrenzen.
