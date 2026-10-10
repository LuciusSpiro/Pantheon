(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GenStation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Prozedurale Stationsgrammatik (Kai, 2026-10-10): Transporter (Ankunft) -> Gang (4 breit, je Seite ein Raum, Ende = Kreuzung
  // oder Raum) -> Kreuzung (1-3 Gänge). Schott an jeder Modulgrenze (Öffnung 2 breit), Kriechgang = Röhrennetz um alle Räume,
  // nur von Räumen aus erreichbar (Luken). Die Raumzahl bestimmt die Größe. Ausgabe als echte Karte (karteRoh) für
  // Buehne.ausRaster; bauen/zeichnen/kennzahlen bleiben für das ASCII-Werkzeug tools/proto-station.js.
  function erzeuger(FW, FH) {
    FW = FW || 96; FH = FH || 56;
    function rng(seed) {
      let a = seed >>> 0;
      const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      return { f, int: (n) => Math.floor(f() * n), range: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)), shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; } };
    }
    const cheb = (a, b) => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
    const OPP = { E: 'W', W: 'E', N: 'S', S: 'N' };
    const horiz = (d) => d === 'E' || d === 'W';

    function gangRect(sx, sy, d, L) {
      if (d === 'E') return { x0: sx, x1: sx + L - 1, y0: sy, y1: sy + 3 };
      if (d === 'W') return { x0: sx - L + 1, x1: sx, y0: sy, y1: sy + 3 };
      if (d === 'S') return { x0: sx, x1: sx + 3, y0: sy, y1: sy + L - 1 };
      return { x0: sx, x1: sx + 3, y0: sy - L + 1, y1: sy };
    }
    function kreuzRect(g, d) {
      if (d === 'E') return { x0: g.x1 + 1, x1: g.x1 + 4, y0: g.y0, y1: g.y1 };
      if (d === 'W') return { x0: g.x0 - 4, x1: g.x0 - 1, y0: g.y0, y1: g.y1 };
      if (d === 'S') return { x0: g.x0, x1: g.x1, y0: g.y1 + 1, y1: g.y1 + 4 };
      return { x0: g.x0, x1: g.x1, y0: g.y0 - 4, y1: g.y0 - 1 };
    }
    function endRaumRect(g, d, along, across) {
      const o = Math.floor((across - 4) / 2);
      if (d === 'E') { const x0 = g.x1 + 2; return { x0, x1: x0 + along - 1, y0: g.y0 - o, y1: g.y0 - o + across - 1 }; }
      if (d === 'W') { const x1 = g.x0 - 2; return { x0: x1 - along + 1, x1, y0: g.y0 - o, y1: g.y0 - o + across - 1 }; }
      if (d === 'S') { const y0 = g.y1 + 2; return { y0, y1: y0 + along - 1, x0: g.x0 - o, x1: g.x0 - o + across - 1 }; }
      const y1 = g.y0 - 2; return { y0: y1 - along + 1, y1, x0: g.x0 - o, x1: g.x0 - o + across - 1 };
    }
    function seitenRaumRect(g, d, seite, off, w, dep) {
      if (horiz(d)) {
        const x0 = g.x0 + off, x1 = x0 + w - 1;
        return seite === 'a' ? { x0, x1, y1: g.y0 - 2, y0: g.y0 - 2 - dep + 1 } : { x0, x1, y0: g.y1 + 2, y1: g.y1 + 2 + dep - 1 };
      }
      const y0 = g.y0 + off, y1 = y0 + w - 1;
      return seite === 'a' ? { y0, y1, x1: g.x0 - 2, x0: g.x0 - 2 - dep + 1 } : { y0, y1, x0: g.x1 + 2, x1: g.x1 + 2 + dep - 1 };
    }

    function bauen(seed, ziel) {
      const R = rng(seed);
      const st = [], tueren = [], schott = [];
      let nid = 0;
      const add = (o) => { o.id = nid++; st.push(o); return o; };
      const imFeld = (r) => r.x0 >= 4 && r.y0 >= 4 && r.x1 <= FW - 5 && r.y1 <= FH - 5;
      // ausn: berührt legitim (Gang an Kreuzung/Tür); nah: gemeinsame Wand genügt (Abstand 2); sonst Wand + Kriechgang + Wand (Abstand 4)
      const frei = (r, ausn, nah = [], istRaum = false) => imFeld(r) && st.every((s) => {
        if (ausn.includes(s.id)) return true;
        const mind = nah.includes(s.id) || (istRaum && s.kind !== 'raum') || (!istRaum && s.kind === 'raum' && false) ? 2 : 4;
        return cheb(r, s.rect) >= mind;
      });
      const ty = R.range(Math.floor(FH / 2) - 8, Math.floor(FH / 2) - 2);
      const T = add({ kind: 'T', rect: { x0: 5, y0: ty, x1: 10, y1: ty + 5 }, parent: null, tiefe: 0 });
      let uebrig = ziel;
      const queue = [];
      const seitenTuer = (g, d, seite, rr, w) => {
        const m = Math.floor(w / 2) - 1;
        if (horiz(d)) { const y = seite === 'a' ? g.y0 - 1 : g.y1 + 1; tueren.push([rr.x0 + m, y], [rr.x0 + m + 1, y]); }
        else { const x = seite === 'a' ? g.x0 - 1 : g.x1 + 1; tueren.push([x, rr.y0 + m], [x, rr.y0 + m + 1]); }
      };
      function gangSetzen(P, d) {
        const pr = P.rect; let sx, sy;
        if (P.kind === 'T') { sx = pr.x1 + 2; sy = pr.y0 + 1; }
        else if (d === 'E') { sx = pr.x1 + 1; sy = pr.y0; } else if (d === 'W') { sx = pr.x0 - 1; sy = pr.y0; }
        else if (d === 'S') { sx = pr.x0; sy = pr.y1 + 1; } else { sx = pr.x0; sy = pr.y0 - 1; }
        const ausn = [P.id, ...(P.parent ? [P.parent.id] : []), ...st.filter((s) => s.parent === P).map((s) => s.id)];
        const nah = P.parent ? st.filter((s) => s.parent === P.parent && s.kind === 'raum').map((s) => s.id) : [];
        for (let L = R.range(9, 15); L >= 8; L--) {
          const g = gangRect(sx, sy, d, L);
          if (!frei(g, ausn, [...nah, ...st.filter((q) => q.kind === 'raum').map((q) => q.id)])) continue;
          const G = add({ kind: 'gang', rect: g, parent: P, dir: d, sx, sy, L, tiefe: P.tiefe + 1 });
          if (P.kind === 'T') tueren.push([pr.x1 + 1, sy + 1], [pr.x1 + 1, sy + 2]);
          else schott.push({ G, ende: 'start' });
          return G;
        }
        return null;
      }
      function ausbau(G) {
        const d = G.dir, P = G.parent, L0 = G.L;
        const pk = (queue.length === 0 && uebrig > 3) ? 1 : uebrig > 3 ? 0.6 : uebrig > 1 ? 0.25 : 0;   // letzter offener Zweig + viele Räume übrig: weiterwachsen
        const opt = R.f() < pk ? ['kreuz', 'raum'] : ['raum', 'kreuz'];
        let E = null;
        for (let L = L0; L >= 8 && !E; L--) {            // Gang kürzen, bis ein Ende passt
          G.rect = gangRect(G.sx, G.sy, d, L); G.L = L;
          for (const t of opt) {
            if (E) break;
            if (t === 'kreuz') {
              const k = kreuzRect(G.rect, d);
              if (frei(k, [G.id])) { E = add({ kind: 'kreuz', rect: k, parent: G, tiefe: G.tiefe + 1 }); schott.push({ G, E, ende: 'ende' }); }
            } else {
              for (let v = 0; v < 6 && !E; v++) {
                const rr = endRaumRect(G.rect, d, R.range(6, v < 3 ? 9 : 7), R.range(6, v < 3 ? 9 : 7));
                if (frei(rr, [G.id], [], true)) {
                  E = add({ kind: 'raum', rect: rr, parent: G, tiefe: G.tiefe + 1 }); uebrig--;
                  const g = G.rect;
                  if (d === 'E') tueren.push([g.x1 + 1, g.y0 + 1], [g.x1 + 1, g.y0 + 2]);
                  else if (d === 'W') tueren.push([g.x0 - 1, g.y0 + 1], [g.x0 - 1, g.y0 + 2]);
                  else if (d === 'S') tueren.push([g.x0 + 1, g.y1 + 1], [g.x0 + 2, g.y1 + 1]);
                  else tueren.push([g.x0 + 1, g.y0 - 1], [g.x0 + 2, g.y0 - 1]);
                }
              }
            }
          }
        }
        if (!E) { G.rect = gangRect(G.sx, G.sy, d, L0); G.L = L0; }
        // Arme der Kreuzung zuerst reservieren, dann erst Räume (sonst blockieren Räume die Nachbararme)
        if (E && E.kind === 'kreuz') {
          const dirs = R.shuffle(['E', 'W', 'N', 'S'].filter((x) => x !== OPP[d]));
          const k = R.range(uebrig > 4 ? 2 : 1, Math.min(3, Math.max(1, uebrig)));
          for (const dd of dirs.slice(0, k)) { const arm = gangSetzen(E, dd); if (arm) queue.push(arm); }
        }
        // Seitenräume, einer je Seite (kann am Platz scheitern)
        for (const seite of ['a', 'b']) {
          if (uebrig <= 0) break;
          for (let v = 0; v < 8; v++) {
            const w = R.range(6, Math.min(v < 4 ? 9 : 7, G.L - 2)), dep = R.range(6, v < 4 ? 9 : 7), hi = G.L - w - 1;
            if (hi < 1) break;
            const rr = seitenRaumRect(G.rect, d, seite, R.range(1, hi), w, dep);
            if (frei(rr, [G.id], [P.id, ...(E ? [E.id] : [])], true)) { add({ kind: 'raum', rect: rr, parent: G, tiefe: G.tiefe + 1 }); uebrig--; seitenTuer(G.rect, d, seite, rr, w); break; }
          }
        }
      }
      const first = gangSetzen(T, 'E'); if (process.env.PD) console.error('erster Gang', !!first);
      if (first) queue.push(first);
      for (;;) {
        while (queue.length && uebrig > 0) ausbau(queue.shift());
        if (uebrig <= 0) break;
        // Nachwuchs: ungenutzte Arme früherer Kreuzungen
        let neu = false;
        for (const K of st.filter((q) => q.kind === 'kreuz')) {
          const belegt = new Set(st.filter((c) => c.parent === K).map((c) => c.dir));
          for (const dd of R.shuffle(['E', 'W', 'N', 'S'])) {
            if (dd === OPP[K.parent.dir] || belegt.has(dd)) continue;
            const arm = gangSetzen(K, dd); if (arm) { queue.push(arm); neu = true; break; }
          }
          if (neu) break;
        }
        if (!neu) break;
      }
      // Gänge und Kreuzungen ohne Nachfolger sind nutzlos
      for (let ch = true; ch;) {
        ch = false;
        for (let i = st.length - 1; i >= 0; i--) { const s = st[i]; if ((s.kind === 'gang' || s.kind === 'kreuz') && !st.some((c) => c.parent === s)) { st.splice(i, 1); ch = true; } }
      }
      const alive = new Set(st.map((s) => s.id));
      for (let i = schott.length - 1; i >= 0; i--) { const sc = schott[i]; if (!alive.has(sc.G.id) || (sc.E && !alive.has(sc.E.id))) schott.splice(i, 1); }
      // Raumtypen: Kommando am tiefsten, Reaktor als Nächster, Rest gemischt
      const raeume = st.filter((s) => s.kind === 'raum').sort((a, b) => b.tiefe - a.tiefe || (b.rect.x1 - b.rect.x0) * (b.rect.y1 - b.rect.y0) - (a.rect.x1 - a.rect.x0) * (a.rect.y1 - a.rect.y0));
      const pool = R.shuffle(['M', 'L', 'Q', 'Q', 'H', 'W', 'Z', 'Q', 'L', 'M', 'Q', 'W']);
      raeume.forEach((r, i) => { r.typ = i === 0 ? 'K' : i === 1 ? 'R' : i === 2 ? 'L' : pool[(i - 3) % pool.length]; });
      return { st, tueren, schott, raeume, T, ziel, R };
    }

    function zeichnen(S) {
      const g = Array.from({ length: FH }, () => Array(FW).fill(' '));
      const fill = (r, c) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) g[y][x] = c; };
      for (const s of S.st) fill(s.rect, s.kind === 'T' ? 'T' : s.kind === 'raum' ? s.typ : '.');
      for (const sc of S.schott) {
        const r = sc.G.rect, h = horiz(sc.G.dir), dd = sc.G.dir;
        const pos = sc.ende === 'start' ? (dd === 'E' ? r.x0 : dd === 'W' ? r.x1 : dd === 'S' ? r.y0 : r.y1)
          : (dd === 'E' ? r.x1 : dd === 'W' ? r.x0 : dd === 'S' ? r.y1 : r.y0);
        for (let i = 0; i < 4; i++) {
          const x = h ? pos : r.x0 + i, y = h ? r.y0 + i : pos;
          g[y][x] = (i === 1 || i === 2) ? 'S' : '%';
        }
      }
      const istBoden = (c) => c !== ' ' && c !== '%';
      const naehe = (x, y, n) => { for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) { const c = (g[y + dy] || [])[x + dx]; if (c !== undefined && istBoden(c)) return true; } return false; };
      const out = g.map((r) => r.slice());
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
        if (istBoden(g[y][x])) continue;
        if (naehe(x, y, 1)) out[y][x] = '#'; else if (naehe(x, y, 2)) out[y][x] = '~'; else out[y][x] = ' ';
      }
      for (const [x, y] of S.tueren) if (out[y][x] === '#') out[y][x] = 'D';
      // Luken: je Raum (auch Transporter) eine Wandkachel mit Kriechgang dahinter
      const luken = [];
      for (const s of S.st.filter((q) => q.kind === 'raum' || q.kind === 'T')) {
        const r = s.rect, c = [];
        for (let x = r.x0 + 1; x <= r.x1 - 1; x++) { if (out[r.y0 - 1][x] === '#' && out[r.y0 - 2][x] === '~') c.push([x, r.y0 - 1, 'N']); if (out[r.y1 + 1][x] === '#' && out[r.y1 + 2][x] === '~') c.push([x, r.y1 + 1, 'S']); }
        for (let y = r.y0 + 1; y <= r.y1 - 1; y++) { if (out[y][r.x0 - 1] === '#' && out[y][r.x0 - 2] === '~') c.push([r.x0 - 1, y, 'W']); if (out[y][r.x1 + 1] === '#' && out[y][r.x1 + 2] === '~') c.push([r.x1 + 1, y, 'O']); }
        if (!c.length) { luken.push({ s, ok: false }); continue; }
        const m = c[S.R.int(c.length)]; out[m[1]][m[0]] = 'h'; luken.push({ s, ok: true, x: m[0], y: m[1], seite: m[2] });
      }
      return { out, luken };
    }

    function kennzahlen(S, Z) {
      const { out, luken } = Z;
      // Kriechgang-Komponenten
      const comp = Array.from({ length: FH }, () => Array(FW).fill(-1)); let n = 0; const groesse = [];
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (out[y][x] === '~' && comp[y][x] < 0) {
        let cnt = 0; const st = [[x, y]]; comp[y][x] = n;
        while (st.length) { const [cx, cy] = st.pop(); cnt++; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (ny >= 0 && nx >= 0 && ny < FH && nx < FW && out[ny][nx] === '~' && comp[ny][nx] < 0) { comp[ny][nx] = n; st.push([nx, ny]); } } }
        groesse.push(cnt); n++;
      }
      let gross = 0; groesse.forEach((c, i) => { if (c > groesse[gross]) gross = i; });
      let anGross = 0, mitLuke = 0;
      const dirs = { N: [0, -1], S: [0, 1], W: [-1, 0], O: [1, 0] };
      for (const l of luken) if (l.ok) { mitLuke++; const [dx, dy] = dirs[l.seite]; if (comp[l.y + dy * 1][l.x + dx * 1] === gross) anGross++; }
      // längste Schussbahn im Gangnetz
      let sicht = 0;
      const gang = (c) => c === '.' || c === 'S';
      for (let y = 0; y < FH; y++) { let run = 0; for (let x = 0; x < FW; x++) { run = gang(out[y][x]) ? run + 1 : 0; sicht = Math.max(sicht, run); } }
      for (let x = 0; x < FW; x++) { let run = 0; for (let y = 0; y < FH; y++) { run = gang(out[y][x]) ? run + 1 : 0; sicht = Math.max(sicht, run); } }
      let x0 = FW, y0 = FH, x1 = 0, y1 = 0;
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (out[y][x] !== ' ') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return { raeume: S.raeume.length, ziel: S.ziel, gaenge: S.st.filter((s) => s.kind === 'gang').length, kreuzungen: S.st.filter((s) => s.kind === 'kreuz').length,
        tiefe: Math.max(...S.st.map((s) => s.tiefe)), kriechNetze: n, raeumeMitLuke: mitLuke, lukenAmHauptnetz: anGross, alleRaeume: S.raeume.length + 1,
        schussbahn: sicht, breite: x1 - x0 + 1, hoehe: y1 - y0 + 1, bbox: { x0, y0, x1, y1 } };
    }



    // ---------------------------------------------------------------- echtes Kartenformat
    const RAUMTYP = { K: 'kontrollraum', R: 'reaktorraum', L: 'lager', Q: 'quartiere', M: 'herzstueck', W: 'lager', H: 'quartiere', Z: 'zellen', C: 'herzstueck' };
    const RAUMNAME = { K: 'kommando', R: 'reaktor', L: 'lager', Q: 'quartier', M: 'messe', W: 'werkstatt', H: 'krankenstation', Z: 'zellen', C: 'kantine' };
    const RAUMTITEL = { K: 'Kommandoraum', R: 'Reaktorraum', L: 'Lager', Q: 'Quartiere', M: 'Messe', W: 'Werkstatt', H: 'Krankenstation', Z: 'Zellen', C: 'Kantine' };
    // karteRoh(seed, raeume, opts) -> Karte im Format von Buehne.bauen (noch ohne Legende/Kanten: Buehne.ausRaster)
    function karteRoh(seed, ziel, opts) {
      opts = opts || {};
      const S = bauen(seed, ziel), Z = zeichnen(S), out = Z.out;
      let x0 = FW, y0 = FH, x1 = 0, y1 = 0;
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (out[y][x] !== ' ') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const PAD = 2, w = x1 - x0 + 1 + 2 * PAD, h = y1 - y0 + 1 + 2 * PAD, ox = PAD - x0, oy = PAD - y0;
      const grid = Array.from({ length: h }, () => Array(w).fill('_'));
      const MAP = { '#': '#', '%': '#', '.': ',', S: 'S', D: 'D', h: 'L', '~': '.' };
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const c = out[y][x]; if (c === ' ') continue;
        grid[y + oy][x + ox] = MAP[c] || '.';   // Raumböden (Buchstaben) und Transporter: Platte
      }
      // Außenwand um das Kriechgangnetz
      const bodenZ = (c) => c === ',' || c === '.' || c === 'S' || c === 'D' || c === 'L';
      const kopie = grid.map((r) => r.slice());
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (kopie[y][x] !== '_') continue;
        let nah = false;
        for (let dy = -1; dy <= 1 && !nah; dy++) for (let dx = -1; dx <= 1; dx++) { const r = (kopie[y + dy] || [])[x + dx]; if (r !== undefined && bodenZ(r)) { nah = true; break; } }
        if (nah) grid[y][x] = '#';
      }
      const rows = grid.map((r) => r.join(''));
      const at = (x, y) => (grid[y] || [])[x];
      const rect = (r) => [r.x0 + ox, r.y0 + oy, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1];
      // Plätze
      const plaetze = {}, zaehl = {};
      const nummer = (name) => { zaehl[name] = (zaehl[name] || 0) + 1; return zaehl[name]; };
      const ids = new Map();
      for (const s of S.st) {
        let id, typ, bereich, extra = {};
        if (s.kind === 'T') { id = 'transporter'; typ = 'schleuse'; bereich = 'andock'; extra = { richtung: 'O', kern: true }; }
        else if (s.kind === 'gang') { id = 'gang_' + nummer('gang'); typ = 'korridor'; bereich = 'gang'; extra = { gefecht: true }; }
        else if (s.kind === 'kreuz') { id = 'kreuzung_' + nummer('kreuzung'); typ = 'kreuzung'; bereich = 'gang'; extra = { gefecht: true }; }
        else { const n = RAUMNAME[s.typ]; id = ['K', 'R', 'Z'].includes(s.typ) ? n : n + '_' + nummer(n); typ = RAUMTYP[s.typ]; bereich = 'kern'; extra = ['K', 'R'].includes(s.typ) ? { kern: true } : {}; }
        ids.set(s, id);
        plaetze[id] = Object.assign({ typ, modul: 'gen-station', lage: { rot: 0, spiegel: false, aussen: null }, rect: rect(s.rect), bereich }, extra);
      }
      const bereiche = {
        andock: { name: 'Transporterraum', rects: [], rolle: 'hinein' },
        gang: { name: 'Gänge und Kreuzungen', rects: [], gefecht: true },
        kern: { name: 'Räume', rects: [], rolle: 'ziel' },
      };
      for (const id of Object.keys(plaetze).sort()) bereiche[plaetze[id].bereich].rects.push(plaetze[id].rect);
      // Anker: je Raumtyp, auf freien Bodenkacheln abseits der Türen
      const R2 = rng(seed * 7919 + 13);
      const roh = [];
      const belegt = new Set();
      const nahTuer = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const c = at(x + dx, y + dy); if (c === 'D' || c === 'L' || c === 'S') return true; } return false; };
      const kachelIn = (r, wohin, boden) => {
        const rx = r[0], ry = r[1], rw = r[2], rh = r[3], kand = [];
        for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
          if (at(x, y) !== boden || belegt.has(x + ',' + y) || nahTuer(x, y)) continue;
          const rand = x === rx || y === ry || x === rx + rw - 1 || y === ry + rh - 1;
          if (wohin === 'rand' ? rand : !rand) kand.push([x, y]);
        }
        if (!kand.length) return null;
        const k = kand[R2.int(kand.length)]; belegt.add(k[0] + ',' + k[1]); return k;
      };
      const ank = (platz, rolle, p, attr) => { if (p) roh.push(Object.assign({ rolle, x: p[0], y: p[1], platz, bereich: plaetze[platz].bereich }, attr || {})); };
      const mitte = (r) => [r[0] + Math.floor(r[2] / 2), r[1] + Math.floor(r[3] / 2)];
      const tp = plaetze.transporter;
      if (tp) { const m = mitte(tp.rect); belegt.add(m.join(',')); ank('transporter', 'abholpunkt', m, { ankunft: true }); }
      const raeumeS = S.st.filter((s) => s.kind === 'raum');
      for (const s of raeumeS) {
        const id = ids.get(s), r = plaetze[id].rect;
        if (s.typ === 'K') { const m = mitte(r); belegt.add(m.join(',')); ank(id, 'ziel', m); ank(id, 'terminal', kachelIn(r, 'rand', '.')); }
        if (s.typ === 'R') ank(id, 'sprengpunkt', kachelIn(r, 'rand', '.'));
        if (s.typ === 'L') { ank(id, 'beute', kachelIn(r, 'rand', '.')); ank(id, 'beute', kachelIn(r, 'rand', '.')); }
        if (s.typ === 'Q' || s.typ === 'H') ank(id, 'nsc', kachelIn(r, 'innen', '.'));
        if (s.typ === 'Z') { ank(id, 'zelle', kachelIn(r, 'rand', '.')); ank(id, 'zelle', kachelIn(r, 'rand', '.')); }
      }
      // Eingänge: Tür des Transporters (laut) und eine Luke am tiefsten Raum (technisch)
      const tuer0 = S.tueren[0] && at(S.tueren[0][0] + ox, S.tueren[0][1] + oy) === 'D' ? [S.tueren[0][0] + ox, S.tueren[0][1] + oy] : null;
      if (tuer0 && tp) ank('transporter', 'eingang', tuer0, { art: 'laut' });
      const tief = raeumeS.slice().sort((a, b) => b.tiefe - a.tiefe)[0];
      if (tief) {
        const r = plaetze[ids.get(tief)].rect; let luke = null;
        for (let y = r[1] - 1; y <= r[1] + r[3] && !luke; y++) for (let x = r[0] - 1; x <= r[0] + r[2]; x++) if (at(x, y) === 'L') { luke = [x, y]; break; }
        if (luke) ank(ids.get(tief), 'eingang', luke, { art: 'technisch' });
      }
      // Wachen und Patrouille in den Gängen
      const gaenge = S.st.filter((s) => s.kind === 'gang');
      gaenge.slice(0, 3).forEach((g) => { const id = ids.get(g), r = plaetze[id].rect; ank(id, 'wache', kachelIn(r, 'innen', ',')); ank(id, 'patrouille', kachelIn(r, 'innen', ','), { kette: 'a' }); });
      // IDs wie im Zusammenbau: <platz>.<rolle>[.<n>]
      roh.sort((a, b) => (a.platz < b.platz ? -1 : a.platz > b.platz ? 1 : 0) || (a.rolle < b.rolle ? -1 : a.rolle > b.rolle ? 1 : 0) || a.y - b.y || a.x - b.x);
      const zz = {}; for (const a of roh) { const k = a.platz + '.' + a.rolle; zz[k] = (zz[k] || 0) + 1; }
      const lauf = {}; const anker = [];
      for (const a of roh) { const k = a.platz + '.' + a.rolle; lauf[k] = (lauf[k] || 0) + 1; anker.push(Object.assign({ id: zz[k] > 1 ? k + '.' + lauf[k] : k }, a)); }
      const pflicht = { eingang: 2, abholpunkt: 1, ziel: 1, terminal: 1, sprengpunkt: 1, beute: 2 };
      const titel = {}; for (const s of raeumeS) titel[ids.get(s)] = RAUMTITEL[s.typ];
      return {
        id: opts.id || null, erzeuger: 'gen-station/1', art: 'station', bauweise: opts.bauweise || 'germanen', besitz: opts.besitz || null,
        zustand: opts.zustand || 'intakt', seed, bauversion: 'gen1', schablone: 'gen-station', spiegel: null, w, h, rows, legende: null, anker,
        bereiche, plaetze, eingaenge: anker.filter((a) => a.rolle === 'eingang').map((a) => a.id), abholpunkte: anker.filter((a) => a.rolle === 'abholpunkt').map((a) => a.id),
        ankunft: (anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft) || {}).id || null,
        patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
        meta: { versuche: 1, kennzahlen: null, linear: false, pflicht, zellen: null, schiffDecks: null, schottStart: 'offen', huelle: true, raeumeZiel: ziel, raeume: raeumeS.length, titel },
      };
    }
    return { bauen, zeichnen, kennzahlen, karteRoh, cheb };
  }
  return { erzeuger };
});
