# CONCEPT-ITM02-MODELLE – Voxel-Modelle der Fallen (ITM-02, Lastenheft)

Stand: ITM-01 E (Branch `itm01-e`). Für den Sparringspartner: daraus wird der Vault-Auftrag ITM-02. **Das Spiel ist vorbereitet, ITM-02 liefert nur Modelle und Manifest-Einträge** (Voxelwerk-Repo, Spiel-Repo: Manifest, ein Zeilen-Austausch je Bauweise, keine Codeänderung nötig).
Belege: `C:\Users\Luciu\projects\voxelwerk\ANKER-VERDRAHTUNG-ORT01.md`, `public/js/voxel/kit.js` (`propEintrag`, `propParams`, `ankerNeu`), `public/js/voxel/kit-regeln.js` (`ankerEintragVon`), `shared/buehne.js` (`ankerBlockiert`, `silhouetteFehler`), `CONTRACT-B2.md` §12 und §13.

## 0. Was heute schon steht (Rückfall, damit nichts leer bleibt)
- Rolle `falle` (`content/buehnen/anker.json`): Zustände in dieser Reihenfolge, **die Reihenfolge ist der Modell-`state`:** `0 verborgen, 1 erkannt, 2 entschaerft, 3 ausgeloest`. Attribute `typ` (`schott|druck|schuss`) und `sicht`.
- Alle fünf Bauweisen (`germanen`, `germanen_halle_holz`, `germanen_halle_stein`, `rom`, `rom_feld`) haben eine Zeile `anker.falle` mit `schott`, `druck`, `schuss`, `*` auf **vorhandene** Props (Rückfall, siehe §4). Der Rückfall ignoriert `state`; die Zeile bleibt, nur die ID wird getauscht.
- Der Client zeichnet **unabhängig vom Modell** (Sicherheitsnetz, bleibt auch mit Modell): Warndreieck über der erkannten Falle (schwebt, `render.js drawFalleMarke`), Kreuz am Boden bei ausgelöst, graues Dreieck bei entschärft, das **Gefahrenfeld** (Druck) als rotes, gestricheltes, schraffiertes Boden-Overlay (`drawFallenFelder`), den Schuss-Strahl und die Restzeit-Zeilen. Ein Modell muss nichts davon nachbauen.
- Kein Modell zeigt je `state 0`: verborgene Fallen stehen nicht in der Client-Ankerliste. Eine enthüllte Falle ist mindestens `erkannt`. `state 0` trotzdem liefern (siehe §2), weil Server und Weltstand ihn kennen (Debug `anker`, Bausteine).
- Spät enthüllte Fallen (Ereignis `ankerEnthuellt`) bekommen ihr Prop im laufenden Voxel-Bild (`kit.js handle.ankerNeu`), die Modelle aller Typ-Zeilen werden beim Kartenbau vorgeladen.

## 1. Wie ein Anker zum Modell wird
`content/buehnen/bauweisen/<bw>.json → anker.falle[ typ | art | '*' ]` – **Reihenfolge der Auflösung: Zeile des Typs, dann Zeile der Kartenart (`aussenposten`, `station`, `ruine`, `schiff`, …), dann `*`** (neu in ITM-01 E, nur für die Falle; `kit-regeln.js ankerEintragVon`). Wert: String (ID) oder `{ "id": …, <feste Parameter>, "dreh": Grad, "versatz": [x, z] }`.
Der Prop bekommt die Parameter `state` (Index in `anker.json → rollen.falle.zustaende`), `zustand` (Kit-Zustand intakt/verfallen/umkämpft), `art`, `seed` und die festen Parameter der Zeile; **Parameter, die das Manifest nicht deklariert, verwirft der Loader** (ein Modell ohne `state` bleibt gültig). Manifest-Footprint > 1 versetzt in die Blockmitte (nicht für die Anlage, siehe §2). Die Drehung ist die freie Nachbarkachel (`facing`), mit `dreh` fest.
Modelle liegen als JSON im Voxelwerk (`assets/models/ort/<bw>/gemein/…`), Sync mit `npm run assets` im Spiel-Repo, Manifest `assets/manifest/ort-<paket>.json`.

## 2. Modelle (je Bauweise `germanen` und `rom`: 3 Stück, 6 insgesamt)
Maße: 1 Kachel = 1 m, Pivot Mitte unten, Vorderseite +z, `jitter: 0`, Zustandslogik nur über `state` (wie ORT-01).

| ID (Vorschlag) | Typ | Zweck | Fuß | Höhe | Kollision | Budget (Dreiecke, größter Zustand) |
|---|---|---|---|---|---|---|
| `ort/<bw>/gemein/falle_schott` | `schott` | Bodenplatte mit Sensorkern („Schottsensor“) | 1×1 | ≤ 0,15 m (flach) | **keine** (begehbar) | ≤ 600 |
| `ort/<bw>/gemein/falle_druck` | `druck` | Bodenventil/Luftgitter („Druckventil“), kein Hindernis | 1×1 | ≤ 0,25 m | **keine** | ≤ 800 |
| `ort/<bw>/gemein/falle_schuss` | `schuss` | Selbstschussanlage: Sockel, Drehkopf, Rohr | **1×1, nichts ragt über den Kachelrand** | **≤ 1,3 m** (Empfehlung, siehe unten) | **ganze Kachel**, auch nach dem Entschärfen | ≤ 1 500 |

Zum Vergleich (ORT-01): Beute-Kapsel 630–830, Sprengpunkt Außenposten 730–830, Ziel 800–1 310, Zelle 1 430–1 740, Terminal 1 370–2 100.

**Schott-Kanten:** haben schon ein eigenes Kit (`kits.schott` → `kit/<bw>/schott`, Zustände `zu, offen, gehackt, verschlossen` über `ko`); eine Schottfalle schließt vorhandene Kanten mit dem Zustand `zu`, es gibt **kein** Falle-spezifisches Schott-Modell. Die Falle braucht nur den Sensor (`falle_schott`). Fehlt dem Ort ein Schott im Radius 3, ist die Falle wirkungslos (Prüfer-Warnung `K-FALLE`).
**Spätere Gefahrenfelder (`dorn`, `kabel`)** sind reine Feld-Varianten: Config-Eintrag unter `CONFIG.anker.falle.feld.<typ>`, Typ in `anker.json`, Datenblatt in `content/scanner/datenblaetter.json`, Name in `render.js FELD_NAME`, optional Farbe in `FELD_RGB` (Standard Rot; `kabel` nicht Eisblau, das gehört dem Scanner). **Kein Modell nötig**, die `*`-Zeile gilt; wer ein Prop will, trägt `anker.falle.dorn` ein.

### Fuß, Höhe, Sicht (aus Config und Code abgeleitet)
- Kachel 32 px, Hitbox der Figur 18×12 px: die Figur kann der Anlagenmitte nicht näher kommen als **25 px (x) / 22 px (y)**. Die Box ist die ganze Kachel (`CONFIG.anker.falle.blockiert = { schuss: true }`, Regel `Buehne.ankerBlockiert`, Server `interior.awaySolid`, Client-Vorhersage `Render.buehneBewegungSolid`).
- Auslösezone `radius.schuss` = 0,9 Kachel (28,8 px) liegt knapp **vor** der Box: Berühren löst aus. Entschärfen (E halten, 3 s) geht aus der **Nachbarkachel** bei 29 bis 48 px Abstand zur Mitte. **Das Modell darf diese Nachbarkachel und die Figur dort nicht verdecken:** Fuß ≤ 1×1, kein Rohr/Kabel über den Kachelrand, bei Kamera-Neigung 57° (FOV 30) verdeckt ein Modell der Höhe h etwa h / tan 57° ≈ 0,65·h Meter Boden **nördlich** davon: bei 1,3 m rund 0,85 Kacheln, bei 2 m die ganze nördliche Nachbarkachel. Darum Höhe ≤ 1,3 m; wer höher will, braucht die Hüllen-Mechanik (Kai-Frage 1).
- **`K-SILHOUETTE`** (`shared/buehne.js silhouetteFehler`): begehbare Fallen (`schott`, `druck`, unbekannte Typen) dürfen nicht höher als die Figur (1,94 m) sein, man liefe sichtbar hindurch. **Die blockende Anlage (`schuss`) ist seit ITM-01 E ausgenommen** (jeder Typ in `CONFIG.anker.falle.blockiert`), ein hohes Modell wird dort nicht gemeldet. Test: `node tools/test-fallen-client.js` (Abschnitt Rückfall-Kits).
- Begehbar heißt flach: keine Sockel, Pilze oder Ventilkörper über Fußhöhe. (Pantheon-Regel: alles Gegenständliche braucht eine Kollisionsbox, reine Optik nicht.)

### States 0..3 (in dieser Reihenfolge, je Modell)
| state | Name | `falle_schott` | `falle_druck` | `falle_schuss` |
|---|---|---|---|---|
| 0 | verborgen (wird im Client nie gezeigt) | Platte bündig, ohne Kern | Gitter geschlossen, bündig | Deckel zu, Kopf eingefahren, Höhe ≤ 0,1 m |
| 1 | erkannt | Kern leuchtet (Warnrot, `emit`), Rand gelb-schwarz | Ventil gewölbt, rote Markierung am Rand | Kopf ausgefahren, Rohr nach vorn, rotes Auge an (`emit`) |
| 2 | entschärft | Kern dunkel, Abdeckung abgenommen/entriegelt | Ventil verriegelt, Markierung grau | Kopf gesenkt, Rohr nach unten, Auge aus, Kabel hängen |
| 3 | ausgelöst | Kern ausgebrannt, Platte verzogen | Ventil offen, Dampfwölkchen (Voxel, ≤ 0,4 m) | Mündung glüht schwach, Lauf geschwärzt, Auge aus (der Zustand bleibt dauerhaft, die Anlage steht weiter und blockiert) |

`emit`-Flächen nur für Warnfarben (Rot = Gefahr/Waffen; am Boden ist Bernstein Hitze, Eisblau Scanner; siehe Projektsteckbrief). Kein State darf eine Fläche von mehr als 1×1 beanspruchen.

## 3. Bauweisen und Lücken
- **germanen** (`nord`), **rom** (`rom`); die Varianten `germanen_halle_holz`, `germanen_halle_stein` (= germanen) und `rom_feld` (= rom) erhalten dieselben Zeilen, die Einträge stehen heute schon in allen fünf Dateien.
- Orte-Sperre (`tools/orte-sperre.mjs`): Station und Außenposten dürfen keine `…/ruine/…`-Modelle auflösen. Seit ITM-01 E prüft die Sperre für die Falle **alle Zeilen** der Tabelle (jede ist je nach Typ für jede Kartenart erreichbar). Neue Modelle unter `ort/<bw>/gemein/…` sind unkritisch.
- **Lücken Rom:** keine Schiffs-Bauweise (`stimmung.schiff` fehlt, auch `lift` und `leiter` haben keine Rom-Zeile): die Falle hat dort nur die `*`-Zeile, ein Rom-Schiff mit Fallen gibt es in ITM-01 nicht (Generatoren setzen noch keine Fallen). Rom hat keine flache Boden-Markierung im Bestand (der Rückfall nimmt `bake` und `verteiler`, beide stehende Gegenstände, siehe §4). `anker.flagge`, `lift`, `leiter`, `aussicht` haben ebenfalls keine Rom-Zeilen (nicht Teil von ITM-02).
- `rom_feld`/`germanen_halle_*` haben keine Module (Handkarten), die Zeilen wirken dort nur über Debug und spätere Generatoren.

## 4. Rückfall-Props (heute eingetragen, mit Begründung) und Eintragszeilen für ITM-02
| Bauweise | schott | druck | schuss | `*` |
|---|---|---|---|---|
| germanen (+ Hallen) | `prop/germanen/gemein/decal_runen` (flache Runenplatte, Bestand-Decal) | `ort/germanen/aussenposten/streu_glutleitung` (0,56 m, Leitung am Boden) | `prop/germanen/aussenposten/schuerfgeraet` (2,0 m, 1×1, Maschine; nirgends sonst verbaut) | `decal_runen` |
| rom (+ feld) | `ort/rom/gemein/bake` (Warnbake, Tag `warnung`, 1,25 m) | `ort/rom/gemein/verteiler` (0,81 m, Energieverteiler als „Ventil“) | `ort/rom/station/pumpe` (1,56 m, 1×1, Maschine) | `bake` |

Begründung: nur Bestand, nichts aus `ruine/`, Footprint ≤ 1×1, begehbare Typen nicht höher als die Figur (Bake und Verteiler sind Gegenstände ohne Box, eine bekannte Schwäche des Rückfalls; ITM-02 ersetzt sie durch flache Modelle). `state` ignorieren alle.
**Zeilen für ITM-02** (nur die IDs tauschen; in allen fünf Dateien, Rom mit `ort/rom/…`):
```json
"falle": {
  "schott": "ort/germanen/gemein/falle_schott",
  "druck": "ort/germanen/gemein/falle_druck",
  "schuss": "ort/germanen/gemein/falle_schuss",
  "*": "ort/germanen/gemein/falle_schott"
},
```
Mit festen Parametern oder fester Drehung: `"schuss": { "id": "…/falle_schuss", "dreh": 90 }`. Ein Modell mit anderer Form je Kartenart: `"station": "…"` zusätzlich (Typ vor Art).

## 5. Manifest, Schritte, Prüfkommandos
Manifest `assets/manifest/ort-fallen.json` (Team `ort-fallen`), je Modell (Vorlage `falle_schuss`, Germanen):
```json
{ "id": "ort/germanen/gemein/falle_schuss", "kind": "model", "tier": "detail", "palette": "nord", "footprint": [1, 1], "height": 1.3, "facing": "+z",
  "params": { "state": [0, 3] }, "states": { "erkannt": { "state": 1 }, "entschaerft": { "state": 2 }, "ausgeloest": { "state": 3 } },
  "sockets": { "use": [0, 0, 0.5], "label": [0, 1.5, 0], "fx_spark": [0, 0.9, 0.6], "fx_smoke": [0, 1.3, 0] },
  "tint": [], "budgetTris": 1500, "tags": ["prop", "anker", "falle", "schuss", "germanen"] }
```
Rom: `"palette": "rom"`. `falle_schott` und `falle_druck` wie oben mit `footprint [1, 1]`, `height` 0,15 bzw. 0,25.
1. Voxelwerk: Modelle bauen, `node tools/check.js ort/` (0 Fehler, 0 Warnungen).
2. Spiel-Repo: Manifest anlegen, `npm run assets` (`VOXELWERK_PATH`, Standard `../voxelwerk`), `npm run check:assets` (0 Fehler), `npm run check`.
3. Zeilen in den fünf `bauweisen/*.json` tauschen; `node tools/test-fallen-client.js` (Rückfall-Kits, K-SILHOUETTE, Orte-Sperre über `check:assets`), `node tools/test-buehne.js`.
4. Probe im Spiel: `npm run debug`, Browser `?debug=1&render=voxel`, Konsole: `__game.dbg('buehne aussenposten 1 - rostmeute intakt')`, dann `__game.dbg('falletest schuss')`, `falletest druck`, `falletest schott` (zwei Fallen neben dem Spieler: eine passive = erkannt, eine verborgene; `scanfertig 2` enthüllt die zweite; Auslösen durch Betreten; E halten entschärft). Zustände ohne Laufen: `__game.dbg('anker falle.test2 entschaerft')`.
5. Aufnahmen und Fehlerzahl: `node tools/itm01-e-shots.js --render voxel` (alle Zustände aller drei Typen, Druckfeld an/aus, Schuss, Schott zu/offen, `kitFehler 0`, Platzhalter leer, Bilder in `shots/itm01-e/`), für die Kartenübersicht `tools/ort01-shots.js` (`kitFehler 0`).
6. Zwei-Spieler-Lauf: `node tools/itm01-e-gruppe.js` (Scan, Entschärfen, Auslösen, Nachzügler).

## 6. Offene Fragen an Kai
1. **Höhe der Selbstschussanlage:** ≤ 1,3 m (Empfehlung, verdeckt die nördliche Nachbarkachel nur zu etwa 0,85 Kacheln) oder höher (ein Geschütz auf Pfosten, 2 m) mit Hüllen-Mechanik (`huelleUpdate`: das Modell schaltet auf niedrig, wenn es die Sicht auf eine Figur kreuzt)? Letzteres ist eine Kit-Änderung.
2. **Schwebendes Warndreieck bei vorhandenem Modell:** bleibt als Sicherheitsnetz (heute immer an) oder entfällt sobald ein echtes Modell das „erkannt“ trägt (Designer-Review)?
3. **Flache Bodenmodelle** für `schott`/`druck` (Vorschlag) oder nur das Overlay und kein Prop (dann `*`-Zeile ohne Modell, braucht einen flachen Platzhalter; `kit.js PROP_FB.falle` existiert bereits)?
4. **`state 0` bauen?** Wird im Client nie gezeigt (Aufwand klein: leeres/flaches Modell), nötig nur für Debug und spätere Verborgen-Darstellung (z. B. Bodenluke als „verdächtige Platte“).
5. **Ausgelöste Anlage:** bleibt als „verbraucht“ stehen (Vorschlag) oder verschwindet sie (Kollision bliebe, Server ändert das nicht ohne Config)?
6. **Feldfarbe** weiterer Varianten: `dorn` Rot (Gefahr), `kabel` Warngelb? (Eisblau ist Scanner, Bernstein am Boden Hitze.)
7. **Rom-Schiff:** soll es Fallen im Rom-Schiff je geben (dann braucht Rom eine Schiffs-Bauweise mit `lift`, `leiter` und Stimmung)?
