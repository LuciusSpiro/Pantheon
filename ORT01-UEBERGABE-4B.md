# ORT-01 Paket 4b Teil 1 – Übergabe (Stand 2026-10-25)

Branch `ort01-4b` (von `ort01-int`), Worktree `C:\Users\Luciu\projects\Pantheon-ort01-4b`. Nicht gepusht, nicht gemergt.
Commit Code: `ba28cde`. (Diese Übergabe folgt als eigener Commit.)

## Fertig (Aufgaben 1–5)
1. **Ableitung:** `bauweiseFuerBesitz(art, besitz)` in `server/sim/landepunkte.js` (vor `neu`), einziger Verwendungsort `LP.neu` (Vorschau, Spielleiter-Anlegen, Debug, Testgelände, Labor laufen alle darüber). `genBauen` liest weiter den eingefrorenen `e.bauweise` (bewusst, kein Neuableiten beim Laden). Datentabelle `content/buehnen/achsen.json` → `bauweise_nach_besitz.kartenarten` (`station: erlaubt, rom→rom`; `aussenposten: erlaubt false` mit Hinweis Cardo-Layout; `ruine`, `schiff` false). Freischalten Außenposten = `erlaubt: true`, Test beweist es im Speicher. `besitz.rom` aktiv, neu `besitz.ger` aktiv; Paletten `content/buehnen/paletten/rom.json`, `ger.json` (Basis, kein Banner).
2. **Weltstand:** Test belegt rom-Station vor/nach toSave/restore gleich (Bauweise, Karten-Hash), Tabelle danach geändert = gespeicherter Wert gewinnt, Altstand ohne `bauweise` lädt germanisch wie bisher, Version 3, keine neuen Felder/Blöcke.
3. **Fraktionen:** `content/katalog/fraktionen/rom.json` und `ger.json`. Modelle = vorhandene `fig/germanen/*`, Rezepte `wache` (grundtyp 2, schuetze 1) und `sturmtrupp` (niederhalter 1, enterer 1, grundtyp 1), Stärken wie alle, Einsatz station/aussenposten (wache auch hand). `rom`: Palette `rom`, neues Schemafeld `palette_senden: true` (siehe Probleme). `fraktion.werte` in 7 Umsetzungen um `rom`, `ger` erweitert (ausbruch, durchbrechen, entkommen, geiseln_befreien, stellung_nehmen (2×), unbemerkt_hineinkommen, sabotieren). Kontext-Goldens `tools/fixtures/context/*` per `test-spielleiter --update` neu (nur `fraktionen` +2 Einträge; llm-Fixtures unverändert).
4. **Spielleiter:** Vorgabentext `szenenbau.js` (grobplanVorgaben) nennt Bauweise (`station, rom, rom, intakt`), Prompt `grobplan.system.md` ergänzt (Station + rom = römisch, Fraktion rom/ger). Kein Spielername.
5. **Wege zum Stationskampf mit Römern:**
   - Debug: `buehne station 3 - rom umkaempft - rom` (`-` = Bauweise aus Besitz, 7. Wert Fraktion besetzt die Karte).
   - Testgelände/Wellen: Lobby-`arena {art:'station', besitz:'rom', fraktion:'rom'}` (Wellen nehmen die Fraktion, `arena.js wellenFraktion`).
   - Labor (nur Bots/Tests): `node tools/sim-headless.js labor stellung_nehmen/trupp_raeumen --buehne station:rom --seeds 1 --crew 3` → OK (1/1, 0 Fehler, 0.9 min).
   - Wellen-Bot: `node tools/sim-headless.js wellen --karte station --besitz rom --players 3 --max 900` → Welle 9, Fehler 0.
   - Screenshots: `node tools/ort01-shots.js --arten station --bauweisen auto --besitz rom --gegner rom --zustand umkaempft --seeds 3,5,7` (Ordner `shots/ort01-4b`, `-gegner`, `-ger`, gitignored).
   - Test `tools/test-bauweise-besitz.js` (81 + 4 Debug-Prüfungen, grün), in `npm test` und als `npm run test:bauweise-besitz`.

## Gates
Grün: `node tools/test-bauweise-besitz.js`; Katalog lädt ohne Fehler; `test-spielleiter` 209 ok nach `--update`; Karten-Hashes ad hoc (Schiff, Ruine, Außenposten, Station außer rom, 7 Besitzer × 6 Seeds, `ort01-int` vs `ort01-4b`): 138 von 162 gleich, die 24 Abweichungen sind nur `besitz: ger` (Beschriftung, Skript-Artefakt). Beide Bot-Läufe oben.
**Nicht gelaufen / unvollständig:** `npm test` komplett (der letzte Lauf wurde bei `test-labor` auf Anweisung abgebrochen; der Lauf davor stoppte nur an den Kontext-Goldens, inzwischen aktualisiert), `npm run check`, `check:assets`, `snap:mess`, Golden Trace (frisch `Pantheon-main` vs Branch, `--dir`), `hash-baseline --compare --karten` 72/72 (ist Teil von `npm test`), `sim-sund` beide (in `npm test`). Die letzten fünf Punkte stehen noch aus.

## Bekannte Probleme / Befunde
- **Fraktionspalette erreicht den Client nie:** Server lässt `pa` weg, wenn es die Fraktionspalette ist, der Client kennt sie nicht (nur `e.pa`). Kontor- und Rostmeute-Gegner sehen daher heute wie Standard-Germanen aus (Screenshot belegt für Kontor). Für `rom` per `palette_senden` umgangen (combat.js `b2SnapGegner`). Allgemeine Lösung (Bedingung entfallen lassen) würde die Optik bestehender Gegner ändern: Entscheidung Kai.
- Gegner-Optik: keine römischen Figuren, nur `fig/germanen/*` in Palette rom (rot/weiß, Waffe Bauweise rom über `WAFFE_BW`). Wirkt als Kohorte, ist aber Germanenkörper. Lücke für ein Modellpaket.
- Screenshot-Werkzeug: `tp` neben Gegner trifft oft Nebel, nur etwa jedes zweite Gegnerbild zeigt sie (`shots/ort01-4b/auto/station/3-gegner1.png`, `ort01-4b-gegner/.../4-gegner1.png` gut).
- Römische Station sonst stimmig (Marmor, Rot, Gold, Kartentisch/Adler im Kommando), Dunkelgrauer Boden etwas kalt; im Gang wenige Props.
- Rollen-Hauptstücke `leit` = 0 in der Statistik der Rom-Station (nicht untersucht).
- `lp neu`/Debug mit `ger` als Besitz unproblematisch, aber Kartenlabel `ger` statt `germanen`.

## Offene Fragen an Kai
1. Besitzname `ger` (wie Sektorkarte, gibt BESITZ-REGION-Prüfung gratis) oder `germanen`? Im Code `ger`.
2. `palette_senden` für alle Fraktionen einschalten (Kontor blau, Rostmeute rostig)?
3. Fraktion für Piraten (Hex `pirat` → `rostmeute`) und `saum` → `konkordat` bleibt wie vorgeschlagen, keine eigenen Einträge angelegt.
4. Rom auch für Außenposten-Besetzung (Fraktion rom auf germanischem Außenposten ist erlaubt, nur Bauweise aus).

## Nächste Schritte
1. `npm test` komplett laufen lassen, Fehler beheben. 2. `npm run check`, `check:assets`, `snap:mess`. 3. Golden Trace gegen frischen `Pantheon-main`-Lauf (nur mit `--dir` im Scratchpad). 4. Entscheidung Fragen 1–2. 5. Bei Bedarf bessere Gegner-Screenshots (Tool: Spieler vor sichtbare Gegner setzen). 6. Rückmeldung an Leiter, Merge in `ort01-int` nach Kais Zusage.
