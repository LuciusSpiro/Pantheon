# Was der Nebel verschluckt hat

**Auftraggeber:** sela · **Ziel:** 12 min · **Szenen:** 6

**Aufhänger:** Sela hat vor Wochen eine Messsonde im Nebel verloren, die vertrauliche Vaelen-Handelsdaten trägt. Sie beauftragt die Lerche, die Sonde zu orten und zu bergen – bevor jemand anderes die Daten liest.

**Erinnerung aus dem Weltstand:** Sela erinnert sich, dass die Lerche ihre verlorene Messsonde schon einmal gefunden hat und fair damit umgegangen ist.

## Szenen

### 1. hafen_auftrag (hafen, hafen, ~2 min)

Auftrag von Sela annehmen und Sprungziel festlegen.

- Pilot: –
- Taktik: –
- Captain: Funk annehmen, Entscheidung treffen, Sprungziel auf der Sternkarte setzen
- Außenteam: –
- Weiter: Auftrag angenommen → flug_nebel

### 2. flug_nebel (flug, nebel, ~3 min)

Durch den Splittergürtel in die Graue Weite fliegen.

- Pilot: Faltsprung hafen → splitter → nebel, Tempostufen halten
- Taktik: Weitscan unterwegs aktivieren
- Captain: Sprungziele bestätigen, Energie verteilen
- Außenteam: –
- Gegner: raider
- **Wendung:** Kurz vor dem Nebel taucht ein einzelner Raider auf – Ankündigung durch Taktik-Scan.
- Weiter: Raider abgewehrt oder abgehängt → nebel_scan

### 3. nebel_scan (scan, nebel, ~2 min)

Selas Sonde im Nebel orten und dabei prüfen, was sonst noch treibt.

- Pilot: Nah an verdächtige Signaturen heranfliegen, Bergungskisten einsammeln
- Taktik: Weitscan und Ziel-Scan auf Fundobjekte, Marker setzen
- Captain: Hauptobjekt scannen, Funk zu Sela halten
- Außenteam: –
- Weiter: Sonde geortet → wrack_entscheid

### 4. wrack_entscheid (bergung, wrack, ~2 min)

Sonde einholen; dabei entscheiden, ob die gestrandeten Plünderer-Überlebenden im Wrack mit geborgen werden.

- Pilot: Bergungskiste mit Sonde einsammeln, nah am Wrack positionieren
- Taktik: Ziel-Scan auf das Wrack, Weitscan auf weitere Funde
- Captain: Entscheidung treffen, Funk zur Besatzung des Wracks
- Außenteam: –
- **Wendung:** Der Scan zeigt: Im Wrack sitzen Überlebende – mit Rostmeute-Markierungen.
- Weiter: Überlebende geborgen → rueck_hafen_mit · Überlebende zurückgelassen → rueck_hafen_ohne

### 5. rueck_hafen_mit (rueckflug, hafen, ~2 min)

Mit Sonde und Rostmeute-Überlebenden zurück in den Hafen fliegen.

- Pilot: Faltsprung wrack → splitter → hafen, andocken
- Taktik: –
- Captain: Sprungziele bestätigen, Funk an Tesk vorab
- Außenteam: –
- Weiter: Angedockt mit Überlebenden → ausgang:sonde_fair

### 6. rueck_hafen_ohne (rueckflug, hafen, ~1 min)

Mit der Sonde allein zurück in den Hafen fliegen.

- Pilot: Faltsprung wrack → splitter → hafen, andocken
- Taktik: –
- Captain: Sprungziele bestätigen, Funk an Sela
- Außenteam: –
- Weiter: Angedockt ohne Überlebende → ausgang:sonde_schnell

## Entscheidungen

**Die Überlebenden im Wrack tragen Rostmeute-Zeichen – bergen oder zurücklassen?** (Szene wrack_entscheid)
- *Bergen und im Hafen abliefern* → Zeitverlust, Tesk muss die Lage klären; Grauzahn erfährt, dass die Lerche seine Leute gerettet hat
- *Zurücklassen, nur die Sonde nehmen* → Schnelle Rückkehr, aber Sela ist reserviert; die Überlebenden kommen irgendwann zu Grauzahn

## Ausgänge

**sonde_fair** – Crew landet mit Sonde und Überlebenden im Hafen
- npc_haltung sela +1
- npc_gedaechtnis sela: Die Lerche hat meine Sonde geborgen und Gestrandete mitgenommen, obwohl es Rostmeute waren.
- npc_haltung tesk -0
- npc_gedaechtnis tesk: Die Lerche hat Rostmeute-Überlebende in den Hafen gebracht – das macht Arbeit, zeigt aber Urteilsvermögen.
- npc_haltung grauzahn +1
- npc_gedaechtnis grauzahn: Meine Leute sagen, die Lerche hat sie aus dem Wrack geholt. Das vergesse ich nicht.
- chronik: Selas Sonde geborgen. Rostmeute-Überlebende aus dem Wrack im Nebel in den Hafen gebracht.

**sonde_schnell** – Crew landet mit Sonde, ohne Überlebende, im Hafen
- npc_haltung sela +0
- npc_gedaechtnis sela: Die Lerche hat meine Sonde geliefert, aber die Gestrandeten im Wrack einfach sitzen lassen.
- npc_haltung grauzahn -1
- npc_gedaechtnis grauzahn: Meine Leute haben im Wrack gewartet – die Lerche ist vorbeigezogen und hat sie nicht rausgeholt.
- chronik: Selas Sonde aus dem Nebel geborgen. Überlebende im Wrack zurückgelassen.

---
*Erzeugt in v1: 42 s, 2530 Tokens · Modell sonnet · Prüfer: gültig*