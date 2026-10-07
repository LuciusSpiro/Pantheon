# Was die Tafel verschweigt

**Auftraggeber:** melk · **Ziel:** 15 min · **Szenen:** 5

**Aufhänger:** Melk hat auf der Tafel von Kesh eine Koordinatenfolge entdeckt, die zu einem verborgenen Kustoden-Depot auf dem Mond führt. Die Lerche hat die Tafel gebracht – sie soll jetzt auch hineingehen.

**Erinnerung aus dem Weltstand:** melk: Die Tafel von Kesh liegt jetzt im Konkordat-Archiv. Gebracht hat sie die Crew der Lerche.

## Szenen

### 1. hafen_auftrag (hafen, hafen, ~2 min)

Melk erteilt den Auftrag und teilt eine Codetabelle aus der Tafel mit.

- Pilot: –
- Taktik: –
- Captain: Funk annehmen, Entscheidung treffen: Codetabelle mitnehmen oder Tesk informieren.
- Außenteam: –
- **Wendung:** null
- Weiter: Auftrag angenommen → flug_kesh

### 2. flug_kesh (flug, kesh, ~4 min)

Anflug auf Kesh; Rostmeute-Jäger schneiden den Weg ab.

- Pilot: Faltsprung zu kesh, ausweichen.
- Taktik: Lanze und Batterien feuern, Ziel-Scan.
- Captain: Energie und Schilde verteilen, Sprungziel wählen.
- Außenteam: –
- Gegner: raider, gunboat
- **Wendung:** Während des Kampfes meldet sich ein unbekanntes Kustoden-Signal von der Oberfläche – kurz, dann Stille.
- Weiter: Gegner besiegt → kesh_aussen · Schiff schwer beschädigt → kesh_aussen

### 3. kesh_aussen (aussenmission, kesh / kesh, ~6 min)

Außenteam öffnet das Kustoden-Depot mit Schlüssel und Codetabelle, Captain koordiniert von oben.

- Pilot: nah am Orbit halten für Beamerlinie.
- Taktik: Weitscan, Orbitalschlag zur Unterstützung.
- Captain: Sensor, Befehle, Codetabelle – sieht Tresorstatus oben, gibt Wissen an Außenteam weiter.
- Außenteam: Beamen, Objekte bedienen, Schlüssel und Vault zu zweit gleichzeitig aktivieren, Gegner mit Blaster und Deckung.
- Gegner: squad1, squad2
- **Wendung:** null
- Weiter: Depot geöffnet, Fund geborgen → rueck_erfolg · Außenteam muss abgebrochen werden → rueck_teilweise

### 4. rueck_erfolg (rueckflug, hafen, ~2 min)

Rückflug zum Hafen; Melk empfängt den Fund und reagiert auf das Kustoden-Signal.

- Pilot: Faltsprung zu hafen, andocken.
- Taktik: –
- Captain: Funk an Melk, Entscheidung: Fund sofort übergeben oder erst selbst auswerten.
- Außenteam: –
- **Wendung:** null
- Weiter: Fund übergeben → ausgang:depot_konkordat · Fund zurückgehalten → ausgang:depot_crew

### 5. rueck_teilweise (rueckflug, hafen, ~1 min)

Abbruch-Rückflug; Melk erfährt, dass das Depot leer ausging.

- Pilot: Faltsprung zu hafen, andocken.
- Taktik: –
- Captain: Funk an Melk, Schadensbericht.
- Außenteam: –
- **Wendung:** null
- Weiter: immer → ausgang:depot_leer

## Entscheidungen

**Melk will, dass der Fund direkt ins Konkordat-Archiv geht – sagt die Crew zu?** (Szene hafen_auftrag)
- *Zusagen* → Melks Haltung steigt; Crew bekommt weniger Marken, dafür Zugang zum Archiv.
- *Nichts versprechen* → Crew hat freie Hand beim Rückflug, Melks Haltung bleibt neutral.

**Den Depot-Fund sofort an Melk übergeben oder erst an Bord auswerten?** (Szene rueck_erfolg)
- *Sofort übergeben* → Melks Haltung +1; Kustoden-Spur geht ins Archiv.
- *Zuerst selbst auswerten* → Crew behält Initiative; Melks Haltung -1; neuer Weltfakt.

## Ausgänge

**depot_konkordat** – Fund übergeben, Rückflug erfolgreich
- npc_haltung melk +1
- npc_gedaechtnis melk: Die Crew hat den Depot-Fund ohne Umweg ans Archiv gegeben.
- npc_gedaechtnis tesk: Das Kustoden-Depot auf Kesh ist jetzt dokumentiert – dank der Lerche.
- chronik: Was die Tafel verschweigt – Das Depot auf Kesh geöffnet, Fund ans Konkordat übergeben.
- welt_fakt: kustoden_depot_kesh=konkordat_archiv

**depot_crew** – Fund zurückgehalten, Rückflug erfolgreich
- npc_haltung melk -1
- npc_gedaechtnis melk: Die Crew hat den Depot-Fund nicht sofort herausgegeben. Ich weiß nicht, was sie damit vorhaben.
- chronik: Was die Tafel verschweigt – Das Depot auf Kesh geöffnet, Fund liegt bei der Crew der Lerche.
- welt_fakt: kustoden_depot_kesh=lerche_besitz

**depot_leer** – Außenmission abgebrochen, kein Fund
- npc_haltung melk 0
- npc_gedaechtnis melk: Die Crew musste ohne Fund abbrechen. Das Depot bleibt unbekannt.
- chronik: Was die Tafel verschweigt – Außenmission auf Kesh abgebrochen, Depot ungeklärt.
- welt_fakt: kustoden_depot_kesh=ungeklaert

---
*Erzeugt in v1: 41 s, 2498 Tokens · Modell sonnet · Prüfer: gültig*