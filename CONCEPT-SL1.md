# CONCEPT-SL1 – Karte Sund: Kartenwahl, Kante enthüllen, Start am Boden

Grundlage: Briefing `Briefing Die Schuld der Lerche (SL0-SL12)` (SL1), Vault-Notizen `Karte Sund` (+ `karte_sund.py`), `Kampagne Die Schuld der Lerche`, `Sektoren & Sprünge`; Kais Entscheidungen 2026-10-14.
Stand: **Konzept, nicht gebaut.** Alle Code-Angaben aus dem Studio-Prüfbericht vom 2026-10-13 (Stand `87ff7a7`), stichprobenhaft; „(ungeprüft)“ markiert Vermutungen.
Abhängigkeiten: keine. SL1B, SL2, SL3, SL4, SL10, SL11 hängen an SL1.

## 1. Befund
| Punkt | Stand (Code) |
|---|---|
| Karte | `shared/sektoren.js:11` lädt `content/welt/limes.json` per `require`, prozessglobal. Serverseitig ruft niemand `setzeKarte` (`:41`); der Client bekommt `welcome.sektorkarte` (`public/js/client.js:664`, `starmap.js:72`). Eine Kartenwahl gibt es nicht |
| Orte | `shared/locations.js` hat Limes-Orte fest (`hafen` :20, `b7` :43, `kesh` :109), leitet nur `links`/`LOCKED_LINKS` aus der Karte ab (Hook `beiKarte`, `sektoren.js:58`). Orte mit `gen:true` baut `gen-sektor.js` aus dem Hex-Eintrag (`sektoren.js:163`) – das trägt Sund ohne Eingriff in `locations.js` |
| Startort | `Locations.START = 'hafen'` (`locations.js:161`) wird gelesen in `server/game.js:365,406,853,865`, `server/sim/explore.js:23,85`, `server/weltstand.js:675,783`, `server/mission/checker.js:538`, `szenenbau.js:106` (nur Spielleiter), `space.js:98`, `mission.js:445`. Dazu `KNOWN_AT_START: ['hafen','splitter']` |
| Verborgene Kanten | Als Daten da (`art:'hidden'`), aber sperrt die Engine bewusst: `sprung.js:332` (`oeffnen`), `:368` (`bojeAufdecken`), `explore.js:275` (`kanteOffen` nie), `:283` (`bojeBekannt` nie), `:300` (Weitscan nie). **Das Briefing nimmt das als vorhanden an – es ist neu zu bauen** |
| Leerraum, temporärer Sprungpunkt | vorhanden: `sektoren.js:143` (`leer-<hex>`), `sprung.js:325` (`oeffnen {temp, bis}`), `jpSnapshot` Zustand `temporaer` (`:389`). Kette/Bausteine rufen `oeffnen`/`schliessen` |
| Tutorial-Überspringen | `mission.js:259-296` ruft `openTutorialMap` (`:451`), das alle `LOCKED_LINKS` und **alle Limes-`LOCATIONS`** öffnet/bekannt macht – würde Sund verschmutzen |
| Schnellsprung | gebaut (Route über erkundete Sektoren); auf Sund nur nutzbar, wenn Erkundungsstand und Kanten stimmen |
| Tests | `tools/check-sektoren.js:46` prüft hart id `limes`, 10×8; `tools/test-sektoren.js:54` ebenso; `tools/test-labor.js:41` prüft `LOBBY_MODI` als exakte Liste |
| Sternkarte (Client) | `public/js/starmap.js` kennt die Ansichten `'saumraum'` und `'limes'` (Z. 775) – Limes-spezifisch, Rest siehe SL1B |

## 2. Entwurf
### 2.1 Datenmodell
- `content/welt/sund.json`, `format: 'sektorkarte/1'`, `id: 'sund'`, 11×7, erzeugt aus `karte_sund.py` (einmalig, danach ist die Datei die Quelle wie bei Limes, E31). Orte mit `gen:true` und `ort`-ID: `kantenstein` (Hafen klein, Handkarte, SL2), `concordia` (Hafen Handel), `pulverhorn`, `gasfeld`, `forschung`-Hex ist **Leerraum** (kein Eintrag, `leer-<hex>`). `schrottkante` und `altrost` sind `verborgen:true` mit `art:'hidden'`-Kanten. **Altrost ist nur Textkontakt in Concordia** (Kai): Hex bleibt `spielbar:false`, keine Szene in dieser Fassung; die Szene `9B Altrost` rückt in SL9 (offene Frage Z1).
- Neue Kartenfelder (optional, abwärtskompatibel): `"start": { "ort": "kantenstein", "bekannt": ["kantenstein"], "boden": true }`, `"tutorial": false`. Fehlt `start`, gilt `hafen` (Limes).
- Verborgene Kante bekommt `"key": "<schluessel>"` (z. B. `lager-schrottkante`). Weltstand-Schlüssel wie `kesh`/`tutorial-ende` (`explore.linksOpen`, `schluesselFakt`): die Kante gilt als **enthüllt**, wenn der Schlüssel offen ist. Neu: zwei Zustände je Schlüssel – `enthuellt` (Boje sichtbar, Sprung noch gesperrt wäre unlogisch, daher fällt beides zusammen: enthüllt = bekannt **und** befahrbar).
- Weltstand: `karte: 'sund'` im Speicherstand (Fakt `welt_karte`, gleiche Mechanik wie Fakten `kampagne`/`kapitel`). Beim Laden entscheidet dieser Fakt die Karte **vor** `Weltstand.apply`.

### 2.2 Layer-Schnitt (nach CLAUDE.md)
- **Storage** (Weltstand/Explore): `ex.linksOpen` + Fakt `welt_karte`; der Zustand „aktive Karte“ liegt im Spiel (`game.karte`), nicht mehr im Modul-Singleton. Snapshot `world.sektoren` bleibt, bekommt `karte` (Id) einmal im `welcome`.
- **Action** (neue, intention-benannte Funktionen, keine Flags an `oeffnen`):
  - `server/sim/welt.js` (neu): `welt.waehle(game, id)` (setzt `Sektoren.setzeKarte`, leitet Locations-Links neu ab, setzt Start), `welt.startOrt(game)` (ersetzt `Locations.START` in allen oben genannten Stellen; Rückfall `hafen`), `welt.bekanntBeiStart(game)` (ersetzt `KNOWN_AT_START`).
  - `sprung.js`: `kanteEnthuellen(game, kanteId|schluessel)` (öffnet Schlüssel, markiert Boje, emittiert `kanteEnthuellt`), `kanteVerbergen(game, ...)` (Labor/Tests). Bestehende Ablehnungen bei `hidden` bleiben für Kanten **ohne** offenen Schlüssel.
  - Neue Regiebuch-Bausteine in `server/mission/bausteine/` (Registry `define`, Aktion `kante_enthuellen { kante|schluessel }`, Prüfung `kante_offen`), damit SL5/SL11 es aus Daten ansprechen. Zeichen-/Regelbausteine, nicht kampagnen-spezifisch.
- **Frontend**: Client liest `welcome.sektorkarte` (hat er schon), `starmap.js` Ansicht-Namen (`limes`) werden aus der Karte abgeleitet (SL1B). Lobby-Modus: `protocol.js` bekommt `schuld_der_lerche` (+ Label, Hinweis) in `LOBBY_MODI`, `START_LABELS`, `START_HINTS`, `CAMPAIGN_STARTS`, `CAMPAIGN_KETTEN: { kampagne:'schuld-der-lerche', tutorial:false, welt:'sund' }`; HUD-Labels (`hud.js:1126,1239,1402`) aus `START_LABELS` statt Kettenverzweigung.

### 2.3 Kartenwahl beim Spielstart (Kern)
`game.startGame` (`game.js:839-870`) ruft vor Weltstand und vor `startCampaignMission` `welt.waehle(game, CAMPAIGN_KETTEN[sm].welt || 'limes')`. `Sektoren`/`Locations` bleiben Module, aber ihr Zustand ist **je Partie gesetzt, nicht je Prozess gewählt**. **Annahme:** ein Prozess spielt eine Partie zugleich (ungeprüft, siehe Z2); sonst muss `Sektoren` instanzgebunden werden (~+2 T, Eingriff in alle `require`-Nutzer). Beim Beenden/Lobby-Rücksprung `welt.waehle(game,'limes')` zurück, damit Eisenwald, Labor, Wellen unverändert laufen. `welcome` sendet die aktive Karte; der Client ersetzt sie (`SS.setzeKarte`) – existiert.

### 2.4 Start am Boden, Lerche im Orbit
Der Code nimmt an: Partie beginnt **angedockt im Hafen** (`game.js:365,406`: `docked:true`, `dockedAt: START`; `explore.arrive(START)` :865; Weltstand lädt „letzter Hafen“ `weltstand.js:675,783`). Für Sund: `ship.scene = 'kantenstein'`, `docked:false`, Lerche in der Umlaufbahn (Szene-Mitte, Schub 0), Außenteam auf der Handkarte `kantenstein.siedlung` (Landepunkt `landepunkte.json`-Eintrag). Zu klären/prüfen, bevor SL1 gebaut wird (**Spike, 0,5 T**): ob Spieler `zone:'away'` am Start überhaupt gesetzt werden können ohne vorherigen Beam (ungeprüft: `interior.js`/`away.js` setzen `zone` beim Beamen); ob die Frachtraum-/Konsolen-Logik am Boden ohne `dockedAt` stabil ist. Rückfall bei Problemen: Start in der Lerche **angedockt in Kantenstein** mit Kapitelkarte „Geht an Land“ (Verlust: Kai wollte den Boden-Start; Entscheidung Kai erst nach Spike).
Weltstand: `lastDockedAt` bleibt leer, bis zum ersten Andocken; `Weltstand.apply` darf dann nicht auf `START` zurückfallen, sondern auf `welt.startOrt`. Checker/`HEIMATHAFEN`-Regeln (Gefangennahme nie am Heimathafen): `welt.heimathafen(game)` statt Literal, damit die Regel für Kantenstein/Concordia konsistent bleibt.

### 2.5 Tutorial-Überspringen auslassen
`startCampaign` mit `tutorial:false` und `kette` ruft heute `tutorialUeberspringen()`. Neu: Schema-Feld `tutorial` wird **optional**; fehlt es oder ist `tutorial: null`, entfällt der Aufruf, `kette.starten()` beginnt sofort. `openTutorialMap` wird nur bei vorhandenem Tutorial-Pflicht-Pfad gerufen. Folge: `kampagne.schema.json` (`required` ohne `tutorial`), `kampagne.js` `tutorialEnde`/`einstieg` (Zeile 299 `tutorialUeberspringen`, 321 `tutorial.oeffnet`) null-sicher.

## 3. Schnittstellen / Flags
- Aktion `kante_enthuellen`, Prüfung `kante_offen`, Ereignis `kanteEnthuellt { kante }` (für Missionsereignisse, Chronik). Schlüssel der Karte Sund: `lager-schrottkante`, `altrost-weg` (nur Daten, SL9).
- `welt.startOrt/heimathafen/bekanntBeiStart` – SL2/SL3/SL11 benutzen nie wieder `Locations.START`.
- `CAMPAIGN_KETTEN[*].welt`; `karte.start`, `karte.tutorial`.
- Leerraum-Ort der Forschungsstation: `leer-<hex>`, temporärer Sprungpunkt per `sprung.oeffnen {temp:true, bis:'mission'}` – SL7 hängt daran, SL1 stellt nur Hex und Verbindung bereit (Nachbar Gasfeld/Concordia), prüft per Bot.

## 4. Entscheidungen
| Nr | Entscheidung | Begründung |
|---|---|---|
| D1 | Kartenwahl je Partie über `welt.waehle`, Karte bleibt Modul-Zustand | geringster Eingriff; `beiKarte`-Hook ist die vorhandene Naht |
| D2 | Enthüllen = Weltstand-Schlüssel, enthüllt = bekannt + befahrbar | gleiche Mechanik wie `kesh`/`tutorial-ende`, Speichern/Laden gratis |
| D3 | `Locations.START` entfällt als Konstante, `welt.startOrt` | eine Quelle für 9 Stellen |
| D4 | `tutorial` im Kettenschema optional | Sund hat keines, nichts zu überspringen |
| D5 | Altrost nur Textkontakt (Kai) | Szene gehört in SL9 |
| D6 | Weitere Hexe `spielbar:false` mit Region-Sperrtext | wie Limes, kostet nichts |

## 5. Abnahme
Bot und Labor befahren alle Kampagnenwege (Kantenstein → Concordia → Pulverhorn, Gasfeld, Leerraum-Hex mit temporärem Sprungpunkt); `schrottkante` unerreichbar, bis `kante_enthuellen`, danach befahrbar, gespeichert/geladen; Schnellsprung auf Sund; Wechsel Sund → Lobby → Eisenwald lädt die Limes-Karte (Eisenwald-Kette `npm run sim:kette` grün, `npm test`, `npm run check`, Golden grün); Start am Boden (oder Rückfall) per Bot; `check-sektoren` prüft beide Karten (`limes` unverändert, `sund` neu).

## 6. Schätzung
**4–5 Studio-Tage** (Briefing: 2–3). Aufteilung: Karte/Daten 1, `welt.js` + Startort-Umbau 1,5, Kante enthüllen + Bausteine 1, Start am Boden 0,5 (Spike) bis 1, Tests 0,5–1. Unsicher: Start am Boden und Ein-Partie-pro-Prozess.

## 7. Offene Fragen (nur Kai)
- Z1: Szene Altrost entfällt in SL1 – wird sie in SL9 als eigener Hex mit Szene gebaut oder bleibt das ganze 9B ein Textkontakt + Söldner per Marke (Default: Szene in SL9 später)?
- Z2: Läuft je Prozess immer nur eine Partie? (Default: ja; sonst +2 T.)
- Z3: Wenn der Boden-Start im Spike nicht trägt: Rückfall „angedockt in Kantenstein“ akzeptiert? (Default: ja.)
