---
title: Live-Texte von Gemma, 15 Beispiele (SUND-03b T)
updated: 2026-10-25
tags: [pantheon, sund-03b, texte, stilurteil]
---

# Live-Texte von Gemma: 15 Beispiele für Kais Stilurteil

Erzeugt mit `tools/messe-texte-ollama.js` am 2026-10-25, Modell `gemma4:26b-a4b-it-q4_K_M` auf Sleipnir (Ollama 0.40.4), `think:false`, `format` = kleines JSON-Schema, Systemprompt `content/spielleiter/prompts/text.system.md`. Jeder Text hat den Prüfer der Texte beim jeweils genannten Versuch bestanden (Länge, Platzhalter, keine Ziffern, kein Ausweich-Versprechen, keine fremde Stimme). `{ort}` und `{n}` setzt das Spiel beim Verbrauch ein. **Das Stilurteil fehlt noch: bitte lesen.**

Messung (150 Läufe): gültig beim 1. Versuch 136 von 150 (91 %, Wilson 95 %: 85–94 %), Dauer Median 0.9 s, p90 1.1 s.

## Funk (Reise-Ankündigung und Eintreffen)

### 1. notruf_pirat_frachter (ankuendigung, Frachter Aurelia, Stimme ziviles Schiff)

- **Lage:** Der roemische Frachter Aurelia wird bei {ort} von Piraten der Rostmeute bedraengt, der Antrieb stottert. Er ruft jedes Schiff in Funkreichweite um Hilfe. Die Gefahr (Piraten) wird im Notruf genannt.
- **Gemma** (1. Versuch gültig): Hier ist die Aurelia! Wir werden bei {ort} von der Rostmeute bedrängt und der Antrieb macht nur noch unregelmäßige Sprünge. Lerche, hört ihr uns? Kommt und helft uns!
- **Katalogtext zum Vergleich:** Hier Frachter Aurelia, an jeden, der hört! Piraten hängen an unserem Heck, bei {ort}. Der Antrieb stottert. Wer kommt?

### 2. notruf_pirat_frachter (eintreffen, Frachter Aurelia, Stimme ziviles Schiff)

- **Lage:** Der roemische Frachter Aurelia wird bei dem Ort von Piraten der Rostmeute bedraengt, der Antrieb stottert. Er ruft jedes Schiff in Funkreichweite um Hilfe. Die Gefahr (Piraten) wird im Notruf genannt.
- **Gemma** (1. Versuch gültig): Ihr seid da! Die Rostmeute klebt an meinem Heck und der Antrieb macht nur noch Stottern, helft mir!
- **Katalogtext zum Vergleich:** Ich sehe euch! Die Räuber drehen schon bei, haltet sie mir vom Heck!

### 3. notruf_pirat_haendler (ankuendigung, Händler Kupferkranich, Stimme Konkordat)

- **Lage:** Der Haendler Kupferkranich (Konkordat) wird bei {ort} von Raeubern der Rostmeute geentert oder bedraengt. Er ruft an alle Kontore um Hilfe; das Konkordat zahlt Finderlohn. Die Gefahr (Piraten) wird im Notruf genannt.
- **Gemma** (1. Versuch gültig): Alle Kontore aufgepasst! Die Rostmeute drängt uns bei {ort} in die Zange, die Fracht ist in Gefahr. Wer die Lerche zur Hilfe schickt, bekommt einen Finderlohn, der jeden Vertrag übertrifft!
- **Katalogtext zum Vergleich:** Kupferkranich an alle Kontore! Rostmeute-Gesindel bei {ort}, drei, vielleicht vier Rümpfe. Das Konkordat zahlt Finderlohn!

### 4. notruf_pirat_haendler (eintreffen, Händler Kupferkranich, Stimme Konkordat)

- **Lage:** Der Haendler Kupferkranich (Konkordat) wird bei dem Ort von Raeubern der Rostmeute geentert oder bedraengt. Er ruft an alle Kontore um Hilfe; das Konkordat zahlt Finderlohn. Die Gefahr (Piraten) wird im Notruf genannt.
- **Gemma** (1. Versuch gültig): Da seid ihr endlich! Die Rostmeute ist direkt an meiner Lade, wer die Piraten vertreibt, kriegt den doppelten Finderlohn!
- **Katalogtext zum Vergleich:** Ihr seid es! Sie lassen von uns ab und wenden sich euch zu. Gebt es ihnen!

### 5. notruf_belagerung_posten (ankuendigung, Posten Vigilia, Stimme roemisch)

- **Lage:** Der roemische Posten Vigilia bei {ort} ist von germanischen Laeufern umschlossen und hat die Wache halbiert. Er ruft um Hilfe, solange die Mauer haelt. Die Gefahr (Belagerung) wird im Notruf genannt.
- **Gemma** (1. Versuch gültig): Posten Vigilia meldet: {ort} wird von germanischen Läufern umschlossen, die Wache ist halbiert. Die Mauer hält noch, aber die Belagerung drückt. Lerche, kommt zur Hilfe!
- **Katalogtext zum Vergleich:** Posten Vigilia, wir werden bei {ort} umschlossen! Germanische Läufer rund um die Mauer. Wir halten, solange das Pulver reicht. Schickt Hilfe!

## NSC-Reaktion

### 6. bsp_germane_verschont (reaktion, Schiffsführer der Sippe Rabenfels, Stimme germanisch)

- **Lage:** Die Lerche hat ein germanisches Schiff im Gefecht ausser Gefecht gesetzt und dann am Leben gelassen. Der germanische Schiffsfuehrer funkt die Lerche an.
- **Antwort der Spieler:** „Wir schiessen nicht auf Wehrlose. Fliegt heim.“
- **Gemma** (1. Versuch gültig): Euer Eisen ist stumpf, wenn ihr uns Scham statt Tod schenkt. Die Sippe wird das nicht vergessen.

### 7. bsp_livia_gegenangriff (reaktion, Optio Livia Rufa, Stimme roemisch)

- **Lage:** Die Lerche hat einen Gegenangriff auf die Audax abgewehrt. Der Sektor ist ruhig. Livia Rufa befehligt die Audax.
- **Antwort der Spieler:** „Wir haben den Sektor gesichert.“
- **Gemma** (1. Versuch gültig): Gut. Haltet die Stellung und bleibt wachsam, die Audax übernimmt jetzt die Überwachung des Sektors.

### 8. bsp_haendler_preis (reaktion, Haendlerin Melk, Stimme Konkordat)

- **Lage:** Die Lerche hat der Haendlerin eine Fracht sicher bis zum Hafen gebracht und verlangt dafuer einen besseren Preis.
- **Antwort der Spieler:** „Ein besserer Preis waere fair.“
- **Gemma** (1. Versuch gültig): Fair? Ein schönes Wort für eine Zahl, die ich nicht in meinen Büchern stehen habe. Die Fracht ist unbeschädigt, also halten wir uns an den Vertrag, sonst wird das nächste Geschäft teurer als gedacht.

### 9. bsp_kutter_dank (reaktion, Kutter Fortuna, Stimme ziviles Schiff)

- **Lage:** Die Lerche hat den Reaktor des Kutters Fortuna wieder zum Laufen gebracht und will keinen Lohn.
- **Antwort der Spieler:** „Kein Lohn noetig, gute Fahrt.“
- **Gemma** (1. Versuch gültig): Oh, Sie sind wahrlich ein Segen! Wenn die Fracht heil bleibt, zahle ich beim nächsten Hafen ein ordentliches Trinkgeld für die gute Tat.

### 10. bsp_legat_befehl (reaktion, Legat Marcus Severus, Stimme roemisch)

- **Lage:** Die Lerche hat einen Befehl des Legaten ausgefuehrt, aber ein Schiff der Flotte ist dabei verloren gegangen. Der Legat funkt die Lerche an.
- **Antwort der Spieler:** „Befehl ausgefuehrt, wir bedauern den Verlust.“
- **Gemma** (1. Versuch gültig): Die Pflicht wurde getan, doch die Lücke in der Flotte bleibt bestehen. Erfüllt euren Dienst weiterhin mit der Disziplin, die Rom von euch verlangt.

## Verlustspruch

### 11. posten_verloren (verlust, Stimme roemisch)

- **Lage:** Der Posten {ort} ist verloren. (Nur fuer dich, NICHT im Text erwaehnen: wer ihn jetzt haelt und was aus der Besatzung wurde, weiss niemand.)
- **Gemma** (1. Versuch gültig): Bei den Göttern, der Posten {ort} ist verloren! Nur noch Funkstille aus dieser Richtung.

### 12. hafen_gefallen (verlust, Stimme roemisch)

- **Lage:** Der Hafen {ort} ist gefallen. (Nur fuer dich, NICHT im Text erwaehnen: wer ihn jetzt haelt und was aus den Menschen dort wurde, weiss niemand.)
- **Gemma** (1. Versuch gültig): Bei den Göttern, der Hafen {ort} ist gefallen. Es ist nicht mehr sicher, Lerche.

### 13. posten_verloren (verlust, Stimme roemisch)

- **Lage:** Der Posten {ort} ist verloren. (Nur fuer dich, NICHT im Text erwaehnen: wer ihn jetzt haelt und was aus der Besatzung wurde, weiss niemand.)
- **Gemma** (1. Versuch gültig): Bei den Göttern, der Posten {ort} ist verloren. Die Funkstille dort ist eine Schande für die Legion.

### 14. hafen_gefallen (verlust, Stimme roemisch)

- **Lage:** Der Hafen {ort} ist gefallen. (Nur fuer dich, NICHT im Text erwaehnen: wer ihn jetzt haelt und was aus den Menschen dort wurde, weiss niemand.)
- **Gemma** (1. Versuch gültig): Verflucht ist der Hafen {ort}, er ist gefallen. Unsere Pflicht brennt im Herzen, aber dort ist nur noch Leere.

### 15. posten_verloren (verlust, Stimme roemisch)

- **Lage:** Der Posten {ort} ist verloren. (Nur fuer dich, NICHT im Text erwaehnen: wer ihn jetzt haelt und was aus der Besatzung wurde, weiss niemand.)
- **Gemma** (1. Versuch gültig): Verflucht sei dieser Tag, der Posten {ort} ist verloren!
