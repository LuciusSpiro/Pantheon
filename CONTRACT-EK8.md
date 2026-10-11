# CONTRACT-EK8 – Kapitelsteuerung: die feste Kette der Kampagne Eisenwald

Grundlage: `Briefing Eisenwald-Kampagne (EK1-EK9)` (EK8), `Planung Eisenwald-Kampagne (EK1-EK9)` (EK8), `Arbeitspaket Raum-Alarm und K4` (Abschnitt 7),
`Feldzug Eisenwald`, `Funktexte Feldzug Eisenwald` (Entwurf, Kai passt an), `Weltstand`, `Karte Limes` im Vault (`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`).
Team KETTE, Branch `ek3-kette` (Basis `ek1` mit EK1a/b, EK2, EK3a, EK7). Nicht gemergt zur Basis: Konvoi-Szene (Team KONVOI), Flottenbefehle, Legat, Verbündete
(Team FLOTTE), Methalle und Siedlung Eisenwald (Team BODEN). Dafür stehen **Platzhalter** (Abschnitt 4), die diese Teams ersetzen.

## 1. Befund (vor EK8)
| Punkt | Stand |
|---|---|
| Feste Kette ohne Spielleiter | gab es nicht. Regiebücher m1–m3 hängen über `angebot.nach` aneinander (Tutorial), danach plante der Spielleiter |
| Kapitelkarte | Ereignis `chapter` (S2) für das Tutorialende, im Client vorhanden |
| Weltstand | Missionen, Flags, NSC-Gedächtnis, Fakten (`welt.fakten`, Skalare), `schiff.fracht` (EK3a) sind gespeichert; ein Speicherstand entsteht bei jedem Missionsende und beim Andocken |
| Funk | Anzeige nur mit Namen („FUNK · Name“), kein Bild; Mars und Legat fehlten |
| Ende | `endGame` zeigt „Fortsetzung folgt“ mit „Weiter erkunden“ (freies Spiel) |
| Bojenregel (EK7) | Sternkarte erlaubt ein Ziel nur, wenn die Boje der Kante bekannt ist: neue Hexe brauchen den **Weitscan** (Bots konnten das nicht) |
| Störsender-Regel (`sprung.js`, `JAMMERS`) | **jeder** Gegner der Art raider, korvette, fregatte, kreuzer blockiert den Faltsprung, auch ruhende Patrouillen einer Schleichfahrt. Wer Nebelheim unbemerkt durchquert, kann nicht abspringen, bis die Patrouillen tot sind. Vom Studio **nicht** am Raumkampf geändert; Umgehung im Kapitel 3 (siehe 5) |
| Ort-Namen aus Daten | Orte der Sektorkarte (castra_martis …) fehlten in `world.locations`; HUD und Ankunftsbanner zeigten die Kennung |
| Laden | `Weltstand.apply` setzt die Lerche immer in den **letzten Hafen**; Schritte mit `loc` ruhen, bis die Lerche am Ort ist |

## 2. Gebaut
| Teil | Inhalt | Datei |
|---|---|---|
| Kette als Datei | Format `kampagne/1`: Kapitel → Regiebuch(er) → Ausgang → Folge (`weiter` Kapitel/`ende` oder `wiederholen`, optional `wenn`), Kapitelkarte, Labor-`einstieg`, Platzhalterliste, NSC der Kette, `schnittstelle.flags`, `ende` mit Abspann | `content/kampagne/eisenwald.json`, `kampagne.schema.json` |
| Prüfer | Schema, Bücher vorhanden und `kopf.art: kapitel`, jeder Buchausgang hat eine Folge und umgekehrt, Fortschritt nur aus `erfolg`, jeder andere Ausgang wiederholt, Rückfallfolge, Erreichbarkeit, Ende erreichbar, Orte, Kanten, Platzhalter-Abgleich, Flags früherer Kapitel; 13 Selbsttests | `server/mission/kampagne.js` (`pruefen`), `tools/check-kette.js` (`npm run check:kette`, Teil von `npm run check`) |
| Laufzeit | `Kette`: Kapitel starten, Ausgang auswerten, Wiederholen, Ende (`endGame` mit Abspann), Weltstand-Fakten, Fortsetzen nach dem Laden, Labor-Einstieg, NSC einfügen | `server/mission/kampagne.js` |
| Engine-Haken | `kopf.art 'kapitel'` (nicht in der Angebotsreihenfolge, im Missionsbuch hinter dem Tutorial), `startCampaign({ kampagne })`, `tutorialUeberspringen()` (aus dem alten Code gelöst, Verhalten gleich), `completeMission` ruft die Kette, `abbrechen()`, `ketteLaden()` im `restore`, frische Ziele beim Neustart einer Szene, Funkbild im `radio` | `server/sim/mission.js` |
| Spielstart | Lobby-Modi `eisenwald` (mit Tutorial) und `eisenwald_ohne`; **kein Spielleiter**; Debug `kapitel <id>`; `endGame` mit `abspann`, Snapshot `abspann` nur in Phase `end` | `server/game.js`, `shared/protocol.js` |
| Kapitelbücher | `k1_anwerbung` … `k8_sieg` (kopf.art `kapitel`), Schritt-Feld `platzhalter` (Schema und Prüfwarnung `PLATZHALTER`), Funkbild je Stimme (`besetzung.stimmen.<id>.bild`) | `content/regiebuecher/k*.regiebuch.json`, `content/regiebuch/regiebuch.schema.json`, `server/mission/checker.js` |
| Baustein | `fracht_zuteilen { art, n? }` (Belohnung und Ersatz; legt Ladung direkt in den Frachtraum) | `server/mission/bausteine/kette.js`, `bausteine.json` |
| Client | Funkbild (`Art.drawFunkBild`: Mars als Symbol, Legat als Porträt, 24 px), Kapitelkarte „Neues Kapitel“, Abspann (scrollt, Enter = Hauptmenü), Lobby-Texte, Ortsnamen aus der Hex-Karte, Weltstand-Titel der Kapitel | `public/js/{art,hud,client,render}.js` |
| Tests, Bots | `tools/test-kette.js` (115 Prüfungen, in `npm test`), Bot-Modus `kette` in `tools/sim-headless.js` (Labor-Einstieg je Kapitel, ganze Kette; Hex-Weitscan, Fracht beamen und abliefern) | `tools/` |

## 3. Die Kette
```
Statio Limitis (Anwerbung) → Rabenpass (Konvoi, Abgabe) → Nebelheim (Schleichfahrt) → Methalle → Castra Martis (Legat) → Eisenwald Orbit → Siedlung → Sieg → Abspann
```
- **Fortschritt nur durch Ausgänge:** Ein Buch endet mit `complete: <ausgang>`; `erfolg` führt zum nächsten Kapitel, **jeder andere Ausgang** (`rueckzug`) **wiederholt dieselbe Szene**
  (die Szene darf scheitern, der Feldzug nicht). Ein unbekannter Ausgang wiederholt ebenfalls (Fehlerzähler `kette-folge`). Der Prüfer lehnt `weiter` aus einem anderen Ausgang als `erfolg` ab.
- **Kein Spielleiter, keine Schnellroute:** Die Kette setzt Orte nur auf die Sternkarte (`reveal_location`); die Bojen der Wege findet der Spieler per Weitscan (ODA-Hinweis nach 60 s).
- **Kapitelkarte** bei jedem neuen Kapitel (nicht bei Wiederholung), Text in der Kette. Die Karte des Tutorials (m3 `danach`) unterdrückt die Kette.
- **Tutorial-Anschluss:** Nach m3 öffnet die Kette `tutorial-ende` (Splittergürtel – Statio Limitis) und startet Kapitel 1. Mit `eisenwald_ohne` startet Kapitel 1 sofort (Tutorial gilt als übersprungen).
- **Ende:** `k8_sieg` endet mit `erfolg`, die Kette setzt den Fakt `kampagne_ende` und ruft `endGame` mit dem Abspann aus `eisenwald.json`. Der Client zeigt nur den Abspann; Enter sendet
  `menu end` (Lobby). Ein gespeicherter Stand nach dem Sieg zeigt beim Laden wieder den Abspann (kein freies Spiel).

## 4. Kapitel, Platzhalter und Schnittstellen der fehlenden Szenen
Namen der Flags sind **Vertrag**: Die späteren Teams setzen sie unverändert. Flags liegen in `mission.flags` (Weltstand-Block `flags`), Fakten in `welt.fakten`.

| Kap. | Buch | Schritte (* = Platzhalter) | Ausgänge | Setzt | Liest (`erwartet`) |
|---|---|---|---|---|---|
| 1 | `k1_anwerbung` | auftrag › k1_anflug › hafen | erfolg | Fakt `rom_angeworben` | – |
| 2 | `k2_konvoi` | auftrag › k2_anflug › **konvoi*** › rueck_anflug › abgabe | erfolg, rueckzug (wiederholen) | Flag `konvoi_gepluendert`, Fakt `sprengstoff=erbeutet` | – |
| 3 | `k3_nebelheim` | auftrag › k3_anflug › nebelheim (A13) | erfolg, rueckzug | Fakt `nebelheim` | `methalle_gesprengt` |
| 4 | `k4_methalle` | auftrag › k4_anflug › **methalle*** › meldung | erfolg, rueckzug | Flag `methalle_gesprengt`, Sperrriegel offen, Fakten `methalle=zerstoert`, `sprengstoff=verbraucht` | `methalle_gesprengt` |
| 5 | `k5_legat` | auftrag › k5_anflug › hafen | erfolg | Fakt `legat_bekannt`, Legat-Gedächtnis `erster_funkspruch` | – |
| 6 | `k6_orbit` | auftrag › k6_anflug › ankunft › befehl1_durchbrechen › befehl2_entlastung › befehl3_ausschalten (**echt**, VERK-ORBIT) | erfolg, rueckzug | Flags `fregatte_zerstoert`, `legat_gerettet`, genau eine von `legat_befolgt` / `legat_eigenmaechtig` / `legat_im_stich_gelassen`, `fulminata_verloren`, `audax_verloren`; Fakten `orbit_eisenwald`, `schiffe_verloren`; Gedächtnis `orbitschlacht` u. a. | – |
| 7 | `k7_siedlung` | landung › **siedlung*** | erfolg, rueckzug | Flags `flagge_gehisst`, `boss_besiegt`; Fakt `eisenwald=roemisch` | – |
| 8 | `k8_sieg` | sieg (**reagiert** auf Haltung und Verluste) | erfolg → Ende | Fakt `feldzug_eisenwald`; Gedächtnis `sieg` | `legat_befolgt`, `legat_eigenmaechtig`, `legat_im_stich_gelassen`, `audax_verloren`, `fulminata_verloren` |

### Kapitel 2, Platzhalter `konvoi` (Team KONVOI, Konvoi-Szene EK3 Teil B)
- **Platzhalter:** spawnt die Eskorte (1 Jäger, 1 Korvette, Tag `eskorte`); nach ihrem Fall lassen die Transporter (nur als Ansage) zwei Ladungen Sprengstoff zurück (`fracht_abwerfen`),
  danach Beamen (Taktik F) und Abgabe (Taktik G) mit den echten Mechaniken aus EK3a.
- **Die echte Szene ersetzt den Schritt `konvoi`** (Ort `rabenpass`, `restartOnReturn`) und muss: (1) Konvoi mit 1 Jäger, 1 Korvette, **2 Transportern**; (2) jeden zerstörten Transporter mit
  `Fracht.fracht_abwerfen(game, x, y, 'sprengstoff')` eine Ladung hinterlassen lassen; (3) den Schritt per `next` verlassen, sobald `fracht_an_bord { art: sprengstoff, min: 2 }` gilt
  (das Kapitelbuch setzt dann `konvoi_gepluendert` und geht zu `rueck_anflug`; **die Szene selbst setzt kein Flag**); (4) bei Notfallsprung `complete: rueckzug` (Prüfung `rueckzug { loc: rabenpass }` bleibt);
  (5) Entkommt der Konvoi (alle springen, nicht beide Ladungen geborgen) und es gibt nichts mehr zu holen, `complete: rueckzug` (die Szene beginnt von vorn).
  Hinweis zur Störsender-Regel: Transporter (`frachter`) zählen nicht zu `JAMMERS`; Eskorte (raider, korvette) blockiert den Sprung, solange sie lebt.

### Kapitel 3, Nebelheim (echte Umsetzung EK2)
- Schritt `nebelheim` nutzt `schleichfahrt_an` (3 Patrouillen, 8 Minen, Zielkreis (2700, 440) r 220 am Sprungpunkt zur Methalle). Ausgänge `erfolg` (Ziel erreicht, egal wie) und `rueckzug`.
- **Umgehung der Störsender-Regel:** Beim Erreichen des Ziels drehen die Gegner der Szene ab (`enemies_retreat`, ODA „die Patrouillen drehen ab“), sonst blockieren sie den Sprung. Gehört dem Raumkampf-Team:
  eine allgemeine Lösung (ruhende Patrouillen zählen nicht als Störsender) ist offen (Abschnitt 8).

### Kapitel 4, Platzhalter `methalle` (Team BODEN, EK5)
- **Platzhalter:** Die Lerche muss **1 Ladung Sprengstoff an Bord** haben und 12 s nahe (300 px) der Station bleiben (`ship_hold_position`); dann wird die Ladung verbraucht (`fracht_abliefern`) und die Flag gesetzt.
- **Die echte Szene ersetzt den Schritt `methalle`** (Landepunkt der Methalle, Boden). **Schnittstelle:** Setzt die Flag **`methalle_gesprengt`** (Sprengstoff platziert **und** das Team wieder an Bord, „nach dem Hochbeamen“),
  verbraucht dabei die Ladung (`fracht_abliefern` o. ä.). Der Schritt `meldung` bleibt: Er zeigt „Meldung von Mars: Außenposten Methalle zerstört“, öffnet den **Sperrriegel** (`sperrriegel_oeffnen`) und beendet das Kapitel.
  **Die Szene ruft `sperrriegel_oeffnen` nicht selbst auf.** Ausgang bei Nottransport (Team gefallen): `complete: rueckzug` (Szene wiederholen, Karte zurücksetzen). Das Briefing der Methalle steht in `buch.briefing`
  („Ihr braucht eine Sprengladung, auf Stationen zu kaufen“): den **Kauf auf Stationen** (EK5 Schritt 4) gibt es noch nicht; bis dahin gibt der Hafen **Ersatz** (siehe 5).

### Kapitel 5, Castra Martis (kein Platzhalter)
- Hafenbriefing im Missionsbuch, Mars als Symbol (Funkbild `mars`), Legat zum ersten Mal mit Porträt (`legat`), Annahme am Captain (wie bei m2 und m3). Legat als **NSC** (`legat`, Kette-Datei) mit Gedächtnis im Weltstand.

### Kapitel 6, Orbitschlacht Eisenwald (echte Umsetzung, VERK-ORBIT, Branch `ek4-verk-orbit`) – Stand: fertig
Der Platzhalter ist ersetzt (kein `platzhalter`-Feld mehr, `npm run check:kette` listet k6 nicht). Schritte unverändert benannt, `umsetzung` der drei Befehle: `flottenbefehl/durchbrechen|entlastung|ausschalten` (die Bots fliegen sie über `flottenBot`).
- **Ankunft** (`ankunft`, Ort `eisenwald`): `flotte_aufstellen` Fulminata und Audax (`besetzung.schiffe`, Korvetten, eigene KI-Rolle begleiter) mit `auftauchen: true` (Sprungblitz, 2,5 s unverwundbar, Funk „Da seid ihr!“ aus `content/flotte/funktexte.json`).
  Ein im Feldzug verlorenes Schiff kommt nicht zurück (`flotte_aufstellen` verweigert); fehlt die Fulminata, spricht der Legat aus der Kapsel. Die Verbündeten folgen der Lerche bei jedem Sprung (auch Notfallsprung am selben Ort).
- **Befehl 1 Durchbrechen:** Wegpunkte `1000,900; 1450,1180` (Radius 230), Frist 200 s, Wellen `raider:3 | raider:2,korvette:1` (Takt 40 s, Überdruck). Fortschritt **nur** durch das Erreichen der Punkte (getestet: Zeit und tote Gegner allein bringen nichts).
- **Befehl 2 Entlastung:** Das bedrängte Schiff **hält Stellung** (`flotte_modus halten`), Wellen `raider:4 | raider:4` greifen die Verbündeten an (`ziel: verbuendet`), 3 Abschüsse nahe am Schiff (Radius 420), Frist 240 s. Fulminata lebt: Entlastung der Fulminata; sonst der Audax; sind beide verloren: `ausschalten raider` (n 3), damit die Szene lösbar bleibt.
- **Befehl 3 Ausschalten:** Boss-Fregatte (Tag `fregatte`, Breitseiten-KI) mit Jägerwellen (`raider:2 | raider:2`), Frist 260 s, Verbündete folgen wieder. Beim Abschuss (`befehl_erfuellt ausschalten`) laufen die Schnittstellen-Aktionen unten, `enemies_retreat` und `flotte_beenden`; nach 6 s `complete: erfolg`.
- **Scheitern (Frist, Schiff verloren, Notfallprotokoll) – nie ein Freibrief:** Leiter je Befehl über Flags `k6_b1|b2|b3_r1|r2|r3`: 1. und 2. Scheitern: nach 7 s `flotte_neustart` (Gegner weg, lebende Verbündete repariert, Lerche ≥ 60 % Hülle) und der Schritt beginnt von vorn;
  3. Scheitern: **„Rom übernimmt“** (Mars-Funk): weniger Gegner, **keine Frist, kein Überdruck** – weiter nur durch das erreichte Ziel; scheitert auch das (Notfallprotokoll, Schiff verloren), beginnt die Szene erneut (die Leiter bleibt auf der Rom-Stufe). Die Rom-Stufe bleibt nach einem Rückzug erhalten (die Flags überleben den Neustart des Kapitels).
- **Rückzug** (Notfallsprung aus `eisenwald`): `complete: rueckzug`, Kette wiederholt Kapitel 6; `mission.js` setzt `space.escorts` für Kapitelbücher zurück, die Verbündeten tauchen beim nächsten Eintreffen neu auf, **verlorene bleiben verloren** (Weltstand-Fakt `flotte_<tag>`).
- **Schnittstelle (unverändert, jetzt echt gesetzt)**, beim Abschuss der Fregatte: `fregatte_zerstoert`, `legat_gerettet` (immer `true`); **genau eine** der Flags `legat_befolgt` | `legat_eigenmaechtig` | `legat_im_stich_gelassen` (Vorrang: im Stich gelassen vor eigenmächtig vor befolgt;
  die Engine setzt unterwegs `legat_befolgt` je erfülltem Befehl, `legat_eigenmaechtig` und die interne `legat_im_stich`; die Auflösung nimmt die überholten zurück); `fulminata_verloren`, `audax_verloren` (setzt `escort.syncFlags` beim Verlust, der Abschluss sichert sie);
  Fakt `schiffe_verloren` (Text `audax`, `fulminata` oder `audax,fulminata`, ohne Eintrag = keine Verluste); Gedächtnis des Legaten über `npc_gedaechtnis`: `befehle_befolgt` | `eigenmaechtig` | `im_stich_gelassen`, `audax_verloren`, `fulminata_verloren`, zusätzlich die Einträge der Engine (`befehl_befolgt`, `schiff_verloren`, `eigenmaechtig`, `im_stich`) und `orbitschlacht`. Status des Legaten bleibt `lebt`.
- Hilferuf (40 % / 15 %), Verlustsprüche (Fulminata: Legat mit Porträt, Audax: Optio Livia Rufa), Rettungskapsel, Banner „VERLOREN“ kommen aus der Flotte (EK4), Texte aus den Funktexten.
- **flightV2:** `Mission.flightV2()` gilt jetzt auch für `kopf.art: kapitel` (Gegner-KI mit Breitseiten für Korvette und Fregatte in allen Kapitelbüchern); das Tutorial (m1–m3, art `mission`) bleibt auf der alten KI.

### Kapitel 7, Platzhalter `siedlung` (Team BODEN, EK6)
- **Platzhalter:** Hissen = 12 s nahe der Station bleiben, danach Angriff (Korvette als Anführer, 2 Jäger), Anführer besiegt = Sieg, die übrigen Gegner fliehen (`enemies_retreat`).
- **Die echte Szene ersetzt den Schritt `siedlung`** (Landepunkt Eisenwald, Flagge auf dem Dorfplatz, 10 Gegner und Boss). **Schnittstelle:** **`flagge_gehisst`** setzen, sobald zwei Personen fertig gehisst haben (Angriff beginnt);
  **`boss_besiegt`** setzen, wenn der Anführer gefallen ist (die übrigen Gegner beamen raus) und das Team **wieder an Bord** ist. Das Kapitel endet, sobald beide Flags gelten (`complete: erfolg`).
  Fällt die Crew: Nottransport, Siedlung zurücksetzen, `complete: rueckzug` (Szene beginnt von vorn).

### Kapitel 8, Sieg
- Der Legat spricht je nach Gedächtnis-Flag (`legat_befolgt`, `legat_eigenmaechtig`, `legat_im_stich_gelassen`; bei im Stich gelassen mit der Audax oder, sonst, der Fulminata im Text), nennt verlorene Schiffe (`fulminata_verloren`, `audax_verloren`; Texte Entwurf, Kai passt an), dann Mars; nach 30 s endet das Buch mit `erfolg`, die Kette zeigt den Abspann.
- **Abspann aus Daten:** Blöcke und Zeilen in `eisenwald.json` dürfen `wenn` tragen (Bedingung wie im Regiebuch, Flags der Orbitschlacht); der Block „ROM“ zeigt Fulminata/Audax heimgekehrt oder verloren und die Haltung des Legaten. `Kette.abspannBloecke()` wertet beim Ende (auch nach dem Laden) aus; Schema: Zeilen als Text oder `{ text, wenn }`.

## 5. Weltstand (kein neues Schema)
- **Fakten** (`welt.fakten`, Quelle `kette`): `kampagne` (`eisenwald`), `kapitel` (Kapitel-ID), `kapitel_nr`, `kapitel_buch`, `kampagne_ende` (true nach dem Sieg). Aus den Büchern: `rom_angeworben`, `sprengstoff`
  (`erbeutet` → `verbraucht`), `nebelheim`, `methalle`, `legat_bekannt`, `orbit_eisenwald`, `eisenwald`, `feldzug_eisenwald`; `sperrriegel` (EK7). Für FLOTTE vorgesehen: `schiffe_verloren` (Text).
- **Fracht:** `schiff.fracht` (EK3a). Sprengstoff ist die Fracht-Art `sprengstoff`. Kapitel 2 lässt dem Spieler nach der Abgabe **1 Ladung** (`fracht_zuteilen`), Kapitel 4 verbraucht sie.
  **Ersatz:** Dockt die Lerche ohne Sprengstoff in der Statio Limitis oder Castra Martis (Kapitel 3 und 4, Methalle noch nicht gesprengt), legt ein Missionshandler eine Ersatzladung in den Frachtraum
  (Stand-in für den Kauf auf Stationen, EK5).
- **Flags** (`flags`): siehe 4. **Legat:** NSC `legat` aus der Kette-Datei (`npc`), beim Start der Kette (und beim Laden älterer Stände) in `weltstand.npc` eingefügt, damit `npc_gedaechtnis`, `npc_haltung`, `npc_status` greifen.
- **Jedes Kapitel wird gespeichert:** Der Speicherstand entsteht am Tick-Ende nach `missionDone`; die Kette startet das nächste Kapitel im selben Tick, der Stand enthält also schon dessen ersten Schritt.
  Laden: `ketteLaden()` hängt die Kette an (Fakt `kampagne`), die aktive Mission setzt die Engine fort, ohne aktive Mission wertet die Kette den Ausgang des gespeicherten Buchs aus bzw. startet das Kapitel neu.

## 6. Entscheidungen (Begründung)
| # | Entscheidung | Grund |
|---|---|---|
| D1 | Die Kette ist eine **eigene Datei** mit eigenem Schema und Prüfer, die Kapitel sind Regiebücher mit `kopf.art: kapitel` | Briefing „Kette als Datei“; Bücher bleiben die Einheit, die Engine, Prüfer, Weltstand und Missionsbuch schon kennen. Kein zweiter Ablaufbegriff |
| D2 | Zustand der Kette in **Weltstand-Fakten** (+ Flags und Buchstatus), kein neues Schemafeld, keine Versionsnummer | Vorgabe; additiv, alte Stände laden unverändert |
| D3 | Fortschritt nur aus `erfolg`, jeder andere Ausgang wiederholt (Prüfer erzwingt es) | Leitplanke „Feldzug scheitert nie, jede Szene hat einen Ausgang“ |
| D4 | Kein Spielleiter in den Kettenmodi (`createSpielleiter` entfällt) | Briefing; S3 ist nicht Teil; die Kette ändert den Spielleiter-Modus nicht |
| D5 | Zwei Lobby-Modi: `eisenwald` (mit Tutorial) und `eisenwald_ohne` (Test/Wiederspielen) | Briefing „Modus nach Tutorial“; der Bot-Durchlauf und Tester brauchen den Einstieg ohne 25 Minuten Tutorial |
| D6 | Platzhalter sind **echte, spielbare Stand-ins** auf dem Raumkampf (Eskorte und Fracht, Position halten, Wellen), im Text als „Platzhalter“ erkennbar, im Buch als `platzhalter` markiert (Prüfwarnung) und in der Kette gelistet | Briefing; so läuft die Kette durchgehend und die Bots können sie spielen |
| D7 | Flag-Namen als Vertrag (4); die Szene setzt nur ihr Ergebnis, **die Folgen** (Sperrriegel öffnen, Meldung, Sprengstoff-Fakt, Kapitelwechsel) **liegen im Kapitelbuch** | Die späteren Teams brauchen keine Kenntnis der Kette; nur eine Flag je Ergebnis |
| D8 | Labor-Einstieg je Kapitel in der Kette-Datei (`einstieg`: Ort, Flags, Fakten, Fracht, Schlüssel) und im Debug-Befehl `kapitel <id>` | Briefing „Labor-Einstiege je Kapitel“; der Zustand davor ist Daten, nicht Code |
| D9 | Funkbild als Stimmenfeld (`besetzung.stimmen.<id>.bild`: `mars`, `legat`), im Funk als Ereignisfeld `bild` und Snapshot `mission.radio.bild` | kleinste Erweiterung; ohne Feld bleibt alles wie vorher |
| D10 | **Abspann** als Snapshot-Feld in Phase `end` (Titel, Text, Blöcke aus der Kette-Datei), Client scrollt, Enter = `menu end` | „Kein freies Spiel“; Daten statt Code; Text von Kai änderbar |
| D11 | Der Name im Funk lautet „Mars“ (kein Sonderzeichen ⚔), das Symbol zeigt das Funkbild | die Pixelschrift hat das Zeichen nicht |
| D12 | `Frachtraum` statt „Lagerraum“ in den Texten (EK3a-Entscheidung D1) | Verwechslung mit dem Regal-Lager vermeiden |
| D13 | Ersatz einer verlorenen Sprengladung im Hafen **kostenlos** bis zum Kauf auf Stationen (EK5) | sonst Softlock; „der Feldzug scheitert nie“ |
| D14 | Patrouillen drehen bei Erreichen des Ziels in Nebelheim ab (`enemies_retreat`) | Störsender-Regel blockiert sonst den Sprung nach der Schleichfahrt (Befund) |
| D15 | Platzhalter-Gegner sind weniger als im Briefing (ohne Verbündete): Orbit 2 / 2 / Fregatte + 1 Jäger, Siedlung Anführer + 2 Jäger | Bots (und Menschen) haben ohne Flottenhilfe sonst Mühe; Balance ist EK9 |
| D16 | `tools/sim-headless.js`: nur abgegrenzte Blöcke (Handler `kette/*`, `travel()` mit Weitscan-Suche in `GenericAgent`, Modus `kette`) | Konfliktpunkt; die Bojen-Suche gilt nur, wenn die Boje unbekannt ist (Tutorial, Labor, Golden unverändert) |

| D17 | (VERK-ORBIT) Scheitern der Orbitschlacht: zweimal von vorn, dann „Rom übernimmt“ als **Erleichterung** (weniger Gegner, keine Frist, kein Überdruck), nie als Freibrief; Zähler in Flags, die Schleife im Buch (`goto` auf den eigenen Schritt) | Leitplanke „Fortschritt nur durch erreichte Ziele“ gegen „der Feldzug scheitert nie“; der Katalog-Ausgang „Rom übernimmt = aufgegeben, weiter“ wäre ein Freibrief |
| D18 | Der bedrängte Verbündete hält Stellung (`flotte_modus halten`) in Befehl 2 | Mit der KI (begleiter) flog die Fulminata den Gegnern entgegen und die Abschüsse geschahen fern vom Befehlsradius; Entlastung hieße sonst nie erfüllt (Bots: 3 von 3 Zeitüberschreitungen) |
| D19 | Entlastung wechselt bei Verlust des Schiffs auf die Audax, dann auf „Jäger ausschalten“ | ein toter Schützling würde den Befehl endlos scheitern lassen (Softlock) |
| D20 | Flag-Auflösung am Ende (Vorrang im Stich gelassen > eigenmächtig > befolgt) im Buch, nicht in der Engine | Vertrag „genau eine Flag“; die Engine zählt weiter pro Ereignis (Gedächtnis), Flags bleiben Daten |
| D21 | Neuer Baustein `flotte_beenden` (Wellen, Nachschub, Befehl, Abdreh-Regel abräumen); Verbündete bleiben | ohne ihn läuft die letzte Welle und das `enemies_retreat` ins Kapitel 7 am selben Ort (Befund: Bot blieb im Siedlungs-Platzhalter hängen) |
| D22 | `flightV2` und Reset von `space.escorts` für alle `kopf.art: kapitel` | Hinweis EK4; Tutorial (art `mission`) bleibt unberührt, Golden nicht betroffen |
| D23 | Abspann mit `wenn`-Bedingungen (Daten), keine Sonderlogik im Code | „Texte als Daten“, Kai kann sie ändern |

## 7. Bedienung und Werkzeuge
- Spielen: Lobby, Taste M, „Kampagne Eisenwald“ (Weltstand wie jede Kampagne, Fortsetzen mit F). Debug (`npm run debug`): `kapitel <id>` (`k1_anwerbung` … `k8_sieg`), der Zustand davor wird hergestellt.
- `npm run check:kette` (Kette + 8 Bücher, `--selftest`), `npm run test:kette`, `node tools/sim-headless.js kette [--kapitel alle|<id>] [--crew 1|3] [--seeds N] [--seed S] [--von <kapitel>] [--tutorial]`.
- Testserver: Port 3396 (3395 war belegt), `WORLD_DIR=data/worlds-kette`.

## 8. Abnahme (Stand dieses Commits)
Siehe Abschnitt 9 (Messwerte). **Offen:**
- **Störsender-Regel** (`sprung.js`): ruhende Patrouillen dürfen den Sprung nicht blockieren. Die Kette umgeht es nur im Kapitel 3; für Szenen anderer Teams (Konvoi: Eskorte tot, Jäger-Einsprung) gilt die Regel unverändert.
- Die vier Platzhalter-Gruppen (Abschnitt 4) sind die Aufgabe der Teams KONVOI, FLOTTE, BODEN; nach dem Merge Schritte ersetzen, `platzhalter`-Felder und die Kette-Liste (`platzhalter`) streichen, `npm run check:kette` listet den Rest.
- **Kauf von Sprengstoff auf Stationen** (EK5), solange gilt der kostenlose Ersatz im Hafen.
- Texte (Kapitelkarten, Abspann, Hinweise, Funk) sind Entwurf; Kai passt sie in `content/kampagne/eisenwald.json` und den Büchern an.
- **Lesbarkeit** von Funkbild, Kapitelkarte und Abspann: nur per Screenshot (Playwright, 2D) geprüft, nicht mit Menschen (EK9). Voxel-Ansicht nicht geprüft (die Teile liegen in der 2D-HUD-Schicht und gelten für beide).
- Dauer: Die Bot-Durchläufe zeigen Spielzeiten von **ca. 32 bis 80 Minuten** (ohne Tutorial), vor allem Flüge zwischen den Hexen und die Platzhalter-Kämpfe; Menschen zu zweit/dritt: EK9.
- Mehrspieler: Der Abspann-Knopf beendet die Partie für **alle** (wie „Partie beenden“); ein Spieler kann also den Abspann der anderen abbrechen.

## 8b. Stand VERK-ORBIT (Kapitel 6, 5, 8)
- Offen: Balance (Bots zu zweit und allein finden die Szene leicht, die Fregatte fällt in rund 85–120 s solo bzw. 190–290 s zu dritt (mit einem Scheitern davor) s; Verbündete verloren in keinem Bot-Lauf – die Verlustpfade sind nur im Test belegt), EK9; Voxel-Ansicht kennt die Flottenanzeige nicht (EK4 Abschnitt 6); Texte (Entwurf): Klagen in Kapitel 8, Abspannzeilen; Lesbarkeit der Zeilen BEFEHL/VERBÜNDET mit Menschen.
- Kapitel 5 blieb unverändert (Legat und Mars waren schon echt, Funktext wie im Vault); die Verbündeten erscheinen erst in Kapitel 6.

## 9. Messwerte (2026-10-11)
- `npm test` grün (inkl. `tools/test-kette.js` 115/115), `npm run check` grün (Kette + 8 Bücher, 13/13 Selbsttests), `npm run snap:mess` grün: Worst Case **11 444 B**, Wellen 10 558 B, Raum-Alarm 11 384 B (Ziel ≤ 18 944 B); Abspann 762 B (nur Phase `end`); Bot-Läufe der Kette Snapshot-Maximum 12 414 B.
- **Golden m1–m3** (20 Seeds, `--all --jobs 4`) gegen `base-w2` mit `allow-ek1.json`: **GOLDEN GRÜN**, 80/120 Traces byte-identisch (die übrigen 40 sind die bekannten EK1a-Abweichungen m1/m2 solo). Ordner gelöscht.
- **Bots, ganze Kette** (`sim-headless kette`, ohne Tutorial, 4 Seeds × Crew 1 und 3): **8/8 bis zum Abspann**, 0 Fehler, keine Skips, Spielzeit **28–41 min** (Median ~31).
- **Bots, Labor-Einstieg je Kapitel** (8 Kapitel × 3 Seeds × Crew 1 und 3): **48/48 ok**, 0 Fehler, keine Skips.
- Ein erster Lauf mit stärkeren Platzhalter-Gegnern (Orbit 2/3/Fregatte+2, Siedlung +3) brauchte bei Crew 3 teils 25–60 min je Orbitschritt (Bots, Zeitlimit-Skips) – danach reduziert (D15).
- **Browser** (Playwright, Chromium, 2D, Port 3396): Lobby-Modi, Kapitelkarte „Neues Kapitel“, Funk mit Mars-Symbol und Legat-Porträt, Abspann (Anfang, Lauf, Ende) per Screenshot geprüft (`shots/kette/*.png`, lokal), keine Konsolenfehler. Nicht mit Menschen, Voxel nicht geprüft.

### Messwerte VERK-ORBIT (2026-10-11, Kapitel 6 echt)
- `npm test` grün (neu `tools/test-orbit.js` 69 Prüfungen, `test-kette` 115, Platzhalter jetzt 3), `npm run check` grün (Kette: 0 Fehler, 0 Warnungen, nur noch konvoi, methalle, siedlung als Platzhalter), `npm run snap:mess` grün: neuer Aufbau „orbit“ **max 13 842 B, p95 12 826 B** (Ziel ≤ 18 944 B), übrige Aufbauten unverändert (Worst 11 444, Flotte 11 851).
- **Bots, ganze Kette** (ab Lichtkordon bis zum Abspann, 4 Seeds × Crew 1 und 3): **8/8 ok**, 0 Fehler, keine Skips, Spielzeit 28–42 min (Kapitel 6: 7,6–16,8 min inkl. ca. 3,7 min Anflug).
- **Bots, Labor-Einstieg** (4 Seeds × Crew 1 und 3): k5 8/8 (4,3–4,7 min), k6 8/8 (solo 7,9–8,6 min, zu dritt 9,0–11,2 min), k8 8/8 (0,5 min), 0 Fehler, keine Skips.
- **Ehrlich:** Die Bots finden die Szene leicht. Solo kein Scheitern in 12 Läufen; zu dritt scheitert Befehl 3 beim ersten Anlauf (Notfallprotokoll, danach von vorn, dann erfüllt). Die Fregatte fällt in 85–120 s (solo) bzw. 190–290 s. Kein Bot-Lauf verlor ein Verbündetes Schiff – Verlust, Ersatzbefehl, Rom-Stufe und Flags sind nur im Test (`test-orbit`) belegt. Balance gehört zu EK9.
- Ein erster Bot-Lauf zeigte, dass ohne `flotte_beenden` das `enemies_retreat` in Kapitel 7 am selben Ort weiterwirkt (Siedlungs-Platzhalter 1500 s Zeitlimit); behoben (D21).
- Golden m1–m3 nicht gelaufen: Tutorial- und Raumpfade nicht berührt (`flightV2` und Escort-Reset nur für `kopf.art: kapitel`).
