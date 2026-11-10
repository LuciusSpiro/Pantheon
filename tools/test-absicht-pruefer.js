'use strict';
// SPL-02 A: Pruefer der Absichten (server/sim/absicht-pruefer.js, Katalog content/faeden/absichten.json) und das Angebot mit Bezug und Lockerung am Brett (server/sim/abenteuer-brett.js neuAnbieten, annehmen).
// Die Erwartungen stehen hier selbst (von Hand gerechnet, eine eigene Welt mit zwei bis drei NSC), nie aus dem Produktivcode abgeleitet. Die Absichten kommen aus der Fixture tools/fixtures/absichten/test-katalog.json
// (der Katalog des Spiels ist beim Start leer: die Eintraege kommen mit Paket C).
// Geprueft wird: Katalog (Strukturregeln) · Form · unbekannte Absicht · Parameter (Gegenvorschlag = naechster gueltiger Wert) · Bezuege (fehlt, existiert nicht, uneindeutig, Kandidat) · Bogen · Ton · Texte ·
// Klartext fuer das Modell · Verhandlung (eine Runde, danach endgueltig) · Brett: Bezug gewaehlt statt juengster, veraltet, Wiederholungsregel mit locker, Weltstand.
// Aufruf: node tools/test-absicht-pruefer.js [begriff ...]        (npm run test:absicht-pruefer)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Weltstand = require('../server/weltstand.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Wdh = require('../server/sim/abenteuer-wiederholung.js');
const AP = require('../server/sim/absicht-pruefer.js');

const { D, Faden, F } = X;
const C = AP.CODES;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];

// Katalog: die Werte des Spiels, die Eintraege der Fixture
const ECHT = lies('content/faeden/absichten.json');
const FIX = lies('tools/fixtures/absichten/test-katalog.json');
const KAT = Object.assign({}, klon(ECHT), { absichten: klon(FIX.absichten) });
const mitWert = (k, w) => { const x = klon(KAT); x.werte[k].wert = w; return x; };

// ---------------------------------------------------------------- Welt
function neu(seed) {
  const t = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  t.c = t.cs[0];
  return t;
}
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats }, o || {});
const einzel = (typ, i) => plan([{ typ }, { typ: 'abschluss' }], { titel: typ + ' ' + i, anlass: 'Probeanlass ' + typ + ' Nummer ' + i + ' ohne Namen' });
const wiedersehen = () => plan([{ typ: 'wiedersehen' }, { typ: 'abschluss' }], { titel: 'Wiedersehen', anlass: 'Jemand meldet sich wieder ohne Namen' });
const zust = (g) => Faden.zustandVon(g);
const liste = (g) => g.weltsim.faeden.liste;
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
function beende(g, f, ausgang) {
  const v = D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) {
    f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 };
    Faden.beatAusgang(g, f.id, ausgang);
  }
}
function spiele(g, p) {
  const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  beende(g, r.faden, 'gelungen');
  return r.faden;
}
// der NSC bekommt einen festen Namen (Faden und Kanon), damit "Quintus" gegen den Kommandanten Quintus Dorn mehrdeutig ist; alle roemisch (volk_erlaubt der Vorlage)
function nenne(g, f, name) {
  f.nsc.name = name; f.nsc.fraktion = 'rom';
  const e = zust(g).kanon.find((x) => x.f === f.id);
  e.name = name; e.volk = 'rom';
}
// drei abgeschlossene Abenteuer: A (Quintus Varro), B (Titus Calder), C (Gaius Fabrin, die Hauptfigur des letzten)
function welt(seed, k) {
  const t = neu(seed), g = t.g;
  const typen = ['notruf', 'spontanhilfe', 'fracht'], namen = ['Quintus Varro', 'Titus Calder', 'Gaius Fabrin'], fs_ = [];
  for (let i = 0; i < k; i++) { const f = spiele(g, einzel(typen[i], i + 1)); nenne(g, f, namen[i]); fs_.push(f); }
  t.f = fs_;
  return t;
}
const kurz = (e) => (e.fehler.length ? e.fehler.map((x) => x.code).join(',') : 'keine');
const codes = (e) => e.fehler.map((x) => x.code);
const fe = (e, code, feld) => e.fehler.find((x) => x.code === code && (!feld || x.feld === feld));

const TEXT = { titel: 'Eine alte Rechnung', einsatz: 'Der Mann kehrt mit Geschwader zurueck und will die Schuld eintreiben.', preis: 'Wer ihn laufen laesst, hat ihn bald wieder im Nacken.' };
const gut = (o) => Object.assign({ format: 'absicht/1', absicht: 'probe_ort', titel: TEXT.titel, parameter: { menge: 2 }, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'hinterhalt', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const gutNsc = (name, o) => gut(Object.assign({ absicht: 'probe_nsc', parameter: {}, bezug: { nsc: name }, bogen: { einsatz: TEXT.einsatz, wendung: 'verfolgung', preis: TEXT.preis }, ton: 'bitter' }, o || {}));

// ======================================================================
section('Katalog: Daten des Spiels, Strukturregeln', () => {
  ok(AP.katalogFehler().length === 0, 'der Katalog des Spiels ist in sich stimmig (' + AP.katalogFehler().join(' | ') + ')');
  ok(ECHT.format === 'absichten-katalog/1' && ECHT._hinweis && Object.keys(ECHT.absichten).length === 0, 'der Katalog des Spiels ist beim Start leer (die Eintraege kommen mit Paket C), mit _hinweis');
  ok(Object.values(ECHT.werte).every((w) => 'wert' in w && typeof w.einheit === 'string' && typeof w._hinweis === 'string'), 'werte-Konvention wie die anderen Dateien: je Eintrag wert, einheit, _hinweis');
  ok(ECHT.werte.runden_max.wert === 1, 'Verhandlungsrunden: Standard 1 aus den Daten');
  ok(AP.katalogFehler(KAT).length === 0, 'die Fixture ist ein gueltiger Katalog (' + AP.katalogFehler(KAT).join(' | ') + ')');
  const schlecht = (mut, re, was) => { const k = klon(KAT); mut(k.absichten); const f = AP.katalogFehler(k); ok(f.length > 0 && f.some((x) => re.test(x)), 'Strukturregel: ' + was + ' (' + (f[0] || 'kein Fehler').slice(0, 70) + ')'); };
  schlecht((a) => { a.Probe = a.probe_ort; }, /Name passt nicht/, 'Name nur Kleinbuchstaben');
  schlecht((a) => { delete a.probe_ort.zweck; }, /zweck fehlt/, 'zweck ist Pflicht');
  schlecht((a) => { a.probe_ort.extra = 1; }, /unbekanntes Feld extra/, 'kein unbekanntes Feld');
  schlecht((a) => { a.probe_ort.parameter.reichweite.standard = 9; }, /standard liegt ausserhalb/, 'standard im Bereich');
  schlecht((a) => { a.probe_ort.parameter.stufe.erlaubt = []; }, /erlaubt/, 'erlaubt nicht leer');
  schlecht((a) => { a.probe_nsc.bezug = [{ name: 'schiff', pflicht: true }]; }, /bezug: Eintrag/, 'Bezugsart aus den Daten');
  schlecht((a) => { a.probe_ort.bezug = [{ name: 'ort', pflicht: false, kandidat: true }]; }, /bezug: Eintrag/, 'kandidat nur bei nsc');
  schlecht((a) => { a.probe_ort.toene = ['gruselig']; }, /toene/, 'Toene aus der Liste der Daten');
  schlecht((a) => { a.probe_kanon.bogen_pflicht = ['ende']; }, /bogen_pflicht/, 'bogen_pflicht aus den Bogenfeldern');
  schlecht((a) => { a.probe_ort.fortsetzung = 'ja'; }, /fortsetzung/, 'fortsetzung ist wahr oder falsch');
  const kw = klon(KAT); delete kw.werte.toene;
  ok(AP.katalogFehler(kw).some((x) => /werte.toene/.test(x)), 'fehlt ein Wert: Meldung');
  ok(AP.istFortsetzung(gutNsc('X'), KAT) === true && AP.istFortsetzung(gut(), KAT) === false && AP.istFortsetzung({ absicht: 'gibt_es_nicht' }, KAT) === false && AP.istFortsetzung(null, KAT) === false, 'istFortsetzung liest nur das Katalogfeld');
});

section('FORM und ABSICHT_UNBEKANNT', () => {
  const g = welt(11, 2).g;
  const f = (a) => AP.pruefeAbsicht(g, a, KAT);
  for (const [was, a] of [['kein Objekt', 'text'], ['Liste', []], ['null', null], ['falsches format', gut({ format: 'absicht/2' })], ['unbekanntes Feld', gut({ extra: 1 })], ['Name mit Grossbuchstaben', gut({ absicht: 'Probe_Ort' })], ['titel keine Zeichenkette', gut({ titel: 5 })],
    ['parameter eine Liste', gut({ parameter: [] })], ['Werttyp im Bezug', gut({ bezug: { nsc: 5 } })], ['unbekanntes Bogenfeld', gut({ bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis, extra: 'x' } })], ['ton fehlt', (() => { const x = gut(); delete x.ton; return x; })()]]) {
    const e = f(a);
    ok(!e.ok && e.absicht === null && codes(e).every((c) => c === C.FORM) && e.fehler.length >= 1, 'FORM: ' + was);
  }
  const p = JSON.parse('{"format":"absicht/1","absicht":"probe_ort","titel":"Eine alte Rechnung","parameter":{"__proto__":{"x":1}},"bogen":{},"ton":"nuechtern"}');
  ok(codes(f(p)).includes(C.FORM) && f(p).absicht === null, 'FORM: Prototyp-Schluessel');
  ok(codes(f(gut({ titel: 'x'.repeat(2000) }))).includes(C.FORM), 'FORM: groesser als absicht_max_zeichen (aus den Daten)');
  const u = f(gut({ absicht: 'probe_nsd' }));
  ok(!u.ok && codes(u).join() === C.ABSICHT_UNBEKANNT && u.fehler[0].gegenvorschlag.patch[0].feld === 'absicht' && u.fehler[0].gegenvorschlag.patch[0].wert === 'probe_nsc', 'ABSICHT_UNBEKANNT mit Gegenvorschlag: der naechste Name (probe_nsd -> probe_nsc)');
  const u2 = f(gut({ absicht: 'voellig_anders_gemeint' }));
  ok(codes(u2).join() === C.ABSICHT_UNBEKANNT && !u2.fehler[0].gegenvorschlag && /bekannt: probe_ort/.test(u2.fehler[0].grund), 'ABSICHT_UNBEKANNT ohne aehnlichen Namen: kein Vorschlag, aber die bekannten Namen');
  ok(AP.pruefeAbsicht(g, gut({ absicht: 'probe_ort' }), { werte: KAT.werte, absichten: {} }).fehler[0].code === C.ABSICHT_UNBEKANNT, 'ein leerer Katalog kennt keine Absicht');
});

section('PARAMETER: unbekannt, fehlt, ausserhalb (Gegenvorschlag = naechster gueltiger Wert)', () => {
  const g = welt(11, 2).g;
  const f = (p) => AP.pruefeAbsicht(g, gut({ parameter: p }), KAT);
  const gv = (e, feld) => { const x = fe(e, C.PARAMETER, feld); return x && x.gegenvorschlag && x.gegenvorschlag.patch[0]; };
  ok(f({ menge: 2 }).ok && f({ menge: 2 }).absicht.parameter.reichweite === 2 && f({ menge: 2 }).absicht.parameter.stufe === 'leicht', 'gueltig: die Standardwerte werden ergaenzt (reichweite 2, stufe leicht)');
  ok(f({ menge: 9 }).fehler.length === 1 && gv(f({ menge: 9 }), 'parameter.menge').wert === 5, 'Zahl zu gross: Vorschlag das Maximum (9 -> 5)');
  ok(gv(f({ menge: -4 }), 'parameter.menge').wert === 1, 'Zahl zu klein: Vorschlag das Minimum (-4 -> 1)');
  ok(gv(f({ menge: 1.6 }), 'parameter.menge').wert === 2, 'keine ganze Zahl: gerundet (1,6 -> 2)');
  ok(gv(f({ menge: 'viel' }), 'parameter.menge').wert === 1, 'kein Zahlwert: Vorschlag der kleinste Wert');
  ok(fe(f({}), C.PARAMETER, 'parameter.menge') && gv(f({}), 'parameter.menge').wert === 1, 'Pflichtparameter ohne Standard fehlt: PARAMETER, Vorschlag der kleinste Wert');
  ok(gv(f({ menge: 2, stufe: 'schwerr' }), 'parameter.stufe').wert === 'schwer', 'Liste: der naechste erlaubte Wert (schwerr -> schwer)');
  ok(gv(f({ menge: 2, stufe: 'ganz anders' }), 'parameter.stufe').wert === 'leicht', 'Liste ohne aehnlichen Wert: der Standard');
  const u = f({ menge: 2, tempo: 3 });
  ok(codes(u).join() === C.PARAMETER && u.fehler[0].gegenvorschlag.patch[0].entfernen === true && u.fehler[0].feld === 'parameter.tempo', 'unbekannter Parameter: Vorschlag weglassen (Patch entfernen)');
  const e = AP.pruefeAbsicht(g, gut({ parameter: { menge: 9 } }), KAT);
  const patch = AP.gegenvorschlagPatch(e);
  const w = AP.wendePatchAn(e.absicht, patch);
  ok(!e.ok && patch && patch.length === 1 && w.ok && AP.pruefeAbsicht(g, w.absicht, KAT).ok, 'Abnahme 4: ein unmoeglicher Parameter endet mit Nein und Gegenvorschlag; der Vorschlag als Patch angewendet besteht den Pruefer');
});

section('Bezuege: fehlt, existiert nicht, uneindeutig, Kandidat, Ort', () => {
  const t = welt(11, 3), g = t.g;
  const f = (a) => AP.pruefeAbsicht(g, a, KAT);
  ok(f(gutNsc('Quintus Varro', { ton: 'nuechtern' })).ok, 'Vollname eines NSC im Kanon (und Kandidat): gueltig');
  const fehlt = f(gutNsc('x', { bezug: {} }));
  ok(codes(fehlt).join() === C.BEZUG_FEHLT && fehlt.fehler[0].feld === 'bezug.nsc' && fehlt.fehler[0].gegenvorschlag.patch[0].wert === 'Titus Calder', 'BEZUG_FEHLT: Pflichtbezug fehlt, Vorschlag der juengste FRISCHE Kandidat (Titus Calder; Gaius Fabrin war die Hauptfigur des letzten Abenteuers)');
  // Abnahme 5: ein Bezug, der in der Welt nicht existiert, wird abgelehnt
  const nein = f(gutNsc('Gaius Nirgendwo'));
  ok(!nein.ok && codes(nein).includes(C.BEZUG_UNBEKANNT) && fe(nein, C.BEZUG_UNBEKANNT).feld === 'bezug.nsc', 'Abnahme 5: ein NSC, den es in der Welt nicht gibt, wird abgelehnt (BEZUG_UNBEKANNT)');
  ok(fe(nein, C.BEZUG_UNBEKANNT).gegenvorschlag.patch[0].feld === 'bezug.nsc', 'BEZUG_UNBEKANNT mit Gegenvorschlag (ein NSC, den es gibt)');
  ok(codes(f(gutNsc('n2'))).includes(C.BEZUG_UNBEKANNT) && /Kennungen/.test(fe(f(gutNsc('n2')), C.BEZUG_UNBEKANNT).grund), 'die wechselnde Kennung n<nr> gilt nie');
  ok(codes(f(gutNsc('Quintus Dorn'))).join() === C.BEZUG_UNBEKANNT, 'Kommandant Quintus Dorn (Daten der Flotten) ist kein NSC der Crew-Geschichte');
  const q = f(gutNsc('Quintus'));
  ok(codes(q).join() === C.BEZUG_UNEINDEUTIG && /mehrdeutig/.test(q.fehler[0].grund) && q.fehler[0].gegenvorschlag.patch[0].wert === 'Quintus Varro', 'BEZUG_UNEINDEUTIG: "Quintus" allein (NSC Quintus Varro und Kommandant Quintus Dorn), Vorschlag der Vollname');
  const v = f(gutNsc('Fabrin'));
  ok(codes(v).join() === C.BEZUG_UNEINDEUTIG && /kein Vollname/.test(v.fehler[0].grund), 'BEZUG_UNEINDEUTIG: auch ein Name mit nur einem Treffer gilt allein nicht (Fabrin: nie Vor- oder Nachname allein)');
  ok(codes(f(gutNsc('Calder'))).join() === C.BEZUG_UNEINDEUTIG, 'der Nachname allein gilt ebenso nicht');
  ok(codes(f(gutNsc('Zorro'))).join() === C.BEZUG_UNBEKANNT, 'ein Einzelwort ohne Treffer: BEZUG_UNBEKANNT');
  // Kandidat der Fadenmaschine: tot -> kein Kandidat; ohne `kandidat` im Katalog genuegt der Kanon
  t.f[0].nsc.status = 'tot';
  const tot = f(gutNsc('Quintus Varro'));
  ok(codes(tot).join() === C.BEZUG_UNBEKANNT && /nicht zur Verfuegung/.test(tot.fehler[0].grund) && tot.fehler[0].gegenvorschlag.patch[0].wert !== 'Quintus Varro', 'BEZUG_UNBEKANNT: im Kanon, aber tot, kein Kandidat der Fadenmaschine; der Vorschlag ist ein anderer');
  const ka = gut({ absicht: 'probe_kanon', parameter: {}, bezug: { nsc: 'Quintus Varro' }, bogen: { einsatz: TEXT.einsatz, preis: TEXT.preis }, ton: 'nuechtern' });
  ok(f(ka).ok, 'probe_kanon (ohne kandidat): der tote NSC steht im Kanon, das genuegt');
  // SPL-02 C0: der Pruef-Typ des Kandidaten ist im Katalog waehlbar (kandidat: "<Beat-Typ>"): ein feindlicher oder geflohener NSC ist fuer den Typ rache ein Kandidat, fuer den ersten nsc_alt-Typ (kandidat: true) nicht
  const ra = (name) => gut({ absicht: 'probe_rache', parameter: {}, bezug: { nsc: name }, bogen: { einsatz: TEXT.einsatz, preis: TEXT.preis }, ton: 'nuechtern' });
  t.f[0].nsc.status = 'feindlich';
  const feind = f(gutNsc('Quintus Varro'));
  ok(codes(feind).join() === C.BEZUG_UNBEKANNT && /nicht zur Verfuegung/.test(feind.fehler[0].grund), 'kandidat: true: ein feindlicher NSC ist kein Kandidat (BEZUG_UNBEKANNT)');
  ok(f(ra('Quintus Varro')).ok, 'kandidat: "rache": derselbe feindliche NSC ist ein gueltiger Bezug');
  t.f[0].nsc.status = 'geflohen';
  ok(f(ra('Quintus Varro')).ok && !f(gutNsc('Quintus Varro')).ok, 'kandidat: "rache": auch ein geflohener NSC gilt, mit kandidat: true nicht');
  t.f[0].nsc.status = 'tot';
  const rt = f(ra('Quintus Varro'));
  ok(codes(rt).join() === C.BEZUG_UNBEKANNT && /nicht zur Verfuegung/.test(rt.fehler[0].grund), 'kandidat: "rache": ein toter NSC ist auch hier kein Kandidat');
  t.f[0].nsc.status = 'verbuendet';
  ok(f(gutNsc('Quintus Varro')).ok && codes(f(ra('Quintus Varro'))).join() === C.BEZUG_UNBEKANNT, 'umgekehrt: ein verbuendeter NSC taugt fuer kandidat: true, nicht fuer rache (Zustaende nach dem Typ)');
  const fl = f(gut({ absicht: 'probe_rache', parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, preis: TEXT.preis }, ton: 'nuechtern' }));
  ok(codes(fl).join() === C.BEZUG_FEHLT, 'BEZUG_FEHLT bei kandidat "rache": der Vorschlag kommt aus den Kandidaten dieses Typs (' + (fl.fehler[0].gegenvorschlag ? fl.fehler[0].gegenvorschlag.text : 'keiner') + ')');
  t.f[0].nsc.status = 'feindlich';
  ok(fe(f(gut({ absicht: 'probe_rache', parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, preis: TEXT.preis }, ton: 'nuechtern' })), C.BEZUG_FEHLT).gegenvorschlag.patch[0].wert === 'Quintus Varro', 'der Vorschlag bei BEZUG_FEHLT ist der feindliche NSC (nach dem Typ rache)');
  const kt = (mut) => { const k = klon(KAT); mut(k.absichten); return AP.katalogFehler(k); };
  ok(kt((a) => { a.probe_rache.bezug[0].kandidat = 'nirgendwo'; }).some((x) => /bezug: Eintrag/.test(x)), 'Strukturregel: kandidat nennt einen Beat-Typ, den es nicht gibt: Fehler');
  ok(kt((a) => { a.probe_rache.bezug[0].kandidat = 'abschluss'; }).some((x) => /bezug: Eintrag/.test(x)), 'Strukturregel: kandidat nennt einen Beat-Typ ohne braucht.nsc_alt: Fehler');
  ok(kt(() => {}).length === 0, 'Strukturregel: kandidat: "rache" und kandidat: true sind gueltig');
  t.f[0].nsc.status = 'aktiv';
  // Ort
  ok(f(gut({ bezug: { ort: '0305' } })).ok, 'Ort: ein spielbarer Sektor');
  const o = f(gut({ bezug: { ort: '9999' } }));
  ok(codes(o).join() === C.BEZUG_UNBEKANNT && fe(o, C.BEZUG_UNBEKANNT).feld === 'bezug.ort', 'Ort: ein Hex ausserhalb der Karte: BEZUG_UNBEKANNT');
  ok(codes(f(gut({ bezug: { ort: 'Vulcania' } }))).join() === C.BEZUG_UNBEKANNT, 'Ort: ein Name statt Hex-Code: BEZUG_UNBEKANNT');
  const uk = f(gut({ bezug: { nsc: 'Quintus Varro' } }));
  ok(codes(uk).join() === C.BEZUG_UNBEKANNT && uk.fehler[0].gegenvorschlag.patch[0].entfernen === true, 'ein Bezug, den die Absicht nicht kennt: BEZUG_UNBEKANNT, Vorschlag weglassen');
  // ohne Faeden (kein Weltstand): kein Bezug existiert
  const g0 = F.neuesSpiel({ crew: 1, seed: 3, env: {} }).g;
  ok(codes(AP.pruefeAbsicht(g0, gutNsc('Quintus Varro'), KAT)).join() === C.BEZUG_UNBEKANNT, 'ohne eingeschaltete Faeden gibt es keinen NSC: BEZUG_UNBEKANNT (kein Absturz)');
});

section('BOGEN_UNVOLLSTAENDIG und TON_UNBEKANNT', () => {
  const g = welt(11, 2).g;
  const f = (a) => AP.pruefeAbsicht(g, a, KAT);
  const ohne = (feld) => { const a = gut(); delete a.bogen[feld]; return a; };
  for (const k of ['einsatz', 'wendung', 'preis']) { const e = f(ohne(k)); ok(codes(e).join() === C.BOGEN_UNVOLLSTAENDIG && e.fehler[0].feld === 'bogen.' + k, 'BOGEN_UNVOLLSTAENDIG: ' + k + ' fehlt'); }
  ok(fe(f(ohne('wendung')), C.BOGEN_UNVOLLSTAENDIG).gegenvorschlag.patch[0].wert === 'hinterhalt', 'fehlende Wendung: Vorschlag die erste erlaubte');
  const b0 = f(gut({ bogen: undefined }));
  ok(codes(b0).join() === C.BOGEN_UNVOLLSTAENDIG && b0.fehler[0].feld === 'bogen', 'kein Bogen: BOGEN_UNVOLLSTAENDIG');
  const lerr = f(gut({ bogen: { einsatz: '  ', wendung: 'keine', preis: TEXT.preis } }));
  ok(codes(lerr).join() === C.BOGEN_UNVOLLSTAENDIG, 'ein leerer Einsatz zaehlt als fehlend');
  const w = f(gut({ bogen: { einsatz: TEXT.einsatz, wendung: 'hinterhaltt', preis: TEXT.preis } }));
  ok(codes(w).join() === C.BOGEN_UNVOLLSTAENDIG && w.fehler[0].gegenvorschlag.patch[0].wert === 'hinterhalt', 'unbekannte Wendung: der naechste erlaubte Wert');
  const k = gut({ absicht: 'probe_kanon', parameter: {}, bezug: { nsc: 'Quintus Varro' }, bogen: { einsatz: TEXT.einsatz, preis: TEXT.preis }, ton: 'nuechtern' });
  ok(f(k).ok, 'bogen_pflicht der Absicht: ohne Wendungsfeld gueltig, wo der Katalog sie nicht verlangt');
  const t = f(gut({ ton: 'bittr' }));
  ok(codes(t).join() === C.TON_UNBEKANNT && t.fehler[0].feld === 'ton' && /erlaubt: nuechtern, dringlich/.test(t.fehler[0].grund), 'TON_UNBEKANNT: die eigene Tonliste der Absicht gilt (nuechtern, dringlich)');
  ok(t.fehler[0].gegenvorschlag.patch[0].wert === 'nuechtern' || t.fehler[0].gegenvorschlag.patch[0].wert === 'dringlich', 'Ton: Vorschlag ein erlaubter Ton');
  ok(f(gut({ ton: 'bitter' })).fehler[0].code === C.TON_UNBEKANNT, 'ein Ton des Katalogs, den die Absicht nicht zulaesst, gilt nicht');
  ok(AP.pruefeAbsicht(g, gutNsc('Quintus Varro', { ton: 'bitter' }), KAT).ok, 'ohne eigene Tonliste gilt die des Katalogs (bitter)');
});

section('TEXT_UNZULAESSIG: Laenge, Platzhalter, Eigennamen, Spielernamen', () => {
  const t = welt(11, 2), g = t.g;
  const T = lies('content/faeden/bauplan.json').werte;
  const f = (a) => AP.pruefeAbsicht(g, a, KAT);
  const text = (feld, e) => e.fehler.find((x) => x.code === C.TEXT_UNZULAESSIG && x.feld === feld);
  const eins = (o) => gut({ bogen: Object.assign({ einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, o) });
  ok(f(gut()).ok, 'Grundfall gueltig');
  ok(text('titel', f(gut({ titel: 'ab' }))) && T.titel.wert.min === 3, 'Titel zu kurz (Grenze wie bauplan.json: ' + T.titel.wert.min + ')');
  const lang = f(gut({ titel: 'Wort '.repeat(20).trim() }));
  ok(text('titel', lang) && text('titel', lang).gegenvorschlag && text('titel', lang).gegenvorschlag.patch[0].wert.length <= T.titel.wert.max && T.titel.wert.max === 60, 'Titel zu lang (' + T.titel.wert.max + '): Gegenvorschlag gekuerzt');
  ok(text('bogen.einsatz', f(gut({ bogen: { einsatz: 'kurz', wendung: 'keine', preis: TEXT.preis } }))), 'Einsatz zu kurz (Grenze wie anlass: ' + T.anlass.wert.min + ')');
  const lang2 = f(gut({ bogen: { einsatz: 'Satz '.repeat(60).trim(), wendung: 'keine', preis: TEXT.preis } }));
  ok(text('bogen.einsatz', lang2) && text('bogen.einsatz', lang2).gegenvorschlag.patch[0].wert.length <= T.anlass.wert.max && T.anlass.wert.max === 160, 'Einsatz zu lang (' + T.anlass.wert.max + '): gekuerzter Vorschlag');
  const kl = f(gut({ titel: 'Die {nsc} kehrt zurueck' }));
  ok(text('titel', kl) && !/[{}]/.test(text('titel', kl).gegenvorschlag.patch[0].wert), 'Platzhalter {} im Titel: unzulaessig, Vorschlag ohne Klammern');
  ok(text('bogen.preis', f(eins({ preis: 'Der Preis ist hoch {ware} verloren.' }))), 'Platzhalter im Preis');
  ok(text('titel', f(gut({ titel: 'Zwei\nZeilen hier' }))), 'Steuerzeichen im Titel');
  // Eigennamen: nur der Bezug darf genannt werden
  const fremd = f(eins({ einsatz: 'Marcus will seine Schuld eintreiben und kommt mit Geschwader.' }));
  ok(text('bogen.einsatz', fremd) && /Marcus/.test(text('bogen.einsatz', fremd).grund), 'ein Vorname aus namen.json, der nicht der Bezug ist: unzulaessig');
  ok(text('bogen.einsatz', f(eins({ einsatz: 'Die Crew trifft die Aquila im Nebel am Sprungpunkt.' }))), 'ein Schiffsname aus namen.json: unzulaessig');
  ok(text('bogen.einsatz', f(eins({ einsatz: 'Der Legat Quintus Dorn rueckt mit der Flotte vor und will Rache.' }))), 'ein Kommandantenname (kommandanten.json): unzulaessig');
  const ort = Object.entries(Sektoren.KARTE.hexe).find(([h, d]) => d && typeof d.name === 'string' && d.name.length >= 5 && d.name !== '?' && /^[A-Za-z]+$/.test(d.name) && !(Object.values(D.NAMEN).some((L) => L.vornamen.concat(L.nachnamen).includes(d.name))));
  ok(!!ort, 'Testdaten: ein Ortsname aus der Karte (' + (ort && ort[1].name) + ')');
  ok(text('bogen.einsatz', f(eins({ einsatz: 'Der Auftrag fuehrt die Crew nach ' + ort[1].name + ' und weiter ins Dunkel.' }))), 'ein Ortsname der Karte, der nicht der Bezug ist: unzulaessig');
  ok(f(gut({ bezug: { ort: ort[0] }, bogen: { einsatz: 'Der Auftrag fuehrt die Crew nach ' + ort[1].name + ' und weiter ins Dunkel.', wendung: 'keine', preis: TEXT.preis } })).ok || (f(gut({ bezug: { ort: ort[0] } })).fehler.some((x) => x.code === C.BEZUG_UNBEKANNT)), 'der Ort des Bezugs darf genannt werden (ist der Sektor nicht spielbar, meldet der Bezug, nicht der Text)');
  const mit = gutNsc('Quintus Varro');
  ok(AP.pruefeAbsicht(g, mit, KAT).ok, 'der Bezug darf im Text stehen (Quintus Varro im Einsatz)');
  mit.bogen.einsatz = 'Varro kehrt mit dem Geschwader zurueck und fordert seine Schuld ein.';
  ok(AP.pruefeAbsicht(g, mit, KAT).ok, 'auch ein Teil des Vollnamens des Bezugs (Varro)');
  mit.bogen.einsatz = 'Quintus Varro und Titus Calder kehren mit dem Geschwader zurueck und wollen Rache.';
  ok(text('bogen.einsatz', AP.pruefeAbsicht(g, mit, KAT)), 'ein zweiter NSC im Text, der nicht der Bezug ist: unzulaessig');
  // SPL-02 C0: gewoehnliche deutsche Woerter (Dorn, Rabe, Halbmond) sind keine Eigennamen; am Satzanfang zaehlen nur Vornamen und volle Namen
  const einsatzFehler = (txt, k) => { const x = AP.pruefeAbsicht(g, eins({ einsatz: txt }), k || KAT); return x.fehler.find((y) => y.code === C.TEXT_UNZULAESSIG && y.feld === 'bogen.einsatz'); };
  ok(!einsatzFehler('Der Dorn im Fleisch der Crew sitzt tief und schmerzt noch.'), 'Dorn in der Satzmitte (Datenliste gewoehnliche_woerter): kein Eigenname');
  ok(!einsatzFehler('Dorn und Stachel sitzen tief im Fleisch der Crew, sagt man.'), 'Dorn am Satzanfang: kein Eigenname');
  ok(!einsatzFehler('Ein Rabe sitzt auf der Reling und wartet schon lange auf Beute.'), 'Rabe (auch Nachname einer Kommandantin): kein Eigenname');
  ok(!einsatzFehler('Der Halbmond steht hoch ueber dem Sprungpunkt der Crew heute.'), 'Halbmond (Schiffsname, aber auch ein Wort): kein Eigenname');
  ok(!einsatzFehler('Am Strand der Station sammeln sich die Schatten der Nacht.'), 'Strand (Nachname eines Kommandanten): kein Eigenname');
  ok(einsatzFehler('Quintus Dorn griff an und will die Schuld jetzt eintreiben.') && /Quintus/.test(einsatzFehler('Quintus Dorn griff an und will die Schuld jetzt eintreiben.').grund), '"Quintus Dorn griff an." ohne Bezug: abgelehnt (Vorname am Satzanfang)');
  ok(!!einsatzFehler('Titus meldet sich mit einem Geschwader zurueck zur Abrechnung.'), 'ein Vorname am Satzanfang bleibt ein Eigenname');
  ok(!!einsatzFehler('Die Crew trifft Varro am Sprungpunkt und will die Schuld.'), 'ein Nachname in der Satzmitte (nicht in der Liste): Eigenname');
  ok(!!einsatzFehler('Varro Calder kommt mit Geschwader und will die Schuld jetzt.'), 'zwei Namensteile am Satzanfang (voller Name): Eigenname');
  ok(!!einsatzFehler('Er sagte nichts. Quintus Dorn griff an und will die Schuld.'), 'auch nach einem Punkt mitten im Text: Vorname am Satzanfang');
  ok(!einsatzFehler('Varro kam mit Geschwader zurueck und will die Schuld jetzt.'), 'ein Nachname ALLEIN am Satzanfang (nicht in der Liste, kein zweiter Namensteil) gilt nicht (Grossschreibung am Anfang sagt nichts)');
  const leer = mitWert('gewoehnliche_woerter', []);
  ok(!!einsatzFehler('Der Dorn im Fleisch der Crew sitzt tief und schmerzt noch.', leer) && !!einsatzFehler('Der Halbmond steht hoch ueber dem Sprungpunkt der Crew heute.', leer), 'die Liste ist Datenwert: ohne sie gilt Dorn und Halbmond wieder als Name');
  ok(!!einsatzFehler('Die Crew trifft Quintus Dorn am Sprungpunkt und will die Schuld.'), 'Quintus Dorn in der Satzmitte: Eigenname (Quintus)');
  ok(!AP.pruefeAbsicht(g, gutNsc('Quintus Varro', { bogen: { einsatz: 'Quintus Varro kehrt mit Geschwader zurueck und will die Schuld.', wendung: 'verfolgung', preis: TEXT.preis }, ton: 'nuechtern' }), KAT).fehler.some((y) => y.code === C.TEXT_UNZULAESSIG), 'der Bezug darf am Satzanfang genannt werden');
  ok(AP.katalogFehler(mitWert('gewoehnliche_woerter', 'Dorn')).some((x) => /gewoehnliche_woerter/.test(x)), 'Strukturregel: gewoehnliche_woerter ist eine Liste von Texten');
  // Spielernamen: Crew-neutral
  const sp = f(eins({ einsatz: 'Mireille_Kas hat die Schuld nie beglichen und wird gesucht.' }));
  ok(text('bogen.einsatz', sp) && /Spielernamen/.test(text('bogen.einsatz', sp).grund), 'ein Spielername im Text: unzulaessig (Crew-neutral)');
  ok(text('titel', f(gut({ titel: 'Die Rechnung des Ouzo_Brandt' }))), 'auch im Titel');
  // alle Fehler zusammen: nicht nur der erste
  const viele = f(gut({ parameter: { menge: 9 }, titel: 'ab', ton: 'x', bogen: { einsatz: TEXT.einsatz, wendung: 'q', preis: TEXT.preis } }));
  ok(['PARAMETER', 'TEXT_UNZULAESSIG', 'TON_UNBEKANNT', 'BOGEN_UNVOLLSTAENDIG'].every((c) => codes(viele).includes(c)), 'mehrere Fehler zugleich: alle stehen im Ergebnis (' + kurz(viele) + ')');
  ok(Object.keys(C).every((k) => k === C[k]) && ['FORM', 'ABSICHT_UNBEKANNT', 'PARAMETER', 'BEZUG_FEHLT', 'BEZUG_UNBEKANNT', 'BEZUG_UNEINDEUTIG', 'BEZUG_VERALTET', 'BOGEN_UNVOLLSTAENDIG', 'TON_UNBEKANNT', 'TEXT_UNZULAESSIG'].every((c) => C[c] === c), 'Codes: benannte Konstanten');
  ok(Object.isFrozen(C), 'die Codes sind eingefroren');
});

section('Patch und Klartext fuer das Modell', () => {
  const g = welt(11, 2).g;
  const a = gut({ parameter: { menge: 9 } });
  const e = AP.pruefeAbsicht(g, a, KAT);
  const w = AP.wendePatchAn(a, [{ feld: 'parameter.menge', wert: 3 }, { feld: 'ton', wert: 'dringlich' }, { feld: 'bogen.preis', wert: 'Ein neuer Preis fuer die Probe.' }]);
  ok(w.ok && w.absicht.parameter.menge === 3 && w.absicht.ton === 'dringlich' && w.absicht.bogen.preis === 'Ein neuer Preis fuer die Probe.' && a.parameter.menge === 9, 'wendePatchAn aendert eine Kopie, die Eingabe bleibt');
  ok(AP.wendePatchAn(a, [{ feld: 'parameter.menge', entfernen: true }]).absicht.parameter.menge === undefined, 'Patch entfernen');
  ok(AP.wendePatchAn(a, [{ feld: 'bezug.nsc', wert: 'Quintus Varro' }]).absicht.bezug.nsc === 'Quintus Varro', 'Patch legt ein fehlendes Objekt an');
  for (const [was, p] of [['kein Array', { feld: 'ton', wert: 'x' }], ['leer', []], ['__proto__', [{ feld: '__proto__.x', wert: 1 }]], ['zu tief', [{ feld: 'a.b.c', wert: 1 }]], ['fremdes Feld', [{ feld: 'geld', wert: 1 }]], ['Objektwert', [{ feld: 'ton', wert: {} }]], ['constructor', [{ feld: 'bogen.constructor', wert: 'x' }]], ['Grossbuchstaben', [{ feld: 'Ton', wert: 'x' }]], ['zu viele', Array.from({ length: 9 }, () => ({ feld: 'ton', wert: 'x' }))]]) {
    ok(AP.wendePatchAn(a, p).ok === false, 'Patch abgelehnt: ' + was);
  }
  ok(!({}).x && Object.keys(Object.prototype).length === 0, 'der Prototyp bleibt unberuehrt');
  const t = AP.fehlerText(e, KAT);
  ok(/PARAMETER/.test(t) && /parameter\.menge/.test(t) && /Vorschlag: menge = 5/.test(t) && /Patch: \[\{"feld":"parameter\.menge","wert":5\}\]/.test(t), 'Klartext: Code, Feld, Grund, Vorschlag und Patch');
  ok(t.length <= ECHT.werte.fehler_text_max.wert && AP.fehlerText({ ok: true, fehler: [] }, KAT) === '', 'Klartext hoechstens fehler_text_max (' + ECHT.werte.fehler_text_max.wert + ') Zeichen; bei Erfolg leer');
  const k = mitWert('fehler_text_max', 100);
  ok(AP.fehlerText(e, k).length === 100 && /\.\.\.$/.test(AP.fehlerText(e, k)), 'die Grenze ist ein Datenwert: bei 100 abgeschnitten');
  const viele = AP.pruefeAbsicht(g, gut({ parameter: { menge: 9, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } }), KAT);
  ok(AP.fehlerText(viele, mitWert('fehler_text_max', 5000)).split('\n').filter((z) => /^- /.test(z)).length === ECHT.werte.fehler_max.wert, 'hoechstens fehler_max Fehler im Text (' + ECHT.werte.fehler_max.wert + ')');
  ok(AP.gegenvorschlagPatch(AP.pruefeAbsicht(g, gut({ titel: 'ab' }), KAT)) === null, 'ein Fehler ohne Gegenvorschlag: gegenvorschlagPatch ist null');
  ok(AP.gegenvorschlagPatch(AP.pruefeAbsicht(g, gut(), KAT)) === null, 'bei Erfolg kein Patch');
});

section('Verhandlung: eine Runde, danach endgueltig', () => {
  const g = welt(11, 2).g;
  const schlecht = gut({ parameter: { menge: 9 } });
  let v = AP.verhandlungStart(g, gut(), KAT);
  ok(v.stand === 'angenommen' && v.runde === 0 && v.ergebnis.ok, 'eine gueltige Absicht ist sofort angenommen');
  v = AP.verhandlungStart(g, schlecht, KAT);
  ok(v.stand === 'offen' && v.runde === 0 && v.runden_max === 1 && /Nein/.test(v.text) && /menge/.test(v.text), 'ein Nein oeffnet die Verhandlung mit Klartext (Runde 0 von 1)');
  const a1 = AP.verhandlungAntwort(g, v, [{ feld: 'parameter.menge', wert: 5 }], KAT);
  ok(a1.stand === 'angenommen' && a1.runde === 1 && a1.absicht.parameter.menge === 5, 'Antwort mit Patch: neu geprueft, angenommen');
  ok(v.stand === 'offen' && v.runde === 0, 'das Verhandlungsobjekt wird nicht veraendert (neuer Stand)');
  const a2 = AP.verhandlungAntwort(g, v, gut({ parameter: { menge: 4 } }), KAT);
  ok(a2.stand === 'angenommen', 'Antwort mit korrigierter Absicht: angenommen');
  const a3 = AP.verhandlungAntwort(g, v, { patch: [{ feld: 'parameter.menge', wert: 4 }] }, KAT);
  ok(a3.stand === 'angenommen', 'Antwort als { patch }: angenommen');
  const b1 = AP.verhandlungAntwort(g, v, [{ feld: 'parameter.menge', wert: 7 }], KAT);
  ok(b1.stand === 'abgelehnt' && b1.runde === 1 && /^Endgueltig abgelehnt: PARAMETER/.test(b1.text) && !b1.ergebnis.ok, 'die eine Runde ist verbraucht: endgueltig abgelehnt mit Grund');
  const b2 = AP.verhandlungAntwort(g, b1, [{ feld: 'parameter.menge', wert: 5 }], KAT);
  ok(b2 === b1 && b2.stand === 'abgelehnt', 'nach der Ablehnung ist nichts mehr zu verhandeln');
  ok(AP.verhandlungAntwort(g, a1, [{ feld: 'ton', wert: 'x' }], KAT) === a1, 'auch ein angenommener Stand bleibt');
  const c1 = AP.verhandlungAntwort(g, v, [{ feld: '__proto__.x', wert: 1 }], KAT);
  ok(c1.stand === 'abgelehnt' && /Endgueltig abgelehnt/.test(c1.text), 'ein unbrauchbarer Patch verbraucht die Runde: abgelehnt');
  const c2 = AP.verhandlungAntwort(g, v, 'ich weiss nicht', KAT);
  ok(c2.stand === 'abgelehnt', 'keine Antwort im Format: abgelehnt');
  const c3 = AP.verhandlungAntwort(g, v, null, KAT);
  ok(c3.stand === 'abgelehnt', 'keine Antwort (null): abgelehnt');
  // Anzahl der Runden ist ein Datenwert
  const k0 = mitWert('runden_max', 0), k2 = mitWert('runden_max', 2);
  const z0 = AP.verhandlungStart(g, schlecht, k0);
  ok(z0.stand === 'abgelehnt' && z0.runden_max === 0 && /Endgueltig abgelehnt/.test(z0.text), 'runden_max 0 (Daten): sofort endgueltig abgelehnt');
  let z = AP.verhandlungStart(g, schlecht, k2);
  z = AP.verhandlungAntwort(g, z, [{ feld: 'parameter.menge', wert: 8 }], k2);
  ok(z.stand === 'offen' && z.runde === 1 && z.runden_max === 2 && /Nein/.test(z.text), 'runden_max 2: nach der ersten falschen Antwort noch offen');
  z = AP.verhandlungAntwort(g, z, [{ feld: 'parameter.menge', wert: 2 }], k2);
  ok(z.stand === 'angenommen' && z.runde === 2, 'die zweite Antwort gilt, wenn sie stimmt');
  let y = AP.verhandlungStart(g, schlecht, k2);
  y = AP.verhandlungAntwort(g, y, [{ feld: 'parameter.menge', wert: 8 }], k2);
  y = AP.verhandlungAntwort(g, y, [{ feld: 'parameter.menge', wert: 9 }], k2);
  ok(y.stand === 'abgelehnt' && y.runde === 2, 'nach runden_max Antworten ohne Erfolg: endgueltig abgelehnt');
  // Form-Fehler: kein Absturz
  const f0 = AP.verhandlungStart(g, 'text', KAT);
  ok(f0.stand === 'offen' && f0.absicht === 'text' && codes(f0.ergebnis).join() === C.FORM, 'FORM-Fehler: offen, die Antwort darf eine ganze Absicht sein');
  ok(AP.verhandlungAntwort(g, f0, gut(), KAT).stand === 'angenommen', 'auf ein FORM-Nein folgt eine ganze, gueltige Absicht: angenommen');
});

// ======================================================================
// Brett: bezug und locker am Angebot
const annehmen = (t, nr) => { t.c.inbox.length = 0; t.g.handleMessage(t.c, { t: 'cmd', c: 'abenteuer.annehmen', id: 'a' + nr }); return t.c.inbox.filter((m) => m.t === 'event' && m.kind === 'abenteuerAntwort').pop(); };
const laufend = (g) => liste(g).filter((f) => f.phase !== 'abgeschlossen');
const speichern = (g) => klon(Weltstand.capture(g).welt.sim);
function laden(sim, seed) { D.zuruecksetzen(); const t = neu(seed); Kriegslage.restore(t.g, klon(sim)); return t; }

section('Brett: das Angebot nimmt bezug und locker an und gibt sie weiter', () => {
  const t = welt(11, 3), g = t.g, F0 = zust(g);
  ok(Wdh.kandidatenFrisch(g, { beats: [{ typ: 'wiedersehen' }], volk_erlaubt: ['rom'] }).length === 2, 'Aufbau: zwei frische Kandidaten (Quintus Varro, Titus Calder), der dritte war die Hauptfigur des letzten Abenteuers');
  const r = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', bezug: { nsc: 'Quintus Varro' } });
  ok(r.ok && r.angebot.bezug && r.angebot.bezug.nsc === 'Quintus Varro' && r.angebot.locker === undefined, 'neuAnbieten: das Angebot traegt bezug { nsc: Vollname }, kein locker');
  F0.abenteuerAngebote.length = 0;
  const r2 = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305' });
  ok(r2.ok && r2.angebot.bezug === undefined && r2.angebot.locker === undefined && F0.abenteuerAngebote.length === 1, 'ohne bezug und locker: genau abenteuerNeuAnbieten, die Felder fehlen');
  F0.abenteuerAngebote.length = 0;
  const r3 = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', locker: true });
  ok(r3.ok && r3.angebot.locker === true && r3.angebot.bezug === undefined, 'locker wird durchgereicht');
  F0.abenteuerAngebote.length = 0;
  for (const [was, b] of [['Zeichenkette', 'Quintus Varro'], ['leeres Objekt', {}], ['fremder Schluessel', { nsc: 'Quintus Varro', ort: '0305' }], ['kein Text', { nsc: 5 }], ['zu kurz', { nsc: 'ab' }]]) {
    const x = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', bezug: b });
    ok(!x.ok && /^PARAMETER/.test(x.grund) && F0.abenteuerAngebote.length === 0, 'bezug ' + was + ': abgelehnt (PARAMETER), kein Angebot');
  }
  const u = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', bezug: { nsc: 'Gaius Nirgendwo' } });
  ok(!u.ok && /^BEZUG_UNBEKANNT/.test(u.grund) && F0.abenteuerAngebote.length === 0, 'ein NSC, der kein Kandidat ist: BEZUG_UNBEKANNT, kein Angebot');
  ok(logbuch(g).some((e) => e.art === 'faden_pruefung' && /BEZUG_UNBEKANNT/.test(JSON.stringify(e.fehler))), 'die Ablehnung steht im Logbuch');
  const h = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', bezug: { nsc: 'Gaius Fabrin' } });
  ok(!h.ok && /^WIEDERHOLUNG_NSC/.test(h.grund), 'die Hauptfigur des letzten Abenteuers als Bezug, ohne locker: WIEDERHOLUNG_NSC');
  const hl = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', bezug: { nsc: 'Gaius Fabrin' }, locker: true });
  ok(hl.ok && hl.angebot.locker === true && hl.angebot.bezug.nsc === 'Gaius Fabrin', 'dieselbe Hauptfigur mit locker (Fortsetzung): das Angebot ist moeglich');
  F0.abenteuerAngebote.length = 0;
  const ung = Brett.neuAnbieten(g, { format: 'faden-bauplan/1', titel: 'x', beats: [] }, { hex: '0305', bezug: { nsc: 'Quintus Varro' } });
  ok(!ung.ok && F0.abenteuerAngebote.length === 0, 'ein ungueltiger Plan wird wie sonst abgelehnt (' + String(ung.grund).slice(0, 24) + ')');
  const ohneHex = Brett.neuAnbieten(g, wiedersehen(), { hex: 'xx', bezug: { nsc: 'Quintus Varro' } });
  ok(!ohneHex.ok && F0.abenteuerAngebote.length === 0, 'ein ungueltiger Ort wird abgelehnt');
  const aus = F.neuesSpiel({ crew: 1, seed: 3, env: {} }).g;
  ok(Brett.neuAnbieten(aus, wiedersehen(), { hex: '0305', locker: true }).ok === false, 'ohne Schalter FAEDEN: INAKTIV, nichts geschieht');
});

section('Brett: Annehmen nimmt den gewaehlten NSC (Quintus statt Titus)', () => {
  // Grundverhalten unveraendert: ohne Bezug der juengste frische Kandidat (Titus Calder)
  { const t = welt(11, 3), g = t.g;
    const a = Faden.abenteuerNeuAnbieten(g, wiedersehen(), { hex: '0305' });
    ok(a.ok, 'Angebot ohne Bezug (abenteuerNeuAnbieten, unveraendert)');
    const ant = annehmen(t, a.angebot.nr);
    ok(ant && ant.ok === true && laufend(g).length === 1 && laufend(g)[0].nsc.name === 'Titus Calder', 'ohne Bezug: der juengste frische Kandidat (' + (laufend(g)[0] && laufend(g)[0].nsc.name) + ')'); }
  // Mit Bezug Quintus: das Brett nimmt Quintus
  { const t = welt(11, 3), g = t.g;
    const a = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', bezug: { nsc: 'Quintus Varro' } });
    const ant = annehmen(t, a.angebot.nr);
    ok(a.ok && ant && ant.ok === true && laufend(g).length === 1 && laufend(g)[0].nsc.name === 'Quintus Varro', 'Bezug Quintus Varro: das Brett nimmt den gewaehlten, nicht Titus (' + (laufend(g)[0] && laufend(g)[0].nsc.name) + ')');
    ok(zust(g).abenteuerAngebote.length === 0, 'das Angebot ist vom Brett'); }
  // Bezug auf einen NSC, der inzwischen kein Kandidat mehr ist: veraltet mit eigenem Grund
  for (const [was, mach] of [['tot', (f) => { f.nsc.status = 'tot'; }], ['gefangen', (f) => { f.nsc.status = 'gefangen'; }], ['verdraengt (Faden und Gedaechtnis weg)', (f, g) => { const L = liste(g); L.splice(L.indexOf(f), 1); }]]) {
    const t = welt(11, 3), g = t.g;
    const a = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', bezug: { nsc: 'Quintus Varro' } });
    mach(t.f[0], g);
    const ant = annehmen(t, a.angebot.nr);
    const lv = logbuch(g).filter((e) => e.ausgang === 'abenteuer_veraltet').pop();
    ok(a.ok && ant && ant.ok === false && ant.code === 'veraltet' && laufend(g).length === 0 && zust(g).abenteuerAngebote.length === 0, 'NSC ' + was + ': das Angebot ist veraltet, kein Faden, vom Brett genommen');
    ok(lv && /BEZUG_VERALTET/.test(lv.begruendung), 'NSC ' + was + ': Grund BEZUG_VERALTET im Logbuch'); }
  // Der NSC war inzwischen die Hauptfigur des letzten Abenteuers: ohne locker veraltet, mit locker angenommen
  for (const locker of [false, true]) {
    const t = welt(11, 3), g = t.g;
    const a = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', bezug: { nsc: 'Quintus Varro' }, locker });
    const letzter = zust(g).kanon.filter((e) => e.titel).pop();
    letzter.name = 'Quintus Varro'; letzter.volk = 'rom'; letzter.wieder = true;   // Quintus ist jetzt die Hauptfigur des letzten Abenteuers
    const ant = annehmen(t, a.angebot.nr);
    if (locker) ok(a.ok && ant && ant.ok === true && laufend(g).length === 1 && laufend(g)[0].nsc.name === 'Quintus Varro', 'Bezug auf die juengste Hauptfigur mit locker: angenommen, Quintus Varro');
    else { const lv = logbuch(g).filter((e) => e.ausgang === 'abenteuer_veraltet').pop(); ok(a.ok && ant && ant.ok === false && ant.code === 'veraltet' && /WIEDERHOLUNG_NSC/.test(lv.begruendung), 'Bezug auf die juengste Hauptfigur ohne locker: veraltet (WIEDERHOLUNG_NSC)'); }
  }
  // Ein Angebot ohne Wiedersehen mit Bezug: der Bezug aendert nichts am Annehmen (der NSC ist neu)
  { const t = welt(11, 2), g = t.g;
    const a = Brett.neuAnbieten(g, einzel('geleit', 9), { hex: '0305', bezug: { nsc: 'Quintus Varro' } });
    const ant = annehmen(t, a.angebot.nr);
    ok(a.ok && ant && ant.ok === true && laufend(g).length === 1 && laufend(g)[0].nsc.name !== 'Quintus Varro', 'Bezug an einem Plan ohne Wiedersehen: wird gespeichert, das Annehmen erzeugt den neuen NSC wie immer'); }
});

section('Brett: Wiederholungsregel nsc_zuletzt mit locker (Fortsetzung)', () => {
  // nur ein Abenteuer: sein NSC ist die Hauptfigur des letzten Abenteuers, es gibt keinen frischen Kandidaten
  const t = welt(11, 1), g = t.g, F0 = zust(g);
  const strenge = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305' });
  ok(!strenge.ok && /^WIEDERHOLUNG_NSC/.test(strenge.grund) && F0.abenteuerAngebote.length === 0, 'ohne locker: WIEDERHOLUNG_NSC (die Regel gilt)');
  const rb = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', bezug: { nsc: 'Quintus Varro' } });
  ok(!rb.ok && /^WIEDERHOLUNG_NSC/.test(rb.grund), 'auch mit Bezug auf diese Hauptfigur, aber ohne locker');
  const lk = Brett.neuAnbieten(g, wiedersehen(), { hex: '0305', locker: true });
  ok(lk.ok && lk.angebot.locker === true, 'mit locker: das Angebot kommt aufs Brett');
  const ant = annehmen(t, lk.angebot.nr);
  ok(ant && ant.ok === true && laufend(g).length === 1 && laufend(g)[0].nsc.name === 'Quintus Varro', 'Annehmen mit locker ohne Bezug: der einzige Kandidat kommt zurueck (' + (laufend(g)[0] && laufend(g)[0].nsc.name) + ')');
  // Ort und Folge gelten weiter, auch mit locker: dasselbe Abenteuer an demselben Ort zweimal ist keine Fortsetzung
  const t2 = welt(12, 1), g2 = t2.g;
  const z1 = Brett.neuAnbieten(g2, einzel('notruf', 1), { hex: '0305', locker: true });
  ok(!z1.ok && /^WIEDERHOLUNG_(FOLGE|ORT)/.test(z1.grund), 'locker lockert nur die NSC-Sperre: dieselbe Folge bleibt WIEDERHOLUNG_FOLGE/ORT (' + String(z1.grund).slice(0, 20) + ')');
  // der Weltstand traegt bezug und locker (additiv), Altstand laedt unveraendert
  const t3 = welt(11, 3), g3 = t3.g;
  const s0 = speichern(g3);
  ok(!(s0.faeden.abenteuer && s0.faeden.abenteuer.angebote), 'ohne Angebot steht nichts im Stand');
  const a3 = Brett.neuAnbieten(g3, wiedersehen(), { hex: '0305', bezug: { nsc: 'Quintus Varro' }, locker: true });
  const s1 = speichern(g3), ang = s1.faeden.abenteuer.angebote[0];
  ok(a3.ok && ang.bezug.nsc === 'Quintus Varro' && ang.locker === true, 'Weltstand: bezug und locker stehen am Angebot');
  const v = Weltstand.validate(Weltstand.capture(g3));
  ok(Array.isArray(v) && v.length === 0, 'der Stand besteht das Schema mit bezug und locker (' + JSON.stringify(v).slice(0, 160) + ')');
  const L = laden(s1, 11), la = zust(L.g).abenteuerAngebote;
  ok(la.length === 1 && la[0].bezug && la[0].bezug.nsc === 'Quintus Varro' && la[0].locker === true, 'Laden: bezug und locker kommen zurueck');
  const alt = klon(s1); delete alt.faeden.abenteuer.angebote[0].bezug; delete alt.faeden.abenteuer.angebote[0].locker;
  const LA = laden(alt, 11), laa = zust(LA.g).abenteuerAngebote;
  ok(laa.length === 1 && laa[0].bezug === undefined && laa[0].locker === undefined, 'Altstand (Angebot ohne bezug): laedt unveraendert');
  const muell = klon(s1); muell.faeden.abenteuer.angebote[0].bezug = { nsc: 5 }; muell.faeden.abenteuer.angebote[0].locker = 'ja';
  const LM = laden(muell, 11), lm = zust(LM.g).abenteuerAngebote;
  ok(lm.length === 1 && lm[0].bezug === undefined && lm[0].locker === undefined, 'Muell in bezug und locker wird beim Laden verworfen, das Angebot bleibt');
  const d1 = JSON.stringify(speichern(L.g).faeden.abenteuer);
  ok(d1 === JSON.stringify(s1.faeden.abenteuer), 'Speichern, Laden, Speichern: gleicher Block');
});

// ======================================================================
for (const [name, fn] of abschnitte) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
  console.log('\n== ' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
console.log(`\n${n - fails}/${n} gruen`);
process.exit(fails ? 1 : 0);
