// Bühnen-Kennzahlen und Rasterhelfer (CONTRACT-B1 §4, Team BUEHNE). Gemeinsamer Code (UMD): läuft im Browser
// (window.Shared_BuehneKennzahlen, Werkstatt/Galerie) und in Node (require). Kein DOM, kein Math.random.
// Arbeitet nur auf dem Ergebnisformat `Karte` (§2): rows + legende + anker + bereiche + plaetze (+ kanten/zustaende).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_BuehneKennzahlen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DECKUNG_KINDS = { deckung_halb: 1, deckung_voll: 1, pfeiler: 1, kante: 1, truemmer: 1, schutt: 1,
    cover_low: 1, pillar: 1, archive_key: 1, tablet_pedestal: 1 };   // + Handkarten-Kinds (Kesh)
  const WAND_KINDS = { wand: 1, zaun: 1, fels: 1, leere: 1, wall: 1, wall_ruin: 1, rock: 1 };
  const ZIEL_ROLLEN = ['ziel', 'terminal', 'fund', 'sprengpunkt', 'zelle', 'beute', 'raetsel', 'tor'];

  // ---- Raster: Kachelinfo, Begehbarkeit (jetzt) und Durchgang (für Prüfungen: Türen zählen als passierbar) ----
  // info: Legenden-Eintrag (kacheln.json-Format oder Handkarten-Legende). Türen: kante === 'tuer'.
  function istTuer(info) { return !!info && (info.kante === 'tuer' || info.kind === 'door'); }
  function fest(info, zustand) {
    if (!info) return true;
    if (info.solid === 'zustand') {
      const z = zustand || (info.zustaende && info.zustaende[0]);
      return !(info.begehbarIn || []).includes(z);
    }
    return !!info.solid;
  }
  function sichtSperre(info, zustand) {
    if (!info) return true;
    if (info.sperrtSicht != null) {
      if (info.sperrtSicht) return true;
      if (info.solid === 'zustand' && info.sperrtSichtGeschlossen) return fest(info, zustand);
      return false;
    }
    // Handkarten-Legende ohne sperrtSicht: fest, nicht niedrig, kein Weltraum
    return !!info.solid && !info.low && info.cover !== 1 && info.kind !== 'space';
  }

  // raster(karte, opts?) -> Zugriff mit Zustandsüberlagerung (karte.kanten[].zustand, opts.zustaende {x,y -> zustand})
  // opts.wSchwachOffen: schwache Wände als Durchgang (Inselprüfung).
  function raster(karte, opts) {
    opts = opts || {};
    const w = karte.w, h = karte.h, rows = karte.rows, leg = karte.legende || {};
    const zst = new Map();   // idx -> zustand
    if (karte.kanten) for (const k of Object.keys(karte.kanten).sort()) {
      const kk = karte.kanten[k];
      const z = (karte.zustaende && karte.zustaende[k]) || kk.zustand;
      if (z) for (const t of kk.tiles || []) zst.set(t[1] * w + t[0], z);
    }
    const torTiles = new Set();
    if (karte.anker) for (const a of karte.anker) {
      if (a.rolle !== 'tor' && !(a.rolle === 'eingang')) continue;
      for (const t of tuerKacheln(karte, a.x, a.y)) torTiles.add(t[1] * w + t[0]);
    }
    const ch = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? null : rows[y][x];
    const info = (x, y) => { const c = ch(x, y); return c == null ? null : (leg[c] || null); };
    const zustand = (x, y) => zst.get(y * w + x);
    return {
      w, h, ch, info, zustand,
      begehbar(x, y) { const i = info(x, y); return !!i && !fest(i, zustand(x, y)); },
      tuer(x, y) { return istTuer(info(x, y)); },
      durchgang(x, y) {
        const i = info(x, y);
        if (!i) return false;
        if (!fest(i, zustand(x, y))) return true;
        if (istTuer(i)) return zustand(x, y) !== 'verschlossen' || torTiles.has(y * w + x);
        if (opts.wSchwachOffen && i.kind === 'wand_schwach') return true;
        return false;
      },
      sperrtSicht(x, y) { return sichtSperre(info(x, y), zustand(x, y)); },
      cover(x, y) { const i = info(x, y); return i && !istTuer(i) ? (i.cover || 0) : 0; },
      // Deckung für die Kennzahl: Deckungsobjekte immer, Wände nur als Ecke/Stummel (≤ 1 Wandnachbar), nie ganze Raumwände
      deckungObjekt(x, y) {
        const i = info(x, y);
        if (!i || istTuer(i) || !(i.cover > 0)) return false;
        if (DECKUNG_KINDS[i.kind]) return true;
        if (!WAND_KINDS[i.kind]) return false;
        let n = 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const q = info(x + dx, y + dy); if (!q || WAND_KINDS[q.kind] || (q.solid === true && !DECKUNG_KINDS[q.kind])) n++; }
        return n <= 1;
      },
    };
  }

  // Türkacheln (D/S/G/L, auch w) einer Türgruppe: Anker auf oder neben der Tür, zusammenhängend (4er-Nachbarschaft)
  function tuerKacheln(karte, x, y) {
    const leg = karte.legende || {}, rows = karte.rows, w = karte.w, h = karte.h;
    const isT = (tx, ty) => { if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false; const i = leg[rows[ty][tx]]; return istTuer(i) || (!!i && i.kind === 'wand_schwach'); };   // Türgruppe bzw. schwache Wand (versteck)
    const start = [];
    if (isT(x, y)) start.push([x, y]);
    else for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) if (isT(x + dx, y + dy)) { start.push([x + dx, y + dy]); break; }
    if (!start.length) return [];
    const seen = new Set([start[0][1] * w + start[0][0]]); const out = [];
    const q = [start[0]];
    while (q.length) {
      const [cx, cy] = q.shift(); out.push([cx, cy]);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = cx + dx, ny = cy + dy, k = ny * w + nx;
        if (!seen.has(k) && isT(nx, ny) && rows[ny][nx] === rows[cy][cx] && out.length < 8) { seen.add(k); q.push([nx, ny]); }
      }
    }
    return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  // BFS über pass(x,y); links: [{a:[x,y], b:[x,y]}] (Deck-Links, beidseitig). Ergebnis: Int32Array Distanzen (-1 = unerreichbar)
  function bfs(w, h, pass, starts, links) {
    const dist = new Int32Array(w * h).fill(-1);
    const q = new Int32Array(w * h); let qh = 0, qt = 0;
    const lk = new Map();
    for (const l of links || []) {
      const a = l.a[1] * w + l.a[0], b = l.b[1] * w + l.b[0];
      (lk.get(a) || lk.set(a, []).get(a)).push(b); (lk.get(b) || lk.set(b, []).get(b)).push(a);
    }
    for (const s of starts) {
      if (s[0] < 0 || s[1] < 0 || s[0] >= w || s[1] >= h) continue;
      const k = s[1] * w + s[0];
      if (dist[k] < 0) { dist[k] = 0; q[qt++] = k; }
    }
    while (qh < qt) {
      const k = q[qh++]; const x = k % w, y = (k - x) / w; const d = dist[k] + 1;
      const nb = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (dist[nk] >= 0 || !pass(nx, ny)) continue;
        dist[nk] = d; q[qt++] = nk;
      }
      const ex = lk.get(k);
      if (ex) for (const nk of ex) if (dist[nk] < 0) { dist[nk] = d; q[qt++] = nk; }
    }
    return dist;
  }

  // Sichtlinie (Bresenham, nur Ganzzahlen): blockiert, wenn eine Zwischenkachel die Sicht sperrt
  function sicht(r, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    while (!(x === x1 && y === y1)) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) break;
      if (r.sperrtSicht(x, y)) return false;
    }
    return true;
  }

  function inRects(rects, x, y) {
    for (const q of rects || []) if (x >= q[0] && x < q[0] + q[2] && y >= q[1] && y < q[1] + q[3]) return true;
    return false;
  }
  function deckLinks(karte) {
    return karte.decks && karte.decks.links ? karte.decks.links.map((l) => ({ a: l.a, b: l.b })) : [];
  }

  // ---- Platzgraph: Plätze sind Knoten, Kante = gemeinsame Grenze mit beidseitigem Durchgang ----
  function platzGraph(karte, r) {
    const ids = Object.keys(karte.plaetze || {}).sort();
    const own = new Int32Array(karte.w * karte.h).fill(-1);
    ids.forEach((id, i) => {
      const q = karte.plaetze[id].rect;
      for (let y = q[1]; y < q[1] + q[3]; y++) for (let x = q[0]; x < q[0] + q[2]; x++) own[y * karte.w + x] = i;
    });
    const adj = ids.map(() => new Set());
    for (let y = 0; y < karte.h; y++) for (let x = 0; x < karte.w; x++) {
      const a = own[y * karte.w + x]; if (a < 0 || !r.durchgang(x, y)) continue;
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (nx >= karte.w || ny >= karte.h) continue;
        const b = own[ny * karte.w + nx];
        if (b < 0 || b === a || !r.durchgang(nx, ny)) continue;
        adj[a].add(b); adj[b].add(a);
      }
    }
    // Deck-Links verbinden Plätze über die Decks
    for (const l of deckLinks(karte)) {
      const a = own[l.a[1] * karte.w + l.a[0]], b = own[l.b[1] * karte.w + l.b[0]];
      if (a >= 0 && b >= 0 && a !== b) { adj[a].add(b); adj[b].add(a); }
    }
    return { ids, own, adj: adj.map((s) => Array.from(s).sort((p, q) => p - q)) };
  }

  // Kantendisjunkte Wege (Edmonds-Karp, Einheitskapazität je Platzgrenze) von einer Quellmenge zu einer Zielmenge.
  // quellen: Platzindex oder Liste (Superquelle). Plätze, die Quelle und Ziel zugleich sind, zählen nicht als Quelle.
  function getrennteWege(adj, quellen, ziele) {
    const Q = (Array.isArray(quellen) ? quellen : [quellen]).filter((q) => q >= 0 && !ziele.includes(q));
    if (!Q.length || !ziele.length) return 0;
    const n = adj.length + 2, T = adj.length, S = adj.length + 1;
    const cap = new Map(); const key = (a, b) => a * n + b;
    const nb = adj.map((l) => l.slice()); nb.push([], []);
    for (let a = 0; a < adj.length; a++) for (const b of adj[a]) cap.set(key(a, b), 1);
    for (const z of ziele) { cap.set(key(z, T), 1000); nb[z].push(T); nb[T].push(z); }
    for (const q of Q) { cap.set(key(S, q), 1000); nb[S].push(q); nb[q].push(S); }
    let flow = 0;
    for (;;) {
      const prev = new Int32Array(n).fill(-1); prev[S] = S;
      const q = [S];
      while (q.length && prev[T] < 0) {
        const a = q.shift();
        for (const b of nb[a]) if (prev[b] < 0 && (cap.get(key(a, b)) || 0) > 0) { prev[b] = a; q.push(b); }
      }
      if (prev[T] < 0) break;
      for (let v = T; v !== S; v = prev[v]) {
        const u = prev[v];
        cap.set(key(u, v), (cap.get(key(u, v)) || 0) - 1);
        cap.set(key(v, u), (cap.get(key(v, u)) || 0) + 1);
      }
      flow++;
      if (flow > 16) break;
    }
    return flow;
  }

  // Artikulationspunkte (Engstellen im Platzgraph)
  function engstellen(adj) {
    const n = adj.length, disc = new Int32Array(n).fill(-1), low = new Int32Array(n), out = new Set();
    let t = 0;
    function dfs(u, parent) {
      disc[u] = low[u] = t++; let kids = 0;
      for (const v of adj[u]) {
        if (disc[v] < 0) {
          kids++; dfs(v, u); low[u] = Math.min(low[u], low[v]);
          if (parent >= 0 && low[v] >= disc[u]) out.add(u);
        } else if (v !== parent) low[u] = Math.min(low[u], disc[v]);
      }
      if (parent < 0 && kids > 1) out.add(u);
    }
    for (let i = 0; i < n; i++) if (disc[i] < 0) dfs(i, -1);
    return Array.from(out).sort((a, b) => a - b);
  }

  function erreichbarOhne(adj, von, nach, ohne) {
    if (!von.length || !nach.length) return null;
    const seen = new Set(ohne); const q = [];
    for (const v of von) if (!seen.has(v)) { seen.add(v); q.push(v); }
    const ziel = new Set(nach);
    while (q.length) {
      const a = q.shift(); if (ziel.has(a)) return true;
      for (const b of adj[a]) if (!seen.has(b)) { seen.add(b); q.push(b); }
    }
    return false;
  }

  // ---- Kennzahlen (§4) ----
  // cfg: CONFIG.buehne (deckungRadius, …). Ergebnis ist klein und JSON-fähig (meta.kennzahlen).
  // Prüfwerte je Kartenart (CONFIG.buehne.jeArt) überschreiben die globalen
  function cfgFuer(cfg, art) {
    const c = Object.assign({}, cfg || {});
    const j = c.jeArt && art && c.jeArt[art];
    if (j) Object.assign(c, j);
    return c;
  }
  const DECKUNG_KACHEL = { deckung_halb: 1, deckung_voll: 1, pfeiler: 1, truemmer: 1, schutt: 1, cover_low: 1, pillar: 1 };
  function kennzahlen(karte, cfg) {
    cfg = cfgFuer(cfg, karte.art);
    const R = cfg.deckungRadius != null ? cfg.deckungRadius : 2;
    const r = raster(karte);
    const w = karte.w, h = karte.h;
    const links = deckLinks(karte);
    const anker = karte.anker || [];
    const plaetze = karte.plaetze || {};

    // Gefechtsflächen: Plätze mit gefecht, sonst Bereiche mit gefecht
    const gefechtRects = [];
    const deckung = {};
    const dobj = new Uint8Array(w * h);   // Deckungsobjekte einmal vorberechnet
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r.deckungObjekt(x, y)) dobj[y * w + x] = 1;
    const coverNah = (x, y, RR) => {
      for (let dy = -RR; dy <= RR; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -RR; dx <= RR; dx++) { const xx = x + dx; if ((dx || dy) && xx >= 0 && xx < w && dobj[yy * w + xx]) return true; } }
      return false;
    };
    const anteil = (rects, rr) => {
      const RR = rr == null ? R : rr;
      let n = 0, c = 0;
      for (const q of rects) for (let y = q[1]; y < q[1] + q[3]; y++) for (let x = q[0]; x < q[0] + q[2]; x++) {
        if (!r.begehbar(x, y) || r.tuer(x, y)) continue;
        n++; if (coverNah(x, y, RR)) c++;
      }
      return n ? Math.round((c / n) * 100) / 100 : null;
    };
    const deckungNah = {};   // dasselbe mit Radius 1 (direkt neben Deckung): unterscheidet besser, Vertrag nutzt deckungRadius
    for (const id of Object.keys(plaetze).sort()) if (plaetze[id].gefecht) { gefechtRects.push(plaetze[id].rect); deckung[id] = anteil([plaetze[id].rect]); deckungNah[id] = anteil([plaetze[id].rect], 1); }
    if (!gefechtRects.length) for (const id of Object.keys(karte.bereiche || {}).sort()) {
      const b = karte.bereiche[id]; if (!b.gefecht) continue;
      for (const q of b.rects || []) gefechtRects.push(q);
      deckung[id] = anteil(b.rects || []);
    }
    const dw = Object.values(deckung).filter((v) => v != null);
    const deckungMin = dw.length ? Math.min.apply(null, dw) : null;

    // längste Sichtgasse im Gefechtsbereich: waagerechte/senkrechte Läufe begehbarer Kacheln ohne Deckung
    let gasse = 0, gasseOrt = null;
    if (gefechtRects.length) {
      const inG = new Uint8Array(w * h);
      for (const q of gefechtRects) for (let y = q[1]; y < q[1] + q[3]; y++) for (let x = q[0]; x < q[0] + q[2]; x++) if (x < w && y < h) inG[y * w + x] = 1;
      const frei = (x, y) => inG[y * w + x] && r.begehbar(x, y) && r.cover(x, y) === 0 && !r.sperrtSicht(x, y);
      for (let y = 0; y < h; y++) { let run = 0; for (let x = 0; x < w; x++) { run = frei(x, y) ? run + 1 : 0; if (run > gasse) { gasse = run; gasseOrt = { x: x - run + 1, y, dir: 'x' }; } } }
      for (let x = 0; x < w; x++) { let run = 0; for (let y = 0; y < h; y++) { run = frei(x, y) ? run + 1 : 0; if (run > gasse) { gasse = run; gasseOrt = { x, y: y - run + 1, dir: 'y' }; } } }
    }

    // Wege Ankunft -> Eingang -> Ziel
    const pass = (x, y) => r.durchgang(x, y);
    const ank = anker.find((a) => a.id === karte.ankunft) || anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
    const rolleVon = (bid) => (bid && karte.bereiche && karte.bereiche[bid] ? karte.bereiche[bid].rolle : (bid === 'ziel' || bid === 'hinein' || bid === 'rueckzug' ? bid : null));
    const zielAnker = anker.filter((a) => rolleVon(a.bereich) === 'ziel' && ZIEL_ROLLEN.includes(a.rolle));
    const ziele = zielAnker.length ? zielAnker : anker.filter((a) => a.rolle === 'ziel');
    const wege = {};
    if (ank) {
      const dA = bfs(w, h, pass, [[ank.x, ank.y]], links);
      const dZ = bfs(w, h, pass, ziele.map((a) => [a.x, a.y]), links);
      for (const e of anker.filter((a) => a.rolle === 'eingang')) {
        const a = dA[e.y * w + e.x], b = dZ[e.y * w + e.x];
        wege[e.id] = a >= 0 && b >= 0 ? a + b : null;
      }
    }

    // Platzgraph: getrennte Wege, Engstellen, Rückzug
    let wegeGetrennt = null, wegeVonAnkunft = null, eng = null, rueckzugFrei = null, schleifen = null;
    const pids = Object.keys(plaetze);
    if (pids.length) {
      const g = platzGraph(karte, r);
      const platzVon = (a) => a ? g.own[a.y * w + a.x] : -1;
      const zielP = Array.from(new Set(ziele.map(platzVon).filter((i) => i >= 0))).sort((a, b) => a - b);
      // Quellen: Ankunft + alle Eingangsplätze (jeder Ansatz zählt). Senke: Rand des Zielbereichs = Zielplätze und ihre
      // Nachbarplätze (nicht nur die Zieltür; Sichtung GD). Tore/Schotts zählen als begehbar (raster.durchgang).
      const quellen = Array.from(new Set([platzVon(ank)].concat(anker.filter((a) => a.rolle === 'eingang').map(platzVon)).filter((i) => i >= 0)));
      const qs = new Set(quellen);
      let rand = Array.from(new Set(zielP.concat(...zielP.map((i) => g.adj[i])))).filter((i) => !qs.has(i)).sort((a, b) => a - b);
      if (!rand.length) rand = zielP.filter((i) => !qs.has(i));
      wegeGetrennt = rand.length ? getrennteWege(g.adj, quellen, rand) : null;
      wegeVonAnkunft = getrennteWege(g.adj, platzVon(ank), zielP);
      // Schleifen: unabhängige Zyklen durch den Gefechtsbereich = zyklomatische Zahl (E - V + C) des ganzen Platzgraphen
      // minus die des Graphen ohne Gefechtsplätze (Zyklen über Nachbarplätze wie den Schacht der Station zählen mit)
      const gef = new Set(g.ids.map((id, i) => (plaetze[id].gefecht ? i : -1)).filter((i) => i >= 0));
      if (gef.size) {
        const zyk = (ohne) => {
          const V = g.ids.map((_, i) => i).filter((i) => !ohne.has(i));
          const VS = new Set(V);
          let E = 0; for (const i of V) for (const j of g.adj[i]) if (VS.has(j) && i < j) E++;
          let C = 0; const seen = new Set();
          for (const i of V) { if (seen.has(i)) continue; C++; const q = [i]; seen.add(i); while (q.length) { const x = q.pop(); for (const y of g.adj[x]) if (VS.has(y) && !seen.has(y)) { seen.add(y); q.push(y); } } }
          return E - V.length + C;
        };
        schleifen = zyk(new Set()) - zyk(gef);
      }
      eng = engstellen(g.adj).map((i) => g.ids[i]);
      const rueckP = g.ids.map((id, i) => (rolleVon(plaetze[id].bereich) === 'rueckzug' ? i : -1)).filter((i) => i >= 0);
      const eing = anker.filter((a) => a.rolle === 'eingang');
      if (ank && rueckP.length && zielP.length && eing.length) {
        // Eingang der Ankunft = nächster Eingang (BFS); Rückzug ist frei, wenn das Ziel den Rückzug ohne dessen Platz erreicht
        const dA = bfs(w, h, pass, [[ank.x, ank.y]], links);
        let best = null;
        for (const e of eing) { const d = dA[e.y * w + e.x]; if (d >= 0 && (!best || d < best.d)) best = { e, d }; }
        if (best) {
          const pe = platzVon(best.e);
          const von = zielP.filter((i) => i !== pe), nach = rueckP.filter((i) => i !== pe);
          rueckzugFrei = von.length && nach.length ? erreichbarOhne(g.adj, von, nach, [pe]) : true;
        }
      }
    }

    // Sichtschatten je Bereich: begehbare Kacheln, die vom Blickpunkt (Mitte) aus nicht sichtbar sind
    const schatten = {};
    for (const id of Object.keys(karte.bereiche || {}).sort()) {
      const b = karte.bereiche[id]; const rects = b.rects || [];
      if (!rects.length) continue;
      let sx = 0, sy = 0, n = 0;
      for (const q of rects) { sx += (q[0] + q[2] / 2) * q[2] * q[3]; sy += (q[1] + q[3] / 2) * q[2] * q[3]; n += q[2] * q[3]; }
      const cx = Math.floor(sx / n), cy = Math.floor(sy / n);
      let bp = null, bd = Infinity;
      for (const q of rects) for (let y = q[1]; y < q[1] + q[3]; y++) for (let x = q[0]; x < q[0] + q[2]; x++) {
        if (!r.begehbar(x, y)) continue;
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d < bd) { bd = d; bp = [x, y]; }
      }
      if (!bp) { schatten[id] = 0; continue; }
      let s = 0;
      for (const q of rects) for (let y = q[1]; y < q[1] + q[3]; y++) for (let x = q[0]; x < q[0] + q[2]; x++) {
        if (r.begehbar(x, y) && !sicht(r, bp[0], bp[1], x, y)) s++;
      }
      schatten[id] = s;
    }

    // Deckungsdichte (Sichtung GD): Anteil Deckungskacheln an der Fläche (Boden + Deckung), im Gefecht und auf
    // Füllplätzen außerhalb (nicht Gefecht, nicht Kern); Einzelblöcke = Deckungskachel ohne Deckungsnachbar (4er)
    // Bewertet werden die Module ohne Überzug (Trümmer x/X zählen dort als Boden); ueberzugPlus = Zuwachs durch den Überzug
    const UEBER = { truemmer: 1, schutt: 1 };
    const dichte = (rects, mitUeberzug) => {
      const istDeck = (x, y) => { const i = r.info(x, y); return !!i && !!DECKUNG_KACHEL[i.kind] && (mitUeberzug || !UEBER[i.kind]); };
      let fl = 0, d = 0, einzel = 0;
      for (const q of rects) for (let y = q[1]; y < q[1] + q[3]; y++) for (let x = q[0]; x < q[0] + q[2]; x++) {
        const dk = istDeck(x, y);
        const i0 = r.info(x, y);
        if (!dk && !(r.begehbar(x, y) && !r.tuer(x, y)) && !(i0 && UEBER[i0.kind])) continue;
        fl++;
        if (!dk) continue;
        d++;
        if (![[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => istDeck(x + dx, y + dy))) einzel++;
      }
      return { fl, d, einzel };
    };
    const rnd = (v) => Math.round(v * 100) / 100;
    let deckungAnteilGefecht = null, deckungAnteilAussen = null, einzelblockAnteil = null, ueberzugPlus = null, einzelblockMitUeberzug = null;
    if (pids.length) {
      const gR = [], aR = [];
      for (const id of Object.keys(plaetze).sort()) { const pl = plaetze[id]; if (pl.gefecht) gR.push(pl.rect); else if (!pl.kern) aR.push(pl.rect); }
      const g = dichte(gR), a = dichte(aR);
      if (g.fl) deckungAnteilGefecht = rnd(g.d / g.fl);
      if (a.fl) deckungAnteilAussen = rnd(a.d / a.fl);
      if (g.d + a.d) einzelblockAnteil = rnd((g.einzel + a.einzel) / (g.d + a.d));
      // Zuwachs durch den Überzug: größter Wert je Platz
      let plus = 0;
      for (const id of Object.keys(plaetze).sort()) {
        const o = dichte([plaetze[id].rect]), m = dichte([plaetze[id].rect], true);
        if (o.fl) plus = Math.max(plus, (m.d - o.d) / o.fl);
      }
      ueberzugPlus = rnd(plus);
      const gm = dichte(gR, true), am = dichte(aR, true);
      if (gm.d + am.d) einzelblockMitUeberzug = rnd((gm.einzel + am.einzel) / (gm.d + am.d));
    } else if (gefechtRects.length) {
      const g = dichte(gefechtRects);
      if (g.fl) deckungAnteilGefecht = rnd(g.d / g.fl);
      if (g.d) einzelblockAnteil = rnd(g.einzel / g.d);
    }

    let begehbar = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (r.begehbar(x, y)) begehbar++;

    const dn = Object.values(deckungNah).filter((v) => v != null);
    return { wegeVonAnkunft, schleifen, deckungAnteilGefecht, deckungAnteilAussen, einzelblockAnteil, ueberzugPlus, einzelblockMitUeberzug, deckung, deckungMin, deckungNahMin: dn.length ? Math.min.apply(null, dn) : null, sichtgasse: gasse, sichtgasseOrt: gasseOrt, wege, wegeGetrennt, engstellen: eng,
      schatten, rueckzugFrei, begehbar };
  }

  return { kennzahlen, cfgFuer, raster, bfs, sicht, tuerKacheln, platzGraph, getrennteWege, engstellen, inRects, deckLinks, fest, istTuer, ZIEL_ROLLEN };
});
