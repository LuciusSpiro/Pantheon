# Signale aus dem Schweigen

**Auftraggeber:** sela · **Ziel:** 12 min · **Szenen:** 6

**Aufhänger:** Sela hat im Nebel drei automatische Messsonden verloren – eine davon sendet noch ein schwaches Signal. Sie braucht die Daten und möglicherweise die Hardware zurück, kann aber selbst nicht fliegen.

**Erinnerung aus dem Weltstand:** Sela erinnert sich: Die Crew der Lerche hat auf meinen Notruf geantwortet und den Reaktor geflickt – und meine verlorene Messsonde gefunden. Diesmal bittet sie proaktiv.

## Szenen

### 1. hafen_auftrag (hafen, hafen, ~2 min)

Auftrag von Sela annehmen, Marken aushandeln, Route planen

- Pilot: Route durch Splittergürtel oder direkt durch Nebel wählen
- Taktik: Selas Sondenfrequenzen einlesen, Scan-Reichweite prüfen
- Captain: Preis verhandeln, Hinweis auf Dritte einholen (Sela erwähnt, dass ein Vaelen-Schüler die Sonden zuerst ausgelegt hat)
- Außenteam: –
- Weiter: Route Splittergürtel → splitter_scan · Route direkt Nebel → nebel_scan

### 2. splitter_scan (scan, splitter, ~3 min)

Erstes Sondensignal orten, dabei Raider ausweichen oder abwimmeln

- Pilot: Kurs durch Trümmerfelder halten, Raider auf Abstand
- Taktik: Weitscan auf Sonden-Frequenz, Störsignal filtern
- Captain: Raider per Funk einschüchtern oder Wegezoll-Forderung ablehnen
- Außenteam: –
- Gegner: raider
- **Wendung:** Der Raider fordert Wegezoll und droht – Ankündigung durch Funkdurchsage kurz vorher.
- Weiter: Scan erfolgreich → nebel_scan · Scan gescheitert → nebel_scan

### 3. nebel_scan (scan, nebel, ~3 min)

Drei Sondenpositionen scannen, letzte noch aktive Sonde orten

- Pilot: Nebel-Navigation, Drift korrigieren
- Taktik: Sequenz-Scan: zwei Sonden tot, dritte aktiv und driftend – Position triangulieren
- Captain: Entscheidung vorbereiten: fremdes Vaelen-Schiff nähert sich ebenfalls der Sonde
- Außenteam: –
- Weiter: Sonde geortet → entscheidung_sonde

### 4. entscheidung_sonde (bergung, nebel, ~2 min)

Aktive Sonde bergen – aber ein junger Vaelen-Händler beansprucht sie ebenfalls

- Pilot: Positionierung: wer kommt zuerst an die Sonde
- Taktik: Sonde scannen – enthält Selas Daten, aber auch Messreihen des anderen Händlers
- Captain: Verhandlung: Sonde teilen, ganz abgeben oder ganz behalten
- Außenteam: –
- Weiter: Sonde geteilt oder abgetreten → rueckflug_fair · Sonde komplett behalten → rueckflug_unfair

### 5. rueckflug_fair (rueckflug, hafen, ~2 min)

Rückflug und Abrechnung mit Sela; junger Händler dankt per Funk

- Pilot: Rückflug ohne Zwischenfall
- Taktik: Sondendaten auswerten und Bericht vorbereiten
- Captain: Sela Bericht erstatten, Belohnung einfordern
- Außenteam: –
- Weiter: immer → ausgang:fair_ende

### 6. rueckflug_unfair (rueckflug, hafen, ~2 min)

Rückflug; Sela ist zufrieden, aber der junge Händler beschwert sich im Vaelen-Netz

- Pilot: Rückflug ohne Zwischenfall
- Taktik: Sondendaten vollständig auswerten
- Captain: Sela Bericht erstatten; Gerücht über die Lerche brodelt bereits
- Außenteam: –
- Weiter: immer → ausgang:unfair_ende

## Entscheidungen

**Der junge Vaelen-Händler Voss beansprucht die Sonde: Seine Messreihen stecken ebenfalls drin. Was tut die Crew?** (Szene entscheidung_sonde)
- *Daten kopieren, Sonde an Voss abgeben, Selas Anteil mitnehmen* → Sela erhält ihre Daten, Voss dankt der Lerche; Vaelen-Ruf steigt leicht
- *Sonde vollständig bergen – Auftrag ist Auftrag* → Sela erhält volle Sonde, aber Voss meldet den Vorfall im Vaelen-Netz; Selas Haltung bleibt, Vaelen-Stimmung kippt leicht

## Ausgänge

**fair_ende** – Crew hat Sondendaten geteilt und Rückflug abgeschlossen
- npc_haltung sela +1
- npc_gedaechtnis sela: Die Lerche hat meine Sonde gefunden und fair mit Voss geteilt – das spricht sich herum.
- chronik: Signale aus dem Schweigen – Selas Messsonde geborgen, Daten fair geteilt; Vaelen-Netz spricht gut von der Lerche.
- welt_fakt vaelen_ruf: Die Lerche gilt im Vaelen-Netz als verlässlich und fair.

**unfair_ende** – Crew hat Sonde komplett behalten und Rückflug abgeschlossen
- npc_haltung sela 0
- npc_gedaechtnis sela: Die Lerche hat meine Sonde gefunden – gute Arbeit. Aber Voss ist sauer, das ist unbequem.
- chronik: Signale aus dem Schweigen – Selas Messsonde geborgen; Voss erhebt Beschwerde im Vaelen-Netz.
- welt_fakt vaelen_ruf: Unter jüngeren Vaelen-Händlern gilt die Lerche als skrupellos im Wettbewerb.

**sonde_verloren** – Scan scheitert vollständig und Sonde driftet außer Reichweite
- npc_haltung sela -1
- npc_gedaechtnis sela: Die Lerche hat meine Sonde nicht gefunden. Ich bin enttäuscht – beim Reaktor waren sie besser.
- chronik: Signale aus dem Schweigen – Selas dritte Sonde geht endgültig verloren; Auftrag nur teilweise erfüllt.
- welt_fakt nebel_sonde: Irgendwo in der Grauen Weite treibt eine aktive Vaelen-Messsonde – ungeborgen.

---
*Erzeugt in v1: 49 s, 2815 Tokens · Modell sonnet · Prüfer: gültig*