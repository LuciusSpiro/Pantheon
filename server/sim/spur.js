'use strict';
// SL5 (CONCEPT-SL5): Ionenspur über mehrere Hexe. Action-Layer; Zustand game.spur, Weltstand welt.spur, Snapshot `sp`.
//   starten(game, id)           Spur aus content/spuren/<id>.json beginnen (Baustein spur_starten)
//   lesen(game, p, on)          Ops liest die Spur am Spurkern des Hexes (weapons.spur.lesen, Taste K): leseZeit s innerhalb leseRadius
//   update(game, dt)            Hexwechsel verfolgen, Lesefortschritt, Auflösen einer Teilung (Entschlüsseln)
//   snapshot(game) / toSave / restore / reset
// Datei { id, name?, weg: [Hex …], alter: [Sekunden je Hex], teilungen: [{ ab: Hex, aeste: [{ nach, echt, indiz }] }], ende: { kante } }
//   weg[i] ist der Hex, in dem die Spur gerade liegt; sie führt nach weg[i+1]. Im letzten Hex enthüllt das Lesen die verborgene Kante `ende.kante`
//   (sprung.kanteEnthuellen). Eine Teilung in `ab` hat zwei Äste; der echte führt nach weg[i+1], der falsche in eine Sackgasse (kein Hindernis,
//   nur „hier endet die Spur“ – zurück nach `ab`). Die Spur verblasst in der Kampagne nicht (Config spur.verblassen: false, hier nicht gebaut).
// Ablauf: Navigation fliegt in Leseradius des Spurkerns (Marke auf der Taktikkarte), Ops liest (Fortschritt), Ergebnis: Kante und Alter. Bei einer
// Teilung öffnet das Lesen ein Entschlüssel-Signal (SL5): Indizien je Ast ab Qualität 1/2, Qualität 3 sagt den echten Ast eindeutig; nur dann trägt sich
// die Spur-Marke (Hex-Ebene, server/sim/marken.js) für den echten Ast selbst ein. Sonst entscheidet der Captain nach den Indizien.
const fs = require('fs');
const path = require('path');
const Sektoren = require('../../shared/sektoren.js');
const Plan = require('../../shared/sektorplan.js');
const Marken = require('./marken.js');
const Station = require('./station.js');
const Entschl = require('./entschluesseln.js');
let sprungMod = null;
const Sprung = () => sprungMod || (sprungMod = require('./sprung.js'));

const DIR = path.join(__dirname, '..', '..', 'content', 'spuren');
const ID = /^[a-z][a-z0-9_]*$/;
const cache = {};
const cfg = (game) => game.C.spur;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const r1 = (v) => Math.round(v * 10) / 10;

function datei(id) {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (cache[id] !== undefined) return cache[id];
  let d = null;
  try { d = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8')); } catch (e) { d = null; }
  if (d && (d.id !== id || !Array.isArray(d.weg) || d.weg.length < 2 || !d.ende || !d.ende.kante)) d = null;
  cache[id] = d;
  return d;
}
// Spur aus einem Objekt registrieren (Tests, Regiebuch-Daten); überschreibt den Cache-Eintrag
function registriere(d) { if (d && ID.test(d.id)) cache[d.id] = d; }

function reset(game) { game.spur = null; }
function def(game) { return game.spur ? datei(game.spur.id) : null; }
function hexHier(game) { return Sektoren.hexVonOrt(game.ship.scene); }

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// Spurkern im Hex: deterministisch aus Spur-Id und Hex, in der Mitte der Szene (30–70 % der Breite/Höhe)
function kern(id, hex) {
  const g = Plan.groesse(hex); if (!g) return null;
  const h = hash(id + ':' + hex);
  return { x: Math.round(g.w * (0.3 + 0.4 * ((h & 0xffff) / 65535))), y: Math.round(g.h * (0.3 + 0.4 * (((h >>> 16) & 0xffff) / 65535))) };
}
function teilung(d, hex) { return (d.teilungen || []).find((t) => t.ab === hex) || null; }
function alterText(d, idx) { return Plan.alterText(Number((d.alter || [])[idx]) || 0); }

// -> Fehlertext | null
function starten(game, id) {
  const d = datei(id);
  if (!d) return `Spur '${id}' gibt es nicht (content/spuren).`;
  game.spur = { id, idx: 0, gelesen: false, fertig: false, falsch: false, lese: 0, wartet: null, hex: hexHier(game) };
  Marken.setze(game, { id: 'spur:' + id, typ: 'spur', hex: d.weg[0], sym: 'spur' });
  game.oda(`Spur aufgenommen${d.name ? ': ' + d.name : ''}. Sie beginnt in ${Sektoren.hexName(d.weg[0])}. Der Captain wählt den Sprungpunkt, die Ops liest die Ionenspur.`, null);
  game.missionEvent('spurGestartet', { id });
  return null;
}

// -> Fehlertext | null. on: Lesen beginnen (true) bzw. abbrechen (false)
function lesen(game, p, on) {
  const s = game.spur; const d = def(game);
  if (!s || !d || s.fertig) return 'Keine Spur zu lesen.';
  if (p && Station.stationOf(p) !== 'weapons') return 'Das macht die Ops.';
  if (on === false) { s.lese = 0; return null; }
  const hex = hexHier(game);
  if (s.wartet) return 'Erst das Signal zur Teilung entschlüsseln.';
  if (hex !== d.weg[s.idx]) {
    if (s.falsch) return 'Hier ist keine Spur mehr – das war der falsche Ast. Zurück nach ' + Sektoren.hexName(d.weg[s.idx]) + '.';
    return 'Hier ist keine Spur. Sie liegt in ' + Sektoren.hexName(d.weg[s.idx]) + '.';
  }
  if (s.gelesen) return 'Die Spur ist hier schon gelesen.';
  const k = kern(d.id, hex);
  if (!k || dist(game.ship.x, game.ship.y, k.x, k.y) > cfg(game).leseRadius) return 'Zu weit vom Spurkern – die Navigation soll die Markierung anfliegen.';
  if (!s.lese) s.lese = 0.001;
  return null;
}

function ergebnisLesen(game, s, d) {
  const hex = d.weg[s.idx];
  const letzter = s.idx >= d.weg.length - 1;
  s.lese = 0;
  if (letzter) {
    s.gelesen = true; s.fertig = true;
    Marken.entferne(game, 'spur:' + d.id);
    const err = Sprung().kanteEnthuellen(game, d.ende.kante);
    game.oda(`Spur gelesen (${alterText(d, s.idx)}): Sie endet an einer verborgenen Sprungboje. ${err ? '(' + err + ')' : 'Sie ist jetzt auf der Karte.'}`, null);
    game.emit('sfx', { name: 'scan_done' });
    game.missionEvent('spurGelesen', { id: d.id, hex, ende: true });
    game.missionEvent('spurEnde', { id: d.id, kante: d.ende.kante });
    return;
  }
  const nach = d.weg[s.idx + 1];
  const t = teilung(d, hex);
  game.emit('sfx', { name: 'scan_done' });
  if (!t) {
    s.gelesen = true;
    Marken.setze(game, { id: 'spur:' + d.id, typ: 'spur', hex: nach, sym: 'spur' });
    game.oda(`Spur gelesen (${alterText(d, s.idx)}): Die Ionenspur führt nach ${Sektoren.hexName(nach)}. Der Captain hat sie im Sektorplan eingetragen.`, null);
    game.missionEvent('spurGelesen', { id: d.id, hex, nach });
    return;
  }
  // Teilung: Entschlüssel-Signal mit Indizien je Ast (Qualität 3 = eindeutig)
  const [a0, a1] = t.aeste;
  const tid = `spur_${d.id}_${s.idx}`;
  const echt = t.aeste.find((x) => x.echt) || a0;
  const err = Entschl.starten(game, { id: tid, absender: 'Ionenspur', schichten: [
    { ab: 0, text: `Die Spur teilt sich nach ${Sektoren.hexName(a0.nach)} und ${Sektoren.hexName(a1.nach)} (${alterText(d, s.idx)}).` },
    { ab: 1, text: `Ast ${Sektoren.hexName(a0.nach)}: ${a0.indiz}` },
    { ab: 2, text: `Ast ${Sektoren.hexName(a1.nach)}: ${a1.indiz}` },
    { ab: 3, text: `Eindeutig: Der echte Ast führt nach ${Sektoren.hexName(echt.nach)}.` }] });
  if (err) { s.lese = 0; game.oda('Spur: ' + err + ' Erst das laufende Signal abstimmen, dann neu lesen.', null); return; }
  s.wartet = tid;
  game.oda('Die Spur teilt sich. Ops: Signal entschlüsseln (N), Indizien vergleichen.', null);
  game.missionEvent('spurGelesen', { id: d.id, hex, teilung: true });
}

function update(game, dt) {
  const s = game.spur; if (!s) return;
  const d = def(game); if (!d || s.fertig) return;
  const hex = hexHier(game);
  if (hex !== s.hex) {   // Hexwechsel verfolgen
    s.hex = hex; s.lese = 0;
    if (hex === d.weg[s.idx + 1] && s.idx + 1 < d.weg.length) {
      s.idx++; s.gelesen = false; s.falsch = false; s.wartet = null;
      Marken.setze(game, { id: 'spur:' + d.id, typ: 'spur', hex, sym: 'spur' });
      game.oda(`Die Ionenspur ist frisch: ${Sektoren.hexName(hex)}. Ops: Spur am Spurkern lesen (K).`, null);
    } else if (hex === d.weg[s.idx]) {
      s.falsch = false;
    } else {
      const t = teilung(d, d.weg[s.idx]);
      s.falsch = !!(t && t.aeste.some((a) => !a.echt && a.nach === hex));
      if (s.falsch) game.oda('Hier endet die Ionenspur: Das war der falsche Ast. Zurück nach ' + Sektoren.hexName(d.weg[s.idx]) + '.', null);
    }
  }
  // Teilung aufgelöst (Entschlüsseln fertig)
  if (s.wartet) {
    const q = Entschl.ergebnis(game, s.wartet);
    if (q != null) {
      const t = teilung(d, d.weg[s.idx]); const echt = t && t.aeste.find((a) => a.echt);
      s.wartet = null; s.gelesen = true;
      if (q >= 3 && echt) { Marken.setze(game, { id: 'spur:' + d.id, typ: 'spur', hex: echt.nach, sym: 'spur' }); game.oda('Signal eindeutig: Die Spur-Marke zeigt den echten Ast.', null); }
      else game.oda('Das Signal war nicht eindeutig. Der Captain wählt nach den Indizien.', null);
    }
  }
  // Lesefortschritt
  if (s.lese > 0) {
    const k = kern(d.id, d.weg[s.idx]);
    const ops = game.players.some((p) => p.connected && Station.stationOf(p) === 'weapons' && !p.downed);
    if (hex !== d.weg[s.idx] || !k || dist(game.ship.x, game.ship.y, k.x, k.y) > cfg(game).leseRadius || !ops) { s.lese = 0; return; }
    s.lese += dt;
    if (s.lese >= cfg(game).leseZeit) ergebnisLesen(game, s, d);
  }
}

// Snapshot `sp`: { x, y, r, p } im Spur-Hex (Spurkern und Lesefortschritt), solange die Spur dort liegt und nicht gelesen ist; sonst null
function snapshot(game) {
  const s = game.spur; const d = def(game);
  if (!s || !d || s.fertig || s.gelesen || hexHier(game) !== d.weg[s.idx]) return null;
  const k = kern(d.id, d.weg[s.idx]); if (!k) return null;
  return { x: k.x, y: k.y, r: cfg(game).leseRadius, p: s.lese ? Math.min(1, Math.round(s.lese / cfg(game).leseZeit * 100) / 100) : 0 };
}

function toSave(game) {
  const s = game.spur; if (!s) return null;
  return { id: s.id, idx: s.idx, gelesen: !!s.gelesen, fertig: !!s.fertig };
}
function restore(game, b) {
  game.spur = null;
  if (!b || typeof b !== 'object' || !datei(b.id)) return;
  const d = datei(b.id);
  const idx = Math.max(0, Math.min(d.weg.length - 1, Math.floor(Number(b.idx) || 0)));
  game.spur = { id: b.id, idx, gelesen: !!b.gelesen && !teilung(d, d.weg[idx]), fertig: !!b.fertig, falsch: false, lese: 0, wartet: null, hex: hexHier(game) };
  if (!game.spur.fertig) Marken.setze(game, { id: 'spur:' + d.id, typ: 'spur', hex: game.spur.gelesen && idx + 1 < d.weg.length ? d.weg[idx + 1] : d.weg[idx], sym: 'spur' });
}

function ergebnis(game, id) { const s = game.spur; return s && s.id === id ? { idx: s.idx, gelesen: s.gelesen, fertig: s.fertig } : null; }

module.exports = { datei, registriere, kern, reset, starten, lesen, update, snapshot, toSave, restore, ergebnis };
