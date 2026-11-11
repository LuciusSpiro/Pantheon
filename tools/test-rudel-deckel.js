'use strict';
// SPL-01 a4: Rudel-Deckel im Prüfer (server/mission/checker.js, Baustein kreatur_besetzen in server/mission/bausteine/kreaturen.js). Entscheidung Kai 2026-11-05:
// je Rudel 3 bis 4 Tiere, höchstens 2 Rudel je Karte, Rudel nie im Höhlen-Deck unter einer Wildnis. Die Zahlen stehen als Daten je Typ in content/kampf/kreaturen.json (Feld rudel), der Prüfer liest sie.
// Geprüft: (a) mehr als 2 Rudel je Karte abgelehnt, 1 und 2 gültig, Zählung je Karte und je gruppe; (b) Rudelgröße außerhalb 3 bis 4 abgelehnt, 3 und 4 gültig; (c) bereich im Höhlen-Deck unter einer Wildnis
// abgelehnt (hoehle, hoehle_lager_n), Oberfläche und eigene Höhlenkarte gültig; (d) andere Typen (probe, schwarmling) und nest_besetzen unberührt; (e) die Zahlen kommen aus den Daten (Werte ändern, Typ ohne Feld,
// Feldprüfung der Daten); (f) der Spielleiter-Pfad (Katalog-Fragment) lehnt ab, die Laufzeit rudelSetzen bleibt ohne Deckel;
// (g) Grobplan (SPL-01 Nacharbeit W1): szenenbau.aufloesen meldet BUEHNE-RUDEL, wenn zwei Szenen auf demselben Landepunkt zusammen mehr Rudel setzen könnten als jeKarte (Daten, kein Umsetzungsname).
//   node tools/test-rudel-deckel.js   (npm run test:rudel-deckel; Mutationsprobe: tools/mutation-rudel-deckel.js)
const fs = require('fs');
const path = require('path');
const Checker = require('../server/mission/checker.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};

const BOOK = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher', 'm3.regiebuch.json'), 'utf8'));
const KESH = BOOK.buehne.aussenkarten[0];
const WILDNIS = 'kesh.wildnis-1', WILDNIS2 = 'kesh.wildnis-2', HOEHLE = 'kesh.hoehle-1';
// Buch mit den Aktionen im ersten Schritt (enter) und den Karten in der Bühne; liefert die PARAM-WERT-Fehler, die kreatur_besetzen und nest_besetzen betreffen
const pruefe = (aktionen, karten) => {
  const b = JSON.parse(JSON.stringify(BOOK));
  b.buehne.aussenkarten = Array.from(new Set(b.buehne.aussenkarten.concat(karten || [])));
  b.steps[0].enter = (b.steps[0].enter || []).concat(aktionen.map((a) => Object.assign({ do: 'kreatur_besetzen' }, a)));
  const r = Checker.check(b);
  return r.errors.filter((e) => /kreatur_besetzen|nest_besetzen/.test(e.msg || '') && e.code === 'PARAM-WERT');
};
const rudel = (map, gruppe, anzahl, extra) => Object.assign({ map, typ: 'rudeltier', anzahl, gruppe }, extra || {});
const texte = (fe) => fe.map((e) => e.msg);

section('Grundlage: das Buch ohne Rudel besteht, die Daten tragen den Deckel', () => {
  ok(pruefe([]).length === 0, 'Ausgangsbuch m3: keine PARAM-WERT-Fehler zu kreatur_besetzen');
  const R = Kreatur.rudelRegel('rudeltier');
  ok(!!R && R.tiere.min === 3 && R.tiere.max === 4 && R.jeKarte === 2, 'kreaturen.json typen.rudeltier.rudel = { tiere { 3, 4 }, jeKarte 2 } (' + JSON.stringify(R) + ')');
  ok(Kreatur.rudelRegel('probe') === null && Kreatur.rudelRegel('schwarmling') === null && Kreatur.rudelRegel('koenigin') === null && Kreatur.rudelRegel('gibtsnicht') === null, 'andere Typen und unbekannte Typen haben keinen Deckel');
});

section('(a) Rudel je Karte: 1 und 2 gültig, 3 abgelehnt', () => {
  ok(pruefe([rudel(KESH, 'r1', 3)]).length === 0, '1 Rudel gültig');
  ok(pruefe([rudel(KESH, 'r1', 3), rudel(KESH, 'r2', 4)]).length === 0, '2 Rudel gültig');
  const fe = pruefe([rudel(KESH, 'r1', 3), rudel(KESH, 'r2', 4), rudel(KESH, 'r3', 3)]);
  ok(fe.length === 1 && fe[0].msg === "'kreatur_besetzen' setzt mehr als 2 Rudel des Typs 'rudeltier' auf Karte '" + KESH + "' (Rudel 'r3' ist das 3., content/kampf/kreaturen.json typen.rudeltier.rudel.jeKarte)", '3 Rudel: genau ein Fehler mit genauem Text (' + texte(fe).join(' | ') + ')');
  ok(fe.length === 1 && /^steps\[0:[^\]]+\]\.enter\.do\(kreatur_besetzen\)$/.test(fe[0].p), 'Fehler zeigt auf Schritt und Aktion (' + (fe[0] && fe[0].p) + ')');
  ok(pruefe([rudel(KESH, 'r1', 3), rudel(KESH, 'r2', 3), rudel(WILDNIS, 'r3', 3), rudel(WILDNIS, 'r4', 3)], [WILDNIS]).length === 0, '2 Rudel auf der einen und 2 auf der anderen Karte: gültig (der Deckel gilt je Karte)');
  ok(pruefe([rudel(KESH, 'r1', 3), rudel(KESH, 'r1', 4), rudel(KESH, 'r2', 3)]).length === 0, 'dieselbe gruppe zweimal (zwei Zweige) zählt als ein Rudel');
  ok(pruefe([rudel(KESH, 'r1', 3), rudel(KESH, 'r2', 3), rudel(KESH, 'r3', 3), rudel(KESH, 'r4', 3)]).length === 2, '4 Rudel: ein Fehler je überzähligem Rudel (r3, r4)');
  ok(pruefe([rudel(KESH, 'r1', 3), rudel(KESH, 'r2', 3), rudel(KESH, 'r3', 3), rudel(KESH, 'r3', 4), rudel(KESH, 'r1', 4)]).length === 1, '3 Rudel, das dritte und das erste in einem zweiten Zweig wiederholt: weiter nur ein Fehler (für r3)');
  ok(pruefe([rudel(KESH, 'r1', 3), rudel(KESH, 'r2', 3), rudel(WILDNIS, 'r3', 3), rudel(WILDNIS2, 'r4', 3)], [WILDNIS, WILDNIS2]).length === 0, 'Rudel auf drei verschiedenen Karten (zusammen 4): gültig');
});

section('(b) Rudelgröße: 3 und 4 gültig, 1, 2, 5 und 12 abgelehnt', () => {
  ok(pruefe([rudel(KESH, 'a', 3)]).length === 0 && pruefe([rudel(KESH, 'a', 4)]).length === 0, '3 und 4 Tiere gültig');
  for (const anz of [1, 2, 5, 12]) {
    const fe = pruefe([rudel(KESH, 'a', anz)]);
    ok(fe.length === 1 && fe[0].msg === "'kreatur_besetzen' 'anzahl' = " + anz + " außerhalb der Rudelgröße 3–4 des Typs 'rudeltier' (content/kampf/kreaturen.json typen.rudeltier.rudel.tiere)", anz + ' Tiere: genau ein Fehler mit genauem Text (' + texte(fe).join(' | ') + ')');
  }
  const b13 = JSON.parse(JSON.stringify(BOOK));
  b13.steps[0].enter = (b13.steps[0].enter || []).concat([Object.assign({ do: 'kreatur_besetzen' }, rudel(KESH, 'a', 13))]);
  const f13 = Checker.check(b13).errors.filter((e) => e.code === 'PARAM-WERT');
  ok(f13.length === 2 && f13.some((e) => /außerhalb 1–12/.test(e.msg)) && f13.some((e) => /Rudelgröße 3–4/.test(e.msg)), '13 Tiere: der allgemeine Bereichsfehler 1–12 bleibt bestehen, dazu der Rudelfehler (' + f13.length + ' Fehler)');
  ok(pruefe([rudel(KESH, 'a', { cfg: 'gibtsnicht' })]).length === 0, 'config-Verweis statt Zahl: kein Rudelfehler, kein Absturz');
});

section('(c) Bereich im Höhlen-Deck unter einer Wildnis', () => {
  for (const b of ['hoehle', 'hoehle_lager_1']) {
    const fe = pruefe([rudel(WILDNIS, 'a', 3, { bereich: b })], [WILDNIS]);
    ok(fe.length === 1 && fe[0].msg === "'kreatur_besetzen' 'bereich' = \"" + b + "\" liegt im Höhlen-Deck unter der Wildnis '" + WILDNIS + "' (Rudel dort scheitern: die Platzierung kennt keine Decks); Rudel nur auf der Oberfläche oder auf einer eigenen Höhlenkarte", 'Wildnis, bereich ' + b + ': genau ein Fehler mit genauem Text (' + texte(fe).join(' | ') + ')');
  }
  ok(pruefe([rudel(WILDNIS, 'a', 3, { bereich: 'gelaende' }), rudel(WILDNIS, 'b', 4, { bereich: 'lager_1' })], [WILDNIS]).length === 0, 'Wildnis, Bereiche der Oberfläche (gelaende, lager_1): gültig');
  ok(pruefe([rudel(WILDNIS, 'a', 3)], [WILDNIS]).length === 0, 'Wildnis ohne bereich: gültig');
  ok(pruefe([rudel(HOEHLE, 'a', 3, { bereich: 'hoehle' }), rudel(HOEHLE, 'b', 3, { bereich: 'hoehle_lager_1' })], [HOEHLE]).length === 0, 'eigene Höhlenkarte: bereich hoehle und hoehle_lager_1 gültig');
});

section('(d) andere Typen und Schwarm-Pfade unberührt', () => {
  const g = (typ, i, anz) => ({ map: KESH, typ, anzahl: anz, gruppe: 'g' + i });
  ok(pruefe([g('probe', 1, 1), g('probe', 2, 12), g('probe', 3, 7), g('probe', 4, 2)]).length === 0, 'typ probe: 1, 12, 7, 2 Tiere und vier Gruppen auf einer Karte gültig');
  ok(pruefe([g('schwarmling', 1, 12), g('schwarmling', 2, 1), g('schwarmling', 3, 5)]).length === 0, 'typ schwarmling: beliebig viele Gruppen und Größen gültig');
  ok(pruefe([rudel(WILDNIS, 'p', 1, { typ: 'probe', bereich: 'hoehle' })], [WILDNIS]).length === 1, 'Deck-Regel (c) gilt für jeden Typ (die Platzierung scheitert für alle gleich), Größe und Anzahl von probe bleiben frei');
  const nest = [1, 2, 3].map((i) => ({ do: 'nest_besetzen', map: KESH, typ: 'koenigin', gruppe: 'q' + i }));
  ok(pruefe(nest).length === 0, 'nest_besetzen (typ koenigin, drei Gruppen): unberührt');
  ok(pruefe(nest.concat([rudel(KESH, 'r1', 3), rudel(KESH, 'r2', 3)])).length === 0, 'Nester zählen nicht als Rudel: 3 Nester + 2 Rudel gültig');
});

section('(e) Zahlen aus den Daten', () => {
  const T = KREATUREN.typen.rudeltier;
  const alt = JSON.stringify(T.rudel);
  try {
    T.rudel = { tiere: { min: 2, max: 5 }, jeKarte: 3 };
    ok(pruefe([rudel(KESH, 'a', 2), rudel(KESH, 'b', 5), rudel(KESH, 'c', 3)]).length === 0, 'Daten min 2, max 5, jeKarte 3: 2 und 5 Tiere und drei Rudel gültig');
    ok(pruefe([rudel(KESH, 'a', 6)]).length === 1 && /2–5/.test(pruefe([rudel(KESH, 'a', 6)])[0].msg), 'Daten max 5: 6 Tiere abgelehnt, der Text nennt 2–5');
    ok(pruefe([rudel(KESH, 'a', 3), rudel(KESH, 'b', 3), rudel(KESH, 'c', 3), rudel(KESH, 'd', 3)]).length === 1, 'Daten jeKarte 3: das vierte Rudel abgelehnt');
    delete T.rudel;
    ok(pruefe([rudel(KESH, 'a', 12), rudel(KESH, 'b', 1), rudel(KESH, 'c', 7), rudel(KESH, 'd', 3)]).length === 0, 'Typ ohne rudel-Feld: kein Deckel (12, 1, 7, 3 Tiere, vier Rudel)');
  } finally { T.rudel = JSON.parse(alt); }
  ok(pruefe([rudel(KESH, 'a', 5)]).length === 1, 'Daten zurückgesetzt: 5 Tiere wieder abgelehnt');
  const schlecht = (r) => { const d = JSON.parse(JSON.stringify(KREATUREN)); d.typen.rudeltier.rudel = r; return Kreatur.pruefen(d); };
  ok(Kreatur.pruefen(KREATUREN).length === 0, 'kreaturen.json besteht die Feldprüfung');
  ok(schlecht({ tiere: { min: 4, max: 3 }, jeKarte: 2 }).some((f) => /rudel\.tiere/.test(f)), 'Feldprüfung: min > max abgelehnt');
  ok(schlecht({ tiere: { min: 0, max: 3 }, jeKarte: 2 }).some((f) => /rudel\.tiere/.test(f)), 'Feldprüfung: min 0 abgelehnt');
  ok(schlecht({ tiere: { min: 3, max: 40 }, jeKarte: 2 }).some((f) => /rudel\.tiere/.test(f)), 'Feldprüfung: max über 12 abgelehnt');
  ok(schlecht({ tiere: { min: 3, max: 4 }, jeKarte: 0 }).some((f) => /rudel\.jeKarte/.test(f)), 'Feldprüfung: jeKarte 0 abgelehnt');
  ok(schlecht({ tiere: { min: 3, max: 4 } }).some((f) => /rudel\.jeKarte/.test(f)), 'Feldprüfung: jeKarte fehlt');
  ok(schlecht({ tiere: { min: 3, max: 4 }, jeKarte: 2, extra: 1 }).some((f) => /rudel\.extra/.test(f)), 'Feldprüfung: unbekanntes Feld abgelehnt');
  ok(schlecht(5).some((f) => /rudel/.test(f)), 'Feldprüfung: rudel kein Objekt abgelehnt');
});

section('(f) Spielleiter-Pfad: Katalog-Fragment; Laufzeit ohne Deckel', () => {
  const Katalog = require('../server/mission/katalog.js');
  const KAT = Katalog.load({});
  const U = KAT.molekuele.stellung_nehmen.umsetzungen.find((x) => x.id === 'kreaturen_in_hoehle');
  const { frag } = Katalog.instantiate(U, { loc: 'kesh', map: HOEHLE, typ: 'rudeltier' }, 's1', 'test_ende');
  const gut = Checker.check(Katalog.testRegiebuch(frag, 'stellung_nehmen', U));
  ok(!gut.errors.some((e) => e.code === 'PARAM-WERT' && /kreatur_besetzen/.test(e.msg)), 'Katalog-Umsetzung kreaturen_in_hoehle (3 Tiere, ein Rudel): besteht den Deckel');
  const schlechtFrag = JSON.parse(JSON.stringify(frag));
  let geaendert = 0;
  (function lauf(x) { if (Array.isArray(x)) x.forEach(lauf); else if (x && typeof x === 'object') { if (x.do === 'kreatur_besetzen') { x.anzahl = 8; geaendert++; } Object.values(x).forEach(lauf); } })(schlechtFrag);
  const schlecht = Checker.check(Katalog.testRegiebuch(schlechtFrag, 'stellung_nehmen', U));
  ok(geaendert === 1 && schlecht.errors.some((e) => e.code === 'PARAM-WERT' && /'anzahl' = 8 außerhalb der Rudelgröße 3–4/.test(e.msg)), 'dasselbe Fragment mit 8 Tieren: der Prüfer lehnt ab (' + geaendert + ' Aktion geändert)');
  // Die Laufzeit bleibt bei 1 bis 12 (Debug-Befehl, Labor, Kampagnen-Tests): rudelSetzen liest den Deckel nicht
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'kreatur.js'), 'utf8');
  const rumpf = quelle.split('function rudelSetzen')[1].split('// ---------- Nest')[0];
  ok(/RUDEL_MAX = 12/.test(quelle) && !/rudelGroesseFehler|rudelJeKarteFehler|.tiere|.jeKarte/.test(rumpf), 'Laufzeit rudelSetzen liest den Deckel (Tiere, Rudel je Karte) nicht; rudel.abstand (SPL-01 c) ist kein Deckel (Debug, Labor, Rudel-Tests mit bis zu 12 Tieren bleiben möglich)');
});

section('(g) Grobplan: Rudel je Karte schon in aufloesen (SPL-01 Nacharbeit W1)', () => {
  const M = require('./lib/messe-spl.js');
  const SB = require('../server/mission/szenenbau.js');
  const C = require('../server/mission/context.js');
  const K = require('./katalog.js').load({});
  const env = SB.buildEnv(K);
  const welt = M.weltstand('nach-tutorial');
  const ctx = C.build(welt, M.anlass(), K); ctx.bodenbilanz = { letzte: [], pflicht_jetzt: false, lang_ab_min: 25 };
  const st = Object.values(K.szenentypen).find((t) => t.bereich === 'aussen' && t.status === 'verfuegbar' && (t.verfuegbare_molekuele || []).includes('stellung_nehmen'));
  const RUDEL = 'stellung_nehmen/rudeltiere_im_gelaende';
  const mol = (m) => ({ id: m.split('/')[0], umsetzung: m.split('/')[1] });
  const plan = (szenen) => {   // szenen: [{ buehne, mols }] -> Grobplan mit Hafen + Szenen s2, s3, ...
    const g = M.testplan({ szenentyp: st.id, ort: 'kesh', buehne: szenen[0].buehne, mols: szenen[0].mols });
    szenen.slice(1).forEach((x, i) => {
      const vor = g.szenen[g.szenen.length - 1];
      vor.weiter = [{ wenn: 'immer', nach: 's' + (i + 3) }];
      g.szenen.push(Object.assign(JSON.parse(JSON.stringify(vor)), { id: 's' + (i + 3), buehne: x.buehne, molekuele: x.mols.map(mol), weiter: [{ wenn: 'gut', nach: 'ausgang:erfolg' }, { wenn: 'sonst', nach: 'ausgang:teil' }] }));
    });
    return g;
  };
  const lauf = (g) => SB.aufloesen(g, env, ctx, { lp: C.lpAdapterAusWelt(welt) });
  const rudelFehler = (r) => r.errors.filter((e) => /^BUEHNE-RUDEL/.test(e));
  const wild = { kartenart: 'wildnis', neu: true };
  const eine = lauf(plan([{ buehne: wild, mols: [RUDEL] }]));
  ok(rudelFehler(eine).length === 0 && eine.errors.length === 0, 'eine Rudel-Szene auf neuer Wildnis: gültig (' + eine.errors.join(' | ') + ')');
  const zwei = lauf(plan([{ buehne: wild, mols: [RUDEL] }, { buehne: wild, mols: [RUDEL] }]));
  const fe = rudelFehler(zwei);
  ok(fe.length === 1 && /^BUEHNE-RUDEL: Szene 's3': Landepunkt '[^']+' trägt schon Rudel des Typs 'rudeltier' aus Szene 's2' \(bis zu 2\), diese Szene setzt bis zu 2 Rudel des Typs 'rudeltier' – höchstens 2 Rudel je Karte/.test(fe[0]), 'zwei Rudel-Szenen auf derselben neuen Karte: genau ein BUEHNE-RUDEL-Fehler mit sprechendem Text (' + fe.join(' | ') + ')');
  const verschieden = lauf(plan([{ buehne: wild, mols: [RUDEL] }, { buehne: { kartenart: 'hoehle', neu: true }, mols: [RUDEL] }]));
  ok(verschieden.errors.length === 0, 'zwei Rudel-Szenen auf verschiedenen neuen Karten (Wildnis, Höhle): gültig (' + verschieden.errors.join(' | ') + ')');
  const mitAndere = lauf(plan([{ buehne: wild, mols: [RUDEL] }, { buehne: wild, mols: ['personen_bergen/ueberlebende_suchen'] }]));
  ok(rudelFehler(mitAndere).length === 0, 'Rudel-Szene und Szene ohne Rudel auf derselben Karte: kein Rudel-Fehler');
  // Datengetrieben: die Zahl der möglichen Rudel kommt aus der Umsetzung (abgeleitet) und dem Typ (kreaturen.json), kein Umsetzungsname im Prüfer
  const u = env.katalog.molekuele.stellung_nehmen.umsetzungen.find((x) => x.id === 'rudeltiere_im_gelaende');
  const andere = env.katalog.molekuele.personen_bergen.umsetzungen.find((x) => x.id === 'ueberlebende_suchen');
  ok(Kreatur.rudelMaxJeUmsetzung(u).rudeltier === 2 && Object.keys(Kreatur.rudelMaxJeUmsetzung(andere)).length === 0, 'rudelMaxJeUmsetzung: rudeltiere_im_gelaende bis zu 2 Rudel, andere Umsetzung keine');
  const ka = (g, typ) => ({ do: 'kreatur_besetzen', map: 'm', typ: typ || 'rudeltier', anzahl: 3, gruppe: g });
  const synth = { vorlage: { steps: [{ enter: [ka('a'), ka('a'), ka('b'), ka('c', 'probe')] }] }, abgeleitet: { x: { '1': { v: ka('d') }, '2': { v: ka('e'), w: ka('f') } } } };
  ok(Kreatur.rudelMaxJeUmsetzung(synth).rudeltier === 4 && !('probe' in Kreatur.rudelMaxJeUmsetzung(synth)), 'rudelMaxJeUmsetzung (synthetisch): Vorlage zählt verschiedene Gruppen in Listen (a, b = 2, probe ohne rudel-Feld nicht) plus stärkste abgeleitet-Zeile (2) = 4');
  const T = KREATUREN.typen.rudeltier; const alt = JSON.stringify(T.rudel);
  try { delete T.rudel; ok(rudelFehler(lauf(plan([{ buehne: wild, mols: [RUDEL] }, { buehne: wild, mols: [RUDEL] }]))).length === 0, 'Typ ohne rudel-Feld in den Daten: kein Rudel-Fehler im Grobplan'); }
  finally { T.rudel = JSON.parse(alt); }
});

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen ok'));
process.exit(fails ? 1 : 0);
