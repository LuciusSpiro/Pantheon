# CONCEPT-SL6 – Zonen mit Wirkung und Gasriese schöpfen

Grundlage: `Briefing Die Schuld der Lerche (SL0-SL12)` (SL6), `Ops-Missionen` (3. Gasriese), `Sektor-Einflüsse` (Zonen mit Wirkung), Vault `C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`.
**Stand:** Konzept, Kais Go liegt vor (2026-10-14). Noch nicht gebaut. Voraussetzung: SL1 (Karte Sund, Szene Gasfeld). SL4 (Sonde als Tiefenmessung) ist KEINE Voraussetzung, wird nachgerüstet.

## 1. Befund (Code, Stand 87ff7a7)
| Punkt | Stand |
|---|---|
| Drift | nur bewegte Asteroiden (`shared/drift.js`, `space.js:164`), keine Kraft auf Schiffe |
| Hitze | nur je Energiesystem (`config.js:45` heatAt4 8/s, heatLimit 100, heatCool 4; `space.js:474-482`; `interior.heatDamage`) |
| Sicht | nur Szenenfaktor `loc.fog` (`space.js:205-216`, nur Modus Wellen All); `sensorReichweite`/`erfassung` kennen keine Position (3 weitere Aufrufer) |
| Flugmodell | alle Schiffe über `Flight.stepBody` (`shared/flight.js:73`): Lerche `space.js:577`, Gegner `pilot.js:467`, Eskorte `escort.js:596`, Konvoi `konvoi.js:148`. stepBody regelt vx/vy auf die Stufe, `lateralDrag` dämpft Quer |
| Client | rechnet die Lerche NICHT vor (nur Anzeige `turnFactor`, `consoles.js:74`); Position kommt aus dem Snapshot. Positionsversatz ist also ohne Client-Änderung konsistent |
| Frachtraum | 2 Buchten (`maps.js:354`), Arten-Whitelist `config.js:85`, Beamen/Abliefern an Taktik (`fracht.js`), Abliefern nur an Stationen, Lager im Weltstand (`schiff.fracht`) |
| Verkauf | `shop.js` kennt nur Kauf. Verkauf ist neu |
| Steigleistung | einziger Hebel `maxSpeed = Klasse × engineSpeedFactor` (`space.js:527-536`) |

## 2. Entwurf
### 2.1 Zone (Baustein, allgemein)
Statische Szenendaten (`scene.zonen[]`, nicht im Snapshot; nur Zustand je Zone im Snapshot, klein):
```
{ id, form: 'kreis'|'ring'|'rechteck', x, y, r0, r1 | w, h,
  drift: { winkel, staerke },          // px/s Positionsversatz, konstant (pulsiert nicht)
  hitze: 0, schaden: 0,                // Hitze/s auf Systeme, Hüllenschaden/s
  sicht: null | Faktor 0..1,           // Sichtgrenze (Faktor auf erfassung)
  ertrag: null | { ziel: 'fracht:deuterium'|'zaehler:<id>', rate },
  sichtbarFuer: 'alle'|'ops'|'karte',  // 'ops' nach Scan, 'karte' nach Feldkarte
  rand: sichtbar }
```
`ertrag.ziel` ist ein allgemeiner Zähler (Gasriese: Ladung; SL10: Aktivierungsfortschritt der Boje).
- **shared/zonen.js** (UMD, reine Funktionen, wie `drift.js`): `an(zonen, x, y)`, `wirkung(zonen, x, y)` summiert Drift/Hitze/Schaden/Sicht, Ringe: innere gewinnt Ertrag, Werte addieren sich.
- **server/sim/zonen.js**: `wirke(game, koerper, dt)` – Aufruf NACH `stepBody` an den vier Stellen (Lerche, Gegner, Eskorte, Konvoi): `x += drift*dt`, Hitze/Schaden, Ertrag. Eine Funktion, kein Flag.
- **Drift als Versatz**, nicht als Geschwindigkeit, sonst regelt stepBody sie weg. „Antrieb 4 gegen starkes Feld“ gilt damit von selbst (Nettotempo = Schiff + Drift). Gegner steuern nicht gegen und treiben mit (gleiche Regel, sieht dumm aus, ist kein Fehler).
- **Hitze (Default):** Zone heizt Antrieb und Schilde, skaliert mit deren Energie ≥ 3 (heat[k] += hitze*dt). **Schaden** über `shipHit` (Lerche); Gegner über den Gegner-Treffer-Pfad (andere Funktion, eigener Aufruf nötig).
- **Sicht:** Faktor wirkt auf `erfassung()` der Lerche, wenn sie in der Zone ist (`sensorReichweite(game)` bekommt die Position der Lerche, 3 Aufrufer). Gegner-Sicht in Zonen: **erste Fassung gestrichen** (Gegner sehen wie bisher).
- **Anzeige:** `render.js` zeichnet Rand, Ringe und Driftpfeile gemäß `sichtbarFuer`; Sektorplan (SL4) und Karte (SL1B) lesen `zonen[]` und zeigen Symbol/Rand, sobald `sichtbarFuer` es erlaubt (Szene besucht oder gesichtet). Sonde zeigt Zonen im Sektorplan.
- **Weltstand:** `zonen.bekannt[]` (Skalar-Liste IDs), kein Zonenstand sonst (statisch).

### 2.2 Gasriese
- Szene Gasfeld (SL1): Gasriese am Rand, Atmosphäre = 4-5 Ringe (`form: ring`). Innen: mehr Hitze/Schaden, Sicht ↓, `ertrag` nur im 3. und 4. Ring. Sturmzellen = kleine Kreise mit Drift.
- **Deuterium** als Ladungsart: `fracht.arten` + `'deuterium'`. Eine volle **Einheit** = eine Ladung (Frachtbucht). Füllstand je Einheit als Zähler `game.fracht.fuell` (Weltstand, eine Zahl). Kein Ertragslimit, kein Preisverfall (Kai); Kapazität bleibt 2.
- **Gewicht:** `engineSpeedFactor` × (1 − `deuteriumGewicht` × Einheiten an Bord), nur für Art deuterium (Sprengstoff unverändert, Golden bleibt).
- **Neue Funktionen (intention-benannt, keine Flags):** `fracht.schoepfen(game, dt)` (aus `zonen.wirke`), `fracht.abwerfen(game, art)` (Ops, Halten wie Beamen, wirft eine Einheit als Pod ab), `shop.verkaufen(game, art)` (Concordia, Preis aus `economy`), Konsole `weapons.abwerfen` in Taktik/Ops.
- **Ausgänge** (Regiebuch/Baustein): voll / teilweise / leer; Ertrag steht in `schiff.fracht`.
- **Evert-Platz:** Person belegt einen Platz (SL0); Schöpfen mit 1 freiem Platz füllt nur noch 1 Einheit. Kein Sonderfall, `frei(game)` genügt.

### 2.3 Dateien
`shared/zonen.js` (neu), `server/sim/zonen.js` (neu), `server/sim/fracht.js` (abwerfen, schoepfen, Art), `server/sim/shop.js` (verkaufen), `server/sim/space.js` (Gewicht, Sichtposition, Aufruf `wirke`), `pilot.js`/`escort.js`/`konvoi.js` (Aufruf), `public/js/render.js` (Zonenzeichnung), `shared/config.js` (`zonen`, `fracht.arten`, `economy.deuterium`), `tools/test-zonen.js` (neu, in `npm test`).

### 2.4 Layer-Schnitt (CLAUDE.md)
- Storage: `scene.zonen` (Daten), `game.fracht` (Lager, Füllstand), Weltstand `zonen.bekannt`.
- Action: `shared/zonen.js` (reine Regeln), `server/sim/zonen.js`, `fracht.schoepfen/abwerfen`, `shop.verkaufen`.
- Frontend: Zonenzeichnung, Füllstandsanzeige, Abwerfen-Taste. Keine Wirkungsrechnung im Client.

## 3. Schnittstellen/Flags
Keine neuen Parameter an `stepBody`. Szenen ohne `zonen` verhalten sich bitgleich (Eisenwald, Golden unverändert). Neues Regiebuch-Ereignis `zoneBetreten`/`frachtVerkauft`.

## 4. Entscheidungen
Z1 Drift als Positionsversatz nach stepBody. Z2 Zonen statisch, nur `bekannt` im Weltstand. Z3 `ertrag` zielt auf allgemeinen Zähler (trägt SL10). Z4 Gegner-Sicht in Zonen erste Fassung gestrichen. Z5 Endlos farmen, Kapazität 2 (Kai). Z6 Zonenhitze heizt Antrieb/Schilde (Default).

## 5. Abnahme
Labor: je Zone Drift/Hitze/Sicht/Ertrag messbar (`test-zonen.js`); Gegner in Drift-/Hitzezone werden gleich beeinflusst; Gasriese Ausgänge voll/teilweise/leer; Gewicht senkt Steigleistung, Abwerfen hebt sie; Verkauf in Concordia füllt Marken; Speichern/Laden mit Deuterium an Bord; `npm test`, `npm run check`, Golden unverändert, Snapshot unter Grenze, Eisenwald läuft.

## 6. Schätzung
**4–5 Studio-Tage** (Briefing 3): Zonen 2, Gasriese+Fracht 1,5, Verkauf/Gewicht/Abwerfen 1, Zeichnung/Anzeige inklusive. Sonde-Tiefenmessung +0,5 nach SL4.

## 7. Offene Fragen an Kai
- Hüllenschaden der Zone: auch bei Schilden oben (Default: Druck geht durch die Schilde, Schilde laden dort langsamer)?
- Soll Ladung im Gasriesen bei Hitze-Überlauf (Lager heiß) verloren gehen? Default: nein.
- Unsicher: Gegner-Schadenspfad in Zonen (andere Treffer-Funktion als `shipHit`), im Bau zu prüfen.
