'use strict';
// EK3 Teil A (CONTRACT-EK3): Fracht (Ladung) im Raum, Beamen an Bord und Abliefern von der Taktik, Frachtraum der Lerche.
//
//   fracht_abwerfen(game, x, y, art)   Schnittstelle für die Konvoi-Szene (Teil B): ein zerstörter Transporter lässt Fracht fallen.
//   weapons.fracht { id? } / { off }   Taktik: Halteprozess starten (nächste Fracht in Reichweite) bzw. abbrechen
//   weapons.abliefern                  Taktik: Fracht beim Abnehmer abgeben (derselbe Halteprozess, Beamen nach draußen)
//
// Regeln (Briefing EK3, Planung E6):
//  - Der Frachtraum hat Maps.CARGO_CAPACITY (2) Buchten. Eine dritte Ladung wird abgelehnt.
//  - Beamen: Haltezeit ship.beamTime (3 s; bei beschädigtem Transfer ship.beamTimeDamaged), Reichweite fracht.beamRange (320, wie scene.beam.range
//    der Außenkarten). Ein Systemtreffer (interior.damageSystem) bricht ab, ein Schildtreffer nicht. Auch Transfer ausgefallen, Fracht
//    außer Reichweite oder niemand mehr an der Taktik bricht ab. Der Halteprozess belegt nicht ship.beaming (Schilde bleiben oben).
//  - Eine Ladung im Raum bleibt, wo sie ist, bis die Lerche die Szene (das System) verlässt. Dann ist sie weg.
//  - Abliefern: beim Abnehmer (game.fracht.abnehmer.ort, vom Regiebuch gesetzt), sonst bei jeder Station (scene.station.kind in
//    fracht.stationKinds) im Umkreis fracht.stationRange.
//  - Mitgeführte Ladung steht im Weltstand (schiff.fracht = ['sprengstoff', …]); Ladungen im Raum nicht.
//  - Schnittstelle gesichert/ungesichert für AP9 „Lager ohne Strom“: gesichert(game) / setGesichert(game, bool). Das Lager ist kein
//    Schiffssystem; heute hat die Flagge keine Wirkung, sie steht nur im Snapshot (fracht.g = false) bereit.
const W = require('../world.js');
const Locations = require('../../shared/locations.js');
const { dist } = require('../util.js');

const cfg = (game) => game.C.fracht;
const capacity = () => (W.Maps && W.Maps.CARGO_CAPACITY) || 2;
const r1 = (v) => Math.round(v * 10) / 10;

function neu() {
  return { lager: [], draussen: [], halt: null, gesichert: true, abnehmer: null, abgeliefert: {}, szene: null, seq: 0 };
}
function state(game) { return game.fracht || (game.fracht = neu()); }

const artOk = (game, art) => cfg(game).arten.includes(art);
const artName = (art) => (art === 'sprengstoff' ? 'Sprengstoff' : art === 'fracht' ? 'Fracht' : String(art));

// ---------- Abfragen ----------
function anBord(game, art) { const s = state(game); return art ? s.lager.filter((l) => l.art === art).length : s.lager.length; }
function frei(game) { return capacity() - state(game).lager.length; }
function gesichert(game) { return state(game).gesichert !== false; }
function setGesichert(game, on) { state(game).gesichert = !!on; }
function lagerArten(game) { return state(game).lager.map((l) => l.art); }
function draussen(game) { const s = state(game); return s.draussen.filter((d) => d.szene === game.ship.scene); }
function abgeliefert(game, art) { const a = state(game).abgeliefert; return art ? (a[art] || 0) : Object.values(a).reduce((x, y) => x + y, 0); }

const isDown = (st) => st === 'broken' || st === 'offline';   // wie interior.isDown (kein require: interior ruft systemTreffer auf)
const transferDown = (game) => isDown(game.ship.systems.transfer);
const haltDauer = (game) => (game.ship.systems.transfer === 'damaged' ? game.C.ship.beamTimeDamaged : game.C.ship.beamTime);
const taktikBesetzt = (game) => game.players.some((p) => p.connected && p.console === 'weapons' && !p.downed);

// ---------- Fracht im Raum ----------
// Schnittstelle (Konvoi-Szene, Teil B): Fracht an Weltposition (x, y) der aktuellen Szene ablegen. Gibt das Objekt oder null zurück.
function fracht_abwerfen(game, x, y, art) {
  const s = state(game);
  const a = art == null ? cfg(game).artDefault : String(art);
  if (!artOk(game, a) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pod = { id: 'fr' + (++s.seq), x: r1(x), y: r1(y), art: a, szene: game.ship.scene };
  s.draussen.push(pod);
  // Höchstens maxDraussen je Szene (Netzbudget): die älteste fällt weg
  const hier = s.draussen.filter((d) => d.szene === pod.szene);
  if (hier.length > cfg(game).maxDraussen) s.draussen.splice(s.draussen.indexOf(hier[0]), 1);
  game.emit('frachtAbgeworfen', { id: pod.id, x: pod.x, y: pod.y, art: a });
  game.missionEvent('frachtAbgeworfen', { id: pod.id, art: a, x: pod.x, y: pod.y });
  return pod;
}

// ---------- Beamen (Halteprozess) ----------
function beamGrund(game) {
  if (transferDown(game)) return game.ship.systems.transfer === 'offline' ? 'Transfer offline (EMP) – kurz warten.' : 'Transfer zerstört – erst reparieren.';
  return null;
}
function naechste(game) {
  const sh = game.ship; const R = cfg(game).beamRange;
  let best = null; let bd = Infinity;
  for (const d of draussen(game)) { const k = dist(sh.x, sh.y, d.x, d.y); if (k <= R && k < bd) { best = d; bd = k; } }
  return best;
}
// Taktik: Halteprozess „an Bord beamen“ starten. id: bestimmte Fracht, sonst die nächste in Reichweite. Rückgabe: Fehlertext | null.
function beamStart(game, p, id) {
  const s = state(game);
  if (s.halt) return 'Transfer läuft bereits.';
  const g = beamGrund(game); if (g) return g;
  if (frei(game) <= 0) return `Frachtraum voll (${anBord(game)}/${capacity()}) – erst abliefern.`;
  const draus = draussen(game);
  if (!draus.length) return 'Keine Fracht in diesem Gebiet.';
  const pod = id != null ? draus.find((d) => d.id === String(id)) : naechste(game);
  if (!pod) return id != null ? 'Diese Fracht gibt es nicht mehr.' : `Keine Fracht in Reichweite (max. ${cfg(game).beamRange}).`;
  const far = dist(game.ship.x, game.ship.y, pod.x, pod.y);
  if (far > cfg(game).beamRange) return `Fracht zu weit (${Math.round(far)}, max. ${cfg(game).beamRange}).`;
  s.halt = { kind: 'an', id: pod.id, t: 0, dur: haltDauer(game) };
  game.emit('frachtBeamen', { phase: 'start', was: 'an', id: pod.id, dur: s.halt.dur });
  return null;
}
// Abliefern: Ort prüfen. Rückgabe { ok, reason?, name? }
function ablieferOrt(game) {
  const s = state(game); const sh = game.ship;
  if (!s.lager.length) return { ok: false, reason: 'Keine Fracht an Bord.' };
  const loc = Locations.get(sh.scene);
  const st = loc && loc.scene && loc.scene.station;
  if (s.abnehmer && s.abnehmer.ort && s.abnehmer.ort !== sh.scene) return { ok: false, reason: `Abnehmer ist ${s.abnehmer.name || s.abnehmer.ort} – nicht hier.` };
  if (!st || !(s.abnehmer && s.abnehmer.ort ? true : cfg(game).stationKinds.includes(st.kind))) return { ok: false, reason: 'Hier ist keine Station, die Fracht annimmt.' };
  const far = dist(sh.x, sh.y, st.x, st.y);
  if (far > cfg(game).stationRange) return { ok: false, reason: `Zu weit von der Station (${Math.round(far)}, max. ${cfg(game).stationRange}).` };
  return { ok: true, name: (s.abnehmer && s.abnehmer.name) || (loc && loc.name) || sh.scene };
}
function abliefernStart(game, p) {
  const s = state(game);
  if (s.halt) return 'Transfer läuft bereits.';
  const g = beamGrund(game); if (g) return g;
  const o = ablieferOrt(game); if (!o.ok) return o.reason;
  s.halt = { kind: 'ab', id: null, t: 0, dur: haltDauer(game), name: o.name };
  game.emit('frachtBeamen', { phase: 'start', was: 'ab', dur: s.halt.dur });
  return null;
}
function beamStop(game, grund, text) {
  const s = state(game);
  if (!s.halt) return false;
  const h = s.halt; s.halt = null;
  game.emit('frachtBeamen', { phase: 'abbruch', was: h.kind, grund });
  if (text) game.oda(text, null);
  return true;
}
// Systemtreffer: Aufruf aus interior.damageSystem (Schildtreffer erreichen diese Funktion nie)
function systemTreffer(game, sys) {
  const s = game.fracht;
  if (s && s.halt) beamStop(game, 'systemtreffer', 'Transfer unterbrochen – Systemtreffer! Fracht-Beamen muss neu starten.');
}
function beamFertig(game) {
  const s = state(game); const h = s.halt; s.halt = null;
  if (h.kind === 'an') {
    const i = s.draussen.findIndex((d) => d.id === h.id);
    if (i < 0) return;
    if (frei(game) <= 0) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'an', grund: 'voll' }); return; }
    const pod = s.draussen.splice(i, 1)[0];
    s.lager.push({ art: pod.art });
    game.emit('frachtBeamen', { phase: 'fertig', was: 'an', art: pod.art });
    game.oda(`${artName(pod.art)} an Bord (${s.lager.length}/${capacity()}).`, null);
    game.missionEvent('frachtAnBord', { art: pod.art, n: s.lager.length, id: pod.id });
  } else {
    const o = ablieferOrt(game);
    if (!o.ok) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'ab', grund: 'ort' }); return; }
    const weg = s.lager.splice(0, s.lager.length);
    for (const l of weg) s.abgeliefert[l.art] = (s.abgeliefert[l.art] || 0) + 1;
    game.emit('frachtBeamen', { phase: 'fertig', was: 'ab', n: weg.length });
    game.oda(`Fracht übergeben: ${weg.map((l) => artName(l.art)).join(', ')} – ${o.name}.`, null);
    game.missionEvent('frachtAbgeliefert', { n: weg.length, arten: weg.map((l) => l.art), ort: game.ship.scene, name: o.name });
  }
}

// ---------- Tick ----------
function update(game, dt) {
  const s = state(game);
  const sc = game.ship.scene;
  // Systemwechsel: Fracht im Raum ist weg (Szene verlassen). Ladung an Bord bleibt.
  if (s.szene !== sc) {
    s.szene = sc;
    if (s.halt) beamStop(game, 'szene');
    s.draussen = [];
  }
  const h = s.halt;
  if (!h) return;
  if (transferDown(game)) return void beamStop(game, 'transfer', 'Transfer ausgefallen – Beamen abgebrochen.');
  if (!taktikBesetzt(game)) return void beamStop(game, 'taktik');
  if (h.kind === 'an') {
    const pod = s.draussen.find((d) => d.id === h.id);
    if (!pod) return void beamStop(game, 'weg');
    if (dist(game.ship.x, game.ship.y, pod.x, pod.y) > cfg(game).beamRange) return void beamStop(game, 'reichweite', 'Fracht außer Reichweite – Beamen abgebrochen.');
  } else if (!ablieferOrt(game).ok) return void beamStop(game, 'ort');
  h.t += dt;
  if (h.t >= h.dur) beamFertig(game);
}

// ---------- Snapshot / Weltstand ----------
// Kompakt (Budget): fehlt = Standard. lager ['art'], draussen [{ id, x, y, art }] (nur diese Szene), halt { kind, id?, p 0..1 },
// ab 1 = jetzt abgebbar, abn = Name des Abnehmers (nur wenn gesetzt), g false = ungesichert.
function snapshot(game) {
  const s = game.fracht;
  if (!s) return null;
  const draus = s.draussen.filter((d) => d.szene === game.ship.scene);
  const out = {};
  if (s.lager.length) { out.lager = s.lager.map((l) => l.art); if (ablieferOrt(game).ok) out.ab = 1; }
  if (draus.length) out.draussen = draus.map((d) => ({ id: d.id, x: d.x, y: d.y, art: d.art }));
  if (s.halt) { out.halt = { kind: s.halt.kind, p: Math.round(Math.min(1, s.halt.t / s.halt.dur) * 100) / 100 }; if (s.halt.id) out.halt.id = s.halt.id; }
  if (s.abnehmer && s.abnehmer.name) out.abn = s.abnehmer.name;
  if (s.gesichert === false) out.g = false;
  return Object.keys(out).length ? out : null;
}
function toSave(game) { return state(game).lager.map((l) => l.art); }
function restore(game, arten) {
  const s = state(game);
  s.lager = (Array.isArray(arten) ? arten : []).filter((a) => typeof a === 'string' && artOk(game, a)).slice(0, capacity()).map((art) => ({ art }));
  s.halt = null;
}

// ---------- Regiebuch ----------
// fracht_abnehmer: ort = Orts-ID des Auftraggebers (null = jede Station), name = Anzeigename
function setAbnehmer(game, ort, name) { state(game).abnehmer = ort ? { ort: String(ort), name: name != null ? String(name) : null } : null; }
// fracht_abliefern aus dem Skript: Ladung (art, n) sofort übernehmen, ohne Ort/Halteprozess. Gibt die Anzahl zurück.
function skriptAbliefern(game, art, n) {
  const s = state(game); let k = 0; const lim = n == null ? Infinity : n;
  for (let i = s.lager.length - 1; i >= 0 && k < lim; i--) {
    if (art && s.lager[i].art !== art) continue;
    const l = s.lager.splice(i, 1)[0]; s.abgeliefert[l.art] = (s.abgeliefert[l.art] || 0) + 1; k++;
  }
  if (k) game.missionEvent('frachtAbgeliefert', { n: k, arten: art ? [art] : [], ort: game.ship.scene, name: null, skript: true });
  return k;
}
// Ladung direkt an Bord legen (Debug, Tests, Skript); false = Frachtraum voll bzw. unbekannte Art
function anBordLegen(game, art) {
  const s = state(game); const a = art == null ? cfg(game).artDefault : String(art);
  if (!artOk(game, a) || frei(game) <= 0) return false;
  s.lager.push({ art: a });
  game.missionEvent('frachtAnBord', { art: a, n: s.lager.length });
  return true;
}

// ---------- Debug: fracht <abwerfen [art] [dx dy] | an [art] | leer | gesichert an|aus | abnehmer [ort] | status> ----------
function debug(game, args) {
  const s = state(game); const sh = game.ship;
  const sub = args[0] || 'status';
  if (sub === 'abwerfen') {
    const art = args[1] && Number.isNaN(Number(args[1])) ? args[1] : null;
    const nums = args.slice(1).filter((a) => !Number.isNaN(Number(a))).map(Number);
    const dx = nums.length >= 2 ? nums[0] : 160, dy = nums.length >= 2 ? nums[1] : 0;
    if (game.ship.docked) return 'Nicht angedockt (Fracht liegt im freien Raum).';
    return fracht_abwerfen(game, sh.x + dx, sh.y + dy, art) ? null : 'Unbekannte Art (sprengstoff | fracht).';
  }
  if (sub === 'an') return anBordLegen(game, args[1]) ? null : 'Frachtraum voll oder unbekannte Art.';
  if (sub === 'leer') { s.lager = []; s.draussen = []; s.halt = null; return null; }
  if (sub === 'gesichert') { setGesichert(game, args[1] !== 'aus'); return null; }
  if (sub === 'abnehmer') { setAbnehmer(game, args[1] || null, args[2] || null); return null; }
  game.log(`Fracht: Lager ${JSON.stringify(lagerArten(game))}, draußen ${draussen(game).length}, Halt ${s.halt ? JSON.stringify(s.halt) : '-'}, gesichert ${gesichert(game)}, Abnehmer ${s.abnehmer ? s.abnehmer.ort : '-'}`);
  return null;
}

module.exports = {
  neu, state, update, snapshot, toSave, restore, debug,
  fracht_abwerfen, abwerfen: fracht_abwerfen,
  beamStart, abliefernStart, beamStop, systemTreffer, ablieferOrt,
  anBord, frei, capacity, gesichert, setGesichert, lagerArten, draussen, abgeliefert,
  setAbnehmer, skriptAbliefern, anBordLegen,
};
