// Zentrale Balancing-Werte (CONTRACT.md §6). UMD: window.Shared_Config / require.
// Der Server ist maßgeblich; der Client liest Werte nur für Anzeige und Vorhersage.
// Regel: Das Server-Team darf Schlüssel ERGÄNZEN, aber keine umbenennen oder entfernen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Config = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    port: 3300,
    maxPlayers: 3,
    tickHz: 30,          // Server-Simulation
    snapHz: 15,          // Snapshots an Clients
    view: { w: 640, h: 360 }, // interne Auflösung
    tile: 32,

    player: { speed: 96, hp: 100, reviveTime: 3, autoReviveTime: 15, hitbox: { w: 18, h: 12 }, revivedHp: 50, carrySpeedFactor: 0.85 },
    bot: { count: 2, speedFactor: 0.6, repairFactor: 1.75, extinguishTime: 2.5 },

    repair: { damagedToOk: 4, brokenToDamaged: 5, werkzeuggurtFactor: 0.7 },
    fire: { spreadInterval: 6, spreadChance: 0.35, max: 12, damageInterval: 10, playerDps: 5, extinguishTime: 1.5, gelCharges: 5 },
    breach: { hullPerSec: 0.5, o2PerSec: 0.5, pullRadius: 4, pullSpeed: 20, patchTime: 3 },
    o2: { max: 100, drainLifeBroken: 1, regen: 2, suffocateDps: 2 },
    // QA-Balance: systemChance 0.6 -> 0.35; systemCooldown: dasselbe System frühestens nach x s erneut per Treffer beschädigt;
    // spill: Anteil der Systemschäden, die auf ein System eines Nachbarsektors überspringen (Bug hat sonst nur die Waffenbank)
    hitEffects: { fireChance: 0.3, breachChance: 0.15, systemChance: 0.45, systemCooldown: 10, spill: 0.4 },   // M3a: 0.35/12 -> 0.45/10 (spill ersetzt durch spaceM3-Gewichte)

    ship: {
      hull: 100,
      maxSpeed: 130, accel: 50, turnRate: 0.5, drag: 0.35, // px/s, px/s², rad/s, Anteil pro s (M3a: 160/70/1.6 -> 130/50/0.5)
      turnAccel: 0.8,          // M3a: rad/s² – Winkelgeschwindigkeit nähert sich helm.turn × turnRate × turnCap
      dodgeImpulse: 180, dodgeCooldown: 10,   // M3a: 6 -> 10
      jumpCharge: 8,           // s bis Faltsprung bereit
      beamMaxSpeed: 30,        // Transfer nur langsamer als das
      beamTime: 3, beamTimeDamaged: 6,
      // QA M3a: hullRegen 0.4 -> 1.5 – im Testgelände (12 s Pause) kam die Hülle nach einem Notfallprotokoll kaum über 30,
      // jede folgende Welle löste das nächste aus (Kaskade). Jetzt +18 Hülle je Pause; in Missionen schneller zurück auf 70.
      hullRegen: 1.5, hullRegenMax: 70,   // ohne Gegner und Lecks flicken die Schrauber die Außenhaut (pro s, bis max)
    },
    power: { reactor: 8, reactorDamaged: 6, reactorBroken: 3, maxPerSystem: 4, heatAt4: 8, heatCool: 4, heatLimit: 100,
      default: { engines: 2, shields: 2, weapons: 2, life: 2 } },
    shields: { pointsPerPower: 2, maxPerSector: 4, regenInterval: 4, default: [2, 1, 0, 1] },

    weapons: {
      lanze: { arc: 90, facing: 0, range: 520, damage: 2, charge: 3, autoFactor: 0.5 },
      bolzen: { arc: 60, facing: 180, range: 650, damage: 5, speed: 400, magazine: 2, reloadTime: 4 },
      seitenturm: { arc: 120, facing: 90, range: 450, damage: 1, charge: 1.5 },
      // M1: zwei Phasenkanonen vorn links/rechts (Bögen -50…+10 und -10…+50), Sofortstrahl (Beam-Kind 'phase')
      phase_l: { arc: 60, facing: -20, range: 560, damage: 2, charge: 2.0, autoFactor: 0.5 },
      phase_r: { arc: 60, facing: 20, range: 560, damage: 2, charge: 2.0, autoFactor: 0.5 },
    },
    enemies: {
      raider: { hp: 12, speed: 120, fireInterval: 2.5, damage: 1, range: 400, salvage: 20 },
      // QA M3a: fireInterval 3 -> 4 (Ladung beginnt seltener; im Browser zu dritt kostete eine Kanonenboot-Welle bis 60 Hülle)
      gunboat: { hp: 40, speed: 50, fireInterval: 4, damage: 2, range: 500, salvage: 60 },
      relay: { hp: 2, speed: 30, fireInterval: 999, damage: 0, range: 0, salvage: 5 },   // Störrelais der Boje (schießt nicht)
      // M1: Kustoden-Wächter (EMP) und Pylonen (Frontschild, dreht langsam)
      sentinel: { hp: 18, speed: 35, fireInterval: 3.2, damage: 1, range: 330, salvage: 80, emp: true },
      pylon: { hp: 8, speed: 0, fireInterval: 3.5, damage: 1, range: 460, salvage: 25, turnRate: 0.15 },
    },
    asteroid: { count: 38, damage: 1 },
    // Bergungsgut im Asteroidenfeld (Stage route): Schiff fliegt drüber -> einsammeln. Pflicht, bis giveUpAfter s in der Stage.
    salvage: { count: 3, pickupDist: 60, giveUpAfter: 150, rewards: ['ersatzteil', 'flickblech', 'marks'], marks: 40 },

    away: {
      blaster: { damage: 2, speed: 360, cooldown: 0.35 },
      drone: { hp: 6, speed: 50, aggroRange: 160, fireInterval: 1.6, damage: 8, shotSpeed: 220 },
      codeLength: 3, codeLockout: 10, odaCodeHelpDelay: 20,
      reinforcementAfter: 90,   // s nach Ankunft des Außenteams: Nachzügler-Jäger oben
    },
    support: {
      sensor: { cooldown: 30, duration: 10 },
      strike: { cooldown: 40, delay: 1.5, radius: 80, damage: 10 },
      supply: { cooldown: 15, heal: 50 },
      recall: { cooldown: 60 },
      kuppel: { cooldown: 45, duration: 20, shieldCost: 2, absorb: 40 },
    },

    economy: {
      startMarks: 150, bribe: 100, rewardDeliver: 200, rewardDecode: 80,
      startInventory: { ersatzteil: 4, loeschgel: 2, flickblech: 3, bolzen: 6, medipack: 2 },
    },
    // M0: Regal-Kapazität für die Füllstandsanzeige (Bestand darf darüber liegen, Anzeige klemmt auf voll)
    shelfCapacity: { ersatzteil: 6, loeschgel: 4, flickblech: 4, bolzen: 12, medipack: 4 },
    // M0: Raumcode gegen Fremde im öffentlichen Tunnel (ROOM_CODE=off schaltet ab, ROOM_CODE=K7QM setzt ihn fest)
    roomCode: { length: 4, alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' },
    // M0: Hafen-Übung überspringen – ODA-Begrüßung und Funkspruch von Tesk (s nach Stage-Beginn)
    drillSkip: { greetAt: 0.5, radioAt: 6 },
    shop: [
      { id: 'seitenturm', name: 'Zusatzrohre', price: 300, kind: 'upgrade', where: ['hafen'] },
      { id: 'schildpool', name: 'Schildpool +2', price: 250, kind: 'upgrade', where: ['hafen'] },
      { id: 'schrauber3', name: 'Dritter Schrauber', price: 200, kind: 'upgrade', where: ['hafen'] },
      { id: 'bolzenwerfer', name: 'Bolzenwerfer (Heck)', price: 220, priceVaelen: 160, kind: 'upgrade' },   // M1: kein Start-Mount mehr
      { id: 'werkzeuggurt', name: 'Werkzeuggürtel', price: 120, kind: 'gear', where: ['hafen'] },
      { id: 'ersatzteil', name: 'Ersatzteil', price: 40, kind: 'item' },
      { id: 'loeschgel', name: 'Löschgel', price: 30, kind: 'item' },
      { id: 'flickblech', name: 'Flickblech', price: 30, kind: 'item' },
      { id: 'bolzen', name: 'Bolzen', price: 10, kind: 'item' },
      { id: 'medipack', name: 'Medipack', price: 30, kind: 'item' },
      { id: 'pflanze', name: 'Topfpflanze', price: 20, kind: 'deko' },
      { id: 'poster', name: 'Sternkarten-Poster', price: 25, kind: 'deko' },
      { id: 'lampe', name: 'Messinglampe', price: 30, kind: 'deko' },
      { id: 'teppich', name: 'Flickenteppich', price: 35, kind: 'deko' },
      // M1: neue Deko (where ohne Angabe = Hafen und Vaelen; priceVaelen ohne Angabe = price)
      { id: 'buecherregal', name: 'Bücherregal', price: 40, kind: 'deko' },
      { id: 'aquarium', name: 'Aquarium', price: 60, kind: 'deko', where: ['hafen'] },
      { id: 'sessel', name: 'Ohrensessel', price: 45, priceVaelen: 40, kind: 'deko' },
      { id: 'sternkarte', name: 'Gerahmte Sternkarte', price: 35, kind: 'deko' },
      { id: 'kristalllampe', name: 'Kristalllampe', price: 70, kind: 'deko', where: ['vaelen'] },
    ],

    // ---- Ergänzungen Team SERVER (nur hinzugefügt, nichts umbenannt) ----
    net: { snapEvery: 2, asteroidSnapEvery: 15, emptyResetAfter: 90 }, // Ticks je Snapshot; Asteroiden jeder 15. Snapshot; Reset ohne Spieler (s)
    flight: {
      lateralDrag: 2.2,        // Dämpfung der Querbewegung pro s (Vorwärtstempo bleibt erhalten = "ODA hält Kurs")
      reverseFactor: 0.3,      // Rückwärts max. 30 % von maxSpeed
      radius: 36,              // Schiffsradius für Asteroiden/Projektile
      projectileHitDist: 40,
      jumpMinStationDist: 300, // Sprung erst ab diesem Abstand zur Station
      dockDist: 70, dockSpeed: 25, // Andocken im Hafen (Stage port): so nah am Liegeplatz und so langsam
      arrivalSpeed: 0,
      asteroidImmunity: 1,
    },
    combat: {
      beamTtl: 0.25, bolzenTurnRate: 1.6, bolzenShotDelay: 0.8, bolzenTtl: 3,
      enemyShotSpeed: 210, enemyShotTtl: 4,
      // QA M3a: raiderOrbit 250 -> 320 – Jäger kreisen damit mit ~0,38 rad/s statt ~0,48 rad/s und bleiben unter dem
      // Drehtempo der Lerche (0,5 rad/s); die Steuer kann sie so in einer Breitseite halten (vorher praktisch unmöglich)
      raiderOrbit: 320, gunboatDist: 380, hitRadius: { raider: 16, gunboat: 32, relay: 14, sentinel: 26, pylon: 20 }, relayOrbit: 170, relayCount: 3,
      retreatTime: 30, retreatDist: 750, spawnDist: 900,
      gunboatBroadside: 10, gunboatCrossing: 40,  // s: Breitseite halten, dann quer vor dem Bug auf die andere Seite wechseln (max. s)
    },
    // Skalierung nach Crewgröße (verbundene Spieler): Feuerintervall-Faktor und Gegner-HP-Faktor
    // QA: zu dritt gab es mit 1/1 fünf Notfallprotokolle pro Durchlauf – entschärft
    // M1: mit Gegner-Schildsektoren solo milder (QA-Ziel: höchstens 1–2 Notfallprotokolle pro Abend)
    // QA M3a: zu dritt enemyFireInterval 1.5 -> 1.7 und enemyHp 0.85 -> 0.7 (Testgelände zu dritt hatte 5–6
    // Notfallprotokolle je Lauf; im Browser dauerten Kanonenboot-Wellen 80–150 s)
    crewScaling: { 1: { enemyFireInterval: 2.2, enemyHp: 0.5 }, 2: { enemyFireInterval: 1.7, enemyHp: 0.7 }, 3: { enemyFireInterval: 1.7, enemyHp: 0.7 } },
    emergency: { hull: 30, marksCost: 50 },
    // Softlock-Schutz: ein System bleibt nie dauerhaft broken / ein Leck nie dauerhaft offen.
    // Liegt kein passendes Teil mehr im Lager (und trägt keiner eins), repariert ODA nach dieser Zeit notdürftig.
    emergencyRepair: { brokenDelay: 45, breachDelay: 30 },
    mission: {
      combatFireBy: 40, gunboatAfter: 50, bribeShieldBreakAt: 25, gunboatBreachAt: 0.5,
      grauzahnRadioX: 1500, scanHoldTimeout: 0.4, softlockWarn: 240,
      rearguardAfter: 6, rearguardCount: { 1: 1, 2: 2, 3: 2 },
      // Notruf auf dem Rückweg (optional): Vaelen-Händlerin längsseits anfliegen
      vaelen: { dist: 650, helpDist: 90, helpSpeed: 25, marks: 40, deko: 'lampe' },   // Rückweg: Nachhut der Rostmeute (s nach Stage-Beginn, Anzahl Jäger)
    },
    awayExtra: { npcSpeed: 96, npcFollowDist: 40, droneStopDist: 80, dronePatrolRadius: 96, blasterTtl: 1.2, droneShotTtl: 2,
      hitRadiusDrone: 12, hitRadiusPlayer: 12, rescueRange: 64, alarmTime: 10,
      rebootTime: 5, rebootReward: 40, npcKitRange: 48, guardSpawns: [{ x: 12, y: 10 }, { x: 17, y: 3 }] }, // Bojenkern-Neustart weckt Wächter-Drohnen
    // Hafen-Übung (Stage dock): Kabelbrand + zerstörtes System; Funkspruch spätestens nach timeout s
    drill: { fire: { x: 25, y: 2 }, breach: { x: 29, y: 4 }, system: 'transfer', timeout: 150 },
    weaponPowerFactor: [null, 1.6, 1, 0.8, 0.65], // Ladezeit-Faktor je Energie-Stufe (null = lädt nicht)
    enginePowerFactor: [0, 0.5, 0.8, 1, 1.15],
    stateFactor: { engines: { damaged: 0.5, broken: 0 }, weapons: { damaged: 1.5 } },   // M3a: Triebwerk zerstört = kein Schub
    shieldsDamagedInterval: 8,

    // ================= M1 (Team SERVER) =================
    // Gegner-Schildsektoren [bug, steuerbord, heck, backbord] und Waffen (Feuerbögen relativ zum Gegner-Bug, Grad)
    enemyShields: { raider: [2, 1, 0, 1], gunboat: [2, 4, 1, 4], sentinel: [3, 3, 3, 3], pylon: [4, 0, 0, 0], relay: [0, 0, 0, 0] },
    enemyShieldRegen: 5,   // s je Punkt und Sektor
    enemyWeapons: {
      raider: [{ facing: 0, arc: 40, range: 400 }],
      gunboat: [{ facing: 90, arc: 90, range: 500 }, { facing: -90, arc: 90, range: 500 }],
      sentinel: [{ facing: 0, arc: 360, range: 330 }],
      pylon: [{ facing: 0, arc: 60, range: 460 }],
      relay: [],
    },
    sensors: { range: 1400, fogFactor: 0.5 },
    tscan: { range: 800, time: 2, holdTimeout: 0.5 },          // Ziel-Scan der Taktik (S halten)
    widescan: { cooldown: 20, radius: 1000 },                  // Weitscan (W)
    emp: { offlineTime: 12 },                                  // EMP-Treffer durch die Schilde: System offline
    reactorM1: { overloadBonus: 4, overloadTime: 180, warnAt: 30, offlineOutput: 2, restartTime: 3, botAssistAfter: 3, autoRestartAfter: 240 },
    quarters: {
      floors: ['holz_hell', 'holz_dunkel', 'teppich_rot', 'teppich_blau', 'fliesen'],
      walls: ['holz', 'paneel', 'tapete_gruen', 'tapete_creme'],
      lights: ['warm', 'mint', 'bernstein', 'aus'],
      defaults: { q0: { floor: 'holz_hell', wall: 'holz', light: 'warm' }, q1: { floor: 'holz_dunkel', wall: 'paneel', light: 'warm' },
        q2: { floor: 'teppich_blau', wall: 'tapete_creme', light: 'warm' }, q3: { floor: 'teppich_rot', wall: 'tapete_gruen', light: 'bernstein' } },
    },
    deko: ['pflanze', 'poster', 'lampe', 'teppich', 'buecherregal', 'aquarium', 'sessel', 'sternkarte', 'trophaee_boje', 'kristalllampe', 'lamassu_figur'],   // M2: lamassu_figur (Wächter-Belohnung)
    plan: { maxSeated: 3, maxPins: 5, labels: ['ziel', 'gefahr', 'landeplatz', 'treffpunkt', 'frage'] },
    travel: { jumpMinStationDist: 300, dockDist: 80, dockSpeed: 28 },
    discovery: { firstVisitMarks: 20, cachePickupDist: 70 },
    // Wrack-Außenmission
    wreckAway: { salvageTime: 2, hollowTime: 4, scavenger: { hp: 5 },
      rewards: [{ marks: 35, items: { ersatzteil: 1 } }, { marks: 35, items: { flickblech: 1 } }, { marks: 50, deko: ['sessel'] }],
      hollowReward: { marks: 60, deko: ['aquarium'], items: { ersatzteil: 1 } }, loreReward: { marks: 20 } },
    missionM1: { rearguardAfter: 6, ambushAfter: 4, beaconHintAt: 70, beaconAutoAt: 160, relayCoreScanTime: 6, relayCoreRange: 460, wreckRumorAfter: 8, m2OfferAfter: 14 },

    // ================= M2 „Schildwall“ (Team SERVER, CONTRACT-M2 §4) =================
    // Kampf v2 nur auf Außenkarten mit combat: 'v2' (zunächst Mond Kesh). Alle Zahlen per Debug `tune <pfad> <wert>` live änderbar.
    awayCombat: {
      shield: { segments: 3, regenDelay: 4, regenStep: 1.2 },          // Spieler
      wounded: { bleedout: 45, reviveTime: 4, reviveSegments: 1, medkitReviveTime: 1.5, medkitSegments: 2,
        pistolCooldown: 0.7, squadRecallDelay: 5, recallBeamLock: 20 },
      blaster: { cooldown: 0.3, speed: 380, ttl: 1.1 },                 // 1 Treffer = 1 Segment
      halfCoverBlock: 0.6,                                              // Chance, dass halbe Deckung einen Schuss schluckt
      enemy: {
        // QA M2 (Balancing für Menschen): segments 2 -> 3, fireInterval 1.6 -> 1.3
        scavenger: { segments: 3, regenDelay: 4, regenStep: 1.5, speed: 70, aim: 0.8, fireInterval: 1.3, shotSpeed: 230, spreadDeg: 4 },
        warden: { segments: 6, regenDelay: 6, regenStep: 2, speed: 32, turnRate: 70, frontArc: 120, aim: 1.4, fireInterval: 2.6,
          shotSpeed: 260, shotSegments: 2 },
      },
      engageBox: { w: 600, h: 330 },     // Gegner schießen nur, wenn das Ziel in diesem Rechteck um den Gegner liegt (≈ Bildschirm)
      sightTiles: 10,                     // Sichtradius des Außenteams (Fog of War) und der Gegner
      aiHz: 5, barkCooldown: 4, ghostTime: 3,
      scanQualityJammed: 0.35,            // Captain-Scan, solange ein Störrelais an ist
      jammerTime: 2.5, archkeyTime: 3, archkeyWindow: 1.5, tabletTime: 3,
      archkeySoloWindow: 15,              // QA M2: nur 1 Spieler verbunden -> so lange bleibt der erste Schlüssel gedreht
      squadScale: { 1: 0.5, 2: 0.75, 3: 1 },   // Anteil der Spawns je Anzahl verbundener Spieler (aufgerundet, min. 1)
      orders: { max: 3, ttl: 30, focusTime: 8 },
      rewards: { complete: 120, warden: 60, jammer: 10 },
      // M2 §15 Ducken (Taste C): Tempo-Faktor, Ausweichchance je Treffer, Plünderer ducken sich im Rückzug (tune crouch.enemyCrouch on|off)
      crouch: { speedFactor: 0.5, dodge: 0.2, enemyCrouch: true },
      // ---- Ergänzungen SERVER (nicht im Vertragsblock, ebenfalls per tune änderbar) ----
      barksOn: true,                      // tune barks off|on (A/B-Vergleich)
      shotTtl: 1.6,                       // Lebensdauer gegnerischer Schüsse (s)
      hitRadius: { player: 12, scavenger: 13, warden: 22 },
      strikeSegments: 4,                  // Orbitalschlag: so viele Segmente (ignoriert Wächter-Front)
      kuppelPerHit: 10,                   // Schildkuppel: kuppelHp je abgefangenem Treffer
      flankMaxTime: 8, retreatHoldMax: 12, stuckReplan: 4, lostAfter: 4, lastKnownTtl: 25,
      wardenLeash: 5,                     // Wächter entfernt sich höchstens so viele Kacheln von seinem Platz
      warden90s: 90,                      // Schritt warden: spätestens nach so vielen s weiter zu extract
      barks: {
        contact: ['Kontakt! Da drüben!', 'Da sind sie!', 'Besuch! Waffen hoch!'],
        flankLeft: ['Halt sie unten – ich geh links rum!', 'Deckt mich, ich nehm die linke Seite!'],
        flankRight: ['Halt sie unten – ich geh rechts rum!', 'Deckt mich, ich nehm die rechte Seite!'],
        retreat: ['Mein Schild ist weg, ich zieh mich zurück!', 'Schild runter – ich brauch Deckung!', 'Zu heiß hier, ich geh zurück!'],
        shieldUp: ['Schild steht wieder!', 'Schild voll, ich bin wieder dabei!'],
        playerDown: ['Einer liegt! Drauf!', 'Der ist am Boden – nachsetzen!'],
        lost: ['Wo sind die hin?', 'Hab sie verloren …', 'Augen auf, die sind irgendwo!'],
        half: ['Rückzug zur zweiten Linie!', 'Wir sind nur noch die Hälfte – zurück!'],
      },
    },
    // Mission 3 „Die Tafel von Kesh“ (Zeiten in s)
    missionM3: { offerAfter: 20, offerDirectAt: 2, wardenStepMax: 90, hallX: 37, courtyardX: 27 },

    // Testgelände (Lobby-Start 'arena_space' / 'arena_away'): Einstieg direkt in den Kampf, solo wie zu dritt.
    // Raumkampf: Szene ohne Brocken, Wellen zyklisch (nach der letzten wieder von vorn, Runde zählt hoch).
    arena: {
      spaceScene: 'b7', shipPos: { x: 1100, y: 1500, angle: 0 },
      firstWaveAt: 6,          // s nach Start bis Welle 1
      nextWaveDelay: 12,       // s nach Räumung bis zur nächsten Welle
      spawnSpread: 0.7,        // rad zwischen den Gegnern einer Welle (Anflug von vorn)
      waves: [['raider', 'raider'], ['raider', 'gunboat'], ['sentinel', 'raider', 'raider'],
        ['gunboat', 'raider'], ['pylon', 'gunboat']],   // M3a §15: Wellen 4 und 5
      pylonAt: { dx: 120, dy: -430 },   // M3a: Pylon fest relativ zu shipPos (im Backbord-Bogen der Startlage)
      keshShipOffset: 260,     // Kesh: Abstand des Schiffs vom Mond (Transferreichweite 360)
    },

    // ================= M3a „Breitseite & Schaden“ (Studioleitung, CONTRACT-M3 §10) – alles per `tune spaceM3.<pfad>` =================
    spaceM3: {
      enemyHpFactor: 0.8, reactorBrokenOutput: 2, centreChance: 0.15, sectorWeight: 3, neighbourWeight: 1,
      turnCap: { ok: 1, damaged: 0.5, broken: 0.15 }, emitterCap: { ok: 1, damaged: 0.5, broken: 0 }, generatorDamagedPool: -2,
      mounts: {
        bow: { facing: 0, arc: 16, range: 650, damage: 8, pierce: 2, secPerPoint: 24, damagedFactor: 1.5 },
        port: { facing: -90, arc: 70, range: 520, damage: 1.5, tubes: 4, tubesDamaged: 2, tubesUpgrade: 5, secPerPoint: 16, salvoGap: 0.15 },
        stbd: { facing: 90, arc: 70, range: 520, damage: 1.5, tubes: 4, tubesDamaged: 2, tubesUpgrade: 5, secPerPoint: 16, salvoGap: 0.15 },
      },
      allocMax: 4, allocDefault: { bow: 2, port: 1, stbd: 1 }, autoFactor: 0.5,
      aimTime: 1.5, aimTolerance: 5, aimAbortCharge: 0.7,
      // QA M3a: gunboat.damage 4 -> 3 (ein voller Treffer kostete 20 Hülle, jetzt 15)
      tele: { gunboat: { dur: 3, damage: 3 }, pylon: { dur: 2, damage: 3 }, sentinel: { dur: 2.5, emp: true },
        delayPerHit: 1, delayMax: 2, captainSeesLast: 1.2, odaCooldown: 4 },
      burst: { duration: 1.5, perfect: 0.5, absorb: 5, absorbDamaged: 2, cooldown: 8 },
      repair: { flickTime: 1.5, partTime: 3, minigameMinTime: 2.5, queueMax: 3, odaCooldown: 3 },
      // ---- Ergänzung SERVER-COMBAT ----
      raiderFlip: 9,   // s: Jäger wechseln die Kreisrichtung (sonst parken sie im toten Winkel achtern); 0 = aus
    },
    // Raumszenen (px im Taktik-Koordinatensystem) – M0-Stand; seit M1 kommen die Szenen aus shared/locations.js
    scenes: {
      port: { w: 2000, h: 1400, start: { x: 700, y: 700, angle: 0 }, station: { x: 520, y: 700 }, arrival: { x: 1650, y: 860, angle: 3.3 } },
      route: { w: 3000, h: 1600, start: { x: 150, y: 800, angle: 0 }, exit: { x: 2850, y: 800, r: 140 } },
      buoy: { w: 3000, h: 3000, start: { x: 500, y: 1500, angle: 0 }, buoy: { x: 2000, y: 1500 }, scanRange: 420, beamRange: 320, scanTime: 5 },
    },
  };
});
