# CONTRACT-ROLLEN – Vier Spieler, vier Rollen: Technik-Station, Hitze, Waffenautomatik

Grundlage: `Mechanik/Brückenrollen`, `Mechanik/Raumkampf` (Abschnitt 5 Hitze-Modell, „Ausweichen nach hinten, mit Hitze“),
`Mechanik/Schiffssysteme & Reparatur` im Vault (`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`).
Entwurf Stand 2026-10-11. **Gebaut wird erst nach den EK-Merges** (Abschnitt 9), auf einem eigenen Branch `rollen` von `ek1`.
Mit „(Kai)“ markierte Punkte sind entschieden, mit „(Vorschlag)“ nur vorgeschlagen, mit **OFFEN** wartet der Punkt auf Kai (Abschnitt 8).

## 0. Entscheidungen (Kai, 2026-10-11)
1. Das Spiel wächst von 1–3 auf **1–4 Spieler**; die **vierte Rolle Technik** wird vollständig umgesetzt (Konsole, Befehle, Hitze).
2. **Hitze** (Vault: Hitze-Modell) wird in diesem Contract mitgeplant, als eigene Stufe R2.
3. **Keine Zuteilung durch das Spiel.** Die Spieler regeln die Besetzung selbst; die Zusammenlege-Regeln aus `Brückenrollen` sind Absprache, kein Code.
4. **Automatik nur für die Waffen, nur bei 1 oder 2 Spielern.** Bei 3 oder 4 Spielern gibt es keine Waffenautomatik.
5. Konsole-Inhalt der Technik nach 4.3 bestätigt; Tab schaltet nur das Interface, der Spieler bleibt stehen (4.4).

## 1. Befund (Stand `ek1`, 4ebe750)
| Punkt | Stand |
|---|---|
| Spielerzahl | `C.maxPlayers = 3` (`shared/config.js:11`), geprüft beim Beitritt (`game.js:617`); 4. Spieler bekommt „Server voll“ |
| Spielerfarbe | Farben 0–2 gehören den Spielern (`applyColorWish`, `game.js:761`: `c < 3`); **Farbe 3 ist das Gästequartier** (Ivo, `maps.js` BEDS, Sprite `art.js:1879`) |
| Quartiere | 4 Betten auf dem Privatdeck (`BEDS`): 3 Spieler + Gast |
| Spawns | `SHIP_SPAWNS` 3 Einträge, `BOT_SPAWNS` 3; Index wird mit `%` umgelegt, der 4. Spieler stünde auf dem Feld des 1. |
| Truppstärke | `squadScale: { 1: 0.5, 2: 0.75, 3: 1 }` (`config.js:326`), für 4 undefiniert |
| Snapshot-Budget | Worst Case „Außenposten, 3 Spieler, 12 Gegner“ (`snap-mess.js`, `snapMax` 20 KB) |
| Konsolen | `helm`, `captain`, `weapons` (Anzeige „TAKTIK“), `transfer`, `shop`, `quartier`, `sonde`, `plan` (`protocol.js:213`). **Keine Technik-Konsole** |
| Technik-Aufgaben heute | alle beim **Captain**: `captain.power`, `captain.shield`, `captain.priority`, `captain.repair`, `captain.botAuto`, `captain.overload` (`game.js:949–977`); Captain-Konsole hat 6 Reiter, davon **„Energie & Schilde“ (Reiter 4) und „Schadensplan“ (Reiter 5) = Technik** (`consoles.js:32`) |
| Rechteprüfung | `CMD_CONSOLE[prefix]` + `p.console !== need` (`game.js:~928`); Konsole je Art exklusiv (`interior.consoleOccupant`) |
| Hitze | `ship.heat` je Power-System (engines, shields, weapons, life). **Nur Stufe 4 heizt** (+8/s), Kühlung passiv −4/s unter Stufe 4, bei 100 `heatDamage` (`space.js:471–480`). Feuern und Ausweichen heizen nicht; Ablassen gibt es nicht. Anzeige als Balken im Reiter „Energie & Schilde“ |
| Waffenautomatik | Lanze und Ladepunkte laufen **automatisch, sobald niemand an der Taktik sitzt** (`weaponsManned`, `space.js:823`, 836–870, 936–950), unabhängig von der Spielerzahl; halbe Feuerrate (`autoFactor`) |
| Bot-Automatik | `ship.botAuto` füllt die Reparaturliste, Standard an **bei genau 1 Spieler** (`bots.js:74`) |
| Tab | in der Captain-Konsole schaltet Tab/Shift+Tab die **Reiter** (`consoles.js:2450`) |
| Nicht vorhanden | Energie-Umbau „Bordsysteme als Module“ (Reaktor 8: 4 Module · Antrieb 2 · Schilde 1 · Waffen 1; Code: Standard 2/2/2/2 mit `life` als Power-System), Sauerstoff pro Bereich, **Entlüften** |
| Parallele Arbeit | Alle 11 EK-Worktrees enthalten `captain.power|shield|priority|repair|botAuto|overload` in `game.js`, `bots.js`, `consoles.js`, `dev-mock.js`, `sim-headless.js`, `test-combat.js`, `test-features.js`, `test-m3.js` |

## 2. Stufen
| Stufe | Inhalt | Abhängig von |
|---|---|---|
| **R0** | Kapazität 4 Spieler (Abschnitt 3) | – |
| **R1** | Technik-Station: Konsole, Befehle, Umzug aus der Captain-Konsole, Tab-Wechsel, Waffenautomatik ≤ 2 Spieler (Abschnitt 4) | R0 nicht nötig, aber sinnvoll zuerst |
| **R2** | Hitze: Waffen- und Ausweichhitze, Ablassen (Ventil), Warnungen (Abschnitt 5) | R1 |
| außerhalb | Energie-Umbau (Module), Entlüften (Abschnitt 6) | eigene Pakete |

R0 und R1 sind unabhängig baubar; R2 braucht die Technik-Konsole als Ort des Ablassens.

## 3. R0 – Kapazität 4 Spieler
| Teil | Änderung |
|---|---|
| Limit | `maxPlayers: 4`; Text „Server voll“ (`hud.js:1844`) und Lobby-Text „Koop für 1–4 Spieler“ (`hud.js:1046`), README, CONTRACT.md (Zeilen „vierter Spieler“) |
| Spielerfarbe | **OFFEN (A1, einzige offene Frage):** 4. Spielerfarbe. Farbe 3 ist heute der Gast. Vorschlag: Spielerfarben 0–3, **Gast bekommt Farbe 4** (5. Einzelquartier oder Gast ohne eigenes Quartier). Betrifft `applyColorWish` (`c < 3` → `c < C.maxPlayers`), `art.js:1879`, `BEDS`, Quartier-Konsole, HUD-Farben |
| Spawns | `SHIP_SPAWNS` auf 4 Einträge (freie Kachel in der Brücke), `BOT_SPAWNS` bleibt |
| Truppstärke | `squadScale: { …, 4: 1.25 }` (aufgerundet) – Wert Vorschlag, im Spiel prüfen |
| Plan-Tisch | `C.plan.maxSeated` prüfen (4 Personen am Tisch?) |
| Außeneinsatz | Spawn-Kacheln und Pads der Außenkarten (`PLATFORM_PADS` 3 Einträge, Anker/Startpunkte der Karten) für 4 Personen prüfen |
| Snapshot | Worst Case auf 4 Spieler umstellen (`tools/snap-mess.js`, `QA-INTEGRATION`, Kommentar `config.js:136`); `snapMax` 20 KB bleibt, `snapLuft` prüfen |
| Tests | Fixture „3 Spieler“ in `test-combat`, `test-features`, `test-wellen`, `test-konvoi`, `test-escort`, `sim-headless`; neuer Test: 4. Spieler tritt bei, eigene Farbe, eigener Spawn, 5. wird abgewiesen |

## 4. R1 – Technik-Station
### 4.1 Konsole und Ort
- Neue Konsole `technik` in `Protocol.CONSOLES`; Legendenzeichen `console_technik` (freies Zeichen wählen) im **Maschinenraum mittschiffs** (Raum x 11–15, neben Reaktor `R`, Schilde `G`, Lebenserhaltung `O`).
  Kachel wählen, die den Durchgang nicht verstellt (Vorschlag: Westwand des Raums, Zeile 5–7). Sprite in `art.js` nach dem Muster `console_captain`.
- Exklusiv je Art wie alle Konsolen (`consoleOccupant`); keine Sonderfälle.
- **Reparieren bleibt ein Weg zu Fuß** (Kai, 2026-10-09; `interior.repairCmd`, ohne Konsole) – unverändert.

### 4.2 Befehle (neu, nach Intention benannt – keine Flags an bestehenden)
| Neu (Präfix `technik.`, Konsole `technik`) | Bisher | Server-Funktion (umbenannt) |
|---|---|---|
| `technik.power { sys, delta }` | `captain.power` | `space.technikPower` (war `captainPower`) |
| `technik.shield { sector, delta }` | `captain.shield` | `space.technikShield` (war `captainShield`), Ereignis `shieldsChanged` bleibt |
| `technik.priority { target }` | `captain.priority` | – |
| `technik.repair { system, mode }` | `captain.repair` | `bots.queueRepair` |
| `technik.botAuto { on }` | `captain.botAuto` | `bots.setBotAuto` |
| `technik.overload` | `captain.overload` | `space.technikOverload` (war `captainOverload`) |

- `CMD_CONSOLE` bekommt `technik: 'technik'`; `Protocol` bekommt die Namen als Konstanten.
- Die alten `captain.power|shield|priority|repair|botAuto|overload` **antworten nur mit Hinweis** „Das macht jetzt die Technik.“ (Muster `captain.burst`, `game.js:962`). Kein stilles Weiterleiten, sonst bleibt die Rolle in der Praxis beim Captain.
- **Bleibt beim Captain:** `captain.accept|choice|selectDest|scan|support|listen|marker|order|escort`, Notfallsprung (Pilot oder Captain), Transporter (`transfer`-Konsole).
- Reaktor-Neustart (zwei Schalter im Maschinenraum) bleibt ein Weg zu Fuß.

### 4.3 Inhalt der Technik-Konsole (Kai, 2026-10-11: so richtig)
Die Reiter „Energie & Schilde“ und „Schadensplan“ ziehen **unverändert** aus der Captain-Konsole um; die Technik hat damit sofort Inhalt. Vorschlag:
| Reiter | Inhalt |
|---|---|
| 1 Energie & Schilde | wie heute: Reaktor, Energie je System, Schildverteilung, Hitzebalken, Überladen |
| 2 Schadensplan | wie heute: Schäden, Reparaturliste, Bot-Auto, Priorität Feuer/Leck |
| 3 Hitze (ab R2) | Ventile je Hauptsystem (Abschnitt 5), Hitzebalken groß |

Die **Captain-Konsole** behält 4 Reiter: Funk, Sternkarte, Lage, Außenteam. Der Captain sieht den Schiffszustand weiter **zum Ansehen** (Kai, 2026-10-07; Decksplan, Schilde klein im `shieldStrip`) – nur Schreibzugriff wandert.
Offen bleibt, ob die Technik einen **eigenen Maschinenraum-Look** bekommt (Schema, Rohre) oder dieselbe Konsolenoptik wie die Captain-Konsole (Vorschlag: zuerst dieselbe Optik, Art später).

### 4.4 Tab-Wechsel: Interface-Wechsel, der Spieler bleibt stehen (Kai, 2026-10-11)
- Heute schaltet Tab die Reiter der Captain-Konsole. Mit nur 4 Reitern reichen die Zifferntasten 1–4; **Tab wird frei** für den Stationswechsel.
- **Tab** (Shift+Tab rückwärts) schaltet das **Interface** auf die nächste **freie** Station in der Reihenfolge Navigation → Taktik → Captain → Technik (`helm`, `weapons`, `captain`, `technik`; frei = nicht von einem anderen Spieler gehalten). **Der Spieler bleibt physisch an seiner Konsole stehen**, es ändert sich nur, was er bedient. Wer allein ist, kann von jeder Konsole alles tun.
- **Zwei Größen im Server:** `p.console` bleibt der **Ort** (physische Konsole; Exklusivität, Verlassen mit Taste, Kollision), neu `p.station` = **aktives Interface** (`null` = wie `p.console`). Die Rechteprüfung in `onCmd` (`CMD_CONSOLE`, `game.js:~928`) prüft gegen `p.station || p.console`, nicht mehr nur `p.console`. Snapshot trägt `players[].station` nur, wenn es von `console` abweicht (Budget).
- **Besetzt** ist eine Station, wenn ein verbundener Spieler sie als `station` aktiv hat (sein Ort allein zählt nicht, wenn er auf eine andere umgeschaltet hat). Wer von Taktik auf Technik umschaltet, **verlässt die Taktik**: sie ist dann unbesetzt, und die Waffenautomatik greift, sofern ≤ 2 Spieler (4.5). Das ist dieselbe Regel wie „verlassene Station fällt auf Automatik“ aus dem Vault.
- Eine freie Station, die ein Spieler per Tab belegt, ist für andere gesperrt (Hinweis „Taktik: durch <Name> besetzt“), bis er sie verlässt (Tab weg, Konsole verlassen, Trennen, Niederschlag).
- Der physische Ort bestimmt weiterhin **Reparieren zu Fuß** (Kai, 2026-10-09): Wer losläuft, verlässt Ort und Station.
- Tab nur in Zone `ship`, nicht `downed`, nicht `beamLock`; ohne freie Station tut Tab nichts (Hinweis).
- Kein Zwang zur Zuteilung: Wer welche Station hält, entscheiden die Spieler (Entscheidung 3).
- Konsolen mit eigener Bedienlogik am Ort (`transfer`, `shop`, `quartier`, `sonde`, `plan`) gehören **nicht** zum Tab-Kreis.

### 4.5 Waffenautomatik nur bei 1 oder 2 Spielern (Kai)
- Neue Prüfung `space.waffenAutomatikAktiv(game)` = verbundene Spieler ≤ 2 **und** Taktik unbesetzt (Station, siehe 4.4). **Nicht** mehr nur `!weaponsManned`.
  Sie steuert: Lanzen-Automatik (`space.js:936–950`), automatische Ladepunkt-Verteilung (836–845), halbe Feuerrate (`autoFactor`, 870).
- Bei **3 oder 4 Spielern** und unbesetzter Taktik: kein Feuer, keine Lanzenladung; die zuletzt gesetzte Ladepunkt-Verteilung bleibt stehen (nachprüfen, wo sie liegt). Wenn niemand schießen will, schießt niemand; man muss es von Hand tun (Kai, A7) – gewollt.
- Der Wechsel zwischen 2 und 3 Spielern mitten im Kampf schaltet die Automatik sofort um; ODA sagt es an (Vorschlag: „Taktik unbesetzt, Automatik aus.“ bzw. „… Automatik an.“).
- Die vom Vault beschlossene schwache Automatik für **Navigation** (Kurs halten) und **Captain** (ODA) gilt unverändert („Kurs hält“ ist die Physik, ODA gibt es). **Technik:** Bot-Automatik – **bei genau 1 oder 2 verbundenen Spielern** an (Kai, A4; heute nur bei 1), `bots.updateBotAuto`; die Wahl per `technik.botAuto` gilt danach weiter.

### 4.6 Texte, Tutorial, Inhalte
- `m1`/`m2`/`m3`/`k1`/`k5` (`content/regiebuecher/*`): Texte mit „Captain verteilt Schilde“, „Captain setzt im Reiter Schäden Prioritäten“, „Captain: Energie auf Schilde und Waffen“ (`m1` Zeilen 582, 595, 599, 601, 656 u. a.) auf **Technik** umstellen. Ereignis `shieldsChanged` bleibt, Prüfung `console_manned: captain` bleibt für den Funkspruch.
- Tutorial lehrt die Technik in m1 (Schild) mit; bei 1–2 Spielern sagt ODA, wo die Technik-Konsole liegt (Vorschlag: Ziel „Maschinenraum: Technik-Konsole betreten“ analog `ziel.captain_konsole`).
- Hinweise im HUD und in der Hilfe (`hud.js`, Reiter-Beschriftungen, `dev-mock.js` Szenen).

### 4.7 Tests, Bots (R1)
- `tools/sim-headless.js` (Bots), `test-m3`, `test-combat`, `test-features`: Aufrufe `captain.power|…` auf `technik.*` und die Bots an die Technik-Konsole setzen (ein Bot-Spieler schaltet per Tab-Befehl zwischen Stationen, ohne den Ort zu wechseln).
- Neu: `tools/test-rollen.js` (in `npm test`): Konsole Technik betreten/exklusiv, alte Befehle weisen ab, Rechteprüfung (`technik.power` ohne Konsole abgelehnt), Tab-Reihenfolge, Sperre belegter Stationen, Rechteprüfung gegen `station`, Taktik unbesetzt nach Umschalten, Waffenautomatik bei 1/2/3/4 Spielern (Lanze schießt automatisch nur bis 2).
- Golden-Tests m1–m3: Verhalten gleich bis auf Konsole (Messwerte im Contract-Anhang nach Lauf eintragen).

## 5. R2 – Hitze (Vault: Hitze-Modell, Kai 2026-10-09; Zahlen = Startwerte, Balancing im Spiel)
- **Ein Hitzewert je Hauptsystem** (`engines`, `shields`, `weapons`); `life` behält die heutige Stufe-4-Hitze, bis der Energie-Umbau kommt.
- **Quellen:** Stufe 4 (+8/s, besteht); **Feuern mit Energiewaffen** (`phase_l`, `phase_r`, `seitenturm`: + je Schuss 12 auf `weapons`); **Ausweichen** (+30 auf `engines`). **Keine** Zusatzhitze für die Lanze (Aufladen = Strafe genug) und keine für den Bolzenwerfer (kostet Munition).
- **Ausweichen** (Vault „Ausweichen nach hinten, mit Hitze“): Abklingzeit 7 s → 2 s (nur gegen Dauerdrücken), **Hitze wird zur Grenze**. Die neue Richtung „nach hinten“ (Abstoppen) ist Teil des Vault-Entwurfs, aber **nicht Teil dieses Contracts** – wer das baut, entscheidet Kai (Raumkampf-Paket).
- **Kühlung:** passiv −4/s unter Stufe 4 (besteht); aktiv durch die Technik (`technik.vent { sys }`, Konsole `technik`, Reiter Hitze): **Ventil-Minispiel 2–3 s**, Erfolg −60, Fehlschlag −15. Das Minispiel nutzt die vorhandene Aktionsanzeige (`players[].action`, `game.js:1480`) oder die bestehenden Reparatur-Minispiele als Vorlage (Bedienung nach Kai, A5: **Zeiger in einer Zone anhalten**).
- **Folgen:**
  - ab 70: Warnung (ODA, einmalig je Anstieg; Balken rot, wie heute `consoles.js:1012`) – der **Ruf an die Technik** („Antrieb heiß!“) ist gewollt.
  - ab 80: **Waffen:** Ladegeschwindigkeit halbiert („Feuer wird langsamer“, Vault); **Antrieb:** Ausweichen gesperrt; **Schilde:** Regeneration halbiert.
  - bei 100: wie heute `heatDamage` (Hitze → 0, System beschädigt).
- **Sichtbarkeit:** Hitzebalken zusätzlich klein an der Steuer- und der Taktik-Konsole (nur Anzeige), damit Navigation und Taktik wissen, wann sie die Technik anrufen müssen. Snapshot trägt `ship.heat` schon (`game.js:1766`).
- Beim Umschalten der Station (Tab) läuft ein begonnenes Ventil-Minispiel nicht weiter (Abbruch ohne Wirkung).
- Tests: `test-hitze` (Quellen, Kühlung, Schwellen, Ventil Erfolg/Fehlschlag, Ausweichsperre bei 80, Lanze ohne Zusatzhitze), Golden-Läufe unverändert, wenn keine Hitze entsteht (Stufe ≤ 3, keine Energiewaffen im Einsatz) – sonst Messwerte nachziehen.

## 6. Außerhalb dieses Contracts (Schnittstellen vorgemerkt)
| Paket | Warum nicht hier | Schnittstelle |
|---|---|---|
| **Energie-Umbau** (Reaktor 8, Module je 1 Punkt: Lebenserhaltung, Krankenstation, Lager, Transporter; Standard Antrieb 2 · Schilde 1 · Waffen 1) | verschiebt die Balance aller Missionen und Gegnerwerte, Golden-Tests neu messen | Reiter „Energie & Schilde“ erhält Module als eigene Zeilen; Befehl `technik.module { id, on }` |
| **Entlüften** | braucht Sauerstoff pro Bereich und Feuer-braucht-Luft (Vault: zusammen mit Enterabwehr bauen) | Befehl `technik.vent` ist bereits für Hitze belegt; Entlüften bekommt `technik.entlueften { bereich }` |
| **Ausweichen nach hinten** | Raumkampf-Paket | siehe Abschnitt 5 |

## 7. Reihenfolge und Aufwand (Schätzung, ungeprüft)
1. **R0** Kapazität (klein, Farbe und Gästebett sind der größte Teil).
2. **R1** Technik-Station (Hauptteil: Konsole, Umzug, Tab, Automatik, Texte, Tests). Vault schätzt „Rollen“ mit 1–2 Einheiten; wegen 8 bis 11 betroffener Dateien je Worktree eher oberes Ende.
3. **R2** Hitze (eigene Stufe; Balancing braucht Spielabende).

## 8. Entscheidungen und offene Fragen
| # | Frage | Entscheidung |
|---|---|---|
| **A1** | Spielerfarbe 4 / Gast Ivo (Gästequartier = Farbe 3, geretteter Techniker von B-7, `technikerRescued`) | **OFFEN** – Vorschlag Farbe 4, 5. Quartier |
| **A2** | Technik-Konsole: Inhalt nach 4.3 | **ja** (Kai) |
| **A3** | Tab-Wechsel | **nur Interface, Spieler bleibt stehen** (Kai), siehe 4.4 |
| **A4** | Bot-Automatik | **bei genau 1 oder 2 Spielern** (Kai) |
| **A5** | Ventil-Minispiel | **Zeiger in Zone anhalten** (Kai folgt Vorschlag) |
| **A6** | Hitze-Schwellen 70/80/100 mit Folgen aus Abschnitt 5 | **ja** (Kai), im Spiel einstellen |
| **A7** | Verwaiste Taktik bei 3–4 Spielern | **schießt nicht**, nur manuell (Kai) |

## 9. Zusammenführen mit den EK-Branches
- Alle 11 EK-Worktrees ändern dieselben Dateien (`game.js`, `bots.js`, `consoles.js`, `dev-mock.js`, `sim-headless.js`, Tests). R1 benennt Befehle um und schiebt Reiter; das **kollidiert** mit jedem offenen EK-Branch, der `captain.power|…` neu nutzt.
- Daher: R0 kann vorher; **R1 erst nach den EK-Merges** (oder nach einer Einfrierung von `captain.*` in den EK-Branches). Danach `rollen` von `ek1`.
- `config.js`: R0/R2 tragen Werte ein (`maxPlayers`, `squadScale`, `power.heat*`); die EK-Teams ändern dort ebenfalls (Merge-Konflikte klein, aber sicher).
