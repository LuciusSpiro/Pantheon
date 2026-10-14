# CONCEPT-SL0 – Grundlagen der Kampagne „Die Schuld der Lerche“: Ops, Gegnerschilde, Personen als Fracht

Grundlage: `Briefing Die Schuld der Lerche (SL0-SL12)` und `Kampagne Die Schuld der Lerche` im Vault (`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`),
Kais Entscheidungen vom 2026-10-14. Vorbild: `CONTRACT-EK3.md` (Fracht, Frachtraum). Stand: **Konzept, nicht gebaut**.
Code-Stand geprüft auf `main` (87ff7a7).

## 1. Befund (Abweichungen vom Briefing)
- Ops-Umbenennung: `CMD_CONSOLE.weapons` / Anzeige „TAKTIK“ (`server/game.js:35`); „Taktik“ steht in ca. 73 Dateien (public/js, shared, server/sim, content). Kein Namenskonflikt mit „Ops“.
- Schilde: Der Snapshot liefert Schilddaten **aller** Gegner schon (`game.js:1667-1669`, kompakt; `shields` fehlt bei vollen Schilden, `shieldsMax` aus der Klasse). Nur das Zeichnen hängt an `e.scanned` (`render.js:3671`, `drawEnemyIntel`). Waffendaten gehen ohne Scan nicht raus (richtig so). SL0-Schilde sind also **reine Renderarbeit**, kein Protokollumbau.
- Personen: gibt es nur auf Außenkarten (`away.js:33-56`, `personenSnap`). „Gerettet“ = `present=false` + Eintrag in `game.rescuedPersons` (`away.js:262-265, 762`); die Person verschwindet. Nichts an Bord, nichts im Weltstand (`weltstand.js:713` speichert nur `schiff.fracht`).
- Fracht (`server/sim/fracht.js`): Taktik beamt Pods im Raum (`draussen`) an Bord, Halteprozess 3 s, Kapazität 2 (`maps.js:353-354`, `CARGO_BAYS`), Arten hart `['sprengstoff','fracht']` (`config.js:85`), Speicher `lager[{art}]`, Weltstand `schiff.fracht = [art…]`. Es gibt **kein** Beamen von einer Karte (Boden) an Bord durch die Taktik.
- Frachtraum (`maps.js:348-355`): Bucht `g` (`cargo_bay`) bay0 (23,25), bay1 (27,25). Dort steht schon **Ivos Schlafecke** (`cargo_cot` = Pritsche, `tool_wall`, nur mit Bewohner gezeichnet, `render.js:1849`, `voxel/ship.js:418`). Das neue Layout muss damit zusammenpassen.
- Konsole `sonde` (Kustoden-Sonde am Boden): `CMD_CONSOLE` (`game.js:35`), `interior.js:136, 574-577`, `away.js:25, 89, 450-495`, `landepunkte.js:140`, `mission.js:165`, Tutorial m1/m2. Muss für SL4 frei werden.

## 2. Entscheidungen (Kai, 2026-10-14; Rest = Studio-Default)
| # | Entscheidung |
|---|---|
| E1 | Die Station heißt in **allen Texten „Ops“**; interne ID `weapons` bleibt. |
| E2 | Schilde: für alle blau/Funken + Schildstreifen im Lebensbalken; **Segmentbögen für die Ops ohne Scan** (Sensorreichweite). Ziel-Scan bleibt für Subsysteme und Waffenbögen. |
| E3 | **Personen sind Fracht.** Die Ops (Taktik) beamt sie, auch vom Boden; belegt **einen Frachtplatz**; kein Außenteam (blockiert den Notfallsprung nicht). Ersetzt „Captain beamt Personen“. |
| E4 | Person ist im Frachtraum als **Figur** sichtbar, Layout mit **2 Betten**, auf denen Personen liegen. Gespräch nur über Buch-Zeilen (ODA/Funk), kein freies Ansprechen. |
| E5 | Alte Konsole `sonde` wird **`kustodenpult`** (Anzeige „Kustodenpult“); Golden mit Abweichungsliste. |

## 3. Entwurf

### 3.1 Ops (Frontend + Konfiguration)
- Neue Anzeigekonstante `STATION_NAMES` (shared/protocol.js oder config) statt Streutexte; alle UI-/Hilfe-/Tutorialtexte lesen sie. Server-ODA-Texte („Taktik“) in `server/sim/*` und Regiebücher werden ersetzt (Textsuche, 73 Treffer, danach `npm run check`). Keine Logikänderung.
- Tutorialtexte m1–m3 sind Inhalt, nicht Struktur: nur Wortwahl ändern, Golden zeigt die Abweichungen.

### 3.2 Gegnerschilde
- Frontend, lokal in `render.js`: `drawEnemyShieldHints(ctx, e)` (neu, nicht exportiert) für Hüllenbalken + Schildstreifen (alle Stationen) und Segmentbögen (`console === ops`, Gegner in Sensorreichweite, ohne `e.scanned`). Bestehendes `drawEnemyIntel` bleibt für Scan-Inhalt. Treffer-Effekte (blau/Funken): Client-Ereignis `enemyHit` hat die Info schon (`view.enemyHit`); fehlt `shieldHit`-Unterscheidung, im Snapshot-Ereignis ergänzen (klein).
- Keine Serverregel, kein neuer Snapshot-Zustand. Snapshot-Budget unverändert (Messung mit `tools/snap-mess.js` im Labor Korvette/Fregatte/Kreuzer).

### 3.3 Personen als Fracht
**Storage-Layer** (`game.fracht`, Weltstand): `lager[]` bekommt neben `{art}` den Eintrag `{art:'person', person:'evert', name:'Evert Kroeger', bett:0|1}`; `frei()` zählt unverändert (ein Platz). Config `fracht.arten` erhält `'person'`. Weltstand `schiff.fracht` bleibt Liste, Personen als Objekt `{p:'evert'}` neben Strings (Altstand = nur Strings, lesbar). Snapshot: `fracht.lager` bleibt Strings für Waren; Personen zusätzlich `fracht.pers:[{id,n}]` (kompakt, fehlt wenn leer).
**Action-Layer** (`fracht.js`, neue benannte Funktionen, **keine** Flags an `beamStart`):
- `personBeamStart(game, p, personId)` / `personAbgebenStart(game, p)` – Halteprozess wie Waren (`s.halt.kind` `'person_an'|'person_ab'`), gleiche Reichweite/Abbruchregeln (Systemtreffer bricht ab).
- `personAnBordNehmen(game, person)` / `personAbgeben(game, ort)`, `personAnBord(game, id)` (Abfrage).
- Quelle „vom Boden“: eine Person auf der Karte des gewählten Landepunkts (`away.npcs`, `present`, nicht `rescued`, nicht Außenteam). `away.js` bekommt `personAbziehen(aw, id)` (setzt `present=false`, **nicht** `rescued`, sondern Verweis auf Frachtraum) und `personAbsetzen(aw, id, anker)`. Reichweite: Lerche im Orbit/Szene des Landepunkts (`beamSpot`) – **ungeprüft**, ob die Szenenbedingung „Lerche über dem Landepunkt“ schon als Funktion existiert; sonst eine neue in `landepunkte.js`.
- Neue Bausteine (Regiebuch, `server/mission/bausteine/fracht.js`): `person_an_bord {person}` (Prüfung), `person_abgeben {person, ort?}` (Aktion, Skript), `person_aufnehmen {person}` (Aktion, z. B. Rückfall/Labor). Ereignisse `personAnBord`, `personAbgegeben`.
- Taktik-Befehle: `weapons.fracht` erhält ein neues, getrenntes Kommando `weapons.person {id}` / `{off}` / `weapons.person_ab` (nicht ein Parameter an `weapons.fracht`).
**Frontend-Layer:** Taktik-/Ops-Leiste zeigt „Person: Evert (Bett 1)“; Beamstrahl-Anzeige wie Waren. Frachtraum: Figur liegt im Bett (siehe 3.4).

### 3.4 Frachtraum-Layout (Interior, +1–2 Tage)
- `shared/maps.js`: zwei Betten (`cargo_bed`) im Frachtraum (22–28 × 25–27), je ein Platz `{id:'bett0'|'bett1', x, y}`; Ivos Pritsche (`cargo_cot`) und Werkzeugwand dürfen nicht kollidieren – Entscheidung: die zwei Betten **ersetzen die Buchten nicht**, sondern kommen an die Südwand; Buchten für Waren bleiben (Kapazität weiter 2 **gemeinsam**: Person belegt einen Platz, ob Bucht oder Bett). Ungeprüft: Platz im Raum reicht, BFS-Test und Frachtraum-Tests (`tools/test-lager.js`) anpassen; ggf. Raum um eine Reihe erweitern (Deckplan).
- Figur: Person im Bett als Kulisse aus `snapshot.fracht.pers` (2D `art.js`/`render.js`, Voxel `public/js/voxel/ship.js`). Figur nutzt die NSC-Figur der Karte (Name/Sprite aus `npc.json`), liegt auf dem Bett, keine KI, keine Kollision.
- Ohne Person bleibt der Raum wie heute (Waren + Ivos Ecke); Golden-Abweichungsliste, Voxelwerk-Modell `lerche/furn/bed` wird wiederverwendet (kein neues Modell nötig, Vermutung).

### 3.5 Konsole `sonde` → `kustodenpult`
Umbenennen in `game.js:35, 1055` (`sonde.input` bleibt als Protokollname? Entscheidung: Nachricht `kustodenpult.input`, Altname nicht mehr), `interior.js`, `away.js` (`aw.sonde` → `aw.kustodenpult`), Snapshot `away.sonde`, Weltstand-/Regiebuch-Texte, `mission.js:165`, Client `consoles.js`. Weltstand-Altfelder tolerieren (Lesen beider Namen). Reiner Mechanikwechsel ohne Verhaltensänderung.

## 4. Schnittstellen/Flags
Ereignisse `personAnBord {person}`, `personAbgegeben {person, ort}`; Prüfung `person_an_bord`; Weltstand `schiff.fracht` (gemischte Liste); Snapshot `fracht.pers`. Nutzer: SL3 (Evert Überfahrt/Abgabe), SL9 (Evert befreit, Heimflug), SL7 (Landepunkt per Scan, nicht hier).

## 5. Abnahme
Ops überall umbenannt (Textsuche „Taktik“ leer bis auf Code-IDs); Labor Korvette/Fregatte/Kreuzer: Schilde ohne Scan für Ops sichtbar, Schildtreffer blau, Hülle Funken; Person vom Boden an Bord beamen (Halten, Abbruch bei Treffer), speichern/laden, Evert im Bett sichtbar (2D/Voxel), abgeben, Frachtplatz belegt/frei; Notfallsprung mit Person an Bord erlaubt; `kustodenpult` in m1/m2 funktionsgleich; `npm test`, `npm run check`, Golden mit Abweichungsliste, Snapshot unter Grenze, Eisenwald läuft durch.

## 6. Schätzung
Ops-Umbenennung 1 T., Schilde 1 T., Personentransport (Logik, Weltstand, Bausteine, Beam-Quelle Boden) 2–3 T., Frachtraum-Layout/Figur 1–2 T., `kustodenpult` 0,5 T. **Summe 5,5–7,5 T.** (Briefing: 2–3).

## 7. Offene Fragen (Default)
1. Beamen vom Boden: reicht „Lerche in der Szene des Landepunkts“ oder braucht die Ops einen Landepunkt-Scan (SL7-Regel)? Default: Scan nötig, sonst Szene egal.
2. Zwei Personen gleichzeitig: Default ja (zwei Betten), nur Evert wird gebraucht.
3. Frachtraum zu klein? Default: Raum behalten, Betten an die Südwand; sonst Deckplan um eine Reihe wachsen lassen (Kai entscheidet nur, falls Grundriss Fenster/Tür weicht).
