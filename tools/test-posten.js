'use strict';
// SUND-02b A1: Posten der Crew (server/sim/posten.js, Wirkungen posten_gehisst und posten_ausgebaut, content/welt/posten-werte.json, Dock und Werft am Stützpunkt).
// Direkt gegen die Game-Klasse, ohne Netz (der Mehrspieler-Test am echten Server ist tools/test-posten-ws.js).
//   Daten · Wirkung gültig/ungültig · atomar (Rollback) · Weigerungsgründe · Halteprozess und Abbrüche · Posten in der Sim · Dock · Werft und Handel · Laden/Altstand ·
//   Stützpunkt-Ausbau · Posten halten · Anzeige (space.po) · Kampagne unverändert
//   node tools/test-posten.js [begriff …]   (npm run test:posten)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Kern = require('../server/weltsim/kern.js');
const Wirkungen = require('../server/weltsim/wirkungen.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Besitz = require('../server/sim/besitz.js');
const Ruf = require('../server/sim/ruf.js');
const Posten = require('../server/sim/posten.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const Werft = require('../server/sim/werft.js');
const Shop = require('../server/sim/shop.js');
const Fracht = require('../server/sim/fracht.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
const kopie = (o) => JSON.parse(JSON.stringify(o));

const PW = require('../content/welt/posten-werte.json').werte;
const RUF = require('../content/welt/ruf-werte.json').werte;
const TEXTE = require('../content/flotte/posten.json');
const RAENGE = RUF.raenge.wert;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-posten-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const HZ = CONFIG.tickHz;
const OSTIA_ORT = 'ostia_nova';
const FREI = '0505', FREI2 = '0503', GER1 = '0703', STATION = '0603', OSTIA = '0305';
const rangAb = (id) => RAENGE.find((r) => r.id === id).ab;

let kernWirft = false;
const kernOrig = Kern.tick;
Kern.tick = function (z, o) { if (kernWirft) throw new Error('Test: Tick wirft'); return kernOrig.apply(this, arguments); };
const warnOrig = console.warn;

function neu(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: o.dir || freshDir(), seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') } });
  const cs = [];
  for (let i = 0; i < (o.crew || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 600) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'P' + i, name: 'P' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: o.start || 'freie_fahrt', ...(o.world ? { world: o.world } : {}) });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  if (o.vorRun) o.vorRun(g);   // Zustand direkt nach dem Laden, vor dem ersten Tick
  run(g, 1);
  g.space.enemies = [];
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  return { g, cs };
}
const run = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const z = (g) => g.weltsim.zustand;
const rom = (g) => Ruf.ruf(g, 'rom');
const ops = (g) => { g.players[0].console = 'weapons'; g.players[0].station = null; };
function ab(g) { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }
function ankunft(g, hex) { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); }
const szene = (hex) => Locations.get(Sektoren.ortVonHex(hex)).scene;
// Lerche an den Postenplatz, in Ruhe
function anPosten(g, hex, dx) { const p = Besitz.postenLage(szene(hex)); Object.assign(g.ship, { x: p.x + (dx || 0), y: p.y, vx: 0, vy: 0, speed: 0 }); }
// Partie am freien Hex mit Ops, Rang und Ersatzteilen
function bereit(o) {
  const t = neu(o); const g = t.g;
  g.weltsim.ruf.rom = rangAb((o && o.rang) || 'optio'); g.inventory.ersatzteil = 4;
  ankunft(g, (o && o.hex) || FREI); ops(g); run(g, 0.2); anPosten(g, (o && o.hex) || FREI);   // ein Tick nach der Ankunft: fracht.update merkt sich die Szene
  return t;
}
const HEIMAT = { ger: '1004', pirat: '0602', kon: '0604' };
function flotte(g, hex, fraktion, staerke, belagerung) {
  const st = z(g);
  const fl = { id: st.naechsteId++, fraktion, heimat: HEIMAT[fraktion] || hex, ort: hex, staerke, kap: Math.max(staerke, 5), befehl: 'rueckzug', ziel: null, warte: 0, versorgung: 1, angriff: null };
  st.flotten.push(fl);
  if (belagerung) {
    const id = st.naechsteAngriffId++;
    st.angriffe.push({ id, t0: st.tick, ziel: hex, von: fraktion, art: fraktion === 'pirat' ? 'pirat' : 'reich', relevant: true, zielArt: 'posten', t_an: st.tick, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: st.tick, stuetz: null, flotten: [fl.id] });
    fl.befehl = 'angriff'; fl.ziel = hex; fl.angriff = id;
  }
  return fl;
}
const ohneFlotten = (g, hex) => { const st = z(g); st.flotten = st.flotten.filter((f) => f.ort !== hex); };
// Gründen bis zum Abschluss laufen lassen
const gruenden = (g) => { const e = Posten.gruendenStart(g, g.players[0]); if (e) return e; run(g, PW.gruenden.wert.dauer + 1.5); return null; };
const halt = (g) => g.fracht && g.fracht.halt;
const crewHexe = (g) => Object.entries(z(g).hexe).filter(([, nd]) => nd.crew).map(([h]) => h);
const andersWo = (g, hex) => { const a = ['0504', '0604']; return a.find((x) => x !== hex); };

section('Daten und Texte', () => {
  neu();   // setzt die Karte sund_frei
  ok(PW && TEXTE.format === 'posten/1' && require('../content/welt/posten-werte.json').format === 'posten-werte/1', 'Formate');
  const rom_ = PW.anspruch.wert.rom, ger_ = PW.anspruch.wert.ger;
  const karte = require('../content/welt/sund-sim.json');
  const hex = (c) => karte.hexe.find((h) => h.code === c);
  ok(rom_.length === ger_.length && rom_.every((h) => !ger_.includes(h)), 'Anspruch symmetrisch (je ' + rom_.length + ' Hexe), ohne Überschneidung');
  ok([].concat(rom_, ger_).every((h) => hex(h) && hex(h).simFraktion === null && !hex(h).hafenklasse), 'Anspruchs-Hexe sind freie Sim-Hexe ohne Hafen');
  ok([].concat(rom_, ger_).every((h) => { const l = Locations.get(Sektoren.ortVonHex(h)); return l && l.scene && !l.scene.station && !l.scene.dock; }), 'Anspruchs-Hexe tragen keine Station und keinen Liegeplatz (kein Posten-Marker-Konflikt)');
  const nb = (h) => karte.kanten.filter((e) => e.a === h || e.b === h).map((e) => (e.a === h ? e.b : e.a));
  ok(rom_.every((h) => nb(h).some((x) => hex(x).simFraktion === 'rom')) && ger_.every((h) => nb(h).some((x) => hex(x).simFraktion === 'ger')), 'Roms Anspruch grenzt an Rom, der germanische an die Germanen');
  ok(RAENGE.some((r) => r.id === PW.mindestrang.wert.gruenden) && RAENGE.some((r) => r.id === PW.mindestrang.wert.ausbau) && rangAb(PW.mindestrang.wert.gruenden) < rangAb(PW.mindestrang.wert.ausbau), 'Mindestränge sind bekannt, Ausbau verlangt mehr als Gründen');
  for (const art of ['gruenden', 'ausbau']) {
    const c = PW[art].wert;
    ok(c.dauer > 0 && c.radius > 0 && c.tempo > 0 && c.kosten && c.kosten.ersatzteil >= 0, `${art}: Dauer, Radius, Tempo, Kosten sind Daten`);
  }
  for (const [k, def] of [['gruenden', ['modus', 'rang', 'anspruch', 'station', 'hafen', 'belegt', 'gegner', 'szene', 'weit', 'schnell', 'teile', 'docked', 'transfer', 'laeuft']], ['ausbau', ['modus', 'rang', 'kein_posten', 'schon', 'station', 'hafen', 'gegner', 'szene', 'weit', 'schnell', 'teile', 'docked', 'transfer', 'laeuft']]]) {
    ok(def.every((c) => typeof TEXTE[k].weigerung[c] === 'string' && TEXTE[k].weigerung[c].length > 5), `${k}: jeder Weigerungsgrund hat einen Text`);
    ok(['gegner', 'szene', 'ring', 'schnell', 'transfer', 'belegt', 'teile', 'sprung', 'ops'].every((c) => typeof TEXTE[k].abbruch[c] === 'string'), `${k}: jeder Abbruchgrund hat einen Text`);
  }
  ok(/Roms Anspruch/.test(TEXTE.gruenden.weigerung.anspruch), 'Weigerung „Dieser Sektor liegt nicht in Roms Anspruch“');
  const q = RUF.quellen.wert;
  ok(['posten_gehisst', 'posten_ausgebaut', 'posten_gehalten'].every((k) => q[k] && q[k].fraktion === 'rom' && q[k].delta > 0 && q[k].delta <= RUF.delta_max.wert), 'Ruf-Quellen posten_gehisst, posten_ausgebaut, posten_gehalten (Rom, positiv)');
  ok(TEXTE.dock.handel && TEXTE.dock.kein_dock, 'Texte: Handel gesperrt, kein Dock');
});

section('Wirkung posten_gehisst: Prüfer und Anwender', () => {
  const { g } = neu(); const zz = z(g);
  const pr = (wk) => Wirkungen.pruefe(zz, wk);
  ok(Wirkungen.KATALOG.posten_gehisst && Wirkungen.KATALOG.posten_ausgebaut && !Wirkungen.istAufsatz('posten_gehisst'), 'im Katalog, im Kern angewandt (kein Aufsatz)');
  ok(pr({ typ: 'posten_gehisst', ort: FREI }).ok && pr({ typ: 'posten_gehisst', ort: FREI2 }).ok, 'gültig: freie Hexe in Roms Anspruch');
  const nein = (wk, t) => { const r = pr(wk); ok(!r.ok && typeof r.grund === 'string' && r.grund.length > 0, 'ungültig: ' + t + (r.grund ? ' (' + r.grund + ')' : '')); };
  nein({ typ: 'posten_gehisst', ort: GER1 }, 'freies Hex im Anspruch der Germanen');
  nein({ typ: 'posten_gehisst', ort: STATION }, 'Hex ohne Anspruch (Kantenstein, Station)');
  nein({ typ: 'posten_gehisst', ort: OSTIA }, 'römischer Hafen');
  nein({ typ: 'posten_gehisst', ort: '0504' }, 'Hafen des Konkordats');
  nein({ typ: 'posten_gehisst', ort: '9999' }, 'unbekannter Ort');
  nein({ typ: 'posten_gehisst' }, 'Ort fehlt');
  nein({ typ: 'posten_gehisst', ort: 5 }, 'Ort keine Zeichenkette');
  nein({ typ: 'posten_gehisst', ort: 'constructor' }, 'Ort „constructor“');
  zz.hexe[FREI].besitzer = 'pirat'; nein({ typ: 'posten_gehisst', ort: FREI }, 'Besitzer vorhanden'); zz.hexe[FREI].besitzer = null;
  zz.hexe[FREI].posten = true; nein({ typ: 'posten_gehisst', ort: FREI }, 'Posten vorhanden'); zz.hexe[FREI].posten = false;
  const fl = flotte(g, FREI, 'ger', 5); nein({ typ: 'posten_gehisst', ort: FREI }, 'feindliche Flotte im Hex'); z(g).flotten.splice(z(g).flotten.indexOf(fl), 1);
  const rf = flotte(g, FREI, 'rom', 5); ok(pr({ typ: 'posten_gehisst', ort: FREI }).ok, 'gültig trotz römischer Flotte im Hex (Verbündete stören nicht)'); z(g).flotten.splice(z(g).flotten.indexOf(rf), 1);
  const kf = flotte(g, FREI, 'kon', 5); ok(pr({ typ: 'posten_gehisst', ort: FREI }).ok, 'gültig trotz Konkordat-Flotte (neutral)'); z(g).flotten.splice(z(g).flotten.indexOf(kf), 1);
  // Anwender: genau die erwarteten Felder, Ereignis, ein Tick
  const vor = kopie(Kriegslage.abbild(zz)); const tk = g.weltsim.tickZahl;
  const r = Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'posten_gehisst', ort: FREI }], wo: 'test' });
  const nd = z(g).hexe[FREI];
  ok(r.ok && r.angewandt === 1 && g.weltsim.tickZahl === tk + 1, 'angewandt, genau ein Tick');
  ok(nd.posten === true && nd.besitzer === 'rom' && nd.crew === true && nd.garnison >= zz.werte.garrison - 1 && gleich(nd.anspruch, {}), `Posten Besitzer Rom, crew true, Garnison ${nd.garnison} (Wert garrison ${zz.werte.garrison}, ein Tick Regeneration möglich)`);
  ok(r.ereignisse.some((e) => e.typ === 'posten_gehisst' && e.ort === FREI && e.fraktion === 'rom') && !r.ereignisse.some((e) => e.typ === 'posten_gegruendet'), 'Ereignis posten_gehisst (nicht posten_gegruendet: Kennzahlen zählen nur Sim-Posten)');
  ok(Object.keys(z(g).hexe).filter((h) => h !== FREI).every((h) => !z(g).hexe[h].crew), 'kein anderes Hex bekommt crew');
  ok(g.weltBesitz.hexe[FREI].posten === true && g.weltBesitz.hexe[FREI].besitzer === 'rom' && g.weltBesitz.hexe[FREI].crew === true, 'Overlay: posten, rom, crew');
  ok(Object.entries(g.weltBesitz.hexe).filter(([h]) => h !== FREI).every(([, e]) => !('crew' in e)), 'Overlay: crew nur am Stützpunkt (additiv)');
  // zweimal dasselbe: der zweite wird verworfen
  const r2 = Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'posten_gehisst', ort: FREI }], wo: 'test' });
  ok(r2.ok && r2.angewandt === 0 && r2.verworfen.length === 1, 'zweimal dasselbe Hex: die zweite Wirkung wird verworfen');
  // Kern pur: ohne crew läuft der Kern wie vorher (Parität prüft npm run sim:welt-paritaet)
  const a = Kriegslage.abbild(z(neu().g));
  ok(!JSON.stringify(a).includes('"crew"'), 'ohne Crew-Posten kommt crew im Sim-Zustand nirgends vor (Parität zum Prototyp)');
  ok(JSON.stringify(Object.keys(vor.hexe[FREI])) === JSON.stringify(['besitzer', 'posten', 'garnison', 'abwehr', 'anspruch']), 'Hex-Felder vor der Wirkung unverändert');
});

section('Kern: Ertrag und crew', () => {
  const Daten = require('../server/weltsim/daten.js');
  const d = Daten.laden();
  const frisch = () => Kern.erzeuge({ karte: d.karte, werte: d.werte, seed: 5 });
  // Rom bekommt von einem Posten in 0505 (Quelle N) +prod Nahrung je Tick, vom Vorposten der Crew nichts, vom ausgebauten Sim-Posten weiter
  const nahrung = (mod) => { const z = frisch(); z.vorrat.rom.N = 10; mod(z.hexe[FREI]); z.flotten = []; Kern.tick(z, {}); return z.vorrat.rom.N; };
  const prod = frisch().werte.prod;
  const ohne = nahrung(() => {});
  const sim = nahrung((nd) => Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 4 }));
  const crewGegruendet = nahrung((nd) => Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 4, crew: true, ohneErtrag: true }));
  const crewAusgebaut = nahrung((nd) => Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 4, crew: true }));
  ok(Math.abs(sim - ohne - prod) < 0.5, `Sim-Posten liefert die Quelle: +${(sim - ohne).toFixed(2)} Nahrung (prod ${prod}, abzüglich Verbrauch der Besatzung)`);
  ok(Math.abs(sim - crewGegruendet - prod) < 0.01, `von der Crew gegründeter Posten (ohneErtrag) liefert der Sim nichts: ${prod} weniger als der Sim-Posten (Messung: sonst über dem SUND-01-Band)`);
  ok(crewAusgebaut === sim, 'ausgebauter Sim-Posten (crew ohne ohneErtrag) behält seinen Ertrag');
  // Wirkung gründet mit beiden Merkmalen, Ausbau nur mit crew
  const z1 = frisch(); const k = { z: z1, d: Daten.datenVon(z1), w: z1.werte, ev: [] };
  Kern.WIRKUNGEN.posten_gehisst(k, { typ: 'posten_gehisst', ort: FREI });
  ok(z1.hexe[FREI].crew === true && z1.hexe[FREI].ohneErtrag === true, 'posten_gehisst: crew und ohneErtrag');
  const z2 = frisch(); Object.assign(z2.hexe[FREI], { posten: true, besitzer: 'rom', garnison: 1 }); const k2 = { z: z2, d: Daten.datenVon(z2), w: z2.werte, ev: [] };
  Kern.WIRKUNGEN.posten_ausgebaut(k2, { typ: 'posten_ausgebaut', ort: FREI });
  ok(z2.hexe[FREI].crew === true && z2.hexe[FREI].ohneErtrag === undefined && z2.hexe[FREI].garnison === z2.werte.garrison, 'posten_ausgebaut: crew, kein ohneErtrag, Garnison aufgefüllt');
  // Verlust räumt beide Merkmale
  const z3 = frisch(); Object.assign(z3.hexe[FREI], { posten: true, besitzer: 'rom', garnison: 4, crew: true, ohneErtrag: true });
  ok(z3.hexe[FREI].crew && (Kern.WIRKUNGEN.ort_gefallen || true), 'Ausgangslage Verlust');
  const fl = { id: z3.naechsteId++, fraktion: 'ger', heimat: '1004', ort: FREI, staerke: 20, kap: 20, befehl: 'angriff', ziel: FREI, warte: 0, versorgung: 1, angriff: z3.naechsteAngriffId };
  z3.flotten.push(fl); z3.angriffe.push({ id: z3.naechsteAngriffId++, t0: 0, ziel: FREI, von: 'ger', art: 'reich', relevant: true, zielArt: 'posten', t_an: 0, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: 0, stuetz: null, flotten: [fl.id] });
  const k3 = { z: z3, d: Daten.datenVon(z3), w: z3.werte, ev: [] };
  Kern.WIRKUNGEN.ort_gefallen(k3, { typ: 'ort_gefallen', ort: FREI, an: 'ger' });
  ok(z3.hexe[FREI].posten === false && z3.hexe[FREI].crew === undefined && z3.hexe[FREI].ohneErtrag === undefined, 'Verlust: posten, crew und ohneErtrag weg');
});

section('Atomar: Rollback', () => {
  const { g } = bereit();
  const simVor = kopie(Kriegslage.abbild(z(g))); const rufVor = kopie(g.weltsim.ruf); const tk = g.weltsim.tickZahl; const teile = g.inventory.ersatzteil; const postenVor = kopie(g.weltsim.posten);
  kernWirft = true; console.warn = () => {};
  const e = Posten.gruendenStart(g, g.players[0]);
  run(g, PW.gruenden.wert.dauer + 1.5);
  console.warn = warnOrig; kernWirft = false;
  ok(!e && !halt(g), 'Halteprozess lief zu Ende');
  ok(gleich(Kriegslage.abbild(z(g)), simVor) && gleich(g.weltsim.ruf, rufVor) && g.weltsim.tickZahl === tk && gleich(g.weltsim.posten, postenVor), 'wirft der Tick: Sim, Ruf, Tickzähler und Postenliste wie vorher');
  ok(g.inventory.ersatzteil === teile, 'wirft der Tick: keine Ersatzteile abgebucht (Ablehnen kostet nichts)');
  ok(g.weltBesitz.hexe[FREI].posten === false && !g.weltBesitz.hexe[FREI].crew, 'Overlay ohne Posten');
  // wirft erst die Anwendung des Rufs (nach dem Kern und der Postenliste): auch die Postenliste geht auf die Sicherung zurück
  { const anw = Ruf.anwenden; Ruf.anwenden = function (gm, w) { anw.call(Ruf, gm, w); throw new Error('Test: Ruf wirft'); };
    console.warn = () => {}; Posten.gruendenStart(g, g.players[0]); run(g, PW.gruenden.wert.dauer + 1.5); console.warn = warnOrig; Ruf.anwenden = anw;
    ok(gleich(Kriegslage.abbild(z(g)), simVor) && gleich(g.weltsim.ruf, rufVor) && gleich(g.weltsim.posten, postenVor) && g.inventory.ersatzteil === teile, 'wirft erst der Ruf: Sim, Ruf, Postenliste und Ersatzteile wie vorher (ein Atom)'); }
  // ein zweiter Versuch gelingt
  g.errors = 0;
  ok(!gruenden(g) && z(g).hexe[FREI].crew === true && g.inventory.ersatzteil === teile - PW.gruenden.wert.kosten.ersatzteil, 'nach dem Fehlschlag gelingt der nächste Versuch, Ersatzteile erst jetzt abgebucht');
});

section('Weigerungsgründe (Gründen)', () => {
  const grund = (g) => { const e = Posten.gruendenPruefen(g, false); return e ? e.code : null; };
  const text = (g) => { const e = Posten.gruendenPruefen(g, false); return e ? e.text : null; };
  let t = bereit(); let g = t.g;
  ok(grund(g) === null, 'Ausgangslage: alles erfüllt, kein Grund');
  ok(PW.mindestrang.wert.gruenden === 'miles' && (g.weltsim.ruf.rom = 0, grund(g) === null), 'Daten: Gründen verlangt keinen Rang (miles, siehe _hinweis: das Gründen ist die Quelle des ersten Rangs); Miles gründet');
  { const alt = PW.mindestrang.wert.gruenden; PW.mindestrang.wert.gruenden = 'optio';   // der Mechanismus bei einem Rang als Bedingung (Daten ändern wirkt ohne Code)
    g.weltsim.ruf.rom = rangAb('optio') - 1; ok(grund(g) === 'rang' && /Optio/.test(text(g)), 'Rang knapp darunter: „Dafür fehlt der Rang (Optio)“'); g.weltsim.ruf.rom = rangAb('optio'); ok(grund(g) === null, 'Rang genau Optio: frei');
    PW.mindestrang.wert.gruenden = alt; g.weltsim.ruf.rom = rangAb('optio'); }
  g.inventory.ersatzteil = PW.gruenden.wert.kosten.ersatzteil - 1; ok(grund(g) === 'teile' && /Ersatzteile/.test(text(g)), 'zu wenig Ersatzteile'); g.inventory.ersatzteil = PW.gruenden.wert.kosten.ersatzteil; ok(grund(g) === null, 'genau genug Ersatzteile: frei');
  g.ship.speed = PW.gruenden.wert.tempo + 1; ok(grund(g) === 'schnell', 'zu schnell'); g.ship.speed = PW.gruenden.wert.tempo; ok(grund(g) === null, 'genau das Höchsttempo: frei'); g.ship.speed = 0;
  anPosten(g, FREI, PW.gruenden.wert.radius + 5); ok(grund(g) === 'weit' && /von/.test(text(g)), 'zu weit vom Postenplatz'); anPosten(g, FREI, PW.gruenden.wert.radius - 5); ok(grund(g) === null, 'knapp im Ring: frei'); anPosten(g, FREI);
  g.ship.systems.transfer = 'broken'; ok(grund(g) === 'transfer', 'Transfer zerstört'); g.ship.systems.transfer = 'ok';
  g.ship.docked = true; ok(grund(g) === 'docked', 'angedockt: erst ablegen'); g.ship.docked = false;
  Space.spawnEnemy(g, 'raider', { x: 100, y: 100 }); ok(grund(g) === 'gegner', 'Gegner im Sektor'); g.space.enemies = [];
  const fl = flotte(g, FREI, 'pirat', 4); ok(grund(g) === 'gegner', 'feindliche Flotte der Sim im Hex'); z(g).flotten.splice(z(g).flotten.indexOf(fl), 1);
  { const fx = flotte(g, FREI, 'ger', 6); require('../server/sim/kriegslage-szene.js').betreten(g, FREI); ok(grund(g) === 'szene', 'Sim-Szene läuft'); require('../server/sim/kriegslage-szene.js').verlassen(g, 'test'); z(g).flotten.splice(z(g).flotten.indexOf(fx), 1); g.simSzene = null; }
  Fracht.state(g).halt = { kind: 'an', id: 'x', t: 0, dur: 3 }; ok(grund(g) === 'laeuft', 'ein anderer Transfer läuft'); Fracht.state(g).halt = null;
  z(g).hexe[FREI].besitzer = 'ger'; z(g).hexe[FREI].posten = true; ok(grund(g) === 'belegt', 'Sektor besetzt'); z(g).hexe[FREI].besitzer = null; z(g).hexe[FREI].posten = false;
  // andere Hexe
  ankunft(g, GER1); anPosten(g, GER1); ok(grund(g) === 'anspruch' && /Roms Anspruch/.test(text(g)), 'Hex im germanischen Anspruch: „Dieser Sektor liegt nicht in Roms Anspruch“');
  ankunft(g, STATION); anPosten(g, STATION); ok(grund(g) === 'station' && /Station/.test(text(g)), 'Hex mit Station (Kantenstein): kein Posten');
  ankunft(g, OSTIA); ok(['station', 'hafen', 'anspruch'].includes(grund(g)), 'römischer Hafen: kein Posten (' + grund(g) + ')');
  ankunft(g, '0605'); ok(grund(g) === 'station', 'Pulverhorn (Station und Dock): kein Posten');
  ankunft(g, FREI2); anPosten(g, FREI2); ok(grund(g) === null, 'Gasfeld 0503 (Roms Anspruch): möglich');
  // Reihenfolge der Starts: der Befehl liefert denselben Text
  ankunft(g, GER1); anPosten(g, GER1); ok(Posten.gruendenStart(g, g.players[0]) === TEXTE.gruenden.weigerung.anspruch && !halt(g), 'weapons.posten.gruenden liefert den Weigerungstext, kein Halteprozess');
  // Kampagne: kein Modus
  const k = neu({ start: 'free' }); ok(Posten.gruendenPruefen(k.g, false).code === 'modus' && Posten.ausbauPruefen(k.g, false).code === 'modus' && Posten.snapshot(k.g) === null, 'Kampagne: Modus-Weigerung, kein space.po');
});

section('Halteprozess: Erfolg und Abbrüche', () => {
  let t = bereit(); let g = t.g;
  const teile = g.inventory.ersatzteil; const rufVor = rom(g); const tk = g.weltsim.tickZahl;
  ok(Posten.gruendenStart(g, g.players[0]) === null && halt(g) && halt(g).kind === 'posten' && halt(g).id === 'gruenden', 'Start: Halteprozess kind posten');
  run(g, PW.gruenden.wert.dauer / 2);
  const sn = g.snapshot();
  ok(sn.fracht && sn.fracht.halt && sn.fracht.halt.kind === 'posten' && sn.fracht.halt.id === 'gruenden' && sn.fracht.halt.p > 0.3 && sn.fracht.halt.p < 0.8, `Snapshot fracht.halt mit Fortschritt (${sn.fracht && sn.fracht.halt && sn.fracht.halt.p})`);
  ok(z(g).hexe[FREI].posten === false && g.inventory.ersatzteil === teile, 'mitten im Prozess: noch nichts gebaut, nichts bezahlt');
  run(g, PW.gruenden.wert.dauer / 2 + 1);
  const nd = z(g).hexe[FREI];
  ok(!halt(g) && nd.posten && nd.besitzer === 'rom' && nd.crew === true, 'Abschluss: Posten steht (Rom, crew)');
  ok(g.weltsim.tickZahl === tk + 1, 'genau ein Tick');
  ok(g.inventory.ersatzteil === teile - PW.gruenden.wert.kosten.ersatzteil, 'Kosten erst jetzt gebucht: ' + PW.gruenden.wert.kosten.ersatzteil + ' Ersatzteil');
  ok(rom(g) === rufVor + RUF.quellen.wert.posten_gehisst.delta, `Ruf Rom +${RUF.quellen.wert.posten_gehisst.delta} (Grund posten_gehisst)`);
  ok(g.weltBesitz.hexe[FREI].crew === true && Besitz.crewPosten(g, FREI) && g.errors === 0, 'Overlay, keine Fehler');
  ok(g.weltsim.posten[FREI] && g.weltsim.posten[FREI].t === z(g).tick, 'Aufsatz merkt den Zeitpunkt (Posten halten)');
  // Abbrüche: Start, dann Störung -> kein Posten, keine Kosten, kein Tick, kein Ruf
  const fall = (name, stoere, erwartet, ohneTeile) => {
    const b = bereit(); const gg = b.g; const k0 = gg.inventory.ersatzteil; const r0 = rom(gg); const t0 = gg.weltsim.tickZahl;
    Posten.gruendenStart(gg, gg.players[0]); run(gg, 3);
    const odaVor = gg.snapshot && 0;
    const radios = []; const emit = gg.emit.bind(gg); gg.emit = (kind, d) => { if (kind === 'oda') radios.push(d && d.text); return emit(kind, d); };
    stoere(gg);
    run(gg, 1);
    const weg = !halt(gg) && z(gg).hexe[FREI].posten === false;
    run(gg, PW.gruenden.wert.dauer + 2);
    ok(weg && z(gg).hexe[FREI].posten === false && (ohneTeile || gg.inventory.ersatzteil === k0) && gg.weltsim.tickZahl === t0 && rom(gg) === r0, `Abbruch: ${name} – Prozess weg, kein Posten, nichts bezahlt, kein Tick, kein Ruf`);
    if (erwartet) ok(radios.some((x) => x === erwartet), `Abbruch: ${name} – Meldung „${erwartet}“`);
  };
  const AB = TEXTE.gruenden.abbruch;
  fall('feindliche Flotte erscheint', (gg) => { flotte(gg, FREI, 'ger', 6); }, AB.gegner);
  fall('Gegner im Raum', (gg) => { Space.spawnEnemy(gg, 'raider', { x: 100, y: 100 }); }, AB.gegner);
  fall('Szene beginnt', (gg) => { flotte(gg, FREI, 'ger', 6); require('../server/sim/kriegslage-szene.js').betreten(gg, FREI); ok(gg.simSzene && gg.simSzene.phase === 'vorwarnung', 'echte Sim-Szene im Hex'); }, AB.szene);
  fall('Ring verlassen', (gg) => { anPosten(gg, FREI, PW.gruenden.wert.radius + 50); }, AB.ring);
  fall('zu schnell', (gg) => { gg.ship.vx = PW.gruenden.wert.tempo + 20; gg.ship.speed = gg.ship.vx; }, AB.schnell);
  fall('Transfer fällt aus', (gg) => { gg.ship.systems.transfer = 'broken'; }, null, true);   // die Bot-Automatik der Technik repariert danach mit einem Ersatzteil: nur der Prozess zählt
  fall('Sektor wird besetzt', (gg) => { z(gg).hexe[FREI].besitzer = 'pirat'; }, AB.belegt);
  // Ops verlassen
  { const b = bereit(); const gg = b.g; const k0 = gg.inventory.ersatzteil; Posten.gruendenStart(gg, gg.players[0]); run(gg, 3); gg.players[0].console = null; run(gg, 1);
    ok(!halt(gg) && !z(gg).hexe[FREI].posten && gg.inventory.ersatzteil === k0, 'Abbruch: niemand mehr an der Ops'); }
  // Sprung
  { const b = bereit(); const gg = b.g; ohneFlottenAlle(gg); const k0 = gg.inventory.ersatzteil; Posten.gruendenStart(gg, gg.players[0]); run(gg, 3);
    const e = springe(gg, '0504'); run(gg, 1);
    ok(!e && !halt(gg) && !z(gg).hexe[FREI].posten && gg.inventory.ersatzteil === k0, 'Abbruch: Sprung beendet den Prozess (Szenenwechsel)' + (e ? ' ' + e : '')); }
  // Sprung und Ops verlassen melden sich (A1-Fix), der Abbruch durch den Spieler bleibt still
  { const b = bereit(); const gg = b.g; ohneFlottenAlle(gg); const odas = []; const emit = gg.emit.bind(gg); gg.emit = (kind, d) => { if (kind === 'oda') odas.push(d && d.text); return emit(kind, d); };
    Posten.gruendenStart(gg, gg.players[0]); run(gg, 3); springe(gg, '0504'); run(gg, 1);
    ok(odas.includes(TEXTE.gruenden.abbruch.sprung), 'Sprung: Meldung „' + TEXTE.gruenden.abbruch.sprung + '“');
    const c2 = bereit(); const g2 = c2.g; const o2 = []; const e2 = g2.emit.bind(g2); g2.emit = (kind, d) => { if (kind === 'oda') o2.push(d && d.text); return e2(kind, d); };
    Posten.gruendenStart(g2, g2.players[0]); run(g2, 3); g2.players[0].console = null; run(g2, 1);
    ok(o2.includes(TEXTE.gruenden.abbruch.ops), 'Ops verlassen: Meldung „' + TEXTE.gruenden.abbruch.ops + '“');
    const c3 = bereit(); const g3 = c3.g; const o3 = []; const e3 = g3.emit.bind(g3); g3.emit = (kind, d) => { if (kind === 'oda') o3.push(d && d.text); return e3(kind, d); };
    Posten.gruendenStart(g3, g3.players[0]); run(g3, 2); Fracht.beamStop(g3, 'abgebrochen'); run(g3, 1);
    ok(o3.filter((t) => /abgebrochen/.test(t || '')).length === 0, 'Abbrechen durch den Spieler: keine Meldung'); }
  // Abbrechen per weapons.fracht off
  { const b = bereit(); const gg = b.g; Posten.gruendenStart(gg, gg.players[0]); run(gg, 2); Fracht.beamStop(gg, 'abgebrochen'); run(gg, PW.gruenden.wert.dauer);
    ok(!halt(gg) && !z(gg).hexe[FREI].posten, 'Abbrechen durch den Spieler (weapons.fracht off): kein Posten'); }
  // Ersatzteile fehlen erst am Ende (verbraucht in der Zwischenzeit)
  { const b = bereit(); const gg = b.g; Posten.gruendenStart(gg, gg.players[0]); run(gg, 3); gg.inventory.ersatzteil = 0; run(gg, PW.gruenden.wert.dauer);
    ok(!halt(gg) && !z(gg).hexe[FREI].posten, 'Ersatzteile unterwegs verbraucht: kein Posten'); }
});
function ohneFlottenAlle(g) { z(g).flotten = z(g).flotten.filter((f) => !['0504', FREI].includes(f.ort)); }
function springe(g, hex) {
  const von = Sektoren.hexVonOrt(g.ship.scene);
  g.explore.markBoje(Sektoren.kanteId(von, hex)); g.explore.erkunde(hex);
  const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return 'Ziel: ' + e;
  const p = Sprung.sprungpunkt(g, hex); const s = g.ship; s.x = p.x - 80; s.y = p.y; s.vx = 0; s.vy = 0; s.speed = 0;
  s.jump.charge = 1; s.jump.ready = true;
  return Sprung.doJump(g);
}

section('Dock am Stützpunkt', () => {
  const { g } = bereit(); gruenden(g);
  const sc = szene(FREI);
  ok(!sc.dock && !sc.station, 'die Szene selbst hat kein Dock (geteiltes Objekt, nie verändert)');
  const dl = Besitz.dockLage(g, sc, FREI); const pl = Besitz.postenLage(sc);
  ok(dl && dl.x === pl.x && dl.y === pl.y + pl.r + PW.dock.wert.abstand, `Dock berechnet: unter dem Posten (${dl && dl.x},${dl && dl.y})`);
  ok(!sc.dock && Object.keys(sc).join() === Object.keys(szene(FREI)).join(), 'Szene danach unverändert');
  ok(Besitz.darfAndocken(g, FREI) && Besitz.verbotText(g, FREI) === null, 'darfAndocken am Stützpunkt');
  Space.enterScene(g, Sektoren.ortVonHex(FREI), {}); ab(g);
  ok(g.space.markers.some((m) => m.kind === 'dock' && m.x === dl.x && m.y === dl.y) && g.space.markers.some((m) => m.posten), 'Szene bei Ankunft: Dock-Marker und Posten-Marker');
  ok(g.space.dockOk === true, 'dockOk');
  // Anflug zu schnell: kein Andocken; langsam: Andocken
  Object.assign(g.ship, { x: dl.x, y: dl.y - 30, vx: 0, vy: 0, speed: CONFIG.travel.dockSpeed + 20 }); g.ship.dockArmed = true; g.ship.helm.stage = 1;
  Space.updateFlight ? 0 : 0; run(g, 0.2);
  Object.assign(g.ship, { x: dl.x, y: dl.y - 30, vx: 0, vy: 0, speed: 0 }); run(g, 0.3);
  ok(g.ship.docked === true && g.ship.dockedAt === 'brachland', 'langsam im Dock-Ring: angedockt, dockedAt = Orts-ID des Hexes (brachland)');
  ok(Math.abs(g.ship.x - dl.x) < 1 && Math.abs(g.ship.y - dl.y) < 1, 'Schiff liegt am Dock');
  // Ablegen
  g.ship.helm.stage = 5; run(g, 0.5);
  ok(g.ship.docked === false && g.ship.dockedAt === null, 'Ablegen möglich');
  // Sim-Posten ohne crew: kein Dock
  const t2 = neu(); const g2 = t2.g; const nd = z(g2).hexe[FREI]; nd.posten = true; nd.besitzer = 'rom'; nd.garnison = 4; Kriegslage.szeneAbschliessen(g2, { wirkungen: [], wo: 'test' });
  ok(g2.weltBesitz.hexe[FREI].posten === true && !g2.weltBesitz.hexe[FREI].crew, 'Sim-Posten Rom ohne crew im Overlay');
  ok(Besitz.dockLage(g2, szene(FREI), FREI) === null && !Besitz.darfAndocken(g2, FREI) && /kein Dock/.test(Besitz.verbotText(g2, FREI)), 'Sim-Posten ohne crew: kein Dock, Andocken verweigert mit Text „kein Dock“');
  ankunft(g2, FREI); ok(!g2.space.markers.some((m) => m.kind === 'dock') && g2.space.markers.some((m) => m.posten), 'Sim-Posten: Posten-Marker, aber kein Dock-Marker');
  anPosten(g2, FREI, 0); run(g2, 1); ok(!g2.ship.docked, 'Sim-Posten: auch direkt am Posten nicht andockbar');
  // Posten ohne Garnison: kein Stützpunkt
  const t3 = neu(); const g3 = t3.g; Object.assign(z(g3).hexe[FREI], { posten: true, besitzer: 'rom', garnison: 1, crew: true });
  Kriegslage.restore(g3, Kriegslage.toSave(g3));   // baut das Overlay ohne Tick neu
  ok(Besitz.crewPosten(g3, FREI), 'Stützpunkt mit Garnison: Overlay crew');
  z(g3).hexe[FREI].garnison = 0; Kriegslage.restore(g3, Kriegslage.toSave(g3));
  ok(!Besitz.crewPosten(g3, FREI) && Besitz.dockLage(g3, szene(FREI), FREI) === null && !Besitz.darfAndocken(g3, FREI), 'ohne Garnison kein Stützpunkt: kein Overlay-crew, kein Dock');
  // Overlay mit fremdem Besitzer: kein Stützpunkt der Crew, auch wenn crew gesetzt ist
  { const e = g.weltBesitz.hexe[FREI]; const alt = kopie(e); e.besitzer = 'ger'; ok(!Besitz.crewPosten(g, FREI) && Besitz.dockLage(g, szene(FREI), FREI) === null, 'fremder Besitzer im Overlay: kein Stützpunkt'); Object.assign(e, alt); }
  // Stützpunkt fällt, während die Lerche im Hex fliegt: Dock- und Posten-Marker verschwinden sofort
  { const b = bereit(); const gg = b.g; gruenden(gg);
    ok(gg.space.markers.some((m) => m.kind === 'dock') && gg.space.markers.some((m) => m.posten), 'nach dem Gründen im Hex: Dock-Marker und Posten-Marker erscheinen sofort (ohne neue Ankunft)');
    flotte(gg, FREI, 'ger', 20, true);
    Kriegslage.szeneAbschliessen(gg, { wirkungen: [{ typ: 'ort_gefallen', ort: FREI, an: 'ger' }], wo: 'test' });
    ok(!gg.space.markers.some((m) => m.kind === 'dock') && !gg.space.markers.some((m) => m.posten), 'Posten gefallen, Lerche im Hex: Dock-Marker und Posten-Marker sind weg'); }
  // Kampagne: Dock unverändert
  const k = neu({ start: 'free' }); const kg = k.g;
  ok(Besitz.dockLage(kg, Locations.get('hafen').scene, null) === Locations.get('hafen').scene.dock, 'Kampagne: dockLage = sc.dock (unverändert)');
});

section('Werft und Handel am Stützpunkt', () => {
  const { g } = bereit(); gruenden(g);
  const dl = Besitz.dockLage(g, szene(FREI), FREI);
  Object.assign(g.ship, { x: dl.x, y: dl.y, vx: 0, vy: 0, speed: 0 }); g.ship.dockArmed = true; run(g, 0.3);
  ok(g.ship.docked && g.ship.dockedAt === 'brachland', 'angedockt');
  ok(Werft.istFlottenbasis(g, 'brachland') && Werft.status(g).aktiv === true, 'Werft aktiv (abgeleitet)');
  ok(!(g.mission.flags && g.mission.flags.flottenbasis_brachland), 'kein gespeichertes Flottenbasis-Flag (setzeFlottenbasis nicht benutzt)');
  g.inventory.marks = 5000;
  const e1 = Werft.freischalten(g, g.players[0], 'stufe', 1);
  ok(e1 === null && Werft.istFrei(g, 'stufe', 1), 'Freischalten am Stützpunkt möglich (Ruf-Feld erlaubt)');
  const marks = g.inventory.marks;
  const sh = Shop.buy(g, g.players[0], 'ersatzteil');
  ok(sh === TEXTE.dock.handel && g.inventory.marks === marks, `Handel gesperrt mit Grund: „${sh}“, nichts gebucht`);
  // Snapshot-Block werft meldet den Grund
  g.players[0].console = 'shop';
  const sn = g.snapshot();
  ok(sn.werft && sn.werft.aktiv === true && sn.werft.hs === TEXTE.dock.handel, 'Snapshot werft: aktiv, hs = Handel gesperrt (Text)');
  // Nicht-Werft-Hafen: Handel geht, Werft nicht
  const k = bereit(); const g2 = k.g; ankunft(g2, '0405'); g2.ship.docked = true; g2.ship.dockedAt = Sektoren.ortVonHex('0405');
  ok(Werft.status(g2).code === 'keine_flottenbasis' && /Nur an Flottenbasen/.test(Werft.status(g2).grund), 'Hafen ohne Werft: „Nur an Flottenbasen“ (wie PAN-01)');
  ok(Shop.buy(g2, g2.players[0], 'ersatzteil') !== TEXTE.dock.handel, 'Hafen ohne Werft: Handel wie bisher');
  // Posten fällt -> Werft weg, Freigeschaltetes bleibt
  ok(g.weltsim.posten[FREI], 'Posten registriert');
  g.ship.docked = false; g.ship.dockedAt = null;
  ankunft(g, '0504');   // abseits, nicht gedockt
  ohneFlotten(g, FREI); flotte(g, FREI, 'ger', 20, true);
  const rr = Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'ort_gefallen', ort: FREI, an: 'ger' }], wo: 'test' });
  ok(rr.ok && rr.angewandt === 1 && z(g).hexe[FREI].posten === false && z(g).hexe[FREI].crew === undefined, 'Posten gefallen: frei, Merkmal crew weg (kein Erbe für den nächsten Posten)');
  ok(!g.weltBesitz.hexe[FREI].crew && !Werft.istFlottenbasis(g, 'brachland'), 'Werft ist weg (abgeleitet, nichts zu löschen)');
  ok(Werft.istFrei(g, 'stufe', 1) && g.ship.freigeschaltet.stufe >= 1, 'Freigeschaltetes bleibt');
  g.ship.docked = true; g.ship.dockedAt = 'brachland';
  const um = Werft.umbau(g, g.players[0], 8, 'lanze');
  ok(um && um.code === 'keine_flottenbasis', 'Umbau ohne Werft abgelehnt (Code keine_flottenbasis)');
  ok(!(g.weltsim.posten && g.weltsim.posten[FREI]), 'Postenliste trägt den gefallenen Posten aus (beim nächsten Tick)');
  // Neugründung durch die Sim erbt nichts
  const nd = z(g).hexe[FREI]; Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 4 });
  ok(nd.crew === undefined, 'ein neuer Sim-Posten an derselben Stelle hat kein crew');
});

section('A1-Fix: Stützpunkt fällt, während die Lerche angedockt ist', () => {
  const dockAn = (gg) => { const dl = Besitz.dockLage(gg, szene(FREI), FREI); Object.assign(gg.ship, { x: dl.x, y: dl.y - 20, vx: 0, vy: 0, speed: 0 }); gg.ship.dockArmed = true; run(gg, 0.4); };
  for (const weg of ['ort_gefallen', 'notrufErledigt']) {
    const b = bereit(); const gg = b.g; gruenden(gg); dockAn(gg);
    ok(gg.ship.docked && gg.ship.dockedAt === 'brachland', `${weg}: angedockt am Stützpunkt`);
    gg.players[0].console = 'shop';
    const odas = []; const emit = gg.emit.bind(gg); gg.emit = (kind, d) => { if (kind === 'oda') odas.push(d && d.text); return emit(kind, d); };
    const marks = gg.inventory.marks; const teile = gg.inventory.ersatzteil; gg.errors = 0;
    if (weg === 'ort_gefallen') { flotte(gg, FREI, 'ger', 20, true); Kriegslage.szeneAbschliessen(gg, { wirkungen: [{ typ: 'ort_gefallen', ort: FREI, an: 'ger' }], wo: 'test' }); }
    else { Object.assign(z(gg).hexe[FREI], { posten: false, besitzer: null, garnison: 0 }); delete z(gg).hexe[FREI].crew; delete z(gg).hexe[FREI].ohneErtrag; gg.missionEvent('notrufErledigt', { id: 'x', wahrheit: 'echt' }); }
    ok(z(gg).hexe[FREI].posten === false, `${weg}: der Posten ist weg`);
    run(gg, 3);
    ok(gg.errors === 0, `${weg}: keine Fehler in 3 s (Server ${gg.errors})`);
    ok(gg.ship.docked === false && gg.ship.dockedAt === null, `${weg}: die Lerche hat abgelegt`);
    ok(odas.some((t) => t === TEXTE.dock.verloren), `${weg}: Meldung „${TEXTE.dock.verloren}“`);
    ok(gg.players[0].console !== 'shop', `${weg}: niemand sitzt mehr am Hafenterminal`);
    ok(!gg.space.markers.some((m) => m.kind === 'dock'), `${weg}: kein Dock-Marker mehr`);
    ok(Shop.buy(gg, gg.players[0], 'ersatzteil') !== null && gg.inventory.marks === marks && gg.inventory.ersatzteil === teile, `${weg}: Kauf am gefallenen Posten nicht möglich, nichts gebucht`);
    ok(Besitz.handelSperre(gg, FREI) === TEXTE.dock.handel, `${weg}: Hex ohne Hafen hat nie Handel (auch ohne Stützpunkt)`);
    gg.ship.docked = true; gg.ship.dockedAt = 'brachland';
    ok(Shop.buy(gg, gg.players[0], 'ersatzteil') === TEXTE.dock.handel && gg.inventory.marks === marks, `${weg}: selbst bei gesetztem dockedAt kein Handel`);
    gg.ship.docked = false; gg.ship.dockedAt = null;
  }
  // Regression: updateFlight wirft auch mit angedocktem Schiff ohne Dock nicht (generierte Szene ohne sc.start)
  { const b = bereit(); const gg = b.g; gg.ship.docked = true; gg.ship.dockedAt = 'brachland'; gg.errors = 0; run(gg, 1); ok(gg.errors === 0, 'angedockt ohne Dock und ohne sc.start: updateFlight wirft nicht'); }
});

section('A1-Fix: Wissen, Ruf-Grund, Speichertakt, Halten ohne Eintrag, Minen, Rückfall', () => {
  const Alarm = require('../server/sim/alarm.js');
  // Wissen von Rom: der Crew-Posten steht als Meldung „Posten gegründet“ (pg) in der Lage
  { const b = bereit(); const gg = b.g; gruenden(gg);
    const W = gg.weltsim.wissen;
    ok(W.meldungen.some((m) => m.e === 'pg' && m.h === FREI && m.f === 'r'), 'Wissen von Rom: Meldung „Posten gegründet“ (pg) für Brachland, römisch (aus posten_gehisst)');
    ok(W.hexe[FREI] && W.hexe[FREI].f === 'r' && W.hexe[FREI].p === 1, 'Wissen von Rom: Brachland als römischer Posten bekannt'); }
  // Ruf-Grund: die Wirkung trägt den Grund posten_gehisst (nicht nur den Wert)
  { const b = bereit(); const gg = b.g; const gruende = []; const anw = Ruf.anwenden;
    Ruf.anwenden = function (gm, w) { for (const x of w || []) if (x.typ === 'ruf_aenderung') gruende.push(x.grund); return anw.apply(Ruf, arguments); };
    try { gruenden(gg); } finally { Ruf.anwenden = anw; }
    ok(gruende.length === 1 && gruende[0] === 'posten_gehisst', 'Ruf-Wirkung beim Gründen mit Grund posten_gehisst (' + gruende.join() + ')');
    const c = sim2(); const gc = c.g; const gr2 = []; Ruf.anwenden = function (gm, w) { for (const x of w || []) if (x.typ === 'ruf_aenderung') gr2.push(x.grund); return anw.apply(Ruf, arguments); };
    try { Posten.ausbauenStart(gc, gc.players[0]); run(gc, PW.ausbau.wert.dauer + 1.5); } finally { Ruf.anwenden = anw; }
    ok(gr2.length === 1 && gr2[0] === 'posten_ausgebaut', 'Ruf-Wirkung beim Ausbau mit Grund posten_ausgebaut (' + gr2.join() + ')'); }
  // Speichertakt: nach dem Gründen und Ausbau wird der Weltstand am Tick-Ende gespeichert (kein Absturz bis zum nächsten Takt)
  { const b = bereit(); const gg = b.g; let n1 = 0; const mk = gg.markSaveDue.bind(gg); gg.markSaveDue = (k) => { if (k === 'docked') n1++; return mk(k); };
    gruenden(gg); ok(n1 >= 1, 'Gründen löst markSaveDue(docked) aus');
    const c = sim2(); const gc = c.g; let n2 = 0; const mk2 = gc.markSaveDue.bind(gc); gc.markSaveDue = (k) => { if (k === 'docked') n2++; return mk2(k); };
    Posten.ausbauenStart(gc, gc.players[0]); run(gc, PW.ausbau.wert.dauer + 1.5); ok(n2 >= 1, 'Ausbau löst markSaveDue(docked) aus'); }
  // Crew-Posten ohne Eintrag (Debug, Altstand): zählt ab dem ersten Tick, danach gibt es den Halten-Ruf
  { const { g: gg } = neu(); Object.assign(z(gg).hexe[FREI], { posten: true, besitzer: 'rom', garnison: 4, crew: true }); gg.weltsim.posten = {};
    const r0 = rom(gg); Kriegslage.szeneAbschliessen(gg, { wirkungen: [], wo: 'test' });
    ok(gg.weltsim.posten[FREI] && gg.weltsim.posten[FREI].t === z(gg).tick, 'Crew-Posten ohne Eintrag bekommt beim nächsten Tick einen');
    for (let i = 0; i < PW.halten_ticks.wert; i++) Kriegslage.szeneAbschliessen(gg, { wirkungen: [], wo: 'test' });
    ok(rom(gg) === r0 + RUF.quellen.wert.posten_gehalten.delta, 'und nach halten_ticks den einmaligen Halten-Ruf'); }
  // Minen meiden das Dock des Stützpunkts
  { const b = bereit(); const gg = b.g; gruenden(gg); const dl = Besitz.dockLage(gg, szene(FREI), FREI);
    const ms = Alarm.minenSetzen(gg, { n: 40, x: dl.x, y: dl.y, radius: 330, besitzer: 'gegner' });
    ok(ms.length > 0 && ms.every((m) => Math.hypot(m.x - dl.x, m.y - dl.y) >= 260), `Minen halten Abstand zum Stützpunkt-Dock (${ms.length} gesetzt, nächste ${Math.round(Math.min(...ms.map((m) => Math.hypot(m.x - dl.x, m.y - dl.y))))} px ≥ 260)`); }
});
function sim2() { const b = bereit({ rang: 'centurio' }); const nd = z(b.g).hexe[FREI]; Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 2 }); Kriegslage.szeneAbschliessen(b.g, { wirkungen: [], wo: 'test' }); anPosten(b.g, FREI); return b; }

section('Laden, Altstand', () => {
  const t = bereit(); const g = t.g; gruenden(g);
  const dl = Besitz.dockLage(g, szene(FREI), FREI);
  Object.assign(g.ship, { x: dl.x, y: dl.y, vx: 0, vy: 0, speed: 0 }); g.ship.dockArmed = true; run(g, 0.3);
  ok(g.ship.docked && g.ship.dockedAt === 'brachland', 'angedockt am Stützpunkt');
  g.game = g; g.updateWeltstand && g.updateWeltstand(0.1);
  const d1 = kopie(Weltstand.capture(g));
  ok(d1.ort.angedockt === 'brachland' && d1.version === 3 && Weltstand.validate(d1).length === 0, 'gespeichert: ort.angedockt = brachland, Version 3, schemagültig' + (Weltstand.validate(d1).join('; ') ? ' ' + Weltstand.validate(d1).join('; ') : ''));
  ok(d1.welt.sim.zustand.hexe[FREI].crew === true && d1.welt.sim.posten && d1.welt.sim.posten[FREI], 'welt.sim: crew im Hex, Postenzeiten als welt.sim.posten (additiv)');
  const dir = freshDir(); d1.id = 'w-crew'; fs.writeFileSync(path.join(dir, 'w-crew.json'), JSON.stringify(d1));
  const t2 = neu({ dir, world: 'w-crew' }); const g2 = t2.g;
  ok(g2.phase === 'play' && g2.weltsim && g2.errors === 0, 'Laden ohne Fehler');
  ok(g2.ship.docked === true && g2.ship.dockedAt === 'brachland' && g2.ship.scene === 'brachland', 'nach dem Laden angedockt am Stützpunkt (nicht im All)');
  ok(Werft.status(g2).aktiv === true && g2.weltBesitz.hexe[FREI].crew === true && Besitz.darfAndocken(g2, FREI), 'Werft aktiv, Overlay crew, Dock erlaubt');
  ok(gleich(g2.weltsim.posten, g.weltsim.posten), 'Postenzeiten geladen');
  const d2 = kopie(Weltstand.capture(g2));
  ok(gleich(d2.welt.sim.zustand.hexe, d1.welt.sim.zustand.hexe) && gleich(d2.welt.sim.posten, d1.welt.sim.posten) && d2.ort.angedockt === 'brachland', 'Runde Speichern, Laden, Speichern: gleich');
  // Posten ist weg (Stand ohne crew): Rückfall
  const weg = kopie(d1); weg.welt.sim.zustand.hexe[FREI] = Object.assign({}, weg.welt.sim.zustand.hexe[FREI], { posten: false, besitzer: null, garnison: 0, anspruch: {} }); delete weg.welt.sim.zustand.hexe[FREI].crew; delete weg.welt.sim.posten; weg.id = 'w-weg';
  fs.writeFileSync(path.join(dir, 'w-weg.json'), JSON.stringify(weg));
  let lastNachLaden = null; const t3 = neu({ dir, world: 'w-weg', vorRun: (gg) => { lastNachLaden = gg.weltstand.lastDockedAt; } }); const g3 = t3.g;
  ok(g3.phase === 'play' && g3.errors === 0 && g3.ship.docked === true && g3.ship.dockedAt === Sektoren.ortVonHex(Sektoren.vorerkundetBeiStart ? OSTIA : OSTIA), `Posten weg beim Laden: Rückfall auf den Startort (${g3.ship.dockedAt}), angedockt`);
  ok(!Werft.istFlottenbasis(g3, 'brachland') || g3.ship.dockedAt !== 'brachland', 'keine Werft am gefallenen Posten');
  ok(lastNachLaden === OSTIA_ORT, 'Rückfall schreibt ws.lastDockedAt sofort beim Laden (vor dem ersten Tick): ' + lastNachLaden);
  ok(g3.weltstand.lastDockedAt === g3.ship.dockedAt && g3.weltstand.lastDockedAt !== 'brachland', 'Rückfall schreibt ws.lastDockedAt (der nächste Speicherstand zeigt nicht auf den toten Stützpunkt): ' + g3.weltstand.lastDockedAt);
  // Altstand von sund02b: weder crew noch posten-Block
  const alt = kopie(d1); delete alt.welt.sim.posten; for (const nd of Object.values(alt.welt.sim.zustand.hexe)) delete nd.crew;
  alt.ort.angedockt = 'ostia_nova'; alt.id = 'w-alt'; fs.writeFileSync(path.join(dir, 'w-alt.json'), JSON.stringify(alt));
  const t4 = neu({ dir, world: 'w-alt' }); const g4 = t4.g;
  ok(g4.phase === 'play' && g4.weltsim && g4.errors === 0 && gleich(g4.weltsim.posten, {}) && crewHexe(g4).length === 0 && Weltstand.validate(alt).length === 0, 'Altstand ohne crew und ohne posten-Block lädt unverändert');
  const d4 = kopie(Weltstand.capture(g4));
  ok(!('posten' in d4.welt.sim) && !JSON.stringify(d4).includes('"crew":true'), 'ohne Crew-Posten kein posten-Block und kein crew (Altstand-gleich)');
  // Müll im Block
  for (const bl of ['x', [1], { '0505': 'x', '12': { t: 3 }, '0503': { t: -1 }, '0703': { t: NaN } }, null]) ok(gleich(Posten.lesen(bl), {}), 'Müll-fester Leser: ' + JSON.stringify(bl));
  ok(gleich(Posten.lesen({ '0505': { t: 7.9, g: 1 } }), { '0505': { t: 7, g: 1 } }), 'Leser: gültiger Eintrag bleibt');
});

section('Stützpunkt-Ausbau', () => {
  const sim = (o) => { const b = bereit(Object.assign({ rang: 'centurio' }, o)); const nd = z(b.g).hexe[FREI]; Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 2 }); Kriegslage.szeneAbschliessen(b.g, { wirkungen: [], wo: 'test' }); anPosten(b.g, FREI); return b; };
  const grund = (g) => { const e = Posten.ausbauPruefen(g, false); return e ? e.code : null; };
  let { g } = sim();
  ok(grund(g) === null && z(g).hexe[FREI].crew === undefined, 'römischer Sim-Posten: Ausbau möglich');
  g.weltsim.ruf.rom = rangAb('centurio') - 1; ok(grund(g) === 'rang', 'Rang darunter: Weigerung (Centurio nötig)'); g.weltsim.ruf.rom = rangAb('centurio');
  g.weltsim.ruf.rom = rangAb('optio'); ok(grund(g) === 'rang' && Posten.gruendenPruefen(g, false) === null || grund(g) === 'rang', 'Optio darf gründen, aber nicht ausbauen'); g.weltsim.ruf.rom = rangAb('centurio');
  g.inventory.ersatzteil = PW.ausbau.wert.kosten.ersatzteil - 1; ok(grund(g) === 'teile', 'zu wenig Ersatzteile (Ausbau kostet ' + PW.ausbau.wert.kosten.ersatzteil + ')'); g.inventory.ersatzteil = 4;
  ok(Posten.gruendenPruefen(g, false).code === 'belegt', 'dort gründen geht nicht (Posten steht schon)');
  const teile = g.inventory.ersatzteil; const r0 = rom(g); const tk = g.weltsim.tickZahl;
  ok(Posten.ausbauenStart(g, g.players[0]) === null && halt(g).id === 'ausbau', 'Ausbau startet (Halteprozess ausbau)');
  run(g, PW.ausbau.wert.dauer / 2); ok(z(g).hexe[FREI].crew === undefined, 'mittendrin noch kein Stützpunkt');
  run(g, PW.ausbau.wert.dauer / 2 + 1.5);
  const nd = z(g).hexe[FREI];
  ok(nd.crew === true && nd.posten && nd.besitzer === 'rom' && nd.garnison >= z(g).werte.garrison - 1, `Stützpunkt: crew true, Garnison mindestens ${z(g).werte.garrison} (${nd.garnison})`);
  ok(g.weltsim.tickZahl === tk + 1 && g.inventory.ersatzteil === teile - PW.ausbau.wert.kosten.ersatzteil && rom(g) === r0 + RUF.quellen.wert.posten_ausgebaut.delta, 'ein Tick, Kosten gebucht, Ruf +' + RUF.quellen.wert.posten_ausgebaut.delta);
  ok(Besitz.crewPosten(g, FREI) && grund(g) === 'schon', 'danach: Dock/Werft möglich, weiterer Ausbau „schon Stützpunkt“');
  // Prüfer der Wirkung
  const { g: g2 } = neu(); const zz = z(g2); const pr = (wk) => Wirkungen.pruefe(zz, wk);
  ok(!pr({ typ: 'posten_ausgebaut', ort: FREI }).ok, 'Wirkung ungültig ohne Posten');
  Object.assign(zz.hexe[FREI], { posten: true, besitzer: 'rom', garnison: 2 }); ok(pr({ typ: 'posten_ausgebaut', ort: FREI }).ok, 'gültig mit römischem Posten');
  zz.hexe[FREI].besitzer = 'ger'; ok(!pr({ typ: 'posten_ausgebaut', ort: FREI }).ok, 'ungültig: germanischer Posten'); zz.hexe[FREI].besitzer = 'rom';
  zz.hexe[FREI].crew = true; ok(!pr({ typ: 'posten_ausgebaut', ort: FREI }).ok, 'ungültig: schon ein Stützpunkt'); delete zz.hexe[FREI].crew;
  const fl = flotte(g2, FREI, 'pirat', 3); ok(!pr({ typ: 'posten_ausgebaut', ort: FREI }).ok, 'ungültig: Gegner im Hex'); zz.flotten.splice(zz.flotten.indexOf(fl), 1);
  ok(!pr({ typ: 'posten_ausgebaut', ort: OSTIA }).ok && !pr({ typ: 'posten_ausgebaut', ort: '0000' }).ok, 'ungültig: Hafen, unbekannter Ort');
  // Atomar mit Rollback
  const b = sim(); const gg = b.g; const sv = kopie(Kriegslage.abbild(z(gg))); const k0 = gg.inventory.ersatzteil;
  kernWirft = true; console.warn = () => {}; Posten.ausbauenStart(gg, gg.players[0]); run(gg, PW.ausbau.wert.dauer + 1.5); console.warn = warnOrig; kernWirft = false;
  ok(gleich(Kriegslage.abbild(z(gg)), sv) && gg.inventory.ersatzteil === k0, 'Ausbau: wirft der Tick, bleibt alles wie vorher und kostet nichts');
  // Abbruch: Gegner
  const c = sim(); const cg = c.g; Posten.ausbauenStart(cg, cg.players[0]); run(cg, 3); flotte(cg, FREI, 'ger', 5); run(cg, 1);
  ok(!halt(cg) && cg.inventory.ersatzteil === 4 && z(cg).hexe[FREI].crew === undefined, 'Ausbau: Gegner im Hex bricht ab, kostet nichts');
});

section('Posten halten', () => {
  const { g } = bereit(); gruenden(g);
  const N = PW.halten_ticks.wert; const q = RUF.quellen.wert.posten_gehalten.delta;
  const r0 = rom(g); const t0 = g.weltsim.posten[FREI].t;
  const odas = []; const emit = g.emit.bind(g); g.emit = (kind, d) => { if (kind === 'oda') odas.push(d && d.text); return emit(kind, d); };
  const tick = () => Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'test' });
  while (z(g).tick - t0 < N - 1) tick();
  ok(rom(g) === r0 && !g.weltsim.posten[FREI].g, `vor ${N} Ticks noch kein Ruf`);
  tick();
  ok(rom(g) === r0 + q && g.weltsim.posten[FREI].g === 1, `nach ${N} Ticks einmalig +${q} Ruf`);
  ok(odas.some((x) => /hält seit/.test(x)), 'Meldung „Posten … hält seit …“');
  for (let i = 0; i < 5; i++) tick();
  ok(rom(g) === r0 + q, 'nicht noch einmal');
  const d = kopie(Weltstand.capture(g));
  ok(d.welt.sim.posten[FREI].g === 1, 'gespeichert mit g (schon belohnt)');
  // Posten fällt: Eintrag weg, kein Ruf
  const { g: g2 } = bereit(); gruenden(g2);
  const r2 = rom(g2);
  ohneFlotten(g2, FREI); flotte(g2, FREI, 'ger', 20, true);
  Kriegslage.szeneAbschliessen(g2, { wirkungen: [{ typ: 'ort_gefallen', ort: FREI, an: 'ger' }], wo: 'test' });
  ok(!g2.weltsim.posten[FREI] && rom(g2) === r2, 'gefallener Posten: Eintrag weg, kein Halten-Ruf');
  // wird er halb gehalten und fällt, gibt es nichts
  for (let i = 0; i < N + 2; i++) Kriegslage.szeneAbschliessen(g2, { wirkungen: [], wo: 'test' });
  ok(rom(g2) === r2, 'auch später nicht');
});

section('Anzeige space.po', () => {
  const { g } = bereit();
  let po = g.snapshot().space.po;
  ok(po && po.k === 'g' && po.ok === 1 && po.n === PW.gruenden.wert.kosten.ersatzteil && po.t === undefined, 'freies Hex in Roms Anspruch: k g, ok 1, ohne Text');
  anPosten(g, FREI, 900); po = g.snapshot().space.po; ok(po.ok === 0 && /Zu weit/.test(po.t), 'zu weit: ok 0 mit Text');
  anPosten(g, FREI);
  ankunft(g, GER1); anPosten(g, GER1); po = g.snapshot().space.po; ok(po && po.ok === 0 && /Anspruch/.test(po.t), 'germanischer Anspruch: Text „… nicht in Roms Anspruch“');
  ankunft(g, STATION); ok(g.snapshot().space.po === undefined && Posten.gruendenStart(g, g.players[0]) === TEXTE.gruenden.weigerung.station, 'Station: kein Feld, der Befehl liefert die Weigerung „Station“');
  ankunft(g, OSTIA); ok(g.snapshot().space.po === undefined, 'Hafen: keine Anzeige');
  ankunft(g, '0504'); ok(g.snapshot().space.po === undefined, 'Hafen des Konkordats: keine Anzeige');
  // römischer Sim-Posten: Ausbau
  ankunft(g, FREI); anPosten(g, FREI); const nd = z(g).hexe[FREI]; Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 3 }); Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'test' });
  po = g.snapshot().space.po; ok(po && po.k === 'a' && po.ok === 0 && /Rang/.test(po.t), 'römischer Posten, Rang Optio: Ausbau mit Text „Rang“');
  g.weltsim.ruf.rom = rangAb('centurio'); po = g.snapshot().space.po; ok(po.k === 'a' && po.ok === 1 && po.n === PW.ausbau.wert.kosten.ersatzteil, 'Centurio: Ausbau möglich');
  Object.assign(nd, { crew: true }); Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'test' }); ok(g.snapshot().space.po === undefined, 'Stützpunkt: keine Anzeige');
  const b = Buffer.byteLength(JSON.stringify({ k: 'g', ok: 0, t: TEXTE.gruenden.weigerung.weit, n: 1 }));
  ok(b < 120, `space.po ist klein (${b} B)`);
});

section('Kampagne und Limes unverändert', () => {
  for (const start of ['free', 'arena_space']) {
    const { g } = neu({ start });
    ok(!g.weltsim && g.snapshot().space.po === undefined, `${start}: kein Modus, kein space.po`);
    ok(Besitz.crewPosten(g, FREI) === false && Besitz.handelSperre(g, FREI) === null, `${start}: kein Stützpunkt, kein Handelsverbot`);
    for (const id of ['hafen', 'vaelen']) { const l = Locations.get(id); ok(!l || Besitz.dockLage(g, l.scene, null) === (l.scene && l.scene.dock || null), `${start}: dockLage ${id} = sc.dock`); }
    ok(Posten.gruendenStart(g, g.players[0]) === TEXTE.gruenden.weigerung.modus, `${start}: Befehl lehnt ab (nur Freie Fahrt Sund)`);
    ok(Werft.istFlottenbasis(g, 'hafen') === !!Locations.get('hafen').flottenbasis, `${start}: Flottenbasis-Prüfung wie vorher`);
  }
  const d = kopie(Weltstand.capture(neu({ start: 'free' }).g));
  ok(!JSON.stringify(d).includes('"crew":true') && !(d.welt && d.welt.sim), 'Kampagnen-Weltstand ohne crew und ohne welt.sim');
});

console.log(`\n${n} Prüfungen, ${fails} Fehler`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
