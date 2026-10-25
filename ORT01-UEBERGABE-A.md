# ORT-01 Übergabe Teil A (Stand: Kai hat abgebrochen)

Worktrees: Spiel `Pantheon-ort01-int` (Branch `ort01-int`), Voxelwerk `voxelwerk-ort01-int` (Branch `ort01-int`, HEAD `6e531c3`).
`public/voxel` ist gegen Voxelwerk `6e531c3` erzeugt (Spiel-Commit `fa1b662`). Kein Push, kein Merge.

## Teil A, Punkt für Punkt

| Nr. | Stand | Commits |
|---|---|---|
| 1 Palette Rom-Außenposten und Zustandspaletten | **fertig, nicht im Bild geprüft.** `kit.js`: `paletten.art.<kartenart>` darf ein Objekt je Zustand sein. `rom.json`: station und aussenposten je intakt/verfallen/umkaempft. `germanen.json`: station_esse je Zustand. Neue Paletten in Voxelwerk: `rom_verfallen`, `rom_umkaempft`, `station_esse_verfallen`, `station_esse_umkaempft`. Stimmung `planet_day` für den Außenposten nicht angefasst. | Spiel `734ec5a`; Voxelwerk `6781eb4` |
| 2 Kronen auf Leitfaden-Maß | **fertig, nicht im Bild geprüft.** Rom-Station: je Wandachse genau eine Amber-Linie (vorher Nord und Süd = 2 Voxel breites Band). Rom-Außenposten: Travertinkrone statt Gunmetal. Germanen Station und Außenposten: Glut `#FF7A1A`, emit 0,6. `station_esse`: `ember` `#FF7A1A`, emit 1,0. Quad-Budget nicht erhöht. | Voxelwerk `549d98b` |
| 3 Böden | **fertig, nicht im Bild geprüft.** Germanen-Innenboden helles Eisen, Glut nur als Nordrand-Linie an Kacheln mit `seed == 0` (jede vierte), sonst kalte Fuge (die Modelle kennen die Kachelposition nicht, "Torschwelle/Mittellinie" ist damit nicht umsetzbar). Rom-Innenfugen Travertin, Amber-Rinnenfuge entfernt. | Voxelwerk `549d98b` |
| 4 Rollen-Daten | **angefangen.** Format und Deko-Code sind da (`zug_gross`, Schwelle `GROSS_AB = 49` Kacheln in `deko.js`; `nur_wand`; Prüfregeln). **Die Daten in `rollen/*.json` sind NICHT geändert** (kein `zug_gross`, kein `pflicht` an den Leitstücken, Throne/Kommando nicht umgebaut). Fertig ist nur die Germanen-Medkiste mit Runensiegel. | Spiel `734ec5a`; Voxelwerk `6e531c3` |
| 5 Raumtyp über Anker | **Code fertig, ohne eigenen Test.** `deko.js` `raumtypDe`: Platz mit Anker `sprengpunkt` → `reaktor` (nur Station), Platz vom Typ `kontrollraum` mit `terminal` → `kommando`. Generatorkarten unverändert (Hash 72/72, Baseline unverändert gleich in den Zellen). Fehlt: Test mit einer Modul-Karte (Platz `messe_1` mit Sprengpunkt) und Paritäts-/Hash-Belege auf Bestandskarten. | Spiel `734ec5a` |
| 6a Leitstück auf Ankern (Sensorturm, Landeplatz) | **offen.** Nichts in `kit.js` (~884) geändert, Landeplatz-Modell nicht umgeschrieben. | – |
| 6b Klasse `bau` verschärfen | **offen** (nur `kit/`-Ausnahme im Test bleibt). | – |
| 6c Höhenregel je Eintrag | **fertig** (`rollen-pruefung.mjs`, Test angepasst). | `734ec5a` |
| 6d Ausfall Hauptstücke | **fertig im 10-Seed-Test:** Rückfall in dieser Reihenfolge: wandnah fh…1, frei fh…1, Abstand 0 wandnah, Abstand 0 frei (nicht bei `nur_wand`). Außenposten 38/38 (vorher 33/38), Station 102/102. Die Quote auf den 1.668 Räumen der Review nicht neu gemessen. | `734ec5a` |
| 6e Kleinkram | **offen** (`kitIds`-Präfix `rom`, `kaltbau-mess --bauweise` schiff, `lp hin` in `protocol.js`, `transferZiel.scene`, `mtimeDirty`, CONTRACT/Kommentare `deko.js` ~13/~20; CONTRACT-ROLLEN-ORT.md kennt `zug_gross`, `nur_wand`, Rückfall noch nicht). | – |
| 7 Prüf-Sperre Orte | **offen.** Nichts gebaut. Wichtig: erst nach Teil B1 aktivieren, sonst rot (Anker lösen heute Ruine-/Alt-Props auf). | – |
| 8 Screenshot-Werkzeug | **offen** (Figur ausblenden, echte Übersicht, Vorher-Bilder von `Pantheon-main`). Heute: `tools/ort01-shots.js`, `--lp` für Bestandskarten; `uebersicht.png` zeigt nur dieselbe Kamerahöhe in breitem Fenster. | – |
| 9 Dach-Budget Prüfbogen | **fertig.** `tools/pruefbogen.mjs`: Dach 3.200, Fehler ab 4.800; `kit/germanen/dach` jetzt Warnung (4.156), kein Fehler. | Voxelwerk `250e87d` |

Zusätzlich (A-Gates): `deko`/`layout`-Baseline neu gezogen (`1e9e287`, Grund: Hauptstück-Rückfall verändert die Außenposten-Platzierung bewusst). Karten 72/72 und `deko_zellen` 60/60 unverändert.

## Gates

Zuletzt grün (nach den letzten Code-Änderungen): `test-rollen-modus` 92/92, `test-rollen-paritaet` 69/69, `test-bau-klasse`, `test-buehne` 470/470, `hash-baseline --compare` (karten 72/72, deko_zellen 60/60, deko 120/120, layout 120/120, layout-parität 60/60), `npm run check:assets` 0 Fehler (46 Warnungen).
Der letzte vollständige Lauf von `npm test`, `npm run check`, `snap:mess`, Golden Trace (frisch gegen main, `--dir`) und Kaltbau stammt aus Phase 6 (vor Teil A) und war grün (Golden 120/120 byte-gleich). **Nach Teil A nicht neu gelaufen:** `npm test` (gesamt), `check`, `snap:mess`, Golden, Kaltbau, Dreiecke je Bühne, Screenshots.

## Bekannte Probleme
- Die Teil-A-Modelländerungen (Kronen, Böden, Paletten) wurden nicht im Bild beurteilt, nur durch `tools/check.js` und `pruefbogen` (0 Fehler) geprüft.
- Kaltbau-Zeiten schwanken auf dieser Maschine um Faktor 2 (derselbe Stand 535–1.280 ms); Zeit-Abnahme braucht einen ruhigen Rechner. Dreiecke sind stabil (Außenposten germanen etwa 422 k mit Rollen, Grenze 458 k).
- Rom-/Germanen-Anker zeigen noch Ruine-/Alt-Props (Beute, Zelle, Terminal, Sprengpunkt, Ziel); das behebt Teil B1.
- Platzhalter `anker:flagge` in `eisenwald.siedlung` (nicht gegen main geprüft).
- `kit/germanen/dach`: 4.156 Dreiecke (Vertrag 3.200), nur noch Warnung.

## Nächste Schritte, in Reihenfolge
1. Teil A sichtbar prüfen: `node tools/ort01-shots.js --lp helix.station,b7.aussenstelle,methalle.siedlung --out shots/ort01-a` und `--arten station,aussenposten --seeds 1,2,3`; Kronen, Böden, Verfall-/Umkämpft-Paletten (b7 verfallen) ansehen.
2. Punkt 4: Daten in `rollen/station.json`/`aussenposten.json` ergänzen (`zug_gross` ab Fläche 49, `pflicht: true` an allen `leit`-Einträgen, Kommando-Germanen ohne festen Thron: `leit.kontrollraum.station` in `germanen.json` entfernen oder per Variante lösen, Rom `reaktor.leitung`/`lager.ladebank` pflicht); danach Layout-Parität und Baseline neu.
3. Punkt 5 testen (Modul-Karte mit Sprengpunkt, Hash-Vergleich).
4. Punkt 6a: `kit.js` `leitPlan` (~884): Leitstück-Rechteck darf keine Anker-/Weg-/Türkachel treffen (Wachturm: freie Ecke oder entfällt); Landeplatz flach (≤ 0,08 m), Modelle in Voxelwerk-Int umschreiben (`ort/rom|germanen/aussenposten/landeplatz`); `silhouetteFehler` auf `bauweise.leit` erweitern.
5. 6b, 6e, Punkt 8 (Screenshot-Werkzeug), CONTRACT-ROLLEN-ORT.md angleichen.
6. **Teil B1:** Anker-Modelle aus `voxelwerk-ort01-anker` (Anleitung `C:\Users\Luciu\projects\voxelwerk-ort01-anker\ANKER-VERDRAHTUNG-ORT01.md`) in `ort01-int` mergen und in `bauweisen/*.json` (`anker.*`) verdrahten, dann `npm run assets` (eigener Commit).
7. **Punkt 7:** Prüf-Sperre (keine `*/ruine/*`, `truhe`, `kaefig_zelle`, `werkzeug`, keine `prop/germanen/*` in Rom) in `check:assets`/Rollen-Prüfung als Fehler anlegen, mit Schalter, erst nach Schritt 6 aktivieren; Test mit Mutationsprobe.
8. Alle Gates: Karten-Hash 72/72, Baseline mit Grund neu, `npm test`, `npm run check`, `check:assets`, `snap:mess`, Golden frisch gegen `Pantheon-main` mit `--dir`, Kaltbau je Kartenart (ruhiger Rechner), Dreiecke je Bühne (Außenposten ≤ 416 k × 1,10), Screenshots aller vier Kombinationen und Bestandskarten, danach `npm run assets` als eigener Commit.
