// Client-Bootstrap (CONTRACT.md §3, §5, §9). Globales `Client`.
// 60-Hz-Loop mit Akkumulator, Eingabe, Zustandsverwaltung, Vorhersage der eigenen Figur
// (Shared_Physics.moveWithCollision + Abgleich über lastSeq), Interpolation fremder Entitäten
// (100 ms), Audio-Auslösung, window.__game, ?debug=1-Overlay.
(function () {
  'use strict';

  const CFG = window.Shared_Config || {};
  const Maps = window.Shared_Maps;
  const Phys = window.Shared_Physics;
  const P = window.Shared_Protocol || { C: {}, S: {} };
  const R = window.Render, H = window.Hud, K = window.Consoles;
  const G = window.__game;
  const TILE = 32, VW = 640, VH = 360, STEP = 1 / 60;
  const INTERP_DELAY = 100;     // ms
  const HITBOX = (CFG.player && CFG.player.hitbox) || { w: 18, h: 12 };
  const SPEED = (CFG.player && CFG.player.speed) || 96;
  const params = Net.params;
  const DEBUG = params.get('debug') === '1';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const nameInput = document.getElementById('lobbyName');
  const codeInput = document.getElementById('lobbyCode');   // M0: Raumcode-Eingabe nach badcode
  const world3d = document.getElementById('world3d');      // M4: Voxel-Welt (voxel/boot.js)

  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, f) { return a + (b - a) * f; }
  function lerpAngle(a, b, f) { return a + Phys.normAngle(b - a) * f; }

  const storedColor = lsGet('sternenschicht.color', null);
  const Client = {
    state: null, pid: null, serverDebug: false,
    snaps: [],
    self: { x: 0, y: 0, zone: 'ship', dir: 'down', moving: false, offX: 0, offY: 0, init: false },
    pending: [], seq: 0, lastSent: { mx: 0, my: 0 }, sendAcc: 0,
    keys: {}, actDown: false,
    mouse: { x: -1, y: -1 },
    time: 0, fps: 0, scale: 1,
    audioOn: false,
    lobby: { name: lsGet('sternenschicht.name', 'Crew-' + Math.floor(100 + Math.random() * 900)).slice(0, 12), color: storedColor == null || storedColor === '' ? null : +storedColor },
    endDismissed: false,
    beamFx: {}, enemyHit: {}, shipHit: null, flashT: -9,
    shieldHit: {},   // M2: pid -> performance.now() des letzten Schildtreffers
    teleSeen: {},   // M3a
    setbacks: [],   // M3b §4: repairSetback-Ereignisse { system, pid, bot, t0 } für den Rückschritt im Fortschrittsbalken
    minigame: null,                // M3a §8.1: Reparatur-Minispiel (lokal)
    shootCd: 0, stepT: 0, repairTickT: 0,
    view: null,
  };

  // ------------------------------------------------------------------ Audio (alles optional)
  const audio = {
    last: {}, loops: {}, mood: null, intensity: -1,
    has() { return Client.audioOn && window.GameAudio; },
    play(name, opts) {
      if (!this.has()) return;
      const now = performance.now();
      if (this.last[name] && now - this.last[name] < 70) return;
      this.last[name] = now;
      Net.guard('GameAudio.play', () => GameAudio.play(name, opts || {}));
    },
    loop(name, on, volume) {
      if (!this.has()) return;
      const cur = this.loops[name];
      volume = Math.round((volume == null ? 1 : volume) * 20) / 20;
      if (cur && cur.on === on && (!on || cur.volume === volume)) return;
      this.loops[name] = { on, volume };
      Net.guard('GameAudio.setLoop', () => GameAudio.setLoop(name, on, { volume }));
    },
    music(mood, intensity) {
      if (!this.has()) return;
      if (mood !== this.mood) { this.mood = mood; Net.guard('GameAudio.setMusic', () => GameAudio.setMusic(mood)); }
      if (intensity != null && Math.abs(intensity - this.intensity) > 0.05) { this.intensity = intensity; Net.guard('GameAudio.setIntensity', () => GameAudio.setIntensity(intensity)); }
    },
    panFor(x, zone) {
      if (x == null) return 0;
      if (zone && zone !== Client.self.zone) return 0;
      return clamp((x - R.camera.x - VW / 2) / (VW / 2), -1, 1);
    },
  };
  function initAudio() {
    if (Client.audioOn) return;
    if (!window.GameAudio) return;
    Net.guard('GameAudio.init', () => GameAudio.init());
    Client.audioOn = true;
    audio.mood = null;
  }

  // ------------------------------------------------------------------ Hilfen
  function me() { const s = Client.state; return s && s.players ? s.players.find(p => p.id === Client.pid) || null : null; }
  function send(msg) { return Net.send(msg); }
  G.send = send;

  function isSolidFor(zone, st) {
    const map = R.mapFor(zone, st);
    if (zone === 'away' && map.id === 'kesh') return R.solidFn(map, st);   // M2: Tor offen = begehbar, low-Kacheln solid
    const away = (st && st.away) || {};
    const open = !!(away.doorOpen || (away.sonde && away.sonde.disabled));
    const wreck = map.id === 'wreck';
    const hv = away.hollow;
    const ht = wreck && hv && hv.open ? R.toTileXY(map, hv.x, hv.y) : null;
    return (tx, ty) => {
      const ch = map.at(tx, ty);
      if (zone === 'away' && map.id === 'platform' && ch === 'L') return !open;
      if (ht && ch === 'V' && ht.x === tx && ht.y === ty) return false;   // M1: aufgebrochener Hohlraum
      return map.solid(tx, ty);
    };
  }

  // ------------------------------------------------------------------ Layout / Skalierung
  function layout() {
    const W = window.innerWidth, Hh = window.innerHeight;
    const s = Math.min(W / VW, Hh / VH);
    const si = Math.floor(s);
    const scale = si >= 1 && si >= 0.8 * s ? si : s;
    const cw = Math.floor(VW * scale), ch = Math.floor(VH * scale);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    canvas.style.left = Math.floor((W - cw) / 2) + 'px'; canvas.style.top = Math.floor((Hh - ch) / 2) + 'px';
    if (world3d) { world3d.style.width = canvas.style.width; world3d.style.height = canvas.style.height; world3d.style.left = canvas.style.left; world3d.style.top = canvas.style.top; }   // M4: 3D-Welt in derselben CSS-Box
    Client.scale = scale;
    const r = H.LOBBY_NAME_RECT;
    nameInput.style.left = Math.floor((W - cw) / 2 + r.x * scale) + 'px';
    nameInput.style.top = Math.floor((Hh - ch) / 2 + r.y * scale) + 'px';
    nameInput.style.width = Math.floor(r.w * scale) + 'px';
    nameInput.style.height = Math.floor(r.h * scale) + 'px';
    nameInput.style.fontSize = Math.max(10, Math.floor(10 * scale)) + 'px';
    if (codeInput && H.LOBBY_CODE_RECT) {
      const q = H.LOBBY_CODE_RECT;
      codeInput.style.left = Math.floor((W - cw) / 2 + q.x * scale) + 'px';
      codeInput.style.top = Math.floor((Hh - ch) / 2 + q.y * scale) + 'px';
      codeInput.style.width = Math.floor(q.w * scale) + 'px';
      codeInput.style.height = Math.floor(q.h * scale) + 'px';
      codeInput.style.fontSize = Math.max(12, Math.floor(13 * scale)) + 'px';
    }
  }
  window.addEventListener('resize', layout);

  // ------------------------------------------------------------------ Lobby-Aktionen
  let helloTimer = null;
  const actions = {
    setColor(c) {
      Client.lobby.color = c; lsSet('sternenschicht.color', String(c));
      Net.sendHello();
    },
    toggleReady() {
      const m = me();
      if (!m) return;
      send({ t: P.C.READY || 'ready', ready: !m.ready });
      audio.play('ui_click');
    },
    dismissEnd() { Client.endDismissed = true; audio.play('ui_back'); },
    // M0: Hafen-Übung überspringen (jeder darf umschalten, Server hält den Zustand)
    toggleSkipDrill() {
      const st = Client.state;
      const cur = !!(st && st.lobby && st.lobby.skipDrill);
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', skipDrill: !cur });
      audio.play('ui_click');
    },
    // M2: Start „Kampagne“ (m1), „Direkt zur Planetenmission“ (m3) oder Testgelände (arena_space/arena_away) –
    // jeder darf umschalten, M schaltet reihum weiter
    toggleStartMission() {
      const st = Client.state;
      const cur = (st && st.lobby && st.lobby.startMission) || 'm1';
      const list = (P.START_MISSIONS && P.START_MISSIONS.length) ? P.START_MISSIONS : ['m1', 'm3'];
      const next = list[(list.indexOf(cur) + 1) % list.length];
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', startMission: next });
      audio.play('ui_click');
    },
    // M0: Einladungslink (Origin + ?code=) in die Zwischenablage
    copyInvite() {
      const link = Net.inviteLink();
      const done = (ok) => {
        Client.inviteCopiedT = ok ? performance.now() : 0;
        H.pushNotice(ok ? 'Einladungslink kopiert: ' + link : 'Kopieren ging nicht – Link: ' + link, ok ? R.PAL.mint : R.PAL.warn);
      };
      const legacy = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          done(!!ok);
        } catch (e) { Net.reportError('copyInvite', e); done(false); }
        canvas.focus();
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link).then(() => done(true), legacy);
      else legacy();
      audio.play('ui_click');
    },
    // M0: Raumcode aus dem Eingabefeld schicken
    submitCode() {
      const c = Net.normCode(codeInput ? codeInput.value : '');
      if (!c) { H.pushNotice('Bitte den Raumcode eintippen.', R.PAL.warn); return; }
      Net.badCode = false;
      Net.setRoomCode(c);
      audio.play('ui_click');
    },
    leave() { send({ t: P.C.LEAVE || 'leave' }); },
    sfx(name) { audio.play(name); },
  };
  nameInput.value = Client.lobby.name;
  lsSet('sternenschicht.name', Client.lobby.name);   // Standardname bleibt über Neuladen gleich
  nameInput.addEventListener('input', () => {
    Client.lobby.name = nameInput.value.slice(0, 12);
    lsSet('sternenschicht.name', Client.lobby.name);
    clearTimeout(helloTimer);
    helloTimer = setTimeout(() => { if (Client.lobby.name.trim()) Net.sendHello(); }, 500);
  });
  Net.getHello = () => ({ name: (Client.lobby.name || '').trim() || 'Crew', color: Client.lobby.color });
  if (codeInput) {
    codeInput.value = Net.roomCode || '';
    codeInput.addEventListener('input', () => { const v = Net.normCode(codeInput.value); if (v !== codeInput.value) codeInput.value = v; });
  }

  // ------------------------------------------------------------------ Nachrichten
  Net.onStatus = (s) => {
    if (s === 'open') { Client.self.init = false; Client.pending = []; Client.snaps = []; }
  };
  Net.onMessage = (msg) => {
    switch (msg.t) {
      case 'welcome':
        Client.pid = msg.pid; G.pid = msg.pid;
        Client.serverDebug = !!msg.debug;
        Client.self.init = false;
        break;
      case 'snap': onSnap(msg); break;
      case 'event': onEvent(msg); break;
      case 'error':
        if (msg.code === 'badcode') {
          // M0: Raumcode falsch/fehlt – zurück in die Lobby mit Eingabefeld (alter Zustand gehört nicht mehr uns)
          Client.state = null; G.state = null; Client.pid = null; G.pid = null; Client.snaps = [];
          if (codeInput) { codeInput.value = Net.roomCode || ''; Client.focusCode = true; }
          if (Net.roomCode) H.pushNotice(msg.text || 'Falscher Raumcode.', R.PAL.red);
          audio.play('error');
          break;
        }
        H.pushNotice(msg.text || 'Serverfehler', R.PAL.red); break;
      default: break;
    }
  };

  function onSnap(s) {
    const prev = Client.state;
    if (s.space && !s.space.asteroids) s.space.asteroids = (prev && prev.space && prev.space.asteroids) || [];
    if (!s.players) s.players = [];
    // M1: statische Ortsdaten kommen nur alle 15 Snapshots (oder bei Änderung) – letzte Liste behalten
    if (prev && prev.world) {
      if (!s.world) s.world = prev.world;
      else if (!s.world.locations) s.world = Object.assign({}, s.world, { locations: prev.world.locations });
    }
    // Logbuch kommt ebenfalls nur mit den Ortsdaten
    if (s.mission && !s.mission.log && prev && prev.mission && prev.mission.log) s.mission.log = prev.mission.log;
    // §21.2: Missionsbuch kommt nur bei Änderung (version) – sonst das letzte behalten
    if (s.mission && !s.mission.book && prev && prev.mission && prev.mission.book) s.mission.book = prev.mission.book;
    Client.state = s; G.state = s; R.lastState = s;
    const now = performance.now();
    Client.snaps.push({ t: now, s });
    while (Client.snaps.length > 3 && now - Client.snaps[1].t > 1000) Client.snaps.shift();
    if (Client.snaps.length > 40) Client.snaps.shift();
    if (prev && prev.phase !== 'end' && s.phase === 'end') Client.endDismissed = false;
    reconcile(s);
    Net.guard('Client.diff', () => diffState(prev, s));
  }

  function reconcile(s) {
    const m = me();
    const self = Client.self;
    if (!m) return;
    if (!self.init || m.zone !== self.zone || m.console || m.downed || m.lift || s.phase === 'lobby' || !isFinite(m.x)) {   // M4: während der Liftfahrt keine Vorhersage
      const jump = !self.init || m.zone !== self.zone;
      self.x = +m.x || 0; self.y = +m.y || 0; self.zone = m.zone || 'ship';
      if (!Client.lastSent.mx && !Client.lastSent.my) self.dir = m.dir || self.dir;
      if (jump) { self.offX = 0; self.offY = 0; }
      self.init = true;
      Client.pending = [];
      return;
    }
    const lastSeq = +m.lastSeq || 0;
    Client.pending = Client.pending.filter(p => p.seq > lastSeq);
    const solid = isSolidFor(m.zone, s);
    let x = +m.x, y = +m.y;
    for (const p of Client.pending) { const r = Phys.moveWithCollision(solid, x, y, p.dx, p.dy, HITBOX); x = r.x; y = r.y; }
    const dispX = self.x + self.offX, dispY = self.y + self.offY;
    if (Math.hypot(x - dispX, y - dispY) > 48) { self.offX = 0; self.offY = 0; }
    else { self.offX = dispX - x; self.offY = dispY - y; }
    self.x = x; self.y = y;
  }

  // M3a: Ton anhalten (AUDIO: GameAudio.stop(name, {key}) – optional)
  function stopSfx(name, key) {
    if (!audio.has() || typeof GameAudio.stop !== 'function') return;
    Net.guard('GameAudio.stop', () => GameAudio.stop(name, { key }));
  }
  // M3a „Breitseite“: Ladung, Zielphase, Schildstoß, Systemtreffer – kurze Hinweise (Ton kommt vom Server per sfx)
  function onEventM3(ev) {
    const PAL = R.PAL;
    const m = me();
    const con = m && m.console;
    const name = (s) => H.SYS_NAMES[s] || s;
    // tele: Der Server schickt { kind:'tele', id, sector, dur, tkind|enemy }. Liegt das Feld kind fälschlich auf 'shot'/'emp',
    // erkennen wir das Ereignis an id + sector + dur.
    const isTele = ev.kind === 'tele' || ((ev.kind === 'shot' || ev.kind === 'emp') && ev.id != null && ev.sector != null && ev.dur != null);
    if (isTele) { Client.teleSeen[ev.id] = performance.now(); return true; }
    switch (ev.kind) {
      case 'teleMiss':
        stopSfx('tele_charge', ev.id);
        // §20.2: dodged = Ausweichen im Fenster (sfx dodge_evade schickt der Server)
        if (ev.dodged) { Client.dodgeFx = { t0: performance.now() }; if (m && m.zone === 'ship') H.pushNotice('Ausgewichen! Der schwere Treffer geht vorbei.', PAL.mint); }
        else if (con === 'helm' || con === 'weapons') H.pushNotice('Ladung verfehlt – außer Bogen', PAL.mint);
        return true;
      case 'lance':
        // §20.3: Aufladen/Feuer der Lanze (Ton per sfx vom Server)
        if (ev.state === 'fizzle') { stopSfx('lance_charge', 'lance'); if (con === 'weapons' || con === 'helm') H.pushNotice('Lanze verpufft' + (ev.why === 'system' ? ' – System ausgefallen' : ''), PAL.warn); }
        else if (ev.state === 'fire') { stopSfx('lance_charge', 'lance'); if (con === 'weapons' && !ev.hit) H.pushNotice('Lanze ins Leere – Bug aufs Ziel!', PAL.warn); }
        else if (ev.state === 'charge' && con === 'helm') H.pushNotice('LANZE LÄDT – Bug aufs Ziel!', R.BURST_COL);
        return true;
      case 'aim':
        if (ev.state === 'abort' && (con === 'helm' || con === 'weapons')) H.pushNotice('Zielphase abgebrochen – Kurs nicht gehalten', PAL.warn);
        else if (ev.state === 'miss' && (con === 'helm' || con === 'weapons')) H.pushNotice('Lanze verfehlt – Ziel nicht im Bogen', PAL.warn);
        else if (ev.state === 'start' && con === 'helm') H.pushNotice('LANZE ZIELT – Kurs halten!', PAL.amber);
        return true;
      case 'burst': return true;   // M3b: Schildstoß entfällt (Altereignis ignorieren)
      // M3b §4: Eskalation – unbearbeiteter Schaden fängt Feuer neben der Station
      case 'escalated':
        if (m && m.zone === 'ship') H.pushNotice('FEUER an ' + name(ev.system) + ' – Schaden zu lange liegen gelassen!', PAL.red);
        return true;
      // M3b §4: Hüllentreffer im Sektor wirft eine laufende Reparatur zurück (pid = betroffener Spieler, bot = Schrauber)
      case 'repairSetback': {
        const pct = Math.round(((CFG.spaceM3b && CFG.spaceM3b.repairHitLoss) || 0.5) * 100);
        Client.setbacks.push({ system: ev.system, pid: ev.pid || null, bot: ev.bot || null, t0: performance.now() });
        if (Client.setbacks.length > 12) Client.setbacks.shift();
        if (ev.pid && ev.pid === Client.pid) { H.pushNotice('RÜCKSCHLAG! Treffer im Sektor – ' + pct + ' % der Reparatur verloren', PAL.red); Client.shakeT = performance.now(); }
        else if (con === 'captain' && K.tab === 4) H.pushNotice('Rückschlag an ' + name(ev.system) + ' (' + pct + ' %)', PAL.warn);
        return true;
      }
      case 'systemHit':
        if (ev.state === 'broken') H.pushNotice(name(ev.system) + ' zerstört!', PAL.red);
        else if (ev.state === 'damaged') H.pushNotice(name(ev.system) + ' beschädigt', PAL.warn);
        return true;
      case 'repairDone': {
        audio.play('repair_done');
        if (ev.by && ev.by === Client.pid) {
          const how = { flick: 'geflickt (fragil)', swap: 'Teil eingebaut – heil', minigame: 'repariert (dauerhaft)' }[ev.how];
          if (how) H.pushNotice(name(ev.system) + ': ' + how, ev.how === 'flick' ? R.FRAGILE_COL : PAL.mint);
        }
        return true;
      }
    }
    return false;
  }

  function onEvent(ev) {
    const PAL = R.PAL;
    if (Net.guard('Client.eventM3', () => onEventM3(ev), false)) return;
    switch (ev.kind) {
      case 'oda': H.pushOda(ev.text); break;
      case 'radio': H.onRadio(ev.from, ev.text); audio.play('radio'); break;
      case 'notice':
        if (!ev.pid || ev.pid === Client.pid) { H.pushNotice(ev.text, PAL.warn); audio.play('error'); }
        break;
      case 'sfx': {
        const vol = ev.zone && ev.zone !== Client.self.zone ? 0.35 : 1;
        // M2 (AUDIO): Parameter des Servers durchreichen; dist = Abstand Hörer–Quelle / 300 (nur mit Position)
        // M3a: zusätzlich count, kind, dur, n, key (z. B. tele_charge je Gegner)
        const o = { volume: vol, pan: audio.panFor(ev.x, ev.zone), seg: ev.seg, max: ev.max, text: ev.text, syl: ev.syl, q: ev.q,
          count: ev.count, kind: ev.enemy != null ? ev.enemy : ev.sfxKind, dur: ev.dur, n: ev.n, key: ev.key };
        if (ev.x != null && ev.y != null) o.dist = (ev.zone && ev.zone !== Client.self.zone) ? 1 : clamp(Math.hypot(ev.x - Client.self.x, ev.y - Client.self.y) / 300, 0, 1);
        audio.play(ev.name, o);
        break;
      }
      case 'missionStart': if (ev.title) H.pushNotice('Neuer Auftrag: ' + ev.title, PAL.amber); break;
      case 'missionDone': if (ev.title) H.pushNotice('Auftrag erledigt: ' + ev.title, PAL.mint); audio.play('repair_done'); break;
      case 'hit':
        if (ev.emp) { audio.play('emp'); H.pushNotice('EMP-Treffer – ein System ist kurz offline', PAL.red); }
        Client.shipHit = { sector: ev.sector, t0: performance.now() };
        audio.play(ev.shield ? 'shield_hit' : 'hull_hit', { volume: ev.shield ? 0.8 : 1 });
        if (!ev.shield) Client.shakeT = performance.now();
        break;
      case 'explosion': R.addFx('explosion', null, ev.x, ev.y, 0.7, { space: true }); audio.play('explosion_small'); break;
      case 'beam':
        for (const pid of ev.pids || []) Client.beamFx[pid] = { t0: performance.now(), dir: ev.dir };
        audio.play('beam');
        break;
      case 'jump': Client.flashT = performance.now(); audio.play('jump'); break;
      case 'repairDone': audio.play('repair_done'); break;
      case 'alarm':
        if (ev.level === 'red') audio.play('alarm_red'); else if (ev.level === 'yellow') audio.play('alarm_yellow');
        break;
      case 'stage': break;
      case 'emergency': H.pushNotice('NOTFALLPROTOKOLL – Hülle notdürftig stabilisiert', PAL.red); audio.play('emergency'); break;
      case 'strike': R.addFx('strike', 'away', ev.x, ev.y, 0.9); audio.play('strike', { pan: audio.panFor(ev.x, 'away') }); break;
      case 'codeResult': audio.play(ev.ok ? 'code_ok' : 'code_fail'); break;
      // M1 (tolerant: der Server darf diese Ereignisse schicken, muss aber nicht)
      case 'discovery': audio.play('discovery'); if (ev.text) H.pushNotice('Entdeckung: ' + ev.text, PAL.ice); break;
      case 'emp': audio.play('emp'); H.pushNotice('EMP-Treffer: ' + (H.SYS_NAMES[ev.system] || ev.system || 'System') + ' kurz offline', PAL.red); break;
      case 'lore': audio.play('lore'); if (ev.text) H.pushOda(ev.text); break;
      case 'arrive': if (ev.loc) H.showArrival(R.locName(Client.state, ev.loc), ''); break;
      case 'm1end': case 'ending':
        Client.endDismissed = false;
        if (ev.text) H.endText = String(ev.text);    // M2: m3-Ende („Die Tafel ist sicher“)
        if (ev.title) H.endTitle = String(ev.title);
        break;
      default: onEventM2(ev); break;
    }
  }

  // M2 „Schildwall“: Kampf-Ereignisse (Ton kommt über sfx vom Server; hier nur Bild und Text)
  function evPos(ev) {
    if (ev.x != null && ev.y != null) return { x: +ev.x, y: +ev.y };
    const st = Client.state || {};
    if (ev.pid != null) { const p = (st.players || []).find(q => q.id === ev.pid); if (p) return { x: p.x, y: p.y }; }
    if (ev.id != null) { const d = ((st.away && st.away.drones) || []).find(q => q.id === ev.id); if (d) return { x: d.x, y: d.y }; }
    return null;
  }
  function nameOf(pid) { const p = ((Client.state && Client.state.players) || []).find(q => q.id === pid); return p ? p.name : 'Jemand'; }
  function onEventM2(ev) {
    const PAL = R.PAL;
    const pos = evPos(ev);
    const fxAt = (kind, dy, dur, extra) => { if (pos) R.addFx(kind, 'away', pos.x, pos.y + (dy || 0), dur, extra); };
    switch (ev.kind) {
      case 'shieldHit': Client.shieldHit[ev.pid] = performance.now(); fxAt('shield_hit', -17, 0.35, { seg: ev.seg }); break;
      case 'shieldBreak':
        Client.shieldHit[ev.pid] = performance.now(); fxAt('shield_break', -16, 0.6);
        if (ev.pid === Client.pid) H.pushNotice('SCHILD WEG – in Deckung!', PAL.red);
        break;
      case 'shieldUp': case 'shieldFull': break;
      case 'wounded':
        if (ev.pid !== Client.pid) H.pushNotice(nameOf(ev.pid) + ' ist verwundet – E halten zum Wiederbeleben', PAL.red);
        break;
      case 'revived': fxAt('revive', 0, 0.8); H.pushNotice(nameOf(ev.pid) + ' steht wieder', PAL.mint); break;
      case 'squadRecall': H.pushNotice('NOTRÜCKHOLUNG – das ganze Außenteam ist an Bord', PAL.red); break;
      case 'enemyShieldHit': Client.enemyHit[ev.id] = performance.now(); fxAt('shield_hit', -14, 0.3, { seg: ev.seg, enemy: true }); break;
      case 'enemyDown': fxAt('shield_break', -14, 0.6); break;
      case 'enemyAim': break;
      case 'bark': H.pushBark(ev.text, ev.from || 'Plünderer'); break;
      case 'order': {
        // Feld `kind` ist der Ereignisname – die Befehlsart kommt als order/orderKind (Server), sonst allgemeiner Text
        const ok = ev.order || ev.orderKind || ev.what;
        if (ev.clear) break;
        H.pushBark('Befehl: ' + ((R.ORDER_NAMES && R.ORDER_NAMES[ok]) || ev.text || 'neue Markierung'), 'Captain');
        break;
      }
      case 'wardenWake': H.pushNotice('DER WÄCHTER ERWACHT', '#B57CFF'); Client.shakeT = performance.now(); break;
      case 'wardenDeflect': fxAt('warden_deflect', -22, 0.4); break;
      case 'wardenDown': fxAt('shield_break', -20, 0.9); H.pushNotice('Der Wächter ist ausgeschaltet', PAL.mint); break;
      case 'coverHit': fxAt('cover_hit', -6, 0.45); break;
      case 'jammerOff': H.pushNotice('Störrelais abgeschaltet', PAL.mint); break;
      case 'vaultOpen': H.pushNotice('Das Tor zum Gewölbe öffnet sich', PAL.amber); break;
      case 'tabletTaken': H.pushNotice('Tafel von Kesh geborgen – sie ist im Inventar', PAL.amber); break;
      default: break;
    }
  }

  // Audio/Effekte aus Zustandsänderungen
  function diffState(prev, cur) {
    if (!prev || !cur || cur.phase === 'lobby') return;
    const pm = prev.players.find(p => p.id === Client.pid), cm = cur.players.find(p => p.id === Client.pid);
    if (pm && cm) {
      if (!pm.console && cm.console) { audio.play('console_on'); K.onOpen(cm.console); }
      if (pm.console && !cm.console) { audio.play('console_off'); K.onClose(Client.view); }
      if (!pm.carry && cm.carry) audio.play('pickup');
      if (pm.carry && !cm.carry) audio.play('drop');
      if ((cm.hp || 0) - (pm.hp || 0) >= 20) { audio.play('heal'); R.addFx('heal', cm.zone, cm.x, cm.y - 16, 0.8); }
    }
    const pa = prev.away || {}, ca = cur.away || {};
    const pOpen = !!(pa.doorOpen || (pa.sonde && pa.sonde.disabled)), cOpen = !!(ca.doorOpen || (ca.sonde && ca.sonde.disabled));
    if (!pOpen && cOpen) audio.play('door');
    const ps = prev.stats || {}, cs = cur.stats || {};
    if ((cs.firesOut || 0) > (ps.firesOut || 0)) audio.play('extinguish');
    const pShip = prev.ship || {}, cShip = cur.ship || {};
    if ((cShip.breaches || []).length < (pShip.breaches || []).length) audio.play('patch');
    if (cShip.jump && pShip.jump && !(pShip.jump.charge > 0) && cShip.jump.charge > 0) audio.play('jump_charge', { volume: 0.6 });
    // Waffen
    const pb = (prev.space && prev.space.beams) || [], cb = (cur.space && cur.space.beams) || [];
    // M3a: lance/battery/enemy_heavy klingen über Server-sfx (lance_fire, battery_salvo, heavy_hit) – hier nur Altnamen
    if (cb.length > pb.length) for (const b of cb.slice(pb.length)) if (b.kind === 'lanze' || b.kind === 'seitenturm' || !b.kind) audio.play(b.kind === 'seitenturm' ? 'seitenturm' : 'lanze', { volume: Client.self.zone === 'ship' ? 1 : 0.4 });
    // M3a: verschwindet ein ladender Gegner, Ladeton anhalten
    {
      const curIds = new Set(((cur.space && cur.space.enemies) || []).map(e => e.id));
      for (const e of (prev.space && prev.space.enemies) || []) if (e.tele && !curIds.has(e.id)) stopSfx('tele_charge', e.id);
    }
    const pIds = new Set(((prev.space && prev.space.projectiles) || []).map(p => p.id));
    for (const pr of (cur.space && cur.space.projectiles) || []) if (!pIds.has(pr.id) && pr.kind === 'bolzen') audio.play('bolzen');
    // Gegnertreffer (für Blinken)
    const pe = {};
    for (const e of (prev.space && prev.space.enemies) || []) pe[e.id] = e;
    for (const e of (cur.space && cur.space.enemies) || []) if (pe[e.id] && e.hp < pe[e.id].hp) Client.enemyHit[e.id] = performance.now();
    // Plattform
    if (Client.self.zone === 'away') {
      const pap = new Set((pa.projectiles || []).map(p => p.id));
      for (const pr of ca.projectiles || []) {
        if (pap.has(pr.id)) continue;
        if (pr.kind === 'drone') audio.play('drone_shot', { volume: 0.7, pan: audio.panFor(pr.x, 'away') });
      }
      const pd = {};
      for (const d of pa.drones || []) pd[d.id] = d;
      for (const d of ca.drones || []) if (pd[d.id] && pd[d.id].alive !== false && d.alive === false) audio.play('drone_die', { pan: audio.panFor(d.x, 'away') });
      // M2: Schildsegmente gesunken -> Trefferblitz (auch ohne Ereignis)
      if (ca.combat === 'v2') {
        const now = performance.now();
        for (const d of ca.drones || []) { const o = pd[d.id]; if (o && Array.isArray(o.sh) && Array.isArray(d.sh) && d.sh[0] < o.sh[0]) Client.enemyHit[d.id] = now; }
        const pp = {}; for (const p of prev.players || []) pp[p.id] = p;
        for (const p of cur.players || []) { const o = pp[p.id]; if (o && Array.isArray(o.sh) && Array.isArray(p.sh) && p.sh[0] < o.sh[0]) Client.shieldHit[p.id] = now; }
      }
    }
    // Bots
    if (Client.self.zone === 'ship') {
      const pbots = {};
      for (const b of prev.bots || []) pbots[b.id] = b;
      for (const b of cur.bots || []) if (pbots[b.id] && !pbots[b.id].task && b.task) audio.play('bot_beep', { volume: 0.4, pan: audio.panFor(b.x, 'ship') });
    }
    diffM1(prev, cur, pm, cm);
  }

  // M1: Ankunft, Reaktor, Scans, Marker, Entdeckungen, Wrack – Töne und Hinweise aus Zustandsänderungen
  function diffM1(prev, cur, pm, cm) {
    const PAL = R.PAL;
    const pw = prev.world || {}, cw = cur.world || {};
    if (cw.location && pw.location && cw.location !== pw.location) {
      const l = R.locById(cur, cw.location) || {};
      H.showArrival(R.locName(cur, cw.location), R.LOC_KIND_NAMES[l.kind] || '');
      if (l.fog || l.kind === 'nebula' || l.kind === 'relay') audio.play('discovery', { volume: 0.4 });
    }
    const ps = prev.ship || {}, cs = cur.ship || {};
    if (cs.dockedAt && !ps.dockedAt) H.pushNotice('Angedockt: ' + R.locName(cur, cs.dockedAt) + ' – Terminal offen', PAL.mint);
    const pr = ps.reactor || {}, cr = cs.reactor || {};
    if (pr.state && cr.state && pr.state !== cr.state) {
      if (cr.state === 'overload') { audio.play('overload_start'); H.pushNotice('Reaktor überladen: 3 Minuten mehr Energie', PAL.amber); }
      if (cr.state === 'offline') { audio.play('reactor_down'); H.pushNotice('REAKTOR OFFLINE – Neustart: beide Schalter im Maschinenraum halten', PAL.red); }
      if (cr.state === 'online' && pr.state === 'offline') { audio.play('reactor_up'); H.pushNotice('Reaktor wieder online', PAL.mint); }
    }
    if (cr.state === 'overload' && (pr.overloadLeft || 0) > 30 && (cr.overloadLeft || 0) <= 30) audio.play('overload_warn');
    const psw = pr.switches || {}, csw = cr.switches || {};
    if ((csw.A && !psw.A) || (csw.B && !psw.B)) audio.play('switch_hold', { volume: 0.6 });
    // Marker
    const pmk = ps.markers || {}, cmk = cs.markers || {};
    for (const k of ['captain', 'tactical']) {
      const a = pmk[k], b = cmk[k];
      if (b && (!a || a.x !== b.x || a.y !== b.y)) audio.play('marker_set', { volume: cm && (cm.console === 'helm') ? 1 : 0.5 });
    }
    // Ziel-Scan
    const pts = ps.tscan || {}, cts = cs.tscan || {};
    if ((cts.progress || 0) > 0 && (cts.progress || 0) < 1 && Math.floor((cts.progress || 0) * 4) !== Math.floor((pts.progress || 0) * 4)) audio.play('scan_tick', { volume: 0.5 });
    const pe = {}; for (const e of (prev.space && prev.space.enemies) || []) pe[e.id] = e;
    for (const e of (cur.space && cur.space.enemies) || []) {
      if (e.scanned && pe[e.id] && !pe[e.id].scanned) { audio.play('scan_done'); H.pushNotice('Scan: ' + (R.ENEMY_NAMES[e.kind] || e.kind) + ' – Schilde und Feuerbögen sichtbar', PAL.mint); }
    }
    for (const id in pe) if (pe[id].kind === 'pylon' && !((cur.space && cur.space.enemies) || []).some(e => e.id === id)) audio.play('pylon_down');
    // Weitscan-Puls
    const pws = ps.widescan || {}, cws = cs.widescan || {};
    if (cws.pulseAt != null && cws.pulseAt !== pws.pulseAt) audio.play('widescan', { volume: Client.self.zone === 'ship' ? 1 : 0.4 });
    const ph = new Set(((prev.space && prev.space.hidden) || []).map(h => h.id));
    const newHidden = ((cur.space && cur.space.hidden) || []).filter(h => !ph.has(h.id));
    if (newHidden.length && prev.space) H.pushNotice('Weitscan: ' + newHidden.map(h => (R.HIDDEN_NAMES[h.kind] || 'Signal').toLowerCase()).join(', ') + ' aufgedeckt', PAL.mint);
    // Entdeckungen / Logbuch
    const pmi = prev.mission || {}, cmi = cur.mission || {};
    const pl = (pmi.log || []).length, cl = (cmi.log || []).length;
    if (cl > pl && pmi.log) { const e = cmi.log[cl - 1]; audio.play('discovery'); H.pushNotice('Logbuch: ' + String(e.text || '').slice(0, 70), PAL.ice); }
    // Phasenkanonen
    const pb = (prev.space && prev.space.beams) || [], cb = (cur.space && cur.space.beams) || [];
    if (cb.length > pb.length && cb.slice(pb.length).some(b => b.kind === 'phase')) audio.play('phase', { volume: Client.self.zone === 'ship' ? 1 : 0.4 });
    // Wrack: Bergung, Hohlraum
    const pa = prev.away || {}, ca = cur.away || {};
    const pdone = (pa.salvage || []).filter(s => s.done).length, cdone = (ca.salvage || []).filter(s => s.done).length;
    if (cdone > pdone) audio.play('salvage');
    if (ca.hollow && ca.hollow.marked && !(pa.hollow && pa.hollow.marked)) H.pushNotice('Hohlraum im Wrack markiert (Weitscan)', PAL.amber);
    if (ca.hollow && ca.hollow.open && !(pa.hollow && pa.hollow.open)) audio.play('door');
    // Planungstisch
    if (pm && cm && pm.console !== 'plan' && cm.console === 'plan') audio.play('table_sit');
    // Shop-Kontext
    if (cur.shopContext === 'vaelen' && prev.shopContext !== 'vaelen') H.pushNotice('Vaelen-Karawane: Händlerin Sela öffnet ihr Sortiment', PAL.moss);
    // Ende M1
    if (cmi.m1Done && !pmi.m1Done) Client.endDismissed = false;
  }

  function updateAmbience() {
    const st = Client.state;
    if (!audio.has()) return;
    if (!st || st.phase === 'lobby') { audio.music('none'); for (const l of ['fire', 'breach', 'engine', 'reactor_hum']) audio.loop(l, false); return; }
    const onShip = Client.self.zone === 'ship';
    const ship = st.ship || {};
    audio.loop('fire', onShip && (ship.fires || []).length > 0, Math.min(1, 0.3 + (ship.fires || []).length * 0.12));
    audio.loop('breach', onShip && (ship.breaches || []).length > 0, 0.6);
    const sp = +ship.speed || Math.hypot(+ship.vx || 0, +ship.vy || 0) || 0;
    // QA-Pegel: Triebwerk war bei 0.6 ~6 dB lauter als die Musik (Dauerbeschallung) – halbiert
    audio.loop('engine', onShip && sp > 3, clamp(0.1 + sp / 400, 0, 0.4));
    audio.loop('reactor_hum', onShip, 0.3);
    const enemies = ((st.space && st.space.enemies) || []).filter(e => e.kind !== 'relay').length;
    const loc = R.currentLoc(st) || {};
    const mysterious = !!(st.world && (loc.fog || loc.kind === 'nebula' || loc.kind === 'relay' || loc.kind === 'wreck'));
    let mood = 'ship', intensity = null;
    if (st.phase === 'end') mood = 'port';
    else if (!onShip) mood = enemies ? 'combat' : mysterious ? 'mystery' : 'explore';
    else if (enemies) mood = 'combat';
    else if (ship.dockedAt || ship.scene === 'port' || loc.kind === 'port') mood = 'port';
    else if (mysterious) mood = 'mystery';
    if (mood === 'combat') intensity = clamp(enemies * 0.3 + (ship.alert === 'red' ? 0.3 : 0), 0, 1);
    // M2: Kampf v2 auf Kesh – Stimmung 'ruin' (falls audio.js sie kennt), Intensität nach sichtbaren Gegnern
    if (!onShip && st.phase !== 'end' && R.mapFor('away', st).id === 'kesh') {
      // AUDIO-Vorgabe: 0 ohne Kontakt, ~0,5 bei sichtbaren Gegnern, 0,8–1 bei Zielen/Schuss oder wachem Wächter
      const all = ((st.away && st.away.drones) || []).filter(d => d.alive !== false);
      const seen = all.filter(d => d.vis);
      const aiming = seen.some(d => d.aim);
      const shooting = ((st.away && st.away.projectiles) || []).some(p => p.kind === 'enemy' || p.kind === 'warden');
      const wardenAwake = all.some(d => d.kind === 'warden' && !d.asleep);
      mood = 'ruin';
      intensity = (aiming || shooting || wardenAwake) ? clamp(0.8 + 0.05 * seen.length, 0.8, 1) : seen.length ? 0.5 : 0;
    }
    audio.music(mood, intensity);
  }

  // ------------------------------------------------------------------ Interpolation
  function snapPair(rt) {
    const b = Client.snaps;
    if (!b.length) return null;
    const last = b[b.length - 1];
    if (b.length === 1 || rt >= last.t) return { a: last.s, b: last.s, f: 0, ext: b.length > 1 ? rt - last.t : 0 };   // M3b: ext = ms über den letzten Snapshot hinaus
    if (rt <= b[0].t) return { a: b[0].s, b: b[0].s, f: 0 };
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= rt) return { a: b[i - 1].s, b: b[i].s, f: clamp((rt - b[i - 1].t) / Math.max(1, b[i].t - b[i - 1].t), 0, 1), dt: (b[i].s.time != null && b[i - 1].s.time != null ? (b[i].s.time - b[i - 1].s.time) * 1000 : b[i].t - b[i - 1].t) };
    }
    return { a: last.s, b: last.s, f: 0 };
  }
  // M3b §5: Gegner mit vx/vy weich interpolieren – kubische Hermite-Kurve zwischen zwei Snapshots (Position + Geschwindigkeit),
  // läuft der Puffer leer, höchstens 120 ms geradeaus weiter (statt Stehenbleiben). Ohne vx/vy: wie bisher linear.
  function lerpEnemies(la, lb, f, dtMs, extMs) {
    lb = lb || [];
    const hasV = (e) => e && isFinite(e.vx) && isFinite(e.vy);
    if (extMs > 0 && (!la || la === lb)) {
      const k = Math.min(extMs, 120) / 1000;
      return lb.map(e => (hasV(e) ? Object.assign({}, e, { x: e.x + e.vx * k, y: e.y + e.vy * k }) : e));
    }
    if (!la || la === lb || f <= 0) return lb;
    const m = {};
    for (const e of la) if (e && e.id != null) m[e.id] = e;
    const T = Math.max(0.001, (dtMs || 67) / 1000);
    return lb.map(e => {
      const o = m[e.id];
      if (!o) return e;
      if (Math.hypot(e.x - o.x, e.y - o.y) > 200) return e;
      const r = Object.assign({}, e);
      if (hasV(o) && hasV(e)) {
        const t = f, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        r.x = h00 * o.x + h10 * T * o.vx + h01 * e.x + h11 * T * e.vx;
        r.y = h00 * o.y + h10 * T * o.vy + h01 * e.y + h11 * T * e.vy;
        r.vx = lerp(o.vx, e.vx, f); r.vy = lerp(o.vy, e.vy, f);
      } else { r.x = lerp(o.x, e.x, f); r.y = lerp(o.y, e.y, f); }
      if (e.angle != null && o.angle != null) r.angle = lerpAngle(o.angle, e.angle, f);
      return r;
    });
  }
  function lerpList(la, lb, f) {
    lb = lb || [];
    if (!la || la === lb || f <= 0) return lb;
    const m = {};
    for (const e of la) if (e && e.id != null) m[e.id] = e;
    return lb.map(e => {
      const o = m[e.id];
      if (!o || o.zone !== e.zone) return e;
      if (Math.hypot(e.x - o.x, e.y - o.y) > 200) return e;   // Teleport (Beamen)
      const r = Object.assign({}, e);
      r.x = lerp(o.x, e.x, f); r.y = lerp(o.y, e.y, f);
      if (e.angle != null && o.angle != null) r.angle = lerpAngle(o.angle, e.angle, f);
      return r;
    });
  }

  // ------------------------------------------------------------------ Interaktions-Hinweis (§4.2)
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const ITEM_LABEL = H.ITEM_NAMES;
  function interactionAt(st, m, tx, ty, zone, ownTile) {
    const map = R.mapFor(zone, st);
    const ch = map.at(tx, ty);
    const wreck = map.id === 'wreck';
    const players = st.players || [];
    const carry = m.carry;
    const downed = players.find(p => p.id !== m.id && p.downed && p.zone === zone && Math.floor(p.x / TILE) === tx && Math.floor(p.y / TILE) === ty);
    if (downed && Array.isArray(m.sh)) {
      // M2: Wiederbeleben auf v2-Karten (Medipack schneller)
      const AC = CFG.awayCombat || {}, W = AC.wounded || {};
      const sec = m.medkit ? (W.medkitReviveTime || 1.5) : (W.reviveTime || 4);
      return { label: 'E halten: ' + downed.name + ' wiederbeleben (' + String(sec).replace('.', ',') + ' s' + (m.medkit ? ', Medipack' : '') + ')', ok: true };
    }
    if (downed) return { label: 'Halten: ' + downed.name + ' wiederbeleben', ok: true };
    if (map.id === 'kesh' && zone === 'away' && !ownTile) {
      // M2: Kesh-Interaktionen (§4.7)
      const ks = R.keshObjState(st, map, tx, ty);
      const AC = CFG.awayCombat || {};
      const fs = (v, d) => String(v == null ? d : v).replace('.', ',');
      if (ch === 'r') return ks.jammer && ks.jammer.off ? { label: 'Störrelais: aus', ok: false } : { label: 'Halten: Störrelais abschalten (' + fs(AC.jammerTime, 2.5) + ' s)', ok: true };
      if (ch === 'k') {
        if (ks.gateOpen) return { label: 'Archivschlüssel: Tor ist offen', ok: false };
        const keys = (st.away && st.away.keys) || [];
        const other = keys.find(k => k !== ks.key && (+k.t || 0) > 0);
        return { label: 'Halten: Archivschlüssel drehen (' + fs(AC.archkeyTime, 3) + ' s) · ' + (other ? 'der zweite wird gedreht!' : 'beide gleichzeitig!'), ok: true };
      }
      if (ch === 'T') return ks.tablet && ks.tablet.taken ? { label: 'Sockel: leer', ok: false } : { label: 'Halten: Tafel bergen (' + fs(AC.tabletTime, 3) + ' s)', ok: true };
      if (ch === 'G') return ks.gateOpen ? null : { label: 'Tor: zwei Archivschlüssel in der Halle gleichzeitig drehen', ok: false };
    }
    if (zone === 'ship' && st.ship) {
      if ((st.ship.fires || []).some(f => f[0] === tx && f[1] === ty)) return carry === 'loeschgel' ? { label: 'Halten: Feuer löschen', ok: true } : { label: 'Löschgel nötig (Lager)', ok: false };
      if ((st.ship.breaches || []).some(b => b.tx === tx && b.ty === ty)) return carry === 'flickblech' ? { label: 'Halten: Leck flicken', ok: true } : { label: 'Flickblech nötig (Lager)', ok: false };
    }
    // Brückenumbau: freies Terminal (Legende interact 'spare') – noch ohne Funktion
    if (!ownTile && zone === 'ship' && map.legend && map.legend[ch] && map.legend[ch].interact === 'spare') return { label: 'Freies Terminal – noch ohne Funktion.', ok: false };
    if (ownTile) {
      const items = zone === 'away' ? ((st.away && st.away.items) || []) : ((st.ship && st.ship.groundItems) || []);
      const it = items.find(i => Math.floor(i.x / TILE) === tx && Math.floor(i.y / TILE) === ty);
      if (it) return carry ? { label: 'Hände voll (G ablegen)', ok: false } : { label: 'Aufheben: ' + (ITEM_LABEL[it.kind] || it.kind), ok: true };
      if (ch === 'P') return { label: 'Halten: Selbst-Transfer', ok: true };
      return null;
    }
    // M1: Wrack (Bergung, Logbuch-Terminal, Hohlraum)
    if (wreck) {
      const away = st.away || {};
      if (ch === 'h') {
        const s = (away.salvage || []).find(q => { const tt = R.toTileXY(map, q.x, q.y); return tt && tt.x === tx && tt.y === ty; });
        return s && s.done ? { label: 'Container: schon geborgen', ok: false } : { label: 'Halten: Container bergen', ok: true };
      }
      if (ch === 'g') return { label: 'Logbuch-Terminal lesen', ok: true };
      if (ch === 'V') {
        const hv = away.hollow;
        const tt = hv ? R.toTileXY(map, hv.x, hv.y) : null;
        const here = tt && tt.x === tx && tt.y === ty;
        if (here && hv.open) return null;
        if (here && hv.marked) return { label: 'Halten: Hohlraum aufbrechen (4 s)', ok: true };
        return { label: 'Die Wand klingt hohl … (Weitscan aus dem Orbit)', ok: false };
      }
    }
    // M1: Reaktorschalter (Neustart zu zweit)
    // M3a: Schiffsobjekte über die Legende (R.objKindOf), Schalter nur über REACTOR_SWITCHES (kein Ersatzwert)
    const shipKind = zone === 'ship' && R.objKindOf ? R.objKindOf(map, ch) : null;
    if (shipKind === 'reactor_switch') {
      const sws = Maps.REACTOR_SWITCHES || [];
      const sw = sws.find(s => s.x === tx && s.y === ty);
      if (!sw) return null;
      const reactor = (st.ship && st.ship.reactor) || {};
      const osw = sws.find(s => s.id !== sw.id);
      const oroom = osw && Maps.roomAt ? Maps.roomAt(osw.x, osw.y) : null;
      const other = (osw ? (osw.y > sw.y ? 'unten' : 'oben') : 'gegenüber') + (oroom ? ' im ' + oroom.name : '');
      if (reactor.state !== 'offline') return { label: 'Reaktorschalter ' + sw.id + ' (nur nach Abschaltung)', ok: false };
      const oid = osw ? osw.id : (sw.id === 'A' ? 'B' : 'A');
      const otherHeld = reactor.switches && reactor.switches[oid];
      return { label: 'Halten: Schalter ' + sw.id + (otherHeld ? ' · Schalter ' + oid + ' wird gehalten!' : ' · Zweiter Schalter: ' + other), ok: true };
    }
    if (shipKind === 'plan_table') {
      const seated = (st.players || []).filter(p => p.console === 'plan').length;
      return seated >= 3 ? { label: 'Planungstisch: voll', ok: false } : { label: 'Planungstisch: Platz nehmen' + (seated ? ' (' + seated + ' sitzen)' : ''), ok: true };
    }
    const sys = R.sysOf ? R.sysOf(map, ch) : R.SYS_BY_CHAR[ch];
    if (sys && zone === 'ship') {
      // M3a §8.1: drei Wege – E flicken (ohne Teil), E Teil einbauen (mit Teil, auch an heilem fragilem System), R Minispiel
      const state = R.sysState(st, sys);
      const fragile = R.fragileOf(st, sys);
      const name = H.SYS_NAMES[sys] || sys;
      const RC = (CFG.spaceM3 && CFG.spaceM3.repair) || {};
      const belt = !!(m.gear && m.gear.werkzeuggurt);
      const secs = (v) => String(Math.round(v * (belt ? 0.7 : 1) * 10) / 10).replace('.', ',') + ' s';
      if (state === 'offline') return { label: name + ': offline (EMP) – startet selbst neu', ok: false, sys };
      if (state === 'ok' && !fragile) return null;
      const alt = { key: 'R', label: 'reparieren (Minispiel, dauerhaft)', ok: true };
      if (carry === 'ersatzteil') return { label: 'halten: Teil einbauen (' + secs(RC.partTime || 3) + ', dauerhaft) · ' + name, ok: true, sys, alt };
      if (state === 'ok') return { label: name + ': geflickt – bricht beim nächsten Treffer', ok: false, sys, alt };
      return { label: 'halten: flicken (' + secs(RC.flickTime || 1.5) + ', fragil) · ' + name, ok: true, sys, alt };
    }
    const con = R.consoleOf ? R.consoleOf(map, ch) : R.CONSOLE_BY_CHAR[ch];
    if (con && zone === 'ship') {
      if (con === 'shop' && !(st.ship && (st.ship.dockedAt || st.ship.docked))) return { label: 'Hafenterminal: nur angedockt (Hafen/Vaelen)', ok: false };
      const taken = players.find(p => p.console === con && p.id !== m.id);
      if (taken) return { label: H.CONSOLE_NAMES[con] + ': besetzt (' + taken.name + ')', ok: false };
      return { label: H.CONSOLE_NAMES[con], ok: true };
    }
    if (shipKind === 'shelf') {
      const item = R.shelfItemAt ? R.shelfItemAt(tx, ty) : null;   // M3a: Regal aus dem Schiffslayout
      if (!item) return null;
      const inv = st.inventory || {};
      const n = R.shelfStock ? R.shelfStock(inv, item) : (inv[item] || 0);
      const what = (R.SHELF_LABEL && R.SHELF_LABEL[item]) || ITEM_LABEL[item];
      if (carry === item) return { label: 'Zurücklegen · ' + what + ': ' + n, ok: true };
      if (carry) return { label: what + ': ' + n + ' · Hände voll (G ablegen)', ok: false };
      if (n <= 0) return { label: what + ': 0 – Regal leer (Nachschub im Hafen)', ok: false };
      return { label: 'Nehmen · ' + what + ': ' + n, ok: true };
    }
    if (shipKind === 'bed') {
      const bed = R.bedAt(tx, ty);
      if (bed && bed.color === m.color) return { label: 'Quartier gestalten', ok: true };
      return null;
    }
    const platform = map.id === 'platform';
    if (ch === 'Z' && zone === 'away' && platform) return { label: 'Kustoden-Sonde', ok: true };
    if (ch === 'b' && zone === 'away' && platform && !(st.away && st.away.coreRebooted)) {
      const off = !!(st.away && st.away.sonde && st.away.sonde.disabled);
      return off ? { label: 'Halten: Bojenkern neu starten', ok: true } : { label: 'Bojenkern gesperrt (erst Sonde)', ok: false };
    }
    if (zone === 'away') {
      const npc = platform && st.away && st.away.npc;
      if (npc && npc.present !== false && !npc.rescued && Math.floor(npc.x / TILE) === tx && Math.floor(npc.y / TILE) === ty) {
        if (npc.injured) return carry === 'medipack' ? { label: 'Ivo verarzten (Medipack)', ok: true } : { label: 'Ivo ist verletzt: Medipack nötig', ok: false };
        return { label: npc.following === m.id ? 'Techniker: warten' : 'Techniker: folgen', ok: true };
      }
      const it = ((st.away && st.away.items) || []).find(i => Math.floor(i.x / TILE) === tx && Math.floor(i.y / TILE) === ty);
      if (it) return carry ? { label: 'Hände voll (G ablegen)', ok: false } : { label: 'Aufheben: ' + (ITEM_LABEL[it.kind] || it.kind), ok: true };
    }
    if (zone === 'ship') {
      const it = ((st.ship && st.ship.groundItems) || []).find(i => Math.floor(i.x / TILE) === tx && Math.floor(i.y / TILE) === ty);
      if (it) return carry ? { label: 'Hände voll (G ablegen)', ok: false } : { label: 'Aufheben: ' + (ITEM_LABEL[it.kind] || it.kind), ok: true };
    }
    return null;
  }
  function computeInteraction(st, m, self) {
    if (!m || m.console || m.downed) return null;
    const t = Phys.toTile(self.x, self.y);
    const d = DIRV[self.dir] || DIRV.down;
    const order = [[d[0], d[1], false], [0, 0, true], [0, -1, false], [1, 0, false], [0, 1, false], [-1, 0, false]];
    const seen = {};
    for (const [dx, dy, own] of order) {
      const k = dx + ',' + dy + own;
      if (seen[k]) continue; seen[k] = 1;
      const r = interactionAt(st, m, t.x + dx, t.y + dy, self.zone, own);
      if (r) return Object.assign({ tx: t.x + dx, ty: t.y + dy }, r);
    }
    return null;
  }

  // ------------------------------------------------------------------ Eingabe
  const MOVE_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  function moveAxes() {
    const k = Client.keys;
    let mx = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
    let my = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0);
    return { mx, my };
  }
  function mouseWorld() { return R.screenToWorld(Client.mouse.x, Client.mouse.y); }
  function shoot() {
    const m = me();
    // M2: Verwundete schießen auf v2-Karten mit der Pistole (players[].sh gesetzt)
    const pistol = !!(m && m.downed && Array.isArray(m.sh));
    if (!m || m.zone !== 'away' || m.console || (m.downed && !pistol) || Client.shootCd > 0) return;
    const w = mouseWorld();
    const oy = pistol ? 6 : 14;
    const angle = Client.mouse.x >= 0 ? Math.atan2(w.y - (Client.self.y - oy), w.x - Client.self.x) : (function () { const d = DIRV[Client.self.dir] || DIRV.down; return Math.atan2(d[1], d[0]); })();
    send({ t: P.C.SHOOT || 'shoot', angle });
    const AC = CFG.awayCombat || {};
    if (pistol) Client.shootCd = (AC.wounded && AC.wounded.pistolCooldown) || 0.7;
    else if (Array.isArray(m.sh)) Client.shootCd = (AC.blaster && AC.blaster.cooldown) || 0.3;
    else Client.shootCd = ((CFG.away && CFG.away.blaster && CFG.away.blaster.cooldown) || 0.35);
    audio.play(pistol ? 'pistol' : 'blaster');
  }
  // M2 §15: Ducken (Taste C). Lokale Vorhersage, bis der Snapshot (players[].cr) nachzieht.
  function crouchActive(m) {
    const req = Client.crouchReq;
    if (req && Client.time - req.t < 0.6) return req.on;
    return !!(m && m.cr);
  }
  function canCrouchHere(m, st) {
    return !!(m && st && m.zone === 'away' && !m.downed && !m.console && st.away && st.away.combat === 'v2');
  }
  function crouchFactor() {
    const f = CFG.awayCombat && CFG.awayCombat.crouch && +CFG.awayCombat.crouch.speedFactor;
    return isFinite(f) && f > 0 ? Math.min(1, f) : 0.5;
  }
  function toggleCrouch() {
    const st = Client.state, m = me();
    if (!canCrouchHere(m, st)) return;
    const on = !crouchActive(m);
    Client.crouchReq = { on, t: Client.time };
    send({ t: P.C.CMD || 'cmd', c: P.CMD_CROUCH || 'crouch', on });
    audio.play('ui_click', { volume: 0.4 });
  }
  // ------------------------------------------------------------------ M3a §8.1: Reparatur-Minispiel (lokal, ein gemeinsames für alle Systeme)
  // Ablauf: R an der Station -> cmd repair.start -> Server setzt players[].action.kind = 'minigame' -> Zeigerleiste, Leertaste
  // im grünen Feld, 3 Treffer, Fehlgriff = 1 s Sperre -> repair.done { system, errors } frühestens nach minigameMinTime.
  // Bricht der Server ab (action nicht mehr minigame), schließt das Overlay. Esc = repair.cancel.
  function mgMinTime() { return (CFG.spaceM3 && CFG.spaceM3.repair && CFG.spaceM3.repair.minigameMinTime) || 2.5; }
  function mgSfx(name, opts) { audio.play(name, opts || {}); }
  function mgZone(mg) {
    const w = mg.broken ? 0.12 : 0.2;
    let a = 0.05 + Math.random() * (0.9 - w);
    for (let i = 0; i < 6 && Math.abs(a + w / 2 - mg.pos) < 0.22; i++) a = 0.05 + Math.random() * (0.9 - w);
    return { a, w };
  }
  function startMinigame(sys) {
    const st = Client.state, m = me();
    if (!st || !m || m.zone !== 'ship' || m.console || Client.minigame) return;
    const state = R.sysState(st, sys);
    if (state === 'offline') { H.pushNotice((H.SYS_NAMES[sys] || sys) + ' ist offline (EMP) – startet selbst neu', R.PAL.warn); return; }
    if (state === 'ok' && !R.fragileOf(st, sys)) { H.pushNotice((H.SYS_NAMES[sys] || sys) + ' ist heil', R.PAL.mint); return; }
    if (Client.actDown) { Client.actDown = false; send({ t: P.C.ACT || 'act', down: false }); }
    const mg = { system: sys, broken: state === 'broken', phase: 'wait', t0: Client.time, confirmT: null, pos: 0, dir: 1, speed: 0.85, hits: 0, errors: 0, lockUntil: -1, sent: false };
    mg.zone = mgZone(mg);
    Client.minigame = mg;
    send({ t: P.C.CMD || 'cmd', c: 'repair.start', system: sys });
    audio.play('ui_click');
  }
  function closeMinigame(reason) {
    Client.minigame = null;
    if (reason) H.pushNotice(reason, R.PAL.warn);
  }
  function cancelMinigame() {
    const mg = Client.minigame;
    if (!mg) return;
    send({ t: P.C.CMD || 'cmd', c: 'repair.cancel', system: mg.system });
    closeMinigame(null);
    audio.play('ui_back');
  }
  function minigameKey(code) {
    const mg = Client.minigame;
    if (code === 'Escape') { cancelMinigame(); return; }
    if (code !== 'Space' || !mg || mg.phase !== 'play') return;
    if (mg.lockUntil > Client.time) return;
    const z = mg.zone;
    if (mg.pos >= z.a && mg.pos <= z.a + z.w) {
      mg.hits++;
      mgSfx('minigame_hit', { n: mg.hits });
      if (mg.hits >= 3) { mg.phase = 'done'; mgSfx('minigame_done'); }
      else { mg.zone = mgZone(mg); mg.speed += 0.15; }
    } else {
      mg.errors++;
      mg.lockUntil = Client.time + 1;
      mgSfx('minigame_miss');
    }
  }
  function updateMinigame(dt) {
    const mg = Client.minigame;
    if (!mg) return;
    const m = me();
    if (!m || m.console || m.zone !== 'ship' || m.downed) { closeMinigame(null); return; }
    const act = m.action;
    const active = !!(act && act.kind === 'minigame');
    if (active && mg.confirmT == null) { mg.confirmT = Client.time; mg.phase = 'play'; }
    if (mg.confirmT == null) {
      if (Client.time - mg.t0 > 1.5) closeMinigame(null);   // Server hat abgelehnt (Grund kommt als notice)
      return;
    }
    if (!active && !mg.sent) { closeMinigame('Reparatur abgebrochen'); return; }
    if (mg.phase === 'play' || mg.phase === 'done') {
      const prevDir = mg.dir;
      mg.pos += mg.dir * mg.speed * dt * (mg.lockUntil > Client.time ? 0.6 : 1);
      if (mg.pos >= 1) { mg.pos = 1; mg.dir = -1; } else if (mg.pos <= 0) { mg.pos = 0; mg.dir = 1; }
      if (prevDir !== mg.dir && mg.phase === 'play') mgSfx('minigame_tick', { volume: 0.5 });
    }
    if (mg.phase === 'done' && !mg.sent) {
      // Server nimmt repair.done erst nach minigameMinTime an – sonst endet es ohne Reparatur
      const elapsed = Client.time - mg.confirmT;
      const srvOk = act && act.progress != null ? +act.progress >= 1 : true;
      if (elapsed >= mgMinTime() + 0.15 && srvOk) {
        mg.sent = true;
        send({ t: P.C.CMD || 'cmd', c: 'repair.done', system: mg.system, errors: mg.errors });
        closeMinigame(null);
      }
    }
  }

  function releaseAll() {
    Client.keys = {};
    if (Client.actDown) { Client.actDown = false; send({ t: P.C.ACT || 'act', down: false }); }
    if (Client.view) K.releaseAll(Client.view);
    H.showCrew = false;
  }

  window.addEventListener('keydown', (e) => {
    initAudio();
    if (document.activeElement === nameInput) {
      if (e.key === 'Enter') { nameInput.blur(); Net.sendHello(); actions.toggleReady(); }
      return;
    }
    if (codeInput && document.activeElement === codeInput) {
      if (e.key === 'Enter') { e.preventDefault(); actions.submitCode(); }
      return;
    }
    const code = e.code;
    if (code === 'Space' || code === 'Tab' || code.indexOf('Arrow') === 0 || code === 'Backspace') e.preventDefault();
    // M2: Debug-Befehlszeile (nur ?debug=1): F7 öffnet eine Eingabe, z. B. „tune shield.regenDelay 3“, „kesh“, „squad 2“
    if (DEBUG && code === 'F7') {
      e.preventDefault();
      releaseAll();
      let line = null;
      try { line = window.prompt('Debug-Befehl (tune <pfad> <wert> · tune · kesh · squad 1|2|rear · wake · shield <n> · wound · god on|off · mission m3 <schritt> …)', Client.lastDebugLine || ''); } catch (err) { Net.reportError('Client.debugPrompt', err); }
      if (line) { Client.lastDebugLine = line; const msg = G.dbg(line); if (msg) H.pushNotice('Debug: ' + line, '#FF66CC'); }
      return;
    }
    const st = Client.state, m = me();
    if (!st || st.phase === 'lobby' || !m) {
      if (Net.badCode && !m) { if (code === 'Enter') actions.submitCode(); return; }
      if (code === 'Enter') actions.toggleReady();
      if (code === 'KeyU' && m) actions.toggleSkipDrill();
      if (code === 'KeyM' && m) actions.toggleStartMission();   // M2: Direktstart Planetenmission
      if (code === 'KeyL' && m && Net.serverRoomCode) actions.copyInvite();
      const d = /^Digit([1-3])$/.exec(code);
      if (d) actions.setColor(+d[1] - 1);
      return;
    }
    Client.keys[code] = true;
    if (DEBUG && Client.serverDebug && code === 'F6') { e.preventDefault(); send({ t: 'debug', cmd: 'skip' }); return; }
    // QA M1: Der Ende-Screen erscheint auch über Konsolen (der Captain sitzt beim Kernscan an der Konsole) – Enter/Esc schließt ihn zuerst.
    if ((st.phase === 'end' || (st.mission && st.mission.m1Done)) && !Client.endDismissed && (code === 'Enter' || code === 'Escape')) { actions.dismissEnd(); return; }
    if (m.console) { Net.guard('Consoles.keyDown', () => K.keyDown(e, Client.view)); return; }
    // M3a: Minispiel offen -> nur Leertaste/Esc, kein E an den Server, keine Bewegung
    if (Client.minigame) { if (!e.repeat) Net.guard('Client.minigameKey', () => minigameKey(code)); return; }
    if (e.repeat) return;
    switch (code) {
      case 'KeyR': {
        // M3a: R an einer beschädigten/zerstörten (oder geflickten) Station startet das Minispiel
        const ia = Client.view && Client.view.interaction;
        if (m.zone === 'ship' && ia && ia.sys && ia.alt) startMinigame(ia.sys);
        break;
      }
      case 'KeyE': if (!Client.actDown) { Client.actDown = true; send({ t: P.C.ACT || 'act', down: true }); } break;
      case 'KeyG': if (m.carry) send({ t: P.C.DROP || 'drop' }); break;
      case 'Space': shoot(); break;
      case 'KeyC': toggleCrouch(); break;   // M2 §15: ducken (nur Außenzone auf v2-Karten)
      case 'KeyQ':
        if (m.zone === 'away') {
          const w = Client.mouse.x >= 0 ? mouseWorld() : { x: Client.self.x, y: Client.self.y };
          send({ t: P.C.MARK || 'mark', x: Math.round(w.x), y: Math.round(w.y) });
          audio.play('ui_click');
        }
        break;
      case 'Tab': H.showCrew = true; break;
      case 'Escape': H.showCrew = false; break;
    }
  });
  window.addEventListener('keyup', (e) => {
    const code = e.code;
    delete Client.keys[code];
    if (code === 'KeyE' && Client.actDown) { Client.actDown = false; send({ t: P.C.ACT || 'act', down: false }); }
    if (code === 'Tab') H.showCrew = false;
    const m = me();
    if (m && m.console) Net.guard('Consoles.keyUp', () => K.keyUp(e, Client.view));
  });
  window.addEventListener('blur', releaseAll);

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / Client.scale, y: (e.clientY - r.top) / Client.scale };
  }
  canvas.addEventListener('mousemove', (e) => { const p = toCanvas(e); Client.mouse.x = p.x; Client.mouse.y = p.y; });
  canvas.addEventListener('mouseleave', () => { Client.mouse.x = -1; Client.mouse.y = -1; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    initAudio();
    const p = toCanvas(e);
    Client.mouse.x = p.x; Client.mouse.y = p.y;
    if (document.activeElement === nameInput) nameInput.blur();
    if (codeInput && document.activeElement === codeInput) codeInput.blur();
    canvas.focus();
    if (e.button === 2) {
      // M1: Rechtsklick in Konsolen (Taktik-Marker, Pin entfernen)
      const m2 = me();
      if (m2 && m2.console) Net.guard('Consoles.mouseDown', () => K.mouseDown(p.x, p.y, Client.view, 2));
      return;
    }
    if (e.button !== 0) return;
    const r = R.clickUi(p.x, p.y);
    if (r === 'ok') { audio.play('ui_click'); return; }
    if (r === 'denied') { audio.play('error'); return; }
    const m = me();
    if (m && m.console) { Net.guard('Consoles.mouseDown', () => K.mouseDown(p.x, p.y, Client.view)); return; }
    if (m && m.zone === 'away' && Client.state && Client.state.phase !== 'lobby') shoot();
  });
  window.addEventListener('mouseup', () => { if (Client.view) Net.guard('Consoles.mouseUp', () => K.mouseUp(Client.view)); });

  // ------------------------------------------------------------------ Simulation (fester Schritt)
  function step(dt) {
    Client.time += dt;
    Net.guard('Hud.update', () => H.update(dt));
    if (Client.shootCd > 0) Client.shootCd -= dt;
    const st = Client.state, m = me(), self = Client.self;
    self.offX *= 0.85; self.offY *= 0.85;
    if (Math.abs(self.offX) < 0.05) self.offX = 0;
    if (Math.abs(self.offY) < 0.05) self.offY = 0;
    if (!st || !m) return;
    if (Client.view && m.console) Net.guard('Consoles.update', () => K.update(dt, Client.view));

    Net.guard('Client.minigame', () => updateMinigame(dt));
    const canMove = st.phase !== 'lobby' && !m.console && !m.downed && !m.lift && Net.isOpen() && self.init && !Client.minigame;
    let { mx, my } = canMove ? moveAxes() : { mx: 0, my: 0 };
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const nonzero = mx !== 0 || my !== 0;
    Client.sendAcc += dt;
    const changed = mx !== Client.lastSent.mx || my !== Client.lastSent.my;
    if (changed || (nonzero && Client.sendAcc >= 1 / 30)) {
      Client.seq++;
      send({ t: P.C.INPUT || 'input', seq: Client.seq, mx, my });
      Client.lastSent = { mx, my };
      Client.sendAcc = 0;
    }
    if (canMove && nonzero) {
      const speed = SPEED * (m.carry ? 0.85 : 1) * (canCrouchHere(m, st) && crouchActive(m) ? crouchFactor() : 1);   // §15: gleicher Faktor wie der Server
      const dx = mx * speed * dt, dy = my * speed * dt;
      const r = Phys.moveWithCollision(isSolidFor(self.zone, st), self.x, self.y, dx, dy, HITBOX);
      self.moving = Math.abs(r.x - self.x) + Math.abs(r.y - self.y) > 0.01;
      self.x = r.x; self.y = r.y;
      Client.pending.push({ seq: Client.seq, dx, dy });
      if (Client.pending.length > 240) Client.pending.shift();
      self.dir = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
      Client.stepT += dt;
      if (self.moving && Client.stepT > 0.32) { Client.stepT = 0; audio.play('step', { volume: 0.35 }); }
    } else {
      self.moving = false;
    }
    if (m.action && m.action.kind === 'repair') {
      Client.repairTickT += dt;
      if (Client.repairTickT > 0.5) { Client.repairTickT = 0; audio.play('repair_tick', { volume: 0.5 }); }
    }
  }

  // ------------------------------------------------------------------ View-Aufbau
  function buildView() {
    const st = Client.state;
    const m = me();
    const self = Client.self;
    const nowMs = performance.now();
    const v = {
      state: st, pid: Client.pid, me: m, time: Client.time, debug: DEBUG,
      self: { x: self.x + self.offX, y: self.y + self.offY, zone: self.zone, dir: self.dir, moving: self.moving },
      mouse: Client.mouse, lobby: Client.lobby, actions, send, audioOn: Client.audioOn,
      players: [], bots: [], enemies: [], spaceProjectiles: [], drones: [], awayProjectiles: [], npc: null, ship: null,
      beamFx: {}, enemyHit: {}, shipHit: null, interaction: null,
    };
    if (!st || st.phase === 'lobby') return v;
    const pair = snapPair(nowMs - INTERP_DELAY) || { a: st, b: st, f: 0 };
    const A = pair.a, B = pair.b, f = pair.f;
    v.players = lerpList(A.players, B.players, f).map(p => p.id === Client.pid ? p : p);
    // eigene Figur: Vorhersage statt Interpolation, restliche Felder aus dem neuesten Snapshot
    if (m) {
      v.players = v.players.filter(p => p.id !== Client.pid);
      const mine = Object.assign({}, m, { x: v.self.x, y: v.self.y, zone: self.zone });
      if (!m.console && !m.downed) { mine.dir = self.dir; mine.moving = self.moving; }
      mine.cr = canCrouchHere(m, st) && crouchActive(m);   // §15: sofort geduckt zeichnen (Vorhersage)
      v.players.push(mine);
    } else v.players = st.players;
    v.bots = lerpList(A.bots, B.bots, f);
    v.shipNpcs = lerpList((A.ship || {}).npcs, (B.ship || {}).npcs, f);
    const as = A.space || {}, bs = B.space || {};
    v.enemies = lerpEnemies(as.enemies, bs.enemies, f, pair.dt, pair.ext);
    v.spaceProjectiles = lerpList(as.projectiles, bs.projectiles, f);
    const aa = A.away || {}, ba = B.away || {};
    v.drones = lerpList(aa.drones, ba.drones, f);
    v.awayProjectiles = lerpList(aa.projectiles, ba.projectiles, f);
    if (ba.npc) {
      v.npc = Object.assign({}, ba.npc);
      if (aa.npc && f > 0 && Math.hypot(aa.npc.x - ba.npc.x, aa.npc.y - ba.npc.y) < 200) { v.npc.x = lerp(aa.npc.x, ba.npc.x, f); v.npc.y = lerp(aa.npc.y, ba.npc.y, f); }
    }
    const sa = A.ship || {}, sb = B.ship || {};
    v.ship = Object.assign({}, sb);
    if (sa.scene === sb.scene && f > 0 && isFinite(sa.x)) { v.ship.x = lerp(sa.x, sb.x, f); v.ship.y = lerp(sa.y, sb.y, f); v.ship.angle = lerpAngle(sa.angle || 0, sb.angle || 0, f); }
    if (!isFinite(v.ship.x)) { v.ship.x = 0; v.ship.y = 0; }
    for (const pid in Client.beamFx) {
      const b = Client.beamFx[pid];
      const p = (nowMs - b.t0) / 1200;
      if (p >= 1) { delete Client.beamFx[pid]; continue; }
      v.beamFx[pid] = 1 - p;
    }
    for (const id in Client.enemyHit) {
      const s = (nowMs - Client.enemyHit[id]) / 1000;
      if (s > 2) delete Client.enemyHit[id]; else v.enemyHit[id] = s;
    }
    v.shieldHit = {};
    for (const pid in Client.shieldHit) {
      const s = (nowMs - Client.shieldHit[pid]) / 1000;
      if (s > 2) delete Client.shieldHit[pid]; else v.shieldHit[pid] = s;
    }
    if (Client.shipHit) v.shipHit = { sector: Client.shipHit.sector, t: (nowMs - Client.shipHit.t0) / 1000 };
    v.interaction = Client.minigame ? null : Net.guard('Client.interaction', () => computeInteraction(st, m, v.self), null);
    v.minigame = Client.minigame;
    if (Client.dodgeFx) { const age = (nowMs - Client.dodgeFx.t0) / 1000; if (age > 2) Client.dodgeFx = null; else v.dodgeFx = { age }; }
    // M3b: Rückschläge der letzten 1,5 s (Render zeichnet den Rückschritt am Balken)
    Client.setbacks = Client.setbacks.filter(s => nowMs - s.t0 < 1500);
    v.setbacks = Client.setbacks.map(s => ({ system: s.system, pid: s.pid, bot: s.bot, age: (nowMs - s.t0) / 1000 }));
    return v;
  }

  // ------------------------------------------------------------------ Zeichnen
  function render() {
    const v = buildView();
    Client.view = v;
    R.beginUi();
    R.ui.mouse = Client.mouse;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // M4: Voxel-Modus – 3D zeichnet die Welt, der HUD-Canvas wird transparent geleert, drawWorld nur als Overlay
    const use3d = drawVoxel(v);
    if (use3d) { v.voxel = true; ctx.clearRect(0, 0, VW, VH); }
    else { ctx.fillStyle = R.PAL.space; ctx.fillRect(0, 0, VW, VH); }
    const st = v.state;
    const lobby = !st || st.phase === 'lobby' || !v.me;
    const codeMode = lobby && Net.status === 'open' && Net.badCode && !v.me;
    nameInput.style.display = lobby && (Net.status === 'open') && !codeMode ? 'block' : 'none';
    if (codeInput) {
      codeInput.style.display = codeMode ? 'block' : 'none';
      if (codeMode && Client.focusCode) { Client.focusCode = false; setTimeout(() => { try { codeInput.focus(); codeInput.select(); } catch (e) { /* egal */ } }, 0); }
    }
    if (lobby) {
      Net.guard('Hud.drawLobby', () => H.drawLobby(ctx, Object.assign({}, v, { state: st || {} })));
      R.drawTooltip(ctx);
    } else {
      const shake = Client.shakeT && performance.now() - Client.shakeT < 250 && v.self.zone === 'ship' && !v.me.console;
      if (shake) ctx.setTransform(1, 0, 0, 1, Math.round(Math.random() * 4 - 2), Math.round(Math.random() * 4 - 2));
      Net.guard('Render.drawWorld', () => R.drawWorld(ctx, v));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      Net.guard('Hud.draw', () => H.draw(ctx, v));
      if (v.me.console) Net.guard('Consoles.draw', () => K.draw(ctx, v));
      else if (Client.minigame) Net.guard('Hud.drawMinigame', () => H.drawMinigame(ctx, v, Client.minigame));
      const ended = st.phase === 'end' || !!(st.mission && st.mission.m1Done);
      if (ended && !Client.endDismissed) Net.guard('Hud.drawEnd', () => H.drawEnd(ctx, v));
      const fl = (performance.now() - Client.flashT) / 400;
      if (fl >= 0 && fl < 1) { ctx.fillStyle = 'rgba(244,238,220,' + (1 - fl) * 0.85 + ')'; ctx.fillRect(0, 0, VW, VH); }
      if (!v.me.console) R.drawTooltip(ctx);
    }
    Net.guard('Hud.drawConnection', () => H.drawConnection(ctx, v));
    if (DEBUG) drawDebug(v);
    if (window.DevMock && DevMock.active) R.text(ctx, 'MOCK · Bild↑/↓ Ort · Pos1 Zone · Ende Reaktor · ' + (DevMock.stageName ? DevMock.stageName() : ''), VW / 2, v.me && v.me.console ? 1 : 1, { color: '#FF66CC', align: 'center' });
  }

  // M4: 3D-Frame, wenn VoxelRender bereit ist, der Voxel-Modus gewählt ist und 3D die Zone bedient
  // (nicht in Lobby und Konsolen-Vollbild). Liefert true, wenn 3D gezeichnet hat.
  function drawVoxel(v) {
    const VR = window.VoxelRender;
    if (!VR) return false;
    if (VR.notice) { const n = VR.notice; VR.notice = null; Net.guard('Hud.pushNotice', () => H.pushNotice(n, R.PAL.warn)); }
    let ok = false;
    if (VR.ready && VR.mode === 'voxel' && v.state && v.state.phase !== 'lobby' && v.me && !v.me.console) {
      const zone = VR.zoneOf(v);
      if (zone && VR.handles(zone)) ok = !!Net.guard('Voxel.frame', () => VR.frame(v, Client.frameDt || STEP), false);
    }
    if (!ok && VR.hide) VR.hide();
    return ok;
  }

  function drawDebug(v) {
    const st = v.state || {};
    const lines = [
      'FPS ' + Client.fps + '  Ping ' + Net.ping + ' ms' + (Net.lag ? '  (Lag ' + Net.lag + ' / Verlust ' + Net.loss + ' %)' : ''),
      'Tick ' + (st.tick || 0) + '  Stage ' + ((st.mission && st.mission.stage) || '-') + '  Phase ' + (st.phase || '-'),
      'Fehler Client ' + G.errors + '  Server ' + (st.errors || 0) + '  Snap ' + (Net.stats.lastSnapBytes / 1024).toFixed(1) + ' KB',
      'Pos ' + Math.round(v.self.x) + ',' + Math.round(v.self.y) + ' ' + v.self.zone + '  offen ' + Client.pending.length + '  seq ' + Client.seq,
      Client.serverDebug ? 'Debug-Server: F6 = Stage überspringen' : 'Server ohne --debug',
    ];
    // QA M1: An Konsolen nur eine kompakte Zeile oben mittig – sonst verdeckt das Overlay die Seitenpanels.
    const me = (st.players || []).find(p => p.id === Client.pid);
    if (me && me.console) {
      const line = 'FPS ' + Client.fps + ' · Ping ' + Net.ping + ' · Fehler ' + G.errors + '/' + (st.errors || 0) + ' · ' + ((st.mission && st.mission.stage) || '-');
      const w = R.measure ? R.measure(line, 1) + 8 : 220;
      R.backdrop(ctx, 320 - w / 2, 1, w, 10, 0.75);
      R.text(ctx, line, 320, 2, { color: '#FF66CC', shadow: false, align: 'center' });
      return;
    }
    R.backdrop(ctx, 2, 150, 260, lines.length * 10 + 4, 0.8);
    lines.forEach((l, i) => R.text(ctx, l, 4, 152 + i * 10, { color: '#FF66CC', shadow: false }));
    const failed = Object.keys(R.artFail);
    if (failed.length) R.text(ctx, 'Art-Fallback: ' + failed.join(', ').slice(0, 90), 4, 154 + lines.length * 10, { color: R.PAL.warn });
  }

  // M2: Debug-Befehlszeile -> { t: 'debug', cmd, args, …benannte Felder } (Felder wie die vorhandenen Befehle)
  function parseDebugLine(line) {
    const parts = String(line || '').trim().replace(/^\//, '').split(/\s+/).filter(Boolean);
    if (!parts.length) return null;
    const num = (s) => (s != null && s !== '' && isFinite(+s)) ? +s : s;
    const cmd = parts[0].toLowerCase(), args = parts.slice(1);
    const msg = { t: 'debug', cmd, args: args.map(num) };
    switch (cmd) {
      case 'tune':
        if (args[0]) msg.path = args[0];
        if (args.length > 1) msg.value = num(args[1]);
        break;
      case 'squad': msg.squad = num(args[0] || '1'); break;
      case 'shield': msg.n = num(args[0] != null ? args[0] : 3); break;
      case 'mission': msg.id = args[0] || 'm3'; if (args[1]) msg.step = args[1]; break;
      case 'stage': msg.stage = args[0]; break;
      case 'goto': msg.loc = args[0]; msg.docked = args[1] === 'docked' || args[1] === '1'; break;
      case 'reveal': msg.loc = args[0] || 'all'; break;
      case 'reactor': msg.state = args[0]; break;
      case 'inv': msg.item = args[0]; msg.n = num(args[1]); break;
      case 'marks': case 'hull': msg.n = num(args[0]); break;
      case 'god': msg.on = !(args[0] === 'off' || args[0] === '0'); break;
      case 'spawn': msg.kind = args[0]; break;
      case 'damage': msg.system = args[0]; msg.state = args[1]; break;
      // M3a §17
      case 'fragile': msg.system = args[0]; break;
      case 'tele': if (args[0]) msg.id = args[0]; break;
      default: break;
    }
    return msg;
  }

  // ------------------------------------------------------------------ Loop
  let acc = 0, lastT = performance.now(), fpsN = 0, fpsT = 0;
  function frame(now) {
    const dt = Math.min(0.25, (now - lastT) / 1000);
    lastT = now;
    Client.frameDt = dt;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 15) { Net.guard('Client.step', () => step(STEP)); acc -= STEP; n++; }
    if (n >= 15) acc = 0;
    Net.guard('Client.render', render);
    Net.guard('Client.ambience', updateAmbience);
    fpsN++; fpsT += dt;
    if (fpsT >= 1) { Client.fps = Math.round(fpsN / fpsT); G.fps = Client.fps; fpsN = 0; fpsT = 0; }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ Start
  function boot() {
    layout();
    if (window.Art && typeof Art.init === 'function') Net.guard('Art.init', () => Art.init());
    H.onTypeTick = () => audio.play('oda_blip', { volume: 0.25 });
    Object.defineProperty(G, 'view', { get: () => Client.view, configurable: true });
    G.client = Client;
    G.debugCmd = (cmd, extra) => send(Object.assign({ t: 'debug', cmd }, extra || {}));
    // M2: Debug-Zeile parsen und senden (tune/kesh/squad/wake/shield/wound + alle bisherigen Befehle)
    G.dbg = (line) => { const msg = parseDebugLine(line); if (msg) send(msg); return msg; };
    G.tune = (path, value) => G.dbg('tune' + (path ? ' ' + path : '') + (value != null ? ' ' + value : ''));
    G.parseDebugLine = parseDebugLine;
    Net.connect();
    requestAnimationFrame(frame);
  }

  window.Client = Client;
  Client.actions = actions;
  Client.audio = audio;
  boot();
})();
