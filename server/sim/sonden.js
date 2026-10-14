'use strict';
// SL4 (CONCEPT-SL4): Sonden der Ops. Action-Layer; Laufzeit game.sonden[], Vorrat game.inventory.sonde (Weltstand-Lager), Snapshot space.so.
// (Nicht zu verwechseln mit dem Kustodenpult der Plattform-Außenkarte, früher „Sonde“: away.sonde.)
//
//   starteInSzene(game, p, ziel?)   Sonde zum Ziel in der Szene schicken (Standard: Ops-Marke); sie fliegt selbst, keine Fernsteuerung
//   update(game, dt)                Flug, Senden (einmal ein Weitscan-Puls am Ziel), Beschuss durch Gegner, Ablauf
//   sieht(game, x, y)               true, wenn eine sendende Sonde den Punkt erfasst (Ziele aufschalten, Anzeige)
//   vorrat(game) / snapshot(game)   Anzahl im Vorrat / Feld space.so
//   (SL4 Teil 2, nach SL1: starteDurchSprungpunkt, gesichtet, Sektorplan)
//
// Regeln (Config `sonden`): Eine Sonde fliegt gerade mit `tempo` zum Ziel und sendet dort, bis sie zerstört ist oder `leben` Sekunden vergangen sind.
// Am Ziel macht sie einmal einen Weitscan-Puls (Verstecke, Bojen im Radius `reichweite`). Gegner (nicht Relais) im Umkreis `gegnerSicht` sehen
// sie und beschädigen sie mit `gegnerDps` je Sekunde – ihr Verlust ist eine Antwort. Wechselt die Lerche die Szene, enden alle Sonden dieser Szene.
const Station = require('./station.js');

const cfg = (game) => game.C.sonden;
const r1 = (v) => Math.round(v * 10) / 10;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const Z = { FLIEGT: 0, SENDET: 1, SPRINGT: 2 };   // SPRINGT: durch den Sprungpunkt, meldet den Nachbarsektor nach `sprungZeit`
const Sektoren = require('../../shared/sektoren.js');
const Sektorplan = require('./sektorplan.js');
let sprungMod = null;
const Sprung = () => sprungMod || (sprungMod = require('./sprung.js'));

function reset(game) { game.sonden = []; game.sondenSzene = null; game.sondenSeq = 0; }
function vorrat(game) { return Math.max(0, Math.floor(Number(game.inventory && game.inventory.sonde) || 0)); }
function liste(game) { return game.sonden || (game.sonden = []); }

// -> Fehlertext | null. ziel: { x, y } oder weggelassen = taktische Marke der Ops
function starteInSzene(game, p, ziel) {
  const C = cfg(game); const sh = game.ship;
  if (p && Station.stationOf(p) !== 'weapons') return 'Das macht die Ops.';
  if (vorrat(game) < 1) return 'Keine Sonden im Vorrat – im Hafen nachkaufen.';
  const l = liste(game);
  if (l.length >= C.max) return `Es sind schon ${C.max} Sonden unterwegs.`;
  const z = ziel && Number.isFinite(ziel.x) && Number.isFinite(ziel.y) ? ziel : sh.markers && sh.markers.tactical;
  if (!z || !Number.isFinite(z.x) || !Number.isFinite(z.y)) return 'Erst ein Ziel markieren (rechte Maustaste auf der Taktikkarte).';
  const sp = game.space;
  const tx = Math.max(0, Math.min(sp.w, z.x)), ty = Math.max(0, Math.min(sp.h, z.y));
  if (dist(sh.x, sh.y, tx, ty) < 60) return 'Das Ziel liegt zu nah an der Lerche.';
  game.inventory.sonde = vorrat(game) - 1;
  const s = { id: 'so' + (++game.sondenSeq), x: sh.x, y: sh.y, tx, ty, z: Z.FLIEGT, hp: C.hp, bis: game.time + C.leben, gepulst: false };
  l.push(s);
  game.emit('sfx', { name: 'marker_set' });
  game.missionEvent('sondeGestartet', { id: s.id, x: tx, y: ty, rest: vorrat(game) });
  return null;
}

// Sonde durch den Sprungpunkt der Kante zum Nachbarhex `nach` (Hex SSZZ oder Ort-ID) schicken; auch in unerkundete Sektoren.
// Der Sektor gilt danach als GESICHTET, nie als erkundet. Bedingung: Sprungpunkt bekannt und offen (Leerraum: temporärer Sprungpunkt). -> Fehlertext | null
function starteDurchSprungpunkt(game, p, nach) {
  const C = cfg(game); const ex = game.explore;
  if (p && Station.stationOf(p) !== 'weapons') return 'Das macht die Ops.';
  const hex = /^\d{4}$/.test(String(nach)) ? String(nach) : Sektoren.hexVonOrt(nach);
  const here = Sektoren.hexVonOrt(game.ship.scene);
  if (!here || !hex || !Sektoren.sindNachbarn(here, hex)) return 'Dorthin führt kein Sprungpunkt dieses Sektors.';
  if (!Sektoren.spielbar(hex)) return 'Dieser Sektor ist gesperrt.';
  const id = Sektoren.kanteId(here, hex);
  if (!ex.bojeBekannt(id)) return 'Der Sprungpunkt dorthin ist noch nicht gefunden (Weitscan).';
  if (!ex.kanteOffen(id)) return 'Der Sprungpunkt ist gesperrt.';
  if (vorrat(game) < 1) return 'Keine Sonden im Vorrat – im Hafen nachkaufen.';
  const l = liste(game);
  if (l.length >= C.max) return `Es sind schon ${C.max} Sonden unterwegs.`;
  const pt = Sprung().sprungpunkt(game, hex);
  if (!pt) return 'Sprungpunkt nicht gefunden.';
  game.inventory.sonde = vorrat(game) - 1;
  const sh = game.ship;
  const s = { id: 'so' + (++game.sondenSeq), x: sh.x, y: sh.y, tx: pt.x, ty: pt.y, z: Z.FLIEGT, hp: C.hp, bis: game.time + C.leben, gepulst: true, nach: hex, hier: here };
  l.push(s);
  game.emit('sfx', { name: 'marker_set' });
  game.missionEvent('sondeGestartet', { id: s.id, nach: hex, rest: vorrat(game) });
  return null;
}

function verloren(game, s, text, kind) {
  const l = liste(game); const i = l.indexOf(s); if (i >= 0) l.splice(i, 1);
  game.oda(text, null);
  game.missionEvent(kind, { id: s.id, x: r1(s.x), y: r1(s.y) });
}

function update(game, dt) {
  const l = liste(game);
  // andere Szene: Sonden dieser Szene bleiben zurück; Sonden im Sprung (SPRINGT) melden weiter
  if (game.sondenSzene !== game.ship.scene) { for (let i = l.length - 1; i >= 0; i--) if (l[i].z !== Z.SPRINGT) l.splice(i, 1); game.sondenSzene = game.ship.scene; }
  if (!l.length) return;
  const C = cfg(game);
  for (const s of l.slice()) {
    if (s.z === Z.SPRINGT) {
      if (game.time >= s.ankunft) ankunft(game, s);
      continue;
    }
    if (s.z === Z.FLIEGT) {
      const d = dist(s.x, s.y, s.tx, s.ty); const step = C.tempo * dt;
      if (d <= step) {
        s.x = s.tx; s.y = s.ty;
        if (s.nach) { s.z = Z.SPRINGT; s.ankunft = game.time + C.sprungZeit; game.emit('sfx', { name: 'jump_charge' }); continue; }
        s.z = Z.SENDET;
      } else { s.x += ((s.tx - s.x) / d) * step; s.y += ((s.ty - s.y) / d) * step; }
    }
    if (s.z === Z.SENDET && !s.gepulst) {
      s.gepulst = true;
      const n = game.explore && typeof game.explore.widescanAt === 'function' ? game.explore.widescanAt(s.x, s.y, C.reichweite) : 0;
      game.emit('sfx', { name: 'scan_done' });
      game.oda(n ? `Sonde sendet: ${n} neue${n === 1 ? 'r Fund' : ' Funde'} in ihrer Reichweite.` : 'Sonde sendet: im Umkreis nichts Neues. Sie bleibt und beobachtet.', null);
      game.missionEvent('sondeSendet', { id: s.id, x: r1(s.x), y: r1(s.y), funde: n });
    }
    // Gegner sehen die Sonde und schießen darauf (vereinfacht: Schaden je Sekunde im Umkreis, gleiche Regel für jede Gegnerart)
    let dps = 0;
    for (const e of game.space.enemies) if (e.kind !== 'relay' && e.st !== 'treibt' && dist(e.x, e.y, s.x, s.y) <= C.gegnerSicht) dps += C.gegnerDps;
    if (dps > 0) s.hp -= dps * dt;
    if (s.hp <= 0) { verloren(game, s, 'Sonde zerstört. Die Gegner haben sie abgeschossen.', 'sondeZerstoert'); continue; }
    if (game.time >= s.bis) verloren(game, s, 'Sonde erloschen: Energie aufgebraucht.', 'sondeErloschen');
  }
}

// Meldung aus dem Nachbarsektor: sichten, feste Schiffe als Momentaufnahme, Ansage. Die Sonde ist dann verbraucht.
function ankunft(game, s) {
  const l = liste(game); const i = l.indexOf(s); if (i >= 0) l.splice(i, 1);
  const neu = Sektorplan.sichten(game, s.nach, 'sonde');
  Sektorplan.schiffeAufnehmen(game, s.nach);
  const name = Sektoren.hexName(s.nach);
  const schiffe = Sektorplan.schiffeVon(game, s.nach).length;
  game.oda(`Sonde meldet aus ${name}: ${neu ? 'Sektor gesichtet' : 'Sektorplan aktualisiert'}${schiffe ? `, ${schiffe} Schiff${schiffe === 1 ? '' : 'e'} geortet` : ', keine Schiffe in Sicht'}. Sie ist verbraucht. Der Sektorplan des Captains ist ergänzt.`, null);
  game.emit('sfx', { name: 'scan_done' });
  game.missionEvent('sondeAnkunft', { id: s.id, hex: s.nach, schiffe });
  require('./notrufe.js').sondeMeldet(game, s.nach);   // SL8: Messwerte eines Notrufs in diesem Sektor
}

function sieht(game, x, y) {
  const r = cfg(game).reichweite;
  return liste(game).some((s) => s.z === Z.SENDET && dist(s.x, s.y, x, y) <= r);
}

// Snapshot space.so: [{ id, x, y, z, hp, r }] (≤ max, nur wenn vorhanden)
function snapshot(game) {
  const l = liste(game); if (!l.length) return null;
  return l.map((s) => Object.assign({ id: s.id, x: Math.round(s.x), y: Math.round(s.y), z: s.z, hp: Math.max(0, Math.round(s.hp / cfg(game).hp * 100) / 100) }, s.nach ? { n: s.nach } : {}));
}

module.exports = { Z, reset, vorrat, starteInSzene, starteDurchSprungpunkt, update, sieht, snapshot };
