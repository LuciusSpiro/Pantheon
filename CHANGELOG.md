# Changelog

## 0.1.0

Erster Release unter dieser Versionsnummer. Gegliedert nach Bereichen, die Auftragsnummer in Klammern nennt die Quelle (Bericht im Projekt-Vault). Alle Aussagen stammen aus Tests, Bot-Läufen und Messläufen mit echtem Claude. Laut den Berichten hat noch kein Mensch die Neuerungen im Spiel durchgespielt, Kais Spieltests stehen aus.

**Grundlage:** Dieser Release baut auf dem bisherigen Spiel auf (Eisenwald-Kampagne, Freie Fahrt Sund, Bodenkampf, Ausbaustufen). Deren Geschichte steht in den „Neu in …“-Abschnitten der `README.md`.

Die Release-Prüfung (Tests, Golden Trace, Smoke, Versionsvergleich) steht im Bericht zu REL-01, nicht in dieser Datei.

## 1. Freie Fahrt mit Spielleiter

### Start und Spielleiter-Betrieb
- Die Freie Fahrt Sund startet ohne jede Umgebungsvariable mit Geschichtsfäden, Reise-Notrufen, Brett und Spielleiter-Rückfall (FRE-01).
- Der Live-Spielleiter (echtes Claude) ist eine Lobby-Option („Live-Spielleiter“, Taste V). Standard aus, nur in der Freien Fahrt, nur bei neuer Welt. Beim Fortsetzen eines Stands läuft der Spielleiter nie live (FRE-01).
- Ohne Modell (Rückfall-Betrieb) laufen Brett, Fäden und Notrufe aus dem Katalog weiter, es werden keine Modellanfragen gestellt (FRE-01).
- Fällt das Modell im Live-Betrieb aus, meldet das Spiel das einmal je Sitzung per Funk („Spielleiter arbeitet im Notbetrieb“). Nichts blockiert (FRE-01). Das Erreichen des Kontingents löst diese Meldung nicht mehr aus (LIV-02).
- Der Rückfall führt jetzt auch reguläre Angebote (Gerücht, Spur, Konvoi, Geleit, Sabotage) zu Ende, sodass ein angenommenes Angebot das Brett nicht mehr für die Partie sperrt. Ohne Zutun der Crew endet ein solcher Faden als gescheitert (FRE-05).

### Angebote beim Andocken
- Wer an einem Hafen andockt, bekommt bis zu drei Angebote mit Zielen 1 bis 3 Sprünge um den Hafen. Das Brett nennt Auftraggeber (Fraktion), Herkunft (Hafen) und Ziel. Ein Sammelfunk „N Aufträge am Brett“ kommt genau einmal je Andocken, nicht bei 0 (FRE-02).
- Brett-Titel und Plan-Titel stimmen überein. Spielernamen im Titel werden samt Endung und Genitiv geschützt (FRE-02, FRE-03).
- Verfallene und abgelehnte Angebote wandern in einen Vorrat und werden beim nächsten Andocken zuerst angeboten, ohne neuen Modellaufruf. Das gilt nur im Absichten-Modus (Opt-in, Standard aus) (FRE-02). Der Vorrat zählt je Art, damit Notrufe Angebote nicht verdrängen (FRE-03).

### Notrufe
- Ein Reise-Notruf entsteht im Takt (einer je 5 Minuten ruhiger Lage, höchstens 3 offen). Jeder Notruf legt beim Entstehen ein Angebot am Brett an (FRE-03).
- Der Notruf-Katalog umfasst 15 Notrufe (9 neue). Reise-Notrufe sind alle echt, es gibt kein Entschlüsseln (FRE-03).
- Ignorieren kostet keinen Ruf, es hinterlässt eine Fund-Marke und einen Chronik-Eintrag. Bei voller Marken-Grenze weichen Funde zuerst (FRE-03).
- Annehmen verlängert die Frist. Verfällt der Notruf danach, endet er als „nicht rechtzeitig erreicht“, ohne ein Wrack zu buchen. Springt die Crew im Kampf weg, endet er als gescheitert (FRE-03).

### Krieg Rom gegen Germanen
- Der Krieg ist auf der Übersichtskarte ablesbar: Front, Plaketten mit Stärke und Phase, Besitzfarben, Notrufmarken. In den simulierten Läufen war das ab etwa Tick 60 klar, im Lauf mit Seed 7 schon bei Tick 15 (FRE-04).
- Die Karte stimmt mit der Wahrheit überein: 99,9 bis 100 % unter den gesehenen Hexen. Alle Hafenfälle und Postenverluste kommen als Funk (FRE-04).
- Lagefunk nennt jetzt die Seite („X ist an die Germanen gefallen“, „X ist in römischer Hand“). Die Kartenauswahl folgt der Lerche, solange nichts angeklickt ist, und heißt „AUSWAHL“ statt „ORT“, wenn sie abweicht (FRE-04, Nachtrag FRE-04b).

### Kontingent
- Das Ende des Claude-Kontingents ist keine Spielinformation mehr (kein Streifen, kein Funk, keine Taste). Der Server schreibt eine Systemzeile ins Log und ins Regie-Logbuch, und der Spieler mit der blauen Markierung bekommt einmalig die Frage „Spielleiter-Limit erreicht, erhöhen?“ mit Ja und Nein. Ja erhöht um 500 000 Tokens (LIV-02, aufbauend auf der Schwelle aus LIV-01).
- Die Schwelle liegt bei 90 % des Limits. Im echten Lauf mit Limit 60 000 kam die Meldung bei 54 725 Tokens, der Abend lief im Rückfall ohne Serverfehler weiter (Stand LIV-01, vor LIV-02). Im späteren REF-02-Lauf überschoss das Kontingent das Limit (62 134 bei 60 000), siehe „Bekannt rot oder ungemessen“ (LIV-01, REF-02).
- „Nein“ gilt für diese Schwelle endgültig und prozessweit bis zum Serverneustart (LIV-02).

### Spielleiter mit Claude (gemessen)
- Mit echtem Claude entstanden 82 Pläne ohne Ausfall und ohne Ablehnung (Stand LIV-01, Katalog vor den neuen Beats; die spätere REF-02-Messung steht unter „Bekannt rot oder ungemessen“). Claude komponiert nur Beat-Folge, Titel und Anlass, alle Texte kommen aus dem Katalog (LIV-01).
- Zehn Abenteuer-Aufrufe: 10 von 10 gültig, Median 6,67 s, 8 verschiedene Beat-Folgen. 11 von 11 Lage-Plänen setzen Befehle außer „fokus“ um (zuvor 1 von 12). Kosten der gesamten Messung rund 0,81 Mio Tokens und 2,86 $ (LIV-01).

### Absichten-Modus (Opt-in, Standard aus)
- Der Spielleiter kann „Absichten“ (SPL-02: 14, inzwischen 17 in `content/faeden/absichten.json`, ergänzt durch BEA-01, BEA-02, SON-01) statt Beat-Plänen planen, mit Bezug auf Personen der Crew-Geschichte, Verhandlung über ein Nein mit Gegenvorschlag und Rückfall über den Inszenierer. Schalter `ABENTEUER_ABSICHTEN`, Standard aus, nicht in der Betriebsart live (SPL-02).
- Der Prompt wird kleiner: 5 049 gegen 10 422 Zeichen (Stand SPL-02, der Beat-Katalog ist seitdem gewachsen) (SPL-02).
- Der Text-Pool bleibt bei Gemma 26b (Vergleich: Gemma 28 von 33, Flash-Next 26 von 33, Qwen 27b 23 von 33 gültig im ersten Versuch) (SPL-02).

### Katalog: Paarmatrix, Zustandsregeln, Gegenmessung
- Eine Paarmatrix prüft alle 400 geordneten Beat-Paare über denselben Weg wie Claudes Antwort: 191 ok, 138 nur mit Verzweigung, 39 nie gültig, 32 mit fehlendem Hinweis-Träger (KAT-01).
- Der Katalog enthält jetzt drei abgeleitete Zeilen (Zustandsregel „Verzweigung Pflicht“, Beat-Zähler im Kontext, Landeplatz-Hinweis). Ein Wächter-Test hält die Zustandsregel aktuell (KAT-01).
- Gültigkeit: 29 von 30 Plänen vorher und nachher (REF-02 hatte 24 von 30, nicht reproduzierbar). Forderung und Schmiergeld wurden in der Gegenmessung je 3-mal gültig geplant (vorher 0-mal) (KAT-01).
- Landeplatz-Beats (Landung, Wrack, Rettung): Anteil gültiger Pläne 44,8 % im Nachher-Lauf (vorher 75,9 %), 70 % im Bestätigungslauf, gepoolt 51 % (20 von 39) (KAT-01).
- Breite: 17 von 19 Beats gewählt (vorher 13), alle vier zuvor verdrängten Beats kommen vor (KAT-01).
- Absichten-Modus unberührt: 19 von 20 gültig wie vorher (KAT-01). Kosten der Messung 1 179 285 Tokens, 4,48 $ (KAT-01).

## 2. Geschichtsfäden und Beats

- **Forderung und Wahl ohne Kampf:** Ein Gegner oder Zoll stellt die Lerche, die Crew wählt (ausliefern, verweigern = Kampf, bestechen) in zwei Stufen. Beispiel 1 (Händler, Piraten fordern, Lieferung, Enthüllung, Invasion) läuft vollständig simuliert, ebenso der Weg „Piraten bekommen die Ware“ (Faden gescheitert, keine Enthüllung, keine Invasion) (BEA-01). Beispiel 1 hängt an der Vorlage `falscher_haendler`: erreichbar nur mit Live-Spielleiter oder `ABENTEUER_ABSICHTEN=1` (Absicht `forderung`), siehe „Bekannt rot oder ungemessen“ (HYG-01, HYG-02).
- **Durchsuchung:** Zoll kann den Frachtraum durchsuchen (voll oder nur Scan), beschlagnahmen, Bußgeld und Ruf-Abzug erheben. Schweigen gilt als dulden. Der Funk nennt die Art der Ware nie (BEA-01). Die Vorlage „Zollkontrolle“ läuft nur über die Absicht, im Spiel gibt es keinen Auslöser (BEA-01).
- **Ware über Beats:** Die Ware bleibt am Faden über Zwischen-Beats (BEA-01).
- **Landung:** Beat „Landung“ mit Besetzung ruhig, Räuber oder Belagerer aus Daten. Gelungen, wenn jemand unten war und danach niemand mehr unten ist. Gescheitert bei Frist, Notsprung, Faden-Ende oder erzwungener Rückkehr (FAB-01).
- **Rettung:** Beat „Rettung“ mit 1 bis 3 benannten Überlebenden, Ausgang „an Bord“ oder „an einer Station abgegeben“. Ein Notruf am Brett läuft als Notruf, Rettung, Abschluss mit einem einzigen Abstieg. Der Ort folgt dem Hex (Planet nur an 13 von 30 Hexen mit Szene, Wrack im Raum an 30 von 30). Neue Absicht „Bergung“. Ist der Frachtraum belegt, gibt es einen Hinweis, nichts wird geräumt (BEA-02).
- **Hinterhalt:** Ankunft an einem Hex (Schnellsprung, Einzelsprung, Notsprung, Teleport) löst den Hinterhalt ohne Vorlauf aus, der Schnellsprung hält dort an. Standardplan „Hinterhalt, Abschluss“. Mitbehoben: Die Befreiung löste vorher zusätzlich Zufallsjäger aus (4 Jäger plus 3 Wachschiffe zugleich) (BEA-03).
- **Wrack:** Beat „Wrack“ am Raumpunkt: hinüberbeamen, Beute bergen (höchstens 3 je Wrack), Logbuch lesen, zurückbeamen. Wracks sind Storytelling, kein Loot (Kai-Entscheidung) (WRK-01).
- **Sondersektor Helix:** Am Brett eines Hafens bis 3 Sprünge von Pulverhorn erscheint „Helix ruft um Hilfe“. Annehmen startet das unveränderte Regiebuch der Forschungsstation, bei Erfolg nennt der Funk Brachland (0505) als Rückweg. Einmalig, nach Erfolg kein neues Angebot, Helix darf sofort am ersten Brett liegen (Kai) (SON-01).
- **Unter der Haube (kein Spielinhalt):** Prompt-Grenzen für neue Beats angehoben (Katalog 13 550, Prompt 15 350 Zeichen) und ein Prüfwerkzeug für neue Beats ergänzt (PAR-01). Boden-Ereignis-Verteiler als gemeinsame Grundlage für Landung, Wrack und Rettung (FAB-01, WRK-01, BEA-02).

## 3. Ladung, Ware, Handel, Personen als Fracht

- **Eine Ladung:** Waren sind Daten (8 Arten: Handelsware, Waffen, Erz, Bergungsgut, Deuterium, Sprengstoff, Hilfsgüter, Person), Preise je Volk und Hafen (LAD-01).
- **Frachtraum:** Jedes Frachtraum-Modul hat 4 Plätze und fasst eine Art. 4 Personen belegen 4 Betten. Die Kapazität der Lerche verdoppelt sich damit (LAD-01).
- **Eigenschaften:** Waren können illegal, getarnt oder Auftragsware sein. Getarnte Ware zeigt die Tarnart, kein Text nennt die echte Art. Die Durchsuchung deckt sie auf (LAD-01, mit Durchsuchung aus BEA-01).
- **Handel:** Verkauf an jedem Ort, an dem man andocken darf. Person, Auftrags- und Kampagnenware sind nicht verkaufbar. Der Verkaufsgrund statt „Kein Händler“ wird angezeigt (LAD-01).
- **Faden-Ware** wird echte Fracht im Frachtraum (LAD-01).
- **Anzeige:** Frachtzeile mit Füllstand je Modul, Illegal- und Auftragskennzeichen, eigene Modelle je Ware im Frachtraum (Voxel und 2D, 9 Varianten) (LAD-01).
- **Erz ist Fracht:** Abbau-Erz belegt Frachtplätze, der Abbau gelingt immer, eingelagert wird, was passt. Erz ist verkaufbar (7 Marken in Ostia Nova) (WRK-01).
- **Beute aus Wracks** belegt Frachtplätze und ist verkaufbar (3 mal 22 = 66 Marken im Test). Ohne Platz öffnet sich der Beute-Anker trotzdem, ohne Ware, mit Meldung nur an die Spielerin (WRK-01).
- **Invasion durch Lieferung:** Der Falsche Händler löst eine Invasion nur aus, wenn die Crew die Ware abliefert. Der Spielleiter wählt Sprengung, Invasion oder beides (Standard Invasion). Die Invasion wird per Funk angekündigt, stärkt die Flotte um 30 % und hat eine Abkühlzeit von 80 Ticks je Fraktion. Wird die Ware nicht abgeliefert, endet der Faden sofort als gescheitert (FAD-01). Die Vorlage `falscher_haendler` ist nur mit Live-Spielleiter oder `ABENTEUER_ABSICHTEN=1` (Absicht `forderung`) erreichbar, siehe „Bekannt rot oder ungemessen“ (HYG-01, HYG-02).

## 4. Orte und Gelände

Sektor-Kacheln, Orte für beliebige Sektoren, Gelände-Szenen.

### Sektor-Kacheln
- Sektoren lassen sich aus einem Katalog von 10 Kacheltypen bauen. Die Planetenart bestimmt Biom und Landbarkeit. (KAC-01)
- Ein Hex kann mehrere Körper tragen, zum Beispiel zwei Planeten und eine Station. Ein Gasriese ist nur als Haupttyp zulässig. (KAC-01)
- Landen und Beamen gelten je Körper. Jeder Körper hat eine eigene Beam-Reichweite und einen eigenen Landepunkt. Nicht landbare Planeten und Gasriesen haben keinen Landepunkt. (KAC-01)
- Ein Großer Asteroid führt direkt in die Höhle. (KAC-01)
- Die Sternkarte zeigt ein Typ-Icon je Kachel. Eine Testkarte ist anfliegbar. (KAC-01)
- Sektoren ohne Kachel-Typ (Limes, Sund) bleiben unverändert. Das ist per Hash belegt. (KAC-01)

### Orte für beliebige Sektoren
- Der Spielleiter kann in der Freien Fahrt bis zu zwei Landeplätze für ein Abenteuer bestellen. Das gilt auch für Planeten ohne Standard-Landeplatz. Die Crew wählt den Ort an der Transfer-Konsole, beamt hinunter und wieder hoch. (DYN-01)
- Der Ort lebt so lange wie der Faden und wird danach restlos abgeräumt, auch nach Speichern, Laden und Serverneustart. (DYN-01)
- Welche Karte ein Planet bekommt, hängt von seiner Art ab. Wüste: Wildnis oder Außenposten. Fels und Eis: Wildnis oder Höhle. Wiesenwald und Vulkan: Wildnis, Höhle oder Außenposten. Ozean und Gasriese: keine Landung. Ein Raumpunkt: Schiff oder Station. Das Biom folgt der Planetenart. (DYN-01)
- Mehrspieler-Betrieb mit 2 und 4 Spielern ist simuliert belegt. Bricht die Verbindung eines Spielers unten ab, kommt er an Bord und der Ort wird abgeräumt. Das ist kein Spieltest. (DYN-01)

### Gelände-Szenen
- Der Missions-Spielleiter kann Wildnis und Höhle jetzt bedienen. Es gibt sechs neue Umsetzungen: Überlebende suchen, Ladung am Boden bergen, Absturzstelle, Kontrollposten im Gelände, Rudeltiere im Gelände und Adern in der Höhle (nur Höhle). (SPL-01)
- Rudel haben 3 bis 4 Tiere, höchstens 2 Rudel je Karte und mindestens 12 Kacheln Abstand zueinander. (SPL-01)
- Beim Abbau in der Höhle gilt für Wiederkehr ein Deckel von höchstens 2 in Folge. (SPL-01)
- Besuchte Gelände-Landepunkte stehen im Spielleiter-Kontext höchstens einmal einzeln. Das Kontextlimit wurde auf 2420 angehoben. (SPL-01)

## 5. Monster und Eisenwald

### Schwarm mit Königin
- Neben dem Rudeltier gibt es einen zweiten Monstertyp: den Schwarm. Er besteht aus Schwarmlingen um eine Königin. (MON-03)
- Die Königin brütet Nachwuchs (Start 12, höchstens 20, Takt 4 s). Das gilt auch bei bewusstloser Königin. Ist die Königin erledigt, zerfällt der Schwarm. Mit lebender oder bewusstloser Königin kehrt er wieder. (MON-03)
- Abbaulärm lockt den Schwarm aus 15 Kacheln Entfernung. Verliert ein Schwarmling sein Ziel, läuft er heim zur Königin. Seine Spur führt zum Nest. (MON-03)
- Das Nest ist verdeckt. Die Position der Königin erscheint erst ab Scan-Qualität 3. „Erledigt“ heißt: die Königin ist erledigt. (MON-03)
- Der Biss ist eine Wunde, die Schild und Kuppel umgeht. Die Balance dazu ist Spieltest. (MON-03)
- Der Spielleiter kann den Schwarm über die Umsetzung „Kreaturen in der Höhle“ (Typ Rudeltier oder Schwarm) einsetzen. Das gilt nur in Höhlen. (MON-03)
- Die Optik ist Myzel: Pilzkappe, Pilzmutter, Zerfallsfleck, Fadenstück. (MON-03)

### Eisenwald: Bunker statt Methalle
- In Kapitel 4 des Eisenwalds ersetzt die Karte „Wald mit Bunker“ die Methalle. Name, Hex, Flag und Kapitel der Methalle bleiben. Die Mission heißt: in den Bunker, sprengen, entkommen. (EIS-01)
- Beide Seiten können den Bunker verteidigen. In Kapitel 4 verteidigen die Germanen (Raubzug). Die Zahl der Verteidiger folgt der Crewgröße (9, 13, 18 und 24 bei Crew 1 bis 4). (EIS-01)
- Das Rohr ist eine Umgehung im Kampf, kein Schleichweg (Kai). Die Sprengpunkt-Sperre ist in Kapitel 4 aus, in der Lobby an. (EIS-01)
- Sprengstoff, Knall und Rückzug sind belegt, im Bot-Lauf mit gekennzeichnetem god-Modus. Ohne god schafft der Bot den Bunker nicht. Nachschub kommt genau einmal (4 Mann). Nach einer Notrückholung ist der Bunker frisch, ein zweiter Versuch geht. Kapitel 5 bis 8 laufen wie vorher. (EIS-01)

## 6. Messung und Werkzeuge

### Mitschnitt und Referenzläufe
- Mit `MITSCHNITT=1` schreibt jeder simulierte Lauf je gespielter Mission ein lesbares `mission.md` mit Verlauf, dazu `index.md` und `verlauf.json`. Ohne den Schalter entsteht nichts. (MIT-01)
- Spielernamen werden im Mitschnitt gefiltert. `npm run mitschnitt` (`liste`, `zeigen`, `bewerten`) dient der Durchsicht. Das Frontmatter `bewertung` trägt offen, gut, schwach oder verwerfen. (MIT-01)
- `npm run referenz -- 1|2|3|alle` fährt die Referenztests für die Beispiele 1 bis 3 nacheinander. Mit `--mitschnitt <Ordner>` und `--nebenfaelle` entstehen die lesbaren Mitschnitte (Index „Referenz 0.1.0“). Beispiel 4 entfällt aus der Referenz. (REF-01)
- Der Läufer `spiel-wrack --verkauf` verkauft die Beute am Hafen Ostia Nova über den echten Befehl. (REF-01)

### Live-Läufer und Live-Messung
- `live-abend` lässt eine Bot-Crew einen Abend mit echtem Claude spielen und nimmt Angebote an. Je Mission gibt es einen Mitschnitt, die Pläne sind verlinkt. (LIV-01)
- `messe-lage` ist neu, `messe-abenteuer` hat `--out`. Je Plan entsteht eine Datei, dazu ein Index mit Links. (LIV-01)
- Baseline LIV-01 (Stand vor den neuen Beats, Zahlen siehe Bereich 1): Alle Bot-Läufe sind vom Bot-Takt geprägt. (LIV-01)
- `npm run messe:zusammen` führt mehrere Läufe zusammen (`tools/messe-zusammen.js`). (REF-02)
- Stand der Berichte, Live-Messung REF-02 (Claude `claude-sonnet-5-5`, Bot-Welt, kein Spielabend): 24 von 30 Beat-Plänen gültig. Im Absichten-Modus waren es 19 von 20. Fünf Abende liefen mit 0 Serverfehlern und 24 Mitschnitten. Kosten 966 458 Tokens (3,50 $). Die roten Befunde stehen unter „Bekannt rot oder ungemessen“. (REF-02)
- Kai hat Spielabende mit echten Spielern bis zum Release ausgeschlossen. Alles war Bot und Claude. (REF-02)

### Messprofile und Paarmatrix (Werkzeug-Teil von KAT-01)
- `messe-abenteuer` nimmt jetzt `--profil <datei>` (vier Profile: a-hafen, b-nur-punkt, c-krieg, d-vorgeschichte) und `--gesamtdeckel <Tokens>` (Exit 3 bei Überschreitung). Der Test dazu ist `test-messe-profil`. (KAT-01)
- `npm run messe:paare` rechnet die Paarmatrix: alle 400 geordneten Beat-Paare über denselben Weg wie Claudes Antwort. Ergebnis: 191 ok, 138 nur mit Verzweigung, 39 nie gültig, 32 mit fehlendem Hinweis-Träger. (KAT-01)
- Nur für die Messung gibt es `--katalog-variante` (`tools/messe-katalog.js`). (KAT-01)

### Wächter und Versionszeile
- Die Mutationswächter `mutation-abenteuer-c` (zuletzt 110 erkannt, 0 überlebt) und `mutation-faden-nach3` (37 erkannt, 0 überlebt) laufen wieder. Ihr Ankercheck (`--trocken`) steckt in `npm run check`. Ein absichtlich kaputter Anker macht `npm run check` rot. (HYG-01, HYG-02)
- Ein Test, der seit BEA-02 rot war (`test-abenteuer-ziel-absichten`, kannte `bergung` nicht), ist behoben. Zwei Testlücken sind geschlossen. (HYG-01, HYG-02)
- Die Version steht als kleine goldene Zeile „v0.1.0“ unten rechts auf Titelschirm und Hauptmenü. Einzige Quelle ist `package.json`, ausgeliefert über `GET /version.json`. In der Lobby steht sie nicht. (HYG-02)
- `package.json`, `package-lock.json` und `SERVER_VERSION` stehen auf 0.1.0. Das README hat einen neuen Abschnitt „Schalter und Fadenvorlagen“. (HYG-01, HYG-02)
- `mess:klumpen` ist wieder grün. Beide Ursachen lagen im Messwerkzeug, kein Spielfehler. Das Werkzeug zählt jetzt nur Deck-0-Gegner (Graben), und die Graben-Fixtures sind neu basiert. (HYG-02)
- `sim-headless kette` meldet den Tod der Lerche im Reaktor-Countdown jetzt ehrlich, ohne das Wort „Softlock“. (HYG-02)
- Stand der Berichte (nicht das Prüfergebnis dieses Releases): `npm test` seriell zuletzt 418 von 418 grün (KAT-01), `npm run check` 10 von 10 (KAT-01). Golden Trace 6 von 6 byte-gleich zuletzt laut HYG-02 und BEA-03. Nach KAT-01 wurde der Golden Trace nicht gefahren, bei BEA-03 stand er auf dem Endstand aus. (KAT-01, HYG-02, BEA-03)

## Bekannt rot oder ungemessen

Stand der Berichte. Die Release-Prüfung dieses Releases trägt die Entwicklung selbst nach.

### Kein Spieltest durch Kai
- Kais Spieltests stehen aus. Alle Läufe waren Bot, Simulation und Claude, kein Spielabend mit echten Spielern. (REF-02, Version 0.1.0)
- Kais Lesen und Bewerten der Mitschnitte ist offen, die Berichte tragen `bewertung: offen`. (REF-01, REF-02, KAT-01)
- Mehrspieler an den Pulten ist nicht gemessen: Rettung, Hinterhalt, Landung, Helix, Wrack, Bunker (Handtest 1 bis 4 Spieler), Schwarm (Gruppenlauf unter Druck) und Gelände-Szenen. Die Läufer belegen nur Technik, kein Spielgefühl. (BEA-02, BEA-03, FAB-01, SON-01, WRK-01, EIS-01, MON-03, SPL-01, DYN-01)

### Rot oder Altlast
- `sim-headless kette`, Crew 3, Seed 1 bleibt rot. Die Lerche stirbt in `k2_konvoi` (t≈404 s) im Reaktor-Countdown. Der Bot kennt den Todesbildschirm nicht und läuft bis zum Zeitlimit. Das ist ein Bot-Fehler, kein Spieler-Softlock. Seed 2, Seed 3 und Crew 1 laufen grün. Kai: Bot-Taktik nicht jetzt. (HYG-02)
- Beobachtung für den Spieltest: Treffer halbieren die Restzeit des Reaktor-Countdowns ohne Mindestzeit (GEG-01 B). Der Tod ist dadurch wahrscheinlicher. (HYG-02)
- `zollkontrolle` hat keinen Auslöser im Spiel und ruht, mit Notiz im README (Kai). (HYG-01)
- Die Fadenvorlagen `dankbarer_captain`, `entfuehrter_haendler` und `falscher_haendler` sind nur mit Live-Spielleiter erreichbar. Im Rückfall werden sie nie geöffnet (Takt-Ausnahme). Takt-Notrufe feuern den Vorlagen-Hook nicht. Ein Rückfall-Weg ist nicht gebaut (Kai: nein, nur dokumentieren). Ob das Modell die Vorlagen von sich aus wählt, ist nicht gemessen. (HYG-01, HYG-02)
- Rote Linien aus REF-02: Von 30 Beat-Plänen wurden 6 abgelehnt (20,0 %, genau auf der Linie, nicht darüber). Ursache war der Zustandsübergang der neuen Beats, vor allem `hinterhalt` vor Landeplatz-Beats und `schmiergeld` vor `abschluss`. Von 19 verfügbaren Beats wurden 7 nie gewählt. 87,5 % der gültigen Pläne enthielten einen Landeplatz-Beat. In den Standard-Abenden wurden 3 von 12 Plänen abgelehnt (25 %), dort nicht neu gemessen. (REF-02)
- Beat-Pläne haben keinen Folge-Prompt nach einer Ablehnung, Claude erfährt den Fehler nicht. Ein solches Paket ist nicht gebaut, da die Restquote unter der Schwelle blieb. (REF-02, KAT-01)
- Gegenmessung KAT-01 (Katalog mit Zustandsregeln): 29 von 30 Plänen gültig, Vorher mit altem Katalog ebenfalls 29 von 30. Die 20 % aus REF-02 ließen sich nicht reproduzieren. Die Ursache ist ungeklärt: Zufall, Modellstand oder Kontext. Die einzige Ablehnung war `schmiergeld` nach `forderung`. (KAT-01)
- Landeplatz-Anteil gültiger Pläne: vorher 75,9 %, nachher 44,8 %, Bestätigungslauf 70 % (n=10), gepoolt 51 % (20 von 39). Die Streuung zwischen n=10-Läufen ist groß. Das Ziel von höchstens 60 % ist im Nachher-Lauf erfüllt, im Bestätigungslauf nicht. (KAT-01)
- Profil b (nur Schiff und Station als Landeplatz-Art) erreichte 4 von 10. Die Schwelle „höchstens 1 von 10“ ist nicht messbar. Der Fall „Landeplatz-Beat ohne Landeplatz“ ist nicht gemessen und im Spiel nicht herstellbar. (KAT-01)
- Profil d (Vorgeschichte) wurde live nicht gemessen. `wiedersehen` und `sabotage` bleiben ungemessen. (KAT-01)
- Im Nachher-Lauf nie gewählt: `spontanhilfe` und `landung`. In REF-02 war `spontanhilfe` nicht untersucht. (KAT-01, REF-02)
- Golden Trace nach KAT-01 nicht gefahren (KAT-01); bei BEA-03 stand der Golden auf dem Endstand von `main` aus (BEA-03). Die Release-Prüfung steht im REL-01-Bericht.
- Die Telemetrie-Basis wurde nach KAT-01 nicht neu gefahren (Kai, 2026-11-15: nicht vor 0.1.0). (KAT-01, REL-01)
- Die Reserve für künftige Beats ist aufgebraucht: Katalogwachstum +798 Zeichen bei höchstens 800. Kai hob die Test-Grenzen um 800 an (Weg A). (KAT-01)
- Die Bot-Beats für `landung`, `rettung` und `wrack` fehlen (`bot-beats.js`). Alle 6 Notruf-Abenteuer `notruf > rettung > abschluss` der Abende scheiterten oder blieben offen. Das ist ein Bot-Artefakt, kein Spielbefund. Mitschnitte mit Bodenbeats sagen nichts über Spielbarkeit. (REF-02, KAT-01)
- Der Bot kennt Helix nicht. `live-abend` nimmt im Rückfall das erste Angebot und bleibt so öfter an Helix hängen. (SON-01, REF-02)
- Kontingent: Im Messlauf überschoss es das Limit (62 134 bei 60 000). Die Freigabe des Bots kam erst 259 s später. Ob das Gate den Abenteuer-Spielleiter bei erreichtem Kontingent sperrt, ist nicht belegt. (REF-02)
- Verfall bei menschlichem Tempo ist ungemessen. Befund 2 der Lage-Messung bleibt „nicht entscheidbar“. (LIV-01, REF-02)
- Die Bot-Werte aus LIV-01 (Reaktionszeiten nahe 0 s) sind kein Maß. Reise-Notrufe kamen in LIV-01 in keinem Lauf vor, in REF-02 gab es 8 Reise-Notrufe in 5 Abenden. Alle Claude-Messläufe sind Bot-Läufe (Bot-Takt, künstliche Schritte). (LIV-01, REF-02)
- Wrack mit Räubern, Crew 3, Seed 7, mit Beute und Logbuch scheitert im Bot-Lauf. Entweder Bot-Schwäche oder Balance der Räuber-Besetzung, ungeklärt. (REF-01)
- Carrara (0105) beschädigt die Lerche am Beam-Punkt, sodass kein Beamen mehr geht. Das betrifft jeden Notruf an diesem Hex. Die Ursache ist nicht belegt (Vermutung: Asteroidenfeld). Nicht von BEA-02, auf `main` reproduziert. (BEA-02)
- Wartungs-Altlast Mutationsanker: `mutation-faden-landung`, `mutation-landung-bot` (seit WRK-01), `mutation-faden-szene` (`--trocken` Exit 2) und sechs Anker in `mutation-faden-katalog-b2`. Die Berichte nennen sie gleich auf `main`. Ob HYG-01 oder HYG-02 sie erfasst haben, steht dort nicht. (BEA-02, BEA-03, WRK-01)

### Ungemessen und Startwerte
- Die Frist-Werte sind Startwerte. `rettung` und `hinterhalt` haben je 16 Tätigkeiten, `landung` 12. Was ein Spieler typisch verbraucht, ist ungemessen. (BEA-02, BEA-03, FAB-01)
- Ohne aktiven Spielleiter läuft die Frist des Hinterhalts nie ab. Der Beat wartet, und der Halt stoppt jeden Schnellsprung durch dieses Hex dauerhaft. (BEA-03)
- Ein angenommener Notruf sperrt im Rückfall das Brett bis zu 16 Tätigkeiten, bevor er ohne Crew scheitert. (BEA-02)
- Helix hat die Frist 15. Gemessen wurden 3 bis 5 Tätigkeiten über 12 Seeds (Ausreißer 10 ohne Gegner-Abräumen), ein Kampf im Reise-Ereignis wurde nicht ausgespielt. Nach einem Abbruch ist das Brett bis zu 15 Tätigkeiten gesperrt. (SON-01)
- Hinterhalt: Nur vier Hexe der Karte sind zulässig (0503, 0505, 0705, 0806). Er wird nur angeboten, wenn eines davon in Reichweite ist. Offene Frage an Kai. (BEA-03)
- Nach einer Unterbrechung wählt der Hinterhalt sein Hex neu. Es gibt keine eigene Absicht dafür. `wiedersehen_erinnert` kennt ihn nicht. (BEA-03)
- Texte sind teils Platzhalter und von Kai noch gegenzulesen: Forderung (Optionstexte, Funktexte), Rettung (Texte, Funk, Brett-Schritt), Hinterhalt, Landung, Wrack (Texte, Funk, Logbuch) und die neuen Notrufe. Platzhalter sind auch der Lohn von 220 Marken bei Helix, die Besetzungszahlen am Boden und die Beute- und Erzwerte. (BEA-01, BEA-02, BEA-03, FAB-01, WRK-01, SON-01, FRE-03). Die Balance bleibt Spieltest.
- Der Regiebuchtext von Helix verspricht bei Verlust „noch einmal von vorn“. In der Freien Fahrt endet das Buch stattdessen. (SON-01)
- Die Ruf-Annahme der Germanen (Konkordat) ist zu prüfen. Texte einzelner alter Notrufe haben eine Fairness-Lücke. (FRE-03)
- Der Komponist `notruf` (Paket F) ist nicht gemessen und bleibt ausgeschaltet. (FRE-03)
- Nach Speichern und Laden mit angenommenem Notruf fehlen Katalog-Dank und Kampf. Der Faden schließt still als gelungen. (FRE-03)
- Notsprung, „alle am Boden bewusstlos“ und Rückholung sind nur in-process belegt, nicht am echten Server. Die Bots können nicht bewusstlos werden. (BEA-02, FAB-01)
- Gefahr doppelt (Reise-Gefahr im Raum plus Landung mit Besetzung) wurde im Läufer nicht ausgelöst. Ob das zu viel Kampf ist, zeigt der Spieltest. Medipack und Crew 2 sind nicht gemessen. (BEA-02, FAB-01)
- Wracks haben am Hauptschirm keine eigene Optik, nur die Transfer-Zeile. Ein Hinweis auf den nächsten Ort fehlt (Kai: später). (WRK-01)
- Die Frachtraum-Balance ist offen: Mit 4 Plätzen ist das Schiff nach ein bis zwei Adern voll, der Rest bleibt liegen. Der Szenentext „Genug Erz im Lager!“ kommt auch bei vollem Lager. (WRK-01)
- Die Absturzstelle hat keine Wrack-Optik. Die Rudel-Szene ist im Bot-Lauf nicht durchspielbar, da die Bots nicht auf Kreaturen schießen. (SPL-01)
- Der Spielleiter-Grobplan wählte Gelände nur bei thematischer Vorgabe (3 von 3), bei freier Wahl nie (0 von 3). Der Rückfall wählte Gelände in 2 von 100 Plänen. (SPL-01)
- Ob Claude Landeplätze bestellt, war bei DYN-01 ungemessen. Offen ist auch das Voxel-Rendering der Orte. Der Client-Kartenspeicher wächst je Ort um 5,5 bis 7,6 kB bis zum Neuladen. (DYN-01)
- Kachel-Stationen haben keinen Liegeplatz: Dort ist kein Andocken möglich und es gibt keinen Autosave. Die Besitz-Abbildung der Fraktionen ist eine Annahme. (KAC-01)
- Schwarm: Das Nest liegt nur in 13 von 40 Höhlen im Hörradius einer Ader. Mehrere Königinnen auf einer Karte sind ungelöst. Frame-Zeit im Browser und Live-Verhalten des Spielleiters sind ungemessen. Das Ziel unter 150 Dreiecke je Schwarmling ist verfehlt (282 bis 328). (MON-03)
- Eisenwald-Bunker: Die Balance von Welle 3 und Nachschub ist unbelegt. Der Bunker wirkt hell statt „unter dem Wald“. Im Bunker wird nie automatisch gespeichert, ein geladener Stand baut ihn frisch auf. Die Notrückholung verbrennt den Transfer. HUD-Zähler der Lobby fehlen in der Kampagne. (EIS-01)
- Last-Flakes im parallelen `npm test`: zum Beispiel `test-wildnis-hoehle`, `test-forderung-bot` Seed 601. Die Stufe `full` brauchte parallel zuletzt 1090 bis 1281 s; ihre Zeitgrenze (nur Hinweis) steht jetzt bei 1400 s und wurde nicht neu gemessen (REL-01). `test-version` braucht seriell 33 s bei 8 s Budget. Die Berichte nennen das Hinweise, keine Fehler. (HYG-01, HYG-02, WRK-01, KAT-01)
- Die Rückprobe hängt am Rohtext der Werte-Dateien (Zeilenenden). Die Trennung des Tuning-Hashs ist offen. (PAR-01)

### Weitere offene Punkte nach Bereich (aus den Berichten)

Nur, was oben nicht schon sinngemäß steht.

#### Bereich 1
- Angebote beim Andocken live ungeprüft (Bot-Abend dockt nicht selbst an) (FRE-02). Der Absichten-Modus wurde in REF-02 live gemessen: 19 von 20 gültig, NSC-Bezug 11 von 19, Qualität nicht bewertet (REF-02). Kais Lesung (SPL-02 Abnahme 9) ist offen (SPL-02).
- Die Anzeige des Bretts (Taste O) wurde nicht gesehen (FRE-02).
- Absichten-Modus: Angebote liegen dort am Hafen-Hex, Abnahme 1 von FRE-02 gilt dort nicht erfüllt (FRE-02). Persönlichkeit steht im gesprochenen Text nur bei 3 von 14 Absichten (SPL-02-Stand, inzwischen 17), bei den übrigen spricht der Katalogtext der Fadenmaschine (SPL-02). Rang- und Lage-Neins ohne Gegenvorschlag (SPL-02).
- Ziel eines Angebots ist teils nur ein Etikett: Konvoi, Geleit, Raumschlacht und Verfolgung spielen bei der Crew, nicht am Ziel (FRE-02). Auftraggeber ist in 20 von 20 Angeboten die Fraktion Rom, kein NSC. Bei „Ort wird im Funk genannt“ steht kein Ziel auf dem Brett (FRE-02).
- Gerüchtzeilen des Bretts sind praktisch leer (FRE-02). Ablehnen ohne Ruf- oder Haltungsfolge nicht eigens gemessen (FRE-02).
- Wegspringen im Kampf lässt die Haltung „geholfen“ stehen, nur Gedächtnis und Abschluss kippen (FRE-03).
- Eine Ablehnung des Prüfers in der Phase „wartet“ sperrt das Brett weiter, im Test festgehalten, nicht behoben (FRE-05). Die Ereignisreihenfolge im Rückfall ändert sich vermutlich (FRE-05).
- Krieg: Funk-Reiter voller Rauschen (nur 32 von 75 Meldungen im Lauf Seed 7 sind Kriegsmeldungen) (FRE-04 B2, offen). Kein Verlauf und keine Bilanz (B4), Postengründungen nie gefunkt (B5), Plaketten überlappen bei dichter Lage (B7), ohne Sprung kein Krieg (B8, nach 0.1.0) (FRE-04). Die Hauptwelt fiel in keinem der 6 Läufe, der Abspann ist ungesehen. Ein echter Spieler wurde nicht beobachtet, Ticks pro Minute ungemessen. Funk-Dichte mit Live-Spielleiter ungemessen (FRE-04).
- Kontingent: Die Leiste nutzt Browser-Schrift statt Pixelschrift, von Kai so bestätigt (Entscheidung, LIV-02 Nachtrag Nr. 1). Verhalten mit offener Funkwahl nicht im Bild geprüft (LIV-02). Das Kontingent-Gate sperrt den Lage-Spielleiter auch bei Ollama (LIV-02).
- Lage-Messung Befund 2 (kein Folge-Prompt nach Ablehnung) ist nicht entscheidbar (LIV-01).

#### Bereich 2
- Platzhalterwerte Forderung: Bestechung 40/90/160 Marken, Bußgeld 15/30/60 je Platz, Ruf −3 (BEA-01). Besetzungszahlen der Landung sind Platzhalter, Crew 3 kann bis zu 8 Gegner haben (FAB-01).
- Hinterhalt: Die Lerche wird nicht zentriert. Sieg und Flucht laufen im Läufer per Testhelfer und Teleport (BEA-03).
- Forderung: Invasion bleibt nach der Enthüllung manchmal aus (Bot: Verweigern-Weg 2 von 5 Seeds, Bestechen 3 von 4, vermutlich überzeichnet) (BEA-01). Notsprung während Schmiergeld lässt den Faden bis zum Kampf weiterlaufen. Darstellung der Wahl-Leiste im Client nicht geprüft, kein Live-Lauf (BEA-01).
- Rettung: Kachel-Landeplätze und Live-Lauf ungemessen. Zwei Dank-Zeilen im Erfolgsfall. Ein Bergung-Plan aus dem Vorrat hat immer ein Wrack (BEA-02).
- Landung: Bewaffneter Kampf am Boden mit Bots, Kachel-Landeplätze und Mehrspieler ungeprüft (FAB-01).
- Wrack: Fallen im Wrack ungeprüft, Postenhafen ohne Markt für Erz. Der Szenentext „Genug Erz im Lager!“ kommt auch ohne mitgekommenes Erz (WRK-01).
- Helix: Kein Live-Lauf (SON-01).
- Parallelisierung: Ob vier schwere Spuren gleichzeitig gehen, nicht gemessen. Prompt-Luft knapp (nach Rechnung WRK-01 bleiben 690 Zeichen im Katalog und 1 317 im Prompt, später durch KAT-01 weiter aufgebraucht) (PAR-01, WRK-01, KAT-01).

#### Bereich 3
- Kein Mensch hat die Frachträume gespielt. Füllstufen 25/50/75/100 % nur im Test, keine Bildreihe 1 bis 4 Plätze in einem Modul (LAD-01).
- Händlerauftrag bis Ablieferung nur auf Testebene, kein Bot-Lauf. Kampagnen-Konvoi k2 im Bot per Debug-Skip übersprungen (LAD-01).
- Preise, Waffen- und Erzwerte sind Platzhalter (LAD-01). Erz-Preis 7 Marken, Beute-Deckel und Erz-Mengen sind Startwerte (WRK-01).
- Posten ohne Markt: dort wird nichts verkauft, Frage an Kai offen. Germanen- und Piratenhäfen in der Freien Fahrt nicht andockbar, damit nicht handelsfähig (LAD-01).
- Faden-Fracht bei versperrtem Frachtraum scheitert ohne Neuangebot. Gemischte Tarnarten zeigen die Art des ersten Eintrags. Hafenklassen A bis D fließen nicht in den Preis (LAD-01).
- Frachtraum-Darstellung: Leuchtband des Tanks strahlt stark, Deuterium zeigt Tanks statt Fässer (LAD-01).
- Invasion: Etwa ein Drittel der Ablieferungen bleibt ohne Invasion (Kern lehnt ab; Annahme 63 bis 67 % beim Vormerken, im Prüfer-Lauf 6 von 10 mit Wirkung). Ankündigung und NSC-Text widersprechen dem Ausbleiben (Entwarnung folgt). Piraten-Weg nur simuliert, die alte Sprengung ohne Tat über Bauplan-Abenteuer besteht weiter. Vollständige `npm test`-Kette nicht gefahren (FAD-01).

## Bewusst nicht in 0.1.0

Aus „Nicht im Umfang von 0.1.0“ in Version 0.1.0 (die Liste ist in Version 0.1.0 teils überholt):
- Energiewesen (MON-04), verlangsamendes Gelände (GEL-04) und Licht und Partikel (GEL-05). (Version 0.1.0)
- KAC-01 Pakete E und F (optional): E (Migration) entfällt laut Bericht, F steht nur als Prüfung. (Version 0.1.0, KAC-01)
- Lerche einrichten (EIN-01) und Waffenskins (CHA-03). (Version 0.1.0)
- Neue Kultursätze (Ägypten, Babylon, Himmelsreich, Vorläufer). (Version 0.1.0)
- Sprachchat und alle Sleipnir-Dienste (eigene Projekte). (Version 0.1.0)
- Das handgeschriebene Finale in Hrafnheim bleibt, wie es ist. (Version 0.1.0)

Zusätzlich laut REL-01 und den Berichten:
- BEA-04 (Unterstützung durch ein Schiff) kommt nach 0.1.0 (Kai, 2026-11-14). (BEA-04, Version 0.1.0)
- AST-01 (Asteroid: Scannen, Abbau, Monster, Verkauf) und Beispiel 4 (Wrack, Station, Anomalie, Asteroid, Verkauf) sind nicht in 0.1.0. Der Wrack-Hinweis fehlt. Asteroiden als Körper sind nicht implementiert, ein Ort am Asteroiden geht nur über den Typ-Hex (DYN-01, KAC-01). Beispiel 4 entfällt aus der Referenz. (AST-01, Version 0.1.0, REL-01, DYN-01)
- KUL-04 (Hauptschirm Modelle und Politur) kommt nach 0.1.0 (Kai, 2026-11-11). Der Hauptschirm bleibt auf KUL-03. (KUL-04)
- SCH-02 (Rom-Schiff) ist nicht gebaut. Es liegt kein Bericht vor, in Version 0.1.0 steht es als „ganz zuletzt“. Solange Rom für Schiffe gesperrt ist, baut ein Wrack germanisch. (SCH-02, Version 0.1.0)

Ebenfalls ausdrücklich verschoben (Berichte):
- Weltsim-Treibstoff aus Wracks ist ein eigener kleiner Auftrag. (WRK-01)
- Keine Absicht, die den neuen Beat `hinterhalt` nutzt (eine ältere Absicht gleichen Namens aus SPL-02 gibt es), und die Bot-Taktik für den Reaktor-Countdown sind nicht gebaut. (BEA-03, HYG-02, REL-01)
- Feste Myzelfäden vom Nest und eine Bot-Regel für den Schwarm sind nicht gebaut. (MON-03)
