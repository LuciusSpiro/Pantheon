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

## Gates (Stand Fortsetzung, alle auf Branch `ort01-4b`)
Alle grün:
- `npm test` komplett, EXIT 0 (inkl. test-bauweise-besitz, hash-baseline Karten 72/72, beide sim-sund, test-labor 41/41; der frühere Abbruch bei test-labor war mein eigenes Beenden der Prozesse, kein Fehler).
- `npm run check` grün, `check:assets` 0 Fehler (46 Warnungen), `snap:mess` ok (Worst Case 11661 B, Freie Fahrt Sund 10413 B).
- Golden Trace (`Pantheon-main` 3c7f8cd vs. `ort01-4b`, --seeds 3, --dir im Scratchpad): 18/18 Traces byte-identisch, GOLDEN GRÜN.
- Die 24 Hash-Abweichungen (Besitz `ger`) sind ein Skript-Artefakt: mein Vergleichsskript ersetzte `ger` auf ort01-int durch `herrenlos`, weil `besitz.ger` dort fehlte. Mit `ger` in beiden Ständen sind alle 24 Karten bit-gleich (Schiff, Ruine, Außenposten, Station). Die Gegenprobe (int mit herrenlos gegen 4b mit ger) unterscheidet sich ausschließlich im Feld `besitz`; Raster, Anker, Plätze, Deckung sind gleich. Die Hash-Baseline-Definition (72 Karten, rostmeute/kontor/konkordat/germanen) bleibt unverändert und ist grün.

## leit = 0 bei der Rom-Station: erklärt
`stats.leit` zählt nur die alten Leitstücke aus `BW.leit` (Platztyp × Kartenart). `bauweisen/rom.json` hat sie nur für ruine und aussenposten, für station keine. Die Rollen-Hauptstücke (`kind: leit`, z. B. Kartentisch mit Adler im Kommando) setzt der Rollenmodus und zählt sie nicht in `stats.leit`. Sie sind auf den Bildern sichtbar (`shots/r2/auto/station/11-kommando.png`...). Kein Fehler.

## Screenshots (Fortsetzung)
`node tools/ort01-shots.js --arten station --bauweisen auto --besitz rom --gegner rom --zustand umkaempft --seeds 3,5,11 --out shots/r2` (gitignored, 30 Bilder).
Gut: `shots/r2/auto/station/3-gegner1.png` (drei römische Gegner, Kohorte rot/weiß), `11-lager_1.png`, `5-reaktor.png` (Kartentisch/Adler), `11-zellen.png`.
Kritik: Boden dunkelgrau und kalt, große glatte Flächen (neue Regel: Muster mind. 2x2, ruhig, macht Teil A). Gegner sind Germanenkörper in Palette rom. Das Gegnerbild verfehlt die Gegner bei etwa jedem zweiten Versuch (Gegner patrouillieren zwischen Abfrage und Sprung). In Lager und Reaktor stehen kleine rot-goldene Figuren: keine Gegner (deren Kacheln liegen außerhalb des Raums), vermutlich Deko; Herkunft nicht geklärt.

## Kai-Entscheidungen (erledigt)
Besitzname `ger` bleibt; Piraten→rostmeute, Saum→konkordat; Fraktion rom auf germanischem Außenposten erlaubt, Bauweise rom für Außenposten bleibt aus; `palette_senden` nur für rom.

## Nächste Schritte
1. Herkunft der kleinen Figuren klären (Deko oder Rollen-Prop). 2. Screenshot-Werkzeug: Sprung zum Gegner robuster. 3. Merge in `ort01-int` nur nach Kais Zusage.
