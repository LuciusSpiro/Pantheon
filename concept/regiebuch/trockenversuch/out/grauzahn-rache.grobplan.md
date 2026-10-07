# Zahltag im Splittergürtel

**Auftraggeber:** sela · **Ziel:** 12 min · **Szenen:** 5

**Aufhänger:** Sela meldet per Funk, dass Rostmeute-Jäger ihre Karawane abschneiden – Grauzahn nutzt sie als Köder, um die Lerche aus dem Hafen zu locken. Die Crew kennt die Route, niemand sonst ist nah genug.

**Erinnerung aus dem Weltstand:** Grauzahn hat sich den Bluff im Nebel gemerkt: Die Lerche hat ihn mit einer erfundenen Konkordat-Patrouille abgespeist. Jetzt zieht er die Linie – aber er ist klug genug, ein Angebot zu machen, bevor er schießt.

## Szenen

### 1. D1 Hafen – Hafen Lichtkordon, ~1 min

Sela funkt in den Hafen: Rostmeute-Jäger umkreisen ihre Karawane im Splittergürtel, sie kann nicht springen. Sie klingt gefasst, aber knapp.

**Weiter:** immer → s2_splitter_annaeherung

### 2. A2 Annäherung & Erkundung – Splittergürtel, ~2 min

*Signal per Weitscan finden*

Im Splittergürtel empfängt die Lerche widersprüchliche Signale – Selas Karawane ist da, aber auch mehrere Rostmeute-Signale, die nicht auf der Karte stehen. Der Scan zeigt, dass es eine Falle ist.

**Wendung:** Noch während gescannt wird, funkt Grauzahn selbst – ruhig, fast amüsiert – und kündigt ein 'Gespräch' an, bevor er angreift.

**Weiter:** immer → s3_funkduell

### 3. A3 Begegnung – Splittergürtel, ~2 min

*Funkduell mit zwei Antworten und Schweigen*

Grauzahn bietet der Crew eine Wahl: die Marken, die die Lerche ihm im Nebel 'gestohlen' hat – oder er lässt Sela treiben und holt sich das Geld anders. Er ist nicht wütend, er testet.

**Weiter:** zahlen oder nachgeben → s4_gefecht_leicht · ablehnen oder bluffen → s4_gefecht_schwer

### 4. A4 Raumgefecht – Splittergürtel, ~4 min

*Angriffswelle mit Verstärkung*

Grauzahn hat ein Abkommen, aber seine Jäger greifen trotzdem an – er lässt sie eine Runde laufen, um zu sehen, wie die Lerche kämpft. Dann bricht er ab.

**Weiter:** Jäger besiegt oder Grauzahn bricht ab → ausgang:abkommen

### 5. A4 Raumgefecht – Splittergürtel, ~4 min

*Angriffswelle mit Verstärkung*

Grauzahn schickt alle Jäger auf einmal, das Kanonenboot bleibt im Hintergrund und schießt auf Sela. Die Crew muss beides gleichzeitig im Blick behalten.

**Weiter:** Sela überlebt und Jäger zurückgedrängt → ausgang:sieg · Sela schwer getroffen oder Lerche kritisch beschädigt → ausgang:pyrrhus

## Entscheidungen

**Geht die Crew auf Grauzahns Angebot ein oder lehnt sie ab?** (Szene s3_funkduell)
- *Zahlen oder eine symbolische Geste machen* → Grauzahn-Haltung steigt auf -1; Gefecht ist kürzer und endet mit Abkommen; Sela kommt unbeschädigt davon
- *Ablehnen oder erneut bluffen* → Grauzahn-Haltung bleibt -2; Gefecht ist härter; Sela gerät unter Beschuss; Sieg möglich aber teuer

## Ausgänge

**abkommen** – Die Crew hat gezahlt oder nachgegeben, das Gefecht endet vorzeitig
- npc_haltung grauzahn +1
- npc_gedaechtnis grauzahn: Die Lerche hat bezahlt. Kein Respekt, aber kein offener Krieg.
- npc_haltung sela +0
- chronik Die Lerche hat Grauzahns Forderung angenommen; Sela ist frei, aber der Preis war real.
- welt_fakt rostmeute_lerche: waffenstillstand_erkauft

**sieg** – Die Crew lehnt ab, schlägt alle Jäger zurück und hält Sela am Leben
- npc_haltung grauzahn -1
- npc_gedaechtnis grauzahn: Die Lerche kämpft. Beim nächsten Mal bringe ich mehr.
- npc_haltung sela +1
- chronik Die Lerche hat Grauzahns Hinterhalt zurückgeschlagen und Sela gerettet – aber Grauzahn ist noch da.
- welt_fakt rostmeute_lerche: offene_feindschaft_bestätigt

**pyrrhus** – Sela wird schwer getroffen oder die Lerche erleidet kritischen Schaden
- npc_haltung grauzahn -1
- npc_gedaechtnis grauzahn: Sie kämpfen, aber sie zahlen den Preis. Das merke ich mir.
- npc_haltung sela -1
- npc_gedaechtnis sela: Die Lerche hat gekämpft, aber ich bin verwundbar geworden. Ich weiß nicht, ob ich dankbar sein soll.
- chronik Grauzahns Hinterhalt hat Selas Karawane beschädigt; die Lerche hat sich durchgebissen, aber nichts gewonnen.
- welt_fakt rostmeute_lerche: offene_feindschaft_bestätigt

---
*Erzeugt in v1: 42 s, 2258 Tokens · Modell sonnet · Prüfer: gültig*