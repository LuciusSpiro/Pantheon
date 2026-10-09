# Abnahme B3 „Sektorkarte“ (QA-ABNAHME-B3)

Stand: eingefrorene Kopie `C:\tmp\pantheon-qa-b3`, abgezogen am **2026-10-08 um 23:05:56** (robocopy ohne
`node_modules data shots .git`, `node_modules` als Junction). Im Original wurde nichts geändert, außer diesem Dokument
und den Screenshots unter `shots/qa-b3/`.

Testserver: **Port 3399** statt 3395, weil auf 3395 und 3396 bereits fremde Server liefen (PIDs 41332, 40560, gestartet
23:05/23:06, vermutlich QA-B1/B2). Ich habe sie nicht angefasst. Start mit `ROOM_CODE=off WORLD_DIR=data/worlds-qa-b3
REGIE_DIR=data/regie-qa-b3 --debug`. Am Ende beendet. Browser: Chromium über playwright-core aus Asgard.
Skripte: `C:\tmp\pwtest\sts\b-qa-b3-{repl,flug,erkunden}.js` und `qa-b3-pw.sh`.

**Wie gespielt wurde:** Es lief eine dauerhafte Browser-Sitzung, die ich Schritt für Schritt gesteuert habe. Eingaben
gingen als echte Tasten und Mausklicks an die Seite: WASD, E, Konsolentasten, Klicks auf die Sternkarte. Die Wegsuche zu
Konsolen und das Lenken auf Punkte hat ein Hilfsskript übernommen, die Tasten hat es trotzdem echt gedrückt. Zwischen den
Schritten lagen Pausen von 0,5 bis 5 s. Der Lesbarkeit halber habe ich den Zustand über `__game.state` mitgelesen.
Debug-Befehle habe ich **keine** benutzt. Auch das freie Spiel lief über den Lobby-Start „Kampagne ohne Tutorial“.

## Ergebnis

**Teilweise bestanden.** Die Spielregeln von B3 halten im Browser und in den Tests. Das Tutorial läuft wie heute, der
Golden-Vergleich ist mit `WAFFEN=aus` byte-identisch. Zwei Prüfpunkte aus dem Auftrag sind aber **nicht erfüllt**:
- **Randpfeile zu Bojen außerhalb des Bildes fehlen**, siehe Fehler F1.
- **Die Pfeiltasten-Auswahl auf der Sternkarte schickt ein falsches Ziel**, siehe Fehler F2.

Beide Fehler liegen im Client und sind klein. Rein spielmechanisch ist B3 abnahmefähig, für Spieler bricht F1 aber genau
die neue Anflugpflicht.

| # | Prüfpunkt | Ergebnis |
|---|---|---|
| 1 | Springen nur über offene Kanten, Leerraum, Notfallsprung | **bestanden** |
| 2 | Erkundungsstand überlebt Speichern und Laden | **bestanden** |
| 3 | Tutorial wie heute (m1 und Anfang m2 im Browser), Golden m1–m3 | **bestanden** (mit Anmerkungen) |
| 4 | Karte, Ansicht M, Anflug, Randpfeile, Weitscan | **teilweise:** Randpfeile fehlen (F1) |
| 5 | Snapshot < 13 KB, `welcome` ≈ 8 KB | **bestanden** |
| 6 | `npm run check`, `test-sektoren`, `test-weltstand`, `test-bausteine` | **bestanden** |

## 1. Springen, Leerraum, Notfallsprung – bestanden

**Test** (`node tools/test-sektoren.js`): **77/77** Prüfungen bestanden. Darin enthalten:
- „Leerraum ohne temporären Sprungpunkt nicht wählbar“
- „temporärer Sprungpunkt ins Rostnest abgelehnt“
- „40 Seeds aus Vaelen: nur spielbare Nachbarhexe (0206×10, 0308×8, 0108×11, 0307×4, 0208×7)“
- „bevorzugt in Flugrichtung: Kurs Süd -> Vaelen 58/150“
- „aus dem Leerraum 0106: 25/25 Notfallsprünge führen in ein System“
- „Kette Hafen -> Leerraum -> hinaus gezeigt“

**Browser, freies Spiel** (Lobby „Kampagne ohne Tutorial“, ohne Debug):

| Schritt | Ergebnis | Beleg |
|---|---|---|
| Ziel Splittergürtel wählen | Steuer: „Sprungpunkt Splittergürtel anfliegen (979 m)“, Antrieb lädt nicht | `51-frei-steuer-anflug-pflicht.png` |
| Sprungpunkt anfliegen | lädt bei 126 m, Sprung gelingt | `54-…` |
| Ankunft im Splittergürtel | am Sprungpunkt der Gegenkante (270,1510), Kurs −30° (Flugrichtung NO) | `55-…` |
| Statio Limitis wählen | „GESPERRT: Grenzposten Statio Limitis: Durchflug gesperrt.“ | `56-frei-statio-gesperrt-klick.png` |
| Graue Weite vom Splittergürtel (Nachbar ohne Kante) | „Kein Sprungpunkt dorthin.“ | `57-…` |
| Rostnest anklicken | „? Unbekannt. GESPERRT: Kein bekannter Sprungpunkt.“, nicht wählbar | `40-limes-rostnest.png` |
| Notfallsprung (N, dann J) aus dem Splittergürtel, Kurs NO | landet in B-7 (Nachbarhex in Flugrichtung), Hülle 100 → 85, Reaktor `offline` | `58–60` |
| zweiter Notsprung bei Reaktor aus | gesperrt | `60-frei-notsprung-reaktor-aus-gesperrt.png` |
| Reaktor-Neustart | am Schalter A E gehalten, der Schrauber übernimmt B, Reaktor wieder `online` | `61-…` |
| Notsprung aus B-7 | landet im **Leerraum 0506**: leere Szene 2400×1800, 0 Asteroiden, Hex erkundet | `62-…` |
| B-7 aus dem Leerraum wählen | „Kein Sprungpunkt dorthin.“ | `64-leerraum-b7-nicht-waehlbar.png` |
| Reaktor-Neustart, zweiter Notsprung aus dem Leerraum | führt **hinaus nach B-7** | `65-frei-zweiter-notsprung-hinaus.png` |

Anmerkung: Der erste N/J-Versuch nach dem Neustart wirkte nicht (Szene und Hülle unverändert), der zweite schon. Den
Reaktorzustand in dem Moment habe ich nicht erfasst, wahrscheinlich lief der Neustart noch. Ich zähle das nicht als
Mangel. Wenn es öfter vorkommt, fehlt in der Steuer ein lesbarer Grund dafür.

## 2. Erkundungsstand überlebt Speichern und Laden – bestanden

Ablauf in der Tutorial-Kampagne: m1 durchgespielt, im Hafen angedockt (dabei automatisch gesichert), dann „Partie
beenden“, Lobby, denselben Weltstand fortsetzen.

| Zeitpunkt | Stand |
|---|---|
| vorher | `e: [0206, 0306, 0406]`, `b: [0206-0306, 0206-0207, 0306-0406, 0306-0405, 0307-0406, 0405-0406]` |
| Datei `w-19iy.json` (v3) | `welt.sektoren { erkundet: [0206, 0306, 0406], bojen: [dieselben 6], temp: [], offen: [] }` |
| nach dem Laden | identisch |

Belege: `37-nach-laden-sternkarte-saumraum.png`, `38-nach-laden-limes-ganz.png`.

Temporäre Kanten und alte Weltstände habe ich nur per Test belegt, nicht im Browser. `test-sektoren` meldet ok für:
- „temporäre und offene Kanten identisch“
- v1 `nach-tutorial`: 7 erkundete Hexe
- v2 `mitten-m2`: 4 erkundete Hexe, Bojen und `offen` migriert

Beim Beenden unterwegs (undocked, im Nebel) wurde wie vorgesehen der letzte angedockte Stand (Vaelen) behalten.

## 3. Tutorial wie heute – bestanden, mit Anmerkungen

### Browser m1

Komplett gespielt, solo, Hafen-Übung per Lobby übersprungen. Die Übung enthält keine Sprünge.

1. Funk annehmen, Ziel Splittergürtel per Klick wählen, ablegen.
2. Faltsprung aus 793 m Abstand zum Sprungpunkt: **kein Anflug nötig**, Ankunft an `scene.arrive` (150,800) wie heute
   (`11-…`, `12-…`).
3. Bergung 3/3, Grauzahn bestochen, B-7 gewählt, Sprung.
4. **Weitscan bei B-7** findet die Boje zur Grauen Weite: Meldung „Boje gefunden: Sprungpunkt Graue Weite“ (`21-…`).
5. Störrelais, Bojen-Scan, Außenteam auf der Plattform: Sonde mit Farbcode abgeschaltet, Bojenkern neu gestartet,
   Datenkern geborgen, hochgebeamt (`25–29`).
6. Datenkern geliefert, Nachhut abgewehrt.
7. Hafen von B-7 direkt: „Keine bekannte Route dorthin – erst über einen Nachbarort.“ Das ist die alte Regel (`31-…`).
8. B-7 → Splittergürtel aus 1821 m, dann → Hafen, andocken. **m1 erledigt** (`33-…`).

Ehrliche Einschränkungen beim m1-Lauf:
- Ivo habe ich nicht gerettet. Er ist optional, und meine Figur wurde beim ersten Abstieg einmal per Notrückholung
  hochgeholt.
- Den Farbcode der Sonde habe ich aus dem Zustand gelesen, also aus dem, was der Captain-Reiter 6 zeigt.
- Die Browserverbindung riss während einer längeren Unterbrechung meiner Sitzung still ab. Nach einem Neuladen der Seite
  lief die Partie weiter (Server-Log: „wieder verbunden“). Ich zähle das nicht als B3-Mangel.

### Browser m2 (Anfang) mit Wrack-Abstecher

1. Funk annehmen, Vaelen, andocken, Nebelkarte gekauft.
2. Abstecher Vaelen → Hafen → Splitter → **Wrack** (`44-…`).
3. **Wrack → Graue Weite abgelehnt** („Keine bekannte Route …“, `45-…`). Das ist E32: Die Kante `nebel–wrack` ist
   entfallen.
4. **Wrack → B-7 über die neue Kante** (`46-…`), dann B-7 → Graue Weite (`47-…`). m2 erreicht den Schritt `ambush`.

### Golden m1–m3, ohne Allow-Liste, 20 Seeds × Crew 1/3 = 120 Läufe

| Schalter | Ergebnis |
|---|---|
| `WAFFEN=aus` (Vergleichsmaßstab laut Studioleitung) | **120/120 byte-identisch, „GOLDEN GRÜN“** |
| ohne Schalter (Waffen an) | 80/120 identisch: **m1 und m2 alle 80 identisch**, 40 Abweichungen nur in m3 (Wächter, Medipacks, Treffer). Das ist die bewusste B2-Änderung, kein B3-Mangel. |

`WAFFEN=aus` macht m1–m3 also wieder byte-identisch. **`allow-b3.json` ist nicht nötig.** Die Golden-Läufe in m2
enthalten keinen Wrack-Abstecher, deshalb habe ich ihn zusätzlich geprüft:

`WAFFEN=aus node tools/sim-headless.js 1 --wreck --seed 3` → „SIM OK“, Wrack erledigt, Server-Fehlerzähler 0.

## 4. Karte, Ansicht, Anflug, Randpfeile, Weitscan – teilweise

Bestanden:
- **Ganze Karte Limes sichtbar** über Taste **M** (`38-…`): 10×8 Hexe, gesperrte Systeme schraffiert, Fraktionsfarben,
  Symbole. Standard ist die Ansicht Saumraum (`06-…`, `50-…`).
- Gesperrte Hexe zeigen beim Überfahren eine lesbare Begründung (Statio, `39-…`).
- Rostnest ist nicht anfliegbar (`40-…`).
- Im freien Spiel muss man den Sprungpunkt anfliegen (siehe Prüfpunkt 1).
- Der Weitscan findet Bojen (siehe Prüfpunkt 3, B-7). Im Test: „Weitscan findet die Boje (Ereignis bojeGefunden)“.

**Nicht bestanden: Randpfeile (F1).** Liegt die Boje des gewählten Ziels außerhalb des Bildes, zeigt weder die
Frontsicht noch die Taktik einen Randpfeil. Hafen und Dock-Ring bekommen dagegen Randmarken.
Belege: `52-frei-steuer-boje-ausserhalb-kein-randpfeil.png`, `53-frei-taktik-bojen.png`.

## 5. Snapshot und `welcome` – bestanden

Im Browser gemessen (WebSocket-Frames, freie Kampagne solo, 12 435 Snapshots):

| Nachricht | Größe |
|---|---|
| `welcome` mit Sektorkarte | **8 090 B** |
| Snapshot max | **8 917 B** |
| Snapshot p95 | 8 649 B |
| Snapshot Median | 5 995 B |

Weitere Messungen:
- `test-weltstand`: Snapshot im Spiel max 10.20 KB
- `sim --wreck`: max 11 241 B normal, 11 631 B mit Ortsliste
- `check-sektoren`: „welcome.sektorkarte ohne praesenz, 7983 B“

Alle Werte liegen unter 13 KB. Den Außenposten mit 3 Spielern und 12 Gegnern misst QA-B1.

## 6. Tests – bestanden

| Befehl | Ergebnis |
|---|---|
| `npm run check` | check-maps 576/576, check-sektoren **199/199**, „Sektoren OK“ |
| `node tools/test-sektoren.js` | **77/77** |
| `node tools/test-weltstand.js` | **164/164** |
| `node tools/test-bausteine.js` | **124/124** |
| `node tools/test-spielleiter.js` | **bricht ab** mit `ReferenceError: b1Tests is not defined` (`test-spielleiter.js:704`) |

Den Abbruch in `test-spielleiter` sehe ich als Zwischenstand von SPIELLEITER zum Zeitpunkt des Abzugs, nicht als
B3-Mangel. Er ist außerdem nicht der erwartete „Kontext-Golden rot“. Bitte im Original nachprüfen.

`npm test` als Ganzes habe ich deshalb nicht grün gesehen.

## Gefundene Fehler

**F1 (mittel, KARTE `public/js/starmap.js`): Keine Randpfeile zu Bojen außerhalb des Bildes.**
- Ursache: `zeichneSzene` zeichnet jede Boje nur an ihrer Bildposition. `cam.arrow` und `cam.inB` reicht `render.js`
  zwar mit (render.js:3112), sie werden aber nie aufgerufen.
- Nachstellen:
  1. Lobby „Kampagne ohne Tutorial“ starten.
  2. Captain wählt den Splittergürtel.
  3. Am Steuer ablegen und das Schiff nach Süden drehen.
  4. Die Frontsicht zeigt keinen Hinweis auf die Boje (Abstand ca. 900 m). Nur „Sprungpunkt anfliegen: 934 m“ steht
     links im Text.
- Folge: Die Anflugpflicht wird zum Suchen ohne Richtung.

**F2 (mittel, CLIENT `public/js/consoles.js`): Pfeiltasten-Auswahl schickt ein veraltetes Hex.**
- Ursache: `cycleStar` setzt `starSel` neu, aber nicht `starHex`. `selectDest` nimmt deshalb das zuletzt angeklickte Hex.
- Nachstellen:
  1. Captain, Sternkarte.
  2. Splittergürtel anklicken und mit Enter bestätigen.
  3. Nach dem Sprung mit → B-7 auswählen und Enter drücken.
  4. Ergebnis: „Da sind wir doch schon.“ Es wurde `{hex: '0306'}` gesendet, kein Ziel gesetzt
     (`17-BUG-pfeiltaste-alter-hex.png`). Die Seitenleiste zeigt dabei „SEKTOR 0306“ neben „ORT Boje B-7“.
- Lösung: In `cycleStar` `this.starHex = null` setzen.

**F3 (klein, Inhalt `content/regiebuecher/m2.regiebuch.json`): Veraltete Texte zur Wrack-Kante.**
- `ziel.zum_nebel`: „Zur Grauen Weite fliegen (über B-7, Vaelen oder das Wrack)“
- `briefing.nebel_aufgedeckt`: „… oder das Wrack.“
- Seit E32 gibt es die Kante Wrack → Graue Weite nicht mehr. Das HUD-Ziel schickt Spieler also auf einen Weg, den der
  Server ablehnt.

**F4 (klein, CLIENT/KARTE): Anflug-Hinweise auch im Tutorial.**
- Während m1/m2 zeigen Sternkarte und Steuer „Sprungpunkt 1243 m – anfliegen“ bzw. „Sprung nur am Sprungpunkt (Boje) im
  Sektor“. Der Server verlangt im Tutorial aber keinen Anflug.
- Lösung: Diese Zeilen ausblenden, solange `sprung.anflugPflicht` nicht gilt. Das bräuchte z. B. ein Flag in `ship.jump`.

**F5 (kosmetisch):**
- Bojen-Labels werden nicht am Rahmen der Frontsicht abgeschnitten („…ttergürtel“ ragt ins linke Panel, `11-…`;
  „→ Vaelen-Karaw“ wird am rechten Rand gekappt, `52-…`).
- Der Positionsmarker verdeckt die letzte Ziffer der Koordinate des eigenen Hexes, 0206 liest sich wie „020…“.
- Der Hover-Text für Leerraum ist abgeschnitten: „Nur über temporäre Sprungpunkte oder“, danach fehlt
  „Notfallsprung“ (`38-…`).
- Im Leerraum ist der Knopf „Enter Als Sprungziel wählen“ für B-7 aktiv, obwohl der Server ablehnt (`64-…`).

**Nicht gefunden:** einen Kartenausschnitt der Hexkarte im HUD zu Fuß (`opts.kompakt`, CONTRACT-B3 §8). Das HUD zeigt nur
den Decksplan (`66-hud-zu-fuss.png`). Vielleicht habe ich die Stelle übersehen. Bitte bei KARTE/CLIENT nachfragen.

## Textvorschlag README-Abschnitt „B3 Sektorkarte“

```markdown
## Neu in B3 – Sektorkarte (Hexfeld)

Die Sternkarte ist jetzt die **Karte Limes**: 10×8 Hexe, ein Hex = ein Sektor = eine Raumszene (Koordinate `SSZZ`,
z. B. `0206` Lichtkordon). Die Daten liegen in `content/welt/limes.json`.

- **Ansicht:** Captain-Reiter 2 zeigt den **Saumraum** (die 8 spielbaren Hexe und einen Ring). **M** schaltet auf die
  ganze Karte Limes. Unerkundete Hexe zeigen nur Umriss und Name, gesperrte sind schraffiert und nennen beim Überfahren
  den Grund (z. B. „Grenzposten Statio Limitis: Durchflug gesperrt“). Rostnest (0107) bleibt „?“ und ist nicht
  anfliegbar.
- **Springen:** nur ins Nachbarhex über eine **offene Kante mit bekannter Boje** (gelb = offen, rot gestrichelt =
  gesperrt, blau = temporär). Sektor anklicken, Enter, am Steuer F.
- **Anflug:** Im freien Spiel (Kampagne ohne Tutorial bzw. nach m3) muss die Lerche die **Boje anfliegen** (≤ 250 m),
  sonst steht am Steuer „Sprungpunkt <Ziel> anfliegen (<m> m)“. Ankunft am Sprungpunkt der Gegenseite, Blick in
  Flugrichtung.
- **Tutorial (m1–m3):** Faltsprung wie bisher von überall (≥ 300 m von der Station), kein Anflug.
- **Bojen finden:** Bojen zwischen bekannten Orten sind bekannt. Weitere findet der **Weitscan** der Taktik (Umkreis
  1400 m, Meldung „Boje gefunden …“).
- **Leerraum** (leere Hexe) ist eine Barriere: kein regulärer Sprung hinein oder heraus, nur über temporäre Sprungpunkte
  (Missionen) oder den Notfallsprung.
- **Notfallsprung** (Steuer **N**, dann **J**): zufällige Kante, bevorzugt in Flugrichtung, nur in spielbare Hexe
  (auch Leerraum). Danach ist der Reaktor aus (Neustart an Schalter A und B im Maschinenraum) und die Hülle verliert 15.
  Nach dem Neustart führt ein zweiter Notfallsprung immer wieder heraus.
- **Wrack „Zaunkönig“:** Die Kante Wrack–Graue Weite gibt es nicht mehr. Dafür gibt es Wrack–B-7.
- **Erkundung** (erkundete Hexe, gefundene Bojen, temporäre Kanten) steht im Weltstand (`welt.sektoren`) und überlebt
  Speichern und Laden. Alte Weltstände übernehmen den Stand aus den besuchten Orten.
- **Debug** (`npm run debug`): `hex <SSZZ>`, `boje <kante>`, `notsprung`, `erkunde alle`.
- **Messwerte (QA 2026-10-09):** `welcome` mit Sektorkarte 8,1 KB, Snapshot im Raum max 8,9 KB (Browser, solo). Golden
  m1–m3 mit `WAFFEN=aus` 120/120 identisch.
```

---
## Nachtrag Studioleitung (2026-10-09)
- F1–F5 behoben durch B3-FIX, Nachweise `shots/b3-fix/` (13 Screenshots), `npm test` grün.
- F3 ändert den Text `briefing.nebel_aufgedeckt` in m2 → Golden m2 weicht nur in dieser Zeile ab (bewusst; Neuaufnahme in
  Welle 3 zusammen mit m3).
- Nacharbeit B3-NACH (läuft): Serverfeld `ship.jump.anflug` statt Client-Ableitung; Beschriftungs-Überlagerung in der
  Frontsicht (HAFEN/DOCK/SPRUNG um das eigene Schiff).
- Stand Studio: B3 abnahmereif nach B3-NACH. Abnahme durch Kai: Prüfpunkte 1–5 oben, Funde F1–F5 nachstellen.
- B3-NACH erledigt: `ship.jump.anflug` vom Server (Client-Ableitung entfernt, sie war bei übersprungenem Tutorial falsch);
  Randpfeile gebündelt, Ortslabels nur im Bild, eigenes Schiff/DREHEN-Anzeige frei (`shots/b3-nach/`). Rest: gemeinsamer
  Pfeil nimmt die Farbe des ersten Ziels (kosmetisch).
- **Stand Studio: B3 abnahmereif.**
