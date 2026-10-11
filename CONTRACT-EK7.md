# CONTRACT-EK7 – Karte: 15 Hexe (Raumsektoren aus Daten, `sperrriegel`, Häfen)

Team KARTE.

**Stand:** fertig, gemergt in `ek1`. Testskripte: `npm run check` (darin `tools/check-sektoren.js`), `npm run test:sektoren`, `npm run test:weltstand`; Bot-Flug `node tools/sprungkette.js`. Offene Punkte: Abschnitt 7.

Berührt: `content/welt/limes.json`, `shared/sektoren.js`, `shared/gen-sektor.js` (neu),
`shared/locations.js`, `server/sim/{sprung,explore,shop}.js`. Das Tutorial (m1–m3) und die 8 Saumraum-Orte bleiben unverändert.

## 1. Die 15 Hexe der Kette

Statio Limitis 0305, Ferraria 0304, Sol Rubra 0403, Frostgrat 0402, Rabenpass 0502, Kreuzweg 0503, Vorfeld 0504, Dunkelriff 0505,
Nebelheim 0605, Methalle 0705, Wolfstor 0604, Tiberis 0303, Castra Martis 0202, Ceres-Depot 0203, Eisenwald 0704.

**Nachgerechnet** (`tools/check-sektoren.js`, Block `[kette]`): Hexe auf einem einfachen Weg Statio Limitis → Eisenwald über die Sprungkanten,
ohne germanisches Kernland und Krähenwacht. Ergebnis: **16 Hexe, einzige Abweichung vom Briefing: Vigilia (0302)** (liegt auf
0202–0302–0402). Vigilia bleibt **unspielbar** (Briefing: 15), ihre Kanten zeigen in Castra Martis und Frostgrat als „gesperrt“.
Statio Limitis ist Ziel der Kante `tutorial-ende`, nicht Teil eines Wegs vom Tutorial aus (Sackgasse an Ferraria).

Spielbar sind damit 8 (Saumraum) + 15 (Kette) Hexe. Alles übrige bleibt unerreichbar (`Sektor gesperrt – <Region-Sperrtext>`).
Region-Sperrtext `imperium`: „Imperium: Durchflug gesperrt.“ (vorher „Grenzposten Statio Limitis …“, passt nicht mehr).

## 2. Raumsektoren aus Daten

Hex-Eintrag in `limes.json` mit `"gen": true` und `"ort": "<id>"` (Kleinbuchstaben, Unterstrich: `castra_martis`, `statio_limitis`, …).
`Locations.get(<ort>)` liefert die Szene (`Sektoren.datenOrt`, `shared/gen-sektor.js`), **deterministisch**, Seed allein aus der Hex-Kennung
(Server und Client erzeugen dasselbe). Die Orte stehen **nicht** in `LOCATIONS` (Sternkarten-Orte, Snapshot `world.locations`, Ort-Links
und Tutorial bleiben bit-gleich); ihre `links` sind leer. Routenplanung für Bots über `Sprung.nachbarOrte(game, ort)` (offene Kanten).

Generator (`GEN.erzeuge(hex, daten, cfg)`), alles aus dem Hex-Eintrag:

| Szene-Feld | Regel |
|---|---|
| `w`, `h` | 3000 × 2200 (`CONFIG.sektoren.datenSzene` überschreibt Standardwerte, Feld `szene` je Hex überschreibt einzeln) |
| `station` | jedes System mit `hafen` (Hafenklasse) trägt eine Station (`kind: 'station'`) |
| `dock` | nur mit `"andocken": true` am Hex (Castra Martis, Statio Limitis) |
| `stern` | 1, bei „Doppelstern“ in `art` 2 (Rabenpass) – Daten, noch ohne Marker |
| `planeten` | Gasriese bei `einfluss: gas` (Tiberis), sonst 0–2 zufällig; `szene.planeten` überschreibt (Castra Martis 1, Eisenwald 1, Rabenpass 0) |
| `bojen` | 2–4 Navigationsbojen im freien Raum (Daten) |
| `asteroids` | `einfluss` `asteroiden` 24, `truemmerstrom` 14 (`field` hält 520 px Rand frei) |
| `fog` | `einfluss: nebel` (Nebelheim) |
| Sprungpunkte | nicht Teil der Szene: `sprung.js` legt sie aus den Kanten an den Rand (`sprungpunktLage`); `check-sektoren` prüft, dass Brockenfeld, Station, Liegeplatz und Bojen alle sechs Sprungpunkte freihalten |

Rabenpass ist ein **leerer Raumsektor** (nur Doppelstern, `einfluss: gezeiten` entfällt). Wolfstor: heute leer (Minenfeld ist EK2).
Boden-Landepunkte (Methalle, Eisenwald): `szene.beam` je Hex ist **in EK8 ergänzt** (Hexe 0704 und 0705, Landepunkte `methalle.siedlung`, `eisenwald.siedlung`; CONTRACT-EK8 D31).

**Grenzen (heute):** `space.js` legt nur `scene.station` (und `dock`) als Marker; Stern, Planeten und Bojen stehen als Daten bereit,
werden aber nicht gezeichnet (`art.js`/`space.js` gehören anderen Teams; Stand 2026-10-11: weder `server/sim/space.js` noch `public/js/render.js` oder `art.js` lesen `scene.stern`, `scene.planeten`, `scene.bojen`). Gleiches gilt für Minen, Eruption, Trümmerstrom (Einfluss-Mechaniken).

## 3. Weltstand-Schlüssel `sperrriegel`

**Antwort auf die Briefing-Frage:** Ja, der Weltstand kann Schlüssel dieser Art schon setzen. Schlüssel sind die Einträge von
`welt.verbindungen_offen` (`Explore.linksOpen`, `openLink(key)`; Regiebuch-Aktion `openLink`, `reveal_location`), `Explore.kanteOffen()`
liest `e.key` daraus. Was fehlte: ein benannter Weg für `sperrriegel` (ohne Ort), das Lesen des Schlüssels als Weltstand-**Fakt**,
und der Hinweis an die Crew (Bojen, Meldung). Nachgezogen:

- `Explore.sperrriegelOeffnen()` → `linksOpen` + Fakt `welt.fakten.sperrriegel = true` (Quelle „Methalle“) + Bojen der drei Kanten bekannt
  + Ereignis `sperrriegelOffen` (Client-Hinweis). Idempotent. `Explore.sperrriegelOffen()`.
- **Baustein `sperrriegel_oeffnen {}`** (`server/mission/bausteine/sektor.js`, `bausteine.json`): das ruft Team BODEN nach der Methalle-Sprengung.
- `kanteOffen()` akzeptiert einen Schlüssel auch als Weltstand-Fakt `true` (`welt_fakt { key: 'sperrriegel' }`, Spielleiter). Dieser Weg
  öffnet die Kanten, macht aber die Bojen nicht bekannt – dafür den Baustein nehmen.
- Persistenz: `verbindungen_offen`, `fakten`, `sektoren.offen` (test-weltstand: Speichern, Neustart, Laden).
- Kanten (`key: "sperrriegel"`): 0504–0604, 0604–0605, 0604–0705. Wolfstor–Eisenwald (0604–0704) ist offen, Eisenwald damit **nur über
  Wolfstor** erreichbar, Wolfstor nur mit Schlüssel (`check-sektoren`: ohne Schlüssel sind Wolfstor und Eisenwald auch über die Methalle unerreichbar).
- `tutorial-ende` (0305–0306) bleibt unverändert; der Schlüssel wird seit EK8 von der Kette gesetzt (`content/kampagne/eisenwald.json`, `tutorial.oeffnet`).

## 4. Häfen Castra Martis und Statio Limitis

Heutiges Modell: Ein Ort mit `scene.dock` ist ein Hafen (Dock-Ring, Andocken in `space.updateFlight`). Das Hafenterminal (`shop.buy`)
braucht nur `ship.docked`; der Kontext (`shopContext`) wählt Sortiment und Preise (`where`, `priceVaelen`). Es gibt **keinen Ruf**
im Shop (Haltung `haltung_<fraktion>` wirkt nur auf Missionen/Funk). Übertragen:

- Beide Orte haben `dock`, `kind: 'port'` und `shop: 'hafen'` → Sortiment wie Lichtkordon (Umbauten, Ausrüstung, Vorräte, Deko), Marken,
  jederzeit (kein Tutorial- oder Missionszustand nötig), `scene.hafen = { klasse, andocken: true, ruf: false }`.
- `shopContext` liefert `loc.shop` statt der Orts-ID (`server/sim/shop.js`); Client-Titel nennt den Ortsnamen (`consoles.js`).
- Weltstand fortsetzen setzt die Lerche wieder an den Liegeplatz (`lastDockedAt`).
- Andere Hexe mit Hafenklasse (Kreuzweg, Ferraria, Tiberis, Ceres-Depot, Methalle, Eisenwald) haben eine Station, aber keinen Liegeplatz.

**Nicht übertragen (Vorschlag):** (a) *Reparatur*: auch Lichtkordon repariert nichts gegen Marken, nur Vorräte (Ersatzteil, Flickblech,
Löschgel) werden gekauft. Eine Hüllen-/Systemreparatur gegen Marken am Liegeplatz wäre ein neuer Shop-Eintrag `kind: 'service'` (EK8).
(b) *Landepunkte am Boden* (`hafen.kontor` ist eine Boden-Station des Lichtkordon mit `besitz: kontor`): für Römer nicht vorgesehen.
(c) *Ruf* wird bewusst nicht gebaut (Briefing: ohne Ruf).

## 5. Spielbar-Schaltung und Notfallsprung

15 Hexe `spielbar: true` (siehe 1). **Notfallsprung:** Während das Tutorial läuft, springt er nie aus dem Saumraum hinaus
(`notsprungKandidaten`; sonst würde Statio Limitis Ziel aus dem Splittergürtel und die Golden-Läufe m1–m3 würden abweichen). Im freien
Spiel ist Statio Limitis Kandidat (9 von 60 Seeds, Test).

## 6. Prüfung und Werkzeuge

- `npm run check` → `tools/check-sektoren.js`: 303 Prüfungen, Block `[kette]` (Liste nachgerechnet, Erreichbarkeit mit/ohne Sperrriegel,
  Szenen: Hex-Zuordnung, Lage in der Szene, freie Sprungpunkte, Determinismus, Häfen).
- `tools/test-sektoren.js` (+ Abschnitte „Szenen aus Daten“, „sperrriegel“, „Häfen“, „Sprungkette“), `tools/test-weltstand.js` (Persistenz).
- `node tools/sprungkette.js [--json]`: Bot fliegt Statio Limitis → … → Eisenwald (15 Sprünge, ohne Gefechte), Tabelle der Sprünge,
  Szenen (Snapshot-Größe je Szene) und gesperrten Ziele (Wolfstor vor der Sprengung, Kernland, Krähenwacht, Vigilia, tutorial-ende).
- Bots: `GenericAgent.nextHop` (sim-headless) plant über `Sprung.nachbarOrte`, sobald ein Ort aus Daten beteiligt ist
  (für alle anderen Wege unverändert).
- Regiebuch-Prüfer: Orte aus Daten gelten als Orte (`REF-ORT`), Häfen als `PORT_IDS`. Nicht erweitert: Spielleiter-Szenenbau
  (`szenenbau.js`: `LOC` aus `LOCATIONS`), Fahrzeit-Schätzung dort.

## 7. Offen
- **Stern, Planeten und Navigationsbojen** der Datenorte stehen nur als Daten in der Szene und werden nicht gezeichnet; gleiches gilt für Minen/Eruption/Trümmerstrom als Einfluss-Mechaniken (Abschnitt 2, Grenzen).
- **Reparatur im Hafen** fehlt (Abschnitt 4a): Castra Martis und Statio Limitis verkaufen nur Vorräte gegen Marken; eine Hüllen-/Systemreparatur wäre ein neuer Shop-Eintrag `kind: 'service'` (in `server/sim/shop.js` gibt es keinen).
- **Spielleiter-Szenenbau** kennt die Datenorte nicht (`server/mission/szenenbau.js`: `LOC` aus `Locations.LOCATIONS`, Fahrzeit-Schätzung ebenso); die Kampagne braucht ihn nicht (kein Spielleiter), das freie Spiel plant dort nicht über die Kette.
- **Abweichung vom Briefing:** nachgerechnet sind es 16 Hexe auf dem Weg, nicht 15; Vigilia (0302) bleibt unspielbar (Abschnitt 1).
- Wolfstor ist heute ein leerer Sektor (Abschnitt 2).
