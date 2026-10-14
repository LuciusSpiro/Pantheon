# CONTRACT-SL – Kampagne „Die Schuld der Lerche“ (SL0–SL11), Bauplan und Teamregeln

Grundlage: Vault `Coop-Spiel/Briefing Die Schuld der Lerche (SL0-SL12).md`, `Kampagne Die Schuld der Lerche.md` (alle
Entscheidungen mit Datum, zuletzt 2026-10-14), `CONCEPT-SL0.md` … `CONCEPT-SL11.md` (Konzepte, gelten als Entwurf des
jeweiligen Pakets; bei Widerspruch gilt: dieser Vertrag > Vault-Entscheidungen > Konzept).
Branch: `sl` (von `main`, Stand 87ff7a7). Kai testet die **ganze Kampagne** auf einmal (kein Etappen-Spieleabend), darum
wird alles in einem Zug gebaut, in Wellen nach Abhängigkeit. Studioleitung = „main“ (committet zwischen den Wellen).

## 1. Zusätzliche Entscheidungen (Kai, 2026-10-14)
- Gruppe startet **auf dem Planeten** (Boden Kantenstein), Lerche im Orbit; kein Rückfall auf „angedockt“.
- Ein Prozess = eine Partie; Karte je Prozess fix, Wechsel beim Spielstart.
- Beamen von der Oberfläche braucht **Landepunkt-Scan der Ops**.
- **Evert ist immer im Frachtraum, sobald er mit der Lerche fliegt** (belegt einen Frachtplatz; auch Heimreise).
- Glyphen-/Sternkarten-Minispiel (Boje) wird **neu gebaut**.
- Alles andere: Standard-Empfehlungen der Konzepte.

## 2. Wellen
| Welle | Pakete | Team | Bemerkung |
|---|---|---|---|
| 0 | SL0 (Ops-Umbenennung zuerst, dann Schilde, Personen als Fracht, Frachtraum, Kustodenpult) | T1 | Rename zuerst und früh melden |
| 0 | SL1 (Kartenwahl, `welt.startOrt`, Kante enthüllen, sund.json, Boden-Start, Lobby-Modus) | T2 | Boden-Start-Spike zuerst |
| 0 | SL6 Kern (shared/zonen, Positionsversatz, Hitze/Schaden, Fracht Deuterium, Verkauf, Marken-Prüfungen) | T4 | Gasriese-Mission danach |
| 0 | SL5 Entschlüsseln (Minispiel Server+Client+Bot) | T3 | ohne Konsolen-Umbenennung |
| 1 | SL1B Karte, SL2 Außenposten+NSC, SL3 Überfahrt/Falle, SL4 Sonden+Sektorplan, SL7b Landepunkt-Scan | T2, T2, T1, T3, T4 | nach Welle 0 |
| 2 | SL5 Spur, SL6 Gasriese, SL7a Gravimetrie, SL7c Monster-Station, SL8 Notrufe | T3, T4, T4, T4, T3 | |
| 3 | SL9 Lösegeld/Söldner, SL10 Boje (+Minispiel) | T1, T4 | |
| 4 | SL11 Kette, Texte, Lobby, Bots durch beide Wege, Integration/QA | T2 + alle | |

## 3. Regeln für alle Teams (gelten wie TEAM-START B1–B3)
- Nur Edit/Write (Umlaute!), **nie** Repo-Dateien per Skript/Shell-Umleitung schreiben. Vor jedem Edit die Datei frisch lesen,
  weil andere Teams parallel im selben Arbeitsbaum arbeiten. Fremde Änderungen nie zurücksetzen. **Keine Commits,
  kein `git checkout/reset/stash`** – committet die Studioleitung nach jeder Welle.
- Gemeinsame Dateien (`server/game.js`, `shared/protocol.js`, `public/js/consoles.js`, `render.js`, `hud.js`, `config.js`,
  `weltstand.js`) nur kleine, gezielte Edits, neue Logik in **neue Dateien** (Action-Layer), Layer-Schnitt nach Kais CLAUDE.md.
- Testserver nur auf eigenen Ports (T1: 3411, T2: 3421, T3: 3431, T4: 3441), `ROOM_CODE=off`, eigene `WORLD_DIR=data/worlds-<team>`;
  vor dem Ende beenden. Nie 3100 (Spielinstanz), 3300/3301/3310/3389. Keine Live-LLM-Aufrufe.
- **Nicht brechen:** `npm run check`, `npm test`, Golden m1–m3, Eisenwald-Kette (`npm run sim:kette`), Snapshot unter der
  Grenze. Fällt etwas durch, das nicht von dir stammt (anderes Team mitten im Umbau): im Bericht nennen, nicht reparieren.
  Bewusste Golden-Änderungen mit Abweichungsliste (Datei `concept/sl/GOLDEN-ABWEICHUNGEN.md`, anhängen, nie überschreiben).
- Jedes neue Verhalten braucht Test, Szenario-Labor-Einstieg und Bot-Pfad. Ehrlich berichten (verfehltes nennen).
- Offene Fragen, die nur Kai entscheiden kann: nicht raten, Default aus dem Konzept nehmen und im Bericht markieren.
- Milestone-Signale (z. B. „Ops-Rename fertig“) per SendMessage an „main“.

## 4. Abschlussbericht je Paket
Max. 25 Zeilen: Gebaut, Dateien, Tests (Zahlen), Abweichungen vom Konzept, offene Punkte, Golden-Abweichungen.
