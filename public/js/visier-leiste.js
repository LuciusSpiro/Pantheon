// KUL-03 C: Instrumentenleiste des Visiers (Richtung B+, KUL-01): unten 22 px hoch (70 % der Mockup-Leiste), links Tempo (Skala 3) und Schubstufe als Wort (Skala 2) mit Stufenleiter, in der
// Mitte das Peilband mit dem Kurs im Kasten (Skala 3) und den Marken, oben rechts die Sprungziel-Tafel (HauptschirmTafeln.zeichneSprungziel). KEINE Hülle (die bleibt am Pult), oben links
// bleibt das ganze Bild frei. Nur Tempo-Feld (bis x 130) und Kurs-Kasten ragen über die Leiste (hochfeld 27 px), weil Skala 3 (21 px) sonst nicht in 22 px passt.
// Eigene Datei, meldet sich als Schicht 'leiste' (Rang 20) im Visier-Zeichner an (Visier.registriereSchicht); liest den Zustand direkt aus view, keine Werte durchgereicht.
// Datenquellen: Kurs, Tempo, Schubstufe, Sprungziel dieselben wie die klassischen Tafeln (HauptschirmTafeln.daten(view)); Ziel der Ops Consoles.targetOf(view); Station Render.stationOf(space);
// Sprungboje aus der Peilung der Sprungziel-Tafel; Stern aus Visier.plan (L.sterne).
//
// WINKELTREUES PEILBAND: Die Position einer Peilung auf dem Band ist
//     x = W/2 + tan(a) · F / cos(Neigung)          a = Peilung relativ zum Kurs (Bogenmaß, + = Steuerbord)
// F und Neigung kommen aus Visier.kamera() (F = Brennweite in px, cp = cos(Neigung)). Begründung: Ein Bodenpunkt in Peilung a und Abstand d steht im Bild bei
// x = W/2 + X · F / tiefe mit tiefe = (Z − vor) · cos(N) + auge · sin(N), also für große d bei x ≈ W/2 + tan(a) · F / cos(N): die Neigung staucht die Tiefe um cos(N). Die Mockup-Formel
// tan(a) · F liegt dort bis 4,8° daneben, mit 1/cos(N) unter 1° ab Entfernung 400 (Erkundung KUL-03). Das Band deckt damit ±(atan(122 · cos(N) / F)) ≈ ±21° ab (Band x 134 … 378).
// Marken außerhalb des Bandes oder ab |a| > 1,2 rad: Pfeil am Bandende (Seite nach Vorzeichen von a). Gegner (Ziel der Ops) hinter dem Schiff erscheinen nicht auf dem Band (nur in der Lagescheibe).
//   VisierLeiste.lage(view, plan, kamera)   reine Lage { kurs, kursExakt, tempo, stufe, stufen, alarm, ticks[], marken[], geo }; null ohne Schiff
//   VisierLeiste.bandX(a, kamera)           Bandposition einer relativen Peilung (Bogenmaß)
//   VisierLeiste.zeichne(ctx, view, plan, kamera)  die Schicht (wirft nie)
// Alle Maße, Farben, Skins: HauptschirmTokens.TOKENS.VISIER.leiste / .skin / .tafel; Skin: skinVon(view) (Paket E), gemeinsam fuer Leiste und Tafel.
//   VisierLeiste.szenenLage(ctx, view, kamera) / tafelOptionen(szene)  Szenenzeile { x, y, w, h } | null und daraus die Optionen der Sprungziel-Tafel (zum Zeichnen und fuer die Sperrflaeche)
//   VisierLeiste.skinVon(view)              'rom' | 'germanen': Volk des eigenen Schiffs aus dem Snapshot, sonst Pult.skinId, sonst 'rom'
(function (root) {
  'use strict';

  const ok = Number.isFinite;
  const RAD = Math.PI / 180;
  const T = () => root.HauptschirmTokens.TOKENS;
  const Rd = () => root.Render;
  function rgba(hex, a) { const n = parseInt(String(hex).slice(1, 7), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  let gemeldet = false;
  function melde(e) { if (gemeldet) return; gemeldet = true; try { if (root.Net && root.Net.reportError) root.Net.reportError('VisierLeiste', e); } catch (x) { /* egal */ } }
  // Skin der Leiste UND der Sprungziel-Tafel: EINE Funktion (Paket E). Der Hauptschirm soll fuer alle Clients dasselbe Bild sein, deshalb zuerst das Volk des eigenen Schiffs aus dem Snapshot
  // (ship.pult / ship.skin / ship.volk, sonst die Klasse ueber CONFIG.shipClasses[klasse].pult); NUR wenn der Snapshot dazu nichts traegt (heute: kein solches Feld, Budget), gilt Pult.skinId(view)
  // (die Pult-Wahl, mit URL/localStorage-Ueberschreibung fuer Sichtpruefung), und ohne Pult 'rom'.
  const VOLK = { rom: 'rom', germanen: 'germanen', ger: 'germanen' };
  // Hinweis: Pult.skinId ist client-lokal (Pult-Wahl dieses Clients); der Rueckfall kann sich also von Client zu Client unterscheiden, solange der Snapshot kein Volk traegt.
  function skinVon(view) {
    const SK = root.HauptschirmTokens && root.HauptschirmTokens.TOKENS.VISIER.skin;
    const ist = (id) => (typeof id === 'string' && VOLK[id] && SK && SK[VOLK[id]] ? VOLK[id] : null);
    try {
      const ship = view && view.state && view.state.ship;
      if (ship) {
        const direkt = ist(ship.pult) || ist(ship.skin) || ist(ship.volk);
        if (direkt) return direkt;
        const CFG = root.Shared_Config, sc = CFG && CFG.shipClasses && ship.klasse && CFG.shipClasses[ship.klasse];
        const ueber = sc && ist(sc.pult);
        if (ueber) return ueber;
      }
      const pk = root.Pult && root.Pult.skinId ? ist(root.Pult.skinId(view)) : null;
      if (pk) return pk;
    } catch (e) { /* Rueckfall */ }
    return 'rom';
  }

  // Breite eines Textes in px (Skala wie Render.text)
  const breite = (str, skala) => Rd().measure(String(str), skala);

  function bandX(a, kam) { return kam.W / 2 + Math.tan(a) * kam.F / kam.cp; }

  // ------------------------------------------------------------ Lage (rein)
  function marke(art, farbe, q, geo, kam) {
    const a = Math.atan2(q.r, q.f), M = T().VISIER.leiste.marke;
    let x = bandX(a, kam), aus = Math.abs(a) > M.aus.radMax || !(x >= geo.xa && x <= geo.xb);
    const dir = a < 0 ? -1 : 1;
    if (aus) x = dir < 0 ? geo.xa : geo.xb;
    return { art, farbe, a, x, aus, dir };
  }

  // Ansicht, in der das Snapshot-Schiff Ort und Kurs des Bildschiffs traegt: Kurs-Kasten und Peilung der Sprungboje (HauptschirmTafeln.daten) gehen so mit dem Band
  function mitSchiff(view, ship) {
    const st = view.state;
    return Object.assign({}, view, { state: Object.assign({}, st, { ship: Object.assign({}, st.ship, { x: ship.x, y: ship.y, angle: ship.angle }) }) });
  }

  function lage(view, plan, kam) {
    const st = view && view.state, ship = root.Visier.schiffVon(view);   // dasselbe (interpolierte) Schiff wie Bild, Objekte und Lagescheibe (N1 B1)
    if (!st || !ship || !ok(ship.angle) || !ok(ship.x) || !ok(ship.y) || !kam) return null;
    const TK = T(), LS = TK.VISIER.leiste, W = kam.W, H = kam.H;
    const geo = { W, H, ly: H - LS.hoehe, xa: LS.band.rand, xb: W - LS.band.rand };
    const TA = root.HauptschirmTafeln, d = TA && TA.daten ? TA.daten(mitSchiff(view, ship)) : { kurs: null, tempo: null, stufe: null, stufen: { n: 0, stage: -1, werte: [] }, sprung: null };
    const exakt = (((ship.angle / RAD + 90) % 360) + 360) % 360;   // Kompass Nord = 0, Ost = 90 (Shared_Physics.kompassGrad ohne Rundung: das Band läuft stetig)
    const aus = { kurs: d.kurs, kursExakt: exakt, tempo: d.tempo, stufe: d.stufe, stufen: d.stufen, alarm: ship.alert === 'red', geo, ticks: [], marken: [] };

    for (let g = Math.ceil((exakt - 45) / LS.band.teilung) * LS.band.teilung; g <= exakt + 45; g += LS.band.teilung) {
      const rel = (g - exakt) * RAD;
      if (Math.abs(rel) >= Math.PI / 2) continue;
      const x = Math.round(bandX(rel, kam));
      if (x < geo.xa || x > geo.xb) continue;
      const gg = ((g % 360) + 360) % 360;
      aus.ticks.push({ x, grad: gg, lang: gg % LS.band.zahlAlle === 0, text: gg === 0 ? LS.band.nord.text : String(gg).padStart(3, '0') });
    }

    const q = (x, y) => (ok(x) && ok(y) ? root.Visier.projiziereWelt(ship, x, y, 0) : null);
    // Reihenfolge = Zeichenreihenfolge, Ziel zuletzt (liegt oben)
    for (const s of (plan && plan.sterne) || []) { const p = q(s.wx, s.wy); if (p) aus.marken.push(marke('stern', LS.marke.farbe.stern, p, geo, kam)); }
    try {
      const so = Rd() && Rd().stationOf ? Rd().stationOf(st.space) : null;
      const p = so && q(so.x, so.y);
      if (p) aus.marken.push(marke('station', LS.marke.farbe.station, p, geo, kam));
    } catch (e) { /* ohne Station */ }
    if (d.sprung && d.sprung.boje != null && ok(d.sprung.peil)) {   // Boje des Sprungziels aus der Peilung der Tafel (Bug oben, daten().peil = relative Peilung − 90°)
      const a = d.sprung.peil + Math.PI / 2, e = d.sprung.entfernung || 1;
      aus.marken.push(marke('sprungboje', LS.marke.farbe.sprungboje, { f: Math.cos(a) * e, r: Math.sin(a) * e }, geo, kam));
    }
    try {
      const C = root.Consoles, t = C && C.targetOf ? C.targetOf(view) : null, p = t && q(t.x, t.y);
      const gegner = t && t.id !== 'station' && !t.hidden;
      if (p && !(gegner && p.f <= 0)) aus.marken.push(marke('ziel', LS.marke.farbe.ziel, p, geo, kam));
    } catch (e) { /* ohne Ziel */ }
    return aus;
  }

  // ------------------------------------------------------------ Zeichnen
  function poly(ctx, pts, farbe) {
    ctx.fillStyle = farbe; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  const txt = (ctx, str, x, y, farbe, skala, align) => Rd().text(ctx, str, x, y, { color: farbe, scale: skala, align: align || 'left', shadow: false });

  function platte(ctx, geo) {
    const TK = T(), LS = TK.VISIER.leiste, SK = TK.VISIER.skin, name = geo.skin, P = SK[name].platte, W = geo.W, H = geo.H, ly = geo.ly, top = H - LS.hochfeld, s = LS.schraege, fb = LS.feldBreite;
    const grund = rgba(P.farbe, P.alpha), streifen = geo.alarm ? LS.farbeAlarm : LS.farbe;
    poly(ctx, [[s, ly], [W - s, ly], [W, ly + s], [W, H], [0, H], [0, ly + s]], grund);
    poly(ctx, [[s, top], [fb, top], [fb, ly + 1], [fb, H], [0, H], [0, top + s]], grund);   // Hochfeld links (Tempo)
    if (name === 'germanen') {
      const G = SK.germanen, Rn = G.rand, Z = G.wolfszahn, N = G.niete;
      ctx.fillStyle = Rn.farbe;   // Eisenrand: oben ueber die Leiste, oben am Hochfeld und an dessen Innenkante
      ctx.fillRect(s, ly, W - 2 * s, Rn.breite); ctx.fillRect(s, top, fb - s, Rn.breite); ctx.fillRect(fb - Rn.breite, top, Rn.breite, ly - top + 1);
      ctx.fillStyle = streifen;   // Wolfszahn-Band in der Funktionsfarbe statt des Streifens (in der Leiste auf der Kante: Striche des Peilbands beginnen bei ly + 2)
      for (let x = s + Z.start; x < W - s - Z.start; x += Z.schritt) for (const [dx, dy, w, h] of Z.zahn) ctx.fillRect(x + dx, ly + dy + Z.leisteY, w, h);
      for (let x = s + Z.start; x < fb - Z.start; x += Z.schritt) for (const [dx, dy, w, h] of Z.zahn) ctx.fillRect(x + dx, top + dy + Z.leisteY, w, h);
      ctx.fillStyle = N.farbe;   // Nieten: unten in den Ecken und am Hochfeld
      for (const [nx, ny] of [[N.einzug, H - N.einzug - N.px], [W - N.einzug - N.px, H - N.einzug - N.px], [fb - N.einzug - N.px, top + N.einzug + 2]]) ctx.fillRect(nx, ny, N.px, N.px);
      return;
    }
    ctx.fillStyle = streifen;
    ctx.fillRect(s, ly, W - 2 * s, LS.streifen);
    ctx.fillRect(s, top, fb - s, LS.streifen);
    const K = SK.rom.kante;   // Kante (Paket E): der dunkle Grund steht sonst im Sternfeld fast unsichtbar; Hairline am Fuß und an der Innenkante des Hochfelds lässt die Platte als Platte lesen
    ctx.fillStyle = rgba(K.farbe, K.alpha);
    ctx.fillRect(0, H - K.breite, W, K.breite); ctx.fillRect(fb - K.breite, top + LS.streifen, K.breite, H - top - LS.streifen);
  }

  function leisteLinks(ctx, L) {
    const LS = T().VISIER.leiste, ly = L.geo.ly, tempo = L.tempo != null ? String(L.tempo) : '–';
    txt(ctx, tempo, LS.tempo.x, ly + LS.tempo.y, LS.tempo.farbe, LS.tempo.skala);
    const sx = LS.tempo.x + breite(tempo, LS.tempo.skala) + LS.stufe.abstand;
    if (L.stufe != null) txt(ctx, L.stufe, sx, ly + LS.stufe.y, LS.stufe.farbe, LS.stufe.skala);
    const n = L.stufen.n, lt = LS.leiter;
    if (n > 0) {
      const schritt = Math.min(lt.schritt, Math.floor((LS.feldBreite - 4 - sx) / n) || lt.schritt);
      for (let i = 0; i < n; i++) {
        const sv = L.stufen.werte[i];
        let f;
        if (sv < 0) f = i === L.stufen.stage ? lt.rueckAn : lt.rueckAus;
        else if (sv === 0) f = lt.stopp;
        else f = i <= L.stufen.stage ? lt.an : lt.aus;
        ctx.fillStyle = f; ctx.fillRect(sx + i * schritt, ly + lt.y, lt.w, lt.h);
      }
    }
  }

  function band(ctx, L) {
    const LS = T().VISIER.leiste, B = LS.band, geo = L.geo, ly = geo.ly, mid = geo.W / 2;
    const kt = L.kurs != null ? TAFELKURS(L.kurs) : '–', kw = breite(kt, LS.kasten.skala) + 2 * LS.kasten.pad;
    for (const t of L.ticks) {
      ctx.fillStyle = rgba(B.farbe, t.lang ? B.alphaLang : B.alphaKurz);
      ctx.fillRect(t.x, ly + B.tickY, 1, t.lang ? B.lang : B.kurz);
      if (!t.lang) continue;
      const lw = breite(t.text, B.zahl.skala) / 2;
      if (Math.abs(t.x - mid) > kw / 2 + lw + B.zahl.abstandKasten && t.x - lw >= geo.xa && t.x + lw <= geo.xb) {
        txt(ctx, t.text, t.x, ly + B.zahl.y, t.grad === 0 ? B.nord.farbe : rgba(B.farbe, B.zahl.alpha), B.zahl.skala, 'center');
      }
    }
    // Kurs im Kasten über der Bandmitte (Rand 1 px Bernstein, unten 3 px abgeschrägt)
    const K = LS.kasten, ky = ly + K.y, kx = Math.round(mid - kw / 2), s = K.schraege, rb = K.randBreite, h = geo.H;
    poly(ctx, [[kx, ky], [kx + kw, ky], [kx + kw, h - s], [kx + kw - s, h], [kx + s, h], [kx, h - s]], K.rand);
    poly(ctx, [[kx + rb, ky + rb], [kx + kw - rb, ky + rb], [kx + kw - rb, h - s], [kx + kw - s - rb, h], [kx + s + rb, h], [kx + rb, h - s]], K.grund);
    txt(ctx, kt, mid, ly + K.textY, K.farbe, K.skala, 'center');
    const Z = LS.zeiger;
    poly(ctx, [[mid, ky + Z.spitze], [mid - Z.halbB, ky + Z.basis], [mid + Z.halbB, ky + Z.basis]], Z.farbe);
  }

  function marken(ctx, L) {
    const M = T().VISIER.leiste.marke, ly = L.geo.ly;
    for (const m of L.marken) {
      if (m.aus) {
        const d = m.dir, A = M.aus;
        poly(ctx, [[m.x + d * A.spitze, ly - A.h / 2], [m.x - d * A.ruecken, ly - A.h], [m.x - d * A.ruecken, ly]], m.farbe);
      } else poly(ctx, [[m.x, ly], [m.x - M.halbB, ly - M.h], [m.x + M.halbB, ly - M.h]], m.farbe);
    }
  }

  // Kurs im Kasten: dreistellig wie das Mockup und die Tokens (Kasten = Text + 16, „360“ Skala 3 = 51 px); ohne Gradzeichen, sonst schrumpft das Fenster für die Bandzahlen neben dem Kasten
  // (Kompassgrad wie die klassische Tafel: Shared_Physics.kompassGrad über HauptschirmTafeln.daten)
  function TAFELKURS(kurs) { return String(kurs).padStart(3, '0'); }

  // Szenenzeile (Hud) oben mittig: Lage { x, y, w, h } wie sitz.js sie zeichnet (y 6, mittig), null ohne Szene
  const SZENE_Y0 = 6, SZENE_LUFT = 4;
  function szenenLage(ctx, view, kam) {
    const H = root.Hud;
    if (!H || !H.szeneVon || !H.szeneVon(view)) return null;
    const w = H.drawSzenenStrip(ctx, view, SZENE_Y0, { measure: true });
    return w > 0 ? { x: Math.round((kam.W - w) / 2), y: SZENE_Y0, w, h: H.szenenHoehe(view) } : null;
  }
  // Optionen fuer HauptschirmTafeln.lage: EINE Stelle fuer Zeichnen UND Sperrflaeche (visier-beschriftung); wie sitz.js tafelOpt (Breite der Zeile, Unterkante samt Luft)
  function tafelOptionen(szene) { return szene ? { szeneBreite: szene.w, szeneUnten: szene.y + szene.h + SZENE_LUFT } : { szeneBreite: 0, szeneUnten: 0 }; }

  function zeichne(ctx, view, plan, kam) {
    if (!ctx || !root.HauptschirmTokens || !Rd() || !root.Visier) return;
    ctx.save();
    try {
      const L = lage(view, plan, kam || root.Visier.kamera());
      if (!L) return;
      const skin = skinVon(view);
      platte(ctx, Object.assign(L.geo, { alarm: L.alarm, skin }));
      leisteLinks(ctx, L);
      band(ctx, L);
      marken(ctx, L);
      if (T().VISIER.tafel.rechts && root.HauptschirmTafeln && root.HauptschirmTafeln.zeichneSprungziel) root.HauptschirmTafeln.zeichneSprungziel(ctx, view, Object.assign(tafelOptionen(szenenLage(ctx, view, L.geo)), { skin }));
    } catch (e) { melde(e); } finally { ctx.restore(); }
  }

  const API = { lage, bandX, zeichne, skinVon, szenenLage, tafelOptionen };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.VisierLeiste = API;
  if (root.Visier && root.Visier.registriereSchicht) root.Visier.registriereSchicht('leiste', 20, zeichne);
})(typeof window !== 'undefined' ? window : globalThis);
