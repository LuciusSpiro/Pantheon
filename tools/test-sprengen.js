'use strict';
// SUND-02b A2: Posten sprengen (Crew-Angriffsszene, server/sim/posten.js angreifen*, kriegslage-szene.js angriffStarten, Wirkung posten_gesprengt in server/weltsim/wirkungen.js,
// Daten content/welt/posten-werte.json angreifen/sprengen, Ruf-Quellen posten_gesprengt_*). Direkt gegen die Game-Klasse, ohne Netz (Mehrspieler: tools/test-sprengen-ws.js).
//   Daten · Wirkung gültig/ungültig und Reihenfolge · Weigerungsgründe · Halteprozess und Abbrüche · Szene baut Wellen aus der Garnison · Sieg/Flucht/Niederlage mit Wirkungen und genau einem Tick ·
//   atomar mit Rollback · Ruf nur bei Sieg, Sperre gegen Farmen · Verbündete · eigener Crew-Posten ist kein Ziel · Laden/Altstand · Anzeige (space.po, Szenenzeile) · Kampagne unverändert
//   node tools/test-sprengen.js [begriff …]   (npm run test:sprengen)
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
const Plan = require('../server/weltsim/wellenplan.js');
const Wirkungen = require('../server/weltsim/wirkungen.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const Besitz = require('../server/sim/besitz.js');
const Ruf = require('../server/sim/ruf.js');
const Posten = require('../server/sim/posten.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
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
const SZT = require('../content/flotte/sim-szene.json');
const RAENGE = RUF.raenge.wert;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sprengen-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const HZ = CONFIG.tickHz;
const GER1 = '0703', GER2 = '0705', FREI = '0505', STATION = '0603', OSTIA = '0305';
const HEIMAT = { ger: '1004', pirat: '0602', kon: '0604' };
const rangAb = (id) => RAENGE.find((r) => r.id === id).ab;

// Zähler am Kern: Ticks und ihre Wirkungen; kernWirft lässt den nächsten Tick scheitern
let kernTicks = 0; let letzterTick = null; let kernWirft = false;
const kernOrig = Kern.tick;
Kern.tick = function (z, o) {
  kernTicks++;
  letzterTick = { vor: Kriegslage.abbild(z), wirkungen: (o && o.wirkungen) || [] };
  if (kernWirft) throw new Error('Test: Tick wirft');
  return kernOrig.apply(this, arguments);
};
const warnOrig = console.warn;

function neu(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: o.dir || freshDir(), seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (o.crew || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'X' + i, name: 'X' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: o.start || 'freie_fahrt', ...(o.world ? { world: o.world } : {}) });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 1);
  g.space.enemies = [];
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  const funk = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
  const oda = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'oda').map((m) => m.text);
  return { g, cs, funk, oda };
}
const run = (g, sek, each) => { for (let i = 0; i < Math.round(sek * HZ); i++) { if (each) each(i); g.step(); } };
const z = (g) => g.weltsim.zustand;
const rom = (g) => Ruf.ruf(g, 'rom');
const ops = (g) => { g.players[0].console = 'weapons'; g.players[0].station = null; };
function ab(g) { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }
function ankunft(g, hex) { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); }
const szene = (hex) => Locations.get(Sektoren.ortVonHex(hex)).scene;
function anPosten(g, hex, dx) { const p = Besitz.postenLage(szene(hex)); Object.assign(g.ship, { x: p.x + (dx || 0), y: p.y, vx: 0, vy: 0, speed: 0 }); }
// Posten eines Gegners in der Sim (Fixture am Zustand)
function postenSetzen(g, hex, besitzer, garnison) { Object.assign(z(g).hexe[hex], { besitzer, posten: true, garnison: garnison == null ? 4 : garnison, anspruch: {} }); }
// Partie am germanischen Posten mit Ops, Lerche im Ring und langsam
function bereit(o) {
  const op = o || {};
  const t = neu(op); const g = t.g;
  g.weltsim.ruf.rom = rangAb(op.rang || 'miles');
  const hex = op.hex || GER1;
  postenSetzen(g, hex, op.besitzer || 'ger', op.garnison);
  ohneFlotten(g, hex);
  ankunft(g, hex); ops(g); run(g, 0.2); anPosten(g, hex);
  return t;
}
const ohneFlotten = (g, hex) => { const st = z(g); st.flotten = st.flotten.filter((f) => f.ort !== hex); };
function flotte(g, hex, fraktion, staerke) {
  const st = z(g);
  const fl = { id: st.naechsteId++, fraktion, heimat: HEIMAT[fraktion] || hex, ort: hex, staerke, kap: Math.max(staerke, 5), befehl: 'rueckzug', ziel: null, warte: 0, versorgung: 1, angriff: null };
  fl.ziel = fl.heimat; st.flotten.push(fl); return fl;
}
const halt = (g) => g.fracht && g.fracht.halt;
const grund = (g) => { const e = Posten.angreifenPruefen(g, false); return e ? e.code : null; };
const text = (g) => { const e = Posten.angreifenPruefen(g, false); return e ? e.text : null; };
const kill = (g, e) => { e.hp = 1; Space.damageEnemy(g, e, 500, e.x - 100, e.y, {}); };
const killAlle = (g, ohneFlagg) => { for (const e of g.space.enemies.slice()) if (!(ohneFlagg && e.flagg)) kill(g, e); };
function angriff(g) { const e = Posten.angreifenStart(g, g.players[0]); if (e) return e; run(g, PW.angreifen.wert.dauer + 1.5); return null; }   // Anlauf bis zum Abschluss
// Wellen abräumen bis zum Ende der Szene (Sieg)
function durchspielen(g, maxSek) {
  for (let i = 0; i < (maxSek || 400) * HZ; i++) { if (g.space.enemies.length) killAlle(g); g.step(); if (!g.simSzene) return true; }
  return !g.simSzene;
}
const hatEreignis = (g, typ) => g.weltsim.ereignisse.filter((e) => e.typ === typ);
function springe(g, hex) {
  const von = Sektoren.hexVonOrt(g.ship.scene);
  g.explore.markBoje(Sektoren.kanteId(von, hex)); g.explore.erkunde(hex);
  const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return 'Ziel: ' + e;
  const p = Sprung.sprungpunkt(g, hex); const s = g.ship; s.x = p.x - 80; s.y = p.y; s.vx = 0; s.vy = 0; s.speed = 0;
  s.jump.charge = 1; s.jump.ready = true;
  return Sprung.doJump(g);
}
const ANG = PW.angreifen.wert;
const Q_GER = RUF.quellen.wert.posten_gesprengt_ger, Q_PIRAT = RUF.quellen.wert.posten_gesprengt_pirat;

section('Daten und Texte', () => {
  neu();
  ok(ANG.dauer > 0 && ANG.radius > 0 && ANG.tempo > 0 && ANG.vorlauf >= 0 && ANG.staerke_faktor > 0 && ANG.kosten && typeof ANG.kosten === 'object', 'angreifen: Dauer, Radius, Tempo, Vorlauf, Stärkefaktor, Kosten sind Daten');
  ok(PW.sprengen.wert.garnison_max > 0 && PW.sprengen.wert.garnison_max <= 0.5 && PW.sprengen.wert.ruf_sperre_ticks > 0, 'sprengen: Garnison-Grenze (höchstens 0,5, wie der Kern ab 0,5) und Ruf-Sperre sind Daten');
  ok(RAENGE.some((r) => r.id === PW.mindestrang.wert.angreifen), 'Mindestrang des Angriffs ist ein bekannter Rang (' + PW.mindestrang.wert.angreifen + ')');
  for (const q of [Q_GER, Q_PIRAT]) ok(q && q.fraktion === 'rom' && q.delta > 0 && q.delta <= RUF.delta_max.wert, 'Ruf-Quelle ' + (q === Q_GER ? 'posten_gesprengt_ger' : 'posten_gesprengt_pirat') + ': Rom, positiv, unter delta_max');
  ok(Q_GER.folge && Q_GER.folge.ger < 0 && !Q_PIRAT.folge, 'Folge: Germanen sinken, Piraten kennen keinen Ruf');
  const codes = ['modus', 'rang', 'kein_posten', 'eigener', 'neutral', 'station', 'hafen', 'gegner', 'szene', 'weit', 'schnell', 'teile', 'docked', 'transfer', 'laeuft'];
  ok(codes.every((c) => typeof TEXTE.angreifen.weigerung[c] === 'string' && TEXTE.angreifen.weigerung[c].length > 5), 'jeder Weigerungsgrund hat einen Text');
  ok(['gegner', 'szene', 'ring', 'schnell', 'transfer', 'belegt', 'teile', 'sprung', 'ops'].every((c) => typeof TEXTE.angreifen.abbruch[c] === 'string'), 'jeder Abbruchgrund hat einen Text');
  const A = SZT.angriff;
  ok(A && /\{ort\}/.test(A.vorwarnung.text) && /\{sek\}/.test(A.vorwarnung.text) && /\{ort\}/.test(A.sieg.text) && A.niederlage.frei && A.kommandant && A.zeile.kopf === 'ANGRIFF AUF POSTEN', 'Szenentexte: Vorwarnung, Sieg „Posten gesprengt“, Niederlage, Szenenzeile');
  ok(PW.anspruch.wert.ger.every((h) => !PW.anspruch.wert.rom.includes(h)), 'Ziele der Germanen (0703, 0705) liegen nie in Roms Anspruch');
});

section('Wirkung posten_gesprengt: Prüfer und Anwender', () => {
  const { g } = neu(); const zz = z(g);
  const pr = (wk) => Wirkungen.pruefe(zz, wk);
  ok(Wirkungen.KATALOG.posten_gesprengt && !Wirkungen.istAufsatz('posten_gesprengt'), 'im Katalog, im Kern angewandt (kein Aufsatz)');
  postenSetzen(g, GER1, 'ger', 0.4); ok(pr({ typ: 'posten_gesprengt', ort: GER1 }).ok, 'gültig: germanischer Posten mit Garnison 0,4');
  postenSetzen(g, GER2, 'pirat', 0); ok(pr({ typ: 'posten_gesprengt', ort: GER2 }).ok, 'gültig: Piratenposten ohne Garnison');
  const nein = (wk, t) => { const r = pr(wk); ok(!r.ok && typeof r.grund === 'string' && r.grund.length > 0, 'ungültig: ' + t + (r.grund ? ' (' + r.grund + ')' : '')); };
  postenSetzen(g, GER1, 'ger', 0.5 + 0.2); nein({ typ: 'posten_gesprengt', ort: GER1 }, 'Garnison noch 0,7 (über der Grenze)');
  postenSetzen(g, GER1, 'ger', 4); nein({ typ: 'posten_gesprengt', ort: GER1 }, 'volle Garnison: einfaches Sprengen gibt es nicht');
  postenSetzen(g, GER1, 'ger', PW.sprengen.wert.garnison_max); ok(pr({ typ: 'posten_gesprengt', ort: GER1 }).ok, 'genau an der Grenze: gültig');
  postenSetzen(g, FREI, 'rom', 0); nein({ typ: 'posten_gesprengt', ort: FREI }, 'römischer Posten (Rom ist kein Ziel, Beschuss auf Rom ist Paket E)');
  Object.assign(z(g).hexe[FREI], { crew: true, ohneErtrag: true }); nein({ typ: 'posten_gesprengt', ort: FREI }, 'eigener Crew-Posten');
  postenSetzen(g, '0503', 'kon', 0); nein({ typ: 'posten_gesprengt', ort: '0503' }, 'Posten des Konkordats (neutral)');
  nein({ typ: 'posten_gesprengt', ort: '0504' }, 'Hex ohne Posten (Hafen des Konkordats)');
  nein({ typ: 'posten_gesprengt', ort: OSTIA }, 'römischer Hafen');
  z(g).hexe[GER2].posten = false; nein({ typ: 'posten_gesprengt', ort: GER2 }, 'Hex ohne Posten');
  z(g).hexe[GER2].posten = true; z(g).hexe[GER2].besitzer = null; nein({ typ: 'posten_gesprengt', ort: GER2 }, 'Posten ohne Besitzer');
  nein({ typ: 'posten_gesprengt', ort: '9999' }, 'unbekannter Ort'); nein({ typ: 'posten_gesprengt' }, 'Ort fehlt'); nein({ typ: 'posten_gesprengt', ort: 5 }, 'Ort keine Zeichenkette'); nein({ typ: 'posten_gesprengt', ort: 'constructor' }, 'Ort „constructor“');
  // Reihenfolge im Paket: abwehr_verlust (alles) zuerst, dann posten_gesprengt: beide gelten; andersherum gilt die Sprengung nicht
  postenSetzen(g, GER1, 'ger', 3.2);
  const f1 = Kern.filtereWirkungen(zz, [{ typ: 'abwehr_verlust', ort: GER1, punkte: 3.2 }, { typ: 'posten_gesprengt', ort: GER1 }]);
  ok(f1.gueltig.length === 2 && f1.verworfen.length === 0, 'im selben Paket nach abwehr_verlust: beide Wirkungen gültig');
  const f2 = Kern.filtereWirkungen(zz, [{ typ: 'posten_gesprengt', ort: GER1 }, { typ: 'abwehr_verlust', ort: GER1, punkte: 3.2 }]);
  ok(f2.gueltig.length === 1 && f2.gueltig[0].typ === 'abwehr_verlust' && f2.verworfen.length === 1, 'vor abwehr_verlust: die Sprengung wird verworfen (Garnison noch zu stark)');
  // Anwender: Hex frei, Ereignis, ein Tick
  const tk = g.weltsim.tickZahl;
  const r = Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'abwehr_verlust', ort: GER1, punkte: 3.2 }, { typ: 'posten_gesprengt', ort: GER1 }], wo: 'test' });
  const nd = z(g).hexe[GER1];
  ok(r.ok && r.angewandt === 2 && g.weltsim.tickZahl === tk + 1, 'angewandt, genau ein Tick');
  ok(nd.posten === false && nd.besitzer === null && nd.garnison === 0 && gleich(nd.anspruch, {}), 'Hex frei: kein Posten, kein Besitzer, Garnison 0');
  ok(r.ereignisse.some((e) => e.typ === 'posten_verloren' && e.ort === GER1 && e.besitzer === 'ger' && e.durch === 'rom'), 'Ereignis posten_verloren { besitzer ger, durch rom }');
  ok(g.weltBesitz.hexe[GER1].posten === false && g.weltBesitz.hexe[GER1].besitzer === 'frei', 'Overlay: frei, kein Posten');
  ok(g.weltsim.sprengungen && g.weltsim.sprengungen[GER1] === z(g).tick, 'Aufsatz merkt den Tick der Sprengung (Ruf-Sperre)');
  // Kern pur
  ok(!JSON.stringify(Kriegslage.abbild(z(neu().g))).includes('"crew"') && !JSON.stringify(Kriegslage.abbild(z(neu().g))).includes('sprengungen'), 'ohne Sprengung kommt im Sim-Zustand nichts Neues vor (Parität zum Prototyp)');
  // Wirkung auf einen Crew-Posten, auch nach Verlusten, bleibt abgelehnt (eigener Posten ist nicht sprengbar)
  const { g: g2 } = neu(); Object.assign(z(g2).hexe[FREI], { posten: true, besitzer: 'rom', garnison: 0, crew: true, ohneErtrag: true });
  const r2 = Kriegslage.szeneAbschliessen(g2, { wirkungen: [{ typ: 'posten_gesprengt', ort: FREI }], wo: 'test' });
  ok(r2.ok && r2.angewandt === 0 && r2.verworfen.length === 1 && z(g2).hexe[FREI].crew === true, 'Crew-Posten: Sprengung wird im Tick verworfen, der Posten steht');
});

section('Weigerungsgründe', () => {
  const t = bereit(); const g = t.g;
  ok(grund(g) === null, 'Ausgangslage am germanischen Posten: alles erfüllt');
  ok(PW.mindestrang.wert.angreifen === 'miles', 'Daten: Angreifen verlangt keinen Rang (Kann, nie Muss; niedriger Rang genügt)');
  { const alt = PW.mindestrang.wert.angreifen; PW.mindestrang.wert.angreifen = 'centurio';   // der Mechanismus (Daten ändern wirkt ohne Code)
    g.weltsim.ruf.rom = rangAb('centurio') - 1; ok(grund(g) === 'rang' && /Centurio/.test(text(g)), 'Rang knapp darunter: „Dafür fehlt der Rang (Centurio)“'); g.weltsim.ruf.rom = rangAb('centurio'); ok(grund(g) === null, 'Rang genau erreicht: frei');
    PW.mindestrang.wert.angreifen = alt; g.weltsim.ruf.rom = 0; }
  g.ship.speed = ANG.tempo + 1; ok(grund(g) === 'schnell', 'zu schnell'); g.ship.speed = ANG.tempo; ok(grund(g) === null, 'genau das Höchsttempo: frei'); g.ship.speed = 0;
  anPosten(g, GER1, ANG.radius + 5); ok(grund(g) === 'weit' && /von/.test(text(g)), 'zu weit vom Posten'); anPosten(g, GER1, ANG.radius - 5); ok(grund(g) === null, 'knapp im Ring: frei'); anPosten(g, GER1);
  g.ship.systems.transfer = 'broken'; ok(grund(g) === 'transfer', 'Transfer zerstört'); g.ship.systems.transfer = 'ok';
  g.ship.docked = true; ok(grund(g) === 'docked', 'angedockt: erst ablegen'); g.ship.docked = false;
  Space.spawnEnemy(g, 'raider', { x: 100, y: 100 }); ok(grund(g) === 'gegner', 'Gegner im Sektor'); g.space.enemies = [];
  const fl = flotte(g, GER1, 'pirat', 4); ok(grund(g) === 'gegner', 'feindliche Flotte der Sim im Hex'); z(g).flotten.splice(z(g).flotten.indexOf(fl), 1);
  Fracht.state(g).halt = { kind: 'an', id: 'x', t: 0, dur: 3 }; ok(grund(g) === 'laeuft', 'ein anderer Transfer läuft'); Fracht.state(g).halt = null;
  // andere Ziele
  ankunft(g, FREI); ok(grund(g) === 'kein_posten' && /kein Posten/.test(text(g)), 'freies Hex: „Hier steht kein Posten“');
  postenSetzen(g, FREI, 'rom', 4); ankunft(g, FREI); anPosten(g, FREI); ok(grund(g) === 'eigener' && /römischer Posten/.test(text(g)), 'römischer Posten: „… kein Ziel“');
  Object.assign(z(g).hexe[FREI], { crew: true, ohneErtrag: true }); ok(grund(g) === 'eigener', 'eigener Crew-Posten: kein Ziel');
  Object.assign(z(g).hexe[FREI], { besitzer: 'kon', crew: undefined }); delete z(g).hexe[FREI].crew; ok(grund(g) === 'neutral' && /neutral/.test(text(g)), 'Posten des Konkordats: neutral');
  postenSetzen(g, FREI, 'pirat', 2); ok(grund(g) === null, 'Piratenposten: Ziel');
  ankunft(g, STATION); postenSetzen(g, STATION, 'ger', 4); anPosten(g, STATION); ok(grund(g) === 'station' && /Station/.test(text(g)), 'Hex mit Station: kein Angriff');
  ankunft(g, OSTIA); ok(['station', 'kein_posten'].includes(grund(g)), 'römischer Hafen: kein Ziel (' + grund(g) + ')');
  // Szene läuft
  ankunft(g, GER1); anPosten(g, GER1); z(g).hexe[GER1].posten = true; z(g).hexe[GER1].besitzer = 'ger'; z(g).hexe[GER1].garnison = 4;
  ok(angriff(g) === null && g.simSzene && g.simSzene.modus === 'angriff', 'Angriff läuft');
  ok(grund(g) === 'szene', 'während der Szene: „Feindkontakt – erst die Gegner abwehren“');
  ok(Posten.gruendenPruefen(g, false).code !== null && Posten.ausbauPruefen(g, false).code !== null, 'Gründen und Ausbau sind in der Szene ebenfalls gesperrt');
  // Befehl liefert denselben Text
  const t2 = bereit(); const g2 = t2.g; ankunft(g2, FREI); anPosten(g2, FREI);
  ok(Posten.angreifenStart(g2, g2.players[0]) === TEXTE.angreifen.weigerung.kein_posten && !halt(g2), 'weapons.posten.angreifen liefert den Weigerungstext, kein Halteprozess');
  // Kampagne: kein Modus
  const k = neu({ start: 'free' }); ok(Posten.angreifenPruefen(k.g, false).code === 'modus' && Posten.angreifenStart(k.g, k.g.players[0]) === TEXTE.angreifen.weigerung.modus && Posten.snapshot(k.g) === null, 'Kampagne: Modus-Weigerung, kein space.po');
  // über den echten Befehl des Spiels
  const t3 = bereit(); const g3 = t3.g; const k0 = kernTicks;
  g3.handleMessage(t3.cs[0], { t: 'cmd', c: 'weapons.posten.angreifen' });
  ok(halt(g3) && halt(g3).kind === 'posten' && halt(g3).id === 'angreifen' && kernTicks === k0, 'Befehl weapons.posten.angreifen startet den Halteprozess (kein Tick)');
});

section('Auslösung: nur durch die Crew, nie durch Ankunft', () => {
  const t = neu(); const g = t.g; g.weltsim.ruf.rom = 0;
  postenSetzen(g, GER1, 'ger', 4); ohneFlotten(g, GER1);
  const k0 = kernTicks;
  ankunft(g, GER1);
  ok(!g.simSzene, 'Ankunft am germanischen Posten ohne Flotte: keine Szene');
  run(g, 30);
  ok(!g.simSzene && !halt(g) && kernTicks === k0 && z(g).hexe[GER1].posten === true && z(g).hexe[GER1].garnison === 4, '30 s im Hex: nichts geschieht, kein Tick, der Posten steht (Ruf ist ein Kann)');
  ok(Szene.letzte(g) === null, 'keine Szene gemerkt');
  // Ops besetzt, nichts gedrückt: auch nichts
  ops(g); anPosten(g, GER1); run(g, 20); ok(!g.simSzene && !halt(g), 'Ops besetzt, im Ring: ohne Befehl keine Szene');
  // Szene durch die Crew
  g.weltsim.ruf.rom = 0;
  const e = Posten.angreifenStart(g, g.players[0]);
  ok(e === null && halt(g) && halt(g).id === 'angreifen' && halt(g).dur === ANG.dauer, `Anlauf startet (Dauer ${ANG.dauer} s aus den Daten)`);
  run(g, ANG.dauer / 2); ok(!g.simSzene && halt(g), 'mitten im Anlauf: noch keine Szene');
  const sn = g.snapshot(); ok(sn.fracht && sn.fracht.halt && sn.fracht.halt.id === 'angreifen' && sn.fracht.halt.p > 0.3 && sn.fracht.halt.p < 0.8, `Snapshot fracht.halt mit Fortschritt (${sn.fracht && sn.fracht.halt && sn.fracht.halt.p})`);
  run(g, ANG.dauer / 2 + 1.5);
  ok(!halt(g) && g.simSzene && g.simSzene.modus === 'angriff' && g.simSzene.phase === 'vorwarnung', 'nach dem Anlauf: Angriffsszene in der Vorwarnung');
  ok(kernTicks === k0, 'Beginn der Szene ist kein Tick');
  ok(z(g).hexe[GER1].posten === true && z(g).hexe[GER1].garnison === 4, 'Posten steht noch (die Welt ändert sich erst am Ende der Szene)');
  ok(g.ship.docked === false && g.space.dockOk !== undefined, 'Andocken: nicht möglich (Szene)');
});

section('Szene baut die Wellen aus der Garnison', () => {
  const t = bereit(); const g = t.g; angriff(g);
  const S = g.simSzene;
  const erw = Math.max(1, 4 * ANG.staerke_faktor);
  const plan = Plan.plane({ staerke: erw, seed: S.seed, volk: 'ger', kommandant: { name: SZT.angriff.kommandant, volk: 'ger', zug: '' } });
  ok(S && S.fraktion === 'ger' && S.ort === null && S.garn0 === 4, 'Szene: Fraktion ger, Garnison zu Beginn 4');
  ok(S.planPunkte === plan.punkte && plan.punkte === Math.floor(erw), `Plan hat Garnison × Faktor = ${erw} Punkte (${S.planPunkte})`);
  ok(gleich(S.plan.wellen, plan.wellen), 'Wellen: Plan.plane mit Garnison × Faktor, reproduzierbar aus dem Seed');
  const w = g.flotte && g.flotte.welle;
  ok(w && w.liste.length === plan.wellen.length && w.ohneSkala === true, `Flotte: ${plan.wellen.length} Wellen, unskaliert`);
  ok(Math.abs(g.simSzene.start - g.simSzene.t0 - ANG.vorlauf) < 1e-6, `Vorlauf ${ANG.vorlauf} s aus den Daten`);
  const funk = t.funk(); ok(funk.some((x) => /Angriff auf den Posten/.test(x)), 'Funk: „Angriff auf den Posten …“ (Vorwarnung)');
  const sz = g.snapshot().flotte && g.snapshot().flotte.sz;
  ok(sz && sz.p === 'v' && sz.x === 1 && sz.f === 'ger' && Array.isArray(sz.v), 'Snapshot flotte.sz: Vorwarnung mit x 1 (Angriff auf Posten)');
  run(g, ANG.vorlauf + 3);
  const sz2 = g.snapshot().flotte.sz; ok(sz2 && sz2.p === 'k' && sz2.x === 1, 'Snapshot flotte.sz: Kampf mit x 1');
  ok(g.space.enemies.some((e) => e.wv != null), 'Gegner der ersten Welle sind da');
  // kleinere Garnison = kleinerer Plan; Garnison 0,6 -> Mindeststärke 1
  const u = bereit({ garnison: 0.6 }); angriff(u.g); ok(u.g.simSzene && u.g.simSzene.planPunkte >= 1, 'Garnison 0,6: trotzdem ein Plan (Mindeststärke 1)');
  const v = bereit({ garnison: 2 }); angriff(v.g); ok(v.g.simSzene.planPunkte === Math.floor(2 * ANG.staerke_faktor), 'Garnison 2: Plan ' + v.g.simSzene.planPunkte);
  // Piraten
  const p = bereit({ besitzer: 'pirat', hex: GER2 }); angriff(p.g); ok(p.g.simSzene && p.g.simSzene.fraktion === 'pirat' && p.oda().some((x) => /Piraten/.test(x)), 'Piratenposten: Szene mit Fraktion pirat und Piratenhinweis');
});

section('Sieg: Posten gesprengt', () => {
  const t = bereit(); const g = t.g; angriff(g);
  const ruf0 = rom(g); const ger0 = Ruf.ruf(g, 'ger'); const k0 = kernTicks; const tk0 = g.weltsim.tickZahl;
  ok(durchspielen(g, 600), 'Wellen abgeräumt, Szene beendet');
  const nd = z(g).hexe[GER1];
  ok(nd.posten === false && nd.besitzer === null && nd.garnison === 0, 'Posten gesprengt: Hex frei, Garnison 0');
  ok(kernTicks === k0 + 1 && g.weltsim.tickZahl === tk0 + 1, 'genau ein Tick (Kern ' + (kernTicks - k0) + ', Zähler +' + (g.weltsim.tickZahl - tk0) + ')');
  const typen = letzterTick.wirkungen.map((x) => x.typ);
  ok(typen.includes('abwehr_verlust') && typen.includes('posten_gesprengt') && typen.indexOf('abwehr_verlust') < typen.indexOf('posten_gesprengt') && typen.includes('ruf_aenderung'), 'Wirkungen im Tick: abwehr_verlust vor posten_gesprengt, dazu ruf_aenderung (' + typen.join(', ') + ')');
  const av = letzterTick.wirkungen.find((x) => x.typ === 'abwehr_verlust');
  ok(av && av.punkte === 4 && av.ort === GER1, 'abwehr_verlust nimmt die ganze Garnison (' + (av && av.punkte) + ')');
  const rw = letzterTick.wirkungen.find((x) => x.typ === 'ruf_aenderung');
  ok(rw && rw.grund === 'posten_gesprengt_ger' && rw.fraktion === 'rom' && rw.delta === Q_GER.delta, 'Ruf-Wirkung mit Grund posten_gesprengt_ger');
  ok(rom(g) === ruf0 + Q_GER.delta && Ruf.ruf(g, 'ger') === ger0 + Q_GER.folge.ger, `Ruf Rom +${Q_GER.delta}, Germanen ${Q_GER.folge.ger}`);
  ok(hatEreignis(g, 'posten_verloren').some((e) => e.ort === GER1 && e.besitzer === 'ger' && e.durch === 'rom'), 'Ereignis posten_verloren durch rom');
  ok(g.weltsim.sprengungen[GER1] === z(g).tick, 'Sperre am Hex gemerkt');
  const L = Szene.letzte(g);
  ok(L && L.ausgang === 'sieg' && L.gesprengt === true && L.ruf === Q_GER.delta && L.sperre === false && L.ergebnis.verworfen === 0, 'Szenenergebnis: sieg, gesprengt, Ruf, keine Sperre, nichts verworfen');
  const funk = t.funk(); ok(funk.some((x) => /gesprengt/.test(x)), 'Funk „… gesprengt“: ' + (funk.filter((x) => /gesprengt/.test(x))[0] || ''));
  const sz = g.snapshot().flotte && g.snapshot().flotte.sz;
  ok(sz && sz.p === 's' && sz.x === 1, 'Szenenzeile nach dem Ende: Sieg mit x 1');
  ok(g.errors === 0 && g.phase === 'play', 'keine Fehler');
  ok(!g.space.enemies.some((e) => e.sim != null), 'Szene aufgeräumt');
  // Overlay: der Posten-Marker ist weg
  ok(g.weltBesitz.hexe[GER1].posten === false && !g.space.markers.some((m) => m.posten), 'Overlay und Posten-Marker weg');
  // Wissen von Rom: Posten verloren (ger)
  ok(g.weltsim.wissen.meldungen.some((m) => m.e === 'pv' && m.h === GER1) || true, 'Wissen verarbeitet das Ereignis ohne Fehler');
  // Flaggschiff-Sieg
  const b = bereit(); const gb = b.g; angriff(gb);
  let flaggGesehen = false;
  for (let i = 0; i < 600 * HZ && gb.simSzene; i++) { if (gb.space.enemies.some((e) => e.flagg)) { flaggGesehen = true; killAlle(gb); } else if (gb.space.enemies.length) killAlle(gb, true); gb.step(); }
  ok(flaggGesehen && !gb.simSzene && z(gb).hexe[GER1].posten === false, 'Flaggschiff des Postenkommandanten gefallen: Sieg, Posten gesprengt');
  // Piratenposten: Quelle posten_gesprengt_pirat, keine Folge
  const p = bereit({ besitzer: 'pirat', hex: GER2 }); const gp = p.g; angriff(gp); const rp = rom(gp); const gr = Ruf.ruf(gp, 'ger'); durchspielen(gp, 600);
  ok(z(gp).hexe[GER2].posten === false && rom(gp) === rp + Q_PIRAT.delta && Ruf.ruf(gp, 'ger') === gr, `Piratenposten gesprengt: Rom +${Q_PIRAT.delta}, Germanen unverändert`);
});

section('Flucht: nur anteilige Verluste, kein Ruf-Abzug', () => {
  const t = bereit(); const g = t.g; angriff(g);
  const ruf0 = rom(g); const ger0 = Ruf.ruf(g, 'ger');
  // ein Teil der Gegner fällt
  run(g, ANG.vorlauf + 3);
  let gekillt = 0;
  for (let i = 0; i < 60 * HZ && gekillt < 2; i++) { const e = g.space.enemies.find((x) => x.wv != null && !x.flagg); if (e) { kill(g, e); gekillt++; } g.step(); }
  ok(g.simSzene && g.simSzene.killPunkte > 0 && g.simSzene.killPunkte < g.simSzene.planPunkte, `ein Teil vernichtet (${g.simSzene.killPunkte} von ${g.simSzene.planPunkte} Punkten)`);
  const anteil = g.simSzene.killPunkte / g.simSzene.planPunkte;
  const tk0 = g.weltsim.tickZahl; const k0 = kernTicks;
  const e = springe(g, '0704');
  ok(!e, 'Sprung (Flucht) ausgelöst' + (e ? ': ' + e : ''));
  ok(!g.simSzene && kernTicks === k0 + 1 && g.weltsim.tickZahl === tk0 + 1, 'genau ein Tick (der Sprung-Tick)');
  const av = letzterTick.wirkungen.filter((x) => x.typ === 'abwehr_verlust');
  ok(av.length === 1 && Math.abs(av[0].punkte - Math.floor(4 * anteil * 100) / 100) < 0.011, `nur anteilige abwehr_verlust (${av[0] && av[0].punkte} von 4)`);
  const nd = z(g).hexe[GER1];
  ok(nd.posten === true && nd.besitzer === 'ger' && !letzterTick.wirkungen.some((x) => x.typ === 'posten_gesprengt'), 'Posten steht, keine Sprengung');
  ok(nd.garnison > 0 && nd.garnison < 4 + 0.2, `Garnison angeschlagen (${nd.garnison}), regeneriert +0,2 je Tick`);
  ok(rom(g) === ruf0 && Ruf.ruf(g, 'ger') === ger0 && !letzterTick.wirkungen.some((x) => x.typ === 'ruf_aenderung'), 'kein Ruf-Abzug (und kein Ruf): der Angriff ist freiwillig');
  ok(Szene.letzte(g).ausgang === 'abbruch', 'Szenenergebnis: abbruch');
  // Flucht in der Vorwarnung: nichts verloren
  const b = bereit(); const gb = b.g; angriff(gb); springe(gb, '0704');
  ok(z(gb).hexe[GER1].garnison >= 4 && !letzterTick.wirkungen.some((x) => x.typ === 'abwehr_verlust' || x.typ === 'ruf_aenderung'), 'Sprung in der Vorwarnung: keine Verluste, kein Ruf');
  // Notsprung
  const c = bereit(); const gc = c.g; angriff(gc); run(gc, ANG.vorlauf + 3);
  const rc = rom(gc); Kriegslage.tick(gc, 'notsprung');
  ok(!gc.simSzene && rom(gc) === rc && z(gc).hexe[GER1].posten === true, 'Notsprung: wie Flucht, kein Ruf-Abzug, Posten steht');
});

section('Niederlage: Notfallprotokoll, kein Game Over', () => {
  const t = bereit(); const g = t.g; angriff(g); run(g, ANG.vorlauf + 3);
  const e = g.space.enemies.find((x) => x.wv != null && !x.flagg); if (e) kill(g, e); run(g, 0.5);
  const ruf0 = rom(g); const ger0 = Ruf.ruf(g, 'ger'); const k0 = kernTicks; const tk0 = g.weltsim.tickZahl; const kp = g.simSzene.killPunkte;
  g.stats.emergencies = (g.stats.emergencies || 0) + 1;   // Notfallprotokoll der Lerche (wie in 02a)
  run(g, 1);
  ok(!g.simSzene && Szene.letzte(g).ausgang === 'niederlage', 'Niederlage');
  ok(kernTicks === k0 + 1 && g.weltsim.tickZahl === tk0 + 1, 'genau ein Tick');
  const nd = z(g).hexe[GER1];
  ok(nd.posten === true && nd.besitzer === 'ger' && nd.garnison > 0 && !letzterTick.wirkungen.some((x) => x.typ === 'posten_gesprengt'), 'Posten steht, Garnison regeneriert (' + nd.garnison + ')');
  ok(rom(g) === ruf0 && Ruf.ruf(g, 'ger') === ger0, 'kein Ruf-Abzug');
  ok(g.phase === 'play' && g.errors === 0, 'kein Game Over, keine Fehler');
  ok(t.funk().some((x) => x === SZT.angriff.niederlage.frei), 'Funk: „' + SZT.angriff.niederlage.frei + '“');
  const sz = g.snapshot().flotte && g.snapshot().flotte.sz; ok(sz && sz.p === 'n' && sz.x === 1, 'Szenenzeile: Niederlage mit x 1');
  // danach kann die Crew erneut angreifen
  g.space.enemies = []; ab(g); anPosten(g, GER1); g.ship.hp = g.ship.hpMax || g.ship.hp;
  const e2 = Posten.angreifenPruefen(g, false); ok(e2 === null || e2.code !== 'szene', 'danach ist ein neuer Angriff nicht gesperrt (' + (e2 ? e2.code : 'frei') + ')');
});

section('Atomar: Rollback', () => {
  const t = bereit(); const g = t.g; angriff(g);
  const simVor = kopie(Kriegslage.abbild(z(g))); const rufVor = kopie(g.weltsim.ruf); const spVor = kopie(g.weltsim.sprengungen || {}); const tk = g.weltsim.tickZahl;
  kernWirft = true; console.warn = () => {};
  durchspielen(g, 600);
  console.warn = warnOrig; kernWirft = false;
  ok(!g.simSzene, 'Szene ist beendet');
  ok(gleich(Kriegslage.abbild(z(g)), simVor) && gleich(g.weltsim.ruf, rufVor) && gleich(g.weltsim.sprengungen || {}, spVor) && g.weltsim.tickZahl === tk, 'wirft der Tick: Sim, Ruf, Sperre und Tickzähler wie vorher');
  ok(z(g).hexe[GER1].posten === true && z(g).hexe[GER1].besitzer === 'ger', 'Posten steht');
  ok(Szene.letzte(g).ausgang === 'gestoert', 'Ergebnis „gestoert“, keine Erfolgsmeldung');
  ok(!t.funk().some((x) => /gesprengt/.test(x)), 'keine Meldung „gesprengt“');
  g.errors = 0;
  // ein zweiter Versuch gelingt
  ab(g); anPosten(g, GER1); g.fracht.halt = null; ops(g);
  const g2 = bereit().g; kernWirft = false; angriff(g2); durchspielen(g2, 600); ok(z(g2).hexe[GER1].posten === false, 'nach dem Fehlschlag gelingt ein neuer Versuch (frische Partie)');
  // wirft erst der Ruf (nach dem Kern): auch die Sperre geht zurück
  const t3 = bereit(); const g3 = t3.g; angriff(g3);
  const sv = kopie(Kriegslage.abbild(z(g3))); const rv = kopie(g3.weltsim.ruf);
  const anw = Ruf.anwenden; Ruf.anwenden = function (gm, w) { anw.call(Ruf, gm, w); throw new Error('Test: Ruf wirft'); };
  console.warn = () => {}; durchspielen(g3, 600); console.warn = warnOrig; Ruf.anwenden = anw;
  ok(gleich(Kriegslage.abbild(z(g3)), sv) && gleich(g3.weltsim.ruf, rv) && gleich(g3.weltsim.sprengungen || {}, {}), 'wirft erst der Ruf: Sim, Ruf und Sperre wie vorher (ein Atom)');
});

section('Ruf: nur bei Sieg, Sperre gegen Farmen', () => {
  const t = bereit(); const g = t.g;
  // Ruf kommt nur aus dem Sieg: Anlauf, Vorwarnung, Abbruch, Niederlage geben nichts
  const r0 = rom(g);
  Posten.angreifenStart(g, g.players[0]); run(g, ANG.dauer / 2); Fracht.beamStop(g, 'abgebrochen'); run(g, 1);
  ok(rom(g) === r0 && !g.simSzene, 'Anlauf abgebrochen: kein Ruf, keine Szene, kein Verlust');
  // Sperre: Sieg, neuer Posten im selben Hex nach wenigen Ticks, zweiter Sieg: kein Ruf, der Posten fällt trotzdem
  angriff(g); durchspielen(g, 600);
  const r1 = rom(g); ok(r1 === r0 + Q_GER.delta, 'erster Sieg: Ruf +' + Q_GER.delta);
  ok(Posten.sprengungGesperrt(g, GER1) === true, 'Hex in der Sperre');
  postenSetzen(g, GER1, 'ger', 4); z(g).hexe[GER1].anspruch = {}; ohneFlotten(g, GER1);
  for (let i = 0; i < 3; i++) { Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'test' }); postenSetzen(g, GER1, 'ger', 4); }   // Neugründung nach ein paar Ticks
  ankunft(g, GER1); ops(g); run(g, 0.2); anPosten(g, GER1);
  ok(Posten.angreifenPruefen(g, false) === null, 'Neugründung ist wieder ein Ziel');
  angriff(g); durchspielen(g, 600);
  ok(z(g).hexe[GER1].posten === false && rom(g) === r1, 'zweiter Sieg innerhalb der Sperre: der Posten fällt, aber kein Ruf');
  ok(Szene.letzte(g).sperre === true && Szene.letzte(g).ruf === 0, 'Ergebnis merkt die Sperre');
  ok(t.funk().some((x) => /erst kürzlich gesprengt/.test(x)), 'Funk erklärt: „… erst kürzlich gesprengt – kein Ruf“');
  // nach der Sperre wieder Ruf
  for (let i = 0; i < PW.sprengen.wert.ruf_sperre_ticks; i++) Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'test' });
  postenSetzen(g, GER1, 'ger', 4); ankunft(g, GER1); ops(g); run(g, 0.2); anPosten(g, GER1);
  ok(Posten.sprengungGesperrt(g, GER1) === false, 'Sperre vorbei');
  angriff(g); durchspielen(g, 600);
  ok(rom(g) === r1 + Q_GER.delta, 'nach der Sperre gibt es wieder Ruf');
  // andere Hexe sind unabhängig
  const u = bereit(); const gu = u.g; postenSetzen(gu, GER2, 'ger', 4);
  angriff(gu); durchspielen(gu, 600); const ru = rom(gu);
  ankunft(gu, GER2); ops(gu); run(gu, 0.2); anPosten(gu, GER2); angriff(gu); durchspielen(gu, 600);
  ok(rom(gu) === ru + Q_GER.delta, 'die Sperre gilt je Hex: ein anderes Hex gibt sofort wieder Ruf');
  // Ruf-Obergrenze bleibt (geklemmt)
  const c = bereit(); c.g.weltsim.ruf.rom = RUF.fraktionen.wert.rom.max - 1; angriff(c.g); durchspielen(c.g, 600);
  ok(rom(c.g) === RUF.fraktionen.wert.rom.max, 'Ruf bleibt geklemmt (Obergrenze ' + RUF.fraktionen.wert.rom.max + ')');
});

section('Verbündete und Mehrere im Hex', () => {
  const t = bereit(); const g = t.g; flotte(g, GER1, 'rom', 6);
  angriff(g);
  ok(g.simSzene.vert.n0 > 0 && (g.space.escorts || []).some((q) => q.ally && q.sim === g.simSzene.id), 'römische Flotte im Hex: Verbündete in der Szene');
  ok(t.funk().some((x) => /an Eurer Seite/.test(x)), 'Funk: Verbündete an Eurer Seite');
  durchspielen(g, 600);
  ok(z(g).hexe[GER1].posten === false, 'Sieg mit Verbündeten: Posten gesprengt');
  const rf = z(g).flotten.filter((f) => f.fraktion === 'rom' && f.ort === GER1 || f.fraktion === 'rom');
  ok(rf.every((f) => f.staerke > 0), 'römische Flotten behalten Stärke');
});

section('Eigener Crew-Posten ist nicht sprengbar, Posten fällt während andere angedockt', () => {
  const t = neu(); const g = t.g; g.weltsim.ruf.rom = rangAb('centurio'); g.inventory.ersatzteil = 6;
  ankunft(g, FREI); ops(g); run(g, 0.2); anPosten(g, FREI);
  Posten.gruendenStart(g, g.players[0]); run(g, PW.gruenden.wert.dauer + 1.5);
  ok(z(g).hexe[FREI].crew === true, 'Crew-Posten steht');
  ok(grund(g) === 'eigener', 'am eigenen Crew-Posten: Weigerung „eigener“');
  ok(Posten.angreifenStart(g, g.players[0]) === TEXTE.angreifen.weigerung.eigener && !halt(g), 'Befehl lehnt ab');
  ok(g.snapshot().space.po === undefined, 'keine Anzeige am Stützpunkt');
  // angedockt am Crew-Posten (Dock): Angriff nur nach Ablegen und auch dann nicht
  const dl = Besitz.dockLage(g, szene(FREI), FREI); Object.assign(g.ship, { x: dl.x, y: dl.y - 20, vx: 0, vy: 0, speed: 0 }); g.ship.dockArmed = true; run(g, 0.5);
  ok(g.ship.docked && grund(g) === 'docked', 'angedockt: Weigerung „docked“');
  // die Wirkung selbst: Crew-Posten sprengen schlägt auch mit leerer Garnison fehl
  z(g).hexe[FREI].garnison = 0;
  ok(!Wirkungen.pruefe(z(g), { typ: 'posten_gesprengt', ort: FREI }).ok, 'Wirkung posten_gesprengt lehnt den Crew-Posten ab (auch ohne Garnison)');
  // der gegnerische Posten fällt, während die Lerche an einem anderen Posten angedockt liegt: nichts bricht
  const k0 = kernTicks; const dockHex = Sektoren.hexVonOrt(g.ship.dockedAt);
  postenSetzen(g, GER1, 'ger', 0.3);
  Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'abwehr_verlust', ort: GER1, punkte: 0.3 }, { typ: 'posten_gesprengt', ort: GER1 }], wo: 'test' });
  ok(z(g).hexe[GER1].posten === false && g.ship.docked && z(g).hexe[dockHex].crew === true && g.errors === 0, 'Gegnerischer Posten fällt, Lerche bleibt am Stützpunkt angedockt, keine Fehler');
});

section('Laden, Altstand', () => {
  const t = bereit(); const g = t.g; angriff(g); durchspielen(g, 600);
  ok(g.weltsim.sprengungen[GER1] === z(g).tick, 'Sperre gesetzt');
  ab(g); const hex = GER1;
  g.ship.docked = false;
  const d1 = kopie(Weltstand.capture(g));
  ok(d1.version === 3 && Weltstand.validate(d1).length === 0, 'Weltstand: Version 3, schemagültig' + (Weltstand.validate(d1).join('; ') ? ' ' + Weltstand.validate(d1).join('; ') : ''));
  ok(d1.welt.sim.sprengungen && d1.welt.sim.sprengungen[hex] === g.weltsim.sprengungen[hex], 'welt.sim.sprengungen: additives optionales Feld');
  const dir = freshDir(); d1.id = 'w-spr'; fs.writeFileSync(path.join(dir, 'w-spr.json'), JSON.stringify(d1));
  const t2 = neu({ dir, world: 'w-spr' }); const g2 = t2.g;
  ok(g2.phase === 'play' && g2.weltsim && g2.errors === 0 && g2.weltsim.sprengungen[hex] === g.weltsim.sprengungen[hex], 'Laden ohne Fehler, Sperre gelesen');
  const d2 = kopie(Weltstand.capture(g2)); ok(gleich(d2.welt.sim.sprengungen, d1.welt.sim.sprengungen) && gleich(d2.welt.sim.zustand.hexe, d1.welt.sim.zustand.hexe), 'Runde Speichern, Laden, Speichern: gleich');
  // Altstand (vor A2): kein sprengungen-Block
  const alt = kopie(d1); delete alt.welt.sim.sprengungen; alt.id = 'w-alt'; fs.writeFileSync(path.join(dir, 'w-alt.json'), JSON.stringify(alt));
  const t3 = neu({ dir, world: 'w-alt' }); const g3 = t3.g;
  ok(g3.phase === 'play' && g3.errors === 0 && gleich(g3.weltsim.sprengungen, {}), 'Altstand ohne sprengungen lädt (leer)');
  const d3 = kopie(Weltstand.capture(g3)); ok(!('sprengungen' in d3.welt.sim), 'ohne Sprengung kein Block (Altstand-gleich)');
  // Szene wird nie gespeichert
  const t4 = bereit(); angriff(t4.g); const d4 = kopie(Weltstand.capture(t4.g)); ok(!JSON.stringify(d4).includes('simSzene') && !JSON.stringify(d4).includes('"modus":"angriff"'), 'die Szene steht nicht im Weltstand');
  // Müll
  for (const bl of ['x', [1], { '0505': 'x', '12': 3, '0503': -1, '0703': NaN }, null]) ok(gleich(Posten.sprengungenLesen(bl), {}), 'Müll-fester Leser: ' + JSON.stringify(bl));
  ok(gleich(Posten.sprengungenLesen({ '0703': 12.7 }), { '0703': 12 }), 'Leser: gültiger Eintrag bleibt');
});

section('Anzeige space.po', () => {
  const { g } = bereit();
  let po = g.snapshot().space.po;
  ok(po && po.k === 'x' && po.ok === 1 && po.n === 0 && po.t === undefined, 'germanischer Posten: k x, ok 1, ohne Text');
  anPosten(g, GER1, 900); po = g.snapshot().space.po; ok(po.k === 'x' && po.ok === 0 && /Zu weit/.test(po.t), 'zu weit: ok 0 mit Text');
  anPosten(g, GER1);
  postenSetzen(g, FREI, 'kon', 3); ankunft(g, FREI); ok(g.snapshot().space.po === undefined, 'Konkordat-Posten: keine Anzeige');
  postenSetzen(g, FREI, 'rom', 3); g.weltsim.ruf.rom = 0; ankunft(g, FREI); po = g.snapshot().space.po; ok(po && po.k === 'a', 'römischer Posten: weiter k a (Ausbau)');
  ankunft(g, STATION); postenSetzen(g, STATION, 'ger', 3); ok(g.snapshot().space.po === undefined, 'Hex mit Station: keine Anzeige');
  ok(Buffer.byteLength(JSON.stringify({ k: 'x', ok: 0, t: TEXTE.angreifen.weigerung.weit, n: 0 })) < 120, 'space.po bleibt klein');
});

section('Kampagne und Limes unverändert', () => {
  for (const start of ['free', 'arena_space']) {
    const { g } = neu({ start });
    ok(!g.weltsim && g.snapshot().space.po === undefined, `${start}: kein Modus, kein space.po`);
    ok(Posten.angreifenStart(g, g.players[0]) === TEXTE.angreifen.weigerung.modus, `${start}: Befehl lehnt ab`);
    ok(!g.simSzene, `${start}: keine Sim-Szene`);
  }
  const d = kopie(Weltstand.capture(neu({ start: 'free' }).g));
  ok(!(d.welt && d.welt.sim) && !JSON.stringify(d).includes('sprengungen'), 'Kampagnen-Weltstand ohne welt.sim und ohne sprengungen');
});

console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'SPRENGEN OK'}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
