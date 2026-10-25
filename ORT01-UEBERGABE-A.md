# ORT-01 Übergabe Teil A (Stand nach Fortsetzung)

Worktrees: Spiel `Pantheon-ort01-int` (Branch `ort01-int`), Voxelwerk `voxelwerk-ort01-int` (Branch `ort01-int`).
`public/voxel` ist gegen den Voxelwerk-HEAD erzeugt (Spiel-Commit `ba9ea3d`). Kein Push, kein Merge.

## Stand Teil A

| Nr. | Stand | Commits (Spiel / Voxelwerk) |
|---|---|---|
| 1 Paletten (Rom-Außenposten, Zustände) | fertig; `art.<kartenart>` je Zustand, `rom_verfallen/_umkaempft`, `station_esse_verfallen/_umkaempft`. Verfall/Umkämpft im Bild nicht geprüft. | `734ec5a` / `6781eb4` |
| 2 Kronen 1-Voxel-Linie | fertig (Rom Amber, Germanen Glut `#FF7A1A`) | / `549d98b` |
| 3 Böden | fertig, danach durch Punkt 11 (ruhiger Boden) ersetzt | / `549d98b`, `Boden ruhig…` |
| 4 Rollen-Daten | fertig: `zug_gross` (ab 49 Kacheln), `pflicht` an allen `leit`, `zellen.feldzelle` gestrichen (Zelle nur als Anker), Thron nicht mehr festes Kontrollraum-Leitstück (`leit.kontrollraum` aus `germanen.json`), Medkiste Runensiegel | `4921b2e` / `6e531c3` |
| 5 Raumtyp über Anker | fertig mit Test (messe_1 + Sprengpunkt → reaktor, Kontrollraum + Terminal → kommando) | `4921b2e` |
| 6a Leitstück ohne Anker | fertig in `kit.js` (meidet Anker/Weg/Pad/Rampe/Tür, nächstes freies Rechteck, sonst entfällt); Landeplatz Rom/Germanen flach (1 Voxel, 6 cm); `silhouetteFehler` prüft `bauweise.leit` (Ausnahmeliste `LEIT_PLATZ_HOCH`) | `4921b2e` / `Landeplatz…` |
| 6b Klasse `bau` | fertig: nur `ort/`, `kit/`, `rom/standarte`, `rom/laterne`; Flächenprüfung gegen Footprint; Test inkl. Einbau in `check-assets` | `4921b2e` |
| 6c/6d/6e | fertig (Höhenregel je Eintrag, Rückfall Hauptstück, Kleinkram/Doku in `CONTRACT-ROLLEN-ORT.md`) | `734ec5a`, `4921b2e` |
| 7 Prüf-Sperre Orte | **offen** (bewusst, erst nach Teil B1) | – |
| 8 Screenshot-Werkzeug | fertig: Sitzkamera + Figur geparkt (Station), Übersichten (`--uebersicht`, Nebel aus, schräg von oben), `--lp`, `--root` (main-Archiv für Vorher-Bilder, `lp hin` ins Archiv kopiert) | `4921b2e` |
| 9 Dach-Budget | fertig (Prüfbogen 3.200, Fehler ab 4.800) | / `250e87d` |
| 11 Boden ruhig (Kai) | fertig: `par` (x mod 2 + 2·(y mod 2)) von `kit.js` an `kit/geruest/boden` und die Slots `boden_belag`/`boden_fuge` (rom, germanen × station, aussenposten); Fugen nur an 2×2-Blockgrenzen, keine Pro-Kachel-Streuung/Flecken/Schachbrett; Schiff/Ruine ohne `par`. Die Station dieser Bauweisen nutzt jetzt die Kit-Slots statt der Fliesen-Optik (`stationBoden` nur noch für andere Bauweisen). Nicht umgesetzt: Amber-/Glutlinie im Boden (Modelle kennen die Wegrichtung nicht). | `4921b2e` / `Boden ruhig…`, `Stationsfuge heller` |

Baseline: `deko`/`layout` neu in `3245cd2` (Grund: Rollen-Daten, Rückfall, Zellengrenze `MAX_ROLLE_JE_ZELLE`=6). Karten 72/72, `deko_zellen` 60/60 unverändert.

## Gates (Stand `ba9ea3d`)
Grün: `npm test` (Exit 0), `npm run check`, `check:assets` (0 Fehler, 46 Warnungen), `snap:mess`, Hash-Vergleich (72/72, 60/60, 120/120, 120/120, Parität 60/60), Golden 120/120 byte-gleich zu frischem main-Lauf und zur eingecheckten Basis.
Kaltbau (10 Seeds, ruhiger Lauf, alle gültig): Außenposten germanen Median etwa 520 ms (Baseline 442, Toleranz 530), Station etwa 440 ms (Baseline 388, Toleranz 466); Dreiecke Außenposten germanen Median etwa 441 k (Grenze 416 k × 1,1 = 458 k), Station etwa 316 k; Rom Außenposten etwa 278 k, Station etwa 225 k.
Hinweis Dreiecke Bestandskarten (`VoxelKit.stats()`): Methalle 416 k (main 394 k), Eisenwald 388 k (364 k), Kesh-Grabung 450 k (428 k), Kantenstein 406 k; über 400 k war schon main.

## Screenshots
`shots/ort01/<bauweise>/<kartenart>/<seed>-<raum>.png` und `…-uebersicht.png` (Seeds 1–3), `shots/ort01/lp/<id>/…` (Bestandskarten), Vorher (main): `shots/vorher-main/lp/<id>/…`.
Kritik: Boden jetzt ruhig und klar lesbar (2×2-Felder, dunkle Fuge); Rom-Station: Marmor/Rot/Gold, Stücke stehen, nichts auf Wegen. Offen: Außenposten-Gelände bei Rom braun, Rom-Dächer fast schwarz, Germanen-Dächer sehr dunkelbraun (Dach-Rolle/Gelände-Palette, nicht Teil A); in Sitzkamera-Bildern wirken Farben blasser als im Spiel (Glut dort rosa-braun); Station Germanen: Fuge gut sichtbar, noch etwas kontrastreich.

## Nächste Schritte
1. Teil B1: Anker-Modelle aus `voxelwerk-ort01-anker` (`ANKER-VERDRAHTUNG-ORT01.md`) mergen, in `bauweisen/*.json` (`anker.*`) verdrahten, `npm run assets` (eigener Commit).
2. Punkt 7 Prüf-Sperre (keine `*/ruine/*`, `truhe`, `kaefig_zelle`, `werkzeug`, `prop/germanen/*` in Rom) als Fehler mit Schalter anlegen, erst nach Schritt 1 aktivieren, Mutationsprobe.
3. Dach-/Geländefarben Außenposten (Rom braun/schwarz, Germanen dunkel) mit Kai klären.
4. Verfall/Umkämpft-Paletten im Bild prüfen (`b7.aussenstelle` verfallen, `kesh.grabung` umkämpft).
5. Alle Gates erneut nach B1.
