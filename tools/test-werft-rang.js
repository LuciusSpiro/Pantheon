'use strict';
// SUND-02b C: Ausbaustufen am Rang (CONFIG.werft.ruf.stufe, server/sim/werft.js, Texte content/flotte/ruf.json). Direkt gegen die Game-Klasse, ohne Netz.
//   Ruf öffnet nur den KAUF der Stufe (Marken bezahlen weiter), was gekauft ist bleibt (Rang sinkt, Basis verloren); Waffen, Module, Stufe 1 und alle Preise bleiben frei von Rang;
//   Kampagne ohne Ruf-System: keine Rang-Bedingung; Grund je Stufe im Werft-Snapshot (additiv: Feld `sperre`).
//   node tools/test-werft-rang.js   (npm run test:werft-rang; Mutationsprobe: npm run test:werft-rang-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Ruf = require('../server/sim/ruf.js');
const Werft = require('../server/sim/werft.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-werft-rang-'));
let seq = 0;
const RAENGE = Ruf.RAENGE;
const ab = (id) => RAENGE.find((r) => r.id === id).ab;

// Partie: Freie Fahrt Sund (weltsim, Ruf) oder 'free' (Kampagne ohne Tutorial, kein weltsim); angedockt in Castra Martis, am Terminal
function neu(start, crew) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (crew || 1); i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W' + i, name: 'W' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: start });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 10; i++) g.step();
  g.space.enemies = []; g.arena = null;
  const basis = start === 'free' ? 'castra_martis' : 'castra_gradivi', hafen = start === 'free' ? 'statio_limitis' : 'ostia_nova';   // Castra Martis (Limes) bzw. Castra Gradivi (Sund); Hafen ohne Werft
  g.ship.docked = true; g.ship.dockedAt = basis;
  for (const p of g.players) p.console = 'shop';
  g.inventory.marks = 5000;
  const cmd = (i, c, f) => { cs[i].inbox.length = 0; g.handleMessage(cs[i], Object.assign({ t: 'cmd', c }, f || {})); return cs[i].inbox.find((m) => m.kind === 'werftAntwort') || { ok: false, code: null, text: '' }; };
  const kauf = (art, id, i) => { const r = cmd(i || 0, 'werft.freischalten', { art, id }); if (process.env.DBG) console.log('   kauf', art, id, JSON.stringify(r), cs[0].inbox.map((m) => m.kind + ':' + (m.text || '')).join(' ')); return r; };
  const sicht = () => g.snapshot().werft;
  return { g, cs, cmd, kauf, sicht, basis, hafen };
}
const rom = (g, wert) => { g.weltsim.ruf.rom = wert; };
const preisSumme = (o) => JSON.stringify(o);

section('Daten', () => {
  const R = CONFIG.werft.ruf.stufe;
  ok(JSON.stringify(R) === JSON.stringify({ 2: 'centurio', 3: 'tribun' }), 'Rangbindung als Daten: Stufe 2 Centurio, Stufe 3 Tribun, Stufe 1 ohne Bedingung');
  ok(Object.values(R).every((id) => RAENGE.some((r) => r.id === id)), 'alle Rang-Ids gültig');
  ok(preisSumme(CONFIG.werft.preise.stufe) === preisSumme({ 1: 100, 2: 180, 3: 900 }), 'Stufenpreise unverändert (100, 180, 900)');
  ok(preisSumme(CONFIG.werft.preise.waffe) === preisSumme({ standardkanone: 40, sturmbatterie: 60, streubatterie: 70, abwehrturm: 70, torpedowerfer: 100, lanzenbatterie: 120 }), 'Waffenpreise unverändert');
  ok(preisSumme(CONFIG.werft.preise.modul) === preisSumme({ werkstatt: 40 }), 'Modulpreise unverändert');
  ok(Ruf.rangName('centurio') === 'Centurio' && Ruf.rangName('tribun') === 'Tribun', 'Rangname groß geschrieben aus den Rang-Daten');
});

section('Freie Fahrt: Stufe 1 frei, Stufe 2 und 3 am Rang, Marken zahlen weiter', () => {
  const T = neu('freie_fahrt'); const g = T.g;
  ok(!!g.weltsim && Ruf.rang(g) === 'miles', 'Ausgangslage: Freie Fahrt, Rang Miles');
  let r = T.kauf('stufe', 1);
  ok(r.ok && g.ship.stufe === 1 && g.inventory.marks === 4900, 'Stufe 1 ohne Rang kaufbar (100 Marken)');
  r = T.kauf('stufe', 2);
  ok(!r.ok && r.code === 'ruf' && r.text === 'Ausbaustufe 2 braucht den Rang Centurio.' && g.ship.stufe === 1 && g.inventory.marks === 4900, 'Stufe 2 ohne Rang: abgelehnt, lesbarer Text, nichts abgebucht');
  rom(g, ab('centurio') - 1);
  ok(T.kauf('stufe', 2).code === 'ruf', 'einen Punkt unter Centurio: weiter gesperrt');
  rom(g, ab('centurio'));
  g.inventory.marks = 179;
  r = T.kauf('stufe', 2);
  ok(!r.ok && r.code === 'zu_wenig_marken' && g.ship.stufe === 1, 'Centurio, aber 179 Marken: Marken fehlen weiter (Ruf öffnet nur den Zugang)');
  g.inventory.marks = 5000;
  r = T.kauf('stufe', 2);
  ok(r.ok && g.ship.stufe === 2 && g.inventory.marks === 4820, 'Centurio und 180 Marken: Stufe 2 gekauft, Preis unverändert');
  r = T.kauf('stufe', 3);
  ok(!r.ok && r.code === 'ruf' && /Tribun/.test(r.text), 'Stufe 3 als Centurio: gesperrt (Tribun)');
  rom(g, ab('tribun') - 1); ok(T.kauf('stufe', 3).code === 'ruf', 'einen Punkt unter Tribun: gesperrt');
  rom(g, ab('tribun'));
  r = T.kauf('stufe', 3);
  ok(r.ok && g.ship.stufe === 3 && g.inventory.marks === 3920, 'Tribun: Stufe 3 gekauft (900 Marken)');
});

section('Reihenfolge der Gründe: Ort vor Rang', () => {
  const T = neu('freie_fahrt'); const g = T.g;
  g.ship.dockedAt = T.hafen;
  const r = T.kauf('stufe', 2);
  ok(r.code === 'keine_flottenbasis', 'Nicht-Werft-Hafen ohne Rang: Grund ist der Ort (Nur an Flottenbasen), nicht der Rang');
  const w = T.sicht();
  ok(w && w.aktiv === false && w.grund === 'Nur an Flottenbasen' && w.sperre === undefined, 'Snapshot im Nicht-Werft-Hafen: gesperrt mit Ortsgrund, keine Stufengründe');
  g.ship.docked = false; g.ship.dockedAt = null;
  ok(T.kauf('stufe', 2).code === 'nicht_angedockt', 'im Flug: Grund ist Nicht angedockt');
});

section('Waffen und Module ohne Rang', () => {
  const T = neu('freie_fahrt'); const g = T.g;
  ok(Ruf.rang(g) === 'miles', 'Rang Miles');
  const r1 = T.kauf('waffe', 'streubatterie'); ok(r1.ok && g.inventory.marks === 4930, 'Waffentyp (Streubatterie, 70) ohne Rang gekauft');
  const r2 = T.kauf('waffe', 'lanzenbatterie'); ok(r2.ok && g.inventory.marks === 4810, 'Waffentyp (Lanzenbatterie, 120) ohne Rang gekauft');
  const r3 = T.kauf('modul', 'werkstatt'); ok(r3.ok && g.inventory.marks === 4770, 'Modul (Werkstatt, 40) ohne Rang gekauft');
});

section('Stufe bleibt: Rang sinkt', () => {
  const T = neu('freie_fahrt'); const g = T.g;
  rom(g, ab('tribun'));
  ok(T.kauf('stufe', 1).ok && T.kauf('stufe', 2).ok && T.kauf('stufe', 3).ok && g.ship.stufe === 3, 'Rang Tribun: Stufe 1 bis 3 gekauft');
  rom(g, 0);
  ok(Ruf.rang(g) === 'miles', 'Rang fällt auf Miles');
  ok(g.ship.stufe === 3 && Werft.istFrei(g, 'stufe', 2) && Werft.istFrei(g, 'stufe', 3) && Werft.liste(g).stufe === 3, 'Stufe 3 bleibt: Schiff und Freischaltung unverändert, istFrei(stufe, 2) wahr');
  const w = T.sicht();
  ok(w.sperre === undefined && w.frei.stufe === 3 && w.stufe === 3, 'Snapshot: keine Sperre für Gekauftes');
  // Weltstand-Runde (Speichern/Laden): die Stufe bleibt
  const gespeichert = JSON.parse(JSON.stringify(Werft.toSave(g)));
  g.ship.freigeschaltet = null; Werft.restore(g, gespeichert);
  ok(Werft.liste(g).stufe === 3 && Werft.istFrei(g, 'stufe', 3), 'nach Speichern/Laden: Stufe bleibt');
  // Anwenden einer gekauften, aber nicht getragenen Stufe (Altstand/Debug) braucht den Rang nicht
  g.ship.stufe = 1;
  ok(Werft.freischaltenPruefen(g, 'stufe', 3) === null || Werft.freischaltenPruefen(g, 'stufe', 3).code !== 'ruf', 'Gekaufte Stufe anwenden braucht keinen Rang');
  const r = T.kauf('stufe', 3);
  ok(r.ok && g.ship.stufe === 3 && g.inventory.marks === 5000 - 100 - 180 - 900, 'Anwenden kostet nichts und geht ohne Rang');
  // Umbau (Waffe auf Platz) braucht keinen Rang: freigeschaltete Waffe auf offenen Platz
  const u = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'standardbatterie' });
  ok(u.ok || u.code === 'unveraendert', 'Umbau mit bereits freigeschalteten Teilen braucht keinen Rang (Antwort ' + (u.ok ? 'ok' : u.code) + ')');
});

section('Stufe bleibt: Basis verloren', () => {
  const T = neu('freie_fahrt'); const g = T.g;
  rom(g, ab('centurio'));
  ok(T.kauf('stufe', 1).ok && T.kauf('stufe', 2).ok, 'Centurio: Stufe 1 und 2 gekauft');
  g.ship.dockedAt = T.hafen;   // andere Station: keine Flottenbasis
  const s = Werft.status(g);
  ok(!s.aktiv && s.code === 'keine_flottenbasis', 'status(): keine_flottenbasis');
  const u = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'standardbatterie' });
  ok(!u.ok && u.code === 'keine_flottenbasis', 'Umbau gesperrt (keine_flottenbasis)');
  ok(g.ship.stufe === 2 && Werft.istFrei(g, 'stufe', 2) && Werft.liste(g).stufe === 2, 'die Stufe bleibt trotzdem');
  rom(g, 0);
  ok(g.ship.stufe === 2 && Werft.istFrei(g, 'stufe', 2), 'auch mit Rang Miles und ohne Basis: Stufe bleibt');
  // Flottenbasis über Flag (Posten): angedockt dort geht der Umbau wieder, ohne Rang
  g.ship.dockedAt = T.hafen; Werft.setzeFlottenbasis(g, T.hafen, true);
  ok(Werft.status(g).aktiv, 'Flag-Flottenbasis: Werft wieder aktiv');
  const u2 = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'standardbatterie' });
  ok(u2.ok || u2.code === 'unveraendert', 'Umbau an der Flag-Basis ohne Rang möglich (Antwort ' + (u2.ok ? 'ok' : u2.code) + ')');
});

section('Snapshot: Grund je Stufe', () => {
  const T = neu('freie_fahrt'); const g = T.g;
  let w = T.sicht();
  ok(w.aktiv && JSON.stringify(w.sperre) === JSON.stringify({ 2: 'Rang Centurio nötig', 3: 'Rang Tribun nötig' }), 'Miles: Stufe 2 „Rang Centurio nötig“, Stufe 3 „Rang Tribun nötig“, Stufe 1 ohne Grund');
  rom(g, ab('centurio')); w = T.sicht();
  ok(JSON.stringify(w.sperre) === JSON.stringify({ 3: 'Rang Tribun nötig' }), 'Centurio: nur noch Stufe 3');
  rom(g, ab('tribun')); w = T.sicht();
  ok(w.sperre === undefined, 'Tribun: keine Sperre, Feld fehlt (additiv)');
  rom(g, 0); ok(T.kauf('stufe', 1).ok, 'Stufe 1 gekauft'); w = T.sicht();
  ok(w.sperre && w.sperre[1] === undefined, 'Stufe 1 hat nie einen Grund');
});

section('Mehrspieler', () => {
  const T = neu('freie_fahrt', 2); const g = T.g;
  rom(g, ab('centurio'));
  ok(T.kauf('stufe', 1, 1).ok, 'Spieler 2 kauft Stufe 1');
  const r = T.kauf('stufe', 2, 1);
  ok(r.ok && g.ship.stufe === 2, 'Rang gilt für die ganze Crew: Spieler 2 kauft Stufe 2');
  const w = T.sicht();
  ok(w.sperre && w.sperre[3] === 'Rang Tribun nötig', 'beide sehen denselben Grund (Snapshot ist Crew-Zustand)');
});

section('Kampagne und Testumgebung: keine Rang-Bedingung', () => {
  const T = neu('free'); const g = T.g;
  ok(!g.weltsim && g.rufErreicht('legat') === true, 'Kampagne: kein weltsim, jeder Rang gilt als erreicht');
  ok(T.kauf('stufe', 1).ok, 'Kampagne: Stufe 1 kaufbar');
  const r = T.kauf('stufe', 2);
  ok(r.ok && g.ship.stufe === 2 && g.inventory.marks === 5000 - 100 - 180, 'Kampagne: Stufe 2 kaufbar ohne Rang (180 Marken)');
  ok(T.kauf('stufe', 3).ok && g.ship.stufe === 3, 'Kampagne: Stufe 3 kaufbar (900 Marken)');
  const T2 = neu('free');
  ok(T2.sicht().sperre === undefined, 'Kampagne: kein Grund im Snapshot');
});

section('Texte und Fehlkonfiguration', () => {
  ok(Ruf.werftText('stufe_grund', { rang: 'Optio' }) === 'Rang Optio nötig', 'Text aus content/flotte/ruf.json');
  ok(Ruf.werftText('gibtsnicht', {}) === '', 'unbekannter Textschlüssel: leer');
  const code = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'werft.js'), 'utf8');
  ok(!/Dafür fehlt der Rang/.test(code) && !/nötig['"`]/.test(code.replace(/\/\/.*$/gm, '')), 'kein Rang-Text im Code (nur in der Textdatei)');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
