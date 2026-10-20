# CONTRACT-PAN01-D – Werft und Terminal: Server und Daten (D1), Terminal-Oberfläche (D2, ab §12)

Auftrag PAN-01 (Vault `Pantheon/Auftrag PAN-01 – Lerche-Ausbau, Werft, Waffen und Module`), Paket D, Abnahme 15, 16, 18, 20 und Teile von 17 und 21. Branch `pan01-d` (von `pan01-c` 719b123).
Das Terminal (UI) folgt in D2 nach der Gestaltung (`CONTRACT-PAN01-D-GESTALTUNG.md`). Dieser Contract: Daten, Befehle, Snapshot, Weltstand, Preise, Entscheidungen, Debug.

## 1. Ortsfeld `flottenbasis`
- `content/welt/limes.json` Hex 0202 Castra Martis (`ort: castra_martis`) und `content/welt/sund.json` Hex 0304 Castra Gradivi (noch ohne `ort`: Vorbereitung für das freie Spiel) tragen `"flottenbasis": true`.
  Feindliche Basen (Skjaldborg u. a.) tragen es nicht. `shared/gen-sektor.js` reicht es als `loc.flottenbasis` durch. Prüfung: `tools/check-sektoren.js` Abschnitt `[flottenbasis]`.
- **Nicht fest verdrahtet** (Auftrag Punkt 12): `Werft.istFlottenbasis(game, ort)` gilt auch für das Flag `mission.flags['flottenbasis_<ort>']`; ein späteres Modul (Weltsimulation) setzt es mit `Werft.setzeFlottenbasis(game, ort, an)`. Die Flags werden mit dem Weltstand gespeichert.
- `Werft.status(game)` → `{ aktiv, code?, grund? }`: aktiv nur angedockt an einer Flottenbasis; sonst `nicht_angedockt` („Nicht angedockt“) bzw. `keine_flottenbasis` („Nur an Flottenbasen“). **Handel (`shop.buy`) läuft in jedem Hafen wie bisher.**

## 2. Zustand am Schiff
`game.ship.freigeschaltet = { stufe, waffen: [ids], module: [ids] }` (`server/sim/werft.js`). Start-Lerche: Stufe 0, Lanze, Standardbatterie, Frachtraum, Krankenstation. Alles andere kostet Marken, einmalig, und gehört dann dem Schiff.
**Kein Rückgabe- oder Verkaufsweg** (nicht gebaut, Test prüft das Protokoll). `ship.stufe` ist der Ist-Stand, `freigeschaltet.stufe` die höchste gekaufte Stufe; Kauf einer Stufe setzt `Ausbau.setStufe` sofort.

## 3. Befehle (Konsole `shop`, `CMD_CONSOLE.werft = 'shop'`; jeder Spieler am Terminal, keine Rolle)
| Befehl | Felder | Wirkung |
|---|---|---|
| `werft.freischalten` | `art: 'stufe'\|'waffe'\|'modul'`, `id` | Marken abbuchen, freischalten; Stufe nur der Reihe nach und sofort gesetzt |
| `werft.umbau` | `platz` 1–9, `waffe` Katalog-Id oder `'leer'` | gratis, `Waffen.bestuecken`; offener Platz, passende Platzart (Bug 8 und 5: Lanze/Standardkanone, Heck 2: Torpedowerfer/Abwehrturm, Seiten), nur Freigeschaltetes |
| `werft.modul` | `raum` 1–4, `id` oder `'leer'` | gratis, `Modul.entfernen`/`bestuecken` + `verteilungSetzen`; auch mehrfach; ein Raum darf leer bleiben; ein Frachtraum nur, wenn die Ladung danach noch Platz hat |
Alle prüfen zuerst (Ort, Besitz, Marken), buchen und ändern dann in einem Zug; Befehle laufen im Tick nacheinander, deshalb kein doppeltes Abbuchen (Test mit drei Spielern am selben Kauf).
Antwort an den Absender: Ereignis `werftAntwort { pid, op, ok, code?, text? }` (bei Fehler zusätzlich `notice`); bei Erfolg an alle `werft { op: 'freigeschaltet'|'umbau', art, id, platz?, raum?, marks?, pid }` + `sfx`. Nach Erfolg wird der Weltstand am Tick-Ende gespeichert.
Codes (`Protocol.WERFT_CODES`): `nicht_angedockt keine_flottenbasis unbekannt schon_freigeschaltet nicht_freigeschaltet stufe_reihenfolge zu_wenig_marken ruf platz_unbekannt platz_gesperrt platzart raum_unbekannt raum_gesperrt fracht_belegt unveraendert umbau`.
Ruf-Feld (Auftrag Punkt 13): `CONFIG.werft.ruf.stufe[n] = <Rang>`, Standard leer = keine Bedingung; greift nur mit einem späteren `game.rufErreicht(rang)`; keine Anzeige.

## 4. Preise (`CONFIG.werft.preise`) und Messung der Kette
| Teil | Marken |
|---|---|
| Ausbaustufe 1 / 2 / 3 | 100 / 180 / 600 |
| Standardkanone / Sturmbatterie / Streubatterie / Abwehrturm | 40 / 60 / 70 / 70 |
| Torpedowerfer / Lanzenbatterie | 100 / 120 |
| Werkstatt | 40 |
Torpedo-Munition bleibt im Handel (10 Marken je Stück, Lager höchstens 12, Test), Verbrauchsgüter und Deko bleiben im Shop; `seitenturm`, `schildpool`, `bot2`, `bolzenwerfer` sind weder im Shop noch im Snapshot (Test).

**Messung** (`node tools/sim-headless.js kette --crew N --seeds S --marken`, Kontostand je Kapitel; der Bot kauft nichts, Startmarken 150, `sim-headless.js` zeigt nun je Kapitel `start->ende`):
| Lauf | K1 | K2 | K3 | K4 | **K5 Ende (Castra Martis)** | K6 Ende |
|---|---|---|---|---|---|---|
| Crew 1, Seed 1 | 190 | 450 | 370 | 390 | **450** | 890 |
| Crew 1, Seed 2 | 190 | 430 | 500 | 520 | **580** | 1020 |
| Crew 1, Seeds 5/6/7 | 190 | 430/460/410 | 500/530/480 | 520/550/500 | **580/610/560** | 980/1050/1000 |
| Crew 3, Seed 1 | 190 | 320 | 380 | 400 | **460** | 640 |
| Crew 3, Seed 2 | 190 | 320 | 340 | 360 | **420** | 650 |
| Crew 1, Seed 12 | 190 | 320 | 390 | 410 | **470** | 910 |
| Crew 3, Seed 12 (Ausreißer: K2 kostet Marken, Notfallprotokolle à 50) | 190 | 80 | 140 | 160 | **220** | 690 |
| Crew 1 Seed 11/13, Crew 3 Seed 11/13 | – | – | – | 560/500, 450/400 | (K5 bringt je +60) | – |
Castra Martis ist die einzige spielbare Flottenbasis der Kampagne und wird erst in Kapitel 5 (Legat) erreicht; Kapitel 6 beginnt dort angedockt. Was die Kette danach einbringt (Orbitschlacht, Kapitel 6), liegt auf Eisenwald, nicht an der Basis.
Gerechnet wird mit dem schwächsten **regulären** Lauf (**420 Marken**, Crew 3 Seed 2; der Ausreißer Crew 3 Seed 12 mit 220 Marken verliert in Kapitel 2 Geld an Notfallprotokolle und reicht nicht einmal für Stufe 1 + 2 = 280, dort fehlt es dem Menschen wie dem Bot, ehrlich benannt): Stufe 1 + 2 + Sturmbatterie + Abwehrturm = 100 + 180 + 60 + 70 = **410**, ohne Grind (Nebenerträge von Notrufen, Funden und Händlern kommen für Menschen dazu, der Bot spielt nur die Kette).
Stufe 3 (600) liegt allein über dem Kontostand und mit 100 + 180 + 600 = 880 über dem, was die Kette bis Kapitel 6 insgesamt abwirft (640 bei Crew 3, bis 1050 bei Crew 1, aber erst nach der Basis): Stufe 3 gehört ins freie Spiel.
Der Designer-Vorschlag 400/600/800 hätte Stufe 1 + 2 (1000) an der Basis unerreichbar gemacht (Test `Preise und Katalog` hält die Bedingung fest). Hebel bei Spieltest: nur diese Tabelle.

## 5. Vorschau und Snapshot
- `Werft.vorschau(game, aenderung)`, `aenderung = { art: 'waffe', platz, id|'leer' } | { art: 'modul', raum, id|'leer' } | { art: 'stufe', id }`: rein berechnet (Test: Schiff danach unverändert). Ergebnis
  `{ moeglich, code?, text?, kosten, frei, jetzt?, vorher, nachher }`; `vorher`/`nachher` je `energie { reaktor, module, frei, engines, shields, weapons }`, `ladepunkte`, `alloc { Platz: Punkte }`, `seiten { Bb, Stb, vorn, Heck: [{ platz, id }] }`, `module [{ raum, id }]`.
  `frei=false` + `kosten>0` heißt: erst freischalten (Vorschau gilt trotzdem); `jetzt=false` mit `code/text` heißt: jetzt nicht ausführbar (Ort, Besitz, Marken). Waffenwechsel lässt die Energie der Hauptsysteme stehen, Modulwechsel und Stufe setzen die Standardverteilung (wie der echte Umbau); Tests vergleichen Energiepool, Ladepunkte, Verteilung, Seiten und Module mit dem tatsächlichen Umbau.
- **Snapshot-Block `werft`**, nur solange jemand an der Konsole `shop` sitzt: `{ aktiv, nutzer (Spielerfarbe, kein Name), stufe }`; gesperrt zusätzlich `grund` (66 B); aktiv: `waffen { Platz: Id }`, `module { Raum: Id|null }` (offene Räume, `null` = leer), `frei { stufe, waffen[], module[] }`, `preise { stufe, waffe, modul }` nur der noch nicht freigeschalteten Teile. Größe 400–500 B (Test), nur beim Handeln, nie im Kampf; `snap:mess` unverändert (Worst Case Orbitschlacht 13 318 B, Ziel ≤ 18 944 B).
- Namen, Wirkungstexte, Energie: `shared/schiffskatalog.js` (`WAFFEN[].wirkung`, neu `MODUL_NAMEN`, `MODUL_WIRKUNG`, je ein Satz; jedes Modul 1 Energie). Preise nur in `CONFIG.werft.preise` (Katalog trägt bewusst kein `preis`).

## 6. Mehrspieler am Terminal
Die Handelskonsole (Kachel `terminal_shop`, Meetingraum) verhält sich wie die anderen Konsolen: ein Nutzer am Gerät (`interior.consoleOccupant`, „Konsole besetzt“), die anderen sehen zu und bekommen den Block `werft` mit `nutzer` = Farbe. Jeder darf bedienen, kein Captain-Vorbehalt. Keine Namen im Block, keine Spielernamen an ein LLM.

## 7. Weltstand (Entscheidung: Format bleibt 3)
`schiff.freigeschaltet { stufe, waffen[], module[] }` ist **optional** (Schema ergänzt). Begründung: Altstände bleiben gültig, die Ableitung ist verlustfrei; eine Version 4 mit Migration brächte nichts. Beim Laden: Start-Freischaltung + gespeicherter Block + alles, was Stufe, Waffenplätze und Modulräume tragen (`Werft.restore` nach `Ausbau`, `Modul`, Bestückung). Keine Erstattung, idempotent (zweiter Durchgang gleich; Test). Altstände Paket A/B/C und `main` getestet.

## 8. Lafetten-Reihenfolge (Nachtrag Designer)
Die Karte hatte 1 vor 7 und 3 vor 9 (x 18 bzw. 16), also umgekehrt zum Ziffernblock. Jetzt liegen **7 und 9 bugwärts (x 18), 1 und 3 heckwärts (x 16)**: `SHIP_ROWS` Zeilen 34/42 (`=1=7=`, `=3=9=`) und `Maps.WAFFENPLAETZE` (`ANDOCKPUNKTE` folgt). `check-maps` (864 Prüfungen, Reparaturwege), `test-lerche`, `test-waffen-schiff` grün. `public/js/voxel/ship.js` und `render.js` lesen die Position über `waffenplatzAt` aus den Daten, dort ist nichts anzupassen. Golden siehe §10.

## 9. Debug-Rezept für Kai
`npm run debug` im Worktree `Pantheon-pan01-d` (`PORT=3355`), Seite `?debug=1`, Konsole des Browsers:
1. `__game.debugCmd('goto', {loc: 'castra_martis', docked: true})`, `__game.debugCmd('marken', {args: '1000'})`, `__game.debugCmd('sitz', {console: 'shop'})`.
2. Befehle ohne UI (D2): `__game.cmd('werft.freischalten', {art: 'stufe', id: 1})`, `__game.cmd('werft.umbau', {platz: 7, waffe: 'sturmbatterie'})`, `__game.cmd('werft.modul', {raum: 3, id: 'werkstatt'})`; Antwort als Ereignis `werftAntwort`, Zustand im Snapshot `werft`.
3. Alles freischalten: `__game.debugCmd('werft', {args: 'freischalten alle'})`; zurück `werft reset`; Stand `werft status`; Stufe des Schiffs weiter per `ausbau <0-3>`.
4. Sperre ansehen: `goto hafen docked` (Lichtkordon): Block `werft.aktiv === false`, Grund „Nur an Flottenbasen“; Handel geht trotzdem.
5. Tests: `node tools/test-werft.js`, `npm test`, `npm run check`, `npm run snap:mess`; Marken der Kette `node tools/sim-headless.js kette --crew 3 --seeds 3 --marken`.

## 10. Prüfstand
Siehe Rückmeldung des Entwicklers (Testausgaben, Kampagnen-Bots, Golden). Golden-Basis: `base-pan01c3` mit `allow-pan01c3.json`.

## 11. Für D2 (Terminal-UI): Server-Schnittstelle
Lesen: Snapshot `werft`, `shopContext`, `ship.st`, `ship.mod`, `ship.mounts`, `inventory.marks`, Katalog (`WAFFEN`, `MODUL_NAMEN`, `MODUL_WIRKUNG`, `PLATZ`, `SYMBOLE`), Karte (`Shared_Maps.WAFFENPLAETZE`, `MODUL_RAEUME`).
Vorschau: Befehl `werft.vorschau { art, platz|raum, id|waffe }` (Konsole shop) antwortet dem Absender mit dem Ereignis `werftVorschau { pid, vorschau }` (Inhalt wie §5, ein Rechenweg, Test). Senden: `werft.freischalten`, `werft.umbau`, `werft.modul`; Antwort `werftAntwort`.

## 12. D2: Terminal-Oberfläche (Client)
**Dateien:** `public/js/terminal-ui.js` (neu, globales `TerminalUI`: Ansichtswahl, Modell aus dem Snapshot, Tasten und Klicks, Befehle, Zuschauer), `public/js/pult-terminal-tokens.js` (Designer, unverändert) zeichnet.
Eingehängt in `consoles.js` (Konsole `shop`: `draw`, `keyDown`, `onOpen`, `tastenGruppe`/`tastenBereiche`; die alte `drawShop` bleibt nur als Rückfall, wenn `TerminalUI`/`PultTerminal` fehlen, W/S sind dort keine Listentasten mehr), `client.js` (Ereignisse `werft*`, E am besetzten Terminal = Zusehen, F1–F4 `preventDefault`, Zuschauer-Ansicht, Voxel-Schalter), `tasten.js` (Gruppe `terminal`), `index.html` (zwei Skripte nach `pult-stationen.js`), `shared/protocol.js`, `server/sim/werft.js` und `server/game.js`.
Keine neuen Farben oder Schriften (`check-terminal-farben.js` grün, Tokenblock unverändert).

**Aufbau (drei Schichten):** Storage = Snapshot (`werft`, `shopContext`, `ship.st/mounts/mod`, `inventory.marks`) plus die Ansichtswahl des Clients; Action = Modell bauen (`TerminalUI.modell`) und Befehle senden; Frontend = `PultTerminal.zeichneTerminal`. Der Client nimmt nichts vorweg: Aktionen werden gesendet, Marken und Schiff ändern sich erst mit dem nächsten Snapshot, die Rückmeldung kommt aus `werftAntwort` (Kurztext je Code unter dem Hauptknopf, voller Servertext in `TerminalUI.zustand.antwort.text`); ein Befehl unterwegs sperrt den Hauptknopf (höchstens 3 s).

**Bedienung** (Tasten umbelegbar im Menü „Steuerung“, Gruppe Terminal; Kappen zeigen die echte Taste): `H` Handel, `W` Werft · `1`–`9` Waffenplatz (Ziffernblock oder Zahlenreihe), `F1`–`F4` Modulraum · `↑`/`↓` Teil bzw. Artikel (auch `←`/`→`) · `Enter` bestätigt (Werft: Umbau gratis, Handel: kaufen) · `F` Freischalten (kostet Marken, Messing) · `A` Ausbau (Stufe am Schiffsschnitt kaufen, nochmal `A` zurück) · `Esc` Terminal verlassen · `?` Hilfe. „Leer lassen“ ist ein Listeneintrag bei Waffenplätzen und Modulräumen. Klicks wie Tasten (Platz im Kreuz, Modulraum, Listenzeile, Hauptknopf, H/W, Ausbau).
Ablauf in der Werft: Platz oder Raum wählen -> Teilliste -> **Vorschau** (`werft.vorschau` wird bei Auswahlwechsel nach 150 ms Ruhe angefordert, Antworten FIFO zugeordnet, Cache wird bei jedem `werft`/`werftAntwort` verworfen) -> Enter oder F. Gesperrter Platz oder Raum (Stufe fehlt): Liste leer, der Hauptknopf kauft die nächste Stufe. Im Nicht-Werft-Hafen öffnet das Terminal im Handel; W zeigt „Werft gesperrt“ mit dem Grund aus `werft.grund`, F/Enter/Platzwahl bewirken nichts, der Handel bleibt nutzbar.
Handel: Zeilen aus `Consoles.shopRows` (die bisherigen `CONFIG.shop`-Artikel, Torpedo mit Lager x/12, Sperrgrund „Lager voll“), Kauf `shop.buy`; „… gekauft.“ erscheint, sobald der Kontostand im Snapshot sinkt.

**Mehrspieler:** ein Nutzer am Gerät (Konsole `shop`, `consoleOccupant`), jeder darf bedienen. Der Nutzer schickt seine Ansicht mit `werft.ansicht { b, a, n, i }` (nur von der Konsole aus akzeptiert, entprellt); der Snapshot trägt sie als `werft.ui`. **Zuschauer:** E am besetzten Terminal (Hinweis „Terminal: besetzt (Name) · E zusehen“) öffnet die Ansicht des Nutzers rein lesend (`werft.zusehen { on }` setzt die Farbe in `werft.zu`; Vorschauen fordert der Zuschauer selbst an, `werft.vorschau` braucht keine Konsole). Tasten außer Esc und Klicks bewirken nichts, der Server lehnt `werft.freischalten/umbau/modul/ansicht` ohne Konsole ab. Statusleiste „AM GERÄT: Farbe · ZUSEHEN: Farben“. Steht der Nutzer auf (Block `werft` fehlt), schließt sich die Zuschauer-Ansicht und die Flags werden gelöscht.
**Voxel und 2D:** E an `terminal_shop` im Meetingraum (Kachel 16, 25) setzt an die Konsole (flache Pult-Ansicht über Voxel und 2D, wie die anderen Konsolen ohne Ego-Sitz); der Zuschauer-Modus blendet das Voxelbild ebenso aus.

**Tasten (`tasten.js`, Gruppe `terminal`):** `terminal.handel` H, `.werft` W, `.teilHoch` ↑, `.teilRunter` ↓ (statt der vorgeschlagenen einen Aktion `terminal.teil`, damit die Umbelegung je Richtung geht; die Kappe „↑↓“ am Knopf Teil bleibt die Ersatzbeschriftung des Designers), `.platz1`–`.platz9` Num/Zahl, `.modul1`–`.modul4` F1–F4, `.bestaetigen` Enter, `.freischalten` F, `.ausbau` A (Bereich Werft), `.kaufen` Enter (Bereich Handel). Eigene Bereiche `terminal.werft`/`terminal.handel`, damit sich Enter und die Platztasten keine Konflikte teilen. `check-tasten.js` und `test-tasten.js` grün (Gruppenliste im Test um `terminal` ergänzt).
**Server-Ergänzungen D2:** `werft.ansicht`, `werft.zusehen`, `werft.vorschau` für Zuschauer (Protokoll ergänzt: Snapshot `werft.ui`, `werft.zu`).

**Tests:** `node tools/test-werft-ui.js` (headless, 52 Prüfungen: Terminal-Modell und Tasten gegen den echten Server, Zuschauer, Tastenbelegung; in `npm test`); `node tools/pw-werft-ui.js [port] [ordner]` (Playwright, drei Spieler, echte Tasten, 40 Prüfungen, schreibt die Bilder; braucht einen Debug-Server: `WORLD_DIR=C:/tmp/werft-world PORT=3355 ROOM_CODE=off MISSION_SOURCE=fallback node server/index.js --debug`).
**Screenshots:** `C:\Users\Luciu\projects\Pantheon-gestaltung\pan01\pruefung-d\` `d2-01-handel` bis `d2-13-gesperrt` (Handel, Platz gesperrt, Ausbau Stufe 1, Umbau mit Vorschau Platz 9 Standard -> Streu, umgebaut, Fehler zu wenig Marken, Modulraum F4/F2/leer, Zuschauer, Handel und gesperrte Werft im Lichtkordon).
**Auffälligkeit außerhalb des Pakets:** `public/js/hud.js` `drawRadio` las die undefinierte Variable `tx` (Anzeige „Captain-Konsole: annehmen“ beim Funk), das zählte bei jedem Funkspruch als Client-Fehler (`Fehler Client 14`); eine Zeile zu `x + 6 + pw` korrigiert, sonst wäre „Fehlerzähler 0“ nicht erreichbar gewesen.
**Debug-Rezept für Kai (D2):** `npm run debug` im Worktree (`PORT=3355`), Seite `?debug=1`; Browser-Konsole: `__game.debugCmd('goto', {loc: 'castra_martis', docked: true})`, `__game.debugCmd('marken', {args: '1000'})`, dann im Meetingraum E an der Handelskonsole (oder `__game.debugCmd('sitz', {console: 'shop'})`). Andere Spieler: E am besetzten Terminal = zusehen. Gesperrt ansehen: `goto hafen docked`. Alles freischalten: `werft freischalten alle`.
