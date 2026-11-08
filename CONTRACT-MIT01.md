# CONTRACT-MIT01 – Mission-Mitschnitt für simulierte Läufe

Vertrag zwischen Paket A (Recorder, `server/telemetrie/mitschnitt.js`) und Paket B (Renderer,
`server/telemetrie/mitschnitt-render.js`). Auftrag: Vault `Pantheon/Auftrag MIT-01`. Erkundung:
Paket 0. Änderungen am Vertrag nur durch den Entwicklungsleiter.

## Grundsätze
1. **Reiner Beobachter.** Kein Haken verbraucht `game.rng`, hält Zustand im Spiel, berührt den
   Snapshot oder wirft. Jeder Aufruf: `game.mitschnitt && game.mitschnitt.xyz(...)` hinter der
   Zustandsänderung, Empfänger fängt jeden Fehler selbst.
2. **Aus = aus.** Ohne `MITSCHNITT=1` (aus `game.env`, sonst `process.env`, Muster `envWert` in
   `protokoll.js`) wird nichts angelegt, nichts geschrieben, kein Ordner erzeugt.
3. **Generisch.** Der Renderer kennt keine Beat-Typen. Unbekannte `art` rendert er als Zeile
   `art` + Felder. Neue Beats/Moleküle erscheinen ohne Änderung.
4. **Keine Spielernamen** im Verlauf. Der Empfänger ersetzt Namen **beim Eintreffen** (neue
   Funktion mit Ganzwort-Ersetzung neben `ohneNamen` in `server/sim/lage-ausschnitt.js`, kein
   Parameter an `ohneNamen`). Spieler heißen `Crew` oder nach Slot/Rolle (`p1..p4`).
5. **Frontmatter-Schlüssel `status` kommt im Mitschnitt nie vor** (Verwechslung mit der
   Freigabe in `content/spielleiter/erzeugt/`). Bewertung heißt `bewertung`.
6. **Ablage:** `data/mitschnitt/<JJJJ-MM-TT>_<lauf>/`, umlenkbar mit `MITSCHNITT_DIR`.
   Nie in `content/`, nie im Git.

## Lauf-Daten vom Werkzeug
`game.mitschnitt.lauf({ werkzeug, regel, seed, crew, modus, kuenstlich: [..] })`.
`regel` = Wahlregel des Bots als Klartext (z. B. „Brett: annehmen; Bitte: erste Option“).
`kuenstlich` = Liste von `teleport`, `testhelfer-kill`, `skip`, … (Verlauf teilweise gesetzt;
der Renderer weist es im Dokument aus).

## `verlauf.json` (Format `mitschnitt/1`)
```json
{
  "format": "mitschnitt/1",
  "lauf": { "id": "", "werkzeug": "", "quelle": "bot|messung|spieler", "regel": "", "seed": 0,
            "crew": 0, "modus": "", "gestartet": "ISO", "beendet": "ISO", "kuenstlich": [] },
  "eintraege": [ { "nr": 1, "spielzeit": 12.3, "art": "funk", "...": "Felder je Art" } ],
  "gruppen": [ { "id": "f3", "art": "faden|abenteuer|mission|szene", "titel": "", "kennung": "",
                 "von_nr": 1, "bis_nr": 9, "ausgang": "gelungen|gescheitert|abgebrochen|offen|…",
                 "angebot": null, "plan": null, "nsc": [], "modell": null, "pruefer": [] } ],
  "angebote": [ { "angebot": 1, "titel": "", "ausgang": "gespielt|abgelehnt|verfallen|offen" } ]
}
```
- `nr` ist ein **Eingangszähler** über alle Quellen (lückenlos, aufsteigend, Reihenfolge der
  Wahrheit; `spielzeit` = `game.time`, mehrere Einträge je Tick möglich).
- Eine Gruppe deckt `von_nr..bis_nr` ab; Einträge ohne Gruppe (Brett-Hinweise, Sprünge
  zwischen Aufträgen) stehen im Dokument des Laufs unter „Zwischen den Aufträgen“.
  Die Zuordnung Funk → Gruppe ist **heuristisch** (laufender Faden) und wird im Dokument so
  gekennzeichnet.
- `plan` (Titel, Anlass, Beats, Folgen, Optionen als Daten) wird beim Annehmen/Öffnen **lesend**
  aus dem Spielzustand kopiert. `modell`: `{ stufe, anbieter, modell, quelle, rueckfall, tokens,
  dauer_s, aufrufe[] }`. `nsc`: Kanon (Id, Name, Volk, Titel, Ort, Haltung, Ausgang).

### Arten der Einträge (Pflichtfelder; weitere Felder erlaubt)
| `art` | Felder | Quelle |
|---|---|---|
| `funk` | `von`, `text`, `pid?` | `Game.emit('radio')` |
| `oda` | `text` | `Game.emit('oda')` |
| `anzeige` | `quelle: chapter\|notice`, `titel?`, `text`, `slot?` | `emit('chapter')`, `notice` (H7) |
| `sprung` | `szene`, `ort`, `von` | `emit('jump')` |
| `mission` | `ereignis: start\|ende`, `id`, `titel`, `ausgang?` | `emit('missionStart/Done')` |
| `szene` | `ereignis: start\|ende\|neustart`, `modus`, `szene`, `ausgang?`, `dauer?` | Telemetrie-Senke (H0) |
| `faden` | `ausgang`, `faden?`, `beat?`, `typ?`, `begruendung?`, `key?`, `plan?` | Regielog (H1), `art` `faden_ereignis` |
| `faden_pruefung` | `ausgang`, `fehler[]`, `key?` | Regielog |
| `bauplan` | `ausgang`, `anbieter`, `modell`, `tokens`, `dauer_s`, `eskaliert?`, `angebot?` | Regielog `abenteuer_bauplan` |
| `brett` | `ausgang`, `key?`, `angebot?` | Regielog (`abenteuer_*`) |
| `regie` | `logart`, Rest des Logbuch-Eintrags | Regielog (alles Übrige, generisch) |
| `bitte` | `faden`, `beat`, `nr`, `von`, `text`, `optionen: [{id,text}]` | H3 |
| `wahl` | `quelle: bitte\|buch\|funk`, `id`, `text?`, `ausgang?`, `optionen?` | H3, H4 |
| `entscheidung` | `id`, `prompt`, `optionen: [{id,label}]` (offen gestellt) | H4 |
| `haltung` | `npc`, `delta`, `stand`, `grund?` | H5 |
| `chronik` | `art`, `ref`, `kurz`, `param?` | H6 |
| `taetigkeit` | `art`, `zaehler?` | H2 |
| `wirkung` | `konto: ruf\|marks\|ladung\|…`, `ziel`, `grund`, `betrag`, `stand` | Telemetrie-Senke (`ruf`, `buchung`) |
| `kill`, `gegner` | knapp, wie Telemetrie | Telemetrie-Senke |

## Schnittstellen
**A → B:** `require('./mitschnitt-render').schreibeLauf(verlauf, dir, { jetzt })` schreibt je
Gruppe `<dir>/<nr>_<kennung>/mission.md` und `verlauf.json`, dazu `<dir>/index.md` und
`<dir>/verlauf.json` (ganzer Lauf). Idempotent; Rückgabe `{ dir, dateien[] }`.
`renderMission(verlauf, gruppe)` und `renderIndex(verlauf)` sind **reine** Funktionen
(deterministisch, ohne Datum/Zufall; Datum nur über `opts.jetzt`).
**Bewertung/Notizen:** Frontmatter `bewertung: offen|gut|schwach|verwerfen`, Abschnitt
`## Notizen` bis Dateiende. Existiert die `mission.md` schon, bleiben `bewertung` und Notizen
erhalten (Vorbild `readMdState` in `server/mission/ablage.js`, gemeinsame Hilfsdatei
`server/mission/md-ablage.js`).
**Frontmatter `mission.md`:** `titel, kennung, lauf, seed, crew, quelle, werkzeug, bot_regel,
ausgang, verlauf_kuenstlich, bewertung`.
**Pflichtabschnitte `mission.md`:** Anlass, Zeitleiste (Spielzeit, Eintrag in Reihenfolge von
`nr`), Funk- und Anzeigetexte, Optionen und Wahl (mit Bot-Regel), Folgen (Ruf, Ladung, Sim,
Chronik, Haltung), beteiligte NSC, Modellweg, Prüfer-Warnungen, `## Notizen`.
