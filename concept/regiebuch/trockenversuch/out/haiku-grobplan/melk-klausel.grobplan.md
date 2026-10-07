# Die Kestri-Anfrage

**Auftraggeber:** melk · **Ziel:** 15 min · **Szenen:** 5

**Aufhänger:** Archivarin Melk hat die Tafel von Kesh dekodiert – und eine Frage gefunden, die das Kustoden-Relais nicht beantworten konnte. Sie braucht die Crew, um eine alte Kustoden-Leitbake auf dem Mond Kesh zu aktivieren und die richtige Antwort zu holen.

**Erinnerung aus dem Weltstand:** Melk speicherte: Die Tafel von Kesh liegt jetzt im Konkordat-Archiv. Gebracht hat sie die Crew der Lerche. Jetzt will sie wissen, was die Crew bereit ist, für Wissen zu riskieren.

## Szenen

### 1. D1 Hafen – Hafen Lichtkordon, ~2 min

*Funkduell mit zwei Antworten und Schweigen*

Melk funkt vom Archiv: Die Tafel zitiert eine Frage, die schon einmal gestellt wurde. Das Relais hat geantwortet: ‚Frage erkannt, Antwort wird vorbereitet.' Aber es antwortet nicht. Melk vermutet: Die Antwort ist auf eine andere Frage programmiert. Sie braucht die Crew, um auf Kesh eine alte Bake zu reaktivieren – vielleicht findet sich dort der Schlüssel.

**Wendung:** Melk nennt einen Preis: Das Konkordat zahlt für jeden Beweis, den die Crew über das Relais mitbringt. Oder will die Crew etwas anderes?

**Weiter:** Crew akzeptiert → sprung_kesh

### 2. A2 Annäherung & Erkundung – Mond Kesh (Außenmission), ~3 min

*Signal per Weitscan finden*

Die Lerche gleitet auf Kesh zu. Die Sensoren zeigen: Auf der Mondoberfläche aktiviert sich etwas – alt, schwach, aber lebendig. Eine Bake sendet im Kustoden-Spektrum.

**Wendung:** Der Scan wird unterbrochen. Eine Gruppe bewaffneter Figuren in alten Anzügen bewacht die Bake. Sie waren schlafend oder inaktiv – nun regen sie sich.

**Weiter:** Bake lokalisiert → landung_bake

### 3. C2 Gefecht – Mond Kesh (Außenmission), ~4 min

*Trupp ausschalten oder durchbrechen*

Das Außenteam beamt sich ab und nähert sich dem Bake-Gehäuse. Die Wachfiguren formieren sich – alte Kustoden-Konstrukte, rostig aber funktionsfähig. Sie greifen an.

**Weiter:** Gegner erledigt oder übemanövriert → bake_aktivierung

### 4. C5 Rätselort – Mond Kesh (Außenmission), ~2 min

*Tor nur zu zweit zu öffnen*

Das Bake-Gehäuse öffnet sich teilweise. Ein Mechanismus aus zwei Schlüsseln wird sichtbar – weit auseinander, müssen gleichzeitig gehalten werden. Der Captain sieht von oben auf die Taktikkarte, das Außenteam sieht die Schlüssel.

**Wendung:** Die Bake aktiviert und sendet eine verschlüsselte Nachricht – nicht an das Relais, sondern direkt an die Lerche. Der Captain kann sie triangulieren, aber braucht Zeit.

**Weiter:** Schlüssel aktiviert → botschaft_empfang

### 5. A3 Begegnung – Mond Kesh, ~2 min

*Funkduell mit zwei Antworten und Schweigen*

Die Bake sendet eine Antwort – nicht in Worte gefasst, sondern als Datensignatur. Das Relais erhält es zeitgleich. Melk funkt: Das Relais antwortet jetzt. Aber auf welche Frage?

**Wendung:** Ein neuer Sender meldet sich: eine Kustoden-Sonde, nicht gehört seit Jahrzehnten. Sie fragt: ‚Wer hat die alte Frage gelesen? Wer redet für die Apkallu?'

**Weiter:** Crew antwortet Lerche → ausgang_lerche · Crew antwortet Konkordat → ausgang_konkordat · Crew schweigt → ausgang_versiegelt

## Entscheidungen

**Nimmt die Crew Melks Auftrag an – oder fordert sie eine andere Bezahlung oder Bedingung?** (Szene auftrag_melk)
- *Ja, das Konkordat-Geld ist fair. Wir aktivieren die Bake.* → Melk nennt Koordinaten; die Crew kann ohne Vorbedingung landen. Das Relais notiert: Lerche handelt mit dem Konkordat.
- *Nur, wenn Melk uns sagt, was die Tafel wirklich fragt – bevor wir landen.* → Melk zögert, gibt dann preis: Die Frage heißt ‚Wer trägt die Antwort?'. Das macht die Szenen intensiver. Die Crew weiß jetzt, worauf die Sonde antwortet.

**Die Sonde fragt: ‚Wer hat die alte Frage gelesen? Wer redet für die Apkallu?' – Wie antwortet der Captain?** (Szene botschaft_empfang)
- *Die Lerche hat die Frage gelesen. Wir reden nur für uns selbst.* → Die Sonde schweigt; das Relais antwortet: ‚Antwort empfangen. Archiv geschlossen.' Melk erhält alte Daten – genug für eine These, aber kein Beweis.
- *Das Konkordat hat sie gelesen. Melk redet für sie.* → Die Sonde antwortet: ‚Konkordat erkannt. Apkallu-Fragment verfügbar: Koordinaten folgen.' Das Relais bestätigt. Melk dankt; neue Spur eröffnet sich.
- *Schweigen. Keine Antwort.* → Die Sonde wartet und wartet, dann: ‚Antwort negiert. Archiv bleibt geschlossen.' Die Crew entkommt mit der rohen Botschaft, aber ohne Kontext.

## Ausgänge

**ausgang_lerche** – Crew antwortet ‚Lerche'
- npc_haltung melk 1
- welt_fakt kustoden_botschaft_gehört = lerche
- chronik Kesh-Bake: Die Crew reaktivierte eine alte Kustoden-Bake und vernahm eine Sonde, die von der Apkallu sprach. Das Relais antwortet jetzt auf eigene Fragen.

**ausgang_konkordat** – Crew antwortet ‚Konkordat'
- npc_haltung melk 2
- welt_fakt kustoden_vertrauen_konkordat
- chronik Kesh-Bake: Das Konkordat wird vom Kustoden-Relais erkannt. Ein Fragment der Apkallu ruft nach Koordinaten – neue Spur.
- npc_gedaechtnis melk: Die Crew sprach im Namen des Konkordats zur Kustoden-Sonde. Das ist Mut oder Wahnsinn. Ich werde erfahren, welches.

**ausgang_versiegelt** – Crew schweigt
- npc_haltung melk 0
- welt_fakt kustoden_misstrauen_wächter
- chronik Kesh-Bake: Das Archiv versiegelte sich. Eine alte Sonde fragte nach der Apkallu – die Crew antwortete nicht. Das Relais schweigt nun wieder.
- npc_gedaechtnis melk: Die Crew hätte sprechen sollen. Jetzt weiß ich weniger als zuvor. Wer Kustoden nicht redet, wird von ihnen nicht gehört.

---
*Erzeugt in v1: 31 s, 2993 Tokens, v2: 30 s, 2970 Tokens · Modell haiku · Prüfer: Szene 'botschaft_empfang': Folgeszene 'ausgang_lerche' gibt es nicht | Szene 'botschaft_empfang': Folgeszene 'ausgang_konkordat' gibt es nicht | Szene 'botschaft_empfang': Folgeszene 'ausgang_versiegelt' gibt es nicht | Ausgang 'ausgang_lerche' wird von keiner Szene erreicht | Ausgang 'ausgang_konkordat' wird von keiner Szene erreicht | Ausgang 'ausgang_versiegelt' wird von keiner Szene erreicht*