'use strict';
// SPL-01 c: Spielleiter-Umsetzung stellung_nehmen/rudeltiere_im_gelaende (Rudeltiere auf Wildnis und Höhle, 1 oder 2 Rudel, 3 oder 4 Tiere), rein aus Daten (Katalog, `abgeleitet`).
// Geprüft: (a) Katalog: Umsetzung verfügbar, Kartenarten wildnis/hoehle, Anker nur abholpunkt (steht im Pflichtsatz beider Erzeuger), Parameter rudel (1|2) und tiere (3 bis 4 = Deckel in kreaturen.json),
//   beide Rudelzahlen bestehen den Regiebuch-Prüfer, je Rudel eine Aktion mit eigener gruppe, anzahl = tiere, Bedingung über ALLE Rudel, rueckfall.params gültig, ungültige Werte abgelehnt;
//   (b) Spielleiter-Prüfer: Plan auf neuer Wildnis (3 Biome, mit und ohne Höhle) und Höhle besteht, Szenenantwort mit 1/2 Rudeln und 3/4 Tieren besteht, BUEHNE-ART auf Siedlung, Station, Ruine, Schiff;
//   a4-Regeln greifen durch die Umsetzung (zu große Rudel, drittes Rudel, bereich im Höhlen-Deck unter Wildnis werden abgelehnt); (c) Mock-Rückfall: die Wahl der Bodenszene bleibt dieselbe wie ohne die Umsetzung;
//   (d) Platzierung: Wildnis (3 Biome x 3 Größen), Wildnis+Höhle, Höhle, ein und zwei Rudel: alle Tiere erreichbar, Abstand, Rudel verteilt (tools/lib/rudel-platz.js, wenige Seeds; voller Sweep: npm run messe:spl-rudel -- --platz);
//   Abstand zwischen Rudeln kommt aus den Daten (rudel.abstand); (e) Headless im echten Labor auf echter Wildnis (Transfer nach unten): Tiere entstehen je Rudel, Bedingung erst wenn ALLE Tiere beider Rudel erledigt sind,
//   Ereignis kreaturAusgefallen je Tier, keine Server-Fehler. Technikbeleg, kein Spieltest.
//   node tools/test-rudel-gelaende.js   (npm run test:rudel-gelaende; Mutationsprobe: tools/mutation-rudel-gelaende.js)
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');
const Katalog = require('../server/mission/katalog.js');
const Checker = require('../server/mission/checker.js');
const Context = require('../server/mission/context.js');
const SB = require('../server/mission/szenenbau.js');
const Labor = require('../server/mission/labor.js');
const Llm = require('../server/mission/llm.js');
const Interior = require('../server/sim/interior.js');
const GenHoehle = require('../shared/gen-hoehle.js');
const Platz = require('./lib/rudel-platz.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const kopie = (o) => JSON.parse(JSON.stringify(o));

const MOL = 'stellung_nehmen', UMS = 'rudeltiere_im_gelaende';
const KAT = Katalog.load({});
const umsetzung = (kat) => kat.molekuele[MOL].umsetzungen.find((x) => x.id === UMS);
const U = umsetzung(KAT);
const R = Kreatur.rudelRegel('rudeltier');
const WILDNIS = 'kesh.wildnis-1', HOEHLE = 'kesh.hoehle-1';
const frag = (params, u) => Katalog.instantiate(u || U, Object.assign({ loc: 'kesh', map: WILDNIS }, params || {}), 's1', 'test_ende');
const pruefer = (f, u) => Checker.check(Katalog.testRegiebuch(f, MOL, u || U));
const alleAktionen = (f) => { const a = []; (function lauf(x) { if (Array.isArray(x)) x.forEach(lauf); else if (x && typeof x === 'object') { if (x.do === 'kreatur_besetzen') a.push(x); Object.values(x).forEach(lauf); } })(f); return a; };
const kreaturFehler = (f, u) => pruefer(f, u).errors.filter((e) => /kreatur_besetzen|kreaturen_erledigt/.test(e.msg || ''));

section('(a) Katalog: Umsetzung, Parameter, Prüfer', () => {
  ok(!!U && U.status === 'verfuegbar' && U.pruefung.fehler === 0, 'Umsetzung steht im Katalog, verfügbar, Prüfer ohne Fehler');
  ok(JSON.stringify(U.buehne_braucht.kartenarten) === '["wildnis","hoehle"]', 'Kartenarten wildnis und hoehle');
  ok(JSON.stringify(U.buehne_braucht.anker) === '["abholpunkt"]', 'Anker nur abholpunkt');
  const GelaendeGen = require('../shared/gen-gelaende.js');
  ok(!!GelaendeGen.PFLICHT && GelaendeGen.PFLICHT.abholpunkt >= 1 && GenHoehle.PFLICHT && GenHoehle.PFLICHT.abholpunkt >= 1, 'abholpunkt steht im Pflichtsatz beider Erzeuger (Wildnis, Höhle)');
  ok(U.schauplatz === 'aussen' && !U.buehne_braucht.gefecht, 'Boden-Umsetzung (aussen)');
  ok(JSON.stringify(U.params.rudel.werte) === '["1","2"]' && U.params.rudel.default === '1', 'rudel: Text 1 oder 2, Standard 1');
  ok(!U.params.rudel.pflicht && !U.params.tiere.pflicht, 'rudel und tiere sind keine Pflicht (Standard gilt)');
  ok(U.params.tiere.typ === 'zahl' && U.params.tiere.min === R.tiere.min && U.params.tiere.max === R.tiere.max && U.params.tiere.default >= R.tiere.min && U.params.tiere.default <= R.tiere.max, 'tiere: Zahl, min/max = Deckel aus kreaturen.json (' + R.tiere.min + '–' + R.tiere.max + ')');
  ok(Object.keys(U.abgeleitet).join() === 'rudel' && Object.keys(U.abgeleitet.rudel).join() === '1,2', 'abgeleitet: eine Zeile je Rudelzahl');
  for (const rudel of ['1', '2']) for (const tiere of [3, 4]) {
    const { frag: f, errs } = frag({ rudel, tiere });
    const akt = alleAktionen(f);
    const gruppen = akt.map((a) => a.gruppe);
    ok(!errs.length && akt.length === Number(rudel) && new Set(gruppen).size === akt.length && akt.every((a) => a.typ === 'rudeltier' && a.anzahl === tiere && a.map === WILDNIS && !('bereich' in a)),
      'rudel ' + rudel + ', tiere ' + tiere + ': ' + akt.length + ' Aktion(en) kreatur_besetzen, je eigene gruppe (' + gruppen.join(', ') + '), anzahl ' + tiere + ', ohne bereich');
    const e = pruefer(f).errors;
    ok(e.length === 0, 'rudel ' + rudel + ', tiere ' + tiere + ': besteht den Regiebuch-Prüfer (' + e.map((x) => x.code + ' ' + x.msg).join(' | ').slice(0, 160) + ')');
    const st = f.steps[0];
    const chk = JSON.stringify(st.rules[0].if);
    const erl = (chk.match(/"name":"kreaturen_erledigt"/g) || []).length;
    ok(erl === Number(rudel) && gruppen.every((gr) => chk.includes('"gruppe":"' + gr + '"')), 'rudel ' + rudel + ': die Bedingung prüft kreaturen_erledigt für jede gruppe (' + erl + ')');
    ok(st.enter.filter((x) => x && x.do === 'kreatur_besetzen').every((x) => x.if && x.if.not && x.if.not.v === 's1_besetzt'), 'rudel ' + rudel + ': jede Besetzung ist gegen Wiederholung gesichert (nicht doppelt beim Laden)');
  }
  const rf = instantiateRueckfall();
  ok(rf.errs.length === 0 && pruefer(rf.frag).errors.length === 0 && JSON.stringify(U.rueckfall.params) === '{"rudel":"1","tiere":3}', 'rueckfall.params gültig und bestehen den Prüfer (' + JSON.stringify(U.rueckfall.params) + ')');
  ok(pruefer(Katalog.instantiate(U, U.test.params, 's1', 'test_ende').frag).errors.length === 0 && U.test.params.rudel === '2' && U.test.params.tiere === 4, 'test.params (2 Rudel, 4 Tiere, Landepunkt ' + U.test.params.map + ') bestehen den Prüfer');
  for (const [p, was] of [[{ rudel: '3' }, 'rudel 3'], [{ rudel: 2 }, 'rudel als Zahl'], [{ tiere: 2 }, 'tiere 2'], [{ tiere: 5 }, 'tiere 5'], [{ tiere: '3' }, 'tiere als Text'], [{ typ: 'schwarm' }, 'unbekannter Parameter typ'], [{ anzahl: 3 }, 'unbekannter Parameter anzahl']]) {
    ok(frag(p).errs.length > 0, 'Gegenprobe: ' + was + ' wird abgelehnt (' + frag(p).errs.join(' | ').slice(0, 70) + ')');
  }
  ok(frag({ rudel: '1', tiere: 3 }).errs.length === 0 && frag({}).errs.length === 0, 'ohne Angaben (Standard) gültig');
  const fb = JSON.stringify(Katalog.instantiate(KAT.molekuele[MOL].umsetzungen.find((x) => x.id === 'kreaturen_in_hoehle'), { loc: 'kesh', map: HOEHLE, typ: 'rudeltier' }, 's1', 'w').frag);
  ok(/"anzahl":3/.test(fb) && !/"gruppe":"s1_ka"/.test(fb) && /"gruppe":"s1_k"/.test(fb), 'Gegenprobe: kreaturen_in_hoehle bleibt unverändert (ein Rudel mit 3 Tieren, gruppe s1_k)');
});
function instantiateRueckfall() { return Katalog.instantiate(U, Object.assign({ loc: 'kesh', map: WILDNIS }, U.rueckfall.params), 's1', 'test_ende'); }

// ---------- (b) Spielleiter-Prüfer ----------
const ctx = Context.build({}, {}, KAT);
const plan = (szene) => ({
  format: 'grobplan/2', id: 'rg_test', titel: 'Rudel-Test', auftraggeber: 'melk', zielspieldauer_min: 12, aufhaenger: 'Ein Testauftrag.',
  szenen: [{ id: 's1_hafen', szenentyp: 'hafen', ort: 'hafen', karte: null, molekuele: [], sachverhalt: 'Auftrag.', wendung: null, dauer_min: 2, weiter: [{ wenn: 'immer', nach: 's2_rudel' }] },
    Object.assign({ id: 's2_rudel', szenentyp: 'gefecht', ort: 'kesh', karte: null, sachverhalt: 'Rudeltiere im Gelände.', wendung: null, dauer_min: 6,
      molekuele: [{ id: MOL, umsetzung: UMS }], buehne: { kartenart: 'wildnis', neu: true },
      weiter: [{ wenn: 'gut', nach: 'ausgang:erfolg' }, { wenn: 'schlecht', nach: 'ausgang:abbruch' }] }, szene || {})],
  entscheidungen: [],
  ausgaenge: { erfolg: { wann: 'Die Tiere sind erledigt.' }, abbruch: { wann: 'Die Crew bricht ab.' } },
});
const antwort = (params) => JSON.stringify({ molekuele: [{ id: MOL, umsetzung: UMS, params: Object.assign({ loc: 'kesh', map: WILDNIS }, params || {}) }], verzweigung: [{ nach: 'ausgang:erfolg', if: { flag: 's2_rudel_geraeumt' } }, { nach: 'ausgang:abbruch' }], wendung: null });

section('(b) Spielleiter-Prüfer: Plan, Szenenantwort, Kartenarten, a4-Regeln', () => {
  const env = SB.buildEnv(KAT);
  for (const art of ['wildnis', 'hoehle']) {
    const g = plan({ buehne: { kartenart: art, neu: true } });
    const r = SB.aufloesen(g, env, ctx);
    ok(!r.errors.length, art + ': Plan mit Szene auf neuer Karte besteht aufloesen (' + r.errors.join(' | ').slice(0, 160) + ')');
    ok(new RegExp('^kesh\\.' + art + '-\\d+$').test(g.szenen[1].landepunkt || ''), art + ': neuer Landepunkt gesetzt (' + g.szenen[1].landepunkt + ')');
    for (const [rudel, tiere] of [['1', 3], ['1', 4], ['2', 3], ['2', 4]]) {
      const e = SB.evaluateScene(g, 's2_rudel', antwort({ rudel, tiere }), env);
      ok(e.gueltig, art + ': Szenenantwort rudel ' + rudel + ', tiere ' + tiere + ' besteht (' + e.details.join(' | ').slice(0, 160) + ')');
    }
    const e0 = SB.evaluateScene(g, 's2_rudel', antwort({}), env);
    ok(e0.gueltig, art + ': Szenenantwort ohne rudel/tiere (Standard) besteht');
    const b = SB.buildBook(g, { s2_rudel: { answer: JSON.parse(antwort({ rudel: '2', tiere: 4, map: undefined })), quelle: 'llm' } }, env, { id: 'rg_buch', kontext: ctx });
    const st = (b.book && b.book.steps || []).find((s) => s.id === 's2_rudel');
    const akt = st ? alleAktionen(st) : [];
    ok(!b.errors.length && akt.length === 2 && akt.every((a) => a.map === g.szenen[1].landepunkt && a.anzahl === 4), art + ': vollständiges Buch ohne Prüferfehler, zwei Rudel zu je 4 Tieren auf der Karte der Szene (' + b.errors.map((x) => x.code + ' ' + x.msg).join(' | ').slice(0, 160) + ')');
  }
  for (const art of ['aussenposten', 'station', 'ruine', 'schiff']) {
    const g = plan({ buehne: { kartenart: art, neu: true } });
    const r = SB.aufloesen(g, env, ctx);
    ok(r.errors.some((x) => /^BUEHNE-ART/.test(x)), 'Gegenprobe: Kartenart ' + art + ' wird mit BUEHNE-ART abgelehnt (' + r.errors.join(' | ').slice(0, 100) + ')');
  }
  const g0 = plan();
  for (const [p, was] of [[{ rudel: '3' }, 'rudel 3'], [{ tiere: 5 }, 'tiere 5'], [{ tiere: 2 }, 'tiere 2'], [{ rudel: '2', tiere: 7 }, 'tiere 7']]) {
    ok(!SB.evaluateScene(g0, 's2_rudel', antwort(p), env).gueltig, 'Gegenprobe: Szenenantwort mit ' + was + ' wird abgelehnt');
  }
  // a4-Regeln greifen durch die Umsetzung: Werte außerhalb des Deckels, hergestellt über eine Kopie des Katalogs mit geweiteten Parametergrenzen bzw. zusätzlicher Aktion
  const k2 = kopie(KAT); const u2 = umsetzung(k2); u2.params.tiere.max = 9;
  const fe = kreaturFehler(frag({ tiere: 6 }, u2).frag, u2);
  ok(fe.length >= 1 && fe.every((x) => /Rudelgröße 3–4/.test(x.msg)), 'a4 Rudelgröße: Umsetzung mit geweiteter Parametergrenze und 6 Tieren: Prüfer lehnt ab (' + fe.map((x) => x.msg).join(' | ').slice(0, 120) + ')');
  const u3 = umsetzung(kopie(KAT));
  const f3 = frag({ rudel: '2' }, u3).frag;
  const zusatz = kopie(alleAktionen(f3)[0]); zusatz.gruppe = 's1_kc';
  f3.steps[0].enter.splice(1, 0, zusatz);
  const fe3 = kreaturFehler(f3, u3);
  ok(fe3.length === 1 && /mehr als 2 Rudel/.test(fe3[0].msg), 'a4 Rudel je Karte: ein drittes Rudel in der Szene wird abgelehnt (' + fe3.map((x) => x.msg).join(' | ').slice(0, 120) + ')');
  const f4 = frag({ rudel: '1' }).frag;
  alleAktionen(f4)[0].bereich = 'hoehle';
  const fe4 = kreaturFehler(f4);
  ok(fe4.length === 1 && /Höhlen-Deck unter der Wildnis/.test(fe4[0].msg), "a4 Deck: bereich 'hoehle' auf der Wildnis wird abgelehnt (" + fe4.map((x) => x.msg).join(' | ').slice(0, 100) + ')');
  const f5 = frag({ rudel: '2' }).frag;
  for (const a of alleAktionen(f5)) a.bereich = 'gelaende';
  ok(kreaturFehler(f5).length === 0, "Gegenprobe: bereich 'gelaende' (Oberfläche) bleibt gültig");
  const kurz = Katalog.fuerSpielleiter(KAT, 'kurz'), voll = Katalog.fuerSpielleiter(KAT, 'voll');
  ok(kurz.includes(UMS) && /rudel:text\(1\|2\)/.test(voll) && /tiere:zahl/.test(voll), 'Katalog-Text nennt die Umsetzung (kurz) und die Parameter rudel und tiere (voll)');
  ok(!/Spieler|Kai\b/.test(JSON.stringify(U)), 'keine Spielernamen in der Umsetzung');
});

// ---------- (c) Mock-Rückfall ----------
section('(c) Mock-Rückfall: Wahl der Bodenszene unverändert', () => {
  const kOhne = kopie(KAT); const mol = kOhne.molekuele[MOL]; mol.umsetzungen = mol.umsetzungen.filter((x) => x.id !== UMS);
  const eingabe = (pflicht) => ({ anlass: { auftraggeber: 'tesk' }, kontext: { npc: [{ id: 'tesk' }], bodenbilanz: { letzte: [], pflicht_jetzt: pflicht, lang_ab_min: 25 } } });
  for (const pflicht of [false, true]) {
    const mit = Llm.mockGrobplan(eingabe(pflicht), KAT), ohne = Llm.mockGrobplan(eingabe(pflicht), kOhne);
    ok(JSON.stringify(mit) === JSON.stringify(ohne), 'Bodenquote ' + (pflicht ? 'fällig' : 'nicht fällig') + ': Mock-Grobplan mit und ohne die Umsetzung gleich (Szene A: ' + (mit.szenen[1].molekuele[0] || {}).id + '/' + (mit.szenen[1].molekuele[0] || {}).umsetzung + ')');
  }
  const gewaehlt = Llm.mockGrobplan(eingabe(true), KAT).szenen[1].molekuele[0];
  ok(gewaehlt.umsetzung !== UMS, 'die Bodenszene des Mocks ist nicht die neue Umsetzung (' + gewaehlt.id + '/' + gewaehlt.umsetzung + ')');
  // Ordnung der Auswahl: Szenentyp-Kennung, Molekül-Id, Umsetzungs-Id; die Umsetzung steht in C2/stellung_nehmen hinter der ersten Bodenumsetzung
  const plan2 = Llm.mockGrobplan(eingabe(true), KAT);
  ok(!!plan2.szenen[1].szenentyp, 'Szene A ist eine Bodenszene (' + plan2.szenen[1].szenentyp + ')');
});

// ---------- (d) Platzierung ----------
section('(d) Platzierung: erreichbar, Abstand, Rudel verteilt (wenige Seeds)', () => {
  const faelle = Platz.sweep(6);
  const karten = faelle.reduce((a, f) => a + f.karten, 0), schlecht = faelle.filter((f) => f.probleme);
  ok(faelle.length === 72 && karten === 72 * 6, '72 Fälle (18 Kartenarten x 4 Rudelvarianten), ' + karten + ' Karten');
  ok(!schlecht.length, 'alle Rudelplätze erreichbar, vom Abholpunkt weg, Tiere auf Abstand, Rudel mindestens ' + Platz.ZWISCHEN + ' Kacheln auseinander, Deck 0' + (schlecht.length ? ': ' + schlecht.slice(0, 3).map((f) => f.name + ' ' + JSON.stringify(f.meldungen)).join('; ') : ''));
  const zwei = faelle.filter((f) => /2 Rudel/.test(f.name));
  ok(zwei.length === 36 && zwei.every((f) => f.zwischenMin !== null && f.zwischenMin >= Platz.ZWISCHEN), 'bei zwei Rudeln liegt der kleinste Abstand in jedem der 36 Fälle bei mindestens ' + Platz.ZWISCHEN + ' Kacheln');
  ok(R.abstand === 12 && Platz.ZWISCHEN <= R.abstand, 'der Abstand steht als Datum in kreaturen.json (rudel.abstand ' + R.abstand + ' Kacheln) und deckt das Messkriterium');
  // ohne das Datum würden Rudel in der Höhle zu nah beieinander stehen: das Datum wirkt
  const T = KREATUREN.typen.rudeltier; const alt = T.rudel.abstand;
  const zuNah = (abstand) => {
    if (abstand === undefined) delete T.rudel.abstand; else T.rudel.abstand = abstand;
    let zn = 0;
    for (let seed = 1; seed <= 12; seed++) { const r = Platz.fall({ art: 'hoehle', seed, groesse: 'klein' }, [{ gruppe: 'r_a', anzahl: 4 }, { gruppe: 'r_b', anzahl: 4 }]); if (r.probleme.some((p) => /zu nah/.test(p))) zn++; }
    return zn;
  };
  try {
    const ohne = zuNah(undefined), mit = zuNah(alt);
    ok(ohne > 0 && mit === 0, 'Höhle klein, 12 Seeds, 2 Rudel: ohne rudel.abstand ' + ohne + ' Karten mit zu nahen Rudeln, mit dem Datum ' + mit);
  } finally { T.rudel.abstand = alt; }
  const schlechtD = (r) => { const d = kopie(KREATUREN); d.typen.rudeltier.rudel = r; return Kreatur.pruefen(d); };
  ok(Kreatur.pruefen(KREATUREN).length === 0, 'kreaturen.json besteht die Feldprüfung');
  ok(schlechtD({ tiere: { min: 3, max: 4 }, jeKarte: 2, abstand: -1 }).some((f) => /rudel\.abstand/.test(f)) && schlechtD({ tiere: { min: 3, max: 4 }, jeKarte: 2, abstand: 'x' }).some((f) => /rudel\.abstand/.test(f)), 'Feldprüfung: abstand negativ oder Text abgelehnt');
  ok(schlechtD({ tiere: { min: 3, max: 4 }, jeKarte: 2 }).length === 0 && schlechtD({ tiere: { min: 3, max: 4 }, jeKarte: 2, abstand: 0 }).length === 0, 'Feldprüfung: abstand ist optional (fehlt oder 0 gültig)');
});

// ---------- (e) Headless im echten Labor ----------
const HZ = CONFIG.tickHz;
function labor(rudel, tiere, seed, opt) {
  const o = opt || {};
  const g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 3; i++) { const c = { inbox: [], send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'L' + i, name: 'L' + i, color: i }); cs.push(c); }
  g.reset(); g.phase = 'play';
  const S = { g, cs, me: [], fehler: [] };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { S.me.push({ nm, d }); return m0(nm, d); };
  const kat = Katalog.load({}); const u = umsetzung(kat);
  u.rueckfall.params = { rudel, tiere };   // das Labor setzt rueckfall.params über test.params
  // Startplätze der Rudel gleich nach dem Setzen festhalten (die Tiere laufen danach Streife und Jagd)
  S.start0 = [];
  const setzen0 = Kreatur.rudelSetzen;
  Kreatur.rudelSetzen = function (game, p) { const r = setzen0.apply(this, arguments); const aw = game.aways && game.aways[p.map]; for (const k of (aw && aw.kreaturen) || []) if (r.ids && r.ids.includes(k.id)) S.start0.push({ id: k.id, gruppe: k.gruppe, x: k.x, y: k.y }); return r; };
  S.fertig = () => { Kreatur.rudelSetzen = setzen0; };
  S.start = Labor.laborStart(g, MOL + '/' + UMS, Object.assign({ seed, katalog: kat, god: true }, o.buehne ? { buehne: o.buehne } : {}));
  S.ticks = (sek) => { for (let i = 0, N = Math.round(sek * HZ); i < N; i++) g.step(); };
  S.ticks(2);
  const lpid = Object.keys(g.landepunkte.dyn)[0];
  const b = g.landepunkte.dyn[lpid].beam; g.ship.x = b.x; g.ship.y = b.y; g.ship.vx = 0; g.ship.vy = 0;
  g.players.forEach((p, i) => { Interior.placeOnShipPad(g, p, i); p.console = 'transfer'; });
  g.handleMessage(cs[0], { t: 'cmd', c: 'transfer.ziel', landepunkt: lpid }); S.ticks(1);
  g.handleMessage(cs[0], { t: 'cmd', c: 'transfer.down' }); S.ticks(7);
  S.lp = lpid; S.aw = g.away; S.p = g.players[0];
  return S;
}
const hinten = (S, K) => {   // wie test-kreatur-rudel: von hinten treffen (Panzerung vorn), bis das Tier endgültig ausfällt
  K.facing = 0;
  const x = K.x - 100, y = K.y;
  const wirk = { waffe: 'blaster', schaden: 1, art: 'direkt', x, y, quelle: { id: S.p.id, pid: S.p.id, team: 'crew', x, y } };
  for (let i = 0; i < 60 && K.alive; i++) combat.hitEnemy(S.g, K, 1, { x, y, pid: S.p.id, wirkung: wirk });
};
const flagGeraeumt = (S) => { const m = S.g.mission; return !!((m.flags && m.flags.labs1_geraeumt) || (m.state && m.state.flags && m.state.flags.labs1_geraeumt)); };

section('(e) Headless: echtes Labor auf echter Wildnis, Transfer nach unten, ein und zwei Rudel', () => {
  for (const [rudel, tiere, seed] of [['1', 3, 5], ['1', 4, 6], ['2', 3, 7], ['2', 4, 5]]) {
    const S = labor(rudel, tiere, seed);
    const g = S.g, aw = S.aw;
    const name = 'rudel ' + rudel + ', tiere ' + tiere + ', Seed ' + seed;
    ok(S.start.ok && g.players.every((p) => p.zone === 'away') && /^kesh\.wildnis-\d+$/.test(aw.map), name + ': Labor startet, Crew unten auf neuer Wildnis (' + aw.map + ')');
    const K = aw.kreaturen.filter((k) => k.typ === 'rudeltier');
    const grp = {}; for (const k of K) grp[k.gruppe] = (grp[k.gruppe] || 0) + 1;
    ok(K.length === Number(rudel) * tiere && Object.keys(grp).length === Number(rudel) && Object.values(grp).every((c) => c === tiere), name + ': ' + K.length + ' Tiere in ' + Object.keys(grp).length + ' Rudel (' + JSON.stringify(grp) + ')');
    ok(g.errors === 0, name + ': keine Server-Fehler nach dem Aufbau (g.errors ' + g.errors + ')');
    let dmin = null;
    for (const a of S.start0) for (const b of S.start0) if (a.gruppe !== b.gruppe) { const d = Math.hypot(a.x - b.x, a.y - b.y) / 32; dmin = dmin === null ? d : Math.min(dmin, d); }
    ok(S.start0.length === K.length && (Number(rudel) === 1 ? dmin === null : dmin >= Platz.ZWISCHEN), name + ': Rudel beim Setzen verteilt' + (dmin !== null ? ' (kleinster Abstand ' + dmin.toFixed(1) + ' Kacheln)' : ' (ein Rudel)'));
    S.ticks(2);
    ok(!flagGeraeumt(S), name + ': Tiere leben, Szene nicht erledigt');
    // alle bis auf eines erledigen: noch nicht erledigt (auch wenn das erste Rudel ganz erledigt ist)
    const ids = K.map((k) => k.id);
    for (const k of K.slice(0, K.length - 1)) hinten(S, k);
    S.ticks(2);
    ok(!flagGeraeumt(S) && S.me.filter((e) => e.nm === 'kreaturAusgefallen').length === K.length - 1, name + ': ein Tier lebt noch: nicht erledigt, kreaturAusgefallen ' + S.me.filter((e) => e.nm === 'kreaturAusgefallen').length + ' von ' + (K.length - 1));
    hinten(S, K[K.length - 1]);
    S.ticks(3);
    const aus = S.me.filter((e) => e.nm === 'kreaturAusgefallen');
    ok(aus.length === K.length && new Set(aus.map((e) => e.d && e.d.id)).size === K.length && ids.every((i) => aus.some((e) => e.d && e.d.id === i)), name + ': Ereignis kreaturAusgefallen je Tier genau einmal (' + aus.length + ' von ' + K.length + ')');
    ok(K.every((k) => !k.alive), name + ': alle Tiere endgültig erledigt');
    ok(flagGeraeumt(S) || g.mission.activeId !== 'bot_lab' || (g.mission.step && g.mission.step.id !== 'labs1'), name + ': Bedingung kreaturen_erledigt für alle Rudel erfüllt, Szene beendet (Flag labs1_geraeumt / Schritt ' + (g.mission.step && g.mission.step.id) + ')');
    ok(g.errors === 0, name + ': g.errors 0 am Ende (' + g.errors + ')');
    S.fertig();
  }
});
section('(e) Headless: Labor auf Höhle (eigene Karte), zwei Rudel', () => {
  const S = labor('2', 4, 9, { buehne: { kartenart: 'hoehle' } });
  const K = S.aw.kreaturen.filter((k) => k.typ === 'rudeltier');
  ok(S.start.ok && /^kesh\.hoehle-\d+$/.test(S.aw.map) && K.length === 8 && new Set(K.map((k) => k.gruppe)).size === 2 && S.g.errors === 0, 'Höhle: 8 Tiere in 2 Rudeln, keine Fehler (' + S.aw.map + ', ' + K.length + ')');
  for (const k of K) hinten(S, k);
  S.ticks(3);
  S.fertig();
  ok(K.every((k) => !k.alive) && S.me.filter((e) => e.nm === 'kreaturAusgefallen').length === 8 && S.g.errors === 0, 'Höhle: alle 8 Tiere erledigt, kreaturAusgefallen 8, g.errors 0');
});

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen ok'));
process.exit(fails ? 1 : 0);
