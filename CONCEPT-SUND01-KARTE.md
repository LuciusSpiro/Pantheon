# CONCEPT-SUND01-KARTE – Übersichtskarte Sund nach dem Wissen von Rom (SUND-01, Paket C)

Grundlage: Vault `Auftrag SUND-01 – Die Welt tickt` (4C, Abnahme 6–8), `Projektsteckbrief Pantheon` (Gestaltung), `Brückenpulte`.
Kais Wahl 2026-10-18: **Richtung „Meldetafel“** (Plaketten, Meldeliste) **mit Sichtgrenze und Dunkel aus der „Lichtkarte“** statt des
Punktrasters. Team Design. **Stand:** Spezifikation und Tokens, nichts am Spielcode gebaut.

- Tokens: `public/js/karte-tokens.js` (`window.KarteTokens`, in `public/index.html` nach `kartenzeichen.js` geladen; in Node per `require`).
  Jede Farbe, jedes Maß und jeder Text dieser Datei gilt; die Zahlen hier im Text sind Lesehilfe. Neue Werte nur in der Token-Datei.
- Mockups mit den Tokens und den Datenblöcken aus §12: Scratchpad `sund01-richtungen/c-final/` (nicht im Repo; Screenshots im Bericht).
- Zuständig für den Bau: Entwicklung (Paket C). `starmap.js`, `kartenzeichen.js`, `consoles.js` (`capStar`, `capRadio`), `hud.js` ändert nur sie.

## 1. Befund (geprüft am Code, Branch `sund01` 00fb1d7)
| Punkt | Stand |
|---|---|
| Karte | `content/welt/sund_frei.json`: **30 Hexe** (inkl. Brachland 0505, Saatfeld 0705), Raster 11×7, 40 Kanten (3 `hidden`, 1 `locked`), alle `spielbar` |
| Ausgangsansicht heute | `starmap.js zeichne()`: Ansicht `fokus` = spielbare Hexe **plus ein Ring Nachbarn** (+ Marken mit Ring, + Lerche). Weil alles spielbar ist, deckt der Ring das **ganze Raster 1–11 × 1–7** ab (57 Zellen). Dazu die innere Seitenleiste **130 px** (`seiteW`, weil `fokusSet` gesetzt). Kartenbreite 272 px / 17 Einheiten → **Hexradius 16,0** (knapp über `kompakt` < 14, `dicht`). |
| `gesamt` heute (Taste M) | ganzes Raster, keine Seitenleiste (`seiteW` < 96 → 0) → **Hexradius 20,3**, also größer als die „Fokus“-Ansicht. Die Umschaltung M ist auf dieser Karte verkehrt herum. |
| Platz | Captain-Reiter Sternkarte: Karte `mapRect` 410×272 (`consoles.js capStar`), rechts davon eine eigene Spalte 196 px (`rx = a.x + 420`) mit Ort, Sprungknopf, Sprungstatus. Die innere 130-px-Leiste der Karte doppelt diese Spalte. |
| Zoom/Pan | `kartenansicht.js`: Faktor 1–8 auf die Ausgangsskala, Rad, Ziehen, Taste 0, Knopf „Ansicht“. Bleibt. |
| Koordinate im Hex | in `dicht` (s < 24) schon heute aus; Kai: entfällt ganz, bleibt in der Ortsinfo. |
| Funk | `Hud.onRadio(from, text, pid)` (6 s Einblendung, Messing-Panel `hud.js drawRadio`), Logbuch `mission.log` `{ loc, text }` im Funk-Reiter (Ort Eisblau, Text Hell). Kein eigenes Lagefunk-Feld. |
| Pult-Farben | Eisblau `#A9D6E5` Sensoren, Messing `#C9974A` Navigation/Köpfe, Rot `#E0473C` Gefahr, Mint `#7FE0C2` eigen, Warngelb `#F2C94C`. Fraktionsflächen `icons-b.js FRAKTION`. |
| Muster heute | `icons-b.js musterKachel`: 1 Linie je 8 px, Deckkraft 0,16. Unter Deuteranopie sind Rom (`#6B2E2E`) und Germanen (`#3F4A28`) damit kaum zu trennen (Mockup-Prüfung). |

## 2. Plakette (Flotte auf der Karte)
Eine Plakette steht für **die Flotten einer Fraktion in einem Hex** (gleiche Fraktion im selben Hex wird zusammengefasst, Stärke summiert, Phase = die
dringendste: B > M > S > unterwegs/Rückzug > hält). Pixelgenau, skaliert nicht mit dem Zoom.

```
 ┌───────┬───┬───┬───┬────────┐   Höhe 9 px, Rahmen 1 px, 1 px dunkle Unterlage rundum (#0B0E1A)
 │   G   │ ▮ │ ▮ │ ▮ │   S    │   Buchstabenfeld 7×7 · drei Lampen 3×5 (Abstand 1, 2 px von oben) · Phasenfeld ≥ 8 px
 └───────┴───┴───┴───┴────────┘   Breite 22 ohne Phasenfeld, 30 mit; Altstand mit zweistelligem Alter 34
```
| Teil | Inhalt |
|---|---|
| Buchstabe | Fraktion: **R** Rom, **G** Germanen, **K** Konkordat, **P** Piraten. Feld in Haltungsfarbe (Mint, **Hellrot `#FF6B5E`**, Eisblau, Rost), Buchstabe dunkel (≥ 6:1). Hellrot statt Alarmrot, weil Alarmrot unter Protanopie so dunkel wird, dass das dunkle „G“ verschwindet (Mockup-Prüfung). |
| Lampen | **Stärkeklasse = Zahl brennender Lampen**: 1 klein, 2 mittel, 3 groß (`STAERKE`). Nicht belegte Lampen `#18202F`. Die Klasse rechnet der Server (Schwellen `sund-sim-werte.json staerkeklassen`). |
| Phasenfeld | **S** sammelt (Warngelb), **B** belagert (Hellrot), Marsch/unterwegs = **Pfeil in Kursrichtung** (Haltungsfarbe), Rückzug = Pfeil auf Stahlhell, hält Stellung = kein Feld. Kürzel und Langform in `TEXT.phase`. |
| Alter | Bei Altstand ersetzt das **Alter in Ticks** (grau, ohne Hintergrund) das Phasenfeld. |
| Rahmen | Haltungsfarbe 35 % zum Grund gemischt; bei Altstand `#3A4A66`. |

**Lage im Hex** (`MASS.plakette.anker`): Mitte x = Hexmitte, Mitte y = Hexmitte + round(−0,36 · √3 · s), also im oberen Band, wo früher die
Koordinate stand. Die **Hafenklasse** rückt dafür von `p.y − 11` auf `p.y − 9`. Steht im Hex eine Notruf-Marke (oben rechts), rückt die
Plakette 9 px nach links. Die Lerche-Markierung (Dreieck) entfällt, wenn im Lerche-Hex eine Plakette steht; der helle Ring bleibt.

**Kurs** (geändert in SUND-01 E, Review-Befund „`n` verrät die jetzige Position“): Bei Marsch, unterwegs und Rückzug zusätzlich ein gefüllter Pfeil
6 px innen vor der Hexseite, Größe max(5, 0,2·s), 3 px dunkle Kontur. **Fremde Flotten** zeigen die **beobachtete Bewegung**: der Pfeil sitzt an der
Seite zum Hex, aus dem die Flotte kam (`v`, „kam von“), und zeigt von dort **in das Hex hinein** (Spitze zur Hexmitte). Das ist keine Vorhersage: ein
`n` (nächstes Hex) gäbe bei verzögerter Anzeige die jetzige Position preis. Eine Flotte, die Rom zum ersten Mal sieht oder die stillstand, hat noch
keinen Kurs (Plakette ohne Pfeil, nur das Phasenfeld). **Eigene Flotten** (Alter 0) zeigen weiter ihren echten nächsten Schritt `n`, der Pfeil verlässt
das Hex. Nur bei Wissensstufe jetzt/gesehen; ein Altstand zeigt keinen Kurs.

**Ziel:** Sammeln → **unbekannt** (kein Zeichen; Liste und Funk sagen „Ziel unbekannt“). Marsch → **vermutet**: Strichlinie 4/3 (1 px Hell auf 3 px
dunkel) bei fremden Flotten von der Hexmitte (bei eigenen von der Hexseite zu `n`) über höchstens 3 Hexe bis zum vermuteten Ziel, dort ein Kästchen
8×10 mit **„?“**. Es gibt sie nur, wenn der Kurs `v` bekannt ist (Schätzung aus der beobachteten Bewegung). Belagerung → bekannt (das Hex selbst).

## 3. Wissensstufen
| Stufe | Bedingung (Alter a, Verzögerung vz) | Plakette | Hex |
|---|---|---|---|
| **jetzt** (exakt) | eigene Gebiete und Flotten, a = 0 | Buchstabenfeld gefüllt, Lampen **voll** Hell | hell, Muster kräftig |
| **gesehen** | in Sicht, a ≤ vz (Vorgabe 1 Tick) | Buchstabenfeld gefüllt, Lampen **gerastert** (Schachbrett Hell/`#3A4A66`) | hell |
| **Altstand** | außer Sicht, a > vz, a ≤ `WERTE.altMax` (12) | Buchstabe und Lampen **nur Umriss** grau, Alter im Phasenfeld | **Dunkel** + Muster schwach |
| **unbekannt** | nie gesehen / älter als altMax | keine Plakette | Dunkel; Ortsinfo „nie gesehen (Kartenstand)“ |

Die Stufe trägt die **Form** (voll, Raster, Umriss), nicht die Farbe. Rom sieht 2 Sprünge (Daten, Server) um eigene Häfen, Posten, Flotten
und **die Lerche** (Kai: Sensorknoten).

## 4. Sichtgrenze und Dunkel (aus der Lichtkarte)
- **Dunkel** über jedem Kartenhex außer Sicht: Abdunklung `rgba(4,6,12,0.62)`, darüber Korn (Kachel 16 px, 30 Punkte, Seed 7), danach das
  Besitzermuster erneut mit Deckkraft `dunkel` (damit der zuletzt bekannte Besitzer lesbar bleibt). Hexinhalt (Symbol, Klasse, Posten) mit
  Deckkraft 0,45, Name in `#6F7E91`. Hexrand im Dunkel 0,18 statt 0,35.
- **Sichtgrenze**: jede Hexseite zwischen einem hellen und einem dunklen **Kartenhex** (nicht zum Leerraum-Rand): 4 px `#0B0E1A`, darauf 2 px
  Eisblau. Ohne Glow (Formsprache der Meldetafel).
- Reihenfolge: Flächen + Muster + Dunkel → Kanten → Sichtgrenze → Front → **Kantenperlen erneut** (Sprungpunkt bleibt auf Grenze und Front
  sichtbar) → Hexinhalte → Belagerung, Kurs, Vermutung → Plaketten → Lerche, Auswahl, Notrufe (oben).
- Verborgene Kanten (`hidden`) bleiben wie heute unsichtbar, bis sie bekannt sind.

## 5. Besitzermuster (Farbenblind)
Muster als 8×8-Masken in `MUSTER` (Hell, Deckkraft `hell` / `dunkel`). Kräftiger als `icons-b`: **Linien alle 4 px, Deckkraft 0,30**.
| Besitz | Fläche | Muster |
|---|---|---|
| Rom | `#6B2E2E` | waagrecht, alle 4 px |
| Germanen | `#3F4A28` | senkrecht, alle 4 px |
| Konkordat | `#4A4466` | keins (glatt) |
| Piraten | `#5C3A1E` | Punkte 2×2 |
| herrenlos | `#33404F` | Kreuze (0,22) |
| Vorläufer | `#1F5555` | Rauten (0,22) |

Die Sund-Karte nutzt diese Kacheln statt `icons-b musterKachel` (Limes und SL bleiben unverändert). Umsetzung: entweder `hexFlaeche` bekommt
ein `opts.muster` aus den Tokens, oder `starmap.js` zeichnet im Modus Freie Fahrt Fläche und Muster selbst. Entscheidet die Entwicklung.

## 6. Front, Posten, Häfen, Belagerung, Notrufe
- **Front (Warnbake):** jede Hexseite zwischen bekanntem römischem und bekanntem germanischem Besitz. Seite um 28 % je Ende verlängert, 8 px
  dunkle Unterlage, darauf 5 px Streifen Hell/Rot im Wechsel, je ~4 px. Nur Rom|Germanen (Konkordat neutral, Piraten keine Front).
- **Posten:** kleine Station mit Fahne links neben dem Symbol (x = p.x − 0,62·s), Fahnenfarbe `FARBE.fraktion.*.fahne`. Der Besitzer ist am
  Hexmuster ablesbar, die Fahne ist zweites Merkmal. Erkennungszeichen im Datenblock: Großbuchstabe (§12).
- **Häfen:** Symbol wie heute, Hafenklasse A–D rechts daneben (jetzt `p.y − 9`).
- **Belagerter Hafen (zwei Plaketten):** oben die Plakette des Angreifers mit **B**; das Hafensymbol und die Klasse entfallen, an ihrer Stelle
  (Mitte p.y + 1) die **Plakette des Verteidigers** (Garnison des Hafens, Stärkeklasse) in einem **Belagerungsrahmen**: Rechteck 2 px Hell
  mit roten Strichen 3/3 (Sprache der Bake, unter Protanopie noch sichtbar), 3 px seitlich und 4 px oben/unten Abstand, 4 px dunkle Unterlage. Sonst werden Heimatflotten im eigenen Hafen **nicht** gezeigt (§12).
- **Notruf-Marken:** unverändert `Kartenzeichen.marke('notruf')` oben rechts im Hex mit Restzeit-Bogen, Radius max(5, min(9, 0,2·s)). Kommt
  im Modus Freie Fahrt aus der Sim (`notruf`-Ereignis), nur wenn Rom das Hex sieht. Liegt oben auf, auch über einer Bake.

## 7. Meldeliste, Ortsinfo, Legende (rechte Spalte der Captain-Konsole)
Spalte x = a.x + 420, Breite 196, ab y = a.y + 2. Die innere Seitenleiste der Karte entfällt im Modus Freie Fahrt (§8). Aufbau von oben:
1. **ORT · SEKTOR 0803** (Messing) · Name (Gold) · „Germanen · Hafen D · Posten“ (Hell) · **Wissenszeile**: „Eigen · aktuell“ (Mint) /
   „Gesehen · Stand Tick 42“ (Eisblau) / „Außer Sicht · Stand vor 7 Ticks“ (Grau) / „Außer Sicht · nie gesehen“; außer Sicht zusätzlich
   „Nächster Knoten: 3 Sprünge (Sicht 2)“. Statt der Beschreibung (`desc`, bis 4 Zeilen) nur die Art in einer Zeile.
2. **MELDUNGEN · STAND T-1** (Messing), Zeilen à 12 px: Plakette ab x + 2, Text ab x + 40 (`MASS.spalte.meldung`). **Höchstens 5 Zeilen**,
   darunter „+n weitere“ (Grau). Rang: neu (Meldung aus dem letzten Tick, feindlich) → Belagerung → Marsch → Sammeln → unterwegs → hält →
   eigene → Altstand (jüngste zuerst). Ereignisse ohne Flotte („Speculum gefallen“, „Speculum hält“, „Posten Kantenstein verloren“) stehen
   `WERTE.meldungAlter` (3) Ticks lang am Ende. Texte `TEXT.meldeliste`:
   `Ulfsvakt · sammelt seit 2 Ticks` · `Eisfeld → Kantenstein ?` · `Speculum · belagert` · `Skjaldborg · vor 11 Ticks` · `Gasfeld → Kantenstein`.
   **Neu**-Strich 2 px Rot links, gewählte Zeile (Hex = Auswahl) 10 % Hell hinterlegt mit 2 px Hell links. Text Hell (neu), `#C9D2DC`
   (gesehen), Grau (alt). Zu lange Zeilen kürzen mit „.“. Vorschlag: Klick auf eine Zeile wählt das Hex.
3. Knopf „Als Sprungziel wählen“, dann **SPRUNG** kompakt (Ziel, Ladebalken, Bereit/Grund).
4. **Legende** unten (3 Zeilen à 12 px, Unterkante a.y + a.h): Plaketten jetzt/T-1/alt · Phasenfelder S sammelt, Pfeil Kurs, B belagert ·
   Bake Front, Eislinie Sicht, dunkles Feld außer Sicht. Die Bojen-Legende der inneren Leiste entfällt in diesem Modus (Kanten sind auf Sund
   fast alle offen; der Hinweis „gelb offen, rot gesperrt“ bleibt in der Fußzeile).

Platzbedarf geprüft im Mockup: Ort 5 Zeilen + 5 Meldungen + Sprung + Legende passen in 274 px.

## 8. Ausgangsansicht, Zoom, Verschieben
| | heute (fokus) | heute (gesamt) | **neu (Freie Fahrt)** |
|---|---|---|---|
| Hexe im Rahmen | 30 Hexe + Ring = ganzes Raster 11×7 | ganzes Raster | **30 Kartenhexe, ohne Ring** |
| Seitenleiste in der Karte | 130 px | 0 | **0** (die Konsolenspalte ersetzt sie) |
| Hexradius s | **16,0** | 20,3 | **23,6** (+48 % zu heute) |

- `fokusSet` = die Hexe der Karte (`K.hexe`), ohne Nachbarring; Marken und Lerche liegen ohnehin auf Kartenhexen. Keine Abdunklung „außerhalb
  des Ausschnitts“ (es gibt keinen). Bei s = 23,6 gilt `dicht` (Namen kurz, `p.y + h3/2 − 9`), Bereich **voll** (s ≥ 22) für Plaketten.
- Hover-Details: ohne innere Leiste zeigt `starmap.js` heute das Schild im Bild. Vorschlag: im Modus Freie Fahrt kein Schild, die Ortsinfo
  der Spalte folgt dem überfahrenen Hex (Auswahl bleibt per Klick).
- **Zoom (Rad, 1–8×), Ziehen, 0:** unverändert. Plaketten, Linienbreiten, Muster (8-px-Kachel im Bildschirmraster) und Schrift bleiben
  pixelgroß; nur die Hexe wachsen. Die Plakette bleibt am Anker (−0,36·h3) und rückt damit bei Zoom in den oberen Teil des Hexes.
- **Taste M:** auf dieser Karte ist „ganze Karte“ = Ausgangsansicht. Vorschlag: M wechselt **Übersicht ↔ Nahansicht** (Lerche + alle Hexe
  bis `MASS.ansicht.nahSpruenge` = 2 Sprünge, Hexradius höchstens 40). Text in der Fußzeile „M Nahansicht“ / „M Übersicht“.
- **Hexradius-Bereiche** (`MASS.hexradius`): **voll** s ≥ 22 = ganze Plakette, Kurs, Vermutung, Namen. **knapp** 14 ≤ s < 22 =
  Kurzplakette 9×9 (nur Buchstabenfeld; Phase als Rahmenfarbe: Gelb S, Rot B, Haltungsfarbe Marsch; Altstand Umriss), Kurs bleibt, keine
  Strichlinie. **kompakt** s < 14 (HUD-Ausschnitt) = nur Buchstabenfeld, keine Liste, kein Kurs. In der Sternkarte wird „knapp“ nur erreicht,
  wenn eine kleinere Konsole die Karte zeichnet (Planungstisch `plan-stern`).

## 9. Die drei Lagen
| Lage | Was die Karte zeigt |
|---|---|
| **a · ruhig** | Rom hell bis zur Sichtgrenze (Gasfeld, Kantenstein mit Posten; Lerche in Pulverhorn hellt den Süden bis Sudrvik auf). Bake am Pass Kantenstein|Eisfeld. Gesehene germanische Flotte in Eisfeld (gerastert), eigene Patrouille mit Pfeil, Altstand bei Skjaldborg „9“. Germanisches Kernland dunkel, senkrechtes Muster lesbar. |
| **b · Aufmarsch gesehen** | Ulfsvakt im Licht (2 Sprünge von Kantenstein). Plakette **G ▮▮▮ S** (gerastert), Meldeliste oben „Ulfsvakt · sammelt seit 2 Ticks“ mit Neu-Strich, **Funk-Einblendung** und Logbuch-Eintrag. Kein Ziel auf der Karte. |
| **c · nicht gesehen** | Ohne Posten Kantenstein liegt Ulfsvakt 3 Sprünge vom nächsten Knoten: **dunkel**, Sichtgrenze vor Ulfsvakt, darin nur die Altstand-Plakette „7“. Ortsinfo „Außer Sicht · Stand vor 7 Ticks · Nächster Knoten: 3 Sprünge“. Meldeliste ohne Neu, dafür „Posten Kantenstein verloren“. **Kein Funk.** |
| Marsch (Tick 46) | Plakette mit rotem Pfeilfeld in Eisfeld, Pfeil an der Seite nach Kantenstein, Strichlinie bis Speculum mit „?“. Funk „bricht auf, Kurs …, Ziel vermutlich …“ (Vorschlag, §10). |
| Belagerung (Tick 51) | Speculum: G mit B oben, Verteidiger R im roten Rahmen, Notruf-Marke; Gasfeld und Kantenstein germanisch, Bake nach Westen gerückt. |

## 10. Funkmeldung
- **Pflicht (Abnahme 8):** bei **Sammelbeginn**, nur wenn Rom die Flotte sieht (Stützpunkt in Sicht), einmal je Feldzug (Schlüssel
  Feldzug-Id + Phase), auch im Schnellsprung (dann je Hop höchstens eine je Feldzug).
- **Einblendung:** `Hud.onRadio(von, text)`, Dauer `WERTE.funkDauer` = 6 s (vorhanden), Ton `radio`. Kopf „FUNK · POSTEN KANTENSTEIN“ (Gold),
  Text Hell, höchstens 4 Zeilen (vorhanden). Neu: **3 px Akzentstreifen links in Rot** (`FARBE.funk.akzentFeind`) für Feindmeldungen.
- **Absender** `TEXT.funk.von`: der Knoten, der die Flotte sieht (nächster): „Posten {ort}“, „Hafen {ort}“, „Flotte bei {ort}“, „Sensoren Lerche“.
- **Text** `TEXT.funk.sammeln`: „Germanische Flotte sammelt sich bei {ort}. Stärke {klasse}, Ziel unbekannt.“
- **Logbuch** (`mission.log`, `loc` = Stützpunkt): `TEXT.funk.log.sammeln` „Germanische Flotte sammelt sich ({klasse}). Tick {t}.“ →
  im Funk-Reiter „**Ulfsvakt:** Germanische Flotte sammelt sich (groß). Tick 43.“ (Ort Eisblau, Rest Hell; vorhanden).
- Vorschlag, wenn billig: links im Funk-Reiter ein Feld **LAGEFUNK · {von} · TICK {t}** mit der letzten Lagemeldung (Panel wie Funkspruch,
  roter Akzent), solange kein Missionsfunk ansteht. Weitere Vorlagen (Marsch, Belagerung, gefallen, gehalten) stehen in den Tokens; ob sie in
  SUND-01 funken, entscheidet die Entwicklung (Funkdichte im Spiel prüfen).

## 11. Platzmangel und Barrierefreiheit
- Höchstens **zwei Plaketten** je Hex, die zweite nur bei Belagerung. Mehr Fraktionen im Hex: die ranghöchste zeigen, rechts ein Chip „+1“
  (dunkel, Hell); die Ortsinfo nennt alle.
- Plakette darf seitlich bis ~7 px über den Hexrand ragen (eigene dunkle Unterlage); sie liegt über Mustern, Kanten und Nachbarnamen.
- Meldeliste 5 Zeilen + „+n weitere“; Funk 4 Zeilen; Vermutung höchstens 3 Hexe weit; Namen per `kurzName` (vorhanden).
- **Farbenblind:** Fraktion nie nur über Farbe (Buchstabe R/G/K/P, Flächenmuster). Wissensstufe über Form (voll/Raster/Umriss + Zahl) und
  Helligkeit (Dunkel), Phase über Buchstabe/Pfeil, Front über Streifen, Sichtgrenze über Linie und Helligkeitssprung. Geprüft mit
  Deuteranopie und Protanopie (Machado 2009): Rom waagrecht und Germanen senkrecht klar getrennt, Buchstaben lesbar (Mockup-PNGs).
- Kontrast: dunkler Buchstabe auf Hellrot ≈ 6,9:1, auf Mint ≈ 12:1, auf Warngelb ≈ 12:1; Text Hell auf Grund ≈ 16:1; Grau `#9AA6B8` ≈ 7,8:1.

## 12. Datenvertrag Server → Karte (Vorlage; das endgültige Format legt die Entwicklung fest)
Ein Anzeigeblock **`world.lage`** nur im Modus `freie_fahrt`, **nur bei Änderung** (wie `world.sektoren`/`world.marken`), also einmal je Tick.
Kein Sim-Zustand, nur was die Darstellung braucht, alles schon nach dem Wissen von Rom gefiltert und verzögert.

```json
{ "t": 43, "vz": 1,
  "hx": "rererererererereRek1-1-?p5Rek1-1p4G1k1-1v3g1g1v6gbg9g9g9g9g9",
  "f": [ { "f": "g", "h": "0803", "k": 3, "p": "s", "a": 1, "d": 2 },
         { "f": "g", "h": "0703", "k": 1, "p": "h", "a": 1 },
         { "f": "g", "h": "0904", "k": 2, "p": "u", "a": 11, "v": "0803" } ],
  "m": [ { "e": "sa", "h": "0803", "t": 43, "f": "g", "k": 3 },
         { "e": "pg", "h": "0603", "t": 38, "f": "r" } ] }
```
(Lage b, 3 Flotten, 2 Meldungen: **≈ 320 B**. Gemessen im Mockup mit 4 Flotten 357 B; Obergrenze bei 12 Flotten und 6 Meldungen ≈ 1,0 KB.)

| Feld | Bedeutung | Wissensstufe |
|---|---|---|
| `t` | Tick des Wissensstands | – |
| `vz` | Verzögerung in Ticks (Daten, Vorgabe 1); `a ≤ vz` = gesehen | – |
| `hx` | **je Hex zwei Zeichen** in der Reihenfolge `Object.keys(karte.hexe).sort()` (`KarteTokens.hexReihenfolge`, 30 Hexe = 60 Zeichen). Zeichen 1: zuletzt bekannter Besitzer `r g k p - v` (`-` = herrenlos, Fläche dann aus der Karte), **Großbuchstabe = Posten**. Zeichen 2: Alter `e` = jetzt, `1`–`9`, `a`–`z` = Ticks (base36, `z` ≥ 35), `?` = nie gesehen. Lesen: `KarteTokens.hxLesen(hx, codes)`. | jetzt (`e`), gesehen (≤ vz), Altstand, unbekannt (`?`) |
| `f[]` | Flotten mit Plakette, nach Rang, höchstens `WERTE.flottenMax` (12): `f` Fraktion, `h` Hex, `k` Stärkeklasse 1–3, `p` Phase (`h` hält, `u` unterwegs, `s` sammelt, `m` Marsch, `b` belagert, `r` Rückzug), `a` Alter (0 eigen), optional Kurs: `v` „kam von“ (fremde Flotten, beobachtete Bewegung, nur wenn die Flotte im vorigen Stand in Sicht war) oder `n` nächstes Hex (nur eigene Flotten, Alter 0), `z` Ziel (nur `m` = vermutet, `b` = bekannt; bei `s` nie), `d` Ticks im Sammeln | je Eintrag über `a` |
| `m[]` | Lagemeldungen der letzten Ticks (höchstens 6): `e` Art (`sa` sammelt, `ma` Marsch, `be` Belagerung, `hf` Hafen gefallen, `hh` Hafen hält, `pg` Posten gegründet, `pv` Posten verloren), `h` Hex, `t` Tick, optional `f`, `k` | nur, was Rom gesehen hat |

Beispiel `hx` gelesen: `0105` → `re` = Rom, kein Posten, jetzt. `0503` → `Re` = Rom **mit Posten**, jetzt. `0803` → `g1` = Germanen, gesehen
(Stand T−1). `0904` → `gb` = Germanen, Altstand **11** Ticks. `0506` → `-?` = herrenlos laut Karte, nie gesehen.

Regeln für den Server (Wissensmodell, Abnahme 6):
- **Welche Flotten:** alle Flotten im Feld (Befehl ≠ heim), die Rom gerade sieht oder als Altstand ≤ altMax kennt; **eigene Heimatflotten im
  eigenen Hafen nicht** (die Hafenklasse sagt genug), feindliche Heimatflotten auch nicht; **Ausnahme Belagerung**: die Garnison des
  belagerten Hafens als Eintrag `p: "h"` am selben Hex (zweite Plakette).
- **Vermutetes Ziel** (`z` bei `m`): Empfehlung eine Schätzung (erstes römisches Ziel, Hafen oder Posten, auf dem kürzesten Weg in
  Marschrichtung), nicht die wahre Absicht. Die Karte darf irren; der Leitgedanke „auch wenn das falsch ist“ gilt.
- **Kurs** fremder Flotten: `v` ergibt sich aus der beobachteten Bewegung (das Wissen merkt sich je sichtbarer Flotte das Hex des vorigen Standes, Spur intern
  nach Sim-Flottenid, nie im Block); `n` (Vorhersage) gibt es nur für eigene Flotten. Der Block enthält zu fremden Flotten nichts, was vom Zustand nach dem
  Vor-Tick abhängt (metamorph getestet). `d` zählt die Ticks, die Rom das Sammeln gesehen hat.
- **Sicht** rechnet nur der Server; der Client leitet hell/dunkel aus `hx` ab und rechnet nur „Nächster Knoten“ für die Ortsinfo nach.
- Ids braucht die Darstellung nicht. Für „nie doppelt“ (Funk) hält der Server die Feldzug-Id intern.

## 13. Offen / nicht entschieden
- Hafenklasse von Kantenstein: `sund_frei.json` sagt D, `sund-sim.json` keine. Die Karte zeigt, was `sund_frei.json` sagt.
- Konkordat-Häfen als Sichtknoten (Informationshandel) erst SUND-03 (Erweiterungspunkt des Wissensmodells).
- Taste M (Nahansicht) und Hover-Ortsinfo sind Vorschläge; die Entwicklung prüft gegen `check-tasten`.
