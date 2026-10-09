// Sektorkarte (CONTRACT-B3 §2/§3, Team SEKTOR). UMD: window.Shared_Sektoren / require. Reine Funktionen.
// Quelle der Karte: content/welt/limes.json (E31). In Node per require geladen, im Browser aus dem `welcome`
// (Feld `sektorkarte`) per Shared_Sektoren.setzeKarte(k) gesetzt.
//
// Geometrie wie karte_limes.py: Koordinate SSZZ (Spalte, Zeile, ab 1), flache Hexe, ungerade Spalten oben, gerade
// Spalten um eine halbe Hexhöhe nach unten versetzt. Richtung 0–5: 0 = Nord, im Uhrzeigersinn (1 = NO, 2 = SO, 3 = Süd,
// 4 = SW, 5 = NW). Szenenwinkel wie physics.js: 0 = +x (Bug rechts), im Uhrzeigersinn, y nach unten.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let karte = null, cfg = null;
    try { karte = require('../content/welt/limes.json'); } catch (e) { karte = null; }
    try { cfg = require('./config.js'); } catch (e) { cfg = null; }
    module.exports = factory(karte, cfg);
  } else root.Shared_Sektoren = factory(null, root.Shared_Config || null);
})(typeof self !== 'undefined' ? self : this, function (startKarte, CONFIG) {
  'use strict';

  const SQ3 = Math.sqrt(3);
  const LEER_PREFIX = 'leer-';
  const api = { KARTE: null, version: 0 };
  let kantenIdx = {};     // kanteId -> Kante
  let vonIdx = {};        // hex -> [Kante]
  let ortIdx = {};        // ortId -> hex
  let leerCache = {};     // hex -> Orts-Objekt (Leerraum)
  const hooks = [];       // Rückrufe bei neuer Karte (locations.js leitet links neu ab)

  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  function code(c, r) { return pad2(c) + pad2(r); }
  function teile(hex) {
    if (typeof hex !== 'string' || !/^\d{4}$/.test(hex)) return null;
    return { c: Number(hex.slice(0, 2)), r: Number(hex.slice(2)) };
  }
  function imRaster(hex) {
    const p = teile(hex); const K = api.KARTE;
    if (!p || !K) return false;
    return p.c >= 1 && p.c <= K.spalten && p.r >= 1 && p.r <= K.zeilen;
  }

  function setzeKarte(k) {
    api.KARTE = k && typeof k === 'object' ? k : null;
    kantenIdx = {}; vonIdx = {}; ortIdx = {}; leerCache = {};
    const K = api.KARTE;
    if (K) {
      for (const e of K.kanten || []) {
        const id = kanteId(e.a, e.b);
        kantenIdx[id] = e;
        (vonIdx[e.a] = vonIdx[e.a] || []).push(e);
        (vonIdx[e.b] = vonIdx[e.b] || []).push(e);
      }
      for (const [hex, h] of Object.entries(K.hexe || {})) if (h && h.ort) ortIdx[h.ort] = hex;
    }
    api.version++;
    for (const f of hooks) { try { f(api.KARTE); } catch (e) { /* Anzeige-Hook: nie werfen */ } }
    return api.KARTE;
  }
  function beiKarte(f) { if (typeof f === 'function') hooks.push(f); }

  // ---------- Nachbarschaft und Kanten ----------
  // Formel aus karte_limes.py (neighbors): ungerade Spalte oben
  function nachbarn(hex) {
    const p = teile(hex); if (!p || !imRaster(hex)) return [];
    const { c, r } = p;
    const cand = c % 2
      ? [[c, r - 1], [c, r + 1], [c - 1, r - 1], [c - 1, r], [c + 1, r - 1], [c + 1, r]]
      : [[c, r - 1], [c, r + 1], [c - 1, r], [c - 1, r + 1], [c + 1, r], [c + 1, r + 1]];
    const out = cand.map(([a, b]) => code(a, b)).filter((h) => a1(h) && imRaster(h));
    return out.sort((x, y) => richtung(hex, x) - richtung(hex, y));
  }
  function a1(h) { const p = teile(h); return !!p && p.c >= 1 && p.r >= 1; }
  function sindNachbarn(a, b) { return nachbarn(a).includes(b); }
  function kanteId(a, b) { return String(a) < String(b) ? a + '-' + b : b + '-' + a; }
  function kanteAusId(id) {
    const m = /^(\d{4})-(\d{4})$/.exec(String(id || ''));
    return m ? { a: m[1], b: m[2] } : null;
  }
  function kante(a, b) { return b === undefined ? (kantenIdx[a] || null) : (kantenIdx[kanteId(a, b)] || null); }
  function kantenVon(hex) { return (vonIdx[hex] || []).slice(); }
  function anderes(e, hex) { return e.a === hex ? e.b : e.a; }

  // ---------- Geometrie ----------
  // Mittelpunkt eines Hexes bei Kantenlänge s; Hex 0101 liegt bei (s, √3·s/2), das Raster beginnt bei (0, 0).
  function hexZuPixel(hex, s) {
    const p = teile(hex); if (!p) return null;
    const h3 = SQ3 * s;
    return { x: s + 1.5 * s * (p.c - 1), y: h3 / 2 + h3 * (p.r - 1) + (p.c % 2 === 0 ? h3 / 2 : 0) };
  }
  // Pixel -> Hex (nächster Mittelpunkt = Hex der Kachelung); außerhalb des Rasters null
  function pixelZuHex(x, y, s) {
    const K = api.KARTE; if (!K || !(s > 0)) return null;
    let best = null, bd = Infinity;
    const c0 = Math.round((x - s) / (1.5 * s)) + 1;
    for (let c = Math.max(1, c0 - 1); c <= Math.min(K.spalten, c0 + 1); c++) {
      for (let r = 1; r <= K.zeilen; r++) {
        const m = hexZuPixel(code(c, r), s);
        const d = (m.x - x) * (m.x - x) + (m.y - y) * (m.y - y);
        if (d < bd) { bd = d; best = code(c, r); }
      }
    }
    return best && Math.sqrt(bd) <= s ? best : null;
  }
  // Richtung von a nach b (0 = Nord, im Uhrzeigersinn); für Nicht-Nachbarn die nächste der sechs Richtungen
  function richtung(a, b) {
    const pa = hexZuPixel(a, 1), pb = hexZuPixel(b, 1);
    if (!pa || !pb) return -1;
    const w = Math.atan2(pb.y - pa.y, pb.x - pa.x);   // Szenenwinkel (0 = +x, y nach unten)
    return ((Math.round((w + Math.PI / 2) / (Math.PI / 3)) % 6) + 6) % 6;
  }
  // Szenenwinkel einer Richtung (Bug rechts = 0, im Uhrzeigersinn): Nord = −π/2
  function winkel(ri) { return -Math.PI / 2 + ri * Math.PI / 3; }
  // Lage des Sprungpunkts in einer Szene w×h: vom Mittelpunkt in Kantenrichtung bis rand px vor den Szenenrand
  function sprungpunktLage(w, h, ri, rand) {
    const wk = winkel(ri); const dx = Math.cos(wk), dy = Math.sin(wk);
    const cx = w / 2, cy = h / 2;
    const tx = Math.abs(dx) > 1e-9 ? cx / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 1e-9 ? cy / Math.abs(dy) : Infinity;
    const t = Math.max(0, Math.min(tx, ty) - (Number(rand) || 0));
    return { x: Math.round(cx + dx * t), y: Math.round(cy + dy * t), angle: wk };
  }

  // ---------- Hex-Eigenschaften ----------
  function hexDaten(hex) { const K = api.KARTE; return K && K.hexe ? K.hexe[hex] || null : null; }
  function istLeerraum(hex) { return imRaster(hex) && !hexDaten(hex); }
  function spielbar(hex) { const h = hexDaten(hex); return h ? !!h.spielbar : istLeerraum(hex); }
  function region(hex) { const K = api.KARTE; const h = hexDaten(hex); return K && h && K.regionen ? K.regionen[h.region] || null : null; }
  function sperrtext(hex) { const r = region(hex); return r && r.sperrtext ? r.sperrtext : null; }
  function hexName(hex) { const h = hexDaten(hex); return h ? h.name : 'Leerraum ' + hex; }

  // ---------- Orte <-> Hexe ----------
  function istLeerId(id) { return typeof id === 'string' && id.startsWith(LEER_PREFIX) && /^\d{4}$/.test(id.slice(LEER_PREFIX.length)); }
  function hexVonOrt(id) {
    if (istLeerId(id)) { const h = id.slice(LEER_PREFIX.length); return istLeerraum(h) ? h : null; }
    return ortIdx[id] || null;
  }
  // Ort-ID eines Hexes: Orts-ID aus locations.js, Leerraum 'leer-<hex>', sonst null (System ohne Raumszene)
  function ortVonHex(hex) {
    const h = hexDaten(hex);
    if (h) return h.ort || null;
    return istLeerraum(hex) ? LEER_PREFIX + hex : null;
  }
  // Leere Szene aus Daten (E30): ein Orts-Objekt wie in locations.js
  function leerraumOrt(hex) {
    if (!istLeerraum(hex)) return null;
    if (leerCache[hex]) return leerCache[hex];
    const sz = (CONFIG && CONFIG.sektoren && CONFIG.sektoren.leerraumSzene) || { w: 2400, h: 1800, asteroids: 0 };
    const w = sz.w || 2400, h = sz.h || 1800;
    const p = hexZuPixel(hex, 1);
    const o = {
      id: LEER_PREFIX + hex, name: 'Leerraum ' + hex, kind: 'void', hex, x: Math.round(p.x * 100), y: Math.round(p.y * 100),
      links: [], fog: false, leer: true,
      desc: 'Leerraum: kein System, keine Bojen. Hinaus nur über einen temporären Sprungpunkt oder per Notfallsprung.',
      first: 'Leerraum ' + hex + '. Keine Bojen, kein Funk. Hinaus nur per Notfallsprung – erst den Reaktor neu starten.',
      scene: { w, h, asteroids: sz.asteroids || 0, arrive: { x: Math.round(w / 2), y: Math.round(h / 2), angle: 0 } },
      hidden: [],
    };
    leerCache[hex] = o;
    return o;
  }

  // Inhalt für den Client (`welcome.sektorkarte`): limes.json ohne praesenz/quelle
  function fuerClient() {
    const K = api.KARTE; if (!K) return null;
    const o = {};
    for (const [k, v] of Object.entries(K)) if (k !== 'praesenz' && k !== 'quelle') o[k] = v;
    return o;
  }

  Object.assign(api, {
    LEER_PREFIX, setzeKarte, beiKarte, nachbarn, sindNachbarn, kanteId, kanteAusId, kante, kantenVon, anderes,
    hexZuPixel, pixelZuHex, richtung, winkel, sprungpunktLage, imRaster, hexDaten, istLeerraum, spielbar, region, sperrtext,
    hexName, istLeerId, hexVonOrt, ortVonHex, leerraumOrt, fuerClient,
  });
  if (startKarte) setzeKarte(startKarte);
  return api;
});
