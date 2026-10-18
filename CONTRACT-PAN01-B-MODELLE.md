# CONTRACT-PAN01-B-MODELLE – Modellliste für das Voxelwerk (PAN-01 Paket B, Lerche neu)

Stand: 2026-10-18, Branch `pan01-b`. Grundlage: `shared/maps.js` (Kachelplan, Legende) und `public/js/voxel/ship.js` (Zuordnung Kachelart → Modell).
Die Innenansicht folgt `Shared_Maps`. Wo das Voxelwerk (noch) kein Modell hat, steht in `ship.js` ein **Platzhalter** (vorhandenes ähnliches Modell oder farbiger Block).
Diese Liste nennt jede neue oder geänderte Kachelart und jedes Prop. Modell-IDs und Parameter bitte so wählen, dass `ship.js` nur die ID und die Parameter austauschen muss.

Maße: 1 Kachel = 1 m, die Modelle stehen auf der Kachelmitte, +z zeigt in den Raum (wie bisher). Höhe der Wände bleibt, Decks werden einzeln gezeigt (Deckschnitt wie bisher).

## Schiffsgröße und Decks (Kachelplan)

| | Kacheln | Anmerkung |
|---|---|---|
| Rumpf je Deck | 40 × 13 (Länge × Breite) | bisher 37 × 13, Mittelgang 3 Kacheln breit auf allen Decks |
| Mitteldeck | x 0–39 | Heck links, Bug rechts, Backbord oben, Steuerbord unten |
| Oberdeck | x 6–39 | kürzer: nichts über dem Antrieb |
| Unterdeck | x 6–39 | kürzer: kein Heck (Antriebssektion fehlt), dafür der Bugraum |
| Schächte | L2 x 7–8, Notleiter x 17, L1 x 28–29 (alle y 5–7, Notleiter y 6) | stehen auf allen drei Decks übereinander |

## Neue und geänderte Kachelarten / Props

| Kachelart / Prop (Legende) | Raum, Deck | Größe (Kacheln) | Zweck | Zustände | Variante je Modul / Deck | Platzhalter heute |
|---|---|---|---|---|---|---|
| **Liftkabine** `lerche/lift/shaft` + `platform` (`^`) | L1 (Brückenlift) und L2 (Hecklift), alle drei Decks | **2 × 3** (bisher 2 × 2), Durchgang an den Schmalseiten (West/Ost), Nord/Süd geschlossen | Brückenlift: **einzige Tür zur Brücke**, mit **zwei Türen** (Brücke / Gang), nicht beschädigbar. Auf dem Mitteldeck läuft man ohne E hindurch | Fahrt (moving), Notstrom (power); Wahl W/S zeigt Pfeile (UI, kein Modell) | Deck 0 Bronze, Deck 1 Marmor, **neu: Deck 2 (Unterdeck) Stahl/Technik**; Variante `tuer_offen` für die beiden Türen | zwei 2 × 2-Modelle (`shaft`, `platform`), um ± 0,5 versetzt |
| **Notleiter** `lerche/lift/ladder` (`!`) | Maschinenraum (Mitteldeck), Meetingraum (Oberdeck), Lafettenbereich (Unterdeck), jeweils Raummitte | 1 × 1 | E aktiviert, W/S wechselt das Deck, langsamer als der Lift | benutzt (Fahrt) | wie bisher; Unterdeck: Luke im Boden/Decke je nach Richtung wäre schön, nicht nötig | bestehendes Modell |
| **Verschalte Pforte** (`+`, kind `door_sealed`) | Unterdeck: Modulraum 3 (x 10, Wandzeile 36), Modulraum 4 (x 10, Zeile 40), Lafettenbereich (x 20, Zeile 38) | 1 × 1 in der Wandzeile (Türbreite) | sichtbar verschlossen bis zum Ausbau | **verschlossen** (Verschalung, Querbalken, Warnband, Stufenzeichen 1/2) · **offen** (normale Tür, `lerche/kit/door`) | Stufe 1: Modulraum 3 und Lafettenbereich, Stufe 2: Modulraum 4 | farbiger Block (verschlossen), `lerche/kit/door` (offen) |
| **Lafette** (`1 2 3 5 7 9`, kind `sys_lafette`; 8, 4, 6 bleiben die Stationen `K`, `M`, `J`) | Platz 7/1 Lafetten Backbord, 9/3 Lafetten Steuerbord (Unterdeck x 15–19), Platz 5 Bugraum (Unterdeck), Platz 2 Antriebsraum (Mitteldeck) | 1 × 1 | Ort eines Waffenplatzes. Paket C setzt hier die Waffenmodelle auf | **verschlossen** (Abdeckung/Plane, Gitter) · **frei/leer** (Sockel mit Zahnkranz, ohne Rohr) · später belegt (Paket C) | Platzart: Bug (5, größer), Heck (2), Seite (7, 9, 1, 3; Backbord/Steuerbord gespiegelt) | `lerche/furn/crate` (verschlossen), `lerche/station/battery` mit `tubes 0` (frei) |
| **Modulplatz A** (`q`, kind `mod_a`) | Modulräume 1–4 (Unterdeck), je Raum zwei, an der Fernwand, Zugang davor | 1 × 1 | Frachtbucht / Liege / Werkbank, je nach Modul im Raum | Frachtraum: leer / Ladung (Art 1–3) / ungesichert; Krankenstation: Liege frei; Werkstatt: Werkbank | **Frachtraum:** Frachtbucht (`lerche/furn/cargo_bay`), **Krankenstation:** Krankenliege (`med_bed`), **Werkstatt:** Werkbank (`workbench`), **ohne Modul:** Stauware | die genannten bestehenden Modelle, ohne Modul `crate` |
| **Modulplatz B** (`r`, kind `mod_b`) | Modulräume 1–4, je Raum zwei, an der Türwand | 1 × 1 | Frachtbett (Person) / Liege / Werkzeugwand | Frachtraum: Bett leer oder Person liegt (Figur als `ship.npcs`) | **Frachtraum:** Bett, **Krankenstation:** zweite Krankenliege oder Medizinschrank, **Werkstatt:** Werkzeugwand (`tool_wall`), **ohne Modul:** Stauware | `bed` / `med_bed` / `workbench` / `crate` |
| **Modulplatz C** (`h`, kind `mod_c`) | Modulräume 1–4, je Raum eins, Mitte der Fernwand | 1 × 1 | Zierstück, macht das Modul von weitem erkennbar | – | **Frachtraum:** Containerstapel mit Hebezeug, **Krankenstation:** Scanner/Behandlungsgerät, **Werkstatt:** Drehbank mit Ruhebank des zweiten Schraubers, **ohne Modul:** Stauware | `crate` / `control_desk` / `pipes` / `crate` |
| **Modulraum-Boden** (`lerche/kit/floor`) | Modulräume 1–4 | 7 × 3 je Raum (alle vier gleich: 21 Kacheln) | Boden zeigt das Modul | – | Frachtraum: Metall mit Gelb-Schwarz-Streifen (neu), Krankenstation: `kind 5` (bestehend), Werkstatt: Gitterboden (`kind 1`), leer: Metall | bestehende Böden (Krankenstation: kind 5), sonst Metall |
| **Spind** (`0`, kind `locker`) | Quartiere 1–4 (Oberdeck), je Quartier einer in der Ecke gegenüber der Koje | 1 × 1 | Ort für die Optik-Einstellungen (später), jetzt nur Kulisse | – | – | `lerche/furn/sideboard` |
| **Quartier** (7 × 3, Oberdeck) | links und rechts vom Meetingraum, vier Stück | 7 × 3 (bisher 3 × 3) | persönlich einrichtbar | Boden/Wand/Licht-Optionen wie bisher (`st.quarters`), vier Deko-Slots | – | Koje `bed` Farbe 0–3 |
| **Meetingraum** (Oberdeck, x 15–19, y 1–11) | Mitte des Oberdecks | 5 × 11 | Planungstisch mit Missionsbuch, Handelskonsole, Notleiter | Planungstisch aktiv (Spieler sitzen), Konsole angedockt | Missionsbuch auf dem Tisch (Prop, neu, 1 × 1, aufgeschlagen) | `plan_table` (2 × 2), `console/shop`, `ladder`; Missionsbuch fehlt |
| **Handelskonsole** `lerche/console/shop` (`S`) | Meetingraum (zog aus der Messe um) | 1 × 1 | Handel und später Werft (Paket D baut sie neu) | angedockt / nicht | – | bestehendes Modell |
| **Messe** (Oberdeck Bug, x 29–38) | Bug | 10 × 11 | Treffpunkt, Trophäen, Schlafecke von Ivo | Trophäen gefüllt/leer, Schlafecke bewohnt/Stauware | – | `trophy_niche`, `shrine`, `mess_table` (2 × 2), `sideboard`, `cargo_cot`/`tool_wall` |
| **Brücke** (Mitteldeck, x 29–38) | Bug | 10 × 11, **symmetrisch zur Mittelachse** | Steuer, Ops, Captain, Hauptschirm | wie bisher | Rückwand mit dreibreitem **Liftportal** (L1) in der Mitte | bestehende Konsolenmodelle |
| **Bugraum** (Unterdeck, x 29–38) | unter der Brücke | 10 × 11 | Lanze (Platz 8) ab Start, zweite Bugwaffe (Platz 5) nach dem Ausbau, Bug-Emitter | Stationszustände wie bisher | – | `station/lance`, `station/emitter`, Lafette 5 (s. o.) |
| **Maschinenraum** (Mitteldeck, x 15–19) | Mitte | 5 × 11 | Reaktor, Schildgenerator, Technik-Pult, Schalter, Notleiter in der Mitte | wie bisher | Lebenserhaltung entfällt (Kachel `O` weg) | bestehende Modelle |
| **Unterdeck-Stil** (Wand, Boden, Leuchten) | ganzes Unterdeck | – | Ausbaudeck: roher, technischer als das Mitteldeck | Leuchten Alarm/Notstrom wie bisher | Wandstil `style 2`-ähnlich (Stahl, Rippen), Bodenmarkierungen | heute Wandstil des Mitteldecks |

## Außenansicht und Optik-Andockpunkte (nur Daten)

`Shared_Maps.ANDOCKPUNKTE` liefert Punkte für Bugzier (`bug`), Triebwerk (`triebwerk`), Banner (`banner_bb`, `banner_stb`) und die neun Lafetten (`lafette_1` … `lafette_9`), in Kacheln der Draufsicht (0,0 = Heck/Backbord, Länge 40, Breite 13). Die Außenansicht (`art.js` `drawShip`) bleibt in Paket B unberührt.
Das neue **Lerche-Modell** (drei Decks) und der **Draufsicht-Sprite** liefert das Voxelwerk getrennt; die Außenform soll zum Rumpf 40 × 13 passen (Hülle vom Heck zum Bug, Bug rechts).

## Wo `ship.js` die Modelle wählt

- Kachelart → Modell: Tabellen `STATION_ID`, `CONSOLE_ID`, `FURN_ID` und die Sonderfälle in `buildDynamic` (Modulplätze nach Modul im Raum, Pforte nach Ausbaustufe, Lafette nach Ausbaustufe, Lift 2 × 3).
- Zustand: `snapshot.ship.mod` (Module je Raum), `snapshot.ship.st` (Ausbaustufe), `snapshot.fracht` (Waren, Personen).
