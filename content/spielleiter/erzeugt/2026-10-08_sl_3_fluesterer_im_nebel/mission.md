---
status: angenommen
quelle: llm
erstellt: 2026-10-08T09:45:12.617Z
auftraggeber: sela
titel: "Der Flüsterer in der Grauen Weite"
kennung: 2026-10-08_sl_3_fluesterer_im_nebel
---

# Der Flüsterer in der Grauen Weite

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen 2026-10-08_sl_3_fluesterer_im_nebel`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Sela (Vaelen-Händlerin) (`sela`) |
| Quelle | llm, Modell sonnet, 26098 Tokens |
| Welt / Anlass | `w-zus6` – kampagnenstart |
| Zieldauer | 15 min |
| Belohnung | 190 Marken |
| Ziel | Graue Weite |
| Szenen | 6 |

## Pitch

Eine Karawane ist spurlos ausgeblieben – mein bestes Schiff, drei Tage überfällig, letztes Signal aus der Grauen Weite. Ihr seid nah genug und klein genug, um unbemerkt hineinzufliegen.

## Erinnerung

„Sela deutet auf den Datenkern an Bord: 'Konkordat-Technik. Ihr wisst, wie man mit heißem Material umgeht. Gut.'“ – Bezug: Fakt `datenkern`

Ohne passende Erinnerung: „Sela (Vaelen-Händlerin) hat wieder Arbeit für die Lerche.“

## Szenen

### 1. s1_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Sela funkt aus der Vaelen-Karawane über Relay zum Hafen Lichtkordon: Die Karawane 'Goldkehle' ist drei Tage überfällig, letztes Signal aus der Grauen Weite. Sie bietet 80 Marken für Nachricht oder Rettung.
- **Weiter:** Crew nimmt an → `s2_nebel_einfahrt`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Sela (Vaelen-Händlerin):** „Eine Karawane ist spurlos ausgeblieben – mein bestes Schiff, drei Tage überfällig, letztes Signal aus der Grauen Weite. Ihr seid nah genug und klein genug, um unbemerkt hineinzufliegen.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. s2_nebel_einfahrt – Graue Weite

- **Szenentyp:** gefahrennavigation · **Baustein:** `kurs_durch_gefahr/nebelflug` · **Fassung:** rohfassung · **Plan:** 3 min
- **Sachverhalt:** Die Graue Weite liegt dicht und still – kein Funksignal, kein Licht. Der Pilot muss das Feld durchqueren, die Taktik deckt mit Weitscan auf und setzt Marker, der Captain plant den Kurs.
- **Wendung (Plan):** Ankündigung: Mitten im Nebelflug bricht kurz ein Funksignal durch – Vaelen-Kennung, dann Stille. Das Signal kommt von vorn.
- **Weiter:** Feld durchquert → `s3_signal_orten`

**Ziele**

- Nach Graue Weite springen
- Das Feld durchqueren (andere Seite erreichen)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Graue Weite. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 0.5 s)* **ODA:** „Dichtes Feld voraus. Pilot sieht nur nach vorn – Taktik: Weitscan, Marker setzen!“
- *(nach 10 s)* **ODA:** „Captain: Sternkarte und Taktikkarte zeigen den Ausgang auf der anderen Seite. Kurs ansagen!“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Ziel ist die andere Seite des Felds. Langsam ist sicherer – jeder Brocken kostet Schild.“
- *(sobald erfüllt)* **Wendung** `s2_nebel_einfahrt_hinterhalt` – Ankündigung (gleichzeitig): ODA „Jäger kommen aus dem Feld! Breitseite, und die Brocken als Deckung nutzen.“
- *(sobald erfüllt)* **ODA:** „Wir sind durch! Freie Sicht voraus.“
- *(Autolösung)* **ODA:** „Der Navigationsrechner hat eine Lücke gefunden – Kurs liegt an, wir sind durch.“

### 3. s3_signal_orten – Graue Weite

- **Szenentyp:** annaeherung_und_erkundung · **Baustein:** `signal_orten/weitscan_peilung` · **Fassung:** rohfassung · **Plan:** 3 min
- **Sachverhalt:** Das Signal ist schwach und springt. Die Taktik pingt mit dem Weitscan, der Pilot fliegt die Peilung ab – bis die 'Goldkehle' aufleuchtet: treibend, Antrieb tot, Schild ausgefallen.
- **Weiter:** Goldkehle gefunden, Rostmeute taucht auf → `s4_entscheidung_auftritt`

**Ziele**

- Taktik: Weitscan (W) – die alte Bake suchen
- Taktik: anvisieren (T) und scannen (S halten)

**Texte in Reihenfolge**

- *(nach 1 s)* **ODA:** „Irgendwo hier ist die alte Bake. Taktik: Weitscan (W) – Marker für den Piloten!“
- *(sobald erfüllt)* **ODA:** „Taktik: W drückt den Weitscan – Reichweite 1000. Mehrmals und an verschiedenen Stellen probieren.“
- *(sobald erfüllt)* **ODA (Richtung):** „die alte Bake kommt von {dir} von uns. Hinfliegen und nochmal Weitscan (W)!“
- *(Autolösung)* **ODA:** „Ich habe die alte Bake angepeilt und markiert. Anvisieren (T) und scannen (S)!“

### 4. s4_entscheidung_auftritt – Graue Weite

- **Szenentyp:** begegnung · **Baustein:** `taeuschen/bluff_funk` · **Fassung:** rohfassung · **Plan:** 2 min
- **Sachverhalt:** Ein Rostmeute-Kanonenboot taucht aus dem Nebel auf – es hat die 'Goldkehle' schon durchsucht und verlangt nun, dass die Lerche abdrehe. Der Anführer funkt: 'Hier ist nichts für euch.'
- **Weiter:** Bluff gelingt oder Crew weicht aus → `s5_pannenhilfe`; Bluff scheitert oder Crew greift an → `s5b_gefecht`

**Entscheidung:** Wie antwortet der Captain dem Rostmeute-Kanonenboot?

- Wir sind Schrotthändler, suchen Treibgut → Kanonenboot glaubt es bei passendem Scan-Hinweis und zieht ab; Pannenhilfe-Szene ruhig
- Wir suchen die Goldkehle im Auftrag der Karawane → Kanonenboot fühlt sich bedroht, greift sofort an; Gefecht beginnt ohne Pannenhilfe

**Ziele**

- Captain: antworten (Funk) – Ortung beachten

**Texte in Reihenfolge**

- **Funk – Grauzahn (Rostmeute):** „Ihr seid auf meinem Kurs. Dreht bei, oder wir helfen nach.“
- **ODA:** „Funkspruch! Gleich kommt die Ortung – hört genau hin, bevor der Captain antwortet.“
- *(nach 8 s)* **ODA:** „Ortung: Ihr Antrieb flackert – der Reaktor läuft auf halber Last. Die können kaum folgen.“
- *(nach 10 s)* **Entscheidung** `s4_entscheidung_auftritt_wahl`: „Wie antworten wir?“
  - Option `passend`: „Wir springen gleich – folgt uns, wenn ihr könnt.“
    - **Funk – Grauzahn (Rostmeute):** „… Na schön. Diesmal. Verschwindet.“
  - Option `falsch`: „Eine Patrouille ist auf dem Weg hierher.“
    - **Funk – Grauzahn (Rostmeute):** „Netter Versuch. Glaubt ihr, ich kann nicht zählen?“
  - Option `wahrheit`: „Die Wahrheit sagen“
- *(nach 50 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Was hat die Ortung gesagt?“

### 5. s5_pannenhilfe – Graue Weite

- **Szenentyp:** begegnung · **Baustein:** `pannenhilfe/andocken_und_flicken` · **Fassung:** rohfassung · **Plan:** 3 min
- **Sachverhalt:** Das Kanonenboot zieht ab oder hält Abstand. Die Lerche nähert sich der 'Goldkehle', flickt den Antrieb von außen und erfährt vom Kapitän, was die Rostmeute gesucht hat: eine Kustoden-Sonde, die die Goldkehle unwissentlich geladen hatte.
- **Weiter:** Antrieb geflickt, Goldkehle fährt selbst → Ausgang `begleitet`; Kanonenboot greift während der Arbeit an → `s5b_gefecht`

**Entscheidung:** Was macht die Crew mit dem Wissen über die Kustoden-Sonde an Bord der Goldkehle?

- Sonde sicherstellen und mitführen → Rostmeute verfolgt die Lerche; Kustoden-Faden öffnet sich
- Sonde vor Ort zerstören → Rostmeute verliert Interesse; Kustoden-Faden bleibt geschlossen

**Ziele**

- Bergungsboot flicken: längsseits gehen und stillhalten

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Bergungsboot treibt. Steuer: nah ran und fast stehen bleiben – dann flicken die Schrauber.“
- *(nach 2 s)* **Funk – Sela (Vaelen-Händlerin):** „Lerche? Unser Antrieb ist tot, wir treiben. Kommt längsseits – wir brauchen eure Schrauber.“
- *(nach 50 s, Hinweis, falls nötig)* **ODA:** „Reparatur läuft nur nah, langsam und ohne Beschuss. Steuer: Tempo auf null, Bug zum Havaristen.“
- *(sobald erfüllt)* **Wendung** `s5_pannenhilfe_stoerer` – Ankündigung (vorher, 5 s Vorlauf): ODA „Ortung: Angreifer halten auf den Havaristen zu! Reparatur pausiert unter Beschuss – dazwischen.“
- *(sobald erfüllt)* **Wendung** `s5_pannenhilfe_stoerer2` – Ankündigung (vorher, 5 s Vorlauf): ODA „Ortung: Angreifer halten auf den Havaristen zu! Reparatur pausiert unter Beschuss – dazwischen.“
- *(sobald erfüllt)* **Funk – Sela (Vaelen-Händlerin):** „Er läuft! Hört ihr das? Wir schulden euch was, Lerche.“
- *(sobald erfüllt)* **ODA:** „Bergungsboot ist kampfunfähig. Die Besatzung steigt in die Kapseln – wir melden es dem Hafen.“
- *(sobald erfüllt)* **ODA:** „Fremde Technik, keine Chance. Wir funken einen Schlepper vom Hafen herbei.“

### 6. s5b_gefecht – Graue Weite

- **Szenentyp:** raumgefecht · **Baustein:** `vertreiben/bis_zur_flucht` · **Fassung:** rohfassung · **Plan:** 3 min
- **Sachverhalt:** Das Kanonenboot und zwei Jäger wollen die Goldkehle nicht freigeben. Die Lerche muss sie vertreiben – erst fliehen die Jäger, dann dreht das Kanonenboot knurrend ab.
- **Weiter:** Rostmeute flieht, Goldkehle gerettet → Ausgang `befreit`; Lerche zu schwer beschädigt, Rückzug → Ausgang `rueckzug`

**Ziele**

- Angreifer vertreiben ({left:s5b_gefecht_w1} übrig)

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Angreifer! Die wollen Beute, keinen Heldentod – genug Treffer, und sie drehen ab.“
- *(nach 3 s)* **Funk – Grauzahn (Rostmeute):** „Letzte Warnung, Lerche. Dreht ab, sonst wird es teuer.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Angeschlagene Gegner fliehen. Taktik: Feuer bündeln, einen nach dem anderen. Pilot: Breitseite.“
- *(sobald erfüllt)* **Funk – Grauzahn (Rostmeute):** „Das ist es nicht wert. Rückzug! Wir sehen uns wieder.“
- *(Autolösung)* **ODA:** „Die Angreifer geben auf und drehen ab. Gut so.“

## Ausgänge

### begleitet

*Antrieb geflickt, Rostmeute abgezogen, Goldkehle fährt selbst zum Treffpunkt*

- Belohnung: 190 Marken
- Gedächtnis Sela (Vaelen-Händlerin) (`fluesterer_im_nebel_begleitet`): „Lerche hat die Goldkehle ohne Kampf heimgebracht – schulde ihnen etwas“
- Haltung Sela (Vaelen-Händlerin): +2
- Chronik: „Crew rettet Vaelen-Frachter 'Goldkehle' aus der Grauen Weite durch Pannenhilfe“
- Fakt `kustoden_sonde` (offener Faden): „Eine Kustoden-Sonde war an Bord der Goldkehle – ihr Verbleib ist offen“

### befreit

*Rostmeute vertrieben nach Gefecht, Goldkehle gerettet*

- Belohnung: 190 Marken
- Gedächtnis Sela (Vaelen-Händlerin) (`fluesterer_im_nebel_befreit`): „Lerche hat die Goldkehle mit Waffengewalt befreit – mutiger Einsatz“
- Haltung Sela (Vaelen-Händlerin): +1
- Haltung Grauzahn (Rostmeute): -1
- Chronik: „Crew vertreibt Rostmeute-Trupp im Nebel und befreit die Goldkehle“
- Fakt `kustoden_sonde` (offener Faden): „Eine Kustoden-Sonde war an Bord der Goldkehle – ihr Verbleib ist offen“

### rueckzug

*Lerche zu schwer beschädigt, Rückzug ohne Goldkehle*

- Belohnung: 190 Marken
- Gedächtnis Sela (Vaelen-Händlerin) (`fluesterer_im_nebel_rueckzug`): „Lerche musste ohne die Goldkehle abdrehen – kein Vorwurf, aber kein Vertrauen gewonnen“
- Haltung Grauzahn (Rostmeute): +1
- Chronik: „Crew muss im Nebel vor der Rostmeute abdrehen, Goldkehle-Schicksal unbekannt“
- Fakt `goldkehle_vermisst`: „Die Goldkehle ist weiter verschollen – die Rostmeute hat sie“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 's4_entscheidung_auftritt_geglueckt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_entscheidung_auftritt_durchschaut' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's5_pannenhilfe_beschaedigt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's5_pannenhilfe_verloren' wird gesetzt, aber in diesem Buch nie gelesen

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
