# B1–B3 „Bühnen & Bodenkampf“ – Entscheidungen (Go von Kai, 2026-10-08)

Pitch: https://claude.ai/artifact/YXbyM8XzQKe4q1kihCjFBP · Briefing: Vault `Coop-Spiel/Briefing Bühnen & Bodenkampf.md`
Konzepte: `gamedesign.md` (§10 gilt vor §1–§9), `techlead.md` (§11 gilt vor älteren Abschnitten), `artdirector.md` (§8.6 gilt).

**Go:** Kai hat B1–B3 freigegeben. S2b ist abgenommen. Ja zu: neue Lore „Rom hielt einst den Saumraum“ (verfallene
Kastelle), Friedlose + Kontor, Kesh-Umsetzungen in der Römerruine. Alle 36 Entscheidungen wie empfohlen. Umfang: alles
zusammen (inkl. liegende Gegner, Fesseln/Ausbruch, Schleichen). **Leitlinie Kai: Systeme vor Handarbeit; Asset-Erzeugung
stark parallelisieren.**

## Von Kai gesetzt
- Rom und Germanen bekommen eigene Bauweisen und eigene Bodentruppen-Modelle.
- Neue Gegner zuerst als Germanen (Kampagnen-Vorarbeit).
- Kartenarten auf Kampagnen-Orte ausgerichtet: Station = Germanen, Ruine = Rom.
- Briefing §3/§9 gilt weiter (Kartengrößen, Zellen 8×8, sechs Waffen, Wunden, Hitze, Waffenwahl am Transporter, ganze
  Karte Limes sichtbar, nur Saumraum spielbar, Quote jede zweite + jede lange Mission).

## Entscheidungen 1–36 (alle wie empfohlen)
**Bühnen & Spielleiter**
1. Schablonen 3/3/3/2 (Außenposten/Station/Ruine/Schiff), spiegelbar, 3 Varianten je Kernplatz, Deckungsstempel für Füllplätze.
2. Modul = Daten (ASCII + Ankerebene, semantische Kacheln), Art liefert Kits mit Autotile; keine fertigen Modul-Meshes.
3. Bodenquote verletzt → Prüfer-**Fehler** mit einer Nachbesserung; ohne Boden nur mit Begründung (`ohne_boden_grund`).
4. Lange Missionen anbieten: eine je Angebotsrunde, 25–35 min.
5. „Lang“ ab 25 min (größerer Wert aus Zieldauer und Summe der Szenendauern).
6. 2 neue Archivmissionen mit Bodenszene auf neuen Karten.
7. Ladung + Download light in B1 (E halten, Countdown, Abbruch bei Treffer), ohne Werkzeuge.
8. Schiffskarte: kampfunfähiges Feindschiff betreten + treibende Wracks als Landepunkte. Volle Enterregel = eigenes Paket.
9. Schiff mit zwei Decks; Fallback ein Deck im Vertrag erlaubt.

**Bodenkampf**
10. Gefallene Gegner bleiben liegen, Kameraden können sie aufrichten (gleiche Regel wie Spieler).
11. Bewusstlos + Fesseln für beide Seiten.
12. Ausbruch auf derselben Karte in B2 (Team gefangen → Start an `zelle`, Ausrüstung an `beute`), Rückfall Notrückholung.
13. Getroffen werden unterbricht Ausholen (Nahkampf) und Laden (Lanze), für alle.
14. Frontschild blockt Nahkampf von vorn.
15. Wächter 4 Segmente + 2 Wunden.
16. Zielen über 10 Kacheln nur vom `aussicht`-Anker oder mit geteilter Sicht (Captain-Markierung, Trupp-Funk).
17. Friendly Fire: Flächenwirkung trifft alle, direkte Schüsse treffen keine Verbündeten (beide Seiten).
18. Schleich-Grundstufe in B2: Alarm je Trupp, Lärmradius, Patrouillen, Sicht 10, ohne Sichtkegel.

**Fraktionen & Gegner**
19. Friedlose (geächteter Germanenclan) dienen der Rostmeute – Hauptweg der Germanen in den Saumraum.
20. Germanisches Kontor in Lichtkordon, neutral bis feindlich.
21. Außenposten und Schiff germanisch; das Kit `rom-aussenposten` wandert in die Ruine.
22. Ruine = verfallenes römisches Grenzkastell (neue Lore); Kesh-Umsetzungen: Zwei-Offiziers-Schloss, Legionskasse.
23. Rom-Bodentruppen später (Figurenbaukasten). In B1/B2 nur der römische Kastell-Automat (Wächter-Rolle, Scutum = Frontschild).
24. Höchstens eine neue Gegnerrolle je Gefecht, bis die Crew sie kennt (Weltstand).
25. Keine Rollensymbole über den Köpfen (höchstens Barrierefreiheits-Option).
26. Waffenwahl je Spieler gespeichert über Hash der Browser-Kennung, nie Namen.
27. Aussicht als flache Plateaus mit Kante, keine Hänge.

**Tutorial, Sektor, Ablauf**
28. m1 (Plattform) behält den alten Kampf; spätere Besuche mit Kampf v2.
29. Faltsprung von überall in m1–m3; im freien Spiel Sprungpunkt anfliegen.
30. Notfallsprung nur in spielbare Hexe; Leerraum als leere Szene, zweiter Notsprung nach Reaktor-Neustart als Ausweg.
31. Karte Limes: JSON im Repo ist Quelle, Python im Vault bleibt Entwurf.
32. Wrack-Abstecher in m2: einen Sprung mehr hinnehmen.
33. Rostnest in B3 nicht anfliegbar (Landepunkte dort erst, wenn der Spielleiter es freischaltet).
34. Systeme vor den Kits (Welle 0–1): neutrale Kit-Legende, Werkstatt, Galerie, Figurenbaukasten, Bausatz-Gerüst, Verfall, Deko-Regel, Prüfbogen.
35. 2D-Fallback zeigt die neuen Inhalte nicht.
36. Direktstart Testgelände mit Kartenart/Bauweise/Besitz/seed für Karten-QA; Prüfstein (6 Live-Missionen) im Saumraum.

**Außerdem aus dem Pitch:** Germanen-Gegner Karl (Grundtyp), Bolzer (Niederhalter), Donnerwerfer (Grenadier), Jäger
(Schütze), Berserker (Enterer), Wergeld-Fänger (Häscher). Konkordat ist kein Gegner. Kit-Legende fraktionsneutral,
Bauweise als Parameter, Besetzung aus Trupp-Rezepten der Fraktion. Akzent im UI unverändert.
