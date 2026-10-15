// UI-Sitz (Prototyp E2, Kai 2026-10-14): An Steuer, Ops und Captain sitzt man in der Voxel-Brücke in Egoperspektive.
// Drei feste Blicke: VORN (Hauptschirm am Bug zeigt für alle die Frontsicht des Piloten), PULT (Blick aufs Pult, dann die Konsole flach und bedienbar),
// CREW (Blick zu den Mitspielern). Wechsel: Mausrad oder Maus an den Bildrand. Die Tastatur der Konsole wirkt in allen Blicken.
// Technik und alle anderen Konsolen bleiben flach (nur Pult). Aus: ?sitz=0 oder ohne Voxel-Ansicht (F8).
// Globales `Sitz`. Der Voxel-Layer voxel/sitz.js holt sich das Schirmbild über Sitz.schirm.
(function () {
  'use strict';

  const VW = 640, VH = 360, TILE = 32;
  const R = window.Render;
  const PAL = R.PAL;
  const AUS = new URLSearchParams(location.search).get('sitz') === '0';
  // Sitzplätze: Blick zum Bug (+x). crew = Blickrichtung zu den Mitspielern (Versatz zum Auge in m)
  // auge: Versatz zur Konsolenkachel (x, Höhe, z); Steuer und Ops sitzen davor, der Captain im Stuhl
  const SITZE = {
    // Brücke seit 2026-10-14: Steuer vorn mittig, Ops (Bb) und Captain (Stb) flankieren dahinter
    helm: { auge: [-0.55, 1.42, 0.5], crew: [-3.0, -0.45, 0], crewFov: 80, titel: 'STEUER' },
    weapons: { auge: [-0.55, 1.42, 0.5], crew: [1.8, -0.45, 3.0], titel: 'OPS' },
    captain: { auge: [0.55, 1.55, 0.5], crew: [1.2, -0.5, -3.2], titel: 'CAPTAIN' },
  };
  const BLICKE = ['vorn', 'pult', 'crew'];
  const FOV = { vorn: 56, pult: 52, crew: 62 };
  const RAND = 6, RAND_ZEIT = 0.35;   // px vom Bildrand, s Verweilzeit
  const SW = 512, SH = 288;           // Hauptschirm-Textur
  // Hauptschirm aus den Kartendaten (Shared_Maps.HAUPTSCHIRM: Wandkacheln an der Bugwand), Maße in m, 16:9
  const SCHIRM = (function () {
    const HS = (window.Shared_Maps || {}).HAUPTSCHIRM || { x: 36, y0: 4, y1: 8 };
    const w = HS.y1 - HS.y0 + 1 - 0.6, h = w * 9 / 16;
    return { x: HS.x - 0.06, y: 0.5 + h / 2, z: (HS.y0 + HS.y1 + 1) / 2, w, h };
  })();
  const SCHIRM_TAKT = 0.1;   // s zwischen zwei Schirmbildern, wenn man nur auf der Brücke steht

  function el(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const pultCanvas = el(VW, VH), pultCtx = pultCanvas.getContext('2d');
  const schirmCanvas = el(SW, SH), schirmCtx = schirmCanvas.getContext('2d');

  // Konsolenkachel aus der Schiffskarte (Legende console === c)
  const kachelCache = {};
  function konsolenKachel(c) {
    if (kachelCache[c] !== undefined) return kachelCache[c];
    const M = window.Shared_Maps || {}, rows = (M.ship && M.ship.rows) || [], leg = (M.ship && M.ship.legend) || {};
    let hit = null;
    for (let y = 0; y < rows.length && !hit; y++) for (let x = 0; x < rows[y].length; x++) { const i = leg[rows[y][x]]; if (i && i.console === c) { hit = { x, y }; break; } }
    return (kachelCache[c] = hit);
  }

  const S = {
    blick: 'vorn', station: null, frisch: true,
    auge: [0, 0, 0], ziel: [0, 0, 0], fov: 60,      // aktuelle (geglättete) Kamera
    maus: { x: -1, y: -1 }, rand: null, randT: 0,
    pultSicht: 0,                                  // 0..1 Einblendung der flachen Konsole im Blick PULT
    schirmVersion: 0, schirmLive: false, schirmT: 0, versteckt: null,
  };

  function voxelBereit() { const VR = window.VoxelRender; return !!(VR && VR.ready && VR.mode === 'voxel' && VR.renderer && VR.renderer.setSeat); }
  function aktiv(view) {
    if (AUS || !voxelBereit()) return false;
    const me = view && view.me;
    if (!me || !me.console || !SITZE[me.console]) return false;
    if (!view.self || view.self.zone !== 'ship') return false;
    return !!konsolenKachel(me.console);
  }

  function sollKamera(station, blick) {
    const k = konsolenKachel(station);
    const a = SITZE[station].auge, auge = [k.x + a[0], a[1], k.y + a[2]];
    let d;
    if (blick === 'pult') d = [1.1, -0.9, 0];
    else if (blick === 'crew') d = SITZE[station].crew;
    else d = [SCHIRM.x - auge[0], SCHIRM.y - 0.1 - auge[1], SCHIRM.z - auge[2]];   // VORN blickt auf den Hauptschirm
    // leichtes Umblicken mit der Maus (nur VORN und CREW)
    let yaw = 0, pitch = 0;
    if (blick !== 'pult' && S.maus.x >= 0) { yaw = (S.maus.x / VW - 0.5) * -0.22; pitch = (S.maus.y / VH - 0.5) * -0.12; }
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const dx = d[0] * c - d[2] * s, dz = d[0] * s + d[2] * c;
    const len = Math.hypot(dx, dz);
    return { auge, ziel: [auge[0] + dx, auge[1] + d[1] + pitch * len, auge[2] + dz], fov: blick === 'crew' && SITZE[station].crewFov ? SITZE[station].crewFov : FOV[blick] };
  }

  function setBlick(b) {
    if (!BLICKE.includes(b) || b === S.blick) return;
    S.blick = b;
    if (b !== 'pult') S.pultSicht = 0;
    try { if (window.Audio && Audio.play) Audio.play('ui_click'); } catch (e) { /* egal */ }
  }

  // ---------------------------------------------------------------- Frame
  function aufBruecke(view) {
    const M = window.Shared_Maps, self = view && view.self;
    if (!M || !M.roomAt || !self || self.zone !== 'ship') return false;
    const r = M.roomAt(Math.floor(self.x / TILE), Math.floor(self.y / TILE));
    return !!(r && r.id === 'bruecke');
  }
  function update(view, dt) {
    const VR = window.VoxelRender;
    if (!aktiv(view)) {
      if (S.station) { S.station = null; S.versteckt = null; if (voxelBereit()) VR.renderer.setSeat(null); }
      // Wer nur auf der Brücke steht, sieht den Schirm auch (seltener neu gezeichnet)
      S.schirmLive = !AUS && voxelBereit() && !!(view && view.state && view.state.ship) && aufBruecke(view);
      if (S.schirmLive) { S.schirmT -= dt; if (S.schirmT <= 0) { S.schirmT = SCHIRM_TAKT; zeichneSchirm(view); } }
      return false;
    }
    S.schirmLive = true;
    const st = view.me.console;
    if (st !== S.station) { if (!S.station) { S.blick = 'vorn'; S.frisch = true; } S.station = st; S.pultSicht = 0; }
    S.versteckt = window.Client ? String(Client.pid) : null;
    S.maus.x = Client.mouse ? Client.mouse.x : -1; S.maus.y = Client.mouse ? Client.mouse.y : -1;
    // Bildrand: links/rechts = CREW (hin und zurück), unten = PULT, oben = VORN
    let r = null;
    if (S.maus.x >= 0) {
      if (S.maus.y >= VH - RAND && S.blick !== 'pult') r = 'pult';
      else if (S.maus.y <= RAND && S.blick !== 'vorn') r = 'vorn';
      else if ((S.maus.x <= RAND || S.maus.x >= VW - RAND) && S.blick !== 'pult') r = S.blick === 'crew' ? 'vorn' : 'crew';
    }
    const jetzt = performance.now() / 1000;
    if (r && r === S.rand) { if (S.randT > 0 && jetzt - S.randT >= RAND_ZEIT) { setBlick(r); S.randT = -1; } }
    else { S.rand = r; S.randT = r ? jetzt : 0; }
    const soll = sollKamera(st, S.blick);
    const k = S.frisch ? 1 : 1 - Math.exp(-dt * 8);
    for (let i = 0; i < 3; i++) { S.auge[i] += (soll.auge[i] - S.auge[i]) * k; S.ziel[i] += (soll.ziel[i] - S.ziel[i]) * k; }
    S.fov += (soll.fov - S.fov) * k;
    S.frisch = false;
    const fertig = Math.hypot(soll.ziel[0] - S.ziel[0], soll.ziel[1] - S.ziel[1], soll.ziel[2] - S.ziel[2]) < 0.08;
    S.pultSicht = S.blick === 'pult' && fertig ? Math.min(1, S.pultSicht + dt * 5) : S.blick === 'pult' ? S.pultSicht : 0;
    VR.renderer.setSeat({ pos: S.auge.slice(), look: S.ziel.slice(), fov: S.fov });
    return true;
  }

  // Hauptschirm: für alle dasselbe Bild, die Frontsicht des Piloten (Kai 2026-10-14)
  function zeichneSchirm(view) {
    const c = schirmCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = PAL.space; c.fillRect(0, 0, SW, SH);
    const nb = R.ui.buttons.length;
    try {
      const zoom = (SW / 2) / R.FRONT.side, h = (R.FRONT.fwd + R.FRONT.back) * zoom;
      R.drawFrontView(c, view, { x: 0, y: SH - 34 - R.FRONT.fwd * zoom, w: SW, h });
    } catch (e) { Net.reportError('Sitz.schirm', e); }
    R.ui.buttons.length = nb;
    S.schirmVersion++;
  }

  // Schmale Pultkante unten in VORN und CREW: Station, wichtigste Werte, Blickwechsel
  function zeichneKante(ctx, view) {
    const ship = (view.state && view.state.ship) || {};
    const y = VH - 30;
    const g = ctx.createLinearGradient(0, y - 10, 0, VH);
    g.addColorStop(0, 'rgba(11,14,26,0)'); g.addColorStop(0.35, 'rgba(11,14,26,0.82)'); g.addColorStop(1, 'rgba(11,14,26,0.95)');
    ctx.fillStyle = g; ctx.fillRect(0, y - 10, VW, 40);
    ctx.fillStyle = PAL.brass; ctx.fillRect(8, y, 4, 22);
    R.text(ctx, SITZE[S.station].titel, 18, y + 2, { color: PAL.amber });
    R.text(ctx, S.blick === 'crew' ? 'Blick: Crew' : 'Blick: Hauptschirm', 18, y + 12, { color: PAL.panelLight });
    const werte = [];
    const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
    if (S.station === 'helm') {
      const hi = Consoles.helmInfo ? Consoles.helmInfo(ship) : null;
      werte.push(['FAHRT', hi ? hi.names[hi.stage] : '–', PAL.amber]);
      werte.push(['TEMPO', String(Math.round(n(ship.speed))), PAL.mint]);
      werte.push(['KURS', Math.round(((n(ship.angle) * 180 / Math.PI) % 360 + 360) % 360) + '°', PAL.mint]);
    } else if (S.station === 'weapons') {
      const t = Consoles.targetOf ? Consoles.targetOf(view) : null;
      werte.push(['ZIEL', t ? (t.station ? t.name : (R.ENEMY_NAMES[t.kind] || t.kind)) : 'keins', PAL.amber]);
    }
    werte.push(['HÜLLE', String(Math.round(n(ship.hull != null ? ship.hull : 100))), PAL.ice]);
    let x = 120;
    for (const [k, v, col] of werte) {
      R.text(ctx, k, x, y + 2, { color: PAL.brass });
      R.text(ctx, v, x, y + 12, { color: col });
      x += Math.max(R.measure(k, 1), R.measure(String(v), 1)) + 18;
    }
    const hint = S.blick === 'crew' ? 'Maus an den Rand: zurück · Rad ▼ Pult' : 'Rad ▼ / Maus nach unten: Pult · Maus an den Seitenrand: Crew';
    R.text(ctx, hint, VW - 10, y + 12, { color: PAL.panelLight, align: 'right' });
    R.text(ctx, 'Tasten der Station wirken weiter · Esc verlassen', VW - 10, y + 2, { color: PAL.panelLight, align: 'right' });
  }

  // Ersetzt Consoles.draw an den Sitzplätzen. Die Konsole wird immer in den Pult-Puffer gezeichnet (damit Zustand und
  // Tasten wie gewohnt laufen); sichtbar und klickbar nur im Blick PULT.
  function draw(ctx, view) {
    const nb = R.ui.buttons.length;
    pultCtx.setTransform(1, 0, 0, 1, 0, 0);
    pultCtx.clearRect(0, 0, VW, VH);
    pultCtx.imageSmoothingEnabled = false;
    Net.guard('Consoles.draw', () => Consoles.draw(pultCtx, view));
    zeichneSchirm(view);
    if (S.pultSicht > 0) {
      ctx.save(); ctx.globalAlpha = S.pultSicht; ctx.drawImage(pultCanvas, 0, 0); ctx.restore();
      Consoles.verdeckt = S.pultSicht < 0.6 ? R.ui.buttons.splice(nb) : null;
      R.text(ctx, 'Maus an den oberen Rand oder Rad ▲: Hauptschirm', VW / 2, 1, { color: PAL.panelLight, align: 'center' });
    } else {
      Consoles.verdeckt = R.ui.buttons.splice(nb);   // für Tasten erreichbar, für Klicks nicht
      zeichneKante(ctx, view);
    }
  }

  // Mausrad: in VORN/CREW wechselt es den Blick; im PULT erst die Karten (Zoom), sonst Rad ▲ = VORN
  function rad(delta, kartenVerbraucht) {
    if (!S.station) return false;
    if (S.blick === 'pult') { if (!kartenVerbraucht && delta < 0) { setBlick('vorn'); return true; } return false; }
    if (delta > 0) setBlick(S.blick === 'crew' ? 'vorn' : 'pult');
    else if (S.blick === 'crew') setBlick('vorn');
    return true;
  }
  // Konsolenklicks nur, wenn das Pult sichtbar ist
  function klickErlaubt() { return !S.station || S.pultSicht >= 0.6; }

  window.Sitz = {
    aktiv, update, draw, rad, klickErlaubt, setBlick,
    get blick() { return S.blick; }, get station() { return S.station; }, get versteckt() { return S.versteckt; },
    schirm: { mass: SCHIRM, canvas: schirmCanvas, get version() { return S.schirmVersion; }, get aktiv() { return S.schirmLive; } },
  };
})();
