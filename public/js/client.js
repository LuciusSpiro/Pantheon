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
    shootCd: 0, stepT: 0, repairTickT: 0, fireHeld: { mouse: false, key: false },
    // S2: neue Angebote (id -> Zeitpunkt offerIn), Schützling-Treffer (id -> performance.now()), letzte Befehlsrückmeldung, Kapitelkarte
    newOffers: {}, escortHit: {}, escortOrder: null, chapter: null,
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
    applyAudioOptions();
    audio.mood = null;
  }

  // ------------------------------------------------------------------ Hilfen
  function me() { const s = Client.state; return s && s.players ? s.players.find(p => p.id === Client.pid) || null : null; }
  function send(msg) { return Net.send(msg); }
  G.send = send;

  function isSolidFor(zone, st) {
    const map = R.mapFor(zone, st);
    if (zone === 'away' && (map.id === 'kesh' || R.isBuehne(map))) return R.solidFn(map, st);   // B1: Türen nach Zustand   // M2: Tor offen = begehbar, low-Kacheln solid
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

  // ------------------------------------------------------------------ S1: Optionen (localStorage 'pantheon.options', je Spieler)
  const OPT_KEY = 'pantheon.options';
  function loadOptions() {
    const o = { volume: 0.8, muted: false, render: null, saved: true };
    let raw = null;
    try { raw = localStorage.getItem(OPT_KEY); } catch (e) { Net.reportError('Options.load', e); o.saved = false; }
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          if (d.volume != null && isFinite(+d.volume)) o.volume = clamp(+d.volume, 0, 1);
          if (typeof d.muted === 'boolean') o.muted = d.muted;
          if (d.render === 'voxel' || d.render === '2d') o.render = d.render;
        }
      } catch (e) { Net.reportError('Options.parse', e); }
    }
    return o;
  }
  function saveOptions() {
    const o = Client.options;
    try { localStorage.setItem(OPT_KEY, JSON.stringify({ volume: o.volume, muted: o.muted, render: o.render })); o.saved = true; }
    catch (e) { Net.reportError('Options.save', e); o.saved = false; }
  }
  function applyAudioOptions() {
    const GA = window.GameAudio;
    if (!GA) return;
    const o = Client.options;
    if (typeof GA.setVolume === 'function') Net.guard('GameAudio.setVolume', () => GA.setVolume(o.volume));
    // ART-AUDIO: setMuted(bool) bevorzugen (das alte mute() ohne Argument schaltet stumm)
    if (typeof GA.setMuted === 'function') Net.guard('GameAudio.setMuted', () => GA.setMuted(o.muted));
    else if (typeof GA.mute === 'function') Net.guard('GameAudio.mute', () => GA.mute(!!o.muted));
  }
  // Voxel/2D: vorhandenen Umschalter (voxel/boot.js: VoxelRender.setMode) benutzen; F8 bleibt gleichwertig
  function syncRenderOption() {
    const VR = window.VoxelRender;
    if (!VR || typeof VR.setMode !== 'function') return;
    const o = Client.options;
    if (!Client.renderApplied) {
      Client.renderApplied = true;
      if (!params.get('render') && o.render && VR.mode !== o.render) Net.guard('Voxel.setMode', () => VR.setMode(o.render));
      return;
    }
    // S1-QA: nur echte Umschaltungen (F8, Optionen) merken – nicht den Startmodus aus der URL (?render=2d), sonst
    // überschreibt ein Testlink die gespeicherte Wahl des Spielers
    const settled = !VR.failed && (VR.mode === 'voxel' || VR.mode === '2d');
    if (!settled) return;
    if (Client.renderSeen == null) { Client.renderSeen = VR.mode; return; }
    if (VR.mode !== Client.renderSeen) {
      Client.renderSeen = VR.mode;
      if (VR.mode !== o.render) { o.render = VR.mode; saveOptions(); }
    }
  }
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen() {
    try {
      if (isFullscreen()) { const ex = document.exitFullscreen || document.webkitExitFullscreen; if (ex) ex.call(document); return; }
      const el = document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!fn) { H.pushNotice('Vollbild wird hier nicht unterstützt', R.PAL.warn); return; }
      const p = fn.call(el);
      if (p && typeof p.catch === 'function') p.catch((e) => { Net.reportError('Fullscreen', e); H.pushNotice('Vollbild nicht möglich', R.PAL.warn); });
    } catch (e) { Net.reportError('Fullscreen', e); }
  }
  Client.options = loadOptions();

  // ------------------------------------------------------------------ S1: Menüseiten (Hauptmenü-Overlays + Spielmenü)
  // ui.stack: oberste Seite ist offen ('menu' | 'options' | 'controls' | 'confirmEnd' | 'worlds'); Esc geht eine Seite zurück.
  Client.ui = { stack: [], sel: {}, worldsMode: 'list', hold: null, pauseSent: false };
  function uiTop() { const s = Client.ui.stack; return s.length ? s[s.length - 1] : null; }
  function soloNow() { const st = Client.state; return !!st && (st.players || []).filter(p => p.connected !== false).length === 1; }
  function inGame() { const st = Client.state; return !!(st && st.phase !== 'lobby' && me()); }
  function sendPause(on) { send({ t: (P.C && P.C.MENU) || 'menu', op: 'pause', on: !!on }); }
  function uiPush(page, sel) {
    const ui = Client.ui;
    if (!ui.stack.length) {
      releaseAll();
      try { if (document.activeElement === nameInput || (codeInput && document.activeElement === codeInput)) document.activeElement.blur(); canvas.focus(); } catch (e) { /* egal */ }
      // Kai: das Spielmenü hält das Spiel nur solo an
      if (page === 'menu' && inGame() && soloNow()) { sendPause(true); ui.pauseSent = true; }
    }
    ui.stack.push(page);
    ui.sel[page] = sel == null ? 0 : sel;
  }
  function uiClosed() {
    const ui = Client.ui;
    ui.hold = null;
    if (ui.pauseSent) { ui.pauseSent = false; if (inGame()) sendPause(false); }
  }
  function uiBack() {
    const ui = Client.ui;
    ui.stack.pop();
    if (!ui.stack.length) uiClosed();
    audio.play('ui_back');
  }
  function uiCloseAll(silent) {
    const ui = Client.ui;
    if (!ui.stack.length) return;
    ui.stack = [];
    uiClosed();
    if (!silent) audio.play('ui_back');
  }
  function openWorlds(mode) {
    const st = Client.state;
    if (!st || !me()) return;
    Client.ui.worldsMode = mode === 'full' ? 'full' : 'list';
    const rows = H.worldRows(st, Client.ui);
    let sel = 0;
    if (mode === 'full') sel = Math.max(0, rows.length - 1);   // ältester vorausgewählt (Liste: neueste zuerst)
    else { const i = rows.findIndex(r => r.id != null && r.id === (st.lobby && st.lobby.world)); sel = i >= 0 ? i : 0; }
    if (uiTop() === 'worlds') { Client.ui.sel.worlds = sel; return; }
    uiPush('worlds', sel);
    audio.play('ui_click');
  }
  function worldsItems() { return H.worldRows(Client.state, Client.ui); }
  function chooseWorldRow(row) {
    const st = Client.state || {};
    if (!row) return;
    if (row.neu) {
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', world: null });
      uiCloseAll(true); audio.play('ui_click');
      return;
    }
    const w = row.w || {};
    if (w.state && w.state !== 'ok') {
      H.pushNotice('Nicht ladbar: ' + (H.WORLD_STATE_TEXT[w.state] || w.state) + (w.grund ? ' – ' + w.grund : ''), R.PAL.warn, 4);
      audio.play('error');
      return;
    }
    send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', world: row.id });
    if (st.lobby && st.lobby.worldsFull && Client.ui.worldsMode === 'full') H.pushNotice('Fortsetzen statt neu: ' + (w.name || row.id), R.PAL.mint);
    uiCloseAll(true); audio.play('ui_click');
  }
  function startDelete(id, viaMouse) {
    const row = worldsItems().find(r => r.id === id && !r.neu);
    if (!row) return;
    if (row.w && row.w.state === 'belegt') { H.pushNotice('Dieser Weltstand ist gerade in einer anderen Runde geöffnet.', R.PAL.warn); audio.play('error'); return; }
    Client.ui.hold = { id, t: 0, sent: false, mouse: !!viaMouse };
  }
  function updateHold(dt) {
    const h = Client.ui.hold;
    if (!h || uiTop() !== 'worlds') { if (h && uiTop() !== 'worlds') Client.ui.hold = null; return; }
    h.t += dt;
    const need = (CFG.menu && CFG.menu.deleteHold) || 1;
    if (!h.sent && h.t >= need) {
      h.sent = true;
      send({ t: (P.C && P.C.WORLD) || 'world', op: 'delete', id: h.id });
      audio.play('save_delete');
      Client.ui.deletedAt = performance.now();
    }
    if (h.sent && h.t > need + 0.6) Client.ui.hold = null;
  }
  function endInfo() {
    const st = Client.state || {};
    const lob = Client.lastLobby || {};
    const start = lob.startMission || 'm1';
    // QA-Abnahme S1: Server-Feld `campaign` (im Spiel immer da) hat Vorrang – Spät-Beitretende kennen die Lobby-Wahl nicht
    const campaign = typeof st.campaign === 'boolean' ? st.campaign : (lob.world != null || start === 'm1' || start === 'free');
    const ship = st.ship || {};
    return { campaign, docked: !!(ship.dockedAt || ship.docked) };
  }
  function uiActivate(page, id) {
    switch (page) {
      case 'menu':
        if (id === 'resume') uiCloseAll();
        else if (id === 'options') { uiPush('options'); audio.play('ui_click'); }
        else if (id === 'controls') { uiPush('controls'); audio.play('ui_click'); }
        else if (id === 'end') { uiPush('confirmEnd', 0); audio.play('ui_click'); }
        break;
      case 'confirmEnd':
        if (id === 'end') {
          send({ t: (P.C && P.C.MENU) || 'menu', op: 'end' });
          Client.ui.pauseSent = false;   // der Server setzt ohnehin zurück
          uiCloseAll(true);
          audio.play('ui_click');
        } else uiBack();
        break;
      case 'options':
        if (id === 'back') uiBack(); else uiOption(id, 0);
        break;
      case 'controls': uiBack(); break;
      case 'worlds': {
        if (id === 'back') { uiBack(); break; }
        const row = worldsItems().find(r => r.id === id) || (id == null ? worldsItems().find(r => r.neu) : null);
        chooseWorldRow(row);
        break;
      }
    }
  }
  function uiOption(id, dir) {
    const o = Client.options;
    if (id === 'volume') {
      if (!dir) return;
      o.volume = clamp(Math.round((o.volume + dir * 0.1) * 10) / 10, 0, 1);
      if (o.volume > 0 && o.muted && dir > 0) o.muted = false;
      applyAudioOptions(); saveOptions(); audio.play('ui_click');
    } else if (id === 'mute') {
      o.muted = !o.muted; applyAudioOptions(); saveOptions();
      if (!o.muted) audio.play('ui_click');
    } else if (id === 'render') {
      const VR = window.VoxelRender;
      if (!VR || typeof VR.setMode !== 'function') { H.pushNotice('Darstellung: Umschalter noch nicht geladen', R.PAL.warn); return; }
      const want = dir < 0 ? '2d' : dir > 0 ? 'voxel' : (VR.mode === 'voxel' ? '2d' : 'voxel');
      const got = Net.guard('Voxel.setMode', () => VR.setMode(want), VR.mode);
      o.render = got === 'voxel' || got === '2d' ? got : want; saveOptions();
      if (want === 'voxel' && got !== 'voxel') H.pushNotice('Voxel nicht verfügbar – bleibt 2D', R.PAL.warn);
      audio.play('ui_click');
    } else if (id === 'fullscreen') { toggleFullscreen(); audio.play('ui_click'); }
  }
  function uiKey(e) {
    const page = uiTop();
    const code = e.code;
    const ui = Client.ui;
    if (code === 'Escape') { if (!e.repeat) uiBack(); return; }
    const items = page === 'worlds' ? worldsItems() : H.pageItems(page, Client.view || {});
    const n = items.length;
    let sel = clamp(ui.sel[page] || 0, 0, Math.max(0, n - 1));
    const up = code === 'KeyW' || code === 'ArrowUp', down = code === 'KeyS' || code === 'ArrowDown';
    const left = code === 'KeyA' || code === 'ArrowLeft', right = code === 'KeyD' || code === 'ArrowRight';
    if (page === 'confirmEnd' && (left || right || up || down)) { ui.sel[page] = sel === 0 ? 1 : 0; audio.play('ui_click', { volume: 0.5 }); return; }
    if ((up || down) && n) { ui.sel[page] = (sel + (up ? -1 : 1) + n) % n; ui.hold = null; audio.play('ui_click', { volume: 0.5 }); return; }
    if (page === 'options' && (left || right)) { uiOption(items[sel], left ? -1 : 1); return; }
    if (code === 'KeyO' && page !== 'options' && page !== 'worlds') { uiPush('options'); audio.play('ui_click'); return; }
    if (e.repeat) return;
    if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') {
      if (page === 'worlds') { chooseWorldRow(items[sel]); return; }
      uiActivate(page, items[sel]);
      return;
    }
    if (page === 'worlds' && code === 'Delete') { const r = items[sel]; if (r && !r.neu) startDelete(r.id, false); return; }
  }

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
      // S1: Neue Kampagne bei vollen Weltständen -> Löschdialog (ältester vorausgewählt)
      const lob = (Client.state && Client.state.lobby) || {};
      const start = lob.startMission || 'm1';
      if (!m.ready && lob.worldsFull && lob.world == null && (start === 'm1' || start === 'free')) {
        H.pushNotice('Erst einen Weltstand löschen (höchstens ' + H.worldsMax() + ')', R.PAL.warn, 4);
        openWorlds('full');
        audio.play('error');
        return;
      }
      send({ t: P.C.READY || 'ready', ready: !m.ready });
      audio.play('ui_click');
    },
    // S1: Overlays und Menü (Maus über Hud-Knöpfe)
    openWorlds(mode) { openWorlds(mode); },
    openOptions() { if (uiTop() !== 'options') { uiPush('options'); audio.play('ui_click'); } },
    uiActivate(page, id) { uiActivate(page, id); },
    uiSelect(page, i) { Client.ui.sel[page] = i; },
    uiOption(id, dir) { uiOption(id, dir); },
    uiPick(page, i) {
      // Klick auf eine Zeile: wählt sie; zweiter Klick auf dieselbe Zeile = Enter
      const ui = Client.ui;
      if ((ui.sel[page] || 0) === i && performance.now() - (ui.pickT || 0) < 600) { const r = worldsItems()[i]; if (r) chooseWorldRow(r); return; }
      ui.sel[page] = i; ui.pickT = performance.now(); ui.hold = null;
    },
    holdDelete(id) { startDelete(id, true); },
    dismissEnd() { Client.endDismissed = true; audio.play('ui_back'); },
    closeChapter() { if (Client.chapter) { Client.chapter = null; audio.play('ui_back'); } },   // S2: Kapitelkarte schließen
    // M0: Hafen-Übung überspringen (jeder darf umschalten, Server hält den Zustand)
    toggleSkipDrill() {
      const st = Client.state;
      const cur = !!(st && st.lobby && st.lobby.skipDrill);
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', skipDrill: !cur });
      audio.play('ui_click');
    },
    // M2: Start „Kampagne“ (m1), „Direkt zur Planetenmission“ (m3) oder Testgelände (arena_space/arena_away) –
    // jeder darf umschalten, M schaltet reihum weiter (AP3a: Reihenfolge Protocol.LOBBY_MODI, Labor nur mit lobby.laborAn)
    toggleStartMission() {
      const st = Client.state;
      const cur = (st && st.lobby && st.lobby.startMission) || 'm1';
      if (st && st.lobby && st.lobby.world != null && H.lobbyWorld(st)) { H.pushNotice('Startauswahl entfällt beim Fortsetzen (F: „Neue Kampagne“ wählen)', R.PAL.warn); audio.play('error'); return; }
      const list = H.startList(st);   // S1: inkl. 'free' (Kampagne ohne Tutorial); AP3a: LOBBY_MODI
      const next = list[(list.indexOf(cur) + 1) % list.length];
      const msg = { t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', startMission: next };
      // Bodenkampf: Wellen – die Kartenwahl geht immer mit (ohne sie startet der Server den Altweg Kesh/m3)
      if (next === 'arena_away') msg.wellen = (st && st.lobby && st.lobby.wellen) || (P.WELLEN_KARTEN || ['aussenposten'])[0];
      send(msg);
      audio.play('ui_click');
    },
    // AP3a: Szenario-Labor – Auswahl (↑/↓) und Parameter (R Seed, ←/→ Stärke, G god); jeder darf umschalten
    laborWahl(dir) {
      const lob = Client.state && Client.state.lobby;
      if (!lob || lob.startMission !== 'labor' || !Array.isArray(lob.laborListe) || !lob.laborListe.length) return;
      const l = lob.laborListe, cur = lob.labor && lob.labor.id;
      const i = Math.max(0, l.findIndex(e => e.id === cur));
      const next = l[(i + dir + l.length) % l.length];
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', labor: { id: next.id } });
      audio.play('ui_click');
    },
    laborSeed() {
      const lob = Client.state && Client.state.lobby;
      if (!lob || lob.startMission !== 'labor') return;
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', labor: { seed: 1 + Math.floor(Math.random() * 99999) } });
      audio.play('ui_click');
    },
    laborStaerke(dir) {
      const lob = Client.state && Client.state.lobby;
      if (!lob || lob.startMission !== 'labor') return;
      const list = [null].concat(P.LABOR_STAERKEN || ['klein', 'mittel', 'gross']);   // null = Testwert der Umsetzung
      const cur = list.indexOf((lob.labor && lob.labor.staerke) || null);
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', labor: { staerke: list[(Math.max(0, cur) + dir + list.length) % list.length] } });
      audio.play('ui_click');
    },
    laborGod() {
      const lob = Client.state && Client.state.lobby;
      if (!lob || lob.startMission !== 'labor') return;
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', labor: { god: !(lob.labor && lob.labor.god) } });
      audio.play('ui_click');
    },
    // AP3a: eigene Waffe für Wellen Boden und Labor (Taste W) – gesetzt beim Start, vor dem Beamen
    lobbyWaffe() {
      const st = Client.state, lob = st && st.lobby, m = me();
      if (!lob || !m || (lob.startMission !== 'arena_away' && lob.startMission !== 'labor')) return;
      const list = P.WAFFEN_WAHL || ['blaster', 'sturmgewehr', 'granatwerfer', 'lanze', 'nahkampf', 'betaeuber'];
      const cur = lob.waffen && lob.waffen[m.id];
      const next = cur ? list[(list.indexOf(cur) + 1) % list.length] : list[0];
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', waffe: next });
      audio.play('ui_click');
    },
    // Bodenkampf: Wellen – nach der Ergebnisanzeige sofort zurück in die Lobby (wie „Partie beenden“)
    wellenLobby() { send({ t: (P.C && P.C.MENU) || 'menu', op: 'end' }); audio.play('ui_click'); },
    // Bodenkampf: Wellen – Karte reihum (Taste K / Klick); jeder darf umschalten, alle sehen die Wahl
    toggleWellenKarte() {
      const st = Client.state;
      if (!st || !st.lobby || st.lobby.startMission !== 'arena_away') return;
      const list = P.WELLEN_KARTEN || ['aussenposten', 'station', 'ruine', 'schiff', 'kesh'];
      const cur = st.lobby.wellen;
      const next = cur ? list[(list.indexOf(cur) + 1) % list.length] : list[0];
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', wellen: next, arena: null });   // eigene Kartenwahl ersetzt eine URL-Karte
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
        // W1 AP1: Das Debug-Overlay zeigt die KI-Rolle (away.drones[].role). Der Server sendet sie nur mit
        // CONFIG.debug.snapKiRolle – mit ?debug=1 am Debug-Server schaltet der Client ihn ein (gilt für den Serverprozess).
        if (DEBUG && Client.serverDebug) send({ t: 'debug', cmd: 'tune', path: 'debug.snapKiRolle', value: 'on' });
        Client.self.init = false;
        Net.guard('Client.sektorkarte', () => setzeSektorkarte(msg.sektorkarte));   // B3 §6
        Client.arenaSent = false; Client.awayMapAsk = {};
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
        if (msg.code === 'worldbusy') {   // S1: Weltstand in einer anderen Runde geöffnet
          Client.ui.hold = null;
          H.pushNotice(msg.text || 'Dieser Weltstand ist gerade in einer anderen Runde geöffnet.', R.PAL.warn, 4);
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
      // B1 §6.1: transfer { lp, ziel } kommt nur bei Änderung bzw. alle 15 Snapshots – behalten, solange der Ort gleich ist
      if (!s.transfer && prev.transfer && s.phase !== 'lobby' && prev.ship && s.ship && prev.ship.scene === s.ship.scene) s.transfer = prev.transfer;
      // B3 §6: world.sektoren kommt nur bei Versionswechsel – letzten Stand behalten (wie locations)
      if (s.world && !s.world.sektoren && prev.world.sektoren && s.phase !== 'lobby') s.world = Object.assign({}, s.world, { sektoren: prev.world.sektoren });
    }
    // Logbuch kommt ebenfalls nur mit den Ortsdaten
    if (s.mission && !s.mission.log && prev && prev.mission && prev.mission.log) s.mission.log = prev.mission.log;
    // §21.2: Missionsbuch kommt nur bei Änderung (version) – sonst das letzte behalten
    if (s.mission && !s.mission.book && prev && prev.mission && prev.mission.book) s.mission.book = prev.mission.book;
    // S1 (Kann): Chronik kommt im Log-Slot – ebenfalls behalten
    if (s.mission && !s.mission.chronik && prev && prev.mission && prev.mission.chronik && prev.phase !== 'lobby') s.mission.chronik = prev.mission.chronik;
    Client.state = s; G.state = s; R.lastState = s;
    Net.guard('Client.phaseS1', () => onPhaseS1(prev, s));
    Net.guard('Client.planningS2', () => onPlanningS2(prev, s));
    const now = performance.now();
    Client.snaps.push({ t: now, s });
    while (Client.snaps.length > 3 && now - Client.snaps[1].t > 1000) Client.snaps.shift();
    if (Client.snaps.length > 40) Client.snaps.shift();
    if (prev && prev.phase !== 'end' && s.phase === 'end') Client.endDismissed = false;
    Net.guard('Client.reconcile', () => reconcile(s));   // F7: ein Fehler hier darf diff/snapB nicht dauerhaft abschneiden
    Net.guard('Client.diff', () => diffState(prev, s));
    Net.guard('Client.snapB', () => onSnapB(prev, s));
  }

  // ------------------------------------------------------------------ B1: gebaute Karten, Testgelände-Direktstart, Prefetch
  // URL ?arena=away&art=…&seed=…&bauweise=…&besitz=…&zustand=…[&fraktion&staerke&haltung] -> lobbyOpt { startMission: 'arena_away', arena }
  const ARENA_URL = (function () {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('arena') !== 'away' || !q.get('art')) return null;
      const a = {};
      for (const k of (P.ARENA_AWAY_FIELDS || ['art', 'schablone', 'seed', 'bauweise', 'besitz', 'zustand', 'fraktion', 'staerke', 'haltung'])) {
        const v = q.get(k); if (v != null && v !== '') a[k] = k === 'seed' && isFinite(+v) ? +v : v;
      }
      // Bodenkampf: Wellen auf genau dieser Karte (fester Seed); statische Karten-QA mit &wellen=0 bzw. mit fraktion
      Object.defineProperty(a, 'wellen', { value: q.get('wellen') === '0' || a.fraktion ? null : a.art, enumerable: false });
      return a;
    } catch (e) { return null; }
  })();
  function onSnapB(prev, s) {
    { const m = me(); if (m && m.wf) K.myWaffe = m.wf; }   // B2: zuletzt bekannte eigene Waffe (an Bord fehlt wf im Snapshot)
    if (s.phase === 'lobby' && ARENA_URL && !Client.arenaSent) {
      Client.arenaSent = true;
      // F16: Testgelände startet nie einen gemerkten Weltstand (Server stellt nach „Partie beenden“ den vorigen wieder ein)
      send({ t: (P.C && P.C.LOBBY_OPT) || 'lobbyOpt', startMission: 'arena_away', arena: ARENA_URL, world: null, wellen: ARENA_URL.wellen });
    }
    // Karte fehlt oder kv passt nicht -> awayMap.get (höchstens alle 2 s je Karte)
    const aw = s.away;
    const id = aw && aw.map;
    if (id && ['platform', 'wreck', 'kesh'].indexOf(id) < 0 && s.phase !== 'lobby') {
      const m = Maps[id];
      const ok = m && m.buehne && (aw.kv == null || m.kv === aw.kv);
      if (!ok) {
        const ask = Client.awayMapAsk || (Client.awayMapAsk = {});
        const now = performance.now();
        if (!ask[id] || now - ask[id] > 2000) { ask[id] = now; send({ t: 'cmd', c: (P.CMD_AWAY_MAP_GET || 'awayMap.get'), id }); }
      }
    }
    // Nachtrag: VoxelKit.prefetch beim Betreten der Transferkammer (läuft dort nur einmal)
    if (!Client.kitPrefetch && window.VoxelKit && typeof window.VoxelKit.prefetch === 'function') {
      const m = me();
      if (m && m.zone === 'ship' && Maps.roomAt) {
        const r = Maps.roomAt(Math.floor(m.x / TILE), Math.floor(m.y / TILE));
        if (r && (r.id === 'transfer' || (r.room && r.room.id === 'transfer'))) { Client.kitPrefetch = true; try { window.VoxelKit.prefetch(); } catch (e) { Net.reportError('VoxelKit.prefetch', e); } }
      }
    }
  }

  // B3 §6: Sektorkarte aus dem welcome an Shared_Sektoren (setzt dort auch die Ort-Links) und an StarMap
  function setzeSektorkarte(k) {
    if (!k || typeof k !== 'object' || !k.hexe) return;
    const SS = window.Shared_Sektoren;
    if (SS && typeof SS.setzeKarte === 'function' && SS.KARTE !== k) SS.setzeKarte(k);
    if (window.StarMap && typeof window.StarMap.setKarte === 'function') window.StarMap.setKarte(k);
  }

  // S1: Lobby-Auswahl merken (für den Hinweis beim Beenden), Overlays bei Phasenwechsel schließen
  function onPhaseS1(prev, s) {
    if (s.phase === 'lobby' && s.lobby) Client.lastLobby = { startMission: s.lobby.startMission, world: s.lobby.world == null ? null : s.lobby.world };
    const wasLobby = !prev || prev.phase === 'lobby';
    const isLobby = s.phase === 'lobby';
    if (prev && wasLobby !== isLobby) { Client.ui.pauseSent = false; uiCloseAll(true); }
    const ui = Client.ui;
    if (isLobby && uiTop() === 'worlds') {
      const n = worldsItems().length;
      ui.sel.worlds = clamp(ui.sel.worlds || 0, 0, Math.max(0, n - 1));
      // Löschdialog: Platz frei -> schließen
      if (ui.worldsMode === 'full' && s.lobby && !s.lobby.worldsFull && prev && prev.lobby && prev.lobby.worldsFull) {
        uiCloseAll(true);
        H.pushNotice('Platz frei – „Bereit melden“ startet die neue Kampagne', R.PAL.mint, 4);
      }
    }
    // Solo-Pause: kommt ein zweiter Spieler dazu, gilt die Pause nicht mehr (der Server entscheidet; Client fragt nicht erneut)
    if (ui.pauseSent && !isLobby && !soloNow()) ui.pauseSent = false;
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

  // S2 (CONTRACT-S2 §4/§7): Töne nur, wenn die Audio-Bibliothek sie kennt (fehlen sie, passiert nichts)
  function s2Sfx(name, opts) {
    if (!audio.has()) return;
    const list = window.GameAudio && GameAudio.SOUNDS;
    if (Array.isArray(list) && list.indexOf(name) < 0) return;
    audio.play(name, opts);
  }
  function escortById(id) { const l = (Client.state && Client.state.space && Client.state.space.escorts) || []; return l.find(e => e && e.id === id) || null; }
  function escortLabel(id) { const e = escortById(id); return e ? R.escortName(e) : 'Schützling'; }
  function pct(f) { return Math.round(Math.max(0, Math.min(1, +f || 0)) * 100) + ' %'; }
  // S2: Spielleiter-Angebote, Kapitelkarte, Schützling
  function onEventS2(ev) {
    const PAL = R.PAL;
    switch (ev.kind) {
      // Töne offer_in, escort_hit, distress, escort_lost, escort_saved schickt der Server per sfx (hier keine Doppelung)
      case 'offerIn':
        Client.newOffers[ev.id] = performance.now();
        if (K.seenOffers) delete K.seenOffers[ev.id];   // Bernstein-Punkt „neu“ im Missionsbuch
        H.pushNotice('Neues Angebot im Missionsbuch: ' + String(ev.title || ev.id || '').slice(0, 40) + (ev.from ? ' – ' + ev.from : ''), PAL.amber, 4);
        return true;
      case 'escortSpawn': {
        const e = ev.escort || ev;
        if (e && (e.name || e.id)) H.pushNotice('Schützling: ' + (e.name || escortLabel(e.id)) + ' – bleibt in seiner Nähe', R.ESCORT_COL.ice, 4);
        return true;
      }
      case 'escortShielded': {
        const id = ev.id || (ev.escort && ev.escort.id);
        if (id) H.pushNotice('Abgefangen! Die Lerche deckt ' + escortLabel(id), PAL.mint, 3);
        return true;
      }
      case 'escortRebuke': case 'enemyLeft': return true;   // Funk-Rüffel kommt als radio; abgezogene Gegner verschwinden einfach
      case 'enemyRetreat': H.pushNotice('Die Angreifer drehen ab', PAL.mint, 3); return true;
      case 'sceneWait':
        // keine Sperre: nur eine ODA-Zeile
        H.pushOda('Kurs wird berechnet …' + (ev.sec > 0 ? ' (höchstens ' + Math.ceil(+ev.sec) + ' s)' : ''));
        return true;
      case 'chapter':
        Client.chapter = { title: String(ev.title || 'Kapitel abgeschlossen'), text: String(ev.text || ''), t0: performance.now() };
        return true;
      case 'escortHit':
        Client.escortHit[ev.id] = performance.now();
        return true;
      case 'escortDistress':
        H.pushNotice('NOTRUF: ' + escortLabel(ev.id) + ' – Hülle ' + pct(ev.hpFrac), PAL.red, 4);
        return true;
      case 'escortDisabled':
        H.pushNotice(escortLabel(ev.id) + ' ist kampfunfähig', PAL.red, 5);
        return true;
      case 'escortArrived':
        H.pushNotice(escortLabel(ev.id) + ' hat das Ziel erreicht', PAL.mint, 4);
        return true;
      case 'escortSaved':
        H.pushNotice(escortLabel(ev.id) + ' ist in Sicherheit', PAL.mint, 4);
        return true;
      case 'escortOrder':
        // ok:false = verweigert (Funktext kommt vom Server), ok:true + delay = gehorcht nach delay s
        Client.escortOrder = { id: ev.id, befehl: ev.befehl, ok: ev.ok !== false, delay: +ev.delay || 0, t0: performance.now() };
        return true;
      case 'hit':
        // §5 Breitseite als Schild: die Lerche fängt eine Ladung für den Schützling ab (Ereignis läuft weiter in onEvent)
        if (ev.shielded) H.pushNotice('Abgefangen! Die Lerche deckt ' + escortLabel(ev.shielded), PAL.mint, 3);
        return false;
    }
    return false;
  }
  // S2: Planungsanzeige – Rauschen beim Beginn und bei jeder neuen Prägestufe
  function onPlanningS2(prev, s) {
    const a = prev && prev.mission ? prev.mission.planning : null;
    const b = s && s.mission ? s.mission.planning : null;
    if (s && s.phase === 'lobby') { Client.chapter = null; Client.newOffers = {}; }
    if (b && (!a || a.stage !== b.stage)) s2Sfx('gm_static', { volume: 0.5 });
  }

  // ------------------------------------------------------------------ B1–B3 „Bühnen & Bodenkampf“: Ereignisse
  // Mehrere gleichartige Meldungen (z. B. Debug „erkunde alle“) werden kurz gesammelt und als eine Zeile gezeigt.
  const sammel = {};
  function sammle(key, item, fmt, color) {
    const q = sammel[key] || (sammel[key] = { items: [], timer: null });
    q.items.push(item);
    if (q.timer) return;
    q.timer = setTimeout(() => { const list = q.items; q.items = []; q.timer = null; Net.guard('Client.sammle', () => H.pushNotice(fmt(list), color, 3)); }, 250);
  }
  function sektorName(hex) {
    const SS = window.Shared_Sektoren;
    try { if (SS && typeof SS.hexName === 'function' && hex) return SS.hexName(hex); } catch (e) { /* Ersatz */ }
    return 'Sektor ' + hex;
  }
  // Ziel einer Kante „SSZZ-SSZZ“ von hier aus (sonst beide Namen)
  function kantenName(id) {
    const SS = window.Shared_Sektoren;
    const [a, b] = String(id || '').split('-');
    let hier = null;
    try { hier = SS && SS.hexVonOrt ? SS.hexVonOrt(R.worldOf(Client.state).location) : null; } catch (e) { hier = null; }
    if (hier === a) return sektorName(b);
    if (hier === b) return sektorName(a);
    return sektorName(a) + ' – ' + sektorName(b);
  }
  // true = Ereignis erledigt
  function onEventB(ev) {
    const PAL = R.PAL;
    switch (ev.kind) {
      // ---- B3 Sektorkarte
      case 'hexErkundet':
        sammle('hex', ev.hex, (l) => l.length === 1 ? 'Sektor erkundet: ' + sektorName(l[0]) + ' (' + l[0] + ')' : l.length + ' Sektoren erkundet', PAL.ice);
        return true;
      case 'bojeGefunden':
        sammle('boje', ev.kante, (l) => l.length === 1 ? 'Boje gefunden: Sprungpunkt ' + kantenName(l[0]) : l.length + ' Bojen gefunden', PAL.amber);
        audio.play('discovery', { volume: 0.5 });
        return true;
      case 'sprungpunktOffen':
        H.pushNotice((ev.temp ? 'Temporärer Sprungpunkt offen: ' : 'Sprungpunkt offen: ') + kantenName(ev.kante), PAL.mint, 4);
        audio.play('discovery', { volume: 0.5 });
        return true;
      case 'sprungpunktZu':
        H.pushNotice('Sprungpunkt geschlossen: ' + kantenName(ev.kante), PAL.warn, 4);
        return true;
      case 'notsprung':
        // ODA erzählt der Server (sprung.js); hier Blitz, Erschütterung, Kurzmeldung
        Client.flashT = performance.now(); Client.shakeT = performance.now();
        H.pushNotice('NOTFALLSPRUNG → ' + (ev.nach && ev.nach !== ev.von ? sektorName(ev.nach) : 'selber Sektor'), PAL.red, 4);
        return true;
      // ---- B1 Bühnen
      case 'awayMap': R.registerAwayMap(ev); return true;
      case 'ankerZustand': {
        const msg = ANKER_MELDUNG[(ev.rolle || ankerRolle(ev.map, ev.anker)) + ':' + ev.zustand];
        if (msg) H.pushNotice(msg, PAL.mint, 3);
        return true;
      }
      case 'downloadAbbruch': H.pushNotice('Download unterbrochen – Treffer! Fortschritt bleibt.', PAL.red, 3); audio.play('error'); return true;
      case 'ladungScharf': H.pushNotice('LADUNG SCHARF – ' + Math.ceil(+ev.t || 0) + ' s, weg da!', PAL.red, 4); return true;
      case 'ladungExplodiert': {
        const p = ankerPos(ev.map, ev.anker);
        if (p) R.addFx('explosion', 'away', p.x, p.y, 0.9);
        Client.shakeT = performance.now();
        H.pushNotice('Sprengladung gezündet', PAL.amber, 3);
        return true;
      }
      case 'landepunktAlarm':
        if (ev.an) { H.pushNotice('ALARM – die Besatzung ist gewarnt', PAL.red, 4); audio.play('alarm_yellow'); }
        else H.pushNotice('Alarm dort unten aufgehoben', PAL.mint, 3);
        return true;
      // ---- B2 Bodenkampf (FX hört selbst mit; hier nur Kurzmeldungen)
      case 'loadout':
        if (ev.pid === Client.pid) { K.myWaffe = ev.waffe; H.pushNotice('Waffe: ' + (H.WAFFE_NAME[ev.waffe] || ev.waffe), PAL.mint, 2); }
        return true;
      case 'ueberhitzt':
        if (ev.id === Client.pid) H.pushNotice('Überhitzt – kurz abkühlen lassen', PAL.warn, 2);
        return true;
      case 'gefesselt': {
        const pl = playerName(ev.id);
        H.pushNotice(pl ? pl + ' ist gefesselt – befreien: E halten' : 'Gegner gefesselt', pl ? PAL.red : PAL.mint, 3);
        return true;
      }
      case 'befreit': { const pl = playerName(ev.id); if (pl) H.pushNotice(pl + ' ist frei', PAL.mint, 3); return true; }
      case 'aufgerichtet': { const pl = playerName(ev.id); H.pushNotice(pl ? pl + ' steht wieder' : 'Ein Gegner wurde wieder aufgerichtet', pl ? PAL.mint : PAL.warn, 3); return true; }
      case 'gefangen':
        H.pushNotice('GEFANGEN – Zellentür von innen aufbrechen, Ausrüstung holen', PAL.red, 5);
        return true;
      case 'truppAlarm': {
        // je Trupp höchstens alle 8 s melden (FX zeigt den Ort)
        const k = 'ta:' + (ev.map || '') + ':' + (ev.trupp || '');
        const now = performance.now(); const last = Client.b2Melde || (Client.b2Melde = {});
        if (!last[k] || now - last[k] > 8000) { last[k] = now; H.pushNotice('ALARM – ein Trupp hat euch bemerkt', PAL.red, 3); audio.play('alarm_yellow', { volume: 0.6 }); }
        return true;
      }
      case 'enemyDeck': {
        const now = performance.now();
        if (!Client.deckMeldung || now - Client.deckMeldung > 6000) { Client.deckMeldung = now; H.pushNotice('Gegner wechselt das Deck (' + (ev.via === 'leiter' ? 'Leiter' : 'Lift') + ')', PAL.warn, 2); }
        return true;
      }
      case 'rolleNeu':
        H.pushNotice('Neuer Gegnertyp: ' + (ROLLE_NAME[ev.rolle] || ev.rolle) + ' – genau hinsehen', PAL.amber, 4);
        return true;
      // ---- Bodenkampf: Wellen
      case 'welle': {
        const neu = ev.neu || {};
        const teile = [];
        if (neu.waffe) teile.push('Karl trägt jetzt ' + (H.WAFFE_NAME[neu.waffe] || neu.waffe));
        if (neu.rang) teile.push('Häuptlinge führen die Trupps');
        if (neu.gemischt) teile.push('gemischte Trupps');
        H.wellenBanner = { text: 'WELLE ' + ev.n, sub: ev.gesamt + ' Gegner' + (teile.length ? ' · ' + teile.join(' · ') : ''), t0: performance.now() };
        if (teile.length) H.pushNotice('Welle ' + ev.n + ': ' + teile.join(', '), PAL.amber, 4);
        audio.play('alarm_yellow', { volume: 0.6 });
        return true;
      }
      case 'welleGeschafft':
        H.wellenBanner = { text: 'WELLE ' + ev.n + ' ÜBERSTANDEN', sub: 'Alle wieder auf den Beinen', t0: performance.now() };
        audio.play('repair_done');
        return true;
      case 'wellenEnde':
        H.wellenErgebnis = Object.assign({ rekordNeu: wellenRekord(ev) }, ev);
        H.wellenRekorde = wellenRekorde();
        audio.play('error');
        return true;
      case 'enternFrei':
        H.pushOda('Feindschiff treibt manövrierunfähig. Nah heranfliegen, dann kann das Außenteam über die Transfer-Konsole entern.');
        return true;
      default: return false;
    }
  }
  // Bodenkampf: Wellen – Rekord je Karte nur im Browser (localStorage; ohne Speicher einfach kein Rekord)
  const REKORD_KEY = 'pantheon.wellen.rekord';
  function wellenRekorde() {
    try { const o = JSON.parse(localStorage.getItem(REKORD_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
  }
  // -> true, wenn neuer Rekord (mehr Wellen geschafft bzw. gleich viele schneller)
  function wellenRekord(ev) {
    if (!ev || !ev.karte || ev.debug) return false;   // Debug-Sprung (welle <n>) zählt nicht
    const all = wellenRekorde();
    const alt = all[ev.karte];
    const neu = !alt || ev.welle > alt.welle || (ev.welle === alt.welle && ev.zeit > alt.zeit);
    if (!neu) return false;
    all[ev.karte] = { welle: ev.welle, zeit: ev.zeit, seed: ev.seed, am: Date.now() };
    try { localStorage.setItem(REKORD_KEY, JSON.stringify(all)); } catch (e) { /* privater Modus */ }
    return true;
  }
  H.wellenRekorde = wellenRekorde();
  // B2: Gegnerrollen (CONTRACT-B2 §0.10, Germanen-Namen); nur für die Kurzmeldung rolleNeu, keine Symbole über Köpfen (E25)
  const ROLLE_NAME = { grundtyp: 'Karl', niederhalter: 'Bolzer', grenadier: 'Donnerwerfer', schuetze: 'Jäger', enterer: 'Berserker', haescher: 'Wergeld-Fänger', waechter: 'Wächter' };
  const ANKER_MELDUNG = {
    'terminal:geladen': 'Download abgeschlossen', 'terminal:laedt': 'Download läuft – E halten, Deckung!', 'beute:leer': 'Kiste geborgen',
    'fund:genommen': 'Fund geborgen', 'zelle:offen': 'Zelle geöffnet', 'raetsel:geloest': 'Schloss gelöst', 'tor:offen': 'Durchgang offen',
    'tor:gesprengt': 'Durchgang gesprengt', 'versteck:offen': 'Versteck geöffnet', 'ziel:genommen': 'Ziel genommen', 'ziel:aktiviert': 'Ziel aktiviert',
    'eingang:offen': 'Eingang offen', 'sprengpunkt:zerstoert': 'Sprengpunkt zerstört',
  };
  function playerName(id) { const p = ((Client.state && Client.state.players) || []).find(q => q.id === id); return p ? p.name : null; }
  function ankerRolle(mapId, id) { const m = Maps[mapId]; const a = m && m.anker && m.anker.find(q => q[0] === id); return a ? a[1] : ''; }
  function ankerPos(mapId, id) { const m = Maps[mapId || ((Client.state && Client.state.away) || {}).map]; const a = m && m.anker && m.anker.find(q => q[0] === id); return a ? { x: a[2] * TILE + 16, y: a[3] * TILE + 16 } : null; }

  function onEvent(ev) {
    if (window.VoxelFx && typeof window.VoxelFx.onEvent === 'function') { try { window.VoxelFx.onEvent(ev); } catch (e) { Net.reportError('VoxelFx.onEvent', e); } }   // M4: Effekte im Voxel-Modus
    const PAL = R.PAL;
    if (Net.guard('Client.eventS2', () => onEventS2(ev), false)) return;
    if (Net.guard('Client.eventM3', () => onEventM3(ev), false)) return;
    if (Net.guard('Client.eventB', () => onEventB(ev), false)) return;
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
        // S2b: Sperrfeuer kommt von draußen (Raumkoordinaten) – kein Abstand/Panorama zur Figur im Schiff, an Bord voll hörbar
        if (ev.name === 'sperrfeuer') { delete o.dist; o.pan = 0; o.volume = Client.self.zone === 'away' ? 0.35 : 0.9; }
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
      // S1: Weltstand und Spielmenü
      case 'worldSaved':
        H.showSaveSeal(true, 'Weltstand gesichert · ' + (ev.loc ? R.locName(Client.state, ev.loc) : (ev.name || '')));
        audio.play('save_seal');
        break;
      case 'worldSaveFailed':
        H.showSaveSeal(false, 'Weltstand nicht gesichert' + (ev.reason ? ' – ' + String(ev.reason).slice(0, 60) : ''));
        audio.play('error');
        break;
      case 'worldLoaded':
        H.pushNotice('Weltstand geladen: ' + (ev.name || ev.id || ''), PAL.mint, 4);
        audio.play('world_load');
        Client.skipLogNotice = performance.now();   // QA-Abnahme S1: das geladene Logbuch ist nicht „neu“ (sonst Hinweis auf den letzten alten Eintrag)
        break;
      case 'worldLoadFailed':
        H.pushNotice('Weltstand nicht geladen' + (ev.reason ? ': ' + String(ev.reason).slice(0, 80) : '') + ' – neues Spiel möglich', PAL.red, 6);
        audio.play('error');
        break;
      case 'sessionEnded': {
        const mine = ev.by != null && ev.by === Client.pid;
        const p = ((Client.state && Client.state.players) || []).find(q => q.id === ev.by);
        const who = ev.byName || (p ? p.name : (typeof ev.by === 'string' && ev.by ? ev.by : 'Jemand'));
        if (ev.grund === 'wellen') H.pushNotice('Runde vorbei – zurück in der Lobby. Enter: noch eine Runde', PAL.amber, 6);
        else H.pushNotice((mine ? 'Du hast' : who + ' hat') + ' die Partie beendet' + (ev.saved ? ' – Weltstand gesichert' : ''), mine ? PAL.mint : PAL.amber, 6);
        Client.ui.pauseSent = false; uiCloseAll(true);
        Client.minigame = null; Client.endDismissed = true;
        break;
      }
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
    // QA-Abnahme S1: kein Ankunfts-Banner beim Fortsetzen (Lobby -> Spiel); die Ortsliste der Lobby kennt den Ort noch nicht
    if (cw.location && pw.location && cw.location !== pw.location && prev.phase !== 'lobby') {
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
    if (cl > pl && pmi.log && Client.skipLogNotice && performance.now() - Client.skipLogNotice < 3000) Client.skipLogNotice = 0;
    else if (cl > pl && pmi.log) { const e = cmi.log[cl - 1]; audio.play('discovery'); H.pushNotice('Logbuch: ' + String(e.text || '').slice(0, 150), PAL.ice, 5); }   // QA-Abnahme S2: umbrochen statt bei 70 Zeichen abgeschnitten
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
  // B1: E-Hinweise an Ankern gebauter Karten (Regeln wie server/sim/anker.js interactionsAt; der Server entscheidet)
  // F10: Tür-Kachel gehört zu einem tor-Anker an einem Rätselpaar (Regel wie raetselGebunden in server/sim/anker.js:
  // gleiches paar, oder Tor ohne paar und die Karte hat Rätselanker). Kanten über Shared_Buehne.ankerKanten (eine Quelle).
  function torVerriegelt(map, tx, ty) {
    const SB = window.Shared_Buehne;
    const anker = map.anker || [];
    const rs = anker.filter(a => a[1] === 'raetsel');
    if (!rs.length) return false;
    const ki = map.kanteAt ? map.kanteAt.get(tx + ',' + ty) : undefined;
    for (const a of anker) {
      if (a[1] !== 'tor') continue;
      const hier = (a[2] === tx && a[3] === ty) || (ki != null && SB && SB.ankerKanten && SB.ankerKanten(map, { rolle: 'tor', x: a[2], y: a[3] }).some(k => k.idx === ki));
      if (!hier) continue;
      const paar = a[4] && a[4].paar;
      return paar ? rs.some(r => r[4] && r[4].paar === paar) : true;
    }
    return false;
  }
  function buehneInteraction(st, m, map, tx, ty) {
    const HZ = (CFG.anker && CFG.anker.halten) || {};
    const sec = (k) => String(HZ[k] != null ? HZ[k] : 3).replace('.', ',') + ' s';
    const inv = st.inventory || {};
    for (let i = 0; i < (map.anker || []).length; i++) {
      const a = map.anker[i];
      if (a[2] !== tx || a[3] !== ty) continue;
      const z = R.ankerZustand(map, st, i);
      switch (a[1]) {
        case 'terminal':
          if (z === 'bereit' || z === 'laedt') return { label: 'E halten: Daten herunterladen (' + sec('terminal') + ', Treffer unterbricht)', ok: true };
          if (z === 'geladen') return { label: 'E halten: Logbuch lesen (' + sec('lesen') + ')', ok: true };
          return { label: 'Terminal gesperrt', ok: false };
        case 'sprengpunkt':
          if (z === 'intakt') return (inv.ladung || 0) > 0 ? { label: 'E halten: Ladung scharf machen (' + sec('sprengpunkt') + ')', ok: true } : { label: 'Sprengpunkt – keine Ladung dabei', ok: false };
          if (z === 'scharf') return { label: 'SCHARF – weg da!', ok: false };
          return { label: 'Gesprengt', ok: false };
        case 'zelle': return z === 'zu' ? { label: 'E halten: Zelle öffnen (' + sec('zelle') + ')', ok: true } : { label: 'Zelle offen', ok: false };
        case 'beute': return z === 'voll' ? { label: 'E halten: Kiste bergen (' + sec('beute') + ')', ok: true } : { label: 'Leer geräumt', ok: false };
        case 'ziel': return z === 'frei' ? { label: 'E halten (' + sec('ziel') + ')', ok: true } : { label: 'Erledigt', ok: false };
        case 'fund': return z === 'da' ? { label: 'E halten: Fund bergen (' + sec('fund') + ')', ok: true } : { label: 'Sockel leer', ok: false };
        case 'raetsel':
          if (z === 'geloest') return { label: 'Gelöst', ok: false };
          {   // F4: solo nacheinander mit Laufweg-Fenster, in der Gruppe beide gleichzeitig (Regel und Zählung: shared/buehne.js)
            const SBr = window.Shared_Buehne;
            const zusatz = SBr && SBr.raetselHinweis ? (SBr.raetselSolo(st.players) ? SBr.raetselHinweis(true, SBr.raetselSoloFenster(map, a[4] && a[4].paar, CFG)) : SBr.raetselHinweis(false)) : 'beide gleichzeitig!';
            return { label: 'E halten: Schloss drehen (' + sec('raetsel') + ') · ' + zusatz, ok: z !== 'gehalten' };
          }
        case 'versteck': if (z !== 'offen') return { label: 'E halten: hohle Wand öffnen (' + sec('versteck') + ')', ok: true }; break;
        case 'eingang': {
          // Regel aus shared/buehne.js (eine Quelle mit dem Server): Schott/Luke zu/verschlossen -> hacken bzw. öffnen
          const SB = window.Shared_Buehne;
          if (!SB || !SB.eingangAktion || !(a[4] && a[4].art === 'technisch')) break;   // SB: index.html (Rückfall: render.js lädt nach)
          const op = SB.eingangAktion(map, { rolle: 'eingang', x: a[2], y: a[3], art: 'technisch' }, (k) => R.kantenZustand(map, st, k.idx));
          if (op === 'hacken') return { label: 'E halten: Schott hacken (' + sec('schott_hacken') + ')', ok: true };
          if (op === 'luke') return { label: 'E halten: Luke öffnen (' + String(SB.TUER_ZEIT.luke).replace('.', ',') + ' s)', ok: true };
          break;
        }
        case 'lift': return { label: 'E: Lift zum anderen Deck', ok: true };
        case 'leiter': return { label: 'E halten: Leiter zum anderen Deck', ok: true };
        default: break;
      }
    }
    const info = map.info(tx, ty);
    if (info.solid === 'zustand' && info.kind !== 'wand_schwach') {
      const z = R.kachelZustand(map, st, tx, ty);
      // F10: wie server/sim/anker.js – nur rätselgebundene Tore sind verriegelt, alle anderen 'zu'-Tore öffnen mit E
      if (z !== 'offen' && z !== 'gesprengt' && torVerriegelt(map, tx, ty)) return { label: 'Verriegelt – das öffnet erst das Rätsel (beide Schlösser gleichzeitig).', ok: false };
      if (z === 'zu') return { label: 'E halten: ' + (info.kind === 'tor' ? 'Tor' : info.kind === 'schott' ? 'Schott' : info.kind === 'luke' ? 'Luke' : 'Tür') + ' öffnen', ok: true };
      if (z === 'verschlossen') return { label: 'Verschlossen', ok: false };
    }
    return null;
  }
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
    if (zone === 'away') {   // B2: Fesseln (bewusstloser Gegner), Befreien (gefesselter Kamerad)
      const K = (CFG.awayCombat && CFG.awayCombat.koerper) || CFG.koerper || {};
      const fs = (v, d) => String(v == null ? d : v).replace('.', ',') + ' s';
      const at = (q) => Math.floor(q.x / TILE) === tx && Math.floor(q.y / TILE) === ty;
      const dr = ((st.away && st.away.drones) || []).find(d => d.zs === 'bewusstlos' && at(d));
      if (dr) return { label: 'E halten: fesseln (' + fs(K.fesseln, 3) + ')', ok: true };
      const pl = players.find(p => p.id !== m.id && p.zone === 'away' && p.zs === 'gefesselt' && at(p));
      if (pl) return { label: 'E halten: ' + pl.name + ' befreien (' + fs(K.befreien, 3) + ')', ok: true };
    }
    if (zone === 'away' && R.isBuehne(map)) { const b = buehneInteraction(st, m, map, tx, ty); if (b) return b; }   // B1: Anker
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
    // M4 (DECKS): Lift nur von der eigenen Kachel, Notleiter auch von der Nachbarkachel
    const shipInteract = zone === 'ship' && map.legend && map.legend[ch] ? map.legend[ch].interact : null;
    if (ownTile && shipInteract === 'lift' && !(m && m.lift)) return { label: 'E: Lift zum ' + (Maps.deckOf && Maps.deckOf(ty) ? 'Systemdeck' : 'Privatdeck'), ok: true };
    if (shipInteract === 'ladder' && !(m && m.ladder)) return { label: 'Halten: Notleiter (2 s)', ok: true };
    // Brückenumbau: freies Terminal (Legende interact 'spare') – noch ohne Funktion
    if (!ownTile && zone === 'ship' && map.legend && map.legend[ch] && map.legend[ch].interact === 'spare') return { label: 'Freies Terminal – noch ohne Funktion.', ok: false };
    if (ownTile) {
      const items = zone === 'away' ? ((st.away && st.away.items) || []) : ((st.ship && st.ship.groundItems) || []);
      const it = items.find(i => Math.floor(i.x / TILE) === tx && Math.floor(i.y / TILE) === ty);
      if (it) return carry ? { label: 'Hände voll (G ablegen)', ok: false } : { label: 'Aufheben: ' + (ITEM_LABEL[it.kind] || it.kind), ok: true };
      if (ch === 'P' || (zone === 'away' && R.isBuehne(map) && (map.abholPads || []).some(q => q.x === tx && q.y === ty))) return { label: 'Halten: Selbst-Transfer', ok: true };
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
      // Kai 2026-10-07: Namen auch am heilen System zeigen (zum Lernen), aber ohne Bedienoption
      if (state === 'ok' && !fragile) return { label: name, ok: false, info: true, sys };
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
    // F5 (Studioleitung): auf einem Deck-Link-Feld (Lift/Leiter) zuerst die eigene Kachel – Regel shared/buehne.js (wie der Server)
    const SB = window.Shared_Buehne; const AM = self.zone === 'away' && st.away && window.Shared_Maps ? window.Shared_Maps[st.away.map] : null;
    if (SB && SB.interaktionsVorrang && AM && SB.interaktionsVorrang(AM, t.x, t.y) === 'eigen') order.unshift([0, 0, true]);
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
  // B2: Lanze loslassen = Schuss (shoot { los: true }); der Server feuert sonst nach 0,45 s ohne Eingabe
  function feuerLos() {
    if (Client.fireHeld.mouse || Client.fireHeld.key) return;
    const m = me();
    if (!m || m.zone !== 'away' || m.console || m.wf !== 'lanze' || m.downed) return;
    const w = mouseWorld();
    const angle = Client.mouse.x >= 0 ? Math.atan2(w.y - (Client.self.y - 14), w.x - Client.self.x) : (function () { const d = DIRV[Client.self.dir] || DIRV.down; return Math.atan2(d[1], d[0]); })();
    send({ t: P.C.SHOOT || 'shoot', angle, los: true });
  }
  // B2-NACH: Wurf-Zielvorschau – derselbe Landepunkt wie auf dem Server (Winkel wie shoot, Abstand Füße → Zeiger,
  // auf [min, max] geklemmt; Streuung nicht). null, wenn keine Wurfwaffe aktiv ist oder der Zeiger fehlt.
  function wurfZiel(m) {
    if (!m || m.zone !== 'away' || m.console || m.downed || Client.mouse.x < 0 || uiTop()) return null;
    const WD = m.wf && CFG.awayCombat && CFG.awayCombat.waffen ? CFG.awayCombat.waffen[m.wf] : null;
    if (!WD || !WD.flaeche) return null;
    const w = mouseWorld(); const sx = Client.self.x, sy = Client.self.y;
    if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.y)) return null;
    const a = Math.atan2(w.y - (sy - 14), w.x - sx);
    const d = Math.hypot(w.x - sx, w.y - sy) / TILE;
    const lo = +WD.min || 0, hi = +WD.max || d;
    const k = Math.max(lo, Math.min(hi, d));
    return { x: sx + Math.cos(a) * k * TILE, y: sy + Math.sin(a) * k * TILE, r: (+WD.radius || 1.5) * TILE, geklemmt: Math.abs(k - d) > 0.05, kach: k };
  }
  // FIX-ZIELEN: Zielwinkel zum Mauszeiger in Grad (wie shoot: Schulterhöhe 14 px) – die Figur schaut immer zur Maus.
  // null ohne Zeiger, an Bord, an Konsolen, verwundet oder bei offenem Menü (dann gilt die Laufrichtung).
  function zielGrad(m) {
    if (!m || m.zone !== 'away' || m.console || m.downed || Client.mouse.x < 0 || uiTop()) return null;
    const w = mouseWorld();
    if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.y)) return null;
    const dx = w.x - Client.self.x, dy = w.y - (Client.self.y - 14);
    if (dx * dx + dy * dy < 16) return null;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }
  function shoot() {
    const m = me();
    // M2: Verwundete schießen auf v2-Karten mit der Pistole (players[].sh gesetzt)
    const pistol = !!(m && m.downed && Array.isArray(m.sh));
    if (!m || m.zone !== 'away' || m.console || (m.downed && !pistol) || Client.shootCd > 0) return;
    const w = mouseWorld();
    const oy = pistol ? 6 : 14;
    const angle = Client.mouse.x >= 0 ? Math.atan2(w.y - (Client.self.y - oy), w.x - Client.self.x) : (function () { const d = DIRV[Client.self.dir] || DIRV.down; return Math.atan2(d[1], d[0]); })();
    // B2-NACH: dist = Abstand Füße → Mauszeiger in Kacheln (Wurfweite der Granate; der Server begrenzt auf min/max)
    const dist = Client.mouse.x >= 0 ? Math.round(Math.hypot(w.x - Client.self.x, w.y - Client.self.y) / TILE * 100) / 100 : null;
    send(dist != null && Number.isFinite(dist) ? { t: P.C.SHOOT || 'shoot', angle, dist } : { t: P.C.SHOOT || 'shoot', angle });
    const AC = CFG.awayCombat || {};
    const WD = !pistol && m.wf && AC.waffen ? AC.waffen[m.wf] : null;   // B2: Takt je Waffe (der Server prüft Hitze/Sperre)
    if (pistol) Client.shootCd = (AC.wounded && AC.wounded.pistolCooldown) || 0.7;
    else if (WD) Client.shootCd = m.wf === 'lanze' ? 0.2 : (+WD.kadenz || ((+WD.ausholen || 0) + (+WD.erholung || 0)) || 0.3);
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
    Client.keys = {}; Client.fireHeld = { mouse: false, key: false };
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
    // S2: Kapitelkarte liegt über allem – Enter (oder Esc/Leertaste) schließt, andere Tasten gehen nicht ins Spiel
    if (Client.chapter && Client.state && Client.state.phase !== 'lobby') {
      if (!e.repeat && (code === 'Enter' || code === 'NumpadEnter' || code === 'Escape' || code === 'Space')) actions.closeChapter();
      return;
    }
    // S1: offene Menüseite (Spielmenü, Optionen, Steuerung, Weltstände) bekommt alle Tasten
    if (uiTop()) { Client.keys = {}; Net.guard('Client.uiKey', () => uiKey(e)); return; }
    const st = Client.state, m = me();
    if (!st || st.phase === 'lobby' || !m) {
      if (Net.badCode && !m) { if (code === 'Enter') actions.submitCode(); return; }
      if (code === 'KeyO' && !e.repeat) { actions.openOptions(); return; }   // S1: Optionen auch in der Lobby
      if (code === 'KeyF' && m && !e.repeat) { openWorlds('list'); return; }   // S1: Weltstand-Liste
      if (code === 'Enter') actions.toggleReady();
      if (code === 'KeyU' && m) actions.toggleSkipDrill();
      if (code === 'KeyM' && m) actions.toggleStartMission();   // M2: Direktstart Planetenmission
      if (code === 'KeyK' && m && !e.repeat) actions.toggleWellenKarte();   // Bodenkampf: Wellen – Karte
      if (code === 'KeyW' && m && !e.repeat) actions.lobbyWaffe();   // AP3a: Waffe für Wellen Boden / Labor
      if (m && st && st.lobby && st.lobby.startMission === 'labor') {   // AP3a: Szenario-Labor
        if (code === 'ArrowUp') actions.laborWahl(-1);
        if (code === 'ArrowDown') actions.laborWahl(1);
        if (code === 'ArrowLeft' && !e.repeat) actions.laborStaerke(-1);
        if (code === 'ArrowRight' && !e.repeat) actions.laborStaerke(1);
        if (code === 'KeyR' && !e.repeat) actions.laborSeed();
        if (code === 'KeyG' && !e.repeat) actions.laborGod();
      }
      if (code === 'KeyL' && m && Net.serverRoomCode) actions.copyInvite();
      const d = /^Digit([1-3])$/.exec(code);
      if (d) actions.setColor(+d[1] - 1);
      return;
    }
    Client.keys[code] = true;
    if (DEBUG && Client.serverDebug && code === 'F6') { e.preventDefault(); send({ t: 'debug', cmd: 'skip' }); return; }
    // QA M1: Der Ende-Screen erscheint auch über Konsolen (der Captain sitzt beim Kernscan an der Konsole) – Enter/Esc schließt ihn zuerst.
    if ((st.phase === 'end' || (st.mission && st.mission.m1Done)) && !Client.endDismissed && (code === 'Enter' || code === 'Escape')) { actions.dismissEnd(); return; }
    if (st.wellen && st.wellen.ph === 'ende' && code === 'Enter') { actions.wellenLobby(); return; }   // Bodenkampf: Wellen – Ergebnis -> Lobby
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
      case 'Space': shoot(); Client.fireHeld.key = true; break;
      case 'KeyC': toggleCrouch(); break;   // M2 §15: ducken (nur Außenzone auf v2-Karten)
      case 'KeyQ':
        if (m.zone === 'away') {
          const w = Client.mouse.x >= 0 ? mouseWorld() : { x: Client.self.x, y: Client.self.y };
          send({ t: P.C.MARK || 'mark', x: Math.round(w.x), y: Math.round(w.y) });
          audio.play('ui_click');
        }
        break;
      case 'Tab': H.showCrew = true; break;
      // S1 Esc-Kette: Ende-Screen -> Minispiel -> Konsole (oben) -> Crew-Overlay -> Spielmenü
      case 'Escape':
        if (H.showCrew) { H.showCrew = false; break; }
        uiPush('menu', 0); audio.play('ui_click');
        break;
    }
  });
  window.addEventListener('keyup', (e) => {
    const code = e.code;
    delete Client.keys[code];
    if (code === 'Delete' && Client.ui.hold && !Client.ui.hold.mouse && !Client.ui.hold.sent) Client.ui.hold = null;   // S1: Halten abgebrochen
    if (uiTop()) return;
    if (code === 'KeyE' && Client.actDown) { Client.actDown = false; send({ t: P.C.ACT || 'act', down: false }); }
    if (code === 'Tab') H.showCrew = false;
    if (code === 'Space' && Client.fireHeld.key) { Client.fireHeld.key = false; feuerLos(); }
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
    if (uiTop() || Client.chapter) return;   // S1: Menüseite offen – kein Schuss, keine Konsole darunter (S2: Kapitelkarte ebenso)
    const m = me();
    if (m && m.console) { Net.guard('Consoles.mouseDown', () => K.mouseDown(p.x, p.y, Client.view)); return; }
    if (m && m.zone === 'away' && Client.state && Client.state.phase !== 'lobby') { shoot(); Client.fireHeld.mouse = true; }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0 && Client.fireHeld.mouse) { Client.fireHeld.mouse = false; feuerLos(); } });
  window.addEventListener('mouseup', () => {
    const h = Client.ui.hold;
    if (h && h.mouse && !h.sent) Client.ui.hold = null;   // S1: Löschknopf losgelassen
  });
  window.addEventListener('mouseup', () => { if (Client.view) Net.guard('Consoles.mouseUp', () => K.mouseUp(Client.view)); });

  // ------------------------------------------------------------------ Simulation (fester Schritt)
  function step(dt) {
    Client.time += dt;
    Net.guard('Hud.update', () => H.update(dt));
    if (Client.shootCd > 0) Client.shootCd -= dt;
    // B2: Feuer halten (Waffen mit Hitze: Dauerfeuer im Takt der Waffe; Lanze: laden, Loslassen feuert)
    if ((Client.fireHeld.mouse || Client.fireHeld.key) && Client.shootCd <= 0) { const fm = me(); if (fm && fm.wf && fm.zone === 'away' && !fm.console && !uiTop()) shoot(); else if (!fm || fm.zone !== 'away') Client.fireHeld = { mouse: false, key: false }; }
    updateHold(dt);   // S1: Entf halten löscht einen Weltstand
    const st = Client.state, m = me(), self = Client.self;
    self.offX *= 0.85; self.offY *= 0.85;
    if (Math.abs(self.offX) < 0.05) self.offX = 0;
    if (Math.abs(self.offY) < 0.05) self.offY = 0;
    if (!st || !m) return;
    if (Client.view && m.console) Net.guard('Consoles.update', () => K.update(dt, Client.view));

    Net.guard('Client.minigame', () => updateMinigame(dt));
    const canMove = st.phase !== 'lobby' && !m.console && !m.downed && !m.lift && Net.isOpen() && self.init && !Client.minigame && !uiTop() && !st.paused && !Client.chapter;
    let { mx, my } = canMove ? moveAxes() : { mx: 0, my: 0 };
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const nonzero = mx !== 0 || my !== 0;
    Client.sendAcc += dt;
    const changed = mx !== Client.lastSent.mx || my !== Client.lastSent.my;
    // FIX-ZIELEN: Zielwinkel mit der Eingabe (ganze Grad); sparsam: erst ab 4° Änderung, höchstens 20×/s
    const zg = zielGrad(m), aim = zg == null ? null : Math.round(zg), la = Client.lastSent.aim;
    const aimChanged = (aim == null) !== (la == null) || (aim != null && Math.abs(Phys.normAngle((aim - la) * Math.PI / 180)) >= 4 * Math.PI / 180);
    if (changed || (nonzero && Client.sendAcc >= 1 / 30) || (aimChanged && Client.sendAcc >= 1 / 20)) {
      Client.seq++;
      send(aim == null ? { t: P.C.INPUT || 'input', seq: Client.seq, mx, my } : { t: P.C.INPUT || 'input', seq: Client.seq, mx, my, aim });
      Client.lastSent = { mx, my, aim };
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
      ui: Client.ui,   // S1
    };
    if (uiTop()) {
      const VR = window.VoxelRender;
      v.optionsInfo = { volume: Client.options.volume, muted: Client.options.muted, saved: Client.options.saved, fullscreen: isFullscreen(),
        render: VR ? (VR.mode === 'voxel' ? 'voxel' : '2d') : (Client.options.render || '2d'), renderAvailable: !!(VR && typeof VR.setMode === 'function') };
      v.endInfo = endInfo();
    }
    if (!st || st.phase === 'lobby') return v;
    v.wurfZiel = wurfZiel(m);   // B2-NACH: Landepunkt-Vorschau der Wurfwaffe
    const pair = snapPair(nowMs - INTERP_DELAY) || { a: st, b: st, f: 0 };
    const A = pair.a, B = pair.b, f = pair.f;
    v.players = lerpList(A.players, B.players, f).map(p => p.id === Client.pid ? p : p);
    // eigene Figur: Vorhersage statt Interpolation, restliche Felder aus dem neuesten Snapshot
    if (m) {
      v.players = v.players.filter(p => p.id !== Client.pid);
      const mine = Object.assign({}, m, { x: v.self.x, y: v.self.y, zone: self.zone });
      if (!m.console && !m.downed) { mine.dir = self.dir; mine.moving = self.moving; }
      mine.cr = canCrouchHere(m, st) && crouchActive(m);   // §15: sofort geduckt zeichnen (Vorhersage)
      mine.fa = zielGrad(m);   // FIX-ZIELEN: eigene Figur sofort zur Maus (ohne auf den Snapshot zu warten); null = Laufrichtung
      v.players.push(mine);
    } else v.players = st.players;
    v.bots = lerpList(A.bots, B.bots, f);
    v.shipNpcs = lerpList((A.ship || {}).npcs, (B.ship || {}).npcs, f);
    const as = A.space || {}, bs = B.space || {};
    v.enemies = lerpEnemies(as.enemies, bs.enemies, f, pair.dt, pair.ext);
    v.spaceProjectiles = lerpList(as.projectiles, bs.projectiles, f);
    const aa = A.away || {}, ba = B.away || {};
    // S2: Schützlinge (≤ 2) interpoliert wie Projektile; Trefferblitz und Befehlsrückmeldung
    v.escorts = lerpList(as.escorts, bs.escorts, f);
    v.escortHit = {};
    for (const id in Client.escortHit) { const s = (nowMs - Client.escortHit[id]) / 1000; if (s > 2) delete Client.escortHit[id]; else v.escortHit[id] = s; }
    if (Client.escortOrder && nowMs - Client.escortOrder.t0 < 6000) v.escortOrder = Object.assign({ age: (nowMs - Client.escortOrder.t0) / 1000 }, Client.escortOrder);
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
    nameInput.style.display = lobby && (Net.status === 'open') && !codeMode && !uiTop() ? 'block' : 'none';
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
      if (Client.chapter) Net.guard('Hud.drawChapter', () => H.drawChapter(ctx, v, Client.chapter));   // S2
      const fl = (performance.now() - Client.flashT) / 400;
      if (fl >= 0 && fl < 1) { ctx.fillStyle = 'rgba(244,238,220,' + (1 - fl) * 0.85 + ')'; ctx.fillRect(0, 0, VW, VH); }
      if (!v.me.console) R.drawTooltip(ctx);
    }
    // S1: Pause-Hinweis, Siegel „Weltstand gesichert“, Menüseiten obenauf
    Net.guard('Hud.drawPause', () => H.drawPause(ctx, v, !!uiTop()));
    Net.guard('Hud.drawSaveSeal', () => H.drawSaveSeal(ctx, v));
    if (uiTop()) Net.guard('Hud.drawUi', () => H.drawUi(ctx, v, Client.ui));
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
    // QA-Abnahme S2: Bei Kapitelkarte, Ende- oder Menüseite ebenfalls kompakt – sonst liegt das Overlay über dem Text.
    const overlay = !!Client.chapter || !!uiTop() || st.phase === 'end';
    if ((me && me.console) || overlay) {
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
      // B3: Hex-Codes bleiben Text (0306 nicht als Zahl 306)
      case 'hex': if (args[0]) msg.hex = String(args[0]); msg.args = args; break;
      case 'boje': if (args[0]) msg.kante = String(args[0]); msg.args = args; break;
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
    Net.guard('Client.renderOption', syncRenderOption);   // S1: Option Voxel/2D <-> F8
    Net.guard('Client.ambience', updateAmbience);
    fpsN++; fpsT += dt;
    if (fpsT >= 1) { Client.fps = Math.round(fpsN / fpsT); G.fps = Client.fps; fpsN = 0; fpsT = 0; }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ Start
  function boot() {
    layout();
    if (window.Art && typeof Art.init === 'function') Net.guard('Art.init', () => Art.init());
    applyAudioOptions();   // S1: Lautstärke/Stumm aus pantheon.options (GameAudio merkt sich das vor init())
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
  Client.interactionAt = interactionAt;   // QA/Debug: E-Hinweis einer Kachel (st, me, tx, ty, zone, ownTile) -> { label, ok } | null
  Client.actions = actions;
  Client.audio = audio;
  boot();
})();
