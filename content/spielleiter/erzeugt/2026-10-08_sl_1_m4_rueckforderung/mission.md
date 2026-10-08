---
status: offen
quelle: llm
erstellt: 2026-10-08T11:23:08.118Z
auftraggeber: grauzahn
titel: "Grauzahns Preis"
kennung: 2026-10-08_sl_1_m4_rueckforderung
---

# Grauzahns Preis

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen 2026-10-08_sl_1_m4_rueckforderung`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Grauzahn (Rostmeute) (`grauzahn`) |
| Quelle | llm, Modell sonnet, 60862 Tokens |
| Welt / Anlass | `w-test` – missionsgrenze nach `m3` |
| Zieldauer | 15 min |
| Belohnung | 160 Marken |
| Ziel | Splittergürtel |
| Szenen | 6 |

## Pitch

Ihr habt mir zweimal die Nase gerieben, Lerche. Diesmal bezahlt ihr – oder ihr eskoriert meine Ladung durch den Splitter. Meine Bedingungen, mein Kurs.

## Erinnerung

„Im Nebel hat die Lerche mich mit einer Konkordat-Patrouille geblufft – und es hat geklappt. Das merke ich mir.“ – Bezug: Grauzahn (Rostmeute) / `geblufft`

Ohne passende Erinnerung: „Grauzahn (Rostmeute) hat wieder Arbeit für die Lerche.“

## Szenen

### 1. s1_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Grauzahn meldet sich direkt am Andockarm: Er hat eine Fracht im Splittergürtel liegen, seine eigenen Leute trauen sich nicht ran – ein Konkordats-Aufpasser patrouilliert dort. Er will, dass die Lerche die Ladung birgt und an seinen Läufer Skart am Wrack übergibt. Kein fairer Deal, aber die Alternative klingt schlechter.
- **Weiter:** Crew nimmt den Auftrag an → `s2_splitter`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Grauzahn (Rostmeute):** „Ihr habt mir zweimal die Nase gerieben, Lerche. Diesmal bezahlt ihr – oder ihr eskoriert meine Ladung durch den Splitter. Meine Bedingungen, mein Kurs.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. s2_splitter – Splittergürtel

- **Szenentyp:** annaeherung_und_erkundung · **Baustein:** `signal_orten/weitscan_peilung` · **Fassung:** llm · **Plan:** 3 min
- **Sachverhalt:** Im Splittergürtel funkt Skart kurz auf: Die Kisten sind irgendwo im Feld, er weiß selbst nicht mehr genau wo. Die Crew muss die Ladung per Weitscan orten, bevor der Aufpasser sie entdeckt.
- **Wendung (Plan):** Ankündigung: Ein Konkordat-Inspektor meldet sich auf dem offiziellen Kanal und fragt nach dem Auftrag der Lerche.
- **Weiter:** Ladung geortet → `s3_begegnung`

**Ziele**

- Nach Splittergürtel springen
- Taktik: Weitscan (W) – die Kisten suchen
- Taktik: anvisieren (T) und scannen (S halten)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Splittergürtel. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s)* **ODA:** „Irgendwo hier ist die Kisten. Taktik: Weitscan (W) – Marker für den Piloten!“
- *(nach 60 s)* **Wendung** `s2_inspektor_meldet_sich` – Ankündigung (gleichzeitig): ODA „Offizieller Kanal aktiv – ein Konkordat-Inspektor fragt nach eurem Auftrag im Splittergürtel.“
  - **Funk – Inspektor Varn:** „Unbekanntes Schiff im Sektor 7-Delta – nennt Auftrag und Registrierung. Sofort.“
- *(sobald erfüllt)* **ODA:** „Taktik: W drückt den Weitscan – Reichweite 1000. Mehrmals und an verschiedenen Stellen probieren.“
- *(sobald erfüllt)* **ODA (Richtung):** „die Kisten kommt von {dir} von uns. Hinfliegen und nochmal Weitscan (W)!“
- *(Autolösung)* **ODA:** „Ich habe die Kisten angepeilt und markiert. Anvisieren (T) und scannen (S)!“

### 3. s3_begegnung – Splittergürtel

- **Szenentyp:** begegnung · **Baustein:** `taeuschen/bluff_funk` · **Fassung:** llm · **Plan:** 3 min
- **Sachverhalt:** Inspektor Varn funkt die Lerche direkt an: Er hat ihren Weitscan registriert und will wissen, was sie in dem Sektor suchen. Die Ortung zeigt gleichzeitig, dass Varns Schiff einen beschädigten Scanarm hat – ein Detail, das sich für einen Bluff nutzen lässt.
- **Weiter:** Bluff gelingt oder Crew gibt zu → `s4_bergung`

**Entscheidung:** Was antwortet die Crew Inspektor Varn?

- Wir testen unseren eigenen Scanarm – nichts Besonderes. → Varn zieht sich zurück; sein beschädigter Scanner kann die Lüge nicht prüfen. Kein Aufpasser bei der Bergung.
- Wir suchen Treibgut – alles legal. → Varn bleibt misstrauisch und dreht eine zweite Runde; die Crew hat weniger Zeit beim Bergen und Varn meldet den Fund später.

**Ziele**

- Captain: antworten (Funk) – Ortung beachten

**Texte in Reihenfolge**

- **Funk – Inspektor Varn:** „Hier Inspektor Varn, Konkordat-Aufsicht Splitter-Sektor 7. Ihr Weitscan hat unser System getriggert – nennt Zweck und Ziel, sonst eskoriere ich euch persönlich raus.“
- **ODA:** „Funkspruch! Gleich kommt die Ortung – hört genau hin, bevor der Captain antwortet.“
- *(nach 8 s)* **ODA:** „ODA: Varns Schiff – Scanarm Backbord defekt, keine aktive Tiefenortung möglich.“
- *(nach 10 s)* **Entscheidung** `s3_begegnung_wahl`: „Was antwortet die Crew Inspektor Varn?“
  - Option `passend`: „Wir testen unseren Scanarm – Kalibrierungsfahrt, nichts weiter.“
    - **Funk – Inspektor Varn:** „Kalibrierung, ja. Mein System zeigte Ausschläge. Passt. Haltet euch an die Leitlinien.“
  - Option `falsch`: „Wir suchen einen vermissten Frachter auf Anfrage des Hafens.“
    - **Funk – Inspektor Varn:** „Kalibrierung? Euer Muster sieht aus wie gezieltes Absuchen. Ich komme näher.“
  - Option `wahrheit`: „Wir suchen Treibgut – alles legal angemeldet.“
- *(nach 50 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Was hat die Ortung gesagt?“

### 4. s4_bergung – Splittergürtel

- **Szenentyp:** bergung_im_all · **Baustein:** `ladung_bergen/bergungskisten` · **Fassung:** llm · **Plan:** 4 min
- **Sachverhalt:** Die Kisten treiben im dichten Gestein. Skart funkt ungeduldig; Varn könnte zurückkommen. Die Crew muss die Ladung schnell einsammeln, bevor die Zeit abläuft.
- **Wendung (Plan):** Ankündigung: Rostmeute-Jäger tauchen auf – Grauzahn schickt sie, um 'aufzupassen', aber sie machen Druck auf die Lerche.
- **Weiter:** Ladung vollständig geborgen → `s5_uebergabe`; Jäger greifen an oder Crew bricht ab → `s5_gefecht`

**Entscheidung:** Die Rostmeute-Jäger machen Druck – was tut die Crew?

- Ladung zuerst, dann kämpfen. → Mehr Kisten gesichert, aber Hüllenschaden durch Beschuss. Bessere Auszahlung, schwächeres Schiff.
- Zuerst die Jäger vertreiben. → Weniger Kisten geborgen, Schiff bleibt heil. Grauzahn zahlt weniger und ist verstimmt.

**Ziele**

- Bergungsgut einsammeln ({salvaged}/4)

**Texte in Reihenfolge**

- *(nach 3 s)* **ODA:** „Holt die Kisten raus – grüne Marker, drüberfliegen reicht. Varn kommt vielleicht zurück, also zieht Tempo!“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Kisten sind auf der Taktikkarte grün. Der Pilot sieht nur nach vorn – Taktik, Marker setzen!“
- *(nach 55 s)* **Wendung** `s4_jaeger_tauchen_auf` – Ankündigung (gleichzeitig): ODA „ODA: Zwei Signale auf Kollisionskurs – Rostmeute-Transponder, Klasse Jäger. Abstand sinkt.“
  - **Funk – Skart:** „Grauzahns Aufpasser. Ignoriert die, sammelt weiter – oder ihr bereut es.“
- *(sobald erfüllt)* **ODA:** „Den Rest lassen wir treiben. Vielleicht findet es jemand Bedürftigeres.“

### 5. s5_gefecht – Splittergürtel

- **Szenentyp:** raumgefecht · **Baustein:** `vertreiben/bis_zur_flucht` · **Fassung:** rohfassung · **Plan:** 3 min
- **Sachverhalt:** Die Rostmeute-Jäger greifen offen an – entweder auf Befehl Grauzahns oder weil sie die halbgeborgene Ladung selbst wollen. Die Crew muss sie vertreiben, um danach die restliche Ladung zu sichern oder abzuhauen.
- **Weiter:** Jäger fliehen, Ladung teilweise an Bord → `s5_uebergabe`; Crew flieht ohne Ladung → Ausgang `abbruch`

**Ziele**

- Angreifer vertreiben ({left:s5_gefecht_w1} übrig)

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Angreifer! Die wollen Beute, keinen Heldentod – genug Treffer, und sie drehen ab.“
- *(nach 3 s)* **Funk – Unbekannte Stimme:** „Letzte Warnung, Lerche. Dreht ab, sonst wird es teuer.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Angeschlagene Gegner fliehen. Taktik: Feuer bündeln, einen nach dem anderen. Pilot: Breitseite.“
- *(sobald erfüllt)* **Funk – Unbekannte Stimme:** „Das ist es nicht wert. Rückzug! Wir sehen uns wieder.“
- *(Autolösung)* **ODA:** „Die Angreifer geben auf und drehen ab. Gut so.“

### 6. s5_uebergabe – Wrack „Zaunkönig“

- **Szenentyp:** begegnung · **Baustein:** `verhandeln/funkduell` · **Fassung:** llm · **Plan:** 2 min
- **Sachverhalt:** Am Wrack wartet Skart mit seinem Kutter. Grauzahn schaltet sich per Funk zu und verhandelt die Auszahlung: Er kennt die Lage und will wissen, ob die Lerche sauber geliefert hat. Der Captain muss Farbe bekennen – Grauzahn zahlt entsprechend.
- **Weiter:** volle Lieferung, Bluff gelungen → Ausgang `erfolg`; Teillieferung oder Bluff aufgeflogen → Ausgang `halbvoll`

**Ziele**

- Nach Wrack „Zaunkönig“ springen
- Captain: antworten (Funk)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Wrack „Zaunkönig“. Steuer: Ziel wählen, F für den Faltsprung.“
- **Funk – Grauzahn (Rostmeute):** „Lerche, ich sehe Skart – und ich sehe seine Kisten. Jetzt rede ich mit euch, nicht mit ihm.“
- **Entscheidung** `s5_uebergabe_wahl`: „Saubere Lieferung, oder habt ihr mich wieder mal überrascht?“
  - Option `a`: „Alles da. Volle Ladung, kein Kratzer.“
    - **Funk – Grauzahn (Rostmeute):** „Hm. Skart nickt. Dann war das ein ordentlicher Lauf – für euch.“
    - **ODA:** „Grauzahn bestätigt die Übergabe. Abrechnung folgt.“
  - Option `b`: „Was ankam, ankam. Mehr war nicht drin.“
    - **Funk – Grauzahn (Rostmeute):** „Dachte ich mir. Ihr bekommt, was übrig blieb – nicht mehr.“
    - **ODA:** „Teilabnahme registriert. Grauzahn ist nicht zufrieden.“
  - Option `schweigen`: „Funkstille“
    - **Funk – Grauzahn (Rostmeute):** „Schweigen ist auch eine Antwort. Und keine gute.“
    - **ODA:** „Keine Rückmeldung. Grauzahn wertet es als Teilergebnis.“
- **ODA:** „Funkspruch! Captain: Antwort im Reiter „Funk“ – sprecht euch ab.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Schweigen ist auch eine Antwort – aber keine freundliche.“

## Ausgänge

### erfolg

*Volle Ladung geliefert und Bluff bei Varn gelungen*

- Belohnung: 160 Marken
- Haltung Grauzahn (Rostmeute): +1
- Gedächtnis Grauzahn (Rostmeute) (`m4_rueckforderung_erfolg`): „Die Lerche hat geliefert und Varn ausgetrickst. Vielleicht sind sie nützlicher als gedacht.“
- Chronik: „Grauzahns Preis – Die Crew birgt Rostmeute-Ladung aus dem Splitter und überlistet einen Konkordat-Inspektor.“
- Fakt `inspektor_varn` (offener Faden): „Varn hat die Lerche im Splitter bemerkt – er könnte später nachfragen.“

### halbvoll

*Teillieferung oder Bluff ist aufgeflogen*

- Belohnung: 160 Marken
- Gedächtnis Grauzahn (Rostmeute) (`m4_rueckforderung_halbvoll`): „Halbe Arbeit. Die Lerche ist unzuverlässig oder zu ehrlich – beides stört mich.“
- Chronik: „Grauzahns Preis – Teilauftrag erfüllt; Varn hat die Lerche auf dem Schirm.“
- Fakt `inspektor_varn` (offener Faden): „Varn hat konkrete Hinweise auf die Lerche und die Rostmeute – er wird ermitteln.“

### abbruch

*Crew flieht ohne Ladung*

- Haltung Grauzahn (Rostmeute): -1
- Gedächtnis Grauzahn (Rostmeute) (`m4_rueckforderung_abbruch`): „Die Lerche ist geflüchtet und hat meine Ladung im Splitter gelassen. Das kostet sie.“
- Chronik: „Grauzahns Preis – Die Crew floh vor der Rostmeute ohne die Lieferung.“
- Fakt `inspektor_varn` (offener Faden): „Varn sichert die herrenlosen Kisten – Inhalt unbekannt, Konkordat ermittelt.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 's3_begegnung_geglueckt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's3_begegnung_durchschaut' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's5_teil_geliefert' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: Grobplan: GEGNER-AUFTRAGGEBER Szene 's5_gefecht': vertreiben/bis_zur_flucht – der Auftraggeber 'grauzahn' funkt als Anführer der Angreifer; Gegner bekommen eine eigene Stimme (neu:Name)

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
