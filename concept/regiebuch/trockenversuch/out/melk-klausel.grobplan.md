# Was die Tafel verschweigt

**Auftraggeber:** melk · **Ziel:** 15 min · **Szenen:** 5

**Aufhänger:** Archivarin Melk hat in der Tafel von Kesh eine Koordinate entdeckt, die auf eine zweite Kustoden-Anlage auf dem Mond selbst verweist. Sie will Beweise – keine Interpretation, keine Theorie, nur Daten von vor Ort.

**Erinnerung aus dem Weltstand:** Melks Erinnerung: Die Tafel von Kesh liegt jetzt im Konkordat-Archiv, gebracht hat sie die Crew der Lerche.

## Szenen

### 1. D1 Hafen – Hafen Lichtkordon, ~2 min

Melk empfängt die Crew im Archiv-Antechamber: Die Tafel enthält eine Koordinate auf Kesh – eine zweite Anlage, versiegelt. Sie braucht Scan-Daten von dort, sonst bleibt die Tafel unlesbar. Bezahlung: 120 Marken plus Archivzugang.

**Weiter:** Auftrag angenommen → s2_splitter

### 2. A7 Gefahrennavigation – Splittergürtel, ~4 min

*Objekt unter Störung scannen*

Auf dem Weg nach Kesh liegen drei Störrelais im Splittergürtel – Kustoden-Technik, die alle Scans des Monds unterdrückt. Erst wenn sie stumm sind, kann die Lerche Kesh vorscannen.

**Wendung:** Sobald das zweite Relais fällt, meldet sich eine unbekannte Funkstimme kurz und bricht sofort ab – sie hat die Lerche gesehen.

**Weiter:** Alle Relais ausgeschaltet → s3_kesh_aussen · Crew bricht ab, Relais aktiv → ausgang:abbruch

### 3. C1 Erkundung – Mond Kesh (Außenmission), ~3 min

*Fund aus dem Gewölbe bergen*

Die Anlage liegt halb unter Sand: ein versiegeltes Kustoden-Gewölbe. Das Außenteam öffnet das Tor und sichert den Inhalt – eine zweite Tafel, kleiner, mit einem eingravierten Antwort-Muster, das dem Relais-Signal ähnelt.

**Weiter:** Tafel gesichert → s4_kesh_raetsel

### 4. C5 Rätselort – Mond Kesh (Außenmission), ~3 min

*Tor nur zu zweit zu öffnen*

Im Inneren des Gewölbes liegen zwei Aktivierungspunkte weit auseinander: Beide müssen gleichzeitig gehalten werden, damit eine verborgene Kammer öffnet und die Scan-Daten für Melk vollständig werden. Der Captain sieht die Raumstruktur von oben und lotst.

**Wendung:** Ankündigung: Während das Rätsel läuft, nähern sich auf dem Captain-Schirm zwei Jäger-Signaturen – jemand kommt nach.

**Weiter:** Kammer geöffnet, Daten gesichert → s5_abwehr · Kammer bleibt verschlossen → ausgang:unvollstaendig

### 5. A4 Raumgefecht – Mond Kesh, ~4 min

*Angriffswelle mit Verstärkung*

Zwei Rostmeute-Jäger greifen beim Abflug an – Grauzahn hat die Lerche im Splittergürtel erkannt und eine Nachhut geschickt. Das Außenteam beamt hoch während die Lerche kämpft.

**Weiter:** Jäger besiegt oder vertrieben → ausgang:erfolg · Schaden kritisch, Abflug erzwungen → ausgang:unvollstaendig

## Entscheidungen

**Die unbekannte Stimme meldet sich erneut und warnt: Geht nicht weiter, die Anlage ist abgeriegelt – wer sich nähert, wird gemeldet. Gibt die Crew nach oder setzt sie den Kurs fort?** (Szene s2_splitter)
- *Kurs halten, Warnung ignorieren* → In s5 kommt ein zweites Kanonenboot als Verstärkung – die Stimme hat tatsächlich jemanden gerufen.
- *Antworten und verhandeln* → Die Stimme schweigt danach; s5 bleibt bei zwei Jägern, aber Grauzahn erfährt, dass die Lerche redet statt kämpft (npc_haltung grauzahn +0, aber welt_fakt für spätere Missionen).

**Die verborgene Kammer enthält neben den Scan-Daten eine zweite Botschaft – unleserlich für die Crew, aber offensichtlich kein Konkordat-Dokument. Mitnehmen oder nur die Scan-Daten sichern und alles andere unangetastet lassen?** (Szene s4_kesh_raetsel)
- *Beides sichern* → Melk erhält mehr Material; npc_haltung melk +1, aber welt_fakt: Kustoden-Aktivität steigt in der nächsten Mission.
- *Nur die Scan-Daten* → Anlage bleibt ungestört; kein Kustoden-Echo, aber Melk ist merklich enttäuscht (npc_haltung melk ±0).

## Ausgänge

**erfolg** – Jäger in s5 abgewehrt, Scan-Daten bei Melk abgeliefert
- npc_haltung melk +1
- npc_gedaechtnis melk: Die Crew hat die Koordinate auf Kesh verifiziert und mir die Scan-Daten gebracht.
- chronik: Was die Tafel verschweigt: Die zweite Kustoden-Anlage auf Kesh ist geöffnet, die Scan-Daten liegen bei Melk. Grauzahns Nachhut ist besiegt.
- welt_fakt kustoden_zweite_anlage: Auf Kesh liegt eine zweite versiegelte Kustoden-Anlage; ihr Antwort-Muster ähnelt dem Relais-Signal.

**unvollstaendig** – Kammer bleibt verschlossen oder Abflug erzwungen vor Datenübergabe
- npc_haltung melk -1
- npc_gedaechtnis melk: Die Crew ist zurückgekehrt, aber die Scan-Daten sind unvollständig. Die Tafel bleibt halb unlesbar.
- chronik: Was die Tafel verschweigt: Die Anlage auf Kesh wurde erreicht, aber nicht vollständig ausgewertet.
- welt_fakt kustoden_zweite_anlage: Auf Kesh liegt eine zweite Kustoden-Anlage – unbestätigt, da die Daten fehlen.

**abbruch** – Crew schaltet Relais nicht aus und kehrt zum Hafen zurück
- npc_haltung melk -1
- npc_gedaechtnis melk: Die Crew ist umgekehrt. Die Koordinate auf Kesh bleibt ungeprüft.
- chronik: Was die Tafel verschweigt: Die Lerche ist nicht nach Kesh geflogen. Melks Frage bleibt offen.
- welt_fakt kustoden_relais_sperrung: Kustoden-Störrelais im Splittergürtel sind noch aktiv – Kesh-Scans bleiben blockiert.

---
*Erzeugt in v1: 50 s, 2737 Tokens · Modell sonnet · Prüfer: gültig*