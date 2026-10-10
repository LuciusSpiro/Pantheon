---
status: angenommen
quelle: llm
erstellt: 2026-10-08T14:12:01.233Z
auftraggeber: sela
titel: "Sicheres Geleit durch die Graue Weite"
kennung: 2026-10-08_sl_2_geleit_nebel
---

# Sicheres Geleit durch die Graue Weite

> Review: Status oben auf `angenommen` setzen (oder `npm run missionen -- annehmen 2026-10-08_sl_2_geleit_nebel`) – dann gehört die Mission
> zum Vorrat der Standard-Missionen. `abgelehnt` sortiert sie aus. Diese Datei wird aus `mission.json` erzeugt; nur Status
> und der Abschnitt „Notizen“ bleiben beim Neuschreiben erhalten.

| | |
|---|---|
| Auftraggeber | Sela (Vaelen-Händlerin) (`sela`) |
| Quelle | llm, Modell sonnet, 42894 Tokens |
| Welt / Anlass | `w-xb82` – debug |
| Zieldauer | 15 min |
| Belohnung | 150 Marken |
| Ziel | Graue Weite |
| Szenen | 5 |

## Pitch

Meine Karawane muss durch die Graue Weite – die Rostmeute hat die Route ausgespäht. Ihr seid das einzige Schiff, das schnell genug wäre.

## Erinnerung

„Sela hat gehört, dass die Lerche das Kustoden-Relais geweckt hat – wer mit solcher Technik umgehen kann, dem traut sie zu, ihre Karawane durch den Nebel zu bringen.“ – Bezug: Fakt `kustoden_relais`

Ohne passende Erinnerung: „Sela (Vaelen-Händlerin) hat wieder Arbeit für die Lerche.“

## Szenen

### 1. s1_hafen – Hafen Lichtkordon

- **Szenentyp:** hafen · **Baustein:** – · **Plan:** 2 min
- **Sachverhalt:** Sela funkt vom Hafen aus: Die Vaelen-Karawane muss durch den Nebel nach draußen – Rostmeute-Jäger wurden gesichtet. Sie braucht die Lerche als Begleitschutz.
- **Weiter:** Auftrag angenommen → `s2_nebel_eingang`

**Ziele**

- Auftrag annehmen (Funk) – oder kurz warten

**Texte in Reihenfolge**

- **Funk – Sela (Vaelen-Händlerin):** „Meine Karawane muss durch die Graue Weite – die Rostmeute hat die Route ausgespäht. Ihr seid das einzige Schiff, das schnell genug wäre.“ *(Auftrag annehmen)*
- *(nach 6 s, Hinweis, falls nötig)* **ODA:** „Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.“

### 2. s2_nebel_eingang – Graue Weite

- **Szenentyp:** gefahrennavigation · **Baustein:** `kurs_durch_gefahr/nebelflug` · **Fassung:** llm · **Plan:** 3 min
- **Sachverhalt:** Die Lerche eskortiert die Karawane in die Graue Weite. Der Nebel macht jeden Scan blind – Pilot und Taktik müssen den Kurs gemeinsam halten, während Sela von Bord der Karawane meldet.
- **Wendung (Plan):** Ankündigung: Taktik erfasst schwache Antriebssignaturen – Rostmeute-Jäger lauern im Nebel.
- **Weiter:** Feld durchquert → `s3_angriff`

**Ziele**

- Nach Graue Weite springen
- Das Feld durchqueren (andere Seite erreichen)

**Texte in Reihenfolge**

- *(nach 90 s, Hinweis, falls nötig)* **ODA:** „Kurs liegt an: Graue Weite. Steuer: Ziel wählen, F für den Faltsprung.“
- *(nach 0.5 s)* **ODA:** „Der Nebel frisst jeden Scan. Pilot: Augen auf die Schubvektoren – Taktik: Weitscan läuft, Marker rein, sonst fliegen wi…“
- *(nach 10 s)* **ODA:** „Captain: Sternkarte und Taktikkarte zeigen den Ausgang auf der anderen Seite. Kurs ansagen!“
- *(nach 50 s)* **Wendung** `s2_rostmeute_lauert` – Ankündigung (gleichzeitig): ODA „Taktik meldet schwache Antriebssignaturen, zwei Kontakte, Kurs parallel zur Karawane – das sind keine Echos.“
  - **Funk – Sela (Vaelen-Händlerin):** „Lerche, ich sehe Lichtpunkte querab – das ist die Rostmeute. Bleibt nah!“
- *(nach 60 s, Hinweis, falls nötig)* **ODA:** „Ziel ist die andere Seite des Felds. Langsam ist sicherer – jeder Brocken kostet Schild.“
- *(sobald erfüllt)* **Wendung** `s2_nebel_eingang_hinterhalt` – Ankündigung (gleichzeitig): ODA „Jäger kommen aus dem Feld! Breitseite, und die Brocken als Deckung nutzen.“
- *(sobald erfüllt)* **ODA:** „Wir sind durch! Freie Sicht voraus.“
- *(Autolösung)* **ODA:** „Der Navigationsrechner hat eine Lücke gefunden – Kurs liegt an, wir sind durch.“

### 3. s3_angriff – Graue Weite

- **Szenentyp:** begegnung · **Baustein:** `taeuschen/bluff_funk` · **Fassung:** llm · **Plan:** 2 min
- **Sachverhalt:** Rostmeute-Jäger erscheinen und stellen die Lerche: Keld verlangt die Ladung der Karawane oder droht mit Gewalt. Der Captain muss entscheiden, wie er antwortet.
- **Weiter:** Bluff gelingt oder Crew weicht aus → `s4_geleit_kampf`

**Entscheidung:** Keld fordert die Ladung – wie antwortet der Captain?

- Wir sind Konkordat-Eskorte, greift ab. → Keld zögert kurz, schickt aber trotzdem Jäger – die Lerche hat jedoch einen Moment Vorsprung im Gefecht.
- Die Karawane transportiert nur Ballast, lohnt nicht. → Keld glaubt es nicht und schickt sofort Kanonenboot und Jäger ohne Vorwarnung.

**Ziele**

- Captain: antworten (Funk) – Ortung beachten

**Texte in Reihenfolge**

- **Funk – Rostmeute-Anführer Keld:** „Hier Keld von der Rostmeute. Ihr begleitet eine fette Karawane – die Ladung gehört jetzt uns. Gebt sie raus, oder wir machen Kleinholz aus euch beiden.“
- **ODA:** „Funkspruch! Gleich kommt die Ortung – hört genau hin, bevor der Captain antwortet.“
- *(nach 8 s)* **ODA:** „ODA: Ortung zeigt Keldsschiff – Backbord-Antrieb mit Hitzesignatur. Er ist nicht auf vollen Schub.“
- *(nach 10 s)* **Entscheidung** `s3_angriff_wahl`: „Keld fordert die Ladung – wie antwortet der Captain?“
  - Option `passend`: „Wir sind Konkordat-Eskorte – ihr wollt keinen Streit mit uns.“
    - **Funk – Rostmeute-Anführer Keld:** „Konkordat, ja? … Schert euch weg, diesmal lass ich's laufen.“
  - Option `falsch`: „Die Karawane fährt nur Ballast, kein Wert drin.“
    - **Funk – Rostmeute-Anführer Keld:** „Ballast? Ich rieche den Gewinn von hier. Jäger, raus!“
  - Option `wahrheit`: „Die Wahrheit sagen“
- *(nach 50 s, Hinweis, falls nötig)* **ODA:** „Die Gegenseite wird ungeduldig. Was hat die Ortung gesagt?“

### 4. s4_geleit_kampf – Graue Weite

- **Szenentyp:** geleit · **Baustein:** `schuetzen/geleit_durch_angriff` · **Fassung:** llm · **Plan:** 5 min
- **Sachverhalt:** Keld schickt Jäger und ein Kanonenboot auf die Karawane. Die Lerche muss sie abschirmen, bis die Karawane das Nebel-Ende erreicht.
- **Wendung (Plan):** Ankündigung: Sela meldet Triebwerksschaden an der Karawane – sie wird langsamer.
- **Weiter:** Karawane heil durchgebracht → Ausgang `erfolg`; Karawane schwer beschädigt → `s5_notbergung`

**Ziele**

- Karawane der Vaelen schützen – Hülle {escortHp:s4_geleit_kampf} %

**Texte in Reihenfolge**

- *(nach 0.5 s)* **ODA:** „Schützling: Karawane der Vaelen. Dranbleiben, Captain sieht Route und Befehle (Reiter „Schützling“).“
- *(nach 2 s)* **Funk – Sela (Vaelen-Händlerin):** „Lerche, wir nehmen Kurs. Bleibt dicht bei uns – der Nebel schützt uns nicht lange.“
- *(nach 8 s)* **Wendung** `s4_geleit_kampf_angriff` – Ankündigung (vorher, 5 s Vorlauf): ODA „Ortung: Jäger halten auf Karawane der Vaelen zu! Pilot: Breitseite zwischen sie und den Schützling.“
- *(nach 40 s)* **Wendung** `s4_triebwerksschaden_karawane` – Ankündigung (gleichzeitig): ODA „ODA: Karawane der Vaelen meldet Triebwerksschaden – Geschwindigkeit sinkt, Angriffsfenster für Keld öffnet sich.“
  - **Funk – Sela (Vaelen-Händlerin):** „Triebwerk zwei ausgefallen! Wir werden langsamer – haltet sie von uns fern!“
- *(nach 70 s, Hinweis, falls nötig)* **ODA:** „Lädt ein Gegner auf den Schützling, stellt euch dazwischen – unser Schild fängt die Ladung ab.“
- *(sobald erfüllt)* **Wendung** `s4_geleit_kampf_verstaerkung` – Ankündigung (vorher, 10 s Vorlauf): ODA „Ortung: Verstärkung im Anflug! Schilde zur Angriffsseite, Schützling dicht halten.“
- *(sobald erfüllt)* **Wendung** `s4_geleit_kampf_welle3` – Ankündigung (vorher, 10 s Vorlauf): ODA „Ortung: die nächste Welle hält auf Karawane der Vaelen zu! Dazwischen bleiben.“
- *(sobald erfüllt)* **Wendung** `s4_geleit_kampf_welle4` – Ankündigung (vorher, 10 s Vorlauf): ODA „Ortung: die nächste Welle hält auf Karawane der Vaelen zu! Dazwischen bleiben.“
- *(sobald erfüllt)* **Funk – Sela (Vaelen-Händlerin):** „Treffer am Rumpf! Wir können das Tempo nicht halten!“
- *(sobald erfüllt)* **ODA:** „Notruf! Captain: Befehl „Halten“ oder „Volle Kraft“. Taktik: wer lädt, wird zuerst beschossen.“
- *(sobald erfüllt)* **ODA:** „Karawane der Vaelen ist durch – heil. Die Angreifer drehen ab.“
- *(sobald erfüllt)* **ODA:** „Karawane der Vaelen ist durch, aber angeschlagen. Die Angreifer drehen ab.“
- *(sobald erfüllt)* **ODA:** „Karawane der Vaelen treibt kampfunfähig. Die Angreifer drehen ab – die Besatzung lebt.“
- *(Autolösung)* **ODA:** „Die Angreifer brechen ab. Karawane der Vaelen gibt volle Kraft – hinterher!“

### 5. s5_notbergung – Graue Weite

- **Szenentyp:** bergung_im_all · **Baustein:** `ladung_bergen/bergungskisten` · **Fassung:** llm · **Plan:** 3 min
- **Sachverhalt:** Die Karawane treibt, Frachtkisten sind ausgebrochen. Sela bittet die Lerche, wenigstens die wichtigsten Container zu sichern, bevor die Rostmeute sie holt.
- **Weiter:** Ladung gesichert oder Zeit abgelaufen → Ausgang `teilerfolg`

**Ziele**

- Bergungsgut einsammeln ({salvaged}/4)

**Texte in Reihenfolge**

- *(nach 3 s)* **ODA:** „Die markierten Container sind das Wichtigste – holt sie raus, bevor die Rostmeute sie krallt!“
- *(nach 45 s, Hinweis, falls nötig)* **ODA:** „Die Kisten sind auf der Taktikkarte grün. Der Pilot sieht nur nach vorn – Taktik, Marker setzen!“
- *(sobald erfüllt)* **ODA:** „Den Rest lassen wir treiben. Vielleicht findet es jemand Bedürftigeres.“

## Ausgänge

### erfolg

*Karawane heil durch den Nebel gebracht*

- Belohnung: 150 Marken
- Haltung Sela (Vaelen-Händlerin): +2
- Gedächtnis Sela (Vaelen-Händlerin) (`geleit_nebel_erfolg`): „Die Lerche hat die Karawane heil durch die Graue Weite eskortiert – Sela schuldet der Crew einen Gefallen.“
- Chronik: „Die Crew geleitete Selas Karawane sicher durch die Graue Weite und schlug die Rostmeute zurück.“
- Fakt `rostmeute_nebel` (offener Faden): „Die Rostmeute kennt jetzt die Vaelen-Route durch den Nebel.“

### teilerfolg

*Karawane beschädigt, aber Fracht teilweise gerettet*

- Belohnung: 150 Marken
- Haltung Sela (Vaelen-Händlerin): +1
- Gedächtnis Sela (Vaelen-Händlerin) (`geleit_nebel_teilerfolg`): „Die Lerche hat gerettet, was zu retten war – die Karawane wurde beschädigt, aber die wichtigste Fracht ist sicher.“
- Chronik: „Die Karawane erlitt Schäden im Nebel; die Crew sicherte den Rest der Ladung unter Beschuss.“

## Prüfer

- Warnung: FLAG-UNGELESEN flags: Flag 's3_angriff_geglueckt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's3_angriff_durchschaut' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_geleit_kampf_beschaedigt' wird gesetzt, aber in diesem Buch nie gelesen
- Warnung: FLAG-UNGELESEN flags: Flag 's4_geleit_kampf_verloren' wird gesetzt, aber in diesem Buch nie gelesen

## Gespielt

| Datum | Ausgang | Dauer | Crew |
|---|---|---|---|
| 2026-10-08 14:15 | erfolg | 3:14 | 3 |

## Notizen

_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._

- QA-Abnahme S2b: live im Spiel erzeugt (Debug `sl plan sela …`, Vorgabe Geleit), zu dritt gespielt mit Pausen und Debug-Skip
  je Schritt – „Gespielt 3:14“ ist **keine** Menschen-Spielzeit. Alle gespielten Szenen ausgearbeitet (4/4 gültig beim
  1. Versuch), 42 894 Tokens.
- QA-Einschätzung: plan-treu – Sela ist nur Auftraggeberin und Stimme, Gegenspieler ist ein neuer NSC (Keld, Rostmeute),
  Grauzahn kommt nicht vor. Geleit + Bluff + Notbergung passen zusammen. Schwächen: Erinnerung über den Fakt
  `kustoden_relais` ist für Sela etwas weit hergeholt; „teilerfolg“ zahlt dieselben 150 Marken wie „erfolg“.
