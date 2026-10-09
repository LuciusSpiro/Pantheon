# CONTRACT-W2 – Welle 2 (AP3a Labor und Wellen Boden, AP6 Bodenkampf-Feinschliff, AP3b Wellen All)

Studioleitung = Hauptsitzung („main“). Grundlage: Briefing und Planung im Vault
(`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\Planung Welle 1+2 (AP1-AP7).md`). Go von Kai am 2026-10-09. Kai hat
angeordnet, ohne Pause bis einschließlich Welle 2 durchzuarbeiten. Entscheidungen trifft die Studioleitung.
Die Abschnitte AP6 und AP3b kommen dazu, sobald AP3a abgenommen ist.

## 0. Basis und Regeln
- Die Regeln aus `CONTRACT-W1.md` §0 und `concept/buehnen/TEAM-START.md` gelten:
  - keine Commits
  - kein `git checkout`/`reset`/`stash`/`switch`/`restore`
  - Dateien nur mit Edit/Write
  - fremde Dateien nie ändern
  - keine Live-LLM-Aufrufe
  - Bericht nach CONTRACT-B1 §13
- **Jedes Team hat einen eigenen Arbeitsbaum.** Der Pfad steht im Auftrag. Die Studioleitung führt zusammen.
- Die Golden-Basis ist jetzt `tools/fixtures/golden/base-w1` mit `allow-w1.json`.
- **Nicht brechen:** `npm run check`, `npm test`, Golden gegen `base-w1`, `npm run snap:mess` (≤ 11 776 B).

---

## 1. AP3a Wellen Boden abnehmen, Szenario-Labor, Bots (Team LABOR)

Arbeitsbaum: `C:\Users\Luciu\projects\Pantheon-w2a` (Branch `w2-labor`). Port 3393–3394, `WORLD_DIR=data/worlds-labor`,
`REGIE_DIR=data/regie-labor`.
Parallel baut Team SPIELLEITER AP4 in einem anderen Baum: Ausbruch-Szenenstart, Funkduell-Eskalation und neue
Katalog-Einträge. Es fasst in `sim-headless.js` nur Agenten an. **Dir gehört der Umzug von
`testBooks`/`buildTestBook`/Landepunkte vorbauen/`umsetzungMain`.**

### 1.1 Ziel
Alles lässt sich gezielt starten und testen, von Menschen und von Bots. Wellen Boden ist abgenommen. Ein
**Szenario-Labor** in der Lobby wird **aus dem Katalog gespeist**: Was neu in den Katalog kommt, erscheint ohne
Codeänderung.

### 1.2 Befund (von der Studioleitung geprüft)
- Lobby-Modi: `START_MISSIONS` (`shared/protocol.js:~233`): `m1`, `free`, `m3`, `arena_space`, `arena_away`.
  `WELLEN_KARTEN` (:~247).
  - Server: `lobbyOpt` (`server/game.js:~493–528`), `startGame` (:~740–775), `server/sim/arena.js` (`startWellen` :~248).
  - Client: Taste M für den Modus (`public/js/client.js:~419`), K für die Karte (:~436). Gezeichnet in der Canvas-HUD
    (`public/js/hud.js` `drawLobby` :~912, `drawLobbyWellen` :~244).
- **Einen Server-Einstieg „Umsetzung X starten“ gibt es nicht.** Alle Teile liegen in `tools/sim-headless.js`:
  - `testBooks` (:~2921) und `buildTestBook` (:~2961) bauen einen Grobplan (Hafen + Szene) mit `test.params` und
    rufen `Szenenbau.buildBook`.
  - Landepunkte werden vorgebaut (:~2940–2958).
  - `runGeneric` im Modus `book` (:~2884) führt `mission.registerBook(book,{origin:'sl'})` und `startMission` aus.
  - `registerBook` verlangt `kopf.art` `archiv` oder `generiert`.
  - Ohne Kampagne gibt es keinen Spielleiter.
- Katalog: `server/mission/katalog.js` (Status `verfuegbar` / `geplant` / `fehlerhaft`). Umsetzungen haben `test.params`,
  `rueckfall.params` und `buehne_braucht`. **Szenentypen haben keine Testwerte.**
- Raum-Umsetzungen mit `test.params`: `schuetzen/geleit_durch_angriff`, `schuetzen/notruf_verteidigen`,
  `pannenhilfe/andocken_und_flicken`, `kapern/prise_entern` (`landepunkt: laufzeit`, Ort `splitter`). „Raumschlacht“ und
  „Rätselpaar“ (Boden) aus dem Briefing gibt es so nicht.
- Bots: Der `WellenAgent` (`sim-headless.js:~3164`) wählt nie eine Waffe. `BOT_WAFFEN` gilt nur auf Kesh und nur für
  blaster/sturmgewehr. `WAFFEN_WAHL` hat 6 Handwaffen.
- Im Wellenmodus beamt `startWellen` sofort hinunter. Ein Mensch kann seine Waffe dort nicht wählen.

### 1.3 Dateien
`server/mission/labor.js` (neu), `server/game.js` (Lobby, Start), `server/sim/arena.js`, `server/sim/wellen.js`,
`shared/protocol.js` (Lobby-Konstanten), `shared/config.js` (nur `lobby`, `wellen`), `public/js/{client.js,hud.js}`
(Lobby), `tools/sim-headless.js` (Testbuch-Teile, `WellenAgent`, Waffenwahl, Unterbefehl `labor`), `tools/test-labor.js`
(neu, in `npm test` aufnehmen), `tools/test-wellen.js`, `tools/fixtures/labor/**` (neu), `concept/buehnen/ABNAHME-WELLEN.md`
(neu), `package.json` (nur die Skripte `test` und `test:labor`).

### 1.4 Lieferung
1. **Wellen Boden abnehmen:** `concept/buehnen/ABNAHME-WELLEN.md` im Aufbau wie `ABNAHME-B1.md`. Gespielt werden mindestens
   Außenposten, Station und Schiff, jeweils von einem Menschen (Playwright mit echten Eingaben) und vom Bot. Gefundene
   Fehler werden behoben und aufgelistet.
2. **Waffenwahl vor dem Start** für Wellen und Labor: ein Lobby-Parameter je Spieler (Taste oder Feld), der beim Beamen
   gesetzt wird. Ohne ihn sind 5 von 6 Waffen im Wellenmodus nicht spielbar.
3. **`server/mission/labor.js`:** `laborListe(katalog)` liefert alle `verfuegbar`-Umsetzungen mit `test.params`
   (Boden und Raum), mit ID, Name, Schauplatz und Kartenarten. `laborStart(game, id, params)` startet sie mit
   Seed, Stärke und optional `god`; Landepunkt bzw. Karte und Besitz/Fraktion kommen aus `test.params`, können aber
   überschrieben werden. `buildTestBook` und das Vorbauen der Landepunkte ziehen von `tools/` hierher um.
   `sim-headless` nutzt danach **denselben** Einstieg.
   Startet die Umsetzung mit einem Startzustand (z. B. „gefangen“ aus AP4), erscheint sie als eigener Eintrag und
   bekommt keinen Parameter.
4. **Lobby:** M wechselt durch Kampagne, Kampagne ohne Tutorial, m3, Wellen Boden, **Wellen All** (vorerst der heutige
   `arena_space`, AP3b baut ihn aus) und **Labor**.
   - Labor: Liste mit ↑/↓, dazu die Parameter Seed, Stärke und `god`.
   - Wellen: Karte bzw. Szene mit K wie heute.
   Alles auf einer Lobby-Seite, lesbar in der Canvas-HUD.
5. **Schalter `CONFIG.lobby.labor`** (Standard an). Aus heißt: Der Eintrag erscheint nicht, und der Server lehnt den Start
   ab. Am Schalter steht als Kommentar der Merker „vor dem Weitergeben des Spiels ausschalten oder hinter Debug legen“.
6. **Bots:**
   - `sim-headless labor <id> [--seeds N] [--crew 1|3]` und `sim-headless labor alle` geben eine Tabelle aus (Umsetzung,
     Crew, erledigt, Median-Zeit, Fehler, Softlock).
   - `BOT_WAFFE=rotation|<waffe>` gilt für alle Agenten, auch für den `WellenAgent`. Bei `rotation` hat jeder Bot eine
     andere der 6 Waffen.
   - `umsetzung` bleibt als Alias erhalten.
7. **`tools/test-labor.js`:** Eine Test-Umsetzung im Fixture-Katalog erscheint ohne Codeänderung in `laborListe`. Jede
   Umsetzung aus `laborListe` des echten Katalogs baut mit `laborStart` fehlerfrei (Start, 30 s Simulation, keine
   Server-Fehler). Ist der Schalter aus, wird der Start abgelehnt.

### 1.5 Abnahme
- `ABNAHME-WELLEN.md` mit 3 Karten × Mensch und Bot.
- Bericht mit der Tabelle von `sim-headless labor alle` (Crew 1 und 3, 3 Seeds). Jede verfügbare Umsetzung startet und
  läuft durch. Ausnahmen werden mit Grund genannt.
- Tabelle Waffen-Rotation im Wellenmodus: alle 6 Waffen mindestens einmal benutzt.
- Lobby-Screenshots unter `shots/labor/`: Labor-Liste, Wellen Boden, Wellen All.
- `npm run check`, `npm test` (mit `test-labor`), Golden gegen `base-w1` und `snap:mess` grün.

---

## 2. AP6 Bodenkampf-Feinschliff (Team BODEN)

Arbeitsbaum, Port und Startzeitpunkt stehen im Auftrag. AP6 beginnt erst, wenn AP3a im Stand ist, weil das Labor zum
Beobachten gebraucht wird. Port 3377–3378, `WORLD_DIR=data/worlds-boden`, `REGIE_DIR=data/regie-boden`.

### 2.1 Ziel
Gegner und Personen verhalten sich auf engen Karten glaubwürdiger:
- Enterer nutzen Engstellen.
- Bis zu **3 Personen** gleichzeitig je Karte (E6).

### 2.2 Befund (von der Studioleitung geprüft)
- `away.npc` ist ein einzelnes Objekt `{x, y, dir, following, rescued, present, injured, path, pathT, moving, person,
  name, met}`. Angelegt wird es in `baseAway` (`away.js:~21`), `makeAway` (:~47, Ivo) und `spawnPerson` (:~679).
  Weitere Personen warten in `aw.personen` und rücken nach (`welt.js:~89–101, 183–189`, `game.js:~1302`).
- **Etwa 70 Zugriffe in 15 Dateien:**
  - Server ~40: `away.js`, `interior.js`, `objects.js`, `welt.js`, `game.js:~1668`
  - Client 8: `client.js`, `render.js`, `voxel/actors.js`, `dev-mock.js`
  - Tools ~16: `sim-headless.js`, `test-bausteine.js`, `test-buehne.js`
  - Regiebücher und Katalog greifen nur über die Bausteine `spawn_person`, `person_rescued` und `person_state` zu.
- Der Snapshot sendet heute keinen Namen.
- Enterer: `decideB2` (`squad.js:~930`) läuft direkt zum Spieler. Engstellen sind auf **gebauten** Karten vorhanden:
  - `karte.kanten[id] = {a, b, typ, tiles, zustand}`, Tür- und Torkacheln zwischen Plätzen (`shared/buehne.js:~850`)
  - Anker `tor` und `eingang`
  `engstellen()` in `shared/buehne-kennzahlen.js` wird im Spiel nicht berechnet. **Handkarten (Kesh, Wrack, Plattform)
  haben keine Kanten.**

### 2.3 Lieferung
1. **Erst umbauen:** Zugriffsfunktionen in `away.js`, z. B. `personen(aw)`, `personAn(aw, x, y)`,
   `folgendePersonen(aw)`, `hauptPerson(aw)`. Alle Zugriffe werden darauf umgestellt, die Speicherform bleibt
   `away.npc`. **Golden gegen `base-w1` ohne Allow-Liste byte-gleich.** Dieser Zwischenstand wird im Bericht eigens
   gemeldet.
2. **Dann erweitern:** Die Speicherform wird `aw.npcs[]` mit bis zu `CONFIG.personen.maxGleichzeitig = 3`. Das Nachrücken
   aus `aw.personen` füllt freie Plätze auf. m1 (Ivo) und die Rettungsabläufe bleiben unverändert (Golden m1 gleich).
   Der Snapshot bekommt `away.npcs[]` mit `name`. **Budget:** `snap:mess` bleibt ≤ 11 776 B, die Größe je Person steht im
   Bericht.
3. **HUD und Captain:** eine Liste der Personen mit Name und Zustandssymbol (folgt, verletzt, gerettet) und ein Randpfeil
   zur nächsten nicht geretteten Person. In 3D und 2D.
4. **Enterer an Engstellen**, nur auf gebauten Karten:
   - Liegt auf dem Weg zum Ziel eine Tür- oder Tor-Kante, sammelt sich der Trupp davor, bis 2 Enterer da sind oder 4 s
     vergangen sind, und stürmt dann gemeinsam durch.
   - Gibt es einen zweiten Weg (BFS mit Kantenstrafe), nimmt jeder zweite Enterer den längeren (Flanke).
   - Für Türen gelten die vorhandenen Regeln für beide Seiten. Es gibt keine neue Regel nur für Gegner.
   - Auf Handkarten bleibt das heutige Verhalten.
5. **Tests:** `test-combat` (Sammeln, Durchbruch, Flanke auf einer Testkarte mit Tür) und `test-bausteine` (3 Personen
   gleichzeitig, Nachrücken, Rettung).
   **Labor:** Damit 3 Personen beobachtbar sind, wird ein Labor-Eintrag gebraucht. Gibt es keine passende Umsetzung,
   kommt ein Parameter `personen` an einer vorhandenen Umsetzung wie `geiseln_befreien` dazu.

### 2.4 Abnahme
- Zwischenstand 1 byte-gleich.
- Golden gegen `base-w1` grün: m1 und m2 unverändert, m3 nur in den erlaubten Kampfverläufen.
- `snap:mess` im Budget, `npm run check` und `npm test` grün.
- Labor-Lauf der Bots und Screenshots unter `shots/boden/`: Enterer sammeln sich an einer Tür, Liste mit 3 Personen.

---

## 3. AP3b Wellenkampf All (Team ALL)

Arbeitsbaum, Port und Startzeitpunkt stehen im Auftrag. Port 3382–3383, `WORLD_DIR=data/worlds-all`,
`REGIE_DIR=data/regie-all`.

### 3.1 Ziel
Wellenkampf All als echter Lobby-Modus mit **Szenenwahl**:
- freier Raum
- Nebel
- Asteroiden still
- Asteroiden bewegt

Für Nebel und Asteroiden gelten **dieselben Regeln für Spieler und Gegner**.

### 3.2 Befund (von der Studioleitung geprüft)
- `arena_space` (`server/sim/arena.js` `startSpace` :~77, `updateSpace` und `spawnWave` :~100–140) nutzt die feste Szene
  `CONFIG.arena.spaceScene: 'b7'` und spawnt 6 Wellen zyklisch (`CONFIG.arena.waves`).
- Raumszenen stehen fest in `shared/locations.js`: `splitter` (38 Brocken), `nebel` (`fog:true`, 10 Brocken), `b7` und
  weitere.
- **Nebel hat auf dem Server keine Wirkung.** `CONFIG.sensors.fogFactor` liest nur der Client (`render.js`). Der Ziel-Scan
  hat eine feste Reichweite (`space.js:~1144`).
- **Asteroiden** werden per Seed erzeugt (`space.js:~132–155`), sind statisch, und **nur das Spielerschiff** kollidiert
  (`space.js:~463–477`). Gesendet werden sie nur jeden 15. Snapshot (`asteroidSnapEvery`).
- Wellen Boden (`wellen.js`) wertet Welle, Zeit und Abschüsse aus. Das ist das Vorbild.

### 3.3 Lieferung
1. **Szenenwahl** mit K im Modus Wellen All: `frei` (b7 ohne Brocken), `nebel`, `asteroiden` (splitter) und
   `asteroiden_bewegt`. Die Startposition liegt sicher frei von Brocken.
2. **Wellen-Ablauf** wie beim Boden: Welle, Zeit und Abschüsse werden ausgewertet und am Ende angezeigt. Eskaliert wird
   nur über Zahl und Typ der Gegner. Die Logik, die beide Wellenmodi brauchen, gibt es nur einmal.
3. **Nebel auf dem Server:** Sensor- und Zielerfassungs-Reichweite × `fogFactor`, für die Lerche **und** für die
   Gegner-KI (Erfassen und Feuern). Der Client zeigt weiter an, was er heute zeigt.
4. **Asteroiden für alle (E4):** Gegner kollidieren und weichen aus, Projektile schlagen ein. Das gilt auch in der
   Kampagne. Die dadurch bedingten Golden-Abweichungen (m1 Splitter, m2 Nebel) stehen in `allow-w2.json` mit Begründung.
   Entscheidungsflags und Ausgang bleiben streng.
5. **Bewegte Asteroiden als deterministische Drift:** Jeder Brocken bekommt Bahnparameter (Seed, Richtung,
   Geschwindigkeit, Rotation). Die Position ist eine reine Funktion der Spielzeit und wird auf Server und Client mit
   **derselben** Funktion in `shared/` berechnet. Gesendet werden nur die Parameter, das 15er-Schema bleibt. Kollision
   wie in Nr. 4. Nur in der Szene `asteroiden_bewegt`; die Kampagne bleibt still.
6. **Bots:** Der Arena-Agent spielt alle 4 Szenen (`sim-headless arena --szene <id>`). Tabelle mit Welle, Zeit,
   Abschüssen und Treffern durch Brocken.

### 3.4 Abnahme
- Jede der 4 Szenen von Bots gespielt (Tabelle) und mindestens 3 Szenen von einem Menschen (Playwright mit echten
  Eingaben). Screenshots unter `shots/all/`.
- Golden gegen `base-w1` mit `allow-w1.json` und `allow-w2.json` grün.
- `snap:mess` im Budget, dazu eine Messung im Modus Wellen All mit `asteroiden_bewegt`.
- `npm run check` und `npm test` grün (mit einem neuen Test für die Drift-Funktion und den Nebel-Faktor).