'use strict';
// SUND-02 A, Paket B: Wirkungen der Crew auf die Weltsimulation (server/weltsim/wirkungen.js, Kriegslage.szeneAbschliessen / wirkungenVormerken).
//   Katalog einzeln · Prüfer lehnt Ungültiges ab · Atomarität · Takt (Flucht per Sprung +1, Szenenende +1) · leere Wirkungen ändern nichts ·
//   Gedächtnis der Kommandanten speichern/laden · Altstand und Müll · Verhalten ohne Wirkungen unverändert.
//   node tools/test-wirkungen.js   (npm run test:wirkungen)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Sektoren = require('../shared/sektoren.js');
const Daten = require('../server/weltsim/daten.js');
const Kern = require('../server/weltsim/kern.js');
const Wirkungen = require('../server/weltsim/wirkungen.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sprung = require('../server/sim/sprung.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
const kopie = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------------------------------------------- Kern-Ebene
const { karte, werte } = Daten.laden();
const neu = (seed) => Kern.erzeuge({ karte, werte: kopie(werte), seed });
const ctx = (z) => ({ z, d: Daten.datenVon(z), w: z.werte, ev: [], mess: null });
const wende = (z, wk) => { const c = ctx(z); Kern.WIRKUNGEN[wk.typ](c, wk); return c.ev; };
const pr = (z, wk) => Wirkungen.pruefe(z, wk);
// Zustand mit laufender Belagerung von 0204 (Rom, Hafen) durch eine germanische Flotte
function belagerung() {
  const z = neu(3);
  const fl = z.flotten.find((f) => f.fraktion === 'ger');
  fl.ort = '0204'; fl.befehl = 'angriff'; fl.ziel = '0204';
  const id = z.naechsteAngriffId++;
  z.angriffe.push({ id, t0: 0, ziel: '0204', von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: 0, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: 0, stuetz: null, flotten: [fl.id] });
  fl.angriff = id;
  return { z, fl, id };
}
const romFlotte = (z) => z.flotten.find((f) => f.fraktion === 'rom');
const freiesHex = (z) => { const d = Daten.datenVon(z); return d.codes.find((c) => z.hexe[c].besitzer === null && d.hex[c].hafen === ''); };

section('1. Katalog: jede Wirkung einzeln (Zustand vor/nach)');
{
  // flotte_verlust
  const z = neu(1), fl = romFlotte(z), vor = fl.staerke;
  ok(pr(z, { typ: 'flotte_verlust', flotte: fl.id, punkte: 2 }).ok, 'flotte_verlust: gültig');
  wende(z, { typ: 'flotte_verlust', flotte: fl.id, punkte: 2 });
  ok(Math.abs(fl.staerke - (vor - 2)) < 1e-9 && fl.befehl === 'heim', `flotte_verlust: Stärke ${vor} -> ${fl.staerke}`);
  const z2 = neu(1), f2 = romFlotte(z2); f2.befehl = 'angriff'; f2.ziel = '0305'; f2.ort = '0305';
  wende(z2, { typ: 'flotte_verlust', flotte: f2.id, punkte: f2.staerke - 0.2 });
  ok(f2.staerke === 0.5 && f2.ort === f2.heimat && f2.befehl === 'heim' && f2.ziel === null, 'flotte_verlust unter 0,5: Stärke 0,5, zurück nach Heimat (Konvention von gefecht())');
  // abwehr_verlust
  const z3 = neu(1), a0 = z3.hexe['0204'].abwehr;
  wende(z3, { typ: 'abwehr_verlust', ort: '0204', punkte: 1.5 });
  ok(Math.abs(z3.hexe['0204'].abwehr - (a0 - 1.5)) < 1e-9, `abwehr_verlust: Abwehr ${a0} -> ${z3.hexe['0204'].abwehr}`);
  const fx = freiesHex(z3); z3.hexe[fx].posten = true; z3.hexe[fx].besitzer = 'rom'; z3.hexe[fx].garnison = 3;
  wende(z3, { typ: 'abwehr_verlust', ort: fx, punkte: 2 });
  ok(Math.abs(z3.hexe[fx].garnison - 1) < 1e-9, 'abwehr_verlust: Garnison eines Postens');
  // flaggschiff_gefallen: im Feld unterwegs -> Rückzug (Reststärke bleibt), Feldzug bleibt verknüpft
  const b = belagerung(); const s0 = b.fl.staerke;
  ok(pr(b.z, { typ: 'flaggschiff_gefallen', flotte: b.fl.id, kommandant: { name: 'Varro', schicksal: 'gefallen' } }).ok, 'flaggschiff_gefallen: gültig');
  wende(b.z, { typ: 'flaggschiff_gefallen', flotte: b.fl.id, kommandant: { name: 'Varro', schicksal: 'gefallen' } });
  ok(b.fl.befehl === 'rueckzug' && b.fl.ziel === b.fl.heimat && b.fl.staerke === s0, 'flaggschiff_gefallen: Flotte bricht ab (Rückzug), Reststärke bleibt');
  Kern.tick(b.z);
  ok(b.z.angriffe.find((r) => r.id === b.id).ausgang === 'abgewehrt', 'flaggschiff_gefallen: der Tick schließt den Feldzug als abgewehrt');
  // ort_gehalten
  const h = belagerung();
  ok(pr(h.z, { typ: 'ort_gehalten', ort: '0204' }).ok && pr(h.z, { typ: 'ort_gehalten', ort: '0204', angriff: h.id }).ok, 'ort_gehalten: gültig (mit und ohne Angriffs-Id)');
  const ev = wende(h.z, { typ: 'ort_gehalten', ort: '0204' });
  const rec = h.z.angriffe.find((r) => r.id === h.id);
  ok(rec.ausgang === 'abgewehrt' && rec.t_ende === h.z.tick, 'ort_gehalten: Feldzug als abgewehrt geschlossen');
  ok(h.fl.befehl === 'rueckzug' && h.fl.ziel === h.fl.heimat, 'ort_gehalten: Angreiferflotte zieht sich zurück');
  ok(ev.length === 1 && ev[0].typ === 'angriff_abgewehrt' && ev[0].ziel === '0204' && ev[0].angriff === h.id, 'ort_gehalten: Ereignis angriff_abgewehrt');
  ok(!pr(h.z, { typ: 'ort_gehalten', ort: '0204' }).ok, 'ort_gehalten: ein zweites Mal ohne laufende Belagerung abgelehnt');
  // ort_gefallen: Hafen
  const g = neu(1);
  const evh = wende(g, { typ: 'ort_gefallen', ort: '0204', an: 'ger' });
  ok(g.hexe['0204'].besitzer === 'ger', 'ort_gefallen (Hafen): Besitzer wechselt');
  ok(evh.some((e) => e.typ === 'hafen_gefallen' && e.neu === 'ger' && e.alt === 'rom') && evh.some((e) => e.typ === 'hauptwelt_gefallen'), 'ort_gefallen (Hafen): Ereignisse hafen_gefallen und hauptwelt_gefallen wie erobern()');
  ok(g.flotten.some((f) => f.fraktion === 'ger' && f.heimat === '0204' && f.ort === '0204'), 'ort_gefallen (Hafen): neue Flotte des Siegers im Hafen');
  // ort_gefallen: Posten
  const p = neu(1), px = freiesHex(p); p.hexe[px].posten = true; p.hexe[px].besitzer = 'rom'; p.hexe[px].garnison = 3;
  const evp = wende(p, { typ: 'ort_gefallen', ort: px, an: 'pirat' });
  ok(p.hexe[px].besitzer === null && p.hexe[px].posten === false && p.hexe[px].garnison === 0, 'ort_gefallen (Posten): Ort wird frei, Posten weg');
  ok(evp.length === 1 && evp[0].typ === 'posten_verloren' && evp[0].durch === 'pirat' && evp[0].besitzer === 'rom', 'ort_gefallen (Posten): Ereignis posten_verloren wie im Gefecht');
  // über den Tick: Wirkungen kommen vor dem Schritt
  const t = neu(2); const nach = Kern.tick(t, { wirkungen: [{ typ: 'ort_gefallen', ort: '0204', an: 'ger' }] });
  ok(nach.ereignisse.some((e) => e.typ === 'hafen_gefallen') && nach.zustand.tick === 1, 'Kern.tick(wirkungen): Wirkung vor dem Schritt, ein Tick');
}

section('2. Prüfer lehnt Ungültiges ab');
{
  const z = neu(1), fl = romFlotte(z), b = belagerung();
  const nein = (wk, text, zz) => { const r = pr(zz || z, wk); ok(!r.ok && typeof r.grund === 'string' && r.grund.length > 0, `${text} (${r.grund})`); };
  nein(null, 'keine Wirkung');
  nein({ typ: 'zaubern' }, 'unbekannter Typ');
  nein({ typ: 'flotte_verlust', punkte: 1 }, 'flotte_verlust ohne Flotte');
  nein({ typ: 'flotte_verlust', flotte: 99999, punkte: 1 }, 'unbekannte Flotte');
  nein({ typ: 'flotte_verlust', flotte: fl.id, punkte: -1 }, 'negative Punkte');
  nein({ typ: 'flotte_verlust', flotte: fl.id, punkte: NaN }, 'Punkte NaN');
  nein({ typ: 'flotte_verlust', flotte: fl.id, punkte: '3' }, 'Punkte als Text');
  nein({ typ: 'flotte_verlust', flotte: fl.id, punkte: fl.staerke + 5 }, 'mehr Punkte als Stärke');
  nein({ typ: 'abwehr_verlust', ort: 'XXXX', punkte: 1 }, 'unbekannter Ort');
  nein({ typ: 'abwehr_verlust', ort: '0204', punkte: z.hexe['0204'].abwehr + 1 }, 'mehr Punkte als Abwehr');
  nein({ typ: 'abwehr_verlust', ort: freiesHex(z), punkte: 1 }, 'abwehr_verlust für Ort ohne Hafen und Posten');
  nein({ typ: 'flaggschiff_gefallen', flotte: fl.id }, 'flaggschiff_gefallen ohne Kommandant');
  nein({ typ: 'flaggschiff_gefallen', flotte: fl.id, kommandant: { name: 'X', schicksal: 'tot' } }, 'ungültiges Schicksal');
  nein({ typ: 'flaggschiff_gefallen', flotte: fl.id, kommandant: { name: '', schicksal: 'gefallen' } }, 'leerer Kommandantenname');
  nein({ typ: 'flaggschiff_gefallen', flotte: 0, kommandant: { name: 'X', schicksal: 'gefallen' } }, 'flaggschiff_gefallen: unbekannte Flotte');
  nein({ typ: 'ort_gehalten', ort: '0204' }, 'ort_gehalten ohne laufende Belagerung');
  nein({ typ: 'ort_gehalten', ort: '0204', angriff: b.id + 7 }, 'ort_gehalten mit falscher Angriffs-Id', b.z);
  b.z.angriffe[0].t_an = null;
  nein({ typ: 'ort_gehalten', ort: '0204' }, 'ort_gehalten: Feldzug noch nicht angekommen', b.z);
  nein({ typ: 'ort_gefallen', ort: '0204', an: 'rom' }, 'ort_gefallen an den eigenen Besitzer (nicht feindlich)');
  nein({ typ: 'ort_gefallen', ort: '0204', an: 'kon' }, 'ort_gefallen an das Konkordat (nicht feindlich zu Rom)');
  nein({ typ: 'ort_gefallen', ort: '0204', an: 'pirat' }, 'ort_gefallen: Piraten erobern keinen Hafen');
  nein({ typ: 'ort_gefallen', ort: '0204', an: 'elfen' }, 'ort_gefallen an unbekannte Fraktion');
  nein({ typ: 'ort_gefallen', ort: freiesHex(z), an: 'ger' }, 'ort_gefallen für Ort ohne Besitzer');
  ok(pr(z, { typ: 'ort_gefallen', ort: '0204', an: 'ger' }).ok, 'Gegenprobe: ort_gefallen an Germanen gültig');
  // Probelauf sieht frühere Wirkungen: zweimal derselbe Hafen
  const f = Kern.filtereWirkungen(z, [{ typ: 'ort_gefallen', ort: '0204', an: 'ger' }, { typ: 'ort_gefallen', ort: '0204', an: 'ger' }]);
  ok(f.gueltig.length === 1 && f.verworfen.length === 1 && hexRom(z), 'zweimal ort_gefallen: die zweite wird verworfen, der echte Zustand bleibt unberührt');
}
function hexRom(z) { return z.hexe['0204'].besitzer === 'rom'; }

section('3. Ohne Wirkungen ändert sich nichts am Lauf');
{
  const a = neu(9), b = neu(9), c = neu(9);
  for (let i = 0; i < 150; i++) { Kern.tick(a); Kern.tick(b, { wirkungen: [] }); Kern.tick(c, { wirkungen: [], absichten: undefined }); }
  ok(gleich(a, b) && gleich(a, c), '150 Ticks: mit leerer Wirkungsliste tief gleich wie ohne');
}

// ---------------------------------------------------------------------------------------------------------------- Spiel-Ebene
const ROOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-wirkungen-'));
let dirSeq = 0;
let kernTicks = 0;
const kernOrig = Kern.tick;
Kern.tick = function (...a) { kernTicks++; return kernOrig.apply(this, a); };
function setup(seed) {
  const dir = path.join(ROOT_TMP, 'w' + (++dirSeq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(ROOT_TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Crew', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 30; k++) g.step();
  g.space.enemies = [];
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  return g;
}
function place(g, x, y) { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }
function springe(g, hex) {
  const von = Sektoren.hexVonOrt(g.ship.scene);
  g.explore.markBoje(Sektoren.kanteId(von, hex)); g.explore.erkunde(hex);
  const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return 'Ziel: ' + e;
  const p = Sprung.sprungpunkt(g, hex); place(g, p.x - 80, p.y);
  for (let k = 0; k < 40 * 30; k++) g.step();
  g.space.enemies = [];
  return Sprung.doJump(g);
}
const abb = (g) => Kriegslage.abbild(g.weltsim.zustand);

section('4. Takt: Szenenende ohne Sprung = ein Tick, Flucht per Sprung = der eine Sprung-Tick');
{
  const g = setup(7); const ws = g.weltsim;
  const z = ws.zustand, rf = romFlotte(z), vorPunkte = rf.staerke;
  const k0 = kernTicks, t0 = ws.tickZahl;
  const r = Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'flotte_verlust', flotte: rf.id, punkte: 0.5 }, { typ: 'flotte_verlust', flotte: 424242, punkte: 1 }, { typ: 'zaubern' }] });
  ok(r.ok && ws.tickZahl === t0 + 1 && kernTicks === k0 + 1 && r.tick === t0 + 1, 'Szenenende-Pfad: Tickzähler +1, Kern.tick genau einmal');
  ok(r.angewandt === 1 && r.verworfen.length === 2 && r.verworfen.every((v) => v.grund), 'eine gültige angewandt, zwei ungültige verworfen und gemeldet (Zählung)');
  ok(ws.wirkungenAngewandt === 1 && ws.wirkungenVerworfen === 2, 'Zähler game.weltsim.wirkungenAngewandt/-Verworfen');
  ok(Array.isArray(r.ereignisse) && g.errors === 0, 'Ereignisse geliefert, keine Fehler');
  // Ereignisse landen im Ring (Pipeline wie beim Sprung)
  const gf = setup(7);
  const r2 = Kriegslage.szeneAbschliessen(gf, { wirkungen: [{ typ: 'ort_gefallen', ort: '0204', an: 'ger' }] });
  ok(r2.ereignisse.some((e) => e.typ === 'hafen_gefallen') && gf.weltsim.ereignisse.some((e) => e.typ === 'hafen_gefallen' && e.n === gf.weltsim.tickZahl), 'Ereignisse im Ring (n = Tickzähler)');
  ok(gf.weltBesitz.hexe['0204'].besitzer === 'ger' && gf.weltsim.hauptweltGefallen && gf.weltsim.hauptweltGefallen.fraktion === 'rom', 'Besitz-Overlay und Hauptwelt-Hook nach der Wirkung');
  ok(gf.weltsim.wissen && gf.weltsim.wissen.t === gf.weltsim.tickZahl, 'Wissen von Rom nachgeführt (Wissen.nachTick)');

  // Flucht per Sprung
  const f = setup(7); const w2 = f.weltsim;
  const px = freiesHex(w2.zustand);
  w2.zustand.hexe[px].posten = true; w2.zustand.hexe[px].besitzer = 'rom'; w2.zustand.hexe[px].garnison = 3;
  const k1 = kernTicks, t1 = w2.tickZahl;
  const v = Kriegslage.wirkungenVormerken(f, [{ typ: 'ort_gefallen', ort: px, an: 'pirat' }, { typ: 'abwehr_verlust', ort: '0204', punkte: -3 }]);
  ok(v.vorgemerkt === 1 && v.verworfen.length === 1 && w2.tickZahl === t1 && kernTicks === k1, 'wirkungenVormerken: eine vorgemerkt, eine verworfen, KEIN Tick');
  ok(w2.zustand.hexe[px].posten === true, 'Vormerken ändert den Zustand nicht');
  const b = Weltstand.capture(f);
  ok(b.welt.sim.vorgemerkt && b.welt.sim.vorgemerkt.length === 1, 'Vorgemerktes steht im Weltstand (welt.sim.vorgemerkt)');
  const fehl = springe(f, '0205');
  ok(fehl === null || fehl === undefined, 'Sprung ausgeführt (' + fehl + ')');
  ok(w2.tickZahl === t1 + 1 && kernTicks === k1 + 1, 'Flucht per Sprung: Tickzähler +1 gesamt (Wirkungen + der eine Sprung-Tick)');
  ok(w2.zustand.hexe[px].posten === false && w2.zustand.hexe[px].besitzer === null && w2.ereignisse.some((e) => e.typ === 'posten_verloren'), 'vorgemerkte Wirkung im Sprung-Tick angewandt');
  ok(w2.vorgemerkt.length === 0 && !('vorgemerkt' in Weltstand.capture(f).welt.sim), 'Vormerkung verbraucht, nicht mehr im Weltstand');
  ok(f.errors === 0, 'keine Fehler');

  // Szenenende-Pfad nach Vormerken: kein doppelter Tick
  const h = setup(7); Kriegslage.wirkungenVormerken(h, [{ typ: 'flotte_verlust', flotte: romFlotte(h.weltsim.zustand).id, punkte: 0.3 }]);
  const k2 = kernTicks; Kriegslage.szeneAbschliessen(h, { wirkungen: [] });
  ok(kernTicks === k2 + 1 && h.weltsim.wirkungenAngewandt === 1 && h.weltsim.vorgemerkt.length === 0, 'Vorgemerktes + szeneAbschliessen: ein Tick, Vorgemerktes angewandt');
}

section('5. Atomarität');
{
  const g = setup(7); const ws = g.weltsim;
  const rf = romFlotte(ws.zustand);
  let aufrufe = 0;
  const merke = { pruefe: Wirkungen.KATALOG.flotte_verlust.pruefe };
  Wirkungen.KATALOG.test_wurf = { pruefe: () => null, anwenden: () => { aufrufe++; if (aufrufe % 2 === 0) throw new Error('mitten drin'); } };   // Probelauf ok, echte Anwendung wirft
  Kern.WIRKUNGEN.test_wurf = Wirkungen.KATALOG.test_wurf.anwenden;
  const vor = abb(g), tz = ws.tickZahl, wiss = kopie(ws.wissen), ring = ws.ereignisse.length;
  const r = Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'flotte_verlust', flotte: rf.id, punkte: 0.5 }, { typ: 'test_wurf' }] });
  ok(!r.ok && r.ereignisse === null, 'Wurf in der Anwendung: Ergebnis ok=false');
  ok(gleich(abb(g), vor) && ws.tickZahl === tz && ws.ereignisse.length === ring && gleich(kopie(ws.wissen), wiss), 'alter Zustand: Sim, Tickzähler, Ring und Wissen unverändert (auch die erste, schon angewandte Wirkung zurückgerollt)');
  ok(ws.fehler === 1 && g.errors >= 1, 'Fehler gezählt');
  ok(ws.vorgemerkt.length === 0, 'nach dem Wurf nichts Vorgemerktes mehr (kein Dauerscheitern)');
  // ein Wurf schon im Probelauf: nur diese Wirkung fliegt raus, die Szene bleibt gültig
  Wirkungen.KATALOG.test_wurf.anwenden = () => { throw new Error('immer'); };
  Kern.WIRKUNGEN.test_wurf = Wirkungen.KATALOG.test_wurf.anwenden;
  const r2 = Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'test_wurf' }, { typ: 'flotte_verlust', flotte: rf.id, punkte: 0.5 }] });
  ok(r2.ok && r2.angewandt === 1 && r2.verworfen.length === 1 && /wirft/.test(r2.verworfen[0].grund) && ws.tickZahl === tz + 1, 'Wurf schon im Probelauf: nur diese Wirkung verworfen, der Rest gilt, ein Tick');
  delete Wirkungen.KATALOG.test_wurf; delete Kern.WIRKUNGEN.test_wurf;
  ok(merke.pruefe === Wirkungen.KATALOG.flotte_verlust.pruefe, 'Katalog nach dem Test wiederhergestellt');
}

section('6. Szene ohne Wirkung ändert den Weltstand nicht');
{
  const a = setup(11), b = setup(11);
  const r = Kriegslage.szeneAbschliessen(a, { wirkungen: [] });
  Kriegslage.tick(b, 'sprung');
  ok(r.ok && r.angewandt === 0 && r.verworfen.length === 0, 'leere Liste: nichts angewandt, nichts verworfen');
  ok(gleich(abb(a), abb(b)) && a.weltsim.tickZahl === b.weltsim.tickZahl && gleich(a.weltsim.ereignisse, b.weltsim.ereignisse), 'szeneAbschliessen([]) = ein gewöhnlicher Tick (Sim-Zustand, Zähler, Ring gleich)');
  ok(gleich(Kriegslage.toSave(a).zustand, Kriegslage.toSave(b).zustand) && gleich(a.weltsim.kommandanten, {}) && a.weltsim.vorgemerkt.length === 0, 'kein anderer Zustandsunterschied (kein Gedächtnis, nichts vorgemerkt)');
  const c = setup(11);
  const vorher = kopie(Kriegslage.toSave(c)), abbVor = abb(c), tz = c.weltsim.tickZahl, kz = kernTicks;
  const v = Kriegslage.wirkungenVormerken(c, []);
  ok(v.vorgemerkt === 0 && gleich(kopie(Kriegslage.toSave(c)), vorher) && gleich(abb(c), abbVor) && c.weltsim.tickZahl === tz && kernTicks === kz, 'wirkungenVormerken([]) ändert nichts (Weltstand-Block, Sim, Tick)');
  const ohne = setup(11); ohne.weltsim = null; ohne.weltBesitz = null;
  ok(Kriegslage.szeneAbschliessen(ohne, { wirkungen: [{ typ: 'ort_gefallen', ort: '0204', an: 'ger' }] }).ok === false && Kriegslage.wirkungenVormerken(ohne, [{}]).vorgemerkt === 0, 'ohne Modus (Kampagne): nichts, kein Fehler');
}

section('7. Gedächtnis der Kommandanten: speichern und laden');
{
  const g = setup(5); const ws = g.weltsim;
  const fl = ws.zustand.flotten.find((f) => f.fraktion === 'ger');
  Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'flaggschiff_gefallen', flotte: fl.id, kommandant: { name: 'Hrolf Eisenhand', schicksal: 'entkommen' } }] });
  const k = ws.kommandanten['Hrolf Eisenhand'];
  ok(k && k.fraktion === 'ger' && k.schicksal === 'entkommen' && k.begegnungen === 1 && k.tick === ws.tickZahl, 'Kommandant vermerkt (Fraktion, Schicksal, Begegnungen 1, Tick)');
  Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'flaggschiff_gefallen', flotte: fl.id, kommandant: { name: 'Hrolf Eisenhand', schicksal: 'gefallen' } }] });
  ok(ws.kommandanten['Hrolf Eisenhand'].begegnungen === 2 && ws.kommandanten['Hrolf Eisenhand'].schicksal === 'gefallen', 'zweite Begegnung: Zähler 2, Schicksal gefallen');
  Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'flaggschiff_gefallen', flotte: fl.id, kommandant: { name: 'Hrolf Eisenhand', schicksal: 'entkommen' } }] });
  ok(ws.kommandanten['Hrolf Eisenhand'].schicksal === 'gefallen' && ws.kommandanten['Hrolf Eisenhand'].begegnungen === 3, 'gefallen bleibt gefallen');
  const stand = Weltstand.capture(g);
  const block = kopie(stand.welt.sim);
  ok(gleich(block.kommandanten, kopie(ws.kommandanten)) && stand.version === 3, 'Weltstand trägt welt.sim.kommandanten, Version bleibt 3');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'schema', 'weltstand.schema.json'), 'utf8'));
  const sp = schema.properties.welt.properties.sim.properties;
  ok(sp.kommandanten && sp.vorgemerkt, 'Schema kennt kommandanten und vorgemerkt');
  Kriegslage.restore(g, kopie(block));
  ok(gleich(g.weltsim.kommandanten, block.kommandanten) && g.weltsim.tickZahl === block.tick, 'restore: Gedächtnis und Tick wie gespeichert');
  // Altstand ohne die Felder
  const alt = kopie(block); delete alt.kommandanten; delete alt.vorgemerkt;
  Kriegslage.restore(g, alt);
  ok(g.weltsim && gleich(g.weltsim.kommandanten, {}) && gleich(g.weltsim.vorgemerkt, []) && g.weltsim.tickZahl === block.tick, 'Altstand ohne die Felder lädt unverändert (leeres Gedächtnis)');
  ok(Kriegslage.szeneAbschliessen(g, { wirkungen: [] }).ok, 'nach dem Altstand-Laden läuft die Sim weiter');
  // Müll
  const muell = kopie(block);
  muell.kommandanten = { '': { schicksal: 'gefallen' }, A: 5, B: { schicksal: 'tot' }, C: { schicksal: 'gefallen', fraktion: 7, begegnungen: 'x', tick: -4 }, D: null };
  muell.vorgemerkt = [null, 5, 'x', { typ: 3 }, [], { typ: 'flotte_verlust', flotte: 'a', punkte: 'b' }];
  let wirft = false;
  try { Kriegslage.restore(g, muell); } catch (e) { wirft = true; }
  ok(!wirft && gleich(Object.keys(g.weltsim.kommandanten), ['C']) && gleich(g.weltsim.kommandanten.C, { fraktion: '', schicksal: 'gefallen', begegnungen: 1, tick: 0 }), 'Müll im Gedächtnis: nur der brauchbare Eintrag bleibt, bereinigt');
  ok(g.weltsim.vorgemerkt.length === 1, 'Müll in vorgemerkt: nur Objekte mit Typ bleiben');
  const r = Kriegslage.szeneAbschliessen(g, { wirkungen: [] });
  ok(r.ok && r.verworfen.length === 1 && g.errors === 0, 'das ungültige Restchen wird beim Tick verworfen, kein Wurf');
  Kriegslage.restore(g, Object.assign(kopie(block), { kommandanten: 'x', vorgemerkt: 7 }));
  ok(gleich(g.weltsim.kommandanten, {}) && gleich(g.weltsim.vorgemerkt, []), 'kommandanten/vorgemerkt vom falschen Typ: leer');
}

console.log(`\n${n - fails}/${n} Prüfungen ok`);
try { fs.rmSync(ROOT_TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
