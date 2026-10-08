---
status: angenommen
quelle: archiv
erstellt: 2026-10-08
auftraggeber: sela
titel: "Karawane im Nebel"
kennung: karawane_im_nebel
---

# Karawane im Nebel

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen karawane_im_nebel`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Sela (Vaelen-Händlerin) (`sela`) |
| Quelle | archiv, Modell hand |
| Zieldauer | 15 min |
| Belohnung | 190 Marken |
| Ziel | Vaelen-Karawane |
| Szenen | 5 |

## Pitch

Lerche, hier Sela. Zwei Kapseln meiner Karawane hängen im Nebel fest, und die Rostmeute hat sie gerochen. Holt sie mir da raus – ich zahle in Marken, nicht in Versprechen.

## Erinnerung

„Sela weiß noch, wer ihren hustenden Reaktor geflickt hat. Sie fragt zuerst die Lerche.“ – Bezug: Sela (Vaelen-Händlerin) / `notruf_geholfen`

Varianten (je nach Weltstand):
- Sela (Vaelen-Händlerin) / `sonde_gefunden`: „Sela hat nicht vergessen, wer ihre verlorene Sonde im Nebel gefunden hat.“
- Sela (Vaelen-Händlerin) / `karte_gekauft`: „Sela erinnert sich an die Nebelkarte, die sie der Lerche verkauft hat – jetzt braucht sie selbst jemanden, der den Nebel kennt.“

Ohne passende Erinnerung: „Die Vaelen fragen nicht jeden um Hilfe. Dass Sela die Lerche ruft, heißt: Es eilt.“

## Szenen

### 1. kn_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 1 min
- **Sachverhalt:** Sela funkt in den Hafen: Ein Teil ihrer Karawane steckt im Nebel, Rostmeute-Jäger kreisen schon.
- **Weiter:** Auftrag angenommen → `kn_zoll`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Sela (Vaelen-Händlerin):** „Lerche, hier Sela. Zwei Kapseln meiner Karawane hängen im Nebel fest, und die Rostmeute hat sie gerochen. Holt sie mir da raus – ich zahle in Marken, nicht in Versprechen.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. kn_zoll – Vaelen-Karawane

- **Szenentyp:** begegnung · **Baustein:** `verhandeln/funkduell` · **Fassung:** archiv · **Plan:** 2 min
- **Sachverhalt:** Bei der Karawane meldet sich Grauzahn: Der Nebel gehört der Rostmeute. Zahlt die Lerche für Sela vierzig Marken, schickt er nur einen Jäger – sonst kommt er mit allem.
- **Weiter:** Zahlen → `kn_geleit_ruhig`; Ablehnen oder Schweigen → `kn_geleit_hart`

**Entscheidung:** Zahlt die Lerche Grauzahn vierzig Marken für einen ruhigeren Nebel?

- Vierzig Marken zahlen → Nur einzelne Jäger im Nebel; Grauzahn wird umgänglicher, Sela sieht, dass die Lerche für sie zahlt.
- Ablehnen (oder schweigen) → Jäger und Kanonenboot greifen die Kapseln an; Grauzahn wird gereizt.

**Ziele**

- Nach Vaelen-Karawane springen
- Captain: antworten (Funk)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Vaelen-Karawane. Steuer: Ziel wählen, F für den Faltsprung.“
- **Funk – Grauzahn (Rostmeute):** „Lerche, der Nebel gehört der Rostmeute. Vierzig Marken für Selas Kapseln, und ich schicke nur einen Jäger zum Gucken. Sonst komme ich selbst.“
- **Entscheidung** `kn_zoll_wahl`: „Vierzig Marken an Grauzahn zahlen?“
  - Option `a`: „Vierzig Marken. Und ihr haltet Abstand.“
    - Zahlung: 40 Marken
    - **Funk – Grauzahn (Rostmeute):** „Vernünftig. Ein Jäger zum Gucken – mehr nicht. Fürs Erste.“
    - **Funk – Sela (Vaelen-Händlerin):** „Ihr habt für mich gezahlt? Das schreibe ich mir auf, Lerche.“
  - Option `b`: „Der Nebel gehört niemandem. Kommt doch.“
    - **Funk – Grauzahn (Rostmeute):** „Dann sehen wir uns im Nebel. Bringt Flickblech mit.“
  - Option `schweigen`: „Funkstille“
    - **Funk – Grauzahn (Rostmeute):** „Funkstille? Ich nehme das als Nein.“
- **ODA:** „Funkspruch! Captain: Antwort im Reiter „Funk“ – sprecht euch ab.“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Schweigen ist auch eine Antwort – aber keine freundliche.“

### 3. kn_geleit_ruhig – Graue Weite

- **Szenentyp:** geleit · **Baustein:** `schuetzen/geleit_durch_angriff` · **Fassung:** archiv · **Plan:** 5 min
- **Sachverhalt:** Die Lerche holt die Kapseln aus dem Nebel. Grauzahn hält Wort – halb: Ein einzelner Jäger testet die Lerche, später noch einer.
- **Weiter:** Karawane durch → `kn_ankunft`; Karawane kampfunfähig → Ausgang `schwer_beschaedigt`

**Ziele**

- Nach Graue Weite springen
- Selas Karawane schützen – Hülle {escortHp:kn_geleit_ruhig} %

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Graue Weite. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 0.5 s)* **ODA:** „Schützling: Selas Karawane. Dranbleiben, Captain sieht Route und Befehle (Reiter „Schützling“).“
- *(nach 2 s)* **Funk – Sela (Vaelen-Händlerin):** „Lerche, wir sehen euch! Kapseln koppeln an, wir nehmen Kurs nach Osten. Bleibt dicht bei uns.“
- *(nach 30 s)* **Wendung** `kn_geleit_ruhig_angriff` – Ankündigung (vorher, 5 s Vorlauf): ODA „Ortung: Jäger halten auf Selas Karawane zu! Pilot: Breitseite zwischen sie und den Schützling.“
- *(nach 70 s, Hinweis, falls nötig)* **ODA:** „Lädt ein Gegner auf den Schützling, stellt euch dazwischen – unser Schild fängt die Ladung ab.“
- *(sobald erfüllt)* **Wendung** `kn_geleit_ruhig_verstaerkung` – Ankündigung (vorher, 8 s Vorlauf): ODA „Ortung: Verstärkung im Anflug! Schilde zur Angriffsseite, Schützling dicht halten.“
- *(sobald erfüllt)* **Wendung** `kn_geleit_ruhig_welle3` – Ankündigung (vorher, 8 s Vorlauf): ODA „Ortung: die nächste Welle hält auf Selas Karawane zu! Dazwischen bleiben.“
- *(sobald erfüllt)* **Wendung** `kn_geleit_ruhig_welle4` – Ankündigung (vorher, 8 s Vorlauf): ODA „Ortung: die nächste Welle hält auf Selas Karawane zu! Dazwischen bleiben.“
- *(sobald erfüllt)* **Funk – Sela (Vaelen-Händlerin):** „Treffer an der hinteren Kapsel! Lerche, stellt euch dazwischen!“
- *(sobald erfüllt)* **ODA:** „Notruf! Captain: Befehl „Halten“ oder „Volle Kraft“. Taktik: wer lädt, wird zuerst beschossen.“
- *(sobald erfüllt)* **ODA:** „Selas Karawane ist durch – heil. Die Angreifer drehen ab.“
- *(sobald erfüllt)* **ODA:** „Selas Karawane ist durch, aber angeschlagen. Die Angreifer drehen ab.“
- *(sobald erfüllt)* **ODA:** „Selas Karawane treibt kampfunfähig. Die Angreifer drehen ab – die Besatzung lebt.“
- *(Autolösung)* **ODA:** „Die Angreifer brechen ab. Selas Karawane gibt volle Kraft – hinterher!“

### 4. kn_geleit_hart – Graue Weite

- **Szenentyp:** geleit · **Baustein:** `schuetzen/geleit_durch_angriff` · **Fassung:** archiv · **Plan:** 6 min
- **Sachverhalt:** Grauzahn macht ernst: Jäger gehen auf die Kapseln, dann kommt ein Kanonenboot. Die Lerche muss sich dazwischenstellen.
- **Weiter:** Karawane durch → `kn_ankunft`; Karawane kampfunfähig → Ausgang `schwer_beschaedigt`

**Ziele**

- Nach Graue Weite springen
- Selas Karawane schützen – Hülle {escortHp:kn_geleit_hart} %

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Graue Weite. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 0.5 s)* **ODA:** „Schützling: Selas Karawane. Dranbleiben, Captain sieht Route und Befehle (Reiter „Schützling“).“
- *(nach 2 s)* **Funk – Sela (Vaelen-Händlerin):** „Lerche, wir sehen euch! Kapseln koppeln an. Grauzahn ist hier irgendwo – bleibt dicht bei uns.“
- *(nach 20 s)* **Wendung** `kn_geleit_hart_angriff` – Ankündigung (vorher, 5 s Vorlauf): ODA „Ortung: Jäger halten auf Selas Karawane zu! Pilot: Breitseite zwischen sie und den Schützling.“
- *(nach 70 s, Hinweis, falls nötig)* **ODA:** „Lädt ein Gegner auf den Schützling, stellt euch dazwischen – unser Schild fängt die Ladung ab.“
- *(sobald erfüllt)* **Wendung** `kn_geleit_hart_verstaerkung` – Ankündigung (vorher, 15 s Vorlauf): ODA „Ortung: Verstärkung im Anflug! Schilde zur Angriffsseite, Schützling dicht halten.“
- *(sobald erfüllt)* **Wendung** `kn_geleit_hart_welle3` – Ankündigung (vorher, 15 s Vorlauf): ODA „Ortung: die nächste Welle hält auf Selas Karawane zu! Dazwischen bleiben.“
- *(sobald erfüllt)* **Wendung** `kn_geleit_hart_welle4` – Ankündigung (vorher, 15 s Vorlauf): ODA „Ortung: die nächste Welle hält auf Selas Karawane zu! Dazwischen bleiben.“
- *(sobald erfüllt)* **Funk – Sela (Vaelen-Händlerin):** „Die Kapseln halten das nicht aus! Lerche, Breitseite – bitte!“
- *(sobald erfüllt)* **ODA:** „Notruf! Captain: Befehl „Halten“ oder „Volle Kraft“. Taktik: wer lädt, wird zuerst beschossen.“
- *(sobald erfüllt)* **ODA:** „Selas Karawane ist durch – heil. Die Angreifer drehen ab.“
- *(sobald erfüllt)* **ODA:** „Selas Karawane ist durch, aber angeschlagen. Die Angreifer drehen ab.“
- *(sobald erfüllt)* **ODA:** „Selas Karawane treibt kampfunfähig. Die Angreifer drehen ab – die Besatzung lebt.“
- *(Autolösung)* **ODA:** „Die Angreifer brechen ab. Selas Karawane gibt volle Kraft – hinterher!“

### 5. kn_ankunft – Vaelen-Karawane

- **Szenentyp:** ablieferung · **Baustein:** `ladung_liefern/im_hafen_abgeben` · **Fassung:** archiv · **Plan:** 2 min
- **Sachverhalt:** Die Kapseln sind vorausgesprungen. Bei der Karawane dockt die Lerche an, Sela rechnet ab.
- **Weiter:** angedockt → Ausgang `durchgebracht`

**Ziele**

- Nach Vaelen-Karawane springen
- Andocken und Selas Kapseln übergeben

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Vaelen-Karawane. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 1 s, bedingt)* **ODA:** „Kurs auf den Andockpunkt. Steuer: langsam ran, dann andocken.“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Andocken: nah an die Schleuse, Tempo runter, dann die Andocktaste der Steuer.“
- *(sobald erfüllt)* **Funk – Sela (Vaelen-Händlerin):** „Alle Kapseln da, alle Leute da. Hier sind eure Marken, Lerche – und ein Platz an unserem Feuer.“
- *(sobald erfüllt)* Belohnung: 110 Marken
- *(sobald erfüllt)* **Log:** „Übergabe von Selas Kapseln quittiert.“

## Ausgänge

### durchgebracht

*Die Kapseln sind aus dem Nebel heraus und Sela hat abgerechnet.*

- Belohnung: 190 Marken
- Haltung Sela (Vaelen-Händlerin): +1
- Gedächtnis Sela (Vaelen-Händlerin) (`karawane_im_nebel_durchgebracht`): „Die Lerche hat meine Kapseln aus dem Nebel geholt, als die Rostmeute schon zugriff.“
- Gedächtnis Grauzahn (Rostmeute) (`karawane_im_nebel_durchgebracht`): „Die Lerche hat Selas Kapseln durch meinen Nebel gebracht.“
- Chronik: „Karawane im Nebel: Die Lerche geleitete zwei Vaelen-Kapseln aus dem Nebel. Sela hat bezahlt – in Marken, nicht in Versprechen.“

### schwer_beschaedigt

*Die Kapseln treiben kampfunfähig im Nebel; die Rostmeute zieht mit Beute ab, die Besatzung lebt.*

- Belohnung: 190 Marken
- Haltung Sela (Vaelen-Händlerin): -1
- Gedächtnis Sela (Vaelen-Händlerin) (`karawane_im_nebel_schwer_beschaedigt`): „Die Lerche war da, aber meine Kapseln sind im Nebel liegen geblieben. Die Besatzung lebt – immerhin.“
- Gedächtnis Grauzahn (Rostmeute) (`karawane_im_nebel_schwer_beschaedigt`): „Selas Kapseln treiben in meinem Nebel. Die Lerche konnte sie nicht schützen.“
- Chronik: „Karawane im Nebel: Zwei Vaelen-Kapseln blieben schwer beschädigt im Nebel liegen. Die Rostmeute hat sich bedient.“
- Fakt `vaelen_kapseln` (offener Faden): „Zwei beschädigte Vaelen-Kapseln treiben im Nebel.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 'kn_geleit_ruhig_heil' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'kn_geleit_ruhig_beschaedigt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'kn_geleit_hart_heil' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 'kn_geleit_hart_beschaedigt' wird gesetzt, aber in diesem Buch nie gelesen

## Gespielt

Noch nicht gespielt.

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._
