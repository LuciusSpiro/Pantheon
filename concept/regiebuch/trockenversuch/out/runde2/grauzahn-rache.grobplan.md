# Kein Bluff diesmal

**Auftraggeber:** sela · **Ziel:** 12 min · **Szenen:** 5

**Aufhänger:** Sela empfängt ein verschlüsseltes Vaelen-Signal: Grauzahn hat eine ihrer Handelsrouten blockiert und lässt ausrichten, die Lerche soll vorbeikommen – allein. Die Crew ahnt, dass es eine Falle ist.

**Erinnerung aus dem Weltstand:** Grauzahn erinnert sich: Im Nebel hat die Lerche ihn mit einem Konkordat-Bluff ausmanövriert. Das merkt er sich – und er will die Crew diesmal ohne Ausweg stellen.

## Szenen

### 1. auftrag (hafen, hafen, ~2 min)

Sela kontaktiert die Crew und erteilt den Auftrag; Tesk warnt vor Grauzahns Präsenz im Splittergürtel.

- Pilot: –
- Taktik: –
- Captain: Funk annehmen (Sela, dann Tesk), Sprungziel auf der Sternkarte wählen
- Außenteam: –
- Weiter: Auftrag angenommen → flug_splitter

### 2. flug_splitter (flug, splitter, ~2 min)

Die Lerche springt in den Splittergürtel und fährt auf Selas Signal zu.

- Pilot: Faltsprung nach splitter, Kurs halten
- Taktik: Weitscan (Funde aufdecken, Lage sondieren)
- Captain: Funk lauschen, Energie verteilen
- Außenteam: –
- **Wendung:** Kurz vor dem Ziel meldet sich Grauzahn per Funk: Er hat Selas Schiff als Köder benutzt – und zwei Jäger lauern bereits im Asteroid-Schatten.
- Weiter: Wendung ausgelöst → hinterhalt

### 3. hinterhalt (raumkampf, splitter, ~4 min)

Die Lerche kämpft sich durch Grauzahns Hinterhalt und hält das Schiff kampffähig.

- Pilot: Ausweichen, Breitseite drehen, Asteroidendeckung nutzen
- Taktik: Jäger mit Lanze und Batterien abschießen, Ziel-Scan auf Kanonenboot
- Captain: Schilde verteilen, Schadensplan koordinieren, Feuer/Lecks einteilen
- Außenteam: –
- Gegner: raider, raider, gunboat
- Weiter: Alle Gegner ausgeschaltet → funkduell · Schwere Schäden, Jäger noch aktiv → funkduell

### 4. funkduell (funkduell, splitter, ~2 min)

Grauzahn meldet sich persönlich – er bietet der Crew einen Handel an oder eskaliert den Konflikt.

- Pilot: –
- Taktik: –
- Captain: Funk annehmen, Entscheidung treffen (Entgegenkommen oder Konfrontation)
- Außenteam: –
- Weiter: Entgegenkommen gewählt → ausgang:einigung · Konfrontation gewählt → rueckflug_konfrontation

### 5. rueckflug_konfrontation (rueckflug, hafen, ~2 min)

Die Lerche flieht vor Grauzahns Nachhut und kehrt mit Selas befreitem Schiff in den Hafen zurück.

- Pilot: Faltsprung nach hafen, Ausweichen
- Taktik: Nachhut-Jäger abwehren
- Captain: Schilde halten, andocken
- Außenteam: –
- Gegner: raider
- Weiter: Heil angekommen → ausgang:eskalation · Schiff beschädigt angekommen → ausgang:pyrrhus

## Entscheidungen

**Grauzahn bietet an: Die Lerche zahlt einmalig 80 Marken als 'Ehrenschuld' für den Bluff – dann ist die Sache vergessen. Oder die Crew weist ihn ab.** (Szene funkduell)
- *Zahlen und den Frieden kaufen* → Grauzahns Haltung steigt auf -1; die Crew verliert 80 Marken, kehrt ohne weiteren Kampf zurück.
- *Ablehnen und die Lerche durchdrücken* → Grauzahns Haltung bleibt bei -2; Nachhut verfolgt die Lerche; Sela erhält eine Belohnung für die Befreiung.

## Ausgänge

**einigung** – Crew zahlt 80 Marken im Funkduell
- npc_haltung grauzahn +1
- npc_gedaechtnis grauzahn: Die Lerche hat die Ehrenschuld für den Nebelbluff bezahlt. Ich lasse sie vorerst in Ruhe.
- npc_gedaechtnis sela: Die Lerche hat mein Schiff aus Grauzahns Falle befreit und den Konflikt ohne weiteres Blutvergießen beendet.
- npc_haltung sela +1
- chronik: Kein Bluff diesmal – die Lerche kauft sich mit 80 Marken Grauzahns Waffenstillstand.

**eskalation** – Crew lehnt ab und kehrt heil zurück
- npc_gedaechtnis grauzahn: Die Lerche hat mein Angebot abgelehnt und sich durchgekämpft. Die Rechnung bleibt offen.
- npc_gedaechtnis sela: Die Lerche hat mein Schiff befreit und Grauzahn die Stirn geboten. Ich schulde ihr.
- npc_haltung sela +1
- chronik: Kein Bluff diesmal – die Lerche kämpft sich durch Grauzahns Hinterhalt und lehnt seinen Handel ab. Der Konflikt schwelt weiter.

**pyrrhus** – Crew lehnt ab, kehrt mit Schaden zurück
- npc_gedaechtnis grauzahn: Die Lerche hat mein Angebot abgelehnt und Federn gelassen. Vielleicht lernt sie noch.
- npc_gedaechtnis sela: Die Lerche hat mich befreit, aber teuer bezahlt. Ich werde ihr helfen, wenn ich kann.
- npc_haltung sela +1
- chronik: Kein Bluff diesmal – die Lerche kämpft sich durch, trägt Schaden davon und lässt Grauzahns Rechnung offen.

---
*Erzeugt in v1: 43 s, 2539 Tokens · Modell sonnet · Prüfer: gültig*