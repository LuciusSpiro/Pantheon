# ORT-01 Paket 5 Teil B1 (Anker-Optik): Übergabe

Stand: 13 Modelle gebaut (Voxelwerk-Branch ort01-anker), Manifest assets/manifest/ort-anker.json (13 Eintraege, check:assets --vw 0 Fehler), lokal im Spiel probiert und verworfen (Bauweisen-Eintraege und public/voxel nicht committet).

Befund, Tabelle, Bauliste und Eintragszeilen: `C:\Users\Luciu\projects\voxelwerk-ort01-anker\ANKER-VERDRAHTUNG-ORT01.md`.

## Wichtigste Erkenntnisse
- Ein Anker-Modell braucht nur einen `state`-Parameter, dessen Index der Zustandsliste in `content/buehnen/anker.json` entspricht (kit.js `Math.max(0, zst.indexOf(nm))`). Keine Code-Änderung nötig.
- Auf Station/Außenposten stehen heute Ruine-/Altstücke: Rom bei allen Ankern (Ruine) außer `abholpunkt` (Bake ohne `state`); Germanen `truhe`, `kaefig_zelle`, `thing_stein`, `runenstein_terminal`, `runenmast`/`schmiedeherd_reaktor_2x2` (nur 3 Zustände, `sprengpunkt` hat 4).
- `fund`, `raetsel`, `flagge` erscheinen auf Station/Außenposten nicht.
- Auch Leitstücke sind Altstücke (`statue_platz` beide Kulturen, germ. `schmiedeherd`/`hochsitz_halle`), aber kein Gameplay-Anker.

## Nächste Schritte (Integration)
0. Eintragszeilen aus ANKER-VERDRAHTUNG-ORT01.md in bauweisen/rom.json und germanen.json uebernehmen; npm run assets; Rollen-Daten: zellen.feldzelle streichen (Leiter-Entscheidung).

(Alt, teils erledigt:)
1. Modelle laut Bauliste bauen (zuerst terminal und zelle, dort gibt es Vorlagen; ziel, beute, sprengpunkt neu).
2. `assets/manifest/ort-anker.json` (Format `ort-2a.json`), `npm run check:assets -- --vw` mit `VOXELWERK_PATH`.
3. Szenen mit allen Zuständen nebeneinander, 3 Kameras, `hall_metall`/`planet_day`; Selbstkritik zu Abnahme 8.
4. Lokaler Probe-Test mit gesetzten Bauweisen-Einträgen (`tools/ort01-shots.js --raeume`), danach `git checkout` von `content/buehnen/bauweisen` und `public/voxel`.
5. Verdrahtung in `bauweisen/*.json` macht der Integrationsentwickler.

## Offene Fragen
- Soll `ziel` 1×1 bleiben (vorgeschlagen, kein Platzproblem) oder 2×2 wie bisher?
- Die Rolle `zellen.feldzelle` (leit) und der `zelle`-Anker ergäben zwei Zellen im Raum; die Integration muss das abstimmen.
- Statue und Hochsitz als Leitstück ersetzen (eigener Auftrag)?

## Technik
Playwright liegt in `Pantheon-main/node_modules` (`PLAYWRIGHT_CORE=C:/Users/Luciu/projects/Pantheon-main/node_modules/playwright-core`), Voxelwerk-Server per `PORT=3461 node server.js`, Chromium 1234 vorhanden.
