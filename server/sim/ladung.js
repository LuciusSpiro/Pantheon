'use strict';
// SL6: Handelsware im Frachtraum – Deuterium schöpfen, abwerfen, verkaufen, Gewicht (CONCEPT-SL6 §2.2).
// Baut auf server/sim/fracht.js (Lager, Beamen, Halteprozess) auf, ohne dessen Funktionen mit Flags zu erweitern: eigene, benannte Funktionen.
//
//   schoepfStart/-Abbrechen/-Weiter  Ops-Aktion Schöpfen (Halteprozess 'schoepf'), nur in der Ertragszone; ruft schoepfen() je Tick
//   schoepfen(game, art, rate, dt)   Füllstand wächst; ist 1 erreicht und Platz frei, kommt eine Einheit ins Lager (nie von selbst, nur über schoepfWeiter)
//   abwerfen(game, art?)             Ops: eine Einheit als Pod ins All (nicht Personen); sofort, wie ein Notabwurf
//   preisFuer(game, hafen, art)      LAD-01 D: Preis je Einheit an einem Hafen (content/handel.json), 0 = kauft nicht; verkaufOrt/handelsOrt: Hafen, an dem man andocken kann
//   verkaufStart(game, p)            Ops: Halteprozess „verkaufen“ (Händler im Umkreis), Marken beim Abschluss (verkaufFertig)
//   gewichtFaktor(game)              Faktor auf die Triebwerksleistung (1 ohne schwere Ladung): space.engineSpeedFactor
// Kein Ertragslimit, kein fallender Preis (Kai 2026-10-14); Kapazität bleibt die des Frachtraums.
const Fracht = require('./fracht.js');
const Marken = require('./geld.js');
const Locations = require('../../shared/locations.js');
const Waren = require('../../shared/waren.js');
const { dist } = require('../util.js');

const cfg = (game) => game.C.fracht;
const r2 = (v) => Math.round(v * 100) / 100;
const artName = (art) => Waren.name(art);
const istWare = (art) => art !== 'person';

// ---------- Schöpfen ----------
// Füllstand je Einheit (0..1) steht in game.fracht.fuell (nicht im Weltstand: nach dem Laden beginnt die nächste Einheit neu)
function schoepfen(game, art, rate, dt) {
  const s = Fracht.state(game);
  if (!Fracht.artOk(game, art)) return 0;
  const T = game.ship.systems.transfer;
  if (T === 'broken' || T === 'offline') return 0;   // ohne Transfer kein Lager
  const pf = Fracht.platzFuer(game, art);   // LAD-01 A2: Typ-Regel (ein Modul, eine Art)
  if (!pf.ok) { s.fuell = 1; if (!s.vollGemeldet) { s.vollGemeldet = true; game.oda(pf.grund === 'voll' ? 'Frachtraum voll – Deuterium-Ladung abwerfen oder zum Händler.' : pf.text, 'ladung_voll'); } return 0; }
  s.vollGemeldet = false;
  s.fuell = (s.fuell || 0) + rate * dt;
  let n = 0;
  while (s.fuell >= 1 && Fracht.platzFuer(game, art).ok) {
    s.fuell -= 1;
    if (Fracht.anBordLegen(game, art, 'schoepfen')) { n++; game.emit('frachtBeamen', { phase: 'fertig', was: 'schoepfen', art }); }
    else break;
  }
  if (n) game.oda(`${artName(art)} geschöpft (${Fracht.anBord(game)}/${Fracht.capacity(game)}).`, 'ladung_' + art);
  if (!Fracht.platzFuer(game, art).ok && s.fuell > 1) s.fuell = 1;
  return n;
}

// ---------- Schöpfen als Ops-Aktion (U2, Kai) ----------
// Nichts füllt sich von selbst: die Ops startet das Schöpfen (weapons.schoepfen), ein Halteprozess wie das Beamen (s.halt.kind 'schoepf'). Es läuft, solange
// die Ops es nicht abbricht (weapons.schoepfen { off }), und nur in der Ertragszone (Förderschicht): Ring verlassen, Frachtraum voll, Transfer aus oder
// niemand an der Ops beendet es. Das Schiff muss die Höhe halten (Zug), sonst rutscht es aus der Schicht.
function schoepfOrt(game) {
  const Z = require('../../shared/zonen.js'); const ZS = require('./zonen.js');
  const zs = ZS.szeneZonen(game); const sh = game.ship;
  const ertragszonen = zs.filter((z) => z.ertrag && String(z.ertrag.ziel).startsWith('fracht:'));
  if (!ertragszonen.length) return { ok: false, reason: 'Hier lässt sich nichts schöpfen.' };
  const e = Z.wirkung(zs, sh.x, sh.y).ertrag.find((q) => q.ziel.startsWith('fracht:'));
  if (e) return { ok: true, art: e.ziel.slice(e.ziel.indexOf(':') + 1), rate: e.rate, zone: e.id };
  const z = ertragszonen[0]; const d = dist(sh.x, sh.y, z.x, z.y);
  return { ok: false, reason: `Nur in der ${z.name || 'Förderschicht'} (grüner Ring) möglich – ${d >= (z.r1 || z.r || 0) ? 'tiefer hinein' : 'zu tief, höher'}.` };
}
// Ops: Schöpfen starten. Rückgabe: Fehlertext | null
function schoepfStart(game, p) {
  const s = Fracht.state(game);
  if (s.halt) return s.halt.kind === 'schoepf' ? 'Schöpfen läuft bereits.' : 'Transfer läuft bereits.';
  if (game.ship.docked) return 'Angedockt – hier wird nichts geschöpft.';
  const T = game.ship.systems.transfer;
  if (T === 'broken' || T === 'offline') return 'Transfer ausgefallen – erst reparieren.';
  const o = schoepfOrt(game); if (!o.ok) return o.reason;
  if (!Fracht.artOk(game, o.art)) return 'Diese Ware lässt sich nicht laden.';
  { const pf = Fracht.platzFuer(game, o.art); if (!pf.ok) return pf.grund === 'voll' ? `${pf.text} – abwerfen oder verkaufen.` : pf.text; }
  s.halt = { kind: 'schoepf', id: null, t: 0, dur: 1, art: o.art };
  game.emit('frachtBeamen', { phase: 'start', was: 'schoepf', dur: 0 });
  game.missionEvent('schoepfenStart', { art: o.art, zone: o.zone });
  return null;
}
function schoepfAbbrechen(game) { const s = game.fracht; return !!(s && s.halt && s.halt.kind === 'schoepf' && Fracht.beamStop(game, 'ops', 'Schöpfen beendet.')); }
// Tick des Halteprozesses (aus fracht.update): null = weiter, sonst { stop, text } (fracht.js beendet den Prozess)
function schoepfWeiter(game, dt) {
  const o = schoepfOrt(game);
  if (!o.ok) return { stop: 'ort', text: 'Förderschicht verlassen – Schöpfen beendet.' };
  schoepfen(game, o.art, o.rate, dt);
  { const pf = Fracht.platzFuer(game, o.art); if (!pf.ok) return { stop: 'voll', text: pf.grund === 'voll' ? 'Frachtraum voll – Schöpfen beendet. Abwerfen (X) oder zum Händler.' : `Schöpfen beendet. ${pf.text}` }; }
  return null;
}
function schoepft(game) { const s = game.fracht; return !!(s && s.halt && s.halt.kind === 'schoepf'); }

// ---------- Gewicht ----------
function gewichtFaktor(game) {
  const G = cfg(game).gewicht || {};
  const s = game.fracht;
  if (!s || !s.lager.length) return 1;
  let abzug = 0;
  for (const l of s.lager) { const g = G[l.art] != null ? G[l.art] : Waren.gewicht(l.art); if (g) abzug += g; }   // LAD-01 A1: config (tune) vor Daten
  return abzug ? Math.max(0.2, 1 - abzug) : 1;
}

// ---------- Abwerfen ----------
// Eine Einheit (art oder die zuletzt geladene Ware) als Pod hinter das Schiff legen. Rückgabe: Fehlertext | null
function abwerfen(game, art) {
  const s = Fracht.state(game);
  if (s.halt && s.halt.kind !== 'schoepf') return 'Transfer läuft – erst abbrechen.';   // beim Schöpfen darf man abwerfen (Platz schaffen, schneller steigen)
  if (game.ship.docked) return 'Angedockt – Fracht wird nicht abgeworfen.';
  let idx = -1;
  for (let i = s.lager.length - 1; i >= 0; i--) {
    const l = s.lager[i];
    if (!istWare(l.art)) continue;
    if (art ? l.art === art : true) { idx = i; break; }
  }
  if (idx < 0) return art ? `Kein ${artName(art)} an Bord.` : 'Keine Ware an Bord.';
  const l = s.lager.splice(idx, 1)[0];
  const sh = game.ship; const d = cfg(game).abwurfAbstand || 70;
  const px = sh.x - Math.cos(sh.angle) * d, py = sh.y - Math.sin(sh.angle) * d;
  const pod = Fracht.fracht_abwerfen(game, px, py, l.art);
  if (pod && l.eig) pod.eig = l.eig;   // LAD-01 B: Eigenschaften bleiben an der Ladung, auch im All
  game.oda(`${artName(Fracht.anzeigeArt(l))} abgeworfen (${s.lager.length}/${Fracht.capacity(game)}).`, null);
  game.missionEvent('frachtAbgeworfenVonBord', { art: l.art, n: s.lager.length });
  return null;
}

// ---------- Verkaufen (LAD-01 D) ----------
// Verkauf an jedem Hafen, an dem die Lerche andocken kann (Kai 2026-11-09: „Exakt dort, wo ich andocke, kann ich auch handeln“). Preise: content/handel.json
// (Volk des Hafens, Override je Hafen und Ware), scene.kauft bleibt ein Override der Szene. Personen sind nie verkäuflich.
const Besitz = require('./besitz.js');
const Sektoren = require('../../shared/sektoren.js');
const HANDEL = require('../../content/handel.json');
const rund = (v) => Math.max(1, Math.round(v));

// scene.kauft als Override: Preis je Ware (true = Preis aus config/Daten, Zahl = fester Preis, false = kauft nicht), 0 = kein Override
function preisVon(game, sc, art) {
  const k = sc && sc.kauft && sc.kauft[art];
  if (k == null || k === false) return 0;
  return k === true ? (Number(cfg(game).preise && cfg(game).preise[art] != null ? cfg(game).preise[art] : Waren.grundpreis(art)) || 0) : (Number(k) || 0);
}
// Der Hafen am Ort der Lerche (Szene) als Beschreibung für preisFuer: { ort, hex, fraktion, sc }
function hafenVon(game) {
  const sh = game.ship; const loc = Locations.get(sh.scene);
  const hex = loc ? (loc.hex || Sektoren.hexVonOrt(loc.id)) : null;
  return { ort: sh.scene, hex: hex || null, fraktion: hex ? Besitz.besitzer(game, hex) : null, sc: (loc && loc.scene) || null };
}
// Preis (Marken je Einheit) der Ware an diesem Hafen; 0 = kauft der Hafen nicht (Person, unbekannte Art, ausgeschlossen, scene.kauft sagt nein)
function preisFuer(game, hafen, art) {
  if (!Waren.artOk(art)) return 0;
  const h = hafen || {};
  if (h.sc && h.sc.kauft && h.sc.kauft[art] === false) return 0;
  const ov = preisVon(game, h.sc, art);
  if (ov > 0) return ov;
  const hex = h.hex || null, fr = h.fraktion !== undefined ? h.fraktion : (hex ? Besitz.besitzer(game, hex) : null);
  const volk = (fr && HANDEL.voelker && HANDEL.voelker[fr]) || HANDEL.standard || {};
  const hd = (HANDEL.haefen && ((hex && HANDEL.haefen[hex]) || (h.ort && HANDEL.haefen[h.ort]))) || {};
  if ((volk.nicht || []).includes(art) || (hd.nicht || []).includes(art)) return 0;
  if (hd.preise && hd.preise[art] != null) return rund(Number(hd.preise[art]) || 0);
  const grund = Number(cfg(game).preise && cfg(game).preise[art] != null ? cfg(game).preise[art] : Waren.grundpreis(art)) || 0;
  if (grund <= 0) return 0;
  const f = (volk.faktor != null ? volk.faktor : 1) * ((volk.waren && volk.waren[art]) != null ? volk.waren[art] : 1) * (hd.faktor != null ? hd.faktor : 1) * ((hd.waren && hd.waren[art]) != null ? hd.waren[art] : 1);
  return rund(grund * f);
}
// Handelsort: Hafen mit Liegeplatz, den die Lerche anlaufen darf (oder Szene mit scene.kauft wie früher), angedockt oder in Stationsreichweite. -> { ok, reason?, hafen, name }
function handelsOrt(game) {
  const sh = game.ship; const loc = Locations.get(sh.scene); const sc = loc && loc.scene;
  const hafen = hafenVon(game);
  if (!sc) return { ok: false, reason: 'Hier kauft niemand Ware.', hafen };
  const name = (loc && loc.name) || sh.scene;
  let ref = null;
  if (sc.kauft && sc.station) ref = sc.station;   // alter Weg: Szene mit eigener Preisliste
  else {
    const dl = Besitz.dockLage(game, sc, hafen.hex);
    if (!dl) return { ok: false, reason: 'Hier kauft niemand Ware (kein Hafen zum Andocken).', hafen };
    if (hafen.hex && !Besitz.darfAndocken(game, hafen.hex)) return { ok: false, reason: Besitz.verbotText(game, hafen.hex) || 'Andocken verweigert – kein Handel.', hafen };
    const sperre = Besitz.handelSperre(game, hafen.hex); if (sperre) return { ok: false, reason: sperre, hafen };
    ref = sc.station || dl;
  }
  if (!(sh.docked && sh.dockedAt === sh.scene)) {
    const far = dist(sh.x, sh.y, ref.x, ref.y);
    if (far > cfg(game).stationRange) return { ok: false, reason: `Zu weit vom Händler (${Math.round(far)}, max. ${cfg(game).stationRange}).`, hafen, name };
  }
  return { ok: true, hafen, name };
}
// Händler im Umkreis? -> { ok, reason?, name?, n, summe }
function verkaufOrt(game) {
  const s = Fracht.state(game);
  if (!s.lager.length) return { ok: false, reason: 'Keine Fracht an Bord.' };
  const frei = s.lager.filter((l) => !(l.eig && l.eig.auftrag));   // LAD-01 B: Auftragsware gehört dem Auftraggeber, nie verkäuflich
  if (!frei.length) return { ok: false, reason: 'Auftragsware lässt sich nicht verkaufen – sie gehört dem Auftraggeber.' };
  const h = handelsOrt(game);
  if (!h.ok) return { ok: false, reason: h.reason };
  const preise = frei.map((l) => preisFuer(game, h.hafen, l.art)).filter((p) => p > 0);   // echte Art (getarnte Ware wird nach ihrem wahren Wert bezahlt)
  if (!preise.length) return { ok: false, reason: frei.every((l) => !istWare(l.art)) ? 'Personen lassen sich nicht verkaufen.' : 'Der Händler kauft diese Ware nicht.' };
  return { ok: true, name: h.name, n: preise.length, summe: preise.reduce((a, b) => a + b, 0) };
}
// Halteprozess starten (Ops). Rückgabe: Fehlertext | null
function verkaufStart(game, p) {
  const s = Fracht.state(game);
  if (s.halt) return 'Transfer läuft bereits.';
  const T = game.ship.systems.transfer;
  if (T === 'broken' || T === 'offline') return 'Transfer ausgefallen – erst reparieren.';
  const o = verkaufOrt(game); if (!o.ok) return o.reason;
  s.halt = { kind: 'verk', id: null, t: 0, dur: T === 'damaged' ? game.C.ship.beamTimeDamaged : game.C.ship.beamTime, name: o.name };
  game.emit('frachtBeamen', { phase: 'start', was: 'verk', dur: s.halt.dur });
  return null;
}
// Abschluss des Halteprozesses (aus fracht.beamFertig): verkauft alle Waren, die der Händler kauft
function verkaufFertig(game) {
  const s = Fracht.state(game);
  const o = verkaufOrt(game);
  const hafen = hafenVon(game);
  if (!o.ok) { game.emit('frachtBeamen', { phase: 'abbruch', was: 'verk', grund: 'ort' }); return 0; }
  let summe = 0; const arten = {};
  for (let i = s.lager.length - 1; i >= 0; i--) {
    if (s.lager[i].eig && s.lager[i].eig.auftrag) continue;   // LAD-01 B
    const pr = preisFuer(game, hafen, s.lager[i].art);
    if (pr <= 0) continue;
    const l = s.lager.splice(i, 1)[0];
    summe += pr; arten[l.art] = (arten[l.art] || 0) + 1;
  }
  s.verkauft = s.verkauft || {};
  for (const [a, k] of Object.entries(arten)) s.verkauft[a] = (s.verkauft[a] || 0) + k;
  Marken.gutschreiben(game, summe, 'verkauf');
  game.emit('frachtBeamen', { phase: 'fertig', was: 'verk', n: Object.values(arten).reduce((a, b) => a + b, 0), marks: summe });
  game.oda(`Verkauft: ${Object.entries(arten).map(([a, n]) => `${n} × ${artName(a)}`).join(', ')} – ${summe} Marken (${o.name}).`, null);
  game.missionEvent('frachtVerkauft', { arten, marks: summe, ort: game.ship.scene, name: o.name });
  if (arten.deuterium) game.missionEvent('deuteriumVerkauft', { n: arten.deuterium, marks: summe, ort: game.ship.scene });   // Kette (SL11): Flag gasVerkauft
  return summe;
}
// Verkaufte Einheiten seit Partiebeginn (art oder alle)
function verkauft(game, art) {
  const v = (game.fracht && game.fracht.verkauft) || {};
  return art ? (v[art] || 0) : Object.values(v).reduce((a, b) => a + b, 0);
}
// Der Halteprozess läuft weiter, solange ein Händler in Reichweite ist (aus fracht.update)
function verkaufWeiter(game) { return verkaufOrt(game).ok; }

// Snapshot-Zusatz für fracht.snapshot: Füllstand der nächsten Einheit (0..1), nur wenn sie sich füllt
function fuellStand(game) { const s = game.fracht; return s && s.fuell > 0.005 ? r2(Math.min(1, s.fuell)) : 0; }

module.exports = { schoepfen, schoepfOrt, schoepfStart, schoepfAbbrechen, schoepfWeiter, schoepft, gewichtFaktor, abwerfen, verkaufOrt, handelsOrt, hafenVon, preisFuer, verkaufStart, verkaufFertig, verkaufWeiter, verkauft, fuellStand, preisVon };
