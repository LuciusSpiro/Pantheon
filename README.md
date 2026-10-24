# Pantheon – Stand nach EK8 (Eisenwald-Kampagne EK1–EK8, B1–B3 „Bühnen, Bodenkampf, Sektorkarte“, Wellen 1 und 2)

Gemütliches Online-Koop-Raumschiff für 1–4 Spieler im Browser. Ein kleiner Node-Server führt die
Partie, jeder spielt im eigenen Browserfenster. Kein Game Over – man scheitert mit Würde.

Das Spiel hieß bis S1 „Sternenschicht“ (Arbeitstitel); der Repo-Ordner heißt jetzt `Pantheon/`. Bisherige
Ausbaustufen: M1 „Die stumme Boje“ / „Echo im Nebel“ · M2 „Schildwall“ (Planetenmission „Die Tafel von Kesh“) ·
M3a „Breitseite & Schaden“ · M3b Schritt A „Ein Flugmodell für alle“ · M4 „Voxel & Lerche Rom“ · S1 „Regiebuch &
Weltstand“ (`CONTRACT-S1.md`) · S2 „Spielleiter an der Missionsgrenze“ (`CONTRACT-S2.md`) · S2b „Spielleiter live
tauglich + Kampf nach Kais Runde“ (`CONTRACT-S2B.md`) · B1 „Bühnen“, B2 „Bodenkampf“, B3 „Sektorkarte“
(`CONTRACT-B1.md`, `CONTRACT-B2.md`, `CONTRACT-B3.md`, von Kai abgenommen am 2026-10-09) · **Welle 1** (Netzbudget,
Ladezeit, Sprung im Tutorial, Spielleiter Boden II; `CONTRACT-W1.md`) · **Welle 2** (Szenario-Labor, Wellen Boden und
All, Bodenkampf-Feinschliff; `CONTRACT-W2.md`) · **EK1–EK8** (Eisenwald-Kampagne, Übersicht und Index:
`CONTRACT-EK.md`).

Die Abschnitte „Neu in …“ stehen unten, das Neueste zuerst. Abnahmen: `concept/buehnen/ABNAHME-B1.md`,
`ABNAHME-B2.md`, `ABNAHME-B3.md`, `ABNAHME-WELLEN.md`. Offene Punkte der Studioleitung: `concept/buehnen/OFFEN-STUDIO.md`.

## Neu in SUND-02b E – Beschuss auf römische Verbündete: der Verrat (Server, nur Freie Fahrt Sund)

**Ruf ist ein Kann, nie ein Muss.** Die Crew KANN in einer Sim-Szene auf die römischen Verbündeten schießen („Verrat“, Name nach Gefühl, die Texte sind neutral). Das ist **nie erzwungen und nie versehentlich**: es braucht eine bewusste Aktion (Ops-Halteprozess mit Warnung), Ablehnen und Abbrechen kosten nichts, jeder Spieler kann die Szene per Sprung verlassen. Ein Spieler an der Ops genügt, alle sehen dieselbe Warnung und dieselbe Szene, nur der Server schreibt. Wer schon etwas hat, verliert es nicht (Rang kann sinken, gekaufte Ausbaustufen bleiben, Test). Kein Lohn: keine Marken, kein Ruf aus dem Kampf. Kein Game Over. Kampagne, Limes, Eisenwald, Kette, Tutorial und Golden bleiben unverändert: Verbündete dort bleiben **unverwundbar** gegen Crew-Waffen (Test).
- **Dateien:** `server/sim/verrat.js` (Action-Layer: Bedingungen, Halteprozess, Abschluss, Gedächtnis, Anzeige), `server/sim/kriegslage-szene.js` (`verratStarten`, `verratSieg`, `verratNiederlage`, `S.modus === 'verrat'`), `server/sim/kriegslage.js` (`rufBuchen`, `welt.sim.verrat`), `server/sim/posten.js` (leitet `id: 'verrat'` des Halteprozesses weiter), `server/sim/ruf.js` (`verratBeginn`, `verratVernichtet`), `server/sim/space.js` (Flagge `ohneBeute`: eine Zeile), `server/game.js` (Befehl `weapons.verrat.beginnen`), Daten `content/welt/verrat-werte.json` (Anlauf, Phasen, Mindest-Hülle, `verlust.faktor`) und `content/welt/ruf-werte.json` (`verrat_beginn`, `verrat_flotte_vernichtet`), Texte `content/flotte/verrat.json`, Schema `welt.sim.verrat`, Client minimal (`public/js/consoles.js`, `hud.js`: nur Zuordnung, keine Gestaltung). Werkzeuge: `tools/test-verrat.js`, `tools/test-verrat-ws.js`, `tools/mutation-verrat.js`, `tools/sim-crew-verrat.js`, `tools/sicht-verrat.js`, `tools/sim-ruf.js` (neu: `--verrat`).
- **Umschaltung statt Treffer-Ziel (Entscheidung):** Crew-Geschosse (sechs Projektilarten, Lanze, Streu-Explosion) treffen nur `space.enemies`; Verbündete (`space.escorts`, `ally`) sind unverwundbar. Fünf Waffenpfade zu öffnen wäre teuer und fehleranfällig und würde Verbündete in Eisenwald/Kette angreifbar machen. Stattdessen verlassen die Verbündeten **der Sim-Szene** (`es.sim`) die Liste und kommen als echte Gegner derselben Klasse, derselben Hüllen-Quote (Hülle ÷ Hüllenmaximum, mindestens `huelle_min` 0,1), mit Namen, Kennung `rom` und Flagge `ohneBeute` zurück; Waffen, Zielerfassung und Klassen-KI greifen ohne Eingriff. Die Gegner der Szene (Germanen) drehen ab (Rückzug, wie am Szenenende), wartender Nachschub der alten Welle entfällt, eine neue Ein-Wellen-Liste („Welle 1/1“) trägt die neuen Gegner; ihre Punktwerte sind die der Verbündeten (`simPts`). Mit eigenem Rollback: wirft etwas, steht die Szene wie vorher (Reihenfolge: erst alles, was werfen kann, dann Rückzug und Austragen). Nur Verbündete mit `es.sim` zählen (Verbündete der Kampagne, von Eisenwald/Kette haben keins: „keine Verbündeten“).
- **Auslösung:** Befehl `weapons.verrat.beginnen` (Ops, Abbruch wie überall `weapons.fracht { off }`), Halteprozess `kind: 'posten', id: 'verrat'` (Anlauf `anlauf.dauer` 7 s, Annahme). Bedingungen (je Weigerungsgrund ein Text): Modus Freie Fahrt Sund, laufende Sim-Szene, **Phase Vorwarnung oder Kampf** (Daten `phasen`: in der Vorwarnung ist noch nichts geschehen, im Kampf drehen die Gegner ab; nach dem Ende der Szene gibt es nichts mehr), Verbündete der Szene (römische Flotte oder Abwehr/Garnison im Hex), nicht angedockt, Transfer heil, kein anderer Transfer, Verrat läuft nicht schon. Kein Rang nötig (Kann, nie Muss). Abbruch bei Szenenende, Verlust aller Verbündeten, Transfer-Ausfall, Sprung, Ops verlassen, Knopf; jeder Abbruch meldet „… abgebrochen. Nichts ist geschehen.“ an alle. Anzeige: `space.po { k: 'v', ok, t? }` (nur in solchen Szenen), Ops-Feld „Römische Schiffe angreifen“ mit der Warnung „Hochverrat an Rom – der Ruf sinkt“ schon vor dem Druck, im Anlauf die Fracht-Leiste „HOCHVERRAT AN ROM“ mit Fortschritt, **für alle Spieler** der Funk (Lagefunk) und die Szenenzeile `flotte.sz.w = [Rest, Dauer]` („HOCHVERRAT AN ROM · Ruf sinkt bei Beginn · Abbruch kostenlos“ mit Zähler).
- **Ruf (nur Abzug, nie Ertrag):** Neue Quellen in `ruf-werte.json`: `verrat_beginn` −12 **sofort bei der tatsächlichen Auslösung** (ohne Sim-Tick: `Kriegslage.rufBuchen`, geprüft mit `Kern.pruefeWirkung`, Rollback bei einem Wurf; Rangwechsel-Funk), `verrat_flotte_vernichtet` −6 beim Sieg (im Tick, atomar). Beide mit `folge: { ger: 0 }`: **das Erhöhen bei Germanen/Konkordat (Kai) ist vorbereitet, später nur ein Eintrag in den Daten**, gebaut ist es nicht (öffnet nichts). Rom bleibt auf 0 geklemmt, Rang sinkt (Tribun 82 → Centurio 70, Test), nichts blockiert (Miles darf gründen und angreifen, Test). Grund-Schlüssel getrennt von `sieg_feld_*`/`ort_gehalten_*`/`fahrerflucht_*`: `Ruf.szeneSieg` wird im Verrat nie aufgerufen (Test), die Abschüsse der ehemaligen Verbündeten zählen weder als Gegnerpunkte noch als Ruf noch als Marken (`e.ohneBeute`; die abziehenden Gegner der Szene geben Beute wie immer). **Schleifen:** auslösen, abbrechen, wieder auslösen = Ruf sinkt nur bei tatsächlicher Auslösung (Test: sechs Anläufe, Ruf unverändert); eine Auslösung kostet jedes Mal Ruf und gibt nie etwas zurück, es gibt nichts zu farmen. Bei Rom 0 kostet der Verrat keinen Ruf mehr (Untergrenze), nur die Flottenstärke Roms.
- **Ende:** SIEG (alle ehemaligen Verbündeten vernichtet = die eine Welle fertig): `flotte_verlust` auf die römischen Flotten des Hexes und `abwehr_verlust` auf die Abwehr/Garnison, je **`verlust.faktor` (Daten, 0,5) × Anteil der Szenenpunkte**, dazu `verrat_flotte_vernichtet`, genau ein Tick (`szeneAbschliessen`, atomar mit Rollback); kein `ort_gehalten`, kein `flaggschiff_gefallen` (römische Flotten haben in der Sim keinen Kommandanten, nichts zu merken), die Flotte bleibt geschwächt (Stärke ≥ 0,5, Rückzug nach Heimat wie im Kern), nicht vernichtet. FLUCHT (Sprung, Notsprung): nur anteilige Verluste (Anteil der bis dahin vernichteten Punkte × Faktor), kein weiterer Ruf (keine Fahrerflucht-Strafe obendrauf: der Beginn war schon der Preis), der Sprung-Tick ist der eine Tick. NIEDERLAGE (Notfallprotokoll wie 02a, zählt im Verrat sofort, weil neben der Lerche kein Verteidiger mehr lebt): anteilige Verluste, ein Tick, kein Ruf, kein `ort_gefallen`, kein Game Over; die übrigen ehemaligen Verbündeten ziehen ab. Szenenzeile: „VERRAT · k Gegner“, „SIEG · Römische Schiffe vernichtet“, „NIEDERLAGE · Angriff gescheitert“ (`sz.vt: 1`). Verrat in der Angriffsszene gegen einen Posten (A2) geht auch (`S.vor === 'angriff'`): der Posten wird dann nie gesprengt, die Garnison bleibt.
- **Folge am belagerten Hafen (ehrlich):** Verteidigt ein Hafen gerade gegen eine Belagerung und die Crew verrät die Hafenflotte, geht ein Teil der Abwehr verloren; die Sim zieht danach selbst ihre Folgen (Test: Ostia Nova fiel bei Faktor 1 im selben Tick an die Germanen). Das ist eine bewusste Folge einer bewussten Aktion, kein Zwang; mit Faktor 0,5 bleibt er im Test römisch (Abwehr 6 → 2,8). Offener Entwurfspunkt für Kai: Soll der Verrat am belagerten Hafen/an der Hauptwelt grundsätzlich gesperrt sein?
- **Gedächtnis (additiv):** `ws.verrat = { n, tick, hex }` (`welt.sim.verrat`, Version bleibt 3, Schema ergänzt, Altstand ohne Block lädt, müllfester Leser), dazu ein Chronik-Eintrag (`weltstand.chronicle`, „Die Lerche hat in … das Feuer auf römische Schiffe eröffnet.“). Ein Kommandanten-Gedächtnis gibt es nicht (die römischen Verbündeten tragen Szenennamen, keinen Kommandanten der Sim).
- **Kern:** unverändert, `sim:welt-paritaet` bit-gleich; neue Wirkungen gibt es nicht (nur vorhandene `flotte_verlust`, `abwehr_verlust`, `ruf_aenderung`).
- **Kennzahlen** (`npm run sim:crew-verrat`, 5 × 100 Läufe à 300 Ticks, Seeds 0–499, Bänder SUND-01: Eroberungen 1,0–2,2 / Angriffe je 100 Ticks 1,5–3,0 / Stillstand ≤ 8 % / Kollaps 0 / Hauptwelt nie verloren). Strategien: **ohne**; **wenig** (höchstens ein Verrat alle 40 Ticks ab Tick 20, ein Spieler, der sich gelegentlich entschließt); **viel** (alle 8 Ticks in JEDEM Hex mit Voraussetzung, Mensch kaum erreichbar). Ein Verrat bucht die Wirkungen des Sieges (Flotten und Abwehr im Hex × `verlust.faktor`). Verrat ist nur möglich, wo eine feindliche Flotte im Feld und römische Verbündete zusammentreffen: im Mittel 39 von 300 Ticks je Lauf. **Mit Faktor 1 („alles“) verletzt „viel“ in allen fünf Sätzen das Band „Hauptwelt nie verloren“** (1–3 % der Läufe; „wenig“ in einem Satz mit 1 %) und „wenig“ und „viel“ in je zwei von fünf Sätzen die Obergrenze Eroberungen 2,2 (2,22–2,30): die Germanen erobern mehr, wenn Rom Flotten verliert. Stellschraube (Daten, kein Eingriff in den Kern): `verlust.faktor` 0,5. Danach liegen alle 15 Zeilen in den Bändern: Eroberungen **ohne** 1,69 · 1,73 · 1,67 · 1,89 · 1,68, **wenig** 1,88 · 2,02 · 1,88 · 2,07 · 1,93, **viel** 1,90 · 1,99 · 1,94 · 2,17 · 2,04; Angriffe/100 **ohne** 2,21 · 2,54 · 2,30 · 2,98 · 2,16, **wenig** 2,70 · 2,63 · 2,41 · 2,79 · 2,44, **viel** 2,06 · 2,41 · 2,12 · 2,59 · 2,35; Stillstand 0–3 %, Kollaps 0, Hauptwelt 0 in allen. Differenz zu „ohne“: Eroberungen +0,18 bis +0,29 (wenig), +0,21 bis +0,36 (viel); Rom-Häfen −0,02 bis −0,17 (wenig mit Ausreißer +0,05), −0,16 bis −0,33 (viel). Je Lauf 2,8–3,4 Verräte (wenig) bzw. 4,0–5,5 (viel), römische Punkte je Lauf 8,5–9,9 bzw. 10,0–14,0.
- **Ruf-Eichung (Rangleiter kippt nicht)** (`npm run sim:ruf -- --seeds 2000 --posten 6 --verrat n,…`, Posten-Ereignisse wie bei A1: 6 je 80 Sprünge; jeder Verrat −18 Ruf: Beginn −12 plus vernichtet −6): Ohne Verrat Optio 17, Centurio 56, Tribun 151, Legat 340 Sprünge (Median). Ein Verrat bei Sprung 30: Centurio 80 (+24), Tribun 176 (+25), Legat 362 (+22). Vier Verräte (30, 60, 90, 120): Centurio 153, Tribun 257, Legat 446. Vierzehn Verräte (alle 10 Sprünge ab 20, absurd): Centurio 204, Tribun 300, Legat 489, alle Ränge in allen Läufen erreicht. Ein Verrat wirft den Fortschritt also um rund 24 Sprünge zurück (etwa drei Posten-Ereignisse), nie in einen Soft-Lock: wer Miles ist, darf gründen, ausbauen (ab Centurio) und angreifen und gewinnt Ruf zurück (Test: Rom 0 nach dem Verrat, Posten gegründet, Ruf 8).
- **Tests:** `npm run test:verrat` (Daten und Texte, Weigerungsgründe, Verbündete anderer Herkunft unverwundbar, Anlauf und fünf kostenlose Abbrüche, Umschaltung mit Klasse/Quote/Kennung/Beute/Rückzug/Welle, Vorwarnung, Sieg, kein Ruf-Ertrag, Flucht, Niederlage, Rollback (Tick, Ruf, Umschaltung, Ruf-Prüfer, Ruf-Buchung), Rang sinkt und Gekauftes bleibt, Hafen, Gedächtnis/Speichern/Laden/Altstand, Anzeige, Daten statt Zahlen), `npm run test:verrat-ws` (drei echte WebSocket-Clients), `npm run test:verrat-mutation` (Mutationsprobe), `npm run sicht:verrat` (zwei Chromium-Clients: Ops und Captain), `tools/test-lagefunk.js` (Zeilen der Szenenzeile).
- **E-Fix (Review):** (1) **Verluste vor der Umschaltung gelten voll** (Faktor nur auf das, was die Crew danach vernichtet: `S.vert.verloren0`), die Niederlage im Verrat bucht `ort_gefallen` wie ohne Verrat: der Verrat schützt Rom nicht mehr (Test: Flucht nach Verrat = Flucht ohne Verrat; belagerter Hafen fällt mit und ohne Verrat gleich). (2) **Sperre per Daten** (`verrat-werte.json` `sperre`): kein Verrat an der Hauptwelt Palatina (0204) und an einem Ort mit weniger als `abwehr_min` (1) Abwehr/Garnison; eigene Weigerungsgründe `hauptwelt`/`abwehr` mit Text; Test über Palatina belagert (Abwehr 1,0–6, Germanen 3/6). (3) **Faktor ehrlich:** bei `verlust.faktor` < 1 sagt der Sieg- und der Niederlage-Funk „Rom birgt einen Teil der Besatzungen: nur 50 % der Verluste gelten“. **Eichung mit Sperre** (`sim:crew-verrat --faktor`, 5 × 100, Seeds 0–499, 10 Zeilen wenig/viel): Faktor 1: Eroberungen 2,23 (wenig) und 2,27 (viel) über 2,2; 0,9: viel 2,27/2,32/2,23; 0,75: viel 2,22, wenig 2,22; 0,65: viel 2,25; **0,5: alle zehn Zeilen in den Bändern** (Eroberungen wenig 1,88–2,08, viel 1,93–2,16; Angriffe/100 wenig 2,42–2,82, viel 2,07–2,56; Hauptwelt 0), deshalb bleibt 0,5 der kleinste getestete Wert, der alle Bänder hält (die Sim ist chaotisch: größere Werte brechen je einen Satz). (4) Der Ruf-Text nennt den **tatsächlichen** Abzug (Rom 0: „leise“-Text, Rom 5: „um 5“). (5) **Zweistufige Bestätigung** (`bestaetigung.fenster` 5 s): der erste Druck stellt nur eine Anfrage (Funk, Knopf „Bestätigen (n s)“, `space.po.b`), erst der zweite beginnt den 7-s-Anlauf; Anfrage verfällt, gilt nur in der eigenen Szene. (6) Im Verrat geben auch die abziehenden Gegner der Szene keine Marken; ehemalige Verbündete tragen ihren Namen im Snapshot (`nm`, Client-Beschriftung); Abbruch steht auch im Lagefunk; Rückfallwert `0.1` aus dem Code entfernt (`huelle_min` aus den Daten). (7) Tests: Finale, Leser, Warnzähler, `escortsGone`, `odaWeg`, Niederlage-Funk, ein einziger Abschuss, `huelle_min`, `wirkungenAngewandt`, Regelgleichheit (Hülle, Schilde, Waffen und Schaden wie ein gewöhnlicher Gegner); Mutationsprobe jetzt 100 Mutationen, alle erkannt.
- **Offen:** Die Texte der Szenenzeile und der Ops-Leiste stehen (wie bei A2) fest im Client, die Funktexte in `content/flotte/verrat.json`. Der Anlauf (7 s) und alle Zahlen sind Annahmen (Kai: Zahlen per Messung). Das Feld an der Ops überlappt auf dem Ops-Bild die Szenenzeile oben links (Gestaltung, Designer). Die ehemaligen Verbündeten starten mit voller Schildstärke (nur die Hülle trägt die Quote).

## Neu in SUND-02b D – Strategische Optionen: Absichten für Rom ab Tribun (Server, Terminal, nur Freie Fahrt Sund)

**Ruf ist ein Kann, nie ein Muss.** Ab dem Rang Tribun bietet das Spiel der Crew 2–3 regelbasierte *Absichten* für Rom an; eine gewählte Absicht ändert für ihre Dauer das Verhalten der Standard-KI von Rom (messbar). Die Crew ist Offizier, nicht Feldherr: es gibt NUR diese vorgeschlagenen Optionen, nie eine freie Strategiekarte. **Ablehnen und Ignorieren kosten nichts** (kein Ruf, keine Sperre jenseits der Pause, Test), nichts blockiert, ohne Wahl läuft die Standard-KI (der Sim-Zustand ist mit und ohne Angebote byte-gleich, Test). Mehrspieler: dasselbe Angebot für alle, nur der Server schreibt, jeder am Terminal darf wählen (keine Rollen), bei gleichzeitigen Wahlen gilt die erste, die anderen bekommen „Schon gewählt“. Der Spielleiter (SUND-03) nimmt später denselben Weg (`zustand.absichten`), hier wird er nicht gebaut.
- **Dateien:** `content/welt/absichten.json` (Katalog, Wirkung, Dauer, Bedingungen, Pausen, SUND-01-Bänder, Fenster-Messung: alle Zahlen), `content/flotte/absichten.json` (Funk, Weigerungen, Abschnitt `anzeige` mit allen Texten des Terminals; der Server liefert genau diese Datei aus, Whitelist in `server/index.js`), `server/sim/absicht.js` (Action-Layer), `server/sim/kriegslage.js` (Rollback, Speichern, Laden, Funk nach dem Commit), `server/game.js` (Befehle, Snapshot, Debug), `public/js/absicht.js` (Client-Speicher und Texte), `public/js/terminal-ui.js` + `pult-terminal-tokens.js` (Bereich Kurs), `tools/sim-absichten.js` (Messung), `tools/test-absichten*.js`, `tools/mutation-absichten.js`, `tools/sicht-absichten.js`.
- **Wirkung (Kern unberührt):** `kern.js` liest in `ki()` aus `zustand.absichten[fraktion]` die Felder `p_act` (Chance je Tick, dass eine Flotte eine Aktion beginnt, Standard 0,25), `aggr` (Anteil Angriffe an den Aktionen, 0,5) und `max_active` (gleichzeitig aktive Flotten, Rom 3). `sim:welt-paritaet` bleibt bit-gleich (`Kern.tick` wird nicht angefasst, nur `kennzahlen.js` hat den optionalen Parameter `absichten` für die Messung). **Schichtung:** `zustand.absichten.rom` kann einen Eintrag von anderer Hand haben (SUND-03). Die Wahl überlagert NUR die eigenen Felder und merkt sich deren vorherige Werte (`laufend.vorher`, im Weltstand gespeichert); der Ablauf stellt sie wieder her, fremde Felder und Änderungen anderer Hand an den Feldern bleiben; ohne fremden Eintrag verschwindet der Eintrag ganz.
- **Angebot (regelbasiert, deterministisch, ohne Zufall und LLM):** Der Takt läuft im Tick-Atom (`Absicht.nachTick`, nach dem Ruf-Update des Ticks): läuft eine Absicht aus, räumt er auf und meldet Funk; verfällt ein Angebot, gibt es nur die Pause; ohne laufende Absicht, ohne Angebot, nach der Pause und ab dem Mindestrang (`mindestrang`: tribun) entsteht ein neues. Die Liste: zuerst die Absichten, deren Bedingung gerade zutrifft (`belagert`: ein römischer Hafen oder Posten wird belagert, `staerker`: Gesamtstärke Roms ≥ 1,05 × Germanen), nach `prio`, aufgefüllt mit den Absichten ohne Bedingung (`immer`), höchstens 3, mindestens 2 (gleicher Zustand = gleiche Liste, 300 Zustände aus echten Läufen im Test). Die Liste steht fest, solange das Angebot gilt (`angebot_dauer` 8 Ticks). Pause: 6 Ticks nach einer Absicht, 12 nach einem Angebot, das niemand angenommen hat. Fällt der Rang unter Tribun, zieht Rom das Angebot zurück; eine laufende Absicht läuft zu Ende (auch die Anzeige zeigt sie dann weiter).
- **Katalog (vier Absichten, je 12 Ticks; Text und Wirkung stimmen im 12-Tick-Fenster überein, Review M1/M2):** `verteidigung` „Die Grenze halten“ (Bedingung belagert; p_act 0,12 · aggr 0,4 · max 3: weniger Feldzüge und Angriffe), `offensive` „Vorstoß über die Grenze“ (Bedingung staerker; 0,4 · 0,7 · 5: mehr Angriffe), `ausgreifen` „Neue Posten setzen“ (immer; 0,35 · 0,1 · 3: mehr Ansprüche und neue Posten, kaum Angriffe), `bereitschaft` „Wachsam bleiben“ (immer; 0,2 · 0,25 · 3: seltener Angriffe). **Keine Absicht „Nachschub“:** `kern.js` startet bei Munition oder Treibstoff unter 10 ohnehin keine Aktion, eine solche Absicht wäre in 10 345 Angeboten wirkungslos gewesen (Review): sie wurde gestrichen, kein Platzhalter im Katalog. Versprochen wird nur, was im Fenster messbar ist: keine Aussage über Versorgung, Verluste oder Belagerungen.
- **Messung 1, Ganzlauf** (`npm run sim:absichten`, 100 Läufe à 300 Ticks, Seeds 0–99; die Absicht gilt für Rom über den GANZEN Lauf, der schärfste Fall; Bänder SUND-01 und Mindestunterschied je Absicht, Datenfeld `wirkt`):

  | Absicht | Eroberungen | Angriffe/100 | Stillstand | Kollaps | Hauptwelt verloren | Rom: Angriffe | Rom: Ansprüche | Rom: neue Posten | Rom: Posten verloren | Rom: Häfen verloren | Rom wird belagert |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | Standard-KI | 1,69 | 2,21 | 3 % | 0 | 0 | 3,63 | 1,78 | 1,07 | 0,26 | 0,76 | 3,12 |
  | verteidigung | 1,31 | 1,80 | 4 % | 0 | 0 | 2,12 | 1,09 | 0,71 | 0,25 | 0,71 | 3,32 |
  | offensive | 1,96 | 2,86 | 1 % | 0 | 0 | 5,31 | 1,19 | 0,65 | 0,13 | 0,82 | 3,67 |
  | ausgreifen | 1,80 | 2,06 | 2 % | 0 | 0 | 2,93 | 4,72 | 2,41 | 0,58 | 0,79 | 3,44 |
  | bereitschaft | 1,56 | 1,95 | 3 % | 0 | 0 | 2,43 | 2,14 | 1,34 | 0,36 | 0,79 | 3,42 |

  Bänder: Eroberungen 1,0–2,2 · Angriffe/100 1,5–3,0 · Stillstand ≤ 8 % · Kollaps 0 · Hauptwelt nie verloren: alle Zeilen innerhalb.
- **Messung 2, 12-Tick-Fenster** (`--pruefen`, Teil von `npm test`; so wirkt eine Absicht im Spiel: 12 Ticks Absicht, 12 Ticks Standard-KI danach, an 60 Seeds, jeder 6. Tick, nur Zustände, in denen die Absicht angeboten würde, gegen dieselben Zustände ohne Absicht; je Absicht die Richtung ihres Textes, Datenfeld `wirkt_fenster`; im Fenster gilt die Richtung, nicht die Bänder). Mittel je Zustand, Standard-KI → Absicht:

  | Absicht | n | Angriffe von Rom | Ansprüche von Rom | Aktionen von Rom | neue Posten | Rom wird belagert |
  |---|---|---|---|---|---|---|
  | verteidigung | 209 | 0,354 → 0,167 | 0,163 → 0,096 | 0,517 → 0,263 | 0,187 → 0,148 | 0,794 → 0,756 |
  | offensive | 754 | 0,115 → 0,324 | 0,036 → 0,040 | 0,151 → 0,363 | 0,057 → 0,042 | 0,298 → 0,305 |
  | ausgreifen | 2760 | 0,136 → 0,038 | 0,060 → 0,132 | 0,195 → 0,170 | 0,072 → 0,111 | 0,239 → 0,234 |
  | bereitschaft | 2686 | 0,130 → 0,064 | 0,060 → 0,070 | 0,190 → 0,134 | 0,072 → 0,077 | 0,226 → 0,220 |

  **Grenzen der Sim** (ehrlich): Belagerungen, Hafenverluste und Vorräte ändern sich in 12 Ticks nicht messbar; die Absichten wirken auf Feldzüge, Angriffe und Posten. Mehr Angriffe von Rom erzwingt die Wahrscheinlichkeit nicht (bereite Flotten und Ziele begrenzen), die Offensive wirkt über `max_active` 5. Über 300 Ticks sinkt die Belagerung nur mit sehr passiven Werten, die das Band „Angriffe/100 ≥ 1,5“ verletzen würden (die Germanen allein tragen etwa 1,1): deshalb gibt es keine Verteidigung, die „weniger Belagerung“ verspricht.
- **Terminal im Meetingraum:** Bereich „Kurs“ als dritter Knopf (Taste K, links neben Handel und Werft; vor Tribun gedimmt, Grund im Tooltip; der Name vermeidet die dritte Bedeutung von „Lage“ neben Captain-Reiter und Lagefunk). Karten für das Angebot (Pfeile und Klick wählen, Enter nimmt an, X lehnt ab; Kreuz und Module wie im Handel gedimmt), „Läuft“-Karte mit Restzeit in Sprüngen, nach dem Ablauf „Rom hat gerade keine Frage“, vor Tribun „Noch keine Anfrage“. Alle Texte stehen in `content/flotte/absichten.json` (`anzeige`), keiner im Client-Code. „Schon gewählt“ sperrt die Karten und Knöpfe sofort. Endet der Modus, fällt der Bereich weg (die Tasten gehen nicht mehr an ihn). Zuschauer sehen den Bereich mit der Karte des Nutzers (`werft.ansicht` b `l`), bedienen nichts. Antwort des Servers: Ereignis `absichtAntwort { ok, op, code, text }` (Codes `schon_gewaehlt`, `kein_angebot`, `nicht_im_angebot`, `rang`, `modus`, `unbekannt`). Die Leertaste ist nicht belegt.
- **Befehle und Snapshot:** `absicht.waehlen { id }`, `absicht.ablehnen` (Konsole `shop`, jeder Spieler, nur Freie Fahrt Sund); Snapshot `world.absicht { frei, ab, angebot?: [{ id, name, text, dauer }], rest?, laufend?: { id, name, text, rest, dauer } }` nur bei Änderung (Schlüssel inkl. Rang und Restzeit), nie in den großen Snapshots, `world.absicht = null` ist das Löschsignal (einmal, wenn der Modus endet). Größe des Worst-Case-Blocks (3 Karten, längste Texte): `npm run snap:mess`. Lagefunk (Oberkommando, `lage` 1, `r` 1) beim Angebot, bei der Wahl und beim Auslaufen. Debug: `absicht [status | angebot | wahl <id> | ende | reset]`.
- **Weltstand:** optional `welt.sim.absicht { laufend?: { id, start, bis, vorher? }, angebot?: { ids, t, bis }, frei_ab? }` (Version bleibt 3, Schema ergänzt, Altstand ohne Block lädt, müllfester Leser verwirft Unbekanntes und Abgelaufenes, klemmt Zeiten); die Wirkung selbst steht in `zustand.absichten.rom` des Sim-Zustands. Hat ein Stand dort noch eine Wirkung unserer Absichten, aber keine laufende Absicht, wird sie beim Laden geräumt; fremde Einträge bleiben. Atomar: Wirft der Tick (auch NACH dem Auslaufen oder Angebot), geht die Absicht mit auf die Sicherung zurück, es gibt keinen Funk.
- **Tests:** `npm run test:absichten` (Daten, Rang, deterministisches Angebot, Wahl und Ablauf, nicht doppelt, Ruf unverändert, Standard-KI byte-gleich, Wirkung im Kern, Rollback, Rangverlust, Schichtung, Takt, Weltstand, Kampagne, Snapshot, Debug), `test:absichten-ui` (Terminal-Modell, Tasten, Zuschauer, Modus-Ende, Absage, Texte), `test:absichten-ws` (drei echte WebSocket-Clients), `test:absichten-mutation` (Mutationsprobe), `sim:absichten -- --pruefen` (Ganzlauf und Fenster), `sicht:absichten` (Chromium-Bilder).
- **Designschuld:** Das Angebot liest den wahren Sim-Zustand (Belagerung, Stärke), nicht das Wissen von Rom (`kriegslage-wissen.js`): Rom erfährt über „Die Grenze halten“ von einer Belagerung, die seine Karte noch nicht zeigt. Die Umstellung braucht eine Regel auf Stärkeklassen statt Stärkepunkten und ein neues Messen der Schwellen; sie ist nicht gemacht. Ungemessen: der Rhythmus von Angebot und Pause im echten Spieltempo (Sprünge je Abend); der Ticker-Funk „LAGE · Oberkommando“ bleibt nach dem Modus-Ende noch einige Sekunden stehen.

## Neu in SUND-02b A2 – Posten sprengen: die Crew greift einen gegnerischen Posten an (Server, nur Freie Fahrt Sund)

**Ruf ist ein Kann, nie ein Muss.** Die Crew KANN den Posten der Germanen oder Piraten sprengen; sie löst die Szene selbst aus (Ops-Halteprozess), die Ankunft am Posten startet nie eine. Ein Spieler an der Ops genügt, alle sehen dieselbe Szene; gleiche Regeln für Spieler und Gegner (Garnison, Wellen, Verluste aus denselben Funktionen). Kein Game Over. Rom ist kein Ziel (Beschuss auf Rom ist Paket E), das Konkordat ist neutral (Kern-Regel `feindlich`: ger und pirat), der eigene Crew-Posten ist nie sprengbar.
- **Dateien:** `server/sim/posten.js` (Weigerungen, Halteprozess `angreifen`, `angriffFertig`, Ruf-Sperre), `server/sim/kriegslage-szene.js` (`angriffStarten`, `angriffSieg`, `angriffNiederlage`, `S.modus === 'angriff'`), `server/weltsim/wirkungen.js` (Wirkung `posten_gesprengt`), `server/sim/kriegslage.js` (Rollback, Speichern, Laden von `welt.sim.sprengungen`), `server/game.js` (Befehl `weapons.posten.angreifen`), Daten `content/welt/posten-werte.json` (`angreifen`, `sprengen`, `mindestrang.angreifen`), `content/welt/ruf-werte.json` (`posten_gesprengt_ger/_pirat`), Texte `content/flotte/posten.json` (Abschnitt `angreifen`) und `content/flotte/sim-szene.json` (Abschnitt `angriff`), Schema `welt.sim.sprengungen`. Werkzeuge: `tools/test-sprengen.js`, `tools/test-sprengen-ws.js`, `tools/mutation-sprengen.js`, `tools/sim-crew-sprengen.js`, `tools/sicht-sprengen.js`, `tools/sim-ruf.js` (neu: `--sprengen`, `--quelle`, `--schwelle`).
- **Auslösung:** Befehl `weapons.posten.angreifen` (Abbruch wie Fracht: `weapons.fracht { off }`), Halteprozess `kind: 'posten', id: 'angreifen'` (Anlauf, `angreifen.dauer` 8 s). Bedingungen (je Weigerungsgrund ein Text): Modus, nicht angedockt, Posten da (kein Hafen, keine Station), Besitzer ger oder pirat (`eigener`: römisch/Crew, `neutral`: Konkordat), Rang (Daten: `mindestrang.angreifen` = miles, nie ein Muss), keine Szene und keine Gegner im Hex, Transfer heil, Ring (260 px) und Tempo (60 px/s) wie beim Gründen. Abbruch bei Gegnern, Szene, Ring, Tempo, Transfer, Posten weg oder gewechselt, Sprung, Ops verlassen; Abbrechen kostet nichts (keine Kosten, kein Ruf, die Garnison bleibt wie sie ist). Anzeige `space.po { k: 'x', ok, t? }` am Posten eines Gegners; Ops-Feld „Posten angreifen“ (Zuordnung im Client, keine Gestaltung).
- **Szene (modus 'angriff'):** Wellen aus der Garnison: `Plan.plane({ staerke: max(1, Garnison × angreifen.staerke_faktor), seed, volk: Besitzer })` (Garnison 4 × 1,5 = 6 Punkte = drei Wellen, Flaggschiff „Postenkommandant“), `Flotte.wellenStartAusPlan` wie in 02a, Vorlauf `angreifen.vorlauf` (10 s), römische Flotten im Hex sind Verbündete (wie 02a), Andocken gesperrt, Sprung = Flucht. Snapshot: `flotte.sz` bekommt `x: 1` (Vorwarnung, Kampf, Finale, Ergebniszeile), der Client schreibt „ANGRIFF AUF POSTEN · WELLE k/n“, „SIEG · Posten gesprengt“, „NIEDERLAGE · Angriff gescheitert“. Funk: Vorwarnung, Sieg „Posten … gesprengt“, Niederlage; die Zeilen stehen in `sim-szene.json`.
- **Ende:** SIEG (alle Wellen oder Flaggschiff gefallen): `abwehr_verlust` (Rest der Garnison) + `posten_gesprengt` + `ruf_aenderung` (Grund `posten_gesprengt_ger` bzw. `_pirat`, ger mit Folge Germanen −4) + genau ein Tick (`szeneAbschliessen`, atomar mit Rollback). Der Prüfer von `posten_gesprengt` verlangt Garnison ≤ `sprengen.garnison_max` (0,5, wie der Kern ab 0,5 einen Posten verliert): die Wirkungen gehen in dieser Reihenfolge in dasselbe Paket, `Kern.filtereWirkungen` prüft der Reihe nach gegen den Zustand nach den früheren (ein Posten mit voller Garnison lässt sich nie „einfach“ sprengen, auch nicht durch einen Fehler im Aufrufer). FLUCHT (Sprung/Notsprung): nur anteilige `abwehr_verlust` (Garnison × vernichtete Punkte / Planpunkte), kein Ruf-Abzug, der Posten steht, die Garnison regeneriert (+0,2 je Tick). NIEDERLAGE (Notfallprotokoll wie 02a): anteilige Verluste, ein Tick, kein Ruf-Abzug, kein Game Over. Ruf nur beim Sieg.
- **Kern:** nur der Eintrag `posten_gesprengt` im Katalog (Anwender: `postenVerlieren(c, ort, besitzer, 'rom')`); `kern.js` unverändert, `sim:welt-paritaet` bit-gleich. Neue Aufsatz-Daten: `ws.sprengungen = { Hex: Tick der letzten Sprengung }` (optional `welt.sim.sprengungen`, Version bleibt 3, Altstände ohne den Block laden).
- **Farming-Prüfung und Ruf-Sperre:** Sprengen → Gegner gründet neu → sprengen: die Sim gründet nur bei Versorgung (`posten_e`) und Anspruch. Messung (`npm run sim:crew-sprengen`, 100 Läufe à 300 Ticks): 1,1 feindliche Posten werden je Lauf überhaupt gegründet (nur auf den vier freien Hexen 0503/0505/0703/0705, fast alle vor Tick 50, Piraten gründen keine), in 45 % der Läufe steht überhaupt einer da, den die Crew sprengen könnte; wird er gesprengt, gründet der Gegner am selben Hex in 14–18 % der Läufe neu (Wartezeit Median 10–17 Ticks, kürzeste 5). Die Obergrenze „alle 8 Ticks alles sprengen“ bringt 2,8 Ruf je 100 Ticks (mit Sperre; ohne 3,5); der Rechenlauf braucht ohne Sprengen 666 Sprünge für 80 Ruf (rund 12 je 100 Sprünge aus Szenen und A1): keine Schleife mit hoher Rate. Gegen die kurze Wartezeit trotzdem eine Sperre in den Daten: innerhalb von `sprengen.ruf_sperre_ticks` (40) nach der letzten Sprengung am selben Hex gibt die nächste keinen Ruf (der Posten fällt trotzdem, Funk erklärt es); sie streicht bei der Obergrenze knapp ein Fünftel des Rufs (10,4 → 8,4 je Lauf) und ändert die Strategie „wenig“ nicht.
- **Kennzahlen mit und ohne Sprengen** (`npm run sim:crew-sprengen -- --seed0 N`, 5 × 100 Läufe à 300 Ticks, Seeds 0–499; Bänder SUND-01: Eroberungen 1,0–2,2 / Angriffe je 100 Ticks 1,5–3,0 / Stillstand ≤ 8 %; Kollaps 0 und Hauptwelt nie verloren in allen 15 Zeilen). Angriffe/100 je Seed-Satz (0–99, 100–199, 200–299, 300–399, 400–499): **ohne** 2,21 · 2,54 · 2,30 · 2,98 · 2,16 (Mittel 2,44, immer im Band); **wenig** (höchstens eine Sprengung alle 40 Ticks ab Tick 20) 1,71 · 1,75 · 1,85 · 1,90 · 1,52 (Mittel 1,75, immer im Band, knapp bei 400–499); **viel** (alle 8 Ticks jeder Posten) 1,53 · 1,42 · 1,40 · 1,75 · 1,48 (Mittel 1,52, **in drei von fünf Sätzen unter der Untergrenze 1,5**). Differenz zu „ohne“ je Satz: wenig −0,50 · −0,79 · −0,45 · −1,08 · −0,64, viel −0,68 · −1,12 · −0,90 · −1,23 · −0,68: **die Basis „ohne“ liegt auf denselben Seeds im Band, der Rückgang kommt also vom Sprengen** und ist deutlich größer als 0,3 (rund ein Viertel bis ein Drittel weniger Angriffe: Germanen mit weniger Posten werden von Rom seltener angegriffen). Eroberungen (Mittel): ohne 1,73, wenig 1,57, viel 1,44 (Band 1,0–2,2, jeweils im Band, −0,16 bzw. −0,29); Stillstand 0–5 %, kein Satz über 8 %. „viel“ ist **keine echte Obergrenze**: frühes Sprengen senkt die Neugründungen, es bringt im Mittel nicht mehr Sprengungen als „wenig“ (0,97 vs 0,95 je Lauf; bei Seeds 0–99 sogar 0,87 vs 1,01). Ein Mensch liegt zwischen „ohne“ und „wenig“: ein Spieler, der alle 40 Sprünge einen Posten erreicht, bleibt in allen Sätzen im Band. **Vorschlag als Datenwert (nicht gebaut, Kai entscheidet):** eine Abkühlzeit für Angriffe (z. B. `angreifen.abkuehlung_ticks` 40, nach einer Sprengung kein neuer Anlauf für 40 Ticks, im Aufsatz wie `ws.sprengungen`) hielte jeden Spieler auf dem Niveau von „wenig“; ohne sie ist „viel“ nur durch das Gelände begrenzt (wenige Posten, Anflug), nicht durch eine Regel.
- **Ruf-Eichung** (`npm run sim:ruf -- --einmalig 6:8:1,14:8:0.64,26:4:1,34:4:0.64,60:8:0.5 --sprengen 0.45:12:20:80,0.24:12:60:200 --posten 0 --max 1500`; Annahme: wie bei A1 die Posten-Ereignisse, dazu mit 45 % ein gesprengter Posten um Sprung 20–80 und mit 24 % ein zweiter um 60–200, je +12): Optio 6, Centurio 72 → 60 Sprünge (Median), Tribun 666 → 568, Legat 1351 → 1322 [24 % der Läufe in 1500]. **Das Ziel „Tribun in 150–250 Sprüngen“ erreicht A2 allein nicht**: Sprengen ist wiederholbar, aber es gibt im Mittel nur ~1 Posten je Spiel zu sprengen. Daten-Vorschläge, ohne Code und ohne A2: Schwelle Tribun 80 → 50 ergibt Tribun 209 (73–500), Centurio bleibt 60; Tribun 45 und Legat 120 ergibt 161 und 1000; oder die Szenenquellen anheben (`sieg_feld_ger` 6, `sieg_feld_pirat` 4, `ort_gehalten_ger` 20, `ort_gehalten_pirat` 16: Centurio 48, Tribun 262, Legat 808). Die Schwellen sind Paket B und gehören Kai; geändert wurde nichts.
- **Mehrspieler und Tests:** `npm run test:sprengen` (Daten, Wirkung gültig/ungültig und Reihenfolge, Weigerungen, Anlauf und Abbrüche, Wellen aus der Garnison, Sieg/Flucht/Niederlage mit Wirkungen und genau einem Tick, Rollback, Ruf nur beim Sieg, Sperre je Hex, Verbündete, eigener Crew-Posten, Laden/Altstand, Anzeige, Kampagne unverändert), `npm run test:sprengen-ws` (drei WebSocket-Clients am echten Server), Mutationsprobe `npm run test:sprengen-mutation` (51 Mutationen), Bilder `tools/sicht-sprengen.js`.
- **A2-Fix (Review):** `space.po` fehlt während der Sim-Szene und der Ergebniszeile (6 s), das Finale nennt „Der Postenkommandant“, Sprengungen aus der Zukunft (Welt neu begonnen) werden beim Laden verworfen, die Siegeszeile entfällt, falls der Tick die Sprengung nicht angewandt hätte (mit der Vorabprüfung am selben Zustand nicht erreichbar; die Mutation „Ruf auch bei ungültiger Sprengung“ ist deshalb gleichwertig und in `mutation-sprengen.js` begründet), Texte der Szenenzeile stehen fest im Client (der tote Abschnitt `angriff.zeile` ist entfernt).
- **Offen:** Der Posten ist immer „Kulisse“: Wellen kommen rund um die Lerche, nicht aus dem Posten. Gegnerische Flotten im Hex gelten als Gegner im Hex (Weigerung „Gegner“), sie werden nicht in die Angriffsszene gemischt (eine Flotte im Feld löst bei der Ankunft ohnehin die normale Szene aus).

## Neu in SUND-02b A1 – Posten der Crew: gründen, ausbauen, Stützpunkt-Werft (Server, nur Freie Fahrt Sund)

**Ruf ist ein Kann, nie ein Muss.** Die Crew KANN einen freien Sektor in Roms Anspruch besetzen oder einen römischen Posten zum Stützpunkt ausbauen; Rang, Anspruch, Ersatzteile und Lage sind Bedingungen, der Abbruch kostet nichts (Kosten erst beim Abschluss). Ein Spieler an der Ops genügt (Solo geht, die anderen sehen zu).
- **Neue Dateien:** `server/sim/posten.js` (Action-Layer), `content/welt/posten-werte.json` (alle Zahlen: Anspruch, Mindestränge, Dauer/Radius/Tempo/Kosten, `halten_ticks`, Dock-Abstand), `content/flotte/posten.json` (Weigerungs-, Abbruch- und Meldungstexte), `tools/test-posten.js`, `tools/test-posten-ws.js`, `tools/mutation-posten.js`, `tools/sim-crew-posten.js`, `tools/sicht-posten.js`.
- **Halteprozess** (Vorbild `fracht.js`): Befehle `weapons.posten.gruenden` / `weapons.posten.ausbauen` (Abbruch wie Fracht: `weapons.fracht { off }`), `s.halt = { kind: 'posten', id: 'gruenden' | 'ausbau', t, dur, hex }`, Fortschritt als `fracht.halt.p` im Snapshot. Bedingungen (je Weigerungsgrund ein Text): Modus, nicht angedockt, keine Station/kein Hafen, Hex in Roms Anspruch und frei (Gründen) bzw. römischer Posten ohne Stützpunkt (Ausbau), Rang, keine Gegner im Hex und keine `simSzene`, Transfer heil, Lerche im Ring um `Besitz.postenLage` und langsam, genug Ersatzteile. Abbruch bei Gegnern, Szene, Verlassen des Rings, zu schnell, Transfer-Ausfall, Sprung (Szenenwechsel), Ops verlassen, belegtem Sektor. Abschluss: Wirkung + `ruf_aenderung` über `Kriegslage.szeneAbschliessen` (genau ein Tick, atomar; Vorabprüfung mit `Kern.pruefeWirkung`), erst danach werden die Ersatzteile gebucht.
- **Anspruch von Rom** (Daten): 0503 Gasfeld und 0505 Brachland (grenzen an Speculum/Porta Australis); 0703/0705 sind das germanische Spiegelbild (die Crew gründet dort nie). Kantenstein 0603 und Pulverhorn 0605 tragen Station und Dock: Weigerung „Station“. Die Karte `sund_frei.json` trägt `anspruch: 'rom'` (abgeleitet in `tools/gen-sund-frei.js` aus den Daten), `KarteLage.flaeche` zeichnet einen gestrichelten Innenrand in Roms Fahnenfarbe, die Legende nennt „Anspruch“ (nur auf Karten mit Anspruch).
- **Wirkungen** `posten_gehisst { ort }` und `posten_ausgebaut { ort }` (zwei benannte Wirkungen statt Flag) im Katalog (`wirkungen.js`). `posten_gehisst`: Posten, Besitzer `rom`, Garnison `garrison`, Merkmale `crew: true` und `ohneErtrag: true` (additiv, fehlen in Altständen und im Prototyp); Ereignis `posten_gehisst` (nicht `posten_gegruendet`: die Kennzahlen zählen nur Sim-Posten; das Wissen von Rom behandelt es wie einen gegründeten Posten). `posten_ausgebaut`: nur `crew: true`, Garnison mindestens `garrison`. Kern-Änderungen (minimal, ohne `crew` bit-gleich zum Prototyp): `postenVerlieren` räumt beide Merkmale, die Produktion überspringt Posten mit `ohneErtrag` (Messung unten).
- **Dock am Stützpunkt:** Overlay `crew: true` (römischer Posten, Garnison > 0). `Besitz.dockLage(game, sc, hex)` = festes `sc.dock` oder berechnet unter dem Posten (die geteilte Szene bleibt unverändert); alle Leser (Dockerkennung und `enterScene` in `space.js`, `Kriegslage.szeneNachziehen`, Asteroiden-Freihalten, Escort `dock`, Alarm-Minen, Szenen-Ortspunkt) gehen darüber. Sim-Posten ohne Stützpunkt bleiben Kulisse („Dieser Posten hat kein Dock“). Laden: `Besitz.dockbar`; ist der gespeicherte Stützpunkt weg, Rückfall auf den Startort.
- **Werft und Handel:** `Werft.istFlottenbasis` prüft dritte, abgeleitete Stützpunkte (nicht gespeichert, nie `setzeFlottenbasis`): fällt der Posten, ist die Werft sofort weg, Freigeschaltetes bleibt. Handel am Stützpunkt gesperrt („Dieser Posten verkauft nichts.“, `Shop.buy` und Werft-Block `hs`, Terminal zeigt es an jeder Handelszeile).
- **Posten halten:** `welt.sim.posten = { Hex: { t, g? } }` (optional, Schema ergänzt), nach `halten_ticks` einmal Ruf `posten_gehalten`, Eintrag fällt mit dem Posten (Aufsatz im selben Atom wie der Tick).
- **Ruf-Quellen** (Daten): `posten_gehisst` +8, `posten_ausgebaut` +8, `posten_gehalten` +4; **Mindestrang Gründen: Miles** (nicht Optio, siehe `_hinweis` in `posten-werte.json`: ohne Posten dauert Optio median 94 Sprünge, dann ist nur noch in ~35 % der Läufe ein Anspruchs-Hex frei), Ausbau ab Centurio (Kai).
- **Anzeige (Daten + Minimum):** `space.po { k, ok, t?, n }` nur dort, wo ein Posten Sinn hat (freies Hex ohne Hafen und ohne Station, römischer Posten ohne Stützpunkt); Ops: Knopf „Posten gründen“ / „Stützpunkt ausbauen“ mit Weigerungstext darunter, Halteprozess in der Fracht-Leiste (Fortschritt, „Abbrechen“). Keine Gestaltung darüber hinaus (Designer-Review folgt); Bilder: `tools/sicht-posten.js`.
- **Messen:** `npm run sim:ruf -- --einmalig 6:8:1,14:8:0.64,26:4:1,34:4:0.64,60:8:0.5` (Posten-Ereignisse zu festen Sprüngen mit Versorgungs-Wahrscheinlichkeit), `npm run sim:crew-posten` (100 Läufe mit und ohne Crew-Posten gegen die Bänder von SUND-01). Tests: `npm run test:posten`, `npm run test:posten-ws`, Mutationsprobe `npm run test:posten-mutation`.
- **A1-Fix (Review von A1):** fällt der Stützpunkt, während die Lerche angedockt liegt (Tick durch `notrufErledigt` o. Ä.), legt sie ab (Meldung `dock.verloren`), niemand sitzt mehr am Terminal; `updateFlight` wirft ohne `sc.start` nie; an Hexen ohne Hafen gibt es nie Handel (`Besitz.handelSperre`); Abbruch durch Sprung oder Ops-Verlassen meldet sich (`stummerAbbruchText`); Feld `space.po` auch auf Hexen mit Station ausgeblendet. Offen: sinkt die Garnison eines Stützpunkts auf genau 0 (`abwehr_verlust`), fehlen Dock und Werft bis zum nächsten Tick (+0,2 Garnison), das ist die Regel „Garnison > 0“.
- **B-Fix (aus dem Review von B):** ein Sprung in der 20-s-Vorwarnung einer Sim-Szene ist keine Fahrerflucht (nur im Kampf); `fahrerflucht_ort_*` nur bei laufender Belagerung, sonst der Feldsatz (wie beim Sieg); `world.ruf = null` ist das Löschsignal, wenn der Modus endet.

## Neu in SUND-02b B – Ruf und Rang (Server, nur Freie Fahrt Sund)

**Ruf ist ein Kann, nie ein Muss.** Er öffnet Zugang (Ausbaustufen der Werft über `game.rufErreicht(rang)`), er erzwingt nichts; Ablehnen kostet nichts, niemand verliert durch Ruf etwas, das er schon hat.
- **Zustand:** `game.weltsim.ruf = { rom, ger, kon }` (Start 0), im Weltstand additiv als `welt.sim.ruf` (Version bleibt 3; fehlt der Block oder ist alles 0, ist der Stand wie vorher). Ruf gilt für die ganze Crew, nur der Server schreibt (kein Spielerbefehl, nur `ruf` im Debug). Zugriff zentral über `server/sim/ruf.js` (`ruf`, `rang`, `rangInfo`, `rufErreicht`, `aendern`, `snapshot`). Ohne `game.weltsim` (Kampagne, Limes, Labor, Arena) gibt es keinen Ruf: kein Block, kein Rang, `rufErreicht` ist immer wahr (Werft ohne Ruf-System wie vorher).
- **Daten:** `content/welt/ruf-werte.json` (Grenzen je Fraktion, Dienstgrade Miles/Optio/Centurio/Tribun/Legat mit Schwellen, Tabelle `quellen`: Grund -> Fraktion, delta, optional `folge`). Texte des Rangwechsel-Funks: `content/flotte/ruf.json`. Keine Zahlen im Code. Rom 0..220, Schwellen 8/30/80/180; Germanen -50..0 (sinken automatisch bei Siegen über sie, öffnen nichts), Konkordat nur das Feld.
- **Wirkung `ruf_aenderung`** `{ fraktion, delta ≠ 0, grund }` steht im Katalog (`server/weltsim/wirkungen.js`: Prüfer mit Fraktion, delta-Grenze und Grund aus der Tabelle). Der Sim-Kern bleibt rein: er nimmt die Wirkung an und tut nichts (`aufsatz: true`), angewandt wird sie von `Kriegslage.tickMit` NACH dem Tick im selben Atom (Wurf = Rollback von Sim und Ruf). Der Zustand des Kerns kennt keinen Ruf (Parität zum Prototyp bleibt bit-gleich).
- **Quellen:** Sieg in einer Sim-Szene im Feld (Germanen +3, Piraten +2), gehaltener römischer Hafen/Posten (`ort_gehalten`, Germanen +10, Piraten +8), Fahrerflucht (Sprung aus einer Szene gegen Germanen: -3, um einen römischen Ort -6). Piraten ignorieren: keine Wirkung, kein Abzug. Das Ablehnen eines Führungsangebots ändert den Ruf nie. Paket A (Posten) und E (Beschuss Verbündeter) ergänzen nur Einträge in `quellen`.
- **Anzeige (nur Daten):** `world.ruf = { rom, ger, kon, rang, name, ab, bis }` bei Änderung (wie `world.lage`, im nächsten freien Snapshot, höchstens ~90 B); bei Rangwechsel ein Lagefunk (`lage: 1`, `r: 1`, `ruf: 1`, Sprecher Oberkommando). Kein UI-Code in diesem Paket.
- **Messen:** `npm run sim:ruf` (Rechenlauf: Sprünge bis zu jedem Rang), `npm run sim:ruf -- --messen` (Szenenrate aus echten Sprüngen). Tests: `npm run test:ruf`, Mutationsprobe `npm run test:ruf-mutation`. Debug: `ruf [rom|ger|kon] [wert]`.

## Neu in SUND-02b C – Ausbaustufen am Rang (Server, Terminal)

Ruf öffnet den **Kauf**, Marken bezahlen weiter; was gekauft ist, bleibt.
- **Daten:** `CONFIG.werft.ruf.stufe = { 2: 'centurio', 3: 'tribun' }` (`shared/config.js`), Stufe 1, Waffentypen und Module frei, alle Preise unverändert. Ohne `weltsim` (Kampagne, Tutorial, Testumgebung) gilt jede Rang-Bedingung als erfüllt.
- **Regel:** der Rang wird nur in `freischaltenPruefen` und nur für noch nicht freigeschaltete Stufen geprüft; das Anwenden einer schon gekauften Stufe, Umbauen und Weiterspielen brauchen nie einen Rang. Sinkt der Rang oder geht die Basis verloren, bleibt `ship.freigeschaltet.stufe`; ohne Basis sperrt nur der Umbau (`keine_flottenbasis`). Reihenfolge der Gründe: Ort, dann Rang.
- **Texte:** `content/flotte/ruf.json`, Abschnitt `werft` (`stufe_grund` „Rang {rang} nötig“, `stufe_fehler`), über `Ruf.werftText` und `Ruf.rangName`.
- **Snapshot:** `werft.sperre = { Stufe: 'Rang Centurio nötig' }`, nur für nicht freigeschaltete Stufen mit fehlendem Rang, Feld fehlt sonst (Worst Case Miles rund 62 B; `test-werft-rang` misst den Snapshot gegen das Budget 18 944 B). Terminal: Preis der Stufenkachel mit „!“ in Warnfarbe, Zeile „Rang … nötig“ im Block „Stufe n öffnet“, Hauptknopf gesperrt mit demselben Grund.
- **Tests:** `npm run test:werft-rang`, Mutationsprobe `npm run test:werft-rang-mutation` (23 Mutationen über Server, Daten, Texte und Terminal-Zeichnung; läuft `test-werft-rang` und `test-werft-ui`). Ohne Textdatei fällt der Grund auf den Rangnamen zurück, nie auf einen leeren Text.

## Neu in SUND-02a A2 – Sim-Szene: die Crew greift in die Flottenbegegnung ein (Server)

Im Modus „Freie Fahrt Sund“ (`game.weltsim`) baut die Szene aus dem Sim-Zustand eine Schlacht und meldet nur über den Wirkungen-Katalog (Paket B) zurück. Kampagne, Tutorial, Eisenwald, Labor: nichts ändert sich (jeder Pfad hängt an `game.weltsim` bzw. `game.simSzene`).
Neue Dateien: `server/sim/kriegslage-szene.js` (Action-Layer), `content/flotte/sim-szene.json` (Texte, Namen), `tools/test-szene-sund.js`, `tools/test-szene-ws.js`, `tools/sim-szene-sund.js`. Neue Flottenfunktion `Flotte.wellenStartAusPlan(game, { plan, volk, ziel, richtung, tag, vorlauf, restAnteil })`.

**Auslöser.** `Szene.betreten(game, hex)` am Ende von `Space.enterScene` (jede Ankunft: Sprung, Schnellsprung-Hop, Debug `hex`/`goto`), nie durch einen Tick. Eine feindliche Flotte (ger, pirat; Stärke ≥ 1) **im Feld** (Befehl `angriff`, `anspruch` oder `rueckzug`, also Marsch oder Belagerung) im Hex löst aus; die **Heimatflotte im eigenen Hafen** (Befehl `heim`, auch beim `sammeln`) löst **keine** Szene aus (Kai, 2026-10-23: sonst wäre jede Fahrt in germanisches Gebiet ein Pflichtkampf). Die Szene nimmt die **stärkste feindliche Fraktion** im Hex (andere kämpfen nur in der Sim). Römische Flotten im Hex sind Verbündete, nie Gegner; Konkordat ist neutral. Ohne feindliche Flotte keine Szene (auch eine Belagerung ohne Flotte im Hex nicht). Gedockt (Laden, Debug-Start) gibt es keine Szene; **Laden stellt nie eine her** (`game.simSzene` wird nicht gespeichert, `Kriegslage.reset/restore` räumt es weg; gespeichert wird nur gedockt). Wer nach dem Ende im Hex bleibt, bekommt keine zweite Szene; erst die nächste **Ankunft** löst bei vorhandener Flotte wieder aus (die Szene folgt der Ankunft, nicht der Lage; eine Flotte, die nach Tick/Rückzug weg ist, löst nichts aus). Der Schnellsprung endet bei Feindkontakt wie bei einem Abfangen. Die Szene liest die **Wahrheit** (Sim-Zustand), die Karte zeigt weiter das Wissen von Rom (`world.lage` ändert sich durch die Szene nicht).

**Ablauf.** Vorwarnung: Funkspruch „Aufklärung“ (Stärkeklasse klein/mittel/groß aus `Kern.staerkeKlasse`, Fraktion, Kommandant, „Klarmachen“, Sekunden), Hinweise (ODA) bei 10 s und 5 s; die Anzeige `flotte.wl` (vorhandenes Feld, HUD-Zeile „Welle 0/n“) steht schon. `CONFIG.simSzene.vorwarnung` = 20 s. Dann Wellen aus `plane({ staerke: Summe der Angreiferflotten, seed: seedAus(Flotten-Id, Tick), volk, kommandant })`, Schiffszahl **unskaliert** (nur die Hülle skaliert mit `crewScaling.enemyHp`); die nächste Welle, wenn höchstens `restAnteil` (0,34, abgerundet) der vorigen lebt, Nachschub über 12 Schiffen zählt als lebend. Finale: Flaggschiff (trägt den Namen des Kommandanten, Funk „… greift mit dem Flaggschiff ein“). Kommandant aus `game.weltsim.kommandanten` (Gefallene übersprungen; ein „entkommen“er kann wiederkehren, der Funk sagt es; sind alle gefallen: Ersatzname „Der Flottenführer“).

**Client-Runde nach dem Designer-Review (SUND-02a).** (M1) Szenenfunk läuft über den Lagefunk-Pfad (`lage: 1`): Lagefunk-Tafel an allen Konsolen, Funk-Reiter des Captains, Logbuch; die Vorwarnung mit Kommandant wird zuletzt gesendet und steht obenauf. (M2) Snapshot `flotte.sz` (nur Sim-Szene und 6 s danach, siehe `shared/protocol.js`): `Hud.drawSzenenStrip` ersetzt VERBÜNDET/BEFEHL an Konsolen, im HUD und auf dem Hauptschirm; Welle k/n bleibt `flotte.wl`. (M3, S1) In der Frontsicht einer Sim-Szene: Verbündete in Mint (Ring, Hüllenbalken, Name), Randpfeile für die drei nächsten Gegner, Flaggschiff (Snapshot `fg`) zuerst. Eisenwald und Kampagne sehen beides nicht (hängt an `flotte.sz`). (S2) Alarm Rot für die Dauer der Szene (`game.updateAlert`, reine Darstellung; der Raum-Alarm aus `alarm.js` bleibt aus). (GRNDS.) Gnadenfrist-Meldung ohne „verloren“, wenn der Ort mangels Belagerung nicht fallen kann (`gnadeOhneBelagerung`).

**Fixrunde zur Client-Runde (SUND-02a).** (M1) `Kriegslage.reset` (auch von `restore` genutzt) leert `simSzeneEnde`; die Ergebniszeile gilt nur, wenn `bis - game.time` in (0, `CONFIG.simSzene.endeAnzeige`] liegt (robust gegen Zeitrücksprung, Dauer jetzt in CONFIG statt im Code). (M2) Die Szene sendet ihre Endmeldungen erst NACH `Kriegslage.szeneAbschliessen`; der Tick bekommt `direkt` (die Lerche sieht das Hex selbst: das Wissen von Rom nimmt dort den jetzigen Stand statt des Vor-Ticks, also kein „wird belagert“ nach abgewehrtem Angriff) und `stumm` (kein Wissens-Funk „… ist gefallen“ für dieses Hex, die Szene meldet den Ausgang selbst). Die Ergebnis-/Kommandantenmeldung ist die letzte Lagemeldung und steht an den Konsolen obenauf; das Szenenende räumt die Szenen-ODA (Ortung, Erste Welle) per Ereignis `odaWeg`. (S1) Logbuch nur Vorwarnung und Ergebnis, mit kurzem Text ohne Ortsnamen (`log.*` in `sim-szene.json`; das Logbuch setzt den Ort selbst davor). (S2) Szenenfunk trägt `sz: 1`; nur Vorwarnung und Ergebnis zusätzlich `r: 1` und kommen in den Funk-Reiter, der Rest nur an die Konsole. (N5) Lagefunk trägt optional `kz` (Ort · Fraktion · Stärke); die einzeilige Zeile am Terminal ist „LAGE · [Sprecher, außer eigene Sensoren] · kz · Prosa“ auf flacher Tisch-Fläche mit 1 px Messing. Client: Randpfeil-Ausweichplätze nur für Randpfeil-Labels (S3), Notrückholungs-Tafel ohne Lagemeldung wie vor der Client-Runde (S4), Sensorreichweite für Frontsicht-Randpfeile (H1; das Flaggschiff bleibt), unbrauchbares `sz` wird ignoriert (H6), Szenenzeile am Hauptschirm: Randpfeile und Labels klemmen darunter, Lagefunk-Tafel und Logbuch-Hinweis rücken im Voxel-Sitz darunter (N1/N3), Konsolen-Karten mit Einzug unter der Zeile und Zoom-Anzeige darunter (N4), Gegner-Randpfeile weichen Ringen der Verbündeten aus, deren Labels stapeln mit (N2), SIEG: Streifen Mint (N6), Meldeliste „FEINDKONTAKT · vor Ort“ nur in v/k/f (N7), „3 Wellen“ statt „Welle 0/3“ in der Vorwarnung (N8), Ring/Name/Balken der Verbündeten auch auf Ops/Captain-Karten Mint (M3-Rest).

**Verteidigung** (Hafen/Posten mit Besitzer rom): Punkte = Σ römische Flotten im Hex (Stärke × Versorgung × (1 + Ortsbonus), Werte `sund-sim-werte.json` `bonus`) + Abwehr (Hafen) bzw. Garnison (Posten). Daraus höchstens `verteidiger.max` (4) Verbündete über `Flotte.aufstellen` (Rolle angreifer, Klassenwerte = `wellenplan.punkte`, je freiem Platz die größte Klasse bis zur gerundeten Restpunktzahl je Platz). **Eichung:** die Schiffe der Szene haben `verteidiger.huelle` = 30 % der Klassenhülle (nur die Hülle der Szenen-Schiffe, Eisenwald unberührt). Mit voller Hülle schlug die Hafenflotte allein (Crew passiv) jede Stärke bis 27 ohne Verlust, die Gegner der Szene haben ja nur `crewScaling.enemyHp` × Hülle und kommen in kleinen Wellen; mit 30 %: Ostia Nova (13,6 Punkte) hält Stärke 17 und 27 mit ~17 % Verlust, Stärke 40 meist nicht. Stellschraube, kein Messwert der Sim (Designer/Kai). Messung: `npm run sim:szene -- --fall eichung --huellen 100,50,30`. Kleinere Schadenswerte der Verbündeten wurden verworfen: Patt (die Schilde der Gegner regenerieren schneller, als die Schüsse sie abtragen). Mehr Punkte heißt gröbere Auflösung: der Verlust eines Schiffs zählt anteilig mehr (`Σ zerstörte Schiffspunkte / Σ Schiffspunkte`), nie mehr Schiffe. Ohne Ort (freier Sektor): nur römische Flotten im Hex als Verbündete. Schiffe der Szene tragen `es.sim`; ihr Verlust schreibt **nichts** in den Weltstand (kein Fakt, kein Legat-Gedächtnis).

**Ausgang → Wirkungen.**

| Ausgang | Bedingung | Wirkungen | Tick |
|---|---|---|---|
| Sieg | Flaggschiff gefallen (Rest bricht ab, auch mit Reststärke) oder alle Gegner tot | `flotte_verlust` (Angreifer, ganze Punkte nach Klassenwert, proportional, Rest nach größtem Bruchteil), `flotte_verlust`/`abwehr_verlust` (Verteidiger), `flaggschiff_gefallen` für alle Flotten des Angreifers (Schicksal entkommen/gefallen deterministisch aus dem Seed, `schicksal.entkommen` 0,5), `ort_gehalten` bei laufender Belagerung | `szeneAbschliessen`: genau +1 |
| Niederlage | Notfallprotokoll der Lerche (`notfallBisNiederlage` 1; das Spiel kennt kein Game Over, das Notfallprotokoll ist die „zerstörte Lerche“), **gezählt erst, wenn kein Verteidiger mehr lebt** (mit lebender Hafenflotte geht die Schlacht weiter), oder alle Verteidiger gefallen und `erschoepfungGnade` (15 s) um | Verluste, `ort_gefallen` an die Angreiferfraktion, **nur bei laufender Belagerung** des Ortes durch Flotten dieser Fraktion (eine durchziehende Flotte erobert nichts, die Niederlage kostet dann nur die Verluste; Piraten erobern keinen Hafen: der Prüfer lehnt ab, die Szene sendet es gar nicht) | +1 |
| Abbruch | Flucht per Sprung/Schnellsprung/Notfallsprung | nur Verluste bis dahin, **kein** `ort_*`, kein Kommandant | `wirkungenVormerken` im Hook von `Kriegslage.tick` VOR dem Tick: der Sprung-Tick ist der eine Tick |
| Abbruch ohne Sprung | Debug-Ortswechsel (`goto`, `hex`) | wie Abbruch | `Szene.verlassen` → `szeneAbschliessen`: genau +1 (kein Sprung-Tick folgt, nichts bleibt vorgemerkt) |

Während der Szene tickt nichts (+0). Piraten dürfen ignoriert werden (Abbruch ohne Abschuss: keine Wirkung, nur der Sprung-Tick). Nach jedem Ende drehen die übrigen Gegner **der Szene** (Spawn-Tag `sim_szene`) sichtbar ab (≤ 14 s, `Escort.retreat`, die Regel wird gleich wieder gelöscht; Gegner anderer Herkunft, z. B. der Hinterhalt eines Notrufs im selben Hex, bleiben), Verbündete der Szene werden entfernt (springen nicht mit), `game.flotte` ist wieder `null`. Der Antrieb lädt mit Gegnern im Raum nicht (Störsender): Flucht im Kampf geht nur per Notfallsprung, in der Vorwarnung per Sprung.

**Zufall.** Spawn-Winkel und Aufstellung der Verteidiger ziehen aus `game.rng` (laufen also mit dem Spielverlauf mit); Plan, Kommandant und Schicksal laufen über eigene Seeds (`seedAus(Flotten-Id, Tick)`), sind also vom Spielverlauf unabhängig.

**Docken.** Während der Szene ist Andocken im Hex gesperrt (`Besitz.darfAndocken` falsch, Dock-Marker weg, Hinweis „Andocken gesperrt – Feindkontakt, erst die Gegner abwehren“); Ende oder Abbruch geben es wieder frei (`szeneNachziehen`).

**Takt bei anderen Szenen der Freien Fahrt.** In Freie Fahrt gibt es keine Mission und keine Kette; die einzige Szene mit Ende außer der Sim-Szene sind die Notrufe aus `notrufe.js` (nur per Debug `notruf`; die Sim erzeugt eigene Notruf-Marken ohne Szene). `notrufErledigt` (Bergung, abgewehrter Hinterhalt) ist ein Szenenende ohne Sprung: `game.missionEvent` tickt dann genau einmal (`Kriegslage.szeneAbschliessen` ohne Wirkungen, außer während einer Sim-Szene, deren Ende tickt). `notrufAbgelaufen`/`notrufAbgelehnt` sind keine Szenenenden (kein Tick, der Sprung danach tickt selbst). `sprung.missionEnde` schließt nur temporäre Kanten, kein Tick.

**Katalog.** Die Sim-Szene nutzt dieselben Laufzeitfunktionen wie die Katalog-Bausteine (`flotte_aufstellen`, `flotte_wellen` = `Flotte.aufstellen`/`wellenStart`, hier `wellenStartAusPlan`; Gegner-Tod = Ereignis `enemyKilled`) und braucht keine Mission: die Regiebuch-Vorlagen der Moleküle vernichten/schuetzen/flottenbefehl setzen eine laufende Mission voraus (`game.mission` ist in Freie Fahrt ohne Buch, `mode` null). `Flotte.befehl` wird bewusst nicht benutzt (schreibt Legat-Gedächtnis).

**Config** `CONFIG.simSzene`: `vorwarnung`, `vorwarnungErinnerung`, `restAnteil`, `verteidiger { max, abstand, rolle }`, `erschoepfungGnade`, `notfallBisNiederlage`, `schicksal.entkommen`. Texte und Namen: `content/flotte/sim-szene.json`.

**Debug** (nur `npm run debug`): `szene [staerke] [ger|pirat] [belagerung]` setzt im Hex der Lerche eine Flotte der Sim (Belagerung: Feldzug in Marsch, angekommen) und löst die Szene aus. Debug `szene <staerke>` ist auf 200 begrenzt (darüber Hinweis); ohne `belagerung` ist die Flotte auf Rückzug nach Hause (wie jede durchziehende Flotte der Sim, „heim“ gibt es nur im eigenen Hafen). Tests und Läufe: `npm run test:szene-sund` (Teil von `npm test`), `npm run test:szene-ws` (echter Server, 3 Spieler, Port 3414, `PORT=…` überschreibt) und `npm run sim:szene` (Kampf-Bots: Stärke 8/17/40, Hafen, Posten, freie Schlacht, Ankunftsstatistik) laufen **nur manuell**, nicht in `npm test`.

Hooks (klein): `space.js` (eine Zeile am Ende von `enterScene`), `kriegslage.js` (`tick`, `reset`; ein Kommandant zählt einmal je Begegnung), `game.js` (`missionEvent`, `step`, Debug, Notruf-Takt), `besitz.js` (Andocken), `reise.js` (Schnellsprung), `flotte.js` (`wellenStartAusPlan`, Plan-Wellen in `spawnGruppe`/`tickWelle`/`lebendeWelle`, Sim-Schiffe ohne Weltstand-Eintrag in `allyLost`).

## Neu in SUND-01 Korrekturrunde E – Befunde des Reviews (Server)

Behoben auf `sund01-e` (Verhalten der Sim und Kennzahlen unverändert, `sim-welt` und `sim-welt-paritaet` byte-gleich):

- **Kurs fremder Flotten ist beobachtete Bewegung.** `n` (nächstes Hex) verriet bei verzögerter Anzeige die jetzige Position (98,7 % Treffer). Fremde Plaketten tragen jetzt `v` („kam von“): das Wissen merkt sich je sichtbarer fremder Flotte das Hex des vorigen Standes (`wissen.spur`, Schlüssel Sim-Flottenid, nur intern); die Karte zeichnet den Pfeil von der `v`-Seite **in das Hex hinein**. Eigene Flotten (Alter 0) zeigen weiter ihr echtes `n`. Das vermutete Ziel `z` rechnet aus dem beobachteten Schritt `v -> h`. Metamorph getestet (`tools/test-lage-wissen.js`): zwei Zustände, die sich nur in Unsichtbarem unterscheiden, geben denselben Block; ändert man Gesehenes, ändert er sich.
- **`zustand.angriffe` wächst nicht mehr.** Beendete Feldzüge fallen `werte.speicher.angriff_behalt` (60) Ticks nach ihrem Ende heraus, Ids kommen aus `naechsteAngriffId` (Altstand: höchste Id + 1). Das Messobjekt von `Kern.tick` sammelt die entfernten Datensätze in `messung.angriffe_entfernt` (Kennzahlen, Eingreif-Fenster). `welt.sim` nach 5000 Ticks: 11,5 KB statt 155 KB.
- **Notruf-Marken** tragen eine neutrale Id (`lage:n<Nummer>`); Marke und Sammelzähler `d` enden nach der Sicht (Rom sieht das Hex ohne Belagerer wieder, oder `altMax` Ticks außer Sicht), nie nach der Wahrheit der Sim.
- **Sonde über einem per Karte gesichteten Hex** speist das Wissen (der Hook meldet das Hex, `ws.sondeHexe`).
- **`szeneNachziehen`** zieht auch den Posten-Marker nach. **Tick-Fehler** melden einmal je Partie „Kriegslage gestört.“ (Platzhalter bis SUND-04).
- **Rom-Gebiet und Konkordat beim Start vorab erkundet** (Kai): `content/welt/sund_frei.json` `start.erkundet` (Hexe) und `start.bojen` (Kanten), erzeugt von `tools/gen-sund-frei.js` (`vorerkundung()`), angewendet still von `Kriegslage.starten` über `Explore.vorerkunden`. Erkundet sind die 8 Rom-Hexe, die 3 Konkordat-Hexe und die beiden freien Hexe zwischen ihnen (Gasfeld, Brachland, sonst ginge der Schnellsprung nach Concordia nicht); Bojen aller offenen Kanten mit einem Rom- oder Konkordat-Ende. Alles andere (Germanen, Piraten, Sonderorte, übrige freie Sektoren, verborgene und gesperrte Kanten) bleibt unerkundet.

Geteilte Dateien: `server/sim/explore.js` (`vorerkunden`), `shared/sektoren.js` (`vorerkundetBeiStart`), `server/weltsim/daten.js` (Wert `speicher.angriff_behalt`), `content/schema/weltstand.schema.json`, `shared/protocol.js` (Doku), `public/js/consoles.js` (eine Zeile: Kurswinkel), `tools/snap-mess.js` (Worst Case mit `v` statt `n` bei fremden Flotten).

## Neu in SUND-01 Paket C – Wissen von Rom, Übersichtskarte, Lagefunk

Die Karte des Captains zeigt im Modus „Freie Fahrt Sund“ nicht den Sim-Zustand, sondern das, was **Rom weiß**. Gestaltung: `CONCEPT-SUND01-KARTE.md` und `public/js/karte-tokens.js` (Designer). Kampagnen und Limes bleiben unverändert (kein `world.lage` ⇒ alter Pfad der Karte).

| Datei | Was |
|---|---|
| `server/sim/kriegslage-wissen.js` | Wissensmodell (Action-Layer). **Sensorknoten:** römische Häfen, Posten, Flotten (aus der Sim) und die Lerche (Hex des Schiffs nach dem Sprung). **Sichtweite** `sicht.weite` (2) Sprünge im Flottennetz (`Daten.abstand`), **Verzögerung** `sicht.verzoegerung` (1 Tick) aus dem Zustand des Vor-Ticks (kriegslage.tick übergibt das Abbild, das es für den Rückfall ohnehin zieht; kein Zeitpuffer): eigene Gebiete und Flotten exakt (Alter 0), fremde in Sicht mit Alter 1, außerhalb der letzte Stand mit wachsendem Alter (Plakette entfällt nach `altMax` 12, der Hex behält Besitzer und Alter), nie gesehen = **Kartenstand** (Besitz laut Karte, Alter „?“). Ein Hex, den Rom verloren hat, zeigt sofort den neuen Besitzer. `zusatzSicht(game, seit)` ist der **Erweiterungspunkt** für SUND-03 (Weitscan, Konkordat-Belege, weitere Sonden-Quellen) und liefert heute die von einer Sonde gesichteten Hexe (`Sektorplan.gesichtet`, q `sonde`); die Sichtung zählt **sofort und ohne Verzögerung** (Hook in `Sektorplan.sichten`, kein Tick nötig). |
| `server/weltsim/wirkungen.js` | SUND-02 B: Wirkungen der Crew (Katalog `flotte_verlust`, `abwehr_verlust`, `flaggschiff_gefallen`, `ort_gehalten`, `ort_gefallen`), Prüfer `pruefe(zustand, wirkung)`, Eintrag in `Kern.WIRKUNGEN`; `Kriegslage.szeneAbschliessen` (Szenenende ohne Sprung: Wirkungen + ein Tick) und `wirkungenVormerken` (Flucht per Sprung: der Sprung-Tick wendet sie an); Weltstand `welt.sim.kommandanten` und `welt.sim.vorgemerkt` additiv, Version bleibt 3. Test: `tools/test-wirkungen.js` |
| `server/sim/kriegslage.js` | Haken: `starten`, `tick(game, wo, nachOrt)` (ruft `Wissen.nachTick`), `toSave/restore` (Block `welt.sim.wissen`), `nachLaden` (Notruf-Marken neu), `sondeGesichtet`, `lage`, `lageSchluessel` |
| `public/js/karte-lage.js` | Zeichencode der Übersichtskarte (Flächen mit Besitzermuster, Dunkel, Sichtgrenze, Front-Bake, Plaketten, Kurs, Vermutung, Belagerung mit zwei Plaketten, Spalte mit Ortsinfo, Meldeliste, Legende, Lagefunk-Liste). Läuft in Browser und Node |
| `tools/test-lage-wissen.js`, `tools/test-lage-karte.js` | Tests (in `npm test`): 102 Prüfungen Server (Sichtweite, Verzögerung, exakt, Altstand, Lerche, Sonde, nie mehr als gesehen, Funk, Schnellsprung, Laden, Notruf-Marken, Größe, drei Verbindungen, Snapshot ohne Sim-Zustand, Kampagne ohne Block, Speichern/Laden, Altstand ohne Wissen) und 65 Client (Fake-Canvas, `StarMap.draw` mit und ohne `world.lage`) |
| `tools/sicht-lage.js` | Sichtprüfung im echten Spiel: Server im selben Prozess (Sim-Zustand wird präpariert, das Wissen rechnet der echte Server), echter Client in Playwright; Bilder in einen frei wählbaren Ordner (`--shots`) |
| `tools/snap-mess.js` | Aufbau „freie_fahrt“ trägt jetzt den Worst Case von `world.lage` (12 Flotten mit allen Feldern, 6 Meldungen, in jedem Snapshot, der nach den Slots Platz hat) |

**Block `world.lage`** (nur im Modus, nur bei Änderung, für alle Clients gleich, nie im Snapshot mit Asteroiden, Ortsliste, Logbuch oder Buch; Format: `shared/protocol.js`, Vorlage: Designer §12, ergänzt um `sw` und die Altersschrift ohne `e`):

```json
{"t":43,"vz":1,"sw":2,"hx":"rererererererere-1k1-1-?p?Rek1-1p?-1k1-?v?g1g?v?g?g?g?g?g?g?",
 "f":[{"f":"g","h":"0803","k":3,"p":"s","a":1,"d":1},{"f":"r","h":"0405","k":2,"p":"u","a":0,"n":"0505"}],
 "m":[{"e":"sa","h":"0803","t":43,"f":"g","k":3}]}
```

2 Flotten und 1 Meldung: 244 B; **Worst Case** 12 Flotten (alle Felder `n`, `z`, `d`) und 6 Meldungen: **1191 B** (Ziel ≤ 1,2 KB). `hx` hat zwei Zeichen je Kartenhex (Reihenfolge `Object.keys(karte.hexe).sort()`): Besitzer `r g k p - v` (groß = Posten) und Alter: `e` jetzt, `1`–`9` `a`–`d` `f`–`z` Ticks (**ohne `e`**, es heißt „jetzt“; `KarteTokens.alterZeichen/alterLesen`), `?` nie gesehen. `snap:mess` (Freie Fahrt Sund, 4 Spieler, 8 Jäger, Posten, Block in jedem freien Snapshot): **max 9791 B** (Ziel ≤ 18 944 B, Luft zur Grenze 20 480 B: 10 689 B); alle anderen Aufbauten unverändert.

**Regeln.** Ziel beim Sammeln **unbekannt** (kein Feld `z`, kein Ziel im Block); beim Marsch eine **Schätzung** `z` (erstes römisches Hafen- oder Postenziel auf einem kürzesten Weg über das nächste Hex, nie die Absicht der KI; `n` ist die Marschrichtung, eine Peilung wie ein Sensor sie liefert); Belagerung: das Hex selbst, der belagerte Hafen zeigt zwei Plaketten (Angreifer, Verteidiger). **Funk** (`radio` mit `lage: 1`, `tick`; dazu ein Logbucheintrag): bei **Sammelbeginn** (Pflicht), **Belagerungsbeginn** und **Fall** eines Hafens oder Postens; der Marsch funkt nicht (nur Karte). Die Meldungen entstehen aus dem **gesehenen Zustand** (Feldzug-Id + Phase, gemerkt in `wissen.gesehen`, gespeichert), nicht aus Ereignissen: einmal je Feldzug, im Schnellsprung nie doppelt und nie verloren, nach dem Laden nicht erneut. Ein Sammeln, das Rom erst später sieht (Posten gegründet, Sonde), wird bei der Entdeckung einmal gefunkt. Hafen gefallen, Posten verloren und gegründet, Angriff abgewehrt und Notruf kommen aus den Sim-Ereignissen: eigene sofort, fremde einen Tick später und nur, wenn gesehen. **Notruf-Marken** (`server/sim/marken.js`, `lage:a<Feldzug>`) entstehen so und enden mit dem Feldzug; die Notrufe der Kampagne (`notrufe.js`) sind unberührt.

**Client.** `starmap.js` zeichnet mit `world.lage` die Übersicht (Ausgangsansicht: alle 30 Kartenhexe ohne Ring, ohne innere Seitenleiste, Hexradius 23,65, keine Koordinate im Hex); **M** wechselt Übersicht ↔ Nahansicht (Lerche + 2 Sprünge, Hexradius ≤ 40); Zoom, Verschieben, `0` wie vorher. Die rechte Spalte der Captain-Konsole (`consoles.js capStarLage`) zeigt Ortsinfo mit Wissenszeile (folgt dem überfahrenen Hex), Meldeliste, Sprung und Legende; im Funk-Reiter steht der **Lagefunk** (letzte Meldungen, roter Streifen) neben dem Logbuch. Die Funk-Einblendung (6 s, roter Streifen) liegt an der Konsole **über** der Konsole (`Hud.drawLagefunk`, von `client.js` nach der Konsole gezeichnet); mehrere Lagemeldungen kurz hintereinander laufen nacheinander (die nächste rückt nach 3,5 s nach; alle stehen im Logbuch).

**Geteilte Dateien (kleine, lokale Änderungen):** `server/game.js` (`world.lage` im Snapshot, `sentLageKey` an den vier Neuverbindungs-Stellen), `content/schema/weltstand.schema.json` (`welt.sim.wissen`, keine Versionserhöhung), `shared/protocol.js` (Dokumentation), `public/js/starmap.js`, `consoles.js` (`capStarLage`, Lagefunk im Funk-Reiter, 3 kleine Haken), `hud.js` (`onRadio` mit Lagefunk und Warteschlange, `radioAktuell`, `drawLagefunk`, Akzentstreifen), `client.js` (2 Zeilen), `index.html` (ein Script), `package.json`; außerdem `server/sim/sprung.js` (Ziel-Ort an `Kriegslage.tick`, 2 Zeilen), `server/sim/sektorplan.js` (Hook der Sonden-Sichtung), `public/js/karte-tokens.js` (Alterszeichen ohne Kollision mit `e`, Kurztext `dunkelKurz`).

## Neu in SUND-01 Paket B – Kopplung: Modus „Freie Fahrt Sund“, Weltstand, Tick je Sprung

Die Weltsimulation (Paket A) läuft jetzt im Spiel, **nur** im neuen Lobby-Modus „Freie Fahrt Sund“ (`freie_fahrt`, Taste **M**, nach „Die Schuld der Lerche“). Kampagnen, Limes, Tutorial, Labor und Arena sind unverändert: dort ist `game.weltsim` `null`, es gibt keinen Tick und keinen Block im Weltstand. Es gibt in B **keinen** Snapshot-Block und keine Client-Anzeige außer dem Lobby-Eintrag (Karte und Meldungen: Paket C).

| Datei | Was |
|---|---|
| `server/sim/kriegslage.js` | Kopplung (Action-Layer). `game.weltsim = { zustand, tickZahl, fehler, ereignisse[], hauptweltGefallen }`; `starten(game, seed?)`, `tick(game, quelle)`, `szeneNachziehen(game)`, `nachLaden(game)`, `toSave`/`restore`/`reset`. Füllt `game.weltBesitz.hexe` (Paket D) für alle Sim-Hexe (Sim `kon` heißt dort `saum`, frei heißt `frei`; Sonderorte außerhalb der Sim bleiben statisch). Rohereignisse der Sim liegen in einem Ring von 120 Einträgen **auf dem Server** (nicht gespeichert, nicht im Snapshot), daraus baut Paket C das Wissen von Rom |
| `tools/test-weltsim-kopplung.js` | Test (in `npm test`, ca. 3 s): Modusstart, Tick-Folge, Kampagne ohne Sim, Speichern/Neustart/Laden mit Tiefenvergleich, Altstände, Schema, Besitz-Overlay, `game.rng`, Hauptwelt, `dockOk` |
| `tools/sim-freie-fahrt.js` | Bot-Lauf ohne Spielleiter: `npm run sim:freie-fahrt -- --spruenge 100 [--minuten 30] [--seed 7]` (echte Sprünge im Zufallsgang, prüft Ticks == Sprünge, Fehler, Weltveränderung, Stillstand) |
| `tools/snap-mess.js` | neuer Aufbau „freie_fahrt“ (4 Spieler, Hafen mit Banner und Posten mit Fahne, 8 Jäger) |

**Ein Tick je Sprung.** Der Hook `Kriegslage.tick` sitzt in `sprung.js` **direkt vor dem Szenenaufbau** (`enterScene`): in `springeNach` (Normalsprung **und** jeder Hop des Schnellsprungs, `reise.hop` ruft `springeNach`) und im Notfallsprung (je Ausführung, auch beim Rückfall in denselben Sektor; dann `szeneNachziehen`). Banner und Besitz der Ankunftsszene entsprechen so dem Stand nach dem Tick. Kein Tick beim Andocken, Warten, Ablegen, Planen einer Route, Start des Schnellsprungs ohne Hop, `debugGoto` und anderen Szenenwechseln ohne Sprung. Die Sim hat ihren **eigenen Zufallsstrom** (`zustand.zufall`, Seed aus dem Spiel-Seed) und fasst `game.rng` nie an. Wirft die Sim, wird der Fehler mit `game.countError('kriegslage-tick')` gezählt, der Zustand auf den Stand vor dem Tick zurückgesetzt und der Tick übersprungen; das Spiel läuft weiter.

**Modus.** `startGame`: Karte `sund_frei`, Weltstand wie bei den Kampagnen (persistent, Fakt `welt_karte`), **keine Kette, kein Spielleiter, keine Mission** (`mission.activeId` bleibt `null`, eine leere Rahmenmission war nicht nötig: das Spiel läuft ohne laufende Mission, wie zwischen zwei Missionen). Die Crew steht angedockt in Ostia Nova (Start der Karte). Beim Fortsetzen setzt `Kriegslage.nachLaden` `mission.mode` zurück auf `null` (`mission.restore` setzt `campaign`, das würde Angebote der Limes-Kampagne zulassen) und berechnet `space.dockOk` neu.

**Weltstand.** Keine Versionserhöhung (bleibt 3): neuer optionaler Block `welt.sim` = `{ modus: 'freie_fahrt', tick, hauptweltGefallen?, zustand }`; `zustand` ist der Sim-Zustand **ohne `werte` und `karte`** (beim Laden kommen beide frisch aus `content/welt/sund-sim.json` und `sund-sim-werte.json`; ein Stand läuft also immer mit den aktuellen Werten, ändert man Gefechtstempo und Co. in der Datei, gilt das auch für alte Stände). Fehlt der Block, ist der Stand eine Kampagne (`game.weltsim` bleibt `null`, Altstände laden unverändert). Ein Block mit unbrauchbarem Zustand (z. B. Hexe fehlen) wird als Fehler gezählt, die Welt neu erzeugt, der Tick-Zähler bleibt.

**Gespeichert wird weiter nur angedockt** (`saveWorld`/`updateWeltstand`, außer `missionDone`). Schiffsort und Welt bleiben dadurch konsistent; ein Absturz zwischen zwei Docks setzt auf das letzte Dock zurück (Welt und Schiff beide).

**Hauptwelt.** Fällt Palatina (`hauptwelt_gefallen` mit `alt: rom`), setzt die Kopplung `weltsim.hauptweltGefallen = { fraktion: 'rom', tick }` (gespeichert), meldet per `game.oda` den Platzhalter „Palatina ist gefallen.“ (einmal je Spiel) und löst das Missionsereignis `hauptwelt_gefallen` aus; das Spiel läuft weiter (Abspann: SUND-04). Hrafnheim: Ereignis und „Hrafnheim ist gefallen.“, kein Merker.

Bekannt, nicht Teil von B: Sprungziele brauchen wie in der Kampagne Sund eine gefundene Boje (Weitscan). Debug-Befehle, die Szenen ohne Sprung wechseln, ticken die Welt nicht.

## Neu in SUND-01 Paket A – Sim-Kern der Weltsimulation (`server/weltsim/`)

Reines Modul, noch nicht an Server, Weltstand oder Client angeschlossen (Pakete B und C). Port von `Vault/Pantheon/Welt/sim_sund.py`: Wirtschaft (T M U E N, Bevölkerung, Marken, Unterhalt, Verschleiß im Feld, Neubau), abstrakter Handel des Konkordats, Standard-KI (Angriff, Beanspruchen, Posten), Stützpunkt-Phasen (Sammeln, Marsch, Belagerung, Rückzug), Gefecht samt Verteidigung ohne Flotte, Eroberung, Piratenüberfälle. **Alle Zahlen stehen in `content/welt/sund-sim-werte.json`**, kein Timer, kein Thread, kein `Math.random`/`Date.now`, nur `tick()` ändert den Zustand.

| Datei | Was |
|---|---|
| `server/weltsim/kern.js` | `erzeuge({ karte, werte, seed })` → Zustand (reine JSON-Daten, Flotten und Feldzüge über Ids), `tick(zustand, { wirkungen, absichten, messung })` → `{ zustand, ereignisse }`; lesende Hilfen `besitzer`, `istPosten`, `flottenAm`, `abstand`, `staerkeKlasse`. `tick` **verändert** den Zustand und gibt ihn zurück (vorher klonen, wenn der alte Stand gebraucht wird) |
| `server/weltsim/daten.js` | lädt und prüft Karte und Werte (`laden()`, einzige Stelle mit Dateizugriff), baut Nachbarschaft, BFS-Abstände und nächste Schritte für das Flottennetz (offene Kanten) und das Piratennetz |
| `server/weltsim/zufall.js` | mulberry32, der Zustand ist eine Zahl in `zustand.zufall` (n Ticks, speichern, laden, n Ticks = 2n Ticks) |
| `server/weltsim/ereignisse.js` | Ereignistypen und ihre Felder (`flotte_aufbruch`, `flotte_sammelt`, `flotte_marsch`, `flotte_belagert`, `angriff_abgewehrt`, `angriff_abgebrochen`, `hafen_gefallen`, `posten_gegruendet`, `posten_verloren`, `konvoi`, `notruf`, `hauptwelt_gefallen`) |
| `server/weltsim/kennzahlen.js` | Messung für Werkzeuge und Tests (nicht Teil des Zustands): Kennzahlen, Eingreif-Fenster, Sicht |
| `tools/sim-welt.js` | headless: `npm run sim:welt -- --laeufe 100 --ticks 300 --seed0 0 [--wert k=0.25 ...] [--sicht]` |
| `tools/test-welt-sim.js` | Test (in `npm test`, ca. 5 s): Determinismus, Serialisierung, Reinheit, Daten statt Code, Kennzahlenbänder, Ereignisse, Hostilität |
| `tools/sim-welt-paritaet.js` | Paritätsprobe: mit Python-Zufall und der Hexreihenfolge des Prototyps liefert der Port je Seed dieselben Zahlen wie `sim_sund.py` (`npm run sim:welt-paritaet`, nicht in `npm test`) |

Erweiterungspunkte: `Kern.WIRKUNGEN` (Typ → Funktion, leer, für SUND-02; unbekannter Typ in `tick` wirft) und `zustand.absichten[fraktion]` mit `p_act`, `aggr`, `max_active` (für SUND-03). Neu in den Werten gegenüber P0: `staerkeklassen` (Schwellen klein/mittel/groß) und `konvoi.min_menge`.

## Neu in SUND-01 P0 – Daten der Weltsimulation „Freie Fahrt Sund“

Nur Daten und Prüfer, kein Spiel- oder Servercode (die Simulation selbst folgt in SUND-01 Paket A). Kette: `sund.json` (Kampagne, **unverändert**) → `tools/gen-sund-frei.js` → `sund_frei.json` → `tools/gen-sund-sim.js` → `sund-sim.json`.

| Datei | Was |
|---|---|
| `content/welt/sund_frei.json` | Karte des Modus Freie Fahrt Sund (id `sund_frei`, Unterstrich, weil `Welt.karte` nur `[a-z][a-z0-9_]*` als Id zulässt), **abgeleitet** aus `sund.json` plus Overlay: dazu **Brachland 0505** und **Saatfeld 0705** (freie Sektoren, Quelle N) und die 6 Kanten des Prototyps 0405–0505, 0505–0605, **0605–0705 (fest offen)**, 0705–0805, 0504–0505, 0704–0705; Start Ostia Nova 0305 (angedockt, `boden:false`, dafür bekommt 0305 minimal `ort/gen/spielbar/andocken`). Alles Übrige (Sonderorte, Schlüsselkanten) wie in `sund.json`; `spielbar`/`andocken` für die anderen Hexe setzt Paket D. Die Kampagne bleibt auf `sund.json` (dort ist 0605–0705 der temporäre Sprungpunkt des Notrufs `sl_echt`). |
| `content/welt/sund-sim.json` | Format `weltsim-karte/1`, **abgeleitet** aus `sund_frei.json` (nicht von Hand ändern): je Sim-Hex `code, name, simFraktion` (rom, ger, kon, pirat, null = frei), `hafenklasse`, `quellen` (Güter T M U E N); Kanten mit `art`, `flotte` (nur offene Kanten) und `piraten` (alle Kanten). Sonderorte Bojenfeld, Vorläufer-Sektor und Helix sind nicht enthalten. |
| `content/welt/sund-sim-werte.json` | Format `weltsim-werte/1`: alle `DEFAULT`-Werte des Prototyps `sim_sund.py` mit den Vorgaben aus SUND-01 (stuetz, feld_decay 0,015, overext 0, k 0,10, sammeln 3–8, stuetz_cap 6, claim_ticks 3, garrison 4), dazu Bevölkerung je Hafenklasse, Punktwerte je Schiffsklasse (Jäger 1, Korvette 2, Fregatte 4, Kreuzer 7) und Sicht (2 Sprünge, 1 Tick Verzögerung). Jeder Wert mit `einheit` und `_hinweis`. |
| `tools/gen-sund-frei.js` | erzeugt `sund_frei.json` aus `sund.json` + Overlay; `--pruefen` meldet Abdrift (`npm run gen:sund-frei`) |
| `tools/gen-sund-sim.js` | erzeugt `sund-sim.json` aus `sund_frei.json` + kleiner Gütertabelle; `--pruefen` (`npm run gen:sund-sim`) |
| `tools/test-sund-sim-daten.js` | prüft: `sund.json` unberührt (28 Hexe, 34 Kanten, kein 0505/0705), Ableitungen, Hexmengen, Spiegelsymmetrie Rom/Germanen (Hexe und Kanten), 8+8+3 Häfen, 2 Piratenlager, Hauptwelten, Werte (`npm run test:sund-sim-daten`, in `npm test` vor `test-erreichbar`). `tools/test-welt.js` prüft `sund_frei` mit (Geometrie, Kanten, Erreichbarkeit der spielbaren Hexe). |

Hafenklassen in der Sim: nur Rom, Germanen und Konkordat haben Häfen (wie im Prototyp). Kantenstein (D) und Pulverhorn (C) tragen eine Klasse für die Kampagne; die Sim behandelt sie als freie Sektoren. Der Auswahlmechanismus des Modus (Lobby, `Welt.waehle`) folgt in Paket B.
## Neu in PAN-01 D (Server und Daten) – Werft der Flottenbasen (`CONTRACT-PAN01-D.md`)

Auftrag PAN-01, Paket D, Teil 1 (Branch `pan01-d`, baut auf `pan01-c` auf; das Terminal selbst folgt in D2). **Einmal kaufen (Freischalten), gratis umbauen (Umbauen), nur angedockt
an einer Flottenbasis, jeder Spieler am Terminal darf.** Alles serverseitig in `server/sim/werft.js`.

- **Ortsfeld `flottenbasis`** in `content/welt/limes.json` (Castra Martis) und `sund.json` (Castra Gradivi), durchgereicht von `shared/gen-sektor.js` als `loc.flottenbasis`; feindliche Basen tragen es nicht.
  Weitere Werften (Flottenstützpunkte der Weltsimulation) setzt später ein Modul per `Werft.setzeFlottenbasis(game, ort)`. Handel (`shop.buy`) läuft überall wie bisher.
- **Befehle** (Konsole `shop` = Handelskonsole im Meetingraum): `werft.freischalten { art: 'stufe'|'waffe'|'modul', id }`, `werft.umbau { platz 1–9, waffe | 'leer' }`, `werft.modul { raum 1–4, id | 'leer' }`.
  Antwort an den Absender: Ereignis `werftAntwort { op, ok, code?, text? }`, bei Erfolg an alle `werft`. Snapshot-Block `werft` (nur solange jemand am Terminal sitzt; gemessen 446 B frisch, 553 B voll ausgebaut, Testgrenze ≤ 700 B).
- **Preise** in `CONFIG.werft.preise`: Ausbaustufe 1/2/3 100/180/900, Standardkanone 40, Sturmbatterie 60, Streubatterie 70, Abwehrturm 70, Torpedowerfer 100, Lanzenbatterie 120, Werkstatt 40;
  Stufe 1 und 2 plus zwei wichtige Waffen sind in der Kampagne an Castra Martis erreichbar, Stufe 3 gehört ins freie Spiel (Messung: `CONTRACT-PAN01-D.md` §4).
- **Weltstand** `schiff.freigeschaltet { stufe, waffen[], module[] }` (Format bleibt 3, Feld optional): fehlt es, gilt alles am Schiff als freigeschaltet.
- **Terminal (D2)** `public/js/terminal-ui.js` + `pult-terminal-tokens.js`: Handelskonsole im Meetingraum (E, Konsole `shop`). Tasten (umbelegbar, Gruppe Terminal): `H` Handel, `W` Werft, `1`–`9` Waffenplatz, `F1`–`F4` Modulraum, `↑↓` Teil, `Enter` bestätigen (Umbau gratis, im Handel kaufen), `F` freischalten (Marken), `A` Ausbau, `Esc` verlassen. Vorschau vor dem Bestätigen, Fehlermeldungen vom Server als Text. Ein Nutzer am Gerät, Mitspieler sehen mit E zu. Browser-Test: `node tools/pw-werft-ui.js` (Debug-Server), headless: `node tools/test-werft-ui.js`.
  Ausprobieren: `npm run debug`, `?debug=1`, in der Browser-Konsole `__game.debugCmd('goto', {loc: 'castra_martis', docked: true})`, `__game.debugCmd('marken', {args: '1000'})`, E an der Handelskonsole.
- **Testumgebung der Werft (Kai 2026-10-22):** In den Test- und Wellenmodi (Lobby, Taste M: Raumkampf Wellen All, Bodenkampf Wellen, Szenario-Labor, Testgelände) startet die Crew mit **5000 Marken** (`CONFIG.werft.testmarken`) und die Werft des Terminals ist **überall aktiv, auch abgedockt** (Kopf „Testumgebung“); Handel, Umbauen und Freischalten gehen jederzeit. In Wellen All und Wellen Boden beginnt zuerst eine **Rüstphase** (Crew an Bord, nichts läuft): im Meetingraum an der Handelskonsole E, ausbauen (`A` Ausbau, `F` freischalten, `1`–`9`, `F1`–`F4`, `Enter` umbauen, `H` Handel), dann `G` **Szene starten** (Boden: die Crew beamt hinunter). Kampagne und freies Spiel bleiben bei den Flottenbasen. `RUESTPHASE=0` schaltet die Rüstphase ab. Details und Entscheidungen: `CONTRACT-PAN01-D.md` §15; Browser-Test `node tools/pw-werft-testumgebung.js`.
- **Debug:** `marken <n>`, `werft status`, `werft freischalten alle`, `werft reset` (zusätzlich `ausbau`, `bestueck`, `modul`). Test: `node tools/test-werft.js` (in `npm test`).
  Marken je Kapitel der Kette: `node tools/sim-headless.js kette --crew 1 --seeds 3 --marken`; die Preismessung (16 Läufe) steht in `tools/fixtures/werft-kette-marken.json` (`node tools/messung-kette-marken.js`), `test-werft` bindet die Preise daran.

## Neu in PAN-01 C – Waffenkatalog, neun Waffenplätze, Torpedowerfer (`CONTRACT-PAN01-C.md`)

Auftrag PAN-01 „Lerche-Ausbau, Werft, Waffen und Module“, Paket C (Branch `pan01-c`, baut auf `pan01-b` auf). Leitgedanke: **mehr Plätze heißen mehr Auswahl, nicht mehr
Feuerkraft.** Alle Energiewaffen teilen sich den Ladepool (Waffen-Energie + 2 Punkte, unverändert); der Torpedowerfer liegt außerhalb.

- **Katalog** `shared/schiffskatalog.js` (Server, Client, Gegner, später das Terminal): Standardbatterie, Sturmbatterie, Streubatterie, Lanzenbatterie (Seite) · Lanze, Standardkanone (Bug) ·
  Torpedowerfer, Abwehrturm (Heck). Je Eintrag Wirkung, Energie, Schaden, Ladekosten, Rohre, Bogen, Reichweite, Lafettenmodell, Projektil, Ton, Taktik-Symbol, Munition.
- **Plätze** (Ziffernblock 7 8 9 / 4 5 6 / 1 2 3): Start 8 Lanze · 4 und 6 Standardbatterie; Stufe 1 + 7 9 · Stufe 2 + 2 5 · Stufe 3 + 1 3. Die Bestückung steht in `ship.waffen`
  (Weltstand `schiff.waffen`), jede offene, bestückte Lafette ist ein echtes System `lafette_N` (Treffer, Reparaturweg, Zustand).
- **Ladepool:** bis zu acht Energiewaffen teilen `chargePoints`, `weapons.alloc` verteilt (Q/E wählen, A/D), Standardverteilung reihum Bug, Bb, Stb, Bug 2 …; wer keinen Punkt hat, lädt nicht.
  **Magazindeckel:** der gespeicherte Anfangsstoß aller Energiewaffen zusammen ≤ 36 (= 1,5 × Start-Lerche 24).
- **Projektile statt Sofortstrahl** (Kai 2026-10-18): Standardbatterie (bernsteinfarbener Doppelbolzen), Standardkanone (dicker rotoranger Bolzen), Sturmbatterie (dünne schnelle Nadeln) und der Abwehrturm
  (Funken) schießen langsame, ausweichbare Projektile mit Vorhalt; die Streubatterie wirft verzögerte Granaten, der Torpedo ist ein Lenkgeschoss. **Strahl bleiben nur Lanze und Lanzenbatterie.** Schaden je Treffer = Katalogwert (Batterie und Kanone 2, Sturm 0,7);
  Ladepool, Ladekosten und Magazindeckel unverändert. Arena-Bot innerhalb ≈ ±10 % der Strahl-Werte, Trefferquote 65–77 %.
- **Torpedowerfer** (Heck 2, Stufe 2, aus dem Bolzenwerfer): keine Energie, kein Schildschaden, **Lesart B für alle Ziele: er wirkt nur, wenn der getroffene Schildsektor 0 ist, sonst prallt er ab** (Jäger dann sofort zerstört, Korvette 3 Treffer, Fregatte 6), Cooldown 10 s, Lager hart 12
  (Start 6), Heckbogen 60 Grad. Gegner tragen ihn nur gezielt; ihr Torpedo gilt derselbe Maßstab gegen die Lerche (stehender Schild: abgeprallt; Schild 0: höchstens ein Drittel der Hülle, 30 von 100), ist ausweichbar und vom Abwehrturm abschießbar.
- **Gegner** aus demselben Katalog (`lanze | batterie | bolzen` werden auf Lanze/Lanzenbatterie, Standardbatterie, Standardkanone abgebildet, das Verhalten bleibt), der Ziel-Scan zeigt Waffen und Module.
- **Debug** (`npm run debug`, Browser `?debug=1`): `bestueck <platz 1-9> <waffe-id|leer>`, `bestueck alle [stufe]`, `bestueck start`, `bestueck status`, `ausbau <0-3>`,
  `spawn <kind> [<platz>=<waffe> …]` (Platz bug|stbd|bb, Waffe = lanze|batterie|bolzen oder Katalog-Id), `inv` (Torpedos, höchstens 12). Ablauf für Kai: `CONTRACT-PAN01-C.md` §12.
- **Messungen:** `node tools/pan01-feuerkraft-messung.js` (3/5/7/9 Waffen, gleicher Pool), `node tools/pan01-energie-bot.js --set "w3;w5;w7;w9"` (Arena-Bot), `node tools/pan01-torpedo-messung.js [--bot]`
  (Treffer bis Zerstörung, Cooldown, Heckbogen). Tests: `node tools/test-waffen-schiff.js` (in `npm test`).

## Neu in der Eisenwald-Kampagne (EK1–EK8)

Eine feste Kampagne ohne Spielleiter: Statio Limitis → Rabenpass → Nebelheim → Methalle → Castra Martis → Eisenwald
(Orbit, dann Siedlung) → Abspann. Alle acht Kapitel sind echte Szenen (keine Platzhalter mehr). Detailabschnitte stehen darunter,
Verträge, Stand und bekannte Abweichungen im Index `CONTRACT-EK.md`.

| Paket | Kern | Vertrag | Testbefehl |
|---|---|---|---|
| EK1a | Korvette statt Kanonenboot: Schilde 1/2/0/2, Waffenplätze, zufällige Bestückung (Lanze, Batterie, Bolzen) | `CONTRACT-EK1.md` | `node tools/test-combat.js` (Teil von `npm test`) |
| EK1b | Fregatte und Kreuzer, Schildsegmente je Seite (`shared/schilde.js`), Breitseiten-KI mit Klassenparametern, Drehsprites | `CONTRACT-EK1.md` | `npm run test:klassen` |
| EK2 | Raum-Alarm: Alarmstufen, Minen, Patrouillen, Schleichfahrt (A13), Ausgang „Rückzug“ | `CONTRACT-EK2.md` | `npm run test:alarm` |
| EK3 A | Frachtraum, Fracht beamen und abliefern, Ladung im Weltstand | `CONTRACT-EK3.md` | `npm run test:lager` |
| EK3 B | Konvoi-Szene (A15): Transporter, Eskorte, Plündern oder Aufhalten | `CONTRACT-EK3B.md` | `npm run test:konvoi` |
| EK4 | Verbündete, Flottenbefehle, Legat mit Gedächtnis, Funkporträt; Orbitschlacht Eisenwald (Kapitel 6) | `CONTRACT-EK4.md` (Abschnitt 6: Orbit) | `npm run test:flotte`, `npm run test:orbit` |
| EK5 | Methalle: Generator-Variante mit Rohr, Sprengstoff platzieren, Wachen und Nachschub | `CONTRACT-EK5-6.md` | `npm run test:methalle` |
| EK6 | Siedlung Eisenwald: Feldzeichen hissen (zwei gemeinsam), 10 Gegner und Anführer | `CONTRACT-EK5-6.md` | `npm run test:eisenwald` |
| EK7 | Karte: 15 Hexe der Kette aus Daten, Schlüssel `sperrriegel`, Häfen Castra Martis und Statio Limitis | `CONTRACT-EK7.md` | `npm run check` (darin `tools/check-sektoren.js`), `npm run test:sektoren`, `node tools/sprungkette.js` |
| EK8 | Kapitelsteuerung: feste Kette als Datei, Lobby-Modi, Abspann, Funkbild, Labor-Einstiege, Bot-Modus `kette` | `CONTRACT-EK8.md` | `npm run check:kette`, `npm run test:kette`, `npm run sim:kette` |

### Kampagne Eisenwald starten und testen

**Server:**
- `npm install` (einmalig), dann `npm start` (`node --env-file-if-exists=.env server/index.js`, Port 3300, zeigt Raumcode und Link).
- `npm run debug` startet mit `--debug`: Debug-Befehle (`__game.send({ t: 'debug', cmd: … })` in der Browserkonsole) und `?debug=1` im Client.
  `npm run werkstatt` ist `--debug --werkstatt` (Modulbestand neu laden mit F9, `server/index.js`).

**Lobby-Modi** (Taste **M** schaltet durch, `Shared_Protocol.LOBBY_MODI`):
- **„Kampagne Eisenwald“** (`eisenwald`): erst das Tutorial (m1–m3), danach die feste Kette ab Statio Limitis. Kein Spielleiter.
- **„Eisenwald ohne Tutorial“** (`eisenwald_ohne`): Kapitel 1 sofort, das Tutorial gilt als übersprungen. Der richtige Modus zum Testen und Wiederspielen.
- Beide haben Weltstand wie jede Kampagne (Taste **F** öffnet die Weltstand-Liste, Fortsetzen: Kapitel beginnt am gespeicherten Schritt neu).
- **„Szenario-Labor“** (`labor`): jede verfügbare Katalog-Umsetzung einzeln starten (↑/↓ wählt), z. B. `konvoi_abfangen/pluendern`,
  `unbemerkt_durchfliegen/patrouillen_schleichfahrt`, `kurs_durch_gefahr/minenfeld`, `flottenbefehl/*`, `sabotieren/sprengstoff_platzieren`,
  `stellung_nehmen/flagge_hissen`. Nur mit `CONFIG.lobby.labor` (heute `true`).

**Einstieg in ein Kapitel (Debug):** `kapitel <id>` mit `k1_anwerbung` … `k8_sieg` (z. B. `k4_methalle`). Der Zustand davor (Ort, Flags, Fakten,
Fracht, Schlüssel; Daten im Feld `einstieg` von `content/kampagne/eisenwald.json`) wird hergestellt. Aus der Lobby startet der Befehl selbst
`eisenwald_ohne`; ohne Kette meldet er „Keine Kampagnenkette aktiv“. Ohne `<id>` listet er die Kapitel.
Weitere Debug-Befehle der Pakete: `konvoi [n] [aufhalten|pluendern] [voll|jaeger|korvette|keine]`, `flotte aufstellen|befehl|welle|neustart|status`,
`fracht abwerfen|an|leer|gesichert|abnehmer|status`, `tp <x> <y>`, `buehne … <methalle|eisenwald>`.

**Bots** (`tools/sim-headless.js`, Modus je erstes Argument):
- `node tools/sim-headless.js kette [--kapitel alle|<id>] [--von <id>] [--crew 1|3] [--seeds N] [--seed S] [--tutorial]`: ohne `--kapitel` die ganze Kette bis zum
  Abspann, mit `--kapitel alle` der Labor-Einstieg je Kapitel. Kurzform `npm run sim:kette` (Argumente nach `--`).
- `node tools/sim-headless.js flotte [--seeds N]`: die fünf Flottenbefehle, solo und zu dritt.
- `node tools/sim-headless.js labor <molekül/umsetzung> [--crew 1|3] [--seeds N]` (Alias `umsetzung`), `labor ketten` (nur die Ketten), `labor alle`.
- Weiter: `wellen`, `arena`, `escort`, `archiv`, `dauer` (siehe Kopf von `sim-headless.js`).

**Prüfer und Messwerkzeuge:**
- `npm run check:kette` (Kette und Kapitelbücher, `-- --selftest`), Teil von `npm run check` (= `check-maps`, `check-sektoren`, `check-kette`).
- `npm run snap:mess` (`tools/snap-mess.js`): Snapshot-Größe je Aufbau (worst, wellen, raum-alarm, methalle, endkampf, konvoi, flotte, orbit), Ziel ≤ 18 944 B
  (Grenze `CONFIG.net.snapMax` 20 480 B minus `snapLuft` 1 536 B).
- Golden Trace (Tutorial m1–m3 darf sich nicht verändern):
  `node tools/golden-trace.js --all --seeds 20 --jobs 4 --dir <neuer Ordner>`, dann
  `node tools/golden-trace.js --compare tools/fixtures/golden/base-w2 <neuer Ordner> --allow tools/fixtures/golden/allow-ek1.json`.
  `golden-trace.js` nimmt nur **eine** `--allow`-Datei; `allow-ek1.json` enthält deshalb die Einträge von `allow-w2.json` mit. Immer `--dir` angeben: ohne `--dir` schreibt `--all` in die eingecheckte Basis `tools/fixtures/golden/base`. Den Ordner danach löschen.

**`npm test`** (verkettet mit `&&`, bricht am ersten roten Test ab) führt nacheinander aus: `test-features`, `test-combat`, `test-klassen`, `test-m3`, `test-flight`,
`test-escort`, `test-bausteine`, `test-regiebuch`, `test-weltstand`, `test-spielleiter --strict`, `test-ablage`, `test-buehne`, `test-generatoren`, `test-waffen`,
`test-sektoren`, `test-entern`, `test-wellen`, `test-labor`, `test-wellen-all`, `test-alarm`, `test-lager`, `test-methalle`, `test-eisenwald`, `test-konvoi`,
`test-flotte`, `test-kette`, `test-orbit` (alle in `tools/`). Lauf vom 2026-10-11 auf `ek1`: Exit 0; Prüfungen u. a. Features 213, Kampf 387, Klassen 59, M3 380,
Flug 80, Escort 84, Bausteine 174, Regiebuch 186, Weltstand 170, Ablage 23, Bühne 470, Generatoren 15, Waffen 132, Sektoren 132, Entern 66, Wellen 54, Labor 41,
Wellen All 68, Alarm 145, Lager 115, Methalle 57, Eisenwald 58, Konvoi 116, Flotte 119, Kette 162, Orbit 69. `npm run check`: Karten 586/586, Sektoren 303/303, Kette OK.

## Neu in EK8 – Kampagne Eisenwald: die feste Kette

- **Lobby-Modus „Kampagne Eisenwald“** (Taste M; mit Tutorial) und **„Eisenwald ohne Tutorial“** (direkt ab Lichtkordon): Wie jede Kampagne mit
  Weltstand (Speichern, Fortsetzen), aber **ohne Spielleiter**. Die Reihenfolge ist fest: Statio Limitis (Anwerbung, Funk von Mars) → Rabenpass
  (Konvoi plündern, Fracht beamen, in der Statio abgeben) → Nebelheim (Schleichfahrt mit Patrouillen und Minen) → Methalle (Sprengstoff) →
  Castra Martis (Legat, Briefing) → Eisenwald (Orbitschlacht, dann Siedlung mit Flagge) → Sieg und **Abspann**. Danach gibt es **kein freies Spiel**:
  Enter im Abspann führt ins Hauptmenü (beendet die Partie für alle, der Weltstand bleibt).
- **Kein Spielleiter, keine Schnellroute:** Den Weg findet man selbst (Sternkarte, **Weitscan** zeigt Bojen). Fortschritt gibt es nur durch erreichte
  Missionsziele. **Der Feldzug scheitert nie:** Scheitert eine Szene (Rückzug per Notfallsprung, Notrückholung am Boden), beginnt sie von vorn; jede Szene hat einen Ausgang.
- **Gespeichert** wird an jedem Kapitelübergang und beim Andocken (Weltstand: Kapitel als Fakten `kampagne`, `kapitel`, Flags, Ladung im Frachtraum,
  Legat mit Gedächtnis). Mitte aufhören und weitermachen geht: Das Kapitel beginnt am gespeicherten Schritt neu, die Lerche liegt im letzten Hafen.
- **Alle acht Kapitel sind echte Szenen** (`npm run check:kette` meldet 0 Platzhalter-Schritte): Kapitel 2 Konvoi (EK3 B), 3 Schleichfahrt (EK2), 4 Methalle (EK5),
  6 Orbitschlacht (EK4, drei Flottenbefehle, Boss-Fregatte), 7 Siedlung mit Flagge und Anführer (EK6). Liste, Schnittstellen und Flags: `CONTRACT-EK8.md`.
- **Solo-Regeln** (nur bei höchstens einem verbundenen Spieler, Mehrspieler unverändert): Der Konvoi hat nur den Jäger als Eskorte; in der Siedlung hisst ein Legionär
  nach 10 s mit (nur Funk, keine Figur) und der Angriff ist kleiner (5 Gegner plus Anführer statt 10 plus Anführer).
- Funk mit **Funkbild**: Mars als Symbol, der Legat als Porträt. Kapitelkarte bei jedem neuen Kapitel. Texte sind **Entwurf** (Vault: *Funktexte Feldzug Eisenwald*).
- Werkzeuge: siehe „Kampagne Eisenwald starten und testen“ oben.

## Neu in EK7 – Karte: 15 Hexe der Eisenwald-Kette

- 15 spielbare Hexe (Statio Limitis bis Eisenwald) mit **Raumsektoren aus Daten** (`shared/gen-sektor.js`), Schlüssel `sperrriegel` (Baustein `sperrriegel_oeffnen`),
  Häfen mit Liegeplatz in Castra Martis und Statio Limitis. Kurzfassung und Hexliste im Abschnitt „Die Orte“, Details: `CONTRACT-EK7.md`.
- Grenzen heute: Stern, Planeten und Navigationsbojen der Datenorte stehen nur als Daten in der Szene und werden nicht gezeichnet; es gibt keine Reparatur im Hafen
  (nur Vorräte gegen Marken). Siehe `concept/buehnen/OFFEN-STUDIO.md`.
- Prüfung: `npm run check` (Block `[kette]` in `tools/check-sektoren.js`), `npm run test:sektoren`, `node tools/sprungkette.js [--json]` (Bot fliegt die Kette ab).

## Neu in EK5 und EK6 – Methalle und Siedlung Eisenwald

**EK5 Methalle** (Militärsiedlung, ohne Schuss abschließbar):
- Generator-Variante `methalle` (`shared/gen-siedlung.js`): Mauer ohne Tor, **Landefeld mit dem einzigen Abholpunkt außerhalb**,
  **Rohr** (Kachel `r`, 3 Kacheln, sperrt Sicht und Schuss) unter der Mauer als einziger Weg hinein. Prüfer `K-ROHR` und `K-MAUER-DICHT`.
- **Sprengstoff platzieren** statt zünden: Sprengziel mit `modus: platzieren` (`anker.ladungPlatzieren`): keine Explosion, kein Alarm.
  Der Sprengstoff ist ein Gegenstand (`inventory.ladung`, im Snapshot, im Hafen für 150 Marken kaufbar). Nach dem **Hochbeamen** meldet Mars
  „Außenposten zerstört“, der Weltstand setzt den Fakt **`sperrriegel`**.
- **Wachen:** drei Zweiergruppen auf Patrouille, nach dem Platzieren Nachschub aus den Baracken (ruhig, ohne Alarm), nie mehr als 8 gleichzeitig.
- Labor: `sabotieren/sprengstoff_platzieren` (Labor-Landepunkt `splitter.methalle`, nur im Labor sichtbar); in der Kampagne `methalle.siedlung`. Bots schleichen über Kacheln außer Sicht.

**EK6 Siedlung Eisenwald** (Flagge hissen, Endkampf):
- Generator-Variante `eisenwald`: **Feldzeichen** (Rolle `flagge`) in der Mitte des Dorfplatzes. **Zwei hissen gemeinsam** (E halten, der
  Fortschritt bleibt; lebt nur einer, geht es nicht; in der Kampagne gilt solo die Legionär-Regel, siehe EK8). Dann greifen **10 Gegner und ein Anführer** von allen Seiten an, sonst kein Spawn.
- **Anführer** = normaler Sturmgewehr-Gegner (Rolle `niederhalter`, „Bolzer“) mit dem Gegner-Modifikator `anfuehrer`
  (`CONFIG.awayCombat.modifikatoren`): +50 % Leben, +50 % Schaden, 25 % größer (Snapshot: ein Bit `gs`). Keine Sonderfigur.
- **Sieg:** Anführer liegt, die übrigen beamen raus. **Niederlage:** Notrückholung, die Siedlung beginnt von vorn (`map_reset`), Freischaltung bleibt.
- Labor: `stellung_nehmen/flagge_hissen` (Labor-Landepunkt `splitter.eisenwald`; Kampagne: `eisenwald.siedlung`). Tests: `node tools/test-methalle.js`, `node tools/test-eisenwald.js`.
- Details, Messwerte und Entscheidungen: `CONTRACT-EK5-6.md`.

## Neu in EK4 – Verbündete und Flottenbefehle

- **Befehle des Legaten** (Marcus Severus, Funkporträt; Mars als Symbol) sind **Szenenziele**: *Ausschalten*, *Eskortieren*, *Durchbrechen*, *Zurückfallen*, *Entlastung*. Fortschritt nur durch erreichte Ziele; **Welle um Welle** mit Frist, danach Überdruck – die Szene darf scheitern (zweimal von vorn, dann „Rom übernimmt“), der Feldzug nie.
- **Verbündete** (Korvetten Roms) rufen bei großem Schaden um Hilfe, bei Zerstörung kommt ein **theatralischer Funkspruch** (Texte: `content/flotte/funktexte.json`) und eine Rettungskapsel. Das Schiff kommt nicht von selbst zurück, der Legat überlebt, sein **Gedächtnis** (befolgt / eigenmächtig / im Stich gelassen) steht im Weltstand.
- **EK4b:** Verbündete haben eine **eigene KI** (Rollen begleiter, angreifer; Flug über die Klassen-KI der Gegner, Feuer aus den Waffenplätzen der Klasse), **kein Eigenbeschuss** (auch Lanze und Minen), Gegner dürfen sie anvisieren, sie **springen mit** (auch Notfallsprung) und **tauchen** mit Sprungblitz **auf**. **Höchstens 12 Schiffe je Szene**, mehr kommt als **Nachschub**. Verlust: Banner, Funkspruch, Kapsel, Weltstand.
- **Orbitschlacht Eisenwald (Kapitel 6, VERK-ORBIT):** Fulminata und Audax tauchen auf, drei Befehle (Durchbrechen, Entlastung, Ausschalten der Boss-Fregatte). Scheitern: zweimal von vorn, dann „Rom übernimmt“ als Erleichterung, nie als Freibrief. Neuer Baustein `flotte_beenden`. Test: `node tools/test-orbit.js`.
- Anzeige: HUD-Zeile BEFEHL/VERBÜNDET, Captain-Reiter Funk, Wegpunkte auf den Karten. Labor: `flottenbefehl/*`. Debug: `flotte aufstellen|befehl|welle|neustart|status`. Tests: `node tools/test-flotte.js`, `node tools/sim-headless.js flotte`. Details: `CONTRACT-EK4.md`.

## Neu in EK3 Teil B – Konvoi-Szene mit Plünderung

- **Konvoi (Szenentyp A15):** 1–3 **Transporter** (Klasse `frachter`, jetzt auf der **Gegnerseite**, **unbewaffnet**) fahren eine **Route aus Wegpunkten** und
  **springen am Ende** (4 s Sprungaufladung, im Snapshot `sj`, Fortschrittsring in der Karte; bleibt abschießbar). Dazu **Eskorte** (ein Jäger, eine Korvette): sie fährt
  mit dem Konvoi und schießt nicht, bis die Lerche näher als 520 an einen Transporter kommt oder ein Konvoi-Schiff getroffen wird, dann gilt die Klassen-KI wie bei jedem Gegner.
  Hülle und Schilde der Transporter stehen in `CONFIG.enemies/enemyShields.frachter` (Mehrspieler-Skalierung wie bei jedem Gegner).
- **Zwei Siegbedingungen:** **Aufhalten** (alle Transporter zerstören, bevor sie springen) und **Plündern** (zerstörte Transporter lassen Fracht fallen, die Taktik beamt sie an Bord,
  siehe EK3 Teil A; Beute `sprengstoff`). Parameter: Zahl der Transporter, Eskorte (`voll|jaeger|korvette|keine`), Siegbedingung, Ladungsart.
  **Die Kampagne nutzt Plündern mit 2 Transportern** (solo nur mit Jäger-Eskorte).
- **Ausgänge:** `gepluendert`, `aufgehalten`, `entkommen`. Die Szene darf scheitern: bei `entkommen` rollt nach 8 s ein neuer Konvoi an (Wiederholung; schon erbeutete Fracht bleibt an Bord,
  der Konvoi ist dann kleiner). Der Feldzug scheitert nie.
- Im Labor: `konvoi_abfangen/pluendern` und `konvoi_abfangen/aufhalten` (Ort Rabenpass). Debug: `konvoi [n] [aufhalten|pluendern] [voll|jaeger|korvette|keine]`.
  Tests: `node tools/test-konvoi.js`, Bots: `node tools/sim-headless.js labor konvoi_abfangen/pluendern --crew 3`. Details und Entscheidungen: `CONTRACT-EK3B.md`.

## Neu in EK3 Teil A – Frachtraum und Fracht

- Der **Frachtraum** (Deck II, ersetzt Bad und Aussicht) fasst zwei Ladungen; **Fracht beamen** (Taktik F) und **Abliefern** (Taktik G) sind Halteprozesse; die mitgeführte Ladung steht im Weltstand
  (`schiff.fracht`). Bedienung und Regeln: Abschnitt „Frachtraum und Fracht (EK3 Teil A)“ bei der Voxel-Ansicht. Test: `node tools/test-lager.js`. Details: `CONTRACT-EK3.md`.

## Neu in EK2 – Raum-Alarm: Minen und Schleichfahrt

- **Alarmstufe je Raumszene:** ruhig, misstrauisch, alarmiert. Auslöser: **Lärm** (Waffenfeuer der Lerche, Antrieb auf Energie 4,
  Reaktor überladen), **Entdeckung** durch Patrouillen, **Minen**. Gilt nur in Szenen, die es einschalten (Baustein `raum_alarm_an`
  u. a.): Tutorial, Wellen und alle bisherigen Szenen laufen unverändert. Alarmiert bleibt bis zum Verlassen der Szene.
- Folge „alarmiert“: **alle Patrouillen greifen an.** Gibt es keine, **springen nach 5 s zwei Jäger** am nächsten Sprungpunkt ein
  (ODA-Ansage sofort). Szenenparameter `wissen` („Gegner wissen von der Lerche“): Start misstrauisch, größere Sensorkreise,
  ein einziger Schuss alarmiert.
- **Minen:** der **Weitscan zeigt sie** (für den Rest der Szene; ganz nah sieht man sie auch so). Zu nahe = Explosion, **ignoriert
  Schilde**, **6 Punkte Systemschaden** (ok → beschädigt = 1, → zerstört = 2, zufällig verteilt), Alarm. **Abschießbar** (Lanze, Bolzen,
  Batterie auf die angewählte Mine): Explosion auf Distanz, macht trotzdem Alarm; steht die Lerche im Sprengradius (160 px), trifft es sie.
  Zünden nicht bei ihrem Besitzer. `ohne_strom` = Blindgänger (Entscheidung der Studioleitung; die Kampagne nutzt den Parameter nicht).
- **Schleichfahrt (Szenentyp A13):** Die **Signatur** der Lerche wächst mit dem Tempo, **Asteroiden** und **Schilde unten** dämpfen sie
  (Nebel nur als Schalter `CONFIG.alarm.signatur.nebel.schalter`, in der Kampagne aus). Patrouillen haben **Sensorkreise** (Taktikkarte:
  gestrichelt, sie schrumpfen und wachsen mit der Signatur) und sind nur nah oder nach dem **Weitscan** zu sehen; der Weitscan verrät auch die
  Lerche 4 s lang. Taktik: Knopf **„Schilde runter/hoch“ (H)** und Signaturanzeige. **Kein Zeitlimit**, Ausgänge **Ziel erreicht** und **Rückzug**
  (Notfallsprung, Ziel zählt nicht).
- Im Labor: `unbemerkt_durchfliegen/patrouillen_schleichfahrt` und `kurs_durch_gefahr/minenfeld`. Tests: `node tools/test-alarm.js`.
  Details und Entscheidungen: `CONTRACT-EK2.md`.

## Neu in EK1b – Fregatte, Kreuzer, Schildsegmente

- Zwei neue Gegnerklassen: **Fregatte** (`X==>`, 2 Seitenbereiche je Seite) und **Kreuzer** (`X===>`, 3 Seitenbereiche je Seite). Schilde sind **Segmente je Seite** (`shared/schilde.js`);
  ein Treffer geht in das Segment an der Längslage, der Ziel-Scan der Taktik zeigt Bug, Seitenbereiche (vorn → hinten) und Heck.
- Mehrere Waffenplätze gleicher Art im Bogen der Lerche verstärken die Breitseite (Lanze +50 % je weiteren Platz). Eine Breitseiten-KI (`pilot.breitseite`) für Korvette, Fregatte und Kreuzer, Klassenparameter `spaceM3b.pilotKlasse`.
- Fregatte und Kreuzer sind **nicht** in den Wellen (`arena.waves`, `wellen.typenAb`); sie kommen über `spawnEnemy`, Debug `spawn fregatte|kreuzer`, Regiebücher und die Flotte (Verbündete, Boss-Fregatte).
- **Drehsprites** im Raum (Jäger, Korvette, Fregatte, Kreuzer) aus den Sheets in `public/voxel/sprites/`, mit Rückfall auf die prozedurale Zeichnung (`public/js/art.js`, Vorschau `public/art-preview.html`).
- Tests: `node tools/test-klassen.js`. Details: `CONTRACT-EK1.md` (Abschnitte 5–8).

## Neu in EK1a – Korvette statt Kanonenboot

- Das **Kanonenboot gibt es nicht mehr**, die Klasse heißt `korvette` (Config, Missionen, Katalog, Tests, Anzeige), ohne Alias.
- **Schilde** der Korvette: vorn 1, Steuerbord 2, hinten 0, Backbord 2. **Waffenplätze:** vorn und je Seite einer.
- **Bestückung zufällig** je Platz: Lanze (angekündigter schwerer Treffer), Batterie (Sperrfeuer) oder Bolzen (Einzelschuss).
  Ohne Lanze lädt die Korvette nie, ohne Batterie gibt es kein Sperrfeuer. Der Ziel-Scan zeigt die Plätze mit ihrer Art.
- Vorgabe zum Testen: `spawnEnemy(game, 'korvette', { waffen: { bug: 'bolzen', stbd: 'lanze', bb: 'batterie' } })`.
- Details und Entscheidungen: `CONTRACT-EK1.md`.

## Neu (2026-10-11) – Generatorkarten, Hüllen und Dächer

Außenposten und Stationen entstehen jetzt aus **Grammatiken statt aus Modulen**. Das gilt überall: Bodenkampf-Auswahl
(Wellen), Testgelände, Szenenbau und die festen Orte (`kesh.grabung`, `hafen.kontor` …).
- **Außenposten = Siedlung** (`shared/gen-siedlung.js`: Straßen, Platz, Parzellen, Funktionsgebäude, Wachturm; Mauer nur beim
  Militärlager; Rom: Raster, Germanen: Hauptachse). **Station** = `shared/gen-station.js`. Schiff, Ruine und Handkarten bleiben bei den Modulen.
- **Pflichtsatz:** Beide Generatoren erfüllen den Ankersatz der Kartenart (Außenposten: eingang 3, abholpunkt 2, sprengpunkt 2,
  aussicht, terminal, zelle 2, beute 4, ziel, wache 6, patrouille 4; Station: u. a. zelle 2, versteck, tor, ziel 3, nsc 2).
  Die Missionsplanung nimmt ihn für jede Karte der Art an. Der Prüfer erzwingt ihn über `meta.pflicht`.
- **Schalter:** `landepunkte.json` `"erzeuger": "modul"` (ein Ort), `PANTHEON_GEN=0` (alles), eine ausdrücklich gesetzte Schablone
  bleibt Modulkarte. Bauversion `gen2`; bei Änderungen an den Grammatiken hochzählen (Weltstände bauen dann neu).
- **Hüllen und Dächer** (`public/js/voxel/kit.js`): In Generatorkarten (`meta.huelle`) werden Wände nicht gebacken, sondern als
  Gruppen in zwei Höhen (3 m / 1,25 m) gebaut. Eine Gruppe wird niedrig, wenn sie die Sicht der Kamera auf eine sichtbare Figur
  verdeckt (Spieler, per Team-Sicht gesehene Gegner und Personen; harter Wechsel, 250 ms Nachlauf). Gebäude haben ein Satteldach
  (`kit/rom/dach` Terrakotta, `kit/germanen/dach` dunkle Schindeln mit hellem Giebelbrett), das mit der Wand verschwindet.
  Die Station hat keine Dächer. Funktionsgebäude (Lager, Krankenstation) sind überdacht; wer drinsteht, sieht das Dach nicht.
- **Snapshot-Grenze:** `CONFIG.net.snapMax` jetzt **20 KB** (20 480 B, vorher 13 312 B), Reserve `snapLuft` 1 536 B.
- **Tests:** `node tools/test-generatoren.js` (Pflichtsatz, Determinismus, Landepunkte, awayMap-Größe). `test-buehne.js` prüft
  weiter die Modulkarten (setzt `PANTHEON_GEN=0`). Bot-Läufe: `node tools/sim-headless.js wellen --karte aussenposten,station`.
- **Werkzeug:** `node tools/gen-karte.js --art siedlung --seed 2 --haeuser 10 --bauweise rom --typ militaer` bzw. `--seed 8 --raeume 8`
  schreibt nach `public/proto/`; Ansehen unter `/proto-karte.html?f=<id>` (Maus bewegt ein Ziel, `?zielanker=<id>`).

## Neu in Welle 2 – Szenario-Labor, Wellenkampf Boden und All, Bodenkampf-Feinschliff

**Lobby:** Mit **M** wechselt man zwischen Kampagne, Kampagne ohne Tutorial, m3, **Wellen Boden**, **Wellen All** und
**Labor**. Mit **W** wählt man die eigene Waffe für Wellen und Labor, sie wird vor dem Beamen gesetzt.

**Szenario-Labor** (`server/mission/labor.js`):
- Die Liste kommt aus dem Katalog. Jede verfügbare Umsetzung mit `test.params` erscheint ohne Codeänderung (heute 38).
- Bedienung: **↑/↓** wählt, **R** würfelt den Seed, **←/→** stellt die Stärke, **G** schaltet `god`.
- Einträge mit Startzustand erscheinen als eigener Eintrag, z. B. „(Start: gefangen)“.
- Schalter `CONFIG.lobby.labor`. **Vor dem Weitergeben des Spiels ausschalten oder hinter Debug legen.**
- Bots:
  - `node tools/sim-headless.js labor <id>|alle|ketten [--seeds N] [--crew 1|3]`
  - `BOT_WAFFE=rotation|<waffe>` für alle Bots
  - `ketten` spielt mehrere Szenen nacheinander auf einem Landepunkt (b7, wrack, kesh)

**Wellen Boden** ist abgenommen (`ABNAHME-WELLEN.md`). Die Lobby-Waffe gilt dort, Welle 1 ist solo überlebbar, und
Gegner bleiben nicht mehr hinter Ecken stecken.

**Wellen All:** Mit **K** wählt man die Szene: `frei`, `nebel`, `asteroiden` oder `asteroiden_bewegt`. Boden und All
nutzen denselben Wellenablauf, ausgewertet werden Welle, Zeit und Abschüsse. Kein Game Over: Die Runde endet beim
Notfallprotokoll.
- **Nebel** (vorerst nur in Wellen All, `sensors.nebelServer: 'wellen'`): Aufschalten und Zielerfassung halbiert, für
  Lerche und Gegner gleich.
- **Brocken treffen alle**, auch in der Kampagne: Gegner, Schützlinge, Geschosse und Strahlen. Gegner weichen aus
  (`pilot.js`).
- **Bewegte Brocken** driften deterministisch (`shared/drift.js`). Gesendet werden nur die Bahnparameter.
- Bots: `node tools/sim-headless.js arena --szene <id>|alle`.

**Bodenkampf:**
- Bis zu **3 Personen** gleichzeitig je gebauter Karte (`aw.npcs[]`, `CONFIG.personen.maxGleichzeitig`), mit
  Personenliste im HUD, beim Captain und an der Transfer-Konsole, dazu ein Randpfeil.
- **Enterer** sammeln sich vor Türen und Schotts (2 Enterer oder 4 s), stürmen dann gemeinsam und flankieren über einen
  zweiten Weg. Das gilt nur auf gebauten Karten.
- Wach gestartete Trupps melden jetzt Alarm.
- Das Rückzug-Limit (`retreatHoldMax`) wirkt.

**Golden:** neue Basis `tools/fixtures/golden/base-w2`. Die Abweichungen gegenüber `base-w1` stehen in `allow-w2.json`
(Kampfrauschen durch Brocken für alle und das Rückzug-Limit).

## Neu in Welle 1 – Netzbudget, Ladezeit, Sprung im Tutorial, Spielleiter Boden II

- **Netzbudget (AP1):** Der Snapshot lässt Standardwerte weg. Bei Gegnern fehlen `asleep`, `cr`, `ghost`, `aim` und
  `alive`, solange sie den Standard haben, bei Spielern `bleed`, `cr`, `zs`, `ov`, `bt` und `fl`. Leser behandeln „Feld
  fehlt“ wie den Standard (`server/sim/snapform.js`, Doku in `shared/protocol.js`). `squad` ist gestrichen. Die
  KI-Rolle `role` kommt nur mit `CONFIG.debug.snapKiRolle` (Bots, Debug-Overlay). Die Grenze steht an einer Stelle:
  `CONFIG.net.snapMax` = 20 480 B (20 KB, seit 2026-10-11; vorher 13 312 B), Reserve `snapLuft` = 1 536 B.
  - **Messen:** `npm run snap:mess` (Worst Case: Außenposten, 4 Spieler, 12 Gegner, Granaten, 5 Seeds × 20 s; dazu ein
    Wellenlauf; `--json` für Berichte).
  - **Werte:** Worst Case max 11 246 B, Wellenlauf max 10 592 B (Ziel ≤ 11 776 B). Vorher laut AP1 12 666 B bzw.
    12 367 B.
  - **R0 (4 Spieler, 2026-10-11):** alle Aufbauten von `snap:mess` laufen mit 4 Spielern. Worst Case max 11 802 B, Wellenlauf
    10 857 B, größter Aufbau Orbitschlacht 14 146 B (Grenze `snapMax` − `snapLuft` = 18 944 B).
- **Sprung im Tutorial (AP2, Entscheidung 29):** „Boje anfliegen, um zu springen“ gilt jetzt überall, auch in m1–m3.
  - Ziele wählt man im Tutorial weiter über die Ort-Links (`zielwahlUeberOrtLinks`). So wird kein Ort unerreichbar,
    weil seine Boje noch unbekannt ist.
  - m1 erklärt den Anflug beim ersten Sprung, m2 (Vaelen) und m3 (Abflug nach Kesh) mit je einem Satz.
  - Die Bots fliegen die Bojen an.
  - Golden-Basis ist jetzt `tools/fixtures/golden/base-w1` (erlaubte Abweichungen gegenüber `base`:
    `allow-w1.json`). Bot-Zeit m1 solo 441 → 570 s (+29 %), zu dritt 433 → 533 s (+23 %).
- **Spielleiter Boden II (AP4):**
  - **Gefangenschaft ohne Kampf:** Aktion `team_gefangen { landepunkt }`, gültig im `enter` eines Schritts (Szene
    beginnt in der Zelle) oder als Folge im Funkduell, solange das Schiff angedockt ist. Prüfer:
    `GEFANGEN-OHNE-DOCK`, `GEFANGEN-HEIMATHAFEN`, `GEFANGEN-STELLE`.
  - **Andock-Eskalation:** neue Umsetzung `verhandeln/andockkontrolle_eskaliert`. Andocken an Vaelen, das Kontor
    kontrolliert per Funk. Eine Antwort eskaliert: Abblende, Zelle, Ausbruch, die Haltung zum Kontor sinkt
    (`fraktion_haltung`). Danach kann die Lerche ablegen.
  - **Schleichen:** Die Mechaniken `stealth_aussen` und `gefangenschaft` sind verfügbar,
    `unbemerkt_hineinkommen/leise_bis_ziel` und `ausbruch/zelle_und_kammer` sind prüferfest. `npm run katalog`: 38/38
    Umsetzungen verfügbar.
  - **Katalog-Kürzung:** Der Grobplan bekommt je Umsetzung nur noch eine Zeile (ID, Karte, Dauer, Pflicht-Parameter).
    Heute 9 904 Zeichen ≈ 2 830 Tokens (`node tools/katalog.js --tokens`), vorher laut AP4 5 648 Tokens.
  - **Kampagnenstart** (`startRundeKampagnenstart`): kein zweiter Versuch mit vollem Kontext mehr, bei einem
    ungültigen Plan gleich das Archiv-Angebot.
  - `KARTE-WIEDERHOLT` warnt jetzt auch, wenn ein anderes Angebot derselben Runde den Landepunkt schon nutzt.
  - Bots wählen im Funkduell nach `BOT_WAHL=a|b|schweigen`.
- **Ladezeit (AP7):** `npm run mess:kaltbau` misst den kalten Kartenbau mit frischem Server und Browser je Lauf
  (Playwright; `--arten`, `--modi direkt,transfer`, `--seeds`, `--warte`, `--port`).
  - Der **Prefetch** in `public/js/voxel/kit.js` lädt im Leerlauf Bau-Daten, Paletten, Stimmungen, Figuren und
    Waffen-Gerüste. Der Bau hat Vorrang.
  - Schiff kalt (QA-Methode, Median aus 3 Seeds): 353 ms im Direktstart, 276 ms über die Transferkammer (vorher laut
    AP7 1 096 ms).
  - **Offen:** Der Sofortstart ohne Wartezeit (`--warte 0`) bleibt langsam, 3 653 ms im Direktstart.
  - Dazu: zweite Variante `station.schachtabzweig.b`, und `npm run check:assets` prüft die `streu`-Listen der
    Besitz-Paletten.
- **Messwerte (DOKU 2026-10-10):** `npm test` grün (2 617 Prüfungen), `npm run check` grün, Golden m1–m3 gegen
  `base-w1` 120/120 byte-identisch.

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

## Neu in B2 – Bodenkampf

Taktischer Bodenkampf nach **denselben Regeln für Spieler und Gegner** (`CONTRACT-B2.md`). Alle Zahlen stehen in
`shared/config.js` unter `awayCombat` und lassen sich mit `tune` live ändern.

- **Waffen und Hitze:** sechs wählbare Waffen, dazu die Faust in der Zelle. Es gibt kein Nachladen. Jeder Schuss heizt
  die Waffe auf, nach einer kurzen Pause kühlt sie ab. Bei 100 % ist sie überhitzt und gesperrt (Blaster 2,5 s). Ein
  normaler Rhythmus (ein Schuss je 0,6 s) überhitzt den Blaster nicht.

  | Waffe | Wirkung |
  |---|---|
  | Blaster | 1 Segment, Reichweite 13 Kacheln |
  | Sturmgewehr | ½ Segment je Treffer; jeder Treffer setzt das Schildladen des Ziels zurück; Streuung 6° kalt bis 14° heiß |
  | Granatwerfer | Bogen 4–12 Kacheln bis zum Mauszeiger, fliegt über Deckung. Der Zielkreis ist für alle sichtbar. Fläche 1,5 Kacheln: 1 Segment und 1,5 s Betäubung für **jeden** darin, auch eigene Leute |
  | Lanze | stehen bleiben und laden: Stufe 1 nach 1 s, Stufe 2 nach 2 s. Leuchten und Zielstrahl sind am Ziel zu sehen. Durchschlägt Frontschilde, Reichweite 22. Bewegen oder ein Treffer bricht ab |
  | Nahkampf | 0,5 s Ausholen, dann eine Wunde ohne Rücksicht auf den Schild. Ein Frontschild lenkt den Schlag von vorn ab |
  | Betäuber | auf den Schild wie der Blaster; ohne Schild bewusstlos statt verwundet |

  Direkte Schüsse und Schläge treffen nur die Gegenseite, Flächenwirkung trifft alle. Gezielt wird bis 10 Kacheln mit
  Sichtlinie. Weiter geht es nur vom `aussicht`-Anker oder mit geteilter Sicht (Captain-Markierung, bei Gegnern
  Trupp-Funk).
- **Wunden:** Unter den Schildsegmenten liegen Wunden. Spieler und normale Gegner haben 1, Berserker 2, Wächter
  4 Segmente und 2 Wunden. Gefallene Gegner bleiben liegen. Ein Kamerad richtet sie in 4 s auf, sonst sind sie nach
  45 s aus dem Gefecht. Bewusstlose wachen nach 30 s mit 1 Segment auf. Die Gegenseite kann sie fesseln (E halten,
  3 s), Kameraden befreien sie (3 s). Gefesselte Gegner zählen als ausgeschaltet.
- **Gegnerrollen** (Germanen; Namen und Funk in `content/katalog/gegner/`, Rezepte je Fraktion in
  `content/katalog/fraktionen/`):

  | Rolle | Name | Waffe | Erkennbar an |
  |---|---|---|---|
  | `grundtyp` | Karl (Rostmeute: Plünderer) | Blaster | duckt sich, zieht sich bei schwachem Schild zurück |
  | `niederhalter` | Bolzer | Sturmgewehr | bleibt stehen, lange Stöße auf eine Deckung |
  | `grenadier` | Donnerwerfer | Granatwerfer | hält Abstand, wirft auf Ziele in Deckung |
  | `schuetze` | Jäger | Lanze | sucht die Aussicht, steht still und lädt, weicht unter 5 Kacheln zurück |
  | `enterer` | Berserker | Nahkampf | läuft ohne Deckung direkt heran, holt aus |
  | `haescher` | Wergeld-Fänger | Betäuber | folgt dem Bolzer, betäubt und fesselt Liegende |
  | `waechter` | Kastell-Automat bzw. Wächter | Wächterwaffe (2 Segmente je Schuss) | langsam, Frontschild |

  Fraktionen: Rostmeute, Kontor-Clan, Raubzug, Herrenlos (Kastell-Automat), Kustoden (Wächter). Je Gefecht kommt
  höchstens eine Rolle dazu, die die Crew noch nicht gesehen hat (`crew.rollen_gesehen`). Solo gibt es keinen
  Wergeld-Fänger. Rollensymbole über den Köpfen gibt es nicht.
- **Alarm und Schleichen:** Trupps sind ruhig oder wach. Ruhig stehen Wachen an den `wache`-Ankern, die übrigen laufen
  Patrouille. Alarm gibt es bei Sicht (bis 10 Kacheln, kein Sichtkegel), Lärm, einem Treffer oder einem gefundenen
  Liegenden. Nach 4 s funkt der Trupp alle Trupps im Umkreis von 20 Kacheln an. Ohne neuen Kontakt ist er nach 60 s
  wieder ruhig, der Landepunkt bleibt bis zum Szenenende im Alarm. Lärmradien: laut 18 Kacheln (Sturmgewehr,
  Granatwerfer), mittel 10 (Blaster), leise 4 (Lanze, Betäuber), Nahkampf 3.
- **Ausbruch:** Liegt das ganze Außenteam und ist mindestens einer gefesselt, und hat die Karte `zelle` und `beute`,
  folgt ein Schnitt. Alle wachen in der Zelle auf, mit voller Gesundheit und nur der Faust. Die Zellentür öffnet sich
  von innen (E halten, 8 s, laut). Die Ausrüstung liegt am `beute`-Anker, danach geht es zum Abholpunkt. Beim zweiten
  Mal in derselben Szene oder bei `ausbruch_erlaubt: false` (Tutorial) folgt wie bisher die Notrückholung. Seit
  Welle 1 kann eine Szene auch in der Zelle beginnen (`team_gefangen`).
- **Waffenwahl:** an der Transfer-Konsole mit **Q/E** oder per Klick, je Spieler. Der Weltstand speichert sie unter einem
  Hash der Browser-Kennung (`crew.waffen`), nie unter dem Namen. Neue Spieler starten mit dem Blaster.
- **Wellen-Modus mit Kartenwahl:** In der Lobby schaltet **M** auf „Bodenkampf: Wellen“, **K** wählt die Karte
  (Außenposten, Station, Ruine, Schiff, Kesh-Hof). Jeder Start bekommt einen neuen Seed.
  - Ablauf: 10 s Countdown, dann Wellen. Dazwischen 15 s Pause zum Aufrichten, Befreien und Auffüllen.
  - Die Rollen kommen nacheinander dazu: Karl ab Welle 1, Jäger ab 2, Bolzer ab 4, Donnerwerfer ab 6, Berserker ab 8,
    Wergeld-Fänger ab 10. Häuptlinge kommen ab Welle 11.
  - Höchstens 12 Gegner stehen gleichzeitig, der Rest rückt als Nachschub nach.
  - Die Runde endet, wenn die ganze Crew kampfunfähig ist. Den Rekord je Karte merkt sich der Browser.
  - Werte stehen unter `CONFIG.wellen`.
  - `?arena=away&art=…&seed=…` spielt Wellen auf genau dieser Karte. Mit `&fraktion=…` oder `&wellen=0` startet die
    statische Karte (Karten-QA).
- **Debug** (`npm run debug`): `waffe <id>` (eigene Waffe), `gegner <rolle> [fraktion]` (neben die eigene Figur),
  `alarm on|off`, `fang` (Gefangennahme auslösen), `welle <n>` (Wellen-Modus), `tune waffen.<waffe>.<wert>`.
  `WAFFEN=aus` schaltet das Waffenmodul ab (alter Kampf, für Golden-Vergleiche).
- **Messwerte (DOKU 2026-10-10, Details in `concept/buehnen/ABNAHME-B2.md`):** `test-waffen` 132/132, `test-combat`
  352/352, `test-wellen` 54/54. Snapshot im Worst Case max 11 246 B. Bots schleichen in
  `unbemerkt_hineinkommen/leise_bis_ziel` 6/6 ohne Alarm ins Ziel, `ausbruch/zelle_und_kammer` 6/6 erledigt.
  Rollen-Lesbarkeit prüft der Spieleabend.

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
  Ohne `fraktion` und ohne `&wellen=0` laufen auf der Karte Wellen (siehe B2).
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

## Neu in S2b – zähere Gegner, Sperrfeuer, Spielleiter günstiger

Nach Kais erster S2-Runde („sieht echt gut aus“, aber Gegner zu schwach) und mit dem Ziel, den Spielleiter wirklich live zu
benutzen.

### Kampf
- **Jäger 3× zäher:** 36 statt 12 Hülle (Crew-Skalierung wie bisher: zu dritt/zu zweit × 0,7, solo × 0,5). Eine volle Salve
  (Lanze voll + beide Batterien) zerstört einen Jäger zu zweit/zu dritt nicht mehr, spätestens die dritte schon (Test). Der
  Lebensbalken über dem Gegner ist in Segmente geteilt, damit man den Fortschritt sieht.
- **Korvette:** Der angekündigte Ladeschuss bleibt (Schaden 3 → 4). Neu ist das **Sperrfeuer**: Feuerstöße aus der
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
- **Sperrfeuer ausweichen** (headless, nur eine Korvette ohne Ladeschuss, zu dritt, 3 × 60 s je Fahrweise): Lerche steht –
  93 % getroffen, ≈ 43 Hülle/min; hält Kurs (½) – 89 % getroffen, ≈ 16 Hülle/min; weicht aus (Kurswechsel/Ausweichrolle bei
  anfliegendem Stoß) – 35 % getroffen, < 1 Hülle/min. Im Browser (solo, Welle Korvette + 2 Jäger, je 30 s): stehen −51 Hülle,
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
- **Jeder Angriff auf den Schützling wird angekündigt** („Korvette lädt auf …“). Auf der Captain-Karte zeigen rot
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
  Raumkampf** → **Bodenkampf: Wellen** (bis B1 „Testgelände: Außenteam“). Dann alle **Enter** = bereit.
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

1. `cd Pantheon` · `npm start` (oder `npm run debug`, wenn ihr live nachjustieren wollt – siehe `tune` unten).
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
   Der Captain bleibt oben, wechselt auf **Reiter 4 „Außenteam“** und führt von dort.
6. Ende: Ende-Bildschirm „Die Tafel ist sicher“ mit Spielzeit. Danach könnt ihr frei weiterfliegen.

Erwartete Dauer zu dritt: siehe „Messwerte M2“ unten.

## Testgelände (solo)

Zum gezielten Ausprobieren der Kampfbereiche, ohne eine Mission durchzuspielen – geht solo und zu dritt, auch ohne `--debug`.

1. `npm start`, Link öffnen. In der Lobby schaltet **M** reihum: „Kampagne“ → „Kampagne ohne Tutorial“ → „Direkt zur
   Planetenmission“ → **„Testgelände: Raumkampf“** → **„Bodenkampf: Wellen“** (Anzeige „START (n/5)“). Dann **Enter** =
   bereit. Testgelände legen keinen Weltstand an.
2. **Raumkampf:** Start sofort an Boje B-7 (keine Brocken), abgelegt, Schiff unbeschädigt, alle auf der Brücke (solo
   neben dem Steuer, zu dritt neben Steuer / Taktik / Captain). Zielanzeige „Welle n“. Wellen (M3b): **Korvette +
   2 Jäger** → 2 Jäger → Jäger + Korvette → Kustoden-Wächter + 2 Jäger → Korvette + Jäger → Pylon (fest im
   Backbord-Bogen) + Korvette, danach wieder von vorn; Gegner fliegen im Testgelände mit dem neuen Flugmodell (Temporegler,
   Korvette hält die Breitseite, Jäger fliegen Überflüge); die nächste Welle kommt 12 s nach der Räumung (ODA sagt an). Schaden, Bots, Notfallprotokoll,
   Schildsektoren, Breitseite und Lanze (M3a, siehe unten), Scan/Weitscan und Reaktor überladen wie im Spiel.
   Solo: am Steuer fliegen, mit Esc + E zur Taktik wechseln (Taktik liegt oben links auf der Brücke). Kein Ende-Bildschirm.
3. **Bodenkampf: Wellen** (seit B2, ersetzt „Testgelände: Außenteam“): **K** wählt die Karte, dann Wellen bis die Crew
   unten liegt – siehe „Neu in B2 – Bodenkampf“.
4. Tipp: Mit `npm run debug` und `?debug=1` (F7) gehen zusätzlich `tune …` (Werte live), `spawn <art>`, `skip`
   (Raumkampf: Welle räumen / nächste sofort), `squad 1|2|rear`, `wake`, `shield <n>`, `wound`.
   Wellen und Szene stehen in `shared/config.js` unter `arena`.

## Start

```
cd Pantheon
npm install        # einmalig (einzige Abhängigkeit: ws)
npm start          # Server auf Port 3300
```

- Der Server zeigt beim Start einen **Raumcode** und den fertigen Link, z. B.
  `Raumcode: K7QM   Link: http://localhost:3300/?code=K7QM`. Selbst spielen: diesen Link öffnen.
- Mitspieler im selben Netz: `http://<IP-des-Rechners>:3300/?code=K7QM` (IP z. B. per `ipconfig`; ggf.
  Windows-Firewall für Port 3300 freigeben). Anderer Port: `PORT=3400 npm start` bzw. in `.env`.
- Lobby: Name eintippen, Farbe mit 1–4, **Enter = bereit**. Es geht los, sobald alle Verbundenen bereit sind.
  Rechts stehen der Raumcode und **„Einladungslink kopieren“** (L). Der Schalter **„Übung überspringen“** (U)
  lässt die Hafen-Übung weg – jeder darf ihn umschalten, alle sehen den Zustand.
  Später Beitretende landen direkt im Spiel. Ein fünfter Spieler bekommt „Server voll“.
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
- Höchstens 4 Spieler, ein Gerät (oder Browser) pro Spieler.
- Die Tunnel-Adresse ändert sich bei jedem Start von cloudflared; der Raumcode bei jedem Serverstart
  (außer mit festem `ROOM_CODE`).
- Fremde mit der Adresse, aber ohne Code, sehen nur das Code-Feld.

## Rollen an Bord (ab M1)

| Rolle | Konsole | Aufgabe |
|---|---|---|
| **Pilot** | Steuer (ganz vorn, `H`) | sieht **nur die Frontsicht** (Bug oben, ca. 700 px nach vorn, im Nebel die Hälfte). Fliegt nach Sicht und nach den **Markern**: Mint = Captain, Bernstein = Taktik (Raute im Raum, am Rand Pfeil mit Entfernung). |
| **Taktik** | Taktik (`W`, früher „Waffen“) | weite Taktikkarte, **alle Waffen** (Lanze am Bug, Batterien an beiden Flanken, Ladepunkte verteilen), **Ziel-Scan** (Schilde und Feuerbögen der Gegner), **Weitscan** (versteckte Dinge), Marker für den Pilot. Sieht Ladungen der Gegner zuerst und sagt sie an. |
| **Captain** | Captain (`C`) | Funk und Entscheidungen, Sternkarte/Sprungziele, Lage-Karte mit Captain-Marker, Außenteam-Hilfe; den Schiffszustand (Schilde klein oben) sieht er nur an. |
| **Technik** | Technik (Maschinenraum, `i`, R1) | Reiter **Energie & Schilde** (Hauptsysteme, **Bordmodule** ab-/anschalten, **Reaktor überladen**; Schildpool 6 bei Schild-Energie 2) und **Schadensplan** (Reparaturliste der Schrauber, „Bots automatisch“). Ersetzt `captain.power/shield/priority/repair/botAuto/overload` – die alten Befehle antworten nur „Das macht jetzt die Technik.“ |

Allein geht alles auch: **Tab / Shift+Tab** schaltet an Steuer, Taktik, Captain- oder Technik-Konsole das Interface auf die nächste freie Station (Navigation → Taktik → Captain → Technik), ohne dass man aufsteht; eine per Tab gehaltene Station ist für andere gesperrt. Unbesetzte Taktik feuert mit halber Kraft automatisch – **nur bei 1–2 verbundenen Spielern** (ab 3 schießt niemand von selbst; ODA meldet den Wechsel) –
unbesetzte Steuer behält die eingestellte Fahrtstufe, das Ruder geht auf 0 – das Schiff fährt geradeaus weiter (ab M3b,
vor dem Verlassen also auf STOPP stellen). Die **Schrauber** löschen Feuer und dichten Lecks selbst ab;
Systeme reparieren sie ab M3a nur auf Befehl (Schadensplan) oder automatisch, wenn nur einer spielt.

## Steuerung

| Wo | Tasten |
|---|---|
| Laufen | WASD / Pfeile · **E** interagieren (Löschen, Lecks, Beamen, Container, Schalter: **E halten**) · an einer Station: **E halten** = flicken (mit Ersatzteil in der Hand: Teil einbauen), **R** = Minispiel · **G** ablegen · **Tab** Crew-Status · **Esc** Konsole verlassen |
| Steuer (Frontsicht) | **W/S Temporegler**: eine Stufe je Tastendruck (Halten schaltet nicht weiter) – R · STOPP · 1/4 · 1/2 · 3/4 · VOLL; links die senkrechte Stufenleiste (eingestellte Stufe hell, Pfeil = Ist-Tempo, Stufe auch per Mausklick, rechts „Stufe +/−“) · A/D Ruder (das Schiff ist träge: Drehung baut sich auf und läuft nach; **bei 1/2 am wendigsten**, „wendig“ an der Leiste, „DREHEN x %“ = aktueller Drehfaktor, hell im Drehbalken = bei diesem Tempo erreichbar) · **X Allstopp** (Stufe auf STOPP, stärker bremsen bis Stillstand) · Shift+A/D Ausweichrolle (7 s Abklingzeit) – lädt ein Gegner, steht oben **„AUSWEICHEN!“** mit Seite und Countdown; wird die Anzeige **grün** (letzte 0,8 s), jetzt ausweichen → der schwere Treffer geht vorbei („Ausgewichen!“) · F Faltsprung (wenn der Captain ein Ziel gewählt hat) · **keine Feuertaste** – lädt die Taktik die Lanze („LANZE LÄDT – Bug aufs Ziel!“), zeigt die Frontsicht eine Visierlinie: Bug auf den Gegner drehen |
| Taktik | T nächstes Ziel (oder anklicken) · **Q/E** Waffe wählen · **A/D** Ladepunkte −/+ · **1 halten** Lanze aufladen (3 → 12 Schaden in 3 s, Visierlinie am Bug), **loslassen** feuert in Bugrichtung – auch per Maus: Knopf „Lanze“ gedrückt halten; kein Ziel nötig · **2/3** Batterie Bb / Stb · **Leertaste** beide Batterien (feuern nur auf Befehl, auch ohne Ziel: Ziel im Bogen, sonst nächster Gegner, sonst ins Leere) · 4 Bolzen (nach Kauf) · **S halten** Ziel-Scan · **W** Weitscan · **M** Marker aufs Ziel · **Rechtsklick** Marker setzen · **X** Marker löschen · **Z**/+/− Zoom · **O** Orbitalschlag (Außenmission) |
| Captain | **1–4** Reiter: 1 Funk (Enter annehmen, Q/W/E Antwort) · 2 Sternkarte (←/→ Ort, Enter Sprungziel) · 3 Lage (Linksklick Captain-Marker, X löschen, **Leertaste halten = Scan**) · 4 Außenteam (Codetabelle, S Sensor, K Schildkuppel) · oben rechts auf jedem Reiter die Schild-Übersicht (Füllstand, Durchlass-Farbe, rote Ladungs-Countdowns) – **kein Schildstoß mehr** (M3b) |
| Technik | **1–2** Reiter: 1 Energie & Schilde (↑/↓ Zeile, ←/→ verteilen, **U → J Reaktor überladen**, N abbrechen) · 2 Schadensplan (W/S wählen, F/Enter Flicken, T Teil, Entf entfernen, P an die Spitze, A Bots automatisch) |
| Station | **Tab / Shift+Tab** an einer der vier Konsolen: Interface wechseln, du bleibst stehen (nicht an Transfer, Terminal, Quartier, Sonde, Planungstisch) |
| Minispiel (R an einer Station) | **Leertaste**, wenn der Zeiger im grünen Feld steht – 3 Treffer, Fehlgriff = 1 s Sperre, scheitern unmöglich · Esc bricht ab |
| Planungstisch (Brücke, `Y`) | E am Tisch setzen (bis zu 3 gleichzeitig) · **1–5** Pin-Art (Ziel, Gefahr, Landeplatz, Treffpunkt, Frage) · **Klick** Pin setzen – auf der Sternkarte (auf einem Ort: **Shift+Klick**), auf jeder Detailkarte und jedem Decksplan · Rechtsklick eigenen Pin entfernen · ←/→ Ort · **Enter** Detailkarte · **D** Decksplan (B-7/Wrack/Kesh) · **Backspace** zurück zur Sternkarte · **M Missionsbuch**: aktive / angebotene / erledigte Aufträge mit Auftraggeber, Briefing, Belohnung, Zielen und Logbuch – **W/S** wählen, **Enter** als aktiv markieren (das HUD zeigt dann deren Ziele), **A** annehmen · Esc aufstehen |
| Quartier (E an der eigenen Koje) | ↑/↓ Reihe (Boden, Wand, Licht, Plätze) · ←/→ wählen · **Q/E** Deko blättern · Enter Deko setzen |
| Transfer | 1 runter · 2 hoch · 3 Medipack-Nachschub · 4–6 Notrückholung (oder einfach auf einem Pad **E halten**) · **Q/E** Waffe wählen (B2) · 7–0 Landepunkt (B1) |
| Außenmission | Leertaste/Linksklick feuert die gewählte Waffe (zielt auf die Maus; Lanze: halten lädt, loslassen feuert) · Q Markierung für Hilfe von oben · Sonde: 1–6 Farbe |
| Außenmission Kesh (Kampf v2) | **C** ducken / aufstehen · siehe „Kampf auf Kesh“ unten · Captain-Reiter 4: **Q/W/E/R/F/G** Befehl wählen, Klick auf die Karte setzt ihn, X löschen, **S** Sensor, **K** Kuppel |
| Reaktor offline | beide Schalter im Maschinenraum (A oben, B unten) **gleichzeitig E halten**, 3 s. Allein: einen halten, nach 3 s kommt ein Schrauber an den anderen. |

Jede Konsole zeigt ihre Tasten unten in einer Zeile. Ton startet mit der ersten Taste/dem ersten Klick.

## Die Orte: 8 Hexe des Saumraums, 15 der Eisenwald-Kette und der Leerraum

Die Karte Limes hat 10×8 = 80 Hexe (`content/welt/limes.json`). **8 davon sind spielbare Orte des Saumraums** (Tutorial, Lichtkordon bis Kesh; dazu die 15 Hexe der Eisenwald-Kette, siehe unten), 42 sind Leerraum, die
übrigen 30 sind Systeme ohne Raumszene (gesperrt oder nur Kulisse, z. B. Rom und Rostnest).

| Ort | Hex | Was dort ist |
|---|---|---|
| **Hafen Lichtkordon** | 0206 | Heimathafen, Liegeplatz, Hafenterminal (Shop), Tesks Funkturm. Ein Versteck im Hafenschrott. |
| **Splittergürtel** | 0306 | Asteroiden (Schild kostet's), Bergungskisten, Grauzahns Wegezoll. 2 Verstecke. |
| **Boje B-7** | 0406 | die stumme Boje mit Plattform (Außenmission), Rostmeute. Wartungskiste und ein Kustoden-Splitter (Scan). |
| **Vaelen-Karawane** | 0207 | fahrende Händler: Kristalllampe, Bolzenwerfer günstiger, andocken erlaubt. Sela braucht Hilfe; Teepaket und ihre Messsonde treiben in der Nähe. |
| **Wrack „Zaunkönig“** | 0405 | Außenmission im dunklen Frachter: 4 Container, Logbuch-Terminal, Plünderer, ein Hohlraum (nur per Weitscan aus dem Orbit). Draußen eine Rettungskapsel. |
| **Graue Weite** | 0307 | Nebel: Sicht und Sensoren halbiert. Hinterhalt, Leitbake (Weitscan!), eine alte Lore-Bake. |
| **Kustoden-Relais** | 0308 | erst nach der Leitbake erreichbar. Pylonen mit Frontschild, Kustoden-Wächter (EMP), Relaiskern. |
| **Mond Kesh** | 0205 | Mond mit Kustoden-Ruine, Plünderer graben dort. Planetenmission m3 „Die Tafel von Kesh“. Landepunkte Kustoden-Archiv, Verfallenes Grenzkastell und Grabungslager (B1). |
| **Leerraum** | 42 Hexe | leere Szene ohne Bojen. Hinein und hinaus nur über temporäre Sprungpunkte oder den Notfallsprung (B3). |

**EK7 (Karte, `CONTRACT-EK7.md`):** Dazu kommen **15 spielbare Hexe der Eisenwald-Kette** mit **Raumsektoren aus Daten**
(Statio Limitis bis Eisenwald; `gen: true` in `limes.json`, Szene aus `shared/gen-sektor.js`: Stern, Planeten, Station, Bojen,
Brocken nach Einfluss, Seed nach Hex-Kennung). Häfen mit Liegeplatz und Hafenterminal: **Castra Martis** und **Statio Limitis**
(ohne Ruf). Die Kanten um Wolfstor öffnet der Weltstand-Schlüssel `sperrriegel` (Baustein `sperrriegel_oeffnen`).
`node tools/sprungkette.js` fliegt die Kette als Bot ab.

Unerkundete Hexe zeigen auf der Sternkarte nur Umriss und Name. Springen geht nur über eine Kante mit bekannter Boje
(siehe „Neu in B3“). Insgesamt gibt es **12 Entdeckungen** (Captain-Logbuch und Planungstisch zeigen „Funde x/y“ je
Ort).

## Erkunden – Tipps

- **Weitscan (Taktik, W) bei jedem Erstbesuch.** Er deckt im Umkreis von 1000 px Verstecke auf; 20 s Abklingzeit.
  Nichts gefunden? Ein Stück weiterfliegen und noch einmal.
- **Verstecke** (Kisten, Kapsel): einfach drüberfliegen. **Baken** (Lore, Leitbake, Selas Sonde): Taktik wählt sie mit T,
  fliegt auf ≤ 800 heran und hält S.
- Der **Decksplan** von B-7 und vom Wrack liegt nach dem ersten Besuch am Planungstisch (Ort wählen, D). Pins dort
  sieht das Außenteam unten im HUD – praktisch für „hier Container, dort Plünderer“.
- Im Wrack zuerst aus dem Orbit weitscannen – sonst bleibt der Hohlraum zu („Die Wand klingt hohl …“).
- Der Reaktor kann 3 Minuten **überladen** werden (+4 Energie), danach ist er aus: Notstrom (2 Energie) nur für etwas Schild und Antrieb – keine Kanonen, keine Module.
  Neustart zu zweit an den Schaltern – am besten in einer ruhigen Minute.
- Verpasst ihr etwas Wichtiges (Leitbake, Selas Sonde), hilft ODA nach einer Weile mit Hinweisen und markiert es zur Not selbst.

## Ablauf

**Mission 1 „Die stumme Boje“:** Hafen-Übung (Brand, Leck, Transfer; überspringbar) → Funk annehmen → Splittergürtel:
Bergungsgut, Grauzahn antworten (bestechen oder kämpfen) → B-7: Rostmeute und Korvette, Störrelais abschießen,
Boje scannen → Außenmission (Sonde mit Farbcode vom Captain, Bojenkern, Datenkern, Ivo mit Medipack retten) →
Entscheidung über den Datenkern → Nachhut → Selas Notruf (optional: bei Vaelen andocken) → Hafen, andocken, Bojen-Trophäe.

**Mission 2 „Echo im Nebel“:** Einkaufen/Quartier/Planungstisch → Funk annehmen → **Vaelen**: Sela bietet ihre Nebelkarte
(60 Marken) oder bittet, ihre Messsonde per Weitscan zu suchen → Graue Weite: Hinterhalt → **Funkduell** mit Grauzahn
(bluffen, teilen oder schweigen – mit Folgen) → Leitbake per Weitscan finden und scannen → Kustoden-Relais: 3 Pylonen
von der Seite, Wächter, dann die **Prüfung** (2 Pylonen, Front zum Kern – von außen angreifen) → Captain scannt den Kern
→ Ende-Screen „Fortsetzung folgt“ (die Kampagne Eisenwald zeigt stattdessen den Abspann). Danach könnt ihr frei weiter erkunden (Wrack, restliche Funde).

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

**Captain an Bord (Reiter 4 „Außenteam“):** Karte mit allen Gegnern (verrauscht, solange ein Störrelais läuft).
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
              | Transfer / Quart. |  Schalter A/B)| Batteriedeck Stb|  vorn
              |                   |               | (Stb-Düse, -Bat.|  unten links; Lanze +
              |                   |               |                 |  Bug-Emitter am Bug)
```

- **Brücke** ganz vorn: Taktik (oben links), **Planungstisch** (links, aus der Messe hierher verlegt), Captain (Mitte),
  Steuer (vorn). Direkt daneben am Bug: **Lanze** und **Bug-Emitter**
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
| **Captain** | Funk, Sternkarte, Lage; läuft als Erster los. Sieht Ladungen erst in den letzten 1,2 s – hört also auf die Taktik. |
| **Technik** | Schilde in den bedrohten Sektor (ab 3 dicht, siehe Durchlass-Tabelle), **Schadensplan**: Schrauber auf Systeme ansetzen (Flicken / Teil), „Bots automatisch“, Energie, Reaktor überladen. Konsole im Maschinenraum. |
| **Wer läuft** | repariert: meist die Taktik oder der Captain (unbesetzte Taktik feuert nur bei 1–2 Spielern mit halber Kraft weiter). |

### Ansagen und Schilde
- Korvette (3 s), Pylon (2 s) und Kustoden-Wächter (2,5 s, EMP) **laden** sichtbar, bevor sie schwer treffen. Ist das
  Schiff am Ende noch in Bogen und Reichweite, trifft es (Korvette 3 Schaden = 15 Hülle ohne Schild), sonst verfehlt es.
  Treffer der Taktik auf einen ladenden Gegner verzögern die Ladung (je 1 s, höchstens 2 s). Jäger schießen weiter normal.
- Solo sagt ODA jede Ladung an („Korvette lädt – Backbord!“).
- **Der Schildstoß ist weg (M3b).** Dafür ist der Schildpool größer: **6 Punkte** bei Schild-Energie 2 (3 je Energie),
  höchstens 4 je Sektor.
- **Ein Schildpunkt schluckt einen Schadenspunkt**, der Rest geht auf die Hülle (5 Hülle je Punkt). Bei Schild ≥ 3 wird ein
  schwerer Treffer zusätzlich um 1 gemindert.
- **Durchlass** – Chance je Treffer auf Systemschaden, nach der Schildstärke des Sektors **vor** dem Treffer (gilt auch, wenn der
  Schild alles gefangen hat). Steht in der Technik-Konsole (Reiter 1) unter jedem Sektor:

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
  der Technik (höchstens 3 Einträge, „Flicken“ oder „Teil“). „Bots automatisch“ füllt die Liste selbst – Standard bei
  genau einem oder zwei Spielern. Notreparatur durch ODA nach 45 s bleibt (nichts bleibt dauerhaft kaputt).
- **Eskalation (M3b):** Bleibt im Gefecht ein System **20 s** beschädigt/zerstört, ohne dass jemand daran arbeitet, fängt der
  Boden neben der Station **Feuer**. Countdown im Schadensplan (Flamme + „14s“ statt Laufweg, darunter „Stb-Düse brennt in
  14 s“) und über der Station im Schiff („brennt in 14 s“, ab 5 s blinkend). Danach Hinweis „FEUER an …“.
- **Rückschlag (M3b):** Ein Hüllentreffer im Sektor einer laufenden Reparatur kostet **50 %** des Fortschritts (Flicken,
  Teil, Minispiel, Schrauber). Am Balken über dem Kopf erscheint das verlorene Stück rot mit „RÜCKSCHLAG −50 %“, oben die
  Meldung; Schrauber zeigen „−50 %“. Also zwischen den Salven schrauben.
- **Reaktor-Autostart (M3b):** Ein im Gefecht reparierter Reaktor startet nach 3 s selbst („Reaktor startet in 3 s von
  selbst“ in der Technik-Konsole); der Neustart zu zweit bleibt für ruhige Momente.
- `stats.bridgeLeaves` zählt, wie oft jemand die Brücke verlässt, während Gegner da sind.

### Testgelände-Wellen
1. **Korvette + 2 Jäger** (M3b) · 2. 2 Jäger · 3. Jäger + Korvette · 4. Kustoden-Wächter + 2 Jäger · 5. Korvette +
Jäger · 6. Pylon (fest) + Korvette, danach von vorn. 12 s Pause zwischen den Wellen. Start: Schiff unbeschädigt,
Schilde 2/2/0/2 (Bug/Stb/Heck/Bb, ganzer Pool 6).

### Raumkampf M3b – Ein Flugmodell für alle (Kurzfassung)
- **Temporegler** (W/S je eine Stufe, R · STOPP · ¼ · ½ · ¾ · VOLL). Drehen ist bei **½ am wendigsten**, im Stand dreht die
  Lerche kaum (Drehfaktor 25 %) – zum Ausrichten an der Boje also kurz auf ¼/½. **X = Allstopp.**
- **Unbesetzte Steuer:** Stufe bleibt, Ruder 0, das Schiff fährt weiter – vor dem Aufstehen STOPP stellen (besonders vor dem
  Beamen; sonst „Zu weit vom Ziel … das Schiff fährt weiter“ bzw. „Schiff zu schnell für den Transfer“ + ODA-Hinweis).
- **Korvette** fährt wie die Lerche und hält sich querab (Breitseite). Manövrieren bricht das: Bug oder Heck zum Boot
  drehen, wenn es lädt, Ausweichen bleibt (Shift+A/D im grünen Fenster).
- **Jäger** fliegen Überflüge (Anflug → vorbei → Wende). Im Anflug schießen sie **mit Vorhalt** (QA M3b); die Taktik sieht
  die Anfluglinie gestrichelt („ANFLUG“) – Lanze früh halten, loslassen, wenn er die Bug-Linie quert.
- **Schilde:** Pool 6, kein Schildstoß. Durchlass 45/20/5/0 % (Tabelle oben). **Eskalation** nach 20 s liegengelassenem
  Schaden im Kampf, **Rückschlag** −50 % bei Hüllentreffer im Sektor der Reparatur.
- **Technik:** einmal „Bots automatisch“ (Reiter 2, A) lohnt sich zu dritt – die Schrauber reparieren dann mit, die Crew
  kümmert sich um Zerstörtes und Eskalationen.

### Wichtige `tune`-Pfade (M3a, nur mit `npm run debug`)

| Befehl (Standardwert) | Wirkung |
|---|---|
| `tune spaceM3.tele.korvette.damage 2` (3) | schwerer Treffer der Korvette schwächer → leichter |
| `tune spaceM3.tele.korvette.dur 4` (3) | längere Ankündigung → mehr Zeit zum Wegdrehen → leichter |
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

- Endwerte: im Mittel etwa **1:10 je Welle**, keine Notfallprotokolle. Teuer sind die Korvetten-Wellen (2 und 4): ein
  schwerer Treffer auf einen leeren Schildsektor kostet 15 Hülle. Davor (Zwischenstände) lösten 2–5 Notfallprotokolle je Lauf
  eine Kaskade aus, weil die Hülle in 12 s Pause kaum über 30 kam – deshalb flicken die Schrauber die Außenhaut jetzt schneller.
- Wer die Brücke verlässt, ist **5–31 s** weg: flicken 6–15 s, Minispiel 5–22 s, Austausch (Teil aus dem Lager holen) 20–31 s,
  je nach Weg.
- **Solo im Browser** (Endwerte, Skript pendelt zwischen Steuer und Taktik, Schrauber automatisch): Welle 1 0:58, Welle 2 3:42
  (die Korvette zeigt die Breitseite mit 4er-Schilden; das Skript nutzt die Lanze kaum), Welle 3 2:07; 0 Notfallprotokolle.
- **Mission 1 an B-7 zu dritt** (Weg dorthin per Debug übersprungen, Kampf ohne Debug): Korvette kündigt jede Ladung an,
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
mit „nose“ bleibt am Korvette hängen). Die Bots sind deutlich besser als Menschen – beim Spieleabend zuerst auf die
Notfallprotokolle achten und notfalls mit den `tune`-Werten oben nachstellen.

### Messwerte M3b Schritt A (QA 2026-10-07, Details CONTRACT-M3B §9)

- **Bot-Simulation** (`npm run sim:arena`, 10 Seeds, zu dritt, 6 Wellen): „Nase drauf“ 60,7 Hülle (12/min), Breitseite 43
  (6,2/min) – Faktor 1,41 (je Minute 1,93). Korvette hält gegen „Nase drauf“ 73 % Breitseite, gegen Manövrieren 42 %.
  0–0,1 Notfälle, ~2 Reparaturgänge je Lauf (Bots verteilen Schilde fehlerfrei).
- **Browser** (QA-Skript mit Menschen-Tempo: Captain reagiert nach 1–3 s, Ausweichen ~65 %): Korvette + 2 Jäger
  **3:44–3:49, 100 Hülle, 2 Notfälle**; 2 Jäger 0:23–0:48 ohne Schaden; Jäger + Korvette 2:11–2:16, 50–55 Hülle; Wächter
  + 2 Jäger 1:33. Korvetten-Wellen sind für Menschen eher zu hart als zu ruhig. Wenn es beim Probeflug kippt:
  `tune spaceM3.tele.korvette.damage 2`, `tune crewScaling.3.enemyFireInterval 2.2`, `tune spaceM3b.escalation.after 30`.
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

### Drei Decks, Lifts und Leiter (PAN-01 Paket B)
Die Lerche hat **drei Decks** (Rumpf 40 × 13 Kacheln je Deck, Atlas `shared/maps.js`, `DECK_STRIDE` 16; Heck links, Bug rechts). Auf allen Decks läuft ein **3 Kacheln breiter Mittelgang** vom Hecklift **L2** bis zum Brückenlift **L1**; die Schächte (L1, L2, Notleiter) stehen auf allen Decks übereinander.
- **Mitteldeck** (der getestete Kampfteil): Antriebsraum mit Heckwaffe 2 · L2 · Lager (Regale), Heckgang, Transferkammer · **Maschinenraum** (Reaktor, Schildgenerator, Technik, Reaktorschalter, **Notleiter in der Mitte**) · Batteriedecks Backbord/Steuerbord (Waffen 4 und 6) und Gang · **L1** · **Brücke** (symmetrisch zur Mittelachse: Steuer vorn in der Mitte, Ops und Captain gegenüber; ohne Waffen und Systeme). Feuer, Lecks und Schäden gibt es hier und im Unterdeck.
- **Oberdeck** (privat, kein Feuer, kein Leck): vier **Quartiere** à 7 × 3 links und rechts vom **Meetingraum** (mit Koje und Spind), Meetingraum mit **Planungstisch** (Missionsbuch), **Handelskonsole** (ehemals Hafenterminal in der Messe) und der Notleiter, **Messe** am Bug (Trophäen, Ivos Schlafecke). Atrium, Liftvorraum und Trophäennische entfielen. Im Gefecht ist man hier sicher.
- **Unterdeck** (Ausbaudeck, kürzer, ohne Heck): **Bugraum** unter der Brücke (Lanze, Waffenplatz 8, mit Platz 5 und dem Bug-Emitter), **Modulräume** 1 und 2 am Bugende (offen ab Start), die **Lafetten** (7 · 1 Backbord, 9 · 3 Steuerbord) mittig unter dem Maschinenraum, Modulräume 3 und 4 am Heck. Was noch nicht ausgebaut ist, ist **sichtbar verschlossen** (verschalte Pforte mit Warnband und Stufenzahl, abgedeckte Lafette, Stauware).
- **Bedienung von Lift und Notleiter:** **E** aktiviert, dann **W** (ein Deck hoch) oder **S** (ein Deck runter) – es erscheinen nur die Pfeile, die möglich sind (Hinweiszeile „W hoch · S runter · E Abbruch“). **A/D** oder **E** noch einmal schließt die Wahl. Durchgehen kostet nichts: auf dem Mitteldeck läuft man ohne E durch L1 zur Brücke. Der Lift fährt 1,5 s je Deck (Notstrom 3 s), die Notleiter 2 s. Nach der Fahrt ist die Wahl zu (für das nächste Deck wieder E). Ein vor dem E gehaltenes W/S zählt erst nach dem Loslassen.
- **L1 ist der einzige Eingang zur Brücke**, fährt von Anfang an alle drei Decks und ist wie alle Lifts und die Leiter **nicht beschädigbar** (keine Station, kein Feuer, kein Leck). **L2** und die **Notleiter** erreichen das Unterdeck erst mit Ausbaustufe 1.
- Es ist immer nur das eigene Deck zu sehen. Mitspieler auf einem anderen Deck erscheinen als Randmarke ↑/↓ (Höhenlage: Oberdeck oben, Unterdeck unten). Die Minikarte zeigt die drei Decks untereinander.

### Ausbaustufen, Waffenplätze und Modulräume (PAN-01 Paket B)
- **Ausbaustufe als Daten** (`game.ship.stufe` 0–3, `server/sim/ausbau.js`, Snapshot `ship.st` nur ab 1, Weltstand `schiff.stufe`): Stufe 0 = **Waffen 3, Module 2** (Plätze 8 Lanze · 4 Bb · 6 Stb; Modulräume 1 und 2), Stufe 1 = 5/3 (+ Plätze 7 · 9, Modulraum 3, Lafettenbereich, L2/Notleiter ins Unterdeck), Stufe 2 = 7/4 (+ Heck 2, Bug 5, Modulraum 4), Stufe 3 = 9/4 (+ Plätze 1 · 3). Die Karte hat alles von Anfang an; die Stufe öffnet die **Pforten** (`SHIP_SEALS`, solide bis zur Stufe), und in noch zugemauerten Räumen entstehen weder Feuer noch Lecks.
- **Waffenplätze** (`Maps.WAFFENPLAETZE`): jeder der neun Plätze hat eine **Lafette** im Grundriss (8, 4, 6 sind die Stationen Lanze und Batterien, 7 9 2 5 1 3 sind Lafetten-Kacheln mit Auskunft per E). Die neuen Plätze feuern noch nicht; **Paket C** belegt sie mit Waffen (Systemname je Platz steht schon in der Tabelle, `system`), ohne die Karte anzufassen. Der Bolzenwerfer (Mount `bolzen`) und die Startwaffen laufen unverändert.
- **Vier gleich große Modulräume** (je 7 × 3 = 21 Kacheln, je 2 Plätze A, 2 Plätze B, 1 Platz C, Modulräume 1–4 auf dem Unterdeck), **jedes Modul in jedem Raum, auch mehrfach**. Die Ausstattung wechselt sichtbar je Modul (Frachtraum: Buchten, Betten, Stapel · Krankenstation: Liegen, Scanner, Krankenstationsboden · Werkstatt: Werkbänke, Maschine, Gitterboden · ohne Modul: Stauware); jedes laufende Modul zieht 1 Energie (auch das zweite gleiche).
- **Fracht- und Personenverwaltung mit mehreren Frachträumen:** Kapazität = **2 Plätze je Modul Frachtraum** (`Fracht.capacity(game)`, `Maps.cargoCapacity`), die n-te Ware liegt in der n-ten Bucht der Frachträume, Personen liegen auf deren Betten (2 je Frachtraum). Ohne Frachtraum nimmt das Schiff nichts an. Gesichert ist die Ladung nur, wenn alle Frachträume laufen.
- **Start-Lerche** (Eisenwald, Die Schuld der Lerche, Tutorial): Waffen 8 4 6, Module Frachtraum (Raum 1) und Krankenstation (Raum 2).
- **Lebenserhaltung** ist als Station und System **gestrichen** (13 Systeme).
- **Andockpunkte der Optik** (nur Daten): `Maps.ANDOCKPUNKTE` (Bug, Triebwerk, Banner, neun Lafetten).
- **Debug** (`npm run debug`): **`ausbau [0..3]`** setzt die Stufe (ohne Zahl: Status), **`modul bau <id> [raum 1–4]`** baut in einen offenen Raum ein (`modul weg|an|aus <id> [raum]`, `modul start` = Frachtraum + Krankenstation, `modul voll` hebt die Stufe auf 2 und baut vier Module), **`tp <x> <y>`** setzt die Figur an Bord auf eine Atlas-Kachel (Mitteldeck y 0–12, Oberdeck 16–28, Unterdeck 32–44; Lift L1 z. B. `tp 28 6`, Bugraum `tp 34 38`, Modulraum 1 `tp 24 38`). Rezept für mehrere Frachträume: `ausbau 2`, `modul weg frachtraum`, `modul weg krankenstation`, `modul bau frachtraum 1`, `modul bau frachtraum 3`, `fracht an deuterium`, `fracht person evert`.
- **Tests:** `node tools/test-lerche.js` (Stufen, Pforten, Modulräume, Frachträume, Weltstand), `node tools/check-maps.js` (Geometrie, Brücke, Lifts, Reparaturwege). Voxel-Platzhalter und Modellliste: `CONTRACT-PAN01-B-MODELLE.md`. Vertrag: `CONTRACT-PAN01-B.md`.

### Frachtraum und Fracht (EK3 Teil A)
- **Frachtraum** (seit PAN-01 B ein Modul in einem der vier Modulräume des Unterdecks, auch mehrfach): zwei Frachtbuchten je Frachtraum, jede fasst **eine Ladung** und zeigt sie an (2D und Voxel). Er ist **kein Schiffssystem**, aber seit PAN-01 A ein **Bordmodul** (zieht 1 Energie, siehe unten): ohne Strom ist er ungesichert. Das Regallager (Ersatzteile) bleibt auf dem Mitteldeck.
- **Fracht beamen** (Taktik): Fracht im Raum liegt, wo sie fällt (ein zerstörter Transporter, `fracht_abwerfen`), bis die Lerche das System verlässt. Taktik **F** halten lassen: **3 s** (6 s bei beschädigtem Transfer), Reichweite **320** wie das Beamen zu Außenkarten. Ein **Systemtreffer** bricht ab, ein Schildtreffer nicht. Voller Frachtraum (2/2) lehnt eine dritte Ladung ab.
- **Abliefern** (Taktik **G**, derselbe Halteprozess): beim Auftraggeber (`fracht_abnehmer`), sonst an jeder Station (Hafen, Karawane, Stationen der Sektoren) im Umkreis von 320.
- Die mitgeführte Ladung steht im **Weltstand** (`schiff.fracht`). Debug: `fracht abwerfen [art] [dx dy]`, `fracht an [art]`, `fracht leer`, `fracht gesichert an|aus`, `fracht abnehmer [ort]`. Details: `CONTRACT-EK3.md`.

### Energie und Bordmodule (PAN-01 Paket A)
- **Reaktor 8.** Energie ziehen nur die drei **Hauptsysteme** (Antrieb, Schilde, Waffen; mehr ist mehr, Formeln unverändert: Schildpool = E × 3, Ladepunkte = E + 2, Höchsttempo per `enginePowerFactor`, Stufe 4 macht Hitze) und die **laufenden Bordmodule** (je **1**). Transporter, Lager und Sensoren sind Grundausstattung ohne Energieposten (der Transfer läuft im Notstrom). Die **Lebenserhaltung** ist kein Energieposten mehr, ihr O₂-Verlust ruht (`o2.drainLifeBroken 0`, AP10); die Station bleibt bis zum neuen Grundriss stehen, wirkt aber nicht und wird von Treffern nicht gewählt.
- **Module** (`server/sim/module.js`, `CONFIG.module`): Datenliste `ship.module = [{ id, raum, an, lauf }]`. `id` = `frachtraum` | `krankenstation` | `werkstatt`, `raum` = Modulraum-Nummer 1–4 (heute gibt es nur für Krankenstation und Frachtraum einen echten Raum auf Deck II, die Werkstatt und die Räume 3/4 sind Daten; Paket B baut die vier gleichen Modulräume), `an` = Wunsch der Technik, `lauf` = tatsächlich in Betrieb (an **und** genug Reaktorleistung). Gleiche Module dürfen mehrfach stehen. **Start:** Frachtraum + Krankenstation. Der Shop-Eintrag `bot2` ist die **Werkstatt** (zweiter Schrauber), `schildpool` entfällt.
- **Standardverteilung** (nach Bestückung, `CONFIG.module.standard`): 2 Module = Antrieb/Schilde/Waffen **2/2/2**, 3 Module 2/2/1, **4 Module 1/2/1**. Die Verteilung wird nicht gespeichert (Standard beim Laden).
- **Technik** (Pult, Reiter Energie & Schilde, und altes Konsolen-Interface): Zeile **BORDMODULE** mit `Abschalten`/`Einschalten` je Modul (Pfeile: ↑/↓ wählen, ← aus, → an). Netzbefehl `technik.module { id, on, raum? }`. Abschalten macht Energie für die Hauptsysteme frei; Einschalten geht nur mit freier Reaktorleistung.
- **Kürzung bei Reaktorschaden** (beschädigt 6, zerstört 2, offline 2; `space.enforcePower`): 1. Hauptsysteme von oben kürzen (nie unter 1), 2. Module abschalten (Werkstatt, Frachtraum, Krankenstation zuletzt), 3. erst dann Hauptsysteme unter 1 (Waffen zuerst). Der Wunsch der Technik bleibt, nach der Reparatur läuft alles wie eingestellt.
- **Frachtraum ohne Strom/abgeschaltet = ungesichert** (`Fracht.setGesichert(false)`): Anzeige UNGESICHERT in Taktik und Frachtliste, ODA-Meldung; **bei jedem Hüllentreffer löst sich die älteste Ware** (`fracht.huellenTreffer`, Ereignis `frachtVerloren`) und treibt hinter dem Schiff, neu beamen möglich (angedockt: weg). Personen bleiben an Bord; `Fracht.gefaehrdet(game)` liefert, was gefährdet ist (AP14).
- **Notrückholung:** Ist die **Krankenstation** aktiv, holt sie **jeden Ausgeschalteten** (verwundet oder bewusstlos, nicht gefesselt/gefangen) nach `module.krankenstation.holNach` (10 s) einzeln an Bord (Schild voll). Ohne aktive Krankenstation gilt die alte Regel (Ausbluten nach 45 s, Bewusstlose wachen auf, Rückholung aller, wenn alle liegen). **Jede** Notrückholung (Krankenstation, Ausbluten, ganzes Team, Captain-Befehl `transfer.recall`) **sprengt den Transfer** (zerstört): Reparatur über die drei Wege (Flicken, Minispiel, Ersatzteil), bis dahin kein Beamen und keine Einzelholung; die Rückholung des ganzen Teams bleibt als letzter Ausweg auch mit kaputtem Transfer möglich. Sie braucht keine Energie.
- **Debug** (`npm run debug`): `modul status|start|voll`, `modul bau <id> [raum]` (Modul einbauen, auch ein zweites gleiches), `modul weg <id> [raum]`, `modul an|aus <id> [raum]` (wie die Technik); Beispiel in der Browserkonsole: `__game.send({ t: 'debug', cmd: 'modul', args: 'voll' })` (4 Module mit Werkstatt, Verteilung 1/2/1). Bestückung und Verteilung ändern sich danach sofort; `fracht gesichert aus` wirkt nur bis zum nächsten Tick (das Modul bestimmt die Flagge).
- **Tests und Messung:** `node tools/test-energie.js`; Bot-Messung `node tools/pan01-energie-bot.js --seeds 12 --players 3 --set "start;voll;voll-kampf;start-kampf"` (Preload `tools/pan01-energie-preload.js`). Vertrag: `CONTRACT-PAN01-A.md`.

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

## Bekannte Grenzen

- Umfang: drei Tutorial-Missionen und acht Orte im Saumraum, dazu die Eisenwald-Kampagne (EK1–EK8, 15 Hexe). Gespeichert wird nur angedockt bzw. beim Missionsabschluss (S1) –
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
Captain an Bord (nimmt an, wählt Kesh, führt über Reiter 4 mit Sammeln/Fokus, Sensor, Kuppel), Pilot fliegt nach
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

`npm test` führt seit EK8 27 Testskripte nacheinander aus; die vollständige Liste steht oben im Abschnitt „Kampagne Eisenwald starten und testen“ (Quelle: `package.json`, Skript `test`).
Golden-Vergleich wie in der Abnahme: `node tools/golden-trace.js --compare tools/fixtures/golden/base tools/fixtures/golden/s1 --allow tools/fixtures/golden/allow-s1.json`.