// HUD, Lobby, Ende-Overlay, Verbindungs-Overlay, Crew-Übersicht (CONTRACT.md §9). Globales `Hud`.
(function () {
  'use strict';

  const R = window.Render;
  const Maps = window.Shared_Maps;
  const CFG = window.Shared_Config || {};
  const PROTO = window.Shared_Protocol || {};
  const PAL = R.PAL;
  const TILE = 32, VW = 640, VH = 360;

  // M3a: alle 14 Systeme (+ Altname weapons = schlechteste der drei Waffen)
  const SYS_NAMES = {
    reactor: 'Reaktor', engines: 'Triebwerk', shields: 'Schildgenerator', weapons: 'Waffen', life: 'Lebenserhaltung', transfer: 'Transfer',
    // gleiche Namen wie der Server (interior.SYS_LABEL)
    thruster_port: 'Backbord-Düse', thruster_stbd: 'Steuerbord-Düse',
    emitter_bow: 'Bug-Emitter', emitter_stbd: 'Steuerbord-Emitter', emitter_aft: 'Heck-Emitter', emitter_port: 'Backbord-Emitter',
    weapon_bow: 'Bug-Waffe', battery_port: 'Backbord-Batterie', battery_stbd: 'Steuerbord-Batterie',
  };
  const SYS_SHORT = {
    reactor: 'Reaktor', engines: 'Triebwerk', shields: 'Schildgen.', weapons: 'Waffen', life: 'Leben', transfer: 'Transfer',
    thruster_port: 'Bb-Düse', thruster_stbd: 'Stb-Düse', emitter_bow: 'Bug-Emitter', emitter_stbd: 'Stb-Emitter', emitter_aft: 'Heck-Emitter',
    emitter_port: 'Bb-Emitter', weapon_bow: 'Bug-Waffe', battery_port: 'Bb-Batterie', battery_stbd: 'Stb-Batterie',
  };
  // Zwei Zeichen fürs HUD-Raster: Art + Seite (b Backbord, s Steuerbord, h Heck, v vorn/Bug)
  const SYS_CODE = {
    reactor: 'Re', shields: 'Sg', life: 'Le', transfer: 'Tr', engines: 'Tw', weapon_bow: 'La',
    thruster_port: 'Db', thruster_stbd: 'Ds', emitter_bow: 'Ev', emitter_stbd: 'Es', emitter_aft: 'Eh', emitter_port: 'Eb', battery_port: 'Bb', battery_stbd: 'Bs',
  };
  // Reihenfolge nach Ort: Bug – Backbord – Steuerbord – Heck – Mitte
  const SYSTEM_ORDER = ['weapon_bow', 'emitter_bow', 'thruster_port', 'battery_port', 'emitter_port', 'thruster_stbd', 'battery_stbd', 'emitter_stbd', 'transfer',
    'engines', 'emitter_aft', 'reactor', 'shields', 'life'];
  // HUD-Raster: obere Zeile Heck/Mitte/Bug, untere Zeile Backbord | Steuerbord
  const HUD_ROWS = [['engines', 'emitter_aft', 'reactor', 'shields', 'life', 'weapon_bow', 'emitter_bow'],
    ['thruster_port', 'battery_port', 'emitter_port', 'thruster_stbd', 'battery_stbd', 'emitter_stbd', 'transfer']];
  const ITEM_NAMES = { ersatzteil: 'Ersatzteil', loeschgel: 'Löschgel', flickblech: 'Flickblech', bolzen: 'Bolzen', medipack: 'Medipack', datenkern: 'Datenkern', tafel: 'Tafel von Kesh' };
  const STATE_NAMES = { ok: 'in Ordnung', damaged: 'beschädigt', broken: 'zerstört' };
  const CONSOLE_NAMES = { helm: 'Steuer', captain: 'Captain', weapons: 'Taktik', transfer: 'Transfer', shop: 'Terminal', quartier: 'Quartier', sonde: 'Sonde', plan: 'Planungstisch' };
  const SECTOR_NAMES = ['Bug', 'Steuerbord', 'Heck', 'Backbord'];
  const SYSTEMS = PROTO.SYSTEMS || ['reactor', 'engines', 'shields', 'weapons', 'life', 'transfer'];
  const STATE_COL = { ok: PAL.moss, damaged: PAL.warn, broken: PAL.red, offline: '#9A7AE0' };
  STATE_NAMES.offline = 'offline (EMP)';

  // Räume der Lerche: M3a aus dem Schiffslayout (Maps.roomAt / SHIP_ROOMS), Fallback 'Gang'
  function roomOf(tx, ty) {
    try {
      const r = Maps && Maps.roomAt ? Maps.roomAt(tx, ty) : null;
      return (r && r.name) || 'Gang';
    } catch (e) { return 'Gang'; }
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(+sec || 0));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  const Hud = {
    SYS_NAMES, SYS_SHORT, SYS_CODE, SYSTEM_ORDER, ITEM_NAMES, STATE_NAMES, CONSOLE_NAMES, SECTOR_NAMES, STATE_COL, roomOf, fmtTime,
    oda: { queue: [], cur: null },
    notices: [],
    radioFlash: null,
    showCrew: false,

    // ---------------------------------------------------------------- Meldungen
    pushOda(text) {
      if (!text) return;
      const q = this.oda.queue;
      if ((this.oda.cur && this.oda.cur.text === text) || q.some(m => m.text === text)) return;
      q.push({ text: String(text) });
      while (q.length > 6) q.shift();
    },
    pushNotice(text, color) {
      if (!text) return;
      this.notices = this.notices.filter(n => n.text !== text);
      this.notices.push({ text: String(text), color: color || PAL.warn, t: performance.now() / 1000 });
      if (this.notices.length > 3) this.notices.shift();
    },
    onRadio(from, text) { this.radioFlash = { from: from || 'Funk', text: text || '', t: performance.now() / 1000 }; },
    // M2: Funkzeile (Untertitel 3 s) für Plünderer-Funksprüche und Captain-Befehle
    barks: [],
    pushBark(text, from) {
      if (!text) return;
      const now = performance.now() / 1000;
      this.barks = this.barks.filter(b => now - b.t < 3 && b.text !== text);
      this.barks.push({ text: String(text), from: String(from || 'Plünderer'), t: now });
      while (this.barks.length > 2) this.barks.shift();
    },
    drawBarks(ctx, view) {
      const now = performance.now() / 1000;
      this.barks = this.barks.filter(b => now - b.t < 3);
      if (!this.barks.length) return;
      const odaH = this.oda.cur ? 10 + R.wrap(this.oda.cur.text, 240, 1).length * 10 + 4 : 0;
      let y = VH - 20 - odaH - (this.barks.length - 1) * 13;
      for (const b of this.barks) {
        const captain = /^captain$/i.test(b.from);
        const who = captain ? 'CAPTAIN' : String(b.from).toUpperCase();
        const col = captain ? PAL.mint : PAL.rust;
        const wWho = R.measure(who + ':', 1), wTxt = R.measure(b.text, 1);
        const w = Math.min(VW - 20, wWho + wTxt + 16);
        const x = Math.round(VW / 2 - w / 2);
        const a = Math.max(0, Math.min(1, (3 - (now - b.t)) / 0.4));
        ctx.globalAlpha = a;
        R.backdrop(ctx, x, y, w, 12, 0.82);
        ctx.fillStyle = col; ctx.fillRect(x, y, 2, 12);
        R.text(ctx, who + ':', x + 6, y + 2, { color: col, shadow: false });
        R.text(ctx, b.text, x + 10 + wWho, y + 2, { color: PAL.star, shadow: false });
        ctx.globalAlpha = 1;
        y += 13;
      }
    },
    // M1: Ortsname bei Ankunft (großes Banner, blendet aus)
    arrival: null,
    showArrival(name, sub) { if (name) this.arrival = { name: String(name), sub: sub || '', t: performance.now() / 1000 }; },
    drawArrival(ctx) {
      const a = this.arrival;
      if (!a) return;
      const age = performance.now() / 1000 - a.t;
      if (age > 4.5) { this.arrival = null; return; }
      const alpha = age < 0.4 ? age / 0.4 : age > 3.5 ? Math.max(0, 4.5 - age) : 1;
      ctx.globalAlpha = alpha;
      const w = Math.max(R.measure(a.name.toUpperCase(), 2), R.measure(a.sub, 1)) + 40;
      R.backdrop(ctx, VW / 2 - w / 2, 58, w, a.sub ? 40 : 30, 0.75);
      ctx.fillStyle = PAL.brass; ctx.fillRect(VW / 2 - w / 2, 58, w, 1); ctx.fillRect(VW / 2 - w / 2, (a.sub ? 97 : 87), w, 1);
      R.text(ctx, a.name.toUpperCase(), VW / 2, 65, { color: PAL.amber, scale: 2, align: 'center' });
      if (a.sub) R.text(ctx, a.sub, VW / 2, 84, { color: PAL.mint, align: 'center' });
      ctx.globalAlpha = 1;
    },

    update(dt) {
      const o = this.oda;
      if (!o.cur && o.queue.length) o.cur = { text: o.queue.shift().text, shown: 0, hold: 0 };
      if (o.cur) {
        const cps = o.queue.length > 1 ? 90 : 45;
        if (o.cur.shown < o.cur.text.length) {
          const before = Math.floor(o.cur.shown);
          o.cur.shown = Math.min(o.cur.text.length, o.cur.shown + cps * dt);
          if (Math.floor(o.cur.shown) !== before && before % 4 === 0 && this.onTypeTick) this.onTypeTick();
        } else {
          o.cur.hold += dt;
          const holdTime = (o.queue.length ? 1.6 : 3.5) + o.cur.text.length * 0.025;
          if (o.cur.hold > holdTime) o.cur = null;
        }
      }
      const now = performance.now() / 1000;
      this.notices = this.notices.filter(n => now - n.t < 3);
    },

    // ---------------------------------------------------------------- Haupt-Zeichnen
    draw(ctx, view) {
      const st = view.state;
      if (!st || st.phase === 'lobby' || !view.me) return;
      const inConsole = !!view.me.console;
      if (!inConsole) {
        if (view.self.zone === 'away') this.drawAwayHud(ctx, view); else this.drawShipHud(ctx, view);
        this.drawObjectives(ctx, view);
        this.drawInteraction(ctx, view);
        this.drawCarry(ctx, view);
        this.drawRadio(ctx, view, false);
      } else {
        this.drawRadio(ctx, view, true);
      }
      if (!inConsole) this.drawReactorHint(ctx, view);
      this.drawArrival(ctx);
      if (!inConsole) this.drawBarks(ctx, view);
      this.drawOda(ctx, view, inConsole);
      this.drawNotices(ctx, view);
      if (this.showCrew && !inConsole) this.drawCrew(ctx, view);
    },

    drawObjectives(ctx, view) {
      const st = view.state;
      const alert = (st.ship && st.ship.alert) || 'normal';
      const t = view.time;
      const lampCol = alert === 'red' ? PAL.red : alert === 'yellow' ? PAL.warn : PAL.moss;
      const on = alert === 'normal' || Math.floor(t * (alert === 'red' ? 2 : 1)) % 2 === 0;
      const label = alert === 'red' ? 'ALARM ROT' : alert === 'yellow' ? 'ALARM GELB' : 'NORMALBETRIEB';
      const mi = st.mission || {};
      // §21.2: fokussierte Mission aus dem Missionsbuch (Planungstisch) bestimmt Titel und Ziele; ohne Fokus die laufende
      const book = mi.book, fe = book && book.focus != null && Array.isArray(book.entries) ? book.entries.find(e => e.id === book.focus) : null;
      // Server liefert focusTitle/focusObjectives (immer, klein) – sonst aus dem zwischengespeicherten Buch
      const srvFocus = Array.isArray(mi.focusObjectives) ? mi.focusObjectives : null;
      const focusObjs = srvFocus || (fe && Array.isArray(fe.objectives) && fe.objectives.length ? fe.objectives : null);
      const objs = focusObjs || (mi.active && Array.isArray(mi.active.objectives) && mi.active.objectives.length ? mi.active.objectives : mi.objectives) || [];
      const title = srvFocus ? (mi.focusTitle || (mi.active && mi.active.title)) : fe && fe.title ? fe.title : (mi.active && mi.active.title);
      const lines = [];
      // M1: Ort und aktiver Auftrag als Kopfzeilen
      if (st.world) {
        const dock = st.ship && st.ship.dockedAt;
        lines.push({ text: R.locName(st, R.worldOf(st).location) + (dock ? ' · angedockt' : ''), head: true, color: PAL.mint });
      }
      if (title) for (const l of R.wrap(title, 180, 1).slice(0, 1)) lines.push({ text: l, head: true, color: PAL.amber });
      for (const o of objs) {
        const wrapped = R.wrap(o.text, 172, 1);
        wrapped.forEach((l, i) => lines.push({ text: l, first: i === 0, done: o.done, optional: o.optional }));
      }
      const h = 16 + Math.min(lines.length, 9) * 10 + (lines.length ? 4 : 0);
      R.backdrop(ctx, 4, 4, 192, h, 0.62);
      ctx.fillStyle = on ? lampCol : '#2A303A';
      ctx.beginPath(); ctx.arc(12, 11, 4, 0, Math.PI * 2); ctx.fill();
      if (on && alert !== 'normal') { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(10, 8, 2, 2); }
      R.text(ctx, label, 20, 7, { color: lampCol });
      let y = 20;
      for (const l of lines.slice(0, 9)) {
        if (l.head) { R.text(ctx, l.text, 8, y, { color: l.color }); y += 10; continue; }
        if (l.first) {
          ctx.strokeStyle = l.done ? PAL.moss : PAL.panelLight; ctx.lineWidth = 1;
          ctx.strokeRect(8.5, y + 0.5, 6, 6);
          if (l.done) { ctx.fillStyle = PAL.moss; ctx.fillRect(10, y + 2, 3, 3); }
        }
        R.text(ctx, l.text, 18, y, { color: l.done ? '#6E8A6A' : l.optional ? PAL.panelLight : PAL.star });
        y += 10;
      }
    },

    // M3a: 14 Systeme als 7×2-Raster (Kürzel Art+Seite, Zustand über Farbe/Muster), Reparaturliste = Bernstein-Strich
    drawSystems(ctx, view, x, y) {
      const st = view.state;
      const ship = st.ship || {};
      const sys = ship.systems || {};
      const queued = {};
      for (const q of ship.repairQueue || []) if (q && q.system) queued[q.system] = q;
      if (ship.priority) queued[ship.priority] = queued[ship.priority] || { mode: 'flick' };
      const t = view.time;
      HUD_ROWS.forEach((row, ri) => row.forEach((s, i) => {
        const off = ship.offline && ship.offline[s];
        const state = off ? 'offline' : (sys[s] || 'ok');
        const fr = R.fragileOf(st, s);
        const bx = x + i * 16, by = y + ri * 15;
        const blink = state === 'broken' && Math.floor(t * 3) % 2 === 0;
        ctx.fillStyle = state === 'broken' ? (blink ? '#5A1E1A' : '#2A1514') : state === 'damaged' ? '#4A3E16' : state === 'offline' ? '#2A2240' : fr ? '#3A2414' : 'rgba(21,27,43,0.85)';
        ctx.fillRect(bx, by, 15, 13);
        if (state === 'damaged') R.hatch(ctx, bx, by, 15, 13, 'rgba(242,201,76,0.35)', 4);
        if (state === 'broken') R.crossX(ctx, bx, by, 15, 13, 'rgba(224,71,60,0.7)', 1);
        if (fr && state !== 'broken') R.tape(ctx, bx, by, 15, 13);
        const col = R.stateColor(state, fr);
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, 14, 12);
        R.text(ctx, SYS_CODE[s] || '?', bx + 8, by + 3, { color: state === 'ok' && !fr ? PAL.mint : col, align: 'center' });
        if (queued[s]) { ctx.fillStyle = PAL.amber; ctx.fillRect(bx + 2, by + 12, 11, 1); }
      }));
    },

    drawShieldMini(ctx, view, x, y) {
      const st = view.state;
      const cur = (st.ship && st.ship.shields && st.ship.shields.current) || [0, 0, 0, 0];
      const capA = (st.ship && st.ship.shields && st.ship.shields.cap) || null;
      // Schiffssymbol (Bug rechts) mit 4 Sektor-Balken; M3a: über cap = dunkelrot (½), cap 0 = rot
      ctx.fillStyle = PAL.panelLight;
      ctx.beginPath(); ctx.moveTo(x + 14, y + 6); ctx.lineTo(x + 4, y + 2); ctx.lineTo(x + 4, y + 10); ctx.closePath(); ctx.fill();
      let capNow = 4;
      const pips = (n, px, py, vertical, sec) => {
        capNow = capA ? +capA[sec] : 4;
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = k < n ? PAL.mint : k >= capNow ? (capNow <= 0 ? PAL.red : '#6A4A1A') : '#2E3A4A';
          if (vertical) ctx.fillRect(px, py + k * 3, 2, 2); else ctx.fillRect(px + k * 3, py, 2, 2);
        }
      };
      pips(cur[0] || 0, x + 17, y + 1, true, 0);   // Bug rechts
      pips(cur[2] || 0, x, y + 1, true, 2);        // Heck links
      pips(cur[3] || 0, x + 3, y - 3, false, 3);   // Backbord oben
      pips(cur[1] || 0, x + 3, y + 13, false, 1);  // Steuerbord unten
    },

    drawShipHud(ctx, view) {
      const st = view.state;
      const ship = st.ship || {};
      const x0 = VW - 7 * 16 - 4;
      // Nachrunde M4 (Kai): Kürzel-Raster der Systeme (drawSystems) entfernt – Balken, Marken und Raumname rutschen nach oben
      R.backdrop(ctx, x0 - 4, 2, 7 * 16 + 6, 46, 0.62);
      const hullFrac = ship.hullMax ? ship.hull / ship.hullMax : (ship.hull || 0) / 100;
      const yo = -18;
      R.icon(ctx, 'hull', x0 + 6, 31 + yo);
      R.bar(ctx, x0 + 14, 28 + yo, 48, 5, hullFrac, hullFrac < 0.4 ? PAL.red : PAL.panelLight);
      R.text(ctx, String(Math.round(ship.hull || 0)), x0 + 65, 26 + yo, { color: PAL.star });
      const o2 = ship.o2 == null ? 100 : ship.o2;
      R.icon(ctx, 'o2', x0 + 6, 45 + yo);
      R.bar(ctx, x0 + 14, 42 + yo, 48, 5, o2 / 100, o2 < 50 ? PAL.red : PAL.ice);
      R.text(ctx, String(Math.round(o2)), x0 + 65, 40 + yo, { color: PAL.star });
      this.drawShieldMini(ctx, view, x0 + 90, 34 + yo);
      const inv = st.inventory || {};
      R.icon(ctx, 'marks', x0 + 6, 58 + yo);
      R.text(ctx, (inv.marks || 0) + ' Marken', x0 + 14, 55 + yo, { color: PAL.brass });
      // M3a: Raumname über Maps.roomAt (oben links unter den Aufträgen wäre zu voll -> unter dem Systemraster)
      const tx = Math.floor(view.self.x / TILE), ty = Math.floor(view.self.y / TILE);
      const rn = roomOf(tx, ty);
      const rw = Math.max(7 * 16 + 6, R.measure(rn, 1) + 8);
      R.backdrop(ctx, VW - 2 - rw, 50, rw, 11, 0.62);
      R.text(ctx, rn, VW - 6, 52, { color: PAL.star, align: 'right' });
      // Mini-Schiffsplan unten rechts
      const map = Maps.ship;
      R.drawMiniPlan(ctx, view, VW - map.w * 3 - 6, VH - map.h * 3 - 6, { zone: 'ship', cell: 3 });
      this.drawEdgeArrows(ctx, view);
    },

    // M1: Reaktor überladen / offline – Anzeige und Neustart-Hinweise (§6)
    drawReactorHint(ctx, view) {
      const st = view.state;
      const r = (st.ship && st.ship.reactor) || {};
      const onShip = view.self.zone === 'ship';
      const x = VW - 232, y = onShip ? 66 : 50, w = 228;
      if (r.state === 'overload') {
        const left = +r.overloadLeft || 0;
        const warn = left <= 30;
        R.backdrop(ctx, x, y, w, 14, 0.75);
        const col = warn && Math.floor(view.time * 2) % 2 ? PAL.red : PAL.amber;
        R.text(ctx, 'REAKTOR ÜBERLADEN · ' + fmtTime(left), x + 4, y + 3, { color: col });
        R.text(ctx, warn ? 'gleich Abschaltung!' : '+4 Energie', x + w - 4, y + 3, { color: col, align: 'right' });
        return;
      }
      if (r.state !== 'offline') return;
      const sw = r.switches || {};
      const h = 46;
      R.backdrop(ctx, x, y, w, h, 0.82);
      ctx.strokeStyle = Math.floor(view.time * 2) % 2 ? PAL.red : '#7A2A24'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      R.text(ctx, 'REAKTOR OFFLINE · Notstrom', x + 5, y + 3, { color: PAL.red });
      R.text(ctx, 'Neustart: Schalter A (oben) und B (unten)', x + 5, y + 13, { color: PAL.star });
      R.text(ctx, 'im Maschinenraum gleichzeitig halten', x + 5, y + 22, { color: PAL.star });
      R.text(ctx, 'A', x + 5, y + 33, { color: sw.A ? PAL.mint : PAL.panelLight });
      ctx.fillStyle = sw.A ? PAL.mint : '#2E3A4A'; ctx.fillRect(x + 13, y + 33, 7, 7);
      R.text(ctx, 'B', x + 26, y + 33, { color: sw.B ? PAL.mint : PAL.panelLight });
      ctx.fillStyle = sw.B ? PAL.mint : '#2E3A4A'; ctx.fillRect(x + 34, y + 33, 7, 7);
      R.bar(ctx, x + 48, y + 35, w - 54, 5, +r.restartProgress || 0, PAL.mint);
    },

    drawAwayHud(ctx, view) {
      const st = view.state;
      const ship = st.ship || {};
      const me = view.me;
      const away = st.away || {};
      const alert = ship.alert || 'normal';
      // Schiffsstatus-Mini oben rechts
      const x0 = VW - 116;
      R.backdrop(ctx, x0 - 4, 2, 118, 44, 0.62);
      R.text(ctx, 'LERCHE', x0, 5, { color: PAL.brass });
      const ac = alert === 'red' ? PAL.red : alert === 'yellow' ? PAL.warn : PAL.moss;
      ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(x0 + 48, 8, 3, 0, Math.PI * 2); ctx.fill();
      R.text(ctx, alert === 'red' ? 'Alarm rot' : alert === 'yellow' ? 'Alarm gelb' : 'normal', x0 + 54, 5, { color: ac });
      const hullFrac = ship.hullMax ? ship.hull / ship.hullMax : (ship.hull || 0) / 100;
      R.icon(ctx, 'hull', x0 + 6, 22);
      R.bar(ctx, x0 + 14, 19, 60, 5, hullFrac, hullFrac < 0.4 ? PAL.red : PAL.panelLight);
      this.drawShieldMini(ctx, view, x0 + 84, 18);
      const tr = (ship.systems && ship.systems.transfer) || 'ok';
      R.icon(ctx, 'transfer', x0 + 6, 37, { color: STATE_COL[tr] });
      R.text(ctx, 'Transfer ' + ({ ok: 'ok', damaged: 'beschädigt', broken: 'kaputt' }[tr] || tr), x0 + 14, 34, { color: STATE_COL[tr] });

      // HP + Hinweise unten links (M2: auf v2-Karten Schildsegmente statt HP)
      let topY = VH - 44;
      if (Array.isArray(me.sh)) topY = this.drawCombatHud(ctx, view);
      else {
        const hp = me.hp == null ? 100 : me.hp;
        R.backdrop(ctx, 4, VH - 44, 166, 40, 0.62);
        R.text(ctx, 'HP', 8, VH - 40, { color: PAL.star });
        R.bar(ctx, 24, VH - 39, 100, 6, hp / ((CFG.player && CFG.player.hp) || 100), hp < 40 ? PAL.red : PAL.moss);
        R.text(ctx, Math.round(hp) + '', 130, VH - 40, { color: PAL.star });
        let y = VH - 28;
        R.text(ctx, 'Q: Markierung (Maus)', 8, y, { color: PAL.amber }); y += 10;
        R.text(ctx, 'Leertaste/Klick: Blaster', 8, y, { color: PAL.panelLight });
      }
      if (away.kuppelUntil && st.time < away.kuppelUntil) {
        R.text(ctx, 'Schildkuppel aktiv ' + Math.ceil(away.kuppelUntil - st.time) + ' s', 8, topY - 16, { color: PAL.mint });
      }
      if (away.sensorUntil && st.time < away.sensorUntil) R.text(ctx, (R.isV2(st) ? 'Sensor: Gegner sichtbar ' : 'Sensor: Drohnen sichtbar ') + Math.ceil(away.sensorUntil - st.time) + ' s', 8, topY - 6, { color: PAL.amber });
      const map = R.mapFor('away', st);
      R.drawMiniPlan(ctx, view, VW - map.w * 3 - 6, VH - map.h * 3 - 6, { zone: 'away', cell: 3 });
      // M1: Wrack-Hinweise (Bergung, Hohlraum) und Plan-Pins dieser Karte
      const pins = ((st.plan && st.plan.pins) || []).filter(p => p.map === map.id);
      let hy = VH - map.h * 3 - 20;
      if (map.id === 'wreck') {
        const sal = away.salvage || [];
        const hv = away.hollow;
        const lines = ['WRACK „ZAUNKÖNIG“', 'Bergung ' + sal.filter(s => s.done).length + '/' + sal.length + ' (E halten am Container)',
          !hv ? 'Hohlraum: ? – Weitscan aus dem Orbit' : hv.open ? 'Hohlraum geöffnet' : hv.marked ? 'Hohlraum markiert: E 4 s halten' : 'Hohlraum: ? – Weitscan aus dem Orbit'];
        if (pins.length) lines.push('Plan-Pins: ' + pins.length);
        hy = VH - map.h * 3 - 12 - lines.length * 10;
        R.backdrop(ctx, VW - 196, hy - 2, 192, lines.length * 10 + 4, 0.7);
        lines.forEach((l, i) => R.text(ctx, l, VW - 192, hy + i * 10, { color: i === 0 ? PAL.brass : hv && hv.marked && !hv.open && i === 2 ? PAL.amber : PAL.star }));
      } else if (map.id === 'kesh') {
        // M2: Kesh-Lage (Tor, Tafel, Störrelais)
        const jam = away.jammers || [];
        const open = !!(away.vault && away.vault.open);
        const lines = [['MOND KESH · ARCHIV', PAL.brass],
          [open ? 'Tor zum Gewölbe: offen' : 'Tor: 2 Schlüssel gleichzeitig drehen', open ? PAL.mint : PAL.star],
          [away.tablet && away.tablet.taken ? 'Tafel: geborgen – zurück zu den Pads' : 'Tafel: im Gewölbe', away.tablet && away.tablet.taken ? PAL.amber : PAL.star]];
        if (jam.length) lines.push(['Störrelais aus: ' + jam.filter(j => j.off).length + '/' + jam.length, jam.every(j => j.off) ? PAL.mint : PAL.panelLight]);
        if (pins.length) lines.push(['Plan-Pins: ' + pins.length, PAL.panelLight]);
        hy = VH - map.h * 3 - 12 - lines.length * 10;
        R.backdrop(ctx, VW - 196, hy - 2, 192, lines.length * 10 + 4, 0.7);
        lines.forEach((l, i) => R.text(ctx, l[0], VW - 192, hy + i * 10, { color: l[1] }));
      } else if (pins.length) {
        R.backdrop(ctx, VW - 130, hy - 2, 126, 12, 0.7);
        R.text(ctx, 'Plan-Pins: ' + pins.length + ' (Tisch)', VW - 126, hy, { color: PAL.panelLight });
      }
      // Fadenkreuz an der Maus
      if (view.mouse && view.mouse.x >= 0) {
        const mx = Math.round(view.mouse.x), my = Math.round(view.mouse.y);
        ctx.fillStyle = PAL.mint;
        ctx.fillRect(mx - 5, my, 3, 1); ctx.fillRect(mx + 3, my, 3, 1); ctx.fillRect(mx, my - 5, 1, 3); ctx.fillRect(mx, my + 3, 1, 3);
      }
    },

    // M2: Kampf v2 – eigene Schildsegmente, Deckung/Flanke, Team-Schilde, Medipack, Verwundet-Anzeige.
    // Rückgabe: Oberkante des Panels (für Zusatzzeilen darüber).
    drawCombatHud(ctx, view) {
      const st = view.state, me = view.me, t = view.time;
      const sh = me.sh || [0, 3];
      const team = (st.players || []).filter(p => p.id !== me.id && p.zone === 'away' && p.connected !== false);
      const crouched = !!me.cr && !me.downed;   // §15
      const h = 44 + team.length * 11 + (crouched ? 11 : 0);
      const y0 = VH - h - 4;
      R.backdrop(ctx, 4, y0, 170, h, 0.68);   // schmal genug, dass die ODA-Box (unten mittig) nichts verdeckt
      // Schild
      R.text(ctx, 'SCHILD', 8, y0 + 5, { color: R.SHIELD_COL });
      R.drawShieldPips(ctx, 46, y0 + 3, sh[0], sh[1], me.downed ? 0 : (+me.shR || 0), 12, 3);
      const mx = 46 + sh[1] * 15 + 8;
      // Medipack-Symbol
      if (me.medkit) {
        if (!R.art('drawItem', 'drawItem:medipack', [ctx, 'medipack', mx + 6, y0 + 9, { time: t }])) {
          ctx.fillStyle = PAL.star; ctx.fillRect(mx, y0 + 3, 12, 12);
          ctx.fillStyle = PAL.red; ctx.fillRect(mx + 5, y0 + 5, 2, 8); ctx.fillRect(mx + 2, y0 + 8, 8, 2);
        }
        R.text(ctx, 'Medipack', mx + 15, y0 + 5, { color: PAL.star });
      } else {
        ctx.strokeStyle = '#4A5260'; ctx.lineWidth = 1; ctx.strokeRect(mx + 0.5, y0 + 3.5, 11, 11);
        R.text(ctx, 'kein Medipack', mx + 15, y0 + 5, { color: '#6B7380' });
      }
      // Deckung / Flanke bzw. Verwundet
      let y = y0 + 20;
      if (me.downed) {
        const b = me.bleed != null ? fmtTime(Math.ceil(me.bleed)) : '–';
        R.text(ctx, 'VERWUNDET · Rückholung in ' + b, 8, y, { color: Math.floor(t * 2) % 2 ? PAL.red : '#FF8A7A' });
      } else {
        const cv = +me.cv || 0;
        const lab = cv >= 2 ? 'VOLL' : cv === 1 ? 'HALB' : 'KEINE';
        const col = cv >= 2 ? PAL.mint : cv === 1 ? PAL.amber : PAL.panelLight;
        R.text(ctx, 'DECKUNG:', 8, y, { color: PAL.panelLight });
        R.text(ctx, lab, 56, y, { color: col });
        if (me.fl) {
          const on = Math.floor(t * 4) % 2 === 0;
          ctx.fillStyle = on ? PAL.red : '#7A2420'; ctx.fillRect(90, y - 2, 82, 11);
          R.text(ctx, 'FLANKE OFFEN', 131, y, { color: PAL.star, align: 'center', shadow: false });
        }
        if (crouched) {
          // §15: Duck-Zustand gut sichtbar, mit Taste zum Aufstehen
          y += 11;
          ctx.fillStyle = 'rgba(127,243,255,0.18)'; ctx.fillRect(6, y - 2, 166, 11);
          R.text(ctx, 'GEDUCKT – C: aufstehen', 8, y, { color: R.SHIELD_COL || PAL.mint });
        }
      }
      y += 11;
      // Team-Schilde
      for (const p of team) {
        const col = PAL.players[p.color || 0];
        R.shape(ctx, R.SHAPES[p.color || 0], 12, y + 4, 7, col);
        R.text(ctx, String(p.name || '?').slice(0, 9), 19, y, { color: col });
        const ps = Array.isArray(p.sh) ? p.sh : null;
        if (p.downed) R.text(ctx, 'VERWUNDET' + (p.bleed != null ? ' ' + Math.ceil(p.bleed) + ' s' : ''), 82, y, { color: PAL.red });
        else if (ps) R.drawShieldPips(ctx, 82, y + 1, ps[0], ps[1], +p.shR || 0, 7, 2);
        if (p.medkit && !p.downed) { ctx.fillStyle = PAL.star; ctx.fillRect(ps ? 82 + ps[1] * 9 + 4 : 150, y + 1, 7, 7); ctx.fillStyle = PAL.red; ctx.fillRect((ps ? 82 + ps[1] * 9 + 4 : 150) + 3, y + 2, 1, 5); ctx.fillRect((ps ? 82 + ps[1] * 9 + 4 : 150) + 1, y + 4, 5, 1); }
        y += 11;
      }
      R.text(ctx, me.downed ? 'Klick: Pistole · Q: Markieren' : 'Klick Blaster · Q Mark. · C ducken', 8, y, { color: PAL.panelLight });
      if (me.downed) this.drawDownedBanner(ctx, view);
      return y0;
    },
    drawDownedBanner(ctx, view) {
      const me = view.me, t = view.time;
      // oben mittig zwischen Zielliste (links) und Schiffsstatus (rechts)
      // liegt ein Funkspruch oben, rutscht die Tafel darunter
      const st = view.state, radio = st.mission && st.mission.radio;
      const flash = this.radioFlash && performance.now() / 1000 - this.radioFlash.t < 6 ? this.radioFlash : null;
      const r = radio || flash;
      const rh = r ? 16 + R.wrap(r.text || '', 216, 1).slice(0, 4).length * 10 + (radio && radio.needsAccept ? 11 : 2) : 0;
      const w = 300, x = Math.round(VW / 2 - w / 2) + 38, y = r ? 6 + rh + 4 : 24, cx = x + w / 2;
      R.backdrop(ctx, x, y, w, 40, 0.82);
      ctx.strokeStyle = Math.floor(t * 2) % 2 ? PAL.red : '#7A2420'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 39);
      R.text(ctx, 'VERWUNDET' + (me.bleed != null ? ' – Notrückholung in ' + fmtTime(Math.ceil(me.bleed)) : ''), cx, y + 4, { color: PAL.red, align: 'center' });
      R.text(ctx, 'Kameraden: neben dir E halten', cx, y + 16, { color: PAL.star, align: 'center' });
      R.text(ctx, 'Du: mit der Maus zielen, Klick = Pistole', cx, y + 27, { color: R.SHIELD_COL, align: 'center' });
    },

    drawEdgeArrows(ctx, view) {
      const st = view.state;
      if (!st.ship || view.self.zone !== 'ship') return;
      const cam = R.camera;
      const targets = [];
      for (const f of st.ship.fires || []) targets.push({ x: f[0] * TILE + 16, y: f[1] * TILE + 16, col: PAL.red, icon: 'fire' });
      for (const b of st.ship.breaches || []) targets.push({ x: b.tx * TILE + 16, y: b.ty * TILE + 16, col: PAL.ice, icon: 'breach' });
      const sys = st.ship.systems || {};
      for (const ch in R.SYS_BY_CHAR) {
        const s = R.SYS_BY_CHAR[ch];
        if (sys[s] !== 'broken') continue;
        for (const p of Maps.ship.find(ch)) targets.push({ x: p.x * TILE + 16, y: p.y * TILE + 16, col: PAL.warn, icon: s });
      }
      // M1: Reaktor offline -> Pfeile zu beiden Neustartschaltern (zuerst, damit sie nie wegfallen)
      const rs = st.ship.reactor || {};
      if (rs.state === 'offline') for (const sw of Maps.REACTOR_SWITCHES || []) {
        if (rs.switches && rs.switches[sw.id]) continue;
        targets.unshift({ x: sw.x * TILE + 16, y: sw.y * TILE + 16, col: PAL.mint, icon: 'reactor' });
      }
      const cx = VW / 2, cy = VH / 2;
      let n = 0;
      const used = [];
      for (const tg of targets) {
        // M4/QA: Projektion über R.worldToScreen – in 3D die Voxel-Kamera, in 2D wie bisher (x − camera.x)
        const sp = R.worldToScreen ? R.worldToScreen(tg.x, tg.y) : { x: tg.x - cam.x, y: tg.y - cam.y };
        const sx = sp.x, sy = sp.y;
        if (sx > 8 && sy > 8 && sx < VW - 8 && sy < VH - 8) continue;
        const ang = Math.atan2(sy - cy, sx - cx);
        const k = Math.min((VW / 2 - 18) / Math.abs(Math.cos(ang) || 1e-6), (VH / 2 - 18) / Math.abs(Math.sin(ang) || 1e-6));
        const ex = cx + Math.cos(ang) * k, ey = cy + Math.sin(ang) * k;
        if (used.some(u => Math.abs(u.x - ex) < 16 && Math.abs(u.y - ey) < 16)) continue;
        used.push({ x: ex, y: ey });
        R.edgeArrow(ctx, ex, ey, ang, tg.col);
        R.icon(ctx, tg.icon, ex - Math.cos(ang) * 14, ey - Math.sin(ang) * 14, { color: tg.col });
        if (++n >= 6) break;
      }
    },

    drawInteraction(ctx, view) {
      const ia = view.interaction;
      const me = view.me;
      if (ia) {
        const v3 = !!(R.overlay3d && R.overlay3d.on);
        // M4/QA: in 3D über dem Objekt (≈ Socket label, 2,1 m), sonst verdeckt der Hinweis die Figur davor
        const s = v3 ? R.worldToScreen(ia.tx * TILE + 16, ia.ty * TILE + 16, 2.1) : R.worldToScreen(ia.tx * TILE + 16, ia.ty * TILE);
        const label = ia.label;
        // M3a: zweite Zeile (z. B. „R: reparieren (Minispiel)“) – Stationsmarke sitzt darüber, daher Hinweis darunter/daneben
        const alt = ia.alt || null;
        const info = !!ia.info;   // reiner Namenshinweis (heiles System): ohne Tastensymbol
        const w = Math.max(R.measure(label, 1), alt ? R.measure(alt.label, 1) : 0) + (info ? 8 : 20);
        const h = alt ? 25 : 13;
        const yy = v3 ? s.y - h - (ia.sys ? 16 : 4) : ia.sys ? s.y + 34 : s.y - 22;   // 2D: an Stationen unter die Kachel; 3D: darüber, Platz für die Zustandsmarke
        const x = Math.round(Math.max(2, Math.min(VW - w - 2, s.x - w / 2))), y = Math.round(Math.max(2, Math.min(VH - h - 2, yy)));
        R.backdrop(ctx, x, y, w, h, 0.8);
        const key = (k, kx, ky, on) => { ctx.fillStyle = on ? PAL.amber : '#4A5260'; ctx.fillRect(kx, ky, 9, 9); R.text(ctx, k, kx + 2, ky + 1, { color: PAL.space, shadow: false }); };
        if (info) R.text(ctx, label, x + 4, y + 3, { color: PAL.star, shadow: false });
        else {
          key(ia.key || 'E', x + 2, y + 2, ia.ok);
          R.text(ctx, label, x + 15, y + 3, { color: ia.ok ? PAL.star : '#8C93A0', shadow: false });
        }
        if (alt) {
          key(alt.key, x + 2, y + 14, alt.ok !== false);
          R.text(ctx, alt.label, x + 15, y + 15, { color: alt.ok !== false ? PAL.star : '#8C93A0', shadow: false });
        }
      }
      if (me && me.action && !(me.action.kind === 'flick' || me.action.kind === 'swap' || me.action.kind === 'minigame')) {
        const v3 = !!(R.overlay3d && R.overlay3d.on);
        const s = v3 ? R.worldToScreen(view.self.x, view.self.y, 2.0) : R.worldToScreen(view.self.x, view.self.y);
        R.ring(ctx, s.x, v3 ? s.y - 8 : s.y - 46, 7, me.action.progress || 0, PAL.mint);
      }
    },

    // M3a §8.1: Reparatur-Minispiel (mittig, für 640×360). mg = Zustand aus client.js (Minigame)
    drawMinigame(ctx, view, mg) {
      if (!mg) return;
      const t = view.time;
      const w = 300, h = 104, x = Math.round(VW / 2 - w / 2), y = Math.round(VH / 2 - h / 2) - 20;
      ctx.fillStyle = 'rgba(11,14,26,0.45)'; ctx.fillRect(0, 0, VW, VH);
      R.panel(ctx, x, y, w, h, { style: 'screen', title: 'REPARATUR' });
      const st = view.state;
      const state = R.sysState(st, mg.system);
      R.text(ctx, SYS_NAMES[mg.system] || mg.system, x + 12, y + 10, { color: PAL.star });
      R.stateBadge(ctx, x + w - 46, y + 9, 34, 10, state, R.fragileOf(st, mg.system));
      R.text(ctx, 'Leertaste im grünen Feld · 3 Treffer', x + 12, y + 22, { color: PAL.panelLight });
      // Leiste
      const bx = x + 20, bw = w - 40, by = y + 40, bh = 16;
      ctx.fillStyle = '#151B2B'; ctx.fillRect(bx, by, bw, bh);
      const locked = mg.lockUntil > t;
      const zx = bx + Math.round(mg.zone.a * bw), zw = Math.max(4, Math.round(mg.zone.w * bw));
      ctx.fillStyle = locked ? '#2E3A30' : '#3D7A4A'; ctx.fillRect(zx, by, zw, bh);
      ctx.fillStyle = locked ? '#4A5A4C' : PAL.moss; ctx.fillRect(zx, by, zw, 2); ctx.fillRect(zx, by + bh - 2, zw, 2);
      ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
      const px = bx + Math.round(mg.pos * bw);
      ctx.fillStyle = locked ? '#6B7380' : PAL.star; ctx.fillRect(px - 1, by - 4, 3, bh + 8);
      ctx.fillStyle = locked ? '#6B7380' : PAL.amber; ctx.fillRect(px - 3, by - 6, 7, 3);
      if (locked) {
        R.hatch(ctx, bx, by, bw, bh, 'rgba(224,71,60,0.35)', 5);
        R.text(ctx, 'Fehlgriff – Sperre ' + R.fmt1(mg.lockUntil - t) + ' s', x + w / 2, by + bh + 6, { color: PAL.warn, align: 'center' });
      }
      // Treffer-Pips + Fehler
      for (let k = 0; k < 3; k++) {
        const cx = x + 20 + k * 14;
        ctx.fillStyle = k < mg.hits ? PAL.mint : '#26313F'; ctx.fillRect(cx, y + h - 24, 10, 10);
        ctx.strokeStyle = PAL.mint; ctx.strokeRect(cx + 0.5, y + h - 23.5, 9, 9);
      }
      R.text(ctx, mg.phase === 'wait' ? 'Verbinde mit der Station …' : mg.phase === 'done' ? 'Fertig – wird übernommen …' : 'Treffer ' + mg.hits + '/3' + (mg.errors ? ' · Fehlgriffe ' + mg.errors : ''),
        x + 70, y + h - 23, { color: mg.phase === 'done' ? PAL.mint : PAL.star });
      if (!locked && mg.phase !== 'wait' && mg.phase !== 'done' && Math.floor(t * 2) % 2 === 0 && mg.hits === 0) R.text(ctx, 'LEERTASTE', x + w / 2, by + bh + 6, { color: PAL.amber, align: 'center' });
      R.text(ctx, 'Esc abbrechen', x + w - 12, y + h - 23, { color: PAL.panelLight, align: 'right' });
    },

    drawCarry(ctx, view) {
      const me = view.me;
      if (!me || !me.carry || view.self.zone === 'away' && false) return;
      const y = view.self.zone === 'away' ? VH - 62 : VH - 24;
      const name = ITEM_NAMES[me.carry] || me.carry;
      const st = view.state;
      let extra = '';
      if (me.carry === 'loeschgel' && st.inventory && st.inventory.loeschgelCharges != null) extra = ' (' + st.inventory.loeschgelCharges + ' Ladungen)';
      const label = 'Trägt: ' + name + extra;
      const w = Math.max(R.measure(label, 1), R.measure('G: ablegen', 1)) + 32;
      R.backdrop(ctx, 4, y, w, 20, 0.72);
      if (!R.art('drawItem', 'drawItem:' + me.carry, [ctx, me.carry, 14, y + 10, { time: view.time }])) R.itemFallback(ctx, me.carry, 14, y + 10);
      R.text(ctx, label, 26, y + 3, { color: PAL.star });
      R.text(ctx, 'G: ablegen', 26, y + 11, { color: PAL.panelLight });
    },

    drawRadio(ctx, view, compact) {
      const st = view.state;
      const radio = st.mission && st.mission.radio;
      const flash = this.radioFlash && performance.now() / 1000 - this.radioFlash.t < 6 ? this.radioFlash : null;
      const r = radio || flash;
      if (!r) return;
      if (compact) {
        if (!radio || !radio.needsAccept) return;
        const label = 'FUNK: ' + (radio.from || '') + ' – Captain-Konsole';
        const w = R.measure(label, 1) + 10;
        R.backdrop(ctx, VW / 2 - w / 2, 2, w, 11, 0.85);
        R.text(ctx, label, VW / 2, 4, { color: PAL.amber, align: 'center' });
        return;
      }
      const x = 204, w = 228;
      const lines = R.wrap(r.text || '', w - 12, 1).slice(0, 4);
      const h = 16 + lines.length * 10 + (radio && radio.needsAccept ? 11 : 2);
      R.panel(ctx, x, 6, w, h, { style: 'brass' });
      R.text(ctx, 'FUNK · ' + (r.from || ''), x + 6, 10, { color: PAL.amber });
      let y = 21;
      for (const l of lines) { R.text(ctx, l, x + 6, y, { color: PAL.star }); y += 10; }
      if (radio && radio.needsAccept) {
        const blink = Math.floor(view.time * 2) % 2 === 0;
        R.text(ctx, '> Captain-Konsole: annehmen', x + 6, y + 1, { color: blink ? PAL.mint : PAL.panelLight });
      }
    },

    drawOda(ctx, view, top) {
      const cur = this.oda.cur;
      if (!cur) return;
      const shown = cur.text.slice(0, Math.floor(cur.shown));
      const w = 284;
      const lines = R.wrap(cur.text, w - 44, 1);
      const shownLines = R.wrap(shown, w - 44, 1);
      const h = 10 + lines.length * 10;
      const x = Math.round(VW / 2 - w / 2);
      const y = top ? 16 : VH - h - 6;
      ctx.fillStyle = 'rgba(14,26,31,0.92)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = PAL.mint; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = PAL.mint; ctx.fillRect(x + 1, y + 1, 30, h - 2);
      R.text(ctx, 'ODA', x + 16, y + h / 2 - 4, { color: PAL.space, align: 'center', shadow: false });
      let ly = y + 5;
      for (const l of shownLines) { R.text(ctx, l, x + 38, ly, { color: PAL.mint }); ly += 10; }
      if (cur.shown < cur.text.length && Math.floor(view.time * 6) % 2 === 0) {
        const last = shownLines[shownLines.length - 1] || '';
        ctx.fillStyle = PAL.mint; ctx.fillRect(x + 38 + R.measure(last, 1) + 1, ly - 10, 4, 7);
      }
      if (this.oda.queue.length) R.text(ctx, '+' + this.oda.queue.length, x + w - 4, y + h - 10, { color: PAL.panelLight, align: 'right' });
    },

    drawNotices(ctx, view, y0) {
      const now = performance.now() / 1000;
      let y = y0 == null ? 96 : y0;
      const all = this.notices.slice();
      if (R.uiDenied && performance.now() - R.uiDenied.t < 1800) all.push({ text: R.uiDenied.text, color: PAL.warn, t: R.uiDenied.t / 1000 });
      for (const n of all) {
        const w = R.measure(n.text, 1) + 12;
        const a = Math.max(0, Math.min(1, 3 - (now - n.t)));
        ctx.globalAlpha = a;
        R.backdrop(ctx, VW / 2 - w / 2, y, w, 13, 0.85);
        ctx.strokeStyle = n.color; ctx.strokeRect(VW / 2 - w / 2 + 0.5, y + 0.5, w - 1, 12);
        R.text(ctx, n.text, VW / 2, y + 3, { color: n.color, align: 'center' });
        ctx.globalAlpha = 1;
        y += 16;
      }
    },

    drawCrew(ctx, view) {
      const st = view.state;
      const x = 120, y = 50, w = 400, h = 250;
      R.panel(ctx, x, y, w, h, { style: 'plain', title: 'CREW & STATUS (Tab)' });
      let ly = y + 14;
      for (const p of st.players || []) {
        const col = PAL.players[p.color || 0];
        R.shape(ctx, R.SHAPES[p.color || 0], x + 14, ly + 4, 8, col);
        let where = p.zone === 'away' ? 'Außenteam' : roomOf(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
        if (p.console) where = 'an ' + (CONSOLE_NAMES[p.console] || p.console);
        R.text(ctx, String(p.name || '?').slice(0, 12), x + 24, ly, { color: col });
        R.text(ctx, where, x + 120, ly, { color: PAL.star });
        if (Array.isArray(p.sh) && !p.downed) R.drawShieldPips(ctx, x + 260, ly + 1, p.sh[0], p.sh[1], +p.shR || 0, 7, 2);
        else R.text(ctx, p.downed ? (Array.isArray(p.sh) ? 'verwundet' : 'außer Gefecht') : 'HP ' + Math.round(p.hp == null ? 100 : p.hp), x + 260, ly, { color: p.downed ? PAL.red : PAL.moss });
        if (p.connected === false) R.text(ctx, 'getrennt', x + 330, ly, { color: PAL.grey });
        ly += 12;
      }
      ly += 6;
      const inv = st.inventory || {};
      R.text(ctx, 'LAGER', x + 10, ly, { color: PAL.brass }); ly += 11;
      const items = ['ersatzteil', 'loeschgel', 'flickblech', 'bolzen', 'medipack'];
      items.forEach((it, i) => R.text(ctx, ITEM_NAMES[it] + ': ' + (inv[it] || 0), x + 10 + (i % 3) * 130, ly + Math.floor(i / 3) * 11, { color: PAL.star }));
      ly += 26;
      R.text(ctx, 'Marken: ' + (inv.marks || 0), x + 10, ly, { color: PAL.brass });
      const up = st.upgrades || {};
      const ups = [up.seitenturm && (CFG.spaceM3 ? 'Zusatzrohre' : 'Seitenturm'), up.schildpool && 'Schildpool +2', up.schrauber3 && 'Dritter Schrauber'].filter(Boolean);
      R.text(ctx, 'Upgrades: ' + (ups.join(', ') || 'keine'), x + 140, ly, { color: PAL.star });
      ly += 14;
      const sys = (st.ship && st.ship.systems) || {};
      R.text(ctx, 'SYSTEME', x + 10, ly, { color: PAL.brass }); ly += 11;
      SYSTEM_ORDER.forEach((s, i) => {
        const state = sys[s] || 'ok';
        const fr = R.fragileOf(st, s);
        const cx = x + 10 + (i % 3) * 128, cy = ly + Math.floor(i / 3) * 10;
        R.text(ctx, SYS_SHORT[s], cx, cy, { color: PAL.star });
        R.text(ctx, R.stateCode(state, fr), cx + 120, cy, { color: R.stateColor(state, fr), align: 'right' });
      });
      ly += 52;
      R.text(ctx, (st.world ? 'Ort: ' + R.locName(st, R.worldOf(st).location) : 'Abschnitt: ' + ((st.mission && st.mission.stage) || '-')) + '   Spielzeit: ' + fmtTime(st.stats && st.stats.elapsed != null ? st.stats.elapsed : st.time), x + 10, ly, { color: PAL.panelLight });
      R.text(ctx, 'Steuerung: WASD laufen · E interagieren (halten) · G ablegen · C ducken · Esc Konsole', x + 10, y + h - 14, { color: PAL.panelLight });
    },

    // ---------------------------------------------------------------- Lobby (Canvas; Name per DOM-Input)
    LOBBY_NAME_RECT: { x: 130, y: 104, w: 170, h: 16 },
    drawLobby(ctx, view) {
      const st = view.state || {};
      const t = view.time;
      if (!R.art('drawStarfield', null, [ctx, t * 20, 0, VW, VH, t])) { ctx.fillStyle = PAL.space; ctx.fillRect(0, 0, VW, VH); }
      ctx.fillStyle = 'rgba(11,14,26,0.55)'; ctx.fillRect(0, 0, VW, VH);
      R.text(ctx, 'STERNENSCHICHT', VW / 2, 30, { color: PAL.amber, scale: 2, align: 'center' });
      R.text(ctx, 'Brücke neu · offene Welt · Koop für 1–3 Spieler', VW / 2, 54, { color: PAL.mint, align: 'center' });
      const players = st.players || [];
      const me = players.find(p => p.id === view.pid);
      if (Net.badCode && !me) { this.drawCodeEntry(ctx, view); this.drawNotices(ctx, view, 4); return; }
      R.panel(ctx, 110, 72, 420, 240, { style: 'brass', title: 'CREW-LISTE' });
      const lob = view.lobby;
      const lx = this.LOBBY_NAME_RECT.x;
      R.text(ctx, 'Name', lx, 94, { color: PAL.panelLight });
      const nr = this.LOBBY_NAME_RECT;
      ctx.strokeStyle = PAL.brass; ctx.strokeRect(nr.x - 0.5, nr.y - 0.5, nr.w + 1, nr.h + 1);
      R.text(ctx, 'Farbe (1–3)', lx, 128, { color: PAL.panelLight });
      const taken = players.filter(p => p.id !== view.pid && p.connected !== false).map(p => p.color);
      for (let c = 0; c < 3; c++) {
        const isTaken = taken.indexOf(c) >= 0;
        const mine = me ? me.color === c : lob.color === c;
        const bx = lx + c * 58, by = 139;
        R.button(ctx, bx, by, 52, 18, isTaken ? 'belegt' : 'S' + (c + 1), {
          disabled: isTaken, reason: 'Farbe bereits vergeben', active: mine,
          onClick: () => view.actions.setColor(c),
        });
        R.shape(ctx, R.SHAPES[c], bx + 44, by + 9, 8, isTaken ? '#4A5260' : PAL.players[c], PAL.space);
      }
      R.text(ctx, 'An Bord', lx, 168, { color: PAL.panelLight });
      let y = 179;
      for (const p of players) {
        const col = PAL.players[p.color || 0];
        R.shape(ctx, R.SHAPES[p.color || 0], lx + 6, y + 4, 8, col);
        R.text(ctx, String(p.name || '?').slice(0, 12) + (p.id === view.pid ? ' (du)' : ''), lx + 16, y, { color: col });
        R.text(ctx, p.connected === false ? 'getrennt' : p.ready ? 'BEREIT' : 'wartet', lx + 170, y, { color: p.ready ? PAL.mint : PAL.panelLight, align: 'right' });
        y += 11;
      }
      if (!players.length) R.text(ctx, Net.status === 'open' ? 'warte auf Server …' : 'verbinde …', lx + 16, y, { color: PAL.panelLight });

      // rechte Spalte: Raumcode + Einladung, Hafen-Übung (M0)
      const rx = 350, rw = 160;
      ctx.fillStyle = 'rgba(43,29,26,0.35)'; ctx.fillRect(rx - 10, 88, 1, 150);
      const code = Net.serverRoomCode;
      R.text(ctx, 'RAUMCODE', rx, 94, { color: PAL.brass });
      if (code) {
        R.backdrop(ctx, rx, 105, rw, 22, 0.75);
        ctx.strokeStyle = PAL.brass; ctx.strokeRect(rx + 0.5, 105.5, rw - 1, 21);
        R.text(ctx, code.split('').join(' '), rx + rw / 2, 109, { color: PAL.amber, scale: 2, align: 'center' });
        const copied = view.state && window.Client && Client.inviteCopiedT && performance.now() - Client.inviteCopiedT < 2500;
        R.button(ctx, rx, 131, rw, 16, copied ? 'Link kopiert!' : 'Einladungslink kopieren', {
          hotkey: 'L', active: !!copied, disabled: !me, reason: 'Noch nicht verbunden',
          onClick: () => view.actions.copyInvite(),
        });
        R.text(ctx, 'Mitspielern Link oder Code geben.', rx, 151, { color: PAL.panelLight });
      } else {
        R.text(ctx, me ? 'aus – jeder mit der Adresse' : '…', rx, 109, { color: PAL.panelLight });
        if (me) R.text(ctx, 'kommt rein (ROOM_CODE=off).', rx, 120, { color: PAL.panelLight });
      }
      // M2: Start – Kampagne oder direkt zur Planetenmission (m3); die Hafen-Übung entfällt beim Direktstart
      // Testgelände (arena_space/arena_away): wie Direktstart ohne Übung, Anzeige in Bernstein
      const startId = (st.lobby && st.lobby.startMission) || 'm1';
      const direct = startId !== 'm1';
      const isArena = startId === 'arena_space' || startId === 'arena_away';
      const P = window.Shared_Protocol || {};
      const startLabel = (P.START_LABELS && P.START_LABELS[startId]) || (startId === 'm3' ? 'Direkt zur Planetenmission' : 'Kampagne');
      const startHint = { m1: 'Von vorn: Boje, Nebel, Kesh', m3: 'Direkt: „Die Tafel von Kesh“', arena_space: 'Wellen von Jägern & Co. (solo ok)', arena_away: 'Sofort auf Kesh, Kampf im Hof' }[startId] || '';
      const skip = !!(st.lobby && st.lobby.skipDrill);
      R.text(ctx, 'HAFEN-ÜBUNG', rx, 164, { color: PAL.brass });
      R.button(ctx, rx, 174, rw, 16, direct ? '[–] Übung entfällt' : skip ? '[x] Übung überspringen' : '[ ] Übung überspringen', {
        hotkey: 'U', active: skip && !direct, disabled: !me || direct, reason: !me ? 'Noch nicht verbunden' : isArena ? 'Entfällt im Testgelände' : 'Entfällt beim Direktstart der Planetenmission',
        onClick: () => view.actions.toggleSkipDrill(),
      });
      R.text(ctx, isArena ? 'Testgelände: keine Übung.' : direct ? 'Direktstart: keine Übung.' : skip ? 'Direkt zum Funkspruch.' : 'Tutorial: löschen, flicken.', rx, 193, { color: skip && !direct ? PAL.amber : PAL.panelLight });
      const idx = Math.max(0, (P.START_MISSIONS || ['m1', 'm3']).indexOf(startId)) + 1;
      R.text(ctx, 'START (' + idx + '/' + ((P.START_MISSIONS || ['m1', 'm3']).length) + ', Taste M)', rx, 207, { color: isArena ? PAL.amber : PAL.brass });
      R.button(ctx, rx, 217, rw, 16, startId === 'm1' ? 'Start: Kampagne' : startLabel, {
        hotkey: 'M', active: direct, disabled: !me || !view.actions.toggleStartMission, reason: 'Noch nicht verbunden',
        onClick: () => view.actions.toggleStartMission(),
      });
      R.text(ctx, startHint, rx, 236, { color: direct ? PAL.amber : PAL.panelLight });

      const ready = !!(me && me.ready);
      R.button(ctx, VW / 2 - 84, 252, 168, 20, ready ? 'Bereit! (Enter: zurück)' : 'Bereit melden', {
        hotkey: 'Enter', active: ready, disabled: !me, reason: 'Noch nicht verbunden',
        onClick: () => view.actions.toggleReady(),
      });
      R.text(ctx, 'Das Spiel startet, sobald alle Verbundenen bereit sind.', VW / 2, 282, { color: PAL.panelLight, align: 'center' });
      R.text(ctx, view.audioOn ? 'Ton aktiv' : 'Klick oder Taste aktiviert den Ton', VW / 2, 322, { color: view.audioOn ? PAL.moss : PAL.amber, align: 'center' });
      R.text(ctx, 'WASD laufen · E interagieren · Esc Konsole verlassen · Tab Crew', VW / 2, 336, { color: PAL.panelLight, align: 'center' });
      this.drawNotices(ctx, view, 4);
    },

    // M0: Raumcode-Eingabe nach badcode (Eingabefeld ist ein DOM-Input wie das Namensfeld)
    LOBBY_CODE_RECT: { x: 260, y: 168, w: 120, h: 24 },
    drawCodeEntry(ctx, view) {
      R.panel(ctx, 150, 92, 340, 180, { style: 'brass', title: 'RAUMCODE' });
      R.text(ctx, 'Dieses Schiff ist abgeschlossen.', VW / 2, 114, { color: PAL.amber, align: 'center' });
      R.text(ctx, Net.badCodeText || 'Bitte den Raumcode eingeben.', VW / 2, 128, { color: Net.roomCode ? PAL.red : PAL.panelLight, align: 'center' });
      R.text(ctx, 'Den Code (4 Zeichen) bekommst du vom Gastgeber.', VW / 2, 146, { color: PAL.panelLight, align: 'center' });
      const q = this.LOBBY_CODE_RECT;
      ctx.strokeStyle = PAL.brass; ctx.strokeRect(q.x - 0.5, q.y - 0.5, q.w + 1, q.h + 1);
      R.button(ctx, VW / 2 - 60, 204, 120, 18, 'An Bord gehen', { hotkey: 'Enter', onClick: () => view.actions.submitCode() });
      R.text(ctx, 'Tipp: Der Einladungslink enthält den Code schon (?code=…).', VW / 2, 240, { color: PAL.panelLight, align: 'center' });
    },

    // ---------------------------------------------------------------- Ende
    drawEnd(ctx, view) {
      const st = view.state;
      const s = st.stats || {};
      const x = 130, y = 40, w = 380, h = 280;
      ctx.fillStyle = 'rgba(11,14,26,0.6)'; ctx.fillRect(0, 0, VW, VH);
      R.panel(ctx, x, y, w, h, { style: 'brass' });
      if (st.world) return this.drawEndM1(ctx, view, x, y, w, h);
      R.text(ctx, 'ENDE DER DEMO', VW / 2, y + 12, { color: PAL.amber, scale: 2, align: 'center' });
      R.text(ctx, 'Die stumme Boje', VW / 2, y + 32, { color: PAL.mint, align: 'center' });
      const rows = [
        ['Spielzeit', fmtTime(s.elapsed != null ? s.elapsed : st.time)],
        ['Abschüsse', s.kills || 0], ['Reparaturen', s.repairs || 0], ['Gelöschte Feuer', s.firesOut || 0],
        ['Treffer kassiert', s.hits || 0], ['Notfallprotokolle', s.emergencies || 0],
      ];
      let ly = y + 50;
      for (const [k, v] of rows) {
        R.text(ctx, k, x + 40, ly, { color: PAL.panelLight });
        R.text(ctx, String(v), x + w - 40, ly, { color: PAL.star, align: 'right' });
        ly += 11;
      }
      ly += 6;
      const tz = st.mission && st.mission.teaser;
      R.text(ctx, 'NÄCHSTER AUFTRAG', x + 20, ly, { color: PAL.brass }); ly += 11;
      if (tz && tz.status === 'ready') {
        R.text(ctx, tz.title || '—', x + 20, ly, { color: PAL.amber }); ly += 10;
        R.text(ctx, 'von ' + (tz.from || '?') + ' · Quelle: ' + (tz.source === 'claude' ? 'Claude (live erzeugt)' : 'Archiv') + (tz.reward ? ' · ' + tz.reward + ' Marken' : ''), x + 20, ly, { color: PAL.panelLight }); ly += 11;
        for (const l of R.wrap(tz.briefing || '', w - 40, 1).slice(0, 5)) { R.text(ctx, l, x + 20, ly, { color: PAL.star }); ly += 10; }
      } else {
        R.text(ctx, 'Funkspruch wird noch empfangen …', x + 20, ly, { color: PAL.panelLight }); ly += 10;
      }
      R.text(ctx, 'Der Folgeauftrag ist in dieser Demo nur als Text enthalten.', VW / 2, y + h - 40, { color: PAL.panelLight, align: 'center' });
      R.button(ctx, VW / 2 - 70, y + h - 26, 140, 18, 'Weiter erkunden', { hotkey: 'Enter', onClick: () => view.actions.dismissEnd() });
    },
    // M1: Ende-Screen „Fortsetzung folgt“ (Mission 2 abgeschlossen; Erkunden bleibt möglich)
    drawEndM1(ctx, view, x, y, w, h) {
      const st = view.state, s = st.stats || {}, m = st.mission || {};
      // M2: eigenes Ende nach „Die Tafel von Kesh“ (Text vom Server, falls er einen schickt)
      const m3 = (m.list || []).some(q => q.id === 'm3' && q.state === 'done');
      const endTitle = this.endTitle || (this.endText && this.endText.length <= 28 ? this.endText : null) || 'Die Tafel ist sicher';
      R.text(ctx, m3 ? String(endTitle).toUpperCase() : 'FORTSETZUNG FOLGT', VW / 2, y + 12, { color: PAL.amber, scale: 2, align: 'center' });
      const sub = m.endText || (m3 && this.endText && this.endText !== endTitle ? this.endText : null) || (m3 ? 'Die Vertragstafel ist in Sicherheit. Kesh wird man nicht so schnell vergessen.' : 'Das Kustoden-Relais spricht. Der Saumraum ist größer, als ihr dachtet.');
      R.wrap(sub, w - 30, 1).slice(0, 2).forEach((l, i) => R.text(ctx, l, VW / 2, y + 30 + i * 9, { color: PAL.mint, align: 'center' }));
      const disc = m.discoveries || {};
      const done = (m.list || []).filter(q => q.state === 'done');
      const rows = [
        ['Spielzeit', fmtTime(s.elapsed != null ? s.elapsed : st.time)],
        ['Aufträge erledigt', done.length ? done.map(q => q.title || q.id).join(', ') : '–'],
        ['Entdeckungen', (disc.found || 0) + ' / ' + (disc.total || 0)],
        ['Abschüsse', s.kills || 0], ['Reparaturen', s.repairs || 0], ['Gelöschte Feuer', s.firesOut || 0],
        ['Notfallprotokolle', s.emergencies || 0],
      ];
      let ly = y + 50;
      for (const [k, v] of rows) {
        R.text(ctx, k, x + 30, ly, { color: PAL.panelLight });
        let val = String(v);
        while (R.measure(val, 1) > w - 170 && val.length > 4) val = val.slice(0, -2);
        R.text(ctx, val, x + w - 30, ly, { color: PAL.star, align: 'right' });
        ly += 11;
      }
      ly += 6;
      const log = (m.log || []).slice(-4);
      if (log.length) {
        R.text(ctx, 'AUS DEM LOGBUCH', x + 20, ly, { color: PAL.brass }); ly += 11;
        for (const e of log) for (const l of R.wrap('· ' + (e.text || ''), w - 40, 1).slice(0, 1)) { R.text(ctx, l, x + 20, ly, { color: PAL.star }); ly += 10; }
      }
      R.text(ctx, m3 ? 'Ausbaustufe „Schildwall“ geschafft.' : 'Meilenstein 1 geschafft – in M2 füllt sich die Welt.', VW / 2, y + h - 40, { color: PAL.panelLight, align: 'center' });
      R.button(ctx, VW / 2 - 70, y + h - 26, 140, 18, 'Weiter erkunden', { hotkey: 'Enter', onClick: () => view.actions.dismissEnd() });
    },

    // ---------------------------------------------------------------- Verbindung
    drawConnection(ctx, view) {
      const s = Net.status;
      let msg = null, sub = '';
      if (s === 'lost') { msg = 'Verbindung verloren – verbinde neu …'; sub = 'Versuch ' + Math.max(1, Net.attempts); }
      else if (s === 'connecting' && !view.state) { msg = 'Verbinde mit dem Schiff …'; sub = Net.attempts > 1 ? 'Versuch ' + Net.attempts : ''; }
      else if (s === 'full') { msg = 'Server voll'; sub = Net.fullText || 'Es sind bereits 3 Spieler an Bord.'; }
      else if (s === 'nofile') { msg = 'Bitte über den Server öffnen'; sub = 'npm start, dann http://localhost:3300 (oder ?mock=1 zum Testen)'; }
      if (!msg) return;
      ctx.fillStyle = 'rgba(11,14,26,0.78)'; ctx.fillRect(0, 0, VW, VH);
      R.panel(ctx, 140, 140, 360, 70, { style: 'screen' });
      R.text(ctx, msg, VW / 2, 158, { color: s === 'full' ? PAL.red : PAL.amber, align: 'center' });
      R.text(ctx, sub, VW / 2, 176, { color: PAL.panelLight, align: 'center' });
      const dots = '.'.repeat(1 + Math.floor(view.time * 2) % 3);
      if (s === 'lost' || s === 'connecting') R.text(ctx, dots, VW / 2, 190, { color: PAL.mint, align: 'center' });
    },
  };

  window.Hud = Hud;
})();
