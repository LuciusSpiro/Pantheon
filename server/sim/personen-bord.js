'use strict';
// SL0 (CONCEPT-SL0, CONTRACT-SL): Personen als Fracht. Eine Person (NSC wie Evert) an Bord belegt einen Frachtplatz, liegt auf einem
// Frachtbett (Maps.CARGO_BEDS), die Ops beamt sie hoch und wieder ab (Halteprozess wie Waren, auch vom Boden eines Landepunkts).
// Baut auf server/sim/fracht.js auf (Lager, Halteprozess, Weltstand), ohne dessen Funktionen mit Flags zu erweitern: eigene, benannte Funktionen.
//
//   personAnBord(game, id)            Abfrage: Person ist im Frachtraum
//   personenAnBord(game)              alle Personen im Frachtraum [{ id, name, bett }]
//   aufnehmbare(game)                 Personen am Boden des gewählten Landepunkts, die die Ops jetzt hochbeamen kann
//   aufnehmenStart(game, p, id?)      Ops: Halteprozess „Person an Bord beamen“ (weapons.person)
//   abgebenStart(game, p, id?)        Ops: Halteprozess „Person abgeben“ (weapons.person_ab): an Abnehmer/Station oder zum Landepunkt
//   personAnBordLegen(game, id, name) Skript/Debug: Person sofort an Bord (Frachtraum voll -> false)
//   personAbgeben(game, id)           Skript: Person sofort abgeben (ohne Ort/Halteprozess)
//   bordNpcs(game)                    Snapshot ship.npcs: liegende Figuren auf den Betten
//   snapshotZusatz(game)              Snapshot fracht.pers / fracht.pq
// Landepunkt-Scan: Die Regel „Beamen von der Oberfläche braucht Landepunkt-Scan der Ops“ liefert SL7b (landepunkte.gescannt). Bis dahin
// ist `landepunktGescannt` ein Stub (true), sobald landepunkte.gescannt existiert, gilt dessen Antwort.
const W = require('../world.js');
const Fracht = require('./fracht.js');
const Locations = require('../../shared/locations.js');
const { dist } = require('../util.js');

const ART = 'person';
let awayMod = null; const away = () => awayMod || (awayMod = require('./away.js'));
let lpMod; const lp = () => { if (lpMod === undefined) { try { lpMod = require('./landepunkte.js'); } catch (e) { lpMod = null; } } return lpMod; };
const cfg = (game) => game.C.fracht;
const r1 = (v) => Math.round(v * 10) / 10;
const beds = () => (W.Maps && W.Maps.CARGO_BEDS) || [];

// ---------- Abfragen ----------
function personenAnBord(game) { return Fracht.state(game).lager.filter((l) => l.art === ART).map((l) => ({ id: l.person, name: l.name || l.person, bett: l.bett })); }
function personAnBord(game, id) { return Fracht.state(game).lager.some((l) => l.art === ART && (id == null || l.person === String(id))); }
function bettFrei(game) {
  const belegt = new Set(Fracht.state(game).lager.filter((l) => l.art === ART).map((l) => l.bett));
  const n = beds().length;
  for (let i = 0; i < n; i++) if (!belegt.has(i)) return i;
  return -1;
}
const transferDown = (game) => { const t = game.ship.systems.transfer; return t === 'broken' || t === 'offline'; };
const haltDauer = (game) => (game.ship.systems.transfer === 'damaged' ? game.C.ship.beamTimeDamaged : game.C.ship.beamTime);

// Landepunkt-Scan (SL7b, server/sim/lpscan.js): Beamen von der Oberfläche braucht den gescannten Landepunkt (auch Handkarten platform/wreck/kesh)
function lpGescannt(game, id) {
  if (!id) return false;
  try { return !!require('./lpscan.js').gescannt(game, id); } catch (e) { if (game.countError) game.countError('personen-scan', e); return false; }
}
function landepunktGescannt(game) {
  return lpGescannt(game, (game.transferZiel && game.transferZiel.lp) || (game.away && game.away.map) || null);
}

// Aktiver Landepunkt: der an der Transfer-Konsole gewählte, sonst ein gescannter in Transferreichweite (die Ops braucht dafür keine Wahl der Transfer-Konsole),
// sonst die Handkarte des Orts (away.beamSpot). -> { id, spot, aw } | null
function lpAktiv(game) {
  const L = lp();
  const z = game.transferZiel && game.transferZiel.lp;
  let id = null; let spot = null;
  if (z) { spot = away().beamSpot(game); id = spot ? spot.map : null; }
  if (!id && L && typeof L.liste === 'function') {
    const c = L.liste(game).find((l) => l.beam && l.frei && l.inReichweite && lpGescannt(game, l.id));
    if (c) { id = c.id; spot = { x: c.beam.x, y: c.beam.y, range: c.beam.range, map: c.id }; }
  }
  if (!id) { spot = away().beamSpot(game); id = spot ? spot.map : null; }
  if (!id || !spot) return null;
  let aw = game.aways && game.aways[id];
  if (!aw && L && typeof L.get === 'function') { try { aw = L.get(game, id); } catch (e) { aw = null; } }
  return aw ? { id, spot, aw } : null;
}

// Transferpunkt des aktiven Landepunkts in Reichweite? -> { ok, reason?, spot?, id?, aw? }
function bodenKontakt(game) {
  const a = lpAktiv(game);
  if (!a) return { ok: false, reason: 'Hier gibt es keinen Landepunkt, von dem man Personen hochbeamen kann.' };
  const far = dist(game.ship.x, game.ship.y, a.spot.x, a.spot.y);
  if (far > a.spot.range) return { ok: false, reason: `Zu weit vom Landepunkt (${Math.round(far)}, max. ${a.spot.range}).`, spot: a.spot };
  if (!lpGescannt(game, a.id)) return { ok: false, reason: 'Landepunkt noch nicht gescannt – erst die Ops-Scan (Landepunkt), dann beamen.', spot: a.spot };
  return { ok: true, spot: a.spot, id: a.id, aw: a.aw };
}
// Personen am Boden, die die Ops hochbeamen kann (Kennung nötig; Ivo ohne Kennung gehört nicht dazu)
function aufnehmbare(game) {
  const k = bodenKontakt(game);
  if (!k.ok) return [];
  return away().offenePersonen(k.aw).filter((n) => n.person && !n.injured).map((n) => ({ id: n.person, name: n.name || n.person }));
}
// Verletzte nicht: erst Medipack (eigene Regel der Karte), sonst wäre Beamen ein Umweg um die Rettung
function aufnehmenGrund(game, id) {
  if (transferDown(game)) return game.ship.systems.transfer === 'offline' ? 'Transfer offline (EMP) – kurz warten.' : 'Transfer zerstört – erst reparieren.';
  if (Fracht.state(game).halt) return 'Transfer läuft bereits.';
  if (Fracht.frei(game) <= 0) return `Frachtraum voll (${Fracht.anBord(game)}/${Fracht.capacity()}) – erst abgeben.`;
  if (bettFrei(game) < 0) return 'Kein freies Bett im Frachtraum.';
  const k = bodenKontakt(game); if (!k.ok) return k.reason;
  const offen = away().offenePersonen(k.aw).filter((n) => n.person);
  if (!offen.length) return 'Am Landepunkt wartet niemand.';
  const n = id != null ? offen.find((q) => q.person === String(id)) : offen.find((q) => !q.injured) || offen[0];
  if (!n) return 'Diese Person ist nicht am Landepunkt.';
  if (n.injured) return `${n.name || n.person} ist verletzt – erst ein Medipack (Außenteam), dann beamen.`;
  return null;
}

// ---------- Beamen (Halteprozess in fracht.js: halt.kind 'person_an' | 'person_ab') ----------
function aufnehmenStart(game, p, id) {
  const g = aufnehmenGrund(game, id); if (g) return g;
  const offen = away().offenePersonen(bodenKontakt(game).aw).filter((n) => n.person && !n.injured);
  const n = id != null ? offen.find((q) => q.person === String(id)) : offen[0];
  const s = Fracht.state(game);
  s.halt = { kind: 'person_an', id: n.person, t: 0, dur: haltDauer(game) };
  game.emit('frachtBeamen', { phase: 'start', was: 'person_an', id: n.person, dur: s.halt.dur });
  return null;
}
// Abgabeort: Abnehmer/Station (wie Waren) oder der gewählte Landepunkt (Person geht an die Oberfläche)
function abgabeOrt(game) {
  const o = Fracht.stationOrt(game);
  if (o.ok) return { ok: true, name: o.name, art: 'station' };
  const k = bodenKontakt(game);
  if (k.ok) return { ok: true, name: 'Landepunkt', art: 'boden' };
  return { ok: false, reason: o.reason };
}
function abgebenStart(game, p, id) {
  if (transferDown(game)) return game.ship.systems.transfer === 'offline' ? 'Transfer offline (EMP) – kurz warten.' : 'Transfer zerstört – erst reparieren.';
  const s = Fracht.state(game);
  if (s.halt) return 'Transfer läuft bereits.';
  const an = personenAnBord(game);
  if (!an.length) return 'Keine Person an Bord.';
  const pers = id != null ? an.find((q) => q.id === String(id)) : an[0];
  if (!pers) return 'Diese Person ist nicht an Bord.';
  const o = abgabeOrt(game); if (!o.ok) return o.reason;
  s.halt = { kind: 'person_ab', id: pers.id, t: 0, dur: haltDauer(game), name: o.name };
  game.emit('frachtBeamen', { phase: 'start', was: 'person_ab', id: pers.id, dur: s.halt.dur });
  return null;
}
// Aus fracht.update: darf der Halteprozess weiterlaufen?
function haltWeiter(game, h) {
  if (h.kind === 'person_an') return !aufnehmenGrundLaufend(game, h.id);
  return personAnBord(game, h.id) && abgabeOrt(game).ok;
}
function aufnehmenGrundLaufend(game, id) {
  // wie aufnehmenGrund, aber ohne „Transfer läuft bereits“ (der Halteprozess ist ja der eigene)
  if (Fracht.frei(game) <= 0 || bettFrei(game) < 0) return 'voll';
  if (!bodenKontakt(game).ok) return 'ort';
  const n = away().offenePersonen(bodenKontakt(game).aw).find((q) => q.person === String(id));
  return n && !n.injured ? null : 'weg';
}
// Aus fracht.beamFertig
function haltFertig(game, h) {
  if (h.kind === 'person_an') {
    if (aufnehmenGrundLaufend(game, h.id)) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'person_an', grund: 'ort' }); return; }
    const kb = bodenKontakt(game);
    const n = away().offenePersonen(kb.aw).find((q) => q.person === String(h.id));
    const map = kb.id;
    away().setzePersonZustand(n, 'rescued');   // von der Karte weg; Baustein person_rescued/Ereignis npcRescued wie bei der Rettung
    away().markRescued(game, map, n.person);
    game.missionEvent('npcRescued', { person: n.person, name: n.name, map });
    einlagern(game, n.person, n.name || n.person);
    game.emit('frachtBeamen', { phase: 'fertig', was: 'person_an', art: ART });
  } else {
    const o = abgabeOrt(game);
    if (!o.ok || !personAnBord(game, h.id)) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'person_ab', grund: 'ort' }); return; }
    const pers = auslagern(game, h.id, o.name);
    game.emit('frachtBeamen', { phase: 'fertig', was: 'person_ab', art: ART });
    if (pers && o.art === 'boden' && game.away) away().personAbsetzen && away().personAbsetzen(game, game.away, pers);
  }
}
function einlagern(game, id, name) {
  const s = Fracht.state(game);
  const bett = bettFrei(game);
  s.lager.push({ art: ART, person: String(id), name: String(name), bett: bett < 0 ? 0 : bett });
  game.oda(`${name} an Bord (Frachtraum, Bett ${(bett < 0 ? 0 : bett) + 1}) – ${Fracht.anBord(game)}/${Fracht.capacity()} Plätze belegt.`, null);
  game.missionEvent('personAnBord', { person: String(id), name: String(name), n: s.lager.length });
  if (game.markSaveDue) game.markSaveDue('personAnBord');
}
function auslagern(game, id, ortName) {
  const s = Fracht.state(game);
  const i = s.lager.findIndex((l) => l.art === ART && l.person === String(id));
  if (i < 0) return null;
  const l = s.lager.splice(i, 1)[0];
  game.oda(`${l.name} übergeben${ortName ? ' – ' + ortName : ''}.`, null);
  game.missionEvent('personAbgegeben', { person: l.person, name: l.name, ort: game.ship.scene, map: game.away ? game.away.map : null, name_ort: ortName || null });
  if (game.markSaveDue) game.markSaveDue('personAbgegeben');
  return l;
}

// ---------- Skript / Debug ----------
function personAnBordLegen(game, id, name) {
  if (!id || personAnBord(game, id)) return personAnBord(game, id);
  if (Fracht.frei(game) <= 0 || bettFrei(game) < 0) return false;
  einlagern(game, id, name || id);
  return true;
}
function personAbgeben(game, id) { return !!auslagern(game, id, null); }

// ---------- Snapshot / Weltstand ----------
// Figuren im Frachtraum: liegend auf dem Bett (ship.npcs, Darstellung wie Ivo, Pose „liegt“)
function bordNpcs(game) {
  const out = [];
  for (const l of Fracht.state(game).lager) {
    if (l.art !== ART) continue;
    const b = beds()[l.bett] || beds()[0]; if (!b) continue;
    const c = W.tileCenter(b.x, b.y);
    out.push({ id: l.person, name: l.name, x: r1(c.x), y: r1(c.y), dir: 'down', lie: 1 });
  }
  return out;
}
// fracht.pers: [{ id, n, b }] (n = Name, b = Bett), fracht.pq: [{ id, n }] Personen, die die Ops jetzt hochbeamen kann
function snapshotZusatz(game) {
  const out = {};
  const an = personenAnBord(game);
  if (an.length) out.pers = an.map((p) => ({ id: p.id, n: p.name, b: p.bett }));
  const pq = aufnehmbare(game);
  if (pq.length) out.pq = pq.map((p) => ({ id: p.id, n: p.name }));
  return out;
}
const toSaveEntry = (l) => ({ p: l.person, n: l.name, b: l.bett });
const restoreEntry = (o) => ({ art: ART, person: String(o.p), name: String(o.n || o.p), bett: Number.isInteger(o.b) ? o.b : 0 });

module.exports = {
  ART, personAnBord, personenAnBord, aufnehmbare, aufnehmenGrund, aufnehmenStart, abgebenStart, abgabeOrt, haltWeiter, haltFertig,
  personAnBordLegen, personAbgeben, bordNpcs, snapshotZusatz, toSaveEntry, restoreEntry, bettFrei, landepunktGescannt,
};
