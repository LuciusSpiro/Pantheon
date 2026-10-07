# Was die Tafel verschweigt

**Auftraggeber:** melk · **Ziel:** 15 min · **Szenen:** 5

**Aufhänger:** Archivarin Melk hat in der Tafel von Kesh eine Koordinate entdeckt, die zu keinem bekannten Ort passt – nur das Wrack liegt auf dem Schnittpunkt. Die Crew soll das Wrack durchsuchen, bevor jemand anderes die Tafel liest.

**Erinnerung aus dem Weltstand:** Melk erinnert sich: Der Datenkern von B-7 liegt im Archiv. Gebracht hat ihn die Lerche – deshalb vertraut sie der Crew mit dem, was die Tafel verrät.

## Szenen

### 1. hafen_briefing (hafen, hafen, ~2 min)

Melk erteilt den Auftrag und gibt eine Koordinate aus der Tafel weiter.

- Pilot: Kurs zum Wrack vorberechnen, Schiff startklar melden
- Taktik: Melks Hinweise auf mögliche Bewachung einschätzen
- Captain: Entscheidung: Selas Karawane als Zwischenstopp anfragen oder direkt zum Wrack
- Außenteam: –
- Weiter: Sela anfragen → vaelen_stopp · direkt zum Wrack → splitter_flug

### 2. vaelen_stopp (scan, vaelen, ~2 min)

Sela hat die Region gescannt und kann eine Warnung oder einen Fundfragment weitergeben.

- Pilot: Andockmanöver an die Karawane
- Taktik: Selas Scandaten auswerten, Bedrohungslage einschätzen
- Captain: Handel mit Sela: Information gegen Marks oder Gegendienst
- Außenteam: –
- Weiter: immer → splitter_flug

### 3. splitter_flug (raumkampf, splitter, ~3 min)

Rostmeute-Posten blockiert den Weg zum Wrack – Grauzahn hat die Koordinate auch.

- Pilot: Ausweichkurs durch den Asteroidengürtel halten
- Taktik: Raider und Relay ausschalten
- Captain: Funkduell: Grauzahn warnt die Crew, die Tafel sei sein Eigentum
- Außenteam: –
- Gegner: raider, relay
- **Wendung:** Grauzahn kündigt Verstärkung an, falls die Crew weiterfliegt – Entscheidung unter Druck.
- Weiter: Gegner besiegt oder durchgebrochen → wrack_aussen

### 4. wrack_aussen (aussenmission, wrack / wreck, ~5 min)

Das Außenteam durchsucht das Wrack nach dem Kustoden-Objekt; der Captain koordiniert oben und sieht Zusammenhänge, die unten fehlen.

- Pilot: Schiff in Position halten, Systemschäden aus dem Kampf beheben
- Taktik: Plünderer auf der Karte bekämpfen, Außenteam sichern
- Captain: Schiffskonsole: Grundriss-Fragmente aus dem Datenkern deuten, dem Außenteam fehlende Wege ansagen
- Außenteam: Räume durchsuchen, Objekte aktivieren, Kustoden-Fund sichern
- Gegner: plunderer
- **Wendung:** Ein zweiter Trupp Plünderer erscheint, wenn der Fund fast gesichert ist – angekündigt durch Funkreiß.
- Weiter: Fund gesichert, Team zurück → rueckflug_hafen · Team zu lange draußen, zweiter Trupp nicht aufzuhalten → rueckflug_hafen

### 5. rueckflug_hafen (rueckflug, hafen, ~3 min)

Sicher zurück zu Melk, Fund übergeben, Grauzahns Reaktion abwarten.

- Pilot: Rückflug durch den Splittergürtel ohne weiteren Kampf navigieren
- Taktik: Systemschäden prüfen und melden
- Captain: Melk per Funk vorwarnen, Entscheidung über den Fund
- Außenteam: –
- Weiter: Fund an Melk → ausgang:melk_bekommt_fund · Fund behalten oder an Sela → ausgang:crew_behaelt_fund

## Entscheidungen

**Grauzahn fordert, die Crew solle umkehren – sonst erklärt er sie zur Feind.** (Szene splitter_flug)
- *Weiterfliegen, Drohung ignorieren* → Grauzahn schickt Verstärkung zur Wrack-Szene; npc_haltung grauzahn -1
- *Kurz verhandeln: Grauzahn bekommt Marken* → Verstärkung bleibt aus; pay_marks 40; npc_haltung grauzahn +1

**Was passiert mit dem Kustoden-Objekt aus dem Wrack?** (Szene rueckflug_hafen)
- *An Melk und das Konkordat-Archiv übergeben* → npc_haltung melk +1; Konkordat kennt jetzt ein weiteres Kustoden-Fragment
- *Objekt an Bord behalten oder Sela anbieten* → npc_haltung melk -1; npc_haltung sela +1; Konkordat weiß nicht, was gefunden wurde

## Ausgänge

**melk_bekommt_fund** – Fund an Melk übergeben
- npc_haltung melk +1
- npc_gedaechtnis melk: Das Kustoden-Objekt aus dem Wrack liegt jetzt im Konkordat-Archiv. Die Crew der Lerche hat es gebracht.
- chronik: Was die Tafel verschweigt – Das Wrack barg ein Kustoden-Fragment. Melk nimmt es ins Archiv. Das Relais-Rätsel vertieft sich.
- welt_fakt: kustoden_wrack_fund=konkordat_archiv

**crew_behaelt_fund** – Fund nicht an Melk
- npc_haltung melk -1
- npc_haltung sela +1
- npc_gedaechtnis melk: Die Crew hat mir nicht gesagt, was sie im Wrack gefunden hat. Ich vertraue ihr weniger.
- chronik: Was die Tafel verschweigt – Das Wrack barg ein Kustoden-Fragment. Die Crew behält es für sich. Melk ahnt, dass etwas fehlt.
- welt_fakt: kustoden_wrack_fund=lerche

**grauzahn_eskaliert** – Crew hat Grauzahn ignoriert und Verstärkung war zu stark für die Rückkehr
- npc_haltung grauzahn -1
- npc_gedaechtnis grauzahn: Die Lerche hat meine Warnung missachtet und das Wrack geplündert. Das bleibt nicht ohne Folgen.
- chronik: Was die Tafel verschweigt – Grauzahn zieht die Lerche als Feindin. Die Rostmeute hat jetzt ein Ziel.
- welt_fakt: rostmeute_feindschaft=lerche_bestaetigt

---
*Erzeugt in v1: 49 s, 2794 Tokens · Modell sonnet · Prüfer: gültig*