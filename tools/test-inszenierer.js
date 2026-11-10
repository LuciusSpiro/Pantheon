'use strict';
// SPL-02 B: der Inszenierer (server/sim/inszenierer.js; Zahlen in content/faeden/inszenierer-werte.json, Rezepte im Katalog der Absichten, Feld `inszenierung`) und die Anbindung ans Brett (anbietenAusAbsicht).
// Die Erwartungen stehen hier selbst (von Hand gerechnet an einer eigenen Welt: Crew bei Ostia Nova 0305, Hoehlen bei Vulcania 0205 und Porta Australis 0405 je einen Sprung entfernt, drei NSC), nie aus dem Produktivcode abgeleitet.
// Die Absichten kommen aus der Fixture tools/fixtures/absichten/inszenierer-katalog.json (der Katalog des Spiels ist beim Start leer: die Eintraege kommen mit Paket C). Die Zeile `rache` des Beat-Katalogs
// steht seit SPL-02 C0 in content/faeden/beats.json (Datenfeld nur_inszenierer); `ohneRache` nimmt sie fuer die Gegenprobe voruebergehend heraus.
// Geprueft wird: Daten und Katalog stimmig · Erfolg bis zum gueltigen Plan (Expander und Pruefer) · Wendung aus dem Bogen · Ort fern: Nein mit Gegenvorschlag, der angenommene Patch geht durch · Bezug unbekannt ·
// Weltbedingungen (Haltung, Rang, Lage) · Staerke und Stufe nach Rang und Schiff · nicht ausdrueckbar als ehrliches Nein · Rache mit feindlichem Start (Daten, durch das Spiel) · Anbieten ueber das Brett ·
// Determinismus · kein Absichtsname und kein Beat-Typ im Code.
// Aufruf: node tools/test-inszenierer.js [begriff ...]        (npm run test:inszenierer)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const CONFIG = require('../shared/config.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Bauplan = require('../server/sim/faden-bauplan.js');
const AP = require('../server/sim/absicht-pruefer.js');
const INS = require('../server/sim/inszenierer.js');

const { D, Faden, F } = X;
const C = INS.CODES;
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
const FIX = lies('tools/fixtures/absichten/inszenierer-katalog.json');
const KAT = Object.assign({}, klon(ECHT), { absichten: klon(FIX.absichten) });
const mitKatalog = (mut) => { const k = klon(KAT); mut(k.absichten); return k; };
// die Zeile rache steht im echten Beat-Katalog: mitRache laeuft einfach; ohneRache nimmt sie fuer die Gegenprobe voruebergehend heraus
const mitRache = (fn) => fn();
function ohneRache(fn) {
  const zeile = D.BEATS.rache; delete D.BEATS.rache; Bauplan.katalogNeuLesen();
  try { return fn(); } finally { D.BEATS.rache = zeile; Bauplan.katalogNeuLesen(); }
}

// ---------------------------------------------------------------- Welt
function neu(seed, crew) {
  const t = F.neuesSpiel({ crew: crew || 3, seed: seed || 11, names: NAMEN.slice(0, crew || 3), env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  return t;
}
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats }, o || {});
const einzel = (typ, i) => plan([{ typ }, { typ: 'abschluss' }], { titel: typ + ' ' + i, anlass: 'Probeanlass ' + typ + ' Nummer ' + i + ' ohne Namen' });
const zust = (g) => Faden.zustandVon(g);
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
// der NSC bekommt einen festen Namen (Faden und Kanon), alle roemisch (volk_erlaubt der Vorlage)
function nenne(g, f, name) {
  f.nsc.name = name; f.nsc.fraktion = 'rom';
  const e = zust(g).kanon.find((x) => x.f === f.id);
  e.name = name; e.volk = 'rom';
}
// drei abgeschlossene Abenteuer: A (Quintus Varro), B (Titus Calder), C (Gaius Fabrin, die Hauptfigur des letzten). Haltung und Zustand setzt der Test je Probe.
function welt(seed) {
  const t = neu(seed), g = t.g;
  const typen = ['notruf', 'spontanhilfe', 'fracht'], namen = ['Quintus Varro', 'Titus Calder', 'Gaius Fabrin'];
  t.f = typen.map((typ, i) => { const f = spiele(g, einzel(typ, i + 1)); nenne(g, f, namen[i]); return f; });
  return t;
}
const verstimmt = (f, haltung) => { f.nsc.status = 'aktiv'; f.nsc.haltung = haltung === undefined ? -2 : haltung; };   // der NSC grollt der Crew und ist (noch) nicht feindlich
const ruf = (g, wert) => { g.weltsim.ruf.rom = wert; };

const TEXT = { titel: 'Eine alte Rechnung', einsatz: 'Der Mann kehrt mit Geschwader zurueck und will die Schuld eintreiben.', preis: 'Wer ihn laufen laesst, hat ihn bald wieder im Nacken.' };
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const mitWendung = (w) => ({ bogen: { einsatz: TEXT.einsatz, wendung: w, preis: TEXT.preis } });
const typen = (r) => r.plan.beats.map((b) => b.typ);
const codes = (r) => r.fehler.map((x) => x.code);
const fe = (r, code) => r.fehler.find((x) => x.code === code);
const ins = (g, a, k) => INS.inszeniere(g, a, k || KAT);

// ======================================================================
section('Daten und Katalog stimmig', () => {
  ok(INS.werteFehler().length === 0, 'inszenierer-werte.json ist stimmig (' + INS.werteFehler().join(' | ') + ')');
  const w = lies('content/faeden/inszenierer-werte.json');
  ok(w.format === 'inszenierer-werte/1' && w._hinweis && Object.values(w.werte).every((x) => 'wert' in x && typeof x.einheit === 'string' && typeof x._hinweis === 'string'), 'werte-Konvention: je Eintrag wert, einheit, _hinweis');
  ok(w.werte.stufe_max.wert === 2 && w.werte.reichweite_max.wert === 8 && w.werte.stufe_nach_rang.wert.centurio === 1 && w.werte.stufe_zuschlag_schiff.wert['2'] === 1, 'die Zahlen stehen in den Daten (Stufe nach Rang und Schiff, Reichweite)');
  ok(INS.katalogFehler(ECHT).length === 0, 'der Katalog des Spiels (seit Paket C mit Eintraegen, geprueft in test-absichten-katalog.js) ist stimmig');
  ok(AP.katalogFehler(KAT).length === 0, 'die Fixture besteht die Strukturregeln von Paket A (' + AP.katalogFehler(KAT).join(' | ') + ')');
  const ohne = ohneRache(() => INS.katalogFehler(KAT));
  ok(ohne.length > 0 && ohne.every((t) => /probe_stellung/.test(t)) && ohne.some((t) => /braucht.nsc_alt/.test(t)), 'ohne die Zeile rache im Beat-Katalog: nur probe_stellung ist unstimmig (erster Beat mit nsc_alt fehlt): ' + ohne.length);
  mitRache(() => {
    const f = INS.katalogFehler(KAT);
    ok(f.length === 0, 'mit der Zeile rache: alle Rezepte der Fixture sind stimmig, jede Stufe und Wendung ergibt einen Plan, den der Expander annimmt (' + f.join(' | ').slice(0, 200) + ')');
    ok(Bauplan.katalogFehler().length === 0, 'die Zeile rache besteht auch die Pruefung des Beat-Katalogs (BAUPLAN_KATALOG)');
  });
  const schlecht = (mut, re, was) => { const k = mitKatalog(mut); const f = INS.katalogFehler(k); ok(f.some((x) => re.test(x)), 'Strukturregel: ' + was + ' (' + (f.find((x) => re.test(x)) || f[0] || 'kein Fehler').slice(0, 90) + ')'); };
  schlecht((a) => { a.probe_erz.inszenierung.extra = 1; }, /unbekanntes Feld extra/, 'kein unbekanntes Feld im Rezept');
  schlecht((a) => { a.probe_erz.inszenierung.ort.regel = 'irgendwo'; }, /ort.regel/, 'Ortsregel aus dem Vokabular');
  schlecht((a) => { a.probe_erz.inszenierung.ort.kartenart = 'mond'; }, /Kartenart/, 'Kartenart aus den Daten der Landeplaetze');
  schlecht((a) => { a.probe_erz.inszenierung.ort.reichweite_parameter = 'ziel'; }, /reichweite_parameter/, 'Reichweite ist ein Zahl-Parameter');
  schlecht((a) => { a.probe_erz.inszenierung.skelett.beats[1].parameter.ware = { aus: 'parameter.gibt_es_nicht' }; }, /nennt keinen Parameter/, 'aus: nennt einen Parameter der Absicht');
  schlecht((a) => { a.probe_erz.inszenierung.skelett.beats[0].tempo = 2; }, /unbekanntes Feld tempo/, 'kein unbekanntes Feld am Beat');
  schlecht((a) => { a.probe_erz.inszenierung.wendungen.hinterhalt.nach = 'gibt_es_nicht'; }, /weder Id noch Typ/, 'Wendung haengt an einem Beat des Skeletts');
  schlecht((a) => { delete a.probe_erz.inszenierung.wendungen.hinterhalt; }, /steht im Katalog \(wendungen\), aber nicht im Rezept/, 'jede Wendung des Katalogs hat ein Rezept');
  schlecht((a) => { a.probe_erz.inszenierung.nicht_ausdrueckbar[0].grund = ' '; }, /nicht_ausdrueckbar/, 'nicht_ausdrueckbar braucht einen Grund');
  schlecht((a) => { a.probe_erz.inszenierung.nicht_ausdrueckbar[0].wenn.parameter = 'gibt_es_nicht'; }, /gibt es bei der Absicht nicht/, 'nicht_ausdrueckbar nennt einen Parameter der Absicht');
  schlecht((a) => { a.probe_stufe.inszenierung.staerke_parameter = 'gibt_es_nicht'; }, /staerke_parameter/, 'Staerke-Parameter ist ein Zahl-Parameter mit Standard');
  schlecht((a) => { a.probe_stufe.inszenierung.skelett.beats[1].verzweigung.gescheitert = 'gibt_es_nicht'; }, /Expander lehnt/, 'der Expander faengt eine falsche Verzweigung (jede Stufe geprueft)');
  schlecht((a) => { a.probe_stufe.inszenierung.skelett.beats[1].typ = 'teleport'; }, /Expander lehnt/, 'der Expander faengt einen unbekannten Beat-Typ');
  schlecht((a) => { delete a.probe_ziel.inszenierung; }, /kein Rezept/, 'jede Absicht hat ein Rezept');
  schlecht((a) => { a.probe_rang.inszenierung.bedingungen[0].rang = 'kaiser'; }, /unbekannten Rang/, 'Rang aus den Daten');
});

section('Erfolg: die Absicht wird ein gueltiger Plan', () => {
  const g = welt(11).g;
  const r = ins(g, ab('probe_erz'));
  ok(r.ok === true && r.hex === '0205', 'Ort: Vulcania 0205, ein Sprung (naechste Hoehle; Gleichstand mit 0405 entscheidet der Hex-Code)');
  ok(typen(r).join() === 'bitte,fracht,abschluss', 'Beat-Folge aus dem Skelett: bitte, fracht, abschluss');
  ok(r.plan.format === 'faden-bauplan/1' && r.plan.titel === TEXT.titel && r.anlass === TEXT.einsatz && r.plan.anlass === TEXT.einsatz && r.titel === TEXT.titel, 'Titel aus der Absicht, Anlass aus dem Einsatz des Bogens');
  ok(r.plan.landeplaetze.length === 1 && r.plan.landeplaetze[0].id === 'ader' && r.plan.landeplaetze[0].art === 'hoehle' && r.plan.landeplaetze[0].name === 'Erzader', 'Landeplatz: die Kartenart der Ortsregel ersetzt den Platzhalter');
  ok(r.plan.beats[0].parameter.landeplatz === 'ader' && r.plan.beats[1].parameter.ware === 'erz', 'Beat-Parameter: Landeplatz und Ware aus dem Parameter der Absicht (aus: parameter.ware)');
  ok(r.bezug === undefined && r.locker === undefined && Array.isArray(r.notizen) && r.notizen.length >= 2 && r.notizen.some((t) => /0205/.test(t)), 'kein bezug und kein locker; die Notizen nennen den Ort');
  const e = Bauplan.expandiere(r.plan), p = Bauplan.pruefe(r.plan);
  ok(e.ok && p.ok && e.vorlage.landeplaetze.length === 1, 'der Plan besteht Expander und Pruefer (faden-bauplan pruefe)');
  const r2 = ins(g, ab('probe_erz', { parameter: { ware: 'fracht_kiste', reichweite: 3 } }));
  ok(r2.ok && r2.plan.beats[1].parameter.ware === 'fracht_kiste' && r2.hex === '0205', 'andere Parameter: andere Ware, derselbe naechste Ort');
  const r3 = ins(g, ab('probe_erz', { bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis } }));
  ok(r3.ok, 'die Wendung keine baut nichts ein');
  const bz = ins(g, ab('probe_ziel', { bezug: { ort: '0405' } }));
  ok(bz.ok && bz.hex === '0405' && typen(bz).join() === 'spur,abschluss', 'Ortsregel bezug_ort: der Sektor des Bezugs (0405, ein Sprung)');
  const bz2 = ins(g, ab('probe_ziel', { bezug: { ort: '0706' } }));
  ok(!bz2.ok && codes(bz2).join() === C.ORT_KEIN_ZIEL && fe(bz2, C.ORT_KEIN_ZIEL).feld === 'bezug.ort', 'bezug_ort ausser Reichweite (0706: ueber offene Sprungpunkte nicht erreichbar): ORT_KEIN_ZIEL');
  const ch = ins(g, ab('probe_rang'));
  ok(!ch.ok && fe(ch, C.WELT_BEDINGUNG), 'Gegenprobe zum Rang (siehe unten): ohne Rang ein Nein');
});

section('Wendung aus dem Bogen', () => {
  const g = welt(11).g;
  const r = ins(g, ab('probe_erz', mitWendung('hinterhalt')));
  ok(r.ok && typen(r).join() === 'bitte,raumschlacht,fracht,abschluss', 'hinterhalt: die Raumschlacht kommt hinter die Bitte (Einfuegestelle nach)');
  ok(r.plan.beats[1].verzweigung.gescheitert === 'ende' && Bauplan.pruefe(r.plan).ok, 'die eingebaute Wendung traegt ihre Verzweigung und der Plan besteht den Pruefer');
  ok(r.notizen.some((t) => /Wendung hinterhalt/.test(t)), 'die Notizen nennen die Wendung');
  const s = ins(g, ab('probe_stufe', mitWendung('verfolgung')));
  ok(s.ok && typen(s).join() === 'konvoi,verfolgung,abschluss', 'Einfuegestelle nach dem Typ des Skeletts (konvoi): verfolgung dahinter');
  const u = ins(g, ab('probe_erz', mitWendung('verfolgung')));
  ok(!u.ok && codes(u).join() === C.BOGEN_UNVOLLSTAENDIG, 'eine Wendung, die der Katalog nicht listet, lehnt schon der Pruefer von Paket A ab');
  const k = mitKatalog((a) => { delete a.probe_erz.wendungen; });
  const w = ins(g, ab('probe_erz', mitWendung('verfolgung')), k);
  ok(!w.ok && codes(w).join() === C.WENDUNG_UNMOEGLICH && w.fehler[0].gegenvorschlag.patch[0].feld === 'bogen.wendung', 'listet der Katalog keine Wendungen, kennt aber das Rezept eine: das Symbol gilt, hier die unbekannte -> WENDUNG_UNMOEGLICH mit Vorschlag');
});

section('Ort fern: Nein mit Gegenvorschlag, der angenommene Patch geht durch', () => {
  const g = welt(11).g;
  const e = ins(g, ab('probe_erz', { parameter: { reichweite: 0 } }));
  ok(!e.ok && e.fehler.length === 1 && e.fehler[0].code === C.ORT_KEIN_ZIEL && e.fehler[0].feld === 'parameter.reichweite', 'reichweite 0 bei Ostia Nova (nur Schiff und Station): ORT_KEIN_ZIEL');
  ok(/hoehle/.test(e.fehler[0].grund) && /Vulcania/.test(e.fehler[0].grund) && /Ostia Nova/.test(e.fehler[0].grund), 'der Grund nennt Kartenart, die Crew und den naechsten Sektor');
  const gv = e.fehler[0].gegenvorschlag;
  ok(gv && gv.patch.length === 1 && gv.patch[0].feld === 'parameter.reichweite' && gv.patch[0].wert === 1 && /Vulcania/.test(gv.text), 'Gegenvorschlag: reichweite 1 (Patch) mit Klartext');
  ok(JSON.stringify(AP.gegenvorschlagPatch(e)) === JSON.stringify(gv.patch) && /ORT_KEIN_ZIEL/.test(AP.fehlerText(e, KAT)), 'das Format ist das von Paket A: gegenvorschlagPatch und fehlerText arbeiten damit');
  const patchen = AP.wendePatchAn(ab('probe_erz', { parameter: { reichweite: 0 } }), gv.patch);
  const r = patchen.ok ? ins(g, patchen.absicht) : null;
  ok(patchen.ok && r.ok && r.hex === '0205', 'der angenommene Patch: die Absicht geht durch (Ort 0205)');
  // Verhandlung (Paket A) ruft nur den Pruefer: der Inszenierer-Fehler geht ueber seinen eigenen Patch, nicht ueber verhandlungAntwort
  const e2 = ins(g, ab('probe_erz', { parameter: { reichweite: 1 } }));
  ok(e2.ok, 'reichweite 1 genuegt bis Vulcania');
  const k = mitKatalog((a) => { a.probe_erz.parameter.reichweite.max = 0; a.probe_erz.parameter.reichweite.standard = 0; });
  const e3 = ins(g, ab('probe_erz'), k);
  ok(!e3.ok && e3.fehler[0].code === C.ORT_KEIN_ZIEL && !e3.fehler[0].gegenvorschlag && /Vulcania/.test(e3.fehler[0].grund), 'liegt der naechste Ort ausserhalb dessen, was der Parameter erlaubt: Nein ohne Patch, der Grund nennt ihn trotzdem');
  const w = require('../content/faeden/inszenierer-werte.json').werte;
  ok(w.reichweite_max.wert === 8, 'Suchtiefe 8 Sprunge aus den Daten');
  const k2 = mitKatalog((a) => { a.probe_erz.inszenierung.ort.kartenart = 'aussenposten'; a.probe_erz.parameter.reichweite.max = 3; });
  const e4 = ins(g, ab('probe_erz', { parameter: { reichweite: 2 } }), k2);
  ok(!e4.ok && e4.fehler[0].code === C.ORT_KEIN_ZIEL && !e4.fehler[0].gegenvorschlag, 'Aussenposten gibt es erst bei vier Spruengen (0705): bei Reichweite 2 Nein, und vier ist ausserhalb des Parameters: kein Patch');
});

section('Verhandlung mit dem Inszenierer als Pruefer (absicht-verhandlung.js, SPL-02 C0)', () => {
  const g = welt(11).g;
  const V = require('../server/sim/absicht-verhandlung.js');
  const nein0 = ab('probe_erz', { parameter: { reichweite: 0 } });
  const v = V.verhandlungStart(g, nein0, KAT);
  ok(v.stand === 'offen' && v.runde === 0 && v.runden_max === ECHT.werte.runden_max.wert && v.runden_max === 1, 'ORT_KEIN_ZIEL: offen, runden_max aus den Daten (1)');
  ok(/ORT_KEIN_ZIEL/.test(v.text) && /Vulcania/.test(v.text) && /Vorschlag/.test(v.text) && /Patch:/.test(v.text) && /Antworte einmal/.test(v.text), 'der Klartext nennt Code, Grund, Gegenvorschlag und den Patch');
  ok(v.ergebnis.fehler[0].code === C.ORT_KEIN_ZIEL && !v.inszenierung, 'das Nein ist das des Inszenierers (Absichts-Pruefer als erste Stufe war ok)');
  const patch = AP.gegenvorschlagPatch(v.ergebnis);
  const v2 = V.verhandlungAntwort(g, v, patch, KAT);
  ok(v2.stand === 'angenommen' && v2.runde === 1 && v2.inszenierung && v2.inszenierung.ok && v2.inszenierung.hex === '0205', 'Antwort-Patch: angenommen, `inszeniere` ist ok (Ort 0205)');
  ok(JSON.stringify(v2.inszenierung.plan) === JSON.stringify(ins(g, v2.absicht).plan), 'der Plan der Verhandlung ist der Plan von inszeniere');
  ok(V.verhandlungAntwort(g, v2, [{ feld: 'parameter.reichweite', wert: 0 }], KAT) === v2, 'angenommen ist endgueltig');
  const v3 = V.verhandlungAntwort(g, v, [{ feld: 'parameter.reichweite', wert: 0 }], KAT);
  ok(v3.stand === 'abgelehnt' && v3.runde === 1 && /^Endgueltig abgelehnt/.test(v3.text) && /ORT_KEIN_ZIEL/.test(v3.text) && /Vulcania/.test(v3.text), 'zweite Ablehnung: endgueltig, mit Grund');
  ok(V.verhandlungAntwort(g, v3, patch, KAT) === v3, 'abgelehnt ist endgueltig, auch eine spaetere Antwort aendert nichts');
  const v4 = V.verhandlungAntwort(g, v, { format: 'absicht/1', absicht: 'probe_erz', titel: TEXT.titel, parameter: { reichweite: 1 }, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, KAT);
  ok(v4.stand === 'angenommen' && v4.inszenierung.hex === '0205', 'auch eine korrigierte Absicht statt des Patches gilt');
  ok(V.verhandlungAntwort(g, v, 'ja', KAT).stand === 'abgelehnt', 'eine Antwort ohne Patch und ohne Absicht: abgelehnt');
  // erste Stufe (Pruefer aus A) und zweite Stufe laufen in EINER Runde: ein Parameterfehler wird geflickt, dann sagt die Welt nein -> endgueltig (eine Runde)
  const doppelt = V.verhandlungStart(g, ab('probe_erz', { parameter: { reichweite: 9 } }), KAT);
  ok(doppelt.stand === 'offen' && doppelt.ergebnis.fehler[0].code === C.PARAMETER, 'Stufe 1: Parameter ausserhalb: offen');
  const d2 = V.verhandlungAntwort(g, doppelt, [{ feld: 'parameter.reichweite', wert: 0 }], KAT);
  ok(d2.stand === 'abgelehnt' && /ORT_KEIN_ZIEL/.test(d2.text), 'der Patch heilt Stufe 1, Stufe 2 sagt nein: die eine Runde ist verbraucht, endgueltig abgelehnt');
  const k0 = klon(KAT); k0.werte.runden_max.wert = 0;
  const n0 = V.verhandlungStart(g, nein0, k0);
  ok(n0.stand === 'abgelehnt' && /^Endgueltig abgelehnt/.test(n0.text) && /ORT_KEIN_ZIEL/.test(n0.text), 'runden_max 0 (Datenwert): sofort endgueltig abgelehnt mit Grund');
  const k2 = klon(KAT); k2.werte.runden_max.wert = 2;
  const m1 = V.verhandlungStart(g, nein0, k2);
  const m2 = V.verhandlungAntwort(g, m1, [{ feld: 'parameter.reichweite', wert: 0 }], k2);
  ok(m2.stand === 'offen' && m2.runde === 1 && /ORT_KEIN_ZIEL/.test(m2.text) && V.verhandlungAntwort(g, m2, patch, k2).stand === 'angenommen', 'runden_max 2 (Datenwert): die zweite Antwort darf noch heilen');
  const gut1 = V.verhandlungStart(g, ab('probe_erz', { parameter: { reichweite: 1 } }), KAT);
  ok(gut1.stand === 'angenommen' && gut1.runde === 0 && gut1.inszenierung.ok, 'eine gute Absicht ist ohne Runde angenommen');
  const unb = V.verhandlungStart(g, ab('probe_nirgendwo'), KAT);
  ok(unb.stand === 'offen' && unb.ergebnis.fehler[0].code === C.ABSICHT_UNBEKANNT, 'ein Nein des Absichts-Pruefers geht durch dieselbe Verhandlung (ABSICHT_UNBEKANNT)');
  const ap = AP.verhandlungStart(g, nein0, KAT);
  ok(ap.stand === 'angenommen', 'die Verhandlung aus A (nur Stufe 1) bleibt unveraendert: sie sieht das Nein der Welt nicht');
});

section('Bezug unbekannt und Bezug, den der Plan nicht tragen kann', () => {
  const t = welt(11), g = t.g;
  const [q, ti, ga] = t.f;
  verstimmt(q); verstimmt(ti, -2); verstimmt(ga);
  const unbek = ins(g, ab('probe_stellung', { bezug: { nsc: 'Gaius Nirgendwo' } }));
  ok(!unbek.ok && fe(unbek, C.BEZUG_UNBEKANNT), 'ein NSC, den die Welt nicht kennt: BEZUG_UNBEKANNT (Pruefer von Paket A)');
  const vorname = ins(g, ab('probe_stellung', { bezug: { nsc: 'Quintus' } }));
  ok(!vorname.ok && /BEZUG/.test(codes(vorname).join()), 'der Vorname allein gilt nicht');
  const fehlt = ins(g, ab('probe_stellung'));
  ok(!fehlt.ok && fe(fehlt, C.BEZUG_FEHLT), 'Pflichtbezug fehlt: BEZUG_FEHLT');
  // Titus ist verbuendet: der Pruefer der Ffixture-Absicht nimmt ihn als Kandidaten (Wiedersehen), der Plan (rache) aber nicht (Zustand feindlich, aktiv, geflohen)
  ti.nsc.status = 'verbuendet';
  mitRache(() => {
    const r = ins(g, ab('probe_stellung', { bezug: { nsc: 'Titus Calder' } }));
    ok(!r.ok && codes(r).join() === C.BEZUG_UNBEKANNT && r.fehler[0].feld === 'bezug.nsc' && /Kandidat/.test(r.fehler[0].grund), 'der NSC passt nicht zum ersten Beat des Plans (Zustand): BEZUG_UNBEKANNT aus der Vorab-Pruefung');
    ok(r.fehler[0].gegenvorschlag && r.fehler[0].gegenvorschlag.patch[0].wert === 'Gaius Fabrin', 'Gegenvorschlag: ein Kandidat dieses Plans (der juengste, Gaius Fabrin: die Absicht ist eine Fortsetzung, die Hauptfigur des letzten Abenteuers zaehlt)');
    const p = AP.wendePatchAn(ab('probe_stellung', { bezug: { nsc: 'Titus Calder' } }), r.fehler[0].gegenvorschlag.patch);
    ok(p.ok && ins(g, p.absicht).ok, 'der angenommene Patch geht durch');
  });
});

section('Weltbedingungen: Haltung, Rang, Lage', () => {
  const t = welt(11), g = t.g;
  const [q, ti, ga] = t.f;
  mitRache(() => {
    verstimmt(q, 1);
    const r = ins(g, ab('probe_stellung', { bezug: { nsc: 'Quintus Varro' } }));
    ok(!r.ok && codes(r).join() === C.WELT_BEDINGUNG && /Haltung 1/.test(r.fehler[0].grund) && /wohlgesinnt/.test(r.fehler[0].grund), 'Haltung zu gut fuer eine Stellung: WELT_BEDINGUNG mit dem Grund aus dem Rezept');
    verstimmt(q, -2);
    const r2 = ins(g, ab('probe_stellung', { bezug: { nsc: 'Quintus Varro' } }));
    ok(r2.ok, 'Haltung -2: die Bedingung ist erfuellt');
  });
  const rang = ins(g, ab('probe_rang'));
  ok(!rang.ok && codes(rang).join() === C.WELT_BEDINGUNG && /centurio/.test(rang.fehler[0].grund), 'Rang miles: ein Auftrag fuer centurio ist WELT_BEDINGUNG');
  ruf(g, 35);
  const rang2 = ins(g, ab('probe_rang'));
  ok(rang2.ok && rang2.notizen[0] === 'Stufe 1 (Welt 1)', 'Rang centurio (Ruf 35 bei Rom): erlaubt, und die Stufe der Welt steigt auf 1');
  ruf(g, 0);
  // Lage: der Beat des Plans braucht ein Ziel, die Crew darf noch nicht angreifen (Rang): der Plan selbst sagt Nein, nicht der Inszenierer
  const lage = ins(g, ab('probe_posten'));
  ok(!lage.ok && codes(lage).join() === C.WELT_BEDINGUNG && /LAGE_ZIEL_FEHLT/.test(lage.fehler[0].grund), 'Lage ohne Ziel: WELT_BEDINGUNG mit dem Grund der Lage (Vorab-Pruefung des Plans)');
  // Landeplatz: die Art geht am Ort der Crew nicht
  const tor = ins(g, ab('probe_tor'));
  ok(!tor.ok && codes(tor).join() === C.ORT_LANDEPLATZ && /hoehle/.test(tor.fehler[0].grund) && /0305/.test(tor.fehler[0].grund), 'Kartenart am Ort unmoeglich (Hoehle bei Ostia Nova): ORT_LANDEPLATZ');
  // Wiederholung: derselbe Plan noch einmal auf dem Brett
  const a1 = INS.anbietenAusAbsicht(g, ab('probe_erz'), KAT);
  const a2 = ins(g, ab('probe_erz'));
  ok(a1.ok && !a2.ok && codes(a2).join() === C.WELT_BEDINGUNG && /WIEDERHOLUNG_FOLGE/.test(a2.fehler[0].grund), 'dieselbe Folge liegt schon auf dem Brett: WELT_BEDINGUNG (Wiederholungsregel des Bretts, hier schon beim Inszenieren)');
  const a3 = ins(g, ab('probe_erz', mitWendung('hinterhalt')));
  ok(a3.ok, 'eine andere Folge (mit der Wendung) ist keine Wiederholung');
});

section('Staerke und Stufe: Rang und Schiff waehlen die Beats, der Wunsch der Absicht ist begrenzt', () => {
  const g = welt(11).g;
  const bauen = (o) => ins(g, ab('probe_stufe', o));
  const folge = (r) => typen(r).join();
  const sieg = (r) => r.plan.beats[0].parameter.sieg;
  let r = bauen();
  ok(r.ok && folge(r) === 'konvoi,abschluss' && sieg(r) === 'aufhalten' && /Stufe 0/.test(r.notizen[0]), 'Rang miles, Schiff 0: Stufe 0, nur der Konvoi (aufhalten)');
  ruf(g, 35);
  r = bauen();
  ok(r.ok && folge(r) === 'konvoi,raumschlacht,abschluss' && sieg(r) === 'aufhalten' && /Stufe 1/.test(r.notizen[0]), 'Rang centurio: Stufe 1, eine Raumschlacht dahinter');
  g.ship.stufe = 2;
  r = bauen();
  ok(r.ok && folge(r) === 'konvoi,raumschlacht,raumschlacht,abschluss' && sieg(r) === 'pluendern' && /Stufe 2/.test(r.notizen[0]), 'Rang centurio, Ausbaustufe 2 des Schiffs (+1): Stufe 2, zwei Schlachten, Parameter nach_stufe waehlt pluendern');
  ruf(g, 200); g.ship.stufe = 3;
  r = bauen();
  ok(r.ok && /Stufe 2/.test(r.notizen[0]) && folge(r).split(',').length === 4, 'Rang legat und Schiff 3: auf stufe_max (2) begrenzt');
  const eng = ins(g, ab('probe_stufe'), mitKatalog((x) => { x.probe_stufe.inszenierung.stufe_max = 1; }));
  ok(eng.ok && /Stufe 1/.test(eng.notizen[0]) && folge(eng) === 'konvoi,raumschlacht,abschluss', 'stufe_max des Rezepts (1) begrenzt die Welt (Stufe 2) auf 1: nur eine Schlacht');
  r = bauen({ parameter: { staerke: 0 } });
  ok(r.ok && folge(r) === 'konvoi,abschluss' && /gewuenscht 0/.test(r.notizen[0]), 'ein Wunsch nach Stufe 0 ist immer erlaubt (leichter als die Welt)');
  ruf(g, 0); g.ship.stufe = 0;
  r = bauen({ parameter: { staerke: 3 } });
  const f3 = r.ok ? null : fe(r, C.STAERKE_UNMOEGLICH);
  ok(!r.ok && codes(r).join() === C.STAERKE_UNMOEGLICH && /Welt traegt hoechstens Stufe 1/.test(f3.grund) && f3.gegenvorschlag.patch[0].wert === 1, 'Wunsch Stufe 3 bei Welt 0 (Spielraum 1): STAERKE_UNMOEGLICH, Gegenvorschlag Stufe 1');
  const p = AP.wendePatchAn(ab('probe_stufe', { parameter: { staerke: 3 } }), f3.gegenvorschlag.patch);
  const r1 = p.ok ? ins(g, p.absicht) : null;
  ok(p.ok && r1.ok && folge(r1) === 'konvoi,raumschlacht,abschluss', 'der angenommene Patch: Stufe 1, eine Schlacht mehr als ohne Wunsch');
  ruf(g, 200); g.ship.stufe = 3;
  r = bauen({ parameter: { staerke: 3 } });
  ok(!r.ok && /Rezept dieser Absicht kennt nur Stufen bis 2/.test(r.fehler[0].grund) && r.fehler[0].gegenvorschlag.patch[0].wert === 2, 'auch bei starker Welt ist die Stufe des Rezepts die Grenze (Nein, Vorschlag 2)');
  // Crewgroesse: die Zahl der Gegner einer Szene richtet der Beat-Katalog nach den Spielern (szenen-werte.json), nicht der Inszenierer
  ok(INS.weltStufe(g) === 2, 'weltStufe: Rang legat und Schiff 3 ergeben stufe_max');
  ruf(g, 0); g.ship.stufe = 0;
  ok(INS.weltStufe(g) === 0, 'weltStufe: Rang miles, Schiff 0 ergeben 0');
});

section('Nicht ausdrueckbar: ein ehrliches Nein, kein Sonderfall im Code', () => {
  const g = welt(11).g;
  const r = ins(g, ab('probe_erz', { parameter: { ziel: 'abbau' } }));
  ok(!r.ok && r.fehler.length === 1 && r.fehler[0].code === C.NICHT_AUSDRUECKBAR && r.fehler[0].feld === 'parameter.ziel' && /Abbau-Beat/.test(r.fehler[0].grund), 'Ziel abbau: NICHT_AUSDRUECKBAR, Grund "kein Abbau-Beat"');
  const p = AP.wendePatchAn(ab('probe_erz', { parameter: { ziel: 'abbau' } }), r.fehler[0].gegenvorschlag.patch);
  ok(p.ok && p.absicht.parameter.ziel === 'kulisse' && ins(g, p.absicht).ok, 'Gegenvorschlag: Ziel kulisse, der angenommene Patch geht durch');
  const k = mitKatalog((a) => { a.probe_erz.inszenierung.nicht_ausdrueckbar = [{ wenn: { immer: true }, grund: 'der Katalog kennt noch keinen Weg dafuer' }]; });
  const i = ins(g, ab('probe_erz'), k);
  ok(!i.ok && i.fehler[0].code === C.NICHT_AUSDRUECKBAR && !i.fehler[0].gegenvorschlag && i.fehler[0].feld === 'absicht', 'immer: eine Huelle ohne Weg, Nein ohne Patch');
  const k2 = mitKatalog((a) => { a.probe_erz.inszenierung.nicht_ausdrueckbar = [{ wenn: { bogen: 'wendung', ist: 'hinterhalt' }, grund: 'keine Wendung mit Kampf an der Ader moeglich' }, { wenn: { ton: 'bitter' }, grund: 'der Ton bitter hat keinen Text' }]; });
  const b = ins(g, ab('probe_erz', mitWendung('hinterhalt')), k2), t2 = ins(g, ab('probe_erz', { ton: 'bitter' }), k2), c2 = ins(g, ab('probe_erz'), k2);
  ok(!b.ok && b.fehler[0].feld === 'bogen.wendung' && !t2.ok && t2.fehler[0].feld === 'ton' && c2.ok, 'wenn: bogen und ton; ohne Treffer geht die Absicht durch');
  const zwei = ins(g, ab('probe_erz', { parameter: { ziel: 'abbau' }, ton: 'bitter' }), k2);
  ok(!zwei.ok && codes(zwei).join() === C.NICHT_AUSDRUECKBAR, 'mehrere Treffer: alle als Fehler in einer Antwort (hier einer, ziel)');
  const ohneRezept = Object.assign({}, KAT, { absichten: { probe_ohne: { zweck: 'Absicht ohne Rezept im Katalog (Fixture)', parameter: {} } } });
  const o = ins(g, ab('probe_ohne'), ohneRezept);
  ok(!o.ok && codes(o).join() === C.REZEPT_FEHLT, 'eine Absicht ohne Rezept: REZEPT_FEHLT');
  ok(INS.katalogFehler(ohneRezept).some((t) => /kein Rezept/.test(t)), 'und katalogFehler meldet sie');
});

section('Rache: ein feindlicher NSC als Start (Daten, durch das ganze Spiel)', () => {
  const t = welt(11), g = t.g;
  const [q, ti, ga] = t.f;
  verstimmt(q); verstimmt(ga);
  const ohne = ohneRache(() => ins(g, ab('probe_stellung', { bezug: { nsc: 'Quintus Varro' } })));
  ok(!ohne.ok && codes(ohne).join() === C.PLAN_ABGELEHNT && /TYP_UNBEKANNT/.test(ohne.fehler[0].grund), 'ohne die Zeile rache im Beat-Katalog: PLAN_ABGELEHNT (TYP_UNBEKANNT), kein kaputter Plan');
  mitRache(() => {
    const r = ins(g, ab('probe_stellung', { bezug: { nsc: 'Quintus Varro' } }));
    ok(r.ok && typen(r).join() === 'rache,abschluss' && r.bezug.nsc === 'Quintus Varro' && r.locker === true && r.hex === '0305', 'Stellung: rache, abschluss am Ort der Crew, bezug = Quintus Varro, locker (Fortsetzung)');
    ok(Bauplan.pruefe(r.plan).ok && Bauplan.expandiere(r.plan).vorlage.nsc.status === 'feindlich', 'der Plan besteht Expander und Pruefer; die Vorlage startet den NSC feindlich');
    const w = ins(g, ab('probe_stellung', Object.assign({ bezug: { nsc: 'Quintus Varro' } }, mitWendung('verfolgung'))));
    ok(w.ok && typen(w).join() === 'rache,verfolgung,abschluss', 'Wendung verfolgung: rache, verfolgung, abschluss');
    // Hauptfigur des letzten Abenteuers: nur als Fortsetzung (locker)
    const fo = ins(g, ab('probe_stellung', { bezug: { nsc: 'Gaius Fabrin' } }));
    ok(fo.ok && fo.locker === true, 'die Hauptfigur des letzten Abenteuers (Gaius Fabrin): als Fortsetzung erlaubt (locker)');
    const streng = mitKatalog((a) => { a.probe_stellung.fortsetzung = false; });
    const zf = ins(g, ab('probe_stellung', { bezug: { nsc: 'Gaius Fabrin' } }), streng);
    ok(!zf.ok && codes(zf).join() === C.BEZUG_ZU_FRISCH && zf.fehler[0].gegenvorschlag.patch[0].wert === 'Quintus Varro', 'ohne fortsetzung: BEZUG_ZU_FRISCH, Vorschlag ein frischer NSC (Quintus Varro)');
    // durch das Spiel: Angebot, Oeffnen mit dem NSC, Szene
    const an = INS.anbietenAusAbsicht(g, ab('probe_stellung', { bezug: { nsc: 'Gaius Fabrin' } }), KAT);
    ok(an.ok && an.angebot.bezug.nsc === 'Gaius Fabrin' && an.angebot.locker === true && an.angebot.hex === '0305', 'Angebot am Brett: bezug und locker (Fortsetzung)');
    const kand = Faden.wiedersehenKandidaten(g, an.angebot.vorlage);
    const id = kand.find((x) => Faden.nscVon(g, x).name === 'Gaius Fabrin');
    const o = Faden.abenteuerOeffnen(g, an.angebot.nr, { nsc_von: id });
    ok(o.ok && o.faden.nsc.name === 'Gaius Fabrin' && o.faden.nsc.status === 'feindlich' && o.faden.nsc.haltung === -2, 'geoeffnet: derselbe NSC kehrt zurueck, Zustand feindlich, Haltung bleibt');
    // der Beat laeuft als Szene (Raumschlacht): Vorwarnung, Gegner
    const funk = []; const orig = g.emit.bind(g); g.emit = (k, d) => { if (k === 'radio' && d && d.text) funk.push(d.text); return orig(k, d); };
    for (let i = 0; i < 5; i++) g.lageGrenze('andocken');
    const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0;
    Space.enterScene(g, Sektoren.ortVonHex('0305'), {});
    const wr = Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: o.faden.id, beat: D.vorlage(o.faden.vorlage).beats[0].id });
    for (let i = 0; i < Math.round(14 * CONFIG.tickHz); i++) g.step();
    ok(wr.ok && g.fadenSzene && g.fadenSzene.art === 'raumschlacht' && g.space.enemies.length > 0 && funk.some((x) => /germanische Schiffe/.test(x)), 'der Beat startet die Szene der Raumschlacht (Vorwarnung, Gegner): die Fadenmaschine braucht dafuer keine Codeaenderung');
  });
});

section('Anbieten ueber das Brett', () => {
  const t = welt(11), g = t.g, F0 = zust(g);
  const r = INS.anbietenAusAbsicht(g, ab('probe_erz', mitWendung('hinterhalt')), KAT);
  ok(r.ok && F0.abenteuerAngebote.length === 1 && r.angebot === F0.abenteuerAngebote[0] && r.angebot.hex === '0205', 'ok: genau ein Angebot am Brett, am Ort des Inszenierers (0205)');
  ok(r.angebot.bezug === undefined && r.angebot.locker === undefined && r.inszenierung.ok && r.inszenierung.plan.beats.length === 4, 'ohne Bezug und Fortsetzung tragen weder Angebot noch Ergebnis bezug oder locker');
  const n = INS.anbietenAusAbsicht(g, ab('probe_erz', { parameter: { reichweite: 0 } }), KAT);
  ok(!n.ok && codes(n).join() === C.ORT_KEIN_ZIEL && F0.abenteuerAngebote.length === 1, 'ein Nein des Inszenierers kommt unveraendert zurueck, es entsteht kein weiteres Angebot');
  const unb = INS.anbietenAusAbsicht(g, ab('gibt_es_nicht'), KAT);
  ok(!unb.ok && codes(unb).join() === C.ABSICHT_UNBEKANNT, 'eine unbekannte Absicht: Fehler des Pruefers von Paket A');
  const orig = Brett.neuAnbieten;
  try {
    F0.abenteuerAngebote.length = 0;   // das Brett ist leer: die Vorab-Pruefung (Wiederholung) soll das Nein nicht schon fangen
    Brett.neuAnbieten = () => ({ ok: false, grund: 'ABENTEUER_ANGEBOTE: hoechstens 3 offene Abenteuer-Angebote', fehler: ['x'] });
    const v = INS.anbietenAusAbsicht(g, ab('probe_erz', mitWendung('hinterhalt')), KAT);
    ok(!v.ok && v.fehler[0].code === C.ANGEBOT_ABGELEHNT && /ABENTEUER_ANGEBOTE/.test(v.fehler[0].grund), 'lehnt das Brett ab, ist es ANGEBOT_ABGELEHNT mit dem Grund des Bretts');
    let arg = null;
    Brett.neuAnbieten = (game, p, o) => { arg = o; return { ok: true, angebot: {} }; };
    mitRache(() => { verstimmt(t.f[0]); INS.anbietenAusAbsicht(g, ab('probe_stellung', { bezug: { nsc: 'Quintus Varro' } }), KAT); });
    ok(arg && arg.hex === '0305' && arg.bezug.nsc === 'Quintus Varro' && arg.locker === true, 'die Anbindung ruft Brett.neuAnbieten mit hex, bezug und locker (aus fortsetzung der Absicht)');
  } finally { Brett.neuAnbieten = orig; }
});

section('Determinismus', () => {
  const a = welt(11), b = welt(11), c = welt(12);
  const x1 = ins(a.g, ab('probe_erz', mitWendung('hinterhalt'))), x2 = ins(a.g, ab('probe_erz', mitWendung('hinterhalt'))), y = ins(b.g, ab('probe_erz', mitWendung('hinterhalt')));
  ok(JSON.stringify(x1) === JSON.stringify(x2), 'gleiche Eingabe, gleiche Welt: dasselbe Ergebnis, zweimal');
  ok(JSON.stringify(x1) === JSON.stringify(y), 'gleiche Eingabe, gleicher Seed in einem frischen Spiel: dasselbe Ergebnis');
  const z = ins(c.g, ab('probe_erz', mitWendung('hinterhalt')));
  ok(z.ok && z.hex === x1.hex && JSON.stringify(z.plan) === JSON.stringify(x1.plan), 'andere Seed, gleiche Lage der Karte: derselbe Plan (der Inszenierer wuerfelt nie)');
  const eingabe = ab('probe_erz', mitWendung('hinterhalt')), kopie = klon(eingabe), katKopie = klon(KAT);
  ins(a.g, eingabe);
  ok(JSON.stringify(eingabe) === JSON.stringify(kopie) && JSON.stringify(KAT) === JSON.stringify(katKopie), 'die Eingabe und der Katalog bleiben unveraendert');
});

section('Quelltext: kein Absichtsname, kein Beat-Typ, keine Zahl', () => {
  const src = ['inszenierer.js', 'absicht-verhandlung.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', f), 'utf8')).join('\n');   // auch die Verhandlung (SPL-02 C0)
  const namen = new Set([].concat(Object.keys(FIX.absichten), Object.keys(ECHT.absichten), ['bergbau', 'rache', 'rettung', 'forderung', 'hinterhalt', 'schmuggel', 'handel']));
  const quoted = (w) => new RegExp('[\'"`]' + w + '[\'"`]').test(src);
  const treffer = Array.from(namen).filter(quoted);
  ok(treffer.length === 0, 'kein Absichtsname als Zeichenkette im Code (geprueft: ' + namen.size + ' Namen' + (treffer.length ? '; Treffer: ' + treffer.join(', ') : '') + ')');
  const beatTypen = Object.keys(D.BEATS);
  const bt = beatTypen.filter(quoted);
  ok(bt.length === 0, 'kein Beat-Typ als Zeichenkette im Code (geprueft: ' + beatTypen.length + (bt.length ? '; Treffer: ' + bt.join(', ') : '') + ')');
  const kartenarten = require('../server/sim/abenteuer-orte.js').DATEN.arten.filter(quoted);
  ok(kartenarten.length === 0, 'keine Kartenart als Zeichenkette im Code');
  const code = src.split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n').replace(/\/\/.*$/gm, '');
  const zahlen = (code.match(/(?<![\w.$'"-])\d+(?![\w.'"])/g) || []).filter((z) => !['0', '1', '2'].includes(z));
  ok(zahlen.length === 0, 'keine Zahl im Code ausser 0, 1 und 2 (Index, Schritt) (Treffer: ' + zahlen.join(', ') + ')');
  ok(/faden-bauplan.js|faden-pruefer.js/.test(src) && !/require\('\.\/faden\.js'\)\.(abenteuerNeuAnbieten|abenteuerAnbieten|oeffnen)/.test(src), 'der Inszenierer nutzt Expander und Pruefer und legt Angebote nur ueber das Brett an');
});

// ======================================================================
for (const [name, fn] of abschnitte) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
  console.log('\n== ' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
console.log(`\n${n - fails}/${n} gruen`);
process.exit(fails ? 1 : 0);
