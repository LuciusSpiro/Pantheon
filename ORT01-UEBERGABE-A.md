# ORT-01 Übergabe Teil A (Stand nach Fortsetzung)

Worktrees: Spiel `Pantheon-ort01-int` (Branch `ort01-int`), Voxelwerk `voxelwerk-ort01-int` (Branch `ort01-int`).
`public/voxel` ist gegen den Voxelwerk-HEAD erzeugt (Spiel-Commit `ba9ea3d`). Kein Push, kein Merge.

## Stand Teil A

| Nr. | Stand | Commits (Spiel / Voxelwerk) |
|---|---|---|
| 1 Paletten (Rom-Außenposten, Zustände) | fertig; `art.<kartenart>` je Zustand, `rom_verfallen/_umkaempft`, `station_esse_verfallen/_umkaempft`. Verfall/Umkämpft im Bild nicht geprüft. | `734ec5a` / `6781eb4` |
| 2 Kronen 1-Voxel-Linie | fertig (Rom Amber, Germanen Glut `#FF7A1A`) | / `549d98b` |
| 3 Böden | fertig, danach durch Punkt 11 (ruhiger Boden) ersetzt | / `549d98b`, `Boden ruhig…` |
| 4 Rollen-Daten | fertig: `zug_gross` (ab 49 Kacheln), `pflicht` an allen `leit`, `zellen.feldzelle` gestrichen (Zelle nur als Anker), Thron nicht mehr festes Kontrollraum-Leitstück (`leit.kontrollraum` aus `germanen.json`), Medkiste Runensiegel | `4921b2e` / `6e531c3` |
| 5 Raumtyp über Anker | fertig mit Test (messe_1 + Sprengpunkt → reaktor, Kontrollraum + Terminal → kommando) | `4921b2e` |
| 6a Leitstück ohne Anker | fertig in `kit.js` (meidet Anker/Weg/Pad/Rampe/Tür, nächstes freies Rechteck, sonst entfällt); Landeplatz Rom/Germanen flach (1 Voxel, 6 cm); `silhouetteFehler` prüft `bauweise.leit` (Ausnahmeliste `LEIT_PLATZ_HOCH`) | `4921b2e` / `Landeplatz…` |
| 6b Klasse `bau` | fertig: nur `ort/`, `kit/`, `rom/standarte`, `rom/laterne`; Flächenprüfung gegen Footprint; Test inkl. Einbau in `check-assets` | `4921b2e` |
| 6c/6d/6e | fertig (Höhenregel je Eintrag, Rückfall Hauptstück, Kleinkram/Doku in `CONTRACT-ROLLEN-ORT.md`) | `734ec5a`, `4921b2e` |
| 7 Prüf-Sperre Orte | **offen** (bewusst, erst nach Teil B1) | – |
| 8 Screenshot-Werkzeug | fertig: Sitzkamera + Figur geparkt (Station), Übersichten (`--uebersicht`, Nebel aus, schräg von oben), `--lp`, `--root` (main-Archiv für Vorher-Bilder, `lp hin` ins Archiv kopiert) | `4921b2e` |
| 9 Dach-Budget | fertig (Prüfbogen 3.200, Fehler ab 4.800) | / `250e87d` |
| 11 Boden ruhig (Kai) | fertig: `par` (x mod 2 + 2·(y mod 2)) von `kit.js` an `kit/geruest/boden` und die Slots `boden_belag`/`boden_fuge` (rom, germanen × station, aussenposten); Fugen nur an 2×2-Blockgrenzen, keine Pro-Kachel-Streuung/Flecken/Schachbrett; Schiff/Ruine ohne `par`. Die Station dieser Bauweisen nutzt jetzt die Kit-Slots statt der Fliesen-Optik (`stationBoden` nur noch für andere Bauweisen). Nicht umgesetzt: Amber-/Glutlinie im Boden (Modelle kennen die Wegrichtung nicht). | `4921b2e` / `Boden ruhig…`, `Stationsfuge heller` |

Baseline: `deko`/`layout` neu in `3245cd2` (Grund: Rollen-Daten, Rückfall, Zellengrenze `MAX_ROLLE_JE_ZELLE`=6). Karten 72/72, `deko_zellen` 60/60 unverändert.

## Gates (Stand `ba9ea3d`)
Grün: `npm test` (Exit 0), `npm run check`, `check:assets` (0 Fehler, 46 Warnungen), `snap:mess`, Hash-Vergleich (72/72, 60/60, 120/120, 120/120, Parität 60/60), Golden 120/120 byte-gleich zu frischem main-Lauf und zur eingecheckten Basis.
Kaltbau (10 Seeds, ruhiger Lauf, alle gültig): Außenposten germanen Median etwa 520 ms (Baseline 442, Toleranz 530), Station etwa 440 ms (Baseline 388, Toleranz 466); Dreiecke Außenposten germanen Median etwa 441 k (Grenze 416 k × 1,1 = 458 k), Station etwa 316 k; Rom Außenposten etwa 278 k, Station etwa 225 k.
Hinweis Dreiecke Bestandskarten (`VoxelKit.stats()`): Methalle 416 k (main 394 k), Eisenwald 388 k (364 k), Kesh-Grabung 450 k (428 k), Kantenstein 406 k; über 400 k war schon main.

## Screenshots
`shots/ort01/<bauweise>/<kartenart>/<seed>-<raum>.png` und `…-uebersicht.png` (Seeds 1–3), `shots/ort01/lp/<id>/…` (Bestandskarten), Vorher (main): `shots/vorher-main/lp/<id>/…`.
Kritik: Boden jetzt ruhig und klar lesbar (2×2-Felder, dunkle Fuge); Rom-Station: Marmor/Rot/Gold, Stücke stehen, nichts auf Wegen. Offen: Außenposten-Gelände bei Rom braun, Rom-Dächer fast schwarz, Germanen-Dächer sehr dunkelbraun (Dach-Rolle/Gelände-Palette, nicht Teil A); in Sitzkamera-Bildern wirken Farben blasser als im Spiel (Glut dort rosa-braun); Station Germanen: Fuge gut sichtbar, noch etwas kontrastreich.

## Nachtrag (B1-Verdrahtung, Prüf-Sperre, Dach/Gelände)
- Merges: ort01-anker (Voxelwerk und Spiel, ohne Konflikt, keine ID-Dubletten, 335 Einträge) und ort01-4b (ein Konflikt: tools/ort01-shots.js, Gegnerbilder vor Übersicht, Sitzkamera vorher aus).
- Anker verdrahtet in rom.json/germanen.json (station und aussenposten: ziel, sprengpunkt, zelle, beute, fund (Rom), terminal, abholpunkt (Rom); "*" für Ruine/Schiff bleibt).
- Prüf-Sperre aktiv: tools/orte-sperre.mjs, check:assets Abschnitt orte, tools/test-orte-sperre.js (Mutationsprobe, in npm test). Ausnahmen explizit (AUSNAHMEN): rom anker tor/raetsel (Rückfall, nie als Prop auf Orten), prop/germanen/gemein/werkzeug als Deckung und Zellen-Deko der Germanen (kein ORT-Deckungsmodell). Erlaubte Altstücke (ALT_ERLAUBT): statue_platz, hochsitz_halle, schmiedeherd, kraehenwacht_turm, met_kessel (fund und messe.ausgabe), Schiff-Lift/Leiter.
- Rom-Dach Terrakotta (dach), Rom-Gelände Travertin (kits.gelaende je_art aussenposten), Germanen-Dach heller; Germanen-Dächer bleiben durch die Besitz-Palette (rostmeute) bräunlich.
- Nächste Schritte: Ersatz für Holzwerkbank-Deckung der Germanen (ORT-Deckungsmodell), Zustandswechsel der Anker live prüfen, Verfall/Umkämpft im Bild, Dach-Kontrast der Germanen mit Kai klären.

## Nachtrag 6D (Nacharbeit nach Designer-Review R2)

Commits (Spiel `ort01-int`): `e45642d` (Code, Daten, Tests), `9c89754` (Hash-Baseline deko/layout, Grund siehe Commit), `3cbf58d` (`npm run assets`). Voxelwerk: `178e520` (Stimmung hall_rom, Paletten rom_station, nord_aussenposten, station_esse), `464fec1` (Außenposten-Dach neutral).

| Befund R2 | Stand | Belege / Hinweis |
|---|---|---|
| 1 Rom-Station Gold/Amber | teilweise. Stimmung `hall_rom` (heller, warm), Palette `rom_station` nur Station (trim `#E0A526`, glow2 `#FF9A2E` emit 1,0). Amber bleibt im Bild taupe (Wandbänder ca. `#705A4D`) | Der Test mit Grün/Magenta zeigte: die Bänder sind glow2, aber im Bild gedämpft. Ursache im Kit-Material/Tonemapping ungeklärt, nicht behoben. Offen |
| 2 Germanen-Glut/Kupfer | teilweise. `station_esse`: copper `#A9542A`, ember `#FF7A1A` (war schon so) | Glut im Bild kaum sichtbar, Kupfer nur leicht dunkler. `hall_forge` unverändert |
| 3 Reaktor an der Türwand | umgesetzt: 2×2-Anker bei freier Seite zur Platzmitte (`kit.js`), Hauptstücke ohne Südkachelreihe, Vorrang Wand vor freiem Rückfall | `rom/station/1-reaktor.png`: Reaktor jetzt an der Nordwand gegenüber der Tür |
| 4 Lager | Station war schon Pflicht (zellenregal, ladebank), Außenposten: `lager.kran` Pflicht | Lager-Zählung Ziel 4–6 nicht gezählt |
| 5 Kommando groß leer | umgesetzt: `mitte: true` (neues Rollen-Feld, Prüfung und Test), Kartentisch Raummitte bei Platz min(w,h) ≥ 5 | Test 18/18 Räume ≤ 1,5 Kacheln von der Mitte |
| 6 Außenposten Deko/Deckung | **nicht ausgeführt.** `PAKET6M-VERDRAHTUNG.md` liegt im Voxelwerk-`ort01-m`, Kai hat noch nicht freigegeben | Vorbereitung offen: `deckung_props`, `deko`, `orte-sperre` |
| 7 Dächer braun | Außenposten Germanen: `nord_aussenposten` (dach `#716D69`) | Bild `germanen/aussenposten/1-uebersicht.png`: Dächer grau-eisern |
| 8 Braunes Holzfass Kommando | **nicht gelöst.** Gleiche Kachel in Rom und Germanen, nicht aus Bauweise-Deko, Rom hat kein `moebel`, kein `fass` in Rom-Deko | Nächster Schritt: Laufzeit-Debug (Objektliste der Kachel) |
| 9 Stimmung AP Germanen | nicht geändert (`outpost_frost`), Eisen im Bild grau lesbar | |

Gelände Rom-Außenposten (Hinweis Koordinator): `kits.gelaende` je_art top `stone` (war `stone_dark`), neuer Terrain-Parameter `steinDichte` (0,05 statt 0,1; Standard unverändert). Im Bild bleibt das Gelände grau-beige, da `planet_day` kühl ist. Die Dunkelwürfel auf dem Gelände sind Deko, nicht Sprenkel (nicht verifiziert).

Besitz-Paletten (`raubzug`, `rostmeute`, `kontor`, `konkordat`) **nicht geändert**: die artbezogene Palette `nord_aussenposten` überschreibt sie für Außenposten Germanen, und Schiffe und Ruinen bleiben auf den Besitz-Paletten. Eisenwald und Methalle sehen dadurch anders aus (erlaubt).

Gates: siehe Bericht an den Koordinator.

## Nachtrag 6M und Befunde (Stand Abschluss 6D)

Merges (ohne Konflikt): Voxelwerk `ort01-m` (`0bf786d`) und `ort01-m2` (`8aef8fb`) in `ort01-int`, Spiel `ort01-m` (`fe07f7c`, `assets/manifest/ort-6m.json`). Die Paletten `station_esse`, `rom_station`, `nord_aussenposten` und die Stimmungen sind durch die Merges unverändert.

Punkt 6 (Verdrahtung nach `PAKET6M-VERDRAHTUNG.md`, Commit `12ca2f4`): `deckung_props.aussenposten` (Fasszelle, Blasebalg, Glutspeicher, Leitfeuer), `deko/germanen.json` für Außenposten-Platztypen auf Glutleitung, Kabelrolle, Runenpoller. `orte-sperre.mjs`: Holzwerkbank-Ausnahme nur noch Station, neu verboten `kette`, `gemein/fass`, `feuerschale`, Mutationsproben. Station-Altstücke (fass, kette, feuerschale in kreuzung, zellen, lager, herzstueck, reaktorraum, quartiere) bleiben als benannte Ausnahme für Station.

Befund 8 (braunes Holzfass) gelöst: Es kam aus der Besitz-Streuung (`paletten/rostmeute.json` → `streu`: fass, kette, werkzeug, feuerschale), die `kit.js` in Station und Außenposten zog. Filter in `kit.js` nur für Station und Außenposten (Ruine und Schiff unverändert), Commit `5a8fdbd`.

Befund 1/2 (Amber und Glut, offen): Messung im Rom-Kommando (Wandband, glow2). Die Rinne ist im Bild etwa 5-fach dunkler als die berechnete Emission und verschiebt sich zu Grau-Beige. Bei Emissionsskala 3,0 wird sie rosa-beige, bei 0,45 dunkelbraun. Ursache ist nach den Messungen nicht allein das Tonemapping (NeutralToneMapping kompromiert Hell-Töne, Befund bestätigt). Ein Spiegelanteil auf Emissionsflächen (`material.specularColor` / `specularColorBlended` = 0 nach `lights_physical_fragment`) wurde getestet: Der Shader kompilierte nicht (Timeout bei der Aufnahme), nicht weiter verfolgt. Alle Shader- und Stimmungsexperimente sind zurückgenommen. Nächster Schritt: die Emissionsfarbe im Kit-Mesher nachmessen (Vertex-Farbe der `emit`-Flächen gegen den Modellwert) und den Spiegelanteil mit `specularColorBlended` an der richtigen Stelle (nach `lights_fragment_end`) testen.

Gelände Rom-Außenposten: `kits.gelaende` top `stone` und `steinDichte` 0,05 (neuer Terrain-Parameter, Standard unverändert). Im Bild rund `#93908A` unter `planet_day`, also zu grau, der Warmton fehlt. Offen.

Gates (Commits `e5c7d39` Baseline, `8b86d9e` assets): `hash-baseline --compare` Karten 72/72, `layout` 120/120, `deko` 120/120 und `deko_zellen` 60/60 nach Neuschreiben mit Grund. Die Baseline ist für `deko_zellen` und `deko` gegenüber main damit NICHT mehr der main-Stand: 30/60 bzw. 30/120 Außenposten-Germanen-Einträge geändert (Paket 6M). `npm test` Exit 0 ohne FEHLER. `check` grün. `check:assets` 0 Fehler, 48 Warnungen (vorher 46). `snap:mess` grün (Worst Case 11661 B). Golden: 60 Traces frisch gegen `Pantheon-main` (`--all --seeds 10`): alle 0 %, GOLDEN GRÜN.

Screenshots: `shots` im Scratchpad `6dtools\final\` (Seeds 1–2, Rom und Germanen, Station und Außenposten, kommando/reaktor/lager/zellen/quartier, `uebersicht`, `lp/helix.station`, `lp/methalle.siedlung`). Stand: Außenposten Germanen Lager zeigt Glut-Fenster und die Deckung in Eisen (Fass verschwunden); Germanen-Station Kommando zeigt keine sichtbare Glut mehr (offen).

## Nachtrag Glut (Paket 7, Merge `ort01-glut` in `ort01-int`)

Ursache (gemessen, Rom-Kommando): Die Amber-Linie (emit 0,6) kommt im Buffer korrekt an (Mesher: sRGB × emit, linearisiert, Wert (0,319; 0,108; 0,011)). Der Emissionszweig des Shaders liefert im gesehenen Raum #BC700B. Verloren geht sie im Nebel-des-Krieges-Zweig von `kit.js` (makeMaterial), der nicht gesehene Kacheln entsättigt und dimmt, auch Leuchtflächen. Gemessen außerhalb der Teamsicht: #6F584B (vorher).

Änderung (Commits `00d85c7`, `a4b0e7a`, `acaf540`, Merge `d402cbe`):
- `public/js/voxel/glut.js`: `glutAusnahme(art, bauweise)`, nur Kartenart station/aussenposten mit Bauweise rom/germanen.
- `public/js/voxel/kit.js`: Uniform `uGlutKeep`. Leuchtflächen im Nebel werden nur gedimmt (gleicher Faktor 0,58 + 0,42 fv), ohne Entsättigung. Übrige Fragmente unverändert. Programmschlüssel `kit-emit-fog-4`. Gemessen: Amber im ungesehenen Raum #935604 / #EE8E1F, im gesehenen #BC700B / #F9A056.
- `tools/test-glut.js` in `npm test`.
- `content/buehnen/bauweisen/rom.json`: `stimmung.aussenposten = rom_aussen` (vorher Renderer-Standard outpost_frost, nicht planet_day).
- Voxelwerk (Merge `538ad77`): `assets/moods/rom_aussen.json` (neu, warm, exposure 1,3, hemi 1,6); `assets/models/ort/rom/station/kartentisch.json` Kartenplatte Amber emit 0,6 → 0,35 (Konturlinien bleiben 1,0).
- `tools/ort01-shots.js`: Station standardmäßig mit Spielerfigur IM Raum (Raummitte, Sitzkamera). `--startpunkt` stellt das alte Verhalten wieder her (Raum dann oft außerhalb der Teamsicht, gedämpft).
- `public/voxel`: einmal aus Voxelwerk-Stand dieser Session synchronisiert (`npm run assets`, Commit `6d2c9c7` nach dem Merge).

Offen (Entscheidungen): Germanen-Glut bleibt bei ca. `#B85800` (Bau-Regel 3, emit ≤ 0,6). Designer-Review: auf Germanen-Stationen dominiert die Glut in den Screenshots (breite Bänder auf allen Kronen und Planken). Rom-Außenposten: Amber in der warmen Stimmung wirkt eher gold. Gelände Rom-Außenposten bei `#C2B5A6` (Ziel `#CFC2A6`). Nicht geprüft: Verfall und Umkämpft.

Gates (Stand `d402cbe`/`6d2c9c7`): hash-baseline Karten 72/72, deko_zellen 60/60, deko 120/120, layout 120/120, Layout-Parität 60/60; `npm run check` 0; `check:assets` 0 Fehler, 48 Warnungen; `npm test` Exit 0 (alle Blöcke, keine Fehler); `snap:mess` Worst Case 11661 B; Golden Trace siehe Abschlussbericht.

## Nachtrag 8 (Nacharbeit nach Designer-Review R3, Befunde B1–B6)

Commits: Voxelwerk `ort01-int`: `f9f2320` (Kit und Stimmung, B1–B3, B6), `18c8eb7` (Liege, Exposure 1,25). Spiel `ort01-int`: `83e6f61` (B4, Bauweisen), `fa79af2` (Übergabe), `31b6038` (`npm run assets`, eigener Commit, Voxelwerk-Stand `18c8eb7`).

### Befunde und Fixes
| Befund | Stand | Dateien (Voxelwerk `assets/models/kit/…`) | Quads (vorher → nachher) |
|---|---|---|---|
| B1 Germanen-Station Glut | umgesetzt: Glutband `h - 1`, `mode: paint`, emit 0,45 − 0,15·z; Glutschlitz p 0,3 → 0,1, emit 0,9 → 0,5, Höhe `min(2, h−2)` | `germanen/station/wand_krone.json`, `wand_fuellung.json` | Krone default 28 → 18, frei 24 → 20, ecke 32 → 21, kreuz 25 → 18, umkämpft 32 → 32; Füllung unverändert (default 25, umkämpft 64, Glutschlitz 29) |
| B2 Rom-Station Krone | umgesetzt: Rinnenlogik `lauf_x`/`lauf_z`/`ecke` wie germanisch, bündig `h − 1`, paint, emit 0,6 | `rom/station/wand_krone.json` | default 19 → 14 |
| B3 Rom-Außenposten Amber | umgesetzt: Rinne emit 0,6 → 1,1 (**Ausnahme Bau-Regel 3**, s. u.), beidseitige Einfassung stone_dark f 0,8 (4 Ops) | `rom/aussenposten/wand_krone.json` | 14 → 18 |
| B3 Rom-Dach | umgesetzt: Dachstreifen period 4 → 2, f 1,0 / 0,82; Traufrinne emit 0,6 → 1,1 (Ausnahme) | `rom/dach.json` | default 181 → 184, gross 334 → 342, max 417 → 432 (Budget 3.200) |
| B3 Dach-Variante je Gebäudetyp | **nicht gemacht**: `kit.js` reicht den Gebäudetyp nicht bis zum Kit durch (nur melden) | – | – |
| B3 Gelände dunkle Einzelvoxel | **nicht gemacht** (Feinschliff) | – | – |
| B4 Schmiedeherd in der Messe | umgesetzt: `leit.herzstueck.station` in `germanen.json`, `germanen_halle_holz.json`, `germanen_halle_stein.json` entfernt (Spiel, `content/buehnen/bauweisen/`). `leit_fuss`-Eintrag belassen. Deko 120/120, Karten 72/72 | Spiel `83e6f61` | – |
| B5 Krankenstation, Liege | Diagnose und Modelle umgesetzt, siehe unten | `ort/germanen/station/medliege.json`, `ort/rom/station/medliege.json` | Germanen 718, Rom 735 Quads (Budget 2.500) |
| B6 Rom-Stimmung | umgesetzt: `assets/moods/rom_aussen.json` exposure 1,3 → 1,25, fog `#CFC6B8` | `assets/moods/rom_aussen.json` | – |
| Feinschliff (Kronen über Ecken, rote Zellenarkade, Fugengitter Landeplatz) | **nicht begonnen** | – | – |

### B5, Diagnose (Rollenmodus)
- Frage: setzt der Rollenmodus `krankenstation.liege` (leit, pflicht)? Messung mit `shared/buehne.js` + `public/js/voxel/deko.js` (`streuen`), wie `kit.js` übergibt, inkl. `leitFuss` aus `bauweisen/<bw>.json`, Seeds 1–40, Kultur Rom und Germanen.
- Ergebnis: Liege gesetzt in **11/11** Krankenstation-Plätzen je Kultur (100 %). Keine Platzierungslücke.
- Fehlerquelle beim ersten Durchlauf war mein Messskript: ohne `leitFuss` entfällt jedes Hauptstück (`fussVon` braucht den Eintrag). Das Spiel übergibt ihn korrekt (`kit.js`, Zeile 1057).
- Ursache also rein optisch: Matratze (Germanen frost-Streifen Periode 4, Rom Marmor) ohne Kopfteil und ohne Kontrast zum Kissen. Von oben keine Liegefläche lesbar.
- Fix: Germanen: Matratze einfarbig `frost`, Kopfteil `metal_dark` mit Kupferkante. Rom: Kissen `trim` (Gold), Kopfteil `primary` mit Goldkante.
- Kontrollbild: `…\scratchpad\8\k2\rom\station\3-krankenstation_1.png` (Rom: Goldkissen klar lesbar). `…\k2\germanen\station\3-krankenstation_1.png` (Germanen: Liege weiterhin schwach erkennbar, Kopfteil zu klein in der Draufsicht). **Nicht erreicht**: Germanen-Liege von oben eindeutig.

### B6, Gelände und gelbe Fläche
- Pixelmessung auf dem Übersichtsbild (Gelände, sieben Punkte): bei exposure 1,3 Ziel verfehlt (`#C2B5A6` vorher); bei 1,1 nur `#B3A89A`; bei 1,2 `#BAAEA0`; bei **1,25 Mittel `#BDB2A4`** (Ziel ≥ `#BDB0A0`, erreicht). Gelände bleibt warm-beige. Bild: `…\scratchpad\8\k5\rom\aussenposten\3-uebersicht.png`.
- Gelbe Fläche neben der Station (Rom-Außenposten, Position ca. 760/700 in 1920×1080): bleibt sichtbar und wird mit der Belichtung heller (`#D5AF7B` → `#E2BB84`). Ursache **nicht belegt**. Plausibel: Punktlicht (`public/js/voxel/renderer.js`, `lightReq`, Standardfarbe `#FFC66B`), das Modelle mit Manifest-Tag `light` anfordern (`assets/manifest/art-ap.json` hat solche Einträge). Nicht geändert. Offen.

### Ausnahme Bau-Regel 3 (dokumentiert, Kai/Leiter 2026-10-26)
Rom-Außenposten: Rinne `emit` 1,1 bei Tag (Krone `rom/aussenposten/wand_krone`, Traufrinne `rom/dach`). Begründung: Amber liest sich bei 0,6 als Gold und sitzt unter der Gelände-Helligkeit. Nicht in `STIL-ORT01.md` (Branch `ort01-richtung`) eingetragen.

### Kritik der Bilder
- Germanen-Station (`k4\germanen\station\3-uebersicht.png`, `k1\germanen\station\3-kommando.png`): Glut ruhiger als R3, die Schlitze treten zurück. Die orangen Bänder auf den Außenkronen dominieren das Übersichtsbild aber weiter. Das ist eine Entscheidung für Kai, kein Fehler.
- Rom-Station (`k2\rom\station\3-krankenstation_1.png`): Amber-Linie auf den Kronen ruhig und klar, keine Gitter mehr.
- Rom-Außenposten (`k5\rom\aussenposten\3-uebersicht.png`): Dächer nicht mehr markisenhaft, Traufrinne als Gold-Amber-Linie lesbar, Gelände warm.

### Gates (Stand nach allen Änderungen, `npm run assets` mit `VOXELWERK_PATH`)
- `npm test`: Exit 0 (durchgelaufen, incl. `SIM KETTE OK`, „alle Läufe ok“).
- `npm run check`: Exit 0.
- `snap:mess`: Exit 0, Worst Case 11661 B.
- `hash-baseline --compare`: Karten 72/72, deko_zellen 60/60, deko 120/120, layout 120/120, Layout-Parität 60/60. Keine Baseline neu geschrieben.
- `check:assets`: 0 Fehler, 48 Warnungen (unverändert zu `6M`).
- Golden Trace: 60 Traces frisch gegen Pantheon-main (`--all --seeds 10`), `--compare`: 0 % Abweichung auf allen Vergleichspaaren, GOLDEN GRÜN. Verzeichnisse: `…\scratchpad\8\golden\main` und `…\golden\neu`.
- Prüfbogen (5 geänderte Kit-IDs, `--nur-pruefung`): 0 Fehler.
- `check` Kit (Filter einzeln): 0 Fehler.

### Screenshots (Ordner `…\scratchpad\8\`)
- `k1\`: Seeds 3–4, Station und Außenposten, Rom und Germanen, Übersichten.
- `k2\`: Krankenstation und Quartier, Seeds 3–4, Station.
- `k4\`: Endstand Seeds 3–4, Station und Außenposten, beide Kulturen, Übersichten.
- `k4lp\`: `helix.station`, `methalle.siedlung`, `eisenwald.siedlung`.
- `k5\`: Rom-Außenposten-Übersicht mit exposure 1,25.

### Nicht erreicht
- Germanen-Liege von oben nicht eindeutig lesbar (B5 teilweise).
- Feinschliff (Kronen über Außenposten-Ecken, rote Zellenarkade, Fugengitter Landeplatz) nicht begonnen.
- Dach-Variante je Gebäudetyp nicht gemacht (`kit.js` gibt den Typ nicht weiter).
- Gelbe Fläche bei Rom-Außenposten: Quelle nicht geklärt.
- Verfall und Umkämpft nicht im Bild geprüft.
