// Konsolen-Overlays (CONTRACT.md §5.2, §9; CONTRACT-M1 §4, §7, §8, §10). Globales `Consoles`.
// Steuer (Frontsicht), Captain (Tabs), Taktik (intern 'weapons'), Transfer, Shop, Quartier, Sonde,
// Planungstisch ('plan'). Tastatur UND Maus. Gesperrte Aktionen werden grau mit Grund angezeigt
// (Grund lokal abgeleitet; der Server entscheidet trotzdem und meldet Ablehnungen per `event notice`).
(function () {
  'use strict';

  const R = window.Render;
  const H = window.Hud;
  const Maps = window.Shared_Maps;
  const Phys = window.Shared_Physics;
  const CFG = window.Shared_Config || {};
  const PROTO = window.Shared_Protocol || {};
  const PAL = R.PAL;
  const VW = 640, VH = 360, TILE = 32;

  const POWER_SYS = PROTO.POWER_SYSTEMS || ['engines', 'shields', 'weapons', 'life'];
  const SYSTEMS = PROTO.SYSTEMS || ['reactor', 'engines', 'shields', 'weapons', 'life', 'transfer'];
  const CODE_COLORS = PROTO.CODE_COLORS || ['mint', 'bernstein', 'rot', 'blau', 'pink', 'weiss'];
  const CODE_HEX = PROTO.CODE_COLOR_HEX || {};
  const COLOR_NAMES = { mint: 'Mint', bernstein: 'Bernstein', rot: 'Rot', blau: 'Blau', pink: 'Pink', weiss: 'Weiß' };
  const SYMBOL_NAMES = { kreis: 'Kreis', dreieck: 'Dreieck', raute: 'Raute', stern: 'Stern', welle: 'Welle', kreuz: 'Kreuz' };
  const DECO_NAMES = {
    pflanze: 'Topfpflanze', poster: 'Sternkarten-Poster', lampe: 'Messinglampe', teppich: 'Flickenteppich',
    buecherregal: 'Bücherregal', aquarium: 'Aquarium', sessel: 'Ohrensessel', sternkarte: 'Sternkarte (Wand)',
    trophaee_boje: 'Trophäe: Boje B-7', kristalllampe: 'Kristalllampe (Vaelen)',
  };
  const FLOORS = [['holz_hell', 'Holz hell'], ['holz_dunkel', 'Holz dunkel'], ['teppich_rot', 'Teppich rot'], ['teppich_blau', 'Teppich blau'], ['fliesen', 'Fliesen']];
  const WALLS = [['holz', 'Holz'], ['paneel', 'Paneel'], ['tapete_gruen', 'Tapete grün'], ['tapete_creme', 'Tapete creme']];
  const LIGHTS = [['warm', 'Warm'], ['mint', 'Mint'], ['bernstein', 'Bernstein'], ['aus', 'Aus']];
  const STYLE_ROWS = [['floor', 'BODEN', FLOORS], ['wall', 'WAND', WALLS], ['light', 'LICHT', LIGHTS]];
  const TABS = ['Funk', 'Sternkarte', 'Lage', 'Energie & Schilde', 'Schadensplan', 'Außenteam'];
  const TAB_AWAY = 5;
  const TITLES = { helm: 'STEUER · FRONTSICHT', captain: 'CAPTAIN', weapons: 'TAKTIK', transfer: 'TRANSFER', shop: 'HAFENTERMINAL', quartier: 'QUARTIER', sonde: 'KUSTODEN-SONDE', plan: 'PLANUNGSTISCH' };
  const ZOOM_STEPS = [0.25, 0.35, 0.5, 0.75];
  // M3a: Lanze (Bug) + Batterien Bb/Stb; phase_* nur noch als Altnamen
  const M3_MOUNTS = ['bow', 'port', 'stbd'];
  const MOUNT_ORDER = ['bow', 'port', 'stbd', 'phase_l', 'phase_r', 'lanze', 'bolzen', 'seitenturm'];
  const MOUNT_NAMES = { bow: 'Lanze', port: 'Batterie Bb', stbd: 'Batterie Stb', phase_l: 'Phase L', phase_r: 'Phase R', lanze: 'Lanze', bolzen: 'Bolzen', seitenturm: 'Seitenturm' };
  const MOUNT_KEYS = { bow: '1', port: '2', stbd: '3', phase_l: '1', phase_r: '2', lanze: '1', bolzen: '4', seitenturm: '4' };
  const MOUNT_SYS = { bow: 'weapon_bow', port: 'battery_port', stbd: 'battery_stbd' };
  const POWER_NAMES = { engines: 'Antrieb', shields: 'Schilde', weapons: 'Waffen', life: 'Lebenserhaltung' };
  const SECTOR_KEYS = ['Bug', 'Stb', 'Heck', 'Bb'];
  // QA M3a: Räume zusammenfassen statt doppelt nennen („Brücke 2, Quartier 2“), Reihenfolge = erstes Auftreten
  function roomList(tiles, max) {
    const cnt = new Map();
    for (const t of tiles) { const r = H.roomOf(t[0], t[1]); cnt.set(r, (cnt.get(r) || 0) + 1); }
    const parts = [...cnt].map(([r, k]) => (k > 1 ? r + ' ' + k + '×' : r));
    return parts.length > max ? parts.slice(0, max).join(', ') + ' …' : parts.join(', ');
  }
  const EMITTER_OF = ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];
  function m3(path, d) { return R.cfgM3 ? R.cfgM3(path, d) : d; }
  function f1(v) { return R.fmt1 ? R.fmt1(v) : (Math.round((+v || 0) * 10) / 10).toFixed(1).replace('.', ','); }
  const SCAN_RANGE = (CFG.tscan && CFG.tscan.range) || 800;
  const WIDESCAN_CD = (CFG.widescan && CFG.widescan.cooldown) || 20;
  const OVERLOAD_TIME = (CFG.reactorM1 && CFG.reactorM1.overloadTime) || 180;
  const MAX_PINS = (CFG.plan && CFG.plan.maxPins) || 5;
  const STATE_TXT = { online: 'online', overload: 'ÜBERLADEN', offline: 'OFFLINE' };

  // M3b: Lerche-Klasse für Temporegler und Drehfaktor (Server-Snapshot ship.helm ist maßgeblich, das hier ist Fallback)
  const LERCHE = (CFG.shipClasses && CFG.shipClasses.lerche) || { maxSpeed: 130, stages: [-0.23, 0, 0.27, 0.5, 0.75, 1],
    stageNames: ['R', 'STOPP', '¼', '½', '¾', 'VOLL'], turnRate: 0.6, turnCurve: [[0, 1], [1, 1]] };
  const FLIGHT = window.Shared_Flight || null;
  function turnFactorOf(speed) {
    if (FLIGHT && FLIGHT.turnFactor) return FLIGHT.turnFactor(LERCHE, speed);
    const c = LERCHE.turnCurve; if (!c || !c.length) return 1;
    const f = LERCHE.maxSpeed > 0 ? speed / LERCHE.maxSpeed : 0;
    if (f <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) if (f <= c[i][0]) { const a = c[i - 1], b = c[i], s = b[0] - a[0]; return s > 0 ? a[1] + (b[1] - a[1]) * (f - a[0]) / s : b[1]; }
    return c[c.length - 1][1];
  }
  // M3b §4: Schild-Durchlass je Stärke (config.spaceM3b.shieldLeak) als Kurztext
  function leakText(s) {
    const L = (CFG.spaceM3b && CFG.spaceM3b.shieldLeak) || {};
    const row = L[Math.max(0, Math.min(4, Math.round(s)))] || {};
    const pct = Math.round((row.chance != null ? row.chance : [0.45, 0.2, 0.05, 0, 0][Math.max(0, Math.min(4, s))]) * 100);
    if (s <= 0) return { short: 'offen', long: 'offen – ' + pct + ' % Systemschaden', col: '#FF5A4A' };
    if (pct <= 0) return { short: 'dicht', long: 'dicht – kein Systemschaden', col: '#7FE0C2' };
    if (row.heavyOnly) return { short: pct + ' %', long: pct + ' % (nur schwere Treffer)', col: '#F2C94C' };
    return { short: 'Kratzer ' + pct + ' %', long: 'Kratzer – ' + pct + ' % Systemschaden', col: '#F08A3C' };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function n(v, d) { return typeof v === 'number' && isFinite(v) ? v : (d || 0); }
  function sysDown(ship, sys) { const s = (ship.systems || {})[sys]; return s === 'broken' || s === 'offline'; }
  function fmt(sec) { return H.fmtTime(sec); }

  const Consoles = {
    current: null,
    tab: 0,
    sel: { power: 0, damage: 0, shop: 0, deco: 0, slot: 0, qrow: 0, loc: 0, mount: 0 },
    lanceOn: null,     // §20.3: Lanze wird gerade aufgeladen ('key' | 'mouse')
    keys: {},
    mouseHold: null,
    helmSent: { turn: 0, t: 0 },
    helmPending: null, // M3b: lokal vorgemerkte Stufe bis der Snapshot sie bestätigt { stage, from, t }
    zoom: { weapons: 0.35, lage: 0.35 },
    enemyRects: [],
    lageRects: [],
    scanOn: false,
    tscanOn: false,
    tscanRefreshT: 0,
    scanRefreshT: 0,
    overloadAsk: -1e9,
    plan: { mapId: 'star', selected: null, label: 'ziel', tab: 'map', bookSel: 0 },
    starSel: null,
    maps: {},          // zuletzt gezeichnete Karten (Umrechnung Klick -> Welt): weapons, lage, star, plan
    starRects: [],
    planRects: [],
    view: null,

    // ---------------------------------------------------------------- Hilfen
    cmd(view, c, fields) {
      const msg = Object.assign({ t: 'cmd', c }, fields || {});
      view.send(msg);
      view.actions.sfx('ui_click');
    },
    onOpen(name) {
      this.current = name;
      this.keys = {};
      this.mouseHold = null;
      this.helmSent = { turn: 0, t: 0 };
      this.helmPending = null;
      this.overloadAsk = -1e9;
      this.lanceOn = null;
      if (name === 'plan') this.plan.mapId = 'star';
    },
    onClose(view) {
      if (this.current === 'helm' && view && this.helmSent.turn) view.send({ t: 'cmd', c: 'helm.input', turn: 0, thrust: 0 });
      if (this.scanOn && view) { view.send({ t: 'cmd', c: 'captain.scan', on: false }); this.scanOn = false; }
      if (this.tscanOn && view) { view.send({ t: 'cmd', c: 'weapons.scan', on: false }); this.tscanOn = false; }
      this.current = null;
      this.keys = {};
      this.mouseHold = null;
      this.lanceOn = null;   // Server lässt das Aufladen beim Verlassen verpuffen (§20.3)
    },
    denied(text) { R.uiDenied = { text, t: performance.now() }; if (this.view) this.view.actions.sfx('error'); },

    awayActive(st) { return !!(st.away && st.away.active); },
    // M2: Außenmission mit Kampf v2 (Kesh)
    isAwayV2(st) { return !!(st && (R.isV2(st) || R.mapFor('away', st).id === 'kesh')); },

    // Gründe, warum Transfer gerade nicht geht (null = möglich)
    transferBlock(st) {
      const ship = st.ship || {};
      if (sysDown(ship, 'transfer')) return 'Transfer ausgefallen – reparieren';
      const space = st.space || {};
      const target = (space.markers || []).find(m => m.kind === 'buoy' || m.kind === 'wreck' || m.kind === 'moon');
      const sc = (CFG.scenes && CFG.scenes.buoy) || {};
      if (!target) return 'Kein Landeziel in der Nähe (Boje B-7, Wrack oder Mond Kesh)';
      const SL = window.Shared_Locations;
      const sl = SL && SL.get ? SL.get(R.worldOf(st).location) : null;
      const range = target.beamRange || (sl && sl.scene && sl.scene.beam && sl.scene.beam.range) || sc.beamRange || 320;
      const d = Math.hypot(n(ship.x) - target.x, n(ship.y) - target.y);
      if (d > range) return 'Zu weit vom Ziel (' + Math.round(d) + '/' + range + ')';
      const sp = n(ship.speed, Math.hypot(n(ship.vx), n(ship.vy)));
      if (sp > ((CFG.ship && CFG.ship.beamMaxSpeed) || 30)) return 'Zu schnell (' + Math.round(sp) + '/' + ((CFG.ship && CFG.ship.beamMaxSpeed) || 30) + ') – Steuer auf STOPP';
      return null;
    },

    // ---------------------------------------------------------------- Zeichnen
    draw(ctx, view) {
      this.view = view;
      const c = view.me.console;
      if (c !== this.current) this.onOpen(c);
      ctx.fillStyle = 'rgba(11,14,26,0.55)'; ctx.fillRect(0, 0, VW, VH);
      R.panel(ctx, 4, 6, VW - 8, VH - 10, { style: 'screen', title: TITLES[c] || String(c).toUpperCase() });
      { const lab = c === 'plan' ? 'Aufstehen' : 'Verlassen'; const bw = R.measure(lab, 1) + R.measure('Esc', 1) + 18; R.button(ctx, VW - 8 - bw, 10, bw, 13, lab, { hotkey: 'Esc', onClick: () => view.actions.leave() }); }
      let controls = '';
      try {
        switch (c) {
          case 'helm': controls = this.drawHelm(ctx, view); break;
          case 'captain': controls = this.drawCaptain(ctx, view); break;
          case 'weapons': controls = this.drawWeapons(ctx, view); break;
          case 'transfer': controls = this.drawTransfer(ctx, view); break;
          case 'shop': controls = this.drawShop(ctx, view); break;
          case 'quartier': controls = this.drawQuartier(ctx, view); break;
          case 'sonde': controls = this.drawSonde(ctx, view); break;
          case 'plan': controls = this.drawPlan(ctx, view); break;
          default: R.text(ctx, 'Unbekannte Konsole: ' + c, 20, 40, { color: PAL.red });
        }
      } catch (e) { Net.reportError('Consoles.draw:' + c, e); R.text(ctx, 'Anzeigefehler (siehe Konsole)', 20, 60, { color: PAL.red }); }
      ctx.fillStyle = 'rgba(11,14,26,0.9)'; ctx.fillRect(8, VH - 17, VW - 16, 11);
      R.text(ctx, (controls ? controls + ' · ' : '') + (c === 'plan' ? 'Esc aufstehen' : 'Esc verlassen'), VW / 2, VH - 15, { color: PAL.amber, align: 'center', shadow: false });
      R.drawTooltip(ctx);
    },

    // ================================================================= Steuer (Frontsicht)
    helmAxes() {
      const k = this.keys, h = this.mouseHold;
      const left = (k.KeyA || k.ArrowLeft) && !k.ShiftLeft && !k.ShiftRight || h === 'left';
      const right = (k.KeyD || k.ArrowRight) && !k.ShiftLeft && !k.ShiftRight || h === 'right';
      // M3b: W/S schalten den Temporegler (eine Stufe je Tastendruck) – kein Dauerschub mehr
      return { turn: (right ? 1 : 0) - (left ? 1 : 0) };
    },
    // M3b §2/§5: Temporegler-Zustand aus ship.helm (stage/stages/stageNames/stop/agile/fwd/turnFactor), Fallback Config
    helmInfo(ship) {
      const h = ship.helm || {};
      const stages = Array.isArray(h.stages) && h.stages.length ? h.stages.map(Number) : (LERCHE.stages || [0]).map(s => Math.round(s * LERCHE.maxSpeed));
      let names = Array.isArray(h.stageNames) && h.stageNames.length === stages.length ? h.stageNames : LERCHE.stageNames;
      if (!names || names.length !== stages.length) names = stages.map((s, i) => String(i));
      // Pixel-Schrift kennt ¼/½/¾ nicht -> als Bruch schreiben
      names = names.map(s => String(s).replace('¼', '1/4').replace('½', '1/2').replace('¾', '3/4'));
      let stop = Number.isInteger(h.stop) ? h.stop : stages.indexOf(0);
      if (stop < 0) stop = 0;
      let agile = Number.isInteger(h.agile) ? h.agile : -1;
      if (agile < 0) { let bf = -1; stages.forEach((s, i) => { if (s < 0) return; const f = turnFactorOf(s); if (f > bf + 1e-9) { bf = f; agile = i; } }); }
      const ang = n(ship.angle);
      const fwd = h.fwd != null && isFinite(+h.fwd) ? +h.fwd : n(ship.vx) * Math.cos(ang) + n(ship.vy) * Math.sin(ang);
      const tf = h.turnFactor != null && isFinite(+h.turnFactor) ? +h.turnFactor : turnFactorOf(fwd);
      const has = Number.isInteger(h.stage);
      const server = has ? clamp(h.stage, 0, stages.length - 1) : stop;
      let stage = server;
      const p = this.helmPending;
      if (p) { if (p.from === server && performance.now() - p.t < 800) stage = clamp(p.stage, 0, stages.length - 1); else this.helmPending = null; }
      return { stages, names, stop, agile, fwd, tf, stage, server, live: has, speedFactor: h.speedFactor != null ? +h.speedFactor : null, autoStop: !!h.autoStop };
    },
    throttle(view, delta) {
      const hi = this.helmInfo(view.state.ship || {});
      const want = hi.stage + (delta > 0 ? 1 : -1);
      if (want < 0 || want >= hi.stages.length) { this.denied(delta > 0 ? 'Schon auf VOLL' : 'Schon auf Rückwärts (R)'); return; }
      view.send({ t: 'cmd', c: 'helm.throttle', delta: delta > 0 ? 1 : -1 });
      this.helmPending = { stage: want, from: hi.server, t: performance.now() };
      view.actions.sfx('ui_click');
    },
    setThrottle(view, idx) {
      const hi = this.helmInfo(view.state.ship || {});
      if (idx === hi.stage) return;
      view.send({ t: 'cmd', c: 'helm.throttle', set: idx });
      this.helmPending = { stage: idx, from: hi.server, t: performance.now() };
      view.actions.sfx('ui_click');
    },
    // Senkrechte Stufenleiste (VOLL oben, R unten), Ist-Tempo als Zeiger, „wendig“ an der wendigsten Stufe. Gibt die Höhe zurück.
    helmLadder(ctx, view, x, y, hi) {
      const N = hi.stages.length, rh = 13, lw = 32, sw = 12;
      const top = y, H = N * rh;
      ctx.fillStyle = '#121822'; ctx.fillRect(x, top, lw + sw + 3, H + 2);
      ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, top + 0.5, lw + sw + 2, H + 1);
      const rowY = (i) => top + 1 + (N - 1 - i) * rh;
      for (let i = 0; i < N; i++) {
        const ry = rowY(i);
        const on = i === hi.stage, rev = hi.stages[i] < 0, stop = i === hi.stop;
        ctx.fillStyle = on ? (stop ? PAL.amber : rev ? '#F08A3C' : PAL.mint) : rev ? '#2A1E22' : stop ? '#2A2618' : '#1E2733';
        ctx.fillRect(x + 1, ry, lw, rh - 1);
        if (i === hi.agile) { ctx.fillStyle = on ? 'rgba(11,14,26,0.35)' : 'rgba(169,214,229,0.3)'; ctx.fillRect(x + 1, ry, 3, rh - 1); }
        R.text(ctx, hi.names[i], x + 1 + lw / 2, ry + 3, { color: on ? PAL.space : rev ? '#C08070' : '#8EA3B5', align: 'center', shadow: false });
        if (i === hi.agile) R.text(ctx, 'wendig', x + lw + sw + 6, ry + 3, { color: i === hi.stage ? PAL.mint : PAL.ice });
        R.ui.buttons.push({ x: x, y: ry, w: lw + sw + 2, h: rh, label: 'Stufe ' + hi.names[i], reason: null, onClick: () => this.setThrottle(view, i) });
      }
      // Skala: Mitte jeder Zeile = Nenntempo der Stufe; Zeiger = Ist-Tempo (vorwärts, vorzeichenbehaftet)
      const sx = x + lw + 2;
      ctx.fillStyle = '#0B0E1A'; ctx.fillRect(sx, top + 1, sw, H);
      for (let i = 0; i < N; i++) { ctx.fillStyle = i === hi.stage ? PAL.mint : '#3A4658'; ctx.fillRect(sx, rowY(i) + 6, 4, 1); }
      const sp = hi.fwd;
      let py = rowY(hi.stop) + 6;
      const order = hi.stages.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
      if (sp <= order[0].s) py = rowY(order[0].i) + 6;
      else if (sp >= order[order.length - 1].s) py = rowY(order[order.length - 1].i) + 6;
      else for (let k = 1; k < order.length; k++) {
        const a = order[k - 1], b = order[k];
        if (sp <= b.s) { const f = b.s > a.s ? (sp - a.s) / (b.s - a.s) : 0; py = (rowY(a.i) + 6) + ((rowY(b.i) + 6) - (rowY(a.i) + 6)) * f; break; }
      }
      py = Math.round(py);
      const atTarget = Math.abs(sp - hi.stages[hi.stage] * (hi.speedFactor != null ? hi.speedFactor : 1)) < 2;
      ctx.fillStyle = atTarget ? PAL.mint : PAL.star;
      ctx.beginPath(); ctx.moveTo(sx + 2, py); ctx.lineTo(sx + sw, py - 4); ctx.lineTo(sx + sw, py + 4); ctx.closePath(); ctx.fill();
      return H + 2;
    },
    drawHelm(ctx, view) {
      const st = view.state, ship = st.ship || {};
      const rect = { x: 10, y: 26, w: 620, h: 292 };
      const fv = R.drawFrontView(ctx, view, rect);
      try { this.helmTurnGauge(ctx, view, fv); this.helmAlerts(ctx, view, fv); } catch (e) { Net.reportError('Consoles.helmM3', e); }
      const lx = 14, lw = fv.win.x - lx - 8;
      const rx = fv.win.x + fv.win.w + 8, rw = rect.x + rect.w - rx - 2;
      const w = R.worldOf(st);
      // ---- links: Ort, Temporegler, Tempo/Kurs/Drehen, Sprung
      let y = 30;
      R.text(ctx, 'ORT', lx, y, { color: PAL.brass }); y += 10;
      for (const l of R.wrap(R.locName(st, w.location), lw, 1).slice(0, 1)) { R.text(ctx, l, lx, y, { color: PAL.star }); y += 10; }
      const docked = ship.dockedAt || (ship.docked ? 'hafen' : null);
      if (docked) { R.text(ctx, 'ANGEDOCKT · W legt ab', lx, y, { color: PAL.amber }); y += 10; }
      y += 3;
      const hi = this.helmInfo(ship);
      const sp = n(ship.speed, Math.hypot(n(ship.vx), n(ship.vy)));
      const deg = Math.round(((n(ship.angle) * 180 / Math.PI) % 360 + 360) % 360);
      R.text(ctx, 'FAHRT', lx, y, { color: PAL.brass });
      R.text(ctx, 'W/S', lx + R.measure('FAHRT', 1) + 5, y, { color: PAL.panelLight }); y += 10;
      const lh = this.helmLadder(ctx, view, lx, y, hi);
      // rechts neben der Leiste: Tempo, Kurs, Drehfaktor
      const ix = lx + 96;
      let iy = y;
      R.text(ctx, 'TEMPO', ix, iy, { color: PAL.brass }); iy += 9;
      R.text(ctx, String(Math.round(hi.fwd < -0.5 ? hi.fwd : sp)), ix, iy, { color: hi.fwd < -0.5 ? '#F08A3C' : PAL.mint, scale: 2 }); iy += 17;
      R.text(ctx, 'KURS', ix, iy, { color: PAL.brass }); iy += 9;
      R.text(ctx, deg + '°', ix, iy, { color: PAL.mint, scale: 2 }); iy += 17;
      R.text(ctx, 'DREHEN', ix, iy, { color: PAL.brass }); iy += 9;
      const tfp = Math.round(hi.tf * 100);
      R.text(ctx, tfp + ' %', ix, iy, { color: tfp >= 95 ? PAL.mint : tfp >= 60 ? PAL.star : PAL.warn });
      y += lh + 3;
      const ax = this.helmAxes();
      const autoStop = hi.autoStop;
      const engDown = sysDown(ship, 'engines');
      let status, scol = PAL.panelLight;
      if (autoStop) { status = sp < 1 ? 'ALLSTOPP – steht' : 'ALLSTOPP – bremst'; scol = sp < 1 ? PAL.mint : PAL.amber; }
      else if (engDown) { status = 'Antrieb aus – kein Schub!'; scol = PAL.red; }
      else status = 'Stufe ' + hi.names[hi.stage] + ' · Ruder ' + (ax.turn > 0 ? 'Stb' : ax.turn < 0 ? 'Bb' : '–');
      R.text(ctx, status, lx, y, { color: scol });
      y += 12;
      const jump = ship.jump || {};
      R.text(ctx, 'SPRUNG', lx, y, { color: PAL.brass });
      R.bar(ctx, lx + 40, y + 2, lw - 40, 5, n(jump.charge), jump.ready ? PAL.mint : PAL.amber); y += 10;
      for (const l of R.wrap('Ziel: ' + (jump.dest ? R.locName(st, jump.dest) : 'keins (Captain)'), lw, 1).slice(0, 1)) { R.text(ctx, l, lx, y, { color: jump.dest ? PAL.star : PAL.panelLight }); y += 10; }
      let jumpReason = null;
      if (!jump.ready) jumpReason = jump.blockedReason || (!jump.dest ? 'Kein Ziel gewählt (Captain-Konsole)' : 'Sprungantrieb lädt (' + Math.round(n(jump.charge) * 100) + ' %)');
      R.button(ctx, lx, y, lw, 14, 'Faltsprung', { hotkey: 'F', disabled: !jump.ready, reason: jumpReason, active: !!jump.ready, onClick: () => this.cmd(view, 'helm.jump') }); y += 16;
      if (jumpReason && jump.dest) { for (const l of R.wrap(jumpReason, lw, 1).slice(0, 1)) { R.text(ctx, l, lx, y, { color: PAL.warn }); y += 10; } }
      // M3a/§20.3: Lanze (Taktik lädt auf und feuert) – der Pilot sieht, wann er den Bug aufs Ziel halten muss
      const bow = (ship.mounts || []).find(mm => mm.id === 'bow');
      if (bow && y < 254) {
        R.text(ctx, 'LANZE', lx, y, { color: PAL.brass });
        const bs = bow.state || (ship.systems || {}).weapon_bow || 'ok';
        const txt = bs === 'broken' ? 'AUS' : bow.charging ? 'LÄDT AUF' : n(bow.charge) >= 1 ? 'bereit' : 'lädt ' + Math.round(n(bow.charge) * 100) + ' %';
        R.text(ctx, txt, lx + 36, y, { color: bs === 'broken' ? PAL.red : bow.charging ? R.BURST_COL : n(bow.charge) >= 1 ? PAL.mint : PAL.panelLight });
        y += 10;
      }
      y = Math.max(y + 2, 266);
      {
        const stopR = docked ? 'Angedockt' : null;
        R.button(ctx, lx, y, lw, 14, autoStop ? (sp < 1 ? 'Allstopp: steht' : 'Allstopp: bremst …') : 'Allstopp', { hotkey: 'X', active: autoStop, disabled: !!stopR, reason: stopR, onClick: () => this.cmd(view, 'helm.stop', {}) });
        y += 16;
      }
      const cd = n(ship.dodgeCd);
      const dodgeReason = engDown ? 'Antrieb ausgefallen' : cd > 0 ? 'Abklingzeit ' + Math.ceil(cd) + ' s' : docked ? 'Angedockt' : null;
      const dw = Math.floor((lw - 2) / 2);
      R.button(ctx, lx, y, dw, 14, 'Ausw. Bb', { hotkey: 'Sh+A', disabled: !!dodgeReason, reason: dodgeReason, onClick: () => this.dodge(view, -1) });
      R.button(ctx, lx + dw + 2, y, dw, 14, 'Ausw. Stb', { hotkey: 'Sh+D', disabled: !!dodgeReason, reason: dodgeReason, onClick: () => this.dodge(view, 1) });
      y += 16;
      if (cd > 0 && !engDown) R.bar(ctx, lx, y, lw, 2, 1 - clamp(cd / ((LERCHE.dodge && LERCHE.dodge.cooldown) || (CFG.ship && CFG.ship.dodgeCooldown) || 7), 0, 1), PAL.amber);

      // ---- rechts: Schilde, Hülle, Reaktor, Marker
      y = 30;
      R.text(ctx, 'SCHILDE', rx, y, { color: PAL.brass });
      const hullFrac = ship.hullMax ? n(ship.hull) / ship.hullMax : n(ship.hull) / 100;
      R.text(ctx, 'Hülle ' + Math.round(n(ship.hull)), rx + rw, y, { color: hullFrac < 0.4 ? PAL.red : PAL.panelLight, align: 'right' }); y += 10;
      this.drawShieldUp(ctx, rx + 34, y + 26, ship, view);
      R.bar(ctx, rx + 74, y + 8, rw - 76, 5, hullFrac, hullFrac < 0.4 ? PAL.red : PAL.panelLight);
      const reactor = ship.reactor || {};
      const rs = reactor.state || 'online';
      R.text(ctx, 'Reaktor', rx + 74, y + 20, { color: PAL.panelLight });
      R.text(ctx, STATE_TXT[rs] || rs, rx + 74, y + 30, { color: rs === 'offline' ? PAL.red : rs === 'overload' ? PAL.amber : PAL.moss });
      if (rs === 'overload') R.text(ctx, fmt(reactor.overloadLeft), rx + rw, y + 30, { color: PAL.amber, align: 'right' });
      y += 58;
      R.text(ctx, 'MARKER', rx, y, { color: PAL.brass }); y += 11;
      const mk = R.markersOf(st);
      for (const who of ['captain', 'tactical']) {
        const m = mk[who];
        const col = R.MARKER_COL[who];
        R.shape(ctx, 'diamond', rx + 4, y + 4, 7, m ? col : '#3A4250');
        if (m) {
          const d = Math.round(Math.hypot(m.x - n(ship.x), m.y - n(ship.y)));
          const rel = Phys.normAngle(Math.atan2(m.y - n(ship.y), m.x - n(ship.x)) - n(ship.angle)) * 180 / Math.PI;
          const side = Math.abs(rel) < 8 ? 'voraus' : (rel > 0 ? 'Stb ' : 'Bb ') + Math.round(Math.abs(rel)) + '°';
          R.text(ctx, (who === 'captain' ? 'Captain ' : 'Taktik ') + d, rx + 12, y, { color: col });
          R.text(ctx, side, rx + rw, y, { color: col, align: 'right' });
        } else R.text(ctx, (who === 'captain' ? 'Captain' : 'Taktik') + ': –', rx + 12, y, { color: PAL.panelLight });
        y += 11;
      }
      y += 4;
      // Dock-Hinweis
      const dock = ((st.space && st.space.markers) || []).find(m => m.kind === 'dock');
      if (dock && !docked) {
        const d = Math.round(Math.hypot(dock.x - n(ship.x), dock.y - n(ship.y)));
        const maxSp = (CFG.flight && CFG.flight.dockSpeed) || 25;
        R.text(ctx, 'DOCK-RING ' + d, rx, y, { color: PAL.mint }); y += 10;
        R.text(ctx, 'langsam (≤ ' + maxSp + ') hinein', rx, y, { color: sp <= maxSp ? PAL.mint : PAL.warn }); y += 12;
      }
      if (R.inFog(st)) { R.text(ctx, 'Nebel: Sicht halbiert –', rx, y, { color: PAL.ice }); y += 10; R.text(ctx, 'Taktik lotst!', rx, y, { color: PAL.ice }); y += 12; }
      // Maussteuerung: Stufe +/− je Klick (oder Stufe in der Leiste anklicken), Ruder halten
      const by = 270;
      R.text(ctx, 'Maus: Stufe / Ruder halten', rx, by - 10, { color: PAL.panelLight });
      const bw2 = Math.floor((rw - 2) / 2);
      R.button(ctx, rx, by, bw2, 14, 'Stufe +', { hotkey: 'W', disabled: hi.stage >= hi.stages.length - 1, reason: 'Schon auf VOLL', onClick: () => this.throttle(view, 1) });
      R.button(ctx, rx + bw2 + 2, by, bw2, 14, 'Stufe −', { hotkey: 'S', disabled: hi.stage <= 0, reason: 'Schon auf Rückwärts (R)', onClick: () => this.throttle(view, -1) });
      const hb = (x, yy, label, id) => R.button(ctx, x, yy, bw2, 14, label, { active: this.mouseHold === id, onClick: () => { this.mouseHold = id; } });
      hb(rx, by + 16, '< Bb (A)', 'left'); hb(rx + bw2 + 2, by + 16, 'Stb (D) >', 'right');
      return 'W/S Fahrtstufe · A/D Ruder · Shift+A/D ausweichen · X Allstopp · F Faltsprung';
    },
    // Schildanzeige mit Bug nach oben (passend zur Frontsicht)
    drawShieldUp(ctx, x, y, ship, view) {
      const sh = ship.shields || {};
      const cur = sh.current || [0, 0, 0, 0];
      const hit = view.shipHit && view.shipHit.t < 0.5 ? view.shipHit.sector : -1;
      ctx.fillStyle = PAL.panelLight;
      ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 7, y + 9); ctx.lineTo(x, y + 6); ctx.lineTo(x - 7, y + 9); ctx.closePath(); ctx.fill();
      const pos = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // Bug oben, Steuerbord rechts
      const cap = Array.isArray(sh.cap) ? sh.cap : [4, 4, 4, 4];
      for (let i = 0; i < 4; i++) {
        const [dx, dy] = pos[i];
        for (let k = 0; k < 4; k++) {
          // M3a: über cap = gedimmt (½), cap 0 = rot
          const over = k >= n(cap[i], 4);
          ctx.fillStyle = hit === i ? (cur[i] ? PAL.star : PAL.red) : k < (cur[i] || 0) ? PAL.mint : over ? (n(cap[i], 4) <= 0 ? '#7A2420' : '#5A4A1A') : '#2E3A4A';
          if (dy) ctx.fillRect(x - 11 + k * 6, y + dy * (20 + 0) - 1, 4, 3);
          else ctx.fillRect(x + dx * 22 - 1, y - 11 + k * 6, 3, 4);
        }
      }
    },
    // M3a: Drehpfeil nach turnVel; Seite halbiert (beschädigte Düse, schraffiert „½“) oder gesperrt (zerstört, Schloss)
    helmTurnGauge(ctx, view, fv) {
      const ship = view.state.ship || {};
      if (ship.turnVel == null && !ship.turnCap) return;
      // M3b: Skala = volle Drehrate der Lerche; hell = bei diesem Tempo erreichbar (Drehfaktor aus turnCurve)
      const max = LERCHE.turnRate || (CFG.ship && CFG.ship.turnRate) || 0.5;
      const cx = fv.cx, half = 74, y = fv.win.y + fv.win.h - 22;
      const cap = ship.turnCap || { port: 1, stbd: 1 };
      const tf = clamp(this.helmInfo(ship).tf, 0, 1);
      ctx.fillStyle = 'rgba(11,14,26,0.78)'; ctx.fillRect(cx - half - 8, y - 12, half * 2 + 16, 28);
      R.text(ctx, 'DREHEN', cx - half - 4, y - 10, { color: PAL.brass });
      const tfp = Math.round(tf * 100);
      R.text(ctx, tfp + ' %', cx - half - 4 + R.measure('DREHEN', 1) + 4, y - 10, { color: tfp >= 95 ? PAL.mint : tfp >= 60 ? PAL.star : PAL.warn });
      const tv = n(ship.turnVel);
      R.text(ctx, Math.round(Math.abs(tv) * 180 / Math.PI) + '°/s ' + (tv > 0.01 ? 'Stb' : tv < -0.01 ? 'Bb' : ''), cx + half + 4, y - 10, { color: PAL.star, align: 'right' });
      ctx.fillStyle = '#141A24'; ctx.fillRect(cx - half, y, half * 2, 8);
      ctx.fillStyle = '#2A3A4C';
      const rp = Math.round(half * tf * n(cap.port, 1)), rs = Math.round(half * tf * n(cap.stbd, 1));
      ctx.fillRect(cx - rp, y, rp, 8); ctx.fillRect(cx, y, rs, 8);
      ctx.fillStyle = PAL.ice; ctx.fillRect(cx - rp, y - 1, 1, 10); ctx.fillRect(cx + rs - 1, y - 1, 1, 10);
      // Seitenkappung
      for (const [side, dir] of [['port', -1], ['stbd', 1]]) {
        const c = n(cap[side], 1);
        if (c >= 0.99) continue;
        const x0 = dir < 0 ? cx - half : cx + Math.round(half * c), w = Math.round(half * (1 - c));
        const locked = c <= 0.2;
        R.hatch(ctx, dir < 0 ? cx - half : cx + Math.round(half * c), y, w, 8, locked ? 'rgba(224,71,60,0.7)' : 'rgba(242,201,76,0.6)', 3);
        const lx = dir < 0 ? cx - half / 2 : cx + half / 2;
        if (locked) {
          // Schloss
          ctx.fillStyle = PAL.red; ctx.fillRect(lx - 4, y + 10, 8, 6);
          ctx.strokeStyle = PAL.red; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(lx, y + 10, 3, Math.PI, 0); ctx.stroke();
          R.text(ctx, (side === 'port' ? 'Bb' : 'Stb') + '-Düse AUS', lx + (dir < 0 ? -8 : 8), y + 9, { color: PAL.red, align: dir < 0 ? 'right' : 'left' });
        } else R.text(ctx, '1/2', lx, y + 9, { color: PAL.warn, align: 'center' });
        void x0;
      }
      ctx.fillStyle = PAL.brass; ctx.fillRect(cx, y - 2, 1, 12);
      // Sollwert (Ruder) als Rahmen, Istwert (turnVel) als Pfeil
      const ax = this.helmAxes();
      if (ax.turn) { const c = n(cap[ax.turn < 0 ? 'port' : 'stbd'], 1); const tx = cx + ax.turn * half * c * tf;ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1; ctx.strokeRect(Math.round(tx) - 2.5, y - 2.5, 5, 13); }
      const len = clamp(tv / max, -1, 1) * half;
      if (Math.abs(len) >= 1) {
        ctx.fillStyle = PAL.mint;
        ctx.fillRect(len > 0 ? cx : cx + len, y + 2, Math.abs(len), 4);
        const hx = cx + len, d = len > 0 ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(hx + d * 6, y + 4); ctx.lineTo(hx, y - 1); ctx.lineTo(hx, y + 9); ctx.closePath(); ctx.fill();
      }
    },
    // §20.2: Ausweich-Anzeige – laufende Ladung mit Seite und Countdown, grün im Ausweich-Fenster (left ≤ dodgeWindow);
    // §20.3: Hinweis, dass die Taktik die Lanze auflädt (Visierlinie zeichnet Render in der Frontsicht)
    helmAlerts(ctx, view, fv) {
      const st = view.state, ship = st.ship || {};
      const t = view.time;
      let y = fv.win.y + 22;
      const evadeAge = view.dodgeFx ? view.dodgeFx.age : 99;
      // laufende Ladungen (kürzeste zuerst)
      const teles = (((st.space && st.space.enemies) || [])).filter(e => e && e.tele).sort((a, b) => n(a.tele.left) - n(b.tele.left));
      if (evadeAge < 1.3) {
        const w = 200, h = 26, x = Math.round(fv.cx - w / 2);
        ctx.fillStyle = 'rgba(11,30,22,0.88)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = PAL.moss; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        R.text(ctx, 'AUSGEWICHEN!', fv.cx, y + 5, { color: '#8FD06A', scale: 2, align: 'center' });
        y += h + 4;
      } else if (teles.length) {
        const e = teles[0], te = e.tele;
        const left = Math.max(0, n(te.left)), win = m3('dodgeWindow', 0.8);
        const inWin = left <= win;
        const sec = te.sector != null ? (['BUG', 'STB', 'HECK', 'BB'][te.sector] || '') : '';
        const cd = n(ship.dodgeCd);
        const engDown = sysDown(ship, 'engines');
        const w = 236, h = 44, x = Math.round(fv.cx - w / 2);
        const col = inWin ? '#8FD06A' : '#FF5A4A';
        ctx.fillStyle = inWin ? 'rgba(14,40,24,0.9)' : 'rgba(40,12,14,0.86)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = col; ctx.lineWidth = inWin ? 2 : 1;
        if (!inWin) ctx.setLineDash([4, 3]);
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.setLineDash([]);
        const blink = inWin && Math.floor(t * 8) % 2;
        R.text(ctx, inWin ? (blink ? 'JETZT AUSWEICHEN!' : 'JETZT AUSWEICHEN!') : 'AUSWEICHEN! ' + f1(left), fv.cx, y + 4, { color: blink ? '#FFFFFF' : col, scale: 2, align: 'center' });
        const who = R.ENEMY_NAMES[e.kind] || e.kind;
        const sub = (te.kind === 'emp' ? 'EMP' : 'Schwerer Treffer') + ' auf ' + (sec || '?') + ' · ' + who + (teles.length > 1 ? ' (+' + (teles.length - 1) + ')' : '');
        R.text(ctx, sub, fv.cx, y + 21, { color: PAL.star, align: 'center' });
        // Zeitleiste: rotes Band, grünes Fenster am Ende, Marke = jetzt
        const bw = w - 20, bx = x + 10, by = y + 33, dur = Math.max(left, n(te.dur, 3));
        ctx.fillStyle = '#2A1416'; ctx.fillRect(bx, by, bw, 6);
        const gw = Math.round(bw * Math.min(1, win / dur));
        ctx.fillStyle = 'rgba(143,208,106,0.75)'; ctx.fillRect(bx + bw - gw, by, gw, 6);
        const px = Math.round(bx + bw * (1 - left / dur));
        ctx.fillStyle = PAL.star; ctx.fillRect(px - 1, by - 2, 3, 10);
        y += h + 2;
        const hint = engDown ? 'Antrieb aus – kein Ausweichen!' : cd > 0 ? 'Ausweichen lädt noch ' + Math.ceil(cd) + ' s' : 'Shift+A / Shift+D';
        R.text(ctx, hint, fv.cx, y, { color: engDown || cd > left ? PAL.red : cd > 0 ? PAL.warn : PAL.amber, align: 'center' });
        y += 12;
      }
      // Lanze lädt (Taktik hält Taste 1)
      const bow = (ship.mounts || []).find(mm => mm.id === 'bow');
      if (bow && bow.charging) {
        const w = 220, h = 26, x = Math.round(fv.cx - w / 2);
        ctx.fillStyle = 'rgba(11,14,26,0.82)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = R.BURST_COL; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        R.text(ctx, 'LANZE LÄDT – Bug aufs Ziel!', fv.cx, y + 3, { color: R.BURST_COL, align: 'center' });
        const p = clamp(n(bow.power), 0, 1);
        R.bar(ctx, x + 8, y + 15, w - 60, 6, p, p >= 1 ? PAL.mint : PAL.amber);
        R.text(ctx, f1(R.lanceDamage ? R.lanceDamage(bow) : 0) + ' Sch', x + w - 6, y + 14, { color: p >= 1 ? PAL.mint : PAL.amber, align: 'right' });
      }
    },
    dodge(view, dir) { view.send({ t: 'cmd', c: 'helm.dodge', dir }); view.actions.sfx('dodge'); },
    cycleZoom(which, dir) {
      const i = ZOOM_STEPS.indexOf(this.zoom[which]);
      const j = dir === -1 ? Math.max(0, (i < 0 ? 1 : i) - 1) : dir === 1 ? Math.min(ZOOM_STEPS.length - 1, (i < 0 ? 1 : i) + 1) : ((i + 1) % ZOOM_STEPS.length);
      this.zoom[which] = ZOOM_STEPS[j];
    },

    // ================================================================= Captain
    drawCaptain(ctx, view) {
      const st = view.state;
      const awayOn = this.awayActive(st);
      if (this.tab === TAB_AWAY && !awayOn) this.tab = 0;
      let x = 12;
      TABS.forEach((name, i) => {
        const w = R.measure(name, 1) + 22;
        const dis = i === TAB_AWAY && !awayOn;
        R.button(ctx, x, 26, w, 15, name, { hotkey: String(i + 1), active: this.tab === i, disabled: dis, reason: 'Nur während der Außenmission', onClick: () => { this.tab = i; } });
        x += w + 3;
      });
      const radio = st.mission && st.mission.radio;
      if (radio && radio.needsAccept && this.tab !== 0 && Math.floor(view.time * 2) % 2 === 0) R.text(ctx, 'Funk wartet! (Reiter 1)', VW - 14, 41, { color: PAL.amber, align: 'right' });
      // M3b: Schildstoß entfällt – oben rechts nur noch eine Schild-Übersicht mit Ladungs-Warnung (keine Knöpfe)
      if (this.tab !== 3) { try { this.shieldStrip(ctx, view, x + 2, 26); } catch (e) { Net.reportError('Consoles.shieldStrip', e); } }
      const area = { x: 12, y: 48, w: 616, h: 274 };
      switch (this.tab) {
        case 0: return this.capRadio(ctx, view, area);
        case 1: return this.capStar(ctx, view, area);
        case 2: return this.capLage(ctx, view, area);
        case 3: return this.capPower(ctx, view, area);
        case 4: return this.capDamage(ctx, view, area);
        case 5: return this.capAway(ctx, view, area);
      }
      return '';
    },

    // ---- Ladungen (erst in den letzten captainSeesLast s sichtbar). M3b: Schildstoß entfällt (Kai, §0.4).
    teleLate(view) {
      const late = m3('tele.captainSeesLast', 1.2);
      const out = [null, null, null, null];
      for (const e of view.enemies || []) {
        const te = e.tele;
        if (!te || te.sector == null || n(te.left) > late) continue;
        if (!out[te.sector] || n(te.left) < out[te.sector].left) out[te.sector] = { left: n(te.left), kind: te.kind, enemy: e.kind };
      }
      return out;
    },
    // kompakte Schild-Übersicht (alle Reiter außer „Energie & Schilde“): Füllstand + Durchlass-Farbe, Ladung rot. Keine Knöpfe.
    shieldStrip(ctx, view, x, y) {
      const ship = view.state.ship || {}, sh = ship.shields || {};
      if (!sh.current) return;
      const cur = sh.current || [0, 0, 0, 0], cap = sh.cap || [4, 4, 4, 4];
      const tele = this.teleLate(view);
      const order = [3, 0, 1, 2];   // Bb, Bug, Stb, Heck (Lesereihenfolge)
      const bw = 22;
      const SHORT = ['Bug', 'Stb', 'Hck', 'Bb'];
      R.text(ctx, 'SCHILD', x, y + 3, { color: PAL.brass });
      x += R.measure('SCHILD', 1) + 4;
      for (let j = 0; j < 4; j++) {
        const i = order[j];
        const bx = x + j * (bw + 1);
        const lk = leakText(n(cur[i]));
        ctx.fillStyle = '#26313F'; ctx.fillRect(bx, y, bw, 15);
        if (n(cap[i], 4) <= 0) R.crossX(ctx, bx, y, bw, 15, 'rgba(224,71,60,0.6)', 1);
        else if (n(cap[i], 4) < 4) R.hatch(ctx, bx, y, bw, 15, 'rgba(242,201,76,0.25)', 4);
        const tl = tele[i];
        if (!tl) R.text(ctx, SHORT[i], bx + 2, y + 1, { color: PAL.star });
        for (let k = 0; k < 4; k++) { ctx.fillStyle = k < n(cur[i]) ? PAL.mint : k >= n(cap[i], 4) ? '#5A2A26' : '#2E3A4A'; ctx.fillRect(bx + 2 + k * 4, y + 11, 3, 2); }
        ctx.fillStyle = lk.col; ctx.fillRect(bx + bw - 4, y + 10, 2, 3);   // Durchlass-Ampel
        if (tl) {
          ctx.strokeStyle = PAL.red; ctx.setLineDash([3, 2]); ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y + 0.5, bw - 1, 14); ctx.setLineDash([]);
          R.text(ctx, f1(tl.left), bx + bw / 2, y + 1, { color: PAL.red, align: 'center' });
        } else { ctx.strokeStyle = PAL.panel; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y + 0.5, bw - 1, 14); }
        const mo = R.ui.mouse || {};
        if (mo.x >= bx && mo.y >= y && mo.x < bx + bw && mo.y < y + 15) R.ui.tooltip = { text: H.SECTOR_NAMES[i] + ' ' + n(cur[i]) + ': ' + lk.long + ' (verteilen: Reiter 4)', x: mo.x, y: mo.y };
      }
    },

    // ---- Funk + Missionen + Logbuch
    capRadio(ctx, view, a) {
      const st = view.state, m = st.mission || {};
      const lw = 352;
      let y = a.y + 4;
      let shown = false;
      if (m.radio) {
        shown = true;
        const rl = R.wrap(m.radio.text || '', lw - 20, 1).slice(0, 8);
        const ph = 26 + rl.length * 10;
        R.panel(ctx, a.x, y, lw, ph, { style: 'brass' });
        R.text(ctx, 'FUNKSPRUCH · ' + (m.radio.from || '?'), a.x + 10, y + 6, { color: PAL.amber });
        let ly = y + 18;
        for (const l of rl) { R.text(ctx, l, a.x + 10, ly, { color: PAL.star }); ly += 10; }
        y += ph + 6;
        if (m.radio.needsAccept) { R.button(ctx, a.x, y, 160, 17, 'Funkspruch annehmen', { hotkey: 'Enter', onClick: () => this.cmd(view, 'captain.accept') }); y += 22; }
      }
      if (m.choice) {
        shown = true;
        R.text(ctx, 'ENTSCHEIDUNG', a.x, y, { color: PAL.brass }); y += 11;
        for (const l of R.wrap(m.choice.prompt || '', lw - 6, 1).slice(0, 4)) { R.text(ctx, l, a.x, y, { color: PAL.star }); y += 10; }
        y += 3;
        (m.choice.options || []).forEach((o, i) => {
          const reason = o.reason || (o.id === 'bribe' ? 'Nicht genug Marken' : 'Nicht verfügbar');
          R.button(ctx, a.x, y, lw, 17, o.label || o.id, { hotkey: ['Q', 'W', 'E'][i] || String(i + 1), disabled: !!o.disabled, reason, onClick: () => this.cmd(view, 'captain.choice', { option: o.id }) });
          y += 20;
        });
      }
      const tz = m.teaser;
      if (tz) {
        shown = true;
        y += 3;
        R.text(ctx, 'EMPFANG', a.x, y, { color: PAL.brass }); y += 11;
        if (tz.status !== 'ready') { R.text(ctx, 'Ein neuer Funkspruch wird empfangen …', a.x, y, { color: PAL.panelLight }); y += 12; }
        else {
          R.text(ctx, (tz.title || '') + ' – von ' + (tz.from || '?'), a.x, y, { color: PAL.amber }); y += 10;
          R.text(ctx, 'Quelle: ' + (tz.source === 'claude' ? 'Claude (live erzeugt)' : 'Archiv'), a.x, y, { color: PAL.panelLight }); y += 12;
        }
        if (tz.listenable !== false && (m.stage === 'port' || tz.listenable)) R.button(ctx, a.x, y, 200, 17, 'Neuen Funkspruch abhören', { hotkey: 'L', disabled: tz.status !== 'ready', reason: 'Wird noch empfangen', onClick: () => this.cmd(view, 'captain.listen') });
      }
      if (!shown) R.text(ctx, 'Kein Funkverkehr. Alles ruhig im Saumraum.', a.x, y + 4, { color: PAL.panelLight });

      // rechts: Missionen, Logbuch
      const rx = a.x + lw + 14, rw = a.w - lw - 14;
      let ry = a.y + 4;
      R.text(ctx, 'MISSION', rx, ry, { color: PAL.brass });
      const disc = m.discoveries || {};
      R.text(ctx, 'Entdeckungen ' + n(disc.found) + '/' + n(disc.total), rx + rw, ry, { color: PAL.mint, align: 'right' }); ry += 11;
      const act = m.active;
      if (act) {
        for (const l of R.wrap(act.title || act.id || '', rw, 1).slice(0, 2)) { R.text(ctx, l, rx, ry, { color: PAL.amber }); ry += 10; }
        for (const o of (act.objectives || []).slice(0, 5)) {
          const lines = R.wrap(o.text || '', rw - 12, 1).slice(0, 2);
          ctx.strokeStyle = o.done ? PAL.moss : PAL.panelLight; ctx.strokeRect(rx + 0.5, ry + 0.5, 6, 6);
          if (o.done) { ctx.fillStyle = PAL.moss; ctx.fillRect(rx + 2, ry + 2, 3, 3); }
          for (const l of lines) { R.text(ctx, l, rx + 10, ry, { color: o.done ? '#6E8A6A' : o.optional ? PAL.panelLight : PAL.star }); ry += 10; }
        }
      } else { R.text(ctx, 'Kein aktiver Auftrag – erkunden lohnt sich.', rx, ry, { color: PAL.panelLight }); ry += 10; }
      const list = (m.list || []).filter(x => !act || x.id !== act.id);
      if (list.length) {
        ry += 3;
        for (const it of list.slice(0, 3)) {
          const s = { done: 'erledigt', active: 'aktiv', open: 'offen', failed: 'verpasst' }[it.state] || it.state || '';
          R.text(ctx, '· ' + (it.title || it.id), rx, ry, { color: it.state === 'done' ? '#6E8A6A' : PAL.star });
          R.text(ctx, s, rx + rw, ry, { color: PAL.panelLight, align: 'right' }); ry += 10;
        }
      }
      ry += 6;
      R.text(ctx, 'LOGBUCH', rx, ry, { color: PAL.brass }); ry += 11;
      const log = (m.log || []).slice().reverse();
      if (!log.length) R.text(ctx, 'Noch keine Einträge.', rx, ry, { color: PAL.panelLight });
      for (const e of log) {
        const head = e.loc ? R.locName(st, e.loc) + ': ' : '';
        const lines = R.wrap(head + (e.text || ''), rw, 1);
        if (ry + lines.length * 10 > a.y + a.h) break;
        lines.forEach((l, i) => { R.text(ctx, l, rx, ry, { color: i === 0 && head ? PAL.ice : PAL.star }); ry += 10; });
        ry += 2;
      }
      return 'Enter annehmen · Q/W/E Entscheidung · L abhören · 1–6 / Tab Reiter';
    },

    // ---- Sternkarte
    visibleLocs(st) { return R.worldOf(st).locations.filter(R.locVisible); },
    capStar(ctx, view, a) {
      const st = view.state, ship = st.ship || {};
      const w = R.worldOf(st);
      const locs = this.visibleLocs(st);
      if (!this.starSel || !locs.some(l => l.id === this.starSel)) this.starSel = (ship.jump && ship.jump.dest) || w.location;
      const mapRect = { x: a.x, y: a.y, w: 410, h: a.h - 2 };
      this.maps.star = R.drawStarMap(ctx, view, mapRect, { selected: this.starSel, mouse: view.mouse, rects: this.starRects });
      const rx = a.x + 420, rw = a.w - 420;
      let y = a.y + 2;
      const loc = R.locById(st, this.starSel) || {};
      R.text(ctx, 'ORT', rx, y, { color: PAL.brass }); y += 11;
      for (const l of R.wrap(loc.known ? loc.name : 'Unbekanntes Signal', rw, 1).slice(0, 2)) { R.text(ctx, l, rx, y, { color: loc.known ? PAL.amber : PAL.panelLight }); y += 10; }
      R.text(ctx, loc.known ? (R.LOC_KIND_NAMES[loc.kind] || loc.kind || '') + (loc.fog ? ' · Nebel' : '') : 'Erkunden: anfliegen und nachsehen', rx, y, { color: PAL.panelLight }); y += 11;
      if (loc.known && loc.desc) { for (const l of R.wrap(loc.desc, rw, 1).slice(0, 4)) { R.text(ctx, l, rx, y, { color: PAL.star }); y += 10; } }
      if (loc.known && loc.discoveries && loc.discoveries.total) { R.text(ctx, 'Entdeckungen dort: ' + n(loc.discoveries.found) + '/' + loc.discoveries.total, rx, y, { color: PAL.mint }); y += 10; }
      const pins = ((st.plan && st.plan.pins) || []).filter(p => p.map === loc.id);
      if (pins.length) { R.text(ctx, 'Plan-Pins: ' + pins.map(p => R.PIN_NAMES[p.label] || p.label).join(', '), rx, y, { color: PAL.panelLight }); y += 10; }
      y += 4;
      const jump = ship.jump || {};
      let reason = null;
      if (loc.id === w.location) reason = 'Hier sind wir schon';
      else if (!R.locVisible(loc)) reason = 'Ort unbekannt';
      const cur = R.locById(st, w.location);
      const linked = cur && (cur.links || []).indexOf(loc.id) >= 0;
      R.button(ctx, rx, y, rw, 17, jump.dest === loc.id ? 'Sprungziel (gewählt)' : 'Als Sprungziel wählen', { hotkey: 'Enter', active: jump.dest === loc.id, disabled: !!reason, reason, onClick: () => this.cmd(view, 'captain.selectDest', { dest: loc.id }) }); y += 20;
      if (!reason && !linked && !w.fallback) { R.text(ctx, 'Keine direkte Verbindung', rx, y, { color: PAL.warn }); y += 10; }
      y += 4;
      R.text(ctx, 'SPRUNG', rx, y, { color: PAL.brass }); y += 11;
      R.text(ctx, 'Ziel: ' + (jump.dest ? R.locName(st, jump.dest) : 'keins'), rx, y, { color: PAL.star }); y += 10;
      R.bar(ctx, rx, y + 1, rw, 6, n(jump.charge), jump.ready ? PAL.mint : PAL.amber); y += 10;
      if (jump.blockedReason && !jump.ready) { for (const l of R.wrap(jump.blockedReason, rw, 1).slice(0, 2)) { R.text(ctx, l, rx, y, { color: PAL.warn }); y += 10; } }
      if (jump.ready) { R.text(ctx, 'Bereit – Steuer: F', rx, y, { color: PAL.mint }); y += 10; }
      y += 4;
      R.text(ctx, 'Legende: Linie = Route,', rx, y, { color: PAL.panelLight }); y += 10;
      R.text(ctx, 'gestrichelt = unerforscht, ? = Signal', rx, y, { color: PAL.panelLight });
      return 'Klick/←→ Ort wählen · Enter Sprungziel · 1–6 / Tab Reiter';
    },
    cycleStar(st, dir) {
      const locs = this.visibleLocs(st);
      if (!locs.length) return;
      const i = locs.findIndex(l => l.id === this.starSel);
      this.starSel = locs[(i + dir + locs.length) % locs.length].id;
    },

    // ---- Lage (lokale Karte, Captain-Marker, Scan)
    capLage(ctx, view, a) {
      const st = view.state, ship = st.ship || {};
      const rect = { x: a.x, y: a.y, w: 440, h: a.h - 2 };
      this.maps.lage = R.drawTactical(ctx, view, rect, { zoom: this.zoom.lage, arcs: false, intel: true, mode: 'lage', enemyRects: this.lageRects, showRanges: true });
      const rx = a.x + 450, rw = a.w - 450;
      let y = a.y + 2;
      R.text(ctx, 'LAGE · ' + R.locName(st, R.worldOf(st).location), rx, y, { color: PAL.brass }); y += 12;
      R.button(ctx, rx, y, rw, 15, 'Zoom ' + Math.round(this.zoom.lage * 100) + ' %', { hotkey: 'Z', onClick: () => this.cycleZoom('lage') }); y += 20;
      R.text(ctx, 'CAPTAIN-MARKER', rx, y, { color: PAL.brass }); y += 11;
      const mk = R.markersOf(st).captain;
      if (mk) { R.text(ctx, 'gesetzt · ' + Math.round(Math.hypot(mk.x - n(ship.x), mk.y - n(ship.y))) + ' px', rx, y, { color: PAL.mint }); y += 10; }
      R.text(ctx, 'Linksklick in die Karte', rx, y, { color: PAL.panelLight }); y += 10;
      R.text(ctx, 'setzt den Marker (Mint).', rx, y, { color: PAL.panelLight }); y += 12;
      R.button(ctx, rx, y, rw, 15, 'Marker löschen', { hotkey: 'X', disabled: !mk, reason: 'Kein Marker gesetzt', onClick: () => this.cmd(view, 'captain.marker', { clear: true }) }); y += 22;
      // Scan (Boje, Relaiskern …)
      const scan = ship.scan || {};
      R.text(ctx, 'SCAN', rx, y, { color: PAL.brass }); y += 11;
      // Server schickt ship.scan.target = { id, label, x, y, range } (Boje, Relaiskern …) oder null
      const stg = scan.target;
      let scanReason = scan.done && !stg ? 'Scan abgeschlossen' : null;
      if (!scanReason && st.world && !stg) scanReason = 'Kein Scanziel hier';
      if (!scanReason && !st.world && ship.scene && ship.scene !== 'buoy') scanReason = 'Nur bei der Boje B-7';
      if (stg) {
        const d = Math.round(Math.hypot(n(stg.x) - n(ship.x), n(stg.y) - n(ship.y)));
        R.text(ctx, String(stg.label || 'Scanziel'), rx, y, { color: PAL.star }); y += 10;
        R.text(ctx, 'Abstand ' + d + (stg.range ? ' / max. ' + stg.range : ''), rx, y, { color: !stg.range || d <= stg.range ? PAL.mint : PAL.warn }); y += 10;
        if (stg.range && d > stg.range) scanReason = 'Zu weit – näher heranfliegen (' + d + '/' + stg.range + ')';
      }
      R.bar(ctx, rx, y, rw, 6, n(scan.progress), scan.done ? PAL.moss : PAL.mint); y += 9;
      R.button(ctx, rx, y, rw, 16, this.scanOn ? 'Scanne … (halten)' : 'Scannen (halten)', { hotkey: 'Leer', active: this.scanOn, disabled: !!scanReason, reason: scanReason, onClick: () => { this.mouseHold = 'scan'; this.setScan(view, true); } }); y += 22;
      // Scan-Info gescannter Gegner
      const scanned = (view.enemies || []).filter(e => e.scanned);
      R.text(ctx, 'GESCANNTE ZIELE', rx, y, { color: PAL.brass }); y += 11;
      if (!scanned.length) { for (const l of R.wrap('Keine – die Taktik scannt Gegner (S halten).', rw, 1)) { R.text(ctx, l, rx, y, { color: PAL.panelLight }); y += 10; } }
      for (const e of scanned.slice(0, 4)) {
        R.text(ctx, R.ENEMY_NAMES[e.kind] || e.kind, rx, y, { color: PAL.amber }); y += 10;
        R.text(ctx, this.shieldText(e), rx + 4, y, { color: PAL.ice }); y += 11;
      }
      return 'Linksklick Captain-Marker · X löschen · Leertaste Scan · Z Zoom · 1–6 Reiter';
    },
    shieldText(e) {
      const s = e.shields || [], m = e.shieldsMax || [];
      const nm = ['Bug', 'Stb', 'Heck', 'Bb'];
      return 'Schild ' + nm.map((x, i) => x + ' ' + n(s[i]) + (n(m[i]) && n(m[i]) !== n(s[i]) ? '/' + n(m[i]) : '')).join(' ');
    },
    setScan(view, on) {
      if (this.scanOn === on) return;
      this.scanOn = on;
      this.scanRefreshT = 0;
      view.send({ t: 'cmd', c: 'captain.scan', on });
    },

    // ---- Energie & Schilde + Reaktor überladen
    capPower(ctx, view, a) {
      const st = view.state, ship = st.ship || {};
      const power = ship.power || {}, heat = ship.heat || {}, reactor = ship.reactor || {};
      const output = n(reactor.output, 8);
      const used = n(reactor.used, POWER_SYS.reduce((s, k) => s + n(power[k]), 0));
      let y = a.y + 4;
      R.text(ctx, 'ENERGIE', a.x, y, { color: PAL.brass });
      R.text(ctx, used + ' / ' + output + ' Einheiten verteilt', a.x + 60, y, { color: used >= output ? PAL.amber : PAL.mint });
      y += 13;
      POWER_SYS.forEach((sys, i) => {
        const sel = this.sel.power === i;
        const v = n(power[sys]);
        const state = (ship.systems || {})[sys] || 'ok';
        if (sel) { ctx.fillStyle = 'rgba(127,224,194,0.10)'; ctx.fillRect(a.x - 2, y - 2, 300, 28); }
        R.icon(ctx, sys, a.x + 6, y + 6, { color: H.STATE_COL[state] || PAL.red });
        R.text(ctx, POWER_NAMES[sys] || H.SYS_NAMES[sys], a.x + 16, y + 2, { color: sel ? PAL.amber : PAL.star });
        if (state !== 'ok') R.text(ctx, H.STATE_NAMES[state] || state, a.x + 16, y + 12, { color: H.STATE_COL[state] || PAL.red });
        const minusR = v <= 0 ? 'Minimum erreicht' : null;
        const plusR = v >= 4 ? 'Maximum (4)' : used >= output ? 'Reaktor ausgelastet – erst anderswo abziehen' : null;
        R.button(ctx, a.x + 110, y, 16, 16, '-', { disabled: !!minusR, reason: minusR, onClick: () => { this.sel.power = i; this.cmd(view, 'captain.power', { sys, delta: -1 }); } });
        for (let k = 0; k < 4; k++) { ctx.fillStyle = k < v ? (k === 3 ? PAL.amber : PAL.mint) : '#26313F'; ctx.fillRect(a.x + 130 + k * 22, y + 2, 20, 12); }
        R.button(ctx, a.x + 220, y, 16, 16, '+', { disabled: !!plusR, reason: plusR, onClick: () => { this.sel.power = i; this.cmd(view, 'captain.power', { sys, delta: 1 }); } });
        R.text(ctx, 'Hitze', a.x + 130, y + 17, { color: PAL.panelLight });
        const hv = n(heat[sys]);
        R.bar(ctx, a.x + 160, y + 18, 76, 4, hv / ((CFG.power && CFG.power.heatLimit) || 100), hv > 70 ? PAL.red : PAL.rust);
        y += 30;
      });
      // Reaktor (M1 §6)
      y += 4;
      const rs = reactor.state || 'online';
      const rcol = rs === 'offline' ? PAL.red : rs === 'overload' ? PAL.amber : PAL.moss;
      ctx.fillStyle = rs === 'offline' ? 'rgba(90,30,26,0.5)' : rs === 'overload' ? 'rgba(90,70,20,0.45)' : 'rgba(21,27,43,0.9)';
      ctx.fillRect(a.x, y, 300, a.y + a.h - y - 2);
      ctx.strokeStyle = rcol; ctx.strokeRect(a.x + 0.5, y + 0.5, 299, a.y + a.h - y - 3);
      y += 4;
      R.text(ctx, 'REAKTOR: ' + (STATE_TXT[rs] || rs), a.x + 6, y, { color: rcol });
      R.text(ctx, 'Leistung ' + output, a.x + 294, y, { color: PAL.panelLight, align: 'right' }); y += 12;
      // M3b §4: Reaktor-Autostart im Gefecht (reactor.autoIn = Restsekunden)
      if (n(reactor.autoIn) > 0) { R.text(ctx, 'Reaktor startet in ' + Math.ceil(reactor.autoIn) + ' s von selbst', a.x + 6, y, { color: PAL.mint }); y += 11; }
      const reactorDown = sysDown(ship, 'reactor');
      if (rs === 'online') {
        const ask = performance.now() - this.overloadAsk < 6000;
        const oReason = reactorDown ? 'Reaktor beschädigt – erst reparieren' : null;
        if (!ask) {
          R.text(ctx, '3 min +4 Energie, danach Abschaltung.', a.x + 6, y, { color: PAL.panelLight }); y += 10;
          R.text(ctx, 'Neustart nur zu zweit (zwei Schalter).', a.x + 6, y, { color: PAL.panelLight }); y += 12;
          R.button(ctx, a.x + 6, y, 180, 16, 'Reaktor überladen …', { hotkey: 'U', disabled: !!oReason, reason: oReason, onClick: () => { this.overloadAsk = performance.now(); } });
        } else {
          R.text(ctx, 'Wirklich überladen? Danach fällt der', a.x + 6, y, { color: PAL.amber }); y += 10;
          R.text(ctx, 'Reaktor aus (Notstrom 2)!', a.x + 6, y, { color: PAL.amber }); y += 12;
          R.button(ctx, a.x + 6, y, 140, 16, 'Ja, überladen', { hotkey: 'J', active: true, onClick: () => { this.overloadAsk = -1e9; this.cmd(view, 'captain.overload'); } });
          R.button(ctx, a.x + 152, y, 100, 16, 'Abbrechen', { hotkey: 'N', onClick: () => { this.overloadAsk = -1e9; } });
        }
      } else if (rs === 'overload') {
        const left = n(reactor.overloadLeft);
        R.text(ctx, 'Restzeit ' + fmt(left), a.x + 6, y, { color: left <= 30 ? (Math.floor(view.time * 2) % 2 ? PAL.red : PAL.amber) : PAL.amber, scale: 2 }); y += 18;
        R.bar(ctx, a.x + 6, y, 286, 5, left / OVERLOAD_TIME, left <= 30 ? PAL.red : PAL.amber); y += 9;
        R.text(ctx, 'Danach: Abschaltung, Neustart zu zweit.', a.x + 6, y, { color: PAL.panelLight });
      } else {
        R.text(ctx, 'Notstrom – Systeme von oben gekürzt.', a.x + 6, y, { color: PAL.star }); y += 10;
        R.text(ctx, 'Neustart: Schalter A (oben) und B (unten)', a.x + 6, y, { color: PAL.star }); y += 10;
        R.text(ctx, 'im Maschinenraum gleichzeitig halten (3 s).', a.x + 6, y, { color: PAL.star }); y += 12;
        const sw = reactor.switches || {};
        R.text(ctx, 'A ' + (sw.A ? 'gehalten' : '–') + '   B ' + (sw.B ? 'gehalten' : '–'), a.x + 6, y, { color: sw.A || sw.B ? PAL.mint : PAL.panelLight });
        R.bar(ctx, a.x + 150, y + 1, 140, 6, n(reactor.restartProgress), PAL.mint);
      }

      // Schilde rechts: Schiffssymbol mit 4 Sektoren
      const sh = ship.shields || {};
      const alloc = sh.alloc || [0, 0, 0, 0], cur = sh.current || [0, 0, 0, 0];
      const pool = n(sh.pool);
      const allocSum = alloc.reduce((s, v) => s + n(v), 0);
      const cx = a.x + 455, cy = a.y + 130;
      R.text(ctx, 'SCHILDE', a.x + 330, a.y + 4, { color: PAL.brass });
      R.text(ctx, 'Pool ' + allocSum + ' / ' + pool, a.x + 390, a.y + 4, { color: allocSum >= pool ? PAL.amber : PAL.mint });
      R.text(ctx, '(' + ((CFG.shields && CFG.shields.pointsPerPower) || 3) + ' je Energie, max 4 je Sektor)', a.x + 450, a.y + 4, { color: PAL.panelLight });
      if (sysDown(ship, 'shields')) R.text(ctx, 'Schildgenerator zerstört!', a.x + 470, a.y + 31, { color: PAL.red, align: 'center' });
      ctx.fillStyle = PAL.panelLight;
      ctx.beginPath(); ctx.moveTo(cx + 26, cy); ctx.lineTo(cx - 18, cy - 12); ctx.lineTo(cx - 24, cy); ctx.lineTo(cx - 18, cy + 12); ctx.closePath(); ctx.fill();
      const pos = [[cx + 95, cy], [cx, cy + 70], [cx - 95, cy], [cx, cy - 70]];
      const capA = Array.isArray(sh.cap) ? sh.cap : [4, 4, 4, 4];
      const tele = this.teleLate(view);
      const t = view.time;
      // M3b §4: Durchlass je Stärke – kleine Legende oben (Werte aus config.spaceM3b.shieldLeak)
      {
        let lx2 = a.x + 330;
        R.text(ctx, 'Systemschaden je Treffer:', lx2, a.y + 15, { color: PAL.panelLight });
        const leg = [[0, '0 offen'], [1, '1 Kratzer'], [2, '2'], [3, '3–4 dicht']];
        let ly2 = a.y + 25;
        for (const [s, lab] of leg) {
          const lk = leakText(s);
          const txt = s === 1 || s === 2 ? lab + ' ' + lk.short.replace('Kratzer ', '') : lab;
          ctx.fillStyle = lk.col; ctx.fillRect(lx2, ly2 + 2, 4, 4);
          R.text(ctx, txt, lx2 + 6, ly2, { color: lk.col });
          lx2 += R.measure(txt, 1) + 14;
        }
        void ly2;
      }
      for (let i = 0; i < 4; i++) {
        const [px, py] = pos[i];
        const sel = this.sel.power === 4 + i;
        const bw = 110, bh = 40;
        const bx = px - bw / 2, by = py - bh / 2;
        const cap = n(capA[i], 4);
        const em = EMITTER_OF[i], emSt = (ship.systems || {})[em] || 'ok';
        ctx.fillStyle = sel ? 'rgba(127,224,194,0.12)' : 'rgba(21,27,43,0.9)'; ctx.fillRect(bx, by, bw, bh);
        if (cap <= 0) R.crossX(ctx, bx, by, bw, bh, 'rgba(224,71,60,0.55)', 2);
        const tl = tele[i];
        if (tl) { ctx.strokeStyle = Math.floor(t * 8) % 2 ? PAL.red : '#FF8A7A'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2); ctx.setLineDash([]); ctx.lineWidth = 1; }
        ctx.strokeStyle = sel ? PAL.amber : PAL.panel; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        R.text(ctx, H.SECTOR_NAMES[i], bx + 5, by + 3, { color: sel ? PAL.amber : PAL.star });
        if (tl) R.text(ctx, f1(tl.left) + ' s!', bx + bw - 4, by + 3, { color: PAL.red, align: 'right' });
        else if (emSt !== 'ok') R.stateBadge(ctx, bx + bw - 38, by + 2, 34, 10, emSt, R.fragileOf(view.state, em), { code: cap <= 0 ? 'AUS' : cap < 4 ? '1/2' : undefined });
        else if (R.fragileOf(view.state, em)) R.stateBadge(ctx, bx + bw - 38, by + 2, 34, 10, 'ok', true);
        for (let k = 0; k < 4; k++) {
          const filled = k < n(cur[i]), wanted = k < n(alloc[i]);
          const over = k >= cap;
          const pxx = px - 22 + k * 12, pyy = by + 13;
          ctx.fillStyle = filled ? PAL.mint : over ? '#3A2A1A' : wanted ? '#2F5A50' : '#26313F';
          ctx.fillRect(pxx, pyy, 10, 8);
          if (over && cap > 0) R.hatch(ctx, pxx, pyy, 10, 8, 'rgba(242,201,76,0.7)', 3);
        }
        if (cap > 0 && cap < 4) R.text(ctx, '1/2', px + 28, by + 13, { color: PAL.warn });
        if (cap <= 0) R.text(ctx, 'AUS', px, by + 13, { color: PAL.red, align: 'center', scale: 1 });
        const minusR = n(alloc[i]) <= 0 ? 'Minimum erreicht' : null;
        const plusR = n(alloc[i]) >= 4 ? 'Maximum (4)' : allocSum >= pool ? 'Schildpool erschöpft – mehr Energie auf Schilde' : null;
        R.button(ctx, bx + 4, by + 25, 16, 13, '-', { disabled: !!minusR, reason: minusR, onClick: () => { this.sel.power = 4 + i; this.cmd(view, 'captain.shield', { sector: i, delta: -1 }); } });
        R.button(ctx, bx + bw - 20, by + 25, 16, 13, '+', { disabled: !!plusR, reason: plusR, onClick: () => { this.sel.power = 4 + i; this.cmd(view, 'captain.shield', { sector: i, delta: 1 }); } });
        // Durchlass bei aktueller Stärke
        const lk = leakText(n(cur[i]));
        R.text(ctx, n(cur[i]) + ': ' + lk.short, px, by + bh + 2, { color: lk.col, align: 'center' });
      }
      return '↑/↓ wählen · ←/→ verteilen · U überladen · Tab Reiter';
    },

    damageRows(st) {
      const ship = st.ship || {};
      const list = (H.SYSTEM_ORDER && ship.systems && Object.keys(ship.systems).length > 6) || CFG.spaceM3 ? H.SYSTEM_ORDER : SYSTEMS;
      const rows = list.map(s => ({ target: s, sys: true, label: H.SYS_NAMES[s], state: (ship.systems || {})[s] || 'ok' }));
      rows.push({ target: 'fire', label: 'Feuer löschen (' + ((ship.fires || []).length) + ')', state: (ship.fires || []).length ? 'broken' : 'ok' });
      rows.push({ target: 'breach', label: 'Lecks flicken (' + ((ship.breaches || []).length) + ')', state: (ship.breaches || []).length ? 'damaged' : 'ok' });
      rows.push({ target: null, label: 'Keine Priorität', state: 'ok' });
      return rows;
    },
    // M3a: Laufzeit von der Brücke (vor der Captain-Konsole) zu jeder Station, einmal per BFS
    walkTime(sys) {
      if (!this._walk) {
        const W = {};
        try {
          const m = Maps.ship;
          const con = m.find('C')[0] || { x: 37, y: 6 };
          let start = null;
          for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (!start && !m.solid(con.x + dx, con.y + dy)) start = { x: con.x + dx, y: con.y + dy };
          const dist = {};
          if (start) {
            const q = [start]; dist[start.x + ',' + start.y] = 0;
            while (q.length) {
              const c = q.shift();
              for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = c.x + dx, ny = c.y + dy, k = nx + ',' + ny;
                if (k in dist || m.solid(nx, ny)) continue;
                dist[k] = dist[c.x + ',' + c.y] + 1; q.push({ x: nx, y: ny });
              }
            }
          }
          const tps = ((CFG.player && CFG.player.speed) || 96) / TILE;
          for (const s of R.shipStations()) {
            let best = Infinity;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const d = dist[(s.x + dx) + ',' + (s.y + dy)]; if (d != null && d < best) best = d; }
            if (isFinite(best) && (W[s.system] == null || best / tps < W[s.system])) W[s.system] = best / tps;
          }
        } catch (e) { Net.reportError('Consoles.walkTime', e); }
        this._walk = W;
      }
      return this._walk[sys];
    },
    queueOf(ship, sys) { return (ship.repairQueue || []).find(q => q && q.system === sys) || null; },
    setRepair(view, sys, mode) {
      const ship = view.state.ship || {};
      const q = this.queueOf(ship, sys);
      const max = m3('repair.queueMax', 3);
      if (mode && !q && (ship.repairQueue || []).length >= max) { this.denied('Reparaturliste voll (' + max + ') – erst einen Eintrag entfernen'); return; }
      if (!mode && !q) return;
      this.cmd(view, 'captain.repair', { system: sys, mode: mode || null });
    },
    capDamage(ctx, view, a) {
      const st0 = view.state, ship0 = st0.ship || {};
      if (CFG.spaceM3 || ship0.repairQueue || (ship0.systems && ship0.systems.weapon_bow)) return this.capDamagePlan(ctx, view, a);
      return this.capDamageOld(ctx, view, a);
    },
    // M3a: Schadensplan (Listenversion) – alle 14 Systeme mit Ort, Zustand (dreifach), Laufzeit; Reparaturliste für die Bots
    capDamagePlan(ctx, view, a) {
      const st = view.state, ship = st.ship || {};
      const rows = this.damageRows(st);
      this.sel.damage = clamp(this.sel.damage, 0, rows.length - 1);
      const queue = ship.repairQueue || [];
      const max = m3('repair.queueMax', 3);
      let y = a.y + 1;
      R.text(ctx, 'SCHADENSPLAN', a.x, y, { color: PAL.brass });
      R.text(ctx, 'Bot-Liste ' + queue.length + '/' + max, a.x + 84, y, { color: queue.length >= max ? PAL.amber : PAL.panelLight });
      const auto = !!ship.botAuto;
      R.button(ctx, a.x + 170, y - 3, 148, 13, 'Bots automatisch: ' + (auto ? 'AN' : 'AUS'), { hotkey: 'A', active: auto, onClick: () => this.cmd(view, 'captain.botAuto', { on: !auto }) });
      y += 12;
      R.text(ctx, 'ORT', a.x, y, { color: PAL.panelLight }); R.text(ctx, 'SYSTEM', a.x + 34, y, { color: PAL.panelLight });
      R.text(ctx, 'ZUSTAND', a.x + 128, y, { color: PAL.panelLight }); R.text(ctx, 'WEG', a.x + 196, y, { color: PAL.panelLight, align: 'right' });
      R.text(ctx, 'BOTS', a.x + 202, y, { color: PAL.panelLight });
      y += 10;
      const bots = st.bots || [];
      const botName = (id) => { const i = bots.findIndex(b => b.id === id); return i >= 0 ? 'S' + (i + 1) : String(id || ''); };
      rows.forEach((r, i) => {
        const sel = this.sel.damage === i;
        const rh = 13;
        if (sel) { ctx.fillStyle = 'rgba(255,198,107,0.10)'; ctx.fillRect(a.x - 2, y - 1, 322, rh); ctx.strokeStyle = PAL.amber; ctx.strokeRect(a.x - 1.5, y - 0.5, 321, rh - 1); }
        if (r.sys) {
          const stn = R.stationOfSystem(r.target);
          const side = stn ? stn.side : 'mid';
          const fr = R.fragileOf(st, r.target);
          // Ort (Messingplakette) vor Zahl
          const lab = R.SIDE_SHORT[side] || '';
          ctx.fillStyle = PAL.brass; ctx.fillRect(a.x, y, 31, 10);
          R.text(ctx, lab, a.x + 15, y + 1, { color: PAL.space, align: 'center', shadow: false });
          R.text(ctx, H.SYS_SHORT[r.target] || r.label, a.x + 34, y + 1, { color: r.state === 'ok' && !fr ? PAL.panelLight : PAL.star });
          R.stateBadge(ctx, a.x + 128, y, 36, 10, r.state, fr);
          const wt = this.walkTime(r.target);
          // M3b §4: Eskalations-Countdown ersetzt die Laufzeit („Feuer in 12 s“), Zeile glimmt rot
          const esc = (ship.escalate || {})[r.target];
          if (esc != null) {
            const blink = n(esc) <= 5 && Math.floor(view.time * 4) % 2;
            ctx.strokeStyle = blink ? PAL.red : 'rgba(224,71,60,0.6)'; ctx.strokeRect(a.x - 1.5, y - 0.5, 199, rh - 1);
            const ecol = n(esc) <= 5 ? PAL.red : '#F08A3C';
            R.text(ctx, Math.ceil(n(esc)) + 's', a.x + 196, y + 1, { color: ecol, align: 'right' });
            // kleine Flamme vor dem Countdown
            const fx0 = a.x + 196 - R.measure(Math.ceil(n(esc)) + 's', 1) - 7;
            ctx.fillStyle = ecol; ctx.fillRect(fx0 + 1, y + 4, 4, 5); ctx.fillRect(fx0 + 2, y + 2, 2, 2);
            ctx.fillStyle = PAL.amber; ctx.fillRect(fx0 + 2, y + 6, 2, 3);
          } else R.text(ctx, wt != null ? f1(wt) + ' s' : '–', a.x + 196, y + 1, { color: PAL.panelLight, align: 'right' });
          const q = this.queueOf(ship, r.target);
          const needs = r.state !== 'ok' || fr;
          const dis = !needs && !q;
          R.button(ctx, a.x + 202, y - 1, 42, 12, 'Flicken', { active: !!(q && q.mode === 'flick'), disabled: dis, reason: 'System ist heil', onClick: () => { this.sel.damage = i; this.setRepair(view, r.target, 'flick'); } });
          R.button(ctx, a.x + 246, y - 1, 28, 12, 'Teil', { active: !!(q && q.mode === 'part'), disabled: dis, reason: 'System ist heil', onClick: () => { this.sel.damage = i; this.setRepair(view, r.target, 'part'); } });
          R.button(ctx, a.x + 276, y - 1, 14, 12, '—', { disabled: !q, reason: 'Nicht in der Liste', onClick: () => { this.sel.damage = i; this.setRepair(view, r.target, null); } });
          if (q) R.text(ctx, q.bot ? botName(q.bot) : '…', a.x + 293, y + 1, { color: q.bot ? PAL.amber : PAL.panelLight });
          if (ship.priority === r.target) R.text(ctx, '1.', a.x + 310, y + 1, { color: PAL.amber });
        } else {
          const active = (ship.priority || null) === r.target;
          R.button(ctx, a.x, y - 1, 196, 12, r.label, { active, onClick: () => { this.sel.damage = i; this.cmd(view, 'captain.priority', { target: r.target }); } });
          if (active) R.text(ctx, 'PRIO', a.x + 202, y + 1, { color: PAL.amber });
        }
        y += rh;
      });
      // rechts: Decksplan, Feuer/Lecks, Schrauber, Lager
      const px = a.x + 332, pw = a.w - 332;
      const cell = Math.max(3, Math.min(8, Math.floor(pw / Maps.ship.w)));
      R.drawMiniPlan(ctx, view, px, a.y + 4, { zone: 'ship', cell });
      let ly = a.y + 4 + Maps.ship.h * cell + 8;
      const fires = ship.fires || [], br = ship.breaches || [];
      R.text(ctx, 'Feuer: ' + (fires.length ? roomList(fires, 3) : 'keine'), px, ly, { color: fires.length ? PAL.red : PAL.moss }); ly += 11;
      R.text(ctx, 'Lecks: ' + (br.length ? roomList(br.map(b => [b.tx, b.ty]), 3) : 'keine'), px, ly, { color: br.length ? PAL.ice : PAL.moss }); ly += 11;
      // M3b §4: Eskalation – unbearbeitete Schäden im Gefecht fangen Feuer
      const escl = Object.keys(ship.escalate || {}).map(k => [k, n(ship.escalate[k])]).sort((p, q) => p[1] - q[1]);
      if (escl.length) {
        const txt = escl.slice(0, 2).map(([k, s]) => (H.SYS_SHORT[k] || k) + ' brennt in ' + Math.ceil(s) + ' s').join(' · ') + (escl.length > 2 ? ' …' : '');
        R.text(ctx, txt, px, ly, { color: escl[0][1] <= 5 && Math.floor(view.time * 4) % 2 ? PAL.red : '#F08A3C' }); ly += 11;
      } else { R.text(ctx, 'Unbearbeitet im Gefecht: Feuer nach ' + (((CFG.spaceM3b || {}).escalation || {}).after || 20) + ' s', px, ly, { color: PAL.panelLight }); ly += 11; }
      ly += 3;
      R.text(ctx, 'SCHRAUBER', px, ly, { color: PAL.brass });
      R.text(ctx, auto ? 'füllen die Liste selbst' : 'Systeme nur aus der Liste', px + 62, ly, { color: PAL.panelLight }); ly += 11;
      bots.forEach((b, i) => {
        const KIND = { repair: 'repariert', flick: 'flickt', swap: 'baut Teil ein', extinguish: 'löscht', patch: 'dichtet ab', fetch: 'holt Teil', switch: 'hält Reaktorschalter' };
        const task = b.task ? (KIND[b.task.kind] || b.task.kind) + (b.task.system ? ' ' + (H.SYS_SHORT[b.task.system] || b.task.system) : ' – ' + H.roomOf(Math.floor(b.task.x / TILE) || 0, Math.floor(b.task.y / TILE) || 0)) : 'wartet';
        R.text(ctx, 'S' + (i + 1) + ': ' + task, px, ly, { color: b.task ? PAL.star : PAL.panelLight }); ly += 10;
      });
      const inv = st.inventory || {};
      ly += 4;
      const stock = (it) => (R.shelfStock ? R.shelfStock(inv, it) : n(inv[it]));
      R.text(ctx, 'Ersatzteile ' + stock('ersatzteil') + ' · Flickbleche ' + stock('flickblech') + ' · Löschgel ' + stock('loeschgel'), px, ly, { color: stock('ersatzteil') ? PAL.panelLight : PAL.warn }); ly += 11;
      R.text(ctx, 'Flicken = schnell, fragil · Teil = heil', px, ly, { color: PAL.panelLight }); ly += 10;
      R.text(ctx, 'Minispiel (vor Ort, R) = dauerhaft', px, ly, { color: PAL.panelLight });
      return 'W/S wählen · F/Enter flicken · T Teil · Entf entfernen · P an die Spitze · A Bots automatisch · Tab Reiter';
    },
    capDamageOld(ctx, view, a) {
      const st = view.state, ship = st.ship || {};
      const rows = this.damageRows(st);
      this.sel.damage = clamp(this.sel.damage, 0, rows.length - 1);
      let y = a.y + 4;
      R.text(ctx, 'PRIORITÄT FÜR SCHRAUBER', a.x, y, { color: PAL.brass }); y += 12;
      rows.forEach((r, i) => {
        const active = (ship.priority || null) === r.target;
        const sel = this.sel.damage === i;
        const b = R.button(ctx, a.x, y, 250, 16, r.label, { active, onClick: () => { this.sel.damage = i; this.cmd(view, 'captain.priority', { target: r.target }); } });
        if (sel) { ctx.strokeStyle = PAL.amber; ctx.strokeRect(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3); }
        if (r.target && SYSTEMS.indexOf(r.target) >= 0) R.text(ctx, H.STATE_NAMES[r.state] || r.state, a.x + 245, y + 4, { color: H.STATE_COL[r.state] || PAL.red, align: 'right' });
        if (active) R.text(ctx, 'PRIO', a.x + 256, y + 4, { color: PAL.amber });
        y += 19;
      });
      const px = a.x + 300;
      const cell = Math.max(3, Math.min(8, Math.floor((a.w - 300) / Maps.ship.w)));
      R.drawMiniPlan(ctx, view, px, a.y + 10, { zone: 'ship', cell });
      let ly = a.y + 10 + Maps.ship.h * cell + 10;
      const fires = ship.fires || [], br = ship.breaches || [];
      R.text(ctx, 'Feuer: ' + (fires.length ? roomList(fires, 4) : 'keine'), px, ly, { color: fires.length ? PAL.red : PAL.moss }); ly += 11;
      R.text(ctx, 'Lecks: ' + (br.length ? roomList(br.map(b => [b.tx, b.ty]), 4) : 'keine'), px, ly, { color: br.length ? PAL.ice : PAL.moss }); ly += 14;
      R.text(ctx, 'SCHRAUBER', px, ly, { color: PAL.brass }); ly += 11;
      (st.bots || []).forEach((b, i) => {
        const task = b.task ? ({ repair: 'repariert', extinguish: 'löscht', patch: 'flickt', fetch: 'holt Teil', switch: 'hält Reaktorschalter' }[b.task.kind] || b.task.kind) + ' – ' + H.roomOf(Math.floor(b.task.x / TILE) || 0, Math.floor(b.task.y / TILE) || 0) : 'wartet';
        R.text(ctx, 'Schrauber ' + (i + 1) + ': ' + task, px, ly, { color: b.task ? PAL.star : PAL.panelLight }); ly += 10;
      });
      const inv = st.inventory || {};
      ly += 4;
      const stock = (it) => (R.shelfStock ? R.shelfStock(inv, it) : n(inv[it]));
      R.text(ctx, 'Ersatzteile ' + stock('ersatzteil') + ' · Flickbleche ' + stock('flickblech') + ' · Löschgel ' + stock('loeschgel'), px, ly, { color: PAL.panelLight }); ly += 11;
      const empty = R.emptyShelves ? R.emptyShelves(inv) : [];
      if (empty.length) R.text(ctx, 'Lager leer: ' + empty.map(it => (R.SHELF_LABEL && R.SHELF_LABEL[it]) || it).join(', '), px, ly, { color: PAL.red });
      else R.text(ctx, 'Lager: alle Regale bestückt', px, ly, { color: PAL.moss });
      return '↑/↓ wählen · Enter Priorität setzen · 1–6 / Tab Reiter';
    },

    // ---- M2: Außenteam auf v2-Karten (Kesh) – Kommandokarte, Befehle, Team-Schilde (CONTRACT-M2 §6, §9)
    order: { kind: 'sammeln' },
    capAwayV2(ctx, view, a) {
      const st = view.state, away = st.away || {}, sup = st.support || {};
      const lx = a.x, lw = 236;
      let y = a.y + 2;
      R.text(ctx, 'MOND KESH · KUSTODEN-ARCHIV', lx, y, { color: PAL.brass }); y += 11;
      const q = away.scanQuality == null ? 1 : n(away.scanQuality, 1);
      const jam = away.jammers || [];
      const jamOn = jam.filter(j => !j.off).length;
      if (q < 1) R.text(ctx, 'SCAN GESTÖRT (' + Math.round(q * 100) + ' %) · ' + jamOn + ' Störrelais an', lx, y, { color: PAL.warn });
      else R.text(ctx, 'SCAN KLAR – Schildwerte sichtbar', lx, y, { color: PAL.mint });
      y += 10;
      const open = !!(away.vault && away.vault.open);
      const keys = away.keys || [];
      R.text(ctx, open ? 'Tor: offen' : 'Tor: zu · Schlüssel ' + keys.map(k => Math.round(n(k.t) * 100) + ' %').join(' / '), lx, y, { color: open ? PAL.mint : PAL.panelLight }); y += 10;
      R.text(ctx, 'Tafel: ' + (away.tablet && away.tablet.taken ? 'geborgen (' + n((st.inventory || {}).tafel) + ' an Bord/Team)' : 'im Gewölbe'), lx, y, { color: away.tablet && away.tablet.taken ? PAL.amber : PAL.panelLight }); y += 14;
      // Befehlsleiste
      R.text(ctx, 'BEFEHLE', lx, y, { color: PAL.brass });
      R.text(ctx, 'Klick setzt · Rechtsklick löscht', lx + 46, y, { color: PAL.panelLight }); y += 11;
      const keysOf = { sammeln: 'Q', halten: 'W', flanke: 'E', rueckzug: 'R', fokus: 'F', gefahr: 'G' };
      R.ORDER_KINDS.forEach((k, i) => {
        const bx = lx + (i % 2) * 119, by = y + Math.floor(i / 2) * 17;
        R.button(ctx, bx, by, 115, 15, R.ORDER_NAMES[k] + (k === 'fokus' ? ' (Gegner)' : ''), { hotkey: keysOf[k], active: this.order.kind === k, color: R.ORDER_COL[k], onClick: () => { this.order.kind = k; } });
      });
      y += 3 * 17 + 2;
      const orders = R.activeOrders(st);
      const mine = orders.find(o => o.kind === this.order.kind);
      R.button(ctx, lx, y, 115, 14, 'Befehl löschen', { hotkey: 'X', disabled: !mine, reason: 'Kein „' + R.ORDER_NAMES[this.order.kind] + '“ gesetzt', onClick: () => this.sendOrder(view, { kind: this.order.kind, clear: true }) });
      R.button(ctx, lx + 119, y, 115, 14, 'Alle löschen', { disabled: !orders.length, reason: 'Keine Befehle gesetzt', onClick: () => { for (const o of orders) this.sendOrder(view, { kind: o.kind, clear: true }); } });
      y += 17;
      const maxO = (CFG.awayCombat && CFG.awayCombat.orders && CFG.awayCombat.orders.max) || 3;
      R.text(ctx, 'Aktiv ' + orders.length + '/' + maxO + ': ' + (orders.length ? orders.map(o => R.ORDER_NAMES[o.kind] + (o.until != null && st.time != null ? ' ' + Math.max(0, Math.ceil(o.until - st.time)) + 's' : '')).join(' · ') : '–'), lx, y, { color: orders.length ? PAL.star : PAL.panelLight });
      y += 13;
      // Orbit-Hilfen
      const sCd = n(sup.sensor), kCd = n(sup.kuppel);
      R.button(ctx, lx, y, 115, 15, 'Sensor 10 s' + (sCd > 0 ? ' (' + Math.ceil(sCd) + ')' : ''), { hotkey: 'S', disabled: sCd > 0, reason: 'Abklingzeit ' + Math.ceil(sCd) + ' s', onClick: () => this.cmd(view, 'captain.support', { kind: 'sensor' }) });
      R.button(ctx, lx + 119, y, 115, 15, 'Kuppel 20 s' + (kCd > 0 ? ' (' + Math.ceil(kCd) + ')' : ''), { hotkey: 'K', disabled: kCd > 0, reason: 'Abklingzeit ' + Math.ceil(kCd) + ' s', onClick: () => this.cmd(view, 'captain.support', { kind: 'kuppel' }) });
      y += 20;
      // Außenteam-Schilde
      R.text(ctx, 'AUSSENTEAM · SCHILDE', lx, y, { color: PAL.brass }); y += 11;
      const team = (st.players || []).filter(p => p.zone === 'away');
      if (!team.length) R.text(ctx, 'Niemand unten.', lx, y, { color: PAL.panelLight });
      for (const p of team) {
        const col = PAL.players[p.color || 0];
        R.shape(ctx, R.SHAPES[p.color || 0], lx + 5, y + 4, 8, col);
        R.text(ctx, String(p.name).slice(0, 10), lx + 13, y, { color: col });
        if (p.downed) R.text(ctx, 'VERWUNDET' + (p.bleed != null ? ' ' + Math.ceil(p.bleed) + ' s' : ''), lx + 80, y, { color: PAL.red });
        else if (Array.isArray(p.sh)) R.drawShieldPips(ctx, lx + 80, y, p.sh[0], p.sh[1], n(p.shR), 8, 2);
        if (!p.downed) {
          const cv = n(p.cv);
          R.text(ctx, p.fl ? 'FLANKE!' : cv >= 2 ? 'Deckung' : cv === 1 ? 'halb' : '', lx + 140, y, { color: p.fl ? PAL.red : cv >= 2 ? PAL.mint : PAL.amber });
        }
        if (p.medkit) R.text(ctx, '+', lx + 190, y, { color: PAL.red });
        if (p.connected === false) R.text(ctx, 'getrennt', lx + 196, y, { color: PAL.grey });
        y += 11;
      }
      // Karte rechts
      const rect = { x: a.x + 246, y: a.y + 2, w: a.w - 246, h: 196 };
      this.maps.away = Object.assign(R.drawAwayCommandMap(ctx, view, rect, { highlight: this.order.hoverEnemy }), { rect });
      // Legende/Gegnerlage unter der Karte
      let ly = rect.y + rect.h + 6;
      const alive = (view.drones || []).filter(d => d.alive !== false);
      const sc = alive.filter(d => d.kind !== 'warden').length, wd = alive.find(d => d.kind === 'warden');
      R.text(ctx, 'GEGNERLAGE', rect.x, ly, { color: PAL.brass });
      R.text(ctx, (q < 1 ? 'ca. ' : '') + sc + ' Plünderer' + (wd ? ' · Wächter ' + (wd.asleep ? 'schläft' : 'WACH') : ''), rect.x + 70, ly, { color: wd && !wd.asleep ? PAL.red : PAL.star });
      ly += 11;
      const lines = [];
      if (q < 1) lines.push(['Störrelais verrauschen den Scan – Außenteam: E halten am Relais (Nord- und Südkorridor).', PAL.panelLight]);
      lines.push(['Gewählt: ' + R.ORDER_NAMES[this.order.kind] + (this.order.kind === 'fokus' ? ' – Gegner anklicken (8 s für alle sichtbar)' : ' – Klick auf die Karte setzt die Lichtsäule'), R.ORDER_COL[this.order.kind]]);
      for (const [txt, col] of lines) for (const l of R.wrap(txt, rect.w - 4, 1).slice(0, 2)) { R.text(ctx, l, rect.x, ly, { color: col }); ly += 10; }
      return 'Q/W/E/R/F/G Befehl wählen · Klick setzen · X löschen · S Sensor · K Kuppel · 1–6 / Tab Reiter';
    },
    sendOrder(view, fields) {
      this.cmd(view, 'captain.order', fields);
    },
    // Klick in die Kommandokarte (Captain, Reiter Außenteam auf v2-Karten)
    awayMapClick(view, x, y, button) {
      const mp = this.maps.away;
      if (!mp || !mp.rect || !this.inRect(x, y, mp.rect)) return false;
      const kind = this.order.kind;
      if (button === 2) { this.sendOrder(view, { kind, clear: true }); return true; }
      const w = mp.toW(x, y);
      let hitE = null;
      for (const r of mp.enemyRects || []) if (this.inRect(x, y, { x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 })) { hitE = r; break; }
      if (kind === 'fokus') {
        if (!hitE) { this.denied('Fokus: einen Gegner auf der Karte anklicken'); return true; }
        const e = (view.drones || []).find(d => d.id === hitE.id);
        this.sendOrder(view, { kind, x: Math.round(e ? e.x : w.x), y: Math.round(e ? e.y : w.y), target: hitE.id });
        return true;
      }
      this.sendOrder(view, { kind, x: Math.round(w.x), y: Math.round(w.y), target: hitE ? hitE.id : undefined });
      return true;
    },

    capAway(ctx, view, a) {
      const st = view.state, away = st.away || {}, sup = st.support || {};
      if (this.isAwayV2(st)) return this.capAwayV2(ctx, view, a);
      let y = a.y + 4;
      const wreck = R.awayMapId(st) === 'wreck';
      if (wreck) {
        R.text(ctx, 'WRACK „ZAUNKÖNIG“', a.x, y, { color: PAL.brass }); y += 14;
        const sal = away.salvage || [];
        R.text(ctx, 'Bergungscontainer: ' + sal.filter(s => s.done).length + '/' + sal.length + ' geborgen', a.x, y, { color: PAL.star }); y += 11;
        const hv = away.hollow;
        R.text(ctx, 'Hohlraum: ' + (!hv ? 'unbekannt' : hv.open ? 'geöffnet' : hv.marked ? 'markiert (E halten 4 s)' : 'nicht gefunden – Taktik: Weitscan'), a.x, y, { color: hv && hv.marked ? PAL.amber : PAL.panelLight }); y += 16;
      } else {
        R.text(ctx, 'CODETABELLE DER SONDE', a.x, y, { color: PAL.brass }); y += 14;
        const table = away.codeTable || {};
        const syms = Object.keys(table);
        if (!syms.length) R.text(ctx, 'Keine Daten – erst Boje scannen.', a.x, y, { color: PAL.panelLight });
        syms.forEach((sym, i) => {
          const col = table[sym];
          const x = a.x + (i % 2) * 150, yy = y + Math.floor(i / 2) * 20;
          ctx.fillStyle = 'rgba(21,27,43,0.9)'; ctx.fillRect(x, yy, 142, 17);
          R.icon(ctx, sym, x + 9, yy + 8, { color: PAL.star });
          R.text(ctx, (SYMBOL_NAMES[sym] || sym), x + 20, yy + 5, { color: PAL.star });
          ctx.fillStyle = CODE_HEX[col] || '#888'; ctx.fillRect(x + 78, yy + 4, 9, 9);
          R.text(ctx, COLOR_NAMES[col] || col, x + 91, yy + 5, { color: CODE_HEX[col] || PAL.star });
        });
        y += Math.ceil(syms.length / 2) * 20 + 8;
        const sym = (away.sonde && away.sonde.symbols) || [];
        if (sym.length) { R.text(ctx, 'Sonde zeigt: ' + sym.map(s => SYMBOL_NAMES[s] || s).join(' – '), a.x, y, { color: PAL.amber }); y += 14; }
      }
      R.text(ctx, 'ORBIT-UNTERSTÜTZUNG', a.x, y, { color: PAL.brass }); y += 12;
      const sCd = n(sup.sensor), kCd = n(sup.kuppel);
      R.button(ctx, a.x, y, 290, 17, 'Sensor: Gegner 10 s sichtbar' + (sCd > 0 ? ' (' + Math.ceil(sCd) + ' s)' : ''), { hotkey: 'S', disabled: sCd > 0, reason: 'Abklingzeit ' + Math.ceil(sCd) + ' s', onClick: () => this.cmd(view, 'captain.support', { kind: 'sensor' }) }); y += 21;
      R.button(ctx, a.x, y, 290, 17, 'Schildkuppel 20 s (−2 Schildpool)' + (kCd > 0 ? ' (' + Math.ceil(kCd) + ' s)' : ''), { hotkey: 'K', disabled: kCd > 0, reason: 'Abklingzeit ' + Math.ceil(kCd) + ' s', onClick: () => this.cmd(view, 'captain.support', { kind: 'kuppel' }) }); y += 25;
      R.text(ctx, 'AUSSENTEAM', a.x, y, { color: PAL.brass }); y += 12;
      const team = (st.players || []).filter(p => p.zone === 'away');
      if (!team.length) R.text(ctx, 'Niemand unten.', a.x, y, { color: PAL.panelLight });
      for (const p of team) {
        R.shape(ctx, R.SHAPES[p.color || 0], a.x + 5, y + 4, 8, PAL.players[p.color || 0]);
        R.text(ctx, String(p.name).slice(0, 12), a.x + 14, y, { color: PAL.players[p.color || 0] });
        R.bar(ctx, a.x + 100, y + 1, 100, 6, n(p.hp, 100) / 100, p.downed ? PAL.red : PAL.moss);
        if (p.downed) R.text(ctx, 'außer Gefecht', a.x + 206, y, { color: PAL.red });
        y += 11;
      }
      const map = R.mapFor('away', st);
      R.text(ctx, wreck ? 'WRACK' : 'PLATTFORM', a.x + 320, a.y + 4, { color: PAL.brass });
      const cell = Math.max(3, Math.min(9, Math.floor(Math.min(290 / map.w, 240 / map.h))));
      R.drawMiniPlan(ctx, view, a.x + 320, a.y + 18, { zone: 'away', cell });
      return 'S Sensor · K Kuppel · 1–6 / Tab Reiter';
    },

    // ================================================================= Taktik (Konsole 'weapons')
    targetOf(view) {
      const st = view.state, ship = st.ship || {};
      if (!ship.target) return null;
      if (ship.target === 'station') { const so = R.stationOf(st.space); return so ? Object.assign({ hidden: true }, so) : null; }
      const e = (view.enemies || []).find(x => x.id === ship.target);
      if (e) return e;
      const h = ((st.space && st.space.hidden) || []).find(x => x.id === ship.target);
      return h ? Object.assign({ hidden: true }, h) : null;
    },
    targetList(view) {
      const st = view.state;
      const ship = view.ship || {};
      const dist = (p) => Math.hypot(p.x - ship.x, p.y - ship.y);
      const sr = R.sensorRange(st);
      const en = (view.enemies || []).filter(e => dist(e) <= sr).sort((p, q) => dist(p) - dist(q));
      const hid = ((st.space && st.space.hidden) || []).filter(h => !h.found && h.kind !== 'cache').sort((p, q) => dist(p) - dist(q));
      const so = R.stationOf(st.space);
      return en.concat(hid, so && dist(so) <= sr ? [so] : []);
    },
    mountList(view) {
      const ms = ((view.state.ship || {}).mounts || []).slice();
      ms.sort((p, q) => MOUNT_ORDER.indexOf(p.id) - MOUNT_ORDER.indexOf(q.id));
      if (!ms.some(m => m.id === 'phase_l' || m.id === 'lanze' || m.id === 'bow')) ms.unshift({ id: 'phase_l', missing: true }, { id: 'phase_r', missing: true });
      return ms;
    },
    isM3(view) { return ((view.state.ship || {}).mounts || []).some(m => m.id === 'bow' || m.id === 'port' || m.id === 'stbd'); },
    mountInfo(view, id) {
      const st = view.state, ship = st.ship || {};
      const m = (ship.mounts || []).find(mm => mm.id === id);
      const target = this.targetOf(view);
      let reason = null;
      const mst = m && MOUNT_SYS[id] ? (m.state || (ship.systems || {})[MOUNT_SYS[id]] || 'ok') : null;
      if (!m) reason = (id === 'seitenturm' || id === 'bolzen') ? 'Nicht eingebaut (Shop)' : 'Nicht verfügbar';
      else if (mst === 'broken' || mst === 'offline') reason = (H.SYS_NAMES[MOUNT_SYS[id]] || id) + ' zerstört – reparieren';
      else if (id === 'bow' && m.charging) reason = null;   // §20.3: lädt auf – Loslassen feuert
      else if (MOUNT_SYS[id] && n(m.alloc, 1) <= 0 && n(m.charge) < 1) reason = 'Keine Ladepunkte (A/D)';
      else if (MOUNT_SYS[id] && n(m.salvo) > 0) reason = 'Salve läuft';
      else if (MOUNT_SYS[id] && (st.ship || {}).docked) reason = 'Angedockt';
      else if (MOUNT_SYS[id]) { if (n(m.charge) < 1) reason = 'Lädt (' + Math.round(n(m.charge) * 100) + ' %)'; return { m, reason }; }   // §20.3/20.4: kein Ziel nötig
      else if (!MOUNT_SYS[id] && id !== 'bolzen' && sysDown(ship, 'weapons')) reason = 'Waffenbank ausgefallen';
      else if (id === 'bolzen' && sysDown(ship, 'engines') && CFG.spaceM3) reason = 'Triebwerk zerstört – Bolzenwerfer aus';
      else if (id === 'bolzen' && (m.loaded === false || n(m.ammo, 1) <= 0)) reason = 'Magazin leer – R nachladen';
      else if (n(m.charge) < 1) reason = 'Lädt (' + Math.round(n(m.charge) * 100) + ' %)';
      else if (!target) reason = 'Kein Ziel – T drücken oder anklicken';
      else if (target.hidden) reason = 'Ziel ist kein Gegner';
      else {
        const g = R.mountGeom(m);
        if (!Phys.inArc(ship.x, ship.y, n(ship.angle), g.facing, g.arc, g.range, target.x, target.y)) reason = 'Ziel außerhalb des Feuerbogens';
      }
      return { m, reason };
    },
    tscanReason(view) {
      const st = view.state, ship = st.ship || {};
      const tg = this.targetOf(view);
      if (!tg) return 'Kein Ziel – T drücken oder anklicken';
      if (tg.scanned) return 'Bereits gescannt';
      if (tg.hidden && tg.found && !tg.station) return 'Bereits erfasst';
      if (tg.station && tg.kind !== 'buoy' && tg.kind !== 'wreck' && tg.kind !== 'relay') return 'Hier gibt es nichts zu scannen';
      const d = Math.hypot(tg.x - n(ship.x), tg.y - n(ship.y));
      if (d > SCAN_RANGE) return 'Zu weit (' + Math.round(d) + '/' + SCAN_RANGE + ')';
      return null;
    },
    drawWeapons(ctx, view) {
      const st = view.state, ship = st.ship || {}, inv = st.inventory || {}, sup = st.support || {};
      const rect = { x: 10, y: 26, w: 404, h: 292 };
      this.maps.weapons = R.drawTactical(ctx, view, rect, { zoom: this.zoom.weapons, arcs: true, intel: true, mode: 'tactical', enemyRects: this.enemyRects });
      const away = st.away || {};
      if (away.active) {
        const amap = R.mapFor('away', st);
        R.drawMiniPlan(ctx, view, rect.x + 4, rect.y + rect.h - amap.h * 3 - 4, { zone: 'away', cell: 3 });
      }
      R.text(ctx, 'Zoom ' + Math.round(this.zoom.weapons * 100) + ' % (Z, +/−)', rect.x + rect.w - 4, rect.y + 3, { color: PAL.panelLight, align: 'right' });
      const rx = 420, rw = 206;
      let y = 28;
      // ---- Ziel
      const target = this.targetOf(view);
      R.text(ctx, 'ZIEL', rx, y, { color: PAL.brass });
      if (target) {
        const d = Math.round(Math.hypot(target.x - n(ship.x), target.y - n(ship.y)));
        const nm = target.station ? target.name : target.hidden ? (R.HIDDEN_NAMES[target.kind] || 'Signal') : (R.ENEMY_NAMES[target.kind] || target.kind);
        R.text(ctx, nm + ' · ' + d, rx + 30, y, { color: PAL.amber });
        if (!target.hidden) R.bar(ctx, rx + 30, y + 10, rw - 32, 3, target.hpMax ? target.hp / target.hpMax : 1, PAL.red);
        y += 15;
        if (target.scanned) R.text(ctx, this.shieldText(target), rx, y, { color: PAL.ice });
        else R.text(ctx, target.hidden ? (target.found ? 'erfasst' : 'S halten: genauer scannen') : 'Schilde/Waffen unbekannt – scannen', rx, y, { color: PAL.panelLight });
      } else { R.text(ctx, (view.enemies || []).length ? 'keins – T wählen' : 'keine Gegner', rx + 30, y, { color: PAL.panelLight }); y += 15; }
      y += 12;
      R.button(ctx, rx, y, 100, 14, 'Nächstes Ziel', { hotkey: 'T', disabled: !this.targetList(view).length, reason: 'Nichts in Sensorreichweite', onClick: () => this.cycleTarget(view) });
      R.button(ctx, rx + 104, y, rw - 104, 14, 'Zoom', { hotkey: 'Z', onClick: () => this.cycleZoom('weapons') });
      y += 19;
      // ---- Waffen
      if (this.isM3(view)) y = this.weaponsM3(ctx, view, rx, rw, y);
      else {
      R.text(ctx, 'WAFFEN', rx, y, { color: PAL.brass });
      const bothReady = ['phase_l', 'phase_r'].some(id => !this.mountInfo(view, id).reason);
      R.button(ctx, rx + 50, y - 2, rw - 50, 12, 'beide Phasen', { hotkey: 'Leer', disabled: !bothReady, reason: 'Keine Phasenkanone bereit (Ladung/Ziel/Bogen)', onClick: () => this.cmd(view, 'weapons.fire', { mount: 'both' }) });
      y += 13;
      }
      for (const mt of this.isM3(view) ? this.mountList(view).filter(m => m.id === 'bolzen') : this.mountList(view)) {
        const info = this.mountInfo(view, mt.id);
        const m = info.m || {};
        R.button(ctx, rx, y, 96, 13, MOUNT_NAMES[mt.id] || mt.id, { hotkey: MOUNT_KEYS[mt.id] || '', disabled: !!info.reason, reason: info.reason, onClick: () => this.cmd(view, 'weapons.fire', { mount: mt.id }) });
        R.bar(ctx, rx + 100, y + 4, 28, 5, n(m.charge), n(m.charge) >= 1 ? PAL.mint : PAL.amber);
        const SHORT = { 'Ziel außerhalb des Feuerbogens': 'außer Bogen', 'Waffenbank ausgefallen': 'Bank kaputt', 'Ziel ist kein Gegner': 'kein Gegner', 'Nicht eingebaut (Shop)': 'nicht da', 'Nicht verfügbar': 'nicht da' };
        let status = info.reason ? (SHORT[info.reason] || info.reason.replace(/ – .*/, '').replace(/^Lädt \((\d+) %\)/, 'lädt $1 %').replace(/^Kein Ziel.*/, 'kein Ziel').replace(/^Magazin leer.*/, 'leer')) : 'bereit';
        while (R.measure(status, 1) > rw - 134 && status.length > 4) status = status.slice(0, -1);
        R.text(ctx, status, rx + 132, y + 3, { color: info.reason ? PAL.panelLight : PAL.mint });
        y += 15;
        if (mt.id === 'bolzen' && !mt.missing) {
          const mag = n(m.ammo, m.loaded ? 1 : 0);
          const magMax = (CFG.weapons && CFG.weapons.bolzen && CFG.weapons.bolzen.magazine) || 2;
          for (let k = 0; k < magMax; k++) { ctx.fillStyle = k < mag ? PAL.brass : '#26313F'; ctx.fillRect(rx + 4 + k * 8, y + 2, 6, 6); }
          R.text(ctx, 'Vorrat ' + n(inv.bolzen), rx + 24, y + 1, { color: PAL.panelLight });
          const rr = n(inv.bolzen) <= 0 ? 'Kein Bolzen-Vorrat (Lager/Shop)' : mag >= magMax ? 'Magazin voll' : null;
          R.button(ctx, rx + 120, y - 1, rw - 120, 12, 'Nachladen', { hotkey: 'R', disabled: !!rr, reason: rr, onClick: () => this.cmd(view, 'weapons.reload') });
          y += 13;
        }
      }
      y += 4;
      // ---- Scanner
      R.text(ctx, 'SCANNER', rx, y, { color: PAL.brass }); y += 11;
      const ts = ship.tscan || {};
      const tsR = this.tscanReason(view);
      const prog = target && ts.targetId === target.id ? n(ts.progress) : 0;
      R.button(ctx, rx, y, 120, 14, this.tscanOn ? 'Scanne …' : 'Ziel scannen', { hotkey: 'S', active: this.tscanOn, disabled: !!tsR && !this.tscanOn, reason: tsR, onClick: () => { this.mouseHold = 'tscan'; this.setTscan(view, true); } });
      R.bar(ctx, rx + 124, y + 4, rw - 124, 6, prog, PAL.mint);
      y += 17;
      const ws = ship.widescan || {};
      const wsR = n(ws.cd) > 0 ? 'Abklingzeit ' + Math.ceil(ws.cd) + ' s' : null;
      R.button(ctx, rx, y, 120, 14, 'Weitscan (1000)', { hotkey: 'W', disabled: !!wsR, reason: wsR, onClick: () => { this.cmd(view, 'weapons.widescan'); view.actions.sfx('widescan'); } });
      const wsMax = WIDESCAN_CD;
      R.bar(ctx, rx + 124, y + 4, rw - 124, 6, 1 - clamp(n(ws.cd) / wsMax, 0, 1), wsR ? PAL.amber : PAL.mint);
      y += 19;
      // ---- Marker
      const mk = R.markersOf(st).tactical;
      R.text(ctx, 'MARKER', rx, y, { color: PAL.brass });
      R.text(ctx, mk ? 'gesetzt · ' + Math.round(Math.hypot(mk.x - n(ship.x), mk.y - n(ship.y))) : 'Rechtsklick in die Karte', rx + 50, y, { color: mk ? PAL.amber : PAL.panelLight }); y += 11;
      R.button(ctx, rx, y, 100, 14, 'Auf Ziel', { hotkey: 'M', disabled: !target, reason: 'Kein Ziel', onClick: () => this.markerOnTarget(view) });
      R.button(ctx, rx + 104, y, rw - 104, 14, 'Löschen', { hotkey: 'X', disabled: !mk, reason: 'Kein Marker gesetzt', onClick: () => this.cmd(view, 'weapons.marker', { clear: true }) });
      y += 19;
      // ---- Orbitalschlag
      let sr = null;
      const sp = n(ship.speed, Math.hypot(n(ship.vx), n(ship.vy)));
      const phaseCharged = (ship.mounts || []).some(m => (m.id === 'phase_l' || m.id === 'phase_r' || m.id === 'lanze' || MOUNT_SYS[m.id]) && n(m.charge) >= 1);
      if (!away.active) sr = 'Nur während der Außenmission';
      else if (!away.marker) sr = 'Keine Markierung (Außenteam: Q)';
      else if (n(sup.strike) > 0) sr = 'Abklingzeit ' + Math.ceil(sup.strike) + ' s';
      else if (sp > 30) sr = 'Schiff zu schnell (max. 30)';
      else if (!phaseCharged) sr = this.isM3(view) ? 'Keine Waffe voll geladen' : 'Phasenkanone lädt';
      R.button(ctx, rx, y, rw, 14, 'Orbitalschlag auf Markierung', { hotkey: 'O', disabled: !!sr, reason: sr, onClick: () => this.cmd(view, 'weapons.strike') });
      if (this.isM3(view)) return '1 halten: Lanze, los: Feuer · 2/3/Leer Batterien · Q/E A/D Punkte · T Ziel · S Scan · W Weitscan';
      return 'T/Klick Ziel · 1/2 Phase · Leer beide · S halten Scan · W Weitscan · Rechtsklick/M Marker · X löschen · Z Zoom';
    },
    // M3a: Waffenblock der Taktik – Lanze + Batterien mit Ladepunkten (Q/E wählen, A/D −/+); §20: Lanze 1 halten, Batterien nur auf Befehl
    weaponsM3(ctx, view, rx, rw, y) {
      const ship = view.state.ship || {};
      const cp = n(ship.chargePoints);
      const ms = M3_MOUNTS.map(id => (ship.mounts || []).find(m => m.id === id) || { id, missing: true });
      const used = ms.reduce((s, m) => s + n(m.alloc), 0);
      const amax = m3('allocMax', 4);
      this.sel.mount = clamp(this.sel.mount, 0, 2);
      R.text(ctx, 'WAFFEN', rx, y, { color: PAL.brass });
      R.text(ctx, 'Ladepunkte ' + used + '/' + cp, rx + 44, y, { color: cp === 0 ? PAL.red : used < cp ? PAL.amber : PAL.mint });
      const batReady = ['port', 'stbd'].some(id => !this.mountInfo(view, id).reason);
      R.button(ctx, rx + 122, y - 2, rw - 122, 12, 'Batterien', { hotkey: 'Leer', disabled: !batReady, reason: 'Keine Batterie geladen', onClick: () => this.cmd(view, 'weapons.fire', { mount: 'all' }) });
      y += 12;
      ms.forEach((m, i) => {
        const sel = this.sel.mount === i;
        const info = this.mountInfo(view, m.id);
        const st = m.missing ? 'ok' : (m.state || (ship.systems || {})[MOUNT_SYS[m.id]] || 'ok');
        const isBow = m.id === 'bow';
        if (sel) { ctx.fillStyle = 'rgba(255,198,107,0.10)'; ctx.fillRect(rx - 2, y - 1, rw + 3, 26); ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1; ctx.strokeRect(rx - 1.5, y - 0.5, rw + 2, 25); }
        // §20.3: Lanze = Knopf HALTEN (lädt auf), Loslassen feuert; Batterien = Klick feuert
        const onPress = isBow
          ? () => { this.sel.mount = i; this.lanceCharge(view, true, 'mouse'); }
          : () => { this.sel.mount = i; this.cmd(view, 'weapons.fire', { mount: m.id }); };
        R.button(ctx, rx, y, 76, 12, MOUNT_NAMES[m.id], { hotkey: MOUNT_KEYS[m.id], disabled: !!info.reason, reason: info.reason, active: !!(isBow && m.charging), onClick: onPress });
        const ch = n(m.charge);
        R.bar(ctx, rx + 80, y + 4, 36, 5, ch, ch >= 1 ? PAL.mint : PAL.amber);
        let status = st === 'broken' || st === 'offline' ? 'AUS' : isBow && m.charging ? 'LÄDT AUF' : n(m.salvo) > 0 ? 'Salve ' + n(m.salvo) : ch >= 1 ? (info.reason ? 'geladen' : (isBow ? '1 HALTEN' : 'BEREIT')) : Math.round(ch * 100) + ' %';
        R.text(ctx, status, rx + 120, y + 2, { color: st === 'broken' ? PAL.red : isBow && m.charging ? R.BURST_COL : !info.reason ? PAL.mint : PAL.panelLight });
        if (st !== 'ok' || R.fragileOf(view.state, MOUNT_SYS[m.id])) R.stateBadge(ctx, rx + rw - 34, y + 1, 34, 10, st, R.fragileOf(view.state, MOUNT_SYS[m.id]));
        // Zeile 2: Ladepunkte − ●●○○ +, Lanze: Aufladebalken / Batterie: wohin sie schießt
        const y2 = y + 13;
        const al = n(m.alloc);
        R.button(ctx, rx, y2, 13, 11, '−', { disabled: m.missing || al <= 0, reason: 'Keine Punkte auf dieser Waffe', onClick: () => { this.sel.mount = i; this.cmd(view, 'weapons.alloc', { mount: m.id, delta: -1 }); } });
        for (let k = 0; k < amax; k++) { ctx.fillStyle = k < al ? PAL.amber : '#26313F'; ctx.fillRect(rx + 16 + k * 8, y2 + 3, 6, 6); }
        const plusR = m.missing ? 'Nicht verfügbar' : al >= amax ? 'Maximum (' + amax + ')' : used >= cp ? (cp ? 'Alle Ladepunkte verteilt – erst anderswo abziehen' : 'Keine Waffenenergie (Captain)') : null;
        R.button(ctx, rx + 16 + amax * 8 + 1, y2, 13, 11, '+', { disabled: !!plusR, reason: plusR, onClick: () => { this.sel.mount = i; this.cmd(view, 'weapons.alloc', { mount: m.id, delta: 1 }); } });
        if (isBow) {
          // Aufladebalken mit Schadenszahl (3 → 12; beschädigt weniger)
          const bx = rx + 66, bw = rw - 66 - 30;
          if (m.charging) {
            const p = clamp(n(m.power), 0, 1);
            ctx.fillStyle = '#1E2733'; ctx.fillRect(bx, y2 + 2, bw, 7);
            ctx.fillStyle = p >= 1 ? PAL.mint : R.BURST_COL; ctx.fillRect(bx, y2 + 2, Math.round(bw * p), 7);
            ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y2 + 1.5, bw - 1, 8);
            R.text(ctx, f1(R.lanceDamage(m)), rx + rw, y2 + 1, { color: p >= 1 ? PAL.mint : R.BURST_COL, align: 'right' });
          } else {
            const per = m3('mounts.bow.secPerPoint', 24) * (st === 'damaged' ? m3('mounts.bow.damagedFactor', 1.5) : 1);
            R.text(ctx, (al > 0 ? Math.round(per / al) + ' s' : 'lädt nicht') + ' · Schaden ' + m3('lance.minDamage', 3) + '–' + Math.round(R.lanceDamageMax(m)), bx, y2 + 2, { color: PAL.panelLight });
          }
        } else {
          // §20.4: kein Halten/Feuer frei – Batterien feuern nur auf Befehl, auch ohne Ziel
          const target = this.targetOf(view);
          let aimTxt = 'ins Leere', aimCol = PAL.panelLight;
          const g = R.mountGeom(m);
          const inArc = (e) => e && !e.hidden && Phys.inArc(n(ship.x), n(ship.y), n(ship.angle), g.facing, g.arc, g.range, e.x, e.y);
          if (inArc(target)) { aimTxt = '→ Ziel'; aimCol = PAL.amber; }
          else if ((view.enemies || []).some(inArc)) { aimTxt = '→ nächster'; aimCol = PAL.mint; }
          R.text(ctx, aimTxt, rx + 66, y2 + 2, { color: aimCol });
          const tubes = n(m.salvoMax, st === 'damaged' ? 2 : 4);
          R.text(ctx, tubes + ' Rohre', rx + rw, y2 + 2, { color: PAL.panelLight, align: 'right' });
        }
        y += 28;
      });
      return y + 2;
    },
    cycleTarget(view) {
      const list = this.targetList(view);
      if (!list.length) return;
      const cur = view.state.ship && view.state.ship.target;
      const i = list.findIndex(e => e.id === cur);
      const next = list[(i + 1) % list.length];
      this.cmd(view, 'weapons.target', { id: next.id });
    },
    markerOnTarget(view) {
      const tg = this.targetOf(view);
      if (!tg) { this.denied('Kein Ziel'); return; }
      this.cmd(view, 'weapons.marker', { onTarget: true, x: Math.round(tg.x), y: Math.round(tg.y) });
      view.actions.sfx('marker_set');
    },
    // §20.3: Lanze aufladen (on) / feuern (off). src: 'key' (Taste 1) oder 'mouse' (Knopf gehalten)
    lanceCharge(view, on, src) {
      if (on) {
        if (this.lanceOn) return;
        const info = this.mountInfo(view, 'bow');
        if (info.reason) { this.denied(info.reason); return; }
        this.lanceOn = src || 'key';
        this.cmd(view, 'weapons.charge', { mount: 'bow', on: true });
      } else {
        if (!this.lanceOn) return;
        this.lanceOn = null;
        view.send({ t: 'cmd', c: 'weapons.charge', mount: 'bow', on: false });
      }
    },
    setTscan(view, on) {
      if (this.tscanOn === on) return;
      if (on) { const r = this.tscanReason(view); if (r) { this.denied(r); return; } }
      this.tscanOn = on;
      this.tscanRefreshT = 0;
      view.send({ t: 'cmd', c: 'weapons.scan', on });
    },

    // ================================================================= Transfer
    drawTransfer(ctx, view) {
      const st = view.state, sup = st.support || {}, inv = st.inventory || {}, away = st.away || {};
      const players = st.players || [];
      const block = this.transferBlock(st);
      const amap = R.mapFor('away', st);
      const pads = amap.find ? amap.find('P') : (Maps.PLATFORM_PADS || []);
      let y = 30;
      const shipPads = Maps.ship.find('P');
      R.text(ctx, 'SCHIFFS-PADS', 16, y, { color: PAL.brass });
      R.text(ctx, amap.id === 'wreck' ? 'WRACK-PADS' : amap.id === 'kesh' ? 'KESH-PADS' : 'PLATTFORM-PADS', 220, y, { color: PAL.brass });
      y += 12;
      const padBox = (x, yy, occ) => {
        ctx.fillStyle = '#0E1A1F'; ctx.fillRect(x, yy, 44, 44);
        ctx.strokeStyle = occ ? PAL.players[occ.color || 0] : PAL.mint; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x + 22, yy + 22, 16, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
        if (occ) { R.shape(ctx, R.SHAPES[occ.color || 0], x + 22, yy + 22, 12, PAL.players[occ.color || 0], PAL.space); R.text(ctx, String(occ.name).slice(0, 7), x + 22, yy + 46, { color: PAL.players[occ.color || 0], align: 'center' }); }
      };
      const onTile = (zone, t) => players.find(p => p.zone === zone && Math.floor(p.x / TILE) === t.x && Math.floor(p.y / TILE) === t.y);
      shipPads.forEach((t, i) => padBox(16 + i * 60, y, onTile('ship', t)));
      pads.slice(0, 3).forEach((t, i) => padBox(220 + i * 60, y, onTile('away', t)));
      y += 64;
      const onShipPads = shipPads.filter(t => onTile('ship', t)).length;
      const awayTeam = players.filter(p => p.zone === 'away');
      const tr = ((st.ship || {}).systems || {}).transfer || 'ok';
      R.text(ctx, 'Transfer-System: ' + (H.STATE_NAMES[tr] || tr) + (tr === 'damaged' ? ' (dauert doppelt so lang)' : ''), 16, y, { color: H.STATE_COL[tr] || PAL.red }); y += 11;
      R.text(ctx, block ? 'Gesperrt: ' + block : 'Bereit zum Beamen. Schilde fallen während des Transfers kurz aus.', 16, y, { color: block ? PAL.warn : PAL.mint }); y += 16;
      const downR = block || (onShipPads ? null : 'Niemand auf den Schiffs-Pads');
      const upR = (sysDown(st.ship || {}, 'transfer') ? 'Transfer ausgefallen' : null) || (awayTeam.length ? null : 'Kein Außenteam unten');
      R.button(ctx, 16, y, 190, 18, 'Runterbeamen (' + onShipPads + ' auf Pads)', { hotkey: '1', disabled: !!downR, reason: downR, onClick: () => this.cmd(view, 'transfer.down') });
      R.button(ctx, 214, y, 190, 18, 'Hochbeamen (' + awayTeam.length + ' unten)', { hotkey: '2', disabled: !!upR, reason: upR, onClick: () => this.cmd(view, 'transfer.up') });
      y += 24;
      let supR = null;
      if (!away.active) supR = 'Nur während der Außenmission';
      else if (sysDown(st.ship || {}, 'transfer')) supR = 'Transfer ausgefallen';
      else if (!away.marker) supR = 'Keine Markierung (Außenteam: Q)';
      else if (n(inv.medipack) <= 0) supR = 'Kein Medipack im Lager';
      else if (n(sup.supply) > 0) supR = 'Abklingzeit ' + Math.ceil(sup.supply) + ' s';
      R.button(ctx, 16, y, 388, 18, 'Nachschub: Medipack zur Markierung (' + n(inv.medipack) + ' im Lager)', { hotkey: '3', disabled: !!supR, reason: supR, onClick: () => this.cmd(view, 'transfer.supply') });
      y += 28;
      R.text(ctx, 'AUSSENTEAM · NOTRÜCKHOLUNG', 16, y, { color: PAL.brass }); y += 12;
      if (!awayTeam.length) R.text(ctx, 'Niemand unten.', 16, y, { color: PAL.panelLight });
      awayTeam.forEach((p, i) => {
        R.shape(ctx, R.SHAPES[p.color || 0], 21, y + 8, 8, PAL.players[p.color || 0]);
        R.text(ctx, String(p.name).slice(0, 12), 30, y + 4, { color: PAL.players[p.color || 0] });
        if (Array.isArray(p.sh) && !p.downed) R.drawShieldPips(ctx, 120, y + 3, p.sh[0], p.sh[1], n(p.shR), 9, 2);
        else if (Array.isArray(p.sh)) R.text(ctx, 'VERWUNDET' + (p.bleed != null ? ' ' + Math.ceil(p.bleed) + ' s' : ''), 120, y + 4, { color: PAL.red });
        else R.bar(ctx, 120, y + 5, 90, 6, n(p.hp, 100) / 100, p.downed ? PAL.red : PAL.moss);
        const rr = sysDown(st.ship || {}, 'transfer') ? 'Transfer ausgefallen' : n(sup.recall) > 0 ? 'Abklingzeit ' + Math.ceil(sup.recall) + ' s' : null;
        R.button(ctx, 220, y, 184, 16, 'Notrückholung', { hotkey: String(4 + i), disabled: !!rr, reason: rr, onClick: () => this.cmd(view, 'transfer.recall', { pid: p.id }) });
        y += 20;
      });
      if (away.active || awayTeam.length) {
        R.text(ctx, amap.id === 'wreck' ? 'WRACK' : amap.id === 'kesh' ? 'MOND KESH' : 'PLATTFORM B-7', 420, 30, { color: PAL.brass });
        const cell = Math.max(3, Math.min(6, Math.floor(Math.min(200 / amap.w, 260 / amap.h))));
        R.drawMiniPlan(ctx, view, 420, 44, { zone: 'away', cell });
      } else {
        R.text(ctx, 'Hinweis', 420, 30, { color: PAL.brass });
        for (const [i, l] of R.wrap('Außenteam stellt sich auf die drei Pads in der Transferkammer. Auf einem Pad kann man auch selbst E halten (Selbst-Transfer). Beamen geht bei der Boje B-7, beim Wrack und auf Mond Kesh.', 200, 1).entries()) R.text(ctx, l, 420, 44 + i * 10, { color: PAL.panelLight });
      }
      return '1 runter · 2 hoch · 3 Nachschub · 4–6 Notrückholung';
    },

    // ================================================================= Shop (Sortiment nach shopContext)
    shopContext(st) {
      const ship = st.ship || {};
      return st.shopContext || ship.dockedAt || (ship.docked ? 'hafen' : null);
    },
    shopRows(view) {
      const st = view.state, inv = st.inventory || {}, up = st.upgrades || {};
      const ctxName = this.shopContext(st);
      const docked = !!ctxName;
      const me = view.me || {};
      const decoOwned = (inv.deko || []);
      const all = CFG.shop || [];
      const whereOf = (it) => { const w = it.where || it.shops || it.at; return w == null ? null : (Array.isArray(w) ? w : [w]); };
      // where ohne Angabe = Hafen und Vaelen (CONFIG); nicht angedockt: Hafensortiment zur Ansicht
      const list = all.filter(it => {
        const w = whereOf(it);
        return !w || w.indexOf(ctxName || 'hafen') >= 0;
      });
      return list.map(it => {
        const price = (it.prices && it.prices[ctxName]) || (ctxName === 'vaelen' && it.priceVaelen) || it.price;
        let reason = null, owned = '';
        if (it.kind === 'upgrade' && up[it.id]) reason = 'Bereits eingebaut';
        else if (it.kind === 'gear' && me.gear && me.gear[it.id]) reason = 'Hast du schon';
        else if (!docked) reason = 'Nur angedockt (Hafen oder Vaelen)';
        else if (n(inv.marks) < price) reason = 'Nicht genug Marken';
        if (it.kind === 'item') owned = 'Lager: ' + n(inv[it.id]);
        if (it.kind === 'deko') owned = 'Besitz: ' + decoOwned.filter(d => d === it.id).length;
        if (it.kind === 'upgrade' && up[it.id]) owned = 'eingebaut';
        return Object.assign({}, it, { price, reason, owned, cheaper: price < it.price });
      });
    },
    drawShop(ctx, view) {
      const st = view.state, inv = st.inventory || {};
      const rows = this.shopRows(view);
      const sc = this.shopContext(st);
      this.sel.shop = clamp(this.sel.shop, 0, Math.max(0, rows.length - 1));
      R.text(ctx, 'Marken: ' + n(inv.marks), 16, 30, { color: PAL.brass });
      R.text(ctx, sc === 'vaelen' ? 'Vaelen-Karawane · Händlerin Sela' : sc === 'hafen' ? 'Hafen Lichtkordon · angedockt' : 'Nicht angedockt', 120, 30, { color: sc === 'vaelen' ? PAL.moss : PAL.panelLight });
      const kindNames = { upgrade: 'Umbau', gear: 'Ausrüstung', item: 'Vorrat', deko: 'Deko' };
      let y = 44;
      const rowH = rows.length > 15 ? 15 : 17;
      rows.forEach((r, i) => {
        if (y > 316) return;
        const sel = this.sel.shop === i;
        const b = R.button(ctx, 16, y, 360, rowH - 2, r.name, { disabled: !!r.reason, reason: r.reason, onClick: () => { this.sel.shop = i; this.buy(view, r); } });
        if (sel) { ctx.strokeStyle = PAL.amber; ctx.strokeRect(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3); }
        R.text(ctx, kindNames[r.kind] || r.kind, 200, y + 3, { color: PAL.panelLight });
        R.text(ctx, r.price + ' M', 372, y + 3, { color: r.reason === 'Nicht genug Marken' ? PAL.red : r.cheaper ? PAL.moss : PAL.brass, align: 'right' });
        R.text(ctx, r.owned, 384, y + 3, { color: PAL.panelLight });
        y += rowH;
      });
      if (!rows.length) R.text(ctx, 'Kein Sortiment.', 16, y, { color: PAL.panelLight });
      const r = rows[this.sel.shop];
      if (r) {
        const desc = {
          seitenturm: 'Schneller Turm an Steuerbord (Feuerbogen 120°).', schildpool: 'Zwei zusätzliche Schildpunkte zum Verteilen.',
          schrauber3: 'Ein dritter Reparatur-Bot.', werkzeuggurt: 'Du reparierst 30 % schneller (nur du).',
          bolzenwerfer: 'Bolzenwerfer am Heck (Taste 3), zielsuchend, Magazin 2.', bolzen_werfer: 'Bolzenwerfer am Heck (Taste 3), zielsuchend, Magazin 2.',
          ersatzteil: 'Repariert ausgefallene Systeme.', loeschgel: 'Fünf Löschladungen.', flickblech: 'Flickt einen Hüllenbruch.',
          bolzen: 'Munition für den Bolzenwerfer.', medipack: 'Heilt 50 HP (Nachschub fürs Außenteam).',
          kristalllampe: 'Vaelen-Handwerk: leuchtet in Mint. Nur hier zu haben.',
        }[r.id] || (r.kind === 'deko' ? 'Für dein Quartier (an der eigenen Koje platzieren).' : r.kind === 'upgrade' ? 'Umbau für die Lerche.' : '');
        R.panel(ctx, 470, 46, 156, 100, { style: 'brass', title: 'INFO' });
        R.wrap(desc, 140, 1).slice(0, 5).forEach((l, i) => R.text(ctx, l, 478, 58 + i * 10, { color: PAL.star }));
        if (r.cheaper) R.text(ctx, 'Vaelen-Preis (sonst ' + (CFG.shop.find(x => x.id === r.id) || {}).price + ')', 478, 112, { color: PAL.moss });
        if (r.reason) R.wrap(r.reason, 140, 1).forEach((l, i) => R.text(ctx, l, 478, 124 + i * 10, { color: PAL.warn }));
      }
      return '↑/↓ wählen · Enter kaufen';
    },
    buy(view, r) {
      if (!r || r.reason) return;
      view.send({ t: 'cmd', c: 'shop.buy', item: r.id });
      view.actions.sfx(this.shopContext(view.state) === 'vaelen' ? 'trade' : 'buy');
    },

    // ================================================================= Quartier (M1 §7)
    myBed(view) {
      const color = view.me ? view.me.color : 0;
      return (Maps.BEDS || []).find(b => b.color === color) || Maps.BEDS[0];
    },
    drawQuartier(ctx, view) {
      const st = view.state, inv = st.inventory || {}, deco = st.deco || {};
      const bed = this.myBed(view);
      const room = bed.room || { id: 'q' + bed.color };
      const style = R.roomStyleOf(st, room.id);
      const col = PAL.players[bed.color] || PAL.star;
      R.text(ctx, 'Dein Quartier · Gestaltung kostenlos', 16, 30, { color: col });
      // Stilreihen
      let y = 44;
      this.sel.qrow = clamp(this.sel.qrow, 0, 3);
      STYLE_ROWS.forEach(([part, label, opts], ri) => {
        const rowSel = this.sel.qrow === ri;
        R.text(ctx, label, 16, y + 4, { color: rowSel ? PAL.amber : PAL.brass });
        opts.forEach(([val, name], i) => {
          R.button(ctx, 56 + i * 76, y, 74, 15, name, { active: style[part] === val, onClick: () => { this.sel.qrow = ri; this.setStyle(view, part, val); } });
        });
        if (rowSel) { ctx.strokeStyle = PAL.amber; ctx.strokeRect(12.5, y - 2.5, 56 + opts.length * 76 - 4, 20); }
        y += 22;
      });
      // Vorschau
      this.drawRoomPreview(ctx, view, 450, 42, 174, 62, style, bed, deco);
      // Deko-Plätze
      y += 4;
      const slotsSel = this.sel.qrow === 3;
      R.text(ctx, 'PLÄTZE', 16, y, { color: slotsSel ? PAL.amber : PAL.brass }); y += 11;
      this.sel.slot = clamp(this.sel.slot, 0, bed.slots.length - 1);
      bed.slots.forEach((slot, i) => {
        const x = 16 + i * 152, yy = y;
        const sel = this.sel.slot === i;
        ctx.fillStyle = '#2A1F18'; ctx.fillRect(x, yy, 144, 66);
        ctx.strokeStyle = sel ? PAL.amber : PAL.brass; ctx.lineWidth = sel ? 2 : 1; ctx.strokeRect(x + 0.5, yy + 0.5, 143, 65); ctx.lineWidth = 1;
        R.text(ctx, 'Platz ' + (i + 1), x + 6, yy + 4, { color: sel ? PAL.amber : PAL.star });
        const item = deco[slot.id];
        if (item) {
          const kind = 'deco_' + item;
          if (!R.artObject(ctx, kind, x + 56, yy + 22, { time: view.time })) { ctx.fillStyle = PAL.terra; ctx.fillRect(x + 60, yy + 18, 24, 30); }
          R.text(ctx, DECO_NAMES[item] || item, x + 72, yy + 55, { color: PAL.star, align: 'center' });
        } else R.text(ctx, 'leer', x + 72, yy + 30, { color: PAL.panelLight, align: 'center' });
        R.ui.buttons.push({ x, y: yy, w: 144, h: 66, onClick: () => { this.sel.slot = i; this.sel.qrow = 3; } });
      });
      y += 74;
      const options = (inv.deko || []).slice();
      const list = options.map(d => ({ id: d, label: DECO_NAMES[d] || d })).concat([{ id: null, label: 'Platz leeren (zurück ins Inventar)' }]);
      this.sel.deco = clamp(this.sel.deco, 0, list.length - 1);
      const slot = bed.slots[this.sel.slot];
      R.text(ctx, 'DEKO IM INVENTAR → Platz ' + (this.sel.slot + 1), 16, y, { color: PAL.brass }); y += 12;
      if (!options.length) { R.text(ctx, 'Keine Deko im Inventar – am Terminal kaufen oder beim Erkunden finden.', 16, y, { color: PAL.panelLight }); y += 14; }
      list.forEach((o, i) => {
        const cx = 16 + (i % 3) * 204, cy = y + Math.floor(i / 3) * 17;
        if (cy > 318) return;
        const dis = o.id === null && !deco[slot.id];
        const b = R.button(ctx, cx, cy, 198, 15, o.label, { disabled: dis, reason: 'Platz ist schon leer', onClick: () => { this.sel.deco = i; this.cmd(view, 'deco.place', { slot: slot.id, item: o.id }); } });
        if (this.sel.deco === i) { ctx.strokeStyle = PAL.amber; ctx.strokeRect(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3); }
      });
      return '↑/↓ Reihe · ←/→ wählen · Q/E Deko · Enter setzen';
    },
    setStyle(view, part, value) { this.cmd(view, 'quartier.style', { part, value }); },
    drawRoomPreview(ctx, view, x, y, w, h, style, bed, deco) {
      ctx.fillStyle = '#0B0E1A'; ctx.fillRect(x, y, w, h);
      const wallCol = { holz: '#6A4A32', paneel: '#4F6178', tapete_gruen: '#4E6B48', tapete_creme: '#BFAE8A' }[style.wall] || '#6A4A32';
      const floorCol = { holz_hell: '#B07A50', holz_dunkel: '#6A4430', teppich_rot: '#8C3A34', teppich_blau: '#34507A', fliesen: '#A9B4BC' }[style.floor] || '#B07A50';
      ctx.fillStyle = wallCol; ctx.fillRect(x + 2, y + 2, w - 4, 18);
      ctx.fillStyle = floorCol; ctx.fillRect(x + 2, y + 20, w - 4, h - 22);
      if (style.floor === 'fliesen') { ctx.fillStyle = 'rgba(46,58,74,0.35)'; for (let i = x + 2; i < x + w; i += 12) ctx.fillRect(i, y + 20, 1, h - 22); }
      ctx.fillStyle = PAL.players[bed.color] || PAL.panel; ctx.fillRect(x + 8, y + 26, 30, 18);
      ctx.fillStyle = PAL.star; ctx.fillRect(x + 8, y + 26, 10, 18);
      bed.slots.forEach((s, i) => { const it = deco[s.id]; if (it) { ctx.fillStyle = PAL.brass; ctx.fillRect(x + 60 + i * 28, y + 30, 14, 14); R.text(ctx, (DECO_NAMES[it] || it).charAt(0), x + 67 + i * 28, y + 33, { color: PAL.space, align: 'center', shadow: false }); } });
      const light = { warm: 'rgba(255,198,107,0.12)', mint: 'rgba(127,224,194,0.16)', bernstein: 'rgba(255,160,50,0.2)', aus: 'rgba(5,7,14,0.55)' }[style.light];
      if (light) { ctx.fillStyle = light; ctx.fillRect(x + 2, y + 2, w - 4, h - 4); }
      ctx.strokeStyle = PAL.brass; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      R.text(ctx, 'VORSCHAU', x + w - 4, y + h + 2, { color: PAL.panelLight, align: 'right' });
    },

    // ================================================================= Planungstisch (M1 §8)
    locAwayMap(st, loc) {
      if (!loc) return null;
      if ('map' in loc) return loc.map || null;            // Server: map = bekannte Außenkarte (platform|wreck) oder null
      if (loc.awayMap) return loc.awayKnown === false ? null : loc.awayMap;
      if (Array.isArray(loc.maps) && loc.maps.length) return loc.maps[0];
      if (loc.id === 'b7' && loc.visited) return 'platform';
      if (loc.id === 'wrack' && loc.visited) return 'wreck';
      if (loc.id === 'kesh' && loc.known) return 'kesh';   // M2: Kesh-Plan ist bekannt (Briefing)
      return null;
    },
    myPins(st, pid) { return ((st.plan && st.plan.pins) || []).filter(p => p.owner === pid); },
    drawPlan(ctx, view) {
      const st = view.state;
      const P = this.plan;
      const rect = { x: 10, y: 40, w: 430, h: 278 };
      // Kopfzeile: Brotkrumen
      // §21.2: Reiter Karten | Missionsbuch
      const hasChronik = this.chronikEntries(st) != null;
      if (P.tab === 'chronik' && !hasChronik) P.tab = 'book';
      R.button(ctx, 330, 25, 110, 13, 'Missionsbuch', { hotkey: 'M', active: P.tab === 'book', onClick: () => { P.tab = P.tab === 'book' ? 'map' : 'book'; } });
      if (P.tab === 'book' || P.tab === 'chronik') {
        R.button(ctx, 10, 25, 90, 13, 'Karten', { hotkey: 'M', onClick: () => { P.tab = 'map'; } });
        // S1 (Kann): Reiter „Chronik“ (nur lesen), wenn der Server mission.chronik schickt
        if (hasChronik) R.button(ctx, 446, 25, 90, 13, 'Chronik', { hotkey: 'C', active: P.tab === 'chronik', onClick: () => { P.tab = P.tab === 'chronik' ? 'book' : 'chronik'; } });
        return P.tab === 'chronik' ? this.drawPlanChronik(ctx, view) : this.drawPlanBook(ctx, view);
      }
      const loc = P.mapId !== 'star' ? ((P.mapId !== 'kesh' && R.locById(st, P.mapId)) || (P.mapId === 'platform' ? R.locById(st, 'b7') : P.mapId === 'wreck' ? R.locById(st, 'wrack') : P.mapId === 'kesh' ? R.locById(st, 'kesh') : null)) : null;
      R.button(ctx, 10, 25, 90, 13, 'Sternkarte', { hotkey: 'Bs', active: P.mapId === 'star', onClick: () => { P.mapId = 'star'; } });
      if (P.mapId !== 'star') R.text(ctx, '› ' + (P.mapId === 'platform' ? 'Plattform B-7 (Decksplan)' : P.mapId === 'wreck' ? 'Wrack (Decksplan)' : P.mapId === 'kesh' ? 'Mond Kesh (Archivplan)' : R.locName(st, P.mapId)), 106, 28, { color: PAL.amber });
      if (P.mapId === 'star') {
        if (!P.selected) P.selected = R.worldOf(st).location;
        this.maps.plan = R.drawStarMap(ctx, view, rect, { selected: P.selected, mouse: view.mouse, rects: this.planRects });
      } else {
        this.planRects.length = 0;
        this.maps.plan = R.drawLocalMap(ctx, view, rect, P.mapId, {});
      }
      // rechts
      const rx = 448, rw = 178;
      let y = 26;
      R.text(ctx, 'AM TISCH', rx, y, { color: PAL.brass }); y += 11;
      const seated = (st.plan && st.plan.seated) || (st.players || []).filter(p => p.console === 'plan').map(p => p.id);
      for (const pid of seated.slice(0, 3)) {
        const p = (st.players || []).find(q => q.id === pid);
        if (!p) continue;
        R.shape(ctx, R.SHAPES[p.color || 0], rx + 4, y + 4, 7, PAL.players[p.color || 0]);
        R.text(ctx, String(p.name || '?').slice(0, 12) + (p.id === view.pid ? ' (du)' : ''), rx + 12, y, { color: PAL.players[p.color || 0] }); y += 10;
      }
      y += 4;
      if (P.mapId === 'star') {
        const sl = R.locById(st, P.selected) || {};
        R.text(ctx, 'ORT', rx, y, { color: PAL.brass }); y += 11;
        for (const l of R.wrap(sl.known ? sl.name : 'Unbekanntes Signal', rw, 1).slice(0, 2)) { R.text(ctx, l, rx, y, { color: sl.known ? PAL.amber : PAL.panelLight }); y += 10; }
        if (sl.known) {
          R.text(ctx, (R.LOC_KIND_NAMES[sl.kind] || sl.kind || '') + (sl.visited ? ' · besucht' : ' · nie besucht'), rx, y, { color: PAL.panelLight }); y += 10;
          const info = [];
          if (sl.dangers) info.push('Gefahr: ' + (Array.isArray(sl.dangers) ? sl.dangers.join(', ') : sl.dangers));
          if (sl.intel) info.push('Scan: ' + (Array.isArray(sl.intel) ? sl.intel.join(', ') : sl.intel));
          if (sl.desc) info.push(sl.desc);
          for (const l of R.wrap(info.join(' · '), rw, 1).slice(0, 4)) { R.text(ctx, l, rx, y, { color: PAL.star }); y += 10; }
          if (sl.discoveries && sl.discoveries.total) { R.text(ctx, 'Entdeckungen: ' + n(sl.discoveries.found) + '/' + sl.discoveries.total, rx, y, { color: PAL.mint }); y += 10; }
          for (const f of (sl.found || []).slice(0, 3)) { for (const l of R.wrap('· ' + (f.name || f.kind) + (f.done ? '' : ' (offen)'), rw, 1).slice(0, 1)) { R.text(ctx, l, rx, y, { color: f.done ? PAL.panelLight : PAL.amber }); y += 10; } }
        }
        y += 2;
        const can = sl.known || sl.unknown;
        R.button(ctx, rx, y, rw, 14, 'Detailkarte (Szene)', { hotkey: 'Enter', disabled: !can, reason: 'Ort unbekannt', onClick: () => { P.mapId = sl.id; } }); y += 16;
        const am = this.locAwayMap(st, sl);
        R.button(ctx, rx, y, rw, 14, 'Decksplan', { hotkey: 'D', disabled: !am, reason: 'Kein Decksplan bekannt (erst scannen/besuchen)', onClick: () => { P.mapId = am; } }); y += 18;
      } else y += 2;
      // Pins
      R.text(ctx, 'PIN SETZEN', rx, y, { color: PAL.brass });
      const mine = this.myPins(st, view.pid);
      R.text(ctx, 'meine ' + mine.length + '/' + MAX_PINS, rx + rw, y, { color: mine.length >= MAX_PINS ? PAL.warn : PAL.panelLight, align: 'right' }); y += 11;
      R.PIN_LABELS.forEach((lab, i) => {
        const bx = rx + (i % 2) * 90, by = y + Math.floor(i / 2) * 15;
        R.button(ctx, bx, by, 88, 13, R.PIN_NAMES[lab], { hotkey: String(i + 1), active: P.label === lab, onClick: () => { P.label = lab; } });
      });
      y += 47;
      R.text(ctx, P.mapId === 'star' ? 'Pin: Klick · auf Ort: Shift+Klick' : 'Klick: Pin setzen', rx, y, { color: PAL.panelLight }); y += 10;
      R.text(ctx, 'Rechtsklick: eigenen entfernen', rx, y, { color: PAL.panelLight }); y += 12;
      const pins = ((st.plan && st.plan.pins) || []).filter(p => p.map === P.mapId);
      R.text(ctx, 'PINS HIER (' + pins.length + ')', rx, y, { color: PAL.brass }); y += 11;
      for (const pin of pins.slice(0, Math.max(0, Math.floor((318 - y) / 13)))) {
        const own = pin.owner === view.pid;
        const owner = (st.players || []).find(p => p.id === pin.owner);
        ctx.fillStyle = R.playerColorOf(st, pin.owner); ctx.fillRect(rx, y + 2, 5, 5);
        R.text(ctx, (R.PIN_NAMES[pin.label] || pin.label) + ' · ' + String(owner ? owner.name : '?').slice(0, 10), rx + 8, y, { color: PAL.star });
        if (own) R.button(ctx, rx + rw - 16, y - 2, 16, 12, 'x', { onClick: () => this.cmd(view, 'plan.unpin', { id: pin.id }) });
        y += 13;
      }
      return (P.mapId === 'star' ? 'Klick Ort wählen · Enter Detail · D Decksplan · ' : 'Backspace Sternkarte · ') + '1–5 Pin-Art · Klick Pin';
    },
    // ---- S1 (Kann): Chronik der Kampagne – Einträge als Text oder { text, spielzeit_s?, t?, mission?, ort? }
    chronikEntries(st) {
      const c = st && st.mission && st.mission.chronik;
      return Array.isArray(c) ? c : null;
    },
    drawPlanChronik(ctx, view) {
      const st = view.state;
      const list = (this.chronikEntries(st) || []).slice().reverse();   // neueste zuerst
      const x = 10, y = 42, w = VW - 20, h = 276;
      R.panel(ctx, x, y, w, h, { style: 'screen' });
      R.text(ctx, 'CHRONIK DER LERCHE', x + 8, y + 6, { color: PAL.brass });
      R.text(ctx, 'die letzten ' + list.length + ' Einträge', x + w - 8, y + 6, { color: PAL.panelLight, align: 'right' });
      let yy = y + 20;
      if (!list.length) R.text(ctx, 'Noch nichts Erzählenswertes passiert.', x + 8, yy, { color: PAL.panelLight });
      for (const e of list) {
        const text = typeof e === 'string' ? e : String((e && e.text) || '');
        const sec = e && typeof e === 'object' ? (e.spielzeit_s != null ? e.spielzeit_s : e.t) : null;
        const where = e && typeof e === 'object' && (e.ort || e.loc) ? R.locName(st, e.ort || e.loc) : '';
        const head = (sec != null && isFinite(+sec) ? H.fmtTime(+sec) : '') + (where ? (sec != null ? ' · ' : '') + where : '');
        const lines = R.wrap(text, w - 168, 1);
        if (yy + lines.length * 10 > y + h - 8) break;
        if (head) R.text(ctx, H.fit ? H.fit(head, 144, 1) : head, x + 8, yy, { color: PAL.panelLight });
        for (const l of lines) { R.text(ctx, l, x + 158, yy, { color: PAL.star }); yy += 10; }
        yy += 4;
      }
      return 'C Missionsbuch · M Karten';
    },
    // ---- §21.2 Missionsbuch: Liste (aktiv/angeboten/erledigt) links, Details rechts
    bookEntries(st) {
      const book = (st.mission && st.mission.book) || null;
      const all = (book && Array.isArray(book.entries)) ? book.entries : [];
      const order = ['aktiv', 'angeboten', 'erledigt'];
      const out = [];
      for (const s of order) for (const e of all) if (e.state === s) out.push(e);
      for (const e of all) if (order.indexOf(e.state) < 0) out.push(e);
      return { book, list: out };
    },
    drawPlanBook(ctx, view) {
      const st = view.state, P = this.plan;
      const { book, list } = this.bookEntries(st);
      const lx = 10, ly = 42, lw = 214, lh = 276;
      R.panel(ctx, lx, ly, lw, lh, { style: 'screen' });
      if (!book) {
        R.text(ctx, 'Noch keine Einträge vom Server.', lx + 6, ly + 8, { color: PAL.panelLight });
        return 'M Karten';
      }
      P.bookSel = clamp(P.bookSel || 0, 0, Math.max(0, list.length - 1));
      const focus = book.focus;
      const GROUP = { aktiv: 'AKTIV', angeboten: 'ANGEBOTEN', erledigt: 'ERLEDIGT' };
      const KIND = { mission: 'Mission', nebenauftrag: 'Nebenauftrag', hinweis: 'Hinweis' };
      let y = ly + 5, lastGroup = null;
      list.forEach((e, i) => {
        if (y > ly + lh - 12) return;
        if (e.state !== lastGroup) {
          lastGroup = e.state;
          R.text(ctx, (GROUP[e.state] || String(e.state).toUpperCase()) + ' (' + list.filter(q => q.state === e.state).length + ')', lx + 5, y, { color: PAL.brass }); y += 11;
        }
        const sel = i === P.bookSel;
        const isFocus = focus != null ? e.id === focus : false;
        if (sel) { ctx.fillStyle = 'rgba(255,198,107,0.14)'; ctx.fillRect(lx + 2, y - 2, lw - 4, 12); ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1; ctx.strokeRect(lx + 2.5, y - 1.5, lw - 5, 11); }
        if (isFocus) R.shape(ctx, 'diamond', lx + 9, y + 4, 7, PAL.amber);
        const col = e.state === 'erledigt' ? '#6E8A6A' : e.state === 'angeboten' ? PAL.ice : PAL.star;
        let title = String(e.title || e.id);
        while (R.measure(title, 1) > lw - 64 && title.length > 4) title = title.slice(0, -1);
        R.text(ctx, title + (title.length < String(e.title || e.id).length ? '…' : ''), lx + 16, y, { color: isFocus ? PAL.amber : col });
        R.text(ctx, ({ mission: 'Mission', nebenauftrag: 'Neben', hinweis: 'Hinweis' })[e.kind] || '', lx + lw - 6, y, { color: PAL.panelLight, align: 'right' });
        // Klickfläche
        R.ui.buttons.push({ x: lx + 2, y: y - 2, w: lw - 4, h: 11, label: '', disabled: false, onClick: () => { P.bookSel = i; } });
        y += 12;
      });
      if (!list.length) R.text(ctx, 'Keine Aufträge.', lx + 6, y, { color: PAL.panelLight });
      // Details
      const e = list[P.bookSel];
      const dx = 232, dw = VW - 12 - dx;
      R.panel(ctx, dx, ly, dw, lh, { style: 'screen' });
      if (!e) return 'M Karten';
      let yy = ly + 5;
      const wrapW = dw - 12;
      for (const l of R.wrap(String(e.title || e.id), wrapW, 2).slice(0, 2)) { R.text(ctx, l, dx + 6, yy, { color: PAL.amber, scale: 2 }); yy += 17; }
      const stCol = e.state === 'aktiv' ? PAL.mint : e.state === 'angeboten' ? PAL.ice : '#6E8A6A';
      R.text(ctx, (KIND[e.kind] || e.kind || '') + ' · ' + (e.state || ''), dx + 6, yy, { color: stCol });
      if (focus != null && e.id === focus) R.text(ctx, 'VERFOLGT', dx + dw - 6, yy, { color: PAL.amber, align: 'right' });
      yy += 11;
      if (e.from) { R.text(ctx, 'Auftraggeber: ' + e.from, dx + 6, yy, { color: PAL.star }); yy += 11; }
      if (e.reward) { R.text(ctx, 'Belohnung: ' + e.reward, dx + 6, yy, { color: PAL.brass }); yy += 11; }
      // Knöpfe
      const focR = e.state === 'erledigt' ? 'Schon erledigt' : (focus != null && focus === e.id) ? 'Wird schon verfolgt' : null;
      R.button(ctx, dx + 6, yy + 1, 150, 13, 'Als aktiv markieren', { hotkey: 'Enter', disabled: !!focR, reason: focR, onClick: () => this.cmd(view, 'plan.focus', { id: e.id }) });
      const accR = e.state !== 'angeboten' ? 'Nur angebotene Aufträge' : null;
      R.button(ctx, dx + 162, yy + 1, dw - 168, 13, 'Annehmen', { hotkey: 'A', disabled: !!accR, reason: accR, onClick: () => this.cmd(view, 'plan.accept', { id: e.id }) });
      yy += 19;
      const maxY = ly + lh - 6;
      const line = (str, col, indent) => { for (const l of R.wrap(str, wrapW - (indent || 0), 1)) { if (yy > maxY - 10) return false; R.text(ctx, l, dx + 6 + (indent || 0), yy, { color: col }); yy += 10; } return true; };
      if (e.briefing) { R.text(ctx, 'BRIEFING', dx + 6, yy, { color: PAL.brass }); yy += 10; for (const l of R.wrap(String(e.briefing), wrapW, 1).slice(0, 5)) { R.text(ctx, l, dx + 6, yy, { color: PAL.star }); yy += 10; } yy += 3; }
      const objs = Array.isArray(e.objectives) ? e.objectives : [];
      if (objs.length && yy < maxY - 20) {
        R.text(ctx, 'ZIELE', dx + 6, yy, { color: PAL.brass }); yy += 10;
        for (const o of objs) {
          if (yy > maxY - 10) break;
          ctx.strokeStyle = o.done ? PAL.moss : PAL.panelLight; ctx.lineWidth = 1; ctx.strokeRect(dx + 6.5, yy + 0.5, 6, 6);
          if (o.done) { ctx.fillStyle = PAL.moss; ctx.fillRect(dx + 8, yy + 2, 3, 3); }
          if (!line(String(o.text || ''), o.done ? '#6E8A6A' : PAL.star, 10)) break;
        }
        yy += 3;
      }
      const log = Array.isArray(e.log) ? e.log : [];
      if (log.length && yy < maxY - 20) {
        R.text(ctx, 'LOGBUCH', dx + 6, yy, { color: PAL.brass }); yy += 10;
        for (const g of log.slice().reverse()) {
          const when = g.t != null ? H.fmtTime(g.t) : '';
          const where = g.loc ? R.locName(st, g.loc) : '';
          if (!line((when ? when + ' · ' : '') + (where ? where + ': ' : '') + String(g.text || ''), PAL.panelLight, 0)) break;
        }
      }
      return 'W/S wählen · Enter als aktiv markieren · A annehmen · M Karten';
    },
    planClick(view, x, y, button) {
      const st = view.state, P = this.plan, mp = this.maps.plan;
      if (P.tab === 'book' || P.tab === 'chronik') return false;
      const rect = { x: 10, y: 40, w: 430, h: 278 };
      if (!mp || x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) return false;
      const pins = ((st.plan && st.plan.pins) || []).filter(p => p.map === P.mapId);
      if (button === 2) {
        let best = null, bd = 12;
        for (const p of pins) { if (p.owner !== view.pid) continue; const s = mp.toS(p.x, p.y); const d = Math.hypot(s.x - x, s.y - 6 - y); if (d < bd) { bd = d; best = p; } }
        if (best) this.cmd(view, 'plan.unpin', { id: best.id }); else this.denied('Kein eigener Pin in der Nähe');
        return true;
      }
      if (P.mapId === 'star') {
        const hitLoc = this.planRects.find(r => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
        if (hitLoc && !this.keys.ShiftLeft && !this.keys.ShiftRight) {
          if (P.selected === hitLoc.id && performance.now() - (this.lastLocClick || 0) < 400) P.mapId = hitLoc.id;
          P.selected = hitLoc.id; this.lastLocClick = performance.now();
          view.actions.sfx('ui_click');
          return true;
        }
      }
      if (this.myPins(st, view.pid).length >= MAX_PINS) { this.denied('Höchstens ' + MAX_PINS + ' Pins – erst einen entfernen'); return true; }
      const w = mp.toW(x, y);
      this.cmd(view, 'plan.pin', { map: P.mapId, x: Math.round(w.x), y: Math.round(w.y), label: P.label });
      view.actions.sfx('marker_set');
      return true;
    },

    // ================================================================= Sonde
    drawSonde(ctx, view) {
      const st = view.state, away = st.away || {}, sonde = away.sonde || {};
      const symbols = sonde.symbols || [];
      const entered = sonde.entered || [];
      const lock = n(sonde.lockout);
      R.text(ctx, 'Die Sonde zeigt drei Symbole. Gib die passenden Farben in dieser Reihenfolge ein.', VW / 2, 30, { color: PAL.panelLight, align: 'center' });
      for (let i = 0; i < 3; i++) {
        const x = 170 + i * 110, y = 48;
        ctx.fillStyle = '#120E1E'; ctx.fillRect(x, y, 80, 80);
        ctx.strokeStyle = i === entered.length && !sonde.disabled ? PAL.amber : PAL.indigo; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, 78, 78); ctx.lineWidth = 1;
        const sym = symbols[i];
        if (sym) {
          R.shape(ctx, sym, x + 40, y + 34, 34, PAL.star, PAL.indigo);
          R.text(ctx, SYMBOL_NAMES[sym] || sym, x + 40, y + 64, { color: PAL.star, align: 'center' });
        }
        const e = entered[i];
        if (e) {
          ctx.fillStyle = CODE_HEX[e] || '#888'; ctx.fillRect(x + 10, y + 86, 60, 10);
          R.text(ctx, COLOR_NAMES[e] || e, x + 40, y + 100, { color: CODE_HEX[e] || PAL.star, align: 'center' });
        }
      }
      let y = 160;
      if (sonde.disabled) R.text(ctx, 'SONDE ABGESCHALTET – Drohnen deaktiviert, Tür offen.', VW / 2, y, { color: PAL.mint, align: 'center' });
      else if (lock > 0) R.text(ctx, 'FALSCHE FARBE – gesperrt für ' + Math.ceil(lock) + ' s. Drohnen alarmiert!', VW / 2, y, { color: PAL.red, align: 'center' });
      else R.text(ctx, 'Eingabe ' + (entered.length + 1) + ' von 3', VW / 2, y, { color: PAL.amber, align: 'center' });
      y += 16;
      const reason = sonde.disabled ? 'Sonde bereits abgeschaltet' : lock > 0 ? 'Gesperrt (' + Math.ceil(lock) + ' s)' : null;
      CODE_COLORS.forEach((c, i) => {
        const x = 38 + (i % 6) * 96;
        R.button(ctx, x, y, 90, 22, COLOR_NAMES[c] || c, { hotkey: String(i + 1), disabled: !!reason, reason, onClick: () => this.cmd(view, 'sonde.input', { color: c }) });
        ctx.fillStyle = reason ? '#3A4250' : (CODE_HEX[c] || '#888'); ctx.fillRect(x + 74, y + 5, 12, 12);
      });
      y += 34;
      if (away.odaCodeHelp && away.codeTable) {
        R.panel(ctx, 120, y, 400, 80, { style: 'screen', title: 'ODA-HILFE: CODETABELLE' });
        Object.keys(away.codeTable).forEach((sym, i) => {
          const col = away.codeTable[sym];
          const x = 136 + (i % 3) * 128, yy = y + 14 + Math.floor(i / 3) * 26;
          R.shape(ctx, sym, x + 6, yy + 6, 10, PAL.star);
          R.text(ctx, SYMBOL_NAMES[sym] || sym, x + 16, yy + 2, { color: PAL.star });
          ctx.fillStyle = CODE_HEX[col] || '#888'; ctx.fillRect(x + 16, yy + 12, 8, 8);
          R.text(ctx, COLOR_NAMES[col] || col, x + 28, yy + 12, { color: CODE_HEX[col] || PAL.star });
        });
      } else {
        R.text(ctx, 'Die Codetabelle sieht nur der Captain an Bord (Reiter „Außenteam“). Funkt euch ab!', VW / 2, y + 4, { color: PAL.panelLight, align: 'center' });
      }
      return '1–6 Farbe eingeben';
    },

    // ================================================================= Eingabe
    keyDown(e, view) {
      const c = view.me && view.me.console;
      if (!c) return false;
      const code = e.code;
      this.keys[code] = true;
      if (code === 'Escape') { view.actions.leave(); return true; }
      if (e.repeat && code !== 'ArrowUp' && code !== 'ArrowDown' && code !== 'ArrowLeft' && code !== 'ArrowRight') return true;
      const digit = /^Digit([1-9])$/.exec(code) || /^Numpad([1-9])$/.exec(code);
      const d = digit ? +digit[1] : 0;
      const st = view.state;
      const press = (fn) => { try { fn(); } catch (err) { Net.reportError('Consoles.key', err); } return true; };
      switch (c) {
        case 'helm':
          if ((code === 'KeyA' || code === 'ArrowLeft') && e.shiftKey) return press(() => this.tryButton('Ausweichen Bb'));
          if ((code === 'KeyD' || code === 'ArrowRight') && e.shiftKey) return press(() => this.tryButton('Ausweichen Stb'));
          // M3b: W/S (↑/↓) = Temporegler eine Stufe; Tastenwiederholung schaltet nicht weiter
          if ((code === 'KeyW' || code === 'ArrowUp') && !e.shiftKey) { if (!e.repeat) press(() => this.throttle(view, 1)); return true; }
          if ((code === 'KeyS' || code === 'ArrowDown') && !e.shiftKey) { if (!e.repeat) press(() => this.throttle(view, -1)); return true; }
          if (code === 'KeyF') return press(() => this.tryButton('Faltsprung'));
          if (code === 'KeyX') return press(() => this.tryButton(/^Allstopp/));   // §21.1
          return true;
        case 'captain': {
          const awayOn = this.awayActive(st);
          // M3b: Schildstoß (B+1–4, Shift+Pfeil) entfällt
          if (code === 'Tab') { const max = awayOn ? 6 : 5; this.tab = (this.tab + (e.shiftKey ? max - 1 : 1)) % max; return true; }
          if (d >= 1 && d <= 6) { if (d - 1 === TAB_AWAY && !awayOn) { this.denied('Nur während der Außenmission'); return true; } this.tab = d - 1; return true; }
          const tab = this.tab;
          if (tab === 0) {
            if (code === 'Enter') return press(() => this.tryButton('Funkspruch annehmen'));
            if (code === 'KeyQ' || code === 'KeyW' || code === 'KeyE') { const i = { KeyQ: 0, KeyW: 1, KeyE: 2 }[code]; const o = st.mission && st.mission.choice && st.mission.choice.options[i]; if (o) return press(() => this.tryButton(o.label || o.id)); return true; }
            if (code === 'KeyL') return press(() => this.tryButton('Neuen Funkspruch abhören'));
          } else if (tab === 1) {
            if (code === 'ArrowLeft' || code === 'ArrowUp' || code === 'KeyA' || code === 'KeyW') { this.cycleStar(st, -1); return true; }
            if (code === 'ArrowRight' || code === 'ArrowDown' || code === 'KeyD' || code === 'KeyS') { this.cycleStar(st, 1); return true; }
            if (code === 'Enter') return press(() => this.tryButton(/^(Als Sprungziel|Sprungziel)/));
          } else if (tab === 2) {
            if (code === 'Space') { const b = this.findButton(/^Scan/); if (b && !b.disabled) this.setScan(view, true); else if (b) this.denied(b.reason); return true; }
            if (code === 'KeyX') return press(() => this.tryButton('Marker löschen'));
            if (code === 'KeyZ' || code === 'Equal' || code === 'NumpadAdd') { this.cycleZoom('lage', code === 'KeyZ' ? 0 : 1); return true; }
            if (code === 'Minus' || code === 'NumpadSubtract') { this.cycleZoom('lage', -1); return true; }
          } else if (tab === 3) {
            if (code === 'KeyU') return press(() => this.tryButton('Reaktor überladen …'));
            if (code === 'KeyJ' || (code === 'Enter' && performance.now() - this.overloadAsk < 6000)) return press(() => this.tryButton('Ja, überladen'));
            if (code === 'KeyN') { this.overloadAsk = -1e9; return true; }
            if (code === 'ArrowUp' || code === 'KeyW') { this.sel.power = (this.sel.power + 7) % 8; return true; }
            if (code === 'ArrowDown' || code === 'KeyS') { this.sel.power = (this.sel.power + 1) % 8; return true; }
            if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyA' || code === 'KeyD' || code === 'Minus' || code === 'NumpadSubtract' || code === 'Equal' || code === 'NumpadAdd' || code === 'BracketRight') {
              const delta = (code === 'ArrowLeft' || code === 'KeyA' || code === 'Minus' || code === 'NumpadSubtract') ? -1 : 1;
              const i = this.sel.power;
              if (i < 4) this.cmd(view, 'captain.power', { sys: POWER_SYS[i], delta });
              else this.cmd(view, 'captain.shield', { sector: i - 4, delta });
              return true;
            }
          } else if (tab === 4) {
            const rows = this.damageRows(st);
            if (code === 'ArrowUp' || code === 'KeyW') { this.sel.damage = (this.sel.damage + rows.length - 1) % rows.length; return true; }
            if (code === 'ArrowDown' || code === 'KeyS') { this.sel.damage = (this.sel.damage + 1) % rows.length; return true; }
            const row = rows[this.sel.damage];
            if (row && row.sys) {
              // M3a: Reparaturliste der Bots
              if (code === 'Enter' || code === 'KeyF') return press(() => this.setRepair(view, row.target, 'flick'));
              if (code === 'KeyT') return press(() => this.setRepair(view, row.target, 'part'));
              if (code === 'Delete' || code === 'Backspace' || code === 'Digit0') return press(() => this.setRepair(view, row.target, null));
              if (code === 'KeyP') return press(() => this.cmd(view, 'captain.priority', { target: row.target }));
            }
            if (code === 'KeyA') return press(() => this.tryButton(/^Bots automatisch/));
            if (code === 'Enter') return press(() => this.cmd(view, 'captain.priority', { target: rows[this.sel.damage].target }));
            if (code === 'Backspace' || code === 'Digit0') return press(() => this.cmd(view, 'captain.priority', { target: null }));
          } else if (tab === 5) {
            if (code === 'KeyS') return press(() => this.tryButton(/^Sensor/));
            if (code === 'KeyK') return press(() => this.tryButton(/^(Schildkuppel|Kuppel)/));
            // M2: Befehlsart wählen / löschen (v2-Karten)
            const ok = { KeyQ: 'sammeln', KeyW: 'halten', KeyE: 'flanke', KeyR: 'rueckzug', KeyF: 'fokus', KeyG: 'gefahr' }[code];
            if (ok && this.isAwayV2(st)) { this.order.kind = ok; view.actions.sfx('ui_click'); return true; }
            if (code === 'KeyX' && this.isAwayV2(st)) return press(() => this.tryButton('Befehl löschen'));
          }
          return true;
        }
        case 'weapons':
          if (code === 'KeyT') return press(() => this.cycleTarget(view));
          if (this.isM3(view)) {
            // M3a: Q/E Waffe wählen, A/D Ladepunkte −/+, 1 Lanze halten, 2/3 Bb/Stb, 4 Bolzen, Leer Batterien
            if (code === 'KeyQ') { this.sel.mount = (this.sel.mount + 2) % 3; view.actions.sfx('ui_click'); return true; }
            if (code === 'KeyE') { this.sel.mount = (this.sel.mount + 1) % 3; view.actions.sfx('ui_click'); return true; }
            if (code === 'KeyA' || code === 'KeyD') {
              const id = M3_MOUNTS[this.sel.mount];
              const b = this.findButtons(code === 'KeyA' ? '−' : '+').filter(x => x.y > 60)[this.sel.mount];
              if (b && b.disabled) { this.denied(b.reason); return true; }
              return press(() => this.cmd(view, 'weapons.alloc', { mount: id, delta: code === 'KeyA' ? -1 : 1 }));
            }
            // §20.3: 1 HALTEN lädt die Lanze auf, Loslassen feuert (keyUp); §20.4: 2/3/Leer feuern Batterien, kein H mehr
            if (d === 1) { this.sel.mount = 0; return press(() => this.lanceCharge(view, true, 'key')); }
            if (d >= 2 && d <= 3) { this.sel.mount = d - 1; return press(() => this.tryButton(MOUNT_NAMES[M3_MOUNTS[d - 1]])); }
            if (d === 4) return press(() => this.tryButton('Bolzen'));
            if (code === 'Space') return press(() => this.tryButton('Batterien'));
          }
          if (d === 1) return press(() => this.tryButton(this.findButton('Phase L') ? 'Phase L' : 'Lanze'));
          if (d === 2) return press(() => this.tryButton('Phase R'));
          if (d === 3) return press(() => this.tryButton('Bolzen'));
          if (d === 4) return press(() => this.tryButton('Seitenturm'));
          if (code === 'Space') return press(() => this.tryButton('beide Phasen'));
          if (code === 'KeyS') { this.setTscan(view, true); return true; }
          if (code === 'KeyW') return press(() => this.tryButton(/^Weitscan/));
          if (code === 'KeyM') return press(() => this.markerOnTarget(view));
          if (code === 'KeyX') return press(() => this.tryButton('Löschen'));
          if (code === 'KeyR') return press(() => this.tryButton('Nachladen'));
          if (code === 'KeyO') return press(() => this.tryButton('Orbitalschlag auf Markierung'));
          if (code === 'KeyZ') { this.cycleZoom('weapons'); return true; }
          if (code === 'Equal' || code === 'NumpadAdd') { this.cycleZoom('weapons', 1); return true; }
          if (code === 'Minus' || code === 'NumpadSubtract') { this.cycleZoom('weapons', -1); return true; }
          return true;
        case 'transfer':
          if (d === 1) return press(() => this.tryButton(/^Runterbeamen/));
          if (d === 2) return press(() => this.tryButton(/^Hochbeamen/));
          if (d === 3) return press(() => this.tryButton(/^Nachschub/));
          if (d >= 4 && d <= 6) { const list = this.findButtons(/^Notrückholung/); const b = list[d - 4]; if (b) this.activate(b); return true; }
          return true;
        case 'shop': {
          const rows = this.shopRows(view);
          if (!rows.length) return true;
          if (code === 'ArrowUp' || code === 'KeyW') { this.sel.shop = (this.sel.shop + rows.length - 1) % rows.length; return true; }
          if (code === 'ArrowDown' || code === 'KeyS') { this.sel.shop = (this.sel.shop + 1) % rows.length; return true; }
          if (code === 'Enter' || code === 'Space') { const r = rows[this.sel.shop]; if (r && r.reason) this.denied(r.reason); else this.buy(view, r); return true; }
          return true;
        }
        case 'quartier': {
          const bed = this.myBed(view);
          const room = bed.room || { id: 'q' + bed.color };
          if (code === 'ArrowUp' || code === 'KeyW') { this.sel.qrow = (this.sel.qrow + 3) % 4; return true; }
          if (code === 'ArrowDown' || code === 'KeyS') { this.sel.qrow = (this.sel.qrow + 1) % 4; return true; }
          if (code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowRight' || code === 'KeyD') {
            const dir = (code === 'ArrowLeft' || code === 'KeyA') ? -1 : 1;
            if (this.sel.qrow === 3) { this.sel.slot = (this.sel.slot + bed.slots.length + dir) % bed.slots.length; return true; }
            const [part, , opts] = STYLE_ROWS[this.sel.qrow];
            const cur = R.roomStyleOf(st, room.id)[part];
            const i = opts.findIndex(o => o[0] === cur);
            this.setStyle(view, part, opts[(i + opts.length + dir) % opts.length][0]);
            return true;
          }
          const list = ((st.inventory && st.inventory.deko) || []).concat([null]);
          if (code === 'KeyQ') { this.sel.deco = (this.sel.deco + list.length - 1) % list.length; return true; }
          if (code === 'KeyE') { this.sel.deco = (this.sel.deco + 1) % list.length; return true; }
          if (code === 'Enter') { const slot = bed.slots[this.sel.slot]; this.cmd(view, 'deco.place', { slot: slot.id, item: list[this.sel.deco] == null ? null : list[this.sel.deco] }); return true; }
          return true;
        }
        case 'plan': {
          const P = this.plan;
          // §21.2: M wechselt Karten/Missionsbuch; im Buch W/S wählen, Enter verfolgen, A annehmen
          if (code === 'KeyM') { P.tab = P.tab === 'map' ? 'book' : 'map'; view.actions.sfx('ui_click'); return true; }
          // S1 (Kann): C wechselt zwischen Missionsbuch und Chronik
          if (code === 'KeyC' && P.tab !== 'map' && this.chronikEntries(st)) { P.tab = P.tab === 'chronik' ? 'book' : 'chronik'; view.actions.sfx('ui_click'); return true; }
          if (P.tab === 'chronik') { if (code === 'Backspace') P.tab = 'book'; return true; }
          if (P.tab === 'book') {
            const { list } = this.bookEntries(st);
            if (code === 'KeyW' || code === 'ArrowUp') { P.bookSel = Math.max(0, (P.bookSel || 0) - 1); return true; }
            if (code === 'KeyS' || code === 'ArrowDown') { P.bookSel = Math.min(Math.max(0, list.length - 1), (P.bookSel || 0) + 1); return true; }
            if (code === 'Enter') return press(() => this.tryButton('Als aktiv markieren'));
            if (code === 'KeyA') return press(() => this.tryButton('Annehmen'));
            if (code === 'Backspace') { P.tab = 'map'; return true; }
            return true;
          }
          if (d >= 1 && d <= 5) { P.label = R.PIN_LABELS[d - 1]; return true; }
          if (code === 'Backspace') { P.mapId = 'star'; return true; }
          if (P.mapId === 'star') {
            const locs = this.visibleLocs(st);
            if (code === 'ArrowLeft' || code === 'ArrowUp' || code === 'ArrowRight' || code === 'ArrowDown') {
              const dir = (code === 'ArrowLeft' || code === 'ArrowUp') ? -1 : 1;
              const i = locs.findIndex(l => l.id === P.selected);
              if (locs.length) P.selected = locs[(i + dir + locs.length) % locs.length].id;
              return true;
            }
            if (code === 'Enter') return press(() => this.tryButton('Detailkarte (Szene)'));
            if (code === 'KeyD') return press(() => this.tryButton('Decksplan'));
          }
          return true;
        }
        case 'sonde':
          if (d >= 1 && d <= 6) { const b = this.findButton(COLOR_NAMES[CODE_COLORS[d - 1]]); if (b) this.activate(b); return true; }
          return true;
      }
      return true;
    },
    keyUp(e, view) {
      delete this.keys[e.code];
      if ((e.code === 'Digit1' || e.code === 'Numpad1') && this.lanceOn === 'key') this.lanceCharge(view, false);
      if (e.code === 'Space' && this.scanOn) this.setScan(view, false);
      if (e.code === 'KeyS' && this.tscanOn) this.setTscan(view, false);
      return !!(view.me && view.me.console);
    },
    releaseAll(view) {
      this.keys = {};
      this.mouseHold = null;
      if (this.lanceOn) this.lanceCharge(view, false);   // Fenster verliert den Fokus = loslassen (feuert)
      if (this.scanOn) this.setScan(view, false);
      if (this.tscanOn) this.setTscan(view, false);
    },
    findButtons(match) {
      return R.ui.buttons.filter(b => b.label && (match instanceof RegExp ? match.test(b.label) : b.label === match || b.label.indexOf(match) === 0));
    },
    findButton(match) { return this.findButtons(match)[0] || null; },
    activate(b) {
      if (b.disabled) { this.denied(b.reason || 'Gesperrt'); return; }
      if (b.onClick) b.onClick();
    },
    tryButton(match) { const b = this.findButton(match); if (b) this.activate(b); },

    inRect(x, y, r) { return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h; },
    // button: 0 = links, 2 = rechts
    mouseDown(x, y, view, button) {
      const c = view.me && view.me.console;
      button = button || 0;
      if (c === 'weapons') {
        const mp = this.maps.weapons;
        if (!mp || !this.inRect(x, y, { x: 10, y: 26, w: 404, h: 292 })) return false;
        if (button === 2) {
          const w = mp.toW(x, y);
          this.cmd(view, 'weapons.marker', { x: Math.round(w.x), y: Math.round(w.y) });
          view.actions.sfx('marker_set');
          return true;
        }
        for (let i = this.enemyRects.length - 1; i >= 0; i--) { const r = this.enemyRects[i]; if (this.inRect(x, y, r)) { this.cmd(view, 'weapons.target', { id: r.id }); return true; } }
        return false;
      }
      if (c === 'captain' && this.tab === 2) {
        const mp = this.maps.lage;
        if (!mp || !this.inRect(x, y, { x: 12, y: 48, w: 440, h: 272 })) return false;
        if (button === 2) { this.cmd(view, 'captain.marker', { clear: true }); return true; }
        const w = mp.toW(x, y);
        this.cmd(view, 'captain.marker', { x: Math.round(w.x), y: Math.round(w.y) });
        view.actions.sfx('marker_set');
        return true;
      }
      if (c === 'captain' && this.tab === 5 && this.isAwayV2(view.state)) return this.awayMapClick(view, x, y, button);
      if (c === 'captain' && this.tab === 1 && button === 0) {
        const hitLoc = this.starRects.find(r => this.inRect(x, y, r));
        if (hitLoc) { this.starSel = hitLoc.id; view.actions.sfx('ui_click'); return true; }
        return false;
      }
      if (c === 'plan') return this.planClick(view, x, y, button);
      return false;
    },
    mouseUp(view) {
      if (this.lanceOn === 'mouse') this.lanceCharge(view, false);
      if (this.mouseHold === 'scan') this.setScan(view, false);
      if (this.mouseHold === 'tscan') this.setTscan(view, false);
      this.mouseHold = null;
    },

    // Laufende Eingaben (Steuer 10 Hz, Scans halten)
    update(dt, view) {
      const c = view.me && view.me.console;
      // Halte-Scans: Der Server bricht ab, wenn er länger nichts hört – solange gehalten wird, alle 0,3 s erneuern.
      if (this.scanOn && c === 'captain') {
        this.scanRefreshT += dt;
        if (this.scanRefreshT >= 0.3) { this.scanRefreshT = 0; view.send({ t: 'cmd', c: 'captain.scan', on: true }); }
      }
      if (this.tscanOn && c === 'weapons') {
        this.tscanRefreshT += dt;
        if (this.tscanRefreshT >= 0.3) { this.tscanRefreshT = 0; view.send({ t: 'cmd', c: 'weapons.scan', on: true }); }
      }
      if (c !== 'helm') return;
      const ax = this.helmAxes();
      const hs = this.helmSent;
      hs.t += dt;
      // M3b: helm.input trägt nur noch das Ruder (thrust immer 0 – Tempo läuft über helm.throttle)
      const changed = ax.turn !== hs.turn;
      if (changed || (ax.turn && hs.t >= 0.1)) {
        view.send({ t: 'cmd', c: 'helm.input', turn: ax.turn, thrust: 0 });
        hs.turn = ax.turn; hs.t = 0;
      }
    },
  };

  window.Consoles = Consoles;
})();
