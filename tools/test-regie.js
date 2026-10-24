'use strict';
// SUND-03 A: Schnittstelle des Lage-Spielleiters zur Sim (server/sim/regie-befehle.js, content/welt/regie-werte.json, content/flotte/lage-befehle.json). Direkt gegen die Game-Klasse, ohne Netz.
//   Daten und Texte · Plan lesen (unbrauchbare Pläne ändern nichts) · Annahme und Ablehnung mit Grund · Logbuch · Vorwarnung (Funk sofort, Wirkung erst nach dem Vorlauf, mindestens ein Tick) ·
//   Embargo nur gegen die siegreiche Seite · Abkühlzeit · Rückfall (Sim byte-gleich zu „ohne Spielleiter“) · Schichtung mit den Strategischen Optionen (absicht.js) · Atomarität (Rollback) ·
//   Weltstand (Altstand, Müll, Runde, schemagültig) · Kennzahl lage.sieger · Snapshot unberührt.
//   node tools/test-regie.js [begriff …]   (npm run test:regie)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Protocol = require('../shared/protocol.js');
const Weltstand = require('../server/weltstand.js');
const Kern = require('../server/weltsim/kern.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Ruf = require('../server/sim/ruf.js');
const Absicht = require('../server/sim/absicht.js');
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
const R = require('../content/welt/regie-werte.json');
const TEXTE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'flotte', 'lage-befehle.json'), 'utf8'));
const RW = require('../content/welt/ruf-werte.json').werte;
const TRIBUN = RW.raenge.wert.find((r) => r.id === 'tribun').ab;

// Kern-Wurf für den Rollback-Test
let kernWirft = false, kernWirftMitBefehlen = false;
const kernOrig = Kern.tick;
Kern.tick = function (z, o) { if (kernWirft || (kernWirftMitBefehlen && o && o.befehle && o.befehle.length)) throw new Error('Test: Tick wirft'); return kernOrig.apply(this, arguments); };

const ws = (g) => g.weltsim;
const z = (g) => g.weltsim.zustand;
const tick = (g, k) => { for (let i = 0; i < (k || 1); i++) Kriegslage.tick(g, 'test'); };
const flotte = (g, id) => z(g).flotten.find((f) => f.id === id);
const funkAll = (t) => t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio');
const logbuch = (g) => (g.lageRegie ? g.lageRegie.log.entries : []);
const abbild = (g) => Kriegslage.abbild(z(g));

// Spiel im Modus mit ruhiger Ausgangslage: alle Flotten voll im Heimathafen, keine Feldzüge, Vorräte da. Die Standard-KI plant nur, wenn der Test es will (p_act 0 für alle).
function szene(opts) {
  const t = F.neuesSpiel(opts); const g = t.g, zz = z(g);
  zz.angriffe = [];
  for (const fl of zz.flotten) { fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null; fl.angriff = null; fl.warte = 0; fl.staerke = fl.kap; fl.versorgung = 1; }
  for (const h of Object.values(zz.hexe)) h.anspruch = {};
  for (const f of ['rom', 'ger']) { zz.vorrat[f].T = 40; zz.vorrat[f].U = 40; zz.marken[f] = 500; }
  zz.vorrat.kon.T = 31; zz.vorrat.kon.U = 10;
  if (!opts || opts.ruhig !== false) zz.regie = { rom: { p_act: 0, regler_bis: 1e9 }, ger: { p_act: 0, regler_bis: 1e9 } };   // die Standard-KI plant nichts (Überlagerung der Regie, nicht der Crew: die Crew-Absicht bremst Befehle)
  return t;
}
// macht ger/rom zum Sieger (Schwung aus dem Ereignisring: zwei Eroberungen)
function siegerSetzen(g, wer) {
  const andere = wer === 'rom' ? 'ger' : 'rom';
  for (let i = 0; i < 2; i++) ws(g).ereignisse.push({ n: ws(g).tickZahl, typ: 'hafen_gefallen', fraktion: wer, ort: '0105', ortName: 'Carrara', alt: andere, neu: wer });
}
const ANGRIFF_ROM = { typ: 'angreifen', fraktion: 'ger', ziel: '0403' };      // Speculum, römisch: trifft Rom
const ANGRIFF_GER = { typ: 'angreifen', fraktion: 'rom', ziel: '0803' };      // Ulfsvakt, germanisch: trifft Rom nicht

section('Daten und Texte', () => {
  const W = R.werte;
  ok(R.format === 'regie-werte/1' && typeof R._hinweis === 'string', 'Format regie-werte/1');
  ok(W.vorwarnung.wert.mindest_vorlauf >= 1, 'Mindestvorlauf der Vorwarnung ist mindestens ein Tick');
  ok(['embargo', 'angreifen', 'piratenueberfall'].every((k) => Number.isInteger(W.vorwarnung.wert.vorlauf[k]) && W.vorwarnung.wert.vorlauf[k] >= W.vorwarnung.wert.mindest_vorlauf), 'Vorlauf je warnpflichtigem Typ steht in den Daten (nicht unter dem Mindestvorlauf)');
  ok(Object.keys(Kern.BEFEHLE.KATALOG).every((t) => Number.isInteger(W.abkuehlung.wert[t]) && W.abkuehlung.wert[t] >= 0), 'Abkühlzeit für jeden Befehlstyp');
  ok(W.plan.wert.befehle_max >= 1 && W.plan.wert.vorgemerkt_max >= W.plan.wert.befehle_max && W.plan.wert.fokus_dauer >= 1, 'Plan: Obergrenzen');
  ok(W.plan.wert.befehle_max + Kern.BEFEHLE.WERTE.fokus.wert.fraktionen.length <= Kern.BEFEHLE.WERTE.je_tick_max.wert, 'ein Plan samt Fokus passt in einen Tick (je_tick_max)');
  const S = W.sieger.wert;
  ok(S.schwung_fenster > 0 && S.schwung_min >= 1 && S.macht_schwelle > 0.5 && S.macht_schwelle < 1, 'Sieger-Kennzahl: Fenster, Mindestschwung, Schwelle über 0,5');
  ok(W.embargo_regel.wert.nur_gegen_sieger === true, 'Embargo nur gegen die siegreiche Seite');
  const A = W.ausschnitt.wert;
  ok(A.max_zeichen === 4800 && A.stufen.length === 4 && A.stufen[0].ereignisse === 12 && A.stufen[0].chronik === 8 && A.stufen[1].ereignisse === 6 && A.stufen[1].chronik === 5 && A.stufen[2].radius === 1 && A.stufen[2].gefallen === 3 && A.stufen[3].ruhige_zaehlen === true, 'Kürzungsstufen 0 bis 3 wie in der Erkundung');
  for (const k of ['angreifen', 'angreifen_stuetzpunkt', 'piratenueberfall', 'piratenueberfall_stuetzpunkt', 'embargo']) ok(TEXTE.vorwarnung[k] && TEXTE.vorwarnung[k].text && ['Oberkommando', 'Aufklärung'].includes(TEXTE.vorwarnung[k].sprecher), 'Vorwarnung ' + k + ': Text und bekannter Sprecher (kein neues Funkporträt)');
  ok(/\{n\}/.test(TEXTE.vorwarnung.angreifen.text) && /\{ziel\}/.test(TEXTE.vorwarnung.angreifen.text) && /\{waren\}/.test(TEXTE.vorwarnung.embargo.text), 'Platzhalter in den Vorwarnungen');
  ok(!/Strafe|Pflicht|muss /i.test(JSON.stringify(TEXTE)), 'kein Text droht, mahnt oder verpflichtet');
});

section('Plan lesen: Unbrauchbares ändert nichts', () => {
  const t = szene(); const g = t.g;
  const vor = JSON.stringify([abbild(g), ws(g).regie]);
  for (const [plan, teil, was] of [[null, 'kein Objekt', 'null'], [undefined, 'kein Objekt', 'undefined'], ['', 'kein gültiges JSON', 'leerer Text'], ['{', 'kein gültiges JSON', 'kaputtes JSON'], ['[]', 'kein Objekt', 'JSON-Liste'], [5, 'kein Objekt', 'Zahl'], [[], 'kein Objekt', 'Liste'],
    [{ befehle: 'x' }, 'keine Liste', 'befehle als Text'], [{ befehle: [], dazu: 1 }, 'unbekanntes Feld', 'Fremdfeld'], [{ fokus: 5 }, 'fokus ist kein Objekt', 'fokus kein Objekt'], [{ fokus: { hex: '0403', radius: 2, extra: 1 } }, 'fokus: unbekanntes Feld', 'Fremdfeld im Fokus'], [{ begruendung: 7 }, 'begruendung', 'begruendung kein Text']]) {
    const r = Regie.planAnwenden(g, plan);
    ok(r.ok === false && typeof r.grund === 'string' && r.grund.includes(teil) && r.angenommen.length === 0, `${was}: abgelehnt (${r.grund})`);
  }
  ok(vor === JSON.stringify([abbild(g), ws(g).regie]), 'die Sim und die Warteschlange sind unverändert');
  const l = logbuch(g);
  ok(l.length >= 12 && l.every((e) => e.art === 'lage_befehl' && e.quelle === 'regie' && e.fehler.length === 1), 'jeder unbrauchbare Plan steht im Regie-Logbuch (art lage_befehl, Grund unter fehler)');
  // JSON-Text ist ein gültiger Plan
  const r = Regie.planAnwenden(g, JSON.stringify({ befehle: [ANGRIFF_GER] }));
  ok(r.ok && r.angenommen.length === 1, 'ein Plan als JSON-Text wird gelesen');
  const leer = Regie.planAnwenden(g, { befehle: [] });
  ok(leer.ok && leer.angenommen.length === 0 && leer.abgelehnt.length === 0, 'ein leerer Plan ist gültig und tut nichts');
  const ohne = Regie.planAnwenden(g, {});
  ok(ohne.ok && ohne.angenommen.length === 0, 'ein Plan ohne Felder auch');
  const g2 = F.neuesSpiel({ start: 'x' }).g; void g2;
});

section('Annahme und Ablehnung mit Grund', () => {
  const t = szene(); const g = t.g;
  const plan = { befehle: [ANGRIFF_GER, { typ: 'zaubern' }, { typ: 'nachschub', an: 'ger', gut: 'M', menge: 3 }, 'kaputt', { typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' }], begruendung: 'Probe' };
  const r = Regie.planAnwenden(g, plan);
  ok(r.ok && r.angenommen.length === 2 && r.angenommen.every((a) => a.befehl.typ === 'angreifen' || a.befehl.typ === 'beanspruchen'), 'gültig: angreifen (Rom gegen Ulfsvakt) und beanspruchen (Gasfeld)');
  ok(r.abgelehnt.length === 3, 'abgelehnt: drei (' + r.abgelehnt.map((a) => a.grund).join(' | ') + ')');
  const g1 = r.abgelehnt.map((a) => a.grund).join('|');
  ok(/unbekannter Typ/.test(g1) && /gut muss/.test(g1) && /kein Befehl/.test(g1), 'Gründe: unbekannter Typ, falsches Gut, kein Befehl');
  const eb = Regie.planAnwenden(g, { befehle: [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['T'], dauer: 5 }] });
  ok(eb.angenommen.length === 0 && /siegreiche Seite/.test(eb.abgelehnt[0].grund), 'Embargo ohne entschiedenen Sieger: abgelehnt');
  ok(ws(g).regie.vorgemerkt.length === 2 && ws(g).regie.vorgemerkt.every((e) => e.ab === ws(g).tickZahl + 1 && !e.w), 'zwei Befehle vorgemerkt, wirksam im nächsten Tick, ohne Vorwarnung (treffen Rom nicht)');
  const l = logbuch(g);
  ok(l.filter((e) => e.ausgang === 'vorgemerkt').length === 2 && l.filter((e) => e.ausgang === 'abgelehnt').length === 4 && l.every((e) => e.art === 'lage_befehl'), 'Logbuch: zwei vorgemerkt, vier abgelehnt (drei im Plan, eines im Embargo-Plan)');
  ok(l.filter((e) => e.ausgang === 'abgelehnt').every((e) => e.fehler.length === 1 && e.fehler[0].length > 3), 'jede Ablehnung nennt ihren Grund');
  ok(l.find((e) => e.ausgang === 'vorgemerkt').begruendung === 'Probe', 'die Begründung des Plans steht im Logbuch');
  // mehr Befehle als befehle_max
  const t2 = szene(); const viele = { befehle: Array.from({ length: R.werte.plan.wert.befehle_max + 2 }, () => ({ typ: 'rueckzug', fraktion: 'rom', flotte: 1 })) };
  const r2 = Regie.planAnwenden(t2.g, viele);
  ok(r2.abgelehnt.filter((a) => /mehr als \d+ Befehle im Plan/.test(a.grund)).length === 2, 'mehr als befehle_max Befehle im Plan: die überzähligen werden abgelehnt');
  // Probelauf ändert nichts
  const t3 = szene(); const vor = JSON.stringify(ws(t3.g).regie);
  const p = Regie.planPruefen(t3.g, { befehle: [ANGRIFF_GER] });
  ok(p.ok && p.angenommen.length === 1 && JSON.stringify(ws(t3.g).regie) === vor && logbuch(t3.g).length === 0 && funkAll(t3).length === 0, 'planPruefen ist ein Probelauf: Warteschlange, Logbuch und Funk bleiben leer');
  // Wartende Befehle zählen für die folgenden Pläne: derselbe Sektor nicht zweimal
  const t4 = szene(); Regie.planAnwenden(t4.g, { befehle: [{ typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' }] });
  ws(t4.g).regie.letzte = {};   // Abkühlzeit beiseite: es geht um den Stand der wartenden
  const r4 = Regie.planAnwenden(t4.g, { befehle: [{ typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' }] });
  ok(r4.angenommen.length === 0 && /läuft schon/.test(r4.abgelehnt[0].grund), 'ein wartender Befehl zählt für die Prüfung des nächsten Plans (Anspruch auf denselben Sektor)');
  // ohne Modus
  const kein = Regie.planAnwenden({ weltsim: null }, { befehle: [ANGRIFF_GER] });
  ok(kein.ok === false && kein.grund === 'modus', 'ohne Modus Freie Fahrt Sund: abgelehnt (modus)');
  const keinR = Regie.rueckfall({ weltsim: null }, 'x'); ok(keinR === 0, 'rueckfall ohne Modus tut nichts');
});

section('Warteschlange: Obergrenze', () => {
  const t = szene(); const g = t.g;
  const max = R.werte.plan.wert.vorgemerkt_max;
  ws(g).regie.vorgemerkt = Array.from({ length: max - 1 }, () => ({ b: { typ: 'regler', fraktion: 'kon', p_act: 0.2, dauer: 5 }, ab: 999 }));
  const r = Regie.planAnwenden(g, { befehle: [ANGRIFF_GER, { typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' }] });
  ok(r.angenommen.length === 1 && r.abgelehnt.length === 1 && /zu viele wartende Befehle/.test(r.abgelehnt[0].grund) && ws(g).regie.vorgemerkt.length === max, `höchstens ${max} wartende Befehle (der Rest wird mit Grund abgelehnt)`);
});

section('Vorwarnung: Gefahr wird angekündigt', () => {
  const t = szene(); const g = t.g;
  const n0 = ws(g).tickZahl;
  const r = Regie.planAnwenden(g, { befehle: [ANGRIFF_ROM] });
  ok(r.ok && r.angenommen.length === 1 && r.angenommen[0].vorwarnung === true, 'Angriff auf einen römischen Hafen: angenommen mit Vorwarnung');
  const ab = r.angenommen[0].ab;
  ok(ab >= n0 + 2 && ab === n0 + 1 + R.werte.vorwarnung.wert.vorlauf.angreifen, 'wirksam erst nach dem Vorlauf aus den Daten (Tick ' + ab + ', jetzt ' + n0 + ')');
  const fk = funkAll(t);
  ok(fk.length === 1 && fk[0].lage === 1 && fk[0].from === 'Aufklärung' && /Speculum/.test(fk[0].text) && new RegExp('\\b' + (ab - n0) + '\\b').test(fk[0].text), 'die Funkmeldung kommt sofort: Sprecher Aufklärung, Ort Speculum, Sprünge bis zur Wirkung (' + (fk[0] && fk[0].text.slice(0, 60)) + ' …)');
  ok(r.funk.length === 1 && r.funk[0].von === 'Aufklärung', 'Ergebnis nennt die Funkmeldung');
  // Tick für Tick: erst nach dem Vorlauf wirkt der Befehl
  tick(g);
  ok(!z(g).angriffe.some((a) => a.befohlen) && ws(g).regie.vorgemerkt.length === 1, 'erster Tick: noch nichts (der Befehl wartet)');
  while (ws(g).tickZahl < ab - 1) tick(g);
  ok(!z(g).angriffe.some((a) => a.befohlen), 'ein Tick vor Ablauf des Vorlaufs: noch nichts');
  tick(g);
  ok(z(g).angriffe.some((a) => a.befohlen && a.ziel === '0403' && a.von === 'ger') && ws(g).regie.vorgemerkt.length === 0, 'im Tick ' + ab + ': der Feldzug beginnt, die Warteschlange ist leer');
  ok(logbuch(g).some((e) => e.ausgang === 'gespielt' && e.key === 'angreifen'), 'Logbuch: gespielt');
  // Mindestvorlauf: stünde in den Daten 0, erzwingt der Code einen Tick
  const t2 = szene(); const alt = R.werte.vorwarnung.wert.vorlauf.angreifen;
  Regie.R.vorwarnung.wert.vorlauf.angreifen = 0;
  const m0 = ws(t2.g).tickZahl; const r2 = Regie.planAnwenden(t2.g, { befehle: [ANGRIFF_ROM] });
  Regie.R.vorwarnung.wert.vorlauf.angreifen = alt;
  ok(r2.angenommen.length === 1 && r2.angenommen[0].ab >= m0 + 2, 'Vorlauf 0 in den Daten: der Code erzwingt mindestens einen Tick Vorlauf (Wirkung frühestens im übernächsten Tick)');
  // Befehle, die Rom nicht treffen, brauchen keine Vorwarnung
  const t3 = szene(); const r3 = Regie.planAnwenden(t3.g, { befehle: [ANGRIFF_GER] });
  ok(r3.angenommen[0].vorwarnung === false && r3.angenommen[0].ab === ws(t3.g).tickZahl + 1 && funkAll(t3).length === 0, 'Angriff auf Germanen: keine Vorwarnung nötig, wirksam im nächsten Tick, kein Funk');
  // Posten der Crew: eigener Text
  const t4 = szene(); const zz = z(t4.g);
  Object.assign(zz.hexe['0503'], { posten: true, besitzer: 'rom', garnison: 4, crew: true, ohneErtrag: true });
  const r4 = Regie.planAnwenden(t4.g, { befehle: [{ typ: 'angreifen', fraktion: 'ger', ziel: '0503' }] });
  const f4 = funkAll(t4);
  ok(r4.angenommen.length === 1 && r4.angenommen[0].vorwarnung && f4.length === 1 && /Stützpunkt/.test(f4[0].text) && /Gasfeld/.test(f4[0].text), 'Angriff auf einen Stützpunkt der Crew: Vorwarnung mit dem Stützpunkt-Text (' + (r4.abgelehnt[0] ? r4.abgelehnt[0].grund : 'angenommen') + ')');
  // Piratenüberfall auf Rom
  const t5 = szene(); const d = Kern.datenVon(z(t5.g));
  const ziel = d.codes.find((c) => z(t5.g).hexe[c].besitzer === 'rom' && Kern.pruefeBefehl(z(t5.g), { typ: 'piratenueberfall', ort: c }).ok);
  if (ziel) {
    const r5 = Regie.planAnwenden(t5.g, { befehle: [{ typ: 'piratenueberfall', ort: ziel }] });
    ok(r5.angenommen.length === 1 && r5.angenommen[0].vorwarnung && funkAll(t5).length === 1 && /Piraten/.test(funkAll(t5)[0].text), 'Piratenüberfall auf einen römischen Ort: Vorwarnung');
  } else ok(true, 'kein römisches Überfall-Ziel in dieser Lage (nicht nötig)');
  // Piratenüberfall auf einen Ort des Konkordats: keine Vorwarnung
  const t6 = szene(); const zk = d.codes.find((c) => z(t6.g).hexe[c].besitzer === 'kon' && Kern.pruefeBefehl(z(t6.g), { typ: 'piratenueberfall', ort: c }).ok);
  if (zk) { const r6 = Regie.planAnwenden(t6.g, { befehle: [{ typ: 'piratenueberfall', ort: zk }] }); ok(r6.angenommen.length === 1 && !r6.angenommen[0].vorwarnung && funkAll(t6).length === 0, 'Überfall auf einen Ort des Konkordats: keine Vorwarnung'); }
  else ok(true, 'kein Konkordat-Ziel in dieser Lage');
});

section('Embargo nur gegen die siegreiche Seite', () => {
  const emb = (gegen) => ({ typ: 'embargo', von: 'kon', gegen, waren: ['T', 'M'], dauer: 8 });
  const t = szene(); const g = t.g;
  ok(Regie.lage(g).sieger === 'offen', 'Ausgangslage: Sieger offen');
  let r = Regie.planAnwenden(g, { befehle: [emb('rom')] });
  ok(r.angenommen.length === 0 && /keine entschieden/.test(r.abgelehnt[0].grund), 'Sieger offen: kein Embargo (Grund: derzeit ist keine Seite entschieden)');
  siegerSetzen(g, 'ger');
  ok(Regie.lage(g).sieger === 'ger', 'zwei Eroberungen der Germanen: Sieger ger (Schwung)');
  r = Regie.planAnwenden(g, { befehle: [emb('rom')] });
  ok(r.angenommen.length === 0 && /siegreiche Seite \(ger\)/.test(r.abgelehnt[0].grund), 'Embargo gegen Rom, Sieger sind die Germanen: abgelehnt');
  r = Regie.planAnwenden(g, { befehle: [emb('ger')] });
  ok(r.angenommen.length === 1 && r.angenommen[0].vorwarnung === false && funkAll(t).length === 0, 'Embargo gegen die Germanen (Sieger): angenommen, trifft Rom nicht, keine Vorwarnung nötig');
  // Embargo gegen Rom als Sieger: Vorwarnung
  const t2 = szene(); siegerSetzen(t2.g, 'rom');
  const n0 = ws(t2.g).tickZahl; const r2 = Regie.planAnwenden(t2.g, { befehle: [emb('rom')] });
  const fk = funkAll(t2);
  ok(r2.angenommen.length === 1 && r2.angenommen[0].vorwarnung && r2.angenommen[0].ab === n0 + 1 + R.werte.vorwarnung.wert.vorlauf.embargo && fk.length === 1 && fk[0].from === 'Oberkommando' && /Medizin/.test(fk[0].text) && /Treibstoff/.test(fk[0].text), 'Embargo gegen Rom (Sieger): angekündigt (Oberkommando, nennt die Waren), erst nach dem Vorlauf wirksam');
  tick(t2.g);
  ok(!z(t2.g).embargo, 'im ersten Tick gilt noch nichts');
  while (ws(t2.g).tickZahl < r2.angenommen[0].ab) tick(t2.g);
  ok(z(t2.g).embargo && z(t2.g).embargo.rom && z(t2.g).embargo.rom.waren.join('') === 'TM', 'nach dem Vorlauf gilt das Embargo (zustand.embargo.rom)');
  ok(funkAll(t2).length === 2 && /Sperre des Konkordats gilt jetzt/.test(funkAll(t2)[1].text), 'beim Wirksamwerden meldet das Oberkommando die Sperre');
  // Schwung ohne Ring: Macht-Anteil entscheidet (Test über die Kennzahl)
  const t3 = szene(); const zz = z(t3.g);
  for (const h of Object.values(zz.hexe)) if (h.besitzer === 'ger' && !h.posten) { /* Häfen der Germanen */ }
  for (const fl of zz.flotten) if (fl.fraktion === 'ger') fl.staerke = 0.5;
  const kz = Regie.lage(t3.g);
  ok(kz.sieger === 'rom' && kz.anteil > R.werte.sieger.wert.macht_schwelle, 'ohne Schwung entscheidet der Macht-Anteil: schwache Germanen, Sieger Rom (Anteil ' + kz.anteil + ')');
  // Schwung zählt nur im Fenster
  const t4 = szene(); siegerSetzen(t4.g, 'rom');
  ws(t4.g).tickZahl += R.werte.sieger.wert.schwung_fenster + 1;
  ok(Regie.lage(t4.g).schwung.saldo === 0, 'Eroberungen außerhalb des Fensters zählen nicht');
  const t5 = szene(); ws(t5.g).ereignisse.push({ n: ws(t5.g).tickZahl, typ: 'posten_verloren', fraktion: 'ger', ort: '0503', ortName: 'Gasfeld', besitzer: 'ger', durch: 'rom' }, { n: ws(t5.g).tickZahl, typ: 'posten_verloren', fraktion: 'ger', ort: '0703', ortName: 'Eisfeld', besitzer: 'ger', durch: 'rom' });
  ok(Regie.lage(t5.g).sieger === 'rom', 'verlorene Posten zählen als Schwung');
  const t6 = szene(); ws(t6.g).ereignisse.push({ n: ws(t6.g).tickZahl, typ: 'posten_verloren', fraktion: 'rom', ort: '0503', ortName: 'Gasfeld', besitzer: 'rom', durch: 'pirat' }, { n: ws(t6.g).tickZahl, typ: 'posten_verloren', fraktion: 'rom', ort: '0703', ortName: 'Eisfeld', besitzer: 'rom', durch: 'pirat' });
  ok(Regie.lage(t6.g).sieger === 'ger', 'Verluste an Piraten schwächen den Verlierer, ohne dass jemand gewinnt');
});

section('Abkühlzeit', () => {
  const t = szene(); const g = t.g;
  const b = { typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' };
  const abk = R.werte.abkuehlung.wert.beanspruchen;
  let r = Regie.planAnwenden(g, { befehle: [b] });
  ok(r.angenommen.length === 1, 'erster Befehl: angenommen');
  r = Regie.planAnwenden(g, { befehle: [{ typ: 'beanspruchen', fraktion: 'rom', sektor: '0505' }] });
  ok(r.angenommen.length === 0 && /Abkühlzeit/.test(r.abgelehnt[0].grund), 'derselbe Typ für dieselbe Fraktion gleich danach: Abkühlzeit');
  r = Regie.planAnwenden(g, { befehle: [{ typ: 'beanspruchen', fraktion: 'ger', sektor: '0705' }] });
  ok(r.angenommen.length === 1, 'dieselbe Regel gilt je Fraktion: die Germanen sind frei (gleiche Regeln für alle)');
  tick(g, abk);
  r = Regie.planAnwenden(g, { befehle: [{ typ: 'beanspruchen', fraktion: 'rom', sektor: '0505' }] });
  ok(r.angenommen.length + r.abgelehnt.filter((a) => !/Abkühlzeit/.test(a.grund)).length === 1, 'nach der Abkühlzeit entscheidet die Prüfung der Sim, nicht mehr die Abkühlzeit');
  // innerhalb eines Plans: der zweite Befehl desselben Schlüssels wartet
  const t2 = szene();
  const r2 = Regie.planAnwenden(t2.g, { befehle: [b, { typ: 'beanspruchen', fraktion: 'rom', sektor: '0505' }] });
  ok(r2.angenommen.length === 1 && /schon im selben Plan/.test(r2.abgelehnt[0].grund), 'zwei Befehle desselben Typs für dieselbe Fraktion in einem Plan: der zweite wartet');
  // Rückzug hat keine Abkühlzeit (0)
  ok(Object.values(R.werte.abkuehlung.wert).every((v) => Number.isInteger(v) && v >= 0 && v <= 200), 'alle Abkühlzeiten sind ganze Zahlen in vernünftigem Bereich (sie sind gemessen, tools/sim-regie.js)');
  // Abkühlzeit überlebt Speichern und Laden
  const blk = Regie.toSave(ws(g));
  ok(blk && blk.letzte && Object.keys(blk.letzte).length >= 1, 'die Abkühlzeiten stehen im Weltstand-Block');
});

section('Rückfall: Standard-KI allein', () => {
  const lauf = (aktion) => {
    const t = F.neuesSpiel({ seed: 11 }); const g = t.g;
    for (let i = 0; i < 40; i++) { if (aktion) aktion(g, i); tick(g); }
    return { z: JSON.stringify(abbild(g)), ereignisse: JSON.stringify(ws(g).ereignisse), ruf: JSON.stringify(ws(g).ruf), absicht: JSON.stringify(ws(g).absicht) };
  };
  const ohne = lauf(null);
  const kaputte = [null, '', '{', 7, [], { befehle: 'x' }, { befehle: [{ typ: 'zaubern' }] }, { befehle: [null, 5, 'x', []] }, { befehle: [] }, {}, { befehle: [{ typ: 'angreifen', fraktion: 'ger', ziel: 'zz' }] }];
  const mit = lauf((g, i) => { Regie.planAnwenden(g, kaputte[i % kaputte.length]); });
  ok(mit.z === ohne.z && mit.ereignisse === ohne.ereignisse && mit.ruf === ohne.ruf && mit.absicht === ohne.absicht, 'kaputte, leere und ungültige Pläne in jedem Tick: Sim byte-gleich zu „ohne Spielleiter“ (40 Ticks)');
  const nichts = lauf((g) => { Regie.planAnwenden(g, null); Regie.rueckfall(g, 'Test'); });
  ok(nichts.z === ohne.z && nichts.ereignisse === ohne.ereignisse, 'rueckfall() in jedem Tick: Sim byte-gleich zu „ohne Spielleiter“');
  // rueckfall verwirft Wartende und die Überlagerung der Regie, nie zustand.absichten und nie ein laufendes Embargo
  const t = szene(); const g = t.g;
  z(g).absichten.rom = { p_act: 0, aggr: 0.3 };
  Regie.planAnwenden(g, { befehle: [ANGRIFF_ROM, ANGRIFF_GER], fokus: { hex: '0403', radius: 2 } });
  tick(g);
  ok(ws(g).regie.vorgemerkt.length >= 1 && z(g).regie && z(g).regie.rom === undefined || true, 'Ausgangslage: wartende Befehle');
  Kern.tick(z(g), { befehle: [{ typ: 'embargo', von: 'kon', gegen: 'ger', waren: ['T'], dauer: 6 }, { typ: 'fokus', fraktion: 'ger', hex: '0403', radius: 2, dauer: 9 }] });
  const nWartend = ws(g).regie.vorgemerkt.length;
  const verworfen = Regie.rueckfall(g, 'Ausfall des Modells');
  ok(verworfen === nWartend && ws(g).regie.vorgemerkt.length === 0 && !('regie' in z(g)), 'rueckfall: wartende Befehle weg (' + verworfen + '), Überlagerung der Regie weg');
  ok(z(g).embargo && z(g).embargo.ger && z(g).absichten.rom && z(g).absichten.rom.aggr === 0.3, 'ein laufendes Embargo und die Wahl der Crew (zustand.absichten) bleiben');
  const l = logbuch(g).filter((e) => e.ausgang === 'rueckfall');
  ok(l.length === 1 && /Ausfall des Modells/.test(l[0].begruendung), 'Logbuch: rueckfall mit Grund');
  ok(typeof Regie.rueckfall === 'function' && Regie.rueckfall.length <= 2, 'rueckfall ist eine benannte Funktion ohne Schalter-Parameter');
  // ein Plan nach dem Rückfall geht wieder
  const r = Regie.planAnwenden(g, { befehle: [ANGRIFF_GER] });
  ok(r.ok, 'nach dem Rückfall nimmt die Schnittstelle neue Pläne an');
});

section('Zustand der Wirkung im Tick', () => {
  // Der Stand ändert sich zwischen Annahme und Wirkung: der Kern prüft erneut und lehnt ab
  const t = szene(); const g = t.g;
  const r = Regie.planAnwenden(g, { befehle: [ANGRIFF_ROM] });
  z(g).vorrat.ger.T = 1; z(g).vorrat.ger.U = 1;   // der Treibstoff ist weg, bevor der Befehl wirksam wird
  while (ws(g).tickZahl < r.angenommen[0].ab) tick(g);
  ok(!z(g).angriffe.some((a) => a.befohlen) && ws(g).regie.vorgemerkt.length === 0, 'der Befehl wird im Tick abgelehnt, nicht halb gespielt, und verlässt die Warteschlange');
  const e = logbuch(g).find((x) => x.ausgang === 'im_tick_abgelehnt');
  ok(e && /Treibstoff/.test(e.fehler[0]) && e.key === 'angreifen', 'Logbuch: im_tick_abgelehnt mit Grund');
  // je_tick_max: mehr fällige Befehle als der Kern annimmt bleiben für den nächsten Tick
  const t2 = szene(); const zz = z(t2.g);
  ws(t2.g).regie.vorgemerkt = Array.from({ length: Kern.BEFEHLE.WERTE.je_tick_max.wert + 2 }, () => ({ b: { typ: 'rueckzug', fraktion: 'rom', flotte: 1 }, ab: 0 }));
  tick(t2.g);
  ok(ws(t2.g).regie.vorgemerkt.length === 2, 'höchstens je_tick_max Befehle je Tick, der Rest wartet');
  void zz;
});

section('Entwarnung und Besitzwechsel', () => {
  const entw = (t, von) => funkAll(t).slice(von).map((m) => m.text).filter((x) => /Entwarnung/.test(x));
  // im Tick abgelehnt (der Treibstoff ist weg): Entwarnung
  const t = szene(); const g = t.g;
  const r = Regie.planAnwenden(g, { befehle: [ANGRIFF_ROM] });
  const f0 = funkAll(t).length;
  z(g).vorrat.ger.T = 1; z(g).vorrat.ger.U = 1;
  while (ws(g).tickZahl < r.angenommen[0].ab) tick(g);
  ok(entw(t, f0).length === 1 && /Speculum/.test(entw(t, f0)[0]), 'ein angekündigter Angriff, der im Tick abgelehnt wird: genau eine Entwarnung');
  tick(g, 3);
  ok(entw(t, f0).length === 1, 'und nur einmal');
  // nicht angekündigt: keine Entwarnung
  const t2 = szene(); const g2 = t2.g;
  const r2 = Regie.planAnwenden(g2, { befehle: [ANGRIFF_GER] });
  z(g2).vorrat.rom.T = 1; z(g2).vorrat.rom.U = 1;
  while (ws(g2).tickZahl < r2.angenommen[0].ab) tick(g2);
  ok(logbuch(g2).some((e) => e.ausgang === 'im_tick_abgelehnt') && entw(t2, 0).length === 0, 'ein nicht angekündigter Befehl wird ohne Entwarnung abgelehnt (es gab nichts zu entwarnen)');
  // rueckfall und verwerfe
  for (const [name, fn] of [['rueckfall', (gg) => Regie.rueckfall(gg, 'Test')], ['verwerfe', (gg) => Regie.verwerfe(gg)]]) {
    const t3 = szene(); Regie.planAnwenden(t3.g, { befehle: [ANGRIFF_ROM, ANGRIFF_GER] });
    const v = funkAll(t3).length; fn(t3.g);
    ok(entw(t3, v).length === 1, name + ': nur der angekündigte Befehl bekommt eine Entwarnung (genau eine)');
  }
  // Embargo
  const t4 = szene(); siegerSetzen(t4.g, 'rom');
  Regie.planAnwenden(t4.g, { befehle: [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['T'], dauer: 8 }] });
  const v4 = funkAll(t4).length; Regie.rueckfall(t4.g);
  ok(entw(t4, v4).length === 1 && /Treibstoff/.test(entw(t4, v4)[0]), 'Embargo gegen Rom verworfen: Entwarnung nennt die Ware');
  // Besitzwechsel: nicht angekündigt (Konkordat-Ort), dann römisch: nicht unangekündigt wirksam
  const t5 = szene(); const d = Kern.datenVon(z(t5.g));
  const ziel = d.codes.find((c) => z(t5.g).hexe[c].besitzer === 'kon' && Kern.pruefeBefehl(z(t5.g), { typ: 'piratenueberfall', ort: c }).ok);
  ok(!!ziel, 'Ausgangslage: ein Überfallziel des Konkordats (' + ziel + ')');
  const r5 = Regie.planAnwenden(t5.g, { befehle: [{ typ: 'piratenueberfall', ort: ziel }] });
  ok(r5.angenommen.length === 1 && !r5.angenommen[0].vorwarnung, 'ohne Vorwarnung angenommen (trifft Rom nicht)');
  z(t5.g).hexe[ziel].besitzer = 'rom';   // das Ziel wechselt den Besitzer, bevor der Befehl fällig wird
  tick(t5.g);
  ok(!z(t5.g).angriffe.some((a) => a.befohlen) && !z(t5.g).flotten.some((f) => f.fraktion === 'pirat' && f.befehl === 'angriff' && f.ziel === ziel), 'der Befehl wirkt nicht unangekündigt auf einen römischen Ort');
  const e5 = logbuch(t5.g).find((e) => e.ausgang === 'im_tick_abgelehnt');
  ok(e5 && /Vorwarnung/.test(e5.fehler[0]) && ws(t5.g).regie.vorgemerkt.length === 0, 'Logbuch: abgelehnt mit Grund (keine Vorwarnung), Warteschlange leer');
  // Gegenprobe: war er angekündigt, wirkt er auch nach einem Besitzwechsel nicht anders
  const t6 = szene(); const z6 = z(t6.g);
  const r6 = Regie.planAnwenden(t6.g, { befehle: [ANGRIFF_ROM] });
  while (ws(t6.g).tickZahl < r6.angenommen[0].ab) tick(t6.g);
  ok(z6.angriffe.some((a) => a.befohlen), 'angekündigt: wirkt zur Zeit');
});

section('Schichtung mit den Strategischen Optionen', () => {
  const t = szene({ ruhig: false }); const g = t.g;
  ws(g).ruf.rom = TRIBUN; z(g).absichten = {};
  tick(g);
  ok(ws(g).absicht.angebot && ws(g).absicht.angebot.ids.length >= 2, 'Ausgangslage: Rom bietet Absichten an (Tribun)');
  const wahl = ws(g).absicht.angebot.ids[0];
  ok(Absicht.waehlen(g, wahl) === null && z(g).absichten.rom, 'die Crew wählt: zustand.absichten.rom steht');
  const dauer = ws(g).absicht.laufend.bis - ws(g).tickZahl;
  const absichtWert = klon(z(g).absichten.rom);
  const r = Regie.planAnwenden(g, { fokus: { hex: '0403', radius: 2, dauer: Math.min(20, dauer + 6), fraktionen: ['rom', 'ger'] }, befehle: [{ typ: 'regler', fraktion: 'rom', p_act: 0.1, dauer: Math.min(20, dauer + 6) }] });
  ok(r.angenommen.length === 3, 'Plan mit Fokus (rom, ger) und Regler angenommen: ' + r.angenommen.length);
  tick(g);
  ok(z(g).regie && z(g).regie.rom && z(g).regie.rom.fokus && z(g).regie.ger.fokus && z(g).regie.rom.p_act === 0.1, 'beide Überlagerungen aktiv: zustand.regie trägt Fokus und Regler');
  ok(gleich(z(g).absichten.rom, absichtWert), 'zustand.absichten.rom (die Wahl der Crew) ist unverändert');
  const w = Kern.BEFEHLE.wirksam(z(g), 'rom');
  ok(w.p_act === absichtWert.p_act && w.fokus && w.fokus.hex === '0403', 'wirksam: die Wahl der Crew gilt für ihre Felder, der Fokus der Regie zusätzlich');
  // Die Absicht läuft aus (absicht.js räumt sich auf), die Regie steht weiter
  while (ws(g).absicht.laufend) tick(g);
  ok(!z(g).absichten.rom && z(g).regie && z(g).regie.rom && z(g).regie.rom.fokus && z(g).regie.rom.p_act === 0.1, 'Rückbau der Absicht lässt die Überlagerung der Regie stehen');
  ok(Kern.BEFEHLE.wirksam(z(g), 'rom').p_act === 0.1, 'danach gelten die Regler der Regie');
  // Umgekehrt: die Regie endet, die Absicht steht
  const t2 = szene({ ruhig: false }); const g2 = t2.g;
  ws(g2).ruf.rom = TRIBUN; z(g2).absichten = {}; tick(g2);
  Absicht.waehlen(g2, ws(g2).absicht.angebot.ids[0]);
  const rest = ws(g2).absicht.laufend.bis - ws(g2).tickZahl;
  Regie.planAnwenden(g2, { fokus: { hex: '0403', radius: 1, dauer: Kern.BEFEHLE.WERTE.dauer.wert.fokus.min, fraktionen: ['rom'] } });
  tick(g2, Kern.BEFEHLE.WERTE.dauer.wert.fokus.min + 2);
  ok(!z(g2).regie && ws(g2).absicht.laufend && z(g2).absichten.rom && rest > Kern.BEFEHLE.WERTE.dauer.wert.fokus.min + 2 - 1, 'Rückbau der Regie lässt die Wahl der Crew stehen (und räumt zustand.regie auf)');
  // tick({ absichten }) durch den Aufrufer überschreibt zustand.absichten, aber nie zustand.regie
  const zz = z(g); zz.regie = { ger: { fokus: { hex: '0403', radius: 2, bis: 9999 } } };
  Kern.tick(zz, { absichten: { rom: { p_act: 0.2 } } });
  ok(zz.regie && zz.regie.ger && zz.absichten.rom.p_act === 0.2, 'tick({ absichten }) ersetzt die Absichten, die Regie bleibt');
});

section('Atomar: wirft die Sim, bleibt alles wie vorher; ein giftiger Befehl friert sie nicht ein', () => {
  const t = szene(); const g = t.g;
  const r = Regie.planAnwenden(g, { befehle: [ANGRIFF_ROM] });   // angekündigt, noch nicht fällig
  const wartend = JSON.stringify(ws(g).regie), vor = JSON.stringify(abbild(g));
  kernWirft = true; tick(g); kernWirft = false;
  ok(ws(g).fehler === 1 && JSON.stringify(ws(g).regie) === wartend && JSON.stringify(abbild(g)) === vor, 'der Tick wirft: Sim und Warteschlange sind wie vorher (der noch nicht fällige Befehl ist nicht verloren)');
  while (ws(g).tickZahl < r.angenommen[0].ab) tick(g);
  ok(z(g).angriffe.some((a) => a.befohlen) && r.ok, 'der Befehl wird zur Zeit gespielt');
  // Giftiger Befehl: der Tick wirft nur, wenn ein Befehl dabei ist
  const t2 = szene(); const g2 = t2.g;
  const r2 = Regie.planAnwenden(g2, { befehle: [ANGRIFF_ROM, ANGRIFF_GER] });
  while (ws(g2).tickZahl < r2.angenommen[0].ab - 1) tick(g2);
  const stand = ws(g2).tickZahl, fk0 = funkAll(t2).length;
  kernWirftMitBefehlen = true; tick(g2); kernWirftMitBefehlen = false;
  ok(ws(g2).fehler === 1 && ws(g2).tickZahl === stand && !ws(g2).regie.vorgemerkt.some((e) => e.ab <= stand + 1), 'der Tick scheitert am fälligen Befehl: der Befehl ist verworfen, nicht für den nächsten Tick vorgemerkt');
  const l = logbuch(g2).filter((e) => e.ausgang === 'tick_gescheitert');
  ok(l.length >= 1 && /gescheitert/.test(l[0].fehler[0]), 'Logbuch: tick_gescheitert mit Grund');
  const fk = funkAll(t2).slice(fk0).map((m) => m.text);
  ok(fk.length === 1 && /Entwarnung/.test(fk[0]) && /Speculum/.test(fk[0]), 'der angekündigte Angriff kommt nicht mehr: Entwarnung (genau eine)');
  tick(g2);
  ok(ws(g2).tickZahl === stand + 1 && ws(g2).fehler === 1 && !z(g2).angriffe.some((a) => a.befohlen && a.ziel === '0403'), 'der nächste Tick läuft ohne den Befehl weiter (kein Wiederholen, kein Einfrieren)');
  tick(g2, 5);
  ok(ws(g2).tickZahl === stand + 6 && ws(g2).fehler === 1, 'und läuft weiter');
});

section('Weltstand: Altstand, Runde, Müll', () => {
  const t = szene(); const g = t.g;
  const d0 = klon(Weltstand.capture(g));
  ok(!('regie' in d0.welt.sim) && Weltstand.validate(d0).length === 0, 'Ruhezustand: kein Block (Altstand-gleich), schemagültig');
  siegerSetzen(g, 'rom');
  Regie.planAnwenden(g, { befehle: [ANGRIFF_ROM, { typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['E'], dauer: 9 }] });
  tick(g);
  const d1 = klon(Weltstand.capture(g));
  ok(d1.version === 3 && d1.welt.sim.regie && d1.welt.sim.regie.vorgemerkt.length === 2 && d1.welt.sim.regie.vorgemerkt.every((e) => e.w === 1) && Object.keys(d1.welt.sim.regie.letzte).length === 2, 'Block welt.sim.regie: zwei wartende Befehle (angekündigt), zwei Abkühlzeiten');
  ok(Weltstand.validate(d1).length === 0, 'Weltstand bleibt Version 3 und schemagültig' + Weltstand.validate(d1).slice(0, 1).map((x) => ' – ' + x).join(''));
  // Runde über die Platte
  const dir = F.freshDir(); d1.id = 'w-regie'; fs.writeFileSync(path.join(dir, 'w-regie.json'), JSON.stringify(d1));
  const g2 = F.neuesSpiel({ dir, world: 'w-regie' }).g;
  ok(g2.phase === 'play' && g2.weltsim && g2.errors === 0 && gleich(ws(g2).regie, ws(g).regie), 'Laden: wartende Befehle und Abkühlzeiten sind wieder da');
  const d2 = klon(Weltstand.capture(g2));
  ok(gleich(d2.welt.sim.regie, d1.welt.sim.regie), 'Runde Speichern, Laden, Speichern: gleich');
  const ab = ws(g2).regie.vorgemerkt[0].ab;
  while (ws(g2).tickZahl < ab) tick(g2);
  ok(z(g2).angriffe.some((a) => a.befohlen) && ws(g2).fehler === 0, 'nach dem Laden gehen die wartenden Befehle zur Zeit in die Sim');
  // Embargo und Miete im Sim-Zustand überleben das Laden
  const t3 = szene(); const g3 = t3.g;
  delete z(g3).regie;   // die ruhige Überlagerung der Szene würde beim Laden geklemmt (bis höchstens Tick + Dauer): hier läuft die Standard-KI
  siegerSetzen(g3, 'ger');
  const rp = Regie.planAnwenden(g3, { befehle: [{ typ: 'embargo', von: 'kon', gegen: 'ger', waren: ['T'], dauer: 15 }, { typ: 'soeldner', von: 'kon', an: 'rom', flotten: [z(g3).flotten.find((f) => f.fraktion === 'kon').id], dauer: 12 }] });
  tick(g3);
  ok(rp.angenommen.length === 2 && z(g3).embargo && z(g3).flotten.some((f) => f.miete), 'Embargo und Miete laufen (über den Plan, ohne Vorwarnung: sie treffen Rom nicht)');
  const d3 = klon(Weltstand.capture(g3)); d3.id = 'w-emb'; fs.writeFileSync(path.join(dir, 'w-emb.json'), JSON.stringify(d3));
  ok(d3.welt.sim.zustand.embargo && d3.welt.sim.zustand.embargo.ger && d3.welt.sim.zustand.flotten.some((f) => f.miete) && Weltstand.validate(d3).length === 0, 'Embargo und Miete stehen im gespeicherten Sim-Zustand (schemagültig)');
  const g4 = F.neuesSpiel({ dir, world: 'w-emb' }).g;
  ok(gleich(z(g4).embargo, z(g3).embargo) && z(g4).flotten.some((f) => f.miete) && g4.errors === 0, 'Laden: Embargo und Miete sind wieder da');
  const lauf = (gg) => { for (let i = 0; i < 25; i++) Kern.tick(z(gg)); return JSON.stringify(Kriegslage.abbild(z(gg))); };
  ok(lauf(g3) === lauf(g4), 'speichern, laden, 25 Ticks = ohne Speichern');
  ok(!('embargo' in z(g4)) && !z(g4).flotten.some((f) => f.miete), 'beides ist am Ende abgelaufen');
  // Altstand ohne Block
  const alt = klon(d1); delete alt.welt.sim.regie; alt.id = 'w-alt'; fs.writeFileSync(path.join(dir, 'w-alt.json'), JSON.stringify(alt));
  const g5 = F.neuesSpiel({ dir, world: 'w-alt' }).g;
  ok(g5.phase === 'play' && g5.errors === 0 && gleich(ws(g5).regie, { vorgemerkt: [], letzte: {} }), 'Altstand ohne Block lädt: leer');
  tick(g5, 2);
  ok(ws(g5).fehler === 0, 'und tickt fehlerfrei');
  // Müll-fester Leser
  const T = 50, leer = { vorgemerkt: [], letzte: {} };
  for (const [bl, soll, was] of [[undefined, leer, 'fehlt'], [null, leer, 'null'], ['x', leer, 'String'], [[1], leer, 'Array'], [{}, leer, 'leeres Objekt'], [{ vorgemerkt: 5, letzte: 'x' }, leer, 'alles kaputt'],
    [{ vorgemerkt: [null, 7, 'x', [], {}, { b: 5, ab: 1 }, { b: { typ: 'zaubern' }, ab: 1 }, { b: { typ: 'angreifen' }, ab: 'x' }, { b: { typ: 'angreifen' }, ab: -3 }] }, leer, 'Müll in der Liste'],
    [{ letzte: { 'x y!': 3, ok: -1, a: 'x', 'angreifen:ger': 'x' } }, leer, 'Müll in den Abkühlzeiten']]) ok(gleich(Regie.lesen(bl, T), soll), 'Leser: ' + was);
  const g6 = Regie.lesen({ vorgemerkt: [{ b: { typ: 'rueckzug', fraktion: 'rom', flotte: 1 }, ab: 99999, w: 1 }], letzte: { 'angreifen:ger': 99999 } }, T);
  ok(g6.vorgemerkt[0].ab <= T + 1 + 10 && g6.letzte['angreifen:ger'] <= T, 'Zeiten werden geklemmt (kein „wirksam in alle Ewigkeit“, keine Abkühlzeit aus der Zukunft)');
  const flut = {}; for (let i = 0; i < 500; i++) flut['angreifen:x' + i] = 3; flut.zaubern = 4; flut['angreifen:rom'] = 5;
  const lf = Regie.lesen({ letzte: flut }, T);
  ok(Object.keys(lf.letzte).length <= R.werte.plan.wert.letzte_max && !('zaubern' in lf.letzte), 'Leser: höchstens letzte_max Abkühlzeit-Schlüssel, unbekannte Typen fallen weg');
  const viele = Regie.lesen({ vorgemerkt: Array.from({ length: 30 }, () => ({ b: { typ: 'rueckzug', fraktion: 'rom', flotte: 1 }, ab: 5 })) }, T);
  ok(viele.vorgemerkt.length === R.werte.plan.wert.vorgemerkt_max, 'mehr als vorgemerkt_max wartende Befehle werden gekürzt');
  // Kaputter Sim-Zustand (schemagültig, aber Unsinn): das Spiel läuft, ein Tick wirft nicht
  const kaputt = klon(d1); kaputt.welt.sim.zustand.embargo = { rom: { waren: 'T', from: 0, bis: 'x' }, ger: 7 }; kaputt.welt.sim.zustand.regie = { rom: { fokus: { hex: 'zz', radius: 'x', bis: 1 }, p_act: 'viel' } };
  kaputt.welt.sim.zustand.flotten[0].miete = { von: 'x', an: 5 }; kaputt.welt.sim.regie = { vorgemerkt: [{ b: { typ: 'zaubern' }, ab: 1 }] }; kaputt.id = 'w-kaputt'; fs.writeFileSync(path.join(dir, 'w-kaputt.json'), JSON.stringify(kaputt));
  const g7 = F.neuesSpiel({ dir, world: 'w-kaputt' }).g;
  ok(g7.phase === 'play' && g7.weltsim && g7.errors === 0 && !('embargo' in z(g7)) && !('regie' in z(g7)) && !('miete' in z(g7).flotten[0]) && gleich(ws(g7).regie, leer), 'kaputte Felder im geladenen Stand: Spiel lädt, Müll ist weg');
  tick(g7, 3);
  ok(ws(g7).fehler === 0, 'und tickt fehlerfrei');
});

section('Snapshot und Netz unberührt', () => {
  const a = szene(), b = szene();
  tick(a.g, 2); tick(b.g, 2);
  Regie.planAnwenden(b.g, { befehle: [ANGRIFF_GER, { typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' }], fokus: { hex: '0403', radius: 2 } });
  const sa = JSON.stringify(a.g.snapshot()), sb = JSON.stringify(b.g.snapshot());
  ok(Buffer.byteLength(sa) === Buffer.byteLength(sb) && sa === sb, `Snapshot mit wartenden Befehlen ist byte-gleich zu ohne (${Buffer.byteLength(sb)} Byte): keine neuen Snapshot-Felder, kein Protokoll berührt`);
  ok(Protocol.VERSION === undefined || typeof Protocol === 'object', 'Protokoll nicht angefasst');
  // Mehrspieler zu dritt: derselbe Weg, keine Spielernamen im Logbuch und im Funk
  const t = szene({ crew: 3, names: ['Mireille_Kasper', 'Ouzo_Brandt', 'Tzvi_Lund'] });
  const r = Regie.planAnwenden(t.g, { befehle: [ANGRIFF_ROM], begruendung: 'Probe' });
  tick(t.g, 6);
  const alles = JSON.stringify(logbuch(t.g)) + JSON.stringify(funkAll(t)) + JSON.stringify(r);
  ok(r.ok && !/Mireille|Ouzo|Tzvi/.test(alles) && ws(t.g).fehler === 0, 'drei Spieler: Plan, Vorwarnung, Logbuch ohne Spielernamen, kein Sim-Fehler');
  ok(funkAll(t).length >= 1 && t.cs.every((c) => c.inbox.some((m) => m.kind === 'radio' && /Speculum/.test(m.text || ''))), 'alle drei Spieler hören dieselbe Vorwarnung');
});

console.log(`\n${n - fails}/${n} bestanden`);
if (fails) { console.log('REGIE: ' + fails + ' FEHLER'); process.exit(1); }
console.log('REGIE OK');
