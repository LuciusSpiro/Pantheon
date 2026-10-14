# CONCEPT-SL4 – Sonden und Sektorplan (Kampagne „Die Schuld der Lerche“)

Grundlage: `Briefing Die Schuld der Lerche (SL0-SL12)` (SL4), Vault `Sonden`, `Sektoren & Sprünge#Sektorplan für den Captain`, Kais Entscheidungen 2026-10-14
(Vault `Kampagne Die Schuld der Lerche`). Team SL4. **Stand:** Konzept, noch nichts gebaut. Schwesterpakete: SL1 (Kartenwahl, Kante enthüllen),
SL1B (`CONCEPT-SL1B.md`: Karten- und Missionsanzeige; bei Erstellung dieses Konzepts noch nicht vorhanden, Andockstelle siehe 4.5), SL5, SL8.

## 1. Befund (geprüft am Code, `main` 87ff7a7)
| Punkt | Stand |
|---|---|
| Namenskonflikt `sonde` | Kustoden-Sonden-Code-Abgleich der Plattform-Außenkarte: `server/game.js:35,1055,1821`, `shared/protocol.js:213`, `public/js/consoles.js:37,2393`, `server/sim/away.js:25,89,451`, `interior.js:136,574,849`, `mission.js:165`, `mission/objects.js:83,141`, `landepunkte.js:140`, Labor-ID `raetsel_loesen/sonden_code` (`mission/labor.js:165`) |
| Simulation | genau **eine** Szene (`game.space`, `game.js:390`); `enterScene` (`space.js:96`) verwirft Gegner und Geschosse. Nachbarsektoren sind nur Daten (Hex-Eintrag, `GEN.erzeuge`, `shared/sektoren.js:163`) |
| erkundet / gesichtet | nur `explore.erkundet` (Set, `explore.js:35`). `hexBekannt` (:246) und `hexErkundet` (:254, steuert `reise.planen`, `reise.js:25`) sind getrennt: ein **zusätzliches Set `gesichtet`** lässt den Schnellsprung automatisch gesperrt |
| Weltstand | `welt` hat `additionalProperties: false` (`content/schema/weltstand.schema.json:79`): neue Blöcke brauchen Schemaeintrag. `welt.sektoren` dagegen ohne `additionalProperties: false` (:118); ob `normSektoren` (`server/weltstand.js`) Fremdschlüssel verwirft, ist nicht gelesen → beim Bau prüfen |
| Snapshot | Grenze 20 KB (`config.js:145`), Ziel ≤ 18 944 B, gemessene Worst Cases 11,4–13,8 KB (CONTRACT-EK8). Luft ≈ 5 KB. `world.sektoren` geht nur bei Versionsänderung (`game.js:1715`) |
| Sektoransicht | gibt es nicht. Lage (lokal, Marker, Scan) in `consoles.js:879-925`, Hexkarte in `public/js/starmap.js`, `game.plan.pins` (`game.js:356`) |
| Ortsfeste Inhalte eines Nachbarsektors | **deterministisch aus gemeinsamem Code**: `shared/gen-sektor.js` (Seed = Hex-Kennung), Client und Server erzeugen dasselbe. Szene 3000×2200, Station, Brocken, Planeten, Bojen sind Daten |

## 2. Entscheidungen (Kai 2026-10-14, übernommen)
- **S1** Sektorplan = **echte Sektoransicht mit Positionen** plus Symbolliste (nicht nur Hex-Symbole).
- **S2** Sonden im Nachbarsektor liefern **nur Ortsfestes**; Schiffe sind **feste Regiebuch-Daten** je Hex (Momentaufnahme mit Alter), keine Simulation.
- **S3** Alt-Sonde heißt künftig **Kustodenpult** (eigener Commit, früh, mit Golden-Abweichungsliste). Neue Sonde heißt **Sonde**.
- **S4** Start mit 3 Sonden, nachkaufbar im Hafen; Preis legt das Studio fest: **60 Marken** (Start 150). Endloses Farmen ist erlaubt.
- **S5** Sondenflug in der Szene: Gegner sehen und beschießen sie. Der Sektor gilt nach einer Sonde als **gesichtet**, nie als erkundet.

## 3. Rename (Paket SL4-0, vor allem anderen, eigener Commit)
`sonde` → `kustodenpult`: Konsolen-ID (`CMD_CONSOLE`, `protocol.CONSOLES`), Nachricht `kustodenpult.input`, `away.sonde` → `away.pult`, Karten-Zeichen und Texte
(„Die Sonde unten links…“ → „Das Kustodenpult…“), Labor-ID `raetsel_loesen/pult_code`, Kommentare. Der Weltstand-Schlüssel `away.sonde` wird nicht gespeichert
(nur Laufzeit, zu bestätigen). Golden-Texte ändern sich → Abweichungsliste, Eisenwald und Tutorial m2 laufen weiter. Anzeigetext „KUSTODEN-SONDE“ → „KUSTODENPULT“.

## 4. Entwurf
### 4.1 Datenmodell
- Laufzeit `game.sonden[]`: `{ id, x, y, vx, vy, ziel: {x,y} | {kante}, zustand: 'fliegt'|'sendet'|'springt'|'weg', hp, bis }` (≤ 3 gleichzeitig, Obergrenze Snapshot).
- Vorrat: `inventory.sonden` (Zahl), Start 3 (`economy.startInventory`), Shop-Eintrag `sonde` (60 Marken, `shop.js`).
- Sektorplan: `explore.gesichtet = { [hex]: { quelle: 'erkundung'|'sonde'|'karte', t } }`; Weltstand `welt.sektorplan` (neuer Block, Schema ergänzen) mit
  `gesichtet`, `marken[]` (Captain-Einträge: Ort + Art, ≤ 24) und `schiffe[{hex, art, x, y, t}]` (Momentaufnahme, ≤ 12; `t` = `game.time` der Sicht).
- Statische Daten: `content/welt/*.json` Hex-Eintrag erhält optional `schiffe: [{art, x, y}]` (Regiebuch-Daten, nur für Sonden-Sicht).

### 4.2 Layer-Schnitt (nach CLAUDE.md)
- **Storage:** `explore` (Erkundung) bleibt Quelle der Wahrheit; neues `server/sim/sektorplan.js` hält `gesichtet/marken/schiffe` mit `toSave/restore` (Weltstand-Block) und
  `sektorplanVersion`. Client: Store-Selektor `state.sektorplan` (aus `world.sektoren.g` und eigener Nachricht), nicht per Props durchgereicht.
- **Action:** `server/sim/sonden.js` (benannte Funktionen: `starteInSzene(game, ziel)`, `starteDurchSprungpunkt(game, kante)`, `updateSonden`, `abgeschossen`,
  `ankunftNachbarsektor` → `sektorplan.sichten(hex, 'sonde')`), `sektorplan.js` (`sichten`, `markeSetzen`, `momentaufnahme`, `ansicht(hex)`), Shop-Kauf in `shop.js`.
  Nachrichten: `ops.sonde.start { ziel }`, `ops.sonde.sprung { kante }`, `captain.sektorplan.marke`, `captain.sektorplan.ansicht { hex }`. Kein Flag an bestehenden Funktionen.
- **Frontend:** Ops-Panel „Sonden“ (Taktik-Konsole, neuer Reiter, Vorrat, Ziel auf Karte klicken, Kante wählen); Captain-Tab „Sektorplan“ in neuer Datei
  `public/js/sektorplan.js` (nicht `consoles.js` verlängern); Sonden als Symbol in Taktikkarte und Lage (`render.js`).

### 4.3 Ablauf
1. **In der Szene:** Ops setzt ein Ziel; die Sonde fliegt gerade dorthin (`Physics`-Schritt wie Geschoss, Tempo ~ 2× Lerche), sendet, bis sie zerstört ist oder `bis` (Spielzeit, 300 s)
   abläuft. Gegner, die sie sehen, zielen auf sie (Priorität niedrig; gleiche Regeln für alle). Im Sendebereich (Config `sonden.reichweite`) werden Ziele wie beim Weitscan/Brocken bekannt:
   Ergebnis in die Ops-Taktikkarte, Gasriese (SL6): Tiefenmessung.
2. **Durch den Sprungpunkt:** Ops wählt eine Kante der Szene; die Sonde fliegt zum Sprungpunkt, verschwindet und meldet nach `sonden.sprungZeit` (z. B. 20 s Spielzeit) den Nachbarsektor:
   `sektorplan.sichten(hex, 'sonde')`. Leerraum und unerkundete Sektoren sind erlaubt, gesperrte (`spielbar: false`) nicht. Meldung per ODA-Zeile und Ereignis `sondeAnkunft`.
   Die `schiffe` des Hex-Eintrags kommen mit Alter 0 in die Momentaufnahme; „Abschuss“ im Nachbarsektor wird nur erzählt (Regiebuch-Flag `sonde_abgeschossen`), nicht simuliert.
3. **Sektorplan:** Der Client erzeugt die ortsfeste Szene **selbst** aus `Shared_GenSektor.erzeuge(hex, daten)` (Position, Station, Planeten, Bojen, Einfluss). Server liefert nur
   `gesichtet` (Hexe), Captain-Marken und Schiffe. Erkundete und gesichtete Hexe sind in der Ansicht gleich vollständig; unbekannte zeigen Umriss. Schiffe tragen „vor 4 min“.

### 4.4 Snapshot-Budget
Ortsfeste Szene kostet 0 Byte (Client-Generator). `world.sektoren.g`: Liste gesichteter Hexe (4 B + Trenner, ≤ 30 Hexe ≈ 150 B, nur bei Versionsänderung). Schiffe/Marken: eigene
Antwort auf `captain.sektorplan.ansicht` (kein Dauer-Snapshot; ≤ 1,5 KB je Antwort). Sonden: `space.so` ≤ 3 Einträge à ≈ 40 B = ≈ 120 B (nur bei vorhandenen). Worst Case +0,3 KB,
messen mit `npm run snap:mess` (neuer Aufbau „sonde“). Vorbehalt: Ob die Client-Erzeugung für alle Hex-Arten (Leerraum, Datenorte, LOCATIONS-Handszenen wie Tutorial) gleichwertig ist,
ist nicht geprüft; Handszenen (`shared/locations.js`) müssten ihre Symbole ebenfalls als Daten liefern → Aufwand 0,5 T im Ansatz enthalten.

### 4.5 Andockstelle zu SL1B
Gemeinsamer Zeichencode in **neuer Datei `public/js/kartenzeichen.js`** (Symbole, Hex-/Szenen-Projektion, Fraktionsfarben, Alterstext) – genutzt von `starmap.js` (SL1B) und
`sektorplan.js` (SL4). Schnittstelle: `Kartenzeichen.symbol(art) -> Sprite`, `Kartenzeichen.szeneZuPixel(hex, rect)`, `Kartenzeichen.zeichneObjekte(ctx, liste, rect)`.
Server-Seite: eine **Marker-Liste je Hex** `{ art, x?, y?, name, quelle, t }` als gemeinsames Format für Missionen, Notrufe (SL8) und Sektorplan-Marken. Wird SL1B später anders geschnitten,
ändert sich nur `kartenzeichen.js`.

## 5. Schnittstellen / Flags
Ereignisse: `sondeGestartet`, `sondeZerstoert`, `sondeAnkunft {hex}`, `hexGesichtet {hex}` (Regiebuch-Bedingungen, Bausteine `sektor_sichten { hex }` für feste Kapitel). Weltstand-Fakt
`sonden_gestartet` (Zähler für Abspann). Eisenwald nutzt keine Sonden: Vorrat steht aber im Weltstand → Schema defaulted (`inventory.sonden` fehlt = 0 für alte Stände).

## 6. Abnahme
Sonde in der Szene (Ziel, sendet, Abschuss durch Gegner), Sonde durch Sprungpunkt in erkundeten, unerkundeten und Leerraum-Hex, danach **nur gesichtet** (Schnellsprung dorthin verweigert,
Test), Sektoransicht zeigt Szene, Marken, Schiffe mit Alter, Speichern/Laden (Weltstand, Altstand ohne Block lädt), Vorrat 3 → kaufen im Hafen, Bot setzt Sonden ein, Snapshot unter Ziel,
Rename mit Golden-Abweichungsliste, `npm test`, `npm run check`, Eisenwald läuft durch.

## 7. Schätzung
Rename 0,5 T · Sonde Szene 1,5 T · Sonde Sprungpunkt + `gesichtet` + Weltstand 1 T · Sektoransicht Server + Client + gemeinsame Zeichen 2,5 T · Shop, Bot, Tests, Messung 0,5 T
→ **ca. 6–6,5 T** (Kais Richtwert 6 T; Unsicherheit: Generator-Szene in der Ansicht und Layout im vollen Captain-Fenster, +1 T Reserve).

## 8. Verbleibende offene Fragen an Kai
1. Sondenpreis 60 Marken und Reichweite/Dauer (300 s) als Studiowerte okay? (Default: ja, nach Spieleabend nachstellen)
2. Soll die Sonde in der Szene auch auf dem Sektorplan landen (Ortsfestes im Sendebereich als „gesichtet“-Detail)? Default: ja, nur Symbole, keine Schiffe.
3. Gekaufte Karten (Quelle `karte`) gehören nicht zu SL4; Default: Schnittstelle `sektorplan.sichten(hex, 'karte')` bleibt, Kaufoberfläche später.
