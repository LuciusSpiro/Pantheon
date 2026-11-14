'use strict';
// BEA-03 C: der Hinterhalt im Faden OHNE Spielleiter (achter Standardplan in content/faeden/anschluss.json, Lagen-Bedingung hinterhalt_ziel). In-process, ohne Server.
// Belegt: der Plan steht in den Daten (genau ein Hinterhalt-Beat, erfolg gesetzt) und besteht Expander und Pruefer; er wird als Angebot geoeffnet und laeuft Beat -> Ankunft (Crew im Sektor) -> gelungen bzw. gescheitert
// (je einmal) -> Abschluss (die Ankunft allein zaehlt nicht als Erfolg); ohne waehlbaren Sektor wird der Plan weder angeboten noch vom Mock geplant (Lagen-Bedingung, Daten beats.json braucht.lage);
// kein Hinterhalt-Literal im Servercode der Plan-Wege (Expander, Pruefer, Brett, Mock, Prompt).
//   node tools/test-hinterhalt-plan.js        (npm run test:hinterhalt-plan)
const fs = require('fs');
const path = require('path');
const X = require('./faden-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Faden = require('../server/sim/faden.js');
const B1 = require('../server/sim/faden-b1.js');
const B2 = require('../server/sim/faden-b2.js');
const BP = require('../server/sim/faden-bauplan.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const AM = require('../server/sim/abenteuer-mock.js');
const Testhilfe = require('./gegner-testhilfe.js');
const { D } = X;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (o) => JSON.parse(JSON.stringify(o));
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const betritt = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const schritte = (g, sek) => { for (let i = 0; i < Math.round(sek * 30); i++) g.step(); };
const faellig = (f, i) => { f.beat = i; f.phase = 'wartet'; f.laufend = null; f.zaehler = f.abstand; };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const tags = (g) => g.space.enemies.map((e) => e.tag);
const alleHexe = Object.keys(lies('content/welt/sund_frei.json').hexe);
const ANS = lies('content/faeden/anschluss.json');
const PLAN = ANS.plaene.find((p) => p.beats.some((b) => b.typ === 'hinterhalt'));

// Spiel: Crew 3 am Start (0305), alle Sektoren erkundet, keine Reise-Ereignisse, kein Zufalls-Abfangen
function spiel(seed) {
  const g = X.F.neuesSpiel({ crew: 3, seed, names: NAMEN, env: { FAEDEN: '1', REISE_EREIGNISSE: 'off' } }).g; ab(g);
  for (const h of alleHexe) g.explore.erkunde(h);
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.neutralMax = 0; g.C.reise.feindChance = 0;
  return g;
}
// Plan als Angebot am Hex und als Faden oeffnen (wie das Brett es tut)
function oeffnen(g, hex) {
  Faden.zustandVon(g).abenteuerAngebote = [];
  const a = Faden.abenteuerAnbieten(g, klon(PLAN), { hex });
  if (!a.ok) return { ok: false, fehler: a };
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  return r.ok ? { ok: true, faden: r.faden } : { ok: false, fehler: r };
}
// Hinterhalt-Beat starten, die Crew in den gewaehlten Sektor bringen, die Szene laufen lassen; ausgang 'gelungen' (Gegner weg) oder 'gescheitert' (Flucht), danach den Abschluss
function lauf(seed, ausgang) {
  const g = spiel(seed);
  const o = oeffnen(g, '0305');
  if (!o.ok) return { g, o };
  const f = o.faden; faellig(f, 0);
  const gestartet = weiter(g, f).ok && f.phase === 'laeuft' && /^\d{4}$/.test((f.laufend || {}).hex || '');
  const hex = gestartet ? f.laufend.hex : null;
  const szeneVorher = !!g.fadenSzene;
  if (gestartet) { betritt(g, hex); schritte(g, 0.2); }
  const szene = g.fadenSzene && g.fadenSzene.art;
  const gegner = tags(g).length;
  if (ausgang === 'gelungen') { for (const e of g.space.enemies.filter((x) => x.tag === (g.fadenSzene || {}).tag)) Testhilfe.toeten(g, e); }
  else betritt(g, '0305');
  schritte(g, 2);
  const nachBeat = { phase: f.phase, beat: f.beat, ged: f.nsc.gedaechtnis.map((x) => x.ereignis) };
  faellig(f, 1);
  const abs = weiter(g, f).ok;
  return { g, o, f, gestartet, hex, szeneVorher, szene, gegner, nachBeat, abs };
}

function main() {
  // =====================================================================================================================================================================
  console.log('\n1. Daten: der achte Standardplan');
  {
    ok(ANS.plaene.length === 8 && PLAN === ANS.plaene[7], 'achter Plan in anschluss.json (' + ANS.plaene.length + ' Plaene)');
    ok(PLAN.beats.filter((b) => b.typ === 'hinterhalt').length === 1 && PLAN.beats.length === 2 && PLAN.beats[1].typ === 'abschluss', 'genau ein Hinterhalt-Beat, danach der Abschluss (kein anderer Beat, keine Unterstuetzung)');
    ok(!PLAN.beats[0].parameter && !PLAN.beats[0].verzweigung, 'der Beat nennt weder Hex noch Verzweigung: der Code waehlt den Sektor, beide Ausgaenge fuehren zum Abschluss');
    ok(Array.isArray(PLAN.beats[1].erfolg) && PLAN.beats[1].erfolg.join() === 'hinterhalt', 'abschluss.erfolg nennt hinterhalt: die Ankunft allein zaehlt nicht als Erfolg');
    ok(typeof PLAN.titel === 'string' && PLAN.titel.length > 4 && typeof PLAN.anlass === 'string' && PLAN.anlass.length > 20 && !/\{/.test(PLAN.titel + PLAN.anlass), 'Titel und Anlass stehen in den Daten, ohne Platzhalter');
    const r = BP.pruefe(klon(PLAN));
    ok(r.ok, 'Expander und Pruefer nehmen den Plan an' + (r.ok ? '' : ': ' + JSON.stringify(r.fehler || r).slice(0, 300)));
    ok(D.BEATS.hinterhalt.braucht.lage === 'hinterhalt_ziel' && !!B2.lage('hinterhalt_ziel'), 'beats.json: braucht.lage hinterhalt_ziel, die Bedingung ist in LAGEN');
    ok(D.ANSCHLUSS.plaene.length === 8, 'der Produktivcode (D.ANSCHLUSS) hat denselben Plan');
    const AP = require('../server/sim/abenteuer-prompt.js'); AP.katalogNeuLesen();
    const zeile = AP.katalogText().split('\n').find((l) => /^- hinterhalt/.test(l));
    ok(!!zeile && zeile.length < 400, 'Katalogzeile des Hinterhalts unter 400 Zeichen (' + (zeile ? zeile.length : 'nicht gefunden') + ')');
  }

  // =====================================================================================================================================================================
  console.log('\n2. Der Plan laeuft: Beat -> Ankunft -> gelungen -> Abschluss');
  {
    const r = lauf(461, 'gelungen');
    ok(r.o.ok, 'das Angebot besteht den Pruefer und wird als Faden geoeffnet');
    ok(r.gestartet && r.hex !== '0305' && !r.szeneVorher, `der Beat laeuft ohne Hilfe anderer Beats, der Code waehlt einen anderen Sektor (${r.hex}), noch keine Szene`);
    ok(r.szene === 'hinterhalt' && r.gegner > 0, `die Crew im Sektor: die Szene hinterhalt steht mit ${r.gegner} Gegnern`);
    ok(r.nachBeat.ged.includes('hinterhalt_gelungen') && !r.nachBeat.ged.includes('hinterhalt_gescheitert') && r.nachBeat.phase === 'wartet', 'gelungen: genau einmal, der Faden wartet auf den Abschluss');
    ok(r.abs && r.f.phase === 'abgeschlossen', 'der Abschluss beendet den Faden');
    ok(r.f.nsc.gedaechtnis.some((x) => x.ereignis === 'abschluss_gelungen') && !r.f.nsc.gedaechtnis.some((x) => x.ereignis === 'abschluss_gescheitert'), 'Ausgang des Abschlusses: gelungen (erfolg hinterhalt, die Crew hat den Hinterhalt gebrochen)');
    ok(!r.g.fadenSzene && !(r.g.fadenWarte || []).length && r.g.space.enemies.length === 0, 'nichts bleibt stehen');
    ok(r.g.errors === 0, 'keine Serverfehler');
  }

  // =====================================================================================================================================================================
  console.log('\n3. Gescheitert (Flucht): sauber zum Abschluss, der Abschluss ist gescheitert');
  {
    const r = lauf(462, 'gescheitert');
    ok(r.o.ok && r.gestartet && r.szene === 'hinterhalt' && r.gegner > 0, 'Beat, Ankunft und Szene wie zuvor');
    ok(r.nachBeat.ged.includes('hinterhalt_gescheitert') && !r.nachBeat.ged.includes('hinterhalt_gelungen') && r.nachBeat.phase === 'wartet', 'gescheitert: genau einmal, der Faden wartet auf den Abschluss');
    ok(r.abs && r.f.phase === 'abgeschlossen', 'der Abschluss beendet den Faden');
    ok(r.f.nsc.gedaechtnis.some((x) => x.ereignis === 'abschluss_gescheitert') && !r.f.nsc.gedaechtnis.some((x) => x.ereignis === 'abschluss_gelungen'), 'Ausgang des Abschlusses: gescheitert (die Ankunft allein war kein Erfolg)');
    ok(!r.g.fadenSzene && !(r.g.fadenWarte || []).length && r.g.space.enemies.length === 0 && r.g.errors === 0, 'nichts bleibt stehen, keine Serverfehler');
  }

  // =====================================================================================================================================================================
  console.log('\n4. Ohne waehlbaren Sektor: nicht angeboten, nicht im Mock-Plan; mit Sektor: angeboten');
  {
    const g = spiel(463);
    const L = B2.lage('hinterhalt_ziel');
    ok(L.zahl(g) > 0 && L.fehler(g) === null && !Pruefer.pruefeLage(g, klon(BP.pruefe(klon(PLAN)).vorlage)), 'Lage da: die Zahl ist groesser 0, kein Fehler, der Pruefer laesst den Plan zu (' + L.zahl(g) + ' Sektoren)');
    const orig = B1.erreichbar;
    try {
      B1.erreichbar = () => new Map();   // nichts erreichbar: kein waehlbarer Sektor
      ok(L.zahl(g) === 0 && /^LAGE_ZIEL_FEHLT:/.test(L.fehler(g)), 'ohne Sektor: Zahl 0, Fehler LAGE_ZIEL_FEHLT');
      const a = Faden.abenteuerAnbieten(g, klon(PLAN), { hex: '0305' });
      ok(!a.ok && /LAGE_ZIEL_FEHLT/.test(JSON.stringify(a)), 'das Brett-Angebot wird abgelehnt (LAGE_ZIEL_FEHLT), der Plan wird nicht angeboten');
      const ohne = new Set(); for (let i = 0; i < 300; i++) for (const b of AM.gueltigerPlan(AM.rngVon('hhp:' + i), { lage: { hinterhalt_ziel: 0, sabotage_ziel: 0 } }).beats) ohne.add(b.typ);
      ok(!ohne.has('hinterhalt'), 'der Mock plant den Hinterhalt nie, wenn der Kontext keinen Sektor nennt (300 Plaene)');
    } finally { B1.erreichbar = orig; }
    const mit = new Set(); let alleOk = true;
    for (let i = 0; i < 300; i++) { const p = AM.gueltigerPlan(AM.rngVon('hhp:' + i), { lage: { hinterhalt_ziel: 3, sabotage_ziel: 0 } }); for (const b of p.beats) mit.add(b.typ); if (!BP.expandiere(p).ok) alleOk = false; }
    ok(mit.has('hinterhalt') && alleOk, 'mit Sektor im Kontext plant der Mock den Hinterhalt, jeder Plan besteht den Expander');
    ok(oeffnen(g, '0305').ok, 'mit Sektor: Angebot und Faden gehen auf');
  }

  // =====================================================================================================================================================================
  console.log('\n5. Kein Hinterhalt-Literal im Servercode der Plan-Wege (nur Daten)');
  {
    const dateien = ['faden-bauplan.js', 'faden-pruefer.js', 'abenteuer-brett.js', 'abenteuer-mock.js', 'abenteuer-prompt.js', 'faden-daten.js', 'faden.js'];
    const treffer = dateien.filter((d) => /hinterhalt/i.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', d), 'utf8').replace(/\/\/.*$/gm, '')));
    ok(treffer.length === 0, 'kein Artname hinterhalt in ' + dateien.join(', ') + (treffer.length ? ' (Treffer: ' + treffer.join(', ') + ')' : ''));
    const b2 = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-b2.js'), 'utf8').replace(/\/\/.*$/gm, '');
    ok((b2.match(/hinterhalt/gi) || []).length === 3, 'faden-b2.js: nur der Schluessel der Lagen-Bedingung und der Aufruf der Kandidaten stehen im Code (' + (b2.match(/hinterhalt/gi) || []).length + ' Treffer)');
    ok(!/'(Ein Hinterhalt|Funkmeldungen)/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'abenteuer-brett.js'), 'utf8')), 'kein Plan-Text im Servercode');
  }

  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
  console.log('HINTERHALT-PLAN OK');
}
try { main(); process.exit(0); } catch (e) { console.log('ABSTURZ ' + (e && e.stack)); process.exit(1); }
