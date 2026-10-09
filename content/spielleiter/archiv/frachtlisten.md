---
status: angenommen
quelle: archiv
erstellt: 2026-10-08
auftraggeber: tesk
titel: "Frachtlisten"
kennung: frachtlisten
---

# Frachtlisten

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen frachtlisten`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Hafenmeisterin Tesk (`tesk`) |
| Quelle | archiv, Modell hand |
| Zieldauer | 15 min |
| Belohnung | 190 Marken |
| Ziel | Hafen Lichtkordon |
| Szenen | 6 |

## Pitch

Lerche, hier Tesk. Der Kontor-Clan meldet weniger Fracht, als er durch den Saumraum schleust. Ich brauche die echten Listen – leise, ohne Streit mit dem Clan.

## Erinnerung

„Tesk zählt die Frachter, die durch den Saumraum kommen. Seit Wochen geht die Rechnung des Kontors nicht auf.“ – Bezug: neutral (noch keine gemeinsame Geschichte)

Varianten (je nach Weltstand):
- Fakt `kontor_bestohlen`: „Die Lerche war schon einmal ungebeten im Kontor. Tesk hofft, dass sich dort niemand an Gesichter erinnert.“

Ohne passende Erinnerung: „Tesk zählt die Frachter, die durch den Saumraum kommen. Seit Wochen geht die Rechnung des Kontors nicht auf.“

## Szenen

### 1. fl_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Tesk bittet die Lerche, im germanischen Kontor neben dem Hafen die echten Frachtlisten herunterzuladen, ohne dass der Clan es merkt.
- **Weiter:** Auftrag angenommen → `fl_kontor`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Hafenmeisterin Tesk:** „Lerche, hier Tesk. Der Kontor-Clan meldet weniger Fracht, als er durch den Saumraum schleust. Ich brauche die echten Listen – leise, ohne Streit mit dem Clan.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. fl_kontor – Hafen Lichtkordon

- **Szenentyp:** erkundung · **Baustein:** `daten_stehlen/download` · **Fassung:** archiv · **Plan:** 5 min
- **Sachverhalt:** Im Kontor stehen mehrere Runentafeln, nur eine führt die echten Listen. Die Kontorwache dreht ruhig ihre Runden; wer Lärm macht, weckt sie.
- **Weiter:** Download fertig, unentdeckt → `fl_raus`; Die Wache hat Alarm geschlagen → `fl_flucht`

**Ziele**

- Außenteam runterbeamen
- die Frachtlisten herunterladen (E halten am richtigen Terminal)

**Texte in Reihenfolge**

- *(nach 2 s)* **ODA:** „Unten stehen mehrere {{lex.terminal}}en. Captain: Euer Scan zeigt, welche die Frachtlisten hat.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Captain: Reiter „Außenteam“ – das Terminal mit dem Kern ansagen. Unten: E halten, Deckung geben, nicht getroffen werden.“
- *(sobald erfüllt)* **ODA:** „Download fertig – die Frachtlisten sind bei uns.“

### 3. fl_raus – Hafen Lichtkordon

- **Szenentyp:** rueckzug · **Baustein:** `entkommen/zu_den_pads` · **Fassung:** archiv · **Plan:** 3 min
- **Sachverhalt:** Die Listen sind gespeichert. Jetzt ruhig zurück zum Landeplatz, bevor der Schichtwechsel kommt.
- **Weiter:** Alle an Bord → `fl_abgabe_leise`

**Ziele**

- Ablegen – erst draußen geht es weiter
- Mit den Frachtlisten zurück an Bord (Abholpunkt, hochbeamen)

**Texte in Reihenfolge**

- *(nach 20 s, Hinweis, falls nötig)* **ODA:** „Wir liegen noch an der Schleuse. Steuer: ablegen – der Auftrag wartet draußen.“
- **Wendung** `fl_raus_nachhut` – Ankündigung (gleichzeitig): ODA „Gegner im Weg! Durchschlagen, dann zum {{lex.abholpunkt}} und hochbeamen.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Captain: Der nächste Abholpunkt ist auf der Außenteam-Karte markiert. Draufstellen, E halten – wir holen euch.“
- *(sobald erfüllt)* **ODA:** „Alle an Bord – mit den Frachtlisten!“

### 4. fl_flucht – Hafen Lichtkordon

- **Szenentyp:** rueckzug · **Baustein:** `entkommen/zu_den_pads` · **Fassung:** rohfassung · **Plan:** 3 min
- **Sachverhalt:** Der Clan weiß, dass Diebe im Kontor sind. Die Wache will sie lebend – Diebe zahlen Wergeld.
- **Wendung (Plan):** Wergeld-Fänger an der Schleuse: Zwei Fänger sperren den Weg zum Landeplatz.
- **Weiter:** Alle an Bord → `fl_abgabe_laut`

**Ziele**

- Ablegen – erst draußen geht es weiter
- Mit {{lex.fund}} zurück an Bord (Abholpunkt, hochbeamen)

**Texte in Reihenfolge**

- *(nach 20 s, Hinweis, falls nötig)* **ODA:** „Wir liegen noch an der Schleuse. Steuer: ablegen – der Auftrag wartet draußen.“
- **Wendung** `fl_flucht_nachhut` – Ankündigung (gleichzeitig): ODA „Gegner im Weg! Durchschlagen, dann zum {{lex.abholpunkt}} und hochbeamen.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Captain: Der nächste Abholpunkt ist auf der Außenteam-Karte markiert. Draufstellen, E halten – wir holen euch.“
- *(sobald erfüllt)* **ODA:** „Alle an Bord – mit {{lex.fund}}!“

### 5. fl_abgabe_leise – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Tesk vergleicht die Listen mit den eigenen Zählungen. Der Clan ahnt nichts.
- **Weiter:** Abgegeben → Ausgang `leise`

**Texte in Reihenfolge**

- *(nach 1 s)* **ODA:** „Tesk vergleicht die Listen mit den eigenen Zählungen. Der Clan ahnt nichts.“

### 6. fl_abgabe_laut – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Tesk hat die Listen, aber im Kontor wird gerechnet, wer die Diebe waren. Die Hafenmeisterei schweigt offiziell.
- **Weiter:** Abgegeben → Ausgang `entdeckt`

**Texte in Reihenfolge**

- *(nach 1 s)* **ODA:** „Tesk hat die Listen, aber im Kontor wird gerechnet, wer die Diebe waren. Die Hafenmeisterei schweigt offiziell.“

## Ausgänge

### leise

*Die Lerche hat die echten Frachtlisten unbemerkt aus dem Kontor geholt.*

- Belohnung: 190 Marken
- Haltung Hafenmeisterin Tesk: +1
- Gedächtnis Hafenmeisterin Tesk (`frachtlisten_leise`): „Die Lerche hat mir die echten Frachtlisten des Kontors gebracht, ohne dass der Clan etwas gemerkt hat.“
- Chronik: „Frachtlisten: Die Lerche lud im germanischen Kontor die echten Frachtlisten herunter und verschwand ungesehen.“
- Fakt `kontor_bestohlen`: „unbemerkt“

### entdeckt

*Die Lerche hat die Listen, aber die Kontorwache hat sie gesehen.*

- Belohnung: 190 Marken
- Gedächtnis Hafenmeisterin Tesk (`frachtlisten_entdeckt`): „Die Lerche hat die Frachtlisten geholt, aber der Kontor-Clan hat sie gesehen. Das wird Ärger geben.“
- Chronik: „Frachtlisten: Die Lerche holte die Frachtlisten aus dem Kontor und entkam den Wergeld-Fängern nur knapp.“
- Fakt `kontor_bestohlen` (offener Faden): „Der Kontor-Clan weiß, dass die Lerche seine Frachtlisten gestohlen hat.“

## Prüfer

- Warnung: Szene am Andock-Ort 'hafen': Schritt 'fl_raus' bekommt den Wartepunkt 'fl_raus_ablegen' (Ablegen) und wiederaufnahme
- Warnung: Szene am Andock-Ort 'hafen': Schritt 'fl_flucht' bekommt den Wartepunkt 'fl_flucht_ablegen' (Ablegen) und wiederaufnahme
- Warnung: FLAG-UNGELESEN flags: Flag 'fl_kontor_leise' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'fl_kontor_daten' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'fl_raus_entkommen' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'fl_flucht_entkommen' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: TEXT-UNBENUTZT texte.fl_kontor.ziel_hoch: wird nirgends verwendet
- Warnung: TEXT-UNBENUTZT texte.fl_raus.ziel_runter: wird nirgends verwendet
- Warnung: TEXT-UNBENUTZT texte.fl_raus.ziel_hoch: wird nirgends verwendet
- Warnung: TEXT-UNBENUTZT texte.fl_flucht.ziel_runter: wird nirgends verwendet
- Warnung: TEXT-UNBENUTZT texte.fl_flucht.ziel_hoch: wird nirgends verwendet

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
