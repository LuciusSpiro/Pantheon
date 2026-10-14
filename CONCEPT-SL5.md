# CONCEPT-SL5 – Signal entschlüsseln und Spur verfolgen

Grundlage: `Briefing Die Schuld der Lerche (SL0-SL12)` (SL5), Vault `Ops-Missionen#6. Spur verfolgen`, `Minispiele` (Scannen), Kais Entscheidungen 2026-10-14. Team SL5.
**Stand:** Konzept. Voraussetzungen: SL1 (Kartenwahl **und „Kante enthüllen“**), SL4 (Sektorplan, Sonde). Folgepaket: SL8.

## 1. Befund
| Punkt | Stand |
|---|---|
| Minispiel „Scannen“ (Frequenz abstimmen) | **fehlt**. Vorhanden: Ziel-Scan als Halte-Fortschritt (`server/sim/space.js:1325-1390`, `config.tscan`), Captain-Scan an Boje (`consoles.js:895-909`), Weitscan (`space.js:1390`), Reparatur-Minispiele (`damage.js:15`) |
| Funk | `game.radio` / `mission.radio` (Text, Sprecher, optionale Annahme); kein verschlüsselter Text, keine Schicht-Logik |
| Hidden-Kanten | `limes.json:98` kennt `art: hidden`, aber hart gesperrt: `explore.js:275`, `sprung.js:85,332,368`. Ohne SL1-„Kante enthüllen“ kann die Spur nicht ans Ziel führen |
| Spur | gibt es nicht. Bausteine: Schnellsprung (`reise.js`), Bojen (`explore.markBoje`), Sektorplan (SL4) |
| Weltstand | `welt` mit `additionalProperties: false` (`weltstand.schema.json:79`) → neuer Block `welt.spur` braucht Schemaeintrag; Fakten (`welt.fakten`) taugen für Flags, nicht für Listen |
| Zeitbegriff | kein „Tick“ im Code (`game.tick` = 30-Hz-Schritt). Spur hat in der Kampagne **keine Uhr** |

## 2. Entscheidungen
- **E1** Entschlüsseln: **Ops allein**, lösbar solo; Qualität 0–3 (Indizien) bzw. versteckte Schicht nur bei Qualität 3. (Kai 2026-10-14)
- **E2** Spur hängt an SL1 „Kante enthüllen“: Das Ende der Spur ruft `sprung.kanteEnthuellen` auf. Bis SL1 geliefert ist, Stub mit demselben Aufruf (Test mit `temp`-Kante).
- **E3** Spur ohne Verblassen in der Kampagne (Config `spur.verblassen: false`); allgemein vorbereitet über `alter` in Spielzeit-Sekunden.
- **E4** Teilung (Täuschkörper): optional in SL5, in der Kampagne mind. **eine** Teilung in Kapitel 6.
- Studio: Entschlüssel-Dauer 20–30 s; Qualität nach Treffgenauigkeit über das Zeitfenster.

## 3. Entwurf: Entschlüsseln
### Datenmodell
Aufgabe `entschl { id, quelle, schichten: [{ text, ab: 0|1|2|3 }], gewaehlt?, qualitaet?, zustand: 'offen'|'laeuft'|'fertig' }`; als **Regiebuch-Datum** (Funk mit
`verschluesselt: { schichten }`) oder Notruf-Datum (SL8: `indizien[]`). Laufzeit `game.entschl = { aufgabe, f, zielF, rausch, t, halt }` (eine gleichzeitig). Weltstand: nur Ergebnis als
Fakt `entschl_<id>` = Qualität (0–3); kein Zwischenstand gespeichert (läuft die Aufgabe beim Speichern, startet sie neu).

### Spielablauf
Ops öffnet das Signal im Taktik-Reiter „Signal“. Eine Frequenz `f` (0…1) wird mit Regler (Pfeile/Mausrad) gestellt; das Zielband `zielF` wandert langsam (Config `entschl.drift`, stark in
Einflusszonen wie Nebel/SL6 – gleiche Regel für alle). Je Sekunde im Band wächst `halt`; Fertig bei `halt ≥ 1`. **Qualität** = Anteil Zeit im engen Band (0–3, Schwellen 0,4/0,65/0,9). Server ist
autoritativ (Eingabe `ops.entschl.stimme {f}` 10 Hz); Client zeigt Rauschen, das mit Qualität aufklart. **Abbrechen** erlaubt (Qualität = bisher). Text je Qualität aus `schichten[].ab ≤ q`.

### Layer
- **Storage:** `game.entschl` (Server), Client-Selektor `state.entschl` aus Snapshot-Feld `en` (nur während aktiv, ≈ 60 B). Ergebnisse im Weltstand-Fakt.
- **Action:** `server/sim/entschluesseln.js`: `starten(game, quelle)`, `stimme(game, p, f)`, `update(game, dt)`, `abbrechen`, `ergebnis(game)` → Ereignis `entschluesselt {id, qualitaet}` (Regiebuch-Bedingung).
  Kein Boolean-Parameter: Varianten als Funktionen (`startenNotruf`, `startenFunk`).
- **Frontend:** `public/js/entschluesseln.js` (Widget, Zeichnung, Eingabe), eingehängt in `consoles.js` nur als ein Aufruf.

## 4. Entwurf: Spur
### Datenmodell
Statisch `content/spuren/<id>.json`: `{ id, kanten: [{von, nach, verdeckt?}], teilungen: [{ab, aeste:[{echt, indiz}]}], ende: { kante, enthuellt }, alter0 }`.
Laufzeit/Weltstand `welt.spur { id, idx, aktiv, geteilt, gewaehlt[] }` (neuer Block, Schema ergänzen, `BLOCK_DEFAULTS`).

### Ablauf (je Hex)
1. Die Spur beginnt am Tatort (Ereignis/Baustein `spur_starten { id }`).
2. Im Hex: Navigation fliegt die Spurbahn (Ziel-Marker im Szenen-Raum, wie Sprungpunkt-Lage, `sektoren.sprungpunktLage`); die Ops „liest“ (Halte-Scan wie `weapons.scan`, Dauer 5 s): Ergebnis **Kante und Alter** (Alter = `game.time − t0`, Anzeige „vor 12 min“, für die Kampagne fest).
3. Captain trägt die Kante im Sektorplan ein (`captain.sektorplan.marke` mit Art `spur`) und wählt den Sprungpunkt (normale Sprungregeln; Spurkanten sind offene Kanten oder enthüllt).
4. Teilung: zwei Äste; die Ops liest Indizien (Masse, Antriebssignatur) → Hinweis „Ast A echt (Masse passt)“; Qualität 3 des Signals (SL5-Entschlüsseln) macht das Indiz eindeutig. Falscher Ast: nächster Hex zeigt Spur-Ende (Lage-Hinweis), zurück.
5. Ende: letzter Hex der Spur löst `sprung.kanteEnthuellen(kante)` (SL1) aus → verborgene Kante nach Schrottkante nutzbar; Sonde kann vorausschauen (SL4: Hex `gesichtet`, Verteidiger als feste Schiffe).

### Layer
- **Storage:** `welt.spur` (Server) + Client `state.spur` (Feld `sp` im Snapshot, ≈ 40 B nur bei aktiver Spur).
- **Action:** `server/sim/spur.js` (`starten`, `lesen(game)`, `weiter(game, hex)`, `aeste`, `wahl`, `ende`), Baustein `spur_starten` in `server/mission/bausteine/sektor.js` (Katalog `bausteine.json`).
- **Frontend:** Ops-Anzeige „Spurlesen“ in `entschluesseln.js` oder eigenem Teil, Spurmarke auf Sektoransicht und Hexkarte (über `kartenzeichen.js`, siehe SL4 4.5).

## 5. Schnittstellen / Flags
Ereignisse `entschluesselt`, `spurGelesen {hex, kante}`, `spurEnde`. Fakten `entschl_<id>`, `spur_<id>_ende`. Nachrichten `ops.entschl.start|stimme|abbrechen`, `ops.spur.lesen`. Config `entschl.*`, `spur.*`.
Neue Weltstand-Schemafelder: `welt.spur`; Eisenwald-Stände ohne Block laden mit Defaults.

## 6. Abnahme
Entschlüsseln mit Qualität 0, 1, 2, 3 (Texte, versteckte Schicht nur bei 3), Drift im Nebel, Abbruch; Spur über ≥ 3 Hexe bis zur verborgenen Kante (Bot), Teilung erkannt (Bot mit/ohne Indiz),
Speichern/Laden mitten in der Spur, Snapshot unter Ziel (`snap:mess` Aufbau „spur“), Golden unverändert (Tutorial/Eisenwald), `npm test` und `npm run check`.
Bot: Entschlüssel-Bot trifft das Band gezielt (Qualität wählbar).

## 7. Schätzung
Entschlüsseln Server + Client + Bot 2 T · Spur Server + Daten + Bot 1,5 T · Spur-Anzeige, Teilung, Test 1 T · **4,5 T** (Briefing 2–3 T; höher wegen neuem Minispiel und Abhängigkeit zu SL1/SL4).
Risiko: Abhängigkeit „Kante enthüllen“ (SL1); ohne sie Stub.

## 8. Verbleibende offene Fragen an Kai
1. Entschlüsseln-Minispiel: reines Frequenzband (Default) oder zusätzlich Rauschfilter? Default: nur Frequenzband.
2. Gleiche Entschlüssel-Qualität für alle Quellen (Funk Kap. 5, Notrufe, Boje SL10)? Default: ja, ein Baustein.
3. Falscher Ast: Zurückwerfen ohne Strafe (Default) oder Zeitverlust/Hinterhalt?
