# Basis-Bericht der Bot-Läufe (win32-x64)

Erzeugt aus `basis-win32-x64.json` (`npm run basis`), ersetzt die Handtabellen der README. Gilt nur für **win32-x64**: auf anderer Plattform ist der Raumkampf nicht bit-gleich, der Bericht meldet das als Datenzeile.

- Spielstand wie `dde9358e` (Commit der Läufe `f4d32c1e`), Node v22.20.0, Kennzahl-Version 1, Tuning-Hash `e71b823e4e1d52b2`, Stand 2026-11-11.
- 12 Seeds je Gruppe, Laufzeit 14:30 min (4 Prozesse parallel), keine Fehlerläufe.
- Schwelle für „auffällig“ (Bericht): Abstand zur Spanne Min–Max der Basis-Seeds größer als max(25 %, 2 × IQR) UND Abstand zum Median mindestens die Mindestmenge der Kennzahl (innerhalb der Spanne ist nie etwas auffällig). Technik (Tickzeit, Snapshot) steht nicht in der Basis.
- Schreibweise: `Schlüssel Median [Min–Max]`; fehlende Zähler und Summen (`summe: true` in KENNZAHL_INFO) gelten als 0, Quoten, Mittel und Mediane fehlen einfach (Kennzahlen mit weniger als 4 Läufen in der Basis werden nicht verglichen). Ausgang `rot` = das Bot-Skript meldete Misserfolg (kein Sieg, Softlock); das Protokoll ist gültig und zählt mit.

## Was der Einzellauf gegen die Basis erkennt

Rückwärtsprobe, Stand 2026-11-03, neu gefahren in TEL-01 M gegen die Basis auf 75ab5a7: je Gruppe 6 frische Läufe mit den Seeds 101–106 (96 Läufe, nicht Teil der Basis); in einer Kopie der Kennzahlen wird EINE Kennzahl künstlich verschoben und gezählt, ob die Bewertung genau diese meldet (Fälle = Kennzahl × Lauf). Die Probe liegt nicht im Repo und veraltet mit jeder neuen Basis. Graben, Kesh und Wellen sind gegenüber dem Stand f2daff7 unverändert, nur Raumkampf-Arena und Kampagne haben sich mit GEG-01 verschoben.

**Fehlalarme** (frischer Lauf, nichts verschoben): im Mittel 0,59 Kennzahlen je Lauf, 18 von 96 Läufen mit mindestens einer. Je Gruppe 0 bis 3,5, nur Wellen Ruine fällt auf (3,5 solo: ein Lauf mit 19 Kennzahlen; 2,3 zu dritt: ein Lauf mit 14, jeweils bei einem ungewöhnlich langen Gefecht).

| Verschobene Kennzahl | Graben | Raumkampf-Arena | Kampagne | Kesh | Wellen |
|---|---|---|---|---|---|
| Quote eigene x1,5 (max 100) | 50 % (6/12) | 0 % (0/20) | 0 % (0/14) | 17 % (2/12) | 24 % (25/103) |
| Quote eigene x0,5 | 50 % (6/12) | 92 % (22/24) | 100 % (24/24) | 58 % (7/12) | 24 % (28/117) |
| Quote Gegner x1,5 (max 100) | 71 % (12/17) | - | - | 0 % (0/10) | 2 % (3/131) |
| Quote Gegner x0,5 | 100 % (18/18) | - | - | 17 % (2/12) | 25 % (57/230) |
| Schaden aus roh x2 | 100 % (6/6) | 67 % (8/12) | 100 % (12/12) | 33 % (2/6) | 18 % (11/60) |
| Schaden ein roh x2 | 100 % (6/6) | 8 % (1/12) | 8 % (1/12) | 0 % (0/6) | 22 % (13/60) |
| Zeit bis Kill x2 | 92 % (11/12) | 49 % (19/39) | 56 % (30/54) | 33 % (3/9) | 31 % (54/174) |
| Zeit bis Kill x1,5 | 0 % (0/12) | 10 % (4/39) | 31 % (17/54) | 11 % (1/9) | 7 % (12/174) |
| Sessiondauer +30 % | 100 % (6/6) | 25 % (3/12) | 33 % (4/12) | 0 % (0/6) | 2 % (1/60) |
| Sessiondauer -30 % | 100 % (6/6) | 0 % (0/12) | 33 % (4/12) | 33 % (2/6) | 0 % (0/60) |
| Kills gesamt x0,5 | 100 % (6/6) | 0 % (0/11) | 0 % (0/12) | 0 % (0/6) | 2 % (1/59) |
| Gefallen n x2 | 100 % (6/6) | - | - | 0 % (0/5) | 7 % (4/60) |

- **Meist erkannt:** halbierte eigene Quote (Kampagne 100 %, Raumkampf 92 %), verdoppelte Zeit bis Kill im Graben (92 %) und in der Kampagne (56 %), verdoppelter eigener Schaden im Graben und in der Kampagne (je 100 %) und im Raumkampf (67 %).
- **Meist nicht erkannt:** Dauer ±30 % (nur im Graben 100 %, aber dort enden alle Läufe am Zeitlimit: kein Balance-Befund), eigener Schaden ×2 außer in Graben, Kampagne und Raumkampf (Wellen 18 %, Kesh 33 %), erlittener Schaden ×2 außer im Graben, halbierte Kills, um die Hälfte höhere Quoten, Gegnerquote außer im Graben. Zeit bis Kill ×1,5 fällt in den meisten Gruppen durch.
- Grund: Mit 12 Seeds fasst die Spanne Min–Max schon fast jeden Wert ein, und die Streuung weitet den Normalbereich zusätzlich. Das ist Absicht (wenige Fehlalarme), kostet aber Trefferquote.
- **Der Einzellauf ist ein Rauchmelder für grobe Brüche und Datenfehler, kein Balance-Messgerät.** Für Balance-Änderungen Gruppe gegen Gruppe vergleichen (`npm run vergleich`, Paket D2; Kerben nach McGill, die mit der Zahl der Läufe schärfer werden).

| Gruppe | Läufe | Ausgang | Spielzeit (Median) |
|---|---|---|---|
| `arena_away/aussenposten/1` Wellen aussenposten solo | 12 | ok 12 | 2:15 min |
| `arena_away/aussenposten/3` Wellen aussenposten zu dritt | 12 | ok 12 | 5:51 min |
| `arena_away/kesh/1` Wellen kesh solo | 12 | ok 12 | 103 s |
| `arena_away/kesh/3` Wellen kesh zu dritt | 12 | ok 12 | 3:05 min |
| `arena_away/ruine/1` Wellen ruine solo | 12 | ok 12 | 118,1 s |
| `arena_away/ruine/3` Wellen ruine zu dritt | 12 | ok 12 | 3:38 min |
| `arena_away/schiff/1` Wellen schiff solo | 12 | ok 12 | 108,9 s |
| `arena_away/schiff/3` Wellen schiff zu dritt | 12 | ok 12 | 4:26 min |
| `arena_away/station/1` Wellen station solo | 12 | ok 12 | 114,4 s |
| `arena_away/station/3` Wellen station zu dritt | 12 | ok 12 | 4:60 min |
| `arena_graben/3` Grabenangriff zu dritt | 12 | ok 12 | 25:00 min |
| `arena_space/maneuver/3` Raumkampf-Arena zu dritt, Steuer maneuver | 12 | ok 12 | 14:35 min |
| `arena_space/nose/3` Raumkampf-Arena zu dritt, Steuer nose | 12 | ok 12 | 18:14 min |
| `m1/1` Kampagne solo (M1, M2) | 12 | ok 11, rot 1 | 19:46 min |
| `m1/3` Kampagne zu dritt (M1, M2) | 12 | ok 11, rot 1 | 16:30 min |
| `m3/3` M3 Die Tafel von Kesh zu dritt | 12 | ok 11, rot 1 | 3:02 min |

## arena_away/aussenposten/1 – Wellen aussenposten solo

`node tools/sim-headless.js wellen --karte aussenposten --players 1 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 134,6 [110,4–250,7] · dauer.wellen_boden.mittel 119,57 [95,37–235,67] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 119,57 [95,37–235,67] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 1 · spieler.nachzuegler 0 · spieler.start 1
  wellen.dauer_mittel 29,82 [22,25–38,52] · wellen.geschafft 2 [2–5]
- **F2 Gefecht:** gefecht.boden 94 [66–166] · gegner_neu.boden 6 [6–21] · gegner_weg.boden 3 [3–15] · kills.boden.gesamt 6 [4–16] · kills.boden.grundtyp 4 [2–8]
  kills.boden.niederhalter 0 [0–3] · kills.boden.schuetze 2 [1–5] · kills_von.gegner 0 [0–1] · kills_von.p1 5,5 [4–15] · quote.boden.blaster 58,54 [40,63–80]
  quote.boden.pistol 66,67 [27,78–100] · quote_gegner.boden.blaster 100 [66,67–100] · quote_gegner.boden.granatwerfer 100 · quote_gegner.boden.lanze 100
  quote_gegner.boden.schrottblaster 84,52 [40–100] · quote_gegner.boden.sturmgewehr 6,41 [0–21,43] · quote_wirkt.boden.blaster 58,54 [40,63–80]
  quote_wirkt.boden.pistol 66,67 [27,78–100] · quote_wirkt_gegner.boden.blaster 100 [66,67–100] · quote_wirkt_gegner.boden.granatwerfer 100
  quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.schrottblaster 84,52 [40–100] · quote_wirkt_gegner.boden.sturmgewehr 6,41 [0–21,43]
  schaden.boden.aus.roh 23,5 [16–63] · schaden.boden.aus.schild 18,5 [12–48] · schaden.boden.aus.wirkt 5,5 [4–15] · schaden.boden.ein.roh 9,5 [8–26,5]
  schaden.boden.ein.schild 8 [6–24] · schaden.boden.ein.wirkt 1 [0,5–2] · schuesse.boden.blaster 33 [15–89] · schuesse.boden.pistol 7,5 [0–18]
  schuesse_gegner.boden.blaster 2,5 [1–6] · schuesse_gegner.boden.granatwerfer 0 [0–2] · schuesse_gegner.boden.lanze 1 [1–7]
  schuesse_gegner.boden.schrottblaster 6,5 [4–11] · schuesse_gegner.boden.sturmgewehr 0 [0–93] · treffer_je_schuss.boden.blaster 0,59 [0,41–0,8]
  treffer_je_schuss.boden.pistol 0,67 [0,28–1] · treffer_je_schuss_gegner.boden.blaster 1 [0,67–1] · treffer_je_schuss_gegner.boden.granatwerfer 1
  treffer_je_schuss_gegner.boden.lanze 2 [1–3] · treffer_je_schuss_gegner.boden.schrottblaster 0,85 [0,4–1]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,06 [0–0,21] · treffer_n.boden.aus 23,5 [16–63] · treffer_n.boden.ein 8,5 [6–22] · ueberhitzt.boden.gegner 1 [1–7]
  zeit_bis_kill.boden.grundtyp 19,81 [11,79–28,48] · zeit_bis_kill.boden.niederhalter 24,27 [23,04–33,53] · zeit_bis_kill.boden.schuetze 15,99 [7,53–32,3]
- **F2b Deckung:** deckung.p1.cv_anteil 0 · deckung.p1.cv_s 0 · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 37,18 [13,99–59,82]
  gegner_abstand.min 0,1 [0–0,6] · gegner_abstand.nn_mittel 3,46 [0,65–6,75] · gegner_geduckt_anteil 0 · schuesse_gegner.aus_deckung_anteil 0
  schuesse_spieler.aus_deckung_anteil 0 · treffer_auf_spieler.in_deckung_anteil 0 · treffer_auf_spieler.n 8,5 [6–22] · treffer_von_spieler.aus_deckung_anteil 0
  treffer_von_spieler.n 23,5 [16–63]
- **F3 Verluste:** bodenschild_leer.n 2 [1–6] · erster_verlust_s 85,24 [60,63–161,67] · gefallen.n 1 [1–2] · gefallen.p1 1 [1–2] · neustarts 0 · notfall.n 0
  notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 134 [110–250] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · rolle.p1.boden 134 [110–250] · wechsel.p1 0
- **F5 Wirtschaft:** buchung.medipack.medkit -1 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 1 · konto.medipack.netto -1 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 211,5 [172–566] · protokoll.zeilen_je_min 98,36 [86,78–146,11] · tick.n 4021 [3301–7501]

## arena_away/aussenposten/3 – Wellen aussenposten zu dritt

`node tools/sim-headless.js wellen --karte aussenposten --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 350,6 [164,7–500,4] · dauer.wellen_boden.mittel 335,6 [149,67–485,4] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 335,6 [149,67–485,4] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 31,35 [25,73–42,2] · wellen.geschafft 6,5 [3–9]
- **F2 Gefecht:** gefecht.boden 246 [108–364] · gegner_neu.boden 62 [20–102] · gegner_weg.boden 50 [12–90] · kills.boden.enterer 0 [0–4]
  kills.boden.gesamt 63,5 [16–100] · kills.boden.grenadier 3,5 [0–8] · kills.boden.grundtyp 32 [10–47] · kills.boden.niederhalter 9 [0–14]
  kills.boden.schuetze 18 [6–27] · kills_von.gegner 1 [0–4] · kills_von.p1 17,5 [8–34] · kills_von.p2 19,5 [3–35] · kills_von.p3 19,5 [4–36]
  quote.boden.blaster 46,39 [43,75–54,62] · quote.boden.pistol 72,18 [60,71–96,55] · quote_gegner.boden.blaster 82,14 [60–100]
  quote_gegner.boden.granatwerfer 83,75 [33,33–100] · quote_gegner.boden.lanze 100 · quote_gegner.boden.schrottblaster 74,17 [26,67–100]
  quote_gegner.boden.sturmgewehr 4 [0–7,91] · quote_wirkt.boden.blaster 46,39 [43,75–54,62] · quote_wirkt.boden.pistol 72,18 [60,71–96,55]
  quote_wirkt_gegner.boden.blaster 82,14 [60–100] · quote_wirkt_gegner.boden.granatwerfer 83,75 [33,33–100] · quote_wirkt_gegner.boden.lanze 100
  quote_wirkt_gegner.boden.schrottblaster 74,17 [26,67–100] · quote_wirkt_gegner.boden.sturmgewehr 4 [0–7,91] · schaden.boden.aus.roh 223 [56–372]
  schaden.boden.aus.schild 163,5 [41–271] · schaden.boden.aus.wirkt 61,5 [15–101] · schaden.boden.ein.roh 72,5 [39–135]
  schaden.boden.ein.schild 61,75 [31–118,5] · schaden.boden.ein.wirkt 6,75 [3,5–12] · schuesse.boden.blaster 419,5 [88–617] · schuesse.boden.pistol 46 [23–75]
  schuesse_gegner.boden.blaster 12,5 [5–21] · schuesse_gegner.boden.granatwerfer 6 [0–15] · schuesse_gegner.boden.lanze 7 [2–11]
  schuesse_gegner.boden.schrottblaster 14,5 [6–20] · schuesse_gegner.boden.sturmgewehr 437,5 [24–718] · treffer_je_schuss.boden.blaster 0,47 [0,44–0,55]
  treffer_je_schuss.boden.pistol 0,72 [0,61–0,97] · treffer_je_schuss_gegner.boden.blaster 0,82 [0,6–1] · treffer_je_schuss_gegner.boden.granatwerfer 2,09 [1–3]
  treffer_je_schuss_gegner.boden.lanze 4,96 [3–5,71] · treffer_je_schuss_gegner.boden.schrottblaster 0,74 [0,27–1]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,04 [0–0,08] · treffer_n.boden.aus 223 [56–372] · treffer_n.boden.ein 63,5 [27–118]
  ueberhitzt.boden.gegner 7 [2–11] · zeit_bis_kill.boden.enterer 8,77 [7,74–9,8] · zeit_bis_kill.boden.grenadier 18,82 [8,9–30,77]
  zeit_bis_kill.boden.grundtyp 13,18 [10,43–19,27] · zeit_bis_kill.boden.niederhalter 29,29 [22,2–38,67] · zeit_bis_kill.boden.schuetze 15 [12,33–19,6]
- **F2b Deckung:** deckung.p1.cv_anteil 0 [0–0,56] · deckung.p1.cv_s 0 [0–2,34] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 73,28 [42,9–103,53]
  deckung.p2.cv_anteil 0 [0–0,22] · deckung.p2.cv_s 0 [0–0,93] · deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 74,34 [53,64–103,75]
  deckung.p3.cv_anteil 0 [0–0,62] · deckung.p3.cv_s 0 [0–2,57] · deckung.p3.geduckt_s 0 · deckung.p3.verdeckt_s 68,31 [51,54–97,25]
  gegner_abstand.min 0 [0–0,2] · gegner_abstand.nn_mittel 2,81 [1,97–8,34] · gegner_geduckt_anteil 0 [0–4,23] · peek.episoden 0 [0–3] · peek.mit_schuss 0 [0–3]
  schuesse_gegner.aus_deckung_anteil 0 · schuesse_spieler.aus_deckung_anteil 0 [0–0,82] · treffer_auf_spieler.in_deckung_anteil 0
  treffer_auf_spieler.n 63,5 [27–118] · treffer_von_spieler.aus_deckung_anteil 0 [0–0,86] · treffer_von_spieler.n 223 [56–372] · verlassen.bewegt_n 0 [0–6]
  verlassen.bis_treffer_median 15,5 [10,23–20,77] · verlassen.mit_treffer 0 [0–3] · verlassen.n 0 [0–6]
- **F3 Verluste:** bodenschild_leer.n 14 [7–22] · erster_verlust_s 96,2 [66,17–183,03] · gefallen.n 7 [4–11] · gefallen.p1 3 [1–7] · gefallen.p2 2 [1–3]
  gefallen.p3 2 [1–6] · neustarts 0 · notfall.n 0 · notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 350 [164–500] · dabei.p2 350 [164–500] · dabei.p3 350 [164–500] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0
  rolle.p1.boden 350 [164–500] · rolle.p2.boden 350 [164–500] · rolle.p3.boden 350 [164–500] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 0 · konto.medipack.netto -2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 2099 [550–3198] · protokoll.zeilen_je_min 346,01 [200,36–383,45] · tick.n 10501 [4921–15001]

## arena_away/kesh/1 – Wellen kesh solo

`node tools/sim-headless.js wellen --karte kesh --players 1 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 102,97 [59,97–178,5] · dauer.wellen_boden.mittel 87,93 [44,93–163,47] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 87,93 [44,93–163,47] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 1 · spieler.nachzuegler 0 · spieler.start 1
  wellen.dauer_mittel 15,71 [7,4–24,25] · wellen.geschafft 2 [1–3]
- **F2 Gefecht:** gefecht.boden 60 [34–126] · gegner_neu.boden 6 [3–10] · gegner_weg.boden 3 [1–6] · kills.boden.gesamt 5,5 [1–8] · kills.boden.grundtyp 4 [1–5]
  kills.boden.niederhalter 0 [0–1] · kills.boden.schuetze 2 [0–3] · kills_von.p1 5,5 [1–8] · quote.boden.blaster 60 [39,29–76]
  quote.boden.pistol 78,57 [0–100] · quote_gegner.boden.blaster 100 [60–100] · quote_gegner.boden.lanze 100 · quote_gegner.boden.schrottblaster 76,39 [50–100]
  quote_gegner.boden.sturmgewehr 5 [0–15,79] · quote_wirkt.boden.blaster 60 [39,29–76] · quote_wirkt.boden.pistol 78,57 [0–100]
  quote_wirkt_gegner.boden.blaster 100 [60–100] · quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.schrottblaster 76,39 [50–100]
  quote_wirkt_gegner.boden.sturmgewehr 5 [0–15,79] · schaden.boden.aus.roh 24,5 [9–39] · schaden.boden.aus.schild 19 [8–33] · schaden.boden.aus.wirkt 5,5 [1–8]
  schaden.boden.ein.roh 11 [5–26,5] · schaden.boden.ein.schild 10 [4–23,5] · schaden.boden.ein.wirkt 1 [1–2] · schuesse.boden.blaster 28 [10–70]
  schuesse.boden.pistol 7 [0–15] · schuesse_gegner.boden.blaster 3 [0–6] · schuesse_gegner.boden.lanze 1 [1–7] · schuesse_gegner.boden.schrottblaster 8 [4–13]
  schuesse_gegner.boden.sturmgewehr 0 [0–40] · treffer_je_schuss.boden.blaster 0,6 [0,39–0,76] · treffer_je_schuss.boden.pistol 0,79 [0–1]
  treffer_je_schuss_gegner.boden.blaster 1 [0,6–1] · treffer_je_schuss_gegner.boden.lanze 1,31 [1–2]
  treffer_je_schuss_gegner.boden.schrottblaster 0,77 [0,5–1] · treffer_je_schuss_gegner.boden.sturmgewehr 0,05 [0–0,16] · treffer_n.boden.aus 24,5 [9–39]
  treffer_n.boden.ein 9,5 [4–21] · ueberhitzt.boden.gegner 1 [1–7] · zeit_bis_kill.boden.grundtyp 15,49 [7,37–21,19] · zeit_bis_kill.boden.niederhalter 9,83
  zeit_bis_kill.boden.schuetze 16,87 [8,65–26,75]
- **F2b Deckung:** deckung.p1.cv_anteil 0,45 [0–3,04] · deckung.p1.cv_s 0,47 [0–4,19] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 12,85 [3,5–26,31]
  gegner_abstand.min 0,45 [0–1] · gegner_abstand.nn_mittel 3,52 [1,87–6,83] · gegner_geduckt_anteil 11,06 [1,92–30] · peek.episoden 0 [0–4]
  peek.mit_schuss 0 [0–1] · schuesse_gegner.aus_deckung_anteil 0 [0–9,09] · schuesse_spieler.aus_deckung_anteil 0 [0–2,27]
  treffer_auf_spieler.in_deckung_anteil 0 · treffer_auf_spieler.n 9,5 [4–21] · treffer_von_spieler.aus_deckung_anteil 0 [0–3,7]
  treffer_von_spieler.n 24,5 [9–39] · verlassen.bewegt_n 1 [0–8] · verlassen.bis_treffer_median 15,2 [6,07–22,33] · verlassen.mit_treffer 1 [0–4]
  verlassen.n 1 [0–8]
- **F3 Verluste:** bodenschild_leer.n 2 [1–6] · erster_verlust_s 45,57 [22,47–83,47] · gefallen.n 1 · gefallen.p1 1 · neustarts 0 · notfall.n 0
  notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 102 [58–178] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · rolle.p1.boden 102 [58–178] · wechsel.p1 0
- **F5 Wirtschaft:** buchung.medipack.medkit -1 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 1 · konto.medipack.netto -1 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 204,5 [103–399] · protokoll.zeilen_je_min 119,56 [97,17–148,6] · tick.n 3061 [1741–5341]

## arena_away/kesh/3 – Wellen kesh zu dritt

`node tools/sim-headless.js wellen --karte kesh --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 184,73 [96,83–282,93] · dauer.wellen_boden.mittel 169,7 [81,8–267,93] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 169,7 [81,8–267,93] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 23,94 [15,2–31,95] · wellen.geschafft 4 [2–5]
- **F2 Gefecht:** gefecht.boden 124 [58–196] · gegner_neu.boden 30 [12–42] · gegner_weg.boden 20 [6–30] · kills.boden.gesamt 26 [10–39]
  kills.boden.grenadier 0 [0–1] · kills.boden.grundtyp 14 [7–21] · kills.boden.niederhalter 2,5 [0–5] · kills.boden.schuetze 9,5 [3–14]
  kills_von.gegner 0,5 [0–2] · kills_von.p1 7 [2–13] · kills_von.p2 10 [3–15] · kills_von.p3 9 [3–15] · quote.boden.blaster 40,66 [34,43–53,21]
  quote.boden.pistol 55,67 [36,62–75,86] · quote_gegner.boden.blaster 75 [44,44–100] · quote_gegner.boden.granatwerfer 100 [75–100]
  quote_gegner.boden.lanze 100 · quote_gegner.boden.schrottblaster 65,33 [37,5–76] · quote_gegner.boden.sturmgewehr 7,63 [0–23,53]
  quote_wirkt.boden.blaster 40,66 [34,43–53,21] · quote_wirkt.boden.pistol 55,67 [36,62–75,86] · quote_wirkt_gegner.boden.blaster 75 [44,44–100]
  quote_wirkt_gegner.boden.granatwerfer 100 [75–100] · quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.schrottblaster 65,33 [37,5–76]
  quote_wirkt_gegner.boden.sturmgewehr 7,63 [0–23,53] · schaden.boden.aus.roh 114,5 [43–179] · schaden.boden.aus.schild 89,5 [33–141]
  schaden.boden.aus.wirkt 25 [10–38] · schaden.boden.ein.roh 43,5 [23–98] · schaden.boden.ein.schild 38,25 [17–79] · schaden.boden.ein.wirkt 5,5 [2,5–11,5]
  schuesse.boden.blaster 212,5 [92–398] · schuesse.boden.pistol 41,5 [18–90] · schuesse_gegner.boden.blaster 11,5 [1–24]
  schuesse_gegner.boden.granatwerfer 0 [0–4] · schuesse_gegner.boden.lanze 3,5 [1–12] · schuesse_gegner.boden.schrottblaster 24,5 [15–28]
  schuesse_gegner.boden.sturmgewehr 102 [0–351] · treffer_je_schuss.boden.blaster 0,41 [0,34–0,53] · treffer_je_schuss.boden.pistol 0,56 [0,37–0,76]
  treffer_je_schuss_gegner.boden.blaster 0,75 [0,44–1] · treffer_je_schuss_gegner.boden.granatwerfer 1,59 [1–2]
  treffer_je_schuss_gegner.boden.lanze 2,68 [2–3] · treffer_je_schuss_gegner.boden.schrottblaster 0,66 [0,38–0,76]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,08 [0–0,24] · treffer_n.boden.aus 114,5 [43–179] · treffer_n.boden.ein 40 [17–82]
  ueberhitzt.boden.gegner 3,5 [1–12] · zeit_bis_kill.boden.grenadier 19,57 · zeit_bis_kill.boden.grundtyp 12,86 [8,45–18,97]
  zeit_bis_kill.boden.niederhalter 26,1 [12,1–34,63] · zeit_bis_kill.boden.schuetze 13,63 [5,17–21,22]
- **F2b Deckung:** deckung.p1.cv_anteil 2,27 [0,15–8,41] · deckung.p1.cv_s 5,38 [0,24–14,71] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 13,05 [8,19–34,63]
  deckung.p2.cv_anteil 2,17 [0–4,38] · deckung.p2.cv_s 3,38 [0–12,36] · deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 17,97 [8,66–42,6]
  deckung.p3.cv_anteil 2,86 [0–8,67] · deckung.p3.cv_s 5,27 [0–18,2] · deckung.p3.geduckt_s 0 · deckung.p3.verdeckt_s 15,64 [8,65–39,81]
  gegner_abstand.min 0 [0–0,3] · gegner_abstand.nn_mittel 4 [2,83–4,45] · gegner_geduckt_anteil 9,07 [1,14–15,53] · peek.episoden 2,5 [0–13]
  peek.mit_schuss 2 [0–6] · schuesse_gegner.aus_deckung_anteil 0 [0–1,52] · schuesse_spieler.aus_deckung_anteil 5,07 [0–14,97]
  treffer_auf_spieler.in_deckung_anteil 4,33 [0–11,11] · treffer_auf_spieler.n 40 [17–82] · treffer_von_spieler.aus_deckung_anteil 4,62 [0–17,57]
  treffer_von_spieler.n 114,5 [43–179] · verlassen.bewegt_n 11 [0–23] · verlassen.bis_treffer_median 18,13 [2,8–26,36] · verlassen.mit_treffer 7 [0–13]
  verlassen.n 11,5 [1–25]
- **F3 Verluste:** bodenschild_leer.n 7,5 [3–22] · erster_verlust_s 71,25 [17,67–83,73] · gefallen.n 5 [3–13] · gefallen.p1 2 [1–4] · gefallen.p2 1 [1–7]
  gefallen.p3 1 [1–3] · neustarts 0 · notfall.n 0 · notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 183 [96–282] · dabei.p2 183 [96–282] · dabei.p3 183 [96–282] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0
  rolle.p1.boden 183 [96–282] · rolle.p2.boden 183 [96–282] · rolle.p3.boden 183 [96–282] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 0 · konto.medipack.netto -2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 897,5 [376–1665] · protokoll.zeilen_je_min 291,46 [232,99–380,33] · tick.n 5491 [2881–8461]

## arena_away/ruine/1 – Wellen ruine solo

`node tools/sim-headless.js wellen --karte ruine --players 1 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 118,05 [84,33–169,73] · dauer.wellen_boden.mittel 103,02 [69,3–154,7] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 103,02 [69,3–154,7] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 1 · spieler.nachzuegler 0 · spieler.start 1
  wellen.dauer_mittel 17,56 [10,07–30,78] · wellen.geschafft 2 [2–3]
- **F2 Gefecht:** gefecht.boden 75 [38–118] · gegner_neu.boden 6 [6–10] · gegner_weg.boden 3 [3–6] · kills.boden.gesamt 5,5 [5–8] · kills.boden.grundtyp 4 [3–6]
  kills.boden.niederhalter 0 [0–1] · kills.boden.schuetze 2 [1–3] · kills_von.gegner 0 [0–1] · kills_von.p1 5,5 [4–8] · quote.boden.blaster 52,52 [35,29–76,47]
  quote.boden.pistol 82,64 [50–100] · quote_gegner.boden.blaster 100 [50–100] · quote_gegner.boden.lanze 100
  quote_gegner.boden.schrottblaster 68,33 [28,57–100] · quote_gegner.boden.sturmgewehr 15,08 [0–43,75] · quote_wirkt.boden.blaster 52,52 [35,29–76,47]
  quote_wirkt.boden.pistol 82,64 [50–100] · quote_wirkt_gegner.boden.blaster 100 [50–100] · quote_wirkt_gegner.boden.lanze 100
  quote_wirkt_gegner.boden.schrottblaster 68,33 [28,57–100] · quote_wirkt_gegner.boden.sturmgewehr 15,08 [0–43,75] · schaden.boden.aus.roh 24,5 [19–41]
  schaden.boden.aus.schild 19,5 [15–34] · schaden.boden.aus.wirkt 5,5 [4–8] · schaden.boden.ein.roh 11,25 [6–21,5] · schaden.boden.ein.schild 10,5 [5–20]
  schaden.boden.ein.wirkt 1 [0,5–2] · schuesse.boden.blaster 44 [17–61] · schuesse.boden.pistol 8,5 [4–18] · schuesse_gegner.boden.blaster 3 [1–6]
  schuesse_gegner.boden.lanze 1 [0–3] · schuesse_gegner.boden.schrottblaster 7 [4–13] · schuesse_gegner.boden.sturmgewehr 0 [0–24]
  treffer_je_schuss.boden.blaster 0,53 [0,35–0,76] · treffer_je_schuss.boden.pistol 0,83 [0,5–1] · treffer_je_schuss_gegner.boden.blaster 1 [0,5–1]
  treffer_je_schuss_gegner.boden.lanze 1,5 [1–2] · treffer_je_schuss_gegner.boden.schrottblaster 0,69 [0,29–1]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,16 [0–0,44] · treffer_n.boden.aus 24,5 [19–41] · treffer_n.boden.ein 10,5 [6–22]
  ueberhitzt.boden.gegner 1 [0–3] · zeit_bis_kill.boden.grundtyp 16,09 [9,32–34,36] · zeit_bis_kill.boden.niederhalter 21,87 [8,63–24,27]
  zeit_bis_kill.boden.schuetze 17,37 [6,27–30,54]
- **F2b Deckung:** deckung.p1.cv_anteil 1,31 [0–16,59] · deckung.p1.cv_s 1,75 [0–19,58] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 19,27 [11,19–35,32]
  gegner_abstand.min 0,1 [0–0,8] · gegner_abstand.nn_mittel 3,61 [1,91–5,18] · gegner_geduckt_anteil 4,95 [0–13,79] · peek.episoden 0,5 [0–6]
  peek.mit_schuss 0 [0–1] · schuesse_gegner.aus_deckung_anteil 0 [0–2,86] · schuesse_spieler.aus_deckung_anteil 0 [0–36,11]
  treffer_auf_spieler.in_deckung_anteil 0 [0–20] · treffer_auf_spieler.n 10,5 [6–22] · treffer_von_spieler.aus_deckung_anteil 0 [0–52]
  treffer_von_spieler.n 24,5 [19–41] · verlassen.bewegt_n 1 [0–7] · verlassen.bis_treffer_median 20,36 [0,5–24,3] · verlassen.mit_treffer 1 [0–3]
  verlassen.n 1,5 [0–8]
- **F3 Verluste:** bodenschild_leer.n 2 [1–8] · erster_verlust_s 69,49 [37,33–100,8] · gefallen.n 1 · gefallen.p1 1 · neustarts 0 · notfall.n 0
  notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 117 [84–168] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · rolle.p1.boden 117 [84–168] · wechsel.p1 0
- **F5 Wirtschaft:** buchung.medipack.medkit -1 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 1 · konto.medipack.netto -1 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 262 [154–436] · protokoll.zeilen_je_min 129,23 [109,57–154,13] · tick.n 3511 [2521–5041]

## arena_away/ruine/3 – Wellen ruine zu dritt

`node tools/sim-headless.js wellen --karte ruine --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 218,17 [168,27–334,4] · dauer.wellen_boden.mittel 203,14 [153,23–319,4] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 203,14 [153,23–319,4] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 22,73 [17,24–34,89] · wellen.geschafft 4 [3–6]
- **F2 Gefecht:** gefecht.boden 148 [116–236] · gegner_neu.boden 30 [20–54] · gegner_weg.boden 20 [12–42] · kills.boden.gesamt 29,5 [18–50]
  kills.boden.grenadier 0 [0–1] · kills.boden.grundtyp 16,5 [11–28] · kills.boden.niederhalter 4,5 [0–7] · kills.boden.schuetze 10 [7–14]
  kills_von.gegner 0 [0–2] · kills_von.p1 8,5 [5–20] · kills_von.p2 9 [5–19] · kills_von.p3 12 [7–20] · quote.boden.blaster 41,66 [30,51–47,99]
  quote.boden.pistol 56,95 [47,92–76,92] · quote_gegner.boden.blaster 80,36 [30–100] · quote_gegner.boden.granatwerfer 40 [0–60] · quote_gegner.boden.lanze 100
  quote_gegner.boden.schrottblaster 69 [46,15–85] · quote_gegner.boden.sturmgewehr 3,84 [0–14,44] · quote_wirkt.boden.blaster 41,66 [30,51–47,99]
  quote_wirkt.boden.pistol 56,95 [47,92–76,92] · quote_wirkt_gegner.boden.blaster 80,36 [30–100] · quote_wirkt_gegner.boden.granatwerfer 40 [0–60]
  quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.schrottblaster 69 [46,15–85] · quote_wirkt_gegner.boden.sturmgewehr 3,84 [0–14,44]
  schaden.boden.aus.roh 130 [82–230] · schaden.boden.aus.schild 101,5 [64–180] · schaden.boden.aus.wirkt 29,5 [18–50] · schaden.boden.ein.roh 49,25 [35,5–92]
  schaden.boden.ein.schild 43,75 [31,5–70,5] · schaden.boden.ein.wirkt 5,75 [2–14] · schuesse.boden.blaster 272 [177–430] · schuesse.boden.pistol 48 [12–118]
  schuesse_gegner.boden.blaster 13 [4–16] · schuesse_gegner.boden.granatwerfer 0 [0–18] · schuesse_gegner.boden.lanze 6 [3–8]
  schuesse_gegner.boden.schrottblaster 20 [13–27] · schuesse_gegner.boden.sturmgewehr 204,5 [29–563] · treffer_je_schuss.boden.blaster 0,42 [0,31–0,48]
  treffer_je_schuss.boden.pistol 0,57 [0,48–0,77] · treffer_je_schuss_gegner.boden.blaster 0,81 [0,3–1]
  treffer_je_schuss_gegner.boden.granatwerfer 0,8 [0–1,57] · treffer_je_schuss_gegner.boden.lanze 2,31 [1,67–3,75]
  treffer_je_schuss_gegner.boden.schrottblaster 0,69 [0,46–0,85] · treffer_je_schuss_gegner.boden.sturmgewehr 0,04 [0–0,14] · treffer_n.boden.aus 130 [82–230]
  treffer_n.boden.ein 42 [33–86] · ueberhitzt.boden.gegner 6 [3–8] · zeit_bis_kill.boden.grenadier 28,97 [4,5–63,47]
  zeit_bis_kill.boden.grundtyp 15,36 [11,55–20,6] · zeit_bis_kill.boden.niederhalter 26,27 [6,83–44,53] · zeit_bis_kill.boden.schuetze 15,71 [6,49–23,07]
- **F2b Deckung:** deckung.p1.cv_anteil 4,84 [0,25–8,34] · deckung.p1.cv_s 9,93 [0,47–19,33] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 38,7 [28,84–53,11]
  deckung.p2.cv_anteil 3,59 [0,34–10,06] · deckung.p2.cv_s 8,06 [0,7–21,93] · deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 35,99 [25,93–47,24]
  deckung.p3.cv_anteil 2,09 [0,25–9,96] · deckung.p3.cv_s 5,14 [0,47–21,71] · deckung.p3.geduckt_s 0 · deckung.p3.verdeckt_s 38,78 [17,51–48,53]
  gegner_abstand.min 0 [0–0,2] · gegner_abstand.nn_mittel 4,22 [3,08–5,25] · gegner_geduckt_anteil 4,88 [3,23–11,76] · peek.episoden 11 [0–33]
  peek.mit_schuss 3 [0–13] · schuesse_gegner.aus_deckung_anteil 0 [0–4] · schuesse_spieler.aus_deckung_anteil 7,48 [0,33–16,67]
  treffer_auf_spieler.in_deckung_anteil 3,97 [0–12,77] · treffer_auf_spieler.n 42 [33–86] · treffer_von_spieler.aus_deckung_anteil 5,01 [0,79–17,42]
  treffer_von_spieler.n 130 [82–230] · verlassen.bewegt_n 19 [4–43] · verlassen.bis_treffer_median 9,16 [1,37–21,17] · verlassen.mit_treffer 10 [3–21]
  verlassen.n 21,5 [4–45]
- **F3 Verluste:** bodenschild_leer.n 9 [6–15] · erster_verlust_s 76,95 [22,57–152,6] · gefallen.n 5,5 [3–10] · gefallen.p1 2,5 [1–5] · gefallen.p2 1 [1–4]
  gefallen.p3 1,5 [1–3] · neustarts 0 · notfall.n 0 · notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 217 [168–334] · dabei.p2 217 [168–334] · dabei.p3 217 [168–334] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0
  rolle.p1.boden 217 [168–334] · rolle.p2.boden 217 [168–334] · rolle.p3.boden 217 [168–334] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 0 · konto.medipack.netto -2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1268,5 [850–2240] · protokoll.zeilen_je_min 347,34 [278,14–401,91] · tick.n 6511 [5041–10021]

## arena_away/schiff/1 – Wellen schiff solo

`node tools/sim-headless.js wellen --karte schiff --players 1 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 108,93 [87,3–149,6] · dauer.wellen_boden.mittel 93,9 [72,27–134,57] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 93,9 [72,27–134,57] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 1 · spieler.nachzuegler 0 · spieler.start 1
  wellen.dauer_mittel 16,92 [9,5–25,13] · wellen.geschafft 2 [2–3]
- **F2 Gefecht:** gefecht.boden 68 [48–92] · gegner_neu.boden 6 [6–10] · gegner_weg.boden 3 [3–6] · kills.boden.gesamt 4 [4–9] · kills.boden.grundtyp 3 [2–5]
  kills.boden.niederhalter 0 [0–1] · kills.boden.schuetze 2 [1–3] · kills_von.gegner 0 [0–1] · kills_von.p1 4 [4–8] · quote.boden.blaster 62,58 [48,65–74,47]
  quote.boden.pistol 80 [42,86–100] · quote_gegner.boden.blaster 100 [50–100] · quote_gegner.boden.lanze 100 · quote_gegner.boden.schrottblaster 81,67 [40–100]
  quote_gegner.boden.sturmgewehr 0 · quote_wirkt.boden.blaster 62,58 [48,65–74,47] · quote_wirkt.boden.pistol 80 [42,86–100]
  quote_wirkt_gegner.boden.blaster 100 [50–100] · quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.schrottblaster 81,67 [40–100]
  quote_wirkt_gegner.boden.sturmgewehr 0 · schaden.boden.aus.roh 22 [14–40] · schaden.boden.aus.schild 18 [10–32] · schaden.boden.aus.wirkt 4 [4–8]
  schaden.boden.ein.roh 10 [6–15] · schaden.boden.ein.schild 9 [5–14] · schaden.boden.ein.wirkt 1 · schuesse.boden.blaster 30,5 [16–47]
  schuesse.boden.pistol 5 [2–14] · schuesse_gegner.boden.blaster 2 [1–5] · schuesse_gegner.boden.lanze 2 [0–3] · schuesse_gegner.boden.schrottblaster 6 [3–10]
  schuesse_gegner.boden.sturmgewehr 0 [0–9] · treffer_je_schuss.boden.blaster 0,63 [0,49–0,74] · treffer_je_schuss.boden.pistol 0,8 [0,43–1]
  treffer_je_schuss_gegner.boden.blaster 1 [0,5–1] · treffer_je_schuss_gegner.boden.lanze 2 [1–2,5] · treffer_je_schuss_gegner.boden.schrottblaster 0,82 [0,4–1]
  treffer_je_schuss_gegner.boden.sturmgewehr 0 · treffer_n.boden.aus 22 [14–40] · treffer_n.boden.ein 8,5 [5–12] · ueberhitzt.boden.gegner 2 [0–3]
  zeit_bis_kill.boden.grundtyp 16,42 [5,97–20,99] · zeit_bis_kill.boden.niederhalter 12 · zeit_bis_kill.boden.schuetze 14,29 [9,22–26,6]
- **F2b Deckung:** deckung.p1.cv_anteil 0,11 [0–1,53] · deckung.p1.cv_s 0,12 [0–1,62] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 29,81 [22,45–53,11]
  gegner_abstand.min 0,2 [0–0,9] · gegner_abstand.nn_mittel 3,82 [1,42–5,49] · gegner_geduckt_anteil 11,91 [0–22,58] · peek.episoden 0 [0–2]
  peek.mit_schuss 0 [0–2] · schuesse_gegner.aus_deckung_anteil 0 · schuesse_spieler.aus_deckung_anteil 0 [0–6,25] · treffer_auf_spieler.in_deckung_anteil 0
  treffer_auf_spieler.n 8,5 [5–12] · treffer_von_spieler.aus_deckung_anteil 0 [0–9,09] · treffer_von_spieler.n 22 [14–40] · verlassen.bewegt_n 0,5 [0–4]
  verlassen.bis_treffer_median 20,06 [1,86–26,03] · verlassen.mit_treffer 0,5 [0–4] · verlassen.n 0,5 [0–4]
- **F3 Verluste:** bodenschild_leer.n 2 [1–3] · erster_verlust_s 75,32 [35,83–94,1] · gefallen.n 1 · gefallen.p1 1 · neustarts 0 · notfall.n 0
  notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 107 [86–148] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · rolle.p1.boden 107 [86–148] · wechsel.p1 0
- **F5 Wirtschaft:** buchung.medipack.medkit -1 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 1 · konto.medipack.netto -1 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 199,5 [152–308] · protokoll.zeilen_je_min 114,1 [87,19–136,06] · tick.n 3211 [2581–4441]

## arena_away/schiff/3 – Wellen schiff zu dritt

`node tools/sim-headless.js wellen --karte schiff --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 265,68 [136,87–323,9] · dauer.wellen_boden.mittel 250,67 [121,83–308,9] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 250,67 [121,83–308,9] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 26,38 [14,09–32,91] · wellen.geschafft 5,5 [3–6]
- **F2 Gefecht:** gefecht.boden 174 [82–226] · gegner_neu.boden 48 [20–56] · gegner_weg.boden 36 [12–44] · kills.boden.gesamt 43 [18–56]
  kills.boden.grenadier 1 [0–2] · kills.boden.grundtyp 21,5 [12–28] · kills.boden.niederhalter 6,5 [1–10] · kills.boden.schuetze 12,5 [5–17]
  kills_von.gegner 1 [0–3] · kills_von.p1 13,5 [6–24] · kills_von.p2 11,5 [3–23] · kills_von.p3 12 [7–22] · quote.boden.blaster 53,77 [50,51–63,46]
  quote.boden.pistol 80 [48–90] · quote_gegner.boden.blaster 88,34 [80,95–100] · quote_gegner.boden.granatwerfer 83,33 [50–85,71] · quote_gegner.boden.lanze 100
  quote_gegner.boden.schrottblaster 77,22 [61,54–100] · quote_gegner.boden.sturmgewehr 5,23 [2,07–9,13] · quote_wirkt.boden.blaster 53,77 [50,51–63,46]
  quote_wirkt.boden.pistol 80 [48–90] · quote_wirkt_gegner.boden.blaster 88,34 [80,95–100] · quote_wirkt_gegner.boden.granatwerfer 83,33 [50–85,71]
  quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.schrottblaster 77,22 [61,54–100] · quote_wirkt_gegner.boden.sturmgewehr 5,23 [2,07–9,13]
  schaden.boden.aus.roh 174 [76–240] · schaden.boden.aus.schild 133,5 [58–186] · schaden.boden.aus.wirkt 41,5 [18–54] · schaden.boden.ein.roh 80,5 [28–103]
  schaden.boden.ein.schild 70,75 [23–87,5] · schaden.boden.ein.wirkt 5,5 [2–11,5] · schuesse.boden.blaster 276 [125–375] · schuesse.boden.pistol 24 [0–83]
  schuesse_gegner.boden.blaster 15,5 [3–24] · schuesse_gegner.boden.granatwerfer 2,5 [0–7] · schuesse_gegner.boden.lanze 5,5 [2–10]
  schuesse_gegner.boden.schrottblaster 17,5 [13–29] · schuesse_gegner.boden.sturmgewehr 372,5 [42–535] · treffer_je_schuss.boden.blaster 0,54 [0,51–0,63]
  treffer_je_schuss.boden.pistol 0,8 [0,48–0,9] · treffer_je_schuss_gegner.boden.blaster 0,89 [0,81–1]
  treffer_je_schuss_gegner.boden.granatwerfer 1,83 [1–2,33] · treffer_je_schuss_gegner.boden.lanze 3,35 [2,63–4,33]
  treffer_je_schuss_gegner.boden.schrottblaster 0,78 [0,62–1] · treffer_je_schuss_gegner.boden.sturmgewehr 0,06 [0,02–0,09] · treffer_n.boden.aus 174 [76–240]
  treffer_n.boden.ein 73,5 [23–103] · ueberhitzt.boden.gegner 5,5 [2–10] · zeit_bis_kill.boden.grenadier 17,27 [11,1–38,97]
  zeit_bis_kill.boden.grundtyp 13,75 [8,45–16,77] · zeit_bis_kill.boden.niederhalter 28,12 [18,63–39,67] · zeit_bis_kill.boden.schuetze 14,59 [7,73–23,37]
- **F2b Deckung:** deckung.p1.cv_anteil 0,19 [0–2,43] · deckung.p1.cv_s 0,47 [0–5,6] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 66,37 [40,29–82,08]
  deckung.p2.cv_anteil 0,15 [0–3,11] · deckung.p2.cv_s 0,47 [0–7,22] · deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 64,44 [44,94–81,37]
  deckung.p3.cv_anteil 0,41 [0–2,11] · deckung.p3.cv_s 1,17 [0–4,89] · deckung.p3.geduckt_s 0 · deckung.p3.verdeckt_s 62,48 [43,99–96,6] · gegner_abstand.min 0
  gegner_abstand.nn_mittel 3,43 [2,78–4,74] · gegner_geduckt_anteil 5,61 [2,96–10,73] · peek.episoden 0 [0–4] · peek.mit_schuss 0 [0–2]
  schuesse_gegner.aus_deckung_anteil 0 [0–1,32] · schuesse_spieler.aus_deckung_anteil 0,83 [0–6,49] · treffer_auf_spieler.in_deckung_anteil 0 [0–4,92]
  treffer_auf_spieler.n 73,5 [23–103] · treffer_von_spieler.aus_deckung_anteil 1,13 [0–6] · treffer_von_spieler.n 174 [76–240] · verlassen.bewegt_n 3 [0–16]
  verlassen.bis_treffer_median 23,57 [6,05–63,73] · verlassen.mit_treffer 3 [0–10] · verlassen.n 3 [0–16]
- **F3 Verluste:** bodenschild_leer.n 13,5 [4–18] · erster_verlust_s 67,8 [17,87–145,37] · gefallen.n 6 [3–12] · gefallen.p1 2,5 [1–6] · gefallen.p2 1,5 [1–4]
  gefallen.p3 1,5 [1–3] · integritaet.min 100 · neustarts 0 · notfall.n 0 · notrueckholung.einzel 0 [0–1] · notrueckholung.fern 0 [0–1]
  notrueckholung.n 0 [0–2] · schiff_zerstoert.n 0 · zone_aus.kaputt 0 [0–1] · zone_aus.n 0 [0–1]
- **F4 Rollen:** dabei.p1 264 [136–322] · dabei.p2 264 [136–322] · dabei.p3 264 [136–322] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0
  rolle.p1.boden 264 [136–322] · rolle.p1.ohne 0 [0–4] · rolle.p2.boden 264 [136–322] · rolle.p3.boden 264 [136–322] · wechsel.p1 0 · wechsel.p2 0
  wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · buchung.medipackCharges.medkit 0 [0–2] · energie.engines_anteil 33,33 · energie.shields_anteil 33,33
  energie.weapons_anteil 33,33 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2 · konto.medipack.ende 0
  konto.medipack.netto -2 · konto.medipackCharges.anfang 0 · konto.medipackCharges.ende 2 · konto.medipackCharges.netto 2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1717,5 [569–2227] · protokoll.zeilen_je_min 382,57 [249,43–422,49] · tick.n 7921 [4081–9661]

## arena_away/station/1 – Wellen station solo

`node tools/sim-headless.js wellen --karte station --players 1 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 114,39 [71,3–248,17] · dauer.wellen_boden.mittel 99,35 [56,27–233,13] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 99,35 [56,27–233,13] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 1 · spieler.nachzuegler 0 · spieler.start 1
  wellen.dauer_mittel 18,12 [10,5–27,82] · wellen.geschafft 2 [1–5]
- **F2 Gefecht:** gefecht.boden 76 [48–164] · gegner_neu.boden 6 [3–21] · gegner_weg.boden 3 [1–15] · kills.boden.gesamt 5,5 [1–18]
  kills.boden.grenadier 0 [0–1] · kills.boden.grundtyp 4 [1–11] · kills.boden.niederhalter 0 [0–3] · kills.boden.schuetze 2 [0–6] · kills_von.gegner 0 [0–1]
  kills_von.p1 5,5 [1–18] · quote.boden.blaster 64,33 [32,69–92,86] · quote.boden.pistol 94,45 [64,71–100] · quote_gegner.boden.blaster 100 [71,43–100]
  quote_gegner.boden.granatwerfer 16,67 [0–33,33] · quote_gegner.boden.lanze 100 · quote_gegner.boden.schrottblaster 87,5 [40–100]
  quote_gegner.boden.sturmgewehr 11,88 [0–14,29] · quote_wirkt.boden.blaster 64,33 [32,69–92,86] · quote_wirkt.boden.pistol 94,45 [64,71–100]
  quote_wirkt_gegner.boden.blaster 100 [71,43–100] · quote_wirkt_gegner.boden.granatwerfer 16,67 [0–33,33] · quote_wirkt_gegner.boden.lanze 100
  quote_wirkt_gegner.boden.schrottblaster 87,5 [40–100] · quote_wirkt_gegner.boden.sturmgewehr 11,88 [0–14,29] · schaden.boden.aus.roh 25,5 [9–75]
  schaden.boden.aus.schild 19,5 [8–57] · schaden.boden.aus.wirkt 5,5 [1–18] · schaden.boden.ein.roh 8,5 [5–24,5] · schaden.boden.ein.schild 7,5 [4–23]
  schaden.boden.ein.wirkt 1 [0,5–1,5] · schuesse.boden.blaster 30,5 [12–102] · schuesse.boden.pistol 5 [0–17] · schuesse_gegner.boden.blaster 1,5 [0–7]
  schuesse_gegner.boden.granatwerfer 0 [0–3] · schuesse_gegner.boden.lanze 2 [0–3] · schuesse_gegner.boden.schrottblaster 5,5 [2–10]
  schuesse_gegner.boden.sturmgewehr 0 [0–105] · treffer_je_schuss.boden.blaster 0,65 [0,33–0,93] · treffer_je_schuss.boden.pistol 0,95 [0,65–1]
  treffer_je_schuss_gegner.boden.blaster 1 [0,71–1] · treffer_je_schuss_gegner.boden.granatwerfer 0,17 [0–0,33]
  treffer_je_schuss_gegner.boden.lanze 2 [1,33–2,5] · treffer_je_schuss_gegner.boden.schrottblaster 0,88 [0,4–1]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,12 [0–0,14] · treffer_n.boden.aus 25,5 [9–75] · treffer_n.boden.ein 8 [4–30] · ueberhitzt.boden.gegner 2 [0–3]
  zeit_bis_kill.boden.grenadier 9,53 · zeit_bis_kill.boden.grundtyp 16,18 [8,25–19,47] · zeit_bis_kill.boden.niederhalter 20,7 [7,5–43,17]
  zeit_bis_kill.boden.schuetze 15,68 [13,14–24,65]
- **F2b Deckung:** deckung.p1.cv_anteil 0 · deckung.p1.cv_s 0 · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 31,75 [20,21–59,74]
  gegner_abstand.min 0,25 [0–1] · gegner_abstand.nn_mittel 2,78 [1,51–4,16] · gegner_geduckt_anteil 0 · schuesse_gegner.aus_deckung_anteil 0
  schuesse_spieler.aus_deckung_anteil 0 · treffer_auf_spieler.in_deckung_anteil 0 · treffer_auf_spieler.n 8 [4–30] · treffer_von_spieler.aus_deckung_anteil 0
  treffer_von_spieler.n 25,5 [9–75]
- **F3 Verluste:** bodenschild_leer.n 2 [1–4] · erster_verlust_s 50,95 [42,03–105,6] · gefallen.n 1 [1–2] · gefallen.p1 1 [1–2] · neustarts 0 · notfall.n 0
  notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 114 [70–248] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · rolle.p1.boden 114 [70–248] · wechsel.p1 0
- **F5 Wirtschaft:** buchung.medipack.medkit -1 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 1 · konto.medipack.netto -1 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 210,5 [102–657] · protokoll.zeilen_je_min 110,29 [82,81–158,84] · tick.n 3421 [2101–7441]

## arena_away/station/3 – Wellen station zu dritt

`node tools/sim-headless.js wellen --karte station --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 299,5 [190,7–422,4] · dauer.wellen_boden.mittel 284,5 [175,67–407,4] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 284,5 [175,67–407,4] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 24,13 [19,27–35,45] · wellen.geschafft 6 [4–7]
- **F2 Gefecht:** gefecht.boden 192 [124–310] · gegner_neu.boden 56 [30–72] · gegner_weg.boden 44 [20–60] · kills.boden.enterer 0 [0–1]
  kills.boden.gesamt 54 [26–75] · kills.boden.grenadier 2 [0–5] · kills.boden.grundtyp 26,5 [14–35] · kills.boden.niederhalter 9,5 [4–12]
  kills.boden.schuetze 15,5 [8–23] · kills_von.gegner 0 [0–3] · kills_von.p1 15,5 [7–31] · kills_von.p2 15 [8–26] · kills_von.p3 17,5 [10–27]
  quote.boden.blaster 53,22 [47–66,9] · quote.boden.pistol 80 [56,25–87,5] · quote_gegner.boden.blaster 86,75 [66,67–100]
  quote_gegner.boden.granatwerfer 87,5 [33,33–100] · quote_gegner.boden.lanze 100 · quote_gegner.boden.nahkampf 50
  quote_gegner.boden.schrottblaster 84,52 [56,25–100] · quote_gegner.boden.sturmgewehr 8,23 [3,82–15,41] · quote_wirkt.boden.blaster 53,22 [47–66,9]
  quote_wirkt.boden.pistol 80 [56,25–87,5] · quote_wirkt_gegner.boden.blaster 86,75 [66,67–100] · quote_wirkt_gegner.boden.granatwerfer 87,5 [33,33–100]
  quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.nahkampf 50 · quote_wirkt_gegner.boden.schrottblaster 84,52 [56,25–100]
  quote_wirkt_gegner.boden.sturmgewehr 8,23 [3,82–15,41] · schaden.boden.aus.roh 223,5 [103–307] · schaden.boden.aus.schild 168 [77–233]
  schaden.boden.aus.wirkt 53 [26–74] · schaden.boden.ein.roh 54,25 [29–97] · schaden.boden.ein.schild 47,25 [27–82] · schaden.boden.ein.wirkt 4,25 [1,5–13]
  schuesse.boden.blaster 305,5 [166–566] · schuesse.boden.pistol 47,5 [16–99] · schuesse_gegner.boden.blaster 13 [3–28]
  schuesse_gegner.boden.granatwerfer 3,5 [0–13] · schuesse_gegner.boden.lanze 3 [1–7] · schuesse_gegner.boden.nahkampf 0 [0–2]
  schuesse_gegner.boden.schrottblaster 11 [7–18] · schuesse_gegner.boden.sturmgewehr 327,5 [111–466] · treffer_je_schuss.boden.blaster 0,54 [0,47–0,67]
  treffer_je_schuss.boden.pistol 0,8 [0,56–0,88] · treffer_je_schuss_gegner.boden.blaster 0,87 [0,67–1] · treffer_je_schuss_gegner.boden.granatwerfer 2 [0,83–3]
  treffer_je_schuss_gegner.boden.lanze 3,5 [2,67–4,33] · treffer_je_schuss_gegner.boden.nahkampf 0,5
  treffer_je_schuss_gegner.boden.schrottblaster 0,85 [0,56–1] · treffer_je_schuss_gegner.boden.sturmgewehr 0,08 [0,04–0,15]
  treffer_n.boden.aus 223,5 [103–307] · treffer_n.boden.ein 57,5 [31–107] · ueberhitzt.boden.gegner 3 [1–7] · zeit_bis_kill.boden.enterer 14,67
  zeit_bis_kill.boden.grenadier 21,53 [12,93–31,43] · zeit_bis_kill.boden.grundtyp 14,69 [7,65–24,67] · zeit_bis_kill.boden.niederhalter 26,19 [19,22–33,99]
  zeit_bis_kill.boden.schuetze 13,93 [7,4–20,2]
- **F2b Deckung:** deckung.p1.cv_anteil 0 · deckung.p1.cv_s 0 · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 73,77 [58,86–97,96] · deckung.p2.cv_anteil 0
  deckung.p2.cv_s 0 · deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 76,46 [52,17–113,13] · deckung.p3.cv_anteil 0 · deckung.p3.cv_s 0 · deckung.p3.geduckt_s 0
  deckung.p3.verdeckt_s 70,14 [52,43–105,68] · gegner_abstand.min 0 · gegner_abstand.nn_mittel 3,42 [2,28–4,79] · gegner_geduckt_anteil 0
  schuesse_gegner.aus_deckung_anteil 0 · schuesse_spieler.aus_deckung_anteil 0 · treffer_auf_spieler.in_deckung_anteil 0 · treffer_auf_spieler.n 57,5 [31–107]
  treffer_von_spieler.aus_deckung_anteil 0 · treffer_von_spieler.n 223,5 [103–307]
- **F3 Verluste:** bodenschild_leer.n 9,5 [3–19] · erster_verlust_s 84,44 [45,37–278,33] · gefallen.n 5 [3–15] · gefallen.p1 2 [1–6] · gefallen.p2 1,5 [1–5]
  gefallen.p3 1 [1–4] · neustarts 0 · notfall.n 0 · notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 298 [190–422] · dabei.p2 298 [190–422] · dabei.p3 298 [190–422] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0
  rolle.p1.boden 298 [190–422] · rolle.p2.boden 298 [190–422] · rolle.p3.boden 298 [190–422] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 0 · konto.medipack.netto -2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1716 [869–2568] · protokoll.zeilen_je_min 342,73 [264,23–364,77] · tick.n 8941 [5701–12661]

## arena_graben/3 – Grabenangriff zu dritt

`node tools/sim-headless.js graben --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

> [!warning] Alle Läufe am Zeitlimit, Bot schafft den Graben nicht; Spannen sind kein Balance-Maß.

- **F1 Dauer und Ausgang:** ausgang.session_ende 1 · dauer.graben.mittel 1500,03 · dauer.graben.n 1 · dauer.graben.summe 1500,03 · dauer.session 1500,03
  spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
- **F2 Gefecht:** gefecht.boden 1500 · gegner_neu.boden 1800 [1746–1836] · gegner_weg.boden 1782 [1728–1818] · kills.boden.gesamt 58 [48–65]
  kills.boden.grenadier 8 [4–16] · kills.boden.grundtyp 49 [44–57] · kills_von.gegner 0 [0–1] · kills_von.p1 19,5 [15–22] · kills_von.p2 21 [14–28]
  kills_von.p3 17 [9–23] · quote.boden.blaster 24,2 [21,81–26,32] · quote.boden.pistol 16,9 [15,73–17,95] · quote_gegner.boden.blaster 41,71 [39,45–43,96]
  quote_gegner.boden.granatwerfer 35,88 [33,16–38,92] · quote_gegner.boden.lanze 99,3 [98,25–100] · quote_wirkt.boden.blaster 24,2 [21,81–26,32]
  quote_wirkt.boden.pistol 16,9 [15,73–17,95] · quote_wirkt_gegner.boden.blaster 41,71 [39,45–43,96] · quote_wirkt_gegner.boden.granatwerfer 35,88 [33,16–38,92]
  quote_wirkt_gegner.boden.lanze 99,3 [98,25–100] · schaden.boden.aus.roh 512,5 [496–550] · schaden.boden.aus.schild 451,5 [438–487]
  schaden.boden.aus.wirkt 58 [48–65] · schaden.boden.ein.roh 1494 [1472–1510] · schaden.boden.ein.schild 949,5 [935–960] · schaden.boden.ein.wirkt 408 [399–423]
  schuesse.boden.blaster 545,5 [466–588] · schuesse.boden.pistol 2275,5 [2160–2325] · schuesse_gegner.boden.blaster 1567,5 [1499–1630]
  schuesse_gegner.boden.granatwerfer 195 [160–219] · schuesse_gegner.boden.lanze 291 [279–298] · treffer_je_schuss.boden.blaster 0,24 [0,22–0,26]
  treffer_je_schuss.boden.pistol 0,17 [0,16–0,18] · treffer_je_schuss_gegner.boden.blaster 0,42 [0,39–0,44]
  treffer_je_schuss_gegner.boden.granatwerfer 0,63 [0,56–0,66] · treffer_je_schuss_gegner.boden.lanze 1,51 [1,5–1,55] · treffer_n.boden.aus 512,5 [496–550]
  treffer_n.boden.ein 1130,5 [1122–1148] · ueberhitzt.boden.gegner 291 [279–298] · zeit_bis_kill.boden.grenadier 12,74 [11,17–14,47]
  zeit_bis_kill.boden.grundtyp 11,31 [11,02–11,87]
- **F2b Deckung:** deckung.p1.cv_anteil 0 · deckung.p1.cv_s 0 · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 0 · deckung.p2.cv_anteil 0 · deckung.p2.cv_s 0
  deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 0 · deckung.p3.cv_anteil 0 · deckung.p3.cv_s 0 · deckung.p3.geduckt_s 0 · deckung.p3.verdeckt_s 0
  gegner_abstand.min 0,2 [0–0,5] · gegner_abstand.nn_mittel 5,92 [5,89–5,94] · gegner_geduckt_anteil 2,44 [2,2–2,68] · schuesse_gegner.aus_deckung_anteil 100
  schuesse_spieler.aus_deckung_anteil 0 · treffer_auf_spieler.in_deckung_anteil 0 · treffer_auf_spieler.n 1130,5 [1122–1148]
  treffer_von_spieler.aus_deckung_anteil 0 · treffer_von_spieler.n 512,5 [496–550]
- **F3 Verluste:** bodenschild_leer.n 344,5 [341–352] · erster_verlust_s 3,8 [3,7–3,87] · gefallen.n 344,5 [341–352] · gefallen.p1 101 [99–103]
  gefallen.p2 144 [138–153] · gefallen.p3 99 [97–101] · neustarts 99 [96–101] · notfall.n 0 · notrueckholung.n 99 [96–101] · notrueckholung.team 99 [96–101]
  schiff_zerstoert.n 0 · zone_aus.kaputt 99 [96–101] · zone_aus.n 99 [96–101]
- **F4 Rollen:** dabei.p1 1500 · dabei.p2 1500 · dabei.p3 1500 · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · leerlauf.p2.anteil 0
  leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0 · rolle.p1.boden 1500 · rolle.p2.boden 1500
  rolle.p3.boden 1500 · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · buchung.medipackCharges.medkit 0 · konto.ladung.anfang 1 · konto.ladung.ende 1 · konto.ladung.netto 0
  konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2 · konto.medipack.ende 0 · konto.medipack.netto -2
  konto.medipackCharges.anfang 0 · konto.medipackCharges.ende 0 · konto.medipackCharges.netto 0 · stand.ladung.mission 1 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 13994,5 [13798–14074] · protokoll.zeilen_je_min 559,77 [551,91–562,95] · tick.n 45001

## arena_space/maneuver/3 – Raumkampf-Arena zu dritt, Steuer maneuver

`node tools/sim-headless.js arena --pilot maneuver --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.session_ende 1 · dauer.arena_raum.mittel 875,37 [701,97–1097,07] · dauer.arena_raum.n 1
  dauer.arena_raum.summe 875,37 [701,97–1097,07] · dauer.session 875,37 [701,97–1097,07] · spieler.abgaenge 0 · spieler.beitritte 2 · spieler.max 3
  spieler.nachzuegler 0 · spieler.start 3
- **F2 Gefecht:** gefecht.raum 808 [634–1030] · gegner_neu.raum 14 · gegner_weg.raum 2 [0–7] · kills.raum.gesamt 12 [7–14] · kills.raum.korvette 4 [2–4]
  kills.raum.pylon 1 [0–1] · kills.raum.raider 6,5 [4–8] · kills.raum.sentinel 1 · kills_von.lerche 12 [7–14] · quote.raum.lanze 92,9 [77,78–100]
  quote.raum.standardbatterie 92,82 [88,39–95,63] · quote_wirkt.raum.lanze 92,9 [77,78–100] · quote_wirkt.raum.standardbatterie 85,84 [80,88–89,03]
  schaden.raum.aus.roh 663,93 [413,41–726,88] · schaden.raum.aus.schild 76,41 [54,5–85,32] · schaden.raum.aus.wirkt 466,91 [293,71–511,37]
  schaden.raum.ein.roh 36 [31,5–214,5] · schaden.raum.ein.schild 31,75 [24–52,5] · schaden.raum.ein.wirkt 6 [1–178,5] · schuesse.raum.lanze 17 [4–23]
  schuesse.raum.standardbatterie 218,5 [155–229] · treffer_je_schuss.raum.lanze 0,93 [0,78–1] · treffer_je_schuss.raum.standardbatterie 0,93 [0,88–0,96]
  treffer_n.raum.aus 216,5 [145–231] · treffer_n.raum.ein 37 [28–245] · zeit_bis_kill.raum.korvette 52,83 [40,89–105,87]
  zeit_bis_kill.raum.pylon 97,43 [52,5–170,97] · zeit_bis_kill.raum.raider 119,21 [102,9–147,87] · zeit_bis_kill.raum.sentinel 48,4 [41,23–92,67]
- **F3 Verluste:** bodenschild_leer.n 0 · erster_verlust_s 15,9 [13,7–332,6] · gefallen.n 0 · integritaet.min 93,59 [34,19–97,86] · neustarts 0
  notfall.n 0 [0–2] · notrueckholung.n 0 · schiff_zerstoert.n 0 [0–2] · zone_aus.kaputt 3 [0–56] · zone_aus.n 6 [1–68]
- **F4 Rollen:** dabei.p1 874 [700–1096] · dabei.p2 874 [700–1096] · dabei.p3 874 [700–1096] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0
  leerlauf.p1.episoden 0 · leerlauf.p2.anteil 4,22 [0–9,85] · leerlauf.p2.dauer 34 [0–108] · leerlauf.p2.episoden 1 [0–2]
  leerlauf.p3.anteil 28,44 [15,37–53,97] · leerlauf.p3.dauer 246 [126–544] · leerlauf.p3.episoden 4 [2–7] · reparatur.dauer_mittel 3 [1,69–4,13]
  reparatur.erfolg_anteil 100 [50–100] · reparatur.n 1 [0–51] · reparatur.notflicken 0 [0–48] · rolle.p1.helm 819 [140–1008] · rolle.p1.ohne 32 [0–768]
  rolle.p2.ohne 10 [2–424] · rolle.p2.weapons 835 [620–950] · rolle.p3.captain 872 [698–1094] · rolle.p3.ohne 2 [2–106] · wechsel.p1 0 · wechsel.p2 0
  wechsel.p3 529 [284–740]
- **F5 Wirtschaft:** buchung.ersatzteil.bot 0 [-3–0] · buchung.ersatzteil.regal -1 [-4–0] · buchung.marks.abschuss 465 [280–505]
  buchung.marks.notfall 0 [-100–0] · energie.automatik_n 0 [0–4] · energie.engines_anteil 33,33 [33,33–36,68] · energie.shields_anteil 33,33 [33,33–36,68]
  energie.weapons_anteil 33,33 [26,65–33,33] · konto.ersatzteil.anfang 4 · konto.ersatzteil.ende 2 [0–3] · konto.ersatzteil.netto -2 [-4–-1]
  konto.marks.anfang 5000 · konto.marks.ende 5465 [5180–5505] · konto.marks.netto 465 [180–505] · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1559 [1320–1745] · protokoll.zeilen_je_min 108,02 [81,82–120,18] · tick.n 26220 [21000–32880]

## arena_space/nose/3 – Raumkampf-Arena zu dritt, Steuer nose

`node tools/sim-headless.js arena --pilot nose --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.session_ende 1 · dauer.arena_raum.mittel 1094,3 [821,53–1146,5] · dauer.arena_raum.n 1
  dauer.arena_raum.summe 1094,3 [821,53–1146,5] · dauer.session 1094,3 [821,53–1146,5] · spieler.abgaenge 0 · spieler.beitritte 2 · spieler.max 3
  spieler.nachzuegler 0 · spieler.start 3
- **F2 Gefecht:** gefecht.raum 1027 [754–1080] · gegner_neu.raum 14 · gegner_weg.raum 10,5 [1–14] · kills.raum.gesamt 3,5 [0–13] · kills.raum.korvette 1 [0–4]
  kills.raum.pylon 0 [0–1] · kills.raum.raider 2 [0–7] · kills.raum.sentinel 0 [0–1] · kills_von.lerche 3,5 [0–13] · quote.raum.lanze 100 [86,96–100]
  quote.raum.standardbatterie 89,62 [69,23–97,52] · quote_wirkt.raum.lanze 100 [86,96–100] · quote_wirkt.raum.standardbatterie 85,58 [69,23–93,75]
  schaden.raum.aus.roh 352,12 [43,77–942,9] · schaden.raum.aus.schild 49,5 [5–86,16] · schaden.raum.aus.wirkt 266,37 [30,47–708,09]
  schaden.raum.ein.roh 270 [65,5–433,5] · schaden.raum.ein.schild 41,5 [15,5–101,5] · schaden.raum.ein.wirkt 223,5 [10,5–418] · schuesse.raum.lanze 14,5 [2–47]
  schuesse.raum.standardbatterie 98 [8–204] · treffer_je_schuss.raum.lanze 1 [0,87–1] · treffer_je_schuss.raum.standardbatterie 0,9 [0,69–0,98]
  treffer_n.raum.aus 99 [11–241] · treffer_n.raum.ein 160 [47–282] · zeit_bis_kill.raum.korvette 102,3 [62,87–137,4]
  zeit_bis_kill.raum.pylon 55,15 [45,93–64,37] · zeit_bis_kill.raum.raider 111,26 [78,03–147,2] · zeit_bis_kill.raum.sentinel 70,89 [45,93–93,13]
- **F3 Verluste:** bodenschild_leer.n 0 · erster_verlust_s 49,44 [15,97–337,7] · gefallen.n 0 · integritaet.min 34,19 [34,19–95,73] · neustarts 0
  notfall.n 2 [0–2] · notrueckholung.n 0 · schiff_zerstoert.n 2 [0–2] · zone_aus.kaputt 17,5 [4–73] · zone_aus.n 33,5 [9–88]
- **F4 Rollen:** dabei.p1 1094 [820–1146] · dabei.p2 1094 [820–1146] · dabei.p3 1094 [820–1146] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0
  leerlauf.p1.episoden 0 · leerlauf.p2.anteil 0 [0–13,93] · leerlauf.p2.dauer 0 [0–144] · leerlauf.p2.episoden 0 [0–3] · leerlauf.p3.anteil 21,5 [0–79,81]
  leerlauf.p3.dauer 239 [0–846] · leerlauf.p3.episoden 3,5 [0–11] · reparatur.dauer_mittel 3 [1,59–4,84] · reparatur.erfolg_anteil 100 [94,74–100]
  reparatur.n 1,5 [0–31] · reparatur.notflicken 0 [0–28] · rolle.p1.helm 476 [74–810] · rolle.p1.ohne 612 [62–1072] · rolle.p2.ohne 599 [2–962]
  rolle.p2.weapons 525 [184–888] · rolle.p3.captain 1045 [96–1144] · rolle.p3.ohne 2 [2–1050] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 224,5 [20–501]
- **F5 Wirtschaft:** buchung.ersatzteil.bot -1 [-3–0] · buchung.ersatzteil.regal -2 [-3–0] · buchung.marks.abschuss 110 [0–485]
  buchung.marks.notfall -100 [-100–0] · energie.automatik_n 4 [0–6] · energie.engines_anteil 38,27 [33,33–46,34] · energie.shields_anteil 39,73 [33,33–46,49]
  energie.weapons_anteil 20,55 [7,17–33,33] · konto.ersatzteil.anfang 4 · konto.ersatzteil.ende 0,5 [0–3] · konto.ersatzteil.netto -3,5 [-4–-1]
  konto.marks.anfang 5000 · konto.marks.ende 5035 [4900–5485] · konto.marks.netto 35 [-100–485] · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1256,5 [930–1548] · protokoll.zeilen_je_min 69,17 [48,67–105,1] · tick.n 32820 [24600–34380]

## m1/1 – Kampagne solo (M1, M2)

`node tools/sim-headless.js 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.erfolg 1 [0–1] · ausgang.geliefert 1 · ausgang.session_ende 1 · dauer.kampagne.mittel 593,22 [562,9–930,85]
  dauer.kampagne.n 2 · dauer.kampagne.summe 1186,43 [1125,8–1861,7] · dauer.session 1186,43 [1125,8–1861,7] · spieler.abgaenge 0 · spieler.beitritte 0
  spieler.max 1 · spieler.nachzuegler 0 · spieler.start 1
- **F2 Gefecht:** gefecht.boden 24 [22–28] · gefecht.raum 499 [464–1040] · gegner_neu.raum 14 [9–14] · kills.raum.gesamt 14 [8–14] · kills.raum.korvette 1
  kills.raum.pylon 5 [0–5] · kills.raum.raider 4 · kills.raum.relay 3 · kills.raum.sentinel 1 [0–1] · kills_von.lerche 14 [8–14] · quote.raum.lanze 100
  quote.raum.standardbatterie 93,19 [91,82–95,09] · quote_wirkt.raum.lanze 100 · quote_wirkt.raum.standardbatterie 59,69 [58,33–85,29]
  schaden.raum.aus.roh 450,99 [204,43–489,42] · schaden.raum.aus.schild 35 [15–37] · schaden.raum.aus.wirkt 247,51 [157,71–276,93]
  schaden.raum.ein.roh 28,75 [23–142] · schaden.raum.ein.schild 24 [18–43] · schaden.raum.ein.wirkt 5,5 [1,5–99] · schuesse.raum.lanze 7,5 [4–12]
  schuesse.raum.standardbatterie 158,5 [68–168] · treffer_je_schuss.raum.lanze 1 · treffer_je_schuss.raum.standardbatterie 0,93 [0,92–0,95]
  treffer_n.raum.aus 156,5 [67–165] · treffer_n.raum.ein 27,5 [23–136] · zeit_bis_kill.raum.korvette 37,99 [23,93–65,23]
  zeit_bis_kill.raum.pylon 83,63 [78,73–91,4] · zeit_bis_kill.raum.raider 51,89 [43,39–60,27] · zeit_bis_kill.raum.relay 31,92 [25,33–51,33]
  zeit_bis_kill.raum.sentinel 52,53 [44,67–56,8]
- **F2b Deckung:** deckung.p1.cv_anteil 0 · deckung.p1.cv_s 0 · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 0 · gegner_abstand.min 5,5 [3,4–6,8]
  gegner_abstand.nn_mittel 7,88 [6,8–10,68] · gegner_geduckt_anteil 0
- **F3 Verluste:** bodenschild_leer.n 0 · erster_verlust_s 210,42 [172,07–253,73] · gefallen.n 0 · integritaet.min 89,11 [62,82–92,74] · neustarts 0
  notfall.n 0 [0–10] · notrueckholung.n 0 · schiff_zerstoert.n 0 [0–10] · zone_aus.kaputt 8 [1–133] · zone_aus.n 12 [3–151]
- **F4 Rollen:** dabei.p1 1186 [1124–1860] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · reparatur.dauer_mittel 3 [3–3,44]
  reparatur.erfolg_anteil 100 · reparatur.n 1 [1–6] · reparatur.notflicken 0 · rolle.p1.boden 52 [50–56] · rolle.p1.captain 16 [4–18]
  rolle.p1.helm 634 [446–696] · rolle.p1.ohne 122 [114–1204] · rolle.p1.shop 0 [0–2] · rolle.p1.weapons 361 [152–380] · wechsel.p1 601 [482–971]
- **F5 Wirtschaft:** buchung.ersatzteil.bergung 1 · buchung.ersatzteil.bot -3 [-4–-1] · buchung.ersatzteil.regal -1 · buchung.flickblech.bergung 1
  buchung.flickblech.bot -1 [-1–0] · buchung.flickblech.regal -1 · buchung.loeschgel.regal -1 · buchung.marks.abschuss 360 [155–360]
  buchung.marks.belohnung 575 [425–575] · buchung.marks.bergung 40 · buchung.marks.erkundung 120 [100–120] · buchung.marks.kauf -20
  buchung.marks.notfall 0 [-500–0] · buchung.medipack.regal -1 · energie.automatik_n 0 [0–12] · energie.engines_anteil 33,33 [33,12–35,43]
  energie.shields_anteil 33,33 [33,33–35,43] · energie.weapons_anteil 33,33 [29,14–33,33] · konto.ersatzteil.anfang 4 · konto.ersatzteil.ende 1 [0–3]
  konto.ersatzteil.netto -3 [-4–-1] · konto.flickblech.anfang 3 · konto.flickblech.ende 2 [2–3] · konto.flickblech.netto -1 [-1–0] · konto.loeschgel.anfang 2
  konto.loeschgel.ende 1 · konto.loeschgel.netto -1 · konto.marks.anfang 150 · konto.marks.ende 1225 [350–1225] · konto.marks.netto 1075 [200–1075]
  konto.medipack.anfang 2 · konto.medipack.ende 1 · konto.medipack.netto -1
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1777,5 [1650–2189] · protokoll.zeilen_je_min 86,81 [70,55–102,91] · tick.n 35581 [33721–55801]

## m1/3 – Kampagne zu dritt (M1, M2)

`node tools/sim-headless.js 3 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.entschluesselt 1 [0–1] · ausgang.erfolg 1 [0–1] · ausgang.session_ende 1 · dauer.kampagne.mittel 500,77 [471,3–685,07]
  dauer.kampagne.n 2 [1–2] · dauer.kampagne.summe 989,5 [685,07–1088,4] · dauer.session 989,5 [685,07–1088,4] · spieler.abgaenge 0 · spieler.beitritte 2
  spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
- **F2 Gefecht:** gefecht.boden 14 [12–20] · gefecht.raum 439 [130–532] · gegner_neu.raum 15 [6–15] · kills.raum.gesamt 15 [6–15] · kills.raum.pylon 5 [0–5]
  kills.raum.raider 6 [3–6] · kills.raum.relay 3 · kills.raum.sentinel 1 [0–1] · kills_von.lerche 15 [6–15] · quote.raum.lanze 100 [80–100]
  quote.raum.standardbatterie 94,21 [90,51–97,22] · quote_wirkt.raum.lanze 100 [80–100] · quote_wirkt.raum.standardbatterie 70,61 [67,09–76,39]
  schaden.raum.aus.roh 432,22 [117,04–462,57] · schaden.raum.aus.schild 45 [7–51,66] · schaden.raum.aus.wirkt 261,82 [73,83–274,78]
  schaden.raum.ein.roh 18 [10–40] · schaden.raum.ein.schild 15,5 [8–26] · schaden.raum.ein.wirkt 4,5 [0–23] · schuesse.raum.lanze 5,5 [2–8]
  schuesse.raum.standardbatterie 153 [42–158] · treffer_je_schuss.raum.lanze 1 [0,8–1] · treffer_je_schuss.raum.standardbatterie 0,94 [0,91–0,97]
  treffer_n.raum.aus 148 [41–154] · treffer_n.raum.ein 18 [10–40] · zeit_bis_kill.raum.pylon 99,77 [68,47–145,1] · zeit_bis_kill.raum.raider 57,28 [49,77–74,98]
  zeit_bis_kill.raum.relay 3,17 [1,4–18,87] · zeit_bis_kill.raum.sentinel 53,93 [45,23–96,53]
- **F2b Deckung:** deckung.p2.cv_anteil 0 · deckung.p2.cv_s 0 · deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 0 · deckung.p3.cv_anteil 0 · deckung.p3.cv_s 0
  deckung.p3.geduckt_s 0 · deckung.p3.verdeckt_s 0 · gegner_abstand.min 6,9 [3,3–8,2] · gegner_abstand.nn_mittel 10,56 [8,1–11,82] · gegner_geduckt_anteil 0
- **F3 Verluste:** bodenschild_leer.n 0 · erster_verlust_s 147,45 [136,77–198,5] · gefallen.n 0 · integritaet.min 93,16 [58,12–94,87] · neustarts 0
  notfall.n 0 [0–1] · notrueckholung.n 0 · schiff_zerstoert.n 0 [0–1] · zone_aus.kaputt 3 [1–13] · zone_aus.n 5 [1–25]
- **F4 Rollen:** dabei.p1 989 [684–1088] · dabei.p2 989 [684–1088] · dabei.p3 989 [684–1088] · leerlauf.p1.anteil 56,08 [29,24–66,4]
  leerlauf.p1.dauer 595 [200–672] · leerlauf.p1.episoden 11 [4–13] · leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0
  leerlauf.p3.anteil 34,9 [31,6–61,99] · leerlauf.p3.dauer 345 [308–442] · leerlauf.p3.episoden 4 [2–6] · reparatur.dauer_mittel 3 · reparatur.erfolg_anteil 100
  reparatur.n 1 [1–2] · reparatur.notflicken 0 · rolle.p1.captain 985 [680–1084] · rolle.p1.ohne 4 [4–36] · rolle.p2.boden 44 [42–48]
  rolle.p2.helm 847 [374–926] · rolle.p2.ohne 96 [88–266] · rolle.p3.boden 20 [20–26] · rolle.p3.ohne 72 [52–76] · rolle.p3.weapons 889 [612–998]
  wechsel.p1 210 [120–321] · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.ersatzteil.bergung 1 · buchung.ersatzteil.bot -2 [-3–-1] · buchung.ersatzteil.regal -1 [-2–-1] · buchung.flickblech.bergung 1
  buchung.flickblech.regal -1 · buchung.loeschgel.regal -1 · buchung.marks.abschuss 340 [75–340] · buchung.marks.belohnung 400 [170–400]
  buchung.marks.bergung 40 · buchung.marks.erkundung 120 [60–120] · buchung.marks.kauf -20 [-20–0] · buchung.marks.mission -160 [-160–-100]
  buchung.marks.notfall 0 [-50–0] · buchung.medipack.regal -1 · energie.automatik_n 2 [2–3] · energie.engines_anteil 33,42 [33,4–35,8]
  energie.shields_anteil 33,42 [33,4–35,86] · energie.weapons_anteil 33,16 [28,35–33,21] · konto.ersatzteil.anfang 4 · konto.ersatzteil.ende 2 [0–3]
  konto.ersatzteil.netto -2 [-4–-1] · konto.flickblech.anfang 3 · konto.flickblech.ende 3 · konto.flickblech.netto 0 · konto.loeschgel.anfang 2
  konto.loeschgel.ende 1 · konto.loeschgel.netto -1 · konto.marks.anfang 150 · konto.marks.ende 870 [345–870] · konto.marks.netto 720 [195–720]
  konto.medipack.anfang 2 · konto.medipack.ende 1 · konto.medipack.netto -1
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1137 [685–1327] · protokoll.zeilen_je_min 69,51 [59,99–75,55] · tick.n 29670 [20520–32640]

## m3/3 – M3 Die Tafel von Kesh zu dritt

`node tools/sim-headless.js m3 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.erfolg 1 · dauer.kampagne.mittel 181,93 [162,57–195,03] · dauer.kampagne.n 1 · dauer.kampagne.summe 181,93 [162,57–195,03]
  dauer.session 181,93 [162,57–195,03] · spieler.abgaenge 0 · spieler.beitritte 2 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
- **F2 Gefecht:** gefecht.boden 126 [90–144] · gegner_neu.boden 11 [8–13] · kills.boden.gesamt 10 [4–13] · kills.boden.grundtyp 10 [4–13]
  kills.boden.waechter 0 [0–1] · kills_von.p2 5,5 [1–8] · kills_von.p3 4 [3–8] · quote.boden.blaster 42,33 [32,26–53,74] · quote.boden.pistol 66,67 [38,46–100]
  quote.boden.sturmgewehr 39,18 [26,5–42,72] · quote_gegner.boden.schrottblaster 33,33 [25,32–52,94] · quote_gegner.boden.waechter 100 [71,43–100]
  quote_wirkt.boden.blaster 42,33 [32,26–53,74] · quote_wirkt.boden.pistol 66,67 [38,46–100] · quote_wirkt.boden.sturmgewehr 39,18 [26,5–42,72]
  quote_wirkt_gegner.boden.schrottblaster 33,33 [25,32–52,94] · quote_wirkt_gegner.boden.waechter 100 [71,43–100] · schaden.boden.aus.roh 63 [40,5–82]
  schaden.boden.aus.schild 46,5 [29–58] · schaden.boden.aus.wirkt 10 [3,5–13] · schaden.boden.ein.roh 26,5 [18–45] · schaden.boden.ein.schild 14,5 [12–25]
  schaden.boden.ein.wirkt 1 [0–3] · schuesse.boden.blaster 155,5 [62–187] · schuesse.boden.pistol 1,5 [0–15] · schuesse.boden.sturmgewehr 0 [0–117]
  schuesse_gegner.boden.schrottblaster 51 [37–79] · schuesse_gegner.boden.waechter 3 [3–15] · treffer_je_schuss.boden.blaster 0,42 [0,32–0,54]
  treffer_je_schuss.boden.pistol 0,67 [0,38–1] · treffer_je_schuss.boden.sturmgewehr 0,39 [0,26–0,43]
  treffer_je_schuss_gegner.boden.schrottblaster 0,33 [0,25–0,53] · treffer_je_schuss_gegner.boden.waechter 1 [0,71–1] · treffer_n.boden.aus 72 [54–82]
  treffer_n.boden.ein 22 [15–32] · zeit_bis_kill.boden.grundtyp 14,85 [12,45–32,05] · zeit_bis_kill.boden.waechter 14,37 [9,13–21,27]
- **F2b Deckung:** deckung.p2.cv_anteil 22,98 [11,68–39,67] · deckung.p2.cv_s 28,71 [15,4–39,67] · deckung.p2.geduckt_s 0
  deckung.p2.verdeckt_s 6,77 [0,93–21,24] · deckung.p3.cv_anteil 24,17 [18,8–30,42] · deckung.p3.cv_s 30,09 [20,28–41,06] · deckung.p3.geduckt_s 0
  deckung.p3.verdeckt_s 8,17 [2,8–17,48] · gegner_abstand.min 0,5 [0–1,7] · gegner_abstand.nn_mittel 7,04 [5,85–11,7] · gegner_geduckt_anteil 7,49 [3,11–11,89]
  peek.episoden 15,5 [9–25] · peek.mit_schuss 8,5 [4–17] · schuesse_gegner.aus_deckung_anteil 0 · schuesse_spieler.aus_deckung_anteil 53,75 [32,03–60]
  treffer_auf_spieler.in_deckung_anteil 40,84 [15–60] · treffer_auf_spieler.n 22 [15–32] · treffer_von_spieler.aus_deckung_anteil 47,42 [29,27–63,64]
  treffer_von_spieler.n 72 [54–82] · verlassen.bewegt_n 23,5 [17–32] · verlassen.bis_treffer_median 2,09 [0,46–25,04] · verlassen.mit_treffer 6,5 [3–10]
  verlassen.n 27,5 [18–38]
- **F3 Verluste:** bodenschild_leer.n 2 [0–4] · erster_verlust_s 118,34 [67–141,33] · gefallen.n 1 [0–2] · gefallen.p2 0 [0–1] · gefallen.p3 0 [0–2]
  integritaet.min 100 [95,73–100] · neustarts 0 · notfall.n 0 · notrueckholung.krankenstation 0 [0–1] · notrueckholung.n 0 [0–2] · notrueckholung.team 0 [0–1]
  schiff_zerstoert.n 0 · zone_aus.kaputt 0 [0–1] · zone_aus.n 0 [0–1]
- **F4 Rollen:** dabei.p1 181 [162–194] · dabei.p2 181 [162–194] · dabei.p3 181 [162–194] · leerlauf.p1.anteil 25 [22,68–28,4] · leerlauf.p1.dauer 44 [44–46]
  leerlauf.p1.episoden 1 · leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0
  leerlauf.p3.episoden 0 · reparatur.dauer_mittel 3 · reparatur.erfolg_anteil 100 · reparatur.n 0 [0–1] · reparatur.notflicken 0
  rolle.p1.captain 175 [138–190] · rolle.p1.ohne 4 [4–30] · rolle.p2.boden 128 [88–144] · rolle.p2.helm 36 · rolle.p2.ohne 14 [14–46]
  rolle.p3.boden 128 [90–144] · rolle.p3.ohne 50 [50–82] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.ersatzteil.regal 0 [-2–0] · buchung.marks.belohnung 125 [120–180] · buchung.marks.erkundung 40 · buchung.medipack.medkit 0 [-1–0]
  buchung.medipackCharges.medkit 0 [0–2] · buchung.tafel.fund 1 · buchung.tafel.mission -1 · energie.engines_anteil 33,33 · energie.shields_anteil 33,33
  energie.weapons_anteil 33,33 · konto.ersatzteil.anfang 4 · konto.ersatzteil.ende 2 · konto.ersatzteil.netto -2 · konto.marks.anfang 150
  konto.marks.ende 315 [310–370] · konto.marks.netto 165 [160–220] · konto.medipack.anfang 2 · konto.medipack.ende 2 [1–2] · konto.medipack.netto 0 [-1–0]
  konto.medipackCharges.anfang 0 · konto.medipackCharges.ende 2 [1–2] · konto.medipackCharges.netto 2 [1–2] · konto.tafel.anfang 0 · konto.tafel.ende 0
  konto.tafel.netto 0
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 578,5 [436–683] · protokoll.zeilen_je_min 189,69 [155–210,12] · tick.n 5430 [4860–5820]
