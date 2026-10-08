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
- **Beispiel:** `mod-beispiel/` ergänzt „Vernichten“ um die Pylonen-Prüfung aus m2 und schaltet damit den Szenentyp
  A5 Belagerung frei: `node tools/katalog.js --mod concept/katalog/mod-beispiel`.

## Für den Spielleiter
`node tools/katalog.js --spielleiter kurz` (für den Grobplan) bzw. `voll` (mit Parametern, zum Ausarbeiten einer
Szene). Der Text wird aus der Registry erzeugt, nie von Hand gepflegt.

## Herkunft der Grunddaten
Szenentypen und Moleküle wurden einmalig aus dem Vault erzeugt (`Bausteine/Szenentypen.md`, `Bausteine/Ziel-Moleküle.md`).
Ab jetzt ist die Registry die Quelle; der Vault beschreibt die Ideen, die Registry das Spielbare.
