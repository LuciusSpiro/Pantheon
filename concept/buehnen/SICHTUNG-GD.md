# Kartensichtung Spieldesign (Lead GD, 2026-10-08)
**Gesichtet:** Galerie 2D und Voxel, Seeds 1–24 (Außenposten, Station, Ruine), Werkstatt. Dazu `sweep --seeds 50 --json` für alle 11 Schablonen.
**Eigene Messung:** Anteil der Deckungskacheln (`o`/`O`) an der Fläche je Platztyp und Anteil einzeln stehender Blöcke, 20 Seeds. Vergleichswert ist Kesh: dort spielt sich Kampf v2 seit M2 gut.

## Befund 1 – Außenposten überladen: **bestätigt, Ursache ist die Metrik, nicht die Deko**
| | Deckungsanteil | davon Einzelblöcke | Deckung Radius 1 (Median) |
|---|---|---|---|
| Kesh (Referenz) | **0,06** | 0,50 | – |
| Außenposten `hof` (Gefecht) | **0,23** | 0,40 | 0,90 |
| Außenposten `gelaende`/`palisade` (Füllung, **kein** Gefecht) | 0,22 / 0,19 | 0,60 / 0,43 | – |
| Ruine `lagerstrasse` (Gefecht) | 0,19 | 0,60 | 0,91 |
| Station `korridor`/`abzweig` | 0,15–0,18 | **1,00** | 0,75 |

**Ursache:** `deckungMin 0.6` bei `deckungRadius 1` (Chebyshev, 8 Nachbarn) lässt sich nur erfüllen, wenn alle 2–3 Kacheln ein Klotz steht. Die Regel belohnt Pfeffer-und-Salz-Streuung statt Deckungsgruppen. In INHALT §1.3 stand Radius 2 ≥ 35 %.

**Zweite Ursache:** Die Füllplätze außerhalb des Gefechts sind genauso dicht wie der Hof. Damit hebt sich nichts ab, und Hof, Palisade und Gelände verschwimmen.

**Die Deko** ist laut `deko/*.json` reine Optik und keine Deckung. Sie verstärkt den Eindruck, ist aber nicht der Grund.

## Befund 2 – wenige getrennte Wege: **teilweise ein Messartefakt**
- **Station = 2 überall:** Die Kennzahl misst knotendisjunkte Wege bis zum Zielplatz. Ein Kontrollraum mit 2 Türen kann nie mehr als 2 haben.
- **Was die Kennzahl nicht misst:** Flankieren entsteht im **Gefechtsbereich**, nicht an der Zieltür. Dafür braucht es Schleifen:
  - Ring: hat eine Schleife (Korridorring + Schacht), Flankieren geht.
  - Spindel: hat keine, das ist gewollt (Schott für Schott).
  - **Kreuz: hat keine.** Die vier Arme sind Sackgassen, Flankieren ist dort **nicht möglich**. Das ist ein echter Mangel.
- **Engstellen:** 6–8 bei der Station, weil die Korridore ein Rückgrat bilden. Für eine enge Karte ist das hinnehmbar.
- **Zwei Höfe (min 1, Seed 8):** Alle Zielplätze liegen hinter einem Platz des Innenzauns. Mit zwei Zaunlinien hintereinander ist 1 als Minimum zu knapp.

## Befund 3 – Dramaturgie lesbar? **Station ja, Außenposten und Ruine nein**
- **Station:** Räume, Korridore, Schleusen und die Ankunft lesen sich auf einen Blick. Hinein → Ziel → Rückzug ist erkennbar.
- **Außenposten/Ruine:** Die Großform (Zaunlinie, Innerstes, Mauer) ist in 2D erkennbar. Aber:
  - Gefecht und Füllung unterscheiden sich nicht (gleiche Dichte).
  - Der Weg vom Eingang zum Ziel ist nicht als Weg zu sehen.
  - Der Hof hat **denselben Plankenboden wie die Gebäude** (`.`). Damit ist innen und außen im Lager nicht zu unterscheiden.

## Empfehlungen – Daten (KITS-OFFEN/INNEN, Config)
1. **`deckungRadius 2`, `deckungMin 0.6`** (nur Gefecht). Mit Gruppen alle ~5–6 Kacheln reichen dafür **8–12 % Deckungsanteil** (geschätzt, Gitterrechnung).
2. **Hof und Lagerstraße auf 10–14 % ausdünnen**, und zwar als **Gruppen aus 2–4 Kacheln** (Reihe, L, Kistenpaar mit `O`). Einzelblöcke höchstens 30 % der Deckungskacheln. Zwischen den Gruppen bleiben Gassen von ≥ 3 Kacheln frei.
3. **Füllung außerhalb des Gefechts** (`gelaende`, `palisade` innen, `truemmerfeld`, `mauer`) **auf ≤ 6 %**. Kontrast macht den Gefechtsbereich lesbar.
4. **`sichtgasseMax` je Kartenart:** außen (Außenposten, Ruine) **16**, innen (Station, Schiff) 12 lassen. 16 liegt unter der Lanze (22) und über dem Blaster (13). Damit sind breitere Höfe möglich, ohne dass jede Zeile zugestellt werden muss.
5. **Hof-Boden** als Außenbelag (Erde/Kies, `boden2` oder die Außenkachel), nur Gebäude bekommen Planken. Dazu **ein Weg in `,`** vom Tor zur Hofmitte (Kantenmitte zu Kantenmitte) in `tor`, `hof` und `lagerstrasse`. So sieht man Hinein → Ziel.
6. **Station Kreuz:** (1,0) und (1,1) als `abzweig` mit Querverbindung, damit eine kleine Schleife links der Kreuzung entsteht. Alternativ Schott (4,1) → Kreuzung + Schleife über (3,0)/(4,0).
7. **Zwei Höfe:** Den Innenzaun mit **zwei** Öffnungen in getrennten Zellen und mindestens 2 Zellen Abstand bauen, also Tor und Lücke nicht nebeneinander, dazu einen Zielplatz (Mast) direkt an die zweite Öffnung.
8. **Deko-Dichte** in Gefechtsplätzen höchstens 6 je Zelle statt 12, damit Deckung und Deko sich nicht gegenseitig zudecken (Abstimmung mit Art).

## Empfehlungen – Werkzeug (BUEHNE)
1. **Deckung nur im Gefecht verlangen** (ist schon so), aber zusätzlich eine **Obergrenze**:
   - Warnung `K-DECKUNG-DICHT`, wenn der Deckungsanteil im Gefecht > 0,16 ist oder außerhalb > 0,08.
   - Warnung, wenn Einzelblöcke > 40 % ausmachen.
2. **`sichtgasseMax` und `deckungRadius` je Kartenart** aus `achsen.json` statt global.
3. **Neue Kennzahl `schleifen`:** zyklomatische Zahl des Platzgraphen, eingeschränkt auf Gefechtsplätze plus Nachbarn. Ziel ≥ 1, Warnung bei 0, außer die Schablone setzt `linear: true` (Spindel).
4. **`wegeGetrennt` umstellen:** bis zum **Rand des Zielbereichs** messen statt bis zum Zielplatz, und als Warnung, wenn < 2 auf Außenkarten. Schließbare Tore (`tor:zu`) zählen als begehbar, falls das nicht schon so ist (bitte prüfen).
5. **Galerie:** Schalter „Bereiche einfärben“ (hinein/ziel/rückzug/gefecht als Tönung) und **Weg Ankunft → Ziel als Linie**. Damit lässt sich Befund 3 bei jedem Seed prüfen, ohne zu spielen.

**Reihenfolge:** zuerst Werkzeug 1 + 2 (sonst schlagen die ausgedünnten Module bei der Prüfung an), dann Daten 1–5, danach den Sweep neu laufen lassen. Ziel des Sweeps:
- Deckungsanteil im Gefecht 0,10–0,14
- außerhalb ≤ 0,06
- `schleifen` ≥ 1, außer Spindel
- Bestehensquote weiter ≥ 80 %
