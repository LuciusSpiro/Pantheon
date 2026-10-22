# CONTRACT-PAN01-A – Energie und Bordmodule (PAN-01 Paket A)

Stand: 2026-10-18, Branch `pan01-a` (von `main` f15e3ae). Grundlage: Auftrag PAN-01 (Vault: `Pantheon/Auftrag PAN-01 – Lerche-Ausbau, Werft, Waffen und Module.md`), AP9.
Paket A gilt für das **heutige Schiff** (Grundriss unverändert). Paket B (neuer Grundriss, vier gleiche Modulräume) und Paket D (Werft, Shop-Pfad) bauen auf den Daten hier auf.

## 1. Energie

- Reaktor `CONFIG.power.reactor` = 8 (beschädigt 6, zerstört/offline 2 über `spaceM3.reactorBrokenOutput` bzw. `reactorM1.offlineOutput`; `power.reactorBroken` 3 gilt im Code nicht).
- **Energieposten:** Hauptsysteme Antrieb, Schilde, Waffen (`Protocol.POWER_SYSTEMS`, `ship.power`, 0–4 je System, Stufe 4 = Hitze wie bisher) und **jedes laufende Modul** (`CONFIG.module.energie` = 1).
  Transporter, Lager und Sensoren haben keinen Energieposten. **Lebenserhaltung** ist kein Posten mehr (nicht in `POWER_SYSTEMS`, nicht in `ship.power`/`ship.heat`, nicht in der UI);
  `CONFIG.o2.drainLifeBroken` = 0 (O₂ sinkt nur durch Lecks). Die Station `life` bleibt bis Paket B in `SYSTEM_ORDER` (14 Systeme, Reparatur, Weltstand), ist aber über
  `interior.INERT_SYSTEMS` von Treffern, EMP und Minen ausgenommen.
- Formeln der Hauptsysteme unverändert: Schildpool = E × 3, Ladepunkte = E + 2, Höchsttempo per `enginePowerFactor`; die **Drehrate hängt nicht an der Energie** (Entscheidung Paket A: bleibt so).
- **Standardverteilung** nach Bestückung (`CONFIG.module.standard`, freie Energie = 8 − Module an): 2 Module 2/2/2, 3 Module 2/2/1, 4 Module 1/2/1 (Antrieb/Schilde/Waffen). Gesetzt beim Start, beim Laden und bei jeder Debug-Bestückung (`Modul.verteilungSetzen`). Die Verteilung wird nicht gespeichert.
- `ship.reactor.used` = Hauptsysteme + laufende Module.

### Kürzung (`space.enforcePower`, jeden Tick)
Wunsch der Technik: `ship.powerIntent` (Hauptsysteme) und `module[].an`. Reicht die Reaktorleistung nicht:
1. Hauptsysteme von oben kürzen (höchster Wert zuerst, bei Gleichstand Waffen, Antrieb, Schilde), **nie unter 1**.
2. Reicht das nicht: Module abschalten (`lauf = false`) in der Reihenfolge `CONFIG.module.kuerzen` = Werkstatt, Frachtraum, Krankenstation; bei gleicher Art zuerst der höchste Raum.
3. Reicht auch das nicht (Reaktor 2): Hauptsysteme weiter kürzen bis 0 (Waffen zuerst).
Der Wunsch bleibt erhalten, nach der Reparatur gilt wieder die eingestellte Verteilung. Ändert die Technik während der Kürzung ein System (`technik.power`), ändert sich nur der Wunsch dieses Systems; die gekürzten Wünsche der anderen bleiben (die Kürzung kann die frei gewordene Energie danach dem höchsten System geben). `technik.power` und `technik.module (on)` prüfen gegen den **Bedarf** (`space.powerDemand`: Hauptsysteme + alle Module mit `an`), damit die Technik einem ausgefallenen Modul keine Energie wegnimmt.

## 2. Module (`server/sim/module.js`)

`ship.module = [{ id, raum, an, lauf }]`, sortiert nach `raum`.
- `id`: `frachtraum` | `krankenstation` | `werkstatt` (`Protocol.MODUL_IDS`, `CONFIG.module.ids`; Paket B/D fügen Arten hinzu, z. B. Traktorstrahl).
- `raum`: Modulraum-Nummer 1–`CONFIG.module.max` (4), eindeutig. Heute gibt es nur für Krankenstation und Frachtraum echte Räume auf Deck II; die Werkstatt und die Räume 3/4 sind reine Daten.
- `an`: Wunsch der Technik (Standard an). `lauf`: in Betrieb (`an` und genug Reaktorleistung), wird von `enforcePower` gesetzt. Gleiche Module dürfen mehrfach stehen.
- **Start:** Frachtraum (Raum 1) + Krankenstation (Raum 2). Die **Werkstatt** (zweiter Schrauber, früher Upgrade `bot2`) ist nur per Debug einbaubar; ihr Shop-Pfad kommt in Paket D. `schildpool` entfällt, `bot2` ist aus `upgrades` und `CONFIG.shop` verschwunden.
- API: `neu(C)`, `liste`, `installiert/laeuft/alleLaufen(game, id)`, `anzahlLaufend/anzahlAn`, `standardVerteilung`, `verteilungSetzen`, `schalten(game, id, on, raum, demand, out)`, `bestuecken`, `entfernen`, `update` (Frachtraum gesichert, Schrauberzahl), `notrueckholungFolge`, `snapshot`, `toSave/restore`, `debug`.

### Abweichungen vom Auftrag (begründet)
- **Keine Reparatur je Modul:** Module sind keine Schiffssysteme (`ship.systems`) und haben keinen Schadenszustand; sie fallen nur durch Abschalten oder Energiemangel aus. Ein Modul-Schadenszustand würde Treffer-Auswahl, Reparaturliste, Weltstand und Schadensplan berühren und gehört zum Umbau (Paket B/D). Die „drei Wege“ (Flicken, Minispiel, Ersatzteil) gelten in Paket A für den von der Notrückholung gesprengten **Transfer**.
- **Gegnerwerte unverändert:** Die Start-Verteilung 2/2/2 liefert dieselben Werte wie vor dem Umbau (Pool 6, 4 Ladepunkte, Tempo ×0,8); die Bot-Messung (24 Seeds, 3 Spieler) liegt im Rauschen von `main`. Nur der volle Ausbau (4 Energie) ist härter und wird über die Technik (Module abschalten) und die Werkstatt aufgefangen.
- **Spielerhinweis zum Transfer:** Bei 3+ Spielern ist die Schrauber-Automatik aus; der Transfer bleibt zerstört, bis ein Mensch ihn repariert (Transfer-Station, E halten = Flicken, R = Reparatur) oder die Technik Schrauber im Schadensplan ansetzt. HUD-Hinweis und Transfer-Konsole sagen das. Kein Softlock, aber Spieltest-Punkt.

### Wirkung (nur wenn das Modul läuft)
| Modul | Wirkung |
|---|---|
| Frachtraum | läuft nicht (aus oder ohne Strom): `Fracht.setGesichert(false)`; Ereignis `frachtGesichert { an }`, ODA. Folge: Anzeige **UNGESICHERT** (Snapshot `fracht.g = false`, Frachtliste, Fracht-Leiste in Taktik) und **bei jedem Hüllentreffer löst sich die älteste Ware** (`Fracht.huellenTreffer`, `CONFIG.module.fracht.verlustJeTreffer` = 1, Ereignis `frachtVerloren { art }`), sie treibt 70 px hinter dem Schiff und lässt sich neu beamen (angedockt: weg). Gelöste Ware bleibt auch nach einem Sektorwechsel im alten Sektor liegen (`eigene`, nicht gelöscht), damit Kampagnen-Fracht nicht verloren geht. Es verliert nur, wer den Frachtraum bewusst abgeschaltet hat (`an = false`); fällt er nur durch Reaktorschaden aus (Notstrom), zeigt die Anzeige UNGESICHERT, die Ladung bleibt (sonst scheitert die Kampagnenkette k2: Konvoi-Fracht ging im Notstrom verloren). Nur Beschuss über `shipHit` löst aus; Zonen-Dauerschaden (bewusst kein `shipHit`), Minen (`systemSchaden`) und der Legacy-Pfad `hitLegacy` lösen nicht aus. Personen werden nicht angetastet; `Fracht.gefaehrdet(game)` liefert alles an Bord, was ungesichert ist (Anhängepunkt für AP14). Bei mehreren Frachträumen gilt „gesichert“ nur, wenn alle laufen. |
| Krankenstation | holt jeden Ausgeschalteten per Notrückholung (siehe 3) |
| Werkstatt | zweiter Schrauber (`bots.botAnzahl`); beim Abschalten geht er, sein Teil kommt ins Regal zurück |

### Netz
- `technik.module { id, on, raum? }` (Konsole Technik; `Protocol.CMD_TECHNIK`). Ausschalten geht immer, Einschalten nur mit freier Reaktorleistung („Reaktor ausgelastet“). Fehler: „Unbekanntes Modul.“, „<Modul> ist nicht eingebaut.“, „… ist schon an/aus.“
- Snapshot `ship.mod = [[code, raum, an, läuft]]` (code `f` | `k` | `w`, `CONFIG.module.codes`), `ship.power` ohne `life`, `ship.heat` ohne `life`; gemessen: `ship.mod` 25 B (2 Module) bis 49 B (4 Module), `ship` insgesamt +14 B, `upgrades` −32 B, Gesamtsnapshot im Testgelände −18 B (`npm run snap:mess` unten im Bericht).
- Ereignisse `frachtGesichert { an }`, `frachtVerloren { art }`.
- Debug (`modul`): `status | start | voll | bau <id> [raum] | weg <id> [raum] | an|aus <id> [raum]`.

## 3. Notrückholung

- **Krankenstation läuft:** jeder Ausgeschaltete (`downed`: verwundet oder bewusstlos; nicht gefesselt/gefangen) wird nach `CONFIG.module.krankenstation.holNach` (10 s, kürzer als das Ausbluten von 45 s) einzeln an Bord geholt (`combat.krankenstationHolt`, Schild voll, Pad). Auch bei bereits zerstörtem Transfer (er bleibt zerstört, wird nicht erneut gesprengt), damit „jeder“ für jeden gilt. Die Holzeit (`p.holT`) beginnt mit jedem Ausfall, jedem Aufhelfen und jeder Rückholung neu. Im **Wellenmodus Boden** (`game.arena.wellen`) holt die Krankenstation niemanden (dort gibt es per Entwurf keine Notrückholung).
- **Ohne aktive Krankenstation:** alte Regel unverändert (Ausbluten nach `wounded.bleedout`, Bewusstlose wachen auf oder warten auf die Rückholung aller, Rückholung aller nach `squadRecallDelay`, wenn alle liegen).
- **Folge jeder Notrückholung** (Krankenstation, Ausbluten, ganzes Team, Captain-Befehl `transfer.recall`, Altpfad `interior.updateDowned`): `Modul.notrueckholungFolge` setzt `systems.transfer` auf `CONFIG.module.notrueckholung.transferZustand` (`broken`); Reparatur über die drei Wege. Kein Game Over. Die Rückholung des ganzen Teams bleibt als letzter Ausweg auch bei kaputtem Transfer möglich. Sie braucht keine Energie (Transfer ist kein Posten).

## 4. Weltstand
`schiff.module = [{ id, raum, an }]` (Schema `content/schema/weltstand.schema.json`, Version bleibt 3; Feld optional). Fehlt es (Altstand), gilt die Start-Bestückung; `ausbauten` mit `bot2`/`schrauber3` baut die Werkstatt ein, `schildpool` wird ignoriert (keine Abwärtsmigration). Die Energieverteilung wird nicht gespeichert.

## 5. Tests und Messung
- `node tools/test-energie.js` (in `npm test`): Konfiguration, Start/voll, Technik, Kürzung, Frachtraum, Werkstatt, Notrückholung (Kesh), Weltstand, Snapshot.
- Angepasst (neues Modell, bewusst): `test-features` (Kürzung, bot2 -> Werkstatt), `test-boje` (freie Energie durch Module aus, kein O₂-Verlust), `test-combat` (alte Regel ohne Krankenstation, Notrückholung sprengt den Transfer), `test-alarm` (Antrieb 4 ohne Module, Lebenserhaltung nicht wählbar), `test-sektoren` (kein Schildpool im Sortiment).
- Grenzen der Messung: Der Preload schaltet beim ersten Gegner ideal um (umgeht die `technik.module`-Prüfung, keine Reaktionszeit); die Werte „…-kampf“ sind eine **Obergrenze** der Technik. In der Arena wirken Module als +2-Energie-Schalter ohne Gegenleistung (dort gibt es keine Fracht und kein Außenteam). Vorschlag (nicht eingebaut): Abschalten/Einschalten teurer machen, z. B. Anlaufzeit beim Einschalten (10–15 s ohne Wirkung), Sperrzeit nach dem Umschalten oder eine Hitze-/Abnutzungskosten je Schaltvorgang; entscheiden nach Kais Spieltest.
- Messung: `node tools/pan01-energie-bot.js --seeds 12 --players 3` (Preload `tools/pan01-energie-preload.js`).
- Bots: `tools/sim-headless.js` repariert nach einer Notrückholung den Transfer (Captain-Bot und Besatzung in `KeshAgent`), sonst bleibt Crew 3 im Extract hängen.
- Golden: neue Basis `tools/fixtures/golden/base-pan01a` (20 Seeds, Stand dieses Branches), Allow-Datei `tools/fixtures/golden/allow-pan01a.json` (trägt `allow-sl0.json` mit; Gruppen V = Vorbestand seit R1/EK1a/EK3, P = PAN-01 A). `base-w2` ist auf `main` schon rot (14 von 120 Läufen scheitern bei Crew 3 in den Bots, dazu Textdrift seit R1); gegen `base-pan01a` ist der Stand byte-identisch.

## 6. Für Paket B/D
- Paket B: Modulräume als echte Räume; `module[].raum` ist die Nummer, die Karte muss Raum 1–4 kennen. Das Modul-Zugriffsmuster der Kampagnen (`krankenstation`, `frachtraum` als Räume) bleibt über `maps.js` unverändert.
- Paket D: Shop/Werft ruft `Modul.bestuecken` / `Modul.entfernen` + `Modul.verteilungSetzen` und speichert über `schiff.module`.
