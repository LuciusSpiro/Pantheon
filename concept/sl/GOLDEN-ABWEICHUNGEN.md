# Golden-Abweichungen Kampagne „Die Schuld der Lerche“ (CONTRACT-SL §3)

Nur anhängen, nie überschreiben.

## SL0 Ops-Umbenennung (Team T1, 2026-10-14)
- Änderung: Anzeigename der Station `weapons` ist in allen Texten „Ops“ (vorher „Taktik“), „Taktikkarte“ wird „Ops-Karte“. ID `weapons` bleibt.
  Betroffen: Funk-/ODA-/Hinweistexte in `content/regiebuecher/m1, m2, k1–k6`, Katalogtexte, Konsolen-/HUD-Beschriftung, Serverhinweise.
- Golden m1–m3: Messung 20 Seeds × m1–m3 × Crew 1/3 gegen eine Baseline aus `git archive HEAD` (87ff7a7 + Konzeptdateien), beide mit derselben Bot-Version.
  Ergebnis mit `tools/fixtures/golden/allow-sl0.json`: **GOLDEN GRÜN**, 42/120 byte-identisch, Dauer-Mediane 0 % Abweichung. Abweichend sind nur Texte mit „Taktik“ bzw. „Ops“ (m1, m2).
  Hinweis: `base-w2` ist als Baseline veraltet (R1 Rollen und B2 haben Captain-Hilfetexte und Schrittzeiten geändert); der Vergleich gegen `base-w2` ist unabhängig von SL0 rot.
- Kontext-Goldens (`tools/fixtures/context/*.context.json`, `tools/fixtures/llm/**`, `buch-hashes.json`): per `node tools/test-spielleiter.js --update` neu geschrieben (nur Textänderung Taktik -> Ops im Katalog `verfuegbar` und in Regiebuch-Hashes).
- Nachtrag SL0 komplett (Kustodenpult, Personen als Fracht, Schilde): zweite Messung 20 Seeds × m1–m3 × Crew 1/3 gegen dieselbe HEAD-Baseline.
  Erfolgsquoten gleich (m1/1 20→20, m1/3 18→18, m2/1 20→20, m2/3 15→16, m3/1 19→19, m3/3 20→20), Dauer-Mediane innerhalb ±4,4 %.
  Neue Textabweichungen: „Sonde“ -> „Kustodenpult“ (Fehl-/Sperr-/Hilfetexte, m1 `away.solo`, `aussen.sonde_aus`, `ziel.sonde`), „Taktik“ -> „Ops“.
  Inventar `sonde` 3 ist SL4 (Startvorrat Ops-Sonden, nicht SL0). Die restlichen Abweichungen sind Kampfrauschen bei Crew 3 (je Seed ein Lauf mehr/weniger
  Softlock im Gefecht: m1/3/16, m2/3/15, m2/3/16 ↔ m1/3/20, m2/3/18, m2/3/20, m2/3/5), also Zufallsfolgen anderer parallel gebauter Pakete, nicht Logik von SL0.
  `golden-trace --compare` bleibt deshalb bei diesen Läufen rot (Erfolg true↔false je Seed), die Quote ist gleich.
  Internes: Konsole `sonde` heißt `kustodenpult` (Konsole, Befehl `kustodenpult.input`, Snapshot `away.kustodenpult`); Objekt-ID `platform.sonde`, Ereignis
  `sondeDisabled` und Kartenzeichen `Z` bleiben (Regiebuch-Verträge m1).
- Test `tools/test-rollen.js`: erwartet jetzt „Ops unbesetzt …“.
- Nicht umbenannt: Code-Kommentare in `tools/sim-headless.js` und Tests, Spielleiter-Archive (`content/spielleiter/**`), Voxel-Asset `tactical.json`, Docs (`README`, alte `CONTRACT-*`).
