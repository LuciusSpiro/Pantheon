'use strict';
// PAN-01 Paket D (CONTRACT-PAN01-D): Werft einer Flottenbasis – Daten, Freischalten, Umbauen, Vorschau, Mehrspieler, Weltstand, Snapshot, Debug.
//   node tools/test-werft.js            -> alle Abschnitte
//   node tools/test-werft.js rennen     -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Maps = require('../shared/maps.js');
const Katalog = require('../shared/schiffskatalog.js');
const Locations = require('../shared/locations.js');
const Protocol = require('../shared/protocol.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const Modul = require('../server/sim/module.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const Werft = require('../server/sim/werft.js');
const Fracht = require('../server/sim/fracht.js');
const shop = require('../server/sim/shop.js');
const limes = require('../content/welt/limes.json');
const sund = require('../content/welt/sund.json');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-werft-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

// Partie mit `players` Spielern. start: 'arena_space' (Testgelände) | 'free' (Kampagne ohne Tutorial, Weltstand auf der Platte)
function setup(start, opts) {
  const o = opts || {};
  const players = o.players || 1;
  const g = new Game(Object.assign({ noStore: true, worlds: start !== 'arena_space', worldSaveSync: true, worldDir: o.dir, seed: o.seed || 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} }, o.game || {}));
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'D' + i, name: 'Werft' + i, color: i });
    conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: start, ...(o.world ? { world: o.world } : {}) });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  const T = { g, conns, p: g.players[0], run };
  T.send = (i, m) => g.handleMessage(conns[i], m);
  // Befehl als Spieler i; Rückgabe { ok, code, text } aus der Antwort werftAntwort (null, wenn keine kam: z. B. falsche Konsole)
  T.cmd = (i, cmd, f) => {
    conns[i].inbox.length = 0; T.send(i, Object.assign({ t: 'cmd', c: cmd }, f || {}));
    const a = conns[i].inbox.find((m) => m.kind === 'werftAntwort');
    return a || { ok: false, code: null, text: conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text).join(' ') };
  };
  T.debug = (cmd, args) => { conns[0].inbox.length = 0; T.send(0, { t: 'debug', cmd, args }); return conns[0].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.dock = (ort) => { g.ship.docked = true; g.ship.dockedAt = ort; };
  T.sit = (i, kind) => { g.players[i].console = kind === undefined ? 'shop' : kind; };
  return T;
}
const sizeOf = (o) => Buffer.byteLength(JSON.stringify(o));
const werftSicht = (g) => JSON.stringify({ st: g.ship.stufe, w: Waffen.waffenMap(g), m: Modul.toSave(g), f: Werft.toSave(g), marks: g.inventory.marks });

section('Daten: Flottenbasis am Ort', () => {
  const hexMit = (karte) => Object.entries(karte.hexe).filter(([, d]) => d.flottenbasis);
  const limesBasen = hexMit(limes).map(([h, d]) => h + ' ' + d.name);
  ok(limesBasen.join() === '0202 Castra Martis', 'Limes: genau Castra Martis (0202) trägt flottenbasis ' + limesBasen.join());
  const sundBasen = hexMit(sund).map(([h, d]) => h + ' ' + d.name);
  ok(sundBasen.join() === '0304 Castra Gradivi', 'Sund: genau Castra Gradivi (0304) trägt flottenbasis ' + sundBasen.join());
  const feind = [...Object.entries(limes.hexe), ...Object.entries(sund.hexe)].filter(([, d]) => /Flottenbasis/i.test(d.art || '') && d.fraktion !== 'rom');
  ok(feind.length >= 1 && feind.every(([, d]) => !d.flottenbasis), `feindliche Basen ohne Flag (${feind.map(([, d]) => d.name).join(', ')})`);
  ok([...Object.values(limes.hexe), ...Object.values(sund.hexe)].filter((d) => d.flottenbasis).every((d) => d.fraktion === 'rom'), 'Flag nur an römischen Basen');
  const cm = Locations.get('castra_martis');
  ok(cm && cm.flottenbasis === true && cm.shop === 'hafen', 'Locations.get(castra_martis).flottenbasis, Handel (shop hafen) bleibt');
  ok(!Locations.get('hafen').flottenbasis && !Locations.get('statio_limitis').flottenbasis && !Locations.get('ceres_depot').flottenbasis, 'Lichtkordon, Statio Limitis, Ceres-Depot: keine Werft');
});

section('Ort: werft.aktiv nur angedockt an einer Flottenbasis, Handel überall', () => {
  const T = setup('arena_space'); const g = T.g;
  T.g.ship.docked = false; g.ship.dockedAt = null;
  let s = Werft.status(g);
  ok(!s.aktiv && s.code === 'nicht_angedockt' && s.grund === 'Nicht angedockt', 'im Flug: gesperrt, Grund "Nicht angedockt"');
  T.dock('hafen'); s = Werft.status(g);
  ok(!s.aktiv && s.code === 'keine_flottenbasis' && s.grund === 'Nur an Flottenbasen', 'Lichtkordon: gesperrt, Grund "Nur an Flottenbasen"');
  T.dock('vaelen'); ok(!Werft.status(g).aktiv, 'Vaelen-Karawane: gesperrt');
  T.dock('statio_limitis'); ok(!Werft.status(g).aktiv, 'Statio Limitis (Hafen mit Shop, römisch): gesperrt');
  T.dock('castra_martis'); ok(Werft.status(g).aktiv && Werft.status(g).grund === undefined, 'Castra Martis: aktiv');
  ok(Werft.istFlottenbasis(g, 'castra_martis') && !Werft.istFlottenbasis(g, 'hafen') && !Werft.istFlottenbasis(g, null), 'istFlottenbasis(ort)');
  // Flag im Weltstand (Flottenstützpunkt, den das Spiel erst baut; Hinweis Paket 2)
  T.dock('kreuzweg'); ok(!Werft.status(g).aktiv, 'Kreuzweg: gesperrt');
  Werft.setzeFlottenbasis(g, 'kreuzweg', true); ok(Werft.status(g).aktiv, 'Flag mission.flags.flottenbasis_kreuzweg macht den Ort zur Werft');
  Werft.setzeFlottenbasis(g, 'kreuzweg', false); ok(!Werft.status(g).aktiv, 'Flag zurückgenommen: gesperrt');
  // Handel überall wie bisher
  for (const ort of ['hafen', 'vaelen', 'statio_limitis', 'castra_martis', 'kreuzweg']) {
    const sc = shop.shopContext(g); T.dock(ort);
    g.inventory.marks = 500; g.inventory.ersatzteil = 0; T.sit(0, 'shop');
    const r = T.cmd(0, 'shop.buy', { item: 'ersatzteil' });
    ok(!r.text && g.inventory.ersatzteil === 1 && g.inventory.marks === 460, `Handel in ${ort}: Ersatzteil gekauft (shopContext ${shop.shopContext(g)})`);
    void sc;
  }
  // Snapshot: Block nur mit Nutzer am Terminal
  T.dock('hafen'); T.sit(0, null);
  ok(!('werft' in g.snapshot()), 'Snapshot ohne Nutzer am Terminal: kein Block werft');
  T.sit(0, 'shop');
  const w = g.snapshot().werft;
  ok(w && w.aktiv === false && w.grund === 'Nur an Flottenbasen' && w.nutzer === 0 && !('preise' in w), 'Snapshot im Lichtkordon: werft { aktiv: false, grund, nutzer } klein ' + JSON.stringify(w));
  T.dock('castra_martis');
  const w2 = g.snapshot().werft;
  ok(w2.aktiv === true && w2.stufe === 0 && w2.waffen['8'] === 'lanze' && w2.waffen['4'] === 'standardbatterie' && w2.frei.stufe === 0 && w2.preise.stufe['1'] === CONFIG.werft.preise.stufe[1], 'Snapshot an Castra Martis: aktiv, Bestückung, Freigeschaltetes, Preise');
  ok(!JSON.stringify(w2).includes('Werft0'), 'kein Spielername im Block (nur Spielerfarbe)');
});

section('Freischalten: einmalig, Reihenfolge, Marken', () => {
  const T = setup('arena_space'); const g = T.g;
  T.dock('castra_martis'); T.sit(0);
  g.inventory.marks = 1000;
  let r = T.cmd(0, 'werft.freischalten', { art: 'stufe', id: 2 });
  ok(!r.ok && r.code === 'stufe_reihenfolge' && g.inventory.marks === 1000 && g.ship.stufe === 0, 'Stufe 2 vor Stufe 1: abgelehnt (stufe_reihenfolge), nichts abgebucht');
  r = T.cmd(0, 'werft.freischalten', { art: 'stufe', id: 1 });
  ok(r.ok && g.inventory.marks === 1000 - CONFIG.werft.preise.stufe[1] && g.ship.stufe === 1 && Werft.liste(g).stufe === 1, `Stufe 1 gekauft (${CONFIG.werft.preise.stufe[1]} Marken), Schiff auf Stufe 1`);
  const m1 = g.inventory.marks;
  r = T.cmd(0, 'werft.freischalten', { art: 'stufe', id: 1 });
  ok(!r.ok && r.code === 'schon_freigeschaltet' && g.inventory.marks === m1, 'Stufe 1 ein zweites Mal: abgelehnt, keine doppelte Abbuchung');
  r = T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'sturmbatterie' });
  ok(r.ok && g.inventory.marks === m1 - CONFIG.werft.preise.waffe.sturmbatterie && Werft.istFrei(g, 'waffe', 'sturmbatterie'), 'Sturmbatterie freigeschaltet');
  const m2 = g.inventory.marks;
  r = T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'sturmbatterie' });
  ok(!r.ok && r.code === 'schon_freigeschaltet' && g.inventory.marks === m2, 'Sturmbatterie zweimal: abgelehnt');
  for (const id of ['lanze', 'standardbatterie']) { r = T.cmd(0, 'werft.freischalten', { art: 'waffe', id }); ok(!r.ok && r.code === 'schon_freigeschaltet' && g.inventory.marks === m2, `Start-Waffe ${id} zählt als freigeschaltet`); }
  for (const id of ['frachtraum', 'krankenstation']) { r = T.cmd(0, 'werft.freischalten', { art: 'modul', id }); ok(!r.ok && r.code === 'schon_freigeschaltet', `Start-Modul ${id} zählt als freigeschaltet`); }
  g.inventory.marks = CONFIG.werft.preise.waffe.abwehrturm - 1;
  r = T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'abwehrturm' });
  ok(!r.ok && r.code === 'zu_wenig_marken' && g.inventory.marks === CONFIG.werft.preise.waffe.abwehrturm - 1 && !Werft.istFrei(g, 'waffe', 'abwehrturm'), 'ein Marke zu wenig: abgelehnt, nichts abgebucht, nichts freigeschaltet');
  g.inventory.marks = CONFIG.werft.preise.waffe.abwehrturm;
  r = T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'abwehrturm' });
  ok(r.ok && g.inventory.marks === 0, 'genau genug Marken: gekauft, Kontostand 0');
  r = T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'katapult' }); ok(!r.ok && r.code === 'unbekannt', 'unbekannte Waffe: abgelehnt');
  r = T.cmd(0, 'werft.freischalten', { art: 'stufe', id: 9 }); ok(!r.ok && r.code === 'unbekannt', 'Stufe 9: abgelehnt');
  r = T.cmd(0, 'werft.freischalten', { art: 'torte', id: 1 }); ok(!r.ok && r.code === 'unbekannt', 'unbekannte Art: abgelehnt');
  // Ort
  g.inventory.marks = 1000; T.dock('hafen');
  r = T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'streubatterie' });
  ok(!r.ok && r.code === 'keine_flottenbasis' && g.inventory.marks === 1000, 'im Lichtkordon: abgelehnt (keine_flottenbasis), nichts abgebucht');
  g.ship.docked = false; g.ship.dockedAt = null;
  r = T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'streubatterie' });
  ok(!r.ok && r.code === 'nicht_angedockt' && g.inventory.marks === 1000, 'im Flug: abgelehnt (nicht_angedockt)');
  // Konsole
  T.dock('castra_martis'); T.sit(0, 'helm');
  r = T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'streubatterie' });
  ok(!r.ok && r.code === null && /Konsole/.test(r.text) && g.inventory.marks === 1000, 'nicht am Terminal: abgelehnt (passende Konsole nötig)');
  // kein Rückgabeweg
  ok(!Protocol.CMD_WERFT.some((c) => /zurueck|verkauf|rueck|sell/i.test(c)) && typeof Werft.zurueckgeben === 'undefined', 'kein Rückgabe- oder Verkaufsbefehl');
  // Ruf-Feld: ohne Ruf-System keine Bedingung, mit Eintrag und System greift es
  g.C.werft.ruf.stufe[2] = 'zenturio';
  T.sit(0); T.dock('castra_martis');
  ok(Werft.freischaltenPruefen(g, 'stufe', 2) === null, 'Ruf-Feld an Stufe 2 ohne Ruf-System: keine Bedingung');
  g.rufErreicht = () => false;
  ok((Werft.freischaltenPruefen(g, 'stufe', 2) || {}).code === 'ruf', 'Ruf-Feld mit Ruf-System und fehlendem Rang: abgelehnt');
  delete g.rufErreicht; delete g.C.werft.ruf.stufe[2];
});

section('Umbauen: gratis, sofort, nur angedockt, Validierung', () => {
  const T = setup('arena_space'); const g = T.g;
  T.dock('castra_martis'); T.sit(0);
  g.inventory.marks = 2000;
  const sicht0 = () => g.inventory.marks;
  let r = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'standardbatterie' });
  ok(!r.ok && r.code === 'platz_gesperrt', 'Platz 7 auf Stufe 0: gesperrt');
  T.cmd(0, 'werft.freischalten', { art: 'stufe', id: 1 });
  let m = sicht0();
  r = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'sturmbatterie' });
  ok(!r.ok && r.code === 'nicht_freigeschaltet' && Waffen.waffenMap(g)[7] === undefined, 'Sturmbatterie vor dem Kauf: abgelehnt (nicht_freigeschaltet)');
  r = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'standardbatterie' });
  ok(r.ok && sicht0() === m && Waffen.waffenMap(g)[7] === 'standardbatterie', 'Standardbatterie (Start-Waffe) auf Platz 7: gratis, sofort');
  ok(g.ship.mount.p7 && Waffen.mountIds(g).join() === 'bow,port,stbd,p7', 'Mount p7 steht sofort (Ladepool kennt die vierte Waffe)');
  T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'sturmbatterie' }); m = sicht0();
  r = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'sturmbatterie' });
  ok(r.ok && sicht0() === m && Waffen.waffenMap(g)[7] === 'sturmbatterie' && g.snapshot().ship.mounts.find((q) => q.id === 'p7').typ === 'sturmbatterie', 'Platz 7 auf Sturmbatterie umgebaut: gratis, Snapshot mounts p7 typ');
  r = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'sturmbatterie' });
  ok(!r.ok && r.code === 'unveraendert', 'derselbe Umbau noch einmal: unveraendert');
  r = T.cmd(0, 'werft.umbau', { platz: 8, waffe: 'sturmbatterie' });
  ok(!r.ok && r.code === 'platzart' && Waffen.waffenMap(g)[8] === 'lanze', 'Seitenwaffe auf Bugplatz 8: abgelehnt (platzart)');
  r = T.cmd(0, 'werft.umbau', { platz: 4, waffe: 'lanze' });
  ok(!r.ok && r.code === 'platzart', 'Lanze (Bug) auf Seitenplatz 4: abgelehnt');
  r = T.cmd(0, 'werft.umbau', { platz: 12, waffe: 'lanze' }); ok(!r.ok && r.code === 'platz_unbekannt', 'Platz 12: abgelehnt');
  r = T.cmd(0, 'werft.umbau', { platz: 4, waffe: 'zauberstab' }); ok(!r.ok && r.code === 'unbekannt', 'unbekannte Waffe: abgelehnt');
  // Bug: Standardkanone auf Platz 8 (Platz 8 darf Bug-Waffen laut Katalog)
  T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'standardkanone' }); m = sicht0();
  r = T.cmd(0, 'werft.umbau', { platz: 8, waffe: 'standardkanone' });
  ok(r.ok && sicht0() === m && Waffen.waffenMap(g)[8] === 'standardkanone', 'Standardkanone auf Platz 8 (Bug): gratis');
  r = T.cmd(0, 'werft.umbau', { platz: 8, waffe: 'lanze' }); ok(r.ok && Waffen.waffenMap(g)[8] === 'lanze', 'zurück auf die Lanze: gratis');
  // Torpedo nur Heck (Platz 2, Stufe 2)
  T.cmd(0, 'werft.freischalten', { art: 'waffe', id: 'torpedowerfer' });
  r = T.cmd(0, 'werft.umbau', { platz: 2, waffe: 'torpedowerfer' }); ok(!r.ok && r.code === 'platz_gesperrt', 'Torpedowerfer auf Heck 2 vor Stufe 2: gesperrt');
  T.cmd(0, 'werft.freischalten', { art: 'stufe', id: 2 });
  r = T.cmd(0, 'werft.umbau', { platz: 2, waffe: 'torpedowerfer' }); ok(r.ok && Waffen.waffenMap(g)[2] === 'torpedowerfer', 'Torpedowerfer auf Heck 2 (Stufe 2)');
  r = T.cmd(0, 'werft.umbau', { platz: 5, waffe: 'torpedowerfer' }); ok(!r.ok && r.code === 'platzart', 'Torpedowerfer auf Bug 5: abgelehnt');
  r = T.cmd(0, 'werft.umbau', { platz: 2 }); ok(r.ok && Waffen.waffenMap(g)[2] === undefined, 'Platz 2 leeren (waffe fehlt = leer)');
  // nur angedockt, nur an Flottenbasis
  T.dock('hafen'); m = werftSicht(g);
  r = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'standardbatterie' });
  ok(!r.ok && r.code === 'keine_flottenbasis' && werftSicht(g) === m, 'Umbau im Lichtkordon: abgelehnt, nichts verändert');
  g.ship.docked = false; g.ship.dockedAt = null;
  r = T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'standardbatterie' });
  ok(!r.ok && r.code === 'nicht_angedockt' && werftSicht(g) === m, 'Umbau im Flug: abgelehnt (nicht_angedockt) mit Grund-Text: ' + r.text);
  ok(Protocol.WERFT_CODES.includes('nicht_angedockt') && Protocol.WERFT_CODES.includes('platzart') && Protocol.WERFT_CODES.includes('zu_wenig_marken'), 'Protocol.WERFT_CODES nennt die Codes');
});

section('Module: Modulräume, mehrfach, Energie, Fracht', () => {
  const T = setup('arena_space'); const g = T.g;
  T.dock('castra_martis'); T.sit(0);
  g.inventory.marks = 2000;
  let r = T.cmd(0, 'werft.modul', { raum: 3, id: 'frachtraum' });
  ok(!r.ok && r.code === 'raum_gesperrt', 'Modulraum 3 auf Stufe 0: gesperrt');
  T.cmd(0, 'werft.freischalten', { art: 'stufe', id: 1 });
  r = T.cmd(0, 'werft.modul', { raum: 3, id: 'werkstatt' }); ok(!r.ok && r.code === 'nicht_freigeschaltet', 'Werkstatt vor dem Kauf: abgelehnt');
  r = T.cmd(0, 'werft.modul', { raum: 3, id: 'frachtraum' });
  ok(r.ok && Modul.liste(g).map((q) => q.id + q.raum).join() === 'frachtraum1,krankenstation2,frachtraum3', 'zweiter Frachtraum in Raum 3 (gleiche Module mehrfach, gratis)');
  ok(g.ship.power.engines + g.ship.power.shields + g.ship.power.weapons === 5 && Fracht.capacity(g) === 4, 'Energie: 3 Module -> 5 für die Hauptsysteme, Frachtkapazität 4');
  T.cmd(0, 'werft.freischalten', { art: 'modul', id: 'werkstatt' }); const m = g.inventory.marks;
  r = T.cmd(0, 'werft.modul', { raum: 3, id: 'werkstatt' });
  require('../server/sim/bots.js').ensureBotCount(g);   // sonst im nächsten Tick (der Test dockt künstlich, der Flug läuft nicht)
  ok(r.ok && g.inventory.marks === m && Modul.liste(g).find((q) => q.raum === 3).id === 'werkstatt' && g.bots.length === 2, 'Raum 3: Frachtraum gegen Werkstatt getauscht, zweiter Schrauber da ');
  r = T.cmd(0, 'werft.modul', { raum: 3, id: 'werkstatt' }); ok(!r.ok && r.code === 'unveraendert', 'gleiches Modul im selben Raum: unveraendert');
  r = T.cmd(0, 'werft.modul', { raum: 4, id: 'frachtraum' }); ok(!r.ok && r.code === 'raum_gesperrt', 'Raum 4 auf Stufe 1: gesperrt');
  T.cmd(0, 'werft.freischalten', { art: 'stufe', id: 2 });
  r = T.cmd(0, 'werft.modul', { raum: 4, id: 'werkstatt' }); ok(r.ok && Modul.liste(g).length === 4, 'Raum 4 mit zweiter Werkstatt: vier Module');
  r = T.cmd(0, 'werft.modul', { raum: 4, id: 'leer' }); ok(r.ok && Modul.liste(g).length === 3 && g.ship.power.weapons >= 1, 'Raum 4 leeren: drei Module');
  r = T.cmd(0, 'werft.modul', { raum: 4 }); ok(!r.ok && r.code === 'unveraendert', 'Raum 4 noch einmal leeren: unveraendert');
  ok(JSON.stringify(g.snapshot().werft.module) === '{"1":"frachtraum","2":"krankenstation","3":"werkstatt","4":null}', 'Snapshot werft.module: leerer Modulraum 4 als null ' + JSON.stringify(g.snapshot().werft.module));
  ok(game0().C.module.ids.every((id) => Katalog.MODUL_WIRKUNG[id] && Katalog.MODUL_NAMEN[id]), 'Katalog: Name und Wirkungssatz für jedes Modul');
  function game0() { return { C: CONFIG }; }
  r = T.cmd(0, 'werft.modul', { raum: 7, id: 'frachtraum' }); ok(!r.ok && r.code === 'raum_unbekannt', 'Raum 7: abgelehnt');
  // Fracht: ein Frachtraum geht nur, wenn die Ladung danach Platz hat
    const T2 = setup('arena_space'); const h = T2.g; T2.dock('castra_martis'); T2.sit(0); h.inventory.marks = 500;
  h.fracht.lager.push({ art: 'fracht' }, { art: 'fracht' });
  r = T2.cmd(0, 'werft.modul', { raum: 1, id: 'krankenstation' });
  ok(!r.ok && r.code === 'fracht_belegt' && Modul.finde(h, 'frachtraum', 1), 'letzten Frachtraum mit Ladung an Bord entfernen: abgelehnt (fracht_belegt)');
  h.fracht.lager.length = 0;
  r = T2.cmd(0, 'werft.modul', { raum: 1, id: 'leer' }); ok(r.ok && Modul.liste(h).length === 1, 'ohne Ladung geht der Frachtraum');
  // nur angedockt an der Basis
  T2.dock('hafen'); r = T2.cmd(0, 'werft.modul', { raum: 1, id: 'frachtraum' }); ok(!r.ok && r.code === 'keine_flottenbasis', 'Modulumbau im Lichtkordon: abgelehnt');
});

section('Mehrspieler: Rennen und Terminal', () => {
  const T = setup('arena_space', { players: 3 }); const g = T.g;
  T.dock('castra_martis');
  for (const i of [0, 1, 2]) T.sit(i);   // erzwungen: alle drei an der Konsole (Server-Reihenfolge entscheidet, nicht die UI)
  const preis = CONFIG.werft.preise.waffe.abwehrturm;
  g.inventory.marks = preis * 2 + 10;   // würde für zwei Käufe reichen: eine doppelte Abbuchung wäre sichtbar
  const rs = [0, 1, 2].map((i) => T.cmd(i, 'werft.freischalten', { art: 'waffe', id: 'abwehrturm' }));
  ok(rs.filter((r) => r.ok).length === 1 && rs.filter((r) => r.code === 'schon_freigeschaltet').length === 2, 'drei Spieler kaufen dasselbe: einer kauft, zwei bekommen schon_freigeschaltet');
  ok(g.inventory.marks === preis + 10, `Marken einmal abgebucht (${g.inventory.marks} = ${preis + 10})`);
  // alle Spieler bedienen, jede Farbe darf; kein Captain-Vorbehalt (Spieler 2 ist nicht der erste)
  g.inventory.marks = 500;
  const r2 = T.cmd(2, 'werft.freischalten', { art: 'stufe', id: 1 });
  ok(r2.ok && g.ship.stufe === 1, 'der dritte Spieler schaltet Stufe 1 frei (keine Rollenbindung)');
  const r1 = T.cmd(1, 'werft.umbau', { platz: 7, waffe: 'standardbatterie' });
  ok(r1.ok && Waffen.waffenMap(g)[7] === 'standardbatterie', 'der zweite Spieler baut um');
  // Zustand serverseitig: alle sehen dasselbe
  const sn = g.snapshot();
  ok(sn.werft && sn.werft.stufe === 1 && sn.werft.waffen['7'] === 'standardbatterie' && sn.werft.frei.waffen.includes('abwehrturm'), 'Snapshot zeigt allen den gemeinsamen Stand');
  ok(sn.werft.nutzer === g.players.find((p) => p.console === 'shop').color, 'nutzer = Farbe des Spielers am Terminal');
  // Terminal exklusiv wie die Konsolen (interior.consoleOccupant über interactionsAt): wer davor steht, sieht „besetzt“, solange ein anderer dort sitzt
  const interior = require('../server/sim/interior.js');
  let tt = null;
  for (let y = 0; y < Maps.ship.h && !tt; y++) for (let x = 0; x < Maps.ship.w && !tt; x++) if (Maps.ship.info(x, y).console === 'shop') tt = { x, y };
  const stehen = (i) => interior.interactionsAt(g, g.players[i], tt.x, tt.y, true).find((q) => q.kind === 'console');
  for (const i of [0, 1, 2]) T.sit(i, null);
  ok(tt && stehen(1) && stehen(1).console === 'shop' && !stehen(1).blocked, 'Terminal (Handelskonsole) im Meetingraum: frei, wenn niemand sitzt');
  T.sit(0, 'shop');
  ok(stehen(1) && /besetzt/.test(stehen(1).blocked || ''), 'Spieler 0 sitzt: Spieler 1 sieht "Konsole besetzt", Spieler 0 selbst nicht gesperrt: ' + (stehen(1) || {}).blocked);
  T.sit(0, null);
});

section('Vorschau: Energie, Ladepunkte, Seiten vorher/nachher', () => {
  const T = setup('arena_space'); const g = T.g;
  T.dock('castra_martis'); T.sit(0); g.inventory.marks = 3000;
  T.debug('werft', 'freischalten alle');
  T.debug('werft', 'reset');
  let v = Werft.vorschau(g, { art: 'stufe', id: 1 });
  const vor0 = werftSicht(g);
  ok(v.moeglich && v.frei === false && v.kosten === CONFIG.werft.preise.stufe[1] && v.jetzt === true, 'Stufe 1 vor dem Kauf: möglich, nicht frei, Kosten ' + v.kosten);
  ok(v.vorher.seiten.vorn.length === 1 && v.nachher.seiten.Bb.length === 1, 'Seiten vorher/nachher (Bestückung beider Seiten) ' + JSON.stringify(v.nachher.seiten));
  for (const a of [{ art: 'waffe', platz: 4, id: 'sturmbatterie' }, { art: 'modul', raum: 2, id: 'werkstatt' }, { art: 'stufe', id: 3 }]) Werft.vorschau(g, a);
  ok(werftSicht(g) === vor0, 'Vorschau ändert nichts am Schiff (Stufe, Bestückung, Module, Freigeschaltetes, Marken)');
  // gegen den echten Umbau vergleichen: Stufe, Waffen, Module
  const vergleiche = (aenderung, tat, text) => {
    const p = Werft.vorschau(g, aenderung);
    const vorher = JSON.stringify(Werft.vorschau(g, { art: 'stufe', id: 9 }).vorher);   // Ist-Zustand
    ok(p.moeglich, text + ': Vorschau möglich ' + (p.text || ''));
    tat();
    const nach = {
      energie: { reaktor: g.C.power.reactor, module: Modul.anzahlAn(g), frei: g.C.power.reactor - Modul.energieWunsch(g), engines: g.ship.power.engines, shields: g.ship.power.shields, weapons: g.ship.power.weapons },
      ladepunkte: Waffen.chargePoints(g),
    };
    ok(JSON.stringify(p.nachher.energie) === JSON.stringify(nach.energie), text + ': Energiepool nachher stimmt ' + JSON.stringify(p.nachher.energie) + ' = ' + JSON.stringify(nach.energie));
    ok(p.nachher.ladepunkte === nach.ladepunkte, text + `: Ladepunkte nachher ${p.nachher.ladepunkte} = ${nach.ladepunkte}`);
    const std = Waffen.standardVerteilung(g); const al = {}; for (const id of Object.keys(std)) al[Katalog.platzVonMount(id)] = std[id];
    ok(JSON.stringify(p.nachher.alloc) === JSON.stringify(al), text + ': Verteilung der Ladepunkte nachher stimmt ' + JSON.stringify(al));
    const ist = Werft.vorschau(g, { art: 'stufe', id: 9 }).vorher;
    ok(JSON.stringify(p.nachher.seiten) === JSON.stringify(ist.seiten) && JSON.stringify(p.nachher.module) === JSON.stringify(ist.module), text + ': Seitenbestückung und Module nachher stimmen');
    return { p, vorher };
  };
  g.inventory.marks = 3000;
  vergleiche({ art: 'stufe', id: 1 }, () => ok(T.cmd(0, 'werft.freischalten', { art: 'stufe', id: 1 }).ok, 'Stufe 1 gekauft'), 'Stufe 1');
  T.debug('werft', 'freischalten alle');
  vergleiche({ art: 'waffe', platz: 7, id: 'streubatterie' }, () => T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'streubatterie' }), 'Waffe Platz 7 Streubatterie');
  vergleiche({ art: 'waffe', platz: 9, id: 'lanzenbatterie' }, () => T.cmd(0, 'werft.umbau', { platz: 9, waffe: 'lanzenbatterie' }), 'Waffe Platz 9 Lanzenbatterie');
  T.debug('ausbau', '2');
  vergleiche({ art: 'waffe', platz: 2, id: 'abwehrturm' }, () => T.cmd(0, 'werft.umbau', { platz: 2, waffe: 'abwehrturm' }), 'Abwehrturm Heck (reserviert einen Punkt)');
  vergleiche({ art: 'waffe', platz: 5, id: 'standardkanone' }, () => T.cmd(0, 'werft.umbau', { platz: 5, waffe: 'standardkanone' }), 'Standardkanone Bug 5');
  vergleiche({ art: 'modul', raum: 3, id: 'werkstatt' }, () => T.cmd(0, 'werft.modul', { raum: 3, id: 'werkstatt' }), 'Modul Raum 3 Werkstatt');
  const pm = Werft.vorschau(g, { art: 'modul', raum: 4, id: 'frachtraum' });
  ok(pm.nachher.energie.module === pm.vorher.energie.module + 1 && pm.nachher.energie.frei === pm.vorher.energie.frei - 1 && pm.nachher.energie.weapons <= pm.vorher.energie.weapons, 'Modul bei der Vorschau: ein Modul mehr zieht 1 Energie (Hauptsysteme bekommen weniger) ' + JSON.stringify(pm.nachher.energie));
  vergleiche({ art: 'modul', raum: 4, id: 'frachtraum' }, () => T.cmd(0, 'werft.modul', { raum: 4, id: 'frachtraum' }), 'Modul Raum 4 Frachtraum');
  vergleiche({ art: 'modul', raum: 4, id: 'leer' }, () => T.cmd(0, 'werft.modul', { raum: 4, id: 'leer' }), 'Raum 4 leeren');
  // Befehl werft.vorschau: Antwort an den Absender, nichts ändert sich
  { const vor = werftSicht(g); T.conns[0].inbox.length = 0; T.send(0, { t: 'cmd', c: 'werft.vorschau', art: 'waffe', platz: 7, id: 'sturmbatterie' });
    const ev = T.conns[0].inbox.find((m) => m.kind === 'werftVorschau');
    ok(ev && ev.vorschau.moeglich && ev.vorschau.nachher.seiten && werftSicht(g) === vor, 'Befehl werft.vorschau liefert werftVorschau, Schiff unverändert'); }
  // Fehler in der Vorschau
  v = Werft.vorschau(g, { art: 'waffe', platz: 8, id: 'sturmbatterie' }); ok(!v.moeglich && v.code === 'platzart', 'Vorschau Seitenwaffe auf Bug: nicht möglich (platzart)');
  v = Werft.vorschau(g, { art: 'torte' }); ok(!v.moeglich && v.code === 'unbekannt', 'Vorschau unbekannte Art: nicht möglich');
  // nicht freigeschaltet: Vorschau geht trotzdem, jetzt=false mit Grund
  T.debug('werft', 'reset');
  v = Werft.vorschau(g, { art: 'waffe', platz: 7, id: 'sturmbatterie' });
  ok(v.moeglich && v.frei === false && v.kosten === CONFIG.werft.preise.waffe.sturmbatterie && v.jetzt === false && v.code === 'nicht_freigeschaltet', 'Vorschau einer ungekauften Waffe: möglich, Kosten, jetzt=false (nicht_freigeschaltet)');
  T.dock('hafen');
  v = Werft.vorschau(g, { art: 'waffe', platz: 7, id: 'standardbatterie' });
  ok(v.moeglich && v.jetzt === false && v.code === 'keine_flottenbasis', 'Vorschau im Lichtkordon: möglich, aber jetzt=false (keine_flottenbasis)');
});

section('Weltstand: Roundtrip und Altstände', () => {
  const dir = freshDir();
  const T = setup('free', { dir });
  T.run(0.3);
  const g = T.g; const id = g.weltstand.id;
  T.dock('castra_martis'); T.sit(0); g.inventory.marks = 2000;
  for (const [a, i] of [['stufe', 1], ['stufe', 2], ['waffe', 'sturmbatterie'], ['waffe', 'abwehrturm'], ['modul', 'werkstatt']]) ok(T.cmd(0, 'werft.freischalten', { art: a, id: i }).ok, `kaufen ${a} ${i}`);
  ok(T.cmd(0, 'werft.umbau', { platz: 7, waffe: 'sturmbatterie' }).ok && T.cmd(0, 'werft.umbau', { platz: 2, waffe: 'abwehrturm' }).ok && T.cmd(0, 'werft.modul', { raum: 3, id: 'werkstatt' }).ok, 'umbauen');
  const marks = g.inventory.marks;
  const vorher = werftSicht(g);
  T.send(0, { t: 'menu', op: 'end' });
  const file = path.join(dir, id + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(Weltstand.validate(data).length === 0, 'Stand ist schema-gültig ' + (Weltstand.validate(data)[0] || ''));
  ok(data.version === 3 && data.schiff.stufe === 2 && data.schiff.freigeschaltet.stufe === 2 && data.schiff.freigeschaltet.waffen.includes('sturmbatterie') && data.schiff.freigeschaltet.module.includes('werkstatt'), 'Format 3 mit schiff.freigeschaltet ' + JSON.stringify(data.schiff.freigeschaltet));
  const L = setup('free', { dir, world: id }); L.run(0.3);
  const h = L.g;
  ok(werftSicht(h) === vorher.replace(/"marks":\d+/, '"marks":' + h.inventory.marks) && h.inventory.marks === marks, 'Laden ergibt dasselbe Schiff: Stufe, Bestückung, Module, Freigeschaltetes, Marken ' + h.ship.stufe);
  ok(h.snapshot().ship.mounts.find((q) => q.id === 'p7').typ === 'sturmbatterie' && h.snapshot().ship.mod.length === 3, 'Snapshot nach dem Laden: Sturmbatterie auf 7, drei Module');
  // idempotent: noch einmal speichern und laden
  const sichtH = werftSicht(h);
  L.send(0, { t: 'menu', op: 'end' });
  const L2 = setup('free', { dir, world: id }); L2.run(0.3);
  ok(werftSicht(L2.g) === sichtH && L2.g.inventory.marks === marks, 'zweiter Durchgang: unverändert (keine Erstattung, nichts doppelt)');
  // Altstand ohne schiff.freigeschaltet (Paket A/B/C, main): was am Schiff steckt, gilt als freigeschaltet
  const alt = JSON.parse(JSON.stringify(data)); delete alt.schiff.freigeschaltet;
  fs.writeFileSync(file, JSON.stringify(alt));
  const A = setup('free', { dir, world: id }); A.run(0.3); const a = A.g;
  const fa = Werft.toSave(a);
  ok(fa.stufe === 2 && fa.waffen.includes('sturmbatterie') && fa.waffen.includes('abwehrturm') && fa.module.includes('werkstatt') && fa.waffen.includes('lanze') && fa.module.includes('krankenstation'), 'Altstand ohne Feld: abgeleitet aus Stufe, Bestückung, Modulen ' + JSON.stringify(fa));
  ok(a.inventory.marks === marks && a.ship.stufe === 2, 'Altstand: keine Erstattung, Marken unverändert');
  ok(!Werft.istFrei(a, 'waffe', 'streubatterie') && Werft.freischaltenPruefen(a, 'waffe', 'streubatterie') === null, 'Altstand: der Rest bleibt kaufbar (Streubatterie)');
  // Altstand main: kein stufe/waffen/module/freigeschaltet -> Start
  const main = JSON.parse(JSON.stringify(data)); delete main.schiff.freigeschaltet; delete main.schiff.stufe; delete main.schiff.waffen; delete main.schiff.module;
  fs.writeFileSync(file, JSON.stringify(main));
  const M = setup('free', { dir, world: id }); M.run(0.3); const mg = M.g;
  const fm = Werft.toSave(mg);
  ok(fm.stufe === 0 && fm.waffen.slice().sort().join() === 'lanze,standardbatterie' && fm.module.slice().sort().join() === 'frachtraum,krankenstation', 'Altstand von main: Start-Freischaltung ' + JSON.stringify(fm));
  // Altstand pan01-c: Stufe und Waffen, ohne freigeschaltet
  const c3 = JSON.parse(JSON.stringify(data)); delete c3.schiff.freigeschaltet; c3.schiff.waffen = { 8: 'standardkanone', 4: 'streubatterie', 6: 'standardbatterie', 2: 'torpedowerfer' }; c3.schiff.stufe = 2;
  fs.writeFileSync(file, JSON.stringify(c3));
  const C = setup('free', { dir, world: id }); C.run(0.3);
  const fc = Werft.toSave(C.g);
  ok(fc.stufe === 2 && ['standardkanone', 'streubatterie', 'torpedowerfer', 'lanze', 'standardbatterie'].every((w) => fc.waffen.includes(w)), 'Altstand Paket C: Waffen auf den Plätzen sind freigeschaltet ' + JSON.stringify(fc.waffen));
  // Unfug im Block wird gekappt
  const bad = JSON.parse(JSON.stringify(data)); bad.schiff.freigeschaltet.stufe = 7;
  ok(Weltstand.validate(bad).length > 0, 'Schema lehnt freigeschaltet.stufe 7 ab');
  const R = new Game({ noStore: true, seed: 3, log: () => {} });
  Werft.restore(R, { stufe: 9, waffen: ['quatsch', 'abwehrturm'], module: ['x', 'werkstatt'] });
  ok(Werft.toSave(R).stufe === 3 && !Werft.toSave(R).waffen.includes('quatsch') && Werft.toSave(R).waffen.includes('abwehrturm') && !Werft.toSave(R).module.includes('x'), 'restore kappt Stufe und verwirft unbekannte Ids');
  Werft.restore(R, null); ok(Werft.toSave(R).stufe === 0 && Werft.toSave(R).waffen.length === 2, 'restore(null): Start');
});

section('Handel: Torpedo-Munition und alte Artikel', () => {
  const T = setup('arena_space'); const g = T.g;
  T.dock('hafen'); T.sit(0); g.inventory.marks = 500;
  let gekauft = 0;
  for (let i = 0; i < 10; i++) { const r = T.cmd(0, 'shop.buy', { item: 'bolzen' }); if (!r.text) gekauft++; }
  ok(g.inventory.bolzen === Katalog.TORPEDO.lagerMax && gekauft === Katalog.TORPEDO.lagerMax - CONFIG.economy.startInventory.bolzen && g.inventory.marks === 500 - gekauft * 10, `Torpedos nur bis Lager ${Katalog.TORPEDO.lagerMax} (${gekauft} gekauft, 10 Marken je Stück)`);
  const r = T.cmd(0, 'shop.buy', { item: 'bolzen' });
  ok(/Lager voll/.test(r.text) && g.inventory.marks === 500 - gekauft * 10, 'Torpedo über dem Lager: "Lager voll", nichts abgebucht');
  const ids = CONFIG.shop.map((s) => s.id);
  ok(!['seitenturm', 'schildpool', 'bot2', 'bolzenwerfer', 'schrauber3'].some((x) => ids.includes(x)), 'Shop-Sortiment ohne seitenturm, schildpool, bot2, bolzenwerfer');
  const sn = JSON.stringify(g.snapshot());
  ok(!/seitenturm|schildpool|bot2|bolzenwerfer/.test(sn), 'Snapshot ohne die alten Artikel');
  ok(CONFIG.shop.every((s) => ['gear', 'item', 'deko'].includes(s.kind)), 'Shop verkauft nur Stückgut, Ausrüstung und Deko (kein upgrade)');
});

section('Preise und Katalog', () => {
  const P = CONFIG.werft.preise;
  ok(Katalog.WAFFEN.every((w) => !('preis' in w)), 'Katalog ohne preis-Feld (Preise nur in CONFIG.werft)');
  const start = Werft.startFrei({ C: CONFIG });
  ok(start.stufe === 0 && start.waffen.slice().sort().join() === 'lanze,standardbatterie' && start.module.join() === 'frachtraum,krankenstation', 'Start-Lerche besitzt Stufe 0, Lanze, Standardbatterie, Frachtraum, Krankenstation');
  const fremd = Katalog.WAFFEN.map((w) => w.id).filter((id) => !start.waffen.includes(id));
  ok(fremd.every((id) => Number.isInteger(P.waffe[id]) && P.waffe[id] > 0) && Object.keys(P.waffe).every((id) => Katalog.waffe(id) && !start.waffen.includes(id)), 'jede nicht freigeschaltete Waffe hat genau einen Preis: ' + fremd.join(' '));
  ok(CONFIG.module.ids.filter((id) => !start.module.includes(id)).every((id) => P.modul[id] > 0), 'Werkstatt hat einen Preis');
  ok([1, 2, 3].every((i) => P.stufe[i] > 0) && P.stufe[1] < P.stufe[2] && P.stufe[2] < P.stufe[3], 'Stufenpreise steigen: ' + [1, 2, 3].map((i) => P.stufe[i]).join(' / '));
  // Messung der Kette (CONTRACT-PAN01-D §4): Castra Martis in Kapitel 5/6, schwächster Lauf (Crew 3) 420 Marken
  const KETTE_MIN = 420;
  ok(P.stufe[1] + P.stufe[2] + P.waffe.sturmbatterie + P.waffe.abwehrturm <= KETTE_MIN, `Kampagne: Stufe 1 + 2 + Sturmbatterie + Abwehrturm = ${P.stufe[1] + P.stufe[2] + P.waffe.sturmbatterie + P.waffe.abwehrturm} <= ${KETTE_MIN} Marken an Castra Martis`);
  ok(P.stufe[1] + P.stufe[2] + P.stufe[3] > 640 && P.stufe[3] > KETTE_MIN, 'Stufe 3 liegt über allem, was die Kampagne an Castra Martis einbringt (freies Spiel)');
  ok(Werft.sortiment(g0()).length === 3 + Katalog.WAFFEN.length + CONFIG.module.ids.length, 'Sortiment: 3 Stufen + alle Waffen + alle Module');
  function g0() { return { C: CONFIG }; }
});

section('Snapshot-Budget', () => {
  const T = setup('arena_space', { players: 3 }); const g = T.g;
  T.dock('castra_martis'); T.sit(0);
  const w = g.snapshot().werft;
  ok(sizeOf(w) <= 700, `Werft-Block frisch (Stufe 0, alles unfrei): ${sizeOf(w)} B`);
  T.debug('werft', 'freischalten alle'); T.debug('bestueck', 'alle 3');
  const wv = g.snapshot().werft;
  ok(sizeOf(wv) <= 700, `Werft-Block voll ausgebaut: ${sizeOf(wv)} B`);
  T.dock('hafen'); ok(sizeOf(g.snapshot().werft) < 120, `gesperrt (Lichtkordon): ${sizeOf(g.snapshot().werft)} B`);
  ok(sizeOf(g.snapshot()) < CONFIG.net.snapMax - CONFIG.net.snapLuft, `Snapshot mit Block ${sizeOf(g.snapshot())} B unter snapMax - snapLuft`);
});

section('Debug', () => {
  const T = setup('arena_space'); const g = T.g;
  ok(T.debug('marken', '777').length === 0 && g.inventory.marks === 777, 'marken 777');
  ok(T.debug('marks', '12').length === 0 && g.inventory.marks === 12, 'marks 12 (Altname)');
  ok(T.debug('werft', 'freischalten alle').length === 0 && Werft.liste(g).stufe === 3 && Werft.istFrei(g, 'waffe', 'torpedowerfer') && Werft.istFrei(g, 'modul', 'werkstatt') && g.ship.stufe === 0, 'werft freischalten alle (Stufe des Schiffs bleibt, Debug ausbau)');
  ok(T.debug('werft', 'reset').length === 0 && Werft.liste(g).stufe === 0 && !Werft.istFrei(g, 'waffe', 'torpedowerfer'), 'werft reset');
  ok(T.debug('werft', 'status').length === 0, 'werft status');
  ok(Protocol.DEBUG_CMDS.includes('werft') && Protocol.DEBUG_CMDS.includes('marken'), 'Protocol.DEBUG_CMDS: werft, marken');
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`\ntest-werft: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
