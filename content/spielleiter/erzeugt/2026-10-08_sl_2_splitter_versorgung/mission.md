---
status: angenommen
quelle: llm
erstellt: 2026-10-08T09:44:19.015Z
auftraggeber: grauzahn
titel: "Was im Splitter treibt"
kennung: 2026-10-08_sl_2_splitter_versorgung
---

# Was im Splitter treibt

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen 2026-10-08_sl_2_splitter_versorgung`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Grauzahn (Rostmeute) (`grauzahn`) |
| Quelle | llm, Modell sonnet, 26005 Tokens |
| Welt / Anlass | `w-zus6` – kampagnenstart |
| Zieldauer | 15 min |
| Belohnung | 190 Marken |
| Ziel | Splittergürtel |
| Szenen | 5 |

## Pitch

Hier Grauzahn. Kein Witz – ich hab ein Problem, das euch nützt. Ein Versorgungsfrachter der Meute ist im Splitter stecken, und ich will nicht, dass das Konkordat ihn findet. Holt ihn raus, und wir reden über Schulden.

## Erinnerung

„Grauzahn hat mitgehört, dass im Splitter was geweckt wurde – er will das Gebiet sauber halten, bevor die Kustoden nachschauen.“ – Bezug: Fakt `kustoden_relais`

Ohne passende Erinnerung: „Grauzahn (Rostmeute) hat wieder Arbeit für die Lerche.“

## Szenen

### 1. s1_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Grauzahn funkt verschlüsselt auf einen Nebenkanal: Ein Frachter der Rostmeute treibt im Splittergürtel, Antrieb tot, und Konkordat-Schiffe sind unterwegs. Er will keinen Gefallen – er will ein Geschäft.
- **Weiter:** Crew nimmt an → `s2_splitter_suche`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Grauzahn (Rostmeute):** „Hier Grauzahn. Kein Witz – ich hab ein Problem, das euch nützt. Ein Versorgungsfrachter der Meute ist im Splitter stecken, und ich will nicht, dass das Konkordat ihn findet. Holt ihn raus, und wir reden über Schulden.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. s2_splitter_suche – Splittergürtel

- **Szenentyp:** annaeherung_und_erkundung · **Baustein:** `signal_orten/weitscan_peilung` · **Fassung:** rohfassung · **Plan:** 3 min
- **Sachverhalt:** Im Splittergürtel liegt der Frachter 'Schiefmaul' irgendwo versteckt zwischen Brocken – kein Transponder, nur ein schwaches Notfunksignal. Die Taktik muss ihn triangulieren, der Pilot fliegt die Richtung ab.
- **Wendung (Plan):** Beim letzten Ping antwortet ein zweites, unbekanntes Signal kurz – dann Stille. Ankündigung: noch jemand ist hier.
- **Weiter:** Frachter geortet → `s3_entscheidung_bluff`; Konkordat-Schiff erscheint bevor Fund → `s3_entscheidung_bluff`

**Ziele**

- Nach Splittergürtel springen
- Taktik: Weitscan (W) – die alte Bake suchen
- Taktik: anvisieren (T) und scannen (S halten)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Splittergürtel. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s)* **ODA:** „Irgendwo hier ist die alte Bake. Taktik: Weitscan (W) – Marker für den Piloten!“
- *(sobald erfüllt)* **ODA:** „Taktik: W drückt den Weitscan – Reichweite 1000. Mehrmals und an verschiedenen Stellen probieren.“
- *(sobald erfüllt)* **ODA (Richtung):** „die alte Bake kommt von {dir} von uns. Hinfliegen und nochmal Weitscan (W)!“
- *(Autolösung)* **ODA:** „Ich habe die alte Bake angepeilt und markiert. Anvisieren (T) und scannen (S)!“

### 3. s3_entscheidung_bluff – Splittergürtel

- **Szenentyp:** begegnung · **Baustein:** `taeuschen/bluff_funk` · **Fassung:** rohfassung · **Plan:** 2 min
- **Sachverhalt:** Ein Konkordat-Inspektionsboot funkt die Lerche an: Was macht sie hier, hat sie verdächtige Funde gemacht? Der Frachter liegt noch nicht gesichert – die Crew muss entscheiden, wie viel sie preisgibt.
- **Weiter:** Bluff verfängt – Inspektor zieht ab → `s4_pannenhilfe`; Bluff scheitert oder Wahrheit – Inspektor bleibt → `s4_pannenhilfe`

**Entscheidung:** Was sagt die Crew dem Konkordat-Inspektor?

- Wir suchen Sensoranomalien – Routinemessung → Inspektor glaubt es, zieht ab; Konkordat notiert die Lerche als unauffällig – nützt später
- Wir haben einen Bergungsauftrag für Treibgut → Inspektor will einen Nachweis sehen; er bleibt in der Nähe und taucht in s4 erneut auf – Druck während der Reparatur
- Wir helfen einem Havaristen – privater Auftrag → Inspektor begleitet 'zur Sicherheit'; er sieht den Frachter, meldet Rostmeute ans Konkordat – Grauzahns Haltung −1

**Ziele**

- Captain: antworten (Funk) – Ortung beachten

**Texte in Reihenfolge**

- **Funk – Grauzahn (Rostmeute):** „Ihr seid auf meinem Kurs. Dreht bei, oder wir helfen nach.“
- **ODA:** „Funkspruch! Gleich kommt die Ortung – hört genau hin, bevor der Captain antwortet.“
- *(nach 8 s)* **ODA:** „Ortung: Ihr Antrieb flackert – der Reaktor läuft auf halber Last. Die können kaum folgen.“
- *(nach 10 s)* **Entscheidung** `s3_entscheidung_bluff_wahl`: „Wie antworten wir?“
  - Option `passend`: „Wir springen gleich – folgt uns, wenn ihr könnt.“
    - **Funk – Grauzahn (Rostmeute):** „… Na schön. Diesmal. Verschwindet.“
  - Option `falsch`: „Eine Patrouille ist auf dem Weg hierher.“
    - **Funk – Grauzahn (Rostmeute):** „Netter Versuch. Glaubt ihr, ich kann nicht zählen?“
  - Option `wahrheit`: „Die Wahrheit sagen“
- *(nach 50 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Was hat die Ortung gesagt?“

### 4. s4_pannenhilfe – Splittergürtel

- **Szenentyp:** begegnung · **Baustein:** `pannenhilfe/andocken_und_flicken` · **Fassung:** rohfassung · **Plan:** 4 min
- **Sachverhalt:** Die Crew erreicht den treibenden Frachter 'Schiefmaul'. Die Schrauber flicken den toten Antrieb von außen, während der Pilot die Lerche nah und ruhig hält. Der Funkton des Kapitäns der Meute ist mürrisch, aber er zahlt.
- **Wendung (Plan):** Während der Reparatur meldet die Taktik das unbekannte Signal von vorhin – näher, auf Annäherungskurs. Ankündigung: Jäger, kein Transponder.
- **Weiter:** Antrieb geflickt vor Jäger-Ankunft → `s5_abwehr`; Antrieb noch nicht fertig, Jäger da → `s5_abwehr`

**Entscheidung:** Der Kapitän des Schiefmaul bietet als Bonus Frachtraum-Informationen an – über eine Route, die Grauzahn geheim hält. Nehmt ihr sie?

- Ja, wir nehmen die Infos → Welt-Fakt über Rostmeute-Route gesetzt – nützlicher Faden, aber Grauzahn erfährt es irgendwann
- Nein, das geht uns nichts an → Grauzahn hört es von seinem Kapitän – Haltung +1, er respektiert die Crew

**Ziele**

- Bergungsboot flicken: längsseits gehen und stillhalten

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Bergungsboot treibt. Steuer: nah ran und fast stehen bleiben – dann flicken die Schrauber.“
- *(nach 2 s)* **Funk – Sela (Vaelen-Händlerin):** „Lerche? Unser Antrieb ist tot, wir treiben. Kommt längsseits – wir brauchen eure Schrauber.“
- *(nach 50 s, Hinweis, falls nötig)* **ODA:** „Reparatur läuft nur nah, langsam und ohne Beschuss. Steuer: Tempo auf null, Bug zum Havaristen.“
- *(sobald erfüllt)* **Wendung** `s4_pannenhilfe_stoerer` – Ankündigung (vorher, 5 s Vorlauf): ODA „Ortung: Angreifer halten auf den Havaristen zu! Reparatur pausiert unter Beschuss – dazwischen.“
- *(sobald erfüllt)* **Wendung** `s4_pannenhilfe_stoerer2` – Ankündigung (vorher, 5 s Vorlauf): ODA „Ortung: Angreifer halten auf den Havaristen zu! Reparatur pausiert unter Beschuss – dazwischen.“
- *(sobald erfüllt)* **Funk – Sela (Vaelen-Händlerin):** „Er läuft! Hört ihr das? Wir schulden euch was, Lerche.“
- *(sobald erfüllt)* **ODA:** „Bergungsboot ist kampfunfähig. Die Besatzung steigt in die Kapseln – wir melden es dem Hafen.“
- *(sobald erfüllt)* **ODA:** „Fremde Technik, keine Chance. Wir funken einen Schlepper vom Hafen herbei.“

### 5. s5_abwehr – Splittergürtel

- **Szenentyp:** raumgefecht · **Baustein:** `vertreiben/bis_zur_flucht` · **Fassung:** rohfassung · **Plan:** 3 min
- **Sachverhalt:** Zwei Jäger ohne Kennung – Freischärler, die auf Beutezüge im Splitter spezialisiert sind – greifen an. Sie wollen den Frachter, nicht die Lerche; läuft die Lerche dazwischen, nehmen sie sie trotzdem ins Visier. Wenn ihre Hülle fällt, drehen sie ab.
- **Weiter:** Jäger vertrieben, Frachter heil → Ausgang `erfolg`; Jäger vertrieben, Frachter schwer beschädigt → Ausgang `teilerfolg`; Frachter kampfunfähig treibt → Ausgang `frachter_verloren`

**Ziele**

- Angreifer vertreiben ({left:s5_abwehr_w1} übrig)

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Angreifer! Die wollen Beute, keinen Heldentod – genug Treffer, und sie drehen ab.“
- *(nach 3 s)* **Funk – Grauzahn (Rostmeute):** „Letzte Warnung, Lerche. Dreht ab, sonst wird es teuer.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Angeschlagene Gegner fliehen. Taktik: Feuer bündeln, einen nach dem anderen. Pilot: Breitseite.“
- *(sobald erfüllt)* **Funk – Grauzahn (Rostmeute):** „Das ist es nicht wert. Rückzug! Wir sehen uns wieder.“
- *(Autolösung)* **ODA:** „Die Angreifer geben auf und drehen ab. Gut so.“

## Ausgänge

### erfolg

*Jäger vertrieben, Frachter heil entkommen*

- Belohnung: 190 Marken
- Haltung Grauzahn (Rostmeute): +1
- Gedächtnis Grauzahn (Rostmeute) (`splitter_versorgung_erfolg`): „Die Lerche hat den Schiefmaul im Splitter gerettet – ohne Fragen.“
- Chronik: „Die Crew hat den Frachter der Rostmeute aus dem Splitter befreit. Grauzahn ist im Soll.“

### teilerfolg

*Jäger vertrieben, Frachter beschädigt aber flugfähig*

- Belohnung: 190 Marken
- Gedächtnis Grauzahn (Rostmeute) (`splitter_versorgung_teilerfolg`): „Die Lerche hat sich redlich geschlagen – der Schiefmaul lebt, wenn auch mit Narben.“
- Chronik: „Die Crew hat den Frachter gerettet, aber nicht unversehrt. Grauzahn zahlt halb.“

### frachter_verloren

*Frachter kampfunfähig treibt oder verlorengeht*

- Belohnung: 95 Marken
- Haltung Grauzahn (Rostmeute): -1
- Gedächtnis Grauzahn (Rostmeute) (`splitter_versorgung_frachter_verloren`): „Der Schiefmaul ist weg. Die Lerche hat es versucht – aber versucht ist nicht geliefert.“
- Chronik: „Der Frachter der Rostmeute ging im Splitter verloren. Grauzahn schuldet der Crew nichts.“
- Fakt `splitter_freischarer` (offener Faden): „Jäger ohne Kennung operieren im Splittergürtel – wer steckt dahinter?“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 's3_entscheidung_bluff_geglueckt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's3_entscheidung_bluff_durchschaut' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_pannenhilfe_beschaedigt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_pannenhilfe_verloren' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: Grobplan: Ausgang 'erfolg': Folge „schiff_marken +80“ nicht lesbar (wird ignoriert)
- Warnung: Grobplan: Ausgang 'teilerfolg': Folge „schiff_marken +40“ nicht lesbar (wird ignoriert)

## Gespielt

| Datum | Ausgang | Dauer | Crew |
|---|---|---|---|
| 2026-10-08 09:48 | erfolg | 3:05 | 3 |

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
