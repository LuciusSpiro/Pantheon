# CONTRACT-ROLLEN-ORT – Rollenformat `rollen/1` (ORT-01, Paket 1)

Orte (Station, Außenposten) werden je Raumtyp über **Rollen** eingerichtet, nicht über Dateinamen. Jede Rolle hat eine
**römische und eine germanische Belegung** (Modell-IDs). Alles ist **nur Optik**: nie Deckung, nie auf Anker-, Tür-, Weg-,
Pad- oder Kantenmitte-Kacheln, das Verhalten der Bühnen ändert sich nicht. Der Generator wird nicht berührt (Karten-Hashes
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
Die produktiven Dateien sind in Paket 1 leer (`raumtypen: {}`): Paket 2 (Außenposten) und 3 (Station) füllen sie.

### `raumtypen.<id>`

Der Schlüssel ist der **Raumtyp = Präfix der Platz-ID ohne laufende Nummer** (`werkstatt_2` → `werkstatt`, `kommando` → `kommando`).
Es gibt kein neues Payload-Feld: `awayMap.plaetze` trägt die IDs schon. Raumtypen der Station (`gen-station.js`): `kommando`, `reaktor`,
`zellen`, `lager`, `quartier`, `messe`, `werkstatt`, `krankenstation`, `kantine` (die Kantine erzeugt der Generator heute nie).
Gebäudearten des Außenpostens (`gen-siedlung.js`): `kommando`, `lager`, `werkstatt`, `quartier`, `kantine`, `krankenstation`.
Plätze mit anderem Präfix (Gänge, Straßen, Landefeld, Kulissenhäuser) und Räume ohne Eintrag laufen unverändert im Zellenmodus.

| Feld | Bedeutung |
|---|---|
| `rollen` | Liste von Rolleneinträgen. Richtwert 5–7 je Raumtyp (Erkundung F5: 1 Hauptstück, 2 Hauptrollen, 2–3 Nebenrollen, 1 Streurolle). Mehr/weniger: Warnung. |
| `frei_halten` | 1–4 (Standard 1): Radius um Anker und Türen, der frei bleibt. Reicht die Kapazität nicht, geht der Rollenmodus schrittweise bis 1 zurück (nie 0). |

### Rolleneintrag

| Feld | Bedeutung |
|---|---|
| `rolle` | Name, Schlüssel in `rollen`. Konvention `<raumtyp>.<name>` oder `gemein.<name>` für geteilte Rollen. |
| `kind` | `streu` (Standard): Deko, 1×1, nicht blockierend, ≤ 1,94 m, vom Rollenmodus gestreut. `leit`: Hauptstück über `bauweise.leit` (Leitstück-Fuß in `leit_fuss`). `anker`: Hauptstück an einem Anker (`ankerRolle`, Rolle aus `anker.json`, z. B. `terminal`, `beute`). |
| `zug` | Nur `streu`: `[min, max]` Stück je Platz (0–6), gezogen aus dem Rollenstrom. Standard `[1, 1]`. |
| `wandnah` | Nur an Wand/Zaun, Rücken zur Wand. |
| `pflicht` | Wird zuerst platziert und mindestens 1× versucht (`zug` min wird auf 1 angehoben). |
| `ankerRolle` | Nur `anker`. |

Paket 1 verdrahtet `leit`/`anker` nur im Format und in der Prüfung (Belegung, Modell-IDs, `leit_fuss`); gestreut werden sie nicht.
Die Hauptstücke gehen über den bestehenden Mechanismus, die Anbindung der Belegung an `kit.js` `propId` folgt mit dem ersten
Hauptstück (Paket 2/3).

### `rollen.<name>`

`{ "rom": <ID | [IDs]>, "germanen": <ID | [IDs]> }`, optional `hinweis`. Mehrere IDs sind Belegungen; der Seed wählt je Stück eine.
**Beide Seiten sind Pflicht** (Parität). Gegenstücke müssen nicht formgleich sein, nur dieselbe Rolle erfüllen. Weitere Völker
(`aegypten`, …) sind eine Warnung (unbekanntes Feld), bis das Format sie aufnimmt.

## Rollenmodus (`public/js/voxel/deko.js`, `streuen(k, regeln, { rollen })`)

`opts.rollen = { daten, bauweise, ausschluss? }` (`kit.js` setzt `bauweise` aus der Karte, `ausschluss` = `deckung_props`).

- Je Platzrechteck mit Raumtyp-Eintrag, nicht je 8×8-Zelle. Kandidaten: Boden/Gelände/Plateau, in Gebäuden auch `boden2` (Innenboden,
  den der Zellenmodus nie bestreut); nie Anker/Tür (+ `frei_halten`), Pad, Rampe, Kantenmitte.
- **Strom je Platz und Rolle:** `mulberry32(fnv(platzId + ':' + rolle, kartenseed))`, nie `game.rng` oder ein Generatorstrom. Ein Stück zieht immer
  gleich viele Zufallszahlen, deshalb sind die **Positionen in Rom und Germanen identisch**, nur die Modelle wechseln.
- In diesen Rechtecken streut der Zellenmodus nicht mehr: Props fremder Platztypen (Gang-Wandmonitore) wandern nicht in Räume.
- Besitz-Streuung (Banner): ein Stück je Rollen-Platz (Zellenmodus: jedes vierte Prop), wandnahe Einträge nur an der Wand.
- Grenzen bleiben: `deckung_props`-Filter, `MAX_JE_ZELLE = 12`, `K-SILHOUETTE` (auch für Rollen, `Buehne.silhouetteFehler`).
- Ohne Rollen-Datei, mit leerem `raumtypen` oder für Plätze ohne Eintrag: **byte-gleiche** Ausgabe wie vorher.

## Prüfung

- `npm run check:assets` (Abschnitt „Rollen-Parität“), schnell: `node tools/check-assets.mjs --nur-rollen [--rollen-dir <ordner>]`.
  **Fehler:** Format, `rom` ODER `germanen` fehlt/leer, Rolle ohne Definition, Modell-ID weder im Manifest noch in `index.json`, **Modell nur in
  `index.json` ohne Manifest-Eintrag** (der Client lädt nur Manifest-IDs, das Stück bliebe unsichtbar, z. B. `rom/energiezelle`),
  `streu`-Modell größer als 1×1, `leit`-Modell ohne `leit_fuss`, `ankerRolle` nicht in `anker.json`. **Warnungen:** Rollenzahl außerhalb 5–7,
  unbenutzte Rolle, unbekannte Felder.
- `tools/test-rollen-paritaet.js` (Format, Mutationsprobe), `tools/test-rollen-modus.js` (Rollenmodus), beide in `npm test`.
- `node tools/hash-baseline.js --compare`: 72 Karten-Hashes und 60 Deko-Hashes gegen `tools/fixtures/ort01-hash-baseline.json` (main `6d912b4`).
