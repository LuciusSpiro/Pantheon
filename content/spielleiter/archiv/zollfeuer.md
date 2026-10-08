---
status: angenommen
quelle: archiv
erstellt: 2026-10-08
auftraggeber: tesk
titel: "Zollfeuer"
kennung: zollfeuer
---

# Zollfeuer

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen zollfeuer`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Hafenmeisterin Tesk (`tesk`) |
| Quelle | archiv, Modell hand |
| Zieldauer | 15 min |
| Belohnung | 190 Marken |
| Ziel | Mond Kesh |
| Szenen | 5 |

## Pitch

Lerche, hier Tesk. Seit gestern springt kein Frachter mehr aus dem Kesh-Orbit – jemand hat Störrelais gesetzt und kassiert Wegezoll. Räumt mir die Route frei.

## Erinnerung

„Grauzahn hat nicht vergessen, dass die Lerche ihm im Splittergürtel den Wegezoll verweigert hat.“ – Bezug: Grauzahn (Rostmeute) / `wegezoll_verweigert`

Varianten (je nach Weltstand):
- Grauzahn (Rostmeute) / `wegezoll_gezahlt`: „Grauzahn erinnert sich gern: Die Lerche hat schon einmal gezahlt. Er rechnet fest damit, dass sie es wieder tut.“
- Grauzahn (Rostmeute) / `b7_zurueckgeschlagen`: „Bei B-7 hat die Lerche Grauzahns Jäger zurückgeschlagen. Diesmal will er kassieren, nicht kämpfen.“

Ohne passende Erinnerung: „Tesk kennt die Rostmeute seit Jahren: Wo Frachter ausbleiben, kassiert irgendwo Grauzahn.“

## Szenen

### 1. zf_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 1 min
- **Sachverhalt:** Tesk schickt die Lerche in den Kesh-Orbit: Die Frachter stauen sich, jemand blockiert die Sprungroute.
- **Weiter:** Auftrag angenommen → `zf_relais`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Hafenmeisterin Tesk:** „Lerche, hier Tesk. Seit gestern springt kein Frachter mehr aus dem Kesh-Orbit – jemand hat Störrelais gesetzt und kassiert Wegezoll. Räumt mir die Route frei.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. zf_relais – Mond Kesh

- **Szenentyp:** belagerung · **Baustein:** `system_ausschalten/stoerrelais` · **Fassung:** archiv · **Plan:** 4 min
- **Sachverhalt:** Störrelais kreisen um die Station im Kesh-Orbit und blockieren jeden Faltsprung, ein Wachjäger der Rostmeute passt auf. Grauzahn meldet sich, als die Lerche zu schießen beginnt.
- **Weiter:** Relais zerstört → `zf_zoll`

**Ziele**

- Nach Mond Kesh springen
- Störrelais abschießen ({killed:zf_relais_relay}/3)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Mond Kesh. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 0.5 s)* **ODA:** „Störrelais am Hauptobjekt! Solange eins sendet, gibt es keinen Faltsprung. Taktik: abschießen!“
- *(nach 35 s)* **Funk – Grauzahn (Rostmeute):** „Hört ihr das Rauschen, Lerche? Das ist meine Zollschranke. Wer hier rauswill, redet erst mit mir.“
- *(nach 75 s, Hinweis, falls nötig)* **ODA:** „Die Relais kreisen nah am Hauptobjekt. Taktik: T schaltet durch, Pilot: Bug drauf, Batterien frei.“
- *(sobald erfüllt)* **ODA:** „Letztes Relais verstummt – der Sprungrechner hat wieder Sterne.“
- **Sprungsperre:** „Störrelais senden – der Sprungrechner findet keinen Kurs. Erst die Relais abschießen.“

### 3. zf_zoll – Mond Kesh

- **Szenentyp:** begegnung · **Baustein:** `verhandeln/funkduell` · **Fassung:** archiv · **Plan:** 2 min
- **Sachverhalt:** Grauzahn verlangt für seine zerlegten Relais und die freie Route sechzig Marken. Die Crew muss sich entscheiden: zahlen oder es darauf ankommen lassen.
- **Weiter:** Ablehnen oder Schweigen → `zf_gefecht`; Zahlen → Ausgang `zoll_bezahlt`

**Entscheidung:** Zahlt die Lerche Grauzahns Wegezoll?

- Sechzig Marken zahlen → Kein Gefecht, die Route ist offen – zu Grauzahns Preis. Tesk ist enttäuscht, Grauzahn zufrieden.
- Ablehnen (oder schweigen) → Gefecht mit Jägern und Kanonenboot. Tesk ist dankbar, Grauzahn gereizt.

**Ziele**

- Captain: antworten (Funk)

**Texte in Reihenfolge**

- **Funk – Grauzahn (Rostmeute):** „Ihr habt meine Relais zerlegt. Teures Spielzeug. Sechzig Marken, und wir vergessen das – sonst hole ich sie mir anders.“
- **Entscheidung** `zf_zoll_wahl`: „Grauzahns Wegezoll zahlen?“
  - Option `a`: „Sechzig Marken. Und dann ist Ruhe.“
    - Zahlung: 60 Marken
    - **Funk – Grauzahn (Rostmeute):** „Geht doch. Die Route ist offen – solange ich es sage.“
  - Option `b`: „Die Route gehört dem Konkordat. Kein Zoll.“
    - **Funk – Grauzahn (Rostmeute):** „Dann zahlt ihr eben mit Blech. Jäger, holt sie euch!“
  - Option `schweigen`: „Funkstille“
    - **Funk – Grauzahn (Rostmeute):** „Schweigen kostet auch. Jäger, los!“
- **ODA:** „Funkspruch! Captain: Antwort im Reiter „Funk“ – sprecht euch ab.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Schweigen ist auch eine Antwort – aber keine freundliche.“

### 4. zf_gefecht – Mond Kesh

- **Szenentyp:** raumgefecht · **Baustein:** `vernichten/angriffswelle` · **Fassung:** archiv · **Plan:** 4 min
- **Sachverhalt:** Grauzahns Jäger gehen auf die Lerche los, ein Kanonenboot folgt als Verstärkung.
- **Weiter:** Angriff abgewehrt → `zf_bericht`

**Ziele**

- Angriff abwehren

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Feindkontakt! Taktik besetzen, Captain verteilt Schilde auf die bedrohte Seite.“
- *(nach 3 s)* **Funk – Grauzahn (Rostmeute):** „Ihr wolltet es so. Jäger, zeigt der Lerche, was Zoll kostet.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Pilot: Breitseite zum Gegner. Taktik: Ziel mit T, Batterien 2/3. Schäden: E halten oder Bots.“
- *(sobald erfüllt)* **Wendung** `zf_gefecht_verstaerkung` – Ankündigung (vorher, 4 s Vorlauf): ODA „Ortung: Verstärkung im Anflug! Schilde hoch, Pilot – Breitseite bereithalten.“
  - **Funk – Grauzahn (Rostmeute):** „Kanonenboot, nach vorn. Ich will ihre Schilde glühen sehen.“

### 5. zf_bericht – Hafen Lichtkordon

- **Szenentyp:** ablieferung · **Baustein:** `ladung_liefern/im_hafen_abgeben` · **Fassung:** archiv · **Plan:** 2 min
- **Sachverhalt:** Zurück im Hafen: Tesk nimmt die Messdaten der Relais entgegen, die ersten Frachter springen schon wieder.
- **Weiter:** angedockt → Ausgang `zoll_gebrochen`

**Ziele**

- Nach Hafen Lichtkordon springen
- Andocken und die Messdaten der Relais übergeben

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Hafen Lichtkordon. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s, bedingt)* **ODA:** „Kurs auf den Andockpunkt. Steuer: langsam ran, dann andocken.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Andocken: nah an die Schleuse, Tempo runter, dann die Andocktaste der Steuer.“
- *(sobald erfüllt)* **Funk – Hafenmeisterin Tesk:** „Route frei, Relais verstummt – die ersten Frachter springen schon. Das vergesse ich euch nicht, Lerche.“
- *(sobald erfüllt)* Belohnung: 120 Marken
- *(sobald erfüllt)* **Log:** „Übergabe von die Messdaten der Relais quittiert.“

## Ausgänge

### zoll_bezahlt

*Die Crew hat Grauzahn den Wegezoll gezahlt.*

- Belohnung: 190 Marken
- Haltung Grauzahn (Rostmeute): +1
- Gedächtnis Grauzahn (Rostmeute) (`zollfeuer_zoll_bezahlt`): „Die Lerche hat im Kesh-Orbit Wegezoll gezahlt. Sie lernt.“
- Haltung Hafenmeisterin Tesk: -1
- Gedächtnis Hafenmeisterin Tesk (`zollfeuer_zoll_bezahlt`): „Die Lerche hat der Rostmeute Zoll gezahlt, statt die Route freizukämpfen.“
- Chronik: „Zollfeuer: Die Lerche zahlte Grauzahn im Kesh-Orbit sechzig Marken. Die Route ist offen – zu seinem Preis.“
- Fakt `kesh_route` (offener Faden): „Die Rostmeute kassiert Wegezoll im Kesh-Orbit.“

### zoll_gebrochen

*Die Crew hat abgelehnt, die Rostmeute vertrieben und Tesk Bericht erstattet.*

- Belohnung: 190 Marken
- Haltung Hafenmeisterin Tesk: +1
- Gedächtnis Hafenmeisterin Tesk (`zollfeuer_zoll_gebrochen`): „Die Lerche hat die Kesh-Route freigekämpft und mir die Relais-Daten gebracht.“
- Haltung Grauzahn (Rostmeute): -1
- Gedächtnis Grauzahn (Rostmeute) (`zollfeuer_zoll_gebrochen`): „Die Lerche hat meine Zollschranke im Kesh-Orbit zerschossen. Das merke ich mir.“
- Chronik: „Zollfeuer: Die Lerche zerstörte die Störrelais im Kesh-Orbit und schlug Grauzahns Jäger zurück. Die Frachter springen wieder.“
- Fakt `kesh_route`: „frei“

## Prüfer

Keine Fehler, keine Warnungen.

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
