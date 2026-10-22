// SUND-01 C: Übersichtskarte Sund nach dem Wissen von Rom – Zeichencode (Meldetafel mit Sichtgrenze und Dunkel). Gestaltung: CONCEPT-SUND01-KARTE.md,
// Farben, Muster, Maße und Texte stehen in js/karte-tokens.js (KarteTokens), hier steht nur das Zeichnen. Daten: der Anzeigeblock world.lage
// (Server: server/sim/kriegslage-wissen.js, Format siehe shared/protocol.js). Keine Netzlogik, kein Server-Wissen, kein eigener Zustand außer der Funkliste.
//   KarteLage.lesen(block, codes)               Ansichtsmodell { B, hex, stufe(h), hell(h), fl[], neu } aus dem Block (leerer/halber Block ergibt ein leeres Modell)
//   KarteLage.flaeche(ctx, p, s, A, h, fallback) Hexfläche mit Besitzermuster, Dunkel und Rand (statt IconsB.hexFlaeche)
//   KarteLage.sichtgrenze / front / perlen       Sichtgrenze (Eislinie), Front (Warnbake), Perlen der Kanten oben
//   KarteLage.flotten(ctx, A, V, o)              Belagerung, Kurs, Vermutung, Plaketten (V: { s, h3, mitte, nachbarn, hexe, bereich })
//   KarteLage.plakette / kurzplakette / posten   Einzelzeichen
//   KarteLage.spalte(ctx, A, o) / legende        rechte Spalte: Ortsinfo mit Wissenszeile, Meldeliste; Legende
//   KarteLage.fokusHexe(modus, hexe, hier, adj)  Hexe im Bild: Übersicht = alle Kartenhexe, Nahansicht = Lerche plus 2 Sprünge
//   KarteLage.funkMerken(ev) / funkListe()       Lagefunk des Captains (Funk-Reiter)
// Läuft im Browser (window.KarteLage) und in Node (Tests mit Fake-Canvas, Render über KarteLage.env).
(function (root, factory) {
  const api = factory(typeof require === 'function' && typeof module === 'object' ? require('./karte-tokens.js') : root.KarteTokens, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KarteLage = api;
})(typeof self !== 'undefined' ? self : this, function (T, root) {
  'use strict';
  const F = T.FARBE, P = T.PULT, M = T.MASS;
  const env = { Render: null };   // Tests setzen env.Render = { text, measure }
  const R = () => env.Render || (root && root.Render) || null;
  const txt = (ctx, s, x, y, o) => { const r = R(); if (r && r.text) r.text(ctx, s, x, y, o); };
  const tw = (s) => { const r = R(); return r && r.measure ? r.measure(String(s), 1) : String(s).length * 6; };
  const SQ3 = Math.sqrt(3);

  // ------------------------------------------------------------------ Hilfen
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const c = (i) => Math.round(((pa >> i) & 255) * (1 - t) + ((pb >> i) & 255) * t);
    return 'rgb(' + c(16) + ',' + c(8) + ',' + c(0) + ')';
  }
  function hexPfad(ctx, x, y, s) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i, px = x + s * Math.cos(a), py = y + s * Math.sin(a); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  }
  const kurzText = (s, w) => { s = String(s); if (tw(s) <= w) return s; while (s.length > 3 && tw(s + '.') > w) s = s.slice(0, -1); return s + '.'; };
  const KACH = {};
  function kachel(w, h, fn) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    fn(c.getContext('2d'));
    return c;
  }
  function musterPat(ctx, key, art) {
    const m = T.MUSTER[key];
    if (!m || !m.kachel || typeof ctx.createPattern !== 'function') return null;
    const a = m[art], k = key + art;
    if (!(k in KACH)) KACH[k] = kachel(8, 8, (g) => { g.fillStyle = 'rgba(244,238,220,' + a + ')'; m.kachel.forEach((row, y) => { for (let x = 0; x < 8; x++) if (row[x] === '#') g.fillRect(x, y, 1, 1); }); });
    return KACH[k] ? ctx.createPattern(KACH[k], 'repeat') : null;
  }
  function kornPat(ctx) {
    if (typeof ctx.createPattern !== 'function') return null;
    if (!('korn' in KACH)) {
      const k = F.dunkel.korn;
      KACH.korn = kachel(k.kachel, k.kachel, (g) => { let z = k.seed; const rnd = () => (z = (z * 16807) % 2147483647) / 2147483647; for (let i = 0; i < k.anzahl; i++) { g.fillStyle = rnd() < 0.5 ? k.hell : k.dunkel; g.fillRect(Math.floor(rnd() * k.kachel), Math.floor(rnd() * k.kachel), 1, 1); } });
    }
    return KACH.korn ? ctx.createPattern(KACH.korn, 'repeat') : null;
  }
  // Kurzname eines Hexes für die Namenszeile (SUND-01 F): voller Name, wenn er in w passt; sonst der handverlesene Kurzname aus TEXT.kurzname, sonst null
  // (der Aufrufer kürzt dann selbst). Namen aus `kurznameImmer` stehen immer kurz.
  function kurzname(name, w) {
    const n = String(name), k = T.TEXT.kurzname[n];
    if (k && T.TEXT.kurznameImmer.indexOf(n) >= 0) return k;
    if (tw(n) <= w) return n;
    return k && tw(k) <= w ? k : null;
  }
  const fraktion = (f) => F.fraktion[f] || F.fraktion['-'];

  // ------------------------------------------------------------------ Ansichtsmodell aus dem Anzeigeblock
  // block darf fehlen oder unvollständig sein (kein Fehler): dann ist alles unbekannt und es gibt keine Flotten.
  function lesen(block, codes) {
    const B = block && typeof block === 'object' ? block : {};
    const vz = Number.isFinite(B.vz) ? B.vz : 1, t = Number.isFinite(B.t) ? B.t : 0;
    const hex = T.hxLesen(typeof B.hx === 'string' ? B.hx : '', codes || []);
    const stufe = (h) => T.wissensstufe(hex[h] ? hex[h].alter : null, vz);
    const hell = (h) => { const s = stufe(h); return s === 'jetzt' || s === 'gesehen'; };
    const fl = (Array.isArray(B.f) ? B.f : []).filter((q) => q && F.fraktion[q.f] &&/^\d{4}$/.test(q.h) && Number.isFinite(q.a) && q.a <= T.WERTE.altMax)
      .map((q) => Object.assign({}, q, { stufe: T.wissensstufe(q.a, vz) }));
    const m = (Array.isArray(B.m) ? B.m : []).filter((x) => x && /^\d{4}$/.test(x.h));
    const neu = new Set(m.filter((x) => x.t >= t - T.WERTE.neuTicks + 1).map((x) => x.h));
    return { B, t, vz, sw: Number.isFinite(B.sw) ? B.sw : null, hex, stufe, hell, fl, m, neu, codes: codes || [] };
  }
  const belagert = (A, h) => !!A && A.fl.some((q) => q.h === h && q.p === 'b');
  const hatPlakette = (A, h) => !!A && A.fl.some((q) => q.h === h);

  // Rang in Liste und Hex: Belagerung vor Marsch vor Sammeln; eigene nach feindlichen; Altstand zuletzt
  function rang(q) {
    const PH = { b: 0, m: 1, s: 2, u: 3, r: 3, h: 4 };
    if (q.stufe === 'alt') return 20 + q.a;
    return (q.f === 'r' ? 10 : 0) + (PH[q.p] != null ? PH[q.p] : 4);
  }
  // SUND-01 F: Gleichstand im Rang (z. B. zwei Fraktionen im Hex) nach Fraktion (Germanen vor Piraten vor Konkordat vor Rest), dann Stärke absteigend
  const FRK_RANG = { g: 0, p: 1, k: 2 };
  const rangVergleich = (a, b) => rang(a) - rang(b) || (FRK_RANG[a.f] != null ? FRK_RANG[a.f] : 3) - (FRK_RANG[b.f] != null ? FRK_RANG[b.f] : 3) || (b.k || 0) - (a.k || 0);

  // ------------------------------------------------------------------ Fläche, Muster, Dunkel
  function flaeche(ctx, p, s, A, h, fallback) {
    const kh = A.hex[h] || {};
    const fr = fraktion(kh.f || fallback);
    const hell = A.hell(h) || (A.hex[h] == null);
    const sk = s / 60;
    hexPfad(ctx, p.x, p.y, s - 0.5);
    ctx.fillStyle = fr.flaeche; ctx.fill();
    if (hell) { const pt = musterPat(ctx, fr.muster, 'hell'); if (pt) { ctx.fillStyle = pt; ctx.fill(); } }
    else {
      ctx.fillStyle = F.dunkel.abdunklung; ctx.fill();
      const kp = kornPat(ctx); if (kp) { ctx.fillStyle = kp; ctx.fill(); }
      const pt = musterPat(ctx, fr.muster, 'dunkel'); if (pt) { ctx.fillStyle = pt; ctx.fill(); }
    }
    ctx.strokeStyle = hell ? 'rgba(244,238,220,0.35)' : 'rgba(244,238,220,0.18)'; ctx.lineWidth = Math.max(1, 1.5 * sk); ctx.stroke();
  }

  // gemeinsame Seite zweier Nachbarhexe: Endpunkte, Mitte, Richtung a -> b
  function seite(V, a, b) {
    const p = V.mitte(a), q = V.mitte(b), dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
    const ux = -dy / len, uy = dx / len, mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, hl = V.s / 2;
    return { x1: mx + ux * hl, y1: my + uy * hl, x2: mx - ux * hl, y2: my - uy * hl, mx, my, nx: dx / len, ny: dy / len };
  }
  // Sichtgrenze: jede Seite zwischen hellem und dunklem Kartenhex (nicht zum Leerraum-Rand)
  function sichtgrenze(ctx, A, V) {
    const segs = [];
    for (const h of V.hexe) {
      if (!A.hell(h)) continue;
      for (const n of V.nachbarn(h)) if (V.hexe.indexOf(n) >= 0 && !A.hell(n)) segs.push(seite(V, h, n));
    }
    if (!segs.length) return 0;
    ctx.save(); ctx.lineCap = 'round';
    const zug = (w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); for (const S of segs) { ctx.moveTo(S.x1, S.y1); ctx.lineTo(S.x2, S.y2); } ctx.stroke(); };
    zug(M.sicht.unterlage, F.sicht.unterlage); zug(M.sicht.breite, F.sicht.linie);
    ctx.restore();
    return segs.length;
  }
  // Front: Hexseiten zwischen bekanntem römischem und bekanntem germanischem Besitz (Konkordat neutral, Piraten keine Front)
  function frontSeiten(A, V) {
    const out = [];
    for (const h of V.hexe) for (const n of V.nachbarn(h)) {
      if (!(h < n) || V.hexe.indexOf(n) < 0) continue;
      const a = A.hex[h] && A.hex[h].f, b = A.hex[n] && A.hex[n].f;
      if ((a === 'r' && b === 'g') || (a === 'g' && b === 'r')) out.push([h, n]);
    }
    return out;
  }
  function front(ctx, A, V) {
    const fs = frontSeiten(A, V);
    for (const [a, b] of fs) {
      const S = seite(V, a, b), ue = M.front.ueberstand;
      const ex = (S.x2 - S.x1) * ue, ey = (S.y2 - S.y1) * ue, ax = S.x1 - ex, ay = S.y1 - ey, bx = S.x2 + ex, by = S.y2 + ey;
      const len = Math.hypot(bx - ax, by - ay), n = Math.max(4, Math.round(len / M.front.segment));
      ctx.save(); ctx.lineCap = 'butt';
      ctx.strokeStyle = F.front.unterlage; ctx.lineWidth = M.front.unterlage; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = i % 2 ? F.front.b : F.front.a; ctx.lineWidth = M.front.breite;
        ctx.beginPath(); ctx.moveTo(ax + (bx - ax) * i / n, ay + (by - ay) * i / n); ctx.lineTo(ax + (bx - ax) * (i + 1) / n, ay + (by - ay) * (i + 1) / n); ctx.stroke();
      }
      ctx.restore();
    }
    return fs.length;
  }

  // ------------------------------------------------------------------ Plakette (CONCEPT §2)
  const phaseBreite = (ph) => (ph ? Math.max(M.plakette.phase.minBreite, (ph.pfeil ? 7 : tw(ph.text)) + M.plakette.phase.polster) : 0);
  const plBreite = (q) => M.plakette.breiteOhnePhase + phaseBreite(T.phaseFeld(q.p, q.f, q.stufe, q.a));
  // q: { f, k, p, a, stufe, d?, n? (eigen), v? (fremd) }; o: { kurs (Winkel), ohnePhase }. Mitte (x, y). -> Breite
  function plakette(ctx, x, y, q, o) {
    o = o || {};
    const fr = fraktion(q.f), st = q.stufe || T.wissensstufe(q.a, 1), ph = o.ohnePhase ? null : T.phaseFeld(q.p, q.f, st, q.a);
    const MP = M.plakette, h = MP.hoehe, L = MP.lampe, pw = phaseBreite(ph), w = MP.breiteOhnePhase + pw;
    const x0 = Math.round(x - w / 2), y0 = Math.round(y - h / 2);
    ctx.fillStyle = F.plakette.grund; ctx.fillRect(x0 - 1, y0 - 1, w + 2, h + 2);
    ctx.fillStyle = st === 'alt' ? F.wissen.alt.rahmen : mix(fr.haltung, P.tisch, 0.35);
    ctx.fillRect(x0, y0, w, 1); ctx.fillRect(x0, y0 + h - 1, w, 1); ctx.fillRect(x0, y0, 1, h); ctx.fillRect(x0 + w - 1, y0, 1, h);
    if (st === 'alt') { ctx.strokeStyle = P.grau; ctx.lineWidth = 1; ctx.strokeRect(x0 + 1.5, y0 + 1.5, 6, h - 3); txt(ctx, fr.buchstabe, x0 + 5, y0 + 1, { color: P.grau, align: 'center', shadow: false }); }
    else { ctx.fillStyle = fr.haltung; ctx.fillRect(x0 + 1, y0 + 1, 7, h - 2); txt(ctx, fr.buchstabe, x0 + 5, y0 + 1, { color: P.tisch, align: 'center', shadow: false }); }
    const anz = T.lampen(q.k);
    for (let i = 0; i < L.anzahl; i++) {
      const lx = x0 + 9 + i * (L.breite + L.abstand), ly = y0 + L.oben;
      if (i >= anz) { ctx.fillStyle = F.plakette.lampeLeer; ctx.fillRect(lx, ly, L.breite, L.hoehe); continue; }
      if (st === 'jetzt') { ctx.fillStyle = P.hell; ctx.fillRect(lx, ly, L.breite, L.hoehe); }
      else if (st === 'gesehen') { for (let yy = 0; yy < L.hoehe; yy++) for (let xx = 0; xx < L.breite; xx++) { ctx.fillStyle = (xx + yy) % 2 ? F.wissen.gesehen.lampeRaster : P.hell; ctx.fillRect(lx + xx, ly + yy, 1, 1); } }
      else { ctx.strokeStyle = P.grau; ctx.lineWidth = 1; ctx.strokeRect(lx + 0.5, ly + 0.5, L.breite - 1, L.hoehe - 1); }
    }
    if (ph) {
      const px = x0 + w - pw;
      if (ph.bg) { ctx.fillStyle = ph.bg; ctx.fillRect(px, y0 + 1, pw - 1, h - 2); }
      if (ph.pfeil) {
        const a = o.kurs || 0, cx = px + 3.5, cy = y0 + h / 2;
        ctx.fillStyle = ph.fg; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3); ctx.lineTo(cx + Math.cos(a + 2.4) * 3, cy + Math.sin(a + 2.4) * 3); ctx.lineTo(cx + Math.cos(a - 2.4) * 3, cy + Math.sin(a - 2.4) * 3); ctx.closePath(); ctx.fill();
      } else txt(ctx, ph.text, px + pw / 2, y0 + 1, { color: ph.fg, align: 'center', shadow: false });
    }
    return w;
  }
  // Kurzplakette (Hexradius „knapp“): nur das Buchstabenfeld, Phase als Rahmenfarbe (S Gelb, B Hellrot, Marsch Haltungsfarbe), Altstand Umriss
  function kurzplakette(ctx, x, y, q) {
    const fr = fraktion(q.f), st = q.stufe || T.wissensstufe(q.a, 1), b = M.plakette.kurz.breite;
    const x0 = Math.round(x - b / 2), y0 = Math.round(y - b / 2);
    ctx.fillStyle = F.plakette.grund; ctx.fillRect(x0 - 1, y0 - 1, b + 2, b + 2);
    const pf = st === 'alt' ? F.wissen.alt.rahmen : q.p === 's' ? P.warn : q.p === 'b' ? P.notruf : (q.p === 'm' || q.p === 'u') ? fr.haltung : mix(fr.haltung, P.tisch, 0.35);
    ctx.fillStyle = pf; ctx.fillRect(x0, y0, b, b);
    if (st === 'alt') { ctx.fillStyle = F.plakette.grund; ctx.fillRect(x0 + 1, y0 + 1, b - 2, b - 2); ctx.strokeStyle = P.grau; ctx.lineWidth = 1; ctx.strokeRect(x0 + 1.5, y0 + 1.5, b - 3, b - 3); txt(ctx, fr.buchstabe, x0 + b / 2, y0 + 1, { color: P.grau, align: 'center', shadow: false }); }
    else { ctx.fillStyle = fr.haltung; ctx.fillRect(x0 + 1, y0 + 1, b - 2, b - 2); txt(ctx, fr.buchstabe, x0 + b / 2, y0 + 1, { color: P.tisch, align: 'center', shadow: false }); }
    return b;
  }
  // Posten: kleine Station mit Fahne
  function posten(ctx, x, y, f) {
    x = Math.round(x); y = Math.round(y);
    ctx.fillStyle = '#1B2230'; ctx.fillRect(x - 4, y - 6, 10, 12);
    ctx.fillStyle = P.hell; ctx.fillRect(x - 3, y - 5, 1, 10);
    ctx.fillStyle = fraktion(f).fahne; ctx.fillRect(x - 2, y - 5, 6, 4);
    ctx.fillStyle = P.hell; ctx.fillRect(x - 3, y + 2, 7, 3); ctx.fillStyle = '#1B2230'; ctx.fillRect(x - 1, y + 3, 3, 1);
  }

  // ------------------------------------------------------------------ Flotten auf der Karte
  const winkelZu = (V, a, b) => { const p = V.mitte(a), q = V.mitte(b); return Math.atan2(q.y - p.y, q.x - p.x); };
  // Kurs (SUND-01 E): eigene Flotten zeigen nach vorn (`n`, der Pfeil verlässt das Hex), fremde die beobachtete Bewegung (`v` = kam von, der Pfeil
  // zeigt von der v-Seite ins Hex hinein). Eine Vorhersage fremder Flotten gibt der Block nicht her.
  const kursVon = (V, q) => (!V.mitte ? 0 : q.v ? winkelZu(V, q.v, q.h) : q.n ? winkelZu(V, q.h, q.n) : 0);
  function belagerungRahmen(ctx, p, vd) {
    const B = M.belagerung, vy = p.y + M.plakette.anker.verteidigerDy;
    const dw = vd ? plBreite(vd) : 22, fw = dw + 2 * B.abstandX, fh = M.plakette.hoehe + 2 * B.abstandY, fx = Math.round(p.x - fw / 2) + 0.5, fy = Math.round(vy - fh / 2) + 0.5;
    ctx.save();
    ctx.strokeStyle = F.belagerung.unterlage; ctx.lineWidth = B.unterlage; ctx.strokeRect(fx, fy, fw, fh);
    ctx.strokeStyle = F.belagerung.rahmen; ctx.lineWidth = B.rahmen; ctx.strokeRect(fx, fy, fw, fh);
    ctx.setLineDash(B.strich); ctx.strokeStyle = F.belagerung.rahmenStrich; ctx.strokeRect(fx, fy, fw, fh);
    ctx.restore();
    if (vd) plakette(ctx, p.x, vy, vd);
  }
  // SUND-01 G: Hafenklasse unter Belagerung (die Verteidiger-Plakette ersetzt dort Hafensymbol und Klasse): klein rechts neben dem Belagerungsrahmen, auf Symbolhöhe,
  // aber nur wenn sie zwischen Rahmenunterlage und Hexrand (mit 1 px Luft) Platz hat; sonst entfällt sie (Plakette und Hexrand bleiben frei). -> gezeichnet?
  function belagerungKlasse(ctx, A, p, h, klasse, s, farbe) {
    if (s < M.hexradius.voll || !klasse) return false;
    const b = A.fl.find((x) => x.h === h && x.p === 'b');
    if (!b) return false;
    const vd = A.fl.find((x) => x.h === h && x.f !== b.f && x.p === 'h'), B = M.belagerung, dw = vd ? plBreite(vd) : 22;
    const links = dw / 2 + B.abstandX + B.unterlage / 2 + 1, rand = s - 3;   // Rahmen außen (Unterlage) + 1 px Luft; Hexrand auf Buchstabenhöhe (Schräge und Linie)
    if (links + tw(klasse) - 1 > rand) return false;
    txt(ctx, klasse, Math.round(p.x + links), p.y + M.plakette.anker.hafenDy, { color: farbe });
    return true;
  }
  // o: { notrufHex: Set, kurz: bool } -> { plaketten: Anzahl gezeichneter Plaketten }
  function flotten(ctx, A, V, o) {
    o = o || {};
    const bereich = V.bereich || T.bereich(V.s), knapp = bereich !== 'voll';
    const { s, h3, mitte } = V;
    let gezeichnet = 0;
    for (const q of A.fl) {
      if (q.p === 'b' && !knapp) {
        const p = mitte(q.h), vd = A.fl.find((x) => x.h === q.h && x.f !== q.f && x.p === 'h');
        belagerungRahmen(ctx, p, vd);
      }
      const nb = q.v || q.n;
      if ((q.p === 'm' || q.p === 'u' || q.p === 'r') && nb && q.stufe !== 'alt' && V.hexe.indexOf(nb) >= 0) {
        const S = seite(V, q.h, nb), col = fraktion(q.f).haltung;
        if (q.p === 'm' && q.z && !knapp) {
          // eigene Flotte: Weg ab dem nächsten Hex n; fremde: Weg ab dem angezeigten Hex (die Schätzung gilt der beobachteten Richtung v -> h)
          const start = q.v ? mitte(q.h) : { x: S.mx, y: S.my - 3 };
          const weg = (V.weg ? V.weg(q.v ? q.h : q.n, q.z) : null) || (q.v ? [] : [q.n]), w = (q.v ? weg.slice(1) : weg).slice(0, M.vermutet.maxHexe), pts = w.map((h) => mitte(h));
          if (pts.length) {
            // SUND-01 F: Linienende und „?“-Kästchen liegen auf dem Plakettenanker des Zielhexes (oberes Band), nicht über dessen Symbol
            const zl = pts[pts.length - 1], ya = zl.y + Math.round(M.plakette.anker.dy * h3);
            ctx.save(); ctx.beginPath(); ctx.moveTo(start.x, start.y + 3); pts.forEach((pp, i) => ctx.lineTo(pp.x, i === pts.length - 1 ? ya : pp.y + 3)); ctx.setLineDash(M.vermutet.strich);
            ctx.strokeStyle = F.vermutet.unterlage; ctx.lineWidth = M.vermutet.unterlage; ctx.stroke(); ctx.strokeStyle = F.vermutet.linie; ctx.lineWidth = M.vermutet.breite; ctx.stroke(); ctx.restore();
            const z = { x: zl.x, y: ya - 3 }, mk = M.vermutet.marke;
            ctx.fillStyle = P.tisch; ctx.fillRect(z.x - mk.breite / 2 - 1, z.y - 2, mk.breite + 2, mk.hoehe + 2);
            ctx.strokeStyle = F.vermutet.marke; ctx.lineWidth = 1; ctx.strokeRect(z.x - mk.breite / 2 + 0.5, z.y - 1.5, mk.breite, mk.hoehe);
            txt(ctx, '?', z.x + 1, z.y, { color: F.vermutet.marke, align: 'center', shadow: false });
          }
        }
        // Pfeil an der Hexseite zum Nachbarn: eigene Flotte hinaus (n, auf der Seitenmitte, senkrecht zur Seite), fremde hinein (v, 6 px innen, Spitze zur Hexmitte)
        const k = Math.max(M.kurs.pfeilMin, s * M.kurs.pfeil), ab = q.v ? M.kurs.abstandRand : k / 2, cx = S.mx - S.nx * ab, cy = S.my - S.ny * ab, t = (q.v ? -1 : 1) * k;
        ctx.save(); ctx.beginPath(); ctx.moveTo(cx + S.nx * t, cy + S.ny * t); ctx.lineTo(cx - S.ny * k * 0.8, cy + S.nx * k * 0.8); ctx.lineTo(cx + S.ny * k * 0.8, cy - S.nx * k * 0.8); ctx.closePath();
        ctx.strokeStyle = P.tisch; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = q.p === 'r' ? P.stahlhell : col; ctx.fill(); ctx.restore();
      }
    }
    const jeHex = {};
    for (const q of A.fl) { if (q.p === 'h' && A.fl.some((x) => x.h === q.h && x.p === 'b')) continue; (jeHex[q.h] = jeHex[q.h] || []).push(q); }
    for (const h of Object.keys(jeHex)) {
      if (V.hexe.indexOf(h) < 0) continue;
      const liste = jeHex[h].sort(rangVergleich), q = liste[0], p = mitte(h), an = M.plakette.anker;
      const nr = o.notrufHex && o.notrufHex.has(h) ? an.dxNotruf : 0;
      const x = p.x + an.dx + nr, y = p.y + Math.round(an.dy * h3);
      if (knapp) kurzplakette(ctx, x, y, q);
      else {
        const w = plakette(ctx, x, y, q, { kurs: kursVon(V, q) });
        if (liste.length > 1) { const cx = Math.round(x + w / 2) + 1, c = M.plakette.mehrChip; ctx.fillStyle = P.tisch; ctx.fillRect(cx, Math.round(y - 5), c.breite + 1, c.hoehe + 2); txt(ctx, '+' + (liste.length - 1), cx + 2, Math.round(y - 4), { color: P.hell, shadow: false }); }
      }
      gezeichnet++;
    }
    return { plaketten: gezeichnet };
  }

  // ------------------------------------------------------------------ Ansicht
  // Winkel (Bildschirm, y nach unten) von Hex a zu Hex b nach der Hexgeometrie der Karte (flache Hexe, gerade Spalten nach unten versetzt)
  const hxy = (h) => { const c = +h.slice(0, 2), r = +h.slice(2); return { x: 1 + 1.5 * (c - 1), y: SQ3 / 2 + SQ3 * (r - 1) + (c % 2 === 0 ? SQ3 / 2 : 0) }; };
  const winkelHex = (a, b) => { const p = hxy(a), q = hxy(b); return Math.atan2(q.y - p.y, q.x - p.x); };
  const kartenFraktion = (name) => ({ rom: 'r', ger: 'g', saum: 'k', pirat: 'p', vorl: 'v' })[name] || '-';
  // Hexe im Bild: Übersicht = alle Kartenhexe ohne Ring, Nahansicht = Lerche plus nahSpruenge Sprünge (über die Kanten adj: { hex: [hex] })
  function fokusHexe(modus, hexe, hier, adj) {
    if (modus !== 'nah' || !hier || hexe.indexOf(hier) < 0) return new Set(hexe);
    const d = { [hier]: 0 }, q = [hier];
    for (let i = 0; i < q.length; i++) { const x = q[i]; if (d[x] >= M.ansicht.nahSpruenge) continue; for (const y of (adj[x] || [])) if (!(y in d) && hexe.indexOf(y) >= 0) { d[y] = d[x] + 1; q.push(y); } }
    return new Set(q);
  }
  // Abstand (Sprünge über Kanten adj) von mehreren Quellen
  function abstaende(quellen, adj) {
    const d = {}, q = [];
    for (const h of quellen) if (!(h in d)) { d[h] = 0; q.push(h); }
    for (let i = 0; i < q.length; i++) for (const y of (adj[q[i]] || [])) if (!(y in d)) { d[y] = d[q[i]] + 1; q.push(y); }
    return d;
  }

  // ------------------------------------------------------------------ rechte Spalte
  const WISSEN_FARBE = F.ortsinfo;
  // o: { rx, y, rw, sel, name(h), art(h), hafen(h), karteFraktion(h), dist(h) -> Sprünge zum nächsten römischen Knoten | undefined, maxZeilen }
  // -> y unter der Spalte
  function ortsinfo(ctx, A, o) {
    const h = o.sel, MS = M.spalte;
    let y = o.y;
    if (!h) { txt(ctx, 'ORT', o.rx, y, { color: P.messing }); y += MS.kopf; txt(ctx, 'Sektor überfahren oder anklicken.', o.rx, y, { color: P.grau }); return y + MS.zeile; }
    const kh = A.hex[h] || {}, fr = fraktion(kh.f || o.karteFraktion(h));
    txt(ctx, 'ORT · SEKTOR ' + h, o.rx, y, { color: P.messing }); y += MS.kopf;
    if (o.verborgen && o.verborgen(h)) {   // SUND-01 F: verborgenes, unerkundetes Hex: wie auf der Karte „?“, weder Name noch Besitzer noch Art (Wissensleck)
      txt(ctx, '?', o.rx, y, { color: P.gold }); y += MS.zeile;
      txt(ctx, T.TEXT.ortsinfo.verborgen, o.rx, y, { color: P.hell }); y += MS.zeile;
      txt(ctx, T.TEXT.ortsinfo.verborgenWissen, o.rx, y, { color: WISSEN_FARBE.unbekannt || P.grau }); y += MS.zeile;
      return y;
    }
    txt(ctx, kurzText(o.name(h), o.rw), o.rx, y, { color: P.gold }); y += MS.zeile;
    const hafen = o.hafen(h);
    txt(ctx, kurzText([fr.name, hafen ? 'Hafen ' + hafen : null, kh.posten ? 'Posten' : null].filter(Boolean).join(' · '), o.rw), o.rx, y, { color: P.hell }); y += MS.zeile;
    const st = A.stufe(h);
    let wt;
    if (st === 'jetzt') wt = kh.f === 'r' ? 'Eigen · aktuell' : 'Sonde · aktuell';
    else if (st === 'gesehen') wt = 'Gesehen · Stand Tick ' + Math.max(0, A.t - A.vz);
    else if (st === 'alt') { wt = 'Außer Sicht · Stand vor ' + kh.alter + ' Ticks'; if (tw(wt) > o.rw) wt = 'Außer Sicht · vor ' + kh.alter + ' Ticks'; }   // SUND-01 F: schmale Spalte ohne „Stand“
    else wt = 'Außer Sicht · nie gesehen';
    txt(ctx, wt, o.rx, y, { color: WISSEN_FARBE[st] || P.grau }); y += MS.zeile;
    if (st === 'alt' || st === 'unbekannt') {
      const n = o.dist ? o.dist(h) : undefined;
      if (n != null && n < 99) {   // SUND-01 F: passt die Langform nicht, steht die Kurzform mit der Sichtweite statt einer abgeschnittenen Langform
        const lang = T.vorlage('ortsinfo.aussenKnoten', { n }) + (A.sw != null ? ' (Sicht ' + A.sw + ')' : ''), kurz = T.vorlage(A.sw != null ? 'ortsinfo.aussenKnotenKurz' : 'ortsinfo.aussenKnotenKurzOhneSicht', { n, sw: A.sw });
        txt(ctx, kurzText(tw(lang) <= o.rw ? lang : kurz, o.rw), o.rx, y, { color: P.grau }); y += MS.zeile;
      }
    }
    const art = o.ohneArt ? '' : o.art(h);
    if (art) { txt(ctx, kurzText(art, o.rw), o.rx, y, { color: P.grau }); y += MS.zeile; }
    return y;
  }
  // Zeilen der Meldeliste: Flottenplaketten nach Rang (neu feindlich zuerst), dann Ereignisse ohne Flotte. -> [{ q } | { ereignis }]
  function listenZeilen(A) {
    const neuF = (q) => (A.neu.has(q.h) && q.f !== 'r' && q.stufe !== 'alt' ? 1 : 0);
    const zeilen = A.fl.map((q) => ({ q })).sort((a, b) => neuF(b.q) - neuF(a.q) || rangVergleich(a.q, b.q) || (a.q.h < b.q.h ? -1 : 1));
    for (const m of A.m) if (m.e === 'hf' || m.e === 'hh' || m.e === 'pv' || m.e === 'pg') zeilen.push({ ereignis: m });
    return zeilen;
  }
  // kurz: false = Langform, 1 = Kurzvorlage mit vollen Namen, 2 = Kurzvorlage mit Kurznamen der Hexe, 3 = wie 2, die Zeitangabe ohne Einheit (SUND-01 F; meldeliste probiert der Reihe nach)
  function zeilenText(z, o, kurz) {
    const nm = (h) => (kurz >= 2 ? T.TEXT.kurzname[o.name(h)] || o.name(h) : o.name(h)), V = (id, w) => T.vorlage('meldeliste.' + id + (kurz ? 'Kurz' : ''), w);
    if (z.ereignis) {
      const id = { hf: 'hafenGefallen', hh: 'hafenHaelt', pv: 'postenWeg', pg: 'postenNeu' }[z.ereignis.e];
      return V(id, { ort: nm(z.ereignis.h) });
    }
    const q = z.q, ort = nm(q.h);
    if (q.stufe === 'alt') return V('alt', { ort, a: q.a });
    if (q.p === 's') { const d = q.d || 1; return V('sammelt', { ort, d: kurz === 3 ? d : d + (d === 1 ? ' Tick' : ' Ticks') }); }
    if (q.v && (q.p === 'm' || q.p === 'u' || q.p === 'r')) return V('kam', { ort, von: nm(q.v) });   // fremd: beobachtete Bewegung
    if (q.p === 'm') return q.n ? V('marsch', { ort, nach: nm(q.n) }) : V('marschOhne', { ort });   // SUND-01 G: ohne Ziel und Herkunft die Phase als Wort statt nur des Orts
    if (q.p === 'u' || q.p === 'r') return q.n ? V('unterwegs', { ort, nach: nm(q.n) }) : V(q.p === 'r' ? 'rueckzugOhne' : 'unterwegsOhne', { ort });
    if (q.p === 'b') return T.vorlage('meldeliste.belagert', { ort });
    return ort;
  }
  // SUND-01 G: Höhenbilanz der rechten Spalte (Reihenfolge der Blöcke: Ortsinfo, Meldeliste, Sprungknopf und Sprung, Legende). Die Meldeliste hat Vorrang vor Sprungblock
  // und Legende: mindestens MS.meldung.min Zeilen (bei mehr Meldungen plus „+n weitere“) sind reserviert. SUND-02a C: die Liste bekommt bis MS.meldung.max Zeilen, die Legende weicht dafür (voll, kompakt, einzeilig), danach der Sprunghinweis.
  // o: { y (Oberkante der Meldeliste), unten (Unterkante der Spalte), rw, sprungBasis (Knopf, SPRUNG, Ziel, Balken, ggf. Sprungpunkt; ohne Grundzeilen), grundZ (Zeilen des Sprunghinweises) }
  // -> { maxZeilen (Meldezeilen ohne „+n weitere“), grundZ (Hinweiszeilen), kompakt (false | true = Legende auf zwei Zeilen | 'eins' = eine Zeile), legZ (Zeilen der Legende), frei, passt }
  function spaltenPlan(A, o) {
    const MS = M.spalte, z = MS.meldung.zeile, n = listenZeilen(A).length;
    const mn = Math.min(Math.max(n, 1), MS.meldung.min), minH = 12 + mn * z + (n > mn ? z : 0);
    // Reihenfolge der Zugeständnisse: erst die Legende auf zwei Zeilen verdichten (sie bleibt in jeder Lage sichtbar), dann den Sprunghinweis auf eine Zeile
    const stufen = [{ kompakt: false, grundZ: o.grundZ }, { kompakt: true, grundZ: o.grundZ }, { kompakt: 'eins', grundZ: o.grundZ }, { kompakt: 'eins', grundZ: Math.min(1, o.grundZ) }];
    const freiBei = (st) => o.unten - o.y - (o.sprungBasis + st.grundZ * 10) - (legendeZeilen(o.rw, st.kompakt) * 12 + 4) - 4;
    const wunsch = 12 + Math.min(n, MS.meldung.max) * z + (n > MS.meldung.max ? z : 0);   // SUND-02a C: erst die Stufe, in der die Liste ihre Wunschhöhe (bis max Zeilen) bekommt, sonst die erste, die das Minimum hält
    let wahl = stufen.find((st) => freiBei(st) >= wunsch), passt = true;
    if (!wahl) { wahl = stufen.find((st) => freiBei(st) >= minH); if (!wahl) { wahl = stufen[stufen.length - 1]; passt = false; } }
    const frei = freiBei(wahl);
    const avail = Math.max(1, Math.floor((frei - 12) / z)), want = Math.min(n, MS.meldung.max);
    return { maxZeilen: want + (n > want ? 1 : 0) <= avail ? want : Math.max(1, avail - 1), grundZ: wahl.grundZ, kompakt: wahl.kompakt, legZ: legendeZeilen(o.rw, wahl.kompakt), frei, passt };
  }
  // Zeilen des Sprunghinweises in der Spalte: bekannte Serverhinweise in einer Zeile (TEXT.sprungHinweis), alle anderen höchstens zwei Zeilen. wrap(text) -> Zeilen
  function sprungHinweis(text, wrap) {
    const k = T.TEXT.sprungHinweis[text];
    return k ? [k] : wrap(text).slice(0, 2);
  }
  // o: { rx, y, rw, sel, name(h), kurs(q) -> Winkel }; -> y unter der Liste
  function meldeliste(ctx, A, o) {
    const MS = M.spalte;
    let y = o.y;
    txt(ctx, T.vorlage('meldeliste.kopf', { vz: A.vz }), o.rx, y, { color: F.meldeliste.kopf }); y += 12;
    const zeilen = listenZeilen(A), max = Math.max(1, Math.min(MS.meldung.max, o.maxZeilen || MS.meldung.max));
    zeilen.slice(0, max).forEach((z) => {
      const q = z.q, sel = (z.ereignis ? z.ereignis.h : q.h) === o.sel, neu = !z.ereignis && q.f !== 'r' && A.neu.has(q.h) && q.stufe !== 'alt';
      if (sel) { ctx.fillStyle = F.meldeliste.gewaehlt; ctx.fillRect(o.rx - 2, y - 2, o.rw + 2, 12); ctx.fillStyle = F.meldeliste.gewaehltKante; ctx.fillRect(o.rx - 2, y - 2, 2, 12); }
      else if (neu) { ctx.fillStyle = F.meldeliste.neu; ctx.fillRect(o.rx - 2, y - 2, 2, 12); }
      if (!z.ereignis) plakette(ctx, o.rx + MS.meldung.plaketteX + plBreite(q) / 2, y + 3, q, { kurs: o.kurs ? o.kurs(q) : 0 });
      const farbe = z.ereignis ? P.hell : q.stufe === 'alt' ? F.meldeliste.textAlt : neu ? F.meldeliste.textNeu : F.meldeliste.textGesehen;
      const breite = o.rw - MS.meldung.textX;
      let text = zeilenText(z, o);
      if (tw(text) > breite) {   // schmale Spalte: Kurzform (volle Namen, dann Kurznamen), zuletzt nur der Ort (die Plakette trägt Phase, Stärke und Alter; Ereigniszeilen behalten ihr Verb)
        text = [zeilenText(z, o, 1), zeilenText(z, o, 2), zeilenText(z, o, 3)].find((t) => tw(t) <= breite) || (z.ereignis ? zeilenText(z, o, 2) : o.name(q.h));
      }
      txt(ctx, kurzText(text, breite), o.rx + MS.meldung.textX, y, { color: farbe });
      y += MS.meldung.zeile;
    });
    if (zeilen.length > max) { txt(ctx, T.vorlage('meldeliste.mehr', { n: zeilen.length - max }), o.rx + MS.meldung.textX, y, { color: F.meldeliste.mehr }); y += MS.meldung.zeile; }
    if (!zeilen.length) { txt(ctx, T.TEXT.meldeliste.leer, o.rx, y, { color: P.grau }); y += MS.meldung.zeile; }
    return { y, zeilen: zeilen.length };
  }
  // Legende: Einträge laufen nach der Breite w in Zeilen à 12 px (breit 3 Zeilen, in der schmalen Pult-Spalte bis zu 4). legendeZeilen(w) = Zahl der Zeilen.
  function legendeEintraege(eng, kompakt) {
    const L = T.TEXT.legende, g = P.grau;
    // kompakt (SUND-01 G): zwei Zeilen, nur Wissensstufen (Plaketten ohne Phasenfeld), Front, Sicht und dunkel; die Phasenfelder erklärt die Plakette selbst
    const pl = (q, text, ohne) => { const b = ohne ? M.plakette.breiteOhnePhase : plBreite(q); return { b, text, zeichne: (ctx, x, y) => { plakette(ctx, x + b / 2, y + 4, q, { ohnePhase: !!ohne }); txt(ctx, text, x + b + 3, y, { color: g }); }, breite: b + 3 + tw(text) }; };
    const feld = (t, bg, pfeil, text) => ({ breite: 9 + 3 + tw(text), zeichne: (ctx, x, y) => {
      ctx.fillStyle = P.tisch; ctx.fillRect(x - 1, y - 1, 10, 9); ctx.fillStyle = bg; ctx.fillRect(x, y, 8, 7);
      if (pfeil) { ctx.fillStyle = P.tisch; ctx.beginPath(); ctx.moveTo(x + 6.5, y + 3.5); ctx.lineTo(x + 2, y + 1); ctx.lineTo(x + 2, y + 6); ctx.closePath(); ctx.fill(); }
      else txt(ctx, t, x + 4, y, { color: P.tisch, align: 'center', shadow: false });
      txt(ctx, text, x + 12, y, { color: g });
    } });
    const bk = kompakt ? 3 : 4, sl = kompakt ? 12 : 18;   // Bake: Segmente, Eislinie: Länge
    return [
      pl({ f: 'r', k: 2, p: 'h', a: 0, stufe: 'jetzt' }, L.jetzt, kompakt), pl({ f: 'g', k: 2, p: 'h', a: 1, stufe: 'gesehen' }, L.gesehen, kompakt), pl({ f: 'g', k: 2, p: 'h', a: 7, stufe: 'alt' }, L.alt, kompakt),
      ...(kompakt ? [] : [feld('S', P.warn, false, 'sammelt'), feld('', F.fraktion.g.haltung, true, 'Kurs'), feld('B', F.phase.b.bg, false, 'belagert')]),
      { breite: bk * 4 + 3 + tw(L.front), zeichne: (ctx, x, y) => { for (let i = 0; i < bk; i++) { ctx.fillStyle = i % 2 ? P.rot : P.hell; ctx.fillRect(x + i * 4, y + 2, 4, 4); } txt(ctx, L.front, x + bk * 4 + 3, y, { color: g }); } },
      { breite: sl + 3 + tw(L.sicht), zeichne: (ctx, x, y) => { ctx.fillStyle = P.tisch; ctx.fillRect(x, y + 1, sl, 4); ctx.fillStyle = P.eis; ctx.fillRect(x, y + 2, sl, 2); txt(ctx, L.sicht, x + sl + 3, y, { color: g }); } },
      { breite: (eng ? 14 : 16) + 3 + tw(eng ? L.dunkelKurz : L.dunkel), zeichne: (ctx, x, y) => {
        // SUND-01 F: Feld halb hell (Muster), halb dunkel, mit Rand: der Vergleich macht „dunkel“ lesbar
        const bw = eng ? 14 : 16, hb = bw / 2;
        ctx.save(); ctx.fillStyle = F.fraktion.g.flaeche; ctx.fillRect(x, y, bw, 8);
        const hp = musterPat(ctx, 'ger', 'hell'); if (hp) { ctx.fillStyle = hp; ctx.fillRect(x, y, hb, 8); }
        ctx.fillStyle = F.dunkel.abdunklung; ctx.fillRect(x + hb, y, bw - hb, 8);
        const kp = kornPat(ctx); if (kp) { ctx.fillStyle = kp; ctx.fillRect(x + hb, y, bw - hb, 8); }
        const mp = musterPat(ctx, 'ger', 'dunkel'); if (mp) { ctx.fillStyle = mp; ctx.fillRect(x + hb, y, bw - hb, 8); }
        ctx.strokeStyle = P.grau; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, 7);
        ctx.restore(); txt(ctx, eng ? L.dunkelKurz : L.dunkel, x + bw + 3, y, { color: g });
      } },
    ];
  }
  function legendeLayout(w, kompakt) {
    const out = [], eng = w < 190 || !!kompakt, gap = kompakt ? 4 : eng ? 6 : 8;   // schmale Spalte (Pult, 144 px): kurzer Text, Abstand 6 (SUND-01 F: bei 2 klebte der Text an der nächsten Plakette), vier bis fünf Zeilen
    let x = 0, zeile = 0;
    for (const e of legendeEintraege(eng, kompakt).slice(0, kompakt === 'eins' ? 3 : 99)) {   // SUND-02a C: 'eins' = nur die drei Wissensstufen (je Plakette ohne Phasenfeld) in einer Zeile
      if (x > 0 && x + e.breite > w) { zeile++; x = 0; }
      out.push({ e, x, zeile }); x += e.breite + gap;
    }
    return { eintraege: out, zeilen: out.length ? out[out.length - 1].zeile + 1 : 0 };
  }
  const legendeZeilen = (w, kompakt) => legendeLayout(w, kompakt).zeilen;
  function legende(ctx, x, y, w, kompakt) {
    const lay = legendeLayout(w || 196, kompakt);
    for (const it of lay.eintraege) it.e.zeichne(ctx, x + it.x, y + it.zeile * 12);
    return y + lay.zeilen * 12;
  }

  // ------------------------------------------------------------------ Lagefunk (Funk-Reiter)
  const funk = [];
  const FUNK_MAX = 4;
  function funkMerken(ev) {
    if (!ev || typeof ev.text !== 'string') return;
    funk.unshift({ von: String(ev.from || ''), text: ev.text, t: Number.isFinite(ev.tick) ? ev.tick : null });
    if (funk.length > FUNK_MAX) funk.length = FUNK_MAX;
  }
  const funkListe = () => funk.slice();
  const funkLeeren = () => { funk.length = 0; };

  return { env, T, F, M, hexPfad, mix, lesen, belagert, hatPlakette, rang, rangVergleich, flaeche, seite, sichtgrenze, front, frontSeiten, belagerungKlasse, plakette, kurzplakette, plBreite, posten, flotten,
    fokusHexe, abstaende, winkelHex, kurzname, kartenFraktion, ortsinfo, listenZeilen, zeilenText, meldeliste, spaltenPlan, sprungHinweis, legende, legendeZeilen, funkMerken, funkListe, funkLeeren, kurzText };
});
