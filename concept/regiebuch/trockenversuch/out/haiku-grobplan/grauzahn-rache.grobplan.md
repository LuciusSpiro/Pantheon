# Heimzahlung

**Auftraggeber:** sela · **Ziel:** 12 min · **Szenen:** 5

**Aufhänger:** Sela ruft die Lerche in Sorge an: Ein Vaelen-Konvoi wird im Nebel von der Rostmeute abgefangen. Grauzahn persönlich führt den Angriff an – und verbreitet ein Gerücht: Die Lerche soll zahlen oder zuschauen.

**Erinnerung aus dem Weltstand:** Grauzahn erinnert sich, wie die Crew ihn im Nebel mit einer Konkordat-Patrouille geblufft hat. Jetzt will er beweisen, dass er stärker ist – oder dass die Lerche schwächer geworden.

## Szenen

### 1. D1 Hafen – Hafen Lichtkordon, ~2 min

*Funkduell mit zwei Antworten und Schweigen*

Sela funkt den Captain an: Im Nebel wird gerade ein Vaelen-Konvoi überfallen. Grauzahn blockiert die Flucht und fordert Tribut – oder ein Zeichen von der Lerche, dass sie auf seiner Seite steht.

**Wendung:** Sela nennt Namen: Die Lerche hat die Vaelen-Karawane früher geholfen. Nächstes Mal gibt es kein Geld ohne Preis.

**Weiter:** captain_entscheidung → s02_sprung_zum_nebel

### 2. A2 Annäherung & Erkundung – Graue Weite, ~3 min

*Signal per Weitscan finden*

Die Lerche springt in die Graue Weite. Der Nebel ist undurchsichtig. Irgendwo funken Vaelen-Schiffe und Grauzahns Jäger. Die Taktik muss die Kämpfer lokalisieren, bevor die erste Ladung fällt.

**Wendung:** Der Scan deckt auf: Grauzahns Jäger umzingeln ein langsames Handelsschiff. Ein zweites Vaelen-Schiff liegt bereits treibend.

**Weiter:** signal_gefunden → s03_raumgefecht

### 3. A4 Raumgefecht – Graue Weite, ~4 min

*Angriffswelle mit Verstärkung*

Grauzahns erste Welle (zwei Jäger) attackiert die Lerche auf Sicht. Das Handelsschiff feuert Notsignale ab. Wenn die Jäger nicht schnell erledigt sind, kündigt Grauzahn vom Kanonenboot aus Verstärkung an.

**Wendung:** Nach der ersten Welle funkt Grauzahn selbst: ‚Ihr seid nicht stärker geworden, Lerche. Aber dafür hat sich gelohnt, dass ich herkomme.'

**Weiter:** jaeger_erledigt → s04_funkduell_mit_grauzahn

### 4. A3 Begegnung – Graue Weite, ~2 min

*Funkduell mit zwei Antworten und Schweigen*

Grauzahns Kanonenboot hält sich Abstand. Er funkt: Die Lerche kann jetzt das Handelsschiff evakuieren und abziehen – oder sie kann für Sela kämpfen. Eine Entscheidung mit Folgen für sein Urteil über die Crew.

**Wendung:** Grauzahn nennt die Alternative: ‚Zahlt mir jetzt, was ihr mir im Nebel schuldet, und ich vergesse die Blufferei. Sonst sehe ich, was ihr wirklich wert seid.'

**Weiter:** captain_zahlt → ausgang_grauzahn_respekt · captain_kaempft → s05_entscheidung_kampf

### 5. A4 Raumgefecht – Graue Weite, ~3 min

*Angriffswelle mit Verstärkung*

Das Kanonenboot greift direkt an. Die Lerche muss durchhalten oder Grauzahns Jäger abfangen, während das Handelsschiff evakuiert wird. Taktik steuert die Rettung der Vaelen-Crew.

**Wendung:** Nach drei Runden Beschuss funkt Grauzahn: ‚Genug. Ich sehe, dass die Blufferei aus Gründen kam. Das merke ich mir anders.'

**Weiter:** sela_gerettet → ausgang_grauzahn_erkenntnis

## Entscheidungen

**Captain, Sela bittet euch um Hilfe – aber Grauzahn hat euch herausfordernd gemacht. Antworten Sie oder spulen Sie los?** (Szene s01_hafen_auftrag)
- *‚Wir kommen – sagt Grauzahn, dass wir nicht fliehen.'* → Die Lerche springt in voller Überzeugung los; Grauzahn nimmt es persönlich.
- *‚Wir kommen – aber leise. Lasst Grauzahn nicht sehen, dass wir da sind.'* → Die Lerche hofft auf einen Überraschungsvorteil; Grauzahn erwartet genau das.

**Captain, Grauzahn stellt das Ultimatum: Zahlen oder kämpfen für Sela?** (Szene s04_funkduell_mit_grauzahn)
- *‚Okay, Grauzahn. Was willst du?'* → grauzahn_haltung +1: Ein Gegner, der seinen Wert kennt, verdient Respekt. Aber die Vaelen sind verloren.
- *‚Nein. Wir bringen Selas Leute raus – dich zuerst.'* → Grauzahns Kanonenboot greift an. Die Lerche kämpft um Ehre statt Bluff.

## Ausgänge

**ausgang_grauzahn_respekt** – Captain zahlt Grauzahn im Funkduell; die Rostmeute zieht sich zurück.
- npc_haltung grauzahn 1
- npc_gedaechtnis grauzahn Die Lerche kennt ihren Wert und zahlt, wenn es sein muss. Das ist ehrenhaft.
- chronik Heimzahlung: Grauzahn fordert Tribut für den Bluff im Nebel – und bekommt ihn. Die Vaelen verlieren ihre Ladung, aber nicht ihre Schiffe.

**ausgang_grauzahn_erkenntnis** – Captain kämpft für Sela; die Lerche hält stand und rettet die Vaelen-Crew.
- npc_haltung grauzahn 0
- npc_gedaechtnis grauzahn Die Lerche hat mich ernst genommen – nicht geblufft, gekämpft. Für eine Handelsfamilie. Das ist stärker als Tribut.
- npc_gedaechtnis sela Die Lerche ist zurückgekommen und hat gegen Grauzahn gekämpft. Ich schulde ihnen mehr als früher.

---
*Erzeugt in v1: 29 s, 2818 Tokens, v2: 26 s, 2625 Tokens · Modell haiku · Prüfer: Szene 's04_funkduell_mit_grauzahn': Folgeszene 'ausgang_grauzahn_respekt' gibt es nicht | Szene 's05_entscheidung_kampf': Folgeszene 'ausgang_grauzahn_erkenntnis' gibt es nicht | Ausgang 'ausgang_grauzahn_respekt' wird von keiner Szene erreicht | Ausgang 'ausgang_grauzahn_erkenntnis' wird von keiner Szene erreicht*