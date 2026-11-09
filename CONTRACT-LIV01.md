# CONTRACT-LIV01 – Kontingent-Schranke des Token-Zählers (Paket A1: Server)

Vertrag zwischen Server (A1, `server/sim/kontingent.js`) und Client (A2: Anzeige und Taste). Der Client liest nur
dieses Dokument und `shared/protocol.js`.

## Verhalten
- Der Token-Zähler (`LLM.budget()`, EIN Zähler je Serverlauf, Limit `CLAUDE_TOKEN_BUDGET`, Standard 500 000) hat eine
  **Schwelle** = 90 % des Limits (500 000 -> 450 000; 60 000 -> 54 000).
- Ab `used >= schwelle` fragen Lage-, Abenteuer- und Missions-Spielleiter das Modell nicht mehr (kein CLI-Prozess); der
  bestehende Rückfallpfad greift, das Spiel bleibt spielbar. Die drei Spielleiter fragen `Kontingent.sperrt(game, minBudget)`.
- **Jeder Weg zu Claude fragt das Gate** (Nacharbeit M1/M2): auch die **Eskalation** des Abenteuer-Spielleiters (`Kontingent.sperrtEskalation`, vor `losschicken(job, true)`; eine ungültige Ollama-Antwort geht ab der Schwelle nicht mehr an Claude, auch wenn die Schwelle erst während des Jobs erreicht wurde) und der **Text-Pool** (`server/sim/texte-pool.js`: Stufe bei Claude, z. B. `LLM_ANBIETER_GERUECHTE_FUNK=claude`, und seine Eskalation, z. B. `LLM_ESKALATION_FIGUREN_NEBEN=1`; `Kontingent.sperrtClaude` / `sperrtEskalation`). Ollama-Anfragen ohne Claude bleiben frei, der Rückfall ist wie bisher (Katalogtext). Der Missions-Spielleiter hatte das Gate schon für Eskalation und Claude-Stufen. Das Messwerkzeug für den Text-Pool fragt ohne Spiel und bleibt ungebremst.
- Das alte `min_budget`-Gate (30 000) ist auf `min(30000, limit - schwelle)` gedeckelt. Ist das Limit höchstens `min_budget`,
  bleibt es `min_budget` (Anfragen wären ohnehin unmöglich).
- **Freigabe** (`kontingent.freigeben`) hebt Limit UND Schwelle um 500 000. Danach fragt der Spielleiter wieder; erreicht
  der Zähler die neue Schwelle (950 000), kommt die Meldung erneut.
- Der Zähler gilt je Serverlauf und steht nicht im Weltstand (Format Version 3 unverändert).
- **BUDGET gilt prozessweit**, nicht je Raum und nicht je Abend: alle Räume und alle Abende eines Laufs des Messwerkzeugs (`tools/messe-lage.js`) teilen EINEN Zähler. Ist die Schwelle erreicht, sind alle späteren Abende desselben Prozesses gesperrt (Rückfall statt Modell). `messe-lage` weist einen so gesperrten Abend in `index.md` ausdrücklich aus („Kontingent erreicht: Abend N war wegen des Kontingents gesperrt“, dazu `zusammenfassung.kontingent_gesperrt` in `messung.json`) und nennt den prozessweiten Zähler.

## Befehl
`{ c: 'kontingent.freigeben' }` (`Protocol.CMD_KONTINGENT_FREIGEBEN`).
- Nur an der **Captain-Konsole** (`CMD_CONSOLE.kontingent = 'captain'`); jede andere Rolle bekommt die bestehende Absage
  „Dafür musst du an der passenden Konsole sein.“ (Ereignis `notice`).
- **Einmal-Sperre:** wirkt nur, wenn `world.kontingent.erreicht` wahr ist. Ein zweiter Druck erhöht nichts.

## Antwort (nur an den Absender)
Ereignis `{ t: 'event', kind: 'kontingentAntwort', pid, ok, code?, text? }`.
`ok: true` = freigegeben. `ok: false` mit `code`: `nicht_erreicht` (Kontingent noch nicht aufgebraucht, auch bei
Doppeldruck) | `fehler`; `text` ist der Klartext.

## Snapshot
`world.kontingent = { used, limit, schwelle, erreicht }`, **nur im Live-Modus** (`SPIELLEITER_LLM=live` und `LLM_LIVE=1`).
Sonst fehlt das Feld und der Snapshot ist byte-gleich zu vorher. Gesendet bei Änderung des Schlüssels (Zähler in
10 000er-Stufen, Limit, Schwelle, `erreicht`), nie in vollen Snapshots (Beitritt, Karten); eine neue Verbindung bekommt das
Feld mit dem nächsten Delta-Snapshot. `used` ist der Stand beim Senden (bis zu 10 000 veraltet).

## Snapshot-Budget (gemessen, N8)
Gemessen im echten Delta-Snapshot (`Buffer.byteLength(JSON.stringify(g.snapshot()))`, Live-Modus, Test `tools/test-kontingent.js` „Snapshot-Budget“): das Feld `world.kontingent` kostet **74 B** (Zähler 0), **78 B** (450 000 von 500 000) und höchstens **81 B** (siebenstellige Zahlen; JSON des Blocks allein 60 bis 67 B plus Schlüssel). Es steht nur im Snapshot, in dem sich der Schlüssel ändert (Stufe, Erreichen, Freigabe), nie in jedem. Worst Case von `npm run snap:mess` (Orbitschlacht) 13 327 B + 81 B = **13 408 B** gegen das Ziel ≤ 18 944 B; `snap:mess` selbst misst ohne Live-Schalter und bleibt unverändert.

## Client (A2): Rolle und Absagen
Der Client leitet die Rolle wie der Server ab: `Consoles.stationOf(me)` (public/js/consoles.js) = `Station.stationOf(p)` = `p.station || p.console`, nie `console` allein (Captain-Konsole mit Tab auf dem Steuer-Interface darf nicht, Helm-Spieler mit Tab auf dem Captain-Interface darf freigeben). Lehnt der Server den Befehl per `notice` ab (ohne `kontingentAntwort`), zeigt der Streifen den Text der Absage und gibt den Knopf sofort wieder frei, statt vier Sekunden lang „gesendet“ zu zeigen.

## Funk
Ereignis `radio` `{ from: 'Bordrechner', text }`, EINMAL je Schwelle beim Erreichen, auch ohne Spielleiter-Anfrage (Prüfung
je Spielschritt). Text: „Kontingent aufgebraucht: der Spielleiter antwortet aus der Konserve, bis die Captain-Konsole weitere
500 000 Tokens freigibt.“ Nur im Live-Modus. Die Meldung erscheint dadurch auch im Mitschnitt (MIT-01, Art `funk`).

## Regie-Logbuch
`art: 'kontingent'`: `ausgang: 'erreicht'` (einmal je Schwelle, auch ohne Live-Schalter) und `ausgang: 'freigabe'` (jede
wirksame Freigabe, mit Limit alt/neu), Feld `budget { used, limit }`.
