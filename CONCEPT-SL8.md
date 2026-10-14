# CONCEPT-SL8 – Notrufe (drei feste Rufe)

Grundlage: `Briefing Die Schuld der Lerche (SL0-SL12)` (SL8), Vault `Notrufe`, Kais Entscheidungen 2026-10-14. Team SL8. **Stand:** Konzept. Voraussetzungen: SL5 (Entschlüsseln),
SL4 (Sonde, Sektorplan), SL1B (Hexkartenanzeige), SL1 (Sund).

## 1. Befund
| Punkt | Stand |
|---|---|
| Notrufe im Code | keine. Nur `distress` bei Schützlingen/Verbündeten (`server/sim/escort.js:42,194,421`) |
| Weltsimulation / „Tick“ | nicht vorhanden; `game.tick` ist der 30-Hz-Serverschritt (`shared/config.js:12`). Vault-„Tick“ ist ein Begriff ohne Code |
| Hexkarte | `public/js/starmap.js`: Hexe, Kanten, Erkundungsstatus, Route; keine Anzeige von Missionen/Ereignissen (kommt mit SL1B) |
| Schnellsprung | `server/sim/reise.js`: `hop`/`abfangen` je Ankunft, `game.reise`; Spielzeit läuft weiter (`game.time`) |
| Szenen für die Folgen | Raumgefecht mit Hinterhalt (`wellen`/Regiebücher), Bergung/Entern (`server/sim/entern.js`, Landepunkte) vorhanden |
| Weltstand | `welt.fakten` nur Skalare; Liste offener Rufe braucht eigenen Block (`additionalProperties: false`, `weltstand.schema.json:79`) |

## 2. Entscheidungen (Kai 2026-10-14)
- **N1** Notrufe erscheinen **mit Ort auf der Hexkarte** (Marker am Hex, Ablaufanzeige), nicht nur als Liste; die Darstellung liefert SL1B, SL8 liefert Daten und Auswahl.
- **N2** Laufzeit in **Spielzeit-Sekunden** (`game.time`), Default **600 s**, **auch im Schnellsprung** weiterlaufend. „Tick“ im Vault entfällt als Begriff.
- **N3** Freischaltung zu **Beginn von Kapitel 7** (Baustein im Regiebuch, kein Zufall). Angebot, kein Zwang; Ignorieren ohne Folge in der Kampagne.
- **N4** Die drei Rufe sind Daten: **klar** (60 %-Klasse), **verschlüsselt echt**, **verschlüsselt Falle**. Reihenfolge frei, keiner pflicht.
- **N5** Sonde als Antwort (SL4) und Entschlüsseln (SL5, Ops allein) sind die beiden Prüfwege; Captain befragt den Absender mit festen Zeilen.
- **N6** Lohn in Marken (Studiowerte: klar 80, echt 120 + Passagier-Hinweis, Falle 0 und Hinterhalt). Allgemeine Verteilung 60/20/20 bleibt Config für später.

## 3. Entwurf
### Datenmodell
- Statisch `content/notrufe/*.json` (Format `notruf/1`): `{ id, hex, ort?, art: 'klar'|'verschluesselt', wahrheit: 'echt'|'falle'|'anders', behauptung: {wer, wie_viele, was}, messwerte: {lebenszeichen, reaktor, waffen, schiffe}, indizien: [text × 3], befragung: [{frage, antwort, ops_hinweis}], dauer, lohn, folge: { echt: 'regiebuch-id', falle: 'regiebuch-id' } }`.
- Laufzeit `game.notrufe = [{ id, bis (game.time), zustand: 'offen'|'angenommen'|'abgelaufen'|'erledigt', q (Entschlüsselqualität), sonde }]` (≤ 3 in der Kampagne, Obergrenze Config).
- Weltstand: neuer Block `welt.notrufe { <id>: { zustand, rest (verbleibende s), q } }` (Schema ergänzen, `BLOCK_DEFAULTS`); `rest` statt absoluter Zeit, weil `game.time` beim Laden neu beginnt.

### Layer-Schnitt
- **Storage:** `game.notrufe` + Weltstand-Block; Client-Selektor `state.notrufe` (Snapshot-Feld `nr`: je Ruf `{id, hex, art, rest, q}` ≈ 50 B, nur wenn vorhanden). `rest` wird nicht je Snapshot gesendet, sondern `bis` relativ zur Snapshot-Zeit (Client rechnet).
- **Action:** `server/sim/notrufe.js`: `freischalten(game, ids)` (Baustein `notrufe_freischalten`), `update(game, dt)` (Ablauf), `entschluesseln(game, id)` (ruft SL5 `startenNotruf`), `befragen(game, id, idx)`, `sondeAntwort(game, id)`
  (SL4-Ankunft liefert Messwerte, Qualität wird „wahr“), `hinfliegen(game, id)`, `ablehnen/weitermelden`, `folge(game, id)` → startet Regiebuch/Szene (`abfang`-artige Spawns für Hinterhalt über vorhandene Wellen-Bausteine).
  Nachrichten: `captain.notruf.befragen|hinfliegen|ablehnen`, `ops.notruf.entschluesseln|sonde`. Keine Flags an `reise.hop`; Notruf-Prüfung im Update-Schritt (`notrufe.update`) nach `reise.update`.
- **Frontend:** Hexkarte (SL1B) zeichnet Marker aus `state.notrufe` über `kartenzeichen.js`; Captain-Dialog `public/js/notruf.js` (Behauptung, Befragung, Entscheidung, Countdown); Ops-Reiter „Signal“ (SL5) zeigt Indizien nach Qualität.

### Ablauf
1. Kap. 7 beginnt: Baustein setzt die drei Rufe offen, Marker erscheinen auf der Hexkarte, ODA-Meldung „Notrufe empfangen“. Rest 600 s je Ruf (jeder startet bei Freischaltung; Studiowert, nach Spieleabend stellen).
2. Captain wählt aus Karte/Liste. Ops entschlüsselt (Qualität → Indizien 0–3), Captain befragt (feste Zeilen), Entscheidung: hinfliegen / Sonde / ignorieren.
3. Folge je Wahrheit: echt → Bergung (vorhandene Szene), Falle → Raumgefecht mit Hinterhalt, klar → direkte Hilfeleistung. Abgelaufen: Marker verschwindet, kein Abzug.
4. Schnellsprung: Ruf auf der Route fragt **nicht** „Abbrechen?“ (offene Frage aus dem Vault, Default entschieden: nur Karte, damit der Sprung nicht zerrissen wird); Ablauf läuft weiter.
5. Ruf-Ort liegt in Sund-Hexen (SL1); Hinterhalt-Gegner skaliert über `crewScale` (`space.js:1448`), „stark genug, aber schaffbar“.

## 4. Schnittstellen / Flags
Ereignisse `notrufOffen {id}`, `notrufAngenommen`, `notrufAbgelaufen`, `notrufErledigt {id, wahrheit}`; Fakten `notruf_<id>`, Zähler `notrufe_erledigt` (Abspann, Geldziel Kap. 8).
Regiebuch-Bedingung `notrufe_erledigt >= n`. Baustein `notrufe_freischalten { ids, dauer? }`. Abhängigkeit zu SL5: `entschluesselt`-Ereignis mit Qualität; zu SL4: `sondeAnkunft`.

## 5. Abnahme
Alle drei Rufe im Labor (Einstieg je Ruf), Marker auf der Hexkarte mit Ablauf, Ablauf auch im Schnellsprung, Entschlüsseln und Sonde als Antwort auf den unklaren Ruf, Falle führt in den Hinterhalt,
Speichern/Laden mit offenen Rufen (`rest` stimmt), Bot nimmt alle drei an und ignoriert einen, Snapshot unter Ziel (`snap:mess` mit 3 Rufen), `npm test`, `npm run check`.

## 6. Schätzung
Daten + Server 1 T · Captain-Dialog + Karten-Marker (Anteil SL1B getrennt) 1 T · Folgen/Bot/Labor/Tests 0,5–1 T → **2,5–3 T** (Briefing 2 T; SL1B-Kartenanzeige nicht enthalten).

## 7. Verbleibende offene Fragen an Kai
1. Werte (Ablauf 600 s, Lohn 80/120) als Studiowerte okay? Default: ja.
2. Rest läuft ab Freischaltung oder ab erstem Sichten (Default: ab Freischaltung, einfacher, vorhersagbar).
3. Soll ein ausgelaufener Ruf in Kapitel 7 neu erscheinen können („endlos farmen“)? Default: nein, einmalig; Geld aus Gasriese (7a) ist der Farmweg.
