'use strict';
// OPS-01 Paket D: Beam-Hinweis mit Mini-Karte im Zielkasten. Wird ein Ziel mit Landepunkt/Beamzone (beam { x, y, range }) im Zielkasten angezeigt UND ist der Landepunkt gescannt
// (Ops: Taste L halten, server/sim/lpscan.js, Regeln unverändert), steht dort „BEAMEN MÖGLICH“ und eine kleine Karte des Landepunkts. Der Zielkasten ist EINE Funktion für Ops und Captain
// (Consoles.pultZielkasten); die Verknüpfung Ziel ↔ Landepunkt macht EINE Funktion (Consoles.beamInfo), die Karte kommt aus derselben Quelle wie der Planungstisch.
//   (a) Ziel mit Landepunkt, ungescannt: kein Hinweis, keine Mini-Karte (Server-Szenen b7 und methalle, echter Snapshot)
//   (b) nach dem Scan über den echten Weg (cmd weapons.landescan, 4 s halten): Hinweis und Mini-Karte, Kartenid = die des Planungstischs (locAwayMap bzw. world.locations[].lp)
//   (c) Ziel ohne beam (Gegner fern vom Beam-Punkt, Landepunkt ohne beam im Snapshot, Ort ohne Scan): nie Hinweis; (b) enthält die Regeln von R3: nur Hauptobjekt/versteckte Objekte gehören zum Landepunkt (Gegner am Beam-Punkt: kein Hinweis), Mehrdeutigkeit mehrerer Landepunkte am selben Beam-Punkt
//   (d) Ops-Ziel UND Captain-Anzeigeziel: dieselbe Funktion beamInfo, dieselbe Zeichenfunktion
//   (e) Quelltext: keine zweite Kartenkopie (kein Kartenfeld im Snapshot, drawMiniKarte nutzt mapById und die Kachelfarbe des Planungstischs, kein KartenAnsicht-Zustand)
//   (f) Ops-Zielkasten für ein Gegner-Ziel unverändert (Referenz tools/test-captain-zielkasten.js)
//   (g) Snapshot ohne Scan ohne lp-Feld; mit Scan nur { id, name, x, y } je gescanntem Landepunkt
//   (h) Gegenprobe: ohne Prüfung des Scanstands (Mutation im Quelltext der Umgebung) erscheint der Hinweis vor dem Scan – der Test erkennt das
//   node tools/test-beam-hinweis.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Lpscan = require('../server/sim/lpscan.js');
const ROOT = path.join(__dirname, '..');
const DATEN = require('../content/kampf/gegner-systeme.json');
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, body) => { console.log('\n[' + t + ']'); try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 6).join(' | ')); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');   // Quelldateien sind CRLF

// ---------------------------------------------------------------------------------------------------------------------------------
// Client-Umgebung: echte Skripte, Zeichenfläche mit Aufzeichnung (Texte, drawImage = Mini-Karte aus dem Zwischenspeicher)
function neueFlaeche() {
  const rec = { texte: [], bilder: 0 };
  const st = { fillStyle: '#000', strokeStyle: '#000' };
  const f = { __rec: rec, fillText(s, x, y) { rec.texte.push([String(s), Math.round(x), Math.round(y)]); }, drawImage() { rec.bilder++; }, measureText: (s) => ({ width: String(s).length * 5 }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) };
  const ctx = new Proxy(f, { get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { st[k] = v; return true; } });
  return { ctx, rec };
}
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
function umgebung(ersetze) {
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
    Shared_Schilde: require('../shared/schilde.js'), Shared_Locations: require('../shared/locations.js'), CONFIG: require('../shared/config.js'),
    document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null, addEventListener() {} },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' }, URLSearchParams,
    localStorage: { getItem: () => null, setItem() {} } };
  win.window = win; win.self = win;
  vm.createContext(win);
  win.__fehler = [];
  win.Net = { guard: (w, f, d) => { try { return f(); } catch (e) { win.__fehler.push(w + ': ' + e.message); return d; } }, reportError(w, e) { win.__fehler.push(w + ': ' + (e && e.message)); } };
  win.Hud = new Proxy({}, { get: () => () => 0 });
  for (const f of ['kennung.js', 'render.js', 'pult-systeme-tokens.js', 'zonenkreuz.js', 'zielsysteme.js', 'kartenlogik.js', 'pult.js', 'consoles.js', 'pult-stationen.js']) {
    let q = read('public/js/' + f); if (ersetze && ersetze[f]) q = ersetze[f](q);
    vm.runInContext(q, win, { filename: f });
  }
  win.Zielsysteme.store.daten = DATEN;
  return win;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Server: Szene betreten, scannen über den echten Weg, echter Snapshot (mit world.locations) und awayMap-Ereignisse
function setup() {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 1500) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'B0', name: 'Bm', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
  g.handleMessage(c, { t: 'ready', ready: true });
  g.god = true;
  const T = { g, c, run: (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); }, cmd: (cmd, f) => { g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); } };
  return T;
}
// Snapshot mit Ortsliste: so lange abrufen, bis world.locations dabei ist (Slot 5 bzw. nach Änderung)
function snapMitOrten(g) {
  g.sentExploreVersion = -1;
  for (let i = 0; i < (CONFIG.net.asteroidSnapEvery || 15) + 2; i++) { const s = g.snapshot(); if (s.world && s.world.locations) return s; }
  throw new Error('Snapshot ohne world.locations');
}
function ansichtAus(T, snap, o) {
  o = o || {};
  const sp = snap.space || {}, en = (sp.enemies || []).concat(o.gegner || []);
  const ship = Object.assign({}, snap.ship, o.ship || {});
  const state = Object.assign({}, snap, { ship, space: Object.assign({}, sp, { enemies: en, hidden: (sp.hidden || []).concat(o.versteckt || []) }) });
  return { gesendet: [], time: 1, me: { console: o.console || 'weapons', id: 'p1' }, pid: 'p1', ship, enemies: en, escorts: [], actions: { sfx() {} }, send() {}, state };
}

function aufnehmen(win, T) {   // awayMap-Ereignisse (Karten gescannter Landepunkte) wie der Client registrieren
  for (const m of T.c.inbox) if (m.kind === 'awayMap') win.Render.registerAwayMap(m);
  T.c.inbox.length = 0;
}

// Kasten zeichnen (Ops oder Captain, beide über das echte Pult) und auswerten
function kasten(win, station, view, tab) {
  const C = win.Consoles;
  C.tab = tab == null ? 2 : tab; C.lageRects.length = 0; C.enemyRects.length = 0; win.Render.ui.buttons.length = 0;
  const f = neueFlaeche(); win.__fehler.length = 0;
  const spion = { karten: [], kastenAufrufe: 0 };
  const origK = win.Render.drawMiniKarte, origZ = C.pultZielkasten;
  win.Render.drawMiniKarte = function (ctx, v, rect, mapId) { spion.karten.push({ mapId, rect }); return origK.apply(this, arguments); };
  C.pultZielkasten = function () { spion.kastenAufrufe++; return origZ.apply(this, arguments); };
  try { C.pultDraw(f.ctx, view, station); } finally { win.Render.drawMiniKarte = origK; C.pultZielkasten = origZ; }
  const texte = f.rec.texte.map((t) => t[0]);
  return { texte, hinweis: texte.includes('BEAMEN MÖGLICH'), karten: spion.karten, bilder: f.rec.bilder, kastenAufrufe: spion.kastenAufrufe, fehler: win.__fehler.filter((x) => !/Lerche\.sprite/.test(x)), rec: f.rec };
}
const OPS = (win, snap, T, id, o) => { const v = ansichtAus(T, snap, Object.assign({}, o)); v.state.ship.target = id; return kasten(win, 'weapons', v); };
const CAP = (win, snap, T, id, o) => { const v = ansichtAus(T, snap, Object.assign({ console: 'captain' }, o)); v.state.ship.cz = { id }; return kasten(win, 'captain', v); };

// ---------------------------------------------------------------------------------------------------------------------------------
// Szenario b7 (Handkarte „platform“ am Hauptobjekt, dazu Landepunkt b7.aussenstelle mit eigenem beam) und methalle (Landepunkt methalle.siedlung am Hauptobjekt)
function szeneB7() {
  const T = setup(), g = T.g;
  space.enterScene(g, 'b7', {}); T.run(0.2);
  g.explore.known.add('b7'); g.explore.version++;
  g.ship.x = 1700; g.ship.y = 1500; g.ship.vx = 0; g.ship.vy = 0; g.ship.docked = false; T.run(0.2);
  g.players[0].console = 'weapons';
  return T;
}
function scanne(T) {
  const g = T.g;
  g.ship.vx = 0; g.ship.vy = 0;
  T.cmd('weapons.landescan'); T.run(4.5);
  return !g.lpscan;
}

const win = umgebung();
const C = win.Consoles, R = win.Render;
const bildOps = {}, bildCap = {};

section('(a) vor dem Scan: kein Hinweis, keine Mini-Karte', () => {
  const T = szeneB7(), g = T.g;
  T.cmd('weapons.target', { id: 'station' });
  ok(g.ship.target === 'station', 'Ziel der Ops: Hauptobjekt „station“');
  const snap = snapMitOrten(g);
  const loc = snap.world.locations.find((l) => l.id === 'b7');
  ok(loc && loc.map === null && !('lp' in loc), 'Snapshot b7: map null, kein lp-Feld (' + JSON.stringify({ map: loc && loc.map, lp: loc && loc.lp }) + ')');
  const o = OPS(win, snap, T, 'station'), c = CAP(win, snap, T, 'station');
  ok(o.kastenAufrufe === 1 && c.kastenAufrufe === 1, 'der Zielkasten wird gezeichnet (Ops, Captain)');
  ok(!o.hinweis && !c.hinweis && !o.karten.length && !c.karten.length && !o.bilder && !c.bilder, 'weder „BEAMEN MÖGLICH“ noch Mini-Karte (Ops ' + o.karten.length + ' Karten, Captain ' + c.karten.length + ')');
  ok(C.beamInfo(ansichtAus(T, snap), C.zielAusId(ansichtAus(T, snap), 'station')) === null, 'beamInfo: null vor dem Scan');
  ok(o.fehler.length === 0 && c.fehler.length === 0, 'ohne Anzeigefehler ' + JSON.stringify(o.fehler.concat(c.fehler)));
  T.snapVor = snap; T.o = o; bildOps.vor = o; bildCap.vor = c;
});

section('(b) nach dem Scan (echter Weg L halten): Hinweis und Mini-Karte, Karte wie am Planungstisch', () => {
  const T = szeneB7(), g = T.g;
  T.cmd('weapons.target', { id: 'station' });
  ok(scanne(T) && Lpscan.gescannt(g, 'platform') && Lpscan.gescannt(g, 'b7.aussenstelle'), 'Scan fertig: Handkarte platform (mapsKnown) und Landepunkt b7.aussenstelle (lpScan)');
  aufnehmen(win, T);
  const snap = snapMitOrten(g), loc = snap.world.locations.find((l) => l.id === 'b7');
  ok(loc.map === 'platform' && loc.lp && loc.lp.length === 1 && loc.lp[0].id === 'b7.aussenstelle' && loc.lp[0].x === 2350 && loc.lp[0].y === 1250, 'Snapshot: map platform, lp mit Beam-Punkt ' + JSON.stringify(loc.lp));
  const v = ansichtAus(T, snap); v.state.ship.target = 'station';
  const info = C.beamInfo(v, C.zielAusId(v, 'station'));
  ok(info && info.lpId === 'platform' && info.mapId === 'platform', 'beamInfo(Hauptobjekt) = Handkarte platform ' + JSON.stringify(info));
  ok(info.mapId === C.locAwayMap(snap, loc), 'Kartenid ist die des Planungstischs: locAwayMap(st, ort) = ' + C.locAwayMap(snap, loc));
  const o = OPS(win, snap, T, 'station'), c = CAP(win, snap, T, 'station');
  ok(o.hinweis && c.hinweis, '„BEAMEN MÖGLICH“ bei Ops und Captain');
  ok(o.karten.length === 1 && c.karten.length === 1 && o.karten[0].mapId === 'platform' && c.karten[0].mapId === 'platform' && o.bilder === 1 && c.bilder === 1, 'je eine Mini-Karte, Karte platform (Quelle R.mapById), Kachelbild kopiert');
  ok(R.mapById('platform') === R.mapById(info.mapId) && R.mapById('platform'), 'dieselbe Karte, die der Planungstisch zeichnet (R.mapById)');
  ok(o.karten[0].rect.w >= 60 && o.karten[0].rect.w <= 110 && c.karten[0].rect.w >= 60 && c.karten[0].rect.w <= 110, 'Karte lesbar groß: Ops ' + o.karten[0].rect.w + ' × ' + o.karten[0].rect.h + ' px, Captain ' + c.karten[0].rect.w + ' × ' + c.karten[0].rect.h + ' px');
  ok(o.texte.includes('BEAMEN MÖGLICH') && o.texte.includes('S halten: genauer scannen'), 'der Scan-Hinweis der Ops (Taste S) bleibt neben dem Beam-Hinweis stehen');
  ok(c.texte.includes('nicht gescannt'), 'Captain: „nicht gescannt“ bleibt');
  ok(o.fehler.length === 0 && c.fehler.length === 0, 'ohne Anzeigefehler ' + JSON.stringify(o.fehler.concat(c.fehler)));
  // Landepunkt mit eigenem Beam-Punkt: ein verstecktes Objekt (Wrack/Hohlraum) an dieser Stelle gehört zum Landepunkt
  const hx = { id: 'hx', kind: 'hollow', x: 2352, y: 1251, found: false };
  const v2 = ansichtAus(T, snap, { versteckt: [hx] });
  const i2 = C.beamInfo(v2, C.zielAusId(v2, 'hx'));
  ok(i2 && i2.lpId === 'b7.aussenstelle' && i2.mapId === 'b7.aussenstelle' && i2.mapId === loc.lp[0].id, 'verstecktes Objekt am Beam-Punkt von b7.aussenstelle: Karte = lp[0].id des Planungstischs ' + JSON.stringify(i2));
  const o2 = OPS(win, snap, T, 'hx', { versteckt: [hx] });
  ok(o2.hinweis && o2.karten.length === 1 && o2.karten[0].mapId === 'b7.aussenstelle', 'Ops-Kasten für das versteckte Objekt am Landepunkt: Hinweis und Karte b7.aussenstelle (' + o2.karten.map((k) => k.mapId) + ')');
  // R3: ein GEGNER am selben Beam-Punkt (im leeren Raum vorbeifliegend) löst nie einen Hinweis aus, weder bei den Ops noch beim Captain
  const schiff = { id: 'e9', kind: 'korvette', vk: 'ger', x: 2352, y: 1251, hp: 50, hpMax: 100, scanned: false, angle: 0, shields: [2, 2, 2, 2] };
  const v3 = ansichtAus(T, snap, { gegner: [schiff] });
  ok(C.beamInfo(v3, schiff) === null && C.beamInfo(v3, C.zielAusId(v3, 'e9')) === null, 'Gegnerschiff am Beam-Punkt eines gescannten Landepunkts: beamInfo null');
  const o3 = OPS(win, snap, T, 'e9', { gegner: [schiff] }), c3 = CAP(win, snap, T, 'e9', { gegner: [schiff] });
  ok(!o3.hinweis && !c3.hinweis && !o3.karten.length && !c3.karten.length, 'Gegnerschiff am Beam-Punkt: kein „BEAMEN MÖGLICH“, keine Karte (Ops, Captain)');
  // Mehrdeutigkeit: zwei Landepunkte mit demselben Beam-Punkt (wie splitter.treibgut/methalle/eisenwald): passt genau ein Name zum Ziel, gilt der; sonst nur der Hinweis ohne Karte
  const zwei = JSON.parse(JSON.stringify(snap)); const lz = zwei.world.locations.find((l) => l.id === 'b7');
  lz.lp = [{ id: 'z.alpha', name: 'Alpha-Siedlung', x: 2350, y: 1250 }, { id: 'z.beta', name: 'Beta-Siedlung', x: 2350, y: 1250 }];
  const ohneName = Object.assign({ hidden: true }, hx), mitName = Object.assign({ hidden: true, name: 'beta' }, hx), keinTreffer = Object.assign({ hidden: true, name: 'gamma' }, hx);
  const vz = ansichtAus(T, zwei, { versteckt: [hx] });
  const amb = C.beamInfo(vz, ohneName), amb2 = C.beamInfo(vz, keinTreffer), gew = C.beamInfo(vz, mitName);
  ok(amb && amb.mehrdeutig && amb.mapId === null && amb2 && amb2.mehrdeutig && amb2.mapId === null, 'Mehrdeutigkeit ohne passenden Namen: nur der Hinweis (mapId null) ' + JSON.stringify(amb));
  ok(gew && gew.mapId === 'z.beta' && !gew.mehrdeutig, 'Mehrdeutigkeit mit genau einem passenden Namen: dieser Landepunkt ' + JSON.stringify(gew));
  const oz = OPS(win, zwei, T, 'hx', { versteckt: [hx] });
  ok(oz.hinweis && oz.karten.length === 0 && oz.fehler.length === 0, 'Ops-Kasten bei Mehrdeutigkeit: „BEAMEN MÖGLICH“ ohne Karte, ohne Anzeigefehler');
  bildOps.nach = o; bildCap.nach = c;
  // anderes Ziel am selben Ort (Gegner weit weg vom Beam-Punkt): nichts
  const fern = { id: 'e8', kind: 'korvette', vk: 'ger', x: 300, y: 300, hp: 50, hpMax: 100, scanned: false, angle: 0, shields: [2, 2, 2, 2] };
  ok(C.beamInfo(ansichtAus(T, snap, { gegner: [fern] }), fern) === null, 'Gegner fern vom Beam-Punkt: kein beamInfo');
});

section('(b2) Landepunkt am Hauptobjekt ohne Handkarte (methalle.siedlung): Verknüpfung über den Beam-Punkt', () => {
  const T = setup(), g = T.g;
  space.enterScene(g, 'methalle', {}); T.run(0.2);
  g.explore.known.add('methalle'); g.explore.version++;
  g.ship.x = 1349 - 400; g.ship.y = 928; g.ship.vx = 0; g.ship.vy = 0; g.ship.docked = false; T.run(0.2);
  g.players[0].console = 'weapons';
  T.cmd('weapons.target', { id: 'station' });
  const vor = snapMitOrten(g), vv = ansichtAus(T, vor); vv.state.ship.target = 'station';
  const so = C.zielAusId(vv, 'station');
  ok(so && Math.hypot(so.x - 1349, so.y - 928) <= 24, 'Hauptobjekt liegt am Beam-Punkt von methalle.siedlung (' + (so && so.x) + ', ' + (so && so.y) + ')');
  ok(C.beamInfo(vv, so) === null && !OPS(win, vor, T, 'station').hinweis, 'vor dem Scan: kein Hinweis');
  ok(scanne(T) && Lpscan.gescannt(g, 'methalle.siedlung'), 'Scan fertig');
  aufnehmen(win, T);
  const snap = snapMitOrten(g), loc = snap.world.locations.find((l) => l.id === 'methalle');
  const v = ansichtAus(T, snap); v.state.ship.target = 'station';
  const info = C.beamInfo(v, C.zielAusId(v, 'station'));
  ok(info && info.mapId === 'methalle.siedlung' && info.mapId === loc.lp[0].id, 'beamInfo: Karte = lp[0].id des Planungstischs ' + JSON.stringify(info));
  const o = OPS(win, snap, T, 'station'), c = CAP(win, snap, T, 'station');
  ok(o.hinweis && c.hinweis && o.karten.length === 1 && c.karten.length === 1 && o.karten[0].mapId === 'methalle.siedlung' && c.karten[0].mapId === 'methalle.siedlung', 'Ops und Captain: Hinweis und Mini-Karte methalle.siedlung');
  ok(!!R.mapById('methalle.siedlung') && o.bilder === 1 && c.bilder === 1, 'Karte vom Client registriert (awayMap-Ereignis), Kachelbild gezeichnet');
  ok(o.fehler.length === 0 && c.fehler.length === 0, 'ohne Anzeigefehler ' + JSON.stringify(o.fehler.concat(c.fehler)));
  // (g) Snapshot-Größe der lp-Einträge
  ok(JSON.stringify(loc.lp) === JSON.stringify([{ id: 'methalle.siedlung', name: loc.lp[0].name, x: 1349, y: 928 }]) && JSON.stringify(loc.lp).length < 120, '(g) lp-Eintrag nur { id, name, x, y }: ' + JSON.stringify(loc.lp).length + ' B');
  bildOps.methalle = o; bildCap.methalle = c;
  T.snap = snap;
  // Zweiter Ort der Ansicht: nur der aktuelle Ort zählt (lp eines anderen Orts verknüpft nie)
  const fremd = JSON.parse(JSON.stringify(snap)); fremd.world.location = 'b7';
  ok(C.beamInfo(ansichtAus(T, fremd), so) === null, 'lp eines anderen Orts verknüpft nicht');
});

section('(c) Ziel ohne beam: nie Hinweis', () => {
  const T = szeneB7(), g = T.g;
  T.cmd('weapons.target', { id: 'station' });
  scanne(T); aufnehmen(win, T);
  const snap = snapMitOrten(g);
  // Landepunkt ohne beam im Snapshot (kein x/y): keine Verknüpfung, auch nicht mit Ziel exakt am Punkt
  const ohne = JSON.parse(JSON.stringify(snap)); for (const l of ohne.world.locations) for (const q of l.lp || []) { delete q.x; delete q.y; }
  const hx0 = { id: 'hx', kind: 'hollow', x: 2350, y: 1250, found: false };
  const vo = ansichtAus(T, ohne, { versteckt: [hx0] });
  ok(C.beamInfo(vo, C.zielAusId(vo, 'hx')) === null && !OPS(win, ohne, T, 'hx', { versteckt: [hx0] }).hinweis, 'Landepunkt ohne beam: kein Hinweis (Ops)');
  ok(!CAP(win, ohne, T, 'hx', { versteckt: [hx0] }).hinweis, 'Landepunkt ohne beam: kein Hinweis (Captain)');
  // Gegnerschiff ohne Landepunkt: der Kasten bleibt wie er war
  const fern = { id: 'e8', kind: 'korvette', vk: 'ger', x: 300, y: 300, hp: 50, hpMax: 100, scanned: false, angle: 0, shields: [2, 2, 2, 2] };
  const o = OPS(win, snap, T, 'e8', { gegner: [fern] }), c = CAP(win, snap, T, 'e8', { gegner: [fern] });
  ok(!o.hinweis && !c.hinweis && !o.karten.length && !c.karten.length, 'Gegner ohne Landepunkt: kein Hinweis, keine Karte (Ops, Captain)');
  // Ort ohne Szenen-beam (Hauptobjekt ohne Handkarte), nichts gescannt: kein Hinweis
  const T2 = setup(); space.enterScene(T2.g, 'hafen', {}); T2.run(0.2); T2.g.explore.known.add('hafen'); T2.g.explore.version++; T2.g.players[0].console = 'weapons';
  T2.cmd('weapons.target', { id: 'station' });
  const s2 = snapMitOrten(T2.g), v2 = ansichtAus(T2, s2); v2.state.ship.target = 'station';
  ok(C.zielAusId(v2, 'station') && C.beamInfo(v2, C.zielAusId(v2, 'station')) === null && !OPS(win, s2, T2, 'station').hinweis, 'Hauptobjekt ohne gescannten Landepunkt (hafen): kein Hinweis');
  bildOps.ohne = o; bildCap.ohne = c;
});

section('(d) Ops-Ziel und Captain-Anzeigeziel: dieselbe Funktion', () => {
  const ps = read('public/js/pult-stationen.js');
  ok(/\n    pultZielkasten\(c, view, b, target\) \{/.test(ps), 'Signatur pultZielkasten(c, view, b, target) unverändert, kein Stationsparameter');
  const rumpf = ps.split('\n    pultZielkasten(c, view, b, target) {')[1].split('\n    // ====')[0];
  ok(/this\.beamInfo\(view, target\)/.test(rumpf) && /this\.zielBeamBlock\(c, view, b, y, bi\)/.test(rumpf) && (rumpf.match(/beamInfo\(/g) || []).length === 1, 'pultZielkasten ruft beamInfo genau einmal auf (für Ops und Captain)');
  ok(!/captain|weapons|station\b/.test(ps.split('\n    zielBeamBlock(')[1].split('\n    },')[0].replace(/\/\/[^\n]*/g, '')), 'zielBeamBlock ohne Stationsbezug');
  const bi = read('public/js/consoles.js').split('\n    beamInfo(view, target) {')[1].split('\n    },')[0];
  ok(!/\b(weapons|captain)\b/.test(bi.replace(/\/\/[^\n]*/g, '')), 'beamInfo ohne Stationsbezug');
  ok(/R\.drawMiniKarte\(c, view,/.test(ps), 'zielBeamBlock zeichnet über R.drawMiniKarte');
  const T = szeneB7(); T.cmd('weapons.target', { id: 'station' }); scanne(T); aufnehmen(win, T);
  const snap = snapMitOrten(T.g);
  const o = OPS(win, snap, T, 'station'), c = CAP(win, snap, T, 'station');
  ok(o.kastenAufrufe === 1 && c.kastenAufrufe === 1 && o.hinweis && c.hinweis, 'beide Aufrufer zeichnen den Hinweis über denselben Kasten');
  // dieselbe Funktion, dieselben Daten: gleicher Hinweis und gleiche Karte bei gleichem Platz
  const rect = { x: 20, y: 20, w: 158, h: 222 };
  const mit = (v, id) => { const f = neueFlaeche(); C.tab = 2; C.pultZielkasten(f.ctx, v, rect, C.zielAusId(v, id)); return JSON.stringify(f.rec.texte) + '|' + f.rec.bilder; };
  const vo = ansichtAus(T, snap); vo.state.ship.target = 'station';
  const vc = ansichtAus(T, snap, { console: 'captain' }); vc.state.ship.cz = { id: 'station' };
  ok(mit(vo, 'station') === mit(vc, 'station'), 'gleicher Platz, gleiches Ziel: Ops und Captain zeichnen Zeile für Zeile dasselbe');
  // schmaler Captain-Kasten (118 px) und niedriger Kasten
  const schmal = neueFlaeche(); C.pultZielkasten(schmal.ctx, vc, { x: 20, y: 20, w: 118, h: 150 }, C.zielAusId(vc, 'station'));
  ok(schmal.rec.texte.some((t) => t[0] === 'BEAMEN MÖGLICH') && schmal.rec.bilder === 1, 'schmaler Kasten (118 × 150): Hinweis und Karte');
  const flach = neueFlaeche(); C.pultZielkasten(flach.ctx, vc, { x: 20, y: 20, w: 118, h: 62 }, C.zielAusId(vc, 'station'));
  ok(flach.rec.texte.some((t) => t[0] === 'BEAMEN MÖGLICH') && flach.rec.bilder === 0, 'sehr niedriger Kasten (118 × 62): zumindest der Hinweis, die Karte entfällt');
});

section('(e) keine zweite Kartenkopie', () => {
  const rs = read('public/js/render.js');
  const fn = rs.split('\n  function drawMiniKarte(')[1].split('\n  }\n')[0];
  ok(/mapById\(mapId\)/.test(fn) && /kachelFarbe\(/.test(fn), 'drawMiniKarte liest die Karte über mapById und färbt mit kachelFarbe');
  ok(/const col = kachelFarbe\(mapId, ch, obj\);/.test(rs.split('\n  function drawLocalMap(')[1].split('\n  }\n')[0]), 'der Planungstisch (drawLocalMap) nutzt dieselbe Kachelfarbe');
  ok(!/KartenAnsicht|KA\.|ansichtKey|zkey/.test(fn) && !/\.at\s*=|Maps\[[^\]]*\]\s*=/.test(fn), 'kein KartenAnsicht-Zustand, keine Kartenzuweisung');
  const ex = read('server/sim/explore.js');
  const lpv = ex.split('\n  lpScanVon(ortId) {')[1].split('\n  }\n')[0];
  ok(/x: Math\.round\(beam\.x\), y: Math\.round\(beam\.y\)/.test(lpv) && !/karte|\.tiles|\.rows|\.grid/i.test(lpv), 'lpScanVon liefert nur id, name und Beam-Punkt, keine Kartendaten');
  const gm = read('server/game.js');
  ok(!/miniKarte|beamKarte|zielKarte/i.test(gm), 'kein neues Kartenfeld im Snapshot (server/game.js)');
  const T = szeneB7(); scanne(T); const snap = snapMitOrten(T.g);
  ok(!/"(miniKarte|beam|rows|tiles|zeilen)"/.test(JSON.stringify(snap)), 'Snapshot nach dem Scan enthält kein Kartenfeld');
});

section('(f) Ops-Zielkasten für Gegner unverändert', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'test-captain-zielkasten.js')], { encoding: 'utf8' });
  ok(r.status === 0, 'tools/test-captain-zielkasten.js (Referenz ops-zielkasten-ref.json) grün');
});

section('(g) Snapshot ohne Scan', () => {
  const T = szeneB7();
  const s = snapMitOrten(T.g);
  ok(s.world.locations.every((l) => !('lp' in l)), 'ohne Scan: kein lp-Feld an irgendeinem Ort');
  ok(!('lpscan' in s) || typeof s.lpscan.n === 'number', 'lpscan-Fortschritt unverändert { n }');
});

section('(h) Gegenprobe: ohne Prüfung des Scanstands erschiene der Hinweis vor dem Scan', () => {
  const mut = umgebung({ 'consoles.js': (q) => { const alt = 'if (target.station && am && scn && scn.beam && scn.beam.map === am)'; if (!q.includes(alt)) throw new Error('Mutationsstelle fehlt'); return q.replace(alt, 'if (target.station && scn && scn.beam)'); } });
  const T = szeneB7(); T.cmd('weapons.target', { id: 'station' });
  const snap = snapMitOrten(T.g);
  const v = ansichtAus(T, snap); v.state.ship.target = 'station';
  const echt = kasten(win, 'weapons', Object.assign(v, {}));
  const m = kasten(mut, 'weapons', v);
  ok(!echt.hinweis && m.hinweis, 'echt: kein Hinweis vor dem Scan; mutiert (Scanstand ignoriert): Hinweis erscheint – der Test würde rot');
  const mut2 = umgebung({ 'pult-stationen.js': (q) => { const alt = 'if (bi) y = this.zielBeamBlock(c, view, b, y, bi);'; if (!q.includes(alt)) throw new Error('Mutationsstelle fehlt'); return q.replace(alt, 'y = this.zielBeamBlock(c, view, b, y, bi || { mapId: null });'); } });
  const m2 = kasten(mut2, 'weapons', v);
  ok(m2.hinweis, 'Mutation 2 (Block ohne beamInfo-Ergebnis): Hinweis erscheint – der Test würde rot');
});

console.log('\ntest-beam-hinweis: ' + (n - fails) + '/' + n + ' ok');
module.exports = { bildOps, bildCap };
process.exit(fails ? 1 : 0);
