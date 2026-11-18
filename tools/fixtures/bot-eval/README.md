# Bot-Eval (BOT-04 A1, A3)

Sprechformen stehen in `content/bots/kanon.json` (einzige Quelle: Taste, Menue und Sprache zeigen dieselbe Formulierung). Der Matcher ist auf den Kanon optimiert (Stufe 1), freie Formulierungen sind ein Zusatz (Stufe 2, Schluesselwort-und-Slot). Darum gelten je Set eigene Kriterien (`node tools/bot-eval.js <datei> --art kanon|frei`, Standard: `kanon` fuer `eval-kanon*.json`, sonst `frei`):

| Set | Art | Was es prueft | Kriterium (Exit 1 sonst) |
|---|---|---|---|
| `eval-kanon.json` | kanon | Alle Sprech- und Kurzformen des Kanons (positiv, klein mit Punkt, "bitte", Adressierung vorn und hinten, Meterangabe), STT-Fehlervarianten (Lexikon: Backboard, Wolle, Cours, Wortgrenzen; mechanisch: Endung weg, Dreher, Buchstabe weg, Woerter zusammen) und Beinahe-Treffer (fehlendes oder ungueltiges Argument, zwei Argumente, Verneinung, Frage, falsche Rolle, Fremdsprache, zu lang, Zusatzwoerter, nav.sprung) | Quote 100 % **und** Falsch-Positiv 0 |
| `eval.json` | frei | Entwicklungsset, freie Formulierungen (644 Faelle, art: positiv / stt-fehler / negativ) | Falsch-Positiv 0; Quote nur ausgewiesen, kein Mindestwert |
| `eval-dev2.json` | frei | erstes blindes Abnahmeset (Runde 1: 95,1 %, Falsch-Positiv 2), seit Runde 2 Entwicklungsset (713 Faelle) | wie `eval.json` |
| `eval-blind2.json` | frei | **blindes Abnahmeset**, entsteht getrennt, wird nicht zur Entwicklung gelesen; nur die Abnahme laeuft damit | wie `eval.json` (Quote ausgewiesen) |

`eval-kanon.json` wird **erzeugt**, nicht von Hand gepflegt: `npm run bot:eval:gen` (`node tools/gen-eval-kanon.js`) liest `kanon.json`, ist wiederholbar (kein Zufall). Aendert sich der Kanon, neu erzeugen und einchecken; `node tools/gen-eval-kanon.js --pruefen` (im Selbsttest) schlaegt an, wenn die Datei nicht zum Kanon passt. `npm run bot:eval:kanon` laeuft das Set allein; `npm run test:bot-matcher` laeuft alle drei Sets mit ihren Kriterien.

Umwandlung des Entwicklungssets (mechanisch, 2026-11-18): Das Argumentformat der Systeme sind Spiel-IDs. In `tech.reparieren` (`system`), `tech.energie` (`system`) und `tech.prio` (`ziel`) wurden antrieb, schilde, waffen, reaktor zu engines, shields, weapons, reactor umgeschrieben (73 Faelle). Alle 9 Faelle mit "Sensor(en)" als System wurden entfernt (es gibt kein Sensor-System; `bord.sensor` ist ein anderer Befehl und blieb). Sonst keine inhaltliche Aenderung: 653 auf 644 Faelle.
