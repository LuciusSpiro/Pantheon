'use strict';
// FAD-01 B: Sim-Kern-Befehl flotte_hochstufen und die Invasion eines Fadens (server/weltsim/befehle.js, server/sim/regie-befehle.js fadenInvasion, Daten befehle-werte.json,
// regie-werte.json, lage-befehle.json). Direkt gegen die Game-Klasse, ohne Netz.
//   Hochstufen (+30 % exakt, über kap, einmalig, Ablehnungen, Fremdfelder) · nur aus Fäden (Plan des Spielleiters lehnt ab, nicht im Katalog des Spielleiters) · Invasion (Vormerken, nie halb,
//   Wahl der Flotte, Vorwarnung vor der Wirkung, Entwarnung) · Weltstand (Speichern/Laden, Altstand) · Sim ohne Befehle byte-gleich.
//   node tools/test-sim-befehl-invasion.js [begriff …]
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Weltstand = require('../server/weltstand.js');
const Kern = require('../server/weltsim/kern.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Regie = require('../server/sim/regie-befehle.js');
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
const HOCH = (id) => ({ typ: 'flotte_hochstufen', fraktion: 'ger', flotte: id });
const pruefe = (g, b) => Kern.pruefeBefehl(z(g), b);
const entw = (t, von) => funkAll(t).slice(von).map((m) => m.text).filter((x) => /Entwarnung/.test(x));

section('Daten', () => {
  const V = BW.flotte_hochstufen.wert;
  ok(V.staerke_zuwachs === 0.3 && V.fraktionen.join() === 'ger', 'Zuwachs 0,3 und Fraktion ger stehen in den Daten (befehle-werte.json)');
  ok(Number.isInteger(RW.vorwarnung.wert.vorlauf.invasion) && RW.vorwarnung.wert.vorlauf.invasion >= RW.vorwarnung.wert.mindest_vorlauf, 'Vorlauf der Invasion steht in regie-werte.json');
  ok(RW.abkuehlung.wert.flotte_hochstufen === 0, 'Abkühlzeit 0 (wie sabotage)');
  const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'flotte', 'lage-befehle.json'), 'utf8'));
  ok(T.vorwarnung.invasion && T.vorwarnung.invasion.sprecher === 'Oberkommando' && /\{ziel\}/.test(T.vorwarnung.invasion.text) && /\{n\}/.test(T.vorwarnung.invasion.text), 'Vorwarnung invasion: Oberkommando, Platzhalter ziel und n');
  ok(T.entwarnung.invasion && T.entwarnung.invasion.sprecher === 'Oberkommando' && /\{ziel\}/.test(T.entwarnung.invasion.text), 'Entwarnung invasion');
  const KAT = require('../content/welt/lage-katalog.json').befehle;
  ok(!('flotte_hochstufen' in KAT), 'nicht im Katalog des Lage-Spielleiters (lage-katalog.json)');
  ok(Object.keys(Kern.BEFEHLE.KATALOG).includes('flotte_hochstufen') && gleich(Kern.BEFEHLE.FELDER.flotte_hochstufen, ['typ', 'fraktion', 'flotte']), 'im Kern-Katalog, Felder typ, fraktion, flotte');
});

section('Hochstufen: +30 % exakt, über kap, einmalig', () => {
  const g = szene().g, fl = gerFlotten(g)[0];
  const alt = fl.staerke, kap = fl.kap;
  ok(alt === kap, 'Ausgangslage: Flotte voll (' + alt + ' von ' + kap + ')');
  ok(pruefe(g, HOCH(fl.id)).ok, 'Prüfer nimmt eine volle germanische Flotte an');
  Kern.tick(z(g), { befehle: [HOCH(fl.id)] });
  const f2 = flotte(g, fl.id);
  ok(Math.abs(f2.staerke - alt * 1.3) < NAH, 'Stärke steigt um genau 30 % (' + alt + ' -> ' + f2.staerke + ')');
  ok(f2.staerke > f2.kap, 'darf über kap gehen (kap ' + f2.kap + ')');
  ok(f2.hochgestuft === true, 'Flottenfeld hochgestuft: true');
  const r = pruefe(g, HOCH(fl.id));
  ok(!r.ok && /schon hochgestuft/.test(r.grund), 'zweites Hochstufen derselben Flotte abgelehnt (' + r.grund + ')');
  const st = flotte(g, fl.id).staerke;
  const res = Kern.tick(z(g), { befehle: [HOCH(fl.id)] });
  ok(res.befehle.abgelehnt.length === 1 && /schon hochgestuft/.test(res.befehle.abgelehnt[0].grund), 'auch im Tick abgelehnt, nie halb gespielt');
  ok(flotte(g, fl.id).staerke <= st + NAH, 'die Stärke steigt kein zweites Mal');
  // geschwächte Flotte: +30 % der AKTUELLEN Stärke
  const g2 = szene().g, f3 = gerFlotten(g2)[0]; f3.staerke = f3.kap * 0.5;
  const kontrolle = klon(z(g2)); kontrolle.werte = z(g2).werte; kontrolle.karte = z(g2).karte;
  Kern.tick(kontrolle);   // dieselbe Wirtschaft ohne Befehl (die Wirtschaft des Ticks läuft vor dem Befehl)
  Kern.tick(z(g2), { befehle: [HOCH(f3.id)] });
  const s1 = kontrolle.flotten.find((f) => f.id === f3.id).staerke;
  ok(s1 < f3.kap && Math.abs(flotte(g2, f3.id).staerke - s1 * 1.3) < NAH, 'bei geschwächter Flotte: +30 % der aktuellen Stärke (' + s1.toFixed(3) + ' -> ' + flotte(g2, f3.id).staerke.toFixed(3) + ')');
  ok(gerFlotten(g).filter((x) => x.id !== fl.id).every((x) => !('hochgestuft' in x)), 'andere Flotten tragen das Feld nicht');
});

section('Hochstufen: Prüfer lehnt ab, Fremdfelder', () => {
  const g = szene().g, fl = gerFlotten(g)[0];
  const rom = z(g).flotten.find((f) => f.fraktion === 'rom'), kon = z(g).flotten.find((f) => f.fraktion === 'kon'), pirat = z(g).flotten.find((f) => f.fraktion === 'pirat');
  for (const [b, re, was] of [
    [HOCH(99999), /unbekannte Flotte/, 'unbekannte Flotte'],
    [{ typ: 'flotte_hochstufen', fraktion: 'ger' }, /unbekannte Flotte/, 'ohne Flotte'],
    [{ typ: 'flotte_hochstufen', fraktion: 'ger', flotte: '1' }, /unbekannte Flotte/, 'Flotte als Text'],
    [{ typ: 'flotte_hochstufen', fraktion: 'rom', flotte: rom.id }, /fraktion muss ger/, 'Rom als Fraktion'],
    [{ typ: 'flotte_hochstufen', fraktion: 'ger', flotte: rom.id }, /gehört nicht zu ger/, 'römische Flotte'],
    [{ typ: 'flotte_hochstufen', fraktion: 'ger', flotte: kon.id }, /gehört nicht zu ger/, 'Flotte des Konkordats'],
    [{ typ: 'flotte_hochstufen', fraktion: 'ger', flotte: pirat.id }, /gehört nicht zu ger/, 'Piratenflotte'],
    [Object.assign(HOCH(fl.id), { staerke: 99 }), /unbekanntes Feld "staerke"/, 'Fremdfeld staerke'],
    [Object.assign(HOCH(fl.id), { zuwachs: 1 }), /unbekanntes Feld "zuwachs"/, 'Fremdfeld zuwachs'],
    [Object.assign(HOCH(fl.id), { ziel: ZIEL }), /unbekanntes Feld "ziel"/, 'Fremdfeld ziel'],
  ]) { const r = pruefe(g, b); ok(!r.ok && re.test(r.grund), 'abgelehnt: ' + was + ' (' + r.grund + ')'); }
  // Mietflotte: eine Flotte des Konkordats, an Germanen vermietet
  const mf = flotte(g, kon.id);
  mf.miete = { von: 'kon', an: 'ger', bis: z(g).tick + 10, preis: 1 }; mf.fraktion = 'ger';
  const rm = pruefe(g, HOCH(kon.id));
  ok(!rm.ok && /Mietflotten/.test(rm.grund), 'abgelehnt: Mietflotte (' + rm.grund + ')');
  // Krieg aus
  const alt = z(g).werte.war; z(g).werte.war = false;
  const rk = pruefe(g, HOCH(fl.id));
  z(g).werte.war = alt;
  ok(!rk.ok && /Krieg ist aus/.test(rk.grund), 'abgelehnt: Krieg aus (' + rk.grund + ')');
  ok(pruefe(g, HOCH(fl.id)).ok, 'Gegenprobe: die gültige Flotte wird angenommen');
});

section('Hochstufen versorgt die Fraktion (vorrat_auffuellen)', () => {
  const stufeHoch = (gg, ff) => Kern.BEFEHLE.KATALOG.flotte_hochstufen.anwenden({ z: z(gg) }, HOCH(ff.id));   // genau der Befehl, ohne Tick (der erzeugt und verbraucht Vorrat)
  const A = BW.angreifen.wert, V = BW.flotte_hochstufen.wert;
  ok(V.vorrat_auffuellen === true, 'Schalter vorrat_auffuellen steht in den Daten (befehle-werte.json), die Zahlen sind die von angreifen (min_treibstoff ' + A.min_treibstoff + ', min_munition ' + A.min_munition + ')');
  // unter dem Minimum: wird auf das Minimum gehoben, genau darauf (nicht darüber)
  const g = szene().g, fl = gerFlotten(g)[0];
  z(g).vorrat.ger.T = 3; z(g).vorrat.ger.U = 4; z(g).vorrat.rom.T = 2; z(g).vorrat.rom.U = 1; const kon = JSON.stringify(z(g).vorrat.kon);
  stufeHoch(g, fl);
  ok(z(g).vorrat.ger.T === A.min_treibstoff && z(g).vorrat.ger.U === A.min_munition, 'Vorrat unter Minimum: T und U genau auf angreifen.min_* gehoben (T ' + z(g).vorrat.ger.T + ', U ' + z(g).vorrat.ger.U + ')');
  ok(z(g).vorrat.rom.T === 2 && z(g).vorrat.rom.U === 1 && JSON.stringify(z(g).vorrat.kon) === kon, 'nur der Vorrat der Fraktion der Flotte, Rom und Konkordat unberührt');
  // nur ein Gut darunter: das andere bleibt
  const g2 = szene().g, f2 = gerFlotten(g2)[0];
  z(g2).vorrat.ger.T = A.min_treibstoff - 1; z(g2).vorrat.ger.U = 77;
  stufeHoch(g2, f2);
  ok(z(g2).vorrat.ger.T === A.min_treibstoff && z(g2).vorrat.ger.U === 77, 'nur Treibstoff darunter: T gehoben, U (77) bleibt');
  // nie absenken: Vorrat darüber und genau auf dem Minimum bleibt
  const g3 = szene().g, f3 = gerFlotten(g3)[0];
  z(g3).vorrat.ger.T = 55; z(g3).vorrat.ger.U = A.min_munition;
  stufeHoch(g3, f3);
  ok(z(g3).vorrat.ger.T === 55 && z(g3).vorrat.ger.U === A.min_munition, 'Vorrat darüber/auf dem Minimum: nie abgesenkt (T 55, U ' + A.min_munition + ')');
  // der Angriff direkt danach: ohne Hochstufen abgelehnt, mit Hochstufen davor (filtereBefehle, wie fadenInvasion) angenommen
  const g4 = szene().g, f4 = flotte(g4, Kern.BEFEHLE.angriffsflotten(z(g4), 'ger', ZIEL)[0]);
  z(g4).vorrat.ger.T = 3; z(g4).vorrat.ger.U = 4;
  const ang = { typ: 'angreifen', fraktion: 'ger', ziel: ZIEL, flotten: [f4.id] };
  const r0 = pruefe(g4, ang);
  ok(!r0.ok && /Munition oder Treibstoff unter/.test(r0.grund), 'ohne Hochstufen weiterhin abgelehnt (' + r0.grund + ')');
  const fi = Kern.filtereBefehle(z(g4), [HOCH(f4.id), ang]);
  ok(fi.gueltig.length === 2 && fi.verworfen.length === 0, 'Hochstufen zuerst: der Angriff direkt danach ist gültig (' + fi.verworfen.map((x) => x.grund).join() + ')');
  const fi2 = Kern.filtereBefehle(z(g4), [ang, HOCH(f4.id)]);
  ok(fi2.verworfen.length === 1 && fi2.verworfen[0].befehl.typ === 'angreifen', 'Gegenprobe: Angriff vor dem Hochstufen wird verworfen');
  ok(z(g4).vorrat.ger.T === 3 && z(g4).vorrat.ger.U === 4, 'die Prüfung auf der Kopie lässt den echten Vorrat unberührt');
  const r = Regie.fadenInvasion(g4, { ziel: ZIEL, flotte: f4.id });
  ok(r.ok, 'Invasion mit leerem Vorrat (T 3, U 4) wird angenommen (' + (r.grund || 'angenommen') + ')');
  // Wirkung zu Tick ab: beide Befehle angewendet, der Angriff läuft (Flotte bricht auf)
  const vg = ws(g4).regie.vorgemerkt;
  ok(vg.length === 2, 'zwei Befehle vorgemerkt');
  tick(g4, vg[0].ab - ws(g4).tickZahl + 1);
  ok(flotte(g4, f4.id).hochgestuft === true, 'zur Wirkung: Flotte hochgestuft');
  ok(z(g4).vorrat.ger.T >= 0 && z(g4).vorrat.ger.U >= 0, 'danach kein negativer Vorrat');
});

section('Nur aus Fäden: der Plan des Spielleiters kann ihn nicht setzen', () => {
  const t = szene(), g = t.g, fl = gerFlotten(g)[0];
  const r = Regie.planAnwenden(g, { befehle: [HOCH(fl.id)] });
  ok(r.ok && r.angenommen.length === 0 && r.abgelehnt.length === 1 && /nur aus einem Faden/.test(r.abgelehnt[0].grund), 'Plan: flotte_hochstufen abgelehnt, Grund "nur aus einem Faden" (' + (r.abgelehnt[0] && r.abgelehnt[0].grund) + ')');
  ok(ws(g).regie.vorgemerkt.length === 0, 'nichts vorgemerkt');
  const p = Regie.planPruefen(g, { befehle: [HOCH(fl.id)] });
  ok(p.angenommen.length === 0 && p.abgelehnt.length === 1, 'auch der Probelauf lehnt ab');
  ok(logbuch(g).some((e) => e.ausgang === 'abgelehnt' && e.key === 'flotte_hochstufen'), 'Logbuch: abgelehnt');
  const Prompt = require('../server/sim/lage-prompt.js');
  ok(!/- flotte_hochstufen \{/.test(Prompt.katalogText()), 'der Prompt des Spielleiters beschreibt den Befehl nicht');
});

section('Invasion: vormerken, Reihenfolge, nie halb', () => {
  const t = szene(), g = t.g, n0 = ws(g).tickZahl;
  const kand = Kern.BEFEHLE.angriffsflotten(z(g), 'ger', ZIEL);
  const r = Regie.fadenInvasion(g, { ziel: ZIEL });
  ok(r.ok && r.ziel === ZIEL && Number.isInteger(r.flotte) && r.ab === n0 + 1 + RW.vorwarnung.wert.vorlauf.invasion, 'Invasion angenommen, ab nach dem Vorlauf aus den Daten (ab ' + r.ab + ', jetzt ' + n0 + ')');
  const vg = ws(g).regie.vorgemerkt;
  ok(vg.length === 2 && vg[0].b.typ === 'flotte_hochstufen' && vg[1].b.typ === 'angreifen' && vg[0].ab === vg[1].ab, 'zwei Befehle in der Reihenfolge Hochstufen, Angreifen mit demselben ab');
  ok(vg[1].b.flotten.length === 1 && vg[1].b.flotten[0] === r.flotte && vg[0].b.flotte === r.flotte && vg[1].b.ziel === ZIEL, 'beide nennen dieselbe Flotte und das Ziel');
  ok(kand.length > 0 && kand[0] === r.flotte && flotte(g, r.flotte).staerke === Math.max(...kand.map((id) => flotte(g, id).staerke)), 'gewählt wurde die stärkste bereite germanische Flotte in Reichweite');
  ok(Object.keys(ws(g).regie.letzte).length === 0 && ws(g).regie.rate.length === 0, 'keine Abkühlzeit, kein Rate-Platz');
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
  const t3 = szene(), g3 = t3.g, f0 = flotte(g3, Kern.BEFEHLE.angriffsflotten(z(g3), 'ger', ZIEL)[0]);
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
  const g = szene().g, fl = flotte(g, Kern.BEFEHLE.angriffsflotten(z(g), 'ger', ZIEL)[0]);
  abwehrSetzen(g, fl.staerke * 1.05 / z(g).werte.attack_ratio);
  const ang = { typ: 'angreifen', fraktion: 'ger', ziel: ZIEL, flotten: [fl.id] };
  const r0 = pruefe(g, ang);
  ok(!r0.ok && /zu schwach/.test(r0.grund), 'Ausgangslage: der Angriff allein ist zu schwach (' + r0.grund + ')');
  const r = Regie.fadenInvasion(g, { ziel: ZIEL, flotte: fl.id });
  ok(r.ok, 'mit Hochstufen davor ist die Invasion gültig, "zu schwach" entfällt (' + (r.grund || 'angenommen') + ')');
  // Gegenprobe: ist auch die hochgestufte Flotte zu schwach, wird die Invasion abgelehnt und nichts vorgemerkt
  const g2 = szene().g, f2 = flotte(g2, Kern.BEFEHLE.angriffsflotten(z(g2), 'ger', ZIEL)[0]);
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
  ok(logbuch(g).filter((e) => e.ausgang === 'gespielt').map((e) => e.key).join() === 'flotte_hochstufen,angreifen', 'Logbuch: gespielt, erst Hochstufen, dann Angreifen');
});

section('Invasion: Entwarnung', () => {
  // im Tick abgelehnt (Angriff nicht mehr zu schaffen)
  const t = szene(), g = t.g, r = Regie.fadenInvasion(g, { ziel: ZIEL }), f0 = funkAll(t).length;
  z(g).werte = Object.assign({}, z(g).werte, { war: false });   // der Krieg endet bis zur Wirkung (der Vorrat kann es nicht sein: das Hochstufen füllt ihn auf)
  while (ws(g).tickZahl < r.ab) tick(g);
  ok(entw(t, f0).length === 1 && /Speculum/.test(entw(t, f0)[0]) && /Invasion/.test(entw(t, f0)[0]), 'im Tick abgelehnt: genau eine Entwarnung, Invasions-Text');
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
  ok(faellig.length === 2, 'beide Befehle sind im Tick ab fällig');
  Regie.tickGescheitert(g3, faellig, r3.ab);
  ok(entw(t3, v3).length === 1 && /Invasion/.test(entw(t3, v3)[0]) && ws(g3).regie.vorgemerkt.length === 0, 'Tick gescheitert: genau eine Entwarnung, beide Befehle verworfen');
});

section('Weltstand: Speichern und Laden mit wartender Invasion', () => {
  const t = szene(), g = t.g;
  ok(!('regie' in klon(Weltstand.capture(g)).welt.sim), 'Ruhezustand: kein Block');
  const r = Regie.fadenInvasion(g, { ziel: ZIEL });
  tick(g);
  const d1 = klon(Weltstand.capture(g));
  const vg = d1.welt.sim.regie && d1.welt.sim.regie.vorgemerkt;
  ok(vg && vg.length === 2 && vg[0].b.typ === 'flotte_hochstufen' && vg[1].b.typ === 'angreifen' && vg[1].w === 2 && !('w' in vg[0]), 'Block welt.sim.regie: zwei wartende Befehle, der Angriff trägt w 2');
  ok(Weltstand.validate(d1).length === 0, 'Weltstand schemagültig' + Weltstand.validate(d1).slice(0, 1).map((x) => ' – ' + x).join(''));
  const dir = F.freshDir(); d1.id = 'w-inv'; fs.writeFileSync(path.join(dir, 'w-inv.json'), JSON.stringify(d1));
  const t2 = F.neuesSpiel({ dir, world: 'w-inv' }), g2 = t2.g; g2.env = Object.assign({}, g2.env, SCHALTER);
  const nach = funkAll(t2).filter((m) => /Speculum/.test(m.text));
  ok(nach.length === 1 && nach[0].from === 'Oberkommando' && /Eine germanische Flotte wird verstärkt/.test(nach[0].text), 'Laden: die Invasion wird einmal erneut angekündigt, mit dem Invasions-Text (' + nach.length + ' Meldung)');
  ok(g2.phase === 'play' && g2.errors === 0 && gleich(ws(g2).regie.vorgemerkt, ws(g).regie.vorgemerkt), 'Laden: beide wartenden Befehle sind wieder da (w 2 erhalten)');
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
  ok(Regie.fadenInvasion(g3, { ziel: ZIEL, flotte: r.flotte }).ok === false, 'nach dem Laden bleibt die Flotte hochgestuft: ein zweites Mal abgelehnt');
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
  // Leser: die zwei Befehle der Invasion zählen nicht in vorgemerkt_max
  const voll = [];
  for (let i = 0; i < RW.plan.wert.vorgemerkt_max; i++) voll.push({ b: { typ: 'rueckzug', fraktion: 'rom', flotte: 1 }, ab: 5 });
  const gl = Regie.lesen({ vorgemerkt: voll.concat([{ b: HOCH(1), ab: 6 }, { b: { typ: 'angreifen', fraktion: 'ger', ziel: ZIEL, flotten: [1] }, ab: 6, w: 2 }]) }, 50);
  ok(gl.vorgemerkt.length === RW.plan.wert.vorgemerkt_max + 2 && gl.vorgemerkt[gl.vorgemerkt.length - 1].w === 2, 'Leser: die zwei Invasionsbefehle werden nie abgeschnitten, w 2 bleibt');
});

section('Sim byte-gleich ohne Befehle', () => {
  for (const seed of [1, 2, 3]) {
    const a = F.neueSim(seed), b = F.neueSim(seed), c = F.neueSim(seed);
    for (let i = 0; i < 60; i++) { Kern.tick(a); Kern.tick(b, { befehle: [] }); Kern.tick(c, { befehle: [HOCH(999999)] }); }
    ok(JSON.stringify(a) === JSON.stringify(b), 'Seed ' + seed + ': mit leerer Befehlsliste byte-gleich zu ohne');
    ok(!JSON.stringify(a).includes('hochgestuft'), 'Seed ' + seed + ': ohne Befehl erscheint das Feld nie');
    ok(JSON.stringify(a) === JSON.stringify(c), 'Seed ' + seed + ': ein abgelehnter Befehl ändert nichts');
  }
});

console.log(`\n${n - fails} von ${n} Prüfungen bestanden`);
process.exit(fails ? 1 : 0);
