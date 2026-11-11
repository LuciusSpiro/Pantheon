'use strict';
// BEA-01 A: die Beats forderung und schmiergeld (Baustein server/sim/faden-forderung.js, Daten content/faeden/beats.json, forderung-texte.json, forderung-werte.json).
// Ein Gegner stellt die Lerche per Funk-Ultimatum, die Crew waehlt ueber die Antwortleiste (world.bitte, faden.bitte). Drei Wahlen ueber die zwei Ausgaenge zweier Beats:
//   forderung:  Ausliefern = gescheitert (Ware weg, Faden endet ohne Enthuellung/Invasion) · Nicht ausliefern = gelungen -> schmiergeld
//   schmiergeld: Bestechen = gelungen (Marken, Ware bleibt, weiter) · Verweigern = gescheitert (Ware BLEIBT, weiter in raumschlacht; sie geht nur verloren, wenn die Crew den Kampf verliert)
// Geprueft: (a) Daten und Katalog, kein Beat-Name im Servercode · (b) Pruefer: Test-Vorlagen gueltig, Gegenproben (gefahr + Optionen, sim_befehl ohne Lieferung) · (c) ausliefern · (d) verweigern ·
// (e) bestechen und zu wenig Marken · (f) Mehrspieler: die erste Antwort gilt · (g) Speichern/Laden mitten in der Wahl · (h) Frist ohne Antwort · (i) Notsprung in der Wahl · (j) forderung ohne
// Schmuggel-Vorlage (Zollschiff, ohne Haendler, Ware, Enthuellung) · (k) Anzeige (Kopf, Absender, Texte).
// Erwartete Werte: eigene Zaehlung im Test (Preise und Texte aus den Dateien gelesen, nie aus dem Produktivcode abgeleitet).      node tools/test-faden-forderung.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Faden = require('../server/sim/faden.js');
const Lager = require('../server/sim/fracht.js');
const Fracht = require('../server/sim/faden-fracht.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Bausteine = require('../server/sim/faden-bausteine.js');
const Baustein = require('../server/sim/faden-forderung.js');
const Geld = require('../server/sim/geld.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const P3 = require('../server/sim/faden-p3.js');
const V = require('./test-faden-vorlagen.js');
const X = require('./faden-fixture.js');
const { D, spiel, oeffne, grenzen, alsVorlage, registriere } = X;

const lies = (...p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const TEXTE = lies('content', 'faeden', 'forderung-texte.json');
const WERTE = lies('content', 'faeden', 'forderung-werte.json').werte;
const SZ = lies('content', 'faeden', 'szenen-werte.json');
const FH = lies('tools', 'fixtures', 'faeden', 'falscher_haendler-fad01.json');   // BEA-01 C1: Grundlage der Test-Variante ist die Vorlage wie in FAD-01 (sechs Beats, Fixture aus acf7795c); die echte Vorlage (zehn Beats, Beispiel 1) prueft test-faden-beispiel1.js
const BEAT_FRIST = 6, BITTE_FRIST = 4;   // werte.json beat_frist, bitte-werte.json frist_taetigkeiten (eigene Zahlen: stimmen sie nicht mehr, scheitert der Frist-Test sichtbar)
const ZIEL = '0305';
const PREIS = WERTE.bestechung_marken.wert.mittel;   // Standard-Staerke der Daten (staerke_standard mittel)
const PREIS_GERING = WERTE.bestechung_marken.wert.gering;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = async (t, f) => { console.log('\n' + t); try { await f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
const klon = (x) => JSON.parse(JSON.stringify(x));
const laufe = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const andocken = (g, hex) => { ankunft(g, hex); g.missionEvent('docked', {}); };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const lager = (g) => (g.fracht ? g.fracht.lager.length : 0);
const ereignisse = (f) => f.nsc.gedaechtnis.map((x) => x.ereignis);
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const marken = (g) => g.inventory.marks;
const setzeMarken = (g, k) => Geld.standSetzen(g, k, 'testmarken');

// ---------- Vorlagen (nur im Test, nicht in content/vorlagen)
const WEG = (status, weiter) => ({ status, weiter });
function optionen(typ) {
  return typ === 'forderung'
    ? [{ id: 'ausliefern', text: 'Ausliefern', ausgang: 'gescheitert', folge: [{ typ: 'haltung_aenderung', grund: 'im_stich_gelassen' }] },
       { id: 'nicht_ausliefern', text: 'Nicht ausliefern', ausgang: 'gelungen', folge: [] }]
    : [{ id: 'bestechen', text: 'Bestechen', ausgang: 'gelungen', folge: [] },
       { id: 'verweigern', text: 'Verweigern', ausgang: 'gescheitert', folge: [] }];
}
// Schmuggel: laden (geladen) -> forderung -> schmiergeld -> raumschlacht -> abliefern -> Abschluss. o.gefahr: forderung mit gefahr (Gegenprobe)
function schmuggel(id, o) {
  o = o || {};
  const r = registriere(alsVorlage(id, (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    const forderung = { id: 'b_forderung', typ: 'forderung', optionen: optionen('forderung'), aus: { gelungen: WEG('verbuendet', 'b_schmier'), gescheitert: WEG('aktiv', 'b_ende') } };
    if (o.gefahr) forderung.gefahr = true;
    v.beats = [
      { id: 'b_lade', typ: 'fracht', parameter: { nach: ZIEL, ende: 'geladen' }, aus: { gelungen: WEG('verbuendet', 'b_forderung'), gescheitert: WEG('geflohen', 'b_ende') } },
      forderung,
      { id: 'b_schmier', typ: 'schmiergeld', optionen: optionen('schmiergeld'), aus: { gelungen: WEG('verbuendet', 'b_abgabe'), gescheitert: WEG('aktiv', 'b_kampf') } },
      { id: 'b_kampf', typ: 'raumschlacht', aus: { gelungen: WEG('aktiv', 'b_abgabe'), gescheitert: WEG('aktiv', 'b_ende') } },
      { id: 'b_abgabe', typ: 'fracht', parameter: { nach: ZIEL, ende: 'abgeliefert' }, aus: { gelungen: WEG('verbuendet', 'b_ende'), gescheitert: WEG('geflohen', 'b_ende') } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['fracht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  if (!r.ok) throw new Error('Vorlage ' + id + ' ungueltig: ' + r.fehler.join('; '));
}
// Zollschiff: ohne Haendler, ohne Ware, ohne Enthuellung: forderung -> schmiergeld -> (raumschlacht) -> Abschluss
function zoll(id) {
  const r = registriere(alsVorlage(id, (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    v.beats = [
      { id: 'b_forderung', typ: 'forderung', parameter: { text_key: 'forderung_zollschiff', staerke: 'gering' }, optionen: optionen('forderung'), aus: { gelungen: WEG('aktiv', 'b_schmier'), gescheitert: WEG('aktiv', 'b_ende') } },
      { id: 'b_schmier', typ: 'schmiergeld', parameter: { text_key: 'schmiergeld_zollschiff', staerke: 'gering' }, optionen: optionen('schmiergeld'), aus: { gelungen: WEG('aktiv', 'b_ende'), gescheitert: WEG('aktiv', 'b_kampf') } },
      { id: 'b_kampf', typ: 'raumschlacht', aus: { gelungen: WEG('aktiv', 'b_ende'), gescheitert: WEG('geflohen', 'b_ende') } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['schmiergeld_gelungen', 'raumschlacht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  if (!r.ok) throw new Error('Vorlage ' + id + ' ungueltig: ' + r.fehler.join('; '));
}
function bereit(seed, k) {
  const x = spiel({ crew: 1, seed }); const g = x.g;
  const radio = []; const orig = g.emit.bind(g);
  g.emit = (e, d) => { if (e === 'radio' && d && d.text) radio.push({ von: d.from, text: d.text }); return orig(e, d); };
  g.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
  ab(g); ankunft(g, ZIEL);
  setzeMarken(g, k === undefined ? 500 : k);
  return { g, radio, texte: () => radio.map((r) => r.text) };
}
const starteBeat = (x) => { grenzen(x.g, 5); return weiter(x.g, x.f); };
// Schmuggel-Faden bis zum offenen Angebot der Forderung (Beat b_forderung laeuft, Bitte offen)
function amUltimatum(id, seed, k) {
  const x = bereit(seed, k); x.lager0 = lager(x.g);
  x.f = oeffne(x.g, id); starteBeat(x);   // b_lade
  x.vorher = marken(x.g);
  starteBeat(x);                           // b_forderung
  return x;
}
// ... und weiter bis zum Angebot des Schmiergelds (nach „Nicht ausliefern“)
function amSchmiergeld(id, seed, k) {
  const x = amUltimatum(id, seed, k);
  Bitte.beantworten(x.g, 'nicht_ausliefern', Bitte.offen(x.g).nr);
  starteBeat(x);
  return x;
}
const HAENDLER = { bau: null };   // Vorlage des Falschen Haendlers mit den neuen Beats (gebaut in (b))
const angebot = (g) => Bitte.offen(g);
const antwort = (g, id) => Bitte.beantworten(g, id, angebot(g) ? angebot(g).nr : null);

(async () => {
  bereit(1);   // laedt die Sektorendaten wie im Spiel (der Hafenname haengt davon ab)
  const WARE_NAME = SZ.werte.waren.wert.fracht_kiste.name;
  const T_VERLOREN = fmt(SZ.texte.fracht.verloren, { ware: WARE_NAME, hafen: Sektoren.hexName(ZIEL) || ZIEL });
  const T_ABGELIEFERT = fmt(SZ.texte.fracht.abgeliefert, { ware: WARE_NAME, hafen: Sektoren.hexName(ZIEL) || ZIEL });
  const FO = TEXTE.forderer.freibeuter;

  await section('(a) Daten: Katalog, Texte, Werte, Baustein; kein Beat-Name im Servercode', async () => {
    const f = D.BEATS.forderung, s = D.BEATS.schmiergeld;
    ok(f && s && f.gefahr === false && s.gefahr === false && f.optionen === 'erlaubt' && s.optionen === 'erlaubt', 'forderung und schmiergeld: gefahr false, optionen erlaubt');
    ok(f.bauplan === undefined && s.bauplan === undefined, 'beide ohne bauplan-Abschnitt: nicht planbar (Paket C)');
    ok(f.ware_bei_scheitern === undefined && s.ware_bei_scheitern === 'bleibt', 'Katalogfeld ware_bei_scheitern: forderung nicht gesetzt (Ware weg), schmiergeld "bleibt"');
    ok(s.optionen_wirkung.bestechen.kosten === 'bestechung_marken' && f.optionen_wirkung.ausliefern.kosten === undefined, 'Kosten stehen am Katalog: nur Bestechen kostet');
    ok(Pruefer.katalogFehler().length === 0, 'katalogFehler leer');
    ok(Baustein.datenFehler().length === 0, 'Daten in sich stimmig: ' + Baustein.datenFehler().join('; '));
    const bs = Bausteine.vonId(f.baustein);
    ok(bs && !Bausteine.istPlatzhalter(f.baustein) && bs.angebot === true && f.baustein === s.baustein, 'der Baustein ist echt (kein Platzhalter), bietet Optionen an, beide Beats teilen ihn');
    ok(Bausteine.vonId(D.BEATS.bitte.baustein).angebot === true, 'auch der Baustein der Bitten bietet Optionen an (Baustein-Pruefung statt Namensvergleich)');
    ok(PREIS > 0 && PREIS_GERING > 0 && PREIS_GERING < PREIS && PREIS < WERTE.bestechung_marken.wert.stark, 'Preise aus den Daten: nach Staerke aufsteigend (' + PREIS_GERING + ' / ' + PREIS + ' / ' + WERTE.bestechung_marken.wert.stark + ')');
    ok(Baustein.kostenVon({ typ: 'schmiergeld' }, 'bestechen') === PREIS && Baustein.kostenVon({ typ: 'schmiergeld', parameter: { staerke: 'gering' } }, 'bestechen') === PREIS_GERING && Baustein.kostenVon({ typ: 'schmiergeld', parameter: { staerke: 'unbekannt' } }, 'bestechen') === PREIS && Baustein.kostenVon({ typ: 'schmiergeld' }, 'verweigern') === 0, 'kostenVon: Standardstaerke, Staerke aus dem Beat, unbekannte Staerke = Standard, Option ohne Kosten = 0');
    // Textlaenge: die Leiste zeigt 90 Zeichen; laengster Platzhalter eingesetzt
    const langWare = Math.max(...Object.values(SZ.werte.waren.wert).map((w) => w.name.length));
    for (const [key, e] of Object.entries(TEXTE.texte)) {
      const t = fmt(e.text, { forderer: TEXTE.forderer[e.forderer].name, ware: 'W'.repeat(langWare), ort: 'O'.repeat(24), marken: String(WERTE.bestechung_marken.wert.stark) + ' ' + WERTE.marken_einheit.wert });
      ok(t.length <= lies('content', 'faeden', 'bitte-werte.json').werte.text_max.wert, 'Text ' + key + ' passt in die Leiste (' + t.length + ' Zeichen)');
    }
    ok(Object.values(TEXTE.forderer).every((q) => q.kopf.length <= 12 && D.WERTE.voelker.includes(q.fraktion)), 'Forderer: Kopf hoechstens 12 Zeichen, Fraktion bekannt');
    // Grep: der Beat-Name steht in keiner Zeichenkette des Servercodes ausser der Registrierung in faden-bausteine.js
    const dateien = []; const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) geh(p); else if (/\.js$/.test(e.name)) dateien.push(p); } };
    geh(path.join(__dirname, '..', 'server'));
    const ohneKommentar = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const treffer = [];
    for (const d of dateien) { const t = ohneKommentar(fs.readFileSync(d, 'utf8')); for (const name of Object.keys(D.BEATS).filter((k) => D.BEATS[k].baustein === f.baustein || k === 'schmiergeld')) if (new RegExp('[\'"`]' + name + '[\'"`]').test(t) && path.basename(d) !== 'faden-bausteine.js' && !/^(geld|kampagnegeld).js$/.test(path.basename(d))) treffer.push(path.basename(d) + ':' + name); }
    ok(treffer.length === 0, 'kein Beat-Name (forderung, schmiergeld) als Zeichenkette im Servercode ausser der Registrierung in faden-bausteine.js (und dem Geld-Grund der Kampagne in geld.js/kampagnegeld.js, anderer Namensraum): ' + treffer.join(', '));
    ok(/registriere\('[a-z]+', require\('\.\/faden-forderung\.js'\)\.baustein\)/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-bausteine.js'), 'utf8')), 'die Registrierung steht in faden-bausteine.js');
    ok(Geld.GRUENDE.includes('bestechungsgeld') && Geld.GRUENDE.includes('forderung'), 'Geld: eigener Grund bestechungsgeld, der Kampagnen-Grund forderung bleibt');
  });

  await section('(b) Pruefer: Test-Vorlagen gueltig, Gegenproben', async () => {
    schmuggel('fo_b1'); zoll('fo_b2');
    const codes = (r) => r.fehler.map((s) => String(s).split(':')[0]);
    ok(Pruefer.pruefeVorlage(klon(D.vorlage('fo_b1'))).ok && Pruefer.pruefeVorlage(klon(D.vorlage('fo_b2'))).ok, 'Schmuggel- und Zoll-Vorlage bestehen den Pruefer');
    // Gegenprobe: ein Beat mit Gegner im Bild (gefahr) UND Optionen -> OPTION_BEI_GEFAHR (Pruefer-Code unveraendert)
    const g1 = klon(D.vorlage('fo_b1')); g1.id = 'fo_b1g'; g1.beats.find((b) => b.id === 'b_forderung').gefahr = true;
    const r1 = Pruefer.pruefeVorlage(g1);
    ok(!r1.ok && codes(r1).includes('OPTION_BEI_GEFAHR'), 'Gegenprobe: forderung mit gefahr:true und Optionen -> OPTION_BEI_GEFAHR (' + codes(r1).join(',') + ')');
    const g2 = klon(D.vorlage('fo_b1')); g2.id = 'fo_b1k'; g2.beats.find((b) => b.id === 'b_kampf').optionen = optionen('forderung');
    ok(codes(Pruefer.pruefeVorlage(g2)).includes('OPTION_BEI_GEFAHR'), 'Gegenprobe: der Kampf-Beat (raumschlacht) mit Optionen -> weiter OPTION_BEI_GEFAHR');
    ok(Pruefer.optionenFehler({ id: 'x', typ: 'forderung', gefahr: true, optionen: optionen('forderung') }, D.BEATS.forderung).some((e) => /OPTION_BEI_GEFAHR/.test(e)), 'optionenFehler: gefahr + Optionen am Beat forderung -> OPTION_BEI_GEFAHR');
    ok(Pruefer.optionenFehler({ id: 'x', typ: 'forderung', optionen: optionen('forderung') }, D.BEATS.forderung).length === 0 && Pruefer.optionenFehler({ id: 'x', typ: 'schmiergeld', optionen: optionen('schmiergeld') }, D.BEATS.schmiergeld).length === 0, 'ohne gefahr: die Optionen sind gueltig');
    // Planbarkeit: kein Expander-Typ (Paket C)
    const BP = require('../server/sim/faden-bauplan.js');
    const e = BP.pruefe({ format: 'faden-bauplan/1', titel: 'Probe Abenteuer', beats: [{ typ: 'bitte', verzweigung: { gescheitert: 'e' } }, { typ: 'forderung' }, { typ: 'abschluss', id: 'e' }] });
    ok(!e.ok && e.codes.includes('BAUPLAN_TYP_NICHT_PLANBAR'), 'Expander: forderung ist (noch) nicht planbar (BAUPLAN_TYP_NICHT_PLANBAR)');
    // sim_befehl nur nach einer echten Ablieferung (Haendler-Vorlage mit den neuen Beats)
    const haendler = (id, aendern) => Pruefer.pruefeVorlage(haendlerVorlage(id, aendern));
    const haendlerVorlage = (id, aendern) => {
      const v = klon(FH); v.id = id;
      const i = v.beats.findIndex((b) => b.id === 'b_fracht');
      v.beats[i].parameter.ende = 'geladen'; v.beats[i].aus.gelungen.weiter = 'b_forderung';
      v.beats.splice(i + 1, 0,
        { id: 'b_forderung', typ: 'forderung', optionen: optionen('forderung'), aus: { gelungen: WEG('verbuendet', 'b_schmier'), gescheitert: WEG('aktiv', 'b_abschluss') } },
        { id: 'b_schmier', typ: 'schmiergeld', optionen: optionen('schmiergeld'), aus: { gelungen: WEG('verbuendet', 'b_abgabe'), gescheitert: WEG('aktiv', 'b_kampf') } },
        { id: 'b_kampf', typ: 'raumschlacht', aus: { gelungen: WEG('aktiv', 'b_abgabe'), gescheitert: WEG('aktiv', 'b_abschluss') } },
        { id: 'b_abgabe', typ: 'fracht', parameter: { nach: '$ort', ende: 'abgeliefert' }, aus: { gelungen: WEG('verbuendet', 'b_enthuell'), gescheitert: WEG('aktiv', 'b_abschluss') } });
      v.beats = v.beats.filter((b) => b.id !== 'b_jagd' && b.id !== 'b_schlacht');   // beats_max 8: ohne Verfolgung und Schlussschlacht (Beispiel 1 mit beiden neuen Beats hat 10 Beats: seit BEA-01 C1 echt in der Vorlage, vorlage_beats_max 10; diese Test-Variante bleibt bei acht)
      v.beats.find((b) => b.id === 'b_enthuell').aus = { gelungen: { status: 'feindlich', weiter: 'b_abschluss', folge: [{ typ: 'sim_befehl' }] }, gescheitert: { status: 'geflohen', weiter: 'b_abschluss' } };
      if (aendern) aendern(v);
      return v;
    };
    HAENDLER.bau = haendlerVorlage;
    const h1 = haendler('fo_h1');
    ok(h1.ok, 'Haendler: bitte, laden, forderung, schmiergeld, kampf, abliefern, enthuellen (sim_befehl): gueltig (' + h1.fehler.join('; ') + ')');
    const h2 = haendler('fo_h2', (v) => { v.beats.find((b) => b.id === 'b_schmier').aus.gelungen.weiter = 'b_enthuell'; });
    ok(!h2.ok && codes(h2).includes('SIM_BEFEHL_OHNE_TAT'), 'Gegenprobe: Bestechen fuehrt an der Lieferung vorbei zur Enthuellung -> SIM_BEFEHL_OHNE_TAT (Enthuellung nur ueber echte Ablieferung)');
    const h3 = haendler('fo_h3', (v) => { v.beats.find((b) => b.id === 'b_forderung').aus.gescheitert.weiter = 'b_enthuell'; });
    ok(!h3.ok && codes(h3).includes('SIM_BEFEHL_OHNE_TAT'), 'Gegenprobe: Ausliefern fuehrt zur Enthuellung -> SIM_BEFEHL_OHNE_TAT');
    // beide Ausgaenge ins gleiche Ziel: weiter verboten
    const h4 = klon(D.vorlage('fo_b1')); h4.id = 'fo_h4'; h4.beats.find((b) => b.id === 'b_forderung').aus.gescheitert.weiter = 'b_schmier';
    ok(codes(Pruefer.pruefeVorlage(h4)).includes('OPTIONEN_GLEICHER_WEG'), 'Gegenprobe: gelungen und gescheitert ins gleiche Ziel -> OPTIONEN_GLEICHER_WEG (die Wahl muss den Weg aendern)');
  });

  await section('(c) Ausliefern: Ware weg, Funk, Faden gescheitert, keine Invasion', async () => {
    schmuggel('fo_c');
    const x = amUltimatum('fo_c', 101); const { g, f, radio } = x;
    const a = angebot(g);
    ok(!!a && a.optionen.map((o) => o.id).join() === 'ausliefern,nicht_ausliefern' && lager(g) === x.lager0 + 1 && !!f.fracht, 'Ultimatum steht (Bitte offen, zwei Optionen), die Ware liegt noch im Frachtraum');
    const r = antwort(g, 'ausliefern');
    ok(r === null, 'die Antwort wird angenommen');
    ok(!f.fracht && lager(g) === x.lager0 && f.phase === 'wartet' && f.beat === 5, 'Ware vom Faden UND aus dem Frachtraum, der Faden steht vor dem Abschluss (b_ende)');
    ok(radio.some((q) => q.text === fmt(TEXTE.reaktionen.ausliefern, { ware: WARE_NAME })) && radio.some((q) => q.text === T_VERLOREN) && radio.some((q) => q.text === 'Ausliefern'), 'Funk: die Crew antwortet, der Forderer antwortet, „Die Ware ist verloren“');
    ok(marken(g) === x.vorher, 'Ausliefern kostet keine Marken');
    ok(ereignisse(f).slice(-1)[0] === 'forderung_gescheitert' && !ereignisse(f).includes('fracht_gelungen'), 'Gedaechtnis: forderung_gescheitert, kein fracht_gelungen (' + ereignisse(f).join() + ')');
    grenzen(g, 5); weiter(g, f);
    ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', 'Faden endet gescheitert');
    ok(!ereignisse(f).some((e) => /enthuellung|verfolgung/.test(e)), 'keine Enthuellung, keine Verfolgung');
    ok(((g.weltsim.regie && g.weltsim.regie.vorgemerkt) || []).every((e) => e.b.typ !== 'invasion'), 'kein vorgemerkter Befehl invasion (kein sim_befehl)');
    ok(!Object.values(g.weltsim.zustand.flotten || []).some((fl) => fl.hochgestuft === true), 'keine hochgestufte Flotte (keine Invasion)');
    ok(angebot(g) === null, 'keine Bitte mehr offen');
  });

  await section('(d) Verweigern: Kampf laeuft, Ware bleibt; nach gewonnenem Kampf Ablieferung, nach verlorenem Ware weg', async () => {
    schmuggel('fo_d');
    { // Verweigern -> raumschlacht, Kampf gewonnen -> abliefern
      const x = amSchmiergeld('fo_d', 111); const { g, f, radio } = x;
      ok(!!angebot(g) && angebot(g).optionen.map((o) => o.id).join() === 'bestechen,verweigern' && angebot(g).kopf === FO.kopf, 'Schmiergeld steht (Bestechen, Verweigern), Kopf der Leiste aus den Daten');
      ok(f.beat === 2 && !!f.fracht && lager(g) === x.lager0 + 1, 'Nicht ausliefern fuehrte zu schmiergeld: die Ware ist noch da');
      ok(antwort(g, 'verweigern') === null, 'Verweigern wird angenommen');
      ok(f.phase === 'wartet' && f.beat === 3 && !!f.fracht && f.fracht.nach === ZIEL && lager(g) === x.lager0 + 1, 'der Faden steht vor dem Kampf-Beat, die Ware BLEIBT am Faden und im Frachtraum');
      ok(!radio.some((q) => q.text === T_VERLOREN) && marken(g) === x.vorher, 'kein „verloren“, keine Marken weg');
      ok(ereignisse(f).slice(-2).join() === 'forderung_gelungen,schmiergeld_gescheitert', 'Gedaechtnis: forderung_gelungen, schmiergeld_gescheitert');
      starteBeat(x);
      ok(f.phase === 'laeuft' && D.vorlage(f.vorlage).beats[f.beat].typ === 'raumschlacht' && !!f.fracht, 'Beat raumschlacht laeuft (Gegner kommen erst hier), die Ware bleibt');
      Faden.beatAusgang(g, f.id, 'gelungen');
      ok(f.phase === 'wartet' && f.beat === 4 && !!f.fracht && lager(g) === x.lager0 + 1, 'Kampf gewonnen: die Ware ist noch am Faden');
      starteBeat(x); andocken(g, ZIEL);
      ok(f.beat === 5 && !f.fracht && lager(g) === x.lager0 && radio.some((q) => q.text === T_ABGELIEFERT) && ereignisse(f).slice(-1)[0] === 'fracht_gelungen', 'Ablieferung beim Haendler nach dem Kampf moeglich (fracht_gelungen)');
      grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'Faden gelungen');
    }
    { // Verweigern -> Kampf verloren -> Ware weg
      const x = amSchmiergeld('fo_d', 112); const { g, f, radio } = x;
      antwort(g, 'verweigern'); starteBeat(x);
      Faden.beatAusgang(g, f.id, 'gescheitert');
      ok(!f.fracht && lager(g) === x.lager0 && radio.some((q) => q.text === T_VERLOREN) && f.beat === 5, 'Kampf verloren (gescheitert): die Ware ist weg, Frachtraum leer, Funk „verloren“ (normale Regel der Zwischen-Beats)');
      grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', 'Faden gescheitert');
    }
  });

  await section('(e) Bestechen: Marken aus den Daten, Ware bleibt, Faden geht ohne Kampf weiter; zu wenig Marken', async () => {
    schmuggel('fo_e');
    { // genug Marken
      const x = amSchmiergeld('fo_e', 121, 500); const { g, f, radio } = x;
      const vorher = marken(g); let gezahlt = null; const orig = g.missionEvent.bind(g);
      g.missionEvent = (k, d) => { if (k === 'marksPaid') gezahlt = d; return orig(k, d); };
      ok(antwort(g, 'bestechen') === null, 'Bestechen wird angenommen');
      ok(marken(g) === vorher - PREIS && gezahlt && gezahlt.n === PREIS && gezahlt.grund === 'bestechungsgeld', 'Marken abgebucht: ' + PREIS + ' (Betrag aus forderung-werte.json, Grund bestechungsgeld, Ereignis marksPaid)');
      ok(!!f.fracht && lager(g) === x.lager0 + 1 && !radio.some((q) => q.text === T_VERLOREN), 'die Ware bleibt (Faden und Frachtraum), kein „verloren“');
      ok(f.phase === 'wartet' && f.beat === 4 && D.vorlage(f.vorlage).beats[f.beat].typ === 'fracht', 'der Faden geht weiter zum Abliefer-Beat, der Kampf-Beat wird uebersprungen');
      ok(radio.some((q) => q.text === TEXTE.reaktionen.bestechen) && ereignisse(f).slice(-1)[0] === 'schmiergeld_gelungen', 'Funk des Forderers, Gedaechtnis schmiergeld_gelungen');
      starteBeat(x); andocken(g, ZIEL);
      ok(f.beat === 5 && !f.fracht && ereignisse(f).slice(-1)[0] === 'fracht_gelungen', 'Ablieferung nach der Bestechung: fracht_gelungen');
      grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'Faden gelungen, ohne dass je ein Gegner kam');
    }
    { // genau der Preis reicht
      const x = amSchmiergeld('fo_e', 122, PREIS); const { g } = x;
      ok(antwort(g, 'bestechen') === null && marken(g) === 0, 'mit genau ' + PREIS + ' Marken geht es (Rest 0)');
    }
    { // zu wenig Marken: die Option wird mit Funk abgelehnt, die Wahl bleibt offen
      const x = amSchmiergeld('fo_e', 123, PREIS - 1); const { g, f, radio } = x;
      const nr = angebot(g).nr;
      const r = Bitte.beantworten(g, 'bestechen', nr);
      ok(r && r.code === 'zu_wenig_marken' && r.text === TEXTE.ablehnung.zu_wenig_marken, 'Bestechen mit ' + (PREIS - 1) + ' Marken: abgelehnt (zu_wenig_marken)');
      ok(marken(g) === PREIS - 1 && !!f.fracht && f.beat === 2 && f.phase === 'laeuft' && !f.laufend.gewaehlt, 'nichts gebucht, die Ware bleibt, der Beat bleibt offen');
      ok(!!angebot(g) && angebot(g).nr === nr && angebot(g).optionen.length === 2, 'das Angebot bleibt offen (beide Optionen)');
      ok(radio.some((q) => q.text === TEXTE.ablehnung.zu_wenig_marken && q.von === 'Lerche'), 'Funk der Lerche: zu wenig Marken');
      ok(!radio.some((q) => q.text === TEXTE.reaktionen.bestechen) && !radio.some((q) => q.text === 'Bestechen'), 'die abgelehnte Antwort steht nicht im Funk als Entscheidung');
      ok(Bitte.beantworten(g, 'bestechen', nr) && marken(g) === PREIS - 1, 'ein zweiter Versuch geht genauso nicht');
      setzeMarken(g, PREIS + 5);
      ok(antwort(g, 'bestechen') === null && marken(g) === 5 && f.beat === 4, 'mit genug Marken gelingt dieselbe Wahl danach (Rest 5)');
      // die Wahl Verweigern war die ganze Zeit moeglich
      const y = amSchmiergeld('fo_e', 124, 0);
      ok(Bitte.beantworten(y.g, 'bestechen', angebot(y.g).nr).code === 'zu_wenig_marken' && antwort(y.g, 'verweigern') === null && y.f.beat === 3 && !!y.f.fracht, 'ohne Marken bleibt Verweigern moeglich (Ware bleibt, weiter zum Kampf)');
    }
    { // Staerke aus dem Beat: Zoll mit staerke gering kostet den geringen Preis
      zoll('fo_e2');
      const x = bereit(125, 500); x.f = oeffne(x.g, 'fo_e2'); starteBeat(x);
      antwort(x.g, 'nicht_ausliefern'); starteBeat(x);
      const v = marken(x.g); antwort(x.g, 'bestechen');
      ok(marken(x.g) === v - PREIS_GERING, 'staerke gering aus dem Beat: ' + PREIS_GERING + ' Marken');
    }
  });

  await section('(f) Mehrspieler: zwei Antworten, die erste gilt', async () => {
    const x = amSchmiergeld('fo_d', 131, 500); const { g, f } = x;
    const nr = angebot(g).nr;
    const a1 = Bitte.beantworten(g, 'bestechen', nr), a2 = Bitte.beantworten(g, 'verweigern', nr);
    ok(a1 === null && a2 && a2.code === 'schon_beantwortet', 'die zweite Antwort wird verworfen (schon_beantwortet)');
    ok(marken(g) === x.vorher - PREIS && f.beat === 4, 'nur die erste Antwort wirkte: einmal bezahlt, Weg der Bestechung');
    const y = amUltimatum('fo_c', 132); const nr2 = angebot(y.g).nr;
    Bitte.beantworten(y.g, 'nicht_ausliefern', nr2); const z = Bitte.beantworten(y.g, 'ausliefern', nr2);
    ok(z && z.code === 'schon_beantwortet' && !!y.f.fracht && y.f.beat === 2, 'Forderung: erst „Nicht ausliefern“, dann „Ausliefern“: die zweite wird verworfen, die Ware bleibt');
  });

  await section('(g) Speichern und Laden mitten in der Wahl', async () => {
    schmuggel('fo_g');
    const x = amSchmiergeld('fo_g', 141, 500); const { g, f } = x;
    const a = angebot(g);
    const data = Weltstand.capture(g);
    ok(Weltstand.validate(data, g).length === 0, 'Weltstand mit offener Forderung besteht das Schema: ' + Weltstand.validate(data, g).slice(0, 2).join('; '));
    const y = bereit(142); const g2 = y.g;
    Weltstand.apply(g2, JSON.parse(JSON.stringify(data)));
    const h = g2.weltsim.faeden.liste.find((z) => z.id === f.id);
    const a2 = angebot(g2);
    ok(!!a2 && a2.text === a.text && a2.von === FO.name && a2.volk === FO.fraktion && a2.kopf === FO.kopf && a2.optionen.map((o) => o.id).join() === 'bestechen,verweigern', 'nach dem Laden steht dieselbe Forderung: Text, Absender, Kopf, Optionen');
    ok(Bitte.snapshot(g2).kopf === FO.kopf && Bitte.snapshot(g2).von === FO.name && Bitte.snapshot(g2).fk === lies('content', 'faeden', 'bitte-werte.json').werte.kuerzel.wert[FO.fraktion], 'Anzeige: Kopf, Absender und Kuerzel der Fraktion aus den Daten');
    ok(!!h && !!h.fracht && Lager.auftragAnBord(g2, h.id) && marken(g2) === marken(g), 'Ware, Ladung und Marken sind im geladenen Stand da');
    g2.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
    const vorher = marken(g2);
    ok(Bitte.beantworten(g2, 'bestechen', a2.nr) === null && marken(g2) === vorher - PREIS && h.beat === 4 && !!h.fracht, 'im geladenen Stand wirkt die Wahl: Marken abgebucht, Ware bleibt, weiter');
    // Forderung (erste Stufe) mitten in der Wahl
    const u = amUltimatum('fo_g', 143); const d2 = Weltstand.capture(u.g);
    const w = bereit(144); Weltstand.apply(w.g, JSON.parse(JSON.stringify(d2)));
    const o2 = angebot(w.g);
    ok(!!o2 && o2.optionen.map((o) => o.id).join() === 'ausliefern,nicht_ausliefern' && o2.von === FO.name, 'Forderung (erste Stufe) nach dem Laden: Absender des Forderers, nicht der NSC des Fadens');
    ok(Bitte.beantworten(w.g, 'ausliefern', o2.nr) === null && !w.g.weltsim.faeden.liste[0].fracht && lager(w.g) === 0, 'im geladenen Stand: Ausliefern nimmt die Ware (Faden und Frachtraum)');
    // Muell im Bitten-Block: unbekannter Beat-Typ ohne Leiste faellt weg
    const kaputt = JSON.parse(JSON.stringify(d2)); const bl = kaputt.welt && kaputt.welt.sim && kaputt.welt.sim.faeden && kaputt.welt.sim.faeden.bitte;
    if (bl) { bl.beat = 'b_lade'; const w2 = bereit(145); Weltstand.apply(w2.g, kaputt); ok(angebot(w2.g) === null, 'Muell: eine Bitte, die nicht zum laufenden Beat passt, faellt beim Laden weg'); }
    else ok(false, 'Weltstand traegt den Bitten-Block (welt.sim.faeden.bitte)');
  });

  await section('(h) Frist ohne Antwort', async () => {
    schmuggel('fo_h');
    { // Schmiergeld: Schweigen = verweigern (gescheitert, Ware bleibt, weiter zum Kampf)
      const x = amSchmiergeld('fo_h', 151); const { g, f, radio } = x;
      grenzen(g, BITTE_FRIST + 1);
      ok(angebot(g) === null && f.phase === 'wartet' && f.beat === 3 && !!f.fracht && lager(g) === x.lager0 + 1 && marken(g) === x.vorher, 'Schmiergeld ohne Antwort: gescheitert, die Ware bleibt, nichts bezahlt, weiter zum Kampf');
      ok(ereignisse(f).slice(-1)[0] === 'schmiergeld_gescheitert' && !radio.some((q) => q.text === T_VERLOREN), 'schmiergeld_gescheitert, kein „verloren“');
    }
    { // Forderung: Schweigen = gescheitert = die Ware ist weg (Katalog ohne ware_bei_scheitern)
      const x = amUltimatum('fo_h', 152); const { g, f, radio } = x;
      grenzen(g, BITTE_FRIST + 1);
      ok(angebot(g) === null && !f.fracht && lager(g) === x.lager0 && f.beat === 5 && radio.some((q) => q.text === T_VERLOREN), 'Forderung ohne Antwort: gescheitert, die Ware ist weg (wie Ausliefern)');
    }
  });

  await section('(i) Notsprung in der Wahl: die Ware ist verloren, auch bei ware_bei_scheitern bleibt', async () => {
    schmuggel('fo_i');
    const x = amSchmiergeld('fo_i', 161); const { g, f, radio } = x;
    ok(!!f.fracht && f.phase === 'laeuft', 'Schmiergeld laeuft mit Ware');
    ok(Fracht.notsprung(g).join() === f.id, 'Notsprung trifft den Faden');
    ok(!f.fracht && lager(g) === x.lager0 && radio.some((q) => q.text === T_VERLOREN) && f.phase === 'wartet', 'die Ware ist weg, Frachtraum leer, Funk „verloren“ (nur das Scheitern DURCH VERWEIGERN laesst die Ware am Faden)');
    ok(Bitte.beantworten(g, 'bestechen', null).code === 'kein_angebot' && marken(g) === x.vorher, 'eine spaete Antwort wirkt nicht (kein_angebot), keine Marken weg');
    grenzen(g, 1);
    ok(angebot(g) === null, 'mit der naechsten Taetigkeit ist das Angebot weg');
  });

  await section('(j) forderung ohne Schmuggel-Vorlage: Zollschiff ohne Haendler, ohne Ware, ohne Enthuellung', async () => {
    zoll('fo_j');
    { // Forderung -> Bestechen
      const x = bereit(171, 300); const { g, radio } = x; x.f = oeffne(g, 'fo_j'); const f = x.f;
      const l0 = lager(g);
      starteBeat(x);
      const a = angebot(g);
      ok(!!a && a.von === TEXTE.forderer.zollschiff.name && a.kopf === 'ZOLL' && a.text === fmt(TEXTE.texte.forderung_zollschiff.text, { ware: TEXTE.ware_ohne, ort: Sektoren.hexName(f.parameter.ort) || 'hier' }), 'Zollschiff fordert (andere Texte, anderer Kopf), ohne Ware heisst es „' + TEXTE.ware_ohne + '“: ' + (a && a.text));
      ok(!f.fracht && f.nsc.wahrheit === undefined || !f.nsc.wahrheit, 'kein Haendler: keine Ware am Faden, keine verborgene Wahrheit');
      antwort(g, 'nicht_ausliefern'); starteBeat(x);
      ok(angebot(g).text === fmt(TEXTE.texte.schmiergeld_zollschiff.text, { marken: PREIS_GERING + ' ' + WERTE.marken_einheit.wert }), 'Schmiergeld des Zollschiffs nennt den geringen Preis (' + PREIS_GERING + ')');
      const v = marken(g);
      antwort(g, 'bestechen');
      ok(marken(g) === v - PREIS_GERING && f.beat === 3 && f.phase === 'wartet', 'Bestechen: ' + PREIS_GERING + ' Marken, der Faden steht vor dem Abschluss');
      grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen' && ereignisse(f).slice(0, 2).join() === 'forderung_gelungen,schmiergeld_gelungen', 'Abschluss gelungen ohne Haendler und ohne Enthuellung (' + ereignisse(f).join() + ')');
      ok(lager(g) === l0, 'der Frachtraum blieb unberuehrt');
    }
    { // Forderung -> Ausliefern (nichts zu liefern)
      const x = bereit(172, 300); x.f = oeffne(x.g, 'fo_j'); starteBeat(x);
      antwort(x.g, 'ausliefern');
      grenzen(x.g, 5); weiter(x.g, x.f);
      ok(x.f.phase === 'abgeschlossen' && x.f.ausgang.art === 'gescheitert' && marken(x.g) === 300, 'Ausliefern: Abschluss gescheitert, keine Marken');
    }
    { // Verweigern -> raumschlacht
      const x = bereit(173, 300); x.f = oeffne(x.g, 'fo_j'); starteBeat(x);
      antwort(x.g, 'nicht_ausliefern'); starteBeat(x); antwort(x.g, 'verweigern'); starteBeat(x);
      ok(x.f.phase === 'laeuft' && D.vorlage(x.f.vorlage).beats[x.f.beat].typ === 'raumschlacht', 'Verweigern: der Beat raumschlacht laeuft');
      Faden.beatAusgang(x.g, x.f.id, 'gelungen'); grenzen(x.g, 5); weiter(x.g, x.f);
      ok(x.f.phase === 'abgeschlossen' && x.f.ausgang.art === 'gelungen', 'nach gewonnenem Kampf: Abschluss gelungen');
    }
  });

  await section('(k) Anzeige und Bitten unveraendert', async () => {
    schmuggel('fo_k');
    const x = amUltimatum('fo_k', 181); const { g } = x;
    const s = Bitte.snapshot(g);
    ok(s.kopf === FO.kopf && s.von === FO.name && s.fk === 'Ger' && typeof s.pid === 'string' && Bitte.pidGueltig(s.pid) && s.optionen.every((o) => Object.keys(o).sort().join() === 'id,text') && s.text === fmt(TEXTE.texte.forderung_freibeuter.text, { ware: WARE_NAME }), 'world.bitte: Kopf, Absender, Kuerzel, Portraet, Optionen (nur id, text), Text mit dem Namen der Ware');
    ok(x.radio.some((q) => q.von === FO.name && q.text === s.text), 'das Ultimatum steht im Funk mit dem Forderer als Absender (nicht der NSC)');
    ok(!x.radio.some((q) => q.von === x.f.nsc.name && q.text === s.text), 'nicht mit dem Namen des Fadens-NSC');
    // eine Bitte (bitte-Beat) behaelt Kopf BITTE
    const y = bereit(182); const dc = lies('content', 'faeden', 'vorlagen', 'dankbarer_captain.json'); dc.id = 'fo_k2'; dc.ausloeser = [{ art: 'notruf', ausgang: 'gelungen' }];
    ok(registriere(dc).ok, 'Bitten-Vorlage (Kopie von dankbarer_captain) registriert');
    y.f = oeffne(y.g, 'fo_k2'); starteBeat(y);   // erster Beat ist eine echte Bitte
    const sb = Bitte.snapshot(y.g);
    ok(sb && sb.kopf === lies('content', 'faeden', 'bitte-werte.json').werte.kopf.wert && sb.von === y.f.nsc.name, 'eine normale Bitte zeigt weiter Kopf BITTE und den NSC des Fadens');
  });

  await section('(l) Beispiel 1 (Haendler mit Forderung): Enthuellung und Invasion nur nach echter Ablieferung', async () => {
    const v = HAENDLER.bau('fo_inv'); const rr = registriere(v);
    ok(rr.ok, 'Haendler-Vorlage mit forderung und schmiergeld (8 Beats) registriert (' + (rr.fehler || []).join('; ') + ')');
    const ORT = '0203';
    const hochgestuft = (g) => g.weltsim.zustand.flotten.filter((fl) => fl.hochgestuft === true);
    const treibe = (g, f, wahl) => {   // bis der Faden vor der Enthuellung steht oder abgeschlossen ist; wahl = Antwort je Beat
      for (let k = 0; k < 80 && f.phase !== 'abgeschlossen' && !(f.phase === 'wartet' && D.vorlage(f.vorlage).beats[f.beat].id === 'b_enthuell'); k++) {
        if (Bitte.offen(g)) { const b = D.vorlage(f.vorlage).beats[f.beat]; Bitte.beantworten(g, wahl[b.id] || 'ablehnen', Bitte.offen(g).nr); continue; }
        if (f.phase === 'wartet') { f.zaehler = f.abstand; Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id }); continue; }
        const b = D.vorlage(f.vorlage).beats[f.beat];
        if (b.typ === 'raumschlacht') { Faden.beatAusgang(g, f.id, 'gelungen'); continue; }
        if (b.typ === 'fracht' && f.fracht) { ankunft(g, f.fracht.nach); g.missionEvent('docked', {}); ab(g); continue; }
        g.lageGrenze('andocken');
      }
    };
    const start = (seed) => { const g = V.neu(seed); setzeMarken(g, 500); const f = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'fo_inv', parameter: { angebot: V.notrufOhneOrt(g, 'notruf_havarie_konvoi', ORT, 'gelungen').nr } }).faden; return { g, f }; };
    const bereiteWelt = (g) => {
      const z = g.weltsim.zustand, ziel = P3.invasionsZiel(g, ORT);
      if (!ziel) return false;
      z.flotten = z.flotten.filter((q) => !(q.ort === ziel && q.fraktion === 'rom'));
      z.hexe[ziel].abwehr = 0.1;
      z.angriffe = z.angriffe.filter((a) => a.von !== 'ger');
      for (const fl of z.flotten) if (fl.fraktion === 'ger' && !fl.miete) { fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null; fl.angriff = null; fl.warte = 0; fl.staerke = fl.kap; fl.versorgung = 1; }
      z.regie = Object.assign(z.regie || {}, { ger: { p_act: 0, aggr: 0, regler_bis: z.tick + 50 } });
      for (const q of ['rom', 'ger']) { z.vorrat[q].T = Math.max(z.vorrat[q].T, 40); z.vorrat[q].U = Math.max(z.vorrat[q].U, 40); }
      return true;
    };
    const wege = [['Bestechen', { b_bitte: 'annehmen', b_forderung: 'nicht_ausliefern', b_schmier: 'bestechen' }], ['Verweigern und gewonnener Kampf', { b_bitte: 'annehmen', b_forderung: 'nicht_ausliefern', b_schmier: 'verweigern' }]];
    for (const [name, wahl] of wege) for (const seed of [601, 602]) {
      const { g, f } = start(seed); const m0 = marken(g);
      treibe(g, f, wahl);
      ok(f.phase === 'wartet' && D.vorlage(f.vorlage).beats[f.beat].id === 'b_enthuell' && !f.fracht && ereignisse(f).includes('fracht_gelungen'), name + ' (Seed ' + seed + '): die Ware wurde beim Haendler abgeliefert, der Faden steht vor der Enthuellung (' + ereignisse(f).join() + ')');
      ok(marken(g) === (name === 'Bestechen' ? m0 - PREIS : m0), name + ' (Seed ' + seed + '): Marken nach dem Weg stimmen');
      ok(!g.weltsim.zustand.angriffe.some((a) => a.befohlen === true) && hochgestuft(g).length === 0, name + ' (Seed ' + seed + '): bis zur Enthuellung keine Wirkung auf die Sim');
      if (!bereiteWelt(g)) { ok(false, 'kein Invasionsziel'); continue; }
      f.zaehler = f.abstand;
      const w = Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_enthuell' });
      for (let k = 0; k < 8; k++) Kriegslage.tick(g, 'test');
      ok(w.ok && hochgestuft(g).length === 1 && g.weltsim.zustand.angriffe.some((a) => a.befohlen === true && a.von === 'ger'), name + ' (Seed ' + seed + '): Enthuellung, die Invasion wirkt im Tick (hochgestuft ' + hochgestuft(g).length + ')');
    }
    for (const seed of [611, 612]) {   // Ausliefern: der Faden endet, keine Invasion
      const { g, f } = start(seed);
      treibe(g, f, { b_bitte: 'annehmen', b_forderung: 'ausliefern' });
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && !ereignisse(f).some((e) => /enthuellung/.test(e)), 'Ausliefern (Seed ' + seed + '): Faden gescheitert ohne Enthuellung');
      for (let k = 0; k < 8; k++) Kriegslage.tick(g, 'test');
      ok(((g.weltsim.regie && g.weltsim.regie.vorgemerkt) || []).every((e) => e.b.typ !== 'invasion') && hochgestuft(g).length === 0 && !g.weltsim.zustand.angriffe.some((a) => a.befohlen === true), 'Ausliefern (Seed ' + seed + '): keine Invasion');
    }
  });

  console.log('\n' + (n - fails) + '/' + n + ' Pruefungen ok' + (fails ? ' – ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})();
