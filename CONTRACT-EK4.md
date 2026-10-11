# CONTRACT-EK4 – Verbündete und Flottenbefehle (K4)

Grundlage: `Briefing Eisenwald-Kampagne (EK1-EK9)` (EK4), `Planung Eisenwald-Kampagne (EK1-EK9)` (EK4, E5), `Arbeitspaket Raum-Alarm und K4`,
`Welt/Funktexte Feldzug Eisenwald` im Vault (`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`). Branch `ek3-flotte` (Basis `ek1`).
Schnitt nach E5: **EK4a** (Befehle, Legat, Funk, Hilferufe, Verlust; Verbündete scripted) vor **EK4b** (eigene KI, Teamlogik, 12-Schiffe-Grenze, Sprung der Flotte).

## 1. Befund
- `escort.js` (S2) trug Flug über `Pilot.escort`, Befehle, Gehorsam nach Haltung, Hilferuf, Funk-Rüffel, Zustände, Gegnerziele (`targetId`, `Pilot.targetOf`), Sprung mit der Lerche.
  Es fehlten: Feuer, Verlust als Ereignis (Schützlinge werden nie gelöscht), Befehle als Szenenziele, Legat/Gedächtnis, Funkporträt, Wellen mit Frist.
- Das Notfallprotokoll der Lerche (Hülle 0, Gegner ziehen 10 s ab) ist schon das „wird zerstört und muss fliehen“; EK4 hängt den Befehlsausgang daran.
- Alle Dateien sind CRLF (Git normalisiert); Hooks in `escort.js`, `game.js`, `mission.js` sind klein, die Logik liegt in neuen Modulen.

## 2. EK4a – gebaut
| Teil | Inhalt |
|---|---|
| `server/sim/flotte.js` | Verbündete (Einträge in `space.escorts` mit `ally: true`, Klasse korvette/fregatte/kreuzer/raider, eigene Hüllentafel `CONFIG.flotte.hull`, eigene Crew-Härte `flotte.crewDamage`), Skript `halten | folgen | ziel`, Befehle, Wellen, Neustart, Hilferuf, Verlust, Gedächtnis, Snapshot, Debug `flotte …` |
| Befehle (`befehl`) | **ausschalten** (Ziel Tag/Klasse, n Abschüsse), **eskortieren** (Schiff erreicht die Wegpunkte, wartet an der Leine), **durchbrechen** und **zurueckfallen** (Lerche erreicht die Wegpunkte), **entlastung** (n Abschüsse, solange die Lerche höchstens `radius` vom Schiff entfernt ist). Fortschritt nur durch erreichte Ziele (getestet: Zeit allein bringt nichts, Abschüsse fern vom Schiff zählen nicht) |
| Scheitern | `zeit` (Frist), `schiff` (Schiff verloren), `notfall` (Notfallprotokoll der Lerche). Welle um Welle: nach abgelaufener Frist **Überdruck** (letzte Gruppe kommt alle 9 s größer wieder). `flotte_neustart`: Gegner weg, Befehl/Wellen von vorn, lebende Verbündete repariert, Lerche ≥ 60 % Hülle, tote bleiben tot. Katalog: zweimal von vorn, danach „Rom übernimmt“ (die Szene darf scheitern, der Feldzug nie) |
| Legat | NSC `legat` (Marcus Severus, `content/npc.json`; alte Stände bekommen ihn beim ersten Gebrauch nachgetragen). Gedächtnis im Weltstand: `befehl_befolgt` (+1), `eigenmaechtig` (−1, Lerche entfernt sich ≥ 25 s vom Befehlsziel), `im_stich` (−2, Verbündeter fällt bei > 700 px Abstand), `schiff_verloren`. Flags `legat_befolgt/eigenmaechtig/im_stich`, Prüfung `legat_erinnert`, Aktion `flotte_erinnerung` |
| Verlust | Verbündeter wird **zerstört** (nicht kampfunfähig): Explosion, Ereignis `allyLost` (Position, Rettungskapsel-Anzeige 14 s), theatralischer Funkspruch, Fakt `flotte_<tag> = verloren` (kommt nicht von selbst zurück; `flotte_aufstellen` verweigert, `ersatz: true` = Ersatz „über eine Aufgabe“), Chronik, der **Legat überlebt** (Status `lebt`). Ausnahme zu S2 „benannte NSC sterben nicht“ gilt für das **Schiff** |
| Hilferuf | bei Hülle < 40 % und < 15 % (je Schiff einmal), Texte aus `content/flotte/funktexte.json` (Daten, nicht im Code), je Schiff `fulminata` / `audax`, sonst `allgemein` |
| Funk | `radio`-Aktion und Ereignis tragen `pid` (`legat` = Porträt, `mars` = Symbol, kein Gesicht); Mars spricht über eine `stimmen`-Kennung `mars`. Der Client zeichnet Porträt/Symbol im HUD-Funkfenster und im Captain-Reiter Funk |
| Anzeige | HUD-Zeile **BEFEHL · Art Fortschritt · Frist · Welle** (auch im Titelbalken von Steuer/Taktik/Captain), **VERBÜNDET**-Zeile mit Hüllenbalken, Captain-Reiter Funk: Block „Befehl des Legaten“, Karten: nummerierte Wegpunkte, Radius der Entlastung, Verbündete golden mit Rom-Sprite, Rettungskapseln |
| Bausteine | `flotte_aufstellen, flotte_modus, flotte_befehl, flotte_wellen, flotte_neustart, flotte_erinnerung`; Prüfungen `befehl_erfuellt, befehl_gescheitert, befehl_laeuft, wellen_fertig, schiff_verloren, legat_erinnert, flotte_ziel_erreicht`. Vertrag `content/regiebuch/bausteine.json`; Prüfer: `schiff_verloren`/`escort_state zerstoert` zählen als Verlustweg |
| Katalog / Labor | Molekül `flottenbefehl` (A10) mit den fünf Umsetzungen; Mechaniken `flottenbefehle`, `verbuendete_skript` verfügbar (`verbuendete` bleibt geplant bis EK4b). Spielleiter-Kontext-Goldens neu (bewusst, +Molekül, +NSC) |
| Tests / Bots | `tools/test-flotte.js` (in `npm test`), `node tools/sim-headless.js flotte [--seeds N]` (Labor-Bots, alle fünf Arten, solo und zu dritt) |

## 3. Entscheidungen (EK4a)
1. **Verbündete leben in `space.escorts`** statt in einer zweiten Liste: Zielwahl der Gegner, Treffer, Ankündigung, Sprung, Snapshot, Sperrfeuer-Abfangen laufen ohne Doppelcode. Schützlinge bleiben auf 2 begrenzt, Verbündete zählen extra.
2. **Zerstört statt kampfunfähig:** Verbündete verschwinden mit Explosion und Kapsel. Wrack-Logik wäre sonst Sonderfall; „kommt nicht von selbst zurück“ ist ein Weltstand-Fakt.
3. **Gedächtnis über Weltstand-Funktionen** (`npcMemory`, `fact`, `chronicle`), **kein neues Schemafeld**; Flags für Verzweigungen.
4. **Eigene Härte für Verbündete** (`flotte.crewDamage` 0,4/0,55/0,6, Hüllen 220/380/520): mit der Schützling-Tafel (0,18 solo) wären sie solo unverwundbar; mit 1,25 zu dritt starben sie in jedem Bot-Lauf.
5. **Frist statt Zeitdruck allgemein:** Nur Befehle mit `frist` scheitern an der Zeit; Standardfristen in `CONFIG.flotte.befehl.frist`.
6. **Funktexte als Daten**, Porträt über Kennung (`pid`), nicht über Spielzustand; unbekannte Sprecher unverändert (Snapshot bleibt byte-gleich).
7. **Mars als `stimmen`-Kennung** statt NSC: kein Gedächtnis, kein Auftraggeber für den Spielleiter.

## 4. Antworten auf die Fragen des Briefings
- **Befehlsanzeige:** HUD-Zeile (überall, auch im Titelbalken der Konsolen), Captain-Reiter Funk (Block mit Art, Fortschritt, Frist), Wegpunkte und Radius auf Taktikkarte/Steuer; Funkspruch mit Porträt im HUD und im Reiter Funk.
- Die Antworten zu Snapshot, Fregatten-KI und Auftauchen der Verbündeten stehen im Abschnitt EK4b.

## 5. Abnahme EK4a
`npm test` (inkl. 93 Prüfungen `test-flotte`), `npm run check`, `npm run snap:mess` grün; Labor: alle fünf Arten (Bots solo/zu dritt, Ausgang erfüllt bzw. nach Neustart bzw. „Rom übernimmt“); Hilferuf und Verlust mit Funkspruch, Legat-Gedächtnis speichern/laden getestet; Browser (Chromium, Playwright): HUD-Zeilen, Porträt, Mars-Symbol, Captain-Reiter, Verlust mit Kapsel, 0 Client-Fehler.
