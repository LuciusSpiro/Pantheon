# CONTRACT-S1 – Spielleiter S1 „Regiebuch & Weltstand“ (+ Spielmenü, Pantheon)

Ergänzung zu `CONTRACT.md` und `CONTRACT-M0.md` bis `CONTRACT-M4.md`. Vorhandene Feldnamen werden nicht gebrochen, außer
dort, wo dieser Vertrag etwas ausdrücklich entfernt oder umbenennt. Bei Widerspruch gilt der Code. Abweichungen meldet jedes
Team in seinem Bericht; die Studioleitung gibt sie an die betroffenen Teams weiter.

- Pitch: https://claude.ai/artifact/XTBDijM6Tupr5QNRh7ZFtM
- Briefing: Brain-Vault `Coop-Spiel/Briefing Spielleiter S1.md` (inkl. „Entschieden (Kai, 2026-10-07, zum Pitch S1)“)
- Vorarbeit: `content/regiebuch/README.md`, `content/regiebuch/helfer-inventar.md`, `concept/regiebuch/trockenversuch/`

## 0. Ziel und Entscheidungen

**Ziel.** Nach S1 läuft das komplette Tutorial (m1–m3) aus **Regiebüchern** (reines JSON), ein **Prüfer** begründet jeden
Fehler, und die Kampagne überlebt das Beenden als **Weltstand**. Es gibt ein **Spielmenü** (Partie beenden → Hauptmenü,
Optionen), und das Spiel heißt **Pantheon**. Kein LLM im Spiel. Spielerisch ändert sich sonst nichts.

**Entscheidungen von Kai (2026-10-07):**
1. Neuer Lobby-Start **„Kampagne ohne Tutorial“** (`free`). „Übung überspringen“ (`skipDrill`) bleibt.
2. Nach „ohne Tutorial“: freier Flug ab Hafen Lichtkordon; Tesk funkt das Gerücht über die Tafel. Keine Mission in S1.
3. Marken beim Start ohne Tutorial: **`CONFIG.campaign.skipTutorialMarks`**, Standard = `economy.startMarks` (Kai legt die
   Zahl später fest – nicht raten, nicht ändern).
4. Speichern beim Andocken, solange angedockt laufend (entprellt) und beim Abschluss einer Mission.
5. Laden startet den gespeicherten Schritt neu; Außenkarten fallen auf den Schrittanfang zurück. Die m1-Nachhut wird so
   abgesichert, dass sie nach dem Laden nicht ein zweites Mal kommt.
6. „Partie beenden“ darf jeder, mit Bestätigung; alle anderen sehen, wer es war.
7. Ivo nicht gerettet → Status `vermisst` (nicht tot).
8. Die Plünderer auf Kesh sind **nicht** die Rostmeute; Grauzahn bleibt aus m3 heraus.
9. Das Spielmenü hält das Spiel **nur solo** an.
10. Zwei Runden gleichzeitig = zwei Serverprozesse; eine **Sperrdatei** verhindert, dass beide denselben Weltstand öffnen.
11. m1–m3 werden **von Hand** als Regiebuch geschrieben (gleiche Schritt-IDs wie heute); ein Test belegt die Zuordnung zu
    den Katalog-Umsetzungen.
12. Nebenaufträge (Selas Notruf, Wrack „Zaunkönig“): nur **Bucheinträge als Daten**, keine eigenen Abläufe (S3).
13. Ablage: `content/` (eingecheckt) für Regiebücher, Katalog, Schemas, NSC; Weltstände in `data/worlds/` (nicht eingecheckt).
14. Ungültiges Regiebuch beim Serverstart: mit `--debug` Abbruch, sonst laut loggen und nicht anbieten.
15. `schuetzling` nicht in S1 (erstes Paket S2). Im Schema nur als `besetzung.schiffe` reserviert; der Prüfer lehnt mit
    Code `MECHANIK-GEPLANT` ab.
16. Kein Notfallsprung als Speicherpunkt.
17. Chronik-Reiter im Missionsbuch ist **Kann-Ziel**.
18. **Weltstand nur für die Kampagne** (mit oder ohne Tutorial). Direktstart Planetenmission (`m3`) und die Testgelände
    (`arena_space`, `arena_away`) sind Test-/Endlos-Szenarien und legen **nie** einen Weltstand an.
19. **Das Tutorial bleibt** dauerhaft im Spiel: als Kampagnenstart und als feste **Testmission** für Engine, Prüfer und
    Weltstand. Die alten JS-Module `server/missions/m1–m3.js` werden erst gelöscht, wenn der Golden-Trace-Vergleich grün ist
    (§9) – das macht die QA, nicht Welle 1.
20. **Spielleiter-Tests ohne LLM:** einfache, gezielte Tests; LLM-Aufrufe in diesem Bereich so selten wie möglich (§8).

**Nicht in S1:** LLM im Spiel, Spielleiter-Agent, neue Missionen, Live-Wendungen, Feldzug-Uhren, Hexkarte, Orts-Generator,
neue Rollen, `schuetzling`, Speichern aus dem Kampf.

**Nicht brechen:** Grün bleiben `npm run check`, `npm test`, `npm run sim`, `node tools/ws-smoke.js`, `npm run check:assets`.
Testgelände und Direktstart m3 funktionieren wie heute. Snapshot im Spiel bleibt < 13 KB (Lobby-Felder nur in Phase `lobby`).

## 1. Dateibesitz und Wellen

| Welle | Team | Dateien (nur diese ändern) |
|---|---|---|
| 0 | Studioleitung | `CONTRACT-S1.md`, `shared/maps.js` (§4: `MAP_OBJECTS`, `MAP_AREAS`, `inArea`), `package.json`, Umzug `concept/{regiebuch,katalog}` → `content/` (Pfade in `tools/check-missions.js` und `tools/katalog.js` angepasst), `shared/config.js` (Block `campaign`, `weltstand`, `menu`) |
| 0 | QA-VORLAUF | **neu** `tools/golden-trace.js`, **neu** `tools/fixtures/golden/**`, Bericht mit Basismessung. Läuft gegen Commit `260a330` in einem eigenen Worktree. |
| 1 | ENGINE | `server/sim/mission.js`, `content/regiebuch/regiebuch.schema.json`, **neu** `server/mission/{registry,loader,checker,katalog,objects}.js`, `server/missions/arena.js` (wird Regiebuch `content/regiebuecher/arena_space.regiebuch.json` **oder** bleibt JS mit `intern` – Wahl ENGINE, im Bericht nennen), `tools/check-missions.js`, `tools/katalog.js`, **neu** `tools/test-regiebuch.js` |
| 1 | DATEN | **neu** `content/regiebuecher/{m1,m2,m3}.regiebuch.json` (m3 aus der Vorarbeit übernehmen und anpassen), **neu** `content/npc.json`, **neu** `tools/fixtures/regiebuecher-kaputt/*.json`, `content/regiebuch/bausteine.json` (nur ergänzen, Änderungen melden) |
| 1 | WELTSTAND | **neu** `server/weltstand.js`, `server/store.js`, `server/game.js`, `server/index.js`, `server/sim/explore.js` (nur Lesen/Schreiben-Helfer für den Weltstand), `shared/protocol.js` (nur ergänzen), `content/schema/weltstand.schema.json`, **neu** `tools/test-weltstand.js` |
| 1 | CLIENT | `public/index.html`, `public/js/{client,hud,consoles,net,render,dev-mock}.js`, `public/js/voxel/*` **nur** für den Umschalter Voxel/2D (Hook aufrufen, nicht umbauen) |
| 1 | ART-AUDIO | `public/js/art.js`, `public/art-preview.html`, `public/js/audio.js`, `public/audio-preview.html` |
| 1 | TESTS | **neu** `server/mission/{llm,context}.js`, **neu** `tools/test-spielleiter.js`, **neu** `tools/test-llm-live.js`, **neu** `tools/fixtures/llm/**`, **neu** `tools/fixtures/context/**` |
| 2 | QA-INTEGRATION | alle Dateien; Integration, Golden-Trace-Vergleich, Löschen der alten Missionsmodule |
| 3 | QA-ABNAHME | alle Dateien; ehrliches Durchspielen, Messung, `README.md` |

**Testserver** nur auf freien Ports mit `ROOM_CODE=off` und eigenem `WORLD_DIR` (z. B. `data/worlds-<team>`):
QA-VORLAUF 3390–3392, ENGINE 3370–3372, DATEN 3373–3375, WELTSTAND 3376–3378, CLIENT 3379–3381, ART-AUDIO 3382,
TESTS 3383–3384, QA 3385–3389. **Ports 3300/3301 nie anfassen.** Screenshots nach `shots/<team>/`, Playwright-Skripte nach
`C:\tmp\pwtest\sts\s1-<team>-*.js`. Dateien nur mit Edit/Write ändern (Umlaute!). Nur eigene Browser-Prozesse beenden.

**Aufrufe in fremde Module** sind defensiv: Fehlt eine Funktion aus diesem Vertrag noch, greift ein No-op bzw. das alte
Verhalten, und der Fehler wird mit `game.countError(where, err)` gezählt – nie stillschweigend geschluckt.

## 2. Regiebuch-Format (`content/regiebuch/regiebuch.schema.json`, Format `regiebuch/1`)

Grundlage ist die Vorarbeit (`content/regiebuch/README.md`, `m3.regiebuch.json`). **Ablauf englisch wie im Code**
(`steps`, `enter`, `timers`, `rules`, `objectives`, `next`, `choices`, `on`, `onAccept`, `skip`, `scan`, `jumpBlock`,
`destBlock`, `allowBeam`, `restartOnReturn`, `loc`), **Rahmen deutsch** (`kopf`, `angebot`, `buch`, `buehne`, `besetzung`,
`ausgaenge`, `texte`, `debug`). Ergänzungen gegenüber der Vorarbeit (ENGINE pflegt das Schema, DATEN schreibt danach):

| Feld | Bedeutung |
|---|---|
| `erwartet` | `{ flagName: standardwert }` – Flags aus früheren Missionen, die dieses Buch liest (z. B. m2: `{ "decision": "deliver", "technikerRescued": false }`). Fehlt die Flag beim Start, setzt die Engine den Standard. |
| `angebot` | `{ nach: { missionDone: id } \| null, start: true?, direktstart: { lobby, setFlag? }?, anbieter?: npc, nicht_wenn?: Bedingung }`. Ersetzt `MISSION_ORDER` und `onComplete: startMission`. `start: true` = erste Mission der Kampagne mit Tutorial. Missionen werden **sofort** aktiv, wenn `nach` erfüllt ist (wie heute). |
| `steps[].drill` | `true` = Hafen-Übungsschritt (ersetzt `isDrillStep()`-Sonderfall `m1/dock`). |
| `steps[].wiederaufnahme` | `{ ab: <Schritt-ID>, prep?: Aktionen }` – Schritt ist nicht neustartfest; Laden setzt hier fort. |
| `ausgaenge.<id>` | `{ folgen: Aktionen, danach?: Aktionen }`. `complete: "<ausgang>"` in Aktionen/`next` schließt die Mission mit diesem Ausgang ab. `complete: true` = Ausgang `erfolg`. |
| `folgen` | Aktionen (auch mit `if`); typisch `welt_fakt`, `npc_gedaechtnis`, `npc_haltung`, `npc_status`, `chronik`, `remove_item`. |
| `wendung` / `ankuendigung` / `wirkung` | Wie Vorarbeit. Eine Wendung ohne `ankuendigung` ist ein Fehler (`FAIRNESS`). |
| `garantie` | `"hinweis" \| "zeitlimit" \| "autoloesung" \| "notausgang"` wie Vorarbeit. |
| `besetzung.stimmen` | `{ id: { name } }` – Sprecher ohne NSC-Datensatz („Kustoden-Relais“, „Logbuch Zaunkönig“). |
| `besetzung.schiffe` | reserviert (`schuetzling`, S2) → Prüfer: `MECHANIK-GEPLANT`. |
| `buch` | `{ von: [{ if?, npc }], briefing, belohnung }` – ersetzt `book.from` als Funktion. |
| `texte` | `{ kennung: "Text" }`; Verweis mit `"@kennung"`. ODA-Texte ≤ 120 Zeichen (Schemaregel). |
| Platzhalter | `{salvaged}`, `{killed:x}`, `{left:x}`, `{found}`, `{total}`, `{arena}`, **neu generisch** `{squadLeft:<gruppe>}`, `{objectsInState:<objekt>:<zustand>}`. Alte `{awayLeft:x}`/`{jammersOff}` bleiben als Altnamen. |
| `_kommentar` | einziges freies Feld; sonst keine unbekannten Felder (Schema `additionalProperties: false` im Rahmen). |

Zahlen dürfen `{ "cfg": "pfad", "plus"?: n }` sein; aufgelöst **beim Missionsstart** (damit `tune` wirkt).

## 3. Bausteine und Engine (ENGINE)

### 3.1 Registry – `server/mission/registry.js`
```js
Registry.define(entry)   // entry = { id, art: 'aktion'|'pruefung', beschreibung, params: { name: { typ, pflicht?, werte?, min?, max? } },
                         //           ereignisse?: string[], effekt?: 'gegner'|'schaden'|null, intern?: bool,
                         //           run?(mission, args) /* aktion */, test?(mission, args) -> bool /* pruefung */ }
Registry.get(id)         // -> entry | null
Registry.describe()      // -> [{ id, art, beschreibung, params, ereignisse, effekt, intern }]  (JSON, ohne Funktionen)
```
- Kennungen in **snake_case** nach `content/regiebuch/helfer-inventar.md` / `bausteine.json` (z. B. `reveal_location`,
  `spawn_squad`, `object_state`, `area_occupied`, `item_in_area`, `set_object_state`, `squad_cleared`, `team_down`).
  `bausteine.json` ist die **eingefrorene Liste** für Welle 1; Ergänzungen meldet ENGINE/DATEN an die Studioleitung.
- `typ` ∈ `map, loc, squad, object, area, item, npc, text, system, number, bool, string, state, mission, hidden`.
- Interne Bausteine (Debug, Testgelände, Übung) tragen `intern: true` – der Prüfer verbietet sie in Büchern mit
  `kopf.art` ≠ `"intern"` außer in `skip`/`debug`.
- **Weltstand-Aktionen** (rufen `game.weltstand`, §5.4; ohne Weltstand No-op):
  `npc_gedaechtnis { npc, ereignis, text, haltung?, gewicht? }`, `npc_haltung { npc, delta }`, `npc_status { npc, status }`,
  `welt_fakt { key, value, quelle? }`, `chronik { text }`, `remove_item { item, n? }`.
- Die schweren Module (`combat`, `space`, `arena`) werden erst beim Aufruf geladen – `describe()` und der Prüfer laufen
  ohne Server.
- Das Kapitel `HOOKS`/`CHECKS` in `mission.js` entfällt; **jeder** `do:`/`check:` läuft über die Registry. Unbekannt →
  `countError('mission-hook'|'mission-check')` wie heute.

### 3.2 Loader – `server/mission/loader.js`
```js
Loader.loadAll(dir?)      // dir = content/regiebuecher -> { books: { id: book }, invalid: [{ id, file, errors }] }
Loader.prepare(book, C)   // -> Laufzeit-Def: cfg aufgelöst, def.title = kopf.titel, Texte bleiben @-Verweise
Loader.text(def, s)       // '@kennung' -> def.texte[kennung]; Literal unverändert; unbekannt -> '[kennung]' + countError
```
Beim Serverstart lädt `Mission` alle Bücher und prüft sie (§3.3). Ungültige werden nicht angeboten (Entscheidung 14).

### 3.3 Prüfer – `server/mission/checker.js`
```js
Checker.check(book, ctx?)   // -> { ok, errors: [{ code, p, msg }], warnings: [...] }  (Feldnamen wie tools/check-missions.js)   ctx: { registry, maps, locations, config, npc }
Checker.validate(obj, schema)   // kleiner JSON-Schema-Prüfer ohne Abhängigkeiten (auch für den Weltstand)
```
- Codes wie heute in `tools/check-missions.js` (`REF-ORT`, `REF-TEXT`, `ABLAUF-UNERREICHBAR`, `ENTSCHEIDUNG-OHNE-AUSGANG`,
  `FAIRNESS`, …), **neu**: `FLAG-FORM` (`setFlag`/`set` nur Objekt, Schlüssel `^[a-z][A-Za-z0-9_]*$`, Werte bool/string/
  number/null), `FLAG-UNGESETZT` (gelesene Flag weder gesetzt noch in `erwartet` noch global bekannt: `selaCalled`,
  `vaelenHelped`, `technikerRescued`, `bribed`, `decision`, `m3Direct`), `FLAG-UNGELESEN` (Warnung),
  `NEUSTART` (Schritt nicht neustartfest und ohne `wiederaufnahme`), `MECHANIK-GEPLANT`.
- `tools/check-missions.js` bleibt die Kommandozeile (alle Bücher, `--selftest`), ruft aber `Checker` auf.
- Der Server ruft den Prüfer beim Start für alle Bücher und in `startMission()` noch einmal (1–3 ms).

### 3.4 Objekte und Bereiche – `server/mission/objects.js`
Liest `Maps.MAP_OBJECTS`/`MAP_AREAS` (§4) und bildet Zustände auf die bestehenden Laufzeitstrukturen ab (`kesh.jammers[].off`,
`kesh.vault.open`, `kesh.tablet.taken`, Wächter, `platform.sonde.disabled`, `platform.coreRebooted`, `platform.npc`,
Datenkern, Wrack-`hollow`/`loreRead`). `combat.js`/`away.js` werden **nicht** umgebaut.
```js
Objects.state(game, map, object, index?)     // -> Zustand (string) bzw. Liste bei mehreren Exemplaren
Objects.setState(game, map, object, state)   // nur die Zustände, die die Laufzeit kennt; sonst countError
Objects.inArea(game, map, area, x, y)        // Pixelkoordinaten -> bool (über Maps.inArea)
```

### 3.5 Mission-API (Ergänzungen in `server/sim/mission.js`)
```js
mission.startCampaign({ tutorial })   // tutorial true: erste Mission mit angebot.start; false: alle Tutorial-Missionen
                                      // gelten als erledigt mit Ausgang 'uebersprungen' (nur deren Fakten, kein Gedächtnis),
                                      // Tesk-Funk mit dem Tafel-Gerücht nach CONFIG.campaign.teskRumorAt s
                                      // (content/npc.json -> kampagne.ohne_tutorial: { funk: { from, text }, fakten: {} }, DATEN)
mission.startDirect(id)               // wie heute (Lobby-Direktstart m3), ohne Weltstand
mission.toSave()                      // -> { missionen: { id: { status, ausgang?, schritt?, v, ereignisse[], entscheidungen[],
                                      //       erledigte_ziele[], start_s, ende_s? } }, aktiv: id|null, flags, buchFokus }
mission.restore(obj)                  // Zustand übernehmen; aktive Mission: setStep(schritt bzw. wiederaufnahme.ab),
                                      // danach v/ereignisse/entscheidungen/erledigte Ziele überlagern
mission.offers()                      // Angebotsreihenfolge (ersetzt MISSION_ORDER); MISSION_ORDER bleibt als berechneter Export
```
- `isDrillStep()` → `!!(this.step && this.step.drill)`. Aufrufer in `bots.js`, `damage.js`, `interior.js`, `space.js`
  bleiben unverändert.
- `beamDownBlocked()` aus Kartenregel bzw. `allowBeam` (keine m1-Sonderlogik im Code).
- Bucheinträge Sela/Zaunkönig kommen aus Daten (`content/regiebuecher/*`, `kopf.art: "nebenauftrag"`, nur `buch` +
  Zielbedingungen, **kein** Ablauf). Live-Zähler über Platzhalter.
- Ereignis `missionDone { id, title, ausgang }` (neu: `ausgang`).

## 4. Kartendaten (Studioleitung, Welle 0) – `shared/maps.js`

```js
Maps.MAP_OBJECTS = { platform: {...}, wreck: {...}, kesh: { jammer: { legend: 'jammer', zustaende: ['on','off'], viele: true }, ... } }
Maps.MAP_AREAS   = { kesh: { landezone: { rect: [x, y, w, h] }, hof: { cols: [0, 27] }, halle: { cols: [37, 47] }, gewoelbe: { rect: [...] } } }
Maps.inArea(mapId, areaId, tx, ty)   // Kachelkoordinaten -> bool
```
`hof` und `halle` sind bewusst **Spaltenbereiche** (x ≤ `missionM3.courtyardX`, x ≥ `missionM3.hallX`) – genau wie heute.
`tune missionM3.hallX/courtyardX` wirkt danach nicht mehr (bekannt, akzeptiert). `npm run check` prüft: Bereich nicht leer,
begehbar und von den Pads per BFS erreichbar.

## 5. Weltstand (WELTSTAND)

### 5.1 Format (`content/schema/weltstand.schema.json`, `version: 1`)
Wie `content/regiebuch/weltstand.beispiel.json`, ergänzt um: `meta: { spieler: [namen], server: SERVER_VERSION }`,
`tutorial: 'laeuft'|'erledigt'|'uebersprungen'`, `welt.odaSeen[]`, `welt.scans[]`, `welt.wrack: { salvage: [bool], loreRead }`,
`welt.log[]` (letzte 60), `missionen` (= `mission.toSave()`), `npc` (Datensätze aus `content/npc.json` + Laufzeit),
`chronik[]`, `welt.fakten {}`.
- **Gespeichert:** Marken, Lager, Ausbauten (`upgrades`), Deko, Quartiere, `support`, Pins des Planungstischs, Hülle,
  Systeme (`offline` → `ok`, `fragile` → `damaged`), bekannte/besuchte/aufgedeckte/gefundene Orte, offene Verbindungen,
  Flags, Missionen, NSC, Chronik, Fakten, Spielzeit.
- **Nicht gespeichert:** Positionen, Konsolen, Getragenes, Gegner, Projektile, Feuer, Lecks, Reaktor, Schildverteilung,
  Bots, Timer, Außenkarten außer dem Wrack, Seed, Teaser.
- **`content/npc.json`** (DATEN): `{ "npc": { "<id>": { name, titel, fraktion, rolle, status, haltung, ort? } },
  "kampagne": { "ohne_tutorial": { "funk": { "from", "text" }, "fakten": {} } } }` – Startwerte jeder neuen Kampagne.
- **NSC-Gedächtnis:** Eintrag `{ ereignis, text, mission, schritt?, haltung?, gewicht?, spielzeit_s }`; `text` wird beim
  Schreiben aufgelöst. Höchstens 12 Einträge je NSC (älteste mit kleinstem `gewicht` fallen raus). Haltung −3 … +3.

### 5.2 Ablage und Robustheit – `server/weltstand.js`
```js
Weltstand.MAX = 5
Weltstand.dir(env)            // WORLD_DIR oder data/worlds
Weltstand.list(dir)           // -> [{ id, name, savedAt, playTime, loc, mission, step, chronikLast, spieler,
                              //       state: 'ok'|'kaputt'|'neuer'|'belegt', grund? }]  (max. 5, neueste zuerst)
Weltstand.create(game, { tutorial })   // neuer Stand im Speicher, id kurz + zufällig (z. B. 'w-7k3p'), Name 'Lerche · TT.MM.'
Weltstand.capture(game)       // -> JSON (version 1)
Weltstand.save(game)          // -> { ok, error? }  atomar: tmp + fsync + rename, vorher alte Datei -> <id>.bak.json;
                              //    Windows EPERM/EBUSY: bis zu 3 Versuche
Weltstand.load(dir, id)       // -> { ok, data?, error? }  nie throw; Schemafehler -> .bak versuchen -> sonst 'kaputt'
Weltstand.apply(game, data)   // nach reset(): Zustand übernehmen, Schiff angedockt an data.ort.angedockt, mission.restore
Weltstand.remove(dir, id)     // Datei + .bak löschen (nicht, wenn gesperrt)
Weltstand.lock(dir, id) / unlock(dir, id)   // <id>.lock mit { pid, port }; verwaist, wenn pid nicht mehr läuft
```
- Kaputte Datei wird umbenannt in `<id>.kaputt-<ts>.json` und in der Liste als `kaputt` mit `grund` (ein Satz) gezeigt.
- Neuere `version` → `state: 'neuer'`, nicht laden. Migrationskette `MIGRATIONS[n]` (für v1 leer).
- `campaign.json` bleibt; `logRun` bekommt `worldId`.
- `game.world` bleibt das Modul `world.js`. Der Laufzeit-Weltstand heißt **`game.weltstand`** (§5.4).

### 5.3 Wann gespeichert wird (nur `game.weltstand.persistent === true`, also nur Kampagne)
- Ereignis `docked` setzt `saveDue`; gespeichert wird **am Ende des Ticks**, wenn das Schiff noch angedockt ist.
- Angedockt: höchstens alle `CONFIG.weltstand.dockedSaveEvery` s (Standard 10), nur wenn sich `capture` geändert hat.
- Bei `missionDone` – auch ohne Dock; `ort.angedockt` ist dann der letzte Andockort bzw. `hafen`.
- Bei „Partie beenden“ (§6) und `endGame`, wenn angedockt.
- Direkt nach dem Start einer neuen Kampagne einmal (damit der Stand in der Liste steht).
- Speichern blockiert den Tick nicht spürbar (synchron ist ok bis ~5 ms; sonst `setImmediate`).

### 5.4 Laufzeit-Weltstand `game.weltstand`
```js
game.weltstand = { id, name, persistent, data /* npc, chronik, fakten, tutorial */,
  npcMemory(npc, entry), npcAttitude(npc, delta), npcStatus(npc, status), fact(key, value, quelle), chronicle(entry) }
```
Existiert in jeder Partie (Testgelände/Direktstart: `persistent: false`, wird nie geschrieben). ENGINE ruft nur diese
Methoden (über die Weltstand-Bausteine).

## 6. Protokoll (`shared/protocol.js`, `VERSION: 5`, nur ergänzen)

| Nachricht | Felder | Regel |
|---|---|---|
| `lobbyOpt` | `{ startMission }` mit neuem Wert **`'free'`** | `START_MISSIONS: ['m1','free','m3','arena_space','arena_away']`, `START_LABELS.m1 = 'Kampagne'`, `free = 'Kampagne ohne Tutorial'` |
| `lobbyOpt` | `{ world: id \| null }` | Fortsetzen wählen; `null` = neu. Jeder darf umschalten. Gesetzt → `startMission` wird beim Start ignoriert. |
| **neu** `C.WORLD = 'world'` | `{ op: 'delete', id }` | Nur Phase `lobby`. Client verlangt 1 s Halten. Gesperrt → `{ t:'error', code:'worldbusy' }`. |
| **neu** `C.MENU = 'menu'` | `{ op: 'end' }` | Partie für alle beenden (Bestätigung im Client). Server: speichern wenn angedockt + persistent, Ereignis `sessionEnded`, `reset()` → Lobby, Spieler bleiben verbunden (`ready: false`). |
| `menu` | `{ op: 'pause', on: bool }` | Nur wirksam, wenn genau 1 Spieler verbunden ist; Server hält dann die Simulation an. |

**Snapshot:** `paused: bool` (immer, klein). Nur in Phase `lobby`: `lobby.worlds` (Liste §5.2), `lobby.world` (id|null),
`lobby.worldsFull` (bool). Neue Kampagne bei 5 Ständen → Start abgelehnt, Notice „Erst einen Weltstand löschen“.
**Ereignisse:** `worldSaved { id, name, loc }`, `worldSaveFailed { reason }`, `worldLoaded { id, name }`,
`worldLoadFailed { id, reason }`, `sessionEnded { by, saved }`, `missionDone { …, ausgang }`.
**Kann:** `mission.chronik` (letzte 10 Einträge) im Log-Slot des Snapshots.

## 7. Client, Menü, Pantheon (CLIENT, ART-AUDIO)

- **Name:** Lobby-Titel `PANTHEON`, `<title>Pantheon</title>`, Log-Präfixe `[Pantheon]`. Repo-Ordner bleibt `sternenschicht/`.
- **Lobby (= Hauptmenü):** Block „WELTSTAND“ links unter der Spielerliste (über dem Bereit-Knopf, y ≤ 250 bei 640×360):
  „Neu: Kampagne“ / „Fortsetzen … (F)“. Liste als Overlay (Art-Entwurf im Pitch): je Stand Name, relatives Datum, Ort,
  Mission/Schritt, Spieler, Spielzeit; ⚠ für `kaputt`/`neuer`/`belegt` mit Grund. W/S wählen, Enter fortsetzen, Entf **1 s
  halten** löscht. Beim sechsten Stand (`worldsFull` + Start „Neu“) öffnet sich der Löschdialog, ältester vorausgewählt.
  Ist ein Weltstand gewählt, wird die Startauswahl (M) ausgegraut mit „Entfällt beim Fortsetzen“. Taste O öffnet die Optionen
  auch in der Lobby.
- **Spielmenü (Esc):** Reihenfolge der Esc-Kette: Ende-Screen → Minispiel → Konsole → Crew-Overlay → **Menü auf/zu**.
  Einträge: Weiterspielen · Optionen · Steuerung · Partie beenden. „Partie beenden“ fragt nach („Für alle beenden?“), in der
  Kampagne mit Hinweis: angedockt „Weltstand wird gesichert“, sonst „Fortschritt seit dem letzten Andocken geht verloren“.
  Solo sendet das Öffnen `menu { op:'pause', on:true }`. Andere Spieler sehen bei `sessionEnded` „<Name> hat die Partie beendet“.
- **Optionen** (je Spieler, `localStorage` `pantheon.options`, alle Zugriffe in try/catch): Lautstärke (0–100 %), Stumm,
  Darstellung Voxel/2D (vorhandenen F8-Umschalter aufrufen), Vollbild (nicht gespeichert). Ohne `localStorage` gelten Standards.
- **Steuerung:** statische Übersicht der Tasten (aus `CONSOLE_HELP`-Texten und README).
- **HUD:** bei `worldSaved` 2,5 s unten links Siegel + „Weltstand gesichert · <Ort>“ (Mint), bei `worldSaveFailed`
  „Weltstand nicht gesichert“ (Warngelb). Bei `paused` ein dezentes „Pause“.
- **Kann:** Reiter „Chronik“ im Missionsbuch (nur lesen).
- **ART:** `Art.drawSeal(ctx, x, y, size, variant)` (`'ok'|'warn'`), prozedural, gecacht (Cache begrenzt), Lerche-Rot
  `#9E1F27` mit Messingkante `#C9974A`; Vorschau in `art-preview.html`.
- **AUDIO:** `save_seal` (~0,5 s, leise), `world_load` (~1,2 s), `save_delete` (~0,3 s); vor `init()` No-op.
- Palette: Tiefraum `#0B0E1A`, Fläche `#2E3A4A`, Messing `#C9974A`, Bernstein `#FFC66B`, Text `#F4EEDC`, Nebentext
  `#8EA3B5`, Siegel `#9E1F27`, Bestätigung `#7FE0C2`, Fehler `#E0473C` (aus `R.PAL`, nichts Neues erfinden).
- `dev-mock.js` kennt Weltstände (`?mock=1&worlds=3`), Menü und Pause.

## 8. Spielleiter-Tests ohne LLM (TESTS)

Ziel: Der Spielleiter (ab S2) wird fast nur ohne LLM getestet. Live-Aufrufe sind die Ausnahme.

### 8.1 LLM-Schnittstelle – `server/mission/llm.js`
```js
const llm = LLM.create({ mode, fixturesDir, budget })   // mode: 'off'|'mock'|'replay'|'live', Standard aus SPIELLEITER_LLM, sonst 'off'
await llm.ask(kind, input)   // kind: 'grobplan'|'szene' -> { text, tokens, source: 'mock'|'replay'|'live', key }
```
- `replay`: Schlüssel = sha1 aus `kind` + kanonisch serialisiertem `input`; Antwort aus `tools/fixtures/llm/<kind>/<key>.json`.
  Fehlt die Aufzeichnung → Fehler mit Hinweis „mit `npm run test:llm -- --record` aufzeichnen“ (kein stiller Live-Fallback).
- `mock`: deterministische Minimal-Antwort (gültiger Grobplan aus dem Katalog).
- `live`: nur wenn ausdrücklich gesetzt **und** `LLM_LIVE=1`; Aufruf wie in `concept/regiebuch/trockenversuch/szene.js`
  (`node <APPDATA>/npm/node_modules/@anthropic-ai/claude-code/cli.js -p`, `--model sonnet`, `MAX_THINKING_TOKENS=0`),
  Token-Deckel `CLAUDE_TOKEN_BUDGET`. Im Spiel wird in S1 **nichts** davon aufgerufen.

### 8.2 Kontext – `server/mission/context.js`
```js
Context.build(weltstandData, anlass, katalog)   // -> deterministisches Objekt (sortierte Schlüssel), das der Spielleiter bekäme:
// { crew, schiff, ort, orte, fakten, npc: [{ id, haltung, status, gedaechtnis: letzte 5 }], chronik: letzte 8, verfuegbar: Szenentypen/Moleküle }
```

### 8.3 Tests – `tools/test-spielleiter.js` (`npm run test:spielleiter`, < 10 s, kein Netz)
1. Prüfer: m1–m3 gültig; die 5 kaputten Bücher aus der Abnahme + `FLAG-FORM` + `FLAG-UNGESETZT` + `NEUSTART` liefern genau
   ihren Code mit Begründung.
2. Kontext: feste Weltstände (`tools/fixtures/context/*.weltstand.json`: frisch, nach m1, mitten in m2, ohne Tutorial) →
   `Context.build` ist gleich dem gespeicherten Golden-Ergebnis.
3. Replay: die aufgezeichneten Grobpläne und Szenen aus `concept/regiebuch/trockenversuch/out/` (nach
   `tools/fixtures/llm/` übernommen) laufen durch `katalog.instantiate` + `Checker.check` → erwartetes Ergebnis.
4. Mock: ein kompletter Durchlauf Weltstand → Kontext → mock-Grobplan → Prüfer ohne Fehler.
5. Registry: kein `do`/`check` in `content/regiebuecher/*`, das nicht in `Registry.describe()` steht.
- `tools/test-llm-live.js` (`npm run test:llm`): **nur von Hand**, 1 Grobplan + 1 Szene live, Ergebnis durch den Prüfer,
  `--record` legt Aufzeichnungen an. Läuft nie in `npm test`.

## 9. Golden Trace und Messung (QA-VORLAUF, QA)

- `tools/golden-trace.js --mission m1|m2|m3 --crew 1|3 --seed N --out file`: spielt per `sim-headless`-Bots und schreibt
  einen Trace: `[{ t, stage, mission }]`, Funk-/ODA-Texte mit Zeit, Belohnungen, Flags am Ende, Spieldauer.
- Basis auf Commit `260a330` (heutiger JS-Stand): m1–m3, Crew 1 und 3, **mindestens 5 Seeds**. Erst prüfen, ob derselbe
  Seed zweimal denselben Trace gibt (Determinismus); das Ergebnis steht im Bericht.
- **Vergleich nach Welle 1:** gleiche Schrittfolge; Schrittzeiten je Schritt ±1 s (bei deterministischer Sim) bzw. Median der
  Spieldauer je Mission und Crewgröße **±15 %**. Gewollte Abweichungen: Tafel-Abgabe in m3 (Texte, Inventar), neuer Hinweis
  in `tablet`, Nachhut-Absicherung in m1, Weltstand-Aktionen.
- Die alten QA-Browser-Skripte passen nicht zum M4-Layout; Browser-QA nutzt neue Skripte `C:\tmp\pwtest\sts\s1-qa-*.js`.

## 10. Abnahme (QA-ABNAHME)

1. **m1–m3 laufen aus Regiebüchern.** Kein `do`/`check` außerhalb der Registry; `server/missions/m1–m3.js` gelöscht (erst
   nach grünem Golden-Trace-Vergleich).
2. **Gleiches Spielgefühl:** Golden-Trace-Vergleich grün (§9); alle Entscheidungen und Entdeckungen wie vorher.
3. **Prüfer:** `npm run check-missions` meldet m1–m3 gültig; die 5 kaputten Bücher werden mit verständlicher Begründung
   abgelehnt.
4. **Speichern/Laden:** nach m1 im Hafen beenden, Server neu starten, fortsetzen: Marken, Lager, Quartier, Orte, Flags,
   Grauzahns Gedächtnis sind da. Dasselbe mitten in m2 angedockt bei Vaelen. Nach Laden kommt die m1-Nachhut nicht doppelt.
5. **Mehrere Weltstände:** zwei Kampagnen nacheinander anlegen und abwechselnd fortsetzen, nichts vermischt sich; zwei
   Prozesse auf denselben Stand → zweiter sieht `belegt`. Sechster Stand verlangt Löschen.
6. **Ohne Tutorial:** startet angedockt im Hafen, Tutorial gilt als erledigt, Tesk-Funk kommt. Testgelände und Direktstart m3
   funktionieren und legen **keinen** Weltstand an.
7. **Kaputter Weltstand:** abgeschnittene Datei → Meldung, neues Spiel möglich, kein Absturz; `.bak` wird genutzt.
8. **Spielmenü:** Esc-Kette stimmt; Partie beenden bringt alle in die Lobby (zu dritt geprüft), Hinweis beim Beenden ohne Dock;
   solo pausiert, zu zweit nicht; Optionen bleiben nach Neuladen erhalten; Voxel/2D-Umschalter wirkt.
9. **Pantheon:** Titel in Tab, Lobby, README, `package.json`.
10. **Spielleiter-Tests:** `npm run test:spielleiter` grün in < 10 s ohne Netz; `npm test` enthält ihn; kein Live-Aufruf.
11. Bestehendes grün: `npm run check`, `npm test`, `npm run sim`, `ws-smoke`, `check:assets`; Snapshot im Spiel < 13 KB.
12. **README** für den Stakeholder aktualisiert (Pantheon, Fortsetzen, Menü, neue npm-Skripte), gemessene Werte ehrlich.

## 12. Nachträge aus Welle 1 (Studioleitung)

**Basismessung (QA-VORLAUF):** `tools/fixtures/golden/base/` = 120 Traces (m1–m3 × Crew 1/3 × Seeds 1–20) auf `260a330`,
byte-genau deterministisch. Bot-Mediane: m1 381,6 / 275,7 s, m2 579,9 / 527,5 s, m3 212,7 / 193,9 s (solo / zu dritt).
m1 solo bleibt bei Seeds 8, 16, 18, 20 im Schritt `away` hängen (Solo-Bot legt Getragenes nicht ab – Bot-Fehler, nicht Spiel).
Vergleich: `node tools/golden-trace.js --compare tools/fixtures/golden/base <neu> --allow <allow.json>`; liegt ein Median
knapp über ±15 %, vor einem Rot-Urteil mit 30 Seeds nachmessen (Seed-Gruppen schwanken schon im Original um 10–17 %).

**Gewollte Abweichungen (DATEN) – für die Allow-Liste:**
- m1 `return`: Nachhut hängt an der neuen persistenten Flag `rearguardRepelled` (ODA 0,5 s und Wendung 6 s nur ohne sie);
  Selas Notruf nur ohne `selaCalled`. m1 `route`: Grauzahn-Regel nur, solange die Wahl `grauzahn` offen ist.
  `wiederaufnahme`: `route` ab `undock`, `dock` ab `dock` (Übung beginnt beim Laden neu). Port-Abschluss: Ausgang
  `geliefert`/`entschluesselt` statt `complete: true`. Effekte als Wendungen mit `ankuendigung.art: "sichtbar"`.
- m2 `vaelen`: Tesk-Tipp (2 s) und Kurs-ODA (8 s) nur, wenn nicht schon bei Vaelen angedockt. `wiederaufnahme`: `ambush` ab
  `nebelFlight`, `relay` ab `toRelais`. Angebotszeiten als `{cfg: missionM1.wreckRumorAfter, plus}` (`tune m2OfferAfter` wirkt dort nicht mehr).
- m3: Tafel-Abgabe an Tesk, neuer Hinweis in `tablet`. **Timer-`if` mit `do` wird jetzt ausgewertet** (JS ignorierte es –
  dadurch kamen in der Kampagne ODA „Direkt zur Planetenmission!“ und das Angebot doppelt; Korrektur gewollt).
- Alle: Weltstand-Aktionen (`npc_gedaechtnis`, `welt_fakt`, `chronik`, `remove_item`), Garantie-Markierungen ohne neuen Text.

**Entscheidungen der Studioleitung:**
- Wrack-Container: Objekt `wreck.container`, Zustände `full`/`taken` (in `Maps.MAP_OBJECTS`).
- Nach `restore()` startet ein Schritt mit `loc` erst (enter/timers/rules), wenn das Schiff an seinem Ort ist; bis dahin nur
  Ziele anzeigen.
- `selaHelped` muss auch ohne aktive Mission ankommen.
- Fakten im Weltstand: `{ key: { value, quelle } }`.
- **Offen für Game Design (nicht S1):** m1 `scan`/`away`/`decision`/`return` und m2 `toRelais` haben keinen echten Hinweis
  bei Stillstand (nur vorhandener ODA-Text als Garantie markiert). Sela-Belohnungstext steht fest statt aus `CONFIG`.

## 13. Nachträge QA-ABNAHME (2026-10-08)

- **Weltstand-Namen eindeutig:** zweiter Stand am selben Tag „Lerche · TT.MM. (2)“ usw. (Zähler statt Uhrzeit,
  `Weltstand.create`). Test in `test-weltstand`.
- **Nach „Partie beenden“** ist der gespielte Stand in der Lobby vorausgewählt (`game.endSession`). Siegel in der Lobby eine
  Zeile höher, zeigt den Ort, wenn Platz ist.
- **Ruhender Schritt nach dem Laden:** `next` wird auch ruhend ausgewertet (`mission.dormantNext`); Ziel-Schritt mit fremdem
  Ort ruht weiter. Vorher hing m1 `return` (geladen bei Vaelen) bis zu einem Umweg über B-7, m2 `sonde` (geladen im Hafen)
  beim Flug in den Nebel. m1 `return`: Regel „Nachhut abgewehrt“ zusätzlich nur ohne `rearguardRepelled` (sonst nach dem Laden
  an B-7 zweiter Funk und zweites Gedächtnis „nachhut_verloren“). Golden-Traces unverändert (byte-gleich).
- **Fortsetzen ohne Geisterereignisse:** `reset()` vor dem Laden und beim Beenden sendet keine Ereignisse (`game.muteEvents`);
  der Client zeigt beim Laden weder den letzten alten Logbuch-Eintrag als „neu“ noch ein Ankunfts-Banner (vorher
  „UNBEKANNTES SIGNAL“ bei Vaelen).
- Lobby: bei offenem Overlay nur ein Hinweis (vorher zwei übereinander). Bestätigung „Partie beenden“ nutzt `state.campaign`.
- Timer-`if` am Kampagnenübergang m2 → m3 belegt: Angebot genau einmal, keine ODA „Direkt zur Planetenmission!“
  (`test-regiebuch`); Direktstart: beides genau einmal.

## 11. npm-Skripte (Studioleitung trägt ein, Teams liefern die Dateien)

`check-missions` → `node tools/check-missions.js` · `katalog` → `node tools/katalog.js` · `test:spielleiter` →
`node tools/test-spielleiter.js` · `test:weltstand` → `node tools/test-weltstand.js` · `test:regiebuch` →
`node tools/test-regiebuch.js` · `test:llm` → `node tools/test-llm-live.js` · `golden` → `node tools/golden-trace.js`.
`test` wird nach Welle 2 um `test-regiebuch`, `test-weltstand`, `test-spielleiter` ergänzt (QA-INTEGRATION).
