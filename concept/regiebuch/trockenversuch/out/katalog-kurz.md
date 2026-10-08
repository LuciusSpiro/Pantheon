## Orte
- hafen: Hafen Lichtkordon (port) → Sprünge nach splitter, vaelen, kesh; Andocken. Funde: hafen_cache
- splitter: Splittergürtel (asteroids) → Sprünge nach hafen, b7, wrack, kesh. Funde: splitter_cache1, splitter_cache2
- b7: Boje B-7 (buoy) → Sprünge nach splitter, nebel; Außenkarte platform. Funde: b7_cache, b7_fragment
- vaelen: Vaelen-Karawane (trader) → Sprünge nach hafen, nebel; Andocken. Funde: vaelen_cache, vaelen_sonde
- wrack: Wrack „Zaunkönig“ (wreck) → Sprünge nach splitter, nebel; Außenkarte wreck. Funde: wrack_hollow, wrack_kapsel
- nebel: Graue Weite (nebula) → Sprünge nach b7, vaelen, wrack, relais. Funde: nebel_beacon, nebel_lore
- relais: Kustoden-Relais (relay) → Sprünge nach nebel. Funde: relais_lore
- kesh: Mond Kesh (moon) → Sprünge nach hafen, splitter; Außenkarte kesh. Funde: –

## NSC: tesk, sela, ivo, grauzahn, melk, kustoden_relais

Nicht vorhanden: verbündete Schiffe, neutrale Schiffe im All, Andocken an anderen Schiffen, Verfolgungen über mehrere Orte, neue Funde, Objekte oder Karten.

## Szenentypen (verfügbar)
- A2 `annaeherung_und_erkundung` – Annäherung & Erkundung: Unbekannten Ort anfliegen, scannen, Funde machen, Lage klären Moleküle: signal_orten, vermessen. Kippt zu: begegnung, raumgefecht.
- A3 `begegnung` – Begegnung: Schiff trifft Schiff: Kontrolle, Funkduell, Verhandlung, Handel, Bluff Moleküle: verhandeln. Kippt zu: raumgefecht, verfolgung.
- A4 `raumgefecht` – Raumgefecht: Offener Kampf gegen Schiffe (Raumkampf) Moleküle: vernichten. Kippt zu: andocken_und_entern, verfolgung.
- A7 `gefahrennavigation` – Gefahrennavigation: Gelände ist der Gegner: Nebel, Asteroiden, Minenfeld, Gravitationsfeld, Sonneneruption, Anomalie Moleküle: vermessen. Kippt zu: raumgefecht.
- A11 `bergung_im_all` – Bergung im All: Treibende Ladung, Kapseln, Wrackteile oder Schiffbrüchige finden, scannen und an Bord holen (Transfer, Traktorstrahl, Abschleppen) Moleküle: ladung_bergen. Kippt zu: gefahrennavigation, raumgefecht.
- C1 `erkundung` – Erkundung: Gelände oder Gebäude erkunden, suchen, Proben nehmen, Spuren lesen Moleküle: artefakt_freilegen, rekonstruieren. Kippt zu: gefecht, raetselort.
- C2 `gefecht` – Gefecht: Vorrücken von Deckung zu Deckung, Stellung nehmen (Außenmission-Kampf) Moleküle: stellung_nehmen. Kippt zu: halten, rueckzug.
- C5 `raetselort` – Rätselort: Mechanismen, Glyphen, Licht, Runen. Kein Zeitdruck, außer eine Wendung bringt ihn Moleküle: artefakt_freilegen, raetsel_loesen. Kippt zu: gefecht.
- C7 `rueckzug` – Rückzug: Ziel erfüllt, jetzt zum Abholpunkt durchschlagen (Missionen für das Außenteam) Moleküle: entkommen.
- C9 `bergung_vor_ort` – Bergung vor Ort: Ladung, Artefakte oder Personen am Boden finden, sichern (freilegen, stabilisieren, Wachen ausschalten) und hochbeamen Moleküle: artefakt_freilegen. Kippt zu: gefecht, halten.
- D1 `hafen` – Hafen: Andocken, Speichern, Auftragsbrett, Handel, Reparatur, Ladung und Passagiere aufnehmen oder abgeben, Gerüchte, NSC treffen, „Was bisher geschah“ zu Beginn einer Session Kippt zu: gesellschaft.

## Moleküle (verfügbar)
- `artefakt_freilegen` – Artefakt freilegen: Fund ausgraben, stabilisieren, sicher transportieren (Ansätze: technik; Szenentypen: C1, C5, C9)
  - Umsetzung `fund_aus_gewoelbe` (aussen, 1–2 min, nur an: kesh, erst nach: raetsel_loesen/zwei_schluessel): Hinter dem geöffneten Tor liegt der Fund. E halten, dann ist er im Inventar. Kurz und ruhig – meist folgt danach eine Wendung (Wächter, Verstärkung). Heute nur auf Kesh.
- `entkommen` – Entkommen: Weg, bis der Sprung geladen ist oder der Abholpunkt erreicht (Ansätze: gewalt, heimlich; Szenentypen: A6, C7)
  - Umsetzung `zu_den_pads` (aussen, 2–4 min, nur an: kesh): Eine Nachhut stellt sich in den Weg, das Team schlägt sich mit der Beute zu den Pads durch und beamt hoch. Kein Game Over: Wer fällt, wird zurückgeholt. Heute nur auf Kesh.
- `ladung_bergen` – Ladung bergen: Container finden, sichern, an Bord holen (Ansätze: technik, gewalt; Szenentypen: A11, C9)
  - Umsetzung `bergungskisten` (weltraum, 2–4 min): Treibende Kisten im Feld, auf der Taktikkarte grün. Der Pilot sieht nur nach vorn, die Taktik lotst mit Markern, drüberfliegen sammelt ein. Im Asteroidenfeld kostet jeder Rempler Schild. Garantie: Nach einer Weile lässt man den Rest treiben.
- `raetsel_loesen` – Rätsel lösen: Mechanismus, Glyphen, Licht (Ansätze: technik; Szenentypen: C5)
  - Umsetzung `zwei_schluessel` (aussen, 1–3 min, nur an: kesh): Zwei Schlüssel weit auseinander müssen gleichzeitig gehalten werden, dann öffnet sich das Tor. Ruhiger Moment nach einem Gefecht: Absprache und Anzählen. Heute nur auf Kesh.
  - Umsetzung `sonden_code` (aussen, 2–4 min, nur an: b7): Eine Sonde steuert Wachdrohnen. Unten sieht das Außenteam Symbole, oben hat der Captain die Codetabelle: Nur zusammen schaltet man die Sonde ab. Wissen aufteilen in Reinform. Heute nur auf B-7 (Plattform).
- `rekonstruieren` – Rekonstruieren: „Was ist hier passiert?“ aus Logs und Spuren (Ansätze: technik; Szenentypen: C1)
  - Umsetzung `wrack_logbuch` (aussen, 2–4 min, nur an: wrack): Im dunklen Wrack liegt ein Logbuch-Terminal, das erzählt, was passiert ist. Optional ein Hohlraum hinter einer dünnen Wand, den nur ein Weitscan aus dem Orbit verrät. Ruhige Erkundung, Stimmung statt Kampf. Heute nur im Wrack „Zaunkönig“.
- `signal_orten` – Signal orten: Notruf oder fremdes Signal triangulieren (Ansätze: technik; Szenentypen: A2, C1)
  - Umsetzung `weitscan_peilung` (weltraum, 2–5 min): Ein versteckter Fund (Bake, Sonde, Kapsel) liegt irgendwo in der Szene. Die Taktik pingt mit dem Weitscan an verschiedenen Stellen, der Pilot fliegt die Richtung ab, dann wird der Fund angevisiert und gescannt. Stark im Nebel. Garantie: ODA peilt die Richtung, später deckt sie den Fund auf.
- `stellung_nehmen` – Stellung nehmen: Ort erobern und sichern (Ansätze: gewalt; Szenentypen: A5, C2)
  - Umsetzung `trupp_raeumen` (aussen, 3–5 min, nur an: kesh): Ein Trupp hält einen Bereich. Deckung suchen, Schilde laden lassen, zusammen vorrücken; der Captain gibt von oben Befehle und sieht Gegner. Erledigt, wenn der Trupp fällt oder jemand durchbricht. Heute nur auf Kesh.
- `verhandeln` – Verhandeln: Preis, Durchflug, Lösegeld, Abkommen. Infos vom Schiff geben Trümpfe (Ansätze: reden; Szenentypen: A3, C6, D1)
  - Umsetzung `funkduell` (weltraum, 1–2 min): Ein NSC funkt und will eine Antwort. Der Captain wählt zwischen zwei Antworten oder schweigt. Wer zu lange schweigt, hat geschwiegen. Die Folgen jeder Antwort legt der Spielleiter fest (Flags, Belohnung, Gegner, Haltung). Die Crew bespricht sich – das ist der Kern.
- `vermessen` – Vermessen: Phänomen oder Ort scannen; Gefahr wächst mit der Nähe (Ansätze: technik; Szenentypen: A2, A7, C1)
  - Umsetzung `stoerrelais_scan` (weltraum, 2–4 min, nur an: b7/relais/wrack/vaelen/kesh): Störrelais kreisen um das Hauptobjekt des Orts und blockieren den Captain-Scan. Taktik schießt sie ab, der Pilot bringt das Schiff in Reichweite, der Captain scannt. Passt für Bojen, Relais, Wracks, Stationen.
- `vernichten` – Vernichten: Gegner zerstören bzw. ausschalten (Ansätze: gewalt; Szenentypen: A4, A10, C2)
  - Umsetzung `angriffswelle` (weltraum, 3–5 min): Erst greifen Jäger an. Sind sie erledigt oder dauert es zu lange, kündigt ein NSC per Funk Verstärkung an (Kanonenboot oder weitere Jäger). Breitseiten, Ausweichen, Schilde, Reparaturen. Passt für Piraten, Patrouillen, Hinterhalte.

## Noch nicht spielbar (nicht verwenden; bei Bedarf als Wunsch notieren)
Szenentypen: Hyperraumflug, Belagerung, Verfolgung, Geleit, Andocken & Entern, Schlacht, Ablieferung, Schleichfahrt, Wettflug, Krise an Bord, Enterabwehr, Gast an Bord, Halten, Infiltration, Gesellschaft, Ausbruch.
Moleküle: Ausschlachten, Befragen, Beobachten, Daten stehlen, Datenkern bergen, Durchbrechen, Evakuieren, Gefahrgut, Gefangenen überstellen, Geiseln befreien, Halten, Handeln, Kapern, Krise eindämmen, Kurs durch Gefahr, Ladung liefern, Pannenhilfe, Passagiere befördern, Personen bergen, Probe nehmen, Sabotieren, Schlichten, Schmuggeln, Schützen, Suchen, System ausschalten, Täuschen, Unbemerkt durchfliegen, Unbemerkt hineinkommen, Versorgen, Vertreiben, Wettflug, Ziel markieren.