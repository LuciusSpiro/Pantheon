# Bot-Eval (BOT-04 A1)

- `eval.json` ist das **Entwicklungsset** (644 Faelle, art: positiv | stt-fehler | negativ). Daran darf der Matcher entwickelt und gemessen werden: `node tools/bot-eval.js`.
- `eval-blind.json` ist das **blinde Abnahmeset** (entsteht getrennt). Es wird nicht zur Entwicklung gelesen; nur die Abnahme laeuft damit: `node tools/bot-eval.js tools/fixtures/bot-eval/eval-blind.json`.

Umwandlung des Entwicklungssets (mechanisch, 2026-11-18): Das Argumentformat der Systeme sind Spiel-IDs. In `tech.reparieren` (`system`), `tech.energie` (`system`) und `tech.prio` (`ziel`) wurden antrieb, schilde, waffen, reaktor zu engines, shields, weapons, reactor umgeschrieben (73 Faelle). Alle 9 Faelle mit "Sensor(en)" als System wurden entfernt (es gibt kein Sensor-System; `bord.sensor` ist ein anderer Befehl und blieb). Sonst keine inhaltliche Aenderung: 653 auf 644 Faelle.
