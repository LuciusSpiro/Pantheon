'use strict';
// EK3 Teil A (CONTRACT-EK3): Fracht (Ladung) im Raum, Beamen an Bord und Abliefern von der Ops, Frachtraum der Lerche.
//
//   fracht_abwerfen(game, x, y, art)   Schnittstelle für die Konvoi-Szene (Teil B): ein zerstörter Transporter lässt Fracht fallen.
//   weapons.fracht { id? } / { off }   Ops: Halteprozess starten (nächste Fracht in Reichweite) bzw. abbrechen
//   weapons.abliefern                  Ops: Fracht beim Abnehmer abgeben (derselbe Halteprozess, Beamen nach draußen)
//
// Regeln (Briefing EK3, Planung E6):
//  - Der Frachtraum hat Maps.CARGO_CAPACITY (2) Buchten. Eine dritte Ladung wird abgelehnt.
//  - Beamen: Haltezeit ship.beamTime (3 s; bei beschädigtem Transfer ship.beamTimeDamaged), Reichweite fracht.beamRange (320, wie scene.beam.range
//    der Außenkarten). Ein Systemtreffer (interior.damageSystem) bricht ab, ein Schildtreffer nicht. Auch Transfer ausgefallen, Fracht
//    außer Reichweite oder niemand mehr an der Ops bricht ab. Der Halteprozess belegt nicht ship.beaming (Schilde bleiben oben).
//  - Eine Ladung im Raum bleibt, wo sie ist, bis die Lerche die Szene (das System) verlässt. Dann ist sie weg.
//  - Abliefern: beim Abnehmer (game.fracht.abnehmer.ort, vom Regiebuch gesetzt), sonst bei jeder Station (scene.station.kind in
//    fracht.stationKinds) im Umkreis fracht.stationRange.
//  - Mitgeführte Ladung steht im Weltstand (schiff.fracht = ['sprengstoff', …]); Ladungen im Raum nicht.
//  - Schnittstelle gesichert/ungesichert („Lager ohne Strom“, PAN-01 A): gesichert(game) / setGesichert(game, bool). Das Lager ist kein
//    Schiffssystem, aber das Modul Frachtraum (module.js): läuft es nicht (abgeschaltet oder ohne Strom), setzt module.update die Flagge auf false.
//    Wirkung: huellenTreffer(game) – bei jedem Hüllentreffer löst sich CONFIG.module.fracht.verlustJeTreffer Ladung (Ware; Personen: AP14 hängt sich
//    an gefaehrdet()), sie treibt hinter dem Schiff und kann neu gebeamt werden. Anzeige: Snapshot fracht.g = false (Taktik: UNGESICHERT).
const W = require('../world.js');
const Station = require('./station.js');   // R1 §4.4
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
const artName = (art) => (art === 'sprengstoff' ? 'Sprengstoff' : art === 'fracht' ? 'Fracht' : art === 'deuterium' ? 'Deuterium' : String(art));

// ---------- Abfragen ----------
function anBord(game, art) { const s = state(game); return art ? s.lager.filter((l) => l.art === art).length : s.lager.length; }
function frei(game) { return capacity() - state(game).lager.length; }
function gesichert(game) { return state(game).gesichert !== false; }
function setGesichert(game, on) { state(game).gesichert = !!on; }
// Was bei einem ungesicherten Lager gefährdet ist (Waren und Personen); AP14 (Personen als Fracht) wertet das später aus
function gefaehrdet(game) { return gesichert(game) ? [] : state(game).lager.slice(); }
function lagerArten(game) { return state(game).lager.map((l) => l.art); }
function draussen(game) { const s = state(game); return s.draussen.filter((d) => d.szene === game.ship.scene); }
function abgeliefert(game, art) { const a = state(game).abgeliefert; return art ? (a[art] || 0) : Object.values(a).reduce((x, y) => x + y, 0); }

const isDown = (st) => st === 'broken' || st === 'offline';   // wie interior.isDown (kein require: interior ruft systemTreffer auf)
const transferDown = (game) => isDown(game.ship.systems.transfer);
const haltDauer = (game) => (game.ship.systems.transfer === 'damaged' ? game.C.ship.beamTimeDamaged : game.C.ship.beamTime);
const taktikBesetzt = (game) => game.players.some((p) => p.connected && Station.stationOf(p) === 'weapons' && !p.downed);   // R1: aktive Station

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

// PAN-01 A: Ungesichert (Frachtraum-Modul aus) + Hüllentreffer: die älteste Ware löst sich und treibt hinter dem Schiff (neu beamen möglich). Rückgabe: Anzahl.
function huellenTreffer(game) {
  if (gesichert(game)) return 0;
  // Nur wer den Frachtraum bewusst abgeschaltet hat (Technik), trägt das Risiko. Fällt er nur durch Reaktorschaden aus (Notstrom), zeigt die Anzeige
  // UNGESICHERT, aber die Ladung bleibt: sonst ginge Kampagnen-Fracht (Konvoi, Eisenwald) durch einen Treffer auf den Reaktor verloren (Kette k2).
  const M = require('./module.js');
  if (M.installiert(game, 'frachtraum') && !M.liste(game).some((m) => m.id === 'frachtraum' && !m.an)) return 0;
  const s = state(game); const sh = game.ship;
  const lim = (game.C.module && game.C.module.fracht && game.C.module.fracht.verlustJeTreffer) || 1;
  let n = 0;
  while (n < lim) {
    const i = s.lager.findIndex((l) => l.art !== 'person');
    if (i < 0) break;
    const l = s.lager.splice(i, 1)[0];
    n++;
    game.emit('frachtVerloren', { art: l.art });
    if (!sh.docked) { const pod = fracht_abwerfen(game, sh.x - Math.cos(sh.angle) * cfg(game).abwurfAbstand, sh.y - Math.sin(sh.angle) * cfg(game).abwurfAbstand, l.art); if (pod) pod.eigene = true; }
    game.oda(`${artName(l.art)} hat sich gelöst – der Frachtraum ist ungesichert!`, null);
    game.missionEvent('frachtVerloren', { art: l.art, n: s.lager.length });
  }
  return n;
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
// Ops: Halteprozess „an Bord beamen“ starten. id: bestimmte Fracht, sonst die nächste in Reichweite. Rückgabe: Fehlertext | null.
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
  if (!state(game).lager.some((l) => l.art !== 'person')) return { ok: false, reason: 'Keine Fracht an Bord.' };   // SL0: Personen sind keine Ware (abgeben: personen-bord.js)
  return stationOrt(game);
}
// SL0: Abnehmer/Station in Reichweite, ohne Rücksicht darauf, was an Bord ist (auch für Personen)
function stationOrt(game) {
  const s = state(game); const sh = game.ship;
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
  } else if (h.kind === 'person_an' || h.kind === 'person_ab') {   // SL0: Person beamen (server/sim/personen-bord.js)
    require('./personen-bord.js').haltFertig(game, h);
  } else if (h.kind === 'verk') {   // SL6: Verkaufen an einen Händler (server/sim/ladung.js)
    require('./ladung.js').verkaufFertig(game);
  } else {
    const o = ablieferOrt(game);
    if (!o.ok) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'ab', grund: 'ort' }); return; }
    const weg = s.lager.filter((l) => l.art !== 'person');   // SL0: Personen bleiben an Bord (eigener Halteprozess)
    s.lager = s.lager.filter((l) => l.art === 'person');
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
    s.draussen = s.draussen.filter((d) => d.eigene);   // PAN-01 A: Ware, die sich im ungesicherten Frachtraum gelöst hat, bleibt für die Rückkehr im Sektor liegen
  }
  const h = s.halt;
  if (!h) return;
  if (transferDown(game)) return void beamStop(game, 'transfer', 'Transfer ausgefallen – Beamen abgebrochen.');
  if (h.kind === 'schoepf') {   // U2: Schöpfen läuft weiter, auch wenn die Ops verlassen wird (solo: Steuer halten); Ende nur per Ops-Aktion, Ring verlassen, voll, Transfer aus
    const r = require('./ladung.js').schoepfWeiter(game, dt);
    if (r) beamStop(game, r.stop, r.text);
    return;
  }
  if (!taktikBesetzt(game)) return void beamStop(game, 'taktik');
  if (h.kind === 'an') {
    const pod = s.draussen.find((d) => d.id === h.id);
    if (!pod) return void beamStop(game, 'weg');
    if (dist(game.ship.x, game.ship.y, pod.x, pod.y) > cfg(game).beamRange) return void beamStop(game, 'reichweite', 'Fracht außer Reichweite – Beamen abgebrochen.');
  } else if (h.kind === 'person_an' || h.kind === 'person_ab') { if (!require('./personen-bord.js').haltWeiter(game, h)) return void beamStop(game, 'ort', 'Person beamen abgebrochen.'); }   // SL0
  else if (h.kind === 'verk') { if (!require('./ladung.js').verkaufWeiter(game)) return void beamStop(game, 'ort'); }
  else if (!ablieferOrt(game).ok) return void beamStop(game, 'ort');
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
  const ware = s.lager.filter((l) => l.art !== 'person');   // SL0: lager = nur Ware (Buchten), Personen stehen in pers
  if (ware.length) { out.lager = ware.map((l) => l.art); if (ablieferOrt(game).ok) out.ab = 1; }
  Object.assign(out, require('./personen-bord.js').snapshotZusatz(game));   // SL0: pers, pq
  if (draus.length) out.draussen = draus.map((d) => ({ id: d.id, x: d.x, y: d.y, art: d.art }));
  if (s.halt) { out.halt = { kind: s.halt.kind, p: s.halt.kind === 'schoepf' ? require('./ladung.js').fuellStand(game) : Math.round(Math.min(1, s.halt.t / s.halt.dur) * 100) / 100 }; if (s.halt.id) out.halt.id = s.halt.id; }
  if (s.abnehmer && s.abnehmer.name) out.abn = s.abnehmer.name;
  if (s.gesichert === false) out.g = false;
  { const fu = require('./ladung.js').fuellStand(game); if (fu) out.fuell = fu; }   // SL6: Füllstand der nächsten Deuterium-Einheit
  { const vk = require('./ladung.js').verkaufOrt(game); if (vk.ok) out.vk = 1; }   // SL6: Händler in Reichweite (Verkaufen möglich)
  return Object.keys(out).length ? out : null;
}
function toSave(game) { const P = require('./personen-bord.js'); return state(game).lager.map((l) => (l.art === 'person' ? P.toSaveEntry(l) : l.art)); }   // SL0: Personen als { p, n, b }
function restore(game, arten) {
  const s = state(game);
  const P = require('./personen-bord.js');
  s.lager = (Array.isArray(arten) ? arten : []).filter((a) => (typeof a === 'string' && artOk(game, a)) || (a && typeof a === 'object' && a.p)).slice(0, capacity())
    .map((a) => (typeof a === 'string' ? { art: a } : P.restoreEntry(a)));   // SL0: Personen { p, n, b }
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
    if (!art && s.lager[i].art === 'person') continue;   // SL0: Personen nie per Warenabgabe
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
  if (sub === 'person') return require('./personen-bord.js').personAnBordLegen(game, args[1] || 'evert', args[2] || null) ? null : 'Frachtraum voll.';   // SL0: fracht person [id] [name]
  if (sub === 'an') return anBordLegen(game, args[1]) ? null : 'Frachtraum voll oder unbekannte Art.';
  if (sub === 'leer') { s.lager = []; s.draussen = []; s.halt = null; return null; }   // SL0: leert auch Personen
  if (sub === 'gesichert') { setGesichert(game, args[1] !== 'aus'); return null; }
  if (sub === 'abnehmer') { setAbnehmer(game, args[1] || null, args[2] || null); return null; }
  game.log(`Fracht: Lager ${JSON.stringify(lagerArten(game))}, draußen ${draussen(game).length}, Halt ${s.halt ? JSON.stringify(s.halt) : '-'}, gesichert ${gesichert(game)}, Abnehmer ${s.abnehmer ? s.abnehmer.ort : '-'}`);
  return null;
}

module.exports = {
  neu, state, update, snapshot, toSave, restore, debug,
  fracht_abwerfen, abwerfen: fracht_abwerfen,
  beamStart, abliefernStart, beamStop, systemTreffer, ablieferOrt, stationOrt,
  anBord, frei, capacity, gesichert, setGesichert, gefaehrdet, huellenTreffer, lagerArten, draussen, abgeliefert,
  setAbnehmer, skriptAbliefern, anBordLegen, artOk,
};
