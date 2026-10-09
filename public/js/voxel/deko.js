// B1 Team VOXEL – Deko-Regeln (CONTRACT-B1 §10.3, §3.4 AD 6; ART-PLAN §4/§6).
// Streut Deko-Props deterministisch aus Karten-Seed und Platz. Reine Funktion ohne three.js (läuft auch in Node).
// Regeln (Art-Daten content/buehnen/deko/<bauweise>.json):
//   { format: "deko/1", regeln: { <platztyp>|"*": { props: [ids], dichte: [min, max], wandnah: bool, frei_halten: 2 } } }
// Harte Grenzen (Vertrag, nicht per Daten abschaltbar):
//   - nie auf Anker-, Tür-, Weg- oder Kantenmitte-Kacheln, nie auf festen Kacheln
//   - höchstens 12 Props je Zelle (8×8), Deko ist nur Optik (keine Kollision), Deckung wird nie gestreut
// Ergebnis: [{ id, x, y, rot, seed, platz, dx, dz }] in Kacheln (x, y = Kachel; dx/dz Versatz in der Kachel, −0,25…0,25 m).

export const MAX_JE_ZELLE = 12;
const ZELLE = 8;
// begehbare Untergründe, auf denen Deko liegen darf (Weg ',' / Pad / Rampe / Plateau-Kante nie)
const DEKO_BODEN = { boden: 1, gelaende: 1, plateau: 1 };
const WEG = { boden2: 1, pad: 1, rampe: 1 };
const TUER = { tuer: 1, schott: 1, tor: 1, luke: 1, wand_schwach: 1 };
const WANDNAH = { wand: 1, zaun: 1, fels: 1, gitter: 1, fenster: 1, pfeiler: 1, kante: 1 };

function fnv(str, h) {
  h = h == null ? 0x811c9dc5 : h;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plätze ohne awayMap.plaetze aus den Anker-IDs (<platz>.<rolle>[.n]) ableiten: Zelle(n) mit Ankern des Platzes, Typ = ID ohne _n. */
export function plaetzeAbleiten(k) {
  const by = new Map();
  for (const a of k.anker || []) {
    const pid = String(a.platz || String(a.id || '').split('.')[0] || '');
    if (!pid) continue;
    let p = by.get(pid);
    if (!p) { p = { id: pid, typ: pid.replace(/_\d+$/, ''), zellen: new Set() }; by.set(pid, p); }
    p.zellen.add(Math.floor(a.x / ZELLE) + ',' + Math.floor(a.y / ZELLE));
  }
  const out = [];
  for (const id of [...by.keys()].sort()) {
    const p = by.get(id);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const z of p.zellen) { const [cx, cy] = z.split(',').map(Number); x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); }
    out.push({ id, typ: p.typ, x: x0 * ZELLE, y: y0 * ZELLE, w: (x1 - x0 + 1) * ZELLE, h: (y1 - y0 + 1) * ZELLE, abgeleitet: true });
  }
  return out;
}

/** Kantenmitte: Kachelindex 3 und 4 entlang einer Zellkante (CONTRACT-B1 §3.2). Schiff: Längsgänge (Zeile 2/6/10 je Deck). */
export function istKantenmitte(x, y, k) {
  if (k && k.art === 'schiff') {
    const ly = ((y % (k.stride || 16)) + (k.stride || 16)) % (k.stride || 16);
    return ly === 2 || ly === 6 || ly === 10;
  }
  const lx = x % ZELLE, ly = y % ZELLE;
  if ((lx === 3 || lx === 4) && (ly === 0 || ly === 7)) return true;
  if ((ly === 3 || ly === 4) && (lx === 0 || lx === 7)) return true;
  return false;
}

/**
 * k: { w, h, seed, art, kindAt(x, y) → kind|null, anker: [{ x, y }], plaetze?: [{ id, typ, x, y, w, h }] }
 * regeln: Objekt aus deko/<bauweise>.json (oder dessen .regeln); extra: zusätzliche Props (Besitz-Streuung, geringe Dichte),
 *   je Eintrag ID oder { id, wandnah: true } (nur an Wand/Zaun, Rücken zur Wand; Wunsch ART-PALETTEN)
 */
export function streuen(k, regeln, opts = {}) {
  const R = (regeln && regeln.regeln) || regeln || {};
  const extra = (opts.extra || []).map((e) => (typeof e === 'string' ? { id: e, wandnah: false } : e && e.id ? { id: e.id, wandnah: !!e.wandnah } : null)).filter(Boolean);
  if (!Object.keys(R).length && !extra.length) return [];
  const W = k.w, H = k.h;
  const kind = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : k.kindAt(x, y));
  // gesperrte Kacheln: Anker (+ frei_halten), Türen (+ frei_halten), Weg, Kantenmitte
  const anker = (k.anker || []).map((a) => [a.x | 0, a.y | 0]);
  const tueren = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (TUER[kind(x, y)]) tueren.push([x, y]);
  const sperre = (radius) => {
    const s = new Uint8Array(W * H);
    const mark = (cx, cy, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < W && y < H) s[y * W + x] = 1; } };
    for (const [x, y] of anker) mark(x, y, radius);
    for (const [x, y] of tueren) mark(x, y, radius);
    return s;
  };
  const sperrCache = new Map();
  const gesperrt = (r) => { r = Math.max(0, Math.min(4, r | 0)); let s = sperrCache.get(r); if (!s) { s = sperre(r); sperrCache.set(r, s); } return s; };
  const wandnah = (x, y) => WANDNAH[kind(x, y - 1)] || WANDNAH[kind(x + 1, y)] || WANDNAH[kind(x, y + 1)] || WANDNAH[kind(x - 1, y)];
  const frei = (x, y) => {
    const kd = kind(x, y);
    if (!DEKO_BODEN[kd] || WEG[kd]) return false;
    return !istKantenmitte(x, y, k);
  };

  // Platz je Zelle (Zellen ohne Platz: Regel "*")
  const plaetze = (k.plaetze && k.plaetze.length ? k.plaetze : plaetzeAbleiten(k)).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const zelleZuPlatz = new Map();
  for (const p of plaetze) {
    for (let cy = Math.floor(p.y / ZELLE); cy < Math.ceil((p.y + p.h) / ZELLE); cy++) {
      for (let cx = Math.floor(p.x / ZELLE); cx < Math.ceil((p.x + p.w) / ZELLE); cx++) {
        const key = cx + ',' + cy;
        if (!zelleZuPlatz.has(key)) zelleZuPlatz.set(key, p);
      }
    }
  }
  const seed = (k.seed >>> 0) || fnv(String(k.id || 'karte'));
  const out = [];
  const CW = Math.ceil(W / ZELLE), CH = Math.ceil(H / ZELLE);
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    const p = zelleZuPlatz.get(cx + ',' + cy) || null;
    const typ = p ? p.typ : '*';
    const regel = R[typ] || R['*'] || null;
    const props = ((regel && regel.props) || []).filter(Boolean);
    const pool = props.concat(extra);
    if (!pool.length) continue;
    const rnd = mulberry32(fnv((p ? p.id : '*') + ':' + cx + ':' + cy, seed));
    const d = (regel && regel.dichte) || [0, extra.length ? 1 : 0];
    const lo = Math.max(0, d[0] | 0), hi = Math.max(lo, d[1] | 0);
    let n = Math.min(MAX_JE_ZELLE, lo + Math.floor(rnd() * (hi - lo + 1)));
    if (!n) continue;
    const S = gesperrt(regel && regel.frei_halten != null ? regel.frei_halten : 1);
    const kand = [];
    for (let ly = 0; ly < ZELLE; ly++) for (let lx = 0; lx < ZELLE; lx++) {
      const x = cx * ZELLE + lx, y = cy * ZELLE + ly;
      if (x >= W || y >= H || S[y * W + x] || !frei(x, y)) continue;
      if (regel && regel.wandnah && !wandnah(x, y)) continue;
      kand.push([x, y]);
    }
    // Fisher-Yates mit dem Zell-RNG (Reihenfolge der Kandidaten ist fest: zeilenweise)
    for (let i = kand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = kand[i]; kand[i] = kand[j]; kand[j] = t; }
    n = Math.min(n, kand.length);
    for (let i = 0; i < n; i++) {
      const [x, y] = kand[i];
      // Besitz-Streuung nur selten (jedes vierte Prop), sonst Regel-Props
      const useExtra = extra.length && (!props.length || rnd() < 0.25);
      const extraOk = useExtra ? extra.filter((e) => !e.wandnah || wandnah(x, y)) : null;
      const list = useExtra ? (extraOk.length ? extraOk.map((e) => e.id) : props) : props;
      if (!list.length) continue;   // nur wandnahe Besitz-Props und keine Wand daneben
      const id = list[Math.floor(rnd() * list.length)];
      let rot = Math.floor(rnd() * 4) * (Math.PI / 2);
      const ex = useExtra && extraOk.find((e) => e.id === id);
      if ((regel && regel.wandnah) || (ex && ex.wandnah)) {
        // Rücken zur Wand: +z zeigt von der Wand weg
        if (WANDNAH[kind(x, y - 1)]) rot = 0; else if (WANDNAH[kind(x, y + 1)]) rot = Math.PI;
        else if (WANDNAH[kind(x - 1, y)]) rot = Math.PI / 2; else if (WANDNAH[kind(x + 1, y)]) rot = -Math.PI / 2;
      }
      out.push({ id, x, y, rot, seed: Math.floor(rnd() * 8), platz: p ? p.id : null, dx: (rnd() - 0.5) * 0.3, dz: (rnd() - 0.5) * 0.3 });
    }
  }
  return out;
}

/** Prüfung für Tests/QA: verletzt eine Streuung die Vertragsregeln? → Liste der Verstöße (leer = gut). */
export function pruefeStreuung(k, liste) {
  const fehler = [];
  const anker = new Set((k.anker || []).map((a) => (a.x | 0) + ',' + (a.y | 0)));
  const jeZelle = new Map();
  for (const d of liste) {
    const kd = k.kindAt(d.x, d.y);
    if (anker.has(d.x + ',' + d.y)) fehler.push('Anker ' + d.x + ',' + d.y);
    if (TUER[kd]) fehler.push('Tür ' + d.x + ',' + d.y);
    if (WEG[kd]) fehler.push('Weg ' + d.x + ',' + d.y);
    if (!DEKO_BODEN[kd]) fehler.push('fest/kein Boden ' + d.x + ',' + d.y + ' (' + kd + ')');
    if (istKantenmitte(d.x, d.y, k)) fehler.push('Kantenmitte ' + d.x + ',' + d.y);
    const z = Math.floor(d.x / ZELLE) + ',' + Math.floor(d.y / ZELLE);
    jeZelle.set(z, (jeZelle.get(z) || 0) + 1);
  }
  for (const [z, n] of jeZelle) if (n > MAX_JE_ZELLE) fehler.push('Zelle ' + z + ': ' + n + ' > ' + MAX_JE_ZELLE);
  return fehler;
}
