(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Gelaende = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Wildnis (GEL-01 A, Kartenart 'wildnis'): Gelände OHNE Siedlung (Überlebende suchen, Ladung bergen, Absturzstelle, Konvoi-Überfall).
  // Reine Kartenlogik wie gen-siedlung/gen-fest: deterministisch aus dem Seed, keine Dateizugriffe, kein Zufall außerhalb des Seed-PRNG.
  // Ausgabe = Roh-Objekt für Buehne.ausRaster (rows, anker, bereiche, plaetze, meta.pflicht, art).
  //
  // Ablauf: Biom-Gelände (Felsen, Bäume, Büsche, Steine, Wasser/Lava aus Rauschfeldern) -> Orte (Abholpunkt am Rand, Fundorte, Lager) mit
  // freigeräumter Umgebung -> Wege (kürzester Weg mit Rauschen, schneidet durch Hindernisse und furtet Wasser/Lava) -> Deckungsgruppen
  // (Steine) -> unerreichbare Reste zu Fels -> Anker (abholpunkt, fund, deckung, wache, patrouille).
  // Wasser a und Lava v zerschneiden die Karte nie: jeder Ort ist über einen geschnittenen Weg (Furt/Durchgang) mit der Ankunft verbunden.
  const VERSION = 3;   // 2: Boden wueste und vulkan (eigene Bodentöne statt sand/wald); 3: Ankunft nie am Südrand (Randfels verdeckt die Figur), keine Bäume in der Wüste; Cache-Invalidierung
  // Wüste ohne Bäume, bis VOX-02 Palmen/Akazien liefert (die VOX-01-Nadel-/Laubbäume passen nicht in die Wüste). true schaltet Y in der Wüste (einzeln und an der Oase) wieder ein.
  const WUESTE_BAEUME = false;
  // Seiten für die Ankunft: 0 West, 1 Ost, 2 Nord. Süd (3) fehlt mit Absicht: die Spielkamera steht südlich der Figur und blickt nach Norden, der Randfels
  // am Südrand läge davor und füllte 30-50 % des Bildes (Befund 7, Bildbeleg Wiesenwald/Vulkan). West/Ost liegen seitlich, Nord dahinter.
  const ANKUNFT_SEITEN = [0, 1, 2];
  const BIOME = ['wueste', 'wiesenwald', 'vulkan'];
  const GROESSEN = { klein: { w: 56, h: 40 }, mittel: { w: 80, h: 56 }, gross: { w: 104, h: 72 } };
  // Pflichtsatz: gilt auf JEDEM Seed jeder Größe und jedes Bioms mit Gegnern (SPL-01 a1: wache min 3, jede Gruppe stellt drei Posten; Sweep 800 Karten nie darunter).
  // Ohne Gegner (opts.gegner 'keine'/0, nur Debug/Proto) setzt der Erzeuger keine wache: dann entfällt sie aus meta.pflicht (pflichtFuer), sonst meldete der Prüfer K-PFLICHT.
  const PFLICHT = { abholpunkt: 1, fund: 2, deckung: 4, wache: 3 };
  const pflichtFuer = (gegner) => { const p = Object.assign({}, PFLICHT); if (!gegner) delete p.wache; return p; };
  const BODEN = { wueste: 'wueste', wiesenwald: 'gras', vulkan: 'vulkan' };   // Bodenton des Clients (Bauweise.boden_varianten); wueste und vulkan seit VERSION 2 eigene Töne
  const PLATZ = 'gelaende';
  const KETTEN = 'abcdefgh';

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
  // Werterauschen (bilinear, geglättet), zwei Oktaven; Werte 0..1. Nur + - * /, daher auf jeder Maschine gleich.
  function rauschen(W, H, skala, sd) {
    const out = new Float64Array(W * H);
    const okt = [[skala, 1], [Math.max(2, skala / 2), 0.5]];
    let summe = 0;
    for (const [s, gew] of okt) {
      summe += gew;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const gx = x / s, gy = y / s, ix = Math.floor(gx), iy = Math.floor(gy);
        let tx = gx - ix, ty = gy - iy;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const a = hash2(ix, iy, sd + s * 7), b = hash2(ix + 1, iy, sd + s * 7), c = hash2(ix, iy + 1, sd + s * 7), d = hash2(ix + 1, iy + 1, sd + s * 7);
        out[y * W + x] += gew * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= summe;
    return out;
  }
  // Schwelle, über der der Anteil `anteil` aller Werte liegt (Anteile statt fester Schwellen: die Dichte hängt nicht vom Rauschen ab)
  function schwelle(feld, anteil) {
    const s = Float64Array.from(feld).sort();
    return s[clamp(Math.floor(s.length * (1 - anteil)), 0, s.length - 1)];
  }
  // Min-Heap (Kosten, Index), bei gleichen Kosten entscheidet der Index: gleiche Eingabe -> gleicher Weg
  function heap() {
    const k = [], v = [];
    const kleiner = (i, j) => k[i] < k[j] || (k[i] === k[j] && v[i] < v[j]);
    const tausch = (i, j) => { const a = k[i]; k[i] = k[j]; k[j] = a; const b = v[i]; v[i] = v[j]; v[j] = b; };
    return {
      get n() { return k.length; },
      push(c, i) { k.push(c); v.push(i); let p = k.length - 1; while (p > 0) { const q = (p - 1) >> 1; if (!kleiner(p, q)) break; tausch(p, q); p = q; } },
      pop() {
        const top = v[0], l = k.length - 1;
        k[0] = k[l]; v[0] = v[l]; k.pop(); v.pop();
        let p = 0; const n = k.length;
        for (;;) { const a = 2 * p + 1, b = a + 1; let m = p; if (a < n && kleiner(a, m)) m = a; if (b < n && kleiner(b, m)) m = b; if (m === p) break; tausch(p, m); p = m; }
        return top;
      },
    };
  }

  function normiere(seed, opts) {
    opts = opts || {};
    seed = seed | 0;   // bewusst: 32-Bit-Wrap (Seeds ab 2^31 oder negativ wirken als vorzeichenbehaftete Ganzzahl); gleiche Eingabe, gleiche Karte
    const gr = GROESSEN[opts.groesse] ? opts.groesse : 'mittel';
    const grIdx = ['klein', 'mittel', 'gross'].indexOf(gr);
    const biomIn = typeof opts.biom === 'string' ? opts.biom.trim().toLowerCase() : null;   // 'Vulkan' wie 'vulkan'; leer/unbekannt/'auto': aus dem Seed
    const biom = BIOME.includes(biomIn) ? biomIn : BIOME[Math.floor(hash2(seed, 11, 0x51) * BIOME.length)];   // 'auto' oder unbekannt: aus dem Seed
    const dichte = clamp(opts.dichte == null || String(opts.dichte).trim() === '' || isNaN(+opts.dichte) ? 0.5 : +opts.dichte, 0, 1);   // '' = nicht angegeben (Standard), nicht 0
    const fundorte = opts.fundorte != null ? clamp(Math.round(+opts.fundorte) || 2, 2, 4) : 2 + Math.floor(hash2(seed, 12, 0x52) * 3);
    let gegner;
    if (opts.gegner === 'keine') gegner = 0;
    else if (opts.gegner != null && !isNaN(+opts.gegner)) gegner = clamp(Math.round(+opts.gegner), 0, KETTEN.length);
    else gegner = 1 + grIdx + Math.floor(hash2(seed, 13, 0x53) * 2);   // klein 1-2, mittel 2-3, gross 3-4 Gruppen
    // GEL-02 C: Höhlendeck darunter (nur klein und mittel); fehlt die Option oder ist sie false, bleibt die Karte byteweise wie vor GEL-02
    const hoehle = opts.hoehle === true || opts.hoehle === 1 || opts.hoehle === '1' || opts.hoehle === 'true';
    return { seed, groesse: gr, biom, dichte, fundorte, gegner, hoehle };
  }

  // ---- GEL-02 C: Höhle unter der Wildnis ----
  // Arbeitet auf der FERTIGEN Oberfläche (Zeilen und Anker bleiben unberührt, nur der Anker gelaende.leiter kommt dazu) und mit eigenem Zufallsstrom:
  // die Landschaft ist mit und ohne Höhle dieselbe. Deck gestapelt wie gen-fest (Zeilen untereinander, y-Versatz stride), Deckhöhe 0,75 x Oberfläche,
  // damit stride = Oberflächenhöhe (kein Auffüllen, K-DECK ohne Sonderfall; höhere Decks sprengen die awayMap-Grenze). Wirft, wenn kein Eingang passt (Aufrufer: Seed + 1).
  const HOEHLE_GROESSEN = ['klein', 'mittel'];
  const HOEHLE_DECK_ANTEIL = 0.75;
  function hoehleFehlerGroesse() { return new Error('Gelände: Höhle unter Wildnis gibt es nur für klein und mittel'); }
  function hoehleDazu(roh, P) {
    const Hoehle = require('./gen-hoehle.js');
    const W = roh.w, S = roh.h, seed = P.seed;
    const A = roh.anker.find((a) => a.ankunft);
    const begehbar = (x, y) => x >= 0 && y >= 0 && x < W && y < S && (roh.rows[y][x] === ':' || roh.rows[y][x] === 's');
    const d = new Int32Array(W * S).fill(-1), q = [A.y * W + A.x]; d[q[0]] = 0;
    for (let i = 0; i < q.length; i++) {
      const u = q[i], ux = u % W, uy = (u - ux) / W;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const x = ux + dx, y = uy + dy; if (begehbar(x, y) && d[y * W + x] < 0) { d[y * W + x] = d[u] + 1; q.push(y * W + x); } }
    }
    // Lagermitten (Mitte des Gefechtsbereichs): der Eingang liegt nicht im Lager
    const lagerMitten = Object.values(roh.bereiche).filter((b) => b.gefecht).map((b) => [b.rects[0][0] + (b.rects[0][2] - 1) / 2, b.rects[0][1] + (b.rects[0][3] - 1) / 2]);
    const minAbstand = 0.6 * Math.round(0.30 * (W + S) / 2);   // 0,6 x Abstandsvorgabe der Fundorte zur Ankunft
    const kand = [];
    for (let y = 3; y < S - 4; y++) for (let x = 4; x < W - 4; x++) {
      if (d[y * W + x] < 0 || Math.hypot(x - A.x, y - A.y) < minAbstand) continue;
      let frei = true;   // Umgebung Radius 1 nur freier Boden ':' (kein Stein, Busch, Wasser, Lava, Fels)
      for (let dy = -1; dy <= 1 && frei; dy++) for (let dx = -1; dx <= 1; dx++) if (roh.rows[y + dy][x + dx] !== ':') { frei = false; break; }
      if (!frei) continue;
      if (roh.anker.some((a) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) < 4)) continue;
      if (lagerMitten.some((m) => Math.hypot(m[0] - x, m[1] - y) < 7)) continue;
      kand.push([x, y]);
    }
    if (!kand.length) throw new Error(`Gelände: kein Platz für den Höhleneingang (Seed ${seed})`);
    const Rh = rng(fnv('gelaende-hoehle', seed >>> 0) ^ 0x4C0FFEE1);
    const E = kand[Rh.int(kand.length)];
    const hoehe = Math.round(HOEHLE_DECK_ANTEIL * S), stride = S;
    // Anzahl Fundorte und Gruppen unten: klein 2 (das Deck verlangt mindestens 2 Funde), mittel 2-3; Gruppen 1-2. Die Oberfläche erfüllt ihre Pflicht allein.
    const deckFund = P.groesse === 'klein' ? 2 : 2 + Math.floor(hash2(seed, 31, 0x71) * 2);
    const deckGegner = P.gegner === 0 ? 0 : 1 + Math.floor(hash2(seed, 32, 0x72) * 2);
    const deck = Hoehle.erzeuger().deckRoh(seed, { w: W, hoehe, eingangX: E[0], fundorte: deckFund, gegner: deckGegner, dichte: P.dichte });
    const U = deck.anker.find((a) => a.rolle === 'leiter');
    const oben = roh.anker.concat([{ id: 'gelaende.leiter', rolle: 'leiter', x: E[0], y: E[1], platz: PLATZ, bereich: PLATZ }]);
    oben.sort((a, b) => (a.rolle < b.rolle ? -1 : a.rolle > b.rolle ? 1 : 0) || a.y - b.y || a.x - b.x);
    roh.anker = oben.concat(deck.anker.map((a) => Object.assign({}, a, { y: a.y + stride })));
    roh.rows = roh.rows.concat(deck.rows);
    roh.h = roh.rows.length;
    for (const [id, b] of Object.entries(deck.bereiche)) roh.bereiche[id] = Object.assign({}, b, { rects: b.rects.map((r) => [r[0], r[1] + stride, r[2], r[3]]) });
    roh.plaetze.hoehle = Object.assign({}, deck.plaetze.hoehle, { rect: deck.plaetze.hoehle.rect.map((v, i) => (i === 1 ? v + stride : v)) });
    roh.decks = { stride, links: [{ a: [E[0], E[1]], b: [U.x, U.y + stride], via: 'leiter' }] };
    roh.meta.pflicht = Object.assign({}, roh.meta.pflicht, { leiter: 1 });
    roh.meta.boden2 = deck.meta.boden2;
    roh.meta.hoehle = true;
    return roh;
  }

  function erzeuger() {
    function karteRoh(seed, opts) {
      const P = normiere(seed, opts);
      opts = opts || {};
      seed = P.seed;
      if (P.hoehle && !HOEHLE_GROESSEN.includes(P.groesse)) throw hoehleFehlerGroesse();
      const { w: W, h: H } = GROESSEN[P.groesse];
      const N = W * H, flaeche = (W - 2) * (H - 2);
      const R = rng(fnv('gelaende', seed >>> 0) ^ 0x9E3779B1);
      const g = new Array(N).fill(':');
      const ix = (x, y) => y * W + x;
      const innen = (x, y) => x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2;
      const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? '#' : g[y * W + x]);
      const set = (x, y, c) => { if (innen(x, y)) g[y * W + x] = c; };
      const sd = (n) => (fnv('n' + n, seed >>> 0) | 0);
      const D = P.dichte;
      const weg = new Uint8Array(N);       // geschnittene Wege (bleiben frei von Steinen)
      const gesperrt = new Uint8Array(N);  // Umgebung von Orten: keine Steine
      const FEST = { F: 1, Y: 1, o: 1, O: 1, I: 1, a: 1, v: 1, '~': 1 };
      const frei = (x, y) => at(x, y) === ':' || at(x, y) === 's';   // begehbar

      // ---- Rand ----
      for (let x = 0; x < W; x++) { g[ix(x, 0)] = 'F'; g[ix(x, H - 1)] = 'F'; }
      for (let y = 0; y < H; y++) { g[ix(0, y)] = 'F'; g[ix(W - 1, y)] = 'F'; }
      { const nr = rauschen(W, H, 5, sd(1)), t = schwelle(nr, 0.28);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if ((x === 1 || y === 1 || x === W - 2 || y === H - 2) && nr[ix(x, y)] > t) g[ix(x, y)] = 'F'; }

      // ---- Bausteine des Geländes ----
      const kreis = (cx, cy, r, c, nur) => { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r && innen(x, y) && (!nur || nur.includes(at(x, y)))) set(x, y, c); };
      // Steinhaufen: Zufallsgang um (cx, cy), Steine o/O (anteilO) nur auf freiem Boden abseits von Wegen und Orten
      const steine = (cx, cy, n, anteilO, ausgabe) => {
        let x = cx, y = cy, gesetzt = 0;
        for (let v = 0; v < n * 6 && gesetzt < n; v++) {
          x += R.range(-1, 1); y += R.range(-1, 1);
          if (!innen(x, y) || at(x, y) !== ':' || weg[ix(x, y)] || gesperrt[ix(x, y)]) continue;
          set(x, y, R.chance(anteilO) ? 'O' : 'o'); gesetzt++;
          if (ausgabe) ausgabe.push([x, y]);
        }
        return gesetzt;
      };
      const haufen = (anzahl, lo, hi, anteilO) => { for (let i = 0; i < anzahl; i++) steine(R.range(3, W - 4), R.range(3, H - 4), R.range(lo, hi), anteilO); };
      const buschGruppen = (anzahl, lo, hi, r) => {
        for (let i = 0; i < anzahl; i++) {
          const cx = R.range(3, W - 4), cy = R.range(3, H - 4), n = R.range(lo, hi);
          for (let k = 0; k < n; k++) { const x = cx + R.range(-r, r), y = cy + R.range(-r, r); if (innen(x, y) && at(x, y) === ':') set(x, y, 's'); }
        }
      };
      const einzeln = (anzahl, c) => { for (let i = 0; i < anzahl; i++) { const x = R.range(2, W - 3), y = R.range(2, H - 3); if (at(x, y) === ':') set(x, y, c); } };

      // ---- Biome ----
      let bachPunkte = null;   // wiesenwald: Mittellinie des Bachs (für die Furten)
      if (P.biom === 'wueste') {
        // Mesas: wenige große Felsblöcke und Rücken; viele Steine; Bäume nur vereinzelt (und an der Oase); Büsche sparsam; selten eine kleine Oase
        const f = rauschen(W, H, 13, sd(2)), f2 = rauschen(W, H, 5, sd(3));
        const t = schwelle(f, 0.10 + 0.09 * D);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (f[ix(x, y)] * 0.8 + f2[ix(x, y)] * 0.2 > t * 0.98) g[ix(x, y)] = 'F';
        haufen(Math.round(flaeche / 85 * (0.5 + D)), 3, 7, 0.35);
        buschGruppen(Math.round(flaeche / 520 * (0.5 + D)), 2, 5, 2);
        if (WUESTE_BAEUME) einzeln(Math.round(flaeche / 520), 'Y');
        if (R.chance(0.45)) {
          const ox = R.range(8, W - 9), oy = R.range(7, H - 8), rx = R.range(2, 3);
          kreis(ox, oy, rx + 0.5, 'a'); for (let y = oy - 4; y <= oy + 4; y++) for (let x = ox - 5; x <= ox + 5; x++) {
            const d = Math.hypot(x - ox, y - oy);
            if (innen(x, y) && at(x, y) !== 'a' && d <= rx + 2.5 && R.chance(0.35)) set(x, y, d > rx + 1.2 && WUESTE_BAEUME && R.chance(0.5) ? 'Y' : 's');
          }
        }
      } else if (P.biom === 'wiesenwald') {
        // Waldblöcke mit Buschsaum und Lichtungen, ein Bach quer durch mit Furten, Steine nur vereinzelt
        const f = rauschen(W, H, 8, sd(2)), f2 = rauschen(W, H, 5, sd(3)), f3 = rauschen(W, H, 6, sd(4));
        const anteil = 0.24 + 0.24 * D, t = schwelle(f, anteil), tSaum = schwelle(f, anteil + 0.10), tLicht = schwelle(f3, 0.16);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = ix(x, y), v = f[i] * 0.75 + f2[i] * 0.25 * 1.0;
          if (v > t * 0.99 && f3[i] < tLicht) g[i] = 'Y';
          else if (v > tSaum * 0.99 && f2[i] > 0.48 && f3[i] < tLicht) g[i] = 's';
        }
        buschGruppen(Math.round(flaeche / 700), 2, 4, 2);
        haufen(Math.round(flaeche / 520 * (0.5 + D)), 2, 4, 0.2);
        // Felsgruppen vereinzelt
        for (let i = 0, n = Math.round(flaeche / 900); i < n; i++) { const cx = R.range(4, W - 5), cy = R.range(4, H - 5); kreis(cx, cy, R.range(1, 2) + 0.4, 'F', [':', 's']); }
        // Bach
        const waag = R.chance(0.5), L = waag ? W : H, Q = waag ? H : W;
        let c = R.range(Math.floor(Q * 0.3), Math.floor(Q * 0.7)), drift = 0;
        const wn = rauschen(L, 1, 6, sd(5));
        bachPunkte = [];
        for (let t2 = 0; t2 < L; t2++) {
          if (R.chance(0.35)) drift = clamp(drift + R.range(-1, 1), -1, 1);
          if (R.chance(0.55)) c += drift;
          if (c < 5) { c = 5; drift = 1; } else if (c > Q - 6) { c = Q - 6; drift = -1; }
          const br = wn[t2] > 0.62 ? 3 : 2;
          bachPunkte.push({ t: t2, c, br });
          for (let k = -1; k <= br - 1; k++) { const x = waag ? t2 : c + k, y = waag ? c + k : t2; if (innen(x, y)) set(x, y, 'a'); }
        }
        // Furten: begehbare Stellen, 2 bis 3 Stück, weit auseinander
        const nF = L > 90 ? 3 : 2; const pos = [];
        for (let v = 0; v < 40 && pos.length < nF; v++) { const p = R.range(Math.floor(L * 0.15), Math.floor(L * 0.85)); if (pos.every((q) => Math.abs(q - p) >= Math.floor(L / 4))) pos.push(p); }
        for (const p of pos) for (let t2 = p; t2 < p + 3 && t2 < L - 1; t2++) { const b = bachPunkte[t2]; for (let k = -2; k <= b.br + 1; k++) { const x = waag ? t2 : b.c + k, y = waag ? b.c + k : t2; if (innen(x, y)) { set(x, y, ':'); weg[ix(x, y)] = 1; } } }
      } else {
        // vulkan: viel Fels, Lavaströme und -seen (Durchgänge schneiden die Wege), Steine und Felsbrocken als Deckung, keine Bäume, kaum Büsche
        const f = rauschen(W, H, 9, sd(2)), f2 = rauschen(W, H, 4, sd(3)), fl = rauschen(W, H, 15, sd(4)), fs = rauschen(W, H, 7, sd(5));
        const t = schwelle(f, 0.20 + 0.16 * D);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (f[ix(x, y)] * 0.7 + f2[ix(x, y)] * 0.3 > t * 0.99) g[ix(x, y)] = 'F';
        // Ströme: Höhenlinie des Rauschens (dünn, gewunden); Seen: die höchsten Spitzen eines zweiten Felds
        const rid = new Float64Array(N); for (let i = 0; i < N; i++) rid[i] = Math.abs(fl[i] - 0.5);
        const tr = Float64Array.from(rid).sort()[Math.floor(N * (0.06 + 0.03 * D))], ts = schwelle(fs, 0.012 + 0.012 * D);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = ix(x, y); if (rid[i] <= tr || fs[i] >= ts) g[i] = 'v'; }
        haufen(Math.round(flaeche / 110 * (0.5 + D)), 3, 6, 0.5);
        for (let i = 0, n = Math.round(flaeche / 160); i < n; i++) { const cx = R.range(3, W - 4), cy = R.range(3, H - 4); kreis(cx, cy, R.range(1, 2) + 0.3, 'F', [':']); }
        if (R.chance(0.3)) buschGruppen(1, 2, 3, 1);
      }

      // ---- Orte ----
      const naeherAls = (a, b, r) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) < r * r;
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const ohneFluessig = (cx, cy, r) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const c = at(x, y); if (c === 'a' || c === 'v') return false; } return true; };
      // Abholpunkt am Rand (zwei Kacheln hinter der Randfelskante), Seite und Lage aus dem Seed
      const seite = ANKUNFT_SEITEN[R.int(ANKUNFT_SEITEN.length)], lage = 0.25 + R.f() * 0.5;
      const A = seite === 0 ? [2, Math.round(2 + (H - 5) * lage)] : seite === 1 ? [W - 3, Math.round(2 + (H - 5) * lage)] : seite === 2 ? [Math.round(2 + (W - 5) * lage), 2] : [Math.round(2 + (W - 5) * lage), H - 3];
      const sperre = (cx, cy, r) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (innen(x, y)) gesperrt[ix(x, y)] = 1; };
      kreis(A[0], A[1], 3.5, ':'); sperre(A[0], A[1], 3);
      const dA = Math.round(0.30 * (W + H) / 2), dF = Math.round(0.20 * (W + H) / 2);
      // Fundorte: Kandidaten aus dem Seed, weit von der Ankunft und voneinander, nicht in/an Wasser oder Lava
      const funde = [];
      for (let i = 0; i < P.fundorte; i++) {
        // Stufen: erst strenge Abstände und freie Umgebung (Radius 5 ohne Wasser/Lava), dann Radius 3, dann kürzere Abstände; nie ohne Abstände
        let best = null;
        for (const [fr, f] of [[5, 1], [3, 1], [2, 0.8], [1, 0.6], [0, 0.45]]) {
          for (let v = 0; v < 70; v++) {
            const p = [R.range(6, W - 7), R.range(6, H - 7)];
            if (fr && !ohneFluessig(p[0], p[1], fr)) continue;
            if (!fr && 'av'.includes(at(p[0], p[1]))) continue;
            if (dist(p, A) < dA * f || funde.some((q) => dist(p, q) < dF * f)) continue;
            const dm = Math.min(dist(p, A) * 0.8, ...funde.map((q) => dist(p, q)));
            if (!best || dm > best.dm) best = { p, dm };
          }
          if (best) break;
        }
        if (!best) throw new Error(`Gelände: kein Platz für Fundort ${i + 1} (Seed ${seed})`);
        funde.push(best.p); kreis(best.p[0], best.p[1], 3.5, ':'); sperre(best.p[0], best.p[1], 3);
      }
      // Lager: die ersten bei den am weitesten entfernten Fundorten (bewachen sie), weitere frei im Gelände
      const lager = [];
      const nachFerne = funde.slice().sort((p, q) => dist(q, A) - dist(p, A) || p[0] - q[0] || p[1] - q[1]);
      for (let i = 0; i < P.gegner; i++) {
        let c = null;
        for (let v = 0; v < 400 && !c; v++) {
          const stufe = v < 80 ? 0 : v < 160 ? 1 : v < 240 ? 2 : 3;   // spätere Runden: geringerer Abstand zur Ankunft und zu Wasser/Lava (enge oder zerklüftete Karten)
          let p;
          if (i < nachFerne.length) { const a = R.f() * Math.PI * 2, r = 6 + R.f() * 3; p = [Math.round(nachFerne[i][0] + Math.cos(a) * r), Math.round(nachFerne[i][1] + Math.sin(a) * r)]; }
          else p = [R.range(8, W - 9), R.range(8, H - 9)];
          if (p[0] < 7 || p[1] < 7 || p[0] > W - 8 || p[1] > H - 8) continue;
          if (!ohneFluessig(p[0], p[1], [4, 2, 1, 0][stufe])) continue;
          if (dist(p, A) < dA * [0.9, 0.6, 0.45, 0.3][stufe] || funde.some((q) => dist(p, q) < 5) || lager.some((q) => dist(p, q.c) < 13)) continue;
          c = p;
        }
        if (!c) continue;   // kein Platz: weniger Gruppen (kommt auf kleinen Karten vor)
        lager.push({ c, nr: lager.length });
        kreis(c[0], c[1], 4.5, ':'); sperre(c[0], c[1], 3);
      }
      // ---- Wege: Prim über alle Orte, dazu ein bis zwei Schleifen; kürzester Weg mit Rauschen, Wasser/Lava nur als Furt ----
      const orte = [{ p: A, art: 'a' }].concat(funde.map((p) => ({ p, art: 'f' })), lager.map((l) => ({ p: l.c, art: 'l' })));
      const wn = rauschen(W, H, 5, sd(6));
      const KOSTEN = { ':': 1, s: 1.4, o: 3.5, O: 4, Y: 3.2, F: 6.5, a: 9, v: 11, I: 4 };
      const dijkstra = (von, nach) => {
        const d = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), hp = heap();
        const s = ix(von[0], von[1]), z = ix(nach[0], nach[1]);
        d[s] = 0; hp.push(0, s);
        while (hp.n) {
          const u = hp.pop(); if (u === z) break;
          const ux = u % W, uy = (u - ux) / W, du = d[u];
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const x = ux + dx, y = uy + dy; if (!innen(x, y)) continue;
            const v = ix(x, y), c = KOSTEN[g[v]]; if (c == null) continue;
            const nd = du + (weg[v] ? 0.35 : c * (1 + 1.1 * wn[v]));
            if (nd < d[v] - 1e-9) { d[v] = nd; prev[v] = u; hp.push(nd, v); }
          }
        }
        const pfad = []; for (let k = z; k !== -1; k = prev[k]) pfad.push(k);
        return pfad.reverse();
      };
      const wege = [];
      const schneide = (pfad) => {
        for (let k = 0; k < pfad.length; k++) {
          const i = pfad[k], x = i % W, y = (i - x) / W, nass = g[i] === 'a' || g[i] === 'v';
          g[i] = ':'; weg[i] = 1;
          const nx = pfad[Math.min(k + 1, pfad.length - 1)], px = pfad[Math.max(k - 1, 0)];
          const hz = Math.abs((nx % W) - (px % W)) >= Math.abs(Math.floor(nx / W) - Math.floor(px / W));   // Laufrichtung waagerecht -> Breite senkrecht
          const seitl = hz ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
          const sg = R.chance(0.5) ? 0 : 1;
          const [bx, by] = [x + seitl[sg][0], y + seitl[sg][1]];
          if (innen(bx, by) && (nass || R.chance(0.45)) && at(bx, by) !== 'F') { g[ix(bx, by)] = ':'; weg[ix(bx, by)] = 1; }
        }
      };
      const verbunden = [0], offen = []; for (let i = 1; i < orte.length; i++) offen.push(i);
      const kanten = [];
      while (offen.length) {
        let best = null;
        for (const o of offen) for (const v of verbunden) { const d = dist(orte[o].p, orte[v].p); if (!best || d < best.d - 1e-9) best = { d, o, v }; }
        kanten.push([best.v, best.o]); verbunden.push(best.o); offen.splice(offen.indexOf(best.o), 1);
      }
      for (let n = 0, versuche = 0; n < (P.groesse === 'klein' ? 1 : 2) && versuche < 30; versuche++) {
        const a = R.int(orte.length), b = R.int(orte.length);
        if (a === b || kanten.some((k) => (k[0] === a && k[1] === b) || (k[0] === b && k[1] === a))) continue;
        if (dist(orte[a].p, orte[b].p) > 0.6 * (W + H) / 2) continue;
        kanten.push([a, b]); n++;
      }
      for (const [a, b] of kanten) { const pfad = dijkstra(orte[a].p, orte[b].p); schneide(pfad); wege.push({ a, b, pfad }); }

      // ---- Deckungsgruppen (Steine) und Deckungsanker ----
      const deckungsAnker = [];
      const belegt = new Set();
      const belege = (x, y) => belegt.add(ix(x, y));
      belege(A[0], A[1]); for (const p of funde) belege(p[0], p[1]);
      const gruppeMit = (cx, cy, n) => {
        const st = [];
        steine(cx, cy, n, P.biom === 'vulkan' ? 0.5 : 0.3, st);
        if (!st.length) return 0;
        // Ankerplätze neben den Steinen: begehbar, nicht in der Pad-/Fundumgebung, höchstens zwei, mindestens 2 Kacheln auseinander
        const kand = [];
        for (const [sx, sy] of st) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) {
          const x = sx + dx, y = sy + dy;
          if (innen(x, y) && at(x, y) === ':' && !belegt.has(ix(x, y)) && !gesperrt[ix(x, y)]) kand.push([x, y]);
        }
        R.shuffle(kand);
        let k = 0;
        for (const [x, y] of kand) {
          if (k >= 2) break;
          if (deckungsAnker.some((q) => Math.abs(q[0] - x) <= 1 && Math.abs(q[1] - y) <= 1)) continue;
          deckungsAnker.push([x, y]); belege(x, y); k++;
        }
        return st.length;
      };
      // Orte bekommen ihre Steine außerhalb der gesperrten Kreise, daher von dort aus gestreut
      const nahe = (p, rmin, rmax, n) => {
        for (let v = 0; v < 30; v++) {
          const a = R.f() * Math.PI * 2, r = rmin + R.f() * (rmax - rmin), x = Math.round(p[0] + Math.cos(a) * r), y = Math.round(p[1] + Math.sin(a) * r);
          if (innen(x, y) && at(x, y) === ':' && !weg[ix(x, y)] && !gesperrt[ix(x, y)] && gruppeMit(x, y, n)) return true;
        }
        return false;
      };
      for (const p of funde) nahe(p, 4, 6, R.range(3, 5));
      for (const l of lager) for (let k = 0, m = R.range(2, 3); k < m; k++) nahe(l.c, 4, 6.5, R.range(2, 4));
      for (const wg of wege) {   // zwischen den Orten: ein Haufen abseits des Wegs auf etwa 35-65 % der Strecke
        const L = wg.pfad.length; if (L < 10) continue;
        for (let k = 0; k < 1; k++) {
          const i = wg.pfad[Math.floor(L * (0.3 + R.f() * 0.4))], x = i % W, y = (i - x) / W;
          const a = R.chance(0.5) ? 1 : -1, off = R.range(2, 4);
          for (const [bx, by] of [[x + a * off, y], [x, y + a * off], [x - a * off, y], [x, y - a * off]]) if (innen(bx, by) && at(bx, by) === ':' && !weg[ix(bx, by)] && !gesperrt[ix(bx, by)] && gruppeMit(bx, by, R.range(2, 4))) break;
        }
      }
      // Reserve: bleiben es zu wenige Deckungsplätze (z. B. dichter Wald), weitere Gruppen auf freien Stellen
      for (let v = 0; v < 120 && deckungsAnker.length < PFLICHT.deckung + 2; v++) gruppeMit(R.range(3, W - 4), R.range(3, H - 4), 3);

      // ---- Unerreichbares zu Fels (Taschen hinter Wasser/Lava/Fels); K-INSEL meldet begehbare Inseln ----
      const erreicht = new Uint8Array(N);
      { const q = [ix(A[0], A[1])]; erreicht[q[0]] = 1;
        for (let h = 0; h < q.length; h++) { const u = q[h], ux = u % W, uy = (u - ux) / W;
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const x = ux + dx, y = uy + dy; if (!innen(x, y)) continue; const v = ix(x, y); if (!erreicht[v] && (g[v] === ':' || g[v] === 's')) { erreicht[v] = 1; q.push(v); } } } }
      for (let i = 0; i < N; i++) if (!erreicht[i] && (g[i] === ':' || g[i] === 's')) g[i] = 'F';
      for (const p of funde) if (!erreicht[ix(p[0], p[1])]) throw new Error(`Gelände: Fundort ${p} nicht erreichbar (Seed ${seed})`);

      // ---- Anker ----
      const roh = [];
      const ank = (rolle, p, attr, bereich) => roh.push(Object.assign({ rolle, x: p[0], y: p[1], platz: PLATZ, bereich: bereich || PLATZ }, attr || {}));
      ank('abholpunkt', A, { ankunft: true });
      for (const p of funde) ank('fund', p);
      for (const p of deckungsAnker) if (erreicht[ix(p[0], p[1])] && at(p[0], p[1]) === ':') ank('deckung', p);
      const bereiche = { [PLATZ]: { name: 'Gelände', rects: [[1, 1, W - 2, H - 2]] } };
      const besetzt = new Set(roh.map((a) => ix(a.x, a.y)));
      for (const l of lager) {
        const bid = 'lager_' + (l.nr + 1), r = 10;
        const x0 = Math.max(1, l.c[0] - r), y0 = Math.max(1, l.c[1] - r), x1 = Math.min(W - 2, l.c[0] + r), y1 = Math.min(H - 2, l.c[1] + r);
        bereiche[bid] = { name: 'Lager ' + (l.nr + 1), rects: [[x0, y0, x1 - x0 + 1, y1 - y0 + 1]], gefecht: true };
        // Wachen: drei Posten im Lagerkreis (Chebyshev-Abstand >= 2), der erste jeder zweiten Gruppe ist ein Wächter (schwer)
        const kand = [];
        for (let y = l.c[1] - 4; y <= l.c[1] + 4; y++) for (let x = l.c[0] - 4; x <= l.c[0] + 4; x++) if (innen(x, y) && at(x, y) === ':' && erreicht[ix(x, y)] && !besetzt.has(ix(x, y)) && Math.hypot(x - l.c[0], y - l.c[1]) <= 4.2) kand.push([x, y]);
        R.shuffle(kand);
        const posten = [];
        for (const p of kand) { if (posten.length >= 3) break; if (posten.every((q) => Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) >= 2)) posten.push(p); }
        posten.forEach((p, k) => { besetzt.add(ix(p[0], p[1])); ank('wache', p, k === 0 && l.nr % 2 === 0 ? { schwer: true } : {}, bid); });
        // Patrouille: drei Punkte auf einem Ring um das Lager, Kette je Gruppe
        const a0 = R.f() * Math.PI * 2, pp = [];
        for (let k = 0; k < 3; k++) {
          const a = a0 + k * Math.PI * 2 / 3;
          let tp = null;
          for (const rr of [8, 7, 9, 6, 10]) for (let da = 0; da < 1 && !tp; da += 0.25) {
            const x = Math.round(l.c[0] + Math.cos(a + da) * rr), y = Math.round(l.c[1] + Math.sin(a + da) * rr);
            if (innen(x, y) && at(x, y) === ':' && erreicht[ix(x, y)] && !besetzt.has(ix(x, y)) && pp.every((q) => Math.max(Math.abs(q[0] - x), Math.abs(q[1] - y)) >= 4)) tp = [x, y];
          }
          if (tp) { pp.push(tp); besetzt.add(ix(tp[0], tp[1])); ank('patrouille', tp, { kette: KETTEN[l.nr] }, bid); }
        }
      }
      roh.sort((a, b) => (a.rolle < b.rolle ? -1 : a.rolle > b.rolle ? 1 : 0) || a.y - b.y || a.x - b.x);
      const zz = {}; for (const a of roh) zz[a.rolle] = (zz[a.rolle] || 0) + 1;
      const lauf = {};
      const anker = roh.map((a) => { lauf[a.rolle] = (lauf[a.rolle] || 0) + 1; return Object.assign({ id: zz[a.rolle] > 1 ? `${PLATZ}.${a.rolle}.${lauf[a.rolle]}` : `${PLATZ}.${a.rolle}` }, a); });

      const rows = []; for (let y = 0; y < H; y++) rows.push(g.slice(y * W, (y + 1) * W).join(''));
      // sig: mit Höhle kommen die Option und die Erzeugerversion der Höhle dazu (sonst ändert sich die Signatur nicht, ohne Höhle bleibt sie wie vor GEL-02)
      const sig = fnv(JSON.stringify(P.hoehle ? [P.biom, P.groesse, P.dichte, P.fundorte, P.gegner, 'hoehle', require('./gen-hoehle.js').VERSION] : [P.biom, P.groesse, P.dichte, P.fundorte, P.gegner])).toString(36);
      const ab = anker.filter((a) => a.rolle === 'abholpunkt');
      const karte = {
        id: opts.id || null, erzeuger: 'gen-gelaende/1', art: 'wildnis', bauweise: opts.bauweise || 'germanen', besitz: opts.besitz || null,
        zustand: opts.zustand || 'intakt', seed, bauversion: `gelaende.${VERSION}[${sig}]`, schablone: 'gen-gelaende', spiegel: null, w: W, h: H, rows, legende: null, anker,
        bereiche, plaetze: { [PLATZ]: { typ: 'gelaende', modul: 'gen-gelaende', lage: { rot: 0, spiegel: false, aussen: null }, rect: [1, 1, W - 2, H - 2], bereich: PLATZ } },
        eingaenge: [], abholpunkte: ab.map((a) => a.id), ankunft: (ab.find((a) => a.ankunft) || {}).id || null,
        patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
        meta: { versuche: 1, kennzahlen: null, linear: false, pflicht: pflichtFuer(P.gegner), zellen: null, schiffDecks: null, torStart: 'offen', huelle: true, typ: 'wildnis', titel: {},
          biom: P.biom, boden: BODEN[P.biom] },
      };
      return P.hoehle ? hoehleDazu(karte, P) : karte;
    }
    return { karteRoh };
  }
  return { erzeuger, PFLICHT, BIOME, GROESSEN, VERSION, HOEHLE_GROESSEN };
});
