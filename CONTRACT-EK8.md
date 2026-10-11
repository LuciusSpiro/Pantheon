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
| 2 | `k2_konvoi` | auftrag › k2_anflug › konvoi (echt, 4a) › rueck_anflug › abgabe | erfolg, rueckzug (wiederholen) | Flag `konvoi_gepluendert`, Fakt `sprengstoff=erbeutet` | – |
| 3 | `k3_nebelheim` | auftrag › k3_anflug › nebelheim (A13) | erfolg, rueckzug | Fakt `nebelheim` | `methalle_gesprengt` |
| 4 | `k4_methalle` | auftrag › k4_anflug › methalle (echt, 4a) › meldung | erfolg, rueckzug | Flag `methalle_gesprengt`, Sperrriegel offen, Fakten `methalle=zerstoert`, `sprengstoff=verbraucht` | `methalle_gesprengt` |
| 5 | `k5_legat` | auftrag › k5_anflug › hafen | erfolg | Fakt `legat_bekannt`, Legat-Gedächtnis `erster_funkspruch` | – |
| 6 | `k6_orbit` | auftrag › k6_anflug › ankunft › **befehl1_durchbrechen*** › **befehl2_entlastung*** › **befehl3_ausschalten*** | erfolg, rueckzug | Flags `fregatte_zerstoert`, `legat_gerettet`, `legat_befolgt`; Fakt `orbit_eisenwald`; Gedächtnis `orbitschlacht` | – |
| 7 | `k7_siedlung` | landung › siedlung › siedlung_kampf (echt, 4a) | erfolg, rueckzug | Flags `flagge_gehisst`, `boss_besiegt`; Fakt `eisenwald=roemisch` | – |
| 8 | `k8_sieg` | sieg | erfolg → Ende | Fakt `feldzug_eisenwald`; Gedächtnis `sieg` | `legat_befolgt`, `legat_eigenmaechtig`, `legat_im_stich_gelassen`, `audax_verloren`, `fulminata_verloren` |

### Kapitel 2, Platzhalter `konvoi` (Team KONVOI, Konvoi-Szene EK3 Teil B)
**Stand: ersetzt durch die echte Szene (VERK-BODEN, Abschnitt 4a). Der folgende Text ist die ursprüngliche Schnittstelle.**
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
**Stand: ersetzt durch die echte Szene (VERK-BODEN, Abschnitt 4a). Der folgende Text ist die ursprüngliche Schnittstelle.**
- **Platzhalter:** Die Lerche muss **1 Ladung Sprengstoff an Bord** haben und 12 s nahe (300 px) der Station bleiben (`ship_hold_position`); dann wird die Ladung verbraucht (`fracht_abliefern`) und die Flag gesetzt.
- **Die echte Szene ersetzt den Schritt `methalle`** (Landepunkt der Methalle, Boden). **Schnittstelle:** Setzt die Flag **`methalle_gesprengt`** (Sprengstoff platziert **und** das Team wieder an Bord, „nach dem Hochbeamen“),
  verbraucht dabei die Ladung (`fracht_abliefern` o. ä.). Der Schritt `meldung` bleibt: Er zeigt „Meldung von Mars: Außenposten Methalle zerstört“, öffnet den **Sperrriegel** (`sperrriegel_oeffnen`) und beendet das Kapitel.
  **Die Szene ruft `sperrriegel_oeffnen` nicht selbst auf.** Ausgang bei Nottransport (Team gefallen): `complete: rueckzug` (Szene wiederholen, Karte zurücksetzen). Das Briefing der Methalle steht in `buch.briefing`
  („Ihr braucht eine Sprengladung, auf Stationen zu kaufen“): den **Kauf auf Stationen** (EK5 Schritt 4) gibt es noch nicht; bis dahin gibt der Hafen **Ersatz** (siehe 5).

### Kapitel 5, Castra Martis (kein Platzhalter)
- Hafenbriefing im Missionsbuch, Mars als Symbol (Funkbild `mars`), Legat zum ersten Mal mit Porträt (`legat`), Annahme am Captain (wie bei m2 und m3). Legat als **NSC** (`legat`, Kette-Datei) mit Gedächtnis im Weltstand.

### Kapitel 6, Platzhalter `befehl1_durchbrechen`, `befehl2_entlastung`, `befehl3_ausschalten` (Team FLOTTE, EK4)
- **Platzhalter** (ohne Verbündete, daher weniger Gegner): Befehl 1: 1 Jäger, 1 Korvette; Befehl 2: 2 Jäger; Befehl 3: 1 Fregatte (Boss) mit 1 Jäger. Der Legat funkt die Befehle (Funktexte Kapitel 6), jeder Teil endet, wenn die Gegner
  tot sind bzw. die Fregatte zerstört ist. Er setzt `legat_befolgt`, damit Kapitel 8 etwas zu sagen hat.
- **Die echte Szene ersetzt die drei Schritte** (Ort `eisenwald`, `restartOnReturn`) und die Schritt `ankunft` (Verbündete erscheinen). **Schnittstelle:** Am Ende (Fregatte zerstört) die Flag **`fregatte_zerstoert`** setzen;
  `legat_gerettet` (Legat lebt, auch wenn die Fulminata fällt, Rettungskapsel; immer `true`) ; je nach Verlauf **genau eine** der Flags `legat_befolgt`, `legat_eigenmaechtig`, `legat_im_stich_gelassen`;
  `fulminata_verloren` und `audax_verloren`, wenn die Schiffe zerstört wurden; Weltstand: Fakt `schiffe_verloren` (Text, z. B. `audax,fulminata`, ohne Eintrag = keine Verluste), Legat-Gedächtnis
  über `npc_gedaechtnis { npc: legat, ereignis: befehle_befolgt | eigenmaechtig | im_stich_gelassen | audax_verloren | fulminata_verloren }`, Status des Legaten bei Verlust der Fulminata bleibt `lebt`.
  Das Kapitel endet mit `complete: erfolg`, sobald `fregatte_zerstoert` gilt (die echte Szene sagt es per `next`); bei Notfallsprung `complete: rueckzug` (Szene von vorn, Verbündete erscheinen neu).
  Hilferufe und Verlustsprüche (Funktexte): Sprecher `fulminata` (Legat, Porträt) und `audax` (Optio Livia Rufa, ohne Bild), Flags/Prüfungen je Schiff nur einmal.

### Kapitel 7, Platzhalter `siedlung` (Team BODEN, EK6)
**Stand: ersetzt durch die echte Szene (VERK-BODEN, Abschnitt 4a). Der folgende Text ist die ursprüngliche Schnittstelle.**
- **Platzhalter:** Hissen = 12 s nahe der Station bleiben, danach Angriff (Korvette als Anführer, 2 Jäger), Anführer besiegt = Sieg, die übrigen Gegner fliehen (`enemies_retreat`).
- **Die echte Szene ersetzt den Schritt `siedlung`** (Landepunkt Eisenwald, Flagge auf dem Dorfplatz, 10 Gegner und Boss). **Schnittstelle:** **`flagge_gehisst`** setzen, sobald zwei Personen fertig gehisst haben (Angriff beginnt);
  **`boss_besiegt`** setzen, wenn der Anführer gefallen ist (die übrigen Gegner beamen raus) und das Team **wieder an Bord** ist. Das Kapitel endet, sobald beide Flags gelten (`complete: erfolg`).
  Fällt die Crew: Nottransport, Siedlung zurücksetzen, `complete: rueckzug` (Szene beginnt von vorn).

### Kapitel 8, Sieg
- Der Legat spricht je nach Gedächtnis-Flag (`legat_befolgt`, `legat_eigenmaechtig`, `legat_im_stich_gelassen`), dann Mars; nach 30 s endet das Buch mit `erfolg`, die Kette zeigt den Abspann.

## 4a. Verdrahtung Boden: Kapitel 2, 4 und 7 mit den echten Szenen (Team VERK-BODEN, Branch `ek4-verk-boden`)
Die Platzhalter der Kapitel 2, 4 und 7 sind ersetzt (`platzhalter`-Felder in Büchern und Kette weg, `npm run check:kette` listet nur noch die drei Schritte von Kapitel 6, Team VERK-ORBIT).
Die Flag-Namen des Vertrags bleiben, die Folgen (Sperrriegel, Meldung, Fakten, Kapitelwechsel) liegen weiter im Kapitelbuch (D7).

| Kap. | Schritte | Echte Szene (Molekül / Umsetzung) | Setzt | Ausgänge |
|---|---|---|---|---|
| 2 | auftrag › k2_anflug › **konvoi** › rueck_anflug › abgabe | `konvoi_abfangen/pluendern` (Bausteine `konvoi_an`, `konvoi_erfolg`), Rabenpass, 2 Transporter, Eskorte | Flag `konvoi_gepluendert` (im `next` des Kapitelbuchs, nicht in der Szene) | `erfolg` nach der Abgabe, `rueckzug` bei Notfallsprung |
| 4 | auftrag › k4_anflug › **methalle** › meldung | `sabotieren/sprengstoff_platzieren`, Landepunkt `methalle.siedlung` | Flag `methalle_gesprengt` (Sprengstoff liegt **und** alle an Bord); Sperrriegel und Fakten bleiben im Schritt `meldung` und im Ausgang | `erfolg`, `rueckzug` bei Notrückholung oder Notfallsprung |
| 7 | landung › **siedlung** › **siedlung_kampf** | `stellung_nehmen/flagge_hissen`, Landepunkt `eisenwald.siedlung` | Flags `flagge_gehisst` (Feldzeichen oben, Angriff beginnt) und `boss_besiegt` (Anführer gefallen **und** Team an Bord) | `erfolg` mit beiden Flags, `rueckzug` bei Notrückholung oder Notfallsprung |

**Kapitel 2 (Konvoi).** `konvoi_an { n 2, eskorte voll, sieg pluendern, ladung sprengstoff, beute_min 2, wiederholung an }` im `enter`; Fortschritt, sobald `konvoi_erfolg` gilt (Ausgang `gepluendert`:
beide Ladungen an Bord, mindestens eine davon in dieser Szene geholt). Das ist enger als die Platzhalter-Prüfung `fracht_an_bord min 2` des Vertrags und deckt sie ab. Entkommt der Konvoi, rollt nach 8 s ein neuer an,
schon geborgene Fracht bleibt (CONTRACT-EK3B D9): die Szene kann nicht scheitern, nur dauern. Die Funktexte (Kontakt, „Fracht in Reichweite“, Springen) kommen aus dem Modul. Nach dem Erfolg drehen die Eskorte-Schiffe ab
(`enemies_retreat`, ODA „Zurück zur Statio, bevor die Eskorte Verstärkung ruft“): die Störsender-Regel (`JAMMERS`) würde sonst den Faltsprung zur Statio Limitis blockieren, solange ein Jäger oder die Korvette lebt
(wer plündert, ohne die Eskorte zu töten, säße fest). Abgabe in der Statio Limitis und die Ladung für die Methalle (`fracht_zuteilen 1`) sind unverändert.

**Kapitel 4 (Methalle).** Landepunkt `methalle.siedlung` (Kopie von `splitter.methalle`, `frei: immer`, `beam` = Station des Orts (1349, 928), Reichweite 360; `szene.beam.map` am Hex 0705 in `limes.json`).
Der Schritt `methalle` ist die Vorlage von `sprengstoff_platzieren` mit Kapitelbuch-Eigenheiten:
- **Sprengstoff:** Beim Eintritt wird eine Ladung `sprengstoff` aus dem **Frachtraum ins Gepäck** (Inventar `ladung`, das Feld, das der Sprengpunkt liest) umgeladen (`fracht_abliefern` + `ladung_geben`). Wer im Hafen **gekauft** hat
  (Shop `ladung`, 150 Marken, EK5), hat sie schon im Gepäck: kein Umladen, die Szene nimmt sie. Fehlt beides (Notrückholung hat die Ladung verbraucht, Labor-Einstieg ohne Fracht), legt die Szene eine **kostenlose** Ladung
  ins Gepäck (Softlock-Schutz, wie der Hafen-Ersatz, D13).
- **Flag `methalle_gesprengt`:** sobald der Sprengpunkt `platziert` ist **und** niemand mehr unten ist (nach dem Hochbeamen). Die zweite Welle (Nachschub an den Baracken) kommt mit der Ansage „Sprengstoff liegt“.
- **Nottransport:** Die Notrückholung (`squadRecall`) setzt die Karte zurück (`map_reset`) und beendet das Kapitel mit `rueckzug`; die Kette wiederholt es (Kapitel 4 von vorn, kein Fortschritt, kein Kartenwechsel dazwischen).
- **Ersatz im Hafen** (k3 und k4, Statio Limitis und Castra Martis): jetzt auch nur, wenn **kein** Sprengstoff im Gepäck liegt (sonst doppelt, nach dem Umladen).
- Briefing und Auftrag nennen jetzt beide Wege: Beute im Frachtraum oder gekaufte Ladung aus dem Hafen.

**Kapitel 7 (Siedlung).** Landepunkt `eisenwald.siedlung` (Kopie von `splitter.eisenwald`, Station des Orts (1756, 1087)). Zwei Schritte wie in der Vorlage (Engine: Regeln feuern je Schritt nur einmal):
`siedlung` (Hissen; Ausgang `anker_state flagge gehisst` setzt `flagge_gehisst` und geht in `siedlung_kampf`) und `siedlung_kampf` (10 Gegner und Anführer, Sieg, `gegner_abziehen`, dann `boss_besiegt` erst wenn alle an Bord sind;
Kapitel endet, wenn beide Flags gelten). Fällt die Crew (`crew_gefallen`): beide Flags werden gelöscht, `map_reset` (Feldzeichen unten, kein Angriff), Ausgang `rueckzug`, die Kette wiederholt Kapitel 7.
- **Solo (Entscheidung):** Das Hissen braucht zwei lebende Spieler (EK6) und ist allein unmöglich. Die Kette darf nicht blockieren, also gilt bei **höchstens einem verbundenen Spieler** (`crew_max 1`): Zehn Sekunden nach dem
  Runterbeamen hisst ein Legionär mit (Funk des Legaten, das Feldzeichen geht von selbst nach oben), und der Angriff ist kleiner (**5 Gegner plus Anführer** statt 10 plus Anführer). Mehrspieler bleibt der Maßstab und
  unverändert (zwei halten gemeinsam, 10 + 1). Verworfen: (a) „Wiederholung mit Hinweis“ blockiert solo für immer; (b) `CONFIG.anker.flagge.min` auf 1 senken: die Config ist global (Labor, Tests, Mehrspieler), und
  zwei Halter sind der Kern der Szene; (c) Kapitel überspringen: würde die Kette entwerten.
- Mit zwei Spielern, von denen einer fällt, gilt weiter die EK6-Regel (Hissen erst, wenn der zweite wieder steht). Das ist gewollt (Briefing: „Zwei Spieler sind hart“).

### Entscheidungen
| # | Entscheidung | Grund |
|---|---|---|
| D17 | Szenen als Schritte im Kapitelbuch (Kopie der Molekül-Vorlagen mit festen Parametern), `umsetzung` trägt den Molekülnamen | die Kette ist Datei und Buch (D1); Bots, Prüfer und Missionsbuch kennen die Umsetzung; kein Szenenbau-Aufruf zur Laufzeit |
| D18 | Konvoi-Fortschritt über `konvoi_erfolg`, Eskorte dreht nach dem Erfolg ab | siehe oben (Störsender-Regel, „bei Beute ohne Eskorte-Kill“) |
| D19 | Solo-Konvoi: nur der Jäger als Eskorte (`crew_max 1`) | der Solo-Bot schaffte die volle Eskorte 0 von 4 (CONTRACT-EK3B §6), mit Jäger allein 14 von 14 im Labor-Einstieg; Mehrspieler unverändert voll |
| D20 | Sprengstoff-Ersatz bleibt kostenlos, Kauf (150 Marken) und Beute führen in dasselbe Gepäckfeld `ladung` | „der Feldzug scheitert nie“ (D13); der Kauf ist damit ein zweiter, gleichwertiger Weg, ohne dass die Szene ihn kennen muss |
| D21 | `methalle_gesprengt` und `boss_besiegt` erst, wenn das Team wieder an Bord ist | Vertrag (4); „nach dem Hochbeamen“ (Briefing EK5) |
| D22 | Notrückholung = Ausgang `rueckzug` samt Kartenreset in k4 und k7 | Vertrag (4); die Kette wiederholt; die Flags des Kapitels 7 werden dabei gelöscht, sonst bliebe `flagge_gehisst` stehen |
| D23 | Solo-Siedlung: Legionär hisst mit, 5 + 1 Gegner | siehe oben |
| D24 | `scene.beam` an den Hexen 0704 und 0705 plus Landepunkte `*.siedlung` mit `frei: immer`; die Labor-Platzhalter `splitter.methalle` und `splitter.eisenwald` bleiben | Vorgabe EK5/EK6/EK7; das Labor und seine Bots bleiben unverändert |
| D25 | `tools/sim-headless.js`: eine Zeile in `buehneTasks` (Aufgabe „Anführer jagen“ nur in der Phase `angriff`) | nach dem Abzug der Gegner liefert `boss_besiegt` false, der Bot jagte ewig; das Kapitelbuch wartet hier (anders als die Vorlage) auf das Hochbeamen |

### Messwerte (Bot, 2026-10-11)
Bots über `node tools/sim-headless.js kette …` (ohne Tutorial; „ok“ ohne Zusatz = ohne Skip, 0 Fehler). Die Spielzeit enthält Wiederholungen. k7: Versuche = Niederlagen + 1 (Reset und Wiederholung nach `rueckzug`).

| Lauf | Crew | Seeds | Ergebnis | Spielzeit (min) | Bemerkung |
|---|---|---|---|---|---|
| Einstieg k2 (Konvoi, Abgabe) | 3 | 1–4 | 4/4 ok | 8,7–10,2 | |
| Einstieg k2 | 1 | 1–4 | 4/4 ok | 9,3–20,5 | 5–14: 10/10 ok (7,5–26 min) |
| Einstieg k4 (Methalle) | 3 | 1–4 | 4/4 ok | 1,6 | ohne Alarm, ohne Schuss (Schleichweg) |
| Einstieg k4 | 1 | 1–4 | 4/4 ok | 2,2 | |
| Einstieg k7 (Siedlung) | 3 | 1–4 | 4/4 ok | 1,2–16,0 | Versuche 3 / 13 / 1 / 1: die Bots verlieren oft gegen 11 Gegner (EK6-Befund), die Wiederholung greift |
| Einstieg k7 | 1 | 1–4 | 4/4 ok | 2,7–22,1 | Legionär hisst, 5 + 1 Gegner; Versuche 2 / 30 / 7 / 5 |
| Kette Lichtkordon bis Abspann | 3 | 1–4 | 4/4 ok | 34,7–60,6 | k6 noch Platzhalter; k7 Versuche 15 / 3 / 1 / 9 |
| Kette Lichtkordon bis Abspann | 1 | 1–4 | 4/4 ok, **2 mit Skip** | 41,8–62,5 | Seeds 1 und 4: k2 nach 25 min Bot-Zeitlimit übersprungen (Solo-Bot gegen den Konvoi); k7 Versuche 2 / 1 / 5 / 5 |

**Was nur zu dritt klappt (ehrlich):** Die volle Eskorte (Jäger und Korvette) am Rabenpass schafft kein Solo-Bot; solo ist sie darum auf den Jäger gekürzt, und selbst damit bleibt der Solo-Bot in der Kette bei 2 von 4 Läufen
am Zeitlimit hängen (im Labor-Einstieg 14 von 14). Ein Mensch kann den Konvoi solo endlos wiederholen (nie gescheitert), aber es ist Mühe. Die Siedlung ist zu dritt nur mit Wiederholungen sicher zu gewinnen (die Bots verlieren
im Mittel mehrere Anläufe, vor allem durch die 10 + 1 Gegner von allen Seiten); Menschentest EK9. Solo ist die Siedlung durch den Legionär und weniger Gegner machbar, aber keine Entsprechung zum Zwei-Spieler-Hissen.
Die Methalle klappt in beiden Besetzungen ohne Alarm.

Gespeichert und geladen wird weiter an jedem Kapitelübergang (`tools/test-kette.js`, jetzt 162 Prüfungen) und mitten in der Methalle (Sprengstoff im Gepäck bleibt).

### Offene Punkte (Boden)
- Balance der Siedlung und des Solo-Konvois (EK9, Menschen); Zahl der Gegner solo (5 + 1) und der Legionär (nur Funk, keine Figur) sind Vorschläge.
- Der Legionär beim Solo-Hissen ist nur ein Funkspruch plus Zeitfenster, kein sichtbarer NSC.
- k6 (Orbit) bleibt Platzhalter (Team VERK-ORBIT); `legat_befolgt` & Co. setzt dort der Platzhalter.
- Berührt außerhalb des Kerns: `content/welt/{limes,landepunkte}.json` (Landepunkte, `scene.beam`), `content/regiebuecher/k3_nebelheim` (eine Bedingung im Ersatz), `tools/sim-headless.js` (eine Zeile, D25), `tools/test-kette.js`.

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

## 7. Bedienung und Werkzeuge
- Spielen: Lobby, Taste M, „Kampagne Eisenwald“ (Weltstand wie jede Kampagne, Fortsetzen mit F). Debug (`npm run debug`): `kapitel <id>` (`k1_anwerbung` … `k8_sieg`), der Zustand davor wird hergestellt.
- `npm run check:kette` (Kette + 8 Bücher, `--selftest`), `npm run test:kette`, `node tools/sim-headless.js kette [--kapitel alle|<id>] [--crew 1|3] [--seeds N] [--seed S] [--von <kapitel>] [--tutorial]`.
- Testserver: Port 3396 (3395 war belegt), `WORLD_DIR=data/worlds-kette`.

## 8. Abnahme (Stand dieses Commits)
Siehe Abschnitt 9 (Messwerte). **Offen:**
- **Störsender-Regel** (`sprung.js`): ruhende Patrouillen dürfen den Sprung nicht blockieren. Die Kette umgeht es nur im Kapitel 3; für Szenen anderer Teams (Konvoi: Eskorte tot, Jäger-Einsprung) gilt die Regel unverändert.
- Platzhalter: Konvoi, Methalle, Siedlung sind ersetzt (Abschnitt 4a, VERK-BODEN); offen bleibt nur Kapitel 6 (Team VERK-ORBIT, FLOTTE). `npm run check:kette` listet den Rest.
- **Kauf von Sprengstoff auf Stationen** (EK5, Shop `ladung`, 150 Marken) führt seit 4a in dasselbe Gepäckfeld wie das Umladen der Beute; der kostenlose Ersatz im Hafen bleibt als Softlock-Schutz (D20).
- Texte (Kapitelkarten, Abspann, Hinweise, Funk) sind Entwurf; Kai passt sie in `content/kampagne/eisenwald.json` und den Büchern an.
- **Lesbarkeit** von Funkbild, Kapitelkarte und Abspann: nur per Screenshot (Playwright, 2D) geprüft, nicht mit Menschen (EK9). Voxel-Ansicht nicht geprüft (die Teile liegen in der 2D-HUD-Schicht und gelten für beide).
- Dauer: Die Bot-Durchläufe zeigen Spielzeiten von **ca. 32 bis 80 Minuten** (ohne Tutorial), vor allem Flüge zwischen den Hexen und die Platzhalter-Kämpfe; Menschen zu zweit/dritt: EK9.
- Mehrspieler: Der Abspann-Knopf beendet die Partie für **alle** (wie „Partie beenden“); ein Spieler kann also den Abspann der anderen abbrechen.

## 9. Messwerte (2026-10-11)
- `npm test` grün (inkl. `tools/test-kette.js` 115/115), `npm run check` grün (Kette + 8 Bücher, 13/13 Selbsttests), `npm run snap:mess` grün: Worst Case **11 444 B**, Wellen 10 558 B, Raum-Alarm 11 384 B (Ziel ≤ 18 944 B); Abspann 762 B (nur Phase `end`); Bot-Läufe der Kette Snapshot-Maximum 12 414 B.
- **Golden m1–m3** (20 Seeds, `--all --jobs 4`) gegen `base-w2` mit `allow-ek1.json`: **GOLDEN GRÜN**, 80/120 Traces byte-identisch (die übrigen 40 sind die bekannten EK1a-Abweichungen m1/m2 solo). Ordner gelöscht.
- **Bots, ganze Kette** (`sim-headless kette`, ohne Tutorial, 4 Seeds × Crew 1 und 3): **8/8 bis zum Abspann**, 0 Fehler, keine Skips, Spielzeit **28–41 min** (Median ~31).
- **Bots, Labor-Einstieg je Kapitel** (8 Kapitel × 3 Seeds × Crew 1 und 3): **48/48 ok**, 0 Fehler, keine Skips.
- Ein erster Lauf mit stärkeren Platzhalter-Gegnern (Orbit 2/3/Fregatte+2, Siedlung +3) brauchte bei Crew 3 teils 25–60 min je Orbitschritt (Bots, Zeitlimit-Skips) – danach reduziert (D15).
- **Browser** (Playwright, Chromium, 2D, Port 3396): Lobby-Modi, Kapitelkarte „Neues Kapitel“, Funk mit Mars-Symbol und Legat-Porträt, Abspann (Anfang, Lauf, Ende) per Screenshot geprüft (`shots/kette/*.png`, lokal), keine Konsolenfehler. Nicht mit Menschen, Voxel nicht geprüft.
