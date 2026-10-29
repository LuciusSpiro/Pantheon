'use strict';
// SUND-04b E1/E2/E3: Kanon, Wiederkehr und Wiederholungsregeln der Abenteuer (server/sim/abenteuer-kanon.js, abenteuer-wiederholung.js, die Haken in faden.js und abenteuer-brett.js, Daten content/faeden/abenteuer-brett.json
// und b1-texte.json). Die Erwartungen stehen hier selbst (aus den Daten und von Hand gerechnet, ein eigenes Hauptbuch der erzeugten Abenteuer), nie aus dem Produktivcode abgeleitet.
// Geprueft wird: Daten · E1 Kanon (Einheit: jede Regel einzeln, Beginn und Ende im Spiel, Namen, Ausgang genau einmal, Weltstand: Schema, Laden, Altstand, Muell, nie im Prompt) · E1 Test ueber
// 240 Abenteuer (40 feste Seeds): keine Widersprueche, keine doppelten Namen, Kanon vor und nach dem Laden gleich · E2 Wiederkehr (gelungen gegen gescheitert, letzte Tat gewinnt, Daten, Laden)
// · E3 Wiederholung (Folge, Ort, NSC, offene Angebote, Anschluss lockert stufenweise und verklemmt nie, Eigenschaftstest gegen eine eigene Rechnung).
// Aufruf: node tools/test-abenteuer-kanon.js [begriff ...]        (npm run test:abenteuer-kanon)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Kanon = require('../server/sim/abenteuer-kanon.js');
const Wdh = require('../server/sim/abenteuer-wiederholung.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const B1 = require('../server/sim/faden-b1.js');
const AP = require('../server/sim/abenteuer-prompt.js');

const { D, Faden, F } = X;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const BRETT = lies('content/faeden/abenteuer-brett.json'), ANS = lies('content/faeden/anschluss.json'), WERTE = lies('content/faeden/werte.json').werte, TX = lies('content/faeden/b1-texte.json');
const SCHEMA = lies('content/schema/weltstand.schema.json');
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const KANON_MAX = BRETT.werte.kanon_max.wert, WD = BRETT.werte.wiederholung.wert;
const VOLK = ['rom', 'ger', 'kon'];

// ---------------------------------------------------------------- Hilfen
function neu(seed, o) {
  o = o || {};
  const t = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: Object.assign({ FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' }, o.env || {}) });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  t.c = t.cs[0];
  return t;
}
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats }, o || {});
const b = (typ, o) => Object.assign({ typ }, o || {});
const einzel = (typ, i, o) => plan([b(typ), b('abschluss')], Object.assign({ titel: typ + ' ' + i, anlass: 'Probeanlass ' + typ + ' Nummer ' + i + ' ohne Namen' }, o || {}));
const zust = (g) => Faden.zustandVon(g);
const liste = (g) => g.weltsim.faeden.liste;
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const grenzen = (g, k) => { for (let i = 0; i < k; i++) g.lageGrenze('andocken'); };
const hexname = (hex) => Sektoren.hexName(hex);
// ein Abenteuer wirklich oeffnen (ueber den echten Weg: anbieten, oeffnen) und zu Ende bringen: jeder Beat bekommt den Ausgang ueber Faden.beatAusgang, also laufen Gedaechtnis, Folgen, Abschluss, Kanon, Chronik und Logbuch
// wie im Spiel (die Bausteine und Szenen sind nicht Gegenstand dieses Tests: das Hauptbuch der Abenteuer, nicht ihr Spiel)
function beginne(g, p, hex, parameter, neuAnbieten) {
  const a = (neuAnbieten ? Faden.abenteuerNeuAnbieten : Faden.abenteuerAnbieten)(g, p, { hex: hex || '0305' });
  if (!a.ok) return { a };
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, parameter);
  return { a, r, f: r.ok ? r.faden : null };
}
function beende(g, f, ausgang) {
  const v = D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) {
    f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 };
    Faden.beatAusgang(g, f.id, typeof ausgang === 'function' ? ausgang(i) : ausgang);
  }
  return f.phase === 'abgeschlossen';
}
const spiele = (g, p, ausgang, hex, parameter) => { const r = beginne(g, p, hex, parameter); if (r.f) r.fertig = beende(g, r.f, ausgang || 'gelungen'); return r; };
function rng(seed) { let a = (seed * 2654435761) >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const speichern = (g) => klon(Weltstand.capture(g).welt.sim);
function laden(sim, seed) { D.zuruecksetzen(); const t = neu(seed); Kriegslage.restore(t.g, klon(sim)); return t; }
const nrVon = (id) => Number(String(id).slice(1));
const kanonJson = (g) => JSON.stringify(Kanon.liste(zust(g)));

// ======================================================================
section('Daten: Zahlen des Kanons und der Wiederholung, Schema, Texte der Wiederkehr', () => {
  ok(Number.isInteger(KANON_MAX) && KANON_MAX >= 2 * WERTE.faeden_gesamt_max.wert, `kanon_max ${KANON_MAX}: mindestens doppelt so gross wie die Liste der Faeden (${WERTE.faeden_gesamt_max.wert})`);
  ok(WD.folge_zuletzt >= 1 && WD.ort_typ_zuletzt >= 1 && WD.nsc_zuletzt >= 1 && Object.values(WD).every(Number.isInteger), 'wiederholung: drei ganze Zahlen aus den Daten: ' + JSON.stringify(WD));
  const kp = (function f(o) { if (!o || typeof o !== 'object') return null; if (o.faeden && o.faeden.properties) return o.faeden.properties.kanon; for (const k of Object.keys(o)) { const r = f(o[k]); if (r) return r; } return null; })(SCHEMA);
  ok(kp && kp.type === 'array' && kp.maxItems === KANON_MAX && kp.items.additionalProperties === false, 'Schema weltstand: welt.sim.faeden.kanon ist ein Feld mit der Obergrenze kanon_max und festen Eintragsfeldern');
  ok(JSON.stringify(Object.keys(Weltstand.capture(neu(2).g))).includes('version') && Weltstand.capture(neu(2).g).version === 3, 'Weltstand bleibt Version 3');
  ok(B1.katalogFehler().length === 0, 'Katalogdaten der Bausteine B1 sind in sich stimmig (auch die Paare der Wiederkehr)');
  // Pruefregel WIEDERSEHEN_PAAR: jede Tat hat beide Ausgaenge mit verschiedenem Text
  const E = D.B1.werte.wiedersehen_erinnert, T = D.B1.texte;
  const nur = (k) => Object.keys(E).filter((x) => x.endsWith(k));
  ok(nur('_gelungen').length === nur('_gescheitert').length && nur('_gelungen').every((x) => (x.replace(/_gelungen$/, '_gescheitert') in E)), 'jede Tat der Wiederkehr gibt es als gelungen und gescheitert (' + nur('_gelungen').length + ' Paare)');
  ok(nur('_gelungen').every((x) => T[E[x]] !== T[E[x.replace(/_gelungen$/, '_gescheitert')]]), 'die beiden Texte jedes Paars unterscheiden sich');
  const eins = Object.keys(E).find((x) => x.endsWith('_gescheitert')), alt = E[eins];
  delete E[eins]; const f1 = B1.katalogFehler(); E[eins] = alt;
  ok(f1.some((x) => /WIEDERSEHEN_PAAR/.test(x)), 'fehlt ein Gegenpart, meldet die Katalogpruefung WIEDERSEHEN_PAAR');
  const gel = eins.replace(/_gescheitert$/, '_gelungen'), altG = E[gel];
  E[gel] = E[eins]; const f2 = B1.katalogFehler(); E[gel] = altG;
  ok(f2.some((x) => /WIEDERSEHEN_PAAR/.test(x)) && B1.katalogFehler().length === 0, 'derselbe Text fuer gelungen und gescheitert: WIEDERSEHEN_PAAR; nach dem Zuruecksetzen wieder sauber');
});

// ======================================================================
section('E1 Kanon (Einheit): jede Pruefregel einzeln', () => {
  const eintrag = (f, name, o) => Object.assign({ f, name, volk: 'rom', ort: '0305', folge: ['notruf'] }, o || {});
  const codes = (liste) => Kanon.pruefe({ kanon: klon(liste), liste: [] }).map((x) => x.split(':')[0]);
  ok(codes([eintrag('f1', 'A B'), eintrag('f2', 'C D', { titel: 'T', ausgang: 'gelungen', ort_ende: '0305' }), eintrag('f3', 'A B', { wieder: true })]).length === 0, 'ein gueltiger Kanon (mit einem Wiedersehen und einem Ausgang) hat keinen Fehler');
  ok(codes([eintrag('f1', 'A B'), eintrag('f2', 'A B')]).includes('KANON_NAME_DOPPELT'), 'zwei NSC mit demselben Namen, der zweite kein Wiedersehen: KANON_NAME_DOPPELT');
  ok(codes([eintrag('f1', 'A B'), eintrag('f2', 'A B', { wieder: true, volk: 'ger' })]).includes('KANON_NAME_VOLK'), 'derselbe Name mit zwei Voelkern: KANON_NAME_VOLK');
  ok(codes([eintrag('f1', 'A B', { wieder: true })]).includes('KANON_WIEDER'), 'ein Wiedersehen ohne frueheren Eintrag: KANON_WIEDER');
  ok(codes([eintrag('f1', 'A B'), eintrag('f1', 'C D')]).includes('KANON_ID_DOPPELT'), 'derselbe Faden zweimal: KANON_ID_DOPPELT');
  ok(codes([eintrag('f1', 'A B', { ausgang: 'gelungen' })]).includes('KANON_AUSGANG') && codes([eintrag('f1', 'A B', { ort_ende: '0305' })]).includes('KANON_AUSGANG'), 'Ausgang ohne Ort am Ende und Ort am Ende ohne Ausgang: KANON_AUSGANG');
  for (const [was, e] of [['Kennung', eintrag('x1', 'A B')], ['Name', eintrag('f1', '')], ['Volk', eintrag('f1', 'A B', { volk: 'mars' })], ['Ort', eintrag('f1', 'A B', { ort: '99' })], ['Typenfolge', eintrag('f1', 'A B', { folge: ['abschluss'] })], ['Titel', eintrag('f1', 'A B', { titel: 'x'.repeat(61) })], ['Ausgang', eintrag('f1', 'A B', { ausgang: 'teilweise', ort_ende: '0305' })]]) ok(codes([e]).includes('KANON_FORM'), 'falsche Form (' + was + '): KANON_FORM');
  // gegen die Liste der Faeden
  const t = neu(5), g = t.g;
  const r = beginne(g, einzel('notruf', 1)); const F1 = zust(g);
  ok(Kanon.pruefe(F1).length === 0 && Kanon.beginnen(F1, r.f) === false && Kanon.wiedersehenBeginnen(F1, r.f) === false && F1.kanon.length === 1, 'nach dem Oeffnen ist der Kanon stimmig, ein zweiter Beginn desselben Fadens legt nichts an');
  F1.kanon[0].name = 'Fremder Name';
  ok(Kanon.pruefe(F1).some((x) => /^KANON_LISTE/.test(x)), 'Name im Kanon weicht vom NSC des Fadens ab: KANON_LISTE');
  F1.kanon[0].name = r.f.nsc.name;
  F1.kanon = [];
  ok(Kanon.pruefe(F1).some((x) => /^KANON_LISTE.*fehlt/.test(x)), 'ein Faden der Liste ohne Eintrag: KANON_LISTE');
});

section('E1 Kanon im Spiel: Beginn, Ende genau einmal, Namen, Chronik ohne Namen, nie im Prompt', () => {
  const t = neu(7), g = t.g, F1 = zust(g);
  const r = beginne(g, einzel('notruf', 1, { titel: 'Das Versprechen am Dock' }), '0306');
  ok(r.f && Kanon.liste(F1).length === 1, 'das Oeffnen legt genau einen Eintrag an');
  const e = Kanon.liste(F1)[0];
  ok(e.f === r.f.id && e.name === r.f.nsc.name && e.volk === r.f.nsc.fraktion && e.ort === '0306' && e.titel === 'Das Versprechen am Dock' && JSON.stringify(e.folge) === '["notruf"]' && e.ausgang === undefined && !e.wieder, 'Eintrag: Faden, Name, Volk, Ort des Beginns, Titel, Typenfolge; noch kein Ausgang ' + JSON.stringify(e));
  ok(!Kanon.nameFrei(F1, r.f.nsc.name) && Kanon.nameFrei(F1, 'Niemand Anders'), 'der Name ist vergeben, ein anderer frei');
  const ch0 = g.weltsim.chronik.length;
  ok(beende(g, r.f, 'gescheitert'), 'das Abenteuer endet');
  ok(e.ausgang === 'gescheitert' && e.ort_ende === '0306' && e.status === r.f.nsc.status, 'Ausgang gescheitert, Ort am Ende und Zustand des NSC stehen im Kanon');
  const zeile = g.weltsim.chronik.slice(ch0).filter((c) => c.ref === r.f.id);
  ok(zeile.length === 1 && zeile[0].kurz === BRETT.chronik.gescheitert.replace('{ort}', hexname('0306')) && !zeile[0].kurz.includes(r.f.nsc.name) && !zeile[0].kurz.includes('Versprechen'), 'Chronik: eine Zeile aus den Daten mit dem Ort, ohne NSC-Name und ohne Titel: "' + (zeile[0] && zeile[0].kurz) + '"');
  // kein zweiter Ausgang fuer dasselbe Abenteuer
  const fp0 = logbuch(g).filter((x) => x.art === 'faden_pruefung').length;
  ok(Kanon.beendet(g, r.f, 'gelungen') === false && e.ausgang === 'gescheitert', 'ein zweiter Ausgang fuer dasselbe Abenteuer wird abgelehnt, der erste bleibt');
  ok(logbuch(g).filter((x) => x.art === 'faden_pruefung').length === fp0 + 1 && /KANON_AUSGANG/.test(JSON.stringify(logbuch(g).filter((x) => x.art === 'faden_pruefung').pop())), 'die Ablehnung steht im Regie-Logbuch (KANON_AUSGANG)');
  ok(!Faden.beatAusgang(g, r.f.id, 'gelungen').ok && e.ausgang === 'gescheitert', 'ueber den echten Weg (beatAusgang) ist ein zweiter Ausgang ohnehin nicht moeglich');
  { const x = beginne(g, einzel('spontanhilfe', 2), '0307'); ok(x.f && Kanon.beendet(g, x.f, 'teilweise') === false && Kanon.eintragVon(F1, x.f.id).ausgang === undefined, 'ein unbekannter Ausgang wird nicht eingetragen (der Eintrag bleibt ohne Ausgang)'); beende(g, x.f, 'gelungen'); }
  // der Name steht nie im Prompt der Komposition (auch nicht ueber den Kanon)
  const pr = AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [] }).prompt;
  ok(!pr.includes(r.f.nsc.name) && !pr.includes(r.f.nsc.name.split(' ')[0]) && !pr.includes('Versprechen') && !NAMEN.some((x) => pr.includes(x)), 'der Name des NSC und der Titel stehen nicht im Prompt der Komposition');
  const lage = require('../server/sim/lage-ausschnitt.js').ausschnitt(g, { stufe: 0 }).text;
  ok(!lage.includes(r.f.nsc.name) && !lage.includes('"kanon"'), 'auch der Ausschnitt der Lage traegt weder den Namen noch den Kanon');
  // ein Name aus dem Kanon ist vergeben, auch wenn der Faden aus der Liste gefallen ist
  const tn = neu(8), gn = tn.g, ersterName = (() => { const x = beginne(gn, einzel('notruf', 1)); beende(gn, x.f, 'gelungen'); return x.f.nsc.name; })();
  for (let i = 2; i <= WERTE.faeden_gesamt_max.wert + 3; i++) { const x = spiele(gn, einzel('notruf', i)); if (!x.fertig) ok(false, 'Vorlauf ' + i); }
  ok(!liste(gn).some((f) => f.nsc.name === ersterName) && Kanon.liste(zust(gn)).some((k) => k.name === ersterName), 'der erste Faden ist aus der Liste verdraengt, sein Name steht weiter im Kanon');
  const volk = Kanon.liste(zust(gn))[0].volk;
  const doppelt = beginne(gn, einzel('notruf', 99, { volk_erlaubt: [volk] }), '0305', { name: ersterName });
  ok(doppelt.a.ok && doppelt.r && !doppelt.r.ok && /NAME/.test(doppelt.r.grund), 'ein Name aus dem Kanon darf nicht noch einmal vergeben werden (NAME: ' + (doppelt.r && doppelt.r.grund) + ')');
  ok(Kanon.pruefe(zust(gn)).length === 0, 'der Kanon ist stimmig');
  ok(g.errors === 0 && gn.errors === 0, 'keine Serverfehler');
});

section('E1 Kanon: Obergrenze, Kuerzen nie ein laufendes Abenteuer', () => {
  // auch ein Faden aus einer Vorlagendatei (nicht nur ein Abenteuer) steht im Kanon, ohne Titel, und zaehlt nicht als Abenteuer der Wiederholungsregeln
  D.registriere(X.vorlageTest());
  { const tv = neu(60), gv = tv.g, fv = X.oeffne(gv);
    const e = fv && Kanon.eintragVon(zust(gv), fv.id);
    ok(fv && e && e.name === fv.nsc.name && e.titel === undefined && e.wieder === undefined && Wdh.verlauf(gv).length === 0 && Kanon.pruefe(zust(gv)).length === 0, 'ein Faden aus der Vorlagendatei: Eintrag ohne Titel, nicht im Verlauf der Abenteuer'); }
  const t = neu(9), g = t.g, F1 = zust(g);
  for (let i = 1; i <= KANON_MAX + 6; i++) { const x = spiele(g, einzel(['notruf', 'spontanhilfe', 'raumschlacht'][i % 3], i)); if (!x.fertig) { ok(false, 'Vorlauf ' + i); break; } }
  ok(Kanon.liste(F1).length === KANON_MAX, `nach ${KANON_MAX + 6} Abenteuern stehen genau ${KANON_MAX} Eintraege im Kanon`);
  const nummern = Kanon.liste(F1).map((e) => Number(e.f.slice(1)));
  ok(nummern.every((x, i) => i === 0 || x > nummern[i - 1]) && nummern[nummern.length - 1] === KANON_MAX + 6, 'die aeltesten sind herausgefallen, die Reihenfolge steigt, der juengste steht da');
  const lauf = beginne(g, einzel('notruf', 500));
  ok(lauf.f && Kanon.liste(F1).some((e) => e.f === lauf.f.id && e.ausgang === undefined) && Kanon.liste(F1).length <= KANON_MAX, 'ein laufendes Abenteuer steht im Kanon (ohne Ausgang) und bleibt, wenn gekuerzt wird');
  for (let i = 0; i < 5; i++) { Kanon.kuerzen(F1); }
  ok(Kanon.liste(F1).some((e) => e.f === lauf.f.id), 'Kuerzen entfernt nie ein Abenteuer ohne Ausgang');
});

section('E1 Kanon im Weltstand: Schema, Laden, Altstand, Muell, Prototype-Keys', () => {
  const t = neu(12), g = t.g;
  // 11 Abenteuer: die Liste fasst 9, die zwei aeltesten leben nur noch im Kanon: der Block steht im Stand
  for (let i = 1; i <= WERTE.faeden_gesamt_max.wert + 2; i++) spiele(g, einzel('notruf', i), i % 2 ? 'gelungen' : 'gescheitert', i % 2 ? '0305' : '0306');
  const wv = require('../server/sim/faden-bauplan.js').expandiere(einzel('wiedersehen', 12)).vorlage;
  const wd = spiele(g, einzel('wiedersehen', 12), 'gelungen', '0305', { nsc_von: Wdh.kandidatenFrisch(g, wv)[0] });   // ein Wiedersehen: derselbe NSC, ein zweiter Eintrag mit wieder
  const lauf = beginne(g, einzel('spontanhilfe', 90), '0307');
  const sim = speichern(g);
  ok(wd.fertig && Kanon.eintragVon(zust(g), wd.f.id).wieder === true, 'ein Wiedersehen steht mit wieder: true im Kanon');
  ok(Array.isArray(sim.faeden.kanon) && sim.faeden.kanon.length === 11 + 1 + 1 && Weltstand.validate(Weltstand.capture(g), g).filter((x) => /faeden|kanon/.test(String(x))).length === 0, 'Block kanon im Stand (' + (sim.faeden.kanon && sim.faeden.kanon.length) + ' Eintraege), schemagueltig');
  const vorher = kanonJson(g);
  const t2 = laden(sim, 13), g2 = t2.g;
  ok(kanonJson(g2) === vorher && zust(g2).ladeFehler.length === 0, 'nach dem Laden ist der Kanon derselbe (auch die zwei verdraengten Abenteuer), keine Ladefehler');
  ok(JSON.stringify(Faden.toSave(g2.weltsim)) === JSON.stringify(sim.faeden), 'Speichern nach dem Laden ergibt denselben Block');
  ok(Kanon.pruefe(zust(g2)).length === 0 && Kanon.liste(zust(g2)).some((e) => e.f === lauf.f.id && e.ausgang === undefined), 'der Kanon ist stimmig, das laufende Abenteuer steht ohne Ausgang');
  // Altstand ohne Kanon: aus der Liste abgeleitet; was die Liste nicht mehr kennt, fehlt dann (bekannte Grenze)
  const alt = klon(sim); delete alt.faeden.kanon;
  const t3 = laden(alt, 14), g3 = t3.g;
  ok(Kanon.liste(zust(g3)).length === liste(g3).length && Kanon.pruefe(zust(g3)).length === 0 && liste(g3).every((f) => Kanon.eintragVon(zust(g3), f.id).name === f.nsc.name), 'Altstand ohne Block: der Kanon wird aus der Liste abgeleitet (' + Kanon.liste(zust(g3)).length + ' Eintraege), stimmig');
  // ein Stand ohne Abenteuer und ohne Besonderheit: kein Block (byte-gleich zum Stand davor)
  const tl = neu(15), gl = tl.g; spiele(gl, einzel('notruf', 1));
  ok(!('kanon' in speichern(gl).faeden), 'solange der Kanon nur wiedergibt, was die Liste ohnehin weiss, steht kein Block im Stand');
  // Muell
  const muell = (mod, was) => { const s = klon(sim); mod(s.faeden.kanon); const tt = laden(s, 16); ok(Kanon.pruefe(zust(tt.g)).length === 0 && tt.g.errors === 0, was); return tt; };
  muell((k) => { k.push({ f: 'f1', name: 'X', volk: 'rom', ort: '0305', folge: [] }); }, 'ein Eintrag mit doppelter Kennung faellt weg, der Kanon bleibt stimmig');
  muell((k) => { k[0] = { f: 'f1' }; }, 'ein Eintrag ohne Pflichtfelder faellt weg (aus der Liste oder dem Rest abgeleitet)');
  muell((k) => { k.push(JSON.parse('{"f":"f999","name":"Z Z","volk":"rom","ort":"0305","folge":[],"__proto__":{"x":1}}')); }, 'ein Eintrag mit Prototype-Key faellt nicht ueber, der Kanon bleibt stimmig');
  muell((k) => { k.push({ f: 'f998', name: k[k.length - 1].name, volk: 'rom', ort: '0305', folge: [] }); }, 'ein zweiter NSC mit vergebenem Namen faellt weg');
  muell((k) => { k.push({ f: 'f997', name: 'Gaius Test', volk: 'rom', ort: '0305', folge: [], ausgang: 'gelungen' }); }, 'ein Ausgang ohne Ort am Ende faellt weg');
  { const s = klon(sim); s.faeden.kanon = 'muell'; const tt = laden(s, 17); ok(Kanon.pruefe(zust(tt.g)).length === 0 && zust(tt.g).ladeFehler.some((x) => /kanon/.test(x)), 'kein Feld: verworfen mit Meldung, abgeleitet aus der Liste'); }
  { const s = klon(sim); s.faeden.kanon = Array.from({ length: 500 }, (_, i) => ({ f: 'f' + (1000 + i), name: 'N' + i, volk: 'rom', ort: '0305', folge: [] })); const tt = laden(s, 18); ok(Kanon.liste(zust(tt.g)).length <= KANON_MAX && Kanon.pruefe(zust(tt.g)).length === 0, 'mehr als kanon_max Eintraege: geklemmt'); }
  // die Liste ist die Wahrheit, solange der Faden in ihr steht
  { const s = klon(sim); const e = s.faeden.kanon[s.faeden.kanon.length - 2]; const f = s.faeden.liste.find((x) => x.id === e.f); if (f) { e.name = 'Falscher Name'; e.volk = f.nsc.fraktion === 'rom' ? 'ger' : 'rom'; } const tt = laden(s, 19); const e2 = Kanon.eintragVon(zust(tt.g), e.f); ok(!f || (e2.name === f.nsc.name && e2.volk === f.nsc.fraktion), 'ein Eintrag, der dem Faden der Liste widerspricht, wird von der Liste korrigiert'); }
});

// ======================================================================
section('E1 ueber 240 Abenteuer (40 feste Seeds): keine Widersprueche, keine doppelten Namen, Kanon vor und nach dem Laden gleich', () => {
  const SEEDS = 40, JE = 6, TYPEN = ['notruf', 'spontanhilfe', 'raumschlacht', 'wiedersehen'];
  const buch = [];   // eigenes Hauptbuch: jede Eroeffnung in Reihenfolge { f, name, volk, wieder }
  let abenteuer = 0, wiedersehen = 0, geladen = 0, gescheitert = 0, probleme = [];
  const prob = (s) => { if (probleme.length < 8) probleme.push(s); };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed * 7919);
    let t = neu(1000 + seed), g = t.g;
    const eigene = [];
    for (let k = 1; k <= JE; k++) {
      let typ = TYPEN[Math.floor(r() * TYPEN.length)];
      let parameter, p;
      if (typ === 'wiedersehen') {
        p = einzel('wiedersehen', seed * 100 + k);
        const kand = Faden.wiedersehenKandidaten(g, require('../server/sim/faden-bauplan.js').expandiere(p).vorlage);
        if (!kand.length) { typ = 'notruf'; p = einzel('notruf', seed * 100 + k); } else parameter = { nsc_von: kand[Math.floor(r() * kand.length)] };
      } else p = einzel(typ, seed * 100 + k);
      const ort = ['0305', '0306', '0307', '0205'][Math.floor(r() * 4)];
      const x = beginne(g, p, ort, parameter);
      if (!x.f) { prob(`Seed ${seed} Nr ${k}: nicht geoeffnet (${x.r ? x.r.grund : x.a.grund})`); continue; }
      abenteuer++;
      const wieder = parameter !== undefined;
      if (wieder) wiedersehen++;
      const nsc = x.f.nsc;
      // 1) kein zweiter NSC mit gleichem Namen innerhalb des Fensters der Eintraege (Hauptbuch, eigene Rechnung)
      const fenster = eigene.slice(-(KANON_MAX - 1));
      if (!wieder && fenster.some((e) => e.name === nsc.name)) prob(`Seed ${seed} Nr ${k}: Name ${nsc.name} doppelt`);
      if (wieder && !fenster.some((e) => e.name === nsc.name && e.volk === nsc.fraktion)) prob(`Seed ${seed} Nr ${k}: Wiedersehen ohne frueheren Eintrag`);
      const eintrag = { f: x.f.id, name: nsc.name, volk: nsc.fraktion, wieder, eigene };
      buch.push(eintrag); eigene.push(eintrag);
      // 2) Ausgang genau einmal, im Kanon, Ort in der Chronik
      const ausgang = r() < 0.35 ? 'gescheitert' : 'gelungen';
      if (ausgang === 'gescheitert') gescheitert++;
      const ch0 = g.weltsim.chronik.length, lb0 = logbuch(g).filter((e) => e.ausgang === 'abenteuer_ende').length;
      if (!beende(g, x.f, ausgang)) { prob(`Seed ${seed} Nr ${k}: nicht abgeschlossen`); continue; }
      const e = Kanon.eintragVon(zust(g), x.f.id);
      if (!e || e.ausgang !== ausgang || e.name !== nsc.name || e.volk !== nsc.fraktion || !!e.wieder !== wieder || e.ort !== ort) prob(`Seed ${seed} Nr ${k}: Eintrag stimmt nicht ${JSON.stringify(e)}`);
      if (logbuch(g).filter((l) => l.ausgang === 'abenteuer_ende').length !== lb0 + 1 && logbuch(g).length < 190) prob(`Seed ${seed} Nr ${k}: nicht genau ein Ende im Logbuch`);
      const zeilen = g.weltsim.chronik.slice(ch0).filter((c) => c.ref === x.f.id);
      if (zeilen.length !== 1 || zeilen[0].kurz !== BRETT.chronik[ausgang].replace('{ort}', hexname(e.ort_ende)) || zeilen[0].kurz.includes(nsc.name)) prob(`Seed ${seed} Nr ${k}: Chronik-Zeile ${JSON.stringify(zeilen)}`);
      const fehler = Kanon.pruefe(zust(g));
      if (fehler.length) prob(`Seed ${seed} Nr ${k}: ${fehler[0]}`);
      // 3) Speichern und Laden mitten im Lauf: der Kanon ist danach derselbe
      if (k % 3 === 0) {
        const vor = kanonJson(g), sim = speichern(g);
        if (Weltstand.validate(Weltstand.capture(g), g).filter((q) => /faeden|kanon/.test(String(q))).length) prob(`Seed ${seed} Nr ${k}: Stand nicht schemagueltig`);
        t = laden(sim, 5000 + seed * 10 + k); g = t.g; geladen++;
        if (kanonJson(g) !== vor) prob(`Seed ${seed} Nr ${k}: Kanon nach dem Laden anders`);
        if (zust(g).ladeFehler.length) prob(`Seed ${seed} Nr ${k}: Ladefehler ${zust(g).ladeFehler[0]}`);
        if (JSON.stringify(Faden.toSave(g.weltsim)) !== JSON.stringify(sim.faeden)) prob(`Seed ${seed} Nr ${k}: Speichern nach Laden verschieden`);
      }
    }
    if (g.errors) prob(`Seed ${seed}: Serverfehler`);
  }
  // der unabhaengige Namenstest ueber alle Eroeffnungen: in jedem Fenster von kanon_max Eroeffnungen derselben Partie nur Wiedersehen mit gleichem Namen
  const jeSeed = new Map(); for (const e of buch) { if (!jeSeed.has(e.eigene)) jeSeed.set(e.eigene, []); jeSeed.get(e.eigene).push(e); }
  let doppelt = 0, wiederOhne = 0;
  for (const liste2 of jeSeed.values()) for (let i = 0; i < liste2.length; i++) for (let j = 0; j < i; j++) if (liste2[i].name === liste2[j].name) { if (!liste2[i].wieder || liste2[i].volk !== liste2[j].volk) doppelt++; }
  ok(abenteuer >= 200 && abenteuer === buch.length, `${abenteuer} Abenteuer in ${SEEDS} Partien (Seeds 1001 bis ${1000 + SEEDS}), davon ${wiedersehen} Wiedersehen, ${gescheitert} gescheitert, ${geladen} Mal gespeichert und geladen`);
  ok(doppelt === 0, 'kein Name zweimal vergeben ohne Wiedersehen (Hauptbuch aller Partien, ' + doppelt + ' Verstoesse)');
  ok(probleme.length === 0, 'keine Widersprueche im Kanon, Ausgang genau einmal, Chronik mit dem Ort, Kanon nach dem Laden gleich' + (probleme.length ? ': ' + probleme.join(' | ') : ''));
  ok(wiedersehen >= 20, 'das Wiedersehen kam oft genug vor, um den Kanon zu pruefen (' + wiedersehen + ')');
});

// ======================================================================
// weitere Einheitspruefungen (Mutationsprobe): Abgleich mit der Liste, Kuerzen, Laden mit Widerspruechen, Namen im Pruefer, Stufen der Wiederholung
const BPlan = require('../server/sim/faden-bauplan.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const FIN = { ausgang: 'gelungen', ort_ende: '0305' };
const kE = (f, name, o) => Object.assign({ f, name, volk: 'rom', ort: '0305', folge: ['notruf'] }, o || {});
const stubFaden = (id, name, volk, phase, art) => ({ id, nsc: { name, fraktion: volk }, phase, ausgang: art ? { art, status: 'aktiv' } : null, parameter: { ort: '0305' }, vorlage: 'x' });
section('E1 Kanon (Einheit): Abgleich mit der Liste, Kuerzen, Laden mit Widerspruechen', () => {
  // KANON_LISTE: Name, Volk und Ausgang eines Fadens der Liste
  const stimmt = { kanon: [kE('f1', 'A B', FIN)], liste: [stubFaden('f1', 'A B', 'rom', 'abgeschlossen', 'gelungen')] };
  ok(Kanon.pruefe(stimmt).length === 0, 'Stub: Kanon und Liste stimmen: keine Meldung');
  ok(Kanon.pruefe({ kanon: [kE('f1', 'A B', FIN)], liste: [stubFaden('f1', 'A B', 'ger', 'abgeschlossen', 'gelungen')] }).some((x) => /^KANON_LISTE.*Volk/.test(x)), 'das Volk weicht vom Faden ab: KANON_LISTE');
  ok(Kanon.pruefe({ kanon: [kE('f1', 'A B', FIN)], liste: [stubFaden('f1', 'A B', 'rom', 'abgeschlossen', 'gescheitert')] }).some((x) => /^KANON_LISTE.*Ausgang gelungen statt gescheitert/.test(x)), 'der Ausgang weicht vom Faden ab: KANON_LISTE');
  ok(Kanon.pruefe({ kanon: [kE('f1', 'A B')], liste: [stubFaden('f1', 'A B', 'rom', 'abgeschlossen', 'gelungen')] }).some((x) => /^KANON_LISTE.*Ausgang undefined statt gelungen/.test(x)), 'ein abgeschlossener Faden ohne Ausgang im Kanon: KANON_LISTE');
  ok(Kanon.pruefe({ kanon: [kE('f1', 'A B', FIN)], liste: [stubFaden('f1', 'A B', 'rom', 'wartet')] }).some((x) => /^KANON_LISTE.*Ausgang gelungen statt undefined/.test(x)), 'ein Ausgang im Kanon, obwohl der Faden laeuft: KANON_LISTE');
  // Kuerzen: ein laufendes Abenteuer (ohne Ausgang) faellt nie heraus, auch wenn es das aelteste ist; es fallen die aeltesten abgeschlossenen
  const FK = { kanon: [kE('f1', 'Lauf Mann')].concat(Array.from({ length: KANON_MAX + 5 }, (_, i) => kE('f' + (i + 2), 'N' + i, FIN))), liste: [] };
  Kanon.kuerzen(FK);
  ok(FK.kanon.length === KANON_MAX && FK.kanon[0].f === 'f1' && FK.kanon[1].f === 'f8' && FK.kanon[FK.kanon.length - 1].f === 'f' + (KANON_MAX + 6), 'Kuerzen: ' + KANON_MAX + ' bleiben, das laufende (aelteste) bleibt, die sechs aeltesten abgeschlossenen fallen weg');
  const FL = { kanon: Array.from({ length: KANON_MAX + 3 }, (_, i) => kE('f' + (i + 1), 'N' + i, FIN)), liste: [stubFaden('f1', 'N0', 'rom', 'abgeschlossen', 'gelungen')] };
  Kanon.kuerzen(FL);
  ok(FL.kanon[0].f === 'f1' && FL.kanon.length === KANON_MAX, 'Kuerzen: ein abgeschlossener Eintrag, dessen Faden noch in der Liste steht, bleibt');
  // Laden mit Widerspruechen (Stub ohne Spiel; die Eintraege tragen einen Ausgang, damit sie nicht als verwaiste laufende gelten)
  const lese = (block, liste2) => { const S = { liste: liste2 || [], ladeFehler: [] }; Kanon.lesen(block, S); return S; };
  let S = lese([kE('f1', 'A B', FIN), kE('f1', 'C D', FIN)]);
  ok(S.kanon.length === 1 && S.kanon[0].name === 'A B' && Kanon.pruefe(S).length === 0, 'Laden: derselbe Faden zweimal: der zweite faellt weg');
  S = lese([kE('f1', 'A B', FIN), kE('f2', 'A B', FIN)]);
  ok(S.kanon.length === 1 && S.ladeFehler.length === 1, 'Laden: zwei NSC mit demselben Namen: der zweite faellt weg (mit Meldung)');
  S = lese([kE('f1', 'A B', FIN), kE('f2', 'A B', Object.assign({ wieder: true, volk: 'ger' }, FIN))]);
  ok(S.kanon.length === 1, 'Laden: derselbe Name mit anderem Volk (auch als Wiedersehen): der zweite faellt weg');
  S = lese([kE('f1', 'A B', Object.assign({ wieder: true }, FIN))]);
  ok(S.kanon.length === 0, 'Laden: ein Wiedersehen ohne Vorgaenger faellt weg');
  S = lese([kE('f1', 'A B', FIN), kE('f2', 'A B', Object.assign({ wieder: true }, FIN))]);
  ok(S.kanon.length === 2 && S.ladeFehler.length === 0 && Kanon.pruefe(S).length === 0, 'Laden: ein gueltiges Wiedersehen bleibt');
  S = lese([kE('f1', 'A B', { ausgang: 'gelungen' })]);
  ok(S.kanon.length === 0, 'Laden: ein Ausgang ohne Ort am Ende faellt weg');
  S = lese('muell');
  ok(S.kanon.length === 0 && S.ladeFehler.some((x) => /kanon/.test(x)), 'Laden: ein Kanon, der kein Feld ist: Meldung');
  // Abgleich: die Liste ist die Wahrheit (Name, Volk, Ausgang), die Reihenfolge ist die der Faeden
  S = lese([kE('f2', 'Falsch Name', Object.assign({}, FIN, { volk: 'ger' }))], [stubFaden('f2', 'Echt Name', 'rom', 'abgeschlossen', 'gelungen')]);
  ok(S.kanon.length === 1 && S.kanon[0].name === 'Echt Name' && S.kanon[0].volk === 'rom', 'Abgleich: Name und Volk kommen aus dem Faden der Liste');
  S = lese([kE('f3', 'Lauf Mann', Object.assign({ status: 'aktiv' }, FIN))], [stubFaden('f3', 'Lauf Mann', 'rom', 'wartet')]);
  ok(S.kanon.length === 1 && S.kanon[0].ausgang === undefined && S.kanon[0].ort_ende === undefined && S.kanon[0].status === undefined, 'Abgleich: ein Ausgang im Stand, obwohl der Faden laeuft, faellt weg');
  S = lese([kE('f9', 'N Neun', FIN), kE('f3', 'N Drei', FIN), kE('f12', 'N Zwoelf', FIN)]);
  ok(S.kanon.map((e) => e.f).join() === 'f3,f9,f12', 'Abgleich: die Eintraege stehen in der Reihenfolge der Faeden');
  S = lese(undefined, [stubFaden('f5', 'Alt Mann', 'kon', 'abgeschlossen', 'gescheitert'), stubFaden('f6', 'Alt Mann', 'kon', 'wartet')]);
  ok(S.kanon.length === 2 && !S.kanon[0].wieder && S.kanon[1].wieder === true && S.kanon[0].ausgang === 'gescheitert' && S.kanon[0].ort_ende === '0305', 'Altstand ohne Block: ein Eintrag je Faden, der zweite Faden desselben NSC ist ein Wiedersehen');
});

section('E1 Namen: der Pruefer (faden_oeffnen und abenteuerOeffnen) nimmt keinen Namen aus dem Kanon', () => {
  const t = neu(61), g = t.g, F1 = zust(g);
  const N = D.NAMEN.rom, name = N.vornamen[0] + ' ' + N.nachnamen[0];
  Kanon.liste(F1).push(kE('f1', name, { titel: 'Alt', ausgang: 'gelungen', ort_ende: '0305' }));   // ein verdraengter Faden, nur im Kanon
  ok(!liste(g).some((f) => f.nsc.name === name) && !Kanon.nameFrei(F1, name), 'der Name steht nur im Kanon');
  const a = Faden.abenteuerAnbieten(g, einzel('notruf', 1, { volk_erlaubt: ['rom'] }), { hex: '0305' });
  const r1 = Pruefer.pruefeAbenteuerOeffnen(F1, a.angebot.nr, { name });
  ok(/^NAME: der Name .* vergeben/.test(r1 || ''), 'abenteuerOeffnen: der Name ist vergeben (' + r1 + ')');
  ok(Pruefer.pruefeAbenteuerOeffnen(F1, a.angebot.nr, { name: N.vornamen[1] + ' ' + N.nachnamen[1] }) === null, 'ein freier Name aus der Liste ist erlaubt');
  D.registriere(X.vorlageTest());
  const an = X.angebot(g);
  const vk = D.vorlage('test_geschichte').volk_erlaubt;
  const nameV = D.NAMEN[vk[0]].vornamen[0] + ' ' + D.NAMEN[vk[0]].nachnamen[0];
  Kanon.liste(F1).push(kE('f2', nameV, { volk: vk[0], titel: 'Alt', ausgang: 'gelungen', ort_ende: '0305' }));
  const r2 = Faden.befehlPruefen(g, { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: an.nr, volk: vk[0], name: nameV } });
  ok(/^NAME: der Name .* vergeben/.test(r2 || ''), 'faden_oeffnen: der Name ist vergeben (' + r2 + ')');
});

section('E3 Stufen der Wiederholungsregeln (Einheit): Ort wird zuerst, dann die Folge, dann der NSC gelockert', () => {
  const t = neu(70), g = t.g;
  spiele(g, einzel('konvoi', 1), 'gelungen', '0305');
  spiele(g, einzel('geleit', 2), 'gelungen', '0306');   // ein Abenteuer dazwischen: der Ort zaehlt auch zwei zurueck (ort_typ_zuletzt)
  const vk = BPlan.expandiere(einzel('konvoi', 9)).vorlage;
  const kurz = (r) => (r || 'keine').split(':')[0];
  ok(WD.ort_typ_zuletzt >= 2 && WD.folge_zuletzt >= 2, 'Voraussetzung: die Daten zaehlen mindestens zwei Abenteuer zurueck');
  ok(kurz(Wdh.pruefeGelockert(g, vk, '0305', 0)) === 'WIEDERHOLUNG_ORT', 'Stufe 0: derselbe Ort und erster Beat wie das vorletzte Abenteuer: WIEDERHOLUNG_ORT (zuerst der Ort)');
  ok(kurz(Wdh.pruefeGelockert(g, vk, '0305', 1)) === 'WIEDERHOLUNG_FOLGE', 'Stufe 1: der Ort ist gelockert, die Folge sperrt noch');
  ok(kurz(Wdh.pruefeGelockert(g, vk, '0305', 2)) === 'keine', 'Stufe 2: auch die Folge ist gelockert');
  ok(kurz(Wdh.pruefe(g, vk, '0305')) === 'WIEDERHOLUNG_ORT', 'pruefe ist Stufe 0');
  ok(kurz(Wdh.pruefeGelockert(g, vk, '0202', 0)) === 'WIEDERHOLUNG_FOLGE', 'an einem anderen Ort sperrt nur die Folge');
  // NSC: die Hauptfigur des letzten Abenteuers ist erst auf der letzten Stufe frei
  const t2 = neu(71), g2 = t2.g;
  spiele(g2, einzel('notruf', 1), 'gelungen', '0305');
  const vw = BPlan.expandiere(plan([b('wiedersehen'), b('abschluss')], { titel: 'Wiedersehen', anlass: 'Jemand meldet sich wieder ohne Namen' })).vorlage;
  for (const s of [0, 1, 2]) ok(kurz(Wdh.pruefeGelockert(g2, vw, '0305', s)) === 'WIEDERHOLUNG_NSC' && Wdh.kandidatenGelockert(g2, vw, s).length === 0, `Stufe ${s}: der einzige Kandidat war die Hauptfigur des letzten Abenteuers: gesperrt`);
  ok(Wdh.pruefeGelockert(g2, vw, '0305', Wdh.STUFEN_MAX) === null && Wdh.kandidatenGelockert(g2, vw, Wdh.STUFEN_MAX).length === 1 && Wdh.STUFEN_MAX === 3, 'Stufe 3 (STUFEN_MAX): frei, der Kandidat kommt zurueck');
  // das Logbuch nennt den Grund einer veralteten Annahme
  const t3 = neu(72), g3 = t3.g;
  spiele(g3, einzel('notruf', 1), 'gelungen'); const z = spiele(g3, einzel('spontanhilfe', 2), 'gelungen'); z.f.nsc.status = 'tot';
  const aw = Faden.abenteuerNeuAnbieten(g3, plan([b('wiedersehen'), b('abschluss')], { titel: 'Wiedersehen', anlass: 'Jemand meldet sich wieder ohne Namen' }), { hex: '0305' });
  const letzter = Kanon.liste(zust(g3)).filter((e) => e.titel).pop(), erster = Kanon.liste(zust(g3)).find((e) => e.titel);
  letzter.name = erster.name; letzter.volk = erster.volk; letzter.wieder = true;
  g3.handleMessage(t3.cs[0], { t: 'cmd', c: 'abenteuer.annehmen', id: 'a' + aw.angebot.nr });
  const lv = logbuch(g3).filter((e) => e.ausgang === 'abenteuer_veraltet').pop();
  ok(aw.ok && lv && /WIEDERHOLUNG_NSC/.test(lv.begruendung), 'Logbuch: das Angebot wurde mit dem Grund WIEDERHOLUNG_NSC vom Brett genommen');
});

section('E3 Anschluss-Rueckfall und Wiedersehen: nie eine gesperrte Hauptfigur, ein strenges Angebot gilt nicht als gelockert', () => {
  const typen = new Set(); let n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const t = neu(7000 + seed, { env: { ABENTEUER_ANSCHLUSS: '1' } }), g = t.g; zust(g).angNr = seed;
    spiele(g, einzel('notruf', 1), 'gelungen', '0305');   // der einzige Kandidat ist die Hauptfigur des letzten Abenteuers
    zust(g).abenteuerAngebote.length = 0;
    const a = Brett.anschluss(g); if (!a) continue; n++;
    typen.add(a.vorlage.beats[0].typ);
  }
  ok(n === 60 && !typen.has('wiedersehen') && typen.size >= 3, `60 Entscheidungen mit einem einzigen, aber gesperrten Kandidaten: nie ein Wiedersehen (${[...typen].join(', ')})`);
  let gefunden = null;
  for (let seed = 1; seed <= 80 && !gefunden; seed++) {
    const t = neu(7200 + seed, { env: { ABENTEUER_ANSCHLUSS: '1' } }), g = t.g; zust(g).angNr = seed;
    spiele(g, einzel('notruf', 1), 'gelungen', '0305'); spiele(g, einzel('spontanhilfe', 2), 'gelungen', '0305');
    zust(g).abenteuerAngebote.length = 0;
    const a = Brett.anschluss(g);
    if (a && a.vorlage.beats[0].typ === 'wiedersehen') gefunden = { t, g, a };
  }
  ok(!!gefunden, 'der Rueckfall bietet bei einem frischen Kandidaten auch ein Wiedersehen an');
  if (gefunden) {
    const { t, g, a } = gefunden;
    ok(a.locker === false, 'ein Angebot der Stufe 0 gilt nicht als gelockert');
    const letzter = Kanon.liste(zust(g)).filter((e) => e.titel).pop(), erster = Kanon.liste(zust(g)).find((e) => e.titel && e.f !== letzter.f);
    letzter.name = erster.name; letzter.volk = erster.volk; letzter.wieder = true;
    for (const f of liste(g)) if (f.nsc.name !== erster.name) f.nsc.status = 'tot';
    g.handleMessage(t.cs[0], { t: 'cmd', c: 'abenteuer.annehmen', id: 'a' + a.nr });
    const ant = t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'abenteuerAntwort').pop();
    ok(ant && ant.ok === false && ant.code === 'veraltet', 'wurde der NSC inzwischen zur Hauptfigur des letzten Abenteuers, ist das strenge Angebot veraltet (nicht gelockert)');
  }
});

section('E2 Daten: jeder Satz nach einem Scheitern nennt das Scheitern, jeder Satz nach einem Erfolg nicht; die Katalogpruefung nennt ein Ereignis ohne Ausgang', () => {
  const E = TX.werte.wiedersehen_erinnert.wert, T = TX.texte;
  const negativ = /nicht|entkommen|allein gelassen|standgehalten|keiner|abgewiesen/;
  const schlecht = Object.keys(E).filter((k) => (k.endsWith('_gescheitert') ? !negativ.test(T[E[k]]) : /nicht (befreien|eingeholt|durchgebracht|gesprengt|abgeliefert)|entkommen|standgehalten|allein gelassen/.test(T[E[k]])));
  ok(schlecht.length === 0, 'die Saetze passen zum Ausgang (negativ nach gescheitert, nicht negativ nach gelungen)' + (schlecht.length ? ': ' + schlecht.join(', ') : ''));
  ok(Object.keys(E).every((k) => (T[E[k]].match(/\{(\w+)\}/g) || []).every((p) => p === '{ort}')) && Object.keys(E).every((k) => !NAMEN.some((x) => T[E[k]].includes(x))), 'nur der Platzhalter {ort}, keine Spielernamen');
  const live = D.B1.werte.wiedersehen_erinnert;
  live.zzz_ohne = 'wiedersehen_dank';
  const f = B1.katalogFehler(); delete live.zzz_ohne;
  ok(f.some((x) => /WIEDERSEHEN_PAAR: Ereignis zzz_ohne endet nicht/.test(x)), 'ein Ereignis ohne _gelungen oder _gescheitert: WIEDERSEHEN_PAAR');
});

// ======================================================================
// E2 Wiederkehr
const ERINNERT = (ereignis, hex) => TX.texte[TX.werte.wiedersehen_erinnert.wert[ereignis]].split('{ort}').join(hexname(hex));
section('E2 Wiederkehr: der NSC nennt die konkrete Tat, gelungen und gescheitert verschieden (Daten, nie frei erfunden)', () => {
  const E = TX.werte.wiedersehen_erinnert.wert;
  // (a) der echte Weg: ein Notruf-Abenteuer, einmal gelungen, einmal gescheitert, danach das Wiedersehen; die Funkzeile steht im Funk
  const ergebnis = {};
  for (const wahl of ['gelungen', 'gescheitert']) {
    const t = neu(wahl === 'gelungen' ? 21 : 22), g = t.g;
    const funk = []; const orig = g.emit.bind(g); g.emit = (...a) => { if (a[0] === 'radio' && a[1]) funk.push(a[1]); return orig(...a); };
    const alt = spiele(g, einzel('notruf', 1, { volk_erlaubt: ['rom', 'kon'] }), wahl);
    // der NSC des gescheiterten Notrufs kann tot oder gefangen sein: dann taugt er nicht (Pruefer): fuer den Test lebt er
    if (alt.f.nsc.status !== 'aktiv' && alt.f.nsc.status !== 'verbuendet') alt.f.nsc.status = 'aktiv';
    spiele(g, einzel('spontanhilfe', 2, { volk_erlaubt: ['rom', 'kon'] }), 'gelungen'); alt.f.nsc.status = alt.f.nsc.status;   // Puffer: der NSC ist nicht die Hauptfigur des letzten Abenteuers
    const p = einzel('wiedersehen', 3, { volk_erlaubt: ['rom', 'kon'] });
    const w = beginne(g, p, '0305', { nsc_von: alt.f.nsc.id });
    ok(w.f && w.f.nsc.name === alt.f.nsc.name, `${wahl}: der NSC kehrt wieder (${alt.f.nsc.name})`);
    // der Beat laeuft ueber den echten Weg (faden_weiter), der Baustein spricht
    for (let i = 0; i < 10 && w.f.phase !== 'laeuft'; i++) { const bt = { typ: 'faden_weiter', faden: w.f.id, beat: D.vorlage(w.f.vorlage).beats[w.f.beat].id }; if (Faden.befehlPruefen(g, bt) === null) Faden.befehlAnwenden(g, bt); else grenzen(g, 1); }
    const hex = w.f.parameter.ort;
    const soll = ERINNERT('notruf_' + wahl, hex);
    const zeile = funk.find((x) => x.from === w.f.nsc.name && x.text === soll);
    ok(!!zeile, `${wahl}: der NSC nennt die Tat aus den Daten: "${soll}"`);
    ok(zeile && !NAMEN.some((x) => zeile.text.includes(x)) && !/\{|\}/.test(zeile.text) && zeile.text.length <= WERTE.funk_text_max.wert, `${wahl}: ohne Spielernamen, ohne offenen Platzhalter, hoechstens ${WERTE.funk_text_max.wert} Zeichen`);
    ergebnis[wahl] = zeile && zeile.text.split(hexname(hex)).join('{ort}');
    // nach Speichern und Laden dasselbe Gedaechtnis, dieselbe Aussage
    const nsc = w.f.nsc;
    const t2 = laden(speichern(g), 23), n2 = liste(t2.g).find((f) => f.id === w.f.id).nsc;
    ok(JSON.stringify(n2.gedaechtnis) === JSON.stringify(nsc.gedaechtnis), `${wahl}: das Gedaechtnis des NSC steht nach dem Laden unveraendert da`);
  }
  ok(ergebnis.gelungen && ergebnis.gescheitert && ergebnis.gelungen !== ergebnis.gescheitert && /erf.llt|geholt/.test(ergebnis.gelungen) && /nicht|keiner/.test(ergebnis.gescheitert), 'gelungen und gescheitert liefern verschiedene, jeweils zur Tat passende Saetze: "' + ergebnis.gelungen + '" gegen "' + ergebnis.gescheitert + '"');
  // (b) jede Tat der Daten: gelungen und gescheitert verschieden, korrekt zugeordnet (der NSC bekommt genau ein Ereignis)
  const t = neu(24), g = t.g;
  const funk = []; const orig = g.emit.bind(g); g.emit = (...a) => { if (a[0] === 'radio' && a[1]) funk.push(a[1]); return orig(...a); };
  const tat = Object.keys(E);
  let geprueft = 0, zuordnung = true;
  for (const ereignis of tat) {
    const alt = beginne(g, einzel('notruf', 100 + geprueft, { volk_erlaubt: ['rom', 'kon'] }));
    beende(g, alt.f, 'gelungen');
    alt.f.nsc.gedaechtnis = [{ tick: 1, ereignis, text_key: 'x' }];   // nur diese eine Tat: die Zuordnung in den Daten, nicht der Weg dorthin (der steht oben)
    alt.f.nsc.status = 'aktiv';
    spiele(g, einzel('spontanhilfe', 200 + geprueft, { volk_erlaubt: ['rom', 'kon'] }), 'gelungen');   // Puffer
    const w = beginne(g, einzel('wiedersehen', 300 + geprueft, { volk_erlaubt: ['rom', 'kon'] }), '0305', { nsc_von: alt.f.nsc.id });
    if (!w.f) { zuordnung = false; ok(false, 'Wiedersehen nach ' + ereignis + ' nicht moeglich: ' + (w.a.grund || (w.r && w.r.grund))); break; }
    for (let i = 0; i < 10 && w.f.phase !== 'laeuft'; i++) { const bt = { typ: 'faden_weiter', faden: w.f.id, beat: D.vorlage(w.f.vorlage).beats[w.f.beat].id }; if (Faden.befehlPruefen(g, bt) === null) Faden.befehlAnwenden(g, bt); else grenzen(g, 1); }
    const soll = ERINNERT(ereignis, w.f.parameter.ort);
    if (!funk.some((x) => x.from === w.f.nsc.name && x.text === soll)) zuordnung = false;
    beende(g, w.f, 'gelungen');
    geprueft++;
    if (liste(g).length >= WERTE.faeden_gesamt_max.wert - 3) for (let i = 0; i < 4; i++) { const f = liste(g).findIndex((x) => x.phase === 'abgeschlossen'); if (f >= 0) liste(g).splice(f, 1); }
  }
  ok(geprueft === tat.length && zuordnung, `alle ${tat.length} Taten der Daten (je Tat gelungen und gescheitert) werden mit dem eigenen Satz erinnert`);
  const paare = tat.filter((x) => x.endsWith('_gelungen')).map((x) => [x, x.replace(/_gelungen$/, '_gescheitert')]);
  ok(paare.length >= 7 && paare.every(([a, c]) => c in E && TX.texte[E[a]] !== TX.texte[E[c]]), paare.length + ' Paare, in jedem verschiedene Saetze');
  // (c) die letzte Tat gewinnt: erst gelungen, dann gescheitert, und umgekehrt
  const gesagt = (reihe) => {
    const tt = neu(25), gg = tt.g, fk = []; const o2 = gg.emit.bind(gg); gg.emit = (...a) => { if (a[0] === 'radio' && a[1]) fk.push(a[1]); return o2(...a); };
    const alt = beginne(gg, einzel('notruf', 1, { volk_erlaubt: ['rom', 'kon'] })); beende(gg, alt.f, 'gelungen');
    alt.f.nsc.gedaechtnis = reihe.map((ereignis, i) => ({ tick: i + 1, ereignis, text_key: 'x' })); alt.f.nsc.status = 'aktiv';
    spiele(gg, einzel('spontanhilfe', 2, { volk_erlaubt: ['rom', 'kon'] }), 'gelungen');
    const w = beginne(gg, einzel('wiedersehen', 3, { volk_erlaubt: ['rom', 'kon'] }), '0305', { nsc_von: alt.f.nsc.id });
    for (let i = 0; i < 10 && w.f.phase !== 'laeuft'; i++) { const bt = { typ: 'faden_weiter', faden: w.f.id, beat: D.vorlage(w.f.vorlage).beats[w.f.beat].id }; if (Faden.befehlPruefen(gg, bt) === null) Faden.befehlAnwenden(gg, bt); else grenzen(gg, 1); }
    const letzte = reihe.filter((x) => x in E).pop();
    return (fk.find((x) => x.from === w.f.nsc.name) || {}).text === ERINNERT(letzte, w.f.parameter.ort);
  };
  ok(gesagt(['konvoi_gelungen', 'konvoi_gescheitert']) && gesagt(['konvoi_gescheitert', 'konvoi_gelungen']) && gesagt(['bitte_gelungen', 'geleit_gescheitert', 'notruf_gelungen']) && gesagt(['notruf_gescheitert', 'abschluss_gelungen']), 'die letzte Tat gewinnt, in beiden Reihenfolgen, und eine Nicht-Tat (abschluss) zaehlt nicht');
});

// ======================================================================
// E3 Wiederholung
const TYPEN6 = ['spontanhilfe', 'notruf', 'geruecht', 'geleit', 'spur', 'konvoi', 'raumschlacht'];
section('E3 Wiederholung: Folge, Ort, NSC, offene Angebote (die Regeln stehen in den Daten)', () => {
  const t = neu(31), g = t.g, F1 = zust(g);
  const neuA = (typ, i, hex) => Faden.abenteuerNeuAnbieten(g, einzel(typ, i), { hex: hex || '0305' });
  const code = (r) => (r.grund || '').split(':')[0];
  ok(neuA('spontanhilfe', 1).ok, 'ohne Verlauf: ein Angebot ist moeglich');
  F1.abenteuerAngebote.length = 0;
  // Folge: dieselbe Typenfolge wie eines der letzten folge_zuletzt Abenteuer
  spiele(g, einzel('spontanhilfe', 1), 'gelungen', '0305');
  ok(code(neuA('spontanhilfe', 2, '0306')) === 'WIEDERHOLUNG_FOLGE', 'dieselbe Typenfolge wie das letzte Abenteuer: WIEDERHOLUNG_FOLGE (auch an einem anderen Ort)');
  ok(neuA('notruf', 3, '0305').ok, 'eine andere Typenfolge am selben Ort: moeglich'); F1.abenteuerAngebote.length = 0;
  const tail = TYPEN6.filter((x) => x !== 'spontanhilfe');
  for (let i = 0; i < WD.folge_zuletzt - 1; i++) spiele(g, einzel(tail[i], 10 + i), 'gelungen', '0307');
  ok(code(neuA('spontanhilfe', 4, '0306')) === 'WIEDERHOLUNG_FOLGE', `nach ${WD.folge_zuletzt - 1} anderen Abenteuern ist es noch eines der letzten ${WD.folge_zuletzt}: gesperrt`);
  spiele(g, einzel(tail[WD.folge_zuletzt - 1], 20), 'gelungen', '0307');
  ok(neuA('spontanhilfe', 5, '0306').ok, `danach (${WD.folge_zuletzt} andere Abenteuer dazwischen) ist dieselbe Folge wieder erlaubt`);
  // offenes Angebot gleicher Folge
  ok(code(Faden.abenteuerNeuAnbieten(g, einzel('spontanhilfe', 6), { hex: '0202' })) === 'WIEDERHOLUNG_FOLGE', 'ein offenes Angebot mit derselben Folge zaehlt: nie dreimal dasselbe auf dem Brett'); F1.abenteuerAngebote.length = 0;
  // zusammengesetzte Folgen: nur die ganze Folge zaehlt, nicht der erste Typ
  const t2 = neu(32), g2 = t2.g;
  spiele(g2, plan([b('spontanhilfe'), b('notruf'), b('abschluss')], { titel: 'Zwei Beats', anlass: 'Zwei Beats ohne Namen im Plan' }), 'gelungen', '0305');
  ok(Faden.abenteuerNeuAnbieten(g2, einzel('spontanhilfe', 1), { hex: '0306' }).ok, 'eine andere Folge mit demselben ersten Typ ist keine Wiederholung der Folge'); zust(g2).abenteuerAngebote.length = 0;
  ok(code(Faden.abenteuerNeuAnbieten(g2, plan([b('spontanhilfe'), b('notruf'), b('abschluss')], { titel: 'Zwei Beats anders', anlass: 'Gleiche Typen, anderer Titel' }), { hex: '0306' })) === 'WIEDERHOLUNG_FOLGE', 'dieselbe Typenfolge unter anderem Titel ist dieselbe Folge');
  // Ort: derselbe Ort UND derselbe erste Beat-Typ wie eines der letzten ort_typ_zuletzt Abenteuer
  const t3 = neu(33), g3 = t3.g;
  spiele(g3, plan([b('geruecht'), b('notruf'), b('abschluss')], { titel: 'Eins', anlass: 'Erstes Abenteuer ohne Namen im Plan' }), 'gelungen', '0305');
  const ortR = Faden.abenteuerNeuAnbieten(g3, plan([b('geruecht'), b('spur'), b('abschluss')], { titel: 'Zwei', anlass: 'Zweites Abenteuer ohne Namen im Plan' }), { hex: '0305' });
  ok(code(ortR) === 'WIEDERHOLUNG_ORT', 'derselbe Ort und derselbe erste Beat (andere Folge): WIEDERHOLUNG_ORT');
  ok(Faden.abenteuerNeuAnbieten(g3, plan([b('geruecht'), b('spur'), b('abschluss')], { titel: 'Drei', anlass: 'Drittes Abenteuer ohne Namen im Plan' }), { hex: '0306' }).ok, 'derselbe erste Beat an einem anderen Ort: erlaubt'); zust(g3).abenteuerAngebote.length = 0;
  ok(Faden.abenteuerNeuAnbieten(g3, plan([b('spur'), b('geruecht'), b('abschluss')], { titel: 'Vier', anlass: 'Viertes Abenteuer ohne Namen im Plan' }), { hex: '0305' }).ok, 'derselbe Ort mit einem anderen ersten Beat: erlaubt'); zust(g3).abenteuerAngebote.length = 0;
  for (let i = 0; i < WD.ort_typ_zuletzt; i++) spiele(g3, einzel(['konvoi', 'raumschlacht', 'geleit'][i % 3], 50 + i), 'gelungen', '0307');
  ok(Faden.abenteuerNeuAnbieten(g3, plan([b('geruecht'), b('spur'), b('abschluss')], { titel: 'Fuenf', anlass: 'Fuenftes Abenteuer ohne Namen im Plan' }), { hex: '0305' }).ok, `nach ${WD.ort_typ_zuletzt} Abenteuern dazwischen ist derselbe Ort mit demselben ersten Beat wieder erlaubt`);
  // das niedrige Anbieten kennt die Regel nicht (es prueft nur die Gueltigkeit): Brett und Spielleiter rufen das benannte Anbieten
  zust(g3).abenteuerAngebote.length = 0;
  const roh = Faden.abenteuerAnbieten(g, einzel('spontanhilfe', 99, { titel: 'Gueltig aber gleich' }), { hex: '0306' });
  ok(roh.ok, 'abenteuerAnbieten prueft nur die Gueltigkeit des Plans (dieselbe Folge wie das letzte Abenteuer wird nicht abgelehnt)');
});

section('E3 Wiederholung: der NSC (Wiedersehen) und der Anschluss-Rueckfall (stufenweise gelockert, verklemmt nie)', () => {
  const t = neu(41), g = t.g, F1 = zust(g);
  const w = plan([b('wiedersehen'), b('abschluss')], { titel: 'Wiedersehen', anlass: 'Jemand meldet sich wieder ohne Namen' });
  const e1 = spiele(g, einzel('notruf', 1), 'gelungen');
  const r1 = Faden.abenteuerNeuAnbieten(g, w, { hex: '0305' });
  ok(!r1.ok && /^WIEDERHOLUNG_NSC/.test(r1.grund), 'der einzige Kandidat war die Hauptfigur des LETZTEN Abenteuers: WIEDERHOLUNG_NSC (' + r1.grund.slice(0, 22) + ')');
  ok(Faden.abenteuerAnbieten(g, w, { hex: '0305' }).ok, 'das niedrige Anbieten (nur Gueltigkeit) laesst ihn zu: die Regel gehoert dem Brett'); F1.abenteuerAngebote.length = 0;
  ok(Wdh.zahlenFrisch(g)[e1.f.nsc.fraktion] === 0 && Faden.wiedersehenKandidaten(g, require('../server/sim/faden-bauplan.js').expandiere(w).vorlage).length === 1, 'Kontext der Komposition: 0 frische Kandidaten, obwohl der Pruefer einen kennt');
  const e2 = spiele(g, einzel('spontanhilfe', 2), 'gelungen');
  const r2 = Faden.abenteuerNeuAnbieten(g, w, { hex: '0305' });
  ok(r2.ok && Wdh.zahlenFrisch(g)[e1.f.nsc.fraktion] >= 1, 'nach einem anderen Abenteuer ist der NSC wieder frisch: Angebot moeglich');
  // Annahme ueber das Brett: der frische Kandidat, nie die Hauptfigur des letzten Abenteuers (auch wenn sie juenger ist)
  const nr = r2.angebot.nr;
  zust(g).abenteuerAngebote.find((a) => a.nr === nr).alter = 0;
  const msg = t.cs[0]; g.handleMessage(msg, { t: 'cmd', c: 'abenteuer.annehmen', id: 'a' + nr });
  const wf = liste(g).find((f) => f.phase !== 'abgeschlossen');
  ok(wf && wf.nsc.name === e1.f.nsc.name && wf.nsc.name !== e2.f.nsc.name, 'Annahme: ' + (wf && wf.nsc.name) + ' (nicht die Hauptfigur des letzten Abenteuers ' + e2.f.nsc.name + ')');
  beende(g, wf, 'gelungen');
  // ein Angebot, das frisch war, aber waehrend es auslag stale wurde (der NSC war inzwischen die Hauptfigur des letzten Abenteuers): die Annahme sagt veraltet, kein Faden, nichts blockiert
  { const tv = neu(44), gv = tv.g; spiele(gv, einzel('notruf', 1), 'gelungen'); const zweiter = spiele(gv, einzel('spontanhilfe', 2), 'gelungen'); zweiter.f.nsc.status = 'tot';   // ein einziger Kandidat (der erste NSC)
    const aw = Faden.abenteuerNeuAnbieten(gv, w, { hex: '0305' });
    const letzter = Kanon.liste(zust(gv)).filter((e) => e.titel).pop(), erster = Kanon.liste(zust(gv)).find((e) => e.titel);
    letzter.name = erster.name; letzter.volk = erster.volk; letzter.wieder = true;   // der NSC steht jetzt als Hauptfigur des letzten Abenteuers im Verlauf
    tv.cs[0].inbox.length = 0; gv.handleMessage(tv.cs[0], { t: 'cmd', c: 'abenteuer.annehmen', id: 'a' + aw.angebot.nr });
    const ant = tv.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'abenteuerAntwort').pop();
    ok(aw.ok && ant && ant.ok === false && ant.code === 'veraltet' && zust(gv).abenteuerAngebote.length === 0 && liste(gv).filter((f) => f.phase !== 'abgeschlossen').length === 0, 'Annahme eines Wiedersehens ohne frischen Kandidaten: veraltet, das Angebot ist vom Brett, kein Faden'); }
  // Anschluss: das Brett bleibt nie leer
  const t2 = neu(42, { env: { ABENTEUER_ANSCHLUSS: '1' } }), g2 = t2.g, F2 = zust(g2);
  const typenFrei = (g_) => { zust(g_).abenteuerAngebote.length = 0; const a = Brett.anschluss(g_); return a ? a.vorlage.beats[0].typ : null; };
  // ohne Ziel und ohne Kandidat passen vier Plaene (geruecht, spur, konvoi, geleit): die letzten drei Abenteuer sperren drei, ein abgelehnter den vierten
  const ids = {}; for (const bp of ANS.plaene) ids[bp.beats[0].typ] = require('../server/sim/faden-bauplan.js').pruefe(bp).vorlage.id;
  const schnell = (typ, i) => spiele(g2, einzel(typ, 1000 + i), 'gelungen', '0305');
  schnell('geruecht', 1); schnell('spur', 2); schnell('konvoi', 3);
  for (const f of liste(g2)) if (f.nsc) f.nsc.status = 'tot';   // keine Kandidaten
  const v0 = Kanon.liste(F2).filter((e) => e.titel).slice(-3).map((e) => e.folge[0]);
  ok(v0.join() === 'geruecht,spur,konvoi', 'Verlauf der letzten drei Abenteuer: ' + v0.join());
  ok(typenFrei(g2) === 'geleit', 'Anschluss, Stufe 0: nur der Plan, dessen Folge nicht unter den letzten drei steht (geleit)');
  const b2 = (F2.brett = F2.brett || { antworten: [], abgelehnt: [], pruefung: -1e9 }); b2.abgelehnt = [ids.geleit];
  const gewaehlt = typenFrei(g2);
  ok(gewaehlt !== null, 'alle vier Plaene gesperrt (drei durch die Folge, einer durch die Ablehnung): der Rueckfall lockert und bietet trotzdem etwas an (' + gewaehlt + ')');
  // Folge-Sperre groesser als die Zahl der passenden Plaene: erst die Stufe 2 gibt frei (die Zahl steht in den Daten)
  const alt = D.BRETT.werte.wiederholung.folge_zuletzt; D.BRETT.werte.wiederholung.folge_zuletzt = 9;   // die geladenen Daten des Produktivcodes, kurz verstellt
  try {
    const t3 = neu(43, { env: { ABENTEUER_ANSCHLUSS: '1' } }), g3 = t3.g;
    for (const [i, typ] of ['geruecht', 'spur', 'konvoi', 'geleit'].entries()) spiele(g3, einzel(typ, 2000 + i), 'gelungen', '0306');
    for (const f of liste(g3)) f.nsc.status = 'tot';
    zust(g3).abenteuerAngebote.length = 0;
    const a = Brett.anschluss(g3);
    ok(a && ['geruecht', 'spur', 'konvoi', 'geleit'].includes(a.vorlage.beats[0].typ), `Sperre ueber alle passenden Plaene (folge_zuletzt 9): der Rueckfall lockert (Ort, dann Folge) und bietet ${a && a.vorlage.beats[0].typ} an`);
    // auf der letzten Stufe ohne jeden Kandidaten: das Wiedersehen kommt gar nicht erst in die Auswahl (kein abgelehnter Plan im Logbuch, in 20 Ziehungen)
    const fp0 = logbuch(g3).filter((e) => e.art === 'faden_pruefung').length; let gezogen = 0;
    for (let k = 1; k <= 20; k++) { zust(g3).angNr = k; zust(g3).abenteuerAngebote.length = 0; if (Brett.anschluss(g3)) gezogen++; }
    ok(gezogen === 20 && logbuch(g3).filter((e) => e.art === 'faden_pruefung').length === fp0, 'auf der Stufe der Lockerung bietet der Rueckfall nie ein Wiedersehen ohne Kandidat an (20 Ziehungen, kein Eintrag faden_pruefung)');
  } finally { D.BRETT.werte.wiederholung.folge_zuletzt = alt; }
  // nur das Wiedersehen steht zur Wahl, es gibt keinen Kandidaten: auch die letzte Stufe bietet nichts an und lehnt keinen Plan im Logbuch ab (das Brett bleibt leer, weil nichts passt, nicht weil es klemmt)
  const orig = D.ANSCHLUSS.plaene; D.ANSCHLUSS.plaene = [ANS.plaene.find((p) => p.beats[0].typ === 'wiedersehen')];
  try {
    const t4 = neu(44, { env: { ABENTEUER_ANSCHLUSS: '1' } }), g4 = t4.g;
    zust(g4).abenteuerAngebote.length = 0;
    const fp1 = logbuch(g4).filter((e) => e.art === 'faden_pruefung').length;
    ok(Brett.anschluss(g4) === null && logbuch(g4).filter((e) => e.art === 'faden_pruefung').length === fp1, 'nur ein Wiedersehen zur Wahl und kein NSC: kein Angebot, kein abgelehnter Plan im Logbuch (auch nicht auf der letzten Stufe)');
  } finally { D.ANSCHLUSS.plaene = orig; }
});

section('E3 Eigenschaftstest: 300 Anschluss-Entscheidungen gegen eine eigene Rechnung', () => {
  const ANS_TYP = ANS.plaene.map((p) => p.beats[0].typ);   // geruecht spur konvoi geleit sabotage wiedersehen
  const frei = ['geruecht', 'spur', 'konvoi', 'geleit'];    // ohne Ziel und Kandidat
  let gewaehlt = 0, leer = 0, verstoss = 0, locker = 0, gleichtyp = 0, abgelehnt = 0;
  const verteilung = {};
  for (let seed = 1; seed <= 300; seed++) {
    const t = neu(5000 + seed, { env: { ABENTEUER_ANSCHLUSS: '1' } }), g = t.g, F1 = zust(g), r = rng(seed * 31);
    const k = Math.floor(r() * 5);   // Zahl der gespielten Abenteuer davor
    const hist = [];
    for (let i = 0; i < k; i++) { const typ = frei[Math.floor(r() * frei.length)]; const hex = ['0305', '0306'][Math.floor(r() * 2)]; hist.push({ typ, hex }); spiele(g, einzel(typ, 3000 + i), 'gelungen', hex); }
    for (const f of liste(g)) f.nsc.status = 'tot';
    F1.abenteuerAngebote.length = 0;
    if (seed % 2 === 0) { const ids = frei.map((x) => require('../server/sim/faden-bauplan.js').pruefe(ANS.plaene.find((p) => p.beats[0].typ === x)).vorlage.id); const m = Math.floor(r() * 4) + 0; F1.brett = { antworten: [], abgelehnt: ids.slice(0, m).filter(() => r() < 0.9).slice(0, 3), pruefung: -1e9 }; abgelehnt += F1.brett.abgelehnt.length ? 1 : 0; }   // jeder zweite Fall mit abgelehnten Plaenen: die Sperren muessen gelockert werden
    const a = Brett.anschluss(g);
    if (!a) { leer++; continue; }
    gewaehlt++;
    const typ = a.vorlage.beats[0].typ;
    verteilung[typ] = (verteilung[typ] || 0) + 1;
    if (!frei.includes(typ)) verstoss++;
    // eigene Rechnung: die letzten folge_zuletzt Typen sind gesperrt, solange noch ein anderer passt
    const gesperrt = hist.slice(-WD.folge_zuletzt).map((h) => h.typ);
    const erlaubt = frei.filter((x) => !gesperrt.includes(x));
    if (!(F1.brett && F1.brett.abgelehnt.length) && erlaubt.length && !erlaubt.includes(typ)) verstoss++;
    if (!erlaubt.length) locker++;
    if (!(F1.brett && F1.brett.abgelehnt.length) && hist.length && hist[hist.length - 1].typ === typ) gleichtyp++;
  }
  ok(leer === 0 && gewaehlt === 300, `das Brett bleibt nie leer: 300 von 300 Entscheidungen bieten einen Plan an (${leer} leer)`);
  ok(verstoss === 0, `nie ein Plan, der nicht passt, nie eine gesperrte Folge, solange ein anderer passt (${verstoss} Verstoesse; ${locker} Faelle ohne freien Plan, ${abgelehnt} Faelle mit abgelehnten Plaenen: gelockert)`);
  ok(gleichtyp === 0, 'nie derselbe Typ wie das letzte Abenteuer, solange ein anderer passt (' + gleichtyp + ')');
  ok(Object.keys(verteilung).length >= 4, 'alle vier moeglichen Plaene kommen vor: ' + JSON.stringify(verteilung));
  ok(ANS_TYP.length === 6, 'sechs Standardplaene in den Daten');
});

// ======================================================================
// E3 ueber die Komposition (A2): der Spielleiter bekommt die Regeln im Prompt und das Brett lehnt eine Wiederholung ab
const frei = () => new Promise((r) => setImmediate(r));
async function lauf(g, k) { g.lageGrenze('andocken'); for (let i = 0; i < (k || 3); i++) { g.step(); await frei(); } }
const abLog = (g, ausgang) => logbuch(g).filter((e) => e.art === 'abenteuer_bauplan' && (ausgang === undefined || e.ausgang === ausgang));
function mitSkript(seed, antworten, werte) {
  const t = neu(seed), g = t.g;
  const llm = LLM.create({ mode: 'script', script: { abenteuer: antworten } });
  const asks = []; const ask0 = llm.ask.bind(llm);
  llm.ask = (k, i, o) => { if (k === 'abenteuer') asks.push(i.prompt); return ask0(k, i, o); };
  g.lageSpielleiter = LS.create(g, { llm, werte: { deckel_je_sitzung: 0 }, abenteuerWerte: Object.assign({ deckel_je_sitzung: 99, cooldown_grenzen: 1 }, werte || {}) });
  g.lageSchalter = true;
  return { t, g, asks, ab: g.lageSpielleiter.abenteuer };
}
const kontextVon = (p) => JSON.parse(/<kontext>\n([\s\S]*?)\n<\/kontext>/.exec(p)[1]);
section('E3 Komposition: der Prompt nennt die Sperren, das Brett lehnt eine Wiederholung ab', async () => {
  // ein Spielleiter, der immer denselben Plan liefert: das erste Angebot kommt durch, das zweite (dieselbe Folge, noch offen) wird abgelehnt
  const m = mitSkript(51, Array.from({ length: 6 }, (_, i) => ({ json: einzel('geruecht', i + 1) })));
  await lauf(m.g); await lauf(m.g);
  ok(zust(m.g).abenteuerAngebote.length === 1 && abLog(m.g, 'gueltig').length === 1, 'erste Antwort: ein Angebot');
  const ab = abLog(m.g, 'abgelehnt');
  ok(ab.length === 1 && ab[0].grund === 'WIEDERHOLUNG_FOLGE', 'zweite Antwort mit derselben Typenfolge: abgelehnt mit WIEDERHOLUNG_FOLGE (Logbuch: ' + (ab[0] && ab[0].grund) + ')');
  // der Prompt: letzte Typenfolgen aus dem Kanon (begonnene Abenteuer), erste Beat-Typen, die an diesem Ort gesperrt sind, Regeln im Katalog
  const t = neu(52), g = t.g;
  spiele(g, einzel('konvoi', 1), 'gelungen', '0305'); spiele(g, einzel('geleit', 2), 'gelungen', '0306');
  const p = AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [{ nr: 1, typen: ['spur'] }] }).prompt, k = kontextVon(p);
  ok(JSON.stringify(k.letzte_abenteuer) === '[["konvoi"],["geleit"],["spur"]]', 'Kontext letzte_abenteuer: die begonnenen Abenteuer (Kanon) und das zuletzt angebotene: ' + JSON.stringify(k.letzte_abenteuer));
  ok(JSON.stringify(k.sperre_beginn) === '["konvoi"]', 'Kontext sperre_beginn: der erste Beat des letzten Abenteuers an genau diesem Ort (konvoi bei 0305): ' + JSON.stringify(k.sperre_beginn));
  ok(JSON.stringify(kontextVon(AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0399', letzte: [] }).prompt).sperre_beginn) === '[]', 'an einem anderen Ort ist nichts gesperrt');
  ok(/Wiederholung \(Daten abenteuer-brett\.json werte\.wiederholung\)/.test(AP.katalogText()) && new RegExp('letzten ' + WD.folge_zuletzt + ' Abenteuer').test(AP.katalogText()), 'der Katalog nennt die Regeln mit den Zahlen aus den Daten');
  ok(!NAMEN.some((x) => p.includes(x)) && !p.includes('konvoi 1') && !liste(g).some((f) => p.includes(f.nsc.name)), 'weder Spielernamen noch Titel noch NSC-Namen im Prompt');
  // der Kontext zaehlt nur frische NSC fuer ein Wiedersehen (sonst lehnte das Brett den Plan ab)
  const z = kontextVon(AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [] }).prompt).faeden.wiedersehen_nsc;
  ok(Object.values(z).reduce((x, y) => x + y, 0) === 1, 'Kontext wiedersehen_nsc: zwei Abenteuer, die Hauptfigur des letzten zaehlt nicht (' + JSON.stringify(z) + ')');
  // ein Mock-Komponist mit dem echten Prompt: ueber viele Aufrufe nie ein Plan, den das Brett wegen Folge, Ort oder NSC ablehnt
  const am = require('../server/sim/abenteuer-mock.js'); let zuletzt = null, wiederholt = 0, angeboten = 0;
  const tm = neu(53), gm = tm.g;
  for (let i = 1; i <= 120; i++) {
    zust(gm).abenteuerAngebote.length = 0;
    const e = am.erzeuge({ prompt: AP.baue(gm, { nr: i, grenze: 'andocken', hex: '0305', letzte: [] }).prompt });
    if (e.korruption) continue;
    const pl = JSON.parse(e.text.slice(e.text.indexOf('{'), e.text.lastIndexOf('}') + 1));
    const r = Faden.abenteuerNeuAnbieten(gm, pl, { hex: '0305' });
    if (!r.ok) { if (/^WIEDERHOLUNG/.test(r.grund)) wiederholt++; continue; }
    angeboten++;
    const x = Faden.abenteuerOeffnen(gm, r.angebot.nr, Faden.wiedersehenKandidaten(gm, r.angebot.vorlage).length && require('../server/sim/faden-pruefer.js').nscAlt(r.angebot.vorlage) ? { nsc_von: Wdh.kandidatenFrisch(gm, r.angebot.vorlage)[0] } : {});
    if (x.ok) beende(gm, x.faden, 'gelungen');
  }
  ok(angeboten >= 30 && Kanon.pruefe(zust(gm)).length === 0, 'Mock ueber den echten Prompt: ' + angeboten + ' Angebote durch das Brett, ' + wiederholt + ' wegen Wiederholung abgelehnt, der Kanon bleibt stimmig');
});

// ======================================================================
// E4 Messwerkzeug (tools/messe-abenteuer-plaene.js): laeuft ueber die echte Kette, trennt Gemessenes und Geschaetztes, meldet "nicht live gemessen", Exit 2 bei falschem Aufruf
section('E4 Messwerkzeug: Gueltigkeit, Wiederholung, Typverteilung, Kosten; gemessen und geschaetzt getrennt; nicht live gemessen', () => {
  const { spawnSync } = require('child_process');
  const lauf = (args) => spawnSync(process.execPath, ['tools/messe-abenteuer-plaene.js', ...args], { encoding: 'utf8', env: Object.assign({}, process.env, { LLM_LIVE: '', OLLAMA_URL: 'http://127.0.0.1:9' }), timeout: 120000 });
  const r = lauf(['--n', '150', '--seed', '5']), t = r.stdout || '';
  ok(r.status === 0 && /150 Plaene \(Seed 5\)/.test(t), 'Exit 0, 150 Plaene');
  ok(/1\. Gueltigkeit/.test(t) && /2\. Wiederholung/.test(t) && /3\. Typverteilung/.test(t) && /4\. Kosten/.test(t) && /5\. Live-Lauf/.test(t), 'alle Abschnitte stehen in der Ausgabe');
  const m = /gueltig angeboten (\d+) .*?abgelehnt (\d+)/.exec(t);
  ok(m && Number(m[1]) + Number(m[2]) === 150, 'gueltig plus abgelehnt ergibt die Zahl der Plaene (' + (m && m[1] + ' + ' + m[2]) + ')');
  ok(/angenommen 0 \(soll 0/.test(t) && /gespielt \(.*\): 0 \(soll 0/.test(t) && /Kanon-Widersprueche im Lauf: 0/.test(t) && !/PFLICHTGROESSE/.test(t), 'keine Korruption angenommen, kein ungueltiger Plan gespielt, keine Widersprueche');
  ok(/GEMESSEN \(Mock-Kette\)/.test(t) && /GESCHAETZT \(Annahme/.test(t) && /Dauer: nicht live gemessen/.test(t) && /nicht live gemessen \(weder --live noch LLM_LIVE=1\)/.test(t), 'Gemessenes und Geschaetztes sind getrennt gekennzeichnet, die Dauer und der Live-Lauf sind "nicht live gemessen"');
  const a2 = lauf(['--n', '150', '--seed', '5', '--zeichen-je-token', '6']).stdout;
  const tok = (x) => Number(/= ([\d.]+) Token je Aufruf/.exec(x)[1].replace(/\./g, ''));
  ok(tok(a2) < tok(t) * 0.6, 'die Annahme zeichen-je-token steuert die Schaetzung (' + tok(t) + ' gegen ' + tok(a2) + ' Token)');
  ok(lauf(['--n', '0']).status === 2 && lauf(['--preis-je-mtok', 'x']).status === 2, 'falscher Aufruf: Exit 2');
});

// ======================================================================
section('E1 Kuerzen ueber kanon_max: die Wiedersehen-Kette bleibt stimmig, neueste bleiben, Speichern/Laden gleich', () => {
  const eintrag = (f, name, o) => Object.assign({ f, name, volk: 'rom', ort: '0305', folge: ['notruf'] }, o || {});
  const vw = (i) => require('../server/sim/faden-bauplan.js').expandiere(einzel('wiedersehen', i)).vorlage;
  const t = neu(61), g = t.g, buch = [];   // Hauptbuch: { f, name, wieder }
  let wiedersehen = 0, ohneFehler = true, probleme = [];
  const N = 120;
  for (let i = 1; i <= N; i++) {
    let r;
    const kand = i > 30 && i % 4 === 0 ? Wdh.kandidatenFrisch(g, vw(i)) : [];
    if (kand.length) { r = spiele(g, einzel('wiedersehen', i), 'gelungen', '0305', { nsc_von: kand[kand.length - 1] }); wiedersehen++; }   // der AELTESTE frische Kandidat: sein Ursprung steht am Rand des Kanons
    else r = spiele(g, einzel(i % 2 ? 'notruf' : 'spontanhilfe', i), i % 3 ? 'gelungen' : 'gescheitert', i % 2 ? '0305' : '0306');
    if (!r.f) { probleme.push('Nr ' + i + ': nicht geoeffnet'); continue; }
    buch.push({ f: r.f.id, name: r.f.nsc.name, wieder: !!(kand.length) });
    const p = Kanon.pruefe(zust(g));
    if (p.length) { ohneFehler = false; if (probleme.length < 3) probleme.push('Nr ' + i + ': ' + p[0]); }
    if (Kanon.liste(zust(g)).length > KANON_MAX) { ohneFehler = false; probleme.push('Nr ' + i + ': mehr als kanon_max'); }
  }
  ok(wiedersehen >= 15 && buch.length === N, wiedersehen + ' Wiedersehen in ' + N + ' Abenteuern, alle geoeffnet ' + (probleme[0] || ''));
  ok(ohneFehler, 'nach jedem Ende: pruefe leer, nie mehr als kanon_max Eintraege (' + (probleme.join('; ') || 'ok') + ')');
  const L = Kanon.liste(zust(g));
  ok(L.length === KANON_MAX && L.every((e, i) => i === 0 || nrVon(L[i - 1].f) < nrVon(e.f)), 'der Kanon ist voll (' + L.length + ') und geordnet');
  const ids = new Set(L.map((e) => e.f));
  ok(buch.slice(-KANON_MAX).every((x) => ids.has(x.f)), 'es bleiben die NEUESTEN ' + KANON_MAX + ' Abenteuer');
  const abgeloest = L.filter((e) => !e.wieder && buch.find((x) => x.f === e.f).wieder);
  ok(abgeloest.length >= 1, 'mindestens ein Wiedersehen ist durch das Kuerzen zum ersten Eintrag seines Namens geworden (' + abgeloest.length + '): der Fall des Reviewers kam vor');
  ok(L.every((e) => Kanon.nameFrei(zust(g), e.name) === false), 'der Name bleibt vergeben');
  const sim = speichern(g), vorher = kanonJson(g);
  const t2 = laden(sim, 62), g2 = t2.g;
  ok(kanonJson(g2) === vorher && zust(g2).ladeFehler.length === 0 && Kanon.pruefe(zust(g2)).length === 0, 'nach Speichern und Laden: derselbe Kanon (' + Kanon.liste(zust(g2)).length + '), kein Ladefehler, pruefe leer');
  ok(JSON.stringify(Faden.toSave(g2.weltsim)) === JSON.stringify(sim.faeden), 'Speichern nach dem Laden ergibt denselben Block');
  // der Fall des Reviewers genau: 41 Eintraege, f1 = A, f2 = A (wieder); nach kuerzen 40, stimmig, ohne Ladefehler
  const F = { liste: [], kanon: [], ladeFehler: [] };
  F.kanon.push(eintrag('f1', 'A B', { ausgang: 'gelungen', ort_ende: '0305' }), eintrag('f2', 'A B', { wieder: true, ausgang: 'gelungen', ort_ende: '0305' }));
  for (let i = 3; i <= KANON_MAX + 1; i++) F.kanon.push(eintrag('f' + i, 'N' + i, { ausgang: 'gelungen', ort_ende: '0305' }));
  Kanon.kuerzen(F);
  ok(F.kanon.length === KANON_MAX && F.kanon[0].f === 'f2' && !F.kanon[0].wieder && Kanon.pruefe(F).length === 0 && !Kanon.nameFrei(F, 'A B'), 'Reviewer-Fall: f1 faellt, f2 verliert wieder, pruefe leer, Name vergeben');
  const F2 = { liste: [], ladeFehler: [] }; Kanon.lesen(JSON.parse(JSON.stringify(F.kanon)), F2);
  ok(F2.kanon.length === KANON_MAX && F2.ladeFehler.length === 0 && Kanon.pruefe(F2).length === 0, 'Reviewer-Fall: Laden verliert nichts und meldet nichts');
  // faellt ein Eintrag, dessen Name noch einen frueheren Eintrag hat (der Faden laeuft, steht in der Liste), bleibt das wieder der Spaeteren
  const F4 = { liste: [{ id: 'f1', nsc: { name: 'A B', fraktion: 'rom' }, phase: 'laeuft' }], kanon: [], ladeFehler: [] };
  F4.kanon.push(eintrag('f1', 'A B'), eintrag('f2', 'A B', { wieder: true, ausgang: 'gelungen', ort_ende: '0305' }), eintrag('f3', 'A B', { wieder: true, ausgang: 'gelungen', ort_ende: '0305' }));
  for (let i = 4; i <= KANON_MAX + 1; i++) F4.kanon.push(eintrag('f' + i, 'N' + i, { ausgang: 'gelungen', ort_ende: '0305' }));
  Kanon.kuerzen(F4);
  ok(F4.kanon.length === KANON_MAX && !F4.kanon.some((e) => e.f === 'f2') && F4.kanon.find((e) => e.f === 'f3').wieder === true && Kanon.pruefe(F4).filter((x) => !/KANON_LISTE/.test(x)).length === 0, 'faellt ein Wiedersehen, dessen NSC einen frueheren Eintrag behaelt, behaelt der naechste sein wieder');
  // lesen behaelt die neuesten
  const viele = Array.from({ length: KANON_MAX + 5 }, (_, i) => eintrag('f' + (i + 1), 'M' + (i + 1), { ausgang: 'gelungen', ort_ende: '0305' }));
  const F3 = { liste: [], ladeFehler: [] }; Kanon.lesen(viele, F3);
  ok(F3.kanon.length === KANON_MAX && F3.kanon[0].f === 'f6' && F3.kanon[KANON_MAX - 1].f === 'f' + (KANON_MAX + 5), 'lesen behaelt die neuesten kanon_max Eintraege (wie kuerzen), nicht die aeltesten');
});

section('E3 Ablehnung beim Annehmen (veraltet) zieht ein neues Angebot nach sich', () => {
  let gefunden = null;
  for (let seed = 1; seed <= 80 && !gefunden; seed++) {
    const t = neu(7400 + seed, { env: { ABENTEUER_ANSCHLUSS: '1' } }), g = t.g; zust(g).angNr = seed;
    spiele(g, einzel('notruf', 1), 'gelungen', '0305'); spiele(g, einzel('spontanhilfe', 2), 'gelungen', '0305');
    zust(g).abenteuerAngebote.length = 0;
    const a = Brett.anschluss(g);
    if (a && a.vorlage.beats[0].typ === 'wiedersehen') gefunden = { t, g, a };
  }
  ok(!!gefunden, 'ein Wiedersehen-Angebot des Rueckfalls (strenge Stufe) liegt aus');
  if (!gefunden) return;
  const { t, g, a } = gefunden;
  const letzter = Kanon.liste(zust(g)).filter((e) => e.titel).pop(), erster = Kanon.liste(zust(g)).find((e) => e.titel && e.f !== letzter.f);
  letzter.name = erster.name; letzter.volk = erster.volk; letzter.wieder = true;
  for (const f of liste(g)) if (f.nsc.name !== erster.name) f.nsc.status = 'tot';
  g.handleMessage(t.cs[0], { t: 'cmd', c: 'abenteuer.annehmen', id: 'a' + a.nr });
  const ant = t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'abenteuerAntwort').pop();
  ok(ant && ant.ok === false && ant.code === 'veraltet' && zust(g).abenteuerAngebote.length === 0, 'die Annahme sagt veraltet, das Brett ist leer');
  for (const f of liste(g)) f.nsc.status = 'aktiv';
  g.time = 1e6; Brett.beiUpdate(g);
  const neuA = zust(g).abenteuerAngebote;
  ok(neuA.length === 1 && neuA[0].nr !== a.nr, 'der naechste Takt bietet etwas Neues an (Angebot ' + (neuA[0] && neuA[0].nr) + ' statt ' + a.nr + ')');
});

// ======================================================================
(async () => {
  for (const [name, fn] of abschnitte) {
    if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
    console.log('\n' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  ABSTURZ ' + (e && e.stack)); }
  }
  console.log(`\n${n - fails} von ${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
  process.exit(fails ? 1 : 0);
})();
