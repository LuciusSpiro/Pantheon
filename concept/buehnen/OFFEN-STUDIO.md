# Offene Kleinaufträge B1–B3 (Studioleitung, laufend)

Stand nach Welle 2 (BODENKAMPF, CLIENT, BUEHNE fertig). Erledigt: itemOffset/Ruheposen, `shoot { los }` (ENGINE-Durchreichung
hat die Studioleitung in `game.js` gesetzt, protocol.js dokumentiert), CLIENT B1–B3, Verfall-Überzug ≤ +0,04 je Platz,
Bauzeit `verfallen` Median ≤ 12 ms (Max. 90 ms bei Außenposten-Neuversuch → Vorbau bleibt Pflicht).

## ENGINE (Nachzug)
- `server/sim/landepunkte.js` beim Serverstart laden; bei Ankunft am Ort `landepunkte.vorbauenOrt(game, ort)`.
- `katalog.fuerSpielleiter` zeigt `buehne_braucht` (SPIELLEITER).
- `gr.t` (0–1) und Granaten-`t` (s) bestätigen (FX).
- `wf` des Spielers auch an Bord im Snapshot (CLIENT).
- Debug-Befehle für QA: Sprungpunkt öffnen/schließen, Ladung mit Countdown (`cd`), ENTERN-Prise erzeugen.
- Tutorial-ODA („Willkommen auf B-7!“, „Die Sonde unten links …“) auf gebauten Karten unterdrücken.

## SPIELLEITER
- Bei der Szenenplanung `landepunkte.vorbauen(game, ids)` (außerhalb des Ticks), sobald ENGINE lädt.

## VOXEL (Nachzug)
- Leitstück an den `leit`-Anker (Bauweisen-Tabelle `leit[platztyp][art]`, sonst Platzmitte); auf allen vier Kartenarten
  per Screenshot prüfen.
- Fallback-Farben in `kit.js` auf Rollen rune/ember/alarm/frost/leit.
- Lift-Ereignis mit `zone:'away'`, `enemyDeck`, `players[].deck`.
- `wf: 'schrottblaster'` als `item/waffe/blaster`, Bauweise rostmeute.
- Schiffsbau 2,8 s nachmessen.

## Art
- ART-WAFFEN: `item/waffe/rom/{blaster,sturmgewehr}` fehlen (Konsolenwarnung bei bauweise=rom).
- ART-SCHIFF/ART-AUSSENPOSTEN: Hexwerte #B8302A, #B48CFF, stone_light-Ersatz auf Rollen `alarm`/`leit`/`frost`, sobald
  ART-PALETTEN sie in `base` liefert.
- ART-GK-PROPS: Props mit alten Zeichenfolgen neu rendern; Tierzeichen-Varianten.
- Lerche-Altlast: `lerche/kit/preview_*` mischt Stufen (`door` detail) – nicht Teil B.

## Werkzeuge
- SYS-EDITOR: `&palette=` beim Editorstart wirkt nicht (`select(..., keep=true)`).
- KERN: Landeplatz-Variante mit `.` für Zwei Höfe.

## Bodenkampf / Balancing
- BODENKAMPF: Enterer an Engstellen (nicht umgesetzt; kein Abnahme-Blocker).
- BODENKAMPF: mehrere gleichzeitige Personen je Karte (`aw.npcs[]`); heute rücken sie nacheinander nach. Kein Blocker.
- Snapshot-Spielraum: Altfelder (`asleep`, `cr`, `role`, `squad`-Namen) wären eine Protokolländerung – erst bei Bedarf.
  Messung jetzt 12 356 B von 13 KB.
- Entscheidung offen (Studioleitung): Kachelart „flacher Schutt“ (Optik ohne Deckung) – vorerst nein, Optik über
  Kit-Parameter `zustand`.

## Welle 3
- BOTS: m3/1 Seed 12 Softlock im Hof (solo; Seed 18 läuft wieder); Bot-Waffenwahl; Golden-Neuaufnahme m3 mit
  `base-s2b`/`allow-b2`.
- QA-INTEGRATION: Snapshot-Messung nach Kartenrevision, Zeitmessungen in ruhiger Phase.

## Nachträge (Sichtung Paletten)
- ART-RUINE: Fugen-Kontrast im Modell `kit/rom/gemein/boden_fuge` (fest paving ×0,88) prüfen – nur falls der Ruinenboden
  nach der Palettenrunde noch zu unruhig wirkt.
- Holz in `nord` heller (#A07A50) wirkt auch auf Palisaden/Bohlen im Außenposten – bei nächster Galerie-Sichtung prüfen.
- PIPELINE: `check:assets` soll die Objektform `{ id, wandnah }` in Besitz-`streu` (deko) akzeptieren (VOXEL-Nachzug).
- Kalter Kartenbau im Spiel 1,4–5,9 s (75–90 % Laden von JSON/Assets, HTTP-Warteschlange beim Start). Prefetch in der
  Transferkammer ist im CLIENT da (client.js:575); QA-INTEGRATION misst, ob er greift. Direktstart `?arena` bleibt kalt.
- ART-LEIT (läuft): Leitstücke für die Draufsicht lesbar; KITS-LEIT (läuft): `leit`-Anker Außenposten/Station.
- Kontext-Goldens `--update` (B1-Vorgabe „einmal bewusst“) nicht von SPIELLEITER ausgeführt (würde fremde Buch-Hashes
  überschreiben) → gemeinsam mit der Golden-Neuaufnahme in Welle 3 (QA-INTEGRATION), nachdem alle Teams fertig sind.
- Engine-Skip-Lauf test-spielleiter: Warnungen „besetzen: Karte kesh.kastell unbekannt“ / „mission-anker: keine gebaute
  Karte“ (skip betritt die Karte nie) – ENGINE/BUEHNE, Tests grün, kein Blocker.
- ART-PALETTEN: Gold-Rolle in `rom_kastell` (Saum Fahnenheiligtum; heute nur hell-beiges `trim`), nicht `warning`.
- ART-LEIT: Halsplatte Drachenkopf (14×12 `leit`) entfernen, falls die Nachricht nicht angekommen ist.

## Prüfliste B2-Spieleabend (Menschen, nicht Bots)
- **Lanze unter Beschuss (E13):** Bots schaffen m3 mit Lanze solo 3/20, zu dritt 10/20 – jeder Treffer bricht das Laden
  ab, ohne `aussicht` endet die Sicht bei 10 Kacheln. Bots nutzen weder Aussicht noch Peek aus Deckung → kein Beleg für
  einen Designfehler. Am Spieleabend gezielt prüfen; Option falls nötig: Schildtreffer kostet Ladung, nur Wunde bricht ab
  (Änderung von E13 → Kai entscheidet).
- Solo-Hof m3: 1–4 Notrückholungen je Bot-Lauf – für einen Spieler hart (Balancing).
- Rollen-Lesbarkeit der sechs Germanen-Rollen.
- KATALOG bestätigen: Kontext-Golden-Replay `69741722…` verliert die Voraussetzung `fund_aus_gewoelbe` →
  `zwei_schluessel` (vermutlich gewollte Katalog-Änderung).
- Snapshot-Spielraum ~500 B (max 12 820 / 13 312 B): Altfelder-Abbau vor der Kampagne (eigener Auftrag ENGINE/CLIENT).
- Prefetch Transferkammer bringt nur 2 % (Leerlauf-Prefetch beim Start erledigt es schon; Figuren/Waffen nicht
  abgedeckt). Kalt: Außenposten ~1,0–1,2 s, Schiff 1,55 s – akzeptabel, später Figuren/Waffen in den Prefetch.
- Commit: `tools/fixtures/golden/base-s2b/`, `allow-b2.json` und neue `base` gemeinsam einchecken.

## Nach B1-Fix-Welle
- Grobplan-Trefferquote live nachmessen: offline jetzt 7/14 (nur durch Code-Reparatur); Prompt-Vorgaben unbelegt. Eine
  belastbare Messung braucht ~10 Versuche ≈ 200k Tokens – über dem B1-Live-Budget (Rest ≈ 40k) → Kai entscheidet.
- KATALOG: kürzere Spielleiter-Fassung des Katalogs (heute ~5k Tokens je Grobplan, größter fester Block).
- `wreck` zweimal in derselben Angebotsrunde wird von KARTE-WIEDERHOLT nicht erkannt (beim Planen noch nicht gespielt).
- Balancing solo: bt8 „Geiseln im Kontor“ – bis zu 6 Wachen gegen 1 Spieler (Bots solo 2/3 Zeitlimit). Prüfen, ob die
  Besetzungsstärke mit der Crewgröße skaliert (KATALOG `dauer_je_crew` gibt es, Gegnerzahl?); Spieleabend solo testen.
