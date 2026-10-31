# SYS-03 Messung nach N1 (Abnahme 6 neu und 7)

Stand: Worktree `Pantheon-sys03`, Branch `sys03`, Commit `f3440d9` (N1), nichts am Code geändert. Messwerkzeuge unverändert; Scratch (nicht im Repo) unter `C:\tmp\sys03-n1\`. Vergleich "vorher" = Abschnitt "Nach D" in `messung-baseline.md`.

## Ergebnis

- **Abnahme 6, Lerche-Seite (Gegner schießt auf stehende Lerche): erfüllt.** Kleinster Wert Zone leer → Reaktor zerstört: **6,133 s** (Kreuzer, Crew 2; Anzeige 6,1), alle anderen Zellen 8,3 s und mehr.
- **Abnahme 6, Gegner-Seite (Bot-Läufe): für Korvette, Fregatte, Kreuzer erfüllt** (kleinste Werte 6,7 / 7,2 / 7,3 s; in diesen Läufen kein einziger Torpedo). **Für den Jäger (raider) nach der Messgröße NICHT erfüllt:** kleinster Wert −5,2 s, 13 von 199 Paaren unter 6,1 s (Crew 2: 4 von 99, Crew 3: 9 von 100). Ursache (gemessen): kein Torpedo und keine Verletzung des Fensters selbst. Die Lanze-Vollladung setzt den Reaktor früh (oft 0,7 s nach Spawn) auf beschädigt; die zweite Stufe kommt später als 6 s danach (kleinster Abstand Stufe 1 → Stufe 2 über alle 200 Jäger: 6,07 s), aber zufällig kurz nach "Zone leer" oder sogar davor. Die Messgröße "Zone leer → Reaktor zerstört" unterschreitet 6,1 s also, ohne dass das Reaktor-Fenster verletzt wurde. Ob die Abnahme das so meint, entscheidet der Entwicklungsleiter bzw. Kai.
- **Ein-Schuss-Probe Lanze: bestanden.** 200 Vollladungen je Klasse, Reaktor zerstört: **0 / 0 / 0 / 0** (raider, korvette, fregatte, kreuzer), auch mit vollem Schild, Countdown nie gestartet. Reaktor beschädigt: raider 96, korvette 72, fregatte 39, kreuzer 44 (der Rest: ein anderes System der Mitte zerstört, Reaktor ok). Vorher (laut Auftrag): 95 / 71 / 41 / 42 von 200 zerstört.
- **Überlebensquote der Lerche (Gegner gespawnt von 100, Crew 2 / Crew 3):** Fregatte **87 / 95**, Kreuzer **76 / 84**. D (nachher, laut Baseline): Fregatte 87 / 95, Kreuzer 76 / 84. **Identisch**: N1 verändert die Überlebensquote nicht (die Bots feuern in diesen Läufen kaum Vollladungen auf Fregatte/Kreuzer, siehe Messung 2).
- **Abnahme 7:** Lerche-Gegenrichtung siehe Messung 5. Kein Gegner fällt in einem Zug nach Schildbruch: Erstschaden → erster Systemschaden Median 1,2 s (Korvette bis Kreuzer), Reaktor zerstört frühestens 6,7 s (Korvette), 7,2 s (Fregatte), 7,3 s (Kreuzer) nach "Zone offen"; Jäger siehe oben.
- Keine Softlocks, keine Abbrüche; alle Exit-Codes 0.

## Messung 1 und 5: Lerche-Seite (`sys01-gegnerfeuer`, Zweitmessung)

Befehl: `node tools/sys01-gegnerfeuer.js --kinds korvette,fregatte,kreuzer --crews 2,3 --seeds 20 --seed0 1` (120 s, Schild Standard [4,4,0,4], Lerche steht und wehrt sich nicht). **Exit 0.** Median s ab 1. Treffer (min–max, n/20). Rohwerte nachgemessen mit einer Kopie des Werkzeugs (`C:\tmp\sys03-n1\gf-roh.js`, nur eine zusätzliche Ausgabezeile; `gf-roh.txt`, Exit 0, dieselben Zahlen).

| Klasse | Crew | Sektor 0 (tSh0All) | Zone leer (tZone) | Reaktor beschädigt | Reaktor zerstört | Zone leer → Reaktor zerstört (tZoneRt) | kleinster Rohwert tZoneRt |
|---|---|---|---|---|---|---|---|
| korvette | 2 | 4,9 (0–42,9, 16/20) | 51,4 (19,3–97, 5/20) | 67 (24,2–67, 2/20) | 74 (70,4–74, 2/20) | 51,1 (42,8–51,1, 2/20) | 42,800 |
| korvette | 3 | 4,9 (0–10,3, 16/20) | 37 (17,2–52,7, 9/20) | 52,6 (21–79,1, 9/20) | 68,4 (27,7–89,7, 9/20) | 21,2 (10,5–47,7, 9/20) | 10,500 |
| fregatte | 2 | 0,8 (0–30,7, 18/20) | 60,4 (0,6–104, 12/20) | 50 (8,9–104,6, 7/20) | 77 (56,2–95,2, 5/20) | 47 (27–77,2, 5/20) | 27,000 |
| fregatte | 3 | 0,2 (0–10,4, 19/20) | 26,5 (7,3–52,8, 17/20) | 37,3 (8,9–74,1, 17/20) | 44,2 (16,2–90, 17/20) | 21,2 (8,3–42,4, 17/20) | 8,267 |
| kreuzer | 2 | 0 (0–5, 19/20) | 30 (6,8–88,9, 15/20) | 36,2 (7,2–107,5, 13/20) | 43,2 (13,4–90, 10/20) | 30,1 (6,1–67,7, 10/20) | **6,133** |
| kreuzer | 3 | 0 (0–5,3, 19/20) | 18,7 (7,2–57,7, 18/20) | 22,6 (9,4–85,7, 18/20) | 39,3 (16,7–93,4, 18/20) | 15,9 (8,8–47,7, 18/20) | 8,833 |

Gegenrichtung Lerche (Abnahme 7), Fregatte/Kreuzer (Median s ab 1. Treffer; Reaktor n von 20 in 120 s):

| Klasse | Crew | bis Sektor 0 | bis Reaktor zerstört |
|---|---|---|---|
| fregatte | 2 | 0,8 | 77 (5/20) |
| fregatte | 3 | 0,2 | 44,2 (17/20) |
| kreuzer | 2 | 0 | 43,2 (10/20) |
| kreuzer | 3 | 0 | 39,3 (18/20) |

Vergleich mit D (nachher): alle Zellen gleich (N1 ändert die Lerche-Seite nicht, wie erwartet). Auffälligkeit: Sektor 0 liegt bei Fregatte/Kreuzer im Median unter 1 s (bekannt, D "ehrliche Größe tSh0All"). Der Reaktor der wehrlosen Lerche fällt weiterhin in 2 bis 18 von 20 Läufen (Worst Case ohne Gegenwehr und Reparatur).

## Messung 2 und 4: Gegner-Seite und Überlebensquote (`sys01-lauf`)

Befehl: `node tools/sys01-lauf.js --kinds raider,korvette,fregatte,kreuzer --crews 2,3 --seeds 20 --jobs 4` (Seeds 1–20, 5 Wellen à 1 Gegner, Pilot maneuver, wave-limit 600 s, Standardwerte wie in D). Ausgabe `C:\tmp\sys03-n1\lauf.txt`, **Exit 0**. Ein zweiter, identischer Lauf mit passivem Zähler (`lauf2.txt`, Exit 0) lieferte **byteidentische** Tabellen: der Lauf ist deterministisch, der Zähler stört nicht.

**Überlebensquote** (Definition wie D: Spalte n der Bot-Läufe = Anzahl gespawnter Gegner von höchstens 100; weniger heißt, die Lerche fiel vorher; "zerstört" = davon vom Team zerstört). Als Vorher-Wert steht der D-nachher-Wert aus der Baseline; auf a3de2ec wurde nicht nachgemessen.

| Klasse | Crew | D (nachher) gespawnt | N1 gespawnt | N1 zerstört | Lerche-Reaktorausfälle je Lauf (N1) |
|---|---|---|---|---|---|
| fregatte | 2 | 87 | **87** | 80 | 0,9 |
| fregatte | 3 | 95 | **95** | 93 | 0,2 |
| kreuzer | 2 | 76 | **76** | 64 | 0,9 |
| kreuzer | 3 | 84 | **84** | 77 | 0,3 |

(Korvette 98/98 gespawnt, Jäger 100/100.)

**Gegner-Seite: Zone offen → Reaktor zerstört** (Median s, min–max, n; "Zone offen" = erste Seitenzone ohne lebendes System):

| Klasse | Crew | D nachher (Median) | N1 | Spawn → Reaktor zerstört (N1) | Spawn → Tod N1 (D nachher) |
|---|---|---|---|---|---|
| raider | 2 | 20 | 21,6 (**−5,2**–106,7, 99) | 57,6 | 77,6 (69,9) |
| raider | 3 | 17,6 | 21,1 (**−5,2**–155,3, 100) | 54,1 | 74,1 (69,1) |
| korvette | 2 | 7,8 (6,7–128,9) | 7,8 (**6,7**–128,9, 97) | 24,1 | 44,1 (44,1) |
| korvette | 3 | 7,8 (7,2–93,7) | 7,8 (**7,2**–93,7, 97) | 21,8 | 41,8 (41,8) |
| fregatte | 2 | 29,1 (7,3–91,4) | 29,1 (**7,3**–91,4, 80) | 54 | 74 (74) |
| fregatte | 3 | 19,8 (7,2–107,7) | 19,8 (**7,2**–107,7, 93) | 50,1 | 70,1 (70,1) |
| kreuzer | 2 | 27,6 (7,4–184,7) | 27,6 (**7,4**–184,7, 66) | 64,2 | 82 (82) |
| kreuzer | 3 | 17,6 (7,3–172,5) | 17,6 (**7,3**–172,5, 77) | 53,8 | 73,8 (73,8) |

Außer dem Jäger sind alle Zellen identisch mit D. Beim Jäger steigt Spawn → Tod um 5 bis 8 s (Schaden → Reaktor zerstört vorher 47,6 / 46,6 s, jetzt 56,1 / 52,4 s): die N1-Wirkung (die Lanze zerstört den Reaktor des Jägers nicht mehr in einem Schuss).

**Vollladungen und Torpedos in den Läufen** (passiver Zähler `C:\tmp\sys03-n1\ursache.js`, umhüllt `gegnersystem.treffen/durchschlagAuf` und `gegnertod.sofort`, ändert nichts; Ausgabe `ursache.jsonl`, beide Crews zusammen, 738 Gegner):

| Klasse | Gegner | Treffer mit Vollladung (Gegner mit mindestens 1) | Torpedo-Treffer / Durchschlag / Sofort-Tod |
|---|---|---|---|
| raider | 200 | 187 (149) | 0 / 0 / 0 |
| korvette | 196 | 0 (0) | 0 / 0 / 0 |
| fregatte | 182 | 3 (3) | 0 / 0 / 0 |
| kreuzer | 160 | 3 (3) | 0 / 0 / 0 |

Die Bots schießen keine Torpedos. Vollladungen fallen praktisch nur beim Jäger, bei der Korvette gar nicht, bei Fregatte/Kreuzer dreimal. Darum ändert N1 an der Überlebensquote nichts und an den Mindestwerten von Korvette, Fregatte, Kreuzer ebenfalls nichts.

**Ursache der Jäger-Werte unter 6,1 s** (zweiter Lauf, nur Jäger, erweiterter Zähler `ursache2.js`: `NODE_OPTIONS=--require C:/tmp/sys03-n1/ursache2.js node tools/sys01-lauf.js --kinds raider --crews 2,3 --seeds 20 --jobs 4`, Exit 0, `lauf-raider.txt`, `ursache2.jsonl`; Reaktor-Zustandswechsel je Aufruf protokolliert):
- Reaktor zerstört durch normalen Treffer 169, durch Lanze-Vollladung 30 (von 199).
- Alle 13 Fälle unter 6,1 s haben mindestens eine Vollladung und keinen Torpedo. Muster: Die Vollladung macht den Reaktor beschädigt (z. B. 0,7 s nach Spawn oder bei 30 s), später öffnet sich die Zone, und ein normaler Treffer (oder die zweite Vollladung nach 41 s) zerstört den Reaktor 1 bis 6 s nach "Zone leer". Der Fall −5,2: zwei Vollladungen bei 0,7 s und 41,6 s, die Zone öffnete sich erst 5 s später.
- Abstand Stufe 1 → Stufe 2 am Reaktor über alle 200 Jäger: kleinster 6,07 s, Median 12,6 s. Das Fenster von 6 s wird eingehalten.
- Jäger ohne jede Vollladung (51 Paare): kleinster Wert Zone leer → Reaktor zerstört 7,2 s, Median 24,9 s.
- Crew 2 und Crew 3 stimmen bei einzelnen Seeds überein (z. B. −5,2 s zweimal); n pro Crew ist nicht ganz unabhängig.

## Messung 3: Ein-Schuss-Probe Lanze

Skript `C:\tmp\sys03-n1\probe.js` (Scratch): je Klasse 200 frisch gespawnte Gegner (eigenes Spiel je Schuss, Seeds 1000–1199), ein Aufruf `space.damageEnemy(g, e, 12, x, y, { pierce, durchschlag: 'zone', vollladung: true, angriff: true })` von vorn; einmal mit Schild 0, einmal mit vollem Schild. **Exit 0.**

| Klasse | Reaktor zerstört | Reaktor beschädigt | Reaktor ok (anderes System der Mitte zerstört) | Countdown gestartet |
|---|---|---|---|---|
| raider | 0 | 96 | 104 | 0 |
| korvette | 0 | 72 | 128 | 0 |
| fregatte | 0 | 39 | 161 | 0 |
| kreuzer | 0 | 44 | 156 | 0 |

Schild 0 und voller Schild liefern dieselben Zahlen (die Vollladung durchschlägt den Schild). Außerdem `node tools/test-direkttreffer-gegner.js` auf diesem Stand: **1003/1003 ok, Exit 0** (enthält eine 200er-Statistik mit 7 s Zeitvorlauf je Schuss und die Fenster-Prüfungen), Ausgabe `test-dtg.txt`. Nicht selbst geprüft: `fireLance` mit Ladung 1 als eigener Weg (nur über diesen Test abgedeckt).

## Was nicht oder nur eingeschränkt messbar war

- Die Ursachentrennung Torpedo / Vollladung / normaler Treffer gibt das Werkzeug nicht her. Ich habe sie mit einem passiven Zähler im Scratch-Ordner gelöst (Gegenprobe: byteidentische Tabellen mit und ohne Zähler). Torpedos kommen in den Bot-Läufen nicht vor; die Ausnahme der Torpedos vom Fenster wurde hier nicht belastet.
- Die erste Zählung (`ursache.js`) erkannte die Ursache der Reaktorzerstörung nicht (der Countdown wird erst nach dem Treffer-Aufruf gesetzt). Maßgeblich ist der zweite Lauf (`ursache2.js`, nur Jäger). Für Korvette/Fregatte/Kreuzer wurde die Ursache nicht einzeln aufgeschlüsselt: dort gibt es insgesamt nur 6 Vollladungstreffer, keinen Torpedo, und alle Werte liegen bei 6,7 s oder mehr.
- Messung 1 kennt weder Torpedos noch Vollladungen (Gegner feuern Bolzen, Ladeschuss, Sperrfeuer).
- Zeitauflösung: ein Tick = 1/30 s; Anzeigewerte auf 0,1 s gerundet.

## Nachtrag Entwicklungsleiter (Stand `97471ec`, nur Kommentar gegenüber `f3440d9`)

**Prüfstand** (nacheinander, ohne Parallellast, echte Exit-Codes): `npm test` **EXIT=0** (25 min 47 s, enthält `sim-sund --weg beide --crew 3`, `sim-sund --kapitel alle --crew 3` je `SIM SUND OK`, Kette `SIM KETTE OK (Quote)`), `npm run check` **EXIT=0**, `npm run snap:mess` **EXIT=0** (Worst Case 11 800 B, Ziel ≤ 18 944 B).

**Arena `maneuver`, Crew 3** (`node tools/sim-headless.js arena --pilot maneuver --seeds 8 --players 3`), Gegenlauf auf `a3de2ec` in eigenem Worktree:

| Stand | Wellen je Seed 1–8 | Mittel Wellen | Hüllenverlust | Dauer | Softlocks | Exit |
|---|---|---|---|---|---|---|
| `a3de2ec` (vor N1) | 5 6 6 5 2 5 4 5 | 4,8 | 43,3 | 877 s | 0 | 0 |
| `97471ec` (N1) | 3 2 6 5 5 5 5 5 | 4,5 | 37 | 903 s | 0 | 0 |

N1 verschiebt den Verlauf (Jäger fallen nicht mehr durch einen Lanzenschuss, Wellen mit Jägern dauern länger, Seed 2 viermal über 180 s). Seed 1/2 schlechter, Seed 5/7 besser; 0 Softlocks. Abnahme 9 (0 Softlocks) bleibt erfüllt; ob die Jägerwellen nun zu zäh sind, beurteilt der Spieltest.

**Solo** (`node tools/sys01-lauf.js --kinds fregatte,kreuzer --crews 1 --seeds 20 --jobs 4`, Exit 0): Kreuzer 52 gespawnt / 34 zerstört (D: 52 / 34), Fregatte 76 / 63 (D: 76 / 64). Solo-Kreuzer weiter schaffbar (Spawn → Tod Median 110 s).

**Bewertung Abnahme 6 (Leiter):** Lerche-Seite und Korvette/Fregatte/Kreuzer erfüllt. Jäger: Messgröße „Zone leer → Reaktor zerstört“ in 13 von 199 Fällen unter 6,1 s, weil die Vollladung als Durchschlagwaffe die Mitte erreicht, bevor eine Seitenzone leer ist. Das Reaktor-Fenster selbst hält (kleinster Abstand beschädigt → zerstört 6,07 s bei Fenster 6,0 s). Kein Ein-Schuss-Tod mehr.
