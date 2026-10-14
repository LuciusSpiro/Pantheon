// SL2 Kulisse: Passanten, Händler und Gäste eines belebten Außenpostens (Kantenstein). UMD: window.Shared_Kulisse / require.
// Reine Funktionen, deterministisch: Position, Blickrichtung und Sprechblase hängen nur von Karte (Seed, Plätze), Figurendaten und der
// Spielzeit ab. Der Server schickt die Figuren nicht im Snapshot; Client, Test und Bot rechnen dasselbe aus (Kai 2026-10-14: Kulisse ohne
// Kollision, Wege aus Seed + Zeit, nicht im Snapshot).
//   figuren(ku, karte, zeit)  -> [{ id, name, x, y, dir, moving, blase? }]   Pixel wie der Rest der Außenkarte (Kachel = 32 px)
//   figurPunkte(f, plaetze)   -> Wegpunkte einer Figur in Kacheln (Tests, Prüfer)
//   pruefen(ku, plaetze)      -> [Fehlertext]   jede Figur hat einen Platz, ihr Weg liegt im Platz
// ku (aus content/welt/kulisse.json, je Landepunkt; Server legt es in die awayMap-Nachricht als `ku`):
//   { figuren: [{ id, name, platz, art: 'achse'|'rund'|'steht', spur?, fx?, fy?, blick?, tempo?, pause?, blase?: [Text], periode? }] }
// karte: { seed, plaetze } – plaetze entweder die Liste der awayMap-Nachricht [[id, typ, x, y, w, h]] oder das Objekt { id: { rect: [x, y, w, h] } }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Kulisse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 32;
  const TEMPO = 26;          // px/s, gemächlicher Schritt (Spieler laufen deutlich schneller)
  const PAUSE = 4;           // s Stehen am Wegende
  const BLASE_DAUER = 3.6;   // s sichtbar je Periode
  const BLASE_PERIODE = 19;  // s zwischen zwei Sprüchen (je Figur ± Streuung)
  const DIRS = ['right', 'down', 'left', 'up'];

  function fnv(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }

  function rectVon(plaetze, id) {
    if (Array.isArray(plaetze)) { const p = plaetze.find((q) => q && q[0] === id); return p ? [p[2], p[3], p[4], p[5]] : null; }
    const p = plaetze && plaetze[id];
    return p && p.rect ? p.rect.slice(0, 4) : null;
  }
  const mitte = (x, y) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });

  // Wegpunkte einer Figur in Kacheln; geschlossen = Rundlauf (sonst Hin und Zurück)
  function figurPunkte(f, plaetze) {
    const r = rectVon(plaetze, f.platz);
    if (!r) return null;
    const [x, y, w, h] = r;
    const art = f.art || 'achse';
    if (art === 'steht') return { punkte: [[x + Math.min(w - 1, Math.max(0, Math.round((w - 1) * (f.fx != null ? f.fx : 0.5)))), y + Math.min(h - 1, Math.max(0, Math.round((h - 1) * (f.fy != null ? f.fy : 0.5))))]], geschlossen: false };
    if (art === 'rund') {
      const inset = f.rand != null ? f.rand : 1;   // Abstand zum Platzrand in Kacheln
      const a = Math.min(inset, Math.floor((w - 1) / 2)), b = Math.min(inset, Math.floor((h - 1) / 2));
      const x0 = x + a, x1 = x + w - 1 - a, y0 = y + b, y1 = y + h - 1 - b;
      return { punkte: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], geschlossen: true };
    }
    const spur = f.spur || 0;
    const von = f.von != null ? f.von : 0, bis = f.bis != null ? f.bis : 1;   // Anteil der Achse (0..1), z. B. nur der Westteil einer Straße
    const teil = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return [Math.round(lo + (hi - lo) * von), Math.round(lo + (hi - lo) * bis)]; };
    if (w >= h) { const yy = Math.max(y, Math.min(y + h - 1, y + Math.floor((h - 1) / 2) + spur)); const [a, b] = teil(x + 1 > x + w - 1 ? x : x + 1, Math.max(x, x + w - 2)); return { punkte: [[a, yy], [b, yy]], geschlossen: false }; }
    const xx = Math.max(x, Math.min(x + w - 1, x + Math.floor((w - 1) / 2) + spur));
    const [a, b] = teil(y + 1 > y + h - 1 ? y : y + 1, Math.max(y, y + h - 2));
    return { punkte: [[xx, a], [xx, b]], geschlossen: false };
  }

  const dirVon = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up'));

  // Ort der Figur zur Zeit t (s)
  function ort(f, weg, seed, t) {
    const pk = weg.punkte.map((p) => mitte(p[0], p[1]));
    if (pk.length === 1) return { x: pk[0].x, y: pk[0].y, dir: f.blick && DIRS.includes(f.blick) ? f.blick : 'down', moving: false };
    const v = f.tempo || TEMPO;
    const pause = f.pause != null ? f.pause : PAUSE;
    const strecken = [];
    const n = weg.geschlossen ? pk.length : pk.length - 1;
    let L = 0;
    for (let i = 0; i < n; i++) { const a = pk[i], b = pk[(i + 1) % pk.length]; const d = Math.hypot(b.x - a.x, b.y - a.y); strecken.push({ a, b, d }); L += d; }
    const phase = (fnv(f.id + ':' + seed) % 100000) / 100000;
    if (weg.geschlossen) {
      const zyklus = L / v + strecken.length * pause;
      let u = ((t + phase * zyklus) % zyklus + zyklus) % zyklus;
      for (const s of strecken) {
        const lauf = s.d / v;
        if (u < lauf) { const q = u / lauf; return { x: s.a.x + (s.b.x - s.a.x) * q, y: s.a.y + (s.b.y - s.a.y) * q, dir: dirVon(s.b.x - s.a.x, s.b.y - s.a.y), moving: true }; }
        u -= lauf;
        if (u < pause) return { x: s.b.x, y: s.b.y, dir: dirVon(s.b.x - s.a.x, s.b.y - s.a.y), moving: false };
        u -= pause;
      }
      return { x: pk[0].x, y: pk[0].y, dir: 'down', moving: false };
    }
    // Hin und Zurück: Lauf, Pause, Rücklauf, Pause
    const s = strecken[0]; const lauf = s.d / v;
    const zyklus = 2 * (lauf + pause);
    let u = ((t + phase * zyklus) % zyklus + zyklus) % zyklus;
    const hin = (q, moving, rueck) => ({ x: s.a.x + (s.b.x - s.a.x) * q, y: s.a.y + (s.b.y - s.a.y) * q, dir: dirVon((rueck ? -1 : 1) * (s.b.x - s.a.x), (rueck ? -1 : 1) * (s.b.y - s.a.y)), moving });
    if (u < lauf) return hin(u / lauf, true, false);
    u -= lauf; if (u < pause) return hin(1, false, false);
    u -= pause; if (u < lauf) return hin(1 - u / lauf, true, true);
    return hin(0, false, true);
  }

  function blase(f, seed, t) {
    const zeilen = f.blase;
    if (!Array.isArray(zeilen) || !zeilen.length) return undefined;
    const h = fnv('b:' + f.id + ':' + seed);
    const periode = (f.periode || BLASE_PERIODE) + (h % 7);
    const u = t + (h % 1000) / 1000 * periode;
    const k = Math.floor(u / periode);
    if (u - k * periode > BLASE_DAUER) return undefined;
    return zeilen[(k + (h >>> 8)) % zeilen.length];
  }

  function figuren(ku, karte, zeit) {
    const out = [];
    if (!ku || !Array.isArray(ku.figuren) || !karte) return out;
    const seed = karte.seed != null ? karte.seed : 0;
    for (const f of ku.figuren) {
      const weg = figurPunkte(f, karte.plaetze);
      if (!weg) continue;
      const o = ort(f, weg, seed, zeit || 0);
      const b = blase(f, seed, zeit || 0);
      const rec = { id: 'ku_' + f.id, name: f.name || f.id, x: Math.round(o.x * 10) / 10, y: Math.round(o.y * 10) / 10, dir: o.dir, moving: o.moving, k: 1 };
      if (b) rec.blase = b;
      out.push(rec);
    }
    return out;
  }

  function pruefen(ku, plaetze) {
    const fehler = [];
    if (!ku || !Array.isArray(ku.figuren)) return ['kulisse: figuren fehlt'];
    const ids = new Set();
    for (const f of ku.figuren) {
      if (!f.id || ids.has(f.id)) fehler.push(`Figur '${f.id}': Kennung fehlt oder doppelt`);
      ids.add(f.id);
      if (!['achse', 'rund', 'steht', undefined].includes(f.art)) fehler.push(`Figur ${f.id}: Art '${f.art}' gibt es nicht`);
      const r = rectVon(plaetze, f.platz);
      if (!r) { fehler.push(`Figur ${f.id}: Platz '${f.platz}' gibt es nicht`); continue; }
      const w = figurPunkte(f, plaetze);
      for (const p of w.punkte) if (p[0] < r[0] || p[1] < r[1] || p[0] >= r[0] + r[2] || p[1] >= r[1] + r[3]) fehler.push(`Figur ${f.id}: Wegpunkt ${p} liegt außerhalb von ${f.platz}`);
      for (const z of f.blase || []) if (String(z).length > 60) fehler.push(`Figur ${f.id}: Sprechblase länger als 60 Zeichen`);
    }
    return fehler;
  }

  return { TILE, figuren, figurPunkte, pruefen, fnv };
});
