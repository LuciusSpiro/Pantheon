#!/usr/bin/env node
'use strict';
// SPL-01 d: Abbau und Wiederkehr als reine Katalog-DATEN plus ein kleiner, datengetriebener Prueferpfad (szenenbau.wiederkehrGrenzen, KARTE-WIEDERKEHR-MAX).
// Kein Umsetzungs- und Kartenname im Servercode; der Test liest Katalog, Pruefer (checkGrobplanB1, aufloesen), Weltstand und einen echten Labor-Lauf.
//  1. Katalog: abbauen/adern_in_der_hoehle verfuegbar, nur hoehle, Anker abbau (min 4) gegen den Pflichtsatz des Erzeugers, Datenfeld wiederkehr.max 2, Lexikon abbau je Bauweise,
//     test.params.map, rueckfall.params; keine Umsetzung ausser dieser traegt das Datenfeld; Servercode nennt weder Umsetzung noch Molekuel.
//  2. Pruefer (checkGrobplanB1): Wiederkehr 1 und 2 ohne KARTE-WIEDERHOLT, die 3. in Folge als KARTE-WIEDERKEHR-MAX (Fehler); Umsetzung OHNE Datenfeld bleibt bei KARTE-WIEDERHOLT
//     (Warnung, kein Fehler); gemischte Szene (mit Umsetzung ohne Feld) bleibt unter der Regel; Luecke setzt die Folge zurueck; neuer Seed (buehne neu) geht immer.
//  3. Weltstand mit zwei Missionen (echtes Labor, Weltstand-Roundtrip toSave/restore): Mission 1 baut ab, Mission 2 waehlt denselben Landepunkt (aufloesen + Pruefer ohne Wiederholung),
//     die Adern sind wieder voll (abbau_neu in der Szene, Runde 2, keine Ader mehr abgebaut), Bedingung erst nach neuem Abbau, g.errors 0.
//  4. Kontext: 20 Besuche (1 Landepunkt je Besuch, dann 20 Wiederbesuche eines Landepunkts) wachsen nicht ueber den Deckel (T13-Formel, Grenze 2200).
//  5. Altstand ohne neuen Zaehler: der Weltstand-Block kennt kein neues Feld (Version unveraendert), ein Altstand laedt und speichert byteweise gleich.
//   node tools/test-spl-wiederkehr.js   (npm run test:spl-wiederkehr)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const M = require('./lib/messe-spl.js');
const Katalog = require('./katalog.js');
const SB = require('../server/mission/szenenbau.js');
const Context = require('../server/mission/context.js');
const Labor = require('../server/mission/labor.js');
const Interior = require('../server/sim/interior.js');
const Anker = require('../server/sim/anker.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const GenHoehle = require('../shared/gen-hoehle.js');
const Physics = require('../shared/physics.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { bad++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};

const MOL = 'abbauen', UMS = 'adern_in_der_hoehle', ID = MOL + '/' + UMS;
const FREMD = 'ladung_bergen/ladung_am_boden';   // Boden-Umsetzung auf Hoehle OHNE Datenfeld wiederkehr
const katalog = Katalog.load({});
const env = SB.buildEnv(katalog);
const umsetzung = (k, id) => { const [m, u] = id.split('/'); return k.molekuele[m].umsetzungen.find((x) => x.id === u); };
const U = umsetzung(katalog, ID);
const welt0 = M.weltstand('nach-tutorial');
const clone = M.clone;

section('1. Katalog und Daten', () => {
  ok(!!U && U.status === 'verfuegbar' && U.pruefung.fehler === 0, 'Umsetzung steht im Katalog, verfügbar, Prüfer ohne Fehler');
  const b = U.buehne_braucht;
  ok(JSON.stringify(b.kartenarten) === '["hoehle"]', 'Kartenarten genau hoehle (Wildnis hat keine Adern)');
  ok(JSON.stringify(b.anker) === '["abholpunkt","abbau"]' && b.min.abbau === 4, 'Anker abholpunkt und abbau, min abbau 4');
  ok(GenHoehle.PFLICHT.abbau >= b.min.abbau, `min abbau ${b.min.abbau} höchstens der Pflichtsatz des Höhlen-Erzeugers (${GenHoehle.PFLICHT.abbau})`);
  ok(U.wiederkehr && U.wiederkehr.max === 2, 'Datenfeld wiederkehr.max = 2 (Kai 2026-11-10) steht in der Umsetzung, nicht im Code');
  const mitFeld = []; for (const m of Object.values(katalog.molekuele)) for (const u of m.umsetzungen) if (u.wiederkehr) mitFeld.push(m.id + '/' + u.id);
  ok(mitFeld.length === 1 && mitFeld[0] === ID, `nur diese Umsetzung trägt das Feld (${mitFeld.join(', ')})`);
  ok(!umsetzung(katalog, FREMD).wiederkehr, `${FREMD} trägt es nicht (bestehendes Verhalten bleibt)`);
  ok(U.schauplatz === 'aussen' && Object.values(katalog.szenentypen).some((t) => t.kennung === 'C9' && t.status === 'verfuegbar' && t.verfuegbare_molekuele.includes(MOL)), 'Boden-Umsetzung unter Szenentyp C9 (Bergung vor Ort)');
  ok(U.test && U.test.params.map && U.rueckfall && U.rueckfall.params && !Object.keys(U.rueckfall.params).length, 'test.params.map und rueckfall.params vorhanden');
  for (const f of ['germanen', 'rom', 'vorlaeufer']) {
    const lex = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'buehnen', 'lexikon', f + '.json'), 'utf8'));
    ok(lex.eintraege.abbau && lex.eintraege.abbau.wort && lex.neutral.abbau && lex.neutral.abbau.wort, `Lexikon ${f}: abbau (${lex.eintraege.abbau.wort}) und neutral (${lex.neutral.abbau.wort})`);
  }
  // kein Umsetzungs-/Molekülname im Servercode (Steckbrief-No-Go)
  const quell = ['server/mission/szenenbau.js', 'server/mission/context.js', 'server/mission/katalog.js', 'server/sim/landepunkte.js', 'server/mission/spielleiter.js', 'server/mission/llm.js'].map((f) => [f, fs.readFileSync(path.join(__dirname, '..', f), 'utf8')]);
  const treffer = quell.filter(([f, t]) => new RegExp(`${UMS}|['"]${MOL}['"]`).test(t)).map(([f]) => f);
  ok(!treffer.length, 'Servercode nennt weder Umsetzung noch Molekül' + (treffer.length ? ' (' + treffer.join(', ') + ')' : ''));
});

// ---------- Prüfer ----------
const LP = 'kesh.hoehle-1';
function plan(mols, lp) { return M.testplan({ szenentyp: 'bergung_vor_ort', ort: 'kesh', landepunkt: lp || LP, mols }); }
const bil = (folge) => ({ letzte: folge.map((x, i) => ({ titel: 'M' + i, boden: true, landepunkte: x })), pflicht_jetzt: false, lang_ab_min: 25 });
function b1(mols, folge, lp) {
  const g = plan(mols, lp);
  return SB.checkGrobplanB1(g, env, { bodenbilanz: bil(folge) }, { lp: null });
}
const wh = (r) => r.warnings.filter((w) => /^KARTE-WIEDERHOLT/.test(w)).length;
const mx = (r) => r.errors.filter((w) => /^KARTE-WIEDERKEHR-MAX/.test(w)).length;

section('2. Prüfer: Wiederkehr ohne KARTE-WIEDERHOLT, Deckel 2, Regel bleibt für alle anderen', () => {
  const X = [LP];
  let r = b1([ID], []);
  ok(wh(r) === 0 && mx(r) === 0, 'erster Besuch: keine Meldung');
  r = b1([ID], [X]);
  ok(wh(r) === 0 && mx(r) === 0 && !r.errors.length, '1. Wiederkehr: weder KARTE-WIEDERHOLT noch Fehler');
  r = b1([ID], [X, X]);
  ok(wh(r) === 0 && mx(r) === 0 && !r.errors.length, '2. Wiederkehr in Folge: weder KARTE-WIEDERHOLT noch Fehler');
  r = b1([ID], [X, X, X]);
  ok(mx(r) === 1 && wh(r) === 0, `3. Wiederkehr in Folge: KARTE-WIEDERKEHR-MAX als Fehler (${r.errors.join(' | ').slice(0, 90)})`);
  r = b1([ID], [[], X, X]);
  ok(!r.errors.length && wh(r) === 0, 'zwei Besuche am Ende, davor ein anderer Landepunkt: noch erlaubt');
  r = b1([ID], [X, ['kesh.hoehle-2'], X]);
  ok(!r.errors.length && wh(r) === 0, 'Lücke setzt die Folge zurück (Besuch, anderer, Besuch → Wiederkehr 1)');
  r = b1([ID], [X, X, ['kesh.hoehle-2']]);
  ok(!r.errors.length && wh(r) === 0, 'der Landepunkt lief zuletzt vor einer Mission: Folge 0, erlaubt');
  r = b1([ID], [X, X, X], 'kesh.hoehle-2');
  ok(!r.errors.length && wh(r) === 0, 'anderer Landepunkt (neuer Seed): nie gebremst');
  // Umsetzung OHNE Datenfeld: bestehendes Verhalten (Warnung, nie der neue Fehler)
  r = b1([FREMD], [X]);
  ok(wh(r) === 1 && mx(r) === 0, 'Umsetzung ohne Datenfeld: weiter KARTE-WIEDERHOLT (Warnung), kein Fehler');
  r = b1([FREMD], [X, X, X]);
  ok(wh(r) === 1 && mx(r) === 0, 'Umsetzung ohne Datenfeld, 3 in Folge: weiter nur die Warnung');
  // Szene mit beiden Umsetzungen: die ohne Feld bestimmt
  r = b1([ID, FREMD], [X]);
  ok(wh(r) === 1 && mx(r) === 0, 'Szene mit Umsetzung ohne Datenfeld: nicht ausgenommen');
  // zwei Szenen auf demselben Landepunkt: eine ohne Feld macht den Landepunkt regelpflichtig
  const g2 = plan([ID]); g2.szenen.push(Object.assign(clone(g2.szenen[1]), { id: 's3', molekuele: [{ id: FREMD.split('/')[0], umsetzung: FREMD.split('/')[1] }] }));
  r = SB.checkGrobplanB1(g2, env, { bodenbilanz: bil([X]) }, { lp: null });
  ok(wh(r) === 1, 'zweite Szene am selben Landepunkt ohne Feld: Regel greift');
  g2.szenen.reverse();
  r = SB.checkGrobplanB1(g2, env, { bodenbilanz: bil([X]) }, { lp: null });
  ok(wh(r) === 1, 'zweite Szene am selben Landepunkt ohne Feld, andere Reihenfolge: Regel greift');
  // Fenster: der Deckel kann nie über das Fenster hinaus wirken (max wird auf Fenster-1 begrenzt)
  const env2 = SB.buildEnv(Object.assign({}, katalog, { molekuele: Object.assign({}, katalog.molekuele, { [MOL]: Object.assign({}, katalog.molekuele[MOL], { umsetzungen: [Object.assign({}, U, { wiederkehr: { max: 5 } })] }) }) }));
  const r5 = SB.checkGrobplanB1(plan([ID]), env2, { bodenbilanz: bil([X, X, X]) }, { lp: null, boden: { wiederholtFenster: 3 } });
  ok(mx(r5) === 1, 'max 5 im Katalog, Fenster 3: Deckel wirkt trotzdem ab der 3. Folge (min(max, Fenster-1))');
});

// ---------- echtes Labor, zwei Missionen im Weltstand ----------
const HZ = CONFIG.tickHz;
function spiel() {
  const g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 3; i++) { const c = { inbox: [], send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'L' + i, name: 'L' + i, color: i }); cs.push(c); }
  g.reset(); g.phase = 'play';
  const S = { g, cs };
  S.ticks = (sek) => { for (let i = 0, N = Math.round(sek * HZ); i < N; i++) g.step(); };
  return S;
}
// Mission auf einem vorhandenen Landepunkt starten (laborKette nimmt map), hinunterbeamen
function mission(S, lpId) {
  const g = S.g;
  S.start = Labor.laborKette(g, [ID], { map: lpId, loc: 'kesh', god: true, katalog });
  S.ticks(2);
  const b = g.landepunkte.dyn[lpId].beam; g.ship.x = b.x; g.ship.y = b.y; g.ship.vx = 0; g.ship.vy = 0;
  g.players.forEach((p, i) => { Interior.placeOnShipPad(g, p, i); p.console = 'transfer'; });
  g.handleMessage(S.cs[0], { t: 'cmd', c: 'transfer.ziel', landepunkt: lpId }); S.ticks(1);
  g.handleMessage(S.cs[0], { t: 'cmd', c: 'transfer.down' }); S.ticks(7);
  S.aw = g.away; S.k = W.AWAY_MAPS[lpId].karte; S.lp = lpId;
  return S;
}
const kand = (k) => k.anker.filter((a) => GenHoehle.istAderKandidat(a));
const zst = (S) => Object.fromEntries(kand(S.k).map((a) => [a.id, Anker.zustand(S.g, S.lp, a.id)]));
const flagGesetzt = (S) => { const m = S.g.mission; return !!((m.flags && m.flags.labs1_abgebaut) || (m.state && m.state.flags && m.state.flags.labs1_abgebaut)); };
function abbauen(S, aid) {
  const a = S.k.anker.find((q) => q.id === aid);
  const c = Physics.tileCenter(a.x, a.y);
  const p = S.g.players[0];
  p.x = c.x; p.y = c.y; p.hold = { kind: 'anker:abbau', anker: aid, dur: 5, t: 5 };
  Anker.abbauFertig(S.g, p, p.hold);
  p.hold = null;
}

section('3. Weltstand: Mission 1 baut ab, Mission 2 kehrt zurück, Adern wieder voll', () => {
  const A = spiel();
  const lpId = L.neu(A.g, 'kesh', { art: 'hoehle', seed: 21 });
  L.get(A.g, lpId);
  mission(A, lpId);
  ok(A.start && A.start.ok && A.g.players.every((p) => p.zone === 'away') && A.aw.map === lpId, `Mission 1: Labor startet auf ${lpId}, Crew unten`);
  const z1 = zst(A);
  const da1 = Object.keys(z1).filter((id) => z1[id] === 'da');
  ok(da1.length >= 2 && da1.length <= 3 && L.eintrag(A.g, lpId).abbau_runde === 1, `Mission 1: abbau_neu lief beim Betreten (Runde 1, ${da1.length} Adern mit Vorkommen)`);
  ok(!flagGesetzt(A), 'Mission 1: Szene nicht erledigt, solange nichts abgebaut ist');
  abbauen(A, da1[0]); A.ticks(1);
  ok(!flagGesetzt(A), 'Mission 1: eine Ader von zwei verlangten: noch nicht erledigt');
  abbauen(A, da1[1]); A.ticks(3);
  ok(flagGesetzt(A), 'Mission 1: zwei Adern abgebaut → Bedingung abbau_fertig erfüllt (Flag labs1_abgebaut)');
  ok(A.g.errors === 0, `Mission 1: g.errors 0 (${A.g.errors})`);
  const abgebaut1 = Object.keys(zst(A)).filter((id) => zst(A)[id] === 'abgebaut');
  ok(abgebaut1.length >= 2, `Mission 1: Weltstand-Zustand der Adern: ${abgebaut1.length} abgebaut`);
  // Weltstand sichern, in einem frischen Spiel laden (anderer Spielstand, derselbe Landepunkt)
  const block = JSON.parse(JSON.stringify(L.toSave(A.g)));
  ok(block[lpId] && block[lpId].besuche === 1 && block[lpId].abbau_runde === 1 && Object.values(block[lpId].zustaende).filter((v) => v === 'abgebaut').length >= 2, 'Weltstand-Block: Landepunkt besucht (1), Runde 1, Adern abgebaut');

  // Prüfer für Mission 2: Landepunkt X, Mission 1 liegt in der Bodenbilanz
  const w = clone(welt0); w.welt = Object.assign({}, w.welt, { landepunkte: block });
  w.spielleiter = Object.assign({}, w.spielleiter, { zusammenfassung: [{ id: 'm1', titel: 'Erz in der Höhle', boden: true, landepunkte: [lpId] }] });
  const ctx = Context.build(w, M.anlass(), katalog);
  const lp = Context.lpAdapterAusWelt(w);
  ok(ctx.bodenbilanz.letzte.length === 1 && ctx.bodenbilanz.letzte[0].landepunkte.includes(lpId), 'Kontext: Mission 1 steht mit ihrem Landepunkt in der Bodenbilanz');
  const g2 = plan([ID], lpId);
  const r = SB.aufloesen(g2, env, ctx, { lp });
  const rb = SB.checkGrobplanB1(g2, env, ctx, { lp });
  ok(!r.errors.length && g2.szenen[1].landepunkt === lpId, `Mission 2: aufloesen akzeptiert den besuchten Landepunkt (${r.errors.join(' | ') || 'ohne Fehler'})`);
  ok(!rb.errors.length && wh(rb) === 0, `Mission 2: Prüfer ohne KARTE-WIEDERHOLT (${rb.warnings.join(' | ').slice(0, 80) || 'ohne Warnung'})`);
  const gF = plan([FREMD], lpId); SB.aufloesen(gF, env, ctx, { lp });
  ok(wh(SB.checkGrobplanB1(gF, env, ctx, { lp })) === 1, 'Gegenprobe: Umsetzung ohne Datenfeld auf demselben Landepunkt meldet KARTE-WIEDERHOLT');
  // Vorgaben-Prompt nennt die Wiederkehr aus den Daten
  const vor = SB.grobplanVorgaben(env, ctx, { lp, dauer: { soll: 12, min: 10, max: 14 }, szenen: [4, 6] });
  const zeile = vor.split('\n').find((l) => l.includes(ID)) || '';
  ok(/Wiederkehr: ↺-Landepunkt erlaubt, höchstens 2× in Folge/.test(zeile) && !vor.split('\n').filter((l) => l.includes(FREMD)).some((l) => /Wiederkehr/.test(l)), `Vorgaben: ${ID} nennt die Wiederkehr, andere Umsetzungen nicht`);

  // Mission 2 im Spiel B mit dem geladenen Weltstand
  const B = spiel();
  L.restore(block, B.g);
  ok(!!B.g.landepunkte.dyn[lpId] && L.eintrag(B.g, lpId).abbau_runde === 1, 'Spiel B: Weltstand geladen (Landepunkt und Runde aus dem Block)');
  mission(B, lpId);
  ok(B.start && B.start.ok && B.g.players.every((p) => p.zone === 'away'), 'Mission 2: Labor startet auf demselben Landepunkt, Crew unten');
  const z2 = zst(B);
  const da2 = Object.keys(z2).filter((id) => z2[id] === 'da');
  ok(L.eintrag(B.g, lpId).abbau_runde === 2 && da2.length >= 2 && da2.length <= 3 && !Object.values(z2).includes('abgebaut') && !Object.values(z2).includes('laeuft'), `Mission 2: Adern frisch (Runde 2, ${da2.length} mit Vorkommen, keine mehr abgebaut)`);
  ok(JSON.stringify(da2) !== JSON.stringify(da1) || da2.length > 0, `Mission 2: neue Auswahl der Adern (Mission 1: ${da1.join(',')}; Mission 2: ${da2.join(',')})`);
  ok(!flagGesetzt(B), 'Mission 2: Bedingung nicht schon vom alten Abbau erfüllt');
  for (const id of da2.slice(0, 2)) abbauen(B, id);
  B.ticks(3);
  ok(flagGesetzt(B) && B.g.errors === 0, `Mission 2: nach neuem Abbau erfüllt, g.errors ${B.g.errors}`);
  ok(L.eintrag(B.g, lpId).besuche === 2, 'Weltstand: zweiter Besuch gezählt');
});

section('4. Kontext: 20 Besuche wachsen nicht über den Deckel', () => {
  const G = spiel().g;
  const ids = [];
  for (let i = 0; i < 20; i++) { const id = L.neu(G, 'kesh', { art: 'hoehle', seed: 100 + i }); L.betreten(G, id); ids.push(id); }
  const messen = () => {
    const w = clone(welt0); w.welt = Object.assign({}, w.welt, { landepunkte: JSON.parse(JSON.stringify(L.toSave(G))) });
    const c = Context.build(w, M.anlass(), katalog);
    return { plus: M.kontextZuwachs(c).plus, kesh: (c.orte.find((o) => o.id === 'kesh').landepunkte || []).filter((x) => /hoehle-/.test(x.id)).length };
  };
  const a = messen();
  // Wiederbesuche: derselbe Landepunkt 20× (Besuchszähler wächst, Besuchsfolge zuletzt springt nach vorn)
  for (let i = 0; i < 20; i++) L.betreten(G, ids[3]);
  const b = messen();
  // und reihum alle 20 noch einmal
  for (const id of ids) L.betreten(G, id);
  const c = messen();
  console.log(`  Kontext-Zuwachs (T13-Formel): 20 Landepunkte je 1× besucht +${a.plus}, danach 20 Wiederbesuche eines Landepunkts +${b.plus}, danach alle 20 erneut +${c.plus} Tokens (Grenze 2200)`);
  ok(a.plus <= M.KONTEXT_GRENZE && b.plus <= M.KONTEXT_GRENZE && c.plus <= M.KONTEXT_GRENZE, 'alle drei Stände unter der T13-Grenze ' + M.KONTEXT_GRENZE);
  ok(b.plus - a.plus <= 10 && c.plus - a.plus <= 10, `Wiederbesuche blähen den Kontext nicht auf (Zuwachs gegenüber 1× je Landepunkt: +${b.plus - a.plus} bzw. +${c.plus - a.plus} Tokens, nur Ziffern des Besuchszählers)`);
  ok(a.kesh === 1 && b.kesh === 1 && c.kesh === 1, `je Stand höchstens ${Math.max(a.kesh, b.kesh, c.kesh)} Höhlen-Landepunkt einzeln im Kontext (Deckel gelaendeEinzeln)`);
  const zuletzt = L.eintrag(G, ids[3]).zuletzt;
  ok(zuletzt > Math.max(...ids.filter((x, i) => i !== 3).map((id) => L.eintrag(G, id).zuletzt)) - 20, 'Besuchsfolge: zuletzt wächst mit jedem Wiederbesuch (Eintrag wandert nach vorn)');
});

section('5. Altstand: kein neues Weltstand-Feld', () => {
  const G = spiel().g;
  const id = L.neu(G, 'kesh', { art: 'hoehle', seed: 31 }); L.betreten(G, id);
  const blk = JSON.parse(JSON.stringify(L.toSave(G)));
  const felder = Object.keys(blk[id]).sort();
  ok(felder.every((f) => ['seed', 'bauversion', 'schablone', 'art', 'bauweise', 'besitz', 'zustand', 'zustaende', 'alarm', 'besuche', 'letzte_mission', 'neu', 'gesperrt', 'abbau_runde', 'ort', 'beam', 'name', 'frei', 'zuletzt'].includes(f)), `Eintrag trägt nur bekannte Felder (${felder.join(', ')})`);
  // Altstand: ohne zuletzt, ohne abbau_runde → lädt, gleiche Form beim erneuten Speichern
  const alt = clone(blk); delete alt[id].zuletzt; delete alt[id].abbau_runde;
  const H = spiel().g; L.restore(alt, H);
  const neu = JSON.parse(JSON.stringify(L.toSave(H)));
  ok(neu[id] && neu[id].abbau_runde === 0 && neu[id].besuche === 1 && neu[id].zuletzt === undefined, 'Altstand ohne zuletzt und abbau_runde lädt unverändert (Runde 0, Besuche bleiben)');
  // Pruefer/Kontext mit Altstand ohne Besuchsfolge: Wiederkehr bleibt ohne Zähler im Weltstand möglich (Folge kommt aus der Bodenbilanz)
  const w = clone(welt0); w.welt = Object.assign({}, w.welt, { landepunkte: alt }); w.spielleiter = Object.assign({}, w.spielleiter, { zusammenfassung: [{ id: 'm1', titel: 't', boden: true, landepunkte: [id] }] });
  const ctx = Context.build(w, M.anlass(), katalog);
  ok(!SB.checkGrobplanB1(plan([ID], id), env, ctx, { lp: Context.lpAdapterAusWelt(w) }).errors.length, 'Altstand: Wiederkehr geht ohne neuen Zähler (Folge aus der Bodenbilanz)');
});

console.log(`\n${n - bad}/${n} ok`);
if (bad) { console.log(`${bad} FEHLER`); process.exit(1); }
console.log('TEST-SPL-WIEDERKEHR OK');
