// Pult-Baukasten: Steuer, Ops, Technik und Captain im neuen Aufbau (Anzeige oben, Statusleiste, Säule, Pult unten).
// Ergänzt das globale `Consoles` (consoles.js) um pultDraw(). Die Logik der Stationen bleibt in consoles.js – hier steht nur,
// WO etwas sitzt. Knöpfe behalten ihre bisherigen Beschriftungen als Suchnamen, damit Consoles.tryButton sie findet.
(function () {
  'use strict';
  const R = window.Render, H = window.Hud, P = window.Pult, K0 = window.Consoles;
  if (!R || !P || !K0) return;
  const PAL = R.PAL;
  const CFG = window.Shared_Config || {};
  const Phys = window.Shared_Physics;
  const PROTO = window.Shared_Protocol || {};
  const POWER_SYS = PROTO.POWER_SYSTEMS || ['engines', 'shields', 'weapons'];   // PAN-01 A: Hauptsysteme; Bordmodule stehen in ship.mod
  const POWER_NAMES = { engines: 'ANTRIEB', shields: 'SCHILDE', weapons: 'WAFFEN' };
  const POWER_FN = { engines: 'drive', shields: 'shield', weapons: 'weapon' };
  const SEL_MOD0 = 3, SEL_SCH0 = 7;   // Auswahl im Technik-Pult: 0–2 Hauptsysteme, 3–6 Bordmodule, 7–10 Schildsektoren (wie consoles.js)
  const SECTOR = ['BUG', 'STB', 'HECK', 'BB'];
  // PAN-01 C: Waffen und Plätze aus dem Katalog (shared/schiffskatalog.js, public/js/schiffswaffen-ui.js); der Mount-Eintrag trägt typ (fehlt = Startbestückung)
  const SCH = window.Shared_Schiffskatalog || {};
  const UI = window.SchiffsUI;
  const waffeVon = (m) => (UI ? UI.waffeVon(m) : null);
  // Kai 2026-10-15: Ziffernblock wie das Schiff – 7/4/1 Backbord, 9/6/3 Steuerbord, 8/5 vorn, 2 Heck
  const PLATZ_SEITE = { 7: 'Bb', 4: 'Bb', 1: 'Bb', 9: 'Stb', 6: 'Stb', 3: 'Stb', 8: 'vorn', 5: 'vorn', 2: 'Heck' };
  const PLATZ_AKTION = { 8: 'ops.waffe.vorn1', 5: 'ops.waffe.vorn2', 2: 'ops.waffe.heck', 4: 'ops.waffe.bb1', 6: 'ops.waffe.stb1', 7: 'ops.waffe.bb2', 9: 'ops.waffe.stb2', 1: 'ops.waffe.bb3', 3: 'ops.waffe.stb3' };
  const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (d || 0));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const m3 = (p, d) => (R.cfgM3 ? R.cfgM3(p, d) : d);
  const f1 = (v) => (R.fmt1 ? R.fmt1(v) : (Math.round(n(v) * 10) / 10).toFixed(1).replace('.', ','));
  const sysDown = (ship, s) => { const v = (ship.systems || {})[s]; return v === 'broken' || v === 'offline'; };
  const T = (c, s, x, y, col, align) => P.txt(c, s, x, y, col, align);
  const wrap1 = (s, w) => { s = String(s); while (P.tw(s) > w && s.length > 3) s = s.slice(0, -2) + '…'; return s; };

  Object.assign(K0, {
    PULT_STATIONEN: ['helm', 'weapons', 'technik', 'captain'],
    mapRects: {},

    pultDraw(ctx, view, c) {
      let ctl = '';
      try {
        if (c === 'helm') this.pultHelm(ctx, view);
        else if (c === 'weapons') this.pultOps(ctx, view);
        else if (c === 'technik') this.pultTechnik(ctx, view);
        else if (c === 'captain') this.pultCaptain(ctx, view);
      } catch (e) { Net.reportError('Pult.draw:' + c, e); R.text(ctx, 'Anzeigefehler (siehe Konsole)', 70, 60, { color: PAL.red }); }
      P.mitSkin(() => {
        if (window.Glyphen) Net.guard('Glyphen.draw', () => Glyphen.drawFor(ctx, view, c));
        if (window.BojeHud) Net.guard('BojeHud.draw', () => BojeHud.draw(ctx, view));
        if (c !== 'technik') {
          let sy = 9;
          Net.guard('Hud.escortStrip', () => { sy = H.drawEscortStrip(ctx, view, sy, { row: true }); });
          Net.guard('Hud.flotteStrips', () => { sy = H.drawAlliesStrip(ctx, view, sy, { row: true }); H.drawBefehlStrip(ctx, view, sy); });
        }
      });
      P.zeichneHilfe(ctx);
      R.drawTooltip(ctx);
      return ctl;
    },

    // ================================================================= Steuer
    pultHelm(ctx, view) {
      const st = view.state, ship = st.ship || {};
      const hi = this.helmInfo(ship);
      const docked = ship.dockedAt || (ship.docked ? 'hafen' : null);
      const sp = n(ship.speed, Math.hypot(n(ship.vx), n(ship.vy)));
      const deg = Phys.kompassGrad ? Phys.kompassGrad(n(ship.angle)) : Math.round(((n(ship.angle) * 180 / Math.PI) % 360 + 360) % 360);   // 0° = Norden
      const jump = ship.jump || {};
      const w = R.worldOf(st);
      const g = P.rahmen(ctx, view, { titel: 'STEUER', S: 200, station: 'helm', anzeige: (c, r) => {
        const fv = R.drawFrontView(c, view, Object.assign({}, r, { randOben: H.szeneRandOben(view, r.y) }));   // Fixrunde M-2: Randpfeile unter der Szenenzeile (0 ohne Sim-Szene)
        try { this.helmTurnGauge(c, view, fv); this.helmAlerts(c, view, fv); if (this.helmHoehe) this.helmHoehe(c, view, fv); } catch (e) { Net.reportError('Pult.helmAnzeige', e); }
        const K = P.skin, lx = r.x + 10, rx = r.x + r.w - 10;
        let y = r.y + 10;
        T(c, 'TEMPO', lx, y, K.dim); R.text(c, String(Math.round(hi.fwd < -0.5 ? hi.fwd : sp)), lx, y + 10, { color: hi.fwd < -0.5 ? '#F08A3C' : P.FN.drive, scale: 2 }); y += 32;
        T(c, 'KURS', lx, y, K.dim); R.text(c, deg + '°', lx, y + 10, { color: P.FN.drive, scale: 2 }); y += 32;
        const tfp = Math.round(hi.tf * 100);
        T(c, 'DREHEN', lx, y, K.dim); R.text(c, tfp + ' %', lx, y + 10, { color: tfp >= 95 ? P.FN.drive : tfp >= 60 ? K.text : P.FN.warn, scale: 2 });
        y = r.y + 10;
        T(c, 'ORT', rx, y, K.dim, 'right'); y += 10;
        T(c, wrap1(R.locName(st, w.location), 170), rx, y, K.text, 'right'); y += 12;
        if (docked) { T(c, 'ANGEDOCKT · W legt ab', rx, y, P.FN.drive, 'right'); y += 12; }
        T(c, 'SPRUNGZIEL', rx, y, K.dim, 'right'); y += 10;
        T(c, wrap1(jump.dest ? R.locName(st, jump.dest) : 'keins (Captain)', 170), rx, y, jump.dest ? P.FN.nav : K.dim, 'right'); y += 14;
        const dock = ((st.space && st.space.markers) || []).find((m) => m.kind === 'dock');
        if (dock && !docked) {
          const d = Math.round(Math.hypot(dock.x - n(ship.x), dock.y - n(ship.y))), maxSp = (CFG.flight && CFG.flight.dockSpeed) || 25;
          T(c, 'DOCK-RING ' + d, rx, y, P.FN.shield, 'right'); y += 10;
          T(c, 'langsam (max. ' + maxSp + ') hinein', rx, y, sp <= maxSp ? P.FN.shield : P.FN.warn, 'right'); y += 12;
        }
        if (R.inFog(st)) { T(c, 'Nebel: Ops lotst!', rx, y, P.FN.sensor, 'right'); }
      } });
      const K = g.skin, y0 = g.pult.y;
      // ---- FAHRT
      let x = 62, cw = 118;
      let y = P.titel(ctx, x, y0, cw, 'FAHRT', 'drive');
      const lh = this.helmLadder(ctx, view, x, y, hi);
      y += lh + 4;
      const bw = Math.floor((cw - 4) / 2);
      P.knopf(ctx, x, y, bw, 14, 'Stufe +', { hotkey: 'W', aktion: 'steuer.schneller', text: '+', fn: 'drive', disabled: hi.stage >= hi.stages.length - 1, reason: 'Schon auf VOLL', onClick: () => this.throttle(view, 1) });
      P.knopf(ctx, x + bw + 4, y, bw, 14, 'Stufe −', { hotkey: 'S', aktion: 'steuer.langsamer', text: '−', fn: 'drive', disabled: hi.stage <= 0, reason: 'Schon auf Rückwärts (R)', onClick: () => this.throttle(view, -1) });
      // ---- RUDER
      x = 188; cw = 150;
      y = P.titel(ctx, x, y0, cw, 'RUDER · A/D', 'drive');
      const ax = this.helmAxes(), engDown = sysDown(ship, 'engines');
      const half = Math.floor((cw - 4) / 2);
      const hb = (xx, label, text, id, hk, ak) => P.knopf(ctx, xx, y, half, 14, label, { hotkey: hk, aktion: ak, text, fn: 'drive', active: this.mouseHold === id || (id === 'left' ? ax.turn < 0 : ax.turn > 0), onClick: () => { this.mouseHold = id; } });
      hb(x, '< Bb (A)', 'Bb', 'left', 'A', 'steuer.ruderBb'); hb(x + half + 4, 'Stb (D) >', 'Stb', 'right', 'D', 'steuer.ruderStb'); y += 18;
      const cd = n(ship.dodgeCd);
      const dodgeReason = engDown ? 'Antrieb ausgefallen' : cd > 0 ? 'Abklingzeit ' + Math.ceil(cd) + ' s' : docked ? 'Angedockt' : null;
      P.knopf(ctx, x, y, half, 14, 'Ausw. Bb', { hotkey: 'Sh+A', aktion: 'steuer.ausweichenBb', text: 'Ausw.', fn: 'drive', disabled: !!dodgeReason, reason: dodgeReason, onClick: () => this.dodge(view, -1) });
      P.knopf(ctx, x + half + 4, y, half, 14, 'Ausw. Stb', { hotkey: 'Sh+D', aktion: 'steuer.ausweichenStb', text: 'Ausw.', fn: 'drive', disabled: !!dodgeReason, reason: dodgeReason, onClick: () => this.dodge(view, 1) });
      y += 16;
      if (cd > 0 && !engDown) { ctx.fillStyle = K.off; ctx.fillRect(x, y, cw, 2); ctx.fillStyle = P.FN.drive; ctx.fillRect(x, y, Math.round(cw * (1 - clamp(cd / (((CFG.shipClasses || {}).lerche || {}).dodge || {}).cooldown || 7, 0, 1))), 2); }
      y += 4;
      const autoStop = hi.autoStop;
      P.knopf(ctx, x, y, cw, 14, autoStop ? (sp < 1 ? 'Allstopp: steht' : 'Allstopp: bremst …') : 'Allstopp', { hotkey: 'X', aktion: 'steuer.allstopp', fn: 'weapon', active: autoStop, disabled: !!docked, reason: 'Angedockt', onClick: () => this.cmd(view, 'helm.stop', {}) });
      y += 18;
      let status, scol = K.dim;
      if (autoStop) { status = sp < 1 ? 'ALLSTOPP – steht' : 'ALLSTOPP – bremst'; scol = P.FN.drive; }
      else if (engDown) { status = 'Antrieb aus – kein Schub!'; scol = P.FN.weapon; }
      else status = 'Stufe ' + hi.names[hi.stage] + ' · Ruder ' + (ax.turn > 0 ? 'Stb' : ax.turn < 0 ? 'Bb' : '–');
      T(ctx, status, x, y, scol);
      // ---- SPRUNG
      x = 346; cw = 150;
      y = P.titel(ctx, x, y0, cw, 'SPRUNG', 'nav');
      P.segs(ctx, x, y, 10, Math.round(n(jump.charge) * 10), jump.ready ? 'shield' : 'nav', 13, 6); y += 10;
      let jumpReason = null;
      if (!jump.ready) jumpReason = jump.blockedReason || (!jump.dest ? 'Kein Ziel gewählt (Captain-Konsole)' : 'Sprungantrieb lädt (' + Math.round(n(jump.charge) * 100) + ' %)');
      P.knopf(ctx, x, y, cw, 14, 'Faltsprung', { hotkey: 'F', aktion: 'steuer.faltsprung', fn: 'nav', disabled: !jump.ready || !!jump.reise, reason: jump.reise ? 'Schnellsprung läuft' : jumpReason, active: !!jump.ready && !jump.reise, onClick: () => this.cmd(view, 'helm.jump') }); y += 17;
      const rt = jump.rt || null;
      const schnellGrund = jump.reise ? null : !rt ? 'Keine Route – der Captain wählt einen erkundeten Sektor' : !jump.ready ? jumpReason : null;
      P.knopf(ctx, x, y, cw, 14, jump.reise ? 'Schnellsprung abbrechen' : 'Schnellsprung' + (rt ? ' (' + rt.length + ')' : ''), { hotkey: 'G', aktion: 'steuer.schnellsprung', fn: 'nav', disabled: !jump.reise && (!rt || !jump.ready), reason: schnellGrund, active: !!jump.reise || (!!rt && !!jump.ready), onClick: () => this.cmd(view, 'helm.schnellsprung') }); y += 17;
      y = P.mitSkin(() => this.helmNotsprung(ctx, view, x, y, cw));
      const anflug = !!(jumpReason && /^Sprungpunkt/.test(jumpReason));
      if (jump.dest && jump.d != null && anflug) T(ctx, 'Sprungpunkt anfliegen: ' + jump.d + ' m', x, y, P.FN.drive);
      else if (jumpReason && jump.dest) T(ctx, wrap1(jumpReason, cw), x, y, P.FN.warn);
      // ---- LAGE
      x = 504; cw = 130;
      y = P.titel(ctx, x, y0, cw, 'LAGE', 'sensor');
      // Abnahme 14: je Seite die Bestückung und ihre Bereitschaft (nur Anzeige; Bedienung am Ops-Pult)
      for (const z of (UI && UI.seitenUebersicht ? UI.seitenUebersicht(ship) : [])) {
        P.lampe(ctx, x, y + 1, 'weapon', z.bereit && !z.aus);
        T(ctx, z.seite + ' ' + z.kurz + (z.n > 1 && z.gleich ? ' ×' + z.n : ''), x + 10, y, z.aus ? K.dim : K.text);
        T(ctx, z.text, x + cw, y, z.aus ? P.FN.warn : z.bereit ? P.FN.shield : K.dim, 'right'); y += 10;
      }
      const reactor = ship.reactor || {}, rs = reactor.state || 'online';
      P.lampe(ctx, x, y + 1, rs === 'offline' ? 'weapon' : 'shield', rs !== 'offline'); T(ctx, 'Reaktor', x + 10, y, K.text); T(ctx, { online: 'online', overload: 'ÜBERLADEN', offline: 'OFFLINE' }[rs] || rs, x + cw, y, rs === 'offline' ? P.FN.weapon : rs === 'overload' ? P.FN.drive : P.FN.shield, 'right'); y += 13;
      T(ctx, 'MARKER', x, y, K.dim); y += 10;
      const mk = R.markersOf(st);
      for (const who of ['captain', 'tactical']) {
        const m = mk[who], col = R.MARKER_COL[who];
        P.rhomb(ctx, x, y + 1, m ? col : K.offLine);
        if (m) {
          const rel = Phys.normAngle(Math.atan2(m.y - n(ship.y), m.x - n(ship.x)) - n(ship.angle)) * 180 / Math.PI;
          const side = Math.abs(rel) < 8 ? 'voraus' : (rel > 0 ? 'Stb ' : 'Bb ') + Math.round(Math.abs(rel)) + '°';
          T(ctx, who === 'captain' ? 'Captain' : 'Ops', x + 9, y, col); T(ctx, side, x + cw, y, col, 'right');
        } else T(ctx, (who === 'captain' ? 'Captain' : 'Ops') + ': –', x + 9, y, K.dim);
        y += 11;
      }
    },

    // ================================================================= Ops
    // i = Index in energieMounts (Q/E-Auswahl); der Server meldet dieselben Grenzen als Text
    allocGrund(view, i, delta) {
      const ship = view.state.ship || {};
      const ms = this.energieMounts(view);
      const m = ms[i]; if (!m) return 'Keine Energiewaffe';
      const al = n(m.alloc), amax = m3('allocMax', 4), cp = n(ship.chargePoints), used = ms.reduce((s, x) => s + n(x.alloc), 0);
      if (delta < 0) return al <= 0 ? 'Keine Punkte auf dieser Waffe' : null;
      return al >= amax ? 'Maximum (' + amax + ')' : used >= cp ? (cp ? 'Alle Ladepunkte verteilt – erst anderswo abziehen' : 'Keine Waffenenergie (Technik)') : null;
    },
    // Waffe am Ziffernblock-Platz (1–9) oder null
    waffeAmPlatz(view, platz) {
      return UI ? UI.mountAmPlatz(view.state.ship || {}, platz) : null;
    },
    pultOps(ctx, view) {
      const st = view.state, ship = st.ship || {}, inv = st.inventory || {}, sup = st.support || {}, away = st.away || {};
      const target = this.targetOf(view);
      const g = P.rahmen(ctx, view, { titel: 'OPS', S: 196, station: 'weapons', anzeige: (c, r) => {
        const mr = { x: r.x, y: r.y, w: 404, h: r.h };
        this.mapRects.weapons = mr;
        // SUND-02b UI (Review A1, Bild 07/08): die Karte ist hier nur 184 px hoch; reichen die gestapelten Leisten oben links (Fracht, Höhe halten, Posten …, 266 px breit)
        // bis an den Ring des Schiffs (≈ 26 px um die Mitte), rückt die Mitte der Karte nach rechts neben die Leisten (weich), so weit, dass auch die Bogenbeschriftung über und unter dem Schiff neben den Leisten Platz hat. Nach rechts statt nach unten: unter dem Schiff
        // stehen Posten-/Dock-Beschriftung und der Bogen STB, die sonst aufeinander lägen. Klicks laufen über dieselbe Umrechnung (toW aus cx/cy).
        const mitteX = mr.x + Math.round(mr.w / 2), stapelUnten = mr.y + 3 + (this.stapelH || 0);
        const zielX = this.stapelH && stapelUnten > mr.y + Math.round(mr.h / 2) - 26 ? Math.min(mr.x + mr.w - 70, mr.x + 4 + 266 + 58) : mitteX;   // 58: halbe Breite der Bogenbeschriftung oben/unten („BB STANDARD BEREIT“), sie steht dann neben den Leisten
        this.opsMitteX = this.opsMitteX == null ? zielX : Math.abs(zielX - this.opsMitteX) < 0.5 ? zielX : this.opsMitteX + (zielX - this.opsMitteX) * 0.25;
        this.maps.weapons = R.drawTactical(c, view, mr, { zoom: this.zoom.weapons, arcs: true, intel: true, mode: 'tactical', enemyRects: this.enemyRects, randOben: H.szeneRandOben(view, mr.y), sperren: this.stapelH ? [{ x: mr.x + 4, y: mr.y + 3, w: 266, h: this.stapelH }].concat(zielX !== mitteX ? [{ x: mr.x + mr.w - 64, y: mr.y + 1, w: 62, h: 11 }, { x: Math.round(this.opsMitteX) - 28, y: mr.y + Math.round(mr.h / 2) - 28, w: 56, h: 56 }] : []) : [], cx: Math.round(this.opsMitteX) });   // verschoben: auch Zoom-Zeile und Schiffsring frei von Bogenbeschriftungen
        R.text(c, 'Zoom ' + Math.round(this.zoom.weapons * 100) + ' %', mr.x + mr.w - 4, Math.max(mr.y + 3, H.szeneUnten(view) + 2), { color: PAL.panelLight, align: 'right' });   // N4: unter der Szenenzeile
        this.drawFracht(c, view, mr); this.drawLpscan(c, view, mr); this.drawZonenscan(c, view, mr); if (this.drawHoehe) this.drawHoehe(c, view, mr); this.drawPersonenBord(c, view, mr); if (this.drawPosten) this.drawPosten(c, view, mr);
        if (window.SondenView) SondenView.drawButton(c, view, mr, (cc, extra) => this.cmd(view, cc, extra));
        if (window.SpurView) SpurView.drawButton(c, view, mr, (cc, extra) => this.cmd(view, cc, extra));
        if (window.NotrufView) NotrufView.drawButton(c, view, mr, (cc, extra) => this.cmd(view, cc, extra));
        if (window.Entschluesseln) Entschluesseln.draw(c, view, mr);
        this.pultZielkasten(c, view, { x: r.x + 410, y: r.y + 4, w: r.w - 414, h: r.h - 8 }, target);
        if (this.frachtLeiste) Net.guard('Consoles.frachtLeiste', () => this.frachtLeiste(c, view, { x: r.x + 410, y: r.y + r.h - 16, w: r.w - 414 }));   // unten im Zielkasten
      } });
      const K = g.skin, y0 = g.pult.y;
      // ---- WAFFEN im Ziffernblock-Raster (PAN-01 C: Waffenname, Symbol, Zustand und Ladepunkte je Platz)
      let x = 62, cw = 212;
      let y = P.titel(ctx, x, y0, cw, 'WAFFEN · ZIFFERNBLOCK', 'weapon');
      const zw = Math.floor((cw - 8) / 3), zh = 24;
      this.waffenZellen = [];   // Klickflächen der Energiewaffen für Rechtsklick und Mausrad (Consoles.punktAmZiel)
      const amax = m3('allocMax', 4);
      const em = this.energieMounts(view), selM = this.selMount(view);
      const lagerMax = (SCH.TORPEDO && SCH.TORPEDO.lagerMax) || 12;
      for (let platz = 1; platz <= 9; platz++) {
        const ix = (platz - 1) % 3, iy = 2 - Math.floor((platz - 1) / 3);
        const zx = x + ix * (zw + 4), zy = y + iy * (zh + 3);
        const m = this.waffeAmPlatz(view, platz), w = waffeVon(m);
        if (!m || !w) {   // PAN-01 B: Plätze, die die Ausbaustufe noch nicht öffnet, stehen als „gesperrt“ (mit Stufe) statt „frei“ da
          const SM = window.Shared_Maps, pl = SM && SM.waffenplatz ? SM.waffenplatz(platz) : null, zu = !!pl && n(ship.st) < pl.stufe;
          P.zelle(ctx, zx, zy, zw, zh, String(platz), zu ? 'gesperrt' : 'frei', zu ? 'Stufe ' + pl.stufe : PLATZ_SEITE[platz], 'weapon', 'leer', 0, { aktion: PLATZ_AKTION[platz] });
          // leerer oder noch gesperrter Platz: ein Klick sagt warum (Hinweis, kein Fehlerton); bestückt wird am Werft-Terminal
          const grundLeer = zu ? 'Platz ' + platz + ': gesperrt · Ausbaustufe ' + pl.stufe + ' nötig (Werft-Terminal)' : 'Platz ' + platz + ': keine Waffe eingebaut (Werft-Terminal)';
          R.ui.buttons.push({ x: zx, y: zy, w: zw, h: zh, label: 'Platz ' + platz, disabled: false, onClick: () => { view.actions.sfx('ui_click'); H.pushNotice(grundLeer, PAL.panelLight); } });
          continue;
        }
        const stt = this.mountStatus(view, m), info = stt.info;
        const isTorp = w.art === 'torpedo';
        const ch = n(m.charge);
        const iE = em.indexOf(m);
        const zustand = stt.kind === 'halten' ? 'hold' : info.reason && !(ch >= 1 && /außerhalb|Kein Ziel/.test(info.reason)) ? 'off' : (selM && selM.id === m.id ? 'sel' : 'normal');
        const sub = isTorp ? n(m.ammo) + '/' + lagerMax + (stt.kind === 'laedt' ? ' ' + n(m.cd) + 's' : stt.kind === 'bereit' ? '' : ' leer') : stt.text;
        const onClick = () => this.mountKlick(view, m);   // Klick = Taste: wählen und bedienen, ohne Ladepunkte gibt er den ersten
        if (iE >= 0) this.waffenZellen.push({ x: zx, y: zy, w: zw, h: zh, id: m.id });
        P.zelle(ctx, zx, zy, zw, zh, String(platz), w.kurz, sub, 'weapon', zustand, n(m.power), { label: w.name, reason: info.reason, onClick, klickbar: true, aktion: PLATZ_AKTION[platz], rechts: 8 });
        // Symbol der Waffe rechts, darüber die Ladepunkte der Energiewaffe als Pünktchen (der Torpedowerfer hat keine)
        if (UI) UI.drawWaffe(ctx, w.id, zx + zw - 7, zy + 13, { color: zustand === 'off' ? K.dim : P.mix(K.ink, P.FN.weapon, 0.12) });
        if (!isTorp) for (let k = 0; k < amax; k++) { ctx.fillStyle = k < n(m.alloc) ? P.FN.drive : K.offLine; ctx.fillRect(zx + zw - 15 + k * 3, zy + zh - 4, 2, 2); }   // Ladepunkte unten rechts, damit sie keinen Namen überdecken
        if (iE >= 0 && selM && selM.id === m.id && zustand !== 'sel') { ctx.fillStyle = K.text; ctx.fillRect(zx, zy + zh + 1, zw, 1); }
      }
      y += 3 * zh + 6 + 4;
      {
        const cp = n(ship.chargePoints), used = em.reduce((s, mm) => s + n(mm.alloc), 0);
        const salven = (ship.mounts || []).filter((mm) => { const ww = waffeVon(mm); return ww && ww.art === 'salve'; });
        const batReady = salven.some((mm) => !this.mountInfo(view, mm.id).reason);
        P.knopf(ctx, x, y, 70, 14, 'Batterien', { hotkey: 'Leer', aktion: 'ops.waffe.beideSeiten', text: salven.length > 2 ? 'alle' : 'beide', fn: 'weapon', disabled: !batReady, reason: 'Keine Batterie geladen', onClick: () => this.cmd(view, 'weapons.fire', { mount: 'all' }) });
        T(ctx, 'PUNKTE ' + used + '/' + cp, x + 78, y + 1, cp === 0 ? P.FN.weapon : used < cp ? P.FN.drive : P.FN.shield);
        T(ctx, 'Q/E · A/D · Rad/Rechtsklick: Punkte', x + 78, y + 9, K.dim);
      }
      // ---- SENSOREN
      x = 282; cw = 112;
      y = P.titel(ctx, x, y0, cw, 'SENSOREN', 'sensor');
      P.knopf(ctx, x, y, cw, 14, 'Nächstes Ziel', { hotkey: 'T', aktion: 'ops.ziel', fn: 'sensor', disabled: !this.targetList(view).length, reason: 'Nichts in Sensorreichweite', onClick: () => this.cycleTarget(view) }); y += 17;
      const ts = ship.tscan || {}, tsR = this.tscanReason(view);
      const prog = target && ts.targetId === target.id ? n(ts.progress) : 0;
      P.knopf(ctx, x, y, cw, 14, this.tscanOn ? 'Scanne …' : 'Ziel scannen', { hotkey: 'S', aktion: 'ops.scan', fn: 'sensor', active: this.tscanOn, hold: prog > 0 ? prog : undefined, disabled: !!tsR && !this.tscanOn, reason: tsR, onClick: () => { this.mouseHold = 'tscan'; this.setTscan(view, true); } }); y += 17;
      const ws = ship.widescan || {}, wsR = n(ws.cd) > 0 ? 'Abklingzeit ' + Math.ceil(ws.cd) + ' s' : null;
      P.knopf(ctx, x, y, cw, 14, 'Weitscan (1000)', { hotkey: 'W', aktion: 'ops.weitscan', text: 'Weitscan', fn: 'sensor', disabled: !!wsR, reason: wsR, onClick: () => { this.cmd(view, 'weapons.widescan'); view.actions.sfx('widescan'); } }); y += 17;
      P.knopf(ctx, x, y, cw, 14, 'Zoom', { hotkey: 'Z', aktion: 'ops.zoom', fn: 'sensor', text: 'Zoom ' + Math.round(this.zoom.weapons * 100) + ' %', onClick: () => this.cycleZoom('weapons') }); y += 17;
      if (ship.sf) {
        const sf = ship.sf, unten = !!sf.d && !n(sf.h);
        P.knopf(ctx, x, y, cw, 14, unten ? 'Schilde hoch' : n(sf.h) ? 'Schilde fahren hoch … ' + n(sf.h) + ' s' : 'Schilde runter (leiser)', { hotkey: 'H', aktion: 'ops.schilde', text: unten ? 'Schilde hoch' : n(sf.h) ? 'fahren hoch ' + n(sf.h) : 'Schilde runter', fn: 'shield', active: !!sf.d, disabled: !!n(sf.h), reason: 'Schilde fahren gerade hoch', onClick: () => this.cmd(view, 'weapons.schilde', { unten: !unten }) });
      }
      // ---- MARKER
      x = 402; cw = 102;
      y = P.titel(ctx, x, y0, cw, 'MARKER', 'nav');
      const mk = R.markersOf(st).tactical;
      P.knopf(ctx, x, y, cw, 14, 'Auf Ziel', { hotkey: 'M', aktion: 'ops.marker', fn: 'nav', disabled: !target, reason: 'Kein Ziel', onClick: () => this.markerOnTarget(view) }); y += 17;
      P.knopf(ctx, x, y, cw, 14, 'Löschen', { hotkey: 'X', aktion: 'ops.markerLoeschen', fn: 'nav', disabled: !mk, reason: 'Kein Marker gesetzt', onClick: () => this.cmd(view, 'weapons.marker', { clear: true }) }); y += 17;
      let sr = null;
      const spd = n(ship.speed, Math.hypot(n(ship.vx), n(ship.vy)));
      const charged = this.energieMounts(view).some((m) => n(m.charge) >= 1);   // PAN-01 C: erste volle Energiewaffe (der Torpedowerfer zählt nicht)
      if (!away.active) sr = 'Nur während der Außenmission';
      else if (!away.marker) sr = 'Keine Markierung (Außenteam: Q)';
      else if (n(sup.strike) > 0) sr = 'Abklingzeit ' + Math.ceil(sup.strike) + ' s';
      else if (spd > 30) sr = 'Schiff zu schnell (max. 30)';
      else if (!charged) sr = 'Keine Waffe voll geladen';
      P.knopf(ctx, x, y, cw, 14, 'Orbitalschlag auf Markierung', { hotkey: 'O', aktion: 'ops.orbitalschlag', text: 'Orbitalschlag', fn: 'weapon', disabled: !!sr, reason: sr, onClick: () => this.cmd(view, 'weapons.strike') }); y += 17;
      T(ctx, mk ? 'gesetzt · ' + Math.round(Math.hypot(mk.x - n(ship.x), mk.y - n(ship.y))) : 'Rechtsklick: Marke', x, y, mk ? P.FN.nav : K.dim);
      // ---- EINSATZ: Torpedo-Lager, Signatur, Hinweise
      x = 510; cw = 124;
      y = P.titel(ctx, x, y0, cw, 'EINSATZ', 'sensor');
      const tm = (ship.mounts || []).find((mm) => { const ww = waffeVon(mm); return ww && ww.art === 'torpedo'; });
      if (tm || n(inv.bolzen) > 0) {   // PAN-01 C: Torpedowerfer lädt selbst nach (Cooldown), nur das Lager (hart 12) muss gefüllt sein – kein Nachladen-Knopf
        const ammo = tm ? n(tm.ammo) : n(inv.bolzen);
        T(ctx, 'TORPEDOS ' + ammo + '/' + lagerMax, x, y, ammo > 0 ? K.text : P.FN.weapon); y += 10;
        P.segs(ctx, x, y, lagerMax, ammo, 'weapon', 7, 5); y += 8;
        if (tm) {
          const cd = n(tm.cd), cwid = cw - 2;
          ctx.fillStyle = K.off; ctx.fillRect(x, y, cwid, 3); ctx.fillStyle = n(tm.charge) >= 1 ? P.FN.shield : P.FN.drive; ctx.fillRect(x, y, Math.round(cwid * clamp(n(tm.charge), 0, 1)), 3); y += 5;
          T(ctx, ammo <= 0 ? 'Lager leer (Shop)' : n(tm.charge) >= 1 ? 'bereit · lädt selbst nach' : 'Cooldown ' + cd + ' s', x, y, K.dim); y += 12;
        } else { T(ctx, 'kein Werfer (Platz 2)', x, y, K.dim); y += 12; }
      }
      if (ship.sf) {
        const sig = clamp(n(ship.sf.sig) / 100, 0, 1);
        T(ctx, 'SIGNATUR', x, y, K.dim); P.segs(ctx, x + 52, y, 6, Math.round(sig * 6), sig > 0.6 ? 'weapon' : sig > 0.3 ? 'drive' : 'shield', 9, 6); y += 12;
        if (n(ship.sf.p) > 0) { T(ctx, 'Weitscan verrät uns ' + n(ship.sf.p) + ' s', x, y, P.FN.weapon); y += 11; }
      }
      T(ctx, 'Situative Knöpfe', x, y, K.dim); y += 10;
      T(ctx, 'stehen auf der Karte', x, y, K.dim);
    },
    // Zielkasten rechts neben der Taktikkarte: Name, Klasse, Entfernung, Hülle, vier Schildsektoren
    pultZielkasten(c, view, b, target) {
      const K = P.skin, ship = view.state.ship || {};
      c.fillStyle = P.rgba(K.bg, 0.9); c.fillRect(b.x, b.y, b.w, b.h);
      let y = b.y + 4;
      T(c, 'ZIEL', b.x + 6, y, K.dim);
      const list = this.targetList(view);
      if (target) { const i = list.findIndex((e) => e.id === target.id); T(c, (i + 1) + ' / ' + list.length, b.x + b.w - 6, y, K.dim, 'right'); }
      y += 11;
      if (!target) { T(c, list.length ? 'keins – T wählen' : 'keine Gegner', b.x + 6, y, K.dim); return; }
      const nm = target.station ? target.name : target.hidden ? (R.HIDDEN_NAMES[target.kind] || 'Signal') : (R.ENEMY_NAMES[target.kind] || target.kind);
      const d = Math.round(Math.hypot(target.x - n(ship.x), target.y - n(ship.y)));
      T(c, wrap1(nm, b.w - 12), b.x + 6, y, P.FN.weapon); y += 10;
      const VOLK = { ger: 'Germanen', rom: 'Rom', pirat: 'Piraten' };
      T(c, (target.vk ? (VOLK[target.vk] || target.vk) + ' · ' : '') + d + ' m', b.x + 6, y, K.dim); y += 12;
      if (!target.hidden && target.hpMax) { T(c, 'HÜLLE', b.x + 6, y, K.dim); P.segs(c, b.x + 40, y, 10, Math.ceil(10 * n(target.hp) / target.hpMax), 'weapon', 9, 6); y += 11; }
      if (!target.scanned) { T(c, target.hidden ? (target.found ? 'erfasst' : 'S halten: genauer scannen') : 'S: scannen für Schilde', b.x + 6, y, K.dim); return; }
      // vier Schildsektoren als Schema (Bug rechts, Heck links, Bb oben, Stb unten): Werte je Seite aus dem Schildmodell (shared/schilde.js)
      const SC = window.Shared_Schilde, lay = SC && SC.layout(CFG, target.kind);
      const vals = target.shields || (lay ? lay.max : null) || [0, 0, 0, 0];
      const seite = (i) => (lay ? SC.seitenMax(lay, vals, i) : n(vals[i]));
      const seiteMax = (i) => (lay ? SC.seitenMax(lay, lay.max, i) : 4);
      const cx = Math.round(b.x + b.w / 2), cy = y + 32;
      const KN = window.Kennung;
      if (KN && KN.zeichne) {
        try {
          if (KN.schildRing) KN.schildRing(c, cx, cy, 20, 0, vals, lay);
          KN.zeichne(c, target.vk || ((CFG.kennung || {}).gegner) || 'ger', target.kind, cx, cy, 0, P.FN.weapon, 2);
        } catch (err) { Net.reportError('Pult.zielKennung', err); }
      } else { c.fillStyle = P.FN.weapon; c.fillRect(cx - 8, cy - 3, 16, 6); }
      const lab = (i, x, yy, al) => { const v = seite(i), mx = seiteMax(i); T(c, SECTOR[i] + ' ' + v, x, yy, v <= 0 ? P.FN.weapon : v >= mx ? P.FN.shield : P.mix(P.FN.shield, K.bg, 0.4), al); };
      lab(0, cx + 26, cy - 3); lab(2, cx - 26, cy - 3, 'right'); lab(3, cx, cy - 33, 'center'); lab(1, cx, cy + 26, 'center');
      // PAN-01 C: Waffen je Seite (Katalog) und Module der Klasse – nur nach dem Scan, passt unter den Schilden in den Kasten
      const ya = cy + 37, yMax = b.y + b.h - 16;
      if (yMax - ya >= 11) {
        try { this.zielAusstattung(c, target, b.x + 6, ya, b.w - 12, yMax - ya, { txt: (str, xx, yy, col, al) => T(c, str, xx, yy, col, al), dim: K.dim, text: K.text }); } catch (err) { Net.reportError('Pult.zielAusstattung', err); }
      }
    },

    // ================================================================= Technik
    pultTechnik(ctx, view) {
      const st = view.state, ship = st.ship || {};
      if (this.ttab === 1) {
        // Schadensplan: große Anzeige, Pult nur mit den Reitern
        const g = P.rahmen(ctx, view, { titel: 'TECHNIK', S: 300, station: 'technik', anzeige: (c, r) => { this.capDamage(c, view, { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 }); } });
        this.pultTechnikReiter(ctx, view, 62, g.pult.y + 2);
        return;
      }
      const power = ship.power || {}, heat = ship.heat || {}, reactor = ship.reactor || {};
      const output = n(reactor.output, 8), used = n(reactor.used, POWER_SYS.reduce((s, k) => s + n(power[k]), 0));
      const sh = ship.shields || {}, alloc = sh.alloc || [0, 0, 0, 0], cur = sh.current || [0, 0, 0, 0], pool = n(sh.pool);
      const allocSum = alloc.reduce((s, v) => s + n(v), 0), capA = Array.isArray(sh.cap) ? sh.cap : [4, 4, 4, 4];
      const tele = this.teleLate(view);
      const g = P.rahmen(ctx, view, { titel: 'TECHNIK', S: 152, station: 'technik', anzeige: (c, r) => {
        const K = P.skin, cx = r.x + r.w / 2, cy = r.y + r.h / 2 + 2;
        T(c, 'SCHILDPOOL ' + allocSum + ' / ' + pool, r.x + 8, r.y + 6, allocSum >= pool ? P.FN.drive : P.FN.shield);
        T(c, ((CFG.shields && CFG.shields.pointsPerPower) || 3) + ' je Energie · max 4 je Sektor', r.x + r.w - 8, r.y + 6, K.dim, 'right');
        if (sysDown(ship, 'shields')) T(c, 'Schildgenerator zerstört!', cx, r.y + 18, P.FN.weapon, 'center');
        c.fillStyle = K.dim; c.beginPath(); c.moveTo(cx + 26, cy); c.lineTo(cx - 18, cy - 11); c.lineTo(cx - 24, cy); c.lineTo(cx - 18, cy + 11); c.closePath(); c.fill();
        const pos = [[cx + 150, cy], [cx, cy + 38], [cx - 150, cy], [cx, cy - 38]];
        for (let i = 0; i < 4; i++) {
          const [px, py] = pos[i], bw = 120, bh = 26, bx = Math.round(px - bw / 2), by = Math.round(py - bh / 2);
          const sel = this.sel.power === SEL_SCH0 + i, cap = n(capA[i], 4);
          if (sel) P.zeileHi(c, bx, by, bw, bh, 'shield');
          if (tele[i]) { c.strokeStyle = Math.floor(view.time * 8) % 2 ? PAL.red : '#FF8A7A'; c.setLineDash([4, 3]); c.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1); c.setLineDash([]); }
          T(c, SECTOR[i], bx + 22, by + 2, sel ? P.FN.drive : K.text);
          if (tele[i]) T(c, f1(tele[i].left) + ' s!', bx + bw - 22, by + 2, P.FN.weapon, 'right');
          else if (cap <= 0) T(c, 'AUS', bx + bw - 22, by + 2, P.FN.weapon, 'right');
          else if (cap < 4) T(c, '1/2', bx + bw - 22, by + 2, P.FN.warn, 'right');
          for (let k = 0; k < 4; k++) {
            const filled = k < n(cur[i]), wanted = k < n(alloc[i]), over = k >= cap;
            c.fillStyle = filled ? P.FN.shield : over ? '#3A2A1A' : wanted ? '#2F5A50' : K.offLine; c.fillRect(bx + 22 + k * 19, by + 13, 16, 7);
          }
          const minusR = n(alloc[i]) <= 0 ? 'Minimum erreicht' : null;
          const plusR = n(alloc[i]) >= 4 ? 'Maximum (4)' : allocSum >= pool ? 'Schildpool erschöpft – mehr Energie auf Schilde' : null;
          P.knopf(c, bx, by + 6, 17, 16, '-', { disabled: !!minusR, reason: minusR, fn: 'shield', onClick: () => { this.sel.power = SEL_SCH0 + i; this.cmd(view, 'technik.shield', { sector: i, delta: -1 }); } });
          P.knopf(c, bx + bw - 17, by + 6, 17, 16, '+', { disabled: !!plusR, reason: plusR, fn: 'shield', onClick: () => { this.sel.power = SEL_SCH0 + i; this.cmd(view, 'technik.shield', { sector: i, delta: 1 }); } });
        }
      } });
      const K = g.skin, y0 = g.pult.y;
      // ---- ENERGIE
      let x = 62, cw = 236;
      let y = P.titel(ctx, x, y0, cw, 'ENERGIE · ' + used + '/' + output + ' VERTEILT', 'shield');
      const bedarf = this.energieBedarf(ship), mods = this.modulListe(ship);
      POWER_SYS.forEach((sys, i) => {
        const ry = y + i * 20, v = n(power[sys]), fnc = POWER_FN[sys], state = (ship.systems || {})[sys] || 'ok';
        if (this.sel.power === i) P.zeileHi(ctx, x, ry - 2, cw, 18, fnc);
        T(ctx, POWER_NAMES[sys], x + 6, ry + 3, state === 'ok' ? K.text : P.FN.weapon);
        const minusR = v <= 0 ? 'Minimum erreicht' : null;
        const plusR = v >= 4 ? 'Maximum (4)' : bedarf >= output ? 'Reaktor ausgelastet – erst anderswo abziehen oder ein Modul abschalten' : null;
        P.knopf(ctx, x + 74, ry, 14, 14, '-', { disabled: !!minusR, reason: minusR, fn: fnc, onClick: () => { this.sel.power = i; this.cmd(view, 'technik.power', { sys, delta: -1 }); } });
        P.segs(ctx, x + 92, ry + 4, 4, v, fnc, 11, 7);
        P.knopf(ctx, x + 146, ry, 14, 14, '+', { disabled: !!plusR, reason: plusR, fn: fnc, onClick: () => { this.sel.power = i; this.cmd(view, 'technik.power', { sys, delta: 1 }); } });
        const hv = n(heat[sys]) / ((CFG.power && CFG.power.heatLimit) || 100);
        ctx.fillStyle = K.off; ctx.fillRect(x + 166, ry + 6, cw - 168, 3); ctx.fillStyle = hv > 0.7 ? P.FN.weapon : P.FN.warn; ctx.fillRect(x + 166, ry + 6, Math.round((cw - 168) * clamp(hv, 0, 1)), 3);
      });
      y += POWER_SYS.length * 20 + 2;
      // PAN-01 A: Bordmodule – je 1 Energie, solange sie laufen; abschalten macht Energie für die Hauptsysteme frei
      T(ctx, 'BORDMODULE', x, y, K.dim); T(ctx, mods.length + ' eingebaut · je 1 Energie', x + cw, y, K.dim, 'right'); y += 11;
      mods.forEach((m, j) => {
        const ry = y + j * 16, selM = this.sel.power === SEL_MOD0 + j;
        const fnc = m.lauf ? 'shield' : m.an ? 'drive' : 'weapon';
        if (selM) P.zeileHi(ctx, x, ry - 2, cw, 15, fnc);
        P.lampe(ctx, x + 2, ry + 1, fnc, true);
        T(ctx, m.name.toUpperCase() + ' ' + m.raum, x + 14, ry + 2, m.lauf ? K.text : P.FN.weapon);
        T(ctx, m.lauf ? 'läuft' : m.an ? 'ENERGIE FEHLT' : 'AUS', x + 122, ry + 2, m.lauf ? P.FN.shield : m.an ? P.FN.drive : P.FN.weapon);
        const why = this.modulGrund(ship, m, output);
        if (m.an && !m.lauf) P.knopf(ctx, x + 206, ry - 1, 28, 13, 'Aus', { fn: fnc, onClick: () => { this.sel.power = SEL_MOD0 + j; this.modulSchalten(view, m, false); } });   // Wunsch zurücknehmen
        else P.knopf(ctx, x + 168, ry - 1, 66, 13, m.an ? 'Abschalten' : 'Einschalten', { disabled: !!why, reason: why, fn: fnc, onClick: () => { this.sel.power = SEL_MOD0 + j; this.modulSchalten(view, m, !m.an); } });
      });
      y += Math.max(1, mods.length) * 16;
      T(ctx, '↑↓ wählen · ←→ verteilen/Modul', x, y, K.dim);
      // ---- REAKTOR
      x = 306; cw = 150;
      y = P.titel(ctx, x, y0, cw, 'REAKTOR', 'shield');
      const rs = reactor.state || 'online';
      P.lampe(ctx, x, y + 1, rs === 'offline' ? 'weapon' : rs === 'overload' ? 'drive' : 'shield', true);
      T(ctx, { online: 'online', overload: 'ÜBERLADEN', offline: 'OFFLINE' }[rs] || rs, x + 10, y, rs === 'offline' ? P.FN.weapon : rs === 'overload' ? P.FN.drive : P.FN.shield);
      T(ctx, 'Leistung ' + output, x + cw, y, K.dim, 'right'); y += 12;
      if (n(reactor.autoIn) > 0) { T(ctx, 'startet in ' + Math.ceil(reactor.autoIn) + ' s', x, y, P.FN.shield); y += 11; }
      if (rs === 'online') {
        const ask = performance.now() - this.overloadAsk < 6000;
        const oReason = sysDown(ship, 'reactor') ? 'Reaktor beschädigt – erst reparieren' : null;
        if (!ask) {
          P.knopf(ctx, x, y, cw, 14, 'Reaktor überladen …', { hotkey: 'U', aktion: 'technik.ueberladen', text: 'Überladen …', fn: 'weapon', disabled: !!oReason, reason: oReason, onClick: () => { this.overloadAsk = performance.now(); } }); y += 17;
          T(ctx, '3 min +4, dann Abschaltung', x, y, K.dim); y += 10; T(ctx, 'Neustart nur zu zweit', x, y, K.dim);
        } else {
          T(ctx, 'Wirklich? Danach Notstrom.', x, y, P.FN.drive); y += 11;
          const hb = Math.floor((cw - 4) * 0.6);
          P.knopf(ctx, x, y, hb, 14, 'Ja, überladen', { hotkey: 'J', aktion: 'technik.ueberladenJa', text: 'Ja', fn: 'weapon', active: true, onClick: () => { this.overloadAsk = -1e9; this.cmd(view, 'technik.overload'); } });
          P.knopf(ctx, x + hb + 4, y, cw - hb - 4, 14, 'Abbrechen', { hotkey: 'N', aktion: 'technik.ueberladenNein', text: 'Nein', onClick: () => { this.overloadAsk = -1e9; } });
        }
      } else if (rs === 'overload') {
        const left = n(reactor.overloadLeft);
        R.text(ctx, R.fmtTime ? R.fmtTime(left) : H.fmtTime(left), x, y, { color: left <= 30 ? PAL.red : P.FN.drive, scale: 2 }); y += 18;
        P.segs(ctx, x, y, 10, Math.ceil(10 * left / ((CFG.reactorM1 && CFG.reactorM1.overloadTime) || 180)), left <= 30 ? 'weapon' : 'drive', 13, 5);
      } else {
        T(ctx, 'Notstrom. Neustart: Schalter', x, y, K.text); y += 10; T(ctx, 'A und B zugleich halten (3 s)', x, y, K.text); y += 12;
        const sw = reactor.switches || {};
        T(ctx, 'A ' + (sw.A ? 'gehalten' : '–') + '  B ' + (sw.B ? 'gehalten' : '–'), x, y, sw.A || sw.B ? P.FN.shield : K.dim); y += 10;
        P.segs(ctx, x, y, 10, Math.round(10 * n(reactor.restartProgress)), 'shield', 13, 5);
      }
      // ---- ANSICHT / LEGENDE
      x = 464; cw = 170;
      y = P.titel(ctx, x, y0, cw, 'ANSICHT', 'sensor');
      y = this.pultTechnikReiter(ctx, view, x, y, cw);
      T(ctx, 'Schild je Treffer:', x, y + 4, K.dim);
      T(ctx, '0 offen · 1 Kratzer · 3–4 dicht', x, y + 14, K.dim);
    },
    pultTechnikReiter(ctx, view, x, y, cw) {
      const names = ['Energie & Schilde', 'Schadensplan'];
      if (cw) { names.forEach((nm, i) => { P.knopf(ctx, x, y, cw, 14, nm, { hotkey: String(i + 1), aktion: 'technik.reiter' + (i + 1), fn: 'sensor', active: this.ttab === i, onClick: () => { this.ttab = i; } }); y += 17; }); return y; }
      let xx = x; names.forEach((nm, i) => { const w = P.tw(nm) + 30; P.knopf(ctx, xx, y, w, 14, nm, { hotkey: String(i + 1), aktion: 'technik.reiter' + (i + 1), fn: 'sensor', active: this.ttab === i, onClick: () => { this.ttab = i; } }); xx += w + 6; });
      return y + 17;
    },

    // ================================================================= Captain
    pultCaptain(ctx, view) {
      const st = view.state;
      const awayOn = this.awayActive(st);
      const TABS = ['Funk', 'Sternkarte', 'Lage', 'Außenteam', 'Sektorplan', 'Notrufe'];
      if (this.tab === 3 && !awayOn) this.tab = 0;
      let ctl = '';
      const g = P.rahmen(ctx, view, { titel: 'CAPTAIN', S: 258, station: 'captain', anzeige: (c, r) => {
        const a = { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 };
        switch (this.tab) {
          case 0: ctl = this.capRadio(c, view, a); break;
          case 1: ctl = this.capStar(c, view, a); break;
          case 2: ctl = this.capLage(c, view, a); break;
          case 3: ctl = this.capAway(c, view, a); break;
          case 5: ctl = window.NotrufView ? NotrufView.drawCaptain(c, view, a, (cc, extra) => this.cmd(view, cc, extra)) : ''; break;
          case 4: ctl = window.SektorplanView ? SektorplanView.draw(c, view, a, (cc, extra) => this.cmd(view, cc, extra)) : ''; break;
        }
        let leiste = null;
        if (this.frachtLeiste) Net.guard('Consoles.frachtLeiste', () => { leiste = this.frachtLeiste(c, view, { x: r.x + 2, y: r.y + r.h - 14, w: r.w - 4 }); });
        // SUND-02b UI: Rang von Rom rechts in der Leiste unter der Anzeige (nur Freie Fahrt Sund, kompakt; deckt die Karte nie), kürzt sich auf den freien Platz
        if (leiste && window.Rang) Net.guard('Rang.captain', () => { const m = Rang.modell(); if (m) Rang.zeichne(c, leiste.rechts - 6, leiste.y + 2, leiste.rechts - 6 - leiste.ende - 12, m); });
      } });
      const K = g.skin, y0 = g.pult.y;
      let x = 62, cw = 330;
      let y = P.titel(ctx, x, y0, cw, 'AUF DIE ANZEIGE', 'nav');
      const bw = Math.floor((cw - 8) / 3);
      TABS.forEach((name, i) => {
        const bx = x + (i % 3) * (bw + 4), by = y + Math.floor(i / 3) * 17;
        const dis = i === 3 && !awayOn;
        P.knopf(ctx, bx, by, bw, 14, name, { hotkey: String(i + 1), aktion: 'captain.reiter' + (i + 1), fn: ['cmd', 'nav', 'sensor', 'neutral', 'nav', 'drive'][i], active: this.tab === i, disabled: dis, reason: 'Nur während der Außenmission', onClick: () => { this.tab = i; } });
      });
      x = 400; cw = 234;
      y = P.titel(ctx, x, y0, cw, 'SCHILDE · HINWEISE', 'shield');
      P.mitSkin(() => { try { this.shieldStrip(ctx, view, x, y); } catch (e) { Net.reportError('Pult.shieldStrip', e); } });
      y += 20;
      const radio = st.mission && st.mission.radio;
      if (radio && radio.needsAccept && this.tab !== 0 && Math.floor(view.time * 2) % 2 === 0) T(ctx, 'Funk wartet! (1)', x, y, P.FN.drive);
      else if (this.tab !== 2 && this.escortList(view).some((e) => e.distress && e.state !== 'kampfunfaehig') && Math.floor(view.time * 2) % 2 === 0) T(ctx, 'NOTRUF Schützling! (3)', x, y, P.FN.drive);
      // Abnahme 14: die Seiten und ihre Bestückung auf einen Blick (nur Anzeige, bedient wird am Ops-Pult)
      y += 4;
      const sz = UI && UI.seitenUebersicht ? UI.seitenUebersicht(st.ship || {}) : [];
      if (sz.length) {
        const hw = Math.floor(cw / 2);
        sz.forEach((z, i) => {
          const zx = x + (i % 2) * hw, zy = y + Math.floor(i / 2) * 10;
          P.lampe(ctx, zx, zy + 1, 'weapon', z.bereit && !z.aus);
          T(ctx, z.seite + ' ' + z.kurz + (z.n > 1 && z.gleich ? ' ×' + z.n : '') + ' ' + z.text, zx + 10, zy, z.aus ? K.dim : K.text);
        });
      }
      return ctl;
    },
  });
})();
