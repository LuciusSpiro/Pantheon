(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Hoehle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Höhle (GEL-02 A): organische Gänge und Kammern aus Zellularautomat. Zwei Verwendungen aus EINER Bauroutine (`bauen`):
  //   karteRoh(seed, opts)  eigene Karte art 'hoehle' (ein Deck, Ankunft = Eingang, Anker abholpunkt)
  //   deckRoh(seed, opts)   zweites Deck unter einer Wildnis-Karte (deck-lokale y, Anker leiter statt abholpunkt); die Verdrahtung macht Paket C
  // Reine Kartenlogik wie gen-gelaende: deterministisch aus dem Seed, kein Math.random, keine Dateizugriffe, im Rauschen nur + - * /.
  // Kachelzeichen nur vorhandene: F Fels, ',' Boden (boden2 = erde), o/O Steine, a Wasserpfütze.
  //
  // Ablauf: Anfangsrauschen -> 5 Glättungsschritte (4-5-Regel) -> Kammern für Eingang, Fundorte, Lager freiräumen -> Öffnung mit 2x2-Element
  // (alles, was nicht in einem 2x2-Bodenblock liegt, wird Fels: keine Engstellen unter 2 Kacheln) -> Reste verbinden (2 breite, gewundene Tunnel) oder
  // zu Fels -> Diagonal-Engpässe öffnen -> Steinhaufen (nur wo 5x5 frei ist) und Pfützen -> Anker -> Erreichbarkeit prüfen, nachbessern (Tunnel), sonst werfen.
  const VERSION = 1;
  const GROESSEN = { klein: { w: 56, h: 40 }, mittel: { w: 80, h: 56 }, gross: { w: 104, h: 72 } };
  // Pflichtsätze: gelten auf jedem Seed jeder Größe, unabhängig von opts. Das Deck hat statt abholpunkt einen leiter (Deck-Link, den zählt der Prüfer selbst).
  const PFLICHT = { abholpunkt: 1, fund: 2, deckung: 4 };
  const PFLICHT_DECK = { fund: 2, deckung: 4 };
  const MAX_DECKUNG = 16;   // Deckungsanker je Karte begrenzt (Payload: jedes Anker kostet in der awayMap ca. 80-100 B, ein tiefes Deck bekäme sonst Dutzende)
  const PLATZ = 'hoehle';
  const KETTEN = 'abcdefgh';
  const BODEN = ',', FELS = 'F';
  const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  function fnv(str, h) {
    h = h == null ? 0x811c9dc5 : h;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { f, int: (n) => Math.floor(f() * n), range: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)), chance: (p) => f() < p,
      shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; } };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hash2 = (x, y, sd) => {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(sd | 0, 0x9E3779B1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  function optionen(seed, opts, flaeche, grIdx) {
    const dichte = clamp(opts.dichte == null || String(opts.dichte).trim() === '' || isNaN(+opts.dichte) ? 0.5 : +opts.dichte, 0, 1);
    const fundorte = opts.fundorte != null ? clamp(Math.round(+opts.fundorte) || 2, 2, 4) : 2 + Math.floor(hash2(seed, 22, 0x62) * 3);
    let gegner;
    if (opts.gegner === 'keine') gegner = 0;
    else if (opts.gegner != null && !isNaN(+opts.gegner)) gegner = clamp(Math.round(+opts.gegner), 0, KETTEN.length);
    else gegner = clamp(1 + grIdx + Math.floor(hash2(seed, 23, 0x63) * 2), 1, 4);
    return { dichte, fundorte, gegner };
  }
  // Eingabe -> { seed, deck, w, h, eingangX, dichte, fundorte, gegner, groesse }
  function normiere(seed, opts, deck) {
    opts = opts || {};
    seed = seed | 0;   // bewusst: 32-Bit-Wrap wie gen-gelaende; gleiche Eingabe, gleiche Karte
    if (!deck) {
      const gr = GROESSEN[opts.groesse] ? opts.groesse : 'mittel';
      const grIdx = ['klein', 'mittel', 'gross'].indexOf(gr);
      return Object.assign({ seed, deck: false, groesse: gr, w: GROESSEN[gr].w, h: GROESSEN[gr].h, eingangX: 0 }, optionen(seed, opts, 0, grIdx));
    }
    const w = clamp(Math.round(+opts.w) || 56, 24, 160), h = clamp(Math.round(+opts.hoehe) || 40, 14, 400);
    const eingangX = clamp(opts.eingangX == null || isNaN(+opts.eingangX) ? Math.floor(w / 2) : Math.round(+opts.eingangX), 4, w - 5);
    const grIdx = clamp(Math.floor(w * h / 2400), 0, 2);   // wenig Fläche 1-2 Gruppen, viel 3-4
    return Object.assign({ seed, deck: true, groesse: null, w, h, eingangX }, optionen(seed, opts, w * h, grIdx));
  }

  // Die eine Bauroutine. Liefert { rows, anker (ohne Platz-/Bereichsfelder), lager, W, H }; wirft bei verletzter Zusammenhangsgarantie.
  function bauen(P) {
    const { seed, deck, w: W, h: H } = P;
    const N = W * H, D = P.dichte;
    const R = rng(fnv('hoehle', seed >>> 0) ^ (deck ? 0x7F4A7C15 : 0x9E3779B1));
    const ix = (x, y) => y * W + x;
    const innen = (x, y) => x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2;
    const g = new Array(N).fill(FELS);
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? FELS : g[y * W + x]);
    const boden = (x, y) => at(x, y) === BODEN;
    const gesperrt = new Uint8Array(N);   // Kammern: keine Steine, kein Wasser
    const nd = (x, y) => (x * x + y * y);

    // ---- Zellularautomat: Wand ab 5 Wandnachbarn (von 8), bestehende Wand schon ab 4; Rand zählt als Wand ----
    {
      const pw = 0.455 + 0.07 * D;
      let w0 = new Uint8Array(N).fill(1);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) w0[ix(x, y)] = R.f() < pw ? 1 : 0;
      for (let it = 0; it < 5; it++) {
        const w1 = new Uint8Array(N).fill(1);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          let c = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) c += w0[ix(x + dx, y + dy)];
          w1[ix(x, y)] = (c >= 5 || (w0[ix(x, y)] && c >= 4)) ? 1 : 0;
        }
        w0 = w1;
      }
      for (let i = 0; i < N; i++) g[i] = w0[i] ? FELS : BODEN;
    }
    const kreis = (cx, cy, r, c) => { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if (nd(x - cx, y - cy) <= r * r && innen(x, y)) g[ix(x, y)] = c; };
    const sperre = (cx, cy, r) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (innen(x, y)) gesperrt[ix(x, y)] = 1; };
    const bodenListe = (rand) => { const l = []; for (let y = rand; y < H - rand; y++) for (let x = rand; x < W - rand; x++) if (boden(x, y)) l.push([x, y]); return l; };
    const dist = (a, b) => Math.sqrt(nd(a[0] - b[0], a[1] - b[1]));

    // ---- Orte aus dem rohen Automaten: Eingang, Fundorte, Lager (Kammern werden freigeräumt) ----
    let fl = bodenListe(3);
    if (!fl.length) { kreis(W >> 1, H >> 1, 4, BODEN); fl = bodenListe(3); }
    let E;
    if (deck) {
      // so nah wie möglich an eingangX (Spalte), unter mehreren gleich nahen zufällig
      let bestD = Infinity, cand = [];
      for (const p of fl) { const d = Math.abs(p[0] - P.eingangX); if (d < bestD) { bestD = d; cand = [p]; } else if (d === bestD) cand.push(p); }
      E = cand[R.int(cand.length)];
      if (bestD > 0) E = [P.eingangX, E[1]];   // Spalte liegt in Fels: Kammer genau dort schneiden, der Tunnel unten verbindet
    } else {
      const west = R.chance(0.5), band = fl.filter((p) => (west ? p[0] <= Math.max(5, W * 0.22) : p[0] >= W - 1 - Math.max(5, W * 0.22)) && p[1] >= 4 && p[1] <= H - 5);
      const pool = band.length ? band : fl;
      E = pool[R.int(pool.length)];
    }
    kreis(E[0], E[1], 2.6, BODEN); sperre(E[0], E[1], 3);
    const dA = Math.round(0.30 * (W + H) / 2), dF = Math.round(0.20 * (W + H) / 2);
    const funde = [];
    for (let i = 0; i < P.fundorte; i++) {
      let best = null;
      for (let v = 0; v < 160; v++) {
        const p = fl[R.int(fl.length)];
        if (p[0] < 4 || p[1] < 4 || p[0] > W - 5 || p[1] > H - 5) continue;
        const dm = Math.min(dist(p, E) * 0.8, ...funde.map((q) => dist(p, q)));
        if (!best || dm > best.dm) best = { p, dm };
      }
      if (!best) best = { p: fl[R.int(fl.length)] };
      funde.push(best.p); kreis(best.p[0], best.p[1], 3, BODEN); sperre(best.p[0], best.p[1], 3);
    }
    const lager = [];
    {
      const nachFerne = funde.slice().sort((p, q) => dist(q, E) - dist(p, E) || p[0] - q[0] || p[1] - q[1]);
      for (let i = 0; i < P.gegner; i++) {
        let c = null;
        for (let v = 0; v < 400 && !c; v++) {
          const stufe = v < 100 ? 0 : v < 200 ? 1 : v < 300 ? 2 : 3;
          let p;
          if (i < nachFerne.length && stufe < 3) { const a = R.f() * Math.PI * 2, r = 6 + R.f() * 3; p = [Math.round(nachFerne[i][0] + Math.cos(a) * r), Math.round(nachFerne[i][1] + Math.sin(a) * r)]; }
          else p = fl[R.int(fl.length)];
          if (p[0] < 6 || p[1] < 6 || p[0] > W - 7 || p[1] > H - 7) continue;
          if (dist(p, E) < dA * [0.9, 0.6, 0.45, 0.3][stufe] || funde.some((q) => dist(p, q) < 5) || lager.some((q) => dist(p, q.c) < [13, 11, 9, 8][stufe])) continue;
          c = p;
        }
        if (!c) continue;   // kein Platz: weniger Gruppen
        lager.push({ c, nr: lager.length });
        kreis(c[0], c[1], 3.8, BODEN); sperre(c[0], c[1], 3);
      }
    }
    const zentren = [E].concat(funde, lager.map((l) => l.c));

    // ---- Öffnung: nur Kacheln in einem 2x2-Bodenblock bleiben Boden (keine Gänge unter 2 Kacheln; Spitzen und Fäden verschwinden) ----
    {
      const neu = new Array(N).fill(FELS);
      for (let y = 1; y < H - 2; y++) for (let x = 1; x < W - 2; x++)
        if (boden(x, y) && boden(x + 1, y) && boden(x, y + 1) && boden(x + 1, y + 1)) { neu[ix(x, y)] = neu[ix(x + 1, y)] = neu[ix(x, y + 1)] = neu[ix(x + 1, y + 1)] = BODEN; }
      for (let i = 0; i < N; i++) g[i] = neu[i];
    }
    // Fluten (4er-Nachbarschaft über begehbare Kacheln o/O/a zählen nicht): liefert Markierung ab (sx, sy)
    const flute = (sx, sy, durch) => {
      const seen = new Uint8Array(N), q = [ix(sx, sy)]; seen[q[0]] = 1;
      for (let h = 0; h < q.length; h++) { const u = q[h], ux = u % W, uy = (u - ux) / W;
        for (const [dx, dy] of N4) { const x = ux + dx, y = uy + dy; if (!innen(x, y)) continue; const v = ix(x, y); if (!seen[v] && durch(g[v])) { seen[v] = 1; q.push(v); } } }
      return { seen, q };
    };
    const istBoden = (c) => c === BODEN;
    // 2 breiter, gewundener Tunnel von (x, y) nach (hx, hy): je Schritt ein 2x2-Block, Achse nach Restweg gewürfelt (diagonal gewunden, kein L)
    const tunnel = (x, y, hx, hy) => {
      const gr = (cx, cy) => { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (innen(cx + dx, cy + dy)) g[ix(cx + dx, cy + dy)] = BODEN; };
      gr(x, y);
      for (let s = 0; s < W + H && (x !== hx || y !== hy); s++) {
        const dx = hx - x, dy = hy - y;
        const waag = dy === 0 ? true : dx === 0 ? false : R.f() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy));
        if (waag) x += Math.sign(dx); else y += Math.sign(dy);
        gr(x, y);
      }
    };
    // Reste: Komponenten ab Größe 10 (oder mit Zentrum) per Tunnel an den Hauptteil, kleinere zu Fels. Hauptteil = Komponente des Eingangs.
    {
      const komp = new Int32Array(N).fill(-1), liste = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (boden(x, y) && komp[ix(x, y)] < 0) {
        const id = liste.length, q = [ix(x, y)]; komp[q[0]] = id;
        for (let h = 0; h < q.length; h++) { const u = q[h], ux = u % W, uy = (u - ux) / W;
          for (const [dx, dy] of N4) { const vx = ux + dx, vy = uy + dy; if (innen(vx, vy) && boden(vx, vy) && komp[ix(vx, vy)] < 0) { komp[ix(vx, vy)] = id; q.push(ix(vx, vy)); } } }
        liste.push(q);
      }
      if (!liste.length) throw new Error(`Höhle: kein Boden (Seed ${seed})`);
      const hauptId = komp[ix(E[0], E[1])];
      const hat = (id, p) => komp[ix(p[0], p[1])] === id;
      const brauchen = liste.map((q, id) => id !== hauptId && (q.length >= 10 || zentren.some((p) => hat(id, p))));
      for (let id = 0; id < liste.length; id++) if (id !== hauptId && !brauchen[id]) for (const u of liste[id]) g[u] = FELS;
      let haupt = liste[hauptId].slice();
      const rest = liste.map((q, id) => id).filter((id) => brauchen[id]).sort((a, b) => liste[b].length - liste[a].length || a - b);
      for (const id of rest) {
        // nächstes Paar (Stichprobe: höchstens ~300 Kacheln je Seite)
        const sa = liste[id], sh = haupt;
        const stA = Math.max(1, Math.ceil(sa.length / 300)), stH = Math.max(1, Math.ceil(sh.length / 300));
        let best = null;
        for (let a = 0; a < sa.length; a += stA) { const ax = sa[a] % W, ay = (sa[a] - ax) / W;
          for (let b = 0; b < sh.length; b += stH) { const bx = sh[b] % W, by = (sh[b] - bx) / W, d = Math.abs(ax - bx) + Math.abs(ay - by); if (!best || d < best.d) best = { d, ax, ay, bx, by }; } }
        tunnel(best.ax, best.ay, best.bx, best.by);
        haupt = haupt.concat(sa);
      }
    }
    // Diagonal-Engpässe (zwei Boden-Kacheln nur über Eck) öffnen: eine der beiden Wandkacheln wird Boden; wiederholt, bis keine bleibt.
    // Terrain heißt hier alles außer Fels (Steine/Wasser folgen erst später und nur auf 5x5-freien Stellen)
    const pinchOeffnen = () => {
      for (let pass = 0; pass < 40; pass++) {
        let n = 0;
        for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
          const a = at(x, y) !== FELS, b = at(x + 1, y) !== FELS, c = at(x, y + 1) !== FELS, d = at(x + 1, y + 1) !== FELS;
          let wand = null;
          if (a && d && !b && !c) wand = R.chance(0.5) ? [x + 1, y] : [x, y + 1];
          else if (b && c && !a && !d) wand = R.chance(0.5) ? [x, y] : [x + 1, y + 1];
          if (!wand) continue;
          if (innen(wand[0], wand[1])) { g[ix(wand[0], wand[1])] = BODEN; n++; }
        }
        if (!n) break;
      }
    };
    pinchOeffnen();
    // Hauptteil bestimmen: was der Eingang nicht erreicht, wird Fels
    {
      const { seen } = flute(E[0], E[1], istBoden);
      for (let i = 0; i < N; i++) if (g[i] === BODEN && !seen[i]) g[i] = FELS;
    }

    // ---- Steinhaufen (Deckung): nur Kacheln, um die ringsum 2 Kacheln frei sind; Steine verengen so nie einen Gang unter 2 ----
    const frei5 = (x, y, strikt) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const c = at(x + dx, y + dy); if (c === FELS || c === 'a' || (strikt && c !== BODEN)) return false; } return true; };
    const steine = (cx, cy, n, anteilO, ausgabe) => {
      let x = cx, y = cy, gesetzt = 0;
      for (let v = 0; v < n * 6 && gesetzt < n; v++) {
        x += R.range(-1, 1); y += R.range(-1, 1);
        if (!innen(x, y) || at(x, y) !== BODEN || gesperrt[ix(x, y)] || !frei5(x, y, false)) continue;
        g[ix(x, y)] = R.chance(anteilO) ? 'O' : 'o'; gesetzt++;
        if (ausgabe) ausgabe.push([x, y]);
      }
      return gesetzt;
    };
    const deckungsAnker = [], belegt = new Set();
    const belege = (x, y) => belegt.add(ix(x, y));
    belege(E[0], E[1]); for (const p of funde) belege(p[0], p[1]);
    const gruppeMit = (cx, cy, n) => {
      const st = [];
      steine(cx, cy, n, 0.3, st);
      if (!st.length) return 0;
      const kand = [];
      for (const [sx, sy] of st) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
        const x = sx + dx, y = sy + dy;
        if (innen(x, y) && at(x, y) === BODEN && !belegt.has(ix(x, y)) && !gesperrt[ix(x, y)]) kand.push([x, y]);
      }
      R.shuffle(kand);
      let k = 0;
      for (const [x, y] of kand) {
        if (k >= 2 || deckungsAnker.length >= MAX_DECKUNG) break;
        if (deckungsAnker.some((q) => Math.abs(q[0] - x) <= 1 && Math.abs(q[1] - y) <= 1)) continue;
        deckungsAnker.push([x, y]); belege(x, y); k++;
      }
      return st.length;
    };
    {
      const fb = bodenListe(3), flaeche = fb.length;
      const nGruppen = Math.max(3, Math.round(flaeche / 130 * (0.5 + D)));
      for (const p of funde) for (let v = 0; v < 25; v++) {   // an Fundorten und Lagern: Haufen in 4-6,5 Kacheln Abstand
        const a = R.f() * Math.PI * 2, r = 4 + R.f() * 2, x = Math.round(p[0] + Math.cos(a) * r), y = Math.round(p[1] + Math.sin(a) * r);
        if (innen(x, y) && at(x, y) === BODEN && !gesperrt[ix(x, y)] && gruppeMit(x, y, R.range(3, 5))) break;
      }
      for (const l of lager) for (let k = 0, m = R.range(1, 2); k < m; k++) for (let v = 0; v < 25; v++) {
        const a = R.f() * Math.PI * 2, r = 4.5 + R.f() * 2, x = Math.round(l.c[0] + Math.cos(a) * r), y = Math.round(l.c[1] + Math.sin(a) * r);
        if (innen(x, y) && at(x, y) === BODEN && !gesperrt[ix(x, y)] && gruppeMit(x, y, R.range(2, 4))) break;
      }
      for (let i = 0; i < nGruppen && fb.length; i++) for (let v = 0; v < 12; v++) { const p = fb[R.int(fb.length)]; if (!gesperrt[ix(p[0], p[1])] && frei5(p[0], p[1], false) && gruppeMit(p[0], p[1], R.range(2, 4))) break; }
      // Reserve: bleibt die Pflichtzahl aus, eine kleine Nische freiräumen (Kreis 3,2) und dort einen Haufen setzen
      for (let v = 0; v < 60 && deckungsAnker.length < PFLICHT.deckung + 2; v++) {
        const p = fb[R.int(fb.length)];
        if (!p || gesperrt[ix(p[0], p[1])] || p[0] < 4 || p[1] < 4 || p[0] > W - 5 || p[1] > H - 5) continue;
        if (!frei5(p[0], p[1], false)) { kreis(p[0], p[1], 3.2, BODEN); pinchOeffnen(); }
        if (frei5(p[0], p[1], false)) gruppeMit(p[0], p[1], 3);
      }
      if (deckungsAnker.length < PFLICHT.deckung) throw new Error(`Höhle: nur ${deckungsAnker.length} Deckungsplätze (Seed ${seed})`);
    }
    // ---- Pfützen: klein, nur wo ringsum alles Boden ist (blockieren nie eine Engstelle), nie an Ankern ----
    {
      const fb = bodenListe(3);
      const nP = fb.length ? Math.round(fb.length / 520 * (0.3 + 0.8 * D)) : 0;
      const nah = (x, y, r) => zentren.some((p) => Math.abs(p[0] - x) <= r && Math.abs(p[1] - y) <= r) || deckungsAnker.some((p) => Math.abs(p[0] - x) <= r && Math.abs(p[1] - y) <= r);
      for (let i = 0; i < nP; i++) for (let v = 0; v < 20; v++) {
        const p = fb[R.int(fb.length)];
        if (gesperrt[ix(p[0], p[1])] || nah(p[0], p[1], 3) || !frei5(p[0], p[1], true)) continue;
        let x = p[0], y = p[1];
        for (let k = 0, m = R.range(1, 4); k < m; k++) { if (frei5(x, y, true) && !nah(x, y, 2)) g[ix(x, y)] = 'a'; x += R.range(-1, 1); y += R.range(-1, 1); }
        break;
      }
    }

    // ---- Erreichbarkeit: nachbessern (Tunnel von jedem Ort zur Flut), sonst werfen ----
    const flut = () => flute(E[0], E[1], istBoden).seen;
    pinchOeffnen();
    {
      let seen = flut();
      for (const p of [].concat(funde, lager.map((l) => l.c), deckungsAnker)) if (!seen[ix(p[0], p[1])]) {
        // nächste erreichte Kachel, Tunnel; bei Treffern auf Stein/Wasser wird die Kachel Boden
        let best = null;
        for (let i = 0; i < N; i++) if (seen[i]) { const x = i % W, y = (i - x) / W, d = Math.abs(x - p[0]) + Math.abs(y - p[1]); if (!best || d < best.d) best = { d, x, y }; }
        if (!best) throw new Error(`Höhle: ${p} nicht erreichbar (Seed ${seed})`);
        tunnel(p[0], p[1], best.x, best.y); pinchOeffnen();
        seen = flut();
      }
      for (const p of [].concat(funde, lager.map((l) => l.c), deckungsAnker)) if (!seen[ix(p[0], p[1])]) throw new Error(`Höhle: ${p} nicht erreichbar (Seed ${seed})`);
      // Taschen (nur noch zwischen Steinen eingeschlossene Kacheln) werden Stein, nicht Fels: ein einzelner Felspfeiler im Freien ergäbe einen Diagonalengpass
      for (let i = 0; i < N; i++) if (g[i] === BODEN && !seen[i]) g[i] = 'o';
    }

    // ---- Anker ----
    const roh = [];
    const ank = (rolle, p, attr, bereich) => roh.push(Object.assign({ rolle, x: p[0], y: p[1], bereich: bereich || PLATZ }, attr || {}));
    if (deck) ank('leiter', E); else ank('abholpunkt', E, { ankunft: true });
    for (const p of funde) ank('fund', p);
    for (const p of deckungsAnker) if (at(p[0], p[1]) === BODEN) ank('deckung', p);
    const besetzt = new Set(roh.map((a) => ix(a.x, a.y)));
    const bereichId = (l) => (deck ? 'hoehle_lager_' : 'lager_') + (l.nr + 1);
    for (const l of lager) {
      const bid = bereichId(l);
      // Wachen: drei Posten im Lagerkreis (Chebyshev-Abstand >= 2), der erste jeder zweiten Gruppe ist ein Wächter (schwer)
      const kand = [];
      for (let y = l.c[1] - 4; y <= l.c[1] + 4; y++) for (let x = l.c[0] - 4; x <= l.c[0] + 4; x++) if (innen(x, y) && at(x, y) === BODEN && !besetzt.has(ix(x, y)) && nd(x - l.c[0], y - l.c[1]) <= 17.64) kand.push([x, y]);
      R.shuffle(kand);
      const posten = [];
      for (const p of kand) { if (posten.length >= 3) break; if (posten.every((q) => Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) >= 2)) posten.push(p); }
      posten.forEach((p, k) => { besetzt.add(ix(p[0], p[1])); ank('wache', p, k === 0 && l.nr % 2 === 0 ? { schwer: true } : {}, bid); });
      // Patrouille: drei Punkte in 6-12 Schritten Weglänge um das Lager (nicht Luftlinie: in Höhlen liegt Fels dazwischen), Kette je Gruppe
      const d = new Int32Array(N).fill(-1), q = [ix(l.c[0], l.c[1])]; d[q[0]] = 0;
      for (let h = 0; h < q.length; h++) { const u = q[h], ux = u % W, uy = (u - ux) / W;
        for (const [dx, dy] of N4) { const x = ux + dx, y = uy + dy; if (innen(x, y) && d[ix(x, y)] < 0 && istBoden(at(x, y))) { d[ix(x, y)] = d[u] + 1; q.push(ix(x, y)); } } }
      const ring = []; for (const u of q) if (d[u] >= 6 && d[u] <= 12) ring.push([u % W, (u - (u % W)) / W]);
      R.shuffle(ring);
      const pp = [];
      for (const p of ring) { if (pp.length >= 3) break; if (!besetzt.has(ix(p[0], p[1])) && pp.every((r) => Math.max(Math.abs(r[0] - p[0]), Math.abs(r[1] - p[1])) >= 4)) { pp.push(p); besetzt.add(ix(p[0], p[1])); ank('patrouille', p, { kette: KETTEN[l.nr] }, bid); } }
    }
    const rows = []; for (let y = 0; y < H; y++) rows.push(g.slice(y * W, (y + 1) * W).join(''));
    return { rows, anker: roh, lager, W, H };
  }

  // Anker sortieren und mit IDs `<platz>.<rolle>[.n]` versehen (wie gen-gelaende); Platzfeld setzen
  function fertigeAnker(b) {
    const roh = b.anker.slice();
    roh.sort((a, c) => (a.rolle < c.rolle ? -1 : a.rolle > c.rolle ? 1 : 0) || a.y - c.y || a.x - c.x);
    const zz = {}; for (const a of roh) zz[a.rolle] = (zz[a.rolle] || 0) + 1;
    const lauf = {};
    return roh.map((a) => { lauf[a.rolle] = (lauf[a.rolle] || 0) + 1; return Object.assign({ id: zz[a.rolle] > 1 ? `${PLATZ}.${a.rolle}.${lauf[a.rolle]}` : `${PLATZ}.${a.rolle}`, platz: PLATZ }, a); });
  }
  function bereiche(b, deck) {
    const out = { [PLATZ]: { name: 'Höhle', rects: [[1, 1, b.W - 2, b.H - 2]] } };
    for (const l of b.lager) {
      const bid = (deck ? 'hoehle_lager_' : 'lager_') + (l.nr + 1), r = 10;
      const x0 = Math.max(1, l.c[0] - r), y0 = Math.max(1, l.c[1] - r), x1 = Math.min(b.W - 2, l.c[0] + r), y1 = Math.min(b.H - 2, l.c[1] + r);
      out[bid] = { name: (deck ? 'Höhle Lager ' : 'Lager ') + (l.nr + 1), rects: [[x0, y0, x1 - x0 + 1, y1 - y0 + 1]], gefecht: true };
    }
    return out;
  }
  const plaetze = (W, H) => ({ [PLATZ]: { typ: 'gelaende', modul: 'gen-hoehle', lage: { rot: 0, spiegel: false, aussen: null }, rect: [1, 1, W - 2, H - 2], bereich: PLATZ } });

  function erzeuger() {
    function karteRoh(seed, opts) {
      opts = opts || {};
      const P = normiere(seed, opts, false);
      const b = bauen(P), anker = fertigeAnker(b);
      const sig = fnv(JSON.stringify([P.groesse, P.dichte, P.fundorte, P.gegner])).toString(36);
      const ab = anker.filter((a) => a.rolle === 'abholpunkt');
      return {
        id: opts.id || null, erzeuger: 'gen-hoehle/1', art: 'hoehle', bauweise: opts.bauweise || 'germanen', besitz: opts.besitz || null,
        zustand: opts.zustand || 'intakt', seed: P.seed, bauversion: `hoehle.${VERSION}[${sig}]`, schablone: 'gen-hoehle', spiegel: null, w: b.W, h: b.H, rows: b.rows, legende: null, anker,
        bereiche: bereiche(b, false), plaetze: plaetze(b.W, b.H),
        eingaenge: [], abholpunkte: ab.map((a) => a.id), ankunft: (ab.find((a) => a.ankunft) || {}).id || null,
        patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
        meta: { versuche: 1, kennzahlen: null, linear: false, pflicht: Object.assign({}, PFLICHT), zellen: null, schiffDecks: null, torStart: 'offen', huelle: true, typ: 'hoehle', titel: {}, boden2: 'erde' },
      };
    }
    // Deck unter einer Wildnis: deck-lokale y (ab 0), Anker `hoehle.*`, Bereiche `hoehle_lager_n`. Der Aufrufer addiert den Deck-Versatz (stride).
    function deckRoh(seed, opts) {
      opts = opts || {};
      const P = normiere(seed, opts, true);
      const b = bauen(P);
      return { rows: b.rows, w: b.W, h: b.H, anker: fertigeAnker(b), bereiche: bereiche(b, true), plaetze: plaetze(b.W, b.H),
        meta: { pflicht: Object.assign({}, PFLICHT_DECK), boden2: 'erde', bauversion: `hoehle.${VERSION}[${fnv(JSON.stringify([P.w, P.h, P.eingangX, P.dichte, P.fundorte, P.gegner])).toString(36)}]` } };
    }
    return { karteRoh, deckRoh };
  }
  return { erzeuger, PFLICHT, PFLICHT_DECK, GROESSEN, VERSION };
});
