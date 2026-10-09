# CONTRACT-W1 – Welle 1 (AP1 Netzbudget, AP7 Art-Nachzug und Ladezeit, AP2 Sprung im Tutorial)

Studioleitung = Hauptsitzung („main“). Grundlage: Briefing und Planung im Vault
(`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\Briefing Welle 1+2 (AP1-AP7).md`, `…\Planung Welle 1+2 (AP1-AP7).md`).
Go von Kai am 2026-10-09. Die Abschnitte für AP2, AP4 und AP5 kommen dazu, wenn AP1 abgenommen ist (Welle 1 läuft seriell
AP1 → AP2 → AP4 → AP5, AP7 parallel).

## 0. Basis und Regeln
- Arbeitsbaum: `C:\Users\Luciu\projects\Pantheon-play`, Branch `welle1` (ab `main` `b52cc4b`). **Keine Commits, kein
  `git checkout`/`reset`/`stash`/`switch`.** Commits macht die Studioleitung.
- Die Regeln aus `concept/buehnen/TEAM-START.md` gelten (Dateien nur mit Edit/Write, nie per Shell-Umleitung, fremde
  Dateien nie ändern, Wünsche in den Bericht, keine Live-LLM-Aufrufe, Ports, `ROOM_CODE=off`, eigene `WORLD_DIR` und
  `REGIE_DIR`).
- Berichtspflicht nach `CONTRACT-B1.md` §13, höchstens 30 Zeilen, ehrlich.
- **Nicht brechen:** `npm run check`, `npm test`, Golden m1–m3 (`node tools/golden-trace.js`, wie in CONTRACT-B1 §0).
  Fällt etwas durch, das nicht von dir stammt: im Bericht nennen, nicht reparieren.

## 1. Teams, Dateibesitz, Ports
| Team | Paket | Dateien | Ports |
|---|---|---|---|
| **NETZ** | AP1 | `shared/config.js` (nur `net`, `debug`), `shared/protocol.js` (nur Doku-Kommentare zum Snapshot), `server/game.js` (nur `snapshot()` und Hilfen dazu), `server/sim/combat.js` (nur `droneSnap`, `b2SnapGegner`, `playerSnap`), `server/sim/waffen.js` (nur `snapFelder`), `server/sim/wellen.js` (nur `snap`), neu `server/sim/snapform.js`, Client-Leser in `public/js/{render.js,art.js,client.js,consoles.js,dev-mock.js}` und `public/js/voxel/{actors.js,fx.js}`, `tools/sim-headless.js` (nur Snapshot-Leser und Budget-Stellen), alle `tools/test-*.js` und `tools/ws-smoke.js` (nur Budget-Stellen und Feld-Prüfungen), neu `tools/snap-mess.js`, `package.json` (nur Skript `snap:mess`) | 3380–3381 |
| **ART** | AP7 | `content/buehnen/station/**`, `content/buehnen/paletten/**`, `public/voxel/assets/**`, `public/js/voxel/kit.js`, `public/js/voxel/loader.js`, `public/js/voxel/deko.js`, Werkstatt-Dateien (Editorstart `&palette=`), `tools/check-assets.mjs`, neu `tools/kaltbau-mess.js`, `package.json` (nur Skript `mess:kaltbau`) | 3385–3386 |

`package.json` teilen sich beide: jeweils nur die eigene Skriptzeile mit Edit einfügen. **`public/js/voxel/actors.js`
gehört NETZ.** Braucht ART dort etwas für den Prefetch, geht es über einen Wunsch an main.

---

## 2. AP1 Netzbudget (Team NETZ)

### 2.1 Ziel
Worst Case **mindestens 1,5 KB unter der Grenze**: Snapshot ≤ `13 312 − 1 536 = 11 776 B`. Gemessen wird mit
`Buffer.byteLength(JSON.stringify(g.snapshot()))`. **Kein Verhalten ändert sich**, auch nicht das der Bots.

### 2.2 Befund (von der Studioleitung geprüft)
- Die Grenze steht als Zahl im Code: `13 * 1024` in `sim-headless.js` (3255, 3280, 3292), `test-bausteine.js` (293, 423),
  `test-combat.js` (905, 1189, 1618), `test-m3.js` (161, 1579), `test-weltstand.js` (518, 523), `test-wellen.js:18`.
  `12 * 1024` steht in `test-combat.js:74/650`, `test-features.js:511` und `ws-smoke.js:140`.
- Die Altfelder `asleep`, `cr`, `squad` und `role` setzt **`droneSnap`** (`combat.js:~1570`), nicht `b2SnapGegner`.
- Die vier Altfelder bringen rechnerisch nur ~0,65–0,8 KB. Nötig sind ~1,05 KB.
- Der Bot liest `d.role === 'aufrichten'` (`sim-headless.js:~1349`). `test-combat.js:69` prüft `'role' in d`.
- **`role` (KI-Rolle) ≠ `ro` (Gegnerrolle).** `ro` bleibt unverändert.

### 2.3 Lieferung
1. **Konstanten:** `CONFIG.net.snapMax = 13 * 1024`, `CONFIG.net.snapLuft = 1536`. Alle Budget-Stellen lesen sie. Die
   `12 * 1024`-Stellen einzeln prüfen: Entweder sie werden zu `snapMax`, oder sie bleiben bewusst strenger als
   benannte Konstante mit Grund im Kommentar. Am Ende gibt es keine Zahl `13 * 1024` und keine Zahl `12 * 1024` mehr in
   `tools/`.
2. **Messskript `tools/snap-mess.js`** (`npm run snap:mess`). Zwei Aufbauten:
   - **Worst Case** wie `test-combat.js:1590–1623`: Außenposten, 3 Spieler, 12 Gegner, Granaten. 5 Seeds, je 20 s,
     Messung in jedem Tick.
   - **Wellenlauf** bis `CONFIG.wellen.maxLebend`.
   Ausgabe: Max, p95 und Bytes je Top-Level-Schlüssel und je Gegner (Mittel). Option `--json` für den Bericht.
   **Zuerst vor jeder Änderung laufen lassen** und den Vorher-Wert festhalten.
3. **`server/sim/snapform.js`:** eine benannte Hilfe, die Standardwerte weglässt (z. B. `ohneStandard(obj, standards)`).
   Leser behandeln „Feld fehlt“ wie den Standard.
4. **Gegner:**
   - `asleep` und `cr` nur bei `true` senden.
   - `ghost` und `aim` nur, wenn nicht `null`.
   - `squad` streichen (der Client fällt in `voxel/actors.js` auf den ID-Präfix zurück).
   - `revealed` und `alive` streichen, sobald jeder Leser auf `vis` bzw. `zs` umgestellt ist.
   - `role` (KI-Rolle) nur senden, wenn `CONFIG.debug.snapKiRolle` an ist. Das Debug-Overlay (`render.js`) und alle Bots
     (`sim-headless.js`, damit auch `golden-trace.js`) schalten den Schalter ein. So bleiben Bot-Verhalten und Golden gleich.
5. **Spieler:** `bleed`, `cr`, `zs:'ok'`, `ov:0`, `bt:0` und `fl:false` als Standardwerte weglassen (gilt nur, wo der
   Wert wirklich ein Standard ist).
6. **Alle Leser gemeinsam umstellen:** Server, 3D (`public/js/voxel/`), 2D (`render.js`, `art.js`), `client.js`,
   `consoles.js`, `dev-mock.js`, Bots und Tests. Vergleiche wie `x === false` gegen ein fehlendes Feld sind der
   häufigste Fehler. Jede geänderte Lesestelle wird im Bericht aufgelistet.
7. `shared/protocol.js`: Doku-Kommentare zu `drones[]` und `players[]` nachziehen („fehlt = Standard“).
8. **Reicht es nicht für 11 776 B:** Nichts darüber hinaus bauen (kein Delta, keine Kompression). Mit Zahlen aus
   `snap-mess` im Bericht nennen, welches Feld als nächstes in Frage käme.

### 2.4 Abnahme
- `npm run snap:mess`: Worst Case max ≤ 11 776 B, Wellenlauf max ≤ 11 776 B. Vorher- und Nachher-Werte im Bericht.
- Der Worst-Case-Test in `test-combat.js` prüft gegen `snapMax − snapLuft`.
- `npm run check` und `npm test` grün (Zahlen). Golden m1–m3 identisch zur Basis.
- Browser (Playwright, Port 3380): Bodenkampf in 3D und in `?render=2d`, je ein Screenshot vorher und nachher
  (`shots/netz/`): Gegner schläft (Wächter), duckt sich, Debug-Overlay mit KI-Rolle. Keine sichtbare Änderung.

---

## 3. AP7 Art-Nachzug und Ladezeit (Team ART)

### 3.1 Befund (von der Studioleitung geprüft)
- **Schon erledigt, nicht noch einmal anfassen:** `item/waffe/rom/{blaster,sturmgewehr}` existieren, `#B8302A` kommt
  nicht mehr vor, die Rollen `alarm`, `leit` und `frost` stehen in `public/voxel/assets/palettes/base.json`.
  `OFFEN-STUDIO.md` ist da veraltet (die Studioleitung zieht es nach).
- `station.schachtabzweig.a.json` ist der einzige Platztyp mit nur einer Variante.
- `rom_kastell.json` hat keine Gold-Rolle.
- `check-assets.mjs` prüft `streu` **überhaupt nicht**. Der Client kann `{id, wandnah}` schon (`deko.js`, `kit.js`).
- Prefetch (`kit.js:~1353`) lädt nur Kits, Props und Leitstücke. **`fig/crew/*` gibt es nicht.** Die richtigen IDs:
  Crew `crew/nova|juno|tami`, Gegner `fig/germanen/<rolle>`; `fig/basis/*` kommen als Abhängigkeiten mit. Waffen
  laden zweistufig (Gerüst, dann die Bauweise-Anbauten optional).
- Das Messskript `b-qa-int-regress.js` aus `QA-INTEGRATION.md` §3.4/§4 **liegt nicht im Repo**.
- Die Modelle in `public/voxel/assets/` sind ein Sync aus Voxelwerk (`VERSION.json`). Wenn ein Modell nur in Voxelwerk
  sauber zu ändern ist, ändere es nicht hier, sondern nenne es im Bericht.

### 3.2 Lieferung (in dieser Reihenfolge)
1. **`tools/kaltbau-mess.js`** (`npm run mess:kaltbau`, Playwright laut TEAM-START). Methode `QA-INTEGRATION.md` §3.4:
   frischer Server und frischer Browser je Lauf, 3 Seeds, `buildMs`, `ladeMs` und HTTP-Anfragen während des Baus.
   Kartenarten Außenposten, Station, Ruine und Schiff. Modi: Direktstart (`?arena=away&art=…`) und über die
   Transferkammer. Ausgabe: Median je Kartenart und Modus. **Vorher messen.**
2. **Prefetch** in `kit.js` erweitern: Figuren der Crew und der aktiven Fraktion, Waffen-Gerüste mit den Anbauten der
   aktiven Bauweise und die Paletten-Overrides der Figuren. Der Prefetch läuft im Leerlauf und darf den ersten Frame
   nicht verzögern. Nachher messen.
   **Ziel: Schiff kalt < 1,5 s** (Median aus 3 Seeds). Wird das verfehlt, nennt der Bericht, woran es liegt (z. B. dass
   der Prefetch beim Direktstart keine Zeit hat).
3. `station.schachtabzweig.b.json`: eine zweite Variante, die erkennbar anders ist. `node tools/buehne.js alle` bleibt
   bei 100 %.
4. **Paletten:** eine Gold-Rolle in `rom_kastell` (Saum Fahnenheiligtum), Holzton `nord` an Palisaden prüfen, Fugen-Kontrast
   `kit/rom/gemein/boden_fuge` prüfen. Je ein Screenshot vorher und nachher (`shots/art/`). Ob es Kai gefällt,
   entscheidet Kai.
5. **`check-assets.mjs`:** eine neue `streu`-Prüfung in `content/buehnen/paletten/*.json`. IDs werden gegen
   Manifest/Index geprüft, die String-Form und `{id, wandnah}` sind beide erlaubt. `kontor.json`: `regal` auf
   `{id:'regal', wandnah:true}` umstellen und den veralteten `hinweis` entfernen.
6. **Kleinkram:** Halsplatte am Drachenkopf (14×12 `leit`) entfernen, Werkstatt übernimmt `&palette=` beim Editorstart,
   Props mit alten Zeichenfolgen neu rendern, Tierzeichen-Varianten. Dazu je Kartenart ein Leitstück-Screenshot
   (Außenposten, Station, Ruine, Schiff) unter `shots/art/leit-*.png`.

### 3.3 Abnahme
`npm run check:assets` ohne Fehler (Warnungen mit Zahl), Galerie 11/11 Schablonen bestanden, `buehne alle` 100 %,
`npm run mess:kaltbau` mit Vorher- und Nachher-Tabelle (Schiff < 1,5 s), Screenshots vorhanden, `npm run check` und
`npm test` grün.

---

## 4. AP2 Sprung im Tutorial (Team SPRUNG)

Studioleitung: AP1 (`84e0a19`) und AP7 (`12bedec`) sind abgenommen. AP2 läuft allein im Baum.

### 4.1 Ziel
Die Regel „Boje anfliegen, um zu springen“ gilt überall, auch in m1–m3 (Kai, 2026-10-09). Abgesehen davon spielt sich das Tutorial wie heute.

### 4.2 Befund (von der Studioleitung geprüft)
- `anflugPflicht()` (`server/sim/sprung.js:32`) regelt **zwei** Dinge:
  - **(a) Anflug:** Sperrgrund (:91) und Ankunft am Gegen-Sprungpunkt (:122/126).
  - **(b) Zielwahl** (:161–168): im Tutorial über Ort-Links, sonst über `hexGrund`, wofür die Boje bekannt sein muss.
  Wer nur `tutorialFrei` streicht, ändert auch (b). Dann droht im Tutorial ein Softlock, weil die Boje noch unbekannt ist.
- `tutorialLaeuft()` (:24) ist auch dann wahr, wenn kein Weltstand persistiert ist (Direktstart m3, Golden, Tests).
- Den Rückfall für ein fehlendes `ship.jump.anflug` behandeln die Clients unterschiedlich: `consoles.js:55` nimmt `true`, `starmap.js:645` nimmt `false`.
- Texte stehen in `content/regiebuecher/m{1,2,3}.regiebuch.json` (`texte`). Die 300-px-Regel erklären in m1 die Texte `undock.sternkarte`, `undock.checkliste`, `route.faltsprung` und `ziel.faltsprung`. Der erste Sprung ist in m1 `undock`, in m2 `vaelen`, in m3 `flight`.
- `explore.js:274` meldet „Boje gefunden“ nur, wenn Anflugpflicht besteht. Im Tutorial kommen damit neue ODA-Zeilen dazu, das ist erlaubt.
- Den Bojenanflug für Bots gibt es schon: `GenericAgent.flyClear` (`sim-headless.js:~1932`). `Agent.flyClear` (:~457) fliegt dagegen nur auf Abstand.
- Die Kontext-Goldens enthalten `buch-hashes.json` (`tools/test-spielleiter.js` T2). Textänderungen an m1–m3 machen T2 rot. Deshalb **einmal bewusst** mit `--update` neu schreiben, die Änderung prüfen und im Bericht nennen.

### 4.3 Dateien
`shared/config.js` (nur `sektoren.tutorialFrei`), `server/sim/sprung.js`, `server/sim/explore.js` (nur die Boje-Meldung, falls nötig), `public/js/{consoles.js,starmap.js}` (nur Rückfall/Hinweise), `content/regiebuecher/m{1,2,3}.regiebuch.json` (nur `texte`), `tools/{sim-headless,golden-trace,test-sektoren}.js`, `tools/fixtures/golden/base-w1/**` (neu), `tools/fixtures/golden/allow-w1.json` (neu), `tools/fixtures/context/**` (nur per `--update`), `concept/buehnen/ENTSCHEIDUNGEN.md` (Entscheidung 29), `README.md` (nur „Neu in B3“, Tutorial-Zeile). Port 3377–3378, `WORLD_DIR=data/worlds-sprung`, `REGIE_DIR=data/regie-sprung`.

### 4.4 Lieferung
1. **Vorher messen:** Bot-Zeit m1, m2, m3 solo und zu dritt (Median aus Golden `base`). Referenz für m1 sind 8:23.
2. `anflugPflicht()` gibt immer `true` zurück. `tutorialFrei` entfällt. `test-sektoren.js` wird nachgezogen.
3. Die Zielwahl bekommt eine eigene, benannte Funktion `zielwahlUeberOrtLinks(game)`. Sie ist wahr, solange das Tutorial läuft (Logik des heutigen `tutorialLaeuft`), und damit springt das Tutorial weiter über Ort-Links. **Ziel:** Kein Ort im Tutorial wird unerreichbar, weil seine Boje unbekannt ist. Falls die Ankunft am Gegen-Sprungpunkt (:122/126) Mission-Trigger an `scene.arrive` bricht (Schritt-Ziele „ankommen“), meldest du das an main, statt es selbst umzubauen.
4. Client: fehlt `anflug`, gilt einheitlich `false`. Randpfeil, Ring und Steuer-Zeile funktionieren im Tutorial (Screenshot).
5. **Texte:** m1 erklärt den Anflug beim ersten Sprung. Ersetze die vier 300-px-Stellen; der Mindestabstand von 300 px zur Station bleibt technisch bestehen und darf erwähnt werden. m2 `vaelen` und m3 `flight` bekommen einen Satz. Ton und Länge wie die vorhandenen Texte.
6. **Bots:** Den Bojenanflug von `GenericAgent` nach `Agent` hochziehen. Damit fliegen Tutorial-Bots und `golden-trace` die Bojen an.
7. **Golden neu aufnehmen:** `tools/fixtures/golden/base-w1/`, `--all` mit Standard-Seeds. Dazu `allow-w1.json` mit den erlaubten Abweichungen: Dauer, Ankunftsposition und Texte zu Anflug und Boje. **Flags, Inventar und Missionsausgang ändern sich nicht.** Den Vergleich `base` gegen `base-w1` mit `allow-w1.json` in den Bericht übernehmen. Ab jetzt ist `base-w1` die Basis; vermerke das in einem Kommentar am Kopf von `golden-trace.js`.
8. **Doku:** Entscheidung 29 in `ENTSCHEIDUNGEN.md` (Nachtrag W1, Datum, Kai) und die Tutorial-Zeile in README „Neu in B3“.

### 4.5 Abnahme
- `npm run check` und `npm test` grün (Zahlen), `npm run test:sektoren` grün.
- Golden `base` gegen `base-w1` grün mit `allow-w1.json`. Die Abweichungsliste steht im Bericht.
- Bot-Zeiten m1–m3 vorher und nachher in einer Tabelle.
- Browserlauf m1 mit echten Eingaben (Playwright, Port 3377): Ohne Anflug ist der Sprung gesperrt und der Hinweis wird gezeigt; nach dem Anflug geht der Sprung. Screenshots unter `shots/sprung/`.
- Notfallsprung: unverändert (keine Sonderregel).
---

## 5. AP4 Spielleiter Boden II (Team SPIELLEITER)

Studioleitung: AP2 ist abgenommen (`b364306`). AP4 läuft im Baum `Pantheon-play`. Parallel arbeitet Team LABOR (AP3a,
`CONTRACT-W2.md`) in einem **eigenen** Arbeitsbaum. Die Studioleitung führt beide Stände zusammen.
**Konfliktregel:** In `tools/sim-headless.js` änderst du **nicht** `testBooks`, `buildTestBook`, das Vorbauen der
Landepunkte und `umsetzungMain`. Diese Teile zieht LABOR nach `server/mission/labor.js` um. Nur Agenten-Verhalten
ist dein Teil (Gefangenschaft, Funkduell-Wahl, Schleichen).

### 5.1 Ziel
1. Der Spielleiter kann *Ausbruch* und *Unbemerkt hineinkommen* planen.
2. Gefangenschaft entsteht ohne Kampf, wenn ein Gespräch eskaliert, während das Schiff angedockt ist (Kai, E5).
3. Der Katalog im Grobplan wird kürzer.
4. Der Kampagnenstart verbrennt keine 77k Tokens mehr.

### 5.2 Befund (von der Studioleitung geprüft)
- `combat.ausbruch()` (`combat.js:~1283`) prüft keine Fesseln. Es setzt die Zelle auf „zu“, die Beute auf „voll“, belebt
  das Team an der Zelle wieder, setzt die Faust und `p.gefangen`. Das Team muss **schon auf der Bodenkarte** sein.
- Das Schrittfeld `ausbruch_erlaubt` (`CONTRACT-B2.md:195`) ist nie gebaut worden. Nur `wellen.js` setzt
  `aw.ausbruchErlaubt = false`.
- Die Mechaniken `gefangenschaft` und `stealth_aussen` stehen auf „geplant“. Echte Prüfer-Warnungen:
  - `ausbruch/zelle_und_kammer`: `FLAG-UNGELESEN s1_frei`
  - `unbemerkt_hineinkommen/leise_bis_ziel`: `FLAG-UNGELESEN s1_unbemerkt`, `s1_entdeckt` und `TEXT-UNBENUTZT s1.ziel_hoch`
- **Andocken** geht nur am Hafen (`hafen.kontor`, Station) und an Vaelen (`vaelen.handelsschiff`, Schiff, Seed 207,
  Schablone per Seed). **Zellen gibt es unter den Schiffsschablonen nur in `schiff.kriegsschiff`**, nicht im Frachter.
  Ob die Vaelen-Karte eine `zelle` hat, prüfst du zuerst. Hat sie keine, wählst du in dieser Reihenfolge:
  - (a) Der Szenenbau wählt über `buehne_braucht` einen Seed oder eine Schablone mit Zelle, sofern es dafür schon einen
    Mechanismus gibt.
  - (b) Der Frachter bekommt eine Arrestkammer als Modul. Dann muss `buehne alle` bei 100 % bleiben.
  - (c) Die Studioleitung fragen.
- Das Gespräch: `verhandeln/funkduell` (`funk_entscheidung`, verfügbar). Folgen sind `folgen_a`, `folgen_b` und
  `folgen_schweigen` vom Typ `aktionen`. Eine Haltung je Fraktion gibt es im Weltstand (`server/weltstand.js`), das ist
  das Vorbild für „Verhältnis zum Kontor sinkt“.
- Den Katalog-Text für den Grobplan liefert `katalog.js` `fuerSpielleiter(k,'kurz')`, verwendet in `spielleiter.js:~500`.
  Ein Offline-Token-Werkzeug gibt es nicht.
- `KARTE-WIEDERHOLT` (`szenenbau.js:~316`) vergleicht nur mit gespielten Missionen. Das Vorbild für eine Prüfung über die
  Runde ist `LANG-RUNDE` (:~313).
- Kampagnenstart: `retries: 1` (2 Versuche mit vollem Kontext), danach `planFromArchive`. Ohne Tutorial gibt es sofort ein
  Archiv-Angebot (`spielleiter.js:~325`).

### 5.3 Dateien
`server/sim/combat.js` (nur Ausbruch/Gefangenschaft), `server/sim/away.js` (nur falls zum Hinunterbringen nötig),
`server/sim/interior.js` (nur falls nötig), `server/mission/{bausteine/*.js,checker.js,katalog.js,szenenbau.js,
spielleiter.js,registry.js,context.js}`, `server/sim/mission.js` (nur `ausbruch_erlaubt`), `server/weltstand.js` (nur
Haltung), `content/katalog/**`, `content/buehnen/schiff/**` (nur Fall b), `shared/config.js` (nur `spielleiter`,
`ausbruch`), `tools/katalog.js`, `tools/sim-headless.js` (nur Agenten, siehe Konfliktregel), `tools/test-*.js` (neue
Prüfungen), `tools/fixtures/context/**` (nur per `--update`, einmal am Ende), `content/katalog/README.md`. Port 3391–3392,
`WORLD_DIR=data/worlds-sl`, `REGIE_DIR=data/regie-sl`.

### 5.4 Lieferung
1. **Kern-Routine `teamGefangenNehmen(game, landepunkt)`** in `combat.js`. Sie baut die Karte, bringt das Team von Bord
   hinunter (vorhandene Wege für das Beamen bzw. Betreten der Bühne nutzen) und ruft `ausbruch()` auf. `ausbruch()` nach
   einem verlorenen Kampf bleibt unverändert. Gleiche Regeln: Zellentür 8 s, laut, Faust, Ausrüstung an `beute`.
2. **Aktion `team_gefangen { landepunkt }`** im Registry. Sie ist an zwei Stellen gültig:
   - im `enter` eines Schritts (Szenenstart in der Zelle)
   - als Folge im `funkduell` (Eskalation), solange das Schiff angedockt ist
3. **Prüfer:** `team_gefangen` verlangt Anker `zelle` und `beute` auf dem Landepunkt. Neue Fehlercodes:
   - `GEFANGEN-OHNE-DOCK`: als Funkduell-Folge ohne Andock-Ort in der Szene
   - `GEFANGEN-HEIMATHAFEN`: Landepunkt am Hafen
   Beide bekommen einen Test.
4. **Schrittfeld `ausbruch_erlaubt`** (Standard true) und ein Test dafür.
5. Die Vorlagen `ausbruch.json` und `unbemerkt_hineinkommen.json` werden prüferfest: Flags lesen, `ziel_hoch` benutzen oder
   streichen. Die Ausbruch-Vorlage startet über `team_gefangen` im `enter`.
6. **Neue Umsetzung `verhandeln/andockkontrolle_eskaliert`:** Andocken an Vaelen, dann Kontrolle durch das Kontor als
   Funkduell. Eine Antwort eskaliert: Abblende, Folge `team_gefangen`, weiter mit dem Ausbruch-Teil. Die Haltung zum
   Kontor sinkt. Nach gelungenem Ausbruch kann das Schiff ablegen. Texte im Ton der vorhandenen Regiebücher.
   Mit `test.params` und `buehne_braucht`.
7. `mechaniken.json`: `gefangenschaft` verfügbar. `stealth_aussen` verfügbar, mit der Beschreibung „Lärmradius, Alarm je
   Trupp, Patrouillen, Sicht 10, kein Sichtkegel (E18)“.
8. **`node tools/katalog.js --tokens`:** Zeichen und geschätzte Tokens je Abschnitt des Grobplan-Katalogs (Schätzung
   Zeichen/3,5 reicht, im Kopf dokumentiert). Vorher messen.
9. **Kurzfassung:** je Umsetzung eine Zeile (ID, Kartenarten, Pflicht-Params, Dauer). Prosa und „Noch nicht spielbar“
   fallen aus dem Grobplan-Prompt. **Ziel: −40 % im Katalogteil.** Nachher messen.
10. **`KARTE-WIEDERHOLT` über die ganze Runde** nach dem Muster `LANG-RUNDE`. Test: `wreck` zweimal in einer Runde.
11. **Kampagnenstart:** neue Funktion `startRundeKampagnenstart` mit 0 Wiederholungen, denn das Archiv-Angebot liegt dort
    schon. In normalen Runden bekommt der zweite Versuch die Prüferfehler als gezielte Liste. Falls das schon so ist,
    bleibt es dabei, und der Bericht nennt es. Nachweis offline mit einem Mock-LLM, das ungültige Pläne liefert: Zahl
    der Aufrufe und Prompt-Zeichen vorher und nachher.
12. **Bots:** Der Agent kommt mit `p.gefangen` zurecht (Zellentür halten, Ausrüstung holen, zum Abholpunkt), schleicht
    sinnvoll und wählt im Funkduell nach `BOT_WAHL=a|b|schweigen`. Gespielt wird mit
    `sim-headless umsetzung <id>` für `ausbruch/zelle_und_kammer`, `unbemerkt_hineinkommen/leise_bis_ziel` und
    `verhandeln/andockkontrolle_eskaliert`, je 3 Seeds × Crew 1 und 3.
13. **Kontext-Goldens** einmal am Ende mit `--update` neu schreiben. Die Änderung wird im Bericht begründet.

### 5.5 Abnahme
- `npm run katalog`: 38/38 verfügbar (37 + die neue Umsetzung).
- Die Bot-Tabelle aus 5.4 Nr. 12 im Bericht.
- Token-Messwerte vorher und nachher, Mock-Nachweis Kampagnenstart.
- `npm run check` und `npm test` grün (Zahlen). Golden gegen `base-w1` mit `allow-w1.json` grün.
- Browser (Port 3391), Screenshots unter `shots/sl/`:
  - Ausbruch ab Start
  - Schleichen bis ins Ziel, einmal ohne und einmal mit Alarm
  - Andocken an Vaelen → Eskalation → Zelle → Ausbruch
  Wenn der Browserlauf zu aufwendig wird, reicht für das Schleichen ein Bot-Lauf mit Zustandsprotokoll. Der Bericht
  nennt das dann.