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
