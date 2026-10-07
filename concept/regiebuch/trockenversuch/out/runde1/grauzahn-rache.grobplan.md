# Zahltag im Splitter

**Auftraggeber:** sela · **Ziel:** 12 min · **Szenen:** 5

**Aufhänger:** Sela meldet per Funk: Grauzahn-Jäger blockieren ihre Karawane im Splittergürtel und verlangen Wegezoll – sie nennt die Lerche als Schwachpunkt. Die Crew soll sie raushauen, bevor Grauzahn seinen Plan durchzieht.

**Erinnerung aus dem Weltstand:** Grauzahn erinnert sich: Im Nebel hat ihn die Lerche mit einem Konkordat-Bluff kaltgestellt. Er hat das gespeichert und will es diesmal nicht auf Kraft ankommen lassen – er hat eine Falle vorbereitet.

## Szenen

### 1. hafen_auftrag (hafen, hafen, ~2 min)

Selas Notruf annehmen, Lage einschätzen, Marken für Ausrüstung ausgeben

- Pilot: Kurs auf Splittergürtel berechnen
- Taktik: Funkbericht von Sela auswerten, Gegneraufstellung schätzen
- Captain: Entscheiden ob Konkordat informiert wird
- Außenteam: –
- Weiter: Auftrag angenommen → flug_splitter

### 2. flug_splitter (flug, splitter, ~2 min)

Splittergürtel durchqueren und Selas Position erreichen, erstem Hindernis ausweichen

- Pilot: Asteroidenfeld navigieren, Ausweichkurs
- Taktik: Versteckten Pylon aufspüren
- Captain: Crew koordinieren bei Systemstress
- Außenteam: –
- Gegner: pylon
- **Wendung:** Pylon war getarnt – Ankündigung: Energiepuls auf Kurzstrecke erkennbar, bevor er feuert
- Weiter: Pylon ausgeschaltet oder umflogen → hinterhalt

### 3. hinterhalt (raumkampf, splitter, ~4 min)

Grauzahns Hinterhalt abwehren und Selas Karawane freikämpfen

- Pilot: Jäger auf Abstand halten, Deckung im Asteroidenfeld suchen
- Taktik: Kanonenboote priorisieren, Störrelais unterdrücken
- Captain: Schadenskontrolle, Sela durch Funk beruhigen
- Außenteam: –
- Gegner: raider, raider, gunboat, relay
- **Wendung:** Grauzahn meldet sich selbst auf Funk, sobald ein Jäger fällt – Ankündigung: sein Rufzeichen blinkt auf dem Kommunikationspanel
- Weiter: Grauzahn meldet sich → funkduell · alle Gegner vernichtet ohne Funkkontakt → ausgang:sieg_ohne_dialog

### 4. funkduell (funkduell, splitter, ~2 min)

Grauzahn per Funk begegnen und den Konflikt durch Worte oder Provokation beenden

- Pilot: Lerche stabil halten während Captain spricht
- Taktik: Restgegner im Auge behalten, Eskalation melden
- Captain: Funkduell führen, Entscheidung treffen
- Außenteam: –
- Weiter: Respekt gezeigt / Angebot gemacht → rueckflug_hafen · provoziert / abgewiesen → rueckflug_hafen

### 5. rueckflug_hafen (rueckflug, hafen, ~2 min)

Mit Sela zurück in den Hafen, Belohnung und Konsequenzen abwickeln

- Pilot: Rückflug ohne weitere Zwischenfälle
- Taktik: Schäden protokollieren, Systeme stabilisieren
- Captain: Sela und Tesk Bericht erstatten
- Außenteam: –
- Weiter: Funkduell mit Respekt beendet → ausgang:waffenstillstand · Funkduell mit Provokation beendet → ausgang:feindschaft

## Entscheidungen

**Informiert die Crew das Konkordat vor dem Ausflug?** (Szene hafen_auftrag)
- *Tesk benachrichtigen* → Konkordat-Patrouille taucht im Kampf kurz auf – Grauzahn erkennt das Muster und eskaliert das Funkduell aggressiver; Tesk-Haltung +1
- *Alleine handeln* → Kein Rückenwind, aber Grauzahn ist im Funkduell überraschbarer; bei Waffenstillstand keine Konkordat-Schulden

**Wie begegnet die Crew Grauzahn auf Funk?** (Szene funkduell)
- *Den Bluff eingestehen und Respekt zollen* → Grauzahn zieht sich zurück, Haltung steigt auf -1; er erinnert sich an Ehrlichkeit
- *Ihn erneut provozieren oder abweisen* → Grauzahn schwört Rache, Haltung bleibt -2; nächste Mission mit Rostmeute wird härter

## Ausgänge

**waffenstillstand** – Rückflug nach Funkduell mit Respekt-Option
- npc_haltung grauzahn +1
- npc_gedaechtnis grauzahn: Die Lerche hat den Bluff im Nebel zugegeben. Ich nehme das zur Kenntnis.
- npc_gedaechtnis sela: Die Lerche hat mich zum zweiten Mal rausgehauen. Diese Schuld vergesse ich nicht.
- chronik: Zahltag im Splitter – Grauzahn gestellt, Sela befreit. Ein Wort zur rechten Zeit kauft mehr als Raketen.

**feindschaft** – Rückflug nach Funkduell mit Provokation
- npc_haltung grauzahn -1
- npc_gedaechtnis grauzahn: Die Lerche blufft und provoziert. Beim nächsten Mal bringe ich mehr Jäger.
- npc_gedaechtnis sela: Die Lerche hat geholfen, aber Grauzahn ist jetzt wütender als zuvor.
- chronik: Zahltag im Splitter – Sela befreit, Grauzahn gedemütigt. Der Frieden im Splitter wird rauer.

**sieg_ohne_dialog** – Alle Gegner vernichtet bevor Grauzahn sich meldet
- npc_haltung grauzahn -1
- npc_gedaechtnis grauzahn: Meine Jäger – alle weg. Die Lerche redet nicht, sie schießt. Das kostet sie noch.
- npc_gedaechtnis sela: Die Lerche hat ohne Zögern gekämpft. Ich bin am Leben.
- chronik: Zahltag im Splitter – Grauzahns Hinterhalt zerschlagen, kein Wort gewechselt. Stille vor dem nächsten Sturm.

---
*Erzeugt in v1: 48 s, 2710 Tokens, v2: 43 s, 2732 Tokens · Modell sonnet · Prüfer: gültig*