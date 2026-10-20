# CONTRACT-PAN01-D-GESTALTUNG – Hafenterminal im Pult-Stil (Tokens und Bausteine)

Stand 2026-10-20, Branch `pan01-d`. Designer, Modus System. Richtung **B „Waffenkreuz“** (Kai 2026-10-18), Bug oben im Terminal ist bestätigt.
Grundlage: Vault `Pantheon/Auftrag PAN-01 – Designrichtungen.md`, `Schiffe/Werft und Umbau.md` (grafischer Ablauf), Mockup `Pantheon-gestaltung/pan01/b-waffenkreuz.html`.

- **Code:** `public/js/pult-terminal-tokens.js` (globales `PultTerminal`, klassisches Skript nach `pult.js` laden; braucht `Render`, `Pult`, optional `Shared_Maps`, `Shared_Schiffskatalog`, `SchiffsUI`, `Tasten`).
- **Vorschau:** `public/terminal-preview.html` (eigenständig, `file://` reicht), zeigt alle Zustände mit Katalog- und Kartendaten und misst die Kontraste.
- **Screenshots:** `Pantheon-gestaltung/pan01/terminal/terminal-{umbau,stufe,modul,gesperrt,handel,kontrast}.png`, Skript `…/terminal/shoot-terminal.js`.
- **Prüfung:** `node tools/check-terminal-farben.js` (Selbsttest `--selftest`). Noch nicht in `npm run check` eingehängt (siehe §6).

## 1. Grundsatz

Die Bausteine **zeichnen nur**. Was frei ist, was es kostet, welche Plätze eine Stufe öffnet und was die Vorschau zeigt, rechnet der Aufrufer
(Action-Layer: Werft-Regeln, Katalog, Energieverteilung) und gibt es als **Modell** herein. Kein Baustein liest `view.state` direkt (Ausnahme:
`Pult.rahmen` für die Statusleiste). Layout rechnet niemand außer `PultTerminal.layout`.

Empfohlener Weg für die Konsole `shop`:

```js
// Consoles: case 'shop' → statt drawShop
const modell = TerminalModell.ausState(view);          // Entwickler: Action-/Storage-Layer, nicht im Baustein
PultTerminal.zeichneTerminal(ctx, view, modell);        // Rahmen (Titel TERMINAL, S 238), Anzeige, Pult, Hilfe
```

## 2. Tokens (`PultTerminal.TOKENS`)

Farben nur im Block `// <tokens>` … `// </tokens>`. Bausteine nehmen **Token-Namen** (`'waffe'`, `'preis'`, `'textZu'` …), aufgelöst über `FARBE`.

| Token | Wert | Rolle | Kontrast (gemessen) |
|---|---|---|---|
| `grund` | `#070A14` (Skin `screenBg`) | Schirm | – |
| `text` | `#F4EEDC` | Namen, Werte | 17,0:1 Schirm · 13,6:1 Kachel |
| `dim` | `#8EA3B5` | Wirkung, Beschriftung | 7,6:1 Schirm · 6,1:1 Kachel · 4,65:1 Modulraum |
| `kachel` | `#1A2238` | Teil frei, Artikel | – |
| `kachelZu` | `#10151F` | Teil kostet / gesperrt | – |
| `textZu` | `#76829A` (Review: vorher `#6F7A8E`, 4,2:1) | **nur** Name und Wirkung eines **gesperrten** Teils, Text gesperrter Zellen | 4,7:1 auf `kachelZu`, 5,0:1 auf Pult |
| `antrieb` | `FN.drive` | Buchstabe A der Energieverteilung in der Vorschau (S = `modul`, W = `waffe`) | – |
| `waffe` | `FN.weapon` `#E0473C` | **eingebaut = roter Rand links**, **wird eingebaut = volle rote Fläche** | Ink darauf 4,7:1 |
| `modul` | `FN.shield` `#7FE0C2` | **frei / freigeschaltet / Modul / öffnet neu** | 12,6:1 Schirm · Ink darauf 12,2:1 |
| `preis` | `FN.nav` `#C9974A` | **kostet Marken**, Ort, Handel | 7,5:1 Schirm · 7,0:1 `kachelZu` · Ink darauf 7,3:1 |
| `warn` / `warnGrund` | `FN.warn` / `#1A1608` | **Werft gesperrt** (Nicht-Werft-Hafen) | 11,4:1 |
| `platzZu` | `#5A667C` | gestrichelte Marke „noch nicht ausgebaut“, Strich gesperrter Zellen | 3,4:1 (Grafik) |
| `rumpf` / `raum` / `raumLinie` | `#0E1422` / `#1A2438` / `#34446A` | Schiffsschnitt | Raumlinie 1,9:1 (siehe §7) |
| `raumZu` / `schraffurZu` | `#0A0E18` / `#2A3446` | Raum noch nicht ausgebaut (dunkel + Schraffur) | – |
| `modulRaum` | `#1B3B3A` | Modulraum mit Modul | – |
| `spieler[0..3]` | `Protocol.PLAYER_COLORS` | Am Gerät / Zusehen; Namen Blau, Orange, Pink, Mint | – |

**Zustandsregel (eine für Plan, Liste, Kreuz):** volle Fläche = gewählt (Rot Waffe, Mint Modul, Messing Artikel) · Rand links in Funktionsfarbe = eingebaut ·
Messing-Preis mit Kappe F = kostet Marken · gestrichelt/gedimmt = noch nicht ausgebaut · Mint-Schraffur und „NEU“ = öffnet mit der gewählten Stufe ·
gelbe Fläche mit Grund = Werft hier gesperrt.

**Schrift** (Pixelschrift 5×7 aus `art.js` über `Render.text`; keine Web-Schrift):

| Rolle | Maß | Wofür |
|---|---|---|
| `titel` | Stufe 1, Versalien, 1 px Sperrung | Bereichstitel, Ort, Decks, PLATZ 9 · STEUERBORD |
| `text` | Stufe 1, gemischt | Namen, Wirkungssatz, Lage |
| `zahl` | Stufe 2 | Platzkappe, Marken, `840 → 240` |
| `gross` | Stufe 2, Versalien | WERFT GESPERRT |
| Zeilen | 9 px (Fließtext), 10 px (Absatz) | |

**Abstände:** 4er-Raster, Feinschritt 2 (`ABSTAND.xs 2, s 4, m 8, l 12, xl 16`). **Ecken:** 45°-Schräge unten rechts wie `rom` (Kacheln 6, Knöpfe 3, Kappen 4).
**Raster Schiffsschnitt:** Kachel 4 px, Decks nebeneinander in der Reihenfolge Ober, Mittel, Unter (x 76 / 146 / 230), Bugspitze y 26, Backbord links,
Platzmarke 13 × 11, Seitenmarken außen am Rumpf, Abstand je Seite ≥ 13 px. **Zellen unten:** Waffenkreuz 62 × 18 (3 × 3, Luft 3), Modulräume 76 × 18 (2 × 2).
**Knöpfe:** H/W 78 × 14, Hauptknopf 160 × 24, A / ↑↓ 78 × 13. **Statusleiste** `S = 238`.

## 3. Layout (`PultTerminal.layout(640, 360)`)

`{ S, anzeige, plan, decks[3] {deck, x, y, w, h}, legende, rechts, kopf, platzKopf, liste, vorschau, handel, handelInfo, pult, kreuzTitel, kreuz{1..9},
modulTitel, module{1..4}, energie, status, aktionen{ handel, werft, haupt, hinweis, ausbau, teil } }` – alle als `{x, y, w, h}`. Klickflächen entstehen
beim Zeichnen (`Pult.knopf`, `Pult.zelle`, Listenzeilen und Artikel über `R.ui.buttons` mit `onClick` aus dem Modell).

## 4. Bausteine und Modell

`zeichneTerminal(ctx, view, m)` ruft in fester Ordnung: Rahmen → (Werft) Schnitt, Legende, Kopf, dann je `m.ansicht` Platzkopf + Liste + Vorschau
**oder** Stufen **oder** Gesperrt; (Handel) Kopf + Handelsliste → Kreuz → Modulräume → Bereich H/W → Aktionen → Status → Hilfe.

| Feld von `m` | Baustein | Inhalt |
|---|---|---|
| `bereich` | – | `'werft'` \| `'handel'` |
| `ansicht` | – | `'platz'` \| `'modul'` \| `'stufe'` \| `'gesperrt'` (nur Werft) |
| `kopf` | `zeichneKopf` | `{ ort, art: 'werft'\|'hafen', marken, gesperrt }` |
| `schnitt` | `zeichneSchnitt` | `{ stufe, plaetze{1..9: {zustand: 'zu'\|'offen'\|'bestueckt'\|'neu', waffe}}, module{1..4: {zustand, modul}}, gewaehlt: 9\|'F4', deck, gesperrt, hier: 'meeting' }` – Geometrie aus `Shared_Maps` (SHIP_ROOMS, WAFFENPLAETZE, MODUL_RAEUME) |
| `platzKopf` | `zeichnePlatzKopf` | `{ kappe: '9'\|'F4', titel, lage, fn: 'waffe'\|'modul' }` |
| `liste` | `zeichneTeilliste` | `{ fn, gewaehlt: id, teile: [{ id, art: 'waffe'\|'modul', name, wirkung, energie, zustand: 'eingebaut'\|'frei'\|'kostet'\|'gesperrt', preis, grund, onClick }] }` – Zeilenhöhe passt sich an (2 Zeilen Wirkung, gewählt 3, sonst kürzer mit …) |
| `vorschau` | `zeichneVorschau` | `{ titel, fn, zeilen: [{ label, vorher, nachher, segs, fn, gleichText }] (≤ 2), seiten: [{ label, teile: [{ t, neu }] }] (≤ 2) }` |
| `stufen` | `zeichneStufen` | `{ stufe, ziel, stufen: [{waffen, module, preis}], oeffnet: [{kappe, text}], marken: [vorher, nachher], hinweis, energie }` |
| `gesperrt` | `zeichneGesperrt` | `{ titel, grund, text, bestueckung: [{kappe, name, fn}] }` (Waffen links, `fn: 'modul'` rechts) |
| `handel` | `zeichneHandel` | `{ artikel: [{ id, name, art, preis, besitz, grund, guenstiger, onClick }], gewaehlt, info: { text, grund } }` (Daten wie `Consoles.shopRows`) |
| `kreuz` | `zeichneKreuz` | `{ plaetze (wie schnitt, + stufe), gewaehlt, gesperrt, grund, onPlatz(k) }` – `Pult.zelle`, gleiche Kurznamen wie die Ops (`kurz` aus dem Katalog; Standardbatterie `STANDARD`, in der Zelle `STAND.`). **Zustände:** bestückt = volle rote Fläche, gewählt = weißer Rahmen, unbestückter offener Platz = „leer“ (das Ops-Pult zeigt dort weiter „frei“), noch nicht ausgebaut = gestrichelt mit „Stufe n“, `gesperrt` = gedimmt (`off`); im Handel steht das Kreuz gedimmt, ein Klick wechselt in die Werft |
| `module` | `zeichneModulraeume` | `{ module (wie schnitt, + stufe), gewaehlt: 'F2', gesperrt, onModul(n), energie: 'ENERGIE  Module 3 · frei 5' }` |
| `bereichUmschalter` | `zeichneBereich` | `{ bereich, werftZu, onBereich(b) }` |
| `aktionen` | `zeichneAktionen` | `{ haupt: { art: 'umbau'\|'modul'\|'freischalten'\|'kaufen'\|'handel', text, disabled, grund, onClick }, hinweis: { text, fn }, ausbau: { active, disabled, grund, onClick }, teil: { disabled, onClick } }` |
| `status` | `zeichneStatus` | `{ amGeraet: 0–3 \| null, zusehen: [0–3] }` |

**Hauptknopf je Lage (Regel):** Ent = kostenlos bestätigen (Umbau Rot, Modul Mint, Artikel kaufen Messing) · **F = alles, was Marken kostet** (Teil
freischalten, Ausbaustufe freischalten; Messing) · H = zum Handel (Werft gesperrt). Bei einem Teil mit Zustand `kostet` ist der Hauptknopf F; nach
dem Kauf wird dasselbe Teil `frei` und der Hauptknopf Ent. **Abweichung vom Mockup:** dort war „Stufe 2 freischalten“ Ent in Mint; jetzt F in Messing,
weil es Marken kostet. Mint bleibt für „öffnet neu“.

**Symbole:** Waffen = Katalogsymbole (`SchiffsUI.drawWaffe`, wie Ops und Taktik). Module = neue Pixelmasken `PultTerminal.SYMBOLE_MODUL`
(`frachtraum` Kistenstapel, `krankenstation` Kreuz, `werkstatt` Schraubenschlüssel; 10×10, Format wie `SYMBOLE` im Katalog). Vorschlag: in
`shared/schiffskatalog.js` als `SYMBOLE.modul_*` übernehmen, dann sind sie eine Quelle (Ziel-Scan kann sie mitbenutzen).

## 5. Tasten (Kappen zeigen die echte Taste)

`PultTerminal.kappe(aktion, ersatz)` nimmt die Belegung aus `tasten.js`, sobald die Aktion dort steht, sonst die Ersatzbeschriftung.
Vorgeschlagene Aktions-Ids (Gruppe neu `terminal`): `terminal.platz1`–`9` (NUM 1–9), `terminal.modul1`–`4` (F1–F4), `terminal.teilHoch`/`terminal.teilRunter` (↑ und ↓; die Kappe „↑↓“ am Knopf Teil bleibt die Ersatzbeschriftung),
`terminal.bestaetigen` (Enter), `terminal.freischalten` (KeyF), `terminal.ausbau` (KeyA), `terminal.handel` (KeyH), `terminal.werft` (KeyW), `terminal.kaufen` (Enter).
Enter erscheint als **„Ent“** (Konvention `KAPPEN` in `tasten.js`, wie alle Pulte; das Mockup zeigte „Enter“).

Befunde zu Konflikten (geprüft: `tasten.js`, `client.js`, `voxel/boot.js`, `consoles.js`, `node tools/check-tasten.js` grün):
- **F1–F4 kollidieren nicht mit Spieltasten** (F6/F7 nur Debug, F8 Voxel/2D in `voxel/boot.js` global, F1–F4 sonst frei). **Aber Browser:** F1 öffnet die
  Hilfe, F3 die Suche (F2/F4 harmlos). Die Konsole muss für F1–F4 im Terminal `preventDefault()` rufen; im echten Browser prüfen.
- **W ist heute Pfeil hoch im Shop** (`consoles.js` case `shop`: `ArrowUp || KeyW`, `ArrowDown || KeyS`). Mit W = Werft müssen W/S als Listennavigation entfallen (nur ↑↓).
- A, F, H sind in Ops/Steuer/Captain belegt, aber andere Gruppen bzw. Bereiche: kein Konflikt, solange das Terminal eine eigene Gruppe hat.
- `check-tasten.js` sucht Knöpfe über ihre Beschriftung. Beschriftungen der Bausteine (stabil halten oder Tasten direkt auslösen): `Handel`, `Werft`,
  `Ausbau`, `Teil`, `Platz N`, `Modulraum N`, Hauptknopf = `haupt.label` (sonst `haupt.text`).

## 6. Regeln für Entwickler (ohne Designer einhaltbar)

1. **Keine Farbwerte** in Terminal-Code: nur Token-Namen bzw. `PultTerminal.TOKENS.FARBE`. Neue Farbe = neues Token im Block, mit Rolle und Kontrast.
   `node tools/check-terminal-farben.js` prüft alle `public/js/*terminal*.js` (Hex, rgb/hsl, eigene Schrift, Emoji). **Einhängen** in `package.json`
   `check` (habe ich nicht angefasst, weil der Entwickler parallel daran arbeitet): `… && node tools/check-terminal-farben.js`.
2. **Keine Rechtecke von Hand:** Positionen aus `PultTerminal.layout`. Neuer Bereich = neues Feld im Layout.
3. **Ein Zustand, ein Bild:** nur die fünf Zustände aus §2; „gewählt“ ist immer die volle Fläche, nie zusätzlich eine eigene Farbe.
4. **Messing heißt Geld.** Alles, was Marken kostet, steht in Messing mit Kappe F; nichts anderes in Messing außer Ort und Handel.
5. **Wirkung = Katalogtext** (`wirkung`), ungekürzt übergeben; der Baustein bricht um und kürzt sichtbar mit „…“.
6. **Kein Emoji, keine Web-Schrift, keine Verläufe**, nur dunkel. Bilder nur als Pixelmaske.
7. Neue Zustände oder Ansichten: erst in `terminal-preview.html` zeigen, dann Screenshot ansehen.

## 7. Review-Nachtrag 2026-10-20 (Designer-Review von Paket D) und offene Punkte

**Kontraste nachgemessen** (WCAG-Formel, `PultTerminal.kontrast`, Zielwert 4,5:1 für Text; Grafik 3:1):
| Paar | Werte | Kontrast |
|---|---|---|
| Wirkung `dim` auf `kachel` (frei, kostet) | `#8EA3B5` auf `#1A2238` | 6,06:1 |
| Wirkung `dim` auf `kachelZu` (kostet, Tag gesperrt) | `#8EA3B5` auf `#10151F` | 7,01:1 |
| Name `text` auf `kachelZu` (kostet) | `#F4EEDC` auf `#10151F` | 15,76:1 |
| Name `text` auf `kachel` | `#F4EEDC` auf `#1A2238` | 13,62:1 |
| **gesperrt** `textZu` auf `kachelZu` | `#76829A` auf `#10151F` | **4,73:1** (vorher 4,22:1) |
| gewählt, Waffe: `ink` auf `waffe` (Name und Wirkung) | `#0B0E1A` auf `#E0473C` | 4,70:1 |
| gewählt, Modul: `ink` auf `modul` | `#0B0E1A` auf `#7FE0C2` | 12,22:1 |
| gewählt, Artikel: `ink` auf `preis` | `#0B0E1A` auf `#C9974A` | 7,33:1 |
| Preis `preis` auf `kachelZu` / `kachel` | `#C9974A` | 6,97:1 / 6,02:1 |
| EINGEBAUT `modul` auf `kachel` | `#7FE0C2` auf `#1A2238` | 10,03:1 |
| Unterzeile Handel `dim` auf Schirm | `#8EA3B5` auf `#070A14` | 7,58:1 |
| gewählt und gesperrt (Handel) `text` auf `offLine` | `#F4EEDC` auf `#3A4A66` | 7,70:1 |
Geändert wurde im Tokenblock nur `textZu`; neu ist das Token `antrieb`. Gewählte Zeilen schreiben Name und Wirkung in `ink` (vorher eine Mischfarbe), Teile, die Marken kosten, lesen sich wie freie (Name `text`, Wirkung `dim`), `textZu` gilt nur noch für gesperrte Teile.

**Weitere Anpassungen der Bausteine:** Teilliste mit Höhenstaffel (2,3) → (2,2) → (1,2) → (1,1) und Tooltip mit dem vollen Wirkungssatz beim Überfahren · Handel-Kacheln nur `Art · Besitz` (gekürzt), der Grund einmal in der Infozeile, gesperrte Kacheln dimmen über Fläche und Preis · Vorschau ohne Inhalt zeichnet keinen Titel, Verteilung als `A2 S2 W2 → A2 S2 W1` (Buchstabe in Funktionsfarbe, geänderte Stelle `text`, Rest `dim`) · Stufen bei voll ausgebautem Schiff nur mit dem Satz „Das Schiff ist voll ausgebaut.“ in Mint · gesperrte Werft: Legende „nur Ansicht …“, Titel in der Titel-Rolle · `zeichneTerminal` nimmt `m.titel` (Säulentitel, Zuschauer: ZUSEHEN) und `m.rahmenFarbe` (1-px-Rahmen in der Farbe des Nutzers um die Anzeige) · Kreuzzelle „leer“ statt „frei“.

**Erledigt seit der ersten Fassung:** die Reihenfolge der Lafetten (7 und 9 bugwärts, 1 und 3 heckwärts, Karte getauscht) · Preise (`CONFIG.werft.preise`, nicht im Katalog) · Wirkungstexte der Module (`Katalog.MODUL_WIRKUNG`) · ein Modulraum darf leer bleiben (`werft.modul` mit `leer`, Listeneintrag „Leer lassen“).
**Offen:** Raumlinien 1,9:1 (Plan ist Orientierung, die Information steht in Kappen, Kreuz und Liste mit ≥ 3,4:1) · das Ops-Pult zeigt für einen unbestückten Platz weiter „frei“ (hier „leer“; nicht angefasst) · ODA im Terminal, siehe CONTRACT-PAN01-D.md §13.
