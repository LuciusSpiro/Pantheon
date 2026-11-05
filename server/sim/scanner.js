'use strict';
// SCA-01 P1: Scanner am Boden (Item `scanner` im Loadout-Slot). Action-Layer; Zustand je Spieler in p.scan, das Ops-Entschlüsseln (game.entschl) bleibt unberührt.
// Abwandlung des Entschlüsselns: Frequenz abstimmen (geteilte Rechnung in abstimmung.js), unterbrechbar, Qualität 0..3 nur beim Vollenden.
//
//   scanStarten(game, p)        Item-Handler (loadout.itemRegistrieren): startet den Scan; zweite Betätigung während des Scans = Abbruch. -> null | Fehlertext
//   scanStimme(game, p, dir)    Befehl scan.stimme: Richtung −1 | 0 | 1 (gehalten); der Server bewegt die Frequenz
//   scanAbbrechen(game, p)      Befehl scan.abbruch: Scan beenden, KEIN Ergebnis, Fortschritt verloren
//   onTreffer(game, pid)        Hook aus combat.ankerTreffer: jeder Treffer auf den Spieler bricht ab (Fortschritt verloren, kein Ergebnis)
//   scanUnterbrochen(game, p)   räumt Zustand und Hold auf (Trennung, Wunde, Kartenwechsel – jeder Abbruch ohne Ergebnis)
//   update(game, dt)            Frequenz, Drift, Fortschritt; Vollendung -> Ergebnis
//   snapshotFuer(game, p)       Feld `sc` { f, s, h, q } des Scannenden | null
//   beiErgebnis(fn)             P2-Schnittstelle: fn(game, p, scanStufe, ort) bei jedem vollendeten Scan; liefert eine Funktion, die den Eintrag entfernt
//
// Hold: p.hold = { kind: 'scan', t, dur: Infinity, scan } (ohne E; Bewegung, Konsole, Niederstrecken, Kartenwechsel brechen ab – interior.updateHold).
// Regeln: Fortschritt wächst mit der Signalstärke (volle Stärke = `dauer` s); Qualität = dauer / Laufzeit (Anteil sauberer Zeit), Schwellen qSchwellen.
// Abklingzeit `abklingzeit` s gilt nur nach einem erfolgreichen Scan. Der Name `scanStufe` (nicht scanQuality: das ist die Störrelais-Qualität des Captain-Scans).
const Loadout = require('./loadout.js');
const Abst = require('./abstimmung.js');

const ITEM_ID = 'scanner';
const cfg = (game) => game.C.scanner;
const r2 = (v) => Math.round(v * 100) / 100;
const HOLD = 'scan';
const handler = [];   // P2: Ergebnis-Empfänger

function beiErgebnis(fn) {
  if (typeof fn !== 'function') throw new Error('beiErgebnis: Funktion fehlt');
  handler.push(fn);
  return () => { const i = handler.indexOf(fn); if (i >= 0) handler.splice(i, 1); };
}

function laeuft(p) { return !!(p && p.scan); }

// Zustand und Hold wegräumen (kein Ergebnis). Der Hold wird nur entfernt, wenn es der des Scans ist.
function scanUnterbrochen(game, p) {
  if (!p) return;
  if (p.scan && p.hold && p.hold.scan === p.scan) p.hold = null;
  p.scan = null;
}

// -> null | Fehlertext. Wird von loadout.slotNutzen aufgerufen, das Ort (Boden, Kampf v2) und Handlungsfähigkeit schon geprüft hat.
function scanStarten(game, p) {
  if (laeuft(p)) { scanUnterbrochen(game, p); if (game.notice) game.notice(p, 'Scan abgebrochen.'); return null; }
  if (p.zone !== 'away') return 'Nur am Boden.';
  if (p.hold) return 'Du bist gerade beschäftigt.';
  const C = cfg(game);
  const rest = Math.min((p.scanBis || 0) - game.time, C.abklingzeit);
  if (rest > 0) return 'Der Scanner lädt noch (' + Math.ceil(rest) + ' s).';
  const s = { f: 0, ziel: 0, zv: 0, zt: 0, dir: 0, halt: 0, t: 0, s: 0 };
  Abst.anlaufStellung(s, C, () => game.rng());
  p.scan = s;
  p.hold = { kind: HOLD, t: 0, dur: Infinity, scan: s };
  game.emit('sfx', { name: 'ui_click' });
  return null;
}

function scanStimme(game, p, dir) {
  if (!laeuft(p)) return null;
  p.scan.dir = Number(dir) > 0 ? 1 : Number(dir) < 0 ? -1 : 0;
  return null;
}

function scanAbbrechen(game, p) {
  if (!laeuft(p)) return null;
  scanUnterbrochen(game, p);
  return null;
}

function onTreffer(game, pid) {
  const p = game.players.find((q) => q.id === pid);
  if (!laeuft(p)) return;
  scanUnterbrochen(game, p);
  if (game.notice) game.notice(p, 'Getroffen – der Scan ist abgebrochen.');
}

function vollendet(game, p) {
  const C = cfg(game);
  const stufe = Abst.qualitaetAus(C, C.dauer / p.scan.t);
  scanUnterbrochen(game, p);
  p.scanBis = game.time + C.abklingzeit;
  game.emit('sfx', { name: 'scan_done' });
  for (const fn of handler.slice()) fn(game, p, stufe, { x: p.x, y: p.y });
}

function update(game, dt) {
  if (!game.players.some(laeuft)) return;   // früher Rücksprung: niemand scannt
  const C = cfg(game);
  for (const p of game.players) {
    if (!p.scan) continue;
    // Hold weg (Bewegung, Konsole, Wunde, Fesseln, Kartenwechsel, Trennung, E-Abbruch) oder Ort/Zustand nicht mehr tragfähig: kein Ergebnis
    if (!p.hold || p.hold.scan !== p.scan || p.zone !== 'away' || !p.connected || p.downed) { scanUnterbrochen(game, p); continue; }
    Abst.schritt(p.scan, dt, C, 1, () => game.rng());
    p.hold.t = p.scan.t;
    if (p.scan.halt >= 1) vollendet(game, p);
  }
}

// Feld `sc` (≈ 40 B, nur solange der Spieler scannt): f Frequenz, s Signal, h Fortschritt, q laufende Schätzung
function snapshotFuer(game, p) {
  if (!laeuft(p)) return null;
  const s = p.scan;
  return { f: r2(s.f), s: r2(s.s), h: r2(s.halt), q: Abst.schaetzung(s, cfg(game)) };
}

// Beim Laden des Moduls anmelden: der Scanner ist dann in jeden Slot wählbar (loadout.erlaubteIds)
Loadout.itemRegistrieren(ITEM_ID, scanStarten);

module.exports = { ITEM_ID, scanStarten, scanStimme, scanAbbrechen, onTreffer, scanUnterbrochen, update, snapshotFuer, beiErgebnis };
