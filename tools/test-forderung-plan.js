'use strict';
// BEA-01 C2: die Beats forderung und schmiergeld sind PLANBAR (Expander), die Absicht `forderung` steht im Katalog (Inszenierer), die Prompt-Grenzen tragen, und `forderung` laeuft ohne die Schmuggel-Vorlage
// (Vorlage zollkontrolle). Die Erwartungen stehen hier selbst (Daten gelesen, nie aus dem Produktivcode abgeleitet).
//   (a) Daten: bauplan-Abschnitte, Katalog-Eigenschaft braucht_ware, Prompt-Katalog (verborgene Parameter), Grenzen
//   (b) Expander und Pruefer: ein Plan mit Zollkontrolle (forderung art durchsuchung, schmiergeld, raumschlacht) wird gebaut und angenommen; unsinnige Plaene bekommen klare Codes
//       (art ware im Plan, ende im Plan, sim_befehl im Plan, unbekannte Tiefe, Staerke, Text, Optionen, Weg)
//   (c) braucht_ware: die Forderung der Ware ohne Ware am Faden (Notsprung in der Wartezeit, Ladung weg) endet sofort gescheitert mit Funk; mit Ware und in der Durchsuchung laeuft sie weiter
//   (d) Inszenierer: die Absicht forderung baut einen gueltigen Plan (Stufen nach Rang und Schiff); Nein mit Grund bei leerem Frachtraum und bei zu niedrigem Rang (ohne Gegenvorschlag)
//   (e) Mock-Lauf im Absichten-Modus (ABENTEUER_ABSICHTEN=1): die Absicht erscheint unter den gewaehlten, der Plan ist gueltig, im leeren Frachtraum ein Nein
//   (f) Bausteine einzeln: die Vorlage zollkontrolle (ohne Haendler, ohne Ware, ohne Enthuellung/Invasion) und der Plan der Absicht laufen durch alle Wege
//   (g) Kein Beat- oder Absichtsname im Servercode
// Aufruf: node tools/test-forderung-plan.js [begriff ...]        (npm run test:forderung-plan)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Faden = require('../server/sim/faden.js');
const Lager = require('../server/sim/fracht.js');
const Fracht = require('../server/sim/faden-fracht.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Baustein = require('../server/sim/faden-forderung.js');
const Bauplan = require('../server/sim/faden-bauplan.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');
const Absicht = require('../server/sim/abenteuer-absicht.js');
const AM = require('../server/sim/abenteuer-mock.js');
const AV = require('../server/sim/absicht-verhandlung.js');
const INS = require('../server/sim/inszenierer.js');
const AP = require('../server/sim/absicht-pruefer.js');
const Weltstand = require('../server/weltstand.js');
const Geld = require('../server/sim/geld.js');
const Ruf = require('../server/sim/ruf.js');
const Modul = require('../server/sim/module.js');
const Ausbau = require('../server/sim/ausbau.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const X = require('./faden-fixture.js');
const { D, F, spiel, oeffne, grenzen, alsVorlage, registriere } = X;

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
async function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { await fn(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); }
}
const lies = (...p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const BEATS = lies('content', 'faeden', 'beats.json').beats;
const KAT = lies('content', 'faeden', 'absichten.json');
const TEXTE = lies('content', 'faeden', 'forderung-texte.json');
const WERTE = lies('content', 'faeden', 'forderung-werte.json').werte;
const AW = lies('content', 'welt', 'abenteuer-werte.json').werte;
const SZ = lies('content', 'faeden', 'szenen-werte.json');
const ZIEL = '0305';
const WEG = (status, weiter) => ({ status, weiter });
const codes = (r) => r.codes || r.fehler.map((x) => String(x).split(':')[0]);
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

// ---------------------------------------------------------------- Hilfen: Spiel
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const starteBeat = (x) => { grenzen(x.g, 5); return weiter(x.g, x.f); };
const angebot = (g) => Bitte.offen(g);
const antwort = (g, id) => Bitte.beantworten(g, id, angebot(g) ? angebot(g).nr : null);
const marken = (g) => g.inventory.marks;
const lager = (g) => (g.fracht ? g.fracht.lager.length : 0);
const ereignisse = (f) => f.nsc.gedaechtnis.map((e) => e.ereignis);
const beatId = (f) => D.vorlage(f.vorlage).beats[f.beat].id;
function raeume(g) {
  Ausbau.setStufe(g, 3);
  g.ship.module = [1, 2, 3].map((r) => ({ id: 'frachtraum', raum: r, an: true, lauf: true }));
  Modul.verteilungSetzen(g);
  g.fracht.lager = []; g.fracht.draussen = []; g.fracht.halt = null;
}
function bereit(seed, k) {
  const x = spiel({ crew: 1, seed }); const g = x.g;
  const radio = []; const emit = g.emit.bind(g);
  g.emit = (e, d) => { if (e === 'radio' && d && d.text) radio.push({ von: d.from, text: d.text }); return emit(e, d); };
  g.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
  g.space.enemies = []; g.god = true;
  ab(g); ankunft(g, ZIEL);
  raeume(g);
  Geld.standSetzen(g, k === undefined ? 500 : k, 'testmarken');
  Ruf.aendern(g, 'rom', 20 - Ruf.ruf(g, 'rom'));
  return { g, radio, texte: () => radio.map((r) => r.text) };
}
function einlagern(g, art, eig) { const r = Lager.lagerAufnehmen(g, { art, quelle: 'debug', eigenschaften: eig }); if (!r.ok) throw new Error('Einlagern ' + art + ': ' + r.text); }
// Zollkontrolle (Vorlage zollkontrolle, ueber den Notruf-Ausloeser der Daten) bis zum offenen Angebot der Forderung
function amZoll(seed, items, k) {
  const x = bereit(seed, k);
  for (const it of items || []) einlagern(x.g, it.art, it.eig);
  const a = Faden.ausgangMitPerson(x.g, { art: 'notruf', id: 'notruf_zollkontrolle', hex: ZIEL, sprecher: 'S', ausgang: 'gelungen' });
  if (!a) throw new Error('kein Angebot fuer die Vorlage zollkontrolle');
  const r = Faden.befehlAnwenden(x.g, { typ: 'faden_oeffnen', vorlage: 'zollkontrolle', parameter: { angebot: a.nr } });
  if (!r.ok) throw new Error('faden_oeffnen: ' + JSON.stringify(r));
  x.f = r.faden; x.vorher = marken(x.g); x.lager0 = lager(x.g);
  starteBeat(x);
  return x;
}
const OFFEN = { art: 'sprengstoff', eig: { illegal: true } };

// ---------------------------------------------------------------- Hilfen: Plaene
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Zollkontrolle', anlass: 'Ein Zollschiff stellt die Lerche zur Pruefung.', beats }, o || {});
const FO = (p, extra) => Object.assign({ typ: 'forderung', verzweigung: { gescheitert: 'e' } }, p ? { parameter: p } : {}, extra || {});
const SCHMIER = (p) => Object.assign({ typ: 'schmiergeld', verzweigung: { gelungen: 'e' } }, p ? { parameter: p } : {});
const SCHLACHT = { typ: 'raumschlacht', verzweigung: { gescheitert: 'e' } };
const ENDE = { id: 'e', typ: 'abschluss' };
const ZOLLPLAN = () => plan([FO(), SCHMIER(), SCHLACHT, ENDE], { titel: 'Zollkontrolle am Sprungpunkt' });

// ---------------------------------------------------------------- Hilfen: Welt der Absichten
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
function welt(seed, env) {
  const t = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: Object.assign({ FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' }, env || {}) });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  return t;
}
const TEXT = { titel: 'Zollkontrolle am Sprungpunkt', einsatz: 'Ein Zollschiff stellt die Lerche zur Pruefung.', preis: 'Die Pruefung kostet Zeit und vielleicht Geld.' };
const absicht = (o) => Object.assign({ format: 'absicht/1', absicht: 'forderung', titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const stufe = (g, ruf, schiff) => { g.weltsim.ruf.rom = ruf; g.ship.stufe = schiff || 0; };   // 0: Miles, 8: Optio (Stufe 0), 35: Centurio (Stufe 1), 200 und Schiff 3: Stufe 2
const beladen = (g) => { raeume(g); einlagern(g, 'fracht'); };
const folge = (r) => r.plan.beats.map((b) => b.typ).join();

(async () => {
  bereit(1);   // laedt die Sektorendaten wie im Spiel (Ortsnamen)

  // ============================================================== (a)
  await section('(a) Daten: bauplan, braucht_ware, verborgene Parameter, Prompt-Katalog und Grenzen', async () => {
    const f = BEATS.forderung, s = BEATS.schmiergeld;
    ok(typeof f.bauplan === 'object' && typeof s.bauplan === 'object' && f.bauplan.optionen_pflicht === true && s.bauplan.optionen_pflicht === true, 'forderung und schmiergeld haben einen bauplan-Abschnitt (Optionen Pflicht)');
    ok(JSON.stringify(f.bauplan.optionen.map((o) => [o.id, o.ausgang])) === '[["dulden","gescheitert"],["nicht_dulden","gelungen"]]', 'bauplan forderung: Optionen dulden (gescheitert) und nicht_dulden (gelungen)');
    ok(JSON.stringify(s.bauplan.optionen.map((o) => [o.id, o.ausgang])) === '[["bestechen","gelungen"],["verweigern","gescheitert"]]', 'bauplan schmiergeld: Optionen bestechen (gelungen) und verweigern (gescheitert)');
    ok(JSON.stringify(f.bauplan.parameter.art.erlaubt) === '["durchsuchung"]' && f.bauplan.parameter.art.standard === 'durchsuchung', 'im Plan nur die Art durchsuchung (art ware ist ausgeschlossen: ein Plan laedt keine Faden-Ware)');
    ok(JSON.stringify(f.bauplan.parameter.tiefe.erlaubt) === '["voll","scan"]' && JSON.stringify(f.bauplan.parameter.staerke.erlaubt) === '["gering","mittel","stark"]', 'Parameter tiefe (voll | scan) und staerke (gering | mittel | stark)');
    ok(f.art_modi.modi.ware.braucht_ware === true && f.art_modi.modi.durchsuchung.braucht_ware === undefined, 'Katalog: braucht_ware nur in der Art ware, die Durchsuchung braucht keine Ware des Fadens');
    ok(Bauplan.katalogFehler().length === 0 && Baustein.datenFehler().length === 0, 'katalogFehler (Expander) und datenFehler (Baustein) sind leer');
    ok(typeof TEXTE.ware_fehlt === 'string' && TEXTE.ware_fehlt.length > 10 && TEXTE.ware_fehlt.length <= 160, 'forderung-texte.json: Text ware_fehlt (Funk des Forderers, hoechstens 160 Zeichen)');
    ok(typeof TEXTE.texte.durchsuchung_freibeuter.text === 'string' && TEXTE.forderer[TEXTE.texte.durchsuchung_freibeuter.forderer].fraktion === 'ger', 'der Freibeuter fordert die Durchsuchung (Text und Forderer der Daten)');
    const zeile = (t) => Prompt.katalogText().split('\n').find((l) => l.startsWith('- ' + t));
    ok(/Parameter: tiefe \(Standard voll; erlaubt voll \| scan\), staerke \(Standard mittel; erlaubt gering \| mittel \| stark\)\./.test(zeile('forderung')) && /Optionen Pflicht/.test(zeile('forderung')), 'Prompt-Katalog: forderung nennt tiefe und staerke, Optionen Pflicht');
    ok(!/art \(/.test(zeile('forderung')) && !/text_key/.test(zeile('forderung')) && !/text_key/.test(zeile('schmiergeld')), 'Prompt-Katalog: art und text_key sind verborgen (Datenfeld verborgen, spart Zeichen)');
    ok(/Parameter: staerke \(Standard mittel/.test(zeile('schmiergeld')), 'Prompt-Katalog: schmiergeld nennt staerke');
    // Prompt-Grenzen (BEA-01 C2): die Obergrenze des Prompts steht in den Daten, der Katalog haelt, der Luft-Test (test-abenteuer-landeplaetze) bleibt unveraendert
    const katalog = Prompt.katalogText().length;
    ok(AW.prompt_max_zeichen.wert === 15350 && /BEA-01 C2/.test(AW.prompt_max_zeichen._hinweis), 'prompt_max_zeichen 15350 in den Daten, Begruendung im Kommentarfeld');
    ok(katalog > 9443 && katalog <= 13550, 'der Beat-Katalog (' + katalog + ' Zeichen) liegt ueber den 9443 von vorher und unter der Test-Grenze 13550');
    const ka = Prompt.katalogTextAbsicht(AP.katalogStandard());
    ok(ka.length > 3573 && ka.length <= 3573 + 400 + KAT.absichten.forschungsstation.prompt_zeile.length + 1 + KAT.absichten.bergung.prompt_zeile.length + 1 && KAT.absichten.forderung.prompt_zeile.length <= KAT.werte.prompt_zeile_max.wert, 'der Absichten-Katalog wachst um eine Zeile (' + ka.length + ' Zeichen, vorher 3573), die Zeile haelt prompt_zeile_max');
    console.log('  info Beat-Katalog ' + katalog + ' Zeichen, Absichten-Katalog ' + ka.length + ', prompt_max_zeichen ' + AW.prompt_max_zeichen.wert);
  });

  // ============================================================== (b)
  await section('(b) Expander und Pruefer: der Plan mit Zollkontrolle, unsinnige Plaene mit klaren Codes', async () => {
    const r = Bauplan.pruefe(ZOLLPLAN());
    ok(r.ok === true, 'forderung + schmiergeld + raumschlacht + Abschluss: Expander und Pruefer nehmen den Plan an (' + r.fehler.join(' | ') + ')');
    const v = r.vorlage;
    ok(v.beats.map((b) => b.typ).join() === 'forderung,schmiergeld,raumschlacht,abschluss', 'die Vorlage hat die vier Beats');
    ok(JSON.stringify(v.beats[0].parameter) === '{"art":"durchsuchung","tiefe":"voll","staerke":"mittel","text_key":"durchsuchung_zollschiff"}', 'forderung: Standards aus den Daten (art durchsuchung, tiefe voll, staerke mittel, Text des Zollschiffs)');
    ok(JSON.stringify(v.beats[1].parameter) === '{"staerke":"mittel","text_key":"schmiergeld_durchsuchung_zollschiff"}', 'schmiergeld: Standards aus den Daten');
    ok(v.beats[0].optionen.map((o) => o.id).join() === 'dulden,nicht_dulden' && v.beats[1].optionen.map((o) => o.id).join() === 'bestechen,verweigern', 'die Optionen kommen aus den Daten, nicht aus dem Plan');
    ok(v.beats[0].aus.gescheitert.weiter === 'e' && v.beats[0].aus.gelungen.weiter === undefined && v.beats[1].aus.gelungen.weiter === 'e' && v.beats[1].aus.gescheitert.weiter === undefined, 'der Expander verdrahtet die Ausgaenge: Dulden und Bestechen enden, Nicht dulden geht zum Schmiergeld, Verweigern in den Kampf');
    ok(!/sim_befehl/.test(JSON.stringify(v)) && !v.beats.some((b) => b.parameter && 'ende' in b.parameter), 'die Vorlage enthaelt weder sim_befehl noch ein ende (das bleibt Vorlagen aus Dateien vorbehalten)');
    const pr = Pruefer.pruefeVorlage(v);
    ok(pr.ok, 'der Pruefer akzeptiert die expandierte Vorlage (' + pr.fehler.join(' | ') + ')');
    ok(JSON.stringify(v.beats[3].erfolg.ereignis) === '["forderung_gelungen","schmiergeld_gelungen","raumschlacht_gelungen"]', 'Standard-Erfolg ohne Angabe: die letzten Typen des Plans (der Inszenierer nennt erfolg ausdruecklich)');
    const sc = Bauplan.pruefe(plan([FO({ tiefe: 'scan', staerke: 'stark', text_key: 'durchsuchung_freibeuter' }), SCHMIER({ staerke: 'stark', text_key: 'schmiergeld_durchsuchung_freibeuter' }), SCHLACHT, ENDE]));
    ok(sc.ok && sc.vorlage.beats[0].parameter.tiefe === 'scan' && sc.vorlage.beats[0].parameter.text_key === 'durchsuchung_freibeuter', 'Plan mit tiefe scan, staerke stark und dem Freibeuter als Forderer: gueltig');
    ok(Bauplan.pruefe(plan([FO(null, { verzweigung: { gescheitert: 'e' } }), SCHLACHT, ENDE])).ok, 'forderung ohne schmiergeld (Nicht dulden geht direkt in den Kampf): gueltig');
    // Fehlcodes
    const fall = (name, p, code, re) => {
      const x = Bauplan.pruefe(p);
      ok(!x.ok && x.codes.includes(code) && (!re || re.test(x.fehler.join(' '))), name + ' -> ' + code + (x.ok ? ' [Plan kam durch]' : ' (' + String(x.fehler[0]).slice(0, 110) + ')'));
    };
    fall('art ware im Plan (die Ware des Fadens kann ein Plan nicht laden)', plan([FO({ art: 'ware' }), SCHMIER(), SCHLACHT, ENDE]), 'PARAMETER', /art "ware" ist nicht erlaubt \(durchsuchung\)/);
    fall('art unbekannt', plan([FO({ art: 'zoll' }), SCHMIER(), SCHLACHT, ENDE]), 'PARAMETER', /art "zoll"/);
    fall('unbekannte Tiefe', plan([FO({ tiefe: 'tief' }), SCHMIER(), SCHLACHT, ENDE]), 'PARAMETER', /tiefe "tief" ist nicht erlaubt \(voll, scan\)/);
    fall('unbekannte Staerke', plan([FO({ staerke: 'riesig' }), SCHMIER(), SCHLACHT, ENDE]), 'PARAMETER', /staerke "riesig"/);
    fall('Staerke des Schmiergelds unbekannt', plan([FO(), SCHMIER({ staerke: 'riesig' }), SCHLACHT, ENDE]), 'PARAMETER', /staerke "riesig"/);
    fall('Text der Forderung der Ware in der Durchsuchung', plan([FO({ text_key: 'forderung_freibeuter' }), SCHMIER(), SCHLACHT, ENDE]), 'PARAMETER', /text_key "forderung_freibeuter"/);
    fall('ende im Plan (Parameter ende an forderung)', plan([FO({ ende: 'geladen' }), SCHMIER(), SCHLACHT, ENDE]), 'PARAMETER', /darf den Parameter "ende" nicht setzen/);
    fall('ende im Plan (Lade-Beat: der Plan setzt kein ende geladen)', plan([{ typ: 'fracht', parameter: { ende: 'geladen' } }, FO(), SCHMIER(), SCHLACHT, ENDE]), 'PARAMETER', /"ende"/);
    fall('sim_befehl im Plan (Folge im Beat)', plan([{ typ: 'enthuellung', aus: { gelungen: { folge: [{ typ: 'sim_befehl', befehl: 'invasion' }] } } }, ENDE]), 'FORM', /unbekanntes Feld aus/);
    fall('sim_befehl im Plan (folge am Beat)', plan([{ typ: 'bitte', folge: [{ typ: 'sim_befehl' }] }, ENDE]), 'FORM', /unbekanntes Feld folge/);
    fall('forderung ohne Optionen', plan([FO(null, { optionen: false }), SCHMIER(), SCHLACHT, ENDE]), 'BAUPLAN_OPTIONEN_PFLICHT');
    fall('Dulden und Nicht dulden in denselben Beat (keine Verzweigung)', plan([{ typ: 'forderung' }, SCHMIER(), SCHLACHT, ENDE]), 'OPTIONEN_GLEICHER_WEG');
    fall('Verzweigung nach hinten', plan([{ id: 'a', typ: 'raumschlacht' }, FO(null, { verzweigung: { gescheitert: 'a' } }), ENDE]), 'WEITER_UNGUELTIG');
    fall('forderung als letzter Beat', plan([SCHLACHT, FO(null, { verzweigung: {} })]), 'ABSCHLUSS_FEHLT');
    fall('unbekannter Typ (zollkontrolle ist eine Vorlage, kein Beat-Typ)', plan([{ typ: 'zollkontrolle' }, ENDE]), 'TYP_UNBEKANNT');
    // Pruefer (Vorlage): dieselben Regeln fuer handgeschriebene Vorlagen
    const z = () => klon(require('../content/faeden/vorlagen/zollkontrolle.json'));
    const mut = (f2) => { const v = z(); v.id = 'zk_mut'; f2(v); return Pruefer.pruefeVorlage(v); };
    ok(mut(() => {}).ok, 'die Vorlage zollkontrolle besteht den Pruefer');
    let r2 = mut((v) => { v.beats[0].gefahr = true; });
    ok(!r2.ok && codes(r2).includes('OPTION_BEI_GEFAHR'), 'Pruefer: forderung mit gefahr:true -> OPTION_BEI_GEFAHR');
    r2 = mut((v) => { v.beats[0].parameter.tiefe = 'tief'; });
    ok(!r2.ok && codes(r2).includes('PARAMETER'), 'Pruefer: unbekannte Tiefe -> PARAMETER');
    r2 = mut((v) => { v.beats[0].parameter.art = 'raub'; });
    ok(!r2.ok && codes(r2).includes('PARAMETER'), 'Pruefer: unbekannte Art -> PARAMETER');
    r2 = mut((v) => { v.beats[0].optionen[0].id = 'ausliefern'; });
    ok(!r2.ok && codes(r2).includes('OPTION_UNGUELTIG'), 'Pruefer: eine Option der Art ware in der Art durchsuchung -> OPTION_UNGUELTIG');
    r2 = mut((v) => { v.beats[0].aus.gelungen.folge = [{ typ: 'sim_befehl' }]; });
    ok(!r2.ok && codes(r2).includes('SIM_BEFEHL_BEAT'), 'Pruefer: sim_befehl an einer forderung -> SIM_BEFEHL_BEAT (nur eine Enthuellung darf ihn)');
  });

  // ============================================================== (c)
  await section('(c) braucht_ware: die Forderung der Ware ohne Ware endet sofort gescheitert, die Durchsuchung braucht keine', async () => {
    // Faden: Lade-Beat (geladen) -> forderung (art ware) -> schmiergeld -> raumschlacht -> Abliefer-Beat -> Abschluss
    const bauen = (id) => {
      const r = registriere(alsVorlage(id, (v) => {
        v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
        v.beats = [
          { id: 'b_lade', typ: 'fracht', parameter: { nach: ZIEL, ende: 'geladen' }, aus: { gelungen: WEG('verbuendet', 'b_forderung'), gescheitert: WEG('geflohen', 'b_ende') } },
          { id: 'b_forderung', typ: 'forderung', parameter: { staerke: 'gering' }, optionen: [{ id: 'ausliefern', text: 'Nehmt die Ware.', ausgang: 'gescheitert', folge: [] }, { id: 'nicht_ausliefern', text: 'Die Ware bleibt.', ausgang: 'gelungen', folge: [] }], aus: { gelungen: WEG('verbuendet', 'b_schmier'), gescheitert: WEG('aktiv', 'b_ende') } },
          { id: 'b_schmier', typ: 'schmiergeld', parameter: { staerke: 'gering' }, optionen: [{ id: 'bestechen', text: 'Wir zahlen.', ausgang: 'gelungen', folge: [] }, { id: 'verweigern', text: 'Wir zahlen nichts.', ausgang: 'gescheitert', folge: [] }], aus: { gelungen: WEG('verbuendet', 'b_abgabe'), gescheitert: WEG('aktiv', 'b_kampf') } },
          { id: 'b_kampf', typ: 'raumschlacht', aus: { gelungen: WEG('aktiv', 'b_abgabe'), gescheitert: WEG('aktiv', 'b_ende') } },
          { id: 'b_abgabe', typ: 'fracht', parameter: { nach: ZIEL, ende: 'abgeliefert' }, aus: { gelungen: WEG('verbuendet', 'b_ende'), gescheitert: WEG('geflohen', 'b_ende') } },
          { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['fracht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
        ];
      }));
      if (!r.ok) throw new Error('Vorlage ' + id + ' ungueltig: ' + r.fehler.join('; '));
    };
    bauen('fp_c');
    const FORDERER = TEXTE.forderer.freibeuter.name;
    const ladeBis = (seed) => {   // Lade-Beat gelaufen, der Faden wartet auf die Forderung (mit Ware)
      const x = bereit(seed); x.f = oeffne(x.g, 'fp_c'); starteBeat(x);
      ok(!!x.f.fracht && lager(x.g) === 1 && beatId(x.f) === 'b_forderung' && x.f.phase === 'wartet', 'Lade-Beat: die Ware ist an Bord, der Faden wartet auf die Forderung');
      return x;
    };
    { // mit Ware: das Ultimatum steht, die Wahl laeuft wie in Paket A
      const x = ladeBis(11); starteBeat(x);
      ok(!!angebot(x.g) && angebot(x.g).optionen.map((o) => o.id).join() === 'ausliefern,nicht_ausliefern' && x.f.phase === 'laeuft', 'mit Ware: Ultimatum mit den Optionen der Art ware, der Beat laeuft');
      ok(!x.texte().includes(TEXTE.ware_fehlt), 'mit Ware: kein Funk „ware_fehlt“');
    }
    { // Notsprung in der Wartezeit (nach dem Lade-Beat, vor der Forderung): die Ware ist weg, die Forderung endet sofort gescheitert
      const x = ladeBis(12);
      x.g.missionEvent('notsprung', {});
      ok(!x.f.fracht && lager(x.g) === 0, 'Notsprung in der Wartezeit: die Ware ist verloren (Faden und Frachtraum)');
      starteBeat(x);
      ok(angebot(x.g) === null, 'die Forderung stellt KEIN Ultimatum (nichts zu fordern)');
      ok(x.texte().includes(TEXTE.ware_fehlt) && x.radio.some((q) => q.von === FORDERER && q.text === TEXTE.ware_fehlt), 'der Forderer sagt per Funk, dass es nichts zu holen gibt (Text ware_fehlt, Absender der Forderer)');
      ok(x.f.phase === 'wartet' && beatId(x.f) === 'b_ende', 'der Beat endete sofort gescheitert: weiter zum Abschluss (Verzweigung der Vorlage)');
      ok(ereignisse(x.f).includes('forderung_gescheitert') && ereignisse(x.f).includes('fracht_gescheitert'), 'Gedaechtnis: forderung_gescheitert und die verlorene Ladung (' + ereignisse(x.f).join() + ')');
      grenzen(x.g, 5); weiter(x.g, x.f);
      ok(x.f.phase === 'abgeschlossen' && x.f.ausgang.art === 'gescheitert', 'Abschluss gescheitert');
    }
    { // die Ladung des Auftrags liegt nicht mehr im Frachtraum (z. B. Huellentreffer), der Faden haelt sie noch
      const x = ladeBis(13);
      Lager.auftragEntnehmen(x.g, x.f.id);
      ok(!!x.f.fracht && Lager.auftragAnBord(x.g, x.f.id) === 0, 'Vorbereitung: der Faden haelt die Ware, im Frachtraum liegt sie nicht mehr');
      starteBeat(x);
      ok(angebot(x.g) === null && x.texte().includes(TEXTE.ware_fehlt) && beatId(x.f) === 'b_ende', 'auch dann endet die Forderung sofort gescheitert (kein Ultimatum, Funk ware_fehlt)');
    }
    { // die Durchsuchung braucht keine Ware des Fadens: der Zoll prueft den Frachtraum auch ohne Lade-Beat
      const x = amZoll(21, []);
      ok(!!angebot(x.g) && !x.f.fracht && angebot(x.g).optionen.map((o) => o.id).join() === 'dulden,nicht_dulden', 'art durchsuchung ohne Faden-Ware: das Ultimatum steht');
      ok(!x.texte().includes(TEXTE.ware_fehlt), 'kein Funk „ware_fehlt“ in der Durchsuchung');
    }
  });

  // ============================================================== (d)
  await section('(d) Inszenierer: die Absicht forderung baut einen Plan, Nein mit Grund', async () => {
    ok(KAT.absichten.forderung && INS.katalogFehler().length === 0 && AP.katalogFehler().length === 0, 'die Absicht steht im Katalog, Rezept und Struktur sind stimmig');
    const e = KAT.absichten.forderung;
    ok(typeof e.zweck === 'string' && JSON.stringify(e.parameter.tiefe.erlaubt) === '["voll","scan"]' && e.wendungen.join() === 'keine' && e.prompt_zeile.startsWith('forderung:') && e.prompt_zeile.length <= KAT.werte.prompt_zeile_max.wert && /voll\|scan/.test(e.prompt_zeile), 'Eintrag: Zweck, Parameter tiefe, Wendung keine, prompt_zeile (Name, Werte, hoechstens ' + KAT.werte.prompt_zeile_max.wert + ' Zeichen)');
    ok(JSON.stringify(e.inszenierung.bedingungen.map((b) => b.art)) === '["rang_mindestens","ladung_mindestens"]' && e.inszenierung.bedingungen[1].plaetze === 1, 'Rezept: Bedingungen rang_mindestens (Rang aus den Daten) und ladung_mindestens (plaetze 1)');
    const t = welt(11), g = t.g;
    const ins = (a) => INS.inszeniere(g, a);
    // Nein: leerer Frachtraum (Rang reicht)
    stufe(g, 20, 0);
    let r = ins(absicht());
    ok(!r.ok && r.fehler.length === 1 && r.fehler[0].code === INS.CODES.WELT_BEDINGUNG && /Frachtraum der Lerche ist leer/.test(r.fehler[0].grund) && /nichts zu pruefen/.test(r.fehler[0].grund), 'Nein bei leerem Frachtraum: WELT_BEDINGUNG mit Grund (' + (r.fehler && r.fehler[0].grund) + ')');
    ok(!r.ok && r.fehler[0].gegenvorschlag === undefined, 'ohne Gegenvorschlag (kein Feld der Absicht kann eine Ladung herbeiholen)');
    // Nein: Rang unter Optio (Ladung da)
    beladen(g); stufe(g, 0, 0);
    r = ins(absicht());
    ok(!r.ok && r.fehler.length === 1 && r.fehler[0].code === INS.CODES.WELT_BEDINGUNG && /Rang der Crew reicht nicht \(gebraucht: optio\)/.test(r.fehler[0].grund), 'Nein bei zu niedrigem Rang („kein Gegner moeglich“, Rang unter Optio): WELT_BEDINGUNG mit Grund (' + (r.fehler && r.fehler[0].grund.slice(0, 80)) + ')');
    // beides
    raeume(g); stufe(g, 0, 0);
    r = ins(absicht());
    ok(!r.ok && r.fehler.length === 2, 'leerer Frachtraum und Rang zu niedrig: beide Gruende stehen im Nein (' + (r.fehler && r.fehler.length) + ')');
    const txt = AP.fehlerText(r);
    ok(/Frachtraum/.test(txt) && /Rang/.test(txt), 'der Klartext fuer das Modell nennt beide Gruende');
    // ein Platz Ladung genuegt, jede Art
    beladen(g); stufe(g, 20, 0);
    r = ins(absicht());
    ok(r.ok === true && folge(r) === 'forderung,schmiergeld,raumschlacht,abschluss' && r.hex === ZIEL, 'mit Ladung und Rang Optio: Plan forderung, schmiergeld, raumschlacht, Abschluss (' + (r.ok ? folge(r) : JSON.stringify(r.fehler)) + ')');
    ok(r.ok && Bauplan.pruefe(r.plan).ok && Bauplan.expandiere(r.plan).ok, 'der Plan besteht Expander und Pruefer');
    const b = r.ok ? r.plan.beats : [];
    ok(r.ok && JSON.stringify(b[0].parameter) === '{"art":"durchsuchung","tiefe":"voll","staerke":"gering","text_key":"durchsuchung_zollschiff"}' && JSON.stringify(b[1].parameter) === '{"staerke":"gering","text_key":"schmiergeld_durchsuchung_zollschiff"}', 'Stufe 0: Zollschiff, Staerke gering, Tiefe aus dem Parameter (Standard voll)');
    ok(r.ok && b[0].verzweigung.gescheitert === 'ende' && b[1].verzweigung.gelungen === 'ende' && b[3].erfolg.join() === 'schmiergeld,raumschlacht', 'Verzweigungen und Erfolg stammen aus dem Rezept');
    ok(r.ok && r.plan.anlass === TEXT.einsatz && r.titel === TEXT.titel, 'Titel und Anlass aus der Absicht');
    // Parameter tiefe
    r = ins(absicht({ parameter: { tiefe: 'scan' } }));
    ok(r.ok && r.plan.beats[0].parameter.tiefe === 'scan', 'Parameter tiefe scan geht in den Plan');
    r = ins(absicht({ parameter: { tiefe: 'tief' } }));
    ok(!r.ok, 'unbekannte Tiefe: Nein (Pruefer der Absicht)');
    r = ins(absicht({ bogen: { einsatz: TEXT.einsatz, wendung: 'ueberfall', preis: TEXT.preis } }));
    ok(!r.ok, 'eine Wendung, die die Absicht nicht kennt: Nein');
    // Stufen nach Rang und Schiff (Platzhalter-Tabelle im Rezept: nach_stufe)
    const stuf = (rw, sh) => { stufe(g, rw, sh); const x = ins(absicht()); return x.ok ? x.plan.beats[0].parameter.staerke + '/' + x.plan.beats[0].parameter.text_key + '/' + x.plan.beats[1].parameter.text_key : 'nein ' + x.fehler.map((f) => f.code).join(); };
    ok(stuf(20, 0) === 'gering/durchsuchung_zollschiff/schmiergeld_durchsuchung_zollschiff', 'Optio, Schiff 0 (Stufe 0): ' + stuf(20, 0));
    ok(stuf(35, 0) === 'mittel/durchsuchung_zollschiff/schmiergeld_durchsuchung_zollschiff', 'Centurio (Stufe 1): ' + stuf(35, 0));
    ok(stuf(200, 3) === 'stark/durchsuchung_freibeuter/schmiergeld_durchsuchung_freibeuter', 'Legat mit Schiff 3 (Stufe 2): Freibeuter, Staerke stark: ' + stuf(200, 3));
    // BEA-01 Nacharbeit: das Volk der Gegner passt zum Forderer (Zoll = roemisch, Freibeuter = germanisch), als Parameter volk des Beats raumschlacht
    const volk = (rw, sh) => { stufe(g, rw, sh); const x = ins(absicht()); return x.ok ? JSON.stringify(x.plan.beats[2].parameter || null) : 'nein'; };
    ok(volk(20, 0) === '{"volk":"rom"}' && volk(35, 0) === '{"volk":"rom"}' && volk(200, 3) === '{"volk":"ger"}', 'Gegner nach Stufe: Zollschiff roemisch, Freibeuter germanisch: ' + volk(20, 0) + ' ' + volk(35, 0) + ' ' + volk(200, 3));
    // BEA-01 Nacharbeit: Personen (Betten) sind keine Ladung; anBord zaehlt wie bisher alles
    stufe(g, 20, 0); raeume(g); g.fracht.lager.push({ art: 'person' });
    r = ins(absicht());
    ok(!r.ok && r.fehler[0].code === INS.CODES.WELT_BEDINGUNG && /leer/.test(r.fehler[0].grund) && Lager.anBord(g) === 1 && Lager.ladungAnBord(g) === 0, 'nur eine Person an Bord: Nein (Frachtraum leer), anBord zaehlt sie weiter (' + Lager.anBord(g) + '), ladungAnBord nicht (' + Lager.ladungAnBord(g) + ')');
    einlagern(g, 'fracht');
    r = ins(absicht());
    ok(r.ok === true && Lager.anBord(g) === 2 && Lager.ladungAnBord(g) === 1, 'Person plus eine Kiste: Plan moeglich');
    // der Katalog-Pruefer der Rezepte lehnt eine kaputte Bedingung ab
    const k = klon(KAT); k.absichten.forderung.inszenierung.bedingungen[1].plaetze = 0;
    ok(INS.katalogFehler(k).some((x) => /ladung_mindestens braucht plaetze/.test(x)), 'katalogFehler: ladung_mindestens ohne gueltige plaetze wird gemeldet');
    // Anbieten: der Plan geht durch das Brett
    stufe(g, 20, 0); beladen(g);
    const an = INS.anbietenAusAbsicht(g, absicht());
    ok(an.ok && an.angebot && an.inszenierung.hex === ZIEL, 'anbietenAusAbsicht: das Brett nimmt das Angebot (' + (an.ok ? 'ok' : JSON.stringify(an.fehler)) + ')');
  });

  // ============================================================== (e)
  await section('(e) Mock-Lauf im Absichten-Modus: die Absicht erscheint unter den gewaehlten', async () => {
    const t = welt(161, { ABENTEUER_ABSICHTEN: '1' }), g = t.g;
    const gewaehlt = {};
    let forderungen = 0, plaene = 0, neins = 0, grund = '';
    stufe(g, 20, 0); raeume(g);   // leerer Frachtraum zuerst
    for (let nr = 1; nr <= 80; nr++) {
      const bau = Absicht.baue(g, { nr, grenze: 'andocken', hex: ZIEL, letzteAbsichten: [], werte: Prompt.WERTE });
      const res = AM.erzeuge({ prompt: bau.prompt });
      const gel = Absicht.lesen(res.text);
      if (gel.fehler || res.korruption === 'absicht_unmoeglich') continue;
      const name = gel.absicht.absicht;
      gewaehlt[name] = (gewaehlt[name] || 0) + 1;
      if (name !== 'forderung') continue;
      forderungen++;
      const e = AV.pruefeUndInszeniere(g, gel.absicht);
      if (!e.ok) { neins++; grund = e.fehler[0].grund; }
    }
    console.log('  info Mock-Lauf (80 Aufrufe, Absichten-Modus): ' + Object.entries(gewaehlt).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', '));
    ok(forderungen >= 1 && Object.keys(gewaehlt).length >= 10, 'die Absicht forderung erscheint unter den gewaehlten Absichten des Mocks (' + forderungen + ' von 80 Aufrufen, ' + Object.keys(gewaehlt).length + ' verschiedene Absichten)');
    ok(neins === forderungen && /Frachtraum der Lerche ist leer/.test(grund), 'im leeren Frachtraum ist jede gewaehlte forderung ein Nein mit Grund (' + neins + ' von ' + forderungen + ': ' + grund.slice(0, 60) + ')');
    // dieselben Aufrufe mit Ladung an Bord: die Absicht ergibt einen gueltigen Plan
    beladen(g);
    for (let nr = 1; nr <= 80; nr++) {
      const bau = Absicht.baue(g, { nr, grenze: 'andocken', hex: ZIEL, letzteAbsichten: [], werte: Prompt.WERTE });
      const gel = Absicht.lesen(AM.erzeuge({ prompt: bau.prompt }).text);
      if (gel.fehler || gel.absicht.absicht !== 'forderung') continue;
      const e = AV.pruefeUndInszeniere(g, gel.absicht);
      const pl = e.ok && e.inszenierung && e.inszenierung.plan;
      if (pl && folge({ plan: pl }) === 'forderung,schmiergeld,raumschlacht,abschluss' && Bauplan.pruefe(pl).ok) plaene++;
    }
    ok(plaene >= 1, 'mit Ladung an Bord: die vom Mock gewaehlte forderung wird zu einem gueltigen Plan (' + plaene + ' Plaene)');
  });

  // ============================================================== (f)
  await section('(f) Bausteine einzeln: forderung laeuft ohne die Schmuggel-Vorlage (Vorlage zollkontrolle und Plan der Absicht)', async () => {
    const v = D.vorlage('zollkontrolle');
    ok(!!v && Pruefer.pruefeVorlage(klon(v)).ok, 'die Vorlage zollkontrolle ist geladen und besteht den Pruefer');
    ok(v.beats.map((b) => b.typ).join() === 'forderung,schmiergeld,raumschlacht,abschluss' && !v.wahrheit && !Object.keys(v.hinweise || {}).length && !v.beats.some((b) => ['fracht', 'bitte', 'enthuellung', 'verfolgung'].includes(b.typ)), 'ohne Haendler, ohne Ware, ohne Enthuellung und Verfolgung: forderung, schmiergeld, raumschlacht, Abschluss');
    ok(!/sim_befehl/.test(JSON.stringify(v)), 'ohne Invasion (kein sim_befehl)');
    ok(v.ausloeser.every((a) => a.ereignis && a.ereignis.length) && !fs.readFileSync(path.join(__dirname, '..', 'content', 'reise', 'ereignisse.json'), 'utf8').includes('notruf_zollkontrolle'), 'der Ausloeser der Vorlage ist ein Ereignis, das kein Reise-Ereignis erzeugt: die Vorlage wartet auf einen Ausloeser (nichts im Spiel aendert sich)');
    { // Dulden ohne Ladung: sauber
      const x = amZoll(31, []);
      ok(!!angebot(x.g) && angebot(x.g).von === TEXTE.forderer.zollschiff.name && angebot(x.g).kopf === 'ZOLL' && angebot(x.g).text === fmt(TEXTE.texte.durchsuchung_zollschiff.text, { ort: Sektoren.hexName(ZIEL) || 'hier' }), 'das Zollschiff fordert (Kopf ZOLL, Text der Durchsuchung): ' + (angebot(x.g) && angebot(x.g).text));
      ok(!x.f.fracht && !x.f.nsc.wahrheit, 'keine Ware am Faden, keine verborgene Wahrheit');
      antwort(x.g, 'dulden');
      ok(x.texte().includes(TEXTE.durchsuchung.sauber), 'Dulden: der Frachtraum ist sauber');
      grenzen(x.g, 5); weiter(x.g, x.f);
      ok(x.f.phase === 'abgeschlossen' && x.f.ausgang.art === 'gescheitert' && marken(x.g) === x.vorher, 'Dulden ohne Fund: Abschluss gescheitert (nichts erreicht), keine Marken weg');
    }
    { // Dulden mit Schmuggelware: gefunden, beschlagnahmt, Bussgeld
      const x = amZoll(32, [OFFEN]);
      antwort(x.g, 'dulden');
      ok(lager(x.g) === 0 && marken(x.g) === x.vorher - WERTE.bussgeld_marken.wert.mittel && x.texte().includes(fmt(TEXTE.durchsuchung.fund, { n: 1 })), 'Dulden mit Schmuggelware: gefunden und beschlagnahmt, Bussgeld (mittel) gebucht');
    }
    { // Nicht dulden -> Bestechen: Marken weg, keine Durchsuchung, kein Kampf
      const x = amZoll(33, [OFFEN]);
      antwort(x.g, 'nicht_dulden'); starteBeat(x);
      ok(angebot(x.g).text === fmt(TEXTE.texte.schmiergeld_durchsuchung_zollschiff.text, { marken: WERTE.bestechung_marken.wert.mittel + ' ' + WERTE.marken_einheit.wert }), 'Schmiergeld des Zollschiffs nennt den Preis (mittel)');
      antwort(x.g, 'bestechen');
      ok(marken(x.g) === x.vorher - WERTE.bestechung_marken.wert.mittel && lager(x.g) === 1, 'Bestechen: Marken weg, die Ladung bleibt (keine Durchsuchung)');
      grenzen(x.g, 5); weiter(x.g, x.f);
      ok(x.f.phase === 'abgeschlossen' && x.f.ausgang.art === 'gelungen' && ereignisse(x.f).join().startsWith('forderung_gelungen,schmiergeld_gelungen'), 'Abschluss gelungen (' + ereignisse(x.f).join() + ')');
    }
    { // Nicht dulden -> Verweigern -> Kampf gewonnen
      const x = amZoll(34, [OFFEN]);
      antwort(x.g, 'nicht_dulden'); starteBeat(x); antwort(x.g, 'verweigern'); starteBeat(x);
      ok(x.f.phase === 'laeuft' && D.vorlage(x.f.vorlage).beats[x.f.beat].typ === 'raumschlacht' && marken(x.g) === x.vorher && lager(x.g) === 1, 'Verweigern: der Kampf-Beat laeuft, nichts bezahlt, die Ladung bleibt');
      Faden.beatAusgang(x.g, x.f.id, 'gelungen'); grenzen(x.g, 5); weiter(x.g, x.f);
      ok(x.f.phase === 'abgeschlossen' && x.f.ausgang.art === 'gelungen', 'Kampf gewonnen: Abschluss gelungen');
    }
    { // Schweigen: der Zoll wartet nicht (Durchsuchung auch ohne Antwort)
      const x = amZoll(35, [OFFEN]);
      grenzen(x.g, 14);
      ok(angebot(x.g) === null && lager(x.g) === 0, 'Schweigen: die Frist verfaellt, der Zoll durchsucht trotzdem (Schmuggelware weg)');
    }
    { // der Plan der Absicht: gebaut vom Inszenierer, geoeffnet ueber das Brett, durchgespielt (Dulden und Bestechen)
      for (const weg of ['dulden', 'bestechen']) {
        const x = bereit(40 + (weg === 'dulden' ? 0 : 1)); const g = x.g;
        einlagern(g, OFFEN.art, OFFEN.eig);
        stufe(g, 20, 0);
        const r = INS.inszeniere(g, absicht());
        ok(r.ok, 'Plan der Absicht (' + weg + '): gebaut (' + (r.ok ? folge(r) : JSON.stringify(r.fehler)) + ')');
        const an = Faden.abenteuerAnbieten(g, r.plan, { hex: ZIEL });
        const op = an.ok ? Faden.abenteuerOeffnen(g, an.angebot.nr, {}) : null;
        ok(an.ok && op && op.ok, 'Plan der Absicht (' + weg + '): als Abenteuer angeboten und geoeffnet');
        x.f = op.faden; x.vorher = marken(g);
        starteBeat(x);
        ok(!!angebot(g) && angebot(g).optionen.map((o) => o.id).join() === 'dulden,nicht_dulden', 'Plan (' + weg + '): das Ultimatum steht');
        if (weg === 'dulden') {
          antwort(g, 'dulden'); grenzen(g, 5); weiter(g, x.f);
          ok(x.f.phase === 'abgeschlossen' && lager(g) === 0 && marken(g) < x.vorher, 'Plan (dulden): Fund, beschlagnahmt, Bussgeld, Abschluss');
        } else {
          antwort(g, 'nicht_dulden'); starteBeat(x); antwort(g, 'bestechen'); grenzen(g, 5); weiter(g, x.f);
          ok(x.f.phase === 'abgeschlossen' && x.f.ausgang.art === 'gelungen' && lager(g) === 1 && marken(g) === x.vorher - WERTE.bestechung_marken.wert.gering, 'Plan (bestechen, Stufe 0: gering): Marken weg, Ladung bleibt, Abschluss gelungen');
        }
      }
    }

    { // Speichern und Laden mitten in der Forderung eines Plan-Abenteuers: der Plan steht im Weltstand (Weltstand-Version bleibt 3), die Wahl gilt danach
      const x = bereit(50); const g = x.g;
      einlagern(g, OFFEN.art, OFFEN.eig); stufe(g, 20, 0);
      const r = INS.inszeniere(g, absicht());
      const an = Faden.abenteuerAnbieten(g, r.plan, { hex: ZIEL }), op = Faden.abenteuerOeffnen(g, an.angebot.nr, {});
      x.f = op.faden; starteBeat(x);
      const a = angebot(g), data = Weltstand.capture(g);
      ok(Weltstand.validate(data, g).length === 0, 'Weltstand mit dem laufenden Plan-Abenteuer (offene Forderung) besteht das Schema: ' + Weltstand.validate(data, g).slice(0, 2).join('; '));
      const y = bereit(51); Weltstand.apply(y.g, JSON.parse(JSON.stringify(data)));
      const h = y.g.weltsim.faeden.liste.find((q) => q.id === x.f.id), a2 = angebot(y.g);
      ok(!!h && !!h.plan && !!a2 && a2.text === a.text && a2.optionen.map((o) => o.id).join() === 'dulden,nicht_dulden', 'nach dem Laden: derselbe Plan, dieselbe Forderung mit denselben Optionen');
      ok(Bitte.beantworten(y.g, 'dulden', a2.nr) === null && lager(y.g) === 0, 'im geladenen Stand wirkt dulden (die Schmuggelware ist weg)');
    }
  });

  // ============================================================== (g)
  await section('(g) Kein Beat- oder Absichtsname im Servercode', async () => {
    const dir = path.join(__dirname, '..', 'server');
    const alle = [];
    (function lauf(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lauf(p); else if (e.name.endsWith('.js')) alle.push(p); } })(dir);
    const code = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n').replace(/\/\/.*$/gm, '');
    const namen = new Set(['forderung', 'schmiergeld', 'dulden', 'nicht_dulden', 'durchsuchung', 'bestechen', 'verweigern', 'ausliefern', 'nicht_ausliefern']);
    for (const k of Object.keys(KAT.absichten)) namen.add(k);
    // der Name einer Absicht oder eines Beats steht nie im Code der Maschine: Inszenierer, Pruefer, Expander, Prompt, Mock, Baustein; bekannte Altstellen (Bausteine-Register, Geld-Gruende) sind ausgenommen
    const AUSGENOMMEN = /^(geld|kampagnegeld|faden-bausteine)\.js$/;
    const dateien = ['inszenierer.js', 'absicht-pruefer.js', 'absicht-verhandlung.js', 'faden-bauplan.js', 'faden-forderung.js', 'faden-pruefer.js', 'abenteuer-prompt.js', 'abenteuer-absicht.js', 'abenteuer-mock.js', 'abenteuer-spielleiter.js', 'faden-daten.js', 'faden-fracht.js'];
    const treffer = [];
    for (const f of alle) {
      const b = path.basename(f);
      if (AUSGENOMMEN.test(b)) continue;
      const t = code(f);
      for (const name of namen) if (new RegExp('[\'"`]' + name + '[\'"`]').test(t) && (dateien.includes(b) || /^forderung|^schmiergeld/.test(name))) treffer.push(b + ':' + name);
    }
    const erlaubt = treffer.filter((x) => !/^(abenteuer-mock|faden-bauplan|faden-pruefer)\.js:(bitte|notruf|spontanhilfe)$/.test(x));
    ok(erlaubt.length === 0, 'kein Name von forderung, schmiergeld, ihren Optionen und Arten und keiner Absicht als Zeichenkette im Servercode (Treffer: ' + erlaubt.join(', ') + ')');
    const bedingung = alle.filter((f) => /['"`]ladung_mindestens['"`]/.test(code(f))).map((f) => path.basename(f));
    ok(bedingung.join() === 'inszenierer.js', 'die Bedingungsart ladung_mindestens steht nur im Inszenierer (Vokabular, kein Beat- oder Absichtsname): ' + bedingung.join(', '));
    const liest = (re) => alle.filter((f) => re.test(code(f))).map((f) => path.basename(f)).sort().join();
    ok(liest(/braucht_ware/) === 'faden-forderung.js' && liest(/s.verborgen/) === 'abenteuer-prompt.js,faden-bauplan.js', 'die neuen Katalogfelder liest nur der Code, der sie braucht: braucht_ware ' + liest(/braucht_ware/) + ', verborgen ' + liest(/s.verborgen/));
  });

  console.log('\n' + (fails ? `${n - fails}/${n} Pruefungen ok, ${fails} FEHLER` : `${n}/${n} Pruefungen ok`));
  process.exit(fails ? 1 : 0);
})();
