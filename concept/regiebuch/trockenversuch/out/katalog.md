# Katalog

## Orte (Weltraumszenen; ein Sprung führt nur über bekannte Verbindungen)
- `hafen` – Hafen Lichtkordon (port). Heimathafen der Lerche: Liegeplatz, Hafenterminal und Tesks Funkturm. Riecht nach Öl und Kaffee. Verbindungen: splitter, vaelen, kesh. Andocken möglich (Hafen, Speichern).
  - Fund `hafen_cache` (cache): Schmugglerkiste im Hafenschrott
- `splitter` – Splittergürtel (asteroids). Ein Gürtel aus Felsbrocken und Wrackteilen. Ehrliche Bergung – und unehrliche Rostmeute. Verbindungen: hafen, b7, wrack, kesh.
  - Fund `splitter_cache1` (cache): Versiegelter Frachtcontainer
  - Fund `splitter_cache2` (cache): Bergungsboje mit Notvorrat
- `b7` – Boje B-7 (buoy). Navigationsboje mit Wartungsplattform. Seit Kurzem verstummt – und von Kustoden-Technik umgeben. Verbindungen: splitter, nebel. Außenkarte per Transfer: `platform`.
  - Fund `b7_cache` (cache): Treibende Wartungskiste
  - Fund `b7_fragment` (lore): Kustoden-Splitter
- `vaelen` – Vaelen-Karawane (trader). Fahrende Händler mit Kristalllampen, Tee und guten Preisen für Bolzenwerfer. Andocken erlaubt. Verbindungen: hafen, nebel. Andocken möglich (Hafen, Speichern).
  - Fund `vaelen_cache` (cache): Verlorenes Teepaket
  - Fund `vaelen_sonde` (lore): Selas Messsonde
- `wrack` – Wrack „Zaunkönig“ (wreck). Ein zerbrochener Frachter. Plünderer waren schon da – aber nicht überall. Verbindungen: splitter, nebel. Außenkarte per Transfer: `wreck`.
  - Fund `wrack_hollow` (hollow): Hohlraum im Laderaum
  - Fund `wrack_kapsel` (cache): Rettungskapsel der Zaunkönig
- `nebel` – Graue Weite (nebula). Ein Nebel, der Sensoren schluckt. Wer hier etwas finden will, braucht Weitscan und Geduld. Verbindungen: b7, vaelen, wrack, relais.
  - Fund `nebel_beacon` (beacon): Kustoden-Leitbake
  - Fund `nebel_lore` (lore): Stumme Lore-Bake
- `relais` – Kustoden-Relais (relay). Ein Relais der Kustoden, bewacht von Pylonen. Hier endet das Echo – oder es beginnt. Verbindungen: nebel.
  - Fund `relais_lore` (lore): Kustoden-Inschrift
- `kesh` – Mond Kesh (moon). Ein staubiger Mond mit einer Kustoden-Ruine. Plünderer graben dort seit Wochen. Verbindungen: hafen, splitter. Außenkarte per Transfer: `kesh`.

## Außenkarten (nur diese drei gibt es; jede gehört zu einem Ort, siehe oben)
- `platform`
  - Objekte: `sonde` (Zustände: on/off), `core` (Zustände: off/rebooted), `ivo` (Zustände: injured/ok/rescued), `datenkern` (Zustände: present/taken)
  - Bereiche: –
  - Trupps (besetzung.gruppen, quelle "karte"): `guards` (Kachelart drone)
- `wreck`
  - Objekte: `hollow` (Zustände: closed/open), `lore` (Zustände: unread/read)
  - Bereiche: –
  - Trupps (besetzung.gruppen, quelle "karte"): `plunderer` (Kachelart scavenger)
- `kesh`
  - Objekte: `jammer` (Zustände: on/off), `vault` (Zustände: closed/open), `key` (Zustände: idle/held), `tablet` (Zustände: present/taken), `warden` (Zustände: asleep/awake/dead)
  - Bereiche: `landezone`, `hof`, `halle`, `gewoelbe`
  - Trupps (besetzung.gruppen, quelle "karte"): `squad1` (Kachelart squad1), `squad2` (Kachelart squad2), `rearguard` (Kachelart rearguard), `relief` (Kachelart squad2)
  - Einheiten (besetzung.einheiten): `warden`

Anker in `besetzung` sind die Spawn-Zeichen der Karte: kesh a=squad1, b=squad2/relief, c=rearguard, L=warden; wreck a=plunderer; platform d=guards.

## Gegner im Weltraum (Atom `spawn`)
`{ "spawn": { "kind": K, "tag": "frei", "n": 1–3 | "angles": [rad…] | "atStation": [{ "dx", "dy" }…] | "behind": true | "crew": { "1": n, "2": n, "3": n }, "face": "out"|"in" } }`
- `raider` Jäger: schnell, Anflüge über das Schiff
- `gunboat` Kanonenboot: träge, lädt schwere Breitseiten sichtbar (Pilot dreht weg, Taktik antwortet)
- `relay` Störrelais: kreist um ein Objekt, blockiert einen Scan, schießt nicht
- `pylon` Pylon (Kustoden): fest, Frontschild – nur von der Seite verwundbar
- `sentinel` Kustoden-Wächter: langsam, EMP legt Systeme lahm

## Bausteine: Aktionen (`{ "do": name, …parameter }`)
- `ship_incident` – Bordschäden setzen (Feuer, Lecks, System) – z. B. Hafen-Übung. Parameter: fires:number, breaches:number, system:system, state:string(damaged|broken)
- `ship_fire` – Feuer an Bord in einer Region. Parameter: region:region, text:text
- `ship_breach` – Hüllenbruch in einer Region. Parameter: region:region, text:text
- `damage_system` – Schiffssystem beschädigen oder zerstören. Parameter: system*:system, state*:string(damaged|broken), hitSector:sector, text:text
- `pay_marks` – Marken abziehen (Bestechung, Kauf). Parameter: marks*:number
- `end_away` – Außenmission auf einer Karte beenden. Parameter: map*:map
- `remove_item` – Gegenstand aus Schiff/Inventar entfernen. Parameter: item*:item
- `activate_away_group` – Ruhende Gruppe auf einer Außenkarte aktivieren. Parameter: map*:map, group*:squad, text:text
- `reveal_find` – Versteckten Fund aufdecken. Parameter: id*:find
- `complete_find` – Fund als gescannt/eingesammelt werten (Garantie bei Stillstand). Parameter: id*:find
- `direction_hint` – ODA-Richtungshinweis zu einem Fund ({dir} im Text). Parameter: find*:find, text*:text
- `force_choice` – Offene Entscheidung erzwingen (Garantie: Schweigen ist auch eine Antwort). Parameter: option*:option
- `reveal_location` – Ort auf der Sternkarte aufdecken, optional gesperrte Verbindung öffnen. Parameter: loc*:loc, openLink:string, text:text
- `spawn_squad` – Trupp auf einer Außenkarte erscheinen lassen. Parameter: map*:map, squad*:squad, alert:boolean
- `wake_unit` – Ruhende Einheit wecken (Wächter). Parameter: map*:map, unit*:unit
- `set_object_state` – Zustand eines Kartenobjekts setzen (Tor öffnen …). Parameter: map*:map, object*:object, state*:string

## Bausteine: Prüfungen (`{ "check": { "name": name, …parameter } }`)
- `no_fires` – Parameter: –
- `no_breaches` – Parameter: –
- `system_ok` – Parameter: system*:system
- `console_manned` – Parameter: console*:console
- `salvage_done` – Parameter: –
- `ship_in_zone` – Parameter: loc*:loc, zone*:string
- `marks_below` – Parameter: n*:number
- `team_down` – Parameter: map:map
- `away_active` – Parameter: map*:map
- `away_since` – Parameter: map*:map, sec*:number
- `object_state` – Parameter: map*:map, object*:object, state*:string, all:boolean
- `near_object` – Parameter: map*:map, object*:object, dist*:number
- `area_occupied` – Parameter: map*:map, area*:area, min:number
- `item_in_area` – Parameter: map*:map, item*:item, area*:area, carrierRule:string(any|carrier|carrierOrAnyIfCarrierUp)
- `item_count` – Parameter: item*:item, min*:number
- `crew_max` – Parameter: max*:number
- `squad_cleared` – Parameter: map*:map, squad*:squad

(* = Pflicht)

## Atome (direkt in Aktionen)
`oda`, `radio {from: npc, text, accept?}`, `set {var: wert}` (Schrittvariablen, Bedingung `v`), `setFlag {flag: wert}` (missionsweit, Bedingung `flag`), `reveal` (Ort-ID oder Liste), `reward {marks?, items?: {ersatzteil|flickblech|loeschgel|medipack|bolzen: n}, deko?: [..]}`, `log` (+ `loc`), `spawn`, `spawnSalvage: n` (Bergungskisten in der Szene, Prüfung `salvage_done`), `choice: id` (öffnet eine Entscheidung des Schritts), `after {sec, do: [..]}`, `goto: schritt`, `complete: ausgang`, `end {title, text}` nur in ausgaenge.danach.
Schritt-Felder: `loc` (Ort, an dem der Schritt spielt), `scan {id, label, range (300–500), time (s), requires?, blocked?}` (Captain-Scan des Hauptobjekts, Bedingung `scanDone: id`), `jumpBlock [{dest?, if, reason}]`, `allowBeam: [karte]`, `restartOnReturn`.

## Bedingungen (Atome)
`all`, `any`, `not`, `atLocation: ort`, `docked: true|false|ort`, `elapsed: s` (seit Schrittbeginn), `flag`, `v`, `enemiesCleared`, `enemiesLeft {kind?, tag?, max}`, `killed {kind|tag, min}`, `enemyHpBelow {tag|kind, frac}`, `scanDone: id`, `choiceMade: id`, `event: name`, `known: ort`, `visited: ort`, `revealed: fund`, `found: fund`, `dest: ort` (Sprungziel gewählt), `near {station: px}`, `check {…}`.

## Ereignisse (für `event` und `on`)
accepted, jumped, docked, undocked, scanned, enemyKilled, enemyScanned, shieldsChanged, widescan, hiddenFound, salvage, beamedDown, beamedUp, playerWounded, fire, breach, systemDamaged, repaired, bought, decoPlaced, jammerOff, vaultOpened, tabletTaken, wardenKilled, sondeDisabled, datenkernTaken, coreRebooted, npcRescued, droneKilled.

## Platzhalter in Texten
`{killed:tag}`, `{left:tag}`, `{found}`, `{total}`, `{salvaged}`, `{squadLeft:trupp}`, `{objectsInState:objekt:zustand}`.

## NSC (Kennungen)
- `tesk` – Hafenmeisterin Tesk
- `sela` – Sela (Vaelen-Händlerin)
- `ivo` – Techniker Ivo
- `grauzahn` – Grauzahn (Rostmeute)
- `melk` – Archivarin Melk
- `kustoden_relais` – Kustoden-Relais

## Folgen in `ausgaenge.*.folgen` (je Eintrag genau ein Schlüssel)
`npc_gedaechtnis {npc, text}`, `npc_haltung {npc, delta: -2…2}`, `npc_status {npc, status}`, `chronik: text`, `welt_fakt {key, wert}`, `remove_item {item}`, `ruf {fraktion, delta}`.