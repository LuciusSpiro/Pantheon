# Offene Kleinaufträge B1–B3 (Studioleitung, laufend)

**Stand nach Welle 1 (2026-10-10, Branch `welle1`, Team DOKU).** Welle 2 (AP3a, AP6, AP3b) läuft in eigenen Bäumen und
ist hier noch nicht eingetragen.

Stand nach Welle 2 der B-Produktion (BODENKAMPF, CLIENT, BUEHNE fertig). Erledigt: itemOffset/Ruheposen, `shoot { los }` (ENGINE-Durchreichung
hat die Studioleitung in `game.js` gesetzt, protocol.js dokumentiert), CLIENT B1–B3, Verfall-Überzug ≤ +0,04 je Platz,
Bauzeit `verfallen` Median ≤ 12 ms (Max. 90 ms bei Außenposten-Neuversuch → Vorbau bleibt Pflicht).

## Erledigt in Welle 1
- **rom-Waffen:** `item/waffe/rom/` hat alle sechs Waffen (blaster, sturmgewehr, granatwerfer, lanze, nahkampf,
  betaeuber).
- **Hexwerte:** `#B8302A` kommt in `public/voxel/assets` und `content` nicht mehr vor. Die Rollen `alarm`, `leit` und
  `frost` stehen in `public/voxel/assets/palettes/base.json`.
- **Snapshot-Spielraum (AP1, `84e0a19`):** Standardwerte fallen weg (`server/sim/snapform.js`), Grenze
  `CONFIG.net.snapMax` mit Luft `snapLuft`. `npm run snap:mess` heute: Worst Case max 11 246 B, Wellenlauf max
  10 592 B (Ziel ≤ 11 776 B, Grenze 13 312 B).
- **`KARTE-WIEDERHOLT` über die ganze Runde (AP4, `fd952fc`):** prüft jetzt auch die anderen Angebote der Runde
  (`szenenbau.js:334`). Damit ist „`wreck` zweimal in derselben Angebotsrunde“ erledigt.
- **Kürzere Spielleiter-Fassung des Katalogs (AP4, `fd952fc`):** Grobplan-Katalog heute 9 904 Zeichen ≈ 2 830 Tokens
  (`node tools/katalog.js --tokens`).
- **Kontext-Goldens `--update`:** bewusst neu geschrieben in AP2 (`b364306`) und AP4 (`fd952fc`).
- **Golden-Commit:** `base-s2b/`, `allow-b2.json` und die neue `base` sind seit `acc1939` eingecheckt. Basis ist seit
  AP2 `base-w1` (mit `allow-w1.json`).
- **Prefetch (AP7, `12bedec`):** `kit.js` lädt im Leerlauf Bau-Daten, Paletten, Stimmungen, Figuren und Waffen-Gerüste,
  der Bau hat Vorrang. `npm run mess:kaltbau`, Schiff kalt (QA-Methode: frischer Server und Browser, Bau 1,8 s nach Seitenaufruf, 3 Seeds)
  heute Median 353 ms im Direktstart und 276 ms über die Transferkammer.
- **PIPELINE `streu`:** `check:assets` prüft Besitz-`streu` (String und `{ id, wandnah }`), `kontor.json` nutzt die
  Objektform für `regal`.
- **Station:** zweite Variante `station.schachtabzweig.b.json`.

## Neu offen nach Welle 1
- **Voxelwerk:** Gold-Rolle in `rom_kastell` (Saum Fahnenheiligtum), Props mit alten Zeichenfolgen neu rendern,
  Tierzeichen-Varianten. Gehört nach Voxelwerk, sonst überschreibt der Sync (`npm run assets`) die Änderung.
- **Sofortstart der Ladezeit (gebündelte Rezepte):** Direktstart Schiff ohne Wartezeit
  (`npm run mess:kaltbau -- --arten schiff --modi direkt --warte 0`) braucht Median 3 653 ms bei 153–202 HTTP-Anfragen
  (Nachmessung DOKU, AP7 maß 2 161 ms). Der Prefetch hat beim Sofortstart keine Zeit. Abhilfe wären gebündelte Rezepte.
- **Schleichen mit Alarm solo im Browser:** Nach dem Alarm kommt der Solo-Spieler 15-mal per Notrückholung zurück und
  erreicht das Ziel nicht (`shots/sl/alarm-protokoll.txt`, ABNAHME-B2 A2).
- **Dauerschätzungen im Katalog** (`dauer_je_crew`) liegen deutlich über der Bot-Zeit: Schätzung/Bot im Median ≈ 4 über
  38 Paare aus `tools/fixtures/dauer-s2.json` (Spanne 0,6 bis 30). Neu gemessen: `ausbruch/zelle_und_kammer` 4,4- bis
  8,8-mal, `unbemerkt_hineinkommen/leise_bis_ziel` 2,6- bis 5-mal. Bots sind schneller als Menschen; Abgleich nach dem
  Spieleabend.

## Neu offen nach Welle 2
- **Server-Nebel in der Kampagne:** wirkt vorerst nur in Wellen All (`sensors.nebelServer: 'wellen'`). Mit `'immer'`
  blieben alle 40 m2-Golden-Läufe am Kustoden-Relais hängen. Vorher m2-Relais und Bots prüfen.
- **Gegner-Bewegung im Nebel** kennt keine Sensorgrenze: Gegner finden die Lerche immer, nur Feuern und Aufschalten sind
  begrenzt. Gleiche Regel für die Suche fehlt (`escort.js`: Nebelregel auch für Angriffe auf Schützlinge).
- **Bots:**
  - Steuer-Bot rammt Brocken (Asteroiden zu dritt nur Welle 1–2).
  - Kette `kesh` solo 0/3: Der Bot erreicht die Hofwache nicht, vermutlich hinter einer Tür.
  - Die Wrack-Kette läuft auf `vaelen.handelsschiff`, weil der Bot auf `wrack.langschiff` den Deckwechsel nicht schafft.
- **Personen:** Ein Screenshot aus einer echten Partie fehlt (nur Dev-Mock).
- **Messung:** `snap-mess.js` hat noch keinen Aufbau „Wellen All“ (Team ALL maß max 11 465 B mit bewegten Brocken).
  Außerdem soll `golden-trace.js` mehrere `--allow` annehmen (`allow-w2.json` enthält deshalb `allow-w1.json`).
- **Labor:** vor dem Weitergeben des Spiels `CONFIG.lobby.labor` aus oder hinter Debug.

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
- ART-GK-PROPS: Props mit alten Zeichenfolgen neu rendern; Tierzeichen-Varianten (→ Voxelwerk, siehe „Neu offen“).
- Lerche-Altlast: `lerche/kit/preview_*` mischt Stufen (`door` detail) – nicht Teil B.

## Werkzeuge
- SYS-EDITOR: `&palette=` beim Editorstart wirkt nicht (`select(..., keep=true)`).
- KERN: Landeplatz-Variante mit `.` für Zwei Höfe.

## Bodenkampf / Balancing
- ~~Enterer an Engstellen~~ und ~~mehrere gleichzeitige Personen je Karte~~: erledigt in W2 AP6 (`aw.npcs[]`, max 3;
  Enterer sammeln/stürmen/flankieren auf gebauten Karten). Enterer kommen in den Bot-Läufen (Wellen) kaum vor, das
  Sammeln ist nur im Browser auf Station Seed 5 beobachtet.
- Entscheidung offen (Studioleitung): Kachelart „flacher Schutt“ (Optik ohne Deckung) – vorerst nein, Optik über
  Kit-Parameter `zustand`.

## Welle 3
- BOTS: m3/1 Seed 12 Softlock im Hof (solo; Seed 18 läuft wieder); Bot-Waffenwahl.
- QA-INTEGRATION: Snapshot-Messung nach Kartenrevision, Zeitmessungen in ruhiger Phase.

## Nachträge (Sichtung Paletten)
- ART-RUINE: Fugen-Kontrast im Modell `kit/rom/gemein/boden_fuge` (fest paving ×0,88) prüfen – nur falls der Ruinenboden
  nach der Palettenrunde noch zu unruhig wirkt.
- Holz in `nord` heller (#A07A50) wirkt auch auf Palisaden/Bohlen im Außenposten – bei nächster Galerie-Sichtung prüfen.
- Kalter Kartenbau: Direktstart ohne Wartezeit bleibt langsam (siehe „Neu offen“, Sofortstart).
- ART-LEIT (läuft): Leitstücke für die Draufsicht lesbar; KITS-LEIT (läuft): `leit`-Anker Außenposten/Station.
- Engine-Skip-Lauf test-spielleiter: Warnungen „besetzen: Karte kesh.kastell unbekannt“ / „mission-anker: keine gebaute
  Karte“ (skip betritt die Karte nie) – ENGINE/BUEHNE, Tests grün, kein Blocker.
- ART-LEIT: Halsplatte Drachenkopf (14×12 `leit`) entfernen, falls die Nachricht nicht angekommen ist.

## Prüfliste B2-Spieleabend (Menschen, nicht Bots)
- **Lanze unter Beschuss (E13):** Bots schaffen m3 mit Lanze solo 3/20, zu dritt 10/20 – jeder Treffer bricht das Laden
  ab, ohne `aussicht` endet die Sicht bei 10 Kacheln. Bots nutzen weder Aussicht noch Peek aus Deckung → kein Beleg für
  einen Designfehler. Am Spieleabend gezielt prüfen; Option falls nötig: Schildtreffer kostet Ladung, nur Wunde bricht ab
  (Änderung von E13 → Kai entscheidet).
- Solo-Hof m3: 1–4 Notrückholungen je Bot-Lauf – für einen Spieler hart (Balancing).
- Rollen-Lesbarkeit der sechs Germanen-Rollen (CONTRACT-B2 §11 Nr. 3, Vorbereitung in `ABNAHME-B2.md` §3).
- Browserbeleg „gleiche Regeln“ im Spiel (Hitze, Laden mit Abbruch, Nahkampf gegen Frontschild, Sturmgewehr), siehe
  `ABNAHME-B2.md` A1.
- KATALOG bestätigen: Kontext-Golden-Replay `69741722…` verliert die Voraussetzung `fund_aus_gewoelbe` →
  `zwei_schluessel` (vermutlich gewollte Katalog-Änderung).

## Nach B1-Fix-Welle
- Grobplan-Trefferquote live nachmessen: offline jetzt 7/14 (nur durch Code-Reparatur); Prompt-Vorgaben unbelegt. Eine
  belastbare Messung braucht ~10 Versuche ≈ 200k Tokens – über dem B1-Live-Budget (Rest ≈ 40k) → Kai entscheidet.
- Balancing solo: bt8 „Geiseln im Kontor“ – bis zu 6 Wachen gegen 1 Spieler (Bots solo 2/3 Zeitlimit). Prüfen, ob die
  Besetzungsstärke mit der Crewgröße skaliert (KATALOG `dauer_je_crew` gibt es, Gegnerzahl?); Spieleabend solo testen.
