---
status: offen
quelle: llm
erstellt: 2026-10-08T13:51:14.565Z
auftraggeber: tesk
titel: "Die Antwort des Relais"
kennung: 2026-10-08_sl_1_m4_antwort_vorbereit-2
---

# Die Antwort des Relais

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen 2026-10-08_sl_1_m4_antwort_vorbereit-2`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Hafenmeisterin Tesk (`tesk`) |
| Quelle | llm, Modell sonnet, 23637 Tokens |
| Welt / Anlass | `w-test` – missionsgrenze nach `m3` |
| Zieldauer | 15 min |
| Belohnung | 180 Marken |
| Ziel | Graue Weite |
| Szenen | 6 |

## Pitch

Das Kustoden-Relais hat geantwortet: Antwort wird vorbereitet. Ich brauche die Lerche dort – holt ab, was das Relais zu sagen hat, bevor jemand anderes es tut.

## Erinnerung

„Tesk erinnert sich: Die Lerche hat die Tafel von Kesh ins Archiv gebracht – dieser Crew vertraut sie das Relais an.“ – Bezug: Hafenmeisterin Tesk / `m3_erinnerung`

Ohne passende Erinnerung: „Hafenmeisterin Tesk hat wieder Arbeit für die Lerche.“

## Szenen

### 1. s1_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Tesk erteilt den Auftrag im Hafen: Das Relais sendet ein vorbereitetes Signal, und sie will die Lerche dort, bevor fremde Schiffe die Gelegenheit nutzen.
- **Weiter:** Auftrag angenommen → `s2_nebel`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Hafenmeisterin Tesk:** „Das Kustoden-Relais hat geantwortet: Antwort wird vorbereitet. Ich brauche die Lerche dort – holt ab, was das Relais zu sagen hat, bevor jemand anderes es tut.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. s2_nebel – Graue Weite

- **Szenentyp:** gefahrennavigation · **Baustein:** `kurs_durch_gefahr/nebelflug` · **Fassung:** llm · **Plan:** 3 min
- **Sachverhalt:** Sela funkt: Sie sieht unbekannte Schiffe in Richtung Relais. Die Lerche muss durch die Graue Weite, um als Erste dort zu sein.
- **Wendung (Plan):** Ankündigung: Im Nebel tauchen Echos auf – Jäger folgen der Lerche.
- **Weiter:** Feld durchquert ohne Kampf → `s3_relais_scan`; Jäger greifen an → `s3_relais_gefecht`

**Ziele**

- Nach Graue Weite springen
- Das Feld durchqueren (andere Seite erreichen)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Graue Weite. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 0.5 s)* **ODA:** „Die Graue Weite liegt vor uns. Sela meldet unbekannte Schiffe auf Kurs Relais – wir müssen schneller sein.“
- *(nach 10 s)* **ODA:** „Captain: Sternkarte und Taktikkarte zeigen den Ausgang auf der anderen Seite. Kurs ansagen!“
- *(nach 50 s)* **Wendung** `s2_jaeger_folgen` – Ankündigung (gleichzeitig): ODA „ODA: Bewegungsechos im Nebel – zwei Kontakte, Kurs identisch mit uns. Wir werden verfolgt.“
  - **Funk – Sela (Vaelen-Händlerin):** „Lerche, die Echos gewinnen auf – das sind Jäger. Durchbrechen oder kämpfen?“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Ziel ist die andere Seite des Felds. Langsam ist sicherer – jeder Brocken kostet Schild.“
- *(sobald erfüllt)* **Wendung** `s2_nebel_hinterhalt` – Ankündigung (gleichzeitig): ODA „Jäger kommen aus dem Feld! Breitseite, und die Brocken als Deckung nutzen.“
- *(sobald erfüllt)* **ODA:** „Wir sind durch! Freie Sicht voraus.“
- *(Autolösung)* **ODA:** „Der Navigationsrechner hat eine Lücke gefunden – Kurs liegt an, wir sind durch.“

### 3. s3_relais_gefecht – Graue Weite

- **Szenentyp:** raumgefecht · **Baustein:** `vertreiben/bis_zur_flucht` · **Fassung:** llm · **Plan:** 2 min
- **Sachverhalt:** Die Jäger greifen offen an – sie wollen die Lerche vom Relais fernhalten. Sind sie vertrieben, kann die Crew weiter.
- **Weiter:** Jäger vertrieben → `s3_relais_scan`

**Ziele**

- Angreifer vertreiben ({left:s3_relais_gefecht_w1} übrig)

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Angreifer! Die wollen Beute, keinen Heldentod – genug Treffer, und sie drehen ab.“
- *(nach 3 s)* **Funk – Jägerpilot:** „Das Relais gehört uns heute. Verschwindet, oder wir machen Schrott aus euch.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Angeschlagene Gegner fliehen. Taktik: Feuer bündeln, einen nach dem anderen. Pilot: Breitseite.“
- *(sobald erfüllt)* **Funk – Jägerpilot:** „Nicht schlecht, Lerche. Aber wir merken uns das.“
- *(Autolösung)* **ODA:** „Die Angreifer geben auf und drehen ab. Gut so.“

### 4. s3_relais_scan – Kustoden-Relais

- **Szenentyp:** annaeherung_und_erkundung · **Baustein:** `vermessen/stoerrelais_scan` · **Fassung:** llm · **Plan:** 3 min
- **Sachverhalt:** Am Relais hängen Störrelais – jemand hat sie neu angebracht. Die Crew schießt sie ab und führt den Captain-Scan durch, um die Relaisbotschaft zu empfangen.
- **Wendung (Plan):** Ankündigung: Sobald das letzte Relais fällt, meldet sich eine fremde Stimme per Funk.
- **Weiter:** Scan abgeschlossen → `s4_funkduell`

**Ziele**

- Nach Kustoden-Relais springen
- Zu das Kustoden-Relais fliegen
- Taktik: Störrelais abschießen ({killed:s3_relais_scan_relay}/3)
- Captain: das Kustoden-Relais scannen (Leertaste halten)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Kustoden-Relais. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 0.5 s)* **ODA:** „Ruhe am Himmel. Jetzt zu das Kustoden-Relais – die Markierung mitten in der Szene.“
- *(nach 6 s)* **ODA:** „Störrelais kreisen um das Kustoden-Relais und blockieren den Scan. Taktik: abschießen! Steuer: Bug drauf.“
- *(nach 55 s)* **Wendung** `s3_fremde_stimme_meldet_sich` – Ankündigung (gleichzeitig): ODA „ODA: Unbekanntes Schiff auf Abfangkurs – eingehender Funk.“
  - **Funk – Inspektor Varn:** „Hier Inspektor Varn, Konkordat-Aufsicht. Ihr befasst euch mit einem gesperrten Signal. Haltet sofort inne.“
- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Captain: nah ran an das Kustoden-Relais und Leertaste halten. Störrelais vorher abschießen (Taktik).“
- *(sobald erfüllt)* **ODA:** „Relais erledigt, der Weg ist frei! Captain: in Reichweite die Leertaste halten – Scan.“
- **label:** „Scan: das Kustoden-Relais“
- **blocked:** „Störrelais stören den Scan – erst abschießen (Taktik).“

### 5. s4_funkduell – Kustoden-Relais

- **Szenentyp:** begegnung · **Baustein:** `verhandeln/funkduell` · **Fassung:** llm · **Plan:** 2 min
- **Sachverhalt:** Inspektor Varn beansprucht das Relais-Signal als Konkordat-Eigentum und verlangt, dass die Lerche die Daten übergibt oder abzieht.
- **Weiter:** Crew gibt Daten ab → Ausgang `daten_weg`; Crew verweigert → `s5_pylonen`

**Entscheidung:** Gibt die Crew die Relaisdaten an Inspektor Varn ab oder verweigert sie?

- Daten übergeben → Varn zieht ab, Tesk ist enttäuscht, das Relais-Geheimnis bleibt beim Konkordat.
- Verweigern und durchkämpfen → Pylonen werden aktiv – die Crew muss den Wächter überstehen, bringt Tesk aber das vollständige Signal.

**Ziele**

- Captain: antworten (Funk)

**Texte in Reihenfolge**

- **Funk – Inspektor Varn:** „Hier spricht Inspektor Varn, Konkordat-Inspektionsschiff Lanze. Das Signal dieses Relais ist Konkordat-Eigentum. Übergabe oder Abzug – wählt jetzt.“
- **Entscheidung** `s4_funkduell_wahl`: „Gebt ihr die Relaisdaten an Inspektor Varn ab?“
  - Option `a`: „Daten werden übertragen.“
    - **Funk – Inspektor Varn:** „Kluge Entscheidung. Lanze zieht ab – belastet uns nicht weiter.“
    - **Funk – Hafenmeisterin Tesk:** „Das Signal ist weg. Schade, Lerche.“
    - **Log:** „Relaisdaten an Inspektor Varn übergeben. Tesk nicht zufrieden.“
  - Option `b`: „Wir übergeben nichts. Zieht ab.“
    - **Funk – Inspektor Varn:** „Dann aktiviere ich die Pylonen. Ihr habt eure Wahl getroffen.“
    - **ODA:** „Kustoden-Pylonen werden aktiv. Vorsicht.“
  - Option `schweigen`: „Funkstille“
    - **Funk – Inspektor Varn:** „Schweigen gilt als Weigerung. Pylonen-Aktivierung eingeleitet.“
    - **ODA:** „Kustoden-Pylonen werden aktiv. Vorsicht.“
- **ODA:** „Funkspruch! Captain: Antwort im Reiter „Funk“ – sprecht euch ab.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Schweigen ist auch eine Antwort – aber keine freundliche.“

### 6. s5_pylonen – Kustoden-Relais

- **Szenentyp:** raumgefecht · **Baustein:** `vernichten/pylonen_pruefung` · **Fassung:** llm · **Plan:** 3 min
- **Sachverhalt:** Kustoden-Pylonen werden aktiv. Die Crew muss sie ausschalten, um das Signal vollständig zu empfangen. Nach dem ersten Abschuss erwacht ein Wächter mit EMP.
- **Wendung (Plan):** Ankündigung: Nach dem ersten Pylonenabschuss erwacht ein Wächter mit EMP.
- **Weiter:** Pylonen zerstört, Signal empfangen → Ausgang `erfolg`; Schiff zu schwer beschädigt → Ausgang `rueckzug`

**Ziele**

- Pylonen ausschalten ({killed:s5_pylonen_pylon}/3) – von der Seite!

**Texte in Reihenfolge**

- *(nach 1 s)* **ODA:** „Pylonen mit Frontschild. Taktik: scannen und den Piloten an die Seite lotsen – Marker helfen!“
- *(nach 25 s)* **Wendung** `s5_waechter_emp` – Ankündigung (gleichzeitig): ODA „Energiesignatur wächst hinter Pylone zwei – ein Wächter wird aktiv, EMP-Entladung in Kürze.“
  - **Funk – Inspektor Varn:** „Ihr habt das Relais geweckt. Der Wächter gehört dazu – zieht euch zurück oder ihr brennt.“
- *(nach 30 s, Hinweis, falls nötig)* **ODA:** „Tipp: Pylon anvisieren, S halten – dann seht ihr, wo sein Schild ist. Von der Seite geht es schneller.“
- *(sobald erfüllt)* **Wendung** `s5_pylonen_waechter` – Ankündigung (gleichzeitig): ODA „Ein Kustoden-Wächter erwacht! Seine EMP-Schüsse legen Systeme lahm – Schilde oben halten.“

## Ausgänge

### erfolg

*Pylonen zerstört, Signal vollständig empfangen*

- Belohnung: 180 Marken
- Gedächtnis Hafenmeisterin Tesk (`m4_antwort_vorbereit_erfolg`): „Die Lerche hat sich gegen Varn durchgesetzt und mir das vollständige Relais-Signal gebracht.“
- Gedächtnis Sela (Vaelen-Händlerin) (`m4_antwort_vorbereit_erfolg`): „Die Lerche hat das Relais-Signal trotz Gegenwehr gesichert.“
- Chronik: „Die Antwort des Relais: Die Crew empfängt das vollständige Kustoden-Signal und bringt es Tesk.“
- Fakt `kustoden_relais_antwort` (offener Faden): „Das Signal enthält eine Koordinate – der Ursprungsort der Kustoden ist markiert.“

### daten_weg

*Crew übergibt Daten an Inspektor Varn*

- Belohnung: 180 Marken
- Gedächtnis Hafenmeisterin Tesk (`m4_antwort_vorbereit_daten_weg`): „Die Lerche hat die Relaisdaten an Konkordat-Inspektor Varn abgegeben – das Signal ist weg.“
- Gedächtnis Sela (Vaelen-Händlerin) (`m4_antwort_vorbereit_daten_weg`): „Die Lerche musste beim Relais zurückweichen.“
- Chronik: „Die Antwort des Relais: Das Kustoden-Signal geht an das Konkordat – was Varn damit macht, bleibt offen.“
- Fakt `relais_signal_konkordat`: „Inspektor Varn hat das Relaissignal; das Konkordat besitzt jetzt die Antwort der Kustoden.“

### rueckzug

*Schiff zu schwer beschädigt, Rückzug vor den Pylonen*

- Belohnung: 180 Marken
- Gedächtnis Hafenmeisterin Tesk (`m4_antwort_vorbereit_rueckzug`): „Die Lerche musste vor den Kustoden-Pylonen am Relais abdrehen – das Signal ist noch nicht empfangen.“
- Gedächtnis Sela (Vaelen-Händlerin) (`m4_antwort_vorbereit_rueckzug`): „Die Lerche ist beschädigt vom Relais zurückgekehrt.“
- Chronik: „Die Antwort des Relais: Die Crew übersteht die Pylonen nicht – das Signal wartet noch.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 's3_relais_gefecht_vertrieben' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's2_jaeger_angriff' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_verweigert' wird gesetzt, aber in diesem Buch nie gelesen

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._

- QA-Abnahme S2b (Live-Aufnahme, `test-llm-live --pipeline`): Der Grobplan kam aus einem eigenen Lauf (2 Versuche, 30 504
  Tokens; Versuch 1 zu lang); die 23 637 Tokens oben sind nur die 5 Szenen (6 Aufrufe, 5/5 gültig beim 1./2. Versuch).
  Gesamt also ≈ 54 000 Tokens.
- QA-Einschätzung: Auftraggeberin Tesk funkt nie als Gegnerin; Gegenspieler ist ein neuer NSC (Inspektor Varn), Sela funkt
  in s2 passend als Beobachterin. Schwächen: Die Erinnerung sagt „Tafel ins Archiv gebracht“ – Tesks Gedächtnis sagt „aus dem
  Archiv geholt und mir übergeben“ (leichter Widerspruch); alle drei Ausgänge zahlen dieselben 180 Marken, auch „rueckzug“ und
  „daten_weg“ (Tesk enttäuscht).
