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

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function n(v, d) { return typeof v === 'number' && isFinite(v) ? v : (d || 0); }
  function sysDown(ship, sys) { const s = (ship.systems || {})[sys]; return s === 'broken' || s === 'offline'; }
  function fmt(sec) { return H.fmtTime(sec); }

  const Consoles = {
    current: null,
    tab: 0,
    sel: { power: 0, damage: 0, shop: 0, deco: 0, slot: 0, qrow: 0, loc: 0, mount: 0 },
    burstArm: 0,       // M3a: B gedrückt -> nächste Ziffer 1–4 = Schildstoß (performance.now())
    keys: {},
    mouseHold: null,
    helmSent: { turn: 0, thrust: 0, t: 0 },
    zoom: { weapons: 0.35, lage: 0.35 },
    enemyRects: [],
    lageRects: [],
    scanOn: false,
    tscanOn: false,
    tscanRefreshT: 0,
    scanRefreshT: 0,
    overloadAsk: -1e9,
    plan: { mapId: 'star', selected: null, label: 'ziel' },
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
      this.helmSent = { turn: 0, thrust: 0, t: 0 };
      this.overloadAsk = -1e9;
      if (name === 'plan') this.plan.mapId = 'star';
    },
    onClose(view) {
      if (this.current === 'helm' && view && (this.helmSent.turn || this.helmSent.thrust)) view.send({ t: 'cmd', c: 'helm.input', turn: 0, thrust: 0 });
      if (this.scanOn && view) { view.send({ t: 'cmd', c: 'captain.scan', on: false }); this.scanOn = false; }
      if (this.tscanOn && view) { view.send({ t: 'cmd', c: 'weapons.scan', on: false }); this.tscanOn = false; }
      this.current = null;
      this.keys = {};
      this.mouseHold = null;
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
      if (sp > ((CFG.ship && CFG.ship.beamMaxSpeed) || 30)) return 'Zu schnell (' + Math.round(sp) + '/' + ((CFG.ship && CFG.ship.beamMaxSpeed) || 30) + ')';
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
      const up = k.KeyW || k.ArrowUp || h === 'up';
      const down = k.KeyS || k.ArrowDown || h === 'down';
      return { turn: (right ? 1 : 0) - (left ? 1 : 0), thrust: (up ? 1 : 0) - (down ? 1 : 0) };
    },
    drawHelm(ctx, view) {
      const st = view.state, ship = st.ship || {};
      const rect = { x: 10, y: 26, w: 620, h: 292 };
      const fv = R.drawFrontView(ctx, view, rect);
      try { this.helmTurnGauge(ctx, view, fv); this.helmAim(ctx, view, fv); } catch (e) { Net.reportError('Consoles.helmM3', e); }
      const lx = 14, lw = fv.win.x - lx - 8;
      const rx = fv.win.x + fv.win.w + 8, rw = rect.x + rect.w - rx - 2;
      const w = R.worldOf(st);
      // ---- links: Ort, Tempo, Kurs, Sprung
      let y = 30;
      R.text(ctx, 'ORT', lx, y, { color: PAL.brass }); y += 10;
      for (const l of R.wrap(R.locName(st, w.location), lw, 1).slice(0, 2)) { R.text(ctx, l, lx, y, { color: PAL.star }); y += 10; }
      const docked = ship.dockedAt || (ship.docked ? 'hafen' : null);
      if (docked) { R.text(ctx, 'ANGEDOCKT', lx, y, { color: PAL.amber }); y += 10; R.text(ctx, 'W legt ab', lx, y, { color: PAL.panelLight }); y += 10; }
      y += 4;
      const sp = n(ship.speed, Math.hypot(n(ship.vx), n(ship.vy)));
      const deg = Math.round(((n(ship.angle) * 180 / Math.PI) % 360 + 360) % 360);
      R.text(ctx, 'TEMPO', lx, y, { color: PAL.brass }); R.text(ctx, 'KURS', lx + 74, y, { color: PAL.brass }); y += 10;
      R.text(ctx, String(Math.round(sp)), lx, y, { color: PAL.mint, scale: 2 }); R.text(ctx, deg + '°', lx + 74, y, { color: PAL.mint, scale: 2 }); y += 18;
      R.text(ctx, 'px/s', lx, y, { color: PAL.panelLight }); y += 12;
      const ax = this.helmAxes();
      R.text(ctx, 'Schub ' + (ax.thrust > 0 ? 'vor' : ax.thrust < 0 ? 'zurück' : '–') + ' · Ruder ' + (ax.turn > 0 ? 'Stb' : ax.turn < 0 ? 'Bb' : '–'), lx, y, { color: PAL.panelLight }); y += 14;
      const jump = ship.jump || {};
      R.text(ctx, 'SPRUNG', lx, y, { color: PAL.brass }); y += 10;
      R.bar(ctx, lx, y, lw, 6, n(jump.charge), jump.ready ? PAL.mint : PAL.amber); y += 9;
      for (const l of R.wrap('Ziel: ' + (jump.dest ? R.locName(st, jump.dest) : 'keins (Captain)'), lw, 1).slice(0, 2)) { R.text(ctx, l, lx, y, { color: jump.dest ? PAL.star : PAL.panelLight }); y += 10; }
      let jumpReason = null;
      if (!jump.ready) jumpReason = jump.blockedReason || (!jump.dest ? 'Kein Ziel gewählt (Captain-Konsole)' : 'Sprungantrieb lädt (' + Math.round(n(jump.charge) * 100) + ' %)');
      R.button(ctx, lx, y, lw, 15, 'Faltsprung', { hotkey: 'F', disabled: !jump.ready, reason: jumpReason, active: !!jump.ready, onClick: () => this.cmd(view, 'helm.jump') }); y += 17;
      if (jumpReason) { for (const l of R.wrap(jumpReason, lw, 1).slice(0, 2)) { R.text(ctx, l, lx, y, { color: PAL.warn }); y += 10; } }
      // M3a: Lanze (Taktik feuert) – der Pilot sieht, wann gleich eine Zielphase kommen kann
      const bow = (ship.mounts || []).find(mm => mm.id === 'bow');
      if (bow && y < 236) {
        y += 2;
        R.text(ctx, 'LANZE', lx, y, { color: PAL.brass });
        const bs = bow.state || (ship.systems || {}).weapon_bow || 'ok';
        const txt = bs === 'broken' ? 'AUS' : bow.aim ? 'ZIELT – Kurs halten!' : n(bow.charge) >= 1 ? 'geladen' : 'lädt ' + Math.round(n(bow.charge) * 100) + ' %';
        R.text(ctx, txt, lx + 36, y, { color: bs === 'broken' ? PAL.red : bow.aim ? R.BURST_COL : n(bow.charge) >= 1 ? PAL.mint : PAL.panelLight });
        y += 10;
      }
      y = Math.max(y + 2, 262);
      const engDown = sysDown(ship, 'engines');
      const cd = n(ship.dodgeCd);
      const dodgeReason = engDown ? 'Antrieb ausgefallen' : cd > 0 ? 'Abklingzeit ' + Math.ceil(cd) + ' s' : docked ? 'Angedockt' : null;
      R.button(ctx, lx, y, lw, 14, 'Ausweichen Bb', { hotkey: 'Sh+A', disabled: !!dodgeReason, reason: dodgeReason, onClick: () => this.dodge(view, -1) });
      R.button(ctx, lx, y + 16, lw, 14, 'Ausweichen Stb', { hotkey: 'Sh+D', disabled: !!dodgeReason, reason: dodgeReason, onClick: () => this.dodge(view, 1) });

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
      // Maussteuerung (Halten)
      const by = 282;
      R.text(ctx, 'Maus halten:', rx, by - 10, { color: PAL.panelLight });
      const hb = (x, yy, label, id) => R.button(ctx, x, yy, 28, 14, label, { active: this.mouseHold === id, onClick: () => { this.mouseHold = id; } });
      const bx = rx + Math.floor((rw - 92) / 2);
      hb(bx + 32, by, 'W', 'up'); hb(bx, by + 16, 'A', 'left'); hb(bx + 32, by + 16, 'S', 'down'); hb(bx + 64, by + 16, 'D', 'right');
      return 'A/D lenken · W/S Schub · Shift+A/D ausweichen · F Faltsprung';
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
      const bu = sh.burst;
      if (bu && n(bu.left) > 0 && bu.sector >= 0 && bu.sector < 4) {
        const [dx, dy] = pos[bu.sector];
        ctx.strokeStyle = R.BURST_COL; ctx.lineWidth = 1;
        if (dy) ctx.strokeRect(x - 13.5, y + dy * 20 - 3.5, 27, 7); else ctx.strokeRect(x + dx * 22 - 3.5, y - 13.5, 7, 27);
      }
    },
    // M3a: Drehpfeil nach turnVel; Seite halbiert (beschädigte Düse, schraffiert „½“) oder gesperrt (zerstört, Schloss)
    helmTurnGauge(ctx, view, fv) {
      const ship = view.state.ship || {};
      if (ship.turnVel == null && !ship.turnCap) return;
      const max = (CFG.ship && CFG.ship.turnRate) || 0.5;
      const cx = fv.cx, half = 74, y = fv.win.y + fv.win.h - 22;
      const cap = ship.turnCap || { port: 1, stbd: 1 };
      ctx.fillStyle = 'rgba(11,14,26,0.78)'; ctx.fillRect(cx - half - 8, y - 12, half * 2 + 16, 28);
      R.text(ctx, 'DREHUNG', cx - half - 4, y - 10, { color: PAL.brass });
      const tv = n(ship.turnVel);
      R.text(ctx, Math.round(Math.abs(tv) * 180 / Math.PI) + '°/s ' + (tv > 0.01 ? 'Stb' : tv < -0.01 ? 'Bb' : ''), cx + half + 4, y - 10, { color: PAL.star, align: 'right' });
      ctx.fillStyle = '#1E2733'; ctx.fillRect(cx - half, y, half * 2, 8);
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
      if (ax.turn) { const c = n(cap[ax.turn < 0 ? 'port' : 'stbd'], 1); const tx = cx + ax.turn * half * c; ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1; ctx.strokeRect(Math.round(tx) - 2.5, y - 2.5, 5, 13); }
      const len = clamp(tv / max, -1, 1) * half;
      if (Math.abs(len) >= 1) {
        ctx.fillStyle = PAL.mint;
        ctx.fillRect(len > 0 ? cx : cx + len, y + 2, Math.abs(len), 4);
        const hx = cx + len, d = len > 0 ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(hx + d * 6, y + 4); ctx.lineTo(hx, y - 1); ctx.lineTo(hx, y + 9); ctx.closePath(); ctx.fill();
      }
    },
    // M3a: Zielphase der Lanze – Countdown und ±5°-Marke mit aim.dev, groß und mittig
    helmAim(ctx, view, fv) {
      const ship = view.state.ship || {};
      const bow = (ship.mounts || []).find(mm => mm.id === 'bow');
      const aim = bow && bow.aim;
      if (!aim) return;
      const tol = m3('aimTolerance', 5);
      const dev = n(aim.dev);
      const bad = Math.abs(dev) > tol * 0.7;
      const t = view.time;
      const w = 190, h = 56, x = Math.round(fv.cx - w / 2), y = fv.win.y + 26;
      ctx.fillStyle = 'rgba(11,14,26,0.82)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = bad ? PAL.red : R.BURST_COL; ctx.lineWidth = 1;
      if (bad) ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.setLineDash([]);
      R.text(ctx, 'LANZE ZIELT ' + f1(aim.left) + ' s', fv.cx, y + 4, { color: R.BURST_COL, scale: 2, align: 'center' });
      R.text(ctx, bad && Math.floor(t * 6) % 2 ? 'ZU WEIT – GEGENLENKEN!' : 'KURS HALTEN', fv.cx, y + 22, { color: bad ? PAL.red : PAL.amber, align: 'center' });
      // Skala ±(1,6 × Toleranz), grünes Feld ±Toleranz, Nadel = Abweichung
      const sw = 150, sx = fv.cx - sw / 2, sy = y + 36, range = tol * 1.6;
      ctx.fillStyle = '#1E2733'; ctx.fillRect(sx, sy, sw, 10);
      const gw = sw * tol / range;
      ctx.fillStyle = 'rgba(94,140,74,0.6)'; ctx.fillRect(Math.round(fv.cx - gw / 2), sy, Math.round(gw), 10);
      R.hatch(ctx, sx, sy, Math.round(sw / 2 - gw / 2), 10, 'rgba(224,71,60,0.5)', 3);
      R.hatch(ctx, Math.round(fv.cx + gw / 2), sy, Math.round(sw / 2 - gw / 2), 10, 'rgba(224,71,60,0.5)', 3);
      R.text(ctx, '-' + tol + '°', fv.cx - gw / 2, sy + 11, { color: PAL.panelLight, align: 'center' });
      R.text(ctx, '+' + tol + '°', fv.cx + gw / 2, sy + 11, { color: PAL.panelLight, align: 'center' });
      const nd = (d) => { const px = Math.round(fv.cx + clamp(d / range, -1, 1) * sw / 2); ctx.fillStyle = bad ? PAL.red : PAL.star; ctx.fillRect(px - 1, sy - 3, 3, 16); };
      nd(dev);
      if (dev > 0 && aim.signed === false) nd(-dev);
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
      // M3a: Schildstoß ist auf jedem Reiter erreichbar (B dann 1–4 oder Shift+Pfeil) – kompakte Leiste oben rechts
      if (this.tab !== 3) { try { this.burstStrip(ctx, view, x + 2, 26); } catch (e) { Net.reportError('Consoles.burstStrip', e); } }
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

    // ---- M3a: Schildstoß (Captain) und Ladungen (erst in den letzten captainSeesLast s sichtbar)
    burstReason(ship, sector) {
      const sh = ship.shields || {}, sys = ship.systems || {};
      if (n(sh.burstCd) > 0) return 'Stoß lädt nach (' + Math.ceil(sh.burstCd) + ' s)';
      if (sys.shields === 'broken' || sys.shields === 'offline') return 'Schildgenerator zerstört – kein Stoß';
      const em = EMITTER_OF[sector];
      if (sys[em] === 'broken' || sys[em] === 'offline') return (H.SYS_NAMES[em] || em) + ' zerstört – kein Stoß';
      return null;
    },
    burst(view, sector) {
      const r = this.burstReason(view.state.ship || {}, sector);
      if (r) { this.denied(r); return; }
      view.send({ t: 'cmd', c: 'captain.burst', sector });
      view.actions.sfx('ui_click');
    },
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
    // kompakte Stoß-Leiste (alle Reiter außer „Energie & Schilde“)
    burstStrip(ctx, view, x, y) {
      const ship = view.state.ship || {}, sh = ship.shields || {};
      if (!sh.cap && sh.burstCd == null && !CFG.spaceM3) return;
      const cur = sh.current || [0, 0, 0, 0], cap = sh.cap || [4, 4, 4, 4];
      const tele = this.teleLate(view);
      const armed = performance.now() - this.burstArm < 1500;
      const order = [3, 0, 1, 2];   // Bb, Bug, Stb, Heck (Lesereihenfolge)
      const bw = 25;
      R.text(ctx, armed ? '1–4?' : 'STOSS', x, y + 3, { color: armed ? PAL.amber : PAL.brass });
      x += 31;
      for (let j = 0; j < 4; j++) {
        const i = order[j];
        const bx = x + j * (bw + 2);
        const reason = this.burstReason(ship, i);
        const bu = sh.burst && sh.burst.sector === i && n(sh.burst.left) > 0;
        ctx.fillStyle = bu ? 'rgba(232,248,255,0.25)' : reason ? '#232A36' : '#26313F'; ctx.fillRect(bx, y, bw, 15);
        if (n(cap[i], 4) <= 0) R.crossX(ctx, bx, y, bw, 15, 'rgba(224,71,60,0.6)', 1);
        else if (n(cap[i], 4) < 4) R.hatch(ctx, bx, y, bw, 15, 'rgba(242,201,76,0.25)', 4);
        const tl0 = tele[i];
        if (!tl0) R.text(ctx, String(i + 1) + SECTOR_KEYS[i].charAt(0), bx + 3, y + 1, { color: reason ? '#6B7380' : PAL.star });
        for (let k = 0; k < 4; k++) { ctx.fillStyle = k < n(cur[i]) ? PAL.mint : k >= n(cap[i], 4) ? '#5A2A26' : '#2E3A4A'; ctx.fillRect(bx + 3 + k * 5, y + 11, 4, 2); }
        const tl = tele[i];
        if (tl) {
          ctx.strokeStyle = PAL.red; ctx.setLineDash([3, 2]); ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y + 0.5, bw - 1, 14); ctx.setLineDash([]);
          R.text(ctx, f1(tl.left), bx + bw / 2, y + 1, { color: PAL.red, align: 'center' });
        } else { ctx.strokeStyle = bu ? R.BURST_COL : PAL.panel; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y + 0.5, bw - 1, 14); }
        R.ui.buttons.push({ x: bx, y, w: bw, h: 15, label: 'Stoß ' + SECTOR_KEYS[i], disabled: !!reason, reason, onClick: () => this.burst(view, i) });
      }
      const cd = n(sh.burstCd);
      if (cd > 0) R.text(ctx, Math.ceil(cd) + 's', x + 4 * (bw + 2) + 2, y + 3, { color: PAL.panelLight });
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
      if (sysDown(ship, 'shields')) R.text(ctx, 'Schildgenerator zerstört!', a.x + 470, a.y + 31, { color: PAL.red, align: 'center' });
      ctx.fillStyle = PAL.panelLight;
      ctx.beginPath(); ctx.moveTo(cx + 26, cy); ctx.lineTo(cx - 18, cy - 12); ctx.lineTo(cx - 24, cy); ctx.lineTo(cx - 18, cy + 12); ctx.closePath(); ctx.fill();
      const pos = [[cx + 95, cy], [cx, cy + 70], [cx - 95, cy], [cx, cy - 70]];
      const capA = Array.isArray(sh.cap) ? sh.cap : [4, 4, 4, 4];
      const tele = this.teleLate(view);
      const t = view.time;
      // M3a: Abklingzeit des Schildstoßes
      const bcd = n(sh.burstCd), bmax = m3('burst.cooldown', 8);
      R.text(ctx, bcd > 0 ? 'Stoß lädt ' + Math.ceil(bcd) + ' s' : 'Stoß bereit (B+1–4 / Shift+Pfeil)', a.x + 330, a.y + 16, { color: bcd > 0 ? PAL.panelLight : PAL.mint });
      R.bar(ctx, a.x + 330, a.y + 26, 120, 3, 1 - clamp(bcd / bmax, 0, 1), bcd > 0 ? PAL.amber : PAL.mint);
      for (let i = 0; i < 4; i++) {
        const [px, py] = pos[i];
        const sel = this.sel.power === 4 + i;
        const bw = 110, bh = 40;
        const bx = px - bw / 2, by = py - bh / 2;
        const cap = n(capA[i], 4);
        const em = EMITTER_OF[i], emSt = (ship.systems || {})[em] || 'ok';
        const bu = sh.burst && sh.burst.sector === i && n(sh.burst.left) > 0 ? sh.burst : null;
        ctx.fillStyle = bu ? 'rgba(232,248,255,0.16)' : sel ? 'rgba(127,224,194,0.12)' : 'rgba(21,27,43,0.9)'; ctx.fillRect(bx, by, bw, bh);
        if (cap <= 0) R.crossX(ctx, bx, by, bw, bh, 'rgba(224,71,60,0.55)', 2);
        const tl = tele[i];
        if (tl) { ctx.strokeStyle = Math.floor(t * 8) % 2 ? PAL.red : '#FF8A7A'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2); ctx.setLineDash([]); ctx.lineWidth = 1; }
        ctx.strokeStyle = bu ? R.BURST_COL : sel ? PAL.amber : PAL.panel; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        R.text(ctx, H.SECTOR_NAMES[i], bx + 5, by + 3, { color: sel ? PAL.amber : PAL.star });
        if (tl) R.text(ctx, f1(tl.left) + ' s!', bx + bw - 4, by + 3, { color: PAL.red, align: 'right' });
        else if (emSt !== 'ok') R.stateBadge(ctx, bx + bw - 38, by + 2, 34, 10, emSt, R.fragileOf(view.state, em), { code: cap <= 0 ? 'AUS' : cap < 4 ? '1/2' : undefined });
        else if (R.fragileOf(view.state, em)) R.stateBadge(ctx, bx + bw - 38, by + 2, 34, 10, 'ok', true);
        for (let k = 0; k < 4; k++) {
          const filled = k < n(cur[i]), wanted = k < n(alloc[i]);
          const over = k >= cap;
          const pxx = px - 22 + k * 12, pyy = by + 15;
          ctx.fillStyle = filled ? PAL.mint : over ? '#3A2A1A' : wanted ? '#2F5A50' : '#26313F';
          ctx.fillRect(pxx, pyy, 10, 8);
          if (over && cap > 0) R.hatch(ctx, pxx, pyy, 10, 8, 'rgba(242,201,76,0.7)', 3);
        }
        if (cap > 0 && cap < 4) R.text(ctx, '1/2', px + 28, by + 15, { color: PAL.warn });
        if (cap <= 0) R.text(ctx, 'AUS', px, by + 15, { color: PAL.red, align: 'center', scale: 1 });
        const minusR = n(alloc[i]) <= 0 ? 'Minimum erreicht' : null;
        const plusR = n(alloc[i]) >= 4 ? 'Maximum (4)' : allocSum >= pool ? 'Schildpool erschöpft – mehr Energie auf Schilde' : null;
        R.button(ctx, bx + 4, by + 25, 16, 13, '-', { disabled: !!minusR, reason: minusR, onClick: () => { this.sel.power = 4 + i; this.cmd(view, 'captain.shield', { sector: i, delta: -1 }); } });
        R.button(ctx, bx + bw - 20, by + 25, 16, 13, '+', { disabled: !!plusR, reason: plusR, onClick: () => { this.sel.power = 4 + i; this.cmd(view, 'captain.shield', { sector: i, delta: 1 }); } });
        const br = this.burstReason(ship, i);
        R.button(ctx, bx + 23, by + 25, bw - 46, 13, bu ? (n(bu.perfectLeft) > 0 ? 'PERFEKT!' : 'STOSS ' + f1(bu.left)) : 'Stoß', { hotkey: bu ? null : 'B' + (i + 1), active: !!bu, disabled: !!br && !bu, reason: br, onClick: () => this.burst(view, i) });
      }
      return '↑/↓ wählen · ←/→ verteilen · B+1–4 / Shift+Pfeil Schildstoß · U überladen · Tab Reiter';
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
          R.text(ctx, wt != null ? f1(wt) + ' s' : '–', a.x + 196, y + 1, { color: PAL.panelLight, align: 'right' });
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
      R.text(ctx, 'Lecks: ' + (br.length ? roomList(br.map(b => [b.tx, b.ty]), 3) : 'keine'), px, ly, { color: br.length ? PAL.ice : PAL.moss }); ly += 14;
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
      else if (id === 'bow' && m.aim) reason = 'Zielt (' + f1(m.aim.left) + ' s)';
      else if (MOUNT_SYS[id] && n(m.alloc, 1) <= 0 && n(m.charge) < 1) reason = 'Keine Ladepunkte (A/D)';
      else if (MOUNT_SYS[id] && n(m.salvo) > 0) reason = 'Salve läuft';
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
      if (this.isM3(view)) return 'Q/E Waffe · A/D Punkte · 1/2/3 feuern · Leer alle · H halten · T Ziel · S Scan · W Weitscan · M/X Marker';
      return 'T/Klick Ziel · 1/2 Phase · Leer beide · S halten Scan · W Weitscan · Rechtsklick/M Marker · X löschen · Z Zoom';
    },
    // M3a: Waffenblock der Taktik – Lanze + Batterien mit Ladepunkten (Q/E wählen, A/D −/+), Halten/Feuer frei (H)
    weaponsM3(ctx, view, rx, rw, y) {
      const ship = view.state.ship || {};
      const cp = n(ship.chargePoints);
      const ms = M3_MOUNTS.map(id => (ship.mounts || []).find(m => m.id === id) || { id, missing: true });
      const used = ms.reduce((s, m) => s + n(m.alloc), 0);
      const amax = m3('allocMax', 4);
      this.sel.mount = clamp(this.sel.mount, 0, 2);
      R.text(ctx, 'WAFFEN', rx, y, { color: PAL.brass });
      R.text(ctx, 'Ladepunkte ' + used + '/' + cp, rx + 44, y, { color: cp === 0 ? PAL.red : used < cp ? PAL.amber : PAL.mint });
      const anyReady = M3_MOUNTS.some(id => !this.mountInfo(view, id).reason);
      R.button(ctx, rx + 132, y - 2, rw - 132, 12, 'alle', { hotkey: 'Leer', disabled: !anyReady, reason: 'Keine Waffe bereit (Ladung/Ziel/Bogen)', onClick: () => this.cmd(view, 'weapons.fire', { mount: 'all' }) });
      y += 12;
      ms.forEach((m, i) => {
        const sel = this.sel.mount === i;
        const info = this.mountInfo(view, m.id);
        const st = m.missing ? 'ok' : (m.state || (ship.systems || {})[MOUNT_SYS[m.id]] || 'ok');
        if (sel) { ctx.fillStyle = 'rgba(255,198,107,0.10)'; ctx.fillRect(rx - 2, y - 1, rw + 3, 26); ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1; ctx.strokeRect(rx - 1.5, y - 0.5, rw + 2, 25); }
        R.button(ctx, rx, y, 76, 12, MOUNT_NAMES[m.id], { hotkey: MOUNT_KEYS[m.id], disabled: !!info.reason, reason: info.reason, active: !!m.aim, onClick: () => { this.sel.mount = i; this.cmd(view, 'weapons.fire', { mount: m.id }); } });
        const ch = n(m.charge);
        R.bar(ctx, rx + 80, y + 4, 36, 5, ch, ch >= 1 ? PAL.mint : PAL.amber);
        let status = st === 'broken' || st === 'offline' ? 'AUS' : m.aim ? 'ZIELT ' + f1(m.aim.left) : n(m.salvo) > 0 ? 'Salve ' + n(m.salvo) : ch >= 1 ? (info.reason ? 'geladen' : 'BEREIT') : Math.round(ch * 100) + ' %';
        // QA M3a: Das Schiff dreht noch nach (Trägheit) – eine Zielphase jetzt würde sehr wahrscheinlich abbrechen
        const turning = m.id === 'bow' && !m.aim && ch >= 1 && Math.abs(n(ship.turnVel)) > 0.12;
        if (turning) status = 'DREHT NOCH';
        R.text(ctx, status, rx + 120, y + 2, { color: st === 'broken' ? PAL.red : m.aim ? R.BURST_COL : turning ? PAL.amber : !info.reason ? PAL.mint : PAL.panelLight });
        if (st !== 'ok' || R.fragileOf(view.state, MOUNT_SYS[m.id])) R.stateBadge(ctx, rx + rw - 34, y + 1, 34, 10, st, R.fragileOf(view.state, MOUNT_SYS[m.id]));
        // Zeile 2: Ladepunkte − ●●○○ +, Halten/Feuer frei
        const y2 = y + 13;
        const al = n(m.alloc);
        R.button(ctx, rx, y2, 13, 11, '−', { disabled: m.missing || al <= 0, reason: 'Keine Punkte auf dieser Waffe', onClick: () => { this.sel.mount = i; this.cmd(view, 'weapons.alloc', { mount: m.id, delta: -1 }); } });
        for (let k = 0; k < amax; k++) { ctx.fillStyle = k < al ? PAL.amber : '#26313F'; ctx.fillRect(rx + 16 + k * 8, y2 + 3, 6, 6); }
        const plusR = m.missing ? 'Nicht verfügbar' : al >= amax ? 'Maximum (' + amax + ')' : used >= cp ? (cp ? 'Alle Ladepunkte verteilt – erst anderswo abziehen' : 'Keine Waffenenergie (Captain)') : null;
        R.button(ctx, rx + 16 + amax * 8 + 1, y2, 13, 11, '+', { disabled: !!plusR, reason: plusR, onClick: () => { this.sel.mount = i; this.cmd(view, 'weapons.alloc', { mount: m.id, delta: 1 }); } });
        if (m.id === 'bow') {
          const per = m3('mounts.bow.secPerPoint', 24) * (st === 'damaged' ? m3('mounts.bow.damagedFactor', 1.5) : 1);
          R.text(ctx, al > 0 ? 'Ladung ' + Math.round(per / al) + ' s + Zielen ' + f1(m3('aimTime', 1.5)) : 'lädt nicht', rx + 66, y2 + 2, { color: PAL.panelLight });
        } else {
          const hold = !!m.hold;
          R.button(ctx, rx + 66, y2, 74, 11, hold ? 'Halten' : 'Feuer frei', { hotkey: sel ? 'H' : '', active: !hold, disabled: !!m.missing, reason: 'Nicht verfügbar', onClick: () => { this.sel.mount = i; this.cmd(view, 'weapons.hold', { mount: m.id, hold: !hold }); } });
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
    planClick(view, x, y, button) {
      const st = view.state, P = this.plan, mp = this.maps.plan;
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
          if (code === 'KeyF') return press(() => this.tryButton('Faltsprung'));
          return true;
        case 'captain': {
          const awayOn = this.awayActive(st);
          // M3a: Schildstoß auf jedem Reiter – B, dann 1–4 (Bug/Stb/Heck/Bb), oder Shift+Pfeil
          if (code === 'KeyB') { this.burstArm = performance.now(); view.actions.sfx('ui_click'); return true; }
          if (d >= 1 && d <= 4 && performance.now() - this.burstArm < 1500) { this.burstArm = 0; return press(() => this.burst(view, d - 1)); }
          if (e.shiftKey && /^Arrow/.test(code)) { const sec = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }[code]; if (!e.repeat) press(() => this.burst(view, sec)); return true; }
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
            // M3a: Q/E Waffe wählen, A/D Ladepunkte −/+, 1/2/3 Lanze/Bb/Stb, 4 Bolzen, Leer alle, H halten/frei
            if (code === 'KeyQ') { this.sel.mount = (this.sel.mount + 2) % 3; view.actions.sfx('ui_click'); return true; }
            if (code === 'KeyE') { this.sel.mount = (this.sel.mount + 1) % 3; view.actions.sfx('ui_click'); return true; }
            if (code === 'KeyA' || code === 'KeyD') {
              const id = M3_MOUNTS[this.sel.mount];
              const b = this.findButtons(code === 'KeyA' ? '−' : '+').filter(x => x.y > 60)[this.sel.mount];
              if (b && b.disabled) { this.denied(b.reason); return true; }
              return press(() => this.cmd(view, 'weapons.alloc', { mount: id, delta: code === 'KeyA' ? -1 : 1 }));
            }
            if (code === 'KeyH') {
              const id = M3_MOUNTS[this.sel.mount];
              if (id === 'bow') { this.denied('Halten/Feuer frei gibt es nur für die Batterien (Q/E wählen)'); return true; }
              const m = ((st.ship || {}).mounts || []).find(x => x.id === id);
              return press(() => this.cmd(view, 'weapons.hold', { mount: id, hold: !(m && m.hold) }));
            }
            if (d >= 1 && d <= 3) { this.sel.mount = d - 1; return press(() => this.tryButton(MOUNT_NAMES[M3_MOUNTS[d - 1]])); }
            if (d === 4) return press(() => this.tryButton('Bolzen'));
            if (code === 'Space') return press(() => this.tryButton('alle'));
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
      if (e.code === 'Space' && this.scanOn) this.setScan(view, false);
      if (e.code === 'KeyS' && this.tscanOn) this.setTscan(view, false);
      return !!(view.me && view.me.console);
    },
    releaseAll(view) {
      this.keys = {};
      this.mouseHold = null;
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
      const changed = ax.turn !== hs.turn || ax.thrust !== hs.thrust;
      if (changed || ((ax.turn || ax.thrust) && hs.t >= 0.1)) {
        view.send({ t: 'cmd', c: 'helm.input', turn: ax.turn, thrust: ax.thrust });
        hs.turn = ax.turn; hs.thrust = ax.thrust; hs.t = 0;
      }
    },
  };

  window.Consoles = Consoles;
})();
