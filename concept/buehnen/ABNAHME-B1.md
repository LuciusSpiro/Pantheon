# Abnahme B1 „Bühnen“ (QA-ABNAHME-B1)

Stand: eingefrorene Kopie `C:\tmp\pantheon-qa-b1`, abgezogen am **2026-10-09 um 10:43:20** (MESZ; robocopy ohne
`node_modules data shots .git galerie-vorher`, `node_modules` als Junction; Original-HEAD `80b4c8f` + Arbeitsbaum). Im
Original habe ich nur dieses Dokument und `shots/qa-b1/` (140 Bilder) geschrieben. Keine Commits, nichts repariert.

Testserver (alle in der Kopie, `ROOM_CODE=off`, `--debug`, eigene `WORLD_DIR`/`REGIE_DIR`/`ERZEUGT_DIR` unter `data/*-qa-b1*`):
3395 (Karten, Zweitbesuch, Kesh, Prise), 3396 (Live-Spielleiter, zwei Serverläufe), 3397 (Spielleiter-Mock zum Bauen des
Treibers), 3398 (`WERKSTATT=1`: Galerie, Werkstatt, Rätselpaar zu zweit, Lift), 3399 (`ws-smoke`). Alle beendet.
Browser: Chromium über playwright-core (Asgard). Skripte: `C:\tmp\pwtest\sts\b-qa-b1-*.js` (Hilfen `b-qa-b1-lib.js`).
Logs/Rohdaten: `C:\tmp\qa-b1-logs\`. Uhrzeiten unten MESZ.

**Wie gespielt wurde:** echte Tasten E/WASD und Mausklicks im Browser; Laufwege per BFS-Hilfe (Eingabenachricht wie der
Client), die Lerche per Steuer-Konsole (`helm.*`) an Transferpunkte geflogen, Landepunkte an der Transfer-Konsole gewählt,
hinunter über das Schiffs-Pad (E halten). Debug nur, wo genannt: `god on`, `goto` (Anreise), `skip` (Raumgefechte und
nicht geprüfte Schritte), `prise`, `anker` (Zurücksetzen einer Kante für den Hack-Test, Türen für ein Foto in Punkt 6).
Gekämpft wurde nicht.

## Ergebnis

**Teilweise bestanden.** Kartenbau, Karten im Spiel, Zweitbesuch, Werkstatt, Golden und Tests halten. Der Spielleiter
erzeugt live gültige Bodenmissionen. Zwei Fehler machen die Bodenmissionen aber für Spieler kaputt und gehören vor die
Freigabe behoben:
- **F1:** Die Besetzung (Gegner) einer Bodenszene läuft ins Leere, wenn der Landepunkt beim Schrittbeginn noch nicht
  gewählt ist – also praktisch immer. Bodengefechte in Spielleiter- und Archivmissionen sind leer.
- **F2:** `{{lex.*}}`-Platzhalter werden nirgends ersetzt. Spieler lesen „{{lex.fund}} bergen“ im HUD und im Funk.

| # | Prüfpunkt | Ergebnis |
|---|---|---|
| 1 | 3 Seeds je Kartenart, gespielt; Galerie; Bestehensquoten | **teilweise:** 12/12 Karten gültig, verschieden, durchgespielt; Galerie 11/11. Lift auf dem Schiff unbenutzbar (F5), Hinweis-Texte (F10, F11) |
| 2 | Sechs Live-Missionen im Saumraum | **teilweise:** 6/6 gültig, alle mit Bodenszene, 358 371 Tokens. Aber zwei Karten wiederholt, Gefechte leer (F1), Platzhalter (F2), Grobplan-Quote 6/14 (F3) |
| 3 | Zweiter Besuch nach Speichern/Laden | **bestanden** |
| 4 | Kesh in der Ruine, Wrack auf Schiff/Station | **teilweise:** beide laufen durch, aber ohne Gegner (F1); Rätselpaar solo unlösbar (F4); Wrack-Schritt endet per Zeitlimit |
| 5 | Feindschiff betreten, treibendes Wrack als Landepunkt | **teilweise:** beides betreten. Die Prise kam aber nur per Debug `prise`, nicht aus einem Buch |
| 6 | Werkstatt: Modul anlegen, live prüfen, im Spiel sehen; Galerie | **bestanden** (Anmerkungen F8, F9) |
| 7 | Golden ohne Allow-Liste, Snapshot < 13 KB, `npm test`, README | **bestanden bis auf README** (Textvorschlag unten) |

## 1. Karten je Kartenart – teilweise

Direktstart Testgelände (`?arena=away&art=…&seed=1|2|3`, Besetzung `rostmeute klein ruhig`), Skript `b-qa-b1-karte.js`.
Je Karte: Hash der Zeilen, Leitstücke prüfen, Türen mit E, Rätseltür, technischer Eingang, das fernste Objektziel mit E,
dann über einen anderen Abholpunkt als die Ankunft hinauf.

| Karte | Hash | Kit-Bau | Leitstücke (Fuß, alle Kacheln Block, Lauftest) | Türen mit E | Objekt fern | hinauf |
|---|---|---|---|---|---|---|
| Station s1/s2/s3 | 6640b52b / e1cc0652 / 8cc38381 | 0,96–0,97 s | Schmiedeherd 3×2 + Hochsitz 2×3 bzw. Hochsitz: fest, **blockiert** | 3–4 Schotts „E halten: Schott öffnen“ → offen, durchgegangen | Terminal → geladen | ja |
| Außenposten s1/s2/s3 | 296eb680 / cc6104d1 / ec1010e7 | 1,6–1,9 s | Herz: fest, blockiert | Tor + Luke → offen | Zelle offen / Terminal geladen | ja |
| Ruine s1/s2/s3 | a7030e38 / 720c9b0b / 32d0c753 | 1,65–1,74 s | Fahnenheiligtum 2×2: fest, blockiert | Luke (0,6 s) → offen | Kiste leer / Terminal geladen | ja |
| Schiff s1/s2/s3 | e644d06c / c26334bd / 9210509b | 2,07–2,15 s | Ruderbank 2×2 + Drachenkopf 2×2: fest, blockiert | Luken → offen | Ziel → aktiviert | ja |

- Alle 12 Hashes verschieden, 0 Kit-Fehler, 0 Konsolenfehler, 0 Serverfehler. Bilder `shots/qa-b1/<art>-s<n>-01…08`.
  Die Kit-Bauzeiten stammen aus Software-Chromium unter Parallel-Last und sind kein Ladezeit-Beleg.
- **Leitstücke:** auf jeder Kartenart sichtbar (`*-02-leit-*.png`). Jede Fußkachel ist `deckung_voll`, client- und
  serverseitig fest. 1,5 s gegen das Leitstück drücken: die Figur kommt nie hinein.
- **Rätseltür (Ruine):** bleibt zu. Der Server meldet nach E „Verriegelt – das öffnet erst das Rätsel (beide Schlösser
  gleichzeitig).“ Vorher zeigt der Client aber „Verschlossen – das öffnet sich anders“ (F10).
- **Gemischte Kante Station (s1, `fracht~herz`, Schott+Tür):** Ich habe sie per Debug `anker … zu` zurückgesetzt, weil
  ich sie zum Hinkommen öffnen musste. Danach „E halten: Schott hacken (6 s)“ → offen, **0/4 Kacheln fest**, durchgegangen.
- **Schiff, Decks:** Die Leiter funktioniert („E halten“, Deck 1 → 2). Der **Lift nicht** (F5).
- **`buehne alle`:** 11 Schablonen × 50 Seeds, **100 %** (0 unter 80 %), Bauzeit-Median 3–11 ms.
  - Gefecht: Außenposten 0,14–0,16, Ruine 0,13, Station 0,12–0,16, Schiff 0,19–0,22.
  - Außen: Außenposten ≤ 0,06, Station ≤ 0,12.
  - Einzelblöcke ≤ 0,32. Sichtgasse Außenposten ≤ 22, Ruine 16.
  - Alles in den Bändern aus dem Nachtrag.
- **Galerie** (`galerie.html?art=…&schablone=…&seeds=1-12`, nur mit `WERKSTATT=1`, F8): 11/11 Schablonen 12/12
  bestanden, Voxel 12/12, 0 JS-Fehler, Bauzeit-Median 9–43 ms. Bilder `galerie-<art>-<schablone>.png`.

## 2. Sechs Live-Missionen im Saumraum – teilweise

Kampagne ohne Tutorial, Spieler allein. `SPIELLEITER_LLM=live LLM_LIVE=1`, Claude-CLI. Ich habe je Missionsgrenze das
erste Spielleiter-Angebot angenommen. Archiv-Rückfälle habe ich abgelehnt; das löst eine neue Planung aus.

Treiber `b-qa-b1-sl.js`:
- Schritte ohne Bodenszene schaltet er per Debug-Skip weiter.
- In Lauf 2 betritt er die Bodenschritte (`allowBeam` aus der Ablage): anfliegen, Landepunkt wählen, Pad, E, Bild, hinauf.
- **Mission 4 habe ich per `sl plan grauzahn …` angeregt** (Langschiff ausschlachten), für Punkt 4.

**Token-Verbrauch (laufend geprüft):**

| Lauf | Deckel | Verbrauch |
|---|---|---|
| 1 (3396) | 200 000 | **179 683** |
| 2 (3396, neu gestartet) | 220 000 | **178 688** |
| **Summe** | | **358 371** |

- In der Summe nicht enthalten: Beim Partieende von Lauf 2 lief schon die nächste Planung (p11) an. Das Spiel verwirft die
  Antwort, der CLI-Aufruf läuft aber aus (≈ 18–23k geschätzt, ungezählt). Schlechtester Fall also ≈ 381k.
- Grobpläne ≈ 18–24k je Versuch, Szenen 3 586–5 186 je Aufruf.

| M | Titel (Auftraggeber) | Ziel | Bodenkarte(n) | Prüfer | Szenen live | Boden betreten |
|---|---|---|---|---|---|---|
| 1 | Stille im Wrack (Tesk) | 28 min | `wrack.schiff-1` (neu) + `wreck` | gültig im 2. Versuch | 0 (Skip schneller als die Szenen) | nein |
| 2 | Stille im Wrack (Tesk) | 15 min | `wrack.schiff-2` (neu) + `wreck` | 2. Versuch | 0 | nein |
| 3 | Grabräuber auf Kesh (Melk) | 30 min | `kesh.grabung`, `kesh.kastell` | 1. Versuch | 0 (Budget Lauf 1 erschöpft) | nein |
| 4 | Das treibende Langschiff (Grauzahn) | 28 min | `wrack.langschiff` | 2. Versuch | 5 | ja, Hash eb88da26, 0 Gegner |
| 5 | Der Verräter im Kontor (Tesk) | 30 min | `hafen.kontor` (Station) | 2. Versuch | 3 (+2 zu spät fertig) | ja, Hash dc577df1, **0 Gegner + `besetzen`-Fehler** |
| 6 | Raubzug vom Langschiff vertreiben (Tesk) | 30 min | `wrack.langschiff` | 1. Versuch | 5 (2 davon im 2. Versuch) | ja, **gleicher Hash eb88da26 wie M4**, 4 Gegner trotz `besetzen`-Fehler (vermutlich Rest der M4-Nachhut) |

Was hält:
- **Bodenquote:** alle sechs haben eine Bodenszene, alle langen ebenfalls. Lang sind M1 und M3–M6, also 5 von 6.
  Kein `ohne_boden_grund`.
- **Prüfer:** alle sechs gültig.
- **Kartenarten nach Fraktion:**
  - Station und Schiff sind Germanen (`hafen.kontor`/kontor, `wrack.*`/raubzug).
  - Ruine ist Rom (`kesh.kastell`), Außenposten Germanen/rostmeute.
- **Einführungsregel:** keine Mission setzt `neue_rolle` (≤ 1 erfüllt). Ungesehene Rollen ersetzt die Laufzeit durch
  `grundtyp` (Serverlog: „haescher->grundtyp (ungesehen)“, BESETZUNG-NEU/-SOLO/-ENTERER als Warnungen).
- **Ablage:** alle sechs liegen in der Ablage der Kopie, Status `offen`
  (`C:\tmp\pantheon-qa-b1\data\erzeugt-qa-b1-live\2026-10-09_sl_*`).

Was nicht hält:
- **Karten wiederholt:** M6 nutzt dieselbe Karte wie M4 (gleicher Seed); M1 und M2 nutzen beide die Handkarte `wreck`.
  `KARTE-WIEDERHOLT` wurde nicht gemeldet (F14). Dazu derselbe Titel zweimal.
- **Gefechte leer (F1):** In M3/M5/M6 (und M1/M2 laut Serverlog) bricht `besetzen` mit „Karte … unbekannt“ ab.
- **Platzhalter (F2):** in M1–M5 sichtbar.
- **Kampagnenstart ohne Spielleiter-Angebot:** Beide Start-Grobpläne waren zweimal ungültig und fielen aufs Archiv zurück
  (77 650 Tokens ohne Spielleiter-Angebot, F3).
- **Client-Absturz in M5 (F7):** Der Client blieb in M5 mit 10 338 gezählten Fehlern stehen; ich musste neu verbinden.
- **Ehrlich:** M1–M3 habe ich nicht betreten (Treiber zu schnell); nirgends wurde gekämpft. Das sind keine
  Menschen-Spielzeiten.

## 3. Zweiter Besuch nach Speichern/Laden – bestanden

| Schritt | Ergebnis |
|---|---|
| Kampagne ohne Tutorial, Kesh anfliegen, Landepunkt `kesh.kastell` gewählt, hinunter | Ruine/rom/herrenlos/verfallen, **Hash 1b75074b** |
| Kiste `innerstes.beute.2` geleert, hinauf, im Hafen angedockt (Autosicherung), Partie beendet | Weltstand `w-w65e`: `kesh.kastell { seed 205, schablone ruine.prozessionsweg, zustaende { innerstes.beute.2: leer } }` |
| Weltstand fortgesetzt, wieder Kastell | **Hash 1b75074b**, Kiste `leer`, Hinweis „Leer geräumt“, HUD „Kiste 1/2“ |

Bilder `wieder-neu-*`, `wieder-laden-*`. Eine Tür ließ sich hier nicht als Beleg nutzen: Die einzige `zu`-Tür war die
Rätseltür.

## 4. Kesh in der Ruine, Wrack auf dem Schiff – teilweise

**Archiv „Castellum Kesh“ auf `kesh.kastell` (rom)**, Skript `b-qa-b1-kesh.js`, zweimal gespielt:
- Anreise per `goto`, Raumgefecht per Skip. Bodenszenen echt: Landepunkt gewählt, angeflogen, hinunter.
- `ck_hof`: **0 Gegner**, Serverlog „Fehler in besetzen: Karte kesh.kastell unbekannt“ (F1).
- `ck_kasse_1` (`zwei_schluessel`): Solo ist das Paar nicht lösbar. Das erste Schloss fällt auf `ruhe` zurück, bevor das
  zweite gehalten ist (F4). Der Schritt läuft nicht weiter, ich habe ihn geskippt.
- `ck_kasse_2` (`fund_aus_gewoelbe`): Legionskasse geborgen, der Schritt wechselt **von selbst**.
- Rückzug: über den Abholpunkt hinauf. Mission abgeschlossen, 320 Marken.

**Rätselpaar zu zweit** (zwei Browser-Kontexte, Testgelände Ruine s1, `b-qa-b1-paar.js`): **bestanden.**
- Beide gleichzeitig E → beide `geloest`, `innerstes.tor` und Kante `offen`.
- Durch das Tor, Fund `genommen` (`paar-ruine-s1-*.png`).
- Laufweg von Schloss zu Schloss: **17,6 s**. Mit 3 s Halten ist das mehr als das Solo-Fenster von 15 s.

**Wrack auf dem Schiff:** Die live erzeugte M4 („Das treibende Langschiff“: `ausschlachten/wrack_container` +
`rekonstruieren/wrack_logbuch` auf `wrack.langschiff`) habe ich in der Kopie angenommen und auf 3395 ohne Skip im
Bodenschritt gespielt.
- Kiste → `leer`, Terminal → `geladen`, Fund → `genommen`, drei Ziele → `aktiviert`. Alle Hinweise korrekt.
- Der Schritt verlangt **alle** 12 Kisten (zwei Decks) leer und endet sonst per Zeitlimit (240 s). So endete er auch:
  Mission „knapp“ nach 407 s.
- Bot-Gegenprobe (`sim-headless umsetzung`, 3 Seeds, zu dritt): `wrack_container` auf `vaelen.handelsschiff` erledigt.
- Die Kesh-Kette und `wrack_logbuch` auf `hafen.kontor` blieben dort hängen (Karten nicht gebaut, F15).

## 5. Feindschiff betreten, treibendes Wrack – teilweise

`b-qa-b1-prise.js`, Kampagne ohne Tutorial:

| Fall | Ergebnis |
|---|---|
| Vaelen, Debug `prise raider` | Feind treibt (`st: 'treibt'`), Landepunkt „Prise · Schiff“ in Reichweite. Gewählt, hinunter: `vaelen.prise` schiff/germanen/rostmeute/umkaempft, 2 Decks. Wieder hinauf |
| Wrack, Landepunkt `wrack.langschiff` (Treibendes Langschiff) | angeflogen, hinunter: schiff/raubzug/verfallen. Wieder hinauf |

- Ein Buch mit `entern_ziel` habe ich **nicht** gespielt. M6 hatte zwar einen Schritt `s5_kapern`, der Ablauf sprang aber
  aus `s4` direkt in den Ausgang.
- Die Transfer-Konsole zeigt bei der gewählten Prise „Gesperrt: Kein Landeziel in der Nähe (Boje B-7, Wrack oder Mond
  Kesh)“, obwohl Beamen geht (F12).
- Im Splittergürtel scheiterte der erste Versuch an meinem Pad-Fund (Skriptfehler, behoben). Er ist kein Spielfehler.

## 6. Werkstatt und Galerie – bestanden

`b-qa-b1-werkstatt*.js`, `b-qa-b1-modulspiel.js` auf 3398 (`WERKSTATT=1`, Quelle `content` der Kopie):

1. Neues Modul `station.lager.qa` gezeichnet: Wand, Boden, Tür unten, vier Pfeiler im Kreuz, Kisten, Terminal.
2. Live-Prüfung meldet die absichtlich falsche Kiste auf der Wand mit „2 Fehler, K-ANKER-WAND …“.
3. Sie fand außerdem meine echten Entwurfsfehler (K-ERREICHBAR: Kiste schneidet ein Feld ab). Korrigiert →
   „Live-Prüfung: bestanden“, gespeichert. Der Werkstatt-Sweep `station.kreuz` ergab 50/50.
4. **Im Spiel:** erst **nach einem Server-Neustart** (F9). Testgelände `station.kreuz` Seed 1, Platz `lager` mit
   Pfeiler-Kreuz, HUD „Terminal 0/4“ statt 0/3. Bild `werkstatt-6-im-spiel-seed1.png`.

Die Galerie mit Kennzahlen steht unter Punkt 1. Ohne `WERKSTATT=1` ist sie leer (F8).

## 7. Golden, Snapshot, Tests – bestanden bis auf README

| Prüfung | Ergebnis |
|---|---|
| Golden `--all --seeds 20` gegen die neue `base`, **ohne Allow-Liste** | **120/120 byte-identisch, GOLDEN GRÜN** (64 s) |
| Dasselbe mit `WAFFEN=aus` | rot (65 Befunde, m3) – erwartet, die neue `base` ist mit Waffen aufgenommen |
| `npm run check` | check-maps **576/576**, check-sektoren **199/199** |
| `npm test` | grün: features 213, combat 345, m3 380, flight 78, escort 84, bausteine 138, regiebuch 166, weltstand 164, spielleiter 156/0/0, ablage 23, buehne **410**, waffen 132, sektoren 77, entern 66 |
| `STRICT_BAUSTEINE=1 test-bausteine` | 138/138 |
| Snapshot Außenposten, 3 Spieler, 12 Gegner (`test-combat`) | max **12 536 B** < 13 312 B. Im Browser 4,9–9,6 KB |
| `npm run sim` | SIM OK, max 11 159 B (11 586 B mit Ortsliste) |
| `ws-smoke` (Port 3399) | WS-SMOKE OK |
| `check:assets` | 0 Fehler, 15 Warnungen, Manifest 99/99 |
| README „B1 Bühnen“ | **fehlt** → Vorschlag unten |

## Gefundene Fehler

**F1 (hoch, ENGINE/BUEHNE – `server/mission/bausteine/buehne.js` `besetzen`/`anker_zustand`, `server/sim/landepunkte.js`
`vorbauen` vs. `get`): Besetzung und Anker-Setup einer Bodenszene laufen ins Leere.**
- Ursache:
  - `vorbauen` füllt nur den Karten-Cache.
  - `game.aways[lp]` entsteht erst über `get()`, also erst wenn jemand den Landepunkt an der Transfer-Konsole wählt.
  - Der Schritt startet aber vorher. `combat.besetzen` zählt „Karte … unbekannt“, `trupp_raeumen` setzt `_besetzt`
    trotzdem, und es gibt keinen zweiten Versuch.
- Nachstellen:
  1. Kampagne ohne Tutorial starten, Archiv „Castellum Kesh“ annehmen.
  2. Nach Kesh springen, Raumgefecht beenden.
  3. `ck_hof` beginnt → Serverlog „Fehler in besetzen: Karte kesh.kastell unbekannt“.
  4. `kesh.kastell` wählen und hinunter → 0 Gegner.
- Ebenso: Live-M3/M5/M6, `sim-headless umsetzung` (dort auch `mission-anker: … keine gebaute Karte`).
- Lösungsrichtung: Karte beim Schrittbeginn per `get()` registrieren (nicht im Tick bauen – Cache aus dem Vorbau nutzen)
  oder Besetzung beim ersten Betreten nachholen.

**F2 (hoch, KATALOG/ENGINE/SPIELLEITER – Szenenbau): `{{lex.*}}` wird nie ersetzt.**
- Im ganzen Code gibt es keinen Auflöser; `content/buehnen/lexikon/*.json` liest niemand.
- Sichtbar in HUD, ODA und Funk, zum Beispiel:
  - „{{lex.terminal}} auslesen (E halten)“
  - „Mit {{lex.fund}} zurück an Bord“
  - Melk funkt „{{lex.raetsel_tipp}}“
  - Bild `castellum_kesh-ck_kasse_1-raetsel.png`, HUD-Logs aller Live-Missionen
- Der Prüfer meldet offene Platzhalter nicht.

**F3 (mittel, SPIELLEITER – `content/spielleiter/prompts/grobplan.system.md`): Grobplan-Trefferquote 6/14 Versuche.**
- Typische Fehler:
  - Handkarte `wreck` für Szenen, die eine gebaute Kartenart verlangen (BUEHNE-ART/-ANKER, 3×)
  - „neutrale“ Erinnerung trotz Fakten (2×), erfundener Fakt `zaunkoenig_rostmeute`
  - Tutorial-Bezug ohne Tutorial
  - Umlaut-Schlüssel `teilerfüllt` (SCHEMA)
  - 7 Szenen, Szene ohne Molekül, Dauer 22 statt 30 min
- Zwei Szenen scheiterten am Wendungs-Schema, gelangen aber im 2. Versuch.
- Folge: Die Kampagne begann mit 77 650 Tokens und ohne Spielleiter-Angebot.

**F4 (mittel, BUEHNE/KATALOG/KITS-RUINE): Rätselpaar solo unlösbar.**
- Laufweg Schloss → Schloss 17,6 s + 3 s Halten > `paarSoloFenster` 15 s. `zwei_schluessel` gibt aber
  `dauer_je_crew["1"]` = 2–4 min an.
- Folge: Solo-Softlock in „Castellum Kesh“ und „Grabräuber auf Kesh“ (kein Zeitlimit im Schritt).
- Nachstellen: Testgelände Ruine Seed 1, solo, beide Schlösser nacheinander halten.

**F5 (mittel, BUEHNE/BODENKAMPF – Kollision am Objekt-Anker `lift`): Lift auf gebauten Schiffen nicht benutzbar.**
- Schiff Seed 1, `antrieb.lift` (2,2): Die Figur bleibt serverseitig bei x = 1,68 Kacheln vor dem Feld stehen.
- Der Client führt das Feld als frei und zeigt „E: Lift zum anderen Deck“. E bzw. `act` bewirkt nichts, weil der Server
  den Lift nur auf dem eigenen Feld anbietet.
- Die Leiter geht. `test-combat` stellt die Figur direkt auf den Lift und merkt das deshalb nicht.

**F6 (mittel, BUEHNE – `server/sim/landepunkte.js`): Landepunkte und ihr Laufzeitzustand überleben „Partie
zurückgesetzt“.**
- Nach Testgelände-Läufen im selben Serverprozess zeigt die Transfer-Konsole einer **neuen** Kampagne
  „+13 weitere“ (`kesh.station-1…5`, `kesh.ruine-*` …).
- Sie landen im Weltstand: 12 fremde Einträge in `w-w65e`.
- In einer neuen Kampagne zeigte das Kastell „Kiste 1/2“ aus der vorigen Partie.

**F7 (mittel, CLIENT): Client hängt in Live-M5 („Der Verräter im Kontor“).**
- Debug-Anzeige „Fehler Client 10338“, Stufe bleibt bei `s6_rueckzug_1`. Der Server hatte die Mission längst beendet
  (`varn_gerettet`).
- Ein frisch verbundener Client war fehlerfrei. Die Meldung lief nur über `console.warn` und ist nicht erfasst.
- Bild `live2-m2-ende.png`.

**F8 (mittel, WERKSTATT/Studioleitung – `server/index.js` bindet `/werkstatt/*` nur mit `WERKSTATT=1`): Galerie ohne
`WERKSTATT=1` leer.**
- Sie zeigt „0 %“ und „Keine Schablone für station vorhanden (KITS-Team liefert noch)“ (404 auf `/werkstatt/daten`).
- `npm run werkstatt` setzt die Variable nicht. Laut Vertrag braucht nur das Speichern `WERKSTATT=1`.

**F9 (klein, BUEHNE/WERKSTATT): zwei Lücken beim Speichern von Modulen.**
- Ein mit Prüffehler gespeichertes Modul (Werkstatt fragt, „trotzdem“) wird vom Zusammenbau verbaut. `bauen`/Sweep melden
  OK bzw. 100 %.
- Der laufende Server lädt gespeicherte Module nicht nach; im Spiel erscheinen sie erst nach einem Neustart.

**F10 (klein, CLIENT `public/js/client.js:1289`): Rätseltür-Hinweis weicht vom Nachtrag ab.** Vor dem E steht
„Verschlossen – das öffnet sich anders“ statt „Verriegelt – das öffnet erst das Rätsel …“.

**F11 (klein, CLIENT `client.js:1348`): Kein „Halten: Selbst-Transfer“ an Abholpunkten ohne `P`-Kachel (Station).**
Der Server bietet das Hochbeamen auf den Pad-Feldern trotzdem an.

**F12 (klein, CLIENT `public/js/consoles.js` `transferBlock`): Der Sperrtext der Transfer-Konsole ignoriert den gewählten
Landepunkt.**
- Bei der Prise: „Kein Landeziel in der Nähe (Boje B-7, Wrack oder Mond Kesh)“.
- Beim Langschiff: „Zu weit vom Ziel (520/320)“ mit der Reichweite der Handkarte.
- Beamen ging in beiden Fällen bzw. sperrte der Server mit anderen Werten.

**F13 (klein, ENGINE/CLIENT): Ziele erscheinen beim Schrittstart als erledigt.** Ziele aus Szenenbüchern stehen schon
beim Start als `done: true` (✓), z. B. „Beide Schlösser gleichzeitig halten“, obwohl das Tor zu ist und der Schritt
weiterläuft.

**F14 (klein, SPIELLEITER – `server/mission/szenenbau.js:304`): `KARTE-WIEDERHOLT` fehlt.** M6 wurde mit M4 in der
Bodenbilanz geplant und nutzt denselben Landepunkt mit demselben Seed; die Warnung kam nicht.

**F15 (Info, BOTS – `tools/sim-headless.js` `testBooks`): Testbücher setzen Landepunkte ohne Bau ein.** Folge: Softlock
in `bot_bt3` (Kesh-Kette) und `bt2s1`.

**F16 (klein, CLIENT): Testgelände-URL setzt den Weltstand fort.** Nach „Partie beenden“ setzt ein Testgelände-Direktstart
per URL den gemerkten Weltstand fort statt das Testgelände (2 Clients, 3398). `ARENA_URL` sollte `world: null` mitsenden.

## Textvorschlag README-Abschnitt „B1 Bühnen“

```markdown
## Neu in B1 – Bühnen (modulare Außenkarten)

Bodenszenen spielen jetzt auf **gebauten Karten**: Module (8×8-Zellen, ASCII + Anker) werden nach einer Schablone
zusammengesetzt, eine **Bauweise** malt sie an (Germanen, Rom), **Besitz** und **Zustand** (intakt/verfallen/umkämpft)
überziehen sie. Vier Kartenarten: **Außenposten** 72×40 (Germanen), **Raumstation** 48×24 (Germanen), **Ruine** 64×40
(Rom, altes Grenzkastell), **Schiff** zwei Decks 37×13 (Germanen). Jede Karte hat ein **Leitstück** (Herz, Schmiedeherd,
Fahnenheiligtum, Drachenkopf …) – es steht auf festem Block, man läuft nicht hindurch.

- **Landepunkte:** Jeder Ort hat mehrere (z. B. Kesh: Kustoden-Archiv, Verfallenes Grenzkastell, Grabungslager). An der
  **Transfer-Konsole** mit **7–0** wählen, Schiff in Reichweite und langsam (< 30), dann aufs Pad und E halten. Hinunter
  geht es zur Ankunft, hinauf von **jedem** Abholpunkt (E halten).
- **Türen, Schotts, Luken, Tore:** E halten öffnet. Technische Eingänge lassen sich hacken (6 s). Rätseltore öffnen nur
  über das **Rätselpaar** (beide Schlösser gleichzeitig, zu zweit). Schiffe: Leiter (E halten) und Lift (E) zwischen den Decks.
- **Objekte:** Terminal (Download 6 s, Treffer unterbricht), Kiste, Fund, Zelle, Ziel, Sprengpunkt (Ladung nötig).
- **Weltstand:** Je Landepunkt bleiben Seed und Zustände (geöffnete Türen, leere Kisten) – beim zweiten Besuch ist es
  dieselbe Karte im selben Zustand.
- **Spielleiter:** plant Bodenszenen über Landepunkt oder `buehne: { kartenart, besitz, neu: true }` (neuer Seed, nie
  Koordinaten). Mindestens jede zweite und jede lange Mission (ab 25 min) hat eine Bodenszene (Prüfer).
- **Prisen und Wracks:** Ein kampfunfähiges Feindschiff treibt als Landepunkt `<ort>.prise`; treibende Wracks (z. B.
  „Treibendes Langschiff“ am Wrack) sind feste Landepunkte. Rostnest bleibt gesperrt.
- **Testgelände:** `?arena=away&art=ruine&seed=3&bauweise=rom&besitz=herrenlos&zustand=verfallen`
  (optional `&schablone=…&fraktion=rostmeute&staerke=klein&haltung=ruhig`).
- **Werkzeuge:** `npm run buehne -- alle` (Bestehensquoten), `npm run buehne -- bauen <schablone> <seed>`;
  **Werkstatt und Galerie nur mit `WERKSTATT=1`**:
  `WERKSTATT=1 npm run werkstatt`, dann `/werkstatt.html` (Module/Schablonen zeichnen, Live-Prüfung, Speichern) und
  `/galerie.html?art=station&seeds=1-24` (Vorschau, Kennzahlen, Fehlbauten rot). Neue Module erst nach Serverneustart im Spiel.
- **Debug** (`npm run debug`): `buehne <art> <seed> [bauweise besitz zustand]`, `lp list`, `lp neu <ort> <art>`,
  `anker <id> <zustand>`, `ladung`, `prise`.
- **Messwerte (QA-Abnahme 2026-10-09):** `buehne alle` 11 Schablonen × 50 Seeds 100 %; Snapshot Außenposten
  (3 Spieler, 12 Gegner) max 12,5 KB; Golden m1–m3 120/120 identisch.
```

## Wünsche an fremde Dateien (nicht selbst geändert)
- ENGINE/BUEHNE: F1 (vor der Freigabe)
- KATALOG/ENGINE/SPIELLEITER: F2 (vor der Freigabe); Prüfer-Regel für offene `{{…}}`
- SPIELLEITER: F3, F14
- BUEHNE/KATALOG: F4 (Solo-Fenster oder Zeitlimit-Garantie im Schritt), F6, F9
- BUEHNE/BODENKAMPF: F5
- CLIENT: F7 (Fehlerquelle mitschreiben), F10, F11, F12, F13, F16
- WERKSTATT/Studioleitung: F8, README
- BOTS: F15
- Studioleitung: die sechs Live-Missionen aus der Kopie bei Bedarf übernehmen
  (`C:\tmp\pantheon-qa-b1\data\erzeugt-qa-b1-live`, Status `offen`)

---
## Nachtrag Studioleitung (2026-10-09)
- Fix-Welle läuft: B1-FIX-LP (F1, F6, F15), B1-FIX-TEXT (F2, F13), B1-FIX-SL (F3, F14), B1-FIX-CLIENT (F7, F10, F11,
  F12, F16), B1-FIX-BUEHNE (F4 – Fenster aus Laufweg, F5, F8, F9).
- Nachprüfung danach ohne neue Live-Aufrufe (Archiv „Castellum Kesh“ + gespeicherte Live-Missionen der QA-Kopie);
  Rest-Budget Live ≈ 40k Tokens, nur falls nötig.

---
## Nachprüfung (QA-ABNAHME-B1, 2026-10-09)

Frische Kopie `C:\tmp\pantheon-qa-b1n`, abgezogen **14:38:57** (MESZ, wie oben ohne `node_modules data shots .git`). Die
alte Kopie ist gelöscht. Übernommen habe ich nur die Live-Missionen und den Live-Weltstand der alten Kopie
(`data/alt-erzeugt-live`, `data/alt-worlds-live`). Vier davon (M1, M3, M5, M6) liegen dort im Archiv (`annehmen`).

Server 3395 (Missionen) und 3398 (Werkstatt, Karten, Dauerlauf), beide beendet. **Keine Live-LLM-Aufrufe.** Skripte wie
oben (`b-qa-b1-*.js`, neu: `-dauer`, `-zielprobe`). Logs: `C:\tmp\qa-b1n-logs\`. Neue Bilder: `shots/qa-b1/nach-*`; die
Missionsbilder `castellum_kesh-*`, `kesh_grabung_stopp-*`, `kontor_verraet-*` sind neu aufgenommen.

### Fehler F1–F16

| F | Ergebnis | Beleg |
|---|---|---|
| F1 Besetzung ohne Konsolenwahl | **behoben** | Castellum Kesh `ck_hof`: 3–4 Gegner beim Ankommen, 0 Serverfehler (4 Läufe). Live-M3 `kesh.grabung` 3–4, Live-M5 `hafen.kontor` 4 Gegner zum Schrittbeginn (nach „Ablegen“). Kein `besetzen`-Fehler im Serverlog |
| F2 Platzhalter, Grammatik | **teilweise** | Alle 41 `{{lex.*}}`-Texte aus Katalog, Archiv und Live-Büchern × germanen/rom: **0 offen**; im HUD aller Läufe kein `{{`. Stichprobe 20 Sätze je Bauweise, 18 von 20 richtig. Falsch: Satzanfang ohne Artikel („Runenstein ist geborgen!“, „Legionskasse ist geborgen!“, aus alten Live-Texten `{{lex.fund}} ist …`). Außerdem im HUD ein Namensparameter falsch gebeugt: „Zu die Boje fliegen“ (Live-M3, `vermessen/stoerrelais_scan`) |
| F3 Grobplan-Quote | **nicht nachgeprüft** | Ohne Live-Aufrufe nicht messbar (Prompt geändert 13:48). Zwei Versuche aus dem Restbudget wären statistisch wertlos, deshalb nicht gemacht |
| F4 Rätselpaar | **behoben** | Solo: Hinweis „nacheinander, 31 s Zeit“, beide Schlösser `geloest`, Kasse geborgen, Schritt wechselt von selbst. Zu zweit (zwei Clients): 4 s versetzt → beide `ruhe`, Tor zu; gleichzeitig → `geloest`, Tor offen. Hinweis zu zweit „beide gleichzeitig!“ |
| F5 Lift | **behoben** | Schiff s1: Lift Deck 1 → 2. Frachter Seed 2 (Terminal (1,10) neben Lift (2,10), laut `buehne bauen`): auf dem Lift mit Blick zum Terminal heißt der Hinweis „E: Lift …“, E wechselt das Deck. Leiter geht |
| F6 Durchsickern | **behoben** | Nach Testgelände-Läufen zwei neue Kampagnen im selben Prozess: Transfer-Liste Kesh nur `kesh`, `kesh.kastell`, `kesh.grabung`. Die in Kampagne 1 geleerte Kiste ist in Kampagne 2 `voll`. Weltstände ohne fremde Landepunkte |
| F7 Client-Hänger | **behoben** | 31 min Dauerlauf, 20 Zyklen (Sprung, Sternkarte, Anflug, Landepunkt, hinunter, laufen, zurück): 0 Client-Fehler, `Net.zuhoererZahl()` konstant 3, Tick 55 810, keine pageerrors |
| F8 Galerie ohne Flag | **behoben** | Ohne `WERKSTATT=1`: Galerie Station 3/3 (100 %), `/werkstatt/daten` 200, `/werkstatt/save` **403**. `npm run werkstatt` setzt `--werkstatt` |
| F9 Modul mit Fehler / Nachladen | **behoben** | Mit Fehler gespeichertes `station.lager.qa`: `bauen` meldet „nicht verbaut … (K-ERREICHBAR)“, Exit 1. Nach Korrektur in der Werkstatt **ohne Neustart** im Spiel (Seed 1, Pfeiler-Kreuz) |
| F10 Rätseltür-Hinweis | **behoben** | Ruine s1: Client zeigt vor dem E „Verriegelt – das öffnet erst das Rätsel (beide Schlösser gleichzeitig).“ = Server-Notice |
| F11 Selbst-Transfer-Hinweis | **behoben** | Station s1 `fracht.abholpunkt`: „Halten: Selbst-Transfer“, hinauf |
| F12 Transfer-Sperrtext | **behoben (live)** | Prise `vaelen.prise` und `wrack.langschiff` gewählt: „Bereit zum Beamen …“, beide hinunter und hinauf (`nach-prise-2/3-transfer.png`) |
| F13 Ziele beim Start erledigt | **behoben** | `ck_kasse_1` beim Start: „Beide Schlösser …“ `done: false`. Test „F13 … startet offen“ |
| F14 KARTE-WIEDERHOLT | **behoben laut Test** | `test-spielleiter`: „F14: KARTE-WIEDERHOLT (Landepunkt + Seed) im Regielog sichtbar“. Live nicht geprüft (kein Live) |
| F15 Bot-Testbücher | **behoben** | `sim-headless umsetzung` zu dritt, 3 Seeds: zwei_schluessel, fund_aus_gewoelbe, trupp_raeumen, zu_den_pads, wrack_container, wrack_logbuch je **3/3 gespielt**, 0 übersprungen |
| F16 Testgelände-URL vs. Weltstand | **behoben** | Nach beendeter Kampagne startet `?arena=away…` das Testgelände (`kesh.ruine-1`, `kesh.station-1`) |

### Offene Teile aus §12

**Punkt 2 – gekämpft: bestanden mit Einschränkung.** Zwei Bodengefechte auf gebauten Karten gespielt und gewonnen:

| Gefecht | Gegner | Schüsse/Würfe | Ergebnis |
|---|---|---|---|
| Castellum Kesh `ck_hof` (`kesh.kastell`, Ruine) | 4 → 0 | 96 Granaten | Schritt wechselt von selbst (`ck_kasse_1`) |
| Live-M3 „Grabräuber auf Kesh“ `s3_grabung_gefecht` (`kesh.grabung`, Außenposten) | 3 → 0 | 48 Granaten | Schritt wechselt von selbst |

Ehrlich:
- Gewonnen habe ich nur mit `god on` und Granatwerfer.
- Gezielt habe ich per `shoot`-Nachricht mit exaktem Winkel (die Nachricht, die der Client schickt), nicht per Maus.
- Mit Maus + Blaster lag das Fadenkreuz in meinem Skript neben dem Ziel. Die Zielprobe mit Winkel zeigte 11 Treffer
  (`enemyShieldHit`), der Gegner zog sich aber zurück und lud nach.
- Ohne `god` bin ich solo gegen 4 wache Gegner (Kastell) zweimal zu Boden gegangen.
- Im Kontor (Live-M5) erreichte mein Bot die Gegner hinter den Schotts nicht.
- Kein Hinweis auf einen Spielfehler – das ist die Grenze meines Bots, keine Spielbalance-Aussage.

**Punkt 4 – Kesh in der Ruine mit Gegnern: bestanden.** Castellum Kesh in einem Durchgang ohne Skip in den Bodenszenen:
1. 4 Gegner im Hof, besiegt.
2. Rätselpaar solo gelöst, Legionskasse geborgen.
3. Hinauf, Mission „archiv“ abgeschlossen, 320 Marken. 0 Server-/Clientfehler.

**Punkt 5 – Prise aus einem Buch: offen.** Kein Archivbuch, keine Live-Mission und keine Umsetzung im Katalog nutzt den
Baustein `entern_ziel` (nur `test-bausteine`/`test-entern`). `kapern/bruecke_nehmen` ist eine Brückeneroberung auf einer
Schiffskarte, keine Prise. Ein Buch-Weg zur Prise existiert damit im Inhalt nicht – Wunsch an KATALOG (Umsetzung mit
`entern_ziel`) bzw. Studioleitung.

### Tests in der frischen Kopie

| Prüfung | Ergebnis |
|---|---|
| `npm run check` | 576/576, 199/199 |
| `npm test` | grün: features 213, combat 348, m3 380, flight 78, escort 84, bausteine 143, regiebuch 184, weltstand 164, spielleiter 161/0/0, ablage 23, buehne 465, waffen 132, sektoren 77, entern 66 |
| `buehne alle` | 11 × 50, 100 % |
| Golden gegen die **aktuelle** `base` des Originals | **GRÜN** |
| Golden gegen die `base` aus meiner Kopie (= `base-b1fix`) | **ROT, 39 Befunde, nur m3** (m1/m2 identisch) |

Zum Golden:
- m3 läuft deterministisch (Seed 12 zweimal byte-gleich), weicht aber reproduzierbar ab. Fehlende Texte z. B. „Beide
  Schlüssel gleichzeitig – einer allein reicht dem Archiv nicht.“ und andere Schrittzeiten.
- Die `base` wurde im Original um 14:40 neu aufgenommen, also 1 Minute nach meinem Abzug.
- **Bitte bestätigen**, dass die m3-Änderung (vermutlich Rätselfenster/Besetzung der Fix-Welle) gewollt ist. Der Vertrag
  sagt „B1 ändert an m1–m3 nichts“.

### Stand nach Nachprüfung
- **Behoben:** 13 von 16 Fehlern – F1, F4–F13, F15, F16; F14 laut Test.
- **Teilweise:** F2 (Grammatik in 2 von 20 Sätzen plus ein Namensparameter).
- **Nicht nachgeprüft:** F3 (braucht Live).
- **Aus §12 offen:** Punkt 5 (kein Buch mit Prise im Inhalt) und die README-Ergänzung.
- **Hinweis:** Golden m3 neu aufgenommen.

## Nachtrag Studioleitung nach Nachprüfung (2026-10-09)
- m3-Golden-Änderung **gewollt**: Ursache ist die Gegner-KI (squad.js, kein Stapeln) aus B2, nicht B1; CONTRACT-B2 erlaubt
  Kampfänderungen in m3. Schrittfolge gleich, alle 39 Befunde aus Kampfverläufen (QA-INTEGRATION, Nachtrag Gegner-KI).
- README-Abschnitte „B3 Sektorkarte“ und „B1 Bühnen“ von der Studioleitung eingefügt (Vorschlag aktualisiert: Galerie
  ohne Flag lesbar, Module ohne Neustart, Rätselpaar solo).
- Restarbeit: F2-Grammatikreste (B1-FIX-TEXT), Punkt 5 Prise aus einem Buch (KATALOG: Umsetzung mit `entern_ziel`).
- F3 (Grobplan-Quote) live nur mit Kai-Freigabe messbar (~200k Tokens).
- **Stand Studio:** B1 nach den zwei Restarbeiten abnahmereif.
- Restarbeiten erledigt (2026-10-09 abends): F2-Grammatik (Satzanfang, Namen nach Präposition; wörtliche Namen werden
  nicht gebeugt, nur Hinweis), Punkt 5 `kapern/prise_entern` (Prise aus Buch; Bots 6/6; Szenenbau: `landepunkt:
  "laufzeit"`). Vorfall: `kapern.json` von B1-FIX-SL per Skript auf 0 Byte gekürzt, von KATALOG wiederhergestellt;
  Regel in TEAM-START verschärft. Weggefallene Voraussetzung `fund_aus_gewoelbe → zwei_schluessel` ist gewollt (Tor auch
  per Sprengen/E).
- Kontrolle Studioleitung: `npm test` Exit 0, `npm run check` Exit 0, Golden frisch aufgenommen vs. `base`: GRÜN.
- **Stand Studio: B1 abnahmereif.** Offen nur F3 (Grobplan live messen, Kai-Freigabe).
- **Abgenommen von Kai (2026-10-09).** F3 bleibt als späterer Punkt in `OFFEN-STUDIO.md`.
