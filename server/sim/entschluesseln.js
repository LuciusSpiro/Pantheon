'use strict';
// SL5 (CONCEPT-SL5): Signal entschlüsseln – Minispiel der Ops (Taktik-Konsole). Action-Layer; Zustand game.entschl, Anzeige im Snapshot `en`.
//
//   starten(game, aufgabe)     Signal liegt an (z 0 = „offen“); aufgabe: { id, absender?, schichten: [{ text, ab: 0..3 }] }
//   startenFunk(game, id, absender, schichten)   benannte Variante für verschlüsselte Funksprüche (Kapitel, Regiebuch)
//   startenNotruf(game, id, absender, indizien)  benannte Variante für Notrufe (SL8): Indiz i ist ab Qualität i + 1 lesbar (Text 0 = Behauptung)
//   anlauf(game, p)            Ops beginnt die Abstimmung (weapons.entschl.start)
//   stimme(game, p, dir)       Richtung −1 | 0 | 1 (weapons.entschl.stimme), gehalten; der Server bewegt die Frequenz
//   abbrechen(game, p)         Abstimmung beenden: Qualität aus dem bisherigen Verlauf
//   update(game, dt)           Drift des Zielbandes, Signalstärke, Fortschritt
//   ergebnis(game, id)         Qualität 0..3 | null (noch nicht entschlüsselt)
//   snapshot(game)             Feld `en` (kompakt) | null
//
// Regeln (Config `entschl`): Die Signalstärke s (0..1) hängt vom Abstand der Frequenz f zum wandernden Zielband z ab. Der Fortschritt wächst mit s
// (volle Stärke = `dauer` Sekunden). Qualität = dauer / Laufzeit (Anteil sauberer Zeit): ≥ 0,9 → 3, ≥ 0,65 → 2, ≥ 0,4 → 1, sonst 0. Je höher die
// Qualität, desto mehr Schichten (ab ≤ q) werden gesendet; eine versteckte zweite Schicht trägt ab: 3. Abbruch: Qualität aus dem Verlauf, höchstens
// floor(Fortschritt · 3). Gleiche Regel für jede Quelle (Funk, Notruf, Boje). Zwischenstand wird nicht gespeichert; Ergebnis steht als Fakt entschl_<id>.
const Station = require('./station.js');
const Locations = require('../../shared/locations.js');

const cfg = (game) => game.C.entschl;
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const Z = { OFFEN: 0, LAEUFT: 1, FERTIG: 2 };

function reset(game) { game.entschl = null; game.entschlErgebnis = {}; }
function ops(game) { return game.players.some((p) => p.connected && Station.stationOf(p) === 'weapons' && !p.downed); }
function qualitaetAus(game, r) {
  const t = cfg(game).qSchwellen;
  return r >= t[2] ? 3 : r >= t[1] ? 2 : r >= t[0] ? 1 : 0;
}

function neueAufgabe(game, aufgabe) {
  const a = aufgabe || {};
  const schichten = (Array.isArray(a.schichten) ? a.schichten : []).filter((s) => s && typeof s.text === 'string')
    .map((s) => ({ text: s.text, ab: clamp(Math.round(Number(s.ab) || 0), 0, 3) }));
  return { id: String(a.id || 'signal'), absender: String(a.absender || 'Unbekanntes Signal'), schichten, z: Z.OFFEN,
    f: 0.5, ziel: 0.5, zv: 0, zt: 0, dir: 0, halt: 0, t: 0, s: 0, q: null, bis: 0 };
}

// -> Fehlertext | null
function starten(game, aufgabe) {
  const e = game.entschl;
  if (e && e.z === Z.LAEUFT) return 'Eine Abstimmung läuft noch.';
  const n = neueAufgabe(game, aufgabe);
  if (!n.schichten.length) return 'Signal ohne Inhalt.';
  game.entschl = n;
  if (game.mission && typeof game.mission.radio === 'function') game.mission.radio('ODA', 'Verschlüsseltes Signal von ' + n.absender + '. Ops: V öffnet die Abstimmung.', false);
  game.emit('sfx', { name: 'ui_click' });
  game.missionEvent('signalEmpfangen', { id: n.id });
  return null;
}
function startenFunk(game, id, absender, schichten) { return starten(game, { id, absender, schichten }); }
function startenNotruf(game, id, absender, indizien) {
  const l = Array.isArray(indizien) ? indizien : [];
  return starten(game, { id, absender, schichten: l.map((text, i) => ({ text, ab: i === 0 ? 0 : Math.min(3, i) })) });
}

// Testsignal für Labor (Debug `entschl`) und Tests: vier Schichten, die letzte (ab 3) ist die versteckte
function testSignal(id) {
  return { id, absender: 'Testsignal', schichten: [
    { text: 'Rauschen. Irgendwo darin: ein Funkspruch von der Boje.', ab: 0 },
    { text: 'Absender erkennbar: Händlerkennung des Konkordats.', ab: 1 },
    { text: 'Der Spruch nennt eine Ladung und einen Treffpunkt.', ab: 2 },
    { text: 'Zweite Schicht: Unter dem Spruch liegt eine zweite Botschaft mit Koordinaten.', ab: 3 }] };
}

function anlauf(game, p) {
  const e = game.entschl; const C = cfg(game);
  if (!e || e.z === Z.FERTIG) return 'Kein Signal zu entschlüsseln.';
  if (e.z === Z.LAEUFT) return null;
  if (Station.stationOf(p) !== 'weapons') return 'Das macht die Ops.';
  e.z = Z.LAEUFT; e.t = 0; e.halt = 0; e.dir = 0;
  e.ziel = C.zielMin + game.rng() * (C.zielMax - C.zielMin);
  e.f = e.ziel < 0.5 ? C.startF + 0.2 : C.startF - 0.2;   // das Band liegt nie bei der Startstellung
  e.zv = 0; e.zt = 0;
  return null;
}
function stimme(game, p, dir) {
  const e = game.entschl;
  if (!e || e.z !== Z.LAEUFT) return null;
  e.dir = Number(dir) > 0 ? 1 : Number(dir) < 0 ? -1 : 0;
  return null;
}

function fertig(game, e, q) {
  e.z = Z.FERTIG; e.q = q; e.dir = 0; e.bis = game.time + cfg(game).anzeigeDauer;
  game.entschlErgebnis[e.id] = q;
  const ws = game.weltstand;
  if (ws && typeof ws.fact === 'function') ws.fact('entschl_' + e.id, q, 'Entschlüsseln');
  const sichtbar = e.schichten.filter((s) => s.ab <= q);
  game.emit('sfx', { name: 'scan_done' });
  if (game.mission && typeof game.mission.radio === 'function') {
    for (const s of sichtbar) game.mission.radio(e.absender, s.text, false);
    if (!sichtbar.length) game.mission.radio('ODA', 'Nur Rauschen. Das Signal war zu unsauber.', false);
  }
  game.missionEvent('entschluesselt', { id: e.id, qualitaet: q, schichten: sichtbar.length });
}
function abbrechen(game, p) {
  const e = game.entschl;
  if (!e || e.z !== Z.LAEUFT) return null;
  const C = cfg(game);
  const r = e.t > 0 ? (e.halt * C.dauer) / e.t : 0;
  fertig(game, e, Math.min(e.t < C.minLauf ? 0 : qualitaetAus(game, r), Math.floor(e.halt * 3)));
  return null;
}

function update(game, dt) {
  const e = game.entschl; if (!e) return;
  const C = cfg(game);
  if (e.z === Z.FERTIG) { if (game.time >= e.bis) game.entschl = null; return; }
  if (e.z !== Z.LAEUFT) return;
  if (!ops(game)) e.dir = 0;
  e.t += dt;
  e.f = clamp(e.f + e.dir * C.rate * dt, 0, 1);
  // Zielband wandert (Nebel/Zonen verstärken die Drift: gleiche Regel für alle)
  e.zt -= dt;
  if (e.zt <= 0) { e.zt = 2 + game.rng() * 2; e.zv = (game.rng() * 2 - 1) * C.driftV; }
  const loc = Locations.get(game.ship.scene);
  const fak = loc && loc.fog ? C.driftNebel : 1;
  e.ziel += e.zv * fak * dt;
  if (e.ziel < C.zielMin) { e.ziel = C.zielMin; e.zv = Math.abs(e.zv); }
  if (e.ziel > C.zielMax) { e.ziel = C.zielMax; e.zv = -Math.abs(e.zv); }
  e.s = clamp(1 - Math.abs(e.f - e.ziel) / C.weitBand, 0, 1);
  e.halt = Math.min(1, e.halt + (dt / C.dauer) * e.s);
  if (e.halt >= 1) fertig(game, e, qualitaetAus(game, C.dauer / e.t));
}

// Ergebnis der Partie, sonst der gespeicherte Fakt (nach dem Laden eines Weltstands)
function ergebnis(game, id) {
  const q = game.entschlErgebnis && game.entschlErgebnis[id];
  if (q != null) return q;
  const f = game.weltstand && game.weltstand.data && game.weltstand.data.fakten ? game.weltstand.data.fakten['entschl_' + id] : null;
  return typeof f === 'number' ? f : null;
}

// Snapshot `en`: { i, z, f, s, h, q } (≈ 60 B, nur wenn ein Signal anliegt). q = laufende Schätzung bzw. Ergebnis.
function snapshot(game) {
  const e = game.entschl; if (!e) return null;
  const C = cfg(game);
  const o = { i: e.id, z: e.z, n: e.schichten.length };
  if (e.z === Z.LAEUFT) {
    o.f = r2(e.f); o.s = r2(e.s); o.h = r2(e.halt);
    o.q = e.t >= C.minLauf ? qualitaetAus(game, (e.halt * C.dauer) / e.t) : 0;
  } else if (e.z === Z.FERTIG) o.q = e.q;
  return o;
}

module.exports = { Z, reset, testSignal, starten, startenFunk, startenNotruf, anlauf, stimme, abbrechen, update, ergebnis, snapshot };
