# CONTRACT-S2 – Spielleiter an der Missionsgrenze (+ Schützling)

Ergänzung zu `CONTRACT.md`, `CONTRACT-M0.md` bis `CONTRACT-M4.md` und `CONTRACT-S1.md` (inkl. §12/§13). Vorhandene Feldnamen
werden nicht gebrochen. Bei Widerspruch gilt der Code. Abweichungen meldet jedes Team im Bericht; die Studioleitung gibt
sie weiter. **Namenskonflikte zwischen Teams nicht selbst auflösen, sondern an die Studioleitung melden.**

- Pitch: https://claude.ai/artifact/Mb8HtRyxFyoZKCmy4y3GTY
- Brain-Vault: `Coop-Spiel/Spielleiter/Fahrplan Spielleiter.md` (Block „S2 – Go“), `Trockenversuch Spielleiter.md`

## 0. Ziel und Entscheidungen

**Ziel.** Nach dem Tutorial (bzw. beim Start ohne Tutorial) bietet ein Spielleiter (Claude Sonnet über die CLI) **neue,
spielbare Missionen** an, die es vorher nicht gab – zusammengesetzt aus dem Katalog, geprüft, mit Archiv als Rückfall.
Erste neue Mechanik: **Schützling** (zu schützende NSC-Schiffe). Das Spiel wartet nie auf das LLM.

**Entscheidungen von Kai (2026-10-08, alle wie empfohlen):**
1. Je Missionsgrenze **2 Angebote vom Spielleiter + 1 aus dem Archiv**; der Captain wählt (am Planungstisch/Missionsbuch).
2. Ablehnen ohne Malus, nur ein leichter Gedächtnis-Eintrag beim Auftraggeber. Kein Ablaufen von Angeboten (S3).
3. Benannte NSC sterben nicht (höchstens `schwer_beschaedigt`); unbenannte Schützlinge dürfen verloren gehen.
4. Captain befiehlt dem Schützling per Funk: `halten`, `folgen`, `volle_kraft`, `andocken`; Gehorsam hängt von der Haltung ab.
5. Breitseite als Schild: Die Lerche kann angekündigte Ladungen, die auf den Schützling zielen, mit dem Schild abfangen.
6. Kein Eigenbeschuss auf den Schützling (nur ein Funk-Rüffel, wenn die Lanze durch ihn ginge).
7. Ziel einer erzeugten Mission: **15 min zu dritt, 4–6 Szenen, 1–2 Entscheidungen** (Ziel, kein Messwert).
8. Erzeugt vs. Archiv wird Spielern **nicht** gezeigt; nur Debug (`?debug=1`) und Regie-Logbuch.
9. Nach m3 in der Kampagne: **Kapitelkarte und weiterspielen** statt Ende-Screen (Direktstart m3 behält das Ende).
10. Drittes NSC-Schiff ist ein **Bergungsboot** (kein Pilgerschiff). Klassen: `frachter` (Konkordat), `karawane` (Vaelen),
    `bergungsboot`.
11. LLM-Zugang über die **Claude-CLI** (Abo), Transport-Schnittstelle für eine spätere API.
12. **Live im Spiel nur mit Schalter** in der `.env` (`SPIELLEITER_LLM=live` **und** `LLM_LIVE=1`); sonst spielt nur das Archiv.
13. Token-Deckel 500k je Serverlauf, Cache-Treffer zählen voll; **ein** Zähler für den ganzen Prozess.
14. **Keine Spielernamen** ans LLM, nur die Crewgröße.
15. Archiv: 4 Missionen (je eine von Tesk, Sela, Melk, Grauzahn; eine davon Geleit). Welle 1 schreibt sie **von Hand** als
    Grobplan-Aufzeichnungen; QA-ABNAHME nimmt sie zusätzlich **live** auf (~150–200k Tokens einmalig), Kai nimmt sie ab.
16. Nächste Szene(n) beim Start der vorigen anfragen; ist eine Szene bei Ankunft nicht fertig: höchstens **20 s** „Kurs wird
    berechnet“, dann spielt die Rohfassung.
17. Neue Gegner-KI (`flightV2`) nur für erzeugte Missionen (`kopf.art: "generiert"` bzw. `"archiv"`); das Tutorial bleibt.
18. Außenkarten wieder bespielbar (`map_reset`), mit erzählter Begründung im Text.
19. Der Teaser „Fortsetzung folgt“ (`generator.js`, `startTeaser`) wird durch den Spielleiter abgelöst.
20. Grobpläne Runde 3: `melk-klausel` neu aufnehmen (QA-ABNAHME, zusammen mit dem Archiv).

**Nicht in S2:** Captains Absicht im Logbuch, geplante Spielzeit des Abends, ablaufende Angebote, neue Orte, Live-Wendungen.

**Nicht brechen:** `npm run check`, `npm test` (inkl. regiebuch/weltstand/spielleiter), `npm run sim`, `ws-smoke`,
`check:assets`; **Golden-Vergleich m1–m3** (`node tools/golden-trace.js --compare tools/fixtures/golden/base
tools/fixtures/golden/s1 --allow tools/fixtures/golden/allow-s1.json`) bleibt grün – neue Gegnerziele dürfen bei
`targetId == null` nichts am Ablauf ändern. Snapshot im Spiel < 13 KB. Weltstände aus S1 (Version 1) laden weiter.

## 1. Dateibesitz und Wellen

| Welle | Team | Dateien (nur diese ändern) |
|---|---|---|
| 0 | Studioleitung | `CONTRACT-S2.md`, `shared/config.js` (Blöcke `spielleiter`, `escorts`, `shipClasses.frachter/karawane/bergungsboot`), `package.json`, `content/katalog/mechaniken.json` |
| 1 | SPIELLEITER | **neu** `server/mission/{spielleiter,szenenbau,regielog,archiv}.js`, `server/mission/{llm,context}.js`, `server/mission/generator.js` (stilllegen, Token-Zähler zentral), **neu** `content/spielleiter/**` (Prompts, Archiv-Aufzeichnungen nur Struktur/Lader), `tools/test-spielleiter.js`, `tools/test-llm-live.js`, `tools/fixtures/{llm,context}/**`, **neu** `tools/regie-bericht.js` |
| 1 | ENGINE | `server/sim/mission.js`, `server/mission/{checker,loader,registry}.js` (Registry: nur Plugin-Lader §3.3), `content/regiebuch/regiebuch.schema.json`, `server/game.js`, `server/weltstand.js`, `content/schema/weltstand.schema.json`, `content/regiebuecher/{m2,m3}.regiebuch.json` (nur Teaser/`danach`), `shared/protocol.js` (nur ergänzen), `tools/test-{regiebuch,weltstand}.js` |
| 1 | SCHUETZLING | **neu** `server/sim/escort.js`, `server/sim/{space,pilot,damage}.js`, **neu** `server/mission/bausteine/escort.js`, `shared/flight.js` (nur ergänzen), **neu** `tools/test-escort.js`, `tools/test-flight.js`, `tools/test-combat.js` |
| 1 | BAUSTEINE | `server/sim/{away,combat,onboard,explore,shop,interior}.js`, **neu** `server/mission/bausteine/welt.js` (`map_reset`, `bought`-Ereignis, `personen_bergen`-Verallgemeinerung von Ivo, `enemies_retreat` nur falls nicht in space.js – sonst SCHUETZLING), `shared/maps.js` (nur `MAP_OBJECTS`/`MAP_AREAS` ergänzen) |
| 1 | KATALOG | `content/katalog/{molekuele,szenentypen,schema}/**`, `content/regiebuch/bausteine.json`, **neu** `content/spielleiter/archiv/*.json` (4 Archiv-Missionen als Grobplan-Aufzeichnungen + Szenenparameter) |
| 1 | CLIENT | `public/index.html`, `public/js/{client,hud,consoles,render,net,dev-mock}.js` |
| 1 | ART-AUDIO | `public/js/{art,audio}.js`, `public/{art,audio}-preview.html` |
| 2 | BOTS | `tools/sim-headless.js`, `tools/golden-trace.js` (generische Bots je Umsetzung, Klassen `Agent`/`KeshAgent` und Hauptteil-Anfang bleiben) |
| 2 | QA-INTEGRATION | alle |
| 3 | QA-ABNAHME | alle, `README.md`, Live-Aufnahme Archiv (Budget ≤ 250k Tokens) |

**Testserver** nur mit `ROOM_CODE=off`, eigenem `WORLD_DIR=data/worlds-<team>` und eigenem `REGIE_DIR=data/regie-<team>`:
SPIELLEITER 3320–3322, ENGINE 3323–3325, SCHUETZLING 3326–3328, BAUSTEINE 3329–3331, KATALOG 3332, CLIENT 3333–3335,
ART-AUDIO 3336, BOTS 3337–3339, QA 3340–3349. **Nie 3300/3301/3310, nie 3389 (RDP).** Screenshots `shots/<team>/`,
Playwright-Skripte `C:\tmp\pwtest\sts\s2-<team>-*.js`. Dateien nur mit Edit/Write (Umlaute!). Shell PowerShell. Nicht committen.
**Keine Live-LLM-Aufrufe in Welle 1/2** – nur `mock`, `replay`, `script` (Ausnahme: QA-ABNAHME, §8).
Aufrufe in fremde Module defensiv, Fehler mit `game.countError` zählen.

## 2. Spielleiter (SPIELLEITER)

### 2.1 Ablauf und Zustände – `server/mission/spielleiter.js`
```js
const sl = Spielleiter.create(game)        // game.spielleiter; nur wenn game.weltstand.persistent (Kampagne)
sl.update(dt)                              // aus game.step() über game.safe('spielleiter', …), VOR mission.update
sl.onMissionDone({ id, ausgang })          // Anlass: Grobplanung starten (2 Pläne parallel, max. 1 CLI-Prozess gleichzeitig: Warteschlange)
sl.onCampaignStart({ tutorial })           // ohne Tutorial: Planung nach dem Tesk-Funk
sl.onSceneEnter(missionId, sceneId)        // Nachfolgeszenen anfragen (Vorlauf)
sl.offers()                                // -> [{ id, titel, von, ziel, dauer_min, belohnung, erinnerung, origin: 'sl'|'archiv', state }]
sl.accept(id) / sl.decline(id)             // Captain/jeder am Planungstisch; decline -> npc_gedaechtnis leicht
sl.toSave() / sl.restore(obj)              // Weltstand-Block `spielleiter` (§4)
sl.planning()                              // -> null | { stage: 0|1|2, von }   (0 Peilung, 1 Rat berät, 2 gesiegelt)
```
- Plan-Zustände: `idle → planning → checking → (retry ≤ 1) → offered → running → done | fallback`.
  Szenen-Zustände: `rohfassung → requested → ready | failed → active`.
- **Rohfassung:** Aus dem Grobplan entsteht **sofort ein vollständiges Regiebuch** (`kopf.art: "generiert"`), jede Szene mit
  `test`-/Standardparametern ihrer Umsetzung und Standard-Verzweigung. Es wird geprüft (`Checker.check`) und per
  `mission.registerBook` angeboten. Ausgearbeitete Szenen ersetzen ihre Rohfassung nur, solange die Szene nicht betreten
  wurde, und nur, wenn das ganze Buch danach den Prüfer besteht (`mission.updateBook`).
- **Zusammensetzen** (`szenenbau.js`, aus `tools/test-spielleiter.js` übernommen: `checkGrobplan`, `assembleScene`,
  `sceneTestBook`, `evaluateScene`): generisch Verzweigung über Flags, Wendung als Timer am ersten Schritt, Texte nach
  `texte`, Funk-NSC nach `besetzung`; **neu** Hafen-Rahmen (Briefing-Funk, `onAccept`), **Anflug-Schritt** vor jeder Szene
  mit fremdem Ort (Ziel „Nach X springen“, `next: atLocation`), `liefert_flags` der Umsetzungen (`<id>_heil|_beschaedigt|_verloren`)
  sind für die Verzweigung erlaubt. Jeder Schritt bekommt `umsetzung: "<molekuel>/<umsetzung>"` (für Bots und Logbuch).
- **Prüfregeln Grobplan (zusätzlich):** mindestens 1 Bezug auf einen vorhandenen Gedächtnis-Eintrag oder Fakt
  (`erinnerung: { npc, ereignis } | { fakt }`), keine gefundenen Funde als Ziel, Summe der gemessenen/geschätzten
  Umsetzungsdauern ≥ 10 min (Warnung), kein Tutorial-Bezug ohne entsprechenden Fakt, höchstens 1 offener Faden
  (`welt_fakt` mit `faden: true`). Jeder Ausgang schreibt ≥ 1 `npc_gedaechtnis` und ≥ 1 `chronik`.
- **Rückfall:** Prüfer lehnt ab → 1 Nachbesserung mit Fehlerliste; wieder ungültig, Timeout (`CONFIG.spielleiter.grobplanTimeout`
  120 s, Szene 45 s), CLI fehlt (ENOENT → Transport für den Lauf aus), Exit≠0, 429 (60 s Pause), Budget < `minBudget`
  → Archiv bzw. Rohfassung. Nichts wirft in den Tick.
- **Szene nicht fertig bei Ankunft:** `mission` setzt einen `destBlock` (bzw. hält den Anflug-Schritt) höchstens
  `CONFIG.spielleiter.sceneWaitMax` (20) s mit ODA „Kurs wird berechnet …“ (Ereignis `sceneWait`), danach Rohfassung.
- **Archiv** (`archiv.js`): lädt `content/spielleiter/archiv/*.json` (Format `llm-aufzeichnung/1` wie `tools/fixtures/llm`),
  läuft durch dieselbe Pipeline; gespielte werden im Weltstand gemerkt; Wiederholung erst, wenn alle gespielt sind; letzte
  Stufe `mockGrobplan`. Das Archiv-Angebot steht ab Sekunde 0 bereit.
- **Teaser abgelöst:** Während der ersten Planung nach m3 funkt Tesk „Bei mir läuft gerade was rein, bleibt in der Nähe.“

### 2.2 LLM – `server/mission/llm.js` (Erweiterung)
- Neuer Modus **`script`**: Antworten/Fehler/Verzögerungen nach Plan (deterministisch) für Pipeline-Tests.
- Transport-Schnittstelle `cli` | `api` (nur `cli` umgesetzt). Prompts aus `content/spielleiter/prompts/*`; Reihenfolge für
  Caching: System + Katalog (statisch) → Grobplan der Mission → variabler Teil.
- **Ein** Token-Zähler je Prozess (`LLM.budget()`), geteilt mit allem, was noch an `generator.js` hängt.
- Jeder Live-Aufruf wird nach `REGIE_DIR/aufnahmen/<kind>/<key>.json` geschrieben (Format wie `tools/fixtures/llm`).
- `context.js`: **keine Spielernamen** (nur Crewgröße); Kontext-Goldens einmal bewusst mit `--update` erneuern.

### 2.3 Regie-Logbuch – `server/mission/regielog.js`
`REGIE_DIR` (Standard `data/regie`), Datei `<weltId>.jsonl` (anhängen, Rotation 5 MB), Eintrag
`{ t, spielzeit, art, mission, szene, quelle: 'llm'|'archiv'|'rohfassung'|'mock', dauer_s, tokens, fehler[], begruendung, wunsch? }`;
`wunschliste.json` sammelt fehlende Bausteine. `node tools/regie-bericht.js <weltId>` → lesbare Markdown-Zusammenfassung.

## 3. Engine (ENGINE)

### 3.1 Bücher zur Laufzeit – `server/sim/mission.js`
```js
mission.registerBook(book, { origin })   // origin 'sl'|'archiv'; prüft, lädt (Loader.prepare), Angebot im Buch
mission.updateBook(id, book)             // ersetzt def zwischen zwei Ticks, this.step per ID neu gebunden; nur unbetretene Schritte ändern
mission.unregisterBook(id)
mission.offerList()                      // Missionsbuch-Einträge 'angeboten' aus game.spielleiter.offers()
```
- `kopf.art` neu: `"generiert"`, `"archiv"`. Reihenfolge außerhalb von `order`. Bucheintrag bekommt `origin` (Snapshot nur bei
  `game.debug`).
- **Kapitelkarte:** In der Kampagne endet m3 nicht mit `end`, sondern mit Ereignis `chapter { title, text }` und weiterem
  Spiel (Direktstart m3: Ende wie bisher). Teaser-Aufrufe in m2/m3 entfernen (`startTeaser` wird No-op mit Altname).
- Hook-Aufrufe an `game.spielleiter` (`onMissionDone`, `onSceneEnter` bei Schrittwechsel auf einen Schritt mit neuer
  `umsetzung`) defensiv.
- `game.step()`: `this.safe('spielleiter', () => this.spielleiter && this.spielleiter.update(dt))` vor `mission.update`.

### 3.2 Weltstand Version 2 – `server/weltstand.js`
`version: 2`, `MIGRATIONS[1]` ergänzt `spielleiter: {}`. Block `spielleiter`:
`{ plaene: { <missionId>: { grobplan, anlass, origin, szenen: { sid: { quelle, antwort, key } }, buch } }, archiv_gespielt: [],
zusammenfassung: [{ id, titel, auftraggeber, ausgang }], naechste_id }`. Buch nur für angebotene/aktive Missionen speichern,
erledigte nur Zusammenfassung. Laden: `Spielleiter.restore()` **vor** `mission.restore()`; Rohfassungs-Szenen neu anfragen.

### 3.3 Registry-Plugins
`server/mission/registry.js` lädt beim Start alle `server/mission/bausteine/*.js` (je Datei `module.exports = (Registry) => {
Registry.define(...) }`). SCHUETZLING und BAUSTEINE liefern ihre Bausteine **nur** dort.

## 4. Protokoll (`shared/protocol.js`, `VERSION: 6`, nur ergänzen – ENGINE)

| Was | Felder |
|---|---|
| cmd `plan.decline` | `{ id }` (wie `plan.accept`) |
| cmd `captain.escort` | `{ tag, befehl: 'halten'|'folgen'|'volle_kraft'|'andocken' }` (Captain-Konsole) |
| Snapshot `space.escorts[]` | `{ id, tag, kind, name, x, y, angle, hp, hpMax, state: 'ok'|'beschaedigt'|'kampfunfaehig'|'entkommen', befehl, distress: bool }` (≤ 2) |
| Snapshot `space.enemies[].tgt` | Escort-ID, wenn der Gegner einen Schützling anvisiert (sonst fehlt das Feld) |
| Snapshot `mission.planning` | `null` \| `{ stage: 0|1|2, von }` (klein, immer) |
| Bucheintrag | `state: 'angeboten'` mit `von`, `ziel`, `dauer_min`, `belohnung`, `erinnerung`; `origin` nur bei Debug |
| Ereignisse | `offerIn { id, title, from }`, `sceneWait { sec }`, `chapter { title, text }`, `escortHit { id, hpFrac }`, `escortDistress { id, hpFrac }`, `escortDisabled { id }`, `escortArrived { id }`, `escortSaved { id }`, `escortOrder { id, befehl, ok }` |
| Debug | `sl status`, `sl plan`, `sl fail <grobplan|szene>`, `sl archiv`, `escort <kind>` |

## 5. Schützling (SCHUETZLING)

- `server/sim/escort.js`: Liste `game.space.escorts` (Felder §4 + `vx, vy, ziel, reparatur_s, npc?`). Bewegung immer über
  `Flight.stepBody` mit `CONFIG.shipClasses.<kind>`; Wegpunkt-Steuerung `Pilot.escort` (nutzt `rudderFor`/`stageFor`/`avoid`).
  Tempo passt sich der Lerche an; unter Beschuss hält er an (außer `volle_kraft`). Verhalten `treibt` | `folgt_kurs` | `flieht`.
- **Befehle:** Gehorsam nach Haltung des NSC (`npc` im Weltstand): Haltung ≥ 1 sofort, 0 nach 2 s, < 0 nach 4 s mit Murren
  (Funktext); unbenannte wie 0. Ereignis `escortOrder`.
- **Gegnerziele:** Feld `e.targetId` (null = Lerche), Hilfsfunktion `targetOf(game, e)`; ersetzt die festen Bezüge auf
  `game.ship` in `pilot.js` (Kanonenboot, Jäger), `moveLegacy`, `enemyCanHit`/`updateEnemies`, `updateTele`. Spawn-Parameter
  `ziel: lerche|schuetzling|auto`. Treffer der Lerche ziehen den Gegner 10 s auf die Lerche. **Mit `targetId == null`
  byte-gleich zu heute** (Golden Trace).
- **Schaden:** Projektile und geladene Angriffe treffen Schützlinge (keine Schildsektoren). **Jeder Angriff auf einen
  Schützling ist angekündigt** (`tele` + ODA „<Gegner> lädt auf <Name>“). Ereignisse bei 75/50/25 %. Hülle 0 →
  `kampfunfaehig` (treibt, Wrackoptik), nie gelöscht. Benannte NSC: Ausgang `schwer_beschaedigt`.
- **Breitseite als Schild:** Liegt die Lerche zwischen Ladendem und Schützling (Linie trifft die Lerche) und ist der Schildsektor
  zur Schussseite ≥ 1, trifft die Ladung die Lerche statt des Schützlings (normale Schild-/Schadenslogik). Ereignis `hit` mit
  `shielded: '<escortId>'`.
- **Kein Eigenbeschuss:** Lanze/Batterien treffen Schützlinge nicht; ging die Lanze durch einen Schützling: Funk-Rüffel (einmal je 30 s).
- **Bausteine** (`server/mission/bausteine/escort.js`): Aktionen `spawn_escort { tag, kind, name, npc?, verhalten, von?, nach?,
  reparatur_s?, huelle? }`, `escort_order { tag, befehl }`, `enemies_retreat { tag?, unter_pct }` (Gegner drehen ab);
  Prüfungen `escort_state { tag, state }`, `escort_hp_below { tag, pct }`, `escort_arrived { tag }`; Platzhalter
  `{escortHp:<tag>}` (ENGINE baut den Platzhalter in `tpl()` ein, ruft `Escort.hpPct`).
- **Balancing:** `node tools/test-escort.js` + `sim-headless escort --seeds 10` (BOTS): Ziel zu dritt 70–90 % Schützlinge heil.
- Snapshot ≈ 110 B je Schützling.

## 6. Katalog und Bausteine (KATALOG, BAUSTEINE)

- `mechaniken.schuetzling` → `verfuegbar` (Studioleitung trägt ein, sobald SCHUETZLING liefert; bis dahin `geplant`).
- **Neue Umsetzungen** (KATALOG, jeweils mit `test`-Werten, Rückfallparametern, `dauer_min` je Crewgröße als **Schätzung**
  markiert, `liefert_flags` wo sinnvoll): `schuetzen/geleit_durch_angriff` (A8), `schuetzen/notruf_verteidigen` (A3/A8),
  `pannenhilfe/andocken_und_flicken` (A3), `kurs_durch_gefahr/nebelflug` (A7), `vernichten/pylonen_pruefung` (Kern, A5),
  `system_ausschalten/stoerrelais` (A4/A5), `taeuschen/bluff_funk` (A3), `ausschlachten/wrack_container` (A11/C1),
  `datenkern_bergen/plattform_kern` (C1/C9), `ladung_liefern/im_hafen_abgeben` (A12, D1), `vertreiben/bis_zur_flucht`,
  `personen_bergen/techniker_retten` (C9), `halten/position_halten` (A5). `vernichten/angriffswelle` bekommt Parameter `ziel`.
  Ziel: **≥ 18 verfügbare Moleküle** laut `npm run katalog`.
- **BAUSTEINE** liefert den Code dafür außerhalb des Raumkampfs: `map_reset { map, grund }` (Kesh/Plattform/Wrack zurück auf
  Anfang, ohne Tutorial-Fakten zu brechen), Ereignis `bought`, `personen_bergen` (NSC-Person auf Außenkarte, nicht nur Ivo),
  `ship_in_zone`-Varianten falls nötig. Bausteine in `server/mission/bausteine/welt.js`.
- **Archiv** (KATALOG): 4 Missionen als `content/spielleiter/archiv/<id>.json`: „Zollfeuer“ (Tesk), „Karawane im Nebel“
  (Sela, Geleit), „Abschrift von B-7“ (Melk), „Treibgut Zaunkönig“ (Grauzahn). Je 4–6 Szenen, prüferfest, ohne
  Tutorial-Voraussetzung, mit `erinnerung` als Bedingung (passt keine Erinnerung, neutrale Variante).

## 7. Client, Art, Audio

- **Planung:** Eintrag unter ANGEBOTEN „Hafenmeisterei · Lage wird geprüft“ mit Siegel in drei Prägestufen
  (`mission.planning.stage`), HUD dezent „Funk: Hafenmeisterei berät …“, kein Countdown.
- **Angebote:** 2–3 Einträge mit Absender, Ziel, Dauer, Belohnung, Erinnerung; Bernstein-Punkt für neu; Annehmen (Enter) /
  Ablehnen (Entf) am Planungstisch. `origin` nur mit `?debug=1` als `[SL]`/`[AR]`.
- **Kapitelkarte** bei `chapter` (Overlay, Enter schließt). `sceneWait`: ODA-Zeile, keine Sperre der Steuerung.
- **Schützling:** eisblau `#A9D6E5` + Messing `#C9974A`, runde Silhouette, gestrichelter Schutzring; Balken 32×4 in Segmenten
  über dem Sprite; oben mittig „SCHÜTZLING · Name ▮▮▮▯“; Notruf: Ring pulsiert Eisblau→Bernstein, Off-Screen-Pfeil in
  Ringform; Captain-Karte: Ring-Symbol, gepunktete Messing-Route, rot gestrichelte Bedrohungslinie von gescannten Gegnern mit
  `tgt`; Captain-Konsole: Befehle (Taste/Knöpfe), Rückmeldung aus `escortOrder`. Fallback-Renderer in `render.js`.
- **ART:** `Art.drawEscort(ctx, kind, x, y, angle, { hpFrac, hitT, time, distress, state })` für `frachter` (~72×28),
  `karawane` (~48×36 + 2 Kapseln), `bergungsboot` (~40×32, eigener Entwurf, gleiche Palette, kein Violett); Rauch < 60 %,
  Feuer < 30 %, Trefferblitz eisblau, Wrack grau. Siegel-Prägestufen `Art.drawSeal(..., { stage })`. Vorschau.
- **AUDIO:** `gm_static`, `offer_in`, `distress`, `escort_hit`, `escort_lost`, `escort_saved` (Längen/Charakter wie im Pitch).
- `dev-mock.js`: `?mock=1&planning=1&offers=3&escort=frachter`.

## 8. Tests und Messung

- **Ohne LLM (in `npm test`):** Szenenbau-Einheitentests; Pipeline im Modus `script` (missionDone → planning → offered →
  accept → Szenen ersetzt → Skip-Lauf → missionDone; Speichern/Laden mitten in einer erzeugten Mission); Fehlerfälle
  (Timeout, Müll-JSON, zweimal ungültig, Budget leer, CLI fehlt) → Rückfall in fester Spielzeit, keine Exception; Skip-Durchlauf
  aller Ausgänge/Optionen jedes Archiv-Buchs; Replay-Regression (Buch-Hash stabil); `test-escort`; Golden m1–m3 grün.
- **BOTS (Welle 2):** generische Handler je Umsetzung (`umsetzung_<molekuel>_<id>`), `sim-headless archiv --seeds 5` spielt
  die 4 Archiv-Missionen solo und zu dritt; `sim-headless escort --seeds 10`. Dauer je Umsetzung messen und in den Katalog
  zurückschreiben (`dauer_min` als gemessen markieren).
- **QA-ABNAHME:** Live-Aufnahme der 4 Archiv-Missionen + `melk-klausel` (Budget ≤ 250k Tokens, Verbrauch berichten);
  1 erzeugte Mission live im Browser zu dritt durchspielen; Token je Mission messen.

## 8b. Nachträge aus Welle 1 (Studioleitung)

- Schnittstellen festgelegt: `plan.accept/decline` → nur `spielleiter.accept/decline` (der Spielleiter startet selbst);
  `offerIn` sendet die **Engine**; `sceneWait` und die ODA „Kurs wird berechnet“ sendet der **Spielleiter**, die Engine
  prüft nur `szene_bereit` → `spielleiter.sceneReady`. Weltstand v2: `spielleiter.restore` vor `mission.restore`, danach
  `away.applyWorldFacts`.
- Escort-Exporte wie umgesetzt: `order(game, tag, befehl, p)`, `debug(game, args, p)`, `snapshot`, `hpPct`, `outcome(game, tag)`
  (`heil|beschaedigt|verloren|schwer_beschaedigt`). Snapshot-Eintrag 150–177 B (alle Felder + `pending`, `repair`).
- Die Flags `<tag>_heil|_beschaedigt|_verloren` setzt `escort.js` bei jeder Zustandsänderung in `game.mission.flags`
  (genau eins true). QA-INTEGRATION: Golden m1–m3 danach einmal neu rechnen (lief nur ohne Schützlinge).
  Schützlinge stehen nicht im Weltstand (Speichern mitten im Geleit verliert sie; angedockt normal keine).
- `server/mission/katalog.js` und `objects.js` gehören in S2 ENGINE; `content/katalog/mod-beispiel` gehört KATALOG.
- Baustein-Vertrag: `status: "vertrag"` in `bausteine.json` = noch nicht geliefert (nur Hinweis); am Ende `STRICT_BAUSTEINE=1`.
- `npm test` enthält jetzt auch `test-escort` und `test-bausteine`.

## 8c. Ablage erzeugter Missionen (Kai, 2026-10-08)

**Wunsch Kai:** Alle erzeugten Missionen werden dauerhaft gespeichert, damit Kai sie **als Text reviewen** kann; freigegebene
Missionen vergrößern den Vorrat an Standard-Missionen (Archiv).
- **Ablage:** `content/spielleiter/erzeugt/<JJJJ-MM-TT>_<kennung>/` (eingecheckt), Ordner per `ERZEUGT_DIR` umlenkbar
  (**Tests immer in ein temporäres Verzeichnis**, nie ins Repo). Je Mission:
  - `mission.json` – spielbar, **im Archiv-Format** (`llm-aufzeichnung/1`: `grobplan` + `szenen` + Metadaten: `quelle`
    `llm|mock|archiv`, Modell, Tokens, Zeitpunkt, Weltstand-Anlass, Prüferergebnis), dazu das fertige Regiebuch.
  - `mission.md` – **lesbare Fassung** für das Review (Deutsch): Frontmatter `status: offen|angenommen|abgelehnt`,
    `quelle`, `erstellt`, `auftraggeber`; Titel, Pitch, Erinnerung, Zieldauer, Belohnung; je Szene Ort, Baustein,
    Ziele, alle Funk-/ODA-/Log-Texte in Reihenfolge, Wendungen mit Ankündigung, Entscheidungen mit Optionen und Folgen;
    Ausgänge mit Gedächtnis/Fakten/Chronik; Prüfer-Warnungen; Abschnitt „Gespielt“ (Datum, Ausgang, Dauer, Crew), der nach
    jedem Spielen ergänzt wird.
- **Wann:** beim Registrieren eines Spielleiter-Buchs (`origin 'sl'`), erneut nach jeder ersetzten Szene (Stand = zuletzt
  gültiges Buch) und nach Missionsende (Abschnitt „Gespielt“). Mock-Bücher nur, wenn `ERZEUGT_MOCK=1`. Die Live-Aufnahmen
  der QA-ABNAHME landen ebenfalls hier.
- **Vorrat:** `archiv.js` lädt zusätzlich alle `erzeugt/*/mission.json`, deren `mission.md` `status: angenommen` trägt.
  Kai gibt frei, indem er im Frontmatter `offen` → `angenommen` ändert (oder `npm run missionen -- annehmen <ordner>`).
- **Werkzeug:** `npm run missionen` (`tools/missionen.js`): `liste` (Status, Titel, Quelle, gespielt), `zeigen <ordner>`,
  `annehmen|ablehnen <ordner>`, `md <ordner>` (Textfassung neu erzeugen).
- Nicht blockierend: Schreiben außerhalb des Ticks (`setImmediate`), Fehler zählen, nie werfen.

## 8d. Spieldauer (Stand Welle 2)

BOTS (`sim-headless archiv --seeds 5`): Archiv-Missionen 2–3 min Bot-Spielzeit (Ziel 15 min zu dritt); Dauer je Umsetzung in
`tools/fixtures/dauer-s2.json`. **Kai-Entscheidung (2026-10-08):** keine Runde „Inhalt pro Minute“ vor der Abnahme – Kai
bewertet die Zeiten beim nächsten Spieleabend und meldet sich. Bis dahin die geschätzten `dauer_je_crew` im Katalog lassen.

**Balancing Schützling abgeschlossen (4. BOTS-Messung, 10 Seeds):** Geleit zu dritt 80 % heil, solo 60 % heil (beide im
Ziel); Archiv „Karawane im Nebel“ solo 3/5, zu dritt 4/5 heil. `escorts.crewDamage {1: 0.4, 2: 0.9, 3: 1.25}`. Offen für den
Spieleabend: Pannenhilfe zu dritt 3/10 verloren (härter als solo 1/10), Havarist zu dritt 1/10 verloren. Das BOTS-Testbuch
„karawane (hart)“ setzt feste Parameter und wird nie getroffen – Testartefakt, nicht das Archiv.

## 9. Abnahme

1. Nach dem Tutorial **und** nach „ohne Tutorial“ stehen Angebote im Missionsbuch, die es vorher nicht gab; 3 Missionen
   nacheinander sind zu dritt ohne Softlock spielbar (Archiv/Replay; mindestens 1 live erzeugte).
2. Jederzeit ≥ 1 Angebot; niemand wartet sichtbar; `sceneWait` höchstens 20 s (gemessen, berichtet).
3. Mindestens 1 sichtbare NSC-Erinnerung je Spielleiter-Mission; eine Entscheidung in Mission n ändert nachweislich das
   Angebot in Mission n+1.
4. Schützling: Geleit und Havarist spielbar; jeder Angriff angekündigt; Captain-Befehle wirken (Gehorsam nach Haltung);
   Breitseite fängt ab; Verlust → Ausgang, kein Game Over; Bot-Sim zu dritt 70–90 % heil (gemessen).
5. Rückfälle: LLM aus, Timeout, zweimal ungültig, Budget leer, CLI fehlt → Archiv bzw. Rohfassung, Spiel blockiert nie.
6. Tokens je Mission und je Lauf gemessen, unter 500k.
7. Speichern/Laden mitten in einer erzeugten Mission (angedockt) funktioniert; S1-Weltstände (v1) laden.
8. Kapitelkarte nach m3 in der Kampagne; Direktstart m3 endet wie bisher.
9. `npm run katalog` ≥ 18 verfügbare Moleküle.
10. Bestehendes grün inkl. Golden m1–m3; Snapshot < 13 KB; README aktualisiert, Messwerte ehrlich (Bot vs. Mensch).
