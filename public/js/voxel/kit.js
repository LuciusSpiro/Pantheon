// B1 Team VOXEL – Kit-Renderer für modulare Außenkarten (CONTRACT-B1 §10.4, §10.1–§10.3, §2, §9; ART-PLAN §4).
//
// Baut aus einer `Karte` (bzw. dem Ereignis awayMap, registriert in Shared_Maps) + content/buehnen/kacheln.json +
// Bauweisen-Tabelle (content/buehnen/bauweisen/<bw>.json) + Besitz-Palette (content/buehnen/paletten/<besitz>.json) +
// Zustand eine Voxel-Szene:
//   - Kachel `kind` → Kit-Teil laut Bauweisen-Tabelle (`kits[kind]`, String oder { id, belag }), sonst `kit/<bw>/<kind>`,
//     sonst `kit/geruest/<kind>` (das Gerüst löst intern weiter bis `kit/geruest/slot/*` auf), sonst ein eigener, lesbarer
//     Platzhalter in den Farben der Palette (nie Magenta).
//   - Parameter je Kit-Teil (SCHNITTSTELLEN-NACHTRAG „Kit-Gerüst“): conn (gleiche Kachelklasse nebenan, N1 O2 S4 W8; nicht bei
//     tuer/schott/tor), cut 0/1 (1 = geschnittene Wand 1,25 m, wenn nördlich Karteninneres liegt, sonst volle 3 m – wie M4 §3.2),
//     zustand 0/1/2, art, seed (Kachel + Karten-Seed, auf 4 Varianten begrenzt, damit der Build-Cache trägt), state (nur
//     tuer/schott/tor/luke/wand_schwach), belag (boden), breite 2–4 (tor). Türen: ein Teil je Lauf (2 Kacheln, Tor 2–4),
//     Ausrichtung über rot. Der Loader reicht nur deklarierte Parameter durch.
//   - Props an Ankern (`anker[rolle][art]` bzw. `['*']`), Zustand aus `ao`; Türen/Kanten aus `ko`, Start aus awayMap.kanten.
//   - Leitstücke `leit[platztyp][art]` am Anker mit Rolle `leit` des Platzes, sonst Platzmitte (Deckung darunter: Optik
//     übernimmt das Leitstück), Deko nach Regeln (deko.js), Decks wie die Lerche.
//   - Statisches wird je 12×12-Kachel-Chunk zu einem Netz gebacken (ein Draw Call je Chunk und Deck).
//
// Schnittstelle (auch ohne Spielserver, z. B. Galerie):
//   const VK = await import('/js/voxel/kit.js');            // braucht die Importmap three + voxelwerk/ (wie index.html)
//   const h = await VK.build(sceneOderGroup, karte, opts);   // → Handle
//     opts: { daten?: { kacheln, anker, bauweise, besitz, deko }, base?: '/content/buehnen/', loader?, deko?: true,
//             setMood?(id), deck?: 0, assetTimeout?: 6000 }
//     h: { root, karte, stats, update({ ao, ko, t }), setDeck(d), deckCount, center(), dispose() }
//   VK.snapshot(karte, opts) → Promise<dataURL>   (ein gemeinsamer Offscreen-Renderer, für Galerie-Kacheln)
//   VK.viewer(canvas, karte, opts) → Promise<{ handle, render(), dispose() }>  (Umsehen: ziehen = schieben, Rad = Zoom)
//   Im Spiel: Layer `buehne` (boot.js lädt ihn), Zone 'buehne' (renderer.js) für alle Karten außer platform/wreck/kesh.
import * as THREE from 'three';
import * as DefaultLoader from './loader.js';
import { streuen } from './deko.js';
import { mitAkzent } from './stimmung.js';

const BASE = '/content/buehnen/';
const TILE = 32;
const CHUNK = 12;
const VERSION = 'kit/1';
const G = typeof window !== 'undefined' ? window : globalThis;

// --------------------------------------------------------------------------------------------- Rückfall-Vokabular
// Nur falls content/buehnen/*.json nicht erreichbar ist (Quelle bleibt kacheln.json/anker.json).
const KACHELN_FB = {
  '.': ['boden'], ',': ['boden2'], ':': ['gelaende'], '^': ['plateau'], '/': ['rampe'], k: ['kante'], '#': ['wand'], '=': ['zaun'],
  z: ['gitter'], '|': ['fenster'], F: ['fels'], '~': ['abgrund'], _: ['leere'], o: ['deckung_halb'], O: ['deckung_voll'], I: ['pfeiler'],
  x: ['truemmer'], X: ['schutt'], D: ['tuer', ['offen', 'zu', 'verschlossen', 'gesprengt']], S: ['schott', ['zu', 'offen', 'gehackt', 'verschlossen']],
  G: ['tor', ['zu', 'offen', 'gesprengt']], L: ['luke', ['zu', 'offen']], w: ['wand_schwach', ['intakt', 'offen']], P: ['pad'],
};
const ANKER_FB = {
  eingang: [null, ['offen', 'verschlossen']], abholpunkt: ['bake', ['bereit', 'gestoert']], wache: [null, []], patrouille: [null, []],
  deckung: [null, []], terminal: ['terminal', ['bereit', 'laedt', 'geladen', 'gesperrt']], sprengpunkt: ['sprengziel', ['intakt', 'scharf', 'zerstoert']],
  zelle: ['zelle', ['zu', 'offen']], beute: ['kiste', ['voll', 'leer']], ziel: ['ziel', ['frei', 'genommen', 'aktiviert']], fund: ['sockel', ['da', 'genommen']],
  tor: [null, ['zu', 'offen', 'verschlossen', 'gesprengt']], raetsel: ['schloss', ['ruhe', 'gehalten', 'geloest']], aussicht: [null, []], nsc: [null, []],
  versteck: [null, ['zu', 'offen']], lift: ['lift', []], leiter: ['leiter', []],
};
const ZUSTAND_KIT = { intakt: 0, verfallen: 1, umkaempft: 2 };
const TUER_KINDS = { tuer: 1, schott: 1, tor: 1, luke: 1, wand_schwach: 1 };
const BODEN_KINDS = { boden: 1, boden2: 1, pad: 1, plateau: 1, rampe: 1 };
// Deckung, deren Optik ein darauf stehendes Leitstück ersetzt (Kollision bleibt beim Server)
const DECKUNG_OPTIK = { deckung_halb: 1, deckung_voll: 1, pfeiler: 1, truemmer: 1, schutt: 1 };
// Kachelklassen für conn
const KLASSE = { wand: 'W', fenster: 'W', wand_schwach: 'W', tuer: 'W', schott: 'W', luke: 'W', zaun: 'Z', tor: 'Z', gitter: 'G', kante: 'K',
  deckung_halb: 'H', deckung_voll: 'V', truemmer: 'T', schutt: 'T' };
// „außen“ für cut: Seite zeigt nicht ins Karteninnere
const AUSSEN = { fels: 1, abgrund: 1, leere: 1 };
// Höhe des sichtbaren Bodens (nur Optik, E27: Plateau 0,5 m)
export const BODEN_HOEHE = { plateau: 0.5, rampe: 0.25, kante: 0.5 };

// --------------------------------------------------------------------------------------------- kleine Helfer
function fnv(str, h) {
  h = h == null ? 0x811c9dc5 : h;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function lin(v, f = 1) {
  let n = 0x808080;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') n = parseInt(v.replace('#', ''), 16) || 0;
  return [s2l(((n >> 16) & 255) / 255) * f, s2l(((n >> 8) & 255) / 255) * f, s2l((n & 255) / 255) * f];
}
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// --------------------------------------------------------------------------------------------- Daten (JSON, gecacht)
const jsonCache = new Map();
function getJson(url, ms = 4000) {
  if (jsonCache.has(url)) return jsonCache.get(url);
  const p = (async () => {
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctl && ctl.abort(), ms);
      const r = await fetch(url, ctl ? { signal: ctl.signal, cache: 'no-cache' } : { cache: 'no-cache' });
      clearTimeout(timer);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  })();
  jsonCache.set(url, p);
  return p;
}
export function clearCache() { jsonCache.clear(); }

// Shared_Buehne (UMD, shared/buehne.js) für leitFuss – im Spiel nicht per index.html geladen, deshalb bei Bedarf nachladen
let sharedLauf = null;
function skript(src) {
  return new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
}
function sharedBuehne() {
  if (G.Shared_Buehne) return Promise.resolve(G.Shared_Buehne);
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!sharedLauf) sharedLauf = (async () => {
    if (!G.Shared_BuehneKennzahlen) await skript('/shared/buehne-kennzahlen.js');
    if (!G.Shared_Buehne) await skript('/shared/buehne.js');
    return G.Shared_Buehne || null;
  })().catch(() => null);
  return sharedLauf;
}

async function ladeDaten(k, opts) {
  const d = opts.daten || {};
  const base = opts.base || BASE;
  const bw = k.bauweise;
  const [kacheln, anker, bauweise, besitz, deko, SB] = await Promise.all([
    d.kacheln || getJson(base + 'kacheln.json'),
    d.anker || getJson(base + 'anker.json'),
    d.bauweise !== undefined ? d.bauweise : bw ? getJson(base + 'bauweisen/' + bw + '.json') : null,
    d.besitz !== undefined ? d.besitz : k.besitz ? getJson(base + 'paletten/' + k.besitz + '.json') : null,
    d.deko !== undefined ? d.deko : bw ? getJson(base + 'deko/' + bw + '.json') : null,
    d.leitFuss ? null : sharedBuehne(),
  ]);
  const leitFuss = d.leitFuss || (SB && typeof SB.leitFuss === 'function' ? SB.leitFuss : null);
  return { kacheln, anker, bauweise: bauweise || { kits: {}, anker: {}, leit: {}, paletten: {}, stimmung: {} }, besitz, deko, leitFuss };
}

// --------------------------------------------------------------------------------------------- Karte normalisieren
/** Karte (shared/buehne.js), awayMap oder registrierte Shared_Maps-Karte → einheitliche Form. */
export function normKarte(src, D) {
  if (!src) throw new Error('Kit: keine Karte');
  const m = src.karte && typeof src.karte === 'object' ? Object.assign({}, src, src.karte) : src;
  const rows = m.rows;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Kit: Karte ohne rows');
  const h = m.h || rows.length, w = m.w || rows[0].length;
  const zeichen = (D && D.kacheln && D.kacheln.zeichen) || null;
  const legende = m.legende && typeof m.legende === 'object' ? m.legende : null;
  const infoCache = new Map();
  const info = (ch) => {
    let i = infoCache.get(ch);
    if (i) return i;
    const z = (legende && legende[ch]) || (zeichen && zeichen[ch]);
    if (z && z.kind) i = { kind: z.kind, zustaende: z.zustaende || [] };
    else if (KACHELN_FB[ch]) i = { kind: KACHELN_FB[ch][0], zustaende: KACHELN_FB[ch][1] || [] };
    else i = { kind: 'boden', zustaende: [], unbekannt: true };
    infoCache.set(ch, i);
    return i;
  };
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : rows[y][x]);
  const kindAt = (x, y) => { const c = at(x, y); return c == null ? null : info(c).kind; };
  // Anker: Objekte oder [id, rolle, x, y, attr?]; Reihenfolge = ankerIdx für ao
  const anker = (m.anker || []).map((a, i) => {
    if (Array.isArray(a)) return Object.assign({ id: a[0], rolle: a[1], x: a[2], y: a[3], i }, a[4] && typeof a[4] === 'object' ? a[4] : {});
    return Object.assign({}, a, { i });
  });
  for (const a of anker) if (!a.platz && a.id) a.platz = String(a.id).split('.')[0];
  // Kanten: [[id, tiles, startIdx]] (awayMap) oder { id: { tiles, zustand } } (Karte); Reihenfolge nach id = kantenIdx für ko
  let kanten = [];
  if (Array.isArray(m.kanten)) kanten = m.kanten.map((e) => (Array.isArray(e) ? { id: e[0], tiles: e[1] || [], start: e[2] } : Object.assign({}, e)));
  else if (m.kanten && typeof m.kanten === 'object') kanten = Object.keys(m.kanten).sort().map((id) => Object.assign({ id }, m.kanten[id], { startName: m.kanten[id].zustand }));
  kanten.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Plätze: [[id, typ, x, y, w, h]] (awayMap-Wunsch) oder { id: { typ, rect } } (Karte)
  let plaetze = null;
  // optional 7. Feld: Lage des Moduls (rot 0–3 bzw. { rot, spiegel }) – für die Ausrichtung des Leitstücks
  const lageVon = (l) => (l == null ? null : typeof l === 'number' ? { rot: l, spiegel: false } : l);
  if (Array.isArray(m.plaetze)) plaetze = m.plaetze.map((e) => (Array.isArray(e) ? { id: e[0], typ: e[1], x: e[2], y: e[3], w: e[4], h: e[5], lage: lageVon(e[6]) } : e));
  else if (m.plaetze && typeof m.plaetze === 'object' && Object.keys(m.plaetze).length) {
    plaetze = Object.keys(m.plaetze).sort().filter((id) => m.plaetze[id] && m.plaetze[id].rect)
      .map((id) => { const p = m.plaetze[id]; return { id, typ: p.typ, x: p.rect[0], y: p.rect[1], w: p.rect[2], h: p.rect[3], lage: p.lage || null }; });
  }
  const decks = m.decks && m.decks.stride ? m.decks : null;
  const stride = decks ? decks.stride : 0;
  const deckN = decks ? Math.max(1, Math.ceil(h / stride)) : 1;
  const seed = m.seed != null ? (m.seed >>> 0) : fnv(String(m.id || 'karte') + ':' + (m.kv || ''));
  return {
    id: m.id || 'karte', art: m.art || 'aussenposten', bauweise: m.bauweise || null, besitz: m.besitz || null, zustand: m.zustand || 'intakt',
    seed, kv: m.kv || m.bauversion || null, w, h, rows, at, info, kindAt, anker, kanten, plaetze, decks, stride, deckN,
    zustaende: m.zustaende || {},
    deckOf: (ty) => (decks ? Math.min(deckN - 1, Math.max(0, Math.floor(ty / stride))) : 0),
    localY: (ty) => (decks ? ty - Math.min(deckN - 1, Math.max(0, Math.floor(ty / stride))) * stride : ty),
  };
}

// --------------------------------------------------------------------------------------------- Geometrie-Sammler
// Wachsende Float32-Puffer: position, normal, color, aEmit (dasselbe Format wie loader.combine → ein Material).
class Bucket {
  constructor() { this.cap = 2048; this.n = 0; this.ni = 0; this.icap = 4096; this.alloc(); }
  alloc() {
    const P = new Float32Array(this.cap * 3), N = new Float32Array(this.cap * 3), C = new Float32Array(this.cap * 3), E = new Float32Array(this.cap);
    if (this.P) { P.set(this.P.subarray(0, this.n * 3)); N.set(this.N.subarray(0, this.n * 3)); C.set(this.C.subarray(0, this.n * 3)); E.set(this.E.subarray(0, this.n)); }
    this.P = P; this.N = N; this.C = C; this.E = E;
    const I = new Uint32Array(this.icap); if (this.I) I.set(this.I.subarray(0, this.ni)); this.I = I;
  }
  ensure(nv, ni) {
    let grow = false;
    while (this.n + nv > this.cap) { this.cap *= 2; grow = true; }
    while (this.ni + ni > this.icap) { this.icap *= 2; grow = true; }
    if (grow) this.alloc();
  }
  get empty() { return this.n === 0; }
  /** Fremde Geometrie (loader: position/normal/color/aEmit, indiziert) mit Matrix übernehmen */
  addGeo(geo, m, nm) {
    const P = geo.attributes.position, nv = P.count;
    const idx = geo.index;
    const ni = idx ? idx.count : nv;
    this.ensure(nv, ni);
    const p = P.array, nn = geo.attributes.normal ? geo.attributes.normal.array : null, c = geo.attributes.color ? geo.attributes.color.array : null;
    const e = geo.attributes.aEmit ? geo.attributes.aEmit.array : null;
    const a = m.elements, b = nm.elements;
    const o = this.n;
    for (let i = 0; i < nv; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], j = (o + i) * 3;
      this.P[j] = a[0] * x + a[4] * y + a[8] * z + a[12];
      this.P[j + 1] = a[1] * x + a[5] * y + a[9] * z + a[13];
      this.P[j + 2] = a[2] * x + a[6] * y + a[10] * z + a[14];
      if (nn) {
        const u = nn[i * 3], v = nn[i * 3 + 1], w = nn[i * 3 + 2];
        let X = b[0] * u + b[3] * v + b[6] * w, Y = b[1] * u + b[4] * v + b[7] * w, Z = b[2] * u + b[5] * v + b[8] * w;
        const l = Math.hypot(X, Y, Z) || 1; this.N[j] = X / l; this.N[j + 1] = Y / l; this.N[j + 2] = Z / l;
      } else { this.N[j + 1] = 1; }
      if (c) { this.C[j] = c[i * 3]; this.C[j + 1] = c[i * 3 + 1]; this.C[j + 2] = c[i * 3 + 2]; } else { this.C[j] = this.C[j + 1] = this.C[j + 2] = 0.5; }
      this.E[o + i] = e ? e[i] : 0;
    }
    if (idx) { const ia = idx.array; for (let i = 0; i < ni; i++) this.I[this.ni + i] = ia[i] + o; }
    else for (let i = 0; i < ni; i++) this.I[this.ni + i] = o + i;
    this.n += nv; this.ni += ni;
  }
  quad(p, nrm, cols, emit) {
    this.ensure(4, 6);
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const flip = (ay * bz - az * by) * nrm[0] + (az * bx - ax * bz) * nrm[1] + (ax * by - ay * bx) * nrm[2] < 0;
    const o = this.n;
    for (let i = 0; i < 4; i++) {
      const j = (o + i) * 3, c = cols[i] || cols[0];
      this.P[j] = p[i][0]; this.P[j + 1] = p[i][1]; this.P[j + 2] = p[i][2];
      this.N[j] = nrm[0]; this.N[j + 1] = nrm[1]; this.N[j + 2] = nrm[2];
      this.C[j] = c[0]; this.C[j + 1] = c[1]; this.C[j + 2] = c[2];
      this.E[o + i] = emit ? 1 : 0;
    }
    const I = this.I, k = this.ni;
    if (flip) { I[k] = o; I[k + 1] = o + 2; I[k + 2] = o + 1; I[k + 3] = o; I[k + 4] = o + 3; I[k + 5] = o + 2; }
    else { I[k] = o; I[k + 1] = o + 1; I[k + 2] = o + 2; I[k + 3] = o; I[k + 4] = o + 2; I[k + 5] = o + 3; }
    this.n += 4; this.ni += 6;
  }
  toGeometry() {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, this.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, this.n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, this.n * 3), 3));
    g.setAttribute('aEmit', new THREE.BufferAttribute(this.E.slice(0, this.n), 1));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? this.I.slice(0, this.ni) : Uint16Array.from(this.I.subarray(0, this.ni)), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// Stift für Platzhalter: Boxen unter einer Matrix (Kachelmitte = Ursprung, Boden y = 0, vorn = +z)
const FACES = [['y', 1], ['y', -1], ['x', 1], ['x', -1], ['z', 1], ['z', -1]];
class Pen {
  constructor() { this.m = new THREE.Matrix4(); this.nm = new THREE.Matrix3(); this.v = new THREE.Vector3(); this.w = new THREE.Vector3(); this.b = null; }
  to(bucket, m) { this.b = bucket; this.m.copy(m); this.nm.getNormalMatrix(m); return this; }
  box(x0, y0, z0, x1, y1, z1, top, side, o = {}) {
    side = side || top;
    const low = o.low ?? 0.8;
    const j = o.jit === false ? 1 : 1 + (hash2(Math.round((x0 + x1) * 50), Math.round((z0 + z1) * 50), Math.round(y1 * 50)) - 0.5) * 0.08;
    const tc = mul(top, j), sc = mul(side, j), sl = o.emit ? sc : mul(sc, low);
    for (const [ax, s] of FACES) {
      if (ax === 'y' && s === -1 && !o.bottom) continue;
      if (o.only === 'top' && !(ax === 'y' && s === 1)) continue;
      if (o.skip && o.skip.indexOf(ax + (s > 0 ? '+' : '-')) >= 0) continue;
      let p;
      if (ax === 'y') { const y = s > 0 ? y1 : y0; p = [[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]]; }
      else if (ax === 'x') { const x = s > 0 ? x1 : x0; p = [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]]; }
      else { const z = s > 0 ? z1 : z0; p = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]; }
      const n0 = ax === 'x' ? [s, 0, 0] : ax === 'y' ? [0, s, 0] : [0, 0, s];
      const cols = ax === 'y' ? [s > 0 ? tc : mul(sc, 0.6)] : p.map((q) => (q[1] === y0 ? sl : sc));
      const pw = p.map((q) => { this.v.set(q[0], q[1], q[2]).applyMatrix4(this.m); return [this.v.x, this.v.y, this.v.z]; });
      this.w.set(n0[0], n0[1], n0[2]).applyMatrix3(this.nm).normalize();
      this.b.quad(pw, [this.w.x, this.w.y, this.w.z], cols, !!o.emit);
    }
  }
}

// --------------------------------------------------------------------------------------------- Material (Emission + Nebel)
function makeFog(w, h) {
  const data = new Uint8Array(w * h * 4).fill(255);
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return { tex: { value: tex }, rect: { value: new THREE.Vector4(0, 0, 1 / w, 1 / h) }, on: { value: 0 }, data, w, h,
    cur: new Float32Array(w * h).fill(1), cache: { t: -1e9, key: '' } };
}
function makeMaterial(fog) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uKitFogTex = fog.tex; sh.uniforms.uKitFogRect = fog.rect; sh.uniforms.uKitFogOn = fog.on;
    sh.vertexShader = 'attribute float aEmit;\nvarying float vEmit;\nvarying vec2 vKitXZ;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvEmit = aEmit;')
      .replace('#include <project_vertex>', ['#include <project_vertex>', '{ vec4 kwp = vec4(transformed, 1.0);', '#ifdef USE_INSTANCING',
        '  kwp = instanceMatrix * kwp;', '#endif', '  kwp = modelMatrix * kwp; vKitXZ = kwp.xz; }'].join('\n'));
    sh.fragmentShader = 'varying float vEmit;\nvarying vec2 vKitXZ;\nuniform sampler2D uKitFogTex;\nuniform vec4 uKitFogRect;\nuniform float uKitFogOn;\n' + sh.fragmentShader
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\tif (vEmit > 0.5) { vec3 eC = diffuseColor.rgb; float eM = max(max(eC.r, eC.g), max(eC.b, 1e-3)); totalEmissiveRadiance += eC * min(1.2, 1.5 / eM); diffuseColor.rgb *= 0.0; }')
      .replace('#include <dithering_fragment>', ['#include <dithering_fragment>', 'if (uKitFogOn > 0.5) {',
        '  float fv = texture2D(uKitFogTex, (vKitXZ - uKitFogRect.xy) * uKitFogRect.zw).r;',
        '  float fl = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));',
        '  gl_FragColor.rgb = mix(vec3(fl), gl_FragColor.rgb, 0.3 + 0.7 * fv) * (0.58 + 0.42 * fv);', '}'].join('\n'));
  };
  m.customProgramCacheKey = () => 'kit-emit-fog-3';
  return m;
}

// --------------------------------------------------------------------------------------------- Farben der Platzhalter
// Aus der aufgelösten Palette (Rollen; jede Palette erbt von base, base trägt rune/ember/alarm/frost/leit). Ist die Karten-
// palette nicht geladen: base. Erst wenn auch base fehlt (Voxelwerk nicht erreichbar), greifen die festen Werte unten.
const FARB_FB = {
  stone: '#8C8F8E', stone_dark: '#5E6264', stone_light: '#B6B8B3', paving: '#7F807B', paving_dark: '#5E5F5B', wood: '#7C5C3E',
  wood_dark: '#4F3A28', soil: '#5F4C3A', soil_dark: '#43362A', metal: '#7A8088', metal_dark: '#52575E', metal_light: '#B4BAC0',
  trim: '#E4DCC8', warning: '#C08A2E', glow: '#8FD8FF', glow2: '#FFAE52', dark: '#1C1F23', cloth: '#4A6A86', primary: '#8E959D',
  glass: '#9FC4D8',
  // Leuchtrollen aus base (ART-PALETTEN B1): rune (Runenlicht), ember (Glut), alarm (Rot-Alarm), frost (Reif), leit (Leitstück/Ziel)
  rune: '#D4DEE6', rune_dim: '#9AA6AE', ember: '#FFCC7A', ember_dark: '#8A4A26', alarm: '#A82A2A', alarm_dark: '#6A2020',
  frost: '#DCE4E8', frost_dark: '#A8B4BC', leit: '#B48CFF',
};
function farben(pal, basePal) {
  const r = (pal && pal.roles) || {}, b = (basePal && basePal.roles) || {};
  const get = (n, f = 1) => lin(r[n] ? r[n].c : b[n] ? b[n].c : FARB_FB[n] || '#808080', f);
  return { get, has: (n) => !!(r[n] || b[n]) };
}

// Platzhalter je Kit-Kind (lesbar, palettengefärbt, nie Magenta). p = Parameter wie beim echten Teil.
const FB = {
  boden(pen, p, F) {
    const belag = p.belag | 0, s = p.seed | 0;
    const top = belag === 1 ? F.get('metal_dark') : belag === 2 ? F.get('wood') : belag === 3 ? F.get('paving', 1.08) : F.get('paving');
    pen.box(-0.5, -0.06, -0.5, 0.5, -0.04, 0.5, F.get('paving_dark', 0.7), null, { only: 'top', jit: false });
    pen.box(-0.48, -0.06, -0.48, 0.48, 0, 0.48, s % 4 === 0 ? mul(top, 0.94) : top, F.get('paving_dark'));
    if (belag === 1) for (let i = 0; i < 3; i++) pen.box(-0.4 + i * 0.32, 0, -0.44, -0.36 + i * 0.32, 0.01, 0.44, F.get('metal_light'), null, { only: 'top' });
    if (belag === 2) for (let i = 0; i < 2; i++) pen.box(-0.48, 0, -0.17 + i * 0.32, 0.48, 0.006, -0.15 + i * 0.32, F.get('wood_dark'), null, { only: 'top' });
  },
  pad(pen, p, F) {
    FB.boden(pen, { belag: 1, seed: 0 }, F);
    pen.box(-0.4, 0, -0.4, 0.4, 0.05, 0.4, F.get('metal'), F.get('metal_dark'));
    pen.box(-0.32, 0.05, -0.32, 0.32, 0.065, 0.32, F.get('rune', 1.1), null, { emit: true });
  },
  gelaende(pen, p, F) {
    // Außenboden als Terrain (Frost, Schlamm, Sand): Farbe der Bauweisen-Tabelle (top/fill), leichte Streuung, ab und zu ein Stein
    const x = p.x | 0, y = p.y | 0, r = hash2(x, y, 52);
    const top = mul(F.get(p.top || 'soil'), 0.94 + r * 0.1);
    const nb = p.nb || [-99, -99, -99, -99], skip = [];
    if (nb[0] >= 0) skip.push('z-'); if (nb[1] >= 0) skip.push('x+'); if (nb[2] >= 0) skip.push('z+'); if (nb[3] >= 0) skip.push('x-');
    pen.box(-0.5, -1.6, -0.5, 0.5, r < 0.2 ? -0.03 : 0, 0.5, top, F.get(p.fill || 'soil_dark'), { jit: false, low: 0.7, skip });
    if (r > 0.9) {
      const sx = (hash2(x, y, 54) - 0.5) * 0.5, sz = (hash2(x, y, 55) - 0.5) * 0.5, w = 0.06 + hash2(x, y, 56) * 0.1;
      pen.box(sx - w, 0, sz - w, sx + w, 0.04 + w * 0.6, sz + w, F.get(p.fill || 'soil_dark', 1.25), F.get(p.fill || 'soil_dark'));
    }
  },
  plateau(pen, p, F) {
    pen.box(-0.5, 0.44, -0.5, 0.5, 0.5, 0.5, F.get('paving', 1.05), F.get('stone_dark'));
  },
  tiefe(pen, p, F) {
    // Abgrund draußen (Schlucht, Wasser): dunkle Tiefe 1,6 m unter dem Boden, Wände der Schlucht entstehen an den Nachbarn
    pen.box(-0.5, -1.6, -0.5, 0.5, -1.55, 0.5, F.get('dark'), F.get('dark'), { only: 'top', jit: false });
  },
  sockel(pen, p, F) {
    // Unterbau unter optisch erhöhtem Boden (Plateau 0,5 m, E27)
    pen.box(-0.5, 0, -0.5, 0.5, Math.max(0.05, (p.h || 0.5) - 0.06), 0.5, F.get('stone_light'), F.get('stone_dark'), { low: 0.7 });
  },
  rampe(pen, p, F) {
    for (let i = 0; i < 4; i++) pen.box(-0.5, 0, -0.5 + i * 0.25, 0.5, 0.12 + i * 0.12, -0.25 + i * 0.25, F.get('paving'), F.get('stone_dark'));
  },
  wand(pen, p, F) {
    const H = p.cut ? 1.25 : 3;
    const crumble = p.zustand === 1 && hash2(p.seed | 0, 3, 9) < 0.5 ? 0.3 : 0;
    pen.box(-0.5, 0, -0.5, 0.5, 0.25, 0.5, F.get('stone_dark'), F.get('stone_dark'));
    pen.box(-0.48, 0.25, -0.48, 0.48, H - crumble, 0.48, F.get('stone_light'), F.get('stone'));
    pen.box(-0.5, H - crumble - 0.12, -0.5, 0.5, H - crumble, 0.5, F.get('trim'), F.get('stone_dark'), { low: 1 });
  },
  zaun(pen, p, F) {
    const H = p.cut ? 1.6 : 2.6;
    for (const x of [-0.36, -0.12, 0.12, 0.36]) {
      const h = H - hash2(Math.round(x * 10), p.seed | 0, 4) * 0.25;
      pen.box(x - 0.11, 0, -0.11, x + 0.11, h, 0.11, F.get('wood', 1.1), F.get('wood'));
      pen.box(x - 0.06, h, -0.06, x + 0.06, h + 0.14, 0.06, F.get('wood_dark'), F.get('wood_dark'));
    }
    pen.box(-0.5, H * 0.55, -0.13, 0.5, H * 0.55 + 0.1, 0.13, F.get('wood_dark'), F.get('wood_dark'));
  },
  gitter(pen, p, F) {
    pen.box(-0.5, 2.1, -0.06, 0.5, 2.2, 0.06, F.get('metal'), F.get('metal_dark'));
    pen.box(-0.5, 0, -0.06, 0.5, 0.08, 0.06, F.get('metal'), F.get('metal_dark'));
    for (let i = 0; i < 5; i++) { const x = -0.4 + i * 0.2; pen.box(x - 0.025, 0, -0.025, x + 0.025, 2.1, 0.025, F.get('metal_light'), F.get('metal')); }
  },
  fenster(pen, p, F) {
    pen.box(-0.5, 0, -0.42, 0.5, 0.9, 0.42, F.get('metal_light'), F.get('metal'));
    pen.box(-0.5, 0.9, -0.05, 0.5, 2.4, 0.05, F.get('glass', 0.6), null, { emit: false });
    pen.box(-0.5, 2.4, -0.42, 0.5, p.cut ? 2.5 : 3, 0.42, F.get('metal_light'), F.get('metal'));
  },
  kante(pen, p, F) {
    pen.box(-0.5, 0, -0.5, 0.5, 0.5, 0.5, F.get('stone'), F.get('stone_dark'));
    pen.box(-0.5, 0.5, -0.5, 0.5, 0.95, 0.5, F.get('trim'), F.get('stone_light'));
  },
  deckung_halb(pen, p, F) {
    // ≤ 0,9 m, helle Oberkante, nie Bodenfarbe (M4 §3.6)
    pen.box(-0.44, 0, -0.32, 0.44, 0.66, 0.32, F.get('wood'), F.get('wood'), { low: 0.72 });
    pen.box(-0.46, 0.66, -0.34, 0.46, 0.82, 0.34, F.get('trim', 1.05), F.get('trim', 0.9));
  },
  deckung_voll(pen, p, F) {
    // ≥ 2,2 m, dunkle Krone, Schattenfleck
    pen.box(-0.6, 0, -0.6, 0.6, 0.012, 0.6, F.get('dark'), null, { only: 'top', jit: false });
    pen.box(-0.44, 0, -0.44, 0.44, 2.05, 0.44, F.get('metal'), F.get('metal_dark'), { low: 0.7 });
    pen.box(-0.47, 2.05, -0.47, 0.47, 2.35, 0.47, F.get('dark'), F.get('dark'));
  },
  pfeiler(pen, p, F) {
    pen.box(-0.4, 0, -0.4, 0.4, 0.3, 0.4, F.get('stone_light'), F.get('stone'));
    pen.box(-0.27, 0.3, -0.27, 0.27, 2.1, 0.27, F.get('stone_light'), F.get('stone'), { low: 0.7 });
    pen.box(-0.42, 2.1, -0.42, 0.42, 2.4, 0.42, F.get('dark'), F.get('stone_dark'));
  },
  truemmer(pen, p, F, T) {
    const s = p.seed | 0, base = pen.m.clone();
    const n = (p.voll ? 4 : 3) + Math.floor(hash2(s, 1, 1) * 2);
    for (let i = 0; i < n; i++) {
      const x = (hash2(s, i, 2) - 0.5) * 0.55, z = (hash2(s, i, 3) - 0.5) * 0.55;
      const w = 0.15 + hash2(s, i, 4) * 0.25, d = 0.12 + hash2(s, i, 5) * 0.2, h = (p.voll ? 0.6 : 0.2) + hash2(s, i, 6) * (p.voll ? 1.5 : 0.5);
      pen.to(pen.b, base.clone().multiply(new T.Matrix4().makeTranslation(x, 0, z)).multiply(new T.Matrix4().makeRotationY(hash2(s, i, 7) * 3)));
      pen.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, F.get(i % 2 ? 'stone' : 'stone_light'), F.get('stone_dark'));
    }
    pen.to(pen.b, base);
  },
  fels(pen, p, F) {
    // Terrain wie Kesh (M4 §3.6): 1-m-Schichten, Oberseite hell gestreut, obere Schichten Stein, darunter dunkle Füllung
    const H = Math.max(1, p.h | 0 || 3), x = p.x | 0, y = p.y | 0;
    const top = hash2(x, y, 53) < 0.35 ? F.get(p.hell || 'stone_light') : F.get('stone');   // hell: Reif (frost) draußen im Norden
    for (let l = 0; l < H; l++) {
      const side = l >= H - 1 ? F.get('stone') : l >= H - 3 ? ((l + x + y) % 2 ? F.get('stone') : F.get('stone', 0.92)) : F.get('stone_dark');
      const j = 1 + (hash2(x * 7 + l, y * 13 - l, 51) - 0.5) * 0.1;
      const nb = p.nb || [-99, -99, -99, -99], skip = [];
      if (nb[0] > l) skip.push('z-'); if (nb[1] > l) skip.push('x+'); if (nb[2] > l) skip.push('z+'); if (nb[3] > l) skip.push('x-');
      if (l < H - 1) skip.push('y+');
      pen.box(-0.5, l, -0.5, 0.5, l + 1, 0.5, mul(top, j), mul(side, j), { low: l === 0 ? 0.75 : 0.95, jit: false, skip });
    }
  },
  // --- Türen (state = Index in den Zuständen der Kachelart)
  tuer(pen, p, F) { doorFb(pen, p, F, ['offen', 'zu', 'verschlossen', 'gesprengt'], 'wood'); },
  schott(pen, p, F) { doorFb(pen, p, F, ['zu', 'offen', 'gehackt', 'verschlossen'], 'metal'); },
  tor(pen, p, F) { doorFb(pen, p, F, ['zu', 'offen', 'gesprengt'], 'wood_dark', true); },
  luke(pen, p, F) {
    const open = (p.zustaende || ['zu', 'offen'])[p.state | 0] === 'offen';
    pen.box(-0.5, 0, -0.5, 0.5, 0.25, 0.5, F.get('stone_dark'), F.get('stone_dark'));
    pen.box(-0.45, 0.25, -0.45, 0.45, 0.3, 0.45, open ? F.get('dark') : F.get('metal'), F.get('metal_dark'));
    if (!open) for (let i = 0; i < 3; i++) pen.box(-0.4, 0.3, -0.3 + i * 0.3, 0.4, 0.33, -0.25 + i * 0.3, F.get('metal_light'), null, { only: 'top' });
  },
  wand_schwach(pen, p, F) {
    const open = (p.zustaende || ['intakt', 'offen'])[p.state | 0] === 'offen';
    const H = p.cut ? 1.25 : 3;
    if (open) {
      pen.box(-0.5, 0, -0.4, -0.3, H * 0.8, 0.4, F.get('stone_light'), F.get('stone'));
      pen.box(0.3, 0, -0.4, 0.5, H * 0.6, 0.4, F.get('stone_light'), F.get('stone'));
      pen.box(-0.2, 0, -0.1, 0.15, 0.14, 0.2, F.get('stone'), F.get('stone_dark'));
      return;
    }
    pen.box(-0.5, 0, -0.45, 0.5, H, 0.45, F.get('stone_light'), F.get('stone'));
    for (let i = 0; i < 3; i++) pen.box(-0.35 + i * 0.25, 0.2 + i * 0.25, 0.45, -0.3 + i * 0.25, 0.75 + i * 0.25, 0.47, F.get('dark'), F.get('dark'));
  },
};
function doorFb(pen, p, F, zst, mat, gross) {
  const st = (p.zustaende || zst)[p.state | 0] || zst[0];
  const H = gross ? 2.6 : 2.4;
  // geschnittene Wand (cut 1): Rahmen nur 1,25 m, Blatt ebenso (Sicht von oben frei, wie Wände)
  const top = p.cut ? 1.25 : 3;
  const Hb = p.cut ? 1.15 : H;
  const hw = Math.max(1, p.breite || p.lauf || 1) / 2;   // halbe Breite des Laufs (Tür 2 Kacheln, Tor 2–4)
  const fr = 0.14, x0 = -hw + fr, x1 = hw - fr;
  // Rahmen (Pfosten + Sturz), Durchgang entlang lokal z
  pen.box(-hw, 0, -0.45, x0, top, 0.45, F.get('stone_light'), F.get('stone'));
  pen.box(x1, 0, -0.45, hw, top, 0.45, F.get('stone_light'), F.get('stone'));
  if (!p.cut) pen.box(-hw, H, -0.45, hw, top, 0.45, F.get('stone_light'), F.get('stone'));
  if (st === 'offen' || st === 'gehackt') {
    pen.box(x0, 0, -0.08, x1, 0.02, 0.08, F.get('dark'), null, { only: 'top' });
    if (st === 'gehackt') pen.box(-0.12, Hb - 0.25, 0.45, 0.12, Hb - 0.15, 0.47, F.get('alarm', 1.4), null, { emit: true });
    return;
  }
  if (st === 'gesprengt') {
    pen.box(x0, 0, -0.1, x0 + 0.25, 0.6, 0.1, F.get(mat), F.get(mat, 0.8));
    pen.box(x1 - 0.28, 0, -0.06, x1, 0.35, 0.1, F.get(mat), F.get(mat, 0.8));
    pen.box(-0.1, 0, 0.15, 0.2, 0.08, 0.35, F.get('dark'), F.get('dark'));
    return;
  }
  pen.box(x0, 0, -0.12, x1, Hb, 0.12, F.get(mat, 1.08), F.get(mat));
  if (hw >= 1) pen.box(-0.02, 0, 0.12, 0.02, Hb, 0.13, F.get(mat, 0.6), null);   // Fuge zwischen den Flügeln
  if (st === 'verschlossen') {
    pen.box(x0 + 0.08, Hb * 0.45, 0.12, x1 - 0.08, Hb * 0.45 + 0.1, 0.14, F.get('alarm', 1.4), null, { emit: true });
    pen.box(x0 + 0.08, Hb * 0.45, -0.14, x1 - 0.08, Hb * 0.45 + 0.1, -0.12, F.get('alarm', 1.4), null, { emit: true });
  }
}

// Platzhalter je Anker-Rolle (Props)
const PROP_FB = {
  terminal(pen, p, F) {
    pen.box(-0.32, 0, -0.26, 0.32, 1.45, 0.2, F.get('stone_light'), F.get('stone'));
    const st = p.state | 0;
    pen.box(-0.22, 0.75, 0.2, 0.22, 1.15, 0.23, st === 3 ? F.get('dark') : F.get(st === 2 ? 'ember' : 'rune', st === 1 ? 1.5 : 1.0), null, { emit: st !== 3 });
  },
  sprengpunkt(pen, p, F) {
    const st = p.state | 0;
    if (st === 2) { pen.box(-0.4, 0, -0.4, 0.4, 0.35, 0.4, F.get('dark'), F.get('stone_dark')); return; }
    pen.box(-0.35, 0, -0.35, 0.35, 0.3, 0.35, F.get('metal_dark'), F.get('metal_dark'));
    pen.box(-0.14, 0.3, -0.14, 0.14, 2.2, 0.14, F.get('metal'), F.get('metal_dark'));
    pen.box(-0.2, 1.1, -0.2, 0.2, 1.3, 0.2, F.get(st === 1 ? 'ember' : 'alarm_dark', st === 1 ? 1.6 : 1.0), null, { emit: st === 1 });
  },
  zelle(pen, p, F) {
    const open = (p.state | 0) === 1;
    pen.box(-0.5, 0, -0.5, 0.5, 0.08, 0.5, F.get('metal_dark'), F.get('metal_dark'));
    pen.box(-0.5, 2.0, -0.5, 0.5, 2.1, 0.5, F.get('metal'), F.get('metal_dark'));
    for (let i = 0; i < 5; i++) {
      const v = -0.45 + i * 0.225;
      pen.box(v - 0.03, 0, -0.48, v + 0.03, 2.0, -0.42, F.get('metal_light'), F.get('metal'));
      pen.box(-0.48, 0, v - 0.03, -0.42, 2.0, v + 0.03, F.get('metal_light'), F.get('metal'));
      pen.box(0.42, 0, v - 0.03, 0.48, 2.0, v + 0.03, F.get('metal_light'), F.get('metal'));
      if (!open) pen.box(v - 0.03, 0, 0.42, v + 0.03, 2.0, 0.48, F.get('metal_light'), F.get('metal'));
    }
  },
  beute(pen, p, F) {
    const leer = (p.state | 0) === 1;
    pen.box(-0.42, 0, -0.3, 0.42, 0.55, 0.3, F.get('wood'), F.get('wood_dark'));
    if (!leer) pen.box(-0.44, 0.55, -0.32, 0.44, 0.68, 0.32, F.get('wood', 1.1), F.get('wood_dark'));
    pen.box(-0.06, 0.25, 0.3, 0.06, 0.4, 0.33, leer ? F.get('dark') : F.get('ember', 1.2), null, { emit: !leer });
  },
  ziel(pen, p, F) {
    const st = p.state | 0;
    pen.box(-0.3, 0, -0.3, 0.3, 0.2, 0.3, F.get('stone'), F.get('stone_dark'));
    pen.box(-0.05, 0.2, -0.05, 0.05, 2.4, 0.05, F.get('wood_dark'), F.get('wood_dark'));
    pen.box(0.05, 1.7, -0.03, 0.65, 2.3, 0.03, st === 2 ? F.get('rune', 1.3) : F.get('cloth'), F.get('cloth', 0.8), { emit: st === 2 });
  },
  fund(pen, p, F) {
    pen.box(-0.35, 0, -0.35, 0.35, 0.85, 0.35, F.get('stone_light'), F.get('stone'));
    if ((p.state | 0) === 0) pen.box(-0.15, 0.85, -0.15, 0.15, 1.15, 0.15, F.get('ember', 1.4), null, { emit: true });
  },
  raetsel(pen, p, F) {
    const st = p.state | 0;
    pen.box(-0.3, 0, -0.25, 0.3, 1.3, 0.25, F.get('stone_light'), F.get('stone'));
    pen.box(-0.18, 0.6, 0.25, 0.18, 1.0, 0.27, F.get(st === 2 ? 'ember' : 'rune', st ? 1.5 : 0.9), null, { emit: true });
  },
  abholpunkt(pen, p, F) {
    pen.box(-0.12, 0, -0.12, 0.12, 1.6, 0.12, F.get('metal'), F.get('metal_dark'));
    pen.box(-0.16, 1.6, -0.16, 0.16, 1.8, 0.16, (p.state | 0) === 1 ? F.get('alarm', 1.5) : F.get('rune', 1.4), null, { emit: true });
  },
  lift(pen, p, F) {
    pen.box(-0.48, 0, -0.48, 0.48, 0.1, 0.48, F.get('metal_light'), F.get('metal'));
    pen.box(-0.48, 0.1, -0.48, -0.4, 2.6, -0.4, F.get('metal'), F.get('metal_dark'));
    pen.box(0.4, 0.1, -0.48, 0.48, 2.6, -0.4, F.get('metal'), F.get('metal_dark'));
    pen.box(-0.4, 0.1, -0.06, 0.4, 0.13, 0.06, F.get('rune', 1.1), null, { emit: true });
  },
  leiter(pen, p, F) {
    pen.box(-0.3, 0, -0.5, -0.24, 2.8, -0.42, F.get('metal'), F.get('metal_dark'));
    pen.box(0.24, 0, -0.5, 0.3, 2.8, -0.42, F.get('metal'), F.get('metal_dark'));
    for (let i = 0; i < 8; i++) pen.box(-0.24, 0.3 + i * 0.32, -0.48, 0.24, 0.34 + i * 0.32, -0.44, F.get('metal_light'), F.get('metal'));
  },
  aussicht(pen, p, F) { /* Plateau trägt die Aussicht; ohne Prop nichts */ },
  versteck(pen, p, F) { },
  leit(pen, p, F) {
    // Leitstück-Platzhalter: 2×2-Sockel mit Säule und Leuchtkrone (von oben eindeutig)
    pen.box(-0.95, 0, -0.95, 0.95, 0.3, 0.95, F.get('stone_light'), F.get('stone'));
    pen.box(-0.35, 0.3, -0.35, 0.35, 2.8, 0.35, F.get('stone_light'), F.get('stone'));
    pen.box(-0.5, 2.8, -0.5, 0.5, 3.0, 0.5, F.get('leit', 1.2), null, { emit: true });
  },
};

// --------------------------------------------------------------------------------------------- Bau
/**
 * Baut die Karte in `parent` (THREE.Scene/Group). → Promise<Handle>
 * Die Karte liegt mit Kachel (0,0) bei Welt (0, 0, 0); Kachelmitte = (x + 0,5, 0, lokale Zeile + 0,5), Deck II bei z wie Deck I.
 */
export async function build(parent, karteIn, opts = {}) {
  const t0 = now();
  const loader = opts.loader || DefaultLoader;
  const stats = { buildMs: 0, ladeMs: 0, assetMs: 0, bakeMs: 0, tris: 0, chunks: 0, dynamisch: 0, deko: 0, dekoFehlt: {}, platzhalter: {}, assets: {}, fehlend: [], fehler: 0, version: VERSION };
  const countErr = (where, e) => { stats.fehler++; try { (opts.countError || ((w, x) => console.warn('[kit]', w, x)))(where, e); } catch (x) { /* egal */ } };
  // 1) Daten
  const k0 = normKarte(karteIn, null);
  const D = await ladeDaten(k0, opts);
  const k = normKarte(karteIn, D);
  stats.ladeMs = Math.round(now() - t0);
  const BW = D.bauweise || {};
  const bw = k.bauweise || BW.id || 'germanen';
  const zKit = ZUSTAND_KIT[k.zustand] != null ? ZUSTAND_KIT[k.zustand] : 0;
  // Palette: Besitz × Bauweise × Zustand → ID; sonst Bauweisen-Basis (+ _<zustand>, falls vorhanden)
  let paletteId = null;
  try { const jb = D.besitz && D.besitz.je_bauweise && D.besitz.je_bauweise[bw]; if (jb) paletteId = jb[k.zustand] || jb.intakt || null; } catch (e) { /* egal */ }
  const basis = (BW.paletten && ((BW.paletten.zustand && BW.paletten.zustand[k.zustand]) || BW.paletten.basis)) || null;   // ohne Besitz: Bauweise × Zustand
  // 2) Assets vorladen (mit Zeitlimit; was fehlt, wird Platzhalter)
  const ta = now();
  // Eintrag der Bauweisen-Tabelle: String oder { id, <feste Parameter>, je_art: { <art>: {…} }, terrain?, leer?, hoehe?, top?, fill? }
  const META = { id: 1, je_art: 1, terrain: 1, leer: 1, hoehe: 1, top: 1, fill: 1, hinweis: 1 };
  const eintrag = (e) => {
    if (!e) return null;
    if (typeof e === 'string') return { id: e, fest: {} };
    const m = Object.assign({}, e, (e.je_art && e.je_art[k.art]) || {});
    const fest = {};
    for (const key of Object.keys(m)) if (!META[key]) fest[key] = m[key];
    return { id: m.id || null, fest, terrain: !!m.terrain, leer: !!m.leer, hoehe: m.hoehe, top: m.top, fill: m.fill };
  };
  const kitCache = new Map();
  const kitId = (kind) => {
    if (!kitCache.has(kind)) kitCache.set(kind, eintrag(BW.kits && BW.kits[kind]));
    return kitCache.get(kind);
  };
  const rollenStates = (rolle) => {
    const r = D.anker && D.anker.rollen && D.anker.rollen[rolle];
    if (r) return { objekt: r.objekt, zustaende: r.zustaende || [] };
    const f = ANKER_FB[rolle];
    return f ? { objekt: f[0], zustaende: f[1] } : { objekt: null, zustaende: [] };
  };
  // anker[rolle][art|'*'] = ID | { id, <feste Parameter> } | { '*': ID, <platztyp>: ID } (Prop je Platztyp, Nachtrag)
  const platzTyp = new Map((k.plaetze || []).map((p) => [p.id, p.typ]));
  const propEintrag = (rolle, platz) => {
    const e = BW.anker && BW.anker[rolle];
    if (!e) return null;
    let v = typeof e === 'string' ? e : e[k.art] || e['*'] || null;
    if (v && typeof v === 'object' && !v.id) {
      const typ = platz ? platzTyp.get(platz) || String(platz).replace(/_\d+$/, '') : null;
      v = (typ && v[typ]) || v['*'] || null;
    }
    return eintrag(v);
  };
  const propId = (rolle, platz) => { const e = propEintrag(rolle, platz); return e ? e.id : null; };
  const kindsDa = new Set();
  for (let y = 0; y < k.h; y++) for (let x = 0; x < k.w; x++) kindsDa.add(k.kindAt(x, y));
  const want = new Set();
  // Ohne Tabelleneintrag: Standardnamen (boden2/pad/plateau/rampe → boden, schutt → truemmer)
  const KIT_KIND = (kind) => (kind === 'boden2' || kind === 'pad' || kind === 'plateau' || kind === 'rampe' ? 'boden' : kind === 'schutt' ? 'truemmer' : kind);
  const kandidaten = (kind) => {
    const e = kitId(kind), out = [];
    if (e && (e.leer || e.terrain)) return out;
    if (e && e.id) out.push(e.id);
    const kk = KIT_KIND(kind);
    out.push('kit/' + bw + '/' + kk, 'kit/geruest/' + kk);
    return out;
  };
  const inManifest = (id) => { try { return !!(loader.manifest && loader.manifest(id)); } catch (e) { return false; } };
  for (const kd of kindsDa) for (const id of kandidaten(kd)) if (inManifest(id)) want.add(id);
  for (const a of k.anker) { const id = propId(a.rolle, a.platz); if (id && inManifest(id)) want.add(id); }
  if (BW.leit) for (const t of Object.keys(BW.leit)) { const v = BW.leit[t] && (BW.leit[t][k.art] || BW.leit[t]['*']); if (typeof v === 'string' && inManifest(v)) want.add(v); }
  const dekoRegeln = opts.deko === false ? null : D.deko;
  const dekoExtra = D.besitz && Array.isArray(D.besitz.streu) ? D.besitz.streu : [];
  if (dekoRegeln && dekoRegeln.regeln) for (const r of Object.values(dekoRegeln.regeln)) for (const id of (r && r.props) || []) if (inManifest(id)) want.add(id);
  for (const e of dekoExtra) { const id = typeof e === 'string' ? e : e && e.id; if (id && inManifest(id)) want.add(id); }
  const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    if (loader.ready) await Promise.race([loader.ready, timeout(5000)]);
    const jobs = [...want].map((id) => loader.load(id));
    for (const pid of [paletteId, basis, 'base']) if (pid && loader.lib) jobs.push(loader.lib.load('palettes', pid).catch(() => null));
    await Promise.race([Promise.all(jobs), timeout(opts.assetTimeout || 6000)]);
  } catch (e) { countErr('kit.preload', e); }
  stats.assetMs = Math.round(now() - ta);
  // Palette auflösen (für Platzhalterfarben); Kit-Teile bekommen sie als palette-Override
  let pal = null;
  for (const pid of [paletteId, basis]) {
    if (!pid || !loader.lib) continue;
    try { pal = loader.lib.palette(pid); paletteId = pid; break; } catch (e) { /* nicht geladen */ }
  }
  if (!pal) paletteId = null;
  let basePal = null;
  if (!pal && loader.lib) { try { basePal = loader.lib.palette('base'); } catch (e) { /* nicht geladen */ } }
  const F = farben(pal, basePal);
  stats.palette = paletteId;
  // Stimmung
  try {
    const mood = (BW.stimmung && BW.stimmung[k.art]) || null;
    if (mood && opts.setMood) opts.setMood(mood);
    stats.stimmung = mood;
  } catch (e) { countErr('kit.mood', e); }

  // 3) Geometrie
  const tb = now();
  const root = new THREE.Group(); root.name = 'kit:' + k.id;
  const deckGroups = [];
  for (let d = 0; d < k.deckN; d++) { const g = new THREE.Group(); g.name = 'deck' + d; root.add(g); deckGroups.push(g); }
  const fogU = makeFog(k.w, k.decks ? k.stride : k.h);
  const mat = makeMaterial(fogU);
  const geos = [], mats = [mat];
  const chunks = new Map();   // 'd,cx,cz' → Bucket
  const bucketAt = (d, tx, lz) => {
    const key = d + ',' + Math.floor(tx / CHUNK) + ',' + Math.floor(lz / CHUNK);
    let b = chunks.get(key); if (!b) { b = new Bucket(); chunks.set(key, b); }
    return b;
  };
  const pen = new Pen();
  const tmpM = new THREE.Matrix4(), tmpN = new THREE.Matrix3(), rotM = new THREE.Matrix4();
  const tileMatrix = (tx, ty, rot = 0, dx = 0, dz = 0, dy = 0) => {
    const m = new THREE.Matrix4().makeRotationY(rot);
    m.setPosition(tx + 0.5 + dx, dy, k.localY(ty) + 0.5 + dz);
    return m;
  };
  const geoCache = new Map();
  const floorShift = new Map();
  const assetGeo = (id, params) => {
    if (!id || !inManifest(id)) return null;
    const ck = id + '|' + JSON.stringify(params) + '|' + paletteId;
    if (geoCache.has(ck)) return geoCache.get(ck);
    let g = null;
    try {
      const r = loader.geometries(id, params, paletteId ? { palette: paletteId } : {});
      g = r && r.geo ? r.geo : null;
    } catch (e) { countErr('kit.asset:' + id, e); g = null; }
    geoCache.set(ck, g);
    if (g) stats.assets[id] = (stats.assets[id] || 0) + 1;
    return g;
  };
  const TERRAIN_FB = { gelaende: 1, fels: 1 };   // Terrain baut der Renderer selbst (§10.1), kein Platzhalter
  const noteFb = (kind) => { if (TERRAIN_FB[kind]) { stats.terrain = (stats.terrain || 0) + 1; return; } stats.platzhalter[kind] = (stats.platzhalter[kind] || 0) + 1; };
  /** Kit-Teil statisch setzen: erstes vorhandenes Asset aus der Kandidatenliste, sonst Platzhalter */
  const placeKit = (kind, params, m, d, tx, ty, opt = {}) => {
    const b = bucketAt(d, tx, k.localY(ty));
    const ids = opt.ids || kandidaten(KIT_KIND(kind));
    for (const id of ids) {
      const g = assetGeo(id, params);
      if (!g) continue;
      let mm = m;
      if (opt.floor) {
        let dy = floorShift.get(g);
        if (dy == null) { const bb = g.boundingBox; dy = bb && isFinite(bb.max.y) && bb.max.y - bb.min.y < 0.6 ? -bb.max.y : 0; floorShift.set(g, dy); }
        if (dy || opt.lift) mm = m.clone().multiply(tmpM.makeTranslation(0, dy + (opt.lift || 0), 0));
      }
      tmpN.getNormalMatrix(mm);
      b.addGeo(g, mm, tmpN);
      return true;
    }
    const fb = FB[opt.fb || kind];
    if (fb) { pen.to(b, m); fb(pen, params, F, THREE); }
    noteFb(kind);
    return false;
  };
  const inner = (x, y) => { const kd = k.kindAt(x, y); return kd != null && !AUSSEN[kd]; };
  const klasse = (x, y) => KLASSE[k.kindAt(x, y)] || null;
  const connOf = (x, y) => {
    const c = klasse(x, y);
    if (!c) return 0;
    const same = (xx, yy) => { const o = klasse(xx, yy); return o === c || (c === 'Z' && o === 'W') || (c === 'W' && o === 'Z'); };
    return (same(x, y - 1) ? 1 : 0) | (same(x + 1, y) ? 2 : 0) | (same(x, y + 1) ? 4 : 0) | (same(x - 1, y) ? 8 : 0);
  };
  const cutOf = (x, y) => (inner(x, y - 1) && k.deckOf(y - 1) === k.deckOf(y) ? 1 : 0);
  const seedOf = (x, y) => (fnv(x + ',' + y, k.seed) & 3);
  const walk = (x, y) => { const kd = k.kindAt(x, y); return !!(kd && (BODEN_KINDS[kd] || kd === 'gelaende')); };
  const sameDeck = (x, y, x2, y2) => k.deckOf(y) === k.deckOf(y2);
  const facing = (x, y) => {
    if (walk(x, y + 1) && sameDeck(x, y, x, y + 1)) return 0;
    if (walk(x, y - 1) && sameDeck(x, y, x, y - 1)) return Math.PI;
    if (walk(x - 1, y)) return -Math.PI / 2;
    if (walk(x + 1, y)) return Math.PI / 2;
    return 0;
  };
  // Parameter eines Kit-Teils: Grundwerte + Nachbarschaft + feste Parameter aus der Bauweisen-Tabelle (diese gewinnen)
  const kitParams = (kind, base, extra) => {
    const e = kitId(kind);
    const p = Object.assign({}, base, extra || {});
    if (!e || e.fest.belag == null) { if (kind === 'boden2') p.belag = 2; else if (kind === 'pad') p.belag = 1; }
    return e ? Object.assign(p, e.fest) : p;
  };
  const hoeheOf = (kind) => { const e = kitId(kind); return e && e.hoehe != null ? +e.hoehe : BODEN_HOEHE[kind] || 0; };
  const dyn = [];
  // Gelände/Fels als Terrain (wie Kesh): Felshöhe nach Hash, niedrig, wenn südlich Begehbares (Kamera schaut von Süden)
  const felsHoehe = (x, y) => {
    const southWalk = (n) => { for (let i = 1; i <= n; i++) { const kd = k.kindAt(x, y + i); if (kd && !AUSSEN[kd] && kd !== 'fels') return i; } return 0; };
    let h = 2 + Math.floor(hash2(x, y, 31) * 3);
    const s = southWalk(2);
    if (s === 1) h = 1; else if (s === 2) h = Math.min(h, 2);
    return h;
  };
  const gel = kitId('gelaende') || {};
  const draussen = k.art !== 'station' && k.art !== 'schiff';   // Außenposten, Ruine: Gelände; Station, Schiff: All
  const felsHell = k.art === 'aussenposten' ? 'frost' : 'stone_light';   // Außenposten liegen im Frost (Stimmung outpost_frost)
  const RAND = 6;
  // Geländehöhe je Kachel (auch im Rand außerhalb der Karte): Fels 1–5 m, Boden 0, Abgrund tief – für verdeckte Seiten
  const ringHoehe = (tx, ty) => {
    if (tx < -RAND || ty < -RAND || tx >= k.w + RAND || ty >= k.h + RAND) return -99;
    const kd = k.kindAt(Math.max(0, Math.min(k.w - 1, tx)), Math.max(0, Math.min(k.h - 1, ty)));
    if (kd === 'abgrund' || kd === 'leere') return -2;
    if (kd === 'fels' || kd === 'wand' || kd === 'zaun') { let h = 3 + Math.floor(hash2(tx, ty, 41) * 3); if (ty >= k.h) h = Math.min(h, ty - k.h < 1 ? 1 : 2); return h; }
    return 0;
  };
  const terrHoehe = (x, y) => {
    if (x < 0 || y < 0 || x >= k.w || y >= k.h) return draussen && !k.decks ? ringHoehe(x, y) : -99;
    const kd = k.kindAt(x, y);
    if (kd === 'fels') return felsHoehe(x, y);
    if (kd === 'abgrund' || kd === 'leere') return -2;
    return 0;
  };
  const nachbarn = (x, y) => [terrHoehe(x, y - 1), terrHoehe(x + 1, y), terrHoehe(x, y + 1), terrHoehe(x - 1, y)];
  // Leitstücke (Signatur/Herzstück) planen: leit[platztyp][art] (bzw. `modell` am leit-Anker).
  // Grundfläche (SCHNITTSTELLEN-NACHTRAG „Rundungsregel Leitstück-Fuß“, nicht nachgebaut):
  //   - gebaute Karte: `fuss: [x0, y0, w, h]` am leit-Anker (Kartenkacheln, nach Drehen/Spiegeln) – unverändert übernommen;
  //   - ohne leit-Anker: gedachter Anker in der Platzmitte (obere linke der mittleren Kacheln) → Shared_Buehne.leitFuss;
  //   - Größe: leit_fuss[modell] der Bauweisen-Tabelle, sonst footprint aus dem Manifest (bei 90° gedreht getauscht).
  // Modellmitte = Mitte des Rechtecks. Deckung im Rechteck: Optik trägt das Leitstück (Kollision bleibt beim Server).
  const leitPlan = [], leitDeckt = new Set();
  try {
    const leitAnker = new Map();
    for (const a of k.anker) if (a.rolle === 'leit' && a.platz && !leitAnker.has(a.platz)) leitAnker.set(a.platz, a);
    const LF = D.leitFuss;
    for (const p of k.plaetze || []) {
      const a = leitAnker.get(p.id);
      let v = BW.leit && BW.leit[p.typ] && (BW.leit[p.typ][k.art] || BW.leit[p.typ]['*']);
      if (v && typeof v === 'object') v = v[p.typ] || v['*'] || null;
      if (a && typeof a.modell === 'string') v = a.modell;
      if (!v || typeof v !== 'string') continue;
      // Ausrichtung: Lage des Moduls, sonst zur freien Seite
      const ax = a ? a.x : p.x + Math.floor((p.w - 1) / 2), ay = a ? a.y : p.y + Math.floor((p.h - 1) / 2);
      let rot;
      if (p.lage && p.lage.rot != null) { rot = -(p.lage.rot | 0) * Math.PI / 2; if (p.lage.spiegel && (p.lage.rot | 0) % 2 === 1) rot = -rot; }
      else rot = facing(ax, ay);
      let rect = null, quelle;
      if (a && Array.isArray(a.fuss) && a.fuss.length === 4) { rect = a.fuss.map((n) => n | 0); quelle = 'fuss'; }
      else {
        let f = BW.leit_fuss && Array.isArray(BW.leit_fuss[v]) ? BW.leit_fuss[v] : null;
        if (!f) { try { f = loader.manifest && loader.manifest(v) ? loader.manifest(v).footprint : null; } catch (e) { f = null; } }
        const quer = Math.abs(Math.sin(rot)) > 0.5;
        const fw = f ? (quer ? f[1] : f[0]) | 0 : 1, fd = f ? (quer ? f[0] : f[1]) | 0 : 1;
        if (LF) { const g = LF(ax, ay, fw, fd); rect = [g.x0, g.y0, fw, fd]; quelle = a ? 'leitFuss' : 'mitte'; }
        else { quelle = 'ohneFuss'; countErr('kit.leit', new Error('Shared_Buehne.leitFuss fehlt – Leitstück ohne Grundfläche')); }
      }
      const mx = rect ? rect[0] + rect[2] / 2 : ax + 0.5, my = rect ? rect[1] + rect[3] / 2 : ay + 0.5;   // Modellmitte (Kacheleinheiten)
      const tx = Math.min(k.w - 1, Math.floor(mx)), ty = Math.min(k.h - 1, Math.floor(my));
      if (rect) for (let y = rect[1]; y < rect[1] + rect[3]; y++) for (let x = rect[0]; x < rect[0] + rect[2]; x++) {
        if (DECKUNG_OPTIK[k.kindAt(x, y)] && k.deckOf(y) === k.deckOf(ay)) leitDeckt.add(x + ',' + y);
      }
      leitPlan.push({ p, v, a, mx, my, tx, ty, rot, rect, quelle });
    }
  } catch (e) { countErr('kit.leit', e); }
  for (let ty = 0; ty < k.h; ty++) {
    const d = k.deckOf(ty);
    for (let tx = 0; tx < k.w; tx++) {
      const ch = k.at(tx, ty), inf = k.info(ch), kind = inf.kind;
      if (kind === 'leere') continue;
      if (kind === 'abgrund') { if (draussen) { pen.to(bucketAt(d, tx, k.localY(ty)), tileMatrix(tx, ty)); FB.tiefe(pen, {}, F); } continue; }
      const m = tileMatrix(tx, ty);
      const seed = seedOf(tx, ty);
      const base = { zustand: zKit, art: k.art, seed, bauweise: bw };
      try {
        if (kind === 'fels') { placeKit('fels', { h: felsHoehe(tx, ty), seed, x: tx, y: ty, nb: nachbarn(tx, ty), hell: felsHell }, m, d, tx, ty, { ids: [], fb: 'fels' }); continue; }
        if (kind === 'gelaende') { placeKit('gelaende', { seed, x: tx, y: ty, top: gel.top, fill: gel.fill, nb: nachbarn(tx, ty) }, m, d, tx, ty, { ids: [], fb: 'gelaende' }); continue; }
        if (kind === 'plateau' || kind === 'rampe' || kind === 'pad') {
          placeKit(kind, kitParams(kind, base), m, d, tx, ty, { ids: kandidaten(kind), floor: true, lift: hoeheOf(kind), fb: kind });
          if (kind === 'plateau') { const h = hoeheOf(kind); if (h > 0.05) { pen.to(bucketAt(d, tx, k.localY(ty)), m); FB.sockel(pen, { h }, F); } }
          continue;
        }
        // Boden unter allem anderen (auch unter Wänden/Türen/Deckung – keine Lücken an Kanten)
        placeKit(kind === 'boden2' ? 'boden2' : 'boden', kitParams(kind === 'boden2' ? 'boden2' : 'boden', base), m, d, tx, ty, { floor: true, fb: 'boden' });
        if (BODEN_KINDS[kind]) continue;
        if (TUER_KINDS[kind]) { dyn.push({ typ: 'tuer', kind, tx, ty, zustaende: inf.zustaende, d }); continue; }
        if (leitDeckt.has(tx + ',' + ty)) continue;   // Leitstück steht hier und trägt die Optik
        const conn = connOf(tx, ty), cut = cutOf(tx, ty);
        if (kind === 'deckung_halb' || kind === 'deckung_voll' || kind === 'pfeiler') {
          const vertical = (conn & 5) && !(conn & 10);
          placeKit(kind, kitParams(kind, base, { conn, cut: 0 }), tileMatrix(tx, ty, vertical ? Math.PI / 2 : 0), d, tx, ty);
          continue;
        }
        if (kind === 'truemmer' || kind === 'schutt') {
          placeKit(kind, kitParams(kind, base, { conn, cut: 0, voll: kind === 'schutt' ? 1 : 0 }), tileMatrix(tx, ty, Math.floor(hash2(tx, ty, 3) * 4) * Math.PI / 2), d, tx, ty, { fb: 'truemmer' });
          continue;
        }
        // Wand, Zaun, Gitter, Fenster, Kante: Gerüst auf lokalen Achsen, conn/cut tragen die Nachbarschaft
        placeKit(kind, kitParams(kind, base, { conn, cut }), m, d, tx, ty);
      } catch (e) { countErr('kit.tile:' + kind, e); }
    }
  }
  // Rand: Gelände/Fels über die Kartenkante hinaus (6 Kacheln) – nur draußen (Außenposten, Ruine); Station/Schiff hängen im All
  if (!k.decks && draussen) {
    const B = 6;
    for (let ty = -B; ty < k.h + B; ty++) for (let tx = -B; tx < k.w + B; tx++) {
      if (tx >= 0 && ty >= 0 && tx < k.w && ty < k.h) continue;
      const cx = Math.max(0, Math.min(k.w - 1, tx)), cy = Math.max(0, Math.min(k.h - 1, ty));
      const kd = k.kindAt(cx, cy);
      if (kd === 'leere') continue;
      const b = bucketAt(0, cx, cy);
      const m = new THREE.Matrix4().makeTranslation(tx + 0.5, 0, ty + 0.5);
      pen.to(b, m);
      if (kd === 'abgrund') FB.tiefe(pen, {}, F);
      else if (kd === 'fels' || kd === 'wand' || kd === 'zaun') FB.fels(pen, { h: ringHoehe(tx, ty), x: tx, y: ty, nb: nachbarn(tx, ty), hell: felsHell }, F);   // Süden niedrig (Kamera)
      else FB.gelaende(pen, { x: tx, y: ty, top: gel.top, fill: gel.fill, nb: nachbarn(tx, ty) }, F);
    }
  }
  // Deko (deterministisch, nur Optik)
  try {
    if (dekoRegeln || dekoExtra.length) {
      const liste = streuen({ id: k.id, w: k.w, h: k.h, seed: k.seed, art: k.art, stride: k.stride, kindAt: k.kindAt, anker: k.anker, plaetze: k.plaetze }, dekoRegeln, { extra: dekoExtra });
      for (const dd of liste) {
        const g = assetGeo(dd.id, { seed: dd.seed, zustand: zKit, art: k.art });
        if (!g) { stats.dekoFehlt[dd.id] = (stats.dekoFehlt[dd.id] || 0) + 1; continue; }   // Deko ohne Asset: weglassen (kein Platzhalter)
        const lift = BODEN_HOEHE[k.kindAt(dd.x, dd.y)] || 0;
        const mm = tileMatrix(dd.x, dd.y, dd.rot, dd.dx, dd.dz, lift);
        tmpN.getNormalMatrix(mm);
        bucketAt(k.deckOf(dd.y), dd.x, k.localY(dd.y)).addGeo(g, mm, tmpN);
        stats.deko++;
      }
    }
  } catch (e) { countErr('kit.deko', e); }
  // Leitstücke setzen (geplant vor den Kacheln, statisch). Ausrichtung nach der Lage des Moduls (Grundlage N: Vorderseite +z
  // zeigt ins Innere); ohne Lage zur freien Seite.
  stats.leit = [];
  try {
    for (const L of leitPlan) {
      const { p, v, a, mx, my, tx, ty, rot, rect, quelle } = L;
      const m = tileMatrix(tx, ty, rot, mx - tx - 0.5, my - ty - 0.5, BODEN_HOEHE[k.kindAt(tx, ty)] || 0);
      const g = assetGeo(v, { zustand: zKit, art: k.art, seed: k.seed & 3, bauweise: bw });
      const b = bucketAt(k.deckOf(ty), tx, k.localY(ty));
      if (g) { tmpN.getNormalMatrix(m); b.addGeo(g, m, tmpN); } else { pen.to(b, m); PROP_FB.leit(pen, {}, F); noteFb('leit'); }
      stats.leit.push({ platz: p.id, typ: p.typ, id: v, an: a ? 'anker' : 'mitte', quelle, fuss: rect, mx, my, asset: !!g, deck: k.deckOf(ty) });
    }
    stats.leitDeckung = leitDeckt.size;   // Deckungskacheln, deren Optik ein Leitstück trägt
  } catch (e) { countErr('kit.leit', e); }
  // Props an Ankern (dynamisch: Zustand)
  for (const a of k.anker) {
    const rs = rollenStates(a.rolle);
    const id = propId(a.rolle, a.platz);
    if (!id && !rs.objekt) continue;
    if (a.rolle === 'tor' || a.rolle === 'eingang' || a.rolle === 'aussicht' && !id) continue;
    dyn.push({ typ: 'prop', anker: a, rolle: a.rolle, id, zustaende: rs.zustaende, d: k.deckOf(a.y), tx: a.x, ty: a.y });
  }
  // Türen: Läufe gleicher Türkacheln (für tor-Anker und Kanten) gruppieren
  const doorAt = new Map();
  for (const t of dyn) if (t.typ === 'tuer') doorAt.set(t.tx + ',' + t.ty, t);
  const EINZEL = { luke: 1, wand_schwach: 1 };   // je Kachel ein Teil
  const lauf = (t) => {
    if (t.lauf) return t.lauf;
    const out = [], q = [t], seen = new Set([t.tx + ',' + t.ty]);
    while (q.length) {
      const c = q.pop(); out.push(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = (c.tx + dx) + ',' + (c.ty + dy), n = doorAt.get(key);
        if (n && !seen.has(key) && n.kind === t.kind) { seen.add(key); q.push(n); }
      }
    }
    for (const c of out) c.lauf = out;
    return out;
  };
  // tor-/eingang-Anker auf bzw. neben Türkacheln: ihr Zustand steuert die Kachel
  for (const a of k.anker) {
    if (a.rolle !== 'tor' && a.rolle !== 'eingang' && a.rolle !== 'versteck') continue;
    let t = doorAt.get(a.x + ',' + a.y);
    if (!t) for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { t = doorAt.get((a.x + dx) + ',' + (a.y + dy)); if (t) break; }
    if (!t) continue;
    for (const c of EINZEL[t.kind] ? [t] : lauf(t)) (c.ankerSteuer || (c.ankerSteuer = [])).push(a);
  }
  // Kanten: Kacheln → Kantenindex
  k.kanten.forEach((e, i) => { for (const tt of e.tiles || []) { const t = doorAt.get(tt[0] + ',' + tt[1]); if (t) t.kante = i; } });
  // Läufe zu einem Objekt zusammenfassen (Kopf = Kachel oben links; Breite = Laufzahl; Steuerung über den ganzen Lauf)
  for (let i = dyn.length - 1; i >= 0; i--) {
    const t = dyn[i];
    if (t.typ !== 'tuer' || EINZEL[t.kind]) continue;
    const L = lauf(t);
    if (L.length < 2) { t.breite = 1; continue; }
    const xs = L.map((c) => c.tx), ys = L.map((c) => c.ty);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const kopf = L.find((c) => c.tx === minX && c.ty === minY) || L[0];
    if (t !== kopf) { dyn.splice(i, 1); continue; }
    t.breite = Math.max(maxX - minX, maxY - minY) + 1;
    t.horiz = maxX > minX;
    t.mitte = [(maxX - minX) / 2, (maxY - minY) / 2];
    const st = new Set(); let kante = null;
    for (const c of L) { for (const a of c.ankerSteuer || []) st.add(a); if (c.kante != null) kante = c.kante; }
    t.ankerSteuer = [...st]; t.kante = kante;
  }
  // Statisches backen
  for (const [key, b] of chunks) {
    const g = b.toGeometry();
    if (!g) continue;
    const d = +key.split(',')[0];
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'kit:' + key; mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    deckGroups[d].add(mesh); geos.push(g);
    stats.tris += g.index.count / 3; stats.chunks++;
  }
  stats.bakeMs = Math.round(now() - tb);
  // Sterne unter Station/Schiff (Weltraum hinter '~'/'_')
  if ((k.art === 'station' || k.art === 'schiff') && opts.sterne !== false) {
    try { root.add(sterne(k)); } catch (e) { countErr('kit.sterne', e); }
  }
  parent.add(root);

  // 4) Dynamische Objekte (Türen, Props)
  const startIdx = (zst, name) => { const i = zst.indexOf(name); return i < 0 ? 0 : i; };
  const ankerZustand = new Map();   // ankerIdx → Zustandsname
  const kantenZustand = new Map();  // kantenIdx → Index in den Zuständen der Kachelart
  const mapName = (zst, name) => {
    if (name == null) return null;
    let i = zst.indexOf(name);
    if (i >= 0) return i;
    const alias = { geloest: 'offen', genommen: 'offen', zerstoert: 'gesprengt', gehackt: 'offen', intakt: 'zu' };
    i = zst.indexOf(alias[name]);
    return i >= 0 ? i : null;
  };
  const ankerName = (a) => {
    const rs = rollenStates(a.rolle);
    if (ankerZustand.has(a.i)) return ankerZustand.get(a.i);
    return k.zustaende[a.id] || rs.zustaende[0] || null;
  };
  const tuerState = (t) => {
    let s = 0;
    if (t.kante != null) {
      const e = k.kanten[t.kante];
      const start = e.start != null ? e.start : e.startName != null ? mapName(t.zustaende, e.startName) : null;
      if (start != null) s = start;
      const ks = k.zustaende[e.id]; if (ks != null) { const i = mapName(t.zustaende, ks); if (i != null) s = i; }
      if (kantenZustand.has(t.kante)) s = kantenZustand.get(t.kante);
    }
    for (const a of t.ankerSteuer || []) {
      const nm = ankerName(a);
      if (a.rolle === 'eingang' && nm === 'offen' && !ankerZustand.has(a.i)) continue;   // Startzustand des Eingangs ändert die Tür nicht
      const i = mapName(t.zustaende, nm);
      if (i != null) s = i;
    }
    return s;
  };
  const dynObjs = [];
  for (const t of dyn) {
    const o = { def: t, key: null, group: null };
    if (t.typ === 'tuer') {
      const x = t.tx, y = t.ty;
      if (t.breite > 1) t.rot = t.horiz ? 0 : Math.PI / 2;
      else {
        const wallX = !!klasse(x - 1, y) || !!klasse(x + 1, y);
        const wallY = !!klasse(x, y - 1) || !!klasse(x, y + 1);
        t.rot = wallX && !wallY ? 0 : wallY && !wallX ? Math.PI / 2 : 0;
      }
      t.off = t.mitte || [0, 0];
      t.cut = cutOf(x, y);
      t.ids = kandidaten(t.kind);
      const ohneConn = t.kind === 'tuer' || t.kind === 'schott' || t.kind === 'tor';
      const conn = connOf(x, y);
      o.params = () => {
        const p = Object.assign({ state: tuerState(t), cut: t.cut, zustand: zKit, art: k.art, seed: seedOf(x, y), bauweise: bw }, (kitId(t.kind) || { fest: {} }).fest);
        if (!ohneConn) p.conn = conn;
        if (t.kind === 'tor') p.breite = Math.max(2, Math.min(4, t.breite || p.breite || 2));
        return p;
      };
    } else {
      const a = t.anker, zst = t.zustaende;
      t.rot = facing(a.x, a.y);
      const fp = t.id && loader.manifest && loader.manifest(t.id) ? loader.manifest(t.id).footprint : null;
      t.off = [0, 0];
      if (fp && (fp[0] > 1 || fp[1] > 1)) {
        // 2×2-Prop: in die Blockmitte zur freien Seite
        const sx = walk(a.x + 1, a.y) || !walk(a.x - 1, a.y) ? 0.5 : -0.5, sz = walk(a.x, a.y + 1) || !walk(a.x, a.y - 1) ? 0.5 : -0.5;
        t.off = [fp[0] > 1 ? sx : 0, fp[1] > 1 ? sz : 0];
      }
      t.lift = BODEN_HOEHE[k.kindAt(a.x, a.y)] || 0;
      o.params = () => {
        const nm = ankerName(a);
        const p = Object.assign({ state: Math.max(0, zst.indexOf(nm)), zustand: zKit, art: k.art, seed: seedOf(a.x, a.y) }, (propEintrag(a.rolle, a.platz) || { fest: {} }).fest);
        return p;
      };
    }
    dynObjs.push(o);
  }
  const fbGeoCache = new Map();
  const buildDyn = (o, p) => {
    const t = o.def;
    const grp = new THREE.Group();
    grp.name = t.typ === 'tuer' ? 'tuer:' + t.tx + ',' + t.ty : 'anker:' + t.anker.id;
    const m = tileMatrix(t.tx, t.ty, t.rot, t.off ? t.off[0] : 0, t.off ? t.off[1] : 0, t.lift || 0);
    grp.matrixAutoUpdate = false; grp.matrix.copy(m);
    const ids = t.typ === 'tuer' ? t.ids : (t.id ? [t.id] : []);
    for (const id of ids) {
      const g = assetGeo(id, p);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true;
      grp.add(mesh);
      return grp;
    }
    // Platzhalter (gecacht je Art + Parameter)
    const kind = t.typ === 'tuer' ? t.kind : t.rolle;
    const ck = kind + '|' + (t.breite || 1) + '|' + JSON.stringify(p);
    let g = fbGeoCache.get(ck);
    if (g === undefined) {
      const b = new Bucket();
      const fn = t.typ === 'tuer' ? FB[t.kind] : PROP_FB[t.rolle];
      if (fn) { pen.to(b, new THREE.Matrix4()); fn(pen, Object.assign({ zustaende: t.zustaende, lauf: t.breite || 1 }, p), F, THREE); }
      else { pen.to(b, new THREE.Matrix4()); pen.box(-0.3, 0, -0.3, 0.3, 1, 0.3, F.get('leit'), F.get('stone')); }
      g = b.toGeometry(); fbGeoCache.set(ck, g);
      if (g) geos.push(g);
      noteFb(t.typ === 'tuer' ? kind : 'anker:' + kind);
    }
    if (g) { const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true; grp.add(mesh); }
    return grp;
  };
  const refresh = () => {
    for (const o of dynObjs) {
      try {
        const p = o.params();
        const key = JSON.stringify(p);
        if (key === o.key) continue;
        if (o.group && o.group.parent) o.group.parent.remove(o.group);
        o.group = buildDyn(o, p);
        deckGroups[o.def.d || 0].add(o.group);
        o.key = key;
      } catch (e) { countErr('kit.dyn', e); }
    }
  };
  refresh();
  stats.dynamisch = dynObjs.length;
  for (const [id, n] of Object.entries(stats.platzhalter)) if (!stats.fehlend.includes(id)) stats.fehlend.push(id);
  let shownDeck = -1;
  const setDeck = (d) => {
    d = Math.max(0, Math.min(k.deckN - 1, d | 0));
    if (d === shownDeck) return;
    shownDeck = d;
    deckGroups.forEach((g, i) => { g.visible = i === d; });
  };
  setDeck(opts.deck || 0);
  stats.buildMs = Math.round(now() - t0);
  stats.tris = Math.round(stats.tris);

  const handle = {
    root, karte: k, stats, deckCount: k.deckN, material: mat, fog: fogU,
    /** Zustände aus dem Snapshot übernehmen: ao [[ankerIdx, zustandIdx]], ko [[kantenIdx, zustandIdx]] (nur Abweichungen) */
    update(s) {
      s = s || {};
      if (s.ao !== undefined || s.ko !== undefined) {
        const key = JSON.stringify([s.ao || null, s.ko || null]);
        if (key !== handle._zKey) {
          handle._zKey = key;
          ankerZustand.clear(); kantenZustand.clear();
          for (const e of s.ao || []) { const a = k.anker[e[0]]; if (a) { const zst = rollenStates(a.rolle).zustaende; if (zst[e[1]] != null) ankerZustand.set(a.i, zst[e[1]]); } }
          for (const e of s.ko || []) if (k.kanten[e[0]]) kantenZustand.set(e[0], e[1] | 0);
          refresh();
        }
      }
    },
    setDeck,
    /** Mitte der Karte (Welt) und Ausdehnung – für Kameras der Galerie */
    center() { return { x: k.w / 2, z: (k.decks ? k.stride : k.h) / 2, w: k.w, h: k.decks ? Math.min(k.h, k.stride) : k.h }; },
    /** Kacheltür-/Prop-Zustand zum Testen: liste aller dynamischen Objekte */
    dynList() { return dynObjs.map((o) => ({ name: o.group && o.group.name, key: o.key })); },
    dispose() {
      if (root.parent) root.parent.remove(root);
      for (const g of geos) g.dispose();
      for (const o of dynObjs) if (o.group) o.group.traverse((x) => { if (x.isMesh && !geos.includes(x.geometry) && !x.geometry.userData.shared) { /* Loader-Geometrien teilt der Cache */ } });
      for (const m of mats) m.dispose();
      fogU.tex.value.dispose();
    },
  };
  return handle;
}

function sterne(k) {
  const n = 900, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const cx = k.w / 2, cz = (k.decks ? k.stride : k.h) / 2;
  for (let i = 0; i < n; i++) {
    const r = 4 + Math.sqrt(hash2(i, 1, 61)) * 80, a = hash2(i, 2, 61) * Math.PI * 2;
    pos[i * 3] = cx + Math.cos(a) * r; pos[i * 3 + 2] = cz + Math.sin(a) * r; pos[i * 3 + 1] = -8 - hash2(i, 3, 61) * 60;
    const b = 0.35 + hash2(i, 4, 61) * 0.65;
    col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b * (0.9 + hash2(i, 5, 61) * 0.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
  p.name = 'kit:sterne'; p.frustumCulled = false; p.renderOrder = -10;
  return p;
}

// --------------------------------------------------------------------------------------------- Galerie: Snapshot und Umsehen
let shared = null;
function sharedRenderer(w, h) {
  if (!shared) {
    const canvas = typeof OffscreenCanvas !== 'undefined' && false ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NeutralToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    shared = { r, canvas };
  }
  shared.r.setPixelRatio(1); shared.r.setSize(w, h, false);
  return shared;
}
const MOOD_FB = { background: '#1A1E26', hemi: { sky: '#C8D2DE', ground: '#4A4236', intensity: 1.0 }, sun: { color: '#FFF0DC', intensity: 2.2, dir: [-0.5, 0.85, 0.55] }, exposure: 1 };
async function ladeMood(loader, id) {
  if (!id) return MOOD_FB;
  try { const m = loader.mood ? await loader.mood(id) : null; return m ? mitAkzent(id, m) : MOOD_FB; } catch (e) { return MOOD_FB; }
}
/** Szene mit Licht nach Stimmung (für Galerie/Umsehen) */
export function lightScene(scene, mood, ext) {
  mood = mood || MOOD_FB;
  scene.background = new THREE.Color(mood.background || '#1A1E26');
  const hemi = new THREE.HemisphereLight(mood.hemi?.sky || '#C8D2DE', mood.hemi?.ground || '#4A4236', mood.hemi?.intensity ?? 1);
  const sunD = mood.sun || MOOD_FB.sun;
  const sun = new THREE.DirectionalLight(sunD.color || '#FFF0DC', sunD.intensity ?? 2);
  const dir = new THREE.Vector3(...(sunD.dir || [-0.5, 0.85, 0.55])).normalize();
  const c = ext ? new THREE.Vector3(ext.x, 0, ext.z) : new THREE.Vector3();
  const R = ext ? Math.max(ext.w, ext.h) * 0.75 + 4 : 30;
  sun.position.copy(c).addScaledVector(dir, R * 1.5); sun.target.position.copy(c);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -R; sc.right = sc.top = R; sc.near = 0.5; sc.far = R * 4;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  scene.add(hemi, sun, sun.target);
  if (mood.ambient && mood.ambient.intensity) scene.add(new THREE.AmbientLight(mood.ambient.color || '#FFFFFF', mood.ambient.intensity));
  return { hemi, sun, exposure: mood.exposure ?? 1 };
}
function frameCamera(cam, ext, opts) {
  const aspect = cam.aspect, elev = (opts.elev ?? 57) * Math.PI / 180;
  const zoom = opts.zoom || 1;
  const fit = Math.max(ext.w / aspect, ext.h) * 1.08 / zoom;
  const dist = fit / (2 * Math.tan(cam.fov * Math.PI / 360)) + 4;
  const tx = opts.target ? opts.target.x : ext.x, tz = opts.target ? opts.target.z : ext.z;
  cam.position.set(tx, Math.sin(elev) * dist, tz + Math.cos(elev) * dist);
  cam.lookAt(tx, 0, tz);
  cam.updateMatrixWorld(true);
}
/** Eine Karte in ein Bild rendern (Galerie-Kachel). opts: build-Optionen + { width, height, elev, zoom, deck } → dataURL */
export async function snapshot(karte, opts = {}) {
  const w = opts.width || 480, h = opts.height || 300;
  const S = sharedRenderer(w, h);
  const scene = new THREE.Scene();
  let moodId = null;
  const handle = await build(scene, karte, Object.assign({}, opts, { setMood: (id) => { moodId = id; } }));
  const loader = opts.loader || DefaultLoader;
  const mood = await ladeMood(loader, moodId);
  const ext = handle.center();
  const L = lightScene(scene, mood, ext);
  S.r.toneMappingExposure = L.exposure;
  const cam = new THREE.PerspectiveCamera(opts.fov || 30, w / h, 0.3, 500);
  frameCamera(cam, ext, opts);
  if (opts.deck) handle.setDeck(opts.deck);
  S.r.render(scene, cam);
  const url = S.canvas.toDataURL('image/png');
  handle.dispose();
  return url;
}
/** Interaktiv umsehen: ziehen = verschieben, Rad = Zoom, Taste 1/2 = Deck. → { handle, render(), dispose() } */
export async function viewer(canvas, karte, opts = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NeutralToneMapping; r.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  let moodId = null;
  const handle = await build(scene, karte, Object.assign({}, opts, { setMood: (id) => { moodId = id; } }));
  const mood = await ladeMood(opts.loader || DefaultLoader, moodId);
  const ext = handle.center();
  const L = lightScene(scene, mood, ext);
  r.toneMappingExposure = L.exposure;
  const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.3, 500);
  const view = { zoom: 1, target: { x: ext.x, z: ext.z } };
  const render = () => {
    const W = canvas.clientWidth || 960, H = canvas.clientHeight || 540;
    r.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix();
    frameCamera(cam, ext, Object.assign({}, opts, view));
    r.render(scene, cam);
  };
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, y: e.clientY, t: Object.assign({}, view.target) }; };
  const onMove = (e) => {
    if (!drag) return;
    const s = Math.max(ext.w, ext.h) / (canvas.clientWidth || 960) / view.zoom * 1.3;
    view.target.x = drag.t.x - (e.clientX - drag.x) * s; view.target.z = drag.t.z - (e.clientY - drag.y) * s;
    render();
  };
  const onUp = () => { drag = null; };
  const onWheel = (e) => { e.preventDefault(); view.zoom = Math.max(0.6, Math.min(6, view.zoom * (e.deltaY > 0 ? 0.85 : 1.18))); render(); };
  const onKey = (e) => { if (e.key === '1' || e.key === '2') { handle.setDeck(+e.key - 1); render(); } };
  canvas.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false }); window.addEventListener('keydown', onKey);
  render();
  return {
    handle, render, camera: cam, scene, renderer: r,
    dispose() {
      canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey);
      handle.dispose(); r.dispose();
    },
  };
}

// --------------------------------------------------------------------------------------------- Layer im Spiel (Zone 'buehne')
// boot.js registriert `layer`. ctx.map = registrierte Karte (Shared_Maps[lpId], awayMap-Felder am Objekt oder unter .karte).
const LZ = { h: null, building: false, mapRef: null, err: 0 };
function teamFog(handle, view, ctx, dt) {
  const U = handle.fog, k = handle.karte;
  const st = (view && view.state) || {};
  const v2 = !!(st.away && st.away.combat === 'v2');
  const R = G.Render;
  if (!v2 || !R || typeof R.teamVision !== 'function') { U.on.value = 0; return; }
  const now0 = now();
  const c = U.cache;
  if (now0 - c.t < 100 && c.set) { /* Positionen höchstens alle 100 ms */ } else {
    let set = null;
    try { set = R.teamVision(view, ctx.map, st); } catch (e) { set = null; }
    c.t = now0; c.set = set;
  }
  const set = c.set;
  if (!set) { U.on.value = 0; return; }
  U.on.value = 1;
  const kk = Math.min(1, dt * 7);
  const d = ctx.deck || 0, y0 = k.decks ? d * k.stride : 0;
  let changed = false;
  for (let ly = 0; ly < U.h; ly++) for (let tx = 0; tx < U.w; tx++) {
    const i = ly * U.w + tx, ty = ly + y0;
    const target = set.has(tx + ',' + ty) ? 1 : 0;
    const dd = target - U.cur[i];
    if (dd === 0) continue;
    U.cur[i] = Math.abs(dd) > 0.004 ? U.cur[i] + dd * kk : target;
    const v = Math.round(U.cur[i] * 255);
    U.data[i * 4] = U.data[i * 4 + 1] = U.data[i * 4 + 2] = v; U.data[i * 4 + 3] = 255;
    changed = true;
  }
  if (changed) U.tex.value.needsUpdate = true;
}
export const layer = {
  id: 'buehne', zones: ['buehne'],
  build(ctx) {
    LZ.mapRef = ctx.map || null;
    if (!LZ.mapRef) return;   // Karte (awayMap) noch nicht registriert – update() baut nach
    return startBuild(ctx);
  },
  update(view, dt, ctx) {
    if (!LZ.h && !LZ.building) {
      if (!ctx.map) { const id = view && view.state && view.state.away && view.state.away.map; const M = G.Shared_Maps || {}; ctx.map = id ? (M[id] || (M.AWAY && M.AWAY[id]) || null) : null; }
      if (ctx.map) startBuild(ctx);
      return;
    }
    if (!LZ.h) return;
    const aw = (view && view.state && view.state.away) || {};
    LZ.h.update({ ao: aw.ao || [], ko: aw.ko || [] });
    LZ.h.setDeck(ctx.deck || 0);
    teamFog(LZ.h, view, ctx, dt);
  },
  dispose() { if (LZ.h) { try { LZ.h.dispose(); } catch (e) { /* egal */ } } LZ.h = null; LZ.building = false; LZ.mapRef = null; },
  stats() { return LZ.h ? Object.assign({ id: LZ.h.karte.id, art: LZ.h.karte.art }, LZ.h.stats) : null; },
};
function startBuild(ctx) {
  LZ.building = true;
  const myRoot = ctx.root;
  const p = build(myRoot, ctx.map, { loader: ctx.loader, setMood: (id) => ctx.setMood(id), countError: (w, e) => ctx.countError(w, e) })
    .then((h) => { if (ctx.root !== myRoot || !myRoot.parent) { h.dispose(); return; } LZ.h = h; LZ.building = false; },
      (e) => { LZ.building = false; LZ.err++; ctx.countError('kit.build', e); throw e; });
  return p;
}

/**
 * Kit-Teile und Props aller aktiven Bauweisen im Hintergrund laden (Spiel: einige Sekunden nach dem Start), damit der Bau
 * beim Betreten einer Bühne warm ist (Budget Außenposten < 1,5 s; kalt kostet allein das Laden ~1,5 s).
 */
export async function prefetch(opts = {}) {
  const loader = opts.loader || DefaultLoader;
  const base = opts.base || BASE;
  try {
    if (loader.ready) await loader.ready;
    const achsen = await getJson(base + 'achsen.json');
    const bws = achsen && achsen.bauweisen ? Object.keys(achsen.bauweisen).filter((b) => achsen.bauweisen[b].status === 'aktiv') : ['germanen', 'rom'];
    const ids = new Set();
    const add = (v) => { if (!v) return; if (typeof v === 'string') { if (/^(kit|prop|leit)\//.test(v)) ids.add(v); return; } if (Array.isArray(v)) v.forEach(add); else if (typeof v === 'object') Object.values(v).forEach(add); };
    for (const bw of bws) {
      const t = await getJson(base + 'bauweisen/' + bw + '.json');
      if (t) { add(t.kits); add(t.anker); add(t.leit); }
      const d = await getJson(base + 'deko/' + bw + '.json');
      if (d && d.regeln) for (const r of Object.values(d.regeln)) add(r && r.props);
    }
    const list = [...ids].filter((id) => { try { return !!loader.manifest(id); } catch (e) { return false; } });
    for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map((id) => loader.load(id)));
    return list.length;
  } catch (e) { return 0; }
}

// Spiel: früh im Leerlauf vorladen (boot.js importiert kit.js beim Start des Voxel-Modus). Lädt nur JSON-Rezepte in Sechserstücken,
// blockiert keinen Frame. CLIENT kann VoxelKit.prefetch() zusätzlich beim Betreten der Transferkammer rufen (läuft nur einmal).
let prefetchLauf = null;
export function prefetchEinmal(opts) { if (!prefetchLauf) prefetchLauf = prefetch(opts).catch(() => 0); return prefetchLauf; }
if (typeof window !== 'undefined' && window.VoxelRender && window.VoxelRender.mode === 'voxel' && !/kit-test/.test(location.pathname)) {
  const go = () => { prefetchEinmal(); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 6000 }); else setTimeout(go, 1500);
}

if (typeof window !== 'undefined') window.VoxelKit = { prefetch: prefetchEinmal, prefetchNeu: prefetch, build, snapshot, viewer, normKarte, layer, lightScene, clearCache, BODEN_HOEHE, version: VERSION, stats: () => layer.stats() };
