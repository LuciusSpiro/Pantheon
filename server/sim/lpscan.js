'use strict';
// SL7b (CONCEPT-SL7 §7b): Landepunkt per Scan. Die Ops scannt einen Landepunkt (Station, Schiff, Planet) vom Orbit aus; erst dann liegt dessen Karte
// auf dem Planungstisch (Messe). Ohne Scan geht das Außenteam ohne Karte hinunter (erlaubt, riskant). Der Captain sieht die Außenmissionskarte weiter erst,
// wenn ein Außenteam gebeamt wurde (st.away.active, unverändert).
//
// Benannte Schnittstelle (andere Pakete, z. B. SL0 „Person vom Boden beamen“):
//   gescannt(game, lpId)        -> bool   der Landepunkt ist gescannt (auch Handkarten platform/wreck/kesh über explore.mapsKnown)
//   markieren(game, lpId)       -> bool   Scan als erledigt setzen (Skript, Labor, Tests); true = neu
//   ziele(game)                 -> [{ id, name }]   scannbare Landepunkte dieses Orts in Scanreichweite (Beam-Punkt), noch nicht gescannt
//   starten(game, p) / abbrechen(game)  Halteprozess der Ops (cmd weapons.landescan)
//   update(game, dt), snapshot(game)    Tick und Snapshot (lpscan: { n, p? }, nur wenn etwas zu scannen ist oder der Scan läuft)
// Reichweite: Abstand der Lerche zum Beam-Punkt des Landepunkts <= CONFIG.landepunkte.scanReichweite (Standard 900), Haltezeit scanZeit (Standard 4 s).
const Landepunkte = require('./landepunkte.js');
const Station = require('./station.js');

const reichweite = (game) => Number(game.C.landepunkte && game.C.landepunkte.scanReichweite) || 900;
const zeit = (game) => Number(game.C.landepunkte && game.C.landepunkte.scanZeit) || 4;
const r2 = (v) => Math.round(v * 100) / 100;

function gescannt(game, lpId) {
  const ex = game.explore; if (!ex) return false;
  if (lpId in ex.mapsKnown) return !!ex.mapsKnown[lpId];
  return ex.lpScan.has(lpId);
}

function markieren(game, lpId) {
  const ex = game.explore; if (!ex || !lpId) return false;
  if (gescannt(game, lpId)) return false;
  if (lpId in ex.mapsKnown) ex.mapsKnown[lpId] = true; else ex.lpScan.add(lpId);
  ex.version++;
  game.missionEvent('landepunktGescannt', { lp: lpId });
  return true;
}

// scannbare Landepunkte in Reichweite: Landepunkte.liste liefert beam + inReichweite (Transferreichweite); hier die größere Scanreichweite
function ziele(game) {
  const sh = game.ship; const out = [];
  if (!sh || sh.docked) return out;
  for (const l of Landepunkte.liste(game)) {
    if (!l.beam || gescannt(game, l.id)) continue;
    if (Math.hypot(sh.x - l.beam.x, sh.y - l.beam.y) <= reichweite(game)) out.push({ id: l.id, name: l.name });
  }
  return out;
}

const opsBesetzt = (game) => game.players.some((p) => p.connected && Station.stationOf(p) === 'weapons' && !p.downed);

// Ops startet den Scan (Halten). Rückgabe: Fehlertext | null
function starten(game, p) {
  if (game.lpscan) return 'Landepunkt-Scan läuft bereits.';
  if (game.ship.docked) return 'Angedockt – erst ablegen, der Scan braucht freie Sicht auf den Landepunkt.';
  const z = ziele(game);
  if (!z.length) return Landepunkte.liste(game).some((l) => l.beam && !gescannt(game, l.id)) ? `Kein Landepunkt in Scanreichweite (${reichweite(game)}).` : 'Hier gibt es nichts (Neues) zu scannen.';
  game.lpscan = { t: 0, dur: zeit(game) };
  game.emit('lpScan', { phase: 'start', dur: game.lpscan.dur, n: z.length });
  return null;
}
function abbrechen(game, grund) {
  if (!game.lpscan) return false;
  game.lpscan = null;
  game.emit('lpScan', { phase: 'abbruch', grund: grund || 'abgebrochen' });
  return true;
}

function update(game, dt) {
  const s = game.lpscan; if (!s) return;
  if (!opsBesetzt(game)) return void abbrechen(game, 'ops');
  const z = ziele(game);
  if (!z.length) return void abbrechen(game, 'reichweite');
  s.t += dt;
  if (s.t < s.dur) return;
  game.lpscan = null;
  const neu = z.filter((l) => markieren(game, l.id));
  game.emit('lpScan', { phase: 'fertig', n: neu.length });
  if (neu.length) {
    game.oda(`Landepunkt gescannt: ${neu.map((l) => l.name).join(', ')} – die Karte liegt auf dem Planungstisch.`, null);
    if (typeof game.syncPlanMaps === 'function') game.syncPlanMaps();
  }
}

function snapshot(game) {
  const s = game.lpscan;
  const n = game.ship && !game.ship.docked && game.explore ? ziele(game).length : 0;
  if (!s && !n) return null;
  const out = { n };
  if (s) out.p = r2(Math.min(1, s.t / s.dur));
  return out;
}

module.exports = { gescannt, markieren, ziele, starten, abbrechen, update, snapshot };
