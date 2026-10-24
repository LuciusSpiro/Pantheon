'use strict';
// SUND-03 D: Chronik der Freien Fahrt Sund (server/sim/chronik.js, Weltstand welt.sim.chronik, Daten content/welt/chronik-werte.json). Prüft:
//   Einträge (Form, Grenzen, Namen) · Ring · Quellen (Reise-Ereignis, Sim-Szene Sieg und Flucht, Absicht gewählt und abgelehnt, angewandter Plan, Posten, Hafen) · Ausschnitt für den Grobplan
//   (liest die letzten Einträge, bleibt unter der Obergrenze, keine Namen) · Weltstand (Runde, Altstand, Müll, schemagültig) · Snapshot unberührt.        node tools/test-chronik.js
const fs = require('fs');
const path = require('path');
const F = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Chronik = require('../server/sim/chronik.js');
const Absicht = require('../server/sim/absicht.js');
const Ausschnitt = require('../server/sim/lage-ausschnitt.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const RE = require('../server/sim/reise-ereignis.js');
const LageSL = require('../server/sim/lage-spielleiter.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const W = require('../content/welt/chronik-werte.json').werte;
const A = require('../content/welt/regie-werte.json').werte.ausschnitt.wert;
const ws = (g) => g.weltsim;
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const spiel = (o) => F.neuesSpiel(Object.assign({ crew: 1, seed: 7, env: { REISE_EREIGNISSE: '1' } }, o || {}));
const HZ = CONFIG.tickHz;
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };

section('Daten', () => {
  ok(W.max.wert >= 20 && W.max.wert <= 80 && W.kurz_max.wert === 80 && W.ref_max.wert >= 20, `Ring ${W.max.wert} Einträge, Text höchstens ${W.kurz_max.wert} Zeichen`);
  ok(JSON.stringify(Chronik.ARTEN) === JSON.stringify(['reise', 'szene', 'absicht', 'plan', 'posten', 'welt']) && Chronik.MAX === W.max.wert, 'Arten und Obergrenze kommen aus den Daten');
});

section('Einträge: Form, Grenzen, Namen', () => {
  const g = spiel({ crew: 3, names: NAMEN }).g;
  ok(Chronik.eintragen({ weltsim: null }, { art: 'plan', ref: 'x', kurz: 'y' }) === null, 'ohne Modus: nichts');
  const e = Chronik.eintragen(g, { art: 'plan', ref: 'p1', kurz: 'Plan 1: fokus', param: { angenommen: 1, ok: true, wer: 'x', tief: { a: 1 }, 'BAD KEY': 1, a: 1, b: 2, c: 3 } });
  ok(e && e.t === ws(g).tickZahl && e.art === 'plan' && e.ref === 'p1' && e.kurz === 'Plan 1: fokus', 'Eintrag { t, art, ref, kurz }');
  ok(e.param && Object.keys(e.param).length <= 4 && !('tief' in e.param) && !('BAD KEY' in e.param), 'param: höchstens vier Felder, nur Zahlen, Texte, Wahrheitswerte');
  ok(Chronik.eintragen(g, { art: 'unbekannt', kurz: 'x' }) === null && Chronik.eintragen(g, { art: 'plan', kurz: '   ' }) === null && Chronik.eintragen(g, null) === null, 'unbekannte Art, leerer Text, Müll: nichts');
  const lang = Chronik.eintragen(g, { art: 'plan', ref: 'r'.repeat(90), kurz: 'x'.repeat(300) });
  ok(lang.kurz.length === W.kurz_max.wert && lang.ref.length === W.ref_max.wert, 'Text und Referenz werden gekürzt');
  const n1 = Chronik.eintragen(g, { art: 'szene', ref: 's1', kurz: 'Sieg: Mireille_Kasper und Ouzo_Brandt halten Carrara, Tzvi_Lund flog', param: { wer: 'Mireille_Kas' } });
  ok(!/Mireille|Ouzo|Tzvi/.test(JSON.stringify(n1)) && /Crew/.test(n1.kurz), 'Spielernamen kommen nie hinein (auch nicht in param, auch nicht als Wortanfang)');
  ok(Chronik.letzte(g, 2).length === 2 && Chronik.letzte(g, 2)[1].ref === 's1' && Chronik.letzte(g, 0).length === 0, 'letzte(n): die letzten n Einträge');
  const kopie = Chronik.letzte(g, 1); kopie[0].kurz = 'X';
  ok(ws(g).chronik[ws(g).chronik.length - 1].kurz !== 'X', 'letzte() gibt Kopien');
});

section('Ring: Obergrenze', () => {
  const g = spiel().g;
  for (let i = 0; i < W.max.wert * 3; i++) Chronik.eintragen(g, { art: 'plan', ref: 'p' + i, kurz: 'Eintrag ' + i });
  const c = ws(g).chronik;
  ok(c.length === W.max.wert, `die Liste bleibt bei ${W.max.wert} Einträgen (nach ${W.max.wert * 3} geschriebenen)`);
  ok(c[0].ref === 'p' + (W.max.wert * 2) && c[c.length - 1].ref === 'p' + (W.max.wert * 3 - 1), 'die ältesten fallen zuerst heraus, die neuesten bleiben');
  ok(JSON.stringify(c).length < 7000, `klein: ${JSON.stringify(c).length} Zeichen für ${c.length} Einträge`);
});

section('Quellen', () => {
  // Reise-Ereignis
  const t = spiel({ crew: 3, names: NAMEN }); const g = t.g; ws(g).zustand.flotten = [];
  const alt = RE.WERTE.wahrscheinlichkeit; RE.WERTE.wahrscheinlichkeit = 1;
  const kopie = RE.KATALOG.slice(); RE.KATALOG.length = 0; RE.KATALOG.push(kopie.find((e) => e.id === 'patrouille_rom_gruss'));
  Sprung.springeNach(g, Sektoren.ortVonHex('0305'));
  RE.KATALOG.length = 0; RE.KATALOG.push(...kopie); RE.WERTE.wahrscheinlichkeit = alt;
  const c0 = ws(g).chronik.filter((c) => c.art === 'reise');
  ok(c0.length === 1 && c0[0].ref === 'patrouille_rom_gruss' && /Streife/.test(c0[0].kurz) && c0[0].param.art === 'patrouille', 'Reise-Ereignis: ein Eintrag mit Art und Ort');
  // Posten und Hafen aus den Ereignissen des Ticks
  Chronik.ausTick(g, [{ typ: 'posten_gehisst', ort: '0505' }, { typ: 'posten_ausgebaut', ort: '0505' }, { typ: 'posten_verloren', ort: '0505', besitzer: 'rom', durch: 'ger' },
    { typ: 'posten_verloren', ort: '0503', besitzer: 'ger', durch: 'rom' }, { typ: 'hafen_gefallen', ort: '0204', alt: 'rom', neu: 'ger' }, { typ: 'hauptwelt_gefallen', ort: '0204', alt: 'rom', neu: 'ger' }, { typ: 'konvoi' }],
  [{ typ: 'posten_gesprengt', ort: '0603' }], ['0505']);
  const c1 = ws(g).chronik.slice(1);
  ok(c1.map((c) => c.art + ':' + c.kurz.split(':')[0]).join() === 'posten:Posten gegründet,posten:Posten ausgebaut,posten:Posten gefallen,welt:Hafen gefallen,welt:Hauptwelt gefallen,posten:Posten gesprengt', 'Posten gegründet, ausgebaut, gefallen (nur Posten der Crew), gesprengt; Hafen und Hauptwelt gefallen; konvoi nicht');
  ok(c1.find((c) => /gefallen/.test(c.kurz) && c.art === 'posten').ref === '0505' && !c1.some((c) => c.ref === '0503'), 'gefallen steht nur für den Posten der Crew (0505), nicht für den fremden (0503)');
  // Absicht gewählt und abgelehnt
  const a = spiel(); const ga = a.g; ws(ga).ruf.rom = 60;
  const ids = Absicht.KATALOG.slice(0, 2).map((x) => x.id);
  ws(ga).absicht.angebot = { ids, t: 1, bis: 99 };
  ok(Absicht.waehlen(ga, ids[0]) === null, 'Absicht gewählt');
  ws(ga).absicht.laufend = null; ws(ga).absicht.angebot = { ids, t: 1, bis: 99 };
  ok(Absicht.ablehnen(ga) === null, 'Absicht abgelehnt');
  const ca = ws(ga).chronik;
  ok(ca.length === 2 && ca[0].art === 'absicht' && /gewählt/.test(ca[0].kurz) && ca[0].ref === ids[0] && /abgelehnt/.test(ca[1].kurz) && ca[1].param.wahl === 'nein', 'Chronik: Wahl und Ablehnung');
  const ver = spiel(); ws(ver.g).ruf.rom = 60;
  ok(Absicht.waehlen(ver.g, ids[0]) !== null && ws(ver.g).chronik.length === 0, 'eine abgelehnte Wahl (kein Angebot) schreibt nichts');
  // Plan des Lage-Spielleiters
  const p = spiel(); const gp = p.g;
  const sl = LageSL.create(gp, { mode: 'mock', env: { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } });
  sl.antwort({ token: 1, art: 'andocken', nr: 3, startTick: ws(gp).tickZahl, bau: {} }, { text: JSON.stringify({ befehle: [{ typ: 'regler', fraktion: 'ger', aggr: 0.5, dauer: 8 }], begruendung: 'Test' }), tokens: 0 });
  const cp = ws(gp).chronik;
  ok(cp.length === 1 && cp[0].art === 'plan' && cp[0].ref === 'p3' && /Plan 3 \(andocken\): regler/.test(cp[0].kurz), 'angewandter Plan: Nummer, Grenze, Befehlstypen');
  sl.dispose();
});

// Sim-Szene: Sieg und Flucht schreiben ihren Ausgang (Szenenhelfer wie in test-ruf.js)
section('Hooks: Tick und Szene', () => {
  const g = spiel().g; const orig = Chronik.ausTick; const aufrufe = [];
  ws(g).posten = { '0505': { t: 0 } };
  Chronik.ausTick = function (...a) { aufrufe.push(a); return orig.apply(this, a); };
  try { Kriegslage.tick(g, 'test'); } finally { Chronik.ausTick = orig; }
  ok(aufrufe.length === 1 && Array.isArray(aufrufe[0][1]) && Array.isArray(aufrufe[0][2]) && aufrufe[0][3].includes('0505'), 'jeder Sim-Tick ruft ausTick mit den Ereignissen, den Wirkungen und den Crew-Posten VOR dem Tick');
  const g2 = spiel().g; const s0 = ws(g2).chronik.length;
  Kriegslage.tickMit(g2, 'test', undefined, []); Kriegslage.tickMit(g2, 'test', undefined, []);
  ok(ws(g2).chronik.length >= s0, 'ein Tick löscht keine Chronik');
});

section('Sim-Szene: Sieg und Flucht', () => {
  const OSTIA = '0305';
  const flotte = (g, hex, fraktion, staerke, belagerung) => {
    const st = ws(g).zustand;
    const fl = { id: st.naechsteId++, fraktion, heimat: { ger: '1004', pirat: '0602' }[fraktion] || hex, ort: hex, staerke, kap: Math.max(staerke, 5), befehl: 'rueckzug', ziel: null, warte: 0, versorgung: 1, angriff: null }; fl.ziel = fl.heimat;
    st.flotten.push(fl);
    if (belagerung) {
      const id = st.naechsteAngriffId++;
      st.angriffe.push({ id, t0: st.tick, ziel: hex, von: fraktion, art: fraktion === 'pirat' ? 'pirat' : 'reich', relevant: true, zielArt: st.hexe[hex].posten ? 'posten' : 'hafen', t_an: st.tick, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: st.tick, stuetz: null, flotten: [fl.id] });
      fl.befehl = 'angriff'; fl.ziel = hex; fl.angriff = id;
    }
  };
  const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
  const kill = (g, e) => { e.hp = 1; Space.damageEnemy(g, e, 500, e.x - 100, e.y, {}); };
  // Sieg
  let g = spiel().g;
  ab(g); ws(g).zustand.flotten = ws(g).zustand.flotten.filter((f) => f.ort !== OSTIA); flotte(g, OSTIA, 'ger', 17, true);
  Space.enterScene(g, 'ostia_nova', {}); ab(g); lauf(g, 21);
  let da = false;
  for (let i = 0; i < 400 * HZ && g.simSzene; i++) {
    if (g.space.enemies.some((e) => e.flagg)) { da = true; break; }
    for (const e of g.space.enemies.slice()) kill(g, e);
    g.step();
  }
  if (da) kill(g, g.space.enemies.find((e) => e.flagg));
  lauf(g, 0.3);
  const cs = ws(g).chronik.filter((c) => c.art === 'szene');
  ok(da && !g.simSzene && cs.length === 1 && /^Sieg bei /.test(cs[0].kurz) && cs[0].param.ausgang === 'sieg' && cs[0].param.fraktion === 'ger', 'Szene gewonnen: Chronik „Sieg bei …“ mit Fraktion ' + (cs[0] ? cs[0].kurz : '-'));
  // Flucht (Sprung im Kampf)
  g = spiel().g;
  ab(g); ws(g).zustand.flotten = ws(g).zustand.flotten.filter((f) => f.ort !== OSTIA); flotte(g, OSTIA, 'ger', 17, true);
  Space.enterScene(g, 'ostia_nova', {}); ab(g); lauf(g, 21);
  g.explore.markBoje(Sektoren.kanteId('0305', '0204')); g.explore.erkunde('0204');
  const s = g.ship; const pp = Sprung.sprungpunkt(g, '0204'); s.x = pp.x - 80; s.y = pp.y; s.vx = 0; s.vy = 0; s.speed = 0; s.jump.dest = Sektoren.ortVonHex('0204'); s.jump.charge = 1; s.jump.ready = true;
  const sim = !!g.simSzene;
  const err = Sprung.doJump(g);
  const cf = ws(g).chronik.filter((c) => c.art === 'szene');
  ok(sim && !err && cf.length === 1 && /^Flucht bei /.test(cf[0].kurz) && cf[0].param.ausgang === 'abbruch', 'Szene per Sprung verlassen: Chronik „Flucht bei …“' + (err ? ' ' + err : ''));
});

section('Ausschnitt für den Grobplan: klein, liest die Chronik, ohne Namen', () => {
  const g = spiel({ crew: 3, names: NAMEN }).g;
  for (let i = 0; i < 30; i++) Kriegslage.tick(g, 'test');
  for (let i = 0; i < W.max.wert * 2; i++) Chronik.eintragen(g, { art: 'szene', ref: 's' + i, kurz: `Sieg bei Ostia Nova, ${NAMEN[i % 3]} flog mit ${'x'.repeat(60)}`, param: { ausgang: 'sieg' } });
  const roh = ws(g).chronik.length;
  for (let s = 0; s <= 3; s++) {
    const a = Ausschnitt.ausschnitt(g, { stufe: s }); const d = JSON.parse(a.text);
    ok(d.chronik.length === A.stufen[s].chronik && d.chronik.length < roh && d.chronik.every((c) => c.length <= A.chronik_zeichen && /^\d+: /.test(c)), `Stufe ${s}: nur die letzten ${A.stufen[s].chronik} von ${roh} Einträgen, je „Tick: Text“`);
    ok(!NAMEN.some((x) => a.text.includes(x)), `Stufe ${s}: keine Spielernamen`);
  }
  const p = Ausschnitt.ausschnittPassend(g, {});
  ok(p.passt && p.zeichen <= A.max_zeichen, `Obergrenze bleibt: ${p.zeichen} ≤ ${A.max_zeichen} Zeichen (Stufe ${p.stufe}) bei voller Chronik`);
  const leer = spiel().g;
  ok(JSON.parse(Ausschnitt.ausschnitt(leer, { stufe: 0 }).text).chronik.length === 0, 'leere Chronik: leere Liste');
  const letzter = JSON.parse(Ausschnitt.ausschnitt(g, { stufe: 0 }).text).chronik.pop();
  ok(letzter.startsWith(ws(g).chronik[ws(g).chronik.length - 1].t + ': '), 'der jüngste Eintrag steht zuletzt');
});

section('Weltstand: Runde, Altstand, Müll', () => {
  const g = spiel().g;
  ok(!('chronik' in Weltstand.capture(g).welt.sim), 'leere Chronik: kein Block');
  for (let i = 0; i < 12; i++) { Kriegslage.tick(g, 'test'); Chronik.eintragen(g, { art: i % 2 ? 'plan' : 'szene', ref: 'r' + i, kurz: 'Eintrag ' + i, param: { i } }); }
  const d1 = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  ok(d1.version === 3 && d1.welt.sim.chronik.length === 12 && Weltstand.validate(d1).length === 0, 'Block welt.sim.chronik, Version 3, schemagültig');
  const dir = F.freshDir(); d1.id = 'w-chronik'; fs.writeFileSync(path.join(dir, 'w-chronik.json'), JSON.stringify(d1));
  const g2 = spiel({ dir, world: 'w-chronik' }).g;
  ok(g2.phase === 'play' && g2.errors === 0 && F.gleich(ws(g2).chronik, ws(g).chronik), 'Laden: dieselbe Chronik');
  ok(F.gleich(JSON.parse(JSON.stringify(Weltstand.capture(g2))).welt.sim.chronik, d1.welt.sim.chronik), 'Runde Speichern, Laden, Speichern: gleich');
  const alt = JSON.parse(JSON.stringify(d1)); delete alt.welt.sim.chronik; alt.id = 'w-alt'; fs.writeFileSync(path.join(dir, 'w-alt.json'), JSON.stringify(alt));
  const g3 = spiel({ dir, world: 'w-alt' }).g;
  ok(Weltstand.validate(alt).length === 0 && g3.phase === 'play' && ws(g3).chronik.length === 0, 'Altstand ohne Block: lädt, Chronik leer');
  ok(Chronik.lesen(null).length === 0 && Chronik.lesen('x').length === 0 && Chronik.lesen({}).length === 0, 'Leser: Müll = leer');
  const m = Chronik.lesen([...Array.from({ length: 100 }, (_, i) => ({ t: i, art: 'plan', ref: 'p' + i, kurz: 'k' + i })), { t: 3, art: 'quatsch', kurz: 'y' }, null, { t: 4, art: 'plan', kurz: '' }, 'text']);
  ok(m.length === W.max.wert && m[m.length - 1].ref === 'p99' && m.every((c) => c.kurz.length <= W.kurz_max.wert && Chronik.ARTEN.includes(c.art) && Number.isInteger(c.t) && c.t >= 0), 'Leser: Unsinniges fällt weg, Obergrenze, die neuesten bleiben');
  const m2 = Chronik.lesen([{ t: 'x', art: 'welt', ref: 'r', kurz: 'z'.repeat(200), param: { a: 1, b: { c: 1 } } }, { t: -5, art: 'plan', ref: 1, kurz: 'x' }]);
  ok(m2.length === 2 && m2[0].t === 0 && m2[0].kurz.length === 80 && JSON.stringify(m2[0].param) === '{"a":1}' && m2[1].t === 0 && m2[1].ref === '', 'Leser: Zeit auf 0, Text gekürzt, param bereinigt, Referenz nur als Text');
});

section('Snapshot unberührt', () => {
  const t = spiel({ crew: 3 }); const g = t.g;
  for (let i = 0; i < 10; i++) Chronik.eintragen(g, { art: 'plan', ref: 'p' + i, kurz: 'Eintrag ' + i });
  const snap = JSON.stringify(g.snapshot());
  ok(snap.length > 1000 && !/chronik/i.test(snap) && !/Eintrag \d/.test(snap), 'kein Chronik-Feld im Snapshot (die Chronik ist Serverzustand)');
});

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
