'use strict';
// BOD-02 P10: Aufrichten als Trupp-Aufgabe mit Sicherung. Reine Prüfregeln (keine Rollenwechsel; die setzt squad.js decideB2/actB2).
// Gleiche Regeln für alle Fraktionen. Konfig: CONFIG.awayCombat.aufrichtenSicherung (per tune änderbar).
//
// Regel: Ein Helfer geht nur zu einem liegenden Kameraden, wenn
//   (a) der Liegende für keinen BEKANNTEN Spieler sichtbar ist (Sichtlinie + Spieler-Reichweite inkl. Stellungs-/Posten-/Lanzensicht,
//       kein Sichtschutz Los.coverAgainst) – bekannt = der Trupp sieht ihn, geteilte Sicht oder lastKnown; ruhige Trupps ohne
//       Wissen prüfen gegen alle Spieler am Boden – ODER
//   (b) ein Kamerad den Spieler gerade niederhält (Sturmgewehr-Niederhalter bzw. Aufgabe niederhalten, Schuss/Stoß in den letzten
//       sicherungSek s, Ziel = der Sichtende bzw. die letzte bekannte Position).
// Höchstens ein Helfer je Liegendem (d.helfer). Unter Feuer (Treffer, knapp vorbei = niedergehalten) oder bei entfallender
// Sicherung bricht der Helfer sofort ab (Deckung, Rolle pin). Das Trupp-Gehirn (trupp.js) vergibt die Aufgabe `aufrichten`.
const Los = require('../../shared/los.js');
const Physics = require('../../shared/physics.js');
const { dist } = require('../util.js');

const TILE = Physics.TILE;
const cfg = (game) => game.C.awayCombat;
const STANDARD = { sichtPruefen: true, sicherungSek: 3, abbruchTreffer: true, sichtPuffer: 1, sperreSek: 8, reichweite: 10 };
const A = (game) => Object.assign({}, STANDARD, cfg(game).aufrichtenSicherung || {});
let wfMod = null; const waffen = () => wfMod || (wfMod = require('./waffen.js'));
let combatMod = null; const combat = () => combatMod || (combatMod = require('./combat.js'));
const Trupp = () => require('./trupp.js');
const KEYS = ['aufrichten', 'aufgerichtet', 'abgebrochen', 'aufrichtenTod', 'aufrichtenTodBlind', 'todGesichert'];

function stats(game) {
  const aw = game.away;
  const st = aw.truppStats || (aw.truppStats = { umgangen: 0 });
  for (const k of KEYS) if (st[k] == null) st[k] = 0;
  return st;
}
function stat(game, key) { const st = stats(game); st[key]++; }

// Reichweite (Kacheln), aus der ein Spieler mit seiner Waffe auf einen Liegenden schießen kann: Waffenreichweite, begrenzt durch die Sicht
// (10 / Stellung 16 / Posten 22); Lanze: volle Waffenreichweite (Zielkegel). + sichtPuffer.
function spielerReichweite(game, p) {
  const Wf = waffen(); const d = Wf.def(game, p.waffe) || {};
  const sicht = Wf.sichtKacheln(game, p);
  const w = Number(d.max != null ? d.max : d.reichweite) || sicht;
  return (d.zielfenster ? w : Math.min(w, sicht)) + (Number(A(game).sichtPuffer) || 0);
}

function lebendeSpieler(game) { return game.players.filter((p) => p.zone === 'away' && p.connected && !p.downed); }

// Spieler, die der Trupp kennt: gesehen/geteilt (aktuelle Position), sonst lastKnown (letzte Position). Ohne jedes Wissen (ruhiger Trupp,
// nichts gesehen): alle Spieler am Boden (wer ruhig ist, sieht nur, ob ihn jemand sehen kann).
function bekannteSpieler(game, s, ms) {
  const alle = lebendeSpieler(game);
  if (!s || !s.alert) return alle.map((p) => ({ p, x: p.x, y: p.y }));
  const out = [];
  for (const p of alle) {
    const gesehen = ms.some((e) => (e.sees || []).includes(p)) || (s.geteilt && s.geteilt[p.id] > game.time);
    if (gesehen) out.push({ p, x: p.x, y: p.y });
    else if (s.lastKnown && s.lastKnown[p.id]) out.push({ p, x: s.lastKnown[p.id].x, y: s.lastKnown[p.id].y });
  }
  return out;
}

// Alle (bekannten) Spieler, für die der Liegende sichtbar ist: in Reichweite, Sichtlinie, ohne Sichtschutz.
function sichtbarFuer(game, E, d, bekannt) {
  const out = [];
  for (const k of bekannt) {
    if (dist(k.x, k.y, d.x, d.y) > spielerReichweite(game, k.p) * TILE) continue;
    if (!Los.lineOfSight(E.blocked, k.x, k.y, d.x, d.y)) continue;
    if (Los.coverAgainst(E.map, E.solid, k.x, k.y, d.x, d.y, true) > 0) continue;   // Sichtschutz (Deckung gegen diesen Spieler)
    out.push(k);
  }
  return out;
}

// Sichert ein Kamerad (ausser `ausser`) gegen alle Sichtenden? Niederhalter = Rolle niederhalter oder Aufgabe niederhalten, Schuss/Stoß in den
// letzten sicherungSek s; sein Ziel (shootTarget) ist ein Sichtender, bzw. er hält auf die letzte bekannte Position (unterdrueck).
function niederhalter(game, ms, ausser, sichtende) {
  const Tr = Trupp(); const sek = Number(A(game).sicherungSek) || 0;
  const ids = new Set(sichtende.map((k) => String(k.p.id)));
  return ms.some((m) => {
    if (m === ausser || !m.alive || m.role === 'aufrichten' || !Tr.niederhaelt(m)) return false;
    const feuert = m.stoss > 0 || game.time - (m.schussAt == null ? -99 : m.schussAt) <= sek;
    if (!feuert) return false;
    return m.shootTarget != null ? ids.has(String(m.shootTarget)) : !!m.unterdrueck;
  });
}

// Darf für den Liegenden d geholfen werden (ohne den Helfer `ausser`)? { erlaubt, grund: 'frei'|'unsichtbar'|'sicherung'|'sichtbar'|'aus', sicher }
// sicher = Sicherung nach Wissen des Trupps; wahr = wirkliche Lage (alle Spieler am Boden), nur für die Messung.
function pruefe(game, E, d, s, ausser) {
  const ms = Trupp().mitglieder(game, s);
  const C = A(game);
  const bek = bekannteSpieler(game, s, ms);
  const sicht = sichtbarFuer(game, E, d, bek);
  let grund = 'unsichtbar';
  if (sicht.length) grund = niederhalter(game, ms, ausser, sicht) ? 'sicherung' : 'sichtbar';
  const wahrSicht = sichtbarFuer(game, E, d, lebendeSpieler(game).map((p) => ({ p, x: p.x, y: p.y })));
  const wahr = !wahrSicht.length || niederhalter(game, ms, ausser, wahrSicht);
  return { erlaubt: !C.sichtPruefen || grund !== 'sichtbar', grund, sicher: grund !== 'sichtbar', wahr };   // sichtPruefen aus: alles erlaubt, die Messwerte bleiben ehrlich
}

// Wird der Helfer beschossen (Treffer seit Beginn, knapp vorbei = niedergehalten)?
function unterFeuer(game, e) {
  const C = A(game);
  if (!C.abbruchTreffer) return false;
  if (waffen().niedergehalten(game, e)) return true;
  return e.aufrichtenStart != null && (e.lastHitAt || -99) >= e.aufrichtenStart;
}

// Aktiver Helfer des Liegenden (lebt, hat ihn im Auge, hat die Aufgabe/Rolle aufrichten)
function aktiverHelfer(game, d) {
  if (!d.helfer) return null;
  const h = game.away.drones.find((q) => q.id === d.helfer);
  return h && h.alive && h.hilft === d.id && (h.role === 'aufrichten' || h.aufgabe === 'aufrichten') ? h : null;
}

function liegende(game) {
  return game.away.drones.filter((q) => !q.alive && q.liegt && q.zustand === 'verwundet');
}

// Kann e als Helfer in Frage kommen (unabhängig vom Liegenden)?
function geeignet(game, e) {
  const Wf = waffen();
  if (!e.alive || e.asleep || e.frozen || e.kind === 'warden' || e.rolle === 'enterer' || e.rolle === 'waechter') return false;
  if (e.role === 'aufrichten' || e.aufgabe === 'aufrichten' || e.role === 'fesseln' || e.role === 'retreat') return false;
  if (!Wf.handlungsfaehig(game, e) || Wf.niedergehalten(game, e)) return false;
  if (game.time < (e.aufrSperre || 0)) return false;
  if (game.time - (e.lastHitAt || -99) < 3) return false;   // selbst gerade getroffen
  if ((e.sees || []).some((p) => !p.downed && dist(p.x, p.y, e.x, e.y) < 5 * TILE)) return false;   // Spieler sehr nah
  return true;
}

// Bester Helfer für d unter `kand` (nächster; Niederhalter/Flanke/Scharfschütze nur, wenn es keine Alternative gibt) oder null.
function waehleHelfer(game, E, s, d, kand) {
  if (aktiverHelfer(game, d) || game.time < (d.aufrSperre || 0)) return null;
  const reich = (Number(A(game).reichweite) || 10) * TILE;
  const Tr = Trupp();
  const stuetzen = (m) => Tr.niederhaelt(m) || m.aufgabe === 'flanke' || m.aufgabe === 'scharf' || m.rolle === 'schuetze' ? 1 : 0;
  const liste = kand.filter((m) => geeignet(game, m) && dist(m.x, m.y, d.x, d.y) <= reich)
    .sort((a, b) => (stuetzen(a) - stuetzen(b)) || (dist(a.x, a.y, d.x, d.y) - dist(b.x, b.y, d.x, d.y)));
  for (const m of liste) { const r = pruefe(game, E, d, s, m); if (r.erlaubt) return { m, r }; }
  return null;
}

// Messung: Helfer fällt (aufgerufen aus combat.knockOut vor squad.onEnemyDown). aufrSicher/aufrWahr stammen aus dem letzten Entscheidungstakt:
// aufrichtenTod = Sicherung fehlte nach Wissen des Trupps; aufrichtenTodBlind = Trupp glaubte sich gesichert, wirklich sichtbar (unbekannter Schütze);
// todGesichert = gesichert gefallen.
function heldFaellt(game, e) {
  if (e.role !== 'aufrichten' || !e.hilft) return;
  stat(game, e.aufrSicher === false ? 'aufrichtenTod' : (e.aufrWahr === false ? 'aufrichtenTodBlind' : 'todGesichert'));
}

module.exports = { STANDARD, cfg: A, stats, stat, spielerReichweite, bekannteSpieler, sichtbarFuer, pruefe, unterFeuer, aktiverHelfer, liegende, geeignet,
  waehleHelfer, heldFaellt };
