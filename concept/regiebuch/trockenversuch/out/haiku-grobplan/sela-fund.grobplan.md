# Selas verlorene Ladung

**Auftraggeber:** sela · **Ziel:** 12 min · **Szenen:** 4

**Aufhänger:** Sela hat eine Frachtlieferung für die Vaelen verloren – irgendwo im Splittergürtel treiben ihre Kisten. Die Lerche soll suchen und bergen, bevor andere sie finden.

**Erinnerung aus dem Weltstand:** Sela verdankt der Crew noch immer ihre Rettung und die gefundene Messsonde. Jetzt kann sie sie um einen echten Gefallen bitten.

## Szenen

### 1. D1 Hafen – Hafen Lichtkordon, ~2 min

*Funkduell mit zwei Antworten und Schweigen*

Sela funkt vom Hafen: Ihre Frachtboxen sind beim Sprung verloren gegangen, treiben irgendwo im Splittergürtel. Sie bietet Lohn an, braucht aber Eile – auch ein altes Wrack liegt dort, möglicherweise aus ihrer Familie.

**Wendung:** Sela erwähnt, dass die Rostmeute in der Gegend war.

**Weiter:** immer → sz_splitter_scan

### 2. A2 Annäherung & Erkundung – Splittergürtel, ~2 min

*Signal per Weitscan finden*

Im Splittergürtel angekommen: Der Pilot steuert durch Asteroiden, während die Taktik mit dem Weitscan nach Selas Boxen sucht. Ein Tracker-Ping führt zum Ort der Ladung – und zeigt auch Wrackteile in der Nähe.

**Wendung:** Der Scan zeigt: Neben Selas Kisten liegt auch ein altes Vaelen-Schiff in Trümmern – möglicherweise von Selas Familie. Zeit ist knapp.

**Weiter:** immer → sz_entscheidung

### 3. A11 Bergung im All – Splittergürtel, ~4 min

*Bergungsgut im Feld einsammeln*

Die Crew muss sich entscheiden: Nur Selas Frachtboxen einsammeln und Zeit sparen, oder auch Zeit für das Wrack aufwenden. Pilot und Taktik arbeiten zusammen – Taktik markiert grüne Ziele, Pilot fliegt drüber, jeder Treffer zählt. Asteroiden-Rempler kosten Schild.

**Wendung:** Nach dem dritten Box oder nach dem Wrack-Versuch: Ein Jäger taucht auf – Rostmeute oder Konkurrenz hat die Ladung gerochen.

**Weiter:** nur_fracht → sz_jagd · fracht_und_wrack → sz_jagd

### 4. A4 Raumgefecht – Splittergürtel, ~3 min

*Angriffswelle mit Verstärkung*

Ein bis zwei Jäger greifen an. Kurzes Gefecht über den Asteroiden. Schilde, Ausweichen, Breitseiten – die Lerche kann sich behaupten und muss nur zum Hafen zurück.

**Weiter:** nur_fracht → ausgang:erfolg · fracht_und_wrack → ausgang:dankbarkeit

## Entscheidungen

**Das alte Wrack könnte von Selas Familie sein – Zeit für es aufwenden, oder schnell nur die Fracht laden?** (Szene sz_entscheidung)
- *Nur Selas Fracht laden.* → Schnellerer Ablauf, weniger Schild-Verschleiß, aber Sela erfährt von ihrer verlorenen Familie und wird nachdenklich. Haltung steigt, aber bittersweet.
- *Fracht und Wrack laden.* → Höherer Schild-Verschleiß, intensiveres Gefecht danach, aber Selas tiefe Dankbarkeit. Sie weiß, dass die Crew ihre Familie geachtet hat.

## Ausgänge

**erfolg** – Jäger besiegt, nur Selas Fracht im Hafen, Crew unverletzt.
- npc_haltung sela +1
- welt_fakt selas_ladung: geborgen
- chronik Selas Fracht aus dem Splitter geholt, Familie bleibt vergessen

**dankbarkeit** – Jäger besiegt, Fracht und Wrack sicher im Hafen, Crew unverletzt.
- npc_haltung sela +2
- welt_fakt selas_familienboot: zur_karawane_zurueck
- chronik Selas Fracht und Familienboot aus dem Splitter geholt – eine Schuld wurde bezahlt

**rueckzug** – Gefecht wird zu heiß; Crew fliegt ohne alle Kisten zurück.
- npc_haltung sela 0
- welt_fakt selas_ladung: verloren
- chronik Splitter-Mission abgebrochen, Sela muss anderswo suchen

---
*Erzeugt in v1: 30 s, 2951 Tokens, v2: 21 s, 1950 Tokens · Modell haiku · Prüfer: Ausgang 'rueckzug' wird von keiner Szene erreicht*