# CONTRACT-EK3B – Konvoi-Szene mit Plünderung (EK3 Teil B)

Grundlage: `Briefing Eisenwald-Kampagne (EK1-EK9)` (EK3 „Konvoi-Szene“, Leitplanken), `Planung Eisenwald-Kampagne (EK1-EK9)`, `Welt/Feldzug Eisenwald`
und `Welt/Funktexte Feldzug Eisenwald` (Kapitel 2, Rabenpass) im Vault (`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`), `CONTRACT-EK3.md` (Teil A: Frachtraum,
Fracht, Beamen). Branch `ek3-konvoi` (Basis `ek1` mit EK1a/b, EK2, EK3a, EK7), Team KONVOI.

## 1. Stand
| Schritt | Inhalt | Stand |
|---|---|---|
| B1 | `server/sim/konvoi.js`: Transporter (Gegnerseite, unbewaffnet), Eskorte, Route, Sprung, Siegbedingungen, Ausgänge, Wiederholung | fertig |
| B2 | Haken in `space.js` (3 Stellen), `game.js` (Debug), Konfiguration `CONFIG.konvoi` und `enemies/enemyShields/enemyWeapons/hitRadius.frachter` | fertig |
| B3 | Bausteine `konvoi_an`, `konvoi_ende`, `konvoi_ausgang`, `konvoi_erfolg`, `konvoi_uebrig`; Szenentyp A15, Molekül `konvoi_abfangen` (Umsetzungen `pluendern`, `aufhalten`), Labor-Einträge | fertig |
| B4 | Client: Transporter-Sprite (Gegner, ohne Schutzring), Name, Sprung-Fortschrittsring | fertig |
| B5 | Tests `tools/test-konvoi.js` (116 Prüfungen), Bots im Labor (`sim-headless.js`), Snapshot-Aufbau „konvoi“ in `snap-mess.js` | fertig |

## 2. Entscheidungen
| # | Entscheidung | Grund |
|---|---|---|
| D1 | Transporter sind **gewöhnliche Gegner** in `space.enemies` (`kind: 'frachter'`, `e.kv = 'f'`), nicht die Schützlinge von `escort.js` | gleiche Regeln: Schaden, Schilde, Zerstörung, Marken, Zielwahl, Lanze, Bots laufen über `damageEnemy` ohne Sonderweg. Der Schützlings-Pfad (Spielerseite, `space.escorts`, Escort-Klasse `frachter`) bleibt unverändert und funktioniert neben dem Konvoi (Test) |
| D2 | Neues Modul `konvoi.js`; Haken in `space.js` nur: `updateEnemies` (`Konvoi.faehrt(e)` → `Konvoi.fahre`, wie die Patrouille), `update` (`Konvoi.update`), `enemySnapExtra` (`sj`). Zerstörung erkennt das Modul selbst (die ID ist weg), kein Haken in `damageEnemy` | Zusammenführen mit FLOTTE und KETTE klein halten |
| D3 | Fahrt: `Flight.stepBody` mit `shipClasses.frachter` und `Pilot.escort` (Wegpunkt-Steuerung, mit Ausweichen), Tempo `konvoi.tempo` (Anteil der Höchstfahrt; die nächste Stufe wird gewählt: Standard ½ = 45 px/s) | dieselbe Physik wie jedes Schiff |
| D4 | **Route** aus Anteilen der Szene (`CONFIG.konvoi.route`, Länge × Breite), von der Seite der Lerche weg (gespiegelt, wenn sie in der zweiten Hälfte steht), Rand 250. Rabenpass (3000 × 2200, offen) ergibt ≈ 3650 px, rund 80 s | Szene aus Daten, kein fester Ort |
| D5 | **Sprung:** am letzten Wegpunkt 4 s Aufladung (`sj` im Snapshot, ODA, Ring in der Karte), dann weg. **Notbremse:** nach `springSpaetestens` (180 s) springt ein festgefahrener Konvoi trotzdem | der Konvoi „springt am Ende“, die Szene darf nie hängen |
| D6 | **Eskorte wacht:** Jäger kreist um den Konvoi, Korvette hält querab. Kein Feuer, bis die Lerche näher als `wachRadius` (520) an einen **Transporter** kommt oder ein Konvoi-Schiff getroffen wird. Treffer durch Brocken zählen nicht. Danach Klassen-KI (`e.wache = false`), Transporter fahren eine Stufe schneller bei `eilig` | Eskorte nutzt die Klassen-KI der Korvette und des Jägers; der Spieler bestimmt den Beginn des Gefechts |
| D7 | **Aufhalten:** alle Transporter zerstört → `aufgehalten`; der erste Sprung → `entkommen` | Briefing „bevor sie springen“ |
| D8 | **Plündern:** jeder zerstörte Transporter wirft **eine** Fracht ab (`fracht_abwerfen(game, x, y, art)`, Teil A). Geschafft (`gepluendert`), sobald `beute_min` Ladungen der Art an Bord sind (Standard = Zahl der Transporter, höchstens die Kapazität 2) **und** mindestens eine davon in dieser Szene geholt wurde. `entkommen`, sobald `an Bord + draußen liegend + noch fahrende Transporter < beute_min` | Beute lässt sich nicht mehr erreichen; liegende Fracht gilt, bis man das System verlässt |
| D9 | **Wiederholung** (Parameter `wiederholung`, Standard an): bei `entkommen` kommt nach `neuNach` (8 s) ein neuer Konvoi (Reste weg, neu am Start, neue Route). **Schon an Bord liegende Fracht bleibt** (Regel „bis man das System verlässt“); der neue Konvoi hat dann entsprechend weniger Transporter (Plündern: `n − an Bord`, mindestens 1), sonst wäre das Lager mit 2 Ladungen nie zu füllen. Aufhalten: voller Konvoi | die Szene darf scheitern, der Feldzug nie |
| D10 | **Ausgangs-Kennungen** `gepluendert | aufgehalten | entkommen` ohne Umlaut (wie `rueckzug` in EK2). Das Regiebuch geht bei Erfolg (`konvoi_erfolg`) zu `{{weiter}}`; `entkommen` löst die Wiederholung im Modul aus (kein zweiter Regiebuch-Ausgang, kein Eingriff in den Szenenbau). Wer einen eigenen Ausgang will, setzt `wiederholung: false` und prüft `konvoi_ausgang entkommen` | Konflikt mit KETTE vermeiden; EK8 kann verzweigen, ohne dass der Szenenbau etwas Neues lernt |
| D11 | Fracht der Aufhalten-Szene wird auch abgeworfen (Beute optional, Teil A) | ein Mechanismus für beide Siegbedingungen |
| D12 | Hülle des Transporters `CONFIG.enemies.frachter.hp = 40` (wie die Korvette), Schilde `[1,1,1,1]`, `hitRadius.frachter = 34`, `salvage 40`. Mehrspieler-Skalierung über `crewScale` wie jeder Gegner | im Bot-Test brauchten 60 Hülle für Zweier-Crews mehr Zeit als das Fenster der Route (~50 s ab Kontakt) |
| D13 | Wirksame **Reichweite und Haltefortschritt** des Beamens: unverändert Teil A (`fracht.beamRange` 320, 3 s, Balken in der Taktik) | Antwort auf die Fragen des Briefings (CONTRACT-EK3 D5/D6), kein Neubau |

## 3. Schnittstellen
### 3.1 Server (`server/sim/konvoi.js`)
- `an(game, { n?, eskorte?, sieg?, ladung?, tempo?, beute_min?, wiederholung? })`: Konvoi in der aktuellen Szene einrichten (`n` 1–3, Standard 2; `eskorte` `voll|jaeger|korvette|keine`;
  `sieg` `aufhalten|pluendern`, Standard `pluendern`; `ladung` `sprengstoff|fracht`). Zustand `game.space.konvoi`, je Szene neu (Szenenwechsel löscht ihn von selbst).
- `update(game, dt)` (aus `space.update`), `fahre(game, e, dt)` und `faehrt(e)` (aus `space.updateEnemies`), `snapExtra(e)` (Snapshot-Feld `sj`), `neu(game)`, `erzwingen(game)` (Überspringen).
- Abfragen: `aktiv`, `ausgang`, `erfolg`, `ausgangIst(game, was)`, `uebrig` (fahrende Transporter), `gesprungen`, `zerstoert`, `transporter`, `mitglieder(game, 'f'|'e')`.
- Konsolen-Debug: `konvoi [n] [aufhalten|pluendern] [voll|jaeger|korvette|keine]`.

### 3.2 Regiebuch (`server/mission/bausteine/konvoi.js`, Vertrag in `content/regiebuch/bausteine.json`)
| Baustein | Art | Parameter |
|---|---|---|
| `konvoi_an` | Aktion | `n?`, `eskorte?`, `sieg?`, `ladung?`, `tempo?`, `beute_min?`, `wiederholung?` |
| `konvoi_ende` | Aktion | – (Überspringen: Szene als geschafft) |
| `konvoi_ausgang` | Prüfung | `was` (`gepluendert|aufgehalten|entkommen`) |
| `konvoi_erfolg` | Prüfung | – |
| `konvoi_uebrig` | Prüfung | `max?` (Standard 0) |
Ereignisse (missionEvent): `konvoiKontakt`, `konvoiTransporterZerstoert { id, art, x, y, pod }`, `konvoiSprungStart`, `konvoiSprung`, `konvoiAlarm { grund }`, `konvoiAusgang { was, sieg, versuch }`.
Ereignisse (emit, Client): `konvoiSprung { x, y }`, `konvoiAusgang { was }`.

### 3.3 Katalog und Labor
- Szenentyp **A15 Konvoi** (`content/katalog/szenentypen/konvoi.json`), Mechanik `konvoi` (verfügbar).
- Molekül `konvoi_abfangen` (`content/katalog/molekuele/konvoi_abfangen.json`) mit den Umsetzungen **`pluendern`** und **`aufhalten`**; Parameter `loc` (Pflicht), `transporter` (1–3, Standard 2),
  `eskorte`, `ladung` und `beute_min` (nur Plündern), `wiederholung`, `lage`. Labor-Test-Ort **Rabenpass** (auch der Kampagnen-Ort).
- **Kampagne (EK8):** `konvoi_abfangen/pluendern` mit `transporter: 2`, `ladung: sprengstoff`, `loc: rabenpass`; danach `fracht_abnehmer` (Statio Limitis) und Abgabe.
  Die Funktexte des Kapitels (Kontakt, „Fracht in Reichweite“, Springen, „Zurück zur Statio“) kommen aus dem Modul als ODA-Meldungen und sind dort als Text anpassbar.

### 3.4 Snapshot
Transporter und Eskorte stehen wie jeder Gegner in `space.enemies` (Felder wie bisher, zusätzlich `sj` 0..1 nur während der Sprungaufladung). Kein neues Top-Level-Feld.
Worst Case Konvoi (3 Spieler, 3 Transporter, Eskorte, alle gescannt, Fracht, Beamen): **8258 B** (Aufbau „konvoi“ in `tools/snap-mess.js`).

## 4. Abnahme
Siehe §5. Nicht Teil dieser Abnahme: Balancing mit Menschen (EK9), Voxel-Modell des Transporters im Frontbild (er erscheint dort wie jeder Gegner über die 2D-Taktik und die Randpfeile),
Bot-Solo (siehe §6).

## 5. Messwerte
- **`npm test`** (inkl. `tools/test-konvoi.js`, 116 Prüfungen), **`npm run check`**, **`npm run snap:mess`** grün (2026-10-11).
- **Bots** (`node tools/sim-headless.js labor konvoi_abfangen/<umsetzung> --seeds 3 --crew 3`): Aufhalten **3/3** (Median 4,5 min inkl. Wiederholungen), Plündern **3/3** (Median 2,2 min).
  Crew 1: 0/3 und 0/4, siehe §6.
- **Snapshot:** Worst Case unverändert 11 444 B, Konvoi 8258 B, Ziel ≤ 18 944 B.
- **Golden m1–m3** (`--all --seeds 20 --jobs 4`, 120 Traces) gegen `base-w2` mit `allow-ek1.json`: **GOLDEN GRÜN**, 80/120 Traces byte-identisch, die 40 anderen sind die bekannten Crew-1-Läufe von m1/m2 (EK1a-Korvette, Mediane m1/1 −6,7 %, m2/1 +2,1 %, wie in `allow-ek1.json`). Der Ordner `ek3b-check` ist gelöscht.

## 6. Offene Punkte
- **Solo-Bot** schafft die Szene nicht (0/4): Der Solo-Bot wechselt zwischen Steuer und Taktik, das kostet gegen einen fahrenden Konvoi zu viel Zeit; Waffen unbesetzt feuern mit 50 %. Mehrspieler ist der Maßstab, die Szene ist
  trotzdem für einen Menschen allein nur mit Mühe zu gewinnen (Balancing im Spieleabend: `tempo`, Hülle, `wachRadius`).
- Die Route ist für **offene Szenen** gedacht (Rabenpass: keine Brocken). In dichten Brockenfeldern (Splittergürtel) weicht der Konvoi aus und kommt kaum voran; die Notbremse (180 s) fängt das ab.
- Kein eigenes Voxel-Modell für den Transporter im Frontbild; Eskorte und Transporter haben keine Funktexte je Schiff (Funk steht auf dem Szenen-ODA).
- Der Szenenbau kennt keinen eigenen Ausgang „entkommen“ (D10); EK8 kann `konvoi_ausgang` im Regiebuch prüfen.
