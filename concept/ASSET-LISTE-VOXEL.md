# Asset-Liste Voxel-Umstellung – Lerche römisch, zwei Decks

Stand 2026-10-07 · Konzeptrunde (Art Director, Lead Game Designer, Tech Lead), zusammengeführt von der Studioleitung.
Noch **nicht freigegeben** – Grundlage für `CONTRACT-M4.md` nach Kais Go.

## Legende
- **Stufe:** 1 = Terrain, 4 = Architektur, 16 = Detail (Voxel pro Meter) · FX = Shader/Partikel · UI = 2D-Overlay · Mood = Lichtstimmung
- **Status:** vorh. = in `voxelwerk/assets` nutzbar · anp. = auf Vorhandenem aufbauen · neu
- **Prio:** P1 = erste spielbare Voxel-Lerche (beide Decks innen + Raumkampf-Grundlagen) · P2 = 1:1-Port des heutigen Spiels (M1–M3b, m1–m3) · P3 = später/Vision
- **St.** = Standard-Zustandssatz für Systeme: Parameter `state` 0 ok · 1 beschädigt · 2 zerstört · 3 geflickt · 4 Eskalation · 5 EMP
- **Aufwand:** S/M/L, geschätzt (nicht gemessen)

## Entscheidungen der Studioleitung beim Zusammenführen
1. **Privatdeck ohne System.** Die Lebenserhaltung bleibt auf dem Systemdeck (B35). Der Nymphäum-Brunnen des Art Directors wird reine Kulisse (C22).
2. **Deck-Lage:** Systemdeck = Rumpf (unten), Privatdeck = sichtbarer Aufbau mittschiffs (oben). Außenform und Deckplan passen zusammen.
3. **Notleiter gehört dazu** (D6 → P1), zweite Verbindung neben dem Lift.
4. Ergänzt aus dem Deckplan: Lichtschacht, Panoramafenster, Becken, Aussichtsbank (C26–C29).

## Technische Pflichten für jedes Asset (Tech Lead)
- Eintrag im Spiel-Manifest `assets/game-assets.json`: `id` (englisch), `source` (Voxelwerk-Rezept), `tier`, `palette`, `category`, `tags`, `footprint` (Kacheln), `height` (m), `facing` (+z = Bedienseite), `sockets`, `states`, `tint`, `lod`, `budget`.
- Pivot Mitte unten. Kollision **nie** aus dem Modell, immer aus `shared/maps.js`. Höhe ≤ 2,2 m (Wände ausgenommen).
- Zustände als numerischer Parameter `state`. Tönbare Akzentflächen (Spielerfarbe) als eigenes Teil.
- Pflicht-Sockets: Station/Konsole `use`, `fx_smoke`, `fx_spark`, `label` · Schiff außen `mount_*`, `engine_*`, `shield_center` · Figur `handL`, `handR`, `back` · Ortsmodul `entrance`, `cover`, `terminal`, `guard`, `loot`, `objective`.
- Budgets (Dreiecke im Spiel): Bodenkachel ≤ 150 · Wandteil 1 m ≤ 600 · Architekturmodul ≤ 3.000 · Detail-Prop ≤ 2.500 · Station je Zustand ≤ 6.000 · Figur ≤ 6.000 (≤ 16 Teile) · Lerche außen ≤ 25.000 · Gegner klein/groß ≤ 6.000/40.000 · Terrainblock 16×16 m ≤ 8.000.
- Wand-Kit als Autotile: `wall_straight`, `wall_corner_outer`, `wall_corner_inner`, `wall_t`, `wall_cross`, `wall_end`, `door_frame` + `door_leaf`, jeweils `full` (3 m) und `cut` (1 m mit Kappe).

---

## A. Lerche außen (15)
| # | Asset | Stufe | Zustände/Varianten | Anker | Status | Prio | Aufw. |
|---|---|---|---|---|---|---|---|
| A1 | Rumpf Lerche römisch (Liburna) | 4 | Schaden je Sektor | muendung_bug, muendung_bb×4, muendung_stb×4, duese×5, emitter×4, schild_mitte, transfer, andock | anp. `schiff/lerche.json` + Formensprache `schiff/korvette/rom.json` | P1 | L |
| A2 | Bug mit Rostrum + Lanzenmündung | 4 | ruhig/lädt/besch/aus | muendung_bug | anp. | P1 | M |
| A3 | Batterie-Pfortenleisten Bb/Stb | 4 | 4/2/0 Rohre, Rückstoß | muendung×4 je Seite | anp. | P1 | M |
| A4 | Haupttriebwerk (3 Düsen) | 4 | Glühen je Stufe R…VOLL, stotternd, aus | duese×3 | anp. | P1 | M |
| A5 | Steuerdüsen als Adlerschwingen | 4 | feuernd/besch/aus | duese | neu | P1 | S |
| A6 | Brückenaufbau mit Helmkamm + Kuppel (= Privatdeck-Aufbau) | 4 | Kuppel beleuchtet | sensor | anp. | P1 | M |
| A7 | Spielfassung/LOD Lerche | 4 | – | wie A1 | neu | P1 | S |
| A8 | Schild-Emitter außen (×4) | 4 | ok/besch/aus, Sektorfarbe | emitter | neu | P2 | S |
| A9 | Aquila-Galionsfigur | 16 | intakt/besch | sockel | anp. `rom/bau/adler.json` | P2 | M |
| A10 | Rücken-Plattenkit Lorica/Marmor | 4 | sauber/verrußt | – | neu | P2 | S |
| A11 | Transfer-Emitter Unterseite | 4 | ruhig/aktiv | transfer | neu | P2 | S |
| A12 | Hüllenschaden je Sektor | 4 | 3 Stufen (Kratzer/Loch/brennt) | schaden_<sektor> | neu | P2 | M |
| A13 | Upgrade-Anbauten (Bolzenwerfer, Seitenturm) | 4 | gekauft/nicht | anbau_bolzen, anbau_turm | neu | P2 | S |
| A14 | Heckbanner + Positionslichter | 4/16 | – | – | anp. `rom/bau/banner.json` | P3 | S |
| A15 | Schildblase mit 4 Sektoren | FX | Stärke 0–4, Durchlassfarbe, Treffer | schild_mitte | neu | P1 | M |

## B. Lerche innen – Systemdeck (35)
| # | Asset | Stufe | Zustände/Varianten | Anker | Status | Prio | Aufw. |
|---|---|---|---|---|---|---|---|
| B1 | Boden Bronzekassette/Gitter | 4 | sauber/verrußt/Brandfleck | – | neu | P1 | S |
| B2 | Boden Brücke (Marmor, Kompassrose) | 4 | – | – | neu | P1 | S |
| B3 | Innenwand-Kit (Autotile, Pilaster mit Lichtfuge) | 4 | intakt/verrußt, full/cut | licht, plakette | anp. Stil `rom/bau/mauer.json` | P1 | M |
| B4 | Außenwand mit Rundbogen-Bullauge | 4 | – | – | neu | P2 | S |
| B5 | Schott/Tür im Rundbogen | 4 | zu/offen/verriegelt/klemmt | eingang | neu | P1 | M |
| B6 | Schnittkappe (Wandkrone auf Sockelhöhe) | 4 | – | – | neu | P1 | S |
| B7 | Hüllenbruch/Leck-Segment | 4 | offen/geflickt | leck | neu | P1 | S |
| B8 | Steuer (Joch, Adlerhaube) | 16 | frei/besetzt/Alarm | bedienplatz | neu | P1 | M |
| B9 | Taktik (Kartenpult mit Holo) | 16 | frei/besetzt/Ladungsalarm | bedienplatz | neu | P1 | M |
| B10 | Captain-Stuhl (kurulisch, mit Pult) | 16 | frei/besetzt | sitz | neu | P1 | M |
| B11 | Planungstisch 2×2 | 16 | aus/Holo/Pins | sitz×3 | neu | P1 | M |
| B12 | Freies Terminal | 16 | aus/an | bedienplatz | neu | P2 | S |
| B13 | Reaktor (Tholos mit Glühkern) | 4+16 | St. + online/überladen/offline | reparatur, feuer, licht | neu | P1 | L |
| B14 | Reaktorschalter A/B | 16 | ruht/gehalten/umgelegt | hand | neu | P1 | S |
| B15 | Schildgenerator (Säulenkranz, Ring) | 16 | St. | reparatur, feuer | neu | P1 | M |
| B16 | Triebwerk-Station | 16 | St. + Temposchimmer | reparatur, feuer | neu | P1 | M |
| B17 | Steuerdüse-Station (Bb/Stb) | 16 | St. | reparatur, feuer | neu | P1 | M |
| B18 | Batterie-Station (Bb/Stb, 4 Verschlüsse) | 16 | St. + 4/2 Rohre, Rückstoß | reparatur, feuer | neu | P1 | M |
| B19 | Schild-Emitter-Station (×4, Spule) | 16 | St. + Sektorfarbe | reparatur, feuer | neu | P1 | M |
| B20 | Lanzen-Ladekammer | 16 | St. + lädt | reparatur, feuer | neu | P1 | M |
| B21 | Transfer-System | 16 | St. | reparatur | neu | P1 | M |
| B22 | Transfer-Konsole | 16 | idle/aktiv | bedienplatz | neu | P1 | S |
| B23 | Transfer-Pad (×3, auch Außenmissionen) | 16 | idle/lädt/beamt/kühlt | pad | neu | P1 | S |
| B24 | Stations-Plakette (BUG/STB/HECK/BB/MITTE) | 16 | 5 Seiten × 5 Zustände | plakette | neu | P1 | S |
| B25 | Lagerregal (×5, Item + Füllstand 0–3) | 16 | Füllstand | entnahme | anp. `rom/zellenregal.json` | P1 | M |
| B26 | Ladungskisten | 16 | `seed` | – | vorh. `rom/kiste.json` | P2 | S |
| B27 | Rohrbündel mit Ventilblock | 16 | Dampfleck | rauch | neu | P2 | S |
| B28 | Werkbank | 16 | – | – | neu | P2 | S |
| B29 | Kontrollpult | 16 | – | – | neu | P2 | S |
| B30 | Fass/Kabeltrommel | 16 | `seed` | – | neu | P2 | S |
| B31 | Wandleuchte (Lucerna) + Notlicht | 16 | normal/Alarm/Notstrom | licht | anp. `rom/laterne.json` | P1 | S |
| B32 | Boden-Decals (Öl, Bolzen, Lüfter, Warnstreifen, Werkzeug, Kabel, Teile, Eimer, Schienen) | 16 | `seed` | – | neu | P2 | M |
| B33 | Aquila-Relief + Mäanderband am Brückenportal | 4 | – | – | anp. `rom/bau/adler.json` | P3 | S |
| B34 | Standarte auf der Brücke | 16 | – | – | vorh. `rom/standarte.json` | P3 | S |
| B35 | Lebenserhaltung (Algenkessel, Maschinenraum) | 16 | St. | reparatur, feuer | neu | P1 | M |

## C. Lerche innen – Privatdeck (29)
| # | Asset | Stufe | Zustände/Varianten | Anker | Status | Prio | Aufw. |
|---|---|---|---|---|---|---|---|
| C1 | Mosaikboden (Atrium, Messe) | 4 | 2–3 Muster | – | neu | P1 | M |
| C2 | Innenwand mit Stuck + Freskofeldern | 4 | Motive per `seed`, full/cut | licht | neu | P1 | M |
| C3 | Doppeltür Holz/Bronze | 4 | zu/offen | eingang | neu (Parameter an B5) | P1 | S |
| C4 | Koje/Lectus (×4 über `colors`) | 16 | Spieler 0–2/Gast | schlafplatz, deko-slot×4 | neu | P1 | M |
| C5 | Quartierböden, 5 Stile | 4 | 5 | – | neu | P2 | M |
| C6 | Quartierwände, 2 Stile (Garten-Fresko, Creme/Terrakotta) | 4 | 2 | – | neu | P2 | S |
| C7 | Licht im Quartier (warm/kühl/gedimmt) | Mood | 3 | – | anp. `moods/ship_interior.json` | P2 | S |
| C8 | Deko: Lorbeer im Kübel | 16 | – | deko-slot | neu | P2 | S |
| C9 | Deko: Wandtafel/Bild | 16 | Motive | deko-slot | neu | P2 | S |
| C10 | Deko: Bronzelampe | 16 | – | licht | neu | P2 | S |
| C11 | Deko: Teppich | 16 | – | deko-slot | neu | P2 | S |
| C12 | Deko: Schriftrollen-Regal (Capsa) | 16 | – | deko-slot | neu | P2 | S |
| C13 | Deko: Aquarium | 16 | – | deko-slot | neu | P2 | S |
| C14 | Deko: Sessel/Cathedra | 16 | – | sitz | neu | P2 | S |
| C15 | Deko: Wand-Sternkarte | 16 | – | deko-slot | neu | P2 | S |
| C16 | Deko: Bojen-Trophäe | 16 | – | deko-slot | neu | P2 | S |
| C17 | Deko: Kristalllampe (Vaelen) | 16 | – | licht | neu | P2 | S |
| C18 | Gästequartier-Extras (Ivos Reisekiste) | 16 | – | – | neu | P2 | S |
| C19 | Messetisch mit Bänken | 16 | – | sitz×4 | neu | P1 | M |
| C20 | Kombüse mit Amphoren-Kühler | 16 | – | – | neu | P2 | M |
| C21 | Hafenterminal/Shop | 16 | idle/aktiv/angedockt | bedienplatz | neu | P1 | S |
| C22 | Zierbrunnen/Nymphäum (Kulisse, kein System) | 16 | – | – | neu | P3 | M |
| C23 | Krankenstation (Liege ×3, Medischrank) | 16 | – | – | neu | P3 | M |
| C24 | Lararium/Trophäennische mit Hausschrein | 16 | leer/gefüllt („Funde x/12“) | deko-slot | neu | P3 | S |
| C25 | Wandleuchte warm (Variante B31) | 16 | – | licht | anp. `rom/laterne.json` | P1 | S |
| C26 | Lichtschacht mit Glasboden über dem Reaktor | 4 | Glühen folgt Reaktorzustand | – | neu | P2 | S |
| C27 | Panoramafenster Steuerbord (zeigt aktuellen Ort) | 4 | – | – | neu | P2 | M |
| C28 | Becken (Bad) | 16 | – | – | neu | P3 | S |
| C29 | Aussichtsbank | 16 | – | sitz | neu | P3 | S |

## D. Lift und Deckübergänge (6)
| # | Asset | Stufe | Zustände/Varianten | Anker | Status | Prio | Aufw. |
|---|---|---|---|---|---|---|---|
| D1 | Liftschacht mit Bronzegitter + Säulenportal (Parameter `deck`: Bronze/Marmor) | 4 | oben/unten/fährt | lift_oben, lift_unten | neu | P1 | M |
| D2 | Liftplattform mit Mosaik-Rosette + Geländer | 16 | ruht/fährt/Notstrom (Amber) | stand×3 | neu | P1 | M |
| D3 | Rufsäule | 16 | bereit/belegt | bedienplatz | neu | P1 | S |
| D4 | Deckschnitt (aktives Deck, Kappen, Randmarken ↑/↓) | Render | – | – | neu | P1 | M |
| D5 | Liftfahrt (Lichtband, Kamerablende) | FX | normal/Notstrom | – | neu | P1 | S |
| D6 | Notleiter (Scala) mit Luke | 4 | – | – | neu | P1 | S |

## E. Gegner und andere Schiffe (13)
| # | Asset | Stufe | Zustände/Varianten | Anker | Status | Prio | Aufw. |
|---|---|---|---|---|---|---|---|
| E1 | Rostmeute-Jäger | 4 | intakt/Rauch/Brand/Trefferblitz/Zerfall | duese×3, muendung×2 | anp. `schiff/rostmeute_jaeger.json` | P1 | S |
| E2 | Rostmeute-Kanonenboot | 4 | dito + Breitseitenladung | duese×3, muendung_bb/stb, ladung | anp. `schiff/rostmeute_kanonenboot.json` (Rumpf ggf. nordisch, siehe Frage an Kai) | P1 | M |
| E3 | Kustoden-Wächter (EMP) | 4 | dito + EMP-Ladung | ladung | neu | P2 | M |
| E4 | Kustoden-Pylon (Frontschild) | 4 | Front an/Ladung/zerstört | front, ladung | neu | P2 | M |
| E5 | Störrelais im All | 4 | aktiv/zerstört | – | neu | P2 | S |
| E6 | Grauzahn-Schiff | 4 | – | – | anp. `schiff/spaeher/nord.json` + Palette `grauzahn` | P2 | S |
| E7 | Hafen Lichtkordon (Station, Liegeplatz, Funkturm) | 4 | – | andock, liegeplatz | neu | P2 | L |
| E8 | Boje B-7 mit Plattform | 4 | stumm/aktiv | andock, transfer | neu | P2 | M |
| E9 | Vaelen-Karawane | 4 | – | andock | anp. `schiff/frachter/*` + Palette `vaelen` | P2 | M |
| E10 | Wrack „Zaunkönig“ außen | 4 | – | transfer | anp. `schiff/frachter/rom.json` (Wrackfassung) | P2 | M |
| E11 | Kustoden-Relais (Kern + Ring) | 4 | ruhend/Prüfung/gescannt | scan | neu | P2 | L |
| E12 | Mond Kesh | 1 | – | transfer | neu | P2 | M |
| E13 | Klassenrümpfe der 5 Völker, Spielfassungen | 4 | Palette, LOD | – | vorh. `schiff/<klasse>/<volk>.json` | P3 | L |

## F. Weltraum (9)
| # | Asset | Stufe | Zustände/Varianten | Anker | Status | Prio | Aufw. |
|---|---|---|---|---|---|---|---|
| F1 | Sternenhimmel, 3 Parallax-Ebenen | FX | – | – | neu | P1 | S |
| F2 | Nebel-Hintergrund je Ort | FX | 7 Tönungen | – | neu | P2 | M |
| F3 | Nebelvolumen Graue Weite | FX | – | – | neu | P2 | M |
| F4 | Asteroiden | 4 | `seed`, 3 Größen, zerbrochen | – | neu | P2 | M |
| F5 | Treibende Verstecke (Kiste, Teepaket, Wartungskiste, Schmugglerkiste, Frachtcontainer, Rettungskapsel) | 16/4 | versteckt/aufgedeckt/geborgen | beute | anp. `rom/kiste.json` + Kapsel neu | P2 | M |
| F6 | Baken (Lore-Bake, Leitbake, Selas Sonde, Kustoden-Splitter, Inschrift) | 4 | ungescannt/gescannt | scan | neu | P2 | M |
| F7 | Schrottfeld am Hafen | 4 | `seed` | – | neu | P3 | S |
| F8 | Ferne Himmelskörper je Ort | FX | – | – | neu | P3 | M |
| F9 | Stimmung `space` | Mood | – | – | vorh. `moods/space.json` | P1 | S |

## G. Außenmissionen (21, alle P2)
| # | Asset | Stufe | Zustände/Varianten | Anker | Status | Aufw. |
|---|---|---|---|---|---|---|
| G1 | B-7-Plattform-Kit (Boden, Wand, Kante zum All) | 4 | – | eingang, pad | neu | M |
| G2 | Verriegelte Tür B-7 | 4 | zu/offen | eingang | neu | S |
| G3 | Bojenkern 2×2 | 16 | aktiv/offen/entnommen | ziel | neu | M |
| G4 | Sonde Z mit Farbcode | 16 | 6 Farben, an/aus | terminal | neu | S |
| G5 | Wrack-Kit (Boden, Gitter, verbogene Wände) | 4 | intakt/verbogen | eingang, pad | neu | M |
| G6 | Dünne Wand | 4 | normal/markiert/offen | – | neu | S |
| G7 | Bergungscontainer | 16 | zu/offen/geborgen | beute | anp. `rom/kiste.json` | S |
| G8 | Logbuch-Terminal | 16 | aus/gelesen | terminal | neu | S |
| G9 | Trümmer | 16 | `seed` | deckung | neu | S |
| G10 | Gelände Kesh (Mondfels, Sand) | 1 | – | – | neu | M |
| G11 | Ruinenwand Kustoden-Archiv | 4 | intakt/verfallen | deckung_voll | neu | M |
| G12 | Ruinenboden | 4 | – | – | neu | S |
| G13 | Mauerrest (halbe Deckung, helle Oberkante) | 4 | intakt/angeschossen | deckung_halb + Richtung | anp. `rom/barriere.json` | M |
| G14 | Pfeiler (volle Deckung) | 4 | – | deckung_voll | anp. `rom/bau/saeule.json` | S |
| G15 | Störrelais am Boden | 16 | an/aus | terminal | neu | S |
| G16 | Archivschlüssel | 16 | ruht/gedreht/beide | terminal | neu | S |
| G17 | Gewölbetor | 4 | zu/öffnet/offen | eingang | neu | M |
| G18 | Tafel-Sockel mit Tafel von Kesh | 16 | Tafel da/geborgen | ziel | neu | S |
| G19 | Streuprops Kesh (Geröll, Scherben, Glyphenplatten) | 16 | `seed` | – | anp. `natur/stein.json` | S |
| G20 | Stimmung Kesh | Mood | – | – | anp. `moods/planet_dusk.json` | S |
| G21 | Stimmung Wrack (dunkel, Notlicht) | Mood | – | – | anp. `moods/ship_interior.json` | S |

## H. Figuren (16)
| # | Asset | Stufe | Zustände/Varianten | Anker | Status | Prio | Aufw. |
|---|---|---|---|---|---|---|---|
| H1 | Crew Nova/Juno/Tami im Außenteam-Anzug | 16 | Spielerfarbe über `colors` | hand, back | vorh. `figures/crew/*.json` | P2 | S |
| H2 | Crew-Bordkleidung (Tunika-Overall, Schulterplatte, Cingulum) | 16 | Spielerfarbe | hand | neu (auf `fig/basis/*`) | P1 | M |
| H3 | Crew-Köpfe ohne Helm (3 Gesichter, Haare) | 16 | – | – | neu (Basis `fig/basis/kopf.json`) | P1 | M |
| H4 | Schrauber-Bot (Mini-Rig) | 16 | idle/fährt/repariert/löscht/trägt/−50 % | hand, teil | neu | P1 | M |
| H5 | ODA-Avatar (Eulen-Holo) | 16 | ruhig/spricht/Alarm | – | neu | P2 | S |
| H6 | Ivo (Gast) | 16 | verwundet/folgt/geheilt | – | neu | P2 | S |
| H7 | NSC-Porträtköpfe Tesk, Sela, Grauzahn | 16 | – | – | neu | P2 | M |
| H8 | Plünderer (Schütze, Flanker, Funker) | 16 | Schild 0–3, geduckt, Rückzug | hand | neu (Palette `rostmeute`) | P2 | M |
| H9 | Plünderer-Drohne (B-7) | 16 | aktiv/Wrack | – | neu | P2 | S |
| H10 | Wächter „Lamassu“ | 16 | Front an/Treffer/zerstört | – | neu | P2 | L |
| H11 | Legionär | 16 | – | – | vorh. `figures/rom/legionaer.json` | P3 | S |
| H12 | Posen Bord (sitzen, bedienen, E halten, Minispiel, löschen, tragen, Schalter, Lift, Leiter) | – | – | – | anp. `poses/human.json` | P1 | M |
| H13 | Posen Außenteam (ducken, verwundet, wiederbeleben, getroffen) | – | – | – | anp. `poses/human.json` | P2 | M |
| H14 | Laufzyklus 8 Richtungen + Übergänge | – | – | – | anp. | P1 | S |
| H15 | Blaster-Pistole | 16 | – | hand | neu | P2 | S |
| H16 | Werkzeug + Löschgel-Sprüher in der Hand | 16 | – | hand | neu | P1 | S |

## I. Props und Pickups (8)
| # | Asset | Stufe | Zustände/Varianten | Anker | Status | Prio | Aufw. |
|---|---|---|---|---|---|---|---|
| I1 | Ersatzteil | 16 | im Regal/getragen/eingebaut | hand | neu | P1 | S |
| I2 | Löschgel-Dose | 16 | voll/angebrochen | hand | neu | P1 | S |
| I3 | Flickblech | 16 | getragen/verbaut | hand | neu | P1 | S |
| I4 | Bolzen-Magazin | 16 | – | hand | neu | P2 | S |
| I5 | Medipack | 16 | – | hand | neu | P2 | S |
| I6 | Datenkern | 16 | aktiv/entnommen | hand | neu | P2 | S |
| I7 | Tragbare Kiste | 16 | – | hand | vorh. `rom/kiste.json` | P3 | S |
| I8 | Energiezelle | 16 | – | hand | vorh. `rom/energiezelle.json` | P3 | S |

## J. VFX (31, alle neu; Timing-Vorlage sind die 2D-Fassungen in `art.js`)
| # | Asset | Prio | Aufw. |
|---|---|---|---|
| J1 | Feuer (3 Größen) | P1 | M |
| J2 | Rauch | P1 | S |
| J3 | Funken | P1 | S |
| J4 | Leck/Ausgasung | P1 | S |
| J5 | Löschgel-Strahl | P1 | S |
| J6 | Reparaturfunken/Schweißlicht | P1 | S |
| J7 | Rückschlag-Splitter (−50 %) | P2 | S |
| J8 | Lanze: laden 3→12, Strahl, Nachglühen | P1 | M |
| J9 | Batterie-Salve (4 Bolzen, Mündungsblitz) | P1 | M |
| J10 | Bolzenwerfer-Geschoss | P2 | S |
| J11 | Jägerschuss mit Mündung | P1 | S |
| J12 | Ladungsglühen schwerer Angriffe (Fächer bleibt UI) | P1 | M |
| J13 | EMP-Welle | P2 | S |
| J14 | Schildtreffer/Schildbruch je Sektor | P1 | M |
| J15 | Hüllentreffer: Voxel splittern ab | P1 | M |
| J16 | Explosion: Zerfall in Würfel | P1 | M |
| J17 | Triebwerksglühen je Stufe | P1 | S |
| J18 | Ausweichschub, Allstopp-Bremsdüsen | P2 | S |
| J19 | Beamen (Würfelzerfall, streckbar) | P2 | M |
| J20 | Faltsprung (Ein, Tunnel, Aus; streckbar) | P2 | L |
| J21 | Reaktor überladen/offline | P2 | S |
| J22 | Scan- und Weitscan-Ping | P2 | S |
| J23 | Personenschild (Ring, Treffer, Bruch) | P2 | M |
| J24 | Deckungstreffer (Mauer splittert) | P2 | S |
| J25 | Blaster- und Pistolenschuss | P2 | S |
| J26 | Befehls-Lichtsäule (6 Befehle) | P2 | S |
| J27 | Schildkuppel des Captains | P2 | S |
| J28 | Orbitalschlag | P2 | M |
| J29 | Wiederbeleben/Heilen | P2 | S |
| J30 | Wächter-Schildbogen mit Abprall | P2 | S |
| J31 | Eskalation: Boden glimmt vor dem Brand | P2 | S |

## K. UI (22, bleibt 2D-Overlay mit römischem Skin)
| # | Asset | Status | Prio | Aufw. |
|---|---|---|---|---|
| K1 | Konsolenrahmen römisch (Bronze/Marmor, Mäander) | anp. | P1 | M |
| K2 | Steuer-Frontsicht (Temporegler, Drehbalken, AUSWEICHEN) | anp. | P1 | M |
| K3 | Taktikkarte (Feuerbögen, Ladungsfächer, Anfluglinie, Lanzenvisier) | anp. | P1 | M |
| K4 | Captain-Reiter 1–6 | anp. | P1 | L |
| K5 | Schadensplan/Decksplan mit 2 Decks, Lift, Bots | neu | P1 | M |
| K6 | Bord-HUD mit Deckanzeige „DECK I/II“ | anp. | P1 | M |
| K7 | Zustandsmarken als Billboard, Eskalations-Countdown | anp. | P1 | S |
| K8 | Spielermarkierung (Ring, Form, Name) | neu | P1 | S |
| K9 | Randpfeile + Hinweis „anderes Deck“ | neu | P1 | S |
| K10 | Interaktions-Prompt, Fortschrittsbalken, Tragen-Anzeige | anp. | P1 | S |
| K11 | Minispiel mit Rom-Skin | anp. | P2 | S |
| K12 | Transfer-Konsole | anp. | P2 | S |
| K13 | Shop | anp. | P2 | S |
| K14 | Quartier-Editor mit 3D-Vorschau | anp. | P2 | M |
| K15 | Planungstisch + Missionsbuch | anp. | P2 | M |
| K16 | Außenteam-HUD, Fog of War, Geister-Silhouetten | anp. | P2 | M |
| K17 | Außenteam-Karte des Captains | anp. | P2 | M |
| K18 | Icons 12×12 (30 Stück) | vorh. (`art.js` `ICONS`) | P2 | S |
| K19 | Pixelschrift 5×7 | vorh. | P1 | S |
| K20 | Titelschrift Cinzel (SIL OFL 1.1, lokal ausliefern) | neu (extern) | P3 | S |
| K21 | Funk-Porträts, aus Figuren gerendert | neu | P2 | M |
| K22 | Lobby, Raumcode, Ankunft, Ende-Bildschirm | anp. | P2 | M |

Bewusst entfallen aus `art.js`: `drawBurst` (Schildstoß), `drawPhaseBeam`/Phasenkanonen (M1), `sys_weapons`, `drawSystemLegacy`.

## L. Audio (prozedural, römische Klangfarbe; 11 Einträge, nicht in der Gesamtzählung)
- **P1:** Lift (Bronzemechanik, Gegengewicht, Glocke) · Deck-Atmo Systemdeck (Brummen, Lüfter) / Privatdeck (gedämpft, warm, Plätschern) · Batterie-Salve (Ballista-Sehne + Energie-Zisch) · Lanze laden (steigende Quinte) · Alarm als Signalhorn (Cornu/Bucina) statt Sirene · Bronze-Schiebetüren · Schritte Gitter/Mosaik
- **P2:** Reaktor überladen + Hebelschalter
- **P3:** Rom-Motiv (Kithara-Arpeggio + Rahmentrommel, dorisch) · ODA-Signet · Quartier-Ambient

## Zählung (A–K)
| Gruppe | Assets | P1 | P2 | P3 | vorh. | anp. | neu |
|---|---|---|---|---|---|---|---|
| A Außen | 15 | 8 | 6 | 1 | 0 | 7 | 8 |
| B Systemdeck | 35 | 25 | 8 | 2 | 2 | 4 | 29 |
| C Privatdeck | 29 | 7 | 17 | 5 | 0 | 2 | 27 |
| D Lift | 6 | 6 | 0 | 0 | 0 | 0 | 6 |
| E Gegner/Schiffe | 13 | 2 | 10 | 1 | 1 | 5 | 7 |
| F Weltraum | 9 | 2 | 5 | 2 | 1 | 1 | 7 |
| G Außenmissionen | 21 | 0 | 21 | 0 | 0 | 6 | 15 |
| H Figuren | 16 | 6 | 9 | 1 | 2 | 3 | 11 |
| I Props | 8 | 3 | 3 | 2 | 2 | 0 | 6 |
| J VFX | 31 | 14 | 17 | 0 | 0 | 0 | 31 |
| K UI | 22 | 11 | 10 | 1 | 2 | 15 | 5 |
| **Summe** | **205** | **84** | **106** | **15** | **10** | **43** | **152** |

## Palette `lerche_rom` (erweitert `rom_schiff` → `rom`)
| Rolle | Hex | Einsatz |
|---|---|---|
| metal | #4A3C30 | Rumpf, Wände Systemdeck |
| metal_dark | #2E2620 | Fugen, Kiel, Gitter, Schnittkappe |
| metal_light | #8C7A64 | Kantenlicht, Geländer |
| primary | #9E1F27 | Rotfelder, Lack, Banner |
| trim | #D4A23A | Spanten, Aquila, Zierkanten |
| secondary | #E9E3D3 | Marmorplatten, Pilaster |
| stone | #DCD1BA | Stuck Privatdeck |
| paving | #C2B6A0 | Mosaikgrund |
| cloth | #8E1B22 | Polster, Vorhänge |
| cloth2 | #5B2A5E | Kaiserpurpur (Captain, Privatdeck) |
| wood | #6E4228 | Möbel (neu) |
| glow | #9FD8FF | Triebwerk, Systemlicht, Schild |
| glow2 | #FFC46B | Warmlicht Privatdeck |
| warning | #E0473C | Alarm-Notlicht |
| dark | #15181D | Schatten, Displays |
| Feuer (VFX) | #F0602C / #FFD27A | Brände |

Zustandsfarben nur für Zustände: OK #7FE0C2 · BESCH #F2C94C · FLICK #F08A3C · AUS #E0473C · EMP #A9D6E5. Spielerfarben: #56B4E9 · #E69F00 · #CC79A7.
