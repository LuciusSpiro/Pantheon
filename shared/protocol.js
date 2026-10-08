// Nachrichtenprotokoll (CONTRACT.md §5). UMD: window.Shared_Protocol / require.
// Alle Nachrichten sind JSON-Objekte mit Typfeld `t`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Protocol = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    VERSION: 6,   // S2 „Spielleiter an der Missionsgrenze“ (5 = S1 „Regiebuch & Weltstand“, 4 = M4 Stufe 1 „Zwei Decks“)
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
    CMD_PLAN_DECLINE: 'plan.decline',
    CMD_CAPTAIN_ESCORT: 'captain.escort',
    ESCORT_ORDERS: ['halten', 'folgen', 'volle_kraft', 'andocken'],
    ESCORT_STATES: ['ok', 'beschaedigt', 'kampfunfaehig', 'entkommen'],
    ESCORT_KINDS: ['frachter', 'karawane', 'bergungsboot'],
    ESCORT_FIELDS: ['id', 'tag', 'kind', 'name', 'x', 'y', 'angle', 'hp', 'hpMax', 'state', 'befehl', 'distress'],
    PLANNING_STAGES: [0, 1, 2],
    OFFER_FIELDS: ['von', 'ziel', 'dauer_min', 'belohnung', 'erinnerung'],
    OFFER_ORIGINS: ['sl', 'archiv'],
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
    // Snapshot players[i].deck: 0 Systemdeck / 1 Privatdeck (nur zone 'ship', aus y abgeleitet; Komfort für den Client)
    //          players[i].lift: { to: 0|1, t, T } während der Liftfahrt (Eingaben gesperrt, kein Schaden, x/y bleiben stehen,
    //                           Teleport bei t >= T; Client: keine Bewegungsvorhersage, solange lift gesetzt ist)
    //          players[i].ladder: { t, T } solange E an der Notleiter gehalten wird (zusätzlich action { kind: 'ladder', progress })
    //          bots[i].lift: { to, t, T } während ein Bot Lift fährt
    // Ereignis lift { pid | bot, deck, phase: 'start'|'arrive', T? (nur start), via?: 'ladder' (nur Leiter, nur arrive) }
    // Interaktion: auf ^ stehen + E tippen = Lift; an ! E halten (CONFIG.lift.ladderTime) = Leiter.
    DECK_FIELDS: ['deck', 'lift', 'ladder'],
    LIFT_PHASES: ['start', 'arrive'],
    WS_PATH: '/ws',
    // Client -> Server
    C: {
      HELLO: 'hello', READY: 'ready', INPUT: 'input', ACT: 'act', SHOOT: 'shoot', MARK: 'mark',
      DROP: 'drop', LEAVE: 'leave', CMD: 'cmd', PING: 'ping', DEBUG: 'debug',
      LOBBY_OPT: 'lobbyOpt',   // M0: { skipDrill: bool } – nur in der Lobby, jeder darf umschalten; M2: { startMission: START_MISSIONS }; S1: { world }
      WORLD: 'world',          // S1: { op: 'delete', id }
      MENU: 'menu',            // S1: { op: 'end' } | { op: 'pause', on }
    },
    // Server -> Client
    S: { WELCOME: 'welcome', SNAP: 'snap', EVENT: 'event', PONG: 'pong', FULL: 'full', ERROR: 'error' },
    // Fehlercodes in { t: 'error', code, text }
    ERR: { BADCODE: 'badcode', WORLDBUSY: 'worldbusy' },
    // 'quartier' öffnet sich an der eigenen Koje, 'sonde' an der Kustoden-Sonde (Außenmission).
    CONSOLES: ['helm', 'captain', 'weapons', 'transfer', 'shop', 'quartier', 'sonde', 'plan'],   // M1: 'plan' (Planungstisch, nicht exklusiv; 'weapons' = Anzeige „TAKTIK“)
    // M3a: 'weapons' ist Altname (schlechtester Zustand der drei Waffen, keine Station). CONTRACT-M3 §4.1
    SYSTEMS: ['reactor', 'engines', 'shields', 'weapons', 'life', 'transfer',
      'thruster_port', 'thruster_stbd', 'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port', 'weapon_bow', 'battery_port', 'battery_stbd'],
    POWER_SYSTEMS: ['engines', 'shields', 'weapons', 'life'],
    // M1: Systemzustände ('offline' = EMP, zählt wie broken, startet nach CONFIG.emp.offlineTime selbst neu)
    SYSTEM_STATES: ['ok', 'damaged', 'broken', 'offline'],
    REACTOR_STATES: ['online', 'overload', 'offline'],
    MOUNTS: ['bow', 'port', 'stbd', 'bolzen', 'phase_l', 'phase_r', 'seitenturm'],   // M3a: bow/port/stbd; phase_* = Altnamen
    REPAIR_MODES: ['flick', 'part'],
    BEAM_KINDS: ['phase', 'lance', 'battery', 'enemy_heavy', 'bolzen'],
    SIDES: ['bow', 'stbd', 'aft', 'port', 'mid'],
    CMD_REPAIR: ['repair.start', 'repair.done', 'repair.cancel'],   // M3a: ohne Konsole, nur Zone ship
    // M3a §20.3: Lanze als Ladewaffe. cmd { c: 'weapons.charge', mount: 'bow', on: bool } (Taktik) – on:true lädt auf,
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
    ENEMY_KINDS: ['raider', 'gunboat', 'relay', 'sentinel', 'pylon'],
    HIDDEN_KINDS: ['cache', 'beacon', 'lore', 'hollow'],
    PIN_LABELS: ['ziel', 'gefahr', 'landeplatz', 'treffpunkt', 'frage'],
    // M2: tune { path, value } | { args: 'pfad wert' }, kesh, squad { which: '1'|'2'|'rear' }, wake, shield { n }, wound
    DEBUG_CMDS: ['stage', 'damage', 'fire', 'breach', 'spawn', 'marks', 'inv', 'hull', 'skip', 'god', 'goto', 'reveal', 'mission', 'reactor', 'scanall',
      'tune', 'kesh', 'squad', 'wake', 'shield', 'wound', 'tele', 'fragile', 'sl', 'escort'],   // M3a: tele [id], fragile {system}; M3b: 'burst' entfallen; S2: sl, escort
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
    // enemies[].vx/vy/state (§3), stats.leakHits/escalations/repairSetbacks/overflowHull/reactorAutoStarts.
    DAMAGE_EVENTS: ['escalated', 'repairSetback'],
    ENEMY_STATES: ['approach', 'overshoot', 'turn', 'station', 'retreat'],
    SECTORS: ['bug', 'steuerbord', 'heck', 'backbord'],
    ITEMS: ['ersatzteil', 'loeschgel', 'flickblech', 'bolzen', 'medipack', 'datenkern', 'tafel'],   // M2: 'tafel' (kein Regal, direkt ins Inventar)
    // M2 „Schildwall“ (CONTRACT-M2 §6/§7)
    // lobbyOpt { startMission }: Kampagne, Direktstart Planetenmission, Testgelände Raumkampf / Außenteam (Reihenfolge = Umschalter M)
    // S1: 'free' = Kampagne ohne Tutorial. Weltstand nur für m1/free; m3 und arena_* legen nie einen an.
    START_MISSIONS: ['m1', 'free', 'm3', 'arena_space', 'arena_away'],
    START_LABELS: { m1: 'Kampagne', free: 'Kampagne ohne Tutorial', m3: 'Direkt zur Planetenmission', arena_space: 'Testgelände: Raumkampf', arena_away: 'Testgelände: Außenteam' },
    CAMPAIGN_STARTS: ['m1', 'free'],
    ORDER_KINDS: ['sammeln', 'halten', 'flanke', 'rueckzug', 'fokus', 'gefahr'],   // cmd captain.order { kind, x, y, target?, clear? }
    CMD_CROUCH: 'crouch',   // M2 §15: cmd { c: 'crouch', on: bool } – ohne Konsole, nur Außenzone auf v2-Karten; Snapshot players[].cr, away.drones[].cr
    AWAY_ENEMY_KINDS: ['drone', 'scavenger', 'warden'],
    AWAY_ROLES: ['idle', 'pin', 'flank', 'retreat', 'push', 'advance'],
    AWAY_PROJECTILES: ['blaster', 'drone', 'pistol', 'enemy', 'warden'],
    CODE_SYMBOLS: ['kreis', 'dreieck', 'raute', 'stern', 'welle', 'kreuz'],
    CODE_COLORS: ['mint', 'bernstein', 'rot', 'blau', 'pink', 'weiss'],
    CODE_COLOR_HEX: { mint: '#7FE0C2', bernstein: '#FFC66B', rot: '#E0473C', blau: '#56B4E9', pink: '#CC79A7', weiss: '#F4EEDC' },
    PLAYER_COLORS: ['#56B4E9', '#E69F00', '#CC79A7'],
    PLAYER_SHAPES: ['circle', 'triangle', 'diamond'],
  };
});
