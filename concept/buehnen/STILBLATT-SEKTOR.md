# Stilblatt Sektorkarte und Bodenkampf-HUD (Team UI-ART, B3/B2)

Für KARTE (`public/js/starmap.js`) und CLIENT (HUD). Grundlage: `CONTRACT-B3.md` §8, `CONTRACT-B2.md` §10,
`concept/buehnen/hex.svg`, `artdirector.md` §5. Alle Werte stehen zusätzlich als Daten in `public/js/icons-b.js`
(`IconsB.FRAKTION`, `IconsB.HEXSTATUS`, `IconsB.KANTE`, `IconsB.BOJE`). **Bei Abweichung gelten die Daten in `icons-b.js`.**
Vorschau: `public/icons-b-preview.html` (läuft auch als `file://`), Screenshots `shots/ui-art/`.

**Grundregel: Farbe sagt nie allein etwas.** Jeder Zustand hat ein zweites Merkmal, nämlich Form, Strich oder Muster.

## 1. Palette
| Rolle | Hex | Verwendung |
|---|---|---|
| Dunkel | `#0B0E1A` | Hintergrund, Leerraum, Perlen-Innenfläche |
| Tief | `#141A2A` | unerkundete Hexe |
| Stahl | `#2E3A4A` | Leerraum-Rand, Leerraum-Koordinate |
| Hell | `#F4EEDC` | Namen, Koordinaten (75 %), Hex-Rand (35 %) |
| Gedämpft | `#9AA6B8` | unerkundet, ohne Strom, Nebentext |
| Gold | `#FFC66B` | offene Kante / aktive Boje, **Ziel und Wert** |
| Glut | `#FF8A4C` | gesperrt, Gefahr, Hitze. Nie neben Gold für eine zweite Bedeutung |
| Eisblau | `#A9D6E5` | temporäre Kante/Boje |
| Fern | `#7FD6C8` | Fernsprung-Bogen |

Kontraste nach WCAG 2.x: Hell auf allen Fraktionsflächen ≥ 7,3:1, Gold ≥ 5,4:1, Glut ≥ 3,6:1 (nur Linien und Perlen,
also Grafik mit 3:1 als Grenze).

## 2. Hexe
### 2.1 Fraktionsflächen (`IconsB.FRAKTION`, Schlüssel wie `limes.json` `fraktion`)
Das Muster ist das zweite Merkmal für Farbsehschwäche. Es besteht aus hellen 1-px-Elementen mit 16 % Deckkraft, die sich
alle 8 px wiederholen (`IconsB.muster(ctx, fraktion)`). Bei `opts.kompakt` (HUD-Ausschnitt) darf KARTE das Muster weglassen.

| Schlüssel | Fraktion | Fläche | Muster |
|---|---|---|---|
| `saum` | Konkordat (Saumraum) | `#4A4466` | keins (die Heimat ist die ruhige Fläche) |
| `rom` | Rom | `#6B2E2E` | waagrechte Linien |
| `ger` | Germanen (auch `kontor`) | `#3F4A28` | senkrechte Linien |
| `pirat` | Piraten / Rostmeute | `#5C3A1E` | Punkte |
| `frei` | herrenlos (Grenzmark) | `#33404F` | kleine Kreuze |
| `neutral` | neutral (Freihafen) | `#5A4A22` | kleine Ringe |
| `vorl` | Vorläufer | `#1F5555` | kleine Rauten |
| `offen` | Platzhalter | `#202734` | keins, Name „?“ |

Die Deck-Werte stammen aus `artdirector.md` §5. Germanen, herrenlos, neutral und Platzhalter sind aus `karte_limes.py`
auf dieselbe Helligkeit gezogen.

### 2.2 Hex-Status (`IconsB.HEXSTATUS`), Vorrang von oben nach unten
| Status | Wann | Fläche | Rand | Text |
|---|---|---|---|---|
| `verborgen` | `verborgen: true` (Rostnest) | Tief `#141A2A` | Gedämpft, 2 px, Strich 6/6 | Koordinate gedämpft, großes „?“ statt Name |
| `leerraum` | Feld ohne Eintrag | Dunkel `#0B0E1A` | Stahl, 1,5 px | nur die Koordinate in Stahl, kein Name |
| `gesperrt` | System mit `spielbar: false` | Fraktionsfläche + Muster, darüber Dunkel 45 %, dann **Schraffur** (dunkle Diagonale „/“, 2 px breit, Abstand 8 px) | Hell 20 % | Koordinate Hell 55 %, Name Hell 75 %. Beim Überfahren den `sperrtext` der Region zeigen |
| `unerkundet` | spielbar, nicht in `erkundet` | Tief `#141A2A`, **keine** Fraktionsfarbe | Gedämpft, 2 px, Strich 6/6 | Koordinate und Name gedämpft. Hex-Symbole mit 60 % Deckkraft, Einfluss ausblenden |
| `erkundet` | spielbar, besucht | Fraktionsfläche + Muster | Hell 35 %, 1,5 px | Koordinate Hell 75 %, Name Hell fett |

- Die Strichbreiten gelten für Hexradius 60. KARTE gibt `opts.s = radius / 60` mit.
- `IconsB.hexFlaeche(ctx, pfad, fraktion, status, { s, ohneMuster })` zeichnet Fläche, Muster, Abdunklung, Schraffur und Rand.
  Text und Icons zeichnet KARTE.
- **Inhalt im Hex:** Koordinate oben, Hex-Symbol(e) in der Mitte (12×12, Zoom 1 oder 2), dominanter Einfluss rechts neben
  dem ersten Symbol, Name unten. Die Hafenklasse (A–E) steht als Buchstabe in Hell rechts oben neben dem `hafen`-Symbol.
- Unterscheidbar ohne Farbe: `gesperrt` hat Schraffur, `unerkundet` den Strichrand, `leerraum` keinen Namen und keine
  Fläche.

### 2.3 Markierungen (Empfehlung an KARTE)
- **Eigene Position:** Hell-Ring 2 px innen am Hexrand und ein kleines Lerche-Dreieck (Hell) in der Mitte oben.
- **Gewähltes Ziel:** Gold-Doppelring (2 px + 1 px, 4 px Abstand), pulsierend. Gold heißt Ziel.
- **Route über bekannte Kanten:** Hell 2 px, Strich 4/4 von Mitte zu Mitte, über den Kanten liegend.

## 3. Kanten und Bojen-Perlen (`IconsB.KANTE`, `IconsB.kante`, `IconsB.perle`)
Die Kante wird **auf der gemeinsamen Hexkante** gezeichnet (wie `hex.svg`), mit der Perle in der Mitte. Breiten gelten für
Hexradius 60.

| Art (`limes.json`) | Boje (`space.jp.z`) | Linie | Perle (Form) |
|---|---|---|---|
| `open` | `aktiv` | Gold, 7 px, durchgezogen | **gefüllter Kreis** Gold, r 8 |
| `locked` | `gesperrt` | Glut, 7 px, Strich 10/7 | **Kreis mit Kreuz**: Dunkel gefüllt, Glut-Ring 3 px, X 2,5 px |
| temporär (`welt.sektoren.temp`) | `temporaer` | Eisblau, 5 px, Strich 3/7 | **Raute** Eisblau mit dunklem Rand |
| (ohne Strom) | `ohne_strom` | Gedämpft, 7 px, durchgezogen | **hohler Ring**: Dunkel gefüllt, gedämpfter Ring 3 px |
| `far` | gesperrt | Bogen Fern `#7FD6C8`, 3 px, Strich 3/7, Pfeilspitze am Ziel | Kreuz-Perle auf dem Bogenscheitel (in B3 alle gesperrt) |
| `hidden` | – | **nicht zeigen** (nur mit `opts.debug`: gedämpft, 3 px, Strich 2/6) | keine |

- Unterscheidbar ohne Farbe: Linie (durchgezogen / lang gestrichelt / gepunktet) und Perle (Punkt / Kreuz / Raute / Ring).
- **Abweichung von `hex.svg`:** Die temporäre Boje hat eine **Raute** statt eines Kreises. Im SVG unterschied sie sich
  von „aktiv“ nur durch Farbe und Strich, an der Perle selbst gar nicht.
- Gezeichnet werden nur bekannte Bojen (Snapshot `world.sektoren.b`, Regel `CONTRACT-B3` §4). Eine unbekannte Kante
  bleibt unsichtbar.

## 4. Boje in der Raumszene (`IconsB.boje(ctx, zustand, x, y, s, winkel, opts)`)
- `x, y`: Bildschirmmitte (`cam.toS`)
- `s`: Maßstab wie Stationen (`cam.zoom`). Das Sprite misst 96 Weltpx und wird **mindestens 26 px** groß gezeichnet, damit
  es bei Zoom 0,35 lesbar bleibt.
- `winkel`: Richtung zum Zielhex (`Sektoren.winkel(richtung)`, Bug rechts = 0)
- `opts`: `{ t, ziel }`. Mit `ziel: true` pulsiert der Pfeil (gewähltes Ziel).

Den Namen des Zielhexes und den Radius-Ring (`sprungpunktRadius`) zeichnet KARTE selbst: Text Hell unter der Boje,
Ring in der Zustandsfarbe, 1 px, Strich 4/6.

| Zustand | Farbe | Ring | Lampe | Richtungsmarke | Sonst |
|---|---|---|---|---|---|
| `aktiv` | Gold | geschlossen | voller Kreis mit Glanzpunkt | gefülltes Dreieck | Glimmen pulsiert langsam |
| `gesperrt` | Glut | lang gestrichelt | **X** | Querbalken (Riegel), kein Pfeil | kein Glimmen |
| `temporaer` | Eisblau | gepunktet, läuft um | **Raute**, blinkt | Dreieck nur als Umriss | Glimmen flackert |
| `ohne_strom` | Gedämpft | keiner | hohler Kreis | keine | Gehäuse um 12° gekippt, Mastlicht aus |

## 5. Icons 12×12 (`IconsB.draw(ctx, gruppe, id, x, y, { scale, color, alpha })`)
Das Format ist das von `ICONS` in `art.js`: eine 10×10-Maske, gezeichnet als 12×12 mit Pixel-Outline. Jedes Icon hat seine
Standardfarbe in `IconsB.FARBE`. `draw` gibt `false` zurück, wenn es das Icon nicht gibt; dann zeichnet KARTE bzw. CLIENT
einen Ersatz.

- **Hex-Symbole** `hex`: `hafen` (Hell, Gold-Kern), `gasriese` (Eisblau, Bänder), `ruine` (Vorläufer-Violett, Raute mit Kern),
  `piraten` (Rostsand, gekreuzte Klingen), `asteroiden` (Gedämpft), `nebel` (Lavendel, Wolke mit Sternen), `boje` (Gold),
  `heimat` (Hell, Haus mit Gold-Tür), `schrein` (Gold, Stern), `festung` (Stahlhell, Zinnen), `wrack` (Bronze, zerbrochener
  Rumpf).
  - **Aliase** für die Symbol-Ids aus `karte_limes.py`: `home`→`heimat`, `pantheon`→`schrein`, `ruin`→`ruine`,
    `pirate`→`piraten`, `fort`→`festung`.
  - **Keine Icons** gibt es für `ally`, `target` und `bomb` (Symbole außerhalb des Saumraums, nicht beauftragt).
- **Einflüsse** `einfluss` (Ids wie `limes.json`): `gas` (Giftgrün, Wolke mit Blasen), `asteroiden` (Gedämpft, Rauten),
  `truemmerstrom` (Bronze, Strömungspfeil), `eruption` (Glut, Sonne mit Protuberanz), `gezeiten` (Blassblau, konzentrische
  Ringe), `nebel` (Lavendel, ≋), `daempfung` (Vorläufer-Violett, ⊘), `minen` (Alarmrot, Stachelkugel).
- **Waffen** `waffe` (Ids wie `CONTRACT-B2` §1.1, Mündung rechts):
  - Hell: `pistole`, `blaster`, `sturmgewehr`, `nahkampf`
  - nach den Telegraf-Farben: `granatwerfer` (Glut, Fläche), `lanze` (Weißgold, Präzision), `betaeuber` (Elektrisch-Blau,
    außer Gefecht)
  - zusätzlich `faust` (Gedämpft), weil `wf` nach der Gefangennahme `faust` ist
- **Zustände** `status` (Snapshot `zs`, `bt`, `ov`): `betaeubt` (Elektrisch-Blau, Funkenkranz), `bewusstlos`
  (Elektrisch-Blau, „Zz“ über Linie), `gefesselt` (Hell, Fesselpaar), `gefangen` (Gedämpft, Gitter), `ueberhitzt` (Glut,
  Thermometer mit Hitzewellen), `verwundet` (Alarmrot, Tropfen).

## 6. Bodenkampf-HUD (B2)
- **Wunden-Pips** `IconsB.wundenPips(ctx, x, y, n, max, size = 10, gap = 3)`: **Rauten** in Alarmrot. Voll = gefüllt mit
  Glanz, leer = dunkel mit rotem Rand. Gleiches Raster wie die Schild-Würfel (`drawShieldPips`), damit beide Reihen
  untereinander stehen können. Unterschied ohne Farbe: Würfel (Schild) gegen Raute (Wunde).
- **Hitzebalken** `IconsB.hitzebalken(ctx, x, y, w, h, hitze, { segmente, ueberhitzt, t })`:
  - Segmente = `waffen.<waffe>.schuss` (2–12), Abstand 1 px, Füllung von links
  - Farbe läuft von Gedämpft über Gold zu Glut, und die **Höhe der Segmente wächst** von 55 % auf 100 %. So wird der
    Verlauf auch ohne Farbe lesbar.
  - Leere Segmente zeigen einen niedrigen Strich (25 %).
  - **Überhitzt** (`ov`): alle Segmente Glut, voll hoch, dunkel schraffiert, Rahmen blinkt Glut/Weißgold, rechts daneben das
    Icon `ueberhitzt`.

## 7. Nicht von UI-ART
Hexraster-Geometrie, Text, Hit-Test, Route, Kursvorschau, Fächer für den Notfallsprung und das Detailpanel macht KARTE.
HUD-Layout macht CLIENT.
