'use strict';
// TEL-01 M2: Das Protokoll erfasst den Übungsplatz Forschungsstation (UEB-01, Lobby-Modus arena_forschung) und den Befehl
// helm.hauptschirm (KUL-02). Integration mit main 9cf0397. Headless gegen die Game-Klasse, echter Lobby-Weg.
//   node tools/test-telemetrie-uebung.js
//   A  Kopf: modus arena_forschung, szenario null, weltstand null (Übung ist nie persistent), Slots ohne Namen
//   B  Start: szene_start modus arena_forschung / szene sl_forschung; Startmarken laufen über den Buchungsdienst (grund start)
//   C  Szenenende: szene_ende erfolg, session_ende, Sessionbericht ohne Warnung, alle Zeilen im Schema, keine verworfenen Felder
//   D  Verlust und Neustart: szene_ende verloren, danach ein zweiter szene_start; der zweite Versuch endet mit dem Sessionende
//   E  helm.hauptschirm: Eingabe des Steuers zählt als ein_akt (keine Rollen- oder Stationsänderung), der Befehl erzeugt keine eigene Zeile
//   F  Der Spielverlauf ist mit und ohne Protokoll bit-gleich (Übung, Verlust und Neustart)
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const { SCHEMA } = require('../server/telemetrie/schema.js');
const { auswerten } = require('./auswerten.js');
const away = require('../server/sim/away.js');
const Lpscan = require('../server/sim/lpscan.js');
const Locations = require('../shared/locations.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-ueb-'));
const lesenDatei = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const dateien = (d) => fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')).map((x) => path.join(d, x));

// Übungsplatz über den echten Lobby-Weg, zwei Spieler; Protokoll an (dir) oder aus (null)
function uebung(dir, name) {
  const env = { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(root, 'regie-' + name), TELEMETRIE: dir ? 'an' : 'aus', TELEMETRIE_QUELLE: 'bot' };
  if (dir) env.TELEMETRIE_DIR = dir;
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env, log: () => {} });
  const cs = [];
  for (let i = 0; i < 2; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 500) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'U' + i, name: 'Geheimname' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_forschung' });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec, bis) => { for (let k = 0; k < Math.round(sec / DT); k++) { g.step(); if (bis && bis()) return true; } return !bis; };
  const cmd = (i, c, f) => g.handleMessage(cs[i], Object.assign({ t: 'cmd', c }, f || {}));
  const fertig = () => { g.telemetrie.sessionBeenden('test'); return dir ? dateien(dir) : []; };
  return { g, run, cmd, fertig };
}
// Verlust: das Team steht auf der Station (Beamen wie in test-uebung-forschung), alle gehen zu Boden, Mission verloren,
// die Übung startet nach dem Hochholen von vorn
function verlieren(U) {
  const { g } = U;
  const gv = Locations.get('helix').scene.gravimetrie;
  g.god = false;
  g.ship.x = gv.station.x - 100; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0;
  g.mission.forceStep('sl_forschung', 'station'); U.run(1);
  Lpscan.markieren(g, 'helix.station');
  if (g.chooseLandepunkt(g.players[0], 'helix.station')) return false;
  away.executeBeam(g, g.players.map((q) => q.id), 'down'); U.run(1);
  for (const p of g.players) { p.hp = 0; p.downed = true; p.downedFor = 0; }
  U.run(5, () => { const ms = g.mission.missions.sl_forschung; return ms && ms.state === 'done'; });
  return U.run(40, () => g.arena.forschung.versuch === 2);
}

console.log('A, B  Kopf und Start');
{
  const d = path.join(root, 'ab'); const U = uebung(d, 'ab'); const g = U.g;
  U.run(3);
  const f = U.fertig();
  ok(f.length === 1 && g.errors === 0, 'genau eine Protokolldatei, g.errors 0');
  const z = lesenDatei(f[0]); const kopf = z[0];
  ok(kopf.typ === 'kopf' && kopf.modus === 'arena_forschung', 'Kopf: modus arena_forschung (' + kopf.modus + ')');
  ok(kopf.szenario === null && kopf.weltstand === null && kopf.graben === null, 'Kopf: szenario, weltstand und graben null (Übung ohne Weltstand)');
  ok(kopf.spielerzahl === 2 && kopf.slots.length === 2 && kopf.slots[0].slot === 'p1', 'Kopf: zwei Slots p1, p2');
  ok(!/Geheimname/.test(fs.readFileSync(f[0], 'utf8')), 'kein Spielername im Protokoll');
  const st = z.filter((x) => x.typ === 'szene_start');
  ok(st.length === 1 && st[0].modus === 'arena_forschung' && st[0].szene === 'sl_forschung' && st[0].spielerzahl === 2, 'ein szene_start modus arena_forschung, szene sl_forschung, 2 Spieler');
  const b = z.filter((x) => x.typ === 'buchung');
  ok(b.length >= 1 && b.some((x) => x.art === 'stand' && x.grund === 'start'), 'Startmarken als Buchung art stand, grund start (Buchungsdienst)');
  ok(!b.some((x) => x.grund === 'testmarken'), 'keine Testmarken (Übungsszene ist keine Testumgebung)');
  ok(g.inventory.marks === b[b.length - 1].stand, 'letzter Buchungsstand = Kontostand (' + g.inventory.marks + '): kein Zugriff am Dienst vorbei');
}

console.log('C  Szenenende, Sessionbericht, Schema');
{
  const d = path.join(root, 'c'); const U = uebung(d, 'c'); const g = U.g;
  U.run(2);
  g.mission.forceStep('sl_forschung', 'abliefern_anflug');
  U.run(3);
  const f = U.fertig(); const z = lesenDatei(f[0]);
  const se = z.filter((x) => x.typ === 'szene_ende');
  ok(se.length === 1 && se[0].modus === 'arena_forschung' && se[0].szene === 'sl_forschung' && se[0].ausgang === 'erfolg', 'ein szene_ende, ausgang erfolg');
  const ende = z[z.length - 1];
  ok(ende.typ === 'session_ende' && ende.fehler === 0 && ende.verworfen === 0, 'session_ende, fehler 0, verworfen 0');
  ok(z.every((x) => SCHEMA[x.typ] && Object.keys(x).every((k) => ['v', 'typ', 'sitzung', 'tick', 't'].includes(k) || SCHEMA[x.typ].felder.includes(k))), 'jede Zeile steht im Schema (Typ und Felder)');
  let r = null, fehler = null;
  try { r = auswerten(f[0], { aus: false, basis: 'keine' }); } catch (e) { fehler = e; }
  ok(r && !fehler, 'Sessionbericht läuft durch' + (fehler ? ' (' + fehler.message + ')' : ''));
  ok(r && r.kz.listen.warnungen.length === 0, 'Sessionbericht ohne Warnung (' + (r ? JSON.stringify(r.kz.listen.warnungen) : '-') + ')');
  ok(r && r.kz.kopf.modus === 'arena_forschung' && r.kz.listen.szenen.length === 1 && r.kz.listen.szenen[0].ausgang === 'erfolg', 'Bericht: eine Szene, Ausgang erfolg');
  let r2 = null; try { r2 = auswerten(f[0], { aus: false }); } catch (e) { fehler = e; }
  ok(r2 && r2.kz.listen.warnungen.length === 0, 'Bericht mit automatischer Basis (keine passende Gruppe) ebenfalls ohne Warnung');
}

console.log('D  Verlust und Neustart');
{
  const d = path.join(root, 'd'); const U = uebung(d, 'd'); const g = U.g;
  U.run(2);
  ok(verlieren(U), 'Neustart nach Verlust (Versuch ' + g.arena.forschung.versuch + ')');
  U.run(2);
  const f = U.fertig(); const z = lesenDatei(f[0]);
  const st = z.filter((x) => x.typ === 'szene_start'); const se = z.filter((x) => x.typ === 'szene_ende');
  ok(se.length === 2 && se[0].ausgang === 'verloren' && se[0].modus === 'arena_forschung', 'erstes szene_ende: ausgang verloren');
  ok(se[1] && se[1].ausgang === 'session_ende', 'der zweite Versuch wird mit dem Sessionende geschlossen (session_ende)');
  ok(st.length === 2 && st.every((x) => x.modus === 'arena_forschung' && x.szene === 'sl_forschung'), 'zweiter szene_start nach dem Neustart');
  const iE = z.findIndex((x) => x.typ === 'szene_ende'); const iS = z.map((x) => x.typ).lastIndexOf('szene_start');
  ok(iE >= 0 && iS > iE, 'Reihenfolge: szene_start, szene_ende verloren, szene_start');
  const ende = z[z.length - 1];
  ok(ende.typ === 'session_ende' && ende.fehler === 0 && ende.verworfen === 0 && g.errors === 0, 'Session endet sauber, g.errors 0');
  let r = null; try { r = auswerten(f[0], { aus: false, basis: 'keine' }); } catch (e) { /* unten */ }
  ok(r && r.kz.listen.warnungen.length === 0 && r.kz.listen.szenen.length === 2, 'Bericht ohne Warnung, zwei Szenen (' + (r ? r.kz.listen.szenen.length : '-') + ')');
}

console.log('E  helm.hauptschirm');
{
  const d = path.join(root, 'e'); const U = uebung(d, 'e'); const g = U.g;
  g.players[0].console = 'helm'; g.players[1].console = 'weapons';
  U.run(2.5);
  const vorher = g.players.map((p) => [p.console, p.station || null]);
  U.cmd(0, 'helm.hauptschirm', { ansicht: 'visier' });
  U.cmd(1, 'helm.hauptschirm', { ansicht: 'klassisch' });   // Ops darf nicht: abgewiesen, zählt trotzdem als Eingabe
  ok(g.hauptschirmAnsicht === 'visier', 'Steuer schaltet auf visier, Ops wird abgewiesen');
  U.run(4);
  const f = U.fertig(); const z = lesenDatei(f[0]);
  ok(JSON.stringify(g.players.map((p) => [p.console, p.station || null])) === JSON.stringify(vorher), 'Konsole und Station der Spieler bleiben (keine Rollenaktion)');
  ok(!z.some((x) => x.typ === 'konsole' && x.grund !== 'betreten' && x.t > 2.5), 'keine konsole-Zeile durch den Befehl');
  const reihe = z.filter((x) => x.typ === 'zeitreihe');
  const akt = [0, 0]; for (const r of reihe) if (Array.isArray(r.ein_akt)) r.ein_akt.forEach((v, i) => { akt[i] += v || 0; });
  ok(akt[0] >= 1 && akt[1] >= 1, 'beide Befehle zählen als ein_akt des Slots (' + akt.join('/') + ')');
  ok(z.every((x) => SCHEMA[x.typ]) && z[z.length - 1].verworfen === 0 && g.errors === 0, 'keine unbekannten Typen, nichts verworfen, g.errors 0');
}

console.log('F  Spielverlauf mit und ohne Protokoll bit-gleich');
{
  const lauf = (dir, name) => {
    const U = uebung(dir, name); const g = U.g;
    U.run(5); verlieren(U); U.run(5);
    g.mission.forceStep('sl_forschung', 'abliefern_anflug'); U.run(3);
    const zustand = JSON.stringify({ marks: g.inventory.marks, ship: [g.ship.x, g.ship.y, g.ship.angle], step: g.mission.step && g.mission.step.id, versuch: g.arena.forschung.versuch, tick: g.tick, hp: g.players.map((p) => p.hp), rng: g.rng && typeof g.rng === 'function' ? g.rng() : null });
    U.fertig();
    return zustand;
  };
  const mit = lauf(path.join(root, 'f1'), 'f1'); const ohne = lauf(null, 'f2');
  ok(mit === ohne, 'Zustand nach Verlust, Neustart und Szenenende identisch' + (mit === ohne ? '' : '\n    ' + mit + '\n    ' + ohne));
}

try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* Aufräumen ist optional */ }
console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ok');
process.exit(fails ? 1 : 0);
