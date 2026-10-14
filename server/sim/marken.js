'use strict';
// SL1B Hex-Marken (Action-Layer): was auf der Hexkarte bzw. dem Sektorplan hervorgehoben wird – Missionsziele, Notrufe, Spuren, Funde,
// Kontakte. Quelle der Wahrheit ist dieser Zustand, nicht die Kartendaten (Notrufe und Spuren entstehen zur Laufzeit).
//   setze(game, { id, typ, hex | ort, sym?, ticks? })   Marke setzen bzw. ersetzen (typ: notruf | spur | fund | kontakt; ziel kommt aus den Missionen)
//   entferne(game, id)                                    Marke entfernen
//   liste(game)                                           alle Marken: abgeleitete Ziele (Fokus-Mission, Ziele mit hex) + gesetzte, höchstens MAX
//   snapshot(game) / key(game)                            Snapshot `world.marken` [{ h, t, id?, s?, b? }] und sein Änderungsschlüssel
//   zuruecksetzen(game)                                   neue Partie / Laden: nichts übernehmen
// Ablauf: `ticks` rechnet game.time + ticks * CONFIG.marken.tickSekunden; Notrufe (SL8) verschwinden damit von allein. `b` im Snapshot
// ist der Rest in Sekunden (gerundet auf 5 s, damit sich der Snapshot nicht jede Sekunde ändert).
// Gesetzte Marken werden nicht im Weltstand gespeichert; wer sie braucht (Notrufe, Spur), setzt sie nach dem Laden neu.
const Sektoren = require('../../shared/sektoren.js');

const MAX = 8;
const TYPEN = ['ziel', 'notruf', 'spur', 'fund', 'kontakt'];
const GESETZT = ['notruf', 'spur', 'fund', 'kontakt'];
const TICK_S = 30;   // Sekunden je Tick, solange CONFIG.marken fehlt (SL8 legt den Tick fest)

function zustand(game) { if (!Array.isArray(game.marken)) game.marken = []; return game.marken; }
function zuruecksetzen(game) { game.marken = []; game.sentMarkenKey = null; }

// Hex (SSZZ) aus Hex-Code, Ort-ID oder 'leer-<hex>'; null, wenn nicht auf der Karte
function hexVon(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  const h = /^\d{4}$/.test(ref) ? ref : Sektoren.istLeerId(ref) ? ref.slice(Sektoren.LEER_PREFIX.length) : Sektoren.hexVonOrt(ref);
  return h && Sektoren.imRaster(h) ? h : null;
}
const tickSek = (game) => Number(game && game.C && game.C.marken && game.C.marken.tickSekunden) || TICK_S;

function setze(game, m) {
  if (!m || typeof m !== 'object') return 'Marke fehlt.';
  const id = String(m.id || '');
  if (!/^[a-z0-9_.:-]{1,40}$/i.test(id)) return 'Marken-Id fehlt oder ist ungültig.';
  if (!GESETZT.includes(m.typ)) return `Marken-Typ '${m.typ}': gültig ${GESETZT.join(', ')} (ziel kommt aus den Missionen).`;
  const h = hexVon(m.hex || m.ort);
  if (!h) return `Marke ${id}: Hex bzw. Ort '${m.hex || m.ort}' gibt es nicht.`;
  const L = zustand(game);
  const rec = { id, t: m.typ, h };
  if (m.sym) rec.s = String(m.sym).slice(0, 20);
  if (Number.isFinite(m.ticks) && m.ticks > 0) { rec.ges = Math.round(m.ticks * tickSek(game)); rec.bis = game.time + rec.ges; }
  const i = L.findIndex((x) => x.id === id);
  if (i >= 0) L[i] = rec; else L.push(rec);
  return null;
}
function entferne(game, id) {
  const L = zustand(game); const i = L.findIndex((x) => x.id === id);
  if (i < 0) return false;
  L.splice(i, 1); return true;
}
function da(game, id) { return zustand(game).some((x) => x.id === id); }

// Ziele aus den Missionen: Ort des fokussierten Auftrags, offene Ziele des aktuellen Schritts mit `hex`, sonst das Kapitel der Kette
function ziele(game) {
  const out = [];
  const add = (ref, id) => { const h = hexVon(ref); if (h && !out.some((x) => x.h === h)) out.push({ id, t: 'ziel', h }); };
  const m = game.mission;
  if (!m) return out;
  try {
    for (const o of (m.step && m.step.objectives) || []) {
      if (!o.hex) continue;
      if (o.show !== undefined && !m.cond(o.show)) continue;
      const st = (m.state.objectives || []).find((x) => x.id === o.id);
      if (!st || !st.done) add(o.hex, 'z:' + o.id);
    }
    const f = typeof m.focusSnapshot === 'function' ? m.focusSnapshot() : null;
    if (f && f.focusLoc) add(f.focusLoc, 'z:ort');
    if (!out.length && m.kette && typeof m.kette.aktuell === 'function') { const c = m.kette.aktuell(); if (c && c.ort) add(c.ort, 'z:kapitel'); }
  } catch (e) { if (game.countError) game.countError('marken-ziele', e); }
  return out;
}

// abgelaufene Marken entfernen, dann Liste
function liste(game) {
  const L = zustand(game);
  for (let i = L.length - 1; i >= 0; i--) if (L[i].bis != null && game.time >= L[i].bis) L.splice(i, 1);
  return ziele(game).concat(L).slice(0, MAX);
}
function snapshot(game) {
  return liste(game).map((x) => {
    const o = { h: x.h, t: x.t };
    if (x.t !== 'ziel') o.id = x.id;
    if (x.s) o.s = x.s;
    if (x.bis != null) { o.b = Math.max(0, Math.ceil((x.bis - game.time) / 5) * 5); o.g = x.ges; }
    return o;
  });
}
function key(game) { return JSON.stringify(snapshot(game)); }

module.exports = { MAX, TYPEN, hexVon, setze, entferne, da, ziele, liste, snapshot, key, zuruecksetzen };
