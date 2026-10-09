# Konzept B1–B3 „Bühnen & Bodenkampf“: Game Design

**Von:** Lead Game Design · **Stand:** 2026-10-08 · **Grundlage:** Briefing Bühnen & Bodenkampf, Vault-Notizen, Code-Stand nach S2b.
Alle Zahlen ohne Quelle sind **Schätzungen (S)** und Startwerte für `tune`. Gemessen ist bisher nur, was aus
`shared/config.js` oder dem Katalog zitiert wird.

## 0. Befunde aus dem Code, die das Design beeinflussen

| # | Befund | Folge |
|---|---|---|
| 1 | Der Katalog hat **9 Boden-Umsetzungen**, nicht 10 (`techniker_retten` gilt für drei Karten, deshalb die Zählung). | Rechnung in §2 mit 9. |
| 2 | Der Grobplan-Prompt legt **„etwa 15 min, nie unter 10 min“** fest. Alle 7 erzeugten Missionen haben 15 min. | Lange Missionen entstehen heute **gar nicht**, also läuft die Regel „jede lange Mission“ ins Leere (§5). |
| 3 | `wounded` (Spieler) und `knockOut` (Gegner) sind schon heute ungleich: Spieler liegen 45 s und können wiederbelebt werden. Gegner **verschwinden**. | „Gleiche Regeln“ verlangt hier eine Entscheidung (§3, E2). |
| 4 | Schaden ist ganzzahlig (`Math.max(1, segs)`). | ½ Segment (Sturmgewehr) braucht halbe Segmente in Logik und Anzeige. |
| 5 | Trupps haben schon `alert`, `wander` und Rollen (`pin/flank/retreat/push/advance`), dazu Sichtradius 10 Kacheln. | Eine **Schleich-Grundstufe** ist billig (§2, E9). |
| 6 | Die **Trupps stecken in den Karten** (`squad1/squad2/rearguard` als Spawn-Zeichen auf Kesh). | Das Umstellen auf Anker heißt vor allem: Besetzung aus der Karte lösen (Typen + Anzahl an `wache`-Ankern). |
| 7 | Spielbar ist nur der Saumraum, also Konkordat, Rostmeute, Kustoden und Vaelen. **Rom und Germanen kommen dort kaum vor.** | Paletten- und Gegnerprioritäten verschieben sich (§4, E14/E15). |
| 8 | Das Tutorial m2 läuft Hafen → Vaelen → Nebel → Relais. Wrack kommt nur im Abstecher Zaunkönig vor. | Die Limes-Änderung „Wrack hängt an B-7 statt am Nebel“ trifft nur den Abstecher (§8). |

---

## 1. Schablonen und Varianten

### Empfehlung zur Menge
| Kartenart | Schablonen | spiegelbar | Varianten je **Kernplatz** (Eingang, Ziel, Rückzug) | Varianten je **Füllplatz** (Hof, Korridor, Gelände) | Platztypen | Module (S) |
|---|---|---|---|---|---|---|
| Außenposten | **3** | ja (N/S und O/W) | 3 | 2 + Deckungsstempel | ~12 | 28–32 |
| Raumstation | **3** | ja | 3 | 2 + Deckungsstempel | ~9 | 22–26 |
| Ruine | **3** | ja (O/W) | 3 | 2 + Deckungsstempel | ~7 | 18–22 |
| Schiff | **2** | nein (Bug/Heck fest), Deck II frei | 2 je feste Sektion, 3 je freie | – | ~9 | 20–24 |

**Deckungsstempel (Vorschlag):** Ein Füllmodul bringt 2–3 vorgefertigte Belegungen mit Deckung (Kisten, Mauerreste,
halbe Schotts) mit. Der `seed` wählt eine davon. Für die Taktik verändert das mehr als ein neu gebautes Modul, kostet
aber nur Platzierung. Dasselbe Prinzip nutzt G1 später (Schnittstelle: Modul = Grundriss + Anker + n Belegungen).

**Ehrlich zu den Kosten:** Teuer sind die **Module (~90–100 insgesamt)**, nicht die Schablonen. Kais Minimum
(2 Schablonen, 2 Varianten) ergibt etwa 60 Module. Mein Vorschlag liegt rund 50 % darüber. Falls es knapp wird,
spare ich zuerst an den Varianten der Füllplätze (dafür gibt es die Deckungsstempel), nie an den Kernplätzen.

### Rechnung: Wie schnell nutzt es sich ab?
Spieler erkennen eine Karte an ihrem **Grundriss** (Schablone + Spiegelung) und am **Zielmodul**, kaum an den
Füllplätzen. Rein rechnerisch gibt es tausende Kombinationen (Kais Beispiel: über 1.400). Für die Abnutzung zählt nur
die Zahl der **wiedererkennbaren Einheiten**:

| | Außenposten | Station | Ruine | Schiff |
|---|---|---|---|---|
| Grundrisse (Schablone × Spiegelung) | 3 × 2 = 6 | 6 | 6 | 2 × 2 (Deck II) = 4 |
| × Zielmodul-Varianten | 3 → **18** | **18** | **18** | 2 → **8** |
| taktisch verschieden (× Eingänge 2³, Deckungsstempel) (S) | ~150+ | ~100+ | ~100+ | ~40+ |

**Häufigkeit (S):** Ein Spielabend hat etwa 3–4 Missionen. Bei 1 Bodenszene je 2 Missionen plus langen Missionen
rechne ich mit **~0,6 Bodenszenen je Mission**. Davon landen ~80 % auf den vier neuen Kartenarten, also ~0,12 je
Kartenart und Mission.
- **Gleicher Grundriss** (6 je Art) kommt etwa alle **50 Missionen ≈ 12–16 Abende** wieder. Mit Kais Minimum (2, ohne
  Spiegeln) wären es etwa alle **17 Missionen ≈ 4–5 Abende**. Das halte ich für zu früh, weil dann das Gefühl „kenn ich“
  im zweiten Monat einsetzt.
- **Ungleichverteilung:** Im Saumraum gibt es mehr Station und Außenposten als Ruine (Landepunkte, §1.3). Die meistgenutzte
  Art kommt vermutlich ~2× so oft vor, ihr Grundriss also etwa alle 6–8 Abende. Deshalb bekommen Station und
  Außenposten zuerst eine dritte Schablone, wenn Zeit fehlt.
- Der **Prüfstein** (6 Missionen, keine Karte gleich) ist schon mit dem Minimum und neuem `seed` erfüllt. Die Abnutzung
  ist das eigentliche Kriterium.

### 1.1 Schablonen je Kartenart (Skizzen)
Legende Dramaturgie: **R** = rein · **Z** = Ziel · **Rü** = Rückzug. Zellen 8×8, (Spalte, Zeile) ab 0.

**Außenposten (9×5)**

| Schablone | Plätze (Typ, Größe) | Dramaturgie |
|---|---|---|
| **A1 Talsperre** | Tor Süd (laut), Zaunlücke West (leise), Abfluss Ost (technisch) · Hof Mitte 2×1 + Wachturm · Lagerhalle 2×2 NO · Zellenblock NW · Landeplatz 2×2 außen SW · Treibstofflager O · Hügel SW (`aussicht`) | R von Süden in drei Breiten. Z nördlich hinter dem Hof (Halle oder Zellen). Rü über den Landeplatz (`abholpunkt` 1) oder zurück durchs Tor (`abholpunkt` 2). Der Hof ist der Gefechtsbereich. |
| **A2 Landefeld** | West: Landeplatz 2×2 + Zaunlücke · Mitte: Treibstofflager (`sprengpunkt`, Ablenkung), Lagerhalle 2×2 · Ost: Funkmast (`sprengpunkt`/`terminal`), Wachturm · Abfluss Süd | Lang von West nach Ost. R vom Landefeld, Z am Funkmast am anderen Ende. Rü über den Abfluss nach Süden: kurz, aber eng. Das Treibstofflager in der Mitte lädt zu „erst ablenken, dann zuschlagen“ ein. |
| **A3 Zwei Höfe** | Außenhof mit Tor + Wachturm · innerer Zaun mit zweitem Tor · innerer Hof: Zellenblock, Lagerhalle 2×2 · Zaunlücke Nord · Hügel O | Zweistufige Verteidigung, der Ort für *durchbrechen* und *geiseln befreien*. Der Rückzug geht **nicht** durch den Eingang, sondern über die Zaunlücke im Norden zum `abholpunkt` am Hügel. |

```
A1 Talsperre (9x5)      Z=Ziel  H=Hof  W=Turm  L=Landeplatz  T=Treibstoff  ^=aussicht
  . . Zb Zb . H H Lh Lh      Zb Zellenblock, Lh Lagerhalle 2x2
  . . Zb Zb W H H Lh Lh
  ~ H H H H H H H T  ~      ~ = Zaun; West: Zaunluecke, Ost: Abfluss
  L L . . H H . . .
  L L ^ . [Tor] . . . .
```

**Raumstation (6×3)**

| Schablone | Plätze | Dramaturgie |
|---|---|---|
| **S1 Ring** | Andockring W · Korridorschleife um den Kontrollraum (Mitte) · Reaktorraum O · Quartiere N · Wartungsschacht S (parallel, 1 Zelle breit) | R am Andockring (laut) oder über den Schacht (leise). Z Kontrollraum (`terminal`) oder Reaktor (`sprengpunkt`). Rü: Notschleuse O (`abholpunkt` 2). Die Schleife erlaubt Flankieren in beide Richtungen. |
| **S2 Spindel** | Hauptkorridor W→O mit 2 Schotts (`eingang`, hackbar) · Lager und Quartiere seitlich · Frachtschleuse S (zweiter Eingang) · Kontrollraum am Ende | Linear, Schott für Schott. Druck nach vorn, Niederhalter im Korridor. Rü über den Wartungsschacht, der das Ende mit der Frachtschleuse verbindet. |
| **S3 Kreuz** | Kreuzung Mitte (Gefechtsbereich) · 4 Arme: Andockring, Lager, Quartiere (NSC), Kontrollraum + Reaktor | Hub mit vier Armen. Gut für *evakuieren* (Quartiere → Andockring durch die Kreuzung) und *krise eindämmen*. |

**Ruine (8×5)**

| Schablone | Plätze | Dramaturgie |
|---|---|---|
| **R1 Prozessionsweg** | Vorhof S (2×2, Gefecht) · Säulengang · Galerie (Rätselpaar) · `tor` · Innerstes N (`fund`) · Einsturzgang seitlich · Treppe (`aussicht`) | Wie Kesh, nur größer: R → Kampf → Rätsel → Fund. Der Einsturzgang öffnet erst nach dem Fund und ist ein kurzer, dramatischer Rückzug. |
| **R2 Kreisheiligtum** | Innerstes Mitte · Galerien ringsum, zwei Rätselflügel O und W (Paar-Anker weit auseinander) · zwei Vorhöfe N und S | Zwei Eingänge, Team trennt sich zwangsläufig (Rätselpaar). Der Captain koordiniert. Wächterkammer am Innersten. |
| **R3 Hangkloster** | Vorhof W · Treppenfolge (3 Plätze) · Wächterkammer als Riegel · Innerstes O · Einsturzgang verbindet Innerstes und Vorhof | Längster Weg hinein, kürzester hinaus. Der Wächter ist die Prüfung, nicht der Weg. |

**Schiff (2 Decks à 37×13, Sektionen)**

| Schablone | Deck I (Heck → Bug) | Deck II | Dramaturgie |
|---|---|---|---|
| **F1 Frachter** | Antrieb · Laderaum (frei, doppelt breit) · Reaktor · Brücke | Transferkammer, Quartiere, Lager | R über Hüllenbruch im Laderaum oder Transferkammer. Z Laderaum (`beute`) oder Brücke. Rü zur Transferkammer (Deck II), also hinauf und durch die Quartiere. |
| **F2 Kriegsschiff** | Antrieb · Batteriedeck · Reaktor (Nadelöhr) · Brücke + Schildgenerator | Zellen, Waffenkammer, Transferkammer | Der Reaktor in der Mitte trennt Bug und Heck, dort die meiste Deckung. Ziele: Brücke einnehmen, Zellen öffnen, Reaktor sprengen. Enge = Nahkampf und Granaten. |

### 1.2 Was jede Schablone mitbringen muss (Prüfung ergänzend zu §4.1)
- 3 benannte **Bereiche** (hinein, Ziel, Rückzug), jeder mit eigenem Namen für ODA und Spielleiter („Hof“, „Zellenblock“).
- Die Rückzugsroute geht **nicht nur** über den Eingang, sonst ist der Rückzug ein Rückwärtsspulen.
- Mindestens 1 Sichtschatten pro Bereich, den der Captain aufdecken kann (sonst hat er nichts zu tun).
- Alle Pflichtanker sind von **jedem** Eingang aus erreichbar, nicht nur von einem (wichtig für „Durchgang verschlossen“
  beim zweiten Besuch).

### 1.3 Landepunkte im Saumraum (Vorschlag)
Damit der Spielleiter überhaupt Boden wählen kann, braucht jeder Saumraum-Ort einen neuen Landepunkt.

| Ort (Hex) | Landepunkte (Kartenart · Besitz) |
|---|---|
| Hafen Lichtkordon (0206) | Raumstation · Konkordat (Werftdeck) |
| Splittergürtel (0306) | Außenposten · Rostmeute (Schürfposten auf einem Brocken) · Schiff · verfallen |
| Boje B-7 (0406) | Plattform (Tutorial) · Raumstation · Konkordat (angedockte Messstation) |
| Vaelen-Karawane (0207) | Schiff · Konkordat-Palette, intakt (Karawanenfrachter) |
| Wrack „Zaunkönig“ (0405) | Wrack (Tutorial) · Schiff · verfallen (zweites Wrack daneben) |
| Graue Weite (0307) | Schiff · umkämpft/verfallen (Havarist im Nebel) |
| Kustoden-Relais (0308) | Raumstation · Vorläufer · Ruine · Vorläufer |
| Mond Kesh (0205) | Kesh (Tutorial) · Ruine · Vorläufer (zweite Grabung) · Außenposten · Konkordat (Grabungslager) |
| Rostnest (0107) | Außenposten · Rostmeute · Raumstation · Rostmeute |

Das sind 15 neue Landepunkte (S: genügt für den Saumraum). **Paletten-Priorität:** Konkordat, Rostmeute und
Vorläufer zuerst. Rom und Germanen braucht erst der Feldzug.

---

## 2. Moleküle mit B1 + B2

### 2.1 Was verfügbar wird
Status: **B1** = mit Ankern, Objekten und bestehenden Bausteinen · **B2** = braucht Waffen/Gegner/Betäubung ·
**+S** = nur mit Schleich-Grundstufe (E9) · **+L** = mit „Ladung/Download light“ (E10) · **nein** = braucht Gespräch,
Passagiere oder Werkzeuge.

| Molekül | Status | Kartenarten | Umsetzung in einem Satz |
|---|---|---|---|
| **sabotieren** | B1 +L | Außenposten, Station, Schiff | Ladung (Plotgegenstand der Mission) am `sprengpunkt` per E halten scharf machen, 60 s Countdown, raus zum `abholpunkt`. Der Flächenschaden kommt aus B2 (Granate). |
| **daten stehlen** | B1 +L | Station, Außenposten (Funkmast), Schiff (Brücke) | Download am `terminal`: E halten, wird bei Treffer unterbrochen. Der Captain sieht im Scan, welches von 3 Terminals den Kern hat (`wissen_aufteilen` gibt es). |
| **geiseln befreien** | B1 (B2 besser) | Außenposten (Zellenblock), Station, Schiff (Zellen) | `zelle` + `spawn_person` + Wachen an `wache`. Mit dem Betäuber leise, mit Gewalt laut. Die Geisel folgt zum `abholpunkt`. |
| **durchbrechen** | B1 (B2 macht es gut) | alle | Vom Eingangsbereich in den Zielbereich (`area_occupied` gibt es). Niederhalter und Grenadier machen es zur Aufgabe statt zum Spaziergang. |
| **kapern** | B1 | Schiff | Brücke räumen, dann Konsole E halten. Die Folge wird erzählt (Ladung, Kennung, Gefangene), **kein Schiffswechsel**. |
| **unbemerkt hineinkommen** | +S | Außenposten, Station | Vom leisen Eingang zum Ziel, ohne dass ein Trupp `alert` wird. Laute Waffen verraten. |
| **Ausbruch** (Szenentyp C8) | B2 (Gefangennahme) | jede Karte mit `zelle` | siehe §4.3 |
| evakuieren | B1 | Station, Schiff | 2–3 Personen (`spawn_person` ×n) von den Quartieren zum Andockring |
| krise eindämmen | B1 | Station, Schiff | 3 Ventile/Schalter am Reaktorraum unter Zeitdruck, verteilt und gleichzeitig |
| probe nehmen / suchen | B1 | Ruine | `fund` per Weitscan finden bzw. Probe am Anker nehmen |
| ziel markieren | B1 | Außenposten, Ruine | Vom `aussicht`-Anker markieren, dann feuert der Orbitalschlag (gibt es) |
| vernichten (Boden) | B1 +L | Außenposten | Funkmast oder Treibstofflager sprengen |
| halten (Boden) | B1, wenn `halten_aussen` mitkommt (klein) | alle | Bereich X s halten, Wellen an `eingang`-Ankern |
| beobachten / Infiltration (C4) | +S | Außenposten, Station | wie oben, mit `aussicht` |
| befragen, handeln, schlichten | nein | – | braucht Gespräche vor Ort (Siedlung) |
| gefangenen überstellen | nein (fast) | – | Fesseln kommt mit B2, Transport per Transfer fehlt (`ladung_transfer`) |

### 2.2 Mindestens 3 je Kartenart (ohne +S gezählt)
| Kartenart | verfügbar mit B1+B2 |
|---|---|
| Außenposten | sabotieren, geiseln befreien, durchbrechen, daten stehlen (Funkmast), ziel markieren, stellung nehmen\*, entkommen\* |
| Raumstation | daten stehlen, krise eindämmen, evakuieren, sabotieren, geiseln befreien, ausschlachten\*, rekonstruieren\*, personen bergen\* |
| Ruine | rätsel lösen\*, artefakt freilegen\*, stellung nehmen\*, entkommen\*, probe nehmen, suchen |
| Schiff | kapern, sabotieren (Reaktor), geiseln befreien (Zellen), ausschlachten\*, rekonstruieren\*, entkommen\* |

\* = umgestellte bestehende Umsetzung.

### 2.3 Die 9 bestehenden Boden-Umsetzungen
| Umsetzung | umstellbar? | braucht künftig | Stolperstein |
|---|---|---|---|
| `raetsel_loesen/zwei_schluessel` | **ja** | Rätselpaar + `tor` | Ruine. Auf dem Schiff als „Zwei-Mann-Regel an der Waffenkammer“, wenn das Modul ein Paar trägt. |
| `artefakt_freilegen/fund_aus_gewoelbe` | **ja** | `tor` + `fund` | Die Kette `nach: zwei_schluessel` wird zu „braucht offenes `tor`“ am selben Landepunkt. „Tafel“ wird zum Parameter. |
| `stellung_nehmen/trupp_raeumen` | **ja** | Bereich + `wache` | Die Trupps stecken heute in der Kesh-Karte. Die Besetzung muss als Typen + Anzahl aus der Szene kommen. |
| `entkommen/zu_den_pads` | **ja** | `abholpunkt` + Bereich | Parameter `gegenstand: tafel` verallgemeinern, Nachhut wie oben |
| `ausschlachten/wrack_container` | **ja** | `beute` ×n | Station (verfallen), Schiff (Laderaum) |
| `rekonstruieren/wrack_logbuch` | **ja**, teilweise | `terminal` (Lore) | Der optionale Hohlraum braucht einen Anker `versteck` (neu) oder fällt weg |
| `personen_bergen/techniker_retten` | **ja** | NSC-Anker oder `zelle` | – |
| `datenkern_bergen/plattform_kern` | **bedingt** | `ziel` (Halterung) | Inhalt ist Tutorial („Datenkern“ ist ohne Tutorial verboten). Besser: in `daten_stehlen` aufgehen lassen, B-7 behält das Original. |
| `raetsel_loesen/sonden_code` | **bedingt** | Objekt Sonde + gesperrtes Schott + Drohnen | Geht auf der Station als „Sicherheitsknoten sperrt das Schott“. Braucht dafür ein eigenes Modul mit Sonde. |

**Fazit:** 7 von 9 lassen sich direkt umstellen, 2 nur bedingt. Die eigentliche Arbeit ist **Besetzung raus aus der
Karte** (Befund 6), nicht die Anker.

---

## 3. Waffen-Balance

### 3.1 Bezugsgrößen (gemessen bzw. aus `config.js`)
Spielerschild 3 Segmente, lädt nach 4 s ohne Treffer, dann 1 Segment je 1,2 s. Plünderer 3 Segmente, feuert alle 1,3 s.
Wächter 6 Segmente, Frontbogen 120°, Schuss 2 Segmente. Blaster heute: Abklingzeit 0,3 s, Geschoss 380 px/s × 1,1 s
≈ **13 Kacheln** Reichweite. Sichtradius 10 Kacheln. Gehtempo 3 Kacheln/s.

### 3.2 Hitzekurven (Startwerte, alle S, per `tune`)
Eine Hitzeleiste für alle: Feuern heizt, nach **0,6 s Pause** kühlt sie. Bei 100 % ist die Waffe **überhitzt** und
gesperrt, bis sie ganz abgekühlt ist.

| Waffe | Schuss bis 100 % | Feuerrate | kalt aus 100 % (normal) | Zwangspause bei Überhitzung | Reichweite (Kacheln) | Wirkung | Lärm-Radius |
|---|---|---|---|---|---|---|---|
| **Blaster** | 5 | 0,3 s | 2,0 s | 2,5 s | 13 | 1 Seg | mittel: **10** (= Sichtradius) |
| **Sturmgewehr** | 12 | 0,15 s | 2,5 s | 3,5 s | 9 | ½ Seg + Laden-Reset; Streuung 6° → 14° mit der Hitze | laut: **18** |
| **Granatwerfer** | 2 | 1,2 s | 3,0 s | 4,0 s | 4–12 (Bogen, Mindestabstand 4) | Fläche r = 1,5 Kacheln, 1 Seg + Betäubung 1,5 s; Flugzeit ~0,8 s | laut: **18** |
| **Lanze** | 1 volle (oder 2 halbe) Ladung | Laden 1,0 s → 1 Seg, 2,0 s → 2 Seg | 2,5 s | 3,5 s | 22 | durchschlägt Frontschild; Leuchten + Zielstrahl am Ziel | leise: **4** |
| **Nahkampf** | 3 Schläge („Atem“ statt Hitze) | Ausholen 0,5 s + 0,6 s Erholung | 2,0 s | 3,0 s | 1,3 | 1 Wunde, Schild ignoriert | leise: **3** |
| **Betäuber** | 4 | 0,45 s | 2,0 s | 3,0 s | 9 | 1 Seg; Treffer ohne Schild → bewusstlos statt verwundet | leise: **4** |

**Kontrollrechnung (S):** Spitzenschaden Blaster 3,3 Seg/s, Sturmgewehr ebenfalls 3,3 Seg/s (6,7 × ½). Praktisch liegt
das Sturmgewehr wegen der Streuung darunter, seine Stärke ist der Reset. Eine Hitzeleiste reicht beim Blaster für
5 Segmente, beim Sturmgewehr für bis zu 6. Ein Spieler (3 Seg + 1 Wunde) fällt nach 4 Blaster-Treffern, **genau wie
heute**.

**Wunden:** Spieler 1, Plünderer, Niederhalter, Grenadier, Schütze und Häscher 1, Enterer 2. **Wächter: 4 Seg + 2 Wunden**
statt 6 + 2–3, sonst wird er deutlich zäher als heute (heute 6 + 1 = 7 Treffer, so 6). Bosse ab 3.

### 3.3 Spannungen der Kai-Regeln, ehrlich
| Risiko | Einschätzung | Gegenmaßnahme (Regel für alle, Fähigkeit statt Zahl) |
|---|---|---|
| **Wunden 1 bei Spielern zu tödlich?** | Nicht neu: Das ist die heutige Regel (3 Seg, dann am Boden). Neu sind die **Umgehungen**: Nahkampf (0 Seg), Lanze (2 Seg auf einmal), Granate + Folgetreffer. Ein Treffer, den man nicht kommen sah, fühlt sich unfair an (so steht es schon in Außenmission-Kampf). | **Ankündigungsregel:** Alles, was mehr als 1 Segment nimmt oder den Schild umgeht, ist ≥ 0,5 s vorher sichtbar (Ausholen, Lanzenleuchten + Zielstrahl **am Ziel**, Granatkreis). Das gilt auch für Spielerwaffen, Gegner reagieren also darauf. |
| **Nahkampf dominant?** | Ja, ohne Gegenmittel, vor allem auf dem Schiff (37×13). Ein Enterer mit 2 Wunden, der 1-Treffer-Spieler umhaut, ist der stärkste Gegner im Spiel. | (1) **Getroffen werden unterbricht das Ausholen** (gilt für alle). Damit kontert das Sturmgewehr den Nahkampf, eine schöne Rollenkette. (2) **Frontschild blockt auch Schläge von vorn** (E1). (3) Kein Sprint für Nahkämpfer, gleiches Tempo, also müssen sie über Deckung heran. (4) Besetzung: Der Spielleiter setzt höchstens 1 Enterer je Spieler (Besetzungsregel, keine Zahlenänderung). |
| **Lanze trifft aus dem Off** | Reichweite 22 > Sicht 10. Heute schießen Gegner nur in der `engageBox` (≈ Bildschirm). | Gezielt werden darf nur, was man **sieht**. Sicht über 10 hinaus nur am `aussicht`-Anker oder über **geteilte Sicht** (Spieler: Captain-Markierung; Gegner: Trupp-Funk). Ein Störsender kappt den Funk, das gibt es schon als Idee. |
| **Häscher: Gefangennahme ohne Game Over** | Lösbar, aber nur, wenn wir sagen, was bei „alle gefangen“ passiert (§4.3). | Fesseln ist umkehrbar (Kameraden befreien). Liegt das ganze Team und ist jemand gefesselt, folgt Ausbruch oder Notrückholung, nie das Ende. |
| **Friendly Fire Granate = Koop-Frust** | Echt. Wer seinen Freund betäubt, ärgert sich. Die Abnahme verlangt es aber, und es ist auch gut: Gegner-Grenadiere treffen ihre eigenen Leute genauso. | Zielkreis **für alle sichtbar, solange gezielt wird** (Team und Gegner weichen aus), Mindestabstand 4, automatischer Ruf „Granate!“ der Figur. Wirkung auf Verbündete gleich (Seg + Betäubung), also keine Sonderregel. |
| **Sturmgewehr: Spielerschild lädt nie** | Zwei Niederhalter sperren das Schildladen dauerhaft. Das ist die Rolle, kann aber zermürben. | Sie brauchen Sichtlinie. Volle Deckung oder Rauch bricht es. Der Funk „Ich halt sie fest!“ ist der Hinweis zum Flankieren. |
| **Gegner verschwinden, Spieler liegen** (Befund 3) | Verstößt heute schon gegen „gleiche Regeln“. | E2: Verwundete Gegner liegen auch und können von Kameraden aufgerichtet werden. Damit wird der Betäuber taktisch interessant. |
| **Betäubt vs. verwundet bei Spielern** | Ohne Unterschied ist der Betäuber gegen Spieler nur ein schwächerer Blaster. | **Bewusstlos:** kein Ausbluten, keine Pistole, niemand kann aufhelfen, man wacht nach **30 s (S)** von selbst auf. Wer bewusstlos ist, kann **gefesselt** werden (E halten 3 s). Gilt für beide Seiten. |
| **Lautstärke** | Ohne Alarmzustände bleibt „leise“ folgenlos. | Laute Waffen setzen jeden Trupp im Radius auf `alert` (gibt es). Das ist die Hälfte der Schleich-Grundstufe (E9). |
| **Solo** | Nahkampf und Häscher sind solo härter, weil niemand befreit. | Die bestehende `squadScale` bleibt. Zusätzlich keinen Häscher in der Besetzung, wenn nur 1 Spieler da ist (Besetzungsregel). |

---

## 4. Gegner-Rollen lesbar

### 4.1 Erkennbar ohne Erklärung
Grundsatz: **Die Waffe ist die Silhouette** (wie bei der Crew). Die Fraktion ändert Rüstung und Palette, nie die
Waffenform. Jede Rolle hat ein **eigenes Bewegungsmuster** und **einen Leit-Funkspruch**.

| Rolle | Verhalten (was man sieht) | Funk (Beispiele) | Silhouette / Effekt | Ton |
|---|---|---|---|---|
| Plünderer | duckt sich, zieht sich bei schwachem Schild zurück | „Schild runter, ich zieh mich zurück!“ (gibt es) | Standard, Blaster | mittel |
| **Niederhalter** | bleibt **stehen** und feuert in langen Stößen auf **eine** Deckung, bewegt sich kaum | „Ich halt sie fest!“, „Die kommen da nicht raus!“ | breiter, Gewehr mit Trommel, Mündungsfeuer flackert | lautes Rattern |
| **Grenadier** | hält Abstand, steht **hinter** den anderen, Pause zwischen Würfen | „Granate!“, „Raus da mit euch!“ | Rohr mit Trommel auf dem Rücken, **Bogen + Aufschlagkreis sichtbar** | dumpfer Abschuss |
| **Schütze** | wechselt zum `aussicht`-Anker, steht still und lädt | „Hab einen im Visier.“, „Position bezogen.“ | lange Waffe, **Leuchten + Zielstrahl** | Ladesurren steigt an |
| **Enterer** | läuft **direkt** und ohne Deckung auf den nächsten Spieler zu, oft paarweise | „Ich geh rein!“, „Nah ran!“ | massig, Klinge oder Axt, **Ausholen** mit Leuchtspur | Kampfschrei |
| **Häscher** | folgt dem Niederhalter, kommt an **Liegende** heran, kniet zum Fesseln | „Den nehm ich mit.“, „Lebend!“ | Fesselgerät am Gürtel, Betäuber mit blauem Schuss | Summen |
| Wächter | langsam, dreht sich zur Bedrohung | – (Maschinenton) | Frontbogen sichtbar | Brummen |

**Einführungsregel für den Spielleiter:** Höchstens **eine neue Rolle je Gefecht**, solange die Crew sie noch nicht kennt
(Weltstand: „Rolle gesehen“). Ein Trupp hat höchstens 3 Typen. Ohne diese Regel scheitert die Abnahme „Tester
beschreiben die Rolle“, weil zu viel gleichzeitig passiert.

### 4.2 Trupps je Fraktion (Größe für 3 Spieler, `squadScale` skaliert)
Weil nur der Saumraum spielbar ist, müssen **alle 7 Typen dort vorkommen**, sonst lässt sich die B2-Abnahme nur auf
dem Testgelände zeigen.

| Fraktion | Trupps | Rollen-Logik |
|---|---|---|
| **Rostmeute** (Saumraum) | *Rotte:* 2 Plünderer + 1 Niederhalter · *Enterrotte:* 1 Niederhalter + 2 Enterer · *Söldner:* 1 Grenadier + 2 Plünderer · *Lösegeldrotte:* 1 Häscher + 1 Niederhalter + 1 Plünderer | chaotisch, laut, nah. Lösegeld ist ein guter Grund für Gefangennahme. |
| **Konkordat-Sicherheit** (Saumraum, neu als Gegner) | *Streife:* 2 Wachleute (Blaster, Plünderer-KI) + 1 Häscher · *Zugriff:* 1 Niederhalter + 1 Häscher + 1 Schütze | Polizei: **nimmt fest statt zu töten**. Passt zu Schmuggel- und Infiltrationsmissionen. |
| **Kustoden** | 1 Wächter (+ Störrelais) · *Torwache:* 2 Wächter | wie heute |
| **Rom** (Feldzug) | *Contubernium:* 2 Niederhalter + 1 Grenadier · *Feuerstellung:* 1 Schütze + 2 Niederhalter | diszipliniert, Funk in Befehlsform |
| **Germanen** (Feldzug) | *Keil:* 3 Enterer + 1 Schütze · *Jäger:* 2 Schützen + 1 Enterer | Nahkampf und Distanz, ohne Niederhalter. Das Festhalten übernehmen die Schützen. |

### 4.3 Häscher und „Ausbruch“: wie weit in B2
| Stufe | Inhalt | Empfehlung |
|---|---|---|
| 1 Fesseln | Bewusstlose (Spieler oder Gegner) werden per E halten gefesselt und von Kameraden befreit. Gefesselte Gegner bleiben ausgeschaltet. | **B2, Pflicht** (sonst ist der Häscher nur ein leiser Blaster) |
| 2 Ausbruch auf derselben Karte | Liegt das ganze Team und ist mindestens einer gefesselt, gibt es **Schnitt statt Notrückholung**: „Ihr kommt in einer Zelle zu euch.“ Szenentyp C8 auf derselben Karte, Start am `zelle`-Anker, Waffen liegen am `beute`-Anker im Wachraum, Waffe bis dahin nur die Fäuste (Nahkampf). Hat die Karte keine `zelle` oder erlaubt das Regiebuch es nicht, kommt die Notrückholung wie heute. | **B2, empfohlen.** Billig, weil Karte, Anker und Gefangennahme schon da sind. Schaltet `gefangenschaft` frei. Kein Game Over. |
| 3 Verschleppung | Gefangene werden auf eine andere Karte gebracht (Feindschiff, Rostnest), Befreiung als Folgemission, Weltstand „X gefangen“ | **später** (braucht Transport zwischen Karten und Folgemissionen) |

---

## 5. „Lange Mission“ und Quote

**Schwelle:** lang = **Zieldauer ≥ 25 min**. Die Standardmission liegt bei 15 min ±25 %, also höchstens ~19. 25 ist
klar etwas anderes. Der Prüfer nimmt den **größeren** Wert aus `zielspieldauer_min` und der Summe der geplanten
Szenendauern (+ Sprünge), damit eine als 15 min deklarierte 27-min-Planung nicht durchrutscht.

**Problem:** Heute gibt es keine langen Missionen (Befund 2). Vorschlag: **Je Angebotsrunde darf eine Mission lang sein
(25–35 min)**. Lange Missionen haben 1 Bodenszene, empfohlen 2 am selben Landepunkt (hinein/Ziel, dann Rückzug).

**Was der Spielleiter im Kontext sieht:**
```
Bodenbilanz (gespielt): vorletzte „Grauzahns Preis“: kein Boden · letzte „Nebelphantom“: kein Boden
→ PFLICHT: Diese Mission braucht eine Bodenszene (Quote), oder ohne_boden_grund.
Landepunkte in Reichweite: Splittergürtel/Außenposten Rostmeute (seed 41, zuletzt vor 5 Missionen) · Kesh/Ruine (neu) …
```
- Gezählt werden **gespielte** Missionen (Ablage `recordPlay`), nicht Angebote. Hatte die letzte gespielte Mission keinen
  Boden, muss **jedes** Angebot der Runde einen haben, denn die Crew wählt ja.
- „Wo es passt“ wird ein Feld `ohne_boden_grund` im Grobplan.

**Was der Prüfer meldet:**
| Code | Stufe | Text |
|---|---|---|
| `boden_quote` | **Fehler** (1 Neuversuch), mit `ohne_boden_grund` nur Warnung | „Letzte gespielte Mission ohne Bodenszene, diese braucht eine.“ |
| `boden_lang` | Fehler | „Mission ist lang (28 min geplant) und hat keine Bodenszene.“ |
| `karte_wiederholt` | Warnung | „Landepunkt X mit seed Y lief in den letzten 3 Missionen. Neuer seed oder Wiederkehr begründen.“ |
| `dauer_abweichung` | Warnung | „Zieldauer 15, Planung 27: gilt als lang.“ |

**Gegenposition zum Briefing:** Kai schreibt „Prüfer warnt“. Eine Warnung allein hat das Problem verursacht, denn
der Befund lautet „nichts zwingt ihn“. Ich empfehle **Fehler mit Ausweg über eine Begründung** (E11).

---

## 6. Schiffskarte erreichen

**Empfehlung: Für B1 reicht „kampfunfähiges Feindschiff betreten“ plus treibende Wracks an Orten. Die volle Enterregel
kommt als eigenes Paket.**

Begründung:
1. **Leitplanke:** „Der Raumkampf bleibt unverändert.“ Gezielte Systemtreffer und ein Schildgenerator am Gegner ändern
   den Raumkampf.
2. **Gleiche Regeln:** Wenn wir bei ausgefallenem Schildgenerator hinüberbeamen, beamen Gegner bei unserem zu uns. Das
   ist die Enterabwehr, die laut §5 **nicht** in diesem Paket ist. Beide Richtungen gehören zusammen.
3. Ionenbatterie und Schiffsmodule (der Weg zum Schildgenerator) stehen ebenfalls in §5.
4. Für die Abnahme reicht der Zugang, denn die Schiffskarte will als **Bühne** geprüft werden, nicht als Kampfmechanik.

**Minimalregel B1:** Der Spielleiter markiert in der Besetzung **einen** Gegner als „wird geentert“. Bei Hülle 0
explodiert er nicht, sondern **treibt** (kleine Ausnahme im Kampfende, keine neue Regel). Danach wird der Transfer zu
ihm frei. Zusätzlich gibt es treibende Schiffe als Landepunkte (§1.3). Die volle Enterregel wird das Folgepaket
**„Entern & Enterabwehr“**.

---

## 7. Tutorial-Orte: neue Besuchsgründe
Verboten bleiben ohne Tutorial „Tafel“, „Ivo“, „Datenkern“, „stumme Boje“ und „Nachhut“. Zurücksetzen ist normal.

| Ort | neue Gründe | Moleküle |
|---|---|---|
| **Plattform B-7** | Das Konkordat hat eine **Messstation angedockt** und will sie gewartet (oder ausspioniert) haben. · Die Rostmeute nutzt die Plattform als **Übergabepunkt** für Schmuggelware. · Die Sonde wurde von Fremden **umprogrammiert**, die Drohnen sind wieder scharf. · Ein Konkordat-Techniker sitzt nach einem Unfall fest. | sonden_code (neuer Code), daten stehlen, schmuggeln (später), personen bergen, stellung nehmen |
| **Wrack „Zaunkönig“** | **Plünderer haben sich eingenistet** (Kai). · Das Konkordat will das Wrack versiegeln, wer vorher birgt, bekommt die Ladung. · Die Rostmeute baut es zur **Falle** aus (Notsignal als Köder). · Ein zweites Wrack ist danebengetrieben (Schiffskarte, §1.3). | stellung nehmen, ausschlachten unter Feuer, entkommen, personen bergen |
| **Mond Kesh** | Das Konkordat hat ein **Grabungslager** (Außenposten) aufgeschlagen, das die Rostmeute überfällt. · Ein Beben hat eine **zweite Grabung** freigelegt (Ruinenkarte, neuer Landepunkt), und die Wächter sind wieder wach. · **Grabräuber** im Wettlauf mit der Crew. · Mondgestein ist für Sela/Vaelen eine wertvolle **Probe**. | geiseln befreien (Archäologen), rätsel lösen, probe nehmen, entkommen, durchbrechen |

---

## 8. B3 aus Spielersicht

**So fühlt es sich an:** Die Sternkarte zeigt zum ersten Mal **die ganze Welt**: Rom im Norden, die Germanen dahinter,
der Saumraum als kleine Ecke unten. Das ist ein starker Anreiz („da wollen wir hin“). Gesperrte Hexe brauchen deshalb
eine **lesbare Begründung** („Grenzposten Statio Limitis: Durchflug gesperrt“), sonst wirken sie wie ein Bug. Die
Navigation wird räumlich: Man sieht Kanten, Engpässe, Leerraum und plant Routen statt Ziele anzuklicken.

**Was sich im Saumraum am Ablauf ändert:**
- Man fliegt in der Raumszene **zum Sprungpunkt an der Kante**, statt aus der Szene heraus zu springen. Pro Sprung
  kommen Flugzeit (S: 15–40 s, je nach Lage der Boje) und eine Entscheidung dazu („welche Seite?“). Das macht
  Sprungpunkt-Patrouillen und Hinterhalte für den Spielleiter möglich, kostet aber Zeit im 15-min-Budget. **Die
  Sprungdauern in den Szenendauern des Grobplans müssen neu gemessen werden** (BOTS).
- Neue Spielhandlung: **Bojen finden** per Weitscan. Für die Taktik-Station ist das ein echter Gewinn.
- Notfallsprung: Man landet in einem anderen Hex, nicht mehr in einem „Nachbarort“. Ob das spürbar anders ist, hängt
  davon ab, wie oft er vorkommt (heute selten).

**Risiken für das Tutorial („spielt sich wie heute“):**
| Risiko | Einschätzung | Vorschlag |
|---|---|---|
| Anflug zum Sprungpunkt verlängert m1–m3 und widerspricht Tutorialtexten („Sprung bereit“) | **mittel**, betrifft jeden Sprung | Im Saumraum liegen die Bojen nahe am Szeneneintritt. ODA-Hinweis „Sprungpunkt anfliegen“ beim ersten Mal. Tutorialtexte prüfen. |
| Kante Wrack–Nebel entfällt (Limes: Wrack an B-7) | **gering**: m2 läuft Hafen → Vaelen → Nebel → Relais, das Wrack ist nur der Abstecher Zaunkönig | Abstecher kostet einen Sprung mehr. Falls das stört: **temporärer Sprungpunkt** Nebel → Wrack während m2 (das ist eine bestehende Regel, kein Sonderfall). |
| Notfallsprung vom Saumraum-Rand in ein gesperrtes Hex ohne Raumszene | **hoch**, sonst landet man im Nichts | Der Notfallsprung wählt nur **spielbare** Nachbarhexe. Gibt es keins, landet man im selben Hex an anderer Stelle. |
| Gesperrte Kesh-Kante und Nebel → Relais bis zum Tutorial-Fortschritt | gering, Limes behält sie | Bojenzustand „gesperrt“ sichtbar machen |

---

## 9. Offene Entscheidungen für Kai
(Nicht erneut gefragt: Kartenarten/Größen, Quote, Waffenwahl, Sichtbarkeit Limes, sechs Waffen, Wunden-Grundsatz.)

| # | Frage | Empfehlung |
|---|---|---|
| E1 | Blockt der **Frontschild des Wächters auch Nahkampf von vorn**? | **Ja.** Sonst ist Nahkampf der Wächter-Knacker und die Lanze überflüssig. Nahkampf wirkt von Flanke und Rücken. |
| E2 | Liegen **verwundete Gegner** wie Spieler (Kameraden können sie aufrichten), statt zu verschwinden? | **Ja** (gleiche Regeln). Wer nicht aufgerichtet wird, ist nach dem Ausbluten aus dem Gefecht. Gefechte werden etwas länger (S), dafür gibt es Momente wie „Holt ihn da raus!“ |
| E3 | **Bewusstlos und Fesseln** für beide Seiten (Spieler können Gegner fesseln)? | **Ja.** Damit hat der Betäuber eine eigene Fähigkeit, und später funktionieren Gefangene und Befragen. |
| E4 | **Ausbruch auf derselben Karte** (Stufe 2) schon in B2 statt Notrückholung, wenn das Team gefangen ist? | **Ja**, mit Rückfall auf die Notrückholung ohne `zelle`. Verschleppung kommt später. |
| E5 | **Granate:** Wirkt sie auf Verbündete gleich (Schaden + Betäubung) oder nur betäubend? | **Gleich** (eine Regel), dazu ein sichtbarer Zielkreis für alle und Mindestabstand. |
| E6 | **Getroffen werden unterbricht das Ausholen** (Nahkampf) und das Laden (Lanze), für alle? | **Ja.** Das ist die wichtigste Gegenmaßnahme gegen Nahkampf-Dominanz und eine Fähigkeit, keine Zahl. |
| E7 | **Wächter neu:** 4 Segmente + 2 Wunden statt 6 + 2–3? | **Ja**, das hält die Zähigkeit nahe am heutigen Stand. |
| E8 | Sicht über 10 Kacheln nur am `aussicht`-Anker oder über **geteilte Sicht** (Captain bzw. Trupp-Funk)? | **Ja.** Damit trifft die Lanze nie „aus dem Off“, und der Captain wird wertvoller. |
| E9 | **Schleich-Grundstufe** in B2 (Alarmzustand je Trupp, Lärmradius, Patrouillenwege, Sicht 10; ohne Sichtkegel und Alarmstufen)? | **Ja.** Kleiner Aufwand (`alert` gibt es), schaltet *unbemerkt hineinkommen*, Infiltration und Beobachten frei. Ohne sie bleibt „leise“ eine Zahl ohne Folge. |
| E10 | **Ladung und Download light** (Ladung als Plotgegenstand der Mission, E halten + Countdown; Download am Terminal) in B1, **ohne** Werkzeuge? | **Ja.** Schaltet *sabotieren*, *daten stehlen* und *vernichten* (Boden) frei. Werkzeuge kommen später und machen daraus Varianten. |
| E11 | Quote: Meldet der Prüfer einen **Fehler mit Begründungsausweg** statt nur einer Warnung? | **Ja**, siehe §5. Eine Warnung allein hat den Befund verursacht. |
| E12 | Sollen **lange Missionen** (25–35 min) angeboten werden, eine je Angebotsrunde? | **Ja.** Sonst ist die Regel „jede lange Mission“ wirkungslos. Schwelle 25 min. |
| E13 | **Schiffskarte** in B1 nur über „kampfunfähig/treibend“, volle Enterregel als eigenes Paket zusammen mit der Enterabwehr? | **Ja**, siehe §6. |
| E14 | **Paletten-Reihenfolge:** Konkordat, Rostmeute und Vorläufer zuerst, Rom und Germanen nachrangig? | **Ja**, weil nur der Saumraum spielbar ist. |
| E15 | **Konkordat-Sicherheit als Gegner** (mit Häscher), Grenadier auch bei der Rostmeute, damit alle 7 Typen im Saumraum vorkommen? | **Ja**, sonst lässt sich die B2-Abnahme im echten Spiel nicht zeigen. |
| E16 | **Schablonen 3/3/3/2 + Spiegeln + Deckungsstempel** statt Minimum 2/2? | **Ja**, siehe §1. Außenposten und Station zuerst. |
| E17 | **Einführungsregel:** höchstens 1 neue Gegnerrolle je Gefecht, solange die Crew sie nicht kennt (Weltstand)? | **Ja**, das schützt die Abnahme „Rolle ohne Erklärung erkennbar“. |
| E18 | **Notfallsprung** nur in spielbare Hexe? | **Ja**, sonst kann man im gesperrten Gebiet stranden. |
| E19 | Abstecher zum Wrack in m2: einen Sprung mehr hinnehmen oder temporärer Sprungpunkt Nebel → Wrack? | **Hinnehmen**, und nur wenn der Tutorial-Test es als störend zeigt, den temporären Sprungpunkt nutzen. |

---

## 10. Nachrunde nach Kais Feedback (2026-10-08)

**Verbindlich (Kai):** Rom und Germanen bekommen eigene Bauweisen und Bodentruppen-Modelle. Die neuen Gegner werden
zuerst Germanen. Die neuen Orte richten sich nach den Fraktionen (Station = Germanen, Ruine = Rom). Systeme, die die
Arbeit auf Dauer erleichtern, haben Vorrang. S2b ist abgenommen.

Lore-Grundlage:
- [[Feldzug Eisenwald]]: Krähenwacht = Außenposten, Methalle = Versorgungsstation, Konvois von Erzklamm, Eisenwald mit Thinghof/Langhaus.
- [[Die vier Völker]]: Germanen mit Langschiff-Rümpfen, Runen als Schaltkreisen, roher Industrie, Clans und Thing, „Entern, Nahkampf, Robustheit“. Rom mit Säulen, Bögen und Aquädukten als Energieleitungen, „Formation, Schilde, Ingenieurwesen“.
- [[Konkordat der Häfen]]: „Rom duldet es als Puffer am Rand“.

### 10.1 Kartenart → Bauweise
| Kartenart | Bauweise | Lore-Anker | Nutzen im Feldzug |
|---|---|---|---|
| **Raumstation** | **Germanen** (gesetzt) | Methalle (Versorgungsstation, Sprengziel), Hornfels (Relaisstation) | **Phase 2 Methalle** spielt direkt auf dieser Kartenart: sabotieren + Flucht |
| **Ruine** | **Rom** (gesetzt) | verfallenes **römisches Kastell** (siehe unten) | Rostnest, Geschichte des Saumraums; später Rückeroberung |
| **Außenposten** | **Germanen** (Vorschlag) | Krähenwacht („Außenposten“, erstes Ziel der Überfälle), Landepunkte auf **Eisenwald** (Thinghof, Langhaus, Flagge) | Überfälle in Phase 1 und **Finale in Phase 4** auf derselben Kartenart. Mehr Wiederverwendung geht nicht. |
| **Schiff** | **Germanen** (Vorschlag), Langschiff-Rumpf mit Klinkerplanken | Konvois von Erzklamm, Sperrflotte | Phase 1 „Überfälle/Kapern“ auf Konvoischiffe |

**Warum nicht Außenposten = Rom (das Kit `rom-aussenposten` ist begonnen)?** Rom ist im Feldzug Verbündeter. Auf einer
intakten römischen Basis kämpft man nicht. Das begonnene Rom-Kit wandert stattdessen **in die Ruine**: Ruine Rom =
Rom-Bauweise im Zustand *verfallen*. Damit ist die begonnene Arbeit nicht verloren, und die Ruine wird billiger.

**Ehrliches Risiko:** Drei von vier Kartenarten sind germanisch. Im Saumraum droht Gleichförmigkeit („alles
Langhäuser“). Dagegen helfen der Besitz-Überzug (die Rostmeute nistet sich in germanischen Bauten ein) und der Zustand
(§10.5). Eine zweite Bauweise je Kartenart (Station Rom, Außenposten Rom) kostet mit dem System aus §10.5 nur ein Kit
und keine neuen Module. Das wäre die erste Erweiterung nach dem Feldzug.

**Was heißt „Ruine Römer“?** Eine **verfallene römische Anlage statt einer Vorläuferruine**: ein aufgegebenes
Grenzkastell aus der Zeit, als Rom den Saumraum noch hielt. Rom zog sich hinter Statio Limitis zurück, und im
Vakuum wuchs das Konkordat. Das passt zu „Rom duldet es als Puffer am Rand“. Das ist **neue Lore und braucht Kais Ja (N1).**

| Platztyp der Ruine (bisher Vorläufer) | Ruine Rom | Anker |
|---|---|---|
| Vorhof | Porta + Lagerstraße (Via Praetoria) | `eingang`, Gefecht |
| Säulengang | Kolonnade der Principia | `deckung`, `aussicht` (Wachturm) |
| Galerie (Rätsel) | **Aquädukt-Verteiler** (Energieleitungen zu zweit umlegen) oder Offiziersstube | Rätselpaar |
| Innerstes | **Fahnenheiligtum** (Sacellum) mit **Kassengewölbe** darunter (historisch lag die Legionskasse unter dem Fahnenheiligtum) | `tor`, `fund` |
| Wächterkammer | Wachlokal mit **Kastell-Automat** (Wächter-Rolle, das Scutum dient als Frontschild) | Wächter-Anker |
| Einsturzgang | eingestürzter Abwasserkanal (Cloaca) | Rückzug |

**Wohin wandern die Kesh-Umsetzungen?** In die Ruine Rom. Die Anker bleiben gleich, nur Text und Skin ändern sich:
- `zwei_schluessel`: Kassentresor mit **Zwei-Offiziers-Schloss**. Römische Disziplin: Die Kasse öffnet nie einer allein. Der Funktipp kommt als Parameter.
- `fund_aus_gewoelbe`: Legionskasse, Adlerstandarte oder Archivtafeln aus dem Kassengewölbe.
- `trupp_raeumen` und `zu_den_pads`: unverändert.

Die **Vorläufer-Ruine** bleibt die handgebaute Karte Kesh und kommt später als **zweite Bauweise** der Ruine
(Apkallu-Kit) zurück. Die Abnahme „Kesh-Umsetzungen laufen in der Ruine“ bleibt erfüllt.

### 10.2 Die fünf neuen Rollen als Germanen
| Rolle | Passt sie zur germanischen Kampfweise? | Begründung / Name im Spiel |
|---|---|---|
| **Enterer / Berserker** | **ja, Kern** | Berserker / Úlfheðnar. „Entern, Nahkampf“ ist die Spielnähe des Volks. |
| **Schütze** | **ja** | Jäger und Späher (Heimdall: Wacht). Die Lanze wird zum **Jagdspeer-Gewehr**, der Schütze nutzt Hügel und Türme. |
| **Grenadier** | **ja** | **Donnerwerfer** (Thor: Krieg und Energie), rohe Industrie. Historisches Echo: Die Wurfaxt flog vor dem Angriff, um die Reihe zu brechen. |
| **Niederhalter** | **mit Begründung** | Die Germanen sind kein Formationsvolk, also kein „Legionär“, sondern der **Bolzer**: eine Bergbau-Nietschleuder aus Erzklamm, roh und laut. Seine Rolle im Clan: Er drückt die Köpfe runter, damit die Berserker heranstürmen. Keil = Niederhalter + Enterer. Das trägt die Nahkampfweise und passt dadurch sogar besser als bei Rom. |
| **Häscher** | **mit Begründung** | **Wergeld-Fänger.** Germanisches Recht kennt Buße und Pfand: Gefangene kommen vor das **Thing** oder werden gegen Wergeld ausgelöst. Werkzeug: Fangnetz-Schocker (Bola). Der Story-Haken kommt gleich mit: „Die Crew sitzt in der Methalle und wartet auf das Thing“ führt zum Ausbruch. |
| Plünderer (gibt es) | bleibt | Grundtyp der Rostmeute, Modell `lerche/scavenger`. Ein germanischer Grundtyp „Karl“ (Blaster) kommt als 6. Modell dazu, damit germanische Trupps einheitlich aussehen. |

**Rollen für Rom später** (sobald Rom Gegner wird, z. B. im freien Spiel durch Abtrünnige):
- Niederhalter als **Legionär** (Sturmgewehr, Formation)
- Grenadier als **Ballistarius**
- Schütze als **Sagittarius**
- Wächter als **Scutarius** (Mensch mit Frontschild, Testudo)

Häscher und Enterer passen nicht zu Rom. **Schon in B1/B2 braucht Rom genau ein Modell:** den Kastell-Automaten
(Wächter-Rolle) für die Ruine.

### 10.3 Der Konflikt mit „nur der Saumraum ist spielbar“
Die Germanen liegen fünf Hexe entfernt, hinter Rom und der Grenzmark. Ich schlage drei lore-gerechte Wege in den Saumraum
vor. Die Entscheidung zur Spielbarkeit bleibt dabei unangetastet:

1. **Friedlose bei der Rostmeute.** Germanisches Recht kennt die **Ächtung**: Wen das Thing ächtet, der verliert Clan
   und Schutz. Ein geächteter Clan dient jetzt Grauzahn als Muskeln, die Germanen-Modelle tragen Rostmeute-Palette.
   *Lore-Wirkung:* Die Rostmeute bleibt der Gegner im Saumraum, kämpft aber mit germanischen Rollen. **Das ist der
   Hauptweg.**
2. **Germanisches Kontor im Saumraum.** Das Konkordat handelt mit allen. Ein Handelsclan unterhält eine **Kontorstation**
   (wie Haithabu oder die Hanse). Sie ist neutral bis feindlich, je nach Auftrag (Daten stehlen für Tesk, Ausbruch nach
   einem Diebstahl). So kommt die Germanen-Station ohne Krieg in den Saumraum.
3. **Raubzug durch den Leerraum.** Ein Langschiff kommt über einen **temporären Sprungpunkt** (bestehende Regel) in den
   Saumraum, wie die Wikinger weit weg von der Heimat. Nach dem Raumgefecht treibt es und kann geentert werden (§6).
   So kommen Germanen-Schiff und Gefecht ohne Feldzug ins Spiel.

**Landepunkte (ersetzt §1.3):**
| Ort (Hex) | Landepunkte (Kartenart · Bauweise · Besitz · Zustand) |
|---|---|
| Hafen Lichtkordon (0206) | Raumstation · Germanen · **Kontor** · intakt |
| Splittergürtel (0306) | Außenposten · Germanen · Rostmeute (Friedlose) · umkämpft (Schürflager auf einem Brocken) · Schiff · Germanen · Raubzug · treibend |
| Boje B-7 (0406) | Plattform (Tutorial) · Raumstation · Germanen · Rostmeute · verfallen (aufgegebene Kontor-Außenstelle) |
| Vaelen-Karawane (0207) | Schiff · Germanen · Kontor · intakt (Handelslangschiff im Konvoi der Karawane) |
| Wrack „Zaunkönig“ (0405) | Wrack (Tutorial) · Schiff · Germanen · verfallen (zweites Wrack) |
| Graue Weite (0307) | Schiff · Germanen · Raubzug · umkämpft |
| Kustoden-Relais (0308) | handgebaut, Vorläufer (unverändert) |
| Mond Kesh (0205) | Kesh (Tutorial) · **Ruine · Rom · herrenlos · verfallen (Kastell, das einst die Vorläuferstätte bewachte)** · Außenposten · Germanen · Rostmeute (Grabräuberlager) |
| Rostnest (0107) | **Ruine · Rom · Rostmeute · verfallen (Grauzahns Nest im alten Kastell)** · Außenposten · Germanen · Rostmeute |

Damit sind alle vier Kartenarten mit ihrer Bauweise im Saumraum erreichbar, und Rostnest und Kesh tragen die
römischen Ruinen. Der **Prüfstein lässt sich so im echten Spiel zeigen**.

**Abnahme per Direktstart?** Zusätzlich ja: das Testgelände (`arena_away` gibt es) mit Kartenart, Bauweise, Besitz
und `seed` als Parametern. Für „3 seeds je Kartenart“ ist das ohnehin der schnellste Weg. **Der Prüfstein mit sechs
Missionen bleibt aber im Saumraum**, denn nur dort wird der Spielleiter getestet.

**Rostmeute und Konkordat:**
- **Rostmeute:** bleibt Hauptgegner im Saumraum, mit Trupps aus Plünderern und Friedlosen:
  - *Rotte:* 2 Plünderer + 1 Bolzer
  - *Enterrotte:* 1 Bolzer + 2 Berserker
  - *Lösegeldrotte:* 1 Wergeld-Fänger + 1 Bolzer + 1 Plünderer
  - *Söldner:* 1 Donnerwerfer + 2 Plünderer
- **Konkordat:** **ist kein Gegner mehr, E15 entfällt.** Es bleibt Auftraggeber und Polizei im Hintergrund (Bluff, Formulare). Einen Häscher braucht es dort nicht mehr.
- **Kontor-Clan:** echte Germanen-Palette.
  - *Kontorwache:* 2 Karl + 1 Wergeld-Fänger
  - *Schiffswache:* 2 Berserker + 1 Jäger
- **Kustoden und Kastell-Automat:** stellen die Wächter.

Damit kommen alle 7 Rollen im Saumraum vor.

### 10.4 Was sich an E1–E19 ändert
| # | vorher | jetzt |
|---|---|---|
| E7 | Wächter 4 + 2 | bleibt. Neu kommt der **Kastell-Automat** als römische Wächter-Variante dazu (Frontschild = Scutum). |
| E14 | Paletten: Konkordat, Rostmeute, Vorläufer zuerst | **Bauweisen zuerst: Germanen (3 Kits) und Rom verfallen (Ruine).** Besitz als Überzug: Rostmeute, Kontor, herrenlos. Konkordat-Bauweise und Vorläufer-Kit kommen später. |
| E15 | Konkordat-Sicherheit als Gegner | **entfällt.** An ihre Stelle treten Friedlose (Rostmeute) und der Kontor-Clan, siehe §10.3. |
| E16 | Schablonen 3/3/3/2 | bleibt, aber die Schablonen sind **fraktionsneutral** (§10.5). Je Bauweise kommen nur Signaturmodule dazu. |
| E4 | Ausbruch auf derselben Karte | bleibt, mit germanischer Begründung (Gefangene für das Thing / Wergeld). |
| E1–E3, E5, E6, E8–E13, E17–E19 | | unverändert |
| **N1 (neu)** | | **Rom hielt früher den Saumraum**, verfallene Kastelle sind die Lore der Ruine Rom. → Empfehlung **ja** |
| **N2 (neu)** | | **Friedlose (ein geächteter Germanenclan) dienen der Rostmeute.** → **ja**, das ist der Hauptweg für Germanen im Saumraum |
| **N3 (neu)** | | **Germanisches Kontor** in Lichtkordon als neutral-feindlicher Landepunkt. → **ja** |
| **N4 (neu)** | | **Außenposten und Schiff = Germanen**, das Rom-Kit wandert in die Ruine. → **ja** |
| **N5 (neu)** | | Direktstart auf dem Testgelände mit Kartenart/Bauweise/Besitz/`seed` für die Karten-QA, der Prüfstein bleibt im Saumraum. → **ja** |

### 10.5 Systeme, die Karten- und Missionsbau auf Dauer erleichtern
Kernidee: **vier unabhängige Achsen.** Jede neue Arbeit fällt nur auf einer Achse an und vervielfacht sich über die
anderen.

| Achse | Was | Wer baut | Wirkt auf |
|---|---|---|---|
| **Kartenart** | Schablonen, Platztypen, Anker, Bereiche | Game Design (Daten) | Dramaturgie, Spielleiter |
| **Bauweise** | Kit, das **semantische Kacheln** (wand, tür, deckung_halb, terminal …) in Voxel übersetzt, dazu wenige **Signaturmodule** | Art | Aussehen |
| **Besitz** | Palette, Banner, Props, **Besetzung (Trupp-Rezepte)**, Funkstil | Art + Game Design | wer dort ist |
| **Zustand** | Überzug aus Trümmern, Löchern, Feuer und verschlossenen Kanten (aus `seed` + Weltstand) | Code + wenige Props | Deckung, Wege, zweiter Besuch |

1. **Module sind fraktionsneutrale Grundrisse.** Ein Modul beschreibt Wände, Türen, Deckung und Anker semantisch, nicht
   als Voxel. Jede Bauweise malt es an. *Wirkung:* Station Rom, Außenposten Rom und eine Vorläufer-Station kosten
   später **ein Kit und null Module**. Die Zahl der Module (~90–100) wächst nicht mit der Zahl der Fraktionen.
2. **Signaturmodule je Bauweise** (1–2 je Kartenart): Langhaus und Thinghof, Met-Kessel der Methalle,
   Fahnenheiligtum. Sie belegen einen **fraktionsneutralen Platztyp** (z. B. „Herzstück 2×2“). Die Schablone bleibt
   gleich, und die Karte sieht trotzdem unverwechselbar germanisch oder römisch aus.
3. **Eine Prüfung für alle Bauweisen.** Alle Kits haben dieselbe Semantik, also prüft `check-maps` jede Kombination
   aus Schablone und `seed` **einmal**, und das Ergebnis gilt für jede Bauweise. In CI laufen z. B. 50 `seed`s je
   Schablone, sodass Fehlbauten auffallen, bevor ein Spieler sie sieht.
4. **Besetzung aus Fraktionsregeln.** Die Szene nennt nur *Fraktion + Stärke (klein/mittel/groß) + Haltung (ruhig/wach)*.
   Die Fraktion liefert **Trupp-Rezepte** (Rollenmix), Funksätze und das Modell-Set, die Engine setzt die Trupps an
   `wache`-Anker. Der Spielleiter muss keine Rollen kennen, und eine neue Fraktion ist nur eine Datei (moddbar wie der
   Katalog).
5. **Gegner-Modelle aus Rolle × Fraktion.** Die Rolle bestimmt Grundkörper und Waffensilhouette, damit sie lesbar
   bleibt. Die Fraktion bestimmt Rüstung, Helm und Palette ([[Voxelwerk]]: Teile + Palette). So gibt es 6 Rollen ×
   N Fraktionen ohne N-fache Handarbeit. Rom später ist ein Satz Teile, keine neuen Rollen.
6. **Bauweise-Lexikon für Texte.** Jede Bauweise hat Namen für Fund, Tor, Schlüssel und Herzstück (Rom:
   „Legionskasse“, „Zwei-Offiziers-Schloss“; Germanen: „Runenstein“, „Met-Kessel“; Vorläufer: „Tafel“). Umsetzungen
   holen `{{fund_name}}` usw. aus dem Lexikon. *Wirkung:* Eine Umsetzung läuft auf jeder Bauweise ohne Textpflege, und
   der Spielleiter klingt trotzdem lore-gerecht.
7. **Rätsel als neutrale Mechanik mit Bauweise-Skin.** Rätselpaar = zwei Halteobjekte: bei den Vorläufern
   Archivschlüssel, bei Rom Offiziersschlösser, bei den Germanen ein Runenpaar. Ein Code, drei Bühnen.
8. **Zustand aus dem Weltstand.** „Durchgang West verschlossen“ ist die Kante *Tür → Wand* als Überzug, „Basis in
   Alarm“ ist die Haltung *wach* in der Besetzung. Kein Sondercode je Karte.
9. **Module und Schablonen als Daten** (ASCII + Kopf mit Kanten, Ankern, Belegungen), registriert wie Moleküle und
   moddbar. Dazu eine **Vorschau** (`seed` → Bild/ASCII) für Art und Design, damit man eine Schablone bauen kann,
   ohne das Spiel zu starten.
10. **G1-Schnittstelle (passt dazu):** G1 liefert später nur **neue Grundrisse in derselben Semantik**. Bauweise,
    Besitz, Zustand, Besetzung und Lexikon bleiben unverändert.

**Kosten und Nutzen (S):** Die semantische Kachelschicht und das Kit-Mapping kosten einmalig etwa einen Studio-Tag mehr
in B1 (bitte durch den Tech Lead prüfen). Danach kostet jede weitere Bauweise nur ein Kit, statt ~25 neue Module je
Kartenart. Für den Feldzug mit Rom- und Germanen-Varianten lohnt sich das schon ab der zweiten Bauweise.
