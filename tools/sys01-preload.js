'use strict';
// SYS-01 Erkundung (Frage 1): Messfühler für sim-headless (Preload, KEIN Spielcode, ändert nichts am Spielablauf).
//   node -r ./tools/sys01-preload.js tools/sim-headless.js arena --wellen-def "raider;raider" --waves 2 --players 1 --seeds 1 --seed 1 --wave-limit 400
// Schreibt je Gegner eine Zeile "SYS01 {json}" auf stdout (beim Beenden):
//   kind, t0 (Spawn, Spielzeit), tDmg (erster Schaden am Gegner, s nach Spawn), tKill (Tod, s nach Spawn; null = nicht zerstört/Zeitlimit),
//   tHitL (erster Treffer auf die Lerche), tSh0 (s NACH dem ersten Treffer, bis ein Lerche-Schildsegment, das beim ersten Treffer > 0 war, 0 erreicht), tSys (s nach dem ersten Treffer bis zum ersten Systemschaden),
//   crew (verbundene Spieler), integL (Integritätsverlust der Lerche im Fenster Spawn..Tod).
const { Game } = require('../server/game.js');
// SYS-01 B1: Hüllenzähler gibt es nicht mehr. Lerche = Summe der Systemintegrität (aktive Systeme, interior.integOf).
const INT = require('../server/sim/interior.js');
const integ = (g) => INT.SYSTEM_ORDER.reduce((a, k) => a + (g.ship.systems[k] !== undefined && INT.systemAktiv(g, k) ? INT.integOf(g, k) : 0), 0);
const rows = [];
const track = new Map();   // id -> record
const orig = Game.prototype.step;
Game.prototype.step = function (...a) {
  const r = orig.apply(this, a);
  try {
    const g = this; const t = g.time; const sp = g.space; const ship = g.ship;
    if (sp && sp.enemies && ship) {
      const live = new Set();
      for (const e of sp.enemies) {
        if (e.kind === 'relay') continue;
        live.add(e.id);
        let rec = track.get(e.id);
        if (!rec) {
          rec = { kind: e.kind, t0: t, tDmg: null, tKill: null, tHitL: null, tSh0: null, tSys: null, hull0: integ(g), sh0: (ship.shields.current || []).map((v) => v > 0.05),
            sys0: Object.assign({}, ship.systems), crew: g.players.filter((p) => p.connected).length, hpMax: e.hpMax, shMax: (e.shieldsMax || []).join('/'), g };
          track.set(e.id, rec);
        }
        rec.last = e; rec.hullEnd = integ(g);
        if (rec.tDmg == null && (e.hp < e.hpMax - 1e-6 || (e.shields || []).some((v, i) => v < (e.shieldsMax || [])[i] - 1e-6))) rec.tDmg = t - rec.t0;
        if (rec.tHitL != null && rec.shHit == null) rec.shHit = (ship.shields.current || []).map((v) => v > 0.05);   // Schild-Stand beim ersten Treffer (Bot-Umverteilung vorher zählt nicht)
        if (rec.shHit && rec.tSh0 == null && (ship.shields.current || []).some((v, i) => rec.shHit[i] && v < 0.05)) rec.tSh0 = t - rec.t0 - rec.tHitL;   // s NACH dem ersten Treffer
        if (rec.tHitL != null && rec.tSys == null && Object.keys(ship.systems).some((k) => rec.sys0[k] === 'ok' && ship.systems[k] !== 'ok')) rec.tSys = t - rec.t0 - rec.tHitL;   // s nach dem ersten Treffer
      }
      for (const [id, rec] of track) {
        if (!live.has(id) && rec.tKill == null && !rec.gone) {
          rec.gone = true;
          if (rec.last && rec.last.hp <= 1e-6) rec.tKill = t - rec.t0;   // hp 0 = zerstört, sonst Zeitlimit/Entfernen
          rec.tEnd = t - rec.t0;
        }
      }
    }
  } catch (e) { /* Messfühler darf nie stören */ }
  return r;
};
const origEmit = Game.prototype.emit;
Game.prototype.emit = function (kind, data) {
  try {
    if (kind === 'hit' && !(data && data.evaded)) {
      for (const rec of track.values()) if (!rec.gone && rec.g === this && rec.tHitL == null) rec.tHitL = this.time - rec.t0;
    }
  } catch (e) { /* ignorieren */ }
  return origEmit.apply(this, arguments);
};
process.on('exit', () => {
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  for (const rec of track.values()) {
    console.log('SYS01 ' + JSON.stringify({ kind: rec.kind, crew: rec.crew, hpMax: rec.hpMax, sh: rec.shMax, t0: r1(rec.t0), tDmg: r1(rec.tDmg), tKill: r1(rec.tKill), tEnd: r1(rec.tEnd),
      gefecht: rec.tKill != null && rec.tDmg != null ? r1(rec.tKill - rec.tDmg) : null, tHitL: r1(rec.tHitL), tSh0: r1(rec.tSh0), tSys: r1(rec.tSys), integL: r1(rec.hull0 - (rec.hullEnd != null ? rec.hullEnd : rec.hull0)) }));
  }
});
