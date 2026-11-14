# Fixtures der Klumpen-Messung (`tools/mess-klumpen.js`)

Gespeicherte Ausgaben echter Messläufe. **Kein Test prüft diese Dateien**, sie sind Vergleichswerte zum Nachschlagen (Befehl steht jeweils in der ersten Zeile der Datei bzw. im Kopf von `mess-klumpen.js`).

| Datei | Stand | Gilt heute? |
|---|---|---|
| `endkampf-…`, `graben-…` (ohne Präfix) | BOD-01 (2026-10-31), Ausgangswerte vor der Trupp-Taktik | nein, überholt |
| `bod02-p5-…`, `bod02-p6-…`, `bod02-p7-…` | Stand nach BOD-02 P5, P6, P7 | Endkampf ja (P6/P7 stimmen mit main überein, HYG-02: 1709 gegen 1711 Gefechtssamples, Klumpen 0,19 gegen 0,2). Graben: Stand von damals, nicht mehr vergleichbar (Welle 3 im Bunker, BOD-03) |
| `hyg02-graben-…` | **aktuelle Basis** (2026-11-14, main nach HYG-02, Messwerkzeug zählt nur Deck-0-Gegner = Welle 1+2) | ja |
| `fad01-baender.json` | gehört zu `tools/mess-invasion-baender.js`, nicht zur Klumpen-Messung | – |

Neu erzeugen (Graben, ruhig und alarmiert; je ca. 16 s):
`node tools/mess-klumpen.js graben --lauf 22 --seeds 8 --sek 120 --spieler 3 [--alarm]`

Der Endkampf braucht keine neue Basis: `bod02-p7-endkampf-3sp-12seeds-90s.txt` ist weiter die Referenz.

Die Graben-Werte der `hyg02`-Basis weichen von `bod02-p7-graben-…` ab (alarmiert: Klumpen-Anteil 0,23 gegen 0,37, nächster Kamerad 3,15 gegen 2,7 Kacheln; Paarabstand 10,3 gegen 9,4). Ursache ist nicht getrennt gemessen: Das Werkzeug zählt jetzt nur Deck 0, dazu kommen BOD-02 P8/P9 (Verteidigungsprofil) und BOD-03 seit P7. Wer Änderungen an der Boden-KI misst, vergleicht gegen `hyg02-…`, nicht gegen `bod02-p7-…`.
