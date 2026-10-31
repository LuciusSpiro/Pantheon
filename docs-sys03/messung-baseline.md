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

## Nach C1 (Schild der Lerche: Pool 8, Kappe 8, Regenerationspause je Sektor, Sturm-Sperre je Sektor)

Stand: Branch `sys03` nach Paket C1. Startwerte (Paket D kalibriert): `shields.pointsPerPower` 4 (Pool 8 bei Energie 2), `maxPerSector` 8, `default` [4,2,0,2], `regenInterval` 2 s, **neu** `shields.regenDelay` 5 s (Pause je Sektor nach jedem Treffer auf diesen Sektor), **neu** `systemModell.sturm.regenSperre_s` 6 s (Sturm-Treffer: Pause = Längeres von regenDelay und regenSperre_s). `generatorDamagedPool` −2 und Kuppel-`shieldCost` 2 unverändert (bei Pool 8 verhältnismäßig schwächer).

### Streufeuer (Lerche, Schild Standard 4/2/0/2), Crew 3, Seeds 1–10, 60 s

Aufruf: `node tools/sys03-streufeuer.js --rate R --seeds 10 --crews 3 --sek 60` für R = 2, 3, 4. Je Treffer 1 Punkt; `konzentriert` = alle auf Sektor 0 (4 Punkte), `streu` = reihum über 0, 1, 3. Vorher = Schild 2/2/0/2 ohne Pause (Rate 3: Stand nach Nacharbeit B1/B2; Rate 2 und 4: Baseline Abschnitt 3, dort nur die Spalte „Sektor 0“ vergleichbar, weil die Stufenregel B1 erst später kam).

| Rate | Verteilung | 1. Treffer→1. Sektor 0 vorher → nachher | 1. Treffer→1. Systemschaden vorher → nachher | 1. Treffer→Reaktor zerstört vorher → nachher | Quotient streu/konz. (Sektor 0 / Reaktor) vorher → nachher |
|---|---|---|---|---|---|
| 2/s | konzentriert | 0,5 → 1,5 s | (5,5 → 2 s, Regel B1 fehlte) | 35 → 6,5 s (4,5–7,5, 10/10) | 3,0 / — → 1,33 / 2,5 |
| 2/s | streu | 1,5 → 2 s | 49,5 → 3,5 s | — (0/10) → 16 s (13,5–16,5, 10/10) | |
| 3/s | konzentriert | 0,4 → 1 s | 0,7 → 1,4 s | 3,7 → 4,4 s (3–5, 10/10) | 2,5 / 3,5 → 1,4 / 2,4 |
| 3/s | streu | 1 → 1,4 s | 3 → 2,4 s | 13 → 10,4 s (9–11, 10/10) | |
| 4/s | konzentriert | 0,3 → 0,8 s | (2,5 → 1 s, Regel B1 fehlte) | 16,5 → 3,3 s (2,3–3,8, 10/10) | 2,7 / — → 1,25 / 2,4 |
| 4/s | streu | 0,8 → 1 s | 9,8 → 1,8 s | 42,8 → 7,8 s (6,5–8,3, 10/10) | |

Befund: Konzentriertes Feuer bricht den stärksten Sektor (4 Punkte) etwa 2–3 mal später als vorher (Kapazität), Streufeuer bricht den ersten Sektor aber nur 1,25–1,33 mal später als konzentriertes Feuer, weil die Startverteilung ungleich ist: bei [4,2,0,2] entscheidet der schwächste Sektor (2 Punkte) beim Streufeuer. Bis zum zerstörten Reaktor ist Streufeuer 2,4–2,5 mal langsamer als konzentriert (vorher bis 3,5 mal, weil die Regeneration den Streu-Sektoren damals fast alles zurückgab). Mit der Pause regeneriert bei 2 bis 4 Treffern/s KEIN Sektor mehr (je Sektor kommt ein Treffer seltener als alle 1,5 s, die Pause dauert 5 s): der Streufeuer-Vorteil ist jetzt reine Verteilung, keine Regeneration mehr. Das Gesamtbild ist gegenüber „vorher“ härter für den Schild unter Dauerfeuer (Reaktor bei Streufeuer Rate 3: 13 → 10,4 s, trotz Pool 8). Der Test `test-schild-pause.js` misst Abnahme 5 mit Start [3,3,0,2] (Quotient 2,5 bei 2, 3 und 4/s) und bei 0,3 Treffern/s (Streufeuer bricht nie, weil je Sektor nur alle 10 s ein Treffer kommt und der Schild nach der Pause nachlädt).

### Gegner feuert auf stehende Lerche (Schild Standard 4/2/0/2), Crew 2, Seeds 1–20, 120 s

Aufruf: `node tools/sys01-gegnerfeuer.js --kinds raider,korvette,fregatte,kreuzer --crews 2 --seeds 20`. Zeit bis ein Schildsektor der Lerche (der beim ersten Treffer > 0 war) auf 0 fällt („Segment 0“). Vorher = Baseline Abschnitt 1 (Schild 2/2/0/2, vor SYS-03; Fregatte/Kreuzer Systemschaden und Reaktor: Stand nach B1/B2).

| Klasse | Gegner Hülle / Schild | Segment 0 vorher → nachher (Median, n von N) | 1. Systemschaden vorher → nachher (Median, n) | Reaktor zerstört vorher → nachher (Median, n von N) |
|---|---|---|---|---|
| raider | 13 / 2/1/0/1 | — (0/20) → 59,3 s (21–96,7, 7/20) | — (0) → 24,2 s (16) | — (0/20) → 108,1 s (1/20) |
| korvette | 48 / 1/2/0/2 | 16,8 s (14/20) → 16,8 s (3–31,4, 16/20) | 86,8 s (1) → 4,9 s (13) | — (0/20) → 53,7 s (24,2–75, 3/20) |
| fregatte | 90 / 2/2/2/1/2/2 | 21,9 s (20/20) → 22 s (0,8–30,4, 20/20) | 10,2 s (16) → 2,6 s (18) | 101,1 s (2/20) → 74,1 s (12,4–102,9, 9/20) |
| kreuzer | 120 / 2/3/3/3/1/3/3/3 | 28,4 s (19/20) → 28,5 s (15,6–36,6, 19/20) | 4,3 s (18) → 2 s (18) | 78 s (9/20) → 40,1 s (13,1–107,8, 12/20) |

Befund: Die Zeit bis zum ersten leeren Schildsektor bleibt bei Korvette, Fregatte, Kreuzer fast gleich (der Gegner trifft zuerst den Sektor mit 1–2 Punkten bzw. verteilt; Pool 8 ändert das nicht, weil die ersten Treffer auf die dünnen Sektoren 1 und 3 gehen, [4,2,0,2]). Spürbar ist die Pause: Der Schild lädt unter Beschuss nicht mehr nach, der erste Systemschaden kommt etwa 2 mal früher, der Reaktor fällt häufiger (Fregatte 2/20 → 9/20, Kreuzer 9/20 → 12/20). Gegenprobe ohne Pause (`TUNE='{"shields.regenDelay":0}' node -r ./tools/tune-preload.js tools/sys01-gegnerfeuer.js …`, sonst gleiche Werte, Pool 8): Reaktor zerstört raider 0/20, korvette 2/20 (99,6 s), fregatte 1/20 (52,7 s), kreuzer 9/20 (72,7 s); Integritätsverlust der Lerche nach 60 s (Mittel) raider 2,8 / korvette 4,1 / fregatte 16,7 / kreuzer 28,7 gegenüber 5,3 / 15,4 / 28,7 / 56,7 mit Pause. Die Pause ist also der Teil des Befunds, der die Lerche unter Dauerbeschuss verwundbarer macht (Pool 8 allein hebt die Werte nicht über den Stand nach B1/B2). Paket D kalibriert Startverteilung, Kapazität und `regenDelay` gegen diese Werte.

### Bot-Probelauf (Arena maneuver, Crew 3, 3 Seeds; `node tools/sim-headless.js arena --pilot maneuver --seeds 3 --players 3`)

Schildverteilung des Bots (`BOT_SCHILD_SEKTOR_MAX`), Pool 8: Max 4 → 4,7 Wellen, Hülle −68; Max 6 → 5,3 Wellen, Hülle −46; Max 8 → 2,3 Wellen, Hülle −245 (der Bot bündelt alles auf die Bedrohung, die anderen Seiten stehen leer). Der Bot ließ vor dem Gefecht Poolpunkte brach liegen (z. B. Zuteilung 2/0/0/0 bei Pool 8, weil nur die Bedrohungsseite Punkte bekam): `schildVerteilung` füllt jetzt, sobald die Bedrohungsseite voll ist, die schwächste Nebenseite auf (Arena maneuver, Crew 3, 6 Seeds: 4,2 Wellen / Hülle −106 mit, 3,8 / −76 ohne, im Rauschen). Gewählt: **4 (unverändert)**, weil die Solo-Kette (`sim-headless kette`, Crew 1, Seed 1) nur mit Max 4 durchläuft (95 min; Max 5, 6, 8: Spielzeit über 14000 s, Kapitel 6 endet jedes Mal im Rückzug). Kapitel 6 (Orbit-Schlacht) ist solo ein Glücksspiel: Einstieg `--kapitel k6_orbit --crew 1 --seeds 6` gelingt vor C1 in 3 von 6 Seeds (Rest bis 5000 s im Rückzug-Kreis), nach C1 mit Max 6 in 4 von 6. Nur Probelauf (Seeds 1–3), die Messung folgt in Paket D.

## Nach C2 (Schild von Gegnern und Verbündeten: Regenerationspause je Segment)

Stand: Branch `sys03` nach Paket C2. „vorher“ = 171b19b (C1), frisch mit denselben Werkzeugen und Seeds gemessen (Kopie des Standes in einem eigenen Ordner). Regel: Gegner und Verbündete regenerieren ein Schildsegment erst, wenn `shields.regenDelay` s (5 s, dieselbe Quelle wie die Lerche) kein Treffer auf genau dieses Segment kam; Sturm-Treffer sperren länger (`systemModell.sturm.regenSperre_s`, 6 s, je Segment); danach 1 Punkt je `enemyShieldRegen` s (5 s, Timer je Segment, bei Generator beschädigt ×`regenGeneratorBeschaedigt`). Der Stempel sitzt einmal in `space.damageEnemy` (`Schilde.pause.treffer`/`trefferSturm`), `e.regenHold` entfällt. Kein neuer Config-Wert, kein neues Snapshot-Feld (`snap:mess` Worst Case max 11 799 B).

### Gegner-Seite (Bot-Läufe, Arena), Crew 2, Seeds 1–20, 5 Wellen à 1 Gegner

Aufruf: `node tools/sys01-lauf.js --kinds raider,korvette,fregatte,kreuzer --crews 2 --seeds 20 --jobs 3`. Neu im Werkzeug: Tabelle „Gegner-Seite“ (ab dem ersten Schaden am Gegner: Schildsegment 0, erster Systemschaden, Reaktor zerstört). Mediane in s, (n) in Klammern.

| Klasse | Spawn→Reaktor zerstört (`tRt`) vorher → nachher | Spawn→Tod vorher → nachher | Schaden→Reaktor zerstört vorher → nachher | Schaden→Segment 0 vorher → nachher | Schaden→1. Systemschaden vorher → nachher | Reaktor zerstört (n/N) vorher → nachher |
|---|---|---|---|---|---|---|
| raider | 47,1 → 47,9 | 67,1 → 67,9 | 46 → 46,2 | 2,6 → 2,6 | 0 → 0 | 98/99 → 100/100 |
| korvette | 17 → 16,4 | 37 → 36,4 | 11,6 → 11,4 | 0 → 0 | 1,3 → 1,2 | 97/99 → 96/98 |
| fregatte | 65,3 → 47,7 | 85 → 67,7 | 58,6 → 40,8 | 0 → 0 | 1,2 → 1,2 | 56/70 → 59/72 |
| kreuzer | 31,7 → 45,8 | 51,7 → 65,8 | 25,8 → 38,3 | 0 → 0 | 1,2 → 1,2 | 36/54 → 54/68 |

Korrektur (SYS-03 C-Nacharbeit): Die frühere Erklärung „1-Punkt-Segmente dominieren“ war falsch. Die Standardbatterie macht **2,66 Schaden je Treffer** (`Katalog.waffe('standardbatterie').schaden`), die Lanze 12, die Sturmbatterie 1,08. Die Schildsegmente der Gegner tragen Jäger `[2,1,0,1]`, Korvette `[1,2,0,2]`, Fregatte `[2,2,2,1,2,2]`, Kreuzer `[2,3,3,3,1,3,3,3]` (Bug 2): schon der erste Standardtreffer leert jedes 1- und 2-Punkt-Segment; nur die 3-Punkt-Segmente des Kreuzers brauchen zwei Treffer. Darum sind „Schaden → Segment 0“ (Median 0 bis 2,6 s) und „Schaden → 1. Systemschaden“ (0 bis 1,2 s) hier nicht aussagefähig: der erste Schuss öffnet ein Segment, der zweite trifft schon das System. `tools/sys01-lauf.js` misst dabei mit den echten Waffen der Bots (echter Schaden je Treffer); die Tabelle oben ist also unverändert gültig, die Neumessung (Crew 2, Seeds 1–20, Stand dieses Commits) ergibt dieselben Mediane. Rohschaden 1 steckte nur in `tools/sys03-streufeuer-gegner.js` (siehe unten, jetzt mit echtem Schaden). Die Wirkung der Pause zeigt sich in `tRt`, aber nur bei Fregatte (65 → 48 s) und Kreuzer (32 → 46 s, die Richtung ist schwankend: n = 36 → 54 Gegner, die Lerche fällt in den Läufen früher, der Lauf bricht anders ab); Jäger und Korvette bleiben gleich. Die Läufe sind chaotisch (Mediane bewegen sich ohne Regeländerung um 10–30 %); eine klare Beschleunigung der Zerstörung durch die Pause ist nicht belegbar, ein Rückschritt auch nicht.

### Zuordnung: zwei verschiedene Messungen (nicht verwechseln, wichtig für Paket D)

| | Gegner-Seite | Lerche-Seite (Schild-Zielfenster) |
|---|---|---|
| Frage | Wie lange hält der Schild und die Systeme eines GEGNERS gegen die Lerche? | Wie lange hält der Schild der LERCHE (Sektor 0) unter Gegnerfeuer? |
| Werkzeug | `tools/sys01-lauf.js` (Bot-Läufe, Arena, echte Waffen), `tools/sys03-streufeuer-gegner.js` (stehender Gegner, echter Schaden je Treffer) | `tools/sys01-gegnerfeuer.js` (Gegner feuert auf die Lerche, 120 s, Lerche-Schild Standard) |
| Größe | Schaden → Segment 0 / 1. Systemschaden / Reaktor zerstört des Gegners; Spawn → Tod | Zeit bis Sektor 0 der Lerche (Schild des Sektors auf 0) |
| Ziel | kein Zielfenster, nur Vorher/Nachher und Streu gegen konzentriert (Abnahme 5) | **Zielfenster Fregatte 30–45 s, Kreuzer 40–55 s** (Crew 2 und 3; Jäger und Korvette gemessen und berichtet) |
| Abschnitte hier | „Gegner-Seite“ in den Abschnitten oben, dieser Abschnitt | „Lerche-Seite“ in den Abschnitten oben (Aufruf mit `sys01-gegnerfeuer`) |

Das Schild-Zielfenster von Paket D gilt ausschließlich für die rechte Spalte. Die Gegner-Seite sagt nichts darüber, ob das Fenster erreicht ist.

### Abnahme 5 für Gegner: konzentriert gegen Streu (stehender Gegner, Standardschild der Klasse)

Werkzeug `tools/sys03-streufeuer-gegner.js` (stehender Gegner im vollen Spielablauf, Treffer in festem Takt über `space.damageEnemy` mit dem **echten Schaden einer Waffe**, Standard Standardbatterie 2,66 (`--waffe <id>`; `--roh` = Rohschaden 1, nur für Vergleiche); konzentriert = alles auf das stärkste Segment der Klasse, streu = reihum über alle Segmente mit Schild). Die erste Fassung (SYS-03 C2) rechnete mit Rohschaden 1; die Tabelle unten ist neu gemessen und ersetzt sie. Aufruf je Rate: `node tools/sys03-streufeuer-gegner.js --rate R --seeds 10 --sek 120`, R = 0,3 / 0,5 / 1. „vorher“ = ohne Pause (`TUNE='{"shields.regenDelay": 0}' node -r ./tools/tune-preload.js …`, entspricht dem Verhalten vor C2 bis auf den Timer je Segment), „nachher“ = Stand dieses Commits. Quotient = Median streu / Median konzentriert (in Klammern); „∞“ = bricht in 120 s nicht. Die Spalte „Segment 0“ entfällt (immer 0 bis 3,4 s: der erste Treffer leert ein 1–2-Punkt-Segment).

| Klasse | Rate | 1. Systemschaden konz. / streu (Quotient) vorher → nachher | Reaktor zerstört konz. / streu (Quotient) vorher → nachher |
|---|---|---|---|
| raider | 0,3 | 3,4 / ∞ → 3,4 / 10 (2,9) | 30 / ∞ → 23,4 / 60 (2,6) |
| korvette | 0,3 | 3,4 / ∞ → 3,4 / 10 (2,9) | ∞ / ∞ → 36,7 / ∞ |
| fregatte | 0,3 | 3,4 / ∞ → 3,4 / ∞ | ∞ / ∞ → 43,4 / ∞ |
| kreuzer | 0,3 | 10 / ∞ → 6,7 / ∞ | ∞ / ∞ → 60 / ∞ |
| raider | 0,5 | 2 / ∞ → 2 / 6 (3) | 16 / ∞ → 16 / 26 (1,6) |
| korvette | 0,5 | 2 / ∞ → 2 / 6 (3) | 18 / ∞ → 16 / 44 (2,8) |
| fregatte | 0,5 | 2 / ∞ → 2 / ∞ | 22 / ∞ → 22 / ∞ |
| kreuzer | 0,5 | 4 / ∞ → 4 / ∞ | 42 / ∞ → 36 / ∞ |
| raider | 1 | 1 / 3 (3) → 1 / 3 (3) | 8 / 17 (2,1) → 8 / 13 (1,6) |
| korvette | 1 | 1 / 3 (3) → 1 / 3 (3) | 8 / 28 (3,5) → 8 / 19 (2,4) |
| fregatte | 1 | 1 / ∞ → 1 / 6 (6) | 9 / ∞ → 9 / 31 (3,4) |
| kreuzer | 1 | 2 / ∞ → 2 / 8 (4) | 18 / ∞ → 17 / 47 (2,8) |

Befund (echter Schaden 2,66): Die Pause wirkt auf Streufeuer, nicht auf das Zerstören der ersten Segmente. Vorher (ohne Pause) füllte der Schild zwischen den Treffern alle Segmente nach: bei 0,3 und 0,5 Treffer/s brach Streu auf keiner Klasse einen Systemschaden in 120 s (∞), bei 1/s nur Jäger und Korvette (3 s). Nachher bricht Streu den Systemschaden bei Jäger und Korvette auf allen Raten (3 s bei 1/s; 6 bis 10 s bei 0,5 bis 0,3/s, 2,9- bis 3-mal später als konzentriert), bei Fregatte und Kreuzer nur bei 1/s (6 bzw. 8 s, 4- bis 6-mal später als konzentriert); bei 0,3 bis 0,5/s bricht Streu dort nichts in 120 s. Reaktor zerstört: Streu 1,6- bis 2,8-mal später als konzentriert bei Jäger (alle Raten) und Korvette (0,5 und 1/s), bei Fregatte und Kreuzer bei 1/s (3,4 bzw. 2,8-mal). Konzentriertes Feuer wird kaum schneller (Jäger 0,3/s Reaktor 30 → 23,4 s, Kreuzer 0,3/s Systemschaden 10 → 6,7 s, sonst gleich); bei niedrigen Raten wird der Reaktor erst durch die Pause erreichbar (Fregatte, Kreuzer 0,3/s: ∞ → 43 / 60 s). Die Abnahme-5-Aussage „Streuen ist deutlich schlechter als Konzentrieren“ gilt damit für Gegner wie für die Lerche, bei kleinen Klassen und Raten ab 0,5/s; bei Fregatte und Kreuzer greift sie erst ab etwa 1 Treffer/s, darunter regeneriert jedes Segment zwischen zwei Treffern (Pause 5 s plus Takt 5 s je Punkt).


## Nach D (Kalibrierung: Pool 12 mit gleichmäßiger Startverteilung, Reaktor-Fenster 6 s)

Stand: Branch `sys03` nach Paket D. „vorher“ = 7c31ff2 (Stand nach C-Nacharbeit), frisch mit denselben Werkzeugen und Seeds in einem eigenen Worktree gemessen (`Pantheon-sys03-mess`, nichts am Stand verändert). Neue Werkzeugfelder: `tools/sys01-gegnerfeuer.js` Zweitmessung (Sektor 0 inklusive Sektor des 1. Treffers, Zone leer, Reaktor beschädigt, Zone leer → Reaktor zerstört), `tools/sys01-lauf.js` Spalte „Zone offen → Reaktor zerstört“, `tools/sys01-preload.js` liest `TUNE` (wirkt jetzt auch in den Kindprozessen von `sys01-lauf.js`; vorher blieb `TUNE` dort wirkungslos).

### Endgültige Werte (alt → neu, jeweils eine Quelle `shared/config.js`, live per `tune`)

| Wert | alt | neu | Grund |
|---|---|---|---|
| `shields.pointsPerPower` | 4 (Pool 8 bei Energie 2) | **6** (Pool 12) | Bot-Läufe Crew 2: Die Lerche überlebt Fregatte/Kreuzer deutlich öfter (siehe unten); Streufeuer-Quotient (Abnahme 5) von 1,0 auf 3,0. Pool 16 bringt in den Bot-Läufen nichts mehr (Fregatte 0,8, Kreuzer 1,0 Reaktorausfälle je Lauf gegen 0,9 / 1,2 bei Pool 12). |
| `shields.default` | [4,2,0,2] | **[4,4,0,4]** | gleichmäßig auf die drei Seiten mit Schild; nutzt den ganzen Pool. Bei [4,2,0,2] entscheidet der dünne Seitensektor: Streufeuer brach den ersten Sektor genauso früh wie konzentriertes Feuer (Quotient 1,0). |
| `systemModell.reaktorFenster_s` | – (Standard-Fenster `trefferFenster_s` 0,25 s) | **6** (neu) | Binär-Prüfung (Abnahme 7): Der Reaktor verliert innerhalb von 6 s nach einer Stufe keine weitere (Lerche, Gegner, Verbündete gleich: `integritaet.js fensterDauer`, Systeme `reactor`/`reaktor`). Ein Treffer im Fenster sucht ein anderes System der Mitte. Der Torpedo-Durchschlag ignoriert das Fenster wie bisher (zwei Torpedos zerstören den Reaktor weiter sofort: gewollt, SYS-02a). |
| `shields.regenDelay`, `regenInterval`, `maxPerSector` | 5 s, 2 s, 8 | unverändert | Eine kürzere Pause (3 s, 2 s) oder Regeneration 1 s zeigt in den Läufen keinen eindeutigen Gewinn (Tabelle „Gewählte Hebel“); ohne Pause (0 s) wäre die Lerche deutlich robuster, das verletzt aber Abnahme 4. `maxPerSector` 8 wird bei Pool 12 nicht erreicht (Bug und Seiten je 4). |
| Gegnerwerte (`enemies.*.fireInterval`, `.damage`, `spaceM3.tele`, `spaceS2b.sperrfeuer`) | – | unverändert | Kein Hebel, der das Ziel bewegt (siehe unten); jeder wäre eine Abschwächung der Gegner, keine Stärkung des Schilds. |
| Testkette: `sim-headless kette --seed 1 --seeds 3 --mindest` | 1 | **2** | Kette Crew 3 hat jetzt 3/3 (vorher 1/3), Crew 1 3/3. |

### 1. Zielfenster Zeit bis Sektor 0 (Abnahme 6): NICHT erreicht, und mit den vorgesehenen Hebeln nicht erreichbar

`node tools/sys01-gegnerfeuer.js --kinds raider,korvette,fregatte,kreuzer --crews 2,3 --seeds 20` (Seeds 1–20, 120 s, Lerche steht, Schild Standard). Zeit vom 1. Treffer bis ein Schildsektor, der beim 1. Treffer > 0 war, auf 0 fällt (Median s, min–max, n von 20). Ziel: Fregatte 30–45 s, Kreuzer 40–55 s.

| Klasse | Crew | vorher | nachher | Ziel |
|---|---|---|---|---|
| raider | 2 | 51,4 (21–70,9, 6/20) | 60,3 (27,4–80,6, 6/20) | Bericht |
| raider | 3 | — (0/20) | — (0/20) | Bericht |
| korvette | 2 | 16,8 (3–31,4, 16/20) | 17,6 (4,5–42,9, 16/20) | Bericht |
| korvette | 3 | 5 (3–68,8, 8/20) | 6,8 (4,8–10,3, 9/20) | Bericht |
| **fregatte** | 2 | 22 (0,8–30,4, 20/20) | **4,9** (0,1–31,2, 18/20) | 30–45 |
| **fregatte** | 3 | 31,5 (0,1–68,8, 17/20) | **5** (0,1–55, 17/20) | 30–45 |
| **kreuzer** | 2 | 28,5 (15,6–36,6, 19/20) | **21,6** (0,3–36,6, 19/20) | 40–55 |
| **kreuzer** | 3 | 31,9 (13,3–95,1, 18/20) | **16** (0,3–95,1, 18/20) | 40–55 |

Das Fenster wird verfehlt, und die Zahl wurde mit Pool 12 für Fregatte und Kreuzer sogar kleiner. Ursache (gemessen, kein Bot-Rauschen, die Lerche steht):

1. **Die Größe misst nicht die Schildstärke.** Die Fregatte feuert je Salve zwei Bolzen mit Schaden 2 (der Kreuzer bis zu acht Plätze), dazu Ladeschuss (Schaden 4 bis 6) und Sperrfeuer (3 Nadeln à 0,5). Ein Schildsektor mit 2 bis 4 Punkten fällt in der ersten Salve; der Seitensektor bleibt danach tot. „Zeit bis Segment 0“ zählt aber nur Sektoren, die beim ersten Treffer noch > 0 waren, schließt den Sektor des ersten Treffers also aus, **wenn er schon beim ersten Treffer auf 0 fällt**. Gemessen wird damit die Zeit, bis die KI die **andere** Seite beschießt (Seitenwechsel `spaceM3b.pilotKlasse.fregatte.switchCd` 16 s, Kreuzer 20 s, plus Anflug), nicht der Schild. Mit stärkerem Seitenschild (4 statt 2 Punkte) überlebt der Sektor des ersten Treffers die erste Kugel, zählt mit und fällt nach 0,1 bis 5 s: der Median kippt auf 5 s, ohne dass die Lerche schwächer wäre (Zweitmessung unten: „Sektor 0 inklusive Treffersektor“ ist immer 0 s). Dasselbe steht schon in der SYS-01-Erkundung (Befund 5: „Zeit bis Sektor 0 taugt nicht als Zielgröße“, bimodal).
2. **Keiner der Hebel bewegt die Größe monoton** (Seeds 1–40, Crew 2/3, Fregatte/Kreuzer, Median Segment 0 in s):

| Variante (`TUNE`) | Fregatte c2 / c3 | Kreuzer c2 / c3 |
|---|---|---|
| Stand 7c31ff2 | 22 / 31,5 | 28,5 / 31,9 |
| `enemies.fregatte/kreuzer.fireInterval` 4,65 | 21,9 / 26,6 | 27,7 / 24 |
| `enemies.fregatte/kreuzer.fireInterval` 6 | 21,7 / 10,1 | 28,1 / 18,2 |
| `enemies.fregatte/kreuzer.damage` 1,5 | 9 / 5,2 | 16,7 / 13,3 |
| Pool 12, [6,3,0,3] | 4,6 / 5 | 21,6 / 16,6 |
| `shields.regenDelay` 3 | 22,6 / 17,7 | 28,6 / 17,1 |
| `spaceS2b.sperrfeuer.interval` 5 | 22,6 / 31,5 | 29,6 / 31,4 |
| `spaceS2b.sperrfeuer.burst` 1 | 22,6 / 38,9 | 29,6 / 37,4 |
| `shields.regenDelay` 0 (Verstoß gegen Abnahme 4) | 22,2 / 53,1 | 29,1 / 41,3 |

Nur der Wegfall der Pause (nicht erlaubt) und ein auf einen Schuss gekürztes Sperrfeuer (Waffe verstümmelt) bringen Crew 3 in die Nähe des Fensters, und beides nur für Crew 3. Crew 2 bleibt bei 22 / 29, weil dort die KI-Seitenwechselzeit die Größe bestimmt. Die Seitenwechselzeit (`pilotKlasse.*.switchCd` auf 24 bis 30 s zu stellen) würde die Größe ins Fenster schieben, aber die Lerche **schwächer** machen (die Breitseite bleibt länger auf derselben Seite). Das habe ich nicht getan: Eine Zahl, die durch eine KI-Einstellung in ein Fenster fällt und dabei die Spielstärke verschlechtert, ist keine Kalibrierung.

**Empfehlung für Kai/Entwicklungsleiter:** Die Abnahme „Zeit bis Sektor 0“ ersetzen durch die robusten Größen der Zweitmessung und der Bot-Läufe (Tabellen unten): Zeit bis eine Seite komplett zerstört ist (Zone leer), Zeit bis Reaktor zerstört, Zeit von Zone leer bis Reaktor zerstört (mindestens 6 s durch das Fenster) und die Überlebensquote der Lerche in `sys01-lauf` (Crew 2: Fregatte 72 → 87 von 100 gespawnten Gegnern, Kreuzer 68 → 76). Ein Zielfenster für die Zeit bis Sektor 0 ist nur sinnvoll, wenn die Messung den Sektor des ersten Treffers einschließt; dann ist sie aber immer < 1 s (Fregatte/Kreuzer: eine Salve leert den Sektor).

### 2. Binär-Prüfung (Abnahme 7)

**Lerche-Seite** (`sys01-gegnerfeuer`, Zweitmessung, Median s ab 1. Treffer, (min–max, n von 20); Reaktor in 120 s):

| Klasse | Crew | Zone leer vorher → nachher | Reaktor zerstört vorher → nachher | **Zone leer → Reaktor zerstört vorher → nachher** |
|---|---|---|---|---|
| korvette | 2 | 90,7 (9/20) → 51,4 (5/20) | 53,7 (3/20) → 74 (2/20) | 7,2 (**4,8**–22,8, 3/20) → 51,1 (**42,8**–51,1, 2/20) |
| korvette | 3 | 31,5 (9/20) → 37 (9/20) | 63,1 (9/20) → 68,4 (9/20) | 21,2 (**4,1**–42,4, 9/20) → 21,2 (**10,5**–47,7, 9/20) |
| fregatte | 2 | 51,3 (15/20) → 60,4 (12/20) | 74,1 (9/20) → 77 (5/20) | 26 (**4,4**–66, 9/20) → 47 (**27**–77,2, 5/20) |
| fregatte | 3 | 20,8 (17/20) → 26,5 (17/20) | 44,2 (17/20) → 44,2 (17/20) | 17,7 (**4**–42,4, 17/20) → 21,2 (**8,3**–42,4, 17/20) |
| kreuzer | 2 | 34,7 (17/20) → 30 (15/20) | 40,1 (12/20) → 43,2 (10/20) | 25,2 (**5,2**–63,7, 12/20) → 30,1 (**6,1**–67,7, 10/20) |
| kreuzer | 3 | 18,7 (18/20) → 18,7 (18/20) | 37,2 (18/20) → 39,3 (18/20) | 9,6 (**2,9**–42,4, 18/20) → 15,9 (**8,8**–47,7, 18/20) |

Die Beobachtung „Reaktor fällt in ca. 4 s, sobald die Bug-Zone leer ist“ ist bestätigt (kleinster Wert vorher 2,9 s Kreuzer Crew 3, 4 s Fregatte, 4,1 bis 4,8 s Korvette) und mit dem Fenster auf mindestens 6,1 s angehoben (alle Klassen, Crew 2 und 3); die Mediane steigen bei Fregatte Crew 2 von 26 auf 47 s, bei Kreuzer Crew 3 von 9,6 auf 15,9 s. Der Reaktor der stehenden, wehrlosen Lerche fällt gegen Fregatte/Kreuzer weiter in 2 bis 18 von 20 Läufen (kein Reparieren, keine Gegenwehr: ein Worst Case; für das Spiel zählen die Bot-Läufe unten). Ob „mehrere Sekunden bis Dutzende“ für Kai passt, entscheidet der Spieltest.

**Gegner-Seite** (Bot-Läufe `sys01-lauf`, Arena, Seeds 1–20, 5 Wellen à 1 Gegner, Median s; „Zone offen“ = erste Seitenzone ohne lebendes System):

| Klasse | Crew | Schaden → Reaktor zerstört vorher → nachher | **Zone offen → Reaktor zerstört vorher → nachher** (min–max) | Spawn → Tod vorher → nachher |
|---|---|---|---|---|
| raider | 2 | 46,2 → 47,6 | (Reaktor oft vor „Zone offen“) 14 → 20 | 67,9 → 69,9 |
| raider | 3 | 42 → 46,6 | 13,8 → 17,6 | 63,6 → 69,1 |
| korvette | 2 | 11,4 → 18,8 | 2,5 (1,6–86,9) → **7,8 (6,7**–128,9) | 36,4 → 44,1 |
| korvette | 3 | 11,3 → 16,4 | 2,5 (1,4–78,1) → **7,8 (7,2**–93,7) | 36,6 → 41,8 |
| fregatte | 2 | 40,8 → 47,6 | 6,9 (2,2–170,2) → **29,1 (7,3**–91,4) | 67,7 → 74 |
| fregatte | 3 | 46,3 → 41,9 | 17,2 (2,2–157,2) → **19,8 (7,2**–107,7) | 72,9 → 70,1 |
| kreuzer | 2 | 38,3 → 56,3 | 2,8 (2,3–125,2) → **27,6 (7,4**–184,7) | 65,8 → 82 |
| kreuzer | 3 | 37,6 → 48,1 | 2,5 (2,1–204,6) → **17,6 (7,3**–172,5) | 66,6 → 73,8 |

Kein Gegner fällt in einem einzigen Zug nach dem Schildbruch: erster Systemschaden am Gegner 1,2 s nach dem ersten Schaden (Jäger sofort, ein System je Zone), Reaktor zerstört frühestens 6,7 s nach „Zone offen“ (vorher 1,4 s). Ausnahmen, die Regel sind: Torpedo-Durchschlag ohne Fenster (zwei Torpedos zerstören den Reaktor sofort) und `torpedoSofortTod` beim Jäger (ein Torpedo, Kai 2026-10-26). Der Jäger hat so kleine Zonen, dass sein Reaktor oft vor „Zone offen“ fällt (negative Mindestwerte bei Zone offen → Reaktor); sein Schaden → Reaktor zerstört liegt bei 46 bis 48 s. Korvette Crew 3 Spawn → Reaktor zerstört steigt von 16,6 auf 21,8 s (das alte SYS-01-Fenster nannte 13,4 bis 20,2 s Spawn → Tod für Korvette zu dritt; die Zeit liegt jetzt knapp darüber, Spawn → Tod 41,8 s mit 20 s Countdown).

### 3. Abnahme 5: Streufeuer gegen konzentriertes Feuer mit der Standardverteilung

`node tools/sys03-streufeuer.js --rate R --dmg 2 --crews 3 --seeds 10 --sek 120 [--schild 4,2,0,2]` (Standardschuss Schaden 2, Rate 0,3 / 0,5 / 1 Treffer/s; Seeds 1–10, Median s ab 1. Treffer; Streu = reihum über die Seiten mit Schild, konzentriert = alles auf Sektor 0). „∞“ = bricht in 120 s nie.

| Rate | Verteilung | 1. Sektor leer konz. / streu (Quotient) | 1. Systemschaden konz. / streu (Quotient) | Reaktor zerstört konz. / streu (Quotient) |
|---|---|---|---|---|
| 0,3/s | **[4,2,0,2]** (alt) | 3,4 / 3,4 (1,0) | 6,7 / ∞ (∞) | 36,7 / ∞ (∞) |
| 0,3/s | **[4,4,0,4]** (neu) | 3,4 / ∞ (∞) | 6,7 / ∞ (∞) | 36,7 / ∞ (∞) |
| 0,5/s | [4,2,0,2] (alt) | 2 / 2 (1,0) | 4 / 8 (2,0) | 22 / 56 (2,5) |
| 0,5/s | **[4,4,0,4]** (neu) | 2 / 6 (**3,0**) | 4 / 12 (**3,0**) | 22 / 58 (2,6) |
| 1/s | [4,2,0,2] (alt) | 1 / 1 (1,0) | 2 / 4 (2,0) | 14 / 30 (2,1) |
| 1/s | **[4,4,0,4]** (neu) | 1 / 3 (**3,0**) | 2 / 6 (**3,0**) | 14 / 31 (2,2) |

Aussage: Mit der bisherigen Standardverteilung [4,2,0,2] machte Streufeuer den ersten leeren Sektor **nicht** langsamer (Quotient 1,0: der Seitensektor mit 2 Punkten fällt bei Streufeuer beim zweiten Schuss, der Bugsektor bei konzentriertem Feuer ebenfalls), den ersten Systemschaden nur 2-mal. Mit [4,4,0,4] (und Pool 12) sind es 3,0 für den ersten Sektor und den ersten Systemschaden; bei 0,3/s bricht Streufeuer in 120 s keinen Sektor (je Sektor ein Treffer alle 10 s, Pause 5 s, Regeneration danach). Der Reaktor zerstört sich bei Streufeuer 2,2- bis 2,6-mal später. `tools/test-schild-pause.js` prüft Abnahme 5 jetzt mit der Standardverteilung (CONFIG), Schaden 2 und den Raten 0,5 / 1 / 2 (Quotient ≥ 2,5) und 0,3 (Streu bricht nie); vorher mit [3,3,0,2] und 2 bis 4/s.

### Gewählte Hebel: Messungen (Entscheidungsgrundlage)

Passive Lerche (`sys01-gegnerfeuer`, Seeds 1–40, Crew 2/3, Reaktor zerstört in 120 s, n von 40; Basis = Stand mit `reaktorFenster_s` 6):

| Variante | Fregatte c2 / c3 | Kreuzer c2 / c3 |
|---|---|---|
| Basis (Fenster 6) | 17 / 34 | 24 / 37 |
| Pool 12, [4,4,0,4] | 12 / 34 | 22 / 37 |
| `regenDelay` 3 | 17 / 27 | 23 / 29 |
| `regenDelay` 3, `regenInterval` 1 | 16 / 27 | 22 / 28 |
| `regenDelay` 2, `regenInterval` 1 | 11 / 27 | 22 / 28 |
| `regenDelay` 0 (nicht erlaubt) | 7 / 22 | 16 / 26 |
| `enemies.*.damage` 1,5 | 13 / 34 | 22 / 37 |
| `sperrfeuer.burst` 2 / 1 | 9 / 34, 4 / 34 | 22 / 37, 19 / 37 |
| `sperrfeuer.interval` 5 | 14 / 34 | 23 / 37 |

Die passive Lerche stirbt irgendwann an jedem Gegner (kein Reparieren); nur die Bot-Läufe zeigen, was die Crew daraus macht. `sys01-lauf` (Seeds 1–30, 5 Wellen à 1 Gegner; „Gegner“ = von höchstens 150 gespawnten Gegnern, weniger heißt: die Lerche fiel vorher; Reaktorausfälle der Lerche je Lauf):

| Variante | Fregatte c2 | Kreuzer c2 | Fregatte c3 | Kreuzer c3 |
|---|---|---|---|---|
| Basis (Pool 8, Fenster 6) | 103 / 1,5 | 86 / 1,0 | 141 / 0,5 | 130 / 0,3 |
| **Pool 12, [4,4,0,4] (gewählt)** | **130 / 0,9** | **117 / 1,2** | **145 / 0,1** | **133 / 0,4** |
| Pool 16, [5,6,0,5] | 119 / 0,8 | 127 / 1,0 | – | – |
| Pool 12, `regenDelay` 3 | 125 / 1,0 | 115 / 0,9 | – | – |
| Pool 12, Fenster 10 | 127 / 0,8 | 119 / 1,0 | – | – |

Pool 12 verschiebt die Überlebensquote von Crew 2 deutlich (Fregatte 69 → 87 %, Kreuzer 57 → 78 %); alle weiteren Schritte bleiben im Rauschen. Die Reaktorausfälle je Lauf bleiben bei Crew 2 um 1 (zwei Bots, kein Spieler). Die Messung am eingecheckten Stand (20 Seeds, Crew 2/3, vorher → nachher): Fregatte c2 72 → 87 Gegner / 1,4 → 0,9 Ausfälle, c3 92 → 95 / 0,4 → 0,2; Kreuzer c2 68 → 76 / 1,6 → 0,9, c3 91 → 84 / 0,8 → 0,3 (die Gegnerzahl bei Kreuzer Crew 3 liegt im Rauschen, die Ausfälle sinken); Korvette 0,4 → 0,2 / 0; Jäger 0.

### 4. Bots (Abnahme 9)

**Arena `maneuver`, Crew 3** (`node tools/sim-headless.js arena --pilot maneuver --seeds 8 --players 3`, 6 Wellen, Seeds 1–8; vorher = 7c31ff2): Wellen geschafft 4,4 → **4,8**, Hüllenverlust (Integrität) 89,5 → **43,3**, Notfallprotokolle je Lauf 0,5 → 0,3, Eskalationen 3,1 → 2,1, Dauer 871 → 877 s; Ausgang `SIM ARENA OK`, Exit 0, **0 Softlocks** (kein Lauf bricht ab; Seed 5 bleibt mit 2/6 Wellen und vier Wellen über 180 s der schwächste Lauf, vorher Seeds 3 und 5 mit 2/6 und 1/6). Je Seed nachher: 5, 6, 6, 5, 2, 5, 4, 5 von 6 Wellen.

**Solo-Kreuzer** (Crew 1, `sys01-lauf --kinds fregatte,kreuzer --crews 1 --seeds 20`, Seeds 1–20, 5 Wellen à 1 Gegner; kein Maßstab, berichtet): Kreuzer 47 gespawnte Gegner → 52 (von 100), davon zerstört 27 → 34, Lerche-Reaktorausfälle je Lauf 3,5 → 2,9; Fregatte 69 → 76 gespawnt, zerstört 54 → 64, Ausfälle 2,2 → 1,9. Solo ist gegen Fregatte und Kreuzer weiter knapp bis schwer (der Bot-Solo spielt zwei Konsolen nacheinander); schaffbar ist ein einzelner Kreuzer (Spawn → Tod Median 110 s, 34 von 52 Gegnern fallen), die Folge von fünf Wellen meist nicht.

**Kette, Kapitel 6 (Orbit), Crew 3.** Befund vorher: Die Testkette (`sim-headless kette --seed 1 --seeds 3`) hatte für Crew 3 nur 1/3 (Seeds 1 und 2 brechen bei Spielzeit 14000 s ab, Kapitel 6 endet mit „Rückzug“ immer wieder). Einstieg `--kapitel k6_orbit --crew 3 --seeds 6` auf 7c31ff2: 4/6 (Seeds 2 und 5 hängen bis 5000 s im Rückzug-Kreis, Seed 3 mit einem Rückzug), nachher **6/6 im ersten Anlauf, ohne Rückzug** (Dauer 6,9 bis 10,5 min; Crew 1: 5/6, Seed 1 braucht drei Rückzüge). **Ursache:** „Rückzug“ ist hier der Ausgang des Notfallsprungs: Die Lerche der Bots verliert in der Orbit-Schlacht den Reaktor (Fregatte, Kreuzer und Flaggschiff treffen Systeme direkt; Pool 8 reichte nicht, der Reaktor fiel nach dem Bug in 3 bis 4 s, siehe Abschnitt 2; im Kapitel selbst nicht weiter aufgeschlüsselt), springt, das Kapitel beginnt von vorn und endet wieder so, bis das Zeitlimit greift. Die Bot-Balance selbst (Zielwahl, Schildverteilung) ist nicht die Ursache; der Bot ist unverändert (`BOT_SCHILD_SEKTOR_MAX` 4, siehe C1: mit Pool 12 und Standardverteilung [4,4,0,4] wird die Bedrohungsseite auf 4 gefüllt, die übrigen Seiten bleiben auf ihrer Zuteilung). **Behoben** mit Pool 12 und dem Reaktor-Fenster. Ganze Kette (6 Kettenläufe): `node tools/sim-headless.js kette --seed 1 --seeds 3 --mindest 2` Crew 1 **3/3** (Spielzeit 118 / 143 / 59 min, alle ok), Crew 3 **3/3** (79 / 55 / 29 min), vorher Crew 1 3/3, Crew 3 1/3; `SIM KETTE OK (Quote)`, Exit 0, Laufzeit 5 min 5 s (Wand). Die Testkette verlangt jetzt `--mindest 2` je Crew (Reserve ein Lauf).

**Laufzeit `npm test`** (echter Exit-Code): vorher 7c31ff2 **22 min 4 s** (Wand, mit paralleler Last aus meinen Messläufen), nachher **14 min 15 s** (Exit 0, 187 von 187 Prüfungen im letzten Abschnitt; während der letzten Minuten lief eine einzelne Messung nebenher). Größte Posten (einzeln gemessen): Kette mit 6 Kettenläufen rund 5 min (vorher länger: Crew 3 lief zweimal bis 14000 s Spielzeit), `sim-sund --weg beide --crew 3` 30 s, `--kapitel alle --crew 3` 16 s, `test-finale-orbit` 30 s, `test-sl9` 9 s; die übrigen rund 180 Testdateien teilen sich den Rest. Das ist vertretbar; wer sie weiter kürzen will, nimmt `--seeds 2 --mindest 2` in der Kette (spart etwa 1,7 min, verliert die Reserve).

### 5. Tests wieder angezogen (Abnahme 10 vorbereitet)

| Prüfung | vorher (gelockert) | nachher | Messwert / Begründung |
|---|---|---|---|
| `test-sl9` `LERCHE_MIN_PCT` | 0 | **10** (Seeds 1, 4, 6 alle als Zusage) | Seeds 1–11 kleinste Integrität 19 bis 97 % (Seeds 1, 4, 6: 19, 32, 81 %); Seed 12 10 %. Fenster der Schlacht 1200 → **700 s** (gemessen 272 bis 490 s, Seeds 1/4/6: 319/333/318 s). |
| `test-sl9` `SOELDNER_LEBEN_MIN` | Seed 1: 1, Seed 4: 1 (Info) | **2 für alle Seeds**, Schlechtfall-Zweig (nur Info) entfernt | In Seeds 1–11 leben beide Söldnerschiffe; nur Seed 12 (kein Prüfseed) verliert beide. |
| `test-sl3` Fenster | 31–150 s | **bleibt 31–150 s** | Neu gemessen (Seeds 1–12): 41,9 bis 134,5 s, Median 60,5 (Seeds 2/4/6: 50/61,5/57,8 s). Das Fenster ist die Messung ± Rand, durch D nicht verschoben: kein Spielraum zum Anziehen ohne Brüchigkeit. |
| `test-faden-katalog-b2` Vollschild je Tick | Schild je Tick voll | **entfernt** | Mit Pool 12 verliert Seed 72 die Beute nicht mehr; Test läuft ohne Eingriff. |
| `test-bot-reparatur` | Eintrag hängt höchstens 30 s | **wieder: Liste nach dem ersten ok durchgehend leer** | In allen vier Läufen hing kein Eintrag (0,0 s). |
| `test-combat` Ausweichen | `weicht <= kurs` | **wieder `weicht < kurs × 0,6`** | Seeds 101–106: steht 64, Kurs 10, weicht 2,5 (Verhältnis 0,25). |
| `test-finale-orbit` Crew 1 5/8 exakt | Mindest 5/8 für alle (Crew 1 gemessen 5/8) | **Crew 1: 5, Crew 2: 6, Crew 3: 6 von 8** (je 1 Seed Reserve) | Gemessen jetzt Crew 1 6/8 (Seed 25 Zeitlimit, 27 Niederlage), Crew 2 7/8, Crew 3 7/8 (jeweils Seed 27 verloren). |
| `test-finale-ende-zu-ende` `erholen` (Countdown-Reset) | Reset, „Balance folgt in D“ | **bleibt** | Geprüft: ohne die Zeile scheitert der Test (der Countdown des vorigen Versuchs läuft in den nächsten hinein); Ursache nicht weiter untersucht, offener Punkt, keine Balance-Lockerung. |
| `test-schild-pause` Abnahme 5 | Start [3,3,0,2], Raten 2 bis 4/s, Rohschaden 1 | **Standardverteilung (CONFIG), Schaden 2, Raten 0,5 / 1 / 2 (Quotient ≥ 2,5) und 0,3 (Streu bricht nie)** | siehe Abschnitt 3. |

Neu: `test-direkttreffer` und `test-direkttreffer-gegner` prüfen das Reaktor-Fenster (Lerche, Gegner, Verbündete), `test-direkttreffer` zusätzlich `tune systemModell.reaktorFenster_s` (2 und 12 s, andere Mitte-Systeme bleiben beim Standard-Fenster). Angepasst an Pool 12 und das Fenster: `test-m3` (Pool 12 / 18), `test-schild-b2`, `test-energie` (Pool 12), `test-combat` (Jäger-Salven 40 statt 14, Reaktor frühestens nach dem Fenster).

### 6. Sund-Läufe (Abnahme 10)

- `node tools/sim-sund.js --kapitel alle --crew 3`: `SIM SUND OK`, **Exit 0**, 16 s (elf Einstiege k1 bis k10 alle ok).
- `node tools/sim-sund.js --weg beide --crew 3`: `SIM SUND OK`, **Exit 0**, 29 s (beide Wege Lösegeld/Söldner bis k10 ok).
- `node tools/sim-szene-sund.js` (nur gemessen, nicht in der Testkette, war schon vorher rot): vorher 5 Befunde, nachher 5 Befunde (Exit 1 beide). Stärke 8: Zeitlimit 900 s in Seed 11 (vorher) bzw. beiden Seeds (nachher; die Lerche des Bots kommt gegen Korvette/Fregatte nicht zum Abschluss); Stärke 17 und 40: Niederlage der Lerche in der ersten Welle in beiden Ständen (Hülle 45/62 % und 19/6 % am Ende, Notfall 1); Hafen Misserfolg (Crew passiv, Germanen 40): Zeitlimit in beiden Seeds, beide Stände; Posten Misserfolg (Crew passiv, Germanen 20): Zeitlimit in 2/2 Seeds vorher, in 1/2 nachher (Seed 12 verliert nach 817 s wie vorgesehen); Erfolgsfälle (Hafen, Posten, freie Schlacht) bleiben ok, Hafen Erfolg schneller (353/407 → 313/328 s). Keine Kalibrierung, wie beauftragt.
- `k3_falle` (nur gemessen): Zeit bis Verlust der wehrlosen Lerche in der Falle (6 Piraten) nach D 50 / 61,5 / 57,8 s (Seeds 2/4/6), Median über Seeds 1–12 60,5 s (vorher C1: 42 / 68 / 58 s, Median der 8 Seeds etwa 63 s); `sim-sund --kapitel alle` Einstieg k3_falle ok (0,2 min).

### 7. Golden (Abnahme 10)

`node tools/golden-trace.js --all --seeds 20 --jobs 4 --dir <neuer Ordner>` (immer `--dir`, die eingecheckten Basen sind unverändert): Läufe `golden-sys03-d` (Stand D), `golden-main` (frischer Lauf von `main` im Worktree `Pantheon-main`, 977a8de) und `golden-sys03-c2` (7c31ff2), alle außerhalb des Repos (`%TEMP%`).

| Vergleich | byte-identisch | Median Spieldauer m1/1 · m1/3 · m2/1 · m2/3 · m3 | Befunde |
|---|---|---|---|
| D gegen frisches `main` | 40/120 | +7,3 % · **+16,8 %** · **+15,4 %** · **+17 %** · 0 % | 151 |
| D gegen `base-pan01c3` (`allow-pan01c3.json`) | 41/120 | +7,2 % · +13,5 % · **+33,4 %** · **+30,7 %** · 0 % | 174 |
| frisches `main` gegen `base-pan01c3` (Maßstab) | – | −0,2 % · −2,8 % · +15,6 % · +11,7 % · 0 % | 161 |
| D gegen C2 (7c31ff2) | 43/120 | +4,6 % · +1,3 % · +10,8 % · +5 % · 0 % | 147 |
| C2 gegen frisches `main` | 40/120 | +2,7 % · **+15,3 %** · +4,2 % · +11,4 % · 0 % | 167 |

Abweichungen: (1) **m3 identisch** (kein Raumkampf). (2) m1 und m2 spielen sich länger: Gegner (Jäger, Korvette) fallen später (Stufenregel, Reaktor-Countdown, Gegner reparieren, bei D zusätzlich das Reaktor-Fenster von 6 s für Gegner), die Lerche verliert Systeme statt Hülle; der Anteil von D allein ist klein (+1,3 bis +10,8 % gegen C2), der Rest steckt in SYS-01 bis SYS-03 C. Gegenüber `main` liegen drei Mediane knapp über der ±15-%-Grenze (m1/3 +16,8 %, m2/1 +15,4 %, m2/3 +17 %), gegenüber der alten PAN-01-Basis mehr (m2 +31 bis +33 %, schon `main` selbst liegt dort +15,6 % bzw. +11,7 %). (3) Texte: neue Meldungen des Systemmodells („Bug-Waffe beschädigt“, „emitter_bb des Ziels beschädigt“, „Korvette lädt – Backbord!“, „Ein System ist beschädigt – E halten: flicken …“), fehlende alte („Schildsektor leer! Technik: …“, „Breitseite … Hüllenbruch!“, „Transfer beschädigt“ je nach Seed). (4) Inventar: Ersatzteile, Flickblech und Marken weichen je Seed um 1 bis 2 ab (anderer Kampfverlauf), keine neuen Schlüssel. (5) Flags: `mNDirect` undefined ↔ false, `rostmeuteGone`/`vaelenHelped` in einzelnen Seeds (anderer Kampfausgang); kein Softlock. **Keine neue Basis eingecheckt:** Die Abweichungen sind erklärt, aber ein neuer Maßstab braucht eine `--allow`-Datei, die Kai freigibt (Texte, Inventar, Dauer m1/3, m2/1, m2/3); der Lauf `golden-sys03-d` liegt zum Einchecken bereit (`tools/fixtures/golden/base-sys03` + `allow-sys03.json`, etwa 1,4 MB). Der Maßstab bleibt ein frischer `main`-Lauf.

### 8. Prüfstand (echte Exit-Codes, Stand dieses Commits)

| Befehl | Ergebnis |
|---|---|
| `npm test; echo EXIT=$?` | **EXIT=0**, 14 min 15 s |
| `npm run check` | **EXIT=0** |
| `npm run snap:mess` | **EXIT=0**, Worst Case max 11 800 B (Budget eingehalten) |
| `node tools/sim-sund.js --kapitel alle --crew 3` / `--weg beide --crew 3` | **EXIT=0** / **EXIT=0** |
| `node tools/sim-headless.js arena --pilot maneuver --seeds 8 --players 3` | `SIM ARENA OK`, Exit 0 |
| `node tools/sim-headless.js kette --seed 1 --seeds 3 --mindest 2` | `SIM KETTE OK (Quote)`, Exit 0 (Crew 1 3/3, Crew 3 3/3) |

### Offen (aus Paket D)

- Zielfenster „Zeit bis Sektor 0“ (Abnahme 6) ist nicht erreicht und mit den Hebeln des Auftrags nicht erreichbar (Abschnitt 1); die Abnahme sollte durch die robusten Größen ersetzt werden.
- `test-finale-ende-zu-ende` braucht den Countdown-Reset zwischen den Versuchen (Ursache nicht untersucht).
- Crew 2 und 3 unterscheiden sich in `sys01-gegnerfeuer` stark (Reaktor der stehenden Lerche in 120 s: Fregatte 5/20 gegen 17/20, Kreuzer 10/20 gegen 18/20): gleiche Gegnerbestückung, aber ein Spieler mehr; Ursache nicht untersucht.
- `sim-szene-sund` bleibt rot (Befunde unverändert, nicht Teil des Auftrags).
- Die Gegnerbewaffnung (Sperrfeuer: 3 Nadeln je Stoß, jede kostet auf einem leeren Sektor eine Stufe auf ein anderes System der Zone) ist der größte Einzelposten der Systemschäden an der stehenden Lerche (rund 60 % der Direkttreffer bei Fregatte/Kreuzer, 89 von 142 Direkttreffern bei Fregatte Crew 3, 84 von 142 beim Kreuzer, je 6 Seeds à 60 s). Ein Salven-Fenster je Zone statt je System würde das glätten; das wäre eine Regeländerung (Salve = eine Stufe) und nicht Teil von D.
