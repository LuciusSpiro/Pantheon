# CONCEPT-SL10 – Die Boje (Kapitel 10 und Abspann)

Grundlage: `Briefing Die Schuld der Lerche (SL0-SL12)` (SL10), `Ops-Missionen#7 Alte Boje wecken`, `Sektoren & Sprünge`, `CONCEPT-SL6.md` (Zonen, Zähler).
**Stand:** Konzept, Kais Go (2026-10-14). Voraussetzung: SL1, SL6; Kette (SL11) nimmt es auf. Die Kartenwahl/verborgene Kanten liegen in SL1.

## 1. Befund
| Punkt | Stand |
|---|---|
| Kantenarten | `open`, `locked` (+`key`), `hidden`, `far` (`explore.js:270-276`, `sprung.js`). `hidden` ist nie öffenbar (`sprung.js:332,368`, `explore.js:275`) |
| Öffnen zur Laufzeit | `sprung.js:324-363`: `temp`-Kanten (`bis: 'mission'|'immer'`) und locked-Kanten per Schlüssel (`offenExtra`/`linksOpen`, `kantenOffen()`); Weltstand `welt.sektoren.offen`/`temp` (`explore.js:327-330`) |
| Sektorkarte | `shared/sektoren.js` lädt nur `content/welt/limes.json` (Z.11), Kanten statisch beim `setzeKarte`; Sund braucht SL1 (Kartenwahl) |
| Leerraum | Hexe ohne Ort heißen `leer-<hex>` (`sektoren.js:131`); `spielbar(hex)` = `h.spielbar` oder `istLeerraum` (`:125`); in `sprung.js:8` ist Leerraum NUR über temporäre Kanten erreichbar |
| Boje | Bojen sind Kantenmarken (`markBoje`, `bojeBekannt`), kein Szenenobjekt mit Zustand |
| Glyphen-Minispiel | im Vault beschrieben, im Code nicht geprüft (UNSICHER, vermutlich neu) |
| Zonen | aus SL6 |

**Prüfung „locked-Kante in/durch Leerraum“ (Kai-Auftrag):** Im Code ist sie NICHT ohne Weiteres sicher. `sprung.js:8` verlangt für Leerraum temporäre Kanten; `kanteOffen` kennt für locked nur `offenExtra/linksOpen/schluesselFakt`. Ob ein Hex hinter dem Leerraum (Vorläufer-Sektor) von einem Leerraum-Hex aus über eine `locked`-Kante der Karte erreichbar ist, hängt davon ab, dass der Leerraum-Hex selbst Kantendaten bekommt – Leerräume haben keine Karten-Einträge (nur abgeleitet). **Empfehlung (kürzester Weg):** Die Boje steht in einem Sund-Hex mit Ort (Fundort, SL1) und öffnet eine **locked-Kante dieses Hex zum Vorläufer-Hex** (beide in `sund.json`, Vorläufer-Hex `spielbar: true`, Kante `art: 'locked', key: 'boje_vorlaeufer'`). „Hinter dem Leerraum“ ist dann Kartengeometrie (Hex liegt hinter dem Leerraumring), nicht Graph-Konstrukt. Vor dem Bau mit `tools/check-sektoren.js`/`test-sektoren.js` an einer Test-Karte nachweisen (Aufwand 0,5 Tage, siehe Abnahme).

## 2. Entwurf
### 2.1 Datenmodell
- **Szene Fundort:** Boje als Szenenobjekt `scene.boje = { x, y, id, zustand: 'schlaf'|'erwacht', zone }`, Aktivierungszone = Zone aus SL6 (`form: kreis`, `drift` leicht, `ertrag: { ziel: 'zaehler:boje', rate }`, `sichtbarFuer: 'karte'` nach Ops-Scan).
- **Zähler** `game.zaehler.boje` (0..100, Weltstand-Skalar). Wächst nur, wenn (a) die Lerche in der Aktivierungszone ist (Ertrag), (b) die Frequenz entschlüsselt ist (`fakt: boje_frequenz`), (c) Technik Energie einspeist (`boje.energie >= n`).
- **Kante:** `sund.json` enthält `locked`-Kante `…-<vorlaeufer>` mit `key: 'boje_vorlaeufer'`. Wecken = `sprung.oeffnen` mit Schlüssel `boje_vorlaeufer` (vorhanden, `sprung.js:324`). Weltstand `welt.sektoren.offen`.
- **Wettlauf nach 9A:** Regiebuch spawnt Piraten-Welle bei `zaehler.boje > 30`; Weg B (Söldner): keine Welle. Weltstand-Fakt `weg: 'A'|'B'` (aus SL9).
### 2.2 Ablauf (alle vier Stationen)
1. Ops entschlüsselt Frequenz/Adresse (Minispiel Glyphen/Sternkarte, `Minispiele`); Erfolg setzt `boje_frequenz`.
2. Technik speist Energie ein: neue Aktion `boje.einspeisen` an der Technikkonsole (Halten), jeder Zug kostet ein Modul-Offline (vorhandene Energie-Verteilung), Uhr = Piraten (nur A).
3. Navigation hält die Lerche in der Aktivierungszone (drückt und driftet, Zonenbaustein, kein Neubau).
4. Captain verteilt, wählt Reparaturen, entscheidet ab/an (Wettlauf).
5. `zaehler.boje >= 100` → Boje erwacht → Kante offen → neuer Sprungpunkt sichtbar (Ereignis `bojeGeweckt`, `sprungpunktOffen` existiert).
### 2.3 Abspann
Regiebuch-Kapitel mit `ende` (Kette `kampagne/1`, `CONTRACT-EK8.md`). Varianten über Fakten: `weg` (A/B), `notrufe` (Anzahl echter/Falle), `bojeRuhe` (ohne Wettlauf). Mehrere Textbausteine, `endGame`-Panel wie Eisenwald („Weiter erkunden“ nur, wenn der Vorläufer-Hex laut Kai freigegeben ist, Default: Partie endet, Hex als „erreichbar“ markiert).
### 2.4 Dateien
`content/welt/sund.json` (Kante, Vorläufer-Hex), `content/regiebuecher/…/boje.json`, `server/sim/zonen.js` (Zähler-Ertrag, aus SL6), `server/sim/boje.js` (neu: Wecken, Einspeisen, Prüfungen), `server/sim/sprung.js` (nur Aufruf), `server/sim/interior.js` (Modul-Offline), `public/js/render.js` + `consoles.js` (Boje, Zone, Zähler, Technikaktion), `tools/test-boje.js`.
### 2.5 Layer-Schnitt (CLAUDE.md)
- Storage: `scene.boje`, `game.zaehler.boje`, Weltstand `sektoren.offen`, Fakten `weg`, `boje_frequenz`.
- Action: `boje.entschluesselt(game)`, `boje.einspeisen(game)`, `boje.erwacht(game)` (öffnet Kante via `sprung`), keine Boolean-Parameter, je Weg eine Regiebuch-Variante.
- Frontend: Zonen-/Bojen-/Zählerzeichnung, Technik-Taste, Ops-Minispiel, Abspann.

## 3. Schnittstellen/Flags
Neue Ereignisse `bojeFrequenz`, `bojeEnergie`, `bojeGeweckt`. Zähler allgemein (`zaehler:<id>`) aus SL6; keine Sonderflags. Karten/Sektorplan zeigen Boje und Aktivierungszone gemäß `sichtbarFuer` (SL4/SL1B).

## 4. Entscheidungen
B1 Boje öffnet eine locked-Kante (Schlüssel) zum Vorläufer-Hex, nicht eine temp-Kante (Weltstand-fest, ein Weg, bleibt offen = Default). B2 Aktivierungszone ist eine SL6-Zone, Fortschritt ist ein Zähler (kein Sonderbaustein). B3 Nach 9B Ruhe, nach 9A Wettlauf. B4 Partie endet nach Abspann (Default), freies Spiel nicht in diesem Paket.

## 5. Abnahme
Bot weckt die Boje auf beiden Wegen (A mit Piraten, B ohne); Kante `locked` im Weltstand offen, Sprung in den Vorläufer-Hex per Bot; Speichern/Laden mitten im Wecken; Abspann-Varianten (A/B, Notrufe); Vorab-Test `test-sektoren`: locked-Kante hinter Leerraumring auf Test-Karte; `npm test`, `npm run check`, Golden, Snapshot, Eisenwald.

## 6. Schätzung
**3 Tage** (Briefing 2): Boje/Zähler/Einspeisen 1,5, Abspann/Texte 0,5, Kante+Wettlauf+Bot 1; +0,5 für die Leerraumprüfung, falls die locked-Variante auf der Karte nicht trägt (Fallback temp-Kante `bis: 'immer'`, ebenfalls Weltstand-fest). Glyphen-Minispiel NICHT eingerechnet, falls neu (+2).

## 7. Offene Fragen an Kai
- Glyphen/Sternkarte: existiert das Minispiel im Code? Wenn nein, Ersatz in erster Fassung: Scannen (Frequenz abstimmen, aus SL5) mit Zusatzziffer (Default).
- Bleibt die Boje nach dem Wecken offen und lesbar auf dem Sektorplan? Default ja.
- Freies Spiel nach dem Abspann: ja/nein (Default nein, siehe B4).
