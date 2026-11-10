'use strict';
// LAD-01 B: Eigenschaften der Ladung (illegal, getarnt, auftrag) und der Durchsuchungs-Hook (fracht.frachtDurchsuchen).
//   getarnt: Snapshot zeigt die Tarnbezeichnung, Server (Typ-Regel, Preis) rechnet mit der echten Art · Durchsuchung deckt auf (Ereignis frachtDurchsucht) ·
//   illegal erst nach der Durchsuchung im Snapshot · auftrag: nicht verkaufbar, nicht an beliebiger Station abgebbar · Faden-Ware und Konvoi-Beute lassen sich nicht verwechseln ·
//   Weltstand erhält die Eigenschaften (Schema) · unbekannte Eigenschaft abgelehnt · Testware zur Laufzeit ohne Codeänderung.
//   node tools/test-eigenschaften.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Waren = require('../shared/waren.js');
const Weltstand = require('../server/weltstand.js');
const Faden = require('../server/sim/faden.js');
const FF = require('../server/sim/faden-fracht.js');
const Fracht = require('../server/sim/fracht.js');
const Ladung = require('../server/sim/ladung.js');
const Modul = require('../server/sim/module.js');
const Ausbau = require('../server/sim/ausbau.js');
const SZB2 = require('../server/sim/faden-szene-b2.js');
const X = require('./faden-fixture.js');
const { D, spiel, oeffne, grenzen, alsVorlage, registriere } = X;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ ' + (e && e.stack)); } };
const run = (g, sek) => { for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) g.step(); };
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
function vorlage(id, nach) {
  const r = registriere(alsVorlage(id, (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    v.beats = [
      { id: 'b_szene', typ: 'fracht', parameter: { nach: nach || '0305' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['fracht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  if (!r.ok) throw new Error('Vorlage ungueltig: ' + r.fehler.join('; '));
}
function bereit(seed) {
  const g = spiel({ crew: 1, seed }).g;
  g.space.enemies = []; g.god = true; g.players[0].console = 'weapons';
  ab(g); ankunft(g, '0305');
  const ereig = [];
  const orig = g.missionEvent.bind(g);
  g.missionEvent = (k, d) => { ereig.push({ k, d }); return orig(k, d); };
  g.ereig = ereig;
  return g;
}
function raeume(g, liste) {
  Ausbau.setStufe(g, 3);
  g.ship.module = liste.map((r) => ({ id: 'frachtraum', raum: r, an: true, lauf: true }));
  Modul.verteilungSetzen(g);
}
const angedockt = (g) => { const ort = Sektoren.ortVonHex('0305'); Space.enterScene(g, ort, {}); Object.assign(g.ship, { vx: 0, vy: 0, speed: 0, docked: true, dockedAt: ort }); };
const aufn = (g, art, eig) => Fracht.lagerAufnehmen(g, { art, quelle: 'debug', eigenschaften: eig });
const snapLager = (g) => (g.snapshot().fracht || {}).lager || [];
const snapLe = (g) => (g.snapshot().fracht || {}).le;
const leer = (g) => { g.fracht.lager = []; g.fracht.draussen = []; g.fracht.halt = null; };

section('getarnt: Anzeige im Snapshot, Server rechnet mit der echten Art', () => {
  const g = bereit(41);
  raeume(g, [1]); leer(g);
  const r = aufn(g, 'waffen', { getarnt: 'hilfsgueter' });
  ok(r.ok && r.eintrag.art === 'waffen' && r.eintrag.eig.getarnt === 'hilfsgueter', 'Einlagerung: echte Art waffen, Tarnung hilfsgueter');
  ok(snapLager(g).join() === 'hilfsgueter', 'Snapshot zeigt die Tarnbezeichnung (Art-ID hilfsgueter), nicht waffen');
  ok(snapLe(g) === undefined, 'noch keine Flags sichtbar (die Tarnung ist nicht aufgedeckt)');
  ok(Fracht.anBord(g, 'waffen') === 1 && Fracht.anBord(g, 'hilfsgueter') === 0, 'Server: an Bord liegt waffen');
  // Typ-Regel mit der echten Art: das einzige Modul ist mit waffen belegt, hilfsgueter passt NICHT dazu (obwohl die Anzeige es suggeriert), waffen schon
  const pH = Fracht.platzFuer(g, 'hilfsgueter'), pW = Fracht.platzFuer(g, 'waffen');
  ok(!pH.ok && pH.grund === 'art_belegt' && pW.ok, 'Typ-Regel: echte Art zählt (hilfsgueter abgelehnt, waffen passt)');
  ok(Fracht.belegung(g).module[0].art === 'waffen', 'Belegung des Moduls: waffen');
  // Preis und Verkauf mit der echten Art
  angedockt(g);
  const h = Ladung.hafenVon(g);
  const pw = Ladung.preisFuer(g, h, 'waffen'), ph = Ladung.preisFuer(g, h, 'hilfsgueter');
  ok(pw > 0 && ph > 0 && pw !== ph, `Preise unterscheiden sich (waffen ${pw}, hilfsgueter ${ph})`);
  g.inventory.marks = 100; const m0 = g.inventory.marks;
  ok(Ladung.verkaufStart(g, null) === null, 'Verkauf startet'); run(g, 3.5);
  ok(g.fracht.lager.length === 0 && g.inventory.marks === m0 + pw, `bezahlt wird die echte Art (+${pw}, nicht +${ph})`);
  // Gewicht und Abwurf: Tarnung bleibt am Pod (keine Offenbarung durch den Abwurf)
  ab(g); ankunft(g, '0305'); leer(g);
  aufn(g, 'waffen', { getarnt: 'hilfsgueter', illegal: true });
  ok(Ladung.abwerfen(g) === null && g.fracht.lager.length === 0, 'Abwurf ohne Fehler');
  const pod = g.fracht.draussen[0];
  ok(pod && pod.art === 'waffen' && pod.eig.getarnt === 'hilfsgueter' && pod.eig.illegal, 'der Pod trägt die Eigenschaften');
  ok(g.snapshot().fracht.draussen[0].art === 'hilfsgueter', 'Snapshot zeigt den Pod mit der Tarnbezeichnung');
  const bs = Fracht.beamStart(g, null, pod.id);
  ok(bs === null, 'Beamen startet (' + bs + ')'); run(g, 3.5);
  ok(g.fracht.lager.length === 1 && g.fracht.lager[0].art === 'waffen' && g.fracht.lager[0].eig && g.fracht.lager[0].eig.getarnt === 'hilfsgueter' && g.fracht.lager[0].eig.illegal, 'wieder an Bord: Eigenschaften unverändert');
});

section('Durchsuchung: deckt getarnte und illegale Ladung auf, sendet das Ereignis', () => {
  const g = bereit(42);
  raeume(g, [1, 2, 3]); leer(g);
  aufn(g, 'waffen', { getarnt: 'hilfsgueter', illegal: true });   // [0] getarnt und illegal
  aufn(g, 'erz', { illegal: true });                               // [1] illegal, ungetarnt
  aufn(g, 'deuterium', {});                                        // [2] nichts
  ok(snapLager(g).join() === 'hilfsgueter,erz,deuterium' && snapLe(g) === undefined, 'vor der Durchsuchung: keine Flags im Snapshot, Tarnbezeichnung statt waffen');
  ok(g.fracht.lager[1].eig.illegal === true, 'Server kennt das illegal-Flag');
  const schnell = Fracht.frachtDurchsuchen(g, { wer: 'zoll', tiefe: 'scan' });
  ok(schnell.ok && schnell.neu.length === 1 && schnell.neu[0].art === 'erz' && schnell.illegal && !schnell.getarnt, 'Schnellscan: findet nur die ungetarnte illegale Ware');
  ok(snapLager(g).join() === 'hilfsgueter,erz,deuterium' && JSON.stringify(snapLe(g)) === '[0,1,0]', 'Snapshot: illegal sichtbar bei erz, die Tarnung hält');
  const e0 = g.ereig.length;
  const b = Fracht.frachtDurchsuchen(g, { wer: 'patrouille', tiefe: 'voll' });
  ok(b.ok && b.wer === 'patrouille' && b.tiefe === 'voll' && b.neu.length === 1 && b.arten.join() === 'waffen' && b.illegal && b.getarnt && b.geprueft === 3, 'Befund: Tarnung gefallen (waffen), illegal');
  const ev = g.ereig.slice(e0).find((x) => x.k === 'frachtDurchsucht');
  ok(ev && ev.d.wer === 'patrouille' && ev.d.illegal === true && ev.d.getarnt === true && ev.d.arten.join() === 'waffen' && ev.d.n === 1, 'missionEvent frachtDurchsucht mit Befund');
  ok(snapLager(g).join() === 'waffen,erz,deuterium' && JSON.stringify(snapLe(g)) === '[3,1,0]', 'Snapshot: die echte Art, Flags illegal und war-getarnt sichtbar');
  const nochmal = Fracht.frachtDurchsuchen(g, {});
  ok(nochmal.ok && nochmal.neu.length === 0 && nochmal.illegal && nochmal.tiefe === 'voll', 'zweite Durchsuchung: nichts Neues, Standardtiefe voll, illegal bleibt im Befund');
  const falsch = Fracht.frachtDurchsuchen(g, { tiefe: 'tief' });
  ok(!falsch.ok && falsch.grund === 'tiefe', 'unbekannte Tiefe abgelehnt');
  leer(g); aufn(g, 'erz', { illegal: true });
  ok(Fracht.debug(g, ['durchsuchen', 'debug']) === null && g.fracht.lager[0].eig.aufgedeckt === true && g.ereig.some((x) => x.k === 'frachtDurchsucht' && x.d.wer === 'debug'), 'Debug-Befehl fracht durchsuchen löst den Hook aus');
  leer(g);
  ok(Fracht.debug(g, ['an', 'erz', 'illegal', 'getarnt=sprengstoff']) === null && g.fracht.lager[0].eig.getarnt === 'sprengstoff', 'Debug: fracht an erz illegal getarnt=sprengstoff');
  ok(typeof Fracht.debug(g, ['an', 'erz', 'schmuggel']) === 'string', 'Debug: unbekannte Eigenschaft gibt einen Hinweis');
});

section('auftrag: nicht verkaufbar, nicht an beliebiger Station abgebbar', () => {
  const g = bereit(43);
  raeume(g, [1, 2]); leer(g);
  aufn(g, 'fracht', { auftrag: 'f77' });
  ok(JSON.stringify(snapLe(g)) === '[4]' && snapLager(g).join() === 'fracht', 'Snapshot: Auftrag sichtbar (Bit 4), Art fracht');
  angedockt(g);
  const vo = Ladung.verkaufOrt(g);
  ok(!vo.ok && /Auftragsware/.test(vo.reason), 'Verkauf abgelehnt, klarer Hinweis: ' + vo.reason);
  const vs = Ladung.verkaufStart(g, null);
  ok(typeof vs === 'string' && /Auftragsware/.test(vs) && !g.fracht.halt, 'verkaufStart: Hinweistext, kein Halteprozess');
  const ao = Fracht.ablieferOrt(g);
  ok(!ao.ok && /Auftraggeber/.test(ao.reason), 'Abgeben an der Station: ' + ao.reason);
  ok(typeof Fracht.abliefernStart(g, null) === 'string', 'abliefernStart lehnt ab');
  ok(Fracht.skriptAbliefern(g, 'fracht') === 0 && Fracht.skriptAbliefern(g) === 0 && g.fracht.lager.length === 1, 'skriptAbliefern gibt Auftragsware nicht ab');
  ok(g.snapshot().fracht.ab === undefined, 'Snapshot: keine Abgabe-Möglichkeit');
  // gemischt: nur die freie Ware geht
  aufn(g, 'erz', {});
  g.inventory.marks = 100; const m0 = g.inventory.marks;
  const pe = Ladung.preisFuer(g, Ladung.hafenVon(g), 'erz');
  ok(Ladung.verkaufStart(g, null) === null, 'gemischt: Verkauf startet für die freie Ware'); run(g, 3.5);
  ok(g.inventory.marks === m0 + pe && g.fracht.lager.length === 1 && g.fracht.lager[0].eig.auftrag === 'f77', 'nur erz verkauft, die Auftragsware bleibt');
  aufn(g, 'erz', {});
  ok(Fracht.abliefernStart(g, null) === null, 'gemischt: Abgabe startet für die freie Ware'); run(g, 3.5);
  ok(g.fracht.lager.length === 1 && g.fracht.lager[0].eig.auftrag === 'f77', 'nur erz abgegeben, die Auftragsware bleibt');
  // Verlust hat die bisherigen Folgen: Hüllentreffer im ungesicherten Frachtraum löst die Ware, der Pod trägt den Auftrag
  ab(g); ankunft(g, '0305'); Fracht.setGesichert(g, false);
  g.ship.systems.modul_1 = 'broken';
  Fracht.huellenTreffer(g);
  ok(g.fracht.draussen.some((d) => d.eig && d.eig.auftrag === 'f77') || g.fracht.lager.length === 0, 'Verlust: die Ware löst sich (Pod mit Auftrag) wie bisher');
  g.ship.systems.modul_1 = 'ok'; Fracht.setGesichert(g, true);
});

section('Faden-Ware und Konvoi-Beute lassen sich nicht verwechseln', () => {
  vorlage('eg_a'); vorlage('eg_b', '0403');   // Faden 2 liefert woanders ab
  const g = bereit(44);
  raeume(g, [1, 2]); leer(g);
  const f1 = oeffne(g, 'eg_a'), f2 = oeffne(g, 'eg_b'); grenzen(g, 5);
  ok(f1 && f2 && f1.id !== f2.id, 'zwei Fäden zugleich');
  weiter(g, f1); weiter(g, f2);
  ok(!!f1.fracht && !!f2.fracht, 'beide Fäden haben ihre Ware an Bord');
  ok(g.fracht.lager.length === 2 && g.fracht.lager.every((l) => l.art === 'fracht'), 'zwei Ladungen derselben Art fracht');
  ok(g.fracht.lager.map((l) => l.eig.auftrag).sort().join() === [f1.id, f2.id].sort().join(), 'je Faden der eigene Tag (' + f1.id + ', ' + f2.id + ')');
  // Konvoi-Beute derselben Art, eigener Tag
  g.fracht.szenenBeute = { art: 'fracht', tag: 'beute:t1' };
  aufn(g, 'fracht', { auftrag: 'beute:t1' });
  ok(Fracht.anBord(g, 'fracht') === 3 && Fracht.anBordFuerBeute(g, 'fracht', 'beute:t1') === 1, 'Beute zählt eigene Ladung, nicht die Faden-Ware');
  const save = Fracht.toSave(g), eig = Fracht.toSaveEig(g);
  ok(save.length === 2 && eig.length === 2 && eig.every((e) => e && /^f\d+$/.test(e.auftrag)), 'Speicherstand: die Beute fehlt, die Faden-Ware bleibt (Eigenschaften parallel)');
  // Faden 1 liefert ab: nur ihre Ladung geht
  ankunft(g, '0305'); g.missionEvent('docked', {});
  ok(f1.phase === 'wartet' && !f1.fracht && f1.nsc.status === 'verbuendet' && !g.fracht.lager.some((l) => l.eig.auftrag === f1.id), 'Faden 1 am Zielhafen: gelungen, genau seine Ladung ist weg');
  ok(!!f2.fracht && g.fracht.lager.some((l) => l.eig.auftrag === f2.id), 'Faden 2: seine Ladung wurde nicht angefasst (anderes Ziel, Auftrag läuft)');
  ok(g.fracht.lager.some((l) => l.eig.auftrag === 'beute:t1'), 'die Beute ist vom Abliefern des Fadens unberührt');
  // Szenenende: nur die Beute geht
  const vorher = g.fracht.lager.filter((l) => l.eig.auftrag !== 'beute:t1').length;
  SZB2.aufraeumen(g, { art: 'konvoi', phase: 'kampf', tag: 't1' });
  ok(!g.fracht.lager.some((l) => l.eig.auftrag === 'beute:t1') && g.fracht.lager.length === vorher && !g.fracht.szenenBeute, 'Szenenende: nur die Beute geht, Faden-Ware bleibt');
  // Faden 2 scheitert: nur seine Ladung geht
  const rest = g.fracht.lager.length;
  FF.verloren(g, f2.id);
  ok(g.fracht.lager.length === rest - 1 && rest === 1 && !g.fracht.lager.some((l) => l.eig && l.eig.auftrag === f2.id), 'Faden 2 verloren: genau seine Ladung geht');
  // Andockfall: Ladung fehlt, aber eine fremde Ladung derselben Art liegt da -> der Auftrag scheitert (keine Verwechslung)
  vorlage('eg_c');
  leer(g); ankunft(g, '0305');
  const f3 = oeffne(g, 'eg_c'); grenzen(g, 5); weiter(g, f3);
  ok(!!f3.fracht, 'dritter Faden mit Ware');
  g.fracht.lager = [{ art: 'fracht', eig: { auftrag: 'f999' } }];   // die eigene Ladung ist weg, eine fremde derselben Art liegt da
  ankunft(g, '0305'); g.missionEvent('docked', {});
  ok(f3.phase === 'wartet' && f3.nsc.status === 'geflohen', 'fremde Ladung derselben Art zählt nicht: der Auftrag scheitert');
  ok(g.fracht.lager.length === 1 && g.fracht.lager[0].eig.auftrag === 'f999', 'die fremde Ladung bleibt unberührt');
});

section('Weltstand: speichern und laden erhält die Eigenschaften (Schema)', () => {
  const g = bereit(45);
  raeume(g, [1, 2, 3, 4]); leer(g);
  aufn(g, 'waffen', { getarnt: 'hilfsgueter', illegal: true });
  aufn(g, 'erz', { illegal: true });
  aufn(g, 'fracht', { auftrag: 'f12' });
  aufn(g, 'deuterium', {});
  Fracht.frachtDurchsuchen(g, { tiefe: 'scan' });   // erz aufgedeckt, waffen bleibt getarnt
  const ws = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  ok(JSON.stringify(ws.schiff.fracht) === '["waffen","erz","fracht","deuterium"]', 'schiff.fracht bleibt eine Liste von Art-Strings (echte Arten)');
  ok(Array.isArray(ws.schiff.frachtEig) && ws.schiff.frachtEig.length === 4 && ws.schiff.frachtEig[3] === null, 'schiff.frachtEig parallel, null = keine');
  ok(Weltstand.validate(ws, g).length === 0, 'Weltstand mit Eigenschaften besteht das Schema (' + Weltstand.validate(ws, g).join('; ') + ')');
  const bad = JSON.parse(JSON.stringify(ws)); bad.schiff.frachtEig[1] = { boese: true };
  ok(Weltstand.validate(bad, g).length > 0, 'Schema lehnt eine unbekannte Eigenschaft ab');
  leer(g);
  Fracht.restore(g, ws.schiff.fracht, ws.schiff.frachtEig);
  const L = g.fracht.lager;
  ok(L.length === 4 && L[0].eig.getarnt === 'hilfsgueter' && L[0].eig.illegal && !L[0].eig.aufgedeckt, 'geladen: getarnt und illegal, noch verdeckt');
  ok(L[1].eig.illegal && L[1].eig.aufgedeckt, 'geladen: erz weiter aufgedeckt');
  ok(L[2].eig.auftrag === 'f12' && !L[3].eig, 'geladen: Auftrag erhalten, Ware ohne Eigenschaften bleibt ohne');
  ok(snapLager(g).join() === 'hilfsgueter,erz,fracht,deuterium' && JSON.stringify(snapLe(g)) === '[0,1,4,0]', 'Snapshot nach dem Laden wie davor');
  // Altstand ohne frachtEig lädt wie bisher
  leer(g); Fracht.restore(g, ['erz', 'deuterium']);
  ok(g.fracht.lager.length === 2 && !g.fracht.lager[0].eig, 'Altstand (ohne frachtEig) lädt ohne Eigenschaften');
  // unbrauchbare Eigenschaft im Stand: die Ladung wird verworfen (gekappt), nie still ohne Eigenschaft geladen
  leer(g); Fracht.restore(g, ['erz', 'deuterium'], [{ schmuggel: true }, null]);
  ok(g.fracht.lager.length === 1 && g.fracht.lager[0].art === 'deuterium', 'unbekannte Eigenschaft im Stand: Ladung verworfen');
  // kein Weltstand ohne Eigenschaften: das Feld fehlt, wenn nichts da ist
  leer(g); aufn(g, 'erz', {});
  ok(Weltstand.capture(g).schiff.frachtEig === undefined, 'ohne Eigenschaften steht kein frachtEig im Stand (additiv)');
});

section('unbekannte Eigenschaft wird abgelehnt', () => {
  const g = bereit(46);
  raeume(g, [1]); leer(g);
  const r1 = aufn(g, 'erz', { schmuggel: true });
  ok(!r1.ok && r1.grund === 'eigenschaft' && g.fracht.lager.length === 0, 'unbekannter Schlüssel: abgelehnt, nichts im Lager');
  const r2 = aufn(g, 'erz', { getarnt: 'erz' });
  ok(!r2.ok && r2.grund === 'eigenschaft', 'getarnt als sich selbst: abgelehnt');
  const r3 = aufn(g, 'erz', { getarnt: 'gibtsnicht' });
  ok(!r3.ok && r3.grund === 'eigenschaft', 'getarnt als unbekannte Ware: abgelehnt');
  const r4 = aufn(g, 'erz', { auftrag: '' });
  ok(!r4.ok && r4.grund === 'eigenschaft', 'auftrag ohne Kennung: abgelehnt');
  const r5 = Fracht.lagerAufnehmen(g, { art: 'person', person: 'p1', name: 'Pia', quelle: 'debug', eigenschaften: { illegal: true } });
  ok(!r5.ok && r5.grund === 'eigenschaft' && g.fracht.lager.length === 0, 'Personen tragen keine Eigenschaften');
  const r6 = aufn(g, 'erz', { illegal: false, getarnt: null });
  ok(r6.ok && !r6.eintrag.eig, 'false/null heißt: keine Eigenschaft');
});

section('Testware zur Laufzeit, ohne Codeänderung', () => {
  const g = bereit(47);
  raeume(g, [1, 2]); leer(g);
  Waren.registrieren({ id: 'testware_eig', name: 'Testware', grundpreis: 50, gewicht: 0, eigenschaften: ['illegal', 'getarnt'], darstellung: 'kiste', kategorie: 'ware' });
  Waren.registrieren({ id: 'testware_glatt', name: 'Glatte Ware', grundpreis: 10, gewicht: 0, eigenschaften: [], darstellung: 'kiste', kategorie: 'ware' });
  try {
    const r = aufn(g, 'testware_eig', { illegal: true, getarnt: 'sprengstoff' });
    ok(r.ok && snapLager(g).join() === 'sprengstoff', 'Testware: erlaubte Eigenschaften, Tarnung im Snapshot');
    const a = aufn(g, 'testware_eig', { auftrag: 'f1' });
    ok(!a.ok && a.grund === 'eigenschaft', 'Testware trägt auftrag nicht (nicht in ihren eigenschaften): abgelehnt');
    const t = aufn(g, 'testware_glatt', { illegal: true });
    ok(!t.ok && t.grund === 'eigenschaft', 'Ware ohne Eigenschaften lehnt jede ab');
    // als Tarnbezeichnung einer anderen Ware
    const s = aufn(g, 'sprengstoff', { getarnt: 'testware_glatt' });
    ok(s.ok && snapLager(g).join() === 'sprengstoff,testware_glatt', 'Testware als Tarnbezeichnung einer anderen Ware');
    Fracht.frachtDurchsuchen(g, {});
    ok(snapLager(g).join() === 'testware_eig,sprengstoff' && JSON.stringify(snapLe(g)) === '[3,2]', 'Durchsuchung: Tarnung fällt, Flags sichtbar');
  } finally { Waren.entfernen('testware_eig'); Waren.entfernen('testware_glatt'); }
});

section('Snapshot-Kosten: gefüllter Frachtraum mit Flags', () => {
  const g = bereit(48);
  raeume(g, [1, 2, 3, 4]); leer(g);
  const vorGross = Buffer.byteLength(JSON.stringify(g.snapshot()));
  for (let i = 0; i < 4; i++) aufn(g, 'waffen', { getarnt: 'hilfsgueter', illegal: true });
  for (let i = 0; i < 4; i++) aufn(g, 'erz', { illegal: true });
  for (let i = 0; i < 4; i++) aufn(g, 'fracht', { auftrag: 'f1' });
  for (let i = 0; i < 4; i++) aufn(g, 'deuterium', {});
  Fracht.frachtDurchsuchen(g, {});
  const nach = Buffer.byteLength(JSON.stringify(g.snapshot()));
  ok(g.fracht.lager.length === 16, 'Frachtraum voll (16)');
  ok(nach - vorGross > 0 && nach - vorGross < 400, `Mehrgröße des Snapshots durch 16 Ladungen mit Flags: ${nach - vorGross} B (< 400)`);
  ok(Buffer.byteLength(JSON.stringify(g.snapshot().fracht.le)) <= 40, 'le kompakt (' + JSON.stringify(g.snapshot().fracht.le) + ')');
});

console.log(`\n${n - fails}/${n} Prüfungen ok${fails ? ' – ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
