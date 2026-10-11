# CONTRACT-EK – Index der Eisenwald-Kampagne (EK1–EK8)

Übersicht über die Pakete EK1–EK8: Vertrag, Stand, Testskript, bekannte Abweichungen. Die Verträge selbst sind maßgeblich; dieser Index
ersetzt sie nicht. Aufbau jedes Vertrags (wie `CONTRACT-W2.md`): Kopf mit **Stand**, nummerierte Abschnitte, Entscheidungen ohne Doppelvergabe
innerhalb einer Datei, am Ende **Offen**. Spieler- und Entwicklerübersicht: `README.md`, Abschnitt „Neu in der Eisenwald-Kampagne (EK1–EK8)“.

**Stand des Index:** 2026-10-11, alle Pakete fertig und in `ek1` gemergt. `npm test` (27 Skripte) Exit 0, `npm run check` grün (Karten 586, Sektoren 303, Kette OK).

## 1. Pakete

| Paket | Vertrag | Stand | Testskript (in `npm test`) | Bekannte Abweichungen und Hinweise |
|---|---|---|---|---|
| EK1a Korvette | `CONTRACT-EK1.md` Abschnitte 2–4 | fertig | `node tools/test-combat.js` | Golden m1/m2 Crew 1 weicht ab: `allow-ek1.json`. Korvette ohne Alias (D1). Seitenwechsel nach Waffenart entfernt (D16) |
| EK1b Fregatte, Kreuzer, Sprites | `CONTRACT-EK1.md` Abschnitte 5–8 | fertig (Server und Drehsprites) | `npm run test:klassen` | Kein eigener Sprite-Vertrag; Fregatte und Kreuzer nicht in den Wellen (D14) |
| EK2 Raum-Alarm | `CONTRACT-EK2.md` | fertig | `npm run test:alarm` | `ohne_strom` = Blindgänger (D9). Spielleiter-Kontext-Goldens bewusst neu geschrieben. `JAMMERS` blockiert auch ruhende Patrouillen |
| EK3 A Frachtraum | `CONTRACT-EK3.md` | fertig | `npm run test:lager` | Kein `allow-ek3a.json` nötig (Abweichungsliste leer). „Lager ohne Strom“ (`gesichert`) ohne Wirkung |
| EK3 B Konvoi | `CONTRACT-EK3B.md` | fertig | `npm run test:konvoi` | Solo-Konvoi nur mit Jäger-Eskorte (EK8 D26) |
| EK4 Flotte (EK4a, EK4b) und Orbit (Kapitel 6) | `CONTRACT-EK4.md` (Abschnitt 6: Orbit) | fertig | `npm run test:flotte`, `npm run test:orbit` | Funkporträt über `pid` vereinheitlicht. Kein Bot verlor je ein Schiff (Verlustpfade nur im Test) |
| EK5 Methalle | `CONTRACT-EK5-6.md` Abschnitte 1–6 | fertig | `npm run test:methalle` | Rohr nur als Mauerstück gezeichnet |
| EK6 Siedlung Eisenwald | `CONTRACT-EK5-6.md` Abschnitte 7–10 | fertig | `npm run test:eisenwald` | Solo-Regel: Legionär hisst mit, 5 + 1 Gegner (EK8 D30) |
| EK7 Karte | `CONTRACT-EK7.md` | fertig | `npm run check` (`tools/check-sektoren.js`), `npm run test:sektoren` | 16 statt 15 Hexe auf dem Weg (Vigilia unspielbar). Stern, Planeten, Bojen nicht gezeichnet |
| EK8 Kette | `CONTRACT-EK8.md` (4a: Verdrahtung Boden, 8b: Orbit) | fertig | `npm run check:kette`, `npm run test:kette`; Bots `npm run sim:kette` | Entscheidungen D24–D32 (VERK-BODEN) neu nummeriert. Alle acht Kapitel echt, 0 Platzhalter |

Spätere Verträge ersetzen einzelne Aussagen früherer: Wo ein früherer Vertrag „offen“ oder „Platzhalter“ sagt, aber ein späterer die Sache erledigt hat, ist der frühere
Punkt durchgestrichen und verweist auf den späteren (z. B. EK3 Teil B offen → `CONTRACT-EK3B.md`; EK5-6 Orte `methalle`/`eisenwald` → EK8 D31).

## 2. Entscheidungen der Studioleitung und bekannte Abweichungen

- **Golden-Trace:** m1–m3 (20 Seeds, 120 Traces) werden gegen `tools/fixtures/golden/base-w2` mit `tools/fixtures/golden/allow-ek1.json` verglichen
  (`node tools/golden-trace.js --compare tools/fixtures/golden/base-w2 <neuer Ordner> --allow tools/fixtures/golden/allow-ek1.json`). Ergebnis in allen Paketen: **GOLDEN GRÜN**,
  80/120 Traces byte-identisch; die 40 anderen sind die Crew-1-Läufe von m1/m2 mit der Korvette aus EK1a (Mediane m1/1 −6,7 %, m2/1 +2,1 %). `golden-trace.js` nimmt nur **eine** `--allow`-Datei,
  darum enthält `allow-ek1.json` die Einträge von `allow-w2.json` mit. Weitere Allow-Dateien (`allow-ek1b`, `allow-ek2`, `allow-ek3a`) wurden nicht gebraucht und gibt es nicht.
  Das Paket VERK-ORBIT hat Golden nicht gefahren (Tutorial- und Raumpfade nicht berührt).
- **Korvette ohne Alias** (EK1 D1): `gunboat` ist vollständig umbenannt; die Voxelwerk-Datei `rostmeute_kanonenboot.json` und ältere Golden-Basen behalten den alten Namen (D2, D4).
- **`ohne_strom` = Blindgänger** (EK2 D9): zündet nicht, kein Alarm; die Kampagne nutzt den Parameter nicht.
- **Seitenwechsel nach Waffenart entfernt** (EK1 D16): Die Breitseiten-KI wechselt nur nach Schildstand und Lage, weil `test-escort` mit der Waffenart-Regel fiel. `test-escort` ist seitdem grün (84/84).
- **Funkporträt vereinheitlicht auf `pid`:** Funkspruch und Snapshot (`mission.radio.pid`) tragen die Kennung `legat` oder `mars` (EK4). `besetzung.stimmen.<id>.bild` ist nur die Eingabe im Regiebuch;
  EK8 D9 nannte ursprünglich `bild` als Ereignisfeld, der Code führt `pid`. (Der Kommentar in `shared/protocol.js` Zeile 302 nennt noch `bild`, ein Code-Kommentar, nicht in dieser Doku-Runde geändert.)
- **Katalog-Kurzfassungstest** (`tools/test-spielleiter.js`, „Katalog-Kurzfassung … −40 %“): vergleicht die Kurzfassung gegen die **aktuelle** volle Fassung des Katalogs (der Katalog wächst mit jeder Umsetzung),
  nicht gegen eine feste Größe. Die Spielleiter-Kontext-Goldens (`tools/fixtures/context/*`) wurden bei EK2, EK4 und EK5/6 bewusst mit `--update` neu geschrieben.
- **Solo-Regeln der Kampagne** (nur bei höchstens einem verbundenen Spieler, Mehrspieler unverändert): Konvoi nur mit Jäger-Eskorte (EK8 D26), Siedlung mit Legionär und 5 + 1 Gegnern (EK8 D30).
- **Störsender-Regel `JAMMERS`** (`server/sim/sprung.js`): vom Studio nicht am Raumkampf geändert; Kapitel 2 und 3 umgehen sie über `enemies_retreat`.
- **Snapshot-Werte** in den Verträgen sind der Stand ihrer Abnahme. Heutiger Lauf `npm run snap:mess` (Ziel ≤ 18 944 B): worst 11 327 B, wellen 10 558 B, raum-alarm 11 384 B, methalle 10 526 B,
  endkampf 11 361 B, konvoi 8 258 B, flotte 11 851 B, orbit 13 842 B. (Der „Worst Case 11 444 B“ in EK1–EK5 stammt aus der Zeit vor den Generatorkarten.)

## 3. Offen (Zusammenfassung)

Die vollständige Liste mit Quellen steht in `concept/buehnen/OFFEN-STUDIO.md`, Abschnitt „Neu offen nach EK1–EK8“. Kurz: Balance und Lesbarkeit mit Menschen (EK9), Texte sind Entwurf,
`JAMMERS`-Regel, Nebel in der Kampagne, Reparatur im Hafen, Datenorte ohne gezeichneten Stern/Planeten/Boje, Voxel-Ansicht ohne Flottenelemente, Abspann beendet die Partie für alle.
