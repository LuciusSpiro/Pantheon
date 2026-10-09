---
status: angenommen
quelle: archiv
erstellt: 2026-10-08
auftraggeber: melk
titel: "Castellum Kesh"
kennung: castellum_kesh
---

# Castellum Kesh

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen castellum_kesh`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Archivarin Melk (`melk`) |
| Quelle | archiv, Modell hand |
| Zieldauer | 28 min |
| Belohnung | 320 Marken |
| Ziel | Mond Kesh |
| Szenen | 6 |

## Pitch

Lerche, hier Archivarin Melk. Unter dem Mond Kesh liegt ein römisches Grenzkastell, und Grabräuber der Rostmeute graben nach der Legionskasse. Darin liegen Archivtafeln aus der Zeit, als Rom den Saumraum hielt. Holt sie, bevor sie verschwinden.

## Erinnerung

„Melk sammelt alles, was ältere Mächte im Saumraum zurückgelassen haben – und Rom hielt ihn einst.“ – Bezug: neutral (noch keine gemeinsame Geschichte)

Varianten (je nach Weltstand):
- Archivarin Melk / `tafel_im_archiv`: „Melk hat der Lerche schon einmal etwas fürs Archiv zu verdanken. Diesmal geht es um Rom.“

Ohne passende Erinnerung: „Melk sammelt alles, was ältere Mächte im Saumraum zurückgelassen haben – und Rom hielt ihn einst.“

## Szenen

### 1. ck_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Melk zeigt der Lerche eine alte Lagekarte: ein Kastell der Legion am Rand des Saumraums, halb unter Geröll. Die Rostmeute gräbt dort.
- **Weiter:** Auftrag angenommen → `ck_anflug`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Archivarin Melk:** „Lerche, hier Archivarin Melk. Unter dem Mond Kesh liegt ein römisches Grenzkastell, und Grabräuber der Rostmeute graben nach der Legionskasse. Darin liegen Archivtafeln aus der Zeit, als Rom den Saumraum hielt. Holt sie, bevor sie verschwinden.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. ck_anflug – Mond Kesh

- **Szenentyp:** raumgefecht · **Baustein:** `vertreiben/bis_zur_flucht` · **Fassung:** archiv · **Plan:** 5 min
- **Sachverhalt:** Über dem Kastell kreist ein Wachboot der Rostmeute. Es soll die Grabung schützen, will aber keine Verluste.
- **Weiter:** Wachboot vertrieben → `ck_hof`

**Ziele**

- Nach Mond Kesh springen
- Angreifer vertreiben ({left:ck_anflug_w1} übrig)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Mond Kesh. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 0.5 s)* **ODA:** „Angreifer! Die wollen Beute, keinen Heldentod – genug Treffer, und sie drehen ab.“
- *(nach 3 s)* **Funk – Grauzahn (Rostmeute):** „Lerche? Das Kastell gehört der Rostmeute. Dreht ab, dann bleibt euer Rumpf heil.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Angeschlagene Gegner fliehen. Taktik: Feuer bündeln, einen nach dem anderen. Pilot: Breitseite.“
- *(sobald erfüllt)* **Funk – Grauzahn (Rostmeute):** „Zu heiß hier. Abdrehen – die Gräber sollen selbst sehen.“
- *(Autolösung)* **ODA:** „Die Angreifer geben auf und drehen ab. Gut so.“

### 3. ck_hof – Mond Kesh

- **Szenentyp:** gefecht · **Baustein:** `stellung_nehmen/trupp_raeumen` · **Fassung:** archiv · **Plan:** 5 min
- **Sachverhalt:** Im Kastellhof graben Grabräuber der Rostmeute zwischen gestürzten Säulen. Sie wissen seit dem Wachboot, dass Besuch kommt.
- **Weiter:** Hof geräumt oder durchgebrochen → `ck_kasse`

**Ziele**

- Außenteam runterbeamen
- Gegner ausschalten oder in den Zielbereich durchbrechen

**Texte in Reihenfolge**

- *(nach 2 s)* **ODA:** „Außenteam unten. Captain: Reiter „Außenteam“ – Befehle setzen, Sensor und Kuppel.“
- *(nach 4 s)* **ODA:** „Grabräuber zwischen den Säulen. Deckung suchen, zusammen vorrücken – ins Innere des Kastells durchbrechen.“
- *(nach 40 s, Hinweis, falls nötig)* **ODA:** „Captain: Ihr seid die Augen von oben. Flanke ansagen, dann gemeinsam durchbrechen.“
- *(sobald erfüllt)* **ODA:** „Durchgebrochen! Der Weg ist frei.“

### 4. ck_kasse – Mond Kesh

- **Szenentyp:** raetselort · **Baustein:** `raetsel_loesen/zwei_schluessel`, `artefakt_freilegen/fund_aus_gewoelbe` · **Fassung:** archiv · **Plan:** 6 min
- **Sachverhalt:** Die Kassentür der Legion hat ein Zwei-Offiziers-Schloss: Zwei Schlösser weit auseinander, gleichzeitig gedreht. Dahinter die Legionskasse.
- **Weiter:** Legionskasse geborgen → `ck_rueckzug`

**Ziele**

- Außenteam runterbeamen
- Beide Schlösser gleichzeitig halten (E)
- Außenteam runterbeamen
- Die Legionskasse bergen (E halten)

**Texte in Reihenfolge**

- *(nach 2 s)* **ODA:** „Ruhe. {{lex.schluessel}}: zwei Schlösser, weit auseinander. Beide gleichzeitig E halten, dann öffnet das {{lex.tor}}.“
- *(nach 5 s)* **Funk – Archivarin Melk:** „Die Kasse öffnet nie einer allein. Zwei Offiziere, zwei Schlüssel – so hielt es die Legion.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Captain: Die beiden Schlösser sind auf der Außenteam-Karte markiert. Aufteilen, anzählen, dann beide E!“
- *(sobald erfüllt)* **ODA:** „Beide gleichzeitig – das {{lex.tor}} ist offen!“
- **ODA:** „Das {{lex.tor}} ist noch zu. Erst öffnen, dann an den Sockel.“
- *(nach 2 s)* **ODA:** „Die Legionskasse liegt hinter dem {{lex.tor}}. Hingehen, E halten – dann ist es geborgen.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Captain: Der Sockel mit Die Legionskasse ist auf der Außenteam-Karte markiert. Durchs {{lex.tor}}, dann E halten.“
- *(sobald erfüllt)* **ODA:** „Die Legionskasse ist geborgen!“

### 5. ck_rueckzug – Mond Kesh

- **Szenentyp:** rueckzug · **Baustein:** `entkommen/zu_den_pads` · **Fassung:** rohfassung · **Plan:** 5 min
- **Sachverhalt:** Mit der Kasse in den Armen zurück zum Vorfeld. Der Lärm hat etwas geweckt, das seit Jahrhunderten das Kastell bewacht.
- **Wendung (Plan):** Der Kastell-Automat erwacht: SIGNUM IGNOTUM. HALT.
- **Weiter:** Alle an Bord → `ck_abgabe`

**Ziele**

- Mit {{lex.fund}} zurück an Bord (Abholpunkt, hochbeamen)

**Texte in Reihenfolge**

- **Wendung** `ck_rueckzug_nachhut` – Ankündigung (gleichzeitig): ODA „Gegner im Weg! Durchschlagen, dann zum {{lex.abholpunkt}} und hochbeamen.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Captain: Der nächste Abholpunkt ist auf der Außenteam-Karte markiert. Draufstellen, E halten – wir holen euch.“
- *(sobald erfüllt)* **ODA:** „Alle an Bord – mit {{lex.fund}}!“

### 6. ck_abgabe – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** `verhandeln/funkduell` · **Fassung:** archiv · **Plan:** 3 min
- **Sachverhalt:** Melk will die Archivtafeln. Die Münzen der Legionskasse beansprucht die Hafenmeisterei als Fund im Konkordat – oder die Lerche behält sie.
- **Weiter:** Alles ins Archiv → Ausgang `archiv`; Tafeln an Melk, Münzen behalten → Ausgang `muenzen`

**Entscheidung:** Gibt die Lerche die ganze Legionskasse ins Archiv?

- Alles ins Archiv → Melk bekommt Tafeln und Kasse; das Archiv ist der Lerche verpflichtet, die Marken bleiben aus.
- Tafeln an Melk, Münzen behalten → Melk bekommt die Tafeln, die Lerche behält die Münzen; Melk findet das unwürdig.

**Ziele**

- Nach Hafen Lichtkordon springen
- Captain: antworten (Funk)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Hafen Lichtkordon. Steuer: Ziel wählen, F für den Faltsprung.“
- **Funk – Archivarin Melk:** „Lerche, hier Melk. Die Tafeln gehören ins Archiv, keine Frage. Und die Münzen der Legion – die gehören zur Geschichte dazu. Gebt mir alles.“
- **Entscheidung** `ck_abgabe_wahl`: „Die ganze Legionskasse ins Archiv geben?“
  - Option `a`: „Alles ins Archiv. Rom gehört euch.“
    - **Funk – Archivarin Melk:** „Danke. Das Archiv vergisst so etwas nicht.“
  - Option `b`: „Die Tafeln bekommt ihr. Die Münzen behalten wir.“
    - **Funk – Archivarin Melk:** „Münzen. Natürlich. Dann eben nur die Tafeln.“
  - Option `schweigen`: „Funkstille“
    - **Funk – Archivarin Melk:** „Keine Antwort? Dann nehme ich die Tafeln, und ihr behaltet euer Blech.“
- **ODA:** „Funkspruch! Captain: Antwort im Reiter „Funk“ – sprecht euch ab.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Schweigen ist auch eine Antwort – aber keine freundliche.“

## Ausgänge

### archiv

*Die Legionskasse samt Archivtafeln liegt im Konkordat-Archiv.*

- Belohnung: 320 Marken
- Haltung Archivarin Melk: +1
- Gedächtnis Archivarin Melk (`castellum_kesh_archiv`): „Die Lerche hat mir die Legionskasse aus dem Castellum unter Kesh gebracht – Tafeln und Münzen.“
- Chronik: „Castellum Kesh: Die Lerche räumte das Grenzkastell unter Kesh, öffnete die Kassentür und brachte die Legionskasse ins Archiv.“
- Fakt `legionskasse_kesh`: „archiv“

### muenzen

*Melk hat die Archivtafeln, die Lerche hat die Münzen behalten.*

- Belohnung: 320 Marken
- Gedächtnis Archivarin Melk (`castellum_kesh_muenzen`): „Die Lerche hat mir die Archivtafeln aus dem Castellum gebracht, die Münzen der Legion aber behalten.“
- Chronik: „Castellum Kesh: Die Lerche barg die Legionskasse unter Kesh; die Tafeln gingen ins Archiv, die Münzen blieben an Bord.“
- Fakt `legionskasse_kesh` (offener Faden): „Die Münzen der Legionskasse von Kesh sind an Bord der Lerche.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 'ck_anflug_vertrieben' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'ck_hof_geraeumt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'ck_kasse_1_offen' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'ck_kasse_2_geborgen' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'ck_rueckzug_entkommen' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: TEXT-UNBENUTZT texte.ck_hof.ziel_hoch: wird nirgends verwendet
- Warnung: TEXT-UNBENUTZT texte.ck_kasse_1.ziel_hoch: wird nirgends verwendet
- Warnung: TEXT-UNBENUTZT texte.ck_kasse_2.ziel_hoch: wird nirgends verwendet
- Warnung: TEXT-UNBENUTZT texte.ck_rueckzug.ziel_runter: wird nirgends verwendet
- Warnung: TEXT-UNBENUTZT texte.ck_rueckzug.ziel_hoch: wird nirgends verwendet

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
