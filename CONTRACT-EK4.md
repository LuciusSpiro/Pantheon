# CONTRACT-EK4 – Verbündete und Flottenbefehle (K4)

Grundlage: `Briefing Eisenwald-Kampagne (EK1-EK9)` (EK4), `Planung Eisenwald-Kampagne (EK1-EK9)` (EK4, E5), `Arbeitspaket Raum-Alarm und K4`,
`Welt/Funktexte Feldzug Eisenwald` im Vault (`C:\Users\Luciu\projects\brain\vault\Coop-Spiel\`). Branch `ek3-flotte` (Basis `ek1`).
Schnitt nach E5: **EK4a** (Befehle, Legat, Funk, Hilferufe, Verlust; Verbündete scripted) vor **EK4b** (eigene KI, Teamlogik, 12-Schiffe-Grenze, Sprung der Flotte).

## 1. Befund
- `escort.js` (S2) trug Flug über `Pilot.escort`, Befehle, Gehorsam nach Haltung, Hilferuf, Funk-Rüffel, Zustände, Gegnerziele (`targetId`, `Pilot.targetOf`), Sprung mit der Lerche.
  Es fehlten: Feuer, Verlust als Ereignis (Schützlinge werden nie gelöscht), Befehle als Szenenziele, Legat/Gedächtnis, Funkporträt, Wellen mit Frist.
- Das Notfallprotokoll der Lerche (Hülle 0, Gegner ziehen 10 s ab) ist schon das „wird zerstört und muss fliehen“; EK4 hängt den Befehlsausgang daran.
- Alle Dateien sind CRLF (Git normalisiert); Hooks in `escort.js`, `game.js`, `mission.js` sind klein, die Logik liegt in neuen Modulen.

## 2. EK4a – gebaut
| Teil | Inhalt |
|---|---|
| `server/sim/flotte.js` | Verbündete (Einträge in `space.escorts` mit `ally: true`, Klasse korvette/fregatte/kreuzer/raider, eigene Hüllentafel `CONFIG.flotte.hull`, eigene Crew-Härte `flotte.crewDamage`), Skript `halten | folgen | ziel`, Befehle, Wellen, Neustart, Hilferuf, Verlust, Gedächtnis, Snapshot, Debug `flotte …` |
| Befehle (`befehl`) | **ausschalten** (Ziel Tag/Klasse, n Abschüsse), **eskortieren** (Schiff erreicht die Wegpunkte, wartet an der Leine), **durchbrechen** und **zurueckfallen** (Lerche erreicht die Wegpunkte), **entlastung** (n Abschüsse, solange die Lerche höchstens `radius` vom Schiff entfernt ist). Fortschritt nur durch erreichte Ziele (getestet: Zeit allein bringt nichts, Abschüsse fern vom Schiff zählen nicht) |
| Scheitern | `zeit` (Frist), `schiff` (Schiff verloren), `notfall` (Notfallprotokoll der Lerche). Welle um Welle: nach abgelaufener Frist **Überdruck** (letzte Gruppe kommt alle 9 s größer wieder). `flotte_neustart`: Gegner weg, Befehl/Wellen von vorn, lebende Verbündete repariert, Lerche ≥ 60 % Hülle, tote bleiben tot. Katalog: zweimal von vorn, danach „Rom übernimmt“ (die Szene darf scheitern, der Feldzug nie) |
| Legat | NSC `legat` (Marcus Severus, `content/npc.json`; alte Stände bekommen ihn beim ersten Gebrauch nachgetragen). Gedächtnis im Weltstand: `befehl_befolgt` (+1), `eigenmaechtig` (−1, Lerche entfernt sich ≥ 25 s vom Befehlsziel), `im_stich` (−2, Verbündeter fällt bei > 700 px Abstand), `schiff_verloren`. Flags `legat_befolgt/eigenmaechtig/im_stich`, Prüfung `legat_erinnert`, Aktion `flotte_erinnerung` |
| Verlust | Verbündeter wird **zerstört** (nicht kampfunfähig): Explosion, Ereignis `allyLost` (Position, Rettungskapsel-Anzeige 14 s), theatralischer Funkspruch, Fakt `flotte_<tag> = verloren` (kommt nicht von selbst zurück; `flotte_aufstellen` verweigert, `ersatz: true` = Ersatz „über eine Aufgabe“), Chronik, der **Legat überlebt** (Status `lebt`). Ausnahme zu S2 „benannte NSC sterben nicht“ gilt für das **Schiff** |
| Hilferuf | bei Hülle < 40 % und < 15 % (je Schiff einmal), Texte aus `content/flotte/funktexte.json` (Daten, nicht im Code), je Schiff `fulminata` / `audax`, sonst `allgemein` |
| Funk | `radio`-Aktion und Ereignis tragen `pid` (`legat` = Porträt, `mars` = Symbol, kein Gesicht); Mars spricht über eine `stimmen`-Kennung `mars`. Der Client zeichnet Porträt/Symbol im HUD-Funkfenster und im Captain-Reiter Funk |
| Anzeige | HUD-Zeile **BEFEHL · Art Fortschritt · Frist · Welle** (auch im Titelbalken von Steuer/Taktik/Captain), **VERBÜNDET**-Zeile mit Hüllenbalken, Captain-Reiter Funk: Block „Befehl des Legaten“, Karten: nummerierte Wegpunkte, Radius der Entlastung, Verbündete golden mit Rom-Sprite, Rettungskapseln |
| Bausteine | `flotte_aufstellen, flotte_modus, flotte_befehl, flotte_wellen, flotte_neustart, flotte_erinnerung`; Prüfungen `befehl_erfuellt, befehl_gescheitert, befehl_laeuft, wellen_fertig, schiff_verloren, legat_erinnert, flotte_ziel_erreicht`. Vertrag `content/regiebuch/bausteine.json`; Prüfer: `schiff_verloren`/`escort_state zerstoert` zählen als Verlustweg |
| Katalog / Labor | Molekül `flottenbefehl` (A10) mit den fünf Umsetzungen; Mechaniken `flottenbefehle`, `verbuendete_skript` verfügbar (`verbuendete` bleibt geplant bis EK4b). Spielleiter-Kontext-Goldens neu (bewusst, +Molekül, +NSC) |
| Tests / Bots | `tools/test-flotte.js` (in `npm test`), `node tools/sim-headless.js flotte [--seeds N]` (Labor-Bots, alle fünf Arten, solo und zu dritt) |

## 3. Entscheidungen (EK4a)
1. **Verbündete leben in `space.escorts`** statt in einer zweiten Liste: Zielwahl der Gegner, Treffer, Ankündigung, Sprung, Snapshot, Sperrfeuer-Abfangen laufen ohne Doppelcode. Schützlinge bleiben auf 2 begrenzt, Verbündete zählen extra.
2. **Zerstört statt kampfunfähig:** Verbündete verschwinden mit Explosion und Kapsel. Wrack-Logik wäre sonst Sonderfall; „kommt nicht von selbst zurück“ ist ein Weltstand-Fakt.
3. **Gedächtnis über Weltstand-Funktionen** (`npcMemory`, `fact`, `chronicle`), **kein neues Schemafeld**; Flags für Verzweigungen.
4. **Eigene Härte für Verbündete** (`flotte.crewDamage` 0,4/0,55/0,6, Hüllen 220/380/520): mit der Schützling-Tafel (0,18 solo) wären sie solo unverwundbar; mit 1,25 zu dritt starben sie in jedem Bot-Lauf.
5. **Frist statt Zeitdruck allgemein:** Nur Befehle mit `frist` scheitern an der Zeit; Standardfristen in `CONFIG.flotte.befehl.frist`.
6. **Funktexte als Daten**, Porträt über Kennung (`pid`), nicht über Spielzustand; unbekannte Sprecher unverändert (Snapshot bleibt byte-gleich).
7. **Mars als `stimmen`-Kennung** statt NSC: kein Gedächtnis, kein Auftraggeber für den Spielleiter.

## 2b. EK4b – gebaut
| Teil | Inhalt |
|---|---|
| Eigene KI | Rolle je Verbündetem: **begleiter** (Standard; bleibt in `flotte.ki.leine` 1100 px um die Lerche, bekämpft den nächsten Gegner, wer das Schiff anvisiert zählt doppelt), **angreifer** (jagt den nächsten Gegner), **skript** (EK4a: nur Regiebuch, kein Feuer). Flug = die **Klassen-KI der Gegner** (`pilot.js`: Breitseite mit Abstand für Korvette/Fregatte/Kreuzer, Anflug für Jäger) mit einem Gegner als Ziel (`Pilot.targetOf` kennt `e.ally`), keine zweite KI. Ohne Ziel oder außerhalb der Leine: Formation hinter der Lerche. `flotte_modus ziel/halten` übersteuert die Bewegung, das Feuer bleibt |
| Feuer | je Waffenplatz der Klasse (`enemyWeapons`) ein Geschoss `kind: 'ally'` im Takt `flotte.ki.intervall`, nur wenn das Ziel im Bogen liegt; Schaden `flotte.ki.dmg` |
| Teamlogik („kein Eigenbeschuss“) | Geschosse der Verbündeten treffen nur Gegner (laufen im Zweig der Lerchen-Geschosse von `space.updateProjectiles`, nie gegen Lerche oder Verbündete); Lanze und Geschosse der Lerche verletzen Verbündete nicht (Lanze durch ein Schiff: Funk-Rüffel); Treffer eines Verbündeten ziehen den Gegner nicht auf die Lerche (`damageEnemy … { ally: true }`); **Minen**: Minen der Gegner zünden auch bei Verbündeten und treffen sie im Sprengradius, Minen der Lerche nie (Verbündete meiden bekannte Minen); Gegner dürfen Verbündete wie bisher über `targetId` anvisieren |
| Grenze 12 | höchstens `CONFIG.flotte.max` = 12 Schiffe je Szene (alle Gegner plus Verbündete/Schützlinge, ohne die Lerche). Mehr kommt als **Nachschub** (FIFO, alle 1,2 s ein Schiff, sobald ein Platz frei ist; Ereignis `flotteNachschub`, Snapshot `flotte.nq`, Anzeige „Nachschub N“). Gilt für `flotte_wellen`, Überdruck und das Regiebuch-`spawn`, sobald eine Flotte besteht (ohne Flotte unverändert); Prüfung `nachschub_wartet` |
| Auftauchen | `flotte_aufstellen auftauchen: true`: Sprungblitz (Ereignis `allyEintritt`, Ring und Blitz auf der Karte, Hinweis, Funkspruch), 2,5 s durchscheinend und **unverwundbar** („tauchen erst bei Eisenwald auf“) |
| Sprung der Flotte | Verbündete springen mit der Lerche mit: Ortswechsel (`Escort.onSceneChange`, Formation nach Platz, auch mit Skript „halten“), **Notfallsprung am selben Ort** (`flotte.sprungFolgen`, Sprungblitz). Zerstörte Schiffe springen nicht mit |
| Verlust | zusätzlich großes Banner „<Schiff> VERLOREN“ (5 s) im HUD, Kapsel auf der Karte, Hinweis; Funkspruch, Chronik, Gedächtnis und Fakt wie EK4a |
| Anzeige | Verbündete golden mit Rom-Sprite (Strichform, solange der Sprite lädt), Name, Balken; Zeile „VERBÜNDET“ bis 3 Schiffe (+N) |
| Snapshot | Verbündete kompakt (`al: 1`; `state`, `befehl`, `distress` fehlen = ok/null/false; `ein: 1` beim Einblenden), ≈ 100 B je Schiff |
| Messung (`node tools/snap-mess.js`, Aufbau „flotte“) | Worst Case: Lerche mit 3 Spielern, 2 Verbündete mit KI (Korvette, Fregatte), Gegner bis zur Grenze (12 Schiffe in jedem Seed), alle gescannt (Korvetten/Fregatten/Kreuzer/Jäger), Befehl mit 3 Wegpunkten, Welle mit Nachschub, jede 3 s ein Abschuss: **max 11 851 B** (Ziel ≤ 18 944 B); Aufbau 1–3 unverändert (11 444 / 10 558 / 11 384 B) |

## 3b. Entscheidungen (EK4b)
8. **Eine KI für alle Klassen mit Rollen:** `pilot.js` bleibt die einzige Flug-KI; Verbündete rufen `Pilot.update` mit einem Gegner als Ziel auf. Rollenvielfalt (Schild, Wache, Rudel) später, hier begleiter/angreifer/skript (E5: „erst mit einer Rolle“).
9. **Feuer ohne Eingriff in die Gegnerlogik:** eigene Geschossart `ally` im vorhandenen Geschosszweig (kein neuer Treffercode, ein Parameter am Schaden); schwere Ladungen (Lanze der Korvette) gibt es für Verbündete nicht, die Waffenplätze feuern gleichförmig.
10. **Grenze zählt Schiffe, nicht Projektile:** Projektile und Minen gehören nicht zu den 12; ihr Anteil steht in der Messung.
11. **Einblenden statt Sprunganimation:** Blitz und Ring auf der Karte, 2,5 s durchscheinend und unverwundbar; die Voxel-Ansicht zeigt den Ring nicht (offen, siehe unten).
12. **Verbündete springen immer mit,** auch bei „halten“ (anders als Schützlinge): Der Verbündete ist Teil der Flotte, nicht Schutzgut.
13. **Katalog:** `verbuendete` ist jetzt verfügbar, damit Szenentyp **Schlacht (A10)** für den Spielleiter offen (Kontext-Goldens neu). Die Kampagne baut ihre Kette fest (EK8).
14. **Kein Zugriff auf `server/sim/away.js`, `shared/gen-*.js`, `content/welt/`, `fracht.js`:** nicht berührt.


## 4. Antworten auf die Fragen des Briefings
- **Snapshot (12 Schiffe plus Projektile, Worst Case):** Aufbau „flotte“ in `tools/snap-mess.js`: Lerche, 3 Spieler, 2 Verbündete mit KI, Gegner bis zur Grenze (12 Schiffe in allen 5 Seeds), alle gescannt, Befehl, Welle, Nachschub, Sperrfeuer und Verbündetenfeuer: **max 11 851 B, p95 10 597 B**, Ziel ≤ 18 944 B. Ein Verbündeter kostet ≈ 100 B (kompakte Felder), `flotte` 125 B im Mittel.
- **Fregatten-KI:** Breitseiten fahren mit Abstand (Soll-Abstand `pilotKlasse.fregatte.range` 420, Seitenwechsel nur selten) war schon in EK1b gelegt; Verbündete nutzen sie unverändert (`Pilot.update` mit einem Gegner als Ziel). Test: Fregatte hält im Median 150–700 px Abstand in der Station (Breitseite).
- **Gemeinsame KI mit Rollen:** ja. `pilot.js` bleibt die einzige KI; Verbündete unterscheiden sich nur durch die Rolle (begleiter, angreifer, skript) und das Ziel.
- **Auftauchen („tauchen erst bei Eisenwald auf“):** Einblenden mit Sprungblitz (Ring + Blitz auf der Karte, Funkspruch), 2,5 s unverwundbar; Baustein `flotte_aufstellen auftauchen: true`. Gründe gegen eine Sprunganimation mit Einflug: keine neue Bewegungsregel, im Snapshot ein Bit, auch beim Notfallsprung nutzbar.
- **Befehlsanzeige:** HUD-Zeile BEFEHL (überall, auch im Titelbalken der Konsolen), Captain-Reiter Funk (Block „Befehl des Legaten“), Wegpunkte und Radius auf Karte und Frontsicht, Funkspruch mit Porträt im HUD-Funkfenster und im Reiter Funk.

## 5. Abnahme
| Punkt | Ergebnis |
|---|---|
| `npm test` (inkl. `test-flotte` 119 Prüfungen), `npm run check` (303), `npm run snap:mess` | grün |
| Befehle im Labor (alle fünf Arten) | `node tools/sim-headless.js flotte --seeds 8`: solo und zu dritt alle Läufe erfüllt (EK4a-Stand mit scripteten Verbündeten: einzelne „nach Neustart“ und „Rom übernimmt“, Verbündete-KI macht die Szenen leichter; Verlust erst bei Überdruck bzw. schwereren Wellen als im Labor) |
| Hilferuf und Verlust mit Funkspruch, Kapsel, Weltstand | `test-flotte`: Schwellen 40 %/15 %, Texte aus den Daten, einmal je Schiff, Fakt, Gedächtnis, Chronik, verlorenes Schiff kommt nicht zurück, Ersatz nur ausdrücklich |
| Nachschub bei 12 Schiffen | `test-flotte`: nie mehr als 12, Rest wartet (Snapshot `nq`), rückt nach, gilt auch für Regiebuch-`spawn` |
| Sprung der Flotte | Ortswechsel und Notfallsprung am selben Ort getestet |
| Legat-Gedächtnis im Weltstand speichern/laden | `test-flotte` (Kampagne, `saveWorld`, neue Game-Instanz mit `lobbyOpt world`) |
| Snapshot Worst Case | 11 851 B (≤ 18 944 B) |
| Golden m1–m3 (20 Seeds, 120 Traces) gegen `base-w2` mit `allow-ek1.json` | **GOLDEN GRÜN**: 80/120 Traces byte-identisch, die 40 anderen sind die Crew-1-Läufe von m1/m2 mit der bekannten Abweichung aus EK1a (Mediane m1/1 −6,7 %, m2/1 +2,1 %, `allow-ek1.json`); m3 und Crew 3 unverändert. Ordner `ek4-check` gelöscht |
| Browser (Chromium, Playwright, Port 3393) | EK4a-Ansichten geprüft (HUD-Zeilen, Funkporträt, Mars-Symbol, Captain-Reiter, Verlust mit Kapsel, Taktik mit Verbündetem), 0 Client-Fehler |

## 6. Offen
- Die Voxel-Ansicht kennt keine Verbündeten-Sprites, Sprungblitz und Kapsel (sie erscheinen in der 2D-Karte und Frontsicht).
- Verbündete feuern gleichförmig (keine schweren Ladungen, keine Lanze); Rollen Schild/Wache/Rudel fehlen.
- Die feste Kampagnenkette (Orbitschlacht Eisenwald in drei Teilen) baut EK8 aus diesen Bausteinen; `mission.js` setzt `space.escorts` bei erzeugten Büchern (`kopf.art generiert|archiv`) zurück, nicht bei festen Büchern.
- Gegner-KI `flightV2` gilt in der Kampagne nur für `kopf.art generiert|archiv` (S2); Verbündete fliegen unabhängig davon über `Pilot.update`, die Gegner der festen Kette brauchen `flightV2` für Breitseiten (EK8 prüfen).
- Nicht mit Menschen gespielt: Lesbarkeit der Zeilen BEFEHL/VERBÜNDET im Gefecht, Schwierigkeit der Verbündeten (Bots: Labor-Szenen zu leicht, Härte in `flotte.crewDamage`, Hüllen und `flotte.ki.dmg`).

## 7. VERK-ORBIT – Orbitschlacht Eisenwald als echte Szene (Kapitel 6 der Kette)
Branch `ek4-verk-orbit` (Basis `ek1` mit EK1–EK8). Das Kapitelbuch `content/regiebuecher/k6_orbit.regiebuch.json` baut die Szene aus den Bausteinen dieses Vertrags (Details und Flags: CONTRACT-EK8.md Abschnitt 4, Kapitel 6; Test: `tools/test-orbit.js`).
| Teil | Inhalt |
|---|---|
| Ablauf | `flotte_aufstellen` Fulminata und Audax (`auftauchen`) › Befehl **durchbrechen** (2 Wegpunkte) › **entlastung** (bedrängtes Schiff hält Stellung, Verlust ersetzt den Befehl) › **ausschalten** (Boss-Fregatte). Fortschritt nur durch erreichte Ziele |
| Scheitern | Muster im Buch: Flags `<x>_r1/_r2/_r3`, nach 7 s `flotte_neustart` und `goto` auf den eigenen Schritt (v, Regeln und Zeiten beginnen frisch, der Befehl wird im `enter` neu erteilt); ab dem 3. Scheitern „Rom übernimmt“: weniger Gegner, `frist: 0`, `ueberdruck: false`. Der Katalog-Ausgang „aufgegeben, weiter“ gilt hier **nicht** (Freibrief) |
| Neu: `flotte_beenden` | `Flotte.beenden(game)`: Wellen, wartender Nachschub, Befehl und `space.retreatRule` weg; Verbündete bleiben, Gegner bleiben (vorher `enemies_retreat`). Sonst läuft die Schlacht am selben Ort ins nächste Kapitel weiter und `enemies_retreat` lässt auch spätere Gegner fliehen |
| `mission.js` | `flightV2()` und der Reset von `space.escorts`/`escortsGone` beim Missionsstart gelten auch für `kopf.art: kapitel` (zwei Zeilen). Das Tutorial (art `mission`) bleibt unberührt |
| Bausteine im Buch | `flotte_aufstellen`, `flotte_modus` (`halten` in Befehl 2, `folgen` in Befehl 3, nur wenn ein Verbündeter lebt – sonst zählt der Baustein einen Fehler), `flotte_wellen`, `flotte_befehl`, `flotte_neustart`, `flotte_beenden`, Prüfungen `befehl_erfuellt`, `befehl_gescheitert`, `schiff_verloren`, `rueckzug` |

**Erkenntnisse beim Verdrahten (für die Szenenbauer):**
- Wellen werden mit der Crew skaliert (1 Spieler 0,67, 2 Spieler 0,85): Die Zahl der nötigen Abschüsse (`n`) muss **kleiner** sein als das, was die Wellen solo liefern, sonst ist der Befehl unlösbar (erste Fassung: `n: 3` bei 2+2 Jägern solo).
- Entlastung zählt nur Abschüsse im Radius um das Schiff. Ein Verbündeter mit eigener KI (begleiter) fliegt den Gegnern entgegen, die Abschüsse geschehen dann fern vom Schiff und zählen nicht: das bedrängte Schiff mit `flotte_modus halten` Stellung halten lassen (es feuert weiter, `kiFeuer` ist vom Flugmodus unabhängig).
- `flotte_befehl` mit `schiff` scheitert, wenn das Schiff fällt, und ein verlorenes Schiff kommt nicht zurück: jede Szene braucht einen Ersatzbefehl (Audax, sonst Ziel ohne Schiff), sonst Softlock.
- Regeln eines Schritts feuern **einmal**; eine Wiederholung braucht ein `goto` auf den eigenen Schritt (setzt v, Regeln, Zeiten zurück) und Zähler in Flags.
- Beim Abschluss die Flags auflösen (eine `legat_*`-Flag): Die Engine setzt `legat_befolgt` je erfülltem Befehl und `legat_eigenmaechtig` bzw. `legat_im_stich` je Ereignis, nebeneinander.

**Messung (VERK-ORBIT):** `node tools/snap-mess.js` Aufbau „orbit“ (Kette, Kapitel 6, Befehl 3, 3 Spieler, Fulminata und Audax mit KI, Gegner bis zur Grenze von 12 Schiffen, Nachschub, alle gescannt): **max 13842 B, p95 12826 B** (Ziel ≤ 18 944 B). Aufbau 1–4 unverändert.
