# CONTRACT-ROLLEN-ORT – Rollenformat `rollen/1` (ORT-01, Paket 1)

Orte (Station, Außenposten) werden je Raumtyp über **Rollen** eingerichtet, nicht über Dateinamen. Jede Rolle hat eine
**römische und eine germanische Belegung** (Modell-IDs). Alles ist **nur Optik**: nie Deckung, nie auf Anker-, Tür-, Pad- oder
Kantenmitte-Kacheln und nie auf Wegkacheln (Gang, Straße, Platz; einzige Ausnahme: der Innenboden `boden2` der Außenposten-Gebäude, siehe Rollenmodus), das Verhalten der Bühnen ändert sich nicht. Der Generator wird nicht berührt (Karten-Hashes
bleiben gleich, `node tools/hash-baseline.js --compare`).

Abgrenzung: `CONTRACT-ROLLEN.md` meint Spielerrollen. Hier geht es um Prop-Rollen.

## Datei

`content/buehnen/rollen/<kartenart>.json`, eine Datei je Kartenart (`station`, `aussenposten`), damit parallele Pakete nicht kollidieren.
Der Client lädt sie in `kit.js` (`ladeDaten`, `prefetch`), nur für diese beiden Kartenarten.

```json
{
  "format": "rollen/1",
  "kartenart": "station",
  "raumtypen": {
    "lager": {
      "frei_halten": 2,
      "rollen": [
        { "rolle": "lager.hauptstueck", "kind": "anker", "ankerRolle": "beute", "pflicht": true },
        { "rolle": "lager.behaelter",   "kind": "streu", "zug": [2, 3], "wandnah": true, "pflicht": true },
        { "rolle": "lager.streu",       "kind": "streu", "zug": [1, 3] }
      ]
    }
  },
  "rollen": {
    "lager.hauptstueck": { "rom": "prop/rom/…", "germanen": "prop/germanen/gemein/truhe" },
    "lager.behaelter":   { "rom": ["…", "…"],   "germanen": ["prop/germanen/gemein/fass", "…"] },
    "lager.streu":       { "rom": ["…"],        "germanen": ["…"] }
  }
}
```

Lauffähige Beispiele (nicht produktiv geladen): `tools/fixtures/rollen/station.json`, `…/aussenposten.json`.
Die produktiven Dateien sind seit der Integration (ORT-01 Paket 4a) gefüllt: Station 8 Raumtypen (ohne Kantine), Außenposten 5 (kommando, lager, werkstatt, quartier, krankenstation).

### `raumtypen.<id>`

Der Schlüssel ist der **Raumtyp = Präfix der Platz-ID ohne laufende Nummer** (`werkstatt_2` → `werkstatt`, `kommando` → `kommando`).
Es gibt kein neues Payload-Feld: `awayMap.plaetze` trägt die IDs schon. Raumtypen der Station (`gen-station.js`): `kommando`, `reaktor`,
`zellen`, `lager`, `quartier`, `messe`, `werkstatt`, `krankenstation`, `kantine` (die Kantine erzeugt der Generator heute nie).
Gebäudearten des Außenpostens (`gen-siedlung.js`): `kommando`, `lager`, `werkstatt`, `quartier`, `kantine`, `krankenstation`, `kaefig` (Platz-ID `kaefig_n`).
Nur diese Raumtypen sind erlaubt (`RAUMTYPEN` in `deko.js` und `rollen-pruefung.mjs`, ein Test gleicht beide mit den Generatoren ab);
ein anderer Eintrag (`gang`, `strasse`, Tippfehler wie `lagr`) ist ein Prüffehler. Plätze mit anderem Präfix (Gänge, Straßen, Landefeld,
Kulissenhäuser) und Räume ohne Eintrag laufen unverändert im Zellenmodus.

| Feld | Bedeutung |
|---|---|
| `rollen` | Liste von Rolleneinträgen, **mindestens eine `streu`-Rolle** (anker/leit zählen nicht als Deko; sonst Fehler). Richtwert 5–7 je Raumtyp (Erkundung F5: 1 Hauptstück, 2 Hauptrollen, 2–3 Nebenrollen, 1 Streurolle). Mehr/weniger: Warnung. |
| `frei_halten` | 1–4 (Standard 1): Radius um Anker und Türen, der frei bleibt. Reicht die Kapazität nicht, geht der Rollenmodus schrittweise bis 1 zurück (nie 0). |

### Rolleneintrag

| Feld | Bedeutung |
|---|---|
| `rolle` | Name, Schlüssel in `rollen`. Konvention `<raumtyp>.<name>` oder `gemein.<name>` für geteilte Rollen. |
| `kind` | `streu` (Standard): Deko, 1×1, nicht blockierend, ≤ 1,94 m, vom Rollenmodus gestreut. `leit`: **Hauptstück** (mehrere Kacheln, rein optisch), vom Rollenmodus nach Fußabdruck platziert (Fuß je Modell in `leit_fuss` der Bauweise, siehe unten). `anker`: Belegung eines Gameplay-Ankers (`ankerRolle`, Rolle aus `anker.json`): im Format und in der Prüfung vorgesehen, **nicht verdrahtet** (die neuen Modelle tragen die Zustände der Anker nicht, siehe unten). |
| `zug` | Nur `streu`: `[min, max]` Stück je Platz (0–6), gezogen aus dem Rollenstrom. Standard `[1, 1]`. |
| `wandnah` | Nur an Wand/Zaun, Rücken zur Wand (bei `leit`: die ganze Breite des Fußes liegt an der Wand). Hauptstücke über 1,94 m müssen `wandnah` sein (Prüffehler sonst). |
| `pflicht` | Wird zuerst platziert und mindestens 1× versucht (`zug` min wird auf 1 angehoben). |
| `ankerRolle` | Nur `anker`. |

**Hauptstücke (`leit`, ab Integration):** Der Fußabdruck [Breite, Tiefe] in Kacheln steht je Modell in `leit_fuss` der Bauweise (`bauweisen/<bw>.json`, gleiche Tabelle wie die alten Leitstücke). Er muss in Rom und Germanen **gleich** sein (Layout-Parität) und das Modell umfassen (Manifest-Fußabdruck aufgerundet). Der Rollenmodus platziert das Hauptstück **vor** den Streu-Rollen im Platzrechteck: nie auf Anker-, Tür-, Weg-, Kantenmitte-Kacheln (mit `frei_halten`, schrittweise bis 1), nie über die Raumgrenze, wandnah mit dem Rücken (−z) an der Wand, sonst frei mit zufälliger Blickrichtung (Drehung 0, π, ±π/2; gerade Drehung = Breite × Tiefe, quer vertauscht). Eigener Strom `fnv(platzId:rolle, seed)`; ohne Platz oder ohne `leit_fuss`-Eintrag entfällt das Stück ohne Fehler. Ausgabe: `{ id, x, y, rot, dx, dz, rolle, fuss: [x0, y0, w, h] }` (x/y = Kachel der Mitte, dx/dz bis ±0,5). Rein optisch, Spieler laufen durch Hauptstücke.
**`anker` bleibt unverdrahtet:** Gameplay-Anker brauchen Zustände (`zelle` zu/offen, `beute` voll/leer, `sprengpunkt` intakt/scharf/zerstört, `terminal` bereit/lädt/geladen/gesperrt als `state`-Parameter). Die neuen ORT-Modelle haben sie nicht (Terminal nur 0–2, Feldzelle, Kiste, Reaktor ohne `state`); Voraussetzung wäre ein `state`-Parameter in den Voxelwerk-Rezepten.

### `rollen.<name>`

`{ "rom": <ID | [IDs]>, "germanen": <ID | [IDs]> }`, optional `hinweis`. Mehrere IDs sind Belegungen; der Seed wählt je Stück eine.
**Beide Seiten sind Pflicht** (Parität), und sie müssen **verschieden** sein: rom gleich germanen, eine rom-ID mit `germanen/`-Segment oder
eine germanen-ID mit `rom/`-Segment ist ein Fehler. Ausnahme für wirklich neutrale Technik (Rohre, Kabel, Kisten): `"neutral": true` an der Rolle. Gegenstücke müssen nicht formgleich sein, nur dieselbe Rolle erfüllen. Weitere Völker
(`aegypten`, …) sind eine Warnung (unbekanntes Feld), bis das Format sie aufnimmt.

## Rollenmodus (`public/js/voxel/deko.js`, `streuen(k, regeln, { rollen })`)

`opts.rollen = { daten, bauweise, ausschluss? }` (`kit.js` setzt `bauweise` aus der Karte, `ausschluss` = `deckung_props`).

- Je Platzrechteck mit Raumtyp-Eintrag, nicht je 8×8-Zelle. Ein Platz zählt nur, wenn für die aktuelle Bauweise (nach Deckungs-Ausschluss) mindestens
  eine `streu`-Rolle mit Belegung existiert; sonst bleibt er im Zellenmodus (kein Raum ohne Deko). Kandidaten: Boden/Gelände/Plateau; `boden2`
  (Innenboden, den der Zellenmodus nie bestreut) **nur in den Gebäuden des Außenpostens** (`k.art === 'aussenposten'`, Raumtypen der Liste);
  nie Anker/Tür (+ `frei_halten`), Pad, Rampe, Kantenmitte, nie `boden2` in Station, Gang, Straße, Platz.
- Eine strukturell kaputte Rollen-Datei lässt die Zellen-Deko stehen (`try/catch`, `opts.onFehler` → `countErr`).
- **Strom je Platz und Rolle:** `mulberry32(fnv(platzId + ':' + rolle, kartenseed))`, nie `game.rng` oder ein Generatorstrom. Ein Stück zieht immer
  gleich viele Zufallszahlen, deshalb sind die **Positionen in Rom und Germanen identisch**, nur die Modelle wechseln.
- In diesen Rechtecken streut der Zellenmodus nicht mehr: Props fremder Platztypen (Gang-Wandmonitore) wandern nicht in Räume.
- Besitz-Streuung (Banner): ein Stück je Rollen-Platz (Zellenmodus: jedes vierte Prop), wandnahe Einträge nur an der Wand.
- Grenzen bleiben: `deckung_props`-Filter, `MAX_JE_ZELLE = 12`, `K-SILHOUETTE` (auch für Rollen, `Buehne.silhouetteFehler`).
- Ohne Rollen-Datei, mit leerem `raumtypen` oder für Plätze ohne Eintrag: **byte-gleiche** Ausgabe wie vorher.

## Voraussetzungen für Belegungen

- **Manifest-Eintrag** (`assets/manifest/*.json`): Der Client lädt nur Manifest-IDs. Ein Modell nur in `public/voxel/index.json` bleibt unsichtbar und ist ein Prüffehler.
  Heute betrifft das `rom/energiezelle` (Modell vorhanden, kein Manifest-Eintrag). Der Eintrag entsteht mit dem Voxelwerk-Modell in Paket 2/3, nicht in Paket 1.
- **Außenposten: keine Deckungs-Props** (`fass`, `werkzeug`, `feuerschale`, siehe `deckung_props.aussenposten`; auch `rom.json` zeigt heute auf die
  germanischen). `kit.js` nimmt sie aus der Deko, die Rolle bliebe leer (Prüffehler). Römische Deckung braucht eigene Modelle (Paket 2).
- **Streu**: 1×1, nicht blockierend, ≤ 1,94 m (`K-SILHOUETTE`; `check:rollen` prüft es selbst).
- **Hauptstücke blockieren nicht**: Server und Client kennen nur die Kachelart, Spieler laufen durch Anker-Props (Beleg: Lauf über 159 Ankerkacheln,
  alle passierbar). Ein Hauptstück ist deshalb optisch ≤ 1,94 m; hohe, blockierende Leitstücke bräuchten `O`/`X`-Fuß, also Deckung, also Generatoränderung.

## Prüfung

- `npm run check:assets` (Abschnitt „Rollen-Parität“), schnell: `node tools/check-assets.mjs --nur-rollen [--rollen-dir <ordner>]`.
  **Fehler:** Format, `rom` ODER `germanen` fehlt/leer, Rolle ohne Definition, Modell-ID weder im Manifest noch in `index.json`, **Modell nur in
  `index.json` ohne Manifest-Eintrag** (der Client lädt nur Manifest-IDs, das Stück bliebe unsichtbar, z. B. `rom/energiezelle`),
  `streu`-Modell größer als 1×1, `leit`-Modell ohne `leit_fuss`, `ankerRolle` nicht in `anker.json`. **Warnungen:** Rollenzahl außerhalb 5–7,
  unbenutzte Rolle, unbekannte Felder.
- `tools/test-rollen-paritaet.js` (Format, Mutationsprobe), `tools/test-rollen-modus.js` (Rollenmodus), beide in `npm test`.
- `node tools/hash-baseline.js --compare`: 72 Karten-Hashes und 60 Deko-Hashes gegen `tools/fixtures/ort01-hash-baseline.json` (main `6d912b4`).
