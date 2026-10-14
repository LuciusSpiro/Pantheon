'use strict';
// SL4 (CONCEPT-SL4): Sektorplan des Captains – Gedächtnis über Sektoren. Storage + Action des Plans (Anzeige: public/js/sektorplan.js).
//   game.sektorplan = { gesichtet: { <hex>: { q, t } }, marken: [{ id, h, x, y, k }], schiffe: [{ h, art, x, y, t }] }
//   gesichtet  Hexe, die eine Sonde (q 'sonde') oder eine Karte (q 'karte') offenlegte, OHNE erkundet zu sein; erkundete Hexe stehen in explore.erkundet
//   marken     Einträge des Captains (und später Spur/Notruf, SL5/SL8): Position im Szenen-Koordinatensystem des Hexes
//   schiffe    Momentaufnahme mit Zeit t (Spielzeit): nur Daten der Regiebuch-/Kartenfestlegung (Hex-Eintrag `schiffe`), keine Simulation
// Ortsfestes (Stern, Planeten, Station, Bojen, Sprungpunkte) rechnen Client und Server aus den Kartendaten (shared/sektorplan.js).
// Weltstand: welt.sektorplan { gesichtet: { hex: { q, alter } }, marken, schiffe: [{ …, alter }] } (alter = Sekunden seit der Sicht).
const Sektoren = require('../../shared/sektoren.js');
const Plan = require('../../shared/sektorplan.js');

const MAX_MARKEN = 12, MAX_SCHIFFE = 12;
// Marken des Sektorplans sind NOTIZEN des Captains mit Position im Sektor (marke | fund | kontakt). Marken auf HEX-Ebene (Missionsziel, Notruf, Spur)
// gehören server/sim/marken.js (SL1B, ein Mechanismus: Notrufe/Spur setzen dort; der Sektorplan zeichnet sie am Sektor mit).
const MARKEN_ARTEN = ['marke', 'fund', 'kontakt'];
const r1 = (v) => Math.round(v * 10) / 10;

function neu() { return { gesichtet: {}, marken: [], schiffe: [], seq: 0 }; }
function reset(game) { game.sektorplan = neu(); }
function st(game) { return game.sektorplan || (game.sektorplan = neu()); }
function bump(game) { if (game.explore) game.explore.sektorVersion++; }

// Hex gilt dem Captain als bekannt (erkundet oder gesichtet)
function bekannt(game, hex) { return !!(game.explore && game.explore.hexErkundet(hex)) || !!st(game).gesichtet[hex]; }
function gesichtet(game, hex) { return !!st(game).gesichtet[hex]; }

// Hex sichten (Sonde, Karte). Erkundet wird er dadurch NIE. -> true, wenn der Plan sich geändert hat
function sichten(game, hex, quelle) {
  if (!Sektoren.imRaster(hex) || !Sektoren.spielbar(hex)) return false;
  const s = st(game); const q = quelle === 'karte' ? 'karte' : 'sonde';
  const alt = s.gesichtet[hex];
  if (alt && alt.q === q) { alt.t = game.time; return false; }
  s.gesichtet[hex] = { q: alt ? alt.q : q, t: game.time };
  bump(game);
  game.emit('hexGesichtet', { hex, quelle: q });
  game.missionEvent('hexGesichtet', { hex, quelle: q });
  return true;
}

// Schiffe der festen Regiebuch-/Kartendaten eines Hexes als Momentaufnahme eintragen (ersetzt ältere desselben Hexes)
function schiffeAufnehmen(game, hex) {
  const d = Sektoren.hexDaten(hex); const s = st(game);
  s.schiffe = s.schiffe.filter((x) => x.h !== hex);
  for (const x of (d && Array.isArray(d.schiffe) ? d.schiffe : []).slice(0, 6)) s.schiffe.push({ h: hex, art: String(x.art || 'schiff'), x: Math.round(x.x || 0), y: Math.round(x.y || 0), t: game.time });
  if (s.schiffe.length > MAX_SCHIFFE) s.schiffe.splice(0, s.schiffe.length - MAX_SCHIFFE);
  bump(game);
}

function schiffeVon(game, hex) { return st(game).schiffe.filter((x) => x.h === hex); }

// Marke des Captains setzen. -> Fehlertext | null
function markeSetzen(game, hex, x, y, art) {
  const s = st(game);
  if (!bekannt(game, hex)) return 'Dieser Sektor ist dem Plan noch unbekannt.';
  const k = MARKEN_ARTEN.includes(art) ? art : 'marke';
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Ungültige Position.';
  const g = Plan.groesse(hex);
  if (g) { x = Math.max(0, Math.min(g.w, x)); y = Math.max(0, Math.min(g.h, y)); }
  if (s.marken.length >= MAX_MARKEN) return `Höchstens ${MAX_MARKEN} Marken – eine löschen.`;
  s.marken.push({ id: 'm' + (++s.seq), h: hex, x: Math.round(x), y: Math.round(y), k });
  bump(game);
  return null;
}
function markeEntfernen(game, id) {
  const s = st(game); const i = s.marken.findIndex((m) => m.id === id);
  if (i < 0) return 'Marke gibt es nicht.';
  s.marken.splice(i, 1); bump(game);
  return null;
}

// Snapshot: Teil von world.sektoren (nur bei Versionsänderung): g = gesichtete, nicht erkundete Hexe; p = { m: Marken, s: Schiffe } (nur wenn vorhanden)
function snapshotTeil(game) {
  const s = st(game); const o = {};
  const g = Object.keys(s.gesichtet).filter((h) => !(game.explore && game.explore.hexErkundet(h)));
  if (g.length) o.g = g;
  if (s.marken.length || s.schiffe.length) {
    o.p = { m: s.marken.map((m) => [m.id, m.h, m.x, m.y, m.k]), s: s.schiffe.map((x) => [x.h, x.art, x.x, x.y, r1(x.t)]) };
  }
  return o;
}

function toSave(game) {
  const s = st(game); const now = game.time;
  if (!Object.keys(s.gesichtet).length && !s.marken.length && !s.schiffe.length) return null;
  const gesichtetOut = {};
  for (const [h, v] of Object.entries(s.gesichtet)) gesichtetOut[h] = { q: v.q, alter: Math.max(0, Math.round(now - v.t)) };
  return { gesichtet: gesichtetOut, marken: s.marken.map((m) => Object.assign({}, m)),
    schiffe: s.schiffe.map((x) => ({ h: x.h, art: x.art, x: x.x, y: x.y, alter: Math.max(0, Math.round(now - x.t)) })), seq: s.seq };
}
function restore(game, b) {
  game.sektorplan = neu(); const s = game.sektorplan; const now = game.time;
  if (!b || typeof b !== 'object') return;
  for (const [h, v] of Object.entries(b.gesichtet || {})) if (Sektoren.imRaster(h) && v) s.gesichtet[h] = { q: v.q === 'karte' ? 'karte' : 'sonde', t: now - (Number(v.alter) || 0) };
  for (const m of Array.isArray(b.marken) ? b.marken : []) if (m && m.id && Sektoren.imRaster(m.h)) s.marken.push({ id: String(m.id), h: m.h, x: Number(m.x) || 0, y: Number(m.y) || 0, k: MARKEN_ARTEN.includes(m.k) ? m.k : 'marke' });
  for (const x of Array.isArray(b.schiffe) ? b.schiffe : []) if (x && Sektoren.imRaster(x.h)) s.schiffe.push({ h: x.h, art: String(x.art || 'schiff'), x: Number(x.x) || 0, y: Number(x.y) || 0, t: now - (Number(x.alter) || 0) });
  s.seq = Number(b.seq) || s.marken.length;
  bump(game);
}

module.exports = { MARKEN_ARTEN, reset, bekannt, gesichtet, sichten, schiffeAufnehmen, schiffeVon, markeSetzen, markeEntfernen, snapshotTeil, toSave, restore };
