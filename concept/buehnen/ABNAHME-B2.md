# Abnahme B2 „Bodenkampf“ (Team DOKU, CONTRACT-W1 §6)

Stand: Arbeitsbaum `C:\Users\Luciu\projects\Pantheon-play`, Branch `welle1`, HEAD `1359209` (nach Welle 1: AP1 `84e0a19`,
AP7 `12bedec`, AP2 `b364306`, AP4 `fd952fc`), geprüft am **2026-10-10**. Geändert habe ich nur die Doku-Dateien aus
CONTRACT-W1 §6.1. Keine Commits, nichts repariert.

Umgebung: `ROOM_CODE=off`, `WORLD_DIR=data/worlds-doku`, `REGIE_DIR=data/regie-doku`, `ERZEUGT_DIR=data/erzeugt-doku`.
Testserver nur für die Ladezeit-Nachmessung (Port 3395, eigene Daten-Ordner `data/*-doku-kb`, am Ende beendet). Keine
Live-LLM-Aufrufe. Hilfsskripte im Scratchpad der Sitzung, nicht im Repo:
- `waffenwahl-e2e.js`: zwei Game-Instanzen auf demselben Weltstand-Ordner (Punkt 2)
- `alarm-hook.js`: Preload, zählt `truppAlarm` und liest die Flags am Missionsende (Punkt 5)
- `kaltbau-doku.js`: Kopie von `tools/kaltbau-mess.js`, nur mit eigenen Daten-Ordnern (das Original legt
  `data/*-art` an und löscht sie wieder)

**Wie geprüft wurde:** Tests (`npm test`, `npm run check`), Bot-Läufe (`sim-headless umsetzung`), Messwerkzeuge
(`snap:mess`, `golden-trace`). Einen eigenen Browserlauf habe ich **nicht** gemacht. Wo es Browser-Belege gibt, stammen
sie aus Welle 1 (Team SPIELLEITER, `shots/sl/`) oder vom FX-Prüfstand (`shots/fx/` im Hauptbaum `Pantheon`). Die
Ordner `shots/` sind nicht eingecheckt (`.gitignore`).

## Ergebnis

**Bestanden bis auf Nr. 3 (offen bis Spieleabend) und den Browser-Teil von Nr. 1.** Die Regeln aus §2 gelten in den
Tests für Spieler und Gegner gleich. Waffenwahl, Wunden, Fesseln, Aufrichten, Ausbruch, Notrückholung und Schleichen
sind belegt. Was B2 versprochen und erst Welle 1 geliefert hat, steht unter Punkt 4.

| # | Vertragspunkt (CONTRACT-B2 §11) | Ergebnis |
|---|---|---|
| 1 | Gleiche Waffen und Regeln für beide Seiten (Hitze, Laden mit Abbruch, Nahkampf gegen Frontschild, Sturmgewehr-Reset) | **bestanden im Test.** Browser: nur FX-Prüfstand, kein Spielbeleg |
| 2 | Waffenwahl überlebt Beenden und Laden (Hash, kein Name) | **bestanden** |
| 3 | Rollen ohne Erklärung erkennbar | **offen bis Spieleabend** (Vorbereitung siehe unten) |
| 4 | Nahkampf, Betäubung, Wunden, Friendly Fire, Fesseln, Aufrichten, Ausbruch, Notrückholung | **bestanden** (Ausbruch-Teil mit W1 `fd952fc`) |
| 5 | Schleichen ohne Alarm, lauter Schuss alarmiert messbar | **bestanden** (Bot, Test). Browser solo mit Alarm: Ziel nicht erreicht, siehe A2 |
| 6 | Golden-Ablauf dokumentiert, `npm test` grün, Snapshot < 13 KB, README | **bestanden** |

## 1. Gleiche Waffen, gleiche Regeln – bestanden im Test

`node tools/test-waffen.js`: **132/132**. Darin je Beispiel:

| Beispiel | Prüfungen (Auszug) |
|---|---|
| Hitze | „Hitze nach 3 Schuss gleich (Spieler 0.38…, Gegner 0.38…)“; „überhitzt: Ereignis ueberhitzt, Waffe gesperrt“; „nach `sperre` s: Hitze 0“; „Blaster 1 Schuss / 0,6 s: 60 Schuss ohne Überhitzung (max. Hitze 20 %)“ |
| Laden mit Abbruch | „Treffer bricht Laden ab (Spieler und Schütze)“; „abgebrochene Ladung: kein Schuss, keine Hitze“; „Bewegen bricht das Laden ab“ |
| Nahkampf gegen Frontschild | „Nahkampf von vorn: abgelenkt (E14)“; „Nahkampf von hinten: Wunde, Schild ignoriert“; „Lanze durchschlägt den Frontschild (2 Seg)“ |
| Sturmgewehr | „ein Treffer = ½ Seg, lastHitAt gesetzt“; „jeder Treffer setzt das Schildladen zurück“; „Streuung 6° kalt → bis 14° heiß“ |

`node tools/test-combat.js`: **352/352**, im Spielablauf (Karte, KI):
- „Spieler: Dauerfeuer überhitzt den Blaster“
- „Niederhalter bricht den Stoß vor dem Überhitzen ab (Hitze 50 %)“
- „Schütze lädt sichtbar und schießt (ladungLanze, lanzeSchuss)“
- Frontschild: „Nahkampf von vorn: abgelenkt“, „von hinten: Schild“

Anmerkung: Der Blaster weicht von den Startwerten in §1.1 ab (`pause` 0,25 statt 0,6, `kalt` 1,6 statt 2,0, laut
`CONFIG.awayCombat.waffen.blaster`). Dauerfeuer überhitzt ihn nach 7 statt 5 Schuss. Der Test erwartet 5–7, die Regel
„normaler Rhythmus überhitzt nicht“ hält.

**Browser:** Der FX-Prüfstand zeigt Hitze, Lanze, Nahkampf und Granate (`Pantheon/shots/fx/hitze-*`, `lanze-*`,
`nahkampf-*`, `granate-*`). Das ist eine Testbühne, kein Gefecht im Spiel. Einen Browserbeleg aus dem Spiel gibt es
nicht. Ich empfehle, ihn am Spieleabend mitzunehmen (Debug `gegner niederhalter`, `gegner schuetze`, `waffe sturmgewehr`).

## 2. Waffenwahl über Beenden und Laden – bestanden

Tests: `test-waffen` „hashKennung: 12 Hex-Zeichen, stabil“, „crew.waffen: Hash → Waffe, faust (Zelle) nicht gespeichert,
kein Name“, „restore: gültige Einträge übernommen, ungültige verworfen“. `test-weltstand` (**164/164**): „crew.waffen:
Schlüssel nur als Hash (kein Name) – sonst Schemafehler“, „crew.waffen aus waffen.toSave()“.

Durchstich mit `waffenwahl-e2e.js` (Kampagne ohne Tutorial, zwei Spieler, Befehl `loadout.waffe` an der Transfer-Konsole):

| Schritt | Ergebnis |
|---|---|
| Kai (Kennung A) wählt Lanze, Mira (Kennung B) Betäuber | `waffeSetzen` ok |
| „Partie beenden“ (angedockt) | `saved: true` |
| Weltstand-Datei | `crew.waffen = {"f713f9caffe9":"lanze","124bc8aaf4b1":"betaeuber"}`; kein Name, keine Kennung im Klartext |
| Neue Game-Instanz, gleiche Kennungen mit anderen Namen und in anderer Reihenfolge | B → Betäuber, A → Lanze (auch Snapshot `wf`) |
| Fremde Kennung mit dem Namen „Kai“ | Blaster (neuer Spieler) |

## 3. Rollen-Lesbarkeit – offen bis Spieleabend

Das prüfen Menschen. Vorbereitet ist:
- **Wellen-Modus** (Lobby „Bodenkampf: Wellen“): Die Rollen kommen nacheinander dazu, laut `CONFIG.wellen.rollenAb`
  Karl ab Welle 1, Jäger ab 2, Bolzer ab 4, Donnerwerfer ab 6, Berserker ab 8, Wergeld-Fänger ab 10. Das ist das
  gemischte Gefecht für den Abend.
- **Direktstart** mit Fraktion: `?arena=away&art=aussenposten&seed=3&fraktion=raubzug&staerke=gross&haltung=wach`. Das
  Rezept wählt die Engine aus der Fraktion. Ein Rezept direkt anzugeben, geht nicht.
- Debug `gegner <rolle> [fraktion]` setzt einzelne Rollen neben die eigene Figur.
- **Silhouettenbogen** (ART-PLAN): `../voxelwerk/shots/art-figa/silhouette_rollen_57.png` (im Voxelwerk-Repo neben `Pantheon`).
- **Nicht vorbereitet:** eine Aufnahme (Video) eines gemischten Gefechts.

## 4. Körper, Fesseln, Ausbruch – bestanden

`test-waffen`:
- Wunden: „Spieler: 3 Seg + 1 Wunde → fällt nach 4 Treffern“, „Grundtyp: gleiche Folge“, Wächter „4 Seg + 2 Wunden = 6
  Treffer“
- Betäubung: „Schild wie Blaster, ohne Schild bewusstlos statt Wunde“, „nach 30 s wach mit 1 Segment“
- Fesseln: „Fesseln nur durch die Gegenseite“, „Häscher betäubt und fesselt einen Spieler“, „Kamerad befreit, Gegenseite
  nicht“
- Aufrichten: „Kamerad richtet Gegner auf (1 Wunde, 1 Seg)“, „Gegner nach 45 s ohne Hilfe: aus“
- Friendly Fire: „Fläche trifft Spieler UND Verbündeten des Werfers“, „eigene Granate trifft auch den Werfer“,
  „Gegner-Blaster trifft keinen Verbündeten“, „Spieler-Blaster trifft keinen Mitspieler“

`test-combat`, Abschnitt „B2: Gefangen -> Ausbruch auf derselben Karte, zweites Mal Notrückholung“: „fang: Team gefangen“,
„alle in der Zelle, Waffe Faust“, „Zellentür von innen (E halten): offen, laut“, „Ausrüstung am beute-Anker zurück“,
„zweites Mal: kein Ausbruch“, „Rückfall Notrückholung“.

**Bot-Läufe** `sim-headless umsetzung --only ausbruch/zelle_und_kammer --seeds 3`, Crew 1 und 3:

| Crew | erledigt | Szene Median | Alarm (Grund) | Flag am Ende |
|---|---|---|---|---|
| 1 | 3/3 | 0,8 min | 3/3 `laerm` (Zellentür) bei 37,2 s, in 2/3 danach ein zweiter Trupp über `sicht` (49,8 s) | `_frei: true` |
| 3 | 3/3 | 0,9 min | 3/3 `laerm` bei 35,7 s, danach `sicht` (48,3 s) | `_frei: true` |

0 Server-Fehler. Gesamter Ablauf gefangen → Zelle → Ausrüstung → Abholpunkt im Browser: `shots/sl/ausbruch-1…4` und
`andock-1…6` mit Zustandsprotokoll (Welle 1, AP4).

**Erst Welle 1 geliefert** (Commit `fd952fc`, W1 AP4):
- Schrittfeld `ausbruch_erlaubt` (B2 §4, Standard `true`, im Tutorial `false`). Test „combat.ausbruchMoeglich: Standard
  true, ausbruch_erlaubt false -> false (Notrückholung)“.
- Szenentyp C8 *Ausbruch* verfügbar: Mechanik `gefangenschaft` steht auf verfügbar, Umsetzung
  `ausbruch/zelle_und_kammer` startet über die neue Aktion `team_gefangen` im `enter`. `npm run katalog`: C8 unter
  „Szenentypen verfügbar“.
- Dazu neu: Gefangennahme ohne Kampf als Funkduell-Folge beim Andocken (`verhandeln/andockkontrolle_eskaliert`).

## 5. Schleichen – bestanden

`test-combat`, Abschnitt „B2: Schleichen“: „leiser Schuss weit weg: kein Alarm“, „lauter Schuss im Radius: truppAlarm,
Trupp wach, Landepunkt im Alarm“, „Funk: nach funkVerzoegerung s alle Trupps im Umkreis wach“, „ohne Kontakt nach
ruheNach s wieder ruhig, Landepunkt bleibt im Alarm“. Lärmradien laut `test-waffen`: Sturmgewehr und Granatwerfer 18,
Blaster 10, Lanze und Betäuber 4, Nahkampf und Faust 3 Kacheln.

**Bot-Läufe** `sim-headless umsetzung --only unbemerkt_hineinkommen/leise_bis_ziel --seeds 3`:

| Crew | erledigt | Szene Median | `truppAlarm` | Flag am Ende |
|---|---|---|---|---|
| 1 | 3/3 | 1,9 min | 0 | `_unbemerkt: true`, `_entdeckt` nicht gesetzt |
| 3 | 3/3 | 1,2 min | 0 | `_unbemerkt: true`, `_entdeckt` nicht gesetzt |

Messbarer Alarm durch Lärm: siehe Punkt 4 (Zellentür, `grund=laerm`, 6/6 Läufe).

**Browser** (Welle 1, `shots/sl/`): ohne Alarm bis ins Ziel (`schleichen-1/2`, Protokoll durchgehend „ruhig“); mit Schuss
Alarm bei 135,5 s (`alarm-1/2`). Danach erreicht der Solo-Spieler das Ziel nicht (A2).

## 6. Golden, Tests, Snapshot, README – bestanden

| Prüfung | Ergebnis |
|---|---|
| Golden-Ablauf §0 | dokumentiert in `QA-INTEGRATION.md` §1 (Vergleich `base-s2b` mit `allow-b2.json`, Neuaufnahme `base`); `base-s2b/` und `allow-b2.json` sind seit `acc1939` eingecheckt. Seit Welle 1 ist `base-w1` die Basis (Kopf von `golden-trace.js`) |
| Golden heute | `golden-trace --all --jobs 4` (97 s), `--compare base-w1`: **120/120 byte-identisch, GOLDEN GRÜN**, Mediane 0 % Abweichung |
| `npm run check` | check-maps **576/576**, check-sektoren **199/199** |
| `npm test` | grün, **2 617** Prüfungen: features 213, combat 352, m3 380, flight 78, escort 84, bausteine 166, regiebuch 186, weltstand 164, spielleiter 167, ablage 23, buehne 470, waffen 132, sektoren 82, entern 66, wellen 54 |
| Snapshot (`npm run snap:mess`) | Worst Case (3 Spieler, 12 Gegner, Granaten, 5 Seeds × 20 s): max **11 246 B**, p95 10 488 B. Wellenlauf: max **10 592 B**. Grenze 13 312 B, Ziel mit Luft ≤ 11 776 B |
| README | Abschnitt „Neu in B2 – Bodenkampf“ geschrieben (W1 AP5) |

Die Messung in §0 („2 Niederhalter im Dauerfeuer“) misst `snap-mess` nicht wörtlich. Es misst den Worst Case aus
`test-combat` (Außenposten, 3 Spieler, 12 Gegner, Granaten) in jedem Tick. Der Test „Snapshot Worst Case ≤ snapMax −
snapLuft = 11776 B (max 11053 B, kesh.grabung)“ ist grün.

## Anmerkungen

**A1 (klein):** Kein Browserbeleg aus dem Spiel für Punkt 1 (siehe dort).

**A2 (mittel, Balancing): Schleichen mit Alarm solo.** Im Browserlauf von Welle 1 (`shots/sl/alarm-protokoll.txt`) kommt
der Solo-Bot nach dem Alarm 15-mal per Notrückholung an Bord zurück (135,5 s bis 723,6 s) und erreicht den Zielbereich
nie (`alarm-3-ziel.png`: Ziel offen, „Transfer kühlt nach der Notrückholung ab“). Solo führt Alarm damit in eine
Schleife statt in *durchbrechen*. Steht als offener Punkt in `OFFEN-STUDIO.md`.

**A3 (Info):** Den Wellen-Modus belegt nur `test-wellen` (**54/54**, darunter „lobby: Kartenwahl, Altweg ohne Wahl,
neuer Seed je Start“). Die Taste K und der Rekord je Karte (nur im Browser gespeichert) sind nicht geprüft.

## Wünsche an fremde Dateien (nicht selbst geändert)

- `tools/fixtures/dauer-s2.json`: Der `hinweis` sagt noch „die 4 Archiv-Missionen“. Das ist der Stand der damaligen
  Messung. Beim nächsten `sim-headless dauer` steht dort der neue Text aus `sim-headless.js`.
