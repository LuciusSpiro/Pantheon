# Konzept Art: Bühnen & Bodenkampf (B1–B3)

Art Director · 2026-10-08 · Grundlage: Briefing B1–B3, CONTRACT-M4, `concept/ASSET-LISTE-VOXEL.md`, Voxelwerk
(`C:\Users\Luciu\projects\voxelwerk`, Stand `17f7bfb`), `public/js/voxel/*`, `shared/maps.js`, Vault Grafik/Welt/Worldbuilding.
Skizzen: `modul.svg` (Schablone Außenposten), `hex.svg` (Saumraum) im selben Ordner, je < 13 KB.

## 0. Drei Vorentscheidungen, die die Art-Liste bestimmen

1. **Ein Modul ist Daten, kein Mesh.** Module sollten ASCII-Ausschnitte (8×8 je Zelle) mit Ankern in `shared/maps.js`-Logik
   sein. Art liefert keine fertigen 8×8-Blöcke, sondern **Kits mit Autotile** (`conn`/`cut`, wie heute bei `lerche/kit/wall`,
   `away/kesh/wall_ruin`, `away/wreck/wall`) plus Props, die an Ankern stehen. Begründung:
   - Drehen und Spiegeln kosten dann **nichts**: Man dreht das Raster, die Wände setzen sich nach dem Zusammenbau selbst
     richtig zusammen, und es gibt keine Nähte an den Zellgrenzen.
   - Kollision kommt ohnehin nie aus dem Modell (CONTRACT-M4 §5), sondern aus `maps.js`.
   - Ein Kit-Teil wird für jede Schablone wiederverwendet, ein 8×8-Mesh nur für einen Platz.

   Gegenposition: Ganze Module als Voxelwerk-Szenen sehen handgemachter aus. Sie scheitern aber am Spiegeln (Voxelwerk und
   Platzierung kennen nur `rot`) und am Budget. **Das muss mit dem Tech Lead abgestimmt werden, sonst stimmt die Liste unten nicht.**
2. **Nur der Saumraum ist spielbar.** Wer dort wirklich wohnt: Konkordat, Rostmeute, Kustoden (Apkallu). Rom (Statio
   Limitis) und die Germanen sind in diesem Paket nicht erreichbar. Deshalb gilt:
   - Formsprache (eigene Kits) nur für **Konkordat**, **Rostmeute** (Schiff) und **Apkallu** (Ruine).
   - Rom und Germanen bekommen **Palette + Anbauten**. Das erfüllt Kais „dieselbe Karte als Rom/Germanen“, ist aber
     bewusst eine Zwischenlösung.
3. **Die Sektorkarte ist kein Voxelwerk-Asset.** Sternkarte, UI und Raumszene bleiben 2D (CONTRACT-M4 §0,
   `render.js` `drawStarMap`, `art.js` `ICONS`). Hex-Raster, Symbole und Bojen sind 2D-Canvas-Arbeit. Das Briefing ordnet
   sie unter „Voxelwerk“ ein, das korrigiere ich hier.

**Stunden:** Agenten-Arbeitsstunden im M4-Takt (Rezept, `npm run check`, Screenshot, Manifest), geschätzt und nicht
gemessen, ±50 %. **Status:** **vorh.** = existiert, nutzbar · **VW** = in Voxelwerk direkt machbar · **VW+** = braucht eine
Werkzeug-Erweiterung (siehe §2) · **Code** = kein Voxelwerk-Asset (FX in `fx.js`, UI in `render.js`/`art.js`).

---

## 1. Asset-Liste je Teilstufe

### B1 Bühnen

**Kit Außenposten** (Konkordat-Kolonialbau; Rom über das vorhandene `rom/bau/*`; 72×40, offen, ohne Dächer, Gebäude mit
geschnittenen Wänden wie an Bord)

| Asset | Anzahl / Varianten | Status | Std. |
|---|---|---|---|
| Bodenarten außen (Erde, Kies, Betonplatten, Gras), Terrainstufe 1 | 4 | VW (Terrain-Legende wie Kesh) | 3 |
| Zaun-Kit (gerade, Ecke, T, Ende), `conn`/`cut`, Zaunlücke (intakt/aufgeschnitten) | 5 Teile | VW | 4 |
| Mauer + Tor 2 Kacheln (zu/offen/gesprengt): Rom anpassen, Konkordat neu | 2 Bauweisen | Rom vorh. (`rom/bau/mauer`, `tor`) → anp.; Konkordat VW | 5 |
| Wachturm mit Scheinwerfer, Socket `aussicht` | 2 (Rom vorh. `rom/bau/wachturm`, Konkordat neu) | VW | 3 |
| Gebäude-Wandkit (Lagerhalle, Zellenblock, Kommando): Wand/Tür/Fenster, `conn`/`cut` | 1 Kit, `style` 0–2 | VW | 5 |
| Funkmast (`sprengpunkt`: intakt/geladen/gesprengt) | 1 | VW | 2 |
| Treibstofftank 1×1 + Tanklager 2×1 (`sprengpunkt`) | 2 | VW | 3 |
| Landeplatz 2×2 (`abholpunkt`, Markierung, Leuchten) | 1 | VW | 2 |
| Abflussgitter / Kanal (`eingang` technisch: zu/offen) | 1 | VW | 1,5 |
| Deckung außen: Sandsack/Energiebarriere (halb), Container/Kistenstapel (voll) | 4 | `rom/barriere`, `lerche/furn/crate` vorh. → anp. + VW | 3 |
| Streuprops (Fässer, Kabel, Laternen, Schilder, Werkzeug) | 8 | teils vorh. (`lerche/furn/barrel`, `rom/laterne`) | 4 |
| Zellentür / Energiegitter (`zelle`: zu/offen/belegt), auch für Station | 1 | VW | 2 |
| **Summe Außenposten** | | | **≈ 38** |

**Kit Raumstation** (Konkordat, innen, eng). Das Kit ist zugleich das **Innen-Grundkit** für Schiff und Wrack.

| Asset | Anzahl / Varianten | Status | Std. |
|---|---|---|---|
| Boden (Platte, Gitter, Markierung), `wear` | 3 | VW (Vorlage `lerche/kit/floor`) | 2 |
| Wand `conn`/`cut`, `style` Station | 1 | VW (Vorlage `lerche/kit/wall`) | 3 |
| Schott hackbar (zu/offen/gehackt/verriegelt), Druckschleuse/Andockring 2×1 | 2 | VW | 4 |
| Wartungsschacht (Gitterboden, Rohrwand, dunkel), Schleichweg | 2 | VW | 2 |
| Kontrollpult, Terminal (aus/an/gehackt), Wandmonitor | 3 | VW | 4 |
| Reaktor 2×2 (`sprengpunkt`: ok/überladen/gesprengt) | 1 | VW | 4 |
| Lager (Regal, Container), Quartier (Koje, Spind) | 4 | `lerche/furn/{shelf,bed}` → Palette + anp. | 4 |
| Deckung innen: Kistenstapel, halbhohes Schott, Pfeiler | 3 | VW | 3 |
| Licht (Wand, Notlicht), Decals (Konkordat-Siegel, Sektornummer, Warnstreifen) | 2 + 4 | `lerche/kit/light` anp. + VW | 3 |
| **Summe Station** | | | **≈ 29** |

**Kit Ruine** (Apkallu/Kustoden: geflutete Archive, Basalt, Bronze, violette Glyphen). Vieles gibt es schon von Kesh.

| Asset | Anzahl / Varianten | Status | Std. |
|---|---|---|---|
| Wand, Boden, Deckung halb, Pfeiler, Tor 2 breit, Schlüssel, Tafelsockel, Störrelais, Geröll | 9 | **vorh.** (`away/kesh/*`) | 0 |
| Säulengang-Arkade, Wasserrinne/Beckenboden | 3 | VW | 4 |
| Stufenkante + Empore (`aussicht`, nur optisch, Karte bleibt flach) | 2 | VW | 3 |
| Einsturzgang: Schutthaufen, gestürzte Säule, Bruchkante (offen/verschüttet) | 3 | VW | 3 |
| Rätselpaare: Glyphenschalter ×2, Lichtsäule + Spiegel, Sternpult (Basis 60) | 3 Paare | VW | 6 |
| Fund-Reliquiar (da/geborgen), Wächter-Ladenische (schläft/wach), Glyphenband (aus/an) | 3 | `tablet_pedestal` anp. + VW | 5 |
| Kleines Tor 1 Kachel | 1 | VW | 1,5 |
| **Summe Ruine Apkallu** | | | **≈ 23** |
| *Option: Akhu-Ruine* (Grabkammer, Tierkopf-Statue, Obelisk, Spiegel, eigene Palette) | ~8 | VW | *+18* |

**Kit Schiff innen** (fremdes Schiff = Rostmeute-Kanonenboot). Die Rostmeute baut lore-gerecht im **Mischbau**. Darum
dürfen die römischen Stationsformen der Lerche mit Palette `rostmeute` und Flickblechen wiederkommen. Das spart viel und
passt zur Lore.

| Asset | Anzahl / Varianten | Status | Std. |
|---|---|---|---|
| Innen-Grundkit `style` Schiff: Spanten, schräge Hüllwand, Gitterboden | 3 | VW (auf dem Stationskit) | 4 |
| Heck/Antrieb, Mitte/Reaktor, Bug/Brücke (Pilot, Taktik), Schildgenerator (`ziel`) | 5 | `lerche/station/*`, `lerche/console/*` → Palette `rostmeute` + Flickblech (`parts_b/patch`) | 8 |
| Batteriedeck, Laderaum (Netze, Container), Käfigzellen, Quartier (Hängematte, Schrott) | 4 Räume | teils vorh. (`station/battery`), Rest VW | 7 |
| Schleuse, Transferkammer, Hüllenbruch | 3 | Pad und Breach vorh. (`lerche/kit/{pad,breach}`), Schleuse VW | 1,5 |
| Mehr Deckung: Kisten, halbhohe Schotts, Fässer | 3 | VW | 2 |
| Besitz-Anbauten Rostmeute (Trophäen, Warngelb-Streifen, Schädelflagge) | 4 | VW | 2 |
| **Summe Schiff** | | | **≈ 25** |

**Querschnitt B1**

| Asset | Anzahl / Varianten | Status | Std. |
|---|---|---|---|
| Palette `konkordat` (neu), `rostmeute` + `nord` um Architekturrollen (stone, paving, wood) ergänzen | 3 | VW | 3 |
| Zustandspaletten verfallen/umkämpft je Besitz (Konkordat, Rostmeute, Rom, Germanen, Vorläufer) | 10 | VW von Hand per `extends`, oder 1 Filter (VW+, §2) | 3 |
| Zustand als Geometrie: `state` 0 intakt / 1 verfallen / 2 umkämpft an Wand, Boden, Tor/Schott, Deckung aller Kits | ~16 Teile | VW (`if` + `mode: paint`/`carve`), billiger mit `erode` (VW+) | 10 |
| Zustands-Streusets: Trümmer, Brandflecken, Einschusslöcher, Barrikaden, Moos/Rost | 6 | VW | 4 |
| Besitzzeichen: Banner/Standarte je Fraktion (Rom vorh. `rom/standarte`, `rom/bau/banner`) | 4 | VW | 4 |
| Abholpunkt-Bake (Bodenring + Leuchtpfosten), überall gleich | 1 | VW | 1 |
| Stimmungen: `station_konkordat`, `ship_rostmeute`, `ruin_apkallu`, `outpost_day`/`_dusk` (anp.) | 4 | VW (moods) | 3 |
| **Summe Querschnitt** | | | **≈ 32** |

**B1 gesamt ≈ 147 h** (ohne Akhu). Dazu kommt Tech-Arbeit, die nicht in Art steckt: ein generischer Kit-Renderer statt der
fest verdrahteten Zonen in `away.js`, Nebel des Krieges für alle Karten und die Vorschau für zusammengesetzte Karten.

**Umfang der Varianten (Vorschlag für §8):** Je Platztyp **3 Modul-Varianten** statt der geforderten 2. Mit Drehen,
Spiegeln, drei Zuständen und vier Paletten ergibt das genug Kombinationen. Die Abnutzung entsteht nicht durch die Zahl
der Module, sondern durch **Leitstücke, die man wiedererkennt** (der eine Funkmast, das eine Tor). Deshalb braucht es
**2 Formen je Leitstück** (z. B. Gittermast und Schüsselmast). Die Kosten dafür stehen in den Tabellen schon drin.

### B2 Bodenkampf

| Asset | Anzahl / Varianten | Status | Std. |
|---|---|---|---|
| **Niederhalter** (Rostmeute-Basis, Rollenteile) | 1 + Rom-Fassung | VW (`fig/rostmeute/*`, `fig/rom/*` als Basis) | 5 |
| **Grenadier** | 1 + Rom | VW | 5 |
| **Schütze** | 1 + Rom + Germanen | VW (Germanen braucht Teilesatz, s. u.) | 6 |
| **Enterer / Berserker** (2 Wunden, größer) | 1 + Germanen | VW | 6 |
| **Häscher** | 1 (Rostmeute, Sklavenjäger) | VW | 4 |
| Germanen-Teilesatz (Helm, Fellkragen, Runenplatten, Rumpf) | ~5 Teile | VW | 6 |
| Konkordat-Hafenwache als Palette + Helm (für Gefechte auf der eigenen Seite oder Verrat) | 1 | VW | 1,5 |
| Plünderer (`role` 0–2), Wächter Lamassu | – | **vorh.** | 0 |
| Posen: `aim_rifle` (beidhändig), `aim_heavy`, `charge` (Lanze, kniend), `launch`, `windup` + `strike`, `stagger` (betäubt), `unconscious`, `captured`/`carried` | 9 | VW (`poses/human.json`), Timing in `actors.js` | 7 |
| **Waffen am Handgelenk-Anker** mit `heat` 0–3 (Kühlrippen glühen): Blaster (Karabiner), Sturmgewehr, Granatwerfer, Lanze, Betäuber | 5 | VW (`scav_rifle` als Basis Sturmgewehr) | 9 |
| Nahkampfwaffe in 3 Formen (Gladius vorh. `fig/rom/gladius`; Bartaxt Germanen; Enterhaken-Säbel Rostmeute), `glow` beim Ausholen | 3 | VW | 3 |
| Pistole (der heutige `lerche/item/blaster` wird als Alias `item/pistol` geführt) | 1 | **vorh.** | 0,5 |
| Granate als Geschoss, Energiefesseln (Häscher) | 2 | VW | 1,5 |
| **FX:** Lanzen-Glühen + Ziellinie, Granatbogen + Aufschlagring + Explosion + Betäubungswolke, Betäubung (Funkenkranz), Hitze/Überhitzen (Dampf, Flackern), Ausholen (Klingenspur + Schlagsektor am Boden), Bewusstlosigkeit (langsamer Puls), Mündungsfeuer je Waffe, Nahkampftreffer, Fesseln | 9 | **Code** (`fx.js`, Muster `spawnFx`) | 20 |
| **UI:** Hitzebalken, Wunden-Pips (wie Schildsegmente, andere Form), Status-Icons (betäubt, bewusstlos, gefangen, überhitzt), 6 Waffen-Icons 12×12, Waffenwahl am Transporter | ~12 | **Code** (`hud.js`, `art.js` `ICONS`) | 7 |
| **B2 gesamt** | | | **≈ 82** |

Ungeklärt ist, ob der 2D-Fallback (`?render=2d`) die neuen Waffen und Gegner auch zeigen muss. Falls ja, kommen etwa
**+20 h** dazu.

### B3 Sektorkarte (alles 2D)

| Asset | Anzahl / Varianten | Status | Std. |
|---|---|---|---|
| Hex-Raster (flach, Spalten versetzt wie `karte_limes.py`), Zoom/Pan in der Konsole 640×360 | 1 | Code (`render.js`) | 4 |
| Fraktionsfarben als Flächen + Muster (Farbsehschwäche), unerkundet (Umriss, schraffiert), Leerraum, sichtbar-gesperrt (abgedunkelt) | 8 + 3 | Code | 3 |
| Hex-Symbole 12×12: Hafen/Station, Gasriese, Ruine, Piratenbasis, Asteroiden, Nebel, Boje, Heimathafen, Schrein, Festung, Wrack | 11 | Code (`ICONS`) | 4 |
| Sektor-Einfluss-Icons (Gas, Asteroiden, Nebel, Eruption, Gezeiten, Trümmerstrom, Dämpfung, Minen) | 8 | Code | 2,5 |
| Kantenstile + Bojen-Zustände: aktiv, gesperrt, temporär, ohne Strom, verborgen, Fernsprung | 6 | Code | 2 |
| **Boje in der Raumszene** (Sprite, 4 Zustände), denn dort fliegt man sie an | 4 | Code (`art.js`, Raum bleibt 2D) | 3 |
| Spielermarker, Kursvorschau, Fächer für den Notfallsprung, Hex-Detailpanel | 4 | Code | 4 |
| **B3 gesamt** | | | **≈ 22** |

**Art gesamt ≈ 250 h** (B1 147 + B2 82 + B3 22), mit Akhu ≈ 270 h. Bei 4 Art-Teams parallel wie in M4 sind das etwa 2 Takte
für B1 und 1 Takt für B2. B3 kann ein UI-Team allein machen.

---

## 2. Was Voxelwerk kann und was nicht

**Kann es heute (geprüft im Code):**
- Rezepte mit `params`, `seed` und `variants`. Zustände sind Zahlenparameter (`state`, `open`, `decay`), `npm run check`
  baut jeden davon.
- **Paletten tauschen beim Bauen:** `Library.build(id, { palette, colors })`. Der Loader im Spiel cacht je
  `(id, params, palette, colors)`. Besitz pro Karte geht also schon heute. `use` mit `palette` für Fremdteile (Banner des
  Besitzers am Konkordat-Bau) gibt es auch.
- Autotile-Konvention `conn`/`cut` (Bitmaske N1 O2 S4 W8), Drehen in 90°-Schritten (`group.rot`, Szene `rot`),
  Spiegeln **innerhalb** eines Modells (`mirror`), Leuchten (`emit`, Rollen `glow`/`glow2`).
- Figuren aus Rig, Teilen und Anbauten. Waffen hängen an `handR` und zielen mit. Figurenparameter (`role`, `rank`) laufen
  in die Teile.
- Terrain aus Zeichenkarten (1 Voxel/m), Stimmungen, Manifest-Pipeline (`sync-assets`, `check-assets`, Galerie mit
  Spielkamera).

**Lücken (ehrlich):**

| Lücke | Folge | Vorschlag | Aufwand |
|---|---|---|---|
| **Kein Kachelraster und keine Anschluss-Hilfen im Editor** (8×8-Zelle, Türmitte 2 Kacheln) | Art baut blind gegen das Raster | Raster-Overlay + Kantenmarken im Editor/Galerie | 2 h |
| **Keine Vorschau zusammengesetzter Karten** | Man sieht nie die Gesamtwirkung einer Karte (`seed` → Karte) | Galerie-Modus `?map=outpost&seed=3` über den Kit-Renderer | 1 Tag (Tech) |
| **Spiegeln bei der Platzierung fehlt** (nur `rot`) | Mit Modul = Daten egal; mit Modul = Mesh ein Blocker | Module als Daten (§0); einzelne Props werden nur gedreht | 0 |
| **Kein Zustandsfilter für Paletten** | 5 Besitzer × 2 Zustände = 10 Paletten von Hand | `extends` + `adjust: { sat, light, tint }` im Palettenkern | 3 h |
| **Kein `erode`-Schritt** (Kanten zufällig abtragen, je `seed`) | „Verfallen“ muss in jedem Kit-Teil von Hand gebaut werden | neuer Bauschritt `erode` { density, depth } | 4 h |
| **Parameter in Farbangaben und `emit`** (offener Formatwunsch) | Hitze-Glühen der Waffen nur über 4 `if`-Kopien | `emit: "heat*0.6"` zulassen | 2 h |
| **Anker nur als ein Pivot im Rezept**; Sockets stehen von Hand in Metern im Spiel-Manifest | fehleranfällig, man sieht sie nicht | Sockets in der Galerie als Marker anzeigen | 2 h |
| **Keine Effekte** | Glühen, Bögen, Betäubung sind Code in `fx.js` (Partikel), kein Asset | kein Voxelwerk-Thema; Telegraf-Grammatik §3 als Vorgabe für ACTORS | – |
| **Kein beidhändiges Halten** (keine IK, `handL` hängt nicht an der Waffe) | Gewehre wirken einhändig | 3 Griffklassen (Pistole, Gewehr, schwer) als Posen; Waffenlänge pro Klasse festlegen | in Posen |
| **Karte ist flach** | Hügel und Empore für `aussicht` sind nur Kulisse. Steht eine Figur dort, versinkt sie im Hang | flache „Plateaus“ mit Kante statt Hang; oder Bodenhöhe im Actor-Layer (Tech) | Entscheidung |
| **Budget auf großen Karten** | 72×40 ist 2,3-mal Kesh (48×26); Stonehearth-Dichte sprengt 400k Dreiecke | Streubudget **≤ 12 Props je Zelle**; früh messen | – |

Empfehlung: Raster-Overlay, Palettenfilter und `erode` **vor** dem Kitbau machen. Zusammen etwa 1 Tag, und sie sparen in
B1 grob 15 h.

---

## 3. Lesbarkeit

### Gegnerrollen ohne Erklärung
Grundregel: **Die Rolle steckt in der Silhouette, die Fraktion in Palette und Rüstungsteilen.** Die Leitform einer Rolle
bleibt in jeder Fraktion gleich. Eine Römerin mit Lanze liest sich genauso als Schützin wie ein Pirat mit Lanze.

| Rolle | Leitform von oben (57°) | Telegraf (was man vorher sieht) |
|---|---|---|
| **Plünderer** | normale Figur, Gewehr | Mündungsglühen 0,3 s |
| **Niederhalter** | **breit**: schwere Schulterplatten, Kastenmagazin, Gewehr mit Kühlrippen | Dauerfeuer mit Leuchtspur, die Rippen glühen sichtbar hoch; Funk „Ich halt sie fest!“ |
| **Grenadier** | **Rückentrommel** + kurzes, dickes Rohr | Anlegen 0,6 s, **gestrichelter Bogen + Aufschlagring am Boden**, der sich füllt |
| **Schütze** | **schlank**, Lanze länger als der Körper, ein Leuchtauge am Visier | steht still, **dünne Ziellinie wird dicker und heller** (1–1,5 s), Ton steigt |
| **Enterer** | **größer (110 %)**, vornübergebeugt, große Klinge, keine Fernwaffe | **Ausholen 0,45 s**: Klinge glüht, Schlagsektor flackert am Boden |
| **Häscher** | Fesselschlaufen am Gürtel, Stab mit blauem Kopf, Maske | blaues Laden am Stab, Energiefessel als Bogen |
| **Wächter** | vorh. Lamassu, Frontbogen | vorh. |

**Telegraf-Grammatik (für Spieler und Gegner gleich):** Je gefährlicher, desto länger und heller. Farben richten sich nach
dem **Wirkungstyp, nicht nach der Fraktion**:
- **Glut-Orange:** Schaden in einer Fläche (Granatring, Schlagsektor)
- **Weißgold:** Präzisionsschaden (Lanze)
- **Elektrisch-Blau:** außer Gefecht, nicht tot (Betäuber, Granaten-Betäubung). Das liegt bewusst nah am EMP-Eisblau
  #A9D6E5, denn beides heißt „ausgeschaltet“.
- **Fraktions-Glow** (Rostmeute rot, Kustoden violett) bleibt Deko und darf nie wie ein Telegraf aussehen. Prüfpunkt in
  der Galerie.

**Bewusstlos und verwundet müssen sich unterscheiden:** Verwundet heißt Rückenlage, Pistole oben, rote Pips. Bewusstlos
heißt Seitenlage, Waffe liegt daneben, langsamer blauer Puls. Gefangen heißt Fesseln, kniend.

### Fraktionen bei gleichem Modul
Drei Schichten, von billig nach teuer:
1. **Palette** (Rollen `primary/trim/metal/glow`): färbt das ganze Kit um.
   - Konkordat: Stahlgrau, Signal-Ocker, Siegel-Violett
   - Rostmeute: Rost, Stahlblau-Flicken, Warngelb (vorh.)
   - Rom: Rot, Marmor, Gold (vorh.)
   - Germanen: Eisen, Frostblau, Knochenweiß (`nord`, vorh.)
   - Kustoden: Basalt, Bronze, Violett (vorh.)
2. **Besitz-Anbauten an festen Sockets** (`banner`, `trophy`, `barricade`): Siegelbanner des Konkordats, Schädelflagge und
   Flickbleche der Rostmeute, Standarte (Rom), Runenschild (Germanen). Diese Teile ändern die **Silhouette**, die Palette
   allein tut das nicht.
3. **Eigene Formsprache** (eigenes Kit): nur für die drei Saumraum-Fraktionen (§0).

Erfahrungswert: Nur die Palette zu tauschen sieht aus wie „dieselbe Basis, umgestrichen“. Erst die zweite Schicht lässt
einen Ort wirklich wie den Ort einer anderen Fraktion aussehen.

**Zustände:**
- **verfallen:** Kanten abgetragen, Moos/Rost, entsättigte Palette, Licht aus, Staub
- **umkämpft:** Ruß, Einschusslöcher, Barrikaden quer zu den Wegen, Feuer-FX, Notlicht

Den Zustand liest man zuerst am **Licht** (Stimmung), dann an der Form.

---

## 4. Look der Kartenarten

- **Außenposten:** Warmes, tiefes Tageslicht oder Dämmerung (`planet_day`/`planet_dusk`). Grober Erdboden, gegossene
  Betonplatten, Gitterzäune, Scheinwerfer, die abends lange Kegel werfen. Die Farbwelt ist erdig (Ocker, Staubgrün, Stahl),
  dazu die Fraktion als kräftiger Akzent auf Bannern und Toren.
- **Raumstation:** Kühles Leuchtstofflicht von oben, glänzende Platten, Warnstreifen, Siegel des Konkordats an jedem Schott.
  Die Farbwelt ist grau-blau mit Ocker-Markierung, eng und ordentlich, Behördencharme. Schotts und Terminals sind die
  einzigen hellen Punkte.
- **Ruine (Apkallu):** Dunkler Basalt, alte Bronze, stehendes Wasser in Rinnen, das violette Glyphen spiegelt
  (`precursor_neon` → `ruin_apkallu`). Die Farbwelt ist fast schwarz, darin Violett und Türkis. Gefechtsräume sind hoch und
  hallend, das Innerste ist eng und still.
- **Schiff (Rostmeute):** Natriumorange und Rotlicht, Rauch in Gängen, Rippen und Spanten wie in einem Tierskelett,
  Flickbleche in anderem Blau. Die Farbwelt ist Rost, Warngelb und Dunkelbraun. Am engsten ist es mittschiffs, die Brücke
  ist kalt hell beleuchtet als Ziel.
- **Hex-Sektorkarte:** Ein dunkler Kartentisch (#0B0E1A). Die Hexe sind gedeckte Fraktionsflächen, damit helle Schrift
  darauf ≥ 5,4:1 erreicht. Sprungpunkte sind **Bojen auf den Kanten**: gold für aktiv, glut-gestrichelt mit × für
  gesperrt, eisblau gepunktet für temporär, grau hohl für „ohne Strom“. Unerkundetes zeigt nur einen gestrichelten Umriss
  mit „?“. Gesperrt Sichtbares (der Rest der Karte Limes) bleibt in Farbe, aber abgedunkelt. Skizze: `hex.svg`.

---

## 5. Palette fürs Pitch-Deck

**Empfehlung: Wir bleiben bei der S2-Palette und ergänzen einen Akzent „Glut“ #FF8A4C** für Gefahr, Hitze und Gefecht.
Die anderen Farben ersetze ich nicht. Eisblau, Bronze und Gold sind schon als Marke gesetzt, und Gold wird weiter für das
Ziel gebraucht.

| Rolle | Hex | auf #0B0E1A | auf #141A2A | auf #2E3A4A |
|---|---|---|---|---|
| Hell (Text) | #F4EEDC | 16,6 | 15,0 | 9,9 |
| Eisblau | #A9D6E5 | 12,3 | 11,1 | 7,4 |
| Gold | #FFC66B | 12,4 | 11,2 | 7,4 |
| Bronze | #C9974A | 7,3 | 6,6 | **4,4** (nur für Flächen) |
| **Glut (neu)** | **#FF8A4C** | 8,2 | 7,4 | 4,9 |
| Gedämpft (Nebentext) | #9AA6B8 | 7,8 | 7,0 | 4,7 |

- Die Kontraste habe ich nach WCAG 2.x berechnet. Alles liegt über 4,5:1, außer Bronze auf #2E3A4A.
- Ich habe #FF8A4C statt #FF6B3D gewählt. Der rötere Ton fällt auf #2E3A4A unter 4,5 (4,1) und wird für Rot-Grün-Schwache
  dem Rom-Rot zu ähnlich.
- **Regel:** Glut steht nur für Gefahr und Gefecht (Granatring, Gefechtsbereich, gesperrt). Gold steht für Ziel und Wert.
  Beide nie als Paar nebeneinander für zwei verschiedene Bedeutungen auf einer Folie.
- **Fraktionsflächen im Deck:** Konkordat #4A4466, Rom #6B2E2E, Piraten #5C3A1E, Vorläufer #1F5555. #F4EEDC darauf erreicht
  7,3–8,8:1.
- Schriften bleiben **Cinzel** (Titel) und **IBM Plex Sans** (Text). Die SVGs nennen IBM Plex Sans mit Fallback auf
  sans-serif.

---

## 6. Skizzen
- `modul.svg`: Schablone Außenposten A, 9×5 Zellen, Plätze mit Typ, Bereiche (hinein/Gefecht/Ziel/Rückzug), Anschlüsse
  in der Kantenmitte (offen/Tür/Wand/Zaun), Anker als Symbole, 3 Eingänge und 2 Abholpunkte (12,4 KB).
- `hex.svg`: Saumraum 0105–0408 mit den echten Verbindungen aus `karte_limes.py`. Bojenzustände sitzen auf den Kanten,
  dazu der Fernsprung nach Eridu, Rostnest unerkundet und Statio Limitis sichtbar, aber gesperrt (12,9 KB). „Temporär“
  (0406–0407) und „ohne Strom“ (0207–0208) sind als Beispiel gekennzeichnet.

---

## 7. Offene Art-Entscheidungen für Kai

| Frage | Empfehlung |
|---|---|
| Modul = Daten (ASCII + Kit) oder Modul = fertiges Voxel-Mesh? | **Daten + Kit.** Drehen und Spiegeln kosten nichts, es gibt keine Nähte, und es ist billiger. Bitte gemeinsam mit dem Tech Lead entscheiden. |
| Formsprache für Rom und Germanen jetzt schon? | **Nein**, nur Palette + Anbauten. Beide sind im Saumraum nicht spielbar. Eigene Kits kommen mit dem Feldzug Eisenwald. |
| Ruine: Apkallu allein oder auch Akhu? | **Nur Apkallu in B1.** Das passt zu Kustoden, Kesh und Eridu. Akhu kostet etwa 18 h und hat im Saumraum keinen Ort. |
| Fremdes Schiff: Rostmeute im Mischbau mit Lerche-Stationsformen? | **Ja.** Das ist lore-gerecht (Piraten bauen aus Beute) und spart rund 15 h. |
| Hügel und Emporen für `aussicht`: echte Höhe oder Kulisse? | **Flache Plateaus mit Kante**, bis der Actor-Layer Bodenhöhe kann. Kein Hang, in dem Figuren versinken. |
| Rollen auch per Symbol über dem Kopf zeigen? | **Nein.** Der Prüfstein heißt „ohne Erklärung“. Lesbar machen es Silhouette, Telegraf und Funk. Symbole höchstens als Barrierefreiheits-Option. |
| Muss der 2D-Fallback die neuen Waffen und Gegner zeigen? | **Nein**, 2D gilt nur noch als Notfall-Modus. Das spart etwa 20 h. |
| Voxelwerk-Erweiterungen (Raster-Overlay, Palettenfilter, `erode`, `emit`-Ausdrücke) vor dem Kitbau? | **Ja**, etwa 1 Tag. Das spart etwa 15 h in B1 und macht „verfallen“ über alle Kits gleich. |
| Deck-Akzent? | **Glut #FF8A4C ergänzen**, sonst bleibt die S2-Palette. |

---

## 8. Nachrunde nach Kais Feedback (2026-10-08)

**Kai (verbindlich):**
1. Rom und Germanen bekommen eigene Bauweisen und Bodentruppen.
2. Die neuen Gegner werden Germanen.
3. Die Orte werden auf die Kampagne ausgerichtet: **Station = Germanen**, **Ruine = Römer**.
4. Lieber Systeme bauen, die die Arbeit dauerhaft erleichtern.

Damit sind §0 Punkt 2, die Kit-Zuordnung in §1 und Teile von §7 überholt.

**Annahme bis zum Vorschlag des Lead GD:** **Außenposten = Rom**, **Schiff = Germanen**. Wo das gilt, steht *(Annahme)*.

### 8.1 Was es schon gibt (geprüft in `voxelwerk/assets`)
- **Rom, viel vorhanden:**
  - Bauten: `rom/bau/{mauer, tor, wachturm, zinnen, lagerfront, saeule, pflaster, banner, adler}`
  - Props: `rom/{kiste, barriere, laterne, standarte, standartenfuss, energiezelle, zellenregal, waffenstaender, pilum, scutum}`
  - Natur: `natur/{zypresse, gras, stein}`
  - Szene `rom-aussenposten` (36×28 m), Paletten `rom`, `rom_schiff`, `lerche_rom`, `planet_mediterran`
  - Figur `rom/legionaer` mit 11 Teilen (`fig/rom/*`, Parameter `rank`)
  - Das ganze Lerche-Innenkit (`lerche/kit/*`, `lerche/station/*`) ist schon römisch. Es kann als Grundlage für römische
    Innenräume dienen.
- **Germanen, fast nichts:**
  - Vorhanden sind nur die **Schiffsrümpfe außen** (`schiff/<klasse>/nord`, 9 Rezepte) und die Palette **`nord`**.
  - `nord` hat **keine Architekturrollen** (stone, paving, wood, soil, Fell). Diese Rollen fallen heute auf `base` zurück.
  - Es gibt keine Bauteile, keine Props und keine Figurenteile.
  - Die Formsprache steht aber fest: geklinkerte Metallplanken, Runen als Schaltkreise, Fell über Technik
    ([[Die vier Völker]]). Und es gibt den passenden Ort: die **Methalle** (0705) ist eine Versorgungsstation und das
    Sprengziel des Feldzugs.

### 8.2 Neue Asset-Liste (Stunden wie oben, ±50 %)

**B1 Bühnen**

| Kit | Inhalt | Status | Std. |
|---|---|---|---|
| **Außenposten Rom** *(Annahme)* | Mauer/Zinnen als Autotile, Tor (zu/offen/gesprengt), Wachturm, Gebäude-Wandkit (Lerche-Wand mit Palette `rom`), Funkmast, Treibstofflager, Landeplatz, Cloaca-Gitter (Eingang technisch), Carcer-Zelle, Deckung, Streuprops, Bodenarten | ~60 % vorh. → anp. + VW | **25** (statt 38) |
| **Germanen-Innenkit** (ein Kit für Station **und** Schiff, `style` 0 Halle / 1 Langschiff) | Boden (Metallplanken, Gitter, Fell), geklinkerte Wand `conn`/`cut` mit Runenfugen, Rundschild-Schott (4 Zustände), Andockring, Wartungsschacht, Runenstein-Terminal, Reaktor als „Schmiedeherd“ 2×2, Langbänke, Truhen, Fässer, Deckung (Schildwall-Barrikade, Pfeiler), Feuerschalen-Licht, Clan-Decals | neu (VW) | **31** |
| Palette `nord` um Architekturrollen ergänzen | stone, paving, wood, soil, fur | VW | 1,5 |
| **Station Germanen (Methalle)** | Platztypen aus dem Innenkit, dazu Kontrollraum mit Hochsitz und Met-Lager | VW | 4 |
| **Schiff Germanen** *(Annahme)* | Spanten/Rumpfschräge (`style` 1), Antrieb, Reaktor, Brücke mit Hochsitz-Konsole, Schildgenerator, Batteriedeck, Käfigzellen, Laderaum, Schleuse; Pad und Breach vorh. | VW | **18** (statt 25) |
| **Ruine Römer** | auf `rom/bau/{saeule, mauer, tor, pflaster}` + `erode`: Arkade, Treppe/Empore, Einsturzgang, Rätselpaare, Fund-Nische, Wächter-Nische, kleines Tor | anp. + VW | **18–22** (je nach Ruinenart, §8.5) |
| Querschnitt | Zustands-Streusets, Banner (Rom vorh., Germanen Runenschild), Abholpunkt-Bake, 3 Stimmungen (`hall_nord` mit Feuerschein, `ruin_rom` in der Dämmerung, `ship_nord`) | VW | **13** |
| **B1 gesamt** | | | **≈ 112** (statt 147) |

**Fällt weg:**

| Was | Ersparnis | Anmerkung |
|---|---|---|
| Konkordat-Stationskit | −29 h | Palette `konkordat` bleibt als Besitzvariante (1 h) |
| Apkallu-Ruine | −23 h | Die Kesh-Teile bleiben für Kesh |
| Rostmeute-Schiff im Mischbau | −25 h | |
| Konkordat-Außenposten | −38 h | wird zu Rom mit 25 h |

Die Germanen sind teurer als Rom, weil dort alles neu ist. Rom wird billig, weil das meiste schon da ist.

**B2 Bodenkampf: Germanen**

| Asset | Status | Std. |
|---|---|---|
| Germanen-Teilesatz auf `fig/basis`: 2 Helme, Rumpf (Platten + Fell), Arme, Beine | neu | 10 |
| 6 Rollen-Aufsätze (Rücken, Schulter, Kopfaufsatz, ggf. Fellumhang): **Krieger** (entspricht dem Plünderer), Niederhalter, Grenadier, Schütze, Enterer, Häscher | neu | 12 |
| Häuptling/Rang (Boss mit mehr Wunden) über `rank` | neu | 2 |
| 6 Waffen in Germanen-Bauweise (Bartaxt als Nahkampf) + Pistole, `heat` 0–3 | neu, Basis-Silhouetten fraktionsneutral | 12 |
| Posen (9), FX (9, Code), UI (Code) | wie §1 | 34 |
| **B2 gesamt** | | **≈ 70** (statt 82) |

- **Rom-Bodentruppen: später**, im Feldzug. Der Teilesatz ist durch den Legionär zu ~70 % da. Mit dem Figurenbaukasten
  (§8.3) kosten 6 Rom-Rollen dann etwa **6–8 h** statt 24.
- Damit der Baukasten wirklich trägt, sollte in B2 **eine** Rom-Rolle (Schütze) als Probe gebaut werden (1 h).
- Der Rostmeute-Plünderer bleibt für den Saumraum, wie er ist.

**B3:** unverändert ≈ 22 h.
**Art gesamt ≈ 205 h + Systeme (§8.3) ≈ 40 h.**

### 8.3 Systeme, die dauerhaft Arbeit sparen

| System | Was es macht | Kosten | Ersparnis je künftigem Kit/Fraktion | Urteil |
|---|---|---|---|---|
| **Figurenbaukasten Rolle × Fraktion** | `roles.json` (Rücken, Schulter, Kopfaufsatz, Waffentyp, Pose) × `factions/<f>.json` (Teilesatz, Palette, Waffen-Bauweise); ein Generator schreibt daraus `figures/<f>/<rolle>.json`. Dasselbe Prinzip trägt später den NSC-Baukasten (Asset-Katalog §6). Mitbeheben: `figureObject` reicht `opts.params` nicht an die Teile weiter (Bericht ART-G). | 6 h | 6 Rollen: ~24 h → ~10 h je Fraktion (nur noch der Teilesatz). Bei Rom, Ägypten, Babylon und Himmelsreich ≈ **55 h** | **lohnt sich, zuerst** |
| **Kit-Gerüst + Bauweise als Teilesatz** | Ein Kit-Rezept enthält Maße, `conn`/`cut`-Logik, Türöffnung in der Kantenmitte und Sockel/Krone. Die Bauweise füllt nur Steckplätze (Wandfüllung, Kante, Krone, Tür, Pfeiler). Heute geht das mit `if: "bauweise==n"`, ist aber geschwätzig. Sauber wird es mit `use` und Vorlage `"model": "kit/{bauweise}/krone"` (geprüft: `use.model` ist heute ein fester String; Kern + Abhängigkeitsauflösung müssen erweitert werden). | 4 h | Neues Innen- oder Mauer-Kit ~25–30 h → ~10 h. Bei 4 weiteren Völkern ≈ **70 h** | **lohnt sich**. Grenze: Alle Kits teilen dann das Raster und die Proportionen. Für fremde Vorläufer-Formen kein Gerüst verwenden. |
| **Zustandsfilter (Palette `adjust`) + `erode`** | „verfallen/umkämpft“ automatisch für jedes Kit-Teil und jede Palette | 7 h | ~5 h je Kit, ~2 h je Fraktion; die Ruine Römer wird dadurch billig | **lohnt sich** |
| **Kit-Prüfblatt** | Rendert automatisch alle 16 `conn`-Fälle × `cut` × `style` × `state` als Kontaktbogen und prüft, ob die Türöffnung frei ist, plus Footprint und Höhe | 6 h | ~3 h Fehlersuche je Kit, und Nahtfehler fallen nicht erst im Spiel auf | **lohnt sich** |
| **Kartengalerie** (`?map=<art>&seed=n` in Voxel) | zeigt ganze zusammengesetzte Karten | 1 Tag (Tech) | nicht in Stunden messbar: Ohne sie beurteilt Art keine Karte. Dient zugleich der Abnahme „3 seeds“. | **Pflicht** |
| **Deko-Streuung per Regel** | je Platztyp eine Regel („Lagerhalle: 6–10 Kisten an Wänden, Gänge 2 Kacheln frei, nie auf Anker- oder Wegkacheln“) | 1 Tag (Tech) + 1 h je Kit | Von Hand platzieren kostet ~0,5 h je Modulvariante; bei ~60 Varianten ≈ **25 h** schon in B1 | **lohnt sich, aber nur für Deko**. Deckung bleibt von Hand im Modul, weil sie Spielregel ist. |
| Waffen-Bauweise als Steckplatz | Silhouette je Waffentyp fest, Fraktion über 1–2 Anbauten | im Kit-Gerüst enthalten | ~3 h je Fraktion | mitnehmen |
| Gebäude-Generator, automatisches LOD, Voxel-Malen im Editor, Text→3D (GX10) | | | | **lohnt sich jetzt nicht**: G1-Gebiet, Budget reicht, MagicaVoxel gibt es, Qualität ist unklar |

**Kosten der Systeme ≈ 40 h** (davon 2 Tage Tech). Sie **amortisieren sich ab der zweiten Fraktion** und laufen deshalb
**vor** dem Kitbau. Ehrliche Grenze: Die Systeme machen Varianten billig, aber nicht gut. Die Leitstücke (Tor, Reaktor,
Hochsitz) bleiben Handarbeit, und daran erkennt man einen Ort wieder.

### 8.4 Lesbarkeit, wenn alle neuen Gegner Germanen sind
**Die Regel hält.** Es ist sogar der strengere Test: Innerhalb einer Fraktion bleibt **nur** die Silhouette als
Unterscheidung, und genau das prüft Kais Prüfstein.

Drei Risiken mit Gegenmaßnahme:
1. **Germanen-Look macht alle massig** (Fell, Platten, Äxte), dann verschwimmen Enterer und Niederhalter.
   - Gegenmaßnahme: feste Größenklassen je Rolle. Enterer 110 % hoch ohne Fernwaffe; Niederhalter breit mit langem
     waagrechtem Gewehr; Schütze schlank, Kapuze statt Fellumhang; Grenadier mit Rückentrommel; Häscher mit Ketten/Netz
     und Stab; Krieger mittel.
   - Der Fellumhang ist ein **Rollen**teil, kein Fraktionsteil.
2. **Rundschilde lesen sich als Frontschild** (die Wächter-Mechanik).
   - Regel: Bei Germanen hängen Schilde **nur auf dem Rücken**. Ein Schild vorne bedeutet immer echte Frontdeckung.
3. **Farbkonflikt:** Die Runen in `nord` leuchten frostblau (#8FD8FF). Das liegt am Telegraf „Elektrisch-Blau =
   außer Gefecht“.
   - Gegenmaßnahme: Runenglow gedämpft (emit ≤ 1,2) und immer ruhig. Telegrafe pulsieren und haben eine Bodenmarke.
   - Prüfung in der Galerie. Klappt das nicht, wird das Runenlicht kälter-weiß.

Zwischen den Fraktionen (Rostmeute-Plünderer gegen Germanen-Krieger) gilt die Regel weiter: gleiche Leitform, andere
Teile und Palette.

### 8.5 Änderungen an den offenen Fragen (§7)

| Frage | neu |
|---|---|
| Rom/Germanen-Formsprache? | **entschieden (Kai): ja**, entfällt |
| Apkallu oder Akhu? | entfällt. **Neu:** Ist die „Ruine Römer“ ein **verfallener Römerbau** (~18 h, fast alles aus `rom/bau` + `erode`) oder eine **Testudiner-Ruine** (Vorläufer der Römer, rasterförmig, Panzerplatten, Formations-Rätsel, ~22 h)? **Empfehlung: Testudiner.** Das passt zu Rätselpaaren, Wächtern und „Vorläufer-Ruine“ im Katalog. |
| Rostmeute-Schiff im Mischbau? | entfällt. **Neu:** Schiff = Germanen, Außenposten = Rom *(Annahme, Lead GD)* |
| Werkzeug-Erweiterungen zuerst? | **erweitert** zum Systempaket §8.3 (~40 h), Empfehlung stärker als vorher: **ja, vorher** |
| **Neu:** Rom-Bodentruppen jetzt? | **Später.** In B2 nur eine Probe-Rolle |
| **Neu:** Germanen als Gegner im Saumraum, wo nur der Saumraum spielbar ist? | Lore- und Spielfrage an den Lead GD. Art liefert beides; Rostmeute bleibt verfügbar |
| **Neu:** Runenfarbe der Germanen | gedämpftes Frostblau, falls es den Telegraf stört, kälter-weiß (§8.4) |
| Plateaus, keine Rollensymbole, kein 2D-Fallback, Deck-Akzent Glut | **unverändert** |

### 8.6 Umrechnung auf die Zuordnung des Lead GD (gamedesign.md §10)
Station, Außenposten und Schiff werden germanisch. Die Ruine wird ein **römisches Grenzkastell, verfallen**. Das begonnene
`rom-aussenposten` wandert in die Ruine, mit Fahnenheiligtum und Legionskasse. Rom stellt nur den Kastell-Automaten.

| Teilstufe | Posten | Std. |
|---|---|---|
| B1 | Germanen-Grundkit, gemeinsam (Hallenwand `conn`/`cut`, 3 Böden, Tür/Schott, Schildwall-Deckung, Feuerschalen, Runen-Decals, Truhen/Fässer/Bänke, Käfigzelle, Runenstein-Terminal) | 28 |
| B1 | Außenposten-eigen (Palisade als Autotile, Tor, Krähenwacht-Turm, Frost-/Schlammboden, Runenmast, Tanklager, Landeplatz, Abfluss, Plateau) | 20 |
| B1 | Station-eigen (Metallhalle, Andockring, Schacht, Schmiedeherd-Reaktor, Hochsitz-Kontrollraum) | 12 |
| B1 | Schiff-eigen (Spanten/Rumpfschräge, Antrieb, Brücke, Schildgenerator, Ruderbank-Batteriedeck, Schleuse) | 14 |
| B1 | 2 Leitstücke je Kartenart, von Hand | 6 |
| B1 | Ruine Kastell (`rom/bau` + `rom-aussenposten` + `erode`, Fahnenheiligtum mit vorh. `rom/standarte`, Legionskasse, Einsturz) | 16 |
| B1 | `nord`-Architekturrollen 1,5 · Querschnitt 13 (Stimmungen `outpost_frost`, `hall_forge`, `ship_nord`, `ruin_rom`) | 14,5 |
| **B1** | | **≈ 111** |
| **B2** | 6 Germanen (Karl, Bolzer, Donnerwerfer, Jäger, Berserker, Wergeld-Fänger) 36 · Kastell-Automat (Wächter-Basis + `rom/scutum`) 5 · Posen/FX/UI 34 | **≈ 75** |
| **B3** | unverändert | **≈ 22** |
| **Systeme** | unverändert; das Bausatz-Gerüst rechnet sich jetzt schon **innerhalb** von B1 (3 Kartenarten) | **≈ 40** |
| **Gesamt** | | **≈ 208 + 40** |

- **Germanischer Außenposten statt Rom:**
  - Allein gerechnet kostet er ca. 35 h statt 25, weil bei Rom 60 % schon da waren.
  - Mit dem gemeinsamen Grundkit kostet er nur noch **20 h zusätzlich**.
  - Rom geht dabei nicht verloren: Das römische Material landet fast vollständig in der Ruine.
- **Was sich teilen lässt:** Ungefähr **50–60 % der Teile** sind gemeinsam, also Material, Props, Deckung, Licht, Zellen und
  Terminals. Getrennt bleiben Hülle, Boden und Licht-Grundstimmung, denn daran erkennt man die Kartenart.
- **Damit drei germanische Karten nicht gleich aussehen:**
  1. **Leitmaterial je Art:**
     - Außenposten: Holz, Palisade, Frost, offener Himmel
     - Station: Schmiedemetall, Feuerschein, hohe Hallen
     - Schiff: enge Spanten, Kaltlicht und Rot-Alarm, schräge Rumpfwand
  2. **Teilungsregel:** Geteilt werden Props und Details, **nie Wand, Boden und Licht zugleich**.
  3. **Zwei handgebaute Leitstücke je Art:**
     - Außenposten: Krähenwacht-Turm, Thing-Stein
     - Station: Schmiedeherd, Hochsitz
     - Schiff: Drachenkopf am Bug innen, Ruderbank-Batterie
  4. **Clanpaletten** per `extends`, je ca. 0,5 h:
     - Krähenwacht: schwarz/rot
     - Erzklamm: Rost/Ocker
     - Hornfels: Frost/Silber
- **Hinfällig:** Die Rom-Probe-Rolle in B2 entfällt. Der Figurenbaukasten lohnt sich trotzdem, weil die römischen
  Verbündeten (NSC) später dieselben Teile nutzen.
- **Erledigt:** Die Frage „Testudiner oder Römerbau“ ist entschieden: Römerbau, also Kastell.
