# CONCEPT-SL9 – Lösegeld und Söldner (Kapitel 8, 9A, 9B)

Grundlage: `Briefing Die Schuld der Lerche (SL0-SL12)` (SL9), `Kampagne Die Schuld der Lerche`, Kais Entscheidungen 2026-10-14. Setzt SL0 (Personen als Fracht),
SL1 (inkl. „Kante enthüllen“, Kartenwahl beim Start), SL3, SL7 (Landepunkt-Scan, Station) voraus. Stand: **Konzept, nicht gebaut**.

## 1. Befund
- Verzweigung: strukturell nur als **bedingte Folgen auf `erfolg`** (`kampagne.js` `folge()`, Schema `folge.wenn`; erste gültige gewinnt, letzte ohne `wenn`). Eigene Ausgänge mit `weiter` verbietet der Prüfer (KETTE-FORTSCHRITT). Eisenwald nutzt `wenn` nur im Abspann; als Kapitelverzweigung gibt es nur einen negativen Prüfertest (`tools/check-kette.js:56`), **keinen Laufzeittest** – das Briefing „(nicht geprüft)“ stimmt, wir bauen einen.
- Kapitelnummern müssen fortlaufend in Array-Reihenfolge stehen (Prüfer `KETTE-NR`): 9A = 9, 9B = 10, Boje = 11 (Kai: zwei Nummern gelten). Kapitelkarten zeigen dann die Nummern 9/10; im Abspann/Texten nicht „Kapitel 10“ für die Boje nennen, nur Titel.
- **Verborgene Kanten sind heute nie nutzbar** (`explore.js:269-276` `kanteOffen` -> false für `hidden`; `bojeBekannt` false; `sprungpunkt_oeffnen` lehnt ab). Kai: SL1 baut „Kante enthüllen“ (Weltstand-Schlüssel wie bei `locked`+`key`). SL9 setzt das voraus; hier nur Nutzung: Buch ruft `kante_enthuellen {kante}` (SL1) auf, z. B. durch den Kontakt in Concordia gegen Marken.
- Marken: `game.inventory.marks`, Start 150 (`config.js:108`), Abzug `pay_marks` (`registry.js:111`), Prüfung `marks_below` (`:338`), Belohnung `reward{marks}`. Es gibt **keine** Prüfung „mindestens n Marken“ (nur `marks_below`, per `not`) und **keine Baustein-Aktion „Marken gutschreiben“** außer `reward`.
- Söldner = Verbündete: `flotte_aufstellen {tag, kind, name, npc?, von?, rolle…}` (`bausteine/flotte.js:19`), Klassen `korvette|fregatte|kreuzer|raider`, Flottenbefehle in fünf Arten (`flotte_befehl`; `sprecher?`, `text?` parametrisierbar), Wellen, `flotte_neustart`. Nicht geprüft: ob Befehle ohne „Legat“-Kontext (Haltungen, `legat_erinnert`) sauber laufen.
- Evert befreien: SL0 (Person = Fracht, von der Karte per Ops-Taktik hoch). Bodenkampf/Station: SL7 (Landepunkt per Scan -> Planungstisch).
- Weltstand: Flag/Fakt für den Weg (A/B) trägt in Kap. „Boje“ und Abspann (`abspann` kann `wenn` je Block/Zeile, `kampagne.js:144-146`).

## 2. Entscheidungen (Kai 2026-10-14, Rest Studio-Default)
| # | Entscheidung |
|---|---|
| E1 | **Altrost nur als Textkontakt in Concordia.** Der Weg dorthin (verborgene Kante) wird gegen Geld verraten (`pay_marks` + `kante_enthuellen`), die Söldner erscheinen per `flotte_aufstellen` **bei Schrottkante**. Kein Altrost-Ort. |
| E2 | Verzweigung per `erfolg` + `wenn {flag: weg}`: Kap. 8 (`k8_entscheidung`) -> `k9a_uebergabe` (Weg Lösegeld) / `k9b_soeldner` (Weg Söldner). |
| E3 | Geld: Forderung `F` als **Config-Zahl** (`kampagnen.lerche.geld.forderung`); Söldner kosten `F`, Lösegeld bei Übergabe `ceil(1,3 × F)`. Pflichtaufträge bringen ≈ 1,0–1,1 F, Notrufe den Rest. Zahlen stellt das Studio nach Spieleabend 3 nach. |
| E4 | Endlos farmen ist okay (kein Ertragslimit). Gegenwehr nur über Wirtschaftsform: Deuterium-Verkaufspreis feststehend, Aufwand/Risiko bremst; kein Deckel. |
| E5 | Bei Weg A nimmt Kap. „Boje“ die Piraten mit (Wettlauf), bei Weg B nicht (`flag weg`). Piraten behalten die Koordinaten (Fakt `piraten_kennen_boje`). |
| E6 | Spieler können nach Kap. 8-Wahl zurück verdienen (Wahl erst bestätigt, wenn Geld reicht; sonst weiter „Auftragsbrett“). |

## 3. Entwurf

### 3.1 Datenmodell
- `content/kampagne/schuld-der-lerche.json` (SL11): Kapitel `k8_entscheidung` mit `ausgaenge.erfolg: [{wenn:{flag:'weg_soeldner'}, weiter:'k9b_soeldner'}, {weiter:'k9a_uebergabe'}]`. Beide Folgekapitel enden mit `erfolg -> k10_boje`. `abspann`-Blöcke mit `wenn {flag weg…}`.
- Weltstand-Fakten (nicht Buchflags, damit Kap. 10 und Abspann sie lesen): `lerche_weg` (`loesegeld|soeldner`), `loesegeld_gezahlt`, `soeldner_angeheuert`, `piraten_kennen_boje`. Setzen über `welt_fakt` (vorhanden).
- Config `shared/config.js`: `kampagnen.lerche.geld { forderung, aufschlag:0.3, soeldnerPreis:'forderung', kontaktPreis }`, `kampagnen.lerche.soeldner { kind:'fregatte', n, namen }`. Keine Zahlen in Frontend/Büchern; Bücher nutzen Platzhalter `{{geld.loesegeld}}`.

### 3.2 Neuer Code (Action-Layer, intentionsbenannt, `server/mission/bausteine/`)
- `marken_mindestens {n}` (Prüfung; statt `not marks_below`, klarer; Platzhalter-fähig) und `marken_gutschreiben {n, grund}` (Aktion; für Verkauf/Notrufe – gemeinsam mit SL6/SL8, nicht SL9-spezifisch).
- `geld_zahlen {posten}` (Aktion): ruft `pay_marks` mit dem Betrag aus Config (`loesegeld|soeldner|kontakt`); Fehlschlag, wenn zu wenig (Buch prüft vorher). Eine Funktion je Anwendungsfall statt Parameter-Flag an `pay_marks`.
- `kante_enthuellen {kante}` kommt aus **SL1**; SL9 nutzt es nur.
- Keine Kettenänderung nötig; Laufzeittest + Prüferfall für bedingte Kapitelfolge ergänzen (`tools/test-kette.js`, `tools/check-kette.js`).

### 3.3 Bücher
- `sl_k8_entscheidung`: Auswahl (`choice`-Aktion der Engine, Ereignis -> Flag) Lösegeld/Söldner. „Söldner“ erfordert vorher den Kontakt (Textszene in Concordia: Marken zahlen -> `kante_enthuellen` Altrost-Weg ist **nicht** nötig, weil Altrost nur Text ist; der Kontakt verrät stattdessen den Söldnerauftrag, d. h. er schaltet Auswahl B frei, Fakt `soeldner_kontakt`). Prüfung `marken_mindestens` je Option; Meldung „Zu wenig Marken“ -> Rückkehr zum Auftragsbrett (Kap. 7 bleibt zugänglich, `wiederholen` nicht nötig: Kapitel bleibt offen bis gültige Wahl).
- `sl_k9a_uebergabe`: Anfahrt Schrottkante (verborgene Kante enthüllt in Kap. 6), Funk Piraten, `geld_zahlen{loesegeld}`, Evert wird per Ops-Taktik an Bord geholt (`person_aufnehmen`/Taktik), Fakt `piraten_kennen_boje`. Zu wenig Geld: Szene endet mit Ausgang `zu_wenig` (Kette: `wiederholen`) und Rückfahrt zum Verdienen; ohne Uhr, kein Verlust.
- `sl_k9b_soeldner`: Anheuern in Concordia (`geld_zahlen{soeldner}`), `flotte_aufstellen` bei Schrottkante (Rollen begleiter/angreifer), Flottenschlacht (`flotte_wellen`, `flotte_befehl`), Station scannen (SL7 Landepunkt-Scan), Planungstisch, Außenteam, Evert befreien (SL0 Person), Ops beamt ihn hoch. Verlust der Söldner ist erlaubt (Flag `soeldner_verloren` für den Abspann).

### 3.4 Layer-Schnitt
Storage: `game.inventory.marks`, Weltstand-Fakten (Weg), `game.space.escorts` (Söldner). Action: neue Bausteine/Funktionen oben, Kette nur Daten. Frontend: Entscheidungsdialog (vorhandenes `choice`-UI), Kostenanzeige aus Config-Platzhaltern; keine Geschäftsregeln im Client.

## 4. Schnittstellen
Eingang: Marken (Kap. 7a/7b/7c), Evert (SL0), Kante/Karte (SL1), Station/Landepunkt (SL7). Ausgang Kap. 10 (`SL10`) und Abspann: Fakt `lerche_weg`, `piraten_kennen_boje`, `soeldner_verloren`.

## 5. Abnahme
Beide Wege per Bot bis zur Boje; Geld reicht/reicht nicht (A mit 130 %, B mit 100 %); Weltstand merkt den Weg und überlebt Speichern/Laden; Laufzeittest der bedingten Kapitelfolge; Söldner erscheinen bei Schrottkante und folgen Flottenbefehlen ohne Legat; Evert an Bord auf beiden Wegen; Eisenwald läuft durch; Snapshot unter Grenze (Flottenschlacht + Evert).

## 6. Schätzung
Verzweigung + Laufzeittest/Prüfer 0,5 T., Geld-Bausteine/Config 1 T., Bücher 8/9A 1,5 T., 9B Söldner/Flottenschlacht/Befreiung 2–3 T. **Summe 5–6 T.** (Briefing 3–4); Kante enthüllen zählt in SL1 (+1–2 T. dort), Marken-Verkauf in SL6.

## 7. Offene Fragen (Default)
1. Darf die Crew Kapitel 8 wählen, **bevor** das Geld reicht (und dann scheitern), oder sperrt die Auswahl bis dahin? Default: Auswahl sichtbar, Option grau ohne Geld.
2. Söldner nach Gefecht: bleiben sie für Kap. 10 (Ruhe nach B)? Default: abwesend, nur Funk.
3. Bei A nach „zu wenig Geld“: erlaubt, danach Weg B zu wechseln (Geld verloren?). Default: nur Anzahlung nicht, Piraten nehmen nichts bei Abbruch.
4. Nicht geprüft: ob Flottenbefehle ohne Legat/Haltung der EK4-Texte brauchen; Probelauf vor Konzept-Freigabe (0,5 T.).
