'use strict';
// SUND-02b E: Beschuss auf römische Verbündete („Verrat“, server/sim/verrat.js, kriegslage-szene.js verratStarten/verratSieg/verratNiederlage, Daten content/welt/verrat-werte.json,
// Ruf-Quellen verrat_beginn und verrat_flotte_vernichtet, Texte content/flotte/verrat.json). Direkt gegen die Game-Klasse, ohne Netz (Mehrspieler: tools/test-verrat-ws.js).
//   Daten · Weigerungsgründe (nur Sim-Szene mit Verbündeten, nie Eisenwald/Kette/Kampagne) · Anlauf und kostenloser Abbruch · Umschaltung (Verbündete weg, Gegner gleicher Klasse und Quote)
//   · Sieg/Flucht/Niederlage mit genau einem Tick · Ruf nur bei tatsächlicher Auslösung, nie Ertrag · Rang sinkt, Gekauftes bleibt · atomar mit Rollback · Gedächtnis, Speichern, Laden, Altstand · Anzeige
//   node tools/test-verrat.js [begriff …]   (npm run test:verrat)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Sektoren = require('../shared/sektoren.js');
const Kern = require('../server/weltsim/kern.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const Ruf = require('../server/sim/ruf.js');
const Posten = require('../server/sim/posten.js');
const Verrat = require('../server/sim/verrat.js');
const Werft = require('../server/sim/werft.js');
const Flotte = require('../server/sim/flotte.js');
const Space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');   // SYS-01 C1a-1: Gegner ohne Hülle, Abschuss über den Reaktor
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

const VW = require('../content/welt/verrat-werte.json').werte;
const RUF = require('../content/welt/ruf-werte.json').werte;
const TEXTE = require('../content/flotte/verrat.json');
const RAENGE = RUF.raenge.wert;
const Q_B = RUF.quellen.wert.verrat_beginn, Q_V = RUF.quellen.wert.verrat_flotte_vernichtet;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-verrat-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const HZ = CONFIG.tickHz;
const FREI = '0505', OSTIA = '0305';
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
const ohneFlotten = (g, hex) => { const st = z(g); st.flotten = st.flotten.filter((f) => f.ort !== hex); };
const HEIMAT = { ger: '1004', pirat: '0602', kon: '0604', rom: '0405' };
function flotte(g, hex, fraktion, staerke) {
  const st = z(g);
  const fl = { id: st.naechsteId++, fraktion, heimat: HEIMAT[fraktion] || hex, ort: hex, staerke, kap: Math.max(staerke, 5), befehl: 'rueckzug', ziel: null, warte: 0, versorgung: 1, angriff: null };
  fl.ziel = fl.heimat; st.flotten.push(fl); return fl;
}
// Partie im freien Hex mit römischer Flotte (Verbündete) und germanischer Flotte (Szene), Ops besetzt, Rang aus o.ruf (Standard 50 = Centurio)
function bereit(o) {
  const op = o || {};
  const t = neu(op); const g = t.g;
  g.weltsim.ruf.rom = op.ruf != null ? op.ruf : 50;
  const hex = op.hex || FREI;
  ohneFlotten(g, hex);
  ankunft(g, hex); ops(g); run(g, 0.2);
  const rfl = op.rom === 0 ? null : flotte(g, hex, 'rom', op.rom || 6);
  const fehler = Szene.debug(g, [String(op.staerke || 6), 'ger'].concat(op.hex === OSTIA ? ['belagerung'] : []));
  if (fehler) throw new Error('Szene nicht ausgelöst: ' + fehler);
  if (op.kampf) run(g, CONFIG.simSzene.vorwarnung + 2);
  return Object.assign(t, { hex, rfl });
}
const halt = (g) => g.fracht && g.fracht.halt;
const grund = (g) => { const e = Verrat.pruefen(g, false); return e ? e.code : null; };
const kill = (g, e) => Testhilfe.toeten(g, e);
const ex = (g) => g.space.enemies.filter((e) => e.verratS);
const allies = (g) => (g.space.escorts || []).filter((q) => q.ally);
// zweistufig (Review E): erster Druck = Anfrage, zweiter Druck im Fenster = Anlauf; Weigerungen kommen schon beim ersten Druck
const startVerrat = (g, p) => { const e = Verrat.verratStart(g, p); if (e) return e; return Verrat.verratStart(g, p); };
const verrat = (g) => { const e = startVerrat(g, g.players[0]); if (e) return e; run(g, VW.anlauf.wert.dauer + 1.5); return null; };   // Anlauf bis zum Abschluss
function durchspielen(g, maxSek) {
  for (let i = 0; i < (maxSek || 400) * HZ; i++) { for (const e of g.space.enemies.slice()) kill(g, e); g.step(); if (!g.simSzene) return true; }
  return !g.simSzene;
}
function springe(g, hex) {
  const von = Sektoren.hexVonOrt(g.ship.scene);
  g.explore.markBoje(Sektoren.kanteId(von, hex)); g.explore.erkunde(hex);
  const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return 'Ziel: ' + e;
  const p = Sprung.sprungpunkt(g, hex); const s = g.ship; s.x = p.x - 80; s.y = p.y; s.vx = 0; s.vy = 0; s.speed = 0;
  s.jump.charge = 1; s.jump.ready = true;
  return Sprung.doJump(g);
}

section('Daten und Texte', () => {
  neu();
  ok(VW.anlauf.wert.dauer > 0 && Array.isArray(VW.phasen.wert) && VW.phasen.wert.every((p) => ['vorwarnung', 'kampf'].includes(p)) && VW.huelle_min.wert > 0 && VW.huelle_min.wert <= 1, 'Daten: Anlauf, Phasen, Mindest-Hülle');
  ok(Q_B && Q_B.fraktion === 'rom' && Q_B.delta < 0 && Math.abs(Q_B.delta) <= RUF.delta_max.wert, 'Ruf-Quelle verrat_beginn: Rom, negativ, unter delta_max (' + (Q_B && Q_B.delta) + ')');
  ok(Q_V && Q_V.fraktion === 'rom' && Q_V.delta < 0 && Math.abs(Q_V.delta) <= RUF.delta_max.wert, 'Ruf-Quelle verrat_flotte_vernichtet: Rom, negativ (' + (Q_V && Q_V.delta) + ')');
  ok(Q_B.folge && 'ger' in Q_B.folge && Q_B.folge.ger === 0 && Q_V.folge && Q_V.folge.ger === 0, 'Folge für andere Fraktionen vorbereitet (Eintrag ger: 0), baut nichts');
  ok(Object.keys(RUF.quellen.wert).filter((k) => /verrat/.test(k)).every((k) => RUF.quellen.wert[k].delta < 0), 'keine Verrat-Quelle gibt Ruf');
  for (const c of ['modus', 'keine_szene', 'phase', 'schon', 'keine_verbuendeten', 'transfer', 'docked', 'laeuft']) ok(typeof TEXTE.weigerung[c] === 'string' && TEXTE.weigerung[c].length > 5, 'Weigerungstext ' + c);
  for (const c of ['abgebrochen', 'szene', 'keine_verbuendeten', 'transfer', 'sprung', 'ops']) ok(typeof TEXTE.abbruch[c] === 'string' && /Nichts ist geschehen/.test(TEXTE.abbruch[c]), 'Abbruchtext ' + c + ' sagt, dass nichts geschehen ist');
  ok(/Hochverrat/.test(TEXTE.anlauf) && /Ruf/.test(TEXTE.anlauf) && /Abbrechen/.test(TEXTE.anlauf) && /\{sek\}/.test(TEXTE.anlauf), 'Warnung nennt Hochverrat, Ruf und kostenloses Abbrechen');
  for (const k of ['beginn', 'beginnLeise', 'feinde', 'sieg', 'niederlage', 'flucht', 'chronik']) ok(typeof TEXTE[k] === 'string' && TEXTE[k].length > 5, 'Text ' + k);
  const Wirk = require('../server/weltsim/wirkungen.js');
  const { g } = neu();
  for (const q of [Q_B, Q_V]) ok(!Wirk.pruefe(z(g), { typ: 'ruf_aenderung', fraktion: 'rom', delta: q.delta, grund: q === Q_B ? 'verrat_beginn' : 'verrat_flotte_vernichtet' }).grund, 'Wirkung ruf_aenderung mit dem Grund wird vom Prüfer angenommen');
});

section('Weigerungsgründe', () => {
  const { g } = neu();
  ok(grund(g) === 'keine_szene' && startVerrat(g, g.players[0]) === TEXTE.weigerung.keine_szene && !halt(g), 'ohne Szene: Weigerung, kein Halteprozess');
  ok(g.snapshot().space.po === undefined, 'ohne Szene: kein space.po');
  // Szene ohne Verbündete (keine römische Flotte im Hex)
  const t = bereit({ rom: 0, kampf: true }); const g2 = t.g;
  ok(g2.simSzene && allies(g2).length === 0 && grund(g2) === 'keine_verbuendeten', 'Szene ohne römische Flotte: „keine_verbuendeten“');
  ok(startVerrat(g2, g2.players[0]) === TEXTE.weigerung.keine_verbuendeten && !halt(g2), 'Befehl lehnt ab, kein Halteprozess');
  ok(g2.snapshot().space.po === undefined, 'ohne Verbündete: kein space.po (kein Knopf)');
  // mit Verbündeten
  const u = bereit({ kampf: true }); const g3 = u.g;
  ok(allies(g3).length > 0 && allies(g3).every((q) => q.sim === g3.simSzene.id) && grund(g3) === null, 'Szene mit römischen Verbündeten: erlaubt (Phase kampf)');
  const v = bereit(); ok(v.g.simSzene.phase === 'vorwarnung' && grund(v.g) === null, 'Phase Vorwarnung: erlaubt');
  { const alt = VW.phasen.wert.slice(); VW.phasen.wert.length = 0; VW.phasen.wert.push('kampf'); ok(grund(v.g) === 'phase', 'Phasen sind Daten: nur „kampf“ -> Vorwarnung wird verweigert'); VW.phasen.wert.length = 0; VW.phasen.wert.push(...alt); }
  const w = bereit({ kampf: true }); w.g.simSzene.phase = 'ende'; ok(grund(w.g) === 'keine_szene', 'Szene beendet: Weigerung');
  const x = bereit({ kampf: true }); x.g.ship.docked = true; ok(grund(x.g) === 'docked', 'angedockt: Weigerung'); x.g.ship.docked = false;
  x.g.ship.systems.transfer = 'broken'; ok(grund(x.g) === 'transfer' && startVerrat(x.g, x.g.players[0]) === TEXTE.weigerung.transfer, 'Transfer ausgefallen: Weigerung'); x.g.ship.systems.transfer = 'ok';
  Fracht.state(x.g).halt = { kind: 'an', id: 1, t: 0, dur: 5 }; ok(grund(x.g) === 'laeuft', 'ein Transfer läuft: Weigerung'); Fracht.state(x.g).halt = null;
  // während des Verrats nicht noch einmal
  const y = bereit({ kampf: true }); verrat(y.g);
  ok(y.g.simSzene.modus === 'verrat' && grund(y.g) === 'schon' && y.g.snapshot().space.po === undefined, 'läuft der Verrat schon: „schon“, kein Knopf mehr');
  // Kampagne, Limes: kein Modus
  for (const start of ['free', 'arena_space']) {
    const k = neu({ start }).g;
    ok(!k.weltsim && startVerrat(k, k.players[0]) === TEXTE.weigerung.modus && k.snapshot().space.po === undefined, `${start}: Befehl lehnt ab („nur Freie Fahrt Sund“), kein space.po`);
  }
});

section('Verbündete anderer Herkunft bleiben unverwundbar (Kampagne, Limes, Eisenwald, Kette)', () => {
  // Ein Verbündeter ohne es.sim (Eisenwald/Kette/Kampagne) in einer Sim-Szene des Modus: kein Verrat möglich, die Crew-Waffen treffen ihn nicht
  const t = bereit({ rom: 0, kampf: true }); const g = t.g;
  const es = Flotte.aufstellen(g, { tag: 'kamp_v', kind: 'korvette', name: 'Kampagnen-Verbündeter', ersatz: true });
  ok(es && es.ally && es.sim === undefined, 'Verbündeter der Kampagne trägt kein es.sim');
  ok(grund(g) === 'keine_verbuendeten' && Verrat.verbuendete(g, g.simSzene).length === 0, 'er zählt nicht: „keine_verbuendeten“');
  const hp0 = es.hp;
  for (const kind of ['laser', 'bolzen', 'batterie', 'kanone', 'ally']) g.space.projectiles.push({ id: 'p' + kind, kind, x: es.x, y: es.y, angle: 0, speed: 0, ttl: 5, dmg: 80 });
  run(g, 0.5);
  ok(es.hp === hp0 && es.state !== 'zerstoert', 'Crew-Geschosse treffen den Verbündeten nicht (Hülle ' + hp0 + ' -> ' + es.hp + ')');
  // auch ein Verbündeter der Sim vor dem Verrat ist unverwundbar
  const u = bereit({ kampf: true }); const q = allies(u.g)[0]; const h1 = q.hp;
  u.g.space.projectiles.push({ id: 'px', kind: 'laser', x: q.x, y: q.y, angle: 0, speed: 0, ttl: 5, dmg: 80 });
  run(u.g, 0.5); ok(q.hp === h1, 'Verbündeter der Sim vor dem Verrat: unverwundbar');
  // die Kampagne selbst: Befehl lehnt ab
  const k = neu({ start: 'free' }).g; const kes = Flotte.aufstellen(k, { tag: 'kamp_v', kind: 'korvette', name: 'V', ersatz: true });
  ok(startVerrat(k, k.players[0]) === TEXTE.weigerung.modus && kes && !k.simSzene, 'Kampagne: Verrat nicht möglich, keine Szene');
});

section('Anlauf: Warnung, kostenloser Abbruch', () => {
  const t = bereit({ kampf: true }); const g = t.g;
  const ruf0 = rom(g); const k0 = kernTicks; const S0 = g.simSzene; const al0 = allies(g).map((q) => q.id); const en0 = g.space.enemies.length;
  ok(startVerrat(g, g.players[0]) === null && halt(g) && halt(g).kind === 'posten' && halt(g).id === 'verrat' && halt(g).dur === VW.anlauf.wert.dauer, 'Halteprozess kind posten, id verrat, Dauer aus den Daten');
  ok(t.funk().some((x) => x === TEXTE.anlauf.replace('{sek}', String(Math.round(VW.anlauf.wert.dauer)))), 'Funk: Warnung mit Dauer („Hochverrat an Rom“)');
  run(g, 0.3);
  const sz = g.snapshot().flotte.sz; ok(sz && Array.isArray(sz.w) && sz.w[1] === Math.round(VW.anlauf.wert.dauer) && sz.w[0] >= 1, 'Szenenzeile aller Spieler trägt w = [Restsekunden, Dauer]');
  ok(g.snapshot().fracht.halt && g.snapshot().fracht.halt.id === 'verrat' && g.snapshot().space.po.k === 'v', 'Snapshot: fracht.halt id verrat, space.po k v');
  // Abbruch 1: Knopf (weapons.fracht off)
  g.handleMessage(t.cs[0], { t: 'cmd', c: 'weapons.fracht', off: true }); run(g, 0.2);
  ok(!halt(g) && g.simSzene === S0 && g.simSzene.modus === undefined && rom(g) === ruf0 && kernTicks === k0, 'Abbruch am Knopf: kein Halteprozess, Szene wie vorher, Ruf unverändert, kein Tick');
  ok(allies(g).map((q) => q.id).join() === al0.join() && g.space.enemies.length >= en0 && ex(g).length === 0, 'Verbündete unverändert, keine neuen Gegner');
  ok(t.oda().some((x) => x === TEXTE.abbruch.abgebrochen), 'Abbruch am Knopf: alle lesen „… abgebrochen. Nichts ist geschehen.“');
  ok(g.weltsim.verrat === undefined || g.weltsim.verrat === null, 'kein Gedächtnis');
  // Abbruch 2: Ops verlassen
  startVerrat(g, g.players[0]); run(g, 1); g.players[0].console = null; run(g, 0.3);
  ok(!halt(g) && rom(g) === ruf0 && g.simSzene.modus === undefined && t.oda().some((x) => x === TEXTE.abbruch.ops), 'Ops verlassen: Abbruch mit Text, kein Ruf');
  ops(g);
  // Abbruch 3: Transfer fällt aus
  startVerrat(g, g.players[0]); run(g, 1); g.ship.systems.transfer = 'broken'; run(g, 0.3); g.ship.systems.transfer = 'ok';
  ok(!halt(g) && rom(g) === ruf0 && g.simSzene.modus === undefined, 'Transfer ausgefallen: Abbruch ohne Folgen');
  // Abbruch 4: Szene endet während des Anlaufs (alle Gegner und Verbündete)
  startVerrat(g, g.players[0]); run(g, 1);
  for (const q of allies(g)) q.state = 'zerstoert';
  run(g, 0.3);
  ok(!halt(g) && rom(g) === ruf0 && t.oda().some((x) => x === TEXTE.abbruch.keine_verbuendeten), 'keine Verbündeten mehr: Abbruch mit Text');
  // Abbruch 4b: der Halteprozess gehört zu einem Hex (defensiv: eine andere Szene kann ihn nie weiterführen)
  { const h = { kind: 'posten', id: 'verrat', t: 0, dur: 3, hex: z(g).hexe[FREI] ? '0504' : '0000' }; const r = Verrat.haltWeiter(g, h); ok(r && r.code === 'szene' && r.text === TEXTE.abbruch.szene, 'Halteprozess eines anderen Hex wird abgebrochen (Text „Szene vorbei“)'); }
  // Abbruch 5: Sprung
  const u = bereit(); const g2 = u.g; const r2 = rom(g2);   // Vorwarnung: der Sprung ist keine Fahrerflucht (B-Fix 1), also ändert nur ein Verrat den Ruf
  startVerrat(g2, g2.players[0]); run(g2, 1);
  const e = springe(g2, '0504'); run(g2, 0.5);
  ok(!e && !halt(g2), 'Sprung während des Anlaufs: Halteprozess weg' + (e ? ' (' + e + ')' : ''));
  ok(rom(g2) === r2 && !g2.simSzene && !g2.weltsim.verrat, 'Sprung im Anlauf: kein Ruf-Abzug, kein Gedächtnis, Szene vorbei');
  ok(u.oda().some((x) => x === TEXTE.abbruch.sprung), 'Abbruchtext „Sprung“');
  // im Kampf gilt die gewöhnliche Fahrerflucht (Regel aus 02b B, unabhängig vom Verrat): der Anlauf selbst fügt nichts hinzu
  const u2 = bereit({ kampf: true }); const g2b = u2.g; const r2b = rom(g2b);
  startVerrat(g2b, g2b.players[0]); run(g2b, 1); springe(g2b, '0504'); run(g2b, 0.5);
  const flucht = RUF.quellen.wert.fahrerflucht_ger.delta;
  ok(!halt(g2b) && rom(g2b) === r2b + flucht && !g2b.weltsim.verrat, 'Sprung im Kampf während des Anlaufs: nur die gewöhnliche Fahrerflucht (' + flucht + '), kein Verrat-Abzug');
  // Schleife: auslösen, abbrechen, wieder auslösen: der Ruf sinkt nie im Halteprozess
  const l = bereit({ kampf: true }); const gl = l.g; const rl = rom(gl);
  for (let i = 0; i < 6; i++) { startVerrat(gl, gl.players[0]); run(gl, VW.anlauf.wert.dauer * 0.8); Fracht.beamStop(gl, 'abgebrochen'); }
  ok(rom(gl) === rl && gl.simSzene.modus === undefined, '6 × anlaufen und abbrechen: Ruf unverändert (' + rl + '), Szene unverändert');
});

section('Auslösung: Umschaltung der Szene', () => {
  const t = bereit({ kampf: true }); const g = t.g;
  // ein Verbündeter angeschlagen: die Quote muss bleiben
  const A = allies(g); A[0].hp = Math.round(A[0].hpMax * 0.5);
  const vor = A.map((q) => ({ kind: q.kind, name: q.name, quote: q.hp / q.hpMax, pts: q.simPts, x: q.x, y: q.y }));
  const gegnerAlt = g.space.enemies.filter((e) => e.tag === Szene.SZENEN_TAG).length;
  const ruf0 = rom(g); const k0 = kernTicks; const tk0 = g.weltsim.tickZahl; const marks0 = g.inventory.marks;
  ok(gegnerAlt > 0, 'Vorbedingung: Gegner der Szene fliegen schon (' + gegnerAlt + ')');
  ok(verrat(g) === null, 'Anlauf läuft durch');
  const S = g.simSzene;
  ok(S.modus === 'verrat' && S.vor === 'normal' && S.phase === 'kampf', 'Szene im Modus verrat (vorher normal), Phase Kampf');
  ok(allies(g).length === 0 && (g.space.escorts || []).every((q) => q.sim !== S.id), 'die Verbündeten der Szene sind aus der Liste');
  const neue = ex(g);
  ok(neue.length === vor.length, 'genauso viele neue Gegner wie Verbündete (' + neue.length + ')');
  for (const v of vor) {
    const e = neue.find((x) => x.name === v.name);
    ok(e && e.kind === v.kind, 'Klasse bleibt (' + v.name + ': ' + v.kind + ')');
    const sollQuote = Math.min(1, Math.max(VW.huelle_min.wert, v.quote));
    ok(e && Math.abs(e.hp / e.hpMax - sollQuote) < 0.02, 'Hüllen-Quote bleibt (' + v.name + ': ' + v.quote.toFixed(2) + ' -> ' + (e && (e.hp / e.hpMax).toFixed(2)) + ')');
    ok(e && e.volk === 'rom' && e.ohneBeute === true && e.simPts === v.pts && e.tag === Szene.SZENEN_TAG, 'Kennung rom, ohne Beute, Punktwert bleibt');
  }
  const w = g.flotte.welle;
  ok(w && w.liste.length === 1 && w.i === 0 && neue.every((e) => e.wv === w.id) && !w.fertig, 'eine Welle (1/1) trägt die neuen Gegner');
  const alt = g.space.enemies.filter((e) => e.tag === Szene.SZENEN_TAG && !e.verratS);
  ok(alt.length === gegnerAlt && alt.every((e) => e.leaving), 'die Gegner der Szene drehen ab (' + alt.length + ')');
  ok(g.space.retreatRule === undefined && g.flotte.nachschub.length === 0, 'Rückzugsregel gelöscht (gilt nicht für die neuen Gegner), kein Nachschub der alten Welle');
  // Ruf: sofort, einmal; kein Tick, keine Marken
  ok(rom(g) === Math.max(0, ruf0 + Q_B.delta), `Ruf sofort ${ruf0} -> ${rom(g)} (${Q_B.delta})`);
  ok(kernTicks === k0 && g.weltsim.tickZahl === tk0, 'kein Sim-Tick bei der Auslösung');
  ok(g.inventory.marks === marks0, 'keine Marken');
  ok(t.funk().some((x) => /eröffnet das Feuer auf die römischen Schiffe/.test(x) && /Ruf/.test(x)) && t.funk().some((x) => /ehemalige Verbündete/.test(x)), 'Funk: Auslösung, Folge, Gegner');
  ok(g.weltsim.verrat && g.weltsim.verrat.n === 1 && g.weltsim.verrat.hex === FREI && g.weltsim.verrat.tick === g.weltsim.tickZahl, 'Gedächtnis ws.verrat { n 1, tick, hex }');
  const sz = g.snapshot().flotte.sz; ok(sz && sz.p === 'k' && sz.vt === 1 && sz.w === undefined && sz.g === neue.length, 'Szenenzeile: p k, vt 1, g = Gegner (kein Finale, keine Warnung mehr)');
  ok(g.snapshot().space.po === undefined && !halt(g), 'Knopf weg, Halteprozess beendet');
  // Gegner greifen die Lerche an (Ziel: Lerche), kein Ziel auf Verbündete
  run(g, 2); ok(neue.every((e) => e.targetId == null), 'Gegner zielen auf die Lerche');
  // Crew-Waffen treffen die Neuen jetzt
  const e0 = neue[0]; const h0 = e0.hp; g.space.projectiles.push({ id: 'pz', kind: 'laser', x: e0.x, y: e0.y, angle: 0, speed: 0, ttl: 5, dmg: 30 });
  run(g, 0.3); ok(e0.hp < h0 || !g.space.enemies.includes(e0), 'Crew-Geschosse treffen die ehemaligen Verbündeten (Hülle ' + Math.round(h0) + ' -> ' + Math.round(e0.hp) + ')');
  ok(g.errors === 0, 'keine Fehler');
});

section('Umschaltung: Nachschub, doppelte Umschaltung, unbekannte Klasse', () => {
  // Nachschub der alten Welle (Gegner, die wegen der Höchstzahl warten) kommt nach der Umschaltung nie mehr
  const t = bereit({ kampf: true }); const g = t.g; const w0 = g.flotte.welle;
  g.flotte.nachschub.push({ kind: 'raider', opts: {}, meta: { wv: w0.id, wvN: 1 }, scene: g.ship.scene });
  const n0 = g.space.enemies.length;
  ok(Szene.verratStarten(g) !== null && g.flotte.nachschub.length === 0, 'wartender Nachschub der alten Welle ist weg (direkter Aufruf der Umschaltung)');
  run(g, 4); ok(!g.space.enemies.some((e) => e.wv === w0.id && !e.leaving) && n0 > 0, 'kein Gegner der alten Welle erscheint nach der Umschaltung');
  // eine zweite Umschaltung ändert nichts (der Prüfer vorher fängt es ab, die Szene selbst auch)
  const S = g.simSzene; const vor = JSON.stringify({ v: S.vert, vr: S.verrat, n: g.space.enemies.length, w: g.flotte.welle.id });
  ok(Szene.verratStarten(g) === null && JSON.stringify({ v: S.vert, vr: S.verrat, n: g.space.enemies.length, w: g.flotte.welle.id }) === vor, 'verratStarten ein zweites Mal: null, Szene und Welle unverändert');
  // unbekannte Klasse: sauber abgelehnt, kein Fehler, nichts verändert
  const u = bereit({ kampf: true }); const gu = u.g; const q = allies(gu)[0]; q.kind = 'gibtsnicht'; const e0 = gu.errors; const sp0 = gu.space.enemies.length; const w1 = gu.flotte.welle.id;
  ok(Szene.verratStarten(gu) === null && gu.errors === e0 && gu.space.enemies.length === sp0 && gu.flotte.welle.id === w1 && gu.simSzene.modus === undefined, 'unbekannte Klasse: null ohne Fehler (kein Wurf), Szene unverändert');
  const r0 = rom(gu); startVerrat(gu, gu.players[0]); run(gu, VW.anlauf.wert.dauer + 1.5);
  ok(rom(gu) === r0 && gu.simSzene.modus === undefined && !halt(gu), 'unbekannte Klasse beim Halteprozess: Abbruch, kein Ruf-Abzug');
});

section('Vorwarnung: Verrat vor der ersten Welle', () => {
  const t = bereit(); const g = t.g;
  ok(g.simSzene.phase === 'vorwarnung', 'Szene in der Vorwarnung');
  verrat(g);
  ok(g.simSzene.modus === 'verrat' && g.simSzene.phase === 'kampf' && ex(g).length > 0 && !g.space.enemies.some((e) => e.tag === Szene.SZENEN_TAG && !e.verratS), 'umgeschaltet, Kampf, keine Gegner der Szene (die erste Welle kam nie)');
  ok(g.flotte.welle.liste.length === 1 && g.snapshot().flotte.sz.p === 'k', 'eine Welle, Szenenzeile Kampf');
  run(g, CONFIG.simSzene.vorwarnung + 3);
  ok(!g.space.enemies.some((e) => e.tag === Szene.SZENEN_TAG && !e.verratS), 'auch nach der alten Vorwarnzeit kommen keine alten Wellen');
});

section('Sieg: Verluste, Ruf nur Abzug, genau ein Tick', () => {
  const t = bereit({ kampf: true }); const g = t.g; verrat(g);
  const ruf1 = rom(g); const marks0 = g.inventory.marks; const kills0 = g.stats.kills;
  const rf0 = z(g).flotten.find((f) => f.id === t.rfl.id).staerke;
  const k0 = kernTicks; const tk0 = g.weltsim.tickZahl;
  for (let i = 0; i < 600 * HZ && g.simSzene; i++) { for (const e of ex(g)) kill(g, e); g.step(); }   // nur die ehemaligen Verbündeten (die abziehenden Gegner der Szene geben Beute wie immer)
  ok(!g.simSzene && Szene.letzte(g).ausgang === 'sieg' && Szene.letzte(g).verrat === true, 'Sieg im Verrat');
  ok(kernTicks === k0 + 1 && g.weltsim.tickZahl === tk0 + 1, 'genau ein Tick');
  const wk = letzterTick.wirkungen;
  const fv = wk.filter((x) => x.typ === 'flotte_verlust' && x.flotte === t.rfl.id);
  ok(fv.length === 1 && Math.abs(fv[0].punkte - Math.min(rf0, rf0 * VW.verlust.wert.faktor)) < 0.02, `flotte_verlust auf die römische Flotte: Anteil verlust.faktor ${VW.verlust.wert.faktor} (${fv[0] && fv[0].punkte} von ${rf0})`);
  ok(!wk.some((x) => x.typ === 'ort_gehalten' || x.typ === 'flaggschiff_gefallen'), 'kein ort_gehalten, kein flaggschiff_gefallen');
  ok(wk.filter((x) => x.typ === 'flotte_verlust').every((x) => x.flotte === t.rfl.id), 'kein flotte_verlust auf Flotten der Germanen: die Abschüsse im Verrat zählen nie als Gegnerpunkte');
  const rw = wk.filter((x) => x.typ === 'ruf_aenderung');
  ok(rw.length === 1 && rw[0].grund === 'verrat_flotte_vernichtet' && rw[0].delta === Q_V.delta, 'Ruf-Wirkung: nur verrat_flotte_vernichtet');
  ok(!rw.some((x) => /^(sieg_feld|ort_gehalten)/.test(x.grund)) && rw.every((x) => x.delta < 0), 'kein sieg_feld_*, kein ort_gehalten_*, nie positiv');
  ok(rom(g) === Math.max(0, ruf1 + Q_V.delta), `Ruf ${ruf1} -> ${rom(g)}`);
  ok(g.inventory.marks === marks0, 'keine Marken aus dem Verrat-Kampf');
  ok(g.stats.kills > kills0, 'Abschüsse zählen (Statistik), Lohn nicht');
  const rf = z(g).flotten.find((f) => f.id === t.rfl.id); ok(rf && rf.staerke > 0 && rf.staerke < rf0, `die römische Flotte ist geschwächt, nicht vernichtet (${rf0} -> ${rf.staerke})`);
  ok(g.phase === 'play' && g.errors === 0, 'kein Game Over, keine Fehler');
  run(g, 0.1);
  const sz = g.snapshot().flotte.sz; ok(sz && sz.p === 's' && sz.vt === 1, 'Ergebniszeile: Sieg mit vt 1');
  ok(t.funk().some((x) => x === TEXTE.sieg), 'Funk: ' + TEXTE.sieg);
  run(g, CONFIG.simSzene.endeAnzeige + 1); ok(g.snapshot().flotte === undefined || !g.snapshot().flotte.sz, 'Ergebniszeile verschwindet');
  ok(!g.space.enemies.some((e) => e.verratS) || g.space.enemies.every((e) => e.leaving || !e.verratS), 'keine ehemaligen Verbündeten bleiben im Raum');
});

section('Kein Ruf-Ertrag aus dem Verrat-Kampf', () => {
  const t = bereit({ kampf: true, ruf: 100 }); const g = t.g; verrat(g);
  const r1 = rom(g); let hoch = r1;
  // jeder einzelne Abschuss
  const alle = ex(g).slice();
  for (const e of alle.slice(0, -1)) { kill(g, e); run(g, 0.2); hoch = Math.max(hoch, rom(g)); }
  ok(g.simSzene && rom(g) === r1 && hoch === r1, 'Ruf bleibt beim Zerstören der ehemaligen Verbündeten konstant (' + r1 + ')');
  kill(g, alle[alle.length - 1]); run(g, 1);
  ok(!g.simSzene && rom(g) === Math.max(0, r1 + Q_V.delta) && rom(g) < r1, 'nach dem Sieg nur der Abzug');
  // Szenen-Ruf-Regeln sind gar nicht erst im Weg: Ruf.szeneSieg wird im Verrat nie aufgerufen
  const orig = Ruf.szeneSieg; let aufrufe = 0; Ruf.szeneSieg = function () { aufrufe++; return orig.apply(this, arguments); };
  const u = bereit({ kampf: true }); verrat(u.g); durchspielen(u.g, 600); Ruf.szeneSieg = orig;
  ok(aufrufe === 0, 'Ruf.szeneSieg wird im Verrat nie aufgerufen');
  const pos = (grund0) => RUF.quellen.wert[grund0].delta > 0;
  ok(!pos('verrat_beginn') && !pos('verrat_flotte_vernichtet'), 'Grund-Schlüssel getrennt und negativ');
  // Sieg gegen die Germanen vorher zählt normal (Verrat ändert sie nicht): ein normaler Sieg gibt weiter Ruf
  const n2 = bereit({ kampf: true, rom: 0 }); const r2 = rom(n2.g); durchspielen(n2.g, 600);
  ok(rom(n2.g) > r2 || r2 >= RUF.fraktionen.wert.rom.max, 'normale Szene ohne Verrat: Sieg gibt weiter Ruf (' + r2 + ' -> ' + rom(n2.g) + ')');
});

section('Flucht per Sprung: anteilige Verluste, kein weiterer Ruf', () => {
  const t = bereit({ kampf: true, rom: 8 }); const g = t.g; verrat(g);
  const neue = ex(g); ok(neue.length >= 2, 'mindestens zwei ehemalige Verbündete (' + neue.length + ')');
  kill(g, neue[0]); run(g, 0.3);
  const ruf1 = rom(g); const rf0 = z(g).flotten.find((f) => f.id === t.rfl.id).staerke; const k0 = kernTicks; const tk0 = g.weltsim.tickZahl;
  const e = springe(g, '0504'); run(g, 0.5);
  ok(!e && !g.simSzene && Szene.letzte(g).ausgang === 'abbruch', 'Sprung beendet die Szene (Abbruch)' + (e ? ' ' + e : ''));
  ok(kernTicks === k0 + 1 && g.weltsim.tickZahl === tk0 + 1, 'genau ein Tick (der Sprung-Tick)');
  const fv = letzterTick.wirkungen.filter((x) => x.typ === 'flotte_verlust' && x.flotte === t.rfl.id);
  ok(fv.length === 1 && fv[0].punkte > 0 && fv[0].punkte < rf0, `anteilige Verluste (${fv[0] && fv[0].punkte} von ${rf0})`);
  ok(!letzterTick.wirkungen.some((x) => x.typ === 'ruf_aenderung') && rom(g) === ruf1, 'kein weiterer Ruf (keine Fahrerflucht-Strafe, kein Beginn doppelt)');
  const rf = z(g).flotten.find((f) => f.id === t.rfl.id); ok(rf && rf.staerke > 0, 'die Flotte lebt, geschwächt');
  ok(g.errors === 0 && g.phase === 'play', 'keine Fehler');
});

section('Niederlage: Notfallprotokoll, kein Game Over', () => {
  const t = bereit({ kampf: true, rom: 8 }); const g = t.g; verrat(g);
  const neue = ex(g); kill(g, neue[0]); run(g, 0.3);
  const ruf1 = rom(g); const rf0 = z(g).flotten.find((f) => f.id === t.rfl.id).staerke; const k0 = kernTicks; const tk0 = g.weltsim.tickZahl;
  g.stats.emergencies = (g.stats.emergencies || 0) + 1;   // Notfallprotokoll der Lerche (wie in 02a)
  run(g, 1);
  ok(!g.simSzene && Szene.letzte(g).ausgang === 'niederlage' && Szene.letzte(g).verrat === true, 'Niederlage');
  ok(kernTicks === k0 + 1 && g.weltsim.tickZahl === tk0 + 1, 'genau ein Tick');
  const fv = letzterTick.wirkungen.filter((x) => x.typ === 'flotte_verlust' && x.flotte === t.rfl.id);
  ok(fv.length === 1 && fv[0].punkte < rf0 && !letzterTick.wirkungen.some((x) => x.typ === 'ort_gefallen' || x.typ === 'ruf_aenderung'), 'anteilige Verluste, kein ort_gefallen, kein Ruf');
  ok(rom(g) === ruf1, 'Ruf unverändert');
  ok(g.phase === 'play' && g.errors === 0, 'kein Game Over');
  ok(t.funk().some((x) => x === TEXTE.niederlage), 'Funk: ' + TEXTE.niederlage);
  const sz = g.snapshot().flotte.sz; ok(sz && sz.p === 'n' && sz.vt === 1, 'Szenenzeile: Niederlage mit vt 1');
  run(g, 1); ok(g.space.enemies.filter((e) => e.verratS).every((e) => e.leaving), 'die übrigen ehemaligen Verbündeten ziehen ab');
});

section('Atomar: Rollback', () => {
  // Sieg: der Tick wirft: Sim, Ruf wie vorher (der Beginn-Abzug ist vorher gebucht und bleibt, er gehört nicht zum Tick)
  const t = bereit({ kampf: true }); const g = t.g; verrat(g);
  const simVor = kopie(Kriegslage.abbild(z(g))); const rufVor = kopie(g.weltsim.ruf); const tk = g.weltsim.tickZahl;
  kernWirft = true; console.warn = () => {};
  durchspielen(g, 600);
  console.warn = warnOrig; kernWirft = false;
  ok(!g.simSzene && Szene.letzte(g).ausgang === 'gestoert', 'Szene beendet, Ergebnis „gestoert“');
  ok(gleich(Kriegslage.abbild(z(g)), simVor) && gleich(g.weltsim.ruf, rufVor) && g.weltsim.tickZahl === tk, 'wirft der Tick: Sim, Ruf und Tickzähler wie vorher (kein Abzug „vernichtet“)');
  ok(!t.funk().some((x) => x === TEXTE.sieg), 'keine Siegesmeldung');
  g.errors = 0;
  // wirft der Ruf nach dem Kern: ein Atom
  const u = bereit({ kampf: true }); const g2 = u.g; verrat(g2);
  const sv = kopie(Kriegslage.abbild(z(g2))); const rv = kopie(g2.weltsim.ruf);
  const anw = Ruf.anwenden; Ruf.anwenden = function (gm, w) { anw.call(Ruf, gm, w); throw new Error('Test: Ruf wirft'); };
  console.warn = () => {}; durchspielen(g2, 600); console.warn = warnOrig; Ruf.anwenden = anw;
  ok(gleich(Kriegslage.abbild(z(g2)), sv) && gleich(g2.weltsim.ruf, rv), 'wirft erst der Ruf: Sim und Ruf wie vorher');
  g2.errors = 0;
  // Beginn: wirft die Umschaltung, steht die Szene wie vorher, kein Ruf, kein Gedächtnis, Abbruch mit Text
  const v = bereit({ kampf: true }); const g3 = v.g;
  const ruf0 = rom(g3); const escorts0 = (g3.space.escorts || []).slice(); const enemies0 = g3.space.enemies.slice(); const welle0 = g3.flotte.welle; const S0 = g3.simSzene; const vert0 = kopie(S0.vert);
  const sp = require('../server/sim/space.js'); const sorig = sp.spawnEnemy; let nn = 0;
  sp.spawnEnemy = function () { nn++; if (nn >= 2) throw new Error('Test: spawnEnemy wirft'); return sorig.apply(this, arguments); };
  console.warn = () => {};
  startVerrat(g3, g3.players[0]); run(g3, VW.anlauf.wert.dauer + 1.5);
  console.warn = warnOrig; sp.spawnEnemy = sorig;
  ok(g3.simSzene === S0 && S0.modus === undefined && !S0.verrat && S0.phase === 'kampf' && gleich(S0.vert, vert0), 'Umschaltung wirft: Szene wie vorher');
  ok((g3.space.escorts || []).length === escorts0.length && escorts0.every((q) => g3.space.escorts.includes(q)), 'Verbündete unverändert');
  ok(g3.space.enemies.every((e) => !e.verratS) && g3.flotte.welle === welle0 && enemies0.every((e) => g3.space.enemies.includes(e) && !e.leaving), 'Gegner der Szene unverändert (kein Rückzug), keine neuen Gegner');
  ok(rom(g3) === ruf0 && !g3.weltsim.verrat && !halt(g3), 'kein Ruf-Abzug, kein Gedächtnis, kein Halteprozess');
  ok(g3.errors >= 1 && g3.phase === 'play', 'Fehler gezählt, kein Game Over');
  g3.errors = 0;
  // danach geht ein neuer Versuch
  verrat(g3); ok(g3.simSzene.modus === 'verrat' && rom(g3) < ruf0, 'danach gelingt der Verrat');
  // Ruf-Prüfer lehnt ab: nichts geschieht
  const w = bereit({ kampf: true }); const g4 = w.g; const ruf4 = rom(g4);
  const po = Kern.pruefeWirkung; Kern.pruefeWirkung = function (zz, wk) { if (wk && wk.grund === 'verrat_beginn') return { ok: false, grund: 'Test' }; return po.apply(this, arguments); };
  verrat(g4); Kern.pruefeWirkung = po;
  ok(g4.simSzene.modus === undefined && rom(g4) === ruf4 && allies(g4).length > 0, 'lehnt die Ruf-Prüfung ab: keine Umschaltung, kein Ruf');
});

section('Ruf: nur bei Auslösung, Rang sinkt, nichts blockiert', () => {
  const t = bereit({ kampf: true, ruf: rangAb('tribun') + 2 }); const g = t.g;
  ok(Ruf.rang(g) === 'tribun', 'Start als Tribun');
  verrat(g);
  ok(rom(g) === rangAb('tribun') + 2 + Q_B.delta && Ruf.rang(g) === 'centurio', `Rang sinkt: Tribun -> Centurio (Ruf ${rom(g)})`);
  ok(t.funk().some((x) => /Centurio|Rang/i.test(x)), 'Rangwechsel-Funk');
  durchspielen(g, 600);
  const unten = bereit({ kampf: true, ruf: 0 }); const gu = unten.g; verrat(gu);
  ok(rom(gu) === 0 && Ruf.rang(gu) === 'miles', 'Rom 0: bleibt 0 (Untergrenze), Miles');
  durchspielen(gu, 600); ok(rom(gu) === 0 && gu.phase === 'play', 'nach dem Sieg weiter 0, kein Game Over');
  // bei Miles geht alles weiter: Gründen und Angreifen sind erlaubt, kein Soft-Lock
  ankunft(gu, FREI); ops(gu); run(gu, 0.2);
  const Pl = require('../server/sim/besitz.js').postenLage(require('../shared/locations.js').get(Sektoren.ortVonHex(FREI)).scene);
  Object.assign(gu.ship, { x: Pl.x, y: Pl.y, vx: 0, vy: 0, speed: 0 }); gu.inventory.ersatzteil = 3; ohneFlotten(gu, FREI);
  const eg = Posten.gruendenPruefen(gu, false); ok(eg === null, 'Miles nach dem Verrat: Posten gründen weiter erlaubt (' + (eg ? eg.code : 'frei') + ')');
  Posten.gruendenStart(gu, gu.players[0]); run(gu, require('../content/welt/posten-werte.json').werte.gruenden.wert.dauer + 1.5);
  ok(z(gu).hexe[FREI].crew === true && rom(gu) > 0, 'Posten gegründet, Ruf steigt wieder (' + rom(gu) + '): der Weg nach oben bleibt offen');
  // Gekauftes bleibt: eine am Rang freigeschaltete Ausbaustufe bleibt frei, auch wenn der Rang sinkt
  const w = bereit({ kampf: true, ruf: rangAb('centurio') + 2 }); const gw = w.g;
  ok(Ruf.rufErreicht(gw, 'centurio'), 'Vorbedingung: Centurio erreicht');
  gw.ship.stufe = 3; Werft.restore(gw, { stufe: 3 }); ok(Werft.istFrei(gw, 'stufe', 3), 'Vorbedingung: Ausbaustufe 3 gekauft und freigeschaltet');
  const spar = JSON.stringify(Werft.toSave(gw));
  verrat(gw); durchspielen(gw, 600);
  ok(!Ruf.rufErreicht(gw, 'centurio') && Ruf.rang(gw) === 'optio', 'Rang gesunken (Centurio -> ' + Ruf.rang(gw) + ', Ruf ' + rom(gw) + ')');
  ok(gw.ship.stufe === 3 && Werft.istFrei(gw, 'stufe', 3) && Werft.istFrei(gw, 'stufe', 2) && JSON.stringify(Werft.toSave(gw)) === spar && Werft.liste(gw).stufe === 3, 'Gekauftes bleibt: Stufe 3 getragen und frei, Werft-Stand unverändert');
  // Mehrfach hintereinander: Untergrenze hält
  const m = bereit({ kampf: true, ruf: 5 }); verrat(m.g); durchspielen(m.g, 600); ok(rom(m.g) === 0, 'Ruf geklemmt auf 0 (nie negativ)');
});

section('Wissensmodell Roms nach dem Verlust: kein Sonderweg', () => {
  const t = bereit({ kampf: true }); const g = t.g; verrat(g); durchspielen(g, 600);
  const sz = JSON.stringify(Kriegslage.lage(g));
  ok(g.errors === 0 && sz && sz.length > 10, 'Anzeigeblock world.lage entsteht nach dem Verlust ohne Fehler (die Flottenstärke Roms kommt aus dem Zustand, kein eigener Weg für den Verrat)');
  ok(!/verrat/i.test(sz), 'das Wissensmodell kennt „Verrat“ nicht: Rom sieht nur den Flottenverlust, nicht dessen Ursache');
});

section('Gedächtnis, Speichern, Laden, Altstand', () => {
  const t = bereit({ kampf: true }); const g = t.g; verrat(g); durchspielen(g, 600);
  ok(g.weltsim.verrat && g.weltsim.verrat.n === 1, 'Gedächtnis gesetzt');
  ab(g); g.ship.docked = false;
  const d1 = kopie(Weltstand.capture(g));
  ok(d1.version === 3 && Weltstand.validate(d1).length === 0, 'Weltstand: Version 3, schemagültig' + (Weltstand.validate(d1).join('; ') ? ' ' + Weltstand.validate(d1).join('; ') : ''));
  ok(d1.welt.sim.verrat && d1.welt.sim.verrat.n === 1 && d1.welt.sim.verrat.hex === FREI, 'welt.sim.verrat: additives optionales Feld { n, tick, hex }');
  ok(!JSON.stringify(d1).includes('simSzene') && !JSON.stringify(d1).includes('"modus":"verrat"') && !JSON.stringify(d1).includes('verratS'), 'die Szene steht nicht im Weltstand');
  const dir = freshDir(); d1.id = 'w-verrat'; fs.writeFileSync(path.join(dir, 'w-verrat.json'), JSON.stringify(d1));
  const t2 = neu({ dir, world: 'w-verrat' }); const g2 = t2.g;
  ok(g2.phase === 'play' && g2.weltsim && g2.errors === 0 && gleich(g2.weltsim.verrat, g.weltsim.verrat) && rom(g2) === rom(g), 'Laden ohne Fehler: Gedächtnis und Ruf gelesen');
  const d2 = kopie(Weltstand.capture(g2)); ok(gleich(d2.welt.sim.verrat, d1.welt.sim.verrat) && gleich(d2.welt.sim.zustand.hexe, d1.welt.sim.zustand.hexe), 'Runde Speichern, Laden, Speichern: gleich');
  const alt = kopie(d1); delete alt.welt.sim.verrat; alt.id = 'w-alt'; fs.writeFileSync(path.join(dir, 'w-alt.json'), JSON.stringify(alt));
  const t3 = neu({ dir, world: 'w-alt' }); const g3 = t3.g;
  ok(g3.phase === 'play' && g3.errors === 0 && !g3.weltsim.verrat, 'Altstand ohne verrat lädt (kein Gedächtnis)');
  const d3 = kopie(Weltstand.capture(g3)); ok(!('verrat' in d3.welt.sim), 'ohne Verrat kein Block (Altstand-gleich)');
  for (const bl of ['x', [1], { n: 0 }, { n: 'a' }, { n: -2 }, null, 5]) ok(Verrat.lesen(bl) === null, 'Müll-fester Leser: ' + JSON.stringify(bl));
  ok(gleich(Verrat.lesen({ n: 2.9, tick: 7.2, hex: '0505' }), { n: 2, tick: 7, hex: '0505' }) && gleich(Verrat.lesen({ n: 1, hex: 'zz' }), { n: 1, tick: 0, hex: '' }), 'Leser: gültige Einträge bleiben, Rest wird abgefangen');
  // zweiter Verrat zählt hoch
  const u = bereit({ kampf: true }); verrat(u.g); durchspielen(u.g, 600); ohneFlotten(u.g, FREI); ankunft(u.g, FREI); ops(u.g); run(u.g, 0.2);
  flotte(u.g, FREI, 'rom', 6); Szene.debug(u.g, ['6', 'ger']); run(u.g, CONFIG.simSzene.vorwarnung + 2); verrat(u.g);
  ok(u.g.weltsim.verrat.n === 2, 'zweiter Verrat: n 2');
  // Wissen/Chronik
  const chron = [];
  const v = bereit({ kampf: true }); v.g.weltstand = Object.assign({}, v.g.weltstand, { chronicle: (tx) => chron.push(tx) }); verrat(v.g);
  ok(chron.length === 1 && /Ort|Sektor|Lerche/.test(chron[0]) && /römische Schiffe/.test(chron[0]), 'Chronik: ein Eintrag zur Auslösung (' + chron[0] + ')');
});

section('Verrat an einem römischen Hafen: die Verteidiger-Regel gilt nicht mehr', () => {
  const t = bereit({ hex: OSTIA, kampf: true, rom: 6 }); const g = t.g;
  ok(g.simSzene && g.simSzene.ort === 'hafen' && allies(g).length > 0, 'Szene am römischen Hafen mit Verbündeten (Abwehr und Flotte)');
  const abw0 = z(g).hexe[OSTIA].abwehr;
  verrat(g);
  ok(g.simSzene.modus === 'verrat' && ex(g).length > 0, 'Verrat am Hafen');
  run(g, CONFIG.simSzene.erschoepfungGnade + 8, () => {  g.ship.shields && g.ship.shields.fill && g.ship.shields.fill(1e4); });   // die Lerche schießt nicht und fliegt nicht: Hülle halten, sonst endet es mit dem Notfallprotokoll
  ok(g.simSzene && g.simSzene.modus === 'verrat' && g.simSzene.vert.erschT == null, 'die Verteidigung „bricht“ nicht zusammen (ehemalige Verbündete sind keine Verteidiger mehr, keine Gnadenfrist, kein Niederlage-Zähler)');
  durchspielen(g, 600);
  ok(Szene.letzte(g).ausgang === 'sieg' && Szene.letzte(g).verrat === true, 'Sieg im Verrat am Hafen');
  const wk = letzterTick.wirkungen;
  ok(!wk.some((x) => x.typ === 'ort_gehalten' || x.typ === 'ort_gefallen') && wk.some((x) => x.typ === 'abwehr_verlust' && x.ort === OSTIA), 'kein ort_gehalten/ort_gefallen, aber die Abwehr des Hafens verliert (abwehr_verlust)');
  const av = wk.find((x) => x.typ === 'abwehr_verlust' && x.ort === OSTIA);
  ok(av && Math.abs(av.punkte - abw0 * VW.verlust.wert.faktor) < 0.02, 'die Abwehr des Hafens verliert den Anteil verlust.faktor (' + (av && av.punkte) + ' von ' + abw0 + ')');
  // Folge, die die Sim selbst zieht (nicht die Szene): bei verlust.faktor 0,5 hält der belagerte Hafen (Abwehr bleibt > 0), bei Faktor 1 verliert er die ganze Abwehr und fällt im selben Tick (hafen_gefallen aus dem Kern, kein ort_gefallen aus der Szene)
  ok(z(g).hexe[OSTIA].besitzer === 'rom' && z(g).hexe[OSTIA].abwehr > 0 && !g.weltsim.ereignisse.some((e) => e.typ === 'hafen_gefallen'), 'Faktor 0,5: der belagerte Hafen hält (Abwehr ' + z(g).hexe[OSTIA].abwehr.toFixed(2) + ')');
  { const f0 = VW.verlust.wert.faktor; VW.verlust.wert.faktor = 1; const u = bereit({ hex: OSTIA, kampf: true, rom: 6 }); verrat(u.g); durchspielen(u.g, 600); VW.verlust.wert.faktor = f0;
    ok(z(u.g).hexe[OSTIA].besitzer === 'ger' && u.g.weltsim.ereignisse.some((e) => e.typ === 'hafen_gefallen' && e.ort === OSTIA), 'Faktor 1: der Hafen verliert die ganze Abwehr und fällt im selben Tick (Kern, nicht die Szene)'); }
});

section('Fehler im Ruf beim Beginn: kein Abzug, kein Absturz', () => {
  const t = bereit({ kampf: true }); const g = t.g; const ruf0 = rom(g);
  const anw = Ruf.anwenden; Ruf.anwenden = function (gm, w) { anw.call(Ruf, gm, w); throw new Error('Test: Ruf wirft'); };
  console.warn = () => {}; verrat(g); console.warn = warnOrig; Ruf.anwenden = anw;
  ok(rom(g) === ruf0 && g.errors >= 1 && g.phase === 'play', 'wirft die Ruf-Buchung: Ruf unverändert (zurückgerollt), Fehler gezählt, kein Game Over');
  ok(t.funk().some((x) => x === TEXTE.beginnLeise.replace('{ort}', 'Brachland')), 'Funk ohne Ruf-Satz (der Abzug gilt nicht)');
  g.errors = 0;
});

section('Mehrere Klassen, Punktwerte, Abwehr', () => {
  const t = bereit({ kampf: true, rom: 16 }); const g = t.g; const A = allies(g);
  const pts = A.reduce((s, q) => s + q.simPts, 0);
  ok(A.length >= 2 && new Set(A.map((q) => q.kind)).size >= 1, 'mehrere Verbündete (' + A.map((q) => q.kind).join(',') + ')');
  verrat(g);
  const w = g.flotte.welle; const sum = w.liste[0].reduce((s, it) => s + it.n, 0);
  ok(sum === A.length && ex(g).reduce((s, e) => s + e.simPts, 0) === pts, 'Welle und Punktwerte entsprechen den Verbündeten (' + pts + ' Punkte)');
  // Verluste: nach dem Tod aller Neuen ist verloren = ges
  const S = g.simSzene; const st0 = t.rfl.staerke; for (const e of ex(g).slice()) kill(g, e); run(g, 0.5);
  const fvp = Szene.letzte(g).wirkungen.filter((x) => x.typ === 'flotte_verlust' && x.flotte === t.rfl.id).reduce((s, x) => s + x.punkte, 0);
  ok(!g.simSzene && Math.abs(fvp - Math.min(st0, S.vert.gruppen.find((q) => q.id === t.rfl.id).staerke * VW.verlust.wert.faktor)) < 0.02, 'Sieg bucht den Anteil verlust.faktor der Flotte (begrenzt durch ihre Stärke: ' + fvp + ' von ' + st0 + ')');
  // Verbündeter bereits vor dem Verrat gefallen: zählt als Verlust, wird nicht neu geboren
  const u = bereit({ kampf: true, rom: 8 }); const gu = u.g; const Au = allies(gu); const erster = Au[0];
  erster.hp = 0; require('../server/sim/escort.js').hit && Flotte.allyLost(gu, erster); run(gu, 0.3);
  const lebend = allies(gu).length; verrat(gu);
  ok(ex(gu).length === lebend && !ex(gu).some((e) => e.name === erster.name), 'bereits gefallener Verbündeter kommt nicht zurück (' + lebend + ' Gegner)');
  durchspielen(gu, 600); ok(Szene.letzte(gu).ausgang === 'sieg' && gu.errors === 0, 'Sieg trotzdem sauber');
});

section('Szene als Angriff auf einen Posten: Verrat möglich, Garnison unverändert', () => {
  const t = neu(); const g = t.g; g.weltsim.ruf.rom = 50; const GER1 = '0703';
  Object.assign(z(g).hexe[GER1], { besitzer: 'ger', posten: true, garnison: 4, anspruch: {} });
  if (g.weltBesitz && g.weltBesitz.hexe[GER1]) g.weltBesitz.hexe[GER1] = { besitzer: 'ger', posten: true };
  ohneFlotten(g, GER1); ankunft(g, GER1); ops(g); run(g, 0.2);
  const rfl = flotte(g, GER1, 'rom', 6);
  const Pl = require('../server/sim/besitz.js').postenLage(require('../shared/locations.js').get(Sektoren.ortVonHex(GER1)).scene);
  Object.assign(g.ship, { x: Pl.x, y: Pl.y, vx: 0, vy: 0, speed: 0 });
  Posten.angreifenStart(g, g.players[0]); run(g, require('../content/welt/posten-werte.json').werte.angreifen.wert.dauer + 1.5);
  ok(g.simSzene && g.simSzene.modus === 'angriff' && allies(g).length > 0, 'Angriffsszene mit römischen Verbündeten');
  run(g, 14);
  const gar0 = z(g).hexe[GER1].garnison;
  verrat(g);
  ok(g.simSzene.modus === 'verrat' && g.simSzene.vor === 'angriff' && ex(g).length > 0, 'Verrat im Angriff: Modus verrat (vorher angriff)');
  durchspielen(g, 600);
  const nd = z(g).hexe[GER1];
  ok(Szene.letzte(g).ausgang === 'sieg' && nd.posten === true && nd.besitzer === 'ger', 'Sieg im Verrat sprengt den Posten nicht');
  ok(!letzterTick.wirkungen.some((x) => x.typ === 'posten_gesprengt') && !letzterTick.wirkungen.some((x) => x.typ === 'ruf_aenderung' && x.delta > 0), 'keine Sprengung, kein positiver Ruf');
  ok(gar0 > 0 && g.errors === 0, 'keine Fehler');
});

section('Anzeige space.po und Szenenzeile', () => {
  const t = bereit({ kampf: true }); const g = t.g;
  const po = g.snapshot().space.po;
  ok(po && po.k === 'v' && po.ok === 1 && po.t === undefined && Object.keys(po).length === 2, 'space.po { k v, ok 1 } (klein, ohne Text)');
  g.ship.docked = true; const p2 = g.snapshot().space.po; g.ship.docked = false;
  ok(p2 && p2.k === 'v' && p2.ok === 0 && p2.t === TEXTE.weigerung.docked, 'angedockt: ok 0 mit Weigerungstext');
  ok(Buffer.byteLength(JSON.stringify(po)) < 30, 'klein');
  // Szene schlicht ohne Verrat: Szenenzeile ohne vt und ohne w
  const sz = g.snapshot().flotte.sz; ok(sz && sz.vt === undefined && sz.w === undefined, 'normale Szene: kein vt, kein w');
  // Snapshot-Größe im Anlauf
  startVerrat(g, g.players[0]); run(g, 0.3);
  const b = Buffer.byteLength(JSON.stringify(g.snapshot())); ok(b < 18944, 'Snapshot im Anlauf im Budget (' + b + ' B)');
});

section('Eigene Regeln gelten für Spieler und Gegner gleich, keine Zahlen im Code', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'verrat.js'), 'utf8');
  ok(!/\b(delta|dauer)\s*[:=]\s*-?\d/.test(src), 'verrat.js enthält keine Ruf- oder Zeitzahlen');
  const sz = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'kriegslage-szene.js'), 'utf8');
  ok(!/verrat[^\n]*delta\s*[:=]\s*-?\d/.test(sz), 'kriegslage-szene.js: keine Ruf-Zahl im Verrat');
  // Datenänderung wirkt ohne Code
  const alt = Q_B.delta; Q_B.delta = -3; const t = bereit({ kampf: true, ruf: 40 }); verrat(t.g); const r = rom(t.g); Q_B.delta = alt;
  ok(r === 37, 'Ruf-Wert ist Datenwert: -3 aus den Daten wirkt ohne Code (40 -> ' + r + ')');
  { // Stellschraube verlust.faktor (Daten): 1 = alles, 0 = nichts; ungültige Werte gelten als 1
    const alt = VW.verlust.wert.faktor; const lauf = (f) => { VW.verlust.wert.faktor = f; const v = bereit({ kampf: true }); verrat(v.g); const s0 = v.rfl.staerke; durchspielen(v.g, 600); const x = letzterTick.wirkungen.filter((y) => y.typ === 'flotte_verlust' && y.flotte === v.rfl.id); return { s0, p: x.length ? x[0].punkte : 0 }; };
    const a1 = lauf(1), a0 = lauf(0), a5 = lauf(0.5), ax = lauf('x');
    VW.verlust.wert.faktor = alt;
    ok(Math.abs(a1.p - a1.s0) < 0.02 && a0.p === 0 && Math.abs(a5.p - a5.s0 / 2) < 0.02 && Math.abs(ax.p - ax.s0) < 0.02, 'verlust.faktor ist Datenwert: 1 = ganze Flotte (' + a1.p + '), 0 = nichts (' + a0.p + '), 0,5 = Hälfte (' + a5.p + '), Müll = 1 (' + ax.p + ')');
  }
  const alt2 = VW.anlauf.wert.dauer; VW.anlauf.wert.dauer = 2; const u = bereit({ kampf: true }); startVerrat(u.g, u.g.players[0]); ok(halt(u.g).dur === 2, 'Anlaufdauer ist Datenwert'); VW.anlauf.wert.dauer = alt2;
});

const SZT = require('../content/flotte/sim-szene.json');

section('Bestätigung: zweistufig, nie versehentlich', () => {
  const t = bereit({ kampf: true }); const g = t.g; const F = VW.bestaetigung.wert.fenster;
  ok(F > 0, 'Fenster ist ein Datenwert (' + F + ' s)');
  ok(Verrat.verratStart(g, g.players[0]) === null && !halt(g), 'erster Druck: nur eine Anfrage, kein Halteprozess');
  ok(t.funk().some((x) => x === TEXTE.anfrage.replace('{sek}', String(Math.round(F)))), 'Funk: Warnung mit dem Fenster');
  const po = g.snapshot().space.po; ok(po && po.k === 'v' && po.b > 0 && po.b <= F, 'space.po.b = Restsekunden der Bestätigung (' + (po && po.b) + ')');
  run(g, F + 1);
  ok(g.snapshot().space.po.b === undefined && Verrat.verratStart(g, g.players[0]) === null && !halt(g), 'nach dem Fenster verfallen: der nächste Druck ist wieder nur eine Anfrage');
  run(g, 1);
  ok(Verrat.verratStart(g, g.players[0]) === null && halt(g) && halt(g).id === 'verrat' && g.verratAnfrage === null, 'zweiter Druck im Fenster: Anlauf beginnt, Anfrage verbraucht');
  Fracht.beamStop(g, 'abgebrochen'); run(g, 0.2);
  ok(Verrat.verratStart(g, g.players[0]) === null && !halt(g), 'nach einem Abbruch beginnt es wieder mit einer Anfrage');
  // eine Anfrage in einer anderen Szene gilt nicht
  const u = bereit({ kampf: true }); Verrat.verratStart(u.g, u.g.players[0]); u.g.verratAnfrage.szene = -1;
  ok(Verrat.verratStart(u.g, u.g.players[0]) === null && !halt(u.g), 'Anfrage einer anderen Szene gilt nicht');
  // Weigerungen schon beim ersten Druck
  const w = bereit({ rom: 0, kampf: true }); ok(Verrat.verratStart(w.g, w.g.players[0]) === TEXTE.weigerung.keine_verbuendeten && !w.g.verratAnfrage, 'Weigerung beim ersten Druck, keine Anfrage');
});

section('Review E: Verluste vor der Umschaltung gelten voll (kein Gratis-Schutz für Rom)', () => {
  const lauf = (mitVerrat) => {
    const t = bereit({ kampf: true, rom: 6 }); const g = t.g; const S = g.simSzene; const A = allies(g);
    for (const q of A.slice(0, A.length - 1)) { q.hp = 0; Flotte.allyLost(g, q); }
    run(g, 0.3);
    const st0 = z(g).flotten.find((f) => f.id === t.rfl.id).staerke; const v0 = S.vert.verloren / S.vert.ges;
    if (mitVerrat) verrat(g);
    springe(g, '0504'); run(g, 0.5);
    const fv = letzterTick.wirkungen.filter((x) => x.typ === 'flotte_verlust' && x.flotte === t.rfl.id);
    return { p: fv.length ? fv[0].punkte : 0, st0, v0 };
  };
  const a = lauf(false), b = lauf(true);
  ok(a.p > 0 && Math.abs(b.p - a.p) < 0.02 && Math.abs(b.p - a.st0 * b.v0) < 0.05, `Flucht nach Verrat bucht die Verluste vor der Umschaltung voll wie ohne Verrat (${a.p} ohne, ${b.p} mit, Anteil ${b.v0.toFixed(2)} von ${a.st0})`);
  // belagerter Hafen: die Lerche unterliegt: der Hafen fällt mit und ohne Verrat gleich
  const hafen = (mitVerrat) => {
    const t = bereit({ hex: OSTIA, kampf: true, rom: 6 }); const g = t.g; const A = allies(g);
    for (const q of A.slice(0, mitVerrat ? A.length - 1 : A.length)) { q.hp = 0; Flotte.allyLost(g, q); }
    run(g, 0.3);
    if (mitVerrat) verrat(g);
    for (let i = 0; i < 200 * HZ && g.simSzene; i++) { if (i % HZ === 0) g.stats.emergencies = (g.stats.emergencies || 0) + 1; g.step(); }
    const L = Szene.letzte(g);
    return { besitzer: z(g).hexe[OSTIA].besitzer, ausgang: L.ausgang, gefallen: L.wirkungen.some((x) => x.typ === 'ort_gefallen') };
  };
  const h0 = hafen(false), h1 = hafen(true);
  ok(h0.ausgang === 'niederlage' && h1.ausgang === 'niederlage' && h0.besitzer === h1.besitzer && h0.gefallen === h1.gefallen, `Niederlage am belagerten Hafen: Besitz und ort_gefallen wie ohne Verrat (${h0.besitzer}/${h0.gefallen} ohne, ${h1.besitzer}/${h1.gefallen} mit)`);
});

section('Review E: Sperre (Hauptwelt, letzte Kraft)', () => {
  const HW = '0204';
  const palatina = (abwehr, ger) => {
    const t = neu({ seed: 11 }); const g = t.g; g.weltsim.ruf.rom = 50; ohneFlotten(g, HW);
    z(g).hexe[HW].abwehr = abwehr; ankunft(g, HW); ops(g); run(g, 0.2); flotte(g, HW, 'rom', 1);
    const e = Szene.debug(g, [String(ger), 'ger', 'belagerung']); if (e) throw new Error(e);
    run(g, CONFIG.simSzene.vorwarnung + 2);
    return g;
  };
  ok(VW.sperre.wert.hexe.includes(HW) && VW.sperre.wert.abwehr_min > 0, 'Daten: Sperre nennt die Hauptwelt Palatina (0204) und eine Abwehr-Schwelle');
  for (const abw of [1.0, 1.5, 2.0, 6]) for (const ger of [3, 6]) {
    const g = palatina(abw, ger);
    ok(g.simSzene && allies(g).length > 0 && grund(g) === 'hauptwelt' && Verrat.verratStart(g, g.players[0]) === TEXTE.weigerung.hauptwelt && !g.verratAnfrage && g.snapshot().space.po.ok === 0, `Palatina belagert (Abwehr ${abw}, Germanen ${ger}): Weigerung „hauptwelt“, keine Anfrage, space.po ok 0`);
  }
  const t = bereit({ hex: OSTIA, kampf: true, rom: 6 }); const g = t.g;
  ok(grund(g) === null, 'normaler Hafen mit Abwehr 6: erlaubt');
  z(g).hexe[OSTIA].abwehr = VW.sperre.wert.abwehr_min - 0.01; ok(grund(g) === 'abwehr', 'Abwehr knapp unter der Schwelle: „abwehr“');
  z(g).hexe[OSTIA].abwehr = VW.sperre.wert.abwehr_min; ok(grund(g) === null, 'Abwehr genau an der Schwelle: erlaubt');
  { const alt = VW.sperre.wert.hexe.slice(); VW.sperre.wert.hexe.length = 0; ok(grund(palatina(2, 3)) === null, 'Hexe sind Daten: ohne Eintrag kein Sperre'); VW.sperre.wert.hexe.push(...alt); }
  // laufender Halteprozess: Sperre greift auch dann (z. B. Ort wird dünn)
  const u = bereit({ hex: OSTIA, kampf: true, rom: 6 }); startVerrat(u.g, u.g.players[0]); run(u.g, 1); z(u.g).hexe[OSTIA].abwehr = 0.2; run(u.g, 0.3);
  ok(!halt(u.g) && u.g.simSzene.modus === undefined, 'wird der Ort während des Anlaufs dünn: Abbruch');
});

section('Review E: Faktor ehrlich, Ruf-Text, Abbruch im Lagefunk', () => {
  const alt = VW.verlust.wert.faktor;
  VW.verlust.wert.faktor = 0.5; const a = bereit({ kampf: true }); verrat(a.g); durchspielen(a.g, 600);
  ok(a.funk().some((x) => x === TEXTE.faktor.replace('{pct}', '50')), 'Faktor 0,5: der Siegtext sagt „nur 50 % der Verluste gelten“');
  const a2 = bereit({ kampf: true }); verrat(a2.g); a2.g.stats.emergencies = (a2.g.stats.emergencies || 0) + 1; run(a2.g, 1);
  ok(a2.funk().some((x) => x === TEXTE.faktor.replace('{pct}', '50')) && a2.funk().some((x) => x === SZT.niederlage.lerche), 'auch die Niederlage sagt es, und nennt den Grund der Niederlage (Funk)');
  VW.verlust.wert.faktor = 1; const b = bereit({ kampf: true }); verrat(b.g); durchspielen(b.g, 600);
  ok(!b.funk().some((x) => /Besatzungen/.test(x)), 'Faktor 1: kein Hinweis');
  VW.verlust.wert.faktor = alt;
  ok(Verrat.faktorText() === TEXTE.faktor.replace('{pct}', String(Math.round(alt * 100))) || alt >= 1, 'faktorText aus den Daten');
  // Ruf-Text: der tatsächliche Abzug
  for (const [r0, soll] of [[0, 'leise'], [5, 5], [50, 12]]) {
    const t = bereit({ kampf: true, ruf: r0 }); const g = t.g; verrat(g);
    const f = t.funk().find((x) => /eröffnet das Feuer auf die römischen Schiffe/.test(x));
    ok(soll === 'leise' ? f === TEXTE.beginnLeise.replace('{ort}', 'Brachland') : f === TEXTE.beginn.replace('{ort}', 'Brachland').replace('{ruf}', String(soll)), `Ruf ${r0}: Funk nennt den tatsächlichen Abzug (${soll}): „${f}“`);
  }
  // Abbruch auch im Lagefunk (nicht nur als Hinweis)
  const t = bereit({ kampf: true }); const g = t.g; startVerrat(g, g.players[0]); run(g, 1); const n0 = t.funk().length;
  g.handleMessage(t.cs[0], { t: 'cmd', c: 'weapons.fracht', off: true }); run(g, 0.2);
  ok(t.funk().slice(n0).some((x) => x === TEXTE.abbruch.abgebrochen), 'Abbruch am Knopf steht im Lagefunk');
  const u = bereit({ kampf: true }); startVerrat(u.g, u.g.players[0]); run(u.g, 1); const m0 = u.funk().length; u.g.ship.systems.transfer = 'broken'; run(u.g, 0.3);
  ok(u.funk().slice(m0).some((x) => x === TEXTE.abbruch.transfer), 'Abbruch durch Transfer-Ausfall steht im Lagefunk');
});

section('Review E: Lücken (Finale, Leser, Zähler, Namen, Beute, Hülle, Zählung)', () => {
  const t = bereit({ kampf: true }); const g = t.g; const S = g.simSzene; const m0 = g.inventory.marks;
  S.escortsGoneProbe = true; (g.space.escortsGone || (g.space.escortsGone = [])).push({ tag: 'sz' + S.id + '_0' }, { tag: 'anderer' });
  const aw0 = g.weltsim.wirkungenAngewandt; const alt = g.space.enemies.filter((e) => e.tag === Szene.SZENEN_TAG).slice();
  startVerrat(g, g.players[0]); run(g, 1); const n1 = g.snapshot().flotte.sz.w[0]; run(g, 3); const n2 = g.snapshot().flotte.sz.w[0];
  ok(n2 < n1 && n1 <= VW.anlauf.wert.dauer, `Warnzähler läuft herunter (${n1} -> ${n2} s)`);
  run(g, VW.anlauf.wert.dauer);
  ok(S.modus === 'verrat' && S.finale === true && g.weltsim.wirkungenAngewandt === aw0 + 1, 'Umschaltung setzt finale (keine Finale-Meldung des alten Kommandanten) und zählt die Ruf-Wirkung (wirkungenAngewandt +1)');
  run(g, 3);
  ok(!t.funk().some((x) => /greift mit dem Flaggschiff ein/.test(x)) && g.snapshot().flotte.sz.p === 'k', 'keine Finale-Meldung mitten im Verrat, Szenenzeile bleibt Kampf');
  ok(g.space.escortsGone.length === 1 && g.space.escortsGone[0].tag === 'anderer', 'escortsGone der Szene bereinigt, fremde Einträge bleiben');
  ok(g.snapshot().space.enemies.filter((e) => e.nm).length === ex(g).length && ex(g).every((e) => !!e.name) && g.snapshot().space.enemies.every((e) => !e.nm || e.nm.length <= 20), 'ehemalige Verbündete tragen ihren Namen im Snapshot (nm)');
  const fl = alt.filter((e) => g.space.enemies.includes(e)); for (const e of fl) kill(g, e);
  ok(g.inventory.marks === m0, 'auch die abziehenden Gegner der Szene geben im Verrat keine Marken (' + fl.length + ' abgeschossen)');
  // Sieg räumt die Szenen-ODA weg
  const n0 = t.cs[0].inbox.filter((m) => m.kind === 'odaWeg').length;
  for (let i = 0; i < 600 * HZ && g.simSzene; i++) { for (const e of ex(g)) kill(g, e); g.step(); }
  ok(t.cs[0].inbox.filter((m) => m.kind === 'odaWeg').length > n0, 'Sieg im Verrat räumt die Szenen-ODA weg (odaWeg)');
  // Leser und Faktor
  ok(Verrat.lesen({ n: 1, tick: -5, hex: '0505' }).tick === 0, 'Leser: negativer Tick wird 0');
  const f0 = VW.verlust.wert.faktor; VW.verlust.wert.faktor = 5; const f5 = Verrat.faktor(); VW.verlust.wert.faktor = -1; const fm = Verrat.faktor(); VW.verlust.wert.faktor = f0;
  ok(f5 === 1 && fm === 0, 'Faktor wird auf 0..1 begrenzt (5 -> 1, -1 -> 0)');
  // genau ein Verbündeter: der Abzug „vernichtet“ gilt auch bei einem Abschuss
  const u = bereit({ kampf: true, rom: 1 }); const gu = u.g; ok(allies(gu).length === 1, 'Vorbedingung: genau ein Verbündeter');
  verrat(gu); durchspielen(gu, 600);
  ok(letzterTick.wirkungen.some((x) => x.typ === 'ruf_aenderung' && x.grund === 'verrat_flotte_vernichtet'), 'ein einziger Abschuss genügt für den Abzug „vernichtet“');
  // Mindest-Hülle aus den Daten
  const hm0 = VW.huelle_min.wert; VW.huelle_min.wert = 0.3;
  const v = bereit({ kampf: true }); const gv = v.g; const q = allies(gv)[0]; q.hp = Math.max(1, Math.round(q.hpMax * 0.1)); verrat(gv);
  const e = ex(gv).find((x) => x.name === q.name); VW.huelle_min.wert = hm0;
  ok(e && Math.abs(e.hp / e.hpMax - 0.3) < 0.02, 'huelle_min kommt aus den Daten (Hülle 10 % -> ' + (e && (e.hp / e.hpMax).toFixed(2)) + ' bei 0,3)');
});

section('Gleiche Regeln für Ex-Verbündete wie für Gegner', () => {
  const t = bereit({ kampf: true, rom: 8 }); const g = t.g; verrat(g);
  for (const e of ex(g)) {
    const norm = Space.spawnEnemy(g, e.kind, { tag: 'vergleich', ziel: 'lerche' });
    g.space.enemies = g.space.enemies.filter((x) => x !== norm);
    ok(e.hpMax === norm.hpMax && gleich(e.shieldsMax, norm.shieldsMax) && gleich(Object.keys(e.waffen || {}), Object.keys(norm.waffen || {})) && e.fireT !== undefined && e.orbitDir !== undefined, `${e.name} (${e.kind}): gleiche Hülle, Schilde und Waffenplätze wie ein gewöhnlicher Gegner der Klasse`);
    ok(gleich(Object.values(e.waffen || {}).length, Object.values(norm.waffen || {}).length) && Object.values(e.waffen || {}).every((x) => typeof x === 'string'), 'bestückt wie ein Gegner (Katalogwaffen je Platz)');
  }
  // dieselbe Treffer- und Schadenslogik: ein Geschoss der Lerche wirkt auf einen Ex-Verbündeten wie auf einen Gegner gleicher Klasse
  const e1 = ex(g)[0]; const cmp = Space.spawnEnemy(g, e1.kind, { tag: 'vergleich', x: e1.x + 400, y: e1.y + 400 }); Testhilfe.setzeGesamt(cmp, cmp.hpMax); Testhilfe.setzeGesamt(e1, e1.hpMax);
  e1.shields.fill(0); cmp.shields.fill(0);
  Space.damageEnemy(g, e1, 0.5, e1.x - 100, e1.y, {}); Space.damageEnemy(g, cmp, 0.5, cmp.x - 100, cmp.y, {});   // klein genug, dass kein System (zufällige Wahl) davon zerstört wird
  ok(Math.abs((e1.hpMax - e1.hp) - (cmp.hpMax - cmp.hp)) < 1e-9 && e1.hp < e1.hpMax, 'gleicher Schaden bei gleichem Treffer (' + (e1.hpMax - e1.hp) + ')');
});

section('Weiter: Germanen im Verrat, Marken, Lagefunk', () => {
  const t = bereit({ kampf: true, ruf: 0 }); const g = t.g; verrat(g);
  const alt = g.space.enemies.filter((e) => e.leaving && !e.verratS); const m0 = g.inventory.marks;
  for (const e of alt) if (g.space.enemies.includes(e)) kill(g, e);
  ok(alt.length > 0 && g.inventory.marks === m0, 'fliehende Germanen im Verrat: keine Marken (' + alt.length + ')');
});

console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'VERRAT OK'}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
