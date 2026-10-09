# CONTRACT-B1 – Bühnen: modulare Außenkarten und Anbindung an den Spielleiter

Ergänzung zu:
- `CONTRACT.md`, `CONTRACT-M0.md` bis `CONTRACT-M4.md`
- `CONTRACT-S1.md`, `CONTRACT-S2.md` (inkl. §8b–§8d), `CONTRACT-S2B.md`

Vorhandene Feldnamen werden nicht gebrochen. Bei Widerspruch gilt der Code. Abweichungen und Namenskonflikte meldet jedes
Team an die Studioleitung (SendMessage an „main“) und löst sie nicht selbst.
**§1 (Teams, Wellen, Welle 0, Ports), §3 (Vokabular), §8 (Weltstand v3) und §13 (Berichtspflicht) gelten für das ganze
Paket B1–B3.** `CONTRACT-B2.md` und `CONTRACT-B3.md` verweisen darauf.

- Briefing: Vault `Coop-Spiel/Briefing Bühnen & Bodenkampf.md` · Entscheidungen: `concept/buehnen/ENTSCHEIDUNGEN.md` (Nr. 1–36)
- Inhalte: `concept/buehnen/INHALT.md` (Lead GD: Platztypen, Module, Schablonen, Landepunkte, Fraktionen, Lexikon, Startwerte)
- Assets: `concept/buehnen/ART-PLAN.md` (Art Director: Art-Teams, Voxelwerk-Systeme, Asset-IDs)
- **Rangfolge bei Widerspruch:** Dieser Vertrag (Vokabular, Formate, Schnittstellen) > INHALT/ART-PLAN (Inhalte, Mengen,
  Asset-Namen) > Konzepte. §3.4 entscheidet die Vokabular-Wünsche aus INHALT §11 und ART-PLAN §5 verbindlich.

## 0. Ziel und Entscheidungen

**Ziel.** Der Spielleiter baut regelmäßig Bodenszenen auf neuen, wechselnden Karten. Außenkarten entstehen aus
**fraktionsneutralen Modulen**:
- ASCII-Grundriss mit semantischen Kacheln
- eine Ankerebene
- Deckungsbelegungen

Eine **Bauweise** malt sie an, **Besitz** und **Zustand** überziehen sie. Umsetzungen binden an **Anker und Kartenart, nie
an Karten-IDs oder Koordinaten**.
**Leitlinie Kai: Systeme vor Handarbeit, Asset-Erzeugung stark parallelisieren.** Vokabular, Werkzeug, Werkstatt, Galerie
und Kit-Renderer entstehen vor bzw. neben den Kits.

**Verbindlich (Briefing §3/§9 und Entscheidungen):**
1. Vier Kartenarten, alle modular, Raster aus Zellen à 8×8 Kacheln:

   | Kartenart | Größe | Bauweise |
   |---|---|---|
   | Außenposten | 72×40 (9×5 Zellen) | `germanen` |
   | Raumstation | 48×24 (6×3) | `germanen` |
   | Ruine | 64×40 (8×5) | `rom`, Zustand `verfallen`: altes Grenzkastell |
   | Schiff | 2 Decks à 37×13 (Atlas 37×29), Steckplätze statt Zellen | `germanen` |

2. **Schablonen 3/3/3/2**, spiegelbar. 3 Varianten je Kernplatz, 2 je Füllplatz + Deckungsbelegungen (E1). Umfang laut
   INHALT: 132 Module, davon 6 Signaturmodule. Kürzungsreihenfolge siehe §5.6.
3. Modul = Daten. Art liefert Kits mit Autotile, keine fertigen Modul-Meshes (E2).
4. **Bodenquote:** mindestens jede zweite gespielte Mission und jede lange Mission hat eine Bodenszene.
   - Verstoß = Prüfer-**Fehler** mit einer Nachbesserung. Ohne Boden nur mit `ohne_boden_grund` (E3).
   - „Lang“ ab 25 min, gemessen als größerer Wert aus Zieldauer und Summe der Szenendauern (E5).
   - Eine lange Mission (25–35 min) je Angebotsrunde (E4).
5. 2 neue Archivmissionen mit Bodenszene auf neuen Karten (E6).
6. **Ladung und Download light** (E halten, Countdown, Abbruch bei Treffer), ohne Werkzeuge (E7).
7. **Schiffskarte:** Ein kampfunfähiges Feindschiff kann betreten werden, treibende Wracks sind Landepunkte. Die volle
   Enterregel kommt **nicht** (E8).
8. **Schiff mit zwei Decks; Fallback ein Deck ist erlaubt** (E9, §5.5).
9. Kampf v2 gilt auf allen Außenkarten. **Ausnahme Tutorial** (E28, §0.1).
10. Der Spielleiter wählt Kartenart, Besitz und Landepunkt, **nie Koordinaten**. Er darf `neu: true` (neuer Seed)
    anfordern und erfindet keine Module. Der Weltstand merkt sich je Landepunkt Seed und Zustände.
11. Die Kesh-Umsetzungen laufen in der Ruine (Rom):
    - `zwei_schluessel` = Zwei-Offiziers-Schloss
    - `fund_aus_gewoelbe` = Legionskasse

    Die Wrack-Umsetzungen laufen auf Station und Schiff.
12. Landepunkte nach INHALT §6. Davon abweichend behalten die **Handkarten ihre IDs** `platform`, `wreck`, `kesh` (§6.1).
    **Rostnest (0107):** Landepunkte stehen als Daten mit `gesperrt: true` in der Datei und sind in B1–B3 nicht
    anfliegbar (E33).
13. Direktstart Testgelände mit Kartenart/Bauweise/Besitz/Zustand/Seed für die Karten-QA. Der Prüfstein (6 Live-Missionen)
    läuft im Saumraum (E36).
14. Der 2D-Fallback zeigt die neuen Inhalte nicht: Neue Karten erscheinen dort nur als Flachraster nach Kachelart, ohne Art
    und ohne neue Figuren (E35).

### 0.1 Tutorial-Schutz (E28/E29)
- **Plattform und Wrack behalten den alten Kampf (`away.js`), solange das Tutorial läuft.** Das gilt, bis
  `weltstand.tutorial` erledigt ist oder die Kampagne ohne Tutorial gestartet wurde. Danach gilt bei jedem neuen Betreten
  bzw. nach `map_reset` Kampf v2 (Laufzeitfeld `aw.kampf: 'alt' | 'v2'`). E28 nennt nur m1. Der Wrack-Abstecher
  während des Tutorials wird gleich behandelt, damit der Golden-Vergleich hält.
- Kesh bleibt Handkarte mit Kampf v2. Die Kesh-Logik in `combat.js` (Störrelais, Schlüssel, Tor, Tafel) bleibt in B1
  **unverändert** und wird über Anker-Adapter (§6.3) angesprochen.
- m1–m3 verwenden weiter `platform`, `wreck`, `kesh`. An den Tutorial-Büchern ändert sich nichts.
- Faltsprung im Tutorial: `CONTRACT-B3.md` §0.1.

**Nicht in B1:**
- Waffen, Gegnerrollen, Schleichen (→ B2)
- Hexkarte (→ B3)
- volle Enterregel und Enterabwehr
- G1 (freie Generierung, Terrain-Biome)
- Siedlung/Markt, Werkzeuge, Shop, Ruf
- Freischalten von Rostnest
- Verschleppung zwischen Karten

**Nicht brechen:**
- `npm run check`, `npm test` (alle Suiten inkl. `--strict`), `npm run sim`, `tools/ws-smoke.js`, `npm run check:assets`.
- **Golden-Vergleich m1–m3 ohne Allow-Liste:** `node tools/golden-trace.js --compare tools/fixtures/golden/base <neu>`.
  B1 ändert an m1–m3 nichts.
- **Snapshot im Spiel < 13 KB**, gemessen auf dem Außenposten (72×40) mit 3 Spielern und 12 Gegnern. Das Ereignis
  `awayMap` ist ≤ 8 KB und wird nur beim Betreten gesendet.
- Weltstände v1/v2 laden weiter (Migration auf v3, §8).
- Die Kontext-Goldens werden **einmal bewusst** mit `--update` erneuert (SPIELLEITER, im Bericht nennen).
- `STRICT_BAUSTEINE=1` ist am Ende grün.

## 1. Teams, Dateibesitz, Wellen (gilt für B1–B3)

### 1.1 Teams (Spiel-Repo)
Grundregeln:
- Kein Team ändert fremde Dateien. Keine Commits durch Teams.
- Dateien nur mit Edit/Write (Umlaute!), Shell PowerShell.
- Die **Voxelwerk-Teams** (SYS-KERN, SYS-FIGUREN, SYS-PRUEF, SYS-EDITOR, SYS-GERUEST, ART-\*) arbeiten nach `ART-PLAN.md`
  §2 und berühren das Spiel-Repo nur in den dort und hier genannten Dateien.

| Welle | Team | Stufe | Dateien (nur diese ändern) |
|---|---|---|---|
| 0 | Studioleitung | alle | siehe §1.2 |
| 1 | **BUEHNE** | B1 | **neu** `shared/buehne.js`, `shared/buehne-kennzahlen.js`, `server/sim/landepunkte.js`, `server/sim/anker.js`, `content/buehnen/zustaende.json`, `content/welt/landepunkte.json` (Format + Einträge nach INHALT §6); `server/world.js`; `shared/maps.js` (nur `MAP_ANCHORS`, `inArea` mit `rects`); `tools/check-maps.js`, **neu** `tools/buehne.js`, `tools/test-buehne.js` |
| 1 | **WERKSTATT** | B1 | **neu** `public/werkstatt.html`, `public/galerie.html`, `public/js/werkstatt/**`, `server/werkstatt.js` (Speicher-Route, nur mit `WERKSTATT=1`) |
| 1 | **KITS-AUSSENPOSTEN-RAND** | B1 | `content/buehnen/aussenposten/module/aussenposten.{tor,zaunluecke,abfluss,palisade,hof,wachturm,gelaende,huegel}.*.json` |
| 1 | **KITS-AUSSENPOSTEN-KERN** | B1 | `content/buehnen/aussenposten/module/` (alle übrigen Typen), `content/buehnen/aussenposten/schablonen/**` |
| 1 | **KITS-STATION** | B1 | `content/buehnen/station/**` |
| 1 | **KITS-RUINE** | B1 | `content/buehnen/ruine/**` |
| 1 | **KITS-SCHIFF** | B1 | `content/buehnen/schiff/**` |
| 1 | **BODENKAMPF** | B1→B2 | `server/sim/{combat,squad,away,interior}.js`, `shared/physics.js` (nur Ergänzungen), `tools/test-combat.js` |
| 1 | **WAFFEN** | B2 | **neu** `server/sim/waffen.js`, **neu** `tools/test-waffen.js` |
| 1 | **ENGINE** | B1–B3 | `server/mission/{checker,objects,registry,katalog,loader}.js`, `server/mission/bausteine/{welt,buehne,sektor,bodenkampf}.js`, `server/sim/{mission,arena}.js`, `server/game.js`, `server/index.js`, `server/weltstand.js`, `content/schema/**`, `content/katalog/schema/**`, `content/regiebuch/regiebuch.schema.json`, `shared/protocol.js` (**alleiniger Stift**, andere melden ihre Felder), `tools/test-{regiebuch,weltstand,bausteine}.js`, `tools/fixtures/weltstand/**` |
| 1 | **ENTERN** | B1 | **neu** `server/sim/entern.js`, **neu** `tools/test-entern.js` |
| 1 | **SEKTOR** | B3 | `content/welt/limes.json`, **neu** `shared/sektoren.js`, `shared/locations.js`, `server/sim/{explore,sprung}.js`, `tools/{check-sektoren,test-sektoren}.js` |
| 1 | **KARTE** | B3 | `public/js/starmap.js` |
| 1 | **VOXEL** | B1/B2 | `public/js/voxel/**` **außer** `fx.js` (**neu** `kit.js`, `deko.js`; `away.js`, `actors.js`, `loader.js`, `renderer.js`, `boot.js`) |
| 0–1 | **FX** (ART-PLAN) | B2 | `public/js/voxel/fx.js` (allein) |
| 0–1 | **UI-ART** (ART-PLAN) | B2/B3 | **neu** `public/js/icons-b.js` |
| 0–2 | **ART-PALETTEN** (ART-PLAN) | B1 | `content/buehnen/paletten/**` (+ Voxelwerk-Paletten) |
| 2 | **ART-GK-BAU**, **ART-AUSSENPOSTEN**, **ART-STATION**, **ART-SCHIFF**, **ART-RUINE** (ART-PLAN) | B1 | Voxelwerk-Kits; im Spiel `content/buehnen/bauweisen/<bauweise>.json` (germanen: ART-GK-BAU, rom: ART-RUINE), `content/buehnen/deko/<bauweise>.json` (gleiche Aufteilung), `assets/manifest/<team>.json` |
| 1 | **PIPELINE** | alle | `tools/sync-assets.mjs`, `tools/check-assets.mjs` (Sockets aus Rezepten, Vollständigkeit der Bauweisen-Tabellen, §10) |
| 1–2 | **AUDIO** | B2 | `public/js/audio.js`, `public/audio-preview.html` |
| 2 | **KATALOG** | B1/B2 | `content/katalog/{molekuele,szenentypen,gegner,fraktionen}/**`, `content/buehnen/lexikon/**`, `content/regiebuch/bausteine.json`, `content/spielleiter/archiv/**` |
| 2 | **SPIELLEITER** | B1/B2 | `server/mission/{spielleiter,szenenbau,context,llm,archiv,ablage}.js`, `content/spielleiter/prompts/**`, `tools/{test-spielleiter,test-llm-live}.js`, `tools/fixtures/{llm,context}/**` |
| 2 | **CLIENT** | B1–B3 | `public/index.html`, `public/js/{client,hud,consoles,render,net,dev-mock,art}.js`, `public/art-preview.html` |
| 2 | BODENKAMPF / WAFFEN (Fortsetzung) | B2 | wie Welle 1 (`CONTRACT-B2.md` §1) |
| 3 | **BOTS** | alle | `tools/{sim-headless,golden-trace}.js`, `tools/fixtures/golden/**` (nur neue Ordner) |
| 3 | **QA-INTEGRATION** | alle | alle; Golden, Balancing, Snapshot/Tick-Messung, Kits nachbessern |
| 4 | **QA-ABNAHME-B3**, **QA-ABNAHME-B1**, **QA-ABNAHME-B2** | je Stufe | alle; Browser-Runden, Live-Missionen (nur B1), README-Abschnitt |

**Reihenfolge:**
- **B3 ist zuerst abnehmbar.** Liefern müssen SEKTOR, KARTE, UI-ART (Sektor-Icons) und ENGINE (Weltstand/Protokoll).
  QA-ABNAHME-B3 startet, sobald diese gemeldet haben, auch während Welle 2.
- **KITS-\*** starten in Welle 1 sofort mit dem Format aus §5 und den Kernplatz-Modulen. Sie validieren, sobald BUEHNE
  „Werkzeug bereit“ meldet (`tools/buehne.js modul|bauen|sweep`). Das ist der erste Meilenstein von BUEHNE.
- **KATALOG** und **SPIELLEITER** starten, wenn ENGINE das Ankermodell (§6) und BUEHNE die erste baubare Kartenart
  (Ruine) liefern.

### 1.2 Welle 0 (Studioleitung, ein Durchgang)
1. **Verträge** `CONTRACT-B1/B2/B3.md`.
2. **Vokabular** (verbindlich, §3):
   - `content/buehnen/kacheln.json`
   - `content/buehnen/anker.json`
   - `content/buehnen/achsen.json` (Bauweisen, Besitz, Zustände, Kartenart → Standard-Bauweise)
   - Leerdateien `content/buehnen/bauweisen/{germanen,rom}.json` mit Format-Kopf (§10.2)
   - Verzeichnisgerüst `content/buehnen/{aussenposten,station,ruine,schiff}/{module,schablonen}/`,
     `content/buehnen/{paletten,deko,lexikon}/`, `content/welt/` (je `.gitkeep`)
3. **`shared/config.js` Startwerte** (neue Blöcke; die Teams stimmen danach nur in ihrem Block ab):
   - `buehne: { versuche: 20, backtrack: 200, deckungMin: 0.35, deckungRadius: 2, sichtgasseMax: 12, eingaengeMin: 2, abholpunkteMin: 1, sweepSeeds: 50, bestehensquote: 0.8, schiffDecks: 2, freiMin: 6 }`
   - `landepunkte: { transferRange: 360 }`
   - `anker: { halten: { terminal: 6, lesen: 2, sprengpunkt: 4, beute: 2, fund: 3, raetsel: 3, zelle: 3, versteck: 2, ziel: 3, schott_hacken: 6 }, countdown: 60, paarFenster: 1.5, paarSoloFenster: 15 }` (Werte aus INHALT §1.4)
   - `entern: { aktiv: true, transferRange: 300 }`
   - `spielleiter.boden: { langAbMin: 25, langMaxMin: 35, langeJeRunde: 1, wiederholtFenster: 3 }`
   - B2-Blöcke laut `CONTRACT-B2.md` §1.1, B3-Block laut `CONTRACT-B3.md` §1.1
4. **Schnitte (Delegationen mit unverändertem Verhalten)**, damit die Teams in eigenen Dateien arbeiten:
   - `server/sim/space.js`:
     - `selectDest`, `updateJump` und `doJump` wandern **wörtlich** nach **neu** `server/sim/sprung.js`. `space.js` ruft
       sie dort auf (gleiche Signatur und Exporte).
     - In `damageEnemy` vor dem Entfernen: `if (Entern.onEnemyZero(game, e)) return;`. Dazu **neu**
       `server/sim/entern.js` als Stub (`onEnemyZero` gibt `false` zurück).
   - **neu** `server/sim/waffen.js` als Stub `{ aktiv: false }` mit den Signaturen aus `CONTRACT-B2.md` §3.1 (sie werfen
     `Error('Vertrag')`).
   - **neu** `public/js/starmap.js` als Stub:
     - `StarMap.draw(ctx, view, rect, opts)` ruft die bisherige `drawStarMap` auf. `render.js` delegiert an
       `window.StarMap.draw`, wenn vorhanden.
     - Raumszene: Nach dem Zeichnen der Stationen ruft `render.js` `window.StarMap.drawSzene(ctx, cam, snap)`, wenn
       vorhanden.
     - Der Klick auf die Sternkarte in `consoles.js` ruft `StarMap.hit(x, y)`, wenn vorhanden.
     - Script-Tags für `starmap.js` und `icons-b.js` in `index.html`.
   - **neu** `public/js/icons-b.js` als Stub (`window.IconsB = {}`).
   - **neu** `server/werkstatt.js` als Stub. `server/index.js` bindet seine Route nur bei `WERKSTATT=1` ein.
   - **neu** Plugin-Stubs `server/mission/bausteine/{buehne,sektor,bodenkampf}.js` (`module.exports = () => {}`).
   - Der **Orte-Block aus `tools/check-maps.js`** (Abschnitt „M1: Orte“) wandert wörtlich nach **neu**
     `tools/check-sektoren.js`.
5. **`package.json`:**
   - `check` → `node tools/check-maps.js && node tools/check-sektoren.js`
   - `test` + `&& node tools/test-buehne.js && node tools/test-waffen.js && node tools/test-sektoren.js && node tools/test-entern.js`
   - neu:
     - `buehne` (`node tools/buehne.js`)
     - `test:buehne`, `test:waffen`, `test:sektoren`
     - `werkstatt` (`node --env-file-if-exists=.env server/index.js --debug`, Hinweis `WERKSTATT=1` im README-Abschnitt
       der Teams)
   - Die Stub-Werkzeuge `tools/{test-buehne,test-waffen,test-sektoren,test-entern}.js` geben „0 Prüfungen (Vertrag)“ aus
     und enden mit Exit 0.
6. Golden: `tools/fixtures/golden/base` bleibt Referenz. Nur B2 nimmt neu auf (`CONTRACT-B2.md` §0).

### 1.3 Testserver und Regeln
- **Spiel-Ports:**

  | Team | Port(s) |
  |---|---|
  | BUEHNE | 3370 |
  | WERKSTATT | 3371–3372 |
  | KITS-AUSSENPOSTEN-RAND / -KERN | 3373 / 3374 |
  | KITS-STATION / -RUINE / -SCHIFF | 3375 / 3376 / 3369 |
  | BODENKAMPF | 3377–3378 |
  | WAFFEN | 3379 |
  | ENGINE | 3380–3381 |
  | SEKTOR | 3382 |
  | KARTE | 3383 |
  | ENTERN | 3384 |
  | VOXEL | 3385–3386 |
  | CLIENT | 3387–3388 |
  | KATALOG | 3390 |
  | SPIELLEITER | 3391–3392 |
  | BOTS | 3393–3394 |
  | QA | 3395–3399 |
  | FX | 3330 (laut ART-PLAN) |
  | PIPELINE | 3368 |

  Voxelwerk-Teams nutzen die Ports aus ART-PLAN (343x/344x).
- **Nie 3300/3301/3310 (Demo), nie 3389 (RDP).**
- Immer `ROOM_CODE=off` und eigene Verzeichnisse: `WORLD_DIR=data/worlds-<team>`, `REGIE_DIR=data/regie-<team>`,
  `ERZEUGT_DIR` in ein Temp-Verzeichnis.
- Screenshots `shots/<team>/`, Playwright-Skripte unter `C:\tmp\pwtest\sts\b-<team>-*.js`.
- **Keine Live-LLM-Aufrufe** außer QA-ABNAHME-B1 (§12). Aufrufe in fremde Module defensiv, Fehler mit `game.countError`
  zählen, nie in den Tick werfen.

## 2. Ergebnisformat `Karte` (Vertrag für alle Erzeuger, auch G1)
Handkarten, Modul-Zusammenbau und später G1 liefern dieselbe Struktur. Sim, Prüfer, Spielleiter, Client und Werkstatt
kennen nur diese.
```js
Karte = {
  id,                      // = Landepunkt-ID ('kesh', 'splitter.schuerflager')
  erzeuger,                // 'hand' | 'modul/1' | (später 'g1/1')
  art,                     // 'aussenposten' | 'station' | 'ruine' | 'schiff' | 'hand'
  bauweise, besitz, zustand, seed, bauversion, schablone, spiegel,
  w, h,
  rows: ['…'],             // Zeichen aus content/buehnen/kacheln.json (Handkarten: eigene Legende)
  legende,                 // Zeichen -> Kachelinfo
  anker: [{ id, rolle, x, y, platz, bereich, art?, paar?, kette?, schwer?, ankunft?, deck? }],
  bereiche: { <id>: { name, rects: [[x, y, w, h], …], rolle: 'hinein'|'ziel'|'rueckzug'|null, gefecht: bool } },
  plaetze: { <platzId>: { typ, modul, lage, rect } },
  eingaenge: [ankerId], abholpunkte: [ankerId], ankunft: ankerId,
  patrouillen: [[ankerId, …]],                       // verkettete Wege (W4), vom Zusammenbau berechnet
  coverSpots: [{ x, y, cover }],
  decks: null | { stride: 16, links: [{ a: [x, y], b: [x, y], via: 'lift'|'leiter' }] },
  kanten: { <kantenId>: { a, b, typ, tiles: [[x, y], …] } },   // innere Anschlüsse (für Zustände)
  gelaende: null,                                    // reserviert für G1-Biome
  meta: { versuche, kennzahlen },
}
```
- `shared/buehne.js` (UMD, ohne Server lauffähig) exportiert:
  - `bauen({ art, schablone?, seed, bauweise, besitz, zustand, zustaende? }) → Karte`
  - `pruefen(karte) → { ok, fehler: [{ code, msg, x?, y? }], warnungen }`
  - `kennzahlen(karte)` (aus `buehne-kennzahlen.js`)
  - `modulLagen(modul)`
  - `kantenTyp(rows, seite)`
  - `hand(id)` (Handkarte als `Karte`)
  - `rng(seed)`
- **Determinismus:**
  - Eigener PRNG (mulberry32), nur Ganzzahlen.
  - Kandidaten nach `id` sortiert, kein `Math.random`, keine Abhängigkeit von der Reihenfolge der Objektschlüssel.
  - Test: gleiche Eingabe ⇒ gleicher Hash über `rows` + `anker` in Node und im Browser (Galerie).
- `bauversion` = kurzer Hash über alle Module und Schablonen der Kartenart.
- Der Client würfelt nie. Er erhält die kompilierte Karte über das Ereignis `awayMap` (§9) und registriert sie in
  `Shared_Maps`.

## 3. Vokabular (verbindlich für Code, KITS, Art und Lead GD)

### 3.1 Semantische Kachelarten – `content/buehnen/kacheln.json`
- Fraktionsneutral. Die Bauweisen-Tabelle (§10.2) ordnet jeder `kind` ein Kit-Teil zu.
- `cover`: 1 = halb (Sicht frei, `low`), 2 = voll (sperrt Sicht).
- Spalte „Kante als“: So zählt die Kachel bei der Kantenableitung (§3.2).

| Zeichen | `kind` | fest | cover | Sicht | Zustände (erster = Start) | Kante als | Hinweis |
|---|---|---|---|---|---|---|---|
| `.` | `boden` | – | – | frei | – | begehbar | Standardboden (Platte) |
| `,` | `boden2` | – | – | frei | – | begehbar | zweiter Belag (Weg, Planke, Gitterrost) |
| `:` | `gelaende` | – | – | frei | – | begehbar | Außenboden (Frost, Schlamm, Sand) |
| `^` | `plateau` | – | – | frei | – | begehbar | Aussichtsplateau (E27). **Nur von `k` und `/` umgeben** (`K-PLATEAU`) |
| `/` | `rampe` | – | – | frei | – | begehbar | einziger Zugang zum Plateau |
| `k` | `kante` | ja | 1 | frei | – | fest | Plateaurand, Brüstung |
| `#` | `wand` | ja | 2 | sperrt | – | fest | Innen- und Außenwand, Kastellmauer, Schiffswand |
| `=` | `zaun` | ja | 2 | sperrt | – | fest | Palisade, Außengrenze (Kit-Teil eigenes Aussehen) |
| `z` | `gitter` | ja | 0 | frei | – | fest | Gitterzaun, Zellengitter (sperrt Bewegung, nicht Sicht und Schüsse) |
| `|` | `fenster` | ja | 0 | frei | – | fest | nur Station/Schiff, Schüsse werden gestoppt |
| `F` | `fels` | ja | 2 | sperrt | – | fest | Gelände, Kartenrand außen |
| `~` | `abgrund` | ja | 0 | frei | – | fest | Weltraum, Schlucht, Wasser |
| `_` | `leere` | ja | 2 | sperrt | – | fest | Deck-Lücke im Atlas, außerhalb der Karte |
| `o` | `deckung_halb` | ja | 1 | frei | – | fest | Kisten, Barrikade, Schildwall, Mauerrest |
| `O` | `deckung_voll` | ja | 2 | sperrt | – | fest | Stapel, Tanks, Container |
| `I` | `pfeiler` | ja | 2 | sperrt | – | fest | Säule, Stütze, Mast |
| `x` | `truemmer` | ja | 1 | frei | – | fest | nur aus dem Zustand-Überzug |
| `X` | `schutt` | ja | 2 | sperrt | – | fest | nur aus dem Zustand-Überzug |
| `D` | `tuer` | je Zust. | – | je Zust. | `offen`, `zu`, `verschlossen`, `gesprengt` | Tür | `zu`/`verschlossen` = fest und sperrt Sicht |
| `S` | `schott` | je Zust. | – | je Zust. | `zu`, `offen`, `gehackt`, `verschlossen` | Tür | hackbar über einen `eingang`-Anker (`art: technisch`) |
| `G` | `tor` | je Zust. | 2 | je Zust. | `zu`, `offen`, `gesprengt` | Tür | großes Tor (2–4 breit), Eingang laut |
| `L` | `luke` | je Zust. | – | je Zust. | `zu`, `offen` | Tür | Abfluss, Wartungsschacht, Eingang technisch |
| `w` | `wand_schwach` | je Zust. | 2 | je Zust. | `intakt`, `offen` | fest | nur mit Anker `versteck` |
| `P` | `pad` | – | – | frei | – | begehbar | optional: Pad-Optik am `abholpunkt` |

- **Interaktionsobjekte sind keine Kacheln, sondern Anker** (§3.3). Unter einem Objektanker steht eine begehbare Kachel.
  Das Objekt macht sie zur Laufzeit fest, wenn `anker.json` das sagt.
- **Lift und Leiter sind Anker** (W7), keine Kacheln.

### 3.2 Anschlüsse
Ein Anschluss liegt in der Mitte der Zellkante (Index 3 und 4 bei 8 Kacheln). Der Typ wird aus den Kacheln **abgeleitet**,
in dieser Reihenfolge:

| Typ | Bedingung |
|---|---|
| `tuer` | eine Mittelkachel ist Tür-Art (`D`, `S`, `G`, `L`) |
| `frei` | ≥ `freiMin` (6) von 8 Kantenkacheln begehbar **und** beide Mittelkacheln begehbar (W14) |
| `offen` | beide Mittelkacheln begehbar |
| `wand` | sonst |

**Verträglich:**

| | `offen` | `tuer` | `wand` | `frei` |
|---|---|---|---|---|
| `offen` | ja | ja | – | ja |
| `tuer` | ja | ja | – | ja |
| `wand` | – | – | ja | ja |
| `frei` | ja | ja | ja | ja |

(`wand↔frei`, `tuer↔frei` nach W13, `offen↔frei` ergänzt.) **Kartenrand:** `wand`, `frei` (vor `F`/`=`/`~`) oder `abgrund`.
**Schiff:** Anschluss = Längsgang in Zeile 6 (Pflicht), Zeilen 2 und 10 optional, gleiche Ableitung.

### 3.3 Ankerrollen – `content/buehnen/anker.json`
| Rolle | Objekt (Prop über die Bauweisen-Tabelle) | Zustände (erster = Start) | Interaktion (Zeit `CONFIG.anker.halten`) | Attribute und Regeln |
|---|---|---|---|---|
| `eingang` | – (vor bzw. auf Tür, Schott, Tor, Luke oder Lücke) | `offen`, `verschlossen` | `art: technisch` auf `S`: Schott hacken (`schott_hacken`) → `gehackt` | **`art: laut\|leise\|technisch`**. Der Platz darf `art` setzen und überschreibt damit das Modul (W9) |
| `abholpunkt` | `bake` | `bereit`, `gestoert` | – | 3 freie Kacheln in L-Form. **`ankunft: true` genau einmal je Karte**: Nur dorthin wird hinuntergebeamt (W6), hinauf von jedem `abholpunkt` |
| `wache` | – | – | – | Posten der Besetzung. **`schwer: true`** = Wächter-Platz (W10) |
| `patrouille` | – | – | – | **`kette`** (Buchstabe). Der Zusammenbau verbindet Ketten benachbarter Plätze über offene, `frei`- und Tür-Kanten zu `karte.patrouillen` (W4) |
| `deckung` | – | – | – | optional: Vorzugsplatz der KI |
| `terminal` | `terminal` | `bereit`, `laedt`, `geladen`, `gesperrt` | **Download** (`terminal`): Abbruch bei Treffer, Fortschritt bleibt. Lesen (`lesen`) für Logbuch | `kern?` (für `wissen_aufteilen`) |
| `sprengpunkt` | `sprengziel` | `intakt`, `scharf`, `zerstoert` | **Ladung** scharf machen (`sprengpunkt`), Abbruch bei Treffer setzt zurück. Danach `countdown` s → `zerstoert`, Explosion (Fläche r 2) | braucht Inventar `ladung` (Baustein `ladung_geben`) |
| `zelle` | `zelle` | `zu`, `offen` | öffnen (`zelle`) | Gefangene (NSC, Crew beim Ausbruch) |
| `beute` | `kiste` | `voll`, `leer` | bergen (`beute`) | mehrfach. Beim Ausbruch liegt hier die Ausrüstung (B2) |
| `ziel` | `ziel` | `frei`, `genommen`, `aktiviert` | halten (`ziel`) | allgemeines Halteziel (Ventil, Flagge, Konsole) |
| `fund` | `sockel` | `da`, `genommen` | bergen (`fund`) | Name über das Lexikon |
| `tor` | – (auf `D`/`S`/`G`/`L`) | `zu`, `offen`, `verschlossen`, `gesprengt` | – (öffnet über Bausteine, ein gelöstes Rätselpaar oder `eingang`-Hacken) | **allgemeiner verschließbarer Durchgang** (W11). Der Zustand steuert die Kachel. Name aus dem Lexikon |
| `raetsel` | `schloss` | `ruhe`, `gehalten`, `geloest` | halten (`raetsel`). Beide eines Paars im `paarFenster` → `geloest` | **`paar`** im Modul **oder** über die Schablone (`paare`, W8). Genau 2 je Paar |
| `aussicht` | – (auf `^`) | – | – | Sicht über 10 Kacheln (B2) |
| `nsc` | – | – | – | Platz für `spawn_person` |
| `versteck` | – (vor `w`) | `zu`, `offen` | öffnen (`versteck`), `w` → `offen` | nur nach Weitscan markiert (W5). Optional Beute dahinter |
| `lift` | `lift` | – | E tippen → anderes Deck | **`deck: 1\|2`**, paarweise übereinander (W7) |
| `leiter` | `leiter` | – | E halten → anderes Deck | **`deck: 1\|2`**, paarweise übereinander (W7) |

- **IDs global:** `<platz>.<rolle>` bzw. `<platz>.<rolle>.<n>`. Kanten: `<platzA>~<platzB>`.
- **Bereiche:** `hinein`, `ziel`, `rueckzug`. Dazu markiert die Schablone eine Liste `gefecht` (Plätze, in denen gekämpft
  wird).
- **Ankerdichte und Platzregeln** (Anker nie auf festen Kacheln, nie in Türkacheln, nie in der 2-Kachel-Kantenmitte):
  INHALT §1.5.

### 3.4 Entscheidungen zu den Vokabular-Wünschen (INHALT §11, ART-PLAN §5)
| Wunsch | Entscheidung | Umsetzung / Grund |
|---|---|---|
| GD W1 Platzfeld `richtung` | **angenommen** | Module in Grundlage N (Außenkante oben). Der Zusammenbau probiert nur Lagen, deren Außenkante zur `richtung` zeigt. Spiegeln entlang dieser Achse bleibt erlaubt |
| GD W2 Arbeitslegende als Kit-Legende | **angenommen mit Änderungen** | Zeichen nach INHALT übernommen (`F`, `^`, `/`, `z`, `_`, `w`, `I`). **Abweichungen:** `kind` `saeule` heißt `pfeiler`, `rampe` bleibt `/`; neu sind `k` (Plateaukante: sonst wäre das Plateau von allen Seiten betretbar), `=` Zaun, `G` Tor, `L` Luke, `|` Fenster, `:` Gelände, `x`/`X` Überzug. `^` ist Plateau, deshalb sind Lift/Leiter Anker |
| GD W3 Deckungsstempel | **angenommen** | Feld heißt `belegungen` (§5.1) |
| GD W4 `patrouille` + `kette` | **angenommen** | Verkettung berechnet der Zusammenbau (`karte.patrouillen`) |
| GD W5 `versteck` + `w` | **angenommen** | – |
| GD W6 `abholpunkt.ankunft` | **angenommen** | Ersetzt meinen Vorschlag „Ankunft je Eingang“. Der Ansatz (laut/leise/technisch) ist dann ein Weg zu Fuß ab der Ankunft. `CONFIG`-Feld `landungKacheln` entfällt |
| GD W7 `lift`/`leiter` als Anker | **angenommen** | – |
| GD W8 Paare über Plätze | **angenommen** | Schablonenfeld `paare: { "A": ["fluegel_w", "fluegel_o"] }` setzt das Paar der `raetsel` ohne Paar in diesen Plätzen |
| GD W9 `eingang.art` durch den Platz | **angenommen** | Platzfeld `eingang_art` |
| GD W10 `wache.schwer` | **angenommen** | Die Rolle `waechter` entfällt. Kesh-Adapter: Wächter = `wache` mit `schwer` |
| GD W11 `tor` allgemein | **angenommen** | – |
| GD W12 `{{lex.<schluessel>}}` | **angenommen** | Ablage `content/buehnen/lexikon/<bauweise>.json` (INHALT §8), Besitz KATALOG |
| **GD W13** Verträglichkeit `wand↔frei`, `tuer↔frei` | **angenommen** | + `offen↔frei` (§3.2). Kein technischer Grund dagegen: BFS und Prüfung fangen unerreichbare Gebäude ab |
| **GD W14** `frei` tolerant | **angenommen** | ≥ `freiMin` (6) von 8 begehbar **und** Mitte frei (§3.2) |
| AD 1 Kachelarten `zaun`, `tor`, `luke` | **angenommen** | `=`, `G`, `L`. Zaun zählt als `wand`, Tor und Luke als `tuer`. Zusätzlich `gitter` `z` (Sicht frei) für GD-Zellengitter. Art liefert dafür `kit/<bw>/gitter` (klein, ersatzweise schlankes `zaun`) |
| AD 2 einheitliche Kit-Parameter | **angenommen, ein Zusatz** | `conn, cut, zustand, art, seed` für alle Kit-Teile. **Zusatz `state`** (Index in den Zuständen der Kachelart) für `tuer`, `schott`, `tor`, `luke`, `wand_schwach`. Statt `open`/`blown`: ein Feld für alle zustandsbehafteten Teile. Boden: `belag` 0–3 (§10.1) |
| AD 3 Sockets im Rezept | **angenommen** | PIPELINE übernimmt das Feld `sockets` aus Voxelwerk-Rezepten in das Spiel-Manifest. Der Manifest-Eintrag hat Vorrang |
| AD 4 Bauweisen-Tabelle gehört Art | **angenommen** | `content/buehnen/bauweisen/<bauweise>.json` (§10.2). Die Achsen-IDs (`achsen.json`) bleiben bei der Studioleitung |
| AD 5 Platztyp `herzstueck` | **angenommen** | Platztyp `herzstueck` (2×2, Signatur) in Schablonen. Die Belegung kommt über `leit` der Bauweisen-Tabelle bzw. Signaturmodule (`bauweise`-Filter) |
| AD 6 Deko-Regeln als Art-Daten | **angenommen** | `content/buehnen/deko/<bauweise>.json`. VOXEL-`deko.js` wendet an. **Deckung wird nie gestreut**, Deko nie auf Anker-, Tür-, Weg- oder Kantenmitte-Kacheln. Höchstens 12 Props je Zelle |
| AD 7 `fx.js` eigener Besitz | **angenommen** | Team FX (§1.1) |
| AD 8 getrennte Zustände im Snapshot | **angenommen** | `CONTRACT-B2.md` §8 (`zs`: `ok`, `verwundet`, `bewusstlos`, `gefesselt`, `gefangen`, `aus`) |
| GD-IDs `b7.plattform`, `wrack.zaunkoenig`, `kesh.mond` (INHALT §6) | **abgelehnt** | Die Handkarten behalten `platform`, `wreck`, `kesh`. Grund: Golden m1–m3 und alle bestehenden Bücher, Fakten und Weltstände nutzen diese IDs. Die neuen Landepunkt-IDs aus INHALT §6 bleiben unverändert |
| GD Teams KITS-OFFEN / KITS-INNEN | **ersetzt** | eine Kartenart je Team, Außenposten zwei Teams (§1.1), wegen 132 Modulen |
| Lärmradien (GD 18/10/4/3 vs. TL 14/8/3) | **GD-Werte** | `CONTRACT-B2.md` §1.1, per `tune` änderbar. Laute Waffen sollen spürbar alarmieren |

### 3.5 Achsen – `content/buehnen/achsen.json` (Studioleitung)
| Achse | Werte in B1–B3 | später | Wirkung |
|---|---|---|---|
| **Bauweise** | `germanen`, `rom` | `vorlaeufer`, `konkordat` | Kit-Teile, Props, Leitstücke, Lexikon, Palettenbasis, Stimmung (Bauweisen-Tabelle) |
| **Besitz** | `rostmeute`, `kontor`, `raubzug`, `herrenlos`, `kustoden`, `konkordat` (nur Handkarte B-7) | `rom` | Paletten-Überzug, Banner, Streuprops, Besetzung (Fraktion = Besitz, `CONTRACT-B2.md` §7), Funkstil |
| **Zustand** | `intakt`, `verfallen`, `umkaempft` (Kit-Parameter `zustand` 0/1/2) | – | Überzug (§5.4), Farbfilter. `umkaempft` setzt die Starthaltung `wach` |

**Standard-Bauweise je Kartenart:**

| Kartenart | Bauweise |
|---|---|
| aussenposten | `germanen` |
| station | `germanen` |
| schiff | `germanen` |
| ruine | `rom` |

Andere Kombinationen sind erlaubt, sobald die Bauweisen-Tabelle die Teile führt. `check:assets` meldet Lücken.

## 4. Werkzeuge (Systeme vor Handarbeit)
- **`tools/buehne.js`** (BUEHNE):

  | Befehl | Ergebnis |
  |---|---|
  | `modul <id>` | alle Lagen, abgeleitete Kanten, Fehler |
  | `bauen <schablone> <seed> [--bauweise --besitz --zustand]` | ASCII und Kennzahlen |
  | `sweep <schablone> [--seeds 200] [--json]` | Bestehensquote, Verteilung der Kennzahlen, schlechteste Seeds |
  | `alle` | alle Schablonen × `sweepSeeds` |
  | `typen <art>` | Platztypen der Schablonen gegen vorhandene Module (Zahl der Varianten) |

- **Kennzahlen** (`shared/buehne-kennzahlen.js`):
  - Deckungsanteil je Gefechtsplatz
  - längste Sichtgasse
  - Weglänge Ankunft → Ziel je Eingang
  - Zahl getrennter Wege zum Ziel
  - Engstellen
  - Sichtschatten je Bereich
  - Rückzug ≠ Eingang
- **Werkstatt** `public/werkstatt.html` (WERKSTATT):
  - Raster mit Zeichenpalette aus `kacheln.json`, Ankerebene mit Palette aus `anker.json`.
  - Belegungen umschalten, Kanten farbig, Drehen/Spiegeln-Vorschau, **Live-Prüfung** mit `shared/buehne.js`.
  - Schablonen-Ansicht: Plätze ziehen, Typ/Bereich/`richtung`/`eingang_art`/Paare setzen, sofort mit Seed bauen.
  - Speichern über `POST /werkstatt/save` (nur `WERKSTATT=1`, nur Pfade unter `content/buehnen/<art>/`, JSON gegen das
    Format geprüft) oder als Download.
  - Kein Undo-Verlauf, kein Mehrbenutzer.
- **Galerie** `public/galerie.html?art=station&seeds=1-24&bauweise=germanen&besitz=kontor&zustand=verfallen` (WERKSTATT +
  VOXEL):
  - Kacheln mit Vorschau (Voxel über den Kit-Renderer, 2D-Raster als Rückfall), Kennzahlen, rot markierte Fehlbauten.
  - Klick öffnet die Karte zum Umsehen.
  - Dient Art, Lead GD und der Abnahme „3 Seeds je Kartenart“ (ART-PLAN: 3 Seeds × 3 Zustände × 2 Besitzer).
- **Direktstart Testgelände** (ENGINE, `arena.js`):
  - `arena_away` mit `{ art, schablone?, seed, bauweise, besitz, zustand, fraktion?, staerke?, haltung? }`.
  - Aufruf über Lobby-Option bzw. `?arena=away&art=ruine&seed=3&bauweise=rom&besitz=herrenlos&zustand=verfallen`.
  - Ohne Parameter wie heute (Kesh).

## 5. Module und Schablonen (KITS-\*)
Inhalte, Platztypen, Pflichtsätze und Schablonen-Skizzen: INHALT §2–§5. Dateinamen nach INHALT §1.1:
- Module: `content/buehnen/<art>/module/<art>.<typ>.<variante>.json`
- Schablonen: `content/buehnen/<art>/schablonen/<art>.<name>.json`

### 5.1 Modul (Format `modul/1`)
```json
{ "format": "modul/1", "id": "station.korridor.a", "art": "station", "typ": "korridor",
  "groesse": [1, 1], "drehen": true, "spiegeln": true, "gewicht": 1, "bauweise": null,
  "rows":  ["8 Zeichen", "… 8 Zeilen je Zelle, Grundlage N (Außenkante oben)"],
  "anker": ["Overlay gleicher Größe, '.' = kein Anker"],
  "anker_legende": { "t": { "rolle": "terminal" }, "e": { "rolle": "eingang", "art": "technisch" },
                     "p": { "rolle": "patrouille", "kette": "a" }, "r": { "rolle": "raetsel" } },
  "belegungen": [ ["Overlay nur mit o/O/I auf Bodenkacheln"], ["zweite Belegung"] ] }
```
- `groesse` in Zellen: [1,1], [2,1], [2,2]. Schiff: `groesse: [breite, 13]` in **Kacheln** und `deck: 1|2`.
- `bauweise: null` = neutral. `["germanen"]` = Signaturmodul nur für diese Bauweise (kommt zur Pflichtvariante dazu).
- `belegungen`: 0–3 Deckungsbelegungen, der Seed wählt eine (Füllplätze 2–3).

### 5.2 Schablone (Format `schablone/1`)
```json
{ "format": "schablone/1", "id": "aussenposten.talsperre", "art": "aussenposten", "zellen": [9, 5],
  "spiegeln": ["x"], "fuellung": "fels",
  "plaetze": [ { "id": "tor_sued", "typ": "tor", "x": 4, "y": 4, "w": 1, "h": 1, "bereich": "hinein",
                 "kern": true, "richtung": "S", "eingang_art": "laut" } ],
  "bereiche": { "hinein": { "name": "Vorfeld" }, "hof": { "name": "Hof" } },
  "gefecht": ["hof_w", "hof_o"],
  "paare": { "A": ["fluegel_w", "fluegel_o"] },
  "kanten_fest": [ { "a": "halle", "b": "hof_ost", "typ": "tuer" } ],
  "pflicht": { "eingang": 3, "abholpunkt": 2, "sprengpunkt": 2, "aussicht": 1, "terminal": 1, "zelle": 2, "beute": 4, "ziel": 1, "wache": 6, "patrouille": 4 } }
```
- `pflicht` = **Kartenart-Pflichtsatz** (INHALT §2.1, §3.1, §4.1, §5.2). Damit läuft jede Umsetzung der Kartenart auf jedem
  Seed.
- `fuellung`: Kachelart bzw. Füllmodul-Typ für unbelegte Zellen.
- **Schiff:** statt `zellen` gilt `"decks": [ { "plaetze": [ { "id": "antrieb", "typ": "antrieb", "breite": 6, "fest": true }, … ] }, { … } ]`
  (Heck → Bug, gleiches Breitenraster auf beiden Decks, INHALT §5.1).

### 5.3 Zusammenbau
Ablauf in `bauen`:
1. RNG(`schablone.id`, `seed`), Spiegelung wählen.
2. Plätze belegen: 2×2 → feste Kanten → `richtung` → Rest. Kandidaten = Module mit passendem Typ, passender Größe,
   passender Bauweise (neutral oder gleich), alle erlaubten Lagen (bei `richtung` nur die passenden), gewichtet gemischt.
3. Passt eine Lage zu Nachbarn und Rand, wird sie gesetzt. Begrenztes Backtracking (`backtrack`).
4. Belegungen wählen.
5. Zustand-Überzug (§5.4) anwenden.
6. Gespeicherte `zustaende` aus dem Weltstand anwenden.
7. Kompilieren: Anker-IDs, Paare, `ankunft`, Bereiche, Patrouillen, `coverSpots` (verallgemeinerte `keshCoverSpots`), Decks.
8. `pruefen`.

Fehlschlag → `seed + 1`, höchstens `versuche` Mal. Der wirksame Seed wird gespeichert.

### 5.4 Zustand-Überzug – `content/buehnen/zustaende.json` (BUEHNE)
- `verfallen`: deterministisch aus dem Seed Trümmer (`x`/`X`) auf Füllplätzen, Türen teils `offen`/`gesprengt`, ein
  innerer Anschluss je Karte `verschlossen`.
- `umkaempft`: Trümmer im Gefechtsbereich, Starthaltung der Besetzung `wach`.
- `intakt`: nichts.

Der Überzug wird **vor** der Prüfung angewandt. Ein Überzug, der die Prüfung bricht, wird für diesen Seed verworfen.

### 5.5 Schiff: Fallback ein Deck
- `CONFIG.buehne.schiffDecks: 2 | 1`. KITS-SCHIFF baut so, dass **Deck I allein** den Pflichtsatz ohne `lift`/`leiter`
  erfüllt:
  - Eingang
  - `abholpunkt` mit `ankunft`
  - Ziel
  - `sprengpunkt`
  - `zelle`

  Notfalls über Deck-I-Varianten der festen Sektionen. Deck II ergänzt.
- **Entscheidung:** Die Studioleitung entscheidet am Ende von Welle 1 nach der Meldung von BODENKAMPF zu „Decks in der
  Außenzone“:
  - Lift/Leiter funktionieren
  - Sicht sperrt über `_`
  - KI und Bots finden Wege über Deck-Links

  Ist das nicht grün, gilt `schiffDecks: 1` für die Abnahme.

### 5.6 Umfang, Qualität, Kürzung
- Module laut INHALT:

  | Kartenart | Module |
  |---|---|
  | Außenposten | 38 |
  | Station | 29 |
  | Ruine | 32 |
  | Schiff | 33 |
  | **Summe** | **132** (davon 6 Signaturmodule) |

  Schablonen 3/3/3/2.
- **Qualitätsziel je Schablone:** Bestehensquote ≥ 80 % über die Seeds 1–200 (`sweep`). Kennzahlen:
  - Deckungsanteil im Gefechtsbereich ≥ `deckungMin`
  - Sichtgasse ≤ `sichtgasseMax`
  - ≥ 1 Sichtschatten je Bereich
  - Rückzug nicht nur über den Eingang
  - alle Pflichtanker von **jedem** Eingang erreichbar
- **Kürzungsreihenfolge** (INHALT §11; Prüfstein und Pflichtsatz bleiben erfüllt):
  1. dritte Varianten der Eingangstypen
  2. Füllmodule auf 1 Variante + 3 Belegungen
  3. `waffenkammer` (dann gibt es auf dem Schiff kein Rätselpaar)

  Kürzungen meldet das Team im Bericht.

## 6. Landepunkte, Objekte, Anker zur Laufzeit

### 6.1 Landepunkte – `content/welt/landepunkte.json`
```json
{ "format": "landepunkte/1",
  "orte": { "splitter": [ { "id": "splitter.schuerflager", "art": "aussenposten", "bauweise": "germanen",
      "besitz": "rostmeute", "zustand": "umkaempft", "seed": 306, "schablone": null,
      "beam": { "x": 2200, "y": 600, "range": 360 }, "name": "Schürflager",
      "frei": "nach_tutorial", "gesperrt": false } ] } }
```
- Einträge laut INHALT §6. Die Handkarten heißen `platform` (b7), `wreck` (wrack), `kesh` (kesh), mit `art: "hand"`.
  `scene.beam` in `locations.js` bleibt als Altname.
- `frei`: `immer` | `nach_tutorial` | `nach_raumgefecht`.
- Ort mit mehreren Landepunkten: Die Transfer-Konsole bietet alle freien in Reichweite an (cmd `transfer.ziel`).
- `gesperrt: true` (Rostnest) = nicht wählbar, Prüfcode `LANDEPUNKT-GESPERRT`.
- **Laufzeit** (`server/sim/landepunkte.js`):
  - `get(game, lpId)` baut die Karte bei Bedarf, registriert sie in `world.AWAY_MAPS` und legt `game.aways[lpId]` an.
    Höchstens 2 neue Karten liegen im Speicher, dazu die Handkarten. Verdrängt wird nach LRU, der Zustand steht im
    Weltstand.
  - `neu(game, ort, { art, besitz, bauweise?, zustand? })` vergibt einen neuen Landepunkt `<ort>.<art>-<n>` mit neuem
    Seed. `prise(game, ort, gegner)` legt das Feindschiff an (§7).
  - `toSave()` / `restore()`.
- **Entkopplung** (BODENKAMPF + ENGINE): Neuer Code verwendet **kein** `aways.kesh`, `map === '…'` oder `AWAY_MAPS.kesh`.
  Bestehende Stellen bleiben, wo sie Tutorial-Logik tragen.

### 6.2 Anker-Interaktionen – `server/sim/anker.js` (BUEHNE)
- Halte-Interaktionen für alle Rollen aus §3.3 über den bestehenden Hold-Mechanismus:
  - `interactionsAt` → Kinds `anker:<rolle>`
  - Zustandswechsel → `game.missionEvent('ankerZustand', { map, anker, rolle, zustand, pid })`
  - Ereignis `ankerZustand` an die Clients
- **Abbruch bei Treffer** für Download und Ladung (Hook `anker.onTreffer(game, pid)`, ruft BODENKAMPF bei jedem Treffer
  auf einen Spieler).
- Ladung: Nach `scharf` läuft ein `countdown`, dann `explosion`, Flächenwirkung über `waffen.treffer` (sobald B2 da ist,
  vorher wie die Granate: Segmente). Zustand `zerstoert`.
- Rätselpaare: allgemeine Fassung der Kesh-Schlüssel (`paarFenster`, `paarSoloFenster`).
- Lift/Leiter: Deckwechsel über `karte.decks.links` (wie die Lerche, M4). Bewegung, Sicht und KI kennen die Links
  (BODENKAMPF).

### 6.3 Objekte und Tutorial-Adapter (ENGINE, `server/mission/objects.js`)
- Objektbezug in Regiebüchern:
  - **neu** `{ "map": "<lpId>", "anker": "<rolle>|<ankerId>", "state": "…", "all": true }`
  - Altform `{ "map", "object" }` bleibt für die Handkarten
- `MAP_ANCHORS` in `maps.js` (BUEHNE) gibt den Handkarten Anker. Adapter (ENGINE) bilden Rollen auf die alten Objekte ab:

  | Karte | Rolle | altes Objekt |
  |---|---|---|
  | kesh | `tor` | `vault` |
  | kesh | `raetsel` (Paar A) | `key` |
  | kesh | `fund` | `tablet` |
  | kesh | `wache` (`schwer`) | `warden` |
  | wreck | `beute` | `container` |
  | wreck | `terminal` | `lore` |
  | wreck | `versteck` | `hollow` |
  | platform | `ziel` | `datenkern` |
  | platform | `nsc` | Ivos Platz |
  | platform, wreck, kesh | `abholpunkt` (`ankunft`) | Pads |

  Zustandsnamen werden übersetzt (`present ↔ da`, `taken ↔ genommen`, `closed ↔ zu` …).

### 6.4 Bausteine (ENGINE, `server/mission/bausteine/buehne.js`)
| Baustein | Art | Parameter |
|---|---|---|
| `anker_zustand` | Aktion | `map, anker, zustand, merken?` (`merken` schreibt in den Weltstand) |
| `kante_zustand` | Aktion | `map, kante, zustand, merken?` |
| `landepunkt_alarm` | Aktion | `map, an` |
| `ladung_geben` | Aktion | `anzahl` |
| `besetzen` | Aktion | `map, bereich?, fraktion, staerke: klein\|mittel\|gross, haltung: ruhig\|wach, tag, neue_rolle?` (B1: Plünderer/Wächter, B2 erweitert) |
| `anker_state` | Prüfung | `map, anker, state, all?` |
| `download_fertig` | Prüfung | `map, anker?` |
| `ladung_gezuendet` | Prüfung | `map, anker?` |
| `alarm` | Prüfung | `map` |
| `team_im_bereich` | Prüfung | `map, bereich` (Altname `area_occupied` bleibt) |
| `entern_ziel` | Aktion (Raum) | `tag` (markiert einen Gegner-Spawn, §7) |

Platzhalter in Texten: `{{lex.<schluessel>}}` aus dem Lexikon der Bauweise des Landepunkts (INHALT §8).

## 7. Schiffskarte erreichen (ENTERN, `server/sim/entern.js`)
- Ein Gegner mit `entern: true` (Spawn-Parameter aus dem Baustein `entern_ziel`) wird bei Hülle 0 **nicht entfernt**:
  - Zustand `treibt` (`Entern.onEnemyZero` gibt `true` zurück)
  - feuert nicht, dreht langsam
  - Snapshot `space.enemies[].st: 'treibt'`
- Transfer frei, solange die Lerche ≤ `CONFIG.entern.transferRange` entfernt ist. Ziel ist der Landepunkt `<ort>.prise`
  (INHALT §6):
  - Art `schiff`
  - Bauweise `germanen`
  - Besitz = Fraktion des Gegners
  - Seed aus der Gegner-ID
  - Zustand `umkaempft`
- Beim Verlassen der Szene verfällt die Prise, außer das Buch setzt `merken`. Dann bleibt sie als treibendes Wrack
  (Zustand `verfallen`) am Ort im Weltstand.
- Nie im Tutorial (der Spawn-Parameter kommt nur aus Spielleiter- und Archivbüchern). Golden unberührt.
- Treibende Wracks als feste Landepunkte stehen in `landepunkte.json` (`frei: nach_raumgefecht`).

## 8. Weltstand v3 (ENGINE, gilt für B1–B3)
`version: 3`, `MIGRATIONS[2]` ergänzt leere Blöcke. Schema in `content/schema/weltstand.schema.json`.

| Block | Inhalt | Stufe | Inhaber `toSave/restore` |
|---|---|---|---|
| `welt.landepunkte` | `{ <lpId>: { seed, bauversion, schablone, art, bauweise, besitz, zustand, zustaende: { <ankerId\|kantenId>: zustand }, alarm, besuche, letzte_mission, neu: bool, gesperrt } }` | B1 | `landepunkte.js` |
| `welt.wracks` | `[{ lpId, ort, quelle: 'entern'\|'daten' }]` | B1 | `entern.js` |
| `crew` | `{ waffen: { <hash>: waffe }, rollen_gesehen: [rolle] }` | B2 | `waffen.js` / `squad.js` |
| `welt.sektoren` | `{ erkundet: [hex], bojen: [kantenId], temp: [{ id, a, b, bis }], offen: [kantenId] }` | B3 | `explore.js` / `sprung.js` |
| `spielleiter.zusammenfassung[]` | zusätzlich `boden: bool, lang: bool, landepunkte: [lpId], dauer_ziel_min` | B1 | SPIELLEITER |

- Laden in dieser Reihenfolge: `sektoren` → `landepunkte` → `spielleiter.restore` → `mission.restore` →
  `away.applyWorldFacts`.
- Bei Abweichung der `bauversion`: Karte neu bauen, Zustände über Anker- und Kanten-IDs übertragen, Unbekanntes verwerfen,
  Eintrag im Regie-Logbuch.
- Test-Fixtures v1/v2 unter `tools/fixtures/weltstand/` (ENGINE).

## 9. Protokoll (`shared/protocol.js` `VERSION: 7`, nur ENGINE ergänzt)
| Was | Felder | Stufe |
|---|---|---|
| Ereignis `awayMap` | `{ id, erzeuger, art, bauweise, besitz, zustand, w, h, rows, anker: [[id, rolle, x, y, attr?]], bereiche, decks, kv }` (≤ 8 KB, beim Betreten bzw. auf Anfrage) | B1 |
| cmd `awayMap.get` | `{ id }` (Client fehlt die Karte oder `kv` passt nicht) | B1 |
| cmd `transfer.ziel` | `{ landepunkt }` (Transfer-Konsole) | B1 |
| Snapshot `away` | `map` (= lpId), `kv` (Kartenversion), `ao: [[ankerIdx, zustandIdx], …]` und `ko: [[kantenIdx, zustandIdx]]` (nur Abweichungen vom Start), `al` (Alarm 0/1), `cd` (laufender Countdown `{ i, t }` oder fehlt) | B1 |
| Snapshot `space.enemies[]` | `st: 'treibt'` | B1 |
| Ereignisse | `ankerZustand { map, anker, zustand }`, `downloadAbbruch { anker }`, `ladungScharf { anker, t }`, `ladungExplodiert { anker }`, `alarm { map, an }`, `enternFrei { id }` | B1 |
| Debug | `buehne <art> <seed> [bauweise besitz zustand]` (bauen und hinbeamen), `anker <id> <zustand>`, `lp list`, `lp neu <ort> <art>` | B1 |

B2- und B3-Felder stehen in den jeweiligen Verträgen und werden ebenfalls nur von ENGINE eingetragen.

## 10. Art-API (für Art-Teams, VOXEL, PIPELINE; Inhalte, Teams und Asset-Listen in `ART-PLAN.md`)

### 10.1 Kit-Teile, Props, Leitstücke
- **Manifest** wie CONTRACT-M4 §5 (`assets/manifest/<team>.json`). Sockets dürfen im Voxelwerk-Rezept stehen (PIPELINE
  übernimmt sie, der Manifest-Eintrag hat Vorrang).
- **Kit-Teile** `kit/<bauweise>/<kind>` (`<kind>` aus §3.1). Einheitliche Parameter:

  | Parameter | Werte |
  |---|---|
  | `conn` | 0–15 (Bits N=1, O=2, S=4, W=8: gleiche Kachelklasse nebenan) |
  | `cut` | 0–15 (Öffnung je Seite) |
  | `zustand` | 0 intakt, 1 verfallen, 2 umkämpft |
  | `art` | `aussenposten`, `station`, `ruine`, `schiff` |
  | `seed` | aus Kachelposition + Karten-Seed |
  | `state` | Index in den Zuständen der Kachelart, nur bei `tuer`, `schott`, `tor`, `luke`, `wand_schwach` |

  - `boden`, `boden2` und Gitterrost laufen über ein Teil `kit/<bw>/boden` mit `belag` 0–3 (platte, gitter, planke/erde,
    schmuck). Belag je Kachelart steht in der Bauweisen-Tabelle.
  - `gelaende` und `fels` sind Terrain (VOXEL, wie Kesh).
  - `plateau`/`kante`/`rampe`: `kit/<bw>/kante` mit `conn`; das Plateau ist nur optisch erhöht (0,5 m).
  - `leere`/`abgrund`: nichts bzw. Stimmungshintergrund.
  - `truemmer`/`schutt`: `kit/<bw>/truemmer` bzw. Streuset des Zustands.
- **Props an Ankern:** über die Bauweisen-Tabelle `anker[rolle][art]`, z. B. `prop/germanen/gemein/runenstein_terminal`.
  - Zustände = Zustände der Rolle (§3.3).
  - Sockets: `use` (Pflicht bei Interaktion), `label`, `fx_spark`, `fx_smoke`, `light`; zusätzlich je ART-PLAN §4.2:
    `screen`, `charge`, `fx_explode`, `prisoner`, `beam`, `stand`.
- **Leitstücke/Signaturen:** `leit/<bauweise>/<art>/<name>`, belegt über den Platztyp `herzstueck` bzw. die
  Signaturmodule.
- **Besitz:** Paletten-Zuordnung in `content/buehnen/paletten/<besitz>.json` (ART-PALETTEN):
  `{ format: "besitz-palette/1", besitz, je_bauweise: { <bauweise>: { intakt, verfallen, umkaempft } }, banner, streu: [ids] }`.
- **Zustand:** Palette `adjust` + `erode` (SYS-KERN) und Streusets `streu/<zustand>/*`.
- **Stimmungen:** je Kartenart × Bauweise in der Bauweisen-Tabelle (`stimmung[art]`).

### 10.2 Bauweisen-Tabelle – `content/buehnen/bauweisen/<bauweise>.json` (Art pflegt, VOXEL liest)
```json
{ "format": "bauweise/1", "id": "germanen",
  "kits":    { "wand": "kit/germanen/wand", "zaun": "kit/germanen/zaun", "boden": { "id": "kit/germanen/boden", "belag": 0 },
               "boden2": { "id": "kit/germanen/boden", "belag": 2 }, "…": "…" },
  "anker":   { "terminal": { "*": "prop/germanen/gemein/runenstein_terminal" },
               "sprengpunkt": { "aussenposten": "prop/germanen/aussenposten/runenmast", "station": "prop/germanen/station/schmiedeherd_reaktor_2x2" } },
  "leit":    { "herzstueck": { "aussenposten": "leit/germanen/aussenposten/langhaus" } },
  "paletten": { "basis": "nord" },
  "stimmung": { "aussenposten": "outpost_frost", "station": "hall_forge", "schiff": "ship_nord" } }
```
- Jede `kind` aus §3.1, die in Modulen dieser Bauweise vorkommt, und jede Rolle mit Objekt muss belegt sein.
  `check:assets` (PIPELINE) prüft das. Fehlt ein Teil, baut der Kit-Renderer einen lesbaren Platzhalter (kein Magenta).
- **Eine neue Bauweise = eine Datei + Assets, ohne Code.**

### 10.3 Deko-Regeln – `content/buehnen/deko/<bauweise>.json` (Art)
`{ format: "deko/1", regeln: { <platztyp>: { props: [ids], dichte: [min, max], wandnah: bool, frei_halten: 2 } } }`.
- `deko.js` (VOXEL) streut deterministisch aus Karten-Seed und Platz.
- Nie auf Anker-, Tür-, Weg- oder Kantenmitte-Kacheln, nie Deckung, höchstens 12 Props je Zelle.
- Deko ist nur Optik, nie Kollision.

### 10.4 Kit-Renderer (VOXEL, `public/js/voxel/kit.js`)
- Baut aus `Karte` + `kacheln.json` + Bauweisen-Tabelle + Besitz-Palette + Zustand.
- Setzt `conn`/`cut` aus den Nachbarn, Props an Anker (Zustand aus `ao`), Kachelzustände aus `ko`/`ao`, Deko nach Regel,
  Decks wie die Lerche (M4).
- Handkarten laufen weiter über den bestehenden Weg in `away.js`.
- **Budget:** Bau der Außenposten-Karte < 1,5 s, 60 fps wie M4 §7 (QA misst).
- Die Galerie nutzt denselben Renderer.

## 11. Spielleiter-Anbindung (KATALOG, SPIELLEITER, ENGINE)

### 11.1 Umsetzungen (KATALOG, Schema ENGINE)
- `buehne_braucht: { kartenarten?: [..], anker: ["tor", "fund", { "rolle": "raetsel", "paar": 1 }], min?: { "eingang": 2 }, gefecht?: true }`
  ersetzt `params.map.werte`. Parameter `map` (Typ `map`) nimmt jede Landepunkt-ID. Der Szenenbau setzt sie ein, nie
  das LLM.
- **Umstellen und neue Umsetzungen:** INHALT §9.1 und §9.2 (≥ 3 verfügbare je Kartenart). Ziel `npm run katalog`:
  ≥ 3 je Kartenart. Alle mit `test`-Werten, `dauer_min` als Schätzung, `liefert_flags`.
  - `sonden_code` bleibt an `platform`.
  - `plattform_kern` geht in `daten_stehlen` auf, das Original bleibt an `platform`.
- **Lexikon** `content/buehnen/lexikon/<bauweise>.json` (INHALT §8).
- **2 neue Archivmissionen** mit Bodenszene auf neuen Landepunkten (INHALT §9.3; prüferfest, Skip-Durchlauf).

### 11.2 Grobplan und Kontext (SPIELLEITER)
- Szene im Grobplan: `landepunkt: "<lpId>"` **oder** `buehne: { kartenart, besitz, neu: true }`.
  - `karte` bleibt Altname.
  - Neu `ohne_boden_grund`.
  - Koordinaten sind verboten (`KOORDINATE`).
- Die Szenenauflösung wählt den Landepunkt am Ort, prüft `buehne_braucht` gegen die **gebaute** Karte und setzt `map`.
- **Kontext neu:**
  - `orte[].landepunkte: [{ id, art, bauweise, besitz, zustand, besucht, anker: { rolle: anzahl }, zustaende, alarm, gesperrt }]`
  - `bodenbilanz: { letzte: [{ titel, boden }], pflicht_jetzt, lang_ab_min: 25 }` (Darstellung INHALT/GD §5)
  - `kartenarten: [{ id, kurz, pflichtsatz }]`
  - In den Umsetzungen ersetzt `braucht_anker` das Feld `karten`.
  - B2 ergänzt `fraktionen`, `gegner`, `rollen_gesehen`.
- Angebotsrunde: Ist die Quote fällig, haben **beide** Spielleiter-Angebote eine Bodenszene, und das Archiv bietet
  bevorzugt eine Bodenmission an. Eine Mission je Runde darf lang sein (25–35 min).
- Tokens: Szene weiter < 8k im Median. Der Kontext wächst um höchstens 2k.

### 11.3 Prüfer-Codes
**Bühne** (`Buehne.pruefen`, auch in `check-maps`, Werkstatt und Galerie):

| Code | Art | Regel |
|---|---|---|
| `K-RASTER` | Fehler | Zeilenlänge, unbekanntes Zeichen, Modulgröße |
| `K-KANTE` | Fehler | Anschluss passt nicht, Rand ungültig |
| `K-RICHTUNG` | Fehler | Außenkante zeigt nicht zur `richtung` |
| `K-ANKER-WAND` | Fehler | Anker auf fester, Tür- oder Kantenmitte-Kachel, Objektanker ohne begehbaren Nachbarn |
| `K-ERREICHBAR` | Fehler | Pflichtanker nicht von **jedem** Eingang bzw. von der Ankunft erreichbar (BFS, inkl. Deck-Links) |
| `K-PFLICHT` | Fehler | Pflichtsatz der Kartenart nicht erfüllt |
| `K-EINGAENGE` | Fehler | weniger als `eingaengeMin` |
| `K-ABHOLPUNKT` | Fehler | weniger als `abholpunkteMin`, keine oder mehrere `ankunft`, Pad-Fläche ungültig |
| `K-PAAR` | Fehler | Rätselpaar unvollständig |
| `K-PLATEAU` | Fehler | `^` grenzt an etwas anderes als `^`, `k`, `/` |
| `K-DECK` | Fehler | Lift/Leiter nicht übereinander, `_` fehlt in der Lücke |
| `K-INSEL` | Fehler | begehbare Insel ohne Zugang |
| `K-DECKUNG` | Warnung | Deckung im Gefechtsbereich < `deckungMin` |
| `K-SICHTGASSE` | Warnung | Sichtgasse > `sichtgasseMax` |
| `K-RUECKZUG` | Warnung | Rückzug nur über den Eingang |
| `K-SCHATTEN` | Warnung | Bereich ohne Sichtschatten |

**Mission** (`checker.js`, `szenenbau.checkGrobplan`):

| Code | Art | Regel |
|---|---|---|
| `BUEHNE-ANKER` | Fehler | gebaute Karte hat die verlangten Anker nicht |
| `BUEHNE-ART` | Fehler | Kartenart passt nicht |
| `LANDEPUNKT` | Fehler | unbekannt bzw. am Ort nicht vorhanden oder noch nicht frei |
| `LANDEPUNKT-GESPERRT` | Fehler | z. B. Rostnest |
| `KOORDINATE` | Fehler | `x`, `y`, `tile` oder `pos` in der Bühne |
| `BODEN-QUOTE` | Fehler, 1 Nachbesserung | letzte gespielte Mission ohne Boden und Plan ohne Boden. Mit `ohne_boden_grund` nur Warnung |
| `BODEN-LANG` | Fehler | lange Mission ohne Bodenszene |
| `KARTE-WIEDERHOLT` | Warnung | Landepunkt + Seed in den letzten `wiederholtFenster` Missionen |
| `DAUER-ABWEICHUNG` | Warnung | Zieldauer vs. Summe der Szenen |
| `BESITZ-REGION` | Warnung | Besitz passt nicht zur Präsenz der Fraktion (`CONTRACT-B3.md` §2) |

## 12. Abnahme B1 (QA-ABNAHME-B1)
1. Pro Kartenart **3 verschiedene Seeds → 3 verschiedene gültige Karten**, im Spiel betreten und durchgespielt
   (Direktstart erlaubt). Galerie-Screenshots aller Schablonen. Bestehensquoten aus `buehne alle`.
2. **Sechs live erzeugte Missionen hintereinander im Saumraum:** mindestens jede zweite und jede lange mit Bodenszene auf
   einer neuen Karte, keine Karte gleich, alle vom Prüfer bestätigt. Live-Budget **≤ 400 000 Tokens**, verteilt auf zwei
   Serverläufe (Deckel 500k je Lauf). Verbrauch berichten. Aufnahmen in der Ablage (Status `offen`).
3. **Zweiter Besuch am selben Landepunkt:** dieselbe Karte, Zustand aus dem Weltstand sichtbar (z. B. verschlossener
   Durchgang), Speichern/Laden dazwischen.
4. Kesh-Umsetzungen laufen in der Ruine (Rom), Wrack-Umsetzungen auf Station oder Schiff (je ein Durchlauf).
5. Kampfunfähiges Feindschiff betreten (Spielleiter- oder Archivbuch) und ein treibendes Wrack als Landepunkt.
6. Werkstatt: ein Modul neu anlegen, live geprüft, im Spiel gesehen. Galerie mit Kennzahlen.
7. m1–m3 Golden grün **ohne** Allow-Liste, Snapshot < 13 KB, `npm test` grün, README-Abschnitt „B1 Bühnen“.

## 13. Berichtspflicht (alle Teams, B1–B3)
Abschlussbericht an die Studioleitung mit:
- **Geliefert** (Dateien)
- **Abweichungen** vom Vertrag (mit Grund)
- **Messwerte**:
  - Bestehensquoten je Schablone
  - Bauzeiten
  - Snapshot-Größen
  - Tokens
  - Testergebnisse (`npm run check`/`npm test` mit Zahlen)
- **Kürzungen** (KITS)
- **Offene Punkte**
- **Wünsche an fremde Dateien** (nie selbst geändert)

Ehrlich: verfehlte Ziele nennen, nicht schönrechnen. Hängt ein Team länger als 30 min an einer fremden Schnittstelle,
meldet es das sofort per SendMessage an „main“.
