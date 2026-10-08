# Helfer-Inventar (Konzept S1 „Regiebuch & Weltstand“)

Stand 2026-10-07 · Grundlage: `server/sim/mission.js` (HOOKS, CHECKS), `server/missions/m1–m3.js`, `arena.js`.
Gehört zu [README.md](README.md). Beantwortet Briefing S1 §8, Punkt 2.

**Bestand:** **35 Aktionen** (`HOOKS`, Aufruf `{ do: name }`) und **27 Prüfungen** (`CHECKS`, Aufruf `{ check: name }`).
Das Briefing nannte 32. Drei Helfer werden nur indirekt aufgerufen (`putDatenkern` aus `skipAway`, `m3Reward` und
`m3Prep` mit Parameter `key`/`upTo`), deshalb hat sie die Textsuche nicht gefunden.

**Einordnung:**
- **generisch:** wird ein Baustein mit Parametern, den später auch der Spielleiter nutzen darf.
- **intern:** bleibt als Baustein, ist aber für den Spielleiter gesperrt (Debug, `skip`, Testgelände, Tutorial-Übung).
- **entfällt:** wird in Daten aufgelöst (Kombination aus vorhandenen Atomen und generischen Bausteinen).

## Wichtigster Befund: Objekte und Bereiche auf Außenkarten

Rund 18 der 62 Helfer und Prüfungen fragen **ein bestimmtes Objekt oder einen bestimmten Bereich auf einer Außenkarte** ab:
Sonde, Bojenkern, Techniker, Datenkern (B-7); Störrelais, Tor, Tafel, Wächter, Halle, Hof (Kesh). Heute ist jedes davon
ein eigener Codepfad (`m.game.aways.platform.sonde.disabled`, `kesh(m).vault.open`, `Math.floor(p.x / 32) >= hallX`).

**Vorschlag:** Außenkarten deklarieren ihre **Objekte** (Kennung, Art, Zustände) und **Bereiche** (benannte
Kachelmengen) in den Kartendaten (`shared/maps.js`, Legende). Dann reichen wenige generische Bausteine:

| Baustein | Art | Ersetzt |
|---|---|---|
| `object_state { map, object, state }` | Prüfung | `sondeDisabled`, `coreRebooted`, `npcRescued`, `npcInjured`, `vaultOpen`, `tabletTaken`, `jammersAllOff` (mit `all: true`) |
| `area_occupied { map, area, min? }` | Prüfung | `playerInHall`, Teil von `nearInjuredNpc` |
| `item_in_area { map, item, area, carrierRule? }` | Prüfung | `tabletInCourtyard` |
| `set_object_state { map, object, state }` | Aktion | `openVault`, Teile von `skipAway` |

Das ist **der Vorläufer der Anker** aus dem Orts-Generator (G1): Ein Objekt ist ein Anker mit Zustand, ein Bereich ist
eine Anker-Rolle mit Fläche. Wer S1 so baut, muss in G1 nichts umwerfen.

## Aktionen (HOOKS)

| Helfer | Wo | Einordnung | Neuer Baustein / Auflösung |
|---|---|---|---|
| `drillSetup` | m1 `dock` | generisch (aufteilen) | `ship_incident { fires[], breaches[], system? }` + Verzweigung „Übung übersprungen“ als Daten (Bedingung `lobby: 'skipDrill'`) |
| `clearDrill` | m1 skip, Debug | intern | `debug_clear_incidents` |
| `guaranteeFire` | m1 `combat` | generisch | `ship_fire { region: 'random' \| 0–3, text? }` |
| `guaranteeBreach` | m1 `combat` | generisch | `ship_breach { region, text? }` |
| `breakShields` | m1 `combat` | generisch | `damage_system { system: 'shields', state: 'broken', hitSector, text? }` |
| `damage` | m1 `on` | generisch | `damage_system { system, state }` (gleicher Baustein) |
| `pay` | m1, m2 Entscheidungen | generisch | `pay_marks { marks }` |
| `endAway` | m1 `decision` | generisch | `end_away { map }` |
| `removeDatenkern` | m1 `decision` | generisch | `remove_item { item }` |
| `putDatenkern` | über `skipAway` | intern | `debug_item_aboard { item }` |
| `spawnGuards` | m1 `on.coreRebooted` | generisch | `activate_away_group { map, group, text? }` (setzt Objektmodell voraus) |
| `selaCall` | m1 `return` | **entfällt** | Daten: `reveal_location` + `radio` + `oda` + `setFlag`; Selas Notruf wird ein **eigenes Regiebuch** (Art `nebenauftrag`) |
| `killAll` | Skips m1, m2 | intern | `debug_clear_enemies` |
| `killKind` | m1 skip | intern | `debug_clear_enemies { kind }` |
| `markScan` | m1/m2 skip, Debug | intern | `debug_mark_scanned { id }` |
| `revealHidden` | m2 | generisch | `reveal_find { id }` |
| `scanHidden` | m2 Garantien | generisch | `complete_find { id }` (Garantie bei Stillstand) |
| `beaconHint` | m2 `beacon` | generisch | `direction_hint { find, text }` (Text mit Platzhalter `{dir}`) |
| `skipAway` | m1 skip, Debug | intern | `debug_skip_away { map }` |
| `debugJump` | Skips | intern | `debug_jump { loc }` |
| `debugDock` | m1 skip | intern | `debug_dock { loc }` |
| `choose` | m1 skip, **m2 `parley` Garantie** | generisch | `force_choice { option }`: Garantie „Schweigen nach 75 s“ ist Spielinhalt, kein Debug |
| `acceptNow` | Skips | intern | `debug_accept` |
| `forceRadio` | Skips | intern | `debug_force_radio { from, text }` |
| `revealKesh` | m3 | generisch | `reveal_location { loc, openLink?, text? }` (vereint `reveal` und `openLink`) |
| `spawnSquad` | m3 | generisch | `spawn_squad { map, squad, alert? }` |
| `killSquad` | m3 skip, `m3Prep` | intern | `debug_kill_squad { squad }` |
| `reliefSquad` | m3 `on.jammerOff` | **entfällt** | Daten: Wendung mit `spawn_squad { squad: 'relief', alert: true }`, Bedingungen „einmal“ und „Tor noch zu“ |
| `wakeWarden` | m3 `warden` | generisch | `wake_unit { map, unit }` |
| `openVault` | m3 skip, `m3Prep` | generisch | `set_object_state { map, object: 'vault', state: 'open' }` |
| `takeTablet` | m3 skip, `m3Prep` | intern | `debug_take_item { map, item }` |
| `m3Reward` | m3 | **entfällt** | Daten: `reward` + `setFlag` + `oda` + `log` (Wächter-Belohnung mit Lamassu-Figur) |
| `m3Prep` | m3 Debug | intern | Debug-Vorbereitung als Liste interner Bausteine je Schritt |
| `arenaSkip` | Testgelände | intern | `debug_arena_skip` |
| `keshRecallAll` | m3 skip | intern | `debug_recall_all { map, ensureItem? }` |

**Summe Aktionen:** 17 generisch, 15 intern, 3 entfallen.

## Prüfungen (CHECKS)

| Prüfung | Wo | Einordnung | Neuer Baustein / Auflösung |
|---|---|---|---|
| `drillDone` | m1 | entfällt | `all: [no_fires, no_breaches, system_ok]` |
| `noFires` | m1 | generisch | `no_fires` |
| `noBreaches` | m1 | generisch | `no_breaches` |
| `systemOk` | m1 | generisch | `system_ok { system }` |
| `consoleManned` | m1 | generisch | `console_manned { console }` |
| `salvageDone` | m1 | generisch | `salvage_done` |
| `shipX` | m1 `route` | generisch | `ship_in_zone { loc, zone }` (benannte Zone der Raumszene statt Pixelgrenze) |
| `marksBelow` | m1, m2 | generisch | `marks_below { n }` |
| `anyAway` | m1 | generisch | `team_down { map?: any }` |
| `awayActive` | m1 | generisch | `away_active { map }` |
| `awaySince` | m1 | generisch | `away_since { map, sec }` |
| `sondeDisabled` | m1 | generisch | `object_state { map: 'platform', object: 'sonde', state: 'off' }` |
| `coreRebooted` | m1 | generisch | `object_state { … object: 'core', state: 'rebooted' }` |
| `npcRescued` | m1 | generisch | `object_state { … object: 'ivo', state: 'rescued' }` |
| `npcInjured` | m1 | generisch | `object_state { … object: 'ivo', state: 'injured' }` |
| `nearInjuredNpc` | m1 | generisch | `all: [object_state injured, near_object { map, object, dist }]` |
| `awayComplete` | m1 | entfällt | `all: [away_active, item_aboard datenkern, not team_down, object_state core rebooted]` |
| `players` | m1 | generisch | `crew_max { max }` |
| `widescanUsed` | m2 | entfällt | Ereignis `widescan` (gibt es schon als `event`) |
| `keshTeamDown` | m3 | generisch | `team_down { map: 'kesh' }` |
| `squadCleared` | m3 | generisch | `squad_cleared { map, squad }` |
| `playerInHall` | m3 | generisch | `area_occupied { map: 'kesh', area: 'halle' }` |
| `jammersAllOff` | m3 | generisch | `object_state { map: 'kesh', object: 'jammer', state: 'off', all: true }` |
| `vaultOpen` | m3 | generisch | `object_state { map: 'kesh', object: 'vault', state: 'open' }` |
| `tabletTaken` | m3 | generisch | `object_state { map: 'kesh', object: 'tablet', state: 'taken' }` |
| `tabletInCourtyard` | m3 | generisch | `item_in_area { map: 'kesh', item: 'tafel', area: 'hof', carrierRule: 'carrierOrAnyIfCarrierUp' }` |
| `keshExtracted` | m3 | entfällt | `all: [item_count { item: 'tafel', min: 1 }, away_active kesh, not team_down]` |

**Summe Prüfungen:** 23 generisch, 4 entfallen.

## Was sonst noch fest in der Engine steckt

| Stelle | Problem | Vorschlag |
|---|---|---|
| `MISSION_ORDER`, `onComplete: startMission` | Missionsfolge im Code | Regiebuch-Teil `angebot` (Voraussetzung, Anbieter, Kanal); die Engine sucht das nächste verfügbare Angebot |
| `startDirect`, `debugDone` | Lobby-Direktstart kennt nur m3 | Regiebuch-Teil `angebot.direktstart` + `debug.done` |
| `beamDownBlocked()` | Regel nur für `platform`/m1 | Schritt-Feld `allowBeam` (gibt es) + Kartenregel „nach Erledigung gesperrt“ in den Kartendaten |
| `bookEntries()` Sela / Zaunkönig | Nebenaufträge fest im Code | eigene Regiebücher mit `kopf.art: 'nebenauftrag'` |
| `book.from` als Funktion (m2) | nicht als JSON ausdrückbar | `von: [{ if: { flag: 'technikerRescued' }, npc: 'ivo' }, { npc: 'tesk' }]` |
| `tpl()`-Platzhalter `{salvaged}`, `{awayLeft:x}`, `{jammersOff}` | an Karten/Missionen gebunden | generisch: `{salvaged}`, `{squadLeft:x}`, `{objectsInState:jammer:off}`; `{killed:x}`, `{left:x}`, `{found}`, `{total}` bleiben |
| Werte aus `config.js` (`C.ambushAfter`, `M.wardenStepMax`) | JS-Ausdrücke | Verweis `{ "cfg": "missionM3.wardenStepMax", "plus"?: n }`, aufgelöst beim Laden; nur für handgeschriebene Regiebücher |
| `globalComments()`, `CONSOLE_HELP`, ODA-Kommentare in `onEvent` | Bord-Kommentare | **bleiben in der Engine.** Sie sind Spielhilfe, kein Missionsinhalt |
| `isDrillStep()` | an m1/`dock` gebunden | Schritt-Feld `drill: true` |
