// Nachrichtenprotokoll (CONTRACT.md §5). UMD: window.Shared_Protocol / require.
// Alle Nachrichten sind JSON-Objekte mit Typfeld `t`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Protocol = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    VERSION: 7,   // B1–B3 „Bühnen & Bodenkampf“ (6 = S2 „Spielleiter an der Missionsgrenze“, 5 = S1 „Regiebuch & Weltstand“, 4 = M4)
    // ---- B1 (CONTRACT-B1 §9): Bühnen – gebaute Außenkarten, Landepunkte, Anker ----
    // Ereignis awayMap { id, erzeuger, art, bauweise, besitz, zustand, w, h, rows, anker: [[id, rolle, x, y, attr?]], bereiche,
    //   decks, kv } – kompilierte Karte (≤ 10 KB laut Nachtrag), beim Betreten bzw. auf Anfrage (cmd awayMap.get). Nur an die betroffenen
    //   Spieler bzw. per Anfrage; nie im Snapshot. Der Client registriert sie in Shared_Maps (würfelt nie selbst).
    // cmd { c: 'awayMap.get', id } – ohne Konsole; Client fehlt die Karte oder kv passt nicht.
    // cmd { c: 'transfer.ziel', landepunkt } – Transfer-Konsole: Landepunkt (lpId) am Ort für den nächsten Transfer wählen.
    // Snapshot away: map (= lpId), kv (Kartenversion), ao [[ankerIdx, zustandIdx]] und ko [[kantenIdx, zustandIdx]] (nur
    //   Abweichungen vom Start; Indizes in awayMap.anker bzw. Kanten-Reihenfolge, Zustände nach anker.json/kacheln.json),
    //   al (Alarm 0/1), cd { i, t } (laufender Countdown, sonst fehlt das Feld). Handkarten: map = platform|wreck|kesh wie bisher.
    // Snapshot transfer (Nachtrag, Transfer-Konsole): { lp: [[lpId, name, art, frei 0|1, grund|null, inReichweite 0|1]], ziel: lpId|null }
    //   aus landepunkte.liste(game, ort); nur wenn der Ort Landepunkte hat (Handkarten zählen mit), nur bei Änderung bzw. alle
    //   15 Snapshots (wie world.locations); ziel = per transfer.ziel gewählter Landepunkt.
    // Snapshot space.enemies[].st: 'treibt' (kampfunfähiges Feindschiff, CONTRACT-B1 §7; sonst fehlt das Feld).
    // Ereignisse: ankerZustand { map, anker, zustand, rolle?, pid? }, downloadAbbruch { anker }, ladungScharf { anker, t },
    //   ladungExplodiert { anker }, landepunktAlarm { map, an } (Entscheidung Studioleitung: `alarm` bleibt der Schiffsalarm
    //   { level }), enternFrei { id }.
    // awayMap.kanten: [[kantenId, [[x, y], …], startZustandIdx]] sortiert nach kantenId (Quelle karte.kanten); diese Reihenfolge
    //   ist der kantenIdx im Snapshot ko. awayMap.anker-Reihenfolge = ankerIdx im Snapshot ao.
    // awayMap.plaetze: [[platzId, typ, x, y, w, h]] in Kacheln (aus karte.plaetze, nach platzId sortiert).
    // awayMap.anker attr (optional, nur gesetzte): art, paar, kette, schwer, ankunft, deck, kern; bei Rolle 'leit' zusätzlich
    //   fuss [x0, y0, w, h] (Grundfläche des Leitstücks in Kartenkacheln, nach Spiegeln/Drehen) und modell (Asset-ID), sofern die
    //   Bauweise eine Grundfläche kennt (leit_fuss); sonst fehlen beide (VOXEL: Platzmitte bzw. Anker).
    // Statische Daten für den Kit-Renderer: GET /content/buehnen/<pfad>.json (nur .json, nur lesen, kein Listing) – kacheln.json,
    //   bauweisen/<bw>.json, paletten/<besitz>.json, deko/<bw>.json.
    // Debug: buehne <art> <seed> [bauweise besitz zustand] | anker <id> <zustand> | lp list | lp neu <ort> <art> | lp hin <landepunkt-id> (ORT-01: bestehenden Landepunkt laden und hinbeamen, Screenshots/QA).
    // Debug für QA (QA_DEBUG, nur --debug; { c: 'debug', cmd, args: 'text' }):
    //   sprungpunkt auf <hex|ort> [temp] | sprungpunkt zu <hex|ort|kantenId>   (Kante vom Hex des aktuellen Orts)
    //   ladung [ankerId] [sek]   Sprengpunkt der aktuellen gebauten Karte scharf (Countdown im Snapshot away.cd)
    //   prise [kind]             Feindschiff am Ort, sofort kampfunfähig -> Landepunkt <ort>.prise (nicht im Tutorial)
    // Ankunft an einem Ort: der Server baut die freien Landepunkte des Orts nach dem Tick vor (landepunkte.vorbauenOrt).
    // Direktstart Testgelände Außenteam (§4): lobbyOpt { startMission: 'arena_away', arena: ARENA_AWAY_FIELDS } bzw. URL
    //   ?arena=away&art=ruine&seed=3&bauweise=rom&besitz=herrenlos&zustand=verfallen. Ohne Parameter wie bisher (Kesh).
    EVT_AWAY_MAP: 'awayMap',
    AWAY_MAP_FIELDS: ['id', 'erzeuger', 'art', 'bauweise', 'besitz', 'zustand', 'w', 'h', 'rows', 'anker', 'bereiche', 'decks', 'kanten', 'plaetze', 'kv'],
    CONTENT_BUEHNEN_PREFIX: '/content/buehnen/',
    AWAY_MAP_MAX_BYTES: 10240,   // Entscheidung Studioleitung: bis 10 KB (Vertrag ursprünglich 8 KB)
    CMD_AWAY_MAP_GET: 'awayMap.get',
    CMD_TRANSFER_ZIEL: 'transfer.ziel',
    AWAY_SNAP_B1: ['map', 'kv', 'ao', 'ko', 'al', 'cd'],
    SPACE_ENEMY_ST: ['treibt'],
    TRANSFER_SNAP_FIELDS: ['lpId', 'name', 'art', 'frei', 'grund', 'inReichweite'],
    KARTEN_ARTEN: ['aussenposten', 'station', 'ruine', 'schiff', 'hand'],
    ARENA_AWAY_FIELDS: ['art', 'schablone', 'seed', 'bauweise', 'besitz', 'zustand', 'fraktion', 'staerke', 'haltung'],
    B1_EVENTS: ['awayMap', 'ankerZustand', 'downloadAbbruch', 'ladungScharf', 'ladungExplodiert', 'landepunktAlarm', 'enternFrei'],
    B1_DEBUG: ['buehne', 'anker', 'lp'],
    QA_DEBUG: ['sprungpunkt', 'ladung', 'prise'],
    // ---- B2 (CONTRACT-B2 §8): Bodenkampf – Waffen mit Hitze, Wunden, Rollen ----
    // cmd { c: 'loadout.waffe', waffe: WAFFEN_WAHL } – an der Transfer-Konsole (nicht unten); gespeichert je Spieler über den
    //   Hash der Browser-Kennung (Weltstand crew.waffen), nie über Namen.
    // Halte-Interaktionen über den bestehenden Hold-Mechanismus (act), Kinds HOLD_KINDS_B2.
    // Snapshot players[]: PLAYER_SNAP_B2 – wf (Waffe), ht (Hitze 0–100), ov (1 = überhitzt), ch (Laden 0–100), wu (Ausholen 0–100),
    //   zs (KOERPER_ZUSTAENDE ohne 'aus'), bt (1 = betäubt). Nur gesetzte Felder (Budget). Außenzone: alle Felder (v2-Karten).
    //   An Bord (zone 'ship'): nur wf = gewählte Waffe (gespeicherte Wahl, sonst 'blaster'); fehlt bei WAFFEN=aus.
    // Snapshot away.drones[]: DRONE_SNAP_B2 – ro (Rolle), fr (Fraktion), pa (Palette), wf, ch, wu, zs (inkl. 'aus'), bt, wn (Wunden),
    //   wm (Wunden max), gr { x, y, t } (Zielkreis beim Zielen, höchstens 2 s nach Zielbeginn): x, y = Zielpunkt in px;
    //   t = Spielzeit des Zielbeginns in s (dieselbe Uhr wie snap.time), KEIN Fortschritt 0–1. Fortschritt für die Anzeige:
    //   drones[].aim.p (0–1, Zielen bis zum Schuss) oder clamp((snap.time − gr.t) / 2, 0, 1).
    // Snapshot away.projectiles[]: kind 'granate' zusätzlich tx, ty (Ziel in px), t (s seit dem Wurf, 0 … flug), flug (Flugzeit
    //   in s); Fortschritt des Bogens = t / flug. x, y bleiben der Abwurfpunkt (die Granate fliegt nicht über x/y). Snapshot away.tr: [[trupp, 0|1]] (Haltung je Trupp; nur
    //   bei ?debug=1 oder Captain-Scan).
    // Ereignisse B2_EVENTS (auch FX-Auslöser). Trupp-Alarm heißt truppAlarm { map, trupp, x, y } (`alarm` = Schiffsalarm { level }).
    //   Ergänzungen (SCHNITTSTELLEN-NACHTRAG FX, verbindlich): ausholen { id, winkel? }; granateEinschlag { x, y, radius } (Radius in
    //   Kacheln); Treffer-Ereignisse (shieldHit, enemyShieldHit …) tragen zusätzlich waffe (WAFFEN bzw. Gegnerwaffe).
    //   FX liest: players[] ch wu zs bt ht ov wf; away.drones[] ch wu zs bt wf gr facing; away.projectiles[] kind 'granate' tx ty t flug.
    // W1 AP1 (Netzbudget, server/sim/snapform.js): „fehlt = Standard“ – Leser behandeln ein fehlendes Feld wie den Standardwert
    //   (Vergleiche wie `x === false` gegen ein fehlendes Feld sind falsch; `!x`, `x !== false`, `x != null` verwenden).
    //   players[] (combat.playerSnap): fl fehlt = false, cr fehlt = false, bleed fehlt = null, ov fehlt = 0, bt fehlt = 0,
    //     zs fehlt = 'ok' (gilt, sobald die B2-Felder da sind – ht ist dann immer gesetzt).
    //   away.drones[] auf v2-Karten (combat.droneSnap): alive fehlt = true (nur alive:false wird gesendet: liegt bzw. aus),
    //     asleep fehlt = false, cr fehlt = false, ghost fehlt = null, aim fehlt = null, zs fehlt = 'ok'.
    //     revealed entfällt (aufgedeckt = snap.time < away.sensorUntil, wie es der Server für alle Gegner setzt); squad entfällt
    //     (Client: kit bzw. ID-Präfix). role (KI-Rolle pin/flank/retreat/aufrichten …, ≠ ro) nur mit CONFIG.debug.snapKiRolle
    //     (Bots, Debug-Overlay per `tune debug.snapKiRolle on`). Nicht-v2-Karten (Plattform, Wrack): revealed und alive wie bisher.
    //   Grenze: CONFIG.net.snapMax (20 480 B, bis 2026-10-10 13 312 B), Worst Case ≤ snapMax − snapLuft (tools/snap-mess.js, npm run snap:mess).
    // EK1b (Raumgegner, CONTRACT-EK1 §5): space.enemies[].shieldsMax entfällt, shields fehlt bei vollen Schilden (Leser: Shared_Schilde.fuellen); shields ist flach
    //   über die Schildsegmente (Bug, Steuerbord vorn→hinten, Heck, Backbord vorn→hinten); weapons[] trägt bei Klassen mit Waffenplätzen nur { platz, typ }.
    // W2 AP6 (E6): away.npcs[] ersetzt away.npc. Je Person auf der aktiven Außenkarte (auf der Karte oder gerettet):
    //   { id, name, x, y, dir?, following?, injured?, rescued? } – id = Kennung aus spawn_person bzw. 'ivo' (Name 'Ivo');
    //   dir fehlt = 'down', following fehlt = null (sonst Spieler-ID), injured/rescued fehlen = false. Gerettete stehen nicht
    //   mehr auf der Karte (früher present: false). Keine Person = leere Liste. Bis CONFIG.personen.maxGleichzeitig offene.
    // Debug: tune waffen.<waffe>.<wert> | waffe <id> | gegner <rolle> [fraktion] | alarm on|off | fang.
    // FIX-ZIELEN: input { seq, mx, my, aim? } – aim = Zielwinkel zum Mauszeiger in ganzen Grad (atan2, x rechts, y unten),
    //   nur außen und mit Zeiger; fehlt aim, gilt wieder die Laufrichtung. Gesendet ab 4° Änderung, höchstens 20×/s.
    //   Snapshot players[].fa = Blickrichtung in ganzen Grad (nur Außenzone, nur solange aim gesetzt ist; fehlt = dir).
    CMD_LOADOUT_WAFFE: 'loadout.waffe',
    WAFFEN: ['blaster', 'sturmgewehr', 'granatwerfer', 'lanze', 'nahkampf', 'betaeuber', 'faust'],
    WAFFEN_WAHL: ['blaster', 'sturmgewehr', 'granatwerfer', 'lanze', 'nahkampf', 'betaeuber'],
    GEGNER_ROLLEN: ['grundtyp', 'niederhalter', 'grenadier', 'schuetze', 'enterer', 'haescher', 'waechter'],
    KOERPER_ZUSTAENDE: ['ok', 'verwundet', 'bewusstlos', 'gefesselt', 'gefangen', 'aus'],
    HOLD_KINDS_B2: ['fesseln', 'befreien', 'aufrichten', 'ausruestung', 'zellentuer'],
    PLAYER_SNAP_B2: ['wf', 'ht', 'ov', 'ch', 'wu', 'zs', 'bt'],
    DRONE_SNAP_B2: ['ro', 'fr', 'pa', 'wf', 'ch', 'wu', 'zs', 'bt', 'wn', 'wm', 'gr'],
    AWAY_SNAP_B2: ['tr'],
    B2_EVENTS: ['ueberhitzt', 'ladungLanze', 'lanzeSchuss', 'ausholen', 'schlag', 'granate', 'granateEinschlag', 'betaeubt', 'bewusstlos',
      'gefesselt', 'befreit', 'aufgerichtet', 'abgelenkt', 'truppAlarm', 'gefangen', 'rolleNeu', 'loadout'],
    B2_DEBUG: ['waffe', 'gegner', 'alarm', 'fang'],
    // ---- B3 (CONTRACT-B3 §6): Sektorkarte (Hexfeld) ----
    // welcome.sektorkarte: Inhalt von content/welt/limes.json ohne praesenz (≈ 6 KB), nur im welcome, nie im Snapshot.
    // Snapshot world.sektoren { e: [hex], b: [kantenId], t: [kantenId], o: [kantenId], v } – nur wenn sich v ändert (wie
    //   world.locations), sonst fehlt das Feld.
    // SUND-01 C: Snapshot world.lage { t, vz, sw, hx, f[], m[] } – nur im Modus freie_fahrt, nur bei Änderung (Schlüssel t:ver), für alle Clients gleich, nie im
    //   Snapshot mit Asteroiden/Ortsliste/Logbuch/Buch (≈ 0,3 bis 1,2 KB). Das ist das WISSEN von Rom (Sensorknoten: römische Häfen, Posten, Flotten und die Lerche;
    //   Sichtweite sw Sprünge, fremde Daten mit vz Ticks Verzögerung), nie der Sim-Zustand und nie ein wahres Ziel. t = Tick des Stands, vz = Verzögerung (Daten),
    //   sw = Sichtweite (Daten). hx = je Kartenhex (Reihenfolge Object.keys(karte.hexe).sort(), KarteTokens.hexReihenfolge) zwei Zeichen: Besitzer r g k p - v
    //   (Großbuchstabe = Posten), Alter e = jetzt, 1–9 a–d f–z = Ticks (ohne e; KarteTokens.alterZeichen), ? = nie gesehen (Besitz dann laut Karte). f[] (≤ 12, nach Rang) Plaketten { f Fraktion, h Hex,
    //   k Stärkeklasse 1–3, p Phase h u s m b r, a Alter (0 = eigen), Kurs: v „kam von“ (fremde Flotten, beobachtete Bewegung) oder n nächstes Hex (nur eigene Flotten), z vermutetes Ziel (nur Marsch, eine Schätzung), d Ticks im Sammeln }.
    //   m[] (≤ 6) Meldungen { e sa ma be hf hh pg pv, h Hex, t Tick, f?, k? }. Ereignis radio { from, text, lage: 1, tick } = Lagefunk (einmal je Feldzug); Szenenfunk zusätzlich sz: 1 (Szene), r: 1 (wichtig: Vorwarnung/Ergebnis, nur diese kommen in den Funk-Reiter); Ereignis odaWeg {} räumt die Szenen-ODA (Ortung/Erste Welle) weg.
    //   Dazu welt.sim.wissen im Weltstand (Schema) und Notruf-Marken in world.marken.
    //   SUND-02b UI: st?: [Hex] Stützpunkte der Crew (Overlay crew: römischer Posten mit Garnison, Dock und Werft), nur wenn es welche gibt; der Schlüssel nimmt die Liste mit.
    // SUND-02b B: Snapshot world.ruf { rom, ger, kon, rang, name, ab, bis } nur bei Änderung (nie in den großen Snapshots); world.ruf = null ist das Löschsignal (einmal, wenn der Modus endet: Kampagne, Lobby), der Client leert dann seinen Ruf wie lage.
    // Snapshot space.jp [{ k: kantenId, x, y, z: JP_STATES, n: zielHex }] (nur bekannte Bojen der Szene, ≤ 6).
    // Snapshot ship.jump: zusätzlich jp (Kante des gewählten Ziels), d (Abstand in m, gerundet).
    // Snapshot ship.jump.anflug (boolean, immer): true = Sprungpunkt muss angeflogen werden (freies Spiel), false = Tutorial
    //   (Faltsprung von überall). Quelle: server/sim/sprung.js anflugPflicht(game).
    // cmd { c: 'helm.notsprung' } – Pilot oder Captain. cmd captain.selectDest { dest } wie bisher (Ort-ID oder leer-<hex>);
    //   zusätzlich { hex } erlaubt.
    // Debug: hex <SSZZ> | boje <kante> | notsprung | erkunde alle.
    WELCOME_SEKTORKARTE: 'sektorkarte',
    WORLD_SEKTOREN_FIELDS: ['e', 'b', 't', 'o', 'v'],
    SPACE_JP_FIELDS: ['k', 'x', 'y', 'z', 'n'],
    JP_STATES: ['aktiv', 'gesperrt', 'temporaer', 'ohne_strom'],
    SHIP_JUMP_B3: ['jp', 'd', 'anflug'],
    CMD_HELM_NOTSPRUNG: 'helm.notsprung',
    B3_EVENTS: ['notsprung', 'bojeGefunden', 'hexErkundet', 'sprungpunktOffen', 'sprungpunktZu', 'sperrriegelOffen'],
    B3_DEBUG: ['hex', 'boje', 'notsprung', 'erkunde'],
    // ---- S2 (CONTRACT-S2 §4): Spielleiter-Angebote, Schützling, Kapitelkarte ----
    // cmd { c: 'plan.decline', id } – Angebot im Missionsbuch ablehnen (wie plan.accept; ohne Malus).
    // cmd { c: 'captain.escort', tag, befehl: ESCORT_ORDERS } – Befehl an einen Schützling (Captain-Konsole).
    // Snapshot space.escorts[] (≤ 2): ESCORT_FIELDS; space.enemies[].tgt = Escort-ID, wenn ein Gegner einen Schützling anvisiert.
    // Snapshot mission.planning: null | { stage: 0|1|2, von } (immer, klein). 0 Peilung, 1 Rat berät, 2 gesiegelt.
    // Bucheintrag state 'angeboten' (Spielleiter): zusätzlich von, ziel, dauer_min, belohnung, erinnerung; origin ('sl'|'archiv')
    //   nur bei Debug-Servern.
    // Ereignisse: offerIn { id, title, from }, sceneWait { sec }, chapter { title, text }, escortHit { id, hpFrac },
    //   escortDistress { id, hpFrac }, escortDisabled { id }, escortArrived { id }, escortSaved { id }, escortOrder { id, befehl, ok }.
    // Debug: sl status | sl plan | sl fail grobplan|szene | sl archiv; escort <kind>  (Text in msg.args).
    // ---- S2b (CONTRACT-S2B §2): Sperrfeuer der Korvette ----
    // Snapshot space.projectiles[] { id, kind, x, y, angle } – kind 'sperrfeuer' (langsames Geschoss, ungelenkt, aus der
    // Breitseite). Ereignis sfx { name: 'sperrfeuer', enemy: 'korvette', x, y } einmal je Feuerstoß (nicht je Geschoss).
    SPACE_PROJECTILES: ['torpedo', 'etorpedo', 'streu', 'estreu', 'sturm', 'enemy', 'emp', 'sperrfeuer'],   // PAN-01 C: bolzen entfällt (Torpedo), neue Arten
    CMD_PLAN_DECLINE: 'plan.decline',
    CMD_CAPTAIN_ESCORT: 'captain.escort',
    ESCORT_ORDERS: ['halten', 'folgen', 'volle_kraft', 'andocken'],
    ESCORT_STATES: ['ok', 'beschaedigt', 'kampfunfaehig', 'entkommen'],   // EK4: 'zerstoert' (Verbündeter) steht nur in escortsGone/Prüfungen, nie im Snapshot
    ESCORT_KINDS: ['frachter', 'karawane', 'bergungsboot'],
    ESCORT_FIELDS: ['id', 'tag', 'kind', 'name', 'x', 'y', 'angle', 'hp', 'hpMax', 'state', 'befehl', 'distress'],
    PLANNING_STAGES: [0, 1, 2],
    OFFER_FIELDS: ['von', 'ziel', 'dauer_min', 'belohnung', 'erinnerung'],
    OFFER_ORIGINS: ['sl', 'archiv'],
    // EK3 Teil A (CONTRACT-EK3 §4): Fracht. cmd { c: 'weapons.fracht', id? } startet das Beamen an Bord (3 s Halteprozess), { off: true } bricht ab;
    // cmd { c: 'weapons.abliefern' } gibt die Ladung beim Abnehmer / an einer Station ab (nur an der Ops-Konsole).
    // Ereignis frachtBeamen { phase: 'start'|'abbruch'|'fertig', was: 'an'|'ab', grund?, art?, n? }; frachtAbgeworfen { id, x, y, art }.
    // Snapshot fracht (nur wenn etwas da ist): { lager: [art], draussen: [{ id, x, y, art }], halt: { kind: 'an'|'ab', id?, p }, ab: 1, abn: Name, g: false }.
    // SL6: cmd { c: 'weapons.abwerfen', art? } wirft eine Einheit Ware ab, cmd { c: 'weapons.verkaufen' } verkauft an einen Händler (Halteprozess kind 'verk').
    // Snapshot fracht + { fuell: 0..1 (Schöpf-Füllstand), vk: 1 (Händler in Reichweite) }; Snapshot zonen (nur in Szenen mit Zonen): { in: [id], bk: [id], z?: { id: Zähler } }.
    // SL0: cmd { c: 'weapons.person', id? } beamt eine Person vom gewählten Landepunkt an Bord ({ off: true } bricht ab), { c: 'weapons.person_ab', id? } gibt sie an Abnehmer/Station/Landepunkt ab.
    // Snapshot fracht + { pers: [{ id, n, b }] (Personen im Frachtraum, b = Bett), pq: [{ id, n }] (Ops kann sie jetzt hochbeamen) }; ship.npcs enthält die liegenden Figuren (lie: 1).
    // U2: cmd { c: 'weapons.schoepfen' } startet das Schöpfen (Halteprozess kind 'schoepf', nur in der Förderschicht), { off: true } beendet es; halt.p = Füllstand 0..1.
    // SUND-02b A1: cmd { c: 'weapons.posten.gruenden' } / { c: 'weapons.posten.ausbauen' } (Ops, nur Freie Fahrt Sund) starten den Halteprozess kind 'posten' (halt.id 'gruenden' | 'ausbau'), Abbruch wie Fracht: weapons.fracht { off: true }.
    // SUND-02b A2: cmd { c: 'weapons.posten.angreifen' } (Ops) greift den Posten eines Gegners (ger, pirat) an: Halteprozess kind 'posten', halt.id 'angreifen' (Anlauf), danach die Angriffsszene (Sieg: Posten gesprengt).
    // Snapshot space.po { k: 'g' | 'a' | 'x', ok: 0 | 1, t?: Weigerungstext, n: Ersatzteile } (g gründen, a ausbauen, x angreifen) nur im Hex, wo ein Posten Sinn hat und nicht während einer Sim-Szene und ihrer Ergebniszeile; Werft-Block + { hs: Text } am Stützpunkt (Handel gesperrt).
    // SUND-02b E: cmd { c: 'weapons.verrat.beginnen' } (Ops, nur in einer Sim-Szene der Freien Fahrt Sund mit römischen Verbündeten, Phase Vorwarnung oder Kampf) startet den Halteprozess kind 'posten', halt.id 'verrat' (Anlauf mit Warnung, Abbruch kostenlos wie überall: weapons.fracht { off: true });
    // erst am Ende des Anlaufs wird die Szene umgeschaltet (Verbündete -> Gegner) und der Ruf bei Rom sinkt. Snapshot space.po { k: 'v', ok, t? } nur in solchen Szenen; flotte.sz + { w?: [Restsekunden, Dauer] (Halteprozess läuft, Warnung für alle), vt?: 1 (Verrat läuft/Ergebnis) }.
    CMD_FRACHT: ['weapons.fracht', 'weapons.posten.gruenden', 'weapons.posten.ausbauen', 'weapons.posten.angreifen', 'weapons.verrat.beginnen', 'weapons.abliefern', 'weapons.abwerfen', 'weapons.verkaufen', 'weapons.schoepfen', 'weapons.person', 'weapons.person_ab'],
    FRACHT_EVENTS: ['frachtBeamen', 'frachtAbgeworfen', 'frachtVerloren', 'frachtGesichert'],   // PAN-01 A: frachtVerloren { art } (ungesichert + Hüllentreffer), frachtGesichert { an }
    FRACHT_ARTEN: ['sprengstoff', 'fracht', 'deuterium'],
    // EK3 Teil B (CONTRACT-EK3B §4): Konvoi. Transporter sind Gegner (space.enemies[].kind 'frachter'); beim Sprung trägt der Eintrag sj (Aufladung 0..1).
    // Ereignis konvoiSprung { x, y } (Transporter gesprungen), konvoiAusgang { was: 'gepluendert'|'aufgehalten'|'entkommen' }.
    KONVOI_EVENTS: ['konvoiSprung', 'konvoiAusgang'],
    KONVOI_AUSGAENGE: ['gepluendert', 'aufgehalten', 'entkommen'],
    // SUND-04a-1 A (gezielter Systemtreffer der Ops, Szenentyp A6 Verfolgung): cmd { c: 'weapons.systemziel', id: 'antrieb' | null } wählt das System am gescannten Ziel an (null hebt es auf; verfällt mit dem Ziel und der Szene).
    // Snapshot: ship.zs = gewähltes Systemziel (fehlt = keins); space.enemies[].az = Antriebsstufe des GESCANNTEN Ziels (1 beschädigt, 2 ausgefallen; fehlt = voll), sj = Fortschritt der Sprungladung 0..1 und nm = Name (nur das fliehende Zielschiff);
    // space.vf = { x, y, r } Fluchtpunkt der Verfolgung (nur solange das Zielschiff flieht). Daten: content/kampf/zielsysteme-werte.json (der Client lädt sie, public/js/zielsysteme.js) und verfolgung-werte.json.
    // missionEvent: zielsystemGetroffen { enemy?, system, stufe, seite: 'gegner'|'lerche' }, verfolgungStart, verfolgungSprungStart, verfolgungAusgang { was, klasse, name, volk, versuch }. Debug: zielsysteme [an|aus|frei], verfolgung [klasse] [ohne].
    ZIELSYSTEME_CMD: ['weapons.systemziel'],
    VERFOLGUNG_AUSGAENGE: ['gestellt', 'zerstoert', 'entkommen'],
    // ---- EK4 (CONTRACT-EK4): Flotte. Snapshot space.escorts[] enthält zusätzlich Verbündete (al: 1, kind korvette|fregatte|kreuzer|raider, bis CONFIG.flotte.max);
    // Snapshot flotte (fehlt ohne Flotte): { b?: { a: Befehlsart, st: 0 läuft|1 erfüllt|2 gescheitert|3 abgebrochen, r?: Rest-Frist s, k?, n? (Abschüsse), i?, w?: [[x, y, ok]], rad?, s?: Schiff-ID, g?: Grund },
    // wl?: [Welle, von, druck?], sz?: Szenenzeile (nur Freie Fahrt Sund, nur während einer Sim-Szene und CONFIG.simSzene.endeAnzeige (6) s danach: { p: 'v' Vorwarnung|'k' Kampf|'f' Finale|'s' Sieg|'n' Niederlage, v?: [Restsekunden, Vorwarnzeit], f?: 'ger'|'pirat', k?: Stärkeklasse 1–3, g?: lebende Gegner, kd?: Kommandant (≤ 24, nur Finale), o?: Ort (nur Sieg/Niederlage mit Ort), x?: 1 (SUND-02b A2: Angriff der Crew auf einen Posten: Zeile „ANGRIFF AUF POSTEN“, Ergebnis „Posten gesprengt“/„Angriff gescheitert“; im Finale nennt kd den Postenkommandanten) } }; Gegner im Snapshot: fg: 1 = Flaggschiff der Sim-Szene. Funkspruch (Ereignis radio und mission.radio) trägt pid: 'legat' | 'mars' (Porträt bzw. Symbol).
    // Ereignisse: flotteBefehl { id, art, st, grund?, frist? }, flotteWegpunkt { id, i, n }, flotteWelle { n, von }, flotteDruck { n }, flotteNeustart {},
    // flotteGedaechtnis { art }, flotteFehlt { tag }, flotteNachschub { art, rest }, allyDistress { id, tag, kritisch? }, allyLost { id, tag, name, x, y, kapsel },
    // allyEintritt { id, tag, name, x, y, dauer } (Sprungblitz). Snapshot flotte.nq = wartender Nachschub; Verbündete im Snapshot: state/befehl/distress fehlen = ok/null/false, ein: 1 beim Einblenden.
    EK4_EVENTS: ['flotteBefehl', 'flotteWegpunkt', 'flotteWelle', 'flotteDruck', 'flotteNeustart', 'flotteGedaechtnis', 'flotteFehlt', 'flotteNachschub', 'allyDistress', 'allyLost', 'allyEintritt'],
    FLOTTE_ARTEN: ['ausschalten', 'eskortieren', 'durchbrechen', 'zurueckfallen', 'entlastung'],
    ALLY_KINDS: ['korvette', 'fregatte', 'kreuzer', 'raider'],
    FUNK_PORTRAETS: ['legat', 'mars'],
    S2_EVENTS: ['offerIn', 'sceneWait', 'chapter', 'escortHit', 'escortDistress', 'escortDisabled', 'escortArrived', 'escortSaved', 'escortOrder'],
    SL_DEBUG: ['status', 'plan', 'fail', 'archiv'],
    // ---- S1 (CONTRACT-S1 §6): Weltstand, Spielmenü ----
    // lobbyOpt { world: id | null } – Fortsetzen wählen (null = neu); gesetzt -> startMission wird beim Start ignoriert.
    // world { op: 'delete', id } – nur Lobby; gesperrt -> { t: 'error', code: 'worldbusy' }.
    // menu { op: 'end' } – Partie für alle beenden (angedockt + Kampagne: vorher speichern) -> Ereignis sessionEnded, Lobby.
    // menu { op: 'pause', on } – nur wirksam, wenn genau 1 Spieler verbunden ist.
    // Snapshot: paused (immer); nur in Phase 'lobby': lobby.worlds [WORLD_LIST_FIELDS], lobby.world (id|null), lobby.worldsFull.
    // Kann: mission.chronik (letzte 10 { text, mission?, ausgang?, spielzeit_s }) im Log-Slot (zusammen mit mission.log).
    // Ereignisse: worldSaved { id, name, loc }, worldSaveFailed { reason }, worldLoaded { id, name },
    //   worldLoadFailed { id, reason }, sessionEnded { by, saved }, missionDone { id, title, ausgang }.
    // Start einer neuen Kampagne bei 5 Ständen: abgelehnt (notice „Erst einen Weltstand löschen“, lobby.worldsFull).
    MENU_OPS: ['end', 'pause'],
    WORLD_OPS: ['delete'],
    WORLD_STATES: ['ok', 'kaputt', 'neuer', 'belegt'],
    WORLD_LIST_FIELDS: ['id', 'name', 'savedAt', 'playTime', 'loc', 'mission', 'step', 'chronikLast', 'spieler', 'state', 'grund'],
    WORLD_EVENTS: ['worldSaved', 'worldSaveFailed', 'worldLoaded', 'worldLoadFailed', 'sessionEnded'],
    // ---- M4 Stufe 1 (CONTRACT-M4 §2.4): Lift und Notleiter. Alle Felder optional (nur wenn aktiv bzw. an Bord). ----
    // PAN-01 B (drei Decks, Ausbaustufe): Snapshot ship.st = Ausbaustufe 0–3 (nur gesendet, wenn > 0; fehlt = 0; Weltstand schiff.stufe). Sie öffnet Waffenplätze (3 → 5 → 7 → 9),
    //   Modulräume (2 → 3 → 4) und die verschalten Pforten (Maps.SHIP_SEALS); Client-Kollision, Lift-Optionen und Darstellung richten sich nach ihr (Maps.shipSolidFn(st), Maps.fahrtOptionen(x, y, st)).
    //   Snapshot players[i].lm = Wahl am Lift offen (Bitmaske 1 = nach oben möglich, 2 = nach unten möglich; nur bei offener Wahl, nicht bei Bewusstlosen oder während der Fahrt).
    //   Snapshot players[i].lift = { to: Deck 0|1|2, t, T, via?: 'ladder' } während der Fahrt (Lift ~2 s, Notleiter 2 s; x/y bleiben stehen, Teleport bei t >= T).
    //   Eingabe an Lift/Notleiter: E öffnet die Wahl, W hoch, S runter, A/D oder E schließen; der Server fährt erst nach dem Loslassen der Taste ('armed').
    // Snapshot players[i].deck: 0 Mitteldeck / 1 Oberdeck / 2 Unterdeck (nur zone 'ship', aus y abgeleitet; Komfort für den Client); lm = Wahl am Lift offen (Bitmaske 1 hoch, 2 runter)
    //          players[i].lift: { to: 0|1, t, T } während der Liftfahrt (Eingaben gesperrt, kein Schaden, x/y bleiben stehen,
    //                           Teleport bei t >= T; Client: keine Bewegungsvorhersage, solange lift gesetzt ist)
    //          players[i].ladder: { t, T } solange E an der Notleiter gehalten wird (zusätzlich action { kind: 'ladder', progress })
    //          bots[i].lift: { to, t, T } während ein Bot Lift fährt
    // Ereignis lift { pid | bot, deck, phase: 'start'|'arrive', T? (nur start), via?: 'ladder' (nur Leiter, nur arrive) }
    // Interaktion: auf ^ stehen + E tippen = Lift; an ! E halten (CONFIG.lift.ladderTime) = Leiter.
    DECK_FIELDS: ['deck', 'lift', 'ladder'],
    LIFT_PHASES: ['start', 'arrive'],
    WS_PATH: '/ws',
    // Client -> Server   (B2: shoot { angle, los?: true } – los = Abzug losgelassen: Lanze feuert mit der erreichten Stufe.
    //   Der Server reicht msg.los an away.shoot weiter (Auswertung BODENKAMPF); ohne los gilt shoot wie bisher als Halten/Schuss.
    //   B2-NACH: shoot { angle, dist? } – dist = Abstand Spieler → Mauszeiger in Kacheln. Wurfwaffen landen dort, begrenzt auf
    //   [min, max] der Waffe; ohne dist volle Weite wie bisher. Direkte Waffen nutzen nur den Winkel.)
    C: {
      HELLO: 'hello', READY: 'ready', INPUT: 'input', ACT: 'act', SHOOT: 'shoot', MARK: 'mark',
      DROP: 'drop', LEAVE: 'leave', SCHUBS: 'schubs', CMD: 'cmd', PING: 'ping', DEBUG: 'debug',
      LOBBY_OPT: 'lobbyOpt',   // M0: { skipDrill: bool } – nur in der Lobby, jeder darf umschalten; M2: { startMission: START_MISSIONS }; S1: { world }
      WORLD: 'world',          // S1: { op: 'delete', id }
      MENU: 'menu',            // S1: { op: 'end' } | { op: 'pause', on }
    },
    // Server -> Client
    S: { WELCOME: 'welcome', SNAP: 'snap', EVENT: 'event', PONG: 'pong', FULL: 'full', ERROR: 'error' },
    // Fehlercodes in { t: 'error', code, text }
    ERR: { BADCODE: 'badcode', WORLDBUSY: 'worldbusy' },
    // 'quartier' öffnet sich an der eigenen Koje, 'kustodenpult' am Kustodenpult (Außenmission; bis SL0 „sonde“).
    CONSOLES: ['helm', 'captain', 'weapons', 'technik', 'transfer', 'shop', 'quartier', 'kustodenpult', 'plan'],   // M1: 'plan' (Planungstisch, nicht exklusiv; 'weapons' = Anzeige „OPS“); R1: 'technik' = vierte Rolle (Maschinenraum)
    // R1 §4.4: Stationskreis für Tab/Shift+Tab (Interface-Wechsel, der Spieler bleibt an seiner Konsole stehen): Navigation, Ops, Captain, Technik
    STATION_KREIS: ['helm', 'weapons', 'captain', 'technik'],
    CMD_STATION_TAB: 'station.tab',   // { dir: 1 | -1 } – ohne Konsolenpräfix, geprüft in station.tab
    // R1 §4.2: Technik-Befehle (Konsole 'technik'); die alten captain.* antworten nur mit einem Hinweis
    CMD_TECHNIK: ['technik.power', 'technik.shield', 'technik.priority', 'technik.repair', 'technik.botAuto', 'technik.overload', 'technik.module'],
    // PAN-01 A: technik.module { id, on } schaltet ein Bordmodul ab/an (id = MODUL_IDS, bei mehreren gleichen Modulen { id, raum }). Snapshot ship.mod = [[code, raum, an, läuft]]
    // (code f|k|w = Frachtraum | Krankenstation | Werkstatt; an = Wunsch der Technik, läuft = tatsächlich aktiv, also an UND genug Reaktorleistung); jedes laufende Modul zieht 1 Energie.
    // Debug modul [status | start | voll | an <id> [raum] | aus <id> | weg <id>]. Weltstand schiff.module [{ id, raum, an }].
    MODUL_IDS: ['frachtraum', 'krankenstation', 'werkstatt'],
    // PAN-01 D: Werft am Terminal (Konsole 'shop', nur angedockt an einer Flottenbasis, jeder Spieler). cmd { c: 'werft.freischalten', art: 'stufe'|'waffe'|'modul', id },
    // { c: 'werft.umbau', platz: 1–9, waffe: Katalog-Id | 'leer' }, { c: 'werft.modul', raum: 1–4, id: Modul-Id | 'leer' }. Antwort an den Absender: Ereignis
    // werftAntwort { pid, op, ok, code?, text? } (bei Fehler zusätzlich notice); bei Erfolg an alle: Ereignis werft { op: 'freigeschaltet'|'umbau', art, id, platz?, raum?, marks?, pid }.
    // Fehlercodes (WERFT_CODES). Snapshot werft { aktiv, grund?, nutzer (Spielerfarbe), stufe, waffen { Platz: Id }, module { Raum: Id|null (offene Räume, null = leer) }, frei { stufe, waffen[], module[] }, preise { stufe, waffe, modul }, zu [Farben der Zuschauer], ui { b: 'h'|'w', a: 'p'|'m'|'s', n, i } (Ansicht des Nutzers für Zuschauer) }
    // nur, solange jemand am Terminal sitzt (aktiv: false = nur aktiv, grund, nutzer, stufe). Weltstand schiff.freigeschaltet { stufe, waffen[], module[] }. Debug werft, marken <n>.
    // SUND-02b D: Strategische Optionen am Terminal (Konsole 'shop', nur Freie Fahrt Sund, ab Tribun, jeder Spieler, keine Rolle). cmd { c: 'absicht.waehlen', id } wählt eine Absicht des Angebots (die erste Wahl gilt, jede weitere bekommt „schon gewählt“),
    //   cmd { c: 'absicht.ablehnen' } schließt das Angebot (ohne Folgen). Antwort an den Absender: Ereignis absichtAntwort { pid, op: 'waehlen'|'ablehnen', ok, code?, text? }.
    //   Snapshot world.absicht { frei: 0|1, ab: Name des Mindestrangs, angebot?: [{ id, name, text, dauer }] (2 bis 3), rest?: Sprünge bis zum Verfall, laufend?: { id, name, text, rest, dauer } } nur bei Änderung (nie in den großen Snapshots),
    //   world.absicht = null ist das Löschsignal (einmal, wenn der Modus endet), der Client leert dann seinen Block wie world.ruf.
    CMD_ABSICHT: ['absicht.waehlen', 'absicht.ablehnen'],
    // SUND-04a-3: Entscheidungsschlacht um Hrafnheim am Terminal (Konsole 'shop', nur Freie Fahrt Sund, ab Tribun, jeder Spieler, keine Rolle), zweistufig wie der Verrat: cmd { c: 'finale.waehlen' } stellt die Anfrage,
    //   cmd { c: 'finale.bestaetigen' } beginnt das Finale (nur innerhalb der Frist nach der Anfrage, die erste Bestätigung gilt), cmd { c: 'finale.ablehnen' } schließt das Angebot (ohne Folgen).
    //   Antwort an den Absender: Ereignis finaleAntwort { pid, op: 'waehlen'|'bestaetigen'|'ablehnen', ok, code?, text? }.
    //   Snapshot world.finale { frei: 0|1, ab: Name des Mindestrangs, name, text, angebot?: 1, anfrage?: Sekunden der Frist, phase?: 'orbit'|'boden'|'ende' } nur bei Änderung (nie in den großen Snapshots), erst ab Tribun,
    //   world.finale = null ist das Löschsignal (Modus endet oder der Rang fällt, ohne Angebot und ohne Finale). Das Finale ist nicht speicherbar. Debug finale [status | angebot | start | orbit <ausgang> | boden <ausgang> | reset].
    CMD_FINALE: ['finale.waehlen', 'finale.bestaetigen', 'finale.ablehnen'],
    // SUND-03b A: Funk-Antworten mit Folgen (nur Freie Fahrt Sund mit Reise-Ereignissen, nach Funkmeldung, römischer Streife, Havarie-Notruf; nie bei Gefahr). cmd { c: 'funk.antworten', id, nr? } wählt eine Option des offenen Angebots (id aus world.funkwahl.optionen)
    //   oder 'ignorieren' (schließt es für alle, ohne Folge); nr = Nummer des Angebots (ein Klick auf ein älteres Angebot gilt nicht). Jeder Spieler, keine Konsole, keine Rolle; die ERSTE Antwort gilt, jede weitere bekommt „schon beantwortet“.
    //   Antwort an den Absender: Ereignis funkAntwort { pid, ok, code?, text? } (code: modus | kein_angebot | schon_beantwortet | unbekannt | unruhig | deckel | am_boden). Alle hören die Antwort der Crew und die Reaktion des Sprechers als Ereignis radio.
    //   Snapshot world.funkwahl { nr, von, optionen: [{ id, text }] (2 bis 3), ignorieren, rest: Sprünge bis zum Verfall } | null (kein Angebot; null ist das Löschsignal) nur bei Änderung (nie in den großen Snapshots).
    CMD_FUNK_ANTWORT: 'funk.antworten',
    // SUND-04a-2 P2: Bitten der Geschichtsfäden (Freie Fahrt Sund mit FAEDEN=1, nach dem Angebot des Beats `bitte`). cmd { c: 'faden.bitte', id, nr } wählt eine Option des offenen Angebots (id aus world.bitte.optionen,
    //   nr = Nummer des Angebots); „Später“ ist nur lokal (kein Befehl). Jeder Spieler, keine Konsole; die ERSTE Antwort gilt. Antwort an den Absender: Ereignis fadenBitteAntwort { pid, ok, code?, text? } (code wie funkAntwort, zusätzlich kein_angebot bei verlaufenem Beat).
    //   Snapshot world.bitte { nr, von, pid?, text, optionen: [{ id, text }], kopf, spaeter, rest: Tätigkeiten bis zum Verfall } | null (Löschsignal), nur bei Änderung.
    CMD_FADEN_BITTE: 'faden.bitte',
    // SUND-03b I: Informationshandel des Konkordats am Terminal (Konsole 'shop', nur Freie Fahrt Sund, nur an Häfen des Konkordats, jeder Spieler, die Marken sind geteilt). cmd { c: 'info.kaufen', thema: 't0'|'t1'|'t2' (Id im Angebot), stufe: 'gerucht'|'beleg', art, k (Art und Kennung des Themas wie angezeigt: stimmen sie nicht mehr, hat sich das Angebot geändert und es wird nichts gekauft) }.
    //   Antwort an den Absender: Ereignis infoAntwort { pid, op: 'kaufen', ok, stufe?, text, zuv?: 'gerucht'|'beleg', code? } (Codes: kein_weltsim, nicht_angedockt, kein_konkordat, stufe_unbekannt, kein_angebot, unbekannt, gekauft, zu_wenig_marken, fehler); bei Erfolg an alle die Funkzeile (Absender Konkordat, Gerücht „Gerücht, unbestätigt: …“, Beleg „Beleg des Konkordats: …“).
    //   Snapshot world.info { th: [{ i: Id, a: Art, k: Kennung (5 Buchstaben), g?: 1, b?: 1 }] (2–3 Themen ohne Fakten; g/b = Stufe schon gekauft), l?: [{ s: 'g'|'b', x: Text }] (die letzten Käufe) } nur an einem Konkordat-Hafen, solange jemand am Terminal sitzt, nur bei Änderung; world.info = null ist das Löschsignal.
    CMD_INFO: ['info.kaufen'],
    CMD_WERFT: ['werft.freischalten', 'werft.umbau', 'werft.modul', 'werft.vorschau', 'werft.ansicht', 'werft.zusehen', 'werft.start'],   // werft.start: Szene der Wellenmodi starten (nur Testumgebung, Rüstphase)   // werft.ansicht { b, a, n, i } (nur der Nutzer am Terminal), werft.zusehen { on } und werft.vorschau auch ohne Konsole   // werft.vorschau { art, platz|raum|id } -> Ereignis werftVorschau { pid, vorschau } (Werft.vorschau)
    WERFT_ARTEN: ['stufe', 'waffe', 'modul'],
    WERFT_CODES: ['nicht_angedockt', 'keine_flottenbasis', 'unbekannt', 'schon_freigeschaltet', 'nicht_freigeschaltet', 'stufe_reihenfolge', 'zu_wenig_marken', 'ruf',
      'platz_unbekannt', 'platz_gesperrt', 'platzart', 'raum_unbekannt', 'raum_gesperrt', 'fracht_belegt', 'person_im_raum', 'kein_start', 'unveraendert', 'umbau'],
    CMD_CAPTAIN_ALT_TECHNIK: ['captain.power', 'captain.shield', 'captain.priority', 'captain.repair', 'captain.botAuto', 'captain.overload'],
    // M3a: 'weapons' ist Altname (schlechtester Zustand der drei Waffen, keine Station). CONTRACT-M3 §4.1. PAN-01 B: die Lebenserhaltung ist gestrichen (13 Systeme).
    SYSTEMS: ['reactor', 'engines', 'shields', 'weapons', 'transfer',
      'thruster_port', 'thruster_stbd', 'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port', 'weapon_bow', 'battery_port', 'battery_stbd',
      'lafette_5', 'lafette_7', 'lafette_9', 'lafette_1', 'lafette_3', 'lafette_2',
      'modul_1', 'modul_2', 'modul_3', 'modul_4'],   // SYS-01 A1a: Bordmodule als Systeme (Mitte); PAN-01 C: Lafetten als echte Systeme (nur mit offenem, bestücktem Platz aktiv)
    // PAN-01 A: nur die Hauptsysteme; die Lebenserhaltung ist kein Energieposten mehr, Bordmodule zählen über ship.mod
    POWER_SYSTEMS: ['engines', 'shields', 'weapons'],
    // M1: Systemzustände ('offline' = EMP, zählt wie broken, startet nach CONFIG.emp.offlineTime selbst neu)
    SYSTEM_STATES: ['ok', 'damaged', 'broken', 'offline'],
    REACTOR_STATES: ['online', 'overload', 'offline'],
    MOUNTS: ['bow', 'port', 'stbd', 'p5', 'p7', 'p9', 'p1', 'p3', 'p2', 'bolzen', 'phase_l', 'phase_r'],   // PAN-01 C: neun Plätze (bow = 8, port = 4, stbd = 6, p<Platz>); bolzen = Altname des Torpedowerfers, phase_* = Altnamen
    REPAIR_MODES: ['flick', 'part'],
    BEAM_KINDS: ['phase', 'lance', 'battery', 'enemy_heavy', 'bolzen'],
    SIDES: ['bow', 'stbd', 'aft', 'port', 'mid'],
    CMD_REPAIR: ['repair.start', 'repair.done', 'repair.cancel'],   // M3a: ohne Konsole, nur Zone ship
    // M3a §20.3: Lanze als Ladewaffe. cmd { c: 'weapons.charge', mount: 'bow', on: bool } (Ops) – on:true lädt auf,
    // on:false feuert sofort mit der aktuellen power. Snapshot mounts[bow].power (0..1), .charging (bool).
    CMD_LANCE_CHARGE: 'weapons.charge',
    // Ereignis lance { state, power, hit }: 'charge' (Aufladen beginnt), 'fire' (Schuss, hit = Gegner-ID oder null),
    // 'fizzle' (Aufladen verpufft ohne Schuss: Konsole verlassen, System aus, angedockt)
    LANCE_STATES: ['charge', 'fire', 'fizzle'],
    // M3a §21.1: cmd { c: 'helm.stop' } (Steuer) -> Snapshot ship.helm.autoStop; endet bei helm.input ≠ 0 oder helm.dodge
    CMD_HELM_STOP: 'helm.stop',
    // M3a §21.2: Missionsbuch am Planungstisch. cmd { c: 'plan.focus', id|null }, cmd { c: 'plan.accept', id }.
    // Snapshot mission.book { version, focus, entries[] } nur bei Änderung; immer: mission.bookVersion und die HUD-Felder
    // mission.focusId, mission.focusTitle, mission.focusObjectives [{ id?, text, done, optional? }], mission.focusLoc
    // (= fokussierter Eintrag, ohne Fokus die laufende Mission).
    CMD_PLAN_BOOK: ['plan.focus', 'plan.accept', 'plan.decline'],   // S2: plan.decline
    BOOK_KINDS: ['mission', 'nebenauftrag', 'hinweis'],
    BOOK_STATES: ['angeboten', 'aktiv', 'erledigt'],
    // M3a §20.2: teleMiss { id, dodged: true } – Ladung endete ≤ spaceM3.dodgeWindow s nach einem Ausweichen
    ENEMY_KINDS: ['raider', 'korvette', 'relay', 'sentinel', 'pylon', 'fregatte', 'kreuzer'],   // EK1b: Fregatte, Kreuzer hinten angehängt (Reihenfolge ist Protokoll)
    HIDDEN_KINDS: ['cache', 'beacon', 'lore', 'hollow'],
    PIN_LABELS: ['ziel', 'gefahr', 'landeplatz', 'treffpunkt', 'frage'],
    // M2: tune { path, value } | { args: 'pfad wert' }, kesh, squad { which: '1'|'2'|'rear' }, wake, shield { n }, wound
    DEBUG_CMDS: ['ausbau', 'werft', 'marken', 'stage', 'damage', 'fire', 'breach', 'spawn', 'marks', 'inv', 'verlust', 'skip', 'god', 'goto', 'reveal', 'mission', 'reactor', 'scanall',
      'tune', 'kesh', 'squad', 'wake', 'shield', 'wound', 'tele', 'fragile', 'sl', 'escort', 'flotte', 'szene', 'ruf', 'absicht', 'finale', 'lage', 'abspann',   // SUND-04a-3: abspann palatina|sieg (nur Freie Fahrt Sund, zeigt den Abspann ohne Marker); SUND-03 A2: lage [status | plan | fail] (Lage-Spielleiter, LAGE_SPIELLEITER=1); SUND-02b D: absicht [status | angebot | wahl <id> | ende | reset] (nur Freie Fahrt Sund); SUND-02b B: ruf [rom|ger|kon] [wert] (nur Freie Fahrt Sund); SUND-02a: szene [staerke] [ger|pirat] [belagerung]; M3a: tele [id], fragile {system}; M3b: 'burst' entfallen; S2: sl, escort
      'buehne', 'anker', 'lp',   // B1 (B1_DEBUG)
      'waffe', 'gegner', 'alarm', 'fang',   // B2 (B2_DEBUG; tune waffen.<waffe>.<wert> läuft über 'tune')
      'hex', 'boje', 'notsprung', 'erkunde',   // B3 (B3_DEBUG)
      'sprungpunkt', 'ladung', 'prise',   // QA-Nachzug (QA_DEBUG)
      'notruf', 'spur',   // SL8/SL5: Labor-Einstiege (notruf [ids], spur [id])
      'entschl',   // SL5: entschl [id] startet ein Testsignal mit vier Schichten (Qualität 0..3, Schicht 3 versteckt)
      'bestueck',   // PAN-01 C: bestueck <platz 1–9> <waffe-id|leer> | alle [stufe] | start | status
      'modul',   // PAN-01 A: modul status | start | voll | an <id> [raum] | aus <id> | weg <id>
      'fracht',   // EK3 Teil A: fracht abwerfen [art] [dx dy] | an [art] | leer | gesichert an|aus | abnehmer [ort] | status
      'kapitel'],   // EK8: kapitel <id> – Einstieg in ein Kapitel der Kampagnenkette (Lobby: startet 'eisenwald_ohne')
    // ---- M3b Schritt A (CONTRACT-M3B) ----
    // §2 Temporegler: cmd { c: 'helm.throttle', delta: ±1 } oder { set: index }. Snapshot ship.helm.stage (Index),
    // ship.helm.stages (px/s je Stufe), ship.helm.autoStop. helm.input.thrust ist Altname (> 0,5 / < −0,5 = einmal ±1 Stufe).
    CMD_HELM_THROTTLE: 'helm.throttle',
    // §0.4 Schildstoß entfallen: cmd captain.burst antwortet nur mit Hinweis (Altname). shields.burst/burstCd bleiben
    // eine Version als null/0, stats.bursts/burstsPerfect ebenso (zählen nicht mehr).
    CMD_BURST_REMOVED: 'captain.burst',
    // §4 Ereignisse: escalated { system, tx, ty } (Feuer neben der Station), repairSetback { system, pid? | bot? },
    // hit { sector, shield, dmg, absorbed, hull, heavy, emp? } (shield = ganz gefangen; absorbed/hull neu).
    // Snapshot ship.escalate { [system]: Restsekunden }, ship.reactor.autoIn (s bis Gefechtsstart, nur wenn aktiv),
    // enemies[].vx/vy/state (§3), stats.leakHits/escalations/repairSetbacks/reactorAutoStarts (SYS-01 A1a: overflowHull entfällt).
    DAMAGE_EVENTS: ['escalated', 'repairSetback'],
    ENEMY_STATES: ['approach', 'overshoot', 'turn', 'station', 'retreat'],
    SECTORS: ['bug', 'steuerbord', 'heck', 'backbord'],
    ITEMS: ['ersatzteil', 'loeschgel', 'flickblech', 'bolzen', 'medipack', 'datenkern', 'tafel'],   // M2: 'tafel' (kein Regal, direkt ins Inventar)
    // M2 „Schildwall“ (CONTRACT-M2 §6/§7)
    // lobbyOpt { startMission }: Kampagne, Direktstart Planetenmission, Testgelände Raumkampf / Außenteam (Reihenfolge = Umschalter M)
    // S1: 'free' = Kampagne ohne Tutorial. Weltstand nur für m1/free; m3 und arena_* legen nie einen an.
    START_MISSIONS: ['m1', 'free', 'm3', 'arena_space', 'arena_away'],
    START_LABELS: { m1: 'Kampagne', free: 'Kampagne ohne Tutorial', eisenwald: 'Kampagne Eisenwald', eisenwald_ohne: 'Eisenwald ohne Tutorial', schuld_der_lerche: 'Die Schuld der Lerche', freie_fahrt: 'Freie Fahrt Sund', m3: 'Direkt zur Planetenmission', arena_space: 'Wellen All', arena_away: 'Wellen Boden', labor: 'Szenario-Labor' },
    START_HINTS: { m1: 'Von vorn: Boje, Nebel, Kesh', free: 'Freier Flug ab Hafen Lichtkordon', eisenwald: 'Tutorial, dann die feste Kette', eisenwald_ohne: 'Direkt in die Kette, ohne Tutorial', schuld_der_lerche: 'Karte Sund, Start am Boden von Kantenstein', freie_fahrt: 'Sund: Rom gegen Germanen, die Welt tickt mit', m3: 'Direkt: „Die Tafel von Kesh“', arena_space: 'Wellen von Jägern & Co. (solo ok)', arena_away: 'Endlos-Wellen, Karte: Taste K', labor: 'Umsetzung aus dem Katalog: ↑/↓' },
    // ---- AP3a Lobby (CONTRACT-W2 §1): Reihenfolge der Taste M. START_MISSIONS bleibt die alte Liste (Tests, Weltstand);
    // gültig als startMission ist jeder Eintrag aus LOBBY_MODI. 'labor' nur bei CONFIG.lobby.labor (Snapshot lobby.laborAn).
    LOBBY_MODI: ['m1', 'free', 'eisenwald', 'eisenwald_ohne', 'schuld_der_lerche', 'freie_fahrt', 'm3', 'arena_away', 'arena_space', 'labor'],   // EK8: Kampagne Eisenwald (Kette, ohne Spielleiter) mit bzw. ohne Tutorial
    // lobbyOpt { labor: { id?, seed?, staerke?, god? } } – Szenario-Labor (server/mission/labor.js), Felder werden zusammengeführt;
    //   id = 'molekuel/umsetzung' aus lobby.laborListe, seed = Partie-Seed, staerke = LABOR_STAERKEN, god = bool.
    //   Snapshot (nur Lobby): lobby.laborAn, lobby.labor { id, seed, staerke, god }, lobby.laborListe [{ id, name, schauplatz,
    //   kartenarten, landepunkt, staerke, startzustand }] (nur im Modus labor).
    // lobbyOpt { waffe: WAFFEN_WAHL | null } – Waffe je Spieler für Wellen Boden und Labor, gesetzt beim Start (vor dem Beamen).
    //   Snapshot (nur Lobby): lobby.waffen { [pid]: waffe } (nur gewählte).
    LABOR_STAERKEN: ['klein', 'mittel', 'gross'],
    // ---- Bodenkampf: Wellen (server/sim/wellen.js, CONFIG.wellen) ----
    // lobbyOpt { startMission: 'arena_away', wellen: WELLEN_KARTEN[i] } – Kartenwahl; jeder darf umschalten, Snapshot lobby.wellen.
    //   Ohne `wellen` bleibt arena_away der Altweg (Kesh/m3-Hof bzw. statische Karte aus `arena`, für Tests/Karten-QA).
    //   Mit `arena` (URL ?arena=away&art=…&seed=…) UND `wellen` = Wellen auf genau dieser Karte mit festem Seed; sonst neuer Zufalls-Seed.
    // Snapshot wellen (nur im Wellenmodus): { k: karte, s: seed, n: Welle, ph: WELLEN_PHASEN, t: Restsekunden (Countdown/Pause/Ergebnis),
    //   r: verbleibende Gegner der Welle (stehend + Nachschub), l: stehend }.
    // Ereignisse: welle { n, gesamt, neu: { rolle?, waffe?, rang?, gemischt? } } (Wellenbeginn; neue Rolle zusätzlich als rolleNeu),
    //   welleGeschafft { n, pause }, wellenEnde { karte, seed, welle, geschafft, zeit, kills: [[pid, name, n]], debug? } (debug = Debug-Sprung, kein Rekord).
    //   Abschüsse: Spieler, dessen Projektil im Tick des Falls am Gegner verschwand, sonst nächster stehender Spieler mit Sichtlinie.
    //   Nach wellenEnde + CONFIG.wellen.ergebnisZeit s: sessionEnded { by: null, grund: 'wellen' } und zurück in die Lobby.
    // Debug (nur --debug): welle <n> – sofort Welle n (aktuelle Gegner weg).
    WELLEN_KARTEN: ['aussenposten', 'station', 'ruine', 'schiff', 'kesh'],
    WELLEN_KARTEN_NAMEN: { aussenposten: 'Außenposten', station: 'Station', ruine: 'Ruine', schiff: 'Schiff', kesh: 'Kesh-Hof (klassisch)' },
    WELLEN_PHASEN: ['vorbereitung', 'countdown', 'kampf', 'pause', 'ende'],   // vorbereitung = Rüstphase der Testumgebung (Crew rüstet am Terminal aus, werft.start beginnt)
    CAMPAIGN_STARTS: ['m1', 'free', 'eisenwald', 'eisenwald_ohne', 'schuld_der_lerche', 'freie_fahrt'],   // Weltstand gibt es für diese Modi
    // EK8: Modi mit fester Kampagnenkette (content/kampagne/<id>.json, server/mission/kampagne.js): { kampagne, tutorial }. Kein Spielleiter.
    //   Snapshot abspann { titel, text, bloecke: [{ kopf, zeilen[] }], schluss? } (schluss: SUND-04a-3, Schlusssatz nach der Bilanz) nur in Phase end der Kette bzw. der Freien Fahrt Sund (kein freies Spiel danach); Ereignis ending { abspann: true };
    //   Funkspruch radio { from, text, pid? } mit pid 'mars' (Symbol) | 'legat' (Porträt), Snapshot mission.radio.pid.
    //   SL1: `welt` = Sektorkarte der Partie (content/welt/<welt>.json, server/sim/welt.js); ohne Angabe Limes.
    CAMPAIGN_KETTEN: { eisenwald: { kampagne: 'eisenwald', tutorial: true }, eisenwald_ohne: { kampagne: 'eisenwald', tutorial: false },
      schuld_der_lerche: { kampagne: 'schuld-der-lerche', tutorial: false, welt: 'sund' } },
    ORDER_KINDS: ['sammeln', 'halten', 'flanke', 'rueckzug', 'fokus', 'gefahr'],   // cmd captain.order { kind, x, y, target?, clear? }
    CMD_CROUCH: 'crouch',   // M2 §15: cmd { c: 'crouch', on: bool } – ohne Konsole, nur Außenzone auf v2-Karten; Snapshot players[].cr, away.drones[].cr
    AWAY_ENEMY_KINDS: ['drone', 'scavenger', 'warden'],
    AWAY_ROLES: ['idle', 'pin', 'flank', 'retreat', 'push', 'advance'],
    AWAY_PROJECTILES: ['blaster', 'drone', 'pistol', 'enemy', 'warden', 'granate'],   // B2: granate (tx, ty, t, flug)
    CODE_SYMBOLS: ['kreis', 'dreieck', 'raute', 'stern', 'welle', 'kreuz'],
    CODE_COLORS: ['mint', 'bernstein', 'rot', 'blau', 'pink', 'weiss'],
    CODE_COLOR_HEX: { mint: '#7FE0C2', bernstein: '#FFC66B', rot: '#E0473C', blau: '#56B4E9', pink: '#CC79A7', weiss: '#F4EEDC' },
    PLAYER_COLORS: ['#56B4E9', '#E69F00', '#CC79A7', '#7FE0C2'],   // R0: vier Spieler
    PLAYER_SHAPES: ['circle', 'triangle', 'diamond', 'square'],
  };
});
