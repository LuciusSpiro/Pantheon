# CONTRACT-EK5-6 – EK5 Methalle und EK6 Siedlung Eisenwald (Team BODEN)

Grundlage: Briefing und Planung Eisenwald-Kampagne (Vault `Coop-Spiel`), Entscheidungen Kai 2026-10-11.

**Stand:** fertig, gemergt in `ek1`; EK5 (Abschnitte 1–6) und EK6 (7–10) gebaut, Abnahme und Messwerte in 11, berührte Dateien in 12, offene Punkte in 13. In der Kampagne echt verdrahtet (CONTRACT-EK8, Abschnitt 4a). Testskripte: `npm run test:methalle`, `npm run test:eisenwald` (in `npm test`).

## 1. Befund (gegen den Code geprüft, Stand vor EK5/EK6)

| Thema | Briefing/Planung | Befund |
|---|---|---|
| Mauer | „Trägt der Generator eine Mauer?“ | `gen-siedlung.js` hatte sie schon (Typ `militaer`: 1 Kachel Mauer, Tor `G` im Westen, vier Türme). Das Landefeld lag innerhalb der Mauer. |
| Schleichweg | „neue Kachel-/Ankerart“ | Gab es nicht. Neu: Kachelart `r` (kind `rohr`). |
| BFS / Prüfer | „Weg nur für Schleicher“ | `pruefenIntern` kennt Türen als passierbar (`durchgang`), nicht aber eine Sonderkante. Neu: zwei Läufe (mit und ohne Rohr), siehe 2. |
| Sprengstoff | „Inventar und Sprengpunkt ohne Explosion“ | `inventory.ladung` (Zahl) und der Anker `sprengpunkt` (halten, scharf, 60 s, Explosion) gab es. Die Ladung stand aber **nicht im Snapshot-Inventar** (der Client zeigte „keine Ladung dabei“ immer). Behoben (nur wenn vorhanden). Kaufen konnte man sie nicht. |
| Wellen ohne Alarm | „Anker für Spawns an den Baracken, Sichtprüfung“ | `besetzen` erzeugt Trupps an `wache`-Ankern nach Rezept, mit Skalierung nach Crewgröße und ohne Obergrenze. Neu: eigener Weg (siehe 4). Alarm kommt weiter nur aus Sicht/Lärm/Funk (`squad.alarmiere`). |
| Weltstand-Fakt | „Name fest `sperrriegel`“ | `welt_fakt { key }` setzt `weltstand.fact(key, true)`. Kein neuer Code im Weltstand nötig. |
| Ort Methalle | – | Damals gab es den Ort `methalle` noch nicht (Team KARTE/EK7); darum liegt der Labor-Landepunkt als Platzhalter `splitter.methalle` im Splittergürtel (nur im Labor sichtbar, siehe 5). **Seit EK7/EK8 gibt es den Ort** (Hex 0705) und den Kampagnen-Landepunkt `methalle.siedlung`; der Labor-Landepunkt bleibt. |
| Baseline | – | `node tools/test-escort.js` war auf Basis `ek1` rot (1 Prüfung „deckt: mindestens die Hälfte heil (4/10)“, Folge von EK1a), nicht von diesem Paket. **Erledigt** (CONTRACT-EK1, D16): heute grün. |

## 2. EK5 Generator, Mauer, Rohr (`shared/gen-siedlung.js`, `shared/buehne.js`, `content/buehnen/`)

**Variante `methalle`** (`karteRoh(seed, n, { typ: 'militaer', variante: 'methalle' })`):
- Mauer **ohne Tor**, geschlossen. Vier Türme wie bisher.
- **Landefeld mit dem einzigen Abholpunkt außerhalb der Mauer** (15×10, auf der Seite, auf der Platz ist; Seite und Lage aus dem Seed, Reihenfolge O/W/S/N gemischt). Genau ein Abholpunkt (= Ankunft). Alle Abholpunkte der Kartenart sonst: zwei.
- **Rohr** = drei Kacheln `r` in einer Reihe: Mund außen, Mauerkachel, Mund innen. Die Kachelart `r` (`content/buehnen/kacheln.json`, kind `rohr`): begehbar, **sperrt Sicht und Schuss**, `cover` 0. Für Spieler und Gegner gleich (gleiche Regeln); die Wachen starten und patrouillieren nur innerhalb. Der Ausschnitt der Karte reicht bis über das Landefeld (PAD 3).
- Eingänge: beide Rohrmünder (`eingang`, art leise), kein lauter Eingang.
- **Baracken:** mindestens zwei Quartiere (`Q`), je vier Anker der neuen Rolle **`baracke`** (Erscheinungspunkt des Nachschubs).
- **Sprengziele:** zwei `sprengpunkt` mit Attribut `modus: 'platzieren'`, in den Depots (Lager, Werkstatt, Krankenstation, Kantine) **nächst dem inneren Rohrende** (kurzer Weg: das Schleichen lohnt).
- **Patrouillenwege:** vier Ketten a–d für vier Zweiergruppen. Der **Schleichkorridor** (kürzester Weg vom inneren Rohrende zum nächsten Sprengziel) wird berechnet. Drei Wege halten Abstand (≥ 11 Kacheln, außerhalb der Sichtweite), der vierte (die Querwache, Kette d) hat zwei Punkte an den Enden desselben Platzes (lange Beine) und streift den Korridor nur zeitweise. Damit gibt es Lücken von der Länge einer Wegzeit.
- Pflichtsatz (`meta.pflicht`): `eingang 2, abholpunkt 1, sprengpunkt 1, aussicht 1, patrouille 6, baracke 4` (`meta.schleichweg: true`, `meta.variante: 'methalle'`).
- Ohne Variante ändert sich **nichts** (Test: Militärlager mit Tor, zwei Abholpunkten, keine Baracken, byte-gleich).
- Größe: `haeuser: 10` (aus `content/welt/landepunkte.json`, Schlüssel `gen`), awayMap höchstens 9,1 KB (Grenze `AWAY_MAP_MAX_BYTES` 10 240 B).

**Prüfer** (`pruefenIntern`, nur Karten mit Rohrkacheln oder `meta.schleichweg`):
- `K-ROHR`: weniger als drei Rohrkacheln.
- `K-MAUER-DICHT`: Von der Ankunft aus ist ohne die Rohrkacheln ein Ziel (Pflichtrollen außer Abholpunkt/Eingang) erreichbar (Loch in der Mauer).
- Mit Rohr gilt weiter `K-ERREICHBAR` (jedes Ziel von jedem Eingang und der Ankunft).
- Neue Anker-Rolle `baracke`, Zustand `platziert` für `sprengpunkt`, Attribut `modus` (`content/buehnen/anker.json`). `tools/check-maps.js`: 20 Rollen, `frei: labor` erlaubt.

## 3. EK5 Sprengstoff platzieren (`server/sim/anker.js`, `server/sim/shop.js`)

- `anker.ladungPlatzieren(game, map, id, pid?)`: neue, intention-benannte Funktion (kein Flag an `ladungScharf`). Setzt `sprengpunkt` auf **`platziert`**: **keine Explosion, kein Countdown, kein Alarm, keine Wirkung vor Ort**. Ereignis `ladungPlatziert { anker, map }` (auch Missionsereignis).
- `completeHold` wählt nach dem Anker-Attribut `modus`: `platzieren` → `ladungPlatzieren`, sonst wie bisher `ladungScharf`. Haltezeit 4 s (`CONFIG.anker.halten.platzieren`, Rückfall `sprengpunkt`). Ein Treffer bricht ab (nichts verbraucht, eigener Hinweistext).
- **Sprengstoff als Gegenstand:** Inventarfeld `ladung` (wie bisher, Zahl). Neu im **Snapshot** `inventory.ladung` (nur wenn > 0). **Kaufbar:** `CONFIG.shop` Eintrag `ladung` „Sprengstoff“ (150 Marken, nur Hafen/Stationen, `kind item`). Die Konvoi-Beute (EK3) legt per `ladung_geben` ins selbe Feld; die Umwandlung „Fracht Sprengstoff → Inventar ladung“ ist Sache von EK3/EK8.
- Client: Hinweis „E halten: Sprengstoff platzieren“, „Sprengstoff liegt“, Meldung „Sprengstoff platziert“, Prop (Fässchen am Sockel), Rohr optisch als Mauerstück (`kit.js`), 2D-Farbe.

## 4. EK5 Wellen (`server/sim/combat.js`, `server/sim/squad.js`, `server/mission/bausteine/bodenkampf.js`)

- `combat.besetzenPatrouillen(game, { map, fraktion, tag, gruppen, groesse=2, max=8 })`: Zweiergruppen Grundtyp (Einführungsregel: nie eine ungesehene Rolle), Schleich-Besetzung (ruhig, Alarm nur durch Entdeckung/Lärm/Funk), je Gruppe ein eigener Weg aus `karte.patrouillen`, Start am Anfang des Wegs.
- `combat.nachschubBaracken(...)`: dieselben Gruppen, Start an den `baracke`-Ankern (Gebäudeinneres), **auch wenn die Karte schon im Alarm ist: ruhig** („Sie wissen nichts von uns“), dann auf Patrouille.
- **Obergrenze:** `aktiveGegner(aw)` (stehend oder verwundet liegend) + neue Gruppen ≤ `max` (8). Es entstehen nur ganze Gruppen. `squad.spawnAnKarte` bekam `plaetze` (feste Erscheinungspunkte) und `festeZahl` (keine Skalierung nach Crewgröße).
- Bausteine `besetzen_paare` und `nachschub_baracken` (`content/regiebuch/bausteine.json`).
- **Entscheidung:** Welle 1 = **3** Zweiergruppen (6 Gegner), Welle 2 = bis zu 2 Gruppen, **gedeckelt auf 8 gleichzeitig**. Begründung: Mit „4 + 4“ und Obergrenze 8 käme in einem Lauf ohne Schuss nie eine zweite Welle, obwohl der Funkspruch „Neue Patrouillen auf dem Gelände“ sie ankündigt. So kommt sie immer (mindestens eine Gruppe, ohne Ausfälle 6 → 8), nach Verlusten füllt sie auf. Insgesamt nie mehr als 4 Zweiergruppen gleichzeitig.

## 5. EK5 Szene und Labor (`content/katalog/molekuele/sabotieren.json`, `content/welt/landepunkte.json`)

- Umsetzung **`sabotieren/sprengstoff_platzieren`** (Labor-Eintrag, `npm run katalog`: 39/39 verfügbar). `buehne_braucht`: Aussenposten mit `sprengpunkt`, `abholpunkt`, mindestens 6 `patrouille` und 4 `baracke` (nur Methalle-Karten passen).
  - `enter`: liegt kein Sprengstoff im Inventar, legt die Szene einen hinein (Labor und Rückfall; **in der Kampagne bringt ihn die Crew mit**), Welle 1.
  - Regel „Sprengstoff liegt“: ODA „Neue Patrouillen … Zurück zum Teleportpunkt“, Welle 2 (Nachschub).
  - Regel „Alarm“ (nur bei Entdeckung): ODA „Alarm! Wachen sammeln sich …“, Flag `_entdeckt`.
  - Regel „Ziel“: sobald das Außenteam **hochgebeamt** ist (kein `team_down`): Flag `_zerstoert`, **Weltstand-Fakt `sperrriegel` = true**, ODA **„Meldung von Mars: Außenposten zerstört. Der Weg ist frei.“**, Szene endet. Skip (Debug) setzt dieselbe Folge.
  - Kein Zeitdruck (Hinweis nach 90 s als Softlock-Garantie).
- **Fakt-Name für Team KARTE (EK7): `sperrriegel`** (`weltstand.data.fakten.sperrriegel === true`, bleibt im Weltstand gespeichert). Die Kanten-/Schlüsselseite liegt bei KARTE.
- **Landepunkte:** Platzhalter **`splitter.methalle`** (`frei: labor`: nur im Szenario-Labor sichtbar und wählbar, nie in der Transfer-Liste der Kampagne, Seed 5101, `gen: { variante: 'methalle', typ: 'militaer', haeuser: 10 }`). Sobald es den Ort `methalle` gibt (EK7), kommt der Kampagnen-Landepunkt `methalle.siedlung` mit derselben `gen`-Vorgabe und `frei: immer` dazu (Eintrag kopieren, ID und `ort` ändern; `check-maps` verlangt den Ort-Präfix); der Platzhalter kann bleiben.
- **Bot:** `tools/sim-headless.js` (Block „EK5 (Methalle)“): bei Szenen mit `alarm`-Prüfung gehen die Bots zu Ankern und zurück zum Abholpunkt **nur über Kacheln außerhalb der Sicht der Wachen** (jetzt, in 3 s, in 6 s, Wegvorhersage der Patrouillen), warten bis zu 120 s auf eine Lücke und laufen dann statt zu ducken (Ducken halbiert das Tempo). Beim Platzieren genügt **ein** Sprengziel (nächstes, kein zweiter Bot über das Gelände).

## 6. Abnahme EK5

Siehe Abschnitt 11 (Messwerte).

## 7. EK6 Befund (gegen den Code geprüft)

| Thema | Briefing/Planung | Befund |
|---|---|---|
| Welche der sechs Rollen trägt das Sturmgewehr? | Frage an das Studio | **Der Niederhalter** (Rolle `niederhalter`, Germanen „Bolzer“, Funk „Ich halt sie fest!“): `CONFIG.awayCombat.gegner.niederhalter = { seg 3, wunden 1, waffe 'sturmgewehr', speed 60, hitRadius 14, stoss 8 }`, `content/katalog/gegner/niederhalter.json`. Das Sturmgewehr (`waffen.sturmgewehr`: 12 Schuss bis Überhitzung, Schaden 0,5 Segment, laut) tragen sonst nur Spieler, die es wählen. Der Anführer ist also ein Niederhalter. |
| Flaggenpunkt | „Platztyp dorfplatz existiert“ | Ja (`plaetze.platz`, Typ `dorfplatz`). Dort stand ein Statuensockel (`m`) und clientseitig das Leitstück `statue_platz` (kit.js). Die Anker-Rolle `ziel` (Halteziel) gab es, aber ohne Gemeinschaftsregel, und sie hängt im Kommandogebäude. Neu: eigene Rolle `flagge`. |
| Halten | „Schalter-Halten wie `space.js:383`“ | Am Boden halten Spieler einzeln (`interior.updateHold`, `h.t`/`h.dur`). Gemeinsames Halten (zwei gleichzeitig, Fortschritt bleibt) gab es nicht: nur das Rätselpaar (Zeitfenster) und den Download (ein Halter, Fortschritt bleibt). Neu in `anker.update`: gemeinsamer Zähler `ankerLauf.flagge`. |
| Notrückholung | „Nottransport“ | Ist die vorhandene Team-Rückholung (`combat.squadRecall`, 5 s nach dem letzten Fall, Transfer danach 20 s gesperrt). Neu nur das Merken im Endkampf (`aw.endkampf.verloren`). |
| Vollreset | „Zerstörtes, Alarm“ | Der Baustein `map_reset` setzt gebaute Karten schon zurück (Zustände, Alarm, neue `aw`, keine Gegner). Reicht. |
| Mission-Engine | – | **Regeln feuern je Schritt nur einmal** (`firedRules`), Schrittflags (`v`) gelten je Schritt, abgehakte Ziele bleiben abgehakt (außer `sticky: false`). Eine Szene, die nach der Niederlage von vorn beginnt, braucht darum zwei Schritte (Hissen, Kampf, zurück per `goto`) und nicht klebende Ziele. |

## 8. EK6 Bau

**Generator** (`variante: 'eisenwald'`, `typ: 'handel'`, 12 Gebäude, `content/welt/landepunkte.json` Schlüssel `gen`): **Feldzeichen** (Anker `flagge`, Zustände `unten`/`gehisst`, Halten `flagge` 6 s) in der **Mitte des Dorfplatzes**, der Statuensockel entfällt (der Client zeichnet dann auch nicht die Statue: `kit.js`). `meta.pflicht.flagge: 1`. Alles andere unverändert („so, wie der Generator sie liefert“). awayMap bis 8,9 KB.

**Hissen** (`server/sim/anker.js`): Die Interaktion gibt es nur, wenn mindestens `CONFIG.anker.flagge.min` (2) Spieler **leben** (nicht verwundet, bewusstlos, gefangen), sonst Hinweis „Das Feldzeichen hissen zwei gemeinsam – allein geht es nicht.“ (Vorschlag des Briefings). Der **Fortschritt läuft nur, solange mindestens 2 gleichzeitig halten**, er bleibt stehen, wenn einer loslässt oder getroffen wird (ein Treffer unterbricht den Halter, nicht den Fortschritt), und der Balken zeigt allen Haltern den gemeinsamen Stand. Fällt mitten im Halten einer, bricht es ab (Fortschritt bleibt). Mit drei Spielern genügen zwei beliebige.

**Endkampf** (`server/sim/endkampf.js`, Bausteine `angriff_starten`, `gegner_abziehen`, `boss_besiegt`, `crew_gefallen`):
- `angriffStarten`: einmalig **10 Gegner und ein Anführer**, auf 11 Winkelsektoren um das Feldzeichen verteilt (Abstand 12–32 Kacheln, nur Kacheln, von denen aus man das Feldzeichen zu Fuß erreicht, mindestens 8 Kacheln von jedem Spieler), alle wach (**Angriff von allen Seiten**). **Sonst kein Spawn.** Rollen: Grundtyp, dazu je eine Rolle, die die Crew schon gesehen hat (Einführungsregel); der Anführer ist die einzige „neue“ Rolle. Config `CONFIG.awayCombat.endkampf`.
- **Anführer** = Niederhalter + **Gegner-Modifikator** `anfuehrer` (`CONFIG.awayCombat.modifikatoren`, `combat.modifikatorSetzen`, Baukasten, keine Sonderfigur): **+50 % Leben** (Schildsegmente + Wunden zusammen, 3 + 1 = 4 → 6: Schild 5; Treffer bis zum Fall 4 → 6), **+50 % Schaden** (jede Wirkung der Waffe in `waffen.wirkungAus`: Sturmgewehr 0,5 → 0,75 Segment), **25 % größer** (`groesse 1.25`). **Snapshot: genau ein Bit `gs`** (nur beim Anführer, sonst fehlt das Feld; gemessen: ein Feld, +0,6 B je Gegner im Mittel). Client: `gs` skaliert die Figur auf 125 % und zeigt den Häuptling-Look (Parameter `rank`), damit er sofort als Anführer erkennbar ist (Menschentest in EK9 offen).
- **Sieg:** `boss_besiegt` (der Anführer steht nicht mehr: liegt, bewusstlos, gefesselt, entfernt) → `gegner_abziehen`: alle Gegner beamen raus (Ton, Ereignis `gegnerBeamt`, aus der Karte entfernt), ODA, Szene endet.
- **Niederlage:** Fällt die ganze Crew, kommt die **Notrückholung**; `aw.endkampf.verloren` → Regel `crew_gefallen` → `map_reset`: **die Siedlung ist komplett zurückgesetzt** (neue Karte, Zerstörtes und Alarm weg, Feldzeichen unten, keine Gegner), die Szene springt zurück zum Hissen. **Die Freischaltung bleibt** (Landepunkt-Eintrag bleibt, nichts gesperrt). **Alarm gilt je Karte** (`aw.alarm`).

## 9. EK6 Szene und Labor

Umsetzung **`stellung_nehmen/flagge_hissen`** (zwei Schritte: `<id>` Hissen, `<id>_kampf`; die Ziele `runter`, `hissen`, `boss` kleben nicht), Landepunkt-Platzhalter **`splitter.eisenwald`** (`frei: labor`, Seed 6101, wie bei der Methalle; der Kampagnen-Landepunkt `eisenwald.siedlung` kommt mit dem Ort `eisenwald` aus EK7). `dauer_je_crew` nennt nur 2 und 3: **solo ist nicht vorgesehen** (zwei hissen gemeinsam). `sim-headless` überspringt Crewgrößen, die `dauer_je_crew` nicht nennt, die Bots spielen sie also nur zu dritt (Crew 2 spielt der Labor-Bot nie).

## 10. Entscheidungen mit Begründung

| # | Entscheidung | Begründung |
|---|---|---|
| 1 | Das Rohr ist eine **echte Kachelart** (`r`), begehbar für alle, blockt Sicht und Schuss; der Prüfer macht sie zur einzigen Mauerkante | gleiche Regeln für Spieler und Gegner; keine Sonderkante in Physik und KI; die Gegner patrouillieren innen und folgen bei Alarm über das Rohr wie die Spieler |
| 2 | **Kein Tor** in der Mauer der Methalle | ein verschlossenes Tor wäre per E öffnbar (`anker.interactionsAt`) und machte das Rohr überflüssig |
| 3 | Sprengziel als **Modus am bestehenden `sprengpunkt`** (`ladungPlatzieren`) statt neuer Rolle | der Client kennt Rolle, Prop, Hold, Marker und Zählung (HUD) schon; der Umbau am Client bleibt klein (ein Zustand, ein Label) |
| 4 | Welle 1 = 3 Gruppen, Welle 2 = bis 2 Gruppen, Deckel 8 | siehe 4: die zweite Welle ist so immer sichtbar |
| 5 | **Platzhalter-Landepunkte** `splitter.methalle`/`splitter.eisenwald` mit `frei: labor` | die Orte gibt es noch nicht (`locations.js` gehört KARTE); das Labor braucht eine Karte, die Transfer-Liste der Kampagne darf sie nicht zeigen |
| 6 | Das Feldzeichen ersetzt die **Statue** in der Platzmitte | Kai: Flaggenpunkt in der Mitte; eine zweite Figur in derselben Mitte kollidierte (Sockel, Leitstück) |
| 7 | Leben des Anführers über **Schild und Wunden zusammen** | Wunden zählen nur ganz (1 → 1,5 geht nicht); so sind es genau +50 % Treffer bis zum Fall |
| 8 | Hissen: Interaktion erst ab zwei lebenden Spielern, Fortschritt nur bei zwei gleichzeitigen Haltern | Vorschlag des Briefings („Hissen nicht möglich, bis ein zweiter da ist“); der Fortschritt bleibt wie beim Download |
| 9 | Zwei Schritte (Hissen, Kampf) und `sticky: false` | Regeln feuern in der Engine nur einmal je Schritt; sonst gäbe es nach der Niederlage keinen zweiten Angriff |
| 10 | Debug `tp <x> <y>` und `buehne … <methalle|eisenwald>` | QA: die Karten ansehen und erreichen (Browser-Smoke) |

## 11. Abnahme und Messwerte

- `npm test`: alle Tests grün **außer `test-escort` (damals auf Basis `ek1` rot, 1 Prüfung, nicht aus diesem Paket; inzwischen grün, siehe CONTRACT-EK1 D16)**. Neu und in `npm test`: `tools/test-methalle.js` (57 Prüfungen), `tools/test-eisenwald.js` (58 Prüfungen). Die Kette bricht am ersten roten Test ab; alle übrigen Tests liefen einzeln grün.
- `npm run check`: 199/199 (21 Anker-Rollen).
- `npm run snap:mess` (Ziel ≤ 18 944 B): Worst Case 11 444 B, Wellenlauf 10 558 B, **Methalle 10 526 B**, **Endkampf (10 Gegner + Anführer, 3 Spieler) 11 361 B**.
- Golden `--all --seeds 5` gegen `base-w2` mit `allow-ek1.json`: GRÜN (20 von 30 Traces byte-gleich, 10 nur mit den erlaubten Abweichungen der Korvette; m3 byte-gleich). Ordner wieder gelöscht.
- Bots: `node tools/sim-headless.js labor sabotieren/sprengstoff_platzieren --crew 1|3`: 16 von 16 Läufen ohne Alarm und ohne Schuss, 0,9–1,8 min; ebenso über 6 weitere Kartenseeds (je 2 Läufe). `labor stellung_nehmen/flagge_hissen --crew 3`: 5 von 6 Läufen gewonnen, 2 davon im ersten Anlauf (1,4 min), die anderen nach mehreren Niederlagen mit Reset; ein Lauf nach 45 min Abbruch (Zeitgrenze der Bots, keine Fehler). Die Bots sind schwach gegen 11 Gegner auf einmal; für Menschen entscheidet EK9.
- Browser-Smoke (Playwright, Port 3393): Methalle und Eisenwald laden ohne Seitenfehler, Feldzeichen und Rohr sind sichtbar.

## 12. Berührte Dateien außerhalb des Kerns (Boden)

`shared/config.js` (neue Schlüssel: `shop.ladung`, `awayCombat.modifikatoren`, `awayCombat.endkampf`, `anker.halten.flagge`, `anker.flagge`), `shared/buehne.js` (Prüfer), `content/buehnen/{kacheln,anker}.json`, `content/welt/landepunkte.json`, `content/katalog/molekuele/{sabotieren,stellung_nehmen}.json`, `content/regiebuch/bausteine.json`, `tools/sim-headless.js` (abgegrenzte Blöcke „EK5“/„EK6“: Schleichweg, Aufgabe Anführer, Crew-Filter), `tools/snap-mess.js`, `tools/check-maps.js`, `public/js/{client,render,consoles}.js`, `public/js/voxel/{kit,actors}.js`, `server/game.js` (awayMap-Attribut `modus`, Snapshot `inventory.ladung`, Debug `tp` und `buehne`), Test-Fixtures `tools/fixtures/context/*` (neuer Katalogeintrag).
Nicht berührt: `server/sim/{space,pilot,escort}.js`, Schiffsteile in `art.js`, `content/welt/limes.json`, `shared/{sektoren,locations}.js`.

## 13. Offen
- **Menschentests (EK9):** Lesbarkeit des Anführers, Schwierigkeit des Endkampfs zu zweit, Schleichen an der Methalle, **Rohr-Optik** (heute ein Mauerstück, kein eigenes Kit-Teil).
- ~~Orte `methalle` und `eisenwald` (EK7): Landepunkte `methalle.siedlung`, `eisenwald.siedlung` anlegen~~ **erledigt** (CONTRACT-EK8 D31; `content/welt/landepunkte.json`, `scene.beam` an den Hexen 0704 und 0705).
- ~~EK3/EK8: Sprengstoff aus der Konvoi-Beute als Inventar `ladung` ankommen lassen~~ **erledigt** (CONTRACT-EK8, Kapitel 4: Umladen aus dem Frachtraum, Kauf im Hafen, kostenloser Ersatz als Softlock-Schutz, D27).
- ~~Solo: Das Feldzeichen ist solo nicht hissbar~~ **entschieden** (CONTRACT-EK8 D30): bei höchstens einem verbundenen Spieler hisst nach 10 s ein Legionär mit (nur Funk), 5 + 1 statt 10 + 1 Gegner. Der Legionär ist kein sichtbarer NSC; die Zahlen sind Vorschläge. Das reine Szenario-Labor bleibt bei „solo nicht vorgesehen“ (`dauer_je_crew` nur 2 und 3).
- **Bot-Abdeckung:** Methalle ohne Pfadvorgabe, kein Plan B nötig. Endkampf im Labor nur zu dritt. Siedlung für Bots hart (sie verlieren oft gegen 11 Gegner, die Wiederholung greift).
- ~~`test-escort` rot~~ **erledigt** (CONTRACT-EK1 D16).
