# CONTRACT-LIV01 – Kontingent-Schranke des Token-Zählers (Paket A1: Server)

Vertrag zwischen Server (A1, `server/sim/kontingent.js`) und Client (A2: Anzeige und Taste). Der Client liest nur
dieses Dokument und `shared/protocol.js`.

## Verhalten
- Der Token-Zähler (`LLM.budget()`, EIN Zähler je Serverlauf, Limit `CLAUDE_TOKEN_BUDGET`, Standard 500 000) hat eine
  **Schwelle** = 90 % des Limits (500 000 -> 450 000; 60 000 -> 54 000).
- Ab `used >= schwelle` fragen Lage-, Abenteuer- und Missions-Spielleiter das Modell nicht mehr (kein CLI-Prozess); der
  bestehende Rückfallpfad greift, das Spiel bleibt spielbar. Die drei Spielleiter fragen `Kontingent.sperrt(game, minBudget)`.
- Das alte `min_budget`-Gate (30 000) ist auf `min(30000, limit - schwelle)` gedeckelt. Ist das Limit höchstens `min_budget`,
  bleibt es `min_budget` (Anfragen wären ohnehin unmöglich).
- **Freigabe** (`kontingent.freigeben`) hebt Limit UND Schwelle um 500 000. Danach fragt der Spielleiter wieder; erreicht
  der Zähler die neue Schwelle (950 000), kommt die Meldung erneut.
- Der Zähler gilt je Serverlauf und steht nicht im Weltstand (Format Version 3 unverändert).

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

## Funk
Ereignis `radio` `{ from: 'Bordrechner', text }`, EINMAL je Schwelle beim Erreichen, auch ohne Spielleiter-Anfrage (Prüfung
je Spielschritt). Text: „Kontingent aufgebraucht: der Spielleiter antwortet aus der Konserve, bis die Captain-Konsole weitere
500 000 Tokens freigibt.“ Nur im Live-Modus. Die Meldung erscheint dadurch auch im Mitschnitt (MIT-01, Art `funk`).

## Regie-Logbuch
`art: 'kontingent'`: `ausgang: 'erreicht'` (einmal je Schwelle, auch ohne Live-Schalter) und `ausgang: 'freigabe'` (jede
wirksame Freigabe, mit Limit alt/neu), Feld `budget { used, limit }`.
