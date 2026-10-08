# Konzept S1 „Regiebuch & Weltstand“ (Vorarbeit)

Stand 2026-10-07 · Vorarbeit während der QA von M4, **ohne Änderung an bestehendem Code**. Grundlage ist das Briefing
im Vault (`brain/vault/Coop-Spiel/Briefing Spielleiter S1.md`). Diese Dateien beantworten dessen Abschnitt 8 und dienen
als Startpunkt für `CONTRACT-S1.md`.

| Datei | Inhalt |
|---|---|
| [helfer-inventar.md](helfer-inventar.md) | alle 35 Aktionen und 27 Prüfungen mit Einordnung generisch / intern / entfällt und neuem Bausteinnamen |
| [regiebuch.schema.json](regiebuch.schema.json) | JSON-Schema des Regiebuchs (Struktur) |
| [m3.regiebuch.json](m3.regiebuch.json) | **m3 „Die Tafel von Kesh“ vollständig als Regiebuch**, gültig gegen das Schema |
| [weltstand.schema.json](weltstand.schema.json) | JSON-Schema des Weltstands |
| [weltstand.beispiel.json](weltstand.beispiel.json) | Beispiel: mitten in m2, angedockt bei Vaelen, mit NSC-Gedächtnis und Chronik |
| [bausteine.json](bausteine.json) | Entwurf der Baustein-Registry: Parameter je Baustein, Objekte/Bereiche/Gruppen je Außenkarte, NSC. Prüfgrundlage und Keim des Katalogs für S2 |
| [`tools/check-missions.js`](../../tools/check-missions.js) | **Prüfer** (neue Datei, keine Abhängigkeiten) |

Prüfen: `node tools/check-missions.js` (alle Regiebücher) · `node tools/check-missions.js --selftest` (die kaputten
Regiebücher aus der Abnahme). Ein npm-Skript `check-missions` kommt mit S1 dazu (`package.json` wird während der QA von
M4 nicht angefasst).

## Antworten auf Briefing §8

### 1. Wie sieht das Regiebuch konkret aus?
Siehe `m3.regiebuch.json`. Grundsätze:
- **Der Ablauf bleibt im heutigen Format.** `steps`, `enter`, `timers`, `rules`, `objectives`, `next`, `choices`,
  `on`, `skip`, `scan`, `jumpBlock` behalten Namen und Bedeutung. Die Engine-Änderung ist dadurch klein.
- **Neu sind die Rahmenteile:** `kopf`, `angebot` (ersetzt `MISSION_ORDER`), `buch` (mit bedingtem Auftraggeber statt
  Funktion), `buehne`, `besetzung`, `ausgaenge` mit `folgen` (schreiben in den Weltstand), `debug`, `texte`.
- **`do` ist immer ein registrierter Baustein**, seine Parameter stehen daneben (`{ "do": "spawn_squad", "map":
  "kesh", "squad": "squad1" }`). Gruppen von Aktionen heißen `wirkung`, damit `do` eindeutig bleibt.
- **Wendungen** sind Aktionen mit `wendung` (Kennung), `ankuendigung` und `wirkung`. Das Schema erzwingt die
  Ankündigung. In S3 kann der Spielleiter Wendungen über ihre Kennung austauschen.
- **Garantien** sind markiert (`"garantie": "hinweis" | "zeitlimit" | "autoloesung" | "notausgang"`), damit der Prüfer
  zählen kann, ob jeder Schritt eine hat.
- **NSC sind Kennungen** (`"from": "tesk"`), Name und Titel kommen aus dem Weltstand.
- **Zahlen** dürfen auf `shared/config.js` verweisen (`{ "cfg": "missionM3.wardenStepMax" }`), damit `tune` weiter
  wirkt. Nur in handgeschriebenen Regiebüchern; der Spielleiter schreibt Zahlen direkt.

### 2. Die Helfer
Siehe `helfer-inventar.md`. Ergebnis: **17 + 23 generische Bausteine, 15 interne, 7 entfallen** (werden Daten).
**Wichtigster Befund:** Fast alle missionsspezifischen Helfer fragen Objekte oder Bereiche auf Außenkarten ab. Ein
**Objekt- und Bereichsmodell in den Kartendaten** ersetzt sie durch vier generische Bausteine und ist zugleich der
Vorläufer der Anker für den Orts-Generator (G1). **Empfehlung: in S1 aufnehmen** (siehe offene Entscheidungen).

### 3. Wo lebt der Text-Teil?
**Im Regiebuch selbst** (`texte`, Verweis mit `@kennung`). Eine Mission ist damit genau eine Datei, die der Spielleiter
in S2 als Ganzes erzeugen und der Prüfer als Ganzes prüfen kann. Literaltexte bleiben erlaubt, der Prüfer warnt.

### 4. Wie wird eine laufende Mission beim Laden wiederhergestellt?
Gespeichert wird nur angedockt. Deshalb reicht:
- **Laden startet den gespeicherten Schritt neu** (`setStep`) mit den gespeicherten `v`, Flags, Entscheidungen,
  Ereignissen (`accepted`) und erledigten Zielen. Timer feuern erneut. Das kostet höchstens eine wiederholte ODA-Zeile.
- **Neue Prüferregel „neustartfest“:** Ein Schritt, in dem angedockt werden kann (Bedingung `docked` oder Schritt mit
  Hafen-`loc`), darf in `enter` und frühen Timern keine Wendungen mit Spieleffekt haben (Spawn, Schaden). m1–m3
  erfüllen das schon: `dock`, `port`, `briefing`, `vaelen` sind ruhige Schritte.
- Was im Weltstand dafür steht, zeigt `weltstand.beispiel.json` (`missionen.m2`).

### 5. Aufwand und Teams
Schätzung wie im Fahrplan: **2–3 Studio-Tage**. Vorschlag für die Aufteilung (kein Team ändert fremde Dateien):

| Team | Aufgabe | Dateien (Vorschlag) |
|---|---|---|
| **ENGINE** | Regiebuch laden, Baustein-Registry, `wirkung`/`wendung`/`complete: ausgang`, Angebote statt `MISSION_ORDER`, Objekt- und Bereichsmodell in der Engine | `server/sim/mission.js`, neu `server/mission/registry.js` |
| **DATEN** | m1, m2, m3, Selas Notruf und Zaunkönig als Regiebücher; Objekte und Bereiche in den Kartendaten deklarieren | neu `data/regiebuecher/*.json`, `shared/maps.js` (Legende) |
| **WELTSTAND** | Speichern beim Andocken, Laden, 5 Slots, „Fortsetzen“ in der Lobby, NSC-Datensätze, Chronik | neu `server/weltstand.js`, Lobby im Client |
| **WERKZEUG** | `check-missions` (Prüfer), `sim` auf Regiebücher umstellen, fünf kaputte Test-Regiebücher | `tools/check-missions.js`, `tools/sim-headless.js` |

## Änderungen gegenüber dem JS-Original von m3
Bewusst, damit sie in der Abnahme nicht als Fehler gelten:
1. **Die Tafel wird an Tesk abgegeben** (Entscheidung Kai, 2026-10-07): Texte `funk.abschluss`, `log.abschluss`,
   `ende.text` angepasst; Ausgang `erfolg` entfernt die Tafel und trägt `tafel_von_kesh: konkordat_archiv` als Fakt ein.
2. **Neuer Hinweis im Schritt `tablet`** nach 45 s: Der Schritt hatte als einziger keinen Hinweis bei Stillstand.
3. **Folgen für NSC:** Tesk Haltung +1, Gedächtniseinträge für Tesk und Melk, Chronikeintrag.
4. `m3Reward` und `reliefSquad` sind in Daten aufgelöst (Wächter-Belohnung, Verstärkung als markierte Wendung).

## Entscheidungen (Kai, 2026-10-07)
1. **Das Objekt- und Bereichsmodell kommt in S1.** Außenkarten deklarieren Objekte (mit Zuständen) und Bereiche in den
   Kartendaten; es ersetzt rund 18 Sonderfälle und ist die Grundlage für Anker in G1.
2. **Sprache der Feldnamen bleibt gemischt:** Ablauf englisch wie im Code (`steps`, `objectives` …), Rahmenteile
   deutsch wie im Vault (`kopf`, `buehne`, `ausgaenge`).

## Offene Punkte
1. **Nebenaufträge** (Selas Notruf, Zaunkönig) werden eigene Regiebücher mit `kopf.art: "nebenauftrag"`. Das
   Missionsbuch liest sie dann aus Daten statt aus `bookEntries()`.

## Nächste Schritte der Vorarbeit
- ~~**Schritt 2:** Prüfer~~ **fertig.** `tools/check-missions.js` prüft Schema, Referenzen gegen den Code
  (`locations.js`, `maps.js` inkl. Kachelarten und Spawn-Zeichen, `config.js`), Bausteine mit Parametern, Texte,
  Erreichbarkeit, Sackgassen, Entscheidungen, Garantien, Wendungen/Ankündigungen und „neustartfest“. Selbsttest: m3
  fehlerfrei, 7 kaputte Varianten werden erkannt (die 5 aus der Abnahme plus „ohne Garantie“ und „nicht neustartfest“).
- **Schritt 3:** Trockenversuch Spielleiter: Katalogentwurf + Weltstand an `claude -p`, Ergebnis durch den Prüfer.
