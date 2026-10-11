# CONTRACT-EK5-6 – EK5 Methalle und EK6 Siedlung Eisenwald (Team BODEN)

Arbeitsbaum `C:\Users\Luciu\projects\Pantheon-ek-boden`, Branch `ek1b-boden` (Basis `ek1`), Port 3393, `WORLD_DIR=data/worlds-boden`.
Grundlage: Briefing und Planung Eisenwald-Kampagne (Vault `Coop-Spiel`), Entscheidungen Kai 2026-10-11. Keine Pushes, kein Merge.
Stand dieses Dokuments: Teil EK5 fertig, Teil EK6 siehe Abschnitt 7 ff.

## 1. Befund (gegen den Code geprüft)

| Thema | Briefing/Planung | Befund |
|---|---|---|
| Mauer | „Trägt der Generator eine Mauer?“ | `gen-siedlung.js` hatte sie schon (Typ `militaer`: 1 Kachel Mauer, Tor `G` im Westen, vier Türme). Das Landefeld lag innerhalb der Mauer. |
| Schleichweg | „neue Kachel-/Ankerart“ | Gab es nicht. Neu: Kachelart `r` (kind `rohr`). |
| BFS / Prüfer | „Weg nur für Schleicher“ | `pruefenIntern` kennt Türen als passierbar (`durchgang`), nicht aber eine Sonderkante. Neu: zwei Läufe (mit und ohne Rohr), siehe 2. |
| Sprengstoff | „Inventar und Sprengpunkt ohne Explosion“ | `inventory.ladung` (Zahl) und der Anker `sprengpunkt` (halten, scharf, 60 s, Explosion) gab es. Die Ladung stand aber **nicht im Snapshot-Inventar** (der Client zeigte „keine Ladung dabei“ immer). Behoben (nur wenn vorhanden). Kaufen konnte man sie nicht. |
| Wellen ohne Alarm | „Anker für Spawns an den Baracken, Sichtprüfung“ | `besetzen` erzeugt Trupps an `wache`-Ankern nach Rezept, mit Skalierung nach Crewgröße und ohne Obergrenze. Neu: eigener Weg (siehe 4). Alarm kommt weiter nur aus Sicht/Lärm/Funk (`squad.alarmiere`). |
| Weltstand-Fakt | „Name fest `sperrriegel`“ | `welt_fakt { key }` setzt `weltstand.fact(key, true)`. Kein neuer Code im Weltstand nötig. |
| Ort Methalle | – | Es gibt den Ort `methalle` in `shared/locations.js` noch nicht (Team KARTE/EK7). Darum liegt der Labor-Landepunkt als Platzhalter `splitter.methalle` im Splittergürtel (nur im Labor sichtbar, siehe 5). |
| Baseline | – | `node tools/test-escort.js` ist auf Basis `ek1` rot (1 Prüfung „deckt: mindestens die Hälfte heil (4/10)“, Folge von EK1a), nicht von diesem Paket. |

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

Siehe Abschnitt 11 (Messwerte am Ende des Dokuments).
