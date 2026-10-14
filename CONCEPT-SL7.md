# CONCEPT-SL7 – Forschungsstation: 7a Gravimetrie, 7b Landepunkt per Scan, 7c Monster-Station

Grundlage: `Briefing Die Schuld der Lerche (SL0-SL12)` (SL7), `Ops-Missionen` (1, 2, Landepunkt per Scan), `Brückenrollen#Außenmission`, `CONCEPT-SL6.md` (Zonen).
**Stand:** Konzept, Kais Go (2026-10-14). SL7 ist geteilt: **7a vor 7c, 7b parallel.** Voraussetzung: SL6 (7a), SL2 nur als Bodenbaustein-Hilfe (NSC nicht nötig).

## 1. Befund
| Punkt | Stand |
|---|---|
| Kriechgänge | gibt es im Generator: `shared/gen-station.js:7-8,193-226` (Röhrennetz `~`, 1 Kachel breit, nur über Luken `L` aus Räumen). In der Karte normaler Boden `.`, KEINE Kachelart „nur Spieler“. Gänge 4 breit, Türen/Schotts 2 breit (`:21,98`) |
| Spielerdurchlass | nur `rohr` (Methalle, `gen-siedlung.js:209-238`, `buehne.js:1374-1386` K-ROHR/K-MAUER-DICHT) als Prüfkonzept |
| Erreichbarkeit | `buehne.js:1357-1372` K-ERREICHBAR (BFS, eine `pass`-Funktion für alle), `buehne-kennzahlen.js:104 bfs`, Kennzahl `lukenAmHauptnetz` (`gen-station.js:226`) |
| Gegner | nur `scavenger`, `warden` (`config.js:322-330`); EINE Hitbox 14×10 (`squad.js:14,744,797`); Pfad BFS über `E.solid`; Anti-Hängen `trackStuck/unstick` (`squad.js:~760-790`). Kein unverwundbar-Flag, Wächter-Sonderfälle in `combat.js` (187, 833-887) |
| Pulte | Anker `terminal` im Generator (`gen-station.js:326,349`); Hacken gibt es für Schotts (`anker.js`, Halten `schott_hacken`); Terminal-Hack als Halteaktion neu zu prüfen |
| Wunden | Wound/Downed/Bleedout/Revive vorhanden (`awayCombat.wounded`, `config.js:318`) |
| Planungstisch | Konsole `plan`, Pins `onboard.js:11-45`, Detailkarte `consoles.js:2165`/`render.js:4026`. `ex.mapsKnown = {platform, wreck, kesh}` (`explore.js:30,189-191`, Weltstand `karten`) gilt nur für 3 feste Decksplankarten; Orts-Detailkarte (Szene) ab „Ort bekannt“. **Gebaute Landepunkt-Karten (`landepunkte.js`, `game.aways[lpId]`) sind nicht angeschlossen** |
| Captain-Außenkarte | `game.setAwayMap` (`game.js:416,1447`); wie der Captain-Client sie vor dem Beamen sieht: nicht geprüft |
| Gravimetrie | keine Scan-UI für Drift; Drift/Zonen kommen aus SL6 |

---
## 7a Gravimetrie (Zonen als Rätsel)
**Entwurf.** Szene „Forschungsstation“ (Leerraum, temporärer Sprungpunkt) mit `zonen[]` aus SL6, alle `sichtbarFuer: 'ops'`, Felder statisch, Drift stärker als Antrieb Stufe 3, überwindbar mit Stufe 4 + Hitze (Z6).
- **Ops-Scan:** neue Ops-Aktion `zonenScan` (Taktikkonsole, Halten ~3 s, Radius): setzt `zonen.bekannt` für Zonen im Radius; Taktikkarte zeigt Pfeil (Richtung) und Zahl (Stärke). Navigation sieht nichts (Vertrauen/Kommunikation, Kai). Sektorplan (SL4) übernimmt gescannte Zonen (`sichtbarFuer`).
- **Falscher Weg:** Szenenlogik, kein Zonenwert: Rücksetz-Zone (`zonen[].wirkung: 'ruecksetzen'` als Regiebuch-Ereignis `zoneRuecksetzen` → Lerche auf Startpunkt, Reaktor/Energie bleibt, Meldung ODA). Kein Tod.
- **Finale (Station hält fest):** nach 7c setzt das Regiebuch `sichtbarFuer: 'alle'` auf allen Zonen der Szene („Feldkarte“) und erhöht Drift in einer Haltezone um die Station. Nur der richtige Pfad kommt raus: Sprungpunkt am Rand erreichbar (Szene Erfolg), falscher Pfad → `zoneRuecksetzen`.
- Dateien: `server/sim/zonen.js` (+`scan`, `ruecksetzen`), `server/sim/space.js` (Aktion), `public/js/render.js` + Taktikkonsole (Pfeile), Regiebuch `content/regiebuecher/…`.
- Schnitt: Storage `zonen.bekannt`; Action `zonen.scan`, `zonen.ruecksetzen`; Frontend: Pfeile/Taktikkarte.
- Schätzung **2–3 Tage**.

## 7b Landepunkt per Scan und Planungstisch (allgemeine Regel)
**Entwurf.** Gebaute Landepunkt-Karten werden Planungstisch-Karten.
- **Zustand:** `explore.landepunktKarten = { [lpId]: true }` (Weltstand `karten`, wie `mapsKnown`, Format kompatibel erweitert: Liste aus festen IDs + Landepunkt-IDs).
- **Scan:** Ops scannt Landepunkt (Schiff/Station/Planet) in Reichweite: Funktion `explore.landepunktScannen(game, lpId)` setzt das Flag, meldet ODA („… liegt auf dem Planungstisch“). Bestehende `mapsKnown`-Pfade (`kartiert`) bleiben unverändert.
- **Planungstisch:** `onboard.pin` und Detailkarte lesen: Karte = `landepunkte.karte(game, lpId)` (existiert, Cache `maxGebaut`), nur wenn Flag gesetzt; Pins in Kachelkoordinaten (wie `AWAY_MAPS`). Ohne Scan: keine Karte (Außenteam geht blind, riskant, Kai).
- **Captain:** Außenkarte an der Captain-Station erst nach dem Beamen (`setAwayMap` erst bei `away`-Eintritt). Heutiges Verhalten des Captain-Clients vor dem Beamen: im Bau prüfen (UNSICHER).
- **Wachen:** erste Fassung nur Grundriss + Zugänge (Default); Wachen als Momentaufnahme später.
- Dateien: `server/sim/explore.js`, `server/sim/onboard.js`, `server/sim/landepunkte.js` (nur Lesezugriff), `public/js/render.js`/`consoles.js` (Detailkarte), Weltstand-Schema.
- Schnitt: Storage `explore.landepunktKarten`; Action `landepunktScannen`; Frontend: Detailkarte.
- Schätzung **2 Tage** (Bots/Labor-Szenario inklusive); Risiko: Serialisierung/Speicherstand, Golden unverändert solange Liste leer.

## 7c Monster-Station
**Entwurf.** Neue Karte aus `GenStation` (Variante `monster`) mit 4 Pulten (`terminal`-Anker), Monster-Spawn, Luken-Netz.
- **Monster** (neue Art `monster`, eigene Datei `server/sim/monster.js`, nicht `squad.js`-Rollen-KI): `{ kind:'monster', fussabdruck:2, unverwundbar:true, speed, laermHoerweite, zustand }`. `unverwundbar` wird in `combat.js` am Treffer-Eingang abgefangen (Schüsse/Handwaffen wirkungslos, Effekt „Funken“).
- **Größenklasse statt Kachelart:** einmal je Karte berechnete Maske `monsterMaske` (Erosion: Kachel begehbar nur, wenn 2×2 frei). Passiert Gänge (4) und Türen/Schotts (2), nicht Kriechgang/Luken (1). Pfadsuche UND Kollision nutzen dieselbe Maske (eigene Hitbox 28×28), damit kein Festhängen (Problem heute: BFS-Raster vs. Hitbox, `squad.js:775`).
- **Zustandsmaschine:** `schlaf` → `lärm` (A* zum nächsten für das Monster erreichbaren Punkt am Lärmort) → `suche` (Zufallspunkte um Lärmort, N s) → `jagd` (Sichtlinie, Spieler in Maske). Ununterbrochen aktiv (Kai): nach `suche` Patrouille zwischen Pulten, nicht Rückfall in Schlaf.
- **Lärm** = Ereignis (Ort, Stärke): Hack-Abschluss und Hack-Start (leise), Schuss, Rennen. Ablenken (Mitspieler) = Lärmquelle.
- **Treffer:** Kontakt (Abstand < 20 px, Angriffsintervall) → **Spieler verwundet/Boden** (vorhandene Wunde, Bleedout 45 s, Revive); Monster-Treffer ersetzt Schildsegmente nicht. Alle am Boden → Szene wiederholt (Regiebuch `ausgang: scheitert`).
- **Pulte:** 4 Pulte, Halten ~6 s (`halten.terminal_hack`, neu), 4. Hack schließt ab. Captain sieht nächstes Pult und Monsterposition (Snapshot: `mission.monster = { x, y, zustand }`, `naechstesPult`), Ops-Einsatzleiter-Hinweise (Pins).
- **Erreichbarkeitsprüfung** (neu, `buehne.js`): K-MONSTER-PULT (Monster erreicht jedes Pult-Umfeld), K-MONSTER-FLUCHT (von jedem Pult ≤ 12 Schritte bis zu einer Luke des Hauptnetzes, Spieler-BFS), K-MONSTER-KRIECH (das Kriechnetz ist für die Monster-Maske unerreichbar). Nutzt `lukenAmHauptnetz`.
- **Kriechgang-Gefahr:** ein Spieler im Kriechgang ist sicher, aber langsam (Duck-Tempo `crouch.speedFactor`); das Monster verliert Sichtlinie (Luken zu).
- **Dateien:** `shared/gen-station.js` (Variante), `shared/buehne.js` (Prüfregeln), `server/sim/monster.js` (neu), `server/sim/combat.js` (unverwundbar, Hit Down), `server/sim/anker.js` (Terminal-Hack), `server/game.js` (Snapshot), `public/js/render.js` (Monster-Sprite, Pult-Hinweis), `tools/test-monster.js`.
- **Schnitt:** Storage: Monsterzustand in `game.away` (Snapshot nur klein); Action: `monster.tick/laerm/maske`, `anker.terminalHack`, `combat.monsterTreffer`; Frontend: Darstellung. Keine Boden-KI-Überarbeitung (Briefing ausgeklammert), `monster.js` ist parallel zu `squad.js`.
- **Bots:** `sim-headless` braucht Terminal-Hack und Ablenk-Strategie (Zufallslärm), „Bot schafft die Station mit und ohne Ablenkung“.
- Schätzung **4–5 Tage**; Risiko hoch (Pfad/Kollision/Maske, Prüfer, Bots).

## 4. Schnittstellen/Flags
Keine Flags an bestehenden Funktionen. Neue Ereignisse: `zoneRuecksetzen`, `landepunktGescannt`, `pultGehackt`, `monsterTreffer`.

## 5. Entscheidungen
S1 Größenklassen statt Kachelart (Kai). S2 Monster eigene Zustandsmaschine, unverwundbar, immer aktiv, Treffer = Wunde (Kai). S3 7a vor 7c, 7b parallel (Kai). S4 „Falscher Weg wirft zurück“ ist Szenenlogik, kein Zonenwert. S5 Landepunkt-Karten erweitern `mapsKnown`-Muster, ändern ihn nicht. S6 4 Pulte, ~6 s Hack (Default).

## 6. Abnahme
7a: Ops-Scan zeigt Pfeil/Stärke, Navigation fliegt nach Ansage, falscher Weg setzt zurück, Finale mit Feldkarte. 7b: Landepunkt-Scan → Karte am Planungstisch, ohne Scan keine, Captain-Karte erst nach Beamen, Speichern/Laden. 7c: Monster folgt Lärm, passiert Gänge/Türen, bleibt vor Kriechgang/Luken, trifft = Boden, Szene wiederholt bei allen am Boden, Bot mit/ohne Ablenkung, K-MONSTER-* grün auf 200 Seeds. Immer: `npm test`, `npm run check`, Golden, Snapshot, Eisenwald.

## 7. Schätzung (korrigiert)
**8–10 Tage** gesamt (7a 2–3, 7b 2, 7c 4–5, Finale-Verkabelung 1). Briefing 4–5 war zu knapp.

## 8. Offene Fragen an Kai
- Monster-Treffer: Verwundung auch bei Schild an (Default: ja, Schild ignoriert).
- Dürfen Spieler das Monster mit Gegenständen/Türen aussperren (Schott schließen)? Default: ja, Schotts sind Lärm, schließen blockiert es 5 s.
- Captain-Außenkarte vor dem Beamen: heutiger Stand nicht geprüft; Default beibehalten wie in Kais Regel.
