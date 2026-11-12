'use strict';
// FRE-03 E: Vorrat je Art (server/sim/abenteuer-vorrat.js hinzufuegen, toSave, lesen, werteFehler, gueltig, ausVorratFuerNotruf; abenteuer-brett.js notrufAusVorrat, notrufAngebotAnlegen, vorratArtVon, ablehnen, verfallenEinlegen;
// Daten content/faeden/absichten.json vorrat_max_je_art und vorrat_alter_max_s_je_art, content/faeden/abenteuer-brett.json vorrat_art_notruf; Schema content/schema/weltstand.schema.json maxItems). Geprueft:
//   Quote je Art: bei {angebot 4, notruf 2} ergeben 5 Angebote und 3 Notrufe 4 und 2, die Summe bleibt vorrat_max, toSave und lesen behalten sie, eine Art ohne Quote hat nur vorrat_max, ein Altstand ohne die Daten laedt wie vorher ·
//   ausVorrat('notruf') liefert nur Notruf-Eintraege · werteFehler (Daten der Quoten und der Spielzeit-Arten) · Alter in SPIELZEIT (game.time) fuer die Art notruf, in Ticks fuer die anderen ·
//   Entnahme BEIM ENTSTEHEN eines Takt-Notrufs (Absichten-Modus): ein gueltiger Notruf-Plan statt des Daten-Plans, am Ort des Notrufs, ohne Komponisten-Aufruf; Alter, Ort und Welt werden neu geprueft; ohne ABENTEUER_ABSICHTEN=1 INAKTIV
//   und das Verhalten aus D (Daten-Plan, Vorrat unberuehrt) · Einlegen: Ablehnen und Verfall eines Notruf-Angebots mit vollstaendigem Bogen legen unter der Art notruf ein (Alter bleibt), der Daten-Plan nie ·
//   Luecke aus D: ein gefuellter Vorrat im Absichten-Modus fuellt das Brett bis angebote_max, auch wenn Notruf-Angebote am Brett stehen (Notruf-Angebote zaehlen nicht mit).
//   node tools/test-vorrat-je-art.js        (npm run test:vorrat-je-art; Mutationsprobe: npm run test:vorrat-je-art-mutation)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const R = require('./regie-fixture.js');
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Besitz = require('../server/sim/besitz.js');
const Ruf = require('../server/sim/ruf.js');
const RE = require('../server/sim/reise-ereignis.js');
const B1 = require('../server/sim/faden-b1.js');
const Faden = require('../server/sim/faden.js');
const P = require('../server/sim/faden-pruefer.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const AP = require('../server/sim/absicht-pruefer.js');
const V = require('../server/sim/abenteuer-vorrat.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); f(); };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const KAT = AP.katalogStandard();
const MAX = KAT.werte.vorrat_max.wert, ALTER = KAT.werte.vorrat_alter_max.wert;
const JE_ART = KAT.werte.vorrat_max_je_art.wert, ZEIT_ART = KAT.werte.vorrat_alter_max_s_je_art.wert;
const BW = lies('content/faeden/abenteuer-brett.json').werte;
const ART = BW.vorrat_art.wert, ART_N = BW.vorrat_art_notruf.wert;
const WERTE = lies('content/faeden/werte.json').werte.abenteuer.wert;
const MAXA = WERTE.angebote_max;
const HZ = CONFIG.tickHz;
const TEXT = { titel: 'Zebrafalke Probe Titel', einsatz: 'Ein Probeanlass ohne Namen fuer den Test.', preis: 'Ein Preis ohne Namen fuer den Test.' };
const ab = (name, o) => Object.assign({ format: 'absicht/1', absicht: name, titel: TEXT.titel, parameter: {}, bezug: {}, bogen: { einsatz: TEXT.einsatz, wendung: 'keine', preis: TEXT.preis }, ton: 'nuechtern' }, o || {});
const notrufAb = (i) => ab('notruf', { titel: 'Zebrafalke Notruf Nummer ' + i, parameter: { text_key: 'notruf_standard' }, ton: 'dringlich' });
const angebotAb = (i) => ab('geruecht', { titel: 'Zebrafalke Angebot Nummer ' + i });
const zust = (g) => Faden.zustandVon(g);
const vorrat = (g) => V.liste(g);
const jeArt = (g, art) => vorrat(g).filter((e) => e.art === art);
const setzeHex = (g, h) => { g.ship.scene = Sektoren.ortVonHex(h); };
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const eintrag = (g, absicht, art, o) => { const r = V.eintrag(g, Object.assign({ absicht, art }, o || {})); if (!r.ok) throw new Error('Eintrag nicht gebaut: ' + JSON.stringify(r)); return r.eintrag; };
const legeEin = (g, absicht, art) => { const r = V.hinzufuegen(g, eintrag(g, absicht, art)); if (!r.ok) throw new Error('nicht aufgenommen: ' + JSON.stringify(r)); return r; };
const titelVon = (e) => e.absicht.titel;

// ---------------------------------------------------------------- Welt A: Lage-Spielleiter (Mock), Hafen 0305, Absichten (wie test-abenteuer-vorrat-verdrahtet.js)
function weltA(seed, o) {
  o = o || {};
  const env = Object.assign({ FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' }, o.ohne ? {} : { ABENTEUER_ABSICHTEN: '1' });
  const t = X.F.neuesSpiel({ crew: 1, seed: seed || 7, names: ['Mireille_Kas'], env });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  setzeHex(t.g, '0305');
  zust(t.g).abenteuerAngebote.length = 0;
  return t;
}

// ---------------------------------------------------------------- Welt B: Reise-Takt (wie test-reise-notruf-brett.js), Absichten an oder aus
const ENV_B = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };
const W = RE.WERTE;
const SCHWELLE = Math.round(W.takt_s * HZ);
const NOTRUFE = RE.KATALOG.filter((e) => e.art === 'notruf');
const Rz = (g) => g.weltsim.reise;
const sektorenVon = (g, besitzer) => Object.keys(Sektoren.KARTE.hexe).filter((h) => Sektoren.spielbar(h) && !Sektoren.istLeerraum(h) && Sektoren.hatSzene(h) && (Besitz.besitzer(g, h) || 'frei') === besitzer).sort();
function nur(ids, fn) { const kopie = RE.KATALOG.slice(); RE.KATALOG.length = 0; for (const e of kopie) if (ids.includes(e.id)) RE.KATALOG.push(e); try { return fn(); } finally { RE.KATALOG.length = 0; RE.KATALOG.push(...kopie); } }
// Einen Takt-Notruf erzwingen; vorher(g) fuellt den Vorrat (einmal, an einem Ort mit gueltigem Eintrag). o.absichten: ABENTEUER_ABSICHTEN=1 -> { t, g, hex, o, a } | null
function takt(e, opt) {
  opt = opt || {};
  const t = R.neuesSpiel({ crew: 1, seed: 7, env: Object.assign({}, ENV_B, opt.absichten ? { ABENTEUER_ABSICHTEN: '1' } : {}) }), g = t.g;
  g.weltsim.zustand.flotten = [];
  Ruf.debug(g, ['rom', '30']);
  const b = (e.bedingungen.besitzer || ['rom'])[0];
  let gefuellt = false;
  for (const h of sektorenVon(g, b)) {
    setzeHex(g, h);
    if (opt.vorher && !gefuellt) { try { opt.vorher(g); gefuellt = true; } catch (x) { continue; } }
    Rz(g).offen = []; Rz(g).taktIds = []; Rz(g).takt = SCHWELLE - 1;
    nur([e.id], () => g.step());
    if (Rz(g).offen.length === 1 && Rz(g).offen[0].id === e.id) { const o = Rz(g).offen[0]; return { t, g, hex: h, o, a: P.notrufAngebote(zust(g)).find((x) => x.notruf.marke === o.marke) || null }; }
  }
  return null;
}
const E0 = NOTRUFE[4];
const aufrufe = (g) => g.lageSpielleiter.abenteuer.aufrufe;

// ======================================================================
section('Daten: Quote je Art, Spielzeit-Arten, Art des Notruf-Vorrats', () => {
  ok(V.werteFehler().length === 0, 'die Werte vorrat_* (mit Quoten und Spielzeit-Arten) sind stimmig');
  ok(JE_ART.angebot === 4 && JE_ART.notruf === 2, 'vorrat_max_je_art {angebot 4, notruf 2} (' + JSON.stringify(JE_ART) + ')');
  ok(Object.values(JE_ART).reduce((a, b) => a + b, 0) <= MAX, 'die Summe der Quoten liegt nicht ueber vorrat_max (' + MAX + ')');
  ok(JE_ART[ART] >= 1 && JE_ART[ART_N] >= 1 && ART !== ART_N && ART_N === 'notruf', 'vorrat_art (' + ART + ') und vorrat_art_notruf (' + ART_N + ') sind zwei Arten mit je einer Quote');
  ok(Number.isInteger(ZEIT_ART[ART_N]) && ZEIT_ART[ART_N] >= 1 && !(ART in ZEIT_ART), 'nur die Art notruf altert in Spielzeit (' + JSON.stringify(ZEIT_ART) + '), die Art angebot in Ticks');
  const schema = lies('content/schema/weltstand.schema.json');
  const suche = (o) => { if (!o || typeof o !== 'object') return null; if (o.vorrat && o.vorrat.type === 'array' && o.vorrat.maxItems) return o.vorrat.maxItems; for (const k of Object.keys(o)) { const r = suche(o[k]); if (r) return r; } return null; };
  const maxItems = suche(schema);
  ok(Number.isInteger(maxItems) && maxItems >= MAX, 'Weltstand-Schema: maxItems des Vorrats (' + maxItems + ') liegt nicht unter vorrat_max (' + MAX + ')');
  const mit = (f) => { const k = klon(KAT); f(k.werte); return V.werteFehler(k); };
  ok(mit((w) => { w.vorrat_max_je_art.wert = { angebot: 4, notruf: 3 }; }).some((x) => /Summe der Quoten/.test(x)), 'werteFehler: die Summe der Quoten ueber vorrat_max wird gemeldet');
  ok(mit((w) => { w.vorrat_max_je_art.wert = { Angebot: 2 }; }).some((x) => /name_muster/.test(x)), 'werteFehler: ein Artname gegen name_muster wird gemeldet');
  ok(mit((w) => { w.vorrat_max_je_art.wert = { angebot: 0 }; }).some((x) => /vorrat_max_je_art\.angebot/.test(x)), 'werteFehler: Quote 0 wird gemeldet');
  ok(mit((w) => { w.vorrat_max_je_art.wert = { angebot: 1.5 }; }).length >= 1 && mit((w) => { w.vorrat_max_je_art.wert = [4]; }).length >= 1, 'werteFehler: keine ganze Zahl / keine Tabelle wird gemeldet');
  ok(mit((w) => { w.vorrat_alter_max_s_je_art.wert = { notruf: 0 }; }).length >= 1 && mit((w) => { w.vorrat_alter_max_s_je_art.wert = { 'N-1': 5 }; }).some((x) => /name_muster/.test(x)), 'werteFehler: Sekunden < 1 und falscher Name bei vorrat_alter_max_s_je_art');
  ok(mit((w) => { delete w.vorrat_max_je_art; delete w.vorrat_alter_max_s_je_art; }).length === 0, 'werteFehler: ohne beide Werte (Altdaten) kein Fehler');
});

// ======================================================================
section('Quote je Art: 5 Angebote und 3 Notrufe ergeben 4 und 2', () => {
  const t = weltA(7), g = t.g;
  for (let i = 0; i < 5; i++) legeEin(g, angebotAb(i), ART);
  ok(jeArt(g, ART).length === 4 && titelVon(jeArt(g, ART)[0]) === 'Zebrafalke Angebot Nummer 1' && titelVon(jeArt(g, ART)[3]) === 'Zebrafalke Angebot Nummer 4', 'fuenf Angebote: vier bleiben, das aelteste weicht (' + jeArt(g, ART).map(titelVon).join(' | ') + ')');
  for (let i = 0; i < 3; i++) legeEin(g, notrufAb(i), ART_N);
  ok(jeArt(g, ART_N).length === 2 && titelVon(jeArt(g, ART_N)[0]) === 'Zebrafalke Notruf Nummer 1' && titelVon(jeArt(g, ART_N)[1]) === 'Zebrafalke Notruf Nummer 2', 'drei Notrufe: zwei bleiben, der aelteste weicht (' + jeArt(g, ART_N).map(titelVon).join(' | ') + ')');
  ok(jeArt(g, ART).length === 4 && vorrat(g).length === 6 && vorrat(g).length <= MAX, 'die Notrufe verdraengen kein Angebot (4 + 2 = 6, vorrat_max ' + MAX + ')');
  // toSave und lesen behalten die Quoten
  const save = V.toSave(zust(g));
  ok(save.length === 6 && save.filter((e) => e.art === ART).length === 4 && save.filter((e) => e.art === ART_N).length === 2, 'toSave behaelt 4 + 2');
  const F2 = { ladeFehler: [], vorrat: undefined };
  V.lesen(klon(save), F2);
  ok(F2.vorrat.length === 6 && F2.vorrat.filter((e) => e.art === ART_N).length === 2 && F2.ladeFehler.length === 0, 'lesen behaelt 4 + 2 ohne Meldung');
  // zu viele je Art im Speicherstand: die neuesten je Art bleiben
  const viel = klon(save).concat(Array.from({ length: 3 }, (_, i) => Object.assign(klon(save[5]), { absicht: Object.assign(klon(save[5].absicht), { titel: 'Zebrafalke Notruf Spaet ' + i }) })));
  const F3 = { ladeFehler: [], vorrat: undefined };
  V.lesen(viel, F3);
  ok(F3.vorrat.filter((e) => e.art === ART_N).length === 2 && F3.vorrat.length <= MAX, 'lesen: ein Speicherstand mit zu vielen Notrufen wird auf die Quote gekuerzt (' + F3.vorrat.length + ')');
  const F4 = { ladeFehler: [], vorrat: undefined };
  V.lesen(klon(viel).reverse(), F4);
  ok(F4.vorrat.filter((e) => e.art === ART_N).length === 2 && F4.vorrat.length <= MAX, 'lesen: auch in anderer Reihenfolge');
  // toSave kuerzt von sich aus (ein Zustand, der die Quoten nicht kennt, etwa nach einem Eingriff von aussen)
  const roh = { vorrat: save.concat(Array.from({ length: 3 }, (_, i) => Object.assign(klon(save[5]), { absicht: Object.assign(klon(save[5].absicht), { titel: 'Zebrafalke Notruf Roh ' + i }) }))) };
  const ts = V.toSave(roh);
  ok(ts.filter((e) => e.art === ART_N).length === 2 && ts.filter((e) => e.art === ART).length === 4 && titelVon(ts[ts.length - 1]) === 'Zebrafalke Notruf Roh 2', 'toSave kuerzt je Art auf die Quote, die neuesten bleiben (' + ts.length + ')');
  const rohFrei = { vorrat: Array.from({ length: MAX + 3 }, (_, i) => Object.assign(klon(save[0]), { art: 'frei_art', absicht: Object.assign(klon(save[0].absicht), { titel: 'Zebrafalke Frei Roh ' + i }) })) };
  ok(V.toSave(rohFrei).length === MAX && titelVon(V.toSave(rohFrei)[MAX - 1]) === 'Zebrafalke Frei Roh ' + (MAX + 2), 'toSave: eine Art ohne Quote bleibt bei vorrat_max (die neuesten)');
  const rohGemischt = { vorrat: Array.from({ length: MAX }, (_, i) => Object.assign(klon(save[0]), { art: 'frei_art', absicht: Object.assign(klon(save[0].absicht), { titel: 'Zebrafalke Gemischt ' + i }) })).concat([save[4], save[5]]) };
  const tg = V.toSave(rohGemischt);
  ok(tg.length === MAX && tg.filter((e) => e.art === ART_N).length === 2 && tg.filter((e) => e.art === 'frei_art').length === MAX - 2, 'toSave: die Summe vorrat_max gilt ueber alle Arten (' + tg.length + ')');
  // ueber den ganzen Weltstand-Block des Bretts
  const block = Brett.toSave(zust(g));
  ok(block && block.vorrat.length === 6, 'Brett.toSave: der Vorrat steht im Block (' + (block && block.vorrat.length) + ')');
  // ausVorrat('notruf') liefert nur Notruf-Eintraege (Absicht notruf), ausVorrat('angebot') nur Angebote
  const reserve = eintrag(g, notrufAb(9), ART_N);   // vor dem ersten Angebot gebaut (danach sperrt die Wiederholungsregel einen neuen Notruf-Eintrag)
  const a1 = V.ausVorrat(g, ART_N);
  ok(a1.ok && a1.angebot.absicht.absicht === 'notruf' && a1.angebot.absicht.titel === 'Zebrafalke Notruf Nummer 1', 'ausVorrat(notruf) liefert einen Notruf-Eintrag (' + (a1.ok ? a1.angebot.absicht.titel : a1.grund) + ')');
  ok(jeArt(g, ART_N).length === 1 && jeArt(g, ART).length === 4, 'danach: 1 Notruf, die 4 Angebote unberuehrt');
  const t2 = weltA(7);
  for (let i = 0; i < 2; i++) legeEin(t2.g, angebotAb(i), ART);
  const leer = V.ausVorrat(t2.g, ART_N);
  ok(!leer.ok && leer.grund === V.CODES.VORRAT_LEER && jeArt(t2.g, ART).length === 2, 'nur Angebote im Vorrat: ausVorrat(notruf) liefert nichts und ruehrt sie nicht an (' + leer.grund + ')');
  // eine Wiederholungsregel (dieselbe Typenfolge wie ein eben angebotener Notruf) ist kein Mangel des Eintrags: ausVorratFuerNotruf laesst ihn liegen, ausVorrat verwirft ihn (FRE-02, unveraendert)
  let gerufen = 0;
  const wd = V.ausVorratFuerNotruf(g, ART_N, '0305', () => { gerufen++; return { ok: true }; });
  ok(!wd.ok && gerufen === 0 && jeArt(g, ART_N).length === 1, 'ausVorratFuerNotruf: ein Nein der Welt (WELT_BEDINGUNG: Wiederholung) laesst den Eintrag im Vorrat (' + wd.grund + ')');
  const INS = require('../server/sim/inszenierer.js'), echteIns = INS.inszeniere;
  try {
    INS.inszeniere = () => ({ ok: false, fehler: [{ code: INS.CODES.BEZUG_VERALTET || 'BEZUG_VERALTET', feld: 'bezug.nsc', text: 'x' }] });
    const ver = V.ausVorratFuerNotruf(g, ART_N, '0305', () => ({ ok: true }));
    ok(!ver.ok && jeArt(g, ART_N).length === 0, 'ausVorratFuerNotruf: ein veralteter Bezug verwirft den Eintrag');
  } finally { INS.inszeniere = echteIns; }
  // kein freies Ziel (alle vergeben) ist ebenfalls kein Mangel: der Eintrag bleibt
  zust(g).vorrat.push(klon(reserve));
  try {
    INS.inszeniere = () => ({ ok: false, fehler: [{ code: INS.CODES.ORT_KEIN_ZIEL, feld: INS.FELD_ZIELE_VERGEBEN, text: 'x' }] });
    const kz = V.ausVorratFuerNotruf(g, ART_N, '0305', () => ({ ok: true }));
    ok(!kz.ok && jeArt(g, ART_N).length === 1, 'ausVorratFuerNotruf: kein freies Ziel laesst den Eintrag im Vorrat');
  } finally { INS.inszeniere = echteIns; }
  const a4 = V.ausVorrat(g, ART);
  ok(a4.ok && a4.angebot.absicht.absicht === 'geruecht', 'ausVorrat(angebot) liefert ein Angebot');
});

section('Arten ohne Quote: nur vorrat_max; Altstand ohne die Daten laedt wie vorher', () => {
  const t = weltA(7), g = t.g;
  for (let i = 0; i < MAX + 2; i++) legeEin(g, ab('geruecht', { titel: 'Zebrafalke Frei Nummer ' + i }), 'frei_art');
  ok(vorrat(g).length === MAX && titelVon(vorrat(g)[0]) === 'Zebrafalke Frei Nummer 2', 'eine Art ohne Quote: es gilt vorrat_max (' + vorrat(g).length + '), der aelteste weicht');
  legeEin(g, notrufAb(0), ART_N); legeEin(g, notrufAb(1), ART_N);
  ok(vorrat(g).length === MAX && jeArt(g, ART_N).length === 2 && jeArt(g, 'frei_art').length === MAX - 2, 'Summe bleibt vorrat_max: zwei Notrufe verdraengen die aeltesten freien Eintraege (' + jeArt(g, 'frei_art').length + ' frei)');
  const save = V.toSave(zust(g));
  ok(save.length === MAX, 'toSave: Summe vorrat_max (' + save.length + ')');
  // ohne die beiden Werte (alte Daten): wie vorher, nur vorrat_max
  const alt = { q: KAT.werte.vorrat_max_je_art, z: KAT.werte.vorrat_alter_max_s_je_art };
  delete KAT.werte.vorrat_max_je_art; delete KAT.werte.vorrat_alter_max_s_je_art;
  try {
    const t2 = weltA(7), g2 = t2.g;
    for (let i = 0; i < MAX + 2; i++) legeEin(g2, ab('geruecht', { titel: 'Zebrafalke Alt Nummer ' + i }), ART);
    ok(vorrat(g2).length === MAX && titelVon(vorrat(g2)[0]) === 'Zebrafalke Alt Nummer 2', 'ohne vorrat_max_je_art: wie vorher, ' + MAX + ' Angebote (' + vorrat(g2).length + ')');
    const F5 = { ladeFehler: [], vorrat: undefined };
    V.lesen(klon(V.toSave(zust(g2))), F5);
    ok(F5.vorrat.length === MAX && F5.ladeFehler.length === 0, 'ohne vorrat_max_je_art: toSave und lesen wie vorher (' + F5.vorrat.length + ')');
    const e = eintrag(g2, notrufAb(0), ART_N);
    g2.time = 99999;
    ok(V.gueltig(g2, e).ok && e.erstellt === 0, 'ohne vorrat_alter_max_s_je_art: auch die Art notruf altert in Ticks (kein Spielzeit-Alter)');
  } finally { KAT.werte.vorrat_max_je_art = alt.q; KAT.werte.vorrat_alter_max_s_je_art = alt.z; }
});

// ======================================================================
section('Alter in Spielzeit (Art notruf) statt Ticks, Ticks fuer die anderen Arten', () => {
  const t = weltA(7), g = t.g;
  g.time = 100.7;
  const en = eintrag(g, notrufAb(0), ART_N), ea = eintrag(g, angebotAb(0), ART);
  ok(en.erstellt === 100 && ea.erstellt === g.weltsim.tickZahl, 'erstellt: Notruf in ganzen Sekunden (' + en.erstellt + '), Angebot im Tick der Weltsim (' + ea.erstellt + ')');
  g.time = 100 + ZEIT_ART[ART_N];
  ok(V.gueltig(g, en).ok, 'genau vorrat_alter_max_s Sekunden spaeter: der Notruf gilt noch');
  g.time = 100 + ZEIT_ART[ART_N] + 1;
  const alt = V.gueltig(g, en);
  ok(!alt.ok && alt.grund === V.CODES.ABGELAUFEN, 'eine Sekunde mehr: ABGELAUFEN (' + alt.grund + ')');
  ok(V.gueltig(g, ea).ok, 'das Angebot (Ticks) ist von der Spielzeit unberuehrt');
  g.weltsim.tickZahl = ea.erstellt + ALTER;
  ok(V.gueltig(g, ea).ok, 'das Angebot gilt genau vorrat_alter_max Ticks lang (' + ALTER + ')');
  g.weltsim.tickZahl = ea.erstellt + ALTER + 1;
  ok(V.gueltig(g, ea).grund === V.CODES.ABGELAUFEN, 'das Angebot altert in Ticks, nicht in Sekunden: danach ABGELAUFEN');
  g.weltsim.tickZahl = ea.erstellt;
  // ein eigenes ablauf in der Uhr der Art
  const eb = eintrag(g, notrufAb(1), ART_N, { ablauf: 100 + ZEIT_ART[ART_N] + 10 });
  g.time = 100 + ZEIT_ART[ART_N] + 5; const ez = eintrag(g, notrufAb(2), ART_N, { ablauf: g.time + 3 });
  g.time += 4;
  ok(!V.gueltig(g, ez).ok && V.gueltig(g, ez).grund === V.CODES.ABGELAUFEN, 'ablauf des Eintrags ist in Sekunden (nach dem Ablauf: ABGELAUFEN)');
  // die Uhr laeuft echt unter g.step(): der Vorrat altert, obwohl weltsim.tickZahl 0 bleibt
  const t2 = weltA(7), g2 = t2.g;
  legeEin(g2, notrufAb(0), ART_N);
  const e0 = vorrat(g2)[0];
  const tick0 = g2.weltsim.tickZahl;
  lauf(g2, 2);
  ok(g2.time - e0.erstellt >= 1 && g2.weltsim.tickZahl === tick0, 'unter g.step() vergeht Spielzeit (' + (g2.time - e0.erstellt).toFixed(1) + ' s), tickZahl bleibt ' + g2.weltsim.tickZahl + ': nur die Spielzeit kann hier altern lassen');
  g2.time = e0.erstellt + ZEIT_ART[ART_N] + 1;
  const v = V.verwirfUngueltige(g2);
  ok(v.length === 1 && v[0].grund === V.CODES.ABGELAUFEN && vorrat(g2).length === 0, 'verwirfUngueltige entfernt den gealterten Notruf (' + JSON.stringify(v) + ')');
});

// ======================================================================
section('Entnahme beim Entstehen eines Takt-Notrufs (Absichten-Modus)', () => {
  const befuellen = (g) => { legeEin(g, notrufAb(0), ART_N); legeEin(g, angebotAb(0), ART); };
  const m = takt(E0, { absichten: true, vorher: befuellen });
  ok(!!m && !!m.a, 'ein Takt-Notruf entsteht mit Brett-Angebot');
  if (m && m.a) {
    const { g, o, a } = m;
    ok(a.absicht.titel === 'Zebrafalke Notruf Nummer 0' && !!a.absicht.bogen && a.absicht.absicht === 'notruf', 'das Angebot traegt den Plan aus dem Vorrat (Titel, Bogen) statt des Daten-Plans (' + a.absicht.titel + ')');
    ok(a.hex === o.hex && a.vorlage.titel === 'Zebrafalke Notruf Nummer 0', 'Ort = der Ort DES NOTRUFS (' + a.hex + '), nicht der gespeicherte Ort des Eintrags');
    ok(a.notruf.marke === o.marke && a.notruf.id === E0.id && a.bezug && typeof a.bezug.sprecher === 'string' && a.herkunft && a.herkunft.hex === m.hex, 'Notruf-Felder wie bei D: notruf (Eintrag), bezug.sprecher, herkunft ' + (a.herkunft && a.herkunft.hex));
    ok(jeArt(g, ART_N).length === 0 && jeArt(g, ART).length === 1, 'der Eintrag verliess den Vorrat, das Angebot (andere Art) blieb');
    ok(aufrufe(g) === 0 && g.lageSpielleiter.aufrufe === 0 && g.errors === 0, 'KEIN Komponistenaufruf (aufrufe ' + aufrufe(g) + '), keine Fehler');
    ok(Number.isInteger(a.erstellt) && a.erstellt >= 0 && a.erstellt <= Math.floor(g.time), 'das Angebot traegt das erste Alter des Eintrags (Sekunden ' + a.erstellt + ')');
    const s = Brett.snapshot(g), se = s && s.angebote.find((x) => x.id === 'a' + a.nr);
    ok(!!se && se.notruf === 1 && se.ort === o.hex && se.titel === 'Zebrafalke Notruf Nummer 0', 'im Snapshot als Notruf-Angebot mit dem Titel des Plans');
    ok(Brett.annehmen(g, 'a' + a.nr) === null && Faden.zustandVon(g).liste.some((f) => f.vorlage === a.ref && f.phase === 'laeuft'), 'Annehmen startet den Faden (Beat notruf laeuft)');
  }

  // Alter wird bei der Entnahme neu geprueft: ein gealterter Notruf wird verworfen, der Daten-Plan gilt
  const alter = takt(E0, { absichten: true, vorher: (g) => { befuellen(g); g.time += ZEIT_ART[ART_N] + 5; } });
  ok(!!alter && !!alter.a && alter.a.absicht.titel !== 'Zebrafalke Notruf Nummer 0' && !alter.a.absicht.bogen, 'gealterter Eintrag (Spielzeit): der Daten-Plan wird angeboten');
  if (alter) ok(jeArt(alter.g, ART_N).length === 0 && aufrufe(alter.g) === 0, 'der gealterte Eintrag ist verworfen (nicht wieder angeboten), kein Komponistenaufruf');
  // Ort/Lage wird bei der Entnahme neu geprueft: passt der Plan nicht zum Ort, bleibt der Eintrag liegen
  const echt = Brett.passtZuLage;
  let probe = null;
  try {
    Brett.passtZuLage = () => false;
    probe = takt(E0, { absichten: true, vorher: befuellen });
  } finally { Brett.passtZuLage = echt; }
  ok(!!probe && !!probe.a && !probe.a.absicht.bogen && jeArt(probe.g, ART_N).length === 1, 'passt der Plan nicht zur Lage am Ort (passtZuLage): der Eintrag bleibt im Vorrat, der Daten-Plan wird angeboten');
  // der gespeicherte Ort ist unerheblich (neu aus der Lage)
  const stale = takt(E0, { absichten: true, vorher: (g) => { befuellen(g); vorrat(g)[0].hex = '0101'; zust(g).vorrat[0].hex = '0101'; } });
  ok(!!stale && !!stale.a && stale.a.absicht.titel === 'Zebrafalke Notruf Nummer 0' && stale.a.hex === stale.o.hex, 'ein veralteter gespeicherter Ort des Eintrags stoert nicht: Ort ist der des Notrufs');
  // ein Eintrag, dessen Plan kein Notruf-Plan ist (anderer Beat), wird nicht als Notruf angeboten und bleibt
  const fremd = takt(E0, { absichten: true, vorher: (g) => { legeEin(g, ab('geruecht', { titel: 'Zebrafalke Fremder Plan' }), ART_N); } });
  ok(!!fremd && !!fremd.a && !fremd.a.absicht.bogen && jeArt(fremd.g, ART_N).length === 1, 'ein Plan ohne Beat notruf unter der Art notruf wird nicht angeboten (er bleibt liegen)');
});

section('Ohne ABENTEUER_ABSICHTEN=1: INAKTIV, Verhalten aus D (Daten-Plan, Vorrat unberuehrt)', () => {
  const m = takt(E0, { absichten: false, vorher: (g) => { const r = V.hinzufuegen(g, eintrag2(g)); if (!r.ok) throw new Error('x'); } });
  function eintrag2(g) { return { absicht: notrufAb(0), hex: '0205', art: ART_N, erstellt: Math.floor(g.time) }; }
  ok(!!m && !!m.a, 'ohne Absichten-Modus: ein Takt-Notruf entsteht mit seinem Daten-Angebot');
  if (m && m.a) {
    const { g, a } = m;
    ok(a.absicht.titel === 'Notruf: ' + a.bezug.sprecher && !a.absicht.bogen && a.vorlage.titel === a.absicht.titel, 'das Angebot ist der Daten-Plan aus notruf-brett.json (Titel "Notruf: Sprecher", ohne Bogen)');
    ok(jeArt(g, ART_N).length === 1, 'der Vorrat ist unberuehrt (1 Eintrag Notruf)');
    ok(aufrufe(g) === 0 && g.errors === 0, 'kein Komponistenaufruf, keine Fehler');
    const r = V.ausVorratFuerNotruf(g, ART_N, m.o.hex, () => ({ ok: true }));
    ok(!r.ok && r.grund === V.CODES.INAKTIV && jeArt(g, ART_N).length === 1, 'ausVorratFuerNotruf: INAKTIV, der Eintrag bleibt (' + r.grund + ')');
    ok(V.einlegenAus(g, a, ART_N).grund === V.CODES.INAKTIV, 'einlegenAus: INAKTIV');
    ok(Brett.ablehnen(g, 'a' + a.nr) === null && jeArt(g, ART_N).length === 1, 'Ablehnen des Notruf-Angebots legt nichts ein');
  }
});

// ======================================================================
section('Einlegen: Ablehnen und Verfall eines Notruf-Angebots (Absichten-Modus)', () => {
  // der Daten-Plan hat keinen vollstaendigen Bogen: einlegenAus lehnt ab, der Vorrat bleibt leer
  const m = takt(E0, { absichten: true });
  ok(!!m && !!m.a && !m.a.absicht.bogen, 'Daten-Plan als Notruf-Angebot (kein Vorrat)');
  if (m && m.a) {
    const r = V.einlegenAus(m.g, m.a, ART_N);
    ok(!r.ok && r.grund === AP.CODES.BOGEN_UNVOLLSTAENDIG && vorrat(m.g).length === 0, 'einlegenAus: BOGEN_UNVOLLSTAENDIG, nichts im Vorrat (' + r.grund + ')');
    ok(Brett.ablehnen(m.g, 'a' + m.a.nr) === null && vorrat(m.g).length === 0 && m.g.errors === 0, 'Ablehnen des Daten-Plans: nichts im Vorrat, keine Fehler');
  }
  // ein Plan aus dem Vorrat, abgelehnt: zurueck unter der Art notruf, das erste Alter bleibt
  const m2 = takt(E0, { absichten: true, vorher: (g) => { g.time = 40; legeEin(g, notrufAb(7), ART_N); } });
  ok(!!m2 && !!m2.a && m2.a.absicht.titel === 'Zebrafalke Notruf Nummer 7' && jeArt(m2.g, ART_N).length === 0, 'Plan aus dem Vorrat entnommen');
  if (m2 && m2.a) {
    const { g, a } = m2;
    const erst = a.erstellt;
    g.time += 100;
    ok(Brett.ablehnen(g, 'a' + a.nr) === null, 'Angebot abgelehnt');
    const e = jeArt(g, ART_N);
    ok(e.length === 1 && titelVon(e[0]) === 'Zebrafalke Notruf Nummer 7' && e[0].erstellt === erst && erst < Math.floor(g.time) - 50, 'abgelehnt: der Plan liegt wieder unter der Art notruf, mit seinem ersten Alter (' + (e[0] && e[0].erstellt) + ' statt ' + Math.floor(g.time) + ')');
    ok(jeArt(g, ART).length === 0 && Rz(g).offen.length === 1, 'nicht unter der Art angebot; der Notruf-Eintrag bleibt offen');
    // Notruf-Eintrag verfaellt: das (neue) Angebot fehlt, gilt als Verfall -> eingelegt. Zuerst wieder entnehmen: ein zweiter Takt-Notruf in derselben Welt
  }
  // Verfall: der Notruf-Eintrag laeuft ab, sein Angebot (Plan aus dem Vorrat) geht vom Brett und in den Vorrat
  const m3 = takt(E0, { absichten: true, vorher: (g) => { legeEin(g, notrufAb(8), ART_N); } });
  if (m3 && m3.a) {
    const { g } = m3;
    Brett.beiTaetigkeit(g);   // das Brett sieht das Angebot (gesehen)
    lauf(g, W.takt_leben_s + 1);
    ok(Rz(g).offen.every((x) => x.marke !== m3.o.marke) && !P.notrufAngebote(zust(g)).some((x) => x.notruf.marke === m3.o.marke), 'Verfall des Notruf-Eintrags: sein Angebot ist vom Brett');
    Brett.beiTaetigkeit(g);
    const e = jeArt(g, ART_N);
    ok(e.length === 1 && titelVon(e[0]) === 'Zebrafalke Notruf Nummer 8', 'Verfall: der Plan geht unter der Art notruf in den Vorrat zurueck (' + e.length + ')');
  } else ok(false, 'Verfall: Takt-Notruf mit Plan aus dem Vorrat nicht erzwingbar');
});

// ======================================================================
section('Luecke aus D: gefuellter Vorrat im Absichten-Modus, Notruf-Angebote am Brett zaehlen nicht mit', () => {
  const t = weltA(7), g = t.g;
  for (const [i, name] of ['rettung', 'lieferung', 'falscher_haendler', 'jagd'].entries()) legeEin(g, ab(name, { titel: 'Zebrafalke Angebot Nummer ' + i }), ART);
  const notr = [];
  for (let i = 0; i < 3; i++) {
    const a = Brett.notrufAnbieten(g, { nr: 900 + i, id: 'probe_' + i, hex: ['0305', '0205', '0405'][i], variante: 'havarie', sprecher: 'Kutter Probe', marke: 'probe:' + i, ankunft: '0305' });
    if (a) notr.push(a);
  }
  ok(notr.length === 3 && P.notrufAngebote(zust(g)).length === 3 && P.regulaereAngebote(zust(g)).length === 0, 'drei Notruf-Angebote am Brett, kein regulaeres (notruf_angebote_max, getrennt von angebote_max)');
  const a1 = Brett.ausVorratEinsAnbieten(g);
  ok(!!a1 && P.regulaereAngebote(zust(g)).length === 1, 'ausVorratEinsAnbieten bietet ein Angebot aus dem Vorrat trotz drei Notruf-Angeboten');
  const mehr = Brett.ausVorratFuellen(g);
  ok(mehr.length === MAXA - 1 && P.regulaereAngebote(zust(g)).length === MAXA, 'ausVorratFuellen fuellt bis angebote_max (' + MAXA + ') regulaere Angebote (' + P.regulaereAngebote(zust(g)).length + ')');
  ok(P.notrufAngebote(zust(g)).length === 3 && jeArt(g, ART).length === 4 - MAXA && Brett.ausVorratEinsAnbieten(g) === null, 'die drei Notruf-Angebote bleiben; ein volles Brett (regulaere) bietet nichts mehr an');
});

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'ALLE ' + n + ' OK'));
process.exit(fails ? 1 : 0);
