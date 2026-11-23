'use strict';
// SPT-01 F: Bekannte Bojen zeigen den Namen des Sprungziels (Kai, Spieltest). Quelle ist EIN Namensweg: StarMap.bojeZielName (hexName der Sektorkarte), genutzt von der Raumszene
// (starmap.js drawSzene) und vom Visier (visier-beschriftung.js). Das Ziel einer Boje ist die Gegenseite der Kante k zum aktuellen Sektor (Snapshot space.jp.n); ein unbekanntes Ziel traegt keinen Namen.
//   (a) StarMap.bojeZielName: aktueller Sektor als a und als b der Kante; ohne n aus der Kante abgeleitet; unbekanntes Ziel null; Leerraum 'Leer'
//   (b) Visier-Beschriftung: bekannte Boje traegt den Namen (Grossbuchstaben, Kurzform), unbekannte 'BOJE <Hex>' ohne Namen; ohne StarMap wie bisher
//   (c) Mutation: Name vom aktuellen Sektor statt vom Ziel -> (a)/(b) rot
//   node tools/test-boje-zielname.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');   // Quelldateien sind CRLF
const messCtx = { font: '8px monospace', measureText(s) { return { width: String(s).length * 5 }; } };

function starmap(q) {
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
    Shared_Locations: require('../shared/locations.js'), Shared_Sektoren: require('../shared/sektoren.js'), Net: { reportError() {} },
    document: { createElement: () => ({ getContext: () => messCtx, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' } };
  win.window = win; win.self = win;
  vm.createContext(win);
  for (const f of ['kennung.js', 'render.js', 'kartenlogik.js', 'sonden.js', 'spur.js', 'kartenzeichen.js', 'karte-tokens.js', 'kartenansicht.js', 'starmap.js']) vm.runInContext(q && q[f] != null ? q[f] : rd(f), win, { filename: f });
  return win.StarMap;
}
// Zustand: aktueller Sektor `hier` (Ort-Id), bekannte Orte, erkundete Hexe
const ORT = { '0502': 'rabenpass', '0503': 'kreuzweg', '0504': 'vorfeld' };
const zustand = (hier, bekannt, erkundet) => ({ world: { location: ORT[hier], locations: bekannt.map((h) => ({ id: ORT[h], known: true, visited: erkundet.includes(h) })), sektoren: { e: erkundet, b: [], t: [], o: [] } },
  ship: { scene: ORT[hier], jump: {} }, space: {} });

function pruefeA(SM, rep) {
  const sa = zustand('0502', ['0502', '0503'], ['0502', '0503']), sb = zustand('0503', ['0502', '0503'], ['0502', '0503']);
  ok(SM.bojeZielName(sa, { k: '0502-0503', n: '0503', z: 'aktiv' }) === 'Kreuzweg', rep + 'hier = a der Kante: Ziel ist Kreuzweg (nicht Rabenpass)');
  ok(SM.bojeZielName(sb, { k: '0502-0503', n: '0502', z: 'aktiv' }) === 'Rabenpass', rep + 'hier = b der Kante: Ziel ist Rabenpass (nicht Kreuzweg)');
  ok(SM.bojeZielName(sa, { k: '0502-0503', z: 'aktiv' }) === 'Kreuzweg' && SM.bojeZielName(sb, { k: '0502-0503', z: 'aktiv' }) === 'Rabenpass', rep + 'ohne n: Gegenseite der Kante zum aktuellen Sektor');
  const su = zustand('0502', ['0502'], ['0502']);
  ok(SM.bojeZielName(su, { k: '0502-0504', n: '0504', z: 'aktiv' }) === null, rep + 'unbekanntes Ziel (Vorfeld): kein Name');
  ok(SM.bojeZielName(sa, null) === null && SM.bojeZielName(sa, {}) === null && SM.bojeZielName({}, { k: '0502-0503', n: '0503' }) === null, rep + 'kaputte Eingaben: null, kein Wurf');
  ok(SM.bojeZielName(sa, { k: '0502-0501', n: '0501', z: 'aktiv' }) === 'Leer', rep + 'Ziel ausserhalb der Karte: Leer (Kurzform wie Randpfeil)');
  // U1 (Kai): temporaere Boje und Missionsmarke zeigen den Ortsnamen auch bei unerkundetem Ziel, aber nur den NAMEN (die Hexnummer haengt nur die Raumszene an)
  const su1 = zustand('0502', ['0502'], ['0502']);
  SM.setMarken([]);
  ok(SM.bojeZielName(su1, { k: '0502-0504', n: '0504', z: 'temporaer' }) === 'Vorfeld', rep + 'U1 temporaer: nur der Name (Vorfeld), keine Hexnummer');
  ok(SM.bojeZielName(su1, { k: '0502-0503', n: '0503', z: 'temporaer' }) === 'Kreuzweg', rep + 'U1 temporaer: Name ohne Zusatz (Kreuzweg)');
  ok(SM.bojeZielName(su1, { k: '0502-0504', n: '0504', z: 'aktiv' }) === null, rep + 'U1: eine aktive Boje zu unerkundetem Ziel bleibt namenlos');
  SM.setMarken([{ h: '0504', typ: 'ziel' }]);
  ok(SM.bojeZielName(su1, { k: '0502-0504', n: '0504', z: 'aktiv' }) === 'Vorfeld', rep + 'U1 Missionsmarke: nur der Name (Vorfeld)');
  ok(SM.bojeSzenenName(su1, { k: '0502-0504', n: '0504', z: 'aktiv' }) === 'Vorfeld 0504', rep + 'Raumszene (unveraendert): U1-Name mit Hexnummer');
  SM.setMarken([]);
  ok(SM.bojeSzenenName(su1, { k: '0502-0503', n: '0503', z: 'temporaer' }) === 'Kreuzweg 0503' && SM.bojeSzenenName(sa, { k: '0502-0503', n: '0503', z: 'aktiv' }) === 'Kreuzweg', rep + 'Raumszene: temporaer mit Nummer, bekanntes Ziel ohne');
}

// ------------------------------------------------------------------ Visier
globalThis.HauptschirmTokens = require('../public/js/hauptschirm-tokens.js');
require('../public/js/kulisse-himmel.js');
const Vis = require('../public/js/visier.js');
globalThis.HauptschirmTafeln = require('../public/js/hauptschirm-tafeln.js');
globalThis.Render = { measure: (s, k) => Math.max(0, String(s).length * 6 - 1) * (k || 1), textKontur() {} };
globalThis.Consoles = { targetOf: () => null };
require('../public/js/visier-lage.js');
const Obj = require('../public/js/visier-objekte.js');
const Besch = require('../public/js/visier-beschriftung.js');
require('../public/js/visier-leiste.js');
const c = Vis.kamera();
const ship = { x: 1000, y: 1000, angle: 0 };
function bojenTexte(st, jp) {
  const v = { time: 1, ship, enemies: [], escorts: [], spaceProjectiles: [], state: Object.assign({}, st, { ship: Object.assign({}, st.ship, ship), space: { jp } }) };
  const P = Besch.baue(v, Vis.plan(v), c, { lage: Obj.baue(v, Vis.plan(v), c) });
  const o = {}; for (const i of P.items.concat(P.pfeile)) if (i.art === 'sprungboje') o[i.id] = i.text;
  return o;
}
function pruefeB(SM, rep) {
  globalThis.StarMap = SM;
  const sa = zustand('0502', ['0502', '0503'], ['0502', '0503']);
  const t1 = bojenTexte(sa, [{ k: '0502-0503', x: 1300, y: 1000, z: 'aktiv', n: '0503' }]);
  ok(t1['boje:0502-0503'] === 'KREUZWEG', rep + 'bekannte Boje (hier = a): Beschriftung KREUZWEG (' + JSON.stringify(t1) + ')');
  const sb = zustand('0503', ['0502', '0503'], ['0502', '0503']);
  const t2 = bojenTexte(sb, [{ k: '0502-0503', x: 1300, y: 1000, z: 'aktiv', n: '0502' }]);
  ok(t2['boje:0502-0503'] === 'RABENPASS', rep + 'bekannte Boje (hier = b): Beschriftung RABENPASS (' + JSON.stringify(t2) + ')');
  const su = zustand('0502', ['0502'], ['0502']);
  const t3 = bojenTexte(su, [{ k: '0502-0504', x: 1300, y: 1000, z: 'aktiv', n: '0504' }]);
  ok(t3['boje:0502-0504'] === 'BOJE 0504' && !/VORFELD/i.test(JSON.stringify(t3)), rep + 'unbekanntes Ziel: BOJE 0504, kein Name (' + JSON.stringify(t3) + ')');
  const t4 = bojenTexte(sa, [{ k: '0502-0503', x: 1300, y: 1000, z: 'aktiv', n: '0503' }, { k: '0502-0504', x: 1400, y: 1150, z: 'aktiv', n: '0504' }]);
  ok(t4['boje:0502-0503'] === 'KREUZWEG' && t4['boje:0502-0504'] === 'BOJE 0504', rep + 'zwei Bojen: bekannte mit Name, unbekannte ohne (' + JSON.stringify(t4) + ')');
  // U1 im Visier: Kurzform schneidet die Hexnummer nicht ab und endet nicht auf ein Leerzeichen
  const tu = bojenTexte(zustand('0502', ['0502'], ['0502']), [{ k: '0502-0504', x: 1300, y: 1000, z: 'temporaer', n: '0504' }, { k: '0502-0503', x: 1400, y: 1150, z: 'temporaer', n: '0503' }]);
  ok(tu['boje:0502-0504'] === 'VORFELD' && tu['boje:0502-0503'] === 'KREUZWEG' && Object.values(tu).every((s) => s === s.trim() && !/d/.test(s)), rep + 'U1 temporaer: VORFELD und KREUZWEG, ohne Hexrest und ohne Endleerzeichen (' + JSON.stringify(tu) + ')');
  SM.setMarken([{ h: '0504', typ: 'ziel' }]);
  const tm = bojenTexte(zustand('0502', ['0502'], ['0502']), [{ k: '0502-0504', x: 1300, y: 1000, z: 'aktiv', n: '0504' }]);
  ok(tm['boje:0502-0504'] === 'VORFELD', rep + 'U1 Missionsmarke: VORFELD (' + JSON.stringify(tm) + ')');
  SM.setMarken([]);
  globalThis.StarMap = undefined;
  const t5 = bojenTexte(sa, [{ k: '0502-0503', x: 1300, y: 1000, z: 'aktiv', n: '0503' }]);
  ok(t5['boje:0502-0503'] === 'BOJE 0503', rep + 'ohne StarMap: Rueckfall wie bisher (BOJE 0503)');
}

section('(a) StarMap.bojeZielName');
pruefeA(starmap(), '');
section('(b) Visier-Beschriftung');
pruefeB(starmap(), '');
section('(c) Mutation: Name vom aktuellen Sektor statt vom Ziel');
{
  const quelle = rd('starmap.js'), alt = 'const nm = hexName(P, L, n, lang);';
  ok(quelle.includes(alt), 'Mutationsanker vorhanden');
  const mut = starmap({ 'starmap.js': quelle.replace(alt, 'const nm = hexName(P, L, L.hier, lang);') });
  const vorher = fails, nVorher = n;
  const log = console.log; console.log = () => {};
  pruefeA(mut, 'M '); pruefeB(mut, 'M ');
  console.log = log;
  const rot = fails - vorher; fails = vorher; n = nVorher;
  ok(rot >= 3, 'Mutation faellt auf: ' + rot + ' Pruefungen rot');
  globalThis.StarMap = undefined;
}
section('(d) Mutation: bojeZielName haengt im U1-Fall wieder die Hexnummer an (der alte Fehler)');
{
  const quelle = rd('starmap.js'), alt = 'function bojeZielName(P, L, b, lang) { const r = bojeZielAuf(P, L, b, lang); return r ? r.name : null; }';
  ok(quelle.includes(alt), 'Mutationsanker vorhanden');
  const mut = starmap({ 'starmap.js': quelle.replace(alt, "function bojeZielName(P, L, b, lang) { const r = bojeZielAuf(P, L, b, lang); return r ? (r.u1 ? r.name + ' ' + r.hex : r.name) : null; }") });
  const vorher = fails, nVorher = n;
  const log = console.log; console.log = () => {};
  pruefeA(mut, 'M '); pruefeB(mut, 'M ');
  console.log = log;
  const rot = fails - vorher; fails = vorher; n = nVorher;
  ok(rot >= 4, 'Mutation faellt auf: ' + rot + ' Pruefungen rot');
  globalThis.StarMap = undefined;
}
console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLER' : 'alle ' + n + ' Pruefungen gruen'));
process.exit(fails ? 1 : 0);
