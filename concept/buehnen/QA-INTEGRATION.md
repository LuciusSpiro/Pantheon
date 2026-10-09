# QA-INTEGRATION (Welle 3) – Golden-Neuaufnahme, Kontext-Goldens, Messungen, Browser-Regression

Stand 2026-10-09, ruhige Phase (keine fremden Node-Prozesse außer Demo/Spielinstanz im Leerlauf, Ports 3395–3399 frei).
Testserver nur Port 3395, `ROOM_CODE=off`, `WORLD_DIR=data/worlds-qa-int`, `REGIE_DIR=data/regie-qa-int`, `--debug`, mit
Mess-Preload (zählt `Buehne.bauen` im/außerhalb des Ticks und misst Tickzeiten), am Ende beendet, Datenordner gelöscht.
Skripte: `C:\tmp\pwtest\sts\b-qa-int-{prefetch,regress,probe}.js`. Screenshots: `shots/qa-int/` (35 Bilder).
Geändert habe ich nur: `tools/fixtures/golden/base/**` (Neuaufnahme) und dieses Dokument. Keine Commits.

## Ergebnis kurz

| # | Auftrag | Ergebnis |
|---|---|---|
| 1 | Golden-Neuaufnahme | **erledigt.** Vorprüfung wie erwartet, `base` neu aufgenommen, danach **120/120 byte-identisch, GOLDEN GRÜN** |
| 2 | Kontext-Goldens `--update` | **ausgeführt, aber ohne Wirkung:** Die Dateien im Arbeitsbaum waren schon erneuert (byte-gleich vor/nach). Diff gegen HEAD angesehen (siehe §2) |
| 3 | Messungen | alle Budgets **eingehalten**; Snapshot knapp (max 12 820 B) |
| 4 | Browser-Regression 4 Kartenarten | **bestanden**, 0 Konsolenfehler, 0 Serverfehler; ein kleiner Client-Fund (F-QA1) |

## 1. Golden-Neuaufnahme

Vorher: `base` und `base-s2b` inhaltsgleich (`diff -rq` leer) – die Kopie `base-s2b` existiert. **Achtung:** `base-s2b/` und
`allow-b2.json` sind im Git **nicht eingecheckt** (`??`); beim Commit der neuen `base` mitnehmen.

Lauf: `node tools/golden-trace.js --all --seeds 20 --jobs 8` (Waffen an, ohne Schalter), 59 s, 0 Prozessfehler.

| Mission/Crew | erledigt | Softlock | Schrittfolgen | Median s (base-s2b → neu) | Vergleich mit `base-s2b` |
|---|---|---|---|---|---|
| m1/1, m1/3 | 40/40 | 0 | 1 | 441,2 / 433,2 (gleich) | **inhaltlich byte-gleich** 40/40 (nur CRLF der ausgecheckten Dateien; Git sieht m1 unverändert) |
| m2/1, m2/3 | 40/40 | 0 | 1 | 603,4 / 474,3 (gleich) | 40/40 weichen **nur** in einer Zeile ab: „Graue Weite … Erreichbar über B-7 ~~, die Vaelen-Karawane oder das Wrack~~ oder die Vaelen-Karawane.“ (F3) |
| m3/1 | 20/20 | 0 (auch Seed 12) | 1 | 212,7 → 197,9 (−7 %) | nur Schrittzeiten (allow-b2 `duration`), keine Text-/Flag-/Inventarbefunde |
| m3/3 | 20/20 | 0 | 1 | 193,9 → 173,8 (−10,4 %) | wie m3/1 |

`--compare base-s2b neu --allow allow-b2.json`: „GOLDEN ROT (40 Befunde)“ – alle 40 sind die F3-Zeile in m2 (nicht in
allow-b2, bewusst). Nichts anderes weicht ab → aufgenommen nach `tools/fixtures/golden/base`.
Danach `--compare base <unabhängiger erster Lauf>`: **120/120 Traces byte-identisch, GOLDEN GRÜN** (zugleich Determinismusbeleg).
Git: 80 Dateien in `base` geändert (m2 + m3), m1 unverändert.

## 2. Kontext-Goldens des Spielleiters

`node tools/test-spielleiter.js --strict` vorher: **156 ok, 0 Fehler, 0 übersprungen** – die Goldens passten bereits.
`--update` (155 ok, schreibt Kontext-Goldens, `erwartet`, Buch-Hashes): **alle Dateien danach byte-gleich zur Sicherung
vorher.** Die bewusste Erneuerung steckt also schon unkommittiert im Arbeitsbaum (wer sie geschrieben hat, sehe ich nicht).
Angesehen habe ich deshalb den Diff gegen HEAD (`80b4c8f`, S2b):

| Kontext | Zeichen HEAD → jetzt | Tokens (2,5 Z/Token) | Grobplan-Kontext ohne `verfuegbar` (T13) |
|---|---|---|---|
| frisch | 21 471 → 32 103 | 8 588 → 12 841 (+4 253) | 1 150 → 2 886 (+1 736) |
| nach-m1 | 22 411 → 33 043 | 8 964 → 13 217 (+4 253) | 1 527 → 3 263 (+1 736) |
| mitten-m2 | 22 754 → 33 386 | 9 102 → 13 354 (+4 253) | 1 658 → 3 394 (+1 736) |
| ohne-tutorial | 21 664 → 32 112 | 8 666 → 12 845 (+4 179) | 1 226 → 2 889 (+1 662) |
| nach-tutorial | 24 340 → 34 788 | 9 736 → 13 915 (+4 179) | 2 280 → 3 943 (+1 662) |

Art der Änderungen (in allen 5 gleich, rein additiv, nichts entfernt):
- neu: `bodenbilanz` (52 Z), `fraktionen` (636 Z), `gegner` (287 Z), `kartenarten` (1 090 Z), `rollen_gesehen` (leer).
- geändert: `orte` (+2 014 bzw. +2 198 Z, Landepunkte je Ort) und `verfuegbar` (+6 295 Z, Katalog mit B1-Umsetzungen).
- Ziel „Kontext wächst ≤ 2k Tokens“ (gemessen ohne `verfuegbar`, wie im Prompt): **+1 662 bis +1 736 → eingehalten.**
  Mit `verfuegbar` wächst das Kontextobjekt um ≈ +4,2k Tokens. Szenen-Prompt max ≈ 4 036 Tokens (Ziel < 8k).
- Buch-Hashes: `grobplan/melk-klausel.sonnet` und `.haiku` neue Hashes, `.haiku` zusätzlich Prüfercode `REF-BEREICH`.
- Aufzeichnung `grobplan/69741722…`: `erwartet` verliert den Fehler „`fund_aus_gewoelbe` setzt `raetsel_loesen/zwei_schluessel`
  voraus“ – passt zur KATALOG-Änderung in `artefakt_freilegen.json` (Voraussetzung entfernt). Bitte KATALOG/SPIELLEITER kurz
  bestätigen lassen, dass das gewollt ist.

## 3. Messungen (ruhige Phase)

### 3.1 Snapshot Außenposten, 3 Spieler, 12 Gegner, 2 Granaten (Budget 13 KB)
Nachbau des Aufbaus aus `test-combat` (rostmeute groß/wach, auf 12 aufgefüllt, 4 Niederhalter, zwei Gegner werfen alle
0,5 s Granaten → in allen Proben ≥ 2 Granaten in der Luft), 20 s je Lauf, Snapshot in **jedem** Tick gemessen.

| Lauf | Landepunkt | Spiel-Seed | max B | Median B |
|---|---|---|---|---|
| 1 | kesh.grabung | 4 | 12 554 | 10 781 |
| 2 | splitter.schuerflager | 5 | 12 315 | 10 545 |
| 3 | kesh.grabung | 6 | 12 590 | 10 778 |
| 4 | splitter.schuerflager | 7 | 12 458 | 10 547 |
| 5 | kesh.grabung | 8 | 12 820 | 10 782 |
| **Median** | | | **12 554** | 10 778 |

`test-combat` (Probe alle 15 Ticks): 12 536 B. **Eingehalten, aber knapp:** max 12 820 B = 492 B unter 13 312 B
(`13 * 1024`, test-combat/sim) bzw. nur **180 B unter 13 000 B** (Grenze in `test-bausteine`). Die beiden Tests definieren
„13 KB“ unterschiedlich – Studioleitung sollte eine Grenze festlegen. Weiteres Wachstum im Snapshot nur mit Abbau (Altfelder,
OFFEN-STUDIO).

### 3.2 `awayMap` je Kartenart, 20 Seeds (Budget 10 KB = 10 240 B)
Größe der kompletten Nachricht (`{t, kind}` + `awayMapPayload`). Deterministisch – drei Läufe ergeben dieselben Zahlen.

| Kartenart | min B | Median B | max B |
|---|---|---|---|
| Außenposten | 7 207 | 7 758 | **8 576** |
| Raumstation | 4 368 | 4 468 | 4 753 |
| Ruine (rom, verfallen) | 7 292 | 7 554 | 7 697 |
| Schiff (2 Decks) | 5 106 | 5 449 | 5 660 |

### 3.3 Server-Tick und Bauzeit

| Messung | Ergebnis | Ziel |
|---|---|---|
| Tick Bodenkampf headless (Aufbau 3.1, 5 Läufe × 600 Ticks) | Median 0,147–0,163 ms (Median 0,152 ms), p95 0,45–0,62 ms, max 12,7–15,1 ms | 33 ms (30 Hz) |
| Tick live (Server 3395, 1 Spieler + 1–2 Gegner, je Kartenart) | Median 0,33–0,37 ms, p99 1,6–1,8 ms, max 7,6–10,1 ms | 33 ms |
| Bau im Tick | **0** (headless 3 000 Ticks: 0 Bauten; live alle 12 `Buehne.bauen` mit `imTick=false`: Testgelände-Karte beim Start, `kesh.kastell`/`kesh.grabung` per Vorbau bei Ankunft) | 0 |
| `vorwaermen` | 99 ms (einmal je Prozess) | – |

Bauzeit `verfallen` im Spielmodus (`landepunkte.get`, frischer Seed je Bau = Cache-Fehlschlag, vorgewärmt), 3 Läufe × 20 Seeds:

| Kartenart | Median Lauf 1/2/3 (ms) | **Median** | p90 | max |
|---|---|---|---|---|
| Außenposten | 9,4 / 10,1 / 9,5 | **9,5** | 11,3–14,2 | 22,3 |
| Raumstation | 3,6 / 3,6 / 3,5 | **3,6** | 4,5–5,7 | 6,2 |
| Ruine | 6,5 / 6,9 / 6,8 | **6,8** | 8,7–13,6 | 18,1 |
| Schiff | 3,1 / 2,5 / 2,6 | **2,6** | 3,2–4,6 | 5,2 |

Alle weit unter 50 ms.

### 3.4 Kalter Kartenbau im Browser: Prefetch Transferkammer vs. Direktstart
Außenposten (germanen/rostmeute), Seeds 5/6/7, je Lauf frischer Browser und frischer Server. Headless Chromium.

| Modus | buildMs (3 Läufe) | **Median** | ladeMs Median | HTTP-Anfragen während des Baus |
|---|---|---|---|---|
| Direktstart `?arena=away` | 1 169 / 1 243 / 1 191 | **1 191** | 571 | 24–31 |
| Kampagne, Transferkammer betreten, dann Bühne | 963 / 1 000 / 1 090 | **1 000** | 411 | 31 (21 Modelle) |
| Kampagne, Bühne ≈ 2 s nach Start (ohne Transferkammer) | 1 018 / 1 066 / 1 023 | **1 023** | 431 | 49–54 (39–43 Modelle) |

- **Der Prefetch greift** (Kit-Teile/Props kommen aus dem Cache, Modellanfragen 43 → 21), **bringt aber wenig**: −2 % gegenüber
  „ohne Transferkammer“, −16 % gegenüber dem Direktstart. Beim Betreten der Transferkammer war er jeweils **schon fertig**
  (`prefetch()` antwortet nach 0–1 ms) – der Leerlauf-Prefetch aus `kit.js` beim Start hat ihn erledigt; der Auslöser in
  `client.js` ist damit redundant (schadet nicht).
- Was er nicht abdeckt: Figuren (`fig/crew/*`, `fig/basis/*`), Waffen (`item/waffe/{germanen,neutral,rom,rostmeute}/blaster`
  – vier Varianten werden nacheinander probiert), Paletten, Mood. Das ist jetzt der Rest der Ladezeit.
- Alle Werte **unter dem Budget 1,5 s** (Außenposten). Die früheren 1,4–5,9 s stammen aus der Lastphase.
- Andere Kartenarten (aus 4): Station 1 032–1 051 ms, Ruine 1 100–1 113 ms, **Schiff 1 536–1 565 ms** (Direktstart, kalt).
  Das Schiff liegt knapp über 1,5 s; das Budget im Vertrag nennt nur den Außenposten.

### 3.5 Laufzeiten Tests

| Befehl | Lauf 1 / 2 / 3 | Median | Ziel / Ergebnis |
|---|---|---|---|
| `node tools/test-spielleiter.js --strict` | 2,33 / 2,31 / 2,30 s | **2,3 s** | Ziel 20 s – erfüllt (unter Last waren es 44 s) |
| `npm test` (14 Suiten) | 23,5 / 23,0 / 23,0 s | **23,0 s** | grün in allen 3 Läufen |
| `npm run check` | 4,2 s | – | check-maps 576/576, check-sektoren 199/199 |

`npm test` Einzelergebnisse: features 213/213, combat 345/345, m3 380/380, flight 78/78, escort 84/84, bausteine 138/138,
regiebuch 166/166, weltstand 164/164, spielleiter 156/0/0, ablage 23/23, buehne 380/380, waffen 132/132, sektoren 77/77,
entern 66/66.

## 4. Browser-Regression je Kartenart

Ablauf je Karte (`b-qa-int-regress.js`): Direktstart Testgelände, `god on`, Umsehen mit echten Tasten WASD, nächste Tür im
Zustand `zu` ansteuern, **E (echte Taste) 2,2 s halten**, Gegner `grundtyp`/rostmeute per `debug gegner` 4–6 Kacheln entfernt,
Blaster mit echter Maus (Zielen über `Render.worldToScreen`), dann zweiter Gegner und Granatwerfer: Zeiger aufs Ziel →
Zielvorschau, Klick, bis 3 Nachwürfe.

| Kartenart (Seed) | Kit-Bau | Tür/Schott mit E | Blaster | Granate + Zielvorschau | Konsole / Server |
|---|---|---|---|---|---|
| Außenposten (5) | 1 168 ms | `tor.tuer` „E halten: Tor öffnen“ zu → **offen** | 4 Schuss → Gegner verwundet | Vorschauring sichtbar (4,2 Kacheln), Treffer Schild 3 → 2 | 0 / 0 |
| Station (5) | 1 051 ms | `andock~kreuz` „E halten: Schott öffnen“ zu → **offen** | 10 Schuss → verwundet | Ring 4,0 Kacheln (Lauf 2; im Endlauf nicht abgefragt), Schild 3 → 0 | 0 / 0 |
| Ruine (4) | 1 100 ms | `cloaca.tuer` „E halten: Luke öffnen“ zu → **offen** | 4 Schuss → verwundet | Ring 4,0 (geklemmt), Schild 3 → 1 | 0 / 0 |
| Schiff (5) | 1 565 ms | `antrieb.tuer` „E halten: Luke öffnen“ zu → **offen** | 9 Schuss → verwundet | Ring 4,0 (geklemmt), Schild 3 → 1 | 0 / 0 |

Ruine Seed 5 hat als einzige `zu`-Tür das Tor am `innerstes` (Rätselpaar, kein Weg vom Start) – deshalb Seed 4.
Screenshots je Karte: `01-ankunft`, `02-umsehen`, `03-vor-tuer`, `04-tuer-offen`, `05-blaster`, `06-granate-zielvorschau`,
`07-granate-flug`, `08-nach-kampf`; dazu `prefetch-*-aussenposten.png`.

Einschränkungen (ehrlich):
- Waffenwechsel per Debug `waffe`, nicht an der Transfer-Konsole; Gegner per Debug gesetzt; Wege zur Tür/zum Gegner per
  Eingabenachricht (`input`) wie in `b-client-lib.js`. E, WASD und Maus sind echte Eingaben.
- Headless Chromium rendert in Software: **6–22 FPS**. Über die Bildrate im Spiel sagt dieser Lauf nichts aus.
- Gegner gehen in Deckung; auf der Station brauchte der Blaster deshalb 10–25 Schuss (Zielen nach dem Nachlaufen erst, wenn die
  Kamera steht). Kein Fehler im Spiel.

## Funde

**F-QA1 (klein, CLIENT `public/js/client.js:1271`): falscher E-Hinweis am Anker `eingang` (art technisch).**
Der Client zeigt dort immer „E halten: Schott hacken (6 s)“ – auch wenn die Kante eine **Luke** ist und auch, wenn sie
**schon offen** ist. Der Server bietet dann nichts an (`server/sim/anker.js:155–160` prüft Typ `schott`/`luke` und Zustand
`zu`/`verschlossen`, Luke = `op: 'luke'` mit eigener Zeit). Gesehen nach dem Öffnen von `antrieb.tuer` (Schiff) und
`cloaca.tuer` (Ruine): `schiff-04-tuer-offen.png`, `ruine-04-tuer-offen.png`. In der römischen Ruine liest sich „Schott“
zusätzlich falsch. Lösung: Hinweis wie der Server ableiten (Kanten am Anker, nur bei `zu`/`verschlossen`, Luke → „Luke öffnen“).

**F-QA2 (Info, VOXEL/CLIENT): Prefetch deckt Figuren und Waffen nicht ab** (siehe 3.4). Der Transferkammer-Auslöser kommt
regelmäßig nach dem Leerlauf-Prefetch und tut nichts mehr. Wenn die Ladezeit weiter runter soll: `fig/*`, `item/waffe/*` und
Paletten mit vorladen; die Waffen-Fallback-Kette (vier Varianten je Waffe) prüfen.

**F-QA3 (Info, Studioleitung): Snapshot-Grenze uneinheitlich** (`13 * 1024` vs. `13000`), Spielraum 180–492 B.

**F-QA4 (Info): `tools/fixtures/golden/base-s2b/` und `allow-b2.json` sind nicht eingecheckt.**

## Wünsche an fremde Dateien (nicht selbst geändert)
- CLIENT: F-QA1.
- VOXEL: F-QA2 (Prefetch erweitern), Schiff-Kaltbau ≈ 1,55 s ansehen.
- Studioleitung: eine Snapshot-Grenze festlegen; `base-s2b`, `allow-b2.json` und die neue `base` gemeinsam committen;
  KATALOG/SPIELLEITER: Wegfall der Voraussetzung `raetsel_loesen/zwei_schluessel` für `fund_aus_gewoelbe` bestätigen.

## Nachtrag: Gegner-KI BODENKAMPF (`squad.js`, kein Stapeln am letzten Spielerpunkt)

Neuer Lauf (20 Seeds × Crew 1/3) gegen die `base` aus §1:

| Mission/Crew | erledigt | Softlock | Schrittfolgen | Median s (base → neu) | Vergleich |
|---|---|---|---|---|---|
| m1, m2 | 80/80 | 0 | 1 | unverändert | 80/80 byte-gleich |
| m3/1 | 20/20 | 0 | 1 | 197,9 → 171,2 (−13,5 %) | 32/40 m3-Spuren anders, alle mit **gleicher Schrittfolge**, alle erfolgreich |
| m3/3 | 20/20 | 0 | 1 | 173,8 → 178,1 (+2,5 %) | wie m3/1 |

Bewertung der 39 Befunde ohne Allow-Liste. **Alle folgen aus anderen Kampfverläufen, keiner ist ein Fehler:**
- **Flags:** nur `wardenKilled` (4× neu gesetzt, 3× weggefallen). Der Wächterkampf ist optional.
- **Inventar:** dazu genau passend `marks` ±60 und `deko` ± `lamassu_figur`, also die Wächterbeute. Außerdem `medipack` ±1–2
  (je nachdem, wer verwundet wird und wer aufhilft).
- **Texte:** Verwundet/Aufhelfen/Notrückholung, „Plünderer/Drohne erledigt“, der Wächter-Beutetext, der Pads-Hinweis, der
  Captain-Reiter-Hinweis und der Schlüssel-Hinweis. Das sind ODA-Meldungen, die vom Kampfverlauf abhängen.
- Alles liegt in den Kategorien von `allow-b2.json`. Mit `--allow allow-b2.json`: **GOLDEN GRÜN**.
- Keine Mission endet anders als erlaubt: 120/120 erfolgreich, 0 Softlocks.

→ Alte `base` gesichert als `tools/fixtures/golden/base-b1fix` (inhaltsgleich geprüft), `base` neu aufgenommen,
Gegenvergleich mit dem unabhängigen Lauf: **120/120 byte-identisch, GOLDEN GRÜN**. `base-b1fix/` ist wie `base-s2b/` nicht
eingecheckt.

Snapshot neu (Aufbau 3.1, 5 Läufe): max 12 666 / 12 315 / 12 590 / 12 458 / **12 821 B**, Median der Maxima **12 590 B**
(vorher 12 554). Unverändert knapp unter 13 KB; 0 Bauten im Tick, 0 Serverfehler; Tick-Median 0,16–0,6 ms.
