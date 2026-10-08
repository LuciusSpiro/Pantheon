---
status: offen
quelle: llm
erstellt: 2026-10-08T11:31:12.230Z
auftraggeber: sela
titel: "Verlorene Ladung im Splittergürtel"
kennung: 2026-10-08_sl_1_m4_splitterfracht
---

# Verlorene Ladung im Splittergürtel

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen 2026-10-08_sl_1_m4_splitterfracht`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Sela (Vaelen-Händlerin) (`sela`) |
| Quelle | llm, Modell sonnet, 50835 Tokens |
| Welt / Anlass | `w-test` – kampagnenstart |
| Zieldauer | 15 min |
| Belohnung | 150 Marken |
| Ziel | Splittergürtel |
| Szenen | 6 |

## Pitch

Lerche, ich brauche euch. Meine Karawane hat drei Container im Splittergürtel verloren – Medizin für die Außenposten. Holt sie raus, bevor die Rostmeute sie findet. Ihr seid nah genug.

## Erinnerung

„Sela hat gehört, dass diese Crew das Tutorial übersprungen hat – frische Leute, die sich noch beweisen wollen.“ – Bezug: Fakt `tutorial`

Ohne passende Erinnerung: „Sela (Vaelen-Händlerin) hat wieder Arbeit für die Lerche.“

## Szenen

### 1. s1_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 1 min
- **Sachverhalt:** Sela funkt von der Vaelen-Karawane aus: Drei Container mit Medizin sind beim letzten Durchflug durch den Splittergürtel abgerissen. Sie braucht sie zurück, bevor Piraten sie plündern.
- **Weiter:** Auftrag angenommen → `s2_splitter_bergen`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Sela (Vaelen-Händlerin):** „Lerche, ich brauche euch. Meine Karawane hat drei Container im Splittergürtel verloren – Medizin für die Außenposten. Holt sie raus, bevor die Rostmeute sie findet. Ihr seid nah genug.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. s2_splitter_bergen – Splittergürtel

- **Szenentyp:** bergung_im_all · **Baustein:** `ladung_bergen/bergungskisten` · **Fassung:** llm · **Plan:** 4 min
- **Sachverhalt:** Im Splittergürtel treiben die drei markierten Container zwischen Brocken. Die Taktik lotst, der Pilot fliegt – aber die Trümmer machen das Einsammeln gefährlich.
- **Wendung (Plan):** Ankündigung: Kurz bevor der letzte Container gesichert ist, meldet die Ortung zwei Rostmeute-Jäger auf Kurs.
- **Weiter:** Container geborgen, Jäger im Anflug → `s3_begegnung_meute`

**Ziele**

- Nach Splittergürtel springen
- Bergungsgut einsammeln ({salvaged}/3)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Splittergürtel. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 3 s)* **ODA:** „Drei Container treiben zwischen den Brocken – grün markiert. Taktik lotst, Pilot fliegt drüber. Vorsicht: jeder Rempler…“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Kisten sind auf der Taktikkarte grün. Der Pilot sieht nur nach vorn – Taktik, Marker setzen!“
- *(nach 90 s)* **Wendung** `s2_meute_anflug` – Ankündigung (gleichzeitig): ODA „Achtung: Ortung zeigt zwei unbekannte Jäger auf Kurs – Ankunft in etwa 60 Sekunden.“
  - **Funk – Sela (Vaelen-Händlerin):** „Lerche, beeilt euch – da nähern sich Signale, die mir gar nicht gefallen.“
- *(sobald erfüllt)* **ODA:** „Den Rest lassen wir treiben. Vielleicht findet es jemand Bedürftigeres.“

### 3. s3_begegnung_meute – Splittergürtel

- **Szenentyp:** begegnung · **Baustein:** `taeuschen/bluff_funk` · **Fassung:** llm · **Plan:** 2 min
- **Sachverhalt:** Vrann funkt und fordert die Hälfte der Ladung als Durchfahrgebühr. Die Ortung zeigt: Sein Wingman hat einen schwachen Schild. Der Captain muss wählen – bluffen oder kämpfen.
- **Weiter:** Bluff gelingt oder Zahlung → `s4_geleit_vaelen`; Bluff scheitert oder Angriff → `s4_gefecht_meute`

**Entscheidung:** Was antwortet der Captain auf Vranns Forderung?

- Bluffen: ‚Euer Schild hält unsere Verstärkung nicht aus.' → Passt zum Scan – Vrann zieht ab, kein Kampf, aber er merkt sich die Lerche
- Bluffen: ‚Da ist nur Ballast drin.' → Passt nicht zum Scan – Vrann glaubt es nicht, Kampf beginnt
- Einen Container abtreten → Vrann lässt durch, aber ein Container fehlt bei der Ablieferung

**Ziele**

- Captain: antworten (Funk) – Ortung beachten

**Texte in Reihenfolge**

- **Funk – Vrann:** „Lerche, hört her. Ihr seid in unserem Revier. Halbe Ladung als Durchfahrgebühr – oder wir holen sie uns selbst.“
- **ODA:** „Funkspruch! Gleich kommt die Ortung – hört genau hin, bevor der Captain antwortet.“
- *(nach 8 s)* **ODA:** „Ortung: Wingman-Schild bei 18 %. Ein gezielter Treffer würde reichen.“
- *(nach 10 s)* **Entscheidung** `s3_begegnung_meute_wahl`: „Was antwortet der Captain auf Vranns Forderung?“
  - Option `passend`: „Eure Schilde halten unsere Verstärkung keine Minute.“
    - **Funk – Vrann:** „… Verstärkung, ja. Schön. Diesmal lassen wir euch durch, Lerche.“
  - Option `falsch`: „Da ist nur Ballast – lohnt sich nicht für euch.“
    - **Funk – Vrann:** „Ballast? Ich seh drei volle Container auf meinem Schirm. Greift an!“
  - Option `wahrheit`: „Einen Container abtreten“
- *(nach 50 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Was hat die Ortung gesagt?“

### 4. s4_gefecht_meute – Splittergürtel

- **Szenentyp:** raumgefecht · **Baustein:** `vertreiben/bis_zur_flucht` · **Fassung:** llm · **Plan:** 3 min
- **Sachverhalt:** Die Jäger greifen an, wollen die Container, nicht die Lerche zerstören. Wer unter die Schwelle sinkt, dreht ab. Vrann droht beim Abzug laut.
- **Weiter:** Jäger vertrieben → `s5_ablieferung`

**Ziele**

- Angreifer vertreiben ({left:s4_gefecht_meute_w1} übrig)

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Angreifer! Die wollen Beute, keinen Heldentod – genug Treffer, und sie drehen ab.“
- *(nach 3 s)* **Funk – Vrann:** „Ihr habt die falsche Wahl getroffen, Lerche. Diese Container gehören jetzt uns.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Angeschlagene Gegner fliehen. Taktik: Feuer bündeln, einen nach dem anderen. Pilot: Breitseite.“
- *(sobald erfüllt)* **Funk – Vrann:** „Schießt euch nicht in den Schlaf. Wir holen uns die Ware anderswo.“
- *(Autolösung)* **ODA:** „Die Angreifer geben auf und drehen ab. Gut so.“

### 5. s4_geleit_vaelen – Vaelen-Karawane

- **Szenentyp:** geleit · **Baustein:** `schuetzen/notruf_verteidigen` · **Fassung:** llm · **Plan:** 4 min
- **Sachverhalt:** Die Karawane hat gewartet – aber ein zweiter Rostmeute-Trupp hat sie bereits eingekreist. Die Lerche fängt die Ladungen ab und vertreibt die Angreifer.
- **Weiter:** Karawane gehalten → `s5_ablieferung`; Karawane kampfunfähig → Ausgang `teilerfolg`

**Entscheidung:** Die Karawane steht unter Beschuss – wohin zuerst?

- Lerche stellt sich schützend vor die Karawane → Mehr Treffer auf der Lerche, Karawane bleibt länger heil
- Sofort auf die Angreifer feuern → Karawane nimmt früh Schaden, Angreifer schneller erledigt

**Ziele**

- Nach Vaelen-Karawane springen
- Vaelen-Karawane verteidigen – Hülle {escortHp:s4_geleit_vaelen} %

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Vaelen-Karawane. Steuer: Ziel wählen, F für den Faltsprung.“
- **Funk – Sela (Vaelen-Händlerin):** „Lerche, hier Sela – zweiter Rostmeute-Trupp hat uns eingekreist. Antrieb läuft noch, aber nicht mehr lang!“
- *(nach 0.5 s)* **ODA:** „Notruf von Vaelen-Karawane! Der Havarist treibt – wir sind seine Schilde.“
- *(nach 6 s, bedingt)* **Wendung** `s4_geleit_vaelen_angriff` – Ankündigung (gleichzeitig): ODA „Jäger kreisen um Vaelen-Karawane! Pilot: dazwischen. Taktik: wer auf den Havaristen lädt, zuerst.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Lädt ein Jäger auf den Havaristen, stellt euch quer dazwischen – unser Schild fängt die Ladung ab.“
- *(sobald erfüllt)* **ODA:** „Vaelen-Karawane treibt kampfunfähig. Die Jäger drehen ab – die Besatzung lebt noch.“
- *(sobald erfüllt)* **Funk – Sela (Vaelen-Händlerin):** „Sie ziehen ab … Lerche, ihr habt uns gerade das Leben gerettet. Danke.“
- *(Autolösung)* **ODA:** „Die Jäger brechen ab und verschwinden. Durchatmen.“

### 6. s5_ablieferung – Vaelen-Karawane

- **Szenentyp:** ablieferung · **Baustein:** `ladung_liefern/im_hafen_abgeben` · **Fassung:** llm · **Plan:** 1 min
- **Sachverhalt:** Sela quittiert die Container persönlich. Je nachdem, wie viele Container geborgen wurden, fällt ihr Dank knapper oder herzlicher aus.
- **Weiter:** alle drei Container geliefert → Ausgang `vollerfolg`; ein oder zwei Container geliefert → Ausgang `teilerfolg`

**Ziele**

- Nach Vaelen-Karawane springen
- Andocken und die Medizincontainer übergeben

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Vaelen-Karawane. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s, bedingt)* **ODA:** „Kurs auf den Andockpunkt. Steuer: langsam ran, dann andocken.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Andocken: nah an die Schleuse, Tempo runter, dann die Andocktaste der Steuer.“
- *(sobald erfüllt)* **Funk – Sela (Vaelen-Händlerin):** „Quittiert. Jeder Container zählt – die Außenposten danken euch, Lerche.“
- *(sobald erfüllt)* **Log:** „Übergabe von die Medizincontainer quittiert.“

## Ausgänge

### vollerfolg

*Alle drei Container bei Sela abgeliefert, Karawane heil*

- Belohnung: 150 Marken
- Haltung Sela (Vaelen-Händlerin): +1
- Gedächtnis Sela (Vaelen-Händlerin) (`m4_splitterfracht_vollerfolg`): „Die Lerche hat alle drei Container unbeschädigt geborgen und die Karawane verteidigt.“
- Chronik: „Die Crew lieferte Selas Medizin-Fracht vollständig durch den Splittergürtel.“

### teilerfolg

*Nicht alle Container geliefert oder Karawane kampfunfähig getrieben*

- Belohnung: 150 Marken
- Gedächtnis Sela (Vaelen-Händlerin) (`m4_splitterfracht_teilerfolg`): „Die Lerche hat geholfen, aber ein Teil der Ladung ging verloren oder die Karawane hat schwer gelitten.“
- Chronik: „Die Crew brachte Selas Fracht nur teilweise durch – ein Verlust, den Sela schweigend quittiert.“
- Fakt `rostmeute_spur` (offener Faden): „Vrann kennt die Lerche jetzt – Grauzahn könnte davon erfahren.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 's3_begegnung_meute_durchschaut' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_gefecht_meute_vertrieben' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_geleit_vaelen_beschaedigt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_geleit_vaelen_verloren' wird gesetzt, aber in diesem Buch nie gelesen

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
