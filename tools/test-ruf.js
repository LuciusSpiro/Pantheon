'use strict';
// SUND-02b B: Ruf je Fraktion und Dienstgrade von Rom (server/sim/ruf.js, Wirkung ruf_aenderung, content/welt/ruf-werte.json). Direkt gegen die Game-Klasse, ohne Netz.
//   Daten · Wirkung gültig/ungültig · Kern bleibt rein · atomar (Rollback) · Rangschwellen ±1 · Quellen (Sieg, Verteidigung, Fahrerflucht, Piraten) · Ablehnen ändert nie ·
//   Rang sinkt wieder · Grenzen · Weltstand (Altstand, Runde) · Kampagne ohne Ruf · Werft-Hook · Snapshot und Mehrspieler.
//   node tools/test-ruf.js [begriff …]   (npm run test:ruf)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Sektoren = require('../shared/sektoren.js');
const Kern = require('../server/weltsim/kern.js');
const Wirkungen = require('../server/weltsim/wirkungen.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const Ruf = require('../server/sim/ruf.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const Werft = require('../server/sim/werft.js');

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

const DATEN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'ruf-werte.json'), 'utf8'));
const W = DATEN.werte;
const RAENGE = W.raenge.wert;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-ruf-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const HZ = CONFIG.tickHz;
const OSTIA = '0305';   // römischer Hafen
const FELD = '0505';    // freier Sektor (kein Ort der Crew-Seite)
const HEIMAT = { ger: '1004', pirat: '0602', kon: '0604' };

// Zähler am Sim-Kern: kernWirft lässt den nächsten Tick scheitern (Rollback-Test)
let kernWirft = false;
const kernOrig = Kern.tick;
Kern.tick = function (z, o) { if (kernWirft) throw new Error('Test: Tick wirft'); return kernOrig.apply(this, arguments); };

function neu(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: o.dir || freshDir(), seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (o.crew || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 600) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'R' + i, name: 'R' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: o.start || 'freie_fahrt', ...(o.world ? { world: o.world } : {}) });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 1);
  g.space.enemies = [];
  const funk = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio');
  return { g, cs, funk };
}
const run = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const z = (g) => g.weltsim.zustand;
const ticks = (g) => g.weltsim.tickZahl;
const rom = (g) => Ruf.ruf(g, 'rom');
function ab(g) { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }
function flotte(g, hex, fraktion, staerke, o) {
  const st = z(g); const opt = o || {};
  const fl = { id: st.naechsteId++, fraktion, heimat: HEIMAT[fraktion] || hex, ort: hex, staerke, kap: Math.max(staerke, 5), befehl: 'rueckzug', ziel: null, warte: 0, versorgung: 1, angriff: null }; fl.ziel = fl.heimat;
  st.flotten.push(fl);
  if (opt.belagerung) {
    const id = st.naechsteAngriffId++;
    st.angriffe.push({ id, t0: st.tick, ziel: hex, von: fraktion, art: fraktion === 'pirat' ? 'pirat' : 'reich', relevant: true, zielArt: st.hexe[hex].posten ? 'posten' : 'hafen', t_an: st.tick, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: st.tick, stuetz: null, flotten: [fl.id] });
    fl.befehl = 'angriff'; fl.ziel = hex; fl.angriff = id;
  }
  return fl;
}
const ohneFlotten = (g, hex) => { const st = z(g); st.flotten = st.flotten.filter((f) => f.ort !== hex); };
function ankunft(g, hex) { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); }
const kill = (g, e) => { e.hp = 1; Space.damageEnemy(g, e, 500, e.x - 100, e.y, {}); };
function bisFlaggschiff(g, maxSek) {
  for (let i = 0; i < (maxSek || 400) * HZ; i++) {
    if (g.space.enemies.some((e) => e.flagg)) return true;
    for (const e of g.space.enemies.slice()) if (!e.flagg) kill(g, e);
    g.step();
    if (!g.simSzene) return false;
  }
  return false;
}
// Szene bis zum Sieg spielen: Ankunft, Wellen abräumen, Flaggschiff fällt
function siegSzene(g, hex, fraktion, staerke, belagerung) {
  ab(g); ohneFlotten(g, hex); flotte(g, hex, fraktion, staerke, { belagerung });
  ankunft(g, hex); run(g, 21);
  const da = bisFlaggschiff(g, 400);
  if (da) kill(g, g.space.enemies.find((e) => e.flagg));
  run(g, 0.3);
  return da && !g.simSzene;
}
// Sprung wie ein Spieler (Szene läuft: der Antrieb gilt als geladen, doJump)
function springe(g, hex) {
  const von = Sektoren.hexVonOrt(g.ship.scene);
  g.explore.markBoje(Sektoren.kanteId(von, hex)); g.explore.erkunde(hex);
  const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return 'Ziel: ' + e;
  const p = Sprung.sprungpunkt(g, hex); const s = g.ship; s.x = p.x - 80; s.y = p.y; s.vx = 0; s.vy = 0; s.speed = 0;
  s.jump.charge = 1; s.jump.ready = true;
  return Sprung.doJump(g);
}
const ohneZufall = (g) => { g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0; };
const wirk = (fraktion, delta, grund) => ({ typ: 'ruf_aenderung', fraktion, delta, grund });

section('Daten und Texte', () => {
  const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'flotte', 'ruf.json'), 'utf8'));
  ok(DATEN.format === 'ruf-werte/1' && T.format === 'ruf/1', 'Formate');
  ok(RAENGE.map((r) => r.id).join() === 'miles,optio,centurio,tribun,legat', 'fünf Dienstgrade von Rom in dieser Reihenfolge');
  ok(RAENGE[0].ab === 0 && RAENGE.every((r, i) => i === 0 || r.ab > RAENGE[i - 1].ab), 'Schwellen: Miles ab 0, streng aufsteigend (alles Daten)');
  ok(W.fraktionen.wert.rom.max >= RAENGE[RAENGE.length - 1].ab && W.fraktionen.wert.rom.min === 0, 'Rom: Mindestwert 0, Höchstwert über der Legat-Schwelle');
  ok(Object.entries(W.fraktionen.wert).every(([, g]) => g.min <= 0 && g.max >= g.min), 'Grenzen je Fraktion plausibel (min <= 0, max >= min)');
  const q = W.quellen.wert;
  ok(Object.entries(q).every(([k, e]) => W.fraktionen.wert[e.fraktion] && Number.isFinite(e.delta) && e.delta !== 0 && Math.abs(e.delta) <= W.delta_max.wert && (!e.folge || Object.keys(e.folge).every((f) => W.fraktionen.wert[f] && Number.isFinite(e.folge[f])))), 'jede Quelle: bekannte Fraktion, delta ungleich 0 und innerhalb der Grenze, folge gültig');
  ok(RAENGE.slice(1).every((r) => T.auf[r.id]) && RAENGE.slice(0, -1).every((r) => T.ab[r.id]) && T.sprecher, 'Funktexte für jede Beförderung und jede Rückstufung');
  ok(Object.keys(CONFIG.werft.ruf.stufe).every((s) => RAENGE.some((r) => r.id === CONFIG.werft.ruf.stufe[s])), 'CONFIG.werft.ruf.stufe nennt nur bekannte Rang-Ids (leer = keine Bedingung)');
  ok(!Object.keys(q).some((k) => /ablehn|angebot/.test(k)), 'Ablehnen eines Führungsangebots ist keine Quelle (Ruf ist ein Kann, nie ein Muss)');
  ok(!Object.keys(q).some((k) => /pirat/.test(k) && /flucht/.test(k)), 'Piraten ignorieren ist keine Quelle (keine Fahrerflucht gegen Piraten, Entscheidung 02a)');
});

section('Wirkung ruf_aenderung: Prüfer', () => {
  const t = neu(); const g = t.g; const zz = z(g);
  const pr = (wk) => Wirkungen.pruefe(zz, wk);
  ok(Wirkungen.KATALOG.ruf_aenderung && Wirkungen.istAufsatz('ruf_aenderung') && !Wirkungen.istAufsatz('flotte_verlust'), 'im Katalog, als Aufsatz-Wirkung markiert');
  ok(pr(wirk('rom', 3, 'sieg_feld_ger')).ok && pr(wirk('rom', 10, 'ort_gehalten_ger')).ok && pr(wirk('rom', -3, 'fahrerflucht_ger')).ok, 'gültig: Sieg, Verteidigung, Fahrerflucht');
  ok(!pr({ typ: 'ruf_aenderung_x', fraktion: 'rom', delta: 3, grund: 'sieg_feld_ger' }).ok, 'ungültig: unbekannter Typ');
  for (const f of [undefined, 'pirat', 'x', 7, null]) ok(!pr(wirk(f, 3, 'sieg_feld_ger')).ok, 'ungültig: Fraktion ' + JSON.stringify(f));
  for (const d of [0, undefined, '5', NaN, Infinity, null]) ok(!pr(wirk('rom', d, 'sieg_feld_ger')).ok, 'ungültig: delta ' + String(d));
  ok(pr(wirk('rom', W.delta_max.wert, 'sieg_feld_ger')).ok && pr(wirk('rom', -W.delta_max.wert, 'fahrerflucht_ger')).ok, 'delta genau an der Grenze (' + W.delta_max.wert + '): gültig');
  ok(!pr(wirk('rom', W.delta_max.wert + 1, 'sieg_feld_ger')).ok && !pr(wirk('rom', -W.delta_max.wert - 0.5, 'fahrerflucht_ger')).ok, 'delta über der Grenze: ungültig');
  for (const gr of [undefined, '', 'x', 'posten_gehalten', 'constructor', 7]) ok(!pr(wirk('rom', 3, gr)).ok, 'ungültig: Grund ' + JSON.stringify(gr));
  ok(!pr(wirk('ger', 3, 'sieg_feld_ger')).ok, 'ungültig: Grund gehört zu einer anderen Fraktion');
  ok(!Wirkungen.pruefe(zz, null).ok && !Wirkungen.pruefe(zz, []).ok, 'ungültig: keine Wirkung');
  // Der Kern bleibt rein: er nimmt die Wirkung an, tut nichts, der Zustand ist bitgleich
  const a = Kriegslage.abbild(zz); const b = kopie(a);
  const za = Object.assign(kopie(a), { werte: zz.werte, karte: zz.karte }); const zb = Object.assign(kopie(b), { werte: zz.werte, karte: zz.karte });
  kernOrig.call(Kern, za, { wirkungen: [wirk('rom', 5, 'sieg_feld_ger')] }); kernOrig.call(Kern, zb, { wirkungen: [] });
  ok(gleich(Kriegslage.abbild(za), Kriegslage.abbild(zb)), 'Kern.tick mit ruf_aenderung = Kern.tick ohne (der Sim-Zustand kennt keinen Ruf, Parität zum Prototyp)');
  ok(!JSON.stringify(Kriegslage.abbild(za)).includes('"ruf"'), 'kein Ruf im Sim-Zustand');
});

section('Atomar mit dem Tick', () => {
  const t = neu(); const g = t.g; ab(g);
  const w0 = rom(g);
  // gültige und ungültige Wirkungen im Paket: die gültigen gelten, die ungültigen werden verworfen und gemeldet
  const r = Kriegslage.szeneAbschliessen(g, { wirkungen: [wirk('rom', 3, 'sieg_feld_ger'), wirk('rom', 99, 'sieg_feld_ger'), wirk('rom', 3, 'gibtsnicht'), wirk('ger', -2, 'fahrerflucht_ger')], wo: 'test' });
  ok(r.ok && r.angewandt === 1 && r.verworfen.length === 3 && rom(g) === w0 + 3 + 0, `Paket: 1 gültig angewandt (Ruf ${w0} -> ${rom(g)}), 3 ungültige verworfen und gemeldet`);
  ok(r.verworfen.every((v) => typeof v.grund === 'string' && v.grund.length > 0), 'jede Ablehnung nennt den Grund');
  // Rollback: der Tick wirft -> Ruf, Rang und Tickzähler wie vorher
  const rufVor = kopie(g.weltsim.ruf); const tk = ticks(g); const rangVor = Ruf.rang(g);
  kernWirft = true;
  const warnOrig = console.warn; console.warn = () => {};   // der gezählte Fehler ist gewollt
  const r2 = Kriegslage.szeneAbschliessen(g, { wirkungen: [wirk('rom', 20, 'ort_gehalten_ger'), wirk('rom', 20, 'ort_gehalten_ger')], wo: 'test' });
  console.warn = warnOrig; kernWirft = false;
  ok(!r2.ok && gleich(g.weltsim.ruf, rufVor) && Ruf.rang(g) === rangVor && ticks(g) === tk, 'wirft der Tick: Rollback, Ruf, Rang und Tickzähler unverändert');
  ok(t.funk().every((m) => !m.ruf), 'kein Rangfunk aus dem gescheiterten Tick');
  // Rollback auch, wenn erst die Anwendung des Rufs wirft (nach dem Kern): der Ruf geht auf die Sicherung zurück, der Sim-Zustand ebenfalls
  const anwOrig = Ruf.anwenden; const simVor = kopie(Kriegslage.abbild(z(g)));
  Ruf.anwenden = function (gm, w) { anwOrig.call(Ruf, gm, w); throw new Error('Test: Ruf wirft'); };
  console.warn = () => {};
  const r3 = Kriegslage.szeneAbschliessen(g, { wirkungen: [wirk('rom', 7, 'sieg_feld_ger')], wo: 'test' });
  console.warn = warnOrig; Ruf.anwenden = anwOrig;
  ok(!r3.ok && gleich(g.weltsim.ruf, rufVor) && ticks(g) === tk && gleich(Kriegslage.abbild(z(g)), simVor), 'wirft erst die Anwendung des Rufs: Ruf und Sim-Zustand wie vorher (ein Atom)');
  // Vormerken: ungültige kommen zurück, gültige gelten im nächsten Tick
  const v = Kriegslage.wirkungenVormerken(g, [wirk('rom', -3, 'fahrerflucht_ger'), wirk('rom', 5, 'unbekannt')]);
  ok(v.vorgemerkt === 1 && v.verworfen.length === 1, 'wirkungenVormerken: 1 vorgemerkt, 1 verworfen');
  const w1 = rom(g);
  Kriegslage.tick(g, 'sprung');
  ok(rom(g) === Math.max(0, w1 - 3), `der Sprung-Tick wendet die vorgemerkte Wirkung an (${w1} -> ${rom(g)}, nie unter 0)`);
  ok(g.errors === 2, 'zwei gezählte Fehler: die beiden absichtlich geworfenen Ticks, sonst keiner');
});

section('Rangschwellen (Grenzwerte ± 1) und rufErreicht', () => {
  const t = neu(); const g = t.g;
  RAENGE.forEach((r, i) => {
    if (r.ab > 0) {
      g.weltsim.ruf.rom = r.ab - 1; ok(Ruf.rang(g) === RAENGE[i - 1].id && !Ruf.rufErreicht(g, r.id) && g.rufErreicht(RAENGE[i - 1].id), `${r.ab - 1}: noch ${RAENGE[i - 1].id}, ${r.id} nicht erreicht`);
    }
    g.weltsim.ruf.rom = r.ab; ok(Ruf.rang(g) === r.id && Ruf.rufErreicht(g, r.id) && g.rufErreicht(r.id), `${r.ab}: genau ${r.id} (erreicht)`);
    g.weltsim.ruf.rom = r.ab + 1; ok(Ruf.rang(g) === r.id || (RAENGE[i + 1] && r.ab + 1 >= RAENGE[i + 1].ab), `${r.ab + 1}: ${r.id} oder höher`);
  });
  g.weltsim.ruf.rom = RAENGE[2].ab;
  ok(RAENGE.every((r, i) => Ruf.rufErreicht(g, r.id) === (i <= 2)), 'erreicht = Rang der Crew >= verlangter Rang (Centurio: Miles, Optio, Centurio ja, Tribun, Legat nein)');
  ok(!Ruf.rufErreicht(g, 'zenturio') && !g.rufErreicht(undefined), 'unbekannte Rang-Id im Modus: nicht erreicht (Fehlkonfiguration fällt auf)');
  const info = Ruf.rangInfo(g);
  ok(info.id === 'centurio' && info.ab === RAENGE[2].ab && info.bis === RAENGE[3].ab && (g.weltsim.ruf.rom = RAENGE[4].ab, Ruf.rangInfo(g).bis === null), 'rangInfo: Schwelle des Rangs und des nächsten (Legat: keine weitere)');
  ok(Ruf.rang(g) === 'legat' && (g.weltsim.ruf.ger = -40, g.weltsim.ruf.kon = 20, Ruf.rang(g) === 'legat'), 'der Rang hängt nur am Ruf bei Rom (Germanen und Konkordat haben keine Dienstgrade)');
  // der Rang ist eine eigene, abfragbare Größe: sinkt der Ruf, sinkt der Rang (Paket C hält freigeschaltete Stufen über `freigeschaltet`)
  g.weltsim.ruf.rom = RAENGE[3].ab; ok(Ruf.rang(g) === 'tribun', 'Tribun');
  Ruf.aendern(g, 'rom', -(RAENGE[3].ab - RAENGE[1].ab)); ok(Ruf.rang(g) === 'optio' && !g.rufErreicht('centurio'), 'Rang sinkt mit dem Ruf: wieder Optio');
});

section('Quellen: Sieg im Feld, Verteidigung, Fahrerflucht, Piraten', () => {
  const q = W.quellen.wert;
  // Sieg im Feld gegen Germanen
  let t = neu(); let g = t.g;
  ok(siegSzene(g, FELD, 'ger', 9, false), 'Feldszene gegen Germanen gewonnen');
  ok(rom(g) === q.sieg_feld_ger.delta && Ruf.ruf(g, 'ger') === q.sieg_feld_ger.folge.ger, `Sieg im Feld gegen Germanen: Rom +${q.sieg_feld_ger.delta}, Germanen ${q.sieg_feld_ger.folge.ger} (Platzhalter-Regel)`);
  ok(g.errors === 0, 'keine Fehler');
  // Sieg im Feld gegen Piraten (klein)
  t = neu(); g = t.g;
  ok(siegSzene(g, FELD, 'pirat', 5, false), 'Feldszene gegen Piraten gewonnen');
  ok(rom(g) === q.sieg_feld_pirat.delta && Ruf.ruf(g, 'ger') === 0 && q.sieg_feld_pirat.delta < q.sieg_feld_ger.delta, `Sieg gegen Piraten: Rom +${q.sieg_feld_pirat.delta} (klein), Germanen unberührt`);
  // gehaltene Verteidigung eines römischen Hafens (groß) mit Beförderung und Funk
  t = neu(); g = t.g;
  ok(z(g).hexe[OSTIA].besitzer === 'rom', 'Ostia Nova ist römisch');
  ok(siegSzene(g, OSTIA, 'ger', 17, true), 'Belagerung von Ostia Nova abgewehrt');
  ok(rom(g) === q.ort_gehalten_ger.delta && q.ort_gehalten_ger.delta > q.sieg_feld_ger.delta && Ruf.ruf(g, 'ger') === q.ort_gehalten_ger.folge.ger, `Verteidigung gehalten: Rom +${q.ort_gehalten_ger.delta} (groß), Germanen ${q.ort_gehalten_ger.folge.ger}`);
  const erwartetRang = Ruf.rangVon(q.ort_gehalten_ger.delta);
  const meld = t.funk().filter((m) => m.ruf);
  ok(erwartetRang === 'miles' ? meld.length === 0 : meld.length === 1 && meld[0].lage === 1 && meld[0].r === 1 && /Rom/.test(meld[0].text), `Beförderung auf ${erwartetRang} wird einmal gefunkt (Lagefunk, wichtig): ${meld.map((m) => m.text).join(' | ').slice(0, 60)}`);
  // Piraten belagern den Hafen, Crew hält
  t = neu(); g = t.g;
  ok(siegSzene(g, OSTIA, 'pirat', 9, true) && rom(g) === q.ort_gehalten_pirat.delta, 'Piraten gegen den Hafen abgewehrt: ort_gehalten_pirat');
  // Fahrerflucht: Feld (Germanen)
  t = neu(); g = t.g; ohneZufall(g); ab(g);
  g.weltsim.ruf.rom = 20;
  ohneFlotten(g, FELD); flotte(g, FELD, 'ger', 9); ankunft(g, FELD); run(g, 2);
  const err = springe(g, '0504');
  ok(!err && !g.simSzene && rom(g) === 20 + q.fahrerflucht_ger.delta, `Fahrerflucht im Feld (Germanen): Rom ${q.fahrerflucht_ger.delta} (20 -> ${rom(g)})${err ? ' ' + err : ''}`);
  // Fahrerflucht um einen römischen Hafen, härter
  t = neu(); g = t.g; ohneZufall(g); ab(g);
  g.weltsim.ruf.rom = 20; ohneFlotten(g, OSTIA); flotte(g, OSTIA, 'ger', 17, { belagerung: true }); ankunft(g, OSTIA); run(g, 2);
  const err2 = springe(g, '0204');
  ok(!err2 && rom(g) === 20 + q.fahrerflucht_ort_ger.delta && q.fahrerflucht_ort_ger.delta < q.fahrerflucht_ger.delta, `Fahrerflucht um den Hafen: Rom ${q.fahrerflucht_ort_ger.delta} (20 -> ${rom(g)}), härter als im Feld${err2 ? ' ' + err2 : ''}`);
  // Piraten ignorieren: Flucht kostet nichts, im Feld und am Hafen
  for (const [hex, st, bel, ziel] of [[FELD, 5, false, '0504'], [OSTIA, 9, true, '0204']]) {
    t = neu(); g = t.g; ohneZufall(g); ab(g); g.weltsim.ruf.rom = 20;
    ohneFlotten(g, hex); flotte(g, hex, 'pirat', st, { belagerung: bel }); ankunft(g, hex); run(g, 2);
    const e = springe(g, ziel);
    ok(!e && Szene.letzte(g) && Szene.letzte(g).ausgang === 'abbruch' && rom(g) === 20 && Ruf.ruf(g, 'ger') === 0 && g.weltsim.letzteWirkungen.verworfen.length === 0, `Piraten ignorieren (${bel ? 'Hafen' : 'Feld'}): Flucht, keine Wirkung, kein Abzug${e ? ' ' + e : ''}`);
  }
  // Niederlage und Bleiben ohne Sieg ändern nichts am Ruf (nur Sieg und Flucht sind Quellen)
  t = neu(); g = t.g; ab(g); g.weltsim.ruf.rom = 20;
  ohneFlotten(g, FELD); flotte(g, FELD, 'ger', 9); ankunft(g, FELD); run(g, 21);
  g.stats.emergencies = (g.stats.emergencies || 0) + 5; run(g, 1);
  ok(!g.simSzene && rom(g) === 20, 'Niederlage (Notfallprotokoll): Ruf unverändert');
});

section('Ablehnen und Ignorieren ändern den Ruf nie', () => {
  // Führungsangebote kommen mit Paket E; hier gilt der Grundsatz an den vorhandenen Stellen: ohne Szene, ohne Wirkung rührt kein Tick den Ruf an
  const t = neu(); const g = t.g; ohneZufall(g); ab(g);
  g.weltsim.ruf.rom = 50; g.weltsim.ruf.ger = -10; g.weltsim.ruf.kon = 7;
  const vor = kopie(g.weltsim.ruf);
  for (let i = 0; i < 12; i++) Kriegslage.tick(g, 'sprung');
  Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'test' });
  ok(gleich(g.weltsim.ruf, vor), '13 Ticks ohne Szene und ohne Wirkung: Ruf unverändert (Notrufe ignorieren, Angebote ablehnen kosten nichts)');
  ok(Ruf.szeneFlucht({ ort: null, fraktion: 'pirat' }).length === 0 && Ruf.szeneFlucht({ ort: 'hafen', fraktion: 'pirat' }).length === 0, 'Regel: Flucht vor Piraten gibt keine Wirkung');
  ok(Ruf.szeneFlucht({ ort: null, fraktion: 'ger' }).length === 1 && Ruf.szeneSieg({ ort: 'hafen', fraktion: 'ger' }, true)[0].grund === 'ort_gehalten_ger' && Ruf.szeneSieg({ ort: 'hafen', fraktion: 'ger' }, false)[0].grund === 'sieg_feld_ger', 'Regel: Quelle folgt aus Fraktion, Ort und Ausgang');
});

section('Rang sinkt wieder, gefunkt; Gedeckelt', () => {
  const t = neu(); const g = t.g; ohneZufall(g); ab(g);
  g.weltsim.ruf.rom = RAENGE[2].ab;   // Centurio
  ohneFlotten(g, OSTIA); flotte(g, OSTIA, 'ger', 17, { belagerung: true }); ankunft(g, OSTIA); run(g, 2);
  const q = W.quellen.wert.fahrerflucht_ort_ger.delta;
  const err = springe(g, '0204');
  const nachher = RAENGE[Math.max(0, RAENGE.reduce((m, r, i) => (RAENGE[2].ab + q >= r.ab ? i : m), 0))].id;
  ok(!err && Ruf.rang(g) === nachher, `Fahrerflucht senkt den Ruf, der Rang folgt (Centurio -> ${Ruf.rang(g)})`);
  const ab_ = t.funk().filter((m) => m.ruf);
  ok(nachher === 'centurio' ? ab_.length === 0 : ab_.length === 1 && /zurück/.test(ab_[0].text), 'Rückstufung wird knapp gefunkt (' + (ab_[0] ? ab_[0].text : 'kein Rangwechsel') + ')');
  // Grenzen
  g.weltsim.ruf.rom = W.fraktionen.wert.rom.max - 1; Ruf.aendern(g, 'rom', 20); ok(rom(g) === W.fraktionen.wert.rom.max, 'Rom nie über dem Höchstwert (' + W.fraktionen.wert.rom.max + ')');
  g.weltsim.ruf.rom = 1; Ruf.aendern(g, 'rom', -20); ok(rom(g) === W.fraktionen.wert.rom.min, 'Rom nie unter dem Mindestwert (' + W.fraktionen.wert.rom.min + ')');
  g.weltsim.ruf.ger = W.fraktionen.wert.ger.min + 1; Ruf.anwenden(g, [wirk('rom', 10, 'ort_gehalten_ger')]); ok(Ruf.ruf(g, 'ger') === W.fraktionen.wert.ger.min, 'Germanen sinken automatisch, nie unter ihren Mindestwert');
  g.weltsim.ruf.ger = 0; Ruf.aendern(g, 'ger', 5); ok(Ruf.ruf(g, 'ger') === 0, 'Germanen steigen nicht über 0 (Platzhalter: nur abwärts)');
  // über den Tick geklemmt
  g.weltsim.ruf.rom = W.fraktionen.wert.rom.max - 1;
  Kriegslage.szeneAbschliessen(g, { wirkungen: [wirk('rom', 10, 'ort_gehalten_ger')], wo: 'test' });
  ok(rom(g) === W.fraktionen.wert.rom.max, 'auch über den Tick: gedeckelt');
  ok(Number.isFinite(Ruf.aendern(g, 'rom', 0.333).neu) && Ruf.aendern(g, 'pirat', 5).neu === 0 && Ruf.aendern(g, 'rom', NaN).neu === rom(g), 'unbekannte Fraktion und NaN ändern nichts');
});

section('Weltstand: Altstand, Runde, Müll', () => {
  const t = neu(); const g = t.g;
  const d0 = kopie(Weltstand.capture(g));
  ok(!('ruf' in d0.welt.sim) && !JSON.stringify(d0).includes('"ruf":{"rom"'), 'Ruf 0/0/0: kein Block (Altstand-gleich)');
  g.weltsim.ruf.rom = 42; g.weltsim.ruf.ger = -7; g.weltsim.ruf.kon = 3;
  const d1 = kopie(Weltstand.capture(g));
  ok(gleich(d1.welt.sim.ruf, { rom: 42, ger: -7, kon: 3 }) && d1.version === 3 && Weltstand.validate(d1).length === 0, 'gespeichert als welt.sim.ruf, Weltstand bleibt Version 3 und schemagültig');
  // Runde über die Platte und die Lobby
  const dir = freshDir(); d1.id = 'w-ruf'; fs.writeFileSync(path.join(dir, 'w-ruf.json'), JSON.stringify(d1));
  const t2 = neu({ dir, world: 'w-ruf' }); const g2 = t2.g;
  ok(g2.phase === 'play' && g2.weltsim && gleich(g2.weltsim.ruf, { rom: 42, ger: -7, kon: 3 }) && Ruf.rang(g2) === Ruf.rangVon(42) && g2.errors === 0, `Laden: Ruf und Rang wie gespeichert (${Ruf.rang(g2)})`);
  const d2 = kopie(Weltstand.capture(g2));
  ok(gleich(d2.welt.sim.ruf, d1.welt.sim.ruf), 'Runde Speichern, Laden, Speichern: gleich');
  // Altstand von main: Block fehlt
  const alt = kopie(d1); delete alt.welt.sim.ruf; alt.id = 'w-alt'; fs.writeFileSync(path.join(dir, 'w-alt.json'), JSON.stringify(alt));
  const t3 = neu({ dir, world: 'w-alt' });
  ok(t3.g.phase === 'play' && t3.g.weltsim && gleich(t3.g.weltsim.ruf, { rom: 0, ger: 0, kon: 0 }) && Ruf.rang(t3.g) === 'miles' && t3.g.errors === 0, 'Altstand ohne ruf lädt unverändert: Ruf 0, Miles');
  // Müll
  for (const [bl, soll] of [[{ rom: 'x', ger: 99, kon: -999 }, { rom: 0, ger: 0, kon: -50 }], [{ rom: 9999 }, { rom: W.fraktionen.wert.rom.max, ger: 0, kon: 0 }], ['x', { rom: 0, ger: 0, kon: 0 }], [[1, 2], { rom: 0, ger: 0, kon: 0 }], [null, { rom: 0, ger: 0, kon: 0 }], [{ rom: NaN, ger: Infinity }, { rom: 0, ger: 0, kon: 0 }]]) {
    ok(gleich(Ruf.lesen(bl), soll), 'Müll-fester Leser: ' + JSON.stringify(bl));
  }
});

section('Kampagne, Limes: kein Ruf', () => {
  for (const start of ['free', 'arena_space']) {
    const t = neu({ start }); const g = t.g;
    const d = kopie(Weltstand.capture(g));
    ok(!g.weltsim && Ruf.rang(g) === null && Ruf.snapshot(g) === null && Ruf.schluessel(g) === null, `${start}: kein weltsim, kein Rang, keine Anzeige`);
    ok(!d.welt || !d.welt.sim, `${start}: kein welt.sim im Weltstand`);
    ok(g.snapshot().world === undefined || g.snapshot().world.ruf === undefined, `${start}: kein world.ruf im Snapshot`);
    ok(g.rufErreicht('legat') === true && g.rufErreicht('gibtsnicht') === true && Ruf.ruf(g, 'rom') === 0, `${start}: rufErreicht ohne Ruf-System: jede Bedingung erfüllt`);
    ok(Ruf.debug(g, ['rom', '50']) === 'Nur im Modus Freie Fahrt Sund.', `${start}: Debug ruf lehnt ab`);
    ok(Kriegslage.toSave(g) === null, `${start}: Kriegslage.toSave null`);
  }
});

section('Werft-Hook', () => {
  const t = neu(); const g = t.g;
  g.inventory.marks = 5000;
  g.C.werft.ruf.stufe[1] = 'centurio';
  try {
    const code = (r) => { g.weltsim.ruf.rom = r; const e = Werft.freischaltenPruefen(g, 'stufe', 1); return e ? e.code : null; };
    ok(code(RAENGE[2].ab - 1) === 'ruf', 'Stufe 1 verlangt Centurio: einen Punkt darunter abgelehnt (Code ruf)');
    ok(code(RAENGE[2].ab) === null, 'genau auf der Schwelle: frei');
    ok(code(RAENGE[4].ab) === null, 'darüber: frei');
    ok(code(0) === 'ruf', 'Rang gesunken: neue Freischaltung verlangt den Rang wieder (schon Gekauftes regelt Paket C über freigeschaltet)');
    g.C.werft.ruf.stufe[1] = 'zenturio';
    ok(code(RAENGE[4].ab) === 'ruf', 'Tippfehler in der Rang-Id sperrt sichtbar (Fehlkonfiguration fällt auf, siehe Daten-Test)');
  } finally { delete g.C.werft.ruf.stufe[1]; }
  ok(Werft.freischaltenPruefen(g, 'stufe', 1) === null, 'ohne Eintrag im Ruf-Feld: keine Bedingung');
});

section('Snapshot und Mehrspieler', () => {
  const t = neu({ crew: 3 }); const g = t.g;
  // world.ruf wie world.lage: nur bei Änderung und nur in Snapshots ohne die großen seltenen Teile -> im nächsten freien Snapshot
  const naechster = () => { for (let i = 0; i < 40; i++) { const sn = g.snapshot(); if (sn.world && sn.world.ruf) return sn.world.ruf; } return null; };
  const keiner = () => { for (let i = 0; i < 40; i++) { const sn = g.snapshot(); if (sn.world && sn.world.ruf) return false; } return true; };
  ok(naechster() !== null && keiner(), 'beim Start einmal, dann nie wieder ohne Änderung');
  g.weltsim.ruf.rom = RAENGE[1].ab + 2; g.weltsim.ruf.ger = -5;
  const r1 = naechster();
  ok(r1 && r1.rom === RAENGE[1].ab + 2 && r1.ger === -5 && r1.rang === 'optio' && r1.bis === RAENGE[2].ab && r1.name === 'Optio', 'world.ruf: Ruf je Fraktion, Rang, Name, Schwelle des nächsten Rangs');
  const b1 = Buffer.byteLength(JSON.stringify(r1));
  ok(b1 <= 120, `Block ist klein (${b1} B)`);
  ok(keiner(), 'unverändert: nicht noch einmal gesendet (nur bei Änderung)');
  g.weltsim.ruf.rom += 1;
  ok((naechster() || {}).rom === RAENGE[1].ab + 3, 'bei Änderung wieder da');
  // Ein neu verbundener Client bekommt den Block wieder (alle sehen denselben Rang)
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'R0', name: 'R0', color: 0 });   // Wiederverbindung von Spieler 1
  const r3 = naechster();
  ok(r3 && r3.rang === 'optio', 'nach Wiederverbindung wird world.ruf neu gesendet (derselbe Snapshot für alle Clients)');
  // nur der Server schreibt: kein Befehl und kein Debug-Weg für Spieler außerhalb --debug
  ok(![].concat(...Object.values(Protocol).filter(Array.isArray).map((l) => l.filter((x) => typeof x === 'string'))).some((c2) => /^ruf(\.|$)/.test(c2) && !Protocol.DEBUG_CMDS.includes(c2)), 'kein Spielerbefehl für Ruf im Protokoll (nur Debug)');
  const rufVor = kopie(g.weltsim.ruf);
  for (const m of [{ t: 'cmd', c: 'ruf.aendern', fraktion: 'rom', delta: 50 }, { t: 'cmd', c: 'ruf', rom: 200 }, { t: 'ruf', rom: 200 }, { t: 'lobbyOpt', ruf: { rom: 200 } }]) g.handleMessage(t.cs[1], m);
  run(g, 0.5);
  ok(gleich(g.weltsim.ruf, rufVor), 'gefälschte Nachrichten eines Clients ändern den Ruf nicht');
  // Debug (nur im --debug-Modus des Servers) setzt und funkt
  c.inbox.length = 0;   // Spieler 1 hängt jetzt an der neuen Verbindung
  const dbg = Ruf.debug(g, ['rom', String(RAENGE[3].ab)]); run(g, 0.2);
  ok(dbg === null && Ruf.rang(g) === 'tribun' && c.inbox.some((m) => m.t === 'event' && m.kind === 'radio' && m.ruf && /Tribun/.test(m.text)), 'Debug ruf rom <wert>: setzt, Rang und Funk folgen');
  ok(typeof Ruf.debug(g, ['xyz']) === 'string' && typeof Ruf.debug(g, ['rom', 'abc']) === 'string', 'Debug: falsche Argumente -> Hinweis');
});

section('Weltstand speichert nie mitten im Tick', () => {
  const t = neu(); const g = t.g;
  g.weltsim.ruf.rom = 33;
  const json = JSON.stringify(Weltstand.capture(g));
  ok(!json.includes('rangMeldung') && !json.includes('letzteWirkungen'), 'nur der Ruf wird gespeichert, kein Zwischenzustand');
});

console.log(`\n${n} Prüfungen, ${fails} Fehler`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
