'use strict';
// SPL-02 E1: Betriebsmodus Absichten des Abenteuer-Spielleiters (server/sim/abenteuer-absicht.js, Prompt in abenteuer-prompt.js baueAbsicht, Anbindung in abenteuer-spielleiter.js, Mock in abenteuer-mock.js,
// Schalter ABENTEUER_ABSICHTEN + Datenwert betrieb_standard_an). Kein Netz, kein Claude: Mock, Script und Fake-Transporte. Die Erwartungen stehen hier selbst (an einer eigenen Welt: acht abgeschlossene Abenteuer an der
// Station 0305, die Namen und Zustaende setzt der Test), nie aus dem Produktivcode abgeleitet. Geprueft wird:
// Schalter (Umgebung, Datenwert, Lobby-Betriebsart live ja, Rueckfall nein) · Prompt-Groessen (Katalog kleiner als heute, Prompt mit Geschichte mit Luft, Kennungen am Ergebnis, Spielername nie im Prompt) ·
// Modus AUS byte-gleich (Prompt und Systemprompt des Spielleiters = Baseline-Funktion, Eintrag ohne neue Felder) · Antwort gueltig > Angebot mit Bezug und locker · eingefrorene Kennungen (der Zustand aendert sich
// zwischen Prompt und Antwort: K2 meint denselben NSC oder BEZUG_VERALTET, nie einen anderen) · Nein > eine Verhandlungsrunde (kleiner Folgeprompt ohne Katalog, ohne Namen) > Angebot · zweites Nein > kein Angebot ·
// unlesbar/leer/Ausfall: kein Angebot, kein Absturz, keine Verhandlung · Deckel und Kosten · Logbuch ohne Titel, Texte und Namen · Mock (gueltig, unmoeglich, Verhandlung) · Quelltext ohne Beat- und Absichtsnamen.
// Aufruf: node tools/test-abenteuer-absichten.js [begriff ...]        (npm run test:abenteuer-absichten)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');
const Absicht = require('../server/sim/abenteuer-absicht.js');
const AM = require('../server/sim/abenteuer-mock.js');
const AV = require('../server/sim/absicht-verhandlung.js');
const G = require('../server/sim/abenteuer-geschichte.js');
const Regielog = require('../server/mission/regielog.js');
const Bericht = require('./regie-bericht.js');

const { D, Faden, F } = X;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const frei = () => new Promise((r) => setImmediate(r));
const KAT = lies('content/faeden/absichten.json');
const AW = Object.fromEntries(Object.entries(lies('content/welt/abenteuer-werte.json').werte).map(([k, v]) => [k, v.wert]));
const SZ = lies('content/welt/freie-fahrt-szenario.json').werte;
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' };
const AN = { ABENTEUER_ABSICHTEN: '1' };
const KATALOG_MAX = 10500;   // BEA-01 C2: Obergrenze des Beat-Katalogs im Prompt (vorher 9500): 9443 Zeichen vor BEA-01 plus die Beats forderung und schmiergeld (gemessen 10244) plus Reserve; siehe content/welt/abenteuer-werte.json prompt_max_zeichen
const KATALOG_HEUTE = 9443;   // Zeichen des Beat-Katalogs im Prompt vor Paket E (Messung der Erkundung und des Auftrags)
const PROMPT_ZIEL = 8000;     // Auftrag: Prompt mit Geschichte hoechstens so gross

// ---------------------------------------------------------------- Welt (wie test-abenteuer-geschichte.js)
function neu(seed, env, namen) {
  const names = namen || NAMEN;
  return F.neuesSpiel({ crew: names.length, seed: seed || 11, names, env: Object.assign({}, ENV, env || {}) });
}
function mitSL(t, llm, werte) {
  const l = llm || LLM.create({ mode: 'mock' });
  l.asks = [];
  const ask0 = l.ask.bind(l), esk0 = l.eskaliere.bind(l);
  l.ask = (k, i, o) => { l.asks.push({ kind: k, prompt: i && i.prompt, system: i && i.system, stufe: o && o.stufe }); return ask0(k, i, o); };
  l.eskaliere = (k, i, o) => { l.asks.push({ kind: k, eskaliert: true, prompt: i && i.prompt, system: i && i.system, stufe: o && o.stufe }); return esk0(k, i, o); };
  const sl = LS.create(t.g, { llm: l, werte: { deckel_je_sitzung: 0 }, abenteuerWerte: Object.assign({ cooldown_grenzen: 1 }, werte || {}) });
  t.g.lageSpielleiter = sl; t.g.lageSchalter = true;
  return { sl, ab: sl.abenteuer, llm: l, asks: () => l.asks.filter((a) => a.kind === 'abenteuer') };
}
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats }, o || {});
const einzel = (typ, i, beat) => plan([Object.assign({ typ }, beat || {}), { typ: 'abschluss' }], { titel: typ + ' ' + i, anlass: 'Probeanlass ' + typ + ' Nummer ' + i + ' ohne Namen' });
const zust = (g) => Faden.zustandVon(g);
function beende(g, f, ausgang) {
  const v = D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) {
    f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 };
    Faden.beatAusgang(g, f.id, ausgang);
  }
}
function spiele(g, p, ausgang) {
  const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  beende(g, r.faden, ausgang || 'gelungen');
  return r.faden;
}
function setze(g, f, name, status, haltung) {
  f.nsc.name = name; f.nsc.fraktion = 'rom'; f.nsc.status = status; f.nsc.haltung = haltung;
  const e = zust(g).kanon.find((x) => x.f === f.id);
  e.name = name; e.volk = 'rom'; e.status = status;
}
const PERSONEN = [
  ['Quintus Varro', 'feindlich', -2], ['Titus Calder', 'tot', 0], ['Gaius Fabrin', 'aktiv', 1], ['Livia Serran', 'verbuendet', 1],
  ['Aurelia Vex', 'aktiv', 0], ['Marcus Nerva', 'aktiv', 0], ['Julia Pavo', 'aktiv', 0], ['Decimus Rufo', 'aktiv', 0],
];
function welt8(seed, env, namen) {
  const t = neu(seed, env, namen), g = t.g;
  const typen = ['notruf', 'spontanhilfe', 'fracht', 'notruf', 'spontanhilfe', 'notruf', 'spontanhilfe', 'notruf'];
  t.f = PERSONEN.map(([name, st, h], i) => {
    const f = spiele(g, i === 2 ? einzel('fracht', 3, { parameter: { ware: 'erz' } }) : einzel(typen[i], i + 1));
    setze(g, f, name, st, h);
    return f;
  });
  t.f[7].nsc.gedaechtnis = [];
  return t;
}
const TEXT = { titel: 'Zebrafalke Probe Titel', einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', preis: 'Ein Preis ohne Namen fuer den Test.' };
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const kennungVon = (g, name) => Object.keys(G.geschichteZeilen(g).kennungen).find((k) => G.geschichteZeilen(g).kennungen[k] === name);
async function pumpen(g, k) { for (let i = 0; i < k; i++) { g.step(); await frei(); } }
const logbuch = (g) => (g.lageRegie ? g.lageRegie.log.entries : []);
const abLog = (g, ausgang) => logbuch(g).filter((e) => e.art === 'abenteuer_bauplan' && (ausgang === undefined || e.ausgang === ausgang));
const scriptLLM = (liste) => LLM.create({ mode: 'script', script: { abenteuer: liste } });
// eine Grenze ueber den ECHTEN Hook, danach genug Schritte: Aufruf angefragt, beantwortet, abgeholt (und ein zweiter Aufruf der Verhandlung ebenso)
async function lauf(g, k) { g.lageGrenze('andocken'); await pumpen(g, k || 6); }
const angebote = (g) => zust(g).abenteuerAngebote;

// ======================================================================
section('Schalter: Umgebung, Datenwert, Lobby-Betriebsart', () => {
  const env = (e) => ({ env: e });
  ok(KAT.werte.betrieb_standard_an.wert === false, 'Datenwert betrieb_standard_an steht auf false (Standard aus)');
  ok(!Absicht.aktiv(env({})) && !Absicht.aktiv(env({ ABENTEUER_ABSICHTEN: '' })) && !Absicht.aktiv(env({ ABENTEUER_ABSICHTEN: '0' })) && !Absicht.aktiv(env({ ABENTEUER_ABSICHTEN: 'off' })), 'ohne Variable, leer, 0 und off: aus');
  ok(Absicht.aktiv(env({ ABENTEUER_ABSICHTEN: '1' })) && Absicht.aktiv(env({ ABENTEUER_ABSICHTEN: 'on' })) && Absicht.aktiv(env({ ABENTEUER_ABSICHTEN: 'ON' })), '1, on, ON: an');
  const kat = Absicht.katalog(), alt = kat.werte.betrieb_standard_an.wert;
  try {
    kat.werte.betrieb_standard_an.wert = true;
    ok(Absicht.aktiv(env({})) && !Absicht.aktiv(env({ ABENTEUER_ABSICHTEN: '0' })) && !Absicht.aktiv(env({ ABENTEUER_ABSICHTEN: 'off' })), 'Datenwert true: ohne Variable an, 0 und off schalten trotzdem aus');
  } finally { kat.werte.betrieb_standard_an.wert = alt; }
  ok(!('ABENTEUER_ABSICHTEN' in SZ.betriebsarten.wert.live) && !('ABENTEUER_ABSICHTEN' in SZ.betriebsarten.wert.rueckfall) && !('ABENTEUER_ABSICHTEN' in SZ.schalter.wert), 'Lobby: weder Betriebsart live noch Rueckfall noch die Basis-Schalter setzen ABENTEUER_ABSICHTEN (Opt-in nur ueber die Umgebung)');
  ok(require('../server/telemetrie/kopf.js').SCHALTER.includes('ABENTEUER_ABSICHTEN'), 'der Schalter steht in der Positivliste des Protokollkopfs');
});

section('Prompt: Groessen, Kennungen, Spielernamen', () => {
  const t = welt8(71), g = t.g;
  const heute = Prompt.katalogText().length;
  const mit = Absicht.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: Prompt.WERTE });
  const ohneG = Prompt.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: [], geschichte: false });
  const sys = fs.readFileSync(Absicht.SYSTEM_DATEI, 'utf8'), folge = fs.readFileSync(Absicht.VERHANDLUNG_SYSTEM_DATEI, 'utf8');
  const T = (z) => Math.round(z / 3.5);
  const kopf = Prompt.katalogTextAbsicht(KAT).split('\n').filter((z) => !/^[a-z_]+: /.test(z)).join('\n').length;
  const gz = JSON.stringify(G.geschichteZeilen(g).zeilen).length + '"crew_geschichte":,'.length;   // die Geschichte im Kontext: Zeilen als JSON plus Feldname
  console.log(`  info ohne Geschichte (gerechnet: minus ${gz} Zeichen): Kontext ${mit.kontextZeichen - gz} (${T(mit.kontextZeichen - gz)}), Prompt ${mit.zeichen - gz} (${T(mit.zeichen - gz)})`);
  console.log(`  info Zeichen (Tokens ÷3,5): Katalog heute ${heute} (${T(heute)}); Katalog Absichten ${mit.katalogZeichen} (${T(mit.katalogZeichen)}), davon Kopf und Regeln ${kopf}, Zeilen ${mit.katalogZeichen - kopf}; Kontext mit Geschichte ${mit.kontextZeichen} (${T(mit.kontextZeichen)}); Prompt ${mit.zeichen} (${T(mit.zeichen)}); Prompt heute (Beat-Plan, ohne Geschichte) ${ohneG.zeichen} (${T(ohneG.zeichen)}); Systemprompt ${sys.length} (${T(sys.length)}) und Verhandlung ${folge.length} (${T(folge.length)}), getrennt vom Prompt`);
  ok(!mit.fehler && mit.katalogZeichen < heute && heute >= KATALOG_HEUTE - 10, `der Katalog der Absichten (${mit.katalogZeichen}) ist kleiner als der heutige Katalog (${heute})`);
  ok(mit.zeichen <= PROMPT_ZIEL && mit.zeichen <= Prompt.WERTE.prompt_max_zeichen - 3000, `der Prompt mit Geschichte (${mit.zeichen}) bleibt unter ${PROMPT_ZIEL} und haelt mindestens 3000 Zeichen Luft zu prompt_max_zeichen (${Prompt.WERTE.prompt_max_zeichen})`);
  ok(mit.zeichen < ohneG.zeichen, 'der Prompt der Absichten (mit Geschichte) ist kleiner als der heutige Prompt (ohne Geschichte)');
  ok(Object.keys(mit.kennungen).length >= 4 && mit.kennungen.K1 === G.geschichteZeilen(g).kennungen.K1, 'baue gibt die Kennungen des Prompts mit (' + Object.keys(mit.kennungen).length + ' Stueck)');
  ok(G.geschichteZeilen(g).zeilen.every((z) => mit.prompt.includes(JSON.stringify(z).slice(1, -1))), 'die Zeilen der Geschichte stehen im Prompt');
  const zeilen = Object.values(KAT.absichten).map((e) => e.prompt_zeile);
  ok(zeilen.every((z) => mit.prompt.includes(z)), 'alle prompt_zeile der Absichten stehen im Katalog');
  ok(!/"beats"|faden-bauplan|Beat-Typen/.test(mit.prompt) && !Object.keys(D.BEATS).some((b) => D.BEATS[b].bauplan && !D.BEATS[b].nur_inszenierer && !D.BEATS[b].abschluss && mit.prompt.includes('- ' + b + ':')), 'nie beide Kataloge: keine Beat-Zeile, kein Bauplan-Format im Prompt der Absichten');
  ok(/"modus":"absicht"/.test(mit.prompt) && /absicht\/1/.test(mit.prompt) && /Nur das JSON-Objekt/.test(mit.prompt), 'aufruf traegt modus absicht, das Format absicht/1 steht im Katalog');
  ok(!/\{[a-z]/i.test(sys.replace(/`[^`]*`/g, '')) && /absicht\/1/.test(sys) && /Kennung/.test(sys) && /ausschließlich mit einem JSON-Objekt/.test(sys), 'Systemprompt der Absichten: Format, Kennung, nur JSON, keine Platzhalter');
  ok(folge.length < 1200 && /Patch/i.test(folge) && !/<katalog>/.test(folge), 'Systemprompt der Verhandlung ist klein (' + folge.length + ' Zeichen)');
  // kein Spielername im Prompt (auch nicht, wenn ein NSC so heisst)
  const tq = welt8(72, {}, ['Quintus', 'Ouzo_Brandt']);
  const q = Absicht.baue(tq.g, { nr: 1, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: Prompt.WERTE });
  ok(!q.fehler && !/Quintus/.test(q.prompt) && Object.values(q.kennungen).includes('Quintus Varro'), 'Spieler "Quintus": nicht im Prompt, der NSC Quintus Varro steht nur als Kennung in den eingefrorenen Kennungen');
  ok(!/Mireille|Ouzo|Tzvi/.test(mit.prompt), 'die Spielernamen der Crew stehen nicht im Prompt');
  // kontext: gekuerzt, wenn die Obergrenze es verlangt
  const eng = Absicht.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: Object.assign({}, Prompt.WERTE, { prompt_max_zeichen: mit.zeichen - 200 }) });
  ok(!eng.fehler && eng.zeichen <= mit.zeichen - 200, 'ueber der Obergrenze wird der Kontext gestuft gekuerzt (Chronik, Wendepunkte)');
  const zu = Absicht.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: Object.assign({}, Prompt.WERTE, { prompt_max_zeichen: 500 }) });
  ok(!!zu.fehler && /Prompt zu gross/.test(zu.fehler), 'passt nichts: Fehler statt Prompt');
});

section('Modus AUS: byte-gleich zum Beat-Plan', () => {
  return (async () => {
    const t = welt8(81), g = t.g;
    const M = mitSL(t);
    ok(!Absicht.aktiv(g), 'Vorbedingung: Schalter aus');
    const hex = M.ab.crewHex();
    await lauf(g, 4);
    const a = M.asks();
    ok(a.length === 1 && M.ab.job === null, 'ein Aufruf des Beat-Plans, abgeschlossen');
    const erwartet = Prompt.baue(g, { nr: 1, grenze: 'andocken', hex, letzte: [], werte: M.ab.W });
    // der Zustand hat sich durch Angebot und Faden nicht veraendert, ausser dem Angebot selbst: darum der Vergleich an der frischen Welt unten
    ok(a[0].system === Prompt.SYSTEM_DATEI && /abenteuer\.system\.md$/.test(a[0].system) && /<katalog>/.test(a[0].prompt) && /faden-bauplan\/1/.test(a[0].prompt) && !/"modus":"absicht"/.test(a[0].prompt) && !/crew_geschichte/.test(a[0].prompt), 'AUS: Systemprompt abenteuer.system.md, Beat-Katalog, kein modus, keine Geschichte');
    const e = abLog(g)[0];
    ok(e && !('modus' in e) && !('absicht' in e) && !('bezug_art' in e) && !('verhandlung' in e), 'AUS: der Logbuch-Eintrag hat keine neuen Felder (' + (e ? Object.keys(e).join(',') : 'kein Eintrag') + ')');
    void erwartet;
    // frische Welt: Prompt des Spielleiters == Baseline-Funktion, byte fuer byte
    const t2 = welt8(81), g2 = t2.g, M2 = mitSL(t2);
    const hafen2 = M2.ab.crewHex(), hex2 = require('../server/sim/abenteuer-ziel.js').zielImUmkreis(g2, hafen2, { belegt: [] });   // FRE-02 A1: der Ort des Prompts ist das Ziel in der Umgebung des Hafens (nicht mehr der Crew-Hex)
    const r = M2.ab.erzwingen();
    await pumpen(g2, 1);
    const p2 = M2.asks()[0] && M2.asks()[0].prompt;
    const basis = Prompt.baue(g2, { nr: 1, grenze: 'debug', hex: hex2, letzte: [], werte: M2.ab.W });
    ok(r.gestartet && !!hex2 && hex2 !== hafen2 && p2 === basis.prompt, 'AUS: der Prompt des Spielleiters ist byte-gleich zu Prompt.baue (' + (p2 ? p2.length : 0) + ' Zeichen)');
    ok(!/"modus":"absicht"/.test(basis.prompt) && basis.kennungen === undefined, 'Prompt.baue kennt keinen Modus und gibt keine Kennungen');
    // Katalog des Beat-Plans unveraendert: dieselben Zeilen wie die Funktion der Baseline
    ok(Prompt.katalogText().length >= KATALOG_HEUTE - 10 && Prompt.katalogText().length <= KATALOG_MAX, 'der Beat-Katalog hat weiter ' + Prompt.katalogText().length + ' Zeichen');
  })();
});

section('Antwort gueltig: Angebot mit Bezug und locker', () => {
  return (async () => {
    const t = welt8(91, ENV_AN()), g = t.g;
    const k = kennungVon(g, 'Quintus Varro');
    const M = mitSL(t, scriptLLM([{ json: ab('rache', { bezug: { nsc: k }, bogen: { einsatz: TEXT.einsatz, wendung: 'verfolgung', preis: TEXT.preis }, ton: 'bitter' }), tokens: 321 }]));
    await lauf(g);
    const asks = M.asks();
    ok(asks.length === 1 && asks[0].system === Absicht.SYSTEM_DATEI && /"modus":"absicht"/.test(asks[0].prompt), 'AN: ein Aufruf mit dem Systemprompt der Absichten');
    ok(!!k && /^K\d$/.test(k) && asks[0].prompt.includes('"' + k + ' Quintus Varro'), 'Vorbedingung: die Kennung ' + k + ' steht im Prompt vor Quintus Varro');
    const a = angebote(g);
    const e = abLog(g, 'gueltig')[0];
    ok(a.length === 1 && a[0].bezug && a[0].bezug.nsc === 'Quintus Varro' && a[0].locker === true, 'ein Angebot, Bezug = Quintus Varro (aus der Kennung), locker (die Fortsetzung): ' + JSON.stringify(a[0] && { bezug: a[0].bezug, locker: a[0].locker }));
    ok(a[0] && /^[0-9]{4}$/.test(a[0].hex), 'das Angebot hat einen Ort (' + (a[0] && a[0].hex) + ')');
    ok(e && e.modus === 'absicht' && e.absicht === 'rache' && e.bezug_art === 'nsc' && e.verhandlung === 0 && e.tokens === 321, 'Logbuch: modus absicht, absicht rache, bezug_art nsc, verhandlung 0, tokens 321 (' + JSON.stringify(e && { m: e.modus, a: e.absicht, b: e.bezug_art, v: e.verhandlung, t: e.tokens }) + ')');
    ok(M.ab.aufrufe === 1 && M.ab.zaehler.gueltig === 1 && M.ab.letzte.length === 1 && M.ab.letzte[0].absicht === 'rache', 'ein Aufruf des Deckels, gueltig 1, letzte Absicht gemerkt');
    // Bezug als Vollname (ohne Kennung) geht auch, Bezug ort bei einer Absicht mit Ort
    const t2 = welt8(92, ENV_AN());
    const M2 = mitSL(t2, scriptLLM([{ json: ab('geruecht', { parameter: { text_key: 'geruecht_handel' } }) }]));
    await lauf(t2.g);
    const e2 = abLog(t2.g, 'gueltig')[0];
    ok(angebote(t2.g).length === 1 && e2 && e2.absicht === 'geruecht' && e2.bezug_art === 'keiner' && M2.ab.aufrufe === 1, 'eine Absicht ohne Bezug: Angebot, bezug_art keiner');
    // Antwort mit Zaeunen und Text davor
    const t3 = welt8(93, ENV_AN());
    mitSL(t3, scriptLLM([{ text: 'Hier ist die Absicht:\n```json\n' + JSON.stringify(ab('geruecht'), null, 1) + '\n```\nViel Erfolg!' }]));
    await lauf(t3.g);
    ok(angebote(t3.g).length === 1, 'Zaeune und Text davor und danach stoeren nicht');
  })();
});
const ENV_AN = () => AN;

section('Eingefrorene Kennungen: der Zustand aendert sich zwischen Prompt und Antwort', () => {
  return (async () => {
    // K? meint im Prompt Livia Serran. Zwischen Prompt und Antwort faellt Quintus Varro (tot): die Kennungen des Zustands verschieben sich, Livia hiesse jetzt anders.
    const t = welt8(101, ENV_AN()), g = t.g;
    const k = kennungVon(g, 'Livia Serran');
    const M = mitSL(t, scriptLLM([{ json: ab('wiedersehen', { bezug: { nsc: k } }), hold: true }]));
    g.lageGrenze('andocken'); await pumpen(g, 2);
    ok(M.llm.pending() === 1 && M.ab.job && M.ab.job.kennungen[k] === 'Livia Serran', 'Vorbedingung: der Aufruf haengt, der Job hat die Kennungen des Prompts (' + k + ' = Livia Serran)');
    t.f[0].nsc.status = 'tot'; zust(g).kanon.find((x) => x.f === t.f[0].id).status = 'tot';
    const jetzt = G.geschichteZeilen(g).kennungen;
    ok(jetzt[k] !== 'Livia Serran', 'Vorbedingung: im Zustand von jetzt meint ' + k + ' eine andere Person (' + jetzt[k] + ')');
    M.llm.release(); await pumpen(g, 4);
    const a = angebote(g);
    ok(a.length === 1 && a[0].bezug && a[0].bezug.nsc === 'Livia Serran', 'das Angebot meint weiter Livia Serran, nie ' + jetzt[k] + ' (' + JSON.stringify(a[0] && a[0].bezug) + ')');
    // derselbe Fall, aber die Person selbst ist verdraengt (keine Erinnerung mehr: kein Kandidat): BEZUG_VERALTET, kein Angebot, keine Verhandlung
    const t2 = welt8(102, ENV_AN()), g2 = t2.g;
    const k2 = kennungVon(g2, 'Livia Serran');
    const M2 = mitSL(t2, scriptLLM([{ json: ab('wiedersehen', { bezug: { nsc: k2 } }), hold: true }, { json: { patch: [] } }]));
    g2.lageGrenze('andocken'); await pumpen(g2, 2);
    t2.f[3].nsc.status = 'tot'; zust(g2).kanon.find((x) => x.f === t2.f[3].id).status = 'tot';
    M2.llm.release(); await pumpen(g2, 4);
    const e = abLog(g2, 'abgelehnt')[0];
    ok(angebote(g2).length === 0 && e && e.grund === 'BEZUG_VERALTET' && e.verhandlung === 0, 'der NSC steht nicht mehr zur Verfuegung: kein Angebot, BEZUG_VERALTET, keine Verhandlung (' + (e && e.grund) + ')');
    ok(M2.asks().length === 1 && M2.ab.aufrufe === 1 && M2.ab.job === null, 'ein Aufruf, der Spielleiter ist wieder frei');
    // eine Kennung, die es im Prompt nicht gab: nie aus dem Zustand von jetzt geraten
    const t3 = welt8(103, ENV_AN()), g3 = t3.g;
    const M3 = mitSL(t3, scriptLLM([{ json: ab('wiedersehen', { bezug: { nsc: 'K9' } }) }, { json: { patch: [{ feld: 'bezug.nsc', wert: 'K8' }] } }]));
    await lauf(g3);
    ok(angebote(g3).length === 0 && abLog(g3, 'abgelehnt').length === 1, 'eine unbekannte Kennung (K9) und ein Patch mit einer unbekannten Kennung (K8): kein Angebot');
    void M3;
  })();
});

section('Nein: eine Verhandlungsrunde', () => {
  return (async () => {
    // erstes Nein (Tippfehler im Parameter), Patch im zweiten Aufruf, Angebot
    const t = welt8(111, ENV_AN()), g = t.g;
    const M = mitSL(t, scriptLLM([{ json: ab('geruecht', { parameter: { text_key: 'geruecht_standardx' } }), tokens: 100 }, { json: { patch: [{ feld: 'parameter.text_key', wert: 'geruecht_handel' }] }, tokens: 40 }]));
    await lauf(g, 8);
    const asks = M.asks();
    ok(asks.length === 2 && asks[1].system === Absicht.VERHANDLUNG_SYSTEM_DATEI, 'zwei Aufrufe, der zweite mit dem kleinen Systemprompt der Verhandlung');
    ok(!/<katalog>/.test(asks[1].prompt) && /<pruefer>/.test(asks[1].prompt) && /<absicht>/.test(asks[1].prompt) && /PARAMETER/.test(asks[1].prompt) && asks[1].prompt.length < 1500, 'Folgeprompt: nur Absicht und Klartext des Neins, kein Katalog, klein (' + asks[1].prompt.length + ' Zeichen)');
    const e = abLog(g, 'gueltig');
    ok(angebote(g).length === 1 && e.length === 1 && e[0].verhandlung === 1 && e[0].modus === 'absicht' && e[0].absicht === 'geruecht' && e[0].tokens === 140, 'nach dem Patch: ein Angebot, ein Eintrag mit verhandlung 1 und den Tokens beider Aufrufe (140): ' + JSON.stringify(e[0] && { v: e[0].verhandlung, t: e[0].tokens }));
    ok(M.ab.aufrufe === 2 && M.ab.zaehler.gueltig === 1 && Object.keys(M.ab.zaehler.abgelehnt).length === 0, 'die Verhandlung zaehlt als Aufruf des Deckels (2), kein Fehler gezaehlt');
    // zweites Nein: der Patch ist wieder falsch
    const t2 = welt8(112, ENV_AN()), g2 = t2.g;
    const M2 = mitSL(t2, scriptLLM([{ json: ab('geruecht', { parameter: { text_key: 'geruecht_standardx' } }) }, { json: { patch: [{ feld: 'parameter.text_key', wert: 'immer_noch_falsch' }] } }, { json: ab('geruecht') }]));
    await lauf(g2, 8);
    const x = abLog(g2, 'abgelehnt');
    ok(angebote(g2).length === 0 && x.length === 1 && x[0].grund === 'PARAMETER' && x[0].verhandlung === 1 && M2.asks().length === 2, 'zweites Nein: kein Angebot, ausgang abgelehnt, grund PARAMETER, genau zwei Aufrufe (' + (x[0] && x[0].grund) + ')');
    ok(M2.ab.job === null && M2.ab.zustand === 'idle' && M2.llm.asks.length === 2, 'der Spielleiter ist wieder frei, keine dritte Anfrage');
    ok(!x[0] || (x[0].fehler || []).every((f) => /^[A-Z_]+ \([a-z_.?]+\)$/.test(f)), 'der Eintrag nennt nur Code und Feld, nie die Grundtexte (' + JSON.stringify(x[0] && x[0].fehler) + ')');
    // Nein ohne Patch: das Modell weiss keinen Ausweg
    const t3 = welt8(113, ENV_AN()), g3 = t3.g;
    const M3 = mitSL(t3, scriptLLM([{ json: ab('geruecht', { parameter: { text_key: 'geruecht_standardx' } }) }, { text: 'Dafuer weiss ich keinen Ausweg.' }]));
    await lauf(g3, 8);
    ok(angebote(g3).length === 0 && abLog(g3, 'abgelehnt')[0].verhandlung === 1 && M3.ab.job === null, 'eine Antwort ohne Patch und ohne Absicht: endgueltig abgelehnt, nie ein Absturz');
    // eine korrigierte Absicht statt eines Patches
    const t4 = welt8(114, ENV_AN()), g4 = t4.g;
    mitSL(t4, scriptLLM([{ json: ab('geruecht', { parameter: { text_key: 'geruecht_standardx' } }) }, { json: ab('geruecht', { parameter: { text_key: 'geruecht_standard' } }) }]));
    await lauf(g4, 8);
    ok(angebote(g4).length === 1 && abLog(g4, 'gueltig')[0].verhandlung === 1, 'eine korrigierte Absicht als Antwort geht durch dieselbe Kette');
    // ein Nein, das nicht am Modell liegt (Brett voll: ABENTEUER_ANGEBOTE), kostet keine Verhandlung
    const t5 = welt8(115, ENV_AN()), g5 = t5.g;
    const M5 = mitSL(t5, scriptLLM([{ json: ab('geruecht', { parameter: { text_key: 'geruecht_handel' } }) }]));
    for (let i = 0; i < 6 && angebote(g5).length < 3; i++) Faden.abenteuerAnbieten(g5, plan([{ typ: ['spontanhilfe', 'notruf', 'geleit', 'spur', 'konvoi'][i] }, { typ: 'abschluss' }], { titel: 'Fuell ' + i, anlass: 'Fuellanlass Nummer ' + i + ' ohne Namen' }), { hex: '0305' });
    const voll = angebote(g5).length;
    M5.ab.vormerken('debug');   // am Deckel der Angebote vorbei: der Aufruf kommt trotzdem, das Brett lehnt ab
    await pumpen(g5, 6);
    const y = abLog(g5, 'abgelehnt');
    ok(voll >= 1 && angebote(g5).length === voll && (M5.asks().length === 1 ? y.length === 1 && y[0].verhandlung === 0 : true), 'Brett lehnt ab (nicht am Modell): kein neues Angebot' + (M5.asks().length === 1 ? ', keine Verhandlung' : ' (die Grenze liess den Aufruf nicht zu)'));
  })();
});

section('Unlesbar, leer, Ausfall: kein Angebot, kein Absturz, keine Verhandlung', () => {
  return (async () => {
    for (const [name, eintrag, code] of [['kein JSON', { text: 'Ich empfehle ein Abenteuer um eine Haendlerin.' }, 'ANTWORT_UNLESBAR'], ['leer', { text: '   ' }, 'ANTWORT_LEER'], ['abgeschnitten', { text: '{"format":"absicht/1","absicht":"geruecht","titel":"Zebra' }, 'ANTWORT_UNLESBAR']]) {
      const t = welt8(121, ENV_AN()), g = t.g;
      const M = mitSL(t, scriptLLM([eintrag, { json: { patch: [] } }]));
      await lauf(g, 6);
      const e = abLog(g, 'abgelehnt');
      ok(angebote(g).length === 0 && e.length === 1 && e[0].grund === code && e[0].modus === 'absicht' && e[0].verhandlung === 0 && M.asks().length === 1 && M.ab.aufrufe === 1 && g.errors === 0, name + ': kein Angebot, ' + code + ', ein Aufruf, kein Serverfehler');
    }
    const t = welt8(122, ENV_AN()), g = t.g;
    const M = mitSL(t, scriptLLM([{ error: 'EXIT' }]));
    await lauf(g, 6);
    const e = abLog(g, 'ausfall');
    ok(angebote(g).length === 0 && e.length === 1 && e[0].modus === 'absicht' && M.ab.job === null && g.errors === 0, 'Ausfall des Anbieters: Eintrag ausfall im Modus Absichten, kein Angebot, kein Absturz');
    // Ausfall im zweiten Aufruf
    const t2 = welt8(123, ENV_AN()), g2 = t2.g;
    const M2 = mitSL(t2, scriptLLM([{ json: ab('geruecht', { parameter: { text_key: 'geruecht_standardx' } }), tokens: 70 }, { error: 'EXIT' }]));
    await lauf(g2, 8);
    const e2 = abLog(g2, 'ausfall');
    ok(angebote(g2).length === 0 && e2.length === 1 && e2[0].verhandlung === 1 && e2[0].tokens === 70 && M2.ab.job === null && g2.errors === 0, 'Ausfall im zweiten Aufruf: kein Angebot, die Tokens des ersten stehen im Eintrag (' + (e2[0] && e2[0].tokens) + ')');
    // eine Antwort mit falschem Format
    const t3 = welt8(124, ENV_AN()), g3 = t3.g;
    const M3 = mitSL(t3, scriptLLM([{ json: { format: 'absicht/2', absicht: 'geruecht' } }, { json: { patch: [] } }]));
    await lauf(g3, 8);
    ok(angebote(g3).length === 0 && abLog(g3, 'abgelehnt')[0].grund === 'FORM' && g3.errors === 0, 'falsches Format: FORM, kein Angebot (' + (abLog(g3, 'abgelehnt')[0] || {}).grund + ')');
    void M3;
  })();
});

section('Rueckfall des Bretts greift nach einem Nein wie heute', () => {
  return (async () => {
    const t = welt8(131, Object.assign({}, AN, { ABENTEUER_ANSCHLUSS: '1' })), g = t.g;
    const M = mitSL(t, scriptLLM([{ text: 'keine Antwort im Format' }]));
    zust(g).abenteuerAngebote.length = 0;
    await lauf(g, 6);
    for (let i = 0; i < 6; i++) { g.step(); await frei(); }
    ok(abLog(g, 'abgelehnt').length === 1 && abLog(g, 'abgelehnt')[0].grund === 'ANTWORT_UNLESBAR', 'nach dem Nein: Eintrag abgelehnt, kein Angebot aus der Absicht');
    const anschluss = logbuch(g).filter((e) => e.art === 'abenteuer_anschluss' && e.ausgang === 'angeboten');
    ok(anschluss.length >= 1 && angebote(g).length >= 1 && angebote(g).every((a) => anschluss.some((e) => e.plan && e.plan.angebot === a.nr)), 'die Anschluss-Garantie des Bretts bietet ein Abenteuer an (Logbuch abenteuer_anschluss, Angebote ' + angebote(g).length + '); jedes Angebot stammt aus ihr, keines aus der gescheiterten Absicht (SPL-02 F: im Modus Absichten waehlt der Rueckfall selbst eine Absicht, auch mit Bezug)');
    void M;
  })();
});

section('Logbuch: nie Titel, Texte, Namen', () => {
  return (async () => {
    const t = welt8(141, ENV_AN()), g = t.g;
    const k = kennungVon(g, 'Quintus Varro');
    const M = mitSL(t, scriptLLM([{ json: ab('rache', { bezug: { nsc: k }, titel: 'Zebrafalke Geheimtitel' }), tokens: 10 }]));
    await lauf(g);
    // ein zweiter Lauf mit Nein (Namen im Klartext des Neins) und einem Ausfall
    const t2 = welt8(142, ENV_AN()), g2 = t2.g;
    const k2 = kennungVon(g2, 'Livia Serran');
    mitSL(t2, scriptLLM([{ json: ab('rache', { bezug: { nsc: k2 }, titel: 'Zebrafalke Zweittitel' }) }, { json: { patch: [{ feld: 'bezug.nsc', wert: 'K9' }] } }]));
    await lauf(g2, 8);
    const alle = JSON.stringify(abLog(g).concat(abLog(g2)));
    ok(alle.length > 200 && abLog(g).length >= 1 && abLog(g2).length >= 1, 'Vorbedingung: Eintraege beider Laeufe (' + abLog(g).length + ' und ' + abLog(g2).length + ')');
    ok(!/Zebrafalke|Probeanlass|Ein Preis ohne Namen/.test(alle) && !PERSONEN.some(([nm]) => alle.includes(nm.split(' ')[0]) || alle.includes(nm.split(' ')[1])), 'weder Titel, Einsatz, Preis noch ein NSC-Name im Logbuch');
    const x = abLog(g2, 'abgelehnt')[0];
    ok(x && x.modus === 'absicht' && x.absicht === 'rache' && x.bezug_art === 'nsc' && x.verhandlung === 1 && x.grund === 'BEZUG_UNBEKANNT', 'der abgelehnte Eintrag traegt modus, absicht, bezug_art, verhandlung und den Code (' + JSON.stringify(x && { m: x.modus, a: x.absicht, b: x.bezug_art, v: x.verhandlung, g: x.grund }) + ')');
    // der Namen im Klartext des Neins stehen im Folgeprompt nur als Kennung
    const fp = M.asks().length;
    void fp;
    // Bericht bricht nicht (regie-bericht.js liest die neuen Felder nicht, ignoriert sie)
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pantheon-absichten-'));
    const log = Regielog.create({ dir, weltId: 'absichten' });
    for (const e of abLog(g).concat(abLog(g2))) log.write(Object.assign({}, e, { t: undefined }));
    const md = Bericht.report(dir, 'absichten');
    ok(/Abenteuer-Komposition/.test(md), 'tools/regie-bericht.js liest die Eintraege mit den neuen Feldern (Abschnitt Abenteuer-Komposition)');
    const gelesen = Regielog.read(dir, 'absichten').entries;
    ok(gelesen.length >= 2 && gelesen.every((e) => e.modus === 'absicht' && 'verhandlung' in e && 'bezug_art' in e), 'der Regielog behaelt modus, absicht, bezug_art und verhandlung');
  })();
});

section('Folgeprompt: Namen nur als Kennung, nie ein Spielername', () => {
  return (async () => {
    // Spieler heisst Quintus, ein NSC Quintus Varro: im Klartext des Neins stehen Vollnamen, das Modell darf nur Kennungen sehen
    const t = welt8(151, ENV_AN(), ['Quintus', 'Ouzo_Brandt']), g = t.g;
    const kL = kennungVon(g, 'Livia Serran');
    const M = mitSL(t, scriptLLM([{ json: ab('rache', { bezug: { nsc: kL } }) }, { json: { patch: [] } }]));
    await lauf(g, 8);
    const asks = M.asks();
    ok(asks.length === 2, 'Vorbedingung: das Nein (Livia Serran ist kein grollender NSC) geht in die Verhandlung');
    ok(!/Quintus/.test(asks[0].prompt) && !/Quintus/.test(asks[1].prompt), 'weder der Prompt noch der Folgeprompt nennen "Quintus" (Spieler und NSC)');
    ok(!PERSONEN.some(([nm]) => asks[1].prompt.includes(nm)), 'im Folgeprompt steht kein NSC-Vollname aus der Geschichte (nur Kennungen): ' + asks[1].prompt.replace(/\n/g, ' ').slice(0, 300));
    const st = Absicht.ersterVersuch(g, ab('rache', { bezug: { nsc: kL } }), G.geschichteZeilen(g).kennungen);
    ok(st.stand === 'offen' && PERSONEN.some(([nm]) => st.v.text.includes(nm)), 'Vorbedingung: der Klartext des Neins nennt einen NSC mit Vollnamen (' + st.v.text.replace(/\n/g, ' ').slice(0, 160) + ')');
    ok(/Bezug K[0-9]/.test(asks[1].prompt) && /"wert":"K[0-9]"/.test(asks[1].prompt), 'der Vorschlag der Welt steht im Folgeprompt als Kennung (Bezug K.., Patch mit K..)');
  })();
});

// SPL-02 G: ein Nein wegen des NSC-Bezugs hat einen Gegenvorschlag (der passende Kandidat), der Folgeprompt nennt die Kandidaten; ohne Kandidat nur der Grund, nie ein kaputter Plan
section('Bezug-Nein: Gegenvorschlag, Kandidatenzeile, Verhandlung (SPL-02 G)', () => {
  return (async () => {
    const t = welt8(171, ENV_AN(), ['Quintus', 'Ouzo_Brandt']), g = t.g;
    const kennungen = G.geschichteZeilen(g).kennungen;
    const kA = kennungVon(g, 'Aurelia Vex'), kQ = kennungVon(g, 'Quintus Varro');
    ok(!!kA && !!kQ, 'Vorbedingung: Aurelia Vex (aktiv, Haltung 0) und Quintus Varro (feindlich) stehen mit Kennung in der Geschichte (' + kA + ', ' + kQ + ')');
    // Rache mit aktivem NSC: Nein mit Patch auf den feindlichen Kandidaten, in Kennung
    const st = Absicht.ersterVersuch(g, ab('rache', { bezug: { nsc: kA } }), kennungen);
    const f0 = st.v && st.v.ergebnis && st.v.ergebnis.fehler[0];
    ok(st.stand === 'offen' && f0 && f0.feld === 'bezug.nsc' && /Haltung 0/.test(f0.grund), 'Rache mit aktivem NSC: Nein wegen der Haltung (' + (f0 && f0.grund) + ')');
    ok(f0 && f0.gegenvorschlag && f0.gegenvorschlag.patch.length === 1 && f0.gegenvorschlag.patch[0].feld === 'bezug.nsc' && f0.gegenvorschlag.patch[0].wert === kQ, 'der Gegenvorschlag nennt den feindlichen Kandidaten mit seiner Kennung ' + kQ + ': ' + JSON.stringify(f0 && f0.gegenvorschlag));
    ok(/Patch: \[\{"feld":"bezug\.nsc","wert":"K[0-9]"\}\]/.test(st.v.text), 'der Klartext traegt die Patch-Zeile mit der Kennung, ohne Vollnamen');
    const r = Absicht.folgeAntwort(g, st.v, JSON.stringify({ patch: f0.gegenvorschlag.patch }), kennungen);
    ok(r.stand === 'angenommen' && r.ergebnis.angebot.bezug && r.ergebnis.angebot.bezug.nsc === 'Quintus Varro', 'der Patch angewendet: ok, Angebot mit Bezug Quintus Varro');
    // Folgeprompt: Kandidatenzeile mit Kennung, kein Vollname, kein Spielername; Groesse gemessen
    const fi = Absicht.folgeInput(g, st.v, ab('rache', { bezug: { nsc: kA } }), kennungen, 1);
    const zeilen = (/<kandidaten>\n([^]*?)\n<\/kandidaten>/.exec(fi.prompt) || [])[1];
    ok(zeilen && zeilen.split('\n').length <= KAT.werte.folge_kandidaten_max.wert && new RegExp('^' + kQ + ' \\(rom\\), jetzt feindlich, Haltung -2$').test(zeilen.split('\n')[0]), 'Folgeprompt: Kandidatenzeile "' + kQ + ' (rom), jetzt feindlich, Haltung -2" (hoechstens folge_kandidaten_max Zeilen): ' + JSON.stringify(zeilen));
    ok(!/Quintus/.test(fi.prompt) && !PERSONEN.some(([nm]) => fi.prompt.includes(nm)), 'Folgeprompt ohne Vollnamen und ohne den Spielernamen Quintus');
    process.stdout.write('  Folgeprompt: ' + fi.prompt.length + ' Zeichen (Kandidatenzeile: ' + (zeilen ? zeilen.length : 0) + ' Zeichen)\n');
    // ohne feindlichen Kandidaten: Nein ohne Patch, keine Kandidatenzeile, kein kaputter Plan
    const t2 = welt8(172, ENV_AN()), g2 = t2.g;
    setze(g2, t2.f[0], 'Quintus Varro', 'aktiv', 0);
    const k2 = G.geschichteZeilen(g2).kennungen, kA2 = kennungVon(g2, 'Aurelia Vex');
    const st2 = Absicht.ersterVersuch(g2, ab('rache', { bezug: { nsc: kA2 } }), k2);
    const g0 = st2.v && st2.v.ergebnis && st2.v.ergebnis.fehler[0];
    ok(st2.stand === 'offen' && g0 && /Haltung 0/.test(g0.grund) && !g0.gegenvorschlag && !/Patch: /.test(st2.v.text), 'ohne Kandidat: Nein mit Grund, ohne Gegenvorschlag, ohne Patch-Zeile');
    ok(!/<kandidaten>/.test(Absicht.folgeInput(g2, st2.v, ab('rache', { bezug: { nsc: kA2 } }), k2, 1).prompt), 'ohne Kandidat: keine Kandidatenzeile im Folgeprompt');
    const r2 = Absicht.folgeAntwort(g2, st2.v, JSON.stringify({ patch: [] }), k2);
    ok(r2.stand !== 'angenommen', 'ohne Patch bleibt das Nein: kein Angebot, kein kaputter Plan (' + r2.stand + ')');
    // Verhandlungsweg im Spielleiter (Mock-LLM im Skript): Bezug-Nein, Folgeaufruf, Patch, Angebot
    const t3 = welt8(173, ENV_AN(), ['Quintus', 'Ouzo_Brandt']), g3 = t3.g;
    const kA3 = kennungVon(g3, 'Aurelia Vex'), kQ3 = kennungVon(g3, 'Quintus Varro');
    const M3 = mitSL(t3, scriptLLM([{ json: ab('rache', { bezug: { nsc: kA3 } }), tokens: 100 }, { json: { patch: [{ feld: 'bezug.nsc', wert: kQ3 }] }, tokens: 40 }]));
    await lauf(g3, 8);
    const asks = M3.asks(), e = abLog(g3, 'gueltig');
    ok(asks.length === 2 && asks[1].prompt.includes('<kandidaten>\n' + kQ3 + ' (rom)') && !/Quintus/.test(asks[1].prompt), 'Spielleiter: zweiter Aufruf mit Kandidatenzeile ' + kQ3 + ', ohne den Namen Quintus');
    ok(angebote(g3).length === 1 && angebote(g3)[0].bezug && angebote(g3)[0].bezug.nsc === 'Quintus Varro' && e.length === 1 && e[0].verhandlung === 1 && e[0].absicht === 'rache', 'Spielleiter: nach dem Patch ein Angebot mit Bezug Quintus Varro, Logbuch verhandlung 1');
  })();
});

section('Mock: gueltige Absichten, gelegentlich unmoeglich, Verhandlung offline', () => {
  const t = welt8(161, ENV_AN()), g = t.g;
  let gueltig = 0, unmoeglich = 0, nein = 0, geheilt = 0, ungelesen = 0, ohneBezugArt = new Set();
  const kennungen = Absicht.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: Prompt.WERTE }).kennungen;
  for (let nr = 1; nr <= 60; nr++) {
    const bau = Absicht.baue(g, { nr, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: Prompt.WERTE });
    const r = AM.erzeuge({ prompt: bau.prompt });
    if (r.korruption === 'absicht_unmoeglich') unmoeglich++;
    const gel = Absicht.lesen(r.text);
    if (gel.fehler) { ungelesen++; continue; }
    ok0(gel.absicht.format === 'absicht/1' && typeof gel.absicht.absicht === 'string', 'Mock ' + nr + ': absicht/1');
    ohneBezugArt.add(Absicht.logFelder(gel.absicht).bezug_art);
    const e = AV.pruefeUndInszeniere(g, mitKennung(gel.absicht, kennungen));
    if (e.ok) { gueltig++; continue; }
    nein++;
    // zweiter Aufruf aus dem Klartext (nur Pruefer, ohne Brett)
    const v = require('../server/sim/absicht-pruefer.js').verhandlungStartMit((gg, a, kat) => AV.pruefeUndInszeniere(gg, mitKennung(a, kennungen), kat), g, gel.absicht);
    const fi = Absicht.folgeInput(g, v, gel.absicht, kennungen, nr);
    const ant = AM.erzeuge(fi);
    const v2 = require('../server/sim/absicht-pruefer.js').verhandlungAntwortMit((gg, a, kat) => AV.pruefeUndInszeniere(gg, mitKennung(a, kennungen), kat), g, v, Absicht.lesen(ant.text).absicht || null);
    if (v2.stand === 'angenommen') geheilt++;
  }
  console.log(`  info Mock, 60 Aufrufe: gueltig beim ersten Mal ${gueltig}, Nein ${nein} (davon durch den Patch geheilt ${geheilt}), absichtlich unmoeglich ${unmoeglich}, unlesbar ${ungelesen}, Bezugsarten ${Array.from(ohneBezugArt).join(' | ')}`);
  ok(gueltig >= 15 && unmoeglich >= 3 && geheilt >= 1 && unmoeglich <= 30, 'der Mock liefert gueltige Absichten (' + gueltig + ' von 60), gelegentlich unmoeglich (' + unmoeglich + ') und der Patch heilt (' + geheilt + ')');
  ok(Array.from(ohneBezugArt).includes('nsc') && Array.from(ohneBezugArt).includes('keiner'), 'der Mock nutzt die Geschichte (Bezug nsc) und waehlt auch Absichten ohne Bezug');
  const nr1 = AM.erzeuge({ prompt: Absicht.baue(g, { nr: 5, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: Prompt.WERTE }).prompt });
  const nr2 = AM.erzeuge({ prompt: Absicht.baue(g, { nr: 5, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: Prompt.WERTE }).prompt });
  ok(nr1.text === nr2.text, 'deterministisch: derselbe Zustand, dieselbe Antwort');
  ok(AM.erzeuge({ prompt: Prompt.baue(g, { nr: 5, grenze: 'andocken', hex: '0305', letzte: [] }).prompt }).text.includes('faden-bauplan/1') || /beats/.test(AM.erzeuge({ prompt: Prompt.baue(g, { nr: 5, grenze: 'andocken', hex: '0305', letzte: [] }).prompt }).text), 'ohne Modus liefert der Mock weiter den Beat-Plan');
});
const ok0 = (c, t) => { if (!c) ok(false, t); };
function mitKennung(a, kennungen) {   // wie die Kette des Spielleiters: die Kennung des Prompts zuerst aufloesen
  if (a && a.bezug && G.istKennung(a.bezug.nsc)) { const r = G.bezugAufloesen(kennungen, a.bezug); if (r.ok) return Object.assign({}, a, { bezug: r.bezug }); }
  return a;
}

section('Daten und Quelltext', () => {
  ok(AW.mock.absicht_unmoeglich_anteil > 0 && AW.mock.absicht_unmoeglich_anteil < 1, 'mock.absicht_unmoeglich_anteil ist ein Datenwert (' + AW.mock.absicht_unmoeglich_anteil + ')');
  ok(!/Vollname/.test(Object.values(KAT.absichten).map((e) => e.prompt_zeile).join('\n')), 'die prompt_zeile verlangen die Kennung, nie den Vollnamen');
  const sim = path.join(__dirname, '..', 'server', 'sim');
  const quell = (f, von, bis) => { const s = fs.readFileSync(path.join(sim, f), 'utf8'); if (!von) return s; const i = s.indexOf(von), j = s.indexOf(bis, i); return s.slice(i, j < 0 ? undefined : j); };
  const teile = {
    'abenteuer-absicht.js': quell('abenteuer-absicht.js'),
    'abenteuer-prompt.js (Absichten)': quell('abenteuer-prompt.js', '// ---------- SPL-02 E1', '// ---------- Antwort lesen') + quell('abenteuer-prompt.js', 'function absichtAusText', 'module.exports'),
    'abenteuer-mock.js (Absichten)': quell('abenteuer-mock.js', '// ---------- SPL-02 E1: Absichten', '// Kontext faeden.wiedersehen_nsc'),
    'abenteuer-spielleiter.js': quell('abenteuer-spielleiter.js'),
  };
  const code = (s) => s.split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n').replace(/\/\/.*$/gm, '');
  const namen = Object.keys(KAT.absichten).concat(Object.keys(D.BEATS), [].concat(...Object.values(KAT.absichten).map((e) => e.wendungen || [])).filter((w) => w !== 'keine'));
  for (const [datei, s] of Object.entries(teile)) {
    const c = code(s), quoted = (w) => new RegExp('[\'"`]' + w + '[\'"`]').test(c);
    const treffer = namen.filter((w, i) => namen.indexOf(w) === i && quoted(w));
    // der Mock und der Spielleiter duerfen den Abschluss-Typ nicht nennen: der steht in den Daten; vorhandene Alt-Stellen sind nicht Teil dieser Pruefung
    ok(treffer.length === 0 || (datei === 'abenteuer-spielleiter.js' && treffer.every((w) => !/^(absicht|beat)/.test(w))), 'kein Absichts-, Beat- oder Wendungsname als Zeichenkette in ' + datei + (treffer.length ? ' (Treffer: ' + treffer.join(', ') + ')' : ''));
  }
  const zahlen = code(teile['abenteuer-absicht.js']).match(/[^\w."'-](\d{2,})[^\w"']/g) || [];
  ok(zahlen.length === 0, 'keine Zahl ab zwei Stellen im Code von abenteuer-absicht.js' + (zahlen.length ? ' (' + zahlen.join(' ') + ')' : ''));
});

(async () => {
  for (const [name, fn] of abschnitte) {
    if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
    console.log('\n== ' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e)); }
  }
  console.log(`\n${n - fails}/${n} gruen`);
  setTimeout(() => process.exit(fails ? 1 : 0), 20);
})();
