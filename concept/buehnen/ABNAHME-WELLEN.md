# Abnahme „Wellen Boden“ (Team LABOR, AP3a, CONTRACT-W2 §1.4 Nr. 1)

Stand: 2026-10-10, Arbeitsbaum `Pantheon-w2a` (Branch `w2-labor`). Keine Commits.

Testserver: 3393 (Wellen) und 3394 (Labor), `ROOM_CODE=off`, `--debug`, `WORLD_DIR=data/worlds-labor*`, `REGIE_DIR=data/regie-labor*`.
Beide sind am Ende beendet.
Browser: headless Chromium über playwright-core.
Skripte: `C:\tmp\pwtest\sts\b-labor-{wellen-mensch,lobby,start,server}.js|.sh`. Bilder: `shots/labor/`.

**Wie gespielt wurde:**
- **Mensch:** nur echte Eingaben im Browser.
  - Lobby: M (Wellen Boden), K (Karte), W (Waffe), Enter.
  - Spiel: WASD laufen. Die Maus zielt auf den Gegner (Bildschirmposition über `Render.worldToScreen`), die gehaltene Taste
    gibt Dauerfeuer. Die Lanze wird gehalten, bis sie geladen ist.
  - Bei Schild ≤ 1 setzt sich der Spieler ab, bis der Schild wieder voll ist. Ohne Sicht läuft er nach 4 s zum Gegner.
  - Gelesen wird nur der Zustand. Kein Debug, kein `god`, keine direkt gesendeten Nachrichten.
  - Der Spieler ist ein Skript mit Reaktionszeit ≥ 0,1 s bei 6–20 FPS. Das ist keine Menschen-Bestzeit.
- **Bot:** `node tools/sim-headless.js wellen --karte … --players beide --seeds 3` (WellenAgent, keine Debug-Befehle) und
  `BOT_WAFFE=rotation`.

## Ergebnis

**Bestanden nach drei Korrekturen** (W-F1 bis W-F3).

| Karte | Mensch (Waffe): erreichte Welle, Abschüsse, Zeit | Bot solo (3 Seeds): Welle | Bot zu dritt (3 Seeds): Welle | Fehler Server/Browser | Snapshot max |
|---|---|---|---|---|---|
| Außenposten | Blaster: W3 · 6 · 2:55 (1. Lauf), W2 · 2 · 1:29 (Endlauf) | 3 / 4 / 1 | 6 / 7 / 6 | 0 / 0 | 10 725 B |
| Station | Sturmgewehr: W2 · 1 · 0:58 | 3 / 3 / 3 | 5 / 7 / 7 | 0 / 0 | 10 575 B |
| Schiff | Granatwerfer: W3 · 1 · 1:31 | 4 / 3 / 2 | 8 / 9 / 10 | 0 / 0 | 10 342 B |

In jedem Lauf haben funktioniert:
- Countdown, Wellen und Pause (Aufrichten, Auffüllen).
- Ende bei „Crew unten“: Ergebnisanzeige, Rekord, nach 15 s zurück in die Lobby (`*-05-ergebnis`, `*-06-lobby-zurueck`).
- Die in der Lobby gewählte Waffe ist unten die aktive Waffe (HUD und Snapshot `wf`).

Ruine und Kesh-Hof liefen zusätzlich als Bot (solo W2–W4, zu dritt W5–W7, 0 Fehler).

**Waffen-Rotation** (`BOT_WAFFE=rotation`, 3 Karten, Crew 3 × 2 Seeds und solo × 6 Seeds): **alle 6 Waffen benutzt.**

| Waffe | Abschüsse je Lauf (zu dritt / solo) | Welle Median (zu dritt / solo) |
|---|---|---|
| Blaster | 25,3 / 4 | 8 / 3 |
| Sturmgewehr | 26 / 3,3 | 8 / 3 |
| Granatwerfer | 8,3 / 5 | 8 / 3 |
| Lanze | 1,7 / 0,7 | 5 / 2 |
| Nahkampf | 30 / 5,3 | 5 / 4 |
| Betäuber | 8 / 1,7 | 5 / 2 |

## Gefundene und behobene Fehler

**W-F1: Ohne Lobby-Waffe sind 5 von 6 Waffen im Wellenmodus nicht spielbar.**
- Ursache: `startWellen` beamt sofort hinunter, die Transfer-Konsole wird nie erreicht.
- Behoben: Lobby-Parameter `lobbyOpt { waffe }` je Spieler (Taste W, Anzeige in „An Bord“). `game.lobbyWaffenSetzen()` setzt
  die Waffe beim Start von Wellen Boden und Labor, vor dem Beamen (`test-labor`: alle drei unten mit ihrer Waffe).

**W-F2: Welle 1 solo war nicht zu überleben.**
- Befund mit 2 Karls:
  - Bot solo: in 18 von 24 Läufen in Welle 1 am Boden, nach 12–40 s.
  - Mensch im Browser: nach 10 s am Boden, 0 Abschüsse.
- Gleiche Regeln für beide Seiten heißt: Eins gegen eins ist offen, eins gegen zwei ist verloren.
- Behoben: `CONFIG.wellen.anzahl.basis` 1 → 0.
  - Solo: Welle 1 hat 1 Gegner, Welle 2 hat 2.
  - Zu dritt: Welle 1 hat 2 Gegner.
  - Die Eskalation sonst ist unverändert.
- Danach: Bot solo erreicht Median Welle 3, der Mensch W2–W3.

**W-F3: Patt mit dem letzten Gegner.**
- Befund:
  - Bot solo blieb in 7 von 15 Läufen 600 s in Welle 1 (SOFTLOCK im Lauf).
  - Zu dritt blieb er 2× in Welle 7 hängen.
- Ursache, zwei Teile:
  - Der Gegner zieht sich bis „Schild voll“ hinter eine Ecke zurück (`squad.js`, `retreat`). Dort ist er 2 Kacheln vom Spieler
    entfernt, aber ohne Sicht.
  - Der WellenAgent ging nur auf Gegner zu, die mehr als 6 Kacheln entfernt waren, und blieb sonst stehen.
- Behoben im Bot: Nach 5 s ohne Sicht geht er auch nah heran. Bleibt er 12 s am selben Ziel, flankiert er 4 s lang.
- Danach: 0 Patts in 42 Läufen (Endläufe, auch mit Rotation).

Am Spiel selbst wurde nichts geändert. Ein Mensch, der stehen bleibt, kann dasselbe Patt erzeugen (siehe Wunsch an BODENKAMPF).

**Klein, behoben:** Das Zielfeld zeigte im Wellenmodus „Frei erkunden – Entdeckungen 0/12“. Jetzt zeigt es:
- „Welle n: Gegner ausschalten (r übrig)“
- „Welle n überstanden – nächste in t s“

Umgesetzt in `arena.js` (`wellenZiel`).

## Offen (nicht in meinen Dateien, als Wunsch)
- **BODENKAMPF (`squad.js`):** Ein Gegner im Rückzug wartet ohne Sicht unbegrenzt, solange sein Schild nicht voll wird.
  Vorschlag: Nach 20 s im Rückzug geht er wieder auf `pin` bzw. `push`.
- **AP6 Feinschliff:**
  - **Betäuber:** 4 Schuss je Hitzezyklus gegen 3 Schild + 1 Treffer. Ein Fehlschuss löst die Sperre aus (3 s), danach lädt der
    Schild des Gegners (4 s).
    - Vor W-F3 kam der Bot solo damit in 3/3 Läufen zu 0 Abschüssen.
    - Jetzt sind es 1,7 Abschüsse je Lauf.
  - **Lanze:** Der Bot ist mit ihr am schwächsten (0,7–1,7 Abschüsse je Lauf). Das liegt am Bot: Er unterbricht das Laden durch
    Treffer und steht dabei offen.
  - **Solo verwundet = Rundenende:** Die ODA „Kameraden: E halten zum Aufhelfen“ und das Banner „Notrückholung in 0:42“
    erscheinen trotzdem (`*-05-ergebnis`). Das ist irreführend.
- **CLIENT/RENDER:**
  - Germanische Gegner tragen das Schild „PLÜNDERER“, Barks kommen von „Plünderer“ (`render.js:1907/2195`, `client.js:1106`),
    obwohl der Hinweis „Neuer Gegnertyp: Karl“ lautet.
  - Die Anker-Zählliste „Kiste 0/7 · Terminal 0/3 …“ ist im Wellenmodus ohne Bedeutung.
