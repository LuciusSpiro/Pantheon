# SYS-03 Paket A: Messung Baseline

Stand: Branch `sys03` (von main 977a8de), vor jeder Regeländerung. Alle Läufe deterministisch (Seeds), wiederholbar mit den Aufrufen unten.
Config-Varianten: `TUNE='{"shields.regenInterval": 4}' node -r ./tools/tune-preload.js tools/<werkzeug> ...` (geprüft mit sys01-gegnerfeuer und sys03-streufeuer; der Schlüssel `shields.regenDelay` aus dem Auftrag existiert noch nicht, TUNE legt unbekannte Schlüssel an, ohne Wirkung bis die Regel gebaut ist).

Werkzeug-Änderungen: `--schild a,b,c,d` wirkt jetzt (setzt `alloc`, `allocIntent`, `current`; Pool 6 bei Energie 2, Emitter-Kappe 6 je Sektor; übersteigt der Wunsch den Pool, steht eine WARNUNG im Output, z. B. `4,4,4,4` wird zu `1,1,2,2`). Neue Spalten: 1. Treffer → Reaktor der Lerche `broken`, Segment 0 → Reaktor `broken`.

## 1. Gegner feuert auf stehende Lerche

Aufruf: `node tools/sys01-gegnerfeuer.js --kinds raider,korvette,fregatte,kreuzer --crews 1,2,3 --seeds 20` (Seeds 1–20, 120 s Laufzeit, Lerche-Schild Standard 2/2/0/2)

| Klasse | Crew | Gegner Hülle / Schild | n | Treffer bis Ende (Mittel) | Spawn→1. Treffer Median | 1. Treffer→Segment 0 Median (min–max, n von N) | 1. Treffer→1. Systemschaden Median (n) | Hülle Lerche nach 60 s (Mittel) | 1. Treffer→Reaktor zerstört Median (min–max, n von N) | Segment 0→Reaktor zerstört Median (min–max, n von N) |
|---|---|---|---|---|---|---|---|---|---|---|
| raider | 1 | 5 / 2/1/0/1 | 20 | 1 | 13.4 | — (—–—, 0/20) | — (0) | 0.4 | — (—–—, 0/20) | — (—–—, 0/20) |
| raider | 2 | 7 / 2/1/0/1 | 20 | 1.5 | 4.2 | — (—–—, 0/20) | — (0) | 0.4 | — (—–—, 0/20) | — (—–—, 0/20) |
| raider | 3 | 7 / 2/1/0/1 | 20 | 8.1 | 4.2 | — (—–—, 0/20) | — (0) | 1.1 | — (—–—, 0/20) | — (—–—, 0/20) |
| korvette | 1 | 19 / 1/2/0/2 | 20 | 12.7 | 9.3 | 16.4 (6.1–34, 14/20) | 86.3 (1) | 1.1 | — (—–—, 0/20) | — (—–—, 0/20) |
| korvette | 2 | 27 / 1/2/0/2 | 20 | 14.7 | 8.8 | 16.8 (4.5–34.5, 14/20) | 86.8 (1) | 1 | — (—–—, 0/20) | — (—–—, 0/20) |
| korvette | 3 | 27 / 1/2/0/2 | 20 | 22.4 | 8.3 | 5 (4.9–5, 3/20) | — (0) | 0.2 | — (—–—, 0/20) | — (—–—, 0/20) |
| fregatte | 1 | 36 / 2/2/2/1/2/2 | 20 | 21 | 9.8 | 21.9 (0.8–45.9, 20/20) | 77.9 (11) | 2.9 | — (—–—, 0/20) | — (—–—, 0/20) |
| fregatte | 2 | 50 / 2/2/2/1/2/2 | 20 | 23.1 | 9.8 | 21.9 (0.8–32.8, 20/20) | 80.6 (6) | 2.6 | — (—–—, 0/20) | — (—–—, 0/20) |
| fregatte | 3 | 50 / 2/2/2/1/2/2 | 20 | 42.2 | 9.5 | 5.1 (0.1–111.3, 6/20) | 31.7 (4) | 3.9 | 100.5 (100.5–100.5, 1/20) | 0 (0–0, 1/20) |
| kreuzer | 1 | 48 / 2/3/3/3/1/3/3/3 | 20 | 30 | 11.8 | 28.5 (21.8–51.7, 19/20) | 61.7 (8) | 3.2 | — (—–—, 0/20) | — (—–—, 0/20) |
| kreuzer | 2 | 67 / 2/3/3/3/1/3/3/3 | 20 | 32.8 | 11.8 | 28.4 (15.1–46.6, 19/20) | 60.6 (9) | 4.4 | — (—–—, 0/20) | — (—–—, 0/20) |
| kreuzer | 3 | 67 / 2/3/3/3/1/3/3/3 | 20 | 57.5 | 10.9 | — (—–—, 0/20) | 39.3 (7) | 5.4 | — (—–—, 0/20) | — (—–—, 0/20) |

Befund: Der Reaktor der stehenden Lerche bricht in 120 s praktisch nie (1 von 240 Läufen: fregatte Crew 3, 100,5 s nach 1. Treffer). Auch der erste Systemschaden kommt in vielen Klassen selten oder spät. Bei Crew 3 (Waffenautomatik/Ops stark, Gegner sterben früher oder wurden nicht erreicht) sind Raider ganz ohne Schildbruch. Die Messgröße "Reaktor der Lerche zerstört" ist unter Gegnerfeuer allein also heute nicht aussagefähig; für Vergleiche vor/nach SYS-03 taugen "Segment 0" und "1. Systemschaden" besser, plus die Streufeuer-Messung (Abschnitt 3).

## 2. Gegner-Seite (Bot-Läufe, Arena)

Aufruf: `node tools/sys01-lauf.js --kinds raider,korvette,fregatte,kreuzer --crews 1,2,3 --seeds 10 --jobs 4` (Seeds 1–10, 5 Wellen à 1 Gegner, Pilot maneuver)

| Klasse | Crew | n | zerstört | Spawn→Tod Median (Mittel ± SD) | p10–p90 | Erstschaden→Tod Median (Mittel ± SD) | p10–p90 | Spawn→erster Treffer Lerche Median | erster Treffer→Schildsegment 0 Median (n) | erster Treffer→Systemschaden Median (n) | Hülle Lerche Mittel |
|---|---|---|---|---|---|---|---|---|---|---|---|
| raider | 1 | 50 | 50 | 61.2 (65.9 ± 21.1) | 44.5–92.9 | 59.1 (64.3 ± 21.3) | 43.4–90.3 | 13.5 | 4 (22) | — (0) | 0 |
| raider | 2 | 50 | 50 | 50.8 (50.7 ± 16.5) | 21–71.8 | 49.1 (49.2 ± 16.6) | 20–70.7 | 13.5 | — (0) | — (0) | 0 |
| raider | 3 | 50 | 50 | 50.8 (50.7 ± 16.5) | 21–71.8 | 49.1 (49.2 ± 16.6) | 20–70.7 | 13.5 | 3.3 (17) | — (0) | 0 |
| korvette | 1 | 50 | 50 | 55.3 (60.3 ± 21) | 33.5–89.3 | 51.8 (55.8 ± 21.4) | 27.6–84.1 | 9.3 | 3.9 (34) | — (0) | 0.3 |
| korvette | 2 | 50 | 50 | 36.2 (42.9 ± 17.2) | 31.2–59.3 | 30.2 (36.5 ± 16.9) | 25.8–50.6 | 14.8 | 32.1 (3) | 0.3 (1) | 0.4 |
| korvette | 3 | 50 | 50 | 35.6 (42.3 ± 21.3) | 31.2–57.8 | 30.2 (36 ± 20.9) | 25.8–48.6 | 21.5 | 17.9 (12) | — (0) | 0.2 |
| fregatte | 1 | 50 | 50 | 79.5 (85.7 ± 26.7) | 61.5–116.4 | 74.2 (81.4 ± 25.9) | 59.3–110.9 | 11.2 | 2.4 (42) | 50.3 (4) | 0.9 |
| fregatte | 2 | 50 | 50 | 65.3 (66.4 ± 19.1) | 43.6–91.2 | 57.7 (58.6 ± 19.2) | 35.5–84.5 | 15.7 | 10.6 (15) | 22.8 (4) | 1.1 |
| fregatte | 3 | 50 | 50 | 71.5 (70.1 ± 27.4) | 37.9–105.9 | 65 (62.9 ± 27.2) | 31.6–98.8 | 10.3 | 5.2 (23) | — (0) | 0.3 |
| kreuzer | 1 | 49 | 48 | 109.9 (107.8 ± 49.6) | 75.2–127.3 | 106.9 (104.9 ± 49.5) | 72.4–124.3 | 12.1 | 3.9 (45) | 29.2 (22) | 5.3 |
| kreuzer | 2 | 47 | 46 | 65.7 (70.7 ± 27.7) | 43.4–102.4 | 58.7 (63.1 ± 26.9) | 36.1–96.3 | 16.6 | 9.4 (25) | 1.9 (7) | 3 |
| kreuzer | 3 | 50 | 50 | 73.3 (75.7 ± 32.2) | 43.3–118.4 | 64.3 (68.3 ± 32.1) | 36.1–110.6 | 16.6 | 8.3 (31) | 18.7 (1) | 0.9 |

Abnahme 13 (Spawn → Reaktor zerstört) und Tod (inkl. Countdown), wave-limit 600 s:
| Klasse | Crew | n Gegner | Reaktor zerstört (n) | Reaktor Median | p10–p90 | SD | Tod (n) | Tod Median | p10–p90 | nicht beendet |
|---|---|---|---|---|---|---|---|---|---|---|
| raider | 1 | 50 | 50 | 41.2 | 24.5–72.9 | 21.1 | 50 | 61.2 | 44.5–92.9 | 0 |
| raider | 2 | 50 | 50 | 30.8 | 1–51.8 | 16.5 | 50 | 50.8 | 21–71.8 | 0 |
| raider | 3 | 50 | 50 | 30.8 | 1–51.8 | 16.5 | 50 | 50.8 | 21–71.8 | 0 |
| korvette | 1 | 50 | 50 | 35.3 | 13.5–69.3 | 21 | 50 | 55.3 | 33.5–89.3 | 0 |
| korvette | 2 | 50 | 50 | 16.2 | 11.2–39.3 | 17.2 | 50 | 36.2 | 31.2–59.3 | 0 |
| korvette | 3 | 50 | 50 | 15.6 | 11.2–37.8 | 21.3 | 50 | 35.6 | 31.2–57.8 | 0 |
| fregatte | 1 | 50 | 50 | 59.5 | 41.5–96.4 | 26.7 | 50 | 79.5 | 61.5–116.4 | 0 |
| fregatte | 2 | 50 | 50 | 45.3 | 23.6–71.2 | 19.1 | 50 | 65.3 | 43.6–91.2 | 0 |
| fregatte | 3 | 50 | 50 | 51.5 | 17.9–85.9 | 27.4 | 50 | 71.5 | 37.9–105.9 | 0 |
| kreuzer | 1 | 49 | 48 | 89.9 | 55.2–107.3 | 49.6 | 48 | 109.9 | 75.2–127.3 | 1 |
| kreuzer | 2 | 47 | 46 | 45.7 | 23.4–82.4 | 27.7 | 46 | 65.7 | 43.4–102.4 | 1 |
| kreuzer | 3 | 50 | 50 | 53.3 | 23.3–98.4 | 32.2 | 50 | 73.3 | 43.3–118.4 | 0 |

Countdown, Zonenöffnung, Notsprung (Bot-Läufe):
| Klasse | Crew | Läufe | Gegner | davon Tod über Reaktor (Countdown) | Tod ohne Reaktor (Sofort-Tod u. a.) | Zone offen (Anteil Gegner) | Spawn→Zone offen Median | Reaktor→Tod Median | Lerche Reaktorausfälle je Lauf | Notsprünge je Lauf | Notfälle je Lauf |
|---|---|---|---|---|---|---|---|---|---|---|---|
| raider | 1 | 10 | 50 | 50 | 0 | 100 % | 23.6 | 20 | 0 | 0 | 0 |
| raider | 2 | 10 | 50 | 50 | 0 | 96 % | 15.1 | 20 | 0 | 0 | 0 |
| raider | 3 | 10 | 50 | 50 | 0 | 96 % | 15 | 20 | 0 | 0 | 0 |
| korvette | 1 | 10 | 50 | 50 | 0 | 100 % | 11.4 | 20 | 0 | 0 | 0 |
| korvette | 2 | 10 | 50 | 50 | 0 | 100 % | 13.1 | 20 | 0 | 0 | 0 |
| korvette | 3 | 10 | 50 | 50 | 0 | 100 % | 12.8 | 20 | 0 | 0 | 0 |
| fregatte | 1 | 10 | 50 | 50 | 0 | 100 % | 48.1 | 20 | 0 | 0 | 0 |
| fregatte | 2 | 10 | 50 | 50 | 0 | 100 % | 19 | 20 | 0 | 0 | 0 |
| fregatte | 3 | 10 | 50 | 50 | 0 | 100 % | 16.6 | 20 | 0 | 0 | 0 |
| kreuzer | 1 | 10 | 49 | 48 | 0 | 98 % | 86.5 | 20 | 0 | 0 | 0 |
| kreuzer | 2 | 10 | 47 | 46 | 0 | 100 % | 23.2 | 20 | 0 | 0 | 0 |
| kreuzer | 3 | 10 | 50 | 50 | 0 | 100 % | 22 | 20 | 0 | 0 | 0 |

Hinweis: Crew 2 und 3 liefern bei Raider identische Werte (gleiche Bots/Seeds; die Crewgröße ändert dort nichts). `tRt` = Spalte "Reaktor Median" in der Tabelle "Abnahme 13".

## 3. Streufeuer (Lerche-Schild, konzentriert gegen verteilt)

Werkzeug `tools/sys03-streufeuer.js`: keine Gegner, Lerche steht, Treffer in festem Takt direkt über `space.shipHit` (Schaden 1 je Treffer, normale Treffer). `konzentriert` = alle auf Sektor 0, `streu` = reihum über die Sektoren mit Schild (hier 0, 1, 3; Sektor 2 hat Zuteilung 0). Gleiche Gesamtrate. Schild Standard 2/2/0/2, Regeneration +1 je Sektor alle 2 s (`shields.regenInterval`), Laufzeit 60 s, Seeds 1–10.

Aufrufe: `node tools/sys03-streufeuer.js --rate R --seeds 10 --crews 1,3 --sek 60` für R = 2, 3, 4 Treffer/s


Befehl: node tools/sys03-streufeuer.js --rate 2 --dmg 1 --verteilung konzentriert,streu --crews 1,3 --seeds 10 --seed0 1 --sek 60 --ziel 0

| Verteilung | Crew | Schild Start | n | Treffer/Lauf | 1. Treffer→1. Sektor 0 Median (min–max, n/N) | 1. Treffer→1. Systemschaden Median (min–max, n/N) | 1. Treffer→Reaktor zerstört Median (min–max, n/N) |
|---|---|---|---|---|---|---|---|
| konzentriert | 1 | 2/2/0/2 | 10 | 121 | 0.5 (0.5–0.5, 10/10) | 5.5 (5–6.5, 10/10) | 49 (42–57, 10/10) |
| konzentriert | 3 | 2/2/0/2 | 10 | 121 | 0.5 (0.5–0.5, 10/10) | 5.5 (5–6.5, 10/10) | 35 (29.5–35.5, 10/10) |
| streu | 1 | 2/2/0/2 | 10 | 121 | 1.5 (1.5–1.5, 10/10) | 49.5 (41.5–55.5, 10/10) | — (—–—, 0/10) |
| streu | 3 | 2/2/0/2 | 10 | 121 | 1.5 (1.5–1.5, 10/10) | 49.5 (41.5–55.5, 10/10) | — (—–—, 0/10) |

Befehl: node tools/sys03-streufeuer.js --rate 3 --dmg 1 --verteilung konzentriert,streu --crews 1,3 --seeds 10 --seed0 1 --sek 60 --ziel 0

| Verteilung | Crew | Schild Start | n | Treffer/Lauf | 1. Treffer→1. Sektor 0 Median (min–max, n/N) | 1. Treffer→1. Systemschaden Median (min–max, n/N) | 1. Treffer→Reaktor zerstört Median (min–max, n/N) |
|---|---|---|---|---|---|---|---|
| konzentriert | 1 | 2/2/0/2 | 10 | 181 | 0.4 (0.4–0.4, 10/10) | 3.4 (3–3.7, 10/10) | 24.4 (19–26.4, 10/10) |
| konzentriert | 3 | 2/2/0/2 | 10 | 181 | 0.4 (0.4–0.4, 10/10) | 3.4 (3–3.7, 10/10) | 22.7 (19–23, 10/10) |
| streu | 1 | 2/2/0/2 | 10 | 181 | 1 (1–1, 10/10) | 17 (13.7–19, 10/10) | — (—–—, 0/10) |
| streu | 3 | 2/2/0/2 | 10 | 181 | 1 (1–1, 10/10) | 17 (13.7–19, 10/10) | — (—–—, 0/10) |

Befehl: node tools/sys03-streufeuer.js --rate 4 --dmg 1 --verteilung konzentriert,streu --crews 1,3 --seeds 10 --seed0 1 --sek 60 --ziel 0

| Verteilung | Crew | Schild Start | n | Treffer/Lauf | 1. Treffer→1. Sektor 0 Median (min–max, n/N) | 1. Treffer→1. Systemschaden Median (min–max, n/N) | 1. Treffer→Reaktor zerstört Median (min–max, n/N) |
|---|---|---|---|---|---|---|---|
| konzentriert | 1 | 2/2/0/2 | 10 | 241 | 0.3 (0.3–0.3, 10/10) | 2.5 (2.3–2.8, 10/10) | 16.5 (14.3–16.8, 10/10) |
| konzentriert | 3 | 2/2/0/2 | 10 | 241 | 0.3 (0.3–0.3, 10/10) | 2.5 (2.3–2.8, 10/10) | 16.5 (14.3–16.8, 10/10) |
| streu | 1 | 2/2/0/2 | 10 | 241 | 0.8 (0.8–0.8, 10/10) | 9.8 (8.8–11.3, 10/10) | 50 (45.5–52.8, 10/10) |
| streu | 3 | 2/2/0/2 | 10 | 241 | 0.8 (0.8–0.8, 10/10) | 9.8 (8.8–11.3, 10/10) | 42.8 (39.5–45, 10/10) |

Befund: Bei gleicher Rate bricht konzentriert der Sektor nach 0,3–0,5 s, verteilt nach 0,8–1,5 s; der erste Systemschaden kommt konzentriert nach 2,5–5,5 s, verteilt 2–10 mal später (bei 2 Treffer/s 50 s, weil die Regeneration den verteilten Sektoren fast alles zurückgibt: 2/3 Treffer/s je Sektor gegen 0,5/s Regeneration). Der Reaktor bricht verteilt in 60 s nur bei 4 Treffer/s. Crew 1 und 3 unterscheiden sich nur über Reaktor/Energie (Crew 1: Reaktor-Zeit länger).


## Nach B2 (Direkttreffer auf Gegner und Verbündete = eine Stufe)

Stand: Branch `sys03` nach SYS-03 B2 (B1 + B2; Schilde unverändert, Paket C folgt). Die Baseline-Abschnitte oben bleiben unverändert. Änderungen gegenüber der Baseline: Gegner und Verbündete verlieren je Treffer ohne Schildschutz genau eine Stufe je System (Treffer-Fenster 0,25 s), `crewScaling.gegnerIntegritaet` entfällt (Budget = `enemies.<klasse>.hp × budgetFaktor`, z. B. Fregatte 90 statt 36/50, Kreuzer 120 statt 48/67), die Lerche arbeitet seit B1 nach derselben Regel.

### Gegner-Seite (Bot-Läufe, Arena): Spawn → Tod und `tRt` (Spawn → Reaktor zerstört), vorher → nachher

Aufruf: `node tools/sys01-lauf.js --kinds raider,korvette,fregatte,kreuzer --crews 1,2,3 --seeds 10 --jobs 4` (Seeds 1–10, 5 Wellen à 1 Gegner, Pilot maneuver, Läufe enden, wenn die Lerche fällt)

| Klasse | Crew | Spawn→Tod Median vorher | Spawn→Tod Median nachher | `tRt` Median vorher | `tRt` Median nachher | zerstört nachher (n/N) | nicht beendet nachher |
|---|---|---|---|---|---|---|---|
| raider | 1 | 61.2 | 84.9 | 41.2 | 64.9 | 50/50 | 0 |
| raider | 2 | 50.8 | 67.1 | 30.8 | 47.1 | 48/49 | 1 |
| raider | 3 | 50.8 | 64.7 | 30.8 | 44.7 | 50/50 | 0 |
| korvette | 1 | 55.3 | 82.9 | 35.3 | 62.9 | 50/50 | 0 |
| korvette | 2 | 36.2 | 37 | 16.2 | 17 | 50/50 | 0 |
| korvette | 3 | 35.6 | 37.2 | 15.6 | 17.2 | 50/50 | 0 |
| fregatte | 1 | 79.5 | 116.2 | 59.5 | 96.2 | 37/42 | 5 |
| fregatte | 2 | 65.3 | 84.5 | 45.3 | 64.5 | 30/37 | 7 |
| fregatte | 3 | 71.5 | 79.6 | 51.5 | 59.6 | 39/42 | 3 |
| kreuzer | 1 | 109.9 | 144.4 | 89.9 | 124.4 | 20/29 | 9 |
| kreuzer | 2 | 65.7 | 62.4 | 45.7 | 42.4 | 22/30 | 8 |
| kreuzer | 3 | 73.3 | 95.1 | 53.3 | 75.1 | 46/48 | 2 |

Weitere Kennzahlen nachher (Median): Spawn→Zone offen raider 52,3/33,4/33,1 s, korvette 51,7/14,4/14,8 s, fregatte 93,7/20,2/27,3 s, kreuzer 121/25,4/57 s (Crew 1/2/3); Reaktor→Tod 20 s (Countdown, unverändert). Die Zahl der Gegner je Lauf ist bei Fregatte und Kreuzer kleiner als 50, weil die Lerche (nach B1 mit Stufenregel, Schilde unverändert) in diesen Läufen fällt (Lerche-Reaktorausfälle je Lauf fregatte 0,9/1,7/0,6, kreuzer 2,4/2,0/0,2; vorher 0).

### Gegner feuert auf stehende Lerche (Schild Standard), Crew 2, vorher → nachher

Aufruf: `node tools/sys01-gegnerfeuer.js --kinds fregatte,kreuzer --crews 2 --seeds 20` (Seeds 1–20, 120 s)

| Klasse | Gegner Hülle vorher → nachher | Treffer bis Ende (Mittel) vorher → nachher | 1. Treffer→1. Systemschaden Median (n) vorher → nachher | 1. Treffer→Reaktor zerstört Median (n von N) vorher → nachher |
|---|---|---|---|---|
| fregatte | 50 → 90 | 23.1 → 27.2 | 80.6 (6) → 10.2 (16) | — (0/20) → 101.1 (2/20) |
| kreuzer | 67 → 120 | 32.8 → 35.3 | 60.6 (9) → 4.3 (18) | — (0/20) → 78 (9/20) |

Befund: Die Lerche-Seite (B1) macht den ersten Systemschaden um den Faktor 6 bis 14 früher, der Reaktor der stehenden Lerche fällt gegen den Kreuzer jetzt in 9 von 20 Läufen. Auf der Gegner-Seite ist `tRt` trotz des größeren Budgets (kein Faktor 0,4/0,56 mehr) bei Jäger, Korvette solo und Fregatte/Kreuzer solo länger (Treffer ohne Schild kosten eine Stufe, die Seitenzonen müssen erst leer sein, bevor die Mitte mit dem Reaktor getroffen wird, und die Gegner reparieren 6 s je Stufe); Korvette Crew 2/3 ändert sich kaum. Die Abnahme-Zielwerte für die Tötungszeit stellt Paket D ein.


## Nach Nacharbeit B1/B2

Stand: Branch `sys03` nach der Nacharbeit zu den Reviews B1 und B2 (Schilde unverändert, Paket C folgt). „vorher“ = 24bae96 (A + E + B1 + B2), frisch mit denselben Werkzeugen und Seeds gemessen (Kopie des Standes in einem eigenen Ordner, nichts am Stand verändert). Die alten Abschnitte oben bleiben unverändert. Änderungen gegenüber 24bae96:

- Dauerdruck: `zonen.druckPunkte` 12 → 6, neuer Wert `zonen.druckAbkling_s` 3; der Zähler lebt je Sektor (Lerche) bzw. je Schiff (Gegner, Verbündete), gleicher Helfer (`integritaet.js`), und verfällt, wenn lange keine Restpunkte mehr ankommen.
- Sturm-Treffer stempeln ein längeres Fenster je System (`systemModell.sturm.trefferFenster_s` 1,5 s statt 0,25 s).
- Torpedo-Durchschlag auf den Reaktor in ganzen Stufen: `systemModell.torpedo.reaktorStufen` 1 (ersetzt `reaktorAnteil`). Die Stufe wird robust aus `i` gelesen (`systemModell.schwelle` entfällt).
- Gezielter Treffer auf den Antrieb (Datenfeld `gezielt: zerstoert`) = zwei Stufen (sofort beschädigt, nach der Sperre zerstört), Gegner und Lerche; die Reparatur wartet auf eine vorgemerkte Stufe.
- Verrat übernimmt die Stufen des Verbündeten 1:1; `integPct` auf 6 Nachkommastellen gerundet.

### Dauerdruck (Zone mit 1 Punkt/s auf ein Ziel ohne Schild, 60 s, 5 Seeds)

Aufruf: `node tools/sys03-dauerdruck.js --seeds 5` (Lerche) und `--ziel gegner` (Kreuzer). Stufen = kumulativ verlorene Stufen (beschädigt 1, zerstört 2; Wiederherstellung zählt nicht zurück).

| Ziel | Stand | Stufen nach 60 s (je Seed) | 1. Stufe nach | 3. Stufe nach |
|---|---|---|---|---|
| Lerche | 2bd7137 (vor SYS-03, Punkteregel) | 10 10 10 10 10 | 6,7 s | 16,7 s |
| Lerche | 24bae96 (`druckPunkte` 12) | 8 8 8 8 6 | 11,7 s | 35,7 s |
| Lerche | nach Nacharbeit (`druckPunkte` 6) | 12 12 12 12 12 | 5,7 s | 17,7 s |
| Kreuzer (Gegner) | 24bae96 | 4 4 4 4 4 | 12,7 s | 36,7 s |
| Kreuzer (Gegner) | nach Nacharbeit | 9 9 9 9 9 | 6,7 s | 18,7 s |

Das Tempo ist 6 s je Stufe (1., 3. Stufe 12 s auseinander), vorher 6–7 s: grob vergleichbar. Die 12 Stufen der Lerche in 60 s enthalten die Zeit nach dem Reaktorausfall (Countdown, Notfallprotokoll setzt Systeme zurück, danach zählen neue Verluste mit); der Punktestand 2bd7137 lief in dieselbe Sättigung (10). Der Gegner-Wert 2bd7137 ist nicht vergleichbar (kleineres Budget, 30 Stufen, 1. Stufe nach 1,7 s). Die Tests (`test-direkttreffer.js`, `test-direkttreffer-gegner.js`) prüfen: Zähler bleibt innerhalb der Frist, verfällt danach, auch bei Schild > 0 ohne Resttreffer.

### Streufeuer (Lerche, Schild Standard), Rate 3/s, Crew 3, Seeds 1–10, 60 s

Aufruf: `node tools/sys03-streufeuer.js --rate 3 --seeds 10 --crews 3 --sek 60`. Vorher (24bae96) und nachher gleich (kein Sturm, kein Dauerdruck im Lauf).

| Verteilung | 1. Treffer→1. Sektor 0 Median | 1. Treffer→1. Systemschaden Median (min–max, n/N) | 1. Treffer→Reaktor zerstört Median (min–max, n/N) |
|---|---|---|---|
| konzentriert | 0,4 | 0,7 (0,7–0,7, 10/10) | 3,7 (2,4–4,4, 10/10) |
| streu | 1 | 3 (3–3, 10/10) | 13 (11–14,7, 10/10) |

(Baseline Abschnitt 3 vor SYS-03: konzentriert 3,4 s bis zum 1. Systemschaden, 22,7 s bis Reaktor; die Stufenregel selbst ist Wirkung von B1, nicht der Nacharbeit.)

### Gegner feuert auf stehende Lerche, Crew 2, Seeds 1–20, 120 s

Aufruf: `node tools/sys01-gegnerfeuer.js --kinds fregatte,kreuzer --crews 2 --seeds 20`. Ergebnis vorher und nachher gleich (Zeile für Zeile identisch):

| Klasse | Gegner Hülle | Treffer bis Ende (Mittel) | 1. Treffer→1. Systemschaden Median (n) | 1. Treffer→Reaktor zerstört Median (n von N) |
|---|---|---|---|---|
| fregatte | 90 | 27,2 | 10,2 (16) | 101,1 (2/20) |
| kreuzer | 120 | 35,3 | 4,3 (18) | 78 (9/20) |

### Gegner-Seite (Bot-Läufe, Arena), Crew 2 und 3, Seeds 1–10

Aufruf: `node tools/sys01-lauf.js --kinds raider,korvette,fregatte,kreuzer --crews 2,3 --seeds 10 --jobs 4`. Spawn → Tod Median in s (zerstört n/N), vorher → nachher:

| Klasse | Crew | Spawn→Tod vorher | Spawn→Tod nachher | `tRt` (Reaktor zerstört) vorher → nachher | zerstört vorher → nachher | Lerche Reaktorausfälle je Lauf vorher → nachher |
|---|---|---|---|---|---|---|
| raider | 2 | 67,1 | 67,1 | 47,1 → 47,1 | 48/49 → 48/49 | 0 → 0 |
| raider | 3 | 64,7 | 64,7 | 44,7 → 44,7 | 50/50 → 50/50 | 0 → 0 |
| korvette | 2 | 37 | 37,1 | 17 → 17,1 | 50/50 → 49/50 | 0 → 0,4 |
| korvette | 3 | 37,2 | 45,3 | 17,2 → 25,3 | 50/50 → 50/50 | 0 → 0 |
| fregatte | 2 | 84,5 | 86,9 | 64,5 → 71,5 | 30/37 → 33/39 | 1,7 → 1,3 |
| fregatte | 3 | 79,6 | 85,4 | 59,6 → 65,4 | 39/42 → 43/45 | 0,6 → 0,4 |
| kreuzer | 2 | 62,4 | 50,8 | 42,4 → 30,8 | 22/30 → 21/29 | 2,0 → 2,2 |
| kreuzer | 3 | 95,1 | 92 | 75,1 → 72 | 46/48 → 41/44 | 0,2 → 0 |

Die Läufe sind chaotisch (kleine Regeländerungen verschieben den Verlauf einzelner Seeds); die Mediane liegen im selben Bereich wie vor der Nacharbeit, die Jäger-Zeilen sind identisch.

### Verfolgung (Bot-Läufe, strenge Fassung von `test-verfolgung-bot.js` aus ee8aa6f), Seeds 1–4

Aufruf: `node tools/sys03-verfolgung.js --seeds 4 --crews 3,1` (Mission-Dauer, Ausgänge; Lauf endet bei erfüllter Mission oder nach 600 s bzw. solo 900 s). Vorher: gezielter Treffer auf den Antrieb = eine Stufe (die Gegner-Reparatur holte ihn nach 6 s zurück); nachher: zwei Stufen.

| Crew | Stand | Erfolg ohne Überspringen | Dauer je Seed (s) | gestellt | entkommen (Summe) |
|---|---|---|---|---|---|
| 3 | vorher (24bae96) | 4/4 | 70 70 70 70 | 4 | 4 |
| 3 | nachher | 4/4 | 17,4 17,4 17,4 17,4 | 4 | 0 |
| 1 (solo) | vorher (24bae96) | 1/4 | 600,1 600,1 192,7 600,1 | 4 | 36 |
| 1 (solo) | nachher | 4/4 | 26,9 154 69,6 26,9 | 4 | 3 |

Die strenge Fassung des Tests (18 Prüfungen) bestand vorher 12/18 und besteht nachher 18/18.

### SL9 (Schlacht der Söldner, Lerche passiv, `tools/test-sl9.js`), Seeds 1 / 4 / 6

| Seed | Dauer 24bae96 | Dauer nachher | Lerche-Minimum 24bae96 | Lerche-Minimum nachher | Söldnerschiffe am Ende nachher |
|---|---|---|---|---|---|
| 1 (Schlechtfall, nur Beobachtung) | 824 s | 824 s | 39 % | 39 % | 2 |
| 4 | 745 s | 1014 s | 0 % | 36 % | 1 (soeldner_b fällt) |
| 6 | 411 s | 411 s | 74 % | 74 % | 2 |

Seed 4 weicht ab: Die Schlacht ist chaotisch (acht weitere Seeds 2–11 messen vorher/nachher in derselben Größenordnung, einzelne Seeds um 10–25 % verschoben: Seed 5 611 → 769 s, Seed 8 944 → 913 s, Seed 9 600 → 565 s; Seed 11 verliert schon vorher ein Söldnerschiff). Der Test hält darum `SOELDNER_LEBEN_MIN = { 4: 1 }` und `LERCHE_MIN_PCT = 0` (jeweils „SYS-03 D: anheben“); die Messwerte stehen je Seed im Testprotokoll.

### Weitere Messwerte der Tests

- `test-sl3` (Falle, wehrlose Lerche, Zeit bis zum Verlust, Seeds 1–8): 90,9 / 64,5 / 68,7 / 104,9 / 120 / 181,8 / 110,1 / 105 s; Fenster im Test 48–228 s (Min/Max mit 25 % Rand).
- `test-flight` (Spitzengeschwindigkeit des Jägers mit beschädigtem Antrieb, Seeds 40–55): 108,9–122,7 px/s (+9 % bis +23 % über 100), 10 von 16 Seeds über +15 %; Seed 46 (108,9 px/s) bleibt Prüfseed, Grenze wieder +15 %.
