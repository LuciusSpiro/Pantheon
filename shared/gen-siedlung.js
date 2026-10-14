(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GenSiedlung = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Prozedurale Siedlungsgrammatik (Kai, 2026-10-10): Rahmen (Tor, Landefeld, Mauer nur beim Militärlager) -> Straßennetz
  // (Rom: Raster, Germanen: Hauptachse mit Abzweigen) -> Parzellen entlang der Straßen -> Gebäude (Funktionsgebäude betretbar,
  // Rest Kulisse) -> Leitstücke und Deckungsobjekte. Die Gebäudezahl bestimmt die Größe. Ausgabe als echte Karte (karteRoh)
  // für Buehne.ausRaster; bauen/kennzahlen bleiben für das ASCII-Werkzeug tools/proto-siedlung.js.
  function erzeuger(FW, FH) {
    FW = FW || 130; FH = FH || 90;
    function rng(seed) {
      let a = seed >>> 0;
      const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      return { f, int: (n) => Math.floor(f() * n), range: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)), shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; } };
    }
    const cheb = (a, b) => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // variante 'methalle' (EK5): Militärsiedlung mit geschlossener Mauer (kein Tor), Landefeld mit dem einzigen Abholpunkt AUSSERHALB der
    // Mauer und ein Schleichweg (Rohr, Zeichen 'r') unter der Mauer; Baracken (mindestens zwei Quartiere) für den Nachschub.
    function bauenEinmal(seed, N, bauweise, typ, skala, variante) {
      const R = rng(seed);
      const methalle = variante === 'methalle';
      const eisenwald = variante === 'eisenwald';   // EK6: Feldzeichen (Flaggenpunkt) in der Platzmitte statt der Statue
      const mauer = typ === 'militaer' || methalle;
      const A = (N * 170 + 500) * skala;
      const sw = clamp(Math.round(Math.sqrt(A * 1.8)), 50, FW - 8), sh = clamp(Math.round(sw / 1.8), 34, FH - 8);
      const S = { x0: Math.floor((FW - sw) / 2), y0: Math.floor((FH - sh) / 2) };
      S.x1 = S.x0 + sw - 1; S.y1 = S.y0 + sh - 1;
      const m = 1;
      const I = { x0: S.x0 + m, y0: S.y0 + m, x1: S.x1 - m, y1: S.y1 - m };
      const cy = Math.floor((I.y0 + I.y1) / 2);
      const grid = Array.from({ length: FH }, () => Array(FW).fill(':'));
      const fill = (r, c) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (grid[y] && grid[y][x] !== undefined) grid[y][x] = c; };
      const hindernis = [];   // alles, was Gebäude meiden
      let LF = { x0: I.x1 - 14, x1: I.x1, y0: cy - 5, y1: cy + 4 };
      const Smax = LF.x0 - 2;
      hindernis.push({ rect: LF, art: 'landefeld' });
      const strassen = [];
      const strasse = (r, name) => { strassen.push({ rect: r, name }); hindernis.push({ rect: r, art: 'strasse' }); };
      const hs = { x0: I.x0, x1: LF.x0 - 1, y0: cy - 3, y1: cy + 2 };
      strasse(hs, 'haupt');
      // Platz
      const cx = I.x0 + Math.floor((Smax - I.x0) * (bauweise === 'rom' ? 0.5 : 0.45));
      const platz = bauweise === 'rom' ? { x0: cx - 8, x1: cx + 7, y0: cy - 6, y1: cy + 5 } : { x0: cx - 7, x1: cx + 6, y0: cy - 6, y1: cy + 5 };
      hindernis.push({ rect: platz, art: 'platz' });
      if (bauweise === 'rom') {
        strasse({ x0: cx - 2, x1: cx + 2, y0: I.y0, y1: I.y1 }, 'cardo');
        for (const sgn of [-1, 1]) { const yy = cy + sgn * 21; if (yy - 2 >= I.y0 + 3 && yy + 2 <= I.y1 - 3) strasse({ x0: I.x0, x1: Smax, y0: yy - 2, y1: yy + 1 }, 'quer'); }
        for (const sgn of [-1, 1]) { const xx = cx + sgn * 22; if (xx - 2 >= I.x0 + 6 && xx + 2 <= Smax - 4) strasse({ x0: xx - 2, x1: xx + 1, y0: I.y0, y1: I.y1 }, 'quer'); }
      } else {
        const k = clamp(Math.round(N / 3), 3, 8);
        const pos = [];
        for (let t = 0; t < 60 && pos.length < k; t++) {
          const x = R.range(I.x0 + 8, Smax - 6);
          if (Math.abs(x - cx) < 12 || pos.some((p) => Math.abs(p - x) < 13)) continue;
          pos.push(x);
        }
        for (const x of pos) for (const up of [true, false]) {
          if (R.f() < 0.25) continue;
          const len = R.range(12, 26);
          const r = up ? { x0: x, x1: x + 3, y1: hs.y0 - 1, y0: Math.max(I.y0, hs.y0 - len) } : { x0: x, x1: x + 3, y0: hs.y1 + 1, y1: Math.min(I.y1, hs.y1 + len) };
          if (r.y1 - r.y0 >= 8) strasse(r, 'abzweig');
        }
      }
      // Leitstücke am Platzrand (Generator 3×3, Antenne 2×2)
      const leit = [];
      const ecken = R.shuffle([[platz.x0 - 5, platz.y0 - 2], [platz.x1 + 3, platz.y0 - 2], [platz.x0 - 5, platz.y1 + 0], [platz.x1 + 3, platz.y1 + 0]]);
      const frei = (r, ausser) => r.x0 >= I.x0 && r.y0 >= I.y0 && r.x1 <= Smax && r.y1 <= I.y1 && hindernis.every((h) => h === ausser || cheb(r, h.rect) >= 2);
      const setzLeit = (c, w, h, art) => { for (const [ex, ey] of ecken) { const r = { x0: ex, y0: ey, x1: ex + w - 1, y1: ey + h - 1 }; if (frei(r)) { hindernis.push({ rect: r, art }); leit.push({ rect: r, c }); ecken.splice(ecken.findIndex((e) => e[0] === ex && e[1] === ey), 1); return; } } };
      setzLeit('Y', 3, 3, 'leit'); setzLeit('A', 2, 2, 'leit');
      // Parzellen: Cursor an allen Straßen- und Platzseiten
      const seiten = [];
      const lang = (r) => (r.x1 - r.x0) > (r.y1 - r.y0);
      for (const s of strassen) { if (lang(s.rect)) { seiten.push({ r: s.rect, side: 'n' }, { r: s.rect, side: 's' }); } else { seiten.push({ r: s.rect, side: 'w' }, { r: s.rect, side: 'e' }); } }
      for (const side of ['n', 's', 'w', 'e']) seiten.push({ r: platz, side, platz: true });
      for (const c of seiten) { const hz = c.side === 'n' || c.side === 's'; c.pos = (hz ? c.r.x0 : c.r.y0) + (c.platz ? 0 : R.range(1, 6)); c.end = hz ? c.r.x1 : c.r.y1; c.aktiv = true; }
      const gebaeude = [];
      const spannen = new Map(strassen.map((q) => [q.rect, []]));
      const gRect = (c, w, d) => {
        const r = c.r;
        if (c.side === 'n') return { x0: c.pos, x1: c.pos + w - 1, y1: r.y0 - 2, y0: r.y0 - 1 - d };
        if (c.side === 's') return { x0: c.pos, x1: c.pos + w - 1, y0: r.y1 + 2, y1: r.y1 + 1 + d };
        if (c.side === 'w') return { y0: c.pos, y1: c.pos + w - 1, x1: r.x0 - 2, x0: r.x0 - 1 - d };
        return { y0: c.pos, y1: c.pos + w - 1, x0: r.x1 + 2, x1: r.x1 + 1 + d };
      };
      let guard = 0;
      while (gebaeude.length < N && guard++ < 4000) {
        const akt = seiten.filter((c) => c.aktiv);
        if (!akt.length) break;
        // vom Platz nach außen wachsen: nächster freier Frontabschnitt zuerst (mit etwas Zufall)
        const pmx = (platz.x0 + platz.x1) / 2, pmy = (platz.y0 + platz.y1) / 2;
        const nah = (c) => { const hz = c.side === 'n' || c.side === 's'; const px = hz ? c.pos : (c.r.x0 + c.r.x1) / 2, py = hz ? (c.r.y0 + c.r.y1) / 2 : c.pos; return Math.abs(px - pmx) + Math.abs(py - pmy) + R.range(0, 8); };
        const c = akt.map((q) => ({ q, d: nah(q) })).sort((a, b) => a.d - b.d)[0].q;
        let ok = false;
        for (let v = 0; v < 3 && !ok; v++) {
          const w = R.range(v ? 6 : 7, v ? 9 : 13), d = R.range(v ? 6 : 6, v ? 8 : 9);
          const r = gRect(c, w, d);
          const hz = c.side === 'n' || c.side === 's';
          if ((hz ? r.x1 : r.y1) > c.end + 2) { c.aktiv = false; break; }
          if (frei(r) && gebaeude.every((g) => cheb(r, g.rect) >= 2)) {
            gebaeude.push({ rect: r, side: c.side, w, d, typ: 'k' });
            if (spannen.has(c.r)) spannen.get(c.r).push(hz ? [r.x0, r.x1] : [r.y0, r.y1]);
            c.pos = (hz ? r.x1 : r.y1) + R.range(2, 4); ok = true;
          }
        }
        if (!ok && c.aktiv) { c.pos += 3; if (c.pos > c.end) c.aktiv = false; }
        if (gebaeude.length >= N) break;
      }
      // Zweite Reihe: Hinterhäuser mit 2 breiter Gasse zur nächsten Straße oder zum Platz
      const gassen = [];
      const quellen = strassen.map((q) => q.rect).concat([platz]);
      const Z = {};
      const nein = (k) => { Z[k] = (Z[k] || 0) + 1; };
      for (let t = 0; t < 3000 && gebaeude.length < N; t++) {
        const w = R.range(6, 10), d = R.range(6, 9);
        const x0 = R.range(I.x0, Math.max(I.x0, Smax - w)), y0 = R.range(I.y0, Math.max(I.y0, I.y1 - d));
        const r = { x0, y0, x1: x0 + w - 1, y1: y0 + d - 1 };
        if (!frei(r) || !gebaeude.every((g) => cheb(r, g.rect) >= 2) || !gassen.every((g) => cheb(r, g) >= 1)) { nein('platz'); continue; }
        let best = null;
        for (const q of quellen) { const dd = cheb(r, q); if (!best || dd < best.dd) best = { q, dd }; }
        if (best.dd > 14) { nein('weit'); continue; }
        const q = best.q, mx = Math.floor((r.x0 + r.x1) / 2), my = Math.floor((r.y0 + r.y1) / 2);
        const dx = Math.max(q.x0 - r.x1, r.x0 - q.x1), dy = Math.max(q.y0 - r.y1, r.y0 - q.y1);
        let side, gasse, span;
        if (dy >= dx) {
          if (q.x0 > mx || q.x1 < mx + 1) { nein('v-seite'); continue; }
          if (q.y1 < r.y0) { side = 's'; gasse = { x0: mx, x1: mx + 1, y0: q.y1 + 1, y1: r.y0 - 1 }; }
          else if (q.y0 > r.y1) { side = 'n'; gasse = { x0: mx, x1: mx + 1, y0: r.y1 + 1, y1: q.y0 - 1 }; }
          else { nein('v-lage'); continue; }
          span = [gasse.x0, gasse.x1];
        } else {
          if (q.y0 > my || q.y1 < my + 1) { nein('h-seite'); continue; }
          if (q.x1 < r.x0) { side = 'e'; gasse = { x0: q.x1 + 1, x1: r.x0 - 1, y0: my, y1: my + 1 }; }
          else if (q.x0 > r.x1) { side = 'w'; gasse = { x0: r.x1 + 1, x1: q.x0 - 1, y0: my, y1: my + 1 }; }
          else { nein('h-lage'); continue; }
          span = [gasse.y0, gasse.y1];
        }
        if (gasse.x1 < gasse.x0 || gasse.y1 < gasse.y0) continue;
        if (gebaeude.some((g) => cheb(gasse, g.rect) < 1) || hindernis.some((h) => h.rect !== q && cheb(gasse, h.rect) < 1)) { nein('gasse-blockiert'); continue; }
        nein('OK');
        gebaeude.push({ rect: r, side, w, d, typ: 'k', hinterhaus: true });
        gassen.push(gasse); hindernis.push({ rect: gasse, art: 'gasse' });
        if (spannen.has(q)) spannen.get(q).push(span);
      }
      // Straßen kürzen: nur so weit, wie Häuser und Gassen daran hängen (+4), solange das Netz verbunden bleibt
      const verbunden = (rects) => { const seen = new Set([0]); const stk = [0]; while (stk.length) { const i = stk.pop(); rects.forEach((q, j) => { if (!seen.has(j) && cheb(rects[i], q) <= 1) { seen.add(j); stk.push(j); } }); } return seen.size === rects.length; };
      const netz = () => strassen.map((q) => q.rect).concat([platz, LF]);
      for (const st of strassen.slice()) {
        const sp = spannen.get(st.rect) || [];
        if (!sp.length) {
          if (st.name === 'haupt') continue;
          const i = strassen.indexOf(st); strassen.splice(i, 1);
          if (!verbunden(netz())) strassen.splice(i, 0, st); else { const hi = hindernis.findIndex((h) => h.rect === st.rect); if (hi >= 0) hindernis.splice(hi, 1); }
          continue;
        }
        const hz = lang(st.rect), lo = Math.min(...sp.map((v) => v[0])) - 4, hi = Math.max(...sp.map((v) => v[1])) + 4;
        const alt = { ...st.rect };
        if (hz) { st.rect.x0 = Math.max(st.rect.x0, lo); if (st.name !== 'haupt') st.rect.x1 = Math.min(st.rect.x1, hi); }
        else { st.rect.y0 = Math.max(st.rect.y0, lo); st.rect.y1 = Math.min(st.rect.y1, hi); }
        if (!verbunden(netz())) Object.assign(st.rect, alt);
      }
      // endgültige Fläche: Umriss aller Inhalte plus Rand (Mauer: 4, sonst 3)
      {
        const teile = strassen.map((q) => q.rect).concat(methalle ? [platz] : [platz, LF], leit.map((l) => l.rect), gebaeude.map((g) => g.rect), gassen);   // Methalle: Landefeld liegt außerhalb der Mauer
        const mg = mauer ? 4 : 3;
        S.x0 = Math.max(1, Math.min(...teile.map((q) => q.x0)) - mg); S.y0 = Math.max(1, Math.min(...teile.map((q) => q.y0)) - mg);
        S.x1 = Math.min(FW - 2, Math.max(...teile.map((q) => q.x1)) + mg); S.y1 = Math.min(FH - 2, Math.max(...teile.map((q) => q.y1)) + mg);
        fill(S, '.');
        for (const g of gassen) fill(g, '-');
      }
      // Funktionsgebäude: Kommando am Platz, Lager nahe Landefeld, Werkstatt, Quartiere
      const pm = { x: (platz.x0 + platz.x1) / 2, y: (platz.y0 + platz.y1) / 2 };
      const mitte = (g) => ({ x: (g.rect.x0 + g.rect.x1) / 2, y: (g.rect.y0 + g.rect.y1) / 2 });
      const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const F = Math.min(gebaeude.length, Math.max(methalle ? 5 : 3, Math.round(N * (methalle ? 0.5 : 0.35))));
      const frei2 = gebaeude.slice();
      const nimm = (cmp, typBuch) => { if (!frei2.length) return; frei2.sort(cmp); const g = frei2.shift(); g.typ = typBuch; };
      const lfm = { x: (LF.x0 + LF.x1) / 2, y: (LF.y0 + LF.y1) / 2 };
      nimm((a, b) => dist(mitte(a), pm) - dist(mitte(b), pm), 'K');
      nimm((a, b) => dist(mitte(a), lfm) - dist(mitte(b), lfm), 'L');
      // Methalle: Baracken (Q) garantiert mindestens zwei, dazu Werkstatt und Kantine (die Reihenfolge ist fest, nur die Gebäude wechseln)
      const rest = methalle ? ['Q', 'Q', 'W', 'C', 'H', 'Q', 'L'] : R.shuffle(['W', 'Q', 'Q', 'C', 'H', 'L']);
      for (let i = 2; i < F; i++) nimm(() => R.f() - 0.5, rest[(i - 2) % rest.length]);
      // Zeichnen
      for (const s of strassen) fill(s.rect, '=');
      fill(platz, '+');
      if (!eisenwald) fill({ x0: cx - 2, x1: cx, y0: cy - 2, y1: cy }, 'm');   // Sockel der Statue: deckt sich mit Shared_Buehne.leitFuss (Platzmitte, 3×3), sonst bleibt Deckungsoptik daneben stehen
      for (const l of leit) fill(l.rect, l.c);
      if (!methalle) { fill(LF, ','); grid[cy][Math.floor((LF.x0 + LF.x1) / 2)] = 'P'; }
      for (const g of gebaeude) {
        const r = g.rect;
        fill(r, '#');
        if (g.typ !== 'k') fill({ x0: r.x0 + 1, y0: r.y0 + 1, x1: r.x1 - 1, y1: r.y1 - 1 }, g.typ);
        // Tür an der Straßenseite, 2 breit, Mitte
        const mx = Math.floor((r.x0 + r.x1) / 2), my = Math.floor((r.y0 + r.y1) / 2);
        const tur = g.side === 'n' ? [[mx, r.y1], [mx + 1, r.y1]] : g.side === 's' ? [[mx, r.y0], [mx + 1, r.y0]] : g.side === 'w' ? [[r.x1, my], [r.x1, my + 1]] : [[r.x0, my], [r.x0, my + 1]];
        g.tueren = tur;
        for (const [x, y] of tur) grid[y][x] = g.typ === 'k' ? 'x' : 'D';
      }
      // Mauer (1 Kachel), Tor, Türme
      if (mauer) {
        for (let x = S.x0; x <= S.x1; x++) { grid[S.y0][x] = 'M'; grid[S.y1][x] = 'M'; }
        for (let y = S.y0; y <= S.y1; y++) { grid[y][S.x0] = 'M'; grid[y][S.x1] = 'M'; }
        if (!methalle) for (let y = cy - 2; y <= cy + 1; y++) grid[y][S.x0] = 'g';
        for (const [ex, ey] of [[S.x0, S.y0], [S.x1 - 2, S.y0], [S.x0, S.y1 - 2], [S.x1 - 2, S.y1 - 2]]) fill({ x0: ex, y0: ey, x1: ex + 2, y1: ey + 2 }, 'T');
      }
      // Methalle: Rohr unter der Mauer und Landefeld davor. Das Rohr (drei 'r': Mund außen, Mauerkachel, Mund innen) liegt an einer
      // Mauerseite, auf der das Landefeld Platz hat (Seite und Lage aus dem Seed); der innere Mund steht auf freiem Boden am Mauerstreifen.
      let rohr = null;
      if (methalle) {
        const bem = (x, y) => grid[y] && grid[y][x];
        const seiten = R.shuffle([{ k: 'O', d: [1, 0] }, { k: 'W', d: [-1, 0] }, { k: 'S', d: [0, 1] }, { k: 'N', d: [0, -1] }]);
        for (const sd of seiten) {
          const hz = sd.d[0] !== 0;   // Mauer senkrecht (O/W): Rohr liegt waagerecht
          const lo = (hz ? S.y0 : S.x0) + 6, hi = (hz ? S.y1 : S.x1) - 6;
          const pos = []; for (let t = lo; t <= hi; t++) pos.push(t);
          R.shuffle(pos);
          for (const t of pos) {
            const wx = hz ? (sd.d[0] > 0 ? S.x1 : S.x0) : t, wy = hz ? t : (sd.d[1] > 0 ? S.y1 : S.y0);
            const ix = wx - sd.d[0], iy = wy - sd.d[1], ox = wx + sd.d[0], oy = wy + sd.d[1];
            // innerer Mund und seine Nachbarn entlang der Mauer frei, Außenmund auf Außenboden
            const nb = hz ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
            if (bem(ix, iy) !== '.' || nb.some(([dx, dy]) => bem(ix + dx, iy + dy) !== '.') || bem(ox, oy) !== ':') continue;
            // Landefeld 15×10 an der Außenseite, 3 Kacheln hinter dem Außenmund, mittig zur Rohrachse
            const lw = hz ? 15 : 10, lh = hz ? 10 : 15;
            const l = hz ? { x0: sd.d[0] > 0 ? S.x1 + 4 : S.x0 - 4 - 14, y0: wy - 4, x1: 0, y1: 0 } : { x0: wx - 4, y0: sd.d[1] > 0 ? S.y1 + 4 : S.y0 - 4 - 14, x1: 0, y1: 0 };
            l.x1 = l.x0 + lw - 1; l.y1 = l.y0 + lh - 1;
            if (l.x0 < 2 || l.y0 < 2 || l.x1 > FW - 3 || l.y1 > FH - 3) continue;
            rohr = { side: sd.k, d: sd.d, kacheln: [[ox, oy], [wx, wy], [ix, iy]], aussen: [ox, oy], innen: [ix, iy] };
            LF = l;
            break;
          }
          if (rohr) break;
        }
        if (!rohr) throw new Error('methalle: kein Platz für Landefeld und Rohr');
        for (const [x, y] of rohr.kacheln) grid[y][x] = 'r';
        fill(LF, ',');
        const lmx = Math.floor((LF.x0 + LF.x1) / 2), lmy = Math.floor((LF.y0 + LF.y1) / 2);
        grid[lmy][lmx] = 'P';
      }
      // Deckung: weltliche Objekte, Platz-Ring, Straßenränder (selten), Landefeld
      const setze = (x, y, w) => { for (let i = 0; i < w; i++) if (grid[y] && (grid[y][x + i] === '=' || grid[y][x + i] === '+' || grid[y][x + i] === ',')) grid[y][x + i] = 'o'; };
      for (const [dx, dy] of [[-6, -4], [4, -4], [-6, 3], [4, 3], [-1, -5], [-1, 4]]) setze(cx + dx, cy + dy, 2);
      let deck = 0;
      for (const s of strassen) {
        const r = s.rect, hz = lang(r);
        for (let p = (hz ? r.x0 : r.y0) + 8; p < (hz ? r.x1 : r.y1) - 8; p += R.range(9, 15)) {
          if (R.f() < 0.55) continue;
          const nahPlatz = hz ? (p > platz.x0 - 4 && p < platz.x1 + 4) : (p > platz.y0 - 4 && p < platz.y1 + 4);
          if (nahPlatz) continue;
          if (hz) setze(p, R.f() < 0.5 ? r.y0 : r.y1, 2); else setze(R.f() < 0.5 ? r.x0 : r.x1, p, 1);
          deck++;
        }
      }
      setze(LF.x0 + 1, LF.y0, 2); setze(LF.x1 - 2, LF.y1, 2);
      // Streuobjekte sind Deckung (Kai 2026-10-11): was groß genug für Deckung ist, ist Deckung und steht zugleich als Deko herum.
      // Fässer, Werkzeug und Feuerschalen (Kit: Bauweise.deckung_props) stehen an Hauswänden, am Platzring und an Straßenrändern,
      // nie nahe Türen, nie dicht beieinander (Abstand 2), selten als hohe Deckung 'O'.
      {
        const tuerNah = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const c = grid[y + dy] && grid[y + dy][x + dx]; if (c === 'D' || c === 'x' || c === 'g') return true; } return false; };
        const nahDeck = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const c = grid[y + dy] && grid[y + dy][x + dx]; if (c === 'o' || c === 'O' || c === 'm') return true; } return false; };
        const wand8 = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (grid[y + dy] && grid[y + dy][x + dx] === '#') return true; return false; };
        const randStr = (x, y) => strassen.some((st) => { const q = st.rect; return x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1 && (x === q.x0 || x === q.x1 || y === q.y0 || y === q.y1); });
        const ring = (x, y) => x >= platz.x0 && x <= platz.x1 && y >= platz.y0 && y <= platz.y1 && (x <= platz.x0 + 1 || x >= platz.x1 - 1 || y <= platz.y0 + 1 || y >= platz.y1 - 1);
        // Eingänge sitzen an Straßenenden und -mitten (siehe karteRoh): dort 4 Kacheln frei halten
        const schutz = [];
        for (const st of strassen) { const q = st.rect, mx = Math.floor((q.x0 + q.x1) / 2), my = Math.floor((q.y0 + q.y1) / 2); schutz.push([mx, q.y0], [mx, q.y1], [q.x0, my], [q.x1, my]); }
        schutz.push([S.x0, cy], [strassen[0].rect.x0, cy]);
        const imSchutz = (x, y) => schutz.some(([sx, sy]) => Math.max(Math.abs(sx - x), Math.abs(sy - y)) <= 4);
        const fest = (x, y) => { const c = grid[y] && grid[y][x]; return c === undefined || '#oOmzMTk^x'.includes(c); };
        const engpass = (x, y) => (fest(x - 1, y) && fest(x + 1, y)) || (fest(x, y - 1) && fest(x, y + 1));   // verschließt keine schmale Gasse
        const kand = [];
        for (let y = S.y0 + 2; y <= S.y1 - 2; y++) for (let x = S.x0 + 2; x <= S.x1 - 2; x++) {
          if (imSchutz(x, y)) continue;
          const c = grid[y][x];
          if ((c === '.' && wand8(x, y)) || (c === '=' && randStr(x, y)) || (c === '+' && ring(x, y)) || (c === ',' && (x === LF.x0 || y === LF.y0 || y === LF.y1))) kand.push([x, y]);
        }
        R.shuffle(kand);
        const ziel = Math.round(N * 3.2);
        let n = 0;
        for (const [x, y] of kand) {
          if (n >= ziel) break;
          if (tuerNah(x, y) || nahDeck(x, y) || engpass(x, y)) continue;
          const c = R.f() < 0.78 ? 'o' : 'O';
          grid[y][x] = c; n++;
          // knapp die Hälfte als Paar (Gruppe statt Einzelblock, K-DECKUNG-DICHT)
          const nx = x + 1;
          if (R.f() < 0.5 && '.=+,'.includes(grid[y][nx]) && !imSchutz(nx, y) && !tuerNah(nx, y) && !engpass(nx, y)) { grid[y][nx] = c; n++; }
        }
        deck += n;
      }
      return { skala, grid, S, I, cy, gebaeude, strassen, platz, LF, mauer, N, deck, R, bauweise, typ, sw: S.x1 - S.x0 + 1, sh: S.y1 - S.y0 + 1, start: [hs.x0, cy], methalle, rohr, eisenwald };
    }

    // wächst, bis die Zielzahl an Gebäuden steht (oder das Feld voll ist)
    function bauen(seed, N, bauweise, typ, variante) {
      let best = null;
      for (let skala = 0.8; skala <= 3.6; skala *= 1.06) {
        let B; try { B = bauenEinmal(seed, N, bauweise, typ, skala, variante); } catch (e) { if (variante === 'methalle' && /^methalle:/.test(String(e.message))) continue; break; }   // Methalle: kein Platz für Landefeld/Rohr -> größere Skala (mehr Feld) bzw. nächster Versuch
        if (!best || B.gebaeude.length > best.gebaeude.length) best = B;
        if (B.gebaeude.length >= N) return B;
        if (B.sw >= FW - 8 && B.sh >= FH - 8) break;
      }
      return best;
    }

    function kennzahlen(B) {
      const { grid, S, gebaeude } = B;
      const passier = (c) => '.=+g,PDKLWQCH-r'.includes(c);
      // Erreichbarkeit vom Tor (Militär) bzw. westlichem Straßenanfang (Handel, Methalle: kein Tor)
      const start = B.mauer && !B.methalle ? [S.x0, B.cy] : B.start;
      const seen = new Set(); const st = [start];
      const key = (x, y) => y * FW + x;
      while (st.length) {
        const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= FW || y >= FH) continue;
        const k = key(x, y); if (seen.has(k)) continue;
        const c = grid[y][x]; if (!(passier(c) || c === ':' && false)) continue;
        if (c !== 'g' && B.mauer && (x < S.x0 || x > S.x1 || y < S.y0 || y > S.y1)) continue;
        seen.add(k);
        st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      const funktion = gebaeude.filter((g) => g.typ !== 'k');
      const erreichbar = funktion.filter((g) => g.tueren.some(([x, y]) => seen.has(key(x, y))) || g.tueren.some(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(key(x + dx, y + dy))))).length;
      let sicht = 0;
      const offen = (c) => c === '=' || c === '+' || c === '.' || c === ',';
      for (let y = S.y0; y <= S.y1; y++) { let run = 0; for (let x = S.x0; x <= S.x1; x++) { run = (grid[y][x] === '=' || grid[y][x] === '+') ? run + 1 : 0; sicht = Math.max(sicht, run); } }
      for (let x = S.x0; x <= S.x1; x++) { let run = 0; for (let y = S.y0; y <= S.y1; y++) { run = (grid[y][x] === '=' || grid[y][x] === '+') ? run + 1 : 0; sicht = Math.max(sicht, run); } }
      let strasse = 0, platz = 0, bebaut = 0, flaeche = 0;
      for (let y = S.y0; y <= S.y1; y++) for (let x = S.x0; x <= S.x1; x++) { flaeche++; const c = grid[y][x]; if (c === '=') strasse++; else if (c === '+') platz++; else if ('#xDKLWQCHYAm'.includes(c)) bebaut++; }
      return { haeuser: gebaeude.length, ziel: B.N, funktion: funktion.length, erreichbar, sicht, flaeche: B.sw * B.sh, breite: B.sw, hoehe: B.sh,
        anteilStrasse: strasse / flaeche, anteilPlatz: platz / flaeche, anteilBebaut: bebaut / flaeche, deckungStrasse: B.deck };
    }



    // ---------------------------------------------------------------- echtes Kartenformat
    // Pflichtsatz der Kartenart aussenposten (der Missionsplaner nimmt an, jede Karte hat mindestens das; aus den Modul-Schablonen)
    const PFLICHT_AUSSENPOSTEN = { eingang: 3, abholpunkt: 2, sprengpunkt: 2, aussicht: 1, terminal: 1, zelle: 2, beute: 4, ziel: 1, wache: 6, patrouille: 4 };
    // Methalle (EK5): ein Abholpunkt, zwei Rohrmünder, ein Sprengziel zum Platzieren, vier Patrouillenwege (≥ 6 Punkte), Baracken-Spawns (≥ 4), keine festen Wachposten
    const PFLICHT_METHALLE = { eingang: 2, abholpunkt: 1, sprengpunkt: 1, aussicht: 1, patrouille: 6, baracke: 4 };
    const GEB_NAME = { K: 'kommando', L: 'lager', W: 'werkstatt', Q: 'quartier', C: 'kantine', H: 'krankenstation' };
    const GEB_TITEL = { K: 'Kommandogebäude', L: 'Lager', W: 'Werkstatt', Q: 'Quartiere', C: 'Kantine', H: 'Krankenstation' };
    // karteRoh(seed, haeuser, opts) -> Karte im Format von Buehne.bauen (Legende/Kanten/Prüfung: Buehne.ausRaster)
    //   opts: { bauweise: 'rom'|'germanen', typ: 'handel'|'militaer', besitz, zustand, id }
    function karteRoh(seed, N, opts) {
      opts = opts || {};
      const bauweise = opts.bauweise || 'germanen', typ = opts.typ || 'handel';
      const B = bauen(seed, N, bauweise, typ, opts.variante), g = B.grid, S = B.S;
      const methalle = !!B.methalle, eisenwald = !!B.eisenwald;
      const PAD = 3;
      // Methalle: Ausschnitt reicht bis über das Landefeld außerhalb der Mauer
      const cr = methalle ? { x0: Math.min(S.x0, B.LF.x0), y0: Math.min(S.y0, B.LF.y0), x1: Math.max(S.x1, B.LF.x1), y1: Math.max(S.y1, B.LF.y1) } : S;
      const x0 = Math.max(0, cr.x0 - PAD), y0 = Math.max(0, cr.y0 - PAD), x1 = Math.min(FW - 1, cr.x1 + PAD), y1 = Math.min(FH - 1, cr.y1 + PAD);
      const w = x1 - x0 + 1, h = y1 - y0 + 1, ox = -x0, oy = -y0;
      // Zeichenabbildung: Straße = Bohlen/Belag 2 (boden2), Platz und Landefeld = pad, Gebäudeinneres = Bohlen, Leitstück-Platzhalter = volle Deckung
      const MAP = { ':': ':', '.': '.', '=': ',', '+': 'P', ',': 'P', P: 'P', '#': '#', x: '#', M: '#', T: '#', g: 'G', D: 'D', o: 'o', '-': ',', m: 'O', Y: 'O', A: 'O', r: 'r' };
      const rows = [];
      for (let y = y0; y <= y1; y++) {
        let r = '';
        for (let x = x0; x <= x1; x++) { const c = g[y][x]; r += MAP[c] || ','; }   // Buchstaben (K L W Q C H) = Gebäudeinneres
        rows.push(r);
      }
      const at = (x, y) => (rows[y] || '')[x];
      const rect = (q) => [q.x0 + ox, q.y0 + oy, q.x1 - q.x0 + 1, q.y1 - q.y0 + 1];
      // Plätze
      const plaetze = {}, zaehl = {};
      const nummer = (n) => { zaehl[n] = (zaehl[n] || 0) + 1; return zaehl[n]; };
      plaetze.landefeld = { typ: 'landeplatz', modul: 'gen-siedlung', lage: { rot: 0, spiegel: false, aussen: null }, rect: rect(B.LF), bereich: 'andock', richtung: 'O', kern: true };
      if (methalle) {   // Rohr: Mund außen, Mauerkachel, Mund innen (ein Platz, Zeichen 'r')
        const rx = B.rohr.kacheln.map((k) => k[0]), ry = B.rohr.kacheln.map((k) => k[1]);
        plaetze.rohr = { typ: 'rohr', modul: 'gen-siedlung', lage: { rot: 0, spiegel: false, aussen: null }, rect: [Math.min(...rx) + ox, Math.min(...ry) + oy, Math.max(...rx) - Math.min(...rx) + 1, Math.max(...ry) - Math.min(...ry) + 1], bereich: 'schleichweg', kern: false };
      }
      plaetze.platz = { typ: 'dorfplatz', modul: 'gen-siedlung', lage: { rot: 0, spiegel: false, aussen: null }, rect: rect(B.platz), bereich: 'strassen', kern: true };
      B.strassen.forEach((s) => { plaetze['strasse_' + nummer('strasse')] = { typ: 'hof', modul: 'gen-siedlung', lage: { rot: 0, spiegel: false, aussen: null }, rect: rect(s.rect), bereich: 'strassen', gefecht: true }; });
      if (B.mauer && !methalle) plaetze.tor = { typ: 'tor', modul: 'gen-siedlung', lage: { rot: 0, spiegel: false, aussen: 'W' }, rect: [S.x0 + ox, B.cy - 2 + oy, 1, 4], bereich: 'strassen', richtung: 'W' };
      const geb = [];
      for (const b of B.gebaeude) {
        let id, tp;
        if (b.typ === 'k') { id = 'haus_' + nummer('haus'); tp = 'kulisse'; }
        else { const n = GEB_NAME[b.typ]; id = ['K'].includes(b.typ) ? n : n + '_' + nummer(n); tp = 'lagerhalle'; }
        plaetze[id] = { typ: tp, modul: 'gen-siedlung', lage: { rot: 0, spiegel: false, aussen: null }, rect: rect(b.rect), bereich: b.typ === 'k' ? 'kulisse' : 'gebaeude', kern: b.typ === 'K' };
        geb.push({ b, id });
      }
      const bereiche = {
        andock: { name: 'Landefeld', rects: [], rolle: 'hinein' },
        strassen: { name: 'Straßen und Platz', rects: [], gefecht: true },
        gebaeude: { name: 'Gebäude', rects: [], rolle: 'ziel' },
        kulisse: { name: 'Kulissenhäuser', rects: [] },
      };
      if (methalle) bereiche.schleichweg = { name: 'Schleichweg (Rohr)', rects: [] };
      for (const id of Object.keys(plaetze).sort()) bereiche[plaetze[id].bereich].rects.push(plaetze[id].rect);
      for (const k of Object.keys(bereiche)) if (!bereiche[k].rects.length) delete bereiche[k];
      // Anker (Pflichtsatz der Kartenart aussenposten: Rollen siehe PFLICHT_AUSSENPOSTEN)
      const R2 = rng(seed * 6271 + 5);
      const roh = [], belegt = new Set();
      const setT = (x, y, c) => { rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1); };
      const nahTuer = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (at(x + dx, y + dy) === 'D') return true; return false; };
      // objekte: Kacheln, die zur Laufzeit fest werden (Kisten, Terminal, Ziel, Sprengziel, Zellenlücke); sie dürfen ein Gebäude nicht zerschneiden
      const objekte = new Set(), kammern = new Set();
      // jedes Objekt im Rechteck braucht mindestens einen begehbaren Nachbarn, der kein Objekt und keine Zellenkammer ist
      const objekteOk = (r) => {
        for (const key of objekte) {
          const [x, y] = key.split(',').map(Number);
          if (x < r[0] || y < r[1] || x >= r[0] + r[2] || y >= r[1] + r[3]) continue;
          if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const c = at(x + dx, y + dy), k = (x + dx) + ',' + (y + dy); return (c === ',' && !objekte.has(k) && !kammern.has(k)); })) return false;
        }
        return true;
      };
      const kachelIn = (r, wohin, objekt) => {
        const [rx, ry, rw, rh] = r, kand = [];
        for (let y = ry + 1; y < ry + rh - 1; y++) for (let x = rx + 1; x < rx + rw - 1; x++) {
          if (at(x, y) !== ',' || belegt.has(x + ',' + y) || nahTuer(x, y)) continue;
          const rand = x === rx + 1 || y === ry + 1 || x === rx + rw - 2 || y === ry + rh - 2;
          if (wohin === 'rand' ? rand : !rand) kand.push([x, y]);
        }
        R2.shuffle(kand);
        for (const k of kand) {
          const key = k[0] + ',' + k[1];
          if (objekt !== false) {
            objekte.add(key);
            if (!objekteOk(r) || !innenZusammen(r)) { objekte.delete(key); continue; }
          }
          belegt.add(key); return k;
        }
        return null;
      };
      const ank = (platz, rolle, p, attr) => { if (p) roh.push(Object.assign({ rolle, x: p[0], y: p[1], platz, bereich: plaetze[platz].bereich }, attr || {})); };
      const mitte = (r) => [r[0] + Math.floor(r[2] / 2), r[1] + Math.floor(r[3] / 2)];
      const dm = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      const lm = mitte(plaetze.landefeld.rect); belegt.add(lm.join(','));
      ank('landefeld', 'abholpunkt', lm, { ankunft: true });
      // Eisenwald (EK6): Flaggenpunkt in der Mitte des Dorfplatzes (Platztyp dorfplatz); Statue und Sockel entfallen, kein Deckungsobjekt dort
      if (eisenwald) { const fm = mitte(plaetze.platz.rect); belegt.add(fm.join(',')); ank('platz', 'flagge', fm); }
      const funk = geb.filter((q) => q.b.typ !== 'k');
      // Kommando: Ziel in der Mitte, Platz dafür vormerken, bevor Kerker und Kisten Fläche belegen
      const kom = funk.find((q) => q.b.typ === 'K');
      if (kom) { const k0 = mitte(plaetze[kom.id].rect).join(','); belegt.add(k0); objekte.add(k0); }
      // Kerker (Rolle zelle): 2×2-Kammer in der Ecke eines Funktionsgebäudes, Wände aus Gebäudewand und '#', Gitter 'z' mit Lücke davor;
      // der Anker steht in der Lücke (Objekt, zur Laufzeit zu/offen). Gebäude müssen danach zusammenhängend begehbar bleiben.
      const drehe = (t) => t[0].split('').map((_, x) => t.map((row) => row[x]).reverse().join(''));
      const pmid = mitte(plaetze.platz.rect);
      const strBegehbar = (x, y) => at(x, y) === ',' || at(x, y) === 'P';
      const ZELLE = [[0, 0, ','], [1, 0, ','], [2, 0, '#'], [0, 1, ','], [1, 1, ','], [2, 1, '#'], [0, 2, 'z'], [1, 2, ','], [2, 2, '#'], [1, 3, ',']];
      const innenZusammen = (r, ohne) => {
        ohne = ohne || new Set();
        const [rx, ry, rw, rh] = r, frei = [];
        for (let y = ry + 1; y < ry + rh - 1; y++) for (let x = rx + 1; x < rx + rw - 1; x++) if (at(x, y) === ',' && !kammern.has(x + ',' + y) && !objekte.has(x + ',' + y) && !ohne.has(x + ',' + y)) frei.push([x, y]);
        const tuer = []; for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) if (at(x, y) === 'D') tuer.push([x, y]);
        if (!tuer.length || !frei.length) return false;
        const seen = new Set(), st = [];
        const key = (x, y) => x + ',' + y, fs = new Set(frei.map((p) => key(p[0], p[1])));
        for (const [x, y] of tuer) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (fs.has(key(x + dx, y + dy))) { seen.add(key(x + dx, y + dy)); st.push([x + dx, y + dy]); }
        while (st.length) { const [x, y] = st.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = key(x + dx, y + dy); if (fs.has(k) && !seen.has(k)) { seen.add(k); st.push([x + dx, y + dy]); } } }
        return seen.size === fs.size;
      };
      const zelleIn = (id) => {
        const r = plaetze[id].rect, [rx, ry, rw, rh] = r;
        const ix0 = rx + 1, iy0 = ry + 1, ix1 = rx + rw - 2, iy1 = ry + rh - 2;
        for (const [ci, tr] of R2.shuffle([0, 1, 2, 3].flatMap((c) => [[c, 0], [c, 1]]))) {
          const pos = ZELLE.map(([u, v, c]) => { const a = tr ? v : u, b = tr ? u : v; return [(ci & 1) ? ix1 - a : ix0 + a, (ci & 2) ? iy1 - b : iy0 + b, c]; });
          if (!pos.every(([x, y]) => x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1 && at(x, y) === ',' && !belegt.has(x + ',' + y) && !nahTuer(x, y))) continue;
          const alt = pos.map(([x, y]) => [x, y, at(x, y)]);
          for (const [x, y, c] of pos.slice(0, 9)) setT(x, y, c);
          const kam = pos.filter((p) => p[2] === ',').slice(0, 4).map((p) => p[0] + ',' + p[1]);
          const gap = pos[7];
          if (!innenZusammen(r, new Set(kam.concat([gap[0] + ',' + gap[1]])))) { for (const [x, y, c] of alt) setT(x, y, c); continue; }
          kam.forEach((k) => kammern.add(k));
          for (const p of pos) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) belegt.add((p[0] + dx) + ',' + (p[1] + dy));
          objekte.add(gap[0] + ',' + gap[1]);
          return [gap[0], gap[1]];
        }
        return null;
      };
      // Rückfall, wenn kein Funktionsgebäude Platz hat: freistehender Käfig (4×4 mit Wand, Gitter und Lücke) auf freiem Gelände am Straßenrand
      const kaefige = [];
      const kaefigFrei = () => {
        let t = ['####', '#,,#', '#,,#', '#zZ#'], best = null;
        for (let rot = 0; rot < 4; rot++, t = drehe(t)) {
          let gp = null; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (t[y][x] === 'Z') gp = [x, y];
          const aus = gp[1] === 3 ? [0, 1] : gp[1] === 0 ? [0, -1] : gp[0] === 3 ? [1, 0] : [-1, 0];
          for (let y0 = 1; y0 < h - 5; y0++) for (let x0 = 1; x0 < w - 5; x0++) {
            let ok = true;
            for (let y = -1; y <= 4 && ok; y++) for (let x = -1; x <= 4 && ok; x++) { const c = at(x0 + x, y0 + y), im = x >= 0 && x < 4 && y >= 0 && y < 4; if (im ? c !== '.' || belegt.has((x0 + x) + ',' + (y0 + y)) : (c === 'D' || c === undefined)) ok = false; }
            if (!ok) continue;
            const oxx = x0 + gp[0] + aus[0], oyy = y0 + gp[1] + aus[1];
            if (!strBegehbar(oxx, oyy)) continue;
            const sc = Math.abs(x0 + 2 - pmid[0]) + Math.abs(y0 + 2 - pmid[1]) + R2.range(0, 10);
            if (!best || sc < best.sc) best = { sc, x0, y0, t, gp };
          }
        }
        if (!best) return null;
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setT(best.x0 + y * 0 + x, best.y0 + y, best.t[y][x] === 'Z' ? ',' : best.t[y][x]);
        for (let y = -1; y <= 4; y++) for (let x = -1; x <= 4; x++) belegt.add((best.x0 + x) + ',' + (best.y0 + y));
        const id = 'kaefig_' + (kaefige.length + 1); kaefige.push(id);
        plaetze[id] = { typ: 'zellenblock', modul: 'gen-siedlung', lage: { rot: 0, spiegel: false, aussen: null }, rect: [best.x0, best.y0, 4, 4], bereich: 'kulisse' };
        bereiche.kulisse = bereiche.kulisse || { name: 'Kulissenhäuser', rects: [] };
        bereiche.kulisse.rects.push(plaetze[id].rect);
        return { id, p: [best.x0 + best.gp[0], best.y0 + best.gp[1]] };
      };
      const kerker = [];
      // TA: mit Ausstattung ist die Kantine eine Taverne und bekommt nie Zellen (Kai 2026-10-14: „sieht aus wie ein Gefängnis“)
      const aus = !!opts.ausstattung && !methalle && !eisenwald;
      for (const q of (kom ? [kom] : []).concat(R2.shuffle(funk.filter((z) => z !== kom && !(aus && z.b.typ === 'C'))))) { for (let n = 0; n < 2 && kerker.length < 2; n++) { const p = zelleIn(q.id); if (p) { kerker.push(p); ank(q.id, 'zelle', p); } else break; } }
      while (kerker.length < 2) { const k = kaefigFrei(); if (!k) break; kerker.push(k.p); ank(k.id, 'zelle', k.p); }
      // Wachturm (Rolle aussicht): 5×5-Plateau (Brüstung k, Fläche ^, Rampe /) am Rand einer Straße oder des Platzes, Rampe zur Straße
      const TURM = ['kkkkk', 'k^^^k', 'k^^^k', 'k^^^k', 'kk/kk'];
      let turm = null;
      { let t = TURM;
        for (let rot = 0; rot < 4; rot++, t = drehe(t)) {
          const ramp = (() => { for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (t[y][x] === '/') return [x, y]; })();
          const aus = ramp[1] === 4 ? [0, 1] : ramp[1] === 0 ? [0, -1] : ramp[0] === 4 ? [1, 0] : [-1, 0];
          for (let y0 = 1; y0 < h - 5; y0++) for (let x0 = 1; x0 < w - 5; x0++) {
            let ok = true;
            for (let y = -1; y <= 5 && ok; y++) for (let x = -1; x <= 5 && ok; x++) {
              const c = at(x0 + x, y0 + y);
              if (x >= 0 && x < 5 && y >= 0 && y < 5) { if (c !== '.') ok = false; } else if (c === 'D' || c === undefined) ok = false;
            }
            if (!ok) continue;
            if (!strBegehbar(x0 + ramp[0] + aus[0], y0 + ramp[1] + aus[1])) continue;
            const sc = Math.abs(x0 + 2 - pmid[0]) + Math.abs(y0 + 2 - pmid[1]) + R2.range(0, 10);
            if (!turm || sc < turm.sc) turm = { sc, x0, y0, t, aus, ramp };
          }
        }
      }
      if (turm) {
        for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) setT(turm.x0 + x, turm.y0 + y, turm.t[y][x]);
        for (let y = -1; y <= 5; y++) for (let x = -1; x <= 5; x++) belegt.add((turm.x0 + x) + ',' + (turm.y0 + y));
        plaetze.wachturm = { typ: 'wachturm', modul: 'gen-siedlung', lage: { rot: 0, spiegel: false, aussen: null }, rect: [turm.x0, turm.y0, 5, 5], bereich: 'kulisse' };
        bereiche.kulisse = bereiche.kulisse || { name: 'Kulissenhäuser', rects: [] };
        bereiche.kulisse.rects.push(plaetze.wachturm.rect);
        ank('wachturm', 'aussicht', [turm.x0 + 2, turm.y0 + 2]);
      }
      // ---- TA (Kai 2026-10-14): Siedlungsausstattung (opts.ausstattung) und Bodenton (opts.boden) -------------------------------------
      // Taverne: Tresen, Tische, Hocker, Fässer und Feuerstelle in der Kantine. Marktstände am Platz, Laternen an den Türen, Bänke und Fässer vor
      // Kulissenhäusern. Möbel sind Deckungskacheln ('o'; Feuerstelle 'O'): sie blockieren, dürfen aber nie ein Gebäude zerschneiden (objekteOk/
      // innenZusammen) und draußen nie einen Durchgang schließen (lokalOK). Sie stehen zusätzlich als meta.moebel = [[x, y, w, h, schlüssel, drehung]]
      // (Schlüssel → Bauweise.moebel, Drehung 0 S, 1 O, 2 N, 3 W = Blickrichtung der Vorderseite) für den Renderer.
      // Personen der Kulisse und der Kapitel stehen an Möbel-nahen Ankern mit festen IDs (<platz>.wirt|evert|gast1|gast2, platz.marktfrau|haendler).
      const moebel = [];
      const BODEN_TOENE = ['sand', 'gras', 'wald'];
      const boden = opts.boden === 'auto' ? BODEN_TOENE[(Math.imul((seed >>> 0) ^ 0x9E3779B9, 2654435761) >>> 0) % BODEN_TOENE.length] : (BODEN_TOENE.includes(opts.boden) ? opts.boden : null);
      if (aus) {
        const DIRS4 = [[0, 1], [1, 0], [0, -1], [-1, 0]];   // = Drehung 0 S, 1 O, 2 N, 3 W
        const geh = (c) => c === '.' || c === ',' || c === 'P' || c === 'D' || c === 'G';
        const ringOffs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
        // Steht ein Objekt auf (x, y): bleibt die Umgebung zusammenhängend begehbar? (ein einziger zusammenhängender Kranz begehbarer Nachbarkacheln)
        const lokalOK = (x, y) => {
          const w = ringOffs.map(([dx, dy]) => geh(at(x + dx, y + dy)));
          let laeufe = 0; for (let i = 0; i < 8; i++) if (w[i] && !w[(i + 7) % 8]) laeufe++;
          return laeufe <= 1;
        };
        const nahDeckung = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = at(x + dx, y + dy); if (c === 'o' || c === 'O') return true; } return false; };
        // Innenraum: Möbelstück auf eine freie Bodenkachel stellen (zeichen o/O, Schlüssel für den Renderer)
        const nahTuer1 = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) === 'D') return true; return false; };   // Möbel lassen nur den Eingang selbst frei (nahTuer: 2 Kacheln)
        const stelleInnen = (r, x, y, ch, key, rot) => {
          if (at(x, y) !== ',' || belegt.has(x + ',' + y) || nahTuer1(x, y)) return false;
          const k = x + ',' + y;
          objekte.add(k);
          if (!objekteOk(r) || !innenZusammen(r)) { objekte.delete(k); return false; }
          belegt.add(k); setT(x, y, ch); moebel.push([x, y, 1, 1, key, rot]);
          return true;
        };
        // Außen: Rechteck w×h freistellen (alle Kacheln frei, unbelegt, nicht an Deckung, Umgebung bleibt zusammenhängend)
        const stelleAussen = (x, y, w, h, key, rot, erlaubt) => {
          const ok = erlaubt || ((c) => c === '.' || c === ',' || c === 'P');
          const kach = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) kach.push([x + i, y + j]);
          if (!kach.every(([px, py]) => ok(at(px, py)) && !belegt.has(px + ',' + py) && !nahDeckung(px, py))) return false;
          const alt = kach.map(([px, py]) => at(px, py));
          for (const [px, py] of kach) setT(px, py, 'o');
          if (!kach.every(([px, py]) => lokalOK(px, py))) { kach.forEach(([px, py], i) => setT(px, py, alt[i])); return false; }
          for (const [px, py] of kach) belegt.add(px + ',' + py);
          moebel.push([x, y, w, h, key, rot]);
          return true;
        };
        // 1) Taverne in der Kantine. Lokales Raster: u quer (0 … W-1), v von der Rückwand (0) bis zur Türwand (D-1); die Tür liegt in Richtung dir.
        for (const q of funk.filter((z) => z.b.typ === 'C')) {
          const r = plaetze[q.id].rect, [rx, ry, rw, rh] = r;
          const ix0 = rx + 1, iy0 = ry + 1, ix1 = rx + rw - 2, iy1 = ry + rh - 2;
          const dirI = { n: 0, s: 2, w: 1, e: 3 }[q.b.side];   // Gebäude liegt nördlich der Straße (side n) → Tür an der Südwand = Richtung S
          const horiz = dirI === 0 || dirI === 2;
          const W = horiz ? ix1 - ix0 + 1 : iy1 - iy0 + 1, Dp = horiz ? iy1 - iy0 + 1 : ix1 - ix0 + 1;
          if (W < 4 || Dp < 4) continue;
          const T = (u, v) => (dirI === 0 ? [ix0 + u, iy0 + v] : dirI === 2 ? [ix1 - u, iy1 - v] : dirI === 1 ? [ix0 + v, iy0 + u] : [ix1 - v, iy1 - u]);
          const [ddx, ddy] = DIRS4[dirI];
          const tuerU = []; for (let u = 0; u < W; u++) { const [tx, ty] = T(u, Dp - 1); if (at(tx + ddx, ty + ddy) === 'D') tuerU.push(u); }
          const amEingang = (u, v) => v >= Dp - 2 && tuerU.some((e) => Math.abs(e - u) <= 1);
          const P = (u, v, ch, key) => { if (u < 0 || v < 0 || u >= W || v >= Dp) return false; const [tx, ty] = T(u, v); return stelleInnen(r, tx, ty, ch, key, dirI); };
          // Rückwand: Fass links, Feuerstelle rechts
          P(0, 0, 'o', 'fass'); if (W >= 8) P(1, 0, 'o', 'fass');
          P(W - 1, 0, 'O', 'feuerschale');
          // Tresen davor (Reihe 1), links und rechts bleibt ein Durchgang zur Rückwand
          const n = Math.max(2, Math.min(5, W - 5)), tr = [];
          for (let i = 0; i < n; i++) { const u = 2 + i; if (P(u, 1, 'o', i === 1 ? 'tresen_krug' : i === 2 ? 'tresen_flasche' : 'tresen')) tr.push(u); }
          // Tische mit Hockern daneben (Reihe vt), Gänge zur Tür bleiben frei
          const vt = Dp >= 6 ? 3 : Dp - 3;   // flache Räume: Tischreihe eine Reihe vor dem Tresen, damit die Reihe vor der Tür frei bleibt
          const tische = [], wunsch = W >= 8 ? 2 : 1;
          // bevorzugte Spalten zuerst; flache Räume (Tischreihe unmittelbar vor der Tür) meiden die Türspalten
          for (const u of (W >= 8 ? [2, W - 3, 1, W - 2] : W >= 6 ? [W - 3, 2, 1, W - 2] : [W - 2, 1, 2])) {
            if (tische.length >= wunsch) break;
            if (tische.some((t) => Math.abs(t - u) < 3) || amEingang(u, vt)) continue;
            if (P(u, vt, 'o', tische.length === 0 ? 'tisch' : 'tisch_gedeckt')) { tische.push(u); if (!amEingang(u - 1, vt)) P(u - 1, vt, 'o', 'hocker'); if (!amEingang(u + 1, vt)) P(u + 1, vt, 'o', 'hocker'); }
          }
          // Personen: Wirt hinter dem Tresen, Evert und Gäste an den Tischen (freie Kachel neben dem Tisch Richtung Tür, sonst Richtung Tresen)
          const freiTile = (u, v) => { if (u < 0 || v < 0 || u >= W || v >= Dp) return null; const [tx, ty] = T(u, v); return at(tx, ty) === ',' && !belegt.has(tx + ',' + ty) && !objekte.has(tx + ',' + ty) && !amEingang(u, v) ? [tx, ty] : null; };
          // Kandidaten zuerst, sonst die nächste freie Kachel (kleine Räume): jeder der vier Anker entsteht, solange noch Platz ist
          const person = (name, kandidaten) => {
            const nahe = kandidaten[0];
            const alle = []; for (let u = 0; u < W; u++) for (let v = 0; v < Dp; v++) alle.push([u, v]);
            alle.sort((a, b) => (Math.abs(a[0] - nahe[0]) + Math.abs(a[1] - nahe[1])) - (Math.abs(b[0] - nahe[0]) + Math.abs(b[1] - nahe[1])));
            for (const [u, v] of kandidaten.concat(alle)) { const p = freiTile(u, v); if (p) { belegt.add(p.join(',')); ank(q.id, 'nsc', p, { id: q.id + '.' + name }); return true; } }
            return false;
          };
          const mw = tr.length ? tr[Math.floor(tr.length / 2)] : 3;
          person('wirt', [[mw, 0], [mw + 1, 0], [mw - 1, 0], [1, 0]]);
          const t1 = tische.length ? tische[0] : Math.floor(W / 2), t2 = tische.length > 1 ? tische[1] : t1;
          person('evert', [[t1, vt + 1], [t1, vt - 1], [t1 + 1, vt + 1], [t1 - 1, vt + 1], [t1 + 2, vt], [t1 - 2, vt]]);
          person('gast1', [[t2, vt - 1], [t2, vt + 1], [t2 + 1, vt - 1], [t2 - 1, vt - 1], [t2 + 2, vt], [t2 - 2, vt]]);
          person('gast2', [[W - 2, vt + 1], [W - 2, vt - 1], [W - 3, vt + 1], [t1 - 1, vt - 1], [1, vt + 1], [1, vt]]);
        }
        // 2) Laternen an den Türen der Funktionsgebäude (Kantine und Kommando beidseitig, sonst links der Tür)
        for (const { b } of geb) {
          if (b.typ === 'k' || !b.tueren) continue;
          const out = DIRS4[{ n: 0, s: 2, w: 1, e: 3 }[b.side]];
          const along = out[0] === 0 ? [1, 0] : [0, 1];
          const t0 = b.tueren[0], t1 = b.tueren[1];
          stelleAussen(t0[0] + ox + out[0] - along[0], t0[1] + oy + out[1] - along[1], 1, 1, 'laterne', 0);
          if (b.typ === 'C' || b.typ === 'K') stelleAussen(t1[0] + ox + out[0] + along[0], t1[1] + oy + out[1] + along[1], 1, 1, 'laterne', 0);
        }
        // 3) Marktstände am Platz (Vorderseite nach Süden, Händler dahinter) und Laternen an den Platzecken
        {
          const pr = plaetze.platz.rect, [px, py, pw] = pr;
          const stands = [['marktstand', 'marktfrau', px + 3], ['marktstand_kaese', 'haendler', px + pw - 5]];
          for (const [key, wer, sx] of stands) {
            let ok = false;
            for (const dy of [4, 5, 3, 6]) { for (const dx of [0, 1, -1, 2]) {
              const x = sx + dx, y = py + dy;
              if (!stelleAussen(x, y, 2, 1, key, 0)) continue;
              const v = [[x, y - 1], [x + 1, y - 1]].find(([vx, vy]) => (at(vx, vy) === 'P' || at(vx, vy) === ',') && !belegt.has(vx + ',' + vy));
              if (v) { belegt.add(v.join(',')); ank('platz', 'nsc', v, { id: 'platz.' + wer }); }
              ok = true; break;
            } if (ok) break; }
          }
          for (const [lx, ly] of [[px + 1, py + 1], [px + pw - 2, py + 1], [px + 1, py + pr[3] - 2], [px + pw - 2, py + pr[3] - 2]]) stelleAussen(lx, ly, 1, 1, 'laterne', 0);
        }
        // 4) Bänke und Fässer vor Kulissenhäusern (höchstens 4, nach Zufall)
        {
          let n = 0;
          for (const { b } of R2.shuffle(geb.filter((z) => z.b.typ === 'k' && !z.b.hinterhaus && z.b.tueren))) {
            if (n >= 4) break;
            const dI = { n: 0, s: 2, w: 1, e: 3 }[b.side], out = DIRS4[dI];
            const hz = out[0] === 0, along = hz ? [1, 0] : [0, 1];
            const t0 = b.tueren[0], t1 = b.tueren[1];
            const bx = t1[0] + ox + out[0] + along[0], by = t1[1] + oy + out[1] + along[1];
            const okB = stelleAussen(hz ? bx : bx, hz ? by : by, hz ? 2 : 1, hz ? 1 : 2, 'bank', hz ? 0 : 1);
            const okF = stelleAussen(t0[0] + ox + out[0] - along[0], t0[1] + oy + out[1] - along[1], 1, 1, 'fass', 0);
            if (okB || okF) n++;
          }
        }
      }
      // Gebäudefunktionen: Ziel und Terminal im Kommando, Beute (4) im Lager/Kantine/…, Sprengpunkte (2) in Depots (Lager, Werkstatt)
      if (kom) ank(kom.id, 'ziel', mitte(plaetze[kom.id].rect));
      for (const q of funk.filter((z) => z.b.typ === 'Q')) ank(q.id, 'nsc', kachelIn(plaetze[q.id].rect, 'innen', false));
      const verteile = (rolle, soll, typFolge, attr, nahe) => {
        let folge = typFolge.flatMap((t) => funk.filter((q) => q.b.typ === t));
        if (nahe) folge = folge.slice().sort((p, q) => dm(mitte(plaetze[p.id].rect), nahe) - dm(mitte(plaetze[q.id].rect), nahe));   // die Gebäude nächst dem Rohr zuerst
        let n = 0;
        for (let pass = 0; pass < 4 && n < soll && folge.length; pass++) for (const q of folge) {
          if (n >= soll) break;
          const r = plaetze[q.id].rect, p = kachelIn(r, 'rand') || kachelIn(r, 'innen');
          if (p) { ank(q.id, rolle, p, attr); n++; }
        }
      };
      verteile('terminal', 1, ['K', 'W', 'C', 'H', 'Q', 'L']);
      verteile('beute', 4, ['L', 'C', 'Q', 'H', 'W', 'K']);
      // Methalle: Sprengstoff legen statt zünden (anker.js ladungPlatzieren); die Depots nächst dem inneren Rohrende zuerst: das Schleichen lohnt, der Weg ist kurz
      if (methalle) verteile('sprengpunkt', 2, ['W', 'L', 'H', 'C'], { modus: 'platzieren' }, [B.rohr.innen[0] + ox, B.rohr.innen[1] + oy]);
      else verteile('sprengpunkt', 2, ['W', 'L', 'H', 'C', 'Q', 'K']);
      // Methalle: Erscheinungspunkte des Nachschubs in den Baracken (Quartiere), je Baracke bis zu 4, ohne Alarm
      if (methalle) for (const q of funk.filter((z) => z.b.typ === 'Q')) for (let i = 0; i < 4; i++) ank(q.id, 'baracke', kachelIn(plaetze[q.id].rect, 'innen', false) || kachelIn(plaetze[q.id].rect, 'rand', false));
      // Rückfall: fehlen Sprengpunkte (Gebäude zu eng), entsteht ein freistehendes Tankdepot (2×2 Tank 'O', Sprengziel daneben) auf freiem Gelände
      for (let n = 0; !methalle && roh.filter((a) => a.rolle === 'sprengpunkt').length < 2 && n < 2; n++) {
        let best = null;
        for (let y0 = 2; y0 < h - 4; y0++) for (let x0 = 2; x0 < w - 5; x0++) {
          let ok = true;
          for (let y = -1; y <= 2 && ok; y++) for (let x = -1; x <= 3 && ok; x++) {
            const c = at(x0 + x, y0 + y), im = x >= 0 && y >= 0 && y <= 1 && x <= 2;
            if (im ? c !== '.' || belegt.has((x0 + x) + ',' + (y0 + y)) : !'.,P'.includes(c || '#')) ok = false;
          }
          if (!ok) continue;
          const sc = dm([x0, y0], pmid) + R2.range(0, 10);
          if (!best || sc < best.sc) best = { sc, x0, y0 };
        }
        if (!best) break;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) setT(best.x0 + dx, best.y0 + dy, 'O');
        for (let y = -1; y <= 2; y++) for (let x = -1; x <= 3; x++) belegt.add((best.x0 + x) + ',' + (best.y0 + y));
        const id = 'depot_' + (n + 1);
        plaetze[id] = { typ: 'treibstofflager', modul: 'gen-siedlung', lage: { rot: 0, spiegel: false, aussen: null }, rect: [best.x0, best.y0, 3, 2], bereich: 'kulisse' };
        bereiche.kulisse = bereiche.kulisse || { name: 'Kulissenhäuser', rects: [] };
        bereiche.kulisse.rects.push(plaetze[id].rect);
        ank(id, 'sprengpunkt', [best.x0 + 2, best.y0]);
      }
      // Eingänge: Tor bzw. westliches Straßenende (laut), das fernste Straßenende und ein drittes, von beiden entferntes (leise)
      const hs = B.strassen[0].rect;
      const ein1 = methalle ? [B.rohr.aussen[0] + ox, B.rohr.aussen[1] + oy] : B.mauer ? [S.x0 + ox, B.cy + oy] : [hs.x0 + ox, B.cy + oy];
      if (methalle) { ank('rohr', 'eingang', ein1, { art: 'leise' }); ank('rohr', 'eingang', [B.rohr.innen[0] + ox, B.rohr.innen[1] + oy], { art: 'leise' }); }   // Methalle: beide Rohrmünder, kein Tor
      else ank(B.mauer ? 'tor' : 'strasse_1', 'eingang', ein1, { art: 'laut' });
      const enden = [];
      B.strassen.forEach((s, i) => {
        const q = s.rect, cm = [Math.floor((q.x0 + q.x1) / 2), Math.floor((q.y0 + q.y1) / 2)];
        for (const [cx, cy] of [[cm[0], q.y0], [cm[0], q.y1], [q.x0, cm[1]], [q.x1, cm[1]]]) { const px = cx + ox, py = cy + oy; if (at(px, py) === ',' && !belegt.has(px + ',' + py)) enden.push({ p: [px, py], id: 'strasse_' + (i + 1) }); }
      });
      const eingaenge = [ein1];
      for (let n = 0; !methalle && n < 2; n++) {
        let best = null;
        for (const e of enden) { const d = Math.min(...eingaenge.map((q) => dm(q, e.p))); if (!best || d > best.d) best = { d, e }; }
        if (!best) break;
        eingaenge.push(best.e.p); belegt.add(best.e.p.join(',')); ank(best.e.id, 'eingang', best.e.p, { art: 'leise' });
      }
      // Straßen- und Platzpunkte für Pad, Wachen und Patrouille
      const kand = [];
      B.strassen.forEach((s, i) => {
        const id = 'strasse_' + (i + 1), q = plaetze[id].rect, hz = q[2] > q[3], len = hz ? q[2] : q[3], breit = hz ? q[3] : q[2];
        for (let t = 2; t < len - 2; t += 3) for (const sd of [1, breit - 2]) { const p = hz ? [q[0] + t, q[1] + sd] : [q[0] + sd, q[1] + t]; if (at(p[0], p[1]) === ',') kand.push({ platz: id, p }); }
      });
      { const q = plaetze.platz.rect; for (const p of [[q[0] + 1, q[1] + 1], [q[0] + q[2] - 2, q[1] + 1], [q[0] + 1, q[1] + q[3] - 2], [q[0] + q[2] - 2, q[1] + q[3] - 2]]) if (at(p[0], p[1]) === 'P') kand.push({ platz: 'platz', p }); }
      R2.shuffle(kand);
      const freiP = (p) => (at(p[0], p[1]) === ',' || at(p[0], p[1]) === 'P') && !belegt.has(p.join(','));
      // zweites Pad: 3 freie Kacheln in L-Form, fern vom Landefeld und den Eingängen (ankunft nur am ersten)
      if (!methalle) { let best = null;   // Methalle: genau ein Abholpunkt (einziger Teleportpunkt, außerhalb der Mauer)
        for (const c of kand) {
          if (!freiP(c.p)) continue;
          const l = [[1, 1], [-1, 1], [1, -1], [-1, -1]].find(([dx, dy]) => freiP([c.p[0] + dx, c.p[1]]) && freiP([c.p[0], c.p[1] + dy]));
          if (!l) continue;
          const d = Math.min(dm(c.p, lm) * 0.5, ...eingaenge.map((q) => dm(c.p, q)));
          if (!best || d > best.d) best = { d, c, l };
        }
        if (best) { const [x, y] = best.c.p; for (const q of [[x, y], [x + best.l[0], y], [x, y + best.l[1]]]) belegt.add(q.join(',')); ank(best.c.platz, 'abholpunkt', best.c.p); }
      }
      // Wachen (6) und Patrouille (4) auf Straßen und Platz, nach x gereiht abwechselnd; Patrouille als Kette 'a'
      if (methalle) {
        // Methalle: vier Patrouillenwege (Ketten a–d) für vier Zweiergruppen; Startpunkte weit auseinander, je Weg bis zu 3 Punkte auf demselben Platz.
        // Schleichkorridor: der kürzeste Weg vom inneren Rohrende zum nächsten Sprengziel. Drei Wege halten Abstand zum Korridor (außerhalb der
        // Sichtweite), einer (die Querwache, Kette d) streift ihn: ohne Beobachten und Warten kommt niemand unbemerkt durch, mit Geduld schon.
        const rohrEnde = [B.rohr.innen[0] + ox, B.rohr.innen[1] + oy];
        const spr = roh.filter((a) => a.rolle === 'sprengpunkt').sort((a, b) => dm([a.x, a.y], rohrEnde) - dm([b.x, b.y], rohrEnde))[0];
        let korridor = [];
        if (spr) {
          const geh = (x, y) => '.,PrD'.includes(at(x, y) || '#');
          const prev = new Map([[rohrEnde.join(','), null]]); const qu = [rohrEnde]; let ziel = null;
          while (qu.length && !ziel) {
            const [x, y] = qu.shift();
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
              if (prev.has(k)) continue;
              if (Math.abs(nx - spr.x) + Math.abs(ny - spr.y) <= 1 && geh(nx, ny)) { prev.set(k, x + ',' + y); ziel = [nx, ny]; break; }
              if (geh(nx, ny)) { prev.set(k, x + ',' + y); qu.push([nx, ny]); }
            }
          }
          for (let k = ziel ? ziel.join(',') : null; k; k = prev.get(k)) korridor.push(k.split(',').map(Number));
        }
        const SICHT_ABSTAND = 11;
        const abKorr = (c) => korridor.length ? Math.min(...korridor.map((q) => Math.max(Math.abs(q[0] - c.p[0]), Math.abs(q[1] - c.p[1])))) : 99;
        const pool0 = kand.filter((c) => freiP(c.p));
        let pool = pool0.filter((c) => abKorr(c) >= SICHT_ABSTAND);
        if (pool.length < 6) pool = pool0.filter((c) => abKorr(c) >= 7);   // sehr kleine Karte: weniger Abstand
        if (pool.length < 6) pool = pool0;
        const seeds = [];
        if (pool.length) seeds.push(pool[0]);
        while (seeds.length < 3 && seeds.length < pool.length) {
          let best = null;
          for (const c of pool) { if (seeds.includes(c)) continue; const d = Math.min(...seeds.map((q) => dm(q.p, c.p))); if (!best || d > best.d) best = { d, c }; }
          if (!best) break;
          seeds.push(best.c);
        }
        // Querwache: der Punkt, der dem Korridor am nächsten liegt (sonst weiter entfernt von den anderen)
        { const rest = pool0.filter((c) => !seeds.includes(c) && seeds.every((q) => dm(q.p, c.p) >= 6)).sort((a, b) => abKorr(a) - abKorr(b)); if (rest.length) seeds.push(rest[0]); }
        seeds.forEach((sd, i) => {
          const quelle = i === 3 ? pool0 : pool;
          const eigene = quelle.filter((c) => c.platz === sd.platz && freiP(c.p)).sort((a, b) => dm(a.p, sd.p) - dm(b.p, sd.p));
          const gewaehlt = [];
          // Querwache: lange Beine (Startpunkt am Korridor, Gegenpunkt am weitesten entfernten Punkt desselben Platzes), damit sie den Korridor nur
          // zeitweise einsieht und Lücken von einer Wegzeit entstehen
          if (i === 3 && eigene.length > 1) { gewaehlt.push(eigene[0]); gewaehlt.push(eigene[eigene.length - 1]); }
          else for (const c of eigene) { if (gewaehlt.length >= 3) break; if (gewaehlt.every((q) => Math.max(Math.abs(q.p[0] - c.p[0]), Math.abs(q.p[1] - c.p[1])) >= 4)) gewaehlt.push(c); }
          for (const c of gewaehlt) { belegt.add(c.p.join(',')); ank(c.platz, 'patrouille', c.p, { kette: String.fromCharCode(97 + i) }); }
        });
      } else { let pick = [];
        for (const abst of [6, 5, 4, 3, 2, 1]) {
          pick = [];
          for (const c of kand) if (freiP(c.p) && pick.every((q) => Math.max(Math.abs(q.p[0] - c.p[0]), Math.abs(q.p[1] - c.p[1])) >= abst)) pick.push(c);
          if (pick.length >= 10) break;
        }
        pick = pick.slice(0, 10).sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
        const folge = ['wache', 'patrouille', 'wache', 'patrouille', 'wache', 'wache', 'patrouille', 'wache', 'patrouille', 'wache'];
        pick.forEach((c, i) => { belegt.add(c.p.join(',')); ank(c.platz, folge[i], c.p, folge[i] === 'patrouille' ? { kette: 'a' } : {}); });
      }
      // Lager und Werkstatt: ein, zwei Fässer/Werkzeug an der Wand als Deckung (statt reiner Deko); Gebäude bleiben zusammenhängend begehbar
      for (const { b, id } of geb) {
        if (b.typ !== 'L' && b.typ !== 'W') continue;
        for (let i = 0; i < 2; i++) { const t = kachelIn(plaetze[id].rect, 'rand'); if (t) setT(t[0], t[1], 'o'); }
      }
      roh.sort((a, b) => (a.platz < b.platz ? -1 : a.platz > b.platz ? 1 : 0) || (a.rolle < b.rolle ? -1 : a.rolle > b.rolle ? 1 : 0) || a.y - b.y || a.x - b.x);
      const zz = {}; for (const a of roh) { const k = a.platz + '.' + a.rolle; zz[k] = (zz[k] || 0) + 1; }
      const lauf = {}; const anker = [];
      for (const a of roh) { const k = a.platz + '.' + a.rolle; lauf[k] = (lauf[k] || 0) + 1; anker.push(Object.assign({ id: zz[k] > 1 ? k + '.' + lauf[k] : k }, a)); }
      const pflicht = Object.assign({}, methalle ? PFLICHT_METHALLE : PFLICHT_AUSSENPOSTEN, eisenwald ? { flagge: 1 } : {});
      const titel = {}; for (const { b, id } of geb) if (b.typ !== 'k') titel[id] = GEB_TITEL[b.typ];
      return {
        id: opts.id || null, erzeuger: 'gen-siedlung/1', art: 'aussenposten', bauweise, besitz: opts.besitz || null,
        zustand: opts.zustand || 'intakt', seed, bauversion: aus ? 'gen5a' : 'gen5', schablone: 'gen-siedlung', spiegel: null, w, h, rows: rows.map((r) => r.replace(/P/g, '.')), legende: null, anker,
        bereiche, plaetze, eingaenge: anker.filter((a) => a.rolle === 'eingang').map((a) => a.id), abholpunkte: anker.filter((a) => a.rolle === 'abholpunkt').map((a) => a.id),
        ankunft: (anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft) || {}).id || null,
        patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
        meta: { versuche: 1, kennzahlen: null, linear: false, pflicht, zellen: null, schiffDecks: null, torStart: 'offen', huelle: true, haeuserZiel: N, haeuser: B.gebaeude.length, typ, titel, ...(methalle ? { variante: 'methalle', schleichweg: true } : eisenwald ? { variante: 'eisenwald' } : {}), ...(aus ? { moebel } : {}), ...(boden ? { boden } : {}) },
      };
    }
    return { bauen, kennzahlen, karteRoh, cheb };
  }
  return { erzeuger };
});
