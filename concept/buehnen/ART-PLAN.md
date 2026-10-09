# ART-PLAN B1–B3 „Bühnen & Bodenkampf“: Produktionsplan der Art-Teams

Stand 2026-10-08 · Art Director · gilt nach `ENTSCHEIDUNGEN.md` (Go von Kai). Grundlage: `artdirector.md` §8.6
(Zahlen), `techlead.md` §2.2/§7/§11 (Vokabular, Dateibesitz Code), `gamedesign.md` §10 (Bauweisen, Rollen, Landepunkte).
**Leitlinie Kai: Systeme vor Handarbeit, Asset-Erzeugung stark parallelisieren.**
Der Tech Lead ist Autorität für das Kachel- und Ankervokabular. Wo dieser Plan Begriffe braucht, die noch nicht
festgelegt sind, steht ein Vorschlag in §5 „Wünsche ans Vokabular“.

**Pfade:**
- Voxelwerk = `C:\Users\Luciu\projects\voxelwerk` (VW)
- Spiel = `C:\Users\Luciu\projects\Pantheon`
- Manifeste liegen im Spiel unter `assets/manifest/<team>.json`

**Stunden:** Agentenstunden, ±50 %, geschätzt (nicht gemessen).

---

## 0. Überblick: Wellen und Teams

| Welle | Teams (parallel) | Voraussetzung |
|---|---|---|
| **0 – Systeme** | SYS-KERN, SYS-FIGUREN, SYS-PRUEF, SYS-EDITOR | keine, Start sofort |
| **0 – Art ohne Systeme** | ART-PALETTEN, ART-FIG-TEILE, ART-POSEN, UI-ART, FX | keine, Start sofort |
| **1 – Gerüst** | SYS-GERUEST | SYS-KERN Teil K1 (Modellvorlage in `use`) |
| **1 – früh** | ART-WAFFEN | SYS-KERN K4 (`emit`-Ausdrücke; vorher mit `if`-Kopien) |
| **2 – Kits und Figuren** | ART-GK-BAU, ART-GK-PROPS, ART-AUSSENPOSTEN, ART-STATION, ART-SCHIFF, ART-RUINE, ART-FIG-A, ART-FIG-B | SYS-GERUEST, SYS-PRUEF, SYS-KERN K2/K3; Figuren: SYS-FIGUREN + ART-FIG-TEILE |

**Spitze: 13 Art-Teams gleichzeitig** in Welle 2: 8 neue plus PALETTEN, POSEN, WAFFEN, UI-ART, FX. Alle haben getrennte
Ordner, Manifeste und Ports.

**Kritischer Pfad:** SYS-KERN K1 (≈ 3 h) → SYS-GERUEST (≈ 5 h) → ART-GK-BAU (≈ 16 h) → Feinschliff der
Kartenart-Kits. Die Kartenart-Teams warten **nicht** auf GK-BAU. Sie füllen ihre eigenen Gerüst-Steckplätze und bauen
Leitstücke und Props parallel (§3).

| Block | Std. |
|---|---|
| Systeme | ≈ 34 |
| B1-Art | ≈ 102 |
| B2-Art (inkl. FX und Kastell-Automat) | ≈ 71 |
| UI-ART (B2/B3 Icons) | ≈ 16 |
| **Summe** | **≈ 223** |
| Darstellung der Hexkarte (Raster, Marker, Panel) | macht KARTE (Tech) nach Stilblatt |

---

## 1. Regeln für alle Art-Teams (wie M4)

1. **Vorher lesen:**
   - `voxelwerk/AUTHORING.md` (danach die Abschnitte der Systeme aus Welle 0)
   - dieser Plan: §2 (deine Zeile), §4 (Namen/Sockets), §6 (Stil)
   - `CONTRACT-M4.md` §5/§6 (Manifest, Budgets)
   - den Vertrag `CONTRACT-B1/B2.md` der Studioleitung, sobald er da ist
2. **Ablauf je Asset:**
   - Rezept in VW bauen und `npm run check -- <dein Ordner>` laufen lassen (grün)
   - Kit-Teile zusätzlich: Prüfbogen `node tools/pruefbogen.mjs <id>` ohne Fehler
   - Screenshot `node tools/shots.cjs --port <dein Port> --out shots/<team> model=<id>` aus dem Spielwinkel
     (`&elev=57&az=0`) und aus der Nähe
   - Manifest-Eintrag in `Pantheon/assets/manifest/<team>.json`
   - im Spiel `npm run assets` und `npm run check:assets -- --team <team>` (grün)
   - Galerie `voxel-gallery.html?team=<team>`
   - Kits zusätzlich, sobald es sie gibt: Kartengalerie des Tech Leads mit 3 Seeds
3. **Fertig heißt:** check grün, Prüfbogen grün, Screenshot da, Manifest-Eintrag da, Budget eingehalten (M4 §5).
   **P1-Assets zuerst** und jedes fertige Asset sofort ins Manifest, damit VOXEL früh echte Assets sieht.
4. **Dateibesitz:** Nur die eigenen Ordner aus §2. Wiederverwendung per `use` ist ausdrücklich erwünscht (`rom/*`,
   `rom/bau/*`, `fig/basis/*`, `lerche/*`, `natur/*`). **Fremde Dateien nie ändern**; Wünsche gehen in den
   Abschlussbericht. Keine Git-Commits durch Teams.
5. **Lizenz:** Nur eigene Rezepte, also selbst geschriebenes JSON, oder `.vox`, das selbst in MagicaVoxel gebaut wurde.
   - keine fremden `.vox`/Meshes/Texturen, auch keine „freien“ ohne Studioleitung
   - Referenzbilder nur zur Inspiration, nie abpausen
   - keine realen Logos oder Marken
6. **Symbolik (Pflicht bei den Germanen):** keine NS-belasteten Zeichen. Verboten sind:
   - Sig- und Doppel-Sig-Rune, Wolfsangel, Odal mit „Füßen“, Schwarze Sonne
   - Lebens- und Toten-Rune in Abzeichenform, Hakenkreuz-artige Wirbel, Totenkopf im SS-Stil
   - die Farbkombination Schwarz-Weiß-Rot auf Bannern

   Runen nur als **eigene Pseudorunen-Schaltkreise** oder aus unbelasteten Zeichen (Fehu, Uruz, Raido, Kaunan, Gebo,
   Wunjo, Isa, Jera, Ehwaz), immer als Ornamentband und nie einzeln als Abzeichen. Die Studioleitung prüft jedes
   Banner und Abzeichen per Screenshot.
7. **Zustandsfarben** (M4 §6.2) kommen in der Ausstattung nicht vor: Mint #7FE0C2, Gelb #F2C94C, Orange #F08A3C,
   AUS-Rot #E0473C, Eisblau #A9D6E5.
   **Telegraf-Farben** sind für FX reserviert:
   - Glut-Orange = Flächenschaden
   - Weißgold = Präzision
   - Elektrisch-Blau = außer Gefecht

   Fraktions-Glow (Runen) bleibt gedämpft (`emit` ≤ 1,2) und pulsiert nie.
8. **Shell und Server:**
   - PowerShell
   - eigener VW-Server: `$env:PORT=<Port>; node server.js`
   - im Spiel: `PORT=<Port>`, `ROOM_CODE=off`
   - eigenen Server vor dem Ende stoppen

---

## 2. Teams

### 2.1 Welle 0 – Systeme in Voxelwerk

| Team | Port | besitzt (VW) | Std. |
|---|---|---|---|
| **SYS-KERN** | 3431 | `core/recipe.js`, `core/expr.js`, `core/color.js`, `core/library.js`, **neu** `tools/test-kern.mjs`, AUTHORING-Abschnitte „Vorlagen in use“, „erode“, „Paletten-adjust“, „Ausdrücke in emit“ | 13 |
| **SYS-FIGUREN** | 3432 | **neu** `tools/gen-figuren.mjs`, **neu** `assets/baukasten/{fraktionen,rollen}/*.json` (nur Schema + Testeinträge), `render/voxel-three.js` (nur `figureObject`), AUTHORING „Figurenbaukasten“ | 6 |
| **SYS-PRUEF** | 3433 | **neu** `tools/pruefbogen.mjs`, `tools/shots.cjs`, `tools/check.js` (Haken für den Prüfbogen), **neu** `editor/pruefbogen.html` | 6 |
| **SYS-EDITOR** | 3434 | `editor/editor.js`, `editor/index.html`, `render/viewer.js` | 4 |
| **SYS-GERUEST** (Welle 1) | 3435 | **neu** `assets/models/kit/geruest/**`, **neu** `assets/models/kit/test/**` (Probebauweise), AUTHORING „Bausatz-Gerüst“ | 5 |

**SYS-KERN (13 h)**
- **K1 Modellvorlage in `use`** (3 h, **zuerst liefern**):
  - `"model": "kit/{bauweise}/{art}/wand_fuellung"`
  - Platzhalter sind Parameter vom Typ `options`.
  - `collectDeps` löst alle Kombinationen der `options` auf und lädt sie. Fehlt ein Modell, gibt es eine klare Meldung
    mit Vorlage und Werten.
  - Optional `"fallback": "<id>"`, wenn eine Bauweise einen Steckplatz nicht füllt. Dann wird das neutrale
    Gerüst-Teil gebaut.
- **K2 `erode`** (4 h):
  - Bauschritt `{ "op": "erode", "density": 0–1, "depth": 1–3, "edges": true, "if": … }`
  - Er trägt Voxel an freiliegenden Kanten deterministisch ab (`hash3` + `seed`).
  - Dazu `"mode": "paint"` mit `{ "noise": … }` für Ruß und Moos, geht schon heute.
- **K3 Paletten-`adjust`** (3 h):
  - Feld `"adjust": { "sat": 0.6, "light": 0.85, "tint": "#556B2F", "mix": 0.15, "roles": ["primary", …] }` in Paletten
    mit `extends`
  - Ergebnis: `nord_verfallen` = `extends: nord` + `adjust`
- **K4 Ausdrücke** (3 h): Zahlausdrücke in `emit`, `{ "shade": …, "f": "<ausdruck>" }` und `hash(a, b)` in `expr.js`.
  Damit lässt sich etwa das Hitzeglühen als `emit: "0.3 + heat * 0.5"` schreiben.
- **Test:** `node tools/test-kern.mjs` (neu)
  - Vorlage wird aufgelöst, fehlende Bauweise → Fehler bzw. Fallback
  - `erode` mit gleichem Seed ergibt dasselbe Voxel-Hash, anderer Seed ein anderes
  - `adjust`-Farbwerte stimmen nach Tabelle
  - `emit`-Ausdruck wird ausgewertet

  Außerdem bleibt `npm run check` über **alle** bestehenden Assets grün (keine Regression). Die Studioleitung führt
  danach `npm run assets` + `npm run check:assets` im Spiel aus.

**SYS-FIGUREN (6 h): Figurenbaukasten Rolle × Fraktion**
- `assets/baukasten/fraktionen/<f>.json`:
  - `{ id, palette, rig, teile: { hips, torso, head, upperArm, lowerArm, thigh, shin }, kopf_varianten, waffen_bauweise }`
- `assets/baukasten/rollen/<rolle>.json` (**eine Datei je Rolle**, damit Teams parallel arbeiten):
  - `{ id, groesse (Skalierung der Figur, z. B. 1.1), ersetzt: { <gelenk>: <modell> }, aufsatz: { back, head_top, shoulder }, waffe: "<typ>", pose_ruhe, pose_ziel, mantel: true|false }`
  - Rollenteile liegen unter `models/fig/rolle/<rolle>/**`. Sie sind **fraktionsneutral modelliert**, mit Palettenrollen.
- `node tools/gen-figuren.mjs [--fraktion germanen] [--rolle niederhalter]` schreibt
  `assets/figures/fig/<fraktion>/<rolle>.json`. Die erzeugten Dateien bekommen `"generated": true` und werden nie von
  Hand bearbeitet.
- **Fix:** `figureObject` führt `opts.params` mit `fig.params` zusammen (Befund ART-G aus M4).
- **Test:**
  - Generator mit Fraktion `test` (Teile aus `fig/basis/*`) und 2 Testrollen
  - `npm run check -- fig` grün
  - Screenshot-Reihe aller Rollen nebeneinander
  - Aufruf zweimal → identische Dateien

**SYS-PRUEF (6 h): Prüfbogen**
- `node tools/pruefbogen.mjs <id> [--params art=station]` rendert einen **Kontaktbogen**:
  - bei Kit-Teilen alle 16 `conn`-Fälle × `cut` 0/1 × `zustand` 0–2
  - bei anderen Modellen alle `states`/`variants`
  - PNG unter `shots/pruefbogen/<id>.png` + HTML-Ansicht `editor/pruefbogen.html?id=…`
- **Automatische Prüfungen:**
  - Grundfläche ≤ 1 Kachel je Zelle
  - Höhe (Wand voll 3 m / geschnitten 1,25 m)
  - **Türöffnung frei:** Bei `tuer`/`tor`/`schott` sind die 2 mittleren Kacheln der Kante bis 2,2 m leer
  - **Anschlussnaht:** Bei `conn`-Bit gesetzt reicht die Wand bis an die Zellkante, ohne Lücke
  - Dreiecksbudget je Fall
- **Silhouettenmodus** `--silhouette` für Figuren: schwarz auf hell, Spielkamera 57°, alle Rollen einer Fraktion in einer
  Reihe. Das ist der Lesbarkeitstest.
- `tools/check.js` ruft den Prüfbogen für alle Assets mit Tag `kit` auf (`npm run check -- --pruefbogen`).
- **Test:** Prüfbogen für `lerche/kit/wall` und `away/kesh/wall_ruin` (gibt es). Eine absichtlich kaputte Testwand in
  `kit/test/` muss erkannt werden.

**SYS-EDITOR (4 h)**
- **Raster-Overlay** (Taste G):
  - Kachel 1 m, Zelle 8×8 Kacheln
  - Markierung der Kantenmitte (2 Kacheln) an jeder Zellkante
  - Maßstab-Säule bleibt
- **Socket-Marker:** Liest das optionale Rezeptfeld `"sockets"` (§5 Wunsch 3) und zeigt Name + Kugel.
- **Parameter-Wechsler** für `bauweise`, `art` und `zustand` als Knöpfe; `options` gibt es schon als Auswahl.
- **Test:** Screenshot `shots/sys-editor/raster.png` mit `lerche/kit/wall` und Raster.

**SYS-GERUEST (5 h, Welle 1): Bausatz-Gerüst**
- Neutrale Gerüst-Rezepte (`kit/geruest/<kind>`) für alle Kit-Kinds aus §4.1. Jedes enthält:
  - Maße, `conn`/`cut`-Logik, Sockel- und Kronenhöhe, Türöffnung (2 Kacheln, Kantenmitte)
  - `zustand` 0–2 über `erode`/`paint`
  - **Steckplätze** per `use` mit Vorlage `kit/{bauweise}/{art}/<slot>`, Fallback `kit/{bauweise}/gemein/<slot>` und
    danach `kit/geruest/slot/<slot>`
- **Steckplätze je Kind:**
  - `wand`: `fuellung`, `sockel`, `krone`, `kante`, `pfeiler`
  - `tuer`/`schott`/`tor`: `rahmen`, `blatt`
  - `boden`: `belag`, `fuge`
  - `deckung_*`: `koerper`, `oberkante` (Pflicht: helle Oberkante bei halb, dunkle Krone bei voll, M4 §3.6)
  - `zaun`: `pfosten`, `feld`
- **Probebauweise `kit/test/*`** mit Klötzchen-Füllungen: belegt, dass das Gerüst ohne Kunst funktioniert.
- **Test:** Prüfbogen aller `kit/geruest/*` mit Bauweise `test` fehlerfrei; `npm run check -- kit` grün.

### 2.2 Welle 0 – Art ohne Systemabhängigkeit (Start sofort)

| Team | Port | besitzt | Asset-IDs (Manifest) | Std. |
|---|---|---|---|---|
| **ART-PALETTEN** (Manifest `art-pal`) | 3436 | VW `assets/palettes/{nord, germanen_*, rom_kastell, friedlose, kontor}.json`, `assets/moods/{outpost_frost, hall_forge, ship_nord, ruin_rom}.json`; Spiel: **neu** `content/buehnen/paletten/*.json` (Besitz × Zustand → Paletten-ID, Format nach CONTRACT-B1) | Paletten: `nord` (+ stone, stone_dark, stone_light, paving, wood, wood_dark, soil, fur), `germanen_kraehenwacht` (Schwarz/Rost-Ocker, **kein** Schwarz-Weiß-Rot), `germanen_erzklamm` (Rost/Ocker), `germanen_hornfels` (Frost/Silber), `kontor` (Germanen + Handelsblau), `friedlose` (Germanen-Formen in Rostmeute-Farben), `rom_kastell` (verblichenes Rot, Travertin, Grünspan); je davon `_verfallen` und `_umkaempft` per `adjust` (nach K3). Stimmungen: 4 | 6 |
| **ART-FIG-TEILE** (`art-figt`) | 3437 | VW `assets/models/fig/germanen/**` | `fig/germanen/{huefte, rumpf, kopf, helm_a, helm_b, oberarm, unterarm, oberschenkel, unterschenkel, fellumhang}`; Rumpf mit geklinkerten Platten, Fell **nur** als eigenes Teil (Rollenentscheidung, §6) | 10 |
| **ART-POSEN** (`art-pose`) | 3438 | VW `assets/poses/human.json` (**allein**) | neue Posen: `aim_rifle` (beidhändig), `aim_heavy`, `charge` (Lanze, kniend), `launch`, `windup`, `strike`, `stagger`, `unconscious` (Seitenlage, ≠ `wounded`), `bound` (gefesselt, kniend), `carried`, `lift_comrade` (Kamerad aufrichten, E10) | 8 |
| **UI-ART** (`ui-art`) | – | Spiel **neu** `public/js/icons-b.js` (12×12-Icons + Bojen-Sprite als Daten/Zeichenfunktionen, gleiches Format wie `ICONS` in `art.js`), **neu** `concept/buehnen/STILBLATT-SEKTOR.md` | Icons: Hex-Symbole ×11 (hafen, gasriese, ruine, piraten, asteroiden, nebel, boje, heimat, schrein, festung, wrack), Einflüsse ×8, Waffen ×7 (inkl. Pistole), Status ×5 (betaeubt, bewusstlos, gefesselt, ueberhitzt, verwundet), Wunden-Pip, Hitzebalken-Segmente; Bojen-Sprite für die Raumszene (aktiv, gesperrt, temporaer, ohne_strom). Stilblatt: Fraktionsflächen, Kantenstile, Unerkundet/Leerraum/gesperrt (aus `hex.svg`), damit KARTE/CLIENT zeichnen | 16 |
| **FX** (`fx`) | Spiel 3330 | Spiel `public/js/voxel/fx.js` (**allein**, Ausgliederung aus VOXEL, §5 Wunsch 7) | `spawnFx`-Typen (neu): `lance_charge` (Ziellinie dünn → dick, 0–1), `lance_beam`, `grenade_arc` (Bogen + Aufschlagring, füllt sich), `grenade_blast`, `stun_cloud`, `stun` (Funkenkranz), `heat_vent` (Dampf), `overheat`, `windup` (Klingenglühen + Schlagsektor am Boden), `slash`, `unconscious` (langsamer blauer Puls), `bind` (Energiefessel-Bogen), `muzzle_<waffe>` (Leuchtspur Sturmgewehr, Bola), `melee_hit`, `lift_comrade` | 20 |

- **Abnahme FX:**
  - Testseite `voxel-gallery.html?fx=1` mit Knöpfen je Typ; Screenshots jedes Effekts in beiden Zoomstufen
  - Partikelbudget M4 §3.5 (≤ 2.000 Partikel, ≤ 4 Lichter)
  - Die Ereignisse binden BODENKAMPF/WAFFEN an; FX liefert vorher die Liste der Ereignisnamen an die Studioleitung.
- **Abnahme UI-ART:**
  - Icons in einer Vorschau `public/art-preview.html?set=b` (die Datei gehört PIPELINE/CLIENT, also Wunsch; sonst eigene
    `public/icons-b-preview.html`)
  - 12×12 gut lesbar bei Zoom 1
  - KARTE bestätigt, dass das Stilblatt reicht

### 2.3 Welle 1 – früh

| Team | Port | besitzt | Asset-IDs | Abh. | Std. |
|---|---|---|---|---|---|
| **ART-WAFFEN** (`art-waffe`) | 3439 | VW `assets/models/item/waffe/**` | Gerüst je Typ (neutrale Silhouette, Griffklasse, `heat` 0–3, `bauweise`-Steckplatz `anbau`): `item/waffe/{blaster, sturmgewehr, granatwerfer, lanze, nahkampf, betaeuber, pistole}`; Anbauten `item/waffe/germanen/*` (Nietschleuder, Jagdspeer-Gewehr, Donnerrohr, Bartaxt, Bola-Schocker, Karabiner), `item/waffe/rom/*` (Crew: Blaster, Lanze, Gladius-Klinge …), `item/waffe/rostmeute/*` (aus `lerche/item/scav_rifle` abgeleitet); Geschoss `item/waffe/granate`, `item/fessel` | K4 (vorher `if`-Kopien je Hitzestufe) | 12 |

**Pflicht-Sockets** jeder Waffe: `grip` (= Anker), `muzzle`, `vent` (Hitzedampf), `charge` (nur Lanze), `blade_tip` (nur
Nahkampf).

**Silhouettenregel:**
- Länge je Typ fest: Pistole 0,45 m · Blaster 0,7 · Betäuber 0,7 mit Stabkopf · Sturmgewehr 0,95 waagrecht breit ·
  Granatwerfer 0,8 mit dickem Rohr · Lanze 1,6 (überragt die Figur) · Nahkampf 0,9 mit breitem Kopf
- Die Bauweise ändert **nie** Länge und Grundform.

### 2.4 Welle 2 – Kits und Figuren

Gemeinsame Ordnerregel für Kits:
- `kit/<bauweise>/<kind>.json` sind die **Instanzen** der Gerüste: Sie setzen `bauweise` fest und reichen `art` durch.
  Sie gehören GK-BAU bzw. RUINE.
- `kit/<bauweise>/gemein/**` gehört GK-BAU.
- `kit/<bauweise>/<art>/**` gehört dem Team der Kartenart.
- Props liegen unter `prop/<bauweise>/{gemein,<art>}/**` nach demselben Muster.
- Leitstücke (Signaturmodule, GD §10.5 Punkt 2) liegen unter `leit/<bauweise>/<art>/<name>`.

| Team | Port | besitzt (VW) | Asset-IDs (Manifest) | Abh. | Std. |
|---|---|---|---|---|---|
| **ART-GK-BAU** (`art-gkb`) Germanen-Grundkit | 3440 | `models/kit/germanen/*.json`, `models/kit/germanen/gemein/**` | `kit/germanen/{boden, wand, zaun, tuer, tor, schott, luke, deckung_halb, deckung_voll, pfeiler, fenster}` + Steckplatzteile `gemein/{fuellung_klinker, sockel, krone_runen, kante, belag_planke, belag_gitter, belag_platte, rahmen, blatt, koerper_schildwall, oberkante}` | SYS-GERUEST, K2, SYS-PRUEF | 16 |
| **ART-GK-PROPS** (`art-gkp`) | 3441 | `models/prop/germanen/gemein/**` | `prop/germanen/gemein/{truhe, fass, bank, feuerschale (light), runenstein_terminal (aus/an/gehackt), kaefig_zelle (zu/offen/belegt), banner_clan (Palette per Besitz), decal_runen (seed), kiste_stapel (deckung), werkzeug, kette, bake_abholpunkt}` | K1 (für `bauweise`-Steckplätze nur bei Banner), sonst keine | 12 |
| **ART-AUSSENPOSTEN** (`art-ap`) Krähenwacht/Thinghof | 3442 | `models/kit/germanen/aussenposten/**`, `models/prop/germanen/aussenposten/**`, `models/leit/germanen/aussenposten/**` | Steckplätze `aussenposten/{fuellung_palisade, pfosten, feld, krone_palisade, fuellung_langhaus}`; Props: `runenmast` (`sprengpunkt`: intakt/geladen/gesprengt), `tank`, `tanklager_2x1` (`sprengpunkt`), `landeplatz_2x2`, `abflussgitter` (zu/offen), `wachturm` (aussicht), `plateau_kante`, `schuerfgeraet` (Splittergürtel); Leitstücke: `leit/germanen/aussenposten/kraehenwacht_turm`, `thing_stein`; Terrain-Legende Frost/Schlamm/Planke als Vorschlag an VOXEL | GK-BAU für Feinschliff, sonst parallel | 22 |
| **ART-STATION** (`art-st`) Methalle/Hornfels/Kontor | 3443 | `models/kit/germanen/station/**`, `models/prop/germanen/station/**`, `models/leit/germanen/station/**` | Steckplätze `station/{fuellung_metallhalle, krone_rohr, belag_schmiede}`; Props: `andockring_2x1`, `schacht_gitter`, `schmiedeherd_reaktor_2x2` (`sprengpunkt`: ok/überladen/gesprengt), `kontrollpult`, `wandmonitor`, `met_kessel`, `regal`; Leitstücke `hochsitz_halle`, `schmiedeherd` | wie oben | 14 |
| **ART-SCHIFF** (`art-sch`) Langschiff/Konvoi | 3444 | `models/kit/germanen/schiff/**`, `models/prop/germanen/schiff/**`, `models/leit/germanen/schiff/**` | Steckplätze `schiff/{fuellung_spant, kante_rumpf, belag_deck}`; Props: `antrieb_block`, `reaktor_schiff` (`sprengpunkt`), `bruecke_konsole`, `schildgenerator` (`ziel`), `ruderbank_batterie`, `schleuse`, `ladenetz`, `huellenbruch` (offen/geflickt), Lift/Notleiter (2 Decks, Entscheidung 9) `lift_schacht`, `leiter`; Leitstücke `drachenkopf_bug`, `ruderbank` | wie oben | 16 |
| **ART-RUINE** (`art-ru`) Kastell, verfallen | 3445 | `models/kit/rom/**` (Instanzen + `rom/gemein` + `rom/ruine`), `models/prop/rom/**`, `models/leit/rom/**`, `models/actor/rom/**`; **nicht** `rom/bau/*` und `rom/*`: die werden nur per `use` genutzt, nicht geändert | `kit/rom/{boden, wand, zaun, tuer, tor, deckung_halb, deckung_voll, pfeiler}` mit Steckplätzen aus `rom/bau/{mauer, zinnen, saeule, pflaster, tor}`; Props: `prop/rom/ruine/{cloaca_einsturz, schutt (seed), saeule_gestuerzt, aquaedukt_verteiler (raetsel-paar), offiziersschloss (raetsel-paar: ruht/gedreht/beide), kassengewoelbe_tor (zu/öffnet/offen), legionskasse (fund: da/geborgen)}`; Leitstücke `leit/rom/ruine/{fahnenheiligtum, wachturm_ruine}`; **Kastell-Automat** `actor/rom/waechter` (state 0/1/2, `front` 0/1, Scutum als Frontschild, Basis `lerche/actor/warden` + `rom/scutum`) | GERUEST, K2, K3 | 21 |
| **ART-FIG-A** (`art-figa`) | 3446 | `models/fig/rolle/{grundtyp, niederhalter, grenadier}/**`, `baukasten/rollen/{grundtyp, niederhalter, grenadier}.json`, `baukasten/fraktionen/germanen.json` | Figuren (generiert): `fig/germanen/grundtyp` (Karl), `fig/germanen/niederhalter` (Bolzer), `fig/germanen/grenadier` (Donnerwerfer); Rang `rank` 1 = Häuptling | SYS-FIGUREN, ART-FIG-TEILE; Waffen-Platzhalter bis ART-WAFFEN | 9 |
| **ART-FIG-B** (`art-figb`) | 3447 | `models/fig/rolle/{schuetze, enterer, haescher}/**`, `baukasten/rollen/{schuetze, enterer, haescher}.json` | `fig/germanen/schuetze` (Jäger), `fig/germanen/enterer` (Berserker, 2 Wunden, Größe 1,1), `fig/germanen/haescher` (Wergeld-Fänger) | wie FIG-A | 7 |

**Abnahme Kit-Teams:**
- Prüfbogen jedes Kit-Teils grün
- **Kartengalerie (Tech):** je Kartenart 3 Seeds × 3 Zustände × 2 Besitzer als Screenshots
- Halbe und volle Deckung in beiden Zoomstufen unterscheidbar (M4 §3.6)
- Leitstücke von oben eindeutig
- **Unterscheidungstest:** Je ein Screenshot Außenposten / Station / Schiff ohne Beschriftung. Ein zweites Team ordnet sie
  richtig zu. Regel: Geteilt werden Props und Details, nie Wand, Boden und Licht zugleich (`artdirector.md` §8.6).

**Abnahme Figuren-Teams:**
- Silhouettenbogen aller 6 Germanen-Rollen + Plünderer + Wächter + Kastell-Automat, schwarz bei 57°
- Ein zweites Team benennt die Rollen ohne Erklärung. Das ersetzt nicht den Menschentest am Spieleabend (Prüfstein B2),
  ist aber die Vorstufe.
- Zusätzlich zwischen den Fraktionen: Friedlose (Palette `friedlose`) gegen Kontor (`kontor`) gegen Plünderer.

---

## 3. Abhängigkeiten im Detail und was wartet

```
SYS-KERN K1 ──► SYS-GERUEST ──► ART-GK-BAU ─┐
     │                 │                     ├─► (Feinschliff) AUSSENPOSTEN / STATION / SCHIFF
     │                 └──────────────────────┴─► ART-RUINE
     ├─ K2 erode ─────► GK-BAU, RUINE (Zustände)
     ├─ K3 adjust ────► ART-PALETTEN (Zustandspaletten), RUINE
     └─ K4 emit ──────► ART-WAFFEN (Hitze; vorher if-Kopien)
SYS-FIGUREN + ART-FIG-TEILE ──► ART-FIG-A, ART-FIG-B
SYS-PRUEF ──► Abnahme aller Kit-Teile (Bauen geht vorher)
sofort, ohne Abhängigkeit: ART-PALETTEN, ART-FIG-TEILE, ART-POSEN, UI-ART, FX, ART-GK-PROPS (Props ohne Steckplatz)
```

- **Kartenart-Teams warten nicht auf GK-BAU.**
  - Ihre Steckplatzteile (`kit/germanen/<art>/*`) hängen nur am Gerüst.
  - Ihre Props und Leitstücke hängen an nichts.
  - Wände sehen sie bis GK-BAU fertig ist über den Fallback `kit/geruest/slot/*`.
- **Außerhalb von Art** (Tech, siehe `techlead.md` §7/§11): VOXEL (Kit-Renderer: semantische Kachel + Bauweise →
  Asset-ID), Kartengalerie, Werkstatt, Deko-Regel-Engine.
  - Art-Abnahmen mit Kartenbild warten darauf.
  - Einzel-Assets lassen sich vorher in Galerie und Prüfbogen abnehmen.

---

## 4. Art-API: Namen, Parameter, Sockets (Vorschlag an den Tech Lead)

### 4.1 Semantische Kachelart → Kit-Teil
VOXEL bildet ab: `kind` (aus der neutralen Kit-Legende) + `bauweise` + `art` → `kit/<bauweise>/<kind>` mit den Parametern
`{ conn, cut, zustand, art, seed }`.

| `kind` (Legende) | Kit-Teil | Parameter | Hinweis |
|---|---|---|---|
| `boden` | `kit/<bw>/boden` | `belag` 0–3 (aus Legende: platte, gitter, planke/erde, schmuck), `wear`, `zustand`, `seed` | Bodenstufe `architecture` |
| `wand` | `kit/<bw>/wand` | `conn`, `cut`, `zustand`, `art` | voll 3 m / geschnitten 1,25 m (M4 §3.2) |
| `zaun` (Palisade/Außengrenze) | `kit/<bw>/zaun` | `conn`, `zustand` | **neu, siehe §5.1** |
| `tuer` | `kit/<bw>/tuer` | `open` 0/1, `zustand`, quer → `rot` 90 | 2 Kacheln breit an der Kantenmitte |
| `tor` (Eingang laut) | `kit/<bw>/tor` | `open` 0–2 (zu/öffnet/offen), `blown` 0/1 | **neu, siehe §5.1** |
| `schott` (hackbar) | `kit/<bw>/schott` | `state` 0 zu / 1 offen / 2 gehackt / 3 verriegelt | |
| `luke` (Eingang technisch: Abfluss, Schacht) | `kit/<bw>/luke` | `open` 0/1 | **neu, siehe §5.1** |
| `deckung_halb` | `kit/<bw>/deckung_halb` | `zustand`, `seed`, `damaged` | ≤ 0,9 m, helle Oberkante |
| `deckung_voll` | `kit/<bw>/deckung_voll` | `zustand`, `seed` | ≥ 2,2 m, dunkle Krone |
| `pfeiler` | `kit/<bw>/pfeiler` | `zustand` | volle Deckung, 1 Kachel |
| `fenster` | `kit/<bw>/fenster` | `conn` | nur Station/Schiff |
| `fels` / Kartenrand | Terrain (VOXEL), Legende `fels` | – | wie Kesh `R` |
| `plateau` (`aussicht`) | `prop/<bw>/<art>/plateau_kante` + Bodenhöhe 0,5 m nur optisch | – | Entscheidung 27: flach, nur Kante |
| `leer`/Void | nichts | – | Schiff-Atlas-Lücke |

### 4.2 Anker-Rolle → Prop (über die Bauweisen-Tabelle, §5 Wunsch 4)

| Anker (`content/buehnen/anker.json`) | Germanen | Rom (Ruine) | Pflicht-Sockets |
|---|---|---|---|
| `terminal` | `prop/germanen/gemein/runenstein_terminal` | `prop/rom/ruine/offiziersschloss` (als Rätselhälfte) | `use`, `screen`, `label`, `fx_spark` |
| `sprengpunkt` | `.../aussenposten/{runenmast, tank}`, `.../station/schmiedeherd_reaktor_2x2`, `.../schiff/reaktor_schiff` | `.../ruine/aquaedukt_verteiler` | `charge` (Ladung), `fx_explode`, `fx_smoke`, `label` |
| `zelle` | `prop/germanen/gemein/kaefig_zelle` | – | `prisoner`, `use`, `label` |
| `beute` | `.../gemein/truhe` | `.../ruine/legionskasse` | `use`, `label` |
| `fund` | `leit/germanen/station/met_kessel` (Inhalt) | `prop/rom/ruine/legionskasse` | `use`, `label` |
| `tor` (Ruine) | – | `prop/rom/ruine/kassengewoelbe_tor` | `label` |
| `raetsel` (Paar) | Runenpaar `prop/germanen/gemein/runenstein_terminal` mit `paar` | `offiziersschloss`, `aquaedukt_verteiler` | `use`, `label` |
| `abholpunkt` | `prop/germanen/gemein/bake_abholpunkt` | dasselbe (Bauweise `neutral`) | `beam` |
| `aussicht` | `.../aussenposten/wachturm`, `plateau_kante` | `leit/rom/ruine/wachturm_ruine` | `stand` |
| `ziel` | `.../schiff/schildgenerator`, `leit/*` | `leit/rom/ruine/fahnenheiligtum` | `use`, `label` |
| `eingang`, `wache`, `deckung` | über Kachelart bzw. ohne Objekt | | – |

Allgemein: Lichtquelle `light`; Stationen/Konsolen `use`, `fx_smoke`, `fx_spark`, `label` (M4 §5).

### 4.3 Figuren und Waffen
- **Figuren:** `fig/<fraktion>/<rolle>`
  - Rollen-IDs sind neutral: `grundtyp`, `niederhalter`, `grenadier`, `schuetze`, `enterer`, `haescher`, `waechter`.
  - Anzeigenamen kommen aus dem Lexikon (Karl, Bolzer, Donnerwerfer, Jäger, Berserker, Wergeld-Fänger).
  - Figuren-Parameter: `rank` 0/1, `role` (bleibt für den Plünderer).
  - Besitz-Palette (`friedlose`, `kontor`, Clans) setzt der Client per `palette`-Override, **keine eigenen Figuren je
    Besitz**.
  - Plünderer bleibt `lerche/scavenger`.
  - Kastell-Automat ist ein Modell mit Zuständen: `actor/rom/waechter`.
- **Figuren-Sockets:** `handR`, `handL`, `back`, `label`, **neu** `head_top` (Betäubungskranz), `wrists` (Fesseln),
  `fx_spark`.
- **Waffen:** `item/waffe/<typ>` mit Parametern:
  - `bauweise` (Options: `germanen`, `rom`, `rostmeute`, `neutral`)
  - `heat` 0–3
  - Das Spiel wählt `bauweise` aus der Fraktion der Figur; Spieler bekommen `rom` (Lerche).

---

## 5. Wünsche ans Vokabular (Tech Lead entscheidet)

1. **Drei zusätzliche Kachelarten:**
   - `zaun` (Außengrenze, blockiert; anderes Aussehen als `wand`)
   - `tor` (2 Kacheln, „Eingang laut“, Zustand gesprengt)
   - `luke` („Eingang technisch“)

   Ohne sie muss Art aus `wand`/`tuer` raten, was eine Palisade oder ein Abfluss ist. Die Kanten-Ableitung (§2.2) bleibt
   unberührt: `zaun` = `wand`, `tor`/`luke` = `tuer`.
2. **Einheitliche Kit-Parameter** `conn` (N1 O2 S4 W8 wie M4), `cut`, `zustand` (0 intakt, 1 verfallen, 2 umkämpft),
   `art` (Options `aussenposten|station|ruine|schiff`), `seed` (aus Kachelposition + Karten-Seed). Damit kann VOXEL jedes
   Kit-Teil ohne Sonderfall bauen.
3. **Sockets im Rezept statt nur im Manifest:**
   - optionales VW-Feld `"sockets"` (Meter, Pivot)
   - `sync-assets` übernimmt es ins Spiel-Manifest; ein Eintrag im Manifest überschreibt das Rezept
   - So stehen Sockets dort, wo man sie sieht (Editor-Marker)
   - Besitz: PIPELINE in `tools/sync-assets.mjs`
4. **Bauweisen-Tabelle gehört Art:** `content/buehnen/bauweisen/<bauweise>.json` = `{ kits: kind → asset, anker: rolle →
   prop (je art), leit: platztyp → leitstück, paletten, stimmung je art }`. VOXEL liest sie, Art pflegt sie. Eine neue
   Bauweise wird dann **eine Datei + Assets, ohne Code**.
5. **Signaturmodul-Platztyp** `herzstueck` (2×2), belegt per `leit/<bauweise>/<art>/*` (GD §10.5 Punkt 2).
6. **Deko-Regeln als Art-Daten:** `content/buehnen/deko/<bauweise>.json` (Platztyp → Prop-IDs, Dichte, Wandnähe, frei
   zu haltende Kacheln, nie auf Anker oder Wege). Die Engine liefert Tech (Entscheidung 34).
   **Deckung bleibt im Modul** und wird nie gestreut.
7. **`public/js/voxel/fx.js` als eigener Dateibesitz des FX-Teams** (VOXEL behält den Rest von `public/js/voxel/**`).
   Ohne diese Trennung ist FX 20 h lang Engpass im VOXEL-Team.
8. **Bewusstlos ≠ verwundet ≠ gefesselt** als getrennte Zustände im Snapshot, damit ACTORS die Posen `unconscious` /
   `wounded` / `bound` wählen kann (Entscheidungen 10–12).

---

## 6. Stilvorgaben (kurz, bindend)

- **Rolle = Silhouette, Fraktion = Teile + Palette.**
  - Größenklassen: Enterer 1,1 und ohne Fernwaffe · Niederhalter breit, Gewehr waagrecht · Schütze schlank, Kapuze, kein
    Fellumhang · Grenadier mit Rückentrommel · Häscher mit Ketten/Bola am Gürtel und Stab · Grundtyp mittel
  - **Der Fellumhang ist ein Rollenteil** (nur Grundtyp, Enterer).
  - **Schilde nur auf dem Rücken.** Ein Schild vorne heißt immer Frontschild (Wächter, Kastell-Automat).
- **Leitmaterial je Kartenart (Germanen):**
  - Außenposten: Holz, Palisade, Frost, offener Himmel (`outpost_frost`)
  - Station: Schmiedemetall, Feuerschein, hohe Hallen (`hall_forge`)
  - Schiff: enge Spanten, kaltes Licht und Rot-Alarm, schräge Rumpfwand (`ship_nord`)
- **Ruine Rom:** verblichenes Rot, Travertin, Grünspan, Dämmerung (`ruin_rom`). Verfall über `erode` + Moos-`paint`, nicht
  über Handarbeit je Stein.
- **Lesbar von oben, Stonehearth-Dichte nur über Deko-Regeln,** Streubudget ≤ 12 Props je Zelle (Leistung 72×40).

---

## 7. Stundenübersicht

| Team | Welle | Std. |
|---|---|---|
| SYS-KERN | 0 | 13 |
| SYS-FIGUREN | 0 | 6 |
| SYS-PRUEF | 0 | 6 |
| SYS-EDITOR | 0 | 4 |
| SYS-GERUEST | 1 | 5 |
| ART-PALETTEN | 0 | 6 |
| ART-FIG-TEILE | 0 | 10 |
| ART-POSEN | 0 | 8 |
| UI-ART | 0 | 16 |
| FX | 0 | 20 |
| ART-WAFFEN | 1 | 12 |
| ART-GK-BAU | 2 | 16 |
| ART-GK-PROPS | 0/2 | 12 |
| ART-AUSSENPOSTEN | 2 | 22 |
| ART-STATION | 2 | 14 |
| ART-SCHIFF | 2 | 16 |
| ART-RUINE | 2 | 21 |
| ART-FIG-A | 2 | 9 |
| ART-FIG-B | 2 | 7 |
| **Summe** | | **≈ 223** |

Die Summe teilt sich so auf:

| Block | Std. |
|---|---|
| Systeme | ≈ 34 |
| B1 (Paletten, Kits, Ruine ohne Automat) | ≈ 102 |
| B2 (Figuren, Posen, Waffen, FX, Kastell-Automat) | ≈ 71 |
| UI | ≈ 16 |

Gegenüber `artdirector.md` §8.6 (≈ 208 + 40) ist der Wert etwas niedriger. Grund: Die Hexkarten-Zeichnung liegt bei
KARTE (Tech); Art liefert dafür Icons und das Stilblatt.

**Wandzeit bei voller Parallelität:** Welle 0 ≈ 1 Tag, Welle 1 ≈ ½ Tag, Welle 2 ≈ 2 Tage (längste Teams AUSSENPOSTEN
und RUINE). **Art gesamt ≈ 3,5 Studio-Tage.** Der Engpass liegt danach bei VOXEL (Kit-Renderer) und der Kartengalerie,
nicht bei Art.
