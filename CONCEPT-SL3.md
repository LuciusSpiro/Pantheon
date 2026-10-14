# CONCEPT-SL3 – Überfahrt, Falle, Gestrandet (Kapitel 2–4)

Grundlage: `Briefing Die Schuld der Lerche (SL0-SL12)` (SL3), `Kampagne Die Schuld der Lerche`, Kais Entscheidungen 2026-10-14. Setzt `CONCEPT-SL0.md`
(Evert als Fracht) und SL1 (Karte Sund, spielbarer Nachbar von Pulverhorn) voraus. Stand: **Konzept, nicht gebaut**.

## 1. Befund
- `rueckzug` ist eine **Prüfung** (`server/mission/bausteine/raumalarm.js:43`: Notfallsprung seit Schrittbeginn aus Ort `loc`, Schiff nicht mehr dort), der Ausgangsname ist im Buch frei (`complete: "<name>"`). „Rückzug = Erfolg“ geht ohne Kettenänderung: Buch `{if: check rueckzug(pulverhorn) | sprungpunkt_erreicht, complete: "erfolg"}`. Das Briefing überschätzt die Aufgabe.
- Kette: `weiter` nur aus `erfolg` (`kampagne.js`, KETTE-FORTSCHRITT), alle anderen Ausgänge wiederholen. Tod -> `wiederholen` (existiert). Ein Reset des Zustands muss das Buch selbst leisten (Kette tut nur `m.abbrechen()` + `startMission`, `kampagne.js:begin`); Eisenwald-Bücher setzen Szenen per Schritt neu auf.
- Notfallsprung (`server/sim/sprung.js:259-320`): zufällige spielbare Nachbarhex **mit Ort**, gewichtet nach Kurs (`richtung 3`, `streuung 0.35`, `game.rng`), Reaktor offline, Hülle −15. Ohne spielbaren Nachbarn springt er „ins Leere“ im selben Sektor (`:297-298`) – für Pulverhorn wäre das ein Fehler der Kette. Verweigert bei: Reaktor offline, angedockt, **Außenteam unten**, Transfer läuft (`:272-279`).
- Normaler Sprungpunkt: `sprungpunkt_erreicht {kante}` (`bausteine/sektor.js`), Prüfung `notgesprungen {}` (Notfallsprung in der Mission).
- Reaktor-Neustart durch zwei Leute (Schalter A+B) existiert (ODA-Text im Notfallsprung).
- Fracht-Lager/Weltstand: Evert kommt über SL0 als `{art:'person'}`; Abgabe am Handelsposten per `person_abgeben`/Taktik. `abnehmer` (`fracht_abnehmer`) legt fest, wo abgeliefert werden darf (Pulverhorn-Station).
- Zufälliger Ort Kapitel 4 entsteht **von selbst**: `begin()` teleportiert nicht (`kampagne.js`), das Schiff bleibt, wo der Notfallsprung es hinwarf.

## 2. Entscheidungen
| # | Entscheidung |
|---|---|
| E1 | Evert reist als Fracht, die Ops beamt ihn (SL0). Er wird in Pulverhorn **abgegeben** (Taktik-Abgeben), nicht als Außenteam gebeamt. |
| E2 | Kap. 3 endet im Buch mit `erfolg` bei Notfallsprung **oder** Sprungpunkt erreicht; Tod/Lerche zerstört -> Ausgang `verloren` (Kette: wiederholen). |
| E3 | Reset bei Wiederholung (Kai: ja): Schritt „Szene setzen“ stellt Hülle, Schilde, Reaktor, Position, Piraten und Evert (wieder an Bord) auf Szenenbeginn; Fakten/Flags des Kapitels werden gelöscht. |
| E4 | Kein Hinweis auf den Notfallsprung (Kai); Evert ruft nur „Flieht, nehmt das Schiff!“. |
| E5 | Zeitfenster bis zur Zerstörung **25–40 s** (Konfig `kampagnen.lerche.falle.fensterS`), im Labor gemessen. |
| E6 | Kap. 4 hat zwei Eingänge: nach Notfallsprung (Reaktor aus, Ort zufällig) und nach normalem Sprung (Reaktor an, Ort = Zielhex). Gleiche Szenenlogik, Zweig per `notgesprungen`. |

## 3. Entwurf

### 3.1 Dateien
- `content/regiebuecher/sl_k2_ueberfahrt.regiebuch.json`, `sl_k3_falle.regiebuch.json`, `sl_k4_gestrandet.regiebuch.json` (kopf.art `kapitel`).
- `content/kampagne/schuld-der-lerche.json` (SL11): Kapitel `k2_ueberfahrt`, `k3_falle` (Ausgänge `erfolg`, `verloren`), `k4_gestrandet`. `einstieg` je Kapitel (Labor): Fracht `person:evert`, Ort, Flags.
- Config: `shared/config.js` Block `kampagnen.lerche.falle` `{ fensterS, piraten:{kind,n,schildFaktor}, evertRuf }`.
- Keine neue Server-Engine. Evtl. eine kleine Prüfung `ort_ohne_nachbar_spielbar` im Prüfer (`checker.js`): warnt, wenn Pulverhorn keinen spielbaren Nachbarn mit Ort hat (SL1-Abnahme).

### 3.2 Kapitel 2 – Überfahrt (Buch)
Schritte: Start in Kantenstein (Boden/Orbit, Entscheidung Kai: Start am Boden, Lerche im Orbit). `person_an_bord{evert}` (Ops beamt ihn vom Boden) -> Reise Kantenstein -> Concordia -> Pulverhorn (`im_hex`/Ort) -> `fracht_abnehmer {ort: pulverhorn, name: Handelsposten}`, Ops gibt Evert per Taktik ab (`fracht_abgeliefert`/`person_abgegeben`). Erfolg = Evert abgegeben.
- Layer: reine Regie (Buchdaten), Beamen = SL0-Funktionen; kein neuer Code.

### 3.3 Kapitel 3 – Die Falle (Buch)
1. Nach Abgabe: Funkspruch Evert, Piraten per `flotte_wellen`/`spawn_*` (Gegner „viel zu stark“: Klasse Kreuzer + Korvetten, `schildFaktor`, Dauer bis Verlust 25–40 s per Konfig; **gleiche Regeln wie Spieler**, nur Menge/Stärke).
2. Erfolgsprüfungen parallel: `rueckzug {loc: pulverhorn}` ODER `sprungpunkt_erreicht {kante: pulverhorn–*}` (Kante aus SL1). Beides ruft `complete: "erfolg"`.
3. Verlust: `schiff_zerstoert`-Prüfung (vorhandene Spielende-Prüfung der Lerche; **Name ungeprüft**, vor Bau mit `registry.js` abgleichen) -> `complete: "verloren"`; Kette wiederholt. `ausgaenge.verloren` -> `danach` setzt Flags zurück; kein Hinweis-Text.
4. Wiederholungsschritt `szene_setzen`: stellt Schiff her, Evert vor Ort, Piraten neu (`flotte_neustart` existiert für Flottenszenen, `flotte.js`).
- Wichtig: Evert nicht als Außenteam (E1), sonst blockiert `notsprungGrund` den Rückzug. Mit Evert an Bord (Fracht) ist der Notfallsprung erlaubt.
- Balancing-Hook im Labor: Szenario-Labor misst die Zeit Einsprung -> Hülle 0; Ziel 25–40 s, Notfallsprung braucht ca. 10 s Entscheidung.

### 3.4 Kapitel 4 – Gestrandet (Buch)
- Eintritt nach `erfolg` aus Kap. 3. Fakt `lerche_notsprung` (aus `notgesprungen`) steuert: Reaktor aus (Neustart-Schritt, zwei Leute) oder Reaktor an.
- Ziel: **Concordia erreichen** per Karte/Sektorplan/Sonde (SL4, SL5-Abhängigkeit). Im Buch Schritt `im_hex {hex: Concordia}` oder angedockt in Concordia; keine feste Ankunft (E6, zufällig).
- Absicherung: ein Prüfer-Test, dass jeder spielbare Nachbar von Pulverhorn per Schnellsprung/Sprung zu Concordia führt (Bot-Lauf: `sprungkette.js`-artig über alle Kandidaten). Notfallsprung aus dem Leerraum führt garantiert in Systemhexe (Code-Kommentar E30).
- Schnellsprung: nur über **erkundete** Hexe (`explore`). Nach dem Stranden ist der Zielhex unerkundet -> der Weg ist **bewusst** die Sonde/Karte (SL4); bis SL4 fertig ist, Notbehelf: Nachbarhex gilt als erkundet (Konfig, nicht im Endstand).

### 3.5 Layer-Schnitt
Storage: `game.fracht` (Evert), Weltstand-Fakten (`lerche_notsprung`), Flags im Buch. Action: SL0-Funktionen (`personBeamStart`…), Sprung-/Flotten-Funktionen unverändert; **keine neuen Parameter** an bestehenden Funktionen. Frontend: nur vorhandene Anzeigen (Funk, Kapitelkarte, Taktik).

## 4. Schnittstellen/Flags
Eingang: Evert an Bord (SL0), Hex-/Kantendaten Sund (SL1). Ausgang an SL4/SL5: Fakt `lerche_notsprung`, Position beliebig. Flags: `evert_abgegeben`, `falle_geflohen` (`rueckzug|sprung`), `lerche_notsprung`. Ereignisse: `notsprung`, `frachtAbgeliefert`, `personAbgegeben`.

## 5. Abnahme
Labor: Falle -> Notfallsprung = Erfolg; Falle -> Sprungpunkt erreicht = Erfolg; Zerstörung -> von vorn mit sauberem Reset (Evert, Schiff, Gegner); Zeit bis Verlust 25–40 s gemessen; Bot erreicht Concordia nach Stranden (alle spielbaren Nachbarn); Reaktor-Neustart durch zwei Leute; Kette speichert/lädt an jedem Übergang; Eisenwald läuft durch.

## 6. Schätzung
Bücher + Kette-Anteil 1,5 T., Falle/Balancing/Labor 1 T., Wiederholungs-Reset 0,5 T., Bot-Abdeckung zufälliger Hex 0,5 T. **Summe 3–3,5 T.** (Briefing 2).

## 7. Offene Fragen (Default)
1. Bleibt der Zufall in Kap. 4 wirklich frei, auch wenn der Zielhex ein gefährlicher Leerraum ist? Default: ja, Notfallsprung nie in „Gasfeld“/Station-Hex (Kandidatenliste SL1 mit `nurSaum`-Filter).
2. Reset: soll Evert nach Tod wieder an Bord starten oder schon in Pulverhorn stehen? Default: Szene beginnt mit Evert an Bord kurz vor der Abgabe (spart 1 min).
3. Name der Verlust-Prüfung (siehe 3.3) ungeprüft; kein Kai-Thema.
