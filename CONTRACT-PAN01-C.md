# CONTRACT-PAN01-C – Waffen und Munition (PAN-01 Paket C)

Stand: 2026-10-18, Branch `pan01-c` (baut auf `pan01-b` e429907 auf). Grundlage: Auftrag PAN-01 (Vault `Pantheon/Auftrag PAN-01 – Lerche-Ausbau, Werft, Waffen und Module.md`, Paket C, Abnahme 10–14, Gesamt 21),
Erkundung (`Auftrag PAN-01 – Erkundung.md`), `Mechanik/Ausrüstung.md`. Vorgänger: `CONTRACT-PAN01-B.md` (Plätze, Stufen, Lafetten), `CONTRACT-PAN01-A.md` (Energie). Folgepaket: D (Werft setzt `ship.waffen`
und `ship.stufe` gegen Marken; das Terminal liest `shared/schiffskatalog.js`).

> **Leitgedanke:** Mehr Plätze heißen mehr Auswahl, nicht mehr Feuerkraft. Die Energie bleibt die Bremse: Alle Energiewaffen teilen sich den Ladepool. Gegner rüsten aus demselben Katalog. Keine Zahlen-Upgrades.

## 1. Überblick: was neu ist

| Bereich | Datei | Inhalt |
|---|---|---|
| Katalog | `shared/schiffskatalog.js` (neu) | acht Waffen, Plätze, Magazindeckel, Torpedo, Gegner-Abbildung, Module je Klasse, Taktik-Symbole |
| Server | `server/sim/schiffswaffen.js` (neu) | Bestückung, Mounts je Platz, Ladepool, Lanze/Salven/Streu/Torpedo/Abwehrturm, Snapshot, Debug, Weltstand |
| Server | `server/sim/space.js` | delegiert die Lerchen-Waffen; Gegner: Sturm, Streu, Torpedo; Projektile (pbatterie, pkanone, psturm, pfunke, torpedo, etorpedo, streu, estreu, sturm); Schaden-Optionen `huelle`, `sturm`, `streu`, `nurOhneSchild` |
| Systeme | `interior.js`, `damage.js`, `alarm.js`, `bots.js`, `weltstand.js`, `maps.js`, `protocol.js` | `lafette_N` als Systeme, `systemAktiv` (offen UND bestückt) |
| Shop | `config.js`, `shop.js` | `seitenturm` und `bolzenwerfer` entfallen; `bolzen` heißt Torpedo, Lagerlimit 12 |
| Messung | `tools/pan01-feuerkraft-messung.js`, `tools/pan01-torpedo-messung.js`, `tools/pan01-energie-bot.js` (+ Preload) | siehe §9 |
| Tests | `tools/test-waffen-schiff.js` (neu, in `npm test`), angepasst: test-m3, test-features, test-lerche, test-energie, test-weltstand, test-sektoren, check-maps | siehe §10 |
| Client | `public/js/*` (Pult, Konsolen, Taktik, Projektile, Töne, Symbole, Ziel-Scan) | siehe §11 |

## 2. Katalog (`shared/schiffskatalog.js`)

Je Waffe: `id, name, kurz, platzart, wirkung, energie, art, schaden, rohre, salvoGap, ladekosten, cooldown, bogen, reichweite, modell, projektil {form, farbe}, effekt, ton, symbol, munition, stoss, gegner {verhalten}`.
Die Werte der Standardbatterie und der Lanze sind **gleich der Config** (`spaceM3.mounts.port`, `spaceM3.lance`, `mounts.bow`; Test), damit `tune` wirkt und die Golden-Läufe stabil bleiben.

| Id | Platzart | Energie | Art | Schaden | Rohre | Ladekosten (s je Punkt) | Bogen | Reichweite | Anfangsstoß | Projektil | Ton | Symbol |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `standardbatterie` | Seite | ja | Salve | **2 je Treffer** (Erwartung 1,5 je Rohr) | 4 (beschädigt 2) | 12,3 | 70° | 520 | 6 | **Projektil** `pbatterie`, Tempo 450, Doppelbolzen bernstein | `battery_salvo` | `schiff_batterie` |
| `sturmbatterie` | Seite | ja | Salve | **0,7 je Treffer** | 8 (Takt 0,07 s) | 10 | 60° | 440 | 4,8 | **Projektil** `psturm`, Tempo 800, Nadeln türkis | `sturm_salvo` | `schiff_sturm` |
| `streubatterie` | Seite | ja | Salve | 2 je Granate | 3 (Takt 0,4 s) | 12 | 70° | 480 | 6 | Granate orange | `streu_wurf` | `schiff_streu` |
| `lanzenbatterie` | Seite | ja | Lanze | 3 bis 12, einmal | 1 | 18,5 | 16° | 650 | 12 | zwei Strahlen | `lance_fire` | `schiff_lanzenbatterie` |
| `lanze` | Bug | ja | Lanze | 3 bis 12 | 1 | 18,5 | 16° | 650 | 12 | Strahl | `lance_fire` | `schiff_lanze` |
| `standardkanone` | Bug | ja | Salve | **2 je Treffer** | 3 | 9,2 | 50° | 560 | 4,5 | **Projektil** `pkanone`, Tempo 520, dicker Bolzen rotorange (`#FF7A3C`, eigene Form und Farbe gegen die bernsteinfarbene Batterie) | `kanone_salvo` (härterer Einzelschlag) | `schiff_kanone` |
| `torpedowerfer` | Heck | **nein** | Torpedo | je Zielklasse (§5) | 1 | – (Cooldown 10 s) | **60°** | 650 | 0 | Torpedo | `torpedo` | `schiff_torpedo` |
| `abwehrturm` | Heck | ja | Turm | 1,2 je Treffer | 2 (Takt 0,12 s) | 7 | 360° | 260 | 2,4 | **Projektil** `pfunke`, Tempo 700, Funken | `abwehr_feuer` | `schiff_abwehrturm` |

Ladekosten sind so gewählt, dass **Schaden je Ladepunkt und Sekunde** bei den Salvenwaffen bei ≈ 0,48 bis 0,50 liegt (Batterie 6/12,3 = 0,49, Sturm 4,8/10 = 0,48, Streu 6/12 = 0,50, Kanone 4,5/9,2 = 0,49), bei den
Lanzen 0,65 (12/18,5; wie heute). Der Abwehrturm ist bewusst schwach (0,34). Die Lafettenmodelle (`lerche/station/lafette_*`) liefert das Voxelwerk; bis dahin zeichnet der Client je Art einen eindeutigen Platzhalter.

**Projektilmodell (Kai 2026-10-18, ersetzt den Sofortstrahl von Standardbatterie, Standardkanone und Sturmbatterie; Strahl bleiben nur Lanze und Lanzenbatterie):**
Ein Modell für Spieler und Gegner, wie das Sperrfeuer der Gegner: das Projektil fliegt **geradeaus, ungelenkt, mit endlichem Tempo** (Batterie 450, Kanone 520, Sturm 800, Turm-Funke 700 px/s; Lebensdauer = Reichweite / Tempo), und trifft, wenn es das Ziel erreicht (Abstand zum Trefferradius der Klasse, im Server `updateProjectiles`). Schaden **je Treffer = Katalogwert**, gegen Schild und Hülle wie bisher (Sturm: 25 % vom Schild, Rest verpufft; Schildsektor und Hülle wie bei den Strahlen). Brocken schlucken Projektile im Flug (Test `test-wellen-all`). Treffer auf Minen wie bisher.
Ausweichbar: **Vorhalt** auf den Abfangpunkt des Ziels bei gehaltenem Kurs und Tempo (höchstens 3 s voraus, deterministisch, kein Zufall), je Rohr eine kleine feste Fächerung (Streuung 0,012 rad Batterie, 0,008 Kanone, 0,02 Sturm) und ein Querversatz von 2,2 px. Wer Kurs oder Tempo wechselt, entkommt (Test: Ziel bricht mit 300 px/s seitlich aus, 0 Treffer). Das ist der gewollte Preis gegenüber dem Strahl; die Gegner-Seite blieb unverändert.
**Unverändert:** Ladepool, Ladekosten, Magazindeckel, Reservierung, Zustandsfaktor, Anfangsstoß (Vorrat) und Gap der Salve. Der **Anfangsstoß bleibt der Nennwert** (Batterie 6 = 4 Rohre × 1,5): er ist der Vorratswert in Schadenspunkten, nicht der Schaden bei 100 % Treffern.
**Kalibrierung (gemessen, Arena-Bot und deterministisch):** Die erste Fassung (Tempo 320, Schaden 1,5) traf nur 59–73 % und der Start-Satz schaffte nur 2 von 6 Wellen; Tempo allein hilft nicht (4× Tempo: Waffenschaden/s 0,57, die Rohrfolge verfehlt ein manövrierendes Ziel trotzdem). Gewählt: **Tempo 450 / 520 / 800 und Schaden 2 / 2 / 0,7 je Treffer** statt 1,5 / 1,5 / 0,6: bei **≈ 65–77 % Trefferquote** liefert der Bot dann denselben Waffenschaden je Laufsekunde wie mit dem Strahl (0,66, siehe §9). Folge: auf **wirklich ruhende** Ziele (alle Projektile treffen, **100 %**, Test `test-waffen-schiff`: acht Salven Batterie, Sturm und Kanone auf eine fixierte Korvette) liegt das Dauerfeuer um **≈ 33 % über dem Strahl** (2 gegen 1,5); wer nicht ausweicht, wird härter getroffen. (Ein frisch gespawntes Ziel trägt noch seine Anfangsgeschwindigkeit, der Vorhalt rechnet damit: wer es nicht fixiert, sieht in einer ersten Salve 75 % – ein Messartefakt, kein Widerspruch.) Der **Vorhalt** ist auf 3 s gedeckelt (Test: Ziel weit weg und schnell → Zielpunkt genau bei 3 s, ohne Deckel läge er weiter voraus). Die Config `spaceM3.mounts.port/stbd.damage` ist auf 2 mitgezogen (Test: Katalog = Config).
**Gleiche Regeln für Lerche und Gegner (Abnahme 5):** Das **Prinzip** ist dasselbe (ungelenkte Projektile, Treffer per Abstand, Schaden je Treffer, ausweichbar), die **Zahlen stehen je Katalogeintrag** und gelten für die Waffe, die der Spieler trägt. Die Gegner schießen **nicht** mit diesen Katalogwerten: Gegner-`batterie` (und der `bolzen`) ist ein Projektil `enemy` mit den Werten der Config (`combat.enemyShotSpeed` 210 px/s, Lebensdauer 4 s, Schaden je Klasse aus `enemies`), das Sperrfeuer der Korvette hat 110 px/s (`spaceS2b.sperrfeuer`), Gegner-Torpedo 150 px/s, Gegner-Granate nach der Zündzeit des Katalogs, Gegner-Sturm schießt `sturm`-Nadeln. Auch wenn ein Gegner die Katalog-Standardbatterie trägt (`e.waffen.stbd = 'standardbatterie'`), bleibt sein Verhalten `batterie` mit den Config-Zahlen. **Verbleibende Abweichung und Grund:** (1) **Golden-Stabilität und Kampagnenbalance:** die Gegnerwerte stecken in den Kampagnen-Spielen, jede Umstellung (Tempo 210 → 450) verschöbe Todesspirale und alle Läufe, ohne dass die Entscheidung Kais das verlangte; (2) die Lerche ist das Schiff, das **ausweichen** soll, die Gegner haben kein Ausweichmodell, daher fliegen ihre Geschosse langsamer (≈ halbes Tempo) und werden vom Spieler per Rolle umflogen. Wer die Gegner auf Katalogwerte umstellen will, braucht dafür einen eigenen Auftrag (Bots, Golden, Messung); der Hebel ist klein: `Katalog.waffe(id).geschw/schaden` an die Stelle von `enemyShotSpeed` und `enemies.*.damage` setzen.

**Client:** `pbatterie` = bernsteinfarbener Doppelbolzen, `pkanone` = dicker rotoranger Bolzen mit Glutspur (Blitz-Phasen), `psturm` = dünne schnelle türkise Nadel (gleiche Zeichnung wie die Gegner-Nadel), `pfunke` = kleiner heller Funke, `streu` = Granate, `torpedo` = Torpedo; Strahlen (`lance`) nur für Lanze und Lanzenbatterie. Töne unverändert am Salvenbeginn (`battery_salvo`, `kanone_salvo`, `sturm_salvo`). Der Mündungsblitz am Rohr entfällt (kein Strahl mehr), das Projektil beginnt am Rohr. Snapshot: ein Projektil kostet 4 Felder (`id kind x y angle`, ≈ 60 B); mit **neun feuernden Waffen und 21 Projektilen gleichzeitig max 10 412 B** (Test; Budget 18 944 B), `npm run snap:mess` Worst Case 11 661 B.

**Wirkungen:**
- *Standardbatterie / Standardkanone / Sturmbatterie / Abwehrturm (Kai 2026-10-18: Projektile, kein Sofortstrahl):* siehe **Projektilmodell** unten. Salve aus den Rohren im Takt, Ziel ohne Auswahl: gewähltes Ziel im Bogen, sonst nächster, sonst ins Leere (das Projektil fliegt trotzdem). **Beide laden beschädigt ohne Zeitfaktor** wie die alte Batterie (`spaceM3.mounts.port` kennt keinen `damagedFactor`), beschädigt feuern nur halb so viele Rohre; nur Lanzen laden beschädigt 1,5× langsamer. (Die erste Fassung gab der Batterie versehentlich den Faktor 1,5: unbemerkte Regeländerung an der Start-Lerche, behoben, Test.) Kanone und Batterie sind im Spiel unterscheidbar: Kanone = ein dicker rotoranger Bolzen mit Glutspur und eigener Ton, Batterie = zwei bernsteinfarbene Bolzen.
- *Sturmbatterie:* gegen einen **hohen Schild** (> 1 Punkt im getroffenen Segment) nimmt jede Nadel nur 25 % ihres Schadens vom Schild, **nichts von der Hülle**, und die Schildregeneration des Ziels ist 6 s gesperrt (`regenHold`);
  bei **niedrigem Schild** (≤ 1) gehen die Nadeln, die treffen, durch (Hülle) und werfen den nächsten Schuss des Ziels um 0,35 s zurück (Störung = „Systemschaden“ der Gegner, die kein Systemmodell haben). Gegen die Lerche (Gegner-Sturm): hoher Schild fast unberührt,
  `shields.regenHold` 6 s; bei niedrigem Schild je Nadel 8 % Chance auf einen Systemtreffer.
- *Streubatterie:* wirft `rohre` Granaten (Projektil `streu`), gefächert quer um den vorhergesagten Ort des Ziels, Flug zum Zielpunkt, Explosion nach **1,4 s** im Radius 70. Eine Explosion auf einem Ziel: nur **Schildschaden**
  (Schild × 1,5, nie Hülle). Eine **zweite** (andere Granate) innerhalb von 2 s: **sicherer Durchschlag** (3 Hülle am Schild vorbei) und Störung 1,5 s. Gegen die Lerche gilt dieselbe Regel (zweite Granate: 3 Schadenspunkte = 15 Hülle und ein sicherer Systemtreffer).
- *Lanzenbatterie:* wie die Bug-Lanze (Aufladen halten, Kurs halten, Strahl in Halterungsrichtung, Schildpierce 2), **zwei parallele Strahlen** (7 px Abstand), **Schaden einmal**. Aufladen mit `weapons.charge {mount}`.
- *Lanze:* unverändert (jetzt je Mount, also auch auf Bug 5 möglich).
- *Torpedowerfer:* §5.
- *Abwehrturm:* dreht sich selbst (Bogen 360°, Reichweite 260), bekämpft **Jäger** und **anfliegende Gegner-Torpedos** (Funken als Projektile mit Vorhalt; ein Funke im Umkreis von 16 px zerstört den Torpedo), nie große Schiffe. Besetzte Ops feuert auf Befehl; **bei unbesetzter Taktik schießt er allein**, aber mit doppelter Ladezeit
  („schwach automatisch“; auch bei mehr als zwei Spielern, weil es Nahabwehr ist und kein Angriff).

## 3. Plätze, Bestückung, Systeme

- `game.ship.waffen` = `{ Platz 1–9: Katalog-Id }`; Start `{ 8: lanze, 4: standardbatterie, 6: standardbatterie }` (`START_BESTUECKUNG`). Aktiv ist ein Platz, wenn die Ausbaustufe ihn öffnet (`Maps.WAFFENPLAETZE`, Stufe 0: 8 4 6 · 1: + 7 9 · 2: + 2 5 · 3: + 1 3)
  **und** er bestückt ist. Die Bestückung bleibt beim Zurückstufen gespeichert (der Platz ist wieder sofort aktiv, sobald er offen ist). Gesperrte Plätze bleiben gesperrt (Debug lehnt ab).
- `game.ship.mount` = Laufzeitzustand je Mount-Id (`bow` = 8, `port` = 4, `stbd` = 6, sonst `p<Platz>`; die drei Startnamen bleiben als Altnamen). Energiewaffen `{ charge 0..1, alloc }`, Lanzen zusätzlich `{ power, charging }`, Salven `{ salvo, salvoT, salvoTarget }`,
  Torpedowerfer `{ cd, cdMax }`.
- Platzart je Waffe wird geprüft (`passtAuf`): Torpedowerfer nur Heck (Platz 2), Lanze/Standardkanone nur Bug (8, 5), Seitenwaffen auf 4 6 7 9 1 3. **Platz 5 trägt Standardkanone oder Lanze**, der alte Bolzenwerfer-Sonderplatz entfällt. Seiten dürfen verschieden bestückt sein
  (Backbord Sturm, Steuerbord Streu), die Mounts tragen ihre Bögen (±90° zur Schiffsachse).
- **Lafetten als Systeme:** `lafette_5 · _7 · _9 · _1 · _3 · _2` in `interior.SYSTEM_ORDER`, `WEAPON_SYSTEMS`, `Protocol.SYSTEMS`, Weltstand `schiff.systeme`; `weapon_bow` = Platz 8, `battery_port` = 4, `battery_stbd` = 6. **`interior.systemAktiv(game, sys)`**: nur bei offenem UND bestücktem Platz
  Trefferziel (`hitSystems`, EMP, `systemSchaden`), Feuer neben der Station, Eskalation, Reparaturliste und Schrauber-Bots; sonst nicht im Snapshot (`ship.systems` enthält den Key nicht). Die Lafetten-Kachel ist eine Station (`maps.js`: `system: 'lafette_N'`, `interact` bleibt `lafette`), der Reparaturweg
  folgt der Kachel. Wechselt die Bestückung (neue Hardware), wird der Systemzustand des Platzes zurückgesetzt.
- Die Altnamen-Systemgruppe `weapons` (schlechtester Zustand) rechnet über alle neun, `heatDamage` und `resolveSystem` wählen nur unter den aktiven.

### Snapshot (`ship.mounts[]`)
Ein Eintrag je offenem, bestücktem Platz in der Reihenfolge Bug 8, 4, 6, Bug 5, 7, 9, 1, 3, Heck 2: `id, facing, arc, range, state, charge`, `typ` (Katalog-Id; **fehlt bei der Startbestückung des Platzes**, Budget), Energiewaffen `alloc`,
Lanzen `power, charging, dmg`, Salven `salvo, salvoMax`, Torpedowerfer `ammo` (= `inventory.bolzen`), `cd` (ganze Sekunden Rest), `charge` (Cooldown-Fortschritt). Strahlen (`space.beams[]`) tragen bei Batterien `sym` (Projektilform), bei Lanzen `mount`; neue
Projektilarten `torpedo`, `etorpedo`, `streu`, `estreu`, `sturm`; Ereignis `lance` trägt `mount`; `explosion` mit `small: true` für Granaten und Torpedotreffer.

## 4. Ladepool und Magazindeckel

**Ladepunkte (unverändert, Entscheidung Kai):** `chargePoints = Waffen-Energie + 2` (0 bei Energie 0), je Waffe höchstens `allocMax` 4.

**Verteilung auf bis zu acht Energiewaffen (Entscheidung):** Der Pool bleibt ganzzahlig und wird je Halterung vergeben. Wer keinen Punkt hat, lädt nicht und steht als **Reserve** bereit; so bleibt „mehr Plätze = mehr Auswahl“, und ein einzelner Pool ist immer die Obergrenze.
- *Standardverteilung* (bei Spielstart, Bestückungs- und Stufenwechsel; `verteilungZuruecksetzen`): **reihum** in der Reihenfolge Bug 8, Bb 4, Stb 6, Bug 5, 7, 9, 1, 3, 2, je ein Punkt, bis der Pool leer ist. Start-Lerche mit 4 Punkten: 8 → 2, 4 → 1, 6 → 1 (wie bisher,
  Golden-stabil); voll ausgebaut mit 4 Punkten: je einen für 8, 4, 6, 5.
- *Besetzte Ops:* der Wunsch (`ship.wAllocIntent`, Q/E wählen, A/D) gilt, bei zu wenig Punkten (Energie sinkt) wird bei der Halterung mit den meisten gekürzt (Gleichstand: Batterien vor Lanzen, hintere vor vorderen).
- *Unbesetzt ≤ 2 Spieler (Automatik):* reihum wie die Standardverteilung; bei 3–4 Spielern bleibt der zuletzt gesetzte Wunsch.
- **Abwehrturm:** ihm ist, solange er bestückt ist und der Pool mindestens einen Punkt hat, **ein Punkt reserviert** (Standardverteilung vergibt ihm vor der Reihum-Verteilung einen; bei unbesetzter Taktik behält er ihn auch, wenn die Ops ihn früher auf 0 gestellt hat; besetzt ist er frei verteilbar). Kosten: dem hintersten Reihum-Empfänger fehlt ein Punkt (voll ausgebaut mit Turm und 4 Punkten: Turm 1, Bug 1, Bb 1, Stb 1, Bug 2 ohne Punkt). Die Start-Lerche (kein Turm) bleibt 2/1/1. Ohne diese Reservierung bekam der Turm nie einen Punkt (Heck 2 steht zuletzt) und die „schwache Automatik“ feuerte nie (Review H3).
- Der Torpedowerfer hat **keine** Ladepunkte (`weapons.alloc` lehnt ihn ab).

**Magazindeckel (Entscheidung):** Der Erkunder maß: Dauerfeuer ist Pool × ≈ 0,47 Schaden/s unabhängig von der Zahl der Waffen; nur der **Anfangsstoß** (volle Rohre) wächst. Der Deckel ist **gemeinsam** statt je Waffe: eine statische Obergrenze je Waffe hätte die
Start-Lerche ändern müssen (Batterie 6, Lanze 12, Golden), also begrenzt `MAGAZINDECKEL.stossMax = 36` (= 1,5 × 24) die Summe der **gespeicherten Anfangsstöße** aller Energiewaffen. Regel: Jede **nicht ausgefallene** Energiewaffe mit Ladung (auch angefangener) belegt ihren vollen
Anfangsstoß im Magazin; eine Waffe ohne Ladung fängt erst an zu laden, wenn ihr Stoß noch hineinpasst. **Waffen mit Ladepunkten haben Vorrang:** passt ein solcher Stoß nicht mehr hinein, geben volle Waffen **ohne** Ladepunkte (Reserve) ihre Ladung ab, die hinterste zuerst; nur wenn alle Belegenden selbst Punkte haben, meldet die wartende Waffe „Magazin voll“ (`blk` im Snapshot, Pult und Konsole zeigen den Text statt „0 %“). Bis drei Waffen (Start) greift der Deckel nie. *Befund beim Bau:* die erste Fassung kürzte nur den Zuwachs und **blockierte sich**, sobald sechs Waffen halb geladen waren
(keine wurde mehr fertig, Dauerfeuer 0); die Reservierung ganzer Stöße schließt das aus.

## 5. Torpedowerfer (Kais Vorgabe 2026-10-18, verbindlich)

**Regeln:** Heck 2 (Stufe 2, an die Stufe gebunden), **keine Energie, nicht im Ladepool**, eigener **Cooldown 10 s** (beschädigt ×1,5), **kein Nachladen per Befehl** (R gibt nur noch einen Hinweis), kein Energiefaktor, **fällt nicht mit dem Triebwerk aus**.
Munition = Lager `inventory.bolzen` (Schlüssel bleibt, Anzeigename **Torpedo**): **hartes Limit 12** (Start 6). Alle Zugänge kappen auf 12: Shop/Terminal (`CONFIG.shop[bolzen].limit`), Debug `inv`, **Fundbelohnungen und Regiebuch-Gutschriften über `Waffen.lagerGutschrift`** (eine Stelle; der Überhang wird zu **10 Marken je Torpedo verkauft**, die ODA sagt „Torpedolager voll (höchstens 12) – n Torpedos für m Marken verkauft“; Begründung: ein Fund soll nie wertlos sein und nie das Limit sprengen), Weltstand-Restore (Überhang mit 10 Marken erstattet, Log). Kistentext „Bolzen“ → „Torpedos“.
Ziel: das gewählte Gegnerziel (T) im Heckbogen, **zielsuchendes Projektil** (`kind torpedo`, Tempo 400, Wenden 1,6 rad/s, Lebensdauer 3 s, wie der heutige Bolzen). **Kein Schildschaden, Lesart B für alle Ziele (Kai 2026-10-18, ersetzt Lesart A):** der Torpedo wirkt **nur, wenn das getroffene Schildsegment 0 ist** (ausgefallen); an einem stehenden Schild **prallt er ab** (Schaden 0, kein Schildabzug, Sprengblitz, `stats.torpedoAbgeprallt`). Kein Sonderfall mehr für Pylon und Wächter.

**Schaden je Zielklasse** (Katalog `TORPEDO.schaden`, in Schadenspunkten; Hüllen aus `CONFIG.enemies` × `crewScaling` × `enemyHpFactor`):

| Ziel (Schild 0 im getroffenen Sektor) | Hülle solo / zu dritt | Schaden je Treffer | Treffer bis Zerstörung (solo / zu dritt) | Zeit bis Zerstörung bei Cooldown 8 / 10 / 12 s (zu dritt) |
|---|---|---|---|---|
| Jäger | 18 / 25 | **45** | **1 / 1** (sofort) | 0,9 s |
| Korvette | 16 / 22 | 9 | 2 / 3 | 16,9 / 20,9 / 24,9 s |
| Fregatte | 36 / 50 | 9 | 4 / 6 | 41 / 51 / 61 s |
| Kreuzer | 60 / 84 | 9 | 7 / 10 | 73 / 91 / 109 s |
| Wächter / Pylon / Frachter | 7–22 | 9 | 1–3 | – |

(Messung `node tools/pan01-torpedo-messung.js`, Rohdaten dort.) **Begründung:** Der Jäger muss mit einem Treffer sterben (Kai); sein Schaden 45 liegt über jeder Jäger-Hülle (Basis 44 × 0,8, also nie über 35). Die Korvette hat im Code **weniger** Hülle als der Jäger (40 gegen 44), „Korvette nur anschlagen“
geht deshalb nur über den Schaden je Zielklasse: 9 Punkte = 41 % der Korvetten-Hülle zu dritt, also drei Treffer (30 s bei Cooldown 10 s), Fregatte sechs. Der Torpedo ist ein Jäger-Killer und ein Schildbrecher-Ersatz gegen Große, nie Hauptwaffe gegen Fregatte und Kreuzer.

**Ausweichbar/abschießbar (Entscheidung):** Der Torpedo der Lerche ist ein Lenkgeschoss und für Gegner **nicht** ausweichbar/abschießbar (sie haben kein Ausweichmodell, das zählt wie der Bolzen). Der **Gegner-Torpedo** ist **ausweichbar** (Ausweichfenster `dodgeWindow` 0,8 s wie bei der Ladung: wer vor dem
Einschlag ausweicht, wird verfehlt) und vom **Abwehrturm abschießbar**; er ist langsamer und träger (Tempo 150, Wenden 0,9 rad/s, 6 s).

**Schild-Verhalten (Katalogwert `TORPEDO.schildUmgehung = 'nur-ohne-schild'`, Kai 2026-10-18):** Der Torpedo trifft nur ein **ausgefallenes** Schildsegment, sonst prallt er ab; das gilt für **alle** Ziele (ein Wert, kein Sonderfall `raetselKlassen`, der Wächter und der Pylon im Kustoden-Relais brauchen keine eigene Regel mehr). `'immer'` (frühere Lesart A, Torpedo geht an Schilden vorbei) bleibt nur als **Testschalter** im Katalog (Test und Messskript). Der Torpedo ist damit der **Hüllenfinisher** nach dem Schildaufbruch (Sturm, Streu, Batterie), nicht der Schildbrecher-Ersatz. Treffer bis Zerstörung (Crew 3, Ziel steht still mit der Schildseite zur Lerche; `node tools/pan01-torpedo-messung.js`, — = kein Schaden, solange der Schild steht):

| Ziel | Lesart A (nur Testschalter) | Lesart B, Schild steht | Lesart B, Schild 0 |
|---|---|---|---|
| Jäger | 1 | — | 1 |
| Korvette | 3 | — | 3 |
| Fregatte | 6 | — | 6 |
| Kreuzer | 10 | — | 10 |
| Pylon | 1 | — | 1 |
| Kustoden-Wächter | 2 | — | 2 |

Arena-Bot (3 Spieler, Steuer maneuver, 12 Seeds, Lager 12, Bogen 60°, Cooldown 10 s, **Projektilwaffen**): ohne Torpedo **5,0 Wellen, Hülle −96, 619 s**; mit Torpedo **Lesart B 5,5 Wellen, Hülle −67, 504 s** (11,6 Torpedos, nur **1,8 Treffer**, die übrigen prallen am stehenden Schild ab: der Bot feuert blind, ein Mensch wartet auf den ausgefallenen Schild). Frühere Messung mit Strahl-Batterie: Lesart A 6,0 Wellen, −49, 283 s; Lesart B 5,5, −95, 531 s (8,8 Treffer).
**Cooldown 10 s und Lager 12 bleiben** (Begründung): Mit B wirkt der Torpedo nur in Fenstern mit ausgefallenem Schild; der Bot gewinnt dadurch rund 0,5 Wellen und 100 s, also weit weniger als mit A (+1,0 Wellen, halbe Dauer). Ein kürzerer Cooldown würde nur mehr blinde Abpraller erzeugen, ein größeres Lager die Verschwendung des Bots verlängern; ein Mensch verbraucht je Gefecht weniger (nur bei Schild 0). Das Lager von 12 bleibt die Obergrenze, 10 s liegen in der Erkundungsspanne 8–12. Spieltest-Punkt: ob der Torpedo mit B zu selten trifft; Hebel dann Cooldown 8 s (billig, Bot-Messung dazu: Rauschen).

**Kernfrage: Gegner-Torpedo gegen die Lerche (Entscheidung, gemessen).** Gleiche Regeln für Spieler und Gegner, aber **kein Schuss darf die Lerche zerstören** (Game Over gibt es nicht, man scheitert mit Würde). Lösung: **Schaden als Katalogwert je Zielklasse**, gegen die Lerche `TORPEDO.gegenLerche = 6` Schadenspunkte
= **30 von 100 Hülle** (höchstens ein Drittel; Test ≤ 34). **Lesart B gilt auch gegen die Lerche (Kai 2026-10-18):** ein Gegner-Torpedo trifft nur, wenn der **getroffene Schildsektor der Lerche 0 ist**; bei stehendem Schild **prallt er ab** (Hülle −0, Schild unberührt, Ton und Blitz wie ein Schildtreffer ohne Schaden). Messung: ein Treffer bei vollen Schilden: Hülle −0 (abgeprallt); bei Schild 0: Hülle −30 (30 %), Schildabzug 0; direkt nach einer Ausweichrolle: −0; drei Treffer in Folge (Schild 0) −90 (Notfallprotokoll bei 0, nie Game Over). **Folgen:** (1) Der Gegner-Torpedo ist gefährlich, wenn der Schild unten ist; wer Schilde hält, ist geschützt; Sturm- und Streu-Gegner, die Schilde aufbrechen, machen ihn tödlich (gewollt). (2) **Mehrspieler:** Hülle und Schilde sind je Schiff geteilt, mehr Spieler heißen mehr Gegner und mehr Feuerlast auf den Sektoren, also häufiger Schild 0; die Zahl der Torpedos je Gegner steigt nicht (Cooldown × Crew-Faktor wie bisher). (3) Der **Abwehrturm** bleibt als Schutz (Flak). (4) Kein Game Over: ein Treffer kostet höchstens 30 Hülle (Notfallprotokoll bei 0, wie bisher). **Gegner-Torpedo sitzt nur auf Seitenplätzen (Abnahme 3, Entscheidung):** Auf dem Bug-Platz einer Korvette, Fregatte oder eines Kreuzers feuerte er nie, weil diese Schiffe der Lerche ihre **Breitseite** zeigen und der Bug-Bogen nur 40° misst. Der Torpedo steht deshalb nur auf `stbd`, `bb` (Fregatte und Kreuzer `stbd1…`, `bb1…`; Bogen 90° quer zur Fahrt, Reichweite 500–520). Eine Vorgabe mit Torpedo am Bug wird abgelehnt (Debug `spawn korvette bug=torpedowerfer` → Fehlertext; Regiebuch und `spawnEnemy` verwerfen die Vorgabe und zählen einen Fehler `gegner-torpedo-platz`, das Schiff trägt dann die Zufallsbestückung). Die Feuerrate bleibt (höchstens alle ≈ 12 s, Cooldown 10 s × 1,2 × Crew-Faktor), der Schaden bleibt 30 Hülle bei Schild 0, kein Game Over: **kein neuer Weg, die Lerche zu überwältigen**; der Torpedo kommt nur öfter (überhaupt) an. Das Schiff muss dazu Breitseite fliegen; ein Gegner, der frontal anfliegt (Jäger), trägt keinen Torpedo (hat keine Plätze). Gegner tragen den Torpedo **nur gezielt**
(Labor, Spielleiter, Regiebuch `spawn { waffen: { bug: 'torpedowerfer' } }`, Debug `spawn korvette bug=torpedowerfer`); die Zufallsbestückung bleibt bei `lanze | batterie | bolzen`. Ein Gegner-Torpedo kommt höchstens alle ≈ 12 s (Cooldown 10 s × 1,2 × Crew-Faktor).

**Heckbogen (gemessen):** Der Erkunder sah den 60°-Bogen als Engpass (Bot: etwa 15 Mal je Lauf im Bogen). Messung PAN-01 C im Arena-Bot (3 Spieler, 12 Seeds, Steuer maneuver, `node tools/pan01-torpedo-messung.js --bot`): mit dem **Startlager 6** feuert der Bot bei **60° und 90° gleich viele**
Torpedos (≈ 5,9 je Lauf: das Lager ist leer, der Bogen ist nicht der Engpass); mit **Lager 12** feuert er **9,5–10,4 Torpedos bei 60°** und **10,1–10,5 bei 90°** (Treffer 7,3–8,7 gegen 7,9–8,6; Unterschiede im Rauschen). **Entscheidung: Heckbogen bleibt 60°** (enges Gegengewicht, wie der Leiter verlangt);
eine Weitung auf 90° ist nicht nötig, um ihn zu benutzen. Der Cooldown (8/10/12 s) ändert die Läufe im Rauschen (Wellen 5,8–6,0 von 6, Hülle −42 bis −71, Dauer 291–334 s), solange das Lager von 12 die Obergrenze setzt; **10 s** bleibt (Erkundung 8–12, Ziel ≈ 1 Ladepunkt Dauerfeuer wäre bei Schaden 9 bis 45 nicht sinnvoll messbar,
das Lager ist die Bremse: 12 Torpedos × 10 s = 2 Minuten).

**Wirkung auf den Kampf (Messung der früheren Lesart A, Strahlbatterie; mit Lesart B und Projektilen siehe oben, dort ist die Wirkung deutlich kleiner):** Mit Jäger-Treffer = tot macht der Torpedo die Standardwellen deutlich leichter (Arena-Bot, 3 Spieler, 12 Seeds): ohne Torpedo 5,1 von 6 Wellen, Hülle −105, 611 s; mit Torpedo (Lager 6) 5,8 Wellen, Hülle −63, 401–416 s;
mit Lager 12 6,0 Wellen, Hülle −42 bis −54, 291–313 s. Der Bot verbraucht ≈ 6 bis 10 Torpedos je Lauf (8 Jäger), das Lager von 12 und der Kaufpreis (10 Marken je Stück gegen 20 Marken Beute je Jäger) sind die Bremse. Soll der Torpedo weniger tragen, sind die Hebel: Lager (8 statt 12),
Heckbogen (45°), Schaden gegen Jäger nur knapp über der Hülle (bleibt Kais Vorgabe), Preis je Torpedo. Das ist ein Spieltest-Punkt (Bot ist ein schwacher Pilot und trifft ohne Zielen nur im Bogen).

## 6. Gegner aus demselben Katalog, Ziel-Scan, Module

- **Abbildung der Zufallsbestückung** (`CONFIG.korvetteWaffen: lanze | batterie | bolzen`, Würfel unverändert, Golden-stabil): `e.waffen[platz]` hält weiter die Altart oder – nur gezielt – eine Katalog-Id; `Katalog.eintragVon(wert, platz)` liefert den Katalogeintrag:
  `lanze` → **Lanze** (Bug) bzw. **Lanzenbatterie** (Seite); `batterie` → **Standardkanone** (Bug) bzw. **Standardbatterie** (Seite), Verhalten Sperrfeuer-Salve; `bolzen` → **Standardkanone** bzw. **Standardbatterie**, Verhalten einzelner gezielter Schuss. Der Gegner-Bolzen hat nie den Spielerwert 5 getragen (Schaden steht in
  `CONFIG.enemies`), er wird deshalb nicht verändert. `Katalog.verhaltenVon(wert)`: `lanze | batterie | bolzen | sturm | streu | torpedo | abwehr`.
- **Weitere Katalogwaffen für Gegner** (Labor, Spielleiter, Regiebuch `spawn.waffen`, Debug `spawn <kind> <platz>=<waffe>`): `sturmbatterie` (Sperrfeuer mit 8 dünnen Nadeln, Wirkung wie §2), `streubatterie` (Granatenwurf alle ≈ 8 s zu dritt, ausweichbar), `torpedowerfer` (§5), `lanzenbatterie`/`lanze`/`standardbatterie`/`standardkanone`
  (wie die Altarten). Der Abwehrturm ist für Gegner ohne Wirkung. Plätze der Fregatte und des Kreuzers (`stbd1` …) gelten wie `stbd`.
- **Ziel-Scan:** der Snapshot liefert gescannten Gegnern `weapons: [{ platz, typ }]` (Altart oder Katalog-Id; ≈ 112 B für ein Ziel mit drei Plätzen, nur gescannt); der Client zeigt Name und Symbol je Platz. **Module je Klasse** stehen statisch im Katalog (`MODULE_JE_KLASSE`, null Snapshot-Kosten):
  Jäger –, Korvette Werkstatt, Fregatte Krankenstation + Werkstatt, Kreuzer Krankenstation + Werkstatt + Frachtraum, Frachter 2 × Frachtraum, Wächter/Pylon/Relais –. Ein Spielleiter-Gegner darf es später überschreiben.
- **Taktik/Navigation** sehen die Bestückung je Seite (Bögen mit Beschriftung und Symbol, Client).

## 7. Weltstand (Version bleibt 3)

`schiff.waffen` `{ "4": "sturmbatterie", … }` (Schema mit allen neun Plätzen und den acht Ids; klein, ≤ 200 B), Wiederherstellung nach Stufe und Modulen. **Altstände laden ohne Verlust** (Test mit Altstand von `main`/`pan01-a`/`pan01-b`):
fehlt `schiff.waffen`, gilt die Startbestückung 8/4/6; ein gekaufter **Bolzenwerfer** hebt die Stufe auf 2 und wird der Torpedowerfer auf Heck 2 (bei Fehlschlag 220 Marken zurück); die **Zusatzrohre** (`seitenturm`, 300 Marken) werden erstattet; Torpedos über dem Lagerlimit mit 10 Marken je Stück; unbekannte Ids und
Plätze mit falscher Platzart werden verworfen (der Platz bleibt leer). Alles steht im Log.

## 8. Protokoll, Debug

- Neuer Debug-Befehl `bestueck` (`Protocol.DEBUG_CMDS`): `bestueck <platz 1–9> <waffe-id|leer>`, `bestueck alle [stufe]` (Stufe setzen und jeden offenen Platz bestücken: Seiten Standardbatterie, 8 Lanze, 5 Standardkanone, 2 Torpedowerfer), `bestueck start` (Stufe 0, Startbestückung), `bestueck status`.
  `spawn <kind> [volk=…] [<platz>=<waffe> …]` nimmt Waffen je Gegnerplatz; `inv` klemmt Torpedos auf 12. `Protocol.MOUNTS` kennt alle neun Mount-Ids.
- Befehle unverändert: `weapons.fire {mount}` (`all` = alle Salvenwaffen, `bolzen` = Altname des Torpedowerfers), `weapons.charge {mount, on}` (jede Lanze), `weapons.alloc {mount, delta}` (jede Energiewaffe), `weapons.reload` (nur Hinweis).
- Config: `weapons.bolzen`, `weapons.seitenturm`, `combat.bolzen*`, Shop `seitenturm` und `bolzenwerfer` entfernt; `bolzen` im Shop `limit: 12`, Name „Torpedo“.

## 9. Messungen (Rohdaten in den Skripten)

**Feuerkraft bei 3, 5, 7, 9 Energiewaffen, gleicher Pool** (nach der Projektil-Umstellung neu gemessen, 2026-10-18; `node tools/pan01-feuerkraft-messung.js --pool 4|6 --verteilung reihum|best|ziel [--einseitig]`, deterministisch: **ruhende** Attrappen (100 % Treffer), Ops feuert alles, Lanzen voll). Die Zahlen liegen durchgehend **≈ 33 % über den früheren Strahlwerten** (Schaden 2 statt 1,5 je Treffer bei voller Trefferquote, siehe §2); die **Verhältnisse zwischen 3, 5, 7, 9 Waffen sind dieselben** (frühere Werte in Klammern):

| Szenario | Pool | Verteilung | Dauerfeuer 60–180 s (Schaden/s) für 3 / 5 / 7 / 9 Waffen | Anfangsstoß (Vorrat) |
|---|---|---|---|---|
| Ziele in allen Richtungen | 4 | reihum (Standard) | 2,43 / 2,60 / 2,53 / 2,27 (2,10 / 2,10 / 2,05 / 1,94) | 24 / 36 / 36 / 36 |
| Ziele in allen Richtungen | 6 (ohne Hitze) | reihum | 3,60 / 3,77 / 3,25 / 3,00 (2,95 / 3,10 / 2,53 / 2,47) | 24 / 36 / 36 / 36 |
| Ziele in allen Richtungen | 6 (ohne Hitze) | best (Ops optimal) | 2,95 / 2,95 / 2,90 / 2,90 (2,63 / 2,63 / 2,60 / 2,60) | 24 / 36 / 36 / 36 |
| **einseitig** (Gegner nur Steuerbord) | 4 | **ziel** (Ops verteilt auf Waffen mit Ziel) | 2,27 / 2,27 / 2,27 / 2,27 (1,70 ×4) | 24 / 36 / 36 / 36 |
| **einseitig** | 6 | ziel | 2,27 / 3,52 / 3,52 / 3,52 (1,70 / 2,65 ×3) | 24 / 36 / 36 / 36 |
| einseitig | 4 | reihum (Standard, Punkte unverändert) | 0,67 / 0,67 / 0,67 / 1,01 (0,50 / 0,50 / 0,50 / 0,82) | 24 / 36 / 36 / 36 |
| einseitig | 6 | reihum | 1,25 / 1,33 / 1,13 / 0,80 (0,95 / 1,00 / 0,85 / 0,66) | 24 / 36 / 36 / 36 |

Der Anfangsstoß wächst von 24 auf 36 (**1,5×, gedeckelt**; ohne Deckel wären es 54,9 = 2,3×), das **Dauerfeuer bleibt mit verteilten Punkten gleich oder wächst nur durch die Auswahl** (einseitig: mehr Waffen auf der Gefechtsseite nutzen den Pool voll, 2,27 → 3,52; nie neunfach). Die **Standardverteilung** (reihum, Start der Partie) streut die Punkte auch auf Waffen ohne Ziel
und gibt dem Turm einen Punkt: einseitig sinkt das Dauerfeuer damit bei 9 Waffen (1,25 → 0,80 bei Pool 6), bis die Ops mit Q/E und A/D auf die Waffen mit Ziel umlegt (der Bot tut das automatisch, „ziel“-Zeilen). Die erste Fassung des Magazins (Reservierung ohne Vorrang) legte im einseitigen Gefecht zusätzlich Punkte still (0,41–0,58 gegen 1,48 der Start-Lerche, Review H2): behoben (Vorrang der Waffen mit Punkten, ausgefallene belegen nichts). Ab Waffen-Energie 4 überhitzt die Waffenbank nach 12,5 s (Erkundung): Pool 6 nur ohne Hitze messbar.

**Arena-Bot** (`node tools/pan01-energie-bot.js --seeds 12 --set "start;w3;w5;w7;w9;tor12B-60-10"`, 3 Spieler, Steuer maneuver, 6 Standardwellen, Start-Verteilung 2/2/2 = Pool 4; die Bot-Spieler verteilen die Punkte nach der Lage), **mit Projektilen** (2026-10-18) gegen die Werte mit Strahl (Review-Stand):

| Satz | Wellen von 6 (früher) | Hülle verloren (±SE) (früher) | Dauer s (±SE) (früher) | Waffenschaden je Laufsekunde (früher) | Projektile je Lauf, Trefferquote |
|---|---|---|---|---|---|
| start = w3 (8 4 6) | 5,0 (5,2) | 96 (±20) (99) | 619 (±55) (597) | 0,66 (0,66) | 246, **65 %** |
| w5 (+ 7 9) | 5,3 (5,6) | 84 (±18) (80) | 572 (±30) (518) | 0,66 (0,74) | 228, **69 %** |
| w7 (+ 5 1) | 5,3 (5,7) | 65 (±15) (86) | 553 (±29) (525) | 0,68 (0,74) | 238, **66 %** |
| w9 (+ 3 2) | 5,7 (5,7) | 75 (±16) (102) | 524 (±29) (516) | 0,76 (0,79) | 251, **77 %** |

Abweichung gegen früher: Wellen −4 / −5 / −7 / 0 %, Dauer +4 / +10 / +5 / +2 %, Hülle im Rauschen (±20), Waffenschaden je Sekunde −0 bis −11 %: **innerhalb von ≈ ±10 %** (Kais Vorgabe). **Trefferquote 65–77 %** (Schüsse, die ein Ziel treffen, je abgefeuertem Projektil, `stats.schuesse` / `stats.schussTreffer`). Der Schaden je Sekunde **steigt** mit den Plätzen (+0 % bei 5, +3 % bei 7, +15 % bei 9), nie neunfach. Standardfehler: ±20 Hülle und ±25–55 s. Der Bot schießt auf dem Bogen, den Vorhalt rechnet der Server (kein Zusatzwissen des Bots, kein Eingriff in die Treffer).

**Torpedo** (Teil 1 und 2 deterministisch, Teil 3 Arena-Bot, beide Lesarten): siehe §5; Skript `node tools/pan01-torpedo-messung.js [--bot --seeds 12]`.

**Snapshot** (`npm run snap:mess`, Ziel ≤ 18 944 B): Worst Case max 11 661 B, Wellenlauf 10 732, Raum-Alarm 11 615, Methalle 10 684, Endkampf 11 519, Konvoi 8 358, Flotte 11 443, Orbitschlacht 13 318 B. Auf `pan01-b` (gleiche Messung): 11 700 / 10 771 / 11 654 / 10 727 / 11 562 / 8 397 / 11 482 / 13 361 B, also je **−39 bis −43 B**. Neun Waffen (gemischt bestückt, alle sechs Lafetten-Systeme) kosten **+895 B** im Block ship (1 841 → 2 736 B: Mounts 324 → 1 110 B, Systeme 255 → 357 B; Test), also im Worst Case ≈ **12,6 KB**, weit unter 18 944 B. Ziel-Scan: ≈ 112 B je gescanntem Ziel.

## 10. Tests

`node tools/test-waffen-schiff.js` (neu, in `npm test`, **235 Prüfungen**): Katalog vollständig und konsistent (Felder, Modell, Symbol, Ton, Projektil je Art; Startwerte gleich Config; Töne in `audio.js`; Lafettenmodelle im Voxel-Manifest), Plätze/Stufen/`lafette_N` (aktiv nur offen und bestückt, Trefferziele, Snapshot, Station, Reparatur),
Ladepool geteilt (Energiewaffen ziehen aus demselben Pool, Reserve lädt nicht, Torpedo ohne Pool und ohne Energie/Triebwerk), Magazindeckel (Anfangsstoß ≤ 36, Dauerfeuer-Obergrenze, **volle Reserve gibt Platz frei, ausgefallene belegen nichts, einseitiges Gefecht, „Magazin voll“**), **Zustandsfaktor (beschädigte Batterie lädt wie vor PAN-01 C)**, Torpedo-Regeln (kein Schildschaden, Hülle, Jäger tot, Korvette nicht, Cooldown, Lager hart 12, Limit im Shop **und bei Funden**, an die Stufe gebunden, Heckbogen,
Gegner-Torpedo ≤ ⅓, Ausweichen, Abwehrturm schießt ihn ab, **Torpedo Lesart B für alle Ziele: Abprallen am stehenden Schild, Treffer bei Schild 0, Gegner-Torpedo gegen die Lerche gleich, Testschalter Lesart A**), **Projektile statt Strahl: Katalog (Strahl nur Lanze und Lanzenbatterie), Treffer, Verfehlen ins Leere, Ausweichen (300 px/s quer: 0 Treffer), gleicher Schaden je Treffer gegen Schild und Hülle, Snapshot mit neun feuernden Waffen (max 10 412 B)**), Sturm, Streu, Lanzenbatterie, **Abwehrturm mit Standardverteilung ohne Handeingriff (solo und zu dritt: Salven > 0)**, Seiten verschieden bestückt, Gegner aus dem Katalog, Weltstand-Roundtrip und Altstände (**Migration idempotent**), **Altname `weapons` zählt nur aktive Lafetten**, Snapshot-Budget.

**Angepasste Tests** (bewusst, begründet): `test-m3` (SYS14 = 13 Basissysteme; `SYSTEM_ORDER` 19; Zusatzrohre und Bolzenwerfer im Katalog aufgegangen), `test-features`, `test-lerche`, `test-energie`, `test-weltstand`, `test-sektoren`, `check-maps` (19 Stationen). **Projektil-Umstellung (2026-10-18):** `test-features`, `test-combat` (erwartete Salve = Erwartungswert `Katalog.volley`), `test-m3`, `test-konvoi`, `test-wellen-all` (Brocken schlucken Projektile), `test-waffen-schiff` fixieren ruhende Ziele jetzt auch bei `vx = vy = 0` (der Vorhalt rechnet mit der Geschwindigkeit) und prüfen Projektile statt Strahlen; `test-sl3`: Fenster der Verlustzeit 22–40 s (§14). Sonst nichts aufgeweicht.

## 11. Client (Pult, Konsolen, Taktik)

Siehe Rückmeldung des Client-Teils im Bericht: Pult-Ziffernblock mit Name, Symbol und Zustand je Platz (neun Zellen), Q/E wählt Energiewaffen, A/D verteilt, Torpedo-Zelle mit Lager und Cooldown, Zielkasten mit Waffen und Modulen, altes Interface ebenso, Taktik mit beschrifteten Bögen je Seite,
Projektil- und Strahlformen je Art, neue Töne, Lafetten-Platzhalter je Waffenart, HUD-Systemliste mit den Lafetten.
**Nachbesserung nach der Abnahme (14, 12):** Die **Steuer** (neues Pult: Spalte LAGE; altes Interface: unter dem Sprung) und der **Captain** (Pult: unter SCHILDE · HINWEISE als 2 × 2) zeigen je Seite **Bug / Bb / Stb / Heck** die Bestückung (Kurzname, bei mehreren gleichen `× n`, bei gemischten `+ k`) und die Bereitschaft (`bereit`, `lädt auf`, `n %`, `AUS`, bei mehreren `bereit/gesamt`) – nur Anzeige, bedient wird am Ops-Pult. Quelle: `SchiffsUI.seitenUebersicht(ship)` (`schiffswaffen-ui.js`, Gruppen nach dem Ziffernblock: Bug 8 5, Bb 7 4 1, Stb 9 6 3, Heck 2). Die **Pult-Zellen** kürzen Name und Zustand auf die Breite neben dem Symbol (`opts.rechts` in `Pult.zelle`: `BATTERIE` → `BATT.`, `Magazin voll` → `Magazin`), die Ladepunkte stehen unten rechts statt über dem Namen; im alten Interface zeigt die kompakte Zeile `Magazin` statt `Magazin voll`. Die **Taktik-Beschriftung** der Bögen weicht den Leisten oben links aus (Fracht, Landepunkt-Scan, Zonen-Scan: `drawTactical(..., { sperren })` legt sie als Hindernis in die Labelplatzierung). Screenshots: `Pantheon-gestaltung/pan01/pruefung-c/abnahme/n-pult-{helm,captain,weapons}.png`, `n-alt-{helm,captain,weapons}.png`.
**Voxel-Lafetten klein und dunkel (Abnahme 12, nur ein Wunsch an das Voxelwerk, hier nichts geändert):** Die Modelle `lerche/station/lafette_*` stehen in der Stationsbeleuchtung des Innenraums ohne eigenes Licht. Billige Hebel auf Voxelwerk-Seite: (1) je Lafetten-Station ein schwaches warmes Akzentlicht (Punktlicht, Radius ≈ 3 Kacheln) oder ein emissiver Streifen am Sockel in der Farbe des Platzes; (2) die Modellhöhe von 1,25 auf ≈ 1,6 anheben (`art-pan01.json` Höhe, Lafetten sind gegen die Bedienpulte klein); (3) hellere Metallpalette (`METALL` heller als der Boden) bzw. ein 1-Voxel-Kontrastrand. In `public/js/voxel/ship.js` ist nur die Höhe (2) ohne Voxelwerk änderbar.

## 12. Debug-Rezept für Kai

`npm run debug` im Worktree (`Pantheon-pan01-c`, Port per `PORT=…`), Seite mit `?debug=1`, Konsole des Browsers:
1. Start: Lobby „Testgelände Raumkampf (Wellen All)“ oder „Szenario-Labor“; `__game.debugCmd('sitz', {console: 'weapons'})` setzt dich an die Ops.
2. Ausbau und Bestückung: `__game.debugCmd('bestueck', {args: 'alle 3'})` (Stufe 3, alle neun Plätze); einzeln `{args: '4 sturmbatterie'}`, `{args: '6 streubatterie'}`, `{args: '7 lanzenbatterie'}`, `{args: '5 standardkanone'}`, `{args: '2 torpedowerfer'}` oder `{args: '2 abwehrturm'}`, `{args: '9 leer'}`; zurück `{args: 'start'}`;
   Stufe ohne Waffen ändern: `__game.debugCmd('ausbau', {args: '2'})`.
3. Gegner im Labor: `__game.debugCmd('spawn', {args: 'korvette'})`, mit Waffen `{args: 'korvette bug=torpedowerfer stbd=sturmbatterie bb=streubatterie'}` oder `{args: 'fregatte stbd1=streubatterie'}` (Fregatte/Kreuzer heißen die Plätze bug, stbd1 …). Ziel wählen: T, scannen: S halten.
4. Torpedos: `__game.debugCmd('inv', {item: 'bolzen', n: 12})` (höchstens 12). Lerche beschädigen: `__game.debugCmd('damage', {system: 'lafette_7', state: 'damaged'})`. Magazin/Verteilung ansehen: Pult OPS, `Q/E` + `A/D`.
5. Messen: `node tools/pan01-feuerkraft-messung.js`, `node tools/pan01-energie-bot.js --set "w3;w9"`, `node tools/pan01-torpedo-messung.js`.

## 13. Abweichungen vom Briefing, Annahmen, offene Punkte

- **Standardbatterie, Standardkanone und Sturmbatterie als Projektile (Kai 2026-10-18):** die frühere Abweichung „Sofortstrahl bleibt“ ist **aufgehoben**; die drei Waffen schießen langsame, ausweichbare Projektile (§2). Die Kalibrierung hebt den Schaden je Treffer von 1,5 auf 2 (Sturm 0,6 auf 0,7), damit der Bot denselben Waffenschaden je Sekunde erreicht; auf ruhende Ziele wirkt das +33 %.
- **Magazindeckel gemeinsam statt je Waffe** (§4): Begründung dort.
- **Ladepunkte-Verteilung:** reihum, nicht gewichtet (§4); wer mehr als vier Punkte-Waffen will, verteilt als Ops um.
- **Gegner-Bolzen → Standardkanone/Standardbatterie**, nicht „5 Schaden“ (der Spieler-Bolzenwert 5 galt nie für Gegner).
- **Gegner-Projektile haben Config-Zahlen, nicht Katalogzahlen** (§2 „Gleiche Regeln“): Golden-Stabilität; kein stilles Umstellen.
- **Gegner-Torpedo nur auf Seitenplätzen** (§5, Abnahme 3).
- **Abwehrturm unbesetzt:** Automatik unabhängig von der Spielerzahl (Nahabwehr), besetzt nur auf Befehl.
- **Heckbogen 60°** statt der erwogenen 90° (Messung §5).
- **Torpedo Lesart B** für alle Ziele und die Lerche (Kai 2026-10-18); die Wirkung auf die Wellen ist klein (§5).
- **Bot:** kauft keinen Bolzenwerfer mehr (Shop-Eintrag weg); die Zusatzplätze werden nur von der Messung bestückt (Start-Lerche und Kampagnen-Bots bleiben bei 8/4/6).
- **Lafetten-Voxelmodelle:** Modell-Ids stehen im Katalog (`lerche/station/lafette_*`), die Modelle liefert das Voxelwerk (parallel, nur gelesen); der Client zeichnet Platzhalter.
- **Offen für Paket D:** die Werft muss `Waffen.bestuecken(game, platz, id)` benutzen (prüft Platzart und Stufe), den Preis aus dem Katalog nehmen (Feld `preis` fehlt noch bewusst) und nach dem Umbau `verteilungZuruecksetzen` aufrufen (macht `bestuecken` schon). Das Terminal liest `shared/schiffskatalog.js` (Namen, Wirkung, Symbole).
- **Offen:** Treffer im Torpedolager (Feuer/Explosion) bleibt aus V1; Lerche-Sprite je Bestückung: nein (Auftrag Punkt 7).

## 14. Golden, Kampagnen-Bots, Prüfung (Stand nach Kais Entscheidung 2026-10-18: Projektile, Torpedo Lesart B)

- **Golden** (`--all --seeds 20`, neue Basis `tools/fixtures/golden/base-pan01c3`, Allow `allow-pan01c3.json` schlank; die Basen `base-pan01b2` und `base-pan01c2` bleiben als Vergleich): gegen `base-pan01c2` sind **nur 43 von 120 Traces byte-identisch** (m3 Crew 1 und 3 vollständig, m2 Crew 3 3 von 20; **m1 und m2 weichen ab**): jedes Gefecht läuft jetzt mit Projektilen (Treffer, Vorhalt, Ausweichen), danach anderer Zufall. Seeds 21–40: ebenfalls 41 von 120 identisch.
  **Fehlschläge (Erfolg → false), ehrlich gezählt (alle Crew 3, Crew 1 und m3 ohne Fehlschlag):**

| Seeds | `base-pan01b2` | `base-pan01c2` | **neu (`c3`)** | davon neu gescheitert gegen c2 | neu geheilt gegen c2 |
|---|---|---|---|---|---|
| 1–20 | 13 (m1/3 6, m2/3 7) | 16 (m1/3 6, m2/3 10) | **12** (m1/3 5, m2/3 7) | 4 (m1-s1, m1-s8, m2-s1, m2-s8) | 8 |
| 21–40 | 9 | 12 (m1/3 3, m2/3 9) | **5** (m1/3 2, m2/3 3) | 3 (m1-s21, m2-s21, m2-s34) | 10 |
| 1–40 | 22 | 28 | **17** | 7 | 18 |

  Gegen `b2` (die Basis vor dem Bolzenwerfer-Wegfall): 1–20 fünf neu gescheitert (m1-s1, m1-s8, m2-s1, m2-s4, m2-s8) und sechs geheilt, 21–40 zwei neu gescheitert (m1-s21, m2-s21) und sechs geheilt. **Ursache jeder Verschlechterung:** keine einzelne Regel, sondern der geänderte Gefechtsverlauf der Crew-3-Bots. Alle sieben Fälle scheitern an **derselben bekannten Fehlerart** wie vorher (`m1/return` bzw. `m2/ambush`/`m2/parley`: die Crew-3-Kampf-Todesspirale, dasselbe Muster wie auf `main`, `pan01-a`, `pan01-b`, `pan01-c`); die Fehlerverteilung nach Art ist 1–20: `m1/return` 12 → 10, `m2/ambush` 1 → 1, `m2/parley` 3 → 1; 21–40: `m1/return` 6 → 4, `m2/ambush` 3 → 1, `m2/parley` 3 → 0. Die Verschlechterungen halten sich mit den Heilungen nicht die Waage, sondern werden von ihnen übertroffen (netto **−11 gegen c2**, −5 gegen b2): der Gefechtszufall der Bots verschiebt sich, ein neuer Fehlertyp entsteht nicht. Ich führe das **nicht** auf einen Qualitätsgewinn zurück: einzelne Seeds kippen in beide Richtungen, und die Ursache im Einzelnen (welcher Schuss traf) ist bei diesem Zufall nicht aufzuklären.
  **Dauer-Gate des Vergleichs** (`--compare base-pan01c2 base-pan01c3 --lenient`): Median der **erledigten** Läufe m1/1 −5,6 %, m1/3 −12,3 %, m2/1 −0,2 %, m3 0 %, **m2/3 −30,5 % (Gate ±15 % rot, nur berichtet)**: in m2/3 erledigen jetzt 13 statt 10 Läufe die Mission, die Dauer misst nur erledigte Läufe (Überlebenden-Verzerrung), zusätzlich trifft der Schaden 2 je Treffer ruhende Ziele härter. Wer den Wert nicht hinnimmt, braucht dafür einen eigenen Spieltest.
- **Review H1 (frühere echte Ursache des Golden-Rests):** Die Standardbatterie erbte versehentlich den Ladezeit-Faktor 1,5 der beschädigten Lanze; behoben (Faktor 1, nur weniger Rohre), Test.
- **Kampagnen-Bots (alle grün, Stand 2026-10-18):** `npm test` Exit **0** (inklusive kette, `sim-sund --weg beide --crew 3`, `--kapitel alle --crew 3`, `sl --paket boje-a`); zusätzlich außerhalb von `npm test`: `kette --seeds 4` Crew 1 und Crew 3 (je 4 Läufe ok, 0 Fehler; Crew 3 Seed 4 hat die schon auf `pan01-c` bestehende lange Rückzugsschleife in Kapitel 7: 83 min gegen 107 min vor der Umstellung), `sl --paket alle` (alle Läufe ok), `sim-sund --weg beide --crew 1` und `--crew 3` (Löse- und Söldnerweg ok), `sim-sund --kapitel alle --crew 3` (keine Konsolenfehler), Arena-Bot (§9). Crew 2 ist Vorbestand (nicht angefasst). **Anpassung eines Tests:** `test-sl3` „Zeit bis zum Verlust ohne Gegenwehr“ hatte das Fenster 25–40 s; Seed 2 liegt jetzt bei 23,3 s (vorher 27,7): die Automatik der unbesetzten Ops schießt Projektile, die ein manövrierendes Ziel öfter verfehlen, die Piraten leben länger. Fenster auf 22–40 s.
- **Nachbesserung nach der Abnahme (2026-10-20):** Golden unverändert: ein neuer Lauf (Seeds 1–20) ist gegen `base-pan01c3` **byte-identisch (GOLDEN GRÜN)**, keine neue Basis `c4` nötig (Client-Anzeige, Beschriftung und der Gegner-Torpedo-Sitz berühren kein Kampagnenverhalten; kein Gegner der Kampagnen trägt einen Torpedo). `npm test` Exit 0, `npm run check` Exit 0, `check:assets` 0 Fehler, `snap:mess` unverändert (Worst Case max 11 661 B, Orbitschlacht 13 318 B), `test-waffen-schiff` 235/235.
- **Prüfung:** `npm test` Exit 0, `npm run check` Exit 0, `npm run check:assets` 0 Fehler, `npm run snap:mess` max 13 318 B (Orbitschlacht; Ziel ≤ 18 944 B), neun feuernde Waffen max 10 412 B (Test).
- **Altstand-Migration idempotent (Review L2):** Erstattungen (Zusatzrohre 300, Torpedo-Überhang 10 je Stück, Bolzenwerfer-Fehlschlag 220) werden beim Laden **sofort gespeichert** (`game.weltMigriert` → `Weltstand.save`), ein zweites Laden zahlt nicht erneut (Test). Ein Altstand mit **Bolzenwerfer wird ohne Aufpreis auf Stufe 2 angehoben** (der Torpedowerfer braucht Heck 2): akzeptiert.
- **Voxel-Lafetten:** Voxelwerk-Familie `lafette_*` (Commit 876fa42) synchronisiert, Manifest-Einträge (`art-pan01.json`, Höhe 1,25), `public/js/voxel/ship.js` zeigt das Modell der Waffenart auf bestückten Lafetten (Startplätze 8 4 6 nur bei abweichender Waffe; Abwehrturm dreht per `winkel`). `check:assets` 0 Fehler. **Nicht live angesehen:** das Voxel-Innenbild mit den Modellen (Screenshots zeigen das 2D-Innenbild).
- **Hinweis zum Abwehrturm:** er braucht Platz im Magazin; ein bestückter Turm hat jetzt immer einen Punkt (Vorrang vor Waffen ohne Punkte, §4).
- **Screenshots** der Projektile im Flug je Waffe (`node tools/sicht-waffen.js`): `Pantheon-gestaltung/pan01/pruefung-c/waffe-<id>-projektil.png` (Standardbatterie: Doppelbolzen, Standardkanone: dicker Bolzen, Sturmbatterie: Nadeln, Streubatterie: Granaten, Lanzenbatterie: Strahl).

## 15. Übergabe-Memo (Stand 2026-10-20, für Paket D)

**Stand:** Paket C ist fertig und abgenommen (Prüfer: 10, 11, 13, 21 erfüllt; 12 und 14 nachgebessert, siehe §11 und §14). Branch `pan01-c`, kein Push, kein Merge. Grundlage für Paket D (`pan01-d` von diesem End-Commit).

**Fertig:**
- Katalog `shared/schiffskatalog.js` (8 Waffen, 9 Plätze, Magazindeckel, Torpedo, Gegner-Abbildung, Module je Klasse); Server `server/sim/schiffswaffen.js` (Bestückung, Ladepool, Salven als **Projektile**, Lanze und Lanzenbatterie als Strahl, Streu, Torpedo **Lesart B**, Abwehrturm); Gegner aus dem Katalog; Weltstand `schiff.waffen` mit idempotenter Migration; Client (Pult, altes Interface, Taktik, Steuer- und Captain-Seitenübersicht).
- Messungen und Entscheidungen in §2, §4, §5, §9; Golden `base-pan01c3` (1–20 Fehlschläge 12, 21–40: 5, gegen c2 16 und 12) und Allow; alle Kampagnen-Bots grün.

**Nicht fertig / bewusst offen:**
- **Werft (Paket D):** `Waffen.bestuecken(game, platz, id)` benutzen (prüft Platzart und Stufe, setzt die Verteilung zurück), Preis aus dem Katalog (Feld `preis` fehlt bewusst), Terminal liest `shared/schiffskatalog.js`.
- **Voxel-Lafetten** klein und dunkel (Wunsch an das Voxelwerk in §11); das Voxel-Innenbild mit den Modellen nicht live bewertet.
- **Gegner-Projektile** mit Config-Zahlen statt Katalogzahlen (§2 „Gleiche Regeln“), bewusst wegen Golden-Stabilität.
- **Spieltest-Punkte:** ob der Torpedo mit Lesart B zu selten trifft (Hebel Cooldown 8 s); Magazin und Verteilung im echten Spiel mit neun Waffen; Dauer-Gate m2/3 (−30,5 %) in §14.
- **Lager-Treffer** (Feuer/Explosion im Torpedolager) bleibt aus V1; Lerche-Sprite je Bestückung: nein.
- Bei neun Waffen überlappen sich einzelne Bogenbeschriftungen der Taktik (die Platzierung hat nur wenige Ausweichschritte); die Landepunkt-Leiste verdeckt sie nicht mehr.

**Debug-Rezept (kurz, voll in §12):** `npm run debug` im Worktree, Seite `?debug=1` (2D-Pult: `&sitz=0`), Konsole: `__game.debugCmd('bestueck', {args: 'alle 3'})` (Stufe 3, alle Plätze), `{args: '4 sturmbatterie'}` je Platz, `__game.debugCmd('spawn', {args: 'korvette stbd=torpedowerfer bb=sturmbatterie'})` (Gegner-Torpedo nur auf `stbd`/`bb`), `__game.debugCmd('inv', {item: 'bolzen', n: 12})`. Messen: `node tools/pan01-feuerkraft-messung.js`, `node tools/pan01-energie-bot.js --set "start;w5;w9;tor12B-60-10"`, `node tools/pan01-torpedo-messung.js`. Prüfen: `npm test`, `node tools/test-waffen-schiff.js`, `npm run snap:mess`, Golden `node tools/golden-trace.js --all --seeds 20 --dir <ordner>` gegen `tools/fixtures/golden/base-pan01c3` mit `allow-pan01c3.json`.
