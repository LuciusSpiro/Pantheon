'use strict';
// SL1 Welt (Action-Layer): welche Sektorkarte die Partie spielt, wo sie beginnt, wie die Gruppe am Boden startet.
//   waehle(game, id)        aktive Karte setzen (content/welt/<id>.json), beim Spielstart bzw. Laden; meldet sie den Clients
//   kartenId(game)          Id der aktiven Karte ('limes' | 'sund')
//   startOrt(game)          Ort, an dem die Partie beginnt (Karte: start.ort, sonst 'hafen')
//   bekanntBeiStart(game)   Orte, die am Start bekannt sind
//   bodenStart(game)        true, wenn die Gruppe auf dem Planeten beginnt (Karte: start.boden)
//   bodenStarten(game)      Gruppe auf den Boden des Startorts setzen, Lerche im Orbit (SL1, Kai 2026-10-14)
// Ein Prozess spielt eine Partie; die Karte ist je Prozess fix und wechselt nur beim Spielstart (CONTRACT-SL §1).
// Quelle der Wahrheit der aktiven Karte bleibt shared/sektoren.js (KARTE); dieses Modul schaltet sie nur um.
const fs = require('fs');
const path = require('path');
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');

const DIR = path.join(__dirname, '..', '..', 'content', 'welt');
const STANDARD = 'limes';
const ID = /^[a-z][a-z0-9_]*$/;
const cache = {};

function datei(id) { return path.join(DIR, id + '.json'); }
// Karte lesen (gecacht); null bei unbekannter oder kaputter Karte
function karte(id) {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (cache[id] !== undefined) return cache[id];
  let doc = null;
  try {
    doc = JSON.parse(fs.readFileSync(datei(id), 'utf8'));
    if (!doc || doc.format !== 'sektorkarte/1' || doc.id !== id || !doc.hexe) doc = null;
  } catch (e) { doc = null; }
  cache[id] = doc;
  return doc;
}
function ids() {
  try { return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).filter((id) => !!karte(id)).sort(); } catch (e) { return []; }
}
function kartenId() { return Sektoren.kartenId(); }

// Aktive Karte setzen. Gleiche Karte: nichts tun. Unbekannte Id: Standard (Limes). -> Id der aktiven Karte
function waehle(game, id) {
  const wunsch = karte(id) ? id : STANDARD;
  const doc = karte(wunsch);
  if (doc && Sektoren.kartenId() !== wunsch) {
    Sektoren.setzeKarte(doc);
    if (game && typeof game.broadcast === 'function') {
      const k = Sektoren.fuerClient();
      if (k) { try { game.broadcast({ t: 'sektorkarte', sektorkarte: k }); } catch (e) { if (game.countError) game.countError('welt-broadcast', e); } }
    }
  }
  if (game) game.weltId = Sektoren.kartenId();
  return Sektoren.kartenId();
}

// Karte, mit der ein gespeicherter Weltstand gespielt wurde (Fakt welt_karte in welt.fakten; ältere Stände: Limes)
function kartenIdAusStand(data) {
  const f = data && data.welt && data.welt.fakten ? data.welt.fakten.welt_karte : null;
  const v = f && typeof f === 'object' ? f.value : f;
  return typeof v === 'string' && karte(v) ? v : STANDARD;
}

// Orte aus Daten (gen: true) ALLER Karten als Orts-Objekte { id, kind, scene, hex, … }. Prüfer (Regiebücher, Ketten) brauchen das, weil der
// Buchkatalog einmal je Prozess unter der gerade aktiven Karte geladen wird, die Bücher aber zu Limes und zu Sund gehören.
// Die aktive Karte liefert Locations.get (gleiche Objekte wie zur Laufzeit), die anderen werden aus ihren Karteneinträgen erzeugt.
function alleDatenOrte() {
  const out = []; const seen = new Set();
  for (const id of Sektoren.datenOrte()) { const l = Locations.get(id); if (l && !seen.has(id)) { seen.add(id); out.push(l); } }
  let GEN = null;
  try { GEN = require('../../shared/gen-sektor.js'); } catch (e) { GEN = null; }
  if (!GEN) return out;
  for (const kid of ids()) {
    if (kid === Sektoren.kartenId()) continue;
    const K = karte(kid);
    for (const [hex, h] of Object.entries(K.hexe || {})) {
      if (!h || !h.gen || !h.ort || seen.has(h.ort)) continue;
      seen.add(h.ort);
      try { out.push(GEN.erzeuge(hex, h)); } catch (e) { /* Eintrag unvollständig: nicht als Ort zählen */ }
    }
  }
  return out;
}

function startOrt() { return Sektoren.startOrt(); }
function bekanntBeiStart() { return Sektoren.bekanntBeiStart(); }
function bodenStart() { return Sektoren.bodenStart(); }
// Heimathafen für Regeln wie „keine Gefangennahme am Heimathafen“: auf Sund der Startort
function heimathafen() { return Sektoren.startOrt(); }

// Landepunkt am Startort, auf den die Gruppe beamt: erster Eintrag aus content/welt/landepunkte.json für den Ort
function startLandepunkt(game) {
  const L = require('./landepunkte.js');
  const ort = startOrt();
  const liste = L.liste ? L.liste(game, ort) : [];
  const e = liste.find((x) => x.id === ort + '.siedlung') || liste.find((x) => x.art !== 'hand') || liste[0];
  return e ? e.id : null;
}

// Gruppe startet auf dem Planeten (Boden des Startorts), die Lerche steht im Orbit (nicht angedockt). Muss nach reset() und
// Weltstand-Anlage laufen, vor dem ersten Kapitel. Kein Rückfall auf „angedockt“ (Kai 2026-10-14): scheitert der Bau der Karte,
// wird das als Fehler gezählt und die Gruppe bleibt an Bord im Orbit (Beamen mit Pads bleibt möglich). -> Landepunkt-Id | null
function bodenStarten(game) {
  const space = require('./space.js');
  const away = require('./away.js');
  const interior = require('./interior.js');
  const L = require('./landepunkte.js');
  const ort = startOrt();
  const lp = startLandepunkt(game);
  space.enterScene(game, ort, { docked: false });
  const ship = game.ship;
  const d = lp ? (L.defs().byId[lp] || null) : null;
  const sp = d && d.beam ? d.beam : (() => { const loc = Locations.get(ort); const st = loc && loc.scene && loc.scene.station; return st ? { x: st.x, y: st.y, range: 360 } : null; })();
  if (sp) { ship.x = Math.round(sp.x); ship.y = Math.round(sp.y); }
  ship.angle = 0; ship.vx = 0; ship.vy = 0; ship.speed = 0;
  ship.docked = false; ship.dockedAt = null;
  if (!lp) { game.countError('welt-boden', new Error('Kein Landepunkt am Startort ' + ort)); return null; }
  try { L.get(game, lp); } catch (e) { game.countError('welt-boden', e); return null; }
  game.transferZiel = { lp, scene: ship.scene };
  game.setAwayMap(lp);
  const team = game.players.filter((p) => p.connected);
  for (const p of team) { if (p.console) interior.leaveConsole(game, p); if (p.downed) interior.revivePlayer(game, p); }
  if (team.length) away.executeBeam(game, team.map((p) => p.id), 'down');
  return lp;
}

module.exports = { STANDARD, karte, ids, kartenId, kartenIdAusStand, alleDatenOrte, waehle, startOrt, bekanntBeiStart, bodenStart, heimathafen, startLandepunkt, bodenStarten };
