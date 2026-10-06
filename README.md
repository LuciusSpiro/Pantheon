# Sternenschicht – M1 „Die stumme Boje“ / „Echo im Nebel“ · M2 „Schildwall“ (Planetenmission „Die Tafel von Kesh“)

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
   langsam werden (unter 30).
5. Die zwei vom Außenteam gehen in die Transferkammer (unten links an Bord), stellen sich auf die Pads und halten **E**.
   Der Captain bleibt oben, wechselt auf **Reiter 6 „Außenteam“** und führt von dort.
6. Ende: Ende-Bildschirm „Die Tafel ist sicher“ mit Spielzeit. Danach könnt ihr frei weiterfliegen.

Erwartete Dauer zu dritt: siehe „Messwerte M2“ unten.

## Testgelände (solo)

Zum gezielten Ausprobieren der Kampfbereiche, ohne eine Mission durchzuspielen – geht solo und zu dritt, auch ohne `--debug`.

1. `npm start`, Link öffnen. In der Lobby schaltet **M** reihum: „Kampagne“ → „Direkt zur Planetenmission“ →
   **„Testgelände: Raumkampf“** → **„Testgelände: Außenteam“** (Anzeige „START (n/4)“). Dann **Enter** = bereit.
2. **Raumkampf:** Start sofort an Boje B-7 (keine Brocken), abgelegt, alle auf der Brücke (solo neben dem Steuer,
   zu dritt neben Steuer / Taktik / Captain). Zielanzeige „Welle n“. Wellen: 2 Jäger → Jäger + Kanonenboot →
   Kustoden-Wächter + 2 Jäger, danach wieder von vorn; die nächste Welle kommt 12 s nach der Räumung (ODA sagt an).
   Schaden, Bots, Notfallprotokoll, Schildsektoren, Phasenkanonen, Scan/Weitscan und Reaktor überladen wie im Spiel.
   Solo: am Steuer fliegen, mit Esc + E zur Taktik wechseln (zwei Schritte nach links oben). Kein Ende-Bildschirm.
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
| **Taktik** | Taktik (`W`, früher „Waffen“) | weite Taktikkarte, 2 Phasenkanonen, **Ziel-Scan** (Schilde und Feuerbögen der Gegner), **Weitscan** (versteckte Dinge), Marker für den Pilot. Lotst den Pilot an. |
| **Captain** | Captain (`C`) | Funk und Entscheidungen, Sternkarte/Sprungziele, Lage-Karte mit Captain-Marker, Energie & Schilde (auch **Reaktor überladen**), Schäden, Außenteam-Hilfe. |

Allein geht alles auch: zwischen den Konsolen hin- und herlaufen. Unbesetzte Taktik feuert mit halber Kraft automatisch,
unbesetzte Steuer hält Kurs und Tempo. Die drei **Schrauber** reparieren, löschen und flicken selbst.

## Steuerung

| Wo | Tasten |
|---|---|
| Laufen | WASD / Pfeile · **E** interagieren (Reparieren, Löschen, Flicken, Beamen, Container, Schalter: **E halten**) · **G** ablegen · **Tab** Crew-Status · **Esc** Konsole verlassen |
| Steuer (Frontsicht) | A/D lenken · W/S Schub · Shift+A/D Ausweichrolle · F Faltsprung (wenn der Captain ein Ziel gewählt hat) |
| Taktik | T nächstes Ziel (oder anklicken) · **1/2** Phase L/R · **Leertaste** beide Phasen · 3 Bolzen · 4 Seitenturm (nach Kauf) · **S halten** Ziel-Scan · **W** Weitscan · **M** Marker aufs Ziel · **Rechtsklick** Marker setzen · **X** Marker löschen · **Z**/+/− Zoom · **O** Orbitalschlag (Außenmission) |
| Captain | **1–6** Reiter: 1 Funk (Enter annehmen, Q/W/E Antwort) · 2 Sternkarte (←/→ Ort, Enter Sprungziel) · 3 Lage (Linksklick Captain-Marker, X löschen, **Leertaste halten = Scan**) · 4 Energie & Schilde (↑/↓ Zeile, ←/→ verteilen, **U → J Reaktor überladen**, N abbrechen) · 5 Schäden (↑/↓, Enter Priorität) · 6 Außenteam (Codetabelle, S Sensor, K Schildkuppel) |
| Planungstisch (Messe, `Y`) | E am Tisch setzen (bis zu 3 gleichzeitig) · **1–5** Pin-Art (Ziel, Gefahr, Landeplatz, Treffpunkt, Frage) · **Klick** Pin setzen (auf einem Ort: **Shift+Klick**) · Rechtsklick eigenen Pin entfernen · ←/→ Ort · **Enter** Detailkarte · **D** Decksplan (B-7/Wrack) · **Backspace** zurück zur Sternkarte · Esc aufstehen |
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
