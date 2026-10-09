# Schnittstellen-Nachträge B1–B3 (Studioleitung, verbindlich, ergänzt die Verträge)

Laufend ergänzt während Welle 1. Gilt vor älteren Formulierungen in INHALT/ART-PLAN; bei Widerspruch zum Vertrag gilt
dieser Nachtrag.

## Format Bühne (BUEHNE, KITS-*)
- Schablonen-Platzfeld `"ankunft": true` markiert den Platz, dessen `abholpunkt` `ankunft` bekommt. Genau einer je
  Schablone. Module tragen kein `ankunft`.
- Schablonen-`bereiche.<id>.rolle`: `hinein | ziel | rueckzug | null`; Schlüssel frei wählbar.
- `belegungen`: `.` = keine Änderung; nur `o`/`O`/`I` auf Bodenkacheln.
- Steckplatzteile der Kartenarten heißen wie die Gerüst-Slots (`wand_fuellung`, `wand_krone`, `boden_belag` …), nicht
  wie in ART-PLAN §2.4.

## Protokoll (ENGINE)
- Ereignis `alarm` bleibt der Schiffsalarm `{ level }`. Neu: `landepunktAlarm { map, an }` (B1),
  `truppAlarm { map, trupp, x, y }` (B2).
- `awayMap` enthält zusätzlich:
  - `kanten: [[kantenId, [[x,y],…], startZustandIdx]]`, sortiert nach `kantenId`; der Index ist `kantenIdx` für `ko`.
  - `plaetze: [[platzId, typ, x, y, w, h]]` in Kacheln (für Deko-Regeln).
- Statische Auslieferung `/content/buehnen/**` (nur `.json`, nur lesen) für den Kit-Renderer.
- Weltstand-Blöcke: ENGINE ruft `mod.toSave(game) → Block` und `mod.restore(block, game)`; Modul mit `stub: true` oder
  fehlend → geladener Block wird unverändert weitergespeichert. `crew.rollen_gesehen` über
  `game.weltstand.rolleGesehen(rolle)` / `rollenGesehen()`.

## Client (CLIENT, VOXEL)
- CLIENT registriert die Karte aus `awayMap` in `Shared_Maps[lpId]` als `makeMap`-Objekt (`rows, w, h, at(), info(),
  solid()`). Die `awayMap`-Felder (`art, bauweise, besitz, zustand, seed, anker, kanten, plaetze, decks, kv`) liegen
  direkt am Objekt oder unter `.karte` – VOXEL liest beides.
- Fehlt die Karte oder passt `kv` nicht: cmd `awayMap.get { id }`.

## Waffen (WAFFEN)
- Blaster-Startwerte: `pause: 0.25, kalt: 1.6` (normaler Rhythmus ≈ 0,6 s überhitzt nie).

## Art
- Zustände nach Vertrag (§3.3), nicht nach ART-PLAN: Sprengpunkt `intakt/scharf/zerstoert`, Terminal
  `bereit/laedt/geladen/gesperrt`.
- Ein Prüfbogen schreibt nach `shots/pruefbogen/`; das ist für alle Teams erlaubt.
- Höhe: Leitstücke (`leit/*`) bis 3,5 m (Warnung über 2,2 m, Fehler über 3,5 m); alle anderen Assets bleiben bei 2,2 m.
- Zaun hat keinen Krone-Steckplatz im Gerüst; Palisadenkrone steckt in `zaun_feld`.

## FX (B2)
- FX hört selbst auf die Ereignisse aus CONTRACT-B2 §8; niemand ruft `spawnFx` direkt. Ereignisliste und Signaturen:
  Bericht FX bzw. Kopf von `public/js/voxel/fx.js`.
- Ergänzungen (verbindlich): `ausholen { id, winkel }` (Winkel optional, aber erwünscht); Treffer-Ereignisse
  (`shieldHit`, `enemyShieldHit` …) tragen `waffe`; `granateEinschlag { x, y, radius }` (Radius in Kacheln).
- VOXEL stellt `window.VoxelActors.socket(id, name) → [x, y, z]` (Weltpunkt) für `muzzle`, `vent`, `charge`,
  `blade_tip`, `head_top`, `wrists` bereit; ohne Treffer gibt es Standardhöhen.
- Snapshot-Felder, die FX liest: `players[]` `ch wu zs bt ht ov wf`; `drones[]` `ch wu zs bt wf gr facing`;
  `projectiles[]` `kind 'granate' tx ty t flug`.

## Kit-Gerüst (SYS-GERUEST, VOXEL)
- `cut` ist **0/1** (geschnittene Wand ja/nein), nicht 0–15 wie in CONTRACT-B1 §10.1. Grund: Prüfbogen, M4 und bestehende
  Kits nutzen 0/1.
- `tuer`, `schott`, `tor` haben **kein `conn`**: 2 Kacheln breit, Ausrichtung über `rot`; die Laibungen kommen von den
  angrenzenden Wänden. `tor` hat zusätzlich `breite` 2–4.
- Der Renderer reicht nur Parameter durch, die das Teil deklariert (sonst bricht der Bau mit „unbekannter Parameter“).
- Neue Bauweise = Wert in den `bauweise`-Optionen der 15 Gerüste + Hüllen `kit/<bw>/<kind>` (Muster: `kit/test/*`).

## Sternkarte (KARTE, CLIENT)
- Standardansicht „Saumraum“ (spielbare Hexe + ein Ring, größer); „Limes“ (ganze Karte) per
  `StarMap.toggleAnsicht()`, Taste `M` bindet CLIENT in `consoles.js`. Kein Klick-Knopf.

## Budget awayMap
- `awayMap` darf bis **10 KB** groß sein (statt 8 KB), Format unverändert. Grund: nur beim Betreten gesendet; Außenposten
  gemessen Mittel 7,4 KB, Max 8,35 KB.

## ENGINE-Helfer für Welle 2 (KATALOG, SPIELLEITER)
- `Objects.pruefeBuehneBraucht(braucht, karte, mapId)`, `Objects.landepunkt(id)`, `Objects.landepunkteAm(ort)`,
  `Objects.ankerZahlen(anker)`, `katalog.pruefeBesetzung(besetzung, { rollen_gesehen, spieler, kartenart })`.
- Schemas: `content/katalog/schema/{molekuel,gegner,fraktion}.schema.json`; `katalog.load()` lädt
  `content/katalog/{gegner,fraktionen}/`.
- Objektbezug in Büchern: `{ map: <lpId>, anker: <rolle>|<ankerId>, state, all? }`; Altform `{ object }` für Handkarten.

## Entern (ENTERN, ENGINE, CLIENT)
- Treibende Schiffe liegen in `space.treibend` (nicht in `space.enemies`), damit Gegnerzählung, Sprungsperre, Zielwahl
  und Raumkampf unverändert bleiben. Im Snapshot erscheinen sie in `space.enemies[]` mit `st: 'treibt'`.
- Höchstens eine Prise je Ort (`<ort>.prise`); gemerkte Prisen werden zu `<ort>.wrack-<n>`.
- CLIENT: `st: 'treibt'` ohne Waffen und ohne Zielmarkierung darstellen, Ereignis `enternFrei { id }` anzeigen bzw. über ODA
  melden.

## Dateibesitz-Nachtrag
- `content/katalog/mechaniken.json`: KATALOG darf in B1–B3 die Status-Felder setzen (sonst Studioleitung).
- `public/index.html`: Script-Tag `/shared/sektoren.js` vor `locations.js` hat die Studioleitung gesetzt (vor CLIENT).

## Bauweisen-Tabelle (Art, VOXEL, PIPELINE)
- Zusatzfelder aus ART-GK-BAU sind erlaubt und werden von `kit.js` ausgewertet: `je_art` (Überschreibung je Kartenart),
  `hoehe` (plateau/rampe), `terrain`/`leer` (gelaende/fels/abgrund/leere); `alternativen`, `leitmaterial` informativ.
- Wunsch ART-RUINE, angenommen: `anker[rolle][art]` darf statt einer ID ein Objekt `{ "*": id, "<platztyp>": id }` sein
  (Prop je Platztyp, z. B. Rätsel im `innerstes` = Offiziersschloss, sonst Aquädukt-Verteiler).

## Transfer-Konsole (ENGINE, CLIENT)
- Snapshot `transfer: { lp: [[lpId, name, art, frei 0|1, grund|null, inReichweite 0|1]], ziel: lpId|null }`, nur am Ort
  mit ≥ 1 Landepunkt, nur bei Änderung bzw. alle 15 Snapshots. Auswahl per cmd `transfer.ziel { landepunkt }`.
- Einführungsregel: ungesehene Rezeptrollen → `grundtyp`, außer der einen `neue_rolle`; Wächter gelten immer als
  bekannt; Fraktionen ohne `grundtyp` werden nicht ersetzt. `pruefeBesetzung` zählt nur `neue_rolle`.
- Waffen aus B2 sind aktiv; Schalter `WAFFEN=aus` (Umgebung) für Vergleiche mit dem alten Verhalten.
- Waffe `schrottblaster` (Blaster-Regeln, Tempo 230, Streuung 3) für Plünderer/Rostmeute und die Kesh-Plünderer in m3.
  Grund: m3-Balancing ohne Sonderregel für Gegner (gleiche Regeln, verschiedene Waffen).

## Kartenrevision nach Sichtung (GD + Art, verbindlich für KITS-*)
- Zielwerte (`buehne alle`): Deckung im Gefecht **0,10–0,14** (Außenposten, Ruine), außerhalb **≤ 0,06**; Einzelblöcke
  ≤ 0,4 (Deckung in Gruppen aus 2–4 Kacheln). Station Gefecht ≤ 0,18 / außen ≤ 0,12, Schiff ≤ 0,22 (Innenkarten enger).
- Außenposten-Böden: `.` = Hof (Frostkies/Erde), `,` = innen und Bohlenwege (z. B. Weg vom Tor zur Hofmitte),
  `:` = Gelände außerhalb der Palisade. Bauweisen-Tabelle zieht ART-GK-BAU nach.
- Flankieren: Station Kreuz bekommt eine Querverbindung (Schleife ≥ 1), Spindel setzt `"linear": true`;
  Außenposten Zwei Höfe: Innenzaun-Öffnungen weiter auseinander (getrennte Wege ≥ 2 auf allen Seeds).
- Bestehensquote bleibt ≥ 80 % (heute 100 %).
- Neue Ankerrolle `leit` (Vokabular, Studioleitung): Position eines Leitstücks im Modul, nur Optik, höchstens 1 je Modul.
  Bauweisen-Tabelle `leit[platztyp][art]`; VOXEL setzt an den Anker, sonst Platzmitte.
- (ersetzt, siehe „Entscheid RAND“ unten) Außenposten-Regel „Randlauf ≤ 8“: Module im Gefecht haben auf jeder Randzeile/-spalte von jeder Seite höchstens 8 freie
  Kacheln bis zur ersten Deckung (Gasse über Modulgrenzen ≤ 16).
- cmd `shoot { los: true }` = Lanze loslassen (CLIENT sendet, BODENKAMPF wertet aus; ENGINE dokumentiert in protocol.js).
- K-DECKUNG-DICHT bewertet die Module ohne Zustand-Überzug; der Überzug erhöht die Deckung je Bereich höchstens um +0,04.

## Snapshot-Standardwerte (BODENKAMPF, gilt für CLIENT/FX/VOXEL)
- Gegner (`away.drones[]`) senden Standardwerte nicht mit: fehlt `zs` → `'ok'`; fehlen `wn`/`wm` → 1/1; fehlt `pa` →
  Palette der Fraktion (Figur-Standard). Leser müssen fehlende Felder als Standard lesen.
- E16 Sicht: über 10 Kacheln zielen Gegner nur vom `aussicht`-Anker (`sicht.aussicht`) oder mit Trupp-Funk
  (`sicht.geteiltTtl`); Spieler am `aussicht`-Anker sehen ebenso weit (`vis`). Captain-`fokus` teilt Sicht ≥ `geteiltTtl`.

## Entscheid RAND (Außenposten, Studioleitung)
- `sichtgasseMax` Außenposten **24** (Ruine bleibt 16, Innenkarten 12). Grund: E16 – über 10 Kacheln schießen Gegner nur
  vom `aussicht`-Anker oder mit Trupp-Funk; lange Gassen sind auf der Außenkarte gewollt (Jäger, Ausblick), ein
  Deckungsteppich ist das größere Übel. Dichte geht vor Gasse.
- „Randlauf ≤ 8“ wird zu **„Randlauf ≤ 12“**. Höfe 7–8 Deckungskacheln (Gefecht 0,10–0,14), Deckung in Gruppen.
- Neuer Platztyp **`innenzaun`** (Außenposten): Palisade zwischen zwei Höfen (Gefecht), dichter als `palisade`
  (Deckung je zaunparalleler Zeile). `palisade` bleibt Außenzaun (außen ≤ 0,06) und wird leichter. Module
  `aussenposten.innenzaun.*` (RAND), Schablone zwei_hoefe setzt `innenzaun` (KERN). Deko-/Bauweisen-Einträge für
  `innenzaun` fallen auf `palisade` zurück, wo keine eigenen stehen.
- Nachtrag Entscheid RAND: Höfe bleiben bei **10 Kacheln** (≤ 2 Einzelblöcke); Zielband Gefecht Außenposten **0,12–0,16**
  (statt 0,10–0,14). Grund: nur so hält jede Hof-Kette die Gasse ≤ 22; die 9-Kachel-Variante ergab Gassen bis 40.
  `zaun_i*` (innenzaun) zählt zur `gefecht`-Liste von zwei_hoefe. Platztyp `innenzaun` gilt als Vokabular
  (INHALT §2.2/§2.3 zieht GD bei Gelegenheit nach).

## Leitstück-Fuß (Studioleitung, verbindlich)
- Ein `leit`-Anker steht **auf einem Block** (`O`/`X`, volle Deckung bzw. massiv), dessen Grundfläche der Grundfläche des
  Leitstücks entspricht (Turm 2×2, Herd/Hochsitz 3×2, Wachturm 3×3 usw. laut Bauweisen-Tabelle). Kollision = Optik: man
  läuft nie durch ein Leitstück. Der Renderer zeigt dort nur das Leitstück (`leitDeckt`), die Kollision bleibt.
- Leitstücke auf freier Fläche sind ab Grundfläche > 1 nicht erlaubt.
- BUEHNE: `pruefe` erlaubt `leit` auf Deckung/Block (keine K-ANKER-WAND für `leit`) und prüft neu **K-LEIT-FUSS**: alle
  Kacheln der Grundfläche sind Block. Grundflächen liest `pruefe` aus der Bauweisen-Tabelle (`leit_fuss` o. ä., Format
  legt BUEHNE fest und meldet es).
- Die Deckungskennzahlen zählen den Leitstück-Block wie jede Deckung; Zielbänder je Kartenart gelten weiter.
- **Rundungsregel Leitstück-Fuß (verbindlich):** Anker (ax, ay), Fuß fw × fd nach Drehung (bei 90°/270° getauscht):
  x0 = ax − floor((fw−1)/2), x1 = x0 + fw − 1; y0 = ay − floor((fd−1)/2), y1 = y0 + fd − 1. Ungerade Größe: Anker mittig;
  gerade: Anker = obere linke der mittleren Kacheln. Modellmitte = (x0 + fw/2, y0 + fd/2); `leitDeckt` = genau das
  Rechteck; K-LEIT-FUSS prüft genau das Rechteck. Ohne Anker: gedachter Anker (p.x + floor((p.w−1)/2), p.y +
  floor((p.h−1)/2)). **Eine Funktion** `leitFuss(ax, ay, fw, fd) → { x0, y0, x1, y1, mx, my }` exportiert BUEHNE aus
  `shared/buehne.js`; VOXEL (`kit.js`) und `pruefe` rufen sie auf, niemand baut sie nach.

## Symbolik-Sichtung (Studioleitung, verbindlich, verschärft)
- Runen nur als schmales, sich wiederholendes Band (≥ 5 Zeichen, 1–2 Voxel hoch, kontrastarm). Große/isolierte Glyphen
  (auch erlaubte wie Fehu/Uruz/Raido) sind eine Inschrift und nicht erlaubt → Ornament (Flechtband, Zickzack, Punkte).
- Keine Zeichen aus der Formfamilie „Stamm mit Astgabeln“ (Algiz/Tyr/Wolfsangel-ähnlich), auch nicht abstrahiert.
- Tierzeichen: nur Krähe (Eber/Hirsch auf 12×8 unlesbar, entfernt). Besitz wird über Farbe unterschieden.
- Germanen-Props leuchten nie in Zustandsrot (`alarm`/AUS-Rot ist UI-Bedeutung).
- Ruine: Leitstück ist das Fahnenheiligtum (`innerstes`). Der Wachturm ist **kein** Leitstück (Turmplatz = begehbares
  Plateau mit `aussicht`, das Plateau ist das Wahrzeichen). Keine Kulissen-Ausnahme von K-LEIT-FUSS.

## Tore (BUEHNE, Fix nach Sichtung)
- Türen eines `tor`-Ankers starten `zu` (vorher fälschlich `offen` → Rätsel/Freilegen sofort erfüllt); Kante trägt
  `tor: <ankerId>`, der Verfall-Überzug lässt sie in Ruhe.
- Verriegelt sind nur Tore an einem Rätselpaar (E-Hinweis „Verriegelt – das öffnet erst das Rätsel …“); alle anderen
  `zu`-Tore öffnen mit E halten (Schott 1 s) und setzen den `tor`-Anker auf `offen`. Passt zu KATALOG
  `artefakt_freilegen` („Rätselpaar, Sprengen oder E am einfachen Tor“).

## Snapshot-Grenze (Studioleitung)
- Einheitlich **13 KB = 13 × 1024 = 13 312 B** in allen Tests und der Sim. Gemessen (QA-INTEGRATION, ruhig): Median
  12 554 B, max 12 820 B → Spielraum nur ~500 B. Vor der Kampagne (mehr Gegnerarten/Felder) Altfelder abbauen
  (`asleep`, `cr`, `role`, `squad`-Namen; Vorschlag BODENKAMPF) – Protokolländerung ENGINE/CLIENT, eigener Auftrag.

## Rätselpaar-Fenster (Studioleitung, nach Abnahme B1 F4)
- Das Gleichzeitig-Fenster eines Rätselpaars = `max(paarSoloFenster, Laufzeit(kürzester Weg A→B) × 1,3 + Haltezeit + 2 s)`,
  einmal beim Bau/Registrieren berechnet, für alle gleich. Grund: Ein fester Wert macht große Karten solo unlösbar.
- Korrektur: Das Laufweg-Fenster gilt nur **solo** (1 Spieler im Außenteam). Ab 2 Spielern bleibt das enge
  Gruppenfenster – das Paar ist ein Koop-Rätsel („beide gleichzeitig“).
- Interaktions-Vorrang: Steht die Figur auf einem Deck-Link (Lift/Leiter), geht dieser vor der Blickrichtungs-Kachel
  (gemeinsame Funktion in `shared/buehne.js`, Server und Client).
