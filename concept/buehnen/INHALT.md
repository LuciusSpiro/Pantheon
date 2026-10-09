# INHALT B1–B2 „Bühnen & Bodenkampf“: Inhaltsspezifikation

**Von:** Lead Game Design · **Stand:** 2026-10-08 · **Gilt nach:** `ENTSCHEIDUNGEN.md` (Go Kai, 36 Entscheidungen).
**Für:** KITS-OFFEN (§2 Außenposten, §4 Ruine), KITS-INNEN (§3 Station, §5 Schiff), KATALOG (§6, §8, §9), SPIELLEITER
(§6, §7, §9), WAFFEN/BODENKAMPF (§10).
**Autorität für Kachel- und Ankervokabular:** Tech Lead (`techlead.md` §2.2/§11, später `CONTRACT-B1.md`,
`content/buehnen/anker.json`). Was hier vom Vokabular abweicht, steht in §11 „Wünsche ans Vokabular“ und gilt erst,
wenn der Vertrag es übernimmt.
Zahlen ohne Quelle sind **Startwerte (S)**, alle per `tune` änderbar.

**Parallelarbeit:** Jede Kartenart (§2–§5) ist in sich geschlossen. Sie verweist nur auf §1 (gemeinsames Vokabular)
und nie auf eine andere Kartenart.

---

## 1. Gemeinsames Vokabular (für alle Kartenarten)

### 1.1 Begriffe
| Begriff | Bedeutung |
|---|---|
| **Zelle** | 8×8 Kacheln. Koordinaten in Schablonen sind Zellen (x nach rechts, y nach unten, ab 0). |
| **Modul** | handgebautes ASCII-Stück für einen **Platztyp**, Größe 1×1, 2×1 (16×8, drehbar zu 8×16) oder 2×2 Zellen. Datei `content/buehnen/<art>/module/<art>.<typ>.<variante>.json` (Format `modul/1`, Tech Lead §2.2). |
| **Kernplatz** | Platztyp mit dramaturgischer Aufgabe (Eingang, Ziel, Rückzug): **3 Varianten** (a, b, c). |
| **Füllplatz** | Hof, Korridor, Gelände: **2 Varianten** (a, b) + **2–3 Deckungsstempel** je Variante (§11 W3). |
| **Signaturmodul** | Variante eines Platztyps nur für eine Bauweise (`bauweise: ["germanen"]`). Es ersetzt **keine** Pflichtvariante, sondern kommt dazu. |
| **Schablone** | Grundriss mit Plätzen (Typ, Lage in Zellen, Bereich, Richtung). Datei `content/buehnen/<art>/schablonen/<art>.<name>.json`. |
| **Richtung** | bei Randplätzen die Seite (N/O/S/W), auf der die **Außenkante** liegt (Zaun, Mauer, Außenwand, Schleuse). Module werden in **Grundlage N** gebaut, d. h. die Außenkante liegt oben (Zeile 0). Der Zusammenbau dreht sie (§11 W1). |
| **Bereich** | `hinein`, `ziel`, `rueckzug`. Zusätzlich markiert die Schablone eine Liste `gefecht` (Plätze, in denen gekämpft wird). |
| **Kartenart-Pflichtsatz** | Ankerzahlen, die **jede** Schablone einer Kartenart erfüllen muss. So laufen alle Umsetzungen dieser Kartenart auf **jedem** Seed (§6). |

### 1.2 Kanten (Tech Lead §2.2)
Ein Anschluss liegt in der Mitte der Zellkante (Kachelindex 3 und 4) und ist 2 Kacheln breit. Sein Typ wird aus den
Kacheln **abgeleitet**:
- **`offen`**: beide Mittelkacheln begehbar
- **`tuer`**: Tür- oder Schottkachel
- **`wand`**: Mittelkacheln fest
- **`frei`**: die ganze Kante ist begehbar (Gelände unter freiem Himmel)

Verträglich sind `offen↔offen|tuer`, `tuer↔tuer|offen`, `wand↔wand` und `frei↔frei`. Am Kartenrand ist nur `wand`
oder `frei` erlaubt. **Für die Außenkarten (§2, §4) nötig:** `wand↔frei` und `tuer↔frei` sowie eine tolerante
Ableitung von `frei` (§11 W13/W14).

### 1.3 Arbeitslegende (semantische Kacheln, neutral; Endfassung macht der Tech Lead, §11 W2)
| Zeichen | kind | fest | Deckung | Sicht | Bemerkung |
|---|---|---|---|---|---|
| `.` | `boden` | nein | – | frei | |
| `,` | `boden2` | nein | – | frei | zweiter Belag (Weg, Platte, Gitter) |
| `#` | `wand` | ja | voll | gesperrt | auch Palisade, Kastellmauer, Schiffswand |
| `F` | `fels` | ja | voll | gesperrt | Außenrand, Gelände |
| `o` | `deckung_halb` | ja (`low`) | halb | frei | Kisten, Mauerreste, Bänke |
| `O` | `deckung_voll` | ja | voll | gesperrt | Stapel, Tanks, Säulenstümpfe |
| `I` | `saeule` | ja | voll | gesperrt | |
| `D` | `tuer` | – | – | – | Tür, Torflügel |
| `S` | `schott` | – | – | – | Tür, verschließbar und hackbar (Anker `tor`) |
| `z` | `gitter` | ja | – | frei | Zaun aus Gitter, Zellengitter |
| `^` | `plateau` | nein | – | erhöht | Aussichts-Plateau mit Kante (Entscheidung 27) |
| `/` | `rampe` | nein | – | frei | einziger Zugang zum Plateau |
| `_` | `leere` | ja | – | gesperrt | Deck-Lücke, Abgrund |
| `w` | `wand_schwach` | ja | voll | gesperrt | nur mit Anker `versteck` (§11 W5) |

**Deckungsregel je Modul** (Prüfer: Tech Lead §2.3): In Gefechtsplätzen hat jede Bodenkachel Deckung in ≤ 2 Kacheln
(Ziel ≥ 35 %), und keine freie Sichtgasse ist länger als 12 Kacheln. Pro Modul im Gefecht stehen mindestens 3 `o` und
1 `O`/`I`.

### 1.4 Anker (Rollen nach Tech Lead §2.2/§3.1; Zusätze in §11)
| Rolle | Attribute | Bedeutung | Interaktion (S) |
|---|---|---|---|
| `eingang` | `art`: `laut`, `leise`, `technisch` | Beginn eines Ansatzes, liegt **außen** vor der Öffnung | – (technisch: ggf. `tor`) |
| `abholpunkt` | `ankunft`: bool (§11 W6) | Pad-Fläche 3 Kacheln frei, Beam hinunter und hinauf | – |
| `wache` | `schwer`: bool (Wächter) | Spawn- und Standplatz der Besetzung | – |
| `patrouille` | `kette`: Buchstabe (§11 W4) | Wegpunkte für Patrouillen (Schleich-Grundstufe) | – |
| `terminal` | | Download, Logbuch, Steuerung | E halten 6 s (Download), 2 s (lesen) |
| `ziel` | | allgemeines Halteziel (Ventil, Flagge, Konsole) | E halten 3 s |
| `sprengpunkt` | | Ladung setzen (Plotgegenstand) | E halten 4 s, Countdown 60 s |
| `zelle` | | Gefangene (NSC oder Crew, Ausbruch) | E halten 3 s (öffnen) |
| `beute` | | Bergungsgut | E halten 2 s |
| `nsc` | | Platz für Personen (`spawn_person`) | – |
| `aussicht` | | auf `^`-Plateau, Sicht über 10 Kacheln (Entscheidung 16) | – |
| `tor` | | verschließbarer Durchgang (Name aus dem Lexikon: Schott, Tor, Kassentür) | öffnet über Bedingung |
| `fund` | | Fundstück hinter `tor` | E halten 3 s |
| `raetsel` | `paar`: Buchstabe | Halteobjekt, zwei gleichzeitig | E halten gleichzeitig (Kesh-Regel) |
| `versteck` | | hinter `w`, nur nach Weitscan sichtbar (§11 W5) | E halten 2 s |
| `lift` / `leiter` | `deck`: 1/2 | Deckwechsel, nur auf dem Schiff (§11 W7) | E |

### 1.5 Ankerdichte (Faustregel für alle Module)
- `wache`: 1 je Füllplatz im Gefecht, 2 je 2×2-Platz
- `patrouille`: 1 je Füllplatz im Außenbereich bzw. Korridor, in Ketten verbunden (§11 W4)
- Anker nie auf festen Kacheln, nie in Türkacheln und nie in der 2-Kachel-Mitte einer Kante (dort würden sie den Anschluss blockieren)

---

## 2. Kartenart AUSSENPOSTEN (Team KITS-OFFEN)

**Karte:** 9×5 Zellen = 72×40 Kacheln, planetar und offen. **Füllung** nicht belegter Zellen: `fels`.
**Bauweise B1:** `germanen` (Krähenwacht, Eisenwald). **Kartenrand:** `frei` auf der Außenseite (dort, wo Gelände liegt),
sonst `wand` (Fels).
**Aufbau:** Das Lager liegt hinter **einer Zaunlinie** (Palisade). Zaunplätze tragen die Palisade **1 Kachel innerhalb**
ihrer Außenkante, deshalb sind alle ihre Kanten `frei`. Die Ausrichtung kommt aus dem Feld `richtung`.

### 2.1 Pflichtsatz Außenposten (jede Schablone)
`eingang` 3 (je 1 laut/leise/technisch) · `abholpunkt` 2 (1 mit `ankunft`) · `sprengpunkt` 2 · `aussicht` 1 ·
`terminal` 1 · `zelle` 2 · `beute` 4 · `ziel` 1 · `wache` 6 · `patrouille` 4.

### 2.2 Platztypen
| Code | Typ-ID | Größe | Art | Bereich | Pflichtanker je Modul | Kanten (Grundlage N) |
|---|---|---|---|---|---|---|
| T | `tor` | 1×1 | Kern | hinein | `eingang`(laut) 1, `wache` 1 | alle `frei`. Palisade in Zeile 1, Tor (`DD`, 2–4 breit) in der Mitte |
| Q | `zaunluecke` | 1×1 | Kern | hinein | `eingang`(leise) 1 | alle `frei`. Palisade in Zeile 1 mit 2 breiter Lücke, versetzt (nicht mittig), Gestrüpp `o` davor |
| A | `abfluss` | 1×1 | Kern | hinein | `eingang`(technisch) 1 | alle `frei`. Palisade in Zeile 1, darunter ein Rohr/Graben 2 breit, ≥ 4 lang, mit `#`-Wänden; Ausgang innen hinter Deckung |
| Z | `palisade` | 1×1 | Füll | – | `patrouille` 1 | alle `frei`. Palisade in Zeile 1 durchgehend, innen 1–2 `o` |
| H | `hof` | 1×1 | Füll | gefecht | `wache` 1, `patrouille` 1 | alle `frei` |
| W | `wachturm` | 1×1 | Füll | – | `aussicht` 1, `wache` 1 | alle `frei`. Plateau `^` 3×3 + Rampe `/` |
| G | `gelaende` | 1×1 | Füll | – | – | alle `frei`. Felsen `F`/`O`, Senken mit `o` |
| U | `huegel` | 1×1 | Füll | hinein | `aussicht` 1 | alle `frei`. Plateau `^` ≥ 3×3 mit Rampe auf der Lagerseite |
| N | `lichtung` | 1×1 | Kern | rueckzug | `abholpunkt` 1 (+ `ankunft`) | alle `frei`. 3×3 Pad-Fläche frei, Deckung am Rand |
| P | `landeplatz` | 2×2 | Kern | rueckzug | `abholpunkt` 1, `beute` 1, `wache` 1 | alle `frei`. Plattform `,` 8×8, Frachtkisten `o` |
| L | `lagerhalle` | 2×2 | Kern | ziel | `beute` 4, `terminal` 1, `wache` 2 | 2 Kanten `tuer`, Rest `wand` (Lage wählt der Zusammenbau) |
| C | `zellenblock` | 2×1 | Kern | ziel | `zelle` 2, `wache` 1, `terminal` 1 | 1 Kante `tuer` (Längsseite), Rest `wand` |
| M | `funkmast` | 1×1 | Kern | ziel | `sprengpunkt` 1, `terminal` 1, `ziel` 1 | alle `frei`. Mast `O` mittig, Pult `o` |
| B | `treibstofflager` | 1×1 | Füll | – | `sprengpunkt` 1 | alle `frei`. Tanks `O` (Deckung voll, explodiert bei Sprengung) |
| X | `herzstueck` | 2×2 | Signatur | ziel | `ziel` 1, `beute` 2, `wache` 2 | 2 Kanten `tuer` oder `offen`, Rest `wand` |

### 2.3 Modulliste (38 Module)
| Typ | Varianten | Was die Varianten unterscheidet |
|---|---|---|
| `tor` | a, b, c | a: Holztor mit zwei Torhäusern (Deckung `O` links/rechts innen) · b: breites Fahrtor (4 breit), offener Innenplatz · c: Tor mit Vorbau/Schikane (Gang knickt einmal) |
| `zaunluecke` | a, b, c | a: Lücke links, Gestrüpp außen · b: Lücke rechts, Erdwall innen · c: umgestürzter Pfahl, Lücke über Trümmer |
| `abfluss` | a, b, c | a: gerades Rohr · b: Graben mit Knick · c: Rohr endet hinter Fässern (innen `o`) |
| `palisade` | a, b | a: gerade · b: mit Wehrgang-Rest (innen `o` in einer Reihe) |
| `hof` | a, b | a: Feuerstelle + Bänke · b: Karrenplatz. Je 3 Stempel |
| `wachturm` | a, b | a: Plateau in der Ecke · b: Plateau mittig |
| `gelaende` | a, b | a: Felsgruppe · b: Senke mit Wrackteil |
| `huegel` | a, b | a: Plateau in der Mitte · b: Plateau am Rand mit Felsdeckung |
| `lichtung` | a, b, c | a: Pad mittig · b: Pad am Fels · c: Pad mit Wrackdeckung |
| `landeplatz` | a, b, c | a: leer, Kisten am Rand · b: Fähre geparkt (`O` 4×3) · c: Ladekran (`I`) |
| `lagerhalle` | a, b, c | a: Regalgänge (lange `o`-Reihen) · b: offene Halle mit Galerie (`^` innen) · c: zwei Räume, Zwischentür |
| `zellenblock` | a, b, c | a: Zellen an einer Seite, Wachpult · b: Zellen beidseits eines Gangs · c: Käfige im Freien unter Dach (`z`) |
| `funkmast` | a, b, c | a: Mast + Pult · b: Mast auf Plateau (`^`) · c: Mast mit Generator (`O`) |
| `treibstofflager` | a, b | a: Tankreihe · b: Fässerplatz |
| `herzstueck` | Signatur germanen: **Langhaus**, **Thinghof** | Langhaus: lange Halle, Feuergrube mittig, Hochsitz (`ziel` = Banner). Thinghof: Steinkreis unter freiem Himmel (Kanten `offen`), Thingstein = `ziel` |

### 2.4 Schablonen
Legende der Raster: Platzcode wie in §2.2. Zwei Felder mit demselben Code nebeneinander gehören zu einem 2×1- oder
2×2-Platz.

**A1 `aussenposten.talsperre`**: Zaun im Süden, Ankunft von Süden

```
     0  1  2  3  4  5  6  7  8
y0   C  C  H  X  X  H  L  L  M
y1   W  H  H  X  X  H  L  L  B
y2   Z  Q  Z  Z  T  Z  Z  A  Z      Zaunplätze: richtung S
y3   G  G  U  G  G  P  P  G  G
y4   N  G  G  G  G  P  P  G  G
```
| Platz | Typ | Lage (x,y,w,h) | Bereich |
|---|---|---|---|
| zellen | zellenblock | 0,0,2,1 | ziel |
| halle_herz | herzstueck | 3,0,2,2 | ziel |
| halle | lagerhalle | 6,0,2,2 | ziel |
| mast | funkmast | 8,0,1,1 | ziel |
| tank | treibstofflager | 8,1,1,1 | – |
| turm | wachturm | 0,1,1,1 | – |
| hof_* | hof | (2,0) (5,0) (1,1) (2,1) (5,1) | gefecht |
| tor | tor | 4,2 · S | hinein |
| luecke | zaunluecke | 1,2 · S | hinein |
| abfluss | abfluss | 7,2 · S | hinein |
| zaun_* | palisade | (0,2) (2,2) (3,2) (5,2) (6,2) (8,2) · S | – |
| huegel | huegel | 2,3 | hinein |
| landeplatz | landeplatz | 5,3,2,2 | rueckzug |
| lichtung | lichtung | 0,4 (`ankunft`) | rueckzug |
| gelaende_* | gelaende | Rest | – |

Dramaturgie:
- **Rein:** Ankunft an der Lichtung im Südwesten. Drei Ansätze auf einer Zaunlinie: Lücke nah, Tor mittig, Abfluss weit.
- **Ziel:** im Norden, hinter dem Hof: Zellen (W), Langhaus (Mitte), Halle (O), Mast (Ecke).
- **Rückzug:** durch eine beliebige Öffnung zum Landeplatz (Südosten) oder zurück zur Lichtung.
- **Gefecht:** Hofreihe y0/y1. Der Hügel gibt Lanzen-Sicht über den Zaun.

**A2 `aussenposten.landefeld`**: Zaun im Westen, langer Weg nach Osten
```
     0  1  2  3  4  5  6  7  8
y0   U  G  G  Z  H  H  H  X  X
y1   P  P  G  Q  H  H  W  X  X
y2   P  P  G  T  H  B  H  H  M
y3   G  G  G  Z  L  L  H  H  H
y4   N  G  G  A  L  L  C  C  H      Zaunspalte x3: richtung W
```
| Platz | Typ | Lage | Bereich |
|---|---|---|---|
| landeplatz | landeplatz | 0,1,2,2 (`ankunft` am Abholpunkt) | hinein + rueckzug |
| lichtung | lichtung | 0,4 | rueckzug |
| huegel | huegel | 0,0 | hinein |
| zaun | palisade/zaunluecke/tor/palisade/abfluss | x3, y0..y4 · W | hinein |
| tank | treibstofflager | 5,2 | gefecht (Ablenkung) |
| halle | lagerhalle | 4,3,2,2 | ziel |
| zellen | zellenblock | 6,4,2,1 | ziel |
| turm | wachturm | 6,1 | – |
| herz | herzstueck | 7,0,2,2 | ziel |
| mast | funkmast | 8,2 | ziel (Hauptziel) |
| hof_* | hof | Rest x4..x8 | gefecht |

Dramaturgie:
- **Rein:** vom Landefeld im Westen. Das Tor liegt mittig, die Lücke im Norden, der Abfluss im Süden.
- **Ziel:** der Funkmast am Ostende. Das Treibstofflager in der Mitte lädt zu „erst ablenken, dann zuschlagen“ ein.
- **Rückzug:** über den Abfluss zur Lichtung im Südwesten (kurz, eng) oder zurück zum Landefeld.

**A3 `aussenposten.zwei_hoefe`**: zwei Zaunlinien (außen, innen), beide nach Westen
```
     0  1  2  3  4  5  6  7  8
y0   U  Q  H  W  H  Z  H  P  P
y1   G  T  H  H  H  Q  H  P  P
y2   N  Z  H  X  X  T  H  L  L
y3   G  A  H  X  X  Z  H  L  L
y4   G  Z  B  H  H  Z  C  C  M      Zaunspalten x1 und x5: richtung W
```
| Platz | Typ | Lage | Bereich |
|---|---|---|---|
| lichtung | lichtung | 0,2 (`ankunft`) | hinein |
| huegel | huegel | 0,0 | hinein |
| aussenzaun | zaunluecke/tor/palisade/abfluss/palisade | x1, y0..y4 · W | hinein |
| aussenhof | hof, wachturm (3,0), herzstueck (3,2,2,2), treibstofflager (2,4) | x2..x4 | gefecht |
| innenzaun | palisade/zaunluecke/tor/palisade/palisade | x5, y0..y4 · W | gefecht |
| landeplatz | landeplatz | 7,0,2,2 | rueckzug |
| halle | lagerhalle | 7,2,2,2 | ziel |
| zellen | zellenblock | 6,4,2,1 | ziel |
| mast | funkmast | 8,4 | ziel |
| innenhof | hof | x6 y0..y3 | gefecht |

Dramaturgie:
- **Rein:** Zweistufige Verteidigung: der Thinghof (Herzstück) im Außenhof, dann ein zweites Tor. Der richtige Ort für *durchbrechen* und *geiseln befreien*.
- **Rückzug:** **nicht** durch den Eingang, sondern über den Landeplatz im Innenhof (Nordosten).

### 2.5 Beispielmodul (Kalibrierung, Grundlage N)
```
aussenposten.tor.a  (1×1, richtung N, alle Kanten frei)
rows:            anker:
"........"       "...e...."   e = eingang laut (außen vor dem Tor)
"##ODDO##"       "........"   (Zeile 1: Palisade #, Torhaus O, Torflügel DD auf Index 3/4)
"...oo..."       "........"
"........"       "......w."   w = wache
".o....o."       "........"
"........"       "..p....."   p = patrouille
"...o...."       "........"
"........"       "........"
```
Zeile 0 ganz `.` → Kante N `frei`; Spalten 0/7 in allen Zeilen begehbar außer Zeile 1 → Kanten W/O werden über Zeilen 3/4 als `frei`/`offen` abgeleitet (Tech Lead prüft die Ableitung für `frei` mit Zaunzeile).

---

## 3. Kartenart RAUMSTATION (Team KITS-INNEN)

**Karte:** 6×3 Zellen = 48×24 Kacheln, innen und eng. **Füllung** nicht belegter Zellen: `wand`. **Kartenrand:** `wand`.
**Bauweise B1:** `germanen` (Methalle, Kontor). **Korridore** sind 2–4 Kacheln breit, Anschlüsse liegen immer in der Mitte.

### 3.1 Pflichtsatz Station
`eingang` 2 (1 laut, 1 technisch; leise optional) · `abholpunkt` 2 (1 mit `ankunft`) · `terminal` 2 · `sprengpunkt` 1 ·
`ziel` 3 · `zelle` 2 · `nsc` 2 · `beute` 2 · `tor` 1 · `wache` 4 · `patrouille` 4.

### 3.2 Platztypen
| Code | Typ-ID | Größe | Art | Bereich | Pflichtanker je Modul | Kanten (Grundlage N) |
|---|---|---|---|---|---|---|
| E | `schleuse` | 1×1 | Kern | hinein/rueckzug | `eingang` 1 (`art` setzt der Platz), `abholpunkt` 1, `beute` 1 | N `wand` (Außenhülle, Schleusentür im Inneren der Zelle), S `tuer`, O/W `wand` oder `offen` (2 Varianten mit Seitenöffnung) |
| sz | `schachtzugang` | 1×1 | Kern | hinein | `eingang`(leise) 1 | N `wand` (Hülle mit Wartungsluke), S `offen` (Schacht 2 breit) |
| s | `schacht` | 1×1 | Füll | – | `patrouille` 0 (Schacht wird nicht patrouilliert) | 2 gegenüberliegende Kanten `offen` (gerade) oder 2 angrenzende (Knick); Schacht 2 breit, niedrige Decke (optisch), Deckung `o` alle 4 Kacheln |
| k | `korridor` | 1×1 | Füll | gefecht | `wache` 1, `patrouille` 1 | gerade: W/O `offen`, N/S `wand`; Variante b: Knick |
| + | `kreuzung` | 1×1 | Füll | gefecht | `wache` 1, `patrouille` 1 | alle 4 `offen`, Deckung ≥ 4 `o` |
| sch | `schott` | 1×1 | Füll | – | `tor` 1 | W/O `offen`, Schott `SS` quer in der Zellmitte, N/S `wand` |
| La | `lager` | 1×1 | Füll | – | `beute` 2 | 1 Kante `tuer`, Rest `wand` |
| K | `kontrollraum` | 2×1 | Kern | ziel | `terminal` 2, `nsc` 2, `wache` 1, `ziel` 1 | 1–2 Kanten `tuer` |
| R | `reaktorraum` | 2×1 | Kern | ziel | `sprengpunkt` 1, `ziel` 3 (Ventile, weit verteilt), `terminal` 1 | 1–2 Kanten `tuer` |
| Qu | `quartiere` | 2×1 | Füll | – | `nsc` 2, `beute` 1 | 1 Kante `tuer` |
| Z | `zellen` | 1×1 | Kern | ziel | `zelle` 2, `wache` 1 | 1 Kante `tuer` |
| X | `herzstueck` | 2×1 | Signatur | ziel | `ziel` 1, `sprengpunkt` 1, `beute` 2 | 2 Kanten `tuer`/`offen` |

### 3.3 Modulliste (29 Module)
| Typ | Varianten | Unterschied |
|---|---|---|
| `schleuse` | a, b, c | a: Andockring mit Druckschott (gerade) · b: Frachtschleuse mit Kistenstapeln · c: Notschleuse mit Seitenöffnung |
| `schachtzugang` | a, b, c | a: Luke mittig · b: Luke seitlich mit Knick · c: aufgebrochene Platte |
| `schacht` | a (gerade), b (Knick) | Stempel: Rohre `o` an wechselnden Stellen |
| `korridor` | a (gerade), b (Knick) | je 3 Stempel |
| `kreuzung` | a, b | a: offene Kreuzung mit Säule mittig · b: Kreuzung mit Barrikade `o` |
| `schott` | a, b | a: einfaches Schott · b: Schott mit Wachnische |
| `lager` | a, b | a: Regale · b: Fässer |
| `kontrollraum` | a, b, c | a: Pultreihe vor Fenster · b: Hochsitz (`^`) in der Mitte · c: zwei Ebenen mit Rampe |
| `reaktorraum` | a, b, c | a: Kern mittig, Ventile an drei Wänden · b: Kern an der Stirnseite, Steg · c: zwei Kessel, Ventile verteilt |
| `quartiere` | a, b | a: Kojen · b: Schlafhalle mit Bänken |
| `zellen` | a, b, c | a: zwei Zellen an der Wand · b: Käfige `z` · c: Zellen hinter Wachpult |
| `herzstueck` | Signatur germanen: **Methalle** (Kesselhalle mit Met-Kesseln, `sprengpunkt` am Hauptkessel), **Schmiedeherd** (Esse, Amboss-Deckung) | – |

### 3.4 Schablonen
**S1 `station.ring`**: Ring um den Kontrollraum, unten der Schacht als Schleichweg
```
     0   1   2   3   4   5
y0   Z   k   k   sch k   R
y1   E   k   K   K   k   R
y2   sz  s   s   s   s   E
```
| Platz | Typ | Lage | Bereich | Hinweis |
|---|---|---|---|---|
| andock | schleuse | 0,1 · W, `eingang` laut, `ankunft` | hinein | |
| zugang | schachtzugang | 0,2 · W | hinein | |
| zellen | zellen | 0,0 | ziel | |
| ring_* | korridor | (1,0)(2,0)(4,0)(1,1)(4,1) | gefecht | |
| schott | schott | 3,0 | gefecht | |
| leitstand | kontrollraum | 2,1,2,1 | ziel | Tür nach N |
| reaktor | reaktorraum | 5,0,1,2 | ziel | |
| schacht_* | schacht | (1,2)…(4,2) | – | `kanten_fest`: (1,2)↔(1,1) `tuer`, (4,2)↔(4,1) `tuer` |
| notschleuse | schleuse | 5,2 · O, `eingang` technisch | rueckzug | |

Dramaturgie:
- **Rein:** laut über den Andockring oder leise durch den Schacht.
- **Ziel:** Leitstand oder Reaktor.
- **Rückzug:** über die Notschleuse im Osten. Der Ring erlaubt Flankieren in beide Richtungen.

**S2 `station.spindel`**: Hauptkorridor mit zwei Schotts, der Schacht als Rückweg
```
     0   1   2   3   4   5
y0   Qu  Qu  E   s   s   s
y1   E   k   sch k   sch K
y2   Z   La  R   R   La  K
```
| Platz | Typ | Lage | Bereich | Hinweis |
|---|---|---|---|---|
| andock | schleuse | 0,1 · W, laut, `ankunft` | hinein | |
| fracht | schleuse | 2,0 · N, technisch | rueckzug | |
| quartiere | quartiere | 0,0,2,1 | – | |
| schacht_* | schacht | (3,0)(4,0)(5,0) | rueckzug | `kanten_fest` (5,0)↔(5,1) `tuer` |
| gang_* | korridor | (1,1)(3,1) | gefecht | |
| schott_1/2 | schott | (2,1)(4,1) | gefecht | |
| leitstand | kontrollraum | 5,1,1,2 | ziel | |
| zellen | zellen | 0,2 | ziel | |
| lager_* | lager | (1,2)(4,2) | – | |
| reaktor | reaktorraum | 2,2,2,1 | ziel | |

Dramaturgie:
- **Rein:** linear, Schott für Schott. Druck nach vorn, Niederhalter im Gang.
- **Ziel:** Leitstand am Ende.
- **Rückzug:** über den Wartungsschacht oben zur Frachtschleuse, nicht zurück durch den Gang.

**S3 `station.kreuz`**: zentrale Kreuzung als Gefechtsplatz
```
     0   1   2   3   4   5
y0   Z   k   k   X   X   E
y1   E   k   +   k   sch K
y2   R   R   k   Qu  Qu  K
```
| Platz | Typ | Lage | Bereich |
|---|---|---|---|
| andock | schleuse | 0,1 · W, laut, `ankunft` | hinein |
| fracht | schleuse | 5,0 · O, technisch | rueckzug |
| zellen | zellen | 0,0 | ziel |
| herz | herzstueck | 3,0,2,1 | ziel |
| kreuzung | kreuzung | 2,1 | gefecht |
| gang_* | korridor | (1,0)(2,0)(1,1)(3,1)(2,2) | gefecht |
| schott | schott | 4,1 | – |
| leitstand | kontrollraum | 5,1,1,2 | ziel |
| reaktor | reaktorraum | 0,2,2,1 | ziel |
| quartiere | quartiere | 3,2,2,1 | ziel (Evakuieren) |

Dramaturgie: Alle Wege führen durch die Kreuzung. Gut für *evakuieren* (Quartiere → Kreuzung → Andockring) und
*krise eindämmen* (Reaktor im Südwesten).

### 3.5 Beispielmodul
```
station.korridor.a (1×1, W/O offen, N/S wand)
"########"
"##o##o##"
"........"
"...o...."      anker: Zeile 3 "......w." (wache), Zeile 5 ".p......" (patrouille)
"........"
"........"
"##O##O##"
"########"
```

---

## 4. Kartenart RUINE (Team KITS-OFFEN)

**Karte:** 8×5 Zellen = 64×40 Kacheln. **Bauweise B1:** `rom`, Zustand **verfallen** (Grenzkastell; Material aus
`rom/bau` + `rom-aussenposten` + Verfall-Filter). **Füllung:** `fels`.
**Aufbau:** Ein Kastell mit **einer Mauerlinie** (Mauerplätze tragen die Mauer 1 Kachel innerhalb der Außenkante, alle
Kanten `frei` oder `offen`). Das Innere sind Lagerstraßen und Bauten, außen liegt Trümmerfeld.

### 4.1 Pflichtsatz Ruine
`eingang` 2 · `abholpunkt` 2 (1 mit `ankunft`) · `tor` 1 · `fund` 1 · `raetsel` 1 Paar (2 Anker in **verschiedenen**
Plätzen, §11 W8) · `aussicht` 1 · `wache` 4 (davon 1 `schwer`) · `terminal` 1 · `beute` 2 · `patrouille` 3.

### 4.2 Platztypen
| Code | Typ-ID | Größe | Art | Bereich | Pflichtanker | Kanten (Grundlage N) |
|---|---|---|---|---|---|---|
| P | `porta` | 1×1 | Kern | hinein | `eingang`(laut) 1, `wache` 1 | alle `frei`/`offen`. Mauer in Zeile 1, Torbogen 2–4 breit, Tortürme `O` |
| B | `bresche` | 1×1 | Kern | hinein | `eingang`(leise) 1 | Mauer in Zeile 1 mit eingestürzter Lücke, Schutt `o` |
| E | `einsturzgang` | 1×1 | Kern | rueckzug | `eingang`(technisch) 1 | Mauer in Zeile 1, darunter eingebrochene Cloaca: Gang 2 breit, Wände `#`, außen auf Höhe der Mauer |
| Ma | `mauer` | 1×1 | Füll | – | `patrouille` 1 | Mauer in Zeile 1, innen Wehrgang-Trümmer `o` |
| V | `vorfeld` | 1×1 | Kern | rueckzug | `abholpunkt` 1 | alle `frei`. Pad 3×3, Trümmer am Rand |
| Tr | `truemmerfeld` | 1×1 | Füll | – | – | alle `frei`. Säulenstümpfe `I`, Schutt `o` |
| Tu | `turm` | 1×1 | Füll | – | `aussicht` 1 | alle `frei`. Turmstumpf als `^`-Plateau + `/` |
| L | `lagerstrasse` | 1×1 | Füll | gefecht | `wache` 1, `patrouille` 1 | alle `frei`/`offen` |
| K | `kolonnade` | 1×1 | Füll | gefecht | `wache` 1 | Säulenreihe `I` (Deckung voll), Kanten `offen` |
| F | `raetselfluegel` | 1×1 | Kern | ziel | `raetsel` 1 (`paar` setzt die Schablone) | 1–2 Kanten `tuer`/`offen` |
| W | `wachlokal` | 1×1 | Füll | ziel | `wache` 1 (`schwer`), `terminal` 1 (Wachbuch) | 2 Kanten `tuer` |
| T | `treppe` | 1×1 | Füll | – | `aussicht` 1 | Terrassenmauer in Zeile 1, Rampe `/` 2 breit durch die Mauer (Kante N `offen`), Treppenabsatz `^` |
| I | `innerstes` | 2×2 | Kern + Signatur | ziel | `tor` 1, `fund` 1, `beute` 2, `wache` 1 | 1–2 Kanten `tuer` |

### 4.3 Modulliste (32 Module)
| Typ | Varianten | Unterschied |
|---|---|---|
| `porta` | a, b, c | a: Porta mit zwei Tortürmen · b: eingestürzter Torbogen (Durchgang unter Trümmern) · c: Doppeltor mit Zwinger |
| `bresche` | a, b, c | a: Lücke links · b: Lücke rechts mit Schuttrampe · c: Lücke durch einen Turmstumpf |
| `einsturzgang` | a, b, c | a: gerade Cloaca · b: Knick · c: Gang mit Einsturzhöhle (Deckung) |
| `mauer` | a, b | a: gerade · b: mit Mauerturm-Rest |
| `vorfeld` | a, b, c | a: Pad am Weg · b: Pad zwischen Säulenstümpfen · c: Pad am Graben |
| `truemmerfeld` | a, b | a: Säulenstümpfe · b: umgestürzte Statue |
| `turm` | a, b | a: runder Stumpf · b: eckiger Stumpf |
| `lagerstrasse` | a, b | a: Straße mit Rinne · b: Straße mit Brunnen. Je 3 Stempel |
| `kolonnade` | a, b | a: eine Säulenreihe · b: doppelte Reihe mit Lücken |
| `raetselfluegel` | a, b, c | a: **Aquädukt-Verteiler** (Leitungshebel = `raetsel`) · b: **Offiziersstube** (Schlüsselkasten = `raetsel`) · c: Signalturm (Feuerschale = `raetsel`) |
| `wachlokal` | a, b | a: Wachstube mit Automat-Nische · b: offene Wache mit Schranke |
| `treppe` | a, b | a: Rampe mittig · b: Rampe am Rand |
| `innerstes` | a, b, c (Signatur rom) | a: **Fahnenheiligtum** mit Kassengewölbe (Kassentür = `tor`, Legionskasse = `fund`) · b: Principia-Hof mit Sacellum · c: eingestürztes Sacellum, Gewölbe halb offen |

Fehlende Varianten der Vorläufer-Bauweise kommen später (Apkallu-Kit). Der Typ `innerstes` ist dafür vorbereitet.

### 4.4 Schablonen
**R1 `ruine.prozessionsweg`**: Mauer im Süden, der Weg führt nach Norden zum Innersten
```
     0   1   2   3   4   5   6   7
y0   Tu  F   K   I   I   K   F   K
y1   L   L   L   I   I   W   L   L
y2   L   K   L   L   L   L   K   L
y3   Ma  B   Ma  P   Ma  Ma  Ma  E      Mauerreihe: richtung S
y4   V   Tr  Tr  Tr  Tr  Tr  Tr  V
```
| Platz | Typ | Lage | Bereich |
|---|---|---|---|
| vorfeld_w | vorfeld | 0,4 (`ankunft`) | hinein |
| vorfeld_o | vorfeld | 7,4 | rueckzug |
| porta | porta | 3,3 · S | hinein |
| bresche | bresche | 1,3 · S | hinein |
| cloaca | einsturzgang | 7,3 · S | rueckzug |
| mauer_* | mauer | (0,3)(2,3)(4,3)(5,3)(6,3) · S | – |
| truemmer_* | truemmerfeld | (1..6,4) | – |
| strasse_*, kolonnade_* | lagerstrasse, kolonnade | y1–y2, siehe Raster | gefecht |
| turm | turm | 0,0 | – |
| fluegel_w / fluegel_o | raetselfluegel | (1,0) / (6,0), **Paar A** | ziel |
| innerstes | innerstes | 3,0,2,2 | ziel |
| wache | wachlokal | 5,1 | ziel |

Dramaturgie:
- **Rein:** durch die Porta oder die Bresche.
- **Ablauf:** Gefecht auf der Lagerstraße, dann zu zweit getrennt die Flügel (W und O), dann öffnet die Kassentür.
- **Rückzug:** durch die Cloaca im Südosten zum zweiten Vorfeld, nicht zurück durch die Porta.

**R2 `ruine.doppeltor`**: Mauern im Westen und Osten, Innerstes in der Mitte
```
     0   1   2   3   4   5   6   7
y0   V   Ma  K   L   L   F   Ma  Tu
y1   Tr  P   L   I   I   L   P   Tr
y2   Tr  Ma  W   I   I   L   Ma  V
y3   Tu  Ma  K   L   L   K   B   Tr
y4   Tr  Ma  F   L   L   K   Ma  Tr      Spalte x1: richtung W · Spalte x6: richtung O
```
| Platz | Typ | Lage | Bereich |
|---|---|---|---|
| vorfeld_w | vorfeld | 0,0 (`ankunft`) | hinein |
| vorfeld_o | vorfeld | 7,2 | rueckzug |
| porta_w / porta_o | porta | (1,1) · W / (6,1) · O | hinein / rueckzug |
| bresche | bresche | 6,3 · O | hinein |
| mauer_* | mauer | übrige Zellen in x1 (W) und x6 (O) | – |
| fluegel_n / fluegel_s | raetselfluegel | (5,0) / (2,4), **Paar A** (diagonal weit auseinander) | ziel |
| innerstes | innerstes | 3,1,2,2 | ziel |
| wache | wachlokal | 2,2 | ziel |
| turm_* | turm | (7,0)(0,3) | – |
| innen | lagerstrasse/kolonnade | Rest x2..x5 | gefecht |
| aussen | truemmerfeld | Rest x0/x7 | – |

Dramaturgie:
- **Rein:** von Westen. Das Innere ist ein Ring um das Innerste.
- **Ablauf:** Das Team **muss** sich trennen (Flügel Nord und Süd), der Captain koordiniert.
- **Rückzug:** über das Osttor, also nicht zurück durch den Eingang.

**R3 `ruine.hangkastell`**: Terrassen, langer Weg hinein, kurzer hinaus
```
     0   1   2   3   4   5   6   7
y0   F   K   L   L   W   L   I   I
y1   Ma  Ma  Ma  T   Ma  Ma  I   I      Terrassenmauer y1: richtung S
y2   K   L   L   L   F   L   L   L
y3   Ma  P   Ma  Ma  B   Ma  Ma  E      Außenmauer y3: richtung S
y4   V   Tr  Tr  Tr  Tr  Tr  Tr  V
```
| Platz | Typ | Lage | Bereich |
|---|---|---|---|
| vorfeld_w | vorfeld | 0,4 (`ankunft`) | hinein |
| vorfeld_o | vorfeld | 7,4 | rueckzug |
| porta | porta | 1,3 · S | hinein |
| bresche | bresche | 4,3 · S | hinein |
| cloaca | einsturzgang | 7,3 · S | rueckzug |
| unterterrasse | lagerstrasse/kolonnade | y2 | gefecht |
| fluegel_unten / fluegel_oben | raetselfluegel | (4,2) / (0,0), **Paar A** (über die Terrassen getrennt) | ziel |
| treppe | treppe | 3,1 · S | – |
| terrassenmauer | mauer | (0,1)(1,1)(2,1)(4,1)(5,1) · S | – |
| oberterrasse | kolonnade/lagerstrasse | y0 x1..x3, x5 | gefecht |
| wache | wachlokal | 4,0 | ziel |
| innerstes | innerstes | 6,0,2,2 | ziel |

`kanten_fest`: innerstes ↔ (7,2) `tuer` (der Hinterausgang des Gewölbes zur Cloaca).

Dramaturgie:
- **Rein:** über die Unterterrasse und die Treppe (einziger Aufgang), dann am Wachlokal mit dem Kastell-Automaten vorbei. Der Wächter ist die Prüfung.
- **Rückzug:** vom Innersten direkt hinunter durch die Cloaca.

---

## 5. Kartenart SCHIFF (Team KITS-INNEN)

**Karte:** 2 Decks à 37×13 Kacheln, Atlas wie die Lerche (37×29, Deck II = Zeile + 16, Lücke `_`).
**Bauweise B1:** `germanen` (Langschiff, Klinkerplanken). Der Aufbau folgt dem Briefing: Antrieb hinten, Reaktor in
der Mitte, Brücke vorn. **Sektionen** gehen über die volle Deckhöhe (13 Zeilen). Statt Zellen gibt es **Steckplätze
mit fester Breite**. **Anschluss:** Längsgang in **Zeile 6** (einzeilig wie die Lerche, Tech Lead §2.5), optional
Nebengänge in Zeile 2 und 10. **Fallback** ein Deck (Entscheidung 9): Deck I allein muss den Pflichtsatz erfüllen,
außer `lift` und dem Schildgenerator.

### 5.1 Steckplätze (gleiches Breitenraster auf beiden Decks, damit Lift und Leiter übereinander liegen)
| Deck | Heck → Bug | | | | |
|---|---|---|---|---|---|
| I | `antrieb` (6, fest) | **A** (8, frei) | `reaktor` (5, fest) | **B** (12, frei) | `bruecke` (6, fest) |
| II | `heck_oben` (6, fest) | **C** (8, frei) | **D** (5, frei) | **E** (12, frei) | `bug_oben` (6, fest) |

### 5.2 Pflichtsatz Schiff
`eingang` 2 · `abholpunkt` 2 (je Deck 1, 1 mit `ankunft`) · `sprengpunkt` 1 · `ziel` 2 · `terminal` 1 · `zelle` 1 ·
`beute` 3 · `nsc` 1 · `wache` 4 · `lift` 1 Paar (Deck I/II) · `leiter` 1 Paar.

### 5.3 Sektionstypen
| Typ-ID | Breite | Art | Pflichtanker | Bemerkung |
|---|---|---|---|---|
| `antrieb` | 6 | fest Deck I | `eingang`(technisch) 1 (Wartungsluke), `abholpunkt` 1 (`ankunft`), `lift` 1 | Lift an fester Stelle (Spalte 2–3, Zeile 2–3) |
| `reaktor` | 5 | fest Deck I | `sprengpunkt` 1, `ziel` 1, `wache` 1 | Längsgang führt **am Kern vorbei** (Nadelöhr) |
| `bruecke` | 6 | fest Deck I | `ziel` 1 (Steuer), `terminal` 1, `nsc` 1, `wache` 1, `leiter` 1 | Leiter an fester Stelle (Spalte 2–3, Zeile 10) |
| `heck_oben` | 6 | fest Deck II | `lift` 1, `zelle` 1 (Arrest), `beute` 1 | Lift genau über dem Lift von `antrieb` |
| `bug_oben` | 6 | fest Deck II | `ziel` 1 (Schildgenerator), `sprengpunkt` 1, `leiter` 1 | Leiter genau über der Leiter der `bruecke` |
| `transferkammer` | 5 | Kern | `eingang`(laut) 1, `abholpunkt` 1 | wie die Transferkammer der Lerche |
| `schleuse` | 5 | Kern | `eingang`(technisch) 1, `abholpunkt` 1 | Außenschott an der Hülle (Zeile 0 oder 12) |
| `laderaum` | 12 | Kern | `beute` 3, `wache` 1, optional `eingang`(leise) 1 (Hüllenbruch) | viel Deckung `o`/`O` |
| `zellen` | 8 | Kern | `zelle` 2, `wache` 1 | |
| `waffenkammer` | 8 | Kern | `raetsel` 2 (Paar, Zwei-Mann-Regel), `beute` 1 | Paar an gegenüberliegenden Wänden |
| `quartiere` | 8 | Füll | `nsc` 2 | Kojen |
| `lager` | 8 | Füll | `beute` 2 | |
| `batteriedeck` | 12 | Füll | `wache` 2 | halbhohe Schotts `o`, Geschützbänke `O`: der Ort für Granaten |

### 5.4 Modulliste (33 Module)
- **Feste Sektionen, je 2 Varianten:** `antrieb` a/b, `reaktor` a/b, `bruecke` a/b, `heck_oben` a/b, `bug_oben` a/b (10).
- **Kern, je 3:** `transferkammer`, `schleuse`, `laderaum`, `zellen`, `waffenkammer` (15).
- **Füll, je 2:** `quartiere`, `lager`, `batteriedeck` (6).
- **Signatur germanen (2):** `bruecke.drachenkopf` (Steuerstand im Bugdrachen, Hochsitz `^`) und `antrieb.esse` (offene Glut-Esse, Deckung `O`).

### 5.5 Schablonen
**F1 `schiff.frachter`**
| Deck | antrieb | A (8) | reaktor | B (12) | bruecke |
|---|---|---|---|---|---|
| I | antrieb | quartiere | reaktor | **laderaum** (Hüllenbruch = `eingang` leise) | bruecke |
| II | heck_oben | lager | **D: transferkammer** | **E: laderaum** | bug_oben |

Dramaturgie:
- **Rein:** über den Hüllenbruch im Laderaum (leise), die Transferkammer (laut) oder die Wartungsluke.
- **Ziel:** die Ladung (Laderäume) oder die Brücke.
- **Rückzug:** hinauf zur Transferkammer auf Deck II.

**F2 `schiff.kriegsschiff`**
| Deck | antrieb | A (8) | reaktor | B (12) | bruecke |
|---|---|---|---|---|---|
| I | antrieb | **zellen** | reaktor | **batteriedeck** | bruecke |
| II | heck_oben | **waffenkammer** | **D: schleuse** | **E: laderaum** | bug_oben |

Dramaturgie:
- **Rein:** über die Schleuse auf Deck II oder die Wartungsluke.
- **Gefecht:** Der Reaktor ist das Nadelöhr zwischen Heck und Bug. Das Batteriedeck ist der Gefechtsplatz für Nahkampf und Granaten.
- **Ziele:** Brücke einnehmen (*kapern*), Zellen öffnen, Schildgenerator oder Reaktor sprengen.

**Spiegeln:** Deck II darf horizontal gespiegelt werden, **nicht** Deck I (Bug bleibt rechts). C/E dürfen bei Bedarf die
Rollen tauschen, wenn die Breiten passen.

---

## 6. Landepunkte im Saumraum (`content/welt/landepunkte.json`)

**Format:** Tech Lead §2.4/§3.3. **Besitz-IDs:**
- `rostmeute`: Piraten, Muskeln sind die Friedlosen
- `kontor`: germanischer Handelsclan
- `raubzug`: germanischer Plünderzug
- `herrenlos`: ohne Besatzung, ggf. Kastell-Automaten
- `kustoden`

`seed` ist ein Startwert. Der Zusammenbau speichert den wirksamen Seed.

| ID | Ort (Hex) | Kartenart | Bauweise | Besitz | Zustand | Seed | frei ab |
|---|---|---|---|---|---|---|---|
| `b7.plattform` | Boje B-7 (0406) | platform (Hand) | – | konkordat | intakt | – | immer |
| `b7.aussenstelle` | Boje B-7 | station | germanen | rostmeute | verfallen | 7 | nach Tutorial |
| `wrack.zaunkoenig` | Wrack (0405) | wreck (Hand) | – | herrenlos | verfallen | – | immer |
| `wrack.langschiff` | Wrack | schiff | germanen | raubzug | verfallen | 405 | nach Tutorial |
| `kesh.mond` | Mond Kesh (0205) | kesh (Hand) | vorlaeufer | kustoden | intakt | – | immer |
| `kesh.kastell` | Mond Kesh | ruine | rom | herrenlos | verfallen | 205 | nach Tutorial |
| `kesh.grabung` | Mond Kesh | aussenposten | germanen | rostmeute | umkaempft | 2051 | nach Tutorial |
| `hafen.kontor` | Lichtkordon (0206) | station | germanen | kontor | intakt | 206 | nach Tutorial |
| `splitter.schuerflager` | Splittergürtel (0306) | aussenposten | germanen | rostmeute | umkaempft | 306 | nach Tutorial |
| `splitter.treibgut` | Splittergürtel | schiff | germanen | raubzug | verfallen | 3061 | nach einem Raumgefecht dort (treibend) |
| `vaelen.handelsschiff` | Vaelen-Karawane (0207) | schiff | germanen | kontor | intakt | 207 | nach Tutorial |
| `nebel.havarist` | Graue Weite (0307) | schiff | germanen | raubzug | umkaempft | 307 | nach Tutorial |
| `rostnest.kastell` | Rostnest (0107) | ruine | rom | rostmeute | verfallen | 107 | **gesperrt**, bis der Spielleiter das Rostnest freischaltet (Entscheidung 33) |
| `rostnest.lager` | Rostnest | aussenposten | germanen | rostmeute | intakt | 1071 | gesperrt, wie oben |

**Feindschiff nach Raumgefecht (Entscheidung 8):** Der Landepunkt `<ort>.prise` wird zur Laufzeit angelegt (Schiff,
germanen, Besitz = Fraktion des Gegners) und verfällt nach der Mission, wenn er nicht gespeichert wird.
**Prüfstein mit sechs Missionen:** Im Saumraum sind alle vier Kartenarten erreichbar: station (2), aussenposten (2),
ruine (1, Kesh), schiff (3–4).

---

## 7. Fraktionen und Besetzung (`content/katalog/fraktionen/*.json`, Tech Lead §11.1)

### 7.1 Gegnertypen (neutral) und Modelle je Fraktion
| Typ-ID | Rolle | Waffe | Modell `rostmeute` | Modell `kontor`/`raubzug` (germanen) | Modell `herrenlos` |
|---|---|---|---|---|---|
| `grundtyp` | Grundtyp | blaster | **Plünderer** (gibt es) | **Karl** | – |
| `niederhalter` | festhalten | sturmgewehr | Bolzer (Rostmeute-Palette) | **Bolzer** | – |
| `grenadier` | austreiben | granatwerfer | Donnerwerfer (Rostmeute-Palette) | **Donnerwerfer** | – |
| `schuetze` | Distanz | lanze | Jäger (Rostmeute-Palette) | **Jäger** | – |
| `enterer` | stürmen | nahkampf | Berserker (Rostmeute-Palette) | **Berserker** | – |
| `haescher` | fangen | betaeuber | Wergeld-Fänger (Rostmeute-Palette) | **Wergeld-Fänger** | – |
| `waechter` | Frontschild | schwer | – | – | **Kastell-Automat** (rom); Kustoden-Wächter (gibt es) |

### 7.2 Trupp-Rezepte (für 3 Spieler; `squadScale` skaliert)
| Fraktion | Rezept-ID | Zusammensetzung | Einsatz |
|---|---|---|---|
| rostmeute | `rotte` | 2 grundtyp + 1 niederhalter | Standard |
| rostmeute | `enterrotte` | 1 niederhalter + 2 enterer | Innenkarten (Station, Schiff) |
| rostmeute | `soeldner` | 1 grenadier + 2 grundtyp | Außenposten, Höfe |
| rostmeute | `loesegeld` | 1 haescher + 1 niederhalter + 1 grundtyp | erst, wenn die Crew den Häscher kennt (Einführungsregel) |
| rostmeute | `posten` | 1 schuetze + 1 grundtyp | `aussicht`, Wachturm |
| kontor | `kontorwache` | 2 grundtyp + 1 haescher | Station Kontor (nimmt Diebe fest) |
| kontor | `schiffswache` | 2 enterer + 1 schuetze | Handelsschiff |
| raubzug | `keil` | 1 niederhalter + 2 enterer + 1 grundtyp | Schiff, Station |
| raubzug | `jaeger` | 2 schuetze + 1 enterer | offene Karten |
| raubzug | `sturm` | 1 grenadier + 1 niederhalter + 1 enterer | Batteriedeck, Höfe |
| herrenlos | `kastellwache` | 1 waechter (Kastell-Automat) | `wache` mit `schwer` |
| herrenlos | `torwache` | 2 waechter | nur `innerstes`/`porta` |
| kustoden | `waechter` | 1 waechter (+ Störrelais auf Kesh) | wie heute |

**Stärke:** `klein` = 1 Trupp · `mittel` = 2 Trupps · `gross` = 3 Trupps + 1 Rezept `posten` an `aussicht`.
**Regeln für den Mix:**
- Höchstens 3 Typen je Trupp.
- Höchstens 1 `enterer` je verbundenem Spieler.
- Kein `haescher` bei 1 Spieler.
- Höchstens **eine neue Rolle je Gefecht**, solange die Crew sie nicht kennt (Weltstand `rollen_gesehen`, Entscheidung 24).

### 7.3 Haltung
| Haltung | Besetzung | Verhalten |
|---|---|---|
| `ruhig` | 1 Trupp an `wache`-Ankern, die übrigen laufen **Patrouillen** zwischen `patrouille`-Ankern | nicht alarmiert. Lärm (§10.1) oder Sichtkontakt alarmiert **den Trupp**, Funk alarmiert nach 4 s die übrigen im Umkreis von 20 Kacheln (S) |
| `wach` | alle Trupps an `wache`-Ankern im Bereich `gefecht` und `ziel`, Schützen auf `aussicht` | von Beginn an alarmiert. Weltstand `alarm: true` setzt beim zweiten Besuch automatisch `wach` |

### 7.4 Funksätze je Rolle (Deutsch; `barks` je Typ; Germanen- und Rostmeute-Modelle teilen sie)
**grundtyp** (die bestehenden `contact/flank/retreat/shieldUp/playerDown/lost/half` bleiben), dazu:
1. „Da hinten bewegt sich was!“ 2. „Haltet die Stellung!“ 3. „Mehr kommen nicht durch, Leute!“ 4. „Wer schießt da?“
5. „Zurück, zurück!“

**niederhalter** (Leitsatz: festhalten):
1. „Ich halt sie fest!“ 2. „Die kommen da nicht raus!“ 3. „Köpfe runter da drüben!“ 4. „Ich nagel sie fest, geht rum!“
5. „Bolzen frei, Dauerfeuer!“ 6. „Heiß gelaufen, kurz Pause!“ (bei Überhitzung) 7. „Weiter drauf, nicht nachlassen!“

**grenadier** (Leitsatz: austreiben):
1. „Granate!“ 2. „Raus da mit euch!“ 3. „Donner kommt!“ 4. „Hinter der Kiste sitzen sie, gleich nicht mehr!“
5. „Abstand, ich werfe!“ 6. „Rohr kühlt, deckt mich!“

**schuetze** (Leitsatz: Distanz):
1. „Hab einen im Visier.“ 2. „Position bezogen.“ 3. „Lade … gleich.“ 4. „Der da am Rand gehört mir.“
5. „Zu nah, ich wechsle!“ 6. „Ich seh sie vom Turm aus.“ (gibt geteilte Sicht, Entscheidung 16)

**enterer** (Leitsatz: stürmen):
1. „Ich geh rein!“ 2. „Nah ran!“ 3. „Für den Clan!“ 4. „Steh still, Kleiner!“ 5. „Mir nach, in die Enge!“
6. „Das war nur ein Kratzer!“ (bei der ersten Wunde) 7. „Holt mich hier raus!“ (liegend)

**haescher** (Leitsatz: fangen):
1. „Den nehm ich mit.“ 2. „Lebend!“ 3. „Der schläft, ich binde ihn!“ 4. „Das gibt gutes Wergeld.“
5. „Haltet sie mir vom Leib, ich fessle!“ 6. „Einer ist gebunden!“

**waechter** (Kastell-Automat, maschinell; Kustoden bleiben stumm):
1. „SIGNUM IGNOTUM. HALT.“ 2. „KASTELL GESCHLOSSEN.“ 3. „PRAETORIUM GESCHÜTZT.“ 4. „PARADE.“ (wenn er von vorn abwehrt)
5. „ORDO … GESTÖRT.“ (Wunde)

**Gemeinsam (neue Lagen aus B2):**
- Kamerad liegt: „Hoch mit dir!“, „Ich hol dich!“
- Spieler gefesselt: „Den haben wir!“
- Alarm durch Lärm: „Das war ein Schuss! Alle wach!“
- Friendly Fire: „Pass doch auf, du Narr!“

---

## 8. Bauweise-Lexikon (`content/buehnen/lexikon/<bauweise>.json`)
Umsetzungen und Spielleiter holen Namen per Platzhalter (`{{lex.fund}}` usw.). ODA-Texte bleiben neutral.

| Schlüssel | germanen | rom | vorlaeufer |
|---|---|---|---|
| `fund` | Runenstein | Legionskasse | Tafel *(im freien Spiel nur „Steintafel“; das Wort „Tafel“ ist ohne Tutorial verboten, siehe §9.4)* |
| `fund_alt` | Clanschatz, Eidring | Adlerstandarte, Archivtafeln | Siegelzylinder |
| `tor` | Bohlentor | Kassentür / Porta | Gewölbetor |
| `tor_station` | Schott | – | – |
| `schluessel` (Rätselpaar) | Runenpaar | Zwei-Offiziers-Schloss | Archivschlüssel |
| `raetsel_tipp` | „Der Eid gilt nur, wenn zwei ihn sprechen.“ | „Die Kasse öffnet nie einer allein.“ | „Die Kustoden bauten für Paare.“ |
| `herzstueck` | Langhaus / Methalle | Fahnenheiligtum | Archiv |
| `terminal` | Runentafel | Wachbuch / Tabularium | Inschrift |
| `sprengpunkt` | Met-Kessel / Tanklager | Pulverkammer (Wurfmaschinen-Depot) | Kristallader |
| `zelle` | Schuldkäfig | Carcer | Ruhekammer |
| `beute` | Truhe | Vorratsamphore | Reliquiar |
| `ziel` | Hochsitz / Banner | Feldzeichen | Siegel |
| `aussicht` | Krähennest | Turmstumpf | Sternwarte |
| `abholpunkt` | Landeplatz | Vorfeld | Lichtung |
| `wachen` | Clankrieger | Kastell-Automaten | Wächter |
| `eingang_laut` | Haupttor | Porta | Haupttor |
| `eingang_leise` | Zaunlücke | Bresche | Spalt |
| `eingang_technisch` | Abfluss / Wartungsluke | Cloaca | Lüftungsgang |
| `ort_muster` | „<Name>s Hof“, „<Name>wacht“ | „Castellum <Name>“ | „Stätte von <Name>“ |
| `namen` | Hrolf, Asgerd, Brand, Ulva, Kjell, Sigrun | Varus, Licinia, Aquila, Severus | – |

---

## 9. Katalog (Team KATALOG; Spielleiter liest)

### 9.1 Die 9 bestehenden Boden-Umsetzungen umstellen (`buehne_braucht` statt `params.map.werte`)
| Umsetzung | `kartenarten` | `anker` | Parameter neu | Hinweis |
|---|---|---|---|---|
| `raetsel_loesen/zwei_schluessel` | ruine, kesh | `raetsel`(Paar), `tor` | `funk_tipp` ← `{{lex.raetsel_tipp}}` | |
| `artefakt_freilegen/fund_aus_gewoelbe` | ruine, kesh | `tor`, `fund` | `fund_name` ← `{{lex.fund}}` | `nach` → Bedingung „`tor` offen am selben Landepunkt“ |
| `stellung_nehmen/trupp_raeumen` | alle | `wache` ≥ 2, Bereich `gefecht` | `besetzung: { fraktion, staerke }` statt `trupp` | Besetzung aus Rezept (§7) |
| `entkommen/zu_den_pads` | alle | `abholpunkt` | `gegenstand` frei (Standard `{{lex.fund}}`), `nachhut` aus Rezept | |
| `ausschlachten/wrack_container` | wreck, schiff, station (verfallen) | `beute` ≥ 3 | – | |
| `rekonstruieren/wrack_logbuch` | wreck, schiff, station, ruine | `terminal` (+ optional `versteck`) | Hohlraum nur, wenn `versteck` da ist | |
| `personen_bergen/techniker_retten` | alle | `nsc` oder `zelle`, `abholpunkt` | – | |
| `datenkern_bergen/plattform_kern` | platform | (bleibt) | – | bleibt Tutorial-Karte. Allgemein übernimmt `daten_stehlen/download` |
| `raetsel_loesen/sonden_code` | platform | (bleibt) | – | bleibt auf B-7 |

### 9.2 Neue Umsetzungen (≥ 3 je Kartenart)
Mechaniken (in `mechaniken.json` auf `verfuegbar` zu stellen):
- `sprengladung` (light, Entscheidung 7)
- `hacken` (light: Download per E halten, Abbruch bei Treffer)
- `stealth_aussen` (Grundstufe, Entscheidung 18)
- `gefangenschaft` (Entscheidung 12)
- `aussen_kampf` (jetzt auf allen Karten)

| ID (Molekül/Umsetzung) | Kartenarten | Anker | Mechaniken | Dauer (S, zu dritt) | Kurz |
|---|---|---|---|---|---|
| `sabotieren/ladung_am_sprengpunkt` | aussenposten, station, schiff | `sprengpunkt`, `abholpunkt` | sprengladung, aussen_kampf | 4–6 | Ladung (Plotgegenstand) setzen, 60 s Countdown, raus. Explosion: Flächenschaden, Zustand `zerstört` im Weltstand |
| `daten_stehlen/download` | station, aussenposten, schiff | `terminal` ≥ 2 | hacken, wissen_aufteilen | 3–5 | Der Captain sieht, welches Terminal den Kern hat. Download 6 s, Abbruch bei Treffer |
| `geiseln_befreien/zellen_oeffnen` | aussenposten, station, schiff | `zelle`, `wache`, `abholpunkt` | aussen_kampf, aussen_objekte | 4–6 | Zelle öffnen, Geisel folgt zum Pad. Leise mit dem Betäuber, laut geht auch |
| `durchbrechen/bis_zum_ziel` | alle | `eingang`, Bereich `ziel` | aussen_kampf | 3–5 | Vom Eingang in den Zielbereich gegen `wach`e Besetzung |
| `unbemerkt_hineinkommen/leise_bis_ziel` | aussenposten, station | `eingang`(leise), Bereich `ziel`, `patrouille` | stealth_aussen | 4–6 | Haltung `ruhig`, Ziel erreichen, ohne dass ein Trupp alarmiert wird. Bei Alarm kippt die Szene in *durchbrechen* |
| `kapern/bruecke_nehmen` | schiff | `ziel` (Brücke), `wache` | aussen_kampf, aussen_objekte | 4–6 | Brücke räumen, Steuer 3 s halten. Folge wird erzählt (Ladung, Kennung), kein Schiffswechsel |
| `krise_eindaemmen/ventile` | station, schiff | `ziel` ≥ 3 im Reaktorraum | aussen_objekte | 3–4 | Drei Ventile in 90 s, verteilt, gleichzeitig zwei |
| `evakuieren/quartiere` | station | `nsc` ≥ 2, `abholpunkt` | aussen_objekte, aussen_kampf | 4–6 | 2–3 Personen zum Pad bringen |
| `probe_nehmen/am_fund` | ruine | `fund` oder `beute` | aussen_objekte | 2–3 | Probe aus dem Gewölbe |
| `suchen/weitscan_versteck` | ruine, schiff | `beute`, optional `versteck` | weitscan, aussen_objekte | 3–4 | Captain-Weitscan markiert, das Team birgt |
| `ziel_markieren/von_der_aussicht` | aussenposten, ruine | `aussicht`, `sprengpunkt` | aussen_objekte | 2–3 | Vom Plateau markieren, Orbitalschlag auf den Sprengpunkt |
| Szenentyp **Ausbruch** (`ausbruch/aus_der_zelle`) | alle mit `zelle` + `beute` | `zelle`, `beute`, `abholpunkt` | gefangenschaft | 4–6 | Start in der Zelle, Waffen an der `beute`-Truhe, dann zum Pad |

**Abdeckung:**
| Kartenart | Umsetzungen |
|---|---|
| Außenposten | sabotieren, daten stehlen, geiseln befreien, durchbrechen, unbemerkt, ziel markieren, + trupp_raeumen, zu_den_pads |
| Station | sabotieren, daten stehlen, geiseln befreien, krise, evakuieren, unbemerkt, + ausschlachten, logbuch, retten |
| Ruine | zwei_schluessel, fund_aus_gewoelbe, probe, suchen, ziel markieren, + trupp_raeumen, zu_den_pads |
| Schiff | kapern, sabotieren, daten stehlen, geiseln befreien, krise, + ausschlachten, logbuch |

### 9.3 Zwei Archivmissionen mit Bodenszene (`content/spielleiter/archiv/`, Entscheidung 6)
**Archiv B1 „Frachtlisten“** (Auftraggeberin Tesk, 15 min, Bodenszene auf neuer Karte)
| Szene | Szenentyp | Ort / Landepunkt | Molekül/Umsetzung | Dauer | Weiter |
|---|---|---|---|---|---|
| s1_hafen | hafen | hafen | – | 2 | Auftrag angenommen → s2 |
| s2_kontor | infiltration (verfügbar mit `stealth_aussen`) | `hafen.kontor`, Haltung `ruhig`, Stärke `klein` | `daten_stehlen/download` | 5 | Download fertig → s3. Alarm → Wendung „Wergeld-Fänger an der Schleuse“ |
| s3_raus | rueckzug | `hafen.kontor` | `entkommen/zu_den_pads` (Gegenstand „Frachtlisten“) | 3 | an Bord → s4 |
| s4_abgabe | hafen | hafen | – | 2 | Ende |

*Sachverhalt:* Der Kontor-Clan meldet weniger Fracht, als er durch den Saumraum schleust. Tesk will die echten Listen,
ohne Streit mit dem Clan. *Folgen:* Flag `kontor_bestohlen`, Kontor-Landepunkt `alarm`, wenn die Crew entdeckt wurde.

**Archiv B2 „Castellum Kesh“** (Auftraggeberin Archivarin Melk, **lang: 28 min**, zwei Bodenszenen am selben Landepunkt)
| Szene | Szenentyp | Ort / Landepunkt | Molekül/Umsetzung | Dauer | Weiter |
|---|---|---|---|---|---|
| s1_hafen | hafen | hafen | – | 2 | → s2 |
| s2_anflug | raumgefecht | kesh | `vertreiben/bis_zur_flucht` (Rostmeute-Wachboot) | 5 | → s3 |
| s3_hof | gefecht | `kesh.kastell`, Besitz-Gäste: rostmeute (Grabräuber), Stärke `mittel` | `stellung_nehmen/trupp_raeumen` | 5 | → s4 |
| s4_kasse | raetselort | `kesh.kastell` | `raetsel_loesen/zwei_schluessel` + `artefakt_freilegen/fund_aus_gewoelbe` (Legionskasse) | 6 | Kasse geborgen → s5 |
| s5_rueckzug | rueckzug | `kesh.kastell` | `entkommen/zu_den_pads`. Wendung: der Kastell-Automat erwacht | 5 | → s6 |
| s6_abgabe | hafen | hafen | – | 3 | Ende |

*Sachverhalt:* Unter dem Mond liegt ein römisches Kastell aus der Zeit, als Rom den Saumraum hielt. Grabräuber der
Rostmeute graben nach der Legionskasse. Melk will die Archivtafeln aus der Kasse, bevor sie verschwinden.
**Hinweis:** Kesh-Vorläuferstätte, Tafel und Tutorialbegriffe kommen nicht vor.

### 9.4 Tutorial-Orte: neue Besuchsgründe (für den Prompt und `wuensche`)
Verboten bleiben ohne Tutorial: „Tafel“, „Ivo“, „Datenkern“, „stumme Boje“, „Nachhut“. Zurücksetzen der Karte ist normal.

| Ort | Gründe |
|---|---|
| **Boje B-7** | Die Kontor-Außenstelle neben der Plattform wurde aufgegeben, und die Rostmeute hat sich dort eingenistet (`b7.aussenstelle`). · Jemand hat die Sonde **umprogrammiert**, die Drohnen sind wieder scharf. · Ein Techniker des Konkordats sitzt fest. |
| **Wrack „Zaunkönig“** | **Friedlose haben sich eingenistet** und schlachten es aus. · Daneben treibt ein zweites Wrack, ein germanisches Langschiff (`wrack.langschiff`). · Die Rostmeute baut das Wrack zur Falle aus (Notsignal als Köder). |
| **Mond Kesh** | Unter dem Mond liegt ein **römisches Kastell** (`kesh.kastell`), das einst die Vorläuferstätte bewachte. · Grabräuber der Rostmeute haben ein Lager aufgeschlagen (`kesh.grabung`). · Die Kustoden-Wächter reagieren auf das Graben. |

---

## 10. Startwerte Waffen und Gegner (`shared/config.js`, Blöcke `awayCombat.waffen`, `awayCombat.gegner`)
Die Werte sind gleich für Spieler und Gegner. Die Gegner-KI feuert in ihrem Rhythmus, aber nach denselben Waffenregeln.

### 10.1 Waffen (`awayCombat.waffen.<id>`)
| Feld | blaster | sturmgewehr | granatwerfer | lanze | nahkampf | betaeuber |
|---|---|---|---|---|---|---|
| `kadenz_s` | 0.3 | 0.15 | 1.2 | – | 0.6 (Erholung) | 0.45 |
| `hitze_pro_schuss` | 0.2 (5 Schuss) | 0.084 (12) | 0.5 (2) | 1.0 je volle Ladung | 0.34 (3 Schläge) | 0.25 (4) |
| `kuehl_verzoegerung_s` | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 | 0.6 |
| `kuehlung_pro_s` | 0.5 (2,0 s leer) | 0.4 | 0.33 | 0.4 | 0.5 | 0.5 |
| `sperre_s` (überhitzt) | 2.5 | 3.5 | 4.0 | 3.5 | 3.0 | 3.0 |
| `reichweite_kacheln` | 13 | 9 | 4–12 (Bogen) | 22 | 1.3 | 9 |
| `geschoss_px_s` | 380 | 420 | Flugzeit 0.8 s | sofort (Strahl) | – | 380 |
| `schaden_seg` | 1 | 0.5 | 1 (Fläche) | 1 bei 1,0 s / 2 bei 2,0 s Laden | 1 Wunde | 1 |
| `streuung_grad` | 2 | 6 → 14 (mit Hitze) | 0 (Ziel ±0,5 Kachel) | 0 | – | 2 |
| Flags | – | `reset_schildladen` | `flaeche_r` 1.5, `betaeubung_s` 1.5, `ueber_deckung`, `trifft_alle` | `durchschlag_front`, `laden_stehen`, `leuchten` | `ignoriert_schild`, `ausholen_s` 0.5, `vorne_geblockt_von_frontschild` | `nichttoedlich` |
| `laerm_kacheln` | 10 | 18 | 18 | 4 | 3 | 4 |
| Unterbrechung | – | – | – | Treffer bricht Laden ab | Treffer bricht Ausholen ab | – |

**Lärm:** abweichend vom Vorschlag im `techlead.md` §5.1 (14/8/3). Ich will „mittel = Sichtradius 10“, damit der
Blaster genau so weit hörbar ist, wie man sieht. Endwert nach dem BOTS-Lauf.
**Pistole** der Verwundeten unverändert (`pistolCooldown` 0.7, ohne Hitze).

### 10.2 Zustände (gelten für alle Kämpfer)
| Feld | Wert | Bedeutung |
|---|---|---|
| `bewusstlos_s` | 30 | Betäuber-Treffer ohne Schild → bewusstlos. Kein Ausbluten, keine Pistole, niemand kann helfen, danach wacht man von selbst auf |
| `fesseln_s` / `befreien_s` | 3 / 3 | E halten an Bewusstlosen bzw. Gefesselten |
| `aufrichten_s` | 4 | = `wounded.reviveTime`, gilt jetzt auch für Gegner (Entscheidung 10) |
| `ausbluten_s` | 45 | Spieler → Notrückholung wie heute. Gegner → endgültig außer Gefecht |
| `betaeubt_granate_s` | 1.5 | keine Bewegung, kein Schuss |
| `ankuendigung_min_s` | 0.5 | Ausholen, Lanzenleuchten, Granat-Zielkreis |

### 10.3 Gegner (`awayCombat.gegner.<typ>`)
| Typ | `schild_seg` | `wunden` | `speed` (px/s) | `aim` | Feuerrhythmus der KI (S) | `hitRadius` | Bemerkung |
|---|---|---|---|---|---|---|---|
| Spieler (Referenz) | 3 | 1 | 96 | – | – | 12 | regenDelay 4, regenStep 1.2 (wie heute) |
| `grundtyp` | 3 | 1 | 70 | 0.8 | 1 Schuss / 1,3 s (überhitzt nie) | 13 | = heutiger Plünderer |
| `niederhalter` | 3 | 1 | 60 | 0.9 | Stoß von 8 Schuss, dann 2 s Pause | 14 | feuert auf die letzte bekannte Position |
| `grenadier` | 3 | 1 | 60 | 1.0 | 1 Wurf / 3 s | 13 | meidet eigene Leute im Radius (nicht perfekt) |
| `schuetze` | 2 | 1 | 70 | 1.2 | volle Ladung (2 s), dann Stellungswechsel | 12 | sucht `aussicht` |
| `enterer` | 3 | **2** | 80 | – | Schlag, wenn ≤ 1,3 Kacheln | 15 | kein Sprint, ohne Deckungssuche |
| `haescher` | 3 | 1 | 70 | 0.9 | 1 Schuss / 1,0 s | 13 | Ziel: isolierte oder bewusstlose Spieler |
| `waechter` | **4** | **2** | 32 | 1.4 | 2,6 s, Schuss 2 Seg | 22 | `frontArc` 120, blockt auch Nahkampf von vorn (Entscheidung 14/15) |

Alle Gegner: `regenDelay` 4 (Wächter 6), `regenStep` 1.5 (Wächter 2), `shotTtl` 1.6 wie heute.

---

## 11. Wünsche ans Vokabular (an den Tech Lead; gelten erst nach Übernahme in den Vertrag)
| # | Wunsch | Warum | Ersatz, falls abgelehnt |
|---|---|---|---|
| W1 | Platzfeld **`richtung`** (N/O/S/W); der Zusammenbau probiert nur Lagen, bei denen die Außenkante des Moduls dorthin zeigt | Zaun-, Mauer- und Schleusenplätze haben sonst nur `frei`-Kanten, und Kanten allein erzwingen keine Ausrichtung | `kanten_fest` zu einem Pseudo-Nachbarn „außen“ |
| W2 | Arbeitslegende §1.3 als **gemeinsame Kit-Legende** übernehmen, insbesondere `^` Plateau, `/` Rampe, `z` Gitter, `w` schwache Wand, `S` Schott | Entscheidung 27 (Plateaus), Zellen und Zäune, `versteck` | eigene Zeichen, Bedeutung bleibt |
| W3 | **Deckungsstempel:** Füllmodule tragen `belegungen: [[rows-Overlay], …]` mit 2–3 Varianten nur aus `o`/`O`/`I`; der Seed wählt eine | mehr taktische Vielfalt ohne neue Module (Entscheidung 1) | je Stempel ein eigenes Modul (dann +20 Module) |
| W4 | Ankerrolle **`patrouille`** mit Attribut `kette`; benachbarte Plätze verbinden Ketten automatisch über offene Kanten | Schleich-Grundstufe (Entscheidung 18) braucht Wege | Patrouillen zwischen `wache`-Ankern |
| W5 | Ankerrolle **`versteck`** + Kachel `w` | `rekonstruieren` (Hohlraum), `suchen` | Hohlraum entfällt |
| W6 | `abholpunkt` mit **`ankunft: true`** (genau einer je Karte), Beam hinunter nur dorthin | sonst beamt die Crew in den Innenhof (A3) oder auf Deck II | Ankunft = erster `abholpunkt` im Bereich `hinein` |
| W7 | Ankerrollen **`lift`** und **`leiter`** mit `deck` (nur Schiff) | Decks in der Außenzone | fest in `karte.decks` |
| W8 | **Paare über Plätze:** Schablonenfeld `paare: { "A": ["fluegel_w", "fluegel_o"] }`; das Modul trägt `raetsel` ohne Paar, die Schablone setzt es | Rätselpaare weit auseinander (R1–R3) | Paar innerhalb eines 2×1-Moduls |
| W9 | `eingang.art` darf der **Platz** setzen (überschreibt das Modul) | ein Typ `schleuse` für laut und technisch spart 3 Module | zwei Typen `andockring`/`frachtschleuse` |
| W10 | `wache` mit **`schwer: true`** | Wächter-Spawn ohne eigenen Typ | Rolle `waechter` |
| W11 | `tor` als **allgemeiner verschließbarer Durchgang** (Schott, Kassentür, Tor); Name aus dem Lexikon | ein Ankertyp für „Durchgang verschlossen“ im Weltstand | `schott` als zweite Rolle |
| **W13** | **Verträglichkeit erweitern:** `wand↔frei` (Gebäudewand steht im Freien) und `tuer↔frei` (Tür ins Freie). **Ohne diesen Wunsch lässt sich keine Außen-Schablone dieses Dokuments bauen**: Lagerhalle, Zellenblock, Herzstück, Innerstes und Wachlokal (Kanten `wand`/`tuer`) liegen neben Hof oder Lagerstraße (`frei`) | Gebäude auf offenen Karten | jeder Gebäudeplatz bekommt `kanten_fest` zu allen Nachbarn (fehleranfällig) |
| **W14** | **`frei` tolerant ableiten:** Eine Kante gilt als `frei`, wenn ≥ 6 von 8 Kacheln begehbar sind und die Mitte frei ist | Zaun- und Mauerplätze haben am Rand eine Palisadenkachel (Zeile 1). Ihre Seitenkanten sollen zu Nachbarn und zum Kartenrand `frei` sein | Palisade erst ab Spalte 1 bis 6, Ecken offen (Lücken im Zaun, unschön) |
| W12 | Lexikon-Platzhalter `{{lex.<schluessel>}}` in Vorlagen, aufgelöst aus der Bauweise des Landepunkts | Texte ohne Pflege je Bauweise | Parameter mit Default |

### Modulzahlen gesamt (zum Abgleich mit `techlead.md` §2.7)
Außenposten 38 · Station 29 · Ruine 32 · Schiff 33 = **132**, davon 6 Signaturmodule. Das sind mehr als die ≈ 80–95 im
Tech-Lead-Konzept. Der Grund: Zaun- und Mauerplätze sind eigene Typen, und die Kernplätze haben 3 Varianten
(Entscheidung 1).

**Kürzungsreihenfolge, falls die Zeit nicht reicht** (Prüfstein und Pflichtsatz bleiben erfüllt):
1. Dritte Varianten der Eingangstypen
2. Füllmodule auf 1 Variante + 3 Stempel
3. `waffenkammer` (dann gibt es auf dem Schiff kein Rätselpaar)
