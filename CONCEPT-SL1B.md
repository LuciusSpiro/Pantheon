# CONCEPT-SL1B – Karte und Missionsanzeige (Hexkarte, Zielsektoren, Notruf-Orte, Sektoransicht-Schnittstelle)

Grundlage: Kai 2026-10-14 (neues Paket nach SL1); Briefing SL1, SL4 (Sektorplan), SL8 (Notrufe); Vault `Sektoren & Sprünge` (Abschnitt Sektorplan), `Notrufe`, `Ops-Missionen`; Code `public/js/starmap.js` (830 Z.), `icons-b.js` (584 Z.), `consoles.js` (Sternkarte Z. 787–864, Planung Z. 2132). Konzept, nicht gebaut. Stand Prüfung 2026-10-14.
Abhängigkeit: SL1 (Kartenwahl, Sund). SL4 (Sektorplan), SL8 (Notrufe) docken an die hier gelegte Schnittstelle an.

## 1. Befund
| Punkt | Stand |
|---|---|
| Hexkarte | `starmap.js`: Hexfeld aus `welcome.sektorkarte`, Symbole je Hex aus **Kartendaten** (statisch, `hauptIcon` :308), Boje-Zustände, Route, Sprungziel-Ring (:550). Ansichten `saumraum`/`limes` (:775) – Name und Logik Limes-spezifisch (consoles.js:864 „ganze Karte Limes“) |
| Missionsanzeige | **keine** auf der Hexkarte. Einziger Missionsbezug: das Sprungziel (`jump.dest`, goldener Ring). Missionsziele stehen nur als Textzeilen im Planungs-/Captain-HUD |
| Notrufe | nicht vorhanden (SL8). Es gibt kein Daten- oder Snapshot-Format für „etwas an einem Hex“ außer `world.sektoren { e, b, t, o, v }` (erkundet, Bojen, temporär, offen, Version) |
| Sektoransicht des Captains | **gibt es nicht.** `drawSzene` (:665) zeichnet Bojen in der Raumszene, kein Plan eines Sektors mit Positionen. Zeichencode für Symbole liegt in `icons-b.js` (`IconsB.hex`) und `starmap.js` (Ersatzsymbole :253) |
| Zeichencode | Symbol-Vokabular zweimal gepflegt (`starmap.js:32` Alias, `icons-b.js:129`), Farben/Stil zweimal (`COL`, `FRAKTION`) |

## 2. Entwurf
### 2.1 Ziele
1. Die Hexkarte zeigt **Missionsziele und Zielsektoren** so, dass man sie ohne Textlesen findet (Ziel-Hexe, aktiver Schritt, Kapitelort).
2. **Notrufe** erscheinen mit Ort auf der Hexkarte (SL8 liefert Daten, SL1B das Rendern).
3. Die Karte ist nicht mehr „Limes“, sondern die aktive Karte (Sund, später weitere).
4. Eine **gemeinsame Zeichenschicht** für Hexkarte und Sektorplan, damit SL4 nichts doppelt baut.

### 2.2 Datenmodell (Snapshot, additiv, nur bei Änderung wie `world.sektoren`)
`world.marken`: Liste `[{ h: '0504', t: 'ziel'|'notruf'|'spur'|'fund'|'kontakt', id, sym?, alter?, ablauf? }]`, **gefiltert und gedeckelt** (≤ 8, ~15 B je Marke, nur Änderung + alle 15 Snapshots wie `world.locations`). Quelle sind keine Karten, sondern Missionen/Notrufe zur Laufzeit:
- `ziel`: aus Regiebuch-Schritt (`objectives[].hex` oder aus `loc`); Kette liefert Kapitelort. Neues optionales Feld `hex` am Objective und am Schritt-`loc` (Abwärtskompatibel: ohne Feld wird `loc` über `Sektoren.hexVonOrt` abgeleitet).
- `notruf`: SL8 setzt Marke mit `ablauf` (Ticks), SL1B zeigt Symbol, Restzeit als Ring.
- `spur`, `fund`, `kontakt`: reserviert für SL5/SL4, hier nur Typ und Symbol festlegen.

### 2.3 Layer-Schnitt (CLAUDE.md)
- **Storage** (Server-Zustand): Marken liegen im Missions-/Explore-Zustand, einzige Quelle `explore.marken` (oder `mission.hexMarken`, Entscheidung beim Bau; nicht in zwei Orten). Client-seitig ein zentraler Selektor `StarMap.marken(state)` – keine durchgereichten Props von der Konsole in die Karte.
- **Action** (Server): `marken.setze(game, {hex,typ,id,...})`, `marken.entferne(game, id)`, `marken.ausMissionen(game)` (ableiten). Regiebuch-Bausteine `hex_marke_setzen`, `hex_marke_entfernen` (Registry), Notruf-Aktion in SL8 ruft `marken.setze`.
- **Frontend**: `starmap.js` rendert nur (Ring/Symbol am Hex, Legende, Detailzeile), keine Regeln. Darstellung einer Marke (Symbol, Pulsieren) ist View-lokal.

### 2.4 Gemeinsamer Zeichencode (Schnittstelle für SL4)
- Neues Client-Modul `public/js/kartenzeichen.js` (UMD, reine Zeichenfunktionen): `Kartenzeichen.symbol(ctx, id, x, y, {farbe, groesse})`, `Kartenzeichen.marke(ctx, typ, x, y, t)`, `Kartenzeichen.legende(...)`, `Kartenzeichen.FARBEN`, `Kartenzeichen.SYMBOLE` (Symbol-Id ↔ Name ↔ Icon). Es **zieht** `IconsB`, `COL`, `FRAKTION`, Alias-Tabellen aus `starmap.js` heraus; `starmap.js` ruft es.
- **Sektoransicht** (SL4-Sektorplan = „echte Sektoransicht mit Positionen plus Symbolliste“): nur **Schnittstelle** hier, Bau in SL4. Vertrag: ein Sektorplan-Eintrag `{ id, sym, x, y, quelle, alter?, bekannt }` im Raumkoordinaten-System der Szene; `Kartenzeichen.symbol` zeichnet ihn identisch zur Hexkarte; Zoom/Projektion liefert SL4. SL1B baut kein Sektorplan-Datenmodell, nur die geteilten Zeichen und die Marken-Typen.
- Ansichtsnamen: `saumraum`/`limes` werden zu `fokus` (Umgebung des Schiffs) und `gesamt` (ganze aktive Karte); die Legende heißt „ganze Karte“ statt „Limes“ (consoles.js:864).

### 2.5 Darstellung
Zielhexe: kräftiger Ring plus Pfeil am Kartenrand, wenn außerhalb des Ausschnitts; Notruf: Symbol mit Restzeit-Bogen; Marken in der Legende und der Detailzeile des gewählten Hexes (`details` :606). Der HUD-Kompaktausschnitt (`opts.kompakt`) zeigt Zielmarken immer. Keine Beschriftungsflut: höchstens 8 Marken, gleiche Typen bündeln.

## 3. Schnittstellen / Flags
- Snapshot `world.marken` (additiv, `snapform` Standardwerte weglassen), Protocol-Eintrag mit Budget (≤ 150 B).
- Regiebuch: `objectives[].hex`, Bausteine `hex_marke_setzen`/`_entfernen`, Prüfung `hex_marke_da`.
- Client: `Kartenzeichen` (SL4 nutzt es), `StarMap.marken`.
- SL8: Notruf = Marke `typ:'notruf'` + `ablauf`; „Tick“ bleibt dort zu klären (Briefing SL8).

## 4. Entscheidungen
| Nr | Entscheidung | Begründung |
|---|---|---|
| D1 | Marken als Server-Zustand, nicht aus der Karte | Notrufe/Spuren sind Laufzeit, sonst zwei Wahrheiten |
| D2 | Zeichencode in einem Modul | ein Vokabular, SL4 baut nicht neu |
| D3 | Sektorplan-Daten gehören SL4 | hier nur Schnittstelle, kein Vorgriff |
| D4 | Ansichtsnamen karteneutral | Sund ist nicht Limes |

## 5. Abnahme
Auf Sund: Kapitelort, aktuelles Ziel und eine Testmarke „Notruf“ erscheinen mit Ring/Symbol; Wechsel Fokus/Gesamt funktioniert auf Limes (Eisenwald läuft weiter, Golden/Bildvergleich Hexkarte unverändert, soweit nicht Marken) und Sund; `world.marken` im Snapshot-Budget (`npm run snap:mess`); Rückfall `drawStarMapAlt` bleibt; Tests `tools/test-sektoren.js`-Familie + neuer Test für Marken; Unit-Test `Kartenzeichen.symbol` zeichnet jedes Karten-Symbol (kein Ersatz-Fallback nötig).

## 6. Schätzung
**4 Studio-Tage** (Richtwert Kai 3–4; Prüfung des Umfangs: `starmap.js` 830 Z. + `icons-b.js` 584 Z. umbauen, Zeichencode herauslösen 1,5; Marken Server+Snapshot 1; Rendering/Legende/Kompakt 1; Tests/Bildprüfung 0,5). Nicht enthalten: Sektorplan-Bau (SL4), Notruf-Logik (SL8), Spur (SL5). Risiko: Herauslösen des Zeichencodes kann die Bildvergleiche der Hexkarte verändern (+0,5 T).

## 7. Offene Fragen (nur Kai)
- B1: Sollen Zielmarken immer sichtbar sein oder nur auf Anforderung (Taste)? (Default: immer, höchstens 8.)
- B2: Ziel bei freier Reihenfolge (7a/7b): beide Hexe markiert? (Default: ja, beide offene Pflichtziele.)
