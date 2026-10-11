# CONTRACT-EK1 – Schiffsklassen (Teil A EK1a: Korvette · Teil B EK1b: Fregatte, Kreuzer, Drehsprites)

Grundlage: `Briefing Eisenwald-Kampagne (EK1-EK9)` und `Planung Eisenwald-Kampagne (EK1-EK9)` im Vault
(`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`). Kai am 2026-10-11: `gunboat` vollständig umbenennen und durch die
Korvetten-Regeln ersetzen.

**Stand:** fertig, gemergt in `ek1` (EK1a, EK1b Server, EK1b Sprites). Testskripte: `node tools/test-combat.js` (EK1a), `npm run test:klassen` (EK1b), beide in `npm test`.
Aufbau: **Teil A (EK1a)** = Abschnitte 2–4, **Teil B (EK1b)** = Abschnitte 5–8, offene Punkte in Abschnitt 9. Entscheidungen D1–D7 (EK1a), D8–D16 (EK1b).

## 1. Stand
| Schritt | Inhalt | Stand |
|---|---|---|
| EK1a-1 | `gunboat` → `korvette` (Kennung, Config-Schlüssel, Tests, Regiebücher, Katalog, Archiv, Fixtures), Anzeige „Kanonenboot“ → „Korvette“ | fertig |
| EK1a-2 | Korvetten-Regeln: Schilde, Waffenplätze, zufällige Bestückung | fertig |
| EK1b Server | Fregatte, Kreuzer, variable Schildsegmente, Waffenplätze, Breitseiten-KI, Snapshot, Anzeige, Tests | fertig (Abnahme §8) |
| EK1b Sprites | Drehsprites für Jäger, Korvette, Fregatte, Kreuzer aus Voxelwerk-Sheets (`public/voxel/sprites/`, `public/js/art.js`), Rückfall auf die prozedurale Zeichnung, Vorschau `public/art-preview.html`; kein eigener Vertrag | fertig, gemergt (§7, D15 überholt) |

## 2. Teil A (EK1a) – Korvetten-Regeln (Aufbau `X=>`)
- **Schilde** `[vorn, Steuerbord, hinten, Backbord] = [1, 2, 0, 2]` (`CONFIG.enemyShields.korvette`). Vorher `[2, 4, 1, 4]`.
- **Waffenplätze** `CONFIG.enemyWeapons.korvette`: `bug` (0°, Bogen 40°, 400 px), `stbd` (90°, 90°, 500 px), `bb` (−90°, 90°, 500 px).
- **Bestückung** je Platz aus `CONFIG.korvetteWaffen` = `lanze | batterie | bolzen`, beim Spawn gewürfelt (`game.rng`), oder per
  `spawnEnemy(game, 'korvette', { waffen: { bug, stbd, bb } })` vorgegeben. Der Zustand steht in `e.waffen`.
  - **lanze** = angekündigter schwerer Treffer (bisher „Ladung“/`tele`), nur wenn die Lerche im Bogen eines Lanze-Platzes liegt.
  - **batterie** = Sperrfeuer-Salve (S2b), Mündung am Batterie-Platz, der zur Lerche zeigt.
  - **bolzen** = einzelner gezielter Schuss (Projektil `enemy`, eigener Takt `e.boltT`, Grundwerte der Korvette).
  - Eine Korvette ohne Lanze lädt nie, ohne Batterie gibt es kein Sperrfeuer, ohne Bolzen keine Einzelschüsse.
- **Snapshot:** `weapons` (nach dem Scan) trägt je Platz `platz` und `typ`. Kein neues Feld je Gegner.
- **Pilot:** Seitenwechsel nur nach Schildstand und Lage (`pilot.breitseite`, siehe 5.5). Die in EK1a gebaute Regel „Wechsel, wenn ein Bolzen zur Lerche zeigt und die andere Seite Lanze oder Batterie hat“ ist **entfernt** (D16).
- **Scan-Text** nennt Seiten stark, Bug schwach, Heck ungeschützt.

## 3. Entscheidungen der Studioleitung
| # | Entscheidung | Grund |
|---|---|---|
| D1 | Vollständige Umbenennung, kein Alias. Grammatik angepasst („die Korvette“, „der Korvette“, „Korvetten-Wellen“) | Kai 2026-10-11 |
| D2 | Voxelwerk-Datei `rostmeute_kanonenboot.json` bleibt unangetastet (anderes Repository) | EK1b bindet die Modelle neu an |
| D3 | LLM-Aufzeichnungen (`tools/fixtures/llm/**`) umbenannt und neu verschlüsselt (Schlüssel = SHA-1 des Inputs). Buch-Hashes neu geschrieben, Fehlercodes und Szenenquellen unverändert | Prüfung `Schlüssel passt nicht zum input` |
| D4 | Ältere Golden-Basen (`base`, `base-s1`, `base-s2b`, `base-b1fix`, `base-w1`, `s1`) und gespeicherte Welten unter `data/` nicht umgeschrieben (Altstand) | historisch |
| D5 | Lanze, Batterie und Bolzen werden auf die vorhandenen Angriffsarten der Gegner abgebildet (tele, Sperrfeuer, Einzelschuss), nicht auf die Waffen der Lerche | die große Waffenliste (AP12/13) ist nicht Voraussetzung |
| D6 | Angriffe auf **Schützlinge** (`escort.js`) laden weiter ohne Prüfung der Bestückung | Schützling-Pfad bleibt für EK4 offen |
| D7 | Tests, die Ladung und Sperrfeuer gleichzeitig brauchen, geben die Bestückung vor (`VOLL_BESTUECKT` bzw. eigene Vorgabe) | sonst vom Zufall abhängig |

## 4. Abnahme EK1a
- `npm test` und `npm run check` grün.
- `npm run snap:mess`: Worst Case 11 444 B, Wellen 10 558 B (Ziel ≤ 18 944 B).
- Bot-Arena (`sim arena --pilot both`): Korvetten werden geschlagen.
- Golden m1–m3 gegen `base-w2`: Abweichungen siehe `allow-ek1.json`.

## 5. Teil B (EK1b Server) – Fregatte und Kreuzer
Neue Datei `shared/schilde.js` (Schildmodell, Server und Client), Tests `tools/test-klassen.js` (in `npm test`).

### 5.1 Klassen (Config)
| | Korvette `X=>` | Fregatte `X==>` | Kreuzer `X===>` |
|---|---|---|---|
| Schilde hinten / je Seitenbereich / vorne | 0 / 2 / 1 | 1 / 2 / 2 | 1 / 3 / 2 |
| Seitenbereiche je Seite | 1 | 2 | 3 |
| Waffenplätze | bug, stbd, bb | bug, stbd1–2, bb1–2 | bug, bug2, stbd1–3, bb1–3 |
| Hülle · Höchstfahrt · Drehrate · Radius | 40 · 110 · 0,6 · 32 | 90 · 90 · 0,45 · 44 | 150 · 75 · 0,34 · 56 |
- Config: `enemies.fregatte|kreuzer`, `shipClasses.*` (Höchstfahrt, Beschleunigung, Drehrate, Drehbeschleunigung, Radius), `enemySchildSegmente`,
  `enemyWeapons.*` (Plätze mit `pos` entlang der Länge, Kreuzer-Front mit `quer`), `combat.hitRadius`, `spaceM3.tele`, `spaceM3b.pilotKlasse`.
- Bestückung je Platz zufällig aus `korvetteWaffen` (`lanze|batterie|bolzen`, `game.rng`), oder `spawnEnemy(g, 'fregatte', { waffen: { stbd1: 'bolzen', … } })`.
  Die Würfel-Reihenfolge der Korvette ist unverändert (Seed-stabil). Der Zustand steht wie bisher in `e.waffen`.
- **Mehrere Plätze gleicher Art im Bogen der Lerche (Breitseite):** Lanze = eine Ladung, Schaden ×(1 + 0,5 je weiteren Platz im Bogen) (`waffenMehr.lanzeJeWeitere`),
  Batterie = je Platz ein Geschoss je Stoß-Takt aus der Mündung des Platzes, Bolzen = je Platz ein Schuss je Takt. Die Korvette hat nie zwei gleiche Plätze im Bogen
  (die Bögen überschneiden sich nicht): Verhalten unverändert.
- Eine Regel für alle Klassen mit Plätzen: `space.hatPlaetze(game, kind)` (erster Platz hat einen Namen) statt `kind === 'korvette'`.

### 5.2 Schildmodell (E1: Segmente je Seite mit Längsintervall)
- **Seiten** Bug 0, Steuerbord 1, Heck 2, Backbord 3 (wie `Physics.sectorOf` und die Lerche). Jede Seite hat 1…n **Segmente**, in der Länge hintereinander
  (Index 0 = vorderster Seitenbereich). `e.shields`/`e.shieldsMax` sind flach: Bug, Steuerbord (vorn → hinten), Heck, Backbord (vorn → hinten). Eine Klasse mit
  je einem Segment ist der Spezialfall `[Bug, Steuerbord, Heck, Backbord]` – gleiche Indizes wie vor EK1b (Jäger, Korvette, Wächter, Pylon, Relais, alle Tests).
- **Aufbau aus der Config:** `enemySchildSegmente[kind] = { bug: [..], stbd: [..], heck: [..], bb: [..] }` (Punkte je Segment, von vorn nach hinten), sonst
  `enemyShields[kind]` = `[Bug, Steuerbord, Heck, Backbord]`. `Schilde.layout(C, kind)` liefert `{ max, segs[{seite,i,n,von,bis}], seiten[4][], n }`.
- **Treffer → Segment:** Seite wie bisher aus dem Winkel Quelle–Schiffsmitte relativ zur Achse (Viertelkreise, deckungsgleich mit `Physics.sectorOf`). In den Seitenbereichen
  ersetzt die **Längslage** den Winkel: der Strahl von der Schiffsmitte zur Quelle wird mit dem Quadrat des Seitensektors geschnitten (Bug-Ecke bei 45°, Heck-Ecke bei 135°);
  u = 0,5 − 0,5·cos/|sin| (0 = Bug, 1 = Heck), Segment = floor(u·n). Gleich lange Intervalle `[i/n, (i+1)/n)`. Gilt für Projektile wie für weit entfernte
  Schützen (Lanze). Nur das getroffene Segment nimmt Schaden auf; ist es leer, geht der Treffer in die Hülle (der Nachbar schützt dort nicht).
- **Regeneration:** je Segment ein Punkt alle `enemyShieldRegen` s (Schleife über `e.shields.length` statt `i < 4`).
- Die **Lerche behält ihre vier Sektoren** (`ship.shields`, `Physics.sectorOf` in `shipHit`).
- `e.shieldHitSector` ist jetzt der Segment-Index (bei 4 Sektoren der Sektor); `missionEvent('enemyShieldHit', { sector })` trägt ebenfalls den Segment-Index.

### 5.3 Lesestellen der Gegner-Schilde (alle angepasst bzw. geprüft; die Schilde der Lerche sind nicht betroffen)
| Datei | Stelle | Änderung |
|---|---|---|
| `shared/schilde.js` | neu | `layout`, `segmentOf`, `winkelBei`, `seitenMax`, `fuellen` |
| `server/sim/space.js` | `spawnEnemy` | Aufbau aus `Schilde.layout`; `e.waffen` für jede Klasse mit Plätzen |
| | `damageEnemy` | Segment statt `Physics.sectorOf` (Rückfall Sektor, wenn keine Layout-Zuordnung) |
| | `updateEnemies` | Regeneration über alle Segmente; Sperrfeuer/Bolzen/Lanze für jede Klasse mit `e.waffen` |
| | `onTargetScanned` | Scan-Texte Fregatte, Kreuzer |
| `server/sim/pilot.js` | `breitseite` (vorher `korvette`) | Seitenwechsel: Segment zur Lerche gegen stärkstes Segment der Gegenseite (`Schilde.seitenMax`); der Wechsel nach Waffenart (`seitenArt`) ist entfernt (D16) |
| `server/sim/entern.js` | Zeile 139 | `map(() => 0)` – längenunabhängig, unverändert |
| `server/game.js` | Snapshot `space.enemies` | `shieldsMax` entfällt, `shields` entfällt bei vollen Schilden, Waffenplätze nur `{platz, typ}` |
| `public/js/client.js` | `onSnap` | `Shared_Schilde.fuellen` ergänzt Standardwerte und Bogen-Geometrie |
| `public/js/render.js` | `drawEnemyIntel` | je Segment ein Bogen an der Längslage (Grenzen aus `winkelBei`, gleiche Zuordnung wie der Server) |
| `public/js/consoles.js` | `shieldText` (Ziel-Scan der Taktik, Liste „Gescannte Ziele“ am Captain) | Korvette unverändert „Schild Bug 1 Stb 2 Heck 0 Bb 2“; Fregatte/Kreuzer „Bug 2 Stb 3·0·3 Heck 1 Bb 3·3·3“ (von vorn nach hinten) |
| `public/js/art.js` | `drawEnemyM1` (Zeile 4355) | Wächter/Pylon lesen `shields[0]`, vier Sektoren, unverändert |
| `public/js/dev-mock.js` | Spawn, `damageEnemy`, Regeneration | Segmente und Klassen Fregatte, Kreuzer |
| `tools/test-features.js` | Zeilen 236, 520 | Standardwerte über `Schilde.fuellen` |
| `tools/test-combat.js` | `enemyShields`-Prüfungen, `e.shields` | unverändert (vier Sektoren) |
| `tools/sim-headless.js` | Bot-Gefahrenliste, Breitseiten-Anteil | Fregatte/Kreuzer mitgezählt; neue Option `--wellen-def` |
| `tools/test-klassen.js` | neu | Tabelle, Zuordnung, Plätze, Tempo, Snapshot, Bot-KI |

### 5.4 Snapshot („fehlt = Standard“)
- `space.enemies[].shieldsMax` entfällt ganz (Leser: Aufbau der Klasse aus der Config). `shields` fehlt, solange alle Segmente voll sind. `weapons` (nach Scan) trägt für
  Klassen mit Plätzen nur `{ platz, typ }`; `facing/arc/range` stammen aus `CONFIG.enemyWeapons[kind]`. Der Client füllt beides in `onSnap` mit `Shared_Schilde.fuellen`.
- Messwerte: §8. `test-klassen.js` misst zusätzlich 2 Kreuzer + 3 Fregatten + 7 weitere Gegner, alle gescannt.

### 5.5 Pilot-KI
- Eine Funktion für alle Breitseiten-Schiffe: `pilot.breitseite` mit `spaceM3b.pilotKlasse[kind] = { range, switchCd }` (Soll-Abstand, Mindestabstand der Seitenwechsel in s;
  Vorgabe `pilot.korvetteRange` 400 und 12 s). Fregatte 420 / 16 s, Kreuzer 440 / 20 s. `Pilot.BREITSEITE`/`isBreitseite` ersetzen `kind === 'korvette'`.
- Schwere Schiffe liegen seltener in der Breitseite (Lerche ruhend und schießend, 6 Seeds: Korvette 54–81 %, Kreuzer 51 %, Fregatte 34 %), weil ein Seitenwechsel
  (Segment aufgebrochen) bei kleiner Drehrate lange dauert. Balance ist Sache von EK9.

### 5.6 Spawn, Debug, Namen
- `Protocol.ENEMY_KINDS` um `fregatte`, `kreuzer` ergänzt (angehängt, Reihenfolge ist Protokoll). Debug `spawn fregatte|kreuzer` und `prise <kind>` laufen darüber.
- Namen/Labels: `space.js`, `arena.js`, `wellen.js`, `escort.js`, `render.js` (`ENEMY_NAMES/SIZE`). Jammer: `sprung.js` (`JAMMERS`). Fraktion: `entern.js` (rostmeute).
- Nicht in den Wellen: `arena.waves` und `wellen.typenAb` enthalten Fregatte/Kreuzer **nicht** (Welle 1–6 und Wellen All bleiben unverändert). Spawn per `spawnEnemy`, Debug, Regiebuch.
- `sim-headless arena --wellen-def "fregatte;kreuzer;fregatte,raider"` ersetzt `CONFIG.arena.waves` für Messläufe.

## 6. Entscheidungen EK1b
| # | Entscheidung | Grund |
|---|---|---|
| D8 | Schildmodell E1 (Segmente je Seite, Längsintervall) statt gemeinsamer Pools; Segmente flach in `e.shields`, Korvette bleibt der Fall „1 Segment je Seite“ | Planung E1; alle alten Indizes (Tests, Pilot, Anzeige) bleiben gültig |
| D9 | Längslage über den Seitensektor (Quadrat), nicht über die echte Rumpfgeometrie | Seitenwahl bleibt identisch zu Lerche/Korvette (Golden unverändert), die Taktik-Anzeige zeichnet exakt dieselben Grenzen; keine Winkelschwelle je Klasse |
| D10 | Gleich lange Intervalle je Seite, keine Config für Grenzen | `n` aus der Punkteliste genügt, Kreuzer = Drittel |
| D11 | Mehrere gleiche Plätze im Bogen verstärken die Breitseite (Lanze +50 % je weiteren, Batterie/Bolzen je Platz ein Geschoss) | „jeder Seitenbereich trägt eine Waffe“ soll spürbar sein; Korvette unverändert |
| D12 | Pilot-KI nur parametrisiert (`pilotKlasse`), `korvette()` → `breitseite()` | Baukasten statt Funktion je Klasse |
| D13 | Snapshot: `shieldsMax` ganz weg, `shields` nur bei Beschädigung, Waffenplätze ohne Geometrie | Ziel ≤ 18 944 B, Standardwerte aus der Config (Leser `Shared_Schilde.fuellen`) |
| D14 | Fregatte/Kreuzer nicht in `arena.waves`/`typenAb` | keine Änderung an Wellen und Wellen All ohne Freigabe |
| D15 | Platzhalter-Sprite in `art.js` (Korvette größer skaliert) bis die Drehsprites vom Team SPRITES kommen | Anzeige darf nicht „missing“ sein. **Überholt:** Die Drehsprites sind gemergt, die skalierte Korvette (`SPR_FALLBACK`) ist nur noch Rückfall |
| D16 | Seitenwechsel der Breitseiten-KI nur nach Schildstand und Lage, **nicht nach Waffenart** (EK1a-Regel entfernt) | Entscheidung der Studioleitung: `test-escort` (Balancing Geleit) fiel mit der Regel |

## 7. Berührungen außerhalb des Raum-Kerns
- `public/js/art.js`: ursprünglich ein Zweig in `drawEnemy` für `fregatte`/`kreuzer` (skaliertes Korvetten-Sprite) und `TELE_R`. Seit dem Merge von EK1b Sprites zeichnen Drehsprites (`SPR_KLASSE`, `public/voxel/sprites/`); die skalierte Zeichnung (`SPR_FALLBACK`) gilt nur, wenn Manifest, Sheet oder Eintrag fehlen.
- `public/js/render.js`: `ENEMY_NAMES`, `ENEMY_SIZE`, Farbe in `fbEnemy`/Randpfeil, `drawEnemyIntel` (Schildbögen je Segment).
- `public/index.html`: `<script src="/shared/schilde.js">`.
- Nicht berührt: `server/sim/away.js`, `shared/gen-siedlung.js`, `content/buehnen/`, `content/welt/`, `shared/sektoren.js`, `shared/locations.js`, Voxelwerk.

## 8. Abnahme EK1b Server
- `npm test`: Features 213/213, Kampf 387/387, **Klassen 59/59**, M3 380/380, Flug 80/80; dahinter Bausteine … Wellen All grün (einzeln gelaufen, siehe unten).
  **Damals rot, nicht von EK1b:** `tools/test-escort.js` „Balancing headless: deckt: mindestens die Hälfte heil (4/10)“ – identisch auf `ek1` ohne EK1b gemessen. Da `npm test`
  mit `&&` verkettet ist, brach es dort ab; alle Tests dahinter wurden einzeln ausgeführt (grün). **Erledigt:** Nach D16 ist `test-escort` grün (Lauf 2026-10-11: 84/84, „deckt“ heil 5/10) und `npm test` läuft mit Exit 0 durch.
- `npm run check` grün (199/199, Sektoren OK).
- `npm run snap:mess`: Worst Case max 11 444 B, Wellen 10 558 B (Ziel ≤ 18 944 B), unverändert zu EK1a. `test-klassen.js`: 2 Kreuzer + 3 Fregatten + 7 weitere Gegner, alle gescannt, 12 235 B;
  eine ungescannte Fregatte mit vollen Schilden 146 B im Snapshot.
- Bot-Arena `sim arena --pilot both --seeds 4` (Standardwellen): grün (Fehler 0, Softlocks 0). Mit `--wellen-def "fregatte;kreuzer;fregatte,raider" --wave-limit 240`: nose 2,8 von 3 Wellen
  (Fregatte allein 4/4 Seeds geschlagen, 44–79 s), maneuver 2,5 von 3 (Kreuzer in 2 von 4 Seeds über 240 s: der Bot feuert die Lanze kaum); Fehler 0, Softlocks 0.
- Golden m1–m3, 20 Seeds, gegen `base-w2` mit `allow-ek1.json`: **GOLDEN GRÜN**, 80/120 Traces byte-identisch, die übrigen 40 (m1/m2 solo) sind die bekannten Abweichungen aus EK1a.
  Kontrolle: m1 und m2, Crew 1, Seed 1 auf `ek1` (ab4584b) und auf `ek1b-raum` sind **byte-identisch** – EK1b fügt keine neue Golden-Abweichung hinzu, kein `allow-ek1b.json` nötig.

## 9. Offen
- **Balance Breitseite** (EK9): schwere Schiffe liegen seltener in der Breitseite (Fregatte 34 %, Kreuzer 51 %, Korvette 54–81 %), Kreuzer-Lanze wird vom Bot kaum gefeuert (5.5, 8).
- **Sprites:** Lesbarkeit der Silhouetten bei kleiner Darstellung (Vorschau 30/50/80 px in `public/art-preview.html`; der 30-px-Befund steht nicht in einem Vertrag, nur im Bericht des Sprite-Teams).
- **Störsender-Regel:** `JAMMERS` in `server/sim/sprung.js` enthält `raider`, `korvette`, `fregatte`, `kreuzer`; jeder lebende Gegner dieser Klassen blockiert den Faltsprung (Folge siehe CONTRACT-EK8, Abschnitt 1).
- **Wellen:** Fregatte und Kreuzer sind nicht in `arena.waves`/`wellen.typenAb` (D14); Aufnahme braucht Freigabe der Studioleitung.
- **Altstände (D2, D4):** Die Voxelwerk-Datei `rostmeute_kanonenboot.json` (anderes Repository) und ältere Golden-Basen mit `gunboat` bleiben unverändert.
