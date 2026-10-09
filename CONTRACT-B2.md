# CONTRACT-B2 – Bodenkampf: Waffen mit Hitze, Wunden, Gegner mit Rollen

Ergänzung zu `CONTRACT-B1.md`. **Teams, Welle 0, Ports, Vokabular, Weltstand v3, Protokoll-Regeln und Berichtspflicht
stehen in `CONTRACT-B1.md` §1, §3, §8, §9, §13 und gelten hier.** Vorhandene Feldnamen werden nicht gebrochen. Bei
Widerspruch gilt der Code. Abweichungen und Namenskonflikte gehen an die Studioleitung (SendMessage „main“).

Grundlagen:
- Briefing §3, §4.6, §4.7
- Entscheidungen 10–18, 23–26
- `concept/buehnen/INHALT.md` §7 (Fraktionen, Trupps, Haltung, Funk), §10 (Startwerte)
- `ART-PLAN.md` §2, §4.3 (Figuren, Waffen, FX)

## 0. Ziel und Entscheidungen

**Ziel.** Taktischer Bodenkampf mit **sechs Waffen** und **Gegnern mit lesbaren Rollen**, nach **denselben Regeln für
Spieler und Gegner**. Alle Zahlen sind per `tune` live änderbar.

**Verbindlich:**
1. **Hitze statt Nachladen** für alle Handwaffen. Die Pistole der Verwundeten bleibt, wie sie ist.
2. **Wunden statt Lebenspunkte:**
   - Spieler und normale Gegner: 1
   - Enterer: 2
   - Wächter: **4 Segmente + 2 Wunden** (E15)
   - Bosse: ab 3

   Anzeige wie die Schildsegmente.
3. **Gefallene Gegner bleiben liegen** und können von Kameraden aufgerichtet werden, wie Spieler. Wer nicht aufgerichtet
   wird, ist nach dem Ausbluten aus dem Gefecht (E10).
4. **Bewusstlos und Fesseln** für beide Seiten (E11).
5. **Ausbruch auf derselben Karte** (E12):
   - Ist das Team gefangen, starten alle am `zelle`-Anker, die Ausrüstung liegt am `beute`-Anker.
   - Rückfall: Notrückholung wie heute.
6. Getroffen werden **unterbricht Ausholen und Laden**, für alle (E13). Der **Frontschild blockt Nahkampf von vorn** (E14).
7. Zielen über 10 Kacheln nur vom `aussicht`-Anker oder mit **geteilter Sicht** (Captain-Markierung, Trupp-Funk) (E16).
8. **Friendly Fire:** Flächenwirkung trifft alle, direkte Schüsse treffen keine Verbündeten (beide Seiten) (E17).
9. **Schleich-Grundstufe:** Alarm je Trupp, Lärmradius, Patrouillen, Sicht 10, **ohne** Sichtkegel und Alarmstufen (E18).
10. **Neue Gegner zuerst als Germanen:**

    | Rolle | Name |
    |---|---|
    | `grundtyp` | Karl |
    | `niederhalter` | Bolzer |
    | `grenadier` | Donnerwerfer |
    | `schuetze` | Jäger |
    | `enterer` | Berserker |
    | `haescher` | Wergeld-Fänger |

    - Die Rostmeute kämpft mit Plünderern und **Friedlosen** (germanische Modelle mit Palette `friedlose`).
    - Der Kontor-Clan und der Raubzug stellen echte Germanen.
    - Herrenlose Kastelle stellen den **Kastell-Automaten** (Wächter-Rolle, das Scutum dient als Frontschild).
    - Konkordat ist kein Gegner.
11. **Einführungsregel:** höchstens eine neue Gegnerrolle je Gefecht, bis die Crew sie kennt (`crew.rollen_gesehen`, E24).
    **Keine Rollensymbole** über den Köpfen (E25).
12. **Waffenwahl am Transporter**, gespeichert je Spieler über einen **Hash der Browser-Kennung**, nie über Namen (E26).
    Neu dazukommende Spieler starten mit dem Blaster. Alle Waffen sind ab Start verfügbar.
13. **Ankündigungsregel:** Alles, was mehr als 1 Segment nimmt oder den Schild umgeht, ist ≥ 0,5 s vorher sichtbar
    (Ausholen, Lanzenleuchten + Zielstrahl am Ziel, Granatkreis). Das gilt für beide Seiten.
14. **Lärmradien** (GD): laut 18, mittel 10, leise 4, Nahkampf 3 Kacheln (per `tune`).

**Tutorial (bewusste Änderung, wie in S2b):**
- m1 (Plattform, alter Kampf) und m2 (Raum) bleiben **unverändert**.
- m3 (Kesh) ändert sich durch Hitze, Wunden und den Wächter mit 4+2.

Golden-Ablauf:
1. `tools/fixtures/golden/base` nach `tools/fixtures/golden/base-s2b` kopieren.
2. Vergleich mit `allow-b2.json`: m1/m2 byte-gleich, m3 gleiche Schrittfolge, nur Kampfdauer, Treffer und Schild weichen
   ab.
3. Danach neu aufnehmen nach `tools/fixtures/golden/base` (QA-INTEGRATION).

Die Startwerte sind so gewählt, dass ein normaler Schussrhythmus (≈ 1 Schuss je 0,6 s) nicht überhitzt.

**Nicht in B2:**
- Shop, Ruf, Werkzeuge, Geräte, Verbrauchsgüter, Crew-Optik
- Sichtkegel und Alarmstufen
- Verschleppung zwischen Karten
- Rom-Bodentruppen außer dem Kastell-Automaten (die Probe-Rolle laut ART-PLAN wird im Spiel nicht verwendet)
- Raumkampf (unverändert)

**Nicht brechen:**
- alles aus `CONTRACT-B1.md` §0
- Snapshot < 13 KB mit 3 Spielern, 12 Gegnern, 2 Niederhaltern im Dauerfeuer und 2 Granaten in der Luft
- `test-combat` (angepasst, nicht gelöscht)
- `sim:arena`

## 1. Dateibesitz und Wellen (Auszug; vollständig in `CONTRACT-B1.md` §1)
| Welle | Team | Dateien / Aufgabe |
|---|---|---|
| 0 | Studioleitung | Startwerte §1.1, Stub `server/sim/waffen.js` |
| 0–1 | **FX**, **UI-ART**, **ART-POSEN**, **ART-FIG-TEILE**, SYS-FIGUREN | nach ART-PLAN (`fx.js`, `icons-b.js`, Voxelwerk) |
| 1 | **WAFFEN** | `server/sim/waffen.js`, `tools/test-waffen.js`: reine Funktionen und Tests gegen den Kämpfer-Vertrag (§3.1), ohne Einbau |
| 1 | **BODENKAMPF** | `server/sim/{combat,squad,away,interior}.js`. Welle 1: Entkopplung (B1 §6.1), Decks in der Außenzone und **Einbaupunkte** für `waffen.js` (§3.3), zunächst mit `Waffen.aktiv === false` und unverändertem Verhalten |
| 2 | **WAFFEN** | Einbau aktivieren: Hitze, Wunden, Betäubung, Fesseln über `waffen.js`, Weltstand `crew.waffen` |
| 2 | **BODENKAMPF** | KI-Profile (§5), Schleichen (§6), Aufrichten, Fesseln und Ausbruch in KI und Ablauf (§4) |
| 2 | **ENGINE** | Protokoll §8, Bausteine `server/mission/bausteine/bodenkampf.js`, Weltstand `crew`, `arena_away` mit Fraktion, Stärke, Haltung |
| 2 | **KATALOG** | `content/katalog/{gegner,fraktionen}/**` (INHALT §7), Szenentyp `ausbruch` (C8) → `verfuegbar` |
| 2 | **SPIELLEITER** | Kontext und Grobplan-Besetzung (§7) |
| 2 | **CLIENT** | Waffenwahl an der Transfer-Konsole, HUD für Hitze, Laden, Wunden und Zustände (Icons aus `icons-b.js`), 2D nur nötigste Anzeige (E35) |
| 1–2 | **VOXEL** | Figuren nach Rolle × Fraktion, Palette je Besitz, Waffen am `handR`, Posen je Zustand. FX-Aufrufe über die API von `fx.js` |
| 2 | **ART-WAFFEN**, **ART-FIG-A**, **ART-FIG-B**, **ART-RUINE** (Kastell-Automat), **AUDIO** | nach ART-PLAN bzw. §10 |
| 3 | BOTS, QA-INTEGRATION | Golden-Ablauf (§0), Bot-Waffenwahl, Balancing |
| 4 | **QA-ABNAHME-B2** | §11 |

### 1.1 Startwerte `shared/config.js` (Welle 0, Block `awayCombat`; Werte aus INHALT §10, per `tune`)
```js
waffen: {
  // schuss = Schüsse bis 100 % Hitze · kadenz s · pause = Kühlbeginn nach s · kalt = s von 100 % auf 0 · sperre = Zwangspause s
  // reichweite in Kacheln · tempo px/s · streuung Grad
  blaster:      { schuss: 5,  kadenz: 0.3,  pause: 0.6, kalt: 2.0, sperre: 2.5, reichweite: 13, tempo: 380, streuung: 2, schaden: 1, laerm: 'mittel' },
  sturmgewehr:  { schuss: 12, kadenz: 0.15, pause: 0.6, kalt: 2.5, sperre: 3.5, reichweite: 9,  tempo: 420, streuung: [6, 14], schaden: 0.5, schildReset: true, laerm: 'laut' },
  granatwerfer: { schuss: 2,  kadenz: 1.2,  pause: 0.6, kalt: 3.0, sperre: 4.0, min: 4, max: 12, flug: 0.8, streuung: 0.5, radius: 1.5, schaden: 1, betaeubt: 1.5, flaeche: true, laerm: 'laut' },
  lanze:        { schuss: 1,  laden: [1.0, 2.0], pause: 0.6, kalt: 2.5, sperre: 3.5, reichweite: 22, schaden: [1, 2], durchschlagFront: true, stehen: true, laerm: 'leise' },
  nahkampf:     { schuss: 3,  ausholen: 0.5, erholung: 0.6, pause: 0.6, kalt: 2.0, sperre: 3.0, reichweite: 1.3, wunde: true, laerm: 'nah' },
  betaeuber:    { schuss: 4,  kadenz: 0.45, pause: 0.6, kalt: 2.0, sperre: 3.0, reichweite: 9, tempo: 380, streuung: 2, schaden: 1, nichttoedlich: true, laerm: 'leise' },
  faust:        { schuss: 4,  ausholen: 0.6, erholung: 0.6, pause: 0.6, kalt: 2.0, sperre: 3.0, reichweite: 1.2, schaden: 1, laerm: 'nah' },
},
laerm: { laut: 18, mittel: 10, leise: 4, nah: 3 },
sicht: { aussicht: 22, geteiltTtl: 6 },            // normal bleibt sightTiles (10)
koerper: { bewusstlos: 30, fesseln: 3, befreien: 3, aufrichten: 4, gegnerBleedout: 45, ankuendigung: 0.5, ausbruchTuer: 8 },
gegner: {   // seg, wunden, speed px/s, aim s, hitRadius px; regenDelay 4 / regenStep 1.5 (Wächter 6 / 2) wie heute
  grundtyp:     { seg: 3, wunden: 1, waffe: 'blaster',      speed: 70, aim: 0.8, hitRadius: 13, rhythmus: 1.3 },
  niederhalter: { seg: 3, wunden: 1, waffe: 'sturmgewehr',  speed: 60, aim: 0.9, hitRadius: 14, stoss: 8, stossPause: 2 },
  grenadier:    { seg: 3, wunden: 1, waffe: 'granatwerfer', speed: 60, aim: 1.0, hitRadius: 13, rhythmus: 3, fehlwurf: 0.2 },
  schuetze:     { seg: 2, wunden: 1, waffe: 'lanze',        speed: 70, aim: 1.2, hitRadius: 12, abstand: 5 },
  enterer:      { seg: 3, wunden: 2, waffe: 'nahkampf',     speed: 80, hitRadius: 15 },
  haescher:     { seg: 3, wunden: 1, waffe: 'betaeuber',    speed: 70, aim: 0.9, hitRadius: 13, rhythmus: 1.0 },
  waechter:     { seg: 4, wunden: 2, waffe: 'waechter',     speed: 32, aim: 1.4, hitRadius: 22, rhythmus: 2.6, schussSeg: 2, frontArc: 120, regenDelay: 6, regenStep: 2 },
},
alarm: { ruheNach: 60, funk: 20, funkVerzoegerung: 4 },
ausbruch: { aktiv: true },
```
`enemy.scavenger` und `enemy.warden` bleiben als Altnamen. `scavenger` = grundtyp der Rostmeute, `warden` = waechter.

## 2. Regeln (für Spieler und Gegner gleich)
| Thema | Regel |
|---|---|
| **Hitze** | Jeder Schuss erhöht die Hitze um `1/schuss`. Nach `pause` s ohne Schuss kühlt sie in `kalt` s von 1 auf 0. Bei 1 ist die Waffe **überhitzt**: gesperrt für `sperre` s, danach Hitze 0. |
| **Laden (Lanze)** | Stehen bleiben und halten, nach `laden[i]` s Stufe `i + 1`. Bewegen bricht ab. Leuchten und Zielstrahl am Ziel sind ab Ladebeginn sichtbar. Ein Treffer bricht ab (E13). |
| **Ausholen (Nahkampf, Faust)** | Ausholen sichtbar `ausholen` s, dann Schlag im Bogen (90°) bis `reichweite`. Ein Treffer bricht ab (E13). Nahkampf: **eine Wunde, Schild ignoriert**. Von vorn gegen einen Frontschild: abgelenkt (E14). |
| **Granate** | Bogen zwischen `min` und `max`. Der Zielkreis ist **für alle sichtbar**, solange gezielt wird und während des Flugs. Die Figur ruft „Granate!“. Fläche `radius`: 1 Segment + Betäubung `betaeubt` s für **jeden** im Radius. Fliegt über halbe und volle Deckung. |
| **Sturmgewehr** | ½ Segment je Treffer (Schild als Zahl, Anzeige in halben Segmenten). Jeder Treffer setzt das Schildladen des Ziels zurück (`lastHitAt`). Die Streuung wächst mit der Hitze. |
| **Betäuber** | Treffer auf den Schild wie beim Blaster. Treffer **ohne** Schild → **bewusstlos** statt Wunde. |
| **Schild** | wie heute (Segmente, `regenDelay`, `regenStep`) |
| **Wunden** | Ein Treffer ohne Schild kostet 1 Wunde. Bei 0 Wunden **fällt** die Figur: Spieler verwundet wie heute (Pistole, Ausbluten 45 s, Aufhelfen). Gegner liegt, kann aufgerichtet werden (`aufrichten` s durch einen Kameraden), nach `gegnerBleedout` s ist er `aus`. |
| **Bewusstlos** | Kein Ausbluten, keine Pistole, niemand kann aufhelfen. Nach `bewusstlos` s wacht die Figur von selbst mit 1 Segment auf. Kann **gefesselt** werden (E halten `fesseln` s, nur von der Gegenseite). |
| **Gefesselt** | Handlungsunfähig, wacht nicht auf. Kameraden **befreien** (E halten `befreien` s). Gefesselte Gegner sind aus dem Gefecht und zählen für `enemies_cleared`. |
| **Friendly Fire** | Direkte Projektile und Schläge treffen nur die Gegenseite. Flächenwirkung (Granate, Ladung) trifft alle. |
| **Frontschild** | Treffer aus dem Frontbogen werden abgelenkt, auch Nahkampf. Ausnahme: Lanze (`durchschlagFront`) und Orbitalschlag. |
| **Sicht** | Gezielt wird nur, was man sieht: ≤ 10 Kacheln mit Sichtlinie (Spieler: Zielhilfe, Gegner: Feuern). Mehr ist erlaubt (bis zur Waffenreichweite) **vom `aussicht`-Anker** (Sicht `sicht.aussicht`) oder bei **geteilter Sicht**: Spieler über Captain-Markierung (`orders` focus, `geteiltTtl` s), Gegner über Trupp-Funk (ein Kamerad im Trupp sieht das Ziel). Spieler können frei schießen, ins Unsichtbare aber ohne Hilfe. |
| **Lärm** | Jeder Schuss bzw. jede Explosion erzeugt Lärm mit Radius `laerm[stufe]` am Schützen. Gegnertrupps im Radius werden **alarmiert** und kennen die Position (§6). |

## 3. Waffen-Modul (WAFFEN) und Einbau (BODENKAMPF)

### 3.1 Kämpfer-Vertrag
Spieler und Gegner werden über dieselben Felder angesprochen. BODENKAMPF legt sie an, `waffen.js` liest und schreibt sie:
```js
kaempfer = { id, team: 'crew'|'feind', x, y, crouch, facing?, frontArc?,
  waffe, hitze: 0..1, gesperrtBis, ladung: { t, stufe } | null, ausholen: { t, winkel } | null,
  schild: { seg, max, lastHitAt, regenT },           // Spieler: p.shield; Gegner: e.seg/e.max (Alias)
  wunden: { n, max },
  zustand: 'ok'|'verwundet'|'bewusstlos'|'gefesselt'|'gefangen'|'aus', betaeubtBis, bewusstBis }
```
`server/sim/waffen.js` exportiert:
- `aktiv`, `def(game, waffe)`
- `kannFeuern(game, k) → null|grund`
- `feuern(game, k, ziel /* { angle } | { x, y } */) → null|grund`
- `update(game, k, dt)` (Hitze, Laden, Ausholen, Betäubung, Aufwachen)
- `treffer(game, ziel, wirkung, quelle) → 'schild'|'wunde'|'gefallen'|'bewusstlos'|'abgelenkt'|'kuppel'|'ignoriert'`
- `laerm(game, x, y, stufe)`
- `unterbrechen(game, k, grund)`
- `fesseln` / `befreien` / `aufrichten(game, k, durch)`
- `waffeSetzen(game, p, waffe)`
- `toSave()` / `restore(obj)` für `crew.waffen`
- `hashKennung(clientId)` (12 Hex-Zeichen, SHA-1)

### 3.2 Projektile
Die vorhandenen `away.projectiles` bekommen `waffe` und `team`. Die Granate ist ein Projektil mit
`{ kind: 'granate', tx, ty, flug, t }`. Kein Treffer im Flug, Wirkung am Ziel. Die Lanze trifft sofort (Strahl) mit
Sichtprüfung.

### 3.3 Einbaupunkte in `combat.js` (BODENKAMPF, Welle 1)
- `shoot`, `fireEnemy`, `hitPlayer`, `hitEnemy`, `knockOut`, `updateWounded` und `updatePlayerShields` rufen
  `Waffen.<…>`, wenn `Waffen.aktiv`. Sonst bleibt das heutige Verhalten.
- Signaturen und Ereignisse von `hitPlayer`/`hitEnemy` bleiben (dünne Hüllen um `treffer`).
- Jeder Treffer auf einen Spieler ruft `anker.onTreffer(game, pid)` (Abbruch von Download und Ladung, B1 §6.2).
- Die Kesh-Interaktionen bleiben unberührt.

## 4. Fesseln, Aufrichten, Ausbruch (BODENKAMPF + WAFFEN + ENGINE)
- **Aufrichten (Gegner):** Rolle `aufrichten` in der KI. Ein Kamerad geht hin, wenn er nicht unter direktem Feuer liegt,
  und hält `aufrichten` s. Ein Treffer unterbricht. Bark aus INHALT §7.4.
- **Fesseln durch Spieler:** E halten an einem bewusstlosen Gegner. **Durch Gegner:** Der Häscher (Profil §5) fesselt
  bewusstlose Spieler.
- **Gefangen → Ausbruch.** Bedingung (geprüft wie `updateSquadRecall`):
  - Alle verbundenen Außenteam-Spieler sind verwundet, bewusstlos oder gefesselt, mindestens einer ist gefesselt.
  - Die Karte hat `zelle` und `beute`.
  - Der Schritt erlaubt es (`ausbruch_erlaubt`, Standard `true`, im Tutorial `false`).
  - Es ist der erste Ausbruch in dieser Szene.

  Dann:
  1. Schnitt: Ereignis `gefangen`, ODA „Ihr kommt in einer Zelle zu euch.“
  2. Alle Spieler am `zelle`-Anker, Zelle `zu`, Zustand `gefangen` → `ok` mit voller Schild- und Wundenzahl, Waffe `faust`.
  3. Die eigenen Waffen liegen am nächsten `beute`-Anker: E halten → Waffe zurück.
  4. Die Zellentür öffnet sich von innen per E halten `ausbruchTuer` s. Das ist laut und alarmiert.
  5. Mission: Ereignis `teamGefangen`, Szenentyp C8 `ausbruch` greift über Bausteine.

  Sonst bzw. beim zweiten Mal: **Notrückholung** wie heute.

## 5. Gegner-KI-Profile (BODENKAMPF, `squad.js`)
Die Utility-KI (pin/flank/retreat/push/advance/idle) bleibt. Neu sind **Profile je Rolle** (Gewichte, Zusatzaktionen).
Funksätze stehen in INHALT §7.4 und kommen über die Gegner-Registry.

| Rolle | Verhalten (sichtbar) | Neue Aktionen |
|---|---|---|
| grundtyp | duckt sich, zieht sich bei schwachem Schild zurück | – |
| niederhalter | bleibt **stehen**, lange Stöße auf **eine** Deckung | Feuer auf die letzte bekannte Position ohne Sicht. Startet eine Flanke beim Truppkameraden |
| grenadier | hält Abstand, steht hinter den anderen | wirft auf Ziele **in Deckung**, meidet eigene Leute im Radius (absichtlich nicht perfekt: `fehlwurf`) |
| schuetze | sucht den `aussicht`-Anker bzw. den Deckungsplatz mit der längsten Sicht, steht still und lädt | weicht bei Nähe < `abstand` Kacheln zurück |
| enterer | läuft direkt und ohne Deckung auf den nächsten Spieler zu, oft zu zweit | Ausholen + Schlag, bevorzugt Engstellen |
| haescher | folgt dem Niederhalter, geht an Liegende heran | betäuben, fesseln |
| waechter | langsam, dreht sich zur Bedrohung | wie heute (Kustoden). Der Kastell-Automat ist gleich, mit Scutum-Optik |

- **Spawns** über `besetzen` (B1 §6.4): Trupps an `wache`-Ankern des Bereichs (`schwer` für Wächter). Ohne Bereich nimmt
  die Engine die `gefecht`-Plätze.
- **Rezepte** kommen aus der Fraktion (§7). `squadScale` skaliert wie heute (aufgerundet, min. 1).
- **Besetzungsregeln der Engine** (unabhängig vom LLM, INHALT §7.2):
  - Solo kein Häscher
  - höchstens 1 Enterer je Spieler
  - höchstens 3 Typen je Trupp
  - Ungesehene Rollen über die erste hinaus werden durch `grundtyp` ersetzt (Einführungsregel, protokolliert).
- Eine Rolle gilt als **gesehen**, sobald ein Gegner dieser Rolle für einen Spieler sichtbar war (`vis`). Das schreibt
  `crew.rollen_gesehen`.

## 6. Schleich-Grundstufe (BODENKAMPF)
- **Trupp-Haltung** `ruhig | wach` (heute `alert`). Der Start ergibt sich aus:
  - `besetzen.haltung`
  - Zustand `umkaempft`
  - Landepunkt-`alarm` (zweiter Besuch → `wach`, INHALT §7.3)
- **Ruhig:** 1 Trupp an `wache`-Ankern, die übrigen laufen `karte.patrouillen` (Tempo × 0,6). Wahrnehmung nur über Sicht
  (≤ 10, Sichtlinie, geduckt wie heute) und Lärm.
- **Alarm** bei Sicht auf einen Spieler, Lärm im Radius, Treffer oder einem gefundenen Liegenden:
  - **dieser Trupp** wird `wach`
  - nach `funkVerzoegerung` s alle Trupps im Umkreis `alarm.funk` Kacheln
  - Ereignis `alarm { map, trupp, x, y }`
  - Landepunkt `alarm = true` (Weltstand)
- Ohne neuen Kontakt `ruheNach` s → zurück zu `ruhig`. Der Landepunkt bleibt im Alarm, bis die Szene endet.
- Prüfungen für Missionen: `alarm { map }` (B1 §6.4), `trupp_ruhig { map, tag }`.

## 7. Fraktionen, Gegner-Registry, Spielleiter (KATALOG, SPIELLEITER, ENGINE)
- `content/katalog/gegner/<rolle>.json`:
  `{ format: "gegner/1", id, rolle, waffe, profil, namen: { germanen: "Bolzer", … }, funk: { … } }`.
  Funk aus INHALT §7.4. Zahlen stehen nur in `CONFIG.awayCombat.gegner`.
- `content/katalog/fraktionen/<id>.json`:
  `{ format: "fraktion/1", id, name, modelle: { <rolle>: "fig/…" }, palette, rezepte: { <name>: [{ rolle, n }] }, staerke: { klein: 1, mittel: 2, gross: 3 }, gross_extra: "posten", einsatz: { <rezept>: [kartenarten] }, funkstil }`.
- Fraktionen = Besitz-IDs, Rezepte laut INHALT §7.2:

  | Fraktion | Rezepte |
  |---|---|
  | `rostmeute` | rotte, enterrotte, soeldner, loesegeld, posten |
  | `kontor` | kontorwache, schiffswache |
  | `raubzug` | keil, jaeger, sturm |
  | `herrenlos` | kastellwache, torwache |
  | `kustoden` | waechter |

- Modelle:
  - `rostmeute`: grundtyp = Plünderer (`lerche/scavenger`), sonst `fig/germanen/<rolle>` mit Palette `friedlose`
  - `kontor`/`raubzug`: `fig/germanen/<rolle>` mit Palette `kontor` bzw. Clan-Palette
  - `herrenlos`: `actor/rom/waechter`
  - `kustoden`: heutiger Wächter
- Szenentyp `ausbruch` (C8): Umsetzung `ausbruch/zelle_und_kammer` (Start in `zelle`, Ziel `beute`, dann `abholpunkt`).
  Im Grobplan nur als Folge von `teamGefangen` (Verzweigung) bzw. als eigene Szene mit Startbedingung.
- **Besetzung im Grobplan:** `besetzung: [{ fraktion, staerke, haltung, neue_rolle? }]`. Der Spielleiter nennt keine
  Rollen außer höchstens einer `neue_rolle`.
- **Kontext:**
  - `fraktionen: [{ id, name, rezepte, rollen }]`
  - `rollen_gesehen`
  - `crew.bewaffnung: { waffe: anzahl }` (ohne Namen)
- **Prüfer-Codes:**

  | Code | Art | Regel |
  |---|---|---|
  | `GEGNER-TYP` | Fehler | unbekannte Rolle |
  | `FRAKTION` | Fehler | unbekannte Fraktion bzw. ohne Rezept für Kartenart oder Stärke |
  | `BESETZUNG-NEU` | Fehler, 1 Nachbesserung | mehr als eine ungesehene Rolle (die Engine ersetzt zur Laufzeit trotzdem) |
  | `BESETZUNG-SOLO` | Warnung | – |
  | `BESETZUNG-ENTERER` | Warnung | – |

## 8. Protokoll und Snapshot (ENGINE trägt ein, `VERSION: 7`)
| Was | Felder |
|---|---|
| cmd `loadout.waffe` | `{ waffe }` (an der Transfer-Konsole, nicht unten) |
| Halte-Interaktionen | über den bestehenden Hold-Mechanismus (`interact`), Kinds `fesseln`, `befreien`, `aufrichten`, `ausruestung`, `zellentuer` |
| Snapshot `players[]` | `wf` (Waffe), `ht` (Hitze 0–100), `ov` (1 = überhitzt), `ch` (Laden 0–100), `wu` (Ausholen 0–100), **`zs`**: `ok`\|`verwundet`\|`bewusstlos`\|`gefesselt`\|`gefangen` (getrennte Zustände, ART-PLAN §5.8), `bt` (1 = betäubt) |
| Snapshot `away.drones[]` | `ro` (Rolle), `fr` (Fraktion), `pa` (Palette), `wf`, `ch`, `wu`, `zs` (wie oben + `aus`), `bt`, `wn` (Wunden), `wm` (max), `gr` (`{ x, y, t }` Zielkreis beim Zielen) |
| Snapshot `away.projectiles[]` | `kind: 'granate'` mit `tx, ty, t, flug` |
| Snapshot `away` | `tr: [[trupp, 0/1]]` (Haltung je Trupp, nur bei `?debug=1` oder Captain-Scan) |
| Ereignisse (auch FX-Auslöser) | `ueberhitzt { id }`, `ladungLanze { id, x, y, tx, ty }`, `lanzeSchuss { id, x, y, tx, ty, stufe }`, `ausholen { id }`, `schlag { id, x, y, winkel }`, `granate { id, x, y, tx, ty, flug }`, `granateEinschlag { x, y }`, `betaeubt { id }`, `bewusstlos { id }`, `gefesselt { id, durch }`, `befreit { id }`, `aufgerichtet { id }`, `abgelenkt { id }`, `alarm { map, trupp, x, y }`, `gefangen { pids, zelle }`, `rolleNeu { rolle }`, `loadout { pid, waffe }` |
| Debug | `tune waffen.<waffe>.<wert>`, `waffe <id>` (eigene Waffe), `gegner <rolle> [fraktion]` (an der Mausposition), `alarm on/off`, `fang` (Gefangennahme auslösen) |

FX meldet seine Ereignisnamen vorab an die Studioleitung (ART-PLAN). Weichen sie ab, gilt diese Tabelle, und VOXEL bildet
sie ab.

## 9. Weltstand
`crew: { waffen: { <hash>: waffe }, rollen_gesehen: [rolle] }` (Block aus `CONTRACT-B1.md` §8, Inhaber WAFFEN/BODENKAMPF).

## 10. Art-API (Figuren, Waffen, FX; Inhalte in `ART-PLAN.md` §2/§4.3)
- **Figuren** `fig/<fraktion>/<rolle>`:
  - Rollen-IDs neutral: `grundtyp`, `niederhalter`, `grenadier`, `schuetze`, `enterer`, `haescher`. Erzeugt vom
    Figurenbaukasten (SYS-FIGUREN). In B nur `fig/germanen/*`.
  - Der Plünderer bleibt `lerche/scavenger`.
  - Kastell-Automat: `actor/rom/waechter` (Zustände). Kustoden-Wächter wie heute.
  - Parameter: `rank` 0/1 (1 = Häuptling), `role` (nur Plünderer). Die Besitz-Palette setzt der Client per
    `palette`-Override, **keine eigenen Figuren je Besitz**.
  - Sockets: `handR`, `handL`, `back`, `label`, `head_top` (Betäubungskranz), `wrists` (Fesseln), `fx_spark`.
  - Posen (Voxelwerk `assets/poses/human.json`, ART-POSEN), dazu die bestehenden:

    | Pose | Zustand bzw. Aktion |
    |---|---|
    | `aim_rifle` | Sturmgewehr, Betäuber |
    | `aim_heavy` | Granatwerfer |
    | `charge` | Lanze |
    | `launch` | Wurf |
    | `windup` | Ausholen |
    | `strike` | Schlag |
    | `stagger` | betäubt |
    | `unconscious` | bewusstlos (≠ `wounded`) |
    | `bound` | gefesselt |
    | `carried` | – |
    | `lift_comrade` | aufrichten |

- **Waffen** `item/waffe/<typ>` (`<typ>`: `blaster`, `sturmgewehr`, `granatwerfer`, `lanze`, `nahkampf`, `betaeuber`,
  `pistole`):
  - Parameter `bauweise` (`germanen`, `rom`, `rostmeute`, `neutral`), `heat` 0–3.
  - Die Bauweise wählt das Spiel aus der Fraktion der Figur. Spieler bekommen `rom` (Lerche).
  - Sockets: `grip` (= Anker an `handR`), `muzzle`, `vent`, `charge` (nur Lanze), `blade_tip` (nur Nahkampf).
  - Die Silhouette je Typ ist fest (Längen laut ART-PLAN), die Bauweise ändert nie Länge und Grundform.
  - `faust` hat kein Modell.
- **FX** (Team FX, `public/js/voxel/fx.js`):
  - `spawnFx`-Typen laut ART-PLAN (`lance_charge`, `lance_beam`, `grenade_arc`, `grenade_blast`, `stun_cloud`, `stun`,
    `heat_vent`, `overheat`, `windup`, `slash` …), ausgelöst durch die Ereignisse §8.
  - Lanzenleuchten + Zielstrahl **am Ziel**, Granatkreis für alle sichtbar.
  - Partikelbudget M4 §3.5.
- **Icons** (UI-ART, `public/js/icons-b.js`): Waffen ×7, Zustände (betäubt, bewusstlos, gefesselt, gefangen, überhitzt) im
  Format von `ICONS` aus `art.js`.
- **Audio** (AUDIO):

  | Gruppe | Töne |
  |---|---|
  | Waffen | `sturmgewehr`, `granate_abschuss`, `granate_einschlag`, `lanze_laden`, `lanze_schuss`, `nahkampf_hieb`, `betaeuber` |
  | Hitze | `ueberhitzt`, `abgekuehlt` |
  | Zustände | `fesseln`, `befreit`, `alarm`, `zellentuer` |

  Vor `init()` sind alle Töne No-op.

## 11. Abnahme B2 (QA-ABNAHME-B2, dazu ein Spieleabend mit Kai)
1. Spieler und Gegner nutzen dieselben Waffen nach denselben Regeln, an je einem Beispiel gezeigt (Test + Browser):
   - Hitze
   - Laden mit Abbruch
   - Nahkampf gegen Frontschild
   - Sturmgewehr setzt Schildladen zurück
2. Waffenwahl am Transporter bleibt über Beenden und Laden erhalten (Hash, kein Name im Weltstand).
3. In einem gemischten Gefecht **beschreiben Tester die Rolle jedes Gegnertyps, ohne Erklärung**. Das prüfen Kai bzw.
   menschliche Tester am Spieleabend. QA-Agenten liefern die Vorbereitung (Direktstart mit Rezepten, Aufnahme) und die
   Vorstufe aus ART-PLAN (Silhouettenbogen).
4. Nahkampf, Betäubung und Wunden funktionieren für beide Seiten, auch Friendly Fire beim Granatwerfer. Dazu gehören
   Fesseln, Aufrichten und ein Ausbruch (gefangen → Zelle → Ausrüstung → Abholpunkt) sowie die Notrückholung als Rückfall.
5. Schleichen: Ein Ziel lässt sich mit leisen Waffen ohne Alarm erreichen, ein lauter Schuss alarmiert messbar.
6. Golden-Ablauf §0 dokumentiert, `npm test` grün, Snapshot < 13 KB (Messung §0), README-Abschnitt „B2 Bodenkampf“.
