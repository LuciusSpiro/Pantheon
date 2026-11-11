---
status: angenommen
quelle: archiv
erstellt: 2026-11-11
auftraggeber: tesk
titel: "Zwischenfall am Stollen"
kennung: zwischenfall_am_stollen
---

# Zwischenfall am Stollen

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen zwischenfall_am_stollen`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Hafenmeisterin Tesk (`tesk`) |
| Quelle | archiv, Modell hand |
| Zieldauer | 15 min |
| Belohnung | 190 Marken |
| Ziel | Splittergürtel |
| Szenen | 5 |

## Pitch

Lerche, hier Tesk. Auf dem Splitter haben Rostmeute-Leute einen Schürfstollen besetzt und halten jeden Frachter an, der vorbeikommt. Kontrollposten nennen sie das. Räumt ihn aus, und holt die Fracht, die sie bereits einkassiert haben.

## Erinnerung

„Tesk führt ein Buch über jede Route im Saumraum. Seit Tagen stimmen die Zahlen für den Splitter nicht mehr.“ – Bezug: neutral (noch keine gemeinsame Geschichte)

Varianten (je nach Weltstand):
- Hafenmeisterin Tesk / `m3_erinnerung`: „Tesk erinnert sich, dass die Lerche ihr eine Vertragstafel aus Plünderhänden geholt hat. Nun soll sie den Plünderern den nächsten Zugriff nehmen.“
- Grauzahn (Rostmeute) / `geblufft`: „Grauzahn hat die Lerche im Nebel auf dem Kieker. Tesk glaubt, dass seine Leute deshalb im Stollen besonders dreist auftreten.“

Ohne passende Erinnerung: „Tesk führt ein Buch über jede Route im Saumraum. Seit Tagen stimmen die Zahlen für den Splitter nicht mehr.“

## Szenen

### 1. zs_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Tesk zeigt der Lerche eine Liste ausgebliebener Frachter vom Splitter. Alle wurden zuletzt an einem Schürfstollen gesehen, wo die Rostmeute einen Posten hält.
- **Weiter:** Auftrag angenommen → `zs_posten`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Hafenmeisterin Tesk:** „Lerche, hier Tesk. Auf dem Splitter haben Rostmeute-Leute einen Schürfstollen besetzt und halten jeden Frachter an, der vorbeikommt. Kontrollposten nennen sie das. Räumt ihn aus, und holt die Fracht, die sie bereits einkassiert haben.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. zs_posten – Splittergürtel

- **Szenentyp:** gefecht · **Baustein:** `stellung_nehmen/kontrollposten_im_gelaende` · **Fassung:** rohfassung · **Plan:** 5 min
- **Sachverhalt:** Tief im Stollen sitzt der Kontrollposten der Rostmeute: Wachen an den Lagern, dazwischen Streifen. Sie rechnen mit Frachtern, nicht mit einem Außenteam.
- **Weiter:** Posten ausgeschaltet → `zs_beute`

**Ziele**

- Nach Splittergürtel springen
- Außenteam runterbeamen
- Den Kontrollposten ausschalten (alle Gegner)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Splittergürtel. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 2 s)* **ODA:** „Außenteam unten. Captain: Reiter „Außenteam“ – Befehle setzen, Sensor und Kuppel.“
- *(nach 4 s)* **ODA:** „Ein Kontrollposten sperrt den Weg. Aus der Deckung die Streifen abpassen, dann zusammen zuschlagen.“
- *(nach 40 s, Hinweis, falls nötig)* **ODA:** „Captain: Ihr seht die Posten von oben. Streifen abpassen, Deckung nutzen, dann die Wachen ausschalten.“
- *(sobald erfüllt)* **ODA:** „Der Kontrollposten ist ausgeschaltet. Der Weg ist frei.“

### 3. zs_beute – Splittergürtel

- **Szenentyp:** bergung_vor_ort · **Baustein:** `ladung_bergen/ladung_am_boden` · **Fassung:** rohfassung · **Plan:** 4 min
- **Sachverhalt:** Der Posten ist stumm. Im Stollen stapeln sich die beschlagnahmten Kisten der angehaltenen Frachter. Das Außenteam sammelt ein, was sich tragen lässt.
- **Weiter:** Fracht geborgen → `zs_abgabe_voll`; Rest liegen gelassen → `zs_abgabe_teil`

**Ziele**

- Außenteam runterbeamen
- Ladung bergen (E halten, 2 Fundorte): {{lex.ladung:der}}
- Zurück an Bord beamen

**Texte in Reihenfolge**

- *(nach 2 s)* **ODA:** „Fracht im Gelände: 2 Fundorte auf der Außenteam-Karte. Hingehen, E halten – dann ist sie geborgen.“
- *(nach 70 s, Hinweis, falls nötig)* **ODA:** „Captain: Fundorte auf der Karte markiert, dort liegt {{lex.ladung:der}}. Hin, E halten, dann zu den Pads.“
- *(sobald erfüllt)* **ODA:** „Die Ladung ist geborgen! Zurück zu den Pads, dann holen wir euch hoch.“
- *(sobald erfüllt)* **ODA:** „Genug gesucht – den Rest lassen wir liegen. Zurück zu den Pads.“

### 4. zs_abgabe_voll – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Tesk gleicht die Kisten mit ihrer Liste ab. Alles ist da, und die Frachter vom Splitter fliegen wieder.
- **Weiter:** Abgegeben → Ausgang `voll`

**Ziele**

- Nach Hafen Lichtkordon springen

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Hafen Lichtkordon. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s)* **ODA:** „Tesk gleicht die Kisten mit ihrer Liste ab. Alles ist da, und die Frachter vom Splitter fliegen wieder.“

### 5. zs_abgabe_teil – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Tesk bekommt einen Teil der Fracht zurück. Der Posten ist weg, der Rest der Beute liegt noch im Stollen, und die Rostmeute wird zurückkommen.
- **Weiter:** Abgegeben → Ausgang `teil`

**Ziele**

- Nach Hafen Lichtkordon springen

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Hafen Lichtkordon. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s)* **ODA:** „Tesk bekommt einen Teil der Fracht zurück. Der Posten ist weg, der Rest der Beute liegt noch im Stollen, und die Rostme…“

## Ausgänge

### voll

*Der Kontrollposten ist ausgeschaltet und die ganze Fracht geborgen.*

- Belohnung: 190 Marken
- Haltung Hafenmeisterin Tesk: +1
- Haltung Grauzahn (Rostmeute): -1
- Gedächtnis Hafenmeisterin Tesk (`zwischenfall_am_stol_voll`): „Die Lerche hat den Rostmeute-Posten im Splitterstollen geräumt und die einkassierte Fracht zurückgebracht.“
- Gedächtnis Grauzahn (Rostmeute) (`zwischenfall_am_stol_voll`): „Die Lerche hat meinen Posten im Splitterstollen ausgeräumt. Das war mein Zoll.“
- Chronik: „Zwischenfall am Stollen: Die Lerche schaltete den Kontrollposten der Rostmeute im Splitterstollen aus und barg die beschlagnahmte Fracht.“

### teil

*Der Kontrollposten ist ausgeschaltet, aber ein Teil der Fracht blieb im Stollen.*

- Belohnung: 190 Marken
- Haltung Hafenmeisterin Tesk: +1
- Gedächtnis Hafenmeisterin Tesk (`zwischenfall_am_stol_teil`): „Der Posten im Splitterstollen ist weg, die Lerche hat aber nicht alles mitgebracht.“
- Chronik: „Zwischenfall am Stollen: Die Lerche schaltete den Kontrollposten der Rostmeute aus, ein Teil der Fracht blieb im Stollen.“
- Fakt `stollen_fracht_splitter` (offener Faden): „Ein Teil der beschlagnahmten Fracht liegt noch im Stollen auf dem Splitter.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 'zs_posten_geraeumt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'zs_beute_genug' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: TEXT-UNBENUTZT texte.zs_posten.ziel_hoch: wird nirgends verwendet

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
