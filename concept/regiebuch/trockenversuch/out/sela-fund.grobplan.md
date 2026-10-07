# Was die Strömung trägt

**Auftraggeber:** sela · **Ziel:** 12 min · **Szenen:** 5

**Aufhänger:** Sela hat im Nebel einen alten Vaelen-Lieferzug vermisst – ihre Gilde wartet auf die Ladung. Sie vertraut der Lerche, weil die Crew schon einmal für sie da war.

**Erinnerung aus dem Weltstand:** Sela erinnert sich, dass die Lerche auf ihren Notruf geantwortet und den Reaktor geflickt hat – sie zahlt jetzt die Schuld zurück, indem sie einen fairen Auftrag gibt statt zu betteln.

## Szenen

### 1. D1 Hafen – Hafen Lichtkordon, ~2 min

Sela tritt an die Lerche heran: Ein Vaelen-Lieferzug ist im Nebel ausgeblieben; sie vermutet Triebwerksausfall und treibende Fracht. Sie bittet die Crew, die Ladung zu orten und zu bergen – und wenn ein anderes Schiff vor Ort ist, fair zu teilen.

**Weiter:** Auftrag angenommen → nebel_scan

### 2. A2 Annäherung & Erkundung – Graue Weite, ~4 min

*Signal per Weitscan finden*

Die Graue Weite schirmt alle Signale ab. Taktik und Pilot müssen das Treibgut des Lieferzugs durch systematisches Pingen ausfindig machen – irgendwo zwischen den Nebelströmungen liegt die verlorene Fracht.

**Wendung:** Ankündigung: Beim zweiten erfolgreichen Ping taucht ein zweites Funksignal auf – ein unbekanntes Schiff nähert sich denselben Koordinaten.

**Weiter:** Fracht geortet, fremdes Schiff noch entfernt → begegnung_fracht · Fracht geortet, fremdes Schiff schon nah → begegnung_fracht

### 3. A3 Begegnung – Graue Weite, ~2 min

*Funkduell mit zwei Antworten und Schweigen*

Ein kleines Bergungsboot – Kennung unbekannt, Besatzung: Einzelperson – funkt die Lerche an: Die Person hat die Fracht zuerst geortet und beansprucht Bergerecht. Der Captain muss entscheiden.

**Weiter:** Einigung auf Teilung → bergung_gemeinsam · Lerche besteht auf Alleinberge → bergung_allein · Lerche gibt nach und lässt alles → ausgang:fracht_verloren

### 4. A11 Bergung im All – Graue Weite, ~3 min

*Bergungsgut im Feld einsammeln*

Lerche und das Bergungsboot arbeiten zusammen: Die Kisten treiben verstreut im Nebelfeld, der Pilot fliegt Kurs auf Kurs, Taktik lotst. Das Bergungsboot sammelt die Hälfte ein – was bleibt, gehört Sela.

**Weiter:** Bergung abgeschlossen → ausgang:auftrag_geteilt

### 5. A11 Bergung im All – Graue Weite, ~3 min

*Bergungsgut im Feld einsammeln*

Die Lerche beansprucht die gesamte Fracht; das Bergungsboot zieht sich zurück – aber der Captain weiß, dass die Person leer ausgeht. Die Kisten treiben weit gestreut, Taktik und Pilot kämpfen gegen Nebelströmungen.

**Weiter:** Bergung abgeschlossen → ausgang:auftrag_voll

## Entscheidungen

**Das Bergungsboot hat Bergerecht – teilt die Crew fair, oder besteht sie auf die gesamte Ladung für Sela?** (Szene begegnung_fracht)
- *Hälfte-Hälfte anbieten* → Bergung schneller, weniger Marken, aber Sela und Vaelen-Gilde reagieren positiv auf faire Haltung
- *Alleinberge bestehen* → Volle Ladung, mehr Marken, aber fremder Bergungsmann geht leer aus – spürbar in Weltfakt

## Ausgänge

**auftrag_geteilt** – Bergung abgeschlossen, Fracht geteilt
- npc_haltung sela +1
- npc_gedaechtnis sela: Die Lerche hat fair geteilt, obwohl sie nicht musste – das ist Vaelen-Art.
- chronik: Selas Drift – Die Crew findet den vermissten Lieferzug im Nebel und teilt die Bergung fair mit einem unbekannten Bergungsmann.
- welt_fakt bergungsmann_nebel: Ein unbekannter Einzelbergungsmann operiert in der Grauen Weite; die Lerche hat ihn fair behandelt.

**auftrag_voll** – Bergung abgeschlossen, Lerche hat alles
- npc_haltung sela +1
- npc_gedaechtnis sela: Die Lerche hat die volle Ladung geholt – aber ich habe gehört, dass jemand leer ausging.
- chronik: Selas Drift – Die Crew findet den Lieferzug und sichert die gesamte Ladung für Sela; ein fremder Bergungsmann geht leer aus.
- welt_fakt bergungsmann_nebel: Ein unbekannter Einzelbergungsmann operiert in der Grauen Weite; die Lerche hat ihm das Bergerecht verweigert.

**fracht_verloren** – Crew überlässt die gesamte Fracht dem Bergungsmann
- npc_haltung sela -1
- npc_gedaechtnis sela: Die Lerche hat mir meine Ladung nicht geholt – ich verstehe es nicht.
- chronik: Selas Drift – Die Crew findet den Lieferzug, überlässt die Fracht aber einem fremden Bergungsmann vollständig.
- welt_fakt bergungsmann_nebel: Ein unbekannter Einzelbergungsmann hat im Nebel eine Vaelen-Ladung geborgen, nachdem die Lerche verzichtete.

---
*Erzeugt in v1: 43 s, 2300 Tokens · Modell sonnet · Prüfer: gültig*