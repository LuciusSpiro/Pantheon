# Sichtung Art: Bühnenkarten (Stand nach ART-PALETTEN, 2026-10-08)

Ich habe den Server auf Port 3396 laufen lassen und die Galerie mit „Umsehen“ (Voxel) aufgenommen, jeweils Übersicht und
Nahsicht. Die Bilder liegen unter `shots/sichtung-art/`. Seed 1, Paletten frisch nach dem Sync.

**Gesamturteil:** Die Station ist lesbar. Außenposten und Ruine sind es noch nicht. Der Hauptgrund ist nicht der Farbton,
sondern **zu viel Kontrast an der falschen Stelle**: Boden und halbe Deckung sind die hellsten und unruhigsten Flächen,
Wände und Leitstücke treten zurück. Besitz ist praktisch unsichtbar. Bei den Bannern liegt ein Symbolik-Problem vor.

## Befunde der Studioleitung

| # | Befund | Bewertung |
|---|---|---|
| 1 | Außenposten überladen | **Bestätigt** (`ap-germanen-intakt.png`, `ap-nah.png`). Drei Ursachen: **(a)** Bohlenboden auch im Hof, weil die Bauweisen-Tabelle `boden → belag 2` für die ganze Kartenart setzt. **(b)** Cremefarbene halbe Deckung mit voller heller Oberseite ist das hellste Element im Bild. **(c)** Zu viel Deckung: Der Prüfer warnt selbst `K-DECKUNG-DICHT` (Gefecht 0,26 > 0,16; je Hof liegt Deckung in 2 Kacheln bei 0,9–1,0). Palisade und Langhauswände sind dünne, dunkle Linien und gehen unter. |
| 2 | Ruine braun in braun | **Teilweise überholt.** Die neue `rom_kastell` trennt Wand (dunkel, rotes Band) und Deckung (Travertin) besser. Neues Problem (`ru-nah.png`): Der Boden ist ein **Schachbrett aus Creme, Dunkelgrau und Moos** je Kachel und damit unruhiger als Wände und Deckung. Dazu kommen sehr viele Streuprops und Bäumchen. Von oben verschwimmt alles zu Rauschen. |
| 3 | Unterscheidungstest / eigene Regel | **Außenposten erfüllt die Regel** (Tageslicht, Bohlen, Palisade). **Station und Schiff verletzen sie:** gleiche dunkelblaue Streifenwand, gleiche Dunkelheit im All, nur der Boden unterscheidet sich (Station blaue Fliesen, Schiff braune Bohlen im Gitter) (`st-nah.png`, `sch-nah.png`). **Leitstücke** sind von oben **nicht** eindeutig: Krähenwacht-Turm, Thing-Stein, Schmiedeherd und Drachenkopf finde ich in der Übersicht nicht. Lesbar sind nur Landeplatz, Abholbaken und das Fahnenheiligtum (grün-türkis). |
| 4a | Halbe gegen volle Deckung | **Unterscheidbar** in beiden Zoomstufen und in allen Zuständen: halb = hell und flach, voll = dunkler Block mit Krone. Die Regel aus M4 §3.6 hält, aber halbe Deckung ist **zu** hell (siehe 1b). |
| 4b | Zustände | **Verfallen und umkämpft wirken:** Abtragung (Puzzlekanten), dunkleres Licht, entsättigt (`ap-kontor-verfallen.png`, `st-herrenlos-verfallen.png`). **Aber** verfallen und umkämpft sehen fast gleich aus. Bei „umkämpft“ fehlen Ruß, Feuer und Barrikaden. In beiden Fällen versinken die Wände im dunklen Boden. |
| 4c | Besitz | **Kaum sichtbar.** `rostmeute`/umkämpft und `kontor`/verfallen auf demselben Seed sind nur am Zustand zu unterscheiden. Banner sehe ich im Kartenbild nicht, `paletten/rostmeute.json` hat `streu: []`. `besitz=friedlose` ist kein gültiger Besitz: Die Galerie fällt still auf „ohne Besitz“ zurück (Hash gleich mit intakt). |
| 5 | Symbolik | **Ein Verstoß, sonst in Ordnung.** `prop/germanen/gemein/banner_clan` zeigt **drei große Einzelrunen als Abzeichen**. Die dritte ist ein Stern mit Mittelstrich (Hagal-/Algiz-artig), und Hagal- und Lebensrune sind NS-belastet. Das verletzt ART-PLAN §1.6 („nie einzeln als Abzeichen“) auch ohne diese Lesart. Die Runenbänder (`decal_runen`, Runenmast) sind Pseudorunen-Bänder und damit in Ordnung. Farben ohne Schwarz-Weiß-Rot. |
| + | Figuren (Hinweis ART-PALETTEN) | **Bestätigt, mittel.** Unter Helmkrempe und Schulterplatten liegen Gesicht und Brust im Eigenschatten (`art-figa/figure-…grundtyp_az=30.png`). Die **Silhouetten im Stand** sind bei Grundtyp und Enterer zu ähnlich (`art-figb/silhouette_rollen_57.png`). Der Größenunterschied von 1,1 ist von oben kaum zu sehen. Schütze (Lanze) und Häscher (breite Kopfform) sind klar. |

## Empfehlungen je Team

**Bauweisen-Tabelle (ART-GK-BAU, `bauweisen/germanen.json`):**
- `boden` je Außenposten → Erde/Frostkies (neuer `belag` oder Terrain), **Bohlen nur `boden2`** in Langhaus und Plattformen.
- **Wunsch an KITS-OFFEN:** Module nutzen innen `boden2`, im Hof `boden`.

**Kit-Teile:**
- **GK-BAU:** `deckung_halb` bekommt **nur einen hellen Rand** (1 Voxel) statt einer voll hellen Oberseite, der Körper wird mittelhell. `wand`/`zaun` außen bekommen hellere Krone und Kante (Palisadenspitzen hell), damit Grenzen auch im verfallenen Zustand lesbar bleiben.
- **ART-SCHIFF:** eigene Wand (Spanten, schräge Rumpfwand, warme Holzbohlen innen), nicht die Streifenwand der Station.
- **ART-STATION:** Schmiede-Klinker mit warmem Glutband in der Krone, damit die Station nicht wie das Schiff wirkt.
- **Leitstücke (AP/ST/SCH):** Grundfläche ≥ 2×2 und eine Höhe, die alles andere überragt. Dazu eine eigene Leuchtfarbe nur
  für das Leitstück, aber nie eine Telegraf-Farbe. Kontrolle über den Unterscheidungstest ohne Beschriftung.

**Paletten (ART-PALETTEN):**
- `rom_kastell`: Pflaster **einheitlich mittelhell** (Travertin, ±8 % Helligkeit), Moos nur als Fugen-`paint`, kein Wechsel Hell/Dunkel je Kachel.
- `_umkaempft`: Ruß (dunkle `paint`-Flecken) und warmer Schein statt nur Entsättigung, damit sich der Zustand von `_verfallen` unterscheidet.
- `friedlose` vs `kontor`: verschiedene Akzentfarben (Rostorange gegen Handelsblau) **auf großen Flächen** (Schott, Tor, Banner), nicht nur an Details.

**Deko-Regeln (`content/buehnen/deko/*`):**
- Ruine: Dichte halbieren und Bäumchen nur am Rand.
- Außenposten-Hof: höchstens 4 Props je Zelle.
- Besitz-Streu für `rostmeute` (Schädelflagge, Flickbleche, Feuerfass) und `kontor` (Ballen, Waage, Banner) **füllen**. Danach Banner an Toren und Herzstücken fest setzen statt sie zu streuen.

**Kit-Module (KITS-OFFEN/KITS-INNEN, nicht Art):** Den Deckungsstempel auf den Füllplätzen zurücknehmen, bis die
Prüferwarnung `K-DECKUNG-DICHT` weg ist. Das bringt mehr Ruhe als jede Farbe.

**VOXEL-Licht/Stimmungen:**
- `ship_nord` (kalt, Rot-Alarm) und `hall_forge` (warm, Feuerschein) müssen sich stärker unterscheiden. Heute sind beide „dunkles All“.
- Dazu ein Füll- bzw. Rim-Licht von schräg vorn auf Figuren gegen den Eigenschatten.
- Verfallen/umkämpft: Belichtung um höchstens 15 % senken, nicht mehr.

**ART-FIG-B:** Den Enterer im Stand breiter machen (Fellkragen, Schulterbreite +2 Voxel, Waffe quer am Rücken). Grundtyp
ohne Fellumhang lassen, wie in ART-PLAN §6 vorgesehen.

**ART-GK-PROPS:** `banner_clan` neu machen: Ornamentband oder Tierzeichen (Rabe, Eber, Knotenmuster) statt Einzelrunen.
Danach Screenshot an die Studioleitung.

**Galerie (Tech, Wunsch):** Bei ungültigem `besitz` eine Warnung zeigen statt still zurückzufallen.

**Unsicher:** Leitstücke kann ich nur in der Übersicht bewerten. Den Spielwinkel über `kit-test.html` habe ich nicht
gefahren (er braucht ein awayMap per Skript). Die Nahsichten stammen aus dem Umsehen-Viewer.
