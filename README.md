# Sternenschicht – M1 „Die stumme Boje“ / „Echo im Nebel“ · M2 „Schildwall“ (Planetenmission „Die Tafel von Kesh“) · M3a „Breitseite & Schaden“ · M3b Schritt A „Ein Flugmodell für alle“

Gemütliches Online-Koop-Raumschiff für 1–3 Spieler im Browser. Ein kleiner Node-Server führt die
Partie, jeder spielt im eigenen Browserfenster. Kein Game Over – man scheitert mit Würde.

## Spieleabend – Kurzanleitung (Planetenmission zu dritt)

1. `cd sternenschicht` · `npm start` (oder `npm run debug`, wenn ihr live nachjustieren wollt – siehe `tune` unten).
   Die Konsole zeigt **Raumcode** und Link.
2. Übers Internet: zweites Fenster `cloudflared tunnel --url http://localhost:3300`, die `trycloudflare.com`-Adresse
   mit `?code=XXXX` teilen (Details unter „Übers Internet spielen“).
3. Lobby: Name eintippen, **M** schaltet „Start: Kampagne / **Direkt zur Planetenmission**“ um (jeder darf),
   dann alle **Enter** = bereit.
4. Im Hafen: **Captain** an die Captain-Konsole (`C`), Reiter 1 Funk → Enter (Auftrag annehmen), Reiter 2 Sternkarte →
   „Mond Kesh“ → Enter. **Pilot** an die Steuer (`H`), Abstand zum Hafen, **F** springt. Am Mond auf ≤ 360 heran und
   **X (Allstopp)** – unter 30 beamt es sich. **Vor dem Verlassen der Steuer immer STOPP:** Die unbesetzte Steuer behält
   ihre Stufe, das Schiff fährt weiter und ist nach 20 s einen Kilometer weg (ODA: „Schiff zu schnell für den Transfer“).
5. Die zwei vom Außenteam gehen in die Transferkammer (unten links an Bord), stellen sich auf die Pads und halten **E**.
   Der Captain bleibt oben, wechselt auf **Reiter 6 „Außenteam“** und führt von dort.
6. Ende: Ende-Bildschirm „Die Tafel ist sicher“ mit Spielzeit. Danach könnt ihr frei weiterfliegen.

Erwartete Dauer zu dritt: siehe „Messwerte M2“ unten.

## Testgelände (solo)

Zum gezielten Ausprobieren der Kampfbereiche, ohne eine Mission durchzuspielen – geht solo und zu dritt, auch ohne `--debug`.

1. `npm start`, Link öffnen. In der Lobby schaltet **M** reihum: „Kampagne“ → „Direkt zur Planetenmission“ →
   **„Testgelände: Raumkampf“** → **„Testgelände: Außenteam“** (Anzeige „START (n/4)“). Dann **Enter** = bereit.
2. **Raumkampf:** Start sofort an Boje B-7 (keine Brocken), abgelegt, Schiff unbeschädigt, alle auf der Brücke (solo
   neben dem Steuer, zu dritt neben Steuer / Taktik / Captain). Zielanzeige „Welle n“. Wellen (M3b): **Kanonenboot +
   2 Jäger** → 2 Jäger → Jäger + Kanonenboot → Kustoden-Wächter + 2 Jäger → Kanonenboot + Jäger → Pylon (fest im
   Backbord-Bogen) + Kanonenboot, danach wieder von vorn; Gegner fliegen im Testgelände mit dem neuen Flugmodell (Temporegler,
   Kanonenboot hält die Breitseite, Jäger fliegen Überflüge); die nächste Welle kommt 12 s nach der Räumung (ODA sagt an). Schaden, Bots, Notfallprotokoll,
   Schildsektoren, Breitseite und Lanze (M3a, siehe unten), Scan/Weitscan und Reaktor überladen wie im Spiel.
   Solo: am Steuer fliegen, mit Esc + E zur Taktik wechseln (Taktik liegt oben links auf der Brücke). Kein Ende-Bildschirm.
3. **Außenteam:** Start sofort auf Mond Kesh, Mission „Die Tafel von Kesh“ ab dem Hof (Trupp 1), **alle** Spieler auf
   den Pads mit vollem Schild und Medipack (wenn im Lager). Das Schiff steht in Transferreichweite – wer Captain
   spielen will, beamt hoch (Pad, E halten). Danach läuft die Mission normal weiter bis zum Ende-Bildschirm.
4. Tipp: Mit `npm run debug` und `?debug=1` (F7) gehen zusätzlich `tune …` (Werte live), `spawn <art>`, `skip`
   (Raumkampf: Welle räumen / nächste sofort), `squad 1|2|rear`, `wake`, `shield <n>`, `wound`.
   Wellen und Szene stehen in `shared/config.js` unter `arena`.

## Start

```
cd sternenschicht
npm install        # einmalig (einzige Abhängigkeit: ws)
npm start          # Server auf Port 3300
```

- Der Server zeigt beim Start einen **Raumcode** und den fertigen Link, z. B.
  `Raumcode: K7QM   Link: http://localhost:3300/?code=K7QM`. Selbst spielen: diesen Link öffnen.
- Mitspieler im selben Netz: `http://<IP-des-Rechners>:3300/?code=K7QM` (IP z. B. per `ipconfig`; ggf.
  Windows-Firewall für Port 3300 freigeben). Anderer Port: `PORT=3400 npm start` bzw. in `.env`.
- Lobby: Name eintippen, Farbe mit 1–3, **Enter = bereit**. Es geht los, sobald alle Verbundenen bereit sind.
  Rechts stehen der Raumcode und **„Einladungslink kopieren“** (L). Der Schalter **„Übung überspringen“** (U)
  lässt die Hafen-Übung weg – jeder darf ihn umschalten, alle sehen den Zustand.
  Später Beitretende landen direkt im Spiel. Ein vierter Spieler bekommt „Server voll“.
- Verbindung weg? Der Client verbindet sich selbst neu und bekommt seine Figur zurück (der Code ist im Browser gemerkt).

## Raumcode

Ohne gültigen Code kommt niemand an Bord – auch nicht von localhost, denn ein Tunnel kommt ebenfalls von
localhost an. Wer ohne oder mit falschem Code öffnet, sieht ein Eingabefeld „Raumcode“.

- Standard: Der Server würfelt bei jedem Start einen neuen Code (4 Zeichen, ohne 0/O/1/I).
- Fester Code: `ROOM_CODE=K7QM` in der `.env` (praktisch für wiederkehrende Runden).
- Ohne Code (nur im eigenen Netz empfehlenswert): `ROOM_CODE=off`.
- Der Browser merkt sich den Code; ein Link mit `?code=` hat Vorrang.

## Übers Internet spielen

Am einfachsten über einen Cloudflare-Quick-Tunnel (kostenlos, kein Konto, keine Portfreigabe):

1. Einmalig installieren: `winget install Cloudflare.cloudflared`
2. Server starten: `npm start` – Raumcode aus der Konsole notieren.
3. In einem zweiten Fenster: `cloudflared tunnel --url http://localhost:3300`
4. cloudflared zeigt eine Adresse wie `https://irgendwas-zufaellig.trycloudflare.com`. Daran `?code=K7QM`
   hängen und teilen: `https://irgendwas-zufaellig.trycloudflare.com/?code=K7QM` (oder in der Lobby
   „Einladungslink kopieren“ – im Tunnel-Fenster geöffnet, enthält der Link schon die richtige Adresse).

Hinweise:
- Den PC wach halten (Energiesparen aus) – schläft er ein, ist die Runde weg.
- Höchstens 3 Spieler, ein Gerät (oder Browser) pro Spieler.
- Die Tunnel-Adresse ändert sich bei jedem Start von cloudflared; der Raumcode bei jedem Serverstart
  (außer mit festem `ROOM_CODE`).
- Fremde mit der Adresse, aber ohne Code, sehen nur das Code-Feld.

## Rollen an Bord (ab M1)

| Rolle | Konsole | Aufgabe |
|---|---|---|
| **Pilot** | Steuer (ganz vorn, `H`) | sieht **nur die Frontsicht** (Bug oben, ca. 700 px nach vorn, im Nebel die Hälfte). Fliegt nach Sicht und nach den **Markern**: Mint = Captain, Bernstein = Taktik (Raute im Raum, am Rand Pfeil mit Entfernung). |
| **Taktik** | Taktik (`W`, früher „Waffen“) | weite Taktikkarte, **alle Waffen** (Lanze am Bug, Batterien an beiden Flanken, Ladepunkte verteilen), **Ziel-Scan** (Schilde und Feuerbögen der Gegner), **Weitscan** (versteckte Dinge), Marker für den Pilot. Sieht Ladungen der Gegner zuerst und sagt sie an. |
| **Captain** | Captain (`C`) | Funk und Entscheidungen, Sternkarte/Sprungziele, Lage-Karte mit Captain-Marker, Energie & Schilde (auch **Reaktor überladen**; Schildpool 6 bei Schild-Energie 2), **Schadensplan** (Reparaturliste der Schrauber), Außenteam-Hilfe. |

Allein geht alles auch: zwischen den Konsolen hin- und herlaufen. Unbesetzte Taktik feuert mit halber Kraft automatisch,
unbesetzte Steuer behält die eingestellte Fahrtstufe, das Ruder geht auf 0 – das Schiff fährt geradeaus weiter (ab M3b,
vor dem Verlassen also auf STOPP stellen). Die **Schrauber** löschen Feuer und dichten Lecks selbst ab;
Systeme reparieren sie ab M3a nur auf Befehl (Schadensplan) oder automatisch, wenn nur einer spielt.

## Steuerung

| Wo | Tasten |
|---|---|
| Laufen | WASD / Pfeile · **E** interagieren (Löschen, Lecks, Beamen, Container, Schalter: **E halten**) · an einer Station: **E halten** = flicken (mit Ersatzteil in der Hand: Teil einbauen), **R** = Minispiel · **G** ablegen · **Tab** Crew-Status · **Esc** Konsole verlassen |
| Steuer (Frontsicht) | **W/S Temporegler**: eine Stufe je Tastendruck (Halten schaltet nicht weiter) – R · STOPP · 1/4 · 1/2 · 3/4 · VOLL; links die senkrechte Stufenleiste (eingestellte Stufe hell, Pfeil = Ist-Tempo, Stufe auch per Mausklick, rechts „Stufe +/−“) · A/D Ruder (das Schiff ist träge: Drehung baut sich auf und läuft nach; **bei 1/2 am wendigsten**, „wendig“ an der Leiste, „DREHEN x %“ = aktueller Drehfaktor, hell im Drehbalken = bei diesem Tempo erreichbar) · **X Allstopp** (Stufe auf STOPP, stärker bremsen bis Stillstand) · Shift+A/D Ausweichrolle (7 s Abklingzeit) – lädt ein Gegner, steht oben **„AUSWEICHEN!“** mit Seite und Countdown; wird die Anzeige **grün** (letzte 0,8 s), jetzt ausweichen → der schwere Treffer geht vorbei („Ausgewichen!“) · F Faltsprung (wenn der Captain ein Ziel gewählt hat) · **keine Feuertaste** – lädt die Taktik die Lanze („LANZE LÄDT – Bug aufs Ziel!“), zeigt die Frontsicht eine Visierlinie: Bug auf den Gegner drehen |
| Taktik | T nächstes Ziel (oder anklicken) · **Q/E** Waffe wählen · **A/D** Ladepunkte −/+ · **1 halten** Lanze aufladen (3 → 12 Schaden in 3 s, Visierlinie am Bug), **loslassen** feuert in Bugrichtung – auch per Maus: Knopf „Lanze“ gedrückt halten; kein Ziel nötig · **2/3** Batterie Bb / Stb · **Leertaste** beide Batterien (feuern nur auf Befehl, auch ohne Ziel: Ziel im Bogen, sonst nächster Gegner, sonst ins Leere) · 4 Bolzen (nach Kauf) · **S halten** Ziel-Scan · **W** Weitscan · **M** Marker aufs Ziel · **Rechtsklick** Marker setzen · **X** Marker löschen · **Z**/+/− Zoom · **O** Orbitalschlag (Außenmission) |
| Captain | **1–6** Reiter: 1 Funk (Enter annehmen, Q/W/E Antwort) · 2 Sternkarte (←/→ Ort, Enter Sprungziel) · 3 Lage (Linksklick Captain-Marker, X löschen, **Leertaste halten = Scan**) · 4 Energie & Schilde (↑/↓ Zeile, ←/→ verteilen, **U → J Reaktor überladen**, N abbrechen) · 5 Schadensplan (W/S wählen, F/Enter Flicken, T Teil, Entf entfernen, P an die Spitze, A Bots automatisch) · 6 Außenteam (Codetabelle, S Sensor, K Schildkuppel) · oben rechts auf jedem Reiter die Schild-Übersicht (Füllstand, Durchlass-Farbe, rote Ladungs-Countdowns) – **kein Schildstoß mehr** (M3b) |
| Minispiel (R an einer Station) | **Leertaste**, wenn der Zeiger im grünen Feld steht – 3 Treffer, Fehlgriff = 1 s Sperre, scheitern unmöglich · Esc bricht ab |
| Planungstisch (Brücke, `Y`) | E am Tisch setzen (bis zu 3 gleichzeitig) · **1–5** Pin-Art (Ziel, Gefahr, Landeplatz, Treffpunkt, Frage) · **Klick** Pin setzen – auf der Sternkarte (auf einem Ort: **Shift+Klick**), auf jeder Detailkarte und jedem Decksplan · Rechtsklick eigenen Pin entfernen · ←/→ Ort · **Enter** Detailkarte · **D** Decksplan (B-7/Wrack/Kesh) · **Backspace** zurück zur Sternkarte · **M Missionsbuch**: aktive / angebotene / erledigte Aufträge mit Auftraggeber, Briefing, Belohnung, Zielen und Logbuch – **W/S** wählen, **Enter** als aktiv markieren (das HUD zeigt dann deren Ziele), **A** annehmen · Esc aufstehen |
| Quartier (E an der eigenen Koje) | ↑/↓ Reihe (Boden, Wand, Licht, Plätze) · ←/→ wählen · **Q/E** Deko blättern · Enter Deko setzen |
| Transfer | 1 runter · 2 hoch · 3 Medipack-Nachschub · 4–6 Notrückholung (oder einfach auf einem Pad **E halten**) |
| Außenmission | Leertaste/Linksklick Blaster (zielt auf die Maus) · Q Markierung für Hilfe von oben · Sonde: 1–6 Farbe |
| Außenmission Kesh (Kampf v2) | **C** ducken / aufstehen · siehe „Kampf auf Kesh“ unten · Captain-Reiter 6: **Q/W/E/R/F/G** Befehl wählen, Klick auf die Karte setzt ihn, X löschen, **S** Sensor, **K** Kuppel |
| Reaktor offline | beide Schalter im Maschinenraum (A oben, B unten) **gleichzeitig E halten**, 3 s. Allein: einen halten, nach 3 s kommt ein Schrauber an den anderen. |

Jede Konsole zeigt ihre Tasten unten in einer Zeile. Ton startet mit der ersten Taste/dem ersten Klick.

## Die sieben Orte

| Ort | Was dort ist |
|---|---|
| **Hafen Lichtkordon** | Heimathafen, Liegeplatz, Hafenterminal (Shop), Tesks Funkturm. Ein Versteck im Hafenschrott. |
| **Splittergürtel** | Asteroiden (Schild kostet's), Bergungskisten, Grauzahns Wegezoll. 2 Verstecke. |
| **Boje B-7** | die stumme Boje mit Plattform (Außenmission), Rostmeute. Wartungskiste und ein Kustoden-Splitter (Scan). |
| **Vaelen-Karawane** | fahrende Händler: Kristalllampe, Bolzenwerfer günstiger, andocken erlaubt. Sela braucht Hilfe; Teepaket und ihre Messsonde treiben in der Nähe. |
| **Wrack „Zaunkönig“** | Außenmission im dunklen Frachter: 4 Container, Logbuch-Terminal, Plünderer, ein Hohlraum (nur per Weitscan aus dem Orbit). Draußen eine Rettungskapsel. |
| **Graue Weite** | Nebel: Sicht und Sensoren halbiert. Hinterhalt, Leitbake (Weitscan!), eine alte Lore-Bake. |
| **Kustoden-Relais** | erst nach der Leitbake erreichbar. Pylonen mit Frontschild, Kustoden-Wächter (EMP), Relaiskern. |

Unbekannte Nachbarn stehen als „Unbekanntes Signal ?“ auf der Sternkarte – hinfliegen erlaubt. Insgesamt gibt es
**12 Entdeckungen** (Captain-Logbuch und Planungstisch zeigen „Funde x/y“ je Ort).

## Erkunden – Tipps

- **Weitscan (Taktik, W) bei jedem Erstbesuch.** Er deckt im Umkreis von 1000 px Verstecke auf; 20 s Abklingzeit.
  Nichts gefunden? Ein Stück weiterfliegen und noch einmal.
- **Verstecke** (Kisten, Kapsel): einfach drüberfliegen. **Baken** (Lore, Leitbake, Selas Sonde): Taktik wählt sie mit T,
  fliegt auf ≤ 800 heran und hält S.
- Der **Decksplan** von B-7 und vom Wrack liegt nach dem ersten Besuch am Planungstisch (Ort wählen, D). Pins dort
  sieht das Außenteam unten im HUD – praktisch für „hier Container, dort Plünderer“.
- Im Wrack zuerst aus dem Orbit weitscannen – sonst bleibt der Hohlraum zu („Die Wand klingt hohl …“).
- Der Reaktor kann 3 Minuten **überladen** werden (+4 Energie), danach ist er aus: Notstrom nur für Lebenserhaltung und etwas Schild – kein Antrieb, keine Kanonen, kein Sprung.
  Neustart zu zweit an den Schaltern – am besten in einer ruhigen Minute.
- Verpasst ihr etwas Wichtiges (Leitbake, Selas Sonde), hilft ODA nach einer Weile mit Hinweisen und markiert es zur Not selbst.

## Ablauf

**Mission 1 „Die stumme Boje“:** Hafen-Übung (Brand, Leck, Transfer; überspringbar) → Funk annehmen → Splittergürtel:
Bergungsgut, Grauzahn antworten (bestechen oder kämpfen) → B-7: Rostmeute und Kanonenboot, Störrelais abschießen,
Boje scannen → Außenmission (Sonde mit Farbcode vom Captain, Bojenkern, Datenkern, Ivo mit Medipack retten) →
Entscheidung über den Datenkern → Nachhut → Selas Notruf (optional: bei Vaelen andocken) → Hafen, andocken, Bojen-Trophäe.

**Mission 2 „Echo im Nebel“:** Einkaufen/Quartier/Planungstisch → Funk annehmen → **Vaelen**: Sela bietet ihre Nebelkarte
(60 Marken) oder bittet, ihre Messsonde per Weitscan zu suchen → Graue Weite: Hinterhalt → **Funkduell** mit Grauzahn
(bluffen, teilen oder schweigen – mit Folgen) → Leitbake per Weitscan finden und scannen → Kustoden-Relais: 3 Pylonen
von der Seite, Wächter, dann die **Prüfung** (2 Pylonen, Front zum Kern – von außen angreifen) → Captain scannt den Kern
→ Ende-Screen „Fortsetzung folgt“. Danach könnt ihr frei weiter erkunden (Wrack, restliche Funde).

**Mission 3 „Die Tafel von Kesh“ (Planetenmission, M2):** In der Kampagne bietet Tesk sie nach Mission 2 an; für den
Spieleabend gibt es den Lobby-Direktstart (**M**, „Direkt zur Planetenmission“: keine Hafen-Übung, Schiff im Hafen,
Auftrag liegt als Funk bereit). Ablauf, ohne zu viel zu verraten:
Funk annehmen → Mond Kesh → zwei beamen runter, der Captain bleibt oben → **Hof der Ruine** (Plünderer-Trupp; zwei
Störrelais in den Gängen – solange sie laufen, sieht der Captain nur Rauschen, und abschalten bleibt nicht unbemerkt) →
**Archivhalle**: zwei Archivschlüssel weit auseinander, beide **gleichzeitig** E halten („drei, zwei, eins – jetzt!“) →
Gewölbe, Tafel bergen (E halten, sie landet direkt im Inventar) → dann wird es laut → zurück durch den Hof zu den Pads
und hochbeamen. Optional: den Wächter ausschalten (Belohnung).

## Kampf auf Kesh (Kampf v2)

Gilt nur auf Kesh; Plattform B-7 und Wrack spielen sich wie bisher mit Lebenspunkten.

- **Schild statt Lebenspunkte:** 3 Segmente (HUD unten links, Ring unter der Figur). Jeder Treffer kostet ein Segment,
  der Wächter-Schuss zwei. Nach 4 s ohne Treffer lädt der Schild nach (ein Segment je 1,2 s).
- **Treffer ohne Schild → verwundet**, nicht tot. Liegend kann man sich nicht bewegen, aber **mit der Maus zielen und per
  Klick die Pistole** abfeuern. Nach 45 s holt der Transfer einen allein hoch (voller Schild, über die Pads geht's wieder runter).
- **Wiederbeleben:** neben den Kameraden stellen, **E halten** (4 s). Mit Medipack 1,5 s und zwei Segmenten. Jeder vom
  Außenteam nimmt beim Runterbeamen ein Medipack aus dem Lager mit (solange vorhanden); Nachschub per Transfer-Konsole (3).
- **Liegen alle**, folgt nach 5 s die **Notrückholung aller** – kein Game Over, die Mission läuft weiter, der Transfer kühlt
  20 s ab.
- **Deckung nach Richtung:** Niedrige Mauerreste (helle Oberkante) sind **halbe Deckung** – sie schlucken Schüsse von vorn
  oft, von der Seite nie. Pfeiler und Wände sind volle Deckung. HUD: „DECKUNG: HALB / VOLL / KEINE“ und rot **„FLANKE OFFEN“**,
  wenn einer euch trotz Deckung frei trifft. Aus der eigenen Deckung heraus schießt man ungehindert.
- **Ducken (Taste C, an/aus):** geduckt läuft man halb so schnell und ist ein kleineres Ziel (jeder Treffer verfehlt zu
  20 %). Hinter einem **niedrigen Mauerrest** geduckt ist man **voll gedeckt**: Gegner auf der anderen Seite sehen einen
  nicht, zielen nicht und jeder Schuss bleibt in der Mauer hängen (HUD „GEDUCKT – C: aufstehen“, „DECKUNG: VOLL“, Pip mit
  Häkchen). Dafür sieht man selbst nicht über die Mauer, und eigene Schüsse über die Mauer bleiben auch hängen – **zum
  Schießen aufstehen**. Von der Seite hilft Ducken nur als kleineres Ziel („FLANKE OFFEN“). E halten geht geduckt;
  Verwundung, Konsole und Beamen beenden das Ducken. Plünderer ducken sich im Rückzug selbst hinter Mauerreste – dann
  hilft nur flankieren.
- **Rote Ziellinie** = ein Gegner legt an (Warnton). Knapp eine Sekunde Zeit, um aus der Linie oder hinter Deckung zu gehen.
- **Plünderer** haben selbst Schilde (3 Segmente, laden nach), ziehen sich mit leerem Schild zurück, flankieren und
  funken (Untertitel „PLÜNDERER: …“ – mithören lohnt sich).
- **Wächter „Lamassu“:** vorn ein Schildbogen, der alles abhält. Von der Seite oder von hinten treffen – einer lenkt ab,
  der andere geht rum.
- **Nebel:** Unten seht ihr nur, was eure Figuren sehen. Blasse Gitter-Silhouetten = zuletzt gesehen.

**Captain an Bord (Reiter 6 „Außenteam“):** Karte mit allen Gegnern (verrauscht, solange ein Störrelais läuft).
Befehl wählen mit **Q** Sammeln · **W** Halten · **E** Flanke · **R** Rückzug · **F** Fokus · **G** Gefahr, dann auf die
Karte klicken – unten erscheint eine Lichtsäule mit Beschriftung (30 s, höchstens 3). **Fokus** auf einen Gegner klicken:
Er ist 8 s für das Außenteam sichtbar, auch durch Wände. **S** Sensorimpuls (10 s alle Gegner sichtbar), **K** Schildkuppel
(fängt 20 s lang ganze Treffer ab). Orbitalschlag bleibt bei der Taktik (O auf die Q-Markierung des Außenteams).

### `tune` – Spickzettel für den Spieleabend

Live nachjustieren geht nur mit `npm run debug` und im eigenen Fenster mit `?debug=1` am Link (z. B.
`http://localhost:3300/?code=K7QM&debug=1`). Dann öffnet **F7** eine Eingabezeile. `tune` allein listet alle Werte.
Achtung: Der Debug-Server erlaubt auch Abkürzungen (F6 überspringt einen Schritt) – nur im eigenen Fenster benutzen.
`?debug=1` zeigt außerdem FPS/Fehlerzähler und über jedem Gegner Rolle, Segmente und Zielfortschritt.

| Befehl (Standardwert) | Wirkung |
|---|---|
| `tune shield.segments 4` (3) | mehr Schild für alle → deutlich leichter |
| `tune shield.regenDelay 3` (4) | Schild lädt früher nach → leichter, weniger Rückzug nötig |
| `tune enemy.scavenger.aim 1.1` (0,8) | längere Ankündigung (rote Linie) → mehr Zeit zum Ausweichen, leichter |
| `tune enemy.scavenger.fireInterval 1.8` (1,3) | Plünderer schießen seltener → leichter |
| `tune enemy.scavenger.segments 2` (3) | Plünderer fallen schneller (gilt für neu erscheinende Trupps) → kürzer, leichter |
| `tune halfCoverBlock 0.75` (0,6) | Mauerreste schlucken mehr → Deckung lohnt mehr |
| `tune squadScale.3 0.75` (1) | Trupps zu dritt kleiner (Anteil der Plätze, nur nach unten wirksam, ab dem nächsten Trupp) |
| `tune wounded.bleedout 60` (45) | mehr Zeit zum Wiederbeleben, bevor der Transfer zugreift |
| `tune barks off` / `on` | Funksprüche der Plünderer aus/an (A/B-Vergleich) |
| `tune enemy.warden.frontArc 90` (120) | schmalerer Schildbogen des Wächters → leichter von der Seite |
| `tune crouch.dodge 0.3` (0,2) | geduckt verfehlen mehr Schüsse → Ducken lohnt mehr |
| `tune crouch.speedFactor 0.7` (0,5) | geduckt schneller unterwegs |
| `tune crouch.enemyCrouch off` / `on` (on) | Plünderer ducken sich im Rückzug nicht mehr → kürzer, leichter |

Faustregel: Zu schwer → zuerst `enemy.scavenger.aim` hoch oder `fireInterval` hoch. Zu leicht → `shield.regenDelay 5`
oder `fireInterval 1.1`. Werte gelten bis zum Serverneustart.

## Raumkampf M3a – Breitseite & Schaden

Die Lerche ist jetzt träge, feuert über die Seiten, Gegner kündigen schwere Treffer an, und Treffer zerlegen das Schiff
Station für Station – irgendwer muss die Brücke verlassen. Ausprobieren am besten im **Testgelände Raumkampf** (Lobby, M).

### Die neue Lerche (Bug rechts, Backbord oben)

```
 Heck                     mittschiffs                Bug
 Antriebsraum | Lager / Quartiere | Maschinenraum | Batteriedeck Bb | Brücke
 (Triebwerk,  | Messe (Terminal,  | (Reaktor oben,| (Bb-Düse, Bb-   | (Taktik oben links,
  Heck-       |  Esstisch,        |  Schildgen.   |  Batterie, Bb-  |  Planungstisch links,
  Emitter)    |  Lebenserhaltung) |  unten,       |  Emitter)       |  Captain Mitte, Steuer
              | Transfer / Quart. |  Schalter A/B)| Batteriedeck Stb|  vorn, freies Terminal
              |                   |               | (Stb-Düse, -Bat.|  unten links; Lanze +
              |                   |               |                 |  Bug-Emitter am Bug)
```

- **Brücke** ganz vorn: Taktik (oben links), **Planungstisch** (links, aus der Messe hierher verlegt), Captain (Mitte),
  Steuer (vorn), ein **freies Terminal** unten links (noch ohne Funktion). Direkt daneben am Bug: **Lanze** und **Bug-Emitter**
  (1,3 s Laufweg).
- **Batteriedecks** oben (Backbord) und unten (Steuerbord): je **Düse, Batterie, Emitter** (5–6 s von der Brücke).
- **Maschinenraum** mittschiffs: **Reaktor** (oben), **Schildgenerator** (unten), Reaktorschalter A oben links und B unten rechts (7 s).
- **Antriebsraum** am Heck: **Triebwerk** und **Heck-Emitter** (13–15 s – der weiteste Weg).
- **Lager** oben links: Regale mit Ersatzteil, Löschgel, Flickblech, Bolzen, Medipack. Messe mit Lebenserhaltung, unten
  Transferkammer.
- Neben jeder Station hängt eine Plakette (BUG/STB/HECK/BB/MITTE) mit Zustand OK / BESCH / AUS / FLICK.

### Wer macht was

| Rolle | Aufgabe im Kampf |
|---|---|
| **Pilot** (Steuer) | steuert und weicht aus. Keine Feuertaste. Hält Gegner in der **Breitseite** (Ziel bei ±90°), dreht bei einer Ansage weg (aus dem Bogen des Gegners) oder **weicht im grünen Fenster aus** (dann verfehlt der schwere Treffer) und dreht beim **Laden der Lanze** den Bug aufs Ziel (Visierlinie). Das Schiff ist träge (Drehung läuft nach) – früh gegenlenken. Ab M3b fährt es mit dem **Temporegler** (W/S je eine Stufe): bei **1/2** am wendigsten (90° ≈ 2,6 s), bei VOLL schnell, aber weiter Bogen (90° ≈ 4,4 s); Stopp → Voll ≈ 6 s. |
| **Taktik** | verteilt die **Ladepunkte** (4 bei Waffenenergie 2) auf Lanze und Batterien und **feuert alles**: Lanze (1 halten = aufladen, loslassen = Schuss in Bugrichtung, 3–12 Schaden je Ladedauer, durchschlagend 2), Batterien (breite Fächer an den Flanken, Salve 4 × 1,5, nur auf Taste 2/3/Leertaste). Unbesetzt feuert die Taktik automatisch mit halbem Tempo. Sieht **Ladungen** der Gegner ab Beginn (roter Fächer mit Countdown) und sagt sie an. |
| **Captain** | Schilde in den bedrohten Sektor (ab 3 dicht, siehe Durchlass-Tabelle), läuft als Erster los, **Schadensplan**: Schrauber auf Systeme ansetzen (Flicken / Teil), „Bots automatisch“. Sieht Ladungen erst in den letzten 1,2 s – hört also auf die Taktik. |
| **Wer läuft** | repariert: meist die Taktik oder der Captain (unbesetzte Taktik feuert mit halber Kraft weiter). |

### Ansagen und Schilde
- Kanonenboot (3 s), Pylon (2 s) und Kustoden-Wächter (2,5 s, EMP) **laden** sichtbar, bevor sie schwer treffen. Ist das
  Schiff am Ende noch in Bogen und Reichweite, trifft es (Kanonenboot 3 Schaden = 15 Hülle ohne Schild), sonst verfehlt es.
  Treffer der Taktik auf einen ladenden Gegner verzögern die Ladung (je 1 s, höchstens 2 s). Jäger schießen weiter normal.
- Solo sagt ODA jede Ladung an („Kanonenboot lädt – Backbord!“).
- **Der Schildstoß ist weg (M3b).** Dafür ist der Schildpool größer: **6 Punkte** bei Schild-Energie 2 (3 je Energie),
  höchstens 4 je Sektor.
- **Ein Schildpunkt schluckt einen Schadenspunkt**, der Rest geht auf die Hülle (5 Hülle je Punkt). Bei Schild ≥ 3 wird ein
  schwerer Treffer zusätzlich um 1 gemindert.
- **Durchlass** – Chance je Treffer auf Systemschaden, nach der Schildstärke des Sektors **vor** dem Treffer (gilt auch, wenn der
  Schild alles gefangen hat). Steht im Captain-Reiter 4 unter jedem Sektor:

  | Schild | Anzeige | Systemschaden |
  |---|---|---|
  | 0 | „0: offen“ (rot) | 45 %, bis zerstört, auch mittschiffs, Geflicktes bricht |
  | 1 | „1: Kratzer 20 %“ (orange) | 20 %, höchstens beschädigt, Geflicktes bricht |
  | 2 | „2: 5 %“ (gelb) | 5 %, nur bei schweren Treffern, höchstens beschädigt |
  | 3–4 | „3: dicht“ (mint) | nie |

### Schaden und Reparatur
- Treffer beschädigen Systeme nach der Durchlass-Tabelle oben: meist im getroffenen Sektor, manchmal nebenan, bei offenem
  Schild selten mittschiffs (nie die Gegenseite). Eine Stufe je Treffer: OK → BESCH → AUS. Wirkung u. a.: Düse beschädigt = Drehen zu
  dieser Seite halb so schnell; Emitter beschädigt = Sektor hält nur 2, zerstört = Sektor offen; Batterie beschädigt =
  2 statt 4 Rohre; Lanze beschädigt = Ladezeit × 1,5; Triebwerk zerstört = kein Schub/Sprung; Reaktor zerstört = Notstrom,
  nach der Reparatur Neustart zu zweit an den Schaltern.
- **Drei Wege an jeder Station:**
  - **E halten = Flicken** (1,5 s): eine Stufe hoch, aber **fragil** (FLICK, Klebeband) – der nächste Treffer im Sektor zerstört es sofort.
  - **R = Minispiel** (3–5 s): eine Stufe hoch, dauerhaft.
  - **Ersatzteil holen (Lager) + E halten = Austausch** (3 s): sofort OK.
- **Schrauber (Bots)** löschen Feuer und dichten Lecks selbst. Systeme reparieren sie **nur aus der Reparaturliste** des
  Captains (höchstens 3 Einträge, „Flicken“ oder „Teil“). „Bots automatisch“ füllt die Liste selbst – Standard nur, wenn
  genau einer spielt. Notreparatur durch ODA nach 45 s bleibt (nichts bleibt dauerhaft kaputt).
- **Eskalation (M3b):** Bleibt im Gefecht ein System **20 s** beschädigt/zerstört, ohne dass jemand daran arbeitet, fängt der
  Boden neben der Station **Feuer**. Countdown im Schadensplan (Flamme + „14s“ statt Laufweg, darunter „Stb-Düse brennt in
  14 s“) und über der Station im Schiff („brennt in 14 s“, ab 5 s blinkend). Danach Hinweis „FEUER an …“.
- **Rückschlag (M3b):** Ein Hüllentreffer im Sektor einer laufenden Reparatur kostet **50 %** des Fortschritts (Flicken,
  Teil, Minispiel, Schrauber). Am Balken über dem Kopf erscheint das verlorene Stück rot mit „RÜCKSCHLAG −50 %“, oben die
  Meldung; Schrauber zeigen „−50 %“. Also zwischen den Salven schrauben.
- **Reaktor-Autostart (M3b):** Ein im Gefecht reparierter Reaktor startet nach 3 s selbst („Reaktor startet in 3 s von
  selbst“ im Captain-Reiter 4); der Neustart zu zweit bleibt für ruhige Momente.
- `stats.bridgeLeaves` zählt, wie oft jemand die Brücke verlässt, während Gegner da sind.

### Testgelände-Wellen
1. **Kanonenboot + 2 Jäger** (M3b) · 2. 2 Jäger · 3. Jäger + Kanonenboot · 4. Kustoden-Wächter + 2 Jäger · 5. Kanonenboot +
Jäger · 6. Pylon (fest) + Kanonenboot, danach von vorn. 12 s Pause zwischen den Wellen. Start: Schiff unbeschädigt,
Schilde 2/2/0/2 (Bug/Stb/Heck/Bb, ganzer Pool 6).

### Raumkampf M3b – Ein Flugmodell für alle (Kurzfassung)
- **Temporegler** (W/S je eine Stufe, R · STOPP · ¼ · ½ · ¾ · VOLL). Drehen ist bei **½ am wendigsten**, im Stand dreht die
  Lerche kaum (Drehfaktor 25 %) – zum Ausrichten an der Boje also kurz auf ¼/½. **X = Allstopp.**
- **Unbesetzte Steuer:** Stufe bleibt, Ruder 0, das Schiff fährt weiter – vor dem Aufstehen STOPP stellen (besonders vor dem
  Beamen; sonst „Zu weit vom Ziel … das Schiff fährt weiter“ bzw. „Schiff zu schnell für den Transfer“ + ODA-Hinweis).
- **Kanonenboot** fährt wie die Lerche und hält sich querab (Breitseite). Manövrieren bricht das: Bug oder Heck zum Boot
  drehen, wenn es lädt, Ausweichen bleibt (Shift+A/D im grünen Fenster).
- **Jäger** fliegen Überflüge (Anflug → vorbei → Wende). Im Anflug schießen sie **mit Vorhalt** (QA M3b); die Taktik sieht
  die Anfluglinie gestrichelt („ANFLUG“) – Lanze früh halten, loslassen, wenn er die Bug-Linie quert.
- **Schilde:** Pool 6, kein Schildstoß. Durchlass 45/20/5/0 % (Tabelle oben). **Eskalation** nach 20 s liegengelassenem
  Schaden im Kampf, **Rückschlag** −50 % bei Hüllentreffer im Sektor der Reparatur.
- **Captain:** einmal „Bots automatisch“ (Reiter 5, A) lohnt sich zu dritt – die Schrauber reparieren dann mit, die Crew
  kümmert sich um Zerstörtes und Eskalationen.

### Wichtige `tune`-Pfade (M3a, nur mit `npm run debug`)

| Befehl (Standardwert) | Wirkung |
|---|---|
| `tune spaceM3.tele.gunboat.damage 2` (3) | schwerer Treffer des Kanonenboots schwächer → leichter |
| `tune spaceM3.tele.gunboat.dur 4` (3) | längere Ankündigung → mehr Zeit zum Wegdrehen → leichter |
| `tune spaceM3.lance.chargeTime 2` (3) | Lanze schneller voll aufgeladen |
| `tune spaceM3.lance.width 16` (10) | Lanzenstrahl breiter → trifft leichter |
| `tune spaceM3.dodgeWindow 1.2` (0,8) | größeres Ausweich-Fenster |
| `tune combat.raiderOrbit 380` (320) | Jäger kreisen weiter außen/langsamer → leichter in der Breitseite zu halten |
| `tune spaceM3.raiderFlip 0` (9) | Jäger wechseln nicht mehr die Kreisrichtung |
| `tune crewScaling.3.enemyFireInterval 2` (1,7) | zu dritt schießen Gegner seltener → leichter |
| `tune hitEffects.systemChance 0.3` (0,45) | weniger Systemschäden → weniger Laufen |
| `tune spaceM3.repair.flickTime 1` (1,5) | schneller flicken |
| `tune spaceM3.enemyHpFactor 0.6` (0,8) | Gegner fallen schneller |

### Messwerte M3a (QA 2026-10-06)

**Browser, zu dritt, Testgelände** (gemessen): drei Browserfenster (Steuer 1280×720, Taktik 1920×1080, Captain
1280×720), nur Tastatur, ohne Debug und ohne God-Mode. Gespielt hat ein QA-Skript mit Reaktionszeiten von 0,2–0,7 s. Der
Skript-Pilot kennt die Gegnerlagen sofort (als hätte die Taktik ohne Verzögerung angesagt) – **Skripte sind schneller und
sicherer als Menschen.** Zeiten = Spielzeit aus dem Server.

| Lauf (Stand der Werte) | Welle 1 | Welle 2 | Welle 3 | Welle 4 | Notfallprotokolle | Brücke verlassen | Schildstöße (perfekt) | Flicken / Minispiel / Austausch |
|---|---|---|---|---|---|---|---|---|
| Endwerte, Lauf A | 0:43 | 0:55 | 0:53 | 1:06 | 0 | 0 | 7 (1) | 0 / 0 / 0 |
| Endwerte, Lauf B | 0:20 | 2:51 | 1:01 | 1:30 | 0 | 3 | 14 (5) | 1 / 1 / 1 |
| Zwischenstände (6 Läufe) | 0:22–0:42 | 1:23–2:27 | 0:57–3:00 | 0:49–3:07 | 0–5 je Lauf | 1–6 | 11–24 (2–13) | bis 3 / 3 / 3 |

- Endwerte: im Mittel etwa **1:10 je Welle**, keine Notfallprotokolle. Teuer sind die Kanonenboot-Wellen (2 und 4): ein
  schwerer Treffer auf einen leeren Schildsektor kostet 15 Hülle. Davor (Zwischenstände) lösten 2–5 Notfallprotokolle je Lauf
  eine Kaskade aus, weil die Hülle in 12 s Pause kaum über 30 kam – deshalb flicken die Schrauber die Außenhaut jetzt schneller.
- Wer die Brücke verlässt, ist **5–31 s** weg: flicken 6–15 s, Minispiel 5–22 s, Austausch (Teil aus dem Lager holen) 20–31 s,
  je nach Weg.
- **Solo im Browser** (Endwerte, Skript pendelt zwischen Steuer und Taktik, Schrauber automatisch): Welle 1 0:58, Welle 2 3:42
  (das Kanonenboot zeigt die Breitseite mit 4er-Schilden; das Skript nutzt die Lanze kaum), Welle 3 2:07; 0 Notfallprotokolle.
- **Mission 1 an B-7 zu dritt** (Weg dorthin per Debug übersprungen, Kampf ohne Debug): Kanonenboot kündigt jede Ladung an,
  Kampf bis zum Boje-Scan 1:37, 9 Ladungen, 6 Schildstöße (5 perfekt), 0 Notfallprotokolle.

**Bot-Simulation** (`npm run sim:arena`, 10 Seeds je Strategie, zu dritt, 5 Wellen; Bots spielen fehlerfrei):

| Wert | „Nase drauf“ (nose) | Breitseite (maneuver) |
|---|---|---|
| Hüllenverlust gesamt | 160 | 20 |
| Hüllenverlust je Minute | 14,4 | 3,6 |
| Hüllenverlust je geschaffte Welle | 59 | 3,9 |
| Wellen je 10 min | 2,4 | 5,0 |
| Notfallprotokolle | 1,8 | 0 |

Breitseite lohnt sich klar (Faktor 8 gesamt, 4 je Minute). Solo ist der Bot-Vergleich nicht aussagekräftig (der Solo-Bot
mit „nose“ bleibt am Kanonenboot hängen). Die Bots sind deutlich besser als Menschen – beim Spieleabend zuerst auf die
Notfallprotokolle achten und notfalls mit den `tune`-Werten oben nachstellen.

### Messwerte M3b Schritt A (QA 2026-10-07, Details CONTRACT-M3B §9)

- **Bot-Simulation** (`npm run sim:arena`, 10 Seeds, zu dritt, 6 Wellen): „Nase drauf“ 60,7 Hülle (12/min), Breitseite 43
  (6,2/min) – Faktor 1,41 (je Minute 1,93). Kanonenboot hält gegen „Nase drauf“ 73 % Breitseite, gegen Manövrieren 42 %.
  0–0,1 Notfälle, ~2 Reparaturgänge je Lauf (Bots verteilen Schilde fehlerfrei).
- **Browser** (QA-Skript mit Menschen-Tempo: Captain reagiert nach 1–3 s, Ausweichen ~65 %): Kanonenboot + 2 Jäger
  **3:44–3:49, 100 Hülle, 2 Notfälle**; 2 Jäger 0:23–0:48 ohne Schaden; Jäger + Kanonenboot 2:11–2:16, 50–55 Hülle; Wächter
  + 2 Jäger 1:33. Kanonenboot-Wellen sind für Menschen eher zu hart als zu ruhig. Wenn es beim Probeflug kippt:
  `tune spaceM3.tele.gunboat.damage 2`, `tune crewScaling.3.enemyFireInterval 2.2`, `tune spaceM3b.escalation.after 30`.
- **Mission 1** an B-7 zu dritt (Gegner noch im alten Modell): Kampf 3:49 mit 3 Notfällen. **Beamen:** wer die Steuer auf ½
  stehen lässt, ist nach ~30 s rund 1 km von der Boje weg – erst STOPP, dann beamen.
- Lanze gegen Jäger mit Menschen-Timing ~18 % (Anfluglinie gestrichelt, Jäger quert die Bug-Linie in 1,5–3 s).

| Befehl M3b (Standard) | Wirkung |
|---|---|
| `tune spaceM3b.pilotFire.raider.lead 0` (1) | Jäger schießen ohne Vorhalt (treffen ein fahrendes Schiff kaum) |
| `tune spaceM3b.pilotFire.raider.fireInterval 4` (2,5) | Jäger schießen seltener |
| `tune spaceM3b.escalation.after 30` (20) | Eskalation später → weniger Feuer |
| `tune spaceM3b.repairHitLoss 0.25` (0,5) | milderer Rückschlag |
| `tune spaceM3b.flightV2.missions true` (false) | neues Gegner-Flugmodell auch in den Missionen |

## Claude-Bridge zuschalten (optional)

Ohne Bridge kommt der Folge-Funkspruch am Ende aus dem Archiv (6 Varianten passend zu euren Entscheidungen).
Mit Bridge schreibt Claude ihn live:

```
# .env (Vorlage: .env.example)
MISSION_SOURCE=bridge
CLAUDE_BRIDGE_URL=http://localhost:5505
CLAUDE_BRIDGE_TOKEN=<Token – nie einchecken>
CLAUDE_MAX_BUDGET_USD=0.30      # pro Aufruf; Budget pro Session: [€__]
CLAUDE_TOKEN_BUDGET=500000      # Token-Deckel pro Serverlauf
```

Ein Aufruf pro Partie (beim Finale am Kustoden-Relais). Fehler, Timeout oder falsche URL → automatisch Archiv (getestet).
Token-Deckel: höchstens 500 000 Token pro Serverlauf (`CLAUDE_TOKEN_BUDGET`), danach kommen nur noch Archiv-Missionen.
Der Teaser ist in der Demo nur Text, kein spielbarer Auftrag.

## Bekannte Grenzen

- Umfang M1: zwei Missionen und sieben Orte, keine Speicherstände (jede Partie startet frisch).
- **Kämpfe solo sind hart:** Wer allein zwischen Steuer und Taktik pendelt, verliert im Kampf an B-7 schnell Hülle
  (im Test bis 15 %). Untergehen kann man nicht – das Notfallprotokoll hält das Schiff bei 30 % (kostet 50 Marken).
- Der Pilot sieht wirklich nur nach vorn. Ohne Ansagen der Taktik sucht er Gegner oft vergeblich: Im Test hatte der
  Skript-Pilot nur mit Markern rund 10 % der Kampfzeit einen Gegner im Bild, mit zusätzlichen Ansagen („hinten rechts!“)
  gut die Hälfte. Also: Taktik, redet mit eurem Pilot!
- **Lanze (Nachrunde §20):** keine Zielphase mehr – Taste 1 halten lädt auf, Loslassen feuert sofort in Bugrichtung.
  Verlässt die Taktik beim Laden die Konsole, verpufft die Ladung. Gegen kreisende Jäger trifft die Lanze selten.
- Ein zerstörter Reaktor, der repariert wird, braucht danach den Neustart zu zweit – auch mitten im Kampf (ein Schrauber
  hilft nach 3 s am zweiten Schalter).
- Pylonen drehen sich langsam zum Schiff. Wer an der Flanke stehen bleibt, hat bald wieder ihre Schildfront vor sich.
- Spielerkollision gibt es nicht; Figuren laufen durcheinander hindurch.
- Zwei Tabs im selben Browser sind **derselbe** Spieler (gemeinsame Kennung im Browserspeicher); der neuere Tab
  übernimmt. Mitspieler brauchen eigene Geräte, einen anderen Browser oder ein privates Fenster.
- Die Hafen-Übung lässt sich nur vor dem Start in der Lobby überspringen (sonst kommt der Funkspruch spätestens nach 150 s).
- Lange Texte nutzen eine 5×7-Pixelschrift; bei kleinen Fenstern (< 1280×720) wird gebrochen skaliert – scharf, aber Pixel
  sind ungleich breit.
- Verlassen alle Spieler die Partie, wird sie nach 90 s zurückgesetzt.
- Teaser-Mission per Claude nur mit laufender Bridge (nicht im Lieferumfang).
- **Kesh (M2):** Die Archivschlüssel brauchen zwei Leute unten. Fehlt einer, geht der Captain mit runter (bis zu drei
  unten sind erlaubt). Ist nur noch **ein** Spieler verbunden, bleibt der erste Schlüssel 15 s gedreht – genug Zeit, um
  zum zweiten zu laufen.
- Eine Notrückholung aller **nach** dem Bergen der Tafel beendet die Mission (die Tafel ist ja an Bord) – entweder sofort
  über die Pads wieder runter und die Nachhut erleben, oder nach spätestens 90 s ist der Auftrag erledigt.
- Die Schilde des Außenteams gelten nur auf Kesh. „Abschüsse“ im Ende-Bildschirm zählt nur Gegner im Raum.

## Gemessene Spieldauer (M1-Stand, QA 2026-10-05)

**Gemessen:** komplette Durchläufe im echten Browser, nur Tastatur/Maus, ohne Debug-Befehle und ohne God-Mode.
Gespielt hat ein QA-Skript mit menschlichen Pausen (0,3–0,8 s je Entscheidung, Lesezeit ~40 ms je Zeichen für ODA/Funk).
Der Pilot des Skripts sieht nur, was die Frontsicht zeigt, plus die Marker. Zeiten in Spielminuten aus `stats` des Servers.

| | Solo (komplett bis Ende-Screen) | Zu dritt (komplett bis Ende-Screen) |
|---|---|---|
| Mission 1 „Die stumme Boje“ (inkl. Vaelen-Abstecher) | **17:17** | **7:52** |
| Mission 2 „Echo im Nebel“ (inkl. Wrack-Außenmission) | **19:40** | **10:43** |
| **Gesamt** | **36:57** | **18:34** |
| Entdeckungen | 7 von 12 | 8 von 12 |

Zeit je Ort (Minuten), solo / zu dritt: Hafen 5:12 / 3:17 · Splittergürtel 3:16 / 1:41 · Boje B-7 9:14 / 3:33 ·
Vaelen 4:04 / 1:53 · Wrack 2:52 / 2:20 · Graue Weite 5:37 / 1:56 · Kustoden-Relais 6:49 / 4:04

Ein zweiter Lauf zu dritt kam auf 25:32 bis zum Finale – dort kreiste der Skript-Pilot minutenlang um einen Marker
(Fehler im QA-Skript, nicht im Spiel); die 18:34 oben sind der saubere Lauf.

**Geschätzt** (nicht gemessen): Das Skript kennt jeden Weg, liest schnell, verfliegt sich nicht und „spricht“ ohne
Verzögerung (der Skript-Pilot bekommt Ansagen der Taktik sofort). Echte Spieler brauchen deutlich länger – Erwartung
**solo etwa 45–55 min, zu dritt etwa 28–35 min**. Solo liegt damit im oder über dem Ziel 30–45 min, zu dritt eher am
unteren Rand – gemessen ist der Dreierlauf klar unter 30 min.

Was die Zeit füllt (seit der QA neu): Selas Anliegen in Mission 2 (Nebelkarte kaufen oder ihre Messsonde suchen),
das Funkduell mit Grauzahn (Bluff, Teilen oder Schweigen – mit Folgen), die Prüfung am Relais (zweite Pylonwelle) und
drei zusätzliche Entdeckungen (Kustoden-Splitter an B-7, Selas Sonde, Rettungskapsel am Wrack).

## Messwerte M2 – „Die Tafel von Kesh“ zu dritt (QA 2026-10-05/06)

**Gemessen:** Wanduhr von „alle bereit“ in der Lobby bis zum Ende-Bildschirm, im echten Browser (drei Seiten:
1280×720, 1920×1080, 1366×768), nur Tastatur/Maus, ohne Debug-Befehle und ohne God-Mode. Gespielt hat ein QA-Skript:
Captain an Bord (nimmt an, wählt Kesh, führt über Reiter 6 mit Sammeln/Fokus, Sensor, Kuppel), Pilot fliegt nach
Frontsicht und beamt dann mit runter, zwei Spieler unten mit 250–400 ms Reaktionszeit, Zielstreuung (σ ≈ 7 px + 4 %
der Entfernung), Feuerstellungen hinter Deckung, Rückzug bei leerem Schild (verzögert, manchmal zu spät), Lesepausen.

| Lauf (Stand) | Dauer | Verwundet | Wiederbelebt | Notrückholung alle |
|---|---|---|---|---|
| vorsichtig, alte Werte | 5:20 | 0 | 0 | 0 |
| vorsichtig, + Verstärkung nach Relais | 5:56 | 1 | 1 | 0 |
| vorsichtig, Endwerte | 5:43 | 0 | 0 | 0 |
| unvorsichtig (kein Rückzug, Deckung zweitrangig), Endwerte | 4:33 | 5 | 3 | 1 |

Etappen (vorsichtig, Endwerte): Briefing+Flug 0:51 · Hof 1:07 · Halle mit Relais und Schlüsseln 0:53 · Tafel 0:14 ·
Wächter + Trupp 2 1:30 · Nachhut und Hochbeamen 1:08. Erste Verwundung: vorsichtig keine im Hof, unvorsichtig nach 38 s.
Fehlerzähler Client/Server in allen Läufen 0. Bot-Simulation (`node tools/sim-headless.js m3`): 2,7–3,4 min.

**Geschätzt** (nicht gemessen): Das Skript kennt Karte, Schlüssel und Wege, liest schnell, spricht sich nicht ab und sieht
jeden Gegner sofort. Erstspieler brauchen allein für Funk, Sternkarte, Sprung und Transferkammer 2–3 min statt 1, für das
Finden und gemeinsame Drehen der Schlüssel 1,5–2,5 min. Erwartung zu dritt: **etwa 9–12 min** – am unteren Rand des
Ziels 10–14 min. Wird es zu kurz oder zu leicht, helfen `tune`-Werte (oben); Verwundungen werden bei Menschen
häufiger sein als beim disziplinierten Skript.

## Für Entwickler

`npm run check` (Karten), `npm run sim` (Headless-Durchlauf solo, zu dritt und solo mit übersprungener Übung), `npm run debug` (Debug-Befehle, `?debug=1`
im Client: FPS, Ping, Fehlerzähler, Hitboxen; F6 = Stage überspringen), `node tools/test-features.js`,
`node tools/ws-smoke.js`. Vertrag: `CONTRACT.md`, Ausbaustufe 2: `CONTRACT-M0.md`, M1: `CONTRACT-M1.md`, M2: `CONTRACT-M2.md`.
M2: `npm test` = `test-features` + `test-combat` (Kampf v2), `node tools/sim-headless.js m3 [--seed n]` (Bot-Lauf
Planetenmission zu dritt). Debug: `kesh`, `squad 1|2|rear`, `wake`, `shield <n>`, `wound`, `tune …`, `mission m3 <schritt>`.
Im Debug-Overlay zeigt eine Konsole nur eine kompakte Zeile oben (FPS, Ping, Fehler, Schritt).
Debug-Befehl für das Lager (nur Debug-Server): `__game.debugCmd('inv', { item: 'bolzen', n: 0 })`.
Tests starten den Server mit festem Code (`ws-smoke.js`) bzw. ohne Code (`Game` direkt).
M3a: `npm test` = `test-features` + `test-combat` + `test-m3`; Vertrag `CONTRACT-M3.md` (QA-Nachträge §19).
`npm run sim:arena` = `node tools/sim-headless.js arena --pilot both --seeds 10` (Strategievergleich nose/maneuver im
Testgelände; weitere Optionen `--players 1`, `--waves n`, `--wave-limit s`, `--max s`). Debug zusätzlich: `damage <system> <zustand>`
für alle 14 Systeme, `fragile <system>`, `tele [id]`, `burst <sektor>`, `tune spaceM3.<pfad> <wert>` (seit QA M3a
gehen mit `tune` auch andere Konfig-Pfade wie `combat.raiderOrbit` oder `crewScaling.3.enemyFireInterval`).

### Server ab M1 (Team SERVER)

- `npm run check` prüft Schiff, B-7-Plattform, Wrack „Zaunkönig“ und den Ortsgraphen (`shared/locations.js`).
- `npm run sim` spielt Mission 1 **und** Mission 2 headless mit echten Befehlen: solo, zu dritt und solo ohne Übung
  mit Wrack-Abstecher. Optionen: `1`/`3`, `--seed N`, `--wreck`, `--verbose`. Ausgabe: Dauer je Mission, Schritt und Ort.
- Missionen sind Daten: `server/missions/m1.js`, `m2.js`; die Engine (`server/sim/mission.js`) kennt Bedingungen wie
  `atLocation`, `enemiesLeft`, `scanDone`, `itemAboard`, `flag`, `choiceMade`, `event`, `elapsed` und Aktionen wie
  `radio`, `oda`, `spawn`, `choice`, `reveal`, `reward`, `setFlag`, `after`, `goto`, `complete`.
- Spielzeit pro Mission/Schritt/Ort steht im Snapshot unter `stats.missions`, `stats.stages`, `stats.locations`
  (Spielsekunden) und wird in `data/campaign.json` mitgeloggt.
- Debug-Befehle (nur `npm run debug`), z. B. im Browser-Konsole mit `__game.send({ t: 'debug', cmd: … })`:
  `goto {loc, docked?}`, `reveal {loc|'all'}`, `mission {id: 'm1'|'m2', step}`, `reactor {state: 'online'|'overload'|'offline'}`,
  `scanall`, dazu weiter `stage {stage}` (Schritt-ID), `skip` (aktuellen Schritt erfüllen), `damage {system, state}` (auch `offline`),
  `spawn {kind}` (auch `sentinel`, `pylon`), `fire`, `breach`, `marks {n}`, `inv {item, n}`, `hull {n}`, `god {on}`.
