# CONTRACT-B3 – Sektorkarte: Hexfeld statt Punktnetz

Ergänzung zu `CONTRACT-B1.md`. **Teams, Welle 0, Ports, Weltstand v3, Protokoll-Regeln und Berichtspflicht stehen in
`CONTRACT-B1.md` §1, §8, §9, §13 und gelten hier.** Vorhandene Feldnamen und die API von `shared/locations.js` werden
nicht gebrochen. Bei Widerspruch gilt der Code. Abweichungen gehen an die Studioleitung (SendMessage „main“).
**B3 ist als erste Teilstufe abnehmbar** und hängt nur an SEKTOR, KARTE, ENGINE (Weltstand/Protokoll) und UI-ART (Sektor-Icons, `public/js/icons-b.js`).

Grundlagen:
- Briefing §4.8/§4.9
- Entscheidungen 29–33
- Vault `Welt/Karte Limes.md`, `Mechanik/Sektoren & Sprünge.md`
- `concept/buehnen/gamedesign.md` §8, `techlead.md` §6

## 0. Ziel und Entscheidungen

**Ziel.** Die Crew navigiert auf einer **Hex-Sektorkarte** (Karte Limes, 10×8). Ein Hex ist ein Sektor und damit eine
Raumszene. Die **ganze Karte ist sichtbar, spielbar ist nur der Saumraum**.

**Verbindlich:**
1. **Ein Hex = ein Sektor = eine Raumszene**, Koordinate `SSZZ` (Spalte, Zeile; z. B. `0206`).
2. **Normale Sprungpunkte an Hexkanten**, nur ins Nachbarhex, nicht jede Kante offen. Im freien Spiel muss man den
   Sprungpunkt in der Raumszene **anfliegen** (E29).
3. **Fernsprungpunkte** über mehrere Hexe. In B3 sind alle gesperrt (Relais → Eridu).
4. **Leerraum** (Hex ohne System) ist eine Barriere. Hinein kommt man nur über temporäre Sprungpunkte oder einen
   Notfallsprung. Leerraum ist eine **leere Szene aus Daten** (E30).
5. **Notfallsprung:**
   - zufällige Kante, bevorzugt in Flugrichtung
   - **nur in spielbare Hexe** (Saumraum + Leerraum)
   - Reaktor überladen (danach Neustart)
   - **ein zweiter Notfallsprung nach dem Reaktor-Neustart** ist der Ausweg (kein Softlock, E30)
6. **Erkundung:** Unerkundete Hexe zeigen nur den Umriss. Bojen markieren Sprungpunkte, der Weitscan findet sie. Der
   Erkundungsstand steht im Weltstand.
7. **Quelle der Karte:** `content/welt/limes.json` im Repo. `karte_limes.py` im Vault bleibt der Entwurf (E31).
8. **Saumraum-Kanten:** Bis auf eine bleiben alle wie heute. **`nebel–wrack` entfällt, `b7–wrack` kommt dazu.** Der
   Wrack-Abstecher in m2 kostet einen Sprung mehr (E32).
9. **Rostnest (0107)** ist in B3 nicht anfliegbar. Die Kante Vaelen → Rostnest bleibt `hidden` und wird nicht
   aufgedeckt. Landepunkte dort erst, wenn der Spielleiter es in einem späteren Paket freischaltet (E33).

### 0.1 Tutorial-Schutz (E29)
- **Faltsprung von überall in m1–m3:** Solange das Tutorial läuft (`weltstand.tutorial` nicht erledigt; Direktstart m1–m3;
  Golden-Läufe), gilt die heutige Sprungregel. Das heißt: Ziel ist ein bekannter Nachbar und der Abstand zur Station
  ≥ 300. **Kein Anflug.**
- Erst danach bzw. in der Kampagne ohne Tutorial gilt die Anflugpflicht.
- Schalter `CONFIG.sektoren.tutorialFrei` und `sprung.anflugPflicht(game)`.
- `locations.js` behält `LOCATIONS`, `LOCKED_LINKS`, `get`, `linkKey`, `lockedKey`, `totalHidden`, `START`,
  `KNOWN_AT_START`. Die `links` werden aus `limes.json` abgeleitet.

**Nicht in B3:**
- Raumszenen außerhalb des Saumraums (gesperrte Hexe brauchen keine)
- Langstreckensprung (Hyperraum)
- Patrouillen, die sich am Netz bewegen
- Freischalten von Rostnest und Fernsprung
- neue Raumkampf-Regeln

**Nicht brechen:**
- alles aus `CONTRACT-B1.md` §0
- **Golden m1–m3**:
  - ohne Allow-Liste grün
  - Weicht der Wrack-Abstecher der Bots ab (Kantenänderung), dann mit `tools/fixtures/golden/allow-b3.json` (nur
    Sprungfolge Wrack, im Bericht begründet)
- Weltstände v1/v2 laden (Orte → Hexe, §5)
- Snapshot < 13 KB. Die Sektorkarte geht nur im `welcome` mit (≈ 6 KB), nie im Snapshot.

## 1. Dateibesitz und Wellen
| Welle | Team | Dateien |
|---|---|---|
| 0 | Studioleitung | Startwerte §1.1, Schnitt `space.js` → `server/sim/sprung.js` (wörtlich), Stubs `public/js/starmap.js`, `public/js/icons-b.js`, `tools/check-sektoren.js` (übernimmt den Orte-Block aus `tools/check-maps.js`), Hooks in `render.js`/`consoles.js`/`index.html` (`CONTRACT-B1.md` §1.2) |
| 1 | **SEKTOR** | `content/welt/limes.json`, **neu** `shared/sektoren.js`, `shared/locations.js`, `server/sim/{explore,sprung}.js`, `tools/{check-sektoren,test-sektoren}.js` |
| 1 | **KARTE** | `public/js/starmap.js` (Sternkarte als Hexfeld, Klick-Auswahl, Bojen-Marker in der Raumszene) |
| 0–1 | **UI-ART** (laut `ART-PLAN.md`) | `public/js/icons-b.js` (Hex-Symbole, Einflüsse, Bojen-Sprite als Daten/Zeichenfunktionen im Format von `ICONS`), `concept/buehnen/STILBLATT-SEKTOR.md` |
| 1 | **ENGINE** | Weltstand v3 `welt.sektoren` + Migration, Protokoll §6, Bausteine `server/mission/bausteine/sektor.js`, Prüfer-Codes §7, `cmd helm.notsprung` in `game.js` |
| 4 | **QA-ABNAHME-B3** | §8, startet, sobald SEKTOR, KARTE, UI-ART (Sektor-Icons) und ENGINE (Sektoranteil) gemeldet haben |

CLIENT, BOTS und SPIELLEITER müssen für B3 nichts liefern. Der Hinweis „Sprungpunkt anfliegen“ läuft über das bestehende
`ship.jump.blockedReason`. BOTS passen in Welle 3 die Reisen an (`sim-headless.js`: Anflug, neue Wrack-Kante).

### 1.1 Startwerte `shared/config.js` (Welle 0, Block `sektoren`)
```js
sektoren: {
  tutorialFrei: true,              // E29: Faltsprung von überall, solange das Tutorial läuft
  sprungpunktRadius: 250,          // px: so nah muss die Lerche am Sprungpunkt sein, damit der Antrieb lädt
  randAbstand: 180,                // px: Lage des Sprungpunkts vor dem Szenenrand in Kantenrichtung
  weitscanBoje: 1400,              // px: Weitscan findet unbekannte Bojen in dieser Entfernung
  notsprung: { huelle: 15, reaktor: 'offline', richtung: 3, streuung: 0.35, sperreAuftrag: false },
  leerraumSzene: { w: 2400, h: 1800, asteroids: 0 },
},
```

## 2. Daten – `content/welt/limes.json`
Einmalig aus `karte_limes.py` konvertiert. Ab dann ist diese Datei die Quelle.
```json
{ "format": "sektorkarte/1", "id": "limes", "spalten": 10, "zeilen": 8,
  "hexe": { "0206": { "name": "Lichtkordon", "fraktion": "saum", "art": "Heimathafen, Konkordat", "hafen": "C",
                      "einfluss": "", "symbole": ["home"], "region": "saumraum", "spielbar": true, "ort": "hafen" },
            "0107": { "name": "Rostnest", "fraktion": "pirat", "region": "saumraum", "spielbar": false, "verborgen": true } },
  "kanten": [ { "a": "0206", "b": "0306", "art": "open" }, { "a": "0206", "b": "0205", "art": "locked", "key": "kesh" },
              { "a": "0207", "b": "0107", "art": "hidden" }, { "a": "0308", "b": "0508", "art": "far", "key": "massartu" } ],
  "praesenz": { "rostmeute": ["0306", "0405", "0205"], "kontor": ["0206", "0207"], "raubzug": ["0307", "0306", "0405"] },
  "regionen": { "saumraum": { "name": "Saumraum", "sperrtext": null },
                "imperium": { "name": "Imperium", "sperrtext": "Grenzposten Statio Limitis: Durchflug gesperrt." } } }
```
- `spielbar` (verbindlich):

  | Hexe | Wert |
  |---|---|
  | 0205, 0206, 0207, 0306, 0307, 0308, 0405, 0406 | `true` |
  | Rostnest 0107 | `false` |
  | alle anderen Systeme | `false` |
  | Leerraum (Felder ohne Eintrag) | spielbar, nur als leere Szene |

- `ort` verbindet das Hex mit der Ort-ID aus `locations.js` (`hafen`, `splitter`, `b7`, `vaelen`, `wrack`, `nebel`,
  `relais`, `kesh`).
- `praesenz` gehört inhaltlich dem Lead GD (`INHALT.md`) und wird vom Prüfer genutzt (`BESITZ-REGION`, `CONTRACT-B1.md` §11.3).
- Kanten-ID: `"<a>-<b>"` mit den Hex-Codes aufsteigend sortiert.
- `tools/check-sektoren.js` (SEKTOR):
  - jede Nicht-`far`-Kante verbindet Nachbarn
  - alle Saumraum-Orte erreichbar mit `open` + `locked:kesh` + `locked:nebel-relais`
  - Eisenwald vor dem Meilenstein unerreichbar (Prüfungen aus dem Python-Skript)
  - Orte-Block aus `check-maps` (symmetrisch, Verstecke, Kesh-Sperre)
  - SVG-Ausgabe mit `--svg <datei>`

## 3. `shared/sektoren.js` (UMD, reine Funktionen)
Exporte:
- `KARTE` (Daten, im Browser aus `welcome`, in Node per `require`)
- `nachbarn(hex)` (Formel aus `karte_limes.py`: flache Hexe, ungerade Spalten oben)
- `kanteId(a, b)`
- `kante(a, b)`
- `kantenVon(hex)`
- `richtung(a, b)` 0–5 (0 = Nord, im Uhrzeigersinn)
- `winkel(richtung)` (Szenen-Winkel, Bug rechts = 0)
- `hexZuPixel(hex, s)`
- `pixelZuHex(x, y, s)`
- `istLeerraum(hex)`
- `spielbar(hex)`
- `hexVonOrt(id)`, `ortVonHex(hex)`
- `leerraumOrt(hex)`: liefert ein Orts-Objekt `{ id: 'leer-<hex>', name: 'Leerraum <hex>', kind: 'void', scene: leerraumSzene, hidden: [] }`

`locations.js` nutzt es, damit `Locations.get('leer-0305')` funktioniert.

## 4. Sprungregeln (SEKTOR, `server/sim/sprung.js`, `explore.js`)
- **Ziel wählen** (`selectDest`, Captain an der Sternkarte):
  - Ziel ist ein Nachbarhex über eine **bekannte, offene** Kante oder eine offene temporäre Kante.
  - Gesperrte Kante → Begründung (`sperrtext` der Region bzw. „Sprungpunkt gesperrt“).
  - Ziel nicht spielbar → „Sektor gesperrt“.
  - Im Tutorial-Modus wie heute (Ort-Links).
- **Sprungpunkt:** Jede Kante hat in der Szene einen Punkt am Rand in Kantenrichtung (`randAbstand`). Anfliegen heißt:
  Abstand ≤ `sprungpunktRadius`. Sonst ist der Grund „Sprungpunkt <Nachbar> anfliegen (<d> m)“, und der Antrieb lädt
  nicht. Die übrigen Gründe bleiben wie heute (Station, Antrieb, Außenteam, Störsender).
- **Ankunft:** im Ziel am Sprungpunkt der Gegenkante, Blick in Flugrichtung. Ohne Gegenkante (Notfallsprung) zufällig
  im mittleren Drittel. Für Tutorial-Bücher bleibt `scene.arrive`.
- **Bojen und Erkundung:**
  - Eine Boje (Kante) ist **bekannt**, wenn beide Hexe bekannt sind und die Kante `open` oder `locked` ist (das entspricht
    der heutigen Sichtbarkeit der Links). Außerdem wird sie bekannt durch Weitscan im Umkreis `weitscanBoje`, durch
    Durchfliegen oder durch den Baustein `boje_aufdecken`.
  - `hidden`-Kanten sind nur per Baustein aufdeckbar, in B3 nie.
  - Ein Hex ist **erkundet**, sobald es besucht wurde.
- **Temporäre Sprungpunkte:** Baustein `sprungpunkt_oeffnen { von, nach, temp: true, bis: 'mission'|'immer' }`. Erlaubt
  ist nur eine Nachbarkante zwischen spielbaren Hexen bzw. in den Leerraum. Schließen mit `sprungpunkt_schliessen`
  bzw. automatisch bei Missionsende.
- **Notfallsprung** (cmd `helm.notsprung`, Pilot oder Captain):
  - **Voraussetzungen:**
    - Reaktor `ok` (bzw. nicht `offline`/`broken`)
    - nicht angedockt
    - kein Außenteam unten
    - kein Transfer läuft
  - **Wirkung:**
    1. Kandidaten = spielbare Nachbarhexe inkl. Leerraum.
    2. Gewicht = 1 + `richtung` × max(0, cos(Winkel zwischen Kurs und Kantenrichtung)).
    3. Auswahl über `game.rng` (deterministisch).
    4. Reaktor `offline` (Neustart über die vorhandene Schaltermechanik).
    5. Hülle −`huelle`.
    6. Ereignis `notsprung { von, nach }`.
  - Gibt es keinen Kandidaten, landet die Lerche im selben Hex an anderer Stelle.
  - Im Leerraum ist der Notfallsprung (nach dem Reaktor-Neustart) **immer** möglich. Das ist der garantierte Ausweg.
  - Laufende Missionsschritte erhalten `missionEvent('notsprung')`. Bücher dürfen ihn per `destBlocked`-Logik nicht
    verbieten, sondern nur Folgen erzählen.

## 5. Weltstand (ENGINE + SEKTOR)
- `welt.sektoren: { erkundet: [hex], bojen: [kantenId], temp: [{ id, a, b, bis }], offen: [kantenId] }`. Das ist der
  Block aus `CONTRACT-B1.md` §8, `toSave/restore` in `explore.js`/`sprung.js`.
- **Migration v2 → v3:**
  - `erkundet` = Hexe aller `orte.besucht`
  - `bojen` = alle `open`/`locked`-Kanten zwischen zwei bekannten Orten
  - `offen` = Kanten zu den Schlüsseln aus `verbindungen_offen`
  - `orte.*` bleibt (Altfelder, weiter gepflegt)
- Die Position der Lerche bleibt `ship.scene` (Ort-ID bzw. `leer-<hex>`). Speichern ist nur angedockt möglich (wie
  heute). Im Leerraum gibt es also keinen Speicherstand.

## 6. Protokoll und Snapshot (ENGINE trägt ein, `VERSION: 7`)
| Was | Felder |
|---|---|
| `welcome` | `sektorkarte` (Inhalt von `limes.json` ohne `praesenz`, ≈ 6 KB) |
| Snapshot `world.sektoren` | `{ e: [hex], b: [kantenId], t: [kantenId], o: [kantenId], v }`. Nur wenn sich `v` ändert, sonst nicht enthalten (wie `world.locations`) |
| Snapshot `space.jp` | `[{ k: kantenId, x, y, z: 'aktiv'\|'gesperrt'\|'temporaer'\|'ohne_strom', n: zielHex }]` (nur bekannte Bojen der Szene, ≤ 6) |
| Snapshot `ship.jump` | zusätzlich `jp` (Kante des gewählten Ziels), `d` (Abstand in m, gerundet) |
| cmd `helm.notsprung` | `{}` |
| cmd `captain.selectDest` | `{ dest }` wie heute (Ort-ID oder `leer-<hex>`); zusätzlich `{ hex }` erlaubt |
| Ereignisse | `notsprung { von, nach }`, `bojeGefunden { kante }`, `hexErkundet { hex }`, `sprungpunktOffen { kante, temp }`, `sprungpunktZu { kante }` |
| Debug | `hex <SSZZ>` (dorthin versetzen, nur spielbar), `boje <kante>`, `notsprung`, `erkunde alle` |

## 7. Bausteine und Prüfer (ENGINE)
**Bausteine** in `server/mission/bausteine/sektor.js`:

| Baustein | Art | Parameter |
|---|---|---|
| `sprungpunkt_oeffnen` | Aktion | `von, nach, temp, bis` |
| `sprungpunkt_schliessen` | Aktion | `kante` |
| `boje_aufdecken` | Aktion | `kante` |
| `im_hex` | Prüfung | `hex` |
| `sprungpunkt_erreicht` | Prüfung | `kante` (Lerche im Radius) |
| `notgesprungen` | Prüfung | – |

`reveal_location` und `atLocation` bleiben. **Prüfer-Codes:**

| Code | Art | Regel |
|---|---|---|
| `SPRUNG-KANTE` | Fehler | Kante gibt es nicht bzw. die Hexe sind keine Nachbarn |
| `HEX-UNSPIELBAR` | Fehler | Szene oder Ziel in einem nicht spielbaren Hex, z. B. Rostnest |
| `SPRUNG-HIDDEN` | Warnung | ein Buch deckt eine `hidden`-Kante auf |

## 8. Darstellung (KARTE, UI-ART)
- **Sternkarte** (`StarMap.draw(ctx, view, rect, opts)`, `StarMap.hit(x, y) → { hex } | null`): Hexraster 10×8 mit
  Koordinate und Name (Rostnest: „?“).
  - Farbe der Fraktion (Palette aus dem Python-Entwurf bzw. ART-PLAN).
  - Hafenklasse, Symbole, dominanter Einfluss.
  - Kanten:

    | Art | Darstellung |
    |---|---|
    | offen | gelb |
    | gesperrt | rot gestrichelt |
    | temporär | eigene Farbe |
    | Fernsprung | Bogen, gesperrt |
    | verborgen | nicht gezeigt |

    Die Bojen-Zustände (aktiv, gesperrt, temporär, ohne Strom) sitzen an der Kante.
  - Hex-Status:
    - **unerkundet** = Umriss + Name, gedimmt
    - **nicht spielbar** = schraffiert, Region mit `sperrtext` beim Überfahren
    - **Leerraum** = dunkel
  - Markiert werden die eigene Position, das gewählte Ziel und die Route über bekannte Kanten.
  - Lesbar auf der Captain-Konsole und auf dem HUD-Kartenausschnitt. Beide nutzen dieselbe Funktion mit `opts.kompakt`.
- **Raumszene:** `StarMap.drawSzene(ctx, cam, snap)` zeichnet die Bojen aus `space.jp` (Zustandsfarbe, Name des Zielhexes,
  Radius-Ring, solange das Ziel gewählt ist). `render.js` ruft es über den Welle-0-Hook.
- **UI-ART** (`public/js/icons-b.js`, Stil nach `concept/buehnen/STILBLATT-SEKTOR.md`), Format wie `ICONS` in `art.js`:
  - `IconsB.hex.<id>` für die Hex-Symbole (hafen, gasriese, ruine, piraten, asteroiden, nebel, boje, heimat, schrein,
    festung, wrack)
  - `IconsB.einfluss.<id>` (8 Einflüsse)
  - `IconsB.boje(ctx, zustand, x, y, s, winkel)` (aktiv, gesperrt, temporär, ohne Strom)
  - Fraktionsfarben im Stilblatt

  Fehlt ein Eintrag, zeichnet KARTE einen einfachen Ersatz.

## 9. Abnahme B3 (QA-ABNAHME-B3)
1. Springen nur über offene Kanten (Test + Browser). Ein gesperrtes Hex zeigt seine Begründung. **Im freien Spiel muss
   der Sprungpunkt angeflogen werden.** Im Tutorial wird von überall gesprungen.
2. Leerraum ist ohne temporären Sprungpunkt nicht erreichbar. Der Notfallsprung landet im Nachbarhex (nur spielbar) und
   aus dem Leerraum führt der zweite Notfallsprung nach dem Reaktor-Neustart wieder hinaus. Gezeigt mit
   Seeds/Wiederholungen.
3. Der Erkundungsstand (erkundete Hexe, gefundene Bojen, temporäre Kanten) überlebt Speichern und Laden. Alte Weltstände
   (v1/v2) laden mit sinnvollem Erkundungsstand.
4. **Das Tutorial läuft auf den Saumraum-Hexen wie heute:** Golden m1–m3 grün (ggf. mit `allow-b3.json` für die
   Wrack-Kante, begründet). m2 wird einmal im Browser mit dem Wrack-Abstecher gespielt.
5. Ganze Karte Limes sichtbar (Screenshot), nur der Saumraum spielbar, Rostnest nicht anfliegbar.
   `npm run check` (inkl. `check-sektoren`) und `npm test` grün. README-Abschnitt „B3 Sektorkarte“.
