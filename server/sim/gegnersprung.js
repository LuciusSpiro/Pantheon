'use strict';
// SYS-01 C2b „Gegner flieht per Notfallsprung“ (Konzept „Systemmodell Zonen“, Kai 2026-10-26: Szenenelement, keine Grundregel).
// Laufzeit des Szenenbausteins gegner_notfallsprung (server/mission/bausteine/gegnersprung.js). Ohne Baustein flieht kein Gegner.
//   regel(game, { ziel, ausloeser, prozent?, verzoegerung_s? })  – legt eine Regel an (game.space.sprungRegeln). ziel = Tag oder Klasse des Gegners.
//   schritt(game, e, dt)  – je Tick vor dem Gegner-Takt. true = der Gegner handelt diesen Tick nicht (er lädt den Sprung, hält Stellung und feuert nicht,
//                           oder er ist eben entkommen). false = normal weiter.
// Auslöser: reaktor_zerstoert (Reaktor des Gegners zerstört), integritaet_unter (Gesamtintegrität in % unter prozent), sofort (ab dem ersten Tick).
// Konkurrenz mit dem Reaktor-Countdown (gegnertod.js): läuft ein Countdown mit Rest r, startet der Sprung nur bei verzoegerung_s < r. Dann entkommt der Gegner
// (der Countdown ruht während der Ladung und endet nie); sonst läuft der Countdown ab und der Gegner stirbt.
// Entkommen: der Gegner verlässt das Feld (game.space.enemies), OHNE enemyDown: kein Abschuss, keine Beute, keine Explosion. Ereignis enemyEscaped.
// Zahlen: content/kampf/gegnersprung-werte.json. Zufall: keiner.
const Gsys = require('./gegnersystem.js');
const W = require('../../content/kampf/gegnersprung-werte.json').werte;

function regel(game, r) {
  const sp = game.space;
  if (!sp.sprungRegeln) sp.sprungRegeln = [];
  const R = {
    ziel: String(r.ziel),
    ausloeser: r.ausloeser,
    prozent: r.prozent != null ? Number(r.prozent) : W.prozent_standard.wert,
    verzoegerung_s: r.verzoegerung_s != null ? Number(r.verzoegerung_s) : W.verzoegerung_s.wert,
  };
  sp.sprungRegeln.push(R);
  return R;
}

const trifft = (R, e) => e.tag === R.ziel || e.kind === R.ziel;
function ausgeloest(R, e) {
  if (R.ausloeser === 'sofort') return true;
  if (R.ausloeser === 'reaktor_zerstoert') return Gsys.reaktorZerstoert(e);
  if (R.ausloeser === 'integritaet_unter') return Gsys.integPct(e) < R.prozent;
  return false;
}

function entkommen(game, e) {
  const sp = game.space;
  e.notsprung = null;
  sp.enemies = sp.enemies.filter((o) => o !== e);
  if (game.ship.target === e.id) { game.ship.target = null; delete game.ship.zielsystem; }
  game.emit('sfx', { name: 'jump' });
  game.missionEvent('enemyEscaped', { enemy: e });
}

// Ein Tick für einen Gegner. true = er handelt nicht (lädt oder ist entkommen).
function schritt(game, e, dt) {
  if (e.notsprung) {
    e.notsprung.rest -= dt;
    if (e.notsprung.rest <= 0) entkommen(game, e);
    return true;
  }
  const regeln = game.space.sprungRegeln;
  if (!regeln || !regeln.length) return false;
  const R = regeln.find((r) => trifft(r, e) && ausgeloest(r, e));
  if (!R) return false;
  if (e.rt && e.rt.rest != null && R.verzoegerung_s >= e.rt.rest) return false;   // Konkurrenz: der Countdown ist schneller, der Gegner stirbt
  e.notsprung = { rest: R.verzoegerung_s };
  if (e.tele) { e.tele = null; game.emit('teleMiss', { id: e.id }); }
  game.emit('sfx', { name: 'tele_charge', enemy: e.kind, dur: R.verzoegerung_s, key: e.id });
  return true;
}

module.exports = { regel, schritt, AUSLOESER: W.ausloeser.wert };
