# Erzeugte Missionen (Review)

Hier legt der Spielleiter jede Mission ab, die er erzeugt (CONTRACT-S2 §8c). Je Mission gibt es einen Ordner
`<JJJJ-MM-TT>_<kennung>/` mit:

- `mission.md`: die lesbare Fassung zum Review. Sie enthält Pitch, Erinnerung, Zieldauer, Belohnung, je Szene Ort, Baustein,
  Ziele und alle Funk-, ODA- und Log-Texte in Reihenfolge, Wendungen, Entscheidungen, Ausgänge, Prüfer-Warnungen und „Gespielt“.
- `mission.json`: die spielbare Aufzeichnung (Grobplan, Szenen und fertiges Regiebuch). Nicht von Hand ändern.

## Reviewen und freigeben

1. Überblick: `npm run missionen` (Status, Titel, Quelle, wie oft gespielt).
2. Lesen: `npm run missionen -- zeigen <ordner>` oder die `mission.md` direkt öffnen. `<ordner>` darf abgekürzt werden.
3. Entscheiden: Im Frontmatter der `mission.md` `status: offen` auf `angenommen` oder `abgelehnt` ändern. Dasselbe geht mit
   `npm run missionen -- annehmen <ordner>` bzw. `-- ablehnen <ordner>`.
4. Angenommene Missionen gehören ab dem nächsten Serverstart zum Vorrat der Standard-Missionen (wie das Archiv).
   Offene und abgelehnte Missionen werden nie angeboten.

Anmerkungen gehören unter `## Notizen` am Ende der `mission.md`. Der Status und dieser Abschnitt bleiben erhalten, wenn die
Datei neu geschrieben wird, etwa nach einer ersetzten Szene oder nach dem Spielen. Alles andere wird aus der `mission.json`
neu erzeugt (`npm run missionen -- md <ordner|--alle>`).

Die Textfassung der sechs Archiv-Missionen liegt neben ihren JSON-Dateien in `content/spielleiter/archiv/<name>.md`
(neu erzeugen: `npm run missionen -- md --archiv`).

**Stand 2026-10-10** (`npm run missionen`): 6 Archiv-Missionen (`abschrift_b7`, `castellum_kesh`, `frachtlisten`,
`karawane_im_nebel`, `treibgut_zaunkoenig`, `zollfeuer`) und 7 erzeugte Missionen hier, alle 7 `offen` (keine
angenommen oder abgelehnt), 3 davon einmal gespielt.

## Wann wird abgelegt?

- Live-LLM (`SPIELLEITER_LLM=live` und `LLM_LIVE=1`): beim Angebot, nach jeder ersetzten Szene und nach dem Missionsende.
- Die Live-Aufnahme `node tools/test-llm-live.js --pipeline` legt ebenfalls hier ab.
- Mock-Missionen nur mit `ERZEUGT_MOCK=1`. `ERZEUGT_DIR=<pfad>` lenkt die Ablage um (Tests schreiben nie hierher).
