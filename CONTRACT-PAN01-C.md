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
| Server | `server/sim/space.js` | delegiert die Lerchen-Waffen; Gegner: Sturm, Streu, Torpedo; Projektile (torpedo, etorpedo, streu, estreu, sturm); Schaden-Optionen `huelle`, `sturm`, `streu` |
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
| `standardbatterie` | Seite | ja | Salve | 1,5 je Rohr | 4 (beschädigt 2) | 12,3 | 70° | 520 | 6 | Strahl bernstein | `battery_salvo` | `schiff_batterie` |
| `sturmbatterie` | Seite | ja | Salve | 0,6 je Nadel | 8 (Takt 0,07 s) | 10 | 60° | 440 | 4,8 | Nadeln türkis | `sturm_salvo` | `schiff_sturm` |
| `streubatterie` | Seite | ja | Salve | 2 je Granate | 3 (Takt 0,4 s) | 12 | 70° | 480 | 6 | Granate orange | `streu_wurf` | `schiff_streu` |
| `lanzenbatterie` | Seite | ja | Lanze | 3 bis 12, einmal | 1 | 18,5 | 16° | 650 | 12 | zwei Strahlen | `lance_fire` | `schiff_lanzenbatterie` |
| `lanze` | Bug | ja | Lanze | 3 bis 12 | 1 | 18,5 | 16° | 650 | 12 | Strahl | `lance_fire` | `schiff_lanze` |
| `standardkanone` | Bug | ja | Salve | 1,5 je Rohr | 3 | 9,2 | 50° | 560 | 4,5 | dicker Bolzen rotorange (`#FF7A3C`, eigene Form und Farbe gegen die bernsteinfarbene Batterie) | `kanone_salvo` (härterer Einzelschlag) | `schiff_kanone` |
| `torpedowerfer` | Heck | **nein** | Torpedo | je Zielklasse (§5) | 1 | – (Cooldown 10 s) | **60°** | 650 | 0 | Torpedo | `torpedo` | `schiff_torpedo` |
| `abwehrturm` | Heck | ja | Turm | 1,2 je Schuss | 2 (Takt 0,12 s) | 7 | 360° | 260 | 2,4 | Funken | `abwehr_feuer` | `schiff_abwehrturm` |

Ladekosten sind so gewählt, dass **Schaden je Ladepunkt und Sekunde** bei den Salvenwaffen bei ≈ 0,48 bis 0,50 liegt (Batterie 6/12,3 = 0,49, Sturm 4,8/10 = 0,48, Streu 6/12 = 0,50, Kanone 4,5/9,2 = 0,49), bei den
Lanzen 0,65 (12/18,5; wie heute). Der Abwehrturm ist bewusst schwach (0,34). Die Lafettenmodelle (`lerche/station/lafette_*`) liefert das Voxelwerk; bis dahin zeichnet der Client je Art einen eindeutigen Platzhalter.

**Wirkungen:**
- *Standardbatterie / Standardkanone:* Sofortstrahl wie die heutige Batterie (Konzept „langsame Projektile“ siehe §13 Abweichungen), Salve aus den Rohren im Takt, Ziel ohne Auswahl: gewähltes Ziel im Bogen, sonst nächster, sonst ins Leere. **Beide laden beschädigt ohne Zeitfaktor** wie die alte Batterie (`spaceM3.mounts.port` kennt keinen `damagedFactor`), beschädigt feuern nur halb so viele Rohre; nur Lanzen laden beschädigt 1,5× langsamer. (Die erste Fassung gab der Batterie versehentlich den Faktor 1,5: unbemerkte Regeländerung an der Start-Lerche, behoben, Test.) Kanone und Batterie sind im Spiel unterscheidbar: Kanone = ein dicker rotoranger Bolzen und eigener Ton, Batterie = zwei bernsteinfarbene Bolzen.
- *Sturmbatterie:* gegen einen **hohen Schild** (> 1 Punkt im getroffenen Segment) nimmt jede Nadel nur 25 % ihres Schadens vom Schild, **nichts von der Hülle**, und die Schildregeneration des Ziels ist 6 s gesperrt (`regenHold`);
  bei **niedrigem Schild** (≤ 1) gehen die Nadeln durch (Hülle) und werfen den nächsten Schuss des Ziels um 0,35 s zurück (Störung = „Systemschaden“ der Gegner, die kein Systemmodell haben). Gegen die Lerche (Gegner-Sturm): hoher Schild fast unberührt,
  `shields.regenHold` 6 s; bei niedrigem Schild je Nadel 8 % Chance auf einen Systemtreffer.
- *Streubatterie:* wirft `rohre` Granaten (Projektil `streu`), gefächert quer um den vorhergesagten Ort des Ziels, Flug zum Zielpunkt, Explosion nach **1,4 s** im Radius 70. Eine Explosion auf einem Ziel: nur **Schildschaden**
  (Schild × 1,5, nie Hülle). Eine **zweite** (andere Granate) innerhalb von 2 s: **sicherer Durchschlag** (3 Hülle am Schild vorbei) und Störung 1,5 s. Gegen die Lerche gilt dieselbe Regel (zweite Granate: 3 Schadenspunkte = 15 Hülle und ein sicherer Systemtreffer).
- *Lanzenbatterie:* wie die Bug-Lanze (Aufladen halten, Kurs halten, Strahl in Halterungsrichtung, Schildpierce 2), **zwei parallele Strahlen** (7 px Abstand), **Schaden einmal**. Aufladen mit `weapons.charge {mount}`.
- *Lanze:* unverändert (jetzt je Mount, also auch auf Bug 5 möglich).
- *Torpedowerfer:* §5.
- *Abwehrturm:* dreht sich selbst (Bogen 360°, Reichweite 260), bekämpft **Jäger** und **anfliegende Gegner-Torpedos** (ein Treffer zerstört den Torpedo), nie große Schiffe. Besetzte Ops feuert auf Befehl; **bei unbesetzter Taktik schießt er allein**, aber mit doppelter Ladezeit
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
Ziel: das gewählte Gegnerziel (T) im Heckbogen, **zielsuchendes Projektil** (`kind torpedo`, Tempo 400, Wenden 1,6 rad/s, Lebensdauer 3 s, wie der heutige Bolzen). **Kein Schildschaden:** der Torpedo geht an Schildsegmenten und -pool vorbei und trifft die **Hülle**.

**Schaden je Zielklasse** (Katalog `TORPEDO.schaden`, in Schadenspunkten; Hüllen aus `CONFIG.enemies` × `crewScaling` × `enemyHpFactor`):

| Ziel | Hülle solo / zu dritt | Schaden je Treffer | Treffer bis Zerstörung (solo / zu dritt) | Zeit bis Zerstörung bei Cooldown 8 / 10 / 12 s (zu dritt) |
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

**Schild-Verhalten (Katalogwert `TORPEDO.schildUmgehung`, Review M1):** Lesart **A** `'immer'` (gebaut, Kais Vorgabe): der Torpedo geht an Schildsegmenten vorbei und trifft die Hülle. Lesart **B** `'nur-ohne-schild'`: er wirkt nur auf ein **ausgefallenes** Schildsegment, sonst prallt er ab (Schaden 0, Schild unberührt). Der Wechsel ist ein Katalogwert, kein Code.
Ohne Rücksicht auf die Lesart gilt für **Set-Piece-Rätsel** `TORPEDO.raetselKlassen = ['pylon', 'sentinel']` (Pylon im Kustoden-Relais, Kustoden-Wächter) immer B: der Torpedo trivialisiert dort nicht den Schildaufbruch. Treffer bis Zerstörung (Crew 3, Ziel steht still; `node tools/pan01-torpedo-messung.js`, — = kein Schaden, solange der Schild steht):

| Ziel | Seite zur Lerche | Lesart A | Lesart B |
|---|---|---|---|
| Jäger | Bug (Schild) | 1 | — |
| Jäger | Heck (offen) | 1 | 1 |
| Korvette | Bug (Schild) | 3 | — |
| Korvette | Heck (offen) | 3 | 3 |
| Fregatte | Bug / Heck | 6 / 6 | — / — (Heck-Segment 1) |
| Kreuzer | Bug / Heck | 10 / 10 | — / — |
| Pylon | Bug (Schild) | — (Rätselklasse) | — |
| Pylon | Heck (offen) | 1 | 1 |
| Kustoden-Wächter | alle vier Seiten geschützt | — | — |

Arena-Bot (3 Spieler, Steuer maneuver, 12 Seeds, Lager 12, Bogen 60°, Cooldown 10 s): ohne Torpedo **5,2 Wellen, Hülle −99, 597 s**; **Lesart A 6,0 Wellen, Hülle −49, 283 s** (11 Torpedos, 9 Treffer); **Lesart B 5,5 Wellen, Hülle −95, 531 s** (12 Torpedos, 8,8 Treffer: die meisten prallen am Schild ab). B macht den Torpedo also zum Hüllenfinish nach dem Schildaufbruch, A zum Jäger-Killer. Kai entscheidet (A gebaut).

**Kernfrage: Gegner-Torpedo gegen die Lerche (Entscheidung, gemessen).** Gleiche Regeln für Spieler und Gegner, aber **kein Schuss darf die Lerche zerstören** (Game Over gibt es nicht, man scheitert mit Würde). Lösung: **Schaden als Katalogwert je Zielklasse**, gegen die Lerche `TORPEDO.gegenLerche = 6` Schadenspunkte
= **30 von 100 Hülle** (höchstens ein Drittel; Test ≤ 34), am Schild und am Pool vorbei. Messung: ein Treffer bei vollen Schilden: Hülle −30 (30 %), Schildabzug 0; direkt nach einer Ausweichrolle: −0; drei Treffer in Folge −90 (Notfallprotokoll bei 0, nie Game Over). Gegner tragen den Torpedo **nur gezielt**
(Labor, Spielleiter, Regiebuch `spawn { waffen: { bug: 'torpedowerfer' } }`, Debug `spawn korvette bug=torpedowerfer`); die Zufallsbestückung bleibt bei `lanze | batterie | bolzen`. Ein Gegner-Torpedo kommt höchstens alle ≈ 12 s (Cooldown 10 s × 1,2 × Crew-Faktor).

**Heckbogen (gemessen):** Der Erkunder sah den 60°-Bogen als Engpass (Bot: etwa 15 Mal je Lauf im Bogen). Messung PAN-01 C im Arena-Bot (3 Spieler, 12 Seeds, Steuer maneuver, `node tools/pan01-torpedo-messung.js --bot`): mit dem **Startlager 6** feuert der Bot bei **60° und 90° gleich viele**
Torpedos (≈ 5,9 je Lauf: das Lager ist leer, der Bogen ist nicht der Engpass); mit **Lager 12** feuert er **9,5–10,4 Torpedos bei 60°** und **10,1–10,5 bei 90°** (Treffer 7,3–8,7 gegen 7,9–8,6; Unterschiede im Rauschen). **Entscheidung: Heckbogen bleibt 60°** (enges Gegengewicht, wie der Leiter verlangt);
eine Weitung auf 90° ist nicht nötig, um ihn zu benutzen. Der Cooldown (8/10/12 s) ändert die Läufe im Rauschen (Wellen 5,8–6,0 von 6, Hülle −42 bis −71, Dauer 291–334 s), solange das Lager von 12 die Obergrenze setzt; **10 s** bleibt (Erkundung 8–12, Ziel ≈ 1 Ladepunkt Dauerfeuer wäre bei Schaden 9 bis 45 nicht sinnvoll messbar,
das Lager ist die Bremse: 12 Torpedos × 10 s = 2 Minuten).

**Wirkung auf den Kampf (ehrlich, zur Entscheidung durch Kai):** Mit Jäger-Treffer = tot macht der Torpedo die Standardwellen deutlich leichter (Arena-Bot, 3 Spieler, 12 Seeds): ohne Torpedo 5,1 von 6 Wellen, Hülle −105, 611 s; mit Torpedo (Lager 6) 5,8 Wellen, Hülle −63, 401–416 s;
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

**Feuerkraft bei 3, 5, 7, 9 Energiewaffen, gleicher Pool** (nach den Review-Fixes neu gemessen; `node tools/pan01-feuerkraft-messung.js --pool 4|6 --verteilung reihum|best|ziel [--einseitig]`, deterministisch: feste Attrappen, Ops feuert alles, Lanzen voll):

| Szenario | Pool | Verteilung | Dauerfeuer 60–180 s (Schaden/s) für 3 / 5 / 7 / 9 Waffen | Anfangsstoß (Vorrat) |
|---|---|---|---|---|
| Ziele in allen Richtungen | 4 | reihum (Standard) | 2,10 / 2,10 / 2,05 / 1,94 | 24 / 36 / 36 / 36 |
| Ziele in allen Richtungen | 6 (ohne Hitze) | reihum | 2,95 / 3,10 / 2,53 / 2,47 | 24 / 36 / 36 / 36 |
| Ziele in allen Richtungen | 6 (ohne Hitze) | best (Ops optimal) | 2,63 / 2,63 / 2,60 / 2,60 | 24 / 36 / 36 / 36 |
| **einseitig** (Gegner nur Steuerbord) | 4 | **ziel** (Ops verteilt auf Waffen mit Ziel) | 1,70 / 1,70 / 1,70 / 1,70 | 24 / 36 / 36 / 36 |
| **einseitig** | 6 | ziel | 1,70 / 2,65 / 2,65 / 2,65 | 24 / 36 / 36 / 36 |
| einseitig | 4 | reihum (Standard, Punkte unverändert) | 0,50 / 0,50 / 0,50 / 0,82 | 24 / 36 / 36 / 36 |
| einseitig | 6 | reihum | 0,95 / 1,00 / 0,85 / 0,66 | 24 / 36 / 36 / 36 |

Der Anfangsstoß wächst von 24 auf 36 (**1,5×, gedeckelt**; ohne Deckel wären es 54,9 = 2,3×), das **Dauerfeuer bleibt mit verteilten Punkten gleich oder wächst nur durch die Auswahl** (einseitig: mehr Waffen auf der Gefechtsseite nutzen den Pool voll, 1,70 → 2,65; nie neunfach). Die **Standardverteilung** (reihum, Start der Partie) streut die Punkte auch auf Waffen ohne Ziel
und gibt dem Turm einen Punkt: einseitig sinkt das Dauerfeuer damit bei 9 Waffen (0,95 → 0,66 bei Pool 6), bis die Ops mit Q/E und A/D auf die Waffen mit Ziel umlegt (der Bot tut das automatisch, „ziel“-Zeilen). Die erste Fassung des Magazins (Reservierung ohne Vorrang) legte im einseitigen Gefecht zusätzlich Punkte still (0,41–0,58 gegen 1,48 der Start-Lerche, Review H2): behoben (Vorrang der Waffen mit Punkten, ausgefallene belegen nichts). Ab Waffen-Energie 4 überhitzt die Waffenbank nach 12,5 s (Erkundung): Pool 6 nur ohne Hitze messbar.

**Arena-Bot** (`node tools/pan01-energie-bot.js --seeds 12 --set "w3;w5;w7;w9"`, 3 Spieler, Steuer maneuver, 6 Standardwellen, Start-Verteilung 2/2/2 = Pool 4; die Bot-Spieler verteilen die Punkte nach der Lage), nach den Review-Fixes:

| Satz | Wellen von 6 | Hülle verloren (±SE) | Dauer s (±SE) | Waffenschaden je Laufsekunde |
|---|---|---|---|---|
| w3 (Start 8 4 6) | 5,2 | 99 (±33) | 597 (±43) | 0,66 |
| w5 (+ 7 9) | 5,6 | 80 (±14) | 518 (±23) | 0,74 |
| w7 (+ 5 1) | 5,7 | 86 (±17) | 525 (±22) | 0,74 |
| w9 (+ 3 2) | 5,7 | 102 (±24) | 516 (±35) | 0,79 |

Der Schaden je Sekunde **steigt** mit den Plätzen (+12 % bei 5 und 7, +20 % bei 9), nie neunfach, und sinkt nicht mehr (die frühere Zeile „w9 5,0 Wellen, 0,66“ war die Magazin-Blockade). Mehr Plätze helfen dem Bot durch mehr besetzte Bögen (Auswahl). Standardfehler: ±20 Hülle und ±25–50 s.

**Torpedo** (Teil 1 und 2 deterministisch, Teil 3 Arena-Bot, beide Lesarten): siehe §5; Skript `node tools/pan01-torpedo-messung.js [--bot --seeds 12]`.

**Snapshot** (`npm run snap:mess`, Ziel ≤ 18 944 B): Worst Case max 11 661 B, Wellenlauf 10 732, Raum-Alarm 11 615, Methalle 10 684, Endkampf 11 519, Konvoi 8 358, Flotte 11 443, Orbitschlacht 13 318 B. Auf `pan01-b` (gleiche Messung): 11 700 / 10 771 / 11 654 / 10 727 / 11 562 / 8 397 / 11 482 / 13 361 B, also je **−39 bis −43 B**. Neun Waffen (gemischt bestückt, alle sechs Lafetten-Systeme) kosten **+895 B** im Block ship (1 841 → 2 736 B: Mounts 324 → 1 110 B, Systeme 255 → 357 B; Test), also im Worst Case ≈ **12,6 KB**, weit unter 18 944 B. Ziel-Scan: ≈ 112 B je gescanntem Ziel.

## 10. Tests

`node tools/test-waffen-schiff.js` (neu, in `npm test`, **209 Prüfungen**): Katalog vollständig und konsistent (Felder, Modell, Symbol, Ton, Projektil je Art; Startwerte gleich Config; Töne in `audio.js`; Lafettenmodelle im Voxel-Manifest), Plätze/Stufen/`lafette_N` (aktiv nur offen und bestückt, Trefferziele, Snapshot, Station, Reparatur),
Ladepool geteilt (Energiewaffen ziehen aus demselben Pool, Reserve lädt nicht, Torpedo ohne Pool und ohne Energie/Triebwerk), Magazindeckel (Anfangsstoß ≤ 36, Dauerfeuer-Obergrenze, **volle Reserve gibt Platz frei, ausgefallene belegen nichts, einseitiges Gefecht, „Magazin voll“**), **Zustandsfaktor (beschädigte Batterie lädt wie vor PAN-01 C)**, Torpedo-Regeln (kein Schildschaden, Hülle, Jäger tot, Korvette nicht, Cooldown, Lager hart 12, Limit im Shop **und bei Funden**, an die Stufe gebunden, Heckbogen,
Gegner-Torpedo ≤ ⅓, Ausweichen, Abwehrturm schießt ihn ab, **Pylon-Rätsel und Lesart B**), Sturm, Streu, Lanzenbatterie, **Abwehrturm mit Standardverteilung ohne Handeingriff (solo und zu dritt: Salven > 0)**, Seiten verschieden bestückt, Gegner aus dem Katalog, Weltstand-Roundtrip und Altstände (**Migration idempotent**), **Altname `weapons` zählt nur aktive Lafetten**, Snapshot-Budget.

**Angepasste Tests** (bewusst, begründet): `test-m3` (SYS14 = 13 Basissysteme; `SYSTEM_ORDER` 19; Zusatzrohre und Bolzenwerfer im Katalog aufgegangen), `test-features`, `test-lerche`, `test-energie`, `test-weltstand`, `test-sektoren`, `check-maps` (19 Stationen). Nichts aufgeweicht.

## 11. Client (Pult, Konsolen, Taktik)

Siehe Rückmeldung des Client-Teils im Bericht: Pult-Ziffernblock mit Name, Symbol und Zustand je Platz (neun Zellen), Q/E wählt Energiewaffen, A/D verteilt, Torpedo-Zelle mit Lager und Cooldown, Zielkasten mit Waffen und Modulen, altes Interface ebenso, Taktik mit beschrifteten Bögen je Seite,
Projektil- und Strahlformen je Art, neue Töne, Lafetten-Platzhalter je Waffenart, HUD-Systemliste mit den Lafetten.

## 12. Debug-Rezept für Kai

`npm run debug` im Worktree (`Pantheon-pan01-c`, Port per `PORT=…`), Seite mit `?debug=1`, Konsole des Browsers:
1. Start: Lobby „Testgelände Raumkampf (Wellen All)“ oder „Szenario-Labor“; `__game.debugCmd('sitz', {console: 'weapons'})` setzt dich an die Ops.
2. Ausbau und Bestückung: `__game.debugCmd('bestueck', {args: 'alle 3'})` (Stufe 3, alle neun Plätze); einzeln `{args: '4 sturmbatterie'}`, `{args: '6 streubatterie'}`, `{args: '7 lanzenbatterie'}`, `{args: '5 standardkanone'}`, `{args: '2 torpedowerfer'}` oder `{args: '2 abwehrturm'}`, `{args: '9 leer'}`; zurück `{args: 'start'}`;
   Stufe ohne Waffen ändern: `__game.debugCmd('ausbau', {args: '2'})`.
3. Gegner im Labor: `__game.debugCmd('spawn', {args: 'korvette'})`, mit Waffen `{args: 'korvette bug=torpedowerfer stbd=sturmbatterie bb=streubatterie'}` oder `{args: 'fregatte stbd1=streubatterie'}` (Fregatte/Kreuzer heißen die Plätze bug, stbd1 …). Ziel wählen: T, scannen: S halten.
4. Torpedos: `__game.debugCmd('inv', {item: 'bolzen', n: 12})` (höchstens 12). Lerche beschädigen: `__game.debugCmd('damage', {system: 'lafette_7', state: 'damaged'})`. Magazin/Verteilung ansehen: Pult OPS, `Q/E` + `A/D`.
5. Messen: `node tools/pan01-feuerkraft-messung.js`, `node tools/pan01-energie-bot.js --set "w3;w9"`, `node tools/pan01-torpedo-messung.js`.

## 13. Abweichungen vom Briefing, Annahmen, offene Punkte

- **Standardbatterie „langsame Projektile, ausweichbar“:** die Lerchen-Batterie ist seit M3a ein **Sofortstrahl** (hitscan, Ziel im Bogen). Ihn auf Projektile umzustellen hätte alle Läufe, Bots und Golden berührt, ohne dass das Paket es verlangt („Golden-Stabilität“). Die Standardbatterie bleibt, die Gegner-Batterie (`batterie`) ist weiter das langsame, ausweichbare
  Sperrfeuer. Die Streubatterie ist die ausweichbare Projektilwaffe der Lerche. Soll auch die Standardbatterie langsame Projektile verschießen, ist das ein eigener Auftrag (Konzept und Bots).
- **Magazindeckel gemeinsam statt je Waffe** (§4): Begründung dort.
- **Ladepunkte-Verteilung:** reihum, nicht gewichtet (§4); wer mehr als vier Punkte-Waffen will, verteilt als Ops um.
- **Gegner-Bolzen → Standardkanone/Standardbatterie**, nicht „5 Schaden“ (der Spieler-Bolzenwert 5 galt nie für Gegner).
- **Abwehrturm unbesetzt:** Automatik unabhängig von der Spielerzahl (Nahabwehr), besetzt nur auf Befehl.
- **Heckbogen 60°** statt der erwogenen 90° (Messung §5).
- **Torpedo-Wirkung auf die Wellen** ist stark (§5, ehrlich zur Entscheidung).
- **Bot:** kauft keinen Bolzenwerfer mehr (Shop-Eintrag weg); die Zusatzplätze werden nur von der Messung bestückt (Start-Lerche und Kampagnen-Bots bleiben bei 8/4/6).
- **Lafetten-Voxelmodelle:** Modell-Ids stehen im Katalog (`lerche/station/lafette_*`), die Modelle liefert das Voxelwerk (parallel, nur gelesen); der Client zeichnet Platzhalter.
- **Offen für Paket D:** die Werft muss `Waffen.bestuecken(game, platz, id)` benutzen (prüft Platzart und Stufe), den Preis aus dem Katalog nehmen (Feld `preis` fehlt noch bewusst) und nach dem Umbau `verteilungZuruecksetzen` aufrufen (macht `bestuecken` schon). Das Terminal liest `shared/schiffskatalog.js` (Namen, Wirkung, Symbole).
- **Offen:** Treffer im Torpedolager (Feuer/Explosion) bleibt aus V1; Lerche-Sprite je Bestückung: nein (Auftrag Punkt 7).

## 14. Golden, Kampagnen-Bots, Prüfung (Stand nach dem Review)

- **Review H1 (echte Ursache des Golden-Rests):** Die Standardbatterie erbte versehentlich den Ladezeit-Faktor 1,5 der beschädigten Lanze (`P.damagedFactor || 1.5`); die alte Batterie hatte keinen. Das war eine **unbemerkte Regeländerung an der Start-Lerche** und der Grund für den Rest 16 → 19. Behoben (Faktor 1, nur weniger Rohre), Test.
- **Golden** (`--all --seeds 20`, neue Basis `tools/fixtures/golden/base-pan01c2`, Allow `allow-pan01c2.json` schlank, die frühere `base-pan01c` entfällt): gegen `base-pan01b2` **106 von 120 Traces byte-identisch**. Ursache der übrigen: die Bots kaufen keinen Bolzenwerfer mehr (Shop-Eintrag entfällt, Torpedowerfer erst mit Stufe 2), andere Marken, danach anderer Zufall der Gefechte (Crew 3).
  **Fehlschläge (Erfolg true → false), ehrlich gezählt:** Seeds 1–20 vorher **13** (m1/3 6, m2/3 7), nachher **16** (m1/3 6, m2/3 10), **identisch zum Kontrolllauf** `pan01-b`-Code mit nur entferntem Bolzenkauf (16, m2/3 10): der Rest ist damit voll durch den fehlenden Bolzenwerfer erklärt (er war pool-frei zu stark, Erkundung 1,26 Schaden/s). Seeds 21–40: vorher 9 (m1/3 3, m2/3 6), nachher **12** (m1/3 3, m2/3 9; nicht einzeln kontrolliert, gleiches Muster). Über 1–40: 22 → 28 von 240.
  Die Crew-3-Bots scheitern an der bekannten Kampf-Todesspirale (dasselbe Muster wie auf `main`/`pan01-a`/`pan01-b`), kein neuer Fehlertyp. Bei Crew 1 und m3 keine Fehlschläge.
- **Kampagnen-Bots:** `npm test` (kette Crew 1 und 3, `sim-sund --weg beide --crew 3`, `--kapitel alle --crew 3`, `sl --paket boje-a`) Exit 0; zusätzlich außerhalb von `npm test`: `kette` Crew 1 und 3 (Seeds 1–3), `sl --paket alle`, `sim-sund --weg beide --crew 1` – Ergebnis im Bericht. Crew 2 ist Vorbestand (nicht angefasst).
- **Altstand-Migration idempotent (Review L2):** Erstattungen (Zusatzrohre 300, Torpedo-Überhang 10 je Stück, Bolzenwerfer-Fehlschlag 220) werden beim Laden **sofort gespeichert** (`game.weltMigriert` → `Weltstand.save`), ein zweites Laden zahlt nicht erneut (Test). Ein Altstand mit **Bolzenwerfer wird ohne Aufpreis auf Stufe 2 angehoben** (der Torpedowerfer braucht Heck 2): akzeptiert.
- **Voxel-Lafetten:** Voxelwerk-Familie `lafette_*` (Commit 876fa42) synchronisiert, Manifest-Einträge (`art-pan01.json`, Höhe 1,25), `public/js/voxel/ship.js` zeigt das Modell der Waffenart auf bestückten Lafetten (Startplätze 8 4 6 nur bei abweichender Waffe; Abwehrturm dreht per `winkel`). `check:assets` 0 Fehler. **Nicht live angesehen:** das Voxel-Innenbild mit den Modellen (Screenshots zeigen das 2D-Innenbild).
- **Hinweis zum Abwehrturm:** er braucht Platz im Magazin; ein bestückter Turm hat jetzt immer einen Punkt (Vorrang vor Waffen ohne Punkte, §4).
