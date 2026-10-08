---
status: offen
quelle: llm
erstellt: 2026-10-08T13:58:14.202Z
auftraggeber: tesk
titel: "Signal in der Grauen Weite"
kennung: 2026-10-08_sl_2_nebel_phantom
---

# Signal in der Grauen Weite

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen 2026-10-08_sl_2_nebel_phantom`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Hafenmeisterin Tesk (`tesk`) |
| Quelle | llm, Modell sonnet, 42723 Tokens |
| Welt / Anlass | `w-1pj2` – kampagnenstart |
| Zieldauer | 15 min |
| Belohnung | 150 Marken |
| Ziel | Graue Weite |
| Szenen | 5 |

## Pitch

Eine Bake sendet aus der Grauen Weite – unbekanntes Muster, kein Konkordat-Code. Ich brauche eine Crew, die diskret ist und keine Fragen stellt, bis sie Antworten hat.

## Erinnerung

„Das Kustoden-Relais ist geweckt – Tesk hat das im Kopf, wenn sie eine Crew in die Graue Weite schickt, die an das Relais grenzt.“ – Bezug: Fakt `kustoden_relais`

Ohne passende Erinnerung: „Hafenmeisterin Tesk hat wieder Arbeit für die Lerche.“

## Szenen

### 1. s1_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Tesk erteilt den Auftrag am Lichtkordon: Eine unbekannte Bake sendet aus der Grauen Weite. Herausfinden, was dort ist – und ob es eine Gefahr für den Hafen darstellt.
- **Weiter:** Auftrag angenommen → `s2_nebel_scan`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Hafenmeisterin Tesk:** „Eine Bake sendet aus der Grauen Weite – unbekanntes Muster, kein Konkordat-Code. Ich brauche eine Crew, die diskret ist und keine Fragen stellt, bis sie Antworten hat.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. s2_nebel_scan – Graue Weite

- **Szenentyp:** annaeherung_und_erkundung · **Baustein:** `signal_orten/weitscan_peilung` · **Fassung:** llm · **Plan:** 4 min
- **Sachverhalt:** Die Lerche fliegt in die Graue Weite. Irgendwo im Nebel sendet die Bake – Taktik peilt, Pilot fliegt die Richtung ab, bis die Quelle geortet ist.
- **Wendung (Plan):** Angekündigt: Beim Annähern an die Bake meldet sich eine fremde Stimme – kein Konkordat-Signal.
- **Weiter:** Bake geortet → `s3_begegnung`

**Ziele**

- Nach Graue Weite springen
- Taktik: Weitscan (W) – die Bake suchen
- Taktik: anvisieren (T) und scannen (S halten)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Graue Weite. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s)* **ODA:** „Irgendwo hier ist die Bake. Taktik: Weitscan (W) – Marker für den Piloten!“
- *(nach 40 s)* **Wendung** `s2_fremde_stimme_meldet_sich` – Ankündigung (gleichzeitig): ODA „ODA: Eingehende Übertragung – kein Konkordat-Code, kein bekanntes Protokoll. Quelle: nahe der Bake.“
  - **Funk – Stimme der Bake:** „Unbekanntes Schiff, haltet Abstand. Identifiziert euch oder dreht ab.“
- *(sobald erfüllt)* **ODA:** „Taktik: W drückt den Weitscan – Reichweite 1000. Mehrmals und an verschiedenen Stellen probieren.“
- *(sobald erfüllt)* **ODA (Richtung):** „die Bake kommt von {dir} von uns. Hinfliegen und nochmal Weitscan (W)!“
- *(Autolösung)* **ODA:** „Ich habe die Bake angepeilt und markiert. Anvisieren (T) und scannen (S)!“

### 3. s3_begegnung – Graue Weite

- **Szenentyp:** begegnung · **Baustein:** `taeuschen/bluff_funk` · **Fassung:** rohfassung · **Plan:** 2 min
- **Sachverhalt:** Ein automatisiertes Schiff – kein Pilot, aber eine Stimme – verlangt Identifikation und Zweck. Die Ortung zeigt: Das Schiff hat leere Laderäume und einen beschädigten Antrieb. Der Captain wählt seinen Bluff.
- **Weiter:** Bluff gelingt → `s4_geleit`; Bluff scheitert oder Wahrheit → `s4_gefecht`

**Entscheidung:** Welche Identität gibt der Captain der automatisierten Stimme gegenüber an?

- Bergungscrew des Konkordats → Passt zum leeren Laderaum – Bluff verfängt, Schiff wird zum Schützling statt zum Feind.
- Freie Crew, Auftrag von Tesk → Stimme stuft die Lerche als unbefugte Eindringlinge ein – Wächter-Jäger greifen an.

**Ziele**

- Captain: antworten (Funk) – Ortung beachten

**Texte in Reihenfolge**

- **Funk – Stimme der Bake:** „Ihr seid auf meinem Kurs. Dreht bei, oder wir helfen nach.“
- **ODA:** „Funkspruch! Gleich kommt die Ortung – hört genau hin, bevor der Captain antwortet.“
- *(nach 8 s)* **ODA:** „Ortung: Ihr Antrieb flackert – der Reaktor läuft auf halber Last. Die können kaum folgen.“
- *(nach 10 s)* **Entscheidung** `s3_begegnung_wahl`: „Wie antworten wir?“
  - Option `passend`: „Wir springen gleich – folgt uns, wenn ihr könnt.“
    - **Funk – Stimme der Bake:** „… Na schön. Diesmal. Verschwindet.“
  - Option `falsch`: „Eine Patrouille ist auf dem Weg hierher.“
    - **Funk – Stimme der Bake:** „Netter Versuch. Glaubt ihr, ich kann nicht zählen?“
  - Option `wahrheit`: „Die Wahrheit sagen“
- *(nach 50 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Was hat die Ortung gesagt?“

### 4. s4_geleit – Graue Weite

- **Szenentyp:** geleit · **Baustein:** `schuetzen/notruf_verteidigen` · **Fassung:** llm · **Plan:** 4 min
- **Sachverhalt:** Das automatisierte Schiff – jetzt Schützling – driftet mit totem Antrieb, und Rostmeute-Jäger kreisen bereits. Die Lerche muss es schützen, bis die Angreifer vertrieben sind.
- **Weiter:** Schützling heil → Ausgang `erfolg`; Schützling kampfunfähig → Ausgang `teilerfolg`

**Ziele**

- Bake verteidigen – Hülle {escortHp:s4_geleit} %

**Texte in Reihenfolge**

- **Funk – Stimme der Bake:** „Antrieb ausgefallen, Angreifer auf Kollisionskurs. Wer auch immer das hört – ich brauche jetzt Hilfe.“
- *(nach 0.5 s)* **ODA:** „Notruf von Bake! Der Havarist treibt – wir sind seine Schilde.“
- *(nach 6 s)* **Wendung** `s4_geleit_angriff` – Ankündigung (gleichzeitig): ODA „Jäger kreisen um Bake! Pilot: dazwischen. Taktik: wer auf den Havaristen lädt, zuerst.“
- *(nach 35 s)* **Wendung** `s4_geleit_schwer` – Ankündigung (vorher, 5 s Vorlauf): ODA „Ortung: ein schwerer Angreifer hält auf Bake zu! Schilde zur Angriffsseite, Breitseite dazwischen.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Lädt ein Jäger auf den Havaristen, stellt euch quer dazwischen – unser Schild fängt die Ladung ab.“
- *(sobald erfüllt)* **ODA:** „Bake treibt kampfunfähig. Die Jäger drehen ab – die Besatzung lebt noch.“
- *(sobald erfüllt)* **Funk – Stimme der Bake:** „Sie ziehen zurück … Lerche, ich stehe in eurer Schuld.“
- *(Autolösung)* **ODA:** „Die Jäger brechen ab und verschwinden. Durchatmen.“

### 5. s4_gefecht – Graue Weite

- **Szenentyp:** raumgefecht · **Baustein:** `vertreiben/bis_zur_flucht` · **Fassung:** llm · **Plan:** 3 min
- **Sachverhalt:** Das automatisierte Schiff schaltet auf feindlich: Jäger erscheinen aus dem Nebel – offenbar Wächter, die die Bake schützen. Die Lerche muss sie vertreiben, bevor die Bake ihrerseits Verstärkung ruft.
- **Weiter:** Jäger vertrieben → Ausgang `erfolg`; Lerche schwer beschädigt → Ausgang `teilerfolg`

**Ziele**

- Angreifer vertreiben ({left:s4_gefecht_w1} übrig)

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Angreifer! Die wollen Beute, keinen Heldentod – genug Treffer, und sie drehen ab.“
- *(nach 3 s)* **Funk – Stimme der Bake:** „Unbefugtes Schiff, ihr seid zu nah. Verlasst die Zone oder wir sorgen dafür.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Angeschlagene Gegner fliehen. Taktik: Feuer bündeln, einen nach dem anderen. Pilot: Breitseite.“
- *(sobald erfüllt)* **Funk – Stimme der Bake:** „Genug. Rückzug – die Bake ist nicht schützbar, wenn wir fallen.“
- *(Autolösung)* **ODA:** „Die Angreifer geben auf und drehen ab. Gut so.“

## Ausgänge

### erfolg

*Schützling heil oder Jäger vertrieben, Bake gesichert*

- Belohnung: 150 Marken
- Gedächtnis Hafenmeisterin Tesk (`nebel_phantom_erfolg`): „Die Lerche hat die Bake in der Grauen Weite gesichert und Rostmeute-Aktivität dort gemeldet.“
- Chronik: „Die Crew sicherte eine unbekannte Bake in der Grauen Weite und schlug Angreifer zurück.“
- Fakt `nebel_bake` (offener Faden): „Die Bake in der Grauen Weite gehört keiner bekannten Fraktion – ihr Ursprung ist ungeklärt.“

### teilerfolg

*Schützling kampfunfähig oder Lerche zum Rückzug gezwungen, Bake-Daten nur teilweise*

- Belohnung: 150 Marken
- Gedächtnis Hafenmeisterin Tesk (`nebel_phantom_teilerfolg`): „Die Lerche kehrte mit Bruchstücken zurück – die Bake sendet noch, ihr Ursprung bleibt unklar.“
- Chronik: „Die Crew erkundete die Graue Weite, musste aber ohne vollständige Antwort abdrehen.“
- Fakt `nebel_bake` (offener Faden): „Die Bake in der Grauen Weite sendet weiter – niemand weiß, für wen.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 's3_begegnung_geglueckt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's3_begegnung_durchschaut' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_geleit_beschaedigt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_geleit_verloren' wird gesetzt, aber in diesem Buch nie gelesen

## Gespielt

| Datum | Ausgang | Dauer | Crew |
|---|---|---|---|
| 2026-10-08 14:01 | teilerfolg | 2:33 | 3 |

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._

- QA-Abnahme S2b: live im Spiel erzeugt (Spielleiter wählte Tesk), zu dritt gespielt mit Pausen und Debug-Skip je Schritt –
  „Gespielt 2:33“ ist **keine** Menschen-Spielzeit. 42 723 Tokens. s3_begegnung blieb Rohfassung: die fertige Szene wurde
  vom Spiel abgelehnt („schon betreten“, Flag-Rücksetzung im Hafen-Schritt) – inzwischen behoben (`server/sim/mission.js`).
- QA-Einschätzung: Tesk ist nur Auftraggeberin. Die „Stimme der Bake“ spricht in allen Szenen – mal Notruf eines
  automatisierten Schiffs, mal Drohung; als Geheimnis reizvoll, aber für Spieler schwer zu lesen (wer ist das?). Die beiden
  Zweige s4_geleit/s4_gefecht passen zur Bluff-Entscheidung. „teilerfolg“ zahlt dieselben 150 Marken wie „erfolg“.
