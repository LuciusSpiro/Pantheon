# CONTRACT-EK2 – Raum-Alarm: Minen und Schleichfahrt

Grundlage: `Briefing Eisenwald-Kampagne (EK1-EK9)` (EK2), `Planung Eisenwald-Kampagne (EK1-EK9)` (EK2, E4), `Arbeitspaket Raum-Alarm und K4`, Szenentypen
(Schleichfahrt: Regeln, Kai 2026-10-07), Sektor-Einflüsse, Bodenkampf (Stand B2) und Planung Welle 1+2 (D31–D33) im Vault
(`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`). Kai am 2026-10-11 (Details im Briefing). Team RAUM2, Branch `ek2-raum2` (Basis `ek1`).

## 1. Befund (vor EK2)
| Punkt | Stand |
|---|---|
| Minen, Alarmstufe, Signatur, Patrouillen im Raum | gab es nicht (Planung: „Neubau“ bestätigt). Der Boden-Alarm (B2) ist Vorbild für die Form (Stufen, Lärm), nicht wiederverwendbar |
| Weitscan | deckt nur versteckte Funde (`explore.widescanAt`) und Bojen auf. Radius 1000, Abklingzeit 20 s |
| Nebel | wirkt auf dem Server nur in „Wellen All“ (`nebelServer: 'wellen'`, D31/D32), die Bewegung der Gegner kennt keine Sensorgrenze (D33) |
| Notfallsprung | gab es (`sprung.notsprung`, Ereignis `notsprung`, Prüfung `notgesprungen` je Mission), aber keinen Ausgang „Rückzug“ in Szenen |
| Mechanik `schleichfahrt` / Szenentyp A13 | im Katalog „geplant“ |
| Ausgänge im Regiebuch | `ausgaenge` kennt beliebige Kennungen (`complete: '<ausgang>'`); der Szenenbau (Grobplan) kennt nur `weiter` |

## 2. Gebaut
| Schritt | Inhalt | Datei |
|---|---|---|
| 1 | **Alarmstufe je Raumszene** (0 ruhig, 1 misstrauisch, 2 alarmiert), Auslöser `laerm`, `entdeckt`, `mine`; Zustand `game.space.alarm`, je Szene neu (`enterScene`) | `server/sim/alarm.js` |
| 2 | **Lärm:** Waffenfeuer der Lerche (Lanze, Salve, Bolzen), Antrieb auf Energie 4, Reaktor überladen. Punkte der letzten 30 s (Waffen 1, Antrieb 1 je 4 s, Reaktor 2): ≥ 1 misstrauisch, ≥ 2 alarmiert; ohne neuen Lärm beruhigt sich die Szene | `alarm.js`, Haken in `space.js` |
| 3 | **Patrouillen** mit Strecke, Sensorkreis (Signatur × 420 px, misstrauisch +35 %, „wissen“ +50 %), Entdeckung nach 1,2 s im Kreis; nur nah (260 px) oder 8 s nach dem Weitscan im Snapshot; kein Feuer, bis Alarm | `alarm.js`, `space.updateEnemies` |
| 4 | **Folge „alarmiert“:** alle Patrouillen greifen an (`Pilot.initSpawn`); ohne lebende Patrouille **nach 5 s zwei Jäger (`raider`, Tag `einsprung`) am nächstgelegenen Sprungpunkt**, ODA-Ansage sofort (Ereignisse `einsprungAnsage`, `einsprung`) | `alarm.js` |
| 5 | **Minen:** Position per Weitscan (für die Szene sichtbar, ganz nah auch ohne), Zünden bei Annäherung (70 px, nicht beim Besitzer), Explosion (160 px): **ignoriert Schilde**, **6 Schritte Systemschaden** (ok → beschädigt → zerstört, je Schritt ein zufälliges nicht zerstörtes System), Schiffe im Radius 20 Hülle ohne Schilde, **Alarm**. **Abschießbar:** Lanze, Bolzen, Batterie auf die angewählte Mine (Mine ist anwählbar und scanbar); Explosion auf Distanz, Alarm | `alarm.js`, `space.js` (lanceTrace, updateProjectiles, updateSalvos, resolveTarget) |
| 6 | **Signatur:** `0,15 + 0,85 × Tempo/130`, × 0,5 Schilde unten, × 0,6 in der Nähe von Brocken (110 px), × 0,6 im Nebel nur mit Schalter, Weitscan = 1,0 für 4 s. Anzeige `ship.sf.sig` | `alarm.js` |
| 7 | **Taktik-Knopf „Schilde hoch/runter“** (Kommando `weapons.schilde { unten }`, Taste H): unten = Treffer gehen an den Schilden vorbei (`pierce`), hoch = 3 s Hochfahren (noch ungeschützt). Nur in einer Schleichfahrt | `alarm.js`, `game.js`, `consoles.js` |
| 8 | **Bausteine:** Aktionen `raum_alarm_an`, `spawn_patrouille`, `minenfeld`, `schleichfahrt_an`; Prüfungen `alarm_stufe`, `schiff_bei`, `rueckzug`, `minen_uebrig` (+ Einträge in `bausteine.json`) | `server/mission/bausteine/raumalarm.js` |
| 9 | **Ausgang „Rückzug“:** Prüfung `rueckzug { loc }` (Notfallsprung aus dem Ort seit Beginn des Schritts, `game.notsprungVon/-T`), Platzhalter `{{rueckzug}}` in Umsetzungen, Grobplan-Feld `rueckzug` je Szene (Szene oder `ausgang:<key>`) | `sprung.js`, `katalog.js`, `szenenbau.js`, `labor.js` |
| 10 | **Katalog:** Mechaniken `schleichfahrt`, `minen`, `raum_alarm` verfügbar; Szenentyp **A13 Schleichfahrt verfügbar**; Umsetzungen `unbemerkt_durchfliegen/patrouillen_schleichfahrt` und `kurs_durch_gefahr/minenfeld` (beide im Labor und im Grobplan-Katalog) | `content/katalog/` |
| 11 | **Client:** Minen (gestrichelte Ringe, anklickbar), Zielkreis, Patrouillen mit Sensorkreis, Alarmbanner, Taktik: Signatur und Knopf | `render.js`, `consoles.js` |
| 12 | **Bots** (`tools/sim-headless.js`): `schleichNav` – Schilde runter, Weitscan nur wenn keine gesehene Patrouille nah, ¼ Fahrt, Minen und vorausgeschätzte Patrouillenlage umgehen | `sim-headless.js` |

## 3. Antworten auf die Fragen des Briefings
1. **Wie löst der Notfallsprung den „Rückzug“-Ausgang aus, ohne das Ziel zu werten?** Die Umsetzung hat zwei Kanten am Schritt: `{ v: <id>_ziel } → {{weiter}}` und
   `{ check rueckzug { loc } } → {{rueckzug}}`. `rueckzug` ist wahr, wenn `sprung.notsprung` seit Beginn des Schritts aus diesem Ort gesprungen ist
   (`game.notsprungVon === loc`, `notsprungT ≥ Schrittbeginn`). Das Ziel-Flag wird dabei nie gesetzt. Im Grobplan steht das Ziel des Rückzugs in `rueckzug` der Szene
   (`ausgang:rueckzug` oder eine Szene); fehlt es, entfällt die Kante (Mission bleibt im Schritt). Das Labor-Testbuch bekommt den Ausgang `rueckzug`. Das Regiebuch-Schema
   brauchte keine Änderung (`ausgaenge` kennt beliebige Kennungen), neu ist nur die Prüfung und die Platzhalter-/Grobplan-Verdrahtung.
2. **Nebel in der Kampagne (`nebelServer`)?** Entscheidung E4 der Studioleitung: **nicht eingeschaltet**, `CONFIG.sensors.nebelServer` bleibt `'wellen'`. Die Schleichfahrt dämpft Signatur
   über Asteroiden, Tempo und Schilde. Der Nebel ist als **Schalter vorbereitet** (`CONFIG.alarm.signatur.nebel.schalter`, Standard aus, Faktor 0,6; wirkt nur in Orten mit `fog`).
   Gegner im Nebel finden die Lerche weiter immer (D33) – bleibt offen, die Patrouillen brauchen den Nebel nicht.
3. **Darf der Katalog Schleichfahrt und Minen freischalten?** Ja, umgesetzt: Mechaniken `schleichfahrt`, `minen`, `raum_alarm` = verfügbar, A13 verfügbar, zwei Umsetzungen
   bestehen den Prüfer (Testwerte), erscheinen im Labor und im Grobplan-Katalog (`node tools/katalog.js`: 27 Szenentypen, davon 17 verfügbar (vorher 16), 40 Umsetzungen, alle verfügbar).

## 4. Entscheidungen der Studioleitung (RAUM2)
| # | Entscheidung | Grund |
|---|---|---|
| D1 | Alarm ist je Szene **ausdrücklich einzuschalten** (Bausteine); ohne das ist kein Zustand da und kein Snapshot-Feld | Golden m1–m3 und alle alten Szenen bleiben byte-gleich; „fehlt = Standard“ |
| D2 | „Antrieb Stufe 4“ = **Energie 4 auf dem Antrieb** (`ship.power.engines`), nicht die Fahrstufe | die Energiestufe heißt im Spiel „Stufe“ und gehört zur Gruppe Reaktor/Energie; die Fahrstufe steckt schon in der Signatur. Schwelle in `CONFIG.alarm.laerm.antriebEnergie` |
| D3 | **Lärm in Punkten über ein Fenster** (30 s), nicht als Zähler ohne Ende; Reaktor überladen zählt doppelt (= sofort alarmiert) | ein Schuss warnt, zwei Schüsse alarmieren, Ruhe beruhigt; einfach zu lesen und zu testen |
| D4 | **Misstrauisch** weitet die Sensorkreise (+35 %), „wissen“ startet misstrauisch (+50 % Kreis, ein Lärm-Ereignis alarmiert, beruhigt sich nie) | „Gegner wissen von der Lerche“ braucht eine Wirkung, die in der Schleichfahrt spürbar und ohne Plot-Wissen der Gegner im Nebel auskommt |
| D5 | **Patrouillen ignorieren Brocken**, die Automatik der Taktik (unbesetzt) schießt nicht auf ruhige Patrouillen und Minen | sonst löst die Automatik den Alarm aus bzw. Brocken-Schaden verrät die Patrouille |
| D6 | Patrouillen sind **nur nah oder nach dem Weitscan** im Snapshot; Sensorkreis im Snapshot = der **wirksame** Radius (`pat`) | Weitscan hat damit einen Preis (verrät auch die Lerche, 4 s Signatur 1,0); die Taktikkarte zeigt, wohin man nicht darf |
| D7 | **Minen sichtbar** nach Weitscan für den Rest der Szene; nahe Minen (180 px) auch ohne Weitscan | „Positionen zeigt der Weitscan“; ganz nah sieht man auch ohne, sonst ist Zünden unfair |
| D8 | **Sprengradius 160 px, Zündradius 70 px**: eine abgeschossene Mine trifft die Lerche nur, wenn sie im Sprengradius steht (Alarm immer) | „Explosion auf Distanz, macht trotzdem Alarm“ |
| D9 | **`ohne_strom` = Blindgänger** (zündet nicht, kein Alarm, abgeschossen nur ein Hinweis). Der Parameter ist da, die Kampagne nutzt ihn nicht | Lesart des „für später“-Parameters; Kai kann die Bedeutung (z. B. „Weitscan zeigt sie nicht“) noch ändern |
| D10 | Minen haben einen **Besitzer** (`gegner` oder `lerche`); `gegner`-Minen zünden bei der Lerche, nicht bei Gegnern, `lerche`-Minen bei Gegnern, nicht bei der Lerche. Schiffe im Sprengradius nehmen 20 Schaden ohne Schilde; keine Kettenreaktion zwischen Minen | gleiche Regeln für Spieler und Gegner |
| D11 | Systemschaden = **6 Schritte**, je Schritt ein zufälliges nicht zerstörtes System (ok → beschädigt, beschädigt → zerstört); `damageSystem` über die bestehende API (ohne Einzelansage, eine Sammelansage) | 6 Punkte „beschädigt 1, zerstört 2“; zerstörte Systeme bleiben unberührt, dann bricht die Verteilung ab |
| D12 | **Schilde unten** = `pierce` für jeden Treffer, Schildpunkte bleiben; Hochfahren 3 s ohne Schutz, Signatur steigt sofort | „steht ohne Schutz da, bis die Schilde wieder oben sind“ |
| D13 | Der Einsprung kommt **einmal je Szene** und nur, wenn zum Zeitpunkt des Alarms keine **lebende** Patrouille da ist (Patrouille = Gegner mit `patrolle`, auch freigegebene) | Wortlaut „Gibt es keine, springen …“ |
| D14 | Schleichfahrt-Szenen erzeugen Patrouillen/Minen **in Bändern zwischen Ankunft und Ziel** aus eigenem Zufall (Seed + Ort), `game.rng` bleibt unberührt; Umsetzungen mit `restartOnReturn` | wiederholbar für Bots und Labor, Reset beim Zurückkommen |
| D15 | Der Katalog-Ausgang „Rückzug“ nutzt `{{rueckzug}}` / Grobplan-`rueckzug` (Kante entfällt ohne Ziel) | kein Schema-Umbau, `weiter` bleibt der Hauptweg |
| D16 | Patrouille `tempo` 45 px/s (zuerst 55), Bot-Pilot schätzt die Lage voraus | 55 war mit ¼ Fahrt (35 px/s) für Bots kaum passierbar; Balance ist Sache von EK9 und den Spieleabenden |

## 5. Berührte Dateien
Neu: `server/sim/alarm.js`, `server/mission/bausteine/raumalarm.js`, `tools/test-alarm.js`, `CONTRACT-EK2.md`.
Geändert: `server/sim/space.js` (Haken: Szene, Treffer, Lärm, Lanze/Bolzen/Salve auf Minen, Ziele, Weitscan, Patrouillen, Tick), `server/game.js` (Snapshot, Kommando),
`server/sim/sprung.js` (2 Felder), `shared/config.js` (`alarm`), `server/mission/{katalog,labor,szenenbau}.js` (Rückzug), `content/katalog/*` und `content/regiebuch/bausteine.json`,
`public/js/{render,consoles}.js`, `tools/{sim-headless,snap-mess}.js`, `tools/fixtures/context/*.context.json` (Goldens des Spielleiter-Kontexts: der Katalog ist gewachsen, `--update`), `package.json`, `README.md`.
Nicht berührt: `server/sim/interior.js` (nur die bestehende `damageSystem`-API), `server/sim/away.js`, `shared/gen-*.js`, `content/welt/`, `public/js/art.js`.

## 6. Abnahme
- **Labor** (Bots belegen, Menschen prüfen die Lesbarkeit beim Spieleabend):
  - Mine zünden: `kurs_durch_gefahr/minenfeld` und `test-alarm` „Minen: zünden“ (6 Punkte, Schilde ignoriert, Alarm, Einsprung nach 5 s).
  - Mine abschießen: Lanze, Bolzen, Batterie; außerhalb und innerhalb des Sprengradius.
  - Schleichfahrt durchlaufen: `unbemerkt_durchfliegen/patrouillen_schleichfahrt` (Test mit gezieltem Flugweg ohne Alarm; Bots s. u.).
  - Schleichfahrt mit Entdeckung: Entdeckung durch Patrouille (alle greifen an) und Lärm ohne Patrouille (Einsprung nach 5 s, Ansage).
  - Rückzug: Notfallsprung beendet die Mission mit Ausgang `rueckzug`, Ziel nicht gewertet.
- Ergebnisse (Stand dieses Commits): siehe §7.

## 7. Messwerte
- `npm test` grün (EXIT 0): Features 213, Kampf 387, Klassen 59, M3 380, Regiebuch 186, Weltstand 170, Bühne 470, Waffen 132, **Alarm 145/145** (neu, `tools/test-alarm.js`, in `npm test`).
  Das Spielleiter-Kontext-Golden (`tools/fixtures/context/*`) wurde bewusst mit `--update` neu geschrieben (Katalog um A13 und zwei Umsetzungen gewachsen).
- `npm run check` grün (303/303, Sektoren OK).
- `npm run snap:mess` (neuer Aufbau „raum-alarm“: 4 Patrouillen, 12 Minen, 8 gescannte Gegner, Alarm, 3 Spieler): **max 11 384 B**; Worst Case 11 444 B und Wellen 10 558 B unverändert (Ziel ≤ 18 944 B).
- **Golden m1–m3**, 20 Seeds, gegen `base-w2` mit `allow-ek1.json`: **GOLDEN GRÜN**, 80/120 Traces byte-identisch (die übrigen 40 sind die bekannten EK1a-Abweichungen m1/m2 solo, identisch zu EK1b), kein `allow-ek2.json` nötig. Ordner gelöscht.
- **Bots** (`sim-headless labor …`, Spielzeit ab Szenenbeginn): Schleichfahrt Crew 1: 6/6 erledigt, Median 2,1 min, 2 von 6 Läufen entdeckt (kämpfen sich durch); Crew 3: 8/8, 2,0 min, 2 von 8 entdeckt;
  Minenfeld: Crew 1 8/8 (1,0 min), Crew 3 8/8 (0,9 min), ohne Alarm. Fehler 0, Softlocks 0. Bots ≠ Menschen: Lesbarkeit beim Spieleabend prüfen.

## 8. Offen
- Lesbarkeit und Balance (Patrouillentempo 45, Sensor 420, Sprengradius 160, Einsprung) beim Spieleabend; Balance EK9.
- `ohne_strom` (D9) und Nebel-Schalter (E4, D33) warten auf Kais Entscheidung/Folgepaket.
- Client nur per Syntaxprüfung und Code-Durchsicht geprüft, nicht im Browser. `dev-mock.js` kennt Minen/Alarm nicht.
- Grobplan-Prompts des Spielleiters (LLM) nennen das Feld `rueckzug` nicht; die Kampagne nutzt feste Regiebücher.
- Kampagnen-Regiebuch Nebelheim (Minen um die Methalle) kommt mit EK8; Bausteine `spawn_patrouille`/`minenfeld` sind dafür da.
