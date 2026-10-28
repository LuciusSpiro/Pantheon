'use strict';
// SYS-01 C1b-1 „Zielsysteme im Zonenmodell“ (Ersatz für SUND-04a-1 A, das Parallelmodell e.zs entfällt): dünner Aufsatz über dem Systemmodell.
//   - Wahl: die Ops wählen am gescannten Gegner eine System-Id aus e.sys (weapons.systemziel, ship.zielsystem). Wirkung am Treffer: gegnersystem.treffen
//     (Gegner) bzw. interior.trefferweg (Lerche): Ist das Ziel in der Zone des Treffers und erreichbar, trifft der Treffer es sicher, sonst der Zufall in der Zone.
//   - Erreichbar = Zone der zugewandten Seite; Mitte nur, wenn die zugewandte Zone keine nicht zerstörten Systeme mehr hat (zugewandteZone, Gsys.erreichbar).
//   - Gegner gegen die Lerche: e.zielsystem = Id eines Lerchensystems (SYSTEMS_INTEG). Wirkt nur mit Szenenschalter (space.zielsysteme, Verfolgung).
//   - Tempo: der Antrieb (e.sys.antrieb) senkt die Fahrt (tempoFaktor, Faktoren aus den Daten), in jeder Szene (SYS-01 C2a: kein Schalter mehr, e.tempoAn entfällt). Ohne Antrieb-Modell genau 1.
//   - halte(e) setzt e.gestellt; die Reparatur bleibt aus (reparaturErlaubt, SYS-01 C2a: server/sim/gegnerreparatur.js).
// Alle Zahlen in content/kampf/zielsysteme-werte.json; Sperre und Immunität der Systeme leben in gegnersystem.js (nachholen, reparaturFertig).
const Protocol = require('../../shared/protocol.js');
const Schilde = require('../../shared/schilde.js');
const Physics = require('../../shared/physics.js');
const Gsys = require('./gegnersystem.js');
const W = require('../../content/kampf/zielsysteme-werte.json').werte;

const SYSTEME = W.systeme.wert;
const SCHALTER = W.szene.wert.schalter;
const ZUSTAND = ['ok', 'damaged', 'broken'];   // Reihenfolge der Stufen in den Daten

// ---------- Szenenschalter ----------
function szeneAn(game, an) {
  if (an === false) delete game.space[SCHALTER]; else game.space[SCHALTER] = true;
}
// Das Ziel der Ops ist weg (Abschuss, Sprung, Szene, Abzug): Ziel und Systemziel gehen gemeinsam (der Snapshot meldet sonst weiter zs). Alle Stellen, die ship.target leeren, rufen das.
function zielLoeschen(game) { game.ship.target = null; delete game.ship.zielsystem; }
function szeneAktiv(game) { return !!(game.space && game.space[SCHALTER] === true); }

// ---------- Tempo und Zustand ----------
// Fahrtfaktor (0..1) aus den Systemen mit Wirkung 'tempo' im Zustand des Gegners (SYS-01 C2a: immer, wie bei der Lerche). Ohne Antrieb-Modell genau 1.
function tempoFaktor(e) {
  if (!e || !e.sys) return 1;
  let f = 1;
  for (const id of Object.keys(SYSTEME)) {
    const sys = SYSTEME[id];
    if (sys.wirkung !== 'tempo' || !e.sys[id]) continue;
    const d = sys.stufen[ZUSTAND.indexOf(e.sys[id].z)];
    if (d && d.faktor != null) f *= d.faktor;
  }
  return f;
}
// Das System ist ausgefallen (zerstört): Verfolgung stellt das Schiff über den Antrieb
function ausgefallen(e, id) { return !!(e && e.sys && e.sys[id] && e.sys[id].z === 'broken'); }
// Gestellt (Verfolgung): die Reparatur bleibt aus (reparaturErlaubt, SYS-01 C2a)
function halte(e) { if (e) e.gestellt = true; }
function reparaturErlaubt(e) { return !(e && e.gestellt); }

// ---------- Zonen und Erreichbarkeit ----------
// Seite (0 Bug, 1 Steuerbord, 2 Heck, 3 Backbord), in der ein Treffer aus (sx, sy) das Schiff e trifft: über das Segment der Klasse, sonst über den Sektor
function seiteGetroffen(game, e, sx, sy) {
  const lay = Schilde.layout(game.C, e.kind);
  if (lay) {
    const sec = Schilde.segmentOf(lay, e.x, e.y, e.angle, sx, sy);
    if (sec >= 0 && sec < lay.segs.length) return lay.segs[sec].seite;
  }
  return Physics.sectorOf(e.x, e.y, e.angle, sx, sy);
}
// Zone der Seite des Gegners, die zur Lerche zeigt (Geometrie wie der Schildsektor des Treffers)
function zugewandteZone(game, e) { return Gsys.SEITE_ZONE[seiteGetroffen(game, e, game.ship.x, game.ship.y)] || null; }
// Systemziel der Ops gegen dieses Ziel als { id, zugewandt } (Treffer prüft Zone und Erreichbarkeit erneut)
function gezielt(game, e) {
  const id = game.ship.zielsystem;
  if (!id || !e || game.ship.target !== e.id || !e.sys || !e.sys[id]) return null;
  return { id, zugewandt: zugewandteZone(game, e) };
}

// ---------- Systemziel der Ops (Befehl weapons.systemziel { id | null }) ----------
// id: jede System-Id des gescannten Ziels (e.sys). Erreichbarkeit wird schon bei der Wahl geprüft und bei jedem Treffer erneut.
function enemyOf(game) { return game.ship.target == null ? null : game.space.enemies.find((e) => e.id === game.ship.target) || null; }
function waehle(game, id) {
  const ship = game.ship;
  if (id == null || id === '') { delete ship.zielsystem; return null; }
  const e = enemyOf(game);
  if (!e) return 'Erst ein Ziel wählen (T oder anklicken).';
  if (!e.scanned) return 'Erst das Ziel scannen (S halten).';
  if (!Gsys.hat(e) || !e.sys[id]) return 'Dieses Ziel hat kein solches System zum Anvisieren.';
  if (!Gsys.erreichbar(e, id, zugewandteZone(game, e))) return 'Von hier nicht erreichbar – erst die Seite öffnen, zu der das System gehört.';
  ship.zielsystem = id;
  return null;
}
// Wählbare System-Ids eines gescannten Ziels (Erreichbarkeit wie bei der Wahl)
function waehlbar(game, e) {
  if (!e || !e.scanned || !Gsys.hat(e)) return [];
  const zug = zugewandteZone(game, e);
  return Gsys.ids(e).filter((id) => Gsys.erreichbar(e, id, zug));
}

// ---------- Treffer-Auswertung (Aufruf aus space.trefferSystem und damage.systemSchaden) ----------
// Zähler für Bots und Messung (game.stats.zielsysteme): gegner = gezielte Zustandswechsel an Gegnern, lerche = gezielte Systemtreffer auf die Lerche
function stats(game) { return game.stats.zielsysteme || (game.stats.zielsysteme = { gegner: 0, lerche: 0 }); }
const ZUST_TEXT = { damaged: 'beschädigt', broken: 'zerstört' };
function gegnerGetroffen(game, e, t) {
  stats(game).gegner++;
  game.emit('sfx', { name: t.state === 'broken' ? 'system_break' : 'hull_hit' });
  if (e.scanned) game.oda(`${(SYSTEME[t.id] && SYSTEME[t.id].name) || t.id} des Ziels ${ZUST_TEXT[t.state] || t.state}.`, null);
  game.missionEvent('zielsystemGetroffen', { enemy: e, system: t.id, stufe: t.state, seite: 'gegner' });
}
function lercheGetroffen(game, t) {
  stats(game).lerche++;
  game.missionEvent('zielsystemGetroffen', { system: t.system, stufe: t.state, seite: 'lerche' });
}

// ---------- Tick (space.update) ----------
// Verzögerte Zustandswechsel der Gegner (Sperre) holen nach
function update(game) {
  for (const e of game.space.enemies) if (e.sys) Gsys.nachholen(game, e);
}

// ---------- Gegnerziel gegen die Lerche (Snapshot ship.zielAuf) ----------
// e.zielsystem ist die Id des Zielsystems (Daten: systeme.<id>.lerche = System der Lerche); ohne Eintrag gilt die Id selbst (ein Lerchensystem)
function lercheZiel(id) { const s = id ? SYSTEME[id] : null; return s && s.lerche ? s.lerche : (id || null); }
// Der Gegner, der auf die Lerche zielt (der zuletzt erschienene, wie ship.zielAuf). Ohne Szenenschalter wirkt e.zielsystem nicht (space.shipHit), also null.
function anvisierer(game) {
  if (!szeneAktiv(game)) return null;
  const list = (game.space && game.space.enemies) || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e && !e.ally && e.zielsystem && Protocol.SYSTEMS_INTEG.indexOf(lercheZiel(e.zielsystem)) >= 0) return e;
  }
  return null;
}
// Index des Lerche-Systems in Protocol.SYSTEMS_INTEG, auf das ein Gegner zielt (-1 = niemand).
function zielAuf(game) { const e = anvisierer(game); return e ? Protocol.SYSTEMS_INTEG.indexOf(lercheZiel(e.zielsystem)) : -1; }
// SYS-01 C1b-2: Klassen-Index (gegner-systeme.json) des Anvisierers, für „Fregatte zielt → Triebwerk“ (ship.zielAufKl, -1 = niemand)
function zielAufKlasse(game) { const e = anvisierer(game); return e ? Gsys.klasseIndex(e.kind) : -1; }

// ---------- Snapshot (gescanntes Ziel) ----------
// az = Antriebsstufe (1 beschädigt, 2 ausgefallen), wenn der Antrieb nicht ok ist; ag = 1: gestellt
function snapExtra(e) {
  if (!e || !e.scanned || !e.sys) return null;
  let o = null;
  const a = e.sys.antrieb;
  if (a && a.z !== 'ok') o = { az: a.z === 'broken' ? 2 : 1 };
  if (e.gestellt) (o || (o = {})).ag = 1;
  return o;
}

// ---------- Debug: zielsysteme [an|aus|frei|treffer [n] [system]] ----------
function debug(game, args) {
  const a = Array.isArray(args) ? args.map(String) : [];
  if (a[0] === 'aus') { szeneAn(game, false); return null; }
  if (a[0] === 'frei') {   // Zustände zurück auf voll, Tempo und gestellt aus
    for (const e of game.space.enemies) {
      if (!Gsys.hat(e)) continue;
      for (const id of Gsys.ids(e)) { e.sys[id].i = Gsys.maxOf(e, id); e.sys[id].z = 'ok'; delete e.sys[id].sp; delete e.sys[id].imm; }
      e.hp = Gsys.summe(e); delete e.gestellt;
    }
    return null;
  }
  if (a[0] === 'treffer') {   // n Treffer (je halbe Integrität des Systems) auf das gewählte System; ohne Sperre, Sichtprüfung und Tests
    const e = enemyOf(game); const id = a[2] && e && e.sys && e.sys[a[2]] ? a[2] : Object.keys(SYSTEME)[0];   // Standard: das erste Zielsystem der Daten
    if (!e || !Gsys.hat(e) || !e.sys[id]) return 'Erst ein Ziel wählen.';
    const zone = Gsys.defOf(e.kind, id).zone;
    for (let i = 0; i < Math.max(1, Math.min(4, Number(a[1]) || 1)); i++) {
      e.sys[id].sp = null;
      const t = Gsys.treffen(game, e, zone, Gsys.maxOf(e, id) / 2, { id, zugewandt: zone });
      if (t && t.gezielt && t.state !== t.vorher) gegnerGetroffen(game, e, t);
    }
    return null;
  }
  szeneAn(game, true);
  return null;
}

module.exports = { SYSTEME, zielLoeschen, szeneAn, szeneAktiv, tempoFaktor, ausgefallen, halte, reparaturErlaubt, seiteGetroffen, zugewandteZone, gezielt, lercheZiel,
  waehle, waehlbar, gegnerGetroffen, lercheGetroffen, update, zielAuf, zielAufKlasse, snapExtra, debug };
