'use strict';
// Schnellsprung (Spieltest 2026-10-12): mehrere Sektoren in einem Zug. Der Captain wählt auf der Sternkarte einen Sektor, in dem die Crew
// schon war (sprung.selectDest legt die Route an: reisePlan { ziel, hops }), der Steuermann löst „Faltsprung“ (ein Hop, helm.jump) oder
// „Schnellsprung“ (alle Hops, helm.schnellsprung) aus. Nur bekannte Strecken: jeder Zwischensektor ist erkundet, jede Boje bekannt und offen.
//   - Je Hop `reise.hopZeit` Sekunden (4). Jede Ankunft läuft wie ein echter Sprung (sprung.springeNach): Szene, Ankunft am Gegen-Sprungpunkt,
//     Erstbesuch, Boje gefunden, Ereignis `jumped` – die Kampagne merkt keinen Unterschied.
//   - Abbruch (helm.schnellsprung während der Reise): der laufende Hop wird sofort beendet; die Lerche steht an der Boje des nächsten
//     Sektors, als wäre sie natürlich hineingesprungen.
//   - Abfangen: Nach jeder Ankunft würfelt die Region (Fraktion des Hexes): feindlich viel, neutral wenig (wächst mit jedem ereignislosen Hop),
//     befreundet nie. Abgefangen heißt: Reise endet, die Lerche steht mitten im Sektor, Jäger greifen an.
//   Zustand: game.reisePlan | null, game.reise | null, game._reiseOhne (ereignislose Hops am Stück)
const Locations = require('../../shared/locations.js');
const Sektoren = require('../../shared/sektoren.js');
const Besitz = require('./besitz.js');   // SUND-01 D: aktueller Besitzer statt statischer Hex-Fraktion (ohne Overlay identisch)

let sprungMod = null;
const sprung = () => sprungMod || (sprungMod = require('./sprung.js'));
let spaceMod = null;
const space = () => spaceMod || (spaceMod = require('./space.js'));
const RC = (game) => (game.C && game.C.reise) || {};
const hexOf = (game) => Sektoren.hexVonOrt(game.ship.scene);

function fraktionArt(game, hex) {
  return (RC(game).fraktionArt || {})[Besitz.besitzer(game, hex)] || 'neutral';
}

// Route über erkundete Hexe und bekannte, offene Kanten (Breitensuche). -> [Hex …] ab dem ersten Hop bis zum Ziel | null
function planen(game, vonHex, zielHex) {
  const ex = game.explore;
  if (!vonHex || !zielHex || vonHex === zielHex || !ex.hexErkundet(zielHex)) return null;
  const prev = { [vonHex]: null }; const q = [vonHex];
  while (q.length) {
    const h = q.shift();
    if (h === zielHex) break;
    for (const n of Sektoren.nachbarn(h)) {
      if (n in prev || !Sektoren.spielbar(n) || Sektoren.istLeerraum(n) || !ex.hexErkundet(n) || !Sektoren.ortVonHex(n)) continue;
      const id = Sektoren.kanteId(h, n);
      if (!ex.bojeBekannt(id) || !ex.kanteOffen(id)) continue;
      prev[n] = h; q.push(n);
    }
  }
  if (!(zielHex in prev)) return null;
  const out = [];
  for (let h = zielHex; h && h !== vonHex; h = prev[h]) out.unshift(h);
  return out;
}

// Weiche Route (nur für die Zielwahl, kein Schnellsprung): kürzester Weg über bekannte, offene Kanten – Zwischensektoren dürfen noch
// unerkundet sein. Im Tutorial gelten die Ort-Links (Boje muss nicht bekannt sein). -> [Hex …] ab dem ersten Hop | null
function weich(game, vonHex, zielHex, ortLinks) {
  const ex = game.explore;
  if (!vonHex || !zielHex || vonHex === zielHex) return null;
  const prev = { [vonHex]: null }; const q = [vonHex];
  while (q.length) {
    const h = q.shift();
    if (h === zielHex) break;
    for (const n of Sektoren.nachbarn(h)) {
      if (n in prev || !Sektoren.spielbar(n) || Sektoren.istLeerraum(n)) continue;
      const a = Sektoren.ortVonHex(h), b = Sektoren.ortVonHex(n); if (!a || !b) continue;
      const id = Sektoren.kanteId(h, n);
      const frei = ortLinks ? (ex.isLinked(a, b) && ex.known.has(b)) : (ex.bojeBekannt(id) && ex.kanteOffen(id));   // Tutorial: nur über bekannte Orte (nicht über „Unbekanntes Signal“)
      if (!frei) continue;
      prev[n] = h; q.push(n);
    }
  }
  if (!(zielHex in prev)) return null;
  const out = [];
  for (let h = zielHex; h && h !== vonHex; h = prev[h]) out.unshift(h);
  return out;
}

// Nach einem normalen Sprung: die Route rückt nach, wenn die Lerche genau den nächsten Hop gesprungen ist, sonst verfällt sie
function nachSprung(game, nachHex) {
  const p = game.reisePlan;
  if (!p) return;
  if (p.hops[0] === nachHex) { p.hops.shift(); if (!p.hops.length) game.reisePlan = null; } else game.reisePlan = null;
}

function planGueltig(game) {
  const p = game.reisePlan; const here = hexOf(game);
  if (!p) return null;
  if (!here || !p.hops.length || !Sektoren.sindNachbarn(here, p.hops[0])) { game.reisePlan = null; return null; }
  return p;
}

// Steuermann: starten bzw. abbrechen. -> Fehlertext | null
function befehl(game) {
  if (game.reise) { game.reise.abbruch = true; return null; }
  const p = planGueltig(game);
  const j = game.ship.jump;
  if (!p) return 'Keine Route gewählt – der Captain wählt auf der Sternkarte einen Sektor, in dem ihr schon wart.';
  if (!j.ready) return j.blockedReason || 'Sprungantrieb lädt noch.';
  if (j.dest !== Sektoren.ortVonHex(p.hops[0])) return 'Erst zum Sprungpunkt Richtung ' + Sektoren.hexName(p.hops[0]) + ' fliegen.';
  game.reise = { hops: p.hops.slice(), i: 0, t: 0, ziel: p.ziel, abbruch: false };
  game.emit('sfx', { name: 'jump_charge' });
  game.emit('schnellsprung', { phase: 'start', n: p.hops.length });
  game.oda(`Schnellsprung: ${p.hops.length} Sektor${p.hops.length === 1 ? '' : 'en'} bis ${Sektoren.hexName(p.hops[p.hops.length - 1])}. Steuer: G bricht ab.`, null);
  return null;
}

function stop(game, text) {
  const r = game.reise; game.reise = null;
  if (text) game.oda(text, null);
  game.emit('schnellsprung', { phase: 'ende', i: r ? r.i : 0 });
}

function update(game, dt) {
  const r = game.reise;
  if (!r) { planGueltig(game); return; }
  r.t += dt;
  if (!r.abbruch && r.t < (RC(game).hopZeit || 4)) return;
  hop(game, r);
}

function hop(game, r) {
  const here = hexOf(game); const next = r.hops[r.i];
  const ort = Sektoren.ortVonHex(next);
  const grund = !here || !next ? 'Kein Sprungpunkt dorthin.' : sprung().hexGrund(game, here, next) || (ort && game.mission.jumpBlocked(ort));
  if (grund || !ort) { game.reisePlan = null; return stop(game, `Schnellsprung beendet: ${grund || 'Ziel nicht erreichbar.'}`); }
  sprung().springeNach(game, ort);
  r.i++; r.t = 0;
  if (game.reisePlan) nachSprung(game, next);
  if (abfangen(game, next)) { game.reisePlan = null; return stop(game, null); }
  if (r.abbruch || r.i >= r.hops.length) {   // (die Rest-Route bleibt bei einem Abbruch gewählt: Faltsprung setzt sie fort)
    return stop(game, r.i >= r.hops.length ? `Schnellsprung abgeschlossen: ${Sektoren.hexName(next)}.` : `Schnellsprung abgebrochen: ${Sektoren.hexName(next)}.`);
  }
}

// Zufallsbegegnung beim Eintritt in `hex`: true = abgefangen (Jäger sind da, die Lerche steht mitten im Sektor)
function abfangen(game, hex) {
  const R = RC(game); const art = fraktionArt(game, hex);
  let p = 0;
  if (art === 'feind') p = R.feindChance != null ? R.feindChance : 0.5;
  else if (art === 'neutral') p = Math.min(R.neutralMax != null ? R.neutralMax : 0.6, (R.neutralChance != null ? R.neutralChance : 0.08) + (R.neutralPlus != null ? R.neutralPlus : 0.08) * (game._reiseOhne || 0));
  if (!(game.rng.chance(p))) { game._reiseOhne = (game._reiseOhne || 0) + 1; return false; }
  game._reiseOhne = 0;
  const loc = Locations.get(game.ship.scene); const sc = loc.scene; const ship = game.ship;
  ship.x = Math.round(sc.w / 2); ship.y = Math.round(sc.h / 2); ship.vx = 0; ship.vy = 0; ship.speed = 0;
  const n = Math.max(R.jaegerMin || 2, Math.min(R.jaegerMax || 4, game.players.filter((q) => q.connected).length + 1));
  const w0 = game.rng.range(-Math.PI, Math.PI);
  for (let i = 0; i < n; i++) {
    const a = w0 + (i - (n - 1) / 2) * 0.35;
    const e = space().spawnEnemy(game, 'raider', { x: ship.x + Math.cos(a) * (R.abstand || 650), y: ship.y + Math.sin(a) * (R.abstand || 650), facing: a + Math.PI, tag: 'abfang' });
    if (e) e.eingesprungen = true;
  }
  game.emit('schnellsprung', { phase: 'abgefangen', hex });
  game.oda(`Abgefangen im Sektor ${Sektoren.hexName(hex)}! ${n} Jäger greifen an.`, null);
  game.missionEvent('abgefangen', { hex, n });
  return true;
}

// Snapshot ship.reise (während der Reise) – Karte, Kartentisch und Steuer zeigen den Fortschritt
function snap(game) {
  const r = game.reise;
  if (!r) return null;
  return { i: r.i, n: r.hops.length, p: Math.min(1, Math.round(r.t / (RC(game).hopZeit || 4) * 100) / 100), von: r.i ? r.hops[r.i - 1] : hexOf(game), nach: r.hops[r.i], ziel: r.hops[r.hops.length - 1] };
}
function reset(game) { game.reisePlan = null; game.reise = null; game._reiseOhne = 0; }

module.exports = { planen, weich, nachSprung, planGueltig, befehl, update, snap, reset, abfangen, fraktionArt };
