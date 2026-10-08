# Katalog-Registry (Vorarbeit S1/S2)

Stand 2026-10-07 · Vorarbeit während der QA von M4, nur neue Dateien. Kai-Entscheidung: **Szenentypen und Moleküle
werden als Daten definiert und registriert.** Das macht es leicht, sie nach und nach hinzuzubauen, und ermöglicht
später Modding. Der Spielleiter hat Zugriff auf alle registrierten, verfügbaren Bausteine.

## Ebenen

| Ebene | Was | Wer | Wo |
|---|---|---|---|
| **Bausteine** | Aktionen und Prüfungen der Engine (`spawn_squad`, `object_state` …) | Studio (Code) | `concept/regiebuch/bausteine.json` → in S1 `server/mission/registry.js` |
| **Mechaniken** | was die Engine kann (`raumkampf`, `transfer` …) bzw. noch nicht kann (`schleichfahrt` …) | Studio (Code) | `mechaniken.json` |
| **Moleküle** | Spielziele (Vault: Ziel-Moleküle) mit **Umsetzungen** = Regiebuch-Vorlagen mit Parametern | Studio, Modder (Daten) | `molekuele/*.json` |
| **Szenentypen** | Rahmen einer Szene (Vault: Szenentypen A1–D1) | Studio, Modder (Daten) | `szenentypen/*.json` |

Szene = Szenentyp + Ort + 1–2 Moleküle (je eine Umsetzung) + Besetzung + Wendungen.

## Verfügbar oder geplant – automatisch
- **Umsetzung verfügbar**, wenn alle Mechaniken in `braucht` verfügbar sind **und** ihre Vorlage, mit den Testwerten aus
  `test.params` eingesetzt, den Regiebuch-Prüfer (`tools/check-missions.js`) besteht. Sonst `geplant` oder `fehlerhaft`.
- **Molekül verfügbar**, wenn eine Umsetzung verfügbar ist.
- **Szenentyp verfügbar**, wenn seine Mechaniken verfügbar sind und ein Molekül mit passendem Schauplatz zu ihm gehört.
- Baut das Studio eine Mechanik und stellt sie in `mechaniken.json` auf `verfuegbar`, werden alle Einträge, die nur
  darauf gewartet haben, **ohne weitere Änderung** freigeschaltet. Der Spielleiter sieht geplante Einträge nur als
  „noch nicht spielbar“.

## Stand
`node tools/katalog.js`:
- **27 Szenentypen** (aus dem Vault), davon 11 verfügbar
- **43 Moleküle** (aus dem Vault), davon 10 verfügbar
- **11 Umsetzungen** aus dem Tutorial (m1–m3), alle verfügbar und vom Prüfer bestätigt

| Molekül | Umsetzung | Schauplatz | Quelle |
|---|---|---|---|
| Vermessen | Objekt unter Störung scannen | Weltraum | m1 Boje B-7 |
| Signal orten | Signal per Weitscan finden | Weltraum | m2 Leitbake |
| Vernichten | Angriffswelle mit Verstärkung | Weltraum | m1 Rostmeute |
| Ladung bergen | Bergungsgut im Feld einsammeln | Weltraum | m1 Splittergürtel |
| Verhandeln | Funkduell mit zwei Antworten und Schweigen | Weltraum | m1/m2 Grauzahn |
| Rätsel lösen | Tor nur zu zweit zu öffnen | Außen (Kesh) | m3 Archiv |
| Rätsel lösen | Sonden-Code: Captain sieht die Tabelle | Außen (B-7) | m1 Plattform |
| Artefakt freilegen | Fund aus dem Gewölbe bergen | Außen (Kesh) | m3 Tafel |
| Stellung nehmen | Trupp ausschalten oder durchbrechen | Außen (Kesh) | m3 Hof |
| Entkommen | Mit der Beute zu den Pads | Außen (Kesh) | m3 Rückzug |
| Rekonstruieren | Logbuch im Wrack lesen | Außen (Wrack) | Zaunkönig |

**S2 (2026-10-08):** 13 neue Umsetzungen, Stand `node tools/katalog.js`: 27 Szenentypen (14 verfügbar, neu A5, A8, A12),
43 Moleküle (21 verfügbar), 24 Umsetzungen (alle verfügbar). Dauern sind **Schätzungen** (`dauer_quelle`), BOTS misst.

| Molekül | Umsetzung | Schauplatz | Bausteine (neu) |
|---|---|---|---|
| Schützen | Geleit durch einen Angriff (A8) | Weltraum | spawn_escort, escort_*, enemies_retreat |
| Schützen | Notruf: Havaristen verteidigen (A3/A8) | Weltraum | spawn_escort, escort_* |
| Pannenhilfe | Längsseits gehen und flicken (A3) | Weltraum | spawn_escort (treibt, reparatur_s) |
| Kurs durch Gefahr | Blindflug durch Feld oder Nebel (A7) | Weltraum | ship_in_zone (splitter/nebel) |
| Vernichten | Pylonen mit Frontschild (A5, aus m2) | Weltraum | – |
| System ausschalten | Störrelais blockieren den Faltsprung (A4/A5) | Weltraum | jumpBlock |
| Täuschen | Bluff per Funk mit Hinweis der Ortung (A3) | Weltraum | – |
| Ausschlachten | Container im Wrack bergen (C1/C9) | Außen (Wrack) | map_reset |
| Datenkern bergen | Datenkern von der Plattform holen (C1/C9) | Außen (B-7) | map_reset |
| Ladung liefern | Am Hafen andocken und übergeben (A12/D1) | Weltraum/Hafen | – |
| Vertreiben | Angreifer bis zur Flucht (A4) | Weltraum | enemies_retreat |
| Personen bergen | Verletzte Person holen (C9) | Außen (B-7, Wrack, Kesh) | map_reset, spawn_person, person_rescued |
| Halten | Position am Objekt halten (A5) | Weltraum | ship_hold_position |

Neue Felder je Umsetzung (S2): `liefert_flags` (für Verzweigungen; bei Schützlingen setzt die Engine `<tag>_heil|_beschaedigt|_verloren`,
Tag = Szenen-ID), `rueckfall.params` (Rohfassung ohne LLM), `dauer_quelle`, `dauer_je_crew`. Archiv-Missionen: `content/spielleiter/archiv/`.

## Etwas hinzufügen
- **Neue Umsetzung für ein bestehendes Molekül:** in `molekuele/<id>.json` unter `umsetzungen` ergänzen. Pflicht:
  `beschreibung` (für den Spielleiter), `braucht`, `params`, `vorlage` (Regiebuch-Fragment) und `test.params`.
- **Vorlage:** ein Regiebuch-Fragment mit Platzhaltern. `{{id}}` = Präfix der Szene (für Schritt-, Text- und
  Flag-Namen), `{{weiter}}` = Folgeschritt, `{{param}}` = Parameter. Ein String, der nur aus einem Platzhalter
  besteht, wird durch den Wert ersetzt (auch Zahlen und Aktionslisten).
- **Prüfen:** `node tools/katalog.js`. Eine Umsetzung, die den Prüfer nicht besteht, ist `fehlerhaft` und für den
  Spielleiter unsichtbar.

## Modding
- Ein Mod ist ein Ordner `mods/<name>/katalog/{molekuele,szenentypen}/*.json`, **nur Daten**. Mods können keinen Code
  ausführen und keine Mechaniken oder Bausteine hinzufügen.
- **Neues Molekül oder neuer Szenentyp:** einfach als Datei ablegen (eigene ID).
- **Bestehendes Molekül erweitern:** Datei mit gleicher ID und `"erweitert": true`. Die Umsetzungen werden angehängt,
  Szenentypen und Ansätze ergänzt (nie entfernt).
- **Beispiel:** `mod-beispiel/` ergänzt „Vernichten“ um eine Kopie der Pylonen-Prüfung aus m2 (Umsetzung
  `pylonen_mod_beispiel`; seit S2 steht `vernichten/pylonen_pruefung` auch im Kern):
  `node tools/katalog.js --mod content/katalog/mod-beispiel`.

## Für den Spielleiter
`node tools/katalog.js --spielleiter kurz` (für den Grobplan) bzw. `voll` (mit Parametern, zum Ausarbeiten einer
Szene). Der Text wird aus der Registry erzeugt, nie von Hand gepflegt.

## Herkunft der Grunddaten
Szenentypen und Moleküle wurden einmalig aus dem Vault erzeugt (`Bausteine/Szenentypen.md`, `Bausteine/Ziel-Moleküle.md`).
Ab jetzt ist die Registry die Quelle; der Vault beschreibt die Ideen, die Registry das Spielbare.
