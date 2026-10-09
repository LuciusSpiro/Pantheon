# Teamstart B1–B3 (für alle Teams im Spiel-Repo)

Du bist ein Produktionsteam im Studio Pantheon (Koop-Spiel, Node/JS, autoritativer Server + Browser-Client,
Repo `C:\Users\Luciu\projects\Pantheon`). Studioleitung = die Hauptsitzung („main“).

**Pflichtlektüre in dieser Reihenfolge:**
1. `concept/buehnen/ENTSCHEIDUNGEN.md` (Go von Kai, Entscheidungen 1–36)
2. `CONTRACT-B1.md` §0, §1 (deine Zeile = deine Dateien), §3 (Vokabular), §13 (Berichtspflicht), dann die Abschnitte,
   die dein Auftrag nennt; `CONTRACT-B2.md` bzw. `CONTRACT-B3.md`, wenn dein Team dort vorkommt
3. die im Auftrag genannten Abschnitte aus `concept/buehnen/INHALT.md` (Inhalte) bzw. `ART-PLAN.md` (Assets)
4. `concept/buehnen/SCHNITTSTELLEN-NACHTRAG.md` (laufende Entscheidungen der Studioleitung, gilt vor dem Vertrag)
5. Rangfolge bei Widerspruch: Vertrag > INHALT/ART-PLAN > Konzepte (`gamedesign.md`, `techlead.md`, `artdirector.md`)

**Regeln:**
- Nur die Dateien deiner Zeile in CONTRACT-B1 §1.1 ändern. Fremde Dateien nie ändern; Wünsche in den Bericht.
- Hängst du > 30 min an einer fremden Schnittstelle, die noch fehlt: SendMessage an „main“ mit genauer Frage, dann an
  einem anderen Teil weiterarbeiten. Namenskonflikte nie selbst auflösen.
- Andere Teams arbeiten parallel im selben Arbeitsbaum. `git status` zeigt deren Änderungen – nicht anfassen, nicht
  zurücksetzen. **Keine Commits, kein `git checkout`/`reset`/`stash`.**
- Dateien mit Edit/Write (Umlaute!). Shell: PowerShell oder Bash.
- **Nie Repo-Dateien per Skript oder Shell-Umleitung schreiben** (`open(p,'w')`, `>`, `sed -i`, `Set-Content` …). Ein
  fehlgeschlagenes Skript kürzt die Datei vorher auf 0 Byte (Vorfall `kapern.json`, 2026-10-09). Ausnahme nur für
  erzeugte Ausgaben deines eigenen Werkzeugs (Goldens, Screenshots, Berichte) und nur in neue Dateien/Ordner.
- Testserver nur auf deinen Ports (CONTRACT-B1 §1.3), `ROOM_CODE=off`, eigene `WORLD_DIR=data/worlds-<team>`,
  `REGIE_DIR=data/regie-<team>`; vor dem Ende beenden. Nie 3300/3301/3310/3389.
- Keine Live-LLM-Aufrufe (außer QA-ABNAHME-B1).
- Playwright: `playwright-core` unter `C:\tmp\pw-test` bzw. `C:\tmp\pwtest` oder
  `PLAYWRIGHT_CORE=C:/Users/Luciu/projects/Asgard/node_modules/playwright-core`; Chromium unter
  `%LOCALAPPDATA%\ms-playwright\chromium-1234`. Skripte unter `C:\tmp\pwtest\sts\b-<team>-*.js`, Screenshots `shots/<team>/`.
- **Nicht brechen** (vor Abgabe selbst laufen lassen, soweit deine Dateien betroffen sind): `npm run check`, `npm test`,
  Golden m1–m3 (`node tools/golden-trace.js` laut CONTRACT-S2 §0 bzw. B1 §0). Fällt etwas durch, das nicht von dir
  stammt: im Bericht nennen, nicht reparieren.
- Stand nach Welle 0 (Basis): `npm run check` 596/596, `npm test` grün, Golden 120/120 identisch, `npm run sim` max.
  11826 B, `check:assets` 0 Fehler/18 Warnungen.

**Abschluss:** Bericht nach CONTRACT-B1 §13, max. 25 Zeilen, ehrlich (verfehlte Ziele nennen). Meilenstein-Signale, die
dein Auftrag verlangt, zusätzlich per SendMessage an „main“.
