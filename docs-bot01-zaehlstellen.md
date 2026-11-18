# BOT-01 A2: Zählstellen (Stelle → Funktion → Grund)

Zeilennummern beziehen sich auf den A1-Stand (Commit 7ba05ffe, `git grep -n connected` in server/); `server/sim/crew.js` ist ausgenommen (sie ist die Zählstelle). Kategorien: Menschen = `Crew.menschen` · Köpfe = `Crew.koepfe` bzw. Liste `Crew.verbundene` · Einzelprüfung = ein einzelner Spieler oder Liste mit Zusatzbedingung, unverändert · Datenfeld = Zuweisung/Snapshot/Telemetrie, unverändert.

Summe server/: 86 Treffer. Datenfeld 7 · Einzelprüfung 49 · Köpfe (Liste) 9 · Menschen 3 · Köpfe 15 · Einzelprüfung (Falle) 1 · Köpfe (Falle) 1 · Köpfe (Zweifel) 1

## server/game.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| game.js:679 | Datenfeld | bleibt | Verbindung des Slots trennen |
| game.js:839 | Datenfeld | bleibt | Slot beim Hello belegen |
| game.js:853 | Einzelprüfung | bleibt | freien (getrennten) Slot suchen; ein Bot-Slot hat connected true und wird nicht vergeben |
| game.js:855 | Datenfeld | bleibt | freien Slot belegen |
| game.js:872 | Datenfeld | bleibt | neuer Spieler-Datensatz |
| game.js:982 | Einzelprüfung | bleibt | Sende-Schleife: Spieler ohne conn überspringen (Bot-fest, siehe Risiken) |
| game.js:998 | Einzelprüfung | bleibt | Sende-Schleife Außenkarte: verlangt p.conn (Bot-fest) |
| game.js:1136 | Köpfe (Liste) | Crew.verbundene | Lobby-Start: „alle Verbundenen bereit“; ein Bot muss bereit sein (Paket B setzt ready für Bots) |
| game.js:1255 | Einzelprüfung | bleibt | Konsolen-Befehl: dieser eine Spieler ist da |
| game.js:1866 | Einzelprüfung | bleibt | Debug-Beam: Filter mit Zone/Konsole, Liste, keine reine Zählung |
| game.js:1915 | Menschen | Crew.menschen (A1) | Leer-Uhr/Reset „alle weg“ |
| game.js:1922 | Menschen | bleibt (A1) | folgt aus 1915 |
| game.js:2021 | Einzelprüfung | bleibt | Brückenlift-Hinweis: Filter mit Zone/Deck, Liste, keine reine Zählung |
| game.js:2363 | Datenfeld | bleibt | Snapshot-Feld connected je Spieler |

## server/mission/registry.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| mission/registry.js:336 | Einzelprüfung | bleibt | Besetzungsprüfung (some) einer Station, kein Zählersatz; ein Bot an der Station zählt als besetzt |
| mission/registry.js:389 | Köpfe | Crew.koepfe | Prüfung „höchstens N Spieler“ ist eine Größenregel; Bots sind Spieler |

## server/mission/spielleiter.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| mission/spielleiter.js:339 | Köpfe | Crew.koepfe | Crew-Größe für Plan-Kontext und Ablage (1..3); Bots sind Spieler |

## server/sim/anker.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/anker.js:156 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |
| sim/anker.js:350 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/arena.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/arena.js:209 | Köpfe (Liste) | Crew.verbundene | Testgelände: alle Verbundenen nach unten beamen, Bots eingeschlossen |
| sim/arena.js:267 | Köpfe (Liste) | Crew.verbundene | wie 209: alle Verbundenen ins Team |
| sim/arena.js:334 | Köpfe (Liste) | Crew.verbundene | wie 209: alle Verbundenen ins Team |

## server/sim/aufrichten.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/aufrichten.js:44 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/away.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/away.js:197 | Einzelprüfung | bleibt | Besetzungsprüfung (some) einer Station, kein Zählersatz; ein Bot an der Station zählt als besetzt |
| sim/away.js:213 | Einzelprüfung | bleibt | Filter mit Zusatzbedingung, Liste statt reiner Zählung |
| sim/away.js:494 | Einzelprüfung (Falle) | bleibt | humansAboard für ODA-Codehilfe; Falle → BOT-02 A |

## server/sim/combat.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/combat.js:40 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |
| sim/combat.js:1249 | Köpfe (Falle) | Crew.koepfe | Archiv-Schlüssel-Fenster „solo“; Falle → BOT-02 A (Solo-Fenster: Menschen oder Köpfe, dort entscheiden) |
| sim/combat.js:1455 | Einzelprüfung | bleibt | Schleifen-/Einzelprüfung je Spieler |
| sim/combat.js:1525 | Köpfe (Liste) | Crew.verbundene | Landepunkt-Start: alle Verbundenen ins Außenteam, Bots eingeschlossen |
| sim/combat.js:1616 | Köpfe | Crew.koepfe | Spielerzahl 1..3 für die Gegner-/Trupp-Skalierung |

## server/sim/entschluesseln.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/entschluesseln.js:28 | Einzelprüfung | bleibt | Besetzungsprüfung (some) einer Station, kein Zählersatz; ein Bot an der Station zählt als besetzt |

## server/sim/escort.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/escort.js:97 | Köpfe | Crew.koepfe | crewN der Geleit-Szene (Skalierung) |

## server/sim/faden-szene.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/faden-szene.js:49 | Köpfe | Crew.koepfe | crewN der Faden-Szenen (Skalierung, crew_min/max) |

## server/sim/fallen-typen.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/fallen-typen.js:35 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |
| sim/fallen-typen.js:39 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/fallen.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/fallen.js:98 | Einzelprüfung | bleibt | Schleifen-/Einzelprüfung je Spieler |
| sim/fallen.js:167 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/finale-boden.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/finale-boden.js:53 | Köpfe | Crew.koepfe | Crew-Größe für Wachen/Anführer am Boden (Skalierung) |

## server/sim/finale.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/finale.js:76 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/flotte.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/flotte.js:60 | Köpfe | Crew.koepfe | crewN der Flottenschlacht (Skalierung) |

## server/sim/fracht.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/fracht.js:261 | Einzelprüfung | bleibt | Besetzungsprüfung (some) einer Station, kein Zählersatz; ein Bot an der Station zählt als besetzt |

## server/sim/gespraech.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/gespraech.js:116 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/graben.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/graben.js:33 | Köpfe (Liste) | Crew.verbundene | Team des Grabenangriffs: alle Verbundenen |
| sim/graben.js:196 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/interior.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/interior.js:221 | Einzelprüfung | bleibt | Bewegung eines Spielers: getrennte stehen still |
| sim/interior.js:556 | Einzelprüfung | bleibt | Mitspieler an Konsole suchen (find); Bot an der Konsole zählt |
| sim/interior.js:605 | Köpfe (Liste) | Crew.verbundene(game).filter(console===plan) | Plätze am Planungstisch: ein Bot am Tisch belegt einen Platz; Zusatzfilter bleibt |
| sim/interior.js:891 | Einzelprüfung | bleibt | Nachbarn-Schleife je Spieler |

## server/sim/kontingent.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/kontingent.js:75 | Menschen | istBot-Filter (A1) | Frage an den Menschen mit Farbe 0 |

## server/sim/kreatur.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/kreatur.js:257 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/kriegslage-szene.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/kriegslage-szene.js:688 | Köpfe | Crew.koepfe | Finale-Stufe aus Crew-Größe (Skalierung) |

## server/sim/lage-ausschnitt.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/lage-ausschnitt.js:107 | Köpfe | Crew.koepfe | crew.anzahl für den Spielleiter-Kontext (Kai: Bots zählen); Format unverändert, Rückfall auf players.length bleibt; Unterschied nur: connected fehlt jetzt = nicht verbunden (im echten Spiel nie der Fall) |

## server/sim/landepunkte.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/landepunkte.js:811 | Einzelprüfung | bleibt | Liste der Schiffs-Spieler (Zone-Filter), keine reine Zählung |
| sim/landepunkte.js:832 | Einzelprüfung | bleibt | wie 811 |

## server/sim/loadout.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/loadout.js:30 | Köpfe | Crew.koepfe | Slotzahl 2 ab 3 Verbundenen, einmal in startGame (Skalierung) |

## server/sim/lpscan.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/lpscan.js:55 | Einzelprüfung | bleibt | Besetzungsprüfung (some) einer Station, kein Zählersatz; ein Bot an der Station zählt als besetzt |

## server/sim/mission.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/mission.js:848 | Köpfe | Crew.koepfe | Spawn-Menge je Crew-Größe (s.crew[1..3]) |

## server/sim/monster.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/monster.js:104 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |
| sim/monster.js:295 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/onboard.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/onboard.js:9 | Einzelprüfung | bleibt | Liste der Planungstisch-Sitzer (console===plan), keine Zählung |

## server/sim/reise-ereignis.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/reise-ereignis.js:390 | Einzelprüfung | bleibt | „mindestens ein Spieler verbunden“ (some), kein Zählersatz |
| sim/reise-ereignis.js:452 | Köpfe | Crew.koepfe | Jäger-Zahl = Verbundene + jaeger_je_spieler (Skalierung) |

## server/sim/reise.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/reise.js:154 | Köpfe | Crew.koepfe | Jäger-Zahl der Reise (Skalierung) |

## server/sim/scanner.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/scanner.js:107 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/space.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/space.js:434 | Einzelprüfung | bleibt | Schleifen-/Einzelprüfung je Spieler |
| sim/space.js:1068 | Köpfe | Crew.koepfe | Gegnerzahl-Skalierung im Raum (n 1..3) |
| sim/space.js:1620 | Köpfe (Zweifel) | Crew.koepfe | Solo-ODA-Hilfe „Gegner lädt“: Standard Köpfe; gehört zur Solo-Familie wie away.js:494, in BOT-02 A mitprüfen |

## server/sim/spur.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/spur.js:157 | Einzelprüfung | bleibt | Besetzungsprüfung (some) einer Station, kein Zählersatz; ein Bot an der Station zählt als besetzt |

## server/sim/squad.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/squad.js:87 | Köpfe | Crew.koepfe | crewSize für Trupp-Skalierung |
| sim/squad.js:241 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |
| sim/squad.js:359 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |
| sim/squad.js:1024 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/station.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/station.js:20 | Einzelprüfung | bleibt | find: ein einzelner Spieler, kein Zählen |

## server/sim/trupp.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/trupp.js:81 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/verteidigung.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/verteidigung.js:166 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |
| sim/verteidigung.js:199 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |

## server/sim/wellen.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/wellen.js:134 | Köpfe (Liste) | Crew.verbundene | Team der Wellen: alle Verbundenen |
| sim/wellen.js:375 | Einzelprüfung | bleibt | Außenteam-Spieler (Zone-Filter oder Einzelprüfung); ein Bot im Außenteam ist verbunden |
| sim/wellen.js:501 | Einzelprüfung | bleibt | find: ein einzelner Spieler, kein Zählen |

## server/sim/welt.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/welt.js:122 | Köpfe (Liste) | Crew.verbundene | Weltwechsel: alle Verbundenen beamen, Bots eingeschlossen |

## server/sim/werft.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/werft.js:283 | Einzelprüfung | bleibt | Nutzer der Werft-Konsole (find) |
| sim/werft.js:303 | Einzelprüfung | bleibt | Werft-Zuschauer (Filter mit Zusatzbedingungen) |

## server/sim/zonen.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| sim/zonen.js:123 | Einzelprüfung | bleibt | Besetzungsprüfung (some) einer Station, kein Zählersatz; ein Bot an der Station zählt als besetzt |

## server/telemetrie/haken.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| telemetrie/haken.js:296 | Datenfeld | bleibt | Telemetrie: verbunden je Slot |

## server/telemetrie/kopf.js

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| telemetrie/kopf.js:133 | Datenfeld | bleibt | Telemetrie-Kopf: verbunden je Slot, bot: true bei Bots |

## Client (public/js)

| Stelle | Kategorie | Funktion | Grund |
|---|---|---|---|
| client.js:215 soloNow | Menschen | Protocol.menschenZahl (A1) | Solo-Pause gehört den Menschen |
| client.js:224, 807 | Menschen | über soloNow | Pause senden/zurücknehmen |
| hud.js:726 | Einzelprüfung | bleibt | Außenteam-Mitspieler (connected !== false); ein Bot ist ein Mitspieler |
| hud.js:899 | Einzelprüfung | bleibt | Kamerad im Außenteam, Bot zählt |
| hud.js:1291 | Einzelprüfung | bleibt | „getrennt“-Beschriftung eines Spielers |
| hud.js:1434 | Menschen | Protocol.menschenZahl (A1) | Pause-Anzeige |
| hud.js:2150 | Menschen | Protocol.menschenZahl (A1) | Zerstört-Einblendung wartet auf Menschen |
| menue.js:392 (verbunden/zaehlung/gastgeber) | Köpfe (unverändert) | bleibt | Lobby-Anzeige „an / bereit“ und Gastgeber (erster Verbundener): Bots stehen als Spieler in der Liste und müssen bereit sein; für Paket B: Gastgeber darf nie ein Bot werden (Reihenfolge der Spielerliste) |
| dev-mock.js:121 | Datenfeld | bleibt | Mock-Spieler connected: true |
| dev-mock.js:380 | Einzelprüfung | bleibt | Außenteam im Mock |
| dev-mock.js:1133 | Menschen | Protocol.menschenZahl (A1) | Mock-Pause |
