# CONTRACT-M3B – Schritt A „Ein Flugmodell für alle“ + Schild- und Schadenslogik

Ergänzung zu `CONTRACT.md` und `CONTRACT-M0.md` bis `CONTRACT-M3.md` (inklusive §20 und §21). Vorhandene Feldnamen werden nicht
gebrochen, außer dort, wo dieser Vertrag etwas ausdrücklich entfernt. Bei Widerspruch gilt der Code. Abweichungen meldet
jedes Team in seinem Bericht.

- Pitch: https://claude.ai/artifact/E7VLD4NkEBLao86NRbZYLh
- Brain-Vault: `Coop-Spiel/Ausbaustufe Raumkampf.md` (Abschnitt „Richtung M3b“)

## 0. Ziel und Entscheidungen

**Ziel.** Schiffe sollen sich wie Schiffe steuern:
- Die Lerche und das Kanonenboot sind träge und haben einen Temporegler in Stufen. Am wendigsten sind sie bei halber Fahrt.
- Zwei gleich wendige Schiffe umkreisen sich und beschießen sich mit Breitseiten.
- Jäger sind schnell, haben nur Frontwaffen und können nicht stehen bleiben. Deshalb schießen sie bei einem Angriff vorbei.
- Starke Schilde lohnen sich. Schwache Schilde lassen Kratzer durch, und Kratzer machen Arbeit.

**Entscheidungen von Kai (2026-10-06):**
1. Temporegler in Stufen: Rückwärts, Stopp, ¼, ½, ¾, Voll.
2. Die Drehrate hängt vom Tempo ab, bei ½ ist das Schiff am wendigsten.
3. Ausweichen bleibt.
4. Der Schildstoß fällt weg. Der Captain behält den Überblick und läuft als Erster los.
5. Seitentreffer beschädigen Seitensysteme, das bleibt so.
6. Der Schildpool steigt von 4 auf 6 (`shields.pointsPerPower` 2 → 3).
7. Die Kanonenboot-Systeme bleiben vorerst weg. Gegner bekommen in diesem Schritt keine Systeme.
8. Die unbesetzte Steuer bekommt **keine Sonderbehandlung**. Die Stufe bleibt, das Ruder geht auf 0, das Schiff fährt
   weiter. Das bisherige „Stationshalten bei unbesetzter Steuer“ entfällt.
9. Die Schild- und Schadenslogik kommt schon in Schritt A, wie in §4 beschrieben. Systemschaden bei Schild 1 liegt bei
   **20 %**, bei Schild 2 bei **5 %**.
10. Der Captain-Ping entfällt.

**Nicht in Schritt A:**
- Gegner mit eigenen Systemen
- Minispiele je Systemtyp
- Wächter als Schiff (darf kinematisch bleiben)
- Grafik (die kommt in M4)

**Nicht brechen:** Die Außenmissionen bleiben, wie sie sind. Missionen m1–m3 müssen weiter durchspielbar sein. Grün bleiben
`npm run check`, `npm test`, `npm run sim` und `node tools/ws-smoke.js`.

## 1. Dateibesitz (Phase A, parallel)

| Team | Dateien |
|---|---|
| Studioleitung | `CONTRACT-M3B.md`; Config-Block `shipClasses` + `spaceM3b` (schon eingetragen, Teams dürfen Werte ergänzen) |
| SERVER-FLIGHT | **neu** `shared/flight.js`, **neu** `server/sim/pilot.js`, `server/sim/space.js` (Flug, Gegner, Waffen, Ausbau des Schildstoßes in space.js; `shipHit` wird eine dünne Hülle um `damage.resolveHit`), `server/sim/arena.js`, `server/missions/*.js` (nur falls Spawns Anfangstempo brauchen), `shared/config.js` (nur ergänzen) |
| SERVER-DAMAGE | **neu** `server/sim/damage.js`, `server/sim/interior.js`, `server/sim/bots.js`, `server/game.js`, `server/sim/mission.js`, `shared/protocol.js` (nur ergänzen oder als Altname markieren) |
| TOOLS | `tools/**`, `package.json` |
| CLIENT | `public/**` (ART/AUDIO nur, soweit nötig: Stufenklick, Eskalationsanzeige) |
| QA (danach) | alle |

**Testserver** nur auf freien Ports mit `ROOM_CODE=off`: FLIGHT 3350–3352, DAMAGE 3353–3355, TOOLS 3356–3358,
CLIENT 3359–3361, QA 3362–3365. **Die Ports 3300 und 3301 nie anfassen.**

## 2. Flugmodell (`shared/flight.js`, UMD, reine Funktionen)

```js
Flight.stepBody(body, input, cls, mods, dt)
// body  = { x, y, angle, vx, vy, turnVel, stage, dodgeT? }    stage = Index in cls.stages
// input = { stage, rudder: -1..1, brake: bool }                  brake = Allstopp (stärkeres Bremsen)
// cls   = CONFIG.shipClasses[k]
// mods  = { speedFactor, turnCapPort, turnCapStbd }             aus Triebwerk, Düsen, Energie (Lerche)
Flight.turnFactor(cls, speed) -> 0..1                            // Interpolation über cls.turnCurve (Tempo/maxSpeed)
Flight.stageSpeed(cls, stage) -> px/s
```

**Regeln:**
- **Tempo:**
  - Das Vorwärtstempo regelt auf `stageSpeed × speedFactor`, beschleunigt mit `accel` und bremst mit `decel`.
  - Mit `brake` wird mit `decel × brakeFactor` gebremst.
- **Drift:** Querbewegung wird mit `lateralDrag` gedämpft. Jäger haben einen niedrigen Wert und driften deshalb.
- **Drehen:**
  - Ziel ist `rudder × turnRate × turnFactor(|Tempo|) × turnCap(Seite)`. `turnVel` nähert sich mit `turnAccel`.
  - Nach dem Ausweichen gilt 1 s lang Drehen × `dodge.turnPenalty`.
- **Mindesttempo:** `cls.minSpeed`. Jäger fallen nie darunter.

Die Startwerte stehen in `CONFIG.shipClasses`. Gemessen (Tech-Lead-Prototyp):

| Lerche | Wert |
|---|---|
| 90° bei ½ | 2,6 s, Wendekreis 108 px |
| 90° bei Voll | 4,4 s, Wendekreis 361 px |
| Stopp → Voll | ≈ 6 s |
| Voll → Stopp | ≈ 4,3 s |

**Lerche (`space.updateFlight`):**
- Andocken, Asteroiden, Kartenrand und Ausweichen (Impuls 350, Fenster 0,8 s) bleiben. Die Kernbewegung läuft über
  `stepBody`.
- `cmd helm.throttle { delta: ±1 }` oder `{ set: index }` stellt die Stufe ein. Der Client sendet bei W/S einen Schritt.
- `helm.input` überträgt nur noch `turn` als Ruder. `thrust` ist ein Altname: Ein Wert > 0,5 bzw. < −0,5 wirkt einmalig
  als Stufe +1 bzw. −1.
- **Allstopp** (`helm.stop`, X) setzt die Stufe auf Stopp und `brake = true`, bis das Schiff steht.
- Unbesetzte Steuer: Die Stufe bleibt, das Ruder steht auf 0, es gibt keine Sonderbremse (§0.8).
- Snapshot: `ship.helm.stage` (Index), `ship.helm.stages` (Tempo-Stufen in px/s, einmal) und `ship.helm.autoStop`.

**Schalter `spaceM3b.flightV2`:**
- `{ arena: true, missions: false }`. Im Testgelände gilt das neue Modell für alle Schiffe.
- In den Missionen bleibt bis zu Schritt B das M3a-Verhalten der Gegner, die Lerche fliegt aber schon mit Stufen. Der
  Temporegler gilt also überall.
- Per `tune spaceM3b.flightV2.missions true` lässt sich das neue Modell auch in den Missionen einschalten.

## 3. Gegner-KI als Pilot (`server/sim/pilot.js`)

`Pilot.update(game, e, dt)` erzeugt nur `input` (stage, rudder). Die Bewegung macht `Flight.stepBody`. Alles ist
deterministisch und benutzt nur `game.rng`.

- **Ruder:** PD-Regler `rudder = clamp(kP·Fehler − kD·turnVel/turnRate)`. Startwerte kP 2,5, kD 1,2.
- **Kanonenboot:** Stationshalten im Bezugssystem der Lerche.
  - Sollpunkt: querab im Abstand R = 400 auf der Seite `side`, mit 1,5 s Vorhalt.
  - Wunschgeschwindigkeit = Zielgeschwindigkeit + 0,35 · Ablage. Nah am Punkt fährt es parallel zur Lerche.
  - Seitenwechsel: wenn der eigene Breitseitensektor schwach ist oder die Lerche lange vor dem Bug oder hinter dem Heck
    liegt (Kreuzen auf ¾).
  - Die angekündigte Ladung (`tele`) bleibt wie in M3a.
- **Jäger:** Zustandsautomat.
  1. `approach`: Voll, Kurs auf den Vorhaltepunkt mit seitlichem Versatz ≥ 60 px. Feuert im Frontbogen.
  2. `overshoot`: Ruder 0, bis der Abstand > 380 ist oder 3 s vergangen sind.
  3. `turn`: Wende bei ½.
  4. Dann wieder `approach`.
  - Höchstens ein Jäger gleichzeitig in `approach` innerhalb von 300 px, die Staffelung liegt bei 2 s.
  - `raiderOrbit` und `raiderFlip` werden im neuen Modell nicht benutzt.
- **Pylon:** Klasse mit `maxSpeed 0`, ein Turm wie bisher. **Relais** bleibt kinematisch. **Wächter** darf in Schritt A
  kinematisch bleiben.
- **Alle:**
  - Randvermeidung: Liegt die Position in 2 s außerhalb des Randes, mischt der Pilot den Kurs zur Mitte bei.
  - Abstand zu anderen Schiffen ≥ 60 px.
  - Stuck-Timer.
  - Rückzug: auf Voll vom Schiff weg.
- **Snapshot** ergänzt `enemies[]`: `vx`, `vy` (für die Interpolation) und `state` (`approach`/`overshoot`/`turn`/
  `station`/`retreat`, gekürzt).

## 4. Schild- und Schadenslogik (`server/sim/damage.js`, SERVER-DAMAGE)

```js
Damage.resolveHit(game, sector, dmg, opts) -> { absorbed, hull, systems: [{system, state}], evaded? }
// opts: { pierce, emp, heavy, source }
```

`space.shipHit` behält Signatur und Ereignisse und ruft `resolveHit` auf. Ablauf:

1. **S = Schildstärke des Sektors vor dem Treffer.**
2. **Absorbieren:** `absorbed = min(S, dmg)` (bei `pierce`: S − pierce). Der Rest `dmg − absorbed` geht durch
   (`spaceM3b.shieldOverflow`, Standard an). Die Hülle nimmt `5 × Rest`.
   - Bei S ≥ 3 und einem schweren Treffer (`heavy`): Schaden − `heavyReduce` (1) vor dem Absorbieren.
   - **Neu ist:** Bisher schluckte ein einziger Schildpunkt den ganzen Treffer.
3. **EMP** wie bisher: Ist der Schild durchschlagen, geht ein System offline.
4. **Systemschaden** über die Tabelle `spaceM3b.shieldLeak[S]`. Das gilt für jeden Treffer, auch einen, den der Schild
   ganz gefangen hat:

| S | Chance je Treffer | höchstens | Sonstiges |
|---|---|---|---|
| 0 | 45 % | bis zerstört | Mittschiffs möglich (`centreChance`), fragile Systeme brechen |
| 1 | **20 %** | beschädigt | fragile Systeme brechen |
| 2 | **5 %** | beschädigt | nur bei schweren Treffern (`heavy`), fragile Systeme bleiben |
| 3–4 | 0 % | — | |

   Die Auswahl des Systems bleibt wie in M3a §4.3: Gewicht 3 im Sektor, 1 bei den Nachbarn, keine Gegenseite, Sperre
   10 s. Das macht `interior.hitSystems(game, sector, { chance, maxState, centre, breakFragile })`.
5. **Feuer und Lecks** gibt es nur, wenn Rest > 0 ist (Chance wie bisher).

**Schildpool:** `shields.pointsPerPower` 3, also 6 Punkte bei Energie 2. `maxPerSector` bleibt 4.

**Schildstoß entfernen (alle Teams in ihren Dateien):**
- `captain.burst` antwortet nur noch „Den Schildstoß gibt es nicht mehr.“
- `debug burst` fällt weg. `burst`/`burstCd` bleiben eine Version lang als `null`/`0` im Snapshot.
- UI, Sim-Bot und Tests werden entsprechend angepasst.
- `config.spaceM3.burst` bleibt als Altname stehen und wird nicht mehr benutzt.

**Aktivere Schadensbekämpfung:**
- **Eskalation** (`spaceM3b.escalation`):
  - Ein System, das während eines Kampfes (Gegner da, die kein `relay` sind) `after` = 20 s am Stück beschädigt oder
    zerstört ist, ohne dass jemand daran arbeitet, löst **Feuer** auf einer Bodenkachel neben der Station aus. Danach
    beginnt der Zähler neu.
  - Feuer neben einer Station schädigt sie wie bisher (`fire.damageInterval`).
  - Snapshot: `ship.escalate = { [sys]: Restsekunden }` nur für Systeme, deren Zähler läuft.
  - Ereignis `escalated { system }`, ODA-Ansage gebündelt.
- **Arbeiten im Rhythmus:**
  - Ein Hüllentreffer (Rest > 0) im Sektor eines Systems, an dem gerade ein Spieler oder Bot repariert, kostet
    `repairHitLoss` (50 %) des Fortschritts. Das gilt für Flicken, Austauschen, Bot-Arbeit und die Minispiel-Mindestzeit.
  - Ereignis `repairSetback { system }`.
- **Reaktor-Autostart im Gefecht:** Wird ein zerstörter Reaktor repariert, während Gegner da sind, startet er nach
  `reactorAutoRestart` (3 s) von selbst. Der Neustart zu zweit bleibt für ruhige Momente.

**Zähler:**
- `stats.leakHits` (Systemschaden trotz Schild)
- `stats.escalations`
- `stats.repairSetbacks`
- `stats.overflowHull` (Hülle durch Überlauf)

## 5. Client (CLIENT)

- **Steuer:**
  - Temporegler als senkrechte Stufenleiste: R, STOPP, ¼, ½, ¾, VOLL. Die eingestellte Stufe ist hell, das Ist-Tempo
    läuft als Zeiger mit, bei ½ steht die Markierung „wendig“.
  - W/S schicken `helm.throttle`. Dauerdruck schaltet nicht weiter, eine Stufe pro Tastendruck.
  - A/D bleiben das Ruder. Shift+A/D weichen aus, X ist Allstopp.
  - Drehanzeige wie bisher, dazu der aktuelle Drehfaktor.
- **Taktik und Captain:** Gegner werden mit `vx`/`vy` interpoliert. Die Jäger-Anfluglinie wird gestrichelt angezeigt
  (`state` = `approach`).
- **Captain:**
  - Die Stoß-Knöpfe, B+1–4 und die Stoß-Leiste werden entfernt.
  - In der Schildanzeige stehen Pool 6 und je Sektor ein Hinweis zum Durchlass („0: offen“, „1: Kratzer 20 %“,
    „2: 5 %“, „3–4: dicht“).
- **Schadensplan und Stationen:** Eskalations-Countdown je System („brennt in 12 s“). Bei `repairSetback` gibt es einen
  kurzen Hinweis am Spieler und einen Rückschritt im Fortschrittsbalken.
- `dev-mock.js` bekommt Zustände für alle neuen Felder. Die README-Abschnitte Steuer, Captain und Schaden werden
  aktualisiert.

## 6. Tools (TOOLS)

- **Sim-Bots:**
  - Die Steuer fliegt mit Stufen (`helm.throttle`).
  - `nose`: Bug aufs Ziel, ½ bis ¾.
  - `maneuver`: Breitseite halten, Stufe nach Lage, ½ für Wenden, Ausweichen bei Ladung.
  - Die Taktik feuert die Lanze auf die Jäger-Anfluglinie.
  - Der Captain macht keine Schildstöße mehr, verteilt aber Schilde zur Bedrohung.
  - Solo: Bevor sie beamt, stellt sie auf Stopp (keine Sonderbehandlung mehr).
- **Neu `tools/test-flight.js`** (in `npm test` aufnehmen):
  - Stufen und Tempo
  - Stopp → Voll 5–7 s, Voll → Stopp 4–5 s
  - Wendekreis bei Voll ≥ 3 × der Wendekreis bei ½
  - Jäger nie unter `minSpeed`
  - Überflüge: ≥ 80 % der Anflüge mit Abstand < 150, danach > 300
  - Mindestabstand zwischen Schiffen ≥ 40 px
  - kein Gegner > 5 s im Randstreifen
  - Kanonenboot gegen eine geradeaus fahrende Lerche ≥ 60 % der Zeit mit Breitseite
- **`test-m3`:**
  - Schildstoß-Abschnitte werden ersetzt.
  - Neue Fälle:
    - Durchlass-Tabelle statistisch über 2000 Treffer je S (±3 Prozentpunkte)
    - Überlauf auf die Hülle
    - S ≥ 3 schwer − 1
    - Eskalation nach 20 s
    - Rückschlag 50 %
    - Reaktor-Autostart
    - Pool 6
- **Arena-Messung** (`sim:arena`, zu dritt, 10 Seeds, nose/maneuver), neu mit der Welle „Kanonenboot + 2 Jäger“:
  - Hüllenverlust, Notfälle, `leakHits`, `escalations`, `repairSetbacks`, `bridgeLeaves`
  - Breitseiten-Anteil des Gegners
  - Lanzen-Trefferquote gegen Jäger
- `npm run sim` (m1–m3) bleibt grün. Neue Schadenslogik, Temporegler der Lerche.

## 7. Testgelände (SERVER-FLIGHT)

- Neue Welle „Kanonenboot + 2 Jäger“ als **Welle 1**, die alten Wellen danach.
- Gegner starten mit Anfangstempo, also nicht aus dem Stand.

## 8. Abnahme Schritt A

| Kriterium | Prüfung |
|---|---|
| Flugwerte wie §2 | `test-flight` |
| Kanonenboot umkreist und hält die Breitseite, Manövrieren bricht sie | `test-flight` und Arena-Messung (Breitseiten-Anteil `nose` > `maneuver`) |
| Jäger schießen vorbei, keine Zusammenstöße, keine Randsoftlocks | `test-flight` |
| Schild-Durchlass 45/20/5/0 %, Überlauf, Eskalation, Rückschlag, Autostart | `test-m3` |
| Schildstoß überall weg, Pool 6 | Tests und Screenshot Captain |
| Missionen weiter durchspielbar | `npm run sim` |
| „Nase drauf“ verliert weiterhin messbar | Arena, ehrlich melden |
| **Kai fliegt den Prototyp** | Demo auf Port 3301, Testgelände |

Erst nach Kais Probeflug folgt Schritt B: Missionen auf die neue KI, Solo-Balancing, gegebenenfalls Gegnersysteme.

## 9. QA-Nachträge (2026-10-07)

Dieser Abschnitt geht §2–§8 vor, wo sie sich widersprechen. Kais Vorgaben (§0) sind unverändert.

### 9.1 Behobene Fehler
1. **Schild-Startverteilung nutzte den Pool 6 nicht** (`shields.default` [2,1,0,1] = 4 Punkte, 2 lagen brach, bis der Captain sie
   von Hand setzte). Neu **[2,2,0,2]**. `test-m3` („Sektor 0 höchstens 4“) leert vorher die Verteilung.
2. **Jäger trafen kaum** (Gegnerdruck, `spaceM3b.pilotFire.raider`): Sie zielten auf die alte Position der Lerche; bei ½ fährt
   sie in der Flugzeit (1–1,5 s) 70–100 px weiter, Trefferradius 40. Arena-Bots: 6–16 Jägerschüsse je 6-Wellen-Lauf, ~1 von
   10 traf. Neu: Schuss mit **Vorhalt** (`lead` 0 → 1, `space.leadAngle`), nur im neuen Flugmodell (Missionen unverändert bis
   Schritt B). `fireInterval` bleibt 2,5 (s. 9.2). Test in `test-flight` (mit Vorhalt 0,5 px, ohne 89 px daneben).
3. **Beamen bei fahrendem Schiff:** Die unbesetzte Steuer fährt weiter (§0.8). Im Browser war das Schiff nach 15–30 s
   ~1 km von der Boje weg – die Meldung lautete nur „Zu weit vom Ziel“. Neu: „Zu weit vom Ziel (960, max. 320) – das Schiff
   fährt weiter. Steuer: zurück und STOPP (X)“ bzw. „Schiff zu schnell für den Transfer (52, max. 30) – Steuer auf STOPP
   (X = Allstopp)“ und **einmal je 20 s ODA**: „Schiff zu schnell für den Transfer – niemand an der Steuer, wir fahren weiter.
   Steuer auf Stopp (X), dann beamen.“ (`away.tooFastHint`, auch bei der Transferkonsole). Transferkonsole: „– Steuer auf STOPP“.
4. **„brennt in …“ überlappte den Fortschrittsbalken** eines Spielers an der Nachbarstation: Das Label weicht jetzt nach oben aus
   (`render.js`, `barRects`).
5. Der Screenshot `live-captain-schilde` mit falschem Reiter war ein Skriptfehler (B+1: die 1 schaltet ohne Schildstoß auf
   Reiter 1). Kein Spielfehler.

### 9.2 Balancing (alt → neu, Grund)
| Wert | alt | neu | Grund |
|---|---|---|---|
| `shields.default` | [2,1,0,1] | [2,2,0,2] | Pool 6 voll verteilt (Fehler 9.1.1) |
| `spaceM3b.pilotFire.raider.lead` | – (0) | 1 | Jäger treffen ein fahrendes Schiff (Fehler 9.1.2) |
| `spaceM3b.pilotFire.raider.fireInterval` | – (2,5) | 2,5 | geprüft 0,6 / 1,2 / 1,5: „Nase drauf“ und „Breitseite“ wurden gleich teuer (Faktor 0,95–1,0), und im Browser kippten Kanonenboot-Wellen schon mit den alten Werten |
| `enemies.gunboat.fireInterval` | 4 | **4 (unverändert)** | 5 geprüft: Bots Faktor nose/maneuver 1,01; Browser nicht eindeutig besser (Notfälle 1 und 2 statt 2 und 2 je 3 Wellen) |

Nicht verändert: Durchlass, Pool, Eskalation, Rückschlag (Kais Vorgaben bzw. kein Gegnerdruck).

### 9.3 Arena-Bots (`npm run sim:arena`, 10 Seeds, zu dritt, 6 Wellen)
| Wert | nose vorher | nose nachher | maneuver vorher | maneuver nachher |
|---|---|---|---|---|
| Hüllenverlust gesamt (je min) | 32,9 (6,9) | 60,7 (12,0) | 28,7 (4,5) | 43,0 (6,2) |
| Notfallprotokolle | 0 | 0,1 | 0 | 0 |
| leakHits | 0,2 | 0,7 | 0,3 | 0,6 |
| Eskalationen | 0 | 0,4 | 0 | 0 |
| Rückschläge | 0,1 | 0,1 | 0 | 0,1 |
| bridgeLeaves | 1,3 | 2,0 | 1,3 | 1,8 |
| Breitseite Kanonenboot | 71 % | 73 % | 42 % | 42 % |
| Lanze gegen Jäger | 21 % | 32 % | 100 % | 98 % |

Faktor nose/maneuver: **1,15 → 1,41** gesamt, **1,53 → 1,93** je Minute („Nase drauf verliert messbar“ jetzt erreicht).
Solo-Bots (maneuver, 5 Seeds): Hülle 196 → 140, Notfälle 2,4 → 0,6 (vor allem durch die volle Schildverteilung).
Die Bots verteilen Schilde fehlerfrei – ihre „Ruhe“ (≈ 2 Reparaturgänge je 6 Wellen) gilt **nicht** für Menschen (9.4).

### 9.4 Browser (QA-Skript, kein Debug/God-Mode, Testgelände zu dritt)
Skript `C:\tmp\pwtest\sts\qa-m3b-arena.js`: Steuer 1280×720 (Takt 150–250 ms, Temporegler ½/¾, Ausweichen ~65 %),
Taktik 1920×1080 (Reaktion 0,3–0,65 s, Lanze auf Jäger mit ±0,2 s Schätzfehler), Captain 1280×720 (reagiert auf Ladungen
nach 1–3 s, 15 % falscher Nachbarsektor, schaltet einmal „Bots automatisch“ an, läuft als Erster los). **Gemessen,
aber Skript – keine Menschen.** Zeiten = Spielzeit.

| Lauf | Welle 1 (KB + 2 J) | Welle 2 (2 J) | Welle 3 (J + KB) | Welle 4 (Wächter + 2 J) |
|---|---|---|---|---|
| Endwerte A | 3:44 · −100 Hülle · **2 Notfälle** · 3 Eskal. · 1 Rückschlag · 2× Brücke verlassen | 0:48 · 0 | 2:16 · −49 · 0 Notfälle | 1:33 · 0 |
| Endwerte B | 3:49 · −100 · **2 Notfälle** · 4 Eskal. · 5× Brücke | 0:23 · 0 | 2:11 · −55 · 0 | – |
| alte Jägerwerte, Schilde 4 (vor 9.1.1) | 4:36 · −97 · 2 Notfälle · **23 Eskal.** · 11× Brücke | 1:03 · 0 | 3:45 · −66 · 2 Notfälle · 26 Eskal. | – |

- **Nicht zu ruhig, eher zu hart:** Mit Menschen-Tempo kosten Kanonenboot-Wellen 50–100 Hülle und 0–2 Notfälle. Hauptquelle
  sind schwere Treffer (3) in Sektoren mit 0–2 Punkten, die jetzt überlaufen (früher schluckte ein Punkt den ganzen Treffer,
  und es gab den Schildstoß). Jäger sind Kratzer (Welle 2: 0–5 Hülle).
- **Eskalations-Kaskade:** Bleiben 3–5 Systeme liegen, zündet jedes alle 20 s ein Feuer neben der Station; Feuer schädigt die
  Station wieder (10 s) und brennt auch neben Konsolen – im Extremfall 23 Eskalationen in einer Welle, Pilotin k.o. an der
  Steuer. Mit „Bots automatisch“ blieb es bei 3–4 je Welle.
- Rückschläge selten (0–2 je Welle). Ausweichen: 11–24 je Lauf, Temporegler 50–80 Stufenwechsel je Lauf (½ und ¾).
- Lanze gegen Jäger (Anfluglinie, Mensch-Timing ±0,2 s): 7 Treffer bei 39 Schüssen (18 %, je Lauf 9–36 %).
- Solo (1280×720): Welle 1 3:13 (−91, 0 Notfälle), Welle 2 0:52, Welle 3 3:44 (1 Notfall).
- Fehlerzähler Server/Client 0, keine Konsolenfehler; 1280×720 und 1920×1080 (Taktik/Captain getauscht) sauber.

### 9.5 Mission m1 zu dritt (`qa-m3b-m1.js`)
- Kampf an B-7 (Gegner im alten Modell, Anreise per Debug `mission m1 combat` übersprungen): 3:49, Hülle bis 4, **3 Notfälle**,
  4 Eskalationen, 2 Rückschläge, 5× Brücke verlassen. M3a-QA (mit Schildstoß): 1:37, 0 Notfälle.
- Zur Boje mit Stufen (VOLL → ¾ → ½ → STOPP): 20 s, steht 200 px vor der Boje. Relais im Stand abschießen dauert (Drehfaktor
  25 % im Stand) – das Skript schaffte 2 von 3 in 3 min, weiter per Debug.
- **Beamen:** Pilotin lässt ½ stehen und geht zum Pad → nach 15 s Schiff 52 px/s, Hinweis + ODA kommen; zurück an die Steuer,
  X: steht nach 14 s – aber **960 px** von der Boje. Zurückfliegen 24 s, dann Beamen zu zweit und Hochbeamen ohne Probleme.

### 9.6 Kreis-Lücke und Jäger-Anflüge
- **Dauerkreis bei ½ mit Ruder 0,3** (`sim:arena --pilot circle`, 6 Seeds): Das Kanonenboot findet kaum Breitseite (in Ladung
  verfehlt 31–56 von 34–57), **0–1 schwere Treffer in 10 min**, Hülle 4,1/min. Aber die Lerche gewinnt so auch nicht: 1–3 von
  6 Wellen liefen ins 180-s-Limit. Einschätzung: kein Gewinn-Trick, aber ein **Sicherheitsnetz zum Aussitzen**. Vorschlag für
  Schritt B: Dreht die Lerche länger als ~6 s mit > 0,25 rad/s, wechselt das Kanonenboot auf „Abstand“: hält ~450 px vom
  Kreismittelpunkt, steht quer (¼/Stopp) und lässt die Lerche durch seinen 90°-Bogen laufen.
- **Jäger-Anflüge sind lesbar:** gestrichelte Linie mit „ANFLUG &lt;Abstand&gt;“ auf Taktik und Lage (Screenshot
  `qa3-taktik-jaeger-anflug`). Ein Anflug dauert nur 1,5–3 s, die Jäger sind meist in `turn`. Die Lanze hat eine echte, aber
  kleine Chance (18 % mit Menschen-Timing; Bots 32 % nose / 98 % maneuver mit perfektem Timing).

### 9.7 Offen für Kais Probeflug
1. Kanonenboot-Wellen zählen: Notfälle und Hülle je Welle. Wenn es zu hart ist, in dieser Reihenfolge (`npm run debug`):
   `tune spaceM3.tele.gunboat.damage 2` · `tune crewScaling.3.enemyFireInterval 2.2` · `tune spaceM3b.escalation.after 30`.
2. Eskalation nur für **zerstörte** Systeme oder höchstens ein Feuer je System und Kampf? (Kaskade, 9.4)
3. Kreis-Lücke (9.6): stört das? Dann Kanonenboot „Abstand“ in Schritt B.
4. Stillstand an der Boje: Im Stand dreht die Lerche kaum (25 %). Für Relais und Beamen ist das zäh – ¼ zum Ausrichten
   ist der Kniff (README).
