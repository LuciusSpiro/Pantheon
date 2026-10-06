// Nachrichtenprotokoll (CONTRACT.md §5). UMD: window.Shared_Protocol / require.
// Alle Nachrichten sind JSON-Objekte mit Typfeld `t`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Protocol = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    VERSION: 2,   // M1
    WS_PATH: '/ws',
    // Client -> Server
    C: {
      HELLO: 'hello', READY: 'ready', INPUT: 'input', ACT: 'act', SHOOT: 'shoot', MARK: 'mark',
      DROP: 'drop', LEAVE: 'leave', CMD: 'cmd', PING: 'ping', DEBUG: 'debug',
      LOBBY_OPT: 'lobbyOpt',   // M0: { skipDrill: bool } – nur in der Lobby, jeder darf umschalten; M2: { startMission: START_MISSIONS }
    },
    // Server -> Client
    S: { WELCOME: 'welcome', SNAP: 'snap', EVENT: 'event', PONG: 'pong', FULL: 'full', ERROR: 'error' },
    // Fehlercodes in { t: 'error', code, text }
    ERR: { BADCODE: 'badcode' },
    // 'quartier' öffnet sich an der eigenen Koje, 'sonde' an der Kustoden-Sonde (Außenmission).
    CONSOLES: ['helm', 'captain', 'weapons', 'transfer', 'shop', 'quartier', 'sonde', 'plan'],   // M1: 'plan' (Planungstisch, nicht exklusiv; 'weapons' = Anzeige „TAKTIK“)
    SYSTEMS: ['reactor', 'engines', 'shields', 'weapons', 'life', 'transfer'],
    POWER_SYSTEMS: ['engines', 'shields', 'weapons', 'life'],
    // M1: Systemzustände ('offline' = EMP, zählt wie broken, startet nach CONFIG.emp.offlineTime selbst neu)
    SYSTEM_STATES: ['ok', 'damaged', 'broken', 'offline'],
    REACTOR_STATES: ['online', 'overload', 'offline'],
    MOUNTS: ['phase_l', 'phase_r', 'bolzen', 'seitenturm'],
    ENEMY_KINDS: ['raider', 'gunboat', 'relay', 'sentinel', 'pylon'],
    HIDDEN_KINDS: ['cache', 'beacon', 'lore', 'hollow'],
    PIN_LABELS: ['ziel', 'gefahr', 'landeplatz', 'treffpunkt', 'frage'],
    // M2: tune { path, value } | { args: 'pfad wert' }, kesh, squad { which: '1'|'2'|'rear' }, wake, shield { n }, wound
    DEBUG_CMDS: ['stage', 'damage', 'fire', 'breach', 'spawn', 'marks', 'inv', 'hull', 'skip', 'god', 'goto', 'reveal', 'mission', 'reactor', 'scanall',
      'tune', 'kesh', 'squad', 'wake', 'shield', 'wound'],
    SECTORS: ['bug', 'steuerbord', 'heck', 'backbord'],
    ITEMS: ['ersatzteil', 'loeschgel', 'flickblech', 'bolzen', 'medipack', 'datenkern', 'tafel'],   // M2: 'tafel' (kein Regal, direkt ins Inventar)
    // M2 „Schildwall“ (CONTRACT-M2 §6/§7)
    // lobbyOpt { startMission }: Kampagne, Direktstart Planetenmission, Testgelände Raumkampf / Außenteam (Reihenfolge = Umschalter M)
    START_MISSIONS: ['m1', 'm3', 'arena_space', 'arena_away'],
    START_LABELS: { m1: 'Kampagne', m3: 'Direkt zur Planetenmission', arena_space: 'Testgelände: Raumkampf', arena_away: 'Testgelände: Außenteam' },
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
