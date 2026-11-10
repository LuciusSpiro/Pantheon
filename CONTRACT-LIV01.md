# CONTRACT-LIV01 – Kontingent-Schranke des Token-Zählers (A1 Server, A2 Client, LIV-02 Systeminfo und Frage)

Vertrag zwischen Server (`server/sim/kontingent.js`) und Client (`public/js/kontingent-frage.js`, `kontingent-frage-ui.js`). Der Client liest nur
dieses Dokument und `shared/protocol.js`. Stand nach LIV-02: das Kontingent-Ende ist eine Systeminfo, kein Spielinhalt (kein Funk, kein
Snapshot-Feld, keine Captain-Freigabe, keine Taste, kein Streifen; alles das ist entfernt).

## Verhalten
- Der Token-Zähler (`LLM.budget()`, EIN Zähler je Serverlauf, Limit `CLAUDE_TOKEN_BUDGET`, Standard 500 000) hat eine
  **Schwelle** = 90 % des Limits (500 000 -> 450 000; 60 000 -> 54 000).
- Ab `used >= schwelle` fragen Lage-, Abenteuer- und Missions-Spielleiter das Modell nicht mehr (kein CLI-Prozess); der
  bestehende Rückfallpfad greift, das Spiel bleibt spielbar. Die drei Spielleiter fragen `Kontingent.sperrt(game, minBudget)`.
- **Notbetrieb ohne BUDGET:** ein Abbruch wegen `BUDGET` (Kontingent erreicht, Rest zu klein) löst keinen Hinweis „Spielleiter arbeitet im Notbetrieb“ aus (`content/welt/notbetrieb-hinweis.json`, Test `tools/test-notbetrieb-hinweis.js`); der Rückfall läuft still weiter.
- **Jeder Weg zu Claude fragt das Gate** (Nacharbeit M1/M2): auch die **Eskalation** des Abenteuer-Spielleiters (`Kontingent.sperrtEskalation`, vor `losschicken(job, true)`; eine ungültige Ollama-Antwort geht ab der Schwelle nicht mehr an Claude, auch wenn die Schwelle erst während des Jobs erreicht wurde) und der **Text-Pool** (`server/sim/texte-pool.js`: Stufe bei Claude, z. B. `LLM_ANBIETER_GERUECHTE_FUNK=claude`, und seine Eskalation, z. B. `LLM_ESKALATION_FIGUREN_NEBEN=1`; `Kontingent.sperrtClaude` / `sperrtEskalation`). Ollama-Anfragen ohne Claude bleiben frei, der Rückfall ist wie bisher (Katalogtext). Der Missions-Spielleiter hatte das Gate schon für Eskalation und Claude-Stufen. Das Messwerkzeug für den Text-Pool fragt ohne Spiel und bleibt ungebremst.
- Das alte `min_budget`-Gate (30 000) ist auf `min(30000, limit - schwelle)` gedeckelt. Ist das Limit höchstens `min_budget`,
  bleibt es `min_budget` (Anfragen wären ohnehin unmöglich).
- **Freigabe** (`kontingent.freigeben`) hebt Limit UND Schwelle um 500 000. Danach fragt der Spielleiter wieder; erreicht
  der Zähler die neue Schwelle (950 000), wird erneut gemeldet und gefragt.
- Der Zähler gilt je Serverlauf und steht nicht im Weltstand (Format Version 3 unverändert).
- **BUDGET gilt prozessweit**, nicht je Raum und nicht je Abend: alle Räume und alle Abende eines Laufs des Messwerkzeugs (`tools/messe-lage.js`) teilen EINEN Zähler. Ist die Schwelle erreicht, sind alle späteren Abende desselben Prozesses gesperrt (Rückfall statt Modell). `messe-lage` weist einen so gesperrten Abend in `index.md` ausdrücklich aus („Kontingent erreicht: Abend N war wegen des Kontingents gesperrt“, dazu `zusammenfassung.kontingent_gesperrt` und `zusammenfassung.kontingent { erreicht, schwelle, used }` in `messung.json`) und nennt den prozessweiten Zähler.

## Meldung beim Erreichen (einmal je Schwelle)
Geprüft je Spielschritt (`Kontingent.pruefen`), auch ohne Spielleiter-Anfrage:
- **Systemzeile** im Server-Log (`game.log`): `[Kontingent] Limit erreicht (used von limit, Schwelle s): ...`.
- **Regie-Logbuch** `art: 'kontingent'`: `ausgang: 'erreicht'` (auch ohne Live-Schalter), `'freigabe'` (jede wirksame Freigabe, mit Limit alt/neu) und `'abgelehnt'`; Feld `budget { used, limit }`.
- **Frage „Limit erhöhen?“**, nur im Live-Modus (`SPIELLEITER_LLM=live` und `LLM_LIVE=1` im Env des Spiels): siehe unten. Kein Funk, kein Snapshot-Feld, nichts im Mitschnitt außer dem Logbuch.

## Frage und Befehle
Ereignis `{ t: 'event', kind: 'kontingentFrage', pid }` (ohne Zahlen) geht **nur an den Spieler mit `p.color === 0`** (blaue Markierung, erster Slot), solange er verbunden ist, **nur in der Spielphase (`phase !== 'lobby'`) und im Live-Spielleiter dieser Partie** (`Kontingent.live(game)`, nicht im Rückfall-Betrieb; in der Lobby werden Befehle verworfen). Sie bleibt offen, bis er antwortet, und wird beim Beitritt, Wiederverbinden und der Übernahme eines Slots mit color 0 erneut zugestellt (`Kontingent.frageZustellen`) sowie beim Start der Partie nachgestellt (`startGame`). **Frage und „Nein“ gehören wie der Zähler zum Prozess, nicht zur Partie** (bewusst: Nein ist Nein): eine offen gebliebene Frage steht in der nächsten Live-Partie wieder an, ein Nein gilt für diese Schwelle auch dort.
- `{ c: 'kontingent.freigeben' }` (`Protocol.CMD_KONTINGENT_FREIGEBEN`) = **Ja**: Limit und Schwelle +500 000.
- `{ c: 'kontingent.ablehnen' }` (`Protocol.CMD_KONTINGENT_ABLEHNEN`) = **Nein**: schließt die Frage für diese Schwelle endgültig. **Nein ist Nein:** für dieselbe Schwelle kommt keine neue Frage und keine Freigabe mehr (`freigeben` liefert `abgelehnt`).
- Beide Befehle brauchen keine Konsole, gelten aber **nur für color 0**; jeder andere Spieler bekommt ein `notice` („Über das Limit entscheidet der Spieler mit der blauen Markierung.“).
- **Einmal-Sperre:** Freigabe wirkt nur, wenn die Schwelle erreicht ist (`Kontingent.erreicht()`) **und eine OFFENE Frage der aktuellen Schwelle steht** (wie Ablehnen); ein zweiter Druck erhöht nichts (`nicht_erreicht`), ohne Frage (kein `pruefen()` bisher, andere Schwelle) oder im Nicht-Live-Betrieb gilt `keine_frage`. Ablehnen wirkt nur bei offener Frage im Live-Betrieb (`keine_frage`). Erreicht der Zähler die Schwelle in einer Partie ohne Live-Spielleiter, bleibt die Frage offen und wird gestellt, sobald in derselben Partie der Live-Spielleiter läuft (Lobby-Option).

## Antworten (nur an den Absender)
- `{ t: 'event', kind: 'kontingentAntwort', pid, op, ok, code?, text? }`: `op` ist `freigeben` oder `ablehnen`; `ok: true` = ausgeführt. `ok: false` mit `code`: `nicht_erreicht` | `abgelehnt` | `keine_frage` | `fehler`; `text` ist der Klartext.
- `{ t: 'event', kind: 'kontingentErledigt', pid }`: die Frage ist geschlossen (außer bei `code: 'fehler'`: dann bleibt sie offen und der Client gibt die Knöpfe wieder frei).

## Client
Leiste `#kontingentFrage` (DOM, nicht modal, kein Fokusfang, keine Taste, keine Pause, nur Ja/Nein per Maus; Knöpfe `tabindex=-1`, `contextmenu` unterdrückt), nur solange der Server die Frage stellt; ohne Frage entsteht nie ein DOM-Element. Sie trägt keine Zahl. **Lage:** einzeilig am unteren Rand, in Canvas-Einheiten x 356..630, y 343..359 (16 hoch), umgerechnet mit `Client.scale` auf die Canvas-Fläche (`left = canvasLeft + 356*scale` usw., Unterkante fest; wächst bei kleiner Skala nach oben, damit der Knopf mindestens 24 px hoch ist); neu gesetzt bei Resize/Skalenwechsel. Zu Fuß (ohne Konsole) liefert `Hud.kontingentLeiste(view)` über `Client.kontingentLeiste` eine höhere Lage über Boden-Panel, ODA-Zeile und Funkwahl. **Aussehen:** Grund rgba(11,14,26,.85), 1 px #FFC66B, kein Schatten, wie das Siegel „Weltstand gesichert“ (das bei offener Frage an den Konsolen auf „Gesichert“ kürzt, damit es vor x 352 endet); Text „Spielleiter-Limit erreicht · erhöhen?“ (Kurzform „Limit erhöhen?“, wenn er nicht passt), Schrift 8 x Skala (mindestens 13 px), Ja/Nein gleich gestaltet (transparent, Rand #8EA3B5, Hover #FFC66B), Knopfhöhe mindestens max(24 px, 14 x Skala); Fehlerfall: Text „Hat nicht geklappt · noch einmal?“ in #F2C94C mit Rand #F2C94C, nie mehr als eine Zeile. Doppelklick: bis zur Antwort (höchstens 4 s) geht kein zweiter Befehl hinaus; lehnt der Server per `notice` ab (nur die Absage „…blauen Markierung“ zählt, fremde Hinweise nicht), zeigt die Leiste den Fehlertext und gibt die Knöpfe frei. Alle anderen Spieler sehen nichts Kontingent-Bezogenes (weder DOM noch Funk noch Snapshot-Feld). `welcome` leert den Zustand.

## Werkzeuge
`tools/live-abend.js` und `tools/messe-lage.js` lesen den Zähler über den Server (`Kontingent.erreicht()`, `schwelle()`, Regie-Logbuch), nicht über Funk oder Snapshot. Der Bot-Client (`tools/lib/bot-crew.js`) sammelt das Ereignis `kontingentFrage` und die Antworten; mit `--freigeben` sendet der Bot mit color 0 `kontingent.freigeben`, ohne den Schalter antwortet er nicht. Sichtprüfung im Browser: `tools/sicht-kontingent.js`.

## LIV-02: was entfallen ist
Funk „Kontingent aufgebraucht“ (Bordrechner), Snapshot-Feld des Zählers, Freigabe an der Captain-Konsole (`CMD_CONSOLE.kontingent`), Tastenaktion zur Freigabe, Streifen oben im Bild, `public/js/kontingent.js` und `kontingent-ui.js`. `tools/test-kontingent.js`, `tools/test-kontingent-frage.js` und `tools/test-notbetrieb-hinweis.js` prüfen die Abwesenheit.
