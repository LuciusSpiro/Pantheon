# CONCEPT-SL2 – Belebter Außenposten Kantenstein: NSC, Taverne, Gespräch (Evert, Bote)

Grundlage: Briefing `Die Schuld der Lerche` (SL2, Kapitel 1 und 5), Vault `Szenentypen` (C6 Gesellschaft), `Kampagne Die Schuld der Lerche`; Kais Entscheidungen 2026-10-14. Konzept, nicht gebaut; Code-Angaben aus dem Prüfbericht 2026-10-13 plus Nachprüfung 2026-10-14 („ungeprüft“ markiert).
Abhängigkeiten: SL1 (Karte, Start am Boden, `welt.startOrt`). Schnittstelle zu SL0: Evert wird **Fracht**, die Ops/Taktik beamt ihn, Figur im Frachtraum mit 2-Betten-Layout (baut SL0). SL2 liefert nur Gespräch und Anheuern, keine Beam-/Frachtlogik.

## 1. Befund
| Punkt | Stand |
|---|---|
| Generatoren | `shared/gen-siedlung.js` baut Außenposten (Bauweise rom/germanen, Typ handel/militaer) mit Ankern; es gibt **keine Taverne, keine Passanten, keine Zivilfiguren**. `nsc`-Anker an Q-Gebäuden (:535) sind nur Stellplätze für Personen |
| Handkarten | Hier „Schablone“: handgebaute Karten unter `content/buehnen/aussenposten/schablonen/` (Landepunkt-Feld `schablone`, `landepunkte.json`, `server/sim/landepunkte.js:56`). Eine Schablone für Kantenstein ist der vorgesehene Weg |
| NSC am Boden | `away.npcs[]` (`server/sim/away.js:32-68`): Rettungs-Personen (folgen, verletzt, gerettet), je gebauter Karte höchstens `CONFIG.personen.maxGleichzeitig = 3` (`config.js:195`). Felder im Snapshot: id, name, x, y, dir, following, injured, rescued (`:53`) |
| Gespräche | **keine.** `interior.js:745-757` löst nur feste `radio`-Zeilen aus, E „nimmt Person mit“. Kein Dialogzustand, keine Sprechblase |
| Funkfenster | vorhanden (`radio {from,text,pid,needsAccept}`, `consoles.js:615-702`, `hud.js:923`). **Porträts nur `legat` und `mars`** (`hud.js:86-87`, sonst `false`). Es ist die Captain-Konsole, nicht ortsgebunden |
| Wander-KI | nur für Feindtrupps (`squad.js:785`, `away.js:559`). Friedliche NSC ohne Kampf: nicht vorhanden |
| Snapshot | `snapMax 20 KB`, `snapLuft 1,5 KB` (`config.js:145`); Worst Case Außenposten, 4 Spieler, 12 Gegner. Messung mit `npm run snap:mess` (`tools/snap-mess.js`) |
| NSC-Daten | `content/npc.json` (tesk, melk, ivo, sela, grauzahn, legat); Kette kann `npc` ergänzen (`kampagne.js:195`); Weltstand `npc.<id>` mit Gedächtnis, Haltung, Status |

## 2. Entwurf
### 2.1 Datenmodell
- **Kantenstein-Schablone** `content/buehnen/aussenposten/schablonen/kantenstein.json` + `landepunkte.json`-Eintrag `kantenstein.siedlung` (`art:'aussenposten'`, `schablone:'kantenstein'`, `beam`, `frei:'immer'`). Gebäude: Landepunkt, 4–6 Häuser, **Taverne** (Innenraum als Raum der Schablone; Tür-Anker), Markt-Platz. Der Karteneintrag in `sund.json` verweist auf den Landepunkt (Start am Boden, SL1).
- **Kulisse-NSC („Passanten“)** – Kai: erste Fassung **ohne Kollision**, Wege aus Seed + Zeit, **nicht im Snapshot**. Daten in der Schablone: `kulisse: [{ id, figur, weg: [[x,y],…], tempo, pause? , sprechblase?: [...] }]`, 8–12 Einträge (Wirt, Gäste, Händler, Passanten). Position = Funktion `kulissePos(figurId, seed, zeit)` (reine Funktion in `shared/kulisse.js`, Client und Server nutzen sie identisch; Server braucht sie nur für Bot/Test und für die Ortsabfrage „NSC ist dicht genug“). Im Snapshot nur der Zeitstempel/`seed` der Karte (schon vorhanden bzw. `aw.t`) – **kein** Positionsbulk. Nur **Gesprächspartner** (Evert, Bote, Wirt) sind echte NSC-Datensätze mit Zustand.
- **Evert Kroeger**: Eintrag `content/npc.json`: `evert { name:'Evert Kroeger', titel:'Händler', fraktion:'konkordat', rolle:'auftraggeber', status:'lebt', haltung:0, ort:'kantenstein' }`; Weltstand-Fakt `evert: 'angeheuert'|'gefangen'|…` (SL3/SL9 setzen weiter). Der **Bote** (Kapitel 5, Concordia): gleicher Baustein, Eintrag `bote` in der Kette (`npc`).
- **Gespräch** als Daten im Regiebuch: `besetzung.gespraeche.<id>: { sprecher:'evert', zeilen:[ {text, wahl?} ], ergebnis:{ setFlag|do } }`, **3–4 feste Zeilen**, höchstens eine Wahl „Annehmen / Später“. Texte als Entwurf vom Studio, Kai passt an.

### 2.2 Layer-Schnitt (CLAUDE.md)
- **Storage**: Gesprächszustand in `game.gespraeche` (Spiel-/Weltstand-Zustand: aktiv, npc, zeilenIndex, sprecherId), wird **im Snapshot** als `gespraech { id, z }` geführt (klein, nur während eines Gesprächs). NSC-Status/Haltung im vorhandenen Weltstand `npc.<id>`. Kulisse hat **keinen** Zustand.
- **Action** (`server/sim/gespraech.js`, neu, intention-benannt): `gespraech.beginne(game, spieler, npcId)`, `gespraech.weiter(game, spieler)`, `gespraech.waehle(game, spieler, option)`, `gespraech.schliesse(game, ...)`; Ergebnisse laufen über die Regiebuch-Engine (`run`/Flag), nicht durch Sonderparameter. Eingabe-Nachrichten `gespraech.next`, `gespraech.pick` (Protocol, wie `captain.accept`). Regiebuch-Bausteine: Aktion `gespraech_starten { id }`, Prüfung `gespraech_beendet { id }`, Ereignis `gespraechBeendet { id, wahl }`. Geteilter Baustein für **Kapitel 1 (Evert)** und **Kapitel 5 (Bote)**, später freies Spiel.
- **Frontend**: Sprechblase über der Figur (Text, 1–2 Zeilen, ortsgebunden, **für alle am Ort sichtbar**), kleines Auswahlfenster unten am Boden (Weiter / Annehmen / Später, Hotkeys). Kulisse-Figur zeichnet der Client aus `kulissePos`; Rendern = View-lokal, kein Export. E am Gesprächs-NSC ruft `gespraech.beginne` (heute `npcInteraction` → neue Interaktionsart `reden`, `interior.js:626`).
- Porträt im Gespräch: kein Funkbild; Sprechblase trägt Name + Farbe. `drawFunkBild` bleibt für Captain-Funk, bekommt optional `evert`/`bote` (nur Wunsch, Z4).

### 2.3 Bewegung ohne Snapshot
Pro Figur eine Pfadkette aus Wegpunkten (Schablonendaten, Kachelzentren begehbar); Zeit `aw.t` (oder Spielzeit) modulo Pfadlänge → Position, Pausen am Wegpunkt. Seed verschiebt Phase und Wahl unter 2–3 Alternativrouten. Keine Kollision, keine Wegfindung, keine Reaktion auf Spieler (erste Fassung). Spätere Fassung: `Kollision` als Schalter, dann Snapshot-Anteil neu messen. **Snapshot-Folge:** praktisch null; nur das Gesprächsobjekt (~30 B) und die Gesprächspartner-Personen (≤ 3).

## 3. Schnittstellen / Flags
- Fakt `evert` (`angeheuert`), Flag `evertAngeheuert` (Kapitel 1 → 2). SL0 liest sie für das Einladen von Evert als Fracht.
- Gespräche: Ereignis `gespraechBeendet`, Baustein `gespraech_starten`. Bote in Kapitel 5 nutzt denselben Baustein (ohne neue Mechanik).
- Landepunkt `kantenstein.siedlung`, Schablone, `kulisse[]`; `shared/kulisse.js` (Position) – geteilt für Test, Bot, Client.
- Weltstand: `npc.evert`, `npc.bote`, `npc.wirt` (Kette `npc`).

## 4. Entscheidungen
| Nr | Entscheidung | Begründung |
|---|---|---|
| D1 | Kantenstein = Schablone (Handkarte) | Generatoren kennen keine Taverne; erst nach der ersten Fassung den Generator nachziehen |
| D2 | Passanten Kulisse ohne Kollision, Wege aus Seed+Zeit, nicht im Snapshot (Kai) | Snapshot-Luft nur 1,5 KB |
| D3 | Gespräch: Sprechblase + kleines Auswahlfenster, für alle sichtbar | Funkfenster ist captain-gebunden und kennt nur 2 Porträts |
| D4 | 3–4 feste Zeilen, höchstens eine Wahl | kein Dialogbaum in der ersten Fassung |
| D5 | Gesprächsbaustein allgemein (Evert, Bote, später frei) | „Systeme vor Handarbeit“ |

## 5. Abnahme
Bot findet Evert in der Taverne, löst das Gespräch aus und nimmt den Auftrag an (Flag/Fakt gesetzt); Mensch dito, alle Mitspieler sehen die Sprechblase; Kulisse läuft ohne Fehler (Bot-Lauf 5 min, `countError` 0); Snapshot Worst Case Kantenstein mit 4 Spielern unter `snapMax − snapLuft` (`snap:mess`); Boten-Gespräch in Concordia (Kapitel 5) mit demselben Baustein; Eisenwald weiter grün (`npm test`, `npm run check`, Golden).

## 6. Schätzung
**5–6 Studio-Tage** (Briefing 4–5): Schablone Kantenstein (Handbau, Taverne, Landepunkt) 1,5; Kulisse + `kulissePos` + Zeichnen 1,5; Gespräch (Server, Protocol, Baustein, Client, Auswahlfenster) 2; Texte, Tests, Bot, Snapshot-Messung 1. Unsicher: Handbau der Schablone (Aufwand für Innenraum) und Gespräch am Mehrspieler-Tisch (wer „besitzt“ die Wahl?).

## 7. Offene Fragen (nur Kai)
- N1: Gespräch mit mehreren Spielern: darf jeder weiterklicken, oder nur der Ansprechende? (Default: der Ansprechende; die anderen sehen mit, bei 15 s Inaktivität kann jeder weiter.)
- N2: Wirt/Gäste sprechen nur Zufalls-Sprechblasen (Atmosphäre) oder auch ansprechbar? (Default: nur Atmosphäre, nur Evert/Bote/Wirt ansprechbar.)
- N3: Zeitpunkt Boten-Gespräch Kapitel 5: Bote kommt zum Schiff oder Spieler gehen zu ihm? (Default: Bote wartet am Hafen von Concordia.)
- N4: Porträts für Evert/Bote im Captain-Funk (Z. B. für Kapitel 3 „Falle!“)? (Default: nein, nur Name; spätere Kunst.)
