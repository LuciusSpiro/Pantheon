'use strict';
// SUND-03 D: Wiederholungsregeln der Pläne des Lage-Spielleiters (server/sim/lage-wiederholung.js, Anschluss in lage-spielleiter.js). Regel: Dieselbe Umsetzung kommt nie zweimal in Folge und nie
// mit demselben Parametersatz (gleicher Befehlstyp UND gleiche Felder wie in einem der letzten `fenster_plaene` Pläne wird mit Grund „Wiederholung“ abgelehnt, im Regie-Logbuch). Ausnahmen sind Daten.
//   Daten · Regel im Einzelnen (Reine Funktionen) · Anschluss im Spielleiter (Logbuch, Prompt unverändert) · viele Planungsrunden (Zufalls-Plan-Quelle, Mock-Regisseur)        node tools/test-lage-wiederholung.js
const F = require('./regie-fixture.js');
const Kern = require('../server/weltsim/kern.js');
const Regie = require('../server/sim/regie-befehle.js');
const Prompt = require('../server/sim/lage-prompt.js');
const Mock = require('../server/sim/lage-mock.js');
const LageSL = require('../server/sim/lage-spielleiter.js');
const WH = require('../server/sim/lage-wiederholung.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const W = LageSL.WERTE;
const ws = (g) => g.weltsim;
const kat = Object.keys(Kern.BEFEHLE.KATALOG);

section('Daten', () => {
  const w = W.wiederholung;
  ok(Number.isInteger(w.fenster_plaene) && w.fenster_plaene >= 1 && w.fenster_plaene <= 10, `Fenster: die letzten ${w.fenster_plaene} Pläne`);
  ok(Array.isArray(w.ausnahmen) && w.ausnahmen.every((a) => kat.includes(a)), `Ausnahmen (${w.ausnahmen.join(', ')}) sind Befehlstypen des Katalogs`);
  ok(W.letzte_plaene >= 1 && w.fenster_plaene >= 1, 'der Prompt-Teil letzte_plaene hat seine eigene Größe (unverändert)');
});

section('Regel im Einzelnen', () => {
  const werte = { wiederholung: { fenster_plaene: 3, ausnahmen: ['fokus', 'regler'] } };
  const nach = (an, gut, menge) => ({ typ: 'nachschub', an, gut, menge });
  const v1 = [[WH.satzVon(nach('rom', 'T', 2))]];
  let r = WH.pruefen({ befehle: [nach('rom', 'T', 2)], begruendung: 'x' }, v1, werte);
  ok(r.plan.befehle.length === 0 && r.abgelehnt.length === 1 && /^Wiederholung/.test(r.abgelehnt[0].grund), 'gleicher Typ und gleicher Parametersatz wie im letzten Plan: abgelehnt, Grund „Wiederholung“');
  ok(r.plan.begruendung === 'x', 'der Rest des Plans bleibt');
  r = WH.pruefen({ befehle: [nach('ger', 'T', 2), nach('rom', 'U', 2)] }, v1, werte);
  ok(r.abgelehnt.length === 0 && r.plan.befehle.length === 2, 'derselbe Typ mit anderem Ziel (Fraktion, Gut): erlaubt');
  r = WH.pruefen({ befehle: [nach('rom', 'T', 3)] }, v1, werte);
  ok(r.abgelehnt.length === 1, 'nur die Menge geändert: dieselbe Umsetzung, abgelehnt');
  const emb = (waren, dauer) => ({ typ: 'embargo', von: 'kon', gegen: 'rom', waren, dauer });
  ok(WH.pruefen({ befehle: [emb(['M'], 11)] }, [[WH.satzVon(emb(['M'], 10))]], werte).abgelehnt.length === 1, 'Dauer 10 gegen 11: dieselbe Umsetzung (die Dauer gehört nicht zum Schlüssel)');
  ok(WH.satzVon(emb(['M', 'T'], 6)) === WH.satzVon(emb(['T', 'M'], 6)) && WH.satzVon(emb(['M'], 6)) !== WH.satzVon(emb(['T'], 6)), 'Waren sind eine Menge: [M,T] gleich [T,M], aber M ungleich T');
  const sold = (flotten) => ({ typ: 'soeldner', von: 'kon', an: 'rom', flotten, dauer: 6 });
  ok(WH.satzVon(sold([3, 5])) === WH.satzVon(sold([5, 3])) && WH.satzVon(sold([3])) !== WH.satzVon(sold([3, 5])), 'Flotten sind eine Menge: [3,5] gleich [5,3]');
  // nie zweimal in Folge, auch ohne Fenster
  ok(WH.pruefen({ befehle: [nach('rom', 'T', 2)] }, v1, { wiederholung: { fenster_plaene: 0, ausnahmen: [] } }).abgelehnt.length === 1 && WH.pruefen({ befehle: [nach('rom', 'T', 2)] }, [v1[0], []], { wiederholung: { fenster_plaene: 0, ausnahmen: [] } }).abgelehnt.length === 0, 'Stufe 1: der unmittelbar letzte Plan gilt immer (auch mit Fenster 0), davor nicht');
  ok(WH.satzVon({ typ: 'nachschub', menge: 2, gut: 'T', an: 'rom' }) === WH.satzVon(nach('rom', 'T', 2)), 'der Satz hängt nicht von der Reihenfolge der Felder ab');
  const gleich = { befehle: [nach('rom', 'U', 1)] };
  ok(WH.pruefen(gleich, [[]], werte).plan === gleich, 'ohne Treffer kommt derselbe Plan zurück (dasselbe Objekt)');
  const verlauf = [[WH.satzVon(nach('rom', 'T', 2))], [], [], []];
  ok(WH.pruefen({ befehle: [nach('rom', 'T', 2)] }, verlauf, werte).abgelehnt.length === 0, 'außerhalb des Fensters (die letzten drei Pläne) ist die Umsetzung wieder erlaubt');
  ok(WH.pruefen({ befehle: [nach('rom', 'T', 2)] }, verlauf.slice(1), werte).abgelehnt.length === 0 && WH.pruefen({ befehle: [nach('rom', 'T', 2)] }, verlauf.slice(0, 3), werte).abgelehnt.length === 1, 'Fenstergrenze genau: im dritten zurückliegenden Plan noch verboten');
  // Ausnahmen: Regler nachstellen
  const reg = { typ: 'regler', fraktion: 'ger', aggr: 0.5, dauer: 8 };
  r = WH.pruefen({ befehle: [reg] }, [[WH.satzVon(reg)]], werte);
  ok(r.abgelehnt.length === 0, 'Ausnahme regler (Daten): darf nachgestellt werden');
  r = WH.pruefen({ befehle: [reg] }, [[WH.satzVon(reg)]], { wiederholung: { fenster_plaene: 3, ausnahmen: [] } });
  ok(r.abgelehnt.length === 1, 'ohne die Ausnahme in den Daten gilt die Regel auch für regler');
  // Plan-Fokus
  const fok = { hex: '0305', radius: 2, fraktionen: ['rom', 'ger'] };
  r = WH.pruefen({ befehle: [], fokus: fok }, [[WH.fokusSatz({ hex: '0305', radius: 2, fraktionen: ['ger', 'rom'] })]], { wiederholung: { fenster_plaene: 3, ausnahmen: [] } });
  ok(r.abgelehnt.length === 1 && r.abgelehnt[0].befehl.typ === 'fokus' && !('fokus' in r.plan), 'derselbe Plan-Fokus (Fraktionen in anderer Reihenfolge) ohne Ausnahme: abgelehnt, aus dem Plan genommen');
  r = WH.pruefen({ befehle: [], fokus: { hex: '0306', radius: 2, fraktionen: ['rom', 'ger'] } }, [[WH.fokusSatz(fok)]], { wiederholung: { fenster_plaene: 3, ausnahmen: [] } });
  ok(r.abgelehnt.length === 0, 'anderer Hex: kein Treffer');
  r = WH.pruefen({ befehle: [], fokus: { hex: '0305', radius: 3, dauer: 9, fraktionen: ['rom', 'ger'] } }, [[WH.fokusSatz(fok)]], { wiederholung: { fenster_plaene: 3, ausnahmen: [] } });
  ok(r.abgelehnt.length === 1, 'anderer Radius oder andere Dauer: dieselbe Umsetzung');
  ok(WH.pruefen({ befehle: [], fokus: fok }, [[WH.fokusSatz(fok)]], werte).abgelehnt.length === 0, 'Ausnahme fokus (Daten): darf nachgestellt werden');
  // Müll geht durch (die Plan-Prüfung der Regie lehnt ihn ab)
  r = WH.pruefen({ befehle: ['x', null, { typ: 5 }, nach('rom', 'T', 2)] }, v1, werte);
  ok(r.plan.befehle.length === 3 && r.abgelehnt.length === 1, 'Müll in der Liste bleibt für die Plan-Prüfung stehen, nur die Wiederholung fällt heraus');
  ok(WH.pruefen('kein Plan', v1, werte).plan === 'kein Plan' && WH.pruefen({ befehle: [nach('rom', 'T', 2)] }, null, werte).abgelehnt.length === 0, 'kein Objekt oder kein Verlauf: nichts');
  const p2 = { befehle: [nach('rom', 'T', 2), nach('ger', 'T', 2)] };
  const ve = WH.verlaufEintrag(p2, { abgelehnt: [{ befehl: p2.befehle[0] }], angenommen: [] });
  ok(ve.length === 1 && ve[0] === WH.satzVon(p2.befehle[1]), 'Verlauf: nur die Befehle des Plans, die die Regie nicht ablehnte');
});

// Spielleiter-Anschluss: ein Plan als Antwort, ohne Netz (der Pfad nach der Antwort ist derselbe wie im Betrieb)
function spielleiter(g) {
  const sl = LageSL.create(g, { mode: 'mock', env: { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } });
  let nr = 0;
  sl.runde = (plan, grenze) => {
    nr++;
    const bevor = ws(g).regie.vorgemerkt.length;
    sl.antwort({ token: nr, art: grenze || 'andocken', nr, startTick: ws(g).tickZahl, bau: {} }, { text: typeof plan === 'string' ? plan : JSON.stringify(plan), tokens: 0 });
    return { nr, neu: ws(g).regie.vorgemerkt.length - bevor };
  };
  return sl;
}
const logbuch = (g) => g.lageRegie.log.entries.filter((e) => e.art === 'lage_befehl');

section('Anschluss im Lage-Spielleiter', () => {
  const g = F.neuesSpiel({ crew: 3, names: ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'], seed: 5 }).g;
  const sl = spielleiter(g);
  ws(g).zustand.marken.rom = 500; ws(g).zustand.marken.ger = 500;
  const plan = { befehle: [{ typ: 'nachschub', an: 'ger', gut: 'T', menge: 2 }], begruendung: 'Test' };
  sl.runde(plan);
  const r1 = ws(g).regie.vorgemerkt.length;
  ws(g).regie.letzte = {};   // die Abkühlzeit der Regie ist hier nicht das Thema
  sl.runde(plan);
  const wh = logbuch(g).filter((e) => (e.fehler || []).some((x) => /^Wiederholung/.test(x)));
  ok(r1 === 1 && ws(g).regie.vorgemerkt.length === 1, 'der erste Plan wird angenommen, derselbe Plan danach nicht noch einmal');
  ok(wh.length === 1 && wh[0].ausgang === 'abgelehnt' && wh[0].key === 'nachschub' && wh[0].plan.typ === 'nachschub', 'die Wiederholung steht mit Grund im Regie-Logbuch (art lage_befehl, ausgang abgelehnt, fehler „Wiederholung: …“)');
  ok(sl.zaehler.angewandt === 1 && sl.zaehler.wirkungslos === 1 && sl.zaehler.fehler === 0, 'der Plan, dessen einziger Befehl als Wiederholung herausfällt, ist plan_wirkungslos (SUND-03 F), kein Fehler, kein Rückfall');
  const letzte = sl.letzte_plaene;
  ok(letzte.length === 2 && JSON.stringify(Object.keys(letzte[1]).sort()) === JSON.stringify(['abgelehnt', 'angenommen', 'befehle', 'begruendung', 'grenze', 'nr', 'tick']) && letzte[1].angenommen === 0 && letzte[1].abgelehnt === 1, 'letzte_plaene: dieselben Felder wie vorher (der Prompt-Teil bleibt), abgelehnt zählt die Wiederholung mit');
  const p = Prompt.baue(g, { art: 'andocken', nr: 3, letzte, werte: W }).prompt;
  ok(/<letzte_plaene>\n\[/.test(p) && !/sig|schluessel|nachschub:\{/.test(p.slice(p.indexOf('<letzte_plaene>'))) && /abgelehnt \(Wiederholung/.test(p.slice(p.indexOf('<letzte_plaene>'))), 'der Prompt-Teil <letzte_plaene> trägt keine Schlüssel der Wiederholungsregeln, aber das Ergebnis je Befehl mit Kurzgrund (SUND-03 F)');
  // anderer Parametersatz geht
  ws(g).regie.letzte = {};
  sl.runde({ befehle: [{ typ: 'nachschub', an: 'ger', gut: 'U', menge: 2 }] });
  ok(ws(g).regie.vorgemerkt.length === 2, 'anderes Gut im dritten Plan: angenommen');
  // der Verlauf steht im Weltstand: Laden hebelt die Regel nicht aus
  const Weltstand = require('../server/weltstand.js');
  g.env = Object.assign({}, g.env, { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' });   // SUND-03 F2: der Block regie steht nur mit Schalter im Stand
  const d = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  ok(Array.isArray(d.welt.sim.regie.verlauf) && d.welt.sim.regie.verlauf.length === 3 && Weltstand.validate(d).length === 0, 'welt.sim.regie.verlauf: gespeichert, schemagültig (' + Weltstand.validate(d).slice(0, 1) + ')');
  const fs = require('fs'); const path = require('path'); const dir = F.freshDir(); d.id = 'w-wh'; fs.writeFileSync(path.join(dir, 'w-wh.json'), JSON.stringify(d));
  const g2 = F.neuesSpiel({ dir, world: 'w-wh' }).g; ws(g2).zustand.marken.ger = 500; ws(g2).zustand.marken.rom = 500;
  const sl2 = spielleiter(g2);
  ok(JSON.stringify(ws(g2).regie.verlauf) === JSON.stringify(ws(g).regie.verlauf), 'Laden: derselbe Verlauf');
  ws(g2).regie.letzte = {}; ws(g2).regie.rate = [];
  sl2.runde({ befehle: [{ typ: 'nachschub', an: 'ger', gut: 'U', menge: 7 }] });
  ok(logbuch(g2).some((e) => (e.fehler || []).some((x) => /^Wiederholung: nachschub/.test(x))), 'nach dem Laden wird dieselbe Umsetzung (nur andere Menge) weiter als Wiederholung abgelehnt');
  sl2.dispose();
  const fe = Regie.lesen({ verlauf: [['ok'], 'x', [5, 'a'.repeat(500), 'gut']].concat(Array.from({ length: 30 }, () => ['a'])) }, 5);
  ok(fe.verlauf.length === 10 && fe.verlauf.every((p) => p.every((x) => typeof x === 'string' && x.length <= 160)) && Regie.lesen(null, 0).verlauf.length === 0, 'Leser: Müll fällt weg, höchstens 10 Pläne, Schlüssel ≤ 160 Zeichen');
  sl.dispose();
});

// Viele Planungsrunden: Invariante über alle angenommenen Befehle
function messe(g, sl, plaene, o) {
  const orig = Regie.planAnwenden; const runden = [];
  Regie.planAnwenden = function (game, plan) { const res = orig.apply(this, arguments); runden.push({ plan, res }); return res; };
  let wh = 0;
  const pruefenEcht = WH.pruefen;
  WH.pruefen = function () { const r = pruefenEcht.apply(this, arguments); wh += r.abgelehnt.length; return r; };   // gezählt wird hier (das Logbuch im Speicher hält nur die letzten 200 Einträge)
  try {
    plaene.forEach((p, i) => {
      if (o && o.vorher) o.vorher(i);
      Regie.verwerfe(g); ws(g).regie.letzte = {}; ws(g).regie.rate = [];   // Abkühlzeit, globale Befehlsrate (A3) und Warteschlange der Regie sind hier nicht das Thema, nur die Wiederholung
      sl.runde(p);
    });
  } finally { Regie.planAnwenden = orig; WH.pruefen = pruefenEcht; }
  return { runden, wh };
}
function verstoesse(runden, fenster, ausnahmen) {
  let v = 0, angenommen = 0;
  const hist = [];
  for (const { res } of runden) {
    const jetzt = res.ok ? res.angenommen.filter((a) => !ausnahmen.includes(a.befehl.typ)).map((a) => WH.satzVon(a.befehl)) : [];
    const frueher = new Set(hist.slice(-fenster).flat());
    for (const s of jetzt) { angenommen++; if (frueher.has(s)) v++; }
    hist.push(jetzt);
  }
  return { v, angenommen };
}

section('Viele Planungsrunden: Zufalls-Plan-Quelle', () => {
  const g = F.neuesSpiel({ seed: 9 }).g;
  const sl = spielleiter(g);
  const F_ = W.wiederholung.fenster_plaene, AUS = W.wiederholung.ausnahmen;
  // kleine Parameterräume, damit sich Sätze oft wiederholen
  let s = 12345; const zufall = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const wahl = (l) => l[Math.floor(zufall() * l.length)];
  const befehl = () => {
    const t = wahl(['nachschub', 'nachschub', 'nachschub', 'soeldner', 'regler', 'embargo']);
    if (t === 'nachschub') return { typ: 'nachschub', an: wahl(['rom', 'ger']), gut: wahl(['T', 'U']), menge: wahl([1, 2]) };
    if (t === 'regler') return { typ: 'regler', fraktion: wahl(['rom', 'ger']), aggr: wahl([0.3, 0.6]), dauer: 8 };
    if (t === 'embargo') return { typ: 'embargo', von: 'kon', gegen: wahl(['rom', 'ger']), waren: ['M'], dauer: 6 };
    return { typ: 'soeldner', von: 'kon', an: wahl(['rom', 'ger']), flotten: [1], dauer: 6 };
  };
  const RUNDEN = 3000;
  const plaene = Array.from({ length: RUNDEN }, () => ({ befehle: Array.from({ length: 1 + Math.floor(zufall() * 3) }, befehl), begruendung: 'Zufall' }));
  for (const f of ws(g).zustand.flotten) if (f.fraktion === 'kon') f.befehl = 'heim';
  const m = messe(g, sl, plaene, { vorher: () => { ws(g).zustand.marken.rom = 900; ws(g).zustand.marken.ger = 900; ws(g).zustand.vorrat.kon.T = 900; ws(g).zustand.vorrat.kon.U = 900; } });
  const v = verstoesse(m.runden, F_, AUS);
  const regler = m.runden.flatMap((r) => (r.res.ok ? r.res.angenommen : [])).filter((a) => a.befehl.typ === 'regler').length;
  console.log(`       Messung: ${RUNDEN} Runden, ${v.angenommen} angenommene Befehle (ohne Ausnahmen), ${m.wh} als Wiederholung abgelehnt, ${regler} Regler (Ausnahme) nachgestellt`);
  ok(v.angenommen > 500 && m.wh > 200, 'die Regel greift: viele angenommene Befehle, viele abgelehnte Wiederholungen');
  ok(v.v === 0, `über ${RUNDEN} Runden nie derselbe Typ mit demselben Parametersatz wie in den letzten ${F_} Plänen (${v.v} Verstöße)`);
  ok(regler > 100, 'die Ausnahme (regler nachstellen) wird nicht abgelehnt');
  ok(sl.zaehler.fehler === 0 && sl.zaehler.angewandt + sl.zaehler.wirkungslos === RUNDEN, 'jeder Plan gilt als angewandt oder (alle Befehle abgelehnt) als wirkungslos, kein Fehler');
  ok(sl.verlauf.length === F_, `der Verlauf bleibt bei den letzten ${F_} Plänen (kein Speicherwachstum)`);
  // Gegenprobe: ohne die Regel gäbe es Verstöße (die Messung kann also welche finden)
  const g2 = F.neuesSpiel({ seed: 9 }).g; const sl2 = spielleiter(g2);
  const echt = WH.pruefen; WH.pruefen = (plan) => ({ plan, abgelehnt: [] });
  let m2; try { m2 = messe(g2, sl2, plaene.slice(0, 600), { vorher: () => { ws(g2).zustand.marken.rom = 900; ws(g2).zustand.marken.ger = 900; ws(g2).zustand.vorrat.kon.T = 900; ws(g2).zustand.vorrat.kon.U = 900; } }); } finally { WH.pruefen = echt; }
  ok(verstoesse(m2.runden, F_, AUS).v > 50, 'Gegenprobe: ohne die Regel kommen viele Wiederholungen durch (' + verstoesse(m2.runden, F_, AUS).v + ' in 600 Runden)');
  sl.dispose(); sl2.dispose();
});

section('Viele Planungsrunden: Mock-Regisseur', () => {
  const g = F.neuesSpiel({ crew: 3, seed: 3 }).g;
  const sl = spielleiter(g);
  const F_ = W.wiederholung.fenster_plaene, AUS = W.wiederholung.ausnahmen;
  // der Mock wechselt die Befehle nach der Plan-Nummer; hier liefert er jede Runde dieselbe Nummer (Wiederholer) und danach laufende Nummern
  const prompt = (nr) => Prompt.baue(g, { art: 'andocken', nr, letzte: [], werte: W }).prompt;
  const plan = (nr) => Mock.planVon({ prompt: prompt(nr) });
  const tickzu = () => { for (let i = 0; i < 4; i++) Kriegslage().tick(g, 'test'); };
  const mitNr = (nr) => plan(nr);
  const plaene = [];
  for (let i = 0; i < 40; i++) plaene.push(mitNr(3));   // „nachschub“ jede Runde dasselbe (Mock: Plan Nr. 3)
  for (let i = 0; i < 60; i++) plaene.push(mitNr(1 + (i % 5)));   // wechselnde Pläne
  const m = messe(g, sl, plaene, { vorher: (i) => { if (i >= 40 && i % 7 === 0) tickzu(); ws(g).zustand.marken.rom = 900; ws(g).zustand.marken.ger = 900; ws(g).zustand.vorrat.kon.T = 900; } });
  const v = verstoesse(m.runden, F_, AUS);
  const wdh = m.runden.slice(0, 40).filter((r) => r.res.ok && r.res.angenommen.some((a) => a.befehl.typ === 'nachschub')).length;
  console.log(`       Messung: 100 Runden Mock-Regisseur, 40 mal derselbe Plan: ${wdh} mal angenommen (Fenster ${F_}), ${m.wh} Wiederholungen abgelehnt`);
  ok(wdh > 0 && wdh <= Math.ceil(40 / (F_ + 1)), `derselbe Plan 40 Mal hintereinander: höchstens jeden ${F_ + 1}. Plan (${wdh} von 40)`);
  ok(m.wh >= 40 - wdh - 1 && logbuch(g).some((e) => e.ausgang === 'abgelehnt' && (e.fehler || []).some((x) => /^Wiederholung: nachschub/.test(x))), 'alle abgelehnten Wiederholungen sind gezählt, im Regie-Logbuch steht der Grund');
  ok(v.v === 0, 'Mock-Regisseur: nie derselbe Typ mit demselben Parametersatz in den letzten Plänen (' + v.v + ' Verstöße)');
  sl.dispose();
});
function Kriegslage() { return require('../server/sim/kriegslage.js'); }

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
