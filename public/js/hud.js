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
  // B2: Waffen- und Zustandsnamen (Snapshot wf / zs / bt)
  const WAFFE_KURZ = { schrottblaster: 'Schrottbl.', sturmgewehr: 'Gewehr', granatwerfer: 'Granaten', betaeuber: 'Betäuber', nahkampf: 'Klinge' };
  const WAFFE_NAME = { blaster: 'Blaster', sturmgewehr: 'Sturmgewehr', granatwerfer: 'Granatwerfer', lanze: 'Lanze', nahkampf: 'Nahkampf', betaeuber: 'Betäuber', faust: 'Faust', pistole: 'Pistole', schrottblaster: 'Schrottblaster' };
  // Icon je Waffe; schrottblaster (Rostmeute) = Blaster-Icon (Nachtrag Studioleitung)
  function waffeIcon(wf) { return wf === 'schrottblaster' ? 'blaster' : wf; }
  const ZS_TEXT = { betaeubt: 'BETÄUBT', bewusstlos: 'BEWUSSTLOS – niemand kann helfen', gefesselt: 'GEFESSELT – Kamerad: E halten', gefangen: 'GEFANGEN – Ausbruch!', verwundet: 'VERWUNDET' };
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
    pushNotice(text, color, dur) {
      if (!text) return;
      this.notices = this.notices.filter(n => n.text !== text);
      this.notices.push({ text: String(text), color: color || PAL.warn, t: performance.now() / 1000, d: dur > 0 ? +dur : 3 });   // S1: dur optional (s)
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
      this.notices = this.notices.filter(n => now - n.t < (n.d || 3));
    },

    // ---------------------------------------------------------------- Haupt-Zeichnen
    draw(ctx, view) {
      const st = view.state;
      if (!st || st.phase === 'lobby' || !view.me) return;
      const inConsole = !!view.me.console;
      if (!inConsole) {
        if (view.self.zone === 'away') this.drawAwayHud(ctx, view); else this.drawShipHud(ctx, view);
        const objBottom = this.drawObjectives(ctx, view);
        Net.guard('Hud.planningLine', () => this.drawPlanningLine(ctx, view, (objBottom || 30) + 2));   // S2
        this.drawInteraction(ctx, view);
        this.drawCarry(ctx, view);
        const radioBottom = this.drawRadio(ctx, view, false);
        Net.guard('Hud.escortStrip', () => this.drawEscortStrip(ctx, view, radioBottom ? radioBottom + 3 : 6));   // S2
      } else {
        this.drawRadio(ctx, view, true);
      }
      if (!inConsole) this.drawReactorHint(ctx, view);
      this.drawArrival(ctx);
      if (!inConsole) this.drawBarks(ctx, view);
      this.drawOda(ctx, view, inConsole);
      this.drawNotices(ctx, view);
      if (this.showCrew && !inConsole) this.drawCrew(ctx, view);
      if (st.wellen) Net.guard('Hud.wellen', () => this.drawWellen(ctx, view, inConsole));   // Bodenkampf: Wellen
    },

    // ---------------------------------------------------------------- Bodenkampf: Wellen
    // Snapshot wellen { k, s, n, ph, t, r, l } (shared/protocol.js); Ereignisse welle/welleGeschafft/wellenEnde setzt client.js
    // in wellenBanner/wellenErgebnis. Rekorde je Karte: wellenRekorde (localStorage, client.js).
    wellenBanner: null, wellenErgebnis: null, wellenRekorde: {},
    wellenKarteName(k) { const P = window.Shared_Protocol || {}; return (P.WELLEN_KARTEN_NAMEN && P.WELLEN_KARTEN_NAMEN[k]) || k || '–'; },
    drawWellen(ctx, view, inConsole) {
      const w = view.state.wellen;
      const t = performance.now();
      if (!inConsole) {
        // Kasten oben Mitte (oben rechts liegt die Orbit-/Transfer-Anzeige): Welle, verbleibende Gegner bzw. Countdown
        const bw = 150, bx = Math.round(VW / 2 - bw / 2), by = 4;
        R.backdrop(ctx, bx, by, bw, 30, 0.62);
        R.text(ctx, w.n ? 'WELLE ' + w.n : 'WELLEN', bx + 6, by + 4, { color: PAL.amber });
        R.text(ctx, this.fit(this.wellenKarteName(w.k), 70, 1), bx + bw - 6, by + 4, { color: PAL.panelLight, align: 'right' });
        let line, col = PAL.star;
        if (w.ph === 'kampf') { line = 'Gegner übrig: ' + w.r + (w.r > w.l ? ' (' + w.l + ' da)' : ''); col = w.r ? PAL.star : PAL.mint; }
        else if (w.ph === 'countdown') { line = 'Welle 1 in ' + w.t + ' s'; col = PAL.amber; }
        else if (w.ph === 'pause') { line = 'Nächste Welle in ' + w.t + ' s'; col = PAL.mint; }
        else line = 'Runde vorbei';
        R.text(ctx, line, bx + 6, by + 17, { color: col });
      }
      // Banner Mitte oben: Countdown/Pause dauerhaft, Wellenbeginn kurz
      let big = null, sub = null, bc = PAL.amber;
      if (w.ph === 'countdown') { big = 'WELLE 1 IN ' + w.t; sub = 'Deckung suchen – sie kommen von den Eingängen'; }
      else if (w.ph === 'pause') { big = 'Welle ' + w.n + ' überstanden – nächste in ' + w.t + ' s'; sub = 'Alle wieder auf den Beinen, Wunden versorgt'; bc = PAL.mint; }
      else if (w.ph === 'kampf' && this.wellenBanner && t - this.wellenBanner.t0 < 2600) { big = this.wellenBanner.text; sub = this.wellenBanner.sub; }
      if (big && w.ph !== 'ende') {
        const scale = R.measure(big, 2) > VW - 40 ? 1 : 2;
        const bh = scale === 2 ? 34 : 26;
        R.backdrop(ctx, VW / 2 - (R.measure(big, scale) / 2 + 14), 52, R.measure(big, scale) + 28, bh, 0.6);
        R.text(ctx, big, VW / 2, 56, { color: bc, scale, align: 'center' });
        if (sub) R.text(ctx, sub, VW / 2, 56 + (scale === 2 ? 20 : 12), { color: PAL.panelLight, align: 'center' });
      }
      if (w.ph === 'ende') this.drawWellenErgebnis(ctx, view, w);
    },
    drawWellenErgebnis(ctx, view, w) {
      const e = this.wellenErgebnis && this.wellenErgebnis.karte === w.k && this.wellenErgebnis.seed === w.s ? this.wellenErgebnis : null;
      const x = 170, y = 60, bw = 300, bh = 220;
      ctx.fillStyle = 'rgba(11,14,26,0.55)'; ctx.fillRect(0, 0, VW, VH);
      R.panel(ctx, x, y, bw, bh, { style: 'brass' });
      R.text(ctx, 'RUNDE VORBEI', VW / 2, y + 12, { color: PAL.amber, scale: 2, align: 'center' });
      R.text(ctx, this.wellenKarteName(w.k) + ' · Seed ' + w.s, VW / 2, y + 32, { color: PAL.mint, align: 'center' });
      const welle = e ? e.welle : w.n;
      const rows = [['Erreicht', 'Welle ' + welle + (welle > 1 ? ' (' + (welle - 1) + ' überstanden)' : '')], ['Zeit', e ? fmtTime(e.zeit) : '–']];
      let ly = y + 50;
      for (const [k, v] of rows) { R.text(ctx, k, x + 30, ly, { color: PAL.panelLight }); R.text(ctx, String(v), x + bw - 30, ly, { color: PAL.star, align: 'right' }); ly += 12; }
      ly += 4;
      R.text(ctx, 'ABSCHÜSSE', x + 30, ly, { color: PAL.brass }); ly += 12;
      const players = view.state.players || [];
      for (const [pid, name, n] of (e ? e.kills : [])) {
        const p = players.find(q => q.id === pid);
        const col = p ? PAL.players[p.color || 0] : PAL.star;
        R.text(ctx, String(name || '?').slice(0, 14) + (pid === view.pid ? ' (du)' : ''), x + 40, ly, { color: col });
        R.text(ctx, String(n), x + bw - 30, ly, { color: PAL.star, align: 'right' });
        ly += 11;
      }
      ly += 6;
      const rek = (this.wellenRekorde || {})[w.k];
      if (e && e.debug) R.text(ctx, 'Debug-Sprung – zählt nicht als Rekord', VW / 2, ly, { color: PAL.panelLight, align: 'center' });
      else if (e && e.rekordNeu) R.text(ctx, 'NEUER REKORD auf dieser Karte!', VW / 2, ly, { color: PAL.amber, align: 'center' });
      else if (rek) R.text(ctx, 'Rekord hier: Welle ' + rek.welle + ' · ' + fmtTime(rek.zeit), VW / 2, ly, { color: PAL.panelLight, align: 'center' });
      R.text(ctx, 'Zurück in die Lobby in ' + w.t + ' s', VW / 2, y + bh - 40, { color: PAL.panelLight, align: 'center' });
      R.button(ctx, VW / 2 - 70, y + bh - 26, 140, 18, 'Zur Lobby', { hotkey: 'Enter', onClick: () => view.actions.wellenLobby && view.actions.wellenLobby() });
    },
    // Lobby: Kartenwahl (K), Seed-Hinweis, Rekord – ersetzt dort den Block HAFEN-ÜBUNG
    drawLobbyWellen(ctx, view, rx, rw, me) {
      const lob = (view.state && view.state.lobby) || {};
      const k = lob.wellen || null;
      const url = lob.arena && lob.arena.art ? lob.arena : null;
      R.text(ctx, 'KARTE', rx, 164, { color: PAL.brass });
      R.text(ctx, url && k ? 'Seed ' + url.seed + ' (fest)' : k ? 'neuer Seed je Start' : '', rx + rw, 164, { color: PAL.panelLight, align: 'right' });
      R.button(ctx, rx, 174, rw, 16, k ? this.wellenKarteName(url ? url.art : k) : 'Kesh/m3 (ohne Wellen)', {
        hotkey: 'K', active: !!k, disabled: !me, reason: 'Noch nicht verbunden',
        onClick: () => view.actions.toggleWellenKarte && view.actions.toggleWellenKarte(),
      });
      const rek = k ? (this.wellenRekorde || {})[url ? url.art : k] : null;
      const last = this.wellenErgebnis;
      let info = rek ? 'Rekord: Welle ' + rek.welle + ' · ' + fmtTime(rek.zeit) : k ? 'Noch kein Rekord' : 'K: Karte wählen';
      if (last && k && last.karte === (url ? url.art : k)) info += ' · zuletzt W' + last.welle;
      R.text(ctx, this.fit(info, rw, 1), rx, 193, { color: rek ? PAL.amber : PAL.panelLight });
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
      return 4 + h;   // S2: Unterkante (Planungszeile darunter)
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

    WAFFE_NAME, WAFFE_KURZ, ZS_TEXT, waffeIcon,
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
      this.drawJumpLine(ctx, view, 63);
      // Mini-Schiffsplan unten rechts
      const map = Maps.ship;
      R.drawMiniPlan(ctx, view, VW - map.w * 3 - 6, VH - map.h * 3 - 6, { zone: 'ship', cell: 3 });
      this.drawEdgeArrows(ctx, view);
    },

    // B3: Sprungstatus unter dem Raumnamen (Ziel, Abstand zum Sprungpunkt ship.jump.d, bereit). -> Höhe der Zeile (0 = keine)
    jumpLineH: 0,
    drawJumpLine(ctx, view, y) {
      const st = view.state, j = (st.ship && st.ship.jump) || {};
      this.jumpLineH = 0;
      if (!j.dest || st.phase === 'lobby') return 0;
      const r = (CFG.sektoren && CFG.sektoren.sprungpunktRadius) || 250;
      let txt, col;
      if (j.ready) { txt = 'SPRUNG BEREIT → ' + R.locName(st, j.dest); col = PAL.mint; }
      else if (j.d != null && j.blockedReason && /^Sprungpunkt/.test(j.blockedReason)) { txt = 'SPRUNGPUNKT ' + R.locName(st, j.dest) + ': ' + j.d + ' m'; col = PAL.amber; }
      else if (j.d != null && j.d <= r) { txt = 'AM SPRUNGPUNKT → ' + R.locName(st, j.dest); col = PAL.mint; }
      else { txt = 'SPRUNG → ' + R.locName(st, j.dest) + (j.charge > 0 && !j.blockedReason ? ' · lädt ' + Math.round(j.charge * 100) + ' %' : ''); col = PAL.star; }
      const w = R.measure(txt, 1) + 8;
      R.backdrop(ctx, VW - 2 - w, y - 1, w, 11, 0.62);
      R.text(ctx, txt, VW - 6, y, { color: col, align: 'right' });
      this.jumpLineH = 12;
      return 12;
    },

    // M1: Reaktor überladen / offline – Anzeige und Neustart-Hinweise (§6)
    drawReactorHint(ctx, view) {
      const st = view.state;
      const r = (st.ship && st.ship.reactor) || {};
      const onShip = view.self.zone === 'ship';
      const x = VW - 232, y = (onShip ? 66 : 50) + (onShip ? this.jumpLineH : 0), w = 228;
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
      const mc = map.w > 48 || map.h > 30 ? 2 : 3;   // B1: große gebaute Karten kleiner
      R.drawMiniPlan(ctx, view, VW - map.w * mc - 6, VH - map.h * mc - 6, { zone: 'away', cell: mc });
      // M1: Wrack-Hinweise (Bergung, Hohlraum) und Plan-Pins dieser Karte
      const pins = ((st.plan && st.plan.pins) || []).filter(p => p.map === map.id);
      let hy = VH - map.h * mc - 20;
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
      } else if (R.isBuehne(map)) {
        // B1: gebaute Karte – Alarm, Countdown der Ladung (away.cd), offene Anker
        const lines = [];
        if (away.al) lines.push(['ALARM – Besatzung gewarnt', Math.floor(view.time * 2) % 2 ? PAL.red : '#FF8A7A']);
        if (away.cd) {
          const a = map.anker && map.anker[away.cd.i];
          lines.push(['LADUNG SCHARF · ' + Math.ceil(+away.cd.t || 0) + ' s', Math.floor(view.time * 4) % 2 ? PAL.red : PAL.amber]);
          // gut sichtbarer Countdown oben mittig (away.cd { i, t })
          const txt = 'LADUNG SCHARF ' + Math.ceil(+away.cd.t || 0) + ' s';
          const w = R.measure(txt, 2) + 16;
          R.backdrop(ctx, Math.round(VW / 2 - w / 2), 4, w, 22, 0.8);
          R.text(ctx, txt, VW / 2, 8, { color: Math.floor(view.time * 4) % 2 ? PAL.red : PAL.amber, align: 'center', scale: 2 });
        }
        const cnt = {};
        (map.anker || []).forEach((a, i) => {
          if (['terminal', 'sprengpunkt', 'beute', 'fund', 'zelle'].indexOf(a[1]) < 0) return;
          const z = R.ankerZustand(map, st, i);
          const c = cnt[a[1]] || (cnt[a[1]] = [0, 0]); c[1]++;
          if (['geladen', 'zerstoert', 'leer', 'genommen', 'offen'].indexOf(z) >= 0) c[0]++;
          if (a[1] === 'terminal' && z === 'laedt') c.laedt = true;
        });
        for (const r of Object.keys(cnt)) lines.push([(R.ANKER_NAME[r] || r) + ': ' + cnt[r][0] + '/' + cnt[r][1] + (cnt[r].laedt ? ' · lädt' : ''), cnt[r][0] === cnt[r][1] ? PAL.mint : PAL.star]);
        if (pins.length) lines.push(['Plan-Pins: ' + pins.length, PAL.panelLight]);
        if (lines.length) {
          hy = VH - map.h * mc - 12 - lines.length * 10;
          R.backdrop(ctx, VW - 196, hy - 2, 192, lines.length * 10 + 4, 0.7);
          lines.forEach((l, i) => R.text(ctx, l[0], VW - 192, hy + i * 10, { color: l[1] }));
        }
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
      const waffeZeile = me.wf != null;   // B2: Waffe mit Hitze (Snapshot wf/ht/ov/ch/wu)
      const zsZeile = !!(me.bt || (me.zs && me.zs !== 'ok' && me.zs !== 'verwundet'));
      const h = 44 + team.length * 11 + (crouched ? 11 : 0) + (waffeZeile ? 12 : 0) + (zsZeile ? 11 : 0);
      const y0 = VH - h - 4;
      R.backdrop(ctx, 4, y0, 170, h, 0.68);   // schmal genug, dass die ODA-Box (unten mittig) nichts verdeckt
      // Schild
      R.text(ctx, 'SCHILD', 8, y0 + 5, { color: R.SHIELD_COL });
      R.drawShieldPips(ctx, 46, y0 + 3, sh[0], sh[1], me.downed ? 0 : (+me.shR || 0), 12, 3);
      // B2: Wunden-Pip im Raster der Schildsegmente (Spieler: 1 Wunde; fällt = 0)
      let wx = 46 + sh[1] * 15;
      if (waffeZeile && window.IconsB && typeof IconsB.wundenPips === 'function') {
        const wm = Math.max(1, +me.wm || 1), wn = me.downed || (me.zs && me.zs !== 'ok') ? 0 : (me.wn != null ? +me.wn : wm);
        wx += 2 + IconsB.wundenPips(ctx, wx + 2, y0 + 3, wn, wm, 12, 3);
      }
      const mx = wx + 8;
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
      if (waffeZeile) { this.drawWaffeZeile(ctx, view, 8, y); y += 12; }
      if (zsZeile) {
        const id = me.bt ? 'betaeubt' : me.zs;
        R.statusIcon(ctx, id, 14, y + 3);
        R.text(ctx, ZS_TEXT[id] || id, 24, y, { color: PAL.warn });
        y += 11;
      }
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
        if (p.zs && p.zs !== 'ok' && p.zs !== 'verwundet') { R.statusIcon(ctx, p.zs, 88, y + 4); R.text(ctx, (ZS_TEXT[p.zs] || p.zs).split(' ')[0], 96, y, { color: PAL.warn }); }
        else if (p.downed) R.text(ctx, 'VERWUNDET' + (p.bleed != null ? ' ' + Math.ceil(p.bleed) + ' s' : ''), 82, y, { color: PAL.red });
        else if (ps) R.drawShieldPips(ctx, 82, y + 1, ps[0], ps[1], +p.shR || 0, 7, 2);
        if (p.medkit && !p.downed) { ctx.fillStyle = PAL.star; ctx.fillRect(ps ? 82 + ps[1] * 9 + 4 : 150, y + 1, 7, 7); ctx.fillStyle = PAL.red; ctx.fillRect((ps ? 82 + ps[1] * 9 + 4 : 150) + 3, y + 2, 1, 5); ctx.fillRect((ps ? 82 + ps[1] * 9 + 4 : 150) + 1, y + 4, 5, 1); }
        y += 11;
      }
      R.text(ctx, me.downed ? 'Klick: Pistole · Q: Markieren' : 'Klick ' + (WAFFE_NAME[me.wf] || 'Blaster') + ' · Q Mark. · C ducken', 8, y, { color: PAL.panelLight });
      if (me.downed) this.drawDownedBanner(ctx, view);
      return y0;
    },
    // B2: Waffe (Icon, Name), Hitzebalken; überhitzt, Lanze lädt, Ausholen
    drawWaffeZeile(ctx, view, x, y) {
      const me = view.me, IB = window.IconsB;
      const wf = me.wf || 'blaster';
      const wi = waffeIcon(wf);
      if (!(IB && IB.draw && IB.has && IB.has('waffe', wi) && IB.draw(ctx, 'waffe', wi, x + 6, y + 4, {}) !== false)) { ctx.fillStyle = PAL.star; ctx.fillRect(x, y, 10, 8); }
      R.text(ctx, WAFFE_KURZ[wf] || WAFFE_NAME[wf] || wf, x + 15, y, { color: PAL.star });
      const bx = x + 68, bw = 54;
      const ht = Math.max(0, Math.min(100, +me.ht || 0)) / 100;
      const ov = !!me.ov;
      const ibOk = !!(IB && typeof IB.hitzebalken === 'function' && IB.hitzebalken(ctx, bx, y + 1, bw, 6, ht, { ueberhitzt: ov, t: view.time }) !== false);
      if (!ibOk) {
        ctx.fillStyle = '#1A2230'; ctx.fillRect(bx, y + 1, bw, 6);
        ctx.fillStyle = ov ? PAL.red : ht > 0.7 ? '#FF8A4C' : PAL.amber; ctx.fillRect(bx, y + 1, Math.round(bw * ht), 6);
      }
      // Zustand rechts neben dem Balken (kurz): überhitzt, Lanze lädt, Ausholen
      const tx = bx + bw + (ibOk && ov ? 12 : 4);   // IconsB setzt beim Überhitzen eine Flamme rechts an den Balken
      if (ov) R.text(ctx, 'HEISS', tx, y, { color: Math.floor(view.time * 4) % 2 ? PAL.red : PAL.star });
      else if (+me.ch > 0) R.text(ctx, Math.round(+me.ch) + '%', tx, y, { color: '#FFF1B8' });
      else if (+me.wu > 0) R.text(ctx, 'HOLT', tx, y, { color: '#FFF1B8' });
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
      return 6 + h;   // S2: Unterkante (Schützling-Zeile darunter)
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

    drawNotices(ctx, view, y0, max) {
      const now = performance.now() / 1000;
      let y = y0 == null ? 96 : y0;
      let all = this.notices.slice();
      if (R.uiDenied && performance.now() - R.uiDenied.t < 1800) all.push({ text: R.uiDenied.text, color: PAL.warn, t: R.uiDenied.t / 1000 });
      if (max > 0) all = all.slice(-max);   // S1: über Overlays nur der neueste Hinweis
      // QA-Abnahme S2: lange Hinweise (z. B. Logbuch-Notizen) umbrechen statt abschneiden – höchstens 2 Zeilen
      const maxW = Math.min(VW - 40, 440);
      for (const n of all) {
        let lines = [n.text];
        if (R.measure(n.text, 1) > maxW) {
          lines = [''];
          for (const word of String(n.text).split(' ')) {
            const cur = lines[lines.length - 1];
            const next = cur ? cur + ' ' + word : word;
            if (cur && R.measure(next, 1) > maxW) lines.push(word); else lines[lines.length - 1] = next;
          }
          if (lines.length > 2) { lines = [lines[0], this.fit(lines.slice(1).join(' '), maxW, 1)]; }
        }
        const w = Math.max(...lines.map((l) => R.measure(l, 1))) + 12;
        const h = 13 + (lines.length - 1) * 10;
        const a = Math.max(0, Math.min(1, (n.d || 3) - (now - n.t)));
        ctx.globalAlpha = a;
        R.backdrop(ctx, VW / 2 - w / 2, y, w, h, 0.85);
        ctx.strokeStyle = n.color; ctx.strokeRect(VW / 2 - w / 2 + 0.5, y + 0.5, w - 1, h - 1);
        lines.forEach((l, i) => R.text(ctx, l, VW / 2, y + 3 + i * 10, { color: n.color, align: 'center' }));
        ctx.globalAlpha = 1;
        y += h + 3;
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
      R.text(ctx, 'Steuerung: WASD laufen · E interagieren (halten) · G ablegen · C ducken · Esc Menü', x + 10, y + h - 14, { color: PAL.panelLight });
    },

    // ---------------------------------------------------------------- Lobby (Canvas; Name per DOM-Input)
    LOBBY_NAME_RECT: { x: 130, y: 104, w: 170, h: 16 },
    drawLobby(ctx, view) {
      const st = view.state || {};
      const t = view.time;
      if (!R.art('drawStarfield', null, [ctx, t * 20, 0, VW, VH, t])) { ctx.fillStyle = PAL.space; ctx.fillRect(0, 0, VW, VH); }
      ctx.fillStyle = 'rgba(11,14,26,0.55)'; ctx.fillRect(0, 0, VW, VH);
      R.text(ctx, 'PANTHEON', VW / 2, 30, { color: PAL.amber, scale: 2, align: 'center' });
      R.text(ctx, 'Eine Crew, ein Schiff · Koop für 1–3 Spieler', VW / 2, 54, { color: PAL.mint, align: 'center' });
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
      R.text(ctx, 'An Bord', lx, 164, { color: PAL.panelLight });
      let y = 175;
      for (const p of players.slice(0, 3)) {
        const col = PAL.players[p.color || 0];
        R.shape(ctx, R.SHAPES[p.color || 0], lx + 6, y + 4, 8, col);
        R.text(ctx, String(p.name || '?').slice(0, 12) + (p.id === view.pid ? ' (du)' : ''), lx + 16, y, { color: col });
        R.text(ctx, p.connected === false ? 'getrennt' : p.ready ? 'BEREIT' : 'wartet', lx + 196, y, { color: p.ready ? PAL.mint : PAL.panelLight, align: 'right' });
        y += 11;
      }
      if (!players.length) R.text(ctx, Net.status === 'open' ? 'warte auf Server …' : 'verbinde …', lx + 16, y, { color: PAL.panelLight });
      // S1: Block WELTSTAND (über dem Bereit-Knopf, y ≤ 250)
      this.drawLobbyWorld(ctx, view, lx, 211, 200);

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
      const resume = !!(st.lobby && st.lobby.world && this.lobbyWorld(st));   // S1: Weltstand gewählt -> Startauswahl entfällt
      const direct = startId !== 'm1' || resume;
      const isArena = startId === 'arena_space' || startId === 'arena_away';
      const P = window.Shared_Protocol || {};
      const starts = this.startList();
      const startLabel = (P.START_LABELS && P.START_LABELS[startId]) || { m1: 'Kampagne', free: 'Kampagne ohne Tutorial', m3: 'Direkt zur Planetenmission' }[startId] || startId;
      const startHint = (P.START_HINTS && P.START_HINTS[startId]) || { m1: 'Von vorn: Boje, Nebel, Kesh', free: 'Freier Flug ab Hafen Lichtkordon', m3: 'Direkt: „Die Tafel von Kesh“', arena_space: 'Wellen von Jägern & Co. (solo ok)', arena_away: 'Sofort auf Kesh, Kampf im Hof' }[startId] || '';
      const skip = !!(st.lobby && st.lobby.skipDrill);
      if (startId === 'arena_away' && !resume) this.drawLobbyWellen(ctx, view, rx, rw, me);   // Bodenkampf: Wellen – Kartenwahl statt Übung
      else {
        R.text(ctx, 'HAFEN-ÜBUNG', rx, 164, { color: PAL.brass });
        R.button(ctx, rx, 174, rw, 16, direct ? '[–] Übung entfällt' : skip ? '[x] Übung überspringen' : '[ ] Übung überspringen', {
          hotkey: 'U', active: skip && !direct, disabled: !me || direct,
          reason: !me ? 'Noch nicht verbunden' : resume ? 'Entfällt beim Fortsetzen' : isArena ? 'Entfällt im Testgelände' : startId === 'free' ? 'Entfällt ohne Tutorial' : 'Entfällt beim Direktstart der Planetenmission',
          onClick: () => view.actions.toggleSkipDrill(),
        });
        R.text(ctx, resume ? 'Fortsetzen: keine Übung.' : isArena ? 'Testgelände: keine Übung.' : startId === 'free' ? 'Ohne Tutorial: keine Übung.' : direct ? 'Direktstart: keine Übung.' : skip ? 'Direkt zum Funkspruch.' : 'Tutorial: löschen, flicken.', rx, 193, { color: skip && !direct ? PAL.amber : PAL.panelLight });
      }
      const idx = Math.max(0, starts.indexOf(startId)) + 1;
      R.text(ctx, 'START (' + idx + '/' + starts.length + ', Taste M)', rx, 207, { color: resume ? '#6B7380' : isArena ? PAL.amber : PAL.brass });
      R.button(ctx, rx, 217, rw, 16, startId === 'm1' ? 'Start: Kampagne' : startLabel, {
        hotkey: 'M', active: direct && !resume, disabled: !me || !view.actions.toggleStartMission || resume, reason: resume ? 'Entfällt beim Fortsetzen' : 'Noch nicht verbunden',
        onClick: () => view.actions.toggleStartMission(),
      });
      R.text(ctx, resume ? 'Entfällt beim Fortsetzen' : startHint, rx, 236, { color: resume ? '#6B7380' : direct ? PAL.amber : PAL.panelLight });

      const ready = !!(me && me.ready);
      R.button(ctx, VW / 2 - 84, 252, 168, 20, ready ? 'Bereit! (Enter: zurück)' : 'Bereit melden', {
        hotkey: 'Enter', active: ready, disabled: !me, reason: 'Noch nicht verbunden',
        onClick: () => view.actions.toggleReady(),
      });
      R.text(ctx, 'Das Spiel startet, sobald alle Verbundenen bereit sind.', VW / 2, 282, { color: PAL.panelLight, align: 'center' });
      R.text(ctx, view.audioOn ? 'Ton aktiv' : 'Klick oder Taste aktiviert den Ton', VW / 2, 322, { color: view.audioOn ? PAL.moss : PAL.amber, align: 'center' });
      R.text(ctx, this.LOBBY_HINT, VW / 2, 336, { color: PAL.panelLight, align: 'center' });
      R.button(ctx, VW - 92, VH - 22, 86, 16, 'Optionen', { hotkey: 'O', onClick: () => view.actions.openOptions && view.actions.openOptions() });
      // QA-Abnahme S1: bei offenem Overlay zeichnet drawUi den neuesten Hinweis – sonst lägen zwei Hinweise übereinander
      if (!(view.ui && view.ui.stack && view.ui.stack.length)) this.drawNotices(ctx, view, 4);
    },

    // ================================================================ S1: Weltstand, Hauptmenü, Spielmenü
    LOBBY_HINT: 'F Weltstand · O Optionen · Im Spiel: Esc Menü · Tab Crew',
    MISSION_TITLES: { m1: 'Die stumme Boje', m2: 'Echo im Nebel', m3: 'Die Tafel von Kesh' },
    WORLD_STATE_TEXT: { kaputt: 'Datei beschädigt', neuer: 'Aus einer neueren Version', belegt: 'In einer anderen Runde geöffnet' },
    // Startauswahl (Taste M): aus dem Protokoll; ab VERSION 5 ist 'free' Pflicht – fehlt es, ergänzt der Client es hinter m1
    startList() {
      const P = window.Shared_Protocol || {};
      const list = (P.START_MISSIONS && P.START_MISSIONS.length) ? P.START_MISSIONS.slice() : ['m1', 'm3'];
      if ((+P.VERSION || 0) >= 5 && list.indexOf('free') < 0) list.splice(Math.max(0, list.indexOf('m1')) + 1, 0, 'free');
      return list;
    },
    lobbyWorlds(st) { const l = st && st.lobby; return l && Array.isArray(l.worlds) ? l.worlds.filter(w => w && w.id != null) : []; },
    lobbyWorld(st) { const id = st && st.lobby && st.lobby.world; return id == null ? null : this.lobbyWorlds(st).find(w => w.id === id) || null; },
    worldsMax() { return (CFG.weltstand && CFG.weltstand.max) || 5; },
    locLabel(id) {
      if (!id) return '—';
      const SL = window.Shared_Locations;
      const l = SL && Array.isArray(SL.LOCATIONS) ? SL.LOCATIONS.find(q => q.id === id) : null;
      return l ? l.name : String(id);
    },
    missionLabel(mission, step) {
      if (!mission) return 'freier Flug';
      const t = this.MISSION_TITLES[mission] || String(mission);
      return t + (step ? ' · Schritt ' + step : '');
    },
    relDate(v) {
      let t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
      if (!isFinite(t)) return '';
      const s = (Date.now() - t) / 1000;
      const pad = (n) => String(n).padStart(2, '0');
      if (s < 90) return 'gerade eben';
      if (s < 3600) return 'vor ' + Math.round(s / 60) + ' Min.';
      const d = new Date(t), now = new Date();
      const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
      const days = Math.round((day(now) - day(d)) / 86400000);
      if (days <= 0) { const h = Math.round(s / 3600); return 'vor ' + h + (h === 1 ? ' Stunde' : ' Stunden'); }
      if (days === 1) return 'gestern ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      if (days < 7) return 'vor ' + days + ' Tagen';
      return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
    },
    playLabel(sec) {
      sec = Math.max(0, +sec || 0);
      if (sec < 3600) return Math.max(sec > 0 ? 1 : 0, Math.round(sec / 60)) + ' Min.';
      return Math.floor(sec / 3600) + ':' + String(Math.floor(sec / 60) % 60).padStart(2, '0') + ' h';
    },
    fit(str, w, scale) {
      str = String(str == null ? '' : str);
      if (R.measure(str, scale || 1) <= w) return str;
      while (str.length > 1 && R.measure(str + '…', scale || 1) > w) str = str.slice(0, -1);
      return str + '…';
    },
    // ⚠-Zeichen (die Pixelschrift kennt kein ⚠): gelbes Dreieck mit Ausrufezeichen
    warnIcon(ctx, x, y) {
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 6, y + 5); ctx.lineTo(x - 6, y + 5); ctx.closePath();
      ctx.fillStyle = PAL.warn; ctx.fill();
      ctx.fillStyle = PAL.space; ctx.fillRect(x - 0.5, y - 2, 1.5, 4); ctx.fillRect(x - 0.5, y + 3, 1.5, 1);
    },
    // Lobby-Block „WELTSTAND“: Neu: Kampagne / Fortsetzen … (F)
    drawLobbyWorld(ctx, view, x, y, w) {
      const st = view.state || {};
      const me = (st.players || []).find(p => p.id === view.pid);
      const worlds = this.lobbyWorlds(st);
      const chosen = this.lobbyWorld(st);
      const startId = (st.lobby && st.lobby.startMission) || 'm1';
      const campaign = startId === 'm1' || startId === 'free';
      const full = !!(st.lobby && st.lobby.worldsFull);
      R.text(ctx, 'WELTSTAND', x, y, { color: PAL.brass });
      R.text(ctx, worlds.length + '/' + this.worldsMax(), x + w, y, { color: full ? PAL.warn : PAL.panelLight, align: 'right' });
      let label;
      if (chosen) label = 'Fortsetzen: ' + chosen.name;
      else if (!campaign) label = 'Kein Weltstand (Testlauf)';
      else label = startId === 'free' ? 'Neu: Kampagne ohne Tutorial' : 'Neu: Kampagne';
      R.button(ctx, x, y + 10, w, 16, this.fit(label, w - 24, 1), {
        hotkey: 'F', active: !!chosen, disabled: !me, reason: 'Noch nicht verbunden',
        onClick: () => view.actions.openWorlds && view.actions.openWorlds('list'),
      });
      let info, col = PAL.panelLight;
      if (chosen) { info = this.playLabel(chosen.playTime) + ' · ' + this.locLabel(chosen.loc) + ' · ' + this.missionLabel(chosen.mission); col = PAL.mint; }
      else if (campaign && full) { info = 'Alle ' + this.worldsMax() + ' Plätze belegt – erst einen löschen (F)'; col = PAL.warn; }
      else if (!campaign) info = 'Test-Start legt keinen Weltstand an.';
      else if (worlds.length) info = worlds.length + (worlds.length === 1 ? ' Weltstand' : ' Weltstände') + ' – F: fortsetzen';
      else info = 'Noch kein Weltstand gespeichert.';
      R.text(ctx, this.fit(info, w, 1), x, y + 29, { color: col });
    },

    // ---------------------------------------------------------------- Overlays (Menü, Optionen, Steuerung, Weltstände)
    MENU_ITEMS: [['resume', 'Weiterspielen'], ['options', 'Optionen'], ['controls', 'Steuerung'], ['end', 'Partie beenden']],
    OPTION_ITEMS: ['volume', 'mute', 'render', 'fullscreen', 'back'],
    // Einträge je Seite (für die Tastatur-Navigation in client.js)
    pageItems(page, view) {
      if (page === 'menu') return this.MENU_ITEMS.map(i => i[0]);
      if (page === 'options') return this.OPTION_ITEMS.slice();
      if (page === 'confirmEnd') return ['cancel', 'end'];
      if (page === 'controls') return ['back'];
      if (page === 'worlds') return this.worldRows(view && view.state, view && view.ui).map(r => r.id);
      return [];
    },
    worldRows(st, ui) {
      const worlds = this.lobbyWorlds(st);
      const rows = worlds.map(w => ({ id: w.id, w }));
      return ui && ui.worldsMode === 'full' ? rows : [{ id: null, neu: true }].concat(rows);
    },
    drawUi(ctx, view, ui) {
      const page = ui && ui.stack.length ? ui.stack[ui.stack.length - 1] : null;
      if (!page) return;
      // alles darunter ist nicht mehr klickbar, Tooltips von unten verschwinden
      R.ui.buttons.length = 0; R.ui.tooltip = null;
      ctx.fillStyle = 'rgba(11,14,26,0.62)'; ctx.fillRect(0, 0, VW, VH);
      const sel = ui.sel[page] || 0;
      if (page === 'menu') this.drawMenuMain(ctx, view, sel);
      else if (page === 'confirmEnd') this.drawConfirmEnd(ctx, view, sel);
      else if (page === 'options') this.drawOptions(ctx, view, sel);
      else if (page === 'controls') this.drawControls(ctx, view);
      else if (page === 'worlds') this.drawWorlds(ctx, view, ui);
      this.drawNotices(ctx, view, 2, 1);   // Hinweise bleiben über dem Overlay lesbar
      R.drawTooltip(ctx);
    },
    drawMenuMain(ctx, view, sel) {
      const st = view.state || {};
      const w = 200, x = VW / 2 - w / 2, y = 92;
      const h = 30 + 12 + this.MENU_ITEMS.length * 22 + 14;
      R.panel(ctx, x, y, w, h, { style: 'brass', title: 'MENÜ' });
      const solo = (st.players || []).filter(p => p.connected !== false).length <= 1;
      R.text(ctx, st.paused ? 'PAUSE – das Spiel ruht' : solo ? 'Pause wird angefragt …' : 'Das Spiel läuft weiter', VW / 2, y + 12, { color: st.paused ? PAL.ice : PAL.panelLight, align: 'center' });
      let yy = y + 28;
      this.MENU_ITEMS.forEach(([id, label], i) => {
        R.button(ctx, x + 16, yy, w - 32, 18, label, { active: sel === i, color: id === 'end' && sel !== i ? PAL.rust : null, onClick: () => view.actions.uiActivate('menu', id) });
        yy += 22;
      });
      R.text(ctx, 'W/S wählen · Enter · Esc zurück', VW / 2, y + h - 13, { color: PAL.panelLight, align: 'center' });
    },
    drawConfirmEnd(ctx, view, sel) {
      const info = view.endInfo || {};
      const w = 320, x = VW / 2 - w / 2, y = 112, h = 104;
      R.panel(ctx, x, y, w, h, { style: 'brass', title: 'PARTIE BEENDEN' });
      R.text(ctx, 'Für alle beenden?', VW / 2, y + 12, { color: PAL.amber, scale: 2, align: 'center' });
      let line, col;
      if (!info.campaign) { line = 'Testlauf – hier wird nichts gespeichert.'; col = PAL.panelLight; }
      else if (info.docked) { line = 'Angedockt: Der Weltstand wird gesichert.'; col = PAL.mint; }
      else { line = 'Fortschritt seit dem letzten Andocken geht verloren.'; col = PAL.warn; }
      R.text(ctx, line, VW / 2, y + 36, { color: col, align: 'center' });
      R.text(ctx, 'Die ganze Crew kehrt ins Hauptmenü zurück.', VW / 2, y + 48, { color: PAL.panelLight, align: 'center' });
      R.button(ctx, x + 16, y + h - 32, 136, 18, 'Abbrechen', { hotkey: 'Esc', active: sel === 0, onClick: () => view.actions.uiActivate('confirmEnd', 'cancel') });
      R.button(ctx, x + w - 152, y + h - 32, 136, 18, 'Partie beenden', { active: sel === 1, color: sel === 1 ? null : PAL.rust, onClick: () => view.actions.uiActivate('confirmEnd', 'end') });
      R.text(ctx, 'A/D wählen · Enter bestätigen', VW / 2, y + h - 11, { color: PAL.panelLight, align: 'center' });
    },
    drawOptions(ctx, view, sel) {
      const o = view.optionsInfo || {};
      const w = 320, x = VW / 2 - w / 2, y = 78, h = 176;
      R.panel(ctx, x, y, w, h, { style: 'brass', title: 'OPTIONEN' });
      const rows = this.OPTION_ITEMS;
      const lx = x + 14, cx = x + 112, cw = w - 126;
      rows.forEach((id, i) => {
        const ry = y + 16 + i * 24;
        const on = sel === i;
        if (on) { ctx.fillStyle = 'rgba(255,198,107,0.12)'; ctx.fillRect(x + 6, ry - 3, w - 12, 22); ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1; ctx.strokeRect(x + 6.5, ry - 2.5, w - 13, 21); }
        const act = (dir) => () => { view.actions.uiSelect('options', i); view.actions.uiOption(id, dir); };
        if (id === 'volume') {
          R.text(ctx, 'Lautstärke', lx, ry + 4, { color: PAL.star });
          R.button(ctx, cx, ry, 18, 16, '−', { onClick: act(-1) });
          const v = Math.round((o.volume == null ? 0.8 : o.volume) * 100);
          R.bar(ctx, cx + 24, ry + 5, cw - 82, 6, v / 100, o.muted ? '#6B7380' : PAL.mint);
          R.button(ctx, cx + cw - 52, ry, 18, 16, '+', { onClick: act(1) });
          R.text(ctx, v + ' %', cx + cw, ry + 4, { color: o.muted ? PAL.grey : PAL.star, align: 'right' });
        } else if (id === 'mute') {
          R.text(ctx, 'Ton', lx, ry + 4, { color: PAL.star });
          R.button(ctx, cx, ry, cw, 16, o.muted ? 'Stumm' : 'An', { active: !o.muted, onClick: act(0) });
        } else if (id === 'render') {
          R.text(ctx, 'Darstellung', lx, ry + 4, { color: PAL.star });
          const lab = o.render === 'voxel' ? 'Voxel (3D)' : '2D (Pixel)';
          R.button(ctx, cx, ry, cw, 16, lab + '  · F8', { active: o.render === 'voxel', disabled: !o.renderAvailable, reason: 'Umschalter noch nicht geladen', onClick: act(0) });
        } else if (id === 'fullscreen') {
          R.text(ctx, 'Vollbild', lx, ry + 4, { color: PAL.star });
          R.button(ctx, cx, ry, cw, 16, o.fullscreen ? 'An' : 'Aus', { active: !!o.fullscreen, onClick: act(0) });
        } else if (id === 'back') {
          R.button(ctx, x + w / 2 - 60, ry, 120, 16, 'Zurück', { hotkey: 'Esc', onClick: () => view.actions.uiActivate('options', 'back') });
        }
      });
      R.text(ctx, '←/→ ändern · Enter umschalten · Esc zurück', VW / 2, y + h - 24, { color: PAL.panelLight, align: 'center' });
      R.text(ctx, o.saved === false ? 'Speichern im Browser nicht möglich – gilt bis zum Neuladen.' : 'Wird in diesem Browser gespeichert (Vollbild nicht).', VW / 2, y + h - 13, { color: o.saved === false ? PAL.warn : PAL.panelLight, align: 'center' });
    },
    CONTROLS: [
      ['Laufen', 'WASD/Pfeile · E interagieren (halten: löschen, flicken, beamen) · G ablegen · R Minispiel an einer Station · Tab Crew · Esc Menü'],
      ['Außenteam', 'Leertaste/Linksklick Blaster (zielt auf die Maus) · Q Markierung für Hilfe von oben · C ducken (Kesh) · E halten: wiederbeleben'],
      ['Steuer', 'W/S Temporegler · A/D Ruder · X Allstopp · Shift+A/D Ausweichrolle · F Faltsprung'],
      ['Taktik', 'T Ziel · Q/E Waffe · A/D Ladepunkte · 1 halten: Lanze laden, loslassen: Schuss · 2/3 Batterie · Leertaste beide · S halten Scan · W Weitscan · M Marker · O Orbitalschlag'],
      ['Captain', '1–6 Reiter: Funk · Sternkarte · Lage (Leertaste halten: Scan; Schützling: H halten, F folgen, V volle Kraft, D andocken, N wechseln) · Energie & Schilde · Schadensplan · Außenteam'],
      ['Planungstisch', '1–5 Pin-Art · Klick Pin · Enter Detailkarte · D Decksplan · Backspace zurück · M Missionsbuch (Enter annehmen · Entf ablehnen)'],
      ['Minispiel', 'Leertaste, wenn der Zeiger im grünen Feld steht · Esc bricht ab'],
      ['Reaktor offline', 'Schalter A und B im Maschinenraum gleichzeitig E halten (3 s)'],
      ['Ansicht', 'F8 Voxel/2D · +/− oder Mausrad Zoom (Voxel) · Esc: erst Konsole/Minispiel verlassen, dann Menü'],
      ['Hauptmenü', 'Enter bereit · 1–3 Farbe · F Weltstand · M Start · U Übung · L Einladung · O Optionen'],
    ],
    drawControls(ctx, view) {
      const x = 24, y = 18, w = VW - 48, h = VH - 36;
      R.panel(ctx, x, y, w, h, { style: 'brass', title: 'STEUERUNG' });
      const tx = x + 104, tw = w - 116;
      let yy = y + 16;
      for (const [k, v] of this.CONTROLS) {
        const lines = R.wrap(v, tw, 1);
        if (yy + lines.length * 10 > y + h - 30) break;
        R.text(ctx, k, x + 10, yy, { color: PAL.brass });
        for (const l of lines) { R.text(ctx, l, tx, yy, { color: PAL.star }); yy += 10; }
        yy += 5;
      }
      R.button(ctx, VW / 2 - 60, y + h - 24, 120, 16, 'Zurück', { hotkey: 'Esc', active: true, onClick: () => view.actions.uiActivate('controls', 'back') });
    },
    drawWorlds(ctx, view, ui) {
      const st = view.state || {};
      const lob = st.lobby || {};
      const full = ui.worldsMode === 'full';
      const rows = this.worldRows(st, ui);
      const sel = Math.max(0, Math.min(rows.length - 1, ui.sel.worlds || 0));
      const x = 34, y = 20, w = VW - 68, h = VH - 34;
      R.panel(ctx, x, y, w, h, { style: 'brass', title: full ? 'WELTSTAND LÖSCHEN' : 'WELTSTÄNDE' });
      const count = this.lobbyWorlds(st).length;
      R.text(ctx, full ? 'Höchstens ' + this.worldsMax() + ' Weltstände. Einen löschen, dann startet die neue Kampagne.' : 'Fortsetzen oder neu beginnen – gilt für die ganze Crew.', x + 10, y + 12, { color: full ? PAL.warn : PAL.panelLight });
      R.text(ctx, count + '/' + this.worldsMax(), x + w - 10, y + 12, { color: count >= this.worldsMax() ? PAL.warn : PAL.panelLight, align: 'right' });
      const holdMax = (CFG.menu && CFG.menu.deleteHold) || 1;
      const hold = ui.hold;
      let yy = y + 25;
      const rx = x + 8, rw = w - 16;
      rows.forEach((r, i) => {
        const on = i === sel;
        const rh = r.neu ? 16 : 44;
        const chosen = r.neu ? lob.world == null : lob.world === r.id;
        if (on) { ctx.fillStyle = 'rgba(255,198,107,0.12)'; ctx.fillRect(rx, yy, rw, rh); ctx.strokeStyle = PAL.amber; ctx.lineWidth = 1; ctx.strokeRect(rx + 0.5, yy + 0.5, rw - 1, rh - 1); }
        else { ctx.fillStyle = 'rgba(46,58,74,0.35)'; ctx.fillRect(rx, yy, rw, rh); }
        R.ui.buttons.push({ x: rx, y: yy, w: rw, h: rh, label: '', disabled: false, onClick: () => view.actions.uiPick('worlds', i) });
        if (chosen) R.shape(ctx, 'diamond', rx + 8, yy + 8, 7, PAL.mint);
        if (r.neu) {
          const startId = lob.startMission || 'm1';
          const lab = startId === 'free' ? '+ Neue Kampagne (ohne Tutorial)' : startId === 'm1' ? '+ Neue Kampagne' : '+ Ohne Weltstand starten (' + ((window.Shared_Protocol && Shared_Protocol.START_LABELS && Shared_Protocol.START_LABELS[startId]) || startId) + ')';
          R.text(ctx, lab, rx + 18, yy + 4, { color: on ? PAL.amber : PAL.star });
          if (chosen) R.text(ctx, 'GEWÄHLT', rx + rw - 8, yy + 4, { color: PAL.mint, align: 'right' });
          yy += rh + 4;
          return;
        }
        const wd = r.w;
        const ok = !wd.state || wd.state === 'ok';
        const date = this.relDate(wd.savedAt);
        const dw = R.measure(date, 1);
        R.text(ctx, this.fit(wd.name || wd.id, rw - dw - 90, 1), rx + 18, yy + 3, { color: ok ? (on ? PAL.amber : PAL.star) : PAL.grey });
        R.text(ctx, date, rx + rw - 8, yy + 3, { color: PAL.panelLight, align: 'right' });
        if (chosen) R.text(ctx, 'GEWÄHLT', rx + rw - 16 - dw, yy + 3, { color: PAL.mint, align: 'right' });
        if (ok) {
          R.text(ctx, this.fit(this.locLabel(wd.loc) + ' · ' + this.missionLabel(wd.mission, wd.step), rw - 26, 1), rx + 18, yy + 13, { color: PAL.mint });
          const crew = Array.isArray(wd.spieler) && wd.spieler.length ? 'Crew: ' + wd.spieler.join(', ') : 'Crew: –';
          const pt = 'Spielzeit ' + this.playLabel(wd.playTime);
          R.text(ctx, this.fit(crew, rw - R.measure(pt, 1) - 40, 1), rx + 18, yy + 23, { color: PAL.star });
          R.text(ctx, pt, rx + rw - 8, yy + 23, { color: PAL.panelLight, align: 'right' });
          if (wd.chronikLast) R.text(ctx, this.fit('„' + (typeof wd.chronikLast === 'string' ? wd.chronikLast : (wd.chronikLast.text || '')) + '“', rw - 26, 1), rx + 18, yy + 33, { color: PAL.ice });
        } else {
          this.warnIcon(ctx, rx + 8, yy + 18);
          R.text(ctx, 'Nicht ladbar: ' + (this.WORLD_STATE_TEXT[wd.state] || wd.state), rx + 18, yy + 13, { color: PAL.warn });
          if (wd.grund) R.wrap(String(wd.grund), rw - 26, 1).slice(0, 2).forEach((l, k) => R.text(ctx, l, rx + 18, yy + 23 + k * 10, { color: PAL.star }));
        }
        if (hold && hold.id === wd.id) {
          const f = Math.min(1, hold.t / holdMax);
          R.backdrop(ctx, rx + rw - 132, yy + rh - 10, 126, 9, 0.85);
          R.bar(ctx, rx + rw - 86, yy + rh - 7, 78, 4, f, PAL.red);
          R.text(ctx, hold.sent ? 'gelöscht …' : 'LÖSCHEN', rx + rw - 90, yy + rh - 10, { color: PAL.red, align: 'right', shadow: false });
        }
        yy += rh + 4;
      });
      if (!rows.length) R.text(ctx, 'Keine Weltstände.', x + 14, yy + 4, { color: PAL.panelLight });
      // Knöpfe unten
      const cur = rows[sel];
      const by = y + h - 24;
      const cont = !cur ? null : cur.neu ? 'Neu beginnen' : 'Fortsetzen';
      const contR = !cur ? 'Nichts gewählt' : cur.neu ? null : (cur.w.state && cur.w.state !== 'ok') ? 'Dieser Weltstand ist nicht ladbar' : null;
      R.button(ctx, x + 10, by, 150, 16, cont || 'Fortsetzen', { hotkey: 'Enter', disabled: !!contR, reason: contR, onClick: () => view.actions.uiActivate('worlds', cur ? cur.id : null) });
      const delR = !cur || cur.neu ? 'Erst einen Weltstand wählen' : cur.w.state === 'belegt' ? 'Gerade in einer anderen Runde geöffnet' : null;
      R.button(ctx, x + 170, by, 190, 16, 'Löschen (gedrückt halten)', { hotkey: 'Entf', disabled: !!delR, reason: delR, color: delR ? null : PAL.rust, onClick: () => view.actions.holdDelete(cur.id) });
      R.button(ctx, x + w - 110, by, 100, 16, 'Zurück', { hotkey: 'Esc', onClick: () => view.actions.uiActivate('worlds', 'back') });
      R.text(ctx, 'W/S wählen · Enter ' + (full ? 'fortsetzen statt neu' : 'wählen') + ' · Entf ' + String(holdMax).replace('.', ',') + ' s halten: löschen', VW / 2, by - 12, { color: PAL.panelLight, align: 'center' });
    },

    // ---------------------------------------------------------------- S2: Spielleiter, Kapitelkarte, Schützling
    PLANNING_WORDS: ['peilt', 'berät', 'siegelt'],
    planningOf(st) { const p = st && st.mission && st.mission.planning; return p && typeof p === 'object' ? p : null; },
    // Drei kleine Prägemarken neben dem Siegel: Stufe lesbar, auch wenn Art.drawSeal die Stufe nicht kennt
    drawStagePips(ctx, x, y, stage) {
      for (let i = 0; i < 3; i++) {
        const on = i <= stage;
        ctx.fillStyle = on ? PAL.brass : '#2E3A4A'; ctx.fillRect(x + i * 5, y, 3, 3);
        if (!on) { ctx.strokeStyle = '#4F6178'; ctx.lineWidth = 1; ctx.strokeRect(x + i * 5 + 0.5, y + 0.5, 2, 2); }
      }
    },
    planningText(p) { return 'Funk: ' + String(p.von || 'Hafenmeisterei') + ' ' + (this.PLANNING_WORDS[Math.max(0, Math.min(2, +p.stage || 0))]) + ' …'; },
    // HUD-Zeile (dezent, kein Countdown) unter der Auftragsliste
    drawPlanningLine(ctx, view, y) {
      const p = this.planningOf(view.state);
      if (!p) return y;
      const stage = Math.max(0, Math.min(2, +p.stage || 0));
      const text = this.fit(this.planningText(p), 160, 1);
      const w = Math.min(200, R.measure(text, 1) + 40);
      R.backdrop(ctx, 4, y, w, 14, 0.55);
      Net.guard('Hud.drawSeal', () => this.drawSeal(ctx, 12, y + 7, 10, 'ok', { stage }));
      R.text(ctx, text, 21, y + 3, { color: PAL.panelLight });
      this.drawStagePips(ctx, 4 + w - 17, y + 6, stage);
      return y + 16;
    },
    escortsOf(view) {
      const l = view.escorts || (view.state && view.state.space && view.state.space.escorts) || [];
      return Array.isArray(l) ? l.filter(e => e && e.id != null).slice(0, 2) : [];
    },
    // „SCHÜTZLING · Name ▮▮▮▯“ oben mittig. y0 = Oberkante; liefert die Unterkante
    drawEscortStrip(ctx, view, y0, opts) {
      const list = this.escortsOf(view);
      if (!list.length) return y0;
      const t = view.time;
      if (opts && opts.row && list.length > 1) return this.drawEscortRow(ctx, view, y0, list, t);
      let y = y0;
      for (const e of list) {
        const down = e.state === 'kampfunfaehig', safe = e.state === 'entkommen';
        const name = R.escortName(e);
        const tag = down ? 'KAMPFUNFÄHIG' : safe ? 'IN SICHERHEIT' : e.distress ? 'NOTRUF' : '';
        const head = 'SCHÜTZLING · ';
        const nm = this.fit(name, 120, 1);
        const wHead = R.measure(head, 1), wName = R.measure(nm, 1), wTag = tag ? R.measure(tag, 1) + 6 : 0;
        const w = 8 + wHead + wName + 6 + 34 + wTag + 6;
        const x = Math.round(VW / 2 - w / 2);
        R.backdrop(ctx, x, y, w, 13, 0.82);
        const ring = down ? R.ESCORT_COL.wreck : R.escortRingCol(e, t);
        ctx.strokeStyle = ring; ctx.lineWidth = 1;
        if (e.distress && !down) { ctx.setLineDash([3, 2]); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 12); ctx.setLineDash([]); }
        else { ctx.fillStyle = ring; ctx.fillRect(x, y, 2, 13); }
        R.text(ctx, head, x + 6, y + 3, { color: PAL.brass, shadow: false });
        R.text(ctx, nm, x + 6 + wHead, y + 3, { color: down ? R.ESCORT_COL.wreck : R.ESCORT_COL.ice, shadow: false });
        const frac = R.escortHpFrac(e);
        const bx = x + 6 + wHead + wName + 6;
        R.escortSegBar(ctx, bx, y + 4, frac, 32, 5, down ? R.ESCORT_COL.wreck : frac < 0.3 ? PAL.red : frac < 0.6 ? PAL.amber : R.ESCORT_COL.ice);
        if (tag) {
          const blink = e.distress && !down && Math.floor(t * 3) % 2 === 0;
          R.text(ctx, tag, bx + 38, y + 3, { color: down ? PAL.red : safe ? PAL.mint : blink ? PAL.star : PAL.amber, shadow: false });
        }
        y += 14;
      }
      return y;
    },
    // Konsolen (Titelbalken): mehrere Schützlinge nebeneinander, kompakt
    drawEscortRow(ctx, view, y, list, t) {
      const head = 'SCHÜTZLING';
      const parts = list.map(e => {
        const down = e.state === 'kampfunfaehig', safe = e.state === 'entkommen';
        const tag = down ? 'KAMPFUNF.' : safe ? 'SICHER' : e.distress ? 'NOTRUF' : '';
        const nm = this.fit(R.escortName(e), 84, 1);
        return { e, down, safe, tag, nm, w: R.measure(nm, 1) + 6 + 32 + (tag ? R.measure(tag, 1) + 6 : 0) };
      });
      const wHead = R.measure(head, 1);
      const w = 8 + wHead + parts.reduce((s, p) => s + 10 + p.w, 0) + 6;
      let x = Math.round(VW / 2 - w / 2);
      R.backdrop(ctx, x, y, w, 13, 0.82);
      const any = parts.some(p => p.e.distress && !p.down);
      ctx.strokeStyle = any ? R.escortRingCol(parts.find(p => p.e.distress && !p.down).e, t) : R.ESCORT_COL.ice; ctx.lineWidth = 1;
      if (any) { ctx.setLineDash([3, 2]); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 12); ctx.setLineDash([]); } else { ctx.fillStyle = R.ESCORT_COL.ice; ctx.fillRect(x, y, 2, 13); }
      R.text(ctx, head, x + 6, y + 3, { color: PAL.brass, shadow: false });
      x += 6 + wHead;
      for (const p of parts) {
        x += 10;
        ctx.fillStyle = '#4F6178'; ctx.fillRect(x - 6, y + 3, 1, 7);
        R.text(ctx, p.nm, x, y + 3, { color: p.down ? R.ESCORT_COL.wreck : R.ESCORT_COL.ice, shadow: false });
        const bx = x + R.measure(p.nm, 1) + 6, frac = R.escortHpFrac(p.e);
        R.escortSegBar(ctx, bx, y + 4, frac, 32, 5, p.down ? R.ESCORT_COL.wreck : frac < 0.3 ? PAL.red : frac < 0.6 ? PAL.amber : R.ESCORT_COL.ice);
        if (p.tag) { const blink = p.e.distress && !p.down && Math.floor(t * 3) % 2 === 0; R.text(ctx, p.tag, bx + 38, y + 3, { color: p.down ? PAL.red : p.safe ? PAL.mint : blink ? PAL.star : PAL.amber, shadow: false }); }
        x += p.w;
      }
      return y + 14;
    },
    // Kapitelkarte (Overlay, Enter schließt)
    drawChapter(ctx, view, ch) {
      if (!ch) return;
      const age = (performance.now() - (ch.t0 || 0)) / 1000;
      const a = Math.max(0, Math.min(1, age / 0.5));
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(11,14,26,0.78)'; ctx.fillRect(0, 0, VW, VH);
      const w = 400, x = Math.round(VW / 2 - w / 2);
      const lines = R.wrap(ch.text || '', w - 48, 1).slice(0, 10);
      const titleLines = R.wrap(String(ch.title || '').toUpperCase(), w - 40, 2).slice(0, 2);
      const h = 96 + titleLines.length * 17 + lines.length * 11;
      const y = Math.round(VH / 2 - h / 2);
      R.panel(ctx, x, y, w, h, { style: 'brass' });
      Net.guard('Hud.drawSeal', () => this.drawSeal(ctx, VW / 2, y + 22, 24, 'ok', { stage: 2 }));
      R.text(ctx, 'KAPITEL ABGESCHLOSSEN', VW / 2, y + 40, { color: PAL.brass, align: 'center' });
      let ly = y + 54;
      for (const l of titleLines) { R.text(ctx, l, VW / 2, ly, { color: PAL.amber, scale: 2, align: 'center' }); ly += 17; }
      ly += 4;
      for (const l of lines) { R.text(ctx, l, VW / 2, ly, { color: PAL.star, align: 'center' }); ly += 11; }
      R.button(ctx, VW / 2 - 70, y + h - 26, 140, 18, 'Weiterspielen', { hotkey: 'Enter', onClick: () => view.actions.closeChapter && view.actions.closeChapter() });
      ctx.globalAlpha = 1;
    },

    // ---------------------------------------------------------------- Siegel „Weltstand gesichert“, Pause
    saveSeal: null,
    showSaveSeal(ok, text) { this.saveSeal = { t: performance.now() / 1000, ok: !!ok, text: String(text || '') }; },
    // Art.drawSeal(ctx, x, y, size, variant) – Mittelpunkt x/y; ohne Art eine kleine Raute in Siegelrot mit Messingkante
    // S2: opts.stage 0|1|2 = Prägestufen (0 Peilung, 1 Rat berät, 2 gesiegelt) – Art.drawSeal(..., { stage }), sonst Fallback
    drawSeal(ctx, x, y, size, variant, opts) {
      const staged = opts && opts.stage != null;
      if (R.art('drawSeal', 'drawSeal', staged ? [ctx, x, y, size, variant, opts] : [ctx, x, y, size, variant])) return;
      const s = size / 2;
      if (staged && opts.stage < 2) {
        // 0: nur gestrichelter Messingrand (Peilung); 1: Rand + halb geprägte Füllung (Rat berät)
        ctx.save();
        if (opts.stage >= 1) { ctx.fillStyle = PAL.seal; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.arc(x, y, s, Math.PI, 0); ctx.closePath(); ctx.fill(); }
        ctx.strokeStyle = PAL.brass; ctx.lineWidth = 1; ctx.setLineDash(opts.stage >= 1 ? [] : [2, 2]);
        ctx.beginPath(); ctx.arc(x, y, s - 0.5, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        return;
      }
      const diamond = (r) => { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); };
      diamond(s); ctx.fillStyle = variant === 'warn' ? '#6A5320' : PAL.seal; ctx.fill();
      ctx.strokeStyle = variant === 'warn' ? PAL.warn : PAL.brass; ctx.lineWidth = 1; ctx.stroke();
      diamond(Math.max(1.5, s * 0.4)); ctx.fillStyle = variant === 'warn' ? PAL.warn : PAL.brass; ctx.fill();
    },
    drawSaveSeal(ctx, view) {
      const s = this.saveSeal;
      if (!s) return;
      const dur = (CFG.menu && CFG.menu.savedNoticeTime) || 2.5;
      const life = s.ok ? dur : dur + 1.5;
      const age = performance.now() / 1000 - s.t;
      if (age > life) { this.saveSeal = null; return; }
      const a = age < 0.15 ? age / 0.15 : age > life - 0.5 ? Math.max(0, (life - age) / 0.5) : 1;
      const st = view.state || {};
      const me = view.me;
      const inGame = st.phase && st.phase !== 'lobby' && me;
      const carry = !!(inGame && me.carry && !me.console);
      const h = 22;
      let y = VH - h - 4 - (carry ? (view.self && view.self.zone === 'away' ? 62 : 24) : 0);
      // Lobby (QA-Abnahme S1): Siegel eine Zeile höher, links neben „Ton aktiv“ – dort ist Platz für den Ort.
      // Passt der volle Text nicht, dann „Gesichert · <Ort>“, sonst nur „Weltstand gesichert“; die Hinweiszeile bleibt frei.
      let text;
      if (inGame) {
        // QA-INTEGRATION S2: läuft unten eine ODA-Zeile (nicht an der Konsole), darf das Siegel nicht hineinragen
        const odaBottom = this.oda && this.oda.cur && !(me && me.console);
        const room = odaBottom ? Math.max(80, Math.round(VW / 2 - 142) - 4 - 34 - 6) : 300;
        const parts = s.text.split(' · ');
        const short = parts[0].split(' – ')[0];
        const cands = [s.text, parts.length > 1 ? 'Gesichert · ' + parts.slice(1).join(' · ') : null, short];
        text = cands.find(c => c && R.measure(c, 1) <= room) || this.fit(short, room, 1);
      } else {
        y = VH - h - 26;
        const short = s.text.split(' · ')[0].split(' – ')[0];
        const parts = s.text.split(' · ');
        const cands = [s.text, parts.length > 1 ? 'Gesichert · ' + parts.slice(1).join(' · ') : null, short];
        const tone = view.audioOn ? 'Ton aktiv' : 'Klick oder Taste aktiviert den Ton';
        const room = Math.max(96, Math.floor((VW - R.measure(tone, 1)) / 2) - 4 - 34 - 6);
        text = cands.find(c => c && R.measure(c, 1) <= room) || this.fit(short, room, 1);
      }
      const w = R.measure(text, 1) + 34, x = 4;
      const col = s.ok ? PAL.mint : PAL.warn;
      ctx.globalAlpha = a;
      R.backdrop(ctx, x, y, w, h, 0.85);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      const stamp = s.ok ? 1 + 0.35 * Math.max(0, 1 - age / 0.3) : 1;   // kurzer „Stempel“-Effekt
      Net.guard('Hud.drawSeal', () => this.drawSeal(ctx, x + 12, y + h / 2, Math.round(16 * stamp), s.ok ? 'ok' : 'warn'));
      R.text(ctx, text, x + 24, y + h / 2 - 4, { color: col });
      ctx.globalAlpha = 1;
    },
    drawPause(ctx, view, menuOpen) {
      const st = view.state;
      if (!st || !st.paused || menuOpen || st.phase === 'lobby') return;
      const label = 'PAUSE';
      const w = R.measure(label, 1) + 16;
      R.backdrop(ctx, VW / 2 - w / 2, VH / 2 - 40, w, 13, 0.8);
      R.text(ctx, label, VW / 2, VH / 2 - 37, { color: PAL.ice, align: 'center' });
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
