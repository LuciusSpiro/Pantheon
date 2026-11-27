'use strict';
// TRA-01 A1: Das Protokoll kennt die Trainingsmodi mit eigenem Modus-Namen (training_fliegen, training_captain), kein Rückfall auf arena_raum.
// Vorbild: test-telemetrie-uebung.js. Headless gegen die Game-Klasse, echter Lobby-Weg.
//   node tools/test-training-telemetrie.js
//   A  Kopf: modus = Trainingsmodus, szenario null, weltstand null; szene_start modus = Trainingsmodus, szene = Buch (tra_*), nie arena_raum
//   B  Szenenende (verloren) und Neustart: szene_ende modus/szene, zweiter szene_start; Schema, Sessionbericht ohne Warnung
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const { SCHEMA } = require('../server/telemetrie/schema.js');
const { auswerten } = require('./auswerten.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-tra-'));
const lesenDatei = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const dateien = (d) => fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')).map((x) => path.join(d, x));

function training(modus, name) {
  const dir = path.join(root, name);
  const env = { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(root, 'regie-' + name), TELEMETRIE: 'an', TELEMETRIE_QUELLE: 'bot', TELEMETRIE_DIR: dir };
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env, log: () => {} });
  const cs = [];
  for (let i = 0; i < 2; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 500) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'TT' + i, name: 'Geheimname' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: modus });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec, bis) => { for (let k = 0; k < Math.round(sec / DT); k++) { g.step(); if (bis && bis()) return true; } return !bis; };
  const fertig = () => { g.telemetrie.sessionBeenden('test'); return dateien(dir); };
  return { g, run, fertig };
}

for (const [modus, buch] of [['training_fliegen', 'tra_fliegen'], ['training_captain', 'tra_captain']]) {
  console.log('\nA  Kopf und Start ' + modus);
  {
    const U = training(modus, 'a-' + modus); const g = U.g;
    U.run(3);
    const f = U.fertig();
    ok(f.length === 1 && g.errors === 0, 'genau eine Protokolldatei, g.errors 0');
    const z = lesenDatei(f[0]); const kopf = z[0];
    ok(kopf.typ === 'kopf' && kopf.modus === modus, 'Kopf: modus ' + modus + ' (' + kopf.modus + ')');
    ok(kopf.szenario === null && kopf.weltstand === null, 'Kopf: szenario und weltstand null (Training ohne Weltstand)');
    ok(!/Geheimname/.test(fs.readFileSync(f[0], 'utf8')), 'kein Spielername im Protokoll');
    const st = z.filter((x) => x.typ === 'szene_start');
    ok(st.length === 1 && st[0].modus === modus && st[0].szene === buch && st[0].spielerzahl === 2, 'ein szene_start: modus ' + modus + ', szene ' + buch);
    ok(!z.some((x) => x.modus === 'arena_raum') && !st.some((x) => x.modus === 'arena_raum' || x.modus === 'kampagne'), 'kein Rückfall auf arena_raum oder kampagne');
    ok(!z.some((x) => x.typ === 'buchung' && x.grund === 'testmarken'), 'keine Testmarken-Buchung');
  }
  console.log('\nB  Verlust, Neustart, Schema ' + modus);
  {
    const U = training(modus, 'b-' + modus); const g = U.g;
    U.run(2);
    g.mission.completeMission('verloren');
    U.run(4, () => g.arena.training.versuch === 2);
    U.run(1);
    const f = U.fertig(); const z = lesenDatei(f[0]);
    const st = z.filter((x) => x.typ === 'szene_start'); const se = z.filter((x) => x.typ === 'szene_ende');
    ok(se.length === 2 && se[0].ausgang === 'verloren' && se[0].modus === modus && se[0].szene === buch, 'erstes szene_ende: verloren, modus ' + modus);
    ok(se[1] && se[1].ausgang === 'session_ende', 'der zweite Versuch wird mit dem Sessionende geschlossen');
    ok(st.length === 2 && st.every((x) => x.modus === modus && x.szene === buch), 'zweiter szene_start nach dem Neustart, gleicher Modus');
    const ende = z[z.length - 1];
    ok(ende.typ === 'session_ende' && ende.fehler === 0 && ende.verworfen === 0 && g.errors === 0, 'Session endet sauber, g.errors 0');
    ok(z.every((x) => SCHEMA[x.typ] && Object.keys(x).every((k) => ['v', 'typ', 'sitzung', 'tick', 't'].includes(k) || SCHEMA[x.typ].felder.includes(k))), 'jede Zeile steht im Schema (Typ und Felder)');
    let r = null, fehler = null;
    try { r = auswerten(f[0], { aus: false, basis: 'keine' }); } catch (e) { fehler = e; }
    ok(r && !fehler && r.kz.listen.warnungen.length === 0, 'Sessionbericht läuft ohne Warnung durch' + (fehler ? ' (' + fehler.message + ')' : r ? ' (' + JSON.stringify(r.kz.listen.warnungen) + ')' : ''));
    ok(r && r.kz.kopf.modus === modus && r.kz.listen.szenen.length === 2, 'Bericht: Modus ' + modus + ', zwei Szenen');
  }
}

console.log('\nTEST-TRAINING-TELEMETRIE: ' + (fails ? fails + ' FEHLER' : 'alle ' + n + ' bestanden'));
process.exit(fails ? 1 : 0);
