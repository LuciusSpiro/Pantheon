---
status: angenommen
quelle: archiv
erstellt: 2026-11-11
auftraggeber: sela
titel: "Zuflucht auf Kesh"
kennung: zuflucht_auf_kesh
---

# Zuflucht auf Kesh

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen zuflucht_auf_kesh`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Sela (Vaelen-Händlerin) (`sela`) |
| Quelle | archiv, Modell hand |
| Zieldauer | 15 min |
| Belohnung | 190 Marken |
| Ziel | Mond Kesh |
| Szenen | 5 |

## Pitch

Lerche, hier Sela. Mein Frachter Dornfink ist über Kesh verschwunden, zuletzt ein Notsignal, dann nichts mehr. Ich glaube, er ist unten im Gelände gelandet. Findet meine Leute und holt, was ihr von der Ladung retten könnt.

## Erinnerung

„Sela handelt mit allem, was im Saumraum fliegt. Ein Frachter der Vaelen, der nicht mehr antwortet, ist selbst für sie ein schlechtes Zeichen.“ – Bezug: neutral (noch keine gemeinsame Geschichte)

Varianten (je nach Weltstand):
- Sela (Vaelen-Händlerin) / `sela_erinnerung`: „Sela vergisst nicht, dass die Lerche ihr schon einmal geholfen hat. Jetzt ruft sie wieder, und diesmal geht es um Menschen.“
- Sela (Vaelen-Händlerin) / `m2_erinnerung`: „Die Lerche hat Selas verlorene Messsonde gefunden. Nun ist ein ganzer Frachter verloren.“

Ohne passende Erinnerung: „Sela handelt mit allem, was im Saumraum fliegt. Ein Frachter der Vaelen, der nicht mehr antwortet, ist selbst für sie ein schlechtes Zeichen.“

## Szenen

### 1. zk_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Sela funkt in den Hafen: Ihr Frachter Dornfink ist über dem Mond Kesh abgestürzt oder notgelandet. Sie bittet die Lerche, nach Überlebenden zu suchen und die Ladung zu sichern.
- **Weiter:** Auftrag angenommen → `zk_suche`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Sela (Vaelen-Händlerin):** „Lerche, hier Sela. Mein Frachter Dornfink ist über Kesh verschwunden, zuletzt ein Notsignal, dann nichts mehr. Ich glaube, er ist unten im Gelände gelandet. Findet meine Leute und holt, was ihr von der Ladung retten könnt.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. zk_suche – Mond Kesh

- **Szenentyp:** bergung_vor_ort · **Baustein:** `personen_bergen/ueberlebende_suchen` · **Fassung:** rohfassung · **Plan:** 4 min
- **Sachverhalt:** Unten im Gelände liegt die Absturzspur der Dornfink. Ein Verletzter aus der Besatzung hat sich in einer Deckung versteckt. Das Außenteam nimmt ein Medipack mit, findet ihn und bringt ihn zu den Pads.
- **Weiter:** Verletzter versorgt oder Suche beendet → `zk_fracht`

**Ziele**

- Nach Mond Kesh springen
- Außenteam runterbeamen (Medipack!)
- Maat Brann versorgen und an Bord bringen
- Zurück an Bord beamen

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Mond Kesh. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 2 s)* **ODA:** „Medipack mitnehmen, dann auf die Pads. Unten hat sich Maat Brann versteckt – die Außenteam-Karte zeigt, wo.“
- *(nach 6 s)* **Funk – Maat Brann:** „Hier drüben, in der Deckung! Mein Bein … ich komme allein nicht weg.“
- *(nach 70 s, Hinweis, falls nötig)* **ODA:** „Captain: Maat Brann ist auf der Außenteam-Karte markiert. Medipack, hin, E, dann gemeinsam zu den Pads.“
- *(sobald erfüllt)* **ODA:** „Maat Brann ist an Bord und lebt. Mehr kann der Bordarzt – also wir – im Moment nicht tun.“
- *(sobald erfüllt)* **ODA:** „Maat Brann hat sich allein zu den Pads geschleppt. Wir holen alle hoch.“

### 3. zk_fracht – Mond Kesh

- **Szenentyp:** bergung_vor_ort · **Baustein:** `ladung_bergen/ladung_am_boden` · **Fassung:** rohfassung · **Plan:** 5 min
- **Sachverhalt:** Die Ladung der Dornfink liegt verstreut im Gelände, und ein Trupp eines Germanenclans hat die Spur ebenfalls gefunden. Das Außenteam sichert die Kisten, bevor sie weg sind.
- **Weiter:** Ladung geborgen → `zk_abgabe_voll`; Rest liegen gelassen → `zk_abgabe_knapp`

**Ziele**

- Außenteam runterbeamen
- Ladung bergen (E halten, 2 Fundorte): {{lex.ladung:der}}
- Zurück an Bord beamen

**Texte in Reihenfolge**

- *(nach 2 s)* **ODA:** „Fracht im Gelände: 2 Fundorte auf der Außenteam-Karte. Hingehen, E halten – dann ist sie geborgen.“
- *(nach 70 s, Hinweis, falls nötig)* **ODA:** „Captain: Fundorte auf der Karte markiert, dort liegt {{lex.ladung:der}}. Hin, E halten, dann zu den Pads.“
- *(sobald erfüllt)* **ODA:** „Die Ladung ist geborgen! Zurück zu den Pads, dann holen wir euch hoch.“
- *(sobald erfüllt)* **ODA:** „Genug gesucht – den Rest lassen wir liegen. Zurück zu den Pads.“

### 4. zk_abgabe_voll – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Sela nimmt die Kisten der Dornfink in Empfang und sorgt sich um ihre Besatzung. Dank ihr steht die Lerche im Vaelen-Handel in gutem Licht.
- **Weiter:** Abgegeben → Ausgang `voll`

**Ziele**

- Nach Hafen Lichtkordon springen

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Hafen Lichtkordon. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s)* **ODA:** „Sela nimmt die Kisten der Dornfink in Empfang und sorgt sich um ihre Besatzung. Dank ihr steht die Lerche im Vaelen-Han…“

### 5. zk_abgabe_knapp – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Sela bekommt die Überlebenden zurück, aber nur einen Teil der Ladung. Der Rest liegt noch auf Kesh, und die Clans haben ihn sicher längst gefunden.
- **Weiter:** Abgegeben → Ausgang `knapp`

**Ziele**

- Nach Hafen Lichtkordon springen

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Hafen Lichtkordon. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s)* **ODA:** „Sela bekommt die Überlebenden zurück, aber nur einen Teil der Ladung. Der Rest liegt noch auf Kesh, und die Clans haben…“

## Ausgänge

### voll

*Die Überlebenden und die Ladung der Dornfink sind geborgen.*

- Belohnung: 190 Marken
- Haltung Sela (Vaelen-Händlerin): +1
- Gedächtnis Sela (Vaelen-Händlerin) (`zuflucht_auf_kesh_voll`): „Die Lerche hat meine Leute von Kesh geholt und die Ladung der Dornfink gerettet. Das vergesse ich nicht.“
- Chronik: „Zuflucht auf Kesh: Die Lerche fand einen Verletzten der Dornfink im Gelände und barg die verstreute Ladung vor einem Germanentrupp.“

### knapp

*Die Überlebenden sind gerettet, aber ein Teil der Ladung blieb auf Kesh.*

- Belohnung: 190 Marken
- Haltung Sela (Vaelen-Händlerin): +1
- Gedächtnis Sela (Vaelen-Händlerin) (`zuflucht_auf_kesh_knapp`): „Die Lerche hat meine Leute von Kesh geholt. Die Ladung ist zum Teil verloren, aber Menschen sind mir wichtiger.“
- Chronik: „Zuflucht auf Kesh: Die Lerche rettete die Besatzung der Dornfink, ein Teil der Ladung blieb auf Kesh liegen.“
- Fakt `dornfink_ladung_kesh` (offener Faden): „Ein Teil der Ladung der Dornfink liegt noch auf Kesh, ein Germanentrupp streift dort umher.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 'zk_suche_gerettet' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'zk_suche_selbst' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'zk_fracht_genug' wird gesetzt, aber in diesem Buch nie gelesen

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
