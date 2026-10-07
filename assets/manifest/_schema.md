# Manifest-Format (CONTRACT-M4 §5)

Eine Datei je Team: `assets/manifest/<team>.json` (z. B. `art-b.json`). Dateien mit `_` am Anfang werden ignoriert.
UTF-8, ein BOM wird toleriert. Jede ID darf in **allen** Manifesten zusammen nur einmal vorkommen.

```json
{
  "team": "art-b",
  "assets": [
    {
      "id": "lerche/station/reactor",
      "kind": "model",
      "tier": "detail",
      "palette": "lerche_rom",
      "footprint": [1, 1],
      "height": 1.9,
      "facing": "+z",
      "params": { "state": [0, 5], "power": [0, 3] },
      "states": { "ok": { "state": 0 }, "damaged": { "state": 1 }, "destroyed": { "state": 2 },
                  "patched": { "state": 3 }, "escalating": { "state": 4 }, "emp": { "state": 5 } },
      "sockets": { "use": [0, 0, 0.55], "fx_smoke": [0, 1.7, 0], "fx_spark": [0.3, 1.1, 0.4], "light": [0, 1.2, 0], "label": [0, 2.1, 0] },
      "tint": [],
      "budgetTris": 6000,
      "tags": ["lerche", "station", "system"]
    }
  ]
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `id` | ja | Spiel-ID (englisch, Deko-IDs aus `CONFIG.deko` deutsch). Unter dieser ID fragt das Spiel das Asset an. |
| `source` | nein | Voxelwerk-ID, falls sie von `id` abweicht (Alias, z. B. `"id": "lerche/furn/crate", "source": "rom/kiste"`). Ohne Angabe = `id`. In `public/voxel/manifest.json` ist `source` immer gesetzt. |
| `kind` | ja | `model` (→ `assets/models/<source>.json`) oder `figure` (→ `assets/figures/<source>.json`) |
| `tier` | Modelle | muss zur Stufe des Rezepts passen (`architecture` für Wand/Boden/Tür/Lift-Schacht/Fenster, sonst `detail`) |
| `palette` | Modelle | Palette des Rezepts (nur Information; gebaut wird mit der Palette des Rezepts) |
| `footprint` | ja | `[x, z]` in Metern = Kacheln. Das Modell darf (gemessen vom Pivot Mitte unten) nicht darüber hinausragen. Ausnahmen: `lerche/kit/light`, `lerche/kit/window`, Gegenstände `lerche/item/*` |
| `height` | ja | Höhe in Metern. Modell darf nicht höher sein; ≤ 2,2 m außer Wände, Türen, Fenster, Lift-Schacht, Felsen, Säulen |
| `facing` | ja | immer `"+z"` (Vorderseite) |
| `params` | ja | jeder Parameter, den das Spiel setzt: `{ "name": [min, max] }`. Namen wie in CONTRACT-M4 §3.3/§3.4/§3.6 |
| `states` | nein | benannte Parametersätze (Galerie zeigt jeden, Prüfung baut jeden). Stationen: `ok, damaged, destroyed, patched, escalating, emp` = `state` 0–5 |
| `sockets` | ja | Anker in **Metern**, relativ zum Pivot, Vorderseite +z. Pflicht: Station/Konsole `use, fx_smoke, fx_spark, label`; Lichtquelle `light` |
| `tint` | nein | Rollen, die das Spiel umfärben darf (z. B. `["cloth2"]`) |
| `budgetTris` | ja | Dreiecks-Budget je Zustand. Gezählt wird das kleinere aus `budgetTris` und dem Vertragsbudget §5 |
| `tags` | ja | frei, z. B. `["lerche", "station"]`; `light` = Lichtquelle (Socket `light` Pflicht), `held` = Handgegenstand |

## Ablauf für Art-Teams

1. Asset in Voxelwerk bauen, `npm run check -- <ordner>` (Voxelwerk) grün.
2. Eintrag ins eigene Manifest.
3. In `sternenschicht/`: `npm run assets` (oder dauerhaft `npm run assets:watch`), dann `npm run check:assets -- --team <team>`.
4. Ansehen: Server starten (`$env:PORT=…; $env:ROOM_CODE='off'; npm start`), dann
   `http://localhost:<port>/voxel-gallery.html?team=<team>` (Tasten `+`/`-`/`1`–`3` Zoom, `M` Stimmung).
   Screenshot: `cd C:\tmp\pwtest; node sts\m4-gallery-shot.js <port> "team=<team>&zoom=2" <out.png>`.
