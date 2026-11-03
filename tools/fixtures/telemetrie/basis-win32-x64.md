# Basis-Bericht der Bot-Läufe (win32-x64)

Erzeugt aus `basis-win32-x64.json` (`npm run basis`), ersetzt die Handtabellen der README. Gilt nur für **win32-x64**: auf anderer Plattform ist der Raumkampf nicht bit-gleich, der Bericht meldet das als Datenzeile.

- Spielstand wie `75ab5a7` (Commit der Läufe `3ecad8c1`), Node v22.20.0, Kennzahl-Version 1, Tuning-Hash `ebb15590fc57adb9`, Stand 2026-11-03.
- 12 Seeds je Gruppe, Laufzeit 16:34 min (4 Prozesse parallel), keine Fehlerläufe.
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
| `arena_away/aussenposten/3` Wellen aussenposten zu dritt | 12 | ok 12 | 5:14 min |
| `arena_away/kesh/1` Wellen kesh solo | 12 | ok 12 | 103 s |
| `arena_away/kesh/3` Wellen kesh zu dritt | 12 | ok 12 | 3:21 min |
| `arena_away/ruine/1` Wellen ruine solo | 12 | ok 12 | 118,1 s |
| `arena_away/ruine/3` Wellen ruine zu dritt | 12 | ok 12 | 3:33 min |
| `arena_away/schiff/1` Wellen schiff solo | 12 | ok 12 | 99,7 s |
| `arena_away/schiff/3` Wellen schiff zu dritt | 12 | ok 12 | 4:04 min |
| `arena_away/station/1` Wellen station solo | 12 | ok 12 | 114,4 s |
| `arena_away/station/3` Wellen station zu dritt | 12 | ok 12 | 4:50 min |
| `arena_graben/3` Grabenangriff zu dritt | 12 | ok 12 | 25:00 min |
| `arena_space/maneuver/3` Raumkampf-Arena zu dritt, Steuer maneuver | 12 | ok 12 | 14:35 min |
| `arena_space/nose/3` Raumkampf-Arena zu dritt, Steuer nose | 12 | ok 12 | 18:14 min |
| `m1/1` Kampagne solo (M1, M2) | 12 | ok 11, rot 1 | 19:38 min |
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

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 313,68 [164,7–476,13] · dauer.wellen_boden.mittel 298,68 [149,67–461,13] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 298,68 [149,67–461,13] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 30,58 [24,86–40,81] · wellen.geschafft 6 [3–9]
- **F2 Gefecht:** gefecht.boden 214 [108–328] · gegner_neu.boden 54,5 [20–102] · gegner_weg.boden 42,5 [12–90] · kills.boden.enterer 0 [0–4]
  kills.boden.gesamt 48 [16–96] · kills.boden.grenadier 1 [0–11] · kills.boden.grundtyp 26,5 [10–48] · kills.boden.niederhalter 7 [0–15]
  kills.boden.schuetze 15,5 [6–21] · kills_von.gegner 1 [0–6] · kills_von.p1 18 [8–40] · kills_von.p2 17,5 [3–34] · kills_von.p3 16 [4–35]
  quote.boden.blaster 47,7 [42,67–55,37] · quote.boden.pistol 75,1 [50–96,55] · quote_gegner.boden.blaster 83,48 [60–100]
  quote_gegner.boden.granatwerfer 76,92 [0–100] · quote_gegner.boden.lanze 100 · quote_gegner.boden.nahkampf 33,33
  quote_gegner.boden.schrottblaster 74,17 [26,67–100] · quote_gegner.boden.sturmgewehr 2,86 [0–7,16] · quote_wirkt.boden.blaster 47,7 [42,67–55,37]
  quote_wirkt.boden.pistol 75,1 [50–96,55] · quote_wirkt_gegner.boden.blaster 83,48 [60–100] · quote_wirkt_gegner.boden.granatwerfer 76,92 [0–100]
  quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.nahkampf 33,33 · quote_wirkt_gegner.boden.schrottblaster 74,17 [26,67–100]
  quote_wirkt_gegner.boden.sturmgewehr 2,86 [0–7,16] · schaden.boden.aus.roh 196 [56–340] · schaden.boden.aus.schild 147 [41–244]
  schaden.boden.aus.wirkt 46 [15–96] · schaden.boden.ein.roh 66,5 [38–136,5] · schaden.boden.ein.schild 60 [31–112,5] · schaden.boden.ein.wirkt 5,25 [2,5–23]
  schuesse.boden.blaster 344,5 [88–556] · schuesse.boden.pistol 50 [21–127] · schuesse_gegner.boden.blaster 12 [5–25]
  schuesse_gegner.boden.granatwerfer 2,5 [0–13] · schuesse_gegner.boden.lanze 7 [2–19] · schuesse_gegner.boden.nahkampf 0 [0–3]
  schuesse_gegner.boden.schrottblaster 14,5 [6–23] · schuesse_gegner.boden.sturmgewehr 380 [24–771] · treffer_je_schuss.boden.blaster 0,48 [0,43–0,55]
  treffer_je_schuss.boden.pistol 0,75 [0,5–0,97] · treffer_je_schuss_gegner.boden.blaster 0,84 [0,6–1]
  treffer_je_schuss_gegner.boden.granatwerfer 1,75 [0–2,75] · treffer_je_schuss_gegner.boden.lanze 4,75 [2,5–5,83]
  treffer_je_schuss_gegner.boden.nahkampf 0,67 · treffer_je_schuss_gegner.boden.schrottblaster 0,74 [0,27–1]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,03 [0–0,07] · treffer_n.boden.aus 196 [56–340] · treffer_n.boden.ein 60,5 [27–101]
  ueberhitzt.boden.gegner 7 [2–19] · zeit_bis_kill.boden.enterer 9,8 [7,15–12,1] · zeit_bis_kill.boden.grenadier 17,64 [5,83–35,4]
  zeit_bis_kill.boden.grundtyp 13,08 [9,87–21,03] · zeit_bis_kill.boden.niederhalter 33,09 [22,2–37,6] · zeit_bis_kill.boden.schuetze 15,65 [12,33–19,5]
- **F2b Deckung:** deckung.p1.cv_anteil 0 [0–0,27] · deckung.p1.cv_s 0 [0–1,16] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 63,64 [42,9–105,23]
  deckung.p2.cv_anteil 0 [0–0,26] · deckung.p2.cv_s 0 [0–0,94] · deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 72,17 [53,21–101,27]
  deckung.p3.cv_anteil 0 [0–0,22] · deckung.p3.cv_s 0 [0–0,93] · deckung.p3.geduckt_s 0 · deckung.p3.verdeckt_s 70,33 [46–107,48] · gegner_abstand.min 0 [0–0,2]
  gegner_abstand.nn_mittel 3,34 [1,99–8,34] · gegner_geduckt_anteil 0 [0–4,23] · peek.episoden 0 [0–3] · peek.mit_schuss 0 [0–3]
  schuesse_gegner.aus_deckung_anteil 0 · schuesse_spieler.aus_deckung_anteil 0 [0–0,23] · treffer_auf_spieler.in_deckung_anteil 0
  treffer_auf_spieler.n 60,5 [27–101] · treffer_von_spieler.aus_deckung_anteil 0 [0–0,49] · treffer_von_spieler.n 196 [56–340] · verlassen.bewegt_n 0 [0–6]
  verlassen.bis_treffer_median 26,6 [10,23–29,62] · verlassen.mit_treffer 0 [0–3] · verlassen.n 0 [0–6]
- **F3 Verluste:** bodenschild_leer.n 12 [6–22] · erster_verlust_s 96,2 [66,17–183,03] · gefallen.n 6,5 [4–12] · gefallen.p1 3 [1–4] · gefallen.p2 1,5 [1–4]
  gefallen.p3 2 [1–5] · neustarts 0 · notfall.n 0 · notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 312 [164–476] · dabei.p2 312 [164–476] · dabei.p3 312 [164–476] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0
  rolle.p1.boden 312 [164–476] · rolle.p2.boden 312 [164–476] · rolle.p3.boden 312 [164–476] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 0 · konto.medipack.netto -2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1767,5 [550–2971] · protokoll.zeilen_je_min 327,85 [200,36–407,24] · tick.n 9361 [4921–14281]

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

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 200,53 [96,83–268,13] · dauer.wellen_boden.mittel 185,5 [81,8–253,13] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 185,5 [81,8–253,13] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 23,94 [15,2–31,13] · wellen.geschafft 4 [2–5]
- **F2 Gefecht:** gefecht.boden 130 [58–184] · gegner_neu.boden 30 [12–42] · gegner_weg.boden 20 [6–30] · kills.boden.gesamt 26 [10–39]
  kills.boden.grundtyp 14 [7–21] · kills.boden.niederhalter 3,5 [0–5] · kills.boden.schuetze 9 [3–13] · kills_von.gegner 0 [0–2] · kills_von.p1 7,5 [2–15]
  kills_von.p2 9 [3–16] · kills_von.p3 9 [3–14] · quote.boden.blaster 40,6 [34,43–53,21] · quote.boden.pistol 61,99 [43,75–78,38]
  quote_gegner.boden.blaster 77,5 [50–100] · quote_gegner.boden.granatwerfer 54,17 [0–100] · quote_gegner.boden.lanze 100
  quote_gegner.boden.schrottblaster 65,33 [40–76] · quote_gegner.boden.sturmgewehr 5,56 [0–23,53] · quote_wirkt.boden.blaster 40,6 [34,43–53,21]
  quote_wirkt.boden.pistol 61,99 [43,75–78,38] · quote_wirkt_gegner.boden.blaster 77,5 [50–100] · quote_wirkt_gegner.boden.granatwerfer 54,17 [0–100]
  quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.schrottblaster 65,33 [40–76] · quote_wirkt_gegner.boden.sturmgewehr 5,56 [0–23,53]
  schaden.boden.aus.roh 121 [43–187] · schaden.boden.aus.schild 96 [33–149] · schaden.boden.aus.wirkt 26 [10–39] · schaden.boden.ein.roh 48,75 [23–87]
  schaden.boden.ein.schild 40,75 [17–72,5] · schaden.boden.ein.wirkt 5,75 [2,5–8,5] · schuesse.boden.blaster 217 [92–413] · schuesse.boden.pistol 41 [18–88]
  schuesse_gegner.boden.blaster 12 [1–22] · schuesse_gegner.boden.granatwerfer 0 [0–4] · schuesse_gegner.boden.lanze 4,5 [1–12]
  schuesse_gegner.boden.schrottblaster 24,5 [15–30] · schuesse_gegner.boden.sturmgewehr 117 [0–321] · treffer_je_schuss.boden.blaster 0,41 [0,34–0,53]
  treffer_je_schuss.boden.pistol 0,62 [0,44–0,78] · treffer_je_schuss_gegner.boden.blaster 0,78 [0,5–1] · treffer_je_schuss_gegner.boden.granatwerfer 0,92 [0–2]
  treffer_je_schuss_gegner.boden.lanze 2,7 [2–3,29] · treffer_je_schuss_gegner.boden.schrottblaster 0,66 [0,4–0,76]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,06 [0–0,24] · treffer_n.boden.aus 121 [43–187] · treffer_n.boden.ein 43 [17–69]
  ueberhitzt.boden.gegner 4,5 [1–12] · zeit_bis_kill.boden.grundtyp 12,96 [8,45–18,33] · zeit_bis_kill.boden.niederhalter 23,3 [12,1–34,63]
  zeit_bis_kill.boden.schuetze 13,76 [5,17–18,47]
- **F2b Deckung:** deckung.p1.cv_anteil 2,91 [0,15–8,09] · deckung.p1.cv_s 5,49 [0,24–16,35] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 16,6 [6,3–24,93]
  deckung.p2.cv_anteil 2,53 [0–8,55] · deckung.p2.cv_s 5,72 [0–17,28] · deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 17,43 [8,88–33,96]
  deckung.p3.cv_anteil 2,94 [0–6,83] · deckung.p3.cv_s 5,27 [0–15,86] · deckung.p3.geduckt_s 0 · deckung.p3.verdeckt_s 20,29 [8,65–33,17]
  gegner_abstand.min 0 [0–0,2] · gegner_abstand.nn_mittel 3,8 [2,83–4,45] · gegner_geduckt_anteil 8,57 [1,14–16,29] · peek.episoden 2,5 [0–14]
  peek.mit_schuss 2 [0–5] · schuesse_gegner.aus_deckung_anteil 0 [0–1,52] · schuesse_spieler.aus_deckung_anteil 5,07 [0–14,92]
  treffer_auf_spieler.in_deckung_anteil 3,87 [0–12,5] · treffer_auf_spieler.n 43 [17–69] · treffer_von_spieler.aus_deckung_anteil 5,59 [0–17,57]
  treffer_von_spieler.n 121 [43–187] · verlassen.bewegt_n 9,5 [0–29] · verlassen.bis_treffer_median 18,93 [2,8–26,36] · verlassen.mit_treffer 7 [0–13]
  verlassen.n 10,5 [1–31]
- **F3 Verluste:** bodenschild_leer.n 8,5 [3–18] · erster_verlust_s 71,25 [17,67–83,73] · gefallen.n 5,5 [3–8] · gefallen.p1 2 [1–4] · gefallen.p2 1,5 [1–4]
  gefallen.p3 1 [1–3] · neustarts 0 · notfall.n 0 · notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 199 [96–268] · dabei.p2 199 [96–268] · dabei.p3 199 [96–268] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0
  rolle.p1.boden 199 [96–268] · rolle.p2.boden 199 [96–268] · rolle.p3.boden 199 [96–268] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 0 · konto.medipack.netto -2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 982,5 [376–1635] · protokoll.zeilen_je_min 296,71 [232,99–365,87] · tick.n 5971 [2881–8041]

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

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 213,23 [188,13–323,73] · dauer.wellen_boden.mittel 198,2 [173,1–308,73] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 198,2 [173,1–308,73] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 23,15 [17,24–40,36] · wellen.geschafft 4 [4–6]
- **F2 Gefecht:** gefecht.boden 144 [118–240] · gegner_neu.boden 30 [30–56] · gegner_weg.boden 20 [20–44] · kills.boden.gesamt 29,5 [26–51]
  kills.boden.grenadier 0 [0–3] · kills.boden.grundtyp 16 [14–26] · kills.boden.niederhalter 4 [2–7] · kills.boden.schuetze 10 [9–15] · kills_von.gegner 0 [0–2]
  kills_von.p1 11 [5–18] · kills_von.p2 8,5 [5–19] · kills_von.p3 12,5 [6–16] · quote.boden.blaster 41,76 [34,78–46,05] · quote.boden.pistol 58,01 [39,71–75,76]
  quote_gegner.boden.blaster 84,52 [54,55–100] · quote_gegner.boden.granatwerfer 50 [0–75] · quote_gegner.boden.lanze 100
  quote_gegner.boden.schrottblaster 69,21 [46,15–85] · quote_gegner.boden.sturmgewehr 3,21 [1,78–8,7] · quote_wirkt.boden.blaster 41,76 [34,78–46,05]
  quote_wirkt.boden.pistol 58,01 [39,71–75,76] · quote_wirkt_gegner.boden.blaster 84,52 [54,55–100] · quote_wirkt_gegner.boden.granatwerfer 50 [0–75]
  quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.schrottblaster 69,21 [46,15–85] · quote_wirkt_gegner.boden.sturmgewehr 3,21 [1,78–8,7]
  schaden.boden.aus.roh 126 [110–230] · schaden.boden.aus.schild 98 [82–181] · schaden.boden.aus.wirkt 29,5 [26–49] · schaden.boden.ein.roh 48,25 [35,5–96]
  schaden.boden.ein.schild 41 [31,5–79,5] · schaden.boden.ein.wirkt 4,75 [2–9,5] · schuesse.boden.blaster 256,5 [200–377] · schuesse.boden.pistol 50 [12–134]
  schuesse_gegner.boden.blaster 11,5 [4–26] · schuesse_gegner.boden.granatwerfer 0 [0–6] · schuesse_gegner.boden.lanze 6 [3–15]
  schuesse_gegner.boden.schrottblaster 20 [13–35] · schuesse_gegner.boden.sturmgewehr 187 [103–455] · treffer_je_schuss.boden.blaster 0,42 [0,35–0,46]
  treffer_je_schuss.boden.pistol 0,58 [0,4–0,76] · treffer_je_schuss_gegner.boden.blaster 0,85 [0,55–1] · treffer_je_schuss_gegner.boden.granatwerfer 1 [0–1,5]
  treffer_je_schuss_gegner.boden.lanze 2,15 [1,67–3,75] · treffer_je_schuss_gegner.boden.schrottblaster 0,69 [0,46–0,85]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,03 [0,02–0,09] · treffer_n.boden.aus 126 [110–230] · treffer_n.boden.ein 42,5 [35–75]
  ueberhitzt.boden.gegner 6 [3–15] · zeit_bis_kill.boden.grenadier 17,5 [13,53–32,37] · zeit_bis_kill.boden.grundtyp 15 [11,3–22,82]
  zeit_bis_kill.boden.niederhalter 24,1 [15–40,73] · zeit_bis_kill.boden.schuetze 16,09 [9,97–22,87]
- **F2b Deckung:** deckung.p1.cv_anteil 3,95 [0,25–12,43] · deckung.p1.cv_s 10,72 [0,47–26,6] · deckung.p1.geduckt_s 0
  deckung.p1.verdeckt_s 33,29 [25,65–43,3] · deckung.p2.cv_anteil 2,31 [0,34–13,95] · deckung.p2.cv_s 6,17 [0,7–30,69] · deckung.p2.geduckt_s 0
  deckung.p2.verdeckt_s 34,61 [18,2–48,03] · deckung.p3.cv_anteil 3,35 [0,25–17,36] · deckung.p3.cv_s 8,28 [0,47–37,14] · deckung.p3.geduckt_s 0
  deckung.p3.verdeckt_s 31,29 [20,07–43,23] · gegner_abstand.min 0 [0–0,2] · gegner_abstand.nn_mittel 3,95 [3,39–5,21] · gegner_geduckt_anteil 5,34 [1,16–14,24]
  peek.episoden 11,5 [0–35] · peek.mit_schuss 3,5 [0–13] · schuesse_gegner.aus_deckung_anteil 0 [0–3,68] · schuesse_spieler.aus_deckung_anteil 6,89 [0,33–24,52]
  treffer_auf_spieler.in_deckung_anteil 3,34 [0–22,22] · treffer_auf_spieler.n 42,5 [35–75] · treffer_von_spieler.aus_deckung_anteil 6,38 [0–21,6]
  treffer_von_spieler.n 126 [110–230] · verlassen.bewegt_n 21 [4–38] · verlassen.bis_treffer_median 5,57 [2,63–21,17] · verlassen.mit_treffer 10,5 [3–17]
  verlassen.n 25,5 [4–43]
- **F3 Verluste:** bodenschild_leer.n 8,5 [6–18] · erster_verlust_s 76,95 [22,57–152,6] · gefallen.n 5 [3–9] · gefallen.p1 2 [1–5] · gefallen.p2 1 [1–4]
  gefallen.p3 1,5 [1–2] · neustarts 0 · notfall.n 0 · notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 212 [188–322] · dabei.p2 212 [188–322] · dabei.p3 212 [188–322] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0
  rolle.p1.boden 212 [188–322] · rolle.p2.boden 212 [188–322] · rolle.p3.boden 212 [188–322] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 0 · konto.medipack.netto -2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1184 [962–2011] · protokoll.zeilen_je_min 339,98 [272,87–393,32] · tick.n 6361 [5641–9661]

## arena_away/schiff/1 – Wellen schiff solo

`node tools/sim-headless.js wellen --karte schiff --players 1 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 99,74 [59,17–194,9] · dauer.wellen_boden.mittel 84,7 [44,13–179,87] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 84,7 [44,13–179,87] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 1 · spieler.nachzuegler 0 · spieler.start 1
  wellen.dauer_mittel 15,19 [8,83–24,96] · wellen.geschafft 2 [1–4]
- **F2 Gefecht:** gefecht.boden 60 [36–128] · gegner_neu.boden 6 [3–15] · gegner_weg.boden 3 [1–10] · kills.boden.gesamt 5 [2–12] · kills.boden.grundtyp 3 [1–6]
  kills.boden.niederhalter 0 [0–2] · kills.boden.schuetze 2 [1–4] · kills_von.gegner 0 [0–1] · kills_von.p1 5 [2–12] · quote.boden.blaster 71,15 [32–80]
  quote.boden.pistol 90 [35,29–100] · quote_gegner.boden.blaster 91,67 [50–100] · quote_gegner.boden.lanze 100
  quote_gegner.boden.schrottblaster 95,84 [60–100] · quote_gegner.boden.sturmgewehr 8,2 [0–12,5] · quote_wirkt.boden.blaster 71,15 [32–80]
  quote_wirkt.boden.pistol 90 [35,29–100] · quote_wirkt_gegner.boden.blaster 91,67 [50–100] · quote_wirkt_gegner.boden.lanze 100
  quote_wirkt_gegner.boden.schrottblaster 95,84 [60–100] · quote_wirkt_gegner.boden.sturmgewehr 8,2 [0–12,5] · schaden.boden.aus.roh 23,5 [9–61]
  schaden.boden.aus.schild 18,5 [7–49] · schaden.boden.aus.wirkt 5 [2–12] · schaden.boden.ein.roh 10 [5–23] · schaden.boden.ein.schild 8,5 [4–22,5]
  schaden.boden.ein.wirkt 1 [0,5–3] · schuesse.boden.blaster 24 [8–73] · schuesse.boden.pistol 5,5 [0–17] · schuesse_gegner.boden.blaster 1,5 [0–6]
  schuesse_gegner.boden.lanze 1 [0–3] · schuesse_gegner.boden.schrottblaster 6,5 [3–12] · schuesse_gegner.boden.sturmgewehr 0 [0–88]
  treffer_je_schuss.boden.blaster 0,72 [0,32–0,8] · treffer_je_schuss.boden.pistol 0,9 [0,35–1] · treffer_je_schuss_gegner.boden.blaster 0,92 [0,5–1]
  treffer_je_schuss_gegner.boden.lanze 1,5 [1–2,5] · treffer_je_schuss_gegner.boden.schrottblaster 0,96 [0,6–1]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,09 [0–0,13] · treffer_n.boden.aus 23,5 [9–61] · treffer_n.boden.ein 8 [4–25] · ueberhitzt.boden.gegner 1 [0–3]
  zeit_bis_kill.boden.grundtyp 11,48 [6,52–23,87] · zeit_bis_kill.boden.niederhalter 33,27 [6,7–34,57] · zeit_bis_kill.boden.schuetze 16,91 [6,47–30,6]
- **F2b Deckung:** deckung.p1.cv_anteil 1,08 [0–10,12] · deckung.p1.cv_s 0,94 [0–7,72] · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 23,46 [15,66–52,36]
  gegner_abstand.min 0,05 [0–0,8] · gegner_abstand.nn_mittel 2,94 [1,83–5,32] · gegner_geduckt_anteil 3,47 [0–29,51] · peek.episoden 0,5 [0–6]
  peek.mit_schuss 0 [0–1] · schuesse_gegner.aus_deckung_anteil 0 · schuesse_spieler.aus_deckung_anteil 0 [0–13,33]
  treffer_auf_spieler.in_deckung_anteil 0 [0–28,57] · treffer_auf_spieler.n 8 [4–25] · treffer_von_spieler.aus_deckung_anteil 0 [0–8,7]
  treffer_von_spieler.n 23,5 [9–61] · verlassen.bewegt_n 2,5 [0–8] · verlassen.bis_treffer_median 11,39 [0,5–26,07] · verlassen.mit_treffer 2 [0–4]
  verlassen.n 2,5 [0–9]
- **F3 Verluste:** bodenschild_leer.n 2 [1–7] · erster_verlust_s 53,92 [34,2–125,1] · gefallen.n 1 [1–2] · gefallen.p1 1 [1–2] · neustarts 0 · notfall.n 0
  notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 99 [58–194] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · rolle.p1.boden 99 [58–194] · wechsel.p1 0
- **F5 Wirtschaft:** buchung.medipack.medkit -1 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 1 · konto.medipack.netto -1 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 206 [82–527] · protokoll.zeilen_je_min 121,91 [83,15–168,25] · tick.n 2971 [1741–5821]

## arena_away/schiff/3 – Wellen schiff zu dritt

`node tools/sim-headless.js wellen --karte schiff --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 244,17 [182,23–621,87] · dauer.wellen_boden.mittel 229,13 [167,2–606,83] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 229,13 [167,2–606,83] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 23,58 [19,46–38,95] · wellen.geschafft 5 [4–10]
- **F2 Gefecht:** gefecht.boden 161 [118–468] · gegner_neu.boden 42 [30–131] · gegner_weg.boden 30 [20–119] · kills.boden.enterer 0 [0–10]
  kills.boden.gesamt 40 [25–134] · kills.boden.grenadier 1 [0–16] · kills.boden.grundtyp 21 [15–63] · kills.boden.haescher 0 [0–1]
  kills.boden.niederhalter 6 [1–18] · kills.boden.schuetze 13,5 [9–26] · kills_von.gegner 0 [0–2] · kills_von.p1 13,5 [8–57] · kills_von.p2 13 [6–34]
  kills_von.p3 15,5 [5–42] · quote.boden.blaster 59,52 [44,79–68,87] · quote.boden.pistol 85,28 [68,25–100] · quote_gegner.boden.betaeuber 33,33
  quote_gegner.boden.blaster 83,98 [55,56–100] · quote_gegner.boden.granatwerfer 75 [0–100] · quote_gegner.boden.lanze 100
  quote_gegner.boden.nahkampf 75 [0–100] · quote_gegner.boden.schrottblaster 80 [58,33–95] · quote_gegner.boden.sturmgewehr 8,6 [2,02–13,03]
  quote_wirkt.boden.blaster 59,52 [44,79–68,87] · quote_wirkt.boden.pistol 85,28 [68,25–100] · quote_wirkt_gegner.boden.betaeuber 33,33
  quote_wirkt_gegner.boden.blaster 83,98 [55,56–100] · quote_wirkt_gegner.boden.granatwerfer 75 [0–100] · quote_wirkt_gegner.boden.lanze 100
  quote_wirkt_gegner.boden.nahkampf 75 [0–100] · quote_wirkt_gegner.boden.schrottblaster 80 [58,33–95] · quote_wirkt_gegner.boden.sturmgewehr 8,6 [2,02–13,03]
  schaden.boden.aus.roh 166 [103–558] · schaden.boden.aus.schild 126 [78–415] · schaden.boden.aus.wirkt 40 [25–143] · schaden.boden.ein.roh 56,75 [28,5–169,5]
  schaden.boden.ein.schild 50,5 [24–172,5] · schaden.boden.ein.wirkt 4,5 [2,5–11,5] · schuesse.boden.blaster 274 [168–802] · schuesse.boden.pistol 34,5 [10–195]
  schuesse_gegner.boden.betaeuber 0 [0–3] · schuesse_gegner.boden.blaster 12,5 [5–22] · schuesse_gegner.boden.granatwerfer 2,5 [0–16]
  schuesse_gegner.boden.lanze 5 [2–15] · schuesse_gegner.boden.nahkampf 0 [0–3] · schuesse_gegner.boden.schrottblaster 16 [11–20]
  schuesse_gegner.boden.sturmgewehr 281,5 [59–658] · treffer_je_schuss.boden.blaster 0,6 [0,45–0,69] · treffer_je_schuss.boden.pistol 0,86 [0,68–1]
  treffer_je_schuss_gegner.boden.betaeuber 0,33 · treffer_je_schuss_gegner.boden.blaster 0,84 [0,56–1]
  treffer_je_schuss_gegner.boden.granatwerfer 1,75 [0–2,67] · treffer_je_schuss_gegner.boden.lanze 3 [2–4,17]
  treffer_je_schuss_gegner.boden.nahkampf 1,5 [0–1,67] · treffer_je_schuss_gegner.boden.schrottblaster 0,8 [0,58–0,95]
  treffer_je_schuss_gegner.boden.sturmgewehr 0,09 [0,02–0,13] · treffer_n.boden.aus 166 [103–558] · treffer_n.boden.ein 51,5 [26–163]
  ueberhitzt.boden.gegner 5 [2–15] · zeit_bis_kill.boden.enterer 13,17 [10,17–17,52] · zeit_bis_kill.boden.grenadier 20,19 [4,23–33,33]
  zeit_bis_kill.boden.grundtyp 14,9 [8,66–18,27] · zeit_bis_kill.boden.haescher 34,17 · zeit_bis_kill.boden.niederhalter 23,85 [9,63–34,89]
  zeit_bis_kill.boden.schuetze 13,48 [5,47–19,33]
- **F2b Deckung:** deckung.p1.cv_anteil 2,4 [0,33–7,97] · deckung.p1.cv_s 6,43 [0,69–19,61] · deckung.p1.geduckt_s 0
  deckung.p1.verdeckt_s 70,82 [49,71–166,81] · deckung.p2.cv_anteil 3,68 [0,18–10,48] · deckung.p2.cv_s 9,92 [0,47–24,74] · deckung.p2.geduckt_s 0
  deckung.p2.verdeckt_s 67,67 [50,15–161,28] · deckung.p3.cv_anteil 2,07 [0,22–7,6] · deckung.p3.cv_s 7,83 [0,46–18,69] · deckung.p3.geduckt_s 0
  deckung.p3.verdeckt_s 66,79 [50,85–152,82] · gegner_abstand.min 0 · gegner_abstand.nn_mittel 3,63 [2,77–4,06] · gegner_geduckt_anteil 3,74 [1,74–8,21]
  peek.episoden 11 [0–22] · peek.mit_schuss 5 [0–10] · schuesse_gegner.aus_deckung_anteil 0 [0–1,85] · schuesse_spieler.aus_deckung_anteil 5,57 [0,44–15,76]
  treffer_auf_spieler.in_deckung_anteil 2,77 [0–8,89] · treffer_auf_spieler.n 51,5 [26–163] · treffer_von_spieler.aus_deckung_anteil 5,42 [0–14,09]
  treffer_von_spieler.n 166 [103–558] · verlassen.bewegt_n 18,5 [3–42] · verlassen.bis_treffer_median 14,39 [2,93–28,32] · verlassen.mit_treffer 10,5 [5–24]
  verlassen.n 22,5 [6–46]
- **F3 Verluste:** bodenschild_leer.n 9 [4–37] · erster_verlust_s 75,85 [17,4–161,67] · gefallen.n 4,5 [3–12] · gefallen.p1 2 [1–6] · gefallen.p2 2 [1–5]
  gefallen.p3 1 [1–6] · integritaet.min 100 · neustarts 0 · notfall.n 0 · notrueckholung.einzel 0 [0–1] · notrueckholung.fern 0 [0–2] · notrueckholung.n 0 [0–3]
  schiff_zerstoert.n 0 · zone_aus.kaputt 0 [0–1] · zone_aus.n 0 [0–1]
- **F4 Rollen:** dabei.p1 243 [182–620] · dabei.p2 243 [182–620] · dabei.p3 243 [182–620] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 [0–9,28] · leerlauf.p3.dauer 0 [0–44]
  leerlauf.p3.episoden 0 [0–1] · rolle.p1.boden 243 [182–620] · rolle.p2.boden 243 [182–620] · rolle.p3.boden 243 [182–620] · rolle.p3.ohne 0 [0–8]
  wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · energie.engines_anteil 33,33 · energie.shields_anteil 33,33 · energie.weapons_anteil 33,33
  konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2 · konto.medipack.ende 0 · konto.medipack.netto -2
  stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1445,5 [828–4172] · protokoll.zeilen_je_min 346,72 [272,62–402,53] · tick.n 7291 [5461–18601]

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

- **F1 Dauer und Ausgang:** ausgang.unten 1 · dauer.session 290,46 [190,7–422,4] · dauer.wellen_boden.mittel 275,46 [175,67–407,4] · dauer.wellen_boden.n 1
  dauer.wellen_boden.summe 275,46 [175,67–407,4] · spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
  wellen.dauer_mittel 24,47 [19,27–35,45] · wellen.geschafft 6 [4–7]
- **F2 Gefecht:** gefecht.boden 191 [124–310] · gegner_neu.boden 56 [30–72] · gegner_weg.boden 44 [20–60] · kills.boden.enterer 0 [0–1]
  kills.boden.gesamt 56 [26–75] · kills.boden.grenadier 2 [0–5] · kills.boden.grundtyp 27 [14–35] · kills.boden.niederhalter 10 [4–12]
  kills.boden.schuetze 16 [8–23] · kills_von.gegner 0 [0–2] · kills_von.p1 15,5 [8–31] · kills_von.p2 16,5 [8–26] · kills_von.p3 17,5 [10–27]
  quote.boden.blaster 52,62 [46,84–66,9] · quote.boden.pistol 70,38 [56,25–87,5] · quote_gegner.boden.blaster 80 [66,67–100]
  quote_gegner.boden.granatwerfer 91,67 [0–100] · quote_gegner.boden.lanze 100 · quote_gegner.boden.nahkampf 75 [50–100]
  quote_gegner.boden.schrottblaster 84,52 [56,25–100] · quote_gegner.boden.sturmgewehr 7,98 [3,82–14,41] · quote_wirkt.boden.blaster 52,62 [46,84–66,9]
  quote_wirkt.boden.pistol 70,38 [56,25–87,5] · quote_wirkt_gegner.boden.blaster 80 [66,67–100] · quote_wirkt_gegner.boden.granatwerfer 91,67 [0–100]
  quote_wirkt_gegner.boden.lanze 100 · quote_wirkt_gegner.boden.nahkampf 75 [50–100] · quote_wirkt_gegner.boden.schrottblaster 84,52 [56,25–100]
  quote_wirkt_gegner.boden.sturmgewehr 7,98 [3,82–14,41] · schaden.boden.aus.roh 228,5 [103–307] · schaden.boden.aus.schild 173 [77–233]
  schaden.boden.aus.wirkt 55 [26–74] · schaden.boden.ein.roh 54,25 [29–98,5] · schaden.boden.ein.schild 47,25 [27–82,5] · schaden.boden.ein.wirkt 4,75 [1,5–9,5]
  schuesse.boden.blaster 306 [166–566] · schuesse.boden.pistol 55 [16–134] · schuesse_gegner.boden.blaster 11 [3–22]
  schuesse_gegner.boden.granatwerfer 3 [0–14] · schuesse_gegner.boden.lanze 3 [1–8] · schuesse_gegner.boden.nahkampf 0 [0–2]
  schuesse_gegner.boden.schrottblaster 11 [7–18] · schuesse_gegner.boden.sturmgewehr 318 [111–581] · treffer_je_schuss.boden.blaster 0,53 [0,47–0,67]
  treffer_je_schuss.boden.pistol 0,71 [0,56–0,88] · treffer_je_schuss_gegner.boden.blaster 0,8 [0,67–1] · treffer_je_schuss_gegner.boden.granatwerfer 2,17 [0–3]
  treffer_je_schuss_gegner.boden.lanze 3,54 [2,67–4,5] · treffer_je_schuss_gegner.boden.nahkampf 1,25 [0,5–2]
  treffer_je_schuss_gegner.boden.schrottblaster 0,85 [0,56–1] · treffer_je_schuss_gegner.boden.sturmgewehr 0,08 [0,04–0,14]
  treffer_n.boden.aus 228,5 [103–307] · treffer_n.boden.ein 57,5 [31–98] · ueberhitzt.boden.gegner 3 [1–8] · zeit_bis_kill.boden.enterer 11,37 [8,07–14,67]
  zeit_bis_kill.boden.grenadier 22,95 [10,97–29,97] · zeit_bis_kill.boden.grundtyp 14,78 [7,65–25,03] · zeit_bis_kill.boden.niederhalter 26,99 [19,22–33,45]
  zeit_bis_kill.boden.schuetze 16,29 [9,27–20,2]
- **F2b Deckung:** deckung.p1.cv_anteil 0 · deckung.p1.cv_s 0 · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 70,91 [58,86–92,14] · deckung.p2.cv_anteil 0
  deckung.p2.cv_s 0 · deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 77,68 [52,17–90,12] · deckung.p3.cv_anteil 0 · deckung.p3.cv_s 0 · deckung.p3.geduckt_s 0
  deckung.p3.verdeckt_s 68,97 [52,43–100,39] · gegner_abstand.min 0 · gegner_abstand.nn_mittel 3,2 [2,54–4,79] · gegner_geduckt_anteil 0
  schuesse_gegner.aus_deckung_anteil 0 · schuesse_spieler.aus_deckung_anteil 0 · treffer_auf_spieler.in_deckung_anteil 0 · treffer_auf_spieler.n 57,5 [31–98]
  treffer_von_spieler.aus_deckung_anteil 0 · treffer_von_spieler.n 228,5 [103–307]
- **F3 Verluste:** bodenschild_leer.n 8,5 [3–23] · erster_verlust_s 84,44 [45,37–278,33] · gefallen.n 5 [3–13] · gefallen.p1 2 [1–6] · gefallen.p2 2 [1–3]
  gefallen.p3 1 [1–5] · neustarts 0 · notfall.n 0 · notrueckholung.n 0 · schiff_zerstoert.n 0 · zone_aus.kaputt 0 · zone_aus.n 0
- **F4 Rollen:** dabei.p1 289 [190–422] · dabei.p2 289 [190–422] · dabei.p3 289 [190–422] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0
  leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0
  rolle.p1.boden 289 [190–422] · rolle.p2.boden 289 [190–422] · rolle.p3.boden 289 [190–422] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 0 · konto.medipack.netto -2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1667 [869–2568] · protokoll.zeilen_je_min 332,7 [264,23–390,2] · tick.n 8671 [5701–12661]

## arena_graben/3 – Grabenangriff zu dritt

`node tools/sim-headless.js graben --players 3 --seeds 1 --seed <S>` · Seeds 1–12 · 12 Läufe

> [!warning] Alle Läufe am Zeitlimit, Bot schafft den Graben nicht; Spannen sind kein Balance-Maß.

- **F1 Dauer und Ausgang:** ausgang.session_ende 1 · dauer.graben.mittel 1500,03 · dauer.graben.n 1 · dauer.graben.summe 1500,03 · dauer.session 1500,03
  spieler.abgaenge 0 · spieler.beitritte 0 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
- **F2 Gefecht:** gefecht.boden 1500 · gegner_neu.boden 1188 [1176–1200] · gegner_weg.boden 1176 [1164–1188] · kills.boden.gesamt 58 [52–65]
  kills.boden.grenadier 6 [2–11] · kills.boden.grundtyp 51,5 [46–59] · kills_von.p1 22 [14–27] · kills_von.p2 21 [14–28] · kills_von.p3 18 [12–24]
  quote.boden.blaster 24,32 [19,63–26,52] · quote.boden.pistol 16,49 [16,12–18,53] · quote_gegner.boden.blaster 42,41 [41,44–43,86]
  quote_gegner.boden.granatwerfer 33,85 [32,38–37,5] · quote_gegner.boden.lanze 99,29 [98,58–100] · quote_wirkt.boden.blaster 24,32 [19,63–26,52]
  quote_wirkt.boden.pistol 16,49 [16,12–18,53] · quote_wirkt_gegner.boden.blaster 42,41 [41,44–43,86] · quote_wirkt_gegner.boden.granatwerfer 33,85 [32,38–37,5]
  quote_wirkt_gegner.boden.lanze 99,29 [98,58–100] · schaden.boden.aus.roh 509,5 [472–548] · schaden.boden.aus.schild 452 [415–483]
  schaden.boden.aus.wirkt 58 [52–65] · schaden.boden.ein.roh 1474,5 [1463–1493] · schaden.boden.ein.schild 939,5 [932–947]
  schaden.boden.ein.wirkt 407 [401–418] · schuesse.boden.blaster 546 [513–580] · schuesse.boden.pistol 2270,5 [2233–2317]
  schuesse_gegner.boden.blaster 1565,5 [1537–1612] · schuesse_gegner.boden.granatwerfer 181,5 [158–210] · schuesse_gegner.boden.lanze 286,5 [278–297]
  treffer_je_schuss.boden.blaster 0,24 [0,2–0,27] · treffer_je_schuss.boden.pistol 0,17 [0,16–0,19] · treffer_je_schuss_gegner.boden.blaster 0,42 [0,41–0,44]
  treffer_je_schuss_gegner.boden.granatwerfer 0,56 [0,49–0,65] · treffer_je_schuss_gegner.boden.lanze 1,51 [1,44–1,57] · treffer_n.boden.aus 509,5 [472–548]
  treffer_n.boden.ein 1121,5 [1115–1136] · ueberhitzt.boden.gegner 286,5 [278–297] · zeit_bis_kill.boden.grenadier 13,19 [11,67–13,87]
  zeit_bis_kill.boden.grundtyp 11,6 [11,23–12,2]
- **F2b Deckung:** deckung.p1.cv_anteil 0 · deckung.p1.cv_s 0 · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 0 · deckung.p2.cv_anteil 0 · deckung.p2.cv_s 0
  deckung.p2.geduckt_s 0 · deckung.p2.verdeckt_s 0 · deckung.p3.cv_anteil 0 · deckung.p3.cv_s 0 · deckung.p3.geduckt_s 0 · deckung.p3.verdeckt_s 0
  gegner_abstand.min 0,15 [0–0,5] · gegner_abstand.nn_mittel 6,89 [6,82–6,92] · gegner_geduckt_anteil 3,72 [3,51–3,9] · schuesse_gegner.aus_deckung_anteil 100
  schuesse_spieler.aus_deckung_anteil 0 · treffer_auf_spieler.in_deckung_anteil 0 · treffer_auf_spieler.n 1121,5 [1115–1136]
  treffer_von_spieler.aus_deckung_anteil 0 · treffer_von_spieler.n 509,5 [472–548]
- **F3 Verluste:** bodenschild_leer.n 344 [342–348] · erster_verlust_s 3,8 [3,7–3,87] · gefallen.n 344 [342–347] · gefallen.p1 100 [98–103]
  gefallen.p2 145,5 [140–150] · gefallen.p3 98 [97–100] · neustarts 98 [97–99] · notfall.n 0 · notrueckholung.n 98 [97–99] · notrueckholung.team 98 [97–99]
  schiff_zerstoert.n 0 · zone_aus.kaputt 98 [97–99] · zone_aus.n 98 [97–99]
- **F4 Rollen:** dabei.p1 1500 · dabei.p2 1500 · dabei.p3 1500 · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · leerlauf.p2.anteil 0
  leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0 · leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0 · rolle.p1.boden 1500 · rolle.p2.boden 1500
  rolle.p3.boden 1500 · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.medipack.medkit -2 · konto.marks.anfang 5000 · konto.marks.ende 5000 · konto.marks.netto 0 · konto.medipack.anfang 2
  konto.medipack.ende 0 · konto.medipack.netto -2 · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 12608 [12510–12688] · protokoll.zeilen_je_min 504,31 [500,39–507,51] · tick.n 45001

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
  schaden.raum.aus.roh 352,12 [43,77–942,9] · schaden.raum.aus.schild 49,5 [6–86,16] · schaden.raum.aus.wirkt 266,37 [30,47–708,09]
  schaden.raum.ein.roh 270 [65,5–408] · schaden.raum.ein.schild 41,5 [15,5–101,5] · schaden.raum.ein.wirkt 223,5 [10,5–392,5] · schuesse.raum.lanze 14,5 [2–47]
  schuesse.raum.standardbatterie 98 [9–204] · treffer_je_schuss.raum.lanze 1 [0,87–1] · treffer_je_schuss.raum.standardbatterie 0,9 [0,69–0,98]
  treffer_n.raum.aus 99 [11–241] · treffer_n.raum.ein 160 [47–279] · zeit_bis_kill.raum.korvette 102,3 [62,87–137,4]
  zeit_bis_kill.raum.pylon 55,15 [45,93–64,37] · zeit_bis_kill.raum.raider 111,26 [78,03–147,2] · zeit_bis_kill.raum.sentinel 70,89 [45,93–93,13]
- **F3 Verluste:** bodenschild_leer.n 0 · erster_verlust_s 49,44 [15,97–337,7] · gefallen.n 0 · integritaet.min 34,19 [34,19–95,73] · neustarts 0
  notfall.n 2 [0–2] · notrueckholung.n 0 · schiff_zerstoert.n 2 [0–2] · zone_aus.kaputt 18,5 [4–73] · zone_aus.n 35 [9–88]
- **F4 Rollen:** dabei.p1 1094 [820–1146] · dabei.p2 1094 [820–1146] · dabei.p3 1094 [820–1146] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0
  leerlauf.p1.episoden 0 · leerlauf.p2.anteil 0 [0–13,93] · leerlauf.p2.dauer 0 [0–144] · leerlauf.p2.episoden 0 [0–3] · leerlauf.p3.anteil 21,5 [0–79,81]
  leerlauf.p3.dauer 239 [0–846] · leerlauf.p3.episoden 3,5 [0–11] · reparatur.dauer_mittel 3 [1,59–4,84] · reparatur.erfolg_anteil 100 [94,74–100]
  reparatur.n 1,5 [0–31] · reparatur.notflicken 0 [0–28] · rolle.p1.helm 476 [74–810] · rolle.p1.ohne 612 [62–1072] · rolle.p2.ohne 599 [2–962]
  rolle.p2.weapons 525 [184–888] · rolle.p3.captain 1045 [96–1144] · rolle.p3.ohne 2 [2–1050] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 224,5 [22–501]
- **F5 Wirtschaft:** buchung.ersatzteil.bot -1 [-3–0] · buchung.ersatzteil.regal -2 [-3–0] · buchung.marks.abschuss 110 [0–485]
  buchung.marks.notfall -100 [-100–0] · energie.automatik_n 4,5 [0–6] · energie.engines_anteil 38,27 [33,33–45,88] · energie.shields_anteil 39,73 [33,33–45,88]
  energie.weapons_anteil 20,55 [8,23–33,33] · konto.ersatzteil.anfang 4 · konto.ersatzteil.ende 1 [0–3] · konto.ersatzteil.netto -3 [-4–-1]
  konto.marks.anfang 5000 · konto.marks.ende 5035 [4900–5485] · konto.marks.netto 35 [-100–485] · stand.marks.testmarken 5000
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1256,5 [930–1548] · protokoll.zeilen_je_min 69,17 [48,67–105,1] · tick.n 32820 [24600–34380]

## m1/1 – Kampagne solo (M1, M2)

`node tools/sim-headless.js 1 --seed <S>` · Seeds 1–12 · 12 Läufe

- **F1 Dauer und Ausgang:** ausgang.erfolg 1 [0–1] · ausgang.geliefert 1 · ausgang.session_ende 1 · dauer.kampagne.mittel 588,93 [551,34–930,85]
  dauer.kampagne.n 2 · dauer.kampagne.summe 1177,86 [1102,67–1861,7] · dauer.session 1177,85 [1102,67–1861,7] · spieler.abgaenge 0 · spieler.beitritte 0
  spieler.max 1 · spieler.nachzuegler 0 · spieler.start 1
- **F2 Gefecht:** gefecht.boden 24 [22–32] · gefecht.raum 486 [460–1040] · gegner_neu.raum 14 [9–14] · kills.raum.gesamt 14 [8–14] · kills.raum.korvette 1
  kills.raum.pylon 5 [0–5] · kills.raum.raider 4 · kills.raum.relay 3 · kills.raum.sentinel 1 [0–1] · kills_von.lerche 14 [8–14] · quote.raum.lanze 100
  quote.raum.standardbatterie 93,5 [91,82–95,09] · quote_wirkt.raum.lanze 100 · quote_wirkt.raum.standardbatterie 59,69 [56,96–85,29]
  schaden.raum.aus.roh 460,19 [204,43–489,42] · schaden.raum.aus.schild 35 [15–37] · schaden.raum.aus.wirkt 248,01 [157,71–276,93]
  schaden.raum.ein.roh 28,75 [16–150] · schaden.raum.ein.schild 24 [11–43] · schaden.raum.ein.wirkt 5 [1,5–108] · schuesse.raum.lanze 8 [4–12]
  schuesse.raum.standardbatterie 158 [68–168] · treffer_je_schuss.raum.lanze 1 · treffer_je_schuss.raum.standardbatterie 0,94 [0,92–0,95]
  treffer_n.raum.aus 157 [67–165] · treffer_n.raum.ein 27,5 [16–144] · zeit_bis_kill.raum.korvette 37,99 [23,93–65,23]
  zeit_bis_kill.raum.pylon 83,3 [78,73–91,4] · zeit_bis_kill.raum.raider 52,42 [43,72–60,27] · zeit_bis_kill.raum.relay 31,92 [25,33–33,33]
  zeit_bis_kill.raum.sentinel 52,53 [44,67–56,9]
- **F2b Deckung:** deckung.p1.cv_anteil 0 · deckung.p1.cv_s 0 · deckung.p1.geduckt_s 0 · deckung.p1.verdeckt_s 0 · gegner_abstand.min 5,35 [3,8–6,8]
  gegner_abstand.nn_mittel 7,6 [6,8–10,68] · gegner_geduckt_anteil 0
- **F3 Verluste:** bodenschild_leer.n 0 · erster_verlust_s 210,42 [172,07–253,73] · gefallen.n 0 · integritaet.min 89,32 [62,82–92,74] · neustarts 0
  notfall.n 0 [0–9] · notrueckholung.n 0 · schiff_zerstoert.n 0 [0–9] · zone_aus.kaputt 5,5 [1–135] · zone_aus.n 10 [3–153]
- **F4 Rollen:** dabei.p1 1177 [1102–1860] · leerlauf.p1.anteil 0 · leerlauf.p1.dauer 0 · leerlauf.p1.episoden 0 · reparatur.dauer_mittel 3 [3–3,44]
  reparatur.erfolg_anteil 100 · reparatur.n 1 [1–6] · reparatur.notflicken 0 · rolle.p1.boden 52 [50–58] · rolle.p1.captain 16 [4–18]
  rolle.p1.helm 630 [446–696] · rolle.p1.ohne 122 [114–1204] · rolle.p1.shop 0 [0–2] · rolle.p1.weapons 356 [152–380] · wechsel.p1 578 [482–971]
- **F5 Wirtschaft:** buchung.ersatzteil.bergung 1 · buchung.ersatzteil.bot -3 [-4–-1] · buchung.ersatzteil.regal -1 · buchung.flickblech.bergung 1
  buchung.flickblech.bot -1 [-1–0] · buchung.flickblech.regal -1 · buchung.loeschgel.regal -1 · buchung.marks.abschuss 360 [155–360]
  buchung.marks.belohnung 575 [425–575] · buchung.marks.bergung 40 · buchung.marks.erkundung 120 [100–120] · buchung.marks.kauf -20
  buchung.marks.notfall 0 [-450–0] · buchung.medipack.regal -1 · energie.automatik_n 0 [0–13] · energie.engines_anteil 33,33 [33,29–35,41]
  energie.shields_anteil 33,33 [33,33–35,41] · energie.weapons_anteil 33,33 [29,18–33,33] · konto.ersatzteil.anfang 4 · konto.ersatzteil.ende 1 [0–3]
  konto.ersatzteil.netto -3 [-4–-1] · konto.flickblech.anfang 3 · konto.flickblech.ende 2 [2–3] · konto.flickblech.netto -1 [-1–0] · konto.loeschgel.anfang 2
  konto.loeschgel.ende 1 · konto.loeschgel.netto -1 · konto.marks.anfang 150 · konto.marks.ende 1225 [400–1225] · konto.marks.netto 1075 [250–1075]
  konto.medipack.anfang 2 · konto.medipack.ende 1 · konto.medipack.netto -1
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 1691 [1633–2202] · protokoll.zeilen_je_min 86,37 [70,97–102,91] · tick.n 35311 [33061–55801]

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

- **F1 Dauer und Ausgang:** ausgang.erfolg 1 · dauer.kampagne.mittel 182,03 [157,93–238,43] · dauer.kampagne.n 1 · dauer.kampagne.summe 182,03 [157,93–238,43]
  dauer.session 182,03 [157,93–238,43] · spieler.abgaenge 0 · spieler.beitritte 2 · spieler.max 3 · spieler.nachzuegler 0 · spieler.start 3
- **F2 Gefecht:** gefecht.boden 131 [90–184] · gegner_neu.boden 11 [8–13] · kills.boden.gesamt 9,5 [5–13] · kills.boden.grundtyp 9,5 [5–13]
  kills.boden.waechter 0 [0–1] · kills_von.p2 5 [2–8] · kills_von.p3 4 [2–9] · quote.boden.blaster 40,38 [35,98–53,27] · quote.boden.pistol 100 [60–100]
  quote.boden.sturmgewehr 35,21 [29,56–47,52] · quote_gegner.boden.schrottblaster 33,33 [25,32–52,94] · quote_gegner.boden.waechter 92,31 [71,43–100]
  quote_wirkt.boden.blaster 40,38 [35,98–53,27] · quote_wirkt.boden.pistol 100 [60–100] · quote_wirkt.boden.sturmgewehr 35,21 [29,56–47,52]
  quote_wirkt_gegner.boden.schrottblaster 33,33 [25,32–52,94] · quote_wirkt_gegner.boden.waechter 92,31 [71,43–100] · schaden.boden.aus.roh 70,25 [54–87]
  schaden.boden.aus.schild 49 [34–70,5] · schaden.boden.aus.wirkt 10 [4,5–13] · schaden.boden.ein.roh 29 [21–44] · schaden.boden.ein.schild 18,5 [12–27]
  schaden.boden.ein.wirkt 1 [0–4] · schuesse.boden.blaster 146 [47–187] · schuesse.boden.pistol 3 [0–15] · schuesse.boden.sturmgewehr 0 [0–203]
  schuesse_gegner.boden.schrottblaster 54 [45–79] · schuesse_gegner.boden.waechter 6 [2–13] · treffer_je_schuss.boden.blaster 0,41 [0,36–0,53]
  treffer_je_schuss.boden.pistol 1 [0,6–1] · treffer_je_schuss.boden.sturmgewehr 0,35 [0,3–0,48]
  treffer_je_schuss_gegner.boden.schrottblaster 0,33 [0,25–0,53] · treffer_je_schuss_gegner.boden.waechter 0,93 [0,71–1] · treffer_n.boden.aus 73 [54–117]
  treffer_n.boden.ein 23,5 [18–39] · zeit_bis_kill.boden.grundtyp 15,32 [12,83–24,37] · zeit_bis_kill.boden.waechter 13,12 [9,13–14,37]
- **F2b Deckung:** deckung.p2.cv_anteil 23,17 [10,06–37,43] · deckung.p2.cv_s 31,98 [13,08–64,38] · deckung.p2.geduckt_s 0
  deckung.p2.verdeckt_s 7,69 [1,63–32,91] · deckung.p3.cv_anteil 24,43 [17,16–30,42] · deckung.p3.cv_s 33,38 [17,5–41,06] · deckung.p3.geduckt_s 0
  deckung.p3.verdeckt_s 10,15 [1,17–25,69] · gegner_abstand.min 0,5 [0,1–1,7] · gegner_abstand.nn_mittel 7,04 [5,65–11,7]
  gegner_geduckt_anteil 8,04 [1,96–11,89] · peek.episoden 16,5 [8–25] · peek.mit_schuss 10 [4–13] · schuesse_gegner.aus_deckung_anteil 0
  schuesse_spieler.aus_deckung_anteil 53,75 [25,36–62,26] · treffer_auf_spieler.in_deckung_anteil 41,74 [15–60] · treffer_auf_spieler.n 23,5 [18–39]
  treffer_von_spieler.aus_deckung_anteil 47,32 [21,62–63,64] · treffer_von_spieler.n 73 [54–117] · verlassen.bewegt_n 29 [14–34]
  verlassen.bis_treffer_median 2,05 [0,46–4] · verlassen.mit_treffer 8 [5–12] · verlassen.n 31,5 [14–41]
- **F3 Verluste:** bodenschild_leer.n 2 [0–5] · erster_verlust_s 114,73 [68,77–137,67] · gefallen.n 1 [0–3] · gefallen.p2 0 [0–1] · gefallen.p3 0,5 [0–2]
  integritaet.min 100 [95,73–100] · neustarts 0 · notfall.n 0 · notrueckholung.krankenstation 0 [0–1] · notrueckholung.n 0 [0–2] · notrueckholung.team 0 [0–1]
  schiff_zerstoert.n 0 · zone_aus.kaputt 0 [0–2] · zone_aus.n 0 [0–2]
- **F4 Rollen:** dabei.p1 181 [156–238] · dabei.p2 181 [156–238] · dabei.p3 181 [156–238] · leerlauf.p1.anteil 24,44 [19,33–29,49]
  leerlauf.p1.dauer 44 [44–46] · leerlauf.p1.episoden 1 · leerlauf.p2.anteil 0 · leerlauf.p2.dauer 0 · leerlauf.p2.episoden 0 · leerlauf.p3.anteil 0
  leerlauf.p3.dauer 0 · leerlauf.p3.episoden 0 · reparatur.dauer_mittel 3 · reparatur.erfolg_anteil 100 · reparatur.n 0 [0–1] · reparatur.notflicken 0
  rolle.p1.captain 177 [136–220] · rolle.p1.ohne 4 [4–30] · rolle.p2.boden 131 [88–186] · rolle.p2.helm 36 · rolle.p2.ohne 14 [14–44]
  rolle.p2.transfer 0 [0–2] · rolle.p3.boden 131 [88–172] · rolle.p3.ohne 51 [50–78] · wechsel.p1 0 · wechsel.p2 0 · wechsel.p3 0
- **F5 Wirtschaft:** buchung.ersatzteil.regal 0 [-2–0] · buchung.marks.belohnung 125 [120–180] · buchung.marks.erkundung 40 · buchung.medipack.medkit 0 [-1–0]
  buchung.tafel.fund 1 · buchung.tafel.mission -1 · energie.engines_anteil 33,33 · energie.shields_anteil 33,33 · energie.weapons_anteil 33,33
  konto.ersatzteil.anfang 4 · konto.ersatzteil.ende 2 [2–3] · konto.ersatzteil.netto -2 [-2–-1] · konto.marks.anfang 150 · konto.marks.ende 315 [310–370]
  konto.marks.netto 165 [160–220] · konto.medipack.anfang 2 · konto.medipack.ende 2 [1–2] · konto.medipack.netto 0 [-1–0] · konto.tafel.anfang 0
  konto.tafel.ende 0 · konto.tafel.netto 0
- **F6 Technik (deterministischer Teil):** daten.abgeschnitten 0 · daten.kaputt 0 · daten.ohne_ende 0 · daten.unbekannte_typen 0 · fehler.schreiben 0
  fehler.verworfen 0 · fehler.zeitreihe 0 · protokoll.zeilen 588,5 [436–931] · protokoll.zeilen_je_min 191,35 [154,95–247,86] · tick.n 5430 [4680–7140]
