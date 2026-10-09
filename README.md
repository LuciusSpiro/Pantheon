# Pantheon – Ausbaustufe S2b „Spielleiter live tauglich + Kampf nach Kais Runde“

Gemütliches Online-Koop-Raumschiff für 1–3 Spieler im Browser. Ein kleiner Node-Server führt die
Partie, jeder spielt im eigenen Browserfenster. Kein Game Over – man scheitert mit Würde.

Das Spiel hieß bis S1 „Sternenschicht“ (Arbeitstitel); der Repo-Ordner heißt weiter `sternenschicht/`. Bisherige
Ausbaustufen: M1 „Die stumme Boje“ / „Echo im Nebel“ · M2 „Schildwall“ (Planetenmission „Die Tafel von Kesh“) ·
M3a „Breitseite & Schaden“ · M3b Schritt A „Ein Flugmodell für alle“ · M4 „Voxel & Lerche Rom“ · S1 „Regiebuch &
Weltstand“ (`CONTRACT-S1.md`) · S2 „Spielleiter an der Missionsgrenze“ (`CONTRACT-S2.md`) · **S2b „Spielleiter live
tauglich + Kampf nach Kais Runde“** (Vertrag `CONTRACT-S2B.md`).

## Neu in S2b – zähere Gegner, Sperrfeuer, Spielleiter günstiger

Nach Kais erster S2-Runde („sieht echt gut aus“, aber Gegner zu schwach) und mit dem Ziel, den Spielleiter wirklich live zu
benutzen.

### Kampf
- **Jäger 3× zäher:** 36 statt 12 Hülle (Crew-Skalierung wie bisher: zu dritt/zu zweit × 0,7, solo × 0,5). Eine volle Salve
  (Lanze voll + beide Batterien) zerstört einen Jäger zu zweit/zu dritt nicht mehr, spätestens die dritte schon (Test). Der
  Lebensbalken über dem Gegner ist in Segmente geteilt, damit man den Fortschritt sieht.
- **Kanonenboot:** Der angekündigte Ladeschuss bleibt (Schaden 3 → 4). Neu ist das **Sperrfeuer**: Feuerstöße aus der
  Breitseite (3 bernsteinfarbene Bolzen, etwa alle 3 s), **langsam** (110 px/s, die Lerche ist schneller) und **ausweichbar** –
  es zielt dorthin, wo die Lerche bei gehaltenem Kurs sein wird. Wer stehen bleibt oder stur geradeaus fliegt, wird getroffen;
  ein Kurs- oder Tempowechsel bzw. die Ausweichrolle in den ~3 s Flugzeit bringt den Stoß vorbei. Während ein Ladeschuss lädt,
  schweigt das Sperrfeuer (lesbar halten). Lanze/Batterien können die Bolzen nicht abschießen. Volle Schilde fangen das meiste.
- **Kollisionsbahn:** Jeder Bolzen zieht eine kurze Bahnvorschau; liegt die Lerche auf Kollisionskurs, wird sie rot-orange mit
  Kreuz – das ist das Signal für die Steuer. Mündungsblitz an der Breitseite, eigener dumpfer Ton (`sperrfeuer`).
- **Brandschutz-Flutung:** Brennt es außerhalb des Kampfs an mindestens 4 Stellen 45 s lang ununterbrochen, flutet ODA und
  löscht alles (Softlock-Schutz nach langen Gefechten). **Eskalationsdeckel:** Unbearbeitete Schäden zünden ab 3 Bränden
  kein weiteres Feuer mehr (vorher Feuerspirale nach längeren Gefechten).
- Schützling-Härte: Havarist, Pannenhilfe und „Karawane im Nebel“ wurden nach den zäheren Jägern über die Katalog-Startwerte
  nachgezogen (siehe Messwerte).

### Spielleiter
- **Plan-treue Rohfassung:** Auch ohne ausgearbeitete Szene funken nur NSC, die zur Mission gehören (Auftraggeber, Besetzung,
  `stimme` je Szene) – kein „Sela funkt in Grauzahns Mission“ mehr. Prüfregeln für Sprecher und für Erinnerungen, die den
  Fakten widersprechen.
- **Szenen günstiger:** Eine Szene kostet jetzt **≈ 3 700–4 700 Tokens** (vorher ≈ 24 000), ein Grobplan-Versuch ≈ 12 500–17 000.
  Eine voll ausgearbeitete Mission mit 4–5 Szenen liegt damit bei rund **45 000 Tokens** (mit einem zweiten Grobplan-Versuch).
- **Szenen öfter gültig:** Selbstprüfung im Prompt, automatische Reparatur einfacher Fehler, zweiter Versuch mit den
  Prüferfehlern. Beim Annehmen werden die ersten Szenen sofort angefragt; die Szenen kamen in den Live-Läufen alle vor dem
  Anflug an – `sceneWait` („Kurs wird berechnet …“) trat nicht auf.
- **Wartepunkt „Ablegen“:** Szenen mit Kampf an Hafen-/Händlerorten beginnen erst, wenn die Lerche abgelegt hat (auch nach dem
  Laden eines Weltstands).
- **Golden-Basis neu:** Weil die stärkeren Jäger und das Sperrfeuer auch im Tutorial gelten, wurde der Golden-Trace m1–m3 bewusst
  neu aufgenommen (alte Basis: `tools/fixtures/golden/base-s1/`); vorher geprüft: gleiche Schrittfolge, nur Kampfdauer/Hülle anders.
- Debug: `sl plan [npc] [Vorgabe …]` fordert einen Grobplan mit vorgegebenem Auftraggeber an (nur `--debug`).

### Messwerte S2b (QA-Abnahme 2026-10-08) – ehrlich, Bots ≠ Menschen
- **Sperrfeuer ausweichen** (headless, nur ein Kanonenboot ohne Ladeschuss, zu dritt, 3 × 60 s je Fahrweise): Lerche steht –
  93 % getroffen, ≈ 43 Hülle/min; hält Kurs (½) – 89 % getroffen, ≈ 16 Hülle/min; weicht aus (Kurswechsel/Ausweichrolle bei
  anfliegendem Stoß) – 35 % getroffen, < 1 Hülle/min. Im Browser (solo, Welle Kanonenboot + 2 Jäger, je 30 s): stehen −51 Hülle,
  ausweichen −19 Hülle (inkl. Jäger und Ladeschüssen).
- **Arena (Bots, 10 Seeds):** „Nase drauf“ verliert 1,83× so viel Hülle wie „Manöver“ (Ziel ≥ 1,4).
- **Schützling (Bot-Sim, 30 Seeds je Fall):** Geleit zu dritt 83 % heil, solo 50 % heil; Havarist zu dritt 23 % verloren,
  solo 0 %; Pannenhilfe zu dritt 20 % verloren, solo 0 %. Archiv „Karawane im Nebel“ (10 Seeds) solo 9/10 heil, zu dritt 9/10.
- **Live-Spielleiter:** siehe nächster Abschnitt.

### Live-Messung S2b (QA-Abnahme, 175 000 Tokens von 200 000 Budget)
- **Szenen:** 14 Live-Szenen (15 Aufrufe) – 13 gültig beim ersten Versuch, 1 beim zweiten (100 % bis zum 2. Versuch).
  Tokens je Szene: Median ≈ 3 740, höchstens 4 670 (Ziel < 8 000). Dauer 7–17 s.
- **Grobpläne:** 8 Aufrufe, je ≈ 12 500–17 000 Tokens, 33–57 s. **Der erste Versuch war in allen 4 Planungen ungültig**
  (zweimal Dauer zu lang, zweimal „neutrale“ Erinnerung, obwohl es Fakten gab; einmal kannte der Kontext keine
  Gedächtnis-Kennungen – behoben), der zweite gültig in 3 von 4. Ein Grobplan kostet also in der Praxis ≈ 27 000–31 000 Tokens.
- **Im Spiel zu dritt (2 Läufe, Kampagne ohne Tutorial):** Angebot nach 80–90 s, Szenen kamen 9–48 s nach dem Annehmen,
  alle vor dem Anflug – **kein `sceneWait`**. Lauf 1 (Tesk, „Signal in der Grauen Weite“): eine fertige Szene wurde vom
  Spiel abgelehnt („schon betreten“), weil sich die Flag-Rücksetzung im Hafen-Schritt änderte – **behoben**; Lauf 2 (Sela,
  „Sicheres Geleit durch die Graue Weite“, Geleit mit Karawane): alle gespielten Szenen ausgearbeitet, Ausgang „erfolg“.
  Gespielt wurde mit menschlichen Pausen (40–75 s je Schritt) und Debug-Skip am Ende jedes Schritts – das sind **keine**
  Menschen-Spielzeiten und kein echter Kampf.
- **Erzeugte Missionen zum Review** (`npm run missionen`): „Die Antwort des Relais“ (Tesk), „Signal in der Grauen Weite“
  (Tesk), „Sicheres Geleit durch die Graue Weite“ (Sela, mit Geleit) – Status `offen`. Melk, Grauzahn und „melk-klausel“
  wurden aus Budgetgründen **nicht** aufgenommen.

## Neu in S2 – Spielleiter, Schützling, Missionen reviewen

Nach dem Tutorial (bzw. sofort bei „Kampagne ohne Tutorial“) geht die Kampagne weiter: Ein **Spielleiter** (Claude Sonnet über
die Claude-CLI) plant neue Missionen aus den Bausteinen des Katalogs, ein Prüfer kontrolliert sie, und ein **Archiv** springt
ein, wenn etwas schiefgeht. Das Spiel wartet nie auf das LLM.

### Wie Angebote entstehen
- **Am Planungstisch → Missionsbuch** (Taste M) stehen unter **ANGEBOTEN** je Missionsgrenze bis zu **3 Angebote**: 2 vom
  Spielleiter und 1 aus dem Archiv. Das Archiv-Angebot ist ab Sekunde 0 da – es gibt also immer etwas zu tun.
- Solange der Spielleiter plant, steht dort „Hafenmeisterei · Lage wird geprüft“ mit einem Siegel in drei Prägestufen, im HUD
  dezent „Funk: Hafenmeisterei berät …“. Kein Countdown. Neue Angebote bekommen einen Bernstein-Punkt („NEU“).
- Jedes Angebot zeigt Absender, Ziel, Dauer, Belohnung und eine **Erinnerung** des Auftraggebers („Grauzahn hat mitgehört …“).
  Was ihr in einer Mission entscheidet, landet im Gedächtnis der NSC und in der Chronik und fließt in die nächste Planung ein.
- **Enter** nimmt an, **Entf** lehnt ab (ohne Malus, nur ein leichter Gedächtnis-Eintrag beim Auftraggeber). Für ein
  abgelehntes Angebot plant der Spielleiter ein neues. Angebote laufen nicht ab.
- Ob ein Angebot erzeugt oder aus dem Archiv ist, sehen Spieler nicht; nur mit `?debug=1` steht `[SL]` bzw. `[AR]` davor.
- **Archiv:** vier handgeschriebene Missionen („Zollfeuer“ – Tesk, „Karawane im Nebel“ – Sela, mit Geleit, „Abschrift von
  B-7“ – Melk, „Treibgut Zaunkönig“ – Grauzahn) plus alle erzeugten Missionen, die Kai freigegeben hat (siehe unten).
  Gespielte Archiv-Missionen kommen erst wieder, wenn alle durch sind.
- **Szenen kommen nach:** Angeboten wird eine vollständige **Rohfassung** (spielbar, mit Standardtexten der Bausteine). Die
  ausgearbeiteten Szenen fragt der Spielleiter kurz vorher an und ersetzt die Rohfassung, solange die Szene noch nicht
  betreten ist. Ist eine Szene beim Anflug noch nicht fertig: höchstens **20 s** „Kurs wird berechnet …“ (ODA-Zeile, die Steuerung
  bleibt frei), dann spielt die Rohfassung.
- **Kapitelkarte:** In der Kampagne endet „Die Tafel von Kesh“ (m3) nicht mehr mit dem Ende-Bildschirm, sondern mit der Karte
  „Kapitel abgeschlossen“ (**Enter** = weiterspielen); danach kommen die Angebote. Der Direktstart der Planetenmission endet
  wie bisher.

### Schützling (zu schützende NSC-Schiffe)
- Drei Klassen: **Frachter** (Konkordat), **Karawane** (Vaelen), **Bergungsboot**. Eisblau mit Messing, gestrichelter
  Schutzring, Segmentbalken über dem Schiff, oben mittig „SCHÜTZLING · Name ▮▮▮▯“. Notruf: Der Ring pulsiert Eisblau →
  Bernstein; außerhalb des Bildes zeigt ein Ring-Pfeil am Rand, wo er ist.
- **Captain-Befehle** (Captain-Konsole, Reiter Lage **3**): **H** Halten · **F** Folgen · **V** Volle Kraft · **D** Andocken.
  Ob und wie schnell der Schützling gehorcht, hängt von der Haltung des NSC zur Lerche ab (gut: sofort, neutral: nach 2 s,
  schlecht: nach 4 s mit Murren). Die Rückmeldung steht in der Captain-Konsole.
- **Jeder Angriff auf den Schützling wird angekündigt** („Kanonenboot lädt auf …“). Auf der Captain-Karte zeigen rot
  gestrichelte Linien „ZIELT AUF …“, welcher gescannte Gegner wen anvisiert.
- **Breitseite als Schild:** Stellt sich die Lerche zwischen den Ladenden und den Schützling und hat auf der Seite Schild
  (≥ 1), fängt sie die Ladung ab („Abgefangen! Die Lerche deckt …“).
- Kein Eigenbeschuss: Lanze und Batterien treffen Schützlinge nicht (geht die Lanze durch ihn, gibt es einen Funk-Rüffel).
- Verlust ist kein Game Over: Ein Schützling mit Hülle 0 ist kampfunfähig und treibt; die Mission läuft mit einem anderen
  Ausgang weiter. Benannte NSC sterben nie (höchstens „schwer beschädigt“).

### Missionen reviewen (für Kai)
Jede Mission, die der Spielleiter live erzeugt, wird dauerhaft abgelegt: `content/spielleiter/erzeugt/<datum>_<kennung>/`
mit `mission.md` (lesbare Fassung) und `mission.json` (spielbar). Details: `content/spielleiter/erzeugt/README.md`.
1. `npm run missionen` – Liste mit Status, Titel, Quelle, Auftraggeber, wie oft gespielt.
2. `npm run missionen -- zeigen <ordner>` oder die `mission.md` öffnen: Pitch, Erinnerung, je Szene Ort, Baustein, Ziele,
   alle Funk-/ODA-Texte, Entscheidungen, Ausgänge, Prüfer-Warnungen und „Gespielt“.
3. Im Frontmatter `status: offen` → `angenommen` (oder `abgelehnt`) – oder `npm run missionen -- annehmen <ordner>`.
4. **Angenommene Missionen vergrößern den Vorrat** der Standard-Missionen (wie das Archiv), ab dem nächsten Serverstart.
   Offene und abgelehnte werden nie angeboten. Anmerkungen gehören unter `## Notizen`.

### Live-Spielleiter einschalten
Ohne Schalter spielt nur das Archiv (kostet nichts). Live braucht **beide** Einträge in der `.env` und die Claude-CLI (Abo):
```
SPIELLEITER_LLM=live
LLM_LIVE=1
CLAUDE_TOKEN_BUDGET=500000     # ein Zähler für den ganzen Serverlauf; danach nur noch Archiv bzw. Rohfassung
```
Fehlt die CLI, kommt ein Fehler, ein Timeout oder ist das Budget fast leer (< 30 000), fällt der Spielleiter still auf
Archiv bzw. Rohfassung zurück. **Kosten (gemessen S2b):** ein Grobplan-Versuch ≈ 12 500–17 000 Tokens (oft braucht es zwei),
eine Szene ≈ 3 700–4 700 Tokens – eine voll ausgearbeitete Mission mit 4–5 Szenen liegt bei rund 45 000 Tokens. Achtung: Je
Missionsgrenze plant der Spielleiter 2 Angebote (2 Grobpläne). Mit dem Deckel von 500 000 reicht ein Serverlauf für etwa
6–8 Missionsgrenzen. (S2 vorher: Szene ≈ 24 000, Mission ≈ 150 000.)

### Regie-Logbuch
Was der Spielleiter getan hat (Grobpläne, Szenen, Rückfälle, Wartezeiten, Tokens, Wunschliste fehlender Bausteine), steht je
Weltstand in `data/regie/<weltId>.jsonl` (anderer Ordner: `REGIE_DIR`). Lesbar: `npm run regie -- <weltId>` (die Welt-ID
steht im Dateinamen unter `data/worlds/`).

### Messwerte S2 (QA-Abnahme 2026-10-08) – ehrlich
- **Bots sind keine Menschen.** Archiv-Missionen dauern mit Bots 2,5–3,3 min (Ziel 15 min zu dritt) – Menschenzeiten sind
  **nicht gemessen**, Kai bewertet sie beim Spieleabend.
- **Geleit (Bot-Sim, 10 Seeds):** zu dritt 80 % heil, solo 60 % heil (im Ziel). Pannenhilfe zu dritt 3/10 verloren (härter als solo).
- **Live-Spielleiter (ein Lauf zu dritt im Browser, Kampagne ohne Tutorial):** Planung sichtbar, 2 Spielleiter-Angebote nach
  73 s bzw. 126 s, Archiv-Angebot ab Sekunde 0. Beide Grobpläne gültig beim ersten Versuch (je ≈ 26 000 Tokens, 54–63 s).
  Die Szenen sind aber **nicht** live angekommen: Szene 2 zweimal vom Prüfer abgelehnt, Szene 3 war gültig, aber erst fertig,
  als die Crew sie schon betreten hatte (Szenen laufen nacheinander durch einen CLI-Prozess; die zwei Versuche für Szene 2
  hielten sie auf), Szene 4/5 am Budget-Deckel des Testlaufs. Gespielt wurde also der live erzeugte Grobplan in der **Rohfassung**
  (mit Debug-Skip im Kampf). Die Rohfassung nutzt Standardtexte der Bausteine – dabei funken z. B. Sela oder Grauzahn
  Sätze, die nicht zur geplanten Geschichte passen. `sceneWait` trat in diesem Lauf nicht auf (Test: höchstens 20 s).
- **Grobplan-Trefferquote live:** vor der Prompt-Nachschärfung 0 von 4 Versuchen gültig (JSON mit „…"-Anführungszeichen,
  unerreichbare Ausgänge, Ortsbindung, Tutorial-Bezug), danach 2 von 2. Zu wenige Versuche für eine belastbare Quote.

## Neu in S1 – Hauptmenü, Weltstände, Spielmenü

Spielerisch ändert sich nichts. Neu ist: Die Kampagne lässt sich **beenden und später fortsetzen**, es gibt ein
**Spielmenü** (Esc) mit Optionen, und das Tutorial (m1–m3) läuft aus **Regiebüchern** (reines JSON, siehe Entwickler-Abschnitt).

### Lobby = Hauptmenü
- **M** schaltet den Start reihum (jeder darf, alle sehen es): **Kampagne** (mit Tutorial, Hafen-Übung) → **Kampagne ohne
  Tutorial** (frei ab Hafen Lichtkordon, m1–m3 gelten als erledigt, Tesk funkt nach ein paar Sekunden das Gerücht über die
  Tafel; Startmarken = `CONFIG.campaign.skipTutorialMarks`, zurzeit 150) → **Direkt zur Planetenmission** → **Testgelände:
  Raumkampf** → **Testgelände: Außenteam**. Dann alle **Enter** = bereit.
- Block **WELTSTAND** links: „Neu: Kampagne“ oder „Fortsetzen: Lerche · 08.10.“ mit Spielzeit, Ort und Mission darunter.
  **F** öffnet die Liste: je Stand Name, wann gespeichert, Ort, Mission/Schritt, Crew, Spielzeit. **W/S** wählen, **Enter**
  übernehmen („+ Neue Kampagne“ steht oben), **Entf 1 s halten** löscht (kurz tippen löscht nicht). Ist ein Stand gewählt,
  ist die Startauswahl (M) ausgegraut („Entfällt beim Fortsetzen“) – für einen anderen Start erst in der Liste „Neue Kampagne“ wählen.
- Nach **Partie beenden** ist der gerade gespielte Stand schon vorausgewählt; Enter (alle) setzt ihn fort.
- **O** öffnet die Optionen auch in der Lobby.

### Weltstände (Speichern und Laden)
- Nur die **Kampagne** (mit oder ohne Tutorial) hat einen Weltstand. Testgelände und Direktstart der Planetenmission legen
  **nie** einen an.
- **Gespeichert wird automatisch:** direkt nach dem Start einer neuen Kampagne, beim **Andocken** (Hafen, Vaelen), solange
  angedockt höchstens alle 10 s bei Änderungen, beim **Abschluss einer Mission** und bei „Partie beenden“, wenn angedockt.
  Unten links erscheint dann kurz das Siegel „Weltstand gesichert · <Ort>“. Im Kampf und unterwegs wird nicht gespeichert:
  Wer ohne Dock beendet, verliert den Fortschritt seit dem letzten Andocken (das Menü warnt vorher).
- **Was mitkommt:** Marken, Lager, Ausbauten, Deko und Quartiere, Pins am Planungstisch, Hülle und Systemschäden, bekannte und
  besuchte Orte, Funde, Flags und Entscheidungen, Missionen, NSC-Gedächtnis (z. B. was Grauzahn von euch hält), Chronik,
  Spielzeit. **Nicht:** Positionen, Gegner, Feuer/Lecks, Reaktor, Schildverteilung. Beim Laden liegt das Schiff angedockt am
  gespeicherten Ort, und der gespeicherte Missionsschritt beginnt neu (die m1-Nachhut kommt nach dem Laden nicht noch einmal).
- **Höchstens 5 Stände.** Wer bei 5 Ständen „Neu“ startet, bekommt den Löschdialog (ältester vorausgewählt).
- Name: „Lerche · TT.MM.“; ein zweiter Stand vom selben Tag heißt „Lerche · TT.MM. (2)“ usw.
- Ablage: `data/worlds/` (nicht eingecheckt), anderer Ordner mit `WORLD_DIR=...` (z. B. in der `.env`). Je Stand
  `<id>.json` und die Sicherung `<id>.bak.json`. Eine beschädigte Datei wird beiseitegelegt (`<id>.kaputt-<zeit>.json`); gibt es
  eine gültige `.bak`, wird sie benutzt, sonst steht der Stand mit ⚠ und Grund in der Liste (löschen geht).
- **Zwei Runden gleichzeitig** = zwei Serverprozesse (anderer `PORT`). Ein geöffneter Stand ist per Sperrdatei (`<id>.lock`)
  belegt: Der zweite Server zeigt ihn mit ⚠ „In einer anderen Runde geöffnet“ und lässt ihn weder laden noch löschen.

### Spielmenü (Esc) und Optionen
- **Esc** wirkt der Reihe nach: Ende-Bildschirm schließen → Minispiel abbrechen → Konsole verlassen → Crew-Übersicht (Tab)
  schließen → **Menü** auf/zu. Menü: Weiterspielen · Optionen · Steuerung · **Partie beenden**.
- **Partie beenden** darf jeder; es fragt nach („Für alle beenden?“) und bringt **alle** zurück in die Lobby. Die anderen sehen
  „<Name> hat die Partie beendet“. Angedockt heißt es „Der Weltstand wird gesichert“, sonst „Fortschritt seit dem letzten
  Andocken geht verloren“.
- **Pause** nur solo: Ist genau ein Spieler verbunden, hält das offene Menü das Spiel an. Zu zweit oder zu dritt läuft es weiter.
- **Optionen** (je Spieler im Browser gespeichert): Lautstärke, Stumm, Darstellung Voxel/2D (wie F8), Vollbild.

`npm run check-missions` prüft die Regiebücher, `npm test` enthält jetzt auch die Regiebuch-, Weltstand- und
Spielleiter-Tests (Details unten unter „Für Entwickler – S1“).

## Spieleabend – Kurzanleitung (Planetenmission zu dritt)

1. `cd sternenschicht` · `npm start` (oder `npm run debug`, wenn ihr live nachjustieren wollt – siehe `tune` unten).
   Die Konsole zeigt **Raumcode** und Link.
2. Übers Internet: zweites Fenster `cloudflared tunnel --url http://localhost:3300`, die `trycloudflare.com`-Adresse
   mit `?code=XXXX` teilen (Details unter „Übers Internet spielen“).
3. Lobby: Name eintippen, **M** schaltet den Start um, bis „**Direkt zur Planetenmission**“ dasteht (jeder darf;
   ist links ein Weltstand gewählt, erst mit **F** „Neue Kampagne“ wählen), dann alle **Enter** = bereit.
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

1. `npm start`, Link öffnen. In der Lobby schaltet **M** reihum: „Kampagne“ → „Kampagne ohne Tutorial“ → „Direkt zur
   Planetenmission“ → **„Testgelände: Raumkampf“** → **„Testgelände: Außenteam“** (Anzeige „START (n/5)“). Dann **Enter** =
   bereit. Testgelände legen keinen Weltstand an.
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

## Voxel-Ansicht (M4 „Lerche in Voxel“, Stufen 1, 2, 4)

### Einschalten
- **Standard ist die Voxel-Ansicht** (Kai, 2026-10-07). Im Spiel schaltet **F8** zwischen 3D und 2D um, die Wahl merkt sich der Browser.
- `?render=2d` erzwingt die gewohnte 2D-Ansicht, `?render=voxel` die 3D-Ansicht.
- Nähert man sich einem System, steht sein Name daneben (ohne Bedienoption, solange es heil ist). So lernt man, was was ist.
- **Zoom:** Mausrad oder `+`/`-`. Es gibt zwei Stufen, nah (Standard) und weit.
- Fehlt WebGL, geht der Grafikkontext verloren oder scheitern drei 3D-Bilder in Folge, schaltet das Spiel von selbst auf 2D und zeigt einmal einen Hinweis.
- Läuft der Rechner 10 s lang unter 25 fps, schaltet die Ansicht auf **Sparmodus** (ohne Schatten und Glühen, geringere Auflösung). Erzwingen lässt er sich mit `&quality=low`, die volle Qualität mit `&quality=high`.

### Was 3D ist und was 2D bleibt
- **In 3D:** alle Bereiche, in denen ihr als Figur herumlauft. Das sind das Schiffsinnere auf beiden Decks und die Außenmissionen (Plattform B-7, Wrack „Zaunkönig“, Kesh). Figuren, Bots, Ivo, Gegner, Feuer, Lecks, Funken, Löschstrahl und Beamen sind ebenfalls 3D.
- **Bleibt 2D:** HUD, alle Konsolen und Minispiele, Lobby, Sternkarte, Planungstisch-Ansichten, Raumkampf und die Frontsicht des Piloten.
- **Stationen zeigen ihren Zustand am Modell.** Der Lichtring (Statuskrone) ist bei „ok“ in der Farbe der Seite, bei „beschädigt“ gelb, bei „zerstört“ rot, bei „geflickt“ orange und bei EMP eisblau. Dazu kommen ein offenes Paneel, fehlende Teile, ein Band quer und Bögen; bei „brennt gleich“ glimmt der Boden.
- Namen, Zustandsmarken, Fortschrittsbalken und Interaktionshinweise liegen weiter als 2D-Schrift über der 3D-Szene. Interaktionshinweise stehen in 3D **über** dem Objekt, damit sie die eigene Figur nicht verdecken.

### Zwei Decks, Lift und Leiter
- **Deck I – Systemdeck:** Antrieb (links), Lager und Vorraum mit Notleiter, Transferraum mit Pads, Maschinenraum mit Reaktor, Batterien Backbord/Steuerbord, Gang, Brücke (rechts) mit Planungstisch und Lift. Feuer, Lecks und Schäden gibt es nur hier.
- **Deck II – Privatdeck:** vier Quartiere, Messe mit Shop-Terminal, Lararium, Liftvorraum, großes Atrium, Krankenstation (Kulisse), Bad und Aussichtsraum. Im Gefecht ist man hier sicher.
- **Lift** (Brücke ↔ Liftvorraum): Auf die Plattform stellen und **E** tippen. Die Fahrt dauert 1,5 s (bei Notstrom 3 s), bis zu drei Personen fahren mit. In 3D fährt die Kamera senkrecht mit, eine Lichtband-Blende verdeckt den Deckwechsel.
- **Notleiter** (Vorraum ↔ Atrium, links): **E halten**, 2 s.
- Es ist immer nur das eigene Deck zu sehen. Mitspieler auf dem anderen Deck erscheinen als Randmarke ↑/↓.

### Außenmissionen in Voxel
Mit `?render=voxel` erscheinen auch die Plattform B-7, das Wrack „Zaunkönig“ und der Mond Kesh in 3D. Die Plattform schwebt mit Rumpfschürze und Positionslichtern über dem Sternenhimmel. Das Wrack ist dunkel, rostig und nur von flackerndem Notlicht erhellt. Kesh zeigt warmen Sand, mauvefarbene Felsen und schieferblaue Kustoden-Ruinen mit violettem Neon. Deckung ist auf einen Blick lesbar: Halbe Deckung ist niedrig mit heller Oberkante, volle Deckung (Pfeiler) hoch mit dunkler Krone. Bereiche, die das Team gerade nicht sieht, sind abgedunkelt (Nebel des Krieges). Innenwände sind wie im Schiff auf Hüfthöhe geschnitten, damit niemand hinter einer Mauer verschwindet. Tür, Sonde, Bojenkern, Container, dünne Wand, Störrelais, Archivschlüssel, Tor und Tafel zeigen ihren Zustand direkt am Modell.

Messwerte von QA-AWAY (Bot-Läufe zu dritt): Plattform 72 s, Wrack 64 s unten, m3 6:26.

### Gemessene Bildrate (QA „Schiff“, 2026-10-07, Entwicklungslaptop)
Gemessen mit einem Fenster, Chromium headed mit echter GPU (`ANGLE (Intel UHD Graphics, Direct3D11)`, nicht SwiftShader), 1280×720. Szene auf Deck I: 3 Spieler (2 davon als Hintergrund-Clients), 3 Bots, 2 Feuer, 1 Leck.

| Szene | Normal (high) | Sparmodus (low) |
|---|---|---|
| Deck I im Gefecht, Bildrate an den Monitor gekoppelt | 60 fps | 60 fps |
| Deck I im Gefecht, ohne Bildratenbremse (Reserve) | Median 115 fps, Mittel 97 fps, ≤ 99 Draw Calls, ≤ 245k Dreiecke | Median 286 fps, Mittel 222 fps, ≤ 32 Draw Calls |
| Deck II (Atrium/Quartiere), gekoppelt | 60 fps, ≤ 51 Draw Calls | – |
| Kesh mit 2 Trupps, gekoppelt | 59,9 fps (Median), CPU 3,2 ms je Bild | 59,9 fps (Median), CPU 1,0 ms je Bild |

Ziel laut Vertrag: ≥ 30 fps normal, ≥ 45 fps im Sparmodus. Beides ist erreicht.

### Für Entwickler
- **`npm run assets`** kopiert die Modelle aus Voxelwerk (`../voxelwerk`) nach `public/voxel/`. Nach jeder Änderung an einem Voxelwerk-Rezept ausführen und die Seite neu laden. `npm run assets:watch` macht das laufend.
- **`npm run check:assets`** prüft Manifeste (`assets/manifest/art-*.json`) gegen die Modelle: Stufe, Dreiecksbudget, Maße und fehlende IDs. Ziel ist 0 Fehler. Warnungen sind erlaubt (Stand QA: 0 Fehler, 18 Warnungen).
- **Galerie:** `http://localhost:<PORT>/voxel-gallery.html` zeigt alle Assets mit ihren Zuständen.
- **Code:** `public/js/voxel/` mit `boot.js` (Einstieg, F8, `window.VoxelRender`), `renderer.js` (Szene, Kamera, Licht, Liftfahrt, FPS-Wächter), `loader.js` (Asset-Cache), `ship.js` (Schiff), `actors.js` (Figuren), `fx.js` (Effekte) und `away.js` (Außenmissionen).
- **Fehlerzähler:** `VoxelRender.errors`, `VoxelRender.info()` (Draw Calls, Dreiecke, Platzhalter, Layer-Fehler), `VoxelActors.stats()`, `VoxelFx.stats()`. Mit `?debug=1` erscheinen fehlende Assets als magentafarbene Box.

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
Der Teaser ist in der Demo nur Text, kein spielbarer Auftrag. **Seit S2 abgelöst:** Nach m3 übernimmt der Spielleiter
(siehe „Neu in S2“); die Bridge wird für die Kampagne nicht mehr gebraucht.

## Neu in B3 – Sektorkarte (Hexfeld)

Die Sternkarte ist jetzt die **Karte Limes**: 10×8 Hexe, ein Hex = ein Sektor = eine Raumszene (Koordinate `SSZZ`,
z. B. `0206` Lichtkordon). Die Daten liegen in `content/welt/limes.json`.

- **Ansicht:** Captain-Reiter 2 zeigt den **Saumraum** (die 8 spielbaren Hexe und einen Ring). **M** schaltet auf die
  ganze Karte Limes. Unerkundete Hexe zeigen nur Umriss und Name, gesperrte sind schraffiert und nennen beim Überfahren
  den Grund (z. B. „Grenzposten Statio Limitis: Durchflug gesperrt“). Rostnest (0107) bleibt „?“ und ist nicht
  anfliegbar.
- **Springen:** nur ins Nachbarhex über eine **offene Kante mit bekannter Boje** (gelb = offen, rot gestrichelt =
  gesperrt, blau = temporär). Sektor anklicken, Enter, am Steuer F.
- **Anflug:** Überall (seit Welle 1 auch im Tutorial) muss die Lerche die **Boje anfliegen** (≤ 250 m),
  sonst steht am Steuer „Sprungpunkt <Ziel> anfliegen (<m> m)“. Ankunft am Sprungpunkt der Gegenseite, Blick in
  Flugrichtung.
- **Tutorial (m1–m3):** Seit Welle 1 gilt der Anflug auch hier (Boje anfliegen, Ankunft an der Gegenboje; ≥ 300 m von
  der Station bleibt). Ziele wählt man im Tutorial weiter über die Ort-Links, auch wenn die Boje noch unbekannt ist.
- **Bojen finden:** Bojen zwischen bekannten Orten sind bekannt. Weitere findet der **Weitscan** der Taktik (Umkreis
  1400 m, Meldung „Boje gefunden …“).
- **Leerraum** (leere Hexe) ist eine Barriere: kein regulärer Sprung hinein oder heraus, nur über temporäre Sprungpunkte
  (Missionen) oder den Notfallsprung.
- **Notfallsprung** (Steuer **N**, dann **J**): zufällige Kante, bevorzugt in Flugrichtung, nur in spielbare Hexe
  (auch Leerraum). Danach ist der Reaktor aus (Neustart an Schalter A und B im Maschinenraum) und die Hülle verliert 15.
  Nach dem Neustart führt ein zweiter Notfallsprung immer wieder heraus.
- **Wrack „Zaunkönig“:** Die Kante Wrack–Graue Weite gibt es nicht mehr. Dafür gibt es Wrack–B-7.
- **Erkundung** (erkundete Hexe, gefundene Bojen, temporäre Kanten) steht im Weltstand (`welt.sektoren`) und überlebt
  Speichern und Laden. Alte Weltstände übernehmen den Stand aus den besuchten Orten.
- Liegt die Ziel-Boje außerhalb des Bildes, zeigt ein **Randpfeil** (Steuer und Taktik) Richtung und Abstand.
- **Debug** (`npm run debug`): `hex <SSZZ>`, `boje <kante>`, `notsprung`, `erkunde alle`, `sprungpunkt auf/zu <hex|ort|kante>`.
- **Messwerte (QA 2026-10-09):** `welcome` mit Sektorkarte 8,1 KB, Snapshot im Raum max 8,9 KB (Browser, solo). Golden
  m1–m3 mit `WAFFEN=aus` 120/120 identisch.

## Neu in B1 – Bühnen (modulare Außenkarten)

Bodenszenen spielen jetzt auf **gebauten Karten**: Module (8×8-Zellen, ASCII + Anker) werden nach einer Schablone
zusammengesetzt, eine **Bauweise** malt sie an (Germanen, Rom), **Besitz** (z. B. Friedlose, Kontor) und **Zustand**
(intakt/verfallen/umkämpft) überziehen sie. Vier Kartenarten: **Außenposten** (Germanen), **Raumstation** (Germanen),
**Ruine** (Rom, altes Grenzkastell), **Schiff** mit zwei Decks (Germanen). Jede Karte hat **Leitstücke** (Krähenwacht,
Schmiedeherd, Hochsitz, Drachenkopf, Fahnenheiligtum …) – sie stehen auf festem Block, man läuft nicht hindurch.

- **Landepunkte:** Jeder Ort hat mehrere (z. B. Kesh: Kustoden-Archiv, Verfallenes Grenzkastell, Grabungslager). An der
  **Transfer-Konsole** mit **7–0** wählen, Schiff in Reichweite und langsam, dann aufs Pad und E halten. Hinunter geht es
  zur Ankunft, hinauf von **jedem** Abholpunkt (E halten auf den Pad-Feldern).
- **Türen, Schotts, Luken, Tore:** E halten öffnet. Technische Eingänge: Schott hacken (6 s) bzw. Luke öffnen. Rätseltore
  sind verriegelt und öffnen nur über das **Rätselpaar**: zu zweit beide Schlösser gleichzeitig; **solo nacheinander**
  in einem Zeitfenster, das aus dem Laufweg zwischen den Schlössern berechnet wird. Schiffe: Leiter (E halten) und Lift
  (E; wer auf dem Lift steht, fährt – auch mit Blick auf ein Terminal).
- **Objekte:** Terminal (Download, Treffer unterbricht), Kiste, Fund, Zelle, Ziel, Sprengpunkt (Ladung nötig).
- **Weltstand:** Je Landepunkt bleiben Seed und Zustände (geöffnete Türen, leere Kisten) – beim zweiten Besuch ist es
  dieselbe Karte im selben Zustand. „Partie beenden“ setzt alles zurück.
- **Spielleiter:** plant Bodenszenen über Landepunkt oder `buehne: { kartenart, besitz, neu: true }` (neuer Seed, nie
  Koordinaten). Mindestens jede zweite und jede lange Mission hat eine Bodenszene (Prüfer). Gegner und Objekte einer
  Szene werden gesetzt, sobald die Karte gebaut ist – auch wenn noch niemand den Landepunkt gewählt hat.
- **Texte je Bauweise:** Platzhalter `{{lex.x}}` mit Formen (`{{lex.fund:den}}`, `:zum`, `:pl` …) werden je Bauweise
  aufgelöst („die Legionskasse“, „der Runenstein“). Ein Normalisierer korrigiert eindeutige Altformen vor dem Prüfer.
- **Prisen und Wracks:** Ein kampfunfähiges Feindschiff treibt als Landepunkt `<ort>.prise`; treibende Wracks (z. B.
  „Treibendes Langschiff“ am Wrack) sind feste Landepunkte. Rostnest bleibt gesperrt.
- **Testgelände:** `?arena=away&art=ruine&seed=3&bauweise=rom&besitz=herrenlos&zustand=verfallen`
  (optional `&schablone=…&fraktion=rostmeute&staerke=klein&haltung=ruhig`). Startet immer frisch, nie im Weltstand.
- **Werkzeuge:** `npm run buehne -- alle` (Bestehensquoten), `npm run buehne -- bauen <schablone> <seed>`,
  `npm run werkstatt`, dann `/werkstatt.html` (Module/Schablonen zeichnen, Live-Prüfung, Speichern) und
  `/galerie.html?art=station&seeds=1-24` (Vorschau, Kennzahlen, Fehlbauten rot). Lesen geht immer, **Speichern nur mit
  `WERKSTATT=1`** bzw. `npm run werkstatt`. Gespeicherte Module sind ohne Neustart im Spiel; Module mit Prüffehlern
  werden nie verbaut.
- **Debug** (`npm run debug`): `buehne <art> <seed> [bauweise besitz zustand]`, `lp list`, `lp neu <ort> <art>`,
  `anker <id> <zustand>`, `ladung [anker] [sek]`, `prise [kind]`.
- **Messwerte (QA 2026-10-09):** `buehne alle` 11 Schablonen × 50 Seeds 100 %; Snapshot Außenposten (3 Spieler,
  12 Gegner) max 12,8 KB von 13 KB; awayMap max 8,6 KB von 10 KB; Bau „verfallen“ Median 3–10 ms, nie im Tick;
  Golden m1–m3 120/120 identisch.

## Bekannte Grenzen

- Umfang: drei Tutorial-Missionen und sieben Orte. Gespeichert wird nur angedockt bzw. beim Missionsabschluss (S1) –
  nicht unterwegs und nicht im Kampf.
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

## Messwerte S1 (QA-Abnahme 2026-10-08)

**Bots (Golden Trace, keine Menschenzeiten):** `sim-headless`-Bots, 20 Seeds je Mission und Crewgröße, Spielzeit in Sekunden.
Vor dem Umbau (JS-Missionen) und nach dem Umbau (Regiebücher) **gleich** – Median-Abweichung 0 %, gleiche Schrittfolgen.

| Mission | solo (Median) | zu dritt (Median) |
|---|---|---|
| m1 „Die stumme Boje“ | 381,6 s (6:22) | 275,7 s (4:36) |
| m2 „Echo im Nebel“ | 581,4 s (9:41) | 527,5 s (8:48) |
| m3 „Die Tafel von Kesh“ (Direktstart) | 212,7 s (3:33) | 193,9 s (3:14) |

Die Bots spielen fehlerfrei und ohne Lesepausen; sie sagen nichts darüber, wie lange Menschen brauchen.

**Browser, zu dritt, m1 komplett** (gemessen): Kampagnenstart mit Hafen-Übung bis „angedockt im Hafen, m1 erledigt“ in
drei echten Browserfenstern (1280×720, 1920×1080, 1366×768), **ohne Debug-Server und ohne God-Mode**, nur Tastatur/Maus.
Gespielt hat ein QA-Skript mit Lesepausen (~40 ms je Zeichen), 0,3–0,8 s je Entscheidung und den Kampf-Reaktionszeiten aus
der M3b-QA. Das Skript kennt alle Positionen (als würde perfekt angesagt), verfliegt sich nicht und lässt Optionales weg
(Shop, Quartier, Planungstisch, Selas Notruf).

| Etappe (Spielzeit) | Dauer |
|---|---|
| Hafen-Übung + Funk annehmen | 0:48 |
| Ablegen, Sprung Splittergürtel | 0:24 |
| Splittergürtel (Bergungsgut, Grauzahn bestochen) | 2:20 |
| Kampf an B-7 (Jäger) | 0:13 |
| Störrelais + Boje scannen | 0:59 |
| Außenmission (Sonde, Kern, Ivo gerettet) | 1:28 |
| Entscheidung (Datenkern liefern) | 0:12 |
| Nachhut + Heimweg | 1:36 |
| Andocken im Hafen | 0:23 |
| **m1 gesamt** | **8:23** (503 s; Wanduhr 8:31) |

0 Notfallprotokolle, Hülle am Ende 100. Die 2:20 im Splittergürtel sind zum Teil Skript-Schwäche (der Skript-Pilot traf die
Kisten schlecht). Danach m2 bis „angedockt bei Vaelen“: 1:11 Wanduhr.

**Nicht gemessen:** Menschen; m1 solo im Browser; m2 und m3 komplett im Browser in S1. Eine Schätzung für Menschen steht
hier bewusst nicht – frühere Runden zeigten, dass Menschen deutlich länger brauchen als Skripte (Spieleabend abwarten).

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
- Missionen sind Daten: seit S1 Regiebücher in `content/regiebuecher/*.regiebuch.json` (siehe „Für Entwickler – S1“); die
  Engine (`server/sim/mission.js`) kennt Bedingungen wie `atLocation`, `enemiesLeft`, `scanDone`, `itemAboard`, `flag`,
  `choiceMade`, `event`, `elapsed` und Aktionen wie `radio`, `oda`, `spawn`, `choice`, `reward`, `setFlag`, `after`, `goto`,
  `complete`; alles Weitere (`do:`/`check:`) läuft über die Registry.
- Spielzeit pro Mission/Schritt/Ort steht im Snapshot unter `stats.missions`, `stats.stages`, `stats.locations`
  (Spielsekunden) und wird in `data/campaign.json` mitgeloggt.
- Debug-Befehle (nur `npm run debug`), z. B. im Browser-Konsole mit `__game.send({ t: 'debug', cmd: … })`:
  `goto {loc, docked?}`, `reveal {loc|'all'}`, `mission {id: 'm1'|'m2', step}`, `reactor {state: 'online'|'overload'|'offline'}`,
  `scanall`, dazu weiter `stage {stage}` (Schritt-ID), `skip` (aktuellen Schritt erfüllen), `damage {system, state}` (auch `offline`),
  `spawn {kind}` (auch `sentinel`, `pylon`), `fire`, `breach`, `marks {n}`, `inv {item, n}`, `hull {n}`, `god {on}`.

## Für Entwickler – S1 „Regiebuch & Weltstand“

### Regiebücher, Registry, Prüfer
- **Regiebücher** (`content/regiebuecher/*.regiebuch.json`, Format `regiebuch/1`, Schema `content/regiebuch/regiebuch.schema.json`):
  m1–m3 (Tutorial, von Hand geschrieben, gleiche Schritt-IDs wie früher), dazu die Nebenaufträge `sela` und `zaunkoenig`
  (nur Bucheinträge). Ablauf englisch (`steps`, `timers`, `rules`, `next` …), Rahmen deutsch (`kopf`, `angebot`, `buch`,
  `besetzung`, `ausgaenge`, `texte` …). Texte stehen unter `texte` und werden mit `"@kennung"` verwendet. Die alten Module
  `server/missions/m1–m3.js` sind gelöscht; `server/missions/arena.js` (Testgelände) bleibt JS mit `intern`.
- **Registry** (`server/mission/registry.js`): jedes `do:`/`check:` in einem Buch ist ein registrierter Baustein (snake_case,
  z. B. `spawn_squad`, `object_state`, `npc_gedaechtnis`). `Registry.describe()` liefert die Liste als JSON; `npm run katalog`
  zeigt Bausteine und Katalog.
- **Loader** (`server/mission/loader.js`) lädt beim Serverstart alle Bücher; der **Prüfer** (`server/mission/checker.js`) prüft
  sie. Ein ungültiges Buch wird mit `--debug` zum Abbruch, sonst laut geloggt und nicht angeboten.
- **`npm run check-missions`** prüft alle Bücher von der Kommandozeile (Codes wie `REF-ORT`, `REF-TEXT`, `ABLAUF-UNERREICHBAR`,
  `FAIRNESS`, `FLAG-FORM`, `FLAG-UNGESETZT`, `NEUSTART`, `MECHANIK-GEPLANT`, jeweils mit Begründung); `--selftest` prüft die
  kaputten Beispielbücher in `tools/fixtures/regiebuecher-kaputt/`.
- Objekte und Bereiche der Außenkarten (`Maps.MAP_OBJECTS`, `Maps.MAP_AREAS` in `shared/maps.js`) liest
  `server/mission/objects.js`.

### Weltstand
- `server/weltstand.js` (Liste, Laden, atomares Speichern mit `.bak`, Sperre, Migrationen), Schema
  `content/schema/weltstand.schema.json`, NSC-Startwerte `content/npc.json`. Laufzeit: `game.weltstand`.
- Laden startet den gespeicherten Schritt neu. Liegt dessen Ort woanders, „ruht“ der Schritt bis zum Ort; sein `next` gilt aber
  schon vorher (z. B. m1 `return` nach dem Laden bei Vaelen: Heimflug führt direkt zu `port`).

### npm-Skripte (neu in S1)

| Skript | Was |
|---|---|
| `npm run check-missions` | Prüfer über alle Regiebücher (`--selftest` für die kaputten Beispiele) |
| `npm run katalog` | Bausteine (Registry) und Szenen-Katalog anzeigen |
| `npm run test:regiebuch` | Engine: Registry, Loader, Prüfer, Objekte/Bereiche, Speichern/Laden der Missionen |
| `npm run test:weltstand` | Weltstand: Liste, Speichern, Laden, `.bak`, Sperre, 5 Stände, Lobby, Spielmenü (ohne Browser) |
| `npm run test:spielleiter` | Spielleiter-Tests **ohne LLM** (< 10 s, kein Netz): Prüfer, Kontext-Goldens, Replay, Mock |
| `npm run golden` | Golden Trace: `--all` zeichnet m1–m3 × Crew 1/3 × Seeds auf, `--compare <A> <B> --allow <json>` vergleicht |
| `npm run test:llm` | **nur von Hand** und nur mit `LLM_LIVE=1`: 1 Grobplan + 1 Szene live, `--record` legt Aufzeichnungen an; `-- --pipeline --welt ohne-tutorial --auftraggeber sela` fährt den echten Spielleiter (Grobplan + alle Szenen) und legt die Mission in `content/spielleiter/erzeugt/` ab (≈ 26 000 Tokens je Grobplan-Versuch, ≈ 24 000 je Szene) |
| `npm run missionen` | (S2) erzeugte Missionen: `liste`, `zeigen`, `annehmen`, `ablehnen`, `md` |
| `npm run regie -- <weltId>` | (S2) Regie-Logbuch als Markdown-Bericht |
| `npm run test:escort` | (S2) Schützling: Bewegung, Befehle, Schaden, Breitseite, Ausgänge |

`npm test` = test-features, test-combat, test-m3, test-flight, test-regiebuch, test-weltstand, test-spielleiter (`--strict`).
Golden-Vergleich wie in der Abnahme: `node tools/golden-trace.js --compare tools/fixtures/golden/base tools/fixtures/golden/s1 --allow tools/fixtures/golden/allow-s1.json`.