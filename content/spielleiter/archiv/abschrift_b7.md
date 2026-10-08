---
status: angenommen
quelle: archiv
erstellt: 2026-10-08
auftraggeber: melk
titel: "Abschrift von B-7"
kennung: abschrift_b7
---

# Abschrift von B-7

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen abschrift_b7`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Archivarin Melk (`melk`) |
| Quelle | archiv, Modell hand |
| Zieldauer | 15 min |
| Belohnung | 190 Marken |
| Ziel | Boje B-7 |
| Szenen | 5 |

## Pitch

Lerche, hier Archivarin Melk. Mein Gehilfe Pell sollte auf B-7 die Aufzeichnungen abschreiben und meldet sich nicht mehr. Holt ihn – und bringt mir mit, was die Plattform gespeichert hat.

## Erinnerung

„Melk vergleicht im Konkordat-Archiv alles, was die Kustoden hinterlassen haben – B-7 fehlt ihr noch.“ – Bezug: Fakt `tafel_von_kesh`

Varianten (je nach Weltstand):
- Archivarin Melk / `tafel_im_archiv`: „Melk hat die Tafel von Kesh aus den Händen der Lerche bekommen. Wem sonst sollte sie B-7 anvertrauen?“
- Archivarin Melk / `datenkern_im_archiv`: „Melk hat den ersten Kern von B-7 schon im Archiv. Jetzt will sie die ganze Aufzeichnung.“
- Fakt `tafel_von_kesh`: „Die Tafel von Kesh liegt im Konkordat-Archiv. Melk will wissen, was B-7 dazu aufgezeichnet hat.“

Ohne passende Erinnerung: „Melk sammelt alles, was die Kustoden hinterlassen. B-7 hat zu lange niemand abgeschrieben.“

## Szenen

### 1. ab_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 1 min
- **Sachverhalt:** Melk bittet die Lerche, ihren verletzten Gehilfen von der Plattform unter B-7 zu holen und den Speicher der Plattform mitzubringen.
- **Weiter:** Auftrag angenommen → `ab_pell`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Archivarin Melk:** „Lerche, hier Archivarin Melk. Mein Gehilfe Pell sollte auf B-7 die Aufzeichnungen abschreiben und meldet sich nicht mehr. Holt ihn – und bringt mir mit, was die Plattform gespeichert hat.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. ab_pell – Boje B-7 (Karte platform)

- **Szenentyp:** bergung_vor_ort · **Baustein:** `personen_bergen/techniker_retten` · **Fassung:** archiv · **Plan:** 4 min
- **Sachverhalt:** Das Konkordat hat die Plattform neu besetzt und wieder in Betrieb genommen. Pell ist bei der Wartung gestürzt und sitzt verletzt fest.
- **Weiter:** Pell an Bord → `ab_sonde`

**Ziele**

- Nach Boje B-7 springen
- Außenteam runterbeamen (Medipack!)
- Archivgehilfe Pell versorgen und an Bord bringen
- Zurück an Bord beamen

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Boje B-7. Steuer: Ziel wählen, F für den Faltsprung.“
- **grund:** „Das Konkordat hat B-7 neu besetzt: Wartung, Drohnen, Sonde – alles wieder in Betrieb.“
- *(nach 2 s)* **ODA:** „Außenteam: Medipack aus dem Lager mitnehmen, dann auf die Pads. Unten wartet Archivgehilfe Pell.“
- *(nach 6 s)* **Funk – Archivgehilfe Pell:** „Hallo? Lerche? Hier Pell, Melks Gehilfe. Ich bin von der Leiter gefallen … das Bein will nicht. Bitte beeilt euch.“
- *(nach 70 s, Hinweis, falls nötig)* **ODA:** „Captain: Archivgehilfe Pell ist auf der Außenteam-Karte markiert. Medipack, E halten, dann gemeinsam zu den Pads.“
- *(sobald erfüllt)* **ODA:** „Archivgehilfe Pell ist an Bord. Bordarzt haben wir keinen, aber Tee.“
- *(sobald erfüllt)* **ODA:** „Archivgehilfe Pell hat sich allein zu den Pads geschleppt. Wir holen alle hoch.“

### 3. ab_sonde – Boje B-7 (Karte platform)

- **Szenentyp:** raetselort · **Baustein:** `raetsel_loesen/sonden_code` · **Fassung:** archiv · **Plan:** 3 min
- **Sachverhalt:** Pell erzählt: Die Sonde der Plattform sperrt den Speicher, solange sie läuft. Den Code dafür sieht nur der Captain.
- **Weiter:** Sonde aus → `ab_kern`

**Ziele**

- Außenteam runterbeamen
- Sonde abschalten (Code vom Captain)

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Außenteam auf die Pads. Die Sonde unten steuert die Drohnen – den Code hat der Captain oben.“
- *(nach 40 s, Hinweis, falls nötig)* **ODA:** „Captain: Reiter „Außenteam“ zeigt die Codetabelle. Unten: Symbole ansagen, oben: Farben durchgeben.“

### 4. ab_kern – Boje B-7 (Karte platform)

- **Szenentyp:** bergung_vor_ort · **Baustein:** `datenkern_bergen/plattform_kern` · **Fassung:** archiv · **Plan:** 3 min
- **Sachverhalt:** Mit abgeschalteter Sonde lässt sich der Speicherkern aus der Halterung lösen und an Bord bringen.
- **Weiter:** Kern an Bord oder Zeit um → `ab_archiv`

**Ziele**

- Außenteam auf die Plattform beamen
- Datenkern aus der Halterung nehmen (E halten)
- Mit dem Kern zurück an Bord

**Texte in Reihenfolge**

- **grund:** „Das Konkordat hat auf B-7 einen frischen Datenkern eingesetzt – die Plattform ist wieder in Betrieb.“
- *(nach 2 s)* **ODA:** „Außenteam auf die Pads. Der Datenkern steckt in seiner Halterung auf der Plattform – E halten.“
- *(nach 70 s, Hinweis, falls nötig)* **ODA:** „Der Kern sitzt in der Halterung mitten auf der Plattform. Nehmen, zurück zu den Pads, hochbeamen.“
- *(sobald erfüllt)* **ODA:** „Datenkern an Bord und sicher verstaut.“
- *(sobald erfüllt)* **ODA:** „Die Zeit drängt – wir lassen den Kern zurück. Alle zurück zu den Pads.“

### 5. ab_archiv – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** `ladung_liefern/im_hafen_abgeben`, `verhandeln/funkduell` · **Fassung:** archiv · **Plan:** 4 min
- **Sachverhalt:** Im Hafen nimmt die Hafenmeisterei den Speicherkern in Verwahrung. Melk will das Original fürs Archiv, Tesk will es zurück auf B-7, damit die Boje vollständig sendet – die Crew entscheidet.
- **Weiter:** Original ins Archiv → Ausgang `archiv`; Abschrift für Melk, Original zurück → Ausgang `abschrift`

**Entscheidung:** Wer bekommt das Original des Speicherkerns von B-7?

- Original ins Archiv zu Melk → Melk ist begeistert und forscht weiter; B-7 sendet nur lückenhaft, Tesk ist verstimmt.
- Abschrift für Melk, Original zurück nach B-7 → Tesk ist zufrieden, die Boje sendet vollständig; Melk bekommt nur die Abschrift und ist enttäuscht.

**Ziele**

- Nach Hafen Lichtkordon springen
- Andocken und den Speicher von B-7 übergeben
- Captain: antworten (Funk)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Hafen Lichtkordon. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s, bedingt)* **ODA:** „Kurs auf den Andockpunkt. Steuer: langsam ran, dann andocken.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Andocken: nah an die Schleuse, Tempo runter, dann die Andocktaste der Steuer.“
- *(sobald erfüllt)* **Funk – Hafenmeisterin Tesk:** „Speicherkern in Verwahrung der Hafenmeisterei. Und Pell ist auf der Krankenstation – gute Arbeit, Lerche.“
- *(sobald erfüllt)* Belohnung: 100 Marken
- *(sobald erfüllt)* **Log:** „Übergabe von den Speicher von B-7 quittiert.“
- **Funk – Archivarin Melk:** „Lerche, hier Melk. Tesk will das Original zurück auf die Boje. Ich sage: Ins Archiv gehört es, nicht in den Wind. Ihr habt es geholt – ihr entscheidet.“
- **Entscheidung** `ab_archiv_2_wahl`: „Wer bekommt das Original?“
  - Option `a`: „Das Original kommt ins Archiv.“
    - Belohnung: 40 Marken
    - **Funk – Archivarin Melk:** „Danke. Ihr wisst gar nicht, was ihr dem Archiv da gebt.“
  - Option `b`: „Melk bekommt eine Abschrift, B-7 das Original.“
    - **Funk – Hafenmeisterin Tesk:** „Vernünftig. Die Boje sendet wieder – die Frachter werden es euch danken.“
  - Option `schweigen`: „Funkstille“
    - **Funk – Hafenmeisterin Tesk:** „Keiner entscheidet? Dann entscheide ich: Das Original geht zurück nach B-7.“
- **ODA:** „Funkspruch! Captain: Antwort im Reiter „Funk“ – sprecht euch ab.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Schweigen ist auch eine Antwort – aber keine freundliche.“

## Ausgänge

### archiv

*Das Original des Speicherkerns liegt im Konkordat-Archiv.*

- Belohnung: 190 Marken
- Haltung Archivarin Melk: +1
- Gedächtnis Archivarin Melk (`abschrift_b7_archiv`): „Die Lerche hat Pell von B-7 geholt und mir das Original des Speichers ins Archiv gebracht.“
- Haltung Hafenmeisterin Tesk: -1
- Gedächtnis Hafenmeisterin Tesk (`abschrift_b7_archiv`): „Die Lerche hat das Original von B-7 ins Archiv gegeben. Die Boje sendet nur noch lückenhaft.“
- Chronik: „Abschrift von B-7: Pell ist gerettet, das Original des Speichers liegt bei Melk im Archiv.“
- Fakt `b7_speicher` (offener Faden): „Im Speicher von B-7 steckt eine Aufzeichnung, die Melk mit der Tafel von Kesh abgleicht.“

### abschrift

*Melk hat eine Abschrift, das Original geht zurück nach B-7.*

- Belohnung: 190 Marken
- Haltung Hafenmeisterin Tesk: +1
- Gedächtnis Hafenmeisterin Tesk (`abschrift_b7_abschrift`): „Die Lerche hat das Original von B-7 zurückgegeben. Die Boje sendet wieder vollständig.“
- Gedächtnis Archivarin Melk (`abschrift_b7_abschrift`): „Die Lerche hat Pell gerettet, mir aber nur eine Abschrift des Speichers gelassen.“
- Chronik: „Abschrift von B-7: Pell ist gerettet, Melk hat eine Abschrift, B-7 sendet wieder vollständig.“
- Fakt `b7_speicher`: „abschrift_im_archiv“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 'ab_pell_gerettet' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'ab_pell_selbst' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'ab_kern_geborgen' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'ab_kern_verpasst' wird gesetzt, aber in diesem Buch nie gelesen

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
