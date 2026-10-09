// Renderer (CONTRACT.md §9, §10, §12). Globales `Render`.
// Innenraum/Plattform, Taktikansicht, Mini-Schiffsplan, UI-Helfer (Text, Panel, Icon, Buttons).
// Jeder Art-Aufruf läuft über Render.art(): Fehler werden gezählt, nach wiederholtem Fehlschlag
// wird für diese Funktion/Art dauerhaft der Fallback-Renderer benutzt.
(function () {
  'use strict';

  const Maps = window.Shared_Maps;
  const Phys = window.Shared_Physics;
  const CFG = window.Shared_Config || {};
  const PROTO = window.Shared_Protocol || {};
  const TILE = 32, VW = 640, VH = 360;

  // W2 AP3b: bewegte Brocken – dieselbe Funktion wie der Server (shared/drift.js). index.html lädt sie (noch) nicht:
  // dann einmal nachladen; bis dahin stehen die Brocken an ihrer Bahnmitte.
  if (!window.Shared_Drift && typeof document !== 'undefined') {
    try { const s = document.createElement('script'); s.src = '/shared/drift.js'; s.async = true; document.head.appendChild(s); } catch (e) { /* ohne Drift: still */ }
  }
  // Brocken zur Spielzeit (Snapshot-Zeit + Zeit seit Empfang, höchstens 0,25 s weitergerechnet)
  function brockenJetzt(st) {
    const list = (st && st.space && st.space.asteroids) || [];
    const D = window.Shared_Drift;
    if (!D || !D.bewegt(list)) return list;
    const seit = st._empfangen ? Math.max(0, Math.min(0.25, (performance.now() - st._empfangen) / 1000)) : 0;
    return D.jetzt(list, (+st.time || 0) + seit);
  }

  const PAL = {
    wood: '#8A5A3B', brass: '#C9974A', terra: '#B4573E', hull: '#2E3A4A', panel: '#4F6178',
    panelLight: '#8EA3B5', mint: '#7FE0C2', amber: '#FFC66B', warn: '#F2C94C', red: '#E0473C',
    spark: '#FFF1B8', smoke: '#5A5560', space: '#0B0E1A', indigo: '#2A2350', star: '#F4EEDC',
    moss: '#5E8C4A', rust: '#C2703D', ice: '#A9D6E5',
    skin: ['#F1C7A0', '#C68A5E', '#7A4A2E'],
    players: PROTO.PLAYER_COLORS || ['#56B4E9', '#E69F00', '#CC79A7'],
    dark: '#151B2B', grey: '#6B7380',
    seal: '#9E1F27',   // S1: Siegel (Lerche-Rot) für „Weltstand gesichert“
  };
  const SHAPES = PROTO.PLAYER_SHAPES || ['circle', 'triangle', 'diamond'];

  function report(label, e) { if (window.Net) Net.reportError(label, e); else console.warn(label, e); }

  // ------------------------------------------------------------------ Art-Wrapper
  const artFail = {};
  const ART_MAX_FAILS = 3;
  function artOk(name, key) {
    const A = window.Art;
    if (!A || typeof A[name] !== 'function') return false;
    return (artFail[key || name] || 0) < ART_MAX_FAILS;
  }
  // Ruft Art[name](...args) auf. true bei Erfolg, false -> Aufrufer zeichnet Fallback.
  function art(name, key, args) {
    if (!artOk(name, key)) return false;
    try { window.Art[name].apply(window.Art, args); return true; } catch (e) {
      const k = key || name;
      artFail[k] = (artFail[k] || 0) + 1;
      report('Art.' + k, e);
      return false;
    }
  }

  // ------------------------------------------------------------------ Text & UI-Grundbausteine
  const measureCanvas = document.createElement('canvas').getContext('2d');
  function fallbackFont(scale) { return (scale === 2 ? 14 : 8) + 'px monospace'; }

  function measure(text, scale) {
    text = String(text == null ? '' : text);
    scale = scale || 1;
    if (artOk('measureText')) {
      try { const w = window.Art.measureText(text, scale); if (typeof w === 'number' && isFinite(w)) return w; } catch (e) {
        artFail.measureText = (artFail.measureText || 0) + 1; report('Art.measureText', e);
      }
    }
    measureCanvas.font = fallbackFont(scale);
    return Math.ceil(measureCanvas.measureText(text).width);
  }

  function text(ctx, str, x, y, opts) {
    opts = opts || {};
    str = String(str == null ? '' : str);
    if (!str) return;
    const o = { color: opts.color || PAL.star, scale: opts.scale || 1, align: opts.align || 'left', shadow: opts.shadow !== false };
    if (art('drawText', null, [ctx, str, Math.round(x), Math.round(y), o])) return;
    ctx.save();
    ctx.font = fallbackFont(o.scale);
    ctx.textBaseline = 'top';
    ctx.textAlign = o.align;
    if (o.shadow) { ctx.fillStyle = 'rgba(11,14,26,0.85)'; ctx.fillText(str, Math.round(x) + 1, Math.round(y) + 1); }
    ctx.fillStyle = o.color;
    ctx.fillText(str, Math.round(x), Math.round(y));
    ctx.restore();
  }

  // Zeilenumbruch nach Pixelbreite.
  function wrap(str, maxW, scale) {
    const words = String(str || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (measure(test, scale) > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function panel(ctx, x, y, w, h, opts) {
    opts = opts || {};
    if (art('drawPanel', null, [ctx, x, y, w, h, opts])) return;
    const style = opts.style || 'screen';
    ctx.fillStyle = style === 'brass' ? '#3A2E22' : style === 'plain' ? 'rgba(21,27,43,0.92)' : '#0E1A1F';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = style === 'plain' ? PAL.panel : PAL.brass;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    if (style === 'screen') { ctx.strokeStyle = 'rgba(127,224,194,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7); }
    if (opts.title) {
      const tw = measure(opts.title, 1) + 10;
      ctx.fillStyle = PAL.brass; ctx.fillRect(x + 8, y - 4, tw, 11);
      text(ctx, opts.title, x + 13, y - 2, { color: PAL.space, shadow: false });
    }
  }

  // Halbtransparenter Hintergrund für HUD-Texte.
  function backdrop(ctx, x, y, w, h, alpha) {
    ctx.fillStyle = 'rgba(11,14,26,' + (alpha == null ? 0.72 : alpha) + ')';
    ctx.fillRect(x, y, w, h);
  }

  function shape(ctx, kind, x, y, size, color, outline) {
    const s = size / 2;
    ctx.beginPath();
    if (kind === 'circle' || kind === 'kreis') ctx.arc(x, y, s, 0, Math.PI * 2);
    else if (kind === 'triangle' || kind === 'dreieck') { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s * 0.85); ctx.lineTo(x - s, y + s * 0.85); ctx.closePath(); }
    else if (kind === 'diamond' || kind === 'raute') { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); }
    else if (kind === 'stern') {
      for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.45 : s; const a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      ctx.closePath();
    } else if (kind === 'kreuz') { ctx.rect(x - s, y - s * 0.3, size, s * 0.6); ctx.rect(x - s * 0.3, y - s, s * 0.6, size); }
    else if (kind === 'welle') { ctx.rect(x - s, y - 1, size, 3); }
    else ctx.rect(x - s, y - s, size, size);
    ctx.fillStyle = color; ctx.fill();
    if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke(); }
  }

  const ICON_FALLBACK = {
    reactor: ['R', PAL.amber], engines: ['A', PAL.rust], shields: ['S', PAL.ice], weapons: ['W', PAL.red],
    life: ['L', PAL.moss], transfer: ['T', PAL.mint], fire: ['F', PAL.red], breach: ['B', PAL.ice],
    o2: ['O', PAL.ice], hull: ['H', PAL.panelLight], marks: ['M', PAL.brass], lock: ['X', PAL.grey], arrow: ['>', PAL.warn],
    // M3a: neue Systeme (Fallback-Buchstaben: D Düse, E Emitter, W Bug-Waffe, B Batterie)
    thruster_port: ['D', PAL.rust], thruster_stbd: ['D', PAL.rust], emitter_bow: ['E', PAL.ice], emitter_stbd: ['E', PAL.ice],
    emitter_aft: ['E', PAL.ice], emitter_port: ['E', PAL.ice], weapon_bow: ['W', PAL.red], battery_port: ['B', PAL.brass], battery_stbd: ['B', PAL.brass],
  };
  // M3a: Icons, die art.js evtl. noch nicht kennt -> nur mit Probe (Magenta-Platzhalter = Fallback)
  const M3_SYS_ICON = { thruster_port: 1, thruster_stbd: 1, emitter_bow: 1, emitter_stbd: 1, emitter_aft: 1, emitter_port: 1, weapon_bow: 1, battery_port: 1, battery_stbd: 1 };
  function icon(ctx, name, x, y, opts) {
    opts = opts || {};
    if (M3_SYS_ICON[name]) { if (artIcon(ctx, name, x, y, opts)) return; }
    else if (art('drawIcon', 'drawIcon:' + name, [ctx, name, x, y, opts])) return;
    if (['circle', 'triangle', 'diamond', 'kreis', 'dreieck', 'raute', 'stern', 'welle', 'kreuz'].indexOf(name) >= 0) {
      shape(ctx, name, x, y, 10, opts.color || PAL.star);
      return;
    }
    const f = ICON_FALLBACK[name] || ['?', PAL.star];
    ctx.fillStyle = PAL.dark; ctx.fillRect(x - 6, y - 6, 12, 12);
    ctx.strokeStyle = opts.color || f[1]; ctx.lineWidth = 1; ctx.strokeRect(x - 5.5, y - 5.5, 11, 11);
    text(ctx, f[0], x, y - 3, { color: opts.color || f[1], align: 'center', shadow: false });
  }

  function bar(ctx, x, y, w, h, frac, color, bg) {
    frac = Math.max(0, Math.min(1, +frac || 0));
    ctx.fillStyle = bg || 'rgba(46,58,74,0.9)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color || PAL.mint; ctx.fillRect(x, y, Math.round(w * frac), h);
    ctx.strokeStyle = 'rgba(11,14,26,0.9)'; ctx.lineWidth = 1; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  }

  function ring(ctx, x, y, r, frac, color) {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(11,14,26,0.8)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = color || PAL.mint;
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, frac))); ctx.stroke();
    ctx.restore();
  }

  // M3a: Fortschrittsbalken über dem Kopf (Flicken / Teil einbauen / Minispiel)
  const ACTION_LABEL = { flick: 'FLICKEN', swap: 'TEIL EINBAUEN', minigame: 'MINISPIEL',
    // B1: Anker-Interaktionen (Kinds anker:<rolle>), B2: Halte-Interaktionen
    'anker:terminal': 'DOWNLOAD', 'anker:sprengpunkt': 'LADUNG', 'anker:zelle': 'ZELLE', 'anker:beute': 'BERGEN', 'anker:ziel': 'HALTEN',
    'anker:fund': 'BERGEN', 'anker:raetsel': 'SCHLOSS', 'anker:versteck': 'AUFBRECHEN', 'anker:eingang': 'HACKEN', 'anker:tuer': 'ÖFFNEN',
    'anker:leiter': 'LEITER', fesseln: 'FESSELN', befreien: 'BEFREIEN', aufrichten: 'AUFRICHTEN', ausruestung: 'AUSRÜSTUNG', zellentuer: 'ZELLENTÜR' };
  // setbackAge: M3b §4 – Sekunden seit einem Rückschlag (repairSetback) oder null. Dann: verlorenes Stück rot, verblassend,
  // Balken zittert, Beschriftung „RÜCKSCHLAG −50 %“.
  function actionBar(ctx, x, y, action, mine, setbackAge) {
    const p = Math.max(0, Math.min(1, +action.progress || 0));
    const w = 36, col = action.kind === 'swap' ? PAL.mint : action.kind === 'flick' ? '#F08A3C' : PAL.amber;
    const sb = setbackAge != null && setbackAge < 1.5;
    if (sb && setbackAge < 0.4) x += Math.round(Math.sin(setbackAge * 60) * 2);
    x = Math.round(x); y = Math.round(y);
    const loss = cfgM3b('repairHitLoss', 0.5);
    const lab = sb ? 'RÜCKSCHLAG −' + Math.round(loss * 100) + ' %' : (ACTION_LABEL[action.kind] || '') + (action.kind === 'minigame' ? '' : ' ' + Math.round(p * 100) + ' %');
    const lw = mine || sb ? Math.max(w, measure(lab, 1)) : w;
    backdrop(ctx, x - lw / 2 - 2, y - 2, lw + 4, mine || sb ? 17 : 7, 0.72);
    bar(ctx, x - w / 2, y, w, 3, p, col);
    if (sb) {
      const old = Math.min(1, loss < 1 ? p / (1 - loss) : 1);
      const a = Math.max(0, 1 - setbackAge / 1.5);
      ctx.fillStyle = 'rgba(255,90,74,' + (0.35 + 0.6 * a) + ')';
      ctx.fillRect(x - w / 2 + Math.round(w * p), y, Math.max(1, Math.round(w * (old - p))), 3);
    }
    if (mine || sb) text(ctx, lab, x, y + 6, { color: sb ? '#FF5A4A' : col, align: 'center', shadow: false });
  }
  function cfgM3b(path, d) { let o = CFG.spaceM3b; for (const k of path.split('.')) { if (o == null) break; o = o[k]; } return typeof o === 'number' ? o : d; }
  // M3b: Alter des jüngsten Rückschlags für Spieler (pid) bzw. Schrauber (bot) an system, sonst null
  function setbackAgeFor(view, who, id, system) {
    let best = null;
    for (const s of view.setbacks || []) {
      const match = who === 'bot' ? (s.bot ? s.bot === id : !s.pid && s.system === system) : (s.pid ? s.pid === id : !s.bot && s.system === system);
      if (match && (best == null || s.age < best)) best = s.age;
    }
    return best;
  }

  // ------------------------------------------------------------------ UI-Buttons (Maus + Tooltip)
  const ui = { buttons: [], mouse: { x: -1, y: -1 }, tooltip: null };
  function beginUi() { ui.buttons = []; ui.tooltip = null; }
  function hit(b, x, y) { return x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h; }
  // Zeichnet einen Button und registriert ihn für Klicks. opts: { disabled, reason, active, hotkey, onClick, color, small }
  function button(ctx, x, y, w, h, label, opts) {
    opts = opts || {};
    const hover = hit({ x, y, w, h }, ui.mouse.x, ui.mouse.y);
    const dis = !!opts.disabled;
    ctx.fillStyle = dis ? '#232A36' : opts.active ? '#3D5A55' : hover ? '#34465A' : '#26313F';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = dis ? '#3A4250' : opts.active ? PAL.mint : hover ? PAL.amber : PAL.panel;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const col = dis ? '#6B7380' : (opts.color || (opts.active ? PAL.mint : PAL.star));
    let lx = x + 5;
    if (opts.hotkey) {
      const kw = measure(opts.hotkey, 1) + 4;
      ctx.fillStyle = dis ? '#3A4250' : PAL.brass; ctx.fillRect(x + 3, y + Math.floor(h / 2) - 5, kw, 10);
      text(ctx, opts.hotkey, x + 5, y + Math.floor(h / 2) - 4, { color: PAL.space, shadow: false });
      lx += kw + 2;
    }
    text(ctx, label, lx, y + Math.floor(h / 2) - 4, { color: col });
    const b = { x, y, w, h, label, disabled: dis, reason: opts.reason, onClick: opts.onClick, hotkey: opts.hotkey || null };
    ui.buttons.push(b);
    if (hover && dis && opts.reason) ui.tooltip = { text: opts.reason, x: ui.mouse.x, y: ui.mouse.y };
    return b;
  }
  function clickUi(x, y) {
    for (let i = ui.buttons.length - 1; i >= 0; i--) {
      const b = ui.buttons[i];
      if (hit(b, x, y)) {
        if (b.disabled) { Render.uiDenied = { text: b.reason || 'Gesperrt', t: performance.now() }; return 'denied'; }
        if (b.onClick) { try { b.onClick(); } catch (e) { report('ui.onClick', e); } }
        return 'ok';
      }
    }
    return null;
  }
  function drawTooltip(ctx) {
    const t = ui.tooltip;
    if (!t) return;
    const w = measure(t.text, 1) + 8;
    const x = Math.min(VW - w - 2, t.x + 8), y = Math.min(VH - 14, t.y + 10);
    ctx.fillStyle = 'rgba(11,14,26,0.95)'; ctx.fillRect(x, y, w, 12);
    ctx.strokeStyle = PAL.warn; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 11);
    text(ctx, t.text, x + 4, y + 2, { color: PAL.warn, shadow: false });
  }

  // ------------------------------------------------------------------ Karten-Hilfen
  const OBJ = {
    H: 'console_helm', C: 'console_captain', W: 'console_weapons', T: 'console_transfer', S: 'terminal_shop',
    L: 'shelf', B: 'bed', R: 'sys_reactor', E: 'sys_engines', G: 'sys_shields', K: 'sys_weapons', X: 'sys_transfer',
    O: 'sys_life', m: 'table', p: 'plant', c: 'crate', x: 'crate', b: 'buoy_core', Z: 'sonde',
    u: 'pipes', k: 'workbench', n: 'control_desk', f: 'barrel',   // M0: Maschinenraum
    y: 'reactor_switch', Y: 'plan_table',                         // M1
  };
  // M1: Wrack „Zaunkönig“ (Außenkarte) – eigene Objektzeichen
  const OBJ_WRECK = { h: 'salvage', g: 'lore_terminal', V: 'wall_weak', x: 'debris' };
  // M3a: System/Konsole/Objekt-Art eines Zeichens kommen aus der Legende der Karte (map.legend[ch].system/.console/.kind).
  // Die festen Tabellen sind nur noch Fallback für Zeichen ohne Legende (z. B. Ersatzkarten ohne legend).
  const SYS_BY_CHAR_FB = { R: 'reactor', E: 'engines', G: 'shields', K: 'weapons', X: 'transfer', O: 'life' };
  const CONSOLE_BY_CHAR_FB = { H: 'helm', C: 'captain', W: 'weapons', T: 'transfer', S: 'shop', Y: 'plan' };
  const NON_OBJ_KINDS = { wall: 1, void: 1, space: 1, rock: 1, wall_ruin: 1 };
  function legendOf(map, ch) {
    const L = map && map.legend;
    return L && Object.prototype.hasOwnProperty.call(L, ch) ? L[ch] : undefined;
  }
  function sysOf(map, ch) { const i = legendOf(map, ch); return i ? (i.system || null) : (SYS_BY_CHAR_FB[ch] || null); }
  function consoleOf(map, ch) { const i = legendOf(map, ch); return i ? (i.console || null) : (CONSOLE_BY_CHAR_FB[ch] || null); }
  // Objekt-Art einer Schiffskachel (solide Legenden-Einträge außer Wand/Leere); andere Karten weiter über OBJ
  function objKindOf(map, ch) {
    if (map && map.id === 'ship') { const i = legendOf(map, ch); if (i) return i.solid && !NON_OBJ_KINDS[i.kind] ? i.kind : null; }
    return OBJ[ch] || null;
  }
  // Zeichen -> System/Konsole der Schiffskarte (Altnamen für andere Module; Ableitung aus der Schiffslegende)
  const SYS_BY_CHAR = {}, CONSOLE_BY_CHAR = {};
  (function buildShipTables() {
    const L = (Maps && Maps.ship && Maps.ship.legend) || null;
    if (!L) { Object.assign(SYS_BY_CHAR, SYS_BY_CHAR_FB); Object.assign(CONSOLE_BY_CHAR, CONSOLE_BY_CHAR_FB); return; }
    for (const ch in L) { if (L[ch].system) SYS_BY_CHAR[ch] = L[ch].system; if (L[ch].console) CONSOLE_BY_CHAR[ch] = L[ch].console; }
    for (const ch in SYS_BY_CHAR_FB) if (!(ch in L)) SYS_BY_CHAR[ch] = SYS_BY_CHAR_FB[ch];
    for (const ch in CONSOLE_BY_CHAR_FB) if (!(ch in L)) CONSOLE_BY_CHAR[ch] = CONSOLE_BY_CHAR_FB[ch];
  })();
  // Regal einer Schiffskachel (Gegenstand) aus dem Schiffslayout
  function shelfItemAt(tx, ty) {
    if (Maps.shelfAt) { const s = Maps.shelfAt(tx, ty); return s ? s.item : null; }
    return null;
  }
  function shelfTiles() { return Maps.SHELF_TILES || []; }
  const FLOOR = { '.': 1, ',': 1, '=': 1, '_': 1, 'D': 1, 'P': 1, 'N': 1, 'Q': 1, 'd': 1, 'a': 1 };

  // M1: Wrack-Karte. Maßgeblich ist Shared_Maps.wreck (Team SERVER). Fehlt sie (Mock/Entwicklung),
  // nimmt der Client diese kleine Ersatzkarte, damit Ansicht und Vorhersage nicht brechen.
  const WRECK_FB_ROWS = [
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~############~~~~~###########~',
    '~#....h.....#~~~~~#...g.....#~',
    '~#.P.P......#######....a....#~',
    '~#..P...x..........____.....#~',
    '~#.........########____....h#~',
    '~###..######~~~~~~#.........#~',
    '~~~#..#~~~~~~~~~~~####V######~',
    '~~~#..#~~~~~~~~~~~~~#...#~~~~~',
    '~~~#..#########~~~~~#.h.#~~~~~',
    '~~~#.....x....#~~~~~#####~~~~~',
    '~~~#..a......h#~~~~~~~~~~~~~~~',
    '~~~#..........#~~~~~~~~~~~~~~~',
    '~~~############~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  ];
  let wreckFb = null;
  function wreckMap() {
    if (Maps.wreck) return Maps.wreck;
    if (!wreckFb) {
      const leg = Object.assign({}, Maps.LEGEND, Maps.WRECK_LEGEND || {}, {
        'h': { kind: 'salvage', solid: true, interact: 'salvage' }, 'g': { kind: 'lore_terminal', solid: true, interact: 'lore' },
        'a': { kind: 'floor_metal', spawn: 'scavenger' }, 'V': { kind: 'wall_weak', solid: true, interact: 'hollow' },
        'x': { kind: 'debris', solid: true }, 'P': { kind: 'pad' },
      });
      wreckFb = Maps.makeMap('wreck', WRECK_FB_ROWS, leg);
      wreckFb.fallback = true;
    }
    return wreckFb;
  }
  function awayMapId(st) { return (st && st.away && st.away.map) || 'platform'; }
  // M2: weitere Außenkarten aus shared/maps.js (z. B. 'kesh'), sonst Plattform
  function awayMapById(id) {
    if (id === 'wreck') return wreckMap();
    if (id && id !== 'platform' && id !== 'ship' && Maps[id] && typeof Maps[id].at === 'function') return Maps[id];
    return Maps.platform;
  }
  // Karte einer Zone; für 'away' entscheidet away.map (platform | wreck | kesh)
  function mapFor(zone, st) {
    if (zone !== 'away') return Maps.ship;
    return awayMapById(awayMapId(st || Render.lastState));
  }
  function mapById(id) {
    if (id === 'ship') return Maps.ship;
    if (id === 'wreck' || id === 'platform') return awayMapById(id);
    return id && Maps[id] && typeof Maps[id].at === 'function' ? Maps[id] : null;
  }
  // ------------------------------------------------------------------ B1 Bühnen: gebaute Außenkarten (Ereignis awayMap)
  // Der Server schickt die kompilierte Karte (CONTRACT-B1 §9 + Nachtrag: kanten, plaetze). CLIENT registriert sie als
  // makeMap-Objekt in Shared_Maps[lpId]; die awayMap-Felder liegen direkt am Objekt und unter .karte (VOXEL liest beides).
  // Kachelarten aus content/buehnen/kacheln.json (beim Start geladen; bis dahin dieser Auszug, gleiche Werte).
  const KACHELN_FB = {
    '.': ['boden'], ',': ['boden2'], ':': ['gelaende'], '^': ['plateau'], '/': ['rampe'], 'P': ['pad'],
    'k': ['kante', true, 1, true], '#': ['wand', true, 2, false, true], '=': ['zaun', true, 2, false, true], 'z': ['gitter', true],
    '|': ['fenster', true], 'F': ['fels', true, 2, false, true], '~': ['abgrund', true], '_': ['leere', true, 2, false, true],
    'o': ['deckung_halb', true, 1, true], 'O': ['deckung_voll', true, 2, false, true], 'I': ['pfeiler', true, 2, false, true],
    'x': ['truemmer', true, 1, true], 'X': ['schutt', true, 2, false, true],
    'D': ['tuer', 'zustand', 0, false, false, ['offen', 'zu', 'verschlossen', 'gesprengt'], ['offen', 'gesprengt'], 'tuer'],
    'S': ['schott', 'zustand', 0, false, false, ['zu', 'offen', 'gehackt', 'verschlossen'], ['offen', 'gehackt'], 'tuer'],
    'G': ['tor', 'zustand', 2, false, false, ['zu', 'offen', 'gesprengt'], ['offen', 'gesprengt'], 'tuer'],
    'L': ['luke', 'zustand', 0, false, false, ['zu', 'offen'], ['offen'], 'tuer'],
    'w': ['wand_schwach', 'zustand', 2, false, false, ['intakt', 'offen'], ['offen']],
  };
  let KACHELN = {};
  for (const [ch, a] of Object.entries(KACHELN_FB)) KACHELN[ch] = { kind: a[0], solid: a[1] || false, cover: a[2] || 0, low: !!a[3], sperrtSicht: !!a[4], zustaende: a[5], begehbarIn: a[6], kante: a[7] };
  // Ankerrollen: Zustände (erster = Start) aus content/buehnen/anker.json (gleiche Werte als Auszug)
  let ANKER_ZUSTAENDE = { eingang: ['offen', 'verschlossen'], abholpunkt: ['bereit', 'gestoert'], terminal: ['bereit', 'laedt', 'geladen', 'gesperrt'],
    sprengpunkt: ['intakt', 'scharf', 'zerstoert'], zelle: ['zu', 'offen'], beute: ['voll', 'leer'], ziel: ['frei', 'genommen', 'aktiviert'],
    fund: ['da', 'genommen'], tor: ['zu', 'offen', 'verschlossen', 'gesprengt'], raetsel: ['ruhe', 'gehalten', 'geloest'], versteck: ['zu', 'offen'] };
  function ladeBuehnenDaten() {
    if (typeof fetch !== 'function') return;
    fetch('/content/buehnen/kacheln.json').then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !j.zeichen) return;
      const neu = {};
      for (const [ch, z] of Object.entries(j.zeichen)) neu[ch] = { kind: z.kind, solid: z.solid, cover: z.cover || 0, low: !!z.low, sperrtSicht: !!z.sperrtSicht, zustaende: z.zustaende, begehbarIn: z.begehbarIn, kante: z.kante };   // kante: Türgruppen (shared/buehne.js)
      KACHELN = neu;
      for (const id of Object.keys(buehnenKarten)) { const m = buehnenKarten[id]; for (const ch of Object.keys(neu)) m.legend[ch] = neu[ch]; }
    }).catch(() => { /* Auszug bleibt */ });
    fetch('/content/buehnen/anker.json').then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !j.rollen) return;
      const z = {};
      for (const [r, v] of Object.entries(j.rollen)) if (v && Array.isArray(v.zustaende) && v.zustaende.length) z[r] = v.zustaende;
      ANKER_ZUSTAENDE = z;
    }).catch(() => { /* Auszug bleibt */ });
  }
  // Shared_Buehne (shared/buehne.js: gemeinsame Regeln Server/Client – kachelZustandRegel, eingangAktion) bindet
  // index.html ein; dieses Nachladen ist nur der Rückfall für Seiten ohne das Skript-Tag (ein vorhandenes Tag wird nicht
  // doppelt gesetzt).
  function sharedBuehne() {
    if (window.Shared_Buehne || typeof document === 'undefined') return window.Shared_Buehne || null;
    const lade = (src, weiter) => {
      const da = document.querySelector('script[src="' + src + '"]');
      if (da) { if (weiter) da.addEventListener('load', weiter); return; }
      const sk = document.createElement('script'); sk.src = src; if (weiter) sk.onload = weiter; document.head.appendChild(sk);
    };
    if (window.Shared_BuehneKennzahlen) lade('/shared/buehne.js');
    else lade('/shared/buehne-kennzahlen.js', () => { if (!window.Shared_Buehne) lade('/shared/buehne.js'); });
    return null;
  }
  const buehnenKarten = {};   // lpId -> registriertes Kartenobjekt (auch in Maps[lpId])
  const HAND_KARTEN = ['platform', 'wreck', 'kesh', 'ship'];
  function registerAwayMap(ev) {
    if (!ev || !ev.id || !Array.isArray(ev.rows) || HAND_KARTEN.indexOf(ev.id) >= 0) return null;
    sharedBuehne();
    const legend = {};
    for (const ch of Object.keys(KACHELN)) legend[ch] = KACHELN[ch];
    legend['#'] = legend['#'] || { kind: 'wand', solid: true, cover: 2, sperrtSicht: true };
    const m = Maps.makeMap(ev.id, ev.rows, legend);
    const karte = {};
    for (const k of ['id', 'erzeuger', 'art', 'bauweise', 'besitz', 'zustand', 'seed', 'w', 'h', 'rows', 'anker', 'bereiche', 'decks', 'kanten', 'plaetze', 'kv']) if (ev[k] !== undefined) karte[k] = ev[k];
    Object.assign(m, karte, { karte, buehne: true, legende: legend });
    m.w = ev.rows[0].length; m.h = ev.rows.length;
    // Kachel -> Kantenindex (Zustand aus ko), Kachel -> Ankerindex (tor/eingang/versteck steuern Kacheln)
    m.kanteAt = new Map(); m.ankerAt = new Map(); m.ankerIdx = {};
    (ev.kanten || []).forEach((k, i) => { for (const t of k[1] || []) m.kanteAt.set(t[0] + ',' + t[1], i); });
    (ev.anker || []).forEach((a, i) => { m.ankerIdx[a[0]] = i; if (a[1] === 'tor' || a[1] === 'eingang' || a[1] === 'versteck') m.ankerAt.set(a[2] + ',' + a[3], i); });
    // Abholpunkt (Ankunft zuerst) als Pads wie interior.padTiles: Ankerkachel + begehbare Nachbarn
    const ab = (ev.anker || []).filter(a => a[1] === 'abholpunkt');
    const ank = ab.find(a => a[4] && a[4].ankunft) || ab[0] || null;
    m.pads = [];
    // F11: Pad-Felder aus shared/buehne.js padTiles (eine Quelle mit interior.js); Rückfall nur, falls SB noch nicht geladen ist
    const SBp = window.Shared_Buehne;
    const padTiles = (a) => {
      if (SBp && typeof SBp.padTiles === 'function') return SBp.padTiles(m, { x: a[2], y: a[3] });
      const out = [{ x: a[2], y: a[3] }]; for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (!m.solid(a[2] + dx, a[3] + dy)) out.push({ x: a[2] + dx, y: a[3] + dy }); return out;
    };
    if (ank) m.pads = padTiles(ank);
    // F11: alle Abholpunkte (Ankunft zuerst) wie interior.abgeleitet().pads – dort bietet der Server „Selbst-Transfer“ an
    m.abholPads = [];
    const gesehen = new Set();
    for (const a of (ank ? [ank] : []).concat(ab.filter(q => q !== ank))) for (const t of padTiles(a)) { const key = t.x + ',' + t.y; if (!gesehen.has(key)) { gesehen.add(key); m.abholPads.push(t); } }
    Maps[ev.id] = m;
    buehnenKarten[ev.id] = m;
    // Bereiche für Maps.inArea (Pins, Ziele)
    if (Maps.MAP_AREAS && ev.bereiche) {
      const areas = {};
      for (const bid of Object.keys(ev.bereiche)) { const b = ev.bereiche[bid] || {}; areas[bid] = { rects: (b.rects || []).map(r => r.slice()), rolle: b.rolle || null, gefecht: !!b.gefecht }; }
      Maps.MAP_AREAS[ev.id] = areas;
    }
    // höchstens 4 gebaute Karten behalten (Server: 2 + Handkarten)
    const ids = Object.keys(buehnenKarten);
    if (ids.length > 4) { const alt = ids.find(id => id !== ev.id && !(Render.lastState && Render.lastState.away && Render.lastState.away.map === id)); if (alt) { delete buehnenKarten[alt]; if (Maps[alt] && Maps[alt].buehne) delete Maps[alt]; } }
    return m;
  }
  function isBuehne(map) { return !!(map && map.buehne); }
  // Laufzeitzustand einer Ankerrolle: Start bzw. Abweichung aus away.ao
  function ankerZustand(map, st, idx) {
    const a = map && map.anker && map.anker[idx];
    if (!a) return null;
    const liste = ANKER_ZUSTAENDE[a[1]] || [];
    const ao = (st && st.away && st.away.map === map.id && st.away.ao) || [];
    for (const e of ao) if (e[0] === idx) return liste[e[1]] || liste[0] || null;
    return liste[0] || null;
  }
  // Zustandsliste des Kantentyps: typ = Kachelart der ersten Kachel (so setzt shared/buehne.js bauen karte.kanten[].typ);
  // in dieser Liste zählen startZustandIdx (awayMap.kanten) und der Snapshot-Index (ko) – auch bei gemischten Kanten.
  function kantenTypInfo(map, k) { const t = (k[1] || [])[0]; return (t ? map.info(t[0], t[1]) : null) || {}; }
  // Kante (awayMap.kanten-Index) -> { lauf: Laufzeitzustand aus ko oder null, start: Startzustand, durch: begehbarIn des Typs }
  function kantenZustandRoh(map, st, idx) {
    const k = map && map.kanten && map.kanten[idx]; if (!k) return { lauf: null, start: null, durch: null };
    const ti = kantenTypInfo(map, k); const liste = ti.zustaende || [];
    const ko = (st && st.away && st.away.map === map.id && st.away.ko) || [];
    let lauf = null; for (const e of ko) if (e[0] === idx && liste[e[1]]) lauf = liste[e[1]];
    return { lauf, start: liste[k[2] || 0] || null, durch: ti.begehbarIn || null };
  }
  // aktueller Zustand einer Kante (wie server zustandIn für Kanten)
  function kantenZustand(map, st, idx) { const r = kantenZustandRoh(map, st, idx); return r.lauf || r.start; }
  // Zustand einer Zustandskachel (D/S/G/L/w): eine Regel mit dem Server (shared/buehne.js kachelZustandRegel =
  // server/sim/interior.js kachelZustand). Rückfall nur ohne Shared_Buehne (Seite ohne Skript-Tag, bis nachgeladen): Kantenstart.
  function kachelZustand(map, st, tx, ty) {
    const info = map.info(tx, ty);
    const liste = info.zustaende || [];
    const key = tx + ',' + ty;
    const ki = map.kanteAt ? map.kanteAt.get(key) : undefined;
    const kz = ki != null ? kantenZustandRoh(map, st, ki) : { lauf: null, start: null, durch: null };
    const ai = map.ankerAt ? map.ankerAt.get(key) : undefined;
    let az = null;   // Anker nur mit Laufzeitabweichung (ao), wie aw.zustaende[ankerId] beim Server
    if (ai != null) { const ao = (st && st.away && st.away.map === map.id && st.away.ao) || []; if (ao.some(e => e[0] === ai)) az = ankerZustand(map, st, ai); }
    const SB = window.Shared_Buehne || sharedBuehne();
    if (SB && SB.kachelZustandRegel) return SB.kachelZustandRegel(liste, kz.lauf, az, kz.start, kz.durch);
    return (kz.start && liste.indexOf(kz.start) >= 0) ? kz.start : (liste[0] || null);
  }
  function buehneSolid(map, st) {
    return (tx, ty) => {
      const info = map.info(tx, ty);
      if (info.solid !== 'zustand') return !!info.solid;
      return (info.begehbarIn || []).indexOf(kachelZustand(map, st, tx, ty)) < 0;
    };
  }
  // 2D-Rückfall (E35): nur Flachraster nach Kachelart, ohne Art, ohne neue Figuren
  const BUEHNE_FARBE = { boden: '#3A4250', boden2: '#465060', gelaende: '#4A4436', plateau: '#5E6448', rampe: '#565A40', pad: '#2F5E58',
    kante: '#8A8262', wand: '#1C222D', zaun: '#3E3224', gitter: '#5C6472', fenster: '#5E8AA6', fels: '#2A2622', leere: '#0B0E1A',
    deckung_halb: '#7A6340', deckung_voll: '#5C4A30', pfeiler: '#2E3440', truemmer: '#6A5C4A', schutt: '#4A4036',
    tuer: '#B5843A', schott: '#8A9AB0', tor: '#9A6A30', luke: '#7A8A6A', wand_schwach: '#3A3530' };
  function buehneKachelFarbe(map, st, tx, ty) {
    const info = map.info(tx, ty);
    if (info.kind === 'abgrund') return null;
    if (info.solid === 'zustand') {
      const z = kachelZustand(map, st, tx, ty);
      if ((info.begehbarIn || []).indexOf(z) >= 0) return z === 'gesprengt' ? '#4A3A30' : BUEHNE_FARBE.boden2;
      return z === 'verschlossen' ? '#B5443A' : BUEHNE_FARBE[info.kind] || '#8A6A3A';
    }
    return BUEHNE_FARBE[info.kind] || '#3B4658';
  }
  const ANKER_FARBE = { terminal: '#7FE0C2', sprengpunkt: '#FF6A4C', zelle: '#C9974A', beute: '#D9A441', ziel: '#FFC66B', fund: '#E8D27A',
    raetsel: '#B57CFF', abholpunkt: '#7FE0C2', versteck: '#9AA6B8', tor: '#C9974A', lift: '#A9D6E5', leiter: '#A9D6E5' };
  const ANKER_NAME = { terminal: 'Terminal', sprengpunkt: 'Sprengpunkt', zelle: 'Zelle', beute: 'Kiste', ziel: 'Ziel', fund: 'Fund',
    raetsel: 'Schloss', abholpunkt: 'Abholpunkt', versteck: 'Versteck', tor: 'Tor', lift: 'Lift', leiter: 'Leiter', eingang: 'Eingang' };
  const ANKER_ZUSTAND_NAME = { bereit: 'bereit', laedt: 'lädt', geladen: 'geladen', gesperrt: 'gesperrt', intakt: 'intakt', scharf: 'SCHARF',
    zerstoert: 'zerstört', zu: 'zu', offen: 'offen', voll: 'voll', leer: 'leer', frei: 'frei', genommen: 'genommen', aktiviert: 'aktiviert',
    da: 'da', ruhe: 'Ruhe', gehalten: 'gehalten', geloest: 'gelöst', verschlossen: 'verschlossen', gestoert: 'gestört', gesprengt: 'gesprengt' };
  // Anker als einfache Marken (2D-Rückfall und Minikarte). Nur Rollen mit Objekt.
  function drawBuehneAnker(ctx, map, st, camX, camY, t) {
    const cd = st && st.away && st.away.map === map.id ? st.away.cd : null;
    (map.anker || []).forEach((a, i) => {
      const col = ANKER_FARBE[a[1]];
      if (!col || a[1] === 'tor') return;
      const px = a[2] * TILE - camX, py = a[3] * TILE - camY;
      if (px < -TILE || py < -TILE || px > VW + TILE || py > VH + TILE) return;
      const z = ankerZustand(map, st, i);
      const aus = ['leer', 'genommen', 'zerstoert', 'offen', 'geloest', 'gesperrt'].indexOf(z) >= 0 && a[1] !== 'abholpunkt';
      ctx.save();
      ctx.globalAlpha = aus ? 0.45 : 1;
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      if (a[1] === 'abholpunkt') { ctx.beginPath(); ctx.arc(px + 16, py + 16, 11, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.fillStyle = 'rgba(11,14,26,0.7)'; ctx.fillRect(px + 7, py + 7, 18, 18); ctx.strokeRect(px + 7.5, py + 7.5, 17, 17); }
      ctx.restore();
      if (a[1] === 'sprengpunkt' && z === 'scharf') {
        const on = Math.floor(t * 4) % 2 === 0;
        ctx.fillStyle = on ? '#FF6A4C' : '#7A2A20'; ctx.fillRect(px + 12, py + 12, 8, 8);
        if (cd && cd.i === i) text(ctx, Math.ceil(+cd.t || 0) + ' s', px + 16, py - 4, { color: '#FF6A4C', align: 'center' });
      }
      if (a[1] === 'terminal' && z === 'laedt') { ctx.fillStyle = '#7FE0C2'; ctx.fillRect(px + 12, py + 12, 8, 8); }
    });
  }

  // Koordinaten aus dem Snapshot, die Kachel ODER Pixel sein können (salvage/hollow) -> Kachel
  function toTileXY(map, x, y) {
    if (x == null || y == null) return null;
    if (x <= map.w && y <= map.h && Math.floor(x) === x && Math.floor(y) === y) return { x, y };
    return { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
  }

  // ------------------------------------------------------------------ Art-Fähigkeiten prüfen (M1)
  // Unbekannte kinds malt art.js als Magenta-Platzhalter (wirft nicht). Damit neue M1-Objekte schon vor
  // der Art-Lieferung lesbar sind, wird jede neue Art einmal auf eine Probe-Leinwand gezeichnet: Taucht der
  // Platzhalter (#FF00FF) auf, zeichnet der Client seinen Fallback. Kommt die echte Art, schaltet es selbst um.
  const probeCache = {};
  function probe(key, draw) {
    if (key in probeCache) return probeCache[key];
    let ok = false;
    try {
      if (!window.Art) { probeCache[key] = false; return false; }
      const c = document.createElement('canvas'); c.width = 96; c.height = 96;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      draw(g);
      const d = g.getImageData(0, 0, 96, 96).data;
      let any = false, mag = false;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 0) any = true;
        if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 255 && d[i + 3] === 255) { mag = true; break; }
      }
      ok = any && !mag;
    } catch (e) { report('Render.probe:' + key, e); ok = false; }
    probeCache[key] = ok;
    return ok;
  }
  function sameImage(drawA, drawB) {
    const mk = (fn) => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); fn(g); return g.getImageData(0, 0, 64, 64).data; };
    const a = mk(drawA), b = mk(drawB);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  // Art-Aufruf nur, wenn Art diese Art wirklich kennt (sonst false -> Fallback)
  function artK(name, kind, args, probeDraw) {
    const key = name + ':' + kind;
    if (!artOk(name, key)) return false;
    if (probeDraw && !probe(key, probeDraw)) return false;
    return art(name, key, args);
  }
  const PROBE_OPTS = { time: 0, state: 'ok', alert: 'normal' };
  function artObject(ctx, kind, px, py, opts) {
    return artK('drawObject', kind, [ctx, kind, px, py, opts], (g) => window.Art.drawObject(g, kind, 32, 40, Object.assign({}, PROBE_OPTS, opts, { time: 0 })));
  }
  function artEnemy(ctx, kind, x, y, angle, opts) {
    return artK('drawEnemy', kind, [ctx, kind, x, y, angle, opts], (g) => window.Art.drawEnemy(g, kind, 48, 48, 0, { hpFrac: 1, hitT: 99, time: 0 }));
  }
  function artStation(ctx, kind, x, y, opts) {
    return artK('drawStation', kind, [ctx, kind, x, y, opts], (g) => { g.translate(48, 48); g.scale(0.3, 0.3); window.Art.drawStation(g, kind, 0, 0, { time: 0 }); });
  }
  function artItem(ctx, kind, x, y, opts) {
    return artK('drawItem', kind, [ctx, kind, x, y, opts || {}], (g) => window.Art.drawItem(g, kind, 48, 48, { time: 0 }));
  }
  function artIcon(ctx, name, x, y, opts) {
    return artK('drawIcon', name, [ctx, name, x, y, opts || {}], (g) => window.Art.drawIcon(g, name, 48, 48, opts || {}));
  }
  function artBeam(ctx, x1, y1, x2, y2, kind, ttl, opts) {
    return artK('drawBeam', kind, [ctx, x1, y1, x2, y2, kind, ttl, opts || {}],(g) => window.Art.drawBeam(g, 10, 48, 86, 48, kind, 0.2));
  }
  let roomStyleSupport = null, roomLightSupport = null;
  function artHasRoomStyle() {
    if (roomStyleSupport != null) return roomStyleSupport;
    if (!artOk('drawTile')) return (roomStyleSupport = false);
    try {
      const env = { map: Maps.ship, tx: 15, ty: 2, time: 0, alert: 'normal', doorOpen: false };
      roomStyleSupport = !sameImage((g) => window.Art.drawTile(g, ',', 0, 0, env),
        (g) => window.Art.drawTile(g, ',', 0, 0, Object.assign({}, env, { roomStyle: { floor: 'teppich_blau', wall: 'tapete_gruen' } })));
    } catch (e) { report('Render.probe:roomStyle', e); roomStyleSupport = false; }
    return roomStyleSupport;
  }
  function artHasRoomLight() {
    if (roomLightSupport != null) return roomLightSupport;
    if (!artOk('drawOverlay')) return (roomLightSupport = false);
    try {
      roomLightSupport = !sameImage((g) => window.Art.drawOverlay(g, 64, 64, { alert: 'normal', time: 0, dim: 0 }),
        (g) => window.Art.drawOverlay(g, 64, 64, { alert: 'normal', time: 0, dim: 0, rooms: [{ x0: 0, y0: 0, x1: 64, y1: 64, light: 'aus' }] }));
    } catch (e) { report('Render.probe:roomLight', e); roomLightSupport = false; }
    return roomLightSupport;
  }

  // ------------------------------------------------------------------ Quartiere (M1 §7)
  const ROOM_FLOOR_COL = { holz_hell: '#B07A50', holz_dunkel: '#6A4430', teppich_rot: '#8C3A34', teppich_blau: '#34507A', fliesen: '#A9B4BC' };
  const ROOM_WALL_COL = { holz: '#6A4A32', paneel: '#4F6178', tapete_gruen: '#4E6B48', tapete_creme: '#BFAE8A' };
  const ROOM_LIGHT_COL = { warm: 'rgba(255,198,107,0.10)', mint: 'rgba(127,224,194,0.13)', bernstein: 'rgba(255,160,50,0.17)', aus: 'rgba(5,7,14,0.5)' };
  // Raum zu einer Schiffskachel: Innenfläche oder die sichtbare Rückwand darüber
  function roomAt(tx, ty) {
    for (const b of Maps.BEDS || []) {
      const r = b.room;
      if (!r || tx < r.x0 || tx > r.x1) continue;
      if (ty >= r.y0 && ty <= r.y1) return { room: r, bed: b, wall: false };
      if (ty === r.y0 - 1) return { room: r, bed: b, wall: true };
    }
    return null;
  }
  function roomStyleOf(st, roomId) {
    const q = (st && st.quarters && st.quarters[roomId]) || {};
    return { floor: q.floor || 'holz_hell', wall: q.wall || 'holz', light: q.light || 'warm' };
  }
  function fbRoomTint(ctx, ch, px, py, style, wall) {
    if (wall) {
      if (ch !== '#') return;
      ctx.fillStyle = ROOM_WALL_COL[style.wall] || ROOM_WALL_COL.holz;
      ctx.globalAlpha = 0.75; ctx.fillRect(px, py + 4, TILE, TILE - 7); ctx.globalAlpha = 1;
      if (style.wall === 'paneel') { ctx.fillStyle = 'rgba(142,163,181,0.5)'; for (let i = 0; i < 4; i++) ctx.fillRect(px + i * 8 + 3, py + 6, 1, TILE - 11); }
      else if (style.wall === 'holz') { ctx.fillStyle = 'rgba(40,24,14,0.5)'; for (let i = 0; i < 3; i++) ctx.fillRect(px, py + 10 + i * 6, TILE, 1); }
      else { ctx.fillStyle = 'rgba(255,255,255,0.18)'; for (let i = 0; i < 4; i++) ctx.fillRect(px + i * 8 + 2, py + 10 + (i % 2) * 6, 2, 2); }
      return;
    }
    ctx.fillStyle = ROOM_FLOOR_COL[style.floor] || ROOM_FLOOR_COL.holz_hell;
    ctx.globalAlpha = 0.8; ctx.fillRect(px, py, TILE, TILE); ctx.globalAlpha = 1;
    if (style.floor === 'fliesen') { ctx.fillStyle = 'rgba(46,58,74,0.35)'; ctx.fillRect(px, py + 15, TILE, 1); ctx.fillRect(px + 15, py, 1, TILE); }
    else if (style.floor.indexOf('teppich') === 0) { ctx.fillStyle = 'rgba(255,241,184,0.12)'; for (let i = 0; i < TILE; i += 4) ctx.fillRect(px + i, py + ((i / 4) % 2) * 2 + 2, 1, 1); }
    else { ctx.fillStyle = 'rgba(40,24,14,0.35)'; for (let i = 0; i < 4; i++) ctx.fillRect(px, py + i * 8 + 7, TILE, 1); }
  }

  const floorCache = {};
  function floorFor(map, tx, ty) {
    const k = map.id + ':' + tx + ':' + ty;
    if (floorCache[k]) return floorCache[k];
    const counts = {};
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [1, 1], [-1, 1]]) {
      let ch = map.at(tx + dx, ty + dy);
      if (ch === 'N' || ch === 'Q' || ch === 'd') ch = '.';
      if (ch === '.' || ch === ',' || ch === '=' || ch === '_') counts[ch] = (counts[ch] || 0) + 1;
    }
    let best = '.', n = 0;
    for (const ch in counts) if (counts[ch] > n) { n = counts[ch]; best = ch; }
    return (floorCache[k] = best);
  }

  // M0: Regal-Füllstand (gemeinsame Regel aus shared/maps.js; Fallback, falls die Datei fehlt)
  const SHELF_CAP = (window.Shared_Config && Shared_Config.shelfCapacity) || { ersatzteil: 6, loeschgel: 4, flickblech: 4, bolzen: 12, medipack: 4 };
  const SHELF_LABEL = { ersatzteil: 'Ersatzteile', loeschgel: 'Löschgel', flickblech: 'Flickbleche', bolzen: 'Bolzen', medipack: 'Medipacks' };
  function shelfStock(inv, item) {
    if (Maps && Maps.shelfStock) return Maps.shelfStock(inv, item);
    if (!inv) return 0;
    return item === 'loeschgel' ? (inv.loeschgel || 0) + ((inv.loeschgelCharges || 0) > 0 ? 1 : 0) : (inv[item] || 0);
  }
  function shelfFill(inv, item) { return Math.max(0, Math.min(1, shelfStock(inv, item) / (SHELF_CAP[item] || 1))); }
  // leere Regale (Gegenstände) für Minimap und Captain
  function emptyShelves(inv) {
    const out = [];
    for (const s of shelfTiles()) if (shelfStock(inv, s.item) <= 0) out.push(s.item);
    return out;
  }

  function bedAt(tx, ty) { return (Maps.BEDS || []).find(b => b.x === tx && b.y === ty); }

  function sysState(st, sys) { return (st && st.ship && st.ship.systems && st.ship.systems[sys]) || 'ok'; }

  // ------------------------------------------------------------------ M3a: Stationen, Zustände, Seitenmarken
  // Zustand dreifach codiert (Farbe, Muster, Kürzel): OK / BESCH (gelb, Schraffur) / AUS (rot, X) / FLICK (orange, Klebeband) / EMP (violett, Punkte)
  const SIDE_SHORT = { bow: 'BUG', stbd: 'STB', aft: 'HECK', port: 'BB', mid: 'MITTE' };
  const STATE_SHORT = { ok: 'OK', damaged: 'BESCH', broken: 'AUS', offline: 'EMP' };
  const FRAGILE_COL = '#F08A3C', OFFLINE_COL = '#9A7AE0', BURST_COL = '#E8F8FF';
  function fragileOf(st, sys) {
    const f = st && st.ship && st.ship.fragile;
    if (!f) return false;
    return Array.isArray(f) ? f.indexOf(sys) >= 0 : !!f[sys];
  }
  function stateCode(state, fragile) { return fragile && state !== 'broken' ? 'FLICK' : (STATE_SHORT[state] || String(state || 'ok').toUpperCase()); }
  function stateColor(state, fragile) {
    if (fragile && state !== 'broken') return FRAGILE_COL;
    return state === 'broken' ? PAL.red : state === 'damaged' ? PAL.warn : state === 'offline' ? OFFLINE_COL : PAL.moss;
  }
  function hatch(ctx, x, y, w, h, color, gap) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -h; i < w; i += (gap || 4)) { ctx.moveTo(x + i + 0.5, y + h); ctx.lineTo(x + i + h + 0.5, y); }
    ctx.stroke();
    ctx.restore();
  }
  function crossX(ctx, x, y, w, h, color, lw) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lw || 1;
    ctx.beginPath(); ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + w - 1, y + h - 1); ctx.moveTo(x + w - 1, y + 1); ctx.lineTo(x + 1, y + h - 1); ctx.stroke();
    ctx.restore();
  }
  // Klebeband-Streifen (geflickt)
  function tape(ctx, x, y, w, h) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = 'rgba(240,138,60,0.55)';
    ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x + 3, y); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w, y + h - 3); ctx.lineTo(x + w - 3, y + h); ctx.lineTo(x + w - 8, y + h); ctx.lineTo(x + w, y + h - 8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Zustands-Plakette (Breite w, Höhe h). opts.compact: nur Muster + Kürzel ohne Rahmen-Schatten
  function stateBadge(ctx, x, y, w, h, state, fragile, opts) {
    opts = opts || {};
    state = state || 'ok';
    x = Math.round(x); y = Math.round(y);
    const col = stateColor(state, fragile);
    ctx.fillStyle = state === 'broken' ? '#3A1514' : state === 'damaged' ? '#3A3214' : state === 'offline' ? '#2A2240' : fragile ? '#3A2414' : '#14261C';
    ctx.fillRect(x, y, w, h);
    if (state === 'damaged') hatch(ctx, x, y, w, h, 'rgba(242,201,76,0.38)', 4);
    else if (state === 'broken') crossX(ctx, x, y, w, h, 'rgba(224,71,60,0.75)', 1);
    else if (state === 'offline') { ctx.fillStyle = 'rgba(154,122,224,0.5)'; for (let i = 2; i < w; i += 4) ctx.fillRect(x + i, y + (i % 8 < 4 ? 2 : h - 3), 1, 1); }
    if (fragile && state !== 'broken') tape(ctx, x, y, w, h);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const code = opts.code || stateCode(state, fragile);
    text(ctx, code, x + w / 2, y + Math.floor(h / 2) - 4, { color: state === 'ok' && !fragile ? PAL.moss : col === PAL.moss ? PAL.moss : col, align: 'center' });
  }
  // Zustandsmarke über der Station, zentriert über (cx, y). Nachrunde M4 (Kai): kein Seitenkürzel (BUG/STB/HECK/BB/MITTE) mehr –
  // nur noch der Zustand. side bleibt in der Signatur, wird aber nicht mehr gezeichnet.
  function stationPlate(ctx, cx, y, side, state, fragile) {
    void side;
    const bw = 34, x = Math.round(cx - bw / 2);
    ctx.fillStyle = 'rgba(11,14,26,0.6)'; ctx.fillRect(x - 1, y - 1, bw + 2, 12);
    stateBadge(ctx, x, y, bw, 10, state, fragile);
  }
  // Alle Stationen der Schiffskarte aus der Legende: [{ system, x, y, sector, side, kind, ch }]
  let stationCache = null;
  function shipStations() {
    if (stationCache) return stationCache;
    const out = [];
    const m = Maps && Maps.ship;
    if (m && m.legend) {
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const ch = m.at(x, y), info = m.legend[ch];
        if (info && info.system) out.push({ system: info.system, x, y, sector: info.sector != null ? info.sector : -1, side: info.side || 'mid', kind: info.kind, ch });
      }
    }
    return (stationCache = out);
  }
  function stationOfSystem(sys) { return shipStations().find(s => s.system === sys) || null; }

  // ------------------------------------------------------------------ Fallback-Zeichnungen
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }

  function fbStarfield(ctx, camX, camY, w, h, t) {
    ctx.fillStyle = PAL.space; ctx.fillRect(0, 0, w, h);
    const layers = [[0.15, 60, '#3A3F6A'], [0.35, 40, '#8EA3B5'], [0.6, 18, PAL.star]];
    for (let li = 0; li < layers.length; li++) {
      const [par, count, col] = layers[li];
      ctx.fillStyle = col;
      const cell = 160;
      const ox = camX * par, oy = camY * par;
      const cx0 = Math.floor(ox / cell), cy0 = Math.floor(oy / cell);
      for (let cy = cy0; cy <= cy0 + Math.ceil(h / cell) + 1; cy++) {
        for (let cx = cx0; cx <= cx0 + Math.ceil(w / cell) + 1; cx++) {
          const seed = (cx * 73856093) ^ (cy * 19349663) ^ (li * 83492791);
          const n = Math.floor(count / 10);
          for (let i = 0; i < n; i++) {
            const sx = Math.floor(cx * cell + hash(seed + i * 3) * cell - ox);
            const sy = Math.floor(cy * cell + hash(seed + i * 3 + 1) * cell - oy);
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            ctx.fillRect(sx, sy, 1, 1);
          }
        }
      }
    }
  }

  function fbTile(ctx, ch, px, py, env) {
    switch (ch) {
      case 'V': case '#': ctx.fillStyle = PAL.hull; ctx.fillRect(px, py, TILE, TILE); ctx.fillStyle = '#3A4A5E'; ctx.fillRect(px, py, TILE, 4); ctx.fillStyle = '#1E2733'; ctx.fillRect(px, py + TILE - 3, TILE, 3); break;
      case ',': ctx.fillStyle = PAL.wood; ctx.fillRect(px, py, TILE, TILE); ctx.fillStyle = '#7A4E33'; for (let i = 0; i < 4; i++) ctx.fillRect(px, py + i * 8 + 7, TILE, 1); break;
      case '=': case '_': ctx.fillStyle = '#33404F'; ctx.fillRect(px, py, TILE, TILE); ctx.fillStyle = '#26303C'; for (let i = 0; i < 8; i++) ctx.fillRect(px + i * 4, py, 1, TILE); break;
      case 'D': ctx.fillStyle = '#3B4A5E'; ctx.fillRect(px, py, TILE, TILE); ctx.fillStyle = PAL.panelLight; ctx.fillRect(px + 2, py + 14, TILE - 4, 4); break;
      case 'P': ctx.fillStyle = '#3B4A5E'; ctx.fillRect(px, py, TILE, TILE); ctx.strokeStyle = PAL.mint; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px + 16, py + 16, 11, 0, Math.PI * 2); ctx.stroke(); break;
      default: ctx.fillStyle = '#3B4A5E'; ctx.fillRect(px, py, TILE, TILE); ctx.fillStyle = '#34425A'; ctx.fillRect(px, py, TILE, 1); ctx.fillRect(px, py, 1, TILE);
    }
  }

  // M1-Objekte ohne Art (eigene, lesbare Ersatzzeichnungen)
  function fbObjectM1(ctx, kind, px, py, opts) {
    const t = opts.time || 0;
    switch (kind) {
      case 'reactor_switch': {
        const st = opts.reactorState || 'online';
        ctx.fillStyle = '#3A2E22'; ctx.fillRect(px + 6, py - 8, 20, 34);
        ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(px + 6.5, py - 7.5, 19, 33);
        const lamp = st === 'offline' ? (Math.floor(t * 3) % 2 ? PAL.red : '#5A1E1A') : st === 'overload' ? PAL.amber : PAL.moss;
        ctx.fillStyle = lamp; ctx.fillRect(px + 13, py - 5, 6, 4);
        ctx.fillStyle = '#151B2B'; ctx.fillRect(px + 12, py + 2, 8, 18);
        ctx.fillStyle = opts.held ? PAL.mint : PAL.panelLight; ctx.fillRect(px + 10, opts.held ? py + 14 : py + 3, 12, 5);
        return true;
      }
      case 'plan_table': {
        // 2×2: qx/qy = Lage der Kachel im Tisch
        const qx = opts.qx || 0, qy = opts.qy || 0;
        ctx.fillStyle = '#5A3A26'; ctx.fillRect(px + (qx ? 0 : 3), py + (qy ? 0 : 2), TILE - 3, TILE - 2);
        ctx.fillStyle = opts.active ? 'rgba(127,224,194,0.55)' : 'rgba(127,224,194,0.28)';
        ctx.fillRect(px + (qx ? 0 : 7), py + (qy ? 0 : 6), TILE - 7, TILE - 6);
        ctx.fillStyle = PAL.brass;
        if (!qy) ctx.fillRect(px + (qx ? 0 : 3), py + 2, TILE - 3, 2);
        if (!qx) ctx.fillRect(px + 3, py + 2, 2, TILE - 2);
        if (qx && !qy) { ctx.fillStyle = PAL.amber; ctx.fillRect(px + 8, py + 14, 3, 3); }
        if (!qx && qy) { ctx.fillStyle = PAL.mint; ctx.fillRect(px + 18, py + 8, 2, 2); ctx.fillRect(px + 22, py + 12, 2, 2); }
        return true;
      }
      case 'terminal_spare': {
        // Brückenumbau: freies Terminal, ausgeschaltet (dunkler Bildschirm, rotes Standby-Lämpchen)
        ctx.fillStyle = 'rgba(11,14,26,0.5)'; ctx.fillRect(px + 3, py + 24, 26, 6);
        ctx.fillStyle = '#3A4250'; ctx.fillRect(px + 5, py + 8, 22, 18);
        ctx.fillStyle = '#26313F'; ctx.fillRect(px + 6, py - 6, 20, 16);
        ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(px + 6.5, py - 5.5, 19, 15);
        ctx.fillStyle = '#0B0E14'; ctx.fillRect(px + 9, py - 3, 14, 10);
        ctx.fillStyle = 'rgba(142,163,181,0.18)'; ctx.fillRect(px + 10, py - 2, 4, 1);
        ctx.fillStyle = Math.floor(t * 0.8) % 2 ? '#7A2420' : '#3A1410'; ctx.fillRect(px + 22, py + 12, 2, 2);
        return true;
      }
      case 'salvage':
        ctx.fillStyle = 'rgba(11,14,26,0.5)'; ctx.fillRect(px + 3, py + 24, 26, 6);
        ctx.fillStyle = opts.done ? '#4A4F57' : PAL.rust; ctx.fillRect(px + 4, py + 4, 24, 22);
        ctx.fillStyle = opts.done ? '#3A3F47' : '#8A4A2A'; ctx.fillRect(px + 4, py + 12, 24, 3);
        if (!opts.done) { ctx.fillStyle = PAL.mint; ctx.fillRect(px + 14, py + 6, 4, 4); }
        else text(ctx, 'leer', px + 16, py + 16, { color: PAL.panelLight, align: 'center' });
        return true;
      case 'lore_terminal':
        ctx.fillStyle = '#26313F'; ctx.fillRect(px + 5, py - 4, 22, 30);
        ctx.fillStyle = opts.read ? 'rgba(127,224,194,0.25)' : (Math.floor(t * 2) % 2 ? PAL.mint : 'rgba(127,224,194,0.5)');
        ctx.fillRect(px + 8, py, 16, 10);
        return true;
      case 'wall_weak':
        ctx.fillStyle = '#3B3A44'; ctx.fillRect(px, py - 6, TILE, TILE + 6);
        ctx.fillStyle = '#2A2830'; for (let i = 0; i < 4; i++) ctx.fillRect(px + 3 + i * 7, py + (i % 2) * 8, 2, 14);
        if (opts.marked) {
          ctx.strokeStyle = 'rgba(255,198,107,' + (0.6 + 0.4 * Math.sin(t * 4)) + ')'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]);
          ctx.strokeRect(px + 2, py - 4, TILE - 4, TILE + 2); ctx.setLineDash([]);
          text(ctx, 'HOHLRAUM', px + 16, py - 14, { color: PAL.amber, align: 'center' });
        }
        return true;
      case 'debris':
        ctx.fillStyle = '#4A4550'; ctx.beginPath(); ctx.moveTo(px + 3, py + 28); ctx.lineTo(px + 12, py + 6); ctx.lineTo(px + 22, py + 12); ctx.lineTo(px + 30, py + 28); ctx.closePath(); ctx.fill();
        ctx.fillStyle = PAL.rust; ctx.fillRect(px + 12, py + 14, 8, 3);
        return true;
    }
    if (kind.indexOf('deco_') === 0) {
      const d = kind.slice(5);
      const cols = { buecherregal: PAL.wood, aquarium: PAL.ice, sessel: PAL.terra, sternkarte: PAL.indigo, trophaee_boje: PAL.brass, kristalllampe: PAL.mint, lamassu_figur: '#B57CFF' };
      if (!cols[d]) return false;
      ctx.fillStyle = 'rgba(11,14,26,0.4)'; ctx.fillRect(px + 6, py + 24, 20, 5);
      ctx.fillStyle = cols[d];
      if (d === 'buecherregal') { ctx.fillRect(px + 6, py - 10, 20, 36); ctx.fillStyle = PAL.terra; for (let i = 0; i < 3; i++) ctx.fillRect(px + 8, py - 6 + i * 11, 16, 6); }
      else if (d === 'aquarium') { ctx.fillRect(px + 4, py + 4, 24, 18); ctx.fillStyle = PAL.amber; ctx.fillRect(px + 10 + Math.round(Math.sin(t) * 5), py + 11, 4, 3); ctx.fillStyle = PAL.wood; ctx.fillRect(px + 4, py + 22, 24, 4); }
      else if (d === 'sessel') { ctx.fillRect(px + 6, py + 6, 20, 20); ctx.fillStyle = '#8A3F2E'; ctx.fillRect(px + 6, py + 2, 20, 8); }
      else if (d === 'sternkarte') { ctx.fillRect(px + 5, py - 8, 22, 18); ctx.fillStyle = PAL.star; ctx.fillRect(px + 9, py - 4, 1, 1); ctx.fillRect(px + 18, py, 1, 1); ctx.fillRect(px + 13, py + 4, 1, 1); ctx.strokeStyle = PAL.brass; ctx.strokeRect(px + 5.5, py - 7.5, 21, 17); }
      else if (d === 'trophaee_boje') { ctx.fillRect(px + 12, py + 14, 8, 12); ctx.beginPath(); ctx.arc(px + 16, py + 9, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = PAL.mint; ctx.fillRect(px + 15, py + 7, 2, 2); }
      else if (d === 'lamassu_figur') { ctx.fillStyle = '#4A3F5E'; ctx.fillRect(px + 8, py + 12, 16, 14); ctx.fillStyle = '#B57CFF'; ctx.fillRect(px + 20, py + 6, 6, 8); ctx.fillRect(px + 6, py + 4, 10, 4); ctx.fillStyle = PAL.brass; ctx.fillRect(px + 20, py + 4, 6, 2); }
      else if (d === 'kristalllampe') { ctx.fillStyle = PAL.wood; ctx.fillRect(px + 13, py + 18, 6, 8); ctx.fillStyle = 'rgba(127,224,194,' + (0.6 + 0.3 * Math.sin(t * 2)) + ')'; ctx.beginPath(); ctx.moveTo(px + 16, py); ctx.lineTo(px + 22, py + 10); ctx.lineTo(px + 16, py + 18); ctx.lineTo(px + 10, py + 10); ctx.closePath(); ctx.fill(); }
      return true;
    }
    return false;
  }

  function fbObject(ctx, kind, px, py, opts) {
    if (fbObjectM1(ctx, kind, px, py, opts || {})) return;
    const st = opts.state || 'ok';
    let col = PAL.panel, label = '';
    if (kind.indexOf('console_') === 0 || kind === 'terminal_shop') { col = PAL.panel; label = kind === 'terminal_shop' ? '$' : kind.charAt(8).toUpperCase(); }
    else if (kind.indexOf('sys_') === 0) {
      col = st === 'broken' ? PAL.red : st === 'damaged' ? PAL.warn : st === 'offline' ? OFFLINE_COL : opts.fragile ? FRAGILE_COL : PAL.moss;
      label = { sys_thruster: 'D', sys_battery: 'B', sys_emitter: 'E', sys_weapon_bow: 'W' }[kind] || kind.charAt(4).toUpperCase();
    }
    else if (kind === 'shelf') { col = PAL.wood; }
    else if (kind === 'bed') { col = PAL.players[opts.color || 0] || PAL.panel; }
    else if (kind === 'table') col = PAL.brass;
    else if (kind === 'plant' || kind === 'deco_pflanze') col = PAL.moss;
    else if (kind === 'crate') col = PAL.rust;
    else if (kind === 'pipes') { col = PAL.terra; label = 'U'; }
    else if (kind === 'workbench') { col = PAL.wood; label = 'W'; }
    else if (kind === 'control_desk') { col = PAL.panel; label = 'K'; }
    else if (kind === 'barrel') col = PAL.rust;
    else if (kind === 'buoy_core') col = PAL.indigo;
    else if (kind === 'sonde') { col = opts.disabled ? PAL.grey : PAL.amber; label = 'Z'; }
    else if (kind === 'door_locked') { col = opts.open ? PAL.moss : PAL.red; }
    else if (kind.indexOf('deco_') === 0) { col = PAL.terra; label = kind.charAt(5).toUpperCase(); }
    ctx.fillStyle = 'rgba(11,14,26,0.5)'; ctx.fillRect(px + 3, py + 24, 26, 6);
    ctx.fillStyle = col; ctx.fillRect(px + 3, py - 6, 26, 32);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(px + 3, py - 6, 26, 4);
    if (kind.indexOf('console_') === 0 || kind === 'terminal_shop') {
      const blink = 0.6 + 0.4 * Math.sin((opts.time || 0) * 3 + px);
      ctx.fillStyle = opts.active ? PAL.mint : 'rgba(127,224,194,' + (0.4 + 0.3 * blink) + ')';
      ctx.fillRect(px + 7, py - 2, 18, 10);
    }
    if (kind === 'shelf' && opts.item) {
      const fill = opts.fill == null ? 1 : opts.fill;
      if (fill > 0) itemFallback(ctx, opts.item, px + 16, py + 8);
      // Füllbalken + Lämpchen (ohne Art lesbar)
      ctx.fillStyle = PAL.space; ctx.fillRect(px + 5, py + 20, 22, 4);
      ctx.fillStyle = fill >= 0.67 ? PAL.moss : fill >= 0.34 ? PAL.amber : fill > 0 ? PAL.warn : PAL.red;
      ctx.fillRect(px + 6, py + 21, Math.max(fill > 0 ? 2 : 0, Math.round(20 * fill)), 2);
      if (fill <= 0) text(ctx, 'LEER', px + 16, py - 4, { color: PAL.red, align: 'center' });
    }
    if (label) text(ctx, label, px + 16, py + 12, { color: PAL.space, align: 'center', shadow: false });
    if (kind.indexOf('sys_') === 0) {
      if (st === 'damaged') hatch(ctx, px + 3, py - 6, 26, 32, 'rgba(11,14,26,0.35)', 5);
      if (st === 'broken') crossX(ctx, px + 3, py - 6, 26, 32, PAL.space, 2);
      if (opts.fragile && st !== 'broken') tape(ctx, px + 3, py - 6, 26, 32);
    }
  }

  const ITEM_COL = { ersatzteil: PAL.panelLight, loeschgel: PAL.red, flickblech: PAL.ice, bolzen: PAL.brass, medipack: PAL.star, datenkern: PAL.mint };
  function itemFallback(ctx, kind, x, y) {
    ctx.fillStyle = ITEM_COL[kind] || '#FF00FF';
    ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.strokeStyle = PAL.space; ctx.strokeRect(x - 5.5, y - 5.5, 11, 11);
    text(ctx, (kind || '?').charAt(0).toUpperCase(), x, y - 3, { color: PAL.space, align: 'center', shadow: false });
  }

  function fbCharacter(ctx, x, y, o) {
    const col = PAL.players[o.color || 0] || PAL.star;
    ctx.fillStyle = 'rgba(11,14,26,0.45)'; ctx.fillRect(x - 8, y - 2, 16, 4);
    if (o.downed) {
      ctx.fillStyle = col; ctx.fillRect(x - 12, y - 8, 20, 8);
      ctx.fillStyle = PAL.skin[0]; ctx.fillRect(x + 8, y - 8, 6, 6);
      return;
    }
    const bob = o.moving ? Math.floor((o.time || 0) * 8) % 2 : 0;
    ctx.globalAlpha = o.beam != null ? Math.max(0.15, 1 - o.beam) : 1;
    ctx.fillStyle = '#2E3A4A'; ctx.fillRect(x - 5, y - 8, 4, 8); ctx.fillRect(x + 1, y - 8, 4, 8);
    ctx.fillStyle = col; ctx.fillRect(x - 7, y - 24 + bob, 14, 17);
    ctx.fillStyle = PAL.skin[(o.color || 0) % 3]; ctx.fillRect(x - 5, y - 34 + bob, 10, 10);
    ctx.fillStyle = PAL.space;
    if (o.dir === 'left') ctx.fillRect(x - 4, y - 31 + bob, 2, 2);
    else if (o.dir === 'right') ctx.fillRect(x + 2, y - 31 + bob, 2, 2);
    else if (o.dir !== 'up') { ctx.fillRect(x - 3, y - 31 + bob, 2, 2); ctx.fillRect(x + 1, y - 31 + bob, 2, 2); }
    if (o.carry) itemFallback(ctx, o.carry, x, y - 40);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ Transiente Effekte
  const fx = [];   // { kind, zone, x, y, t0, dur, space? }
  function addFx(kind, zone, x, y, dur, extra) { fx.push(Object.assign({ kind, zone, x, y, t0: performance.now() / 1000, dur: dur || 1 }, extra || {})); if (fx.length > 80) fx.shift(); }
  function liveFx(now) { for (let i = fx.length - 1; i >= 0; i--) if (now - fx[i].t0 > fx[i].dur) fx.splice(i, 1); return fx; }

  function drawFx(ctx, kind, x, y, t, opts) {
    if (FX_M2[kind]) {
      // M2: neue Effekte nur über art.js, wenn es sie wirklich kennt (sonst Magenta-Platzhalter) – sonst eigener Fallback
      if (artK('drawFx', kind, [ctx, kind, x, y, t, opts || {}], (g) => window.Art.drawFx(g, kind, 48, 48, 0, Object.assign({ p: 0.5 }, opts || {})))) return;
      fbFxM2(ctx, kind, x, y, t, opts || {});
      return;
    }
    if (art('drawFx', 'drawFx:' + kind, [ctx, kind, x, y, t, opts || {}])) return;
    const f = Math.floor(t * 10);
    switch (kind) {
      case 'fire':
        for (let i = 0; i < 4; i++) {
          const h = 8 + hash(f * 7 + i) * 12;
          ctx.fillStyle = i % 2 ? PAL.amber : PAL.red;
          ctx.fillRect(x - 10 + i * 5, y + 6 - h, 5, h);
        }
        ctx.fillStyle = PAL.spark; ctx.fillRect(x - 2, y - 2, 4, 4);
        break;
      case 'breach':
        ctx.fillStyle = '#05070D'; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = PAL.ice; ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) { const a = t * 2 + i * 1.57; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16); ctx.lineTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10); ctx.stroke(); }
        break;
      case 'explosion': {
        const r = 6 + (opts && opts.p != null ? opts.p : (t % 1)) * 24;
        ctx.fillStyle = 'rgba(255,198,107,0.8)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(224,71,60,0.9)'; ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'strike': case 'heal': case 'repair': case 'beam': {
        const p = opts && opts.p != null ? opts.p : (t % 1);
        ctx.strokeStyle = kind === 'strike' ? PAL.amber : PAL.mint; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 6 + p * (kind === 'strike' ? 70 : 16), 0, Math.PI * 2); ctx.stroke();
        if (kind === 'beam') { ctx.fillStyle = 'rgba(127,224,194,0.5)'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 9 + i * 6, y - 40 + hash(f + i) * 10, 2, 36); }
        break;
      }
      default:
        ctx.fillStyle = kind === 'smoke' ? PAL.smoke : PAL.spark;
        ctx.fillRect(x - 2 + hash(f) * 6 - 3, y - 2 - hash(f + 1) * 8, 3, 3);
    }
  }

  // ------------------------------------------------------------------ M2 „Schildwall“: Mond Kesh + Kampf v2 (CONTRACT-M2 §2, §6, §9)
  const Los = window.Shared_Los || null;
  const SHIELD_COL = '#7FF3FF', AIM_COL = '#E0473C', KESH_VIOLET = '#B57CFF';
  const OBJ_KESH = { o: 'cover_low', I: 'pillar', r: 'jammer', k: 'archive_key', G: 'vault_gate', T: 'tablet_pedestal' };
  const ORDER_KINDS = ['sammeln', 'halten', 'flanke', 'rueckzug', 'fokus', 'gefahr'];
  const ORDER_NAMES = { sammeln: 'Sammeln', halten: 'Halten', flanke: 'Flanke', rueckzug: 'Rückzug', fokus: 'Fokus', gefahr: 'Gefahr' };
  const ORDER_COL = { sammeln: PAL.mint, halten: PAL.amber, flanke: PAL.ice, rueckzug: PAL.warn, fokus: PAL.red, gefahr: '#FF7A3D' };
  const ROLE_NAMES = { pin: 'Deckung', flank: 'Flanke', retreat: 'Rückzug', push: 'Vorstoß', advance: 'Vorrücken', idle: 'Wache' };
  const FX_M2 = { shield_hit: 1, shield_break: 1, cover_hit: 1, muzzle_aim: 1, warden_deflect: 1, revive: 1, order_pillar: 1 };
  const PROJ_M2 = { pistol: 1, enemy: 1, warden: 1 };

  function acfg() { return CFG.awayCombat || {}; }
  function cfgNum(path, d) {
    let o = acfg();
    for (const k of path.split('.')) { if (!o || typeof o !== 'object') return d; o = o[k]; }
    return typeof o === 'number' && isFinite(o) ? o : d;
  }
  // M3a: Wert aus CONFIG.spaceM3 (Pfad 'a.b'), sonst Vorgabe
  function cfgM3(path, d) {
    let o = CFG.spaceM3;
    for (const k of String(path).split('.')) { if (o == null) break; o = o[k]; }
    return typeof o === 'number' && isFinite(o) ? o : d;
  }
  function isV2(st) { const a = st && st.away; return !!(a && a.combat === 'v2'); }
  // W1 AP1: Kampf v2 sendet kein drones[].revealed mehr – der Server setzt es für alle Gegner aus time < away.sensorUntil
  function aufgedeckt(e, st) {
    if (e.revealed != null) return !!e.revealed;
    const a = st && st.away;
    return !!(a && a.sensorUntil && st.time < a.sensorUntil);
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : (+v || 0); }

  // Aktueller Kollisionszustand einer Außenkarte (Kesh: Tor offen = begehbar; low-Kacheln bleiben solid)
  function solidFn(map, st) {
    if (isBuehne(map)) return buehneSolid(map, st);   // B1: Türen/Tore/Schotts nach Zustand (ko/ao)
    if (!map || map.id !== 'kesh') return (tx, ty) => map.solid(tx, ty);
    const open = !!(st && st.away && st.away.vault && st.away.vault.open);
    return (tx, ty) => (open && map.at(tx, ty) === 'G') ? false : map.solid(tx, ty);
  }
  // Zustand der Kesh-Objekte an einer Kachel (Snapshot-Koordinaten dürfen Kachel oder Pixel sein)
  function keshObjState(st, map, tx, ty) {
    const a = (st && st.away) || {};
    const at = (list) => (list || []).find(q => { const t = toTileXY(map, q.x, q.y); return t && t.x === tx && t.y === ty; }) || null;
    return { gateOpen: !!(a.vault && a.vault.open), jammer: at(a.jammers), key: at(a.keys), tablet: a.tablet || null };
  }

  // --- Art-Fähigkeiten (M2) ---
  function hasMagenta(draw) {
    const c = document.createElement('canvas'); c.width = 96; c.height = 96;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    draw(g);
    const d = g.getImageData(0, 0, 96, 96).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 255 && d[i + 3] === 255) return true;
    return false;
  }
  let keshTileArt = null;
  // Kennt art.js die Kesh-Kacheln? (Alte Art zeichnet Fels 'R' wie Boden '.' – dann eigener Fallback.)
  function artHasKesh() {
    if (keshTileArt != null) return keshTileArt;
    if (!artOk('drawTile') || !Maps.kesh) return (keshTileArt = false);
    try {
      const env = { map: Maps.kesh, tx: 2, ty: 17, time: 0, alert: 'normal', doorOpen: false, biome: 'kesh', roomStyle: null };
      const dr = (ch) => (g) => window.Art.drawTile(g, ch, 0, 0, Object.assign({}, env));
      keshTileArt = !sameImage(dr('R'), dr('.')) && !hasMagenta(dr('R')) && !hasMagenta(dr('.'));
    } catch (e) { report('Render.probe:kesh', e); keshTileArt = false; }
    return keshTileArt;
  }
  let wardenArt = null;
  function artHasWarden() {
    if (wardenArt != null) return wardenArt;
    if (!artOk('drawDrone')) return (wardenArt = false);
    try {
      const dr = (kind) => (g) => window.Art.drawDrone(g, 32, 56, { time: 0, alive: true, kind, facing: 0, asleep: false });
      wardenArt = !sameImage(dr('warden'), dr(undefined)) && !hasMagenta(dr('warden'));
    } catch (e) { report('Render.probe:warden', e); wardenArt = false; }
    return wardenArt;
  }
  let shieldHitArt = null;
  function artHasShieldHit() {
    if (shieldHitArt != null) return shieldHitArt;
    if (!artOk('drawCharacter')) return (shieldHitArt = false);
    try {
      const base = { color: 0, dir: 'down', moving: false, time: 0, shieldSeg: 2, shieldMax: 3 };
      const dr = (o) => (g) => window.Art.drawCharacter(g, 32, 56, Object.assign({}, base, o));
      shieldHitArt = !sameImage(dr({ shieldHitT: 0.05 }), dr({ shieldHitT: 99 }));
    } catch (e) { report('Render.probe:shieldHit', e); shieldHitArt = false; }
    return shieldHitArt;
  }

  // M2 §15: Kennt art.js die Duck-Pose (opts.crouch)? Sonst staucht der Client die Figur auf 65 % Höhe.
  const crouchArt = { char: null, drone: null };
  function artHasCrouch(kind) {
    if (crouchArt[kind] != null) return crouchArt[kind];
    const fn = kind === 'char' ? 'drawCharacter' : 'drawDrone';
    if (!artOk(fn)) return (crouchArt[kind] = false);
    try {
      const base = kind === 'char' ? { color: 0, dir: 'down', moving: false, time: 0 } : { time: 0, alive: true, kind: 'scavenger', role: 'retreat' };
      const dr = (o) => (g) => window.Art[fn](g, 32, 56, Object.assign({}, base, o));
      crouchArt[kind] = !sameImage(dr({ crouch: true }), dr({ crouch: false })) && !hasMagenta(dr({ crouch: true }));
    } catch (e) { report('Render.probe:crouch:' + kind, e); crouchArt[kind] = false; }
    return crouchArt[kind];
  }
  // Fallback: Zeichnung um den Fußpunkt (x,y) senkrecht stauchen
  function squashed(ctx, x, y, k, draw) {
    ctx.save();
    try { ctx.translate(x, y); ctx.scale(1, k); ctx.translate(-x, -y); draw(); } finally { ctx.restore(); }
  }
  const CROUCH_FB = 0.65;

  // --- Kacheln (Fallback) ---
  function keshWall(ch) { return ch === 'R' || ch === '#' || ch === ' '; }
  function fbTileKesh(ctx, ch, px, py, map, tx, ty) {
    const h1 = hash(tx * 7919 + ty * 104729), h2 = hash(tx * 31 + ty * 977 + 5), h3 = hash(tx * 131 + ty * 17 + 9);
    if (ch === 'R' || ch === '#') {
      const rock = ch === 'R';
      const below = map.at(tx, ty + 1);
      const face = !keshWall(below);
      // Oberseite (Kappe) – Mauer heller als Fels, Höhe über die Front sichtbar
      ctx.fillStyle = rock ? '#2C272E' : '#4C4456'; ctx.fillRect(px, py, TILE, TILE);
      if (rock) {
        ctx.fillStyle = '#38323A'; ctx.fillRect(px + Math.floor(h1 * 20), py + Math.floor(h2 * 12), 9, 5);
        ctx.fillStyle = '#241F26'; ctx.fillRect(px + Math.floor(h3 * 24), py + 4 + Math.floor(h1 * 10), 6, 3);
      } else {
        ctx.fillStyle = '#5A5164'; ctx.fillRect(px, py, TILE, 2);
        ctx.fillStyle = '#3E3747'; ctx.fillRect(px, py + 7, TILE, 1); ctx.fillRect(px + (ty % 2 ? 8 : 22), py + 2, 1, 5);
      }
      if (face) {
        ctx.fillStyle = rock ? '#1E1A20' : '#332C3B'; ctx.fillRect(px, py + 14, TILE, 18);
        ctx.fillStyle = rock ? '#4A424A' : '#7A6E84'; ctx.fillRect(px, py + 13, TILE, 2);   // helle Oberkante der Front
        if (!rock) {
          ctx.fillStyle = '#2A2431'; ctx.fillRect(px, py + 22, TILE, 1);
          ctx.fillRect(px + (tx % 2 ? 6 : 18), py + 15, 1, 7); ctx.fillRect(px + (tx % 2 ? 20 : 4), py + 23, 1, 8);
          if ((tx + ty) % 3 === 0) { ctx.fillStyle = 'rgba(181,124,255,0.55)'; ctx.fillRect(px + 13, py + 17, 6, 2); ctx.fillRect(px + 15, py + 19, 2, 2); }
        } else { ctx.fillStyle = '#2A252C'; ctx.fillRect(px + Math.floor(h2 * 22), py + 20, 7, 4); }
      }
      return;
    }
    if (ch === '.' || ch === 'P') {
      ctx.fillStyle = '#6E6150'; ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = '#7C6E5A';
      for (let i = 0; i < 5; i++) ctx.fillRect(px + Math.floor(hash(tx * 13 + ty * 7 + i) * 30), py + Math.floor(hash(tx * 3 + ty * 11 + i * 5) * 30), 2, 1);
      ctx.fillStyle = '#5E5244';
      for (let i = 0; i < 3; i++) ctx.fillRect(px + Math.floor(hash(tx * 17 + ty * 5 + i * 9) * 29), py + Math.floor(hash(tx * 7 + ty * 19 + i) * 29), 3, 2);
      if (h1 > 0.86) { ctx.fillStyle = '#58493C'; ctx.beginPath(); ctx.ellipse(px + 16, py + 16, 7, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#857660'; ctx.fillRect(px + 11, py + 12, 8, 1); }
    } else {
      ctx.fillStyle = '#504A58'; ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = '#433D4B';
      ctx.fillRect(px, py + 15, TILE, 1); ctx.fillRect(px + (ty % 2 ? 0 : 15), py, 1, 15); ctx.fillRect(px + (ty % 2 ? 15 : 31), py + 16, 1, 16);
      ctx.fillStyle = '#5A5462'; ctx.fillRect(px + 1, py + 1, 13, 1); ctx.fillRect(px + 17, py + 17, 13, 1);
      if (h2 > 0.82) { ctx.fillStyle = 'rgba(181,124,255,0.28)'; ctx.fillRect(px + 6 + Math.floor(h3 * 14), py + 5 + Math.floor(h1 * 14), 5, 1); ctx.fillRect(px + 8 + Math.floor(h3 * 14), py + 4 + Math.floor(h1 * 14), 1, 3); }
      if (h3 > 0.9) { ctx.fillStyle = '#6E6150'; ctx.fillRect(px + Math.floor(h1 * 24), py + Math.floor(h2 * 26), 6, 3); }   // Sandverwehung
    }
    if (ch === 'P') { ctx.strokeStyle = PAL.mint; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px + 16, py + 16, 11, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
  }

  // --- Objekte (Fallback) ---
  function fbLowBlock(ctx, px, py, top, front, edge) {
    ctx.fillStyle = 'rgba(11,14,26,0.4)'; ctx.fillRect(px + 2, py + 27, 29, 5);
    ctx.fillStyle = front; ctx.fillRect(px + 1, py + 15, 30, 14);
    ctx.fillStyle = top; ctx.fillRect(px + 1, py + 8, 30, 8);
    ctx.fillStyle = edge; ctx.fillRect(px + 1, py + 8, 30, 1);
  }
  function fbObjectKesh(ctx, kind, px, py, o) {
    const t = o.time || 0;
    switch (kind) {
      case 'cover_low':   // niedrige Mauerreste: klar niedriger als Pfeiler/Mauer, helle Oberkante
        fbLowBlock(ctx, px, py, '#857C8E', '#564E60', '#EDE3CF');
        ctx.fillStyle = '#443D4E'; ctx.fillRect(px + 8, py + 18, 1, 7); ctx.fillRect(px + 21, py + 17, 1, 9); ctx.fillRect(px + 13, py + 11, 5, 1);
        if (o.left) { ctx.fillStyle = '#857C8E'; ctx.fillRect(px, py + 9, 2, 7); }
        return;
      case 'pillar':
        ctx.fillStyle = 'rgba(11,14,26,0.45)'; ctx.beginPath(); ctx.ellipse(px + 16, py + 28, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5E5468'; ctx.fillRect(px + 7, py - 24, 18, 52);
        ctx.fillStyle = '#80768C'; ctx.fillRect(px + 7, py - 24, 3, 52);
        ctx.fillStyle = '#463E50'; ctx.fillRect(px + 22, py - 24, 3, 52);
        ctx.fillStyle = '#7A7086'; ctx.fillRect(px + 4, py - 31, 24, 7); ctx.fillRect(px + 5, py + 24, 22, 6);
        ctx.fillStyle = '#EDE3CF'; ctx.fillRect(px + 4, py - 31, 24, 1);
        ctx.fillStyle = 'rgba(181,124,255,0.75)'; ctx.fillRect(px + 7, py - 8, 18, 2); ctx.fillRect(px + 14, py - 4, 4, 3);
        return;
      case 'jammer': {
        const on = !o.off;
        ctx.fillStyle = 'rgba(11,14,26,0.45)'; ctx.fillRect(px + 4, py + 26, 24, 5);
        ctx.fillStyle = on ? '#3E3644' : '#2E2B33'; ctx.fillRect(px + 6, py + 4, 20, 24);
        ctx.fillStyle = on ? '#5A4E62' : '#3A3640'; ctx.fillRect(px + 6, py + 4, 20, 3);
        ctx.fillStyle = PAL.rust; ctx.fillRect(px + 9, py + 12, 14, 3);
        ctx.fillStyle = '#6B7380'; ctx.fillRect(px + 15, py - 18, 2, 22); ctx.fillRect(px + 11, py - 12, 10, 1);
        const blink = Math.floor(t * 3) % 2 === 0;
        ctx.fillStyle = on ? (blink ? PAL.red : '#7A2420') : '#3A3F47'; ctx.fillRect(px + 13, py - 22, 6, 5);
        if (on) {
          for (let i = 0; i < 2; i++) {
            const p = (t * 0.9 + i * 0.5) % 1;
            ctx.strokeStyle = 'rgba(224,71,60,' + (0.6 * (1 - p)) + ')'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(px + 16, py - 20, 5 + p * 16, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
          }
        } else text(ctx, 'AUS', px + 16, py + 17, { color: PAL.panelLight, align: 'center', shadow: false });
        return;
      }
      case 'archive_key': {
        const p = clamp01(o.t);
        fbLowBlock(ctx, px, py, '#6E6480', '#463E54', '#EDE3CF');
        const glowA = o.open ? 0.9 : 0.35 + 0.6 * p;
        ctx.fillStyle = 'rgba(181,124,255,' + glowA + ')';
        ctx.beginPath(); ctx.moveTo(px + 16, py + 2); ctx.lineTo(px + 22, py + 9); ctx.lineTo(px + 16, py + 16); ctx.lineTo(px + 10, py + 9); ctx.closePath(); ctx.fill();
        ctx.fillStyle = PAL.star; ctx.fillRect(px + 15, py + 8, 2, 2);
        if (p > 0 && !o.open) { ctx.strokeStyle = KESH_VIOLET; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px + 16, py + 9, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke(); ctx.lineWidth = 1; }
        return;
      }
      case 'vault_gate':
        if (o.open) {
          ctx.fillStyle = 'rgba(11,14,26,0.55)'; ctx.fillRect(px, py + 12, 32, 6);
          ctx.fillStyle = '#3E3550'; ctx.fillRect(px + (o.right ? 26 : 0), py - 8, 6, 26);
          ctx.fillStyle = 'rgba(181,124,255,0.5)'; ctx.fillRect(px, py + 14, 32, 1);
          return;
        }
        ctx.fillStyle = '#3A3148'; ctx.fillRect(px, py - 22, 32, 52);
        ctx.fillStyle = '#4E4462'; ctx.fillRect(px, py - 22, 32, 4);
        ctx.fillStyle = '#EDE3CF'; ctx.fillRect(px, py - 22, 32, 1);
        ctx.fillStyle = 'rgba(181,124,255,' + (0.55 + 0.25 * Math.sin(t * 2)) + ')';
        for (let i = 0; i < 3; i++) ctx.fillRect(px + 5 + i * 10, py - 14, 2, 38);
        ctx.fillRect(px + (o.right ? 0 : 28), py - 2, 4, 6);
        return;
      case 'tablet_pedestal':
        fbLowBlock(ctx, px, py, '#7A7086', '#4E4558', '#EDE3CF');
        if (!o.taken) {
          ctx.fillStyle = 'rgba(255,198,107,' + (0.25 + 0.15 * Math.sin(t * 3)) + ')'; ctx.fillRect(px + 7, py - 2, 18, 16);
          ctx.fillStyle = '#9A5A3A'; ctx.fillRect(px + 10, py - 1, 12, 13);
          ctx.fillStyle = '#D9A441'; for (let i = 0; i < 4; i++) ctx.fillRect(px + 12 + (i % 2) * 4, py + 1 + i * 3, 3, 1);
        } else { ctx.fillStyle = '#3A3440'; ctx.fillRect(px + 10, py + 9, 12, 3); }
        return;
    }
    fbObject(ctx, kind, px, py, o);
  }

  // --- Figuren ---
  function fbWarden(ctx, x, y, o) {
    const f = +o.facing || 0, t = o.time || 0;
    const asleep = !!o.asleep;
    const body = asleep ? '#2E2838' : '#4A3F5E', wing = asleep ? '#3A3248' : '#6A5A86';
    ctx.fillStyle = 'rgba(11,14,26,0.45)'; ctx.beginPath(); ctx.ellipse(x, y, 28, 9, 0, 0, Math.PI * 2); ctx.fill();
    const hx = x + Math.cos(f) * 20, hy = y - 18 + Math.sin(f) * 9;
    ctx.fillStyle = wing;
    ctx.beginPath(); ctx.moveTo(x - Math.cos(f) * 10, y - 30); ctx.lineTo(x - Math.cos(f) * 30 - Math.sin(f) * 12, y - 44); ctx.lineTo(x + Math.sin(f) * 6, y - 24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(x, y - 16, 26, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = asleep ? '#3A3248' : '#5E5274'; ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.brass; ctx.fillRect(Math.round(hx) - 6, Math.round(hy) - 10, 12, 3);   // Krone
    const eye = asleep ? '#2A2430' : (Math.floor(t * 4) % 2 ? PAL.red : PAL.amber);
    ctx.fillStyle = eye; ctx.fillRect(Math.round(hx + Math.cos(f) * 4) - 3, Math.round(hy) - 2, 2, 2); ctx.fillRect(Math.round(hx + Math.cos(f) * 4) + 1, Math.round(hy) - 2, 2, 2);
    if (o.hit) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(x, y - 16, 26, 14, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  // Bodenring mit Segmenten (Spieler und Gegner auf v2-Karten). frac = Ladefortschritt zum nächsten Segment.
  function drawShieldRing(ctx, x, y, seg, max, frac, t, size) {
    max = Math.max(1, Math.min(8, +max || 0)); seg = Math.max(0, Math.min(max, +seg || 0));
    const rx = size || 13, ry = Math.max(4, Math.round(rx * 0.45));
    const step = Math.PI * 2 / max, gap = max > 1 ? 0.22 : 0;
    ctx.save();
    ctx.lineWidth = 2;
    for (let i = 0; i < max; i++) {
      const a0 = Math.PI / 2 + i * step + gap / 2, a1 = a0 + step - gap;
      if (i < seg) {
        ctx.strokeStyle = SHIELD_COL; ctx.setLineDash([]);
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, a0, a1); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(142,163,181,0.55)'; ctx.setLineDash([2, 2]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, a0, a1); ctx.stroke();
        ctx.lineWidth = 2; ctx.setLineDash([]);
        if (i === seg && frac > 0) { ctx.strokeStyle = 'rgba(127,243,255,0.7)'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, a0, a0 + (a1 - a0) * clamp01(frac)); ctx.stroke(); }
      }
    }
    if (seg === 0) {   // leer: Umriss pulsiert weiß-rot
      const k = 0.5 + 0.5 * Math.sin((t || 0) * 8);
      ctx.setLineDash([]); ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(' + Math.round(244 - 20 * k) + ',' + Math.round(238 - 167 * k) + ',' + Math.round(220 - 160 * k) + ',0.9)';
      ctx.beginPath(); ctx.ellipse(x, y, rx + 3, ry + 2, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  // Hex-Flackern der Schildblase (Fallback, falls art.js shieldHitT nicht kennt)
  function fbShieldBubble(ctx, x, y, age) {
    const a = clamp01(1 - age / 0.35);
    if (a <= 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(127,243,255,' + a + ')'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y - 17, 14, 22, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(127,243,255,' + (a * 0.18) + ')'; ctx.fill();
    for (let i = 0; i < 6; i++) {
      const ang = i * Math.PI / 3 + age * 4;
      const hx = x + Math.cos(ang) * 8, hy = y - 17 + Math.sin(ang) * 12;
      ctx.strokeRect(Math.round(hx) - 2.5, Math.round(hy) - 2.5, 5, 5);
    }
    ctx.restore();
  }
  // Medi-Kreuz über Verwundeten (für das Team auch im Nebel sichtbar)
  function drawMediCross(ctx, x, y, t) {
    const pulse = Math.floor(t * 3) % 2 === 0;
    ctx.fillStyle = PAL.star; ctx.fillRect(x - 5, y - 2, 11, 5); ctx.fillRect(x - 2, y - 5, 5, 11);
    ctx.fillStyle = pulse ? PAL.red : '#B0302A'; ctx.fillRect(x - 4, y - 1, 9, 3); ctx.fillRect(x - 1, y - 4, 3, 9);
  }
  function fbFxM2(ctx, kind, x, y, t, o) {
    const p = o.p != null ? clamp01(o.p) : (t % 1);
    switch (kind) {
      case 'shield_hit':
        fbShieldBubble(ctx, x, y + 17, p * 0.35);
        return;
      case 'shield_break':
        ctx.fillStyle = 'rgba(127,243,255,' + (1 - p) + ')';
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4 + 0.3;
          ctx.fillRect(Math.round(x + Math.cos(a) * (6 + p * 22)) - 2, Math.round(y + Math.sin(a) * (4 + p * 14) + p * p * 10) - 2, 4, 4);
        }
        return;
      case 'cover_hit':
        ctx.fillStyle = 'rgba(200,190,170,' + (1 - p) + ')';
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i - 2.5) * 0.45;
          ctx.fillRect(Math.round(x + Math.cos(a) * p * 16), Math.round(y + Math.sin(a) * p * 14 + p * p * 12), 2, 2);
        }
        ctx.fillStyle = 'rgba(255,241,184,' + (1 - p) + ')'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
        return;
      case 'muzzle_aim': {
        const r = 2 + p * 5;
        ctx.fillStyle = 'rgba(224,71,60,' + (0.3 + 0.5 * p) + ')'; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p > 0.75 ? PAL.spark : 'rgba(255,198,107,0.9)'; ctx.beginPath(); ctx.arc(x, y, Math.max(1, r * 0.45), 0, Math.PI * 2); ctx.fill();
        return;
      }
      case 'warden_deflect':
        ctx.strokeStyle = 'rgba(181,124,255,' + (1 - p) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 8 + p * 14, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(244,238,220,' + (1 - p) + ')'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 6, 2, 12); ctx.fillRect(Math.round(x) - 6, Math.round(y) - 1, 12, 2);
        return;
      case 'revive':
        ctx.strokeStyle = 'rgba(127,224,194,' + (1 - p) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y, 8 + p * 18, 4 + p * 8, 0, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(127,243,255,' + (1 - p) + ')'; for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(x - 9 + i * 6), Math.round(y - 10 - p * 26 - i * 3), 2, 4);
        return;
      case 'order_pillar': {
        const col = o.color || PAL.mint, h = o.height || 120;
        const grd = ctx.createLinearGradient(0, y - h, 0, y);
        grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, col);
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 3);
        ctx.fillStyle = grd; ctx.fillRect(Math.round(x) - 5, Math.round(y - h), 10, h);
        ctx.globalAlpha = 0.9; ctx.fillRect(Math.round(x) - 1, Math.round(y - h), 2, h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col; ctx.beginPath(); ctx.ellipse(x, y, 10, 4, 0, 0, Math.PI * 2); ctx.stroke();
        return;
      }
    }
  }
  function fbProjectileM2(ctx, kind, x, y, angle) {
    if (kind === 'warden') {
      ctx.fillStyle = 'rgba(181,124,255,0.55)'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PAL.star; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const col = kind === 'enemy' ? '#FF6A3D' : kind === 'pistol' ? SHIELD_COL : PAL.mint;
    const len = kind === 'pistol' ? 4 : 6;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - Math.cos(angle) * len, y - Math.sin(angle) * len); ctx.lineTo(x + Math.cos(angle) * 2, y + Math.sin(angle) * 2); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = PAL.spark; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
  }
  function drawProjectile(ctx, pr, x, y, t) {
    if (PROJ_M2[pr.kind]) {
      if (artK('drawProjectile', pr.kind, [ctx, pr.kind, x, y, pr.angle || 0, t], (g) => window.Art.drawProjectile(g, pr.kind, 48, 48, 0, 0))) return;
      fbProjectileM2(ctx, pr.kind, x, y, pr.angle || 0);
      return;
    }
    if (!art('drawProjectile', 'drawProjectile:' + pr.kind, [ctx, pr.kind, x, y, pr.angle || 0, t])) {
      ctx.fillStyle = pr.kind === 'drone' ? PAL.red : PAL.mint; ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }
  // Gitter-Silhouette eines Geists (letzte bekannte Position), blasser mit dem Alter
  // B2-NACH: Wurf-Zielvorschau (view.wurfZiel aus client.js): dezenter Bodenring am echten Landepunkt (auf min/max
  // geklemmt), Radius = Explosionsradius. P(x, y) -> Bildschirmpunkt am Boden (3D: Projektion je Kreispunkt = Ellipse).
  function drawWurfZiel(ctx, view, P) {
    const z = view.wurfZiel;
    if (!z) return;
    const pts = [];
    for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; const s = P(z.x + Math.cos(a) * z.r, z.y + Math.sin(a) * z.r); if (s.behind) return; pts.push(s); }
    const c = P(z.x, z.y);
    const puls = 0.5 + 0.5 * Math.sin((view.time || 0) * 4);
    ctx.save();
    ctx.beginPath(); pts.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y))); ctx.closePath();
    ctx.fillStyle = 'rgba(255,198,107,0.08)'; ctx.fill();
    ctx.setLineDash(z.geklemmt ? [3, 3] : []);
    ctx.strokeStyle = 'rgba(255,198,107,' + (0.45 + 0.2 * puls).toFixed(2) + ')'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,198,107,0.75)'; ctx.fillRect(Math.round(c.x) - 1, Math.round(c.y) - 1, 3, 3);
    ctx.restore();
  }
  function drawGhost(ctx, x, y, kind, age, ttl) {
    const a = 0.15 + 0.6 * clamp01(1 - age / Math.max(0.5, ttl));
    const w = kind === 'warden' ? 44 : 14, h = kind === 'warden' ? 30 : 24;
    ctx.fillStyle = 'rgba(169,214,229,' + a + ')';
    for (let yy = 0; yy < h; yy += 3) for (let xx = 0; xx < w; xx += 3) {
      const nx = (xx - w / 2) / (w / 2), ny = (yy - h / 2) / (h / 2);
      if (nx * nx + ny * ny <= 1) ctx.fillRect(Math.round(x - w / 2 + xx), Math.round(y - h - 2 + yy), 1, 1);
    }
    text(ctx, '? ' + Math.max(0, Math.round(age)) + ' s', x, y - h - 12, { color: 'rgba(169,214,229,' + Math.min(1, a + 0.2) + ')', align: 'center' });
  }
  // Frontbogen des Wächters (Schild vorn) – liegt auf dem Boden und als Bogen vor der Figur
  function drawWardenFront(ctx, x, y, facing, t, asleep, subtle) {
    const arc = cfgNum('enemy.warden.frontArc', 120) * Math.PI / 180;
    ctx.save();
    if (subtle) {
      ctx.strokeStyle = asleep ? 'rgba(181,124,255,0.18)' : 'rgba(181,124,255,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.ellipse(x, y - 2, 40, 18, 0, facing - arc / 2, facing + arc / 2); ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.strokeStyle = asleep ? 'rgba(181,124,255,0.25)' : 'rgba(181,124,255,' + (0.6 + 0.25 * Math.sin(t * 4)) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, y - 4, 38, 17, 0, facing - arc / 2, facing + arc / 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = asleep ? 'rgba(127,243,255,0.2)' : 'rgba(127,243,255,0.65)';
    ctx.beginPath(); ctx.ellipse(x, y - 4, 42, 19, 0, facing - arc / 2, facing + arc / 2); ctx.stroke();
    ctx.restore();
  }

  // Teamsicht (Fog of War): Vereinigung der sichtbaren Kacheln aller Außenteam-Spieler, höchstens 5× pro Sekunde neu
  const fogCache = { t: -1e9, mapId: null, set: null, gate: null, crouch: '' };
  function teamVision(view, map, st) {
    if (!Los || !map) return null;
    const now = performance.now();
    const gate = !!(st.away && st.away.vault && st.away.vault.open);
    // §15: Wer geduckt ist, sieht nicht über die niedrige Deckung neben sich (Wechsel sofort neu rechnen)
    const crouchKey = (view.players || []).filter(p => p.zone === 'away' && p.cr && !p.downed).map(p => p.id).sort().join(',');
    if (fogCache.set && fogCache.mapId === map.id && fogCache.gate === gate && fogCache.crouch === crouchKey && now - fogCache.t < 200) return fogCache.set;
    const solid = solidFn(map, st);
    const blocked = Los.sightFn(map, solid);
    const r = cfgNum('sightTiles', 10);
    const set = new Set();
    for (const p of view.players || []) {
      if (p.zone !== 'away' || p.connected === false) continue;
      const b = p.cr && !p.downed && Los.crouchSight ? Los.crouchSight(map, solid, blocked, [{ x: p.x, y: p.y }]) : blocked;
      for (const k of Los.visibleTiles(b, p.x, p.y - 4, r, map.w, map.h)) set.add(k);
    }
    fogCache.t = now; fogCache.mapId = map.id; fogCache.set = set; fogCache.gate = gate; fogCache.crouch = crouchKey;
    return set;
  }
  function drawFog(ctx, set, tx0, ty0, tx1, ty1, camX, camY) {
    const path = new Path2D();
    let any = false;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (set.has(tx + ',' + ty)) continue;
      path.rect(tx * TILE - camX, ty * TILE - camY, TILE, TILE); any = true;
    }
    if (!any) return;
    ctx.save();
    try { ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = 'rgba(128,128,128,0.85)'; ctx.fill(path); } catch (e) { /* ältere Browser: nur abdunkeln */ }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6,8,16,0.58)'; ctx.fill(path);
    ctx.restore();
  }
  // Ist ein Gegner für das Außenteam zu zeichnen? (Server setzt vis; tote nur, wenn ihre Kachel sichtbar ist)
  function enemyShown(e, fogSet) {
    if (e.alive === false) return !fogSet || fogSet.has(Math.floor(e.x / TILE) + ',' + Math.floor(e.y / TILE));
    return e.vis !== false && !!e.vis;
  }
  function orderPos(o, drones) {
    if (o.kind === 'fokus' && o.target != null) {
      const e = (drones || []).find(d => d.id === o.target);
      if (e) return { x: e.x, y: e.y };
    }
    return { x: +o.x || 0, y: +o.y || 0 };
  }
  function activeOrders(st) {
    const a = (st && st.away) || {};
    return (a.orders || []).filter(o => o && ORDER_NAMES[o.kind] && !(o.until != null && st.time != null && st.time > o.until));
  }
  // Deckungs-Pips um den eigenen Spieler (hohl = halb, voll = voll)
  // §15: geduckt -> niedrige Deckung zählt als voll (voller Pip mit Zusatzring); stehend zeigt der hohle Pip „C“ als Hinweis
  function drawCoverPips(ctx, map, st, px, py, camX, camY, t, crouched) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    const solid = solidFn(map, st);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const cx = tx + dx, cy = ty + dy;
      const ch = map.at(cx, cy);
      if (!OBJ_KESH[ch] || !solid(cx, cy)) continue;
      const info = map.info(cx, cy);
      const cover0 = info.cover || 0;
      if (!cover0) continue;
      const ducked = !!(crouched && info.low);
      const cover = ducked ? 2 : cover0;
      const sx = cx * TILE - camX, sy = cy * TILE - camY;
      ctx.strokeStyle = 'rgba(127,243,255,' + (0.35 + 0.15 * Math.sin(t * 4)) + ')'; ctx.lineWidth = 1;
      ctx.strokeRect(sx + 1.5, sy + 1.5, TILE - 3, TILE - 3);
      const pipY = sy + (cover0 >= 2 ? -36 : 2);
      ctx.fillStyle = 'rgba(11,14,26,0.75)'; ctx.beginPath(); ctx.arc(sx + 16, pipY + 3, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = SHIELD_COL; ctx.beginPath(); ctx.arc(sx + 16, pipY + 3, 3.5, 0, Math.PI * 2);
      if (cover >= 2) { ctx.fillStyle = SHIELD_COL; ctx.fill(); } else ctx.stroke();
      if (ducked) {
        // Zusatzhinweis: pulsierender weißer Ring + „GEDUCKT“-Häkchen über dem Pip
        ctx.strokeStyle = 'rgba(244,238,220,' + (0.55 + 0.35 * Math.sin(t * 5)) + ')';
        ctx.beginPath(); ctx.arc(sx + 16, pipY + 3, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#0B0E1A';
        ctx.fillRect(Math.round(sx + 13), Math.round(pipY + 3), 1, 1); ctx.fillRect(Math.round(sx + 14), Math.round(pipY + 4), 1, 1);
        ctx.fillRect(Math.round(sx + 15), Math.round(pipY + 3), 1, 1); ctx.fillRect(Math.round(sx + 16), Math.round(pipY + 2), 1, 1);
        ctx.fillRect(Math.round(sx + 17), Math.round(pipY + 1), 1, 1);
      } else if (info.low && !crouched) {
        text(ctx, 'C', sx + 24, pipY - 1, { color: SHIELD_COL, shadow: true });
      }
    }
  }
  // Schildsegmente als kleine Würfel (HUD, Konsolen). Leer = Umriss, Ladefortschritt füllt das nächste von unten.
  function drawShieldPips(ctx, x, y, seg, max, frac, size, gap) {
    size = size || 10; gap = gap == null ? 3 : gap;
    for (let i = 0; i < max; i++) {
      const bx = x + i * (size + gap);
      ctx.fillStyle = 'rgba(11,14,26,0.8)'; ctx.fillRect(bx, y, size, size);
      if (i < seg) {
        ctx.fillStyle = SHIELD_COL; ctx.fillRect(bx, y, size, size);
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(bx + 1, y + 1, size - 2, Math.max(1, Math.floor(size / 4)));
      } else if (i === seg && frac > 0) {
        const fh = Math.round(size * clamp01(frac));
        ctx.fillStyle = 'rgba(127,243,255,0.55)'; ctx.fillRect(bx, y + size - fh, size, fh);
      }
      ctx.strokeStyle = i < seg ? '#C9FBFF' : SHIELD_COL; ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, y + 0.5, size - 1, size - 1);
    }
  }

  // Kommandokarte einer Außenkarte (Captain, Reiter Außenteam): alle Gegner, verrauscht bei scanQuality < 1
  function drawAwayCommandMap(ctx, view, rect, opts) {
    opts = opts || {};
    const st = view.state, a = st.away || {}, t = view.time;
    const map = mapFor('away', st);
    const c = Math.max(2, Math.floor(Math.min((rect.w - 4) / map.w, (rect.h - 4) / map.h)));
    const ox = rect.x + Math.floor((rect.w - map.w * c) / 2), oy = rect.y + Math.floor((rect.h - map.h * c) / 2);
    const toS = (x, y) => ({ x: Math.round(ox + x / TILE * c), y: Math.round(oy + y / TILE * c) });
    const toW = (sx, sy) => ({ x: Math.round((sx - ox) / c * TILE), y: Math.round((sy - oy) / c * TILE) });
    const solid = solidFn(map, st);
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.fillStyle = '#070B14'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const ch = map.at(tx, ty);
      if (ch === ' ' || ch === '~') continue;
      let col = '#2E2B36';
      if (ch === 'R') col = '#16131A';
      else if (ch === '#') col = '#4C4456';
      else if (ch === '.') col = '#3C342A';
      else if (ch === 'P') col = '#3D6A60';
      else if (ch === 'o') col = '#8A8294';
      else if (ch === 'I') col = '#C0B6CC';
      else if (ch === 'r') { const js = keshObjState(st, map, tx, ty).jammer; col = js && js.off ? '#4A4550' : (Math.floor(t * 3) % 2 ? PAL.red : '#8A2A24'); }
      else if (ch === 'k') { const ks = keshObjState(st, map, tx, ty).key; col = ks && ks.t > 0 ? KESH_VIOLET : '#6A4A9A'; }
      else if (ch === 'G') col = solid(tx, ty) ? '#7A3FB0' : '#2E2B36';
      else if (ch === 'T') col = a.tablet && a.tablet.taken ? '#5A5262' : '#D9A441';
      else if (ch === '#' || map.solid(tx, ty)) col = '#4C4456';
      ctx.fillStyle = col; ctx.fillRect(ox + tx * c, oy + ty * c, c, c);
    }
    if (map.id === 'kesh') {
      const lab = (s, tx, ty) => text(ctx, s, ox + tx * c, oy + ty * c, { color: 'rgba(201,151,74,0.85)', align: 'center' });
      lab('LANDEZONE', 7, 23); lab('HOF', 17, 1.2); lab('NORDKORRIDOR', 32, 4.1); lab('SÜDKORRIDOR', 32, 14.2); lab('ARCHIVHALLE', 42, 0); lab('GEWÖLBE', 42, 23);
    }
    // Befehle
    for (const o of activeOrders(st)) {
      const p = toS(orderPos(o, view.drones).x, orderPos(o, view.drones).y);
      const col = ORDER_COL[o.kind];
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6 + Math.sin(t * 4), 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = col; ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
      text(ctx, ORDER_NAMES[o.kind], p.x + 9, p.y - 4, { color: col });
    }
    // Gegner
    const q = a.scanQuality == null ? 1 : +a.scanQuality;
    const noisy = q < 1;
    const enemyRects = [];
    const slot = Math.floor(t * 2);
    for (const e of view.drones || []) {
      if (e.alive === false) continue;
      let ex = e.x, ey = e.y;
      const seed = String(e.id).split('').reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7);
      if (noisy) {
        const amp = (1 - q) * 3 * TILE;
        ex += (hash(seed + slot * 13) - 0.5) * amp; ey += (hash(seed + slot * 29 + 1) - 0.5) * amp;
        if (hash(seed * 3 + slot * 7 + Math.floor(t * 6)) < (1 - q) * 0.4) continue;   // Blip flackert
      }
      const s = toS(ex, ey);
      const warden = e.kind === 'warden';
      const sz = warden ? 9 : 6;
      if (noisy) {
        ctx.fillStyle = 'rgba(224,71,60,' + (0.45 + 0.3 * hash(seed + slot)) + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, sz / 2 + 1, 0, Math.PI * 2); ctx.fill();
      } else {
        shape(ctx, warden ? 'diamond' : 'diamond', s.x, s.y, sz + 2, warden ? (e.asleep ? '#5A5070' : KESH_VIOLET) : PAL.rust, PAL.space);
        if (warden && e.facing != null) { ctx.strokeStyle = PAL.star; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(e.facing) * 10, s.y + Math.sin(e.facing) * 10); ctx.stroke(); }
        const sh = Array.isArray(e.sh) ? e.sh : null;
        if (sh) for (let i = 0; i < sh[1]; i++) { ctx.fillStyle = i < sh[0] ? SHIELD_COL : '#3A4250'; ctx.fillRect(s.x - sh[1] * 2 + i * 4, s.y + sz / 2 + 2, 3, 2); }
        if (e.aim && e.aim.target != null) {
          const tp = (view.players || []).find(p => p.id === e.aim.target && p.zone === 'away');
          if (tp) { const ts = toS(tp.x, tp.y); ctx.strokeStyle = 'rgba(224,71,60,' + (0.4 + 0.6 * clamp01(e.aim.p)) + ')'; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(ts.x, ts.y); ctx.stroke(); }
        }
      }
      enemyRects.push({ id: e.id, x: s.x - 7, y: s.y - 7, w: 14, h: 14, kind: e.kind });
      if (opts.highlight === e.id) { ctx.strokeStyle = PAL.red; ctx.strokeRect(s.x - 7.5, s.y - 7.5, 15, 15); }
    }
    // Außenteam
    for (const p of view.players || []) {
      if (p.zone !== 'away' || p.connected === false) continue;
      const s = toS(p.x, p.y);
      shape(ctx, SHAPES[p.color || 0], s.x, s.y, 8, PAL.players[p.color || 0], PAL.space);
      if (p.downed) drawMediCross(ctx, s.x, s.y - 9, t);
    }
    if (a.marker) { const s = toS(a.marker.x, a.marker.y); ctx.strokeStyle = PAL.amber; ctx.strokeRect(s.x - 3.5, s.y - 3.5, 7, 7); }
    if (noisy) {   // Rauschen
      ctx.fillStyle = 'rgba(169,214,229,0.07)';
      for (let i = 0; i < 90; i++) ctx.fillRect(rect.x + Math.floor(hash(i * 7 + slot * 131) * rect.w), rect.y + Math.floor(hash(i * 13 + slot * 71) * rect.h), 2, 1);
    }
    ctx.restore();
    ctx.strokeStyle = noisy ? PAL.warn : PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    return { toS, toW, enemyRects, cell: c, ox, oy, map };
  }

  // ------------------------------------------------------------------ Innenraum / Plattform
  const camera = { x: 0, y: 0, zone: 'ship' };

  function updateCamera(view) {
    const map = mapFor(view.self.zone, view.state);
    const mw = map.w * TILE, mh = map.h * TILE;
    let cx = view.self.x - VW / 2, cy = view.self.y - 16 - VH / 2;
    // Kamera darf etwas über den Kartenrand hinaus (Sternenhimmel), damit die eigene Figur in den Ecken
    // nicht unter den HUD-Tafeln (Ziele oben links, Status unten links, Minikarte unten rechts) verschwindet.
    const MX = 150, MY = 100;
    cx = mw + 2 * MX <= VW ? (mw - VW) / 2 : Math.max(-MX, Math.min(mw - VW + MX, cx));
    cy = mh + 2 * MY <= VH ? (mh - VH) / 2 : Math.max(-MY, Math.min(mh - VH + MY, cy));
    camera.x = Math.round(cx); camera.y = Math.round(cy); camera.zone = view.self.zone;
  }

  function charOpts(p, view) {
    let action = null;
    if (p.console === 'plan') action = 'sit';
    else if (p.console) action = 'console';
    else if (p.action && p.action.kind !== 'beam') action = 'repair';
    else if (p.carry) action = 'carry';
    let beam = null;
    if (p.action && p.action.kind === 'beam') beam = Math.max(0, Math.min(1, p.action.progress || 0)) * 0.6;
    const bf = view.beamFx && view.beamFx[p.id];
    if (bf != null) beam = bf;
    // FIX-ZIELEN: Blick zur Maus (players[].fa, Grad) statt Laufrichtung, solange frei (keine Konsole/Aktion/verwundet)
    let dir = p.dir || 'down';
    if (p.fa != null && isFinite(+p.fa) && !action && !p.downed && !p.carry) {
      const a = +p.fa * Math.PI / 180, cx = Math.cos(a), cy = Math.sin(a);
      dir = Math.abs(cx) >= Math.abs(cy) ? (cx > 0 ? 'right' : 'left') : (cy > 0 ? 'down' : 'up');
    }
    return { color: p.color || 0, dir, moving: !!p.moving, time: view.time, action, carry: p.carry || null, downed: !!p.downed, beam, flash: !!p.flash };
  }

  function drawWorld(ctx, view) {
    overlay3d.on = !!(view.voxel && window.VoxelRender);
    if (overlay3d.on) return drawWorldOverlay(ctx, view);   // M4: 3D zeichnet Kacheln, Figuren und Effekte
    const st = view.state;
    const zone = view.self.zone;
    const map = mapFor(zone, st);
    const isWreck = map.id === 'wreck';
    const isKesh = map.id === 'kesh';
    const buehne2d = zone === 'away' && isBuehne(map);
    // M3a: Schiff über die Legende (objKindOf), Außenkarten über ihre Tabellen
    const objKind = (ch) => (isWreck ? OBJ_WRECK[ch] : isKesh ? OBJ_KESH[ch] : objKindOf(map, ch)) || null;
    const v2 = zone === 'away' && isV2(st);
    const t = view.time;
    updateCamera(view);
    const camX = camera.x, camY = camera.y;
    const alert = (st.ship && st.ship.alert) || 'normal';
    const away = st.away || {};
    const doorOpen = !!(away.doorOpen || (away.sonde && away.sonde.disabled));
    const hollow = away.hollow || null;
    const hollowT = hollow ? toTileXY(map, hollow.x, hollow.y) : null;
    const hollowOpen = !!(hollow && hollow.open);
    const salvageDone = {};
    for (const s of away.salvage || []) { const tt = toTileXY(map, s.x, s.y); if (tt) salvageDone[tt.x + ',' + tt.y] = !!s.done; }
    const reactor = (st.ship && st.ship.reactor) || {};

    if (!art('drawStarfield', null, [ctx, camX, camY, VW, VH, t])) fbStarfield(ctx, camX, camY, VW, VH, t);

    const tx0 = Math.max(0, Math.floor(camX / TILE)), ty0 = Math.max(0, Math.floor(camY / TILE));
    const tx1 = Math.min(map.w - 1, Math.floor((camX + VW) / TILE)), ty1 = Math.min(map.h - 1, Math.floor((camY + VH) / TILE) + 1);
    const env = { map, tx: 0, ty: 0, time: t, alert, doorOpen, biome: isWreck ? 'wreck' : isKesh ? 'kesh' : zone === 'away' ? 'platform' : 'ship', roomStyle: null };
    if (isKesh) env.gateOpen = !!(away.vault && away.vault.open);
    const drawables = [];
    const ownRoomTint = zone === 'ship' && !artHasRoomStyle();
    const keshArt = isKesh && artHasKesh();

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const ch = map.at(tx, ty);
        if (ch === ' ' || ch === '~') continue;
        const px = tx * TILE - camX, py = ty * TILE - camY;
        if (buehne2d) {
          // B1/E35: gebaute Karte im 2D-Rückfall nur als Flachraster nach Kachelart
          const col = buehneKachelFarbe(map, st, tx, ty);
          if (!col) continue;
          ctx.fillStyle = col; ctx.fillRect(px, py, TILE, TILE);
          const info = map.info(tx, ty);
          if (info.cover === 1 && info.solid === true) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(px, py + TILE - 6, TILE, 6); }
          if (info.solid === true || info.solid === 'zustand') { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1); }
          continue;
        }
        if (isKesh) {
          // M2: Kesh – Objekte stehen auf Boden, Spawns sind Ruinenboden
          const kb = OBJ_KESH[ch] ? floorFor(map, tx, ty) : (ch === 'L' || ch === 'a' || ch === 'b' || ch === 'c') ? ',' : ch;
          env.tx = tx; env.ty = ty;
          if (!(keshArt && art('drawTile', 'drawTile', [ctx, kb, px, py, env]))) fbTileKesh(ctx, kb, px, py, map, tx, ty);
          if (OBJ_KESH[ch]) drawables.push({ key: ty * TILE + TILE - 1, tx, ty, ch, type: 'obj' });
          continue;
        }
        let base = ch;
        const isHollowOpen = isWreck && ch === 'V' && hollowOpen;
        if (isWreck && ch === 'V' && !isHollowOpen) base = 'V';   // Art: drawTile('V') = Wand, wall_weak darüber
        else if (objKind(ch) || isHollowOpen) base = floorFor(map, tx, ty);
        else if (ch === 'N' || ch === 'Q' || ch === 'd' || ch === 'a') base = '.';
        env.tx = tx; env.ty = ty;
        const ra = zone === 'ship' ? roomAt(tx, ty) : null;
        env.roomStyle = ra ? roomStyleOf(st, ra.room.id) : null;
        if (!art('drawTile', 'drawTile', [ctx, base, px, py, env])) fbTile(ctx, base, px, py, env);
        if (ra && ownRoomTint && (ra.wall ? base === '#' : FLOOR[base])) fbRoomTint(ctx, base, px, py, env.roomStyle, ra.wall);
        if (objKind(ch) && !isHollowOpen) drawables.push({ key: ty * TILE + TILE - 1, tx, ty, ch, type: 'obj' });
      }
    }
    env.roomStyle = null;
    if (buehne2d) drawBuehneAnker(ctx, map, st, camX, camY, t);   // B1: Anker als einfache Marken

    // Deko in den Quartieren (nur Schiff)
    if (zone === 'ship' && st.deco) {
      for (const bed of Maps.BEDS || []) for (const slot of bed.slots) {
        const item = st.deco[slot.id];
        if (!item) continue;
        const kind = 'deco_' + item;
        drawables.push({ key: kind === 'deco_teppich' ? slot.y * TILE : slot.y * TILE + 20, type: 'deco', kind, tx: slot.x, ty: slot.y });
      }
    }

    if (zone === 'ship' && st.ship) {
      for (const f of st.ship.fires || []) drawables.push({ key: f[1] * TILE + 18, type: 'fx', kind: 'fire', x: f[0] * TILE + 16, y: f[1] * TILE + 18 });
      for (const b of st.ship.breaches || []) drawables.push({ key: b.ty * TILE + 2, type: 'fx', kind: 'breach', x: b.tx * TILE + 16, y: b.ty * TILE + 16 });
      for (const it of st.ship.groundItems || []) drawables.push({ key: it.y - 4, type: 'item', kind: it.kind, x: it.x, y: it.y });
      for (const b of view.bots || []) drawables.push({ key: b.y, type: 'bot', e: b });
      // M1: NPCs an Bord (Techniker Ivo wohnt nach der Rettung im Gästequartier)
      for (const n of view.shipNpcs || st.ship.npcs || []) drawables.push({ key: n.y, type: 'npc', e: Object.assign({ shipNpc: true }, n) });
    }
    // M2: Teamsicht (Fog of War) nur auf v2-Karten
    const fogSet = v2 ? teamVision(view, map, st) : null;
    if (zone === 'away') {
      for (const it of away.items || []) drawables.push({ key: it.y - 4, type: 'item', kind: it.kind, x: it.x, y: it.y });
      const npc = view.npc;
      if (npc && npc.present !== false && !npc.rescued && !isKesh) drawables.push({ key: npc.y, type: 'npc', e: npc });
      for (const d of view.drones || []) {
        if (v2 && !enemyShown(d, fogSet)) continue;   // Außenteam sieht nur, was jemand im Team sieht (Server: vis)
        drawables.push({ key: d.y, type: 'drone', e: d });
      }
      for (const pr of view.awayProjectiles || []) drawables.push({ key: pr.y + 40, type: 'proj', e: pr });
    }
    for (const p of view.players || []) {
      if (p.zone !== zone || p.connected === false) continue;
      drawables.push({ key: p.y, type: 'char', e: p });
    }

    drawables.sort((a, b) => a.key - b.key);
    const plates = [];   // M3a: Seitenmarken der Stationen (nach den Objekten zeichnen)
    const barRects = [];   // QA M3b: Fortschrittsbalken der Spieler (Eskalations-Label weicht aus)
    const sondeDisabled = !!(away.sonde && away.sonde.disabled);
    const inv = st.inventory || {};
    for (const d of drawables) {
      try {
        if (d.type === 'obj') {
          const px = d.tx * TILE - camX, py = d.ty * TILE - camY;
          let kind = objKind(d.ch);
          const opts = { time: t, alert };
          if (isKesh) {
            // M2: Kesh-Objekte (§2.2) – Art nur, wenn sie die Art kennt; sonst eigene, lesbare Fallbacks
            const ks = keshObjState(st, map, d.tx, d.ty);
            opts.biome = 'kesh';
            if (d.ch === 'r') opts.off = !!(ks.jammer && ks.jammer.off);
            if (d.ch === 'k') { opts.t = ks.key ? clamp01(ks.key.t) : 0; opts.open = ks.gateOpen; }
            if (d.ch === 'G') { opts.open = ks.gateOpen; opts.left = map.at(d.tx - 1, d.ty) !== 'G'; opts.right = map.at(d.tx + 1, d.ty) !== 'G'; }
            if (d.ch === 'T') opts.taken = !!(ks.tablet && ks.tablet.taken);
            if (d.ch === 'o') { opts.left = map.at(d.tx - 1, d.ty) === 'o'; opts.right = map.at(d.tx + 1, d.ty) === 'o'; opts.variant = (d.tx * 7 + d.ty * 3) % 3; }
            if (!artObject(ctx, kind, px, py, opts)) fbObjectKesh(ctx, kind, px, py, opts);
            continue;
          }
          if (isWreck) {
            // Wrack-Objekte (M1 §9.4)
            if (d.ch === 'h') opts.done = !!salvageDone[d.tx + ',' + d.ty];
            if (d.ch === 'V') { const here = hollowT && hollowT.x === d.tx && hollowT.y === d.ty; opts.marked = !!(here && hollow.marked); opts.open = !!(here && hollow.open); }
            if (d.ch === 'g') opts.read = !!away.loreRead;
            if (!artObject(ctx, kind, px, py, opts)) fbObject(ctx, kind, px, py, opts);
            continue;
          }
          if (kind === 'reactor_switch') {
            const sw = Maps.REACTOR_SWITCHES ? Maps.REACTOR_SWITCHES.find(s => s.x === d.tx && s.y === d.ty) : null;
            opts.held = !!(sw && reactor.switches && reactor.switches[sw.id]);
            opts.reactorState = reactor.state || 'online';
            opts.id = sw ? sw.id : null;
            opts.progress = +reactor.restartProgress || 0;
            if (!artObject(ctx, kind, px, py, opts)) fbObject(ctx, kind, px, py, opts);
            continue;
          }
          if (kind === 'plan_table') {
            opts.qx = map.at(d.tx - 1, d.ty) === d.ch ? 1 : 0; opts.qy = map.at(d.tx, d.ty - 1) === d.ch ? 1 : 0;
            opts.active = (st.players || []).some(p => p.console === 'plan');
            if (!artObject(ctx, kind, px, py, opts)) fbObject(ctx, kind, px, py, opts);
            continue;
          }
          const dsys = sysOf(map, d.ch), dcon = consoleOf(map, d.ch);
          if (dsys) {
            opts.state = sysState(st, dsys);
            if (zone === 'ship') {
              // M3a: Stationen mit Zustand, fragil (geflickt) und Seite; neue Arten nur mit Probe (sonst Fallback)
              const li = legendOf(map, d.ch) || {};
              opts.fragile = fragileOf(st, dsys);
              opts.side = li.side || 'mid';
              opts.system = dsys;
              plates.push({ tx: d.tx, ty: d.ty, side: opts.side, state: opts.state, fragile: opts.fragile, system: dsys });
              if (!artObject(ctx, kind, px, py, opts)) fbObject(ctx, kind, px, py, opts);
              continue;
            }
          }
          if (dcon) {
            opts.active = (st.players || []).some(p => p.console === dcon);
            if (dcon === 'shop') opts.disabled = !(st.ship && st.ship.docked);
          }
          if (d.ch === 'L' && zone === 'away') { kind = 'door_locked'; opts.open = doorOpen; }
          else if (kind === 'shelf') { opts.item = shelfItemAt(d.tx, d.ty); opts.count = shelfStock(inv, opts.item); opts.empty = opts.count <= 0; opts.fill = shelfFill(inv, opts.item); }
          if (kind === 'bed') { const bed = bedAt(d.tx, d.ty); opts.color = bed ? bed.color : 0; }
          if (kind === 'sonde') opts.disabled = sondeDisabled;
          if (kind === 'barrel' || kind === 'pipes' || kind === 'control_desk') opts.variant = (d.tx * 7 + d.ty * 3) % 2;   // M0: Fass/Kabeltrommel, Rohr-Varianten
          // Mehrkachel-Objekte: Lage explizit übergeben (Art kennt die Nachbarn sonst nicht,
          // weil drawTile hier mit dem Bodenzeichen statt dem Objektzeichen aufgerufen wird)
          if (kind === 'buoy_core') { opts.qx = map.at(d.tx - 1, d.ty) === d.ch ? 1 : 0; opts.qy = map.at(d.tx, d.ty - 1) === d.ch ? 1 : 0; }
          if (kind === 'table') { opts.left = map.at(d.tx - 1, d.ty) === d.ch; opts.right = map.at(d.tx + 1, d.ty) === d.ch; }
          if (kind === 'door_locked') { const wv = (c) => c === '#'; opts.orient = wv(map.at(d.tx, d.ty - 1)) && wv(map.at(d.tx, d.ty + 1)) ? 'v' : 'h'; }
          if (kind === 'door_locked' && doorOpen) { /* offen: nur Boden + offene Tür */ }
          if (kind === 'terminal_spare') { if (!artObject(ctx, kind, px, py, opts)) fbObject(ctx, kind, px, py, opts); }   // neu: nur mit Art-Probe
          else if (!art('drawObject', 'drawObject:' + kind, [ctx, kind, px, py, opts])) fbObject(ctx, kind, px, py, opts);
        } else if (d.type === 'deco') {
          const px = d.tx * TILE - camX, py = d.ty * TILE - camY;
          if (!artObject(ctx, d.kind, px, py, { time: t })) fbObject(ctx, d.kind, px, py, { time: t });
        } else if (d.type === 'fx') {
          drawFx(ctx, d.kind, d.x - camX, d.y - camY, t);
        } else if (d.type === 'item') {
          if (!art('drawItem', 'drawItem:' + d.kind, [ctx, d.kind, d.x - camX, d.y - camY - 6, { time: t }])) itemFallback(ctx, d.kind, d.x - camX, d.y - camY - 6);
        } else if (d.type === 'bot') {
          const b = d.e, o = { variant: b.variant || 0, dir: b.dir || 'down', moving: !!b.moving, working: !!(b.task && b.progress > 0), time: t, carry: b.carry || null };
          if (!art('drawBot', null, [ctx, b.x - camX, b.y - camY, o])) {
            ctx.fillStyle = PAL.brass; ctx.beginPath(); ctx.arc(b.x - camX, b.y - camY - 8, 8, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = PAL.mint; ctx.fillRect(b.x - camX - 3, b.y - camY - 11, 6, 3);
            if (b.carry) itemFallback(ctx, b.carry, b.x - camX, b.y - camY - 24);
          }
          if (b.task && b.progress > 0) {
            const sba = setbackAgeFor(view, 'bot', b.id, b.task.system);
            ring(ctx, b.x - camX, b.y - camY - 28, 5, b.progress, sba != null ? '#FF5A4A' : PAL.brass);
            if (sba != null) text(ctx, '−' + Math.round(cfgM3b('repairHitLoss', 0.5) * 100) + ' %', b.x - camX, b.y - camY - 44, { color: '#FF5A4A', align: 'center' });
          }
        } else if (d.type === 'npc') {
          const n = d.e;
          if (!art('drawNpc', null, [ctx, n.x - camX, n.y - camY, { dir: n.dir || 'down', moving: !!n.moving, time: t }])) {
            fbCharacter(ctx, n.x - camX, n.y - camY, { color: 0, dir: n.dir, moving: n.moving, time: t });
            ctx.fillStyle = PAL.ice; ctx.fillRect(n.x - camX - 7, n.y - camY - 24, 14, 17);
          }
          if (n.shipNpc) text(ctx, n.id === 'ivo' ? 'Ivo' : String(n.name || n.id || ''), n.x - camX, n.y - camY - 48, { color: PAL.ice, align: 'center' });
          else text(ctx, n.injured ? 'Techniker (verletzt)' : n.following ? 'Techniker (folgt)' : 'Techniker', n.x - camX, n.y - camY - 48, { color: n.injured ? PAL.warn : PAL.ice, align: 'center' });
        } else if (d.type === 'drone') {
          const e = d.e;
          const hidden = !e.alive && false;
          const dk = e.kind || (isWreck ? 'scavenger' : undefined);
          const ex = e.x - camX, ey = e.y - camY;
          const hitAge = view.enemyHit && view.enemyHit[e.id] != null ? view.enemyHit[e.id] : 99;
          const esh = v2 && Array.isArray(e.sh) ? e.sh : null;
          if (dk === 'warden') {
            // M2: Wächter („Lamassu“) mit Frontbogen und Blickrichtung
            const wo = { time: t, alive: e.alive !== false, kind: 'warden', facing: +e.facing || 0, asleep: !!e.asleep, wake: !e.asleep, hit: hitAge < 0.15, revealed: aufgedeckt(e, st), shieldSeg: esh ? esh[0] : null, shieldMax: esh ? esh[1] : null };
            if (e.alive !== false) {
              if (esh) drawShieldRing(ctx, ex, ey + 2, esh[0], esh[1], 0, t, 30);
              // Frontbogen: art.js zeichnet beim wachen Wächter selbst Hex-Platten – dann nur dezent am Boden
              drawWardenFront(ctx, ex, ey, wo.facing, t, wo.asleep, artHasWarden());
            }
            if (!(artHasWarden() && art('drawDrone', 'drawDrone:warden', [ctx, ex, ey, wo]))) fbWarden(ctx, ex, ey, wo);
            if (e.alive !== false) text(ctx, e.asleep ? 'WÄCHTER (schläft)' : 'WÄCHTER', ex, ey - 62, { color: e.asleep ? PAL.panelLight : KESH_VIOLET, align: 'center' });
          } else {
            if (esh && e.alive !== false) drawShieldRing(ctx, ex, ey, esh[0], esh[1], 0, t, 11);
            let aimAngle = null;
            if (e.aim) { const tp = (view.players || []).find(q => q.id === e.aim.target); if (tp) aimAngle = Math.atan2(tp.y - e.y, tp.x - e.x); }
            const ecr = v2 && !!e.cr && e.alive !== false;   // §15: geduckter Plünderer
            const drawE = () => {
              if (!hidden && !art('drawDrone', null, [ctx, ex, ey, { time: t, alive: e.alive !== false, revealed: aufgedeckt(e, st), hit: v2 ? hitAge < 0.15 : !!e.hit, kind: dk, role: e.role || null, aiming: !!e.aim, aimAngle, shieldSeg: esh ? esh[0] : null, shieldMax: esh ? esh[1] : null, crouch: ecr }])) {
                shape(ctx, 'diamond', ex, ey - 14, 14, e.alive === false ? PAL.grey : dk === 'scavenger' ? PAL.rust : PAL.red, PAL.space);
              }
            };
            if (ecr && !artHasCrouch('drone')) squashed(ctx, ex, ey, CROUCH_FB, drawE); else drawE();
            if (dk === 'scavenger' && e.alive !== false) text(ctx, ecr ? 'PLÜNDERER (geduckt)' : 'PLÜNDERER', ex, ey - (ecr ? 28 : 36), { color: PAL.rust, align: 'center' });
          }
        } else if (d.type === 'proj') {
          const pr = d.e;
          // v2: Projektil-Koordinaten sind Fußhöhe (Server) – sichtbar etwa auf Brusthöhe zeichnen
          drawProjectile(ctx, pr, pr.x - camX, pr.y - camY - (v2 ? 10 : 0), t);
        } else if (d.type === 'char') {
          const p = d.e;
          const o = charOpts(p, view);
          const sx = p.x - camX, sy = p.y - camY;
          const psh = v2 && Array.isArray(p.sh) ? p.sh : null;
          if (psh) {
            o.shieldSeg = psh[0]; o.shieldMax = psh[1];
            o.shieldHitT = view.shieldHit && view.shieldHit[p.id] != null ? view.shieldHit[p.id] : 99;
            if (p.downed) {
              // liegend: roter, schrumpfender Ring (Zeit bis zur Rückholung)
              const frac = p.bleed != null ? clamp01(p.bleed / cfgNum('wounded.bleedout', 45)) : 1;
              ctx.strokeStyle = 'rgba(224,71,60,' + (0.55 + 0.35 * Math.sin(t * 6)) + ')'; ctx.lineWidth = 2;
              ctx.beginPath(); ctx.ellipse(sx, sy - 4, 6 + 16 * frac, 3 + 7 * frac, 0, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
            } else drawShieldRing(ctx, sx, sy, psh[0], psh[1], +p.shR || 0, t, 13);
          }
          // §15: geduckt – Art-Pose (opts.crouch) oder Fallback: auf 65 % Höhe gestaucht
          o.crouch = !!(psh && p.cr && !p.downed);
          const drawC = () => { if (!art('drawCharacter', null, [ctx, sx, sy, o])) fbCharacter(ctx, sx, sy, o); };
          if (o.crouch && !artHasCrouch('char')) squashed(ctx, sx, sy, CROUCH_FB, drawC); else drawC();
          if (psh && !p.downed && o.shieldHitT < 0.35 && !artHasShieldHit()) fbShieldBubble(ctx, sx, sy, o.shieldHitT);
          if (p.id !== view.pid) {
            const col = PAL.players[p.color || 0];
            const nm = String(p.name || '').slice(0, 12);
            const w = measure(nm, 1) + 14;
            const ny = sy - (o.crouch ? 40 : 52);
            backdrop(ctx, Math.round(sx - w / 2), ny, w, 10, 0.55);
            shape(ctx, SHAPES[p.color || 0], sx - w / 2 + 6, ny + 5, 6, col);
            text(ctx, nm, sx - w / 2 + 11, ny + 1, { color: col, shadow: false });
          }
          if (p.downed && psh) {
            text(ctx, 'VERWUNDET' + (p.bleed != null ? ' ' + Math.max(0, Math.ceil(p.bleed)) + ' s' : ''), sx, sy - 24, { color: PAL.red, align: 'center' });
          } else if (p.downed) {
            text(ctx, 'AUSSER GEFECHT', sx, sy - 22, { color: PAL.red, align: 'center' });
          }
          if (p.action && (p.action.kind === 'flick' || p.action.kind === 'swap' || p.action.kind === 'minigame')) {
            actionBar(ctx, sx, sy - 50, p.action, p.id === view.pid, setbackAgeFor(view, 'player', p.id, p.action.system));
            barRects.push({ x: sx - 30, y: sy - 52, w: 60, h: 19 });   // QA M3b: „brennt in …“ weicht dem Balken aus
          }
          else if (p.action && p.id !== view.pid) ring(ctx, sx, sy - 44, 6, p.action.progress || 0, PAL.mint);
          if (zone === 'away' && away.kuppelUntil && st.time < away.kuppelUntil) {
            ctx.strokeStyle = 'rgba(127,224,194,' + (0.45 + 0.2 * Math.sin(t * 6)) + ')';
            ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, sy - 16, 16, 24, 0, 0, Math.PI * 2); ctx.stroke();
          }
        }
      } catch (e) { report('Render.drawable:' + d.type, e); }
    }

    // M3a: Seitenmarke + Zustand über jeder Station (Ort vor Zahl)
    for (const pl of plates) {
      try { stationPlate(ctx, pl.tx * TILE + 16 - camX, pl.ty * TILE - 20 - camY, pl.side, pl.state, pl.fragile); } catch (e) { report('Render.stationPlate', e); }
      // M3b §4: Eskalations-Countdown über der Station („brennt in 12 s“)
      const esc = ((st.ship && st.ship.escalate) || {})[pl.system];
      if (esc != null) {
        try {
          const s = Math.ceil(+esc || 0), hot = s <= 5;
          const lab = 'brennt in ' + s + ' s';
          const ex = pl.tx * TILE + 16 - camX; let ey = pl.ty * TILE - 32 - camY;
          const lw = measure(lab, 1) + 6;
          // QA M3b: überlappt ein Fortschrittsbalken (Spieler an der Nachbarstation), das Label darüber setzen
          for (let k = 0; k < 3; k++) {
            const hit = barRects.find((b) => ex - lw / 2 < b.x + b.w && ex + lw / 2 > b.x && ey - 1 < b.y + b.h && ey + 10 > b.y);
            if (!hit) break;
            ey = hit.y - 13;
          }
          backdrop(ctx, Math.round(ex - lw / 2), ey - 1, lw, 11, 0.8);
          text(ctx, lab, ex, ey, { color: hot && Math.floor(t * 4) % 2 ? '#FFFFFF' : hot ? '#FF5A4A' : '#F08A3C', align: 'center', shadow: false });
        } catch (e) { report('Render.escalate', e); }
      }
    }

    // M2: Nebel, Geister, Ziellinien, Medi-Kreuze, Captain-Befehle, Deckungs-Pips
    if (v2) {
      try {
        if (fogSet) drawFog(ctx, fogSet, tx0, ty0, tx1, ty1, camX, camY);
        try { drawWurfZiel(ctx, view, (x, y) => ({ x: x - camX, y: y - camY })); } catch (e) { report('Render.wurfZiel', e); }   // B2-NACH
        const ghostTtl = cfgNum('ghostTime', 3);
        for (const e of view.drones || []) {
          if (e.alive === false || e.vis || !e.ghost) continue;
          drawGhost(ctx, e.ghost.x - camX, e.ghost.y - camY, e.kind, Math.max(0, (st.time || 0) - (+e.ghost.t || 0)), ghostTtl);
        }
        for (const e of view.drones || []) {
          if (e.alive === false || !e.vis || !e.aim) continue;
          const p = clamp01(e.aim.p);
          const mzx = e.x - camX, mzy = e.y - camY - (e.kind === 'warden' ? 24 : 14);
          const tp = (view.players || []).find(q => q.id === e.aim.target && q.zone === 'away');
          if (tp) {
            const tx2 = tp.x - camX, ty2 = tp.y - camY - 14;
            ctx.save();
            ctx.strokeStyle = 'rgba(224,71,60,' + (0.3 + 0.65 * p) + ')'; ctx.lineWidth = 1 + p * 2.5;
            if (p < 0.35) ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(mzx, mzy); ctx.lineTo(tx2, ty2); ctx.stroke();
            ctx.restore();
            if (p > 0.6) { ctx.strokeStyle = 'rgba(224,71,60,' + p + ')'; ctx.beginPath(); ctx.arc(tx2, ty2, 10 - p * 4, 0, Math.PI * 2); ctx.stroke(); }
          }
          drawFx(ctx, 'muzzle_aim', mzx, mzy, t, { p });
        }
        for (const p of view.players || []) {
          if (p.zone !== 'away' || !p.downed || p.connected === false) continue;
          drawMediCross(ctx, Math.round(p.x - camX), Math.round(p.y - camY - 36), t);
        }
        for (const o of activeOrders(st)) {
          const op = orderPos(o, view.drones);
          const ox = op.x - camX, oy = op.y - camY;
          const col = ORDER_COL[o.kind];
          drawFx(ctx, 'order_pillar', ox, oy, t, { kind: o.kind, color: col, height: 120 });
          const left = o.until != null && st.time != null ? Math.max(0, Math.ceil(o.until - st.time)) : null;
          text(ctx, ORDER_NAMES[o.kind].toUpperCase() + (left != null ? ' ' + left + ' s' : ''), ox, Math.max(12, oy - 132), { color: col, align: 'center' });
          if (o.kind === 'fokus') {
            const fe = (view.drones || []).find(d => d.id === o.target);
            const big = fe && fe.kind === 'warden';
            const bw = big ? 72 : 25, bh = big ? 66 : 37;
            ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([4, 2]);
            ctx.strokeRect(Math.round(ox - bw / 2) + 0.5, Math.round(oy - bh + 3) + 0.5, bw, bh); ctx.setLineDash([]);
          }
        }
        const mine = (view.players || []).find(p => p.id === view.pid);
        if (mine && mine.zone === 'away' && !mine.downed && isKesh) drawCoverPips(ctx, map, st, mine.x, mine.y, camX, camY, t, !!mine.cr);
      } catch (e) { report('Render.v2overlay', e); }
    }

    // Plattform: Drohnen durch Wände (Sensor), Marker, Orbitalschläge
    if (zone === 'away') {
      const sensorOn = away.sensorUntil && st.time < away.sensorUntil;
      if (sensorOn) for (const d of view.drones || []) {
        if (d.alive === false) continue;
        ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(d.x - camX) - 9.5, Math.round(d.y - camY) - 24.5, 19, 21);
      }
      if (away.marker) {
        const mx = away.marker.x - camX, my = away.marker.y - camY;
        ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1;
        const r = 10 + Math.sin(t * 5) * 2;
        ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = PAL.amber; ctx.fillRect(mx - 1, my - r - 4, 2, 6); ctx.fillRect(mx - 1, my + r - 2, 2, 6); ctx.fillRect(mx - r - 4, my - 1, 6, 2); ctx.fillRect(mx + r - 2, my - 1, 6, 2);
      }
      for (const s of away.strikes || []) {
        const age = st.time - (s.t || st.time);
        const p = Math.max(0, Math.min(1, age / 1.5));
        ctx.strokeStyle = 'rgba(255,198,107,0.9)'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(s.x - camX, s.y - camY, 80 * (1 - p * 0.3), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      // M1: Plan-Pins vom Planungstisch für diese Außenkarte
      const mid = awayMapId(st);
      for (const pin of (st.plan && st.plan.pins) || []) {
        if (pin.map !== mid) continue;
        drawPin(ctx, pin, pin.x - camX, pin.y - camY, st, { world: true });
      }
    }

    // Transiente Effekte
    const now = performance.now() / 1000;
    for (const f of liveFx(now)) {
      if (f.space || f.zone !== zone) continue;
      const p = (now - f.t0) / f.dur;
      drawFx(ctx, f.kind, f.x - camX, f.y - camY, t, { p });
    }

    if (view.debug) {
      ctx.strokeStyle = '#FF00FF'; ctx.lineWidth = 1;
      const hb = (CFG.player && CFG.player.hitbox) || { w: 18, h: 12 };
      for (const p of view.players || []) if (p.zone === zone) ctx.strokeRect(Math.round(p.x - hb.w / 2 - camX) + 0.5, Math.round(p.y - hb.h / 2 - camY) + 0.5, hb.w, hb.h);
      if (view.interaction) { ctx.strokeStyle = PAL.amber; ctx.strokeRect(view.interaction.tx * TILE - camX + 0.5, view.interaction.ty * TILE - camY + 0.5, TILE - 1, TILE - 1); }
      // M2: über jedem Gegner Rolle, Segmente, Zielfortschritt (auch unsichtbare, gestrichelt)
      if (zone === 'away' && isV2(st)) for (const e of view.drones || []) {
        if (e.alive === false) continue;
        const ex = Math.round(e.x - camX), ey = Math.round(e.y - camY);
        const sh = Array.isArray(e.sh) ? e.sh[0] + '/' + e.sh[1] : '-';
        const line = (e.kind === 'warden' ? 'W ' : '') + (e.role || (e.asleep ? 'schläft' : '-')) + ' · ' + sh + (e.aim ? ' · Ziel ' + Math.round(clamp01(e.aim.p) * 100) + '%' : '') + (e.vis ? '' : ' · unsichtbar');
        const w = measure(line, 1) + 6;
        backdrop(ctx, ex - w / 2, ey - 56, w, 10, 0.7);
        text(ctx, line, ex, ey - 55, { color: '#FF66CC', align: 'center', shadow: false });
        if (!e.vis) { ctx.setLineDash([2, 2]); ctx.strokeStyle = '#FF66CC'; ctx.strokeRect(ex - 9.5, ey - 26.5, 19, 27); ctx.setLineDash([]); }
      }
    }

    const ov = { alert: zone === 'ship' ? alert : 'normal', time: t, dim: 0, wreck: isWreck, kesh: isKesh };
    if (zone === 'ship') {
      ov.rooms = (Maps.BEDS || []).filter(b => b.room).map(b => ({
        x0: b.room.x0 * TILE - camX, y0: (b.room.y0 - 1) * TILE - camY, x1: (b.room.x1 + 1) * TILE - camX, y1: (b.room.y1 + 1) * TILE - camY,
        light: roomStyleOf(st, b.room.id).light, id: b.room.id,
      }));
      if (!artHasRoomLight()) for (const r of ov.rooms) {
        ctx.fillStyle = ROOM_LIGHT_COL[r.light] || ROOM_LIGHT_COL.warm;
        ctx.fillRect(r.x0, r.y0 + TILE, r.x1 - r.x0, r.y1 - r.y0 - TILE);
      }
    }
    if (zone === 'away' && v2) { try { drawKoerperStatus(ctx, view, (x, y, hpx) => ({ x: Math.round(x - camX), y: Math.round(y - camY - (hpx || 0)) }), fogSet); } catch (e) { report('Render.koerper', e); } }   // B2
    if (isWreck && !artOk('drawOverlay')) { ctx.fillStyle = 'rgba(5,7,14,0.35)'; ctx.fillRect(0, 0, VW, VH); }
    if (!art('drawOverlay', null, [ctx, VW, VH, ov])) {
      if (ov.alert === 'red') {
        ctx.fillStyle = 'rgba(11,14,26,0.25)'; ctx.fillRect(0, 0, VW, VH);
        ctx.fillStyle = 'rgba(224,71,60,' + (0.06 + 0.06 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2))) + ')'; ctx.fillRect(0, 0, VW, VH);
      } else if (ov.alert === 'yellow') {
        ctx.fillStyle = 'rgba(242,201,76,' + (0.04 + 0.04 * (0.5 + 0.5 * Math.sin(t * Math.PI))) + ')'; ctx.fillRect(0, 0, VW, VH);
      }
    }
  }

  // ------------------------------------------------------------------ B2: Körperzustände und Wunden über Figuren
  // Snapshot players[]/away.drones[]: zs (ok|verwundet|bewusstlos|gefesselt|gefangen|aus), bt (betäubt), wn/wm (Wunden, Gegner).
  // Status-Icons aus IconsB.status (UI-ART); keine Rollensymbole (E25). P(x, y, hpx) -> Bildschirmpunkt (2D oder 3D-Overlay).
  const ZS_FARBE = { bewusstlos: '#6FB8FF', gefesselt: '#C9974A', gefangen: '#E0473C', verwundet: '#E0473C', betaeubt: '#6FB8FF' };
  function statusIcon(ctx, id, x, y) {
    const IB = window.IconsB;
    if (IB && typeof IB.draw === 'function' && IB.has && IB.has('status', id) && IB.draw(ctx, 'status', id, x, y, {}) !== false) return;
    ctx.fillStyle = ZS_FARBE[id] || PAL.star; ctx.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
  }
  function drawKoerperStatus(ctx, view, P, fogSet) {
    const inV = (s) => s && !s.behind && s.x > -20 && s.y > -20 && s.x < VW + 20 && s.y < VH + 20;
    for (const e of view.drones || []) {
      if (fogSet && !enemyShown(e, fogSet)) continue;
      const zs = e.zs, liegt = zs && zs !== 'ok' && zs !== 'aus';
      const id = e.bt ? 'betaeubt' : liegt ? zs : null;
      const s = P(e.x, e.y, liegt ? 18 : 44);
      if (!inV(s)) continue;
      if (id) statusIcon(ctx, id, s.x, s.y);
      // Wunden-Pips nur bei mehr als einer Wunde (Enterer 2, Wächter 2) und solange er steht
      if (!liegt && +e.wm > 1 && window.IconsB && typeof IconsB.wundenPips === 'function') {
        const n = Math.max(0, +e.wn || 0), m = +e.wm;
        IconsB.wundenPips(ctx, Math.round(s.x - (m * 8) / 2), Math.round(s.y + (id ? 8 : 0)), n, m, 6, 2);
      }
    }
    for (const p of view.players || []) {
      if (p.zone !== 'away' || p.connected === false) continue;
      const id = p.bt ? 'betaeubt' : (p.zs && p.zs !== 'ok' && p.zs !== 'verwundet') ? p.zs : null;   // verwundet zeigt der Ausblut-Ring
      if (!id) continue;
      const s = P(p.x, p.y, 52);
      if (inV(s)) statusIcon(ctx, id, s.x, s.y);
    }
  }

  // ------------------------------------------------------------------ M4: Overlay über der 3D-Welt
  // Im Voxel-Modus zeichnet 3D Kacheln, Objekte, Figuren und Effekte. Hier nur punktförmige Hinweise, positioniert über
  // VoxelRender.worldToScreen(px, py, Höhe in m): Zustandsmarken, Balken, Namen, Deckungs-Pips, „zuletzt gesehen“,
  // Ziellinien, Captain-Befehle/Marker, Plan-Pins. 2D-Pixelversätze nach oben werden in Meter umgerechnet (OV_M je px).
  const overlay3d = { on: false };
  const OV_M = 1 / 22;
  function vr() { return window.VoxelRender; }
  function drawWorldOverlay(ctx, view) {
    const st = view.state;
    const zone = view.self.zone;
    const map = mapFor(zone, st);
    const isKesh = map.id === 'kesh';
    const v2 = zone === 'away' && isV2(st);
    const t = view.time;
    const away = st.away || {};
    const VR = vr();
    updateCamera(view);   // 2D-Kamera weiter nachführen (HUD-Randpfeile, Audio-Panorama)
    const P = (x, y, hpx) => VR.worldToScreen(x, y, (hpx || 0) * OV_M);
    const deck = zone === 'ship' && VR.shownDeck ? VR.shownDeck() : 0;
    const deckOfPy = (py) => (Maps.deckOfPx ? Maps.deckOfPx(py) : Maps.deckOf ? Maps.deckOf(Math.floor(py / TILE)) : 0);
    const here = (py) => zone !== 'ship' || deckOfPy(py) === deck;
    const inView = (s) => s.x > -60 && s.y > -60 && s.x < VW + 60 && s.y < VH + 60 && !s.behind;
    const fogSet = v2 ? teamVision(view, map, st) : null;
    const barRects = [];
    const guard = (label, fn) => { try { fn(); } catch (e) { report('Render.overlay:' + label, e); } };

    // Bots (Fortschrittsring), NPCs (Namen)
    if (zone === 'ship') guard('bots', () => {
      for (const b of view.bots || []) {
        if (!here(b.y) || !(b.task && b.progress > 0)) continue;
        const s = P(b.x, b.y, 28); if (!inView(s)) continue;
        const sba = setbackAgeFor(view, 'bot', b.id, b.task.system);
        ring(ctx, s.x, s.y, 5, b.progress, sba != null ? '#FF5A4A' : PAL.brass);
        if (sba != null) text(ctx, '−' + Math.round(cfgM3b('repairHitLoss', 0.5) * 100) + ' %', s.x, s.y - 16, { color: '#FF5A4A', align: 'center' });
      }
      for (const n of view.shipNpcs || (st.ship && st.ship.npcs) || []) {
        if (!here(n.y)) continue;
        const s = P(n.x, n.y, 48); if (inView(s)) text(ctx, n.id === 'ivo' ? 'Ivo' : String(n.name || n.id || ''), s.x, s.y, { color: PAL.ice, align: 'center' });
      }
    });
    if (zone === 'away') guard('npc', () => {
      const n = view.npc;
      if (n && n.present !== false && !n.rescued && !isKesh) {
        const s = P(n.x, n.y, 48);
        text(ctx, n.injured ? 'Techniker (verletzt)' : n.following ? 'Techniker (folgt)' : 'Techniker', s.x, s.y, { color: n.injured ? PAL.warn : PAL.ice, align: 'center' });
      }
      for (const e of view.drones || []) {
        if (e.alive === false) continue;
        if (v2 && !enemyShown(e, fogSet)) continue;
        const dk = e.kind || (map.id === 'wreck' ? 'scavenger' : undefined);
        if (dk === 'warden') { const s = P(e.x, e.y, 62); text(ctx, e.asleep ? 'WÄCHTER (schläft)' : 'WÄCHTER', s.x, s.y, { color: e.asleep ? PAL.panelLight : KESH_VIOLET, align: 'center' }); }
        else if (dk === 'scavenger') { const cr = v2 && !!e.cr; const s = P(e.x, e.y, cr ? 28 : 36); text(ctx, cr ? 'PLÜNDERER (geduckt)' : 'PLÜNDERER', s.x, s.y, { color: PAL.rust, align: 'center' }); }
      }
    });

    if (zone === 'away' && v2) guard('koerper', () => drawKoerperStatus(ctx, view, P, fogSet));   // B2: Zustände, Wunden
    // Spieler: Namen, Verwundet, Fortschrittsbalken
    guard('players', () => {
      for (const p of view.players || []) {
        if (p.zone !== zone || p.connected === false) continue;
        if (!here(p.y)) {
          // QA M4: Mitspieler auf dem anderen Deck – Randmarke ▲ (Deck darüber) / ▼ (darunter) mit Namen, x wie auf dem eigenen Deck
          if (zone === 'ship' && p.id !== view.pid) {
            const dOther = deckOfPy(p.y), decks = Maps.SHIP_DECKS || [];
            const dkO = decks.find((q) => q.level === dOther), dkC = decks.find((q) => q.level === deck);
            if (dkO && dkC) {
              // x zwischen den HUD-Spalten (links Ziele, rechts Systeme/Minikarte) halten
              const sx = Math.max(150, Math.min(VW - 150, P(p.x, p.y - (dkO.y0 - dkC.y0) * TILE, 0).x));
              const up = dOther < deck, col = PAL.players[p.color || 0];
              const yy = up ? 14 : VH - 56;
              ctx.fillStyle = col; ctx.beginPath();
              if (up) { ctx.moveTo(sx, yy - 6); ctx.lineTo(sx - 5, yy); ctx.lineTo(sx + 5, yy); } else { ctx.moveTo(sx, yy + 6); ctx.lineTo(sx - 5, yy); ctx.lineTo(sx + 5, yy); }
              ctx.closePath(); ctx.fill();
              text(ctx, String(p.name || '').slice(0, 8), sx, up ? yy + 3 : yy - 11, { color: col, align: 'center' });
            }
          }
          continue;
        }
        const crouch = !!(v2 && Array.isArray(p.sh) && p.cr && !p.downed);
        const feet = P(p.x, p.y, 0);
        if (!inView(feet)) continue;
        if (v2 && p.downed && Array.isArray(p.sh)) {
          const frac = p.bleed != null ? clamp01(p.bleed / cfgNum('wounded.bleedout', 45)) : 1;
          ctx.strokeStyle = 'rgba(224,71,60,' + (0.55 + 0.35 * Math.sin(t * 6)) + ')'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(feet.x, feet.y, 6 + 16 * frac, 3 + 7 * frac, 0, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
        }
        if (p.id !== view.pid) {
          const col = PAL.players[p.color || 0];
          const nm = String(p.name || '').slice(0, 12);
          const w = measure(nm, 1) + 14;
          const s = P(p.x, p.y, crouch ? 40 : 52);
          backdrop(ctx, Math.round(s.x - w / 2), Math.round(s.y), w, 10, 0.55);
          shape(ctx, SHAPES[p.color || 0], s.x - w / 2 + 6, s.y + 5, 6, col);
          text(ctx, nm, s.x - w / 2 + 11, s.y + 1, { color: col, shadow: false });
        }
        if (p.downed) { const s = P(p.x, p.y, 24); text(ctx, Array.isArray(p.sh) ? 'VERWUNDET' + (p.bleed != null ? ' ' + Math.max(0, Math.ceil(p.bleed)) + ' s' : '') : 'AUSSER GEFECHT', s.x, s.y, { color: PAL.red, align: 'center' }); }
        if (p.action && (p.action.kind === 'flick' || p.action.kind === 'swap' || p.action.kind === 'minigame')) {
          const s = P(p.x, p.y, 50); s.y -= 26;   // QA M4: Balken ganz über den Kopf, sonst verdeckt „FLICKEN …“ das Gesicht
          actionBar(ctx, s.x, s.y, p.action, p.id === view.pid, setbackAgeFor(view, 'player', p.id, p.action.system));
          barRects.push({ x: s.x - 30, y: s.y - 2, w: 60, h: 19 });
        } else if (p.action && p.id !== view.pid) { const s = P(p.x, p.y, 44); ring(ctx, s.x, s.y, 6, p.action.progress || 0, PAL.mint); }
        if (p.lift && p.id !== view.pid) { const s = P(p.x, p.y, 30); text(ctx, 'LIFT', s.x, s.y, { color: PAL.ice, align: 'center' }); }
      }
    });

    // Stationen: Seitenmarke + Zustand, Eskalations-Countdown
    if (zone === 'ship' && st.ship) guard('plates', () => {
      for (const s0 of shipStations()) {
        if (!here(s0.y * TILE + 16)) continue;
        const s = P(s0.x * TILE + 16, s0.y * TILE + 16, 50);
        if (!inView(s)) continue;
        const state = sysState(st, s0.system), fragile = fragileOf(st, s0.system);
        stationPlate(ctx, s.x, Math.round(s.y), s0.side, state, fragile);
        const esc = (st.ship.escalate || {})[s0.system];
        if (esc != null) {
          const sec = Math.ceil(+esc || 0), hot = sec <= 5;
          const lab = 'brennt in ' + sec + ' s';
          let ey = Math.round(s.y) - 12;
          const lw = measure(lab, 1) + 6;
          for (let k = 0; k < 3; k++) {
            const hit = barRects.find((b) => s.x - lw / 2 < b.x + b.w && s.x + lw / 2 > b.x && ey - 1 < b.y + b.h && ey + 10 > b.y);
            if (!hit) break;
            ey = hit.y - 13;
          }
          backdrop(ctx, Math.round(s.x - lw / 2), ey - 1, lw, 11, 0.8);
          text(ctx, lab, s.x, ey, { color: hot && Math.floor(t * 4) % 2 ? '#FFFFFF' : hot ? '#FF5A4A' : '#F08A3C', align: 'center', shadow: false });
        }
      }
    });

    // M2: „zuletzt gesehen“, Ziellinien, Medi-Kreuze, Captain-Befehle, Deckungs-Pips
    if (v2) guard('wurfZiel', () => drawWurfZiel(ctx, view, (x, y) => P(x, y, 0)));   // B2-NACH: Bodenmarke Landepunkt
    if (v2) guard('v2', () => {
      const ghostTtl = cfgNum('ghostTime', 3);
      for (const e of view.drones || []) {
        if (e.alive === false || e.vis || !e.ghost) continue;
        const s = P(e.ghost.x, e.ghost.y, 0);
        drawGhost(ctx, s.x, s.y, e.kind, Math.max(0, (st.time || 0) - (+e.ghost.t || 0)), ghostTtl);
      }
      for (const e of view.drones || []) {
        if (e.alive === false || !e.vis || !e.aim) continue;
        const p = clamp01(e.aim.p);
        const tp = (view.players || []).find(q => q.id === e.aim.target && q.zone === 'away');
        if (!tp) continue;
        const a = P(e.x, e.y, e.kind === 'warden' ? 24 : 14), b = P(tp.x, tp.y, 14);
        ctx.save();
        ctx.strokeStyle = 'rgba(224,71,60,' + (0.3 + 0.65 * p) + ')'; ctx.lineWidth = 1 + p * 2.5;
        if (p < 0.35) ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.restore();
        if (p > 0.6) { ctx.strokeStyle = 'rgba(224,71,60,' + p + ')'; ctx.beginPath(); ctx.arc(b.x, b.y, 10 - p * 4, 0, Math.PI * 2); ctx.stroke(); }
      }
      for (const p of view.players || []) {
        if (p.zone !== 'away' || !p.downed || p.connected === false) continue;
        const s = P(p.x, p.y, 36); drawMediCross(ctx, Math.round(s.x), Math.round(s.y), t);
      }
      for (const o of activeOrders(st)) {
        const op = orderPos(o, view.drones);
        const col = ORDER_COL[o.kind];
        const left = o.until != null && st.time != null ? Math.max(0, Math.ceil(o.until - st.time)) : null;
        const s = P(op.x, op.y, 132);
        text(ctx, ORDER_NAMES[o.kind].toUpperCase() + (left != null ? ' ' + left + ' s' : ''), s.x, Math.max(12, s.y), { color: col, align: 'center' });
        if (o.kind === 'fokus') {
          const fe = (view.drones || []).find(d => d.id === o.target);
          const big = fe && fe.kind === 'warden';
          const lo = P(op.x, op.y, 0), hi = P(op.x, op.y, big ? 66 : 37);
          const bw = (big ? 72 : 25) * (VR.pxPerMeter ? VR.pxPerMeter() / 32 : 1), bh = Math.max(8, lo.y - hi.y);
          ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([4, 2]);
          ctx.strokeRect(Math.round(lo.x - bw / 2) + 0.5, Math.round(hi.y) + 0.5, Math.round(bw), Math.round(bh)); ctx.setLineDash([]);
        }
      }
      const mine = (view.players || []).find(p => p.id === view.pid);
      if (mine && mine.zone === 'away' && !mine.downed && isKesh) drawCoverPips3d(ctx, map, st, mine.x, mine.y, t, !!mine.cr, P);
    });

    // Plattform/Außen: Sensor-Rahmen, Marker, Orbitalschläge, Plan-Pins
    if (zone === 'away') guard('away', () => {
      const ppm = VR.pxPerMeter ? VR.pxPerMeter() : 32;
      const sensorOn = away.sensorUntil && st.time < away.sensorUntil;
      if (sensorOn) for (const d of view.drones || []) {
        if (d.alive === false) continue;
        const lo = P(d.x, d.y, 0), hi = P(d.x, d.y, 24);
        ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(lo.x) - 9.5, Math.round(hi.y) + 0.5, 19, Math.max(8, Math.round(lo.y - hi.y)));
      }
      if (away.marker) {
        const s = P(away.marker.x, away.marker.y, 0);
        ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1;
        const r = 10 + Math.sin(t * 5) * 2;
        ctx.beginPath(); ctx.ellipse(s.x, s.y, r, r * 0.84, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = PAL.amber; ctx.fillRect(s.x - 1, s.y - r - 4, 2, 6); ctx.fillRect(s.x - 1, s.y + r - 2, 2, 6); ctx.fillRect(s.x - r - 4, s.y - 1, 6, 2); ctx.fillRect(s.x + r - 2, s.y - 1, 6, 2);
      }
      for (const sk of away.strikes || []) {
        const age = st.time - (sk.t || st.time);
        const p = Math.max(0, Math.min(1, age / 1.5));
        const s = P(sk.x, sk.y, 0), rr = 80 / TILE * ppm * (1 - p * 0.3);
        ctx.strokeStyle = 'rgba(255,198,107,0.9)'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.ellipse(s.x, s.y, rr, rr * 0.84, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      const mid = awayMapId(st);
      for (const pin of (st.plan && st.plan.pins) || []) {
        if (pin.map !== mid) continue;
        const s = P(pin.x, pin.y, 0);
        drawPin(ctx, pin, s.x, s.y, st, { world: true });
      }
    });

    if (view.debug) guard('debug', () => {
      if (view.interaction) {
        const ia = view.interaction, c = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([dx, dy]) => P((ia.tx + dx) * TILE, (ia.ty + dy) * TILE, 0));
        ctx.strokeStyle = PAL.amber; ctx.beginPath(); c.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
      }
      if (zone === 'away' && v2) for (const e of view.drones || []) {
        if (e.alive === false) continue;
        const s = P(e.x, e.y, 56);
        const sh = Array.isArray(e.sh) ? e.sh[0] + '/' + e.sh[1] : '-';
        const line = (e.kind === 'warden' ? 'W ' : '') + (e.role || (e.asleep ? 'schläft' : '-')) + ' · ' + sh + (e.aim ? ' · Ziel ' + Math.round(clamp01(e.aim.p) * 100) + '%' : '') + (e.vis ? '' : ' · unsichtbar');
        const w = measure(line, 1) + 6;
        backdrop(ctx, s.x - w / 2, s.y, w, 10, 0.7);
        text(ctx, line, s.x, s.y + 1, { color: '#FF66CC', align: 'center', shadow: false });
      }
    });
  }
  // Deckungs-Pips (3D): Kachelrahmen als projiziertes Viereck, Pip über halber (0,95 m) bzw. voller Deckung (2,3 m)
  function drawCoverPips3d(ctx, map, st, px, py, t, crouched, P) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    const solid = solidFn(map, st);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const cx = tx + dx, cy = ty + dy;
      const ch = map.at(cx, cy);
      if (!OBJ_KESH[ch] || !solid(cx, cy)) continue;
      const info = map.info(cx, cy);
      const cover0 = info.cover || 0;
      if (!cover0) continue;
      const ducked = !!(crouched && info.low);
      const cover = ducked ? 2 : cover0;
      const c = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([ax, ay]) => P((cx + ax) * TILE, (cy + ay) * TILE, 0));
      ctx.strokeStyle = 'rgba(127,243,255,' + (0.35 + 0.15 * Math.sin(t * 4)) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); c.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
      const pip = P(cx * TILE + 16, cy * TILE + 16, (cover0 >= 2 ? 2.3 : 0.95) / OV_M);
      const sx = Math.round(pip.x), sy = Math.round(pip.y) - 3;
      ctx.fillStyle = 'rgba(11,14,26,0.75)'; ctx.beginPath(); ctx.arc(sx, sy + 3, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = SHIELD_COL; ctx.beginPath(); ctx.arc(sx, sy + 3, 3.5, 0, Math.PI * 2);
      if (cover >= 2) { ctx.fillStyle = SHIELD_COL; ctx.fill(); } else ctx.stroke();
      if (ducked) {
        ctx.strokeStyle = 'rgba(244,238,220,' + (0.55 + 0.35 * Math.sin(t * 5)) + ')';
        ctx.beginPath(); ctx.arc(sx, sy + 3, 7, 0, Math.PI * 2); ctx.stroke();
      } else if (info.low && !crouched) {
        text(ctx, 'C', sx + 8, sy - 1, { color: SHIELD_COL, shadow: true });
      }
    }
  }

  // ------------------------------------------------------------------ Orte, Gegner, Marker (M1)
  // Fallback, solange der Server kein snap.world schickt (Inhalt laut CONTRACT-M1 §9.1).
  const LOC_FALLBACK = [
    { id: 'hafen', name: 'Hafen Lichtkordon', kind: 'port', x: 100, y: 300, links: ['splitter', 'vaelen'], known: true },
    { id: 'splitter', name: 'Splittergürtel', kind: 'asteroids', x: 260, y: 220, links: ['hafen', 'b7', 'wrack'], known: true },
    { id: 'b7', name: 'Boje B-7', kind: 'buoy', x: 420, y: 150, links: ['splitter', 'nebel'] },
    { id: 'vaelen', name: 'Vaelen-Karawane', kind: 'trader', x: 230, y: 430, links: ['hafen', 'nebel'] },
    { id: 'wrack', name: 'Wrack „Zaunkönig“', kind: 'wreck', x: 400, y: 330, links: ['splitter', 'nebel'] },
    { id: 'nebel', name: 'Graue Weite', kind: 'nebula', x: 570, y: 280, links: ['b7', 'vaelen', 'wrack'], fog: true },
    { id: 'relais', name: 'Kustoden-Relais', kind: 'relay', x: 730, y: 230, links: [] },
  ];
  const SCENE_TO_LOC = { port: 'hafen', route: 'splitter', buoy: 'b7' };
  const LOC_KIND_NAMES = { port: 'Hafen', asteroids: 'Asteroidenfeld', buoy: 'Boje', trader: 'Händlerkarawane', wreck: 'Wrack', nebula: 'Nebel', relay: 'Kustoden-Relais', moon: 'Mond' };
  const STAR_DOMAIN = { x0: 40, y0: 90, x1: 800, y1: 480 };   // Koordinatenraum der Sternkarte (auch für Plan-Pins map 'star')
  function worldOf(st) {
    const w = st && st.world;
    if (w && Array.isArray(w.locations) && w.locations.length) return w;
    const sh = (st && st.ship) || {};
    const loc = (w && w.location) || SCENE_TO_LOC[sh.scene] || sh.scene || 'hafen';
    const SL = window.Shared_Locations;
    const base = SL && Array.isArray(SL.LOCATIONS) ? SL.LOCATIONS.map(l => ({ id: l.id, name: l.name, kind: l.kind, x: l.x, y: l.y, links: (l.links || []).filter(b => !(SL.lockedKey && SL.lockedKey(l.id, b))), fog: !!l.fog, desc: l.desc, known: (SL.KNOWN_AT_START || []).indexOf(l.id) >= 0 })) : LOC_FALLBACK;
    const locs = base.map(l => Object.assign({}, l, { known: !!l.known || l.id === loc, visited: l.id === loc, discoveries: { found: 0, total: 0 } }));
    const known = {}; for (const l of locs) if (l.known) known[l.id] = 1;
    for (const l of locs) if (!l.known) l.unknown = locs.some(k => k.known && (k.links || []).indexOf(l.id) >= 0);
    return { location: loc, locations: locs, fallback: true };
  }
  function locById(st, id) { return worldOf(st).locations.find(l => l.id === id) || null; }
  function locVisible(l) { return !!(l && (l.known || l.unknown)); }
  function locName(st, id) {
    if (!id) return '—';
    if (typeof id === 'string' && /^leer-\d{4}$/.test(id)) return 'Leerraum ' + id.slice(5);   // B3: Leerraum-Hex
    const l = locById(st, id);
    if (!l) { const f = LOC_FALLBACK.find(x => x.id === id); return f ? f.name : String(id); }
    if (!l.known) return 'Unbekanntes Signal';
    return l.name || id;
  }
  function currentLoc(st) { return locById(st, worldOf(st).location); }
  function inFog(st) { const l = currentLoc(st); return !!(l && (l.fog || l.kind === 'nebula')); }

  const ENEMY_NAMES = { raider: 'Jäger', gunboat: 'Kanonenboot', sentinel: 'Kustoden-Wächter', pylon: 'Pylon', relay: 'Störrelais', scavenger: 'Plünderer' };
  const ENEMY_SIZE = { raider: 16, gunboat: 34, relay: 10, sentinel: 22, pylon: 18 };
  const MARKER_COL = { captain: PAL.mint, tactical: PAL.amber };
  const MARKER_NAMES = { captain: 'CAPTAIN', tactical: 'TAKTIK' };
  const HIDDEN_NAMES = { cache: 'VERSTECK', beacon: 'LEITBAKE', lore: 'LORE-BAKE', hollow: 'HOHLRAUM' };
  const STATION_ART = { station: 'port', buoy: 'buoy', vaelen: 'vaelen', wreck: 'wreck', relay: 'relay', moon: 'moon' };
  const STATION_LABEL = { station: 'HAFEN', buoy: 'BOJE B-7', vaelen: 'VAELEN-KARAWANE', wreck: 'WRACK', relay: 'KUSTODEN-RELAIS', moon: 'MOND KESH' };
  // Kurzformen für Randpfeile und Kartenlabels (QA M1: weniger Überlappung)
  const STATION_SHORT = { station: 'HAFEN', buoy: 'B-7', vaelen: 'VAELEN', wreck: 'WRACK', relay: 'RELAIS', moon: 'KESH' };
  const ENEMY_SHORT = { sentinel: 'WÄCHTER', gunboat: 'KANONENBOOT' };
  const MOUNT_LABEL = { phase_l: 'PHASE L', phase_r: 'PHASE R', lanze: 'LANZE', bolzen: 'BOLZEN', seitenturm: 'TURM', bow: 'LANZE', port: 'BATTERIE BB', stbd: 'BATTERIE STB' };
  // M3a: Halterung -> System (Zustand), Sektor-Kürzel
  const MOUNT_SYS = { bow: 'weapon_bow', port: 'battery_port', stbd: 'battery_stbd' };
  const SECTOR_SHORT = ['BUG', 'STB', 'HECK', 'BB'];
  function fmt1(v) { return (Math.max(0, +v || 0)).toFixed(1).replace('.', ','); }
  const DEFAULT_MOUNTS = { phase_l: { facing: -20, arc: 60, range: 560 }, phase_r: { facing: 20, arc: 60, range: 560 }, bolzen: { facing: 180, arc: 60, range: 650 }, seitenturm: { facing: 90, arc: 120, range: 450 }, lanze: { facing: 0, arc: 90, range: 520 } };
  const PIN_LABELS = ['ziel', 'gefahr', 'landeplatz', 'treffpunkt', 'frage'];
  const PIN_NAMES = { ziel: 'Ziel', gefahr: 'Gefahr', landeplatz: 'Landeplatz', treffpunkt: 'Treffpunkt', frage: 'Frage' };
  const PIN_GLYPH = { ziel: 'Z', gefahr: '!', landeplatz: 'L', treffpunkt: 'T', frage: '?' };
  function mountGeom(m) {
    const m3 = (CFG.spaceM3 && CFG.spaceM3.mounts) || {};
    const wc = m3[m.id] || (CFG.weapons && CFG.weapons[m.id]) || DEFAULT_MOUNTS[m.id] || {};
    return { facing: m.facing != null ? m.facing : (wc.facing || 0), arc: m.arc != null ? m.arc : (wc.arc || 60), range: m.range != null ? m.range : (wc.range || 400) };
  }
  function sensorRange(st) {
    const sc = CFG.sensors || {};
    const r = sc.range || 1400;
    return inFog(st) ? r * (sc.fogFactor || 0.5) : r;
  }
  // Hauptobjekt der Szene als Ziel (Server: weapons.target 'station'; Scan an B-7/Wrack legt den Decksplan auf den Tisch)
  function stationOf(space) {
    const m = ((space && space.markers) || []).find(q => q.kind !== 'dock' && STATION_ART[q.kind]);
    return m ? { id: 'station', kind: m.kind, x: m.x, y: m.y, station: true, name: STATION_LABEL[m.kind] } : null;
  }
  function markersOf(st) { const m = (st && st.ship && st.ship.markers) || {}; return { captain: m.captain || null, tactical: m.tactical || null }; }
  function pinColor(st, pin) {
    if (typeof pin.color === 'number') return PAL.players[pin.color] || PAL.star;
    if (typeof pin.color === 'string' && pin.color[0] === '#') return pin.color;
    return playerColorOf(st, pin.owner);
  }
  function playerColorOf(st, pid) { const p = ((st && st.players) || []).find(q => q.id === pid); return p ? PAL.players[p.color || 0] || PAL.star : PAL.panelLight; }

  function rayToRect(b, cx, cy, ang, inset) {
    const x0 = b.x + inset, x1 = b.x + b.w - inset, y0 = b.y + inset, y1 = b.y + b.h - inset;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let tt = Infinity;
    if (dx > 1e-6) tt = Math.min(tt, (x1 - cx) / dx); else if (dx < -1e-6) tt = Math.min(tt, (x0 - cx) / dx);
    if (dy > 1e-6) tt = Math.min(tt, (y1 - cy) / dy); else if (dy < -1e-6) tt = Math.min(tt, (y0 - cy) / dy);
    if (!isFinite(tt) || tt < 0) tt = 0;
    return { x: cx + dx * tt, y: cy + dy * tt };
  }
  function diamondMarker(ctx, x, y, col, t, label) {
    const r = 7 + Math.round(Math.sin(t * 4));
    ctx.fillStyle = 'rgba(11,14,26,0.6)';
    ctx.beginPath(); ctx.moveTo(x, y - r - 2); ctx.lineTo(x + r + 2, y); ctx.lineTo(x, y + r + 2); ctx.lineTo(x - r - 2, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = col; ctx.fillRect(x - 1, y - 1, 3, 3);
    if (label) text(ctx, label, x, y + r + 3, { color: col, align: 'center' });
  }
  function drawPin(ctx, pin, x, y, st, opts) {
    opts = opts || {};
    const col = pinColor(st, pin);
    x = Math.round(x); y = Math.round(y);
    if (!artIcon(ctx, 'pin_' + pin.label, x, y - 8, { color: col })) {
      ctx.fillStyle = PAL.space; ctx.fillRect(x - 1, y - 12, 3, 13);
      ctx.fillStyle = col; ctx.fillRect(x, y - 12, 1, 12);
      ctx.fillRect(x + 1, y - 13, 10, 8);
      text(ctx, PIN_GLYPH[pin.label] || '?', x + 6, y - 13, { color: PAL.space, align: 'center', shadow: false });
    }
    ctx.fillStyle = col; ctx.fillRect(x - 1, y - 1, 3, 3);
    if (opts.labels !== false) text(ctx, PIN_NAMES[pin.label] || pin.label, x + 14, y - 13, { color: col });
    if (opts.highlight) { ctx.strokeStyle = PAL.star; ctx.lineWidth = 1; ctx.strokeRect(x - 6.5, y - 16.5, 20, 20); }
  }

  function fbEnemy(ctx, kind, x, y, angle, t, hitT) {
    const flash = hitT < 0.15;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle || 0);
    if (kind === 'sentinel') {
      ctx.fillStyle = flash ? '#FFFFFF' : '#3A3070';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(0, -12); ctx.lineTo(-14, 0); ctx.lineTo(0, 12); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(127,224,194,' + (0.5 + 0.4 * Math.sin(t * 3)) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = PAL.mint; ctx.fillRect(-2, -2, 4, 4);
    } else if (kind === 'pylon') {
      ctx.fillStyle = flash ? '#FFFFFF' : '#4F6178'; ctx.fillRect(-9, -9, 18, 18);
      ctx.fillStyle = '#8EA3B5'; ctx.fillRect(-4, -4, 8, 8);
      ctx.fillStyle = 'rgba(169,214,229,' + (0.6 + 0.3 * Math.sin(t * 5)) + ')'; ctx.fillRect(11, -13, 3, 26);   // Schildfront am Bug
    } else {
      const size = ENEMY_SIZE[kind] || 16;
      ctx.fillStyle = flash ? '#FFFFFF' : kind === 'gunboat' ? PAL.rust : PAL.red;
      ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.7, -size * 0.6); ctx.lineTo(-size * 0.4, 0); ctx.lineTo(-size * 0.7, size * 0.6); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function fbStation(ctx, kind, t) {
    if (kind === 'vaelen') {
      ctx.fillStyle = '#5E8C4A'; ctx.beginPath(); ctx.moveTo(70, 0); ctx.lineTo(-50, -34); ctx.lineTo(-30, 0); ctx.lineTo(-50, 34); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.brass; ctx.fillRect(-20, -8, 40, 16);
      ctx.fillStyle = (Math.floor(t * 2) % 2) ? PAL.amber : PAL.mint; ctx.fillRect(-2, -38, 4, 4);
    } else if (kind === 'wreck') {
      ctx.fillStyle = '#4A4550'; ctx.beginPath(); ctx.moveTo(90, -10); ctx.lineTo(20, -40); ctx.lineTo(-80, -28); ctx.lineTo(-60, 10); ctx.lineTo(-90, 30); ctx.lineTo(40, 34); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.rust; ctx.fillRect(-30, -12, 50, 8); ctx.fillStyle = '#1E1B24'; ctx.fillRect(10, 4, 22, 14);
    } else if (kind === 'moon') {
      // M2: großer Mond mit Ruinenschimmer (Fallback: großer Kreis)
      ctx.fillStyle = '#7A7068'; ctx.beginPath(); ctx.arc(0, 0, 170, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5E564F'; ctx.beginPath(); ctx.arc(30, 20, 160, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6A615A';
      for (const [cx, cy, r] of [[-60, -50, 28], [40, 60, 22], [80, -30, 16], [-20, 90, 12], [-100, 30, 18]]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(181,124,255,' + (0.45 + 0.3 * Math.sin(t * 2)) + ')'; ctx.fillRect(-40, 10, 14, 6); ctx.fillRect(-30, 4, 4, 18);
      ctx.strokeStyle = 'rgba(244,238,220,0.25)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 170, Math.PI * 0.9, Math.PI * 1.6); ctx.stroke();
    } else if (kind === 'relay') {
      ctx.strokeStyle = 'rgba(127,224,194,' + (0.5 + 0.3 * Math.sin(t * 2)) + ')'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#3A3070'; ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(24, 0); ctx.lineTo(0, 36); ctx.lineTo(-24, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.mint; ctx.fillRect(-4, -4, 8, 8);
    } else {
      ctx.strokeStyle = PAL.brass; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 72, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = kind === 'buoy' ? PAL.mint : PAL.panelLight; ctx.fillRect(-12, -12, 24, 24);
    }
  }
  function fbHidden(ctx, kind, x, y, t) {
    const col = kind === 'beacon' ? PAL.mint : kind === 'lore' ? PAL.ice : kind === 'hollow' ? PAL.amber : PAL.brass;
    ctx.fillStyle = PAL.space; ctx.fillRect(x - 6, y - 6, 12, 12);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x - 5.5, y - 5.5, 11, 11);
    ctx.fillStyle = col;
    if (kind === 'beacon') { ctx.fillRect(x - 1, y - 4, 2, 8); if (Math.floor(t * 2) % 2) ctx.fillRect(x - 3, y - 4, 6, 2); }
    else ctx.fillRect(x - 2, y - 2, 4, 4);
  }

  // Waffenbögen / Schildsektoren eines gescannten Gegners (Bildschirmkoordinaten; rot = Bildschirmdrehung)
  function drawEnemyIntel(ctx, e, sx, sy, zoom, rot, strong, teleShown) {
    const base = (e.angle || 0) + (rot || 0);
    // M3a: Feindbögen nur, solange der Gegner (für diese Konsole sichtbar) lädt – sonst nur die Schildsektoren
    const arcsNow = !CFG.spaceM3 || (teleShown == null ? !!e.tele : !!teleShown);
    if (arcsNow && Array.isArray(e.weapons)) for (const w of e.weapons) {
      const r = Math.max(6, (w.range || 300) * zoom), a = (w.arc || 60) * Math.PI / 180, f = base + (w.facing || 0) * Math.PI / 180;
      ctx.fillStyle = strong ? 'rgba(224,71,60,0.12)' : 'rgba(224,71,60,0.035)'; ctx.strokeStyle = strong ? 'rgba(224,71,60,0.7)' : 'rgba(224,71,60,0.28)'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (a >= Math.PI * 2 - 0.01) ctx.arc(sx, sy, r, 0, Math.PI * 2);
      else { ctx.moveTo(sx, sy); ctx.arc(sx, sy, r, f - a / 2, f + a / 2); ctx.closePath(); }
      ctx.fill(); ctx.stroke();
    }
    const sh = e.shields, mx = e.shieldsMax;
    if (Array.isArray(sh)) {
      const rr = Math.round(Math.max(12, (ENEMY_SIZE[e.kind] || 16) * Math.max(0.7, zoom * 1.6)) + 4);
      for (let i = 0; i < 4; i++) {
        const mid = base + i * Math.PI / 2, a0 = mid - Math.PI / 4 + 0.14, a1 = mid + Math.PI / 4 - 0.14;
        const cur = +sh[i] || 0, max = mx ? (+mx[i] || 0) : Math.max(cur, 1);
        if (max <= 0) {
          ctx.strokeStyle = 'rgba(224,71,60,0.9)'; ctx.setLineDash([2, 2]); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(sx, sy, rr, a0, a1); ctx.stroke(); ctx.setLineDash([]);
          continue;
        }
        for (let k = 0; k < max; k++) {
          ctx.strokeStyle = k < cur ? 'rgba(169,214,229,' + (0.65 + 0.08 * k) + ')' : 'rgba(142,163,181,0.22)';
          ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, rr + k * 3, a0, a1); ctx.stroke();
        }
      }
    }
  }

  // ------------------------------------------------------------------ Raumszene (Taktik, Lage, Frontsicht)
  // Maßstab der Sprites in Weltkoordinaten: Die Lerche ist 72 px lang (Radius 36 wie auf dem Server).
  // Der Andockarm des Hafen-Sprites endet 110 px vor der Nabe; skaliert so, dass das Heck der
  // angedockten Lerche (Liegeplatz CONFIG.scenes.port.start) genau am Armende sitzt.
  const SHIP_HALF_LENGTH = 36, STATION_ARM_END = 110;
  const STATION_SPRITE_SCALE = (() => {
    const p = CFG.scenes && CFG.scenes.port;
    if (!p || !p.start || !p.station) return 1;
    return Math.max(0.5, (Math.hypot(p.start.x - p.station.x, p.start.y - p.station.y) - SHIP_HALF_LENGTH) / STATION_ARM_END);
  })();
  const MIN_SHIP_SCALE = 0.55;   // darunter wird die Lerche unlesbar

  // ---- §20.1 Nachrunde: Strahlen clientseitig nachglühen lassen + Mündungsblitz-Kette an der Flanke
  // Ursache „Seitenwaffen unsichtbar“: Ein Batterie-Strahl lebt auf dem Server nur beamTtl × 0,6 = 0,15 s und steht damit in
  // 1–2 Snapshots (15 Hz) mit eingefrorenem ttl. Art zeichnet die Bolzen über ttl/0,25 – bei ttl ≤ 0,12 ist der Bolzen schon
  // „angekommen“ (head ≥ 1) und es bleibt nur eine 1-px-Linie mit Alpha 0,05. Zudem lag der Strahlanfang unter dem Schiffssprite,
  // und Schüsse ins Leere hatten gar keinen Strahl. Jetzt: jeder Strahl wird beim Eintreffen gemerkt und lokal über eine feste
  // Dauer abgespielt (ttlMax an Art), Salven erzeugen Mündungsblitze an der Flanke, fehlende Strahlen (ins Leere) werden ergänzt.
  let lastIngested = null;
  const BEAM_LIFE = { battery: 0.45, bolzen: 0.45, lance: 0.7, enemy_heavy: 0.6, phase: 0.4 };
  const beamFx = [];     // { kind, mount, x1, y1, x2, y2, t0, dur, death, synth }
  const muzzleFx = [];   // { mount, tube, tubes, t0 }
  const salvoSeen = {};  // mountId -> letzter salvo-Wert
  let beamTubeRR = 0;
  function sideOfBeam(ship, b) {
    const rel = Phys.normAngle(Math.atan2(b.y2 - b.y1, b.x2 - b.x1) - (+ship.angle || 0));
    return rel < 0 ? 'port' : 'stbd';
  }
  function ingestSnap(st) {
    if (!st || !st.space) return;
    const now = performance.now() / 1000;
    const time = +st.time;
    const ship = st.ship || {};
    for (let i = beamFx.length - 1; i >= 0; i--) if (now - beamFx[i].t0 > Math.max(beamFx[i].dur, 1.2)) beamFx.splice(i, 1);
    for (let i = muzzleFx.length - 1; i >= 0; i--) if (now - muzzleFx[i].t0 > 0.6) muzzleFx.splice(i, 1);
    const newBat = { port: 0, stbd: 0 };
    for (const b of st.space.beams || []) {
      if (!b || !isFinite(b.x1) || !isFinite(b.x2)) continue;
      const kind = b.kind || 'lanze';
      const death = isFinite(time) ? time + (+b.ttl || 0) : null;
      const dup = beamFx.some(f => !f.synth && f.kind === kind && Math.abs(f.x1 - b.x1) < 0.5 && Math.abs(f.y1 - b.y1) < 0.5 &&
        Math.abs(f.x2 - b.x2) < 0.5 && Math.abs(f.y2 - b.y2) < 0.5 && (death == null || f.death == null || Math.abs(f.death - death) < 0.09));
      if (dup) continue;
      const mount = kind === 'battery' ? (b.mount === 'port' || b.mount === 'stbd' ? b.mount : sideOfBeam(ship, b)) : (b.mount || null);
      const own = (kind === 'battery' || kind === 'lance') && isFinite(ship.x);
      beamFx.push({ kind, mount, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, t0: now, dur: BEAM_LIFE[kind] || 0.4, death, synth: false,
        rel: own ? { x: b.x1 - ship.x, y: b.y1 - ship.y } : null });
      if (kind === 'battery') newBat[mount]++;
    }
    // Salven: Schüsse aus dem Rückgang von mounts[].salvo (zählt auch Schüsse ohne Strahl)
    for (const m of ship.mounts || []) {
      if (m.id !== 'port' && m.id !== 'stbd') continue;
      const cur = Math.max(0, +m.salvo || 0), max = Math.max(1, +m.salvoMax || 4);
      const prev = salvoSeen[m.id];
      salvoSeen[m.id] = cur;
      let shots = 0, first = 0;
      if (prev != null) {
        if (cur < prev) { shots = prev - cur; first = max - prev; }
        else if (cur > prev) { shots = max - cur; first = 0; }   // neue Salve, evtl. schon erste Schüsse
      }
      const flashes = Math.max(shots, newBat[m.id]);
      for (let k = 0; k < flashes; k++) muzzleFx.push({ mount: m.id, tube: (shots ? first + k : beamTubeRR++) % max, tubes: max, t0: now + k * 0.05 });
      // Schüsse ohne Strahl (ins Leere, älterer Server): Bolzen senkrecht zur Flanke ergänzen
      const missing = shots - newBat[m.id];
      if (missing > 0 && isFinite(ship.x)) {
        const g = mountGeom(m);
        for (let k = 0; k < missing; k++) {
          const a = (+ship.angle || 0) + (m.id === 'port' ? -Math.PI / 2 : Math.PI / 2) + (hash(Math.floor(now * 1000) + k) - 0.5) * 0.12;
          const ox = ship.x + Math.cos(a) * 16, oy = ship.y + Math.sin(a) * 16;
          beamFx.push({ kind: 'battery', mount: m.id, x1: ox, y1: oy, x2: ox + Math.cos(a) * g.range, y2: oy + Math.sin(a) * g.range, t0: now + k * 0.05, dur: BEAM_LIFE.battery, death: null, synth: true, miss: true,
            rel: { x: ox - ship.x, y: oy - ship.y } });
        }
      }
    }
    for (const m of ship.mounts || []) if ((m.id === 'port' || m.id === 'stbd') && newBat[m.id] && !(+m.salvo > 0) && salvoSeen[m.id] == null) salvoSeen[m.id] = 0;
    if (beamFx.length > 60) beamFx.splice(0, beamFx.length - 60);
    if (muzzleFx.length > 40) muzzleFx.splice(0, muzzleFx.length - 40);
    try { ingestSperrfeuer(st, now); } catch (e) { report('Render.ingestSperrfeuer', e); }
  }
  function resetBeamFx() { beamFx.length = 0; muzzleFx.length = 0; for (const k in salvoSeen) delete salvoSeen[k]; sperrSeen = null; sperrMuzzle.length = 0; }

  // ------------------------------------------------------------------ S2b: Sperrfeuer des Kanonenboots (CONTRACT-S2B §3)
  // Langsame Bernstein-Bolzen { id, kind: 'sperrfeuer', x, y, angle }. Lesbarkeit „langsam, ausweichen!“:
  // Frontsicht/Taktik = Art-Sprite (Glut + kurze Spur) und eine kurze Bahnvorschau; liegt die Lerche auf Kollisionskurs,
  // wird die Vorschau rot-orange und endet in einem Kreuz am Treffpunkt. Captain-Lage = kleine Punkte mit Mini-Spur.
  // Neue IDs erzeugen einen Mündungsblitz am Startpunkt (Breitseite des Boots). Alle Listen begrenzt.
  let sperrSeen = null;        // Set der zuletzt gesehenen Sperrfeuer-IDs (null = noch kein Snapshot → kein Blitz-Schwall)
  const sperrMuzzle = [];      // { x, y, a, t0 }
  function ingestSperrfeuer(st, now) {
    const list = (st.space && st.space.projectiles) || [];
    const ids = new Set();
    for (const pr of list) {
      if (!pr || pr.kind !== 'sperrfeuer') continue;
      ids.add(pr.id);
      if (sperrSeen && !sperrSeen.has(pr.id) && isFinite(pr.x) && isFinite(pr.y)) {
        const a = +pr.angle || 0;
        sperrMuzzle.push({ x: pr.x - Math.cos(a) * 6, y: pr.y - Math.sin(a) * 6, a, t0: now });
      }
    }
    sperrSeen = ids;
    for (let i = sperrMuzzle.length - 1; i >= 0; i--) if (now - sperrMuzzle[i].t0 > 0.5) sperrMuzzle.splice(i, 1);
    if (sperrMuzzle.length > 24) sperrMuzzle.splice(0, sperrMuzzle.length - 24);
  }
  function sperrSpeed() {
    const c = CFG.spaceS2b && CFG.spaceS2b.sperrfeuer;
    const v = c && +c.speed;
    return v > 0 ? v : 110;
  }
  function drawSperrfeuerShot(ctx, pr, s, ship, toS, rot, t, mode) {
    const a = +pr.angle || 0, ux = Math.cos(a), uy = Math.sin(a);
    if (mode === 'lage') {
      // Captain-Lage: kleiner Bernstein-Punkt, Spur 2 Punkte dahinter (Flugrichtung bleibt lesbar)
      const b = toS(pr.x - ux * 18, pr.y - uy * 18), c = toS(pr.x - ux * 36, pr.y - uy * 36);
      ctx.fillStyle = 'rgba(255,198,107,0.35)'; ctx.fillRect(c.x - 1, c.y - 1, 1, 1);
      ctx.fillStyle = 'rgba(255,198,107,0.6)'; ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
      ctx.fillStyle = 'rgba(11,14,26,0.85)'; ctx.fillRect(s.x - 2, s.y - 2, 5, 5);
      ctx.fillStyle = '#FFC66B'; ctx.fillRect(s.x - 1, s.y - 1, 3, 3);
      return;
    }
    // Bahnvorschau (0,9 s Flug); auf Kollisionskurs bis zum nächsten Punkt, rot-orange mit Kreuz
    const v = sperrSpeed();
    const rvx = ux * v - (+ship.vx || 0), rvy = uy * v - (+ship.vy || 0), rv2 = rvx * rvx + rvy * rvy;
    const dx = pr.x - (ship.x || 0), dy = pr.y - (ship.y || 0);
    let danger = false, tc = 0;
    if (rv2 > 1) {
      tc = -(dx * rvx + dy * rvy) / rv2;
      if (tc > 0 && tc < 3.5) danger = Math.hypot(dx + rvx * tc, dy + rvy * tc) < 44;
    }
    const tEnd = danger ? tc : 0.9;
    const e = toS(pr.x + ux * v * tEnd, pr.y + uy * v * tEnd);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash(danger ? [3, 2] : [2, 4]);
    ctx.lineDashOffset = -Math.floor(t * 10) % 6;
    ctx.strokeStyle = danger ? 'rgba(255,120,70,' + (0.55 + 0.3 * Math.sin(t * 10)).toFixed(3) + ')' : 'rgba(255,198,107,0.35)';
    ctx.beginPath(); ctx.moveTo(s.x + 0.5, s.y + 0.5); ctx.lineTo(e.x + 0.5, e.y + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    if (danger) {
      ctx.strokeStyle = '#FF784A';
      ctx.beginPath(); ctx.moveTo(e.x - 3, e.y - 3); ctx.lineTo(e.x + 3, e.y + 3); ctx.moveTo(e.x + 3, e.y - 3); ctx.lineTo(e.x - 3, e.y + 3); ctx.stroke();
    }
    ctx.restore();
    if (artK('drawProjectile', 'sperrfeuer', [ctx, 'sperrfeuer', s.x, s.y, a + rot, t], (g) => window.Art.drawProjectile(g, 'sperrfeuer', 48, 48, 0, 0))) return;
    // Fallback ohne Art: Glutpunkt mit Spur
    const sa = a + rot, sx = Math.cos(sa), sy = Math.sin(sa);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,198,107,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x - sx * 12, s.y - sy * 12); ctx.lineTo(s.x, s.y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,198,107,0.35)'; ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFC66B'; ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFF1B8'; ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    ctx.restore();
  }
  function drawSperrMuzzles(ctx, toS, mode) {
    if (!sperrMuzzle.length) return;
    const now = performance.now() / 1000;
    const small = mode === 'lage';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of sperrMuzzle) {
      const age = now - m.t0;
      if (age < 0 || age > 0.35) continue;
      const k = 1 - age / 0.35, s = toS(m.x, m.y);
      const r = (small ? 3 : 6) + (small ? 3 : 9) * (1 - k);
      ctx.fillStyle = 'rgba(255,170,70,' + (0.6 * k).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
      if (age < 0.12 && !small) {
        ctx.fillStyle = 'rgba(255,241,184,' + (0.9 * k).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // S2b: Gegner-HP-Balken in Segmenten (Jäger halten 3× so viel aus → jeder Treffer muss sichtbar ein Stück abtragen).
  // Ein Segment ≈ 6 HP (Jäger 36 HP = 6 Segmente), 1–12 Segmente. Eben verlorene HP leuchten kurz hell nach (Geist,
  // läuft nach 0,25 s mit 0,8/s nach), der Rahmen blitzt beim Treffer. Speicher je Gegner-ID, begrenzt und aufgeräumt.
  const hpGhost = new Map();   // id -> { shown, frac, hitAt, seen }
  function enemyHpBar(ctx, e, cx, y, now) {
    const max = +e.hpMax || 0;
    const frac = max > 0 ? clamp01((+e.hp || 0) / max) : 1;
    const n = max > 0 ? Math.max(1, Math.min(12, Math.round(max / 6))) : 1;
    if (n <= 2) { bar(ctx, Math.round(cx - 12), y, 24, 3, frac, PAL.red); return; }
    let g = e.id != null ? hpGhost.get(e.id) : null;
    if (!g) { g = { shown: frac, frac, hitAt: -9, seen: now }; if (e.id != null) hpGhost.set(e.id, g); }
    if (frac < g.frac - 1e-6) { g.hitAt = now; if (g.shown < g.frac) g.shown = g.frac; }
    if (frac > g.shown) g.shown = frac;
    const dt = Math.max(0, Math.min(0.1, now - g.seen));
    if (now - g.hitAt > 0.25) g.shown = Math.max(frac, g.shown - 0.8 * dt);
    g.frac = frac; g.seen = now;
    if (hpGhost.size > 64) for (const [k, v] of hpGhost) { if (now - v.seen > 5) hpGhost.delete(k); if (hpGhost.size <= 48) break; }
    const sw = 4, gap = 1, h = 4, w = n * (sw + gap) - gap;
    const x = Math.round(cx - w / 2);
    ctx.fillStyle = 'rgba(11,14,26,0.9)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    const flash = now - g.hitAt < 0.15;
    for (let i = 0; i < n; i++) {
      const sx = x + i * (sw + gap);
      const f0 = i / n, f1 = (i + 1) / n;
      ctx.fillStyle = 'rgba(46,58,74,0.95)'; ctx.fillRect(sx, y, sw, h);
      const ghostW = Math.round(sw * clamp01((g.shown - f0) / (f1 - f0)));
      if (ghostW > 0) { ctx.fillStyle = '#FFF1B8'; ctx.fillRect(sx, y, ghostW, h); }
      const fillW = Math.round(sw * clamp01((frac - f0) / (f1 - f0)));
      if (fillW > 0) { ctx.fillStyle = PAL.red; ctx.fillRect(sx, y, fillW, h); ctx.fillStyle = 'rgba(255,138,122,0.9)'; ctx.fillRect(sx, y, fillW, 1); }
    }
    if (flash) { ctx.strokeStyle = PAL.star; ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3); }
  }
  // Lanzenschaden aus power (§20.3): min + (max − min) × power; beschädigt max × 0,75
  function lanceDamage(m, power) {
    if (power == null && m && typeof m.dmg === 'number' && isFinite(m.dmg)) return Math.round(m.dmg * 10) / 10;   // Server liefert dmg
    const L = (CFG.spaceM3 && CFG.spaceM3.lance) || {};
    const mn = +L.minDamage || 3;
    let mx = +L.maxDamage || 12;
    if (m && m.state === 'damaged') mx *= (+L.damagedMaxFactor || 0.75);
    const p = clamp01(power != null ? power : (m && m.power));
    return Math.round((mn + (Math.max(mn, mx) - mn) * p) * 10) / 10;
  }
  function lanceDamageMax(m) { return lanceDamage(m, 1); }
  // Strahlen aus dem lokalen Speicher zeichnen (Weltkoordinaten -> Bildschirm per toS)
  function drawBeamsFx(ctx, toS, t, ship) {
    const now = performance.now() / 1000;
    for (const b of beamFx) {
      const age = now - b.t0;
      if (age < 0 || age > b.dur) continue;
      const ttl = b.dur - age;
      // Anfang klebt am (interpolierten) Schiff, sonst sitzt er bei Fahrt neben der Flanke
      const a = b.rel && ship && isFinite(ship.x) ? toS(ship.x + b.rel.x, ship.y + b.rel.y) : toS(b.x1, b.y1), c = toS(b.x2, b.y2);
      const life = ttl / b.dur;
      if (b.kind === 'battery' || b.kind === 'bolzen') {
        // Leuchtspur unter den Bolzen (auch ohne Art gut sichtbar)
        ctx.save();
        ctx.strokeStyle = 'rgba(227,181,101,' + (0.45 * life).toFixed(3) + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
        ctx.restore();
      }
      const m3k = b.kind === 'lance' || b.kind === 'battery' || b.kind === 'enemy_heavy' || b.kind === 'bolzen';
      if (artBeam(ctx, a.x, a.y, c.x, c.y, b.kind, m3k ? ttl : ttl * 0.25 / b.dur, { ttlMax: b.dur })) continue;
      fbBeam(ctx, b, a, c, age, life, t);
    }
  }
  function fbBeam(ctx, b, a, c, age, life, t) {
    if (b.kind === 'phase') {
      const nx = -(c.y - a.y), ny = c.x - a.x, l = Math.hypot(nx, ny) || 1;
      for (const o of [-2, 2]) { ctx.strokeStyle = o < 0 ? PAL.amber : PAL.star; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x + nx / l * o, a.y + ny / l * o); ctx.lineTo(c.x + nx / l * o, c.y + ny / l * o); ctx.stroke(); }
    } else if (b.kind === 'lance' || b.kind === 'enemy_heavy') {
      const lance = b.kind === 'lance';
      ctx.save(); ctx.globalAlpha = Math.max(0.15, life);
      ctx.strokeStyle = lance ? 'rgba(127,224,194,0.4)' : 'rgba(224,71,60,0.45)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.strokeStyle = lance ? BURST_COL : '#FF8A7A'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.restore();
    } else if (b.kind === 'battery' || b.kind === 'bolzen') {
      // zwei Messingbolzen fliegen die Linie entlang, am Ende ein Einschlag
      const dx = c.x - a.x, dy = c.y - a.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const p = age / b.dur;
      ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = '#E3B565';
      for (let k = 0; k < 2; k++) {
        const h = Math.min(1, p * 1.6 - k * 0.15);
        if (h <= 0 || h >= 1) continue;
        const hx = a.x + dx * h, hy = a.y + dy * h, bl = Math.min(12, L * 0.15);
        ctx.beginPath(); ctx.moveTo(hx - ux * bl, hy - uy * bl); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = '#FFF1C9'; ctx.fillRect(Math.round(hx) - 1, Math.round(hy) - 1, 2, 2);
      }
      if (p > 0.6 && !b.miss) { ctx.fillStyle = 'rgba(255,198,107,' + (1 - p).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(c.x, c.y, 3 + (p - 0.6) * 12, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    } else {
      ctx.strokeStyle = b.kind === 'lanze' ? PAL.mint : PAL.amber; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
  }
  // Rohrpositionen an der Flanke (Schiffskoordinaten, Bug = +x, Backbord = −y)
  function tubeLocal(mount, tube, tubes) {
    const n = Math.max(1, tubes);
    const lx = n === 1 ? 4 : -12 + tube * (30 / (n - 1));
    return { lx, ly: mount === 'port' ? -14 : 14 };
  }
  function drawMuzzles(ctx, sship, ship, rot, shipScale, cx, cy, t) {
    const now = performance.now() / 1000;
    const A = (+ship.angle || 0) + rot, cs = Math.cos(A), sn = Math.sin(A);
    const toScr = (lx, ly) => ({ x: cx + (lx * cs - ly * sn) * shipScale, y: cy + (lx * sn + ly * cs) * shipScale });
    // laufende Salve: Kette der Rohre (abgefeuert = glimmt, ausstehend = pulsiert)
    for (const m of sship.mounts || []) {
      if ((m.id !== 'port' && m.id !== 'stbd') || !(+m.salvo > 0)) continue;
      const max = Math.max(1, +m.salvoMax || 4), left = +m.salvo || 0;
      for (let k = 0; k < max; k++) {
        const p = tubeLocal(m.id, k, max), s = toScr(p.lx, p.ly);
        const fired = k < max - left;
        ctx.fillStyle = fired ? 'rgba(240,138,60,0.85)' : 'rgba(255,241,201,' + (0.5 + 0.5 * Math.sin(t * 30 + k)).toFixed(3) + ')';
        ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 2, 2);
      }
    }
    for (const f of muzzleFx) {
      const age = now - f.t0;
      if (age < 0 || age > 0.35) continue;
      const p = tubeLocal(f.mount, f.tube, f.tubes), s = toScr(p.lx, p.ly);
      const na = A + (f.mount === 'port' ? -Math.PI / 2 : Math.PI / 2), nx = Math.cos(na), ny = Math.sin(na);
      const k = 1 - age / 0.35;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Glut
      ctx.fillStyle = 'rgba(255,170,70,' + (0.55 * k).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, 3 + 5 * (1 - k), 0, Math.PI * 2); ctx.fill();
      if (age < 0.12) {
        // Mündungsblitz: Stichflamme nach außen + weißer Kern
        const len = 12 * (1 - age / 0.12) + 4;
        ctx.strokeStyle = 'rgba(255,214,140,0.95)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + nx * len, s.y + ny * len); ctx.stroke();
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + nx * len * 0.6, s.y + ny * len * 0.6); ctx.stroke();
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 3, 3);
      }
      ctx.restore();
      // Rauchwölkchen treibt nach außen
      if (age > 0.08) { ctx.fillStyle = 'rgba(142,163,181,' + (0.35 * k).toFixed(3) + ')'; const d = 6 + age * 30; ctx.fillRect(Math.round(s.x + nx * d) - 1, Math.round(s.y + ny * d) - 1, 3, 3); }
    }
  }
  // §20.3: Visierlinie der Lanze in Bugrichtung, solange aufgeladen wird (Steuer, Taktik, Lage)
  function drawLanceSight(ctx, view, ship, sship, toS, zoom, t, lab, front) {
    const bow = (sship.mounts || []).find(m => m.id === 'bow');
    if (!bow || !bow.charging) return;
    const g = mountGeom(bow);
    const ang = +ship.angle || 0, ux = Math.cos(ang), uy = Math.sin(ang);
    const ox = ship.x + ux * 34, oy = ship.y + uy * 34;
    const range = g.range || 650;
    const L = (CFG.spaceM3 && CFG.spaceM3.lance) || {};
    const width = +L.width || 10;
    const power = clamp01(bow.power);
    // erster Gegner in der Linie (wie der Server: Abstand zur Linie < hitRadius + width)
    const HR = (CFG.combat && CFG.combat.hitRadius) || {};
    let hitE = null, hitT = Infinity;
    for (const e of view.enemies || []) {
      if (e.st === 'treibt') continue;   // B1: Wrack
      const dx = e.x - ox, dy = e.y - oy, along = dx * ux + dy * uy;
      const rad = (HR[e.kind] || 18) + width;   // wie server lanceTrace
      if (along < -rad || along > range + rad) continue;
      const perp = Math.abs(dx * uy - dy * ux);
      if (perp < rad && along < hitT) { hitT = Math.max(0, along); hitE = e; }
    }
    const endD = hitE ? hitT : range;
    const a = toS(ox, oy), c = toS(ox + ux * endD, oy + uy * endD), cEnd = toS(ox + ux * range, oy + uy * range);
    const pulse = 0.5 + 0.5 * Math.sin(t * (8 + power * 10));
    ctx.save();
    // Korridor (Breite der Lanze)
    const nx = -uy, ny = ux, w = width;
    ctx.strokeStyle = 'rgba(127,224,194,' + (0.18 + 0.2 * power).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    for (const sgn of [-1, 1]) { const p0 = toS(ox + nx * w * sgn, oy + ny * w * sgn), p1 = toS(ox + ux * range + nx * w * sgn, oy + uy * range + ny * w * sgn); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); }
    // Mittellinie: hell bis zum Treffpunkt, danach blass
    ctx.setLineDash([6, 4]); ctx.lineDashOffset = -t * 40;
    ctx.strokeStyle = 'rgba(232,248,255,' + (0.55 + 0.4 * pulse * power).toFixed(3) + ')'; ctx.lineWidth = power >= 1 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    if (hitE) { ctx.strokeStyle = 'rgba(142,163,181,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(cEnd.x, cEnd.y); ctx.stroke(); }
    ctx.setLineDash([]);
    // Endmarke (Reichweite)
    ctx.strokeStyle = PAL.mint; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cEnd.x + nx * 5, cEnd.y + ny * 5); ctx.lineTo(cEnd.x - nx * 5, cEnd.y - ny * 5); ctx.stroke();
    if (hitE) {
      const s = toS(hitE.x, hitE.y), r = (ENEMY_SIZE[hitE.kind] || 16) + 6 + Math.round(2 * pulse);
      ctx.strokeStyle = BURST_COL; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x - r - 4, s.y); ctx.lineTo(s.x - r + 3, s.y); ctx.moveTo(s.x + r - 3, s.y); ctx.lineTo(s.x + r + 4, s.y); ctx.stroke();
    }
    ctx.restore();
    const dmg = lanceDamage(bow, power);
    const str = (hitE ? 'IM VISIER · ' : 'LANZE · ') + String(dmg).replace('.', ',') + ' SCHADEN';
    if (hitE) { const s = toS(hitE.x, hitE.y); lab(str, s.x, s.y - (ENEMY_SIZE[hitE.kind] || 16) - 20, { color: BURST_COL, align: 'center' }, 7); }
    else if (front) lab(str, cEnd.x, cEnd.y - 12, { color: PAL.mint, align: 'center' }, 6);   // Karten zeigen die Zahl schon am Bogen
    void front; void zoom;
  }

  // ---- M3a: eigene Bögen (Lanze schmal, Batterien als Fächer, gefüllt nach Ladung; blass solange ungeladen)
  function wedge(ctx, cx, cy, r, a0, a1) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, Math.max(1, r), a0, a1); ctx.closePath(); }
  function drawMountArc(ctx, m, ship, sship, target, rot, zoom, cx, cy, t, lab) {
    const g = mountGeom(m);
    const facing = g.facing * Math.PI / 180, arc = g.arc * Math.PI / 180, range = g.range * zoom;
    const a0 = (ship.angle || 0) + rot + facing - arc / 2, a1 = a0 + arc;
    const sysSt = m.state || sysState({ ship: sship }, MOUNT_SYS[m.id]);
    const dead = sysSt === 'broken' || sysSt === 'offline';
    const charge = clamp01(m.charge);
    const ready = charge >= 1 && !dead;
    const enemyTarget = target && !target.hidden && !target.station;
    const inArc = !!(enemyTarget && Phys.inArc(ship.x, ship.y, ship.angle || 0, g.facing, g.arc, g.range, target.x, target.y));
    // §20.3: keine Zielphase mehr – „aim“ ist das Aufladen (charging), die Lanze braucht kein Ziel
    const aim = m.id === 'bow' && m.charging ? m : null;
    ctx.save();
    wedge(ctx, cx, cy, range, a0, a1);
    ctx.fillStyle = 'rgba(142,163,181,0.035)'; ctx.fill();
    if (dead) { ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(224,71,60,0.6)'; }
    else ctx.strokeStyle = ready ? (inArc ? PAL.amber : 'rgba(127,224,194,0.8)') : 'rgba(142,163,181,0.3)';
    ctx.lineWidth = ready && inArc ? 2 : 1;
    ctx.stroke(); ctx.setLineDash([]);
    if (!dead && charge > 0) {
      wedge(ctx, cx, cy, range * charge, a0, a1);
      ctx.fillStyle = ready ? (inArc ? 'rgba(255,198,107,0.24)' : 'rgba(127,224,194,0.17)') : 'rgba(127,224,194,0.07)';
      ctx.fill();
    }
    if (aim) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 12);
      wedge(ctx, cx, cy, range, a0, a1);
      ctx.strokeStyle = 'rgba(232,248,255,' + (0.45 + 0.55 * pulse) + ')'; ctx.lineWidth = 2; ctx.stroke();
    }
    if (dead) {
      const mid = (a0 + a1) / 2, r = range * 0.4;
      crossX(ctx, cx + Math.cos(mid) * r - 5, cy + Math.sin(mid) * r - 5, 10, 10, PAL.red, 2);
    }
    ctx.restore();
    const mid = (a0 + a1) / 2;
    const rr = m.id === 'bow' ? range * 0.8 : range * 0.55;
    let status = dead ? 'AUS' : aim ? 'LÄDT ' + String(lanceDamage(m)).replace('.', ',') + ' SCH' : (+m.salvo > 0) ? 'SALVE' : ready ? 'BEREIT' : Math.round(charge * 100) + ' %';
    if (sysSt === 'damaged') status += ' · BESCH';
    const name = { bow: 'LANZE', port: 'BB', stbd: 'STB' }[m.id];
    lab(name + ' ' + status, cx + Math.cos(mid) * rr, cy + Math.sin(mid) * rr - 3,
      { color: dead ? PAL.red : aim ? BURST_COL : ready ? (inArc ? PAL.amber : PAL.mint) : PAL.panelLight, align: 'center' }, ready || aim || dead ? 2 : 0, !(ready || aim || dead));
  }
  // ---- M3a: angekündigter Angriff (tele) – roter, gestrichelter Fächer vom Gegner aufs Schiff + Countdown (Ort vor Zahl)
  function drawTele(ctx, e, s, cx, cy, t, withCountdown, lab) {
    const te = e.tele || {};
    const left = Math.max(0, +te.left || 0), dur = Math.max(0.1, +te.dur || left || 1);
    const ang = Math.atan2(cy - s.y, cx - s.x);
    const dist = Math.hypot(cx - s.x, cy - s.y) + 26;
    const spread = 0.2;
    const pulse = 0.5 + 0.5 * Math.sin(t * (6 + 6 * (1 - left / dur)));
    ctx.save();
    wedge(ctx, s.x, s.y, dist, ang - spread, ang + spread);
    ctx.fillStyle = 'rgba(224,71,60,' + (0.08 + 0.12 * pulse * (1 - left / dur) + 0.05) + ')'; ctx.fill();
    ctx.setLineDash([5, 4]); ctx.lineDashOffset = -t * 20;
    ctx.strokeStyle = 'rgba(255,90,74,' + (0.55 + 0.4 * pulse) + ')'; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);
    // Ladering am Gegner (läuft ab)
    const rr = (ENEMY_SIZE[e.kind] || 16) * 0.6 + 10;
    ctx.strokeStyle = 'rgba(11,14,26,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#FF5A4A'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.arc(s.x, s.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / dur)); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    if (withCountdown) {
      const sec = te.sector != null ? (SECTOR_SHORT[te.sector] || '') : '';
      const str = (sec ? sec + ' ' : '') + fmt1(left);
      const w = measure(str, 2) + 8;
      const lx = Math.round(s.x - w / 2), ly = Math.round(s.y - rr - 22);
      ctx.fillStyle = 'rgba(11,14,26,0.85)'; ctx.fillRect(lx, ly, w, 17);
      ctx.strokeStyle = '#FF5A4A'; ctx.setLineDash([3, 2]); ctx.strokeRect(lx + 0.5, ly + 0.5, w - 1, 16); ctx.setLineDash([]);
      text(ctx, str, s.x, ly + 2, { color: '#FF5A4A', scale: 2, align: 'center', shadow: false });
      if (te.kind === 'emp') lab('EMP', s.x, ly + 19, { color: OFFLINE_COL, align: 'center' }, 6);
    }
  }

  // cfg = { mode: 'front'|'tactical'|'lage', zoom, rot, cx, cy, bound (Sichtrechteck), sight (Welt-px, Nebel),
  //         arcs, intel, enemyRects (füllt Klickflächen), navArrows, teleVis: 'all'|'late'|'none' }
  // M3b §5: Anfluglinie eines Jägers. Gerade Bahn relativ zum Schiff: nächster Punkt nach t* = −(d·v)/|v|² (0…4 s),
  // Linie bis t* + 0,8 s, Kreuz am nächsten Punkt mit Abstand. Rot gestrichelt, läuft mit (Marschbewegung).
  function drawApproachLine(ctx, e, ship, toS, t, lab) {
    const vx = e.vx - (+ship.vx || 0), vy = e.vy - (+ship.vy || 0);
    const v2 = vx * vx + vy * vy;
    if (v2 < 100) return;
    const dx = e.x - (ship.x || 0), dy = e.y - (ship.y || 0);
    const tc = Math.max(0, Math.min(4, -(dx * vx + dy * vy) / v2));
    const tEnd = Math.min(5, tc + 0.8);
    const a = toS(e.x, e.y);
    const b = toS(e.x + e.vx * tEnd, e.y + e.vy * tEnd);
    const cxw = e.x + e.vx * tc, cyw = e.y + e.vy * tc;
    const c = toS(cxw, cyw);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,90,74,0.85)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.lineDashOffset = -Math.floor(t * 12) % 7;
    ctx.beginPath(); ctx.moveTo(a.x + 0.5, a.y + 0.5); ctx.lineTo(b.x + 0.5, b.y + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#FF5A4A';
    ctx.beginPath(); ctx.moveTo(c.x - 3, c.y - 3); ctx.lineTo(c.x + 3, c.y + 3); ctx.moveTo(c.x + 3, c.y - 3); ctx.lineTo(c.x - 3, c.y + 3); ctx.stroke();
    ctx.restore();
    const miss = Math.round(Math.hypot(dx + vx * tc, dy + vy * tc));
    lab('ANFLUG ' + miss, c.x, c.y + 5, { color: '#FF5A4A', align: 'center' }, 2, true);
  }
  // ------------------------------------------------------------------ S2: Schützling (CONTRACT-S2 §5/§7)
  // Eisblau + Messing, runde Silhouette, gestrichelter Schutzring, Segmentbalken 32×4 über dem Sprite.
  // Lesbarkeit nie nur über Farbe: Notruf = pulsierender Ring + Wort NOTRUF, kampfunfähig = Kreuz + Wort.
  const ESCORT_COL = { ice: '#A9D6E5', brass: '#C9974A', amber: '#FFC66B', wreck: '#6B7380' };
  const ESCORT_R = { frachter: 42, karawane: 32, bergungsboot: 26 };   // Radius des Schutzrings (Sprite-Pixel)
  const ESCORT_KIND_NAMES = { frachter: 'Frachter', karawane: 'Karawane', bergungsboot: 'Bergungsboot' };
  const ESCORT_STATE_NAMES = { ok: 'heil', beschaedigt: 'beschädigt', kampfunfaehig: 'KAMPFUNFÄHIG', entkommen: 'IN SICHERHEIT' };
  const ESCORT_ORDER_NAMES = { halten: 'Halten', folgen: 'Folgen', volle_kraft: 'Volle Kraft', andocken: 'Andocken' };
  const ESCORT_SEGS = 4;
  function escortHpFrac(e) { const m = +e.hpMax || 0; return m > 0 ? Math.max(0, Math.min(1, (+e.hp || 0) / m)) : (e.state === 'kampfunfaehig' ? 0 : 1); }
  function escortName(e) { return String((e && (e.name || ESCORT_KIND_NAMES[e.kind] || e.tag || e.id)) || 'Schützling'); }
  function escortDown(e) { return e && e.state === 'kampfunfaehig'; }
  // Ringfarbe: Notruf pulsiert Eisblau -> Bernstein (Mischung), sonst Eisblau, Wrack grau
  function escortRingCol(e, t) {
    if (escortDown(e)) return ESCORT_COL.wreck;
    if (!e.distress) return ESCORT_COL.ice;
    const k = 0.5 + 0.5 * Math.sin(t * 6);
    const a = [0xA9, 0xD6, 0xE5], b = [0xFF, 0xC6, 0x6B];
    return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',') + ')';
  }
  // Segmentbalken (32×4, 4 Segmente) – Segmente leer = dunkel umrandet, damit „wie viel fehlt“ ohne Farbe lesbar ist
  function escortSegBar(ctx, x, y, frac, w, h, col) {
    w = w || 32; h = h || 4;
    const gap = 1, sw = (w - gap * (ESCORT_SEGS - 1)) / ESCORT_SEGS;
    ctx.fillStyle = 'rgba(11,14,26,0.85)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    for (let i = 0; i < ESCORT_SEGS; i++) {
      const sx = Math.round(x + i * (sw + gap)), sw2 = Math.round(sw);
      const fill = Math.max(0, Math.min(1, frac * ESCORT_SEGS - i));
      ctx.fillStyle = '#26313F'; ctx.fillRect(sx, y, sw2, h);
      if (fill > 0) { ctx.fillStyle = col || ESCORT_COL.ice; ctx.fillRect(sx, y, Math.max(1, Math.round(sw2 * fill)), h); }
    }
  }
  function fbEscort(ctx, kind, x, y, angle, o) {
    o = o || {};
    const down = o.state === 'kampfunfaehig';
    const hull = down ? ESCORT_COL.wreck : (o.hitT != null && o.hitT < 0.15 ? '#FFFFFF' : ESCORT_COL.ice);
    const rim = down ? '#4A5260' : ESCORT_COL.brass;
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(angle || 0);
    ctx.lineWidth = 2; ctx.strokeStyle = rim; ctx.fillStyle = hull;
    if (kind === 'karawane') {
      // Mittelkörper + zwei Kapseln im Schlepp
      for (const py of [-11, 11]) { ctx.beginPath(); ctx.arc(-16, py, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.beginPath(); ctx.ellipse(4, 0, 18, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAL.space; ctx.fillRect(12, -3, 6, 6);
    } else if (kind === 'bergungsboot') {
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = rim; ctx.lineWidth = 3;   // Greifarm
      ctx.beginPath(); ctx.moveTo(10, -6); ctx.lineTo(19, -9); ctx.moveTo(10, 6); ctx.lineTo(19, 9); ctx.stroke();
      ctx.fillStyle = PAL.space; ctx.fillRect(3, -3, 6, 6);
    } else {
      // Frachter: lange, runde Hülle mit Ladebuchten
      ctx.beginPath(); ctx.ellipse(0, 0, 34, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = down ? '#4A5260' : ESCORT_COL.brass;
      for (const bx of [-18, -6, 6]) ctx.fillRect(bx, -6, 9, 12);
      ctx.fillStyle = PAL.space; ctx.fillRect(22, -3, 6, 6);
    }
    if (!down && (o.thrust == null || o.thrust > 0)) { ctx.fillStyle = 'rgba(255,198,107,0.8)'; ctx.fillRect(kind === 'frachter' ? -40 : kind === 'karawane' ? -26 : -18, -2, 4, 4); }
    ctx.restore();
    if (down) {   // Wrack: Kreuz (Form, nicht nur Farbe)
      ctx.strokeStyle = '#E0473C'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke();
    }
  }
  function drawEscortSprite(ctx, e, sx, sy, angle, t, hitT) {
    const o = { hpFrac: escortHpFrac(e), hitT: hitT != null ? hitT : 99, time: t, distress: !!e.distress, state: e.state || 'ok' };
    if (!art('drawEscort', 'drawEscort:' + e.kind, [ctx, e.kind, sx, sy, angle, o])) fbEscort(ctx, e.kind, sx, sy, angle, o);
  }
  // Schutzring (gestrichelt); Notruf: pulsiert in Farbe UND Radius
  function drawEscortRing(ctx, e, sx, sy, r, t) {
    const col = escortRingCol(e, t);
    const puls = e.distress && !escortDown(e) ? Math.round(2 + 2 * Math.sin(t * 6)) : 0;
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = e.distress ? 2 : 1; ctx.setLineDash(escortDown(e) ? [2, 4] : [5, 3]);
    ctx.lineDashOffset = -t * 6;
    ctx.beginPath(); ctx.arc(sx, sy, r + puls, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  // Randanzeige in Ringform (für Schützlinge außerhalb des Sichtfelds): kleiner gestrichelter Ring + Pfeilspitze
  function escortEdgeRing(ctx, x, y, ang, e, t) {
    const col = escortRingCol(e, t);
    const r = 6 + (e.distress && !escortDown(e) ? Math.round(1.5 + 1.5 * Math.sin(t * 6)) : 0);
    ctx.save();
    ctx.fillStyle = 'rgba(11,14,26,0.8)'; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(r + 7, 0); ctx.lineTo(r + 1, -4); ctx.lineTo(r + 1, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (escortDown(e)) { ctx.strokeStyle = '#E0473C'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke(); }
    else if (e.distress) { ctx.fillStyle = ESCORT_COL.amber; ctx.fillRect(x - 1, y - 3, 2, 4); ctx.fillRect(x - 1, y + 2, 2, 1); }   // „!“ im Ring
  }
  // Ziel der Route: Server-Feld ziel/dest {x,y}, sonst nach Befehl (folgen/andocken -> Lerche, volle Kraft -> Sprungpunkt)
  function escortRouteTarget(e, ship, space) {
    const z = e.ziel || e.dest || e.route;
    if (z && isFinite(+z.x) && isFinite(+z.y)) return { x: +z.x, y: +z.y };
    if (e.befehl === 'folgen' || e.befehl === 'andocken') return { x: ship.x, y: ship.y };
    if (e.befehl === 'volle_kraft') { const ex = (space.markers || []).find(m => m.kind === 'exit' || m.kind === 'dock'); if (ex) return { x: ex.x, y: ex.y }; }
    return null;
  }
  // Schützlinge in drawSpace (env = Hilfen aus drawSpace)
  function drawEscortsInSpace(ctx, view, env) {
    const list = view.escorts || (view.state.space && view.state.space.escorts) || [];
    if (!list.length) return;
    const { toS, inB, visible, lab, block, B, cx, cy, front, t, ship, space } = env;
    for (const e of list) {
      if (!e || !isFinite(+e.x) || !isFinite(+e.y)) continue;
      if (e.state === 'entkommen') continue;   // in Sicherheit: nicht mehr im Raum
      const s = toS(+e.x, +e.y);
      const r = ESCORT_R[e.kind] || 32;
      const name = escortName(e).toUpperCase();
      // Route (nur Karten): gepunktete Messing-Linie
      if (!front && !escortDown(e)) {
        const rt = escortRouteTarget(e, ship, space || {});
        if (rt) {
          const d = toS(rt.x, rt.y);
          ctx.save(); ctx.strokeStyle = 'rgba(201,151,74,0.85)'; ctx.lineWidth = 1; ctx.setLineDash([1, 4]);
          ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(d.x, d.y); ctx.stroke(); ctx.restore();
          if (inB(d, -4) && (rt.x !== ship.x || rt.y !== ship.y)) { ctx.strokeStyle = ESCORT_COL.brass; ctx.strokeRect(d.x - 3.5, d.y - 3.5, 7, 7); }
        }
      }
      if (!inB(s, 0)) {
        if (!visible(+e.x, +e.y) && front) continue;
        const ang = Math.atan2(s.y - cy, s.x - cx);
        const p = rayToRect(B, cx, cy, ang, 14);
        // Frontsicht: unten liegen die Lerche und die Drehanzeige – „hinter uns“ an die untere Ecke der passenden Seite
        if (front && p.y > B.y + B.h - 54) { p.x = s.x < cx ? B.x + 16 : B.x + B.w - 16; p.y = B.y + B.h - 60; }
        escortEdgeRing(ctx, p.x, p.y, ang, e, t);
        const dist = Math.round(Math.hypot(+e.x - ship.x, +e.y - ship.y));
        const lw = measure(name, 1) / 2 + 3;
        const lx = Math.max(B.x + lw, Math.min(B.x + B.w - lw, p.x - Math.cos(ang) * 32));
        const ly = Math.max(B.y + 2, Math.min(B.y + B.h - 10, p.y - Math.sin(ang) * 18 - 3));
        lab(name + (e.distress && !escortDown(e) ? ' NOTRUF' : '') + ' ' + dist, lx, ly, { color: escortRingCol(e, t), align: 'center' }, 6);
        continue;
      }
      const hitT = view.escortHit && view.escortHit[e.id] != null ? view.escortHit[e.id] : 99;
      drawEscortRing(ctx, e, s.x, s.y, r, t);
      drawEscortSprite(ctx, e, s.x, s.y, (+e.angle || 0) + (env.rot || 0), t, hitT);
      const frac = escortHpFrac(e);
      escortSegBar(ctx, s.x - 16, s.y - r - 9, frac, 32, 4, escortDown(e) ? ESCORT_COL.wreck : frac < 0.3 ? '#E0473C' : frac < 0.6 ? ESCORT_COL.amber : ESCORT_COL.ice);
      block(s.x - r, s.y - r - 10, r * 2, r * 2 + 10);
      const stTxt = escortDown(e) ? ' · KAMPFUNFÄHIG' : e.distress ? ' · NOTRUF' : (e.repair != null && e.repair < 1) ? ' · REPARATUR ' + Math.round(e.repair * 100) + ' %' : '';
      lab(name + stTxt, s.x, s.y + r + 3, { color: escortDown(e) ? ESCORT_COL.wreck : e.distress ? ESCORT_COL.amber : ESCORT_COL.ice, align: 'center' }, 5);
    }
  }
  // Rot gestrichelte Bedrohungslinie von gescannten Gegnern mit tgt (nur Karten). Pfeilspitze am Schützling.
  function drawEscortThreats(ctx, view, env) {
    const list = view.escorts || (view.state.space && view.state.space.escorts) || [];
    if (!list.length || env.front) return;
    const { toS, lab, t } = env;
    for (const en of view.enemies || []) {
      if (!en || en.tgt == null || !en.scanned) continue;
      const e = list.find(q => q && q.id === en.tgt);
      if (!e || e.state === 'entkommen') continue;
      const a = toS(en.x, en.y), b = toS(+e.x, +e.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const r = (ESCORT_R[e.kind] || 32) + 4;
      const bx = b.x - Math.cos(ang) * r, by = b.y - Math.sin(ang) * r;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,90,74,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.lineDashOffset = -t * 10;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      ctx.translate(bx, by); ctx.rotate(ang); ctx.fillStyle = '#FF5A4A';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-7, -4); ctx.lineTo(-7, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
      lab('ZIELT AUF ' + escortName(e).toUpperCase(), Math.round((a.x + bx) / 2), Math.round((a.y + by) / 2) - 4, { color: '#FF5A4A', align: 'center' }, 2, true);   // QA-Abnahme S2: nach den Gegnernamen setzen (sonst überlappt JÄGER)
    }
  }

  function drawSpace(ctx, view, rect, cfg) {
    const st = view.state;
    const ship = view.ship || st.ship || {};
    const sship = st.ship || {};
    const space = st.space || {};
    const t = view.time;
    const zoom = cfg.zoom || 0.35, rot = cfg.rot || 0;
    const cx = cfg.cx, cy = cfg.cy;
    const front = cfg.mode === 'front';
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const toS = (wx, wy) => { const dx = (wx - ship.x) * zoom, dy = (wy - ship.y) * zoom; return { x: Math.round(cx + dx * cosR - dy * sinR), y: Math.round(cy + dx * sinR + dy * cosR) }; };
    const toW = (sx, sy) => { const dx = (sx - cx) / zoom, dy = (sy - cy) / zoom; return { x: ship.x + dx * cosR + dy * sinR, y: ship.y - dx * sinR + dy * cosR }; };
    const B = cfg.bound || rect;
    const inB = (p, m) => p.x >= B.x - m && p.y >= B.y - m && p.x <= B.x + B.w + m && p.y <= B.y + B.h + m;
    const sight = cfg.sight || Infinity;
    const visible = (wx, wy, r) => Math.hypot(wx - ship.x, wy - ship.y) - (r || 0) <= sight;
    const fog = inFog(st);
    const clicks = cfg.enemyRects;
    if (clicks) clicks.length = 0;
    const shipScale = Math.max(MIN_SHIP_SCALE, zoom);
    // QA M1: Beschriftungen entzerren. Labels werden gesammelt und am Ende nach Priorität gezeichnet;
    // überlappt ein Label ein schon gesetztes, rutscht es um eine Zeile nach unten/oben. Optionale Labels
    // (z. B. Bogennamen der eigenen Kanonen) entfallen, wenn kein Platz ist.
    const labels = [];
    const lab = (str, x, y, o, prio, optional) => { if (str) labels.push({ str: String(str), x, y, o: o || {}, prio: prio || 0, optional: !!optional }); };
    const placed = [];
    const block = (x, y, w, h) => placed.push({ x, y, w, h });   // Sprites als Hindernis für Labels
    const edge = front ? 6 : 4;
    // Frontsicht: Fläche der DREHEN-Anzeige (consoles.js helmTurnGauge: cx ± 82, unten 34 px) für Labels sperren
    const gauge = front ? { x: cx - 84, y: B.y + B.h - 36, w: 168, h: 36 } : null;
    const flushLabels = () => {
      flushArrows();
      labels.sort((a, b) => b.prio - a.prio);
      for (const l of labels) {
        const w = measure(l.str, 1) + 2, h = 9;
        const left = l.o.align === 'center' ? l.x - w / 2 : (l.o.align === 'right' ? l.x - w : l.x);
        let best = null;
        // QA M3a: Label nie über den Kartenrand hinaus (z. B. „LANZE BEREIT“ rechts abgeschnitten) – schon vor der
        // Kollisionsprüfung in den Rahmen schieben, damit geklemmte Labels nicht übereinander landen
        // QA-Abnahme S2: Rand der Frontsicht (Messingrahmen mit Fase) und der Kartenrahmen fressen ein paar Pixel –
        // daher 6 bzw. 4 px Abstand; in der Frontsicht liegt unten mittig die DREHEN-Anzeige (Label darüber setzen).
        const inside = (r) => {
          r.x = Math.max(B.x + edge, Math.min(B.x + B.w - w - edge, r.x)); r.y = Math.max(B.y + 2, Math.min(B.y + B.h - h - 1, r.y));
          if (gauge && r.x < gauge.x + gauge.w && gauge.x < r.x + r.w && r.y < gauge.y + gauge.h && gauge.y < r.y + h) r.y = gauge.y - h - 1;
          return r;
        };
        for (const [dx, dy] of [[0, 0], [0, 10], [0, -10], [0, 20], [0, -20], [w * 0.6, 0], [-w * 0.6, 0], [0, 30], [0, -30]]) {
          const r = inside({ x: left + dx, y: l.y + dy, w, h });
          if (!placed.some((p) => r.x < p.x + p.w && p.x < r.x + r.w && r.y < p.y + p.h && p.y < r.y + r.h)) { best = r; break; }
        }
        if (!best) { if (l.optional) continue; best = inside({ x: left, y: l.y, w, h }); }
        placed.push(best);
        text(ctx, l.str, l.x + (best.x - left), best.y, l.o);
      }
      labels.length = 0;
    };
    // B3-NACH: Randpfeile werden gesammelt und vor den Labels gezeichnet. Pfeile, deren Randpunkt nahe beieinander liegt
    // (z. B. HAFEN und DOCK in fast derselben Richtung), teilen sich einen Pfeil, ihre Labels werden gestapelt; dasselbe
    // Label zweimal entfällt. Frontsicht: Ziele „hinter uns“ (Randpunkt im unteren Band = Lerche und DREHEN-Anzeige)
    // rücken an die untere Ecke der passenden Seite (wie die Schützlinge).
    const arrows = [];
    const arrow = (wx, wy, col, label) => {
      const s = toS(wx, wy);
      const ang = Math.atan2(s.y - cy, s.x - cx);
      const e = rayToRect(B, cx, cy, ang, 12);
      if (front && e.y > B.y + B.h - 54) { e.x = s.x < cx ? B.x + 16 : B.x + B.w - 16; e.y = B.y + B.h - 60; }
      arrows.push({ e, ang, col, label: label ? String(label) : '' });
      return e;
    };
    const flushArrows = () => {
      const groups = [];
      for (const a of arrows) {
        const g = groups.find((q) => Math.hypot(q[0].e.x - a.e.x, q[0].e.y - a.e.y) < 24);
        if (!g) groups.push([a]);
        else if (!g.some((q) => q.label === a.label)) g.push(a);
      }
      arrows.length = 0;
      for (const g of groups) {
        const a = g[0], e = a.e;
        edgeArrow(ctx, e.x, e.y, a.ang, a.col);
        const list = g.filter((q) => q.label);
        if (!list.length) continue;
        // Stapel vom Rand weg: unten nach oben, sonst nach unten
        const lowHalf = e.y > B.y + B.h / 2;
        const baseY = e.y - Math.sin(a.ang) * 16 - 3 + (lowHalf ? -(list.length - 1) * 10 : 0);
        list.forEach((q, i) => {
          const lw = measure(q.label, 1) / 2 + 3;
          const lx = Math.max(B.x + lw, Math.min(B.x + B.w - lw, e.x - Math.cos(a.ang) * 30));
          const ly = Math.max(B.y + 2, Math.min(B.y + B.h - 10, baseY + i * 10));
          lab(q.label, lx, ly, { color: q.col, align: 'center' }, 3);
        });
      }
    };

    ctx.save();
    ctx.beginPath(); ctx.rect(B.x, B.y, B.w, B.h); ctx.clip();
    // Sternenhimmel (in der Frontsicht mitgedreht)
    if (rot) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
      const D = Math.ceil(Math.hypot(rect.w, rect.h));
      ctx.translate(-D, -D);
      if (!art('drawStarfield', null, [ctx, ship.x * zoom, ship.y * zoom, 2 * D, 2 * D, t, { fog }])) fbStarfield(ctx, ship.x * zoom, ship.y * zoom, 2 * D, 2 * D, t);
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(B.x, B.y);
      if (!art('drawStarfield', null, [ctx, ship.x * zoom, ship.y * zoom, B.w, B.h, t, { fog }])) fbStarfield(ctx, ship.x * zoom, ship.y * zoom, B.w, B.h, t);
      ctx.restore();
    }
    if (fog && !front) { ctx.fillStyle = 'rgba(42,35,80,0.25)'; ctx.fillRect(B.x, B.y, B.w, B.h); }

    // Radargitter + Sensorreichweite (nur Karten, nicht die Frontsicht)
    if (!front) {
      ctx.strokeStyle = 'rgba(127,224,194,0.08)'; ctx.lineWidth = 1;
      const g = 200;
      const gx0 = Math.floor((ship.x - B.w / 2 / zoom) / g) * g, gy0 = Math.floor((ship.y - B.h / 2 / zoom) / g) * g;
      for (let gx = gx0; gx < ship.x + B.w / 2 / zoom + g; gx += g) { const s = toS(gx, 0); ctx.beginPath(); ctx.moveTo(s.x + 0.5, B.y); ctx.lineTo(s.x + 0.5, B.y + B.h); ctx.stroke(); }
      for (let gy = gy0; gy < ship.y + B.h / 2 / zoom + g; gy += g) { const s = toS(0, gy); ctx.beginPath(); ctx.moveTo(B.x, s.y + 0.5); ctx.lineTo(B.x + B.w, s.y + 0.5); ctx.stroke(); }
      const sr = sensorRange(st) * zoom;
      if (fog) {
        ctx.fillStyle = 'rgba(42,35,80,0.5)';
        ctx.beginPath(); ctx.rect(B.x, B.y, B.w, B.h); ctx.arc(cx, cy, sr, 0, Math.PI * 2, true); ctx.fill('evenodd');
      }
      ctx.strokeStyle = 'rgba(127,224,194,0.35)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, 'SENSOR ' + Math.round(sensorRange(st)) + (fog ? ' (NEBEL)' : ''), cx, cy - sr - 10, { color: 'rgba(127,224,194,0.8)', align: 'center' });
    }

    // Szenenrand
    if (space.w && space.h) {
      const c = [toS(0, 0), toS(space.w, 0), toS(space.w, space.h), toS(0, space.h)];
      ctx.strokeStyle = 'rgba(224,71,60,0.55)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    }

    // Orte/Stationen/Ringe
    for (const m of space.markers || []) {
      const s = toS(m.x, m.y);
      const vis = visible(m.x, m.y, m.r || 80);
      if (!inB(s, 0)) {
        if (cfg.navArrows !== false && vis) {
          const lab = { dock: 'DOCK', exit: 'SPRUNG' }[m.kind] || STATION_SHORT[m.kind] || STATION_LABEL[m.kind] || '';
          arrow(m.x, m.y, m.kind === 'vaelen' ? PAL.amber : 'rgba(127,224,194,0.85)', lab + ' ' + Math.round(Math.hypot(m.x - ship.x, m.y - ship.y)));
        }
        if (!inB(s, 160)) continue;
      }
      if (!vis) continue;
      // B3-NACH: liegt der Ort außerhalb, trägt der Randpfeil Name und Abstand – kein zweites, an den Rand geklemmtes Label
      const mLab = inB(s, 0) ? lab : () => {};
      if (m.kind === 'dock') {
        const r = Math.max(8, (m.r || 70) * zoom);
        ctx.strokeStyle = 'rgba(127,224,194,' + (0.55 + 0.3 * Math.sin(t * 3)) + ')'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        mLab('DOCK-RING', s.x, s.y - r - 10, { color: PAL.mint, align: 'center' }, 1);
      } else if (m.kind === 'exit') {
        ctx.strokeStyle = 'rgba(127,224,194,' + (0.5 + 0.3 * Math.sin(t * 3)) + ')'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.arc(s.x, s.y, (m.r || 140) * zoom, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        mLab('SPRUNGPUNKT', s.x, s.y - 4, { color: PAL.mint, align: 'center' }, 1);
      } else if (STATION_ART[m.kind]) {
        const k = STATION_ART[m.kind];
        const stScale = zoom * (m.kind === 'station' ? STATION_SPRITE_SCALE : 1);
        ctx.save(); ctx.translate(s.x, s.y); ctx.scale(stScale, stScale);
        if (!artStation(ctx, k, 0, 0, { time: t })) fbStation(ctx, m.kind, t);
        ctx.restore();
        const lr = Math.round((m.kind === 'station' ? 80 : m.kind === 'buoy' ? 44 : m.kind === 'moon' ? (m.r || 170) : 70) * stScale) + 2;
        mLab(STATION_LABEL[m.kind], s.x, s.y + lr, { color: PAL.amber, align: 'center' }, 2);
        if (m.kind === 'buoy' && cfg.showRanges) {
          ctx.strokeStyle = 'rgba(127,224,194,0.35)'; ctx.setLineDash([2, 4]);
          const sc = (CFG.scenes && CFG.scenes.buoy) || {};
          ctx.beginPath(); ctx.arc(s.x, s.y, (sc.scanRange || 420) * zoom, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,198,107,0.35)';
          ctx.beginPath(); ctx.arc(s.x, s.y, (sc.beamRange || 320) * zoom, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    // B3 (Welle 0, CONTRACT-B3 §8): Sprungpunkt-Bojen der Szene zeichnet StarMap (Team KARTE); der Stub zeichnet nichts
    // B3 (CLIENT, Welle 2): cam trägt zusätzlich bound (Bildausschnitt in Bildschirmkoordinaten, für Randpfeile zu Bojen
    // außerhalb), lab (Label-Kollision: lab(text, x, y, opts, prio, optional)), block (Hindernis für Labels), arrow (Randpfeil
    // wie Stationen: arrow(wx, wy, farbe, label)), toW, cx/cy (Bildmitte = Schiff). bound/lab auch als 4./5. Argument.
    if (window.StarMap && typeof window.StarMap.drawSzene === 'function') window.StarMap.drawSzene(ctx, { toS, toW, zoom, front, bound: B, lab, block, arrow, cx, cy, inB }, st, B, lab);

    // Bergungsgut im Raum
    for (const sv of space.salvage || []) {
      if (!visible(sv.x, sv.y)) continue;
      const s = toS(sv.x, sv.y);
      if (!inB(s, -6)) { if (!front || cfg.navArrows !== false) arrow(sv.x, sv.y, PAL.mint, 'BERGUNG'); continue; }
      const pr = 12 + Math.round(2 * Math.sin(t * 4));
      ctx.strokeStyle = PAL.mint; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.arc(s.x, s.y, pr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const ik = sv.kind === 'marks' ? 'ersatzteil' : sv.kind;
      if (!artItem(ctx, ik, s.x, s.y, { time: t })) itemFallback(ctx, sv.kind, s.x, s.y);
      lab('BERGUNG', s.x, s.y + pr + 2, { color: PAL.mint, align: 'center' }, 1);
    }

    // Aufgedeckte versteckte Objekte (Weitscan)
    const target = (view.enemies || []).find(e => e.id === sship.target) || (space.hidden || []).find(h => h.id === sship.target) || (sship.target === 'station' ? stationOf(space) : null);
    if (target && target.station && !front) {
      const s = toS(target.x, target.y);
      if (inB(s, 0)) { ctx.strokeStyle = PAL.amber; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(14, 80 * zoom), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); lab('ZIEL', s.x, s.y - Math.max(14, 80 * zoom) - 10, { color: PAL.amber, align: 'center' }, 4); }
    }
    { const so = stationOf(space); if (so && clicks && !front) { const s = toS(so.x, so.y); const r = Math.max(14, 60 * zoom); clicks.push({ id: 'station', x: s.x - r, y: s.y - r, w: r * 2, h: r * 2, station: true }); } }
    for (const h of space.hidden || []) {
      if (!visible(h.x, h.y)) continue;
      const s = toS(h.x, h.y);
      if (!inB(s, 8)) continue;
      if (!artItem(ctx, h.kind, s.x, s.y, { time: t, found: !!h.found })) fbHidden(ctx, h.kind, s.x, s.y, t);
      lab((HIDDEN_NAMES[h.kind] || 'SIGNAL') + (h.found ? ' (erfasst)' : ''), s.x, s.y + 9, { color: h.found ? PAL.panelLight : PAL.mint, align: 'center' }, 2);
      if (clicks && !front) clicks.push({ id: h.id, x: s.x - 10, y: s.y - 10, w: 20, h: 20, hidden: true });
    }

    // Asteroiden
    for (const a of brockenJetzt(st)) {   // W2 AP3b: bewegt -> Lage zur Spielzeit, Eigendrehung
      if (!visible(a.x, a.y, a.r)) continue;
      const s = toS(a.x, a.y);
      const r = Math.max(3, Math.round((a.r || 20) * zoom));
      if (!inB(s, r + 4)) continue;
      const dreh = a.rot ? a.rot + rot : 0;
      if (dreh) { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(dreh); }
      const px = dreh ? 0 : s.x, py = dreh ? 0 : s.y;
      if (!art('drawAsteroid', null, [ctx, px, py, r, a.seed || 0])) {
        ctx.fillStyle = '#5A5560'; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6E6873'; ctx.beginPath(); ctx.arc(px - r * 0.3, py - r * 0.3, r * 0.5, 0, Math.PI * 2); ctx.fill();
      }
      if (dreh) ctx.restore();
    }

    // Eigene Feuerbögen
    if (cfg.arcs) {
      for (const m of sship.mounts || []) {
        if (m.id === 'seitenturm' && st.upgrades && st.upgrades.seitenturm === false) continue;
        if (MOUNT_SYS[m.id]) { try { drawMountArc(ctx, m, ship, sship, target, rot, zoom, cx, cy, t, lab); } catch (e) { report('Render.mountArc', e); } continue; }
        const g = mountGeom(m);
        const facing = g.facing * Math.PI / 180, arc = g.arc * Math.PI / 180, range = g.range * zoom;
        const a0 = (ship.angle || 0) + rot + facing - arc / 2, a1 = a0 + arc;
        const inArc = target && Phys.inArc(ship.x, ship.y, ship.angle || 0, g.facing, g.arc, g.range, target.x, target.y);
        const ready = (m.charge || 0) >= 1;
        ctx.fillStyle = inArc ? 'rgba(255,198,107,0.13)' : 'rgba(142,163,181,0.06)';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, range, a0, a1); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = inArc ? PAL.amber : (ready ? 'rgba(127,224,194,0.5)' : 'rgba(142,163,181,0.35)');
        ctx.lineWidth = inArc ? 2 : 1;
        ctx.stroke();
        const la = (ship.angle || 0) + rot + facing + (m.id === 'phase_l' ? -0.12 : m.id === 'phase_r' ? 0.12 : 0);
        lab(MOUNT_LABEL[m.id] || m.id, cx + Math.cos(la) * range * 0.55, cy + Math.sin(la) * range * 0.55 - 3, { color: inArc ? PAL.amber : PAL.panelLight, align: 'center' }, inArc ? 1 : 0, true);
      }
    }

    // S2: Schützlinge (unter Projektilen und Gegnern, über Asteroiden)
    const escEnv = { toS, inB, visible, lab, block, B, cx, cy, front, t, ship, space, rot, mode: cfg.mode };
    try { drawEscortsInSpace(ctx, view, escEnv); } catch (e) { report('Render.escorts', e); }

    // Strahlen: §20.1 aus dem lokalen Speicher, gezeichnet erst nach Gegnern und Schiff (z-Order); hier nur Projektile
    if (st !== lastIngested) { lastIngested = st; try { ingestSnap(st); } catch (e) { report('Render.ingestSnap', e); } }
    const sperrList = [];
    for (const pr of view.spaceProjectiles || []) {
      if (!pr || !isFinite(pr.x) || !isFinite(pr.y)) continue;
      if (!visible(pr.x, pr.y)) continue;
      const s = toS(pr.x, pr.y);
      if (pr.kind === 'sperrfeuer') { if (inB(s, 40)) sperrList.push({ pr, s }); continue; }   // S2b: über den Gegnern gezeichnet
      if (!inB(s, 8)) continue;
      if (!art('drawProjectile', 'drawProjectile:' + pr.kind, [ctx, pr.kind, s.x, s.y, (pr.angle || 0) + rot, t])) {
        ctx.fillStyle = pr.kind === 'enemy' || pr.kind === 'emp' ? PAL.red : PAL.amber; ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
    }

    // Gegner
    const offscreen = [];
    const tscan = sship.tscan || {};
    const sensR = sensorRange(st);
    // M3a: Ladungen (tele) – Taktik sieht sie ab Beginn, Captain/Steuer erst in den letzten captainSeesLast s
    const teleLate = cfgM3('tele.captainSeesLast', 1.2);
    const teleMode = cfg.teleVis || (cfg.mode === 'tactical' ? 'all' : 'late');
    const teleShown = (e) => !!(e && e.tele && teleMode !== 'none' && (teleMode === 'all' || (+e.tele.left || 0) <= teleLate));
    const teleList = [];
    const now0 = performance.now() / 1000;
    for (const e of view.enemies || []) {
      if (!visible(e.x, e.y)) continue;
      if (!front && Math.hypot(e.x - ship.x, e.y - ship.y) > sensR) continue;   // Sensorreichweite filtert der Client
      const s = toS(e.x, e.y);
      const hpFrac = e.hpMax ? e.hp / e.hpMax : 1;
      const size = ENEMY_SIZE[e.kind] || 16;
      if (e.st === 'treibt') {   // B1 §7: kampfunfähig – ohne Waffen, Ziel, Anflug, Ladung; nur gedimmt mit Hinweis
        if (!inB(s, size)) continue;
        ctx.save(); ctx.globalAlpha = 0.55;
        if (!artEnemy(ctx, e.kind, s.x, s.y, (e.angle || 0) + rot, { hpFrac: 0, hitT: 99, time: t, tele: null })) fbEnemy(ctx, e.kind, s.x, s.y, (e.angle || 0) + rot, t, 99);
        ctx.restore();
        if (!front) block(s.x - size, s.y - size, size * 2, size * 2);
        lab('TREIBT · ENTERN', s.x, s.y + size + 6, { color: PAL.amber, align: 'center' }, 2);
        continue;
      }
      const tShown = teleShown(e);
      if (tShown) teleList.push({ e, s, on: inB(s, 0) });
      // M3b §5: Jäger im Anflug – gestrichelte Anfluglinie bis knapp hinter den nächsten Punkt zum Schiff (Taktik/Captain),
      // auch wenn der Jäger noch außerhalb der Karte ist (die Linie ragt ins Bild)
      if (!front && (e.state === 'approach' || e.state === 'app') && isFinite(e.vx) && isFinite(e.vy)) {
        try { drawApproachLine(ctx, e, ship, toS, t, lab); } catch (err) { report('Render.approach', err); }
      }
      if (!inB(s, 0)) { offscreen.push({ e, s }); continue; }
      const hitT = view.enemyHit && view.enemyHit[e.id] != null ? view.enemyHit[e.id] : 99;
      if (cfg.intel && e.scanned) drawEnemyIntel(ctx, e, s.x, s.y, zoom, rot, !target || target.id === e.id, tShown);
      if (e.kind === 'relay') drawRelay(ctx, s.x, s.y, t, hitT);
      else if (!artEnemy(ctx, e.kind, s.x, s.y, (e.angle || 0) + rot, { hpFrac, hitT, time: t, tele: tShown ? e.tele : null })) fbEnemy(ctx, e.kind, s.x, s.y, (e.angle || 0) + rot, t, hitT);
      enemyHpBar(ctx, e, s.x, s.y - size - 8, now0);
      if (!front) block(s.x - size, s.y - size - 8, size * 2, size * 2 + 8);
      if (clicks && !front) clicks.push({ id: e.id, x: s.x - size - 4, y: s.y - size - 4, w: size * 2 + 8, h: size * 2 + 8 });
      const isTarget = target && target.id === e.id;
      if (!front && !isTarget) {
        const r = size + 6;
        if (e.kind === 'raider') {
          ctx.strokeStyle = 'rgba(224,71,60,' + (0.7 + 0.3 * Math.sin(t * 4)) + ')'; ctx.lineWidth = 1;
          for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            ctx.beginPath(); ctx.moveTo(s.x + qx * r + 0.5, s.y + qy * (r - 5) + 0.5); ctx.lineTo(s.x + qx * r + 0.5, s.y + qy * r + 0.5); ctx.lineTo(s.x + qx * (r - 5) + 0.5, s.y + qy * r + 0.5); ctx.stroke();
          }
        }
        lab(ENEMY_SHORT[e.kind] || (ENEMY_NAMES[e.kind] || e.kind).toUpperCase(), s.x, s.y + r + 2, { color: e.kind === 'relay' ? PAL.amber : e.kind === 'sentinel' || e.kind === 'pylon' ? PAL.ice : PAL.red, align: 'center' }, 3);
      }
      if (isTarget && !front) {
        const r = size + 5 + Math.round(Math.sin(t * 6));
        ctx.strokeStyle = PAL.amber; ctx.lineWidth = 2;
        for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath(); ctx.moveTo(s.x + qx * r, s.y + qy * (r - 6)); ctx.lineTo(s.x + qx * r, s.y + qy * r); ctx.lineTo(s.x + qx * (r - 6), s.y + qy * r); ctx.stroke();
        }
        lab('ZIEL', s.x, s.y + size + 8, { color: PAL.amber, align: 'center' }, 4);
      }
    }
    // S2b: Sperrfeuer und Mündungsblitze über den Gegnern (sonst verdeckt das Kanonenboot den Abschuss)
    for (const o of sperrList) { try { drawSperrfeuerShot(ctx, o.pr, o.s, ship, toS, rot, t, cfg.mode); } catch (e) { report('Render.sperrfeuer', e); } }
    try { drawSperrMuzzles(ctx, toS, cfg.mode); } catch (e) { report('Render.sperrMuzzle', e); }
    // S2: Bedrohungslinien gescannter Gegner auf Schützlinge
    try { drawEscortThreats(ctx, view, escEnv); } catch (e) { report('Render.escortThreats', e); }
    // M3a: Ladungen – höchstens 3 Countdowns gleichzeitig (die kürzesten zuerst)
    teleList.sort((a, b) => (+a.e.tele.left || 0) - (+b.e.tele.left || 0));
    teleList.forEach((o, i) => {
      try {
        if (o.on) drawTele(ctx, o.e, o.s, cx, cy, t, i < 3, lab);
        else if (i < 3) arrow(o.e.x, o.e.y, '#FF5A4A', (o.e.tele.sector != null ? SECTOR_SHORT[o.e.tele.sector] + ' ' : '') + fmt1(o.e.tele.left));
      } catch (e) { report('Render.tele', e); }
    });
    // Ziel-Scan-Fortschritt (Taktik)
    if (!front && tscan.targetId && (tscan.progress || 0) > 0) {
      const tg = (view.enemies || []).find(e => e.id === tscan.targetId) || (space.hidden || []).find(h => h.id === tscan.targetId) || (tscan.targetId === 'station' ? stationOf(space) : null);
      if (tg) {
        const s = toS(tg.x, tg.y);
        const r = (ENEMY_SIZE[tg.kind] || 14) + 12;
        ring(ctx, s.x, s.y, r, tscan.progress, PAL.mint);
        lab('SCAN ' + Math.round(tscan.progress * 100) + ' %', s.x, s.y - r - 12, { color: PAL.mint, align: 'center' }, 5);
      }
    }

    // Schiff
    const sh = sship.shields || {};
    const hitInfo = view.shipHit || {};
    // M3b: Triebwerksflamme nach Fahrtstufe (helm.stage/stages); Altfeld thrust nur als Fallback
    const hh = sship.helm || {};
    const stg = Number.isInteger(hh.stage) && Array.isArray(hh.stages) ? hh.stages : null;
    const thrust = stg ? Math.max(0, (+stg[hh.stage] || 0) / Math.max(1, ...stg.map(Number))) : Math.max(0, hh.thrust || 0);
    const shipOpts = { thrust, shields: sh.current || [0, 0, 0, 0], shieldMax: 4, hitSector: hitInfo.sector, hitT: hitInfo.t != null ? hitInfo.t : 99, time: t,
      // M3a: Außenansicht (Rauch/Funken an Systemen), Schild-Kappung, Schildstoß, bedrohte Sektoren
      systems: sship.systems || null, fragile: sship.fragile || null, shieldCap: sh.cap || null,
      burst: null,   // M3b: Schildstoß entfällt
      teleSectors: teleList.map(o => o.e.tele.sector).filter(v => v != null) };
    { const br = Math.round(46 * shipScale) + 8; block(cx - br, cy - br, br * 2, br * 2); }   // B3-NACH: keine Labels über der Lerche
    ctx.save(); ctx.translate(cx, cy); ctx.scale(shipScale, shipScale);
    const shipDrawn = art('drawShip', null, [ctx, 0, 0, (ship.angle || 0) + rot, shipOpts]);
    ctx.restore();
    if (!shipDrawn) {
      ctx.save(); ctx.translate(cx, cy); ctx.scale(shipScale, shipScale); ctx.rotate((ship.angle || 0) + rot);
      ctx.fillStyle = PAL.panelLight; ctx.beginPath(); ctx.moveTo(36, 0); ctx.lineTo(-30, -14); ctx.lineTo(-36, 0); ctx.lineTo(-30, 14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.brass; ctx.fillRect(-36, -4, 8, 8);
      ctx.fillStyle = PAL.amber; ctx.fillRect(14, -12, 8, 3); ctx.fillRect(14, 9, 8, 3);   // zwei Phasenkanonen vorn
      if (thrust > 0) { ctx.fillStyle = PAL.amber; ctx.fillRect(-44 - Math.random() * 4, -3, 8, 6); }
      ctx.restore();
    }
    // Schildbögen je Sektor (Stärke = Dicke/Helligkeit, Soll = Strichlinie, Treffer = Blitz)
    const cur = sh.current || [0, 0, 0, 0], alloc = sh.alloc || [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const mid = (ship.angle || 0) + rot + i * Math.PI / 2;
      const a0 = mid - Math.PI / 4 + 0.1, a1 = mid + Math.PI / 4 - 0.1;
      const flash = hitInfo.sector === i && hitInfo.t != null && hitInfo.t < 0.4;
      const sr = Math.round(46 * shipScale);
      if (alloc[i] > 0) { ctx.strokeStyle = 'rgba(169,214,229,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(cx, cy, sr + 4, a0, a1); ctx.stroke(); ctx.setLineDash([]); }
      for (let k = 0; k < (cur[i] || 0); k++) {
        ctx.strokeStyle = flash ? PAL.star : 'rgba(127,224,194,' + (0.55 + k * 0.1) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, sr + k * 3, a0, a1); ctx.stroke();
      }
      if (flash) {
        ctx.strokeStyle = cur[i] ? PAL.star : PAL.red; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, sr + 6, a0, a1); ctx.stroke();
      }
      // M3a: Emitter-Kappung (½ gepunktet, AUS rot gestrichelt mit X) und Schildstoß (weißer Bogen, perfekt mit Ring)
      const cap = Array.isArray(sh.cap) ? +sh.cap[i] : 4;
      if (cap <= 0) {
        ctx.strokeStyle = 'rgba(224,71,60,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(cx, cy, sr, a0, a1); ctx.stroke(); ctx.setLineDash([]);
        crossX(ctx, cx + Math.cos(mid) * sr - 3, cy + Math.sin(mid) * sr - 3, 7, 7, PAL.red, 1);
      } else if (cap < 4) {
        ctx.strokeStyle = 'rgba(242,201,76,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([1, 2]);
        for (let k = cap; k < 4; k++) { ctx.beginPath(); ctx.arc(cx, cy, sr + k * 3, a0, a1); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      if (teleList.some(o => o.e.tele.sector === i)) {
        ctx.strokeStyle = 'rgba(255,90,74,' + (0.5 + 0.5 * Math.sin(t * 10)) + ')'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(cx, cy, sr + 9, a0, a1); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // §20.1/§20.3: Strahlen, Mündungsblitze, Visierlinie der Lanze – über Schiff und Gegnern
    try { drawLanceSight(ctx, view, ship, sship, toS, zoom, t, lab, front); } catch (e) { report('Render.lanceSight', e); }
    try { drawBeamsFx(ctx, toS, t, ship); } catch (e) { report('Render.beams', e); }
    try { drawMuzzles(ctx, sship, ship, rot, shipScale, cx, cy, t); } catch (e) { report('Render.muzzles', e); }

    // Weitscan-Puls
    const ws = sship.widescan || {};
    if (ws.pulseAt != null && st.time != null) {
      const age = st.time - ws.pulseAt;
      if (age >= 0 && age < 1.6) {
        const r = Math.min(1000, 1000 * age / 1.2) * zoom;
        ctx.strokeStyle = 'rgba(127,224,194,' + Math.max(0, 0.8 - age * 0.5) + ')'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Marker für den Piloten (Captain Mint, Taktik Bernstein) – immer sichtbar (auch im Nebel)
    const drawMarkers = () => {
      const mk = markersOf(st);
      for (const who of ['captain', 'tactical']) {
        const m = mk[who];
        if (!m) continue;
        const s = toS(m.x, m.y);
        const dist = Math.round(Math.hypot(m.x - ship.x, m.y - ship.y));
        if (inB(s, -6)) { diamondMarker(ctx, s.x, s.y, MARKER_COL[who], t, null); lab(MARKER_NAMES[who] + ' ' + dist, s.x, s.y + 11, { color: MARKER_COL[who], align: 'center' }, 6); }
        else arrow(m.x, m.y, MARKER_COL[who], MARKER_NAMES[who] + ' ' + dist);
      }
    };
    if (!cfg.markersLater) drawMarkers();

    // Randpfeile für Gegner außerhalb (nur Karten; der Pilot verlässt sich auf die Taktik)
    if (!front) for (const o of offscreen) {
      const e = arrow(o.e.x, o.e.y, o.e.kind === 'gunboat' ? PAL.rust : PAL.red, String(Math.round(Math.hypot(o.e.x - ship.x, o.e.y - ship.y))));
      if (clicks) clicks.push({ id: o.e.id, x: e.x - 10, y: e.y - 10, w: 20, h: 20 });
    }

    // Weltraum-Effekte (Explosionen)
    const now = performance.now() / 1000;
    for (const f of liveFx(now)) {
      if (!f.space) continue;
      const s = toS(f.x, f.y);
      drawFx(ctx, f.kind, s.x, s.y, t, { p: (now - f.t0) / f.dur });
    }
    flushLabels();
    ctx.restore();
    // Marker nachträglich (Frontsicht: über dem Nebel), im selben Sichtausschnitt
    const markersLayer = () => { ctx.save(); ctx.beginPath(); ctx.rect(B.x, B.y, B.w, B.h); ctx.clip(); drawMarkers(); flushLabels(); ctx.restore(); };
    return { toS, toW, zoom, cx, cy, markersLayer };
  }

  // Taktik/Lage: Karte mit Schiff in der Mitte, Norden oben. opts = { zoom, arcs, intel, enemyRects, showRanges }
  function drawTactical(ctx, view, rect, opts) {
    opts = opts || {};
    const res = drawSpace(ctx, view, rect, Object.assign({ mode: opts.mode || 'tactical', cx: Math.round(rect.x + rect.w / 2), cy: Math.round(rect.y + rect.h / 2), zoom: opts.zoom || 0.35, rot: 0 }, opts));
    ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    return res;
  }

  // Steuer: Frontsicht (M1 §4.1). Bug oben, Schiff im unteren Teil, vorn ≈ 700, seitlich ± 420, hinten ≈ 120.
  const FRONT = { fwd: 700, back: 120, side: 420 };
  function drawFrontView(ctx, view, rect) {
    const st = view.state, ship = view.ship || st.ship || {};
    const fog = inFog(st);
    const zoom = rect.h / (FRONT.fwd + FRONT.back);
    const cx = rect.x + Math.round(rect.w / 2), cy = rect.y + Math.round(FRONT.fwd * zoom);
    const half = Math.round(FRONT.side * zoom);
    const win = { x: cx - half, y: rect.y, w: half * 2, h: rect.h };
    const res = drawSpace(ctx, view, rect, { mode: 'front', zoom, rot: -(ship.angle || 0) - Math.PI / 2, cx, cy, bound: win, sight: fog ? FRONT.fwd * 0.5 : Infinity, navArrows: true, markersLater: true });
    const t = view.time;
    if (fog) {
      ctx.save(); ctx.beginPath(); ctx.rect(win.x, win.y, win.w, win.h); ctx.clip();
      const gr = ctx.createRadialGradient(cx, cy, FRONT.fwd * 0.18 * zoom, cx, cy, FRONT.fwd * 0.55 * zoom);
      gr.addColorStop(0, 'rgba(42,35,80,0)'); gr.addColorStop(0.7, 'rgba(42,35,80,0.75)'); gr.addColorStop(1, 'rgba(36,30,66,0.96)');
      ctx.fillStyle = gr; ctx.fillRect(win.x, win.y, win.w, win.h);
      ctx.fillStyle = 'rgba(142,163,181,0.06)';
      for (let i = 0; i < 6; i++) { const y = win.y + ((i * 53 + t * 18) % win.h); ctx.fillRect(win.x, Math.round(y), win.w, 6 + (i % 3) * 3); }
      ctx.restore();
      text(ctx, 'NEBEL – SICHT HALBIERT', cx, win.y + 4, { color: PAL.ice, align: 'center' });
    }
    res.markersLayer();
    // Cockpitfenster: Messingrahmen, abgeschrägte Ecken, Streben
    ctx.fillStyle = '#121822';
    ctx.beginPath(); ctx.moveTo(win.x, win.y); ctx.lineTo(win.x + 18, win.y); ctx.lineTo(win.x, win.y + 18); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(win.x + win.w, win.y); ctx.lineTo(win.x + win.w - 18, win.y); ctx.lineTo(win.x + win.w, win.y + 18); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.brass; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(win.x + 18, win.y + 1); ctx.lineTo(win.x + win.w - 18, win.y + 1); ctx.lineTo(win.x + win.w - 1, win.y + 18);
    ctx.lineTo(win.x + win.w - 1, win.y + win.h - 1); ctx.lineTo(win.x + 1, win.y + win.h - 1); ctx.lineTo(win.x + 1, win.y + 18); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = PAL.brass;
    for (const yy of [0.33, 0.66]) { ctx.fillRect(win.x - 4, Math.round(win.y + win.h * yy), 4, 6); ctx.fillRect(win.x + win.w, Math.round(win.y + win.h * yy), 4, 6); }
    // Peilstriche (Bug-Achse)
    ctx.fillStyle = 'rgba(255,198,107,0.5)';
    for (let i = 1; i <= 3; i++) ctx.fillRect(cx, Math.round(cy - i * 200 * zoom), 1, 5);
    text(ctx, '200', cx + 3, Math.round(cy - 200 * zoom) - 2, { color: 'rgba(255,198,107,0.6)' });
    return Object.assign(res, { win, zoom, cx, cy });
  }

  // ------------------------------------------------------------------ Sternkarte (Captain, Planungstisch)
  // opts = { selected, mouse, rects (füllt Klickflächen je Ort), pins: bool, highlightPin }
  // B3 (Welle 0, CONTRACT-B3 §8): drawStarMap delegiert an window.StarMap.draw (Team KARTE, public/js/starmap.js);
  // die bisherige Punktkarte heißt jetzt drawStarMapAlt und ist der Rückfall (auch für den StarMap-Stub).
  function drawStarMap(ctx, view, rect, opts) {
    if (window.StarMap && typeof window.StarMap.draw === 'function') return window.StarMap.draw(ctx, view, rect, opts);
    return drawStarMapAlt(ctx, view, rect, opts);
  }
  function drawStarMapAlt(ctx, view, rect, opts) {
    opts = opts || {};
    const st = view.state;
    const w = worldOf(st);
    const t = view.time;
    const D = STAR_DOMAIN;
    const sc = Math.min(rect.w / (D.x1 - D.x0), rect.h / (D.y1 - D.y0));
    const ox = rect.x + (rect.w - (D.x1 - D.x0) * sc) / 2, oy = rect.y + (rect.h - (D.y1 - D.y0) * sc) / 2;
    const toS = (x, y) => ({ x: Math.round(ox + (x - D.x0) * sc), y: Math.round(oy + (y - D.y0) * sc) });
    // Sternkarten-Koordinaten laut Server 0–900 × 0–600 (Pins): geklemmt
    const toW = (sx, sy) => ({ x: Math.max(0, Math.min(900, Math.round(D.x0 + (sx - ox) / sc))), y: Math.max(0, Math.min(600, Math.round(D.y0 + (sy - oy) / sc))) });
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.fillStyle = '#070B14'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.save(); ctx.translate(rect.x, rect.y);
    if (!art('drawStarfield', null, [ctx, 0, 0, rect.w, rect.h, t])) fbStarfield(ctx, 0, 0, rect.w, rect.h, t);
    ctx.restore();
    ctx.fillStyle = 'rgba(7,11,20,0.45)'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    const locs = w.locations.filter(locVisible);
    const byId = {}; for (const l of locs) byId[l.id] = l;
    // Nebel-Wolke um die Graue Weite
    for (const l of locs) if (l.fog || l.kind === 'nebula') {
      const s = toS(l.x, l.y);
      const gr = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, 60 * sc / 0.6);
      gr.addColorStop(0, 'rgba(42,35,80,0.85)'); gr.addColorStop(1, 'rgba(42,35,80,0)');
      ctx.fillStyle = gr; ctx.fillRect(s.x - 120, s.y - 120, 240, 240);
    }
    // Verbindungen
    const drawn = {};
    for (const l of locs) for (const lid of l.links || []) {
      const o = byId[lid];
      if (!o) continue;
      const key = l.id < lid ? l.id + lid : lid + l.id;
      if (drawn[key]) continue; drawn[key] = 1;
      const a = toS(l.x, l.y), b = toS(o.x, o.y);
      const solid = l.known && o.known;
      ctx.strokeStyle = solid ? 'rgba(201,151,74,0.7)' : 'rgba(142,163,181,0.45)'; ctx.lineWidth = solid ? 2 : 1;
      if (!solid) ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    }
    const dest = st.ship && st.ship.jump && st.ship.jump.dest;
    if (opts.rects) opts.rects.length = 0;
    for (const l of locs) {
      const s = toS(l.x, l.y);
      const here = l.id === w.location;
      const hover = opts.mouse && Math.hypot(opts.mouse.x - s.x, opts.mouse.y - s.y) < 14;
      if (here) { ctx.strokeStyle = 'rgba(127,224,194,' + (0.6 + 0.3 * Math.sin(t * 3)) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 13, 0, Math.PI * 2); ctx.stroke(); }
      if (dest === l.id) { ctx.strokeStyle = PAL.amber; ctx.lineWidth = 2; ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.arc(s.x, s.y, 17, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      if (opts.selected === l.id || hover) { ctx.strokeStyle = PAL.star; ctx.lineWidth = 1; ctx.strokeRect(s.x - 15.5, s.y - 15.5, 31, 31); }
      const iconName = l.known ? 'loc_' + (l.kind === 'nebula' ? 'nebula' : l.kind) : 'loc_unknown';
      if (!artIcon(ctx, iconName, s.x, s.y, {})) {
        const col = !l.known ? PAL.panelLight : { port: PAL.brass, asteroids: PAL.smoke, buoy: PAL.mint, trader: PAL.moss, wreck: PAL.rust, nebula: '#6A5FB0', relay: PAL.ice, moon: KESH_VIOLET }[l.kind] || PAL.star;
        ctx.fillStyle = PAL.space; ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill();
        text(ctx, l.known ? ({ port: 'H', asteroids: 'A', buoy: 'B', trader: 'V', wreck: 'W', nebula: 'N', relay: 'K', moon: 'M' }[l.kind] || '•') : '?', s.x, s.y - 3, { color: PAL.space, align: 'center', shadow: false });
      }
      const nm = l.known ? (l.name || l.id) : 'Unbekanntes Signal ?';
      const half = measure(nm, 1) / 2 + 3;
      const lx = Math.max(rect.x + half, Math.min(rect.x + rect.w - half, s.x));
      text(ctx, nm, lx, s.y + 12, { color: here ? PAL.mint : l.known ? PAL.star : PAL.panelLight, align: 'center' });
      const sub = [];
      if (here) sub.push('HIER');
      if (dest === l.id) sub.push('SPRUNGZIEL');
      const dsc = l.discoveries;
      if (l.known && dsc && dsc.total) sub.push('Funde ' + (dsc.found || 0) + '/' + dsc.total);
      if (sub.length) text(ctx, sub.join(' · '), Math.max(rect.x + measure(sub.join(' · '), 1) / 2 + 3, Math.min(rect.x + rect.w - measure(sub.join(' · '), 1) / 2 - 3, s.x)), s.y + 22, { color: dest === l.id ? PAL.amber : PAL.panelLight, align: 'center' });
      if (opts.rects) opts.rects.push({ id: l.id, x: s.x - 16, y: s.y - 16, w: 32, h: 32 });
    }
    if (opts.pins !== false) for (const pin of (st.plan && st.plan.pins) || []) {
      if (pin.map !== 'star') continue;
      const s = toS(pin.x, pin.y);
      drawPin(ctx, pin, s.x, s.y, st, { highlight: opts.highlightPin === pin.id });
    }
    ctx.restore();
    ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    return { toS, toW, scale: sc };
  }

  // Detailkarte eines Orts (Planungstisch): Außenkarte als Kachelkarte oder Szenenübersicht.
  function drawLocalMap(ctx, view, rect, mapId, opts) {
    opts = opts || {};
    const st = view.state;
    const t = view.time;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.fillStyle = '#070B14'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    let toS, toW;
    // 'kesh' = Orts-ID und Archivplan: vor dem Scan (Ort ohne map) die Detailkarte der Szene zeigen
    const keshLoc = mapId === 'kesh' ? locById(st, 'kesh') : null;
    const tmap = keshLoc && keshLoc.map !== 'kesh' ? null : mapById(mapId);
    if (tmap && mapId !== 'ship') {
      const c = Math.max(2, Math.floor(Math.min((rect.w - 8) / tmap.w, (rect.h - 8) / tmap.h)));
      const ox = rect.x + Math.floor((rect.w - tmap.w * c) / 2), oy = rect.y + Math.floor((rect.h - tmap.h * c) / 2);
      const obj = mapId === 'wreck' ? OBJ_WRECK : OBJ;
      for (let ty = 0; ty < tmap.h; ty++) for (let tx = 0; tx < tmap.w; tx++) {
        const ch = tmap.at(tx, ty);
        if (ch === ' ' || ch === '~') continue;
        let col = '#2A3446';
        if (mapId === 'kesh') col = ch === 'R' ? '#16131A' : ch === '#' ? '#5A5166' : ch === '.' ? '#4A4034' : ch === 'P' ? '#3D6A60' : ch === 'o' ? '#8A8294' : ch === 'I' ? '#B8AEC4' : ch === 'r' ? PAL.red : ch === 'k' ? KESH_VIOLET : ch === 'G' ? '#7A3FB0' : ch === 'T' ? '#D9A441' : '#2E2B36';
        else if (ch === '#') col = '#55677E';
        else if (ch === 'P') col = '#3D6A60';
        else if (ch === 'h') col = PAL.rust;
        else if (ch === 'g') col = PAL.mint;
        else if (ch === 'V') col = '#3B3A44';
        else if (ch === 'L') col = PAL.red;
        else if (ch === 'Z') col = PAL.amber;
        else if (ch === 'b') col = PAL.indigo;
        else if (obj[ch]) col = '#3B4658';
        ctx.fillStyle = col; ctx.fillRect(ox + tx * c, oy + ty * c, c, c);
      }
      toS = (x, y) => ({ x: Math.round(ox + x / TILE * c), y: Math.round(oy + y / TILE * c) });
      toW = (sx, sy) => ({ x: Math.round((sx - ox) / c * TILE), y: Math.round((sy - oy) / c * TILE) });
      if (mapId === 'wreck') { const hv = st.away && st.away.hollow; if (hv && hv.marked) { const tt = toTileXY(tmap, hv.x, hv.y); ctx.strokeStyle = PAL.amber; ctx.strokeRect(ox + tt.x * c - 0.5, oy + tt.y * c - 0.5, c + 1, c + 1); } }
      text(ctx, mapId === 'wreck' ? 'WRACK „ZAUNKÖNIG“ – Decksplan' : mapId === 'kesh' ? 'MOND KESH – Kustoden-Archiv' : 'PLATTFORM B-7 – Decksplan', rect.x + 6, rect.y + 4, { color: PAL.brass });
      if (tmap.fallback) text(ctx, '(Entwurf – Karte vom Server fehlt)', rect.x + 6, rect.y + 14, { color: PAL.panelLight });
    } else {
      // Szene eines Orts. Aktueller Ort: Sensordaten; sonst schematisch.
      const w = worldOf(st);
      const loc = locById(st, mapId) || {};
      const here = mapId === w.location;
      const space = here ? (st.space || {}) : {};
      // Szenengröße wie der Server (shared/locations.js), damit Pins auf fremden Detailkarten am richtigen Fleck landen
      const SLx = window.Shared_Locations, scn = SLx && SLx.get ? ((SLx.get(mapId) || {}).scene || {}) : {};
      const sw = (here && space.w) || scn.w || loc.w || 3000, sh = (here && space.h) || scn.h || loc.h || 2000;
      const s0 = Math.min((rect.w - 8) / sw, (rect.h - 8) / sh);
      const ox = rect.x + (rect.w - sw * s0) / 2, oy = rect.y + (rect.h - sh * s0) / 2;
      toS = (x, y) => ({ x: Math.round(ox + x * s0), y: Math.round(oy + y * s0) });
      toW = (sx, sy) => ({ x: Math.round((sx - ox) / s0), y: Math.round((sy - oy) / s0) });
      ctx.fillStyle = (loc.fog || loc.kind === 'nebula') ? '#141028' : '#0A111C'; ctx.fillRect(Math.round(ox), Math.round(oy), Math.round(sw * s0), Math.round(sh * s0));
      ctx.strokeStyle = PAL.panel; ctx.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, Math.round(sw * s0) - 1, Math.round(sh * s0) - 1);
      if (here) {
        ctx.fillStyle = '#5A5560';
        for (const a of brockenJetzt(st)) { const s = toS(a.x, a.y); const r = Math.max(1, Math.round(a.r * s0)); ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2); }   // W2: bewegt
        for (const m of space.markers || []) {
          const s = toS(m.x, m.y);
          ctx.strokeStyle = m.kind === 'exit' || m.kind === 'dock' ? PAL.mint : PAL.amber;
          ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(4, (m.r || 40) * s0), 0, Math.PI * 2); ctx.stroke();
          text(ctx, ({ dock: 'Dock-Ring', exit: 'Sprungpunkt' }[m.kind] || (STATION_LABEL[m.kind] || '').toLowerCase().replace(/^./, c => c.toUpperCase())), s.x, s.y + 6, { color: ctx.strokeStyle, align: 'center' });
        }
        for (const h of space.hidden || []) { const s = toS(h.x, h.y); fbHidden(ctx, h.kind, s.x, s.y, t); }
        for (const e of view.enemies || space.enemies || []) { const s = toS(e.x, e.y); ctx.fillStyle = e.st === 'treibt' ? PAL.amber : e.kind === 'pylon' || e.kind === 'sentinel' ? PAL.ice : PAL.red; ctx.fillRect(s.x - 2, s.y - 2, 4, 4); }
        const vs = view.ship || st.ship || {};
        if (isFinite(vs.x)) { const s = toS(vs.x, vs.y); ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(vs.angle || 0); ctx.fillStyle = PAL.mint; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore(); }
        text(ctx, 'SENSORDATEN (aktuell)', rect.x + 6, rect.y + 4, { color: PAL.mint });
      } else {
        const c = toS(sw / 2, sh / 2);
        if (!artIcon(ctx, 'loc_' + (loc.known ? loc.kind : 'unknown'), c.x, c.y, {})) { ctx.fillStyle = PAL.panel; ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0, Math.PI * 2); ctx.fill(); }
        text(ctx, loc.known ? (LOC_KIND_NAMES[loc.kind] || loc.kind || '') : 'Unbekannt', c.x, c.y + 12, { color: PAL.panelLight, align: 'center' });
        text(ctx, 'Keine aktuellen Sensordaten – Skizze aus dem Logbuch', rect.x + 6, rect.y + 4, { color: PAL.panelLight });
      }
    }
    for (const pin of (st.plan && st.plan.pins) || []) {
      if (pin.map !== mapId) continue;
      const s = toS(pin.x, pin.y);
      drawPin(ctx, pin, s.x, s.y, st, { highlight: opts.highlightPin === pin.id });
    }
    ctx.restore();
    ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    return { toS, toW };
  }


  function drawRelay(ctx, x, y, t, hitT) {
    const flash = hitT < 0.15;
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(t * 0.8);
    ctx.fillStyle = '#4F6178'; ctx.fillRect(-11, -2, 22, 4);                 // Solarflügel
    ctx.fillStyle = flash ? '#FFFFFF' : '#2A2350'; ctx.fillRect(-11, -1, 6, 2); ctx.fillRect(5, -1, 6, 2);
    ctx.fillStyle = flash ? '#FFFFFF' : '#C9974A'; ctx.fillRect(-4, -4, 8, 8); // Kern (Messing)
    ctx.fillStyle = (Math.floor(t * 3) % 2) ? '#E0473C' : '#FFC66B'; ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  function edgeArrow(ctx, x, y, ang, color) {
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(ang);
    ctx.fillStyle = color; ctx.strokeStyle = PAL.space; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -6); ctx.lineTo(-2, 0); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ Mini-Plan (Schiff oder Plattform)
  // opts: { zone, cell, showDrones, highlight }
  function drawMiniPlan(ctx, view, x, y, opts) {
    opts = opts || {};
    const st = view.state;
    const zone = opts.zone || 'ship';
    const map = mapFor(zone, st);
    const c = opts.cell || 3;
    const reactor = (st.ship && st.ship.reactor) || {};
    const t = view.time;
    ctx.fillStyle = 'rgba(11,14,26,0.8)'; ctx.fillRect(x - 2, y - 2, map.w * c + 4, map.h * c + 4);
    const away = st.away || {};
    const doorOpen = !!(away.doorOpen || (away.sonde && away.sonde.disabled));
    const blinkM = Math.floor(t * 3) % 2 === 0;
    const keshMap = map.id === 'kesh';
    const kSolid = keshMap ? solidFn(map, st) : null;
    const buehneMap = zone === 'away' && isBuehne(map);
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const ch = map.at(tx, ty);
      if (ch === ' ' || ch === '~') continue;
      let col;
      if (buehneMap) { col = buehneKachelFarbe(map, st, tx, ty); if (col) { ctx.fillStyle = col; ctx.fillRect(x + tx * c, y + ty * c, c, c); } continue; }   // B1
      if (keshMap) {
        // M2: Kesh – Fels dunkel, Mauer, Boden, Deckung, Relais/Schlüssel/Tor/Tafel
        if (ch === 'R') continue;
        if (ch === '#') col = '#5A5166';
        else if (ch === '.') col = '#4A4034';
        else if (ch === 'P') col = '#3D6A60';
        else if (ch === 'o') col = '#8A8294';
        else if (ch === 'I') col = '#B8AEC4';
        else if (ch === 'r') { const js = keshObjState(st, map, tx, ty).jammer; col = js && js.off ? '#4A4550' : PAL.red; }
        else if (ch === 'k') col = KESH_VIOLET;
        else if (ch === 'G') col = kSolid(tx, ty) ? '#7A3FB0' : '#2E2B36';
        else if (ch === 'T') col = away.tablet && away.tablet.taken ? '#5A5262' : '#D9A441';
        else col = '#2E2B36';
        ctx.fillStyle = col; ctx.fillRect(x + tx * c, y + ty * c, c, c);
        continue;
      }
      if (ch === '#') col = '#55677E';
      else if (FLOOR[ch]) col = ch === ',' ? '#5A4030' : '#2A3446';
      else if (sysOf(map, ch)) { const sy = sysOf(map, ch); const s = sysState(st, sy); col = s === 'broken' ? (blinkM ? PAL.red : '#8A2A24') : s === 'damaged' ? PAL.warn : s === 'offline' ? OFFLINE_COL : (zone === 'ship' && fragileOf(st, sy)) ? FRAGILE_COL : PAL.moss; }
      else if (consoleOf(map, ch)) col = PAL.mint;
      else if (ch === 'L' && zone === 'away') col = doorOpen ? PAL.moss : PAL.red;
      else if (zone === 'ship' && objKindOf(map, ch) === 'shelf') col = shelfStock(st.inventory, shelfItemAt(tx, ty)) <= 0 ? '#5A2A26' : PAL.wood;
      else if (ch === 'Z' && zone === 'away') col = PAL.amber;
      else if (zone === 'ship' && objKindOf(map, ch) === 'reactor_switch') col = reactor.state === 'offline' ? (blinkM ? PAL.red : '#5A1E1A') : PAL.brass;
      else if (zone === 'ship' && objKindOf(map, ch) === 'plan_table') col = '#3D6A60';
      else if (map.id === 'wreck' && ch === 'h') col = PAL.rust;
      else if (map.id === 'wreck' && ch === 'g') col = PAL.mint;
      else if (map.id === 'wreck' && ch === 'V') col = (away.hollow && away.hollow.open) ? '#2A3446' : (away.hollow && away.hollow.marked) ? PAL.amber : '#55677E';
      else col = '#3B4658';
      ctx.fillStyle = col; ctx.fillRect(x + tx * c, y + ty * c, c, c);
    }
    const blink = Math.floor(t * 3) % 2 === 0;
    if (buehneMap) (map.anker || []).forEach((a, i) => {   // B1: Objektanker als Punkte
      const col = ANKER_FARBE[a[1]]; if (!col || a[1] === 'tor') return;
      const z = ankerZustand(map, st, i);
      ctx.fillStyle = a[1] === 'sprengpunkt' && z === 'scharf' ? (blink ? PAL.red : '#5A1E1A') : col;
      ctx.fillRect(x + a[2] * c, y + a[3] * c, c, c);
    });
    if (zone === 'ship' && st.ship) {
      ctx.fillStyle = blink ? PAL.red : PAL.amber;
      for (const f of st.ship.fires || []) ctx.fillRect(x + f[0] * c, y + f[1] * c, c, c);
      ctx.fillStyle = PAL.ice;
      for (const b of st.ship.breaches || []) ctx.fillRect(x + b.tx * c, y + b.ty * c, c, c);
      // M0: leeres Regal = roter Punkt
      for (const sh of shelfTiles()) {
        if (shelfStock(st.inventory, sh.item) > 0) continue;
        const dot = c > 4 ? 4 : 2;
        ctx.fillStyle = blink || c > 4 ? PAL.red : '#8A2A24';
        ctx.fillRect(Math.round(x + sh.x * c + c / 2 - dot / 2), Math.round(y + sh.y * c + c / 2 - dot / 2), dot, dot);
      }
      ctx.fillStyle = PAL.brass;
      for (const b of view.bots || []) ctx.fillRect(x + Math.floor(b.x / TILE) * c, y + Math.floor(b.y / TILE) * c, c, c);
    }
    if (zone === 'away') {
      for (const it of away.items || []) { ctx.fillStyle = it.kind === 'datenkern' ? PAL.mint : PAL.star; ctx.fillRect(x + Math.floor(it.x / TILE) * c, y + Math.floor(it.y / TILE) * c, c, c); }
      const npc = view.npc;
      if (npc && npc.present !== false && !npc.rescued && !keshMap) { ctx.fillStyle = PAL.ice; ctx.fillRect(x + Math.floor(npc.x / TILE) * c, y + Math.floor(npc.y / TILE) * c, c, c); }
      const sensorOn = away.sensorUntil && st.time < away.sensorUntil;
      const v2m = isV2(st);
      for (const d of view.drones || []) {
        if (d.alive === false || !(sensorOn || aufgedeckt(d, st) || opts.showDrones || (v2m && d.vis))) continue;
        ctx.fillStyle = d.kind === 'warden' ? KESH_VIOLET : PAL.red; ctx.fillRect(x + Math.floor(d.x / TILE) * c, y + Math.floor(d.y / TILE) * c, c, c);
      }
      if (v2m) for (const o of activeOrders(st)) {
        const op = orderPos(o, view.drones);
        ctx.strokeStyle = ORDER_COL[o.kind]; ctx.strokeRect(Math.round(x + op.x / TILE * c) - 2.5, Math.round(y + op.y / TILE * c) - 2.5, 5, 5);
      }
      if (away.marker) { ctx.strokeStyle = PAL.amber; ctx.strokeRect(x + away.marker.x / TILE * c - 2.5, y + away.marker.y / TILE * c - 2.5, 5, 5); }
      for (const pin of (st.plan && st.plan.pins) || []) {
        if (pin.map !== map.id) continue;
        ctx.fillStyle = pinColor(st, pin);
        ctx.fillRect(Math.round(x + pin.x / TILE * c) - 1, Math.round(y + pin.y / TILE * c) - 4, 2, 5);
        ctx.fillRect(Math.round(x + pin.x / TILE * c), Math.round(y + pin.y / TILE * c) - 4, 3, 2);
      }
    }
    if (zone === 'ship') for (const n of view.shipNpcs || (st.ship && st.ship.npcs) || []) { ctx.fillStyle = PAL.ice; ctx.fillRect(x + Math.floor(n.x / TILE) * c, y + Math.floor(n.y / TILE) * c, c, c); }
    for (const p of view.players || []) {
      if (p.zone !== zone || p.connected === false) continue;
      const px = x + p.x / TILE * c, py = y + p.y / TILE * c;
      shape(ctx, SHAPES[p.color || 0], Math.round(px), Math.round(py), 6, PAL.players[p.color || 0], PAL.space);
    }
  }

  window.Render = {
    PAL, SHAPES, TILE, VW, VH,
    OBJ, SYS_BY_CHAR, CONSOLE_BY_CHAR,
    // M3a: Legenden-Ableitung und Schiffslayout
    legendOf, sysOf, consoleOf, objKindOf, shelfItemAt, shelfTiles,
    art, artOk, artFail,
    text, measure, wrap, panel, backdrop, shape, icon, bar, ring, edgeArrow,
    beginUi, button, clickUi, drawTooltip, ui,
    camera, mapFor, floorFor, bedAt, sysState, itemFallback, drawFx,
    SHELF_CAP, SHELF_LABEL, shelfStock, shelfFill, emptyShelves,
    addFx, drawWorld, drawTactical, drawMiniPlan, updateCamera,
    // M1
    OBJ_WRECK, mapById, wreckMap, awayMapId, toTileXY, roomAt, roomStyleOf, artK, artObject, artIcon, artItem, probe,
    // M2
    OBJ_KESH, SHIELD_COL, AIM_COL, KESH_VIOLET, ORDER_KINDS, ORDER_NAMES, ORDER_COL, ROLE_NAMES,
    isV2, cfgNum, solidFn, keshObjState, teamVision, activeOrders, orderPos, drawShieldPips, drawShieldRing, drawMediCross, drawAwayCommandMap, awayMapById,
    LOC_FALLBACK, LOC_KIND_NAMES, STAR_DOMAIN, worldOf, locById, locName, locVisible, currentLoc, inFog,
    ENEMY_NAMES, ENEMY_SIZE, MARKER_COL, MARKER_NAMES, HIDDEN_NAMES, MOUNT_LABEL, PIN_LABELS, PIN_NAMES,
    mountGeom, sensorRange, markersOf, playerColorOf, pinColor, stationOf, rayToRect, diamondMarker, drawPin, drawEnemyIntel,
    drawSpace, drawFrontView, drawStarMap, drawStarMapAlt, drawLocalMap, FRONT,
    // B1: gebaute Außenkarten
    drawKoerperStatus, statusIcon,
    registerAwayMap, isBuehne, ankerZustand, kachelZustand, kantenZustand, buehneSolid, buehnenKarten, ANKER_NAME, ANKER_ZUSTAND_NAME, ANKER_FARBE,
    // S2: Schützling
    ESCORT_COL, ESCORT_R, ESCORT_KIND_NAMES, ESCORT_STATE_NAMES, ESCORT_ORDER_NAMES, escortHpFrac, escortName, escortRingCol, escortSegBar, fbEscort, drawEscortSprite,
    // M3a
    SIDE_SHORT, STATE_SHORT, FRAGILE_COL, OFFLINE_COL, BURST_COL, MOUNT_SYS, SECTOR_SHORT,
    fragileOf, stateCode, stateColor, stateBadge, stationPlate, hatch, crossX, tape, shipStations, stationOfSystem, actionBar, cfgM3, fmt1, wedge,
    lanceDamage, lanceDamageMax, ingestSnap, resetBeamFx,
    lastState: null,
    uiDenied: null,
    // M4: im Voxel-Modus (Overlay) projiziert die 3D-Kamera; sonst wie bisher die 2D-Kamera
    worldToScreen(x, y, h) { if (overlay3d.on) return vr().worldToScreen(x, y, h || 0); return { x: x - camera.x, y: y - camera.y }; },
    screenToWorld(x, y) { if (overlay3d.on) return vr().screenToWorld(x, y); return { x: x + camera.x, y: y + camera.y }; },
    overlay3d, enemyShown,
  };
  ladeBuehnenDaten();   // B1: kacheln.json / anker.json (Auszug gilt bis dahin)
})();
