'use strict';
// PAN-01 Paket A: Bordmodule (Frachtraum, Krankenstation, Werkstatt) als Daten, Energie und Wirkung.
//
// Ein Modul steht in einem Modulraum (Nummer 1..CONFIG.module.max) und ist an oder aus. Jedes LAUFENDE Modul zieht CONFIG.module.energie (1) aus dem
// Reaktor, Hauptsysteme (Antrieb, Schilde, Waffen) ziehen wie bisher ihre eingestellte Energie. Gleiche Module dürfen mehrfach stehen (PAN-01 B: vier gleich große
// Modulräume auf dem Unterdeck, jedes Modul in jedem Raum; Raum 3 öffnet mit Ausbaustufe 1, Raum 4 mit Stufe 2, siehe ausbau.js).
//
//   ship.module = [{ id, raum, an, lauf }]
//     an   = Wunsch der Technik (technik.module); lauf = tatsächlich in Betrieb (an UND genug Reaktorleistung, siehe space.enforcePower).
//
// Wirkung (nur wenn das Modul LÄUFT):
//   frachtraum      sonst ungesichert: Fracht.setGesichert(false); bei Hüllentreffern löst sich Ladung (fracht.huellenTreffer), Anzeige in der Taktik
//   krankenstation  jeder Ausgeschaltete wird per Notrückholung geholt (combat.js updateWounded/updateBewusstlos); sonst gilt die alte Regel
//   werkstatt       zweiter Schrauber (bots.botAnzahl)
//
// Die Energieverteilung der Hauptsysteme wird NICHT gespeichert; die Bestückung gehört in den Weltstand (schiff.module).
const Fracht = require('./fracht.js');

const cfg = (game) => game.C.module;
const NAMEN = { frachtraum: 'Frachtraum', krankenstation: 'Krankenstation', werkstatt: 'Werkstatt' };
const name = (id) => NAMEN[id] || String(id);

function neu(C) { return (C.module.start || []).map((m) => ({ id: m.id, raum: m.raum, an: true, lauf: true })); }
function liste(game) { return game.ship.module || (game.ship.module = neu(game.C)); }
function finde(game, id, raum) { return liste(game).find((m) => m.id === id && (raum == null || m.raum === raum)) || null; }

// ---------- Abfragen ----------
function installiert(game, id) { return liste(game).some((m) => m.id === id); }
// PAN-01 B: Modulräume, in denen ein Frachtraum steht (Kapazität 2 je Raum, Buchten und Betten dort: Maps.frachtPlaetze)
function frachtRaeume(game) { return liste(game).filter((m) => m.id === 'frachtraum').map((m) => m.raum); }
function laeuft(game, id) { return liste(game).some((m) => m.id === id && m.lauf); }
// alle installierten Module dieser Art laufen (und mindestens eines ist da): Frachtraum „gesichert“ gilt nur dann
function alleLaufen(game, id) { const l = liste(game).filter((m) => m.id === id); return l.length > 0 && l.every((m) => m.lauf); }
function anzahlLaufend(game) { return liste(game).filter((m) => m.lauf).length; }
function anzahlAn(game) { return liste(game).filter((m) => m.an).length; }
// Energie, die die Module nach Wunsch der Technik ziehen würden (Grundlage für die Kürzung und für technik.power)
function energieWunsch(game) { return anzahlAn(game) * cfg(game).energie; }
function energieLauf(game) { return anzahlLaufend(game) * cfg(game).energie; }

// ---------- Standardverteilung der Hauptsysteme ----------
// frei = Energie für die Hauptsysteme (Reaktor minus aktive Module). Tabelle CONFIG.module.standard, sonst: je 1, den Rest reihum Schilde, Antrieb, Waffen.
function standardVerteilung(game, frei) {
  const t = cfg(game).standard[frei];
  const v = t ? t.slice() : [1, 1, 1];
  if (!t) { let rest = Math.max(0, frei - 3); const order = [1, 0, 2]; for (let i = 0; rest > 0 && v.some((x) => x < game.C.power.maxPerSystem); i++) { const k = order[i % 3]; if (v[k] < game.C.power.maxPerSystem) { v[k]++; rest--; } } }
  return { engines: v[0], shields: v[1], weapons: v[2] };
}
// Hauptsysteme auf die Standardverteilung für die aktuelle Modulzahl setzen (Start, Debug-Bestückung); die Technik stellt danach nach Lage um
function verteilungSetzen(game) {
  const frei = Math.max(0, game.C.power.reactor - energieWunsch(game));
  const v = standardVerteilung(game, frei);
  game.ship.powerIntent = Object.assign({}, v);
  Object.assign(game.ship.power, v);
  return v;
}

// ---------- Schalten (Technik) und Bestücken (Debug) ----------
// technik.module { id, on [, raum] }. Ausschalten geht immer. Einschalten nur mit freier Reaktorleistung (wie technik.power): kein stilles Wegnehmen bei den Hauptsystemen.
function schalten(game, id, on, raum, demand, out) {
  if (!cfg(game).ids.includes(id)) return 'Unbekanntes Modul.';
  const list = liste(game).filter((m) => m.id === id && (raum == null || m.raum === raum));
  if (!list.length) return `${name(id)} ist nicht eingebaut.`;
  if (on) {
    const m = list.find((q) => !q.an);
    if (!m) return `${name(id)} ist schon an.`;
    if (demand + cfg(game).energie > out) return 'Reaktor ausgelastet – erst woanders Energie abziehen oder ein Modul abschalten.';
    m.an = true;
  } else {
    const m = list.slice().reverse().find((q) => q.an);   // bei mehreren gleichen Modulen das zuletzt eingebaute zuerst
    if (!m) return `${name(id)} ist schon aus.`;
    m.an = false; m.lauf = false;
  }
  return null;
}
function bestuecken(game, id, raum) {
  const C = cfg(game);
  if (!C.ids.includes(id)) return 'Unbekanntes Modul (frachtraum | krankenstation | werkstatt).';
  const l = liste(game);
  const offen = require('../world.js').Maps.modulRaeumeOffen(game.ship.stufe | 0);   // PAN-01 B: nur offene Räume
  let r = raum;
  if (r == null) { for (let i = 1; i <= C.max; i++) if (offen.includes(i) && !l.some((m) => m.raum === i)) { r = i; break; } }
  if (!(r >= 1 && r <= C.max)) return `Kein freier Modulraum (offen: ${offen.join(', ')}; Debug: ausbau <stufe>).`;
  if (!offen.includes(r)) return `Modulraum ${r} ist noch verschlossen (Ausbaustufe ${require('../world.js').Maps.MODUL_RAEUME.find((q) => q.raum === r).stufe} nötig, Debug: ausbau <stufe>).`;
  if (l.some((m) => m.raum === r)) return `Modulraum ${r} ist belegt.`;
  l.push({ id, raum: r, an: true, lauf: true });
  l.sort((a, b) => a.raum - b.raum);
  return null;
}
function entfernen(game, id, raum) {
  const l = liste(game);
  const i = l.findIndex((m) => m.id === id && (raum == null || m.raum === raum));
  if (i < 0) return `${name(id)} ist nicht eingebaut.`;
  l.splice(i, 1);
  return null;
}

// ---------- Notrückholung ----------
// Jede Notrückholung (Krankenstation, Ausbluten, ganzes Außenteam, Captain-Befehl) sprengt den Transfer (CONFIG.module.notrueckholung.transferZustand, Standard
// zerstört): Reparatur über die drei Wege, bis dahin kein Beamen. Sie braucht selbst keine Energie (der Transfer ist kein Energieposten, läuft im Notstrom),
// und der Reaktor spielt keine Rolle. Ist der Transfer schon aus, bleibt es dabei. Die ODA-Ansage kommt von interior.damageSystem.
function notrueckholungFolge(game) {
  const st = game.ship.systems.transfer;
  if (st === 'broken' || st === 'offline') return false;
  require('./interior.js').damageSystem(game, 'transfer', cfg(game).notrueckholung.transferZustand);
  return true;
}

// ---------- Tick (nach space.enforcePower) ----------
// Wirkungen, die an „läuft“ hängen: Frachtraum gesichert, Zahl der Schrauber. Meldet Übergänge einmal.
function update(game) {
  const gesichert = !installiert(game, 'frachtraum') || alleLaufen(game, 'frachtraum');
  if (Fracht.gesichert(game) !== gesichert) {
    Fracht.setGesichert(game, gesichert);
    game.emit('frachtGesichert', { an: gesichert });
    if (!gesichert) game.oda('Frachtraum ohne Strom – die Sicherungen sind aus, die Ladung ist ungesichert!', null);
    else game.oda('Frachtraum wieder unter Strom – Ladung gesichert.', null);
  }
  require('./bots.js').ensureBotCount(game);
}

// ---------- Snapshot / Weltstand ----------
// ship.mod: [[code, raum, an, läuft]] (kompakt, Budget; Codes CONFIG.module.codes)
function snapshot(game) {
  const codes = cfg(game).codes;
  return liste(game).map((m) => [codes[m.id] || m.id, m.raum, m.an ? 1 : 0, m.lauf ? 1 : 0]);
}
function toSave(game) { return liste(game).map((m) => ({ id: m.id, raum: m.raum, an: !!m.an })); }
// fehlt der Block (Altstand): Start-Bestückung. Bestückung und an/aus werden übernommen, die Verteilung nicht (Standardverteilung). Räume, die bei der
// gespeicherten Ausbaustufe noch zu sind, gibt es nicht (die Stufe wird vorher gesetzt, ausbau.restore).
function restore(game, arr) {
  const C = cfg(game);
  const seen = new Set();
  const out = [];
  const offen = require('../world.js').Maps.modulRaeumeOffen(game.ship.stufe | 0);
  for (const m of Array.isArray(arr) ? arr : []) {
    if (!m || !C.ids.includes(m.id) || !Number.isInteger(m.raum) || m.raum < 1 || m.raum > C.max || !offen.includes(m.raum) || seen.has(m.raum)) continue;
    seen.add(m.raum);
    out.push({ id: m.id, raum: m.raum, an: m.an !== false, lauf: m.an !== false });
  }
  out.sort((a, b) => a.raum - b.raum);
  game.ship.module = Array.isArray(arr) ? out : neu(game.C);
  verteilungSetzen(game);
}

// ---------- Debug: modul [status | start | voll | an <id> [raum] | aus <id> [raum] | weg <id> [raum] | bau <id> [raum]] ----------
//   start  = Frachtraum + Krankenstation (2 Module, Standardverteilung 2/2/2)
//   voll   = vier Module (Frachtraum, Krankenstation, Werkstatt, Frachtraum; Standardverteilung 1/2/1); hebt die Ausbaustufe auf mindestens 2 (Räume 3 und 4 offen)
//   bau    = Modul in einen freien OFFENEN Raum einbauen (auch ein zweites gleiches, raum 1..4 wählbar), danach Standardverteilung
//   weg    = Modul ausbauen; an|aus = wie die Technik schalten (aus: immer, an: nur mit freier Reaktorleistung)
function debug(game, args) {
  const sub = args[0] || 'status';
  const id = args[1] != null ? String(args[1]) : null;
  const raum = args[2] != null && Number.isFinite(Number(args[2])) ? Number(args[2]) : null;
  if (sub === 'start' || sub === 'voll') {
    if (sub === 'voll' && (game.ship.stufe | 0) < 2) { require('./ausbau.js').setStufe(game, 2); game.log('Ausbaustufe auf 2 angehoben (Modulräume 3 und 4 offen).'); }
    game.ship.module = sub === 'start' ? neu(game.C)
      : [{ id: 'frachtraum', raum: 1, an: true, lauf: true }, { id: 'krankenstation', raum: 2, an: true, lauf: true },
        { id: 'werkstatt', raum: 3, an: true, lauf: true }, { id: 'frachtraum', raum: 4, an: true, lauf: true }];
    verteilungSetzen(game);
    return null;
  }
  if (sub === 'bau') { const e = bestuecken(game, id, raum); if (!e) verteilungSetzen(game); return e; }
  if (sub === 'weg') { const e = entfernen(game, id, raum); if (!e) verteilungSetzen(game); return e; }
  if (sub === 'an' || sub === 'aus') {
    const sp = require('./space.js');
    return schalten(game, id, sub === 'an', raum, sp.powerDemand(game), sp.reactorOutput(game));
  }
  game.log('Module: ' + liste(game).map((m) => `${m.raum}:${m.id}${m.an ? '' : ' (aus)'}${m.an && !m.lauf ? ' (ohne Strom)' : ''}`).join(', ') + ` | gesichert ${Fracht.gesichert(game)}`);
  return null;
}

module.exports = {
  neu, liste, finde, installiert, frachtRaeume, laeuft, alleLaufen, anzahlLaufend, anzahlAn, energieWunsch, energieLauf,
  standardVerteilung, verteilungSetzen, notrueckholungFolge, schalten, bestuecken, entfernen, update, snapshot, toSave, restore, debug, name,
};
