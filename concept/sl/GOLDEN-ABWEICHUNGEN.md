# Golden-Abweichungen Kampagne „Die Schuld der Lerche“ (CONTRACT-SL §3)

Nur anhängen, nie überschreiben.

## SL0 Ops-Umbenennung (Team T1, 2026-10-14)
- Änderung: Anzeigename der Station `weapons` ist in allen Texten „Ops“ (vorher „Taktik“), „Taktikkarte“ wird „Ops-Karte“. ID `weapons` bleibt.
  Betroffen: Funk-/ODA-/Hinweistexte in `content/regiebuecher/m1, m2, k1–k6`, Katalogtexte, Konsolen-/HUD-Beschriftung, Serverhinweise.
- Golden m1–m3: Messung 20 Seeds × m1–m3 × Crew 1/3 gegen eine Baseline aus `git archive HEAD` (87ff7a7 + Konzeptdateien), beide mit derselben Bot-Version.
  Ergebnis mit `tools/fixtures/golden/allow-sl0.json`: **GOLDEN GRÜN**, 42/120 byte-identisch, Dauer-Mediane 0 % Abweichung. Abweichend sind nur Texte mit „Taktik“ bzw. „Ops“ (m1, m2).
  Hinweis: `base-w2` ist als Baseline veraltet (R1 Rollen und B2 haben Captain-Hilfetexte und Schrittzeiten geändert); der Vergleich gegen `base-w2` ist unabhängig von SL0 rot.
- Kontext-Goldens (`tools/fixtures/context/*.context.json`, `tools/fixtures/llm/**`, `buch-hashes.json`): per `node tools/test-spielleiter.js --update` neu geschrieben (nur Textänderung Taktik -> Ops im Katalog `verfuegbar` und in Regiebuch-Hashes).
- Test `tools/test-rollen.js`: erwartet jetzt „Ops unbesetzt …“.
- Nicht umbenannt: Code-Kommentare in `tools/sim-headless.js` und Tests, Spielleiter-Archive (`content/spielleiter/**`), Voxel-Asset `tactical.json`, Docs (`README`, alte `CONTRACT-*`).
