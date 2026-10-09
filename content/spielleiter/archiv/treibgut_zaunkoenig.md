---
status: angenommen
quelle: archiv
erstellt: 2026-10-08
auftraggeber: grauzahn
titel: "Treibgut Zaunkönig"
kennung: treibgut_zaunkoenig
---

# Treibgut Zaunkönig

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen treibgut_zaunkoenig`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Grauzahn (Rostmeute) (`grauzahn`) |
| Quelle | archiv, Modell hand |
| Zieldauer | 15 min |
| Belohnung | 190 Marken |
| Ziel | Wrack „Zaunkönig“ |
| Szenen | 5 |

## Pitch

Lerche, hier Grauzahn. Am Wrack Zaunkönig treibt frische Ware, und meine Leute sind zu ungeschickt für Bergung. Halbe-halbe. Ihr holt, ich zahle.

## Erinnerung

„Grauzahn weiß, dass die Lerche ihn im Nebel geblufft hat. Er bietet trotzdem ein Geschäft an – oder gerade deshalb.“ – Bezug: Grauzahn (Rostmeute) / `geblufft`

Varianten (je nach Weltstand):
- Grauzahn (Rostmeute) / `echo_geteilt`: „Die Lerche hat im Nebel mit Grauzahn geteilt. Er glaubt, sie teilt wieder.“
- Grauzahn (Rostmeute) / `bluff_durchschaut`: „Grauzahn hat den Bluff der Lerche durchschaut. Diesmal will er schriftlich, was ihm zusteht.“
- Grauzahn (Rostmeute) / `wegezoll_gezahlt`: „Die Lerche hat Grauzahn schon einmal Zoll gezahlt. Jetzt soll sie für ihn arbeiten.“

Ohne passende Erinnerung: „Grauzahn bietet selten Arbeit an. Wer annimmt, sollte die Hand am Abzug lassen.“

## Szenen

### 1. tz_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 1 min
- **Sachverhalt:** Grauzahn funkt in den Hafen und bietet ein Geschäft an: Bergung am Wrack Zaunkönig, Beute halbe-halbe.
- **Weiter:** Auftrag angenommen → `tz_treibgut`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Grauzahn (Rostmeute):** „Lerche, hier Grauzahn. Am Wrack Zaunkönig treibt frische Ware, und meine Leute sind zu ungeschickt für Bergung. Halbe-halbe. Ihr holt, ich zahle.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. tz_treibgut – Wrack „Zaunkönig“

- **Szenentyp:** bergung_im_all · **Baustein:** `ladung_bergen/bergungskisten` · **Fassung:** archiv · **Plan:** 3 min
- **Sachverhalt:** Rund um das Wrack treiben Kisten, die aus einem aufgeplatzten Frachtraum gerissen wurden. Die Lerche sammelt sie ein.
- **Weiter:** Kisten geborgen → `tz_wrack`

**Ziele**

- Nach Wrack „Zaunkönig“ springen
- Bergungsgut einsammeln ({salvaged}/3)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Wrack „Zaunkönig“. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 3 s)* **ODA:** „Treibgut rund ums Wrack (grün)! Drüberfliegen sammelt ein – Taktik lotst, Pilot fliegt.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Kisten sind auf der Taktikkarte grün. Der Pilot sieht nur nach vorn – Taktik, Marker setzen!“
- *(sobald erfüllt)* **ODA:** „Den Rest lassen wir treiben. Vielleicht findet es jemand Bedürftigeres.“

### 3. tz_wrack – Wrack „Zaunkönig“ (Karte wreck)

- **Szenentyp:** erkundung · **Baustein:** `ausschlachten/wrack_container` · **Fassung:** archiv · **Plan:** 4 min
- **Sachverhalt:** Im Wrack selbst stehen frisch angetriebene Container. Das Außenteam räumt sie aus, während sich draußen etwas sammelt.
- **Wendung (Plan):** Nach einer Minute meldet die Ortung Jäger-Signaturen hinter dem Wrack; Grauzahn funkt, er sehe nur zu.
- **Weiter:** Container geborgen, alle an Bord → `tz_forderung`

**Ziele**

- Außenteam runterbeamen
- Bergungsgut bergen (E halten)
- Zurück an Bord beamen

**Texte in Reihenfolge**

- **grund:** „Ortung: Ein zweiter Frachtraum ist aufgeplatzt – frische Container sind ins Wrack gedriftet.“
- *(nach 2 s)* **ODA:** „Außenteam auf die Pads. Drinnen ist es dunkel – Captain: Reiter „Außenteam“ zeigt die Kisten.“
- *(nach 60 s)* **Wendung** `tz_zuschauer` – Ankündigung (gleichzeitig): ODA „Ortung: Jäger-Signaturen hinter dem Wrack. Noch halten sie Abstand.“
  - **Funk – Grauzahn (Rostmeute):** „Schön fleißig, Lerche. Lasst euch nicht stören – ich sehe nur zu.“
- *(nach 70 s, Hinweis, falls nötig)* **ODA:** „Captain: die Kisten auf der Außenteam-Karte ansagen. Unten: hingehen, E halten, dann zurück zu den Pads.“
- *(sobald erfüllt)* **ODA:** „Alles geborgen! Zurück zu den Pads, dann holen wir euch hoch.“
- *(sobald erfüllt)* **ODA:** „Genug gewühlt – den Rest lassen wir liegen. Zurück zu den Pads.“

### 4. tz_forderung – Wrack „Zaunkönig“

- **Szenentyp:** begegnung · **Baustein:** `verhandeln/funkduell` · **Fassung:** archiv · **Plan:** 2 min
- **Sachverhalt:** Grauzahns Jäger kommen hinter dem Wrack hervor. Halbe-halbe war gestern: Er will die ganze Beute – oder er holt sie sich.
- **Weiter:** Ablehnen oder Schweigen → `tz_abwehr`; Alles abgeben → Ausgang `abgegeben`

**Entscheidung:** Gibt die Lerche Grauzahn die ganze Beute?

- Alles abgeben → Kein Gefecht; die Lerche verliert die Beute (Marken), Grauzahn wird umgänglicher.
- Behalten (oder schweigen) → Die Rostmeute greift an, bis sie abdreht; die Lerche behält die Beute, Grauzahn ist gereizt.

**Ziele**

- Captain: antworten (Funk)

**Texte in Reihenfolge**

- **Funk – Grauzahn (Rostmeute):** „Gute Arbeit. Wirklich. Und jetzt die Planänderung: Halbe-halbe war gestern. Ihr gebt mir alles, und wir bleiben Freunde.“
- **Entscheidung** `tz_forderung_wahl`: „Grauzahn die ganze Beute geben?“
  - Option `a`: „Nimm sie. Wir wollen keinen Ärger.“
    - Zahlung: 80 Marken
    - **Funk – Grauzahn (Rostmeute):** „Seht ihr? Geht doch. Ich melde mich wieder, wenn ich ungeschickte Leute brauche.“
  - Option `b`: „Abgemacht war halbe-halbe. Mehr gibt es nicht.“
    - **Funk – Grauzahn (Rostmeute):** „Falsche Antwort. Jäger – holt mir meine Kisten!“
  - Option `schweigen`: „Funkstille“
    - **Funk – Grauzahn (Rostmeute):** „Funkstille? Dann holen wir es uns eben.“
- **ODA:** „Funkspruch! Captain: Antwort im Reiter „Funk“ – sprecht euch ab.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Schweigen ist auch eine Antwort – aber keine freundliche.“

### 5. tz_abwehr – Wrack „Zaunkönig“

- **Szenentyp:** raumgefecht · **Baustein:** `vertreiben/bis_zur_flucht` · **Fassung:** archiv · **Plan:** 3 min
- **Sachverhalt:** Die Rostmeute greift an, will aber keine Verluste: Wer genug abbekommt, dreht ab. Ein Kanonenboot gibt Rückendeckung.
- **Weiter:** Angreifer vertrieben → Ausgang `vertrieben`

**Ziele**

- Angreifer vertreiben ({left:tz_abwehr_w1} übrig)

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Angreifer! Die wollen Beute, keinen Heldentod – genug Treffer, und sie drehen ab.“
- *(nach 3 s)* **Funk – Grauzahn (Rostmeute):** „Letzte Chance, Lerche. Kisten raus, oder wir schneiden sie euch aus dem Rumpf.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Angeschlagene Gegner fliehen. Taktik: Feuer bündeln, einen nach dem anderen. Pilot: Breitseite.“
- *(sobald erfüllt)* **Funk – Grauzahn (Rostmeute):** „Genug! Rückzug. Das war nicht das letzte Wort am Zaunkönig.“
- *(Autolösung)* **ODA:** „Die Angreifer geben auf und drehen ab. Gut so.“

## Ausgänge

### abgegeben

*Die Lerche hat Grauzahn die ganze Beute überlassen.*

- Belohnung: 190 Marken
- Haltung Grauzahn (Rostmeute): +1
- Gedächtnis Grauzahn (Rostmeute) (`treibgut_zaunkoenig_abgegeben`): „Die Lerche hat am Zaunkönig gearbeitet und mir die ganze Beute gelassen. Brauchbare Leute.“
- Gedächtnis Hafenmeisterin Tesk (`treibgut_zaunkoenig_abgegeben`): „Die Lerche hat für Grauzahn am Zaunkönig geborgen – und ihm alles überlassen.“
- Chronik: „Treibgut Zaunkönig: Die Lerche barg Treibgut und Container am Wrack und überließ Grauzahn die Beute.“

### vertrieben

*Die Lerche hat die Beute behalten und die Rostmeute vertrieben.*

- Belohnung: 190 Marken
- Haltung Grauzahn (Rostmeute): -1
- Gedächtnis Grauzahn (Rostmeute) (`treibgut_zaunkoenig_vertrieben`): „Die Lerche hat am Zaunkönig meine Beute behalten und meine Jäger verjagt. Abgemacht war halbe-halbe – das merke ich mir.“
- Gedächtnis Hafenmeisterin Tesk (`treibgut_zaunkoenig_vertrieben`): „Die Lerche hat Grauzahn am Zaunkönig die Beute abgenommen. Mutig. Oder dumm.“
- Chronik: „Treibgut Zaunkönig: Die Lerche barg Treibgut und Container am Wrack, behielt alles und schlug die Rostmeute in die Flucht.“
- Fakt `rostmeute_zaunkoenig` (offener Faden): „Grauzahn fühlt sich am Zaunkönig betrogen und sinnt auf Ausgleich.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 'tz_wrack_alles' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'tz_wrack_genug' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'tz_abwehr_vertrieben' wird gesetzt, aber in diesem Buch nie gelesen

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
