'use strict';
// FAD-01 B: der atomare Sim-Kern-Befehl invasion (Hochstufen und Angriff in einem) und die Invasion eines Fadens (server/weltsim/befehle.js, server/sim/regie-befehle.js fadenInvasion, Daten
// befehle-werte.json, regie-werte.json, lage-befehle.json). Direkt gegen die Game-Klasse, ohne Netz.
//   Daten · Kern-Befehl (+30 % exakt, über kap, einmalig, Ablehnungen, Fremdfelder, Prüfung ändert den Zustand nie, anwenden macht beides oder nichts) · nur aus Fäden (Plan und Leser nehmen weder invasion
//   noch ein einzelnes Hochstufen an) · Invasion (EIN Eintrag, Wahl der Flotte, Vorwarnung vor der Wirkung, Entwarnung, Abkühlzeit, Obergrenze der Warteschlange) · der Stand wechselt zwischen Annahme
//   und Tick: nie ein halbes Wirken (auch mit aktiver Standard-KI über viele Seeds) · Weltstand (Speichern/Laden, Altstand) · Sim ohne Befehle byte-gleich.
//   node tools/test-sim-befehl-invasion.js [begriff …]
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Weltstand = require('../server/weltstand.js');
const Kern = require('../server/weltsim/kern.js');
const Kz = require('../server/weltsim/kennzahlen.js');
const Daten = require('../server/weltsim/daten.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Regie = require('../server/sim/regie-befehle.js');
const P3 = require('../server/sim/faden-p3.js');
const F = require('./regie-fixture.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const { klon, gleich } = F;
const BW = require('../content/welt/befehle-werte.json').werte;
const RW = require('../content/welt/regie-werte.json').werte;
const ws = (g) => g.weltsim;
const z = (g) => g.weltsim.zustand;
const tick = (g, k) => { for (let i = 0; i < (k || 1); i++) Kriegslage.tick(g, 'test'); };
const flotte = (g, id) => z(g).flotten.find((f) => f.id === id);
const funkAll = (t) => t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio');
const logbuch = (g) => (g.lageRegie ? g.lageRegie.log.entries : []);
const SCHALTER = { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' };
const ZIEL = '0403';   // Speculum, römisch
const NAH = 1e-9;

// Ruhige Ausgangslage wie in test-regie.js: alle Flotten voll im Heimathafen, keine Feldzüge, Standard-KI plant nichts
function szene() {
  const t = F.neuesSpiel(); const g = t.g, zz = z(g);
  g.env = Object.assign({}, g.env, SCHALTER);
  zz.angriffe = [];
  for (const fl of zz.flotten) { fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null; fl.angriff = null; fl.warte = 0; fl.staerke = fl.kap; fl.versorgung = 1; }
  for (const h of Object.values(zz.hexe)) h.anspruch = {};
  for (const f of ['rom', 'ger']) { zz.vorrat[f].T = 40; zz.vorrat[f].U = 40; zz.marken[f] = 500; }
  zz.vorrat.kon.T = 31; zz.vorrat.kon.U = 10;
  zz.regie = { rom: { p_act: 0, regler_bis: 1e9 }, ger: { p_act: 0, regler_bis: 1e9 } };
  return t;
}
const gerFlotten = (g) => z(g).flotten.filter((f) => f.fraktion === 'ger');
const INV = (id, ziel) => ({ typ: 'invasion', fraktion: 'ger', flotte: id, ziel: ziel || ZIEL });
const HOCH = (id) => ({ typ: 'flotte_hochstufen', fraktion: 'ger', flotte: id });
const pruefe = (g, b) => Kern.pruefeBefehl(z(g), b);
const erste = (g) => Kern.BEFEHLE.angriffsflotten(z(g), 'ger', ZIEL)[0];
const entw = (t, von) => funkAll(t).slice(von).map((m) => m.text).filter((x) => /Entwarnung/.test(x));
const A = BW.angreifen.wert, V = BW.invasion.wert;
const zustandOhne = (zz) => JSON.stringify(Object.fromEntries(Object.entries(zz).filter(([k]) => k !== 'werte' && k !== 'karte')));

section('Daten', () => {
  ok(V.staerke_zuwachs === 0.3 && V.fraktionen.join() === 'ger', 'Zuwachs 0,3 und Fraktion ger stehen im Block invasion (befehle-werte.json)');
  ok(!('vorrat_auffuellen' in V) && !('flotte_hochstufen' in BW), 'die Versorgung ist fester Bestandteil des Befehls: kein Schalter, kein zweiter Block flotte_hochstufen');
  ok(Number.isInteger(RW.vorwarnung.wert.vorlauf.invasion) && RW.vorwarnung.wert.vorlauf.invasion >= RW.vorwarnung.wert.mindest_vorlauf, 'Vorlauf der Invasion steht in regie-werte.json');
  ok(Number.isInteger(RW.abkuehlung.wert.invasion) && RW.abkuehlung.wert.invasion > 0 && !('flotte_hochstufen' in RW.abkuehlung.wert), 'Abkühlzeit der Invasion steht in regie-werte.json (nicht 0), keine Abkühlzeit für ein einzelnes Hochstufen');
  ok(BW.ruhe.wert.invasion > 0 && BW.ruhe.wert.invasion <= RW.abkuehlung.wert.invasion, 'Ruhe der Invasion (wie vorher der Angriff) steht in den Daten und ist nicht länger als die Abkühlzeit');
  const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'flotte', 'lage-befehle.json'), 'utf8'));
  ok(T.vorwarnung.invasion && T.vorwarnung.invasion.sprecher === 'Oberkommando' && /\{ziel\}/.test(T.vorwarnung.invasion.text) && /\{n\}/.test(T.vorwarnung.invasion.text), 'Vorwarnung invasion: Oberkommando, Platzhalter ziel und n');
  ok(T.entwarnung.invasion && T.entwarnung.invasion.sprecher === 'Oberkommando' && /\{ziel\}/.test(T.entwarnung.invasion.text), 'Entwarnung invasion');
  const KAT = require('../content/welt/lage-katalog.json').befehle;
  ok(!('invasion' in KAT) && !('flotte_hochstufen' in KAT), 'nicht im Katalog des Lage-Spielleiters (lage-katalog.json)');
  ok(Object.keys(Kern.BEFEHLE.KATALOG).includes('invasion') && gleich(Kern.BEFEHLE.FELDER.invasion, ['typ', 'fraktion', 'flotte', 'ziel']), 'im Kern-Katalog, Felder typ, fraktion, flotte, ziel');
  ok(!Object.keys(Kern.BEFEHLE.KATALOG).includes('flotte_hochstufen') && !('flotte_hochstufen' in Kern.BEFEHLE.FELDER), 'ein einzelnes Hochstufen ist kein Befehl mehr (nur Hilfsregel des Befehls invasion)');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'schema', 'weltstand.schema.json'), 'utf8'));
  const sim = JSON.stringify(schema);
  const m = /"vorgemerkt":\s*\{\s*"type":\s*"array",\s*"maxItems":\s*(\d+)/.exec(sim);
  ok(m && Number(m[1]) === RW.plan.wert.vorgemerkt_max + RW.plan.wert.faden_vorgemerkt_max, 'Obergrenze der Warteschlange: Schema maxItems (' + (m && m[1]) + ') = plan.vorgemerkt_max + plan.faden_vorgemerkt_max (' + (RW.plan.wert.vorgemerkt_max + RW.plan.wert.faden_vorgemerkt_max) + ')');
});

section('Kern-Befehl: +30 % exakt, über kap, einmalig, Angriff im selben Schritt', () => {
  const g = szene().g, fl = flotte(g, erste(g));
  const alt = fl.staerke, kap = fl.kap;
  ok(alt === kap, 'Ausgangslage: Flotte voll (' + alt + ' von ' + kap + ')');
  ok(pruefe(g, INV(fl.id)).ok, 'Prüfer nimmt eine volle germanische Flotte mit gültigem Ziel an');
  const res = Kern.tick(z(g), { befehle: [INV(fl.id)] });
  const f2 = flotte(g, fl.id);
  ok(res.befehle.angewandt.length === 1 && res.befehle.abgelehnt.length === 0, 'im Tick angewandt');
  ok(Math.abs(f2.staerke - alt * 1.3) < 1e-6, 'Stärke steigt um genau 30 % (' + alt + ' -> ' + f2.staerke + ')');
  ok(f2.staerke > f2.kap, 'darf über kap gehen (kap ' + f2.kap + ')');
  ok(f2.hochgestuft === true, 'Flottenfeld hochgestuft: true');
  ok(z(g).angriffe.some((a) => a.befohlen && a.ziel === ZIEL && a.von === 'ger' && a.flotten.includes(fl.id)), 'im selben Schritt: Feldzug auf das Ziel mit dieser Flotte');
  ok(f2.befehl !== 'heim', 'die Flotte bricht auf bzw. sammelt');
  ok(z(g).regie.ger.ruhe_bis === z(g).tick + BW.ruhe.wert.invasion, 'die Ruhe der Standard-KI der Germanen beginnt wie nach einem befohlenen Angriff (Daten ruhe.invasion)');
  const r = pruefe(g, INV(fl.id));
  ok(!r.ok && /schon hochgestuft/.test(r.grund), 'zweiter Befehl für dieselbe Flotte abgelehnt (' + r.grund + ')');
  const st = flotte(g, fl.id).staerke;
  const res2 = Kern.tick(z(g), { befehle: [INV(fl.id)] });
  ok(res2.befehle.abgelehnt.length === 1 && /schon hochgestuft/.test(res2.befehle.abgelehnt[0].grund), 'auch im Tick abgelehnt');
  ok(flotte(g, fl.id).staerke <= st + NAH, 'die Stärke steigt kein zweites Mal');
  ok(gerFlotten(g).filter((x) => x.id !== fl.id).every((x) => !('hochgestuft' in x)), 'andere Flotten tragen das Feld nicht');
  // geschwächte Flotte (aber noch bereit, 70 %): +30 % der AKTUELLEN Stärke
  const g2 = szene().g, f3 = flotte(g2, erste(g2)); f3.staerke = f3.kap * 0.75;
  const kontrolle = klon(z(g2)); kontrolle.werte = z(g2).werte; kontrolle.karte = z(g2).karte;
  Kern.tick(kontrolle);   // dieselbe Wirtschaft ohne Befehl (die Wirtschaft des Ticks läuft vor dem Befehl)
  Kern.tick(z(g2), { befehle: [INV(f3.id)] });
  const s1 = kontrolle.flotten.find((f) => f.id === f3.id).staerke;
  ok(s1 < f3.kap && Math.abs(flotte(g2, f3.id).staerke - s1 * 1.3) < 1e-6, 'bei geschwächter Flotte: +30 % der aktuellen Stärke (' + s1.toFixed(3) + ' -> ' + flotte(g2, f3.id).staerke.toFixed(3) + ')');
});

section('Kern-Befehl: Prüfer lehnt ab, Fremdfelder', () => {
  const g = szene().g, fl = flotte(g, erste(g));
  const rom = z(g).flotten.find((f) => f.fraktion === 'rom'), kon = z(g).flotten.find((f) => f.fraktion === 'kon'), pirat = z(g).flotten.find((f) => f.fraktion === 'pirat');
  for (const [b, re, was] of [
    [INV(99999), /unbekannte Flotte/, 'unbekannte Flotte'],
    [{ typ: 'invasion', fraktion: 'ger', ziel: ZIEL }, /unbekannte Flotte/, 'ohne Flotte'],
    [{ typ: 'invasion', fraktion: 'ger', flotte: '1', ziel: ZIEL }, /unbekannte Flotte/, 'Flotte als Text'],
    [{ typ: 'invasion', fraktion: 'rom', flotte: rom.id, ziel: ZIEL }, /fraktion muss ger/, 'Rom als Fraktion'],
    [{ typ: 'invasion', fraktion: 'ger', flotte: rom.id, ziel: ZIEL }, /gehört nicht zu ger/, 'römische Flotte'],
    [{ typ: 'invasion', fraktion: 'ger', flotte: kon.id, ziel: ZIEL }, /gehört nicht zu ger/, 'Flotte des Konkordats'],
    [{ typ: 'invasion', fraktion: 'ger', flotte: pirat.id, ziel: ZIEL }, /gehört nicht zu ger/, 'Piratenflotte'],
    [INV(fl.id, 'zz99'), /unbekanntes Ziel/, 'unbekanntes Ziel'],
    [INV(fl.id, '0803'), /gehört nicht Rom/, 'Ziel ist germanisch'],
    [{ typ: 'invasion', fraktion: 'ger', flotte: fl.id }, /unbekanntes Ziel/, 'ohne Ziel'],
    [Object.assign(INV(fl.id), { staerke: 99 }), /unbekanntes Feld "staerke"/, 'Fremdfeld staerke'],
    [Object.assign(INV(fl.id), { flotten: [fl.id] }), /unbekanntes Feld "flotten"/, 'Fremdfeld flotten'],
  ]) { const r = pruefe(g, b); ok(!r.ok && re.test(r.grund), 'abgelehnt: ' + was + ' (' + r.grund + ')'); }
  const hw = Object.values(Kern.datenVon(z(g)).hauptwelten).find((c) => z(g).hexe[c].besitzer === 'rom');
  const rh = pruefe(g, INV(fl.id, hw));
  ok(!rh.ok && /Hauptwelt/.test(rh.grund), 'Hauptwelt Roms: abgelehnt (' + rh.grund + ')');
  // Mietflotte: eine Flotte des Konkordats, an Germanen vermietet
  const mf = flotte(g, kon.id);
  mf.miete = { von: 'kon', an: 'ger', bis: z(g).tick + 10, preis: 1 }; mf.fraktion = 'ger';
  const rm = pruefe(g, INV(kon.id));
  ok(!rm.ok && /Mietflotten/.test(rm.grund), 'abgelehnt: Mietflotte (' + rm.grund + ')');
  // Krieg aus
  const alt = z(g).werte.war; z(g).werte.war = false;
  const rk = pruefe(g, INV(fl.id));
  z(g).werte.war = alt;
  ok(!rk.ok && /Krieg ist aus/.test(rk.grund), 'abgelehnt: Krieg aus (' + rk.grund + ')');
  // Flotte nicht bereit
  fl.befehl = 'rueckzug';
  const rn = pruefe(g, INV(fl.id));
  ok(!rn.ok && /nicht bereit/.test(rn.grund), 'abgelehnt: Flotte nicht bereit (' + rn.grund + ')');
  fl.befehl = 'heim';
  ok(pruefe(g, INV(fl.id)).ok, 'Gegenprobe: die gültige Flotte wird angenommen');
});

section('Kern-Befehl: die Prüfung ändert den Zustand nie, anwenden macht beides oder nichts', () => {
  const g = szene().g, fl = flotte(g, erste(g));
  z(g).vorrat.ger.T = 3; z(g).vorrat.ger.U = 4;
  const vor = zustandOhne(z(g));
  ok(pruefe(g, INV(fl.id)).ok && zustandOhne(z(g)) === vor, 'pruefe (Hochstufen und Angriff auf der Kopie) lässt den Zustand byte-gleich');
  ok(!pruefe(g, INV(fl.id, 'zz99')).ok && zustandOhne(z(g)) === vor, 'auch eine abgelehnte Prüfung ändert nichts');
  const fi = Kern.filtereBefehle(z(g), [INV(fl.id)]);
  ok(fi.gueltig.length === 1 && zustandOhne(z(g)) === vor, 'der Probelauf (filtereBefehle) arbeitet auf einer Kopie');
  // der Angriff ist nach dem Hochstufen zulässig (Vorrat und Stärke): ohne die Probe wäre er abgelehnt
  const ang = { typ: 'angreifen', fraktion: 'ger', ziel: ZIEL, flotten: [fl.id] };
  const r0 = pruefe(g, ang);
  ok(!r0.ok && /Munition oder Treibstoff unter/.test(r0.grund), 'der Angriff allein wäre bei diesem Vorrat abgelehnt (' + r0.grund + ')');
  ok(pruefe(g, INV(fl.id)).ok, 'die Invasion ist gültig: das Hochstufen versorgt die Fraktion vor der Prüfung des Angriffs');
  // anwenden gegen einen Stand, in dem der Angriff nicht mehr geht: nichts, auch kein Hochstufen (direkter Aufruf des Katalogs)
  const gruende = [
    ['Flotte nicht mehr bereit', (zz) => { zz.flotten.find((f) => f.id === fl.id).befehl = 'rueckzug'; }],
    ['Krieg aus', (zz) => { zz.werte = Object.assign({}, zz.werte, { war: false }); }],
    ['Ziel gehört nicht mehr Rom', (zz) => { zz.hexe[ZIEL].besitzer = 'ger'; }],
    ['Feldzug auf das Ziel läuft schon', (zz) => { zz.angriffe.push({ id: 9999, t_ende: null, ziel: ZIEL, von: 'ger', art: 'reich', flotten: [] }); }],
    ['zu schwach', (zz) => { zz.flotten = zz.flotten.filter((f) => !(f.ort === ZIEL && f.fraktion === 'rom')); zz.hexe[ZIEL].abwehr = 1e6; }],
  ];
  for (const [was, aend] of gruende) {
    const g2 = szene().g; z(g2).vorrat.ger.T = 3; z(g2).vorrat.ger.U = 4;
    const fid = erste(g2);
    aend(z(g2));
    const v2 = zustandOhne(z(g2)); const c = { z: z(g2), d: Kern.datenVon(z(g2)), w: z(g2).werte, ev: [], mess: null };
    Kern.BEFEHLE.KATALOG.invasion.anwenden(c, INV(fid));
    ok(zustandOhne(z(g2)) === v2 && c.ev.length === 0, 'anwenden bei "' + was + '": weder Hochstufen noch Vorrat noch Angriff (nie halb)');
  }
});

section('Kern-Befehl: die Versorgung der Fraktion gehört fest dazu', () => {
  const wende = (gg, id) => { const c = { z: z(gg), d: Kern.datenVon(z(gg)), w: z(gg).werte, ev: [], mess: null }; Kern.BEFEHLE.KATALOG.invasion.anwenden(c, INV(id)); };   // genau der Befehl, ohne Tick (der erzeugt und verbraucht Vorrat)
  // unter dem Minimum: wird auf das Minimum gehoben, genau darauf (nicht darüber)
  const g = szene().g, fl = flotte(g, erste(g));
  z(g).vorrat.ger.T = 3; z(g).vorrat.ger.U = 4; z(g).vorrat.rom.T = 2; z(g).vorrat.rom.U = 1; const kon = JSON.stringify(z(g).vorrat.kon);
  wende(g, fl.id);
  ok(flotte(g, fl.id).hochgestuft === true && z(g).vorrat.ger.T === A.min_treibstoff && z(g).vorrat.ger.U === A.min_munition, 'Vorrat unter Minimum: T und U genau auf angreifen.min_* gehoben (T ' + z(g).vorrat.ger.T + ', U ' + z(g).vorrat.ger.U + ')');
  ok(z(g).vorrat.rom.T === 2 && z(g).vorrat.rom.U === 1 && JSON.stringify(z(g).vorrat.kon) === kon, 'nur der Vorrat der Fraktion der Flotte, Rom und Konkordat unberührt');
  // nur ein Gut darunter: das andere bleibt
  const g2 = szene().g, f2 = flotte(g2, erste(g2));
  z(g2).vorrat.ger.T = A.min_treibstoff - 1; z(g2).vorrat.ger.U = 77;
  wende(g2, f2.id);
  ok(z(g2).vorrat.ger.T === A.min_treibstoff && z(g2).vorrat.ger.U === 77, 'nur Treibstoff darunter: T gehoben, U (77) bleibt');
  // nie absenken: Vorrat darüber und genau auf dem Minimum bleibt
  const g3 = szene().g, f3 = flotte(g3, erste(g3));
  z(g3).vorrat.ger.T = 55; z(g3).vorrat.ger.U = A.min_munition;
  wende(g3, f3.id);
  ok(flotte(g3, f3.id).hochgestuft === true && z(g3).vorrat.ger.T === 55 && z(g3).vorrat.ger.U === A.min_munition, 'Vorrat darüber/auf dem Minimum: nie abgesenkt (T 55, U ' + A.min_munition + ')');
  const g4 = szene().g, f4 = flotte(g4, erste(g4));
  z(g4).vorrat.ger.T = A.min_treibstoff; z(g4).vorrat.ger.U = 90;
  wende(g4, f4.id);
  ok(z(g4).vorrat.ger.T === A.min_treibstoff && z(g4).vorrat.ger.U === 90, 'T genau auf dem Minimum: bleibt, U darüber bleibt');
});

section('Nur aus Fäden: Plan und Leser nehmen weder invasion noch ein Hochstufen an', () => {
  const t = szene(), g = t.g, fl = flotte(g, erste(g));
  for (const b of [INV(fl.id), HOCH(fl.id)]) {
    const r = Regie.planAnwenden(g, { befehle: [b] });
    ok(r.ok && r.angenommen.length === 0 && r.abgelehnt.length === 1 && (b.typ === 'invasion' ? /nur aus einem Faden/ : /unbekannter Typ/).test(r.abgelehnt[0].grund), 'Plan: ' + b.typ + ' abgelehnt (' + (r.abgelehnt[0] && r.abgelehnt[0].grund) + ')');
    ok(ws(g).regie.vorgemerkt.length === 0, 'nichts vorgemerkt');
    const p = Regie.planPruefen(g, { befehle: [b] });
    ok(p.angenommen.length === 0 && p.abgelehnt.length === 1, 'auch der Probelauf lehnt ab');
    ok(logbuch(g).some((e) => e.ausgang === 'abgelehnt' && e.key === b.typ), 'Logbuch: abgelehnt ' + b.typ);
  }
  const Prompt = require('../server/sim/lage-prompt.js');
  ok(!/- invasion \{/.test(Prompt.katalogText()) && !/hochstufen/.test(Prompt.katalogText()), 'der Prompt des Spielleiters beschreibt weder Invasion noch Hochstufen');
  // Befund 8: auch aus einer (manipulierten) Weltstand-Datei kommt nie ein einzelnes unangekündigtes Hochstufen in die Warteschlange
  const gl = Regie.lesen({ vorgemerkt: [{ b: HOCH(fl.id), ab: 6 }, { b: HOCH(fl.id), ab: 6, w: 1 }, { b: HOCH(fl.id), ab: 6, w: 2 }] }, 50);
  ok(gl.vorgemerkt.length === 0, 'Leser: flotte_hochstufen fällt weg (ohne und mit Ankündigungsmarke)');
  // eine Invasion ohne Ankündigung aus einer Datei wirkt nie auf ein römisches Ziel
  const g2 = szene().g, f2 = erste(g2);
  ws(g2).regie = Regie.lesen({ vorgemerkt: [{ b: INV(f2), ab: ws(g2).tickZahl + 1 }] }, ws(g2).tickZahl);
  ok(ws(g2).regie.vorgemerkt.length === 1 && ws(g2).regie.vorgemerkt[0].w === undefined, 'Leser: Invasion ohne Marke bleibt ohne Marke');
  tick(g2, 2);
  ok(!flotte(g2, f2).hochgestuft && !z(g2).angriffe.some((a) => a.befohlen) && logbuch(g2).some((e) => e.ausgang === 'im_tick_abgelehnt' && e.key === 'invasion'), 'im Tick abgelehnt (keine Vorwarnung ausgegangen), nichts gewirkt');
});

section('Invasion: ein Eintrag, Wahl der Flotte, nie halb', () => {
  const t = szene(), g = t.g, n0 = ws(g).tickZahl;
  const kand = Kern.BEFEHLE.angriffsflotten(z(g), 'ger', ZIEL);
  const r = Regie.fadenInvasion(g, { ziel: ZIEL });
  ok(r.ok && r.ziel === ZIEL && Number.isInteger(r.flotte) && r.ab === n0 + 1 + RW.vorwarnung.wert.vorlauf.invasion, 'Invasion angenommen, ab nach dem Vorlauf aus den Daten (ab ' + r.ab + ', jetzt ' + n0 + ')');
  const vg = ws(g).regie.vorgemerkt;
  ok(vg.length === 1 && vg[0].b.typ === 'invasion' && vg[0].w === 1 && vg[0].ab === r.ab, 'GENAU EIN Eintrag, typ invasion, angekündigt (w 1)');
  ok(vg[0].b.flotte === r.flotte && vg[0].b.ziel === ZIEL && vg[0].b.fraktion === 'ger', 'er nennt Flotte, Ziel und Fraktion');
  ok(kand.length > 0 && kand[0] === r.flotte && flotte(g, r.flotte).staerke === Math.max(...kand.map((id) => flotte(g, id).staerke)), 'gewählt wurde die stärkste bereite germanische Flotte in Reichweite');
  ok(ws(g).regie.rate.length === 0 && ws(g).regie.letzte['invasion:ger'] === n0 && Object.keys(ws(g).regie.letzte).length === 1, 'kein Rate-Platz; die Abkühlzeit steht unter invasion:ger');
  ok(logbuch(g).some((e) => e.ausgang === 'vorgemerkt' && e.key === 'invasion'), 'Logbuch: vorgemerkt');
  // nie halb: abgelehnt -> nichts vorgemerkt, kein Funk
  const t2 = szene(), g2 = t2.g;
  const vor = klon(ws(g2).regie);
  for (const [opt, re, was] of [
    [{ ziel: 'zz99' }, /unbekanntes Ziel/, 'unbekanntes Ziel'],
    [{ ziel: '0803' }, /gehört nicht Rom/, 'Ziel ist germanisch'],
    [{ ziel: ZIEL, flotte: 99999 }, /unbekannte Flotte/, 'unbekannte Flotte'],
    [{ ziel: ZIEL, flotte: z(g2).flotten.find((f) => f.fraktion === 'rom').id }, /gehört nicht zu ger/, 'römische Flotte'],
  ]) {
    const a = Regie.fadenInvasion(g2, opt);
    ok(a.ok === false && re.test(a.grund) && gleich(ws(g2).regie, vor) && funkAll(t2).length === 0, 'abgelehnt: ' + was + ' (' + a.grund + '), nichts vorgemerkt, kein Funk');
  }
  const hw = Object.values(Kern.datenVon(z(g2)).hauptwelten).find((c) => z(g2).hexe[c].besitzer === 'rom');
  const rh = Regie.fadenInvasion(g2, { ziel: hw });
  ok(rh.ok === false && /Hauptwelt/.test(rh.grund) && gleich(ws(g2).regie, vor) && funkAll(t2).length === 0, 'Hauptwelt Roms: vom Kern abgelehnt (' + rh.grund + ')');
  ok(logbuch(g2).filter((e) => e.key === 'invasion' && e.ausgang === 'abgelehnt').length === 5, 'Logbuch: jede Ablehnung steht drin');
  // schon hochgestufte Flotte: abgelehnt, nichts vorgemerkt; ohne Wunsch wird sie übersprungen
  const t3 = szene(), g3 = t3.g, f0 = flotte(g3, erste(g3));
  f0.hochgestuft = true;
  const rb = Regie.fadenInvasion(g3, { ziel: ZIEL, flotte: f0.id });
  ok(!rb.ok && /schon hochgestuft/.test(rb.grund) && ws(g3).regie.vorgemerkt.length === 0, 'gewünschte Flotte schon hochgestuft: abgelehnt');
  const rc = Regie.fadenInvasion(g3, { ziel: ZIEL });
  ok(!rc.ok || rc.flotte !== f0.id, 'ohne Wunsch wird die hochgestufte Flotte übersprungen');
  // keine bereite Flotte / Krieg aus / ohne Modus
  const g4 = szene().g; for (const f of gerFlotten(g4)) f.staerke = 0;
  const rd = Regie.fadenInvasion(g4, { ziel: ZIEL });
  ok(!rd.ok && ws(g4).regie.vorgemerkt.length === 0, 'keine bereite Flotte: abgelehnt (' + rd.grund + ')');
  const g5 = szene().g; z(g5).werte.war = false;
  const re = Regie.fadenInvasion(g5, { ziel: ZIEL });
  ok(!re.ok && ws(g5).regie.vorgemerkt.length === 0, 'Krieg aus: abgelehnt (' + re.grund + ')');
  ok(Regie.fadenInvasion({ weltsim: null }, { ziel: ZIEL }).grund === 'modus', 'ohne Modus: Grund modus');
});

// die Verteidigung des Ziels ist die Summe der Flotten dort, sonst die Abwehr des Hafens: Flotten Roms am Ziel weg, Abwehr setzen
function abwehrSetzen(g, v) { z(g).flotten = z(g).flotten.filter((f) => !(f.ort === ZIEL && f.fraktion === 'rom')); z(g).hexe[ZIEL].abwehr = v; }

section('Invasion: Hochstufen gilt vor der Prüfung des Angriffs', () => {
  // Abwehr des Ziels so, dass der Bedarf (attack_ratio mal Abwehr) zwischen 0,9 mal Stärke und 0,9 mal 1,3 mal Stärke liegt: allein zu schwach, nach dem Hochstufen genug
  const g = szene().g, fl = flotte(g, erste(g));
  abwehrSetzen(g, fl.staerke * 1.05 / z(g).werte.attack_ratio);
  const ang = { typ: 'angreifen', fraktion: 'ger', ziel: ZIEL, flotten: [fl.id] };
  const r0 = pruefe(g, ang);
  ok(!r0.ok && /zu schwach/.test(r0.grund), 'Ausgangslage: der Angriff allein ist zu schwach (' + r0.grund + ')');
  const r = Regie.fadenInvasion(g, { ziel: ZIEL, flotte: fl.id });
  ok(r.ok, 'mit Hochstufen davor ist die Invasion gültig, "zu schwach" entfällt (' + (r.grund || 'angenommen') + ')');
  // Gegenprobe: ist auch die hochgestufte Flotte zu schwach, wird die Invasion abgelehnt und nichts vorgemerkt
  const g2 = szene().g, f2 = flotte(g2, erste(g2));
  abwehrSetzen(g2, f2.staerke * 2 / z(g2).werte.attack_ratio);
  const r2 = Regie.fadenInvasion(g2, { ziel: ZIEL, flotte: f2.id });
  ok(!r2.ok && /zu schwach/.test(r2.grund) && ws(g2).regie.vorgemerkt.length === 0, 'auch hochgestuft zu schwach: abgelehnt, nichts vorgemerkt (' + r2.grund + ')');
});

section('Invasion: Vorwarnung vor der Wirkung', () => {
  const t = szene(), g = t.g, n0 = ws(g).tickZahl;
  const f0 = funkAll(t).length;
  const r = Regie.fadenInvasion(g, { ziel: ZIEL });
  const fk = funkAll(t).slice(f0);
  ok(r.ok && fk.length === 1 && fk[0].from === 'Oberkommando' && fk[0].lage === 1 && /Speculum/.test(fk[0].text) && new RegExp('\\b' + (r.ab - n0) + '\\b').test(fk[0].text), 'Funk sofort beim Vormerken: Oberkommando, Ziel Speculum, Sprünge bis zur Wirkung (' + (fk[0] && fk[0].text.slice(0, 60)) + ' …)');
  const fl = flotte(g, r.flotte), alt = fl.staerke;
  ok(!fl.hochgestuft && !z(g).angriffe.some((a) => a.befohlen), 'zum Zeitpunkt der Ankündigung ist noch nichts geschehen');
  // Reihenfolge: das Funk-Event liegt VOR dem Tick der Wirkung (Inbox-Länge beim Wirk-Tick gegen die Position des Funks)
  const posFunk = t.cs[0].inbox.findIndex((m) => m.t === 'event' && m.kind === 'radio' && /Speculum/.test(m.text));
  let wirkt = 0;
  while (ws(g).tickZahl < r.ab - 1) { tick(g); if (flotte(g, r.flotte).hochgestuft || z(g).angriffe.some((a) => a.befohlen)) wirkt++; }
  ok(wirkt === 0, 'bis einen Tick vor ab: weder hochgestuft noch Angriff');
  ok(funkAll(t).length === f0 + 1, 'bis dahin keine weitere Funkmeldung (keine Entwarnung)');
  const laengeVorWirkung = t.cs[0].inbox.length;
  tick(g);
  const f2 = flotte(g, r.flotte);
  ok(ws(g).tickZahl === r.ab && f2.hochgestuft === true && z(g).angriffe.some((a) => a.befohlen && a.ziel === ZIEL && a.von === 'ger'), 'im Tick ab: Flotte hochgestuft, Feldzug auf das Ziel begonnen');
  ok(posFunk >= 0 && posFunk < laengeVorWirkung, 'das radio-Event steht in der Inbox vor dem Wirk-Tick (Position ' + posFunk + ' von ' + laengeVorWirkung + ')');
  ok(Math.abs(f2.staerke - alt * 1.3) < 1e-6 || f2.staerke > alt, 'Stärke ist gestiegen (' + alt + ' -> ' + f2.staerke + ')');
  ok(ws(g).regie.vorgemerkt.length === 0 && ws(g).fehler === 0, 'Warteschlange leer, kein Sim-Fehler');
  ok(logbuch(g).filter((e) => e.ausgang === 'gespielt').map((e) => e.key).join() === 'invasion', 'Logbuch: gespielt, ein Eintrag invasion');
});

section('Invasion: der Stand wechselt zwischen Annahme und Tick (nie ein halbes Wirken)', () => {
  // Fall des Reviewers: Invasion angenommen (Vorrat knapp), bis zum Tick ist die Flotte nicht mehr bereit (die Standard-KI hat sie für einen eigenen Zug genommen)
  const t = szene(), g = t.g;
  z(g).vorrat.ger.T = 3; z(g).vorrat.ger.U = 4;
  const r = Regie.fadenInvasion(g, { ziel: ZIEL });
  ok(r.ok, 'angenommen (Vorrat T 3, U 4: das Hochstufen würde ihn auffüllen)');
  const fl = flotte(g, r.flotte), s0 = fl.staerke;
  fl.befehl = 'rueckzug';
  const f0 = funkAll(t).length;
  while (ws(g).tickZahl < r.ab) tick(g);
  ok(fl.hochgestuft !== true && Math.abs(fl.staerke - s0) < NAH, 'NICHT hochgestuft, Stärke unverändert (' + s0 + ' -> ' + fl.staerke + ')');
  ok(z(g).vorrat.ger.T < A.min_treibstoff && z(g).vorrat.ger.U < A.min_munition, 'Vorrat nicht aufgefüllt (T ' + z(g).vorrat.ger.T.toFixed(2) + ', U ' + z(g).vorrat.ger.U.toFixed(2) + ')');
  ok(!z(g).angriffe.some((a) => a.befohlen), 'kein befohlener Angriff');
  ok(entw(t, f0).length === 1 && /Speculum/.test(entw(t, f0)[0]), 'Entwarnung (genau eine)');
  ok(logbuch(g).some((e) => e.ausgang === 'im_tick_abgelehnt' && e.key === 'invasion' && /nicht bereit/.test((e.fehler || []).join())), 'Logbuch: im Tick abgelehnt, Grund Flotte nicht bereit');
  // die anderen Gründe, gegen einen Stand, der sich nach der Annahme ändert: nie hochgestuft
  const faelle = [
    ['Krieg endet', (gg) => { z(gg).werte = Object.assign({}, z(gg).werte, { war: false }); }],
    ['Ziel fällt an die Germanen', (gg) => { z(gg).hexe[ZIEL].besitzer = 'ger'; }],
    ['Abwehr des Ziels steigt (zu schwach)', (gg) => { abwehrSetzen(gg, 1e6); }],
    ['ein Feldzug auf das Ziel läuft schon', (gg) => { z(gg).angriffe.push({ id: 9999, t_ende: null, ziel: ZIEL, von: 'ger', art: 'reich', flotten: [], relevant: true }); }],
  ];
  for (const [was, aend] of faelle) {
    const t2 = szene(), g2 = t2.g; z(g2).vorrat.ger.T = 3; z(g2).vorrat.ger.U = 4;
    const r2 = Regie.fadenInvasion(g2, { ziel: ZIEL }), v0 = funkAll(t2).length;
    while (ws(g2).tickZahl < r2.ab - 1) tick(g2);
    aend(g2);   // erst unmittelbar vor dem Tick der Wirkung (die Wirtschaft davor würde den Eingriff sonst überschreiben)
    tick(g2);
    ok(!flotte(g2, r2.flotte).hochgestuft && z(g2).vorrat.ger.T < A.min_treibstoff && entw(t2, v0).length === 1, was + ': nicht hochgestuft, Vorrat nicht aufgefüllt, Entwarnung');
  }
});

section('Invasion: Entwarnung', () => {
  // im Tick abgelehnt (Angriff nicht mehr zu schaffen)
  const t = szene(), g = t.g, r = Regie.fadenInvasion(g, { ziel: ZIEL }), f0 = funkAll(t).length;
  z(g).werte = Object.assign({}, z(g).werte, { war: false });   // der Krieg endet bis zur Wirkung
  while (ws(g).tickZahl < r.ab) tick(g);
  ok(entw(t, f0).length === 1 && /Speculum/.test(entw(t, f0)[0]) && /Invasion/.test(entw(t, f0)[0]), 'im Tick abgelehnt: genau eine Entwarnung, Invasions-Text');
  ok(!flotte(g, r.flotte).hochgestuft, 'die Flotte wurde nie hochgestuft');
  tick(g, 3);
  ok(entw(t, f0).length === 1, 'nur einmal');
  // Verfall durch rueckfall / verwerfe: genau eine Entwarnung, nie hochgestuft
  for (const [name, fn] of [['rueckfall', (gg) => Regie.rueckfall(gg, 'Test')], ['verwerfe', (gg) => Regie.verwerfe(gg)]]) {
    const t2 = szene(), r2 = Regie.fadenInvasion(t2.g, { ziel: ZIEL });
    const v = funkAll(t2).length; fn(t2.g);
    ok(entw(t2, v).length === 1 && /Invasion/.test(entw(t2, v)[0]) && ws(t2.g).regie.vorgemerkt.length === 0, name + ': eine Entwarnung (Invasions-Text), nichts mehr wartend');
    ok(!flotte(t2.g, r2.flotte).hochgestuft, name + ': die Flotte wurde nie hochgestuft');
  }
  // Tick gescheitert
  const t3 = szene(), g3 = t3.g, r3 = Regie.fadenInvasion(g3, { ziel: ZIEL });
  while (ws(g3).tickZahl < r3.ab - 1) tick(g3);
  const v3 = funkAll(t3).length;
  const faellig = Regie.vorTick(g3, r3.ab);
  ok(faellig.length === 1, 'der Befehl ist im Tick ab fällig');
  Regie.tickGescheitert(g3, faellig, r3.ab);
  ok(entw(t3, v3).length === 1 && /Invasion/.test(entw(t3, v3)[0]) && ws(g3).regie.vorgemerkt.length === 0, 'Tick gescheitert: genau eine Entwarnung, Befehl verworfen');
});

section('Invasion: Abkühlzeit je Fraktion', () => {
  const abk = RW.abkuehlung.wert.invasion;
  const t = szene(), g = t.g, n0 = ws(g).tickZahl;
  const r = Regie.fadenInvasion(g, { ziel: ZIEL });
  ok(r.ok && ws(g).regie.letzte['invasion:ger'] === n0 && Regie.abkuehlSchluessel({ typ: 'invasion', fraktion: 'ger' }) === 'invasion:ger', 'angenommen, Schlüssel invasion:ger (Tick ' + n0 + ')');
  const f0 = funkAll(t).length, vor = klon(ws(g).regie);
  const r2 = Regie.fadenInvasion(g, { ziel: ZIEL });
  ok(!r2.ok && /Abkühlzeit/.test(r2.grund) && gleich(ws(g).regie, vor) && funkAll(t).length === f0, 'sofort eine zweite: abgelehnt mit Grund Abkühlzeit, nichts vorgemerkt, kein Funk (' + r2.grund + ')');
  ok(logbuch(g).some((e) => e.ausgang === 'abgelehnt' && e.key === 'invasion' && /Abkühlzeit/.test((e.fehler || []).join())), 'Logbuch: abgelehnt mit Grund');
  // auch eine zweite Flotte ändert nichts: die Fraktion pausiert
  const andere = Kern.BEFEHLE.angriffsflotten(z(g), 'ger', ZIEL).find((id) => id !== r.flotte);
  ok(!Regie.fadenInvasion(g, { ziel: ZIEL, flotte: andere }).ok, 'auch mit anderer Flotte während der Abkühlzeit abgelehnt');
  // Speichern und Laden: die Abkühlzeit bleibt
  const save = Regie.toSave(ws(g));
  ok(save && save.letzte['invasion:ger'] === n0, 'toSave schreibt den Schlüssel');
  const gel = Regie.lesen(klon(save), ws(g).tickZahl);
  ok(gel.letzte['invasion:ger'] === n0, 'lesen liest ihn wieder');
  // nach Ablauf wieder möglich (vor der Abkühlzeit nicht), Ort auf die gespeicherte Zeit gestellt
  const g3 = szene().g; ws(g3).tickZahl = 500;
  ws(g3).regie.letzte['invasion:ger'] = 500 - abk + 1;
  ok(!Regie.fadenInvasion(g3, { ziel: ZIEL }).ok, 'einen Tick vor Ablauf der Abkühlzeit (' + abk + '): abgelehnt');
  ws(g3).regie.letzte['invasion:ger'] = 500 - abk;
  const r3 = Regie.fadenInvasion(g3, { ziel: ZIEL });
  ok(r3.ok && ws(g3).regie.letzte['invasion:ger'] === 500, 'nach Ablauf der Abkühlzeit wieder angenommen, Zeit neu gesetzt');
  // abgelehnte Versuche setzen keine Abkühlzeit
  const g4 = szene().g; const r4 = Regie.fadenInvasion(g4, { ziel: 'zz99' });
  ok(!r4.ok && !('invasion:ger' in ws(g4).regie.letzte), 'eine abgelehnte Invasion setzt keine Abkühlzeit');
  // der Ausschnitt des Spielleiters zeigt sie nicht (Faden-Befehle sind nicht seine Sache)
  ok(!Object.keys((Regie.befehleFrei(g).abk) || {}).some((k) => /^invasion/.test(k)), 'befehle_frei im Ausschnitt des Spielleiters nennt die Abkühlzeit der Invasion nicht');
});

section('Warteschlange: Obergrenze für Faden-Befehle', () => {
  const MAX = RW.plan.wert.vorgemerkt_max + RW.plan.wert.faden_vorgemerkt_max;
  const t = szene(), g = t.g;
  const fuelle = (gg, k) => { for (let i = 0; i < k; i++) ws(gg).regie.vorgemerkt.push({ b: { typ: 'rueckzug', fraktion: 'rom', flotte: 1 }, ab: 99999 }); };
  fuelle(g, MAX);
  const vor = klon(ws(g).regie), f0 = funkAll(t).length;
  const r = Regie.fadenInvasion(g, { ziel: ZIEL });
  ok(!r.ok && /zu viele wartende Befehle/.test(r.grund) && gleich(ws(g).regie, vor) && funkAll(t).length === f0, 'Invasion bei voller Warteschlange (' + MAX + '): abgelehnt, nichts vorgemerkt (' + r.grund + ')');
  const s = Regie.fadenSabotage(g, Object.keys(z(g).hexe).find((c) => z(g).hexe[c].posten && z(g).hexe[c].besitzer === 'rom' && !z(g).hexe[c].crew) || ZIEL);
  ok(!s.ok && /zu viele wartende Befehle/.test(s.grund) && gleich(ws(g).regie, vor), 'Sprengung bei voller Warteschlange: abgelehnt (' + s.grund + ')');
  ok(logbuch(g).filter((e) => e.ausgang === 'abgelehnt' && /zu viele/.test((e.fehler || []).join())).length === 2, 'Logbuch: beide Ablehnungen stehen drin');
  // knapp darunter: angenommen, und der Weltstand ist schemagültig (kein Speicherfehler "passt nicht zum Format")
  const g2 = szene().g; fuelle(g2, MAX - 1);
  ok(Regie.fadenInvasion(g2, { ziel: ZIEL }).ok && ws(g2).regie.vorgemerkt.length === MAX, 'eine Stelle frei: angenommen, die Schlange hat genau ' + MAX + ' Einträge');
  const d = klon(Weltstand.capture(g2));
  ok(Weltstand.validate(d).length === 0, 'der Weltstand mit voller Schlange ist schemagültig' + Weltstand.validate(d).slice(0, 1).map((x) => ' – ' + x).join(''));
  // Leser: schneidet Faden-Befehle bei faden_vorgemerkt_max ab, die Summe passt immer ins Schema
  const viele = [];
  for (let i = 0; i < 20; i++) viele.push({ b: { typ: 'rueckzug', fraktion: 'rom', flotte: 1 }, ab: 5 });
  for (let i = 0; i < 20; i++) viele.push({ b: INV(1), ab: 5, w: 1 });
  const gl = Regie.lesen({ vorgemerkt: viele }, 50);
  ok(gl.vorgemerkt.length === MAX && gl.vorgemerkt.filter((e) => e.b.typ === 'invasion').length === RW.plan.wert.faden_vorgemerkt_max, 'Leser: höchstens ' + RW.plan.wert.vorgemerkt_max + ' Plan-Befehle plus ' + RW.plan.wert.faden_vorgemerkt_max + ' Faden-Befehle (' + gl.vorgemerkt.length + ')');
});

section('Weltstand: Speichern und Laden mit wartender Invasion', () => {
  const t = szene(), g = t.g;
  ok(!('regie' in klon(Weltstand.capture(g)).welt.sim), 'Ruhezustand: kein Block');
  const r = Regie.fadenInvasion(g, { ziel: ZIEL });
  tick(g);
  const d1 = klon(Weltstand.capture(g));
  const vg = d1.welt.sim.regie && d1.welt.sim.regie.vorgemerkt;
  ok(vg && vg.length === 1 && vg[0].b.typ === 'invasion' && vg[0].w === 1, 'Block welt.sim.regie: EIN wartender Befehl, angekündigt');
  ok(d1.welt.sim.regie.letzte && d1.welt.sim.regie.letzte['invasion:ger'] !== undefined, 'die Abkühlzeit steht im Block (letzte invasion:ger)');
  ok(Weltstand.validate(d1).length === 0, 'Weltstand schemagültig' + Weltstand.validate(d1).slice(0, 1).map((x) => ' – ' + x).join(''));
  const dir = F.freshDir(); d1.id = 'w-inv'; fs.writeFileSync(path.join(dir, 'w-inv.json'), JSON.stringify(d1));
  const t2 = F.neuesSpiel({ dir, world: 'w-inv' }), g2 = t2.g; g2.env = Object.assign({}, g2.env, SCHALTER);
  const nach = funkAll(t2).filter((m) => /Speculum/.test(m.text));
  ok(nach.length === 1 && nach[0].from === 'Oberkommando' && /Eine germanische Flotte wird verstärkt/.test(nach[0].text), 'Laden: die Invasion wird einmal erneut angekündigt, mit dem Invasions-Text (' + nach.length + ' Meldung)');
  ok(g2.phase === 'play' && g2.errors === 0 && gleich(ws(g2).regie.vorgemerkt, ws(g).regie.vorgemerkt), 'Laden: der wartende Befehl ist wieder da');
  ok(gleich(klon(Weltstand.capture(g2)).welt.sim.regie, d1.welt.sim.regie), 'Runde Speichern, Laden, Speichern: gleich');
  tick(g2);
  ok(funkAll(t2).filter((m) => /Speculum/.test(m.text)).length === 1, 'im laufenden Betrieb keine Doppelung');
  while (ws(g2).tickZahl < r.ab) tick(g2);
  ok(flotte(g2, r.flotte).hochgestuft === true && z(g2).angriffe.some((a) => a.befohlen && a.ziel === ZIEL) && ws(g2).fehler === 0, 'nach dem Laden: Hochstufen und Angriff gehen zur Zeit in die Sim');
  // hochgestuft im Sim-Zustand überlebt Speichern und Laden
  const d3 = klon(Weltstand.capture(g2)); d3.id = 'w-inv2'; fs.writeFileSync(path.join(dir, 'w-inv2.json'), JSON.stringify(d3));
  ok(d3.welt.sim.zustand.flotten.find((f) => f.id === r.flotte).hochgestuft === true && Weltstand.validate(d3).length === 0, 'hochgestuft steht im gespeicherten Sim-Zustand (schemagültig)');
  const g3 = F.neuesSpiel({ dir, world: 'w-inv2' }).g;
  ok(flotte(g3, r.flotte).hochgestuft === true && g3.errors === 0 && Math.abs(flotte(g3, r.flotte).staerke - flotte(g2, r.flotte).staerke) < NAH, 'Laden: hochgestuft und Stärke sind wieder da');
  const lauf = (gg) => { for (let i = 0; i < 25; i++) Kern.tick(z(gg)); return JSON.stringify(Kriegslage.abbild(z(gg))); };
  ok(lauf(g2) === lauf(g3), 'speichern, laden, 25 Ticks = ohne Speichern');
  ok(Kern.pruefeBefehl(z(g3), INV(r.flotte)).ok === false, 'nach dem Laden bleibt die Flotte hochgestuft: ein zweites Mal abgelehnt');
  // Altstand ohne Feld lädt unverändert
  const alt = klon(Weltstand.capture(szene().g)); alt.id = 'w-alt'; fs.writeFileSync(path.join(dir, 'w-alt.json'), JSON.stringify(alt));
  ok(!JSON.stringify(alt).includes('hochgestuft'), 'Altstand: kein Feld hochgestuft');
  const g4 = F.neuesSpiel({ dir, world: 'w-alt' }).g;
  ok(g4.phase === 'play' && g4.errors === 0 && !JSON.stringify(z(g4)).includes('hochgestuft'), 'Altstand ohne das Feld lädt unverändert');
  tick(g4, 3);
  ok(ws(g4).fehler === 0 && !JSON.stringify(z(g4)).includes('hochgestuft'), 'und tickt fehlerfrei, ohne Befehl erscheint das Feld nie');
  // Müll im Feld fällt weg
  const kaputt = klon(d3); kaputt.id = 'w-kaputt';
  kaputt.welt.sim.zustand.flotten.find((f) => f.fraktion === 'ger' && f.id !== r.flotte).hochgestuft = 'ja';
  kaputt.welt.sim.zustand.flotten.find((f) => f.fraktion === 'rom').hochgestuft = true;
  fs.writeFileSync(path.join(dir, 'w-kaputt.json'), JSON.stringify(kaputt));
  const g5 = F.neuesSpiel({ dir, world: 'w-kaputt' }).g;
  ok(g5.errors === 0 && z(g5).flotten.every((f) => f.hochgestuft === undefined || (f.hochgestuft === true && f.fraktion === 'ger')) && flotte(g5, r.flotte).hochgestuft === true, 'Müll im Feld (kein true, falsche Fraktion) fällt beim Laden weg, Gültiges bleibt');
});

section('Laden: erneute Ankündigung nur, wo die Wirkung noch kommt', () => {
  const t = szene(), g = t.g;
  Regie.fadenInvasion(g, { ziel: ZIEL });
  const d1 = klon(Weltstand.capture(g)); d1.id = 'w-inv-ziel';
  const dir = F.freshDir();
  // das Ziel gehört beim Laden nicht mehr Rom: keine erneute Ankündigung
  d1.welt.sim.zustand.hexe[ZIEL].besitzer = 'ger';
  fs.writeFileSync(path.join(dir, 'w-inv-ziel.json'), JSON.stringify(d1));
  const t2 = F.neuesSpiel({ dir, world: 'w-inv-ziel' });
  ok(t2.g.errors === 0 && funkAll(t2).filter((m) => /Speculum/.test(m.text)).length === 0, 'Ziel inzwischen germanisch: keine erneute Ankündigung nach dem Laden');
  // Gegenprobe: gehört es Rom, kommt sie (siehe Abschnitt Weltstand)
  const d2 = klon(Weltstand.capture(g)); d2.id = 'w-inv-rom'; fs.writeFileSync(path.join(dir, 'w-inv-rom.json'), JSON.stringify(d2));
  const t3 = F.neuesSpiel({ dir, world: 'w-inv-rom' });
  ok(funkAll(t3).filter((m) => /Speculum/.test(m.text)).length === 1, 'Gegenprobe: Ziel römisch, die Ankündigung kommt einmal');
  // direkt über die Funktion: eine Sabotage- und Angriffsmarke verhalten sich gleich (trifftRom)
  const g4 = szene().g; ws(g4).regie.vorgemerkt.push({ b: INV(erste(g4)), ab: 9, w: 1 }); z(g4).hexe[ZIEL].besitzer = 'ger';
  ok(Regie.vorwarnungenErneut(g4) === 0, 'vorwarnungenErneut: 0 Meldungen, wenn das Ziel nicht mehr Rom gehört');
});

// ---------- Mit aktiver Standard-KI über viele Seeds: nie ein halbes Wirken
// Der echte Kern, die Standard-KI plant mit (nichts abgeschaltet). Zu drei Ticks je Lauf wird eine Invasion angenommen; im Tick ab kann sie scheitern (Flotte nicht mehr bereit, zu schwach, Feldzug läuft).
// Halb wäre: eine Flotte ist nach dem Tick hochgestuft, ohne dass im selben Tick ein Befehl invasion angewandt wurde (oder umgekehrt). Der Test verlangt: 0 halbe, und dass es abgelehnte
// Invasionen im Tick wirklich gab (sonst belegt er nichts).
section('Standard-KI aktiv, viele Seeds: 0 halbe Invasionen', () => {
  const rng = (seed) => { let a = (seed ^ 0x51ED270B) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const { karte, werte } = Daten.laden();
  const st = { angenommen: 0, im_tick_gespielt: 0, im_tick_abgelehnt: 0, halb: 0, gruende: {} };
  const SEEDS = 24;
  for (let seed = 0; seed < SEEDS; seed++) {
    const r = rng(seed * 7919 + 17);
    let game = null, faellig = [], vorher = null;
    const befehle = (zz, i) => {
      if (!game) game = { weltsim: { zustand: zz, tickZahl: 0, ereignisse: [], regie: Regie.neu() }, emit() {}, countError() {}, worldsEnabled: false, env: {}, time: 0 };
      game.weltsim.tickZahl = i;
      const tk = i + 1, d = Kern.datenVon(zz);
      if ([60, 150, 240].includes(tk)) {
        let ziel = null;
        for (let k = 0; k < 6 && !ziel; k++) ziel = P3.invasionsZiel(game, d.codes[Math.floor(r() * d.codes.length)]);
        // Abkühlzeit außer Kraft für den Test: er prüft die Atomarität, nicht die Pause
        if (ziel) { delete game.weltsim.regie.letzte['invasion:ger']; if (Regie.fadenInvasion(game, { ziel }).ok) st.angenommen++; }
      }
      faellig = Regie.vorTick(game, tk);
      vorher = new Set(zz.flotten.filter((f) => f.hochgestuft === true).map((f) => f.id));
      return faellig.map((e) => e.b);
    };
    const nach = (zz, i, res) => {
      const bf = res.befehle || { angewandt: [], abgelehnt: [] };
      const angew = bf.angewandt.filter((b) => b.typ === 'invasion').map((b) => b.flotte).sort();
      const neu = zz.flotten.filter((f) => f.hochgestuft === true && !vorher.has(f.id)).map((f) => f.id).sort();
      if (JSON.stringify(angew) !== JSON.stringify(neu)) st.halb++;
      for (const b of bf.angewandt) if (b.typ === 'invasion') { st.im_tick_gespielt++; if (!zz.angriffe.some((a) => a.befohlen && a.ziel === b.ziel && a.von === 'ger' && a.flotten.includes(b.flotte))) st.halb++; }
      for (const x of bf.abgelehnt) if (x.befehl.typ === 'invasion') { st.im_tick_abgelehnt++; const k = x.grund.replace(/[0-9.]+/g, '#'); st.gruende[k] = (st.gruende[k] || 0) + 1; }
      if (faellig.length) Regie.nachTick(game, res, faellig, i + 1);
      game.weltsim.tickZahl = i + 1;
    };
    Kz.lauf({ karte, werte, seed, ticks: 300, befehle, nach });
  }
  console.log('       (' + SEEDS + ' Seeds: ' + JSON.stringify(st) + ')');
  ok(st.angenommen >= SEEDS && st.im_tick_gespielt > 0, 'Invasionen angenommen (' + st.angenommen + ') und gespielt (' + st.im_tick_gespielt + ')');
  ok(st.im_tick_abgelehnt > 0, 'der Fall "im Tick abgelehnt" kommt vor (' + st.im_tick_abgelehnt + '): der Test belegt etwas');
  ok(st.halb === 0, '0 halbe Invasionen (hochgestuft ohne Angriff im selben Tick, oder Angriff ohne Hochstufen): ' + st.halb);
});

section('Sim byte-gleich ohne Befehle', () => {
  for (const seed of [1, 2, 3]) {
    const a = F.neueSim(seed), b = F.neueSim(seed), c = F.neueSim(seed);
    for (let i = 0; i < 60; i++) { Kern.tick(a); Kern.tick(b, { befehle: [] }); Kern.tick(c, { befehle: [INV(999999)] }); }
    ok(JSON.stringify(a) === JSON.stringify(b), 'Seed ' + seed + ': mit leerer Befehlsliste byte-gleich zu ohne');
    ok(!JSON.stringify(a).includes('hochgestuft'), 'Seed ' + seed + ': ohne Befehl erscheint das Feld nie');
    ok(JSON.stringify(a) === JSON.stringify(c), 'Seed ' + seed + ': ein abgelehnter Befehl ändert nichts');
  }
});

console.log(`\n${n - fails} von ${n} Prüfungen bestanden`);
process.exit(fails ? 1 : 0);
