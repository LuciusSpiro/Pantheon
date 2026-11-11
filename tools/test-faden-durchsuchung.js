'use strict';
// BEA-01 B: der Beat forderung mit art durchsuchung (Zollschiff/Patrouille oeffnet den Frachtraum). Daten: content/faeden/beats.json (art_modi, ladung_parameter), forderung-werte.json (bussgeld_marken, fund_ruf),
// forderung-texte.json (durchsuchung_*), ruf-werte.json (schmuggel_entdeckt_rom). Code: faden-forderung.js (durchsuchen), fracht.js (frachtDurchsuchen, lagerBeschlagnahmen), faden-fracht.js (ladungVon, laden).
// Die Wahlen laufen wie bei Paket A ueber die zwei Ausgaenge zweier Beats:
//   forderung (art durchsuchung): dulden = Ausgang gescheitert (der Frachtraum wird durchsucht; Fund oder nicht entscheiden Marken, Ruf und Frachtraum, nie der Ausgang) · nicht_dulden = gelungen -> schmiergeld
//   schmiergeld:                  bestechen = gelungen (Marken, die Durchsuchung entfaellt, die Ware bleibt) · verweigern = gescheitert (weiter in raumschlacht)
// Geprueft: (a) Daten und Katalog · (b) Durchsuchen/Beschlagnahmen auf Funktionsebene (illegal ungetarnt bei scan und voll, getarnt nur bei voll) · (c) Tarnung: nichts, was der Spieler liest, nennt die echte Art ·
// (d) beschlagnahmte Ware ist weg · (e) Auftragsware des Fadens bleibt (auch illegale/getarnte) · (f) sauberer Frachtraum · (g) Fund: Ruf und Bussgeld nach den Daten · (h) bestechen ·
// (i) nicht dulden und verweigern · (j) Speichern/Laden · (k) Pruefer: art, tiefe, Option, Ladung · (l) Zollschiff-Vorlage komplett · (m) Mehrspieler · (n) Zuweisung illegal/getarnt beim Laden (Beat fracht).
// Erwartete Werte: eigene Zaehlung im Test (Preise, Texte, Ruf aus den Dateien gelesen, nie aus dem Produktivcode abgeleitet).      node tools/test-faden-durchsuchung.js
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
const FS = require('../server/sim/faden-szene.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Baustein = require('../server/sim/faden-forderung.js');
const Geld = require('../server/sim/geld.js');
const Ruf = require('../server/sim/ruf.js');
const Modul = require('../server/sim/module.js');
const Ausbau = require('../server/sim/ausbau.js');
const X = require('./faden-fixture.js');
const { D, spiel, oeffne, grenzen, alsVorlage, registriere } = X;

const lies = (...p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const TEXTE = lies('content', 'faeden', 'forderung-texte.json');
const WERTE = lies('content', 'faeden', 'forderung-werte.json').werte;
const RUF = lies('content', 'welt', 'ruf-werte.json').werte.quellen.wert;
const BITTE = lies('content', 'faeden', 'bitte-werte.json').werte;
const BEATS = lies('content', 'faeden', 'beats.json').beats;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = async (t, f) => { console.log('\n' + t); try { await f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
const klon = (x) => JSON.parse(JSON.stringify(x));
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const andocken = (g, hex) => { ankunft(g, hex); g.missionEvent('docked', {}); };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const lager = (g) => (g.fracht ? g.fracht.lager.length : 0);
const arten = (g) => g.fracht.lager.map((l) => l.art).sort().join();
const ereignisse = (f) => f.nsc.gedaechtnis.map((x) => x.ereignis);
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const marken = (g) => g.inventory.marks;
const setzeMarken = (g, k) => Geld.standSetzen(g, k, 'testmarken');
const ZIEL = '0305';
const PREIS_GERING = WERTE.bestechung_marken.wert.gering;
const BUSSE = (s) => WERTE.bussgeld_marken.wert[s || WERTE.staerke_standard.wert];
const FUND_GRUND = WERTE.fund_ruf.wert.rom;
const FUND_DELTA = RUF[FUND_GRUND].delta;
const ZOLL = TEXTE.forderer.zollschiff;
const BITTE_FRIST = BITTE.frist_taetigkeiten.wert;

// ---------- Vorlagen (nur im Test): Zollschiff ohne Haendler und Schmuggel-Faden mit Haendler-Ware
const WEG = (status, weiter) => ({ status, weiter });
function optionen(typ, art) {
  if (typ === 'forderung') {
    return art === 'durchsuchung'
      ? [{ id: 'dulden', text: 'Durchsuchung dulden', ausgang: 'gescheitert', folge: [] }, { id: 'nicht_dulden', text: 'Nicht dulden', ausgang: 'gelungen', folge: [] }]
      : [{ id: 'ausliefern', text: 'Ausliefern', ausgang: 'gescheitert', folge: [] }, { id: 'nicht_ausliefern', text: 'Nicht ausliefern', ausgang: 'gelungen', folge: [] }];
  }
  return [{ id: 'bestechen', text: 'Bestechen', ausgang: 'gelungen', folge: [] }, { id: 'verweigern', text: 'Verweigern', ausgang: 'gescheitert', folge: [] }];
}
// Zoll: forderung (art) -> schmiergeld -> raumschlacht -> Abschluss. o.art: 'durchsuchung' (Standard) | 'ware' | null (ohne Parameter art); o.tiefe
function zoll(id, o) {
  o = o || {};
  const art = o.art === undefined ? 'durchsuchung' : o.art;
  const p = { staerke: 'gering' };
  if (art === 'durchsuchung') p.text_key = 'durchsuchung_zollschiff'; else p.text_key = 'forderung_zollschiff';
  if (art) p.art = art;
  if (o.tiefe) p.tiefe = o.tiefe;
  const r = registriere(alsVorlage(id, (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    v.beats = [
      { id: 'b_forderung', typ: 'forderung', parameter: p, optionen: optionen('forderung', art), aus: { gelungen: WEG('aktiv', 'b_schmier'), gescheitert: WEG('aktiv', 'b_ende') } },
      { id: 'b_schmier', typ: 'schmiergeld', parameter: { text_key: art === 'durchsuchung' ? 'schmiergeld_durchsuchung_zollschiff' : 'schmiergeld_zollschiff', staerke: 'gering' }, optionen: optionen('schmiergeld'), aus: { gelungen: WEG('aktiv', 'b_ende'), gescheitert: WEG('aktiv', 'b_kampf') } },
      { id: 'b_kampf', typ: 'raumschlacht', aus: { gelungen: WEG('aktiv', 'b_ende'), gescheitert: WEG('geflohen', 'b_ende') } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['schmiergeld_gelungen', 'raumschlacht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  if (!r.ok) throw new Error('Vorlage ' + id + ' ungueltig: ' + r.fehler.join('; '));
}
// Schmuggel: laden (geladen, mit Eigenschaften o.lade) -> forderung (durchsuchung) -> schmiergeld -> raumschlacht -> abliefern -> Abschluss. Dulden fuehrt (gescheitert) mit dem Faden weiter zum Abliefern.
function schmuggel(id, o) {
  o = o || {};
  const r = registriere(alsVorlage(id, (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    v.beats = [
      { id: 'b_lade', typ: 'fracht', parameter: Object.assign({ nach: ZIEL, ende: 'geladen' }, o.lade || {}), aus: { gelungen: WEG('verbuendet', 'b_forderung'), gescheitert: WEG('geflohen', 'b_ende') } },
      { id: 'b_forderung', typ: 'forderung', parameter: Object.assign({ text_key: 'durchsuchung_zollschiff', art: 'durchsuchung', staerke: 'gering' }, o.tiefe ? { tiefe: o.tiefe } : {}), optionen: optionen('forderung', 'durchsuchung'), aus: { gelungen: WEG('verbuendet', 'b_schmier'), gescheitert: WEG('aktiv', 'b_abgabe') } },
      { id: 'b_schmier', typ: 'schmiergeld', parameter: { text_key: 'schmiergeld_durchsuchung_zollschiff', staerke: 'gering' }, optionen: optionen('schmiergeld'), aus: { gelungen: WEG('verbuendet', 'b_abgabe'), gescheitert: WEG('aktiv', 'b_kampf') } },
      { id: 'b_kampf', typ: 'raumschlacht', aus: { gelungen: WEG('aktiv', 'b_abgabe'), gescheitert: WEG('aktiv', 'b_ende') } },
      { id: 'b_abgabe', typ: 'fracht', parameter: { nach: ZIEL, ende: 'abgeliefert' }, aus: { gelungen: WEG('verbuendet', 'b_ende'), gescheitert: WEG('geflohen', 'b_ende') } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['fracht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  if (!r.ok) throw new Error('Vorlage ' + id + ' ungueltig: ' + r.fehler.join('; '));
}

// ---------- Spiel
const OFFEN = { art: 'sprengstoff', eig: { illegal: true } };                       // Schmuggel ohne Tarnung
const TARN = { art: 'waffen', eig: { illegal: true, getarnt: 'fracht' } };           // Waffen, getarnt als Fracht
const LEGAL = { art: 'erz' };
function raeume(g, liste) {
  Ausbau.setStufe(g, 3);
  g.ship.module = liste.map((r) => ({ id: 'frachtraum', raum: r, an: true, lauf: true }));
  Modul.verteilungSetzen(g);
  g.fracht.lager = []; g.fracht.draussen = []; g.fracht.halt = null;
}
function einlagern(g, items) {
  for (const it of items) { const r = Lager.lagerAufnehmen(g, { art: it.art, quelle: 'debug', eigenschaften: it.eig }); if (!r.ok) throw new Error('Einlagern ' + it.art + ': ' + r.text); }
}
function bereit(seed, k) {
  const x = spiel({ crew: 1, seed }); const g = x.g;
  const radio = [], odas = [], evts = [], mevts = [];
  const emit = g.emit.bind(g); g.emit = (e, d) => { evts.push({ k: e, d }); if (e === 'radio' && d && d.text) radio.push({ von: d.from, text: d.text }); return emit(e, d); };
  const oda = g.oda.bind(g); g.oda = (t, kk) => { odas.push(t); return oda(t, kk); };
  const me = g.missionEvent.bind(g); g.missionEvent = (kk, d) => { mevts.push({ k: kk, d }); return me(kk, d); };
  g.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
  g.space.enemies = []; g.god = true;
  ab(g); ankunft(g, ZIEL);
  raeume(g, [1, 2, 3]);
  setzeMarken(g, k === undefined ? 500 : k);
  Ruf.aendern(g, 'rom', 20 - Ruf.ruf(g, 'rom'));
  return { g, radio, odas, evts, mevts, texte: () => radio.map((r) => r.text), sichtbar: () => odas.concat(evts.map((e) => JSON.stringify(e))).join(' | ') };
}
const starteBeat = (x) => { grenzen(x.g, 5); return weiter(x.g, x.f); };
// BEA-01 C2: die Forderung der WARE (art ware) braucht eine Faden-Ware (Katalog braucht_ware, sonst endet sie sofort): eine Ware am Faden und im Frachtraum, ohne Lade-Beat
const mitWare = (x) => {
  const r = Lager.lagerAufnehmen(x.g, { art: 'fracht', quelle: 'faden', eigenschaften: { auftrag: x.f.id } }); if (!r.ok) throw new Error('Einlagern: ' + r.text);
  x.f.fracht = Fracht.leseFracht({ ware: 'fracht_kiste', von: ZIEL, nach: ZIEL, tick: x.g.weltsim.tickZahl });
};
const angebot = (g) => Bitte.offen(g);
const antwort = (g, id) => Bitte.beantworten(g, id, angebot(g) ? angebot(g).nr : null);
const gesehen = (x, name) => x.mevts.filter((e) => e.k === name);
// Zoll bis zum offenen Angebot (Beat b_forderung laeuft); items = Ladung des Frachtraums
function amZoll(id, seed, items, k) {
  const x = bereit(seed, k); x.f = oeffne(x.g, id);
  einlagern(x.g, items || []);
  x.lager0 = lager(x.g); x.vorher = marken(x.g); x.ruf0 = Ruf.ruf(x.g, 'rom'); x.mev0 = x.mevts.length;
  starteBeat(x);
  return x;
}
// Schmuggel-Faden bis zum offenen Angebot (nach dem Laden); items kommen NACH dem Laden dazu
function amSchmuggel(id, seed, items, k) {
  const x = bereit(seed, k); x.f = oeffne(x.g, id);
  starteBeat(x);   // b_lade
  einlagern(x.g, items || []);
  x.lager0 = lager(x.g); x.vorher = marken(x.g); x.ruf0 = Ruf.ruf(x.g, 'rom'); x.mev0 = x.mevts.length;
  starteBeat(x);   // b_forderung
  return x;
}
const ECHT = /waffen/i;   // die echte Art der getarnten Ware (TARN); die Tarnart heisst Fracht

(async () => {
  bereit(1);   // laedt die Sektorendaten wie im Spiel

  await section('(a) Daten und Katalog: art_modi, Texte, Werte, Folgen; kein Beat-/Art-Name im Servercode', async () => {
    const f = D.BEATS.forderung;
    ok(f.art_modi && f.art_modi.parameter === 'art' && f.art_modi.standard === 'ware' && Object.keys(f.art_modi.modi).join() === 'ware,durchsuchung', 'Katalog: forderung hat art_modi (ware Standard, durchsuchung)');
    ok(f.parameter.optional.includes('art') && f.parameter.optional.includes('tiefe') && !D.BEATS.schmiergeld.parameter.optional.includes('art'), 'Parameterliste: art und tiefe nur am Beat forderung');
    const m = D.artModus({ typ: 'forderung', parameter: { art: 'durchsuchung' } });
    ok(m.id === 'durchsuchung' && m.ware_bei_scheitern === 'bleibt' && m.tiefen.werte.join() === 'voll,scan' && m.tiefen.standard === 'voll', 'artModus: durchsuchung bleibt bei Scheitern, Tiefen voll|scan, Standard voll');
    ok(D.artModus({ typ: 'forderung' }).id === 'ware' && D.artModus({ typ: 'forderung', parameter: {} }).ware_bei_scheitern === undefined && D.artModus({ typ: 'schmiergeld' }) === null, 'artModus: ohne Parameter Standard ware (ohne Felder), Beat-Typ ohne art_modi: null');
    ok(D.tiefeVon({ typ: 'forderung', parameter: { art: 'durchsuchung' } }) === 'voll' && D.tiefeVon({ typ: 'forderung', parameter: { art: 'durchsuchung', tiefe: 'scan' } }) === 'scan' && D.tiefeVon({ typ: 'forderung' }) === null, 'tiefeVon: Standard voll, scan aus dem Parameter, in der Art ware keine');
    ok(Pruefer.katalogFehler().length === 0, 'katalogFehler leer');
    ok(Baustein.datenFehler().length === 0, 'Daten in sich stimmig: ' + Baustein.datenFehler().join('; '));
    ok(Object.keys(f.art_modi.modi.durchsuchung.optionen_wirkung).join() === 'dulden,nicht_dulden' && f.art_modi.modi.durchsuchung.optionen_wirkung.dulden.durchsuchen === true && f.art_modi.modi.durchsuchung.optionen_wirkung.nicht_dulden.durchsuchen === undefined, 'nur dulden durchsucht (Katalog durchsuchen: true)');
    ok(D.BEATS.schmiergeld.optionen_wirkung.bestechen.durchsuchen === undefined, 'bestechen durchsucht nie (kein durchsuchen im Katalog)');
    const fund = Object.keys(WERTE.fund_ruf.wert);
    ok(fund.every((fr) => RUF[WERTE.fund_ruf.wert[fr]].fraktion === fr && RUF[WERTE.fund_ruf.wert[fr]].delta < 0), 'fund_ruf: jeder Grund steht in ruf-werte.json, gehoert der Fraktion und kostet Ruf (' + JSON.stringify(WERTE.fund_ruf.wert) + ')');
    ok(Object.keys(WERTE.bussgeld_marken.wert).join() === Object.keys(WERTE.bestechung_marken.wert).join() && BUSSE('gering') < PREIS_GERING, 'bussgeld_marken: dieselben Staerken wie die Bestechung, je Platz unter dem Bestechungspreis');
    for (const key of ['durchsuchung_zollschiff', 'schmiergeld_durchsuchung_zollschiff']) {
      const t = fmt(TEXTE.texte[key].text, { forderer: ZOLL.name, ware: 'W'.repeat(30), ort: 'O'.repeat(24), marken: String(WERTE.bestechung_marken.wert.stark) + ' ' + WERTE.marken_einheit.wert });
      ok(t.length <= BITTE.text_max.wert, 'Text ' + key + ' passt in die Leiste (' + t.length + ' Zeichen)');
    }
    ok(/Frachtraum zur Prüfung öffnen/.test(TEXTE.texte.durchsuchung_zollschiff.text), 'Zollschiff: „Frachtraum zur Prüfung öffnen“');
    ok(!ECHT.test(JSON.stringify(TEXTE)) && !/sprengstoff/i.test(JSON.stringify(TEXTE.durchsuchung)), 'die Texte der Durchsuchung nennen keine Art (nur Zahl der Plaetze)');
    ok(Geld.GRUENDE.includes('bussgeld') && typeof Geld.bussgeldZahlen === 'function', 'Geld: eigener Grund bussgeld und benannte Funktion bussgeldZahlen');
    ok(typeof Lager.lagerBeschlagnahmen === 'function' && typeof Lager.frachtDurchsuchen === 'function', 'fracht.js: lagerBeschlagnahmen als eigene benannte Funktion neben frachtDurchsuchen');
    // Grep: Art-, Option- und Beat-Namen der Durchsuchung stehen in keiner Zeichenkette des Servercodes
    const dateien = []; const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) geh(p); else if (/\.js$/.test(e.name)) dateien.push(p); } };
    geh(path.join(__dirname, '..', 'server'));
    const ohneKommentar = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const treffer = [];
    for (const d of dateien) { const t = ohneKommentar(fs.readFileSync(d, 'utf8')); for (const name of ['dulden', 'nicht_dulden', 'durchsuchung', 'forderung', 'schmiergeld']) if (new RegExp('[\'"`]' + name + '[\'"`]').test(t) && !/^(geld|kampagnegeld|faden-bausteine)\.js$/.test(path.basename(d))) treffer.push(path.basename(d) + ':' + name); }
    ok(treffer.length === 0, 'kein Art-, Options- oder Beat-Name (dulden, nicht_dulden, durchsuchung, forderung, schmiergeld) als Zeichenkette im Servercode: ' + treffer.join(', '));
  });

  await section('(b) Durchsuchen und Beschlagnahmen (Funktionsebene): illegal ungetarnt bei scan und voll, getarnt nur bei voll', async () => {
    for (const [tiefe, erwartet] of [['scan', 'sprengstoff'], ['voll', 'sprengstoff,waffen']]) {
      const x = bereit(11); const g = x.g;
      einlagern(g, [OFFEN, TARN, LEGAL]);
      const b = Lager.frachtDurchsuchen(g, { wer: 'test', tiefe });
      ok(b.ok && b.neu.map((q) => q.art).sort().join() === erwartet, 'Tiefe ' + tiefe + ': aufgedeckt ' + b.neu.map((q) => q.art).sort().join() + ' (erwartet ' + erwartet + ')');
      const w = Lager.lagerBeschlagnahmen(g, { wer: 'test' });
      ok(w.ok && w.plaetze.map((q) => q.art).sort().join() === erwartet && w.n === erwartet.split(',').length, 'Tiefe ' + tiefe + ': beschlagnahmt wird genau, was aufgedeckt und illegal ist');
      ok(arten(g) === (tiefe === 'scan' ? 'erz,waffen' : 'erz'), 'Tiefe ' + tiefe + ': im Frachtraum bleibt ' + arten(g) + (tiefe === 'scan' ? ' (die getarnte Ware haelt die Tarnung)' : ' (nur das legale Erz)'));
    }
    { // a) ungetarnt: scan und voll finden sie je fuer sich; b) getarnt allein: scan nichts, voll findet
      const s = bereit(12).g; einlagern(s, [TARN]);
      Lager.frachtDurchsuchen(s, { tiefe: 'scan' });
      ok(Lager.lagerBeschlagnahmen(s, {}).n === 0 && lager(s) === 1 && !s.fracht.lager[0].eig.aufgedeckt, 'getarnt, scan: nichts gefunden, die Tarnung haelt (nicht aufgedeckt)');
      Lager.frachtDurchsuchen(s, { tiefe: 'voll' });
      ok(Lager.lagerBeschlagnahmen(s, {}).n === 1 && lager(s) === 0, 'getarnt, danach voll: gefunden und beschlagnahmt');
    }
    { // nicht illegale getarnte Ware: aufgedeckt, aber nie genommen; Auftrag nie genommen; ohne Durchsuchung nichts
      const g = bereit(13).g; einlagern(g, [{ art: 'waffen', eig: { getarnt: 'fracht' } }, { art: 'bergungsgut', eig: { illegal: true, auftrag: 'f77' } }, OFFEN]);
      ok(Lager.lagerBeschlagnahmen(g, {}).n === 0 && lager(g) === 3, 'ohne vorherige Durchsuchung nimmt lagerBeschlagnahmen nichts (nur aufgedeckte Plaetze)');
      Lager.frachtDurchsuchen(g, { tiefe: 'voll' });
      const w = Lager.lagerBeschlagnahmen(g, {});
      ok(w.n === 1 && w.arten.join() === 'sprengstoff' && lager(g) === 2 && g.fracht.lager.some((l) => l.art === 'bergungsgut' && l.eig.auftrag === 'f77' && l.eig.aufgedeckt), 'nur die illegale Ware OHNE Auftrag geht; getarnte, nicht illegale Ware und illegale Auftragsware bleiben (die Auftragsware ist aufgedeckt)');
    }
    { // Ereignis und Meldung
      const x = bereit(14); einlagern(x.g, [OFFEN]);
      Lager.frachtDurchsuchen(x.g, { wer: 'Zoll', tiefe: 'voll' });
      const w = Lager.lagerBeschlagnahmen(x.g, { wer: 'Zoll' });
      const e = gesehen(x, 'frachtBeschlagnahmt');
      ok(e.length === 1 && e[0].d.n === 1 && e[0].d.wer === 'Zoll' && e[0].d.arten.join() === 'sprengstoff', 'Ereignis frachtBeschlagnahmt { wer, arten, n } (Vorbild frachtDurchsucht)');
      ok(x.odas.some((t) => /^Beschlagnahmt \(Zoll\)/.test(t)), 'ODA-Zeile Beschlagnahmt');
      lager(x.g); Lager.lagerBeschlagnahmen(x.g, { wer: 'Zoll' });
      ok(gesehen(x, 'frachtBeschlagnahmt').length === 2 && gesehen(x, 'frachtBeschlagnahmt')[1].d.n === 0 && w.n === 1, 'auch ohne Fund ein Ereignis (n 0), wie frachtDurchsucht');
    }
  });

  await section('(c) Tarnung: Bezeichnung, Funk, Leiste, Ereignisse verraten die echte Art einer getarnten Ware nie', async () => {
    // Die getarnte Ware bleibt verdeckt: Durchsuchung scan, bestechen, nicht dulden/verweigern -> der Spieler liest nirgends "Waffen"
    zoll('du_c1'); zoll('du_c2', { tiefe: 'scan' });
    { // scan: nichts gefunden, die Ware haelt die Tarnung
      const x = amZoll('du_c2', 21, [TARN, LEGAL]); const { g } = x;
      ok(!ECHT.test(JSON.stringify(Bitte.snapshot(g))) && !ECHT.test(JSON.stringify(g.snapshot().fracht)), 'vor der Durchsuchung: Leiste und Frachtanzeige nennen die Art nicht (Anzeige: ' + JSON.stringify(g.snapshot().fracht.lager) + ')');
      antwort(g, 'dulden');
      ok(lager(g) === x.lager0 && !g.fracht.lager.find((l) => l.art === 'waffen').eig.aufgedeckt, 'scan: nichts gefunden, die Tarnung haelt');
      ok(!ECHT.test(x.sichtbar()) && !ECHT.test(x.texte().join(' | ')), 'scan: ODA, Netz-Ereignisse und Funk nennen die echte Art nie (' + x.texte().join(' | ') + ')');
      ok(!ECHT.test(JSON.stringify(g.snapshot().fracht)) && g.snapshot().fracht.lager.includes('fracht'), 'scan: die Anzeige zeigt weiter die Tarnart Fracht');
      ok(x.texte().includes(TEXTE.durchsuchung.sauber) && !x.texte().some((t) => /Schmuggelware/.test(t)), 'scan: der Zoll findet nichts (Text sauber)');
    }
    { // bestechen, nie durchsucht
      const x = amZoll('du_c1', 22, [TARN]); const { g } = x;
      antwort(g, 'nicht_dulden'); starteBeat(x); antwort(g, 'bestechen');
      ok(!ECHT.test(x.sichtbar()) && !ECHT.test(x.texte().join(' | ')) && !ECHT.test(JSON.stringify(g.snapshot().fracht)), 'bestechen: nichts, was der Spieler liest, nennt die echte Art');
    }
    { // voll: gefunden. Funk und Leiste nennen die Art auch dann nie (nur die Zahl); ODA/Ereignis duerfen sie nach dem Fund nennen (aufgedeckt)
      const x = amZoll('du_c1', 23, [TARN]); const { g } = x;
      antwort(g, 'dulden');
      ok(lager(g) === 0 && x.texte().some((t) => t === fmt(TEXTE.durchsuchung.fund, { n: 1 })), 'voll: gefunden, beschlagnahmt, Funk nennt nur die Zahl: ' + x.texte().join(' | '));
      ok(!ECHT.test(x.texte().join(' | ')), 'voll: auch der Funk nennt die Art nie');
      ok(x.odas.some((t) => ECHT.test(t)) && gesehen(x, 'frachtDurchsucht')[0].d.arten.join() === 'waffen', 'nach dem Fund ist die Tarnung gefallen: ODA und das serverinterne Ereignis nennen die echte Art (LAD-01: Tarnung faellt)');
    }
    { // Faden-Ware getarnt: der Funk beim Laden nennt die Ware des Fadens, nie die echte Art; Preis darf sie verraten, Bezeichnung nicht
      schmuggel('du_c3', { lade: { ladung: 'waffen', tarnung: 'fracht', illegal: true } });
      const x = bereit(24); x.f = oeffne(x.g, 'du_c3'); starteBeat(x);
      ok(x.g.fracht.lager.length === 1 && x.g.fracht.lager[0].art === 'waffen' && x.g.fracht.lager[0].eig.getarnt === 'fracht', 'Faden-Ware: echte Art waffen, getarnt als fracht');
      ok(!ECHT.test(x.sichtbar()) && !ECHT.test(x.texte().join(' | ')) && !ECHT.test(JSON.stringify(x.g.snapshot().fracht)), 'Laden der getarnten Faden-Ware: Funk, ODA, Ereignisse und Anzeige nennen die echte Art nie (' + x.texte().join(' | ') + ')');
    }
  });

  await section('(d) beschlagnahmte Ware ist weg: Platz frei, nicht zurueckholbar', async () => {
    zoll('du_d');
    const x = amZoll('du_d', 31, [OFFEN, TARN, LEGAL]); const { g } = x;
    const frei0 = Lager.frei(g), abg0 = Lager.abgeliefert(g);
    ok(antwort(g, 'dulden') === null, 'Dulden wird angenommen');
    ok(arten(g) === 'erz' && lager(g) === 1 && Lager.frei(g) === frei0 + 2, 'beide Schmuggelplaetze sind aus dem Frachtraum, zwei Plaetze frei, das legale Erz bleibt (' + arten(g) + ')');
    ok(g.fracht.draussen.length === 0 && Lager.anBord(g, 'sprengstoff') === 0 && Lager.anBord(g, 'waffen') === 0, 'nicht als Pod im All, nirgends im Lager');
    ok(Lager.abgeliefert(g) === abg0, 'nicht als abgeliefert gezaehlt');
    const e = gesehen(x, 'frachtBeschlagnahmt');
    ok(e.length === 1 && e[0].d.n === 2 && e[0].d.arten.sort().join() === 'sprengstoff,waffen', 'Ereignis frachtBeschlagnahmt mit n 2');
    // Neu laden: der Frachtraum nimmt wieder Ware, die beschlagnahmte ist nicht zurueck
    const w = Lager.lagerBeschlagnahmen(g, { wer: 'noch einmal' });
    ok(w.n === 0 && arten(g) === 'erz', 'eine zweite Beschlagnahme findet nichts mehr');
    const data = Weltstand.capture(g); const y = bereit(32);
    Weltstand.apply(y.g, JSON.parse(JSON.stringify(data)));
    ok(arten(y.g) === 'erz', 'auch im gespeicherten und geladenen Stand ist sie weg (' + arten(y.g) + ')');
  });

  await section('(e) Auftragsware des Fadens bleibt bei der Durchsuchung (auch illegale und getarnte)', async () => {
    const lade = { ladung: 'waffen', tarnung: 'fracht', illegal: true };
    schmuggel('du_e', { lade }); schmuggel('du_e2', { lade, tiefe: 'scan' });
    { // voll: die Auftragsware wird aufgedeckt, aber nicht genommen; zusaetzliche Schmuggelware (Sprengstoff) geht
      const x = amSchmuggel('du_e', 41, [OFFEN]); const { g, f } = x;
      const ware = g.fracht.lager.find((l) => l.eig && l.eig.auftrag === f.id);
      ok(!!ware && ware.art === 'waffen' && ware.eig.illegal === true && ware.eig.getarnt === 'fracht' && lager(g) === 2, 'Faden-Ware: Waffen, illegal, getarnt als Fracht, mit Auftrag; dazu eine fremde Schmuggelkiste');
      ok(antwort(g, 'dulden') === null, 'Dulden wird angenommen');
      ok(arten(g) === 'waffen' && Lager.auftragAnBord(g, f.id) === 1 && !!f.fracht, 'die Auftragsware liegt noch im Frachtraum und am Faden; nur der fremde Sprengstoff ging');
      ok(ware.eig.aufgedeckt === true && g.snapshot().fracht.lager.join() === 'waffen', 'die Auftragsware ist aufgedeckt (Tarnung gefallen), aber nicht genommen');
      ok(gesehen(x, 'frachtBeschlagnahmt')[0].d.n === 1 && ereignisse(f).slice(-1)[0] === 'forderung_gescheitert' && f.phase === 'wartet' && D.vorlage(f.vorlage).beats[f.beat].id === 'b_abgabe', 'ein Fund (der Sprengstoff); die Faden-Ware bleibt, der Faden geht weiter zum Abliefern');
      starteBeat(x); andocken(g, ZIEL);
      ok(!f.fracht && lager(g) === 0 && ereignisse(f).slice(-1)[0] === 'fracht_gelungen', 'die Auftragsware wird danach abgeliefert (fracht_gelungen)');
    }
    { // nur Auftragsware (illegal, aufgedeckt): ein Fund ist ein Fund (Bussgeld, Ruf, Meldung), genommen wird sie nicht (BEA-01 Nacharbeit)
      const x = amSchmuggel('du_e', 42, []); const { g, f } = x;
      antwort(g, 'dulden');
      ok(lager(g) === 1 && !!f.fracht && gesehen(x, 'frachtBeschlagnahmt')[0].d.n === 0, 'nur Auftragsware: nichts beschlagnahmt, sie bleibt am Faden und im Frachtraum');
      ok(!x.texte().includes(TEXTE.durchsuchung.sauber) && x.radio.some((q) => q.text === fmt(TEXTE.durchsuchung.fund_auftrag, { n: 1 }) && q.von === ZOLL.name), 'der Zoll meldet den Fund (nicht "sauber"), ohne zu sagen, was es ist');
      ok(!/waffen|Waffen|sprengstoff/i.test(x.texte().join(' | ')), 'Funk nennt die echte Art nie');
      ok(marken(g) === x.vorher - BUSSE('gering') && Ruf.ruf(g, 'rom') === x.ruf0 + FUND_DELTA, 'Bussgeld (ein Platz) und Ruf-Abzug wie bei anderer Schmuggelware: Marken ' + marken(g) + ', Ruf ' + Ruf.ruf(g, 'rom'));
    }
    { // scan: die getarnte Auftragsware bleibt auch verdeckt
      const x = amSchmuggel('du_e2', 43, []); const { g, f } = x;
      antwort(g, 'dulden');
      const ware = g.fracht.lager.find((l) => l.eig && l.eig.auftrag === f.id);
      ok(!!f.fracht && !ware.eig.aufgedeckt && g.snapshot().fracht.lager.join() === 'fracht', 'scan: die getarnte Auftragsware haelt die Tarnung (Anzeige Fracht)');
      ok(marken(g) === x.vorher && Ruf.ruf(g, 'rom') === x.ruf0 && x.texte().includes(TEXTE.durchsuchung.sauber), 'scan: nichts aufgedeckt, also kein Fund (sauber, keine Strafe)');
    }
  });

  await section('(f) sauberer Frachtraum: nichts gefunden, der Faden geht weiter, keine Folge', async () => {
    zoll('du_f');
    for (const [name, items] of [['leer', []], ['nur legale Ware', [LEGAL]]]) {
      const x = amZoll('du_f', 51, items); const { g, f } = x;
      ok(antwort(g, 'dulden') === null, name + ': Dulden wird angenommen');
      ok(lager(g) === x.lager0 && marken(g) === x.vorher && Ruf.ruf(g, 'rom') === x.ruf0, name + ': Frachtraum, Marken und Ruf unveraendert');
      ok(x.texte().includes(TEXTE.durchsuchung.sauber) && !x.texte().some((t) => /Bußgeld|Schmuggelware/.test(t)), name + ': der Zoll meldet den Frachtraum als geprueft, keine Strafe');
      ok(f.phase === 'wartet' && D.vorlage(f.vorlage).beats[f.beat].id === 'b_ende' && ereignisse(f).slice(-1)[0] === 'forderung_gescheitert', name + ': der Faden steht vor dem Abschluss');
      ok(gesehen(x, 'frachtDurchsucht').length === 1 && gesehen(x, 'frachtDurchsucht')[0].d.wer === ZOLL.name && gesehen(x, 'frachtDurchsucht')[0].d.tiefe === 'voll', name + ': genau eine Durchsuchung durch den Zoll mit Tiefe voll (Standard)');
      grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'abgeschlossen', name + ': der Faden laeuft zum Abschluss');
    }
  });

  await section('(g) Fund: Ruf-Folge und Bussgeld nach den Daten', async () => {
    zoll('du_g');
    { // zwei Plaetze: Bussgeld je Platz, Ruf einmal
      const x = amZoll('du_g', 61, [OFFEN, TARN]); const { g, radio } = x;
      let bezahlt = null; const orig = g.missionEvent.bind(g); g.missionEvent = (k, d) => { if (k === 'marksPaid') bezahlt = d; return orig(k, d); };
      antwort(g, 'dulden');
      const busse = 2 * BUSSE('gering');
      ok(marken(g) === x.vorher - busse && bezahlt === null, 'Bussgeld ' + busse + ' Marken (2 Plaetze x ' + BUSSE('gering') + ', Staerke gering aus dem Beat), still (kein marksPaid)');
      ok(Ruf.ruf(g, 'rom') === x.ruf0 + FUND_DELTA, 'Ruf Rom: ' + x.ruf0 + ' ' + FUND_DELTA + ' = ' + Ruf.ruf(g, 'rom') + ' (Grund ' + FUND_GRUND + ', einmal je Durchsuchung)');
      ok(radio.some((q) => q.text === fmt(TEXTE.durchsuchung.fund, { n: 2 }) && q.von === ZOLL.name) && radio.some((q) => q.text === fmt(TEXTE.durchsuchung.bussgeld, { marken: busse + ' ' + WERTE.marken_einheit.wert })), 'Funk des Zolls: Fund mit Zahl, Bussgeld mit Betrag');
      ok(lager(g) === x.lager0 - 2, 'die zwei Plaetze sind weg');
      ok(ereignisse(x.f).slice(-1)[0] === 'forderung_gescheitert', 'Gedaechtnis: forderung_gescheitert (der Ausgang haengt nie vom Fund ab)');
    }
    { // Bussgeld nie ueber den Stand: nur 10 Marken, Bussgeld 15
      const x = amZoll('du_g', 62, [OFFEN], 10); const { g } = x;
      antwort(g, 'dulden');
      ok(marken(g) === 0 && lager(g) === 0, 'zu wenig Marken: die Strafe nimmt, was da ist (Stand 0, kein Minus), die Wahl ging trotzdem');
    }
    { // Ruf klemmt bei 0
      const x = amZoll('du_g', 63, [OFFEN]); Ruf.aendern(x.g, 'rom', -Ruf.ruf(x.g, 'rom'));
      antwort(x.g, 'dulden');
      ok(Ruf.ruf(x.g, 'rom') === 0, 'Rom-Ruf 0 bleibt 0 (Untergrenze der Daten)');
    }
    { // Zoll-Staerke aus dem Beat: mittel kostet mehr je Platz
      registriere(alsVorlage('du_g2', (v) => {
        v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
        v.beats = [
          { id: 'b_forderung', typ: 'forderung', parameter: { text_key: 'durchsuchung_zollschiff', art: 'durchsuchung' }, optionen: optionen('forderung', 'durchsuchung'), aus: { gelungen: WEG('aktiv', 'b_ende'), gescheitert: WEG('aktiv', 'b_x') } },
          { id: 'b_x', typ: 'raumschlacht', aus: { gelungen: WEG('aktiv', 'b_ende'), gescheitert: WEG('geflohen', 'b_ende') } },
          { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['raumschlacht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
        ];
      }));
      const x = amZoll('du_g2', 64, [OFFEN]);
      antwort(x.g, 'dulden');
      ok(marken(x.g) === x.vorher - BUSSE(), 'ohne staerke gilt die Standardstaerke (' + WERTE.staerke_standard.wert + '): ' + BUSSE() + ' Marken');
    }
  });

  await section('(h) bestechen: keine Durchsuchung, Marken abgebucht, die Ware bleibt (auch die getarnte)', async () => {
    zoll('du_h');
    const x = amZoll('du_h', 71, [OFFEN, TARN, LEGAL]); const { g, f } = x;
    ok(antwort(g, 'nicht_dulden') === null && f.phase === 'wartet' && D.vorlage(f.vorlage).beats[f.beat].id === 'b_schmier', 'Nicht dulden: weiter zum Schmiergeld');
    starteBeat(x);
    const a = angebot(g);
    ok(!!a && a.text === fmt(TEXTE.texte.schmiergeld_durchsuchung_zollschiff.text, { marken: PREIS_GERING + ' ' + WERTE.marken_einheit.wert }) && a.optionen.map((o) => o.id).join() === 'bestechen,verweigern', 'Schmiergeld der Durchsuchung: eigener Text mit dem Preis (' + (a && a.text) + ')');
    let gezahlt = null; const orig = g.missionEvent.bind(g); g.missionEvent = (k, d) => { if (k === 'marksPaid') gezahlt = d; return orig(k, d); };
    ok(antwort(g, 'bestechen') === null, 'Bestechen wird angenommen');
    ok(marken(g) === x.vorher - PREIS_GERING && gezahlt && gezahlt.grund === 'bestechungsgeld' && gezahlt.n === PREIS_GERING, 'Marken abgebucht: ' + PREIS_GERING + ' (Grund bestechungsgeld)');
    ok(gesehen(x, 'frachtDurchsucht').length === 0 && gesehen(x, 'frachtBeschlagnahmt').length === 0, 'keine Durchsuchung, keine Beschlagnahme');
    ok(lager(g) === x.lager0 && arten(g) === 'erz,sprengstoff,waffen' && g.fracht.lager.every((l) => !(l.eig && l.eig.aufgedeckt)), 'die Ware bleibt, auch die getarnte; nichts aufgedeckt');
    ok(Ruf.ruf(g, 'rom') === x.ruf0 && !x.texte().some((t) => t === TEXTE.durchsuchung.fund || t === TEXTE.durchsuchung.sauber), 'kein Ruf-Abzug, kein Fund-Funk');
    ok(f.phase === 'wartet' && D.vorlage(f.vorlage).beats[f.beat].id === 'b_ende' && ereignisse(f).slice(-1)[0] === 'schmiergeld_gelungen', 'der Faden geht ohne Kampf zum Abschluss');
  });

  await section('(i) nicht dulden und verweigern: Kampf, die Ware bleibt', async () => {
    zoll('du_i');
    const x = amZoll('du_i', 81, [OFFEN, TARN]); const { g, f } = x;
    antwort(g, 'nicht_dulden'); starteBeat(x);
    ok(antwort(g, 'verweigern') === null && f.phase === 'wartet' && D.vorlage(f.vorlage).beats[f.beat].typ === 'raumschlacht', 'Verweigern: weiter in den Beat raumschlacht');
    ok(lager(g) === x.lager0 && arten(g) === 'sprengstoff,waffen' && g.fracht.lager.every((l) => !(l.eig && l.eig.aufgedeckt)) && marken(g) === x.vorher && Ruf.ruf(g, 'rom') === x.ruf0, 'die Ware bleibt (auch die getarnte), nichts aufgedeckt, nichts bezahlt, kein Ruf-Abzug');
    ok(gesehen(x, 'frachtDurchsucht').length === 0, 'keine Durchsuchung');
    starteBeat(x);
    ok(f.phase === 'laeuft' && D.vorlage(f.vorlage).beats[f.beat].typ === 'raumschlacht', 'der Beat raumschlacht laeuft');
    Faden.beatAusgang(g, f.id, 'gelungen'); grenzen(g, 5); weiter(g, f);
    ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'nach gewonnenem Kampf: Abschluss gelungen');
    // Schweigen auf die Forderung (Frist der Bitte): der Zoll wartet nicht, Schweigen gilt als dulden (Katalog bei_verfall): die Durchsuchung laeuft, Ausgang gescheitert wie bei dulden
    const y = amZoll('du_i', 82, [OFFEN, TARN]);
    grenzen(y.g, BITTE_FRIST + 1);
    ok(angebot(y.g) === null && y.f.phase === 'wartet' && D.vorlage(y.f.vorlage).beats[y.f.beat].id === 'b_ende' && ereignisse(y.f).slice(-1)[0] === 'forderung_gescheitert', 'Frist ohne Antwort: gescheitert wie dulden, der Faden steht vor dem Abschluss');
    ok(gesehen(y, 'frachtDurchsucht').length === 1 && arten(y.g) === '' && marken(y.g) === y.vorher - 2 * BUSSE('gering') && y.radio.some((q) => q.text === fmt(TEXTE.durchsuchung.fund, { n: 2 })), 'Schweigen ist keine Ausrede: der Zoll durchsucht trotzdem (Fund, Bussgeld)');
    const y2 = amZoll('du_i', 84, [OFFEN]); const nr84 = angebot(y2.g).nr;
    antwort(y2.g, 'dulden');
    ok(Bitte.beantworten(y2.g, 'dulden', nr84).code === 'schon_beantwortet' && gesehen(y2, 'frachtDurchsucht').length === 1, 'nach der Antwort verfaellt nichts mehr: nur eine Durchsuchung');
    // Notsprung in der Wahl: die Ware des Fadens geht verloren wie sonst; das Angebot ist weg
    schmuggel('du_i2', { lade: { ladung: 'waffen', tarnung: 'fracht', illegal: true } });
    const z = amSchmuggel('du_i2', 83, []);
    ok(Fracht.notsprung(z.g).join() === z.f.id && lager(z.g) === 0, 'Notsprung in der Wahl: die Ware ist wie ueberall verloren (nur die Wahl dulden laesst sie am Faden)');
  });

  await section('(j) Speichern und Laden zwischen Durchsuchung und Folge', async () => {
    const lade = { ladung: 'waffen', tarnung: 'fracht', illegal: true };
    schmuggel('du_j', { lade });
    { // mitten in der Wahl: das Angebot der Durchsuchung ueberlebt
      const x = amSchmuggel('du_j', 91, [OFFEN]); const { g, f } = x; const a = angebot(g);
      const data = Weltstand.capture(g);
      ok(Weltstand.validate(data, g).length === 0, 'Weltstand mit offener Durchsuchungs-Forderung besteht das Schema: ' + Weltstand.validate(data, g).slice(0, 2).join('; '));
      const y = bereit(92); Weltstand.apply(y.g, JSON.parse(JSON.stringify(data)));
      const h = y.g.weltsim.faeden.liste.find((q) => q.id === f.id), a2 = angebot(y.g);
      ok(!!a2 && a2.text === a.text && a2.von === ZOLL.name && a2.kopf === ZOLL.kopf && a2.optionen.map((o) => o.id).join() === 'dulden,nicht_dulden', 'nach dem Laden steht dieselbe Forderung (Zoll, Optionen dulden/nicht_dulden)');
      ok(!!h && !!h.fracht && lager(y.g) === 2 && y.g.fracht.lager.some((l) => l.eig.auftrag === h.id && l.eig.illegal && l.eig.getarnt === 'fracht') && y.g.fracht.lager.some((l) => l.art === 'sprengstoff' && l.eig.illegal), 'Frachtraum im geladenen Stand: Auftragsware (illegal, getarnt, Auftrag) und die Schmuggelkiste');
      y.g.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
      Ruf.aendern(y.g, 'rom', 20 - Ruf.ruf(y.g, 'rom'));
      const m0 = marken(y.g), r0 = Ruf.ruf(y.g, 'rom');
      ok(Bitte.beantworten(y.g, 'dulden', a2.nr) === null && arten(y.g) === 'waffen' && marken(y.g) === m0 - 2 * BUSSE('gering') && Ruf.ruf(y.g, 'rom') === r0 + FUND_DELTA, 'im geladenen Stand wirkt dulden: Fund (Sprengstoff genommen, Auftragsware zaehlt mit), Bussgeld, Ruf wie im ungeladenen');
    }
    { // nach der Durchsuchung (Fund, Folge gebucht): speichern, laden, weiterspielen
      const x = amSchmuggel('du_j', 93, [OFFEN]); const { g, f } = x;
      antwort(g, 'dulden');
      const m1 = marken(g), r1 = Ruf.ruf(g, 'rom');
      const data = Weltstand.capture(g);
      ok(Weltstand.validate(data, g).length === 0, 'Weltstand nach der Durchsuchung besteht das Schema: ' + Weltstand.validate(data, g).slice(0, 2).join('; '));
      const y = bereit(94); const g2 = y.g; Weltstand.apply(g2, JSON.parse(JSON.stringify(data)));
      const h = g2.weltsim.faeden.liste.find((q) => q.id === f.id);
      ok(!!h && !!h.fracht && h.phase === 'wartet' && D.vorlage(h.vorlage).beats[h.beat].id === 'b_abgabe', 'der Faden steht nach dem Laden vor dem Abliefern, die Ware haengt am Faden');
      ok(arten(g2) === 'waffen' && g2.fracht.lager[0].eig.aufgedeckt === true && g2.fracht.lager[0].eig.getarnt === 'fracht' && Lager.auftragAnBord(g2, h.id) === 1, 'Frachtraum: nur die Auftragsware, aufgedeckt, mit Tarnart und Auftrag (die Schmuggelkiste bleibt weg)');
      ok(marken(g2) === m1 && Ruf.ruf(g2, 'rom') === r1, 'Marken und Ruf der Folge stehen im geladenen Stand');
      g2.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
      grenzen(g2, 5); weiter(g2, h); andocken(g2, ZIEL);
      ok(!h.fracht && lager(g2) === 0 && ereignisse(h).slice(-1)[0] === 'fracht_gelungen', 'im geladenen Stand wird die Auftragsware abgeliefert (fracht_gelungen)');
    }
  });

  await section('(k) Pruefer: art, tiefe, Optionen und Ladung (Gegenproben), Standard byte-gleich zu Paket A', async () => {
    zoll('du_k0');
    const codes = (r) => r.fehler.map((s) => String(s).split(':')[0]);
    const pruefe = (id, aendern) => { const v = klon(D.vorlage('du_k0')); v.id = id; aendern(v); return Pruefer.pruefeVorlage(v); };
    const fb = (v) => v.beats.find((b) => b.id === 'b_forderung');
    ok(Pruefer.pruefeVorlage(klon(D.vorlage('du_k0'))).ok, 'Zoll-Vorlage mit art durchsuchung besteht den Pruefer');
    const t1 = pruefe('du_k1', (v) => { fb(v).parameter.art = 'raub'; });
    ok(!t1.ok && codes(t1).includes('PARAMETER') && /art "raub" ist unbekannt/.test(t1.fehler.join(' ')), 'art "raub": PARAMETER');
    const t2 = pruefe('du_k2', (v) => { fb(v).parameter.tiefe = 'tief'; });
    ok(!t2.ok && codes(t2).includes('PARAMETER') && /tiefe "tief" ist unbekannt/.test(t2.fehler.join(' ')), 'tiefe "tief": PARAMETER');
    ok(pruefe('du_k3', (v) => { fb(v).parameter.tiefe = 'scan'; }).ok && pruefe('du_k3b', (v) => { fb(v).parameter.tiefe = 'voll'; }).ok, 'tiefe scan und voll sind gueltig');
    const t4 = pruefe('du_k4', (v) => { delete fb(v).parameter.art; fb(v).parameter.tiefe = 'scan'; fb(v).optionen = optionen('forderung', 'ware'); });
    ok(!t4.ok && /tiefe gibt es nur mit art durchsuchung/.test(t4.fehler.join(' ')), 'tiefe ohne art durchsuchung: PARAMETER');
    const t5 = pruefe('du_k5', (v) => { fb(v).parameter.art = 'ware'; fb(v).parameter.tiefe = 'scan'; });
    ok(!t5.ok && codes(t5).includes('PARAMETER'), 'tiefe in der Art ware: PARAMETER');
    const t6 = pruefe('du_k6', (v) => { fb(v).optionen = optionen('forderung', 'ware'); });
    ok(!t6.ok && codes(t6).includes('OPTION_UNGUELTIG') && /ausliefern gehoert nicht zu dieser Art/.test(t6.fehler.join(' ')), 'Optionen ausliefern/nicht_ausliefern in der Art durchsuchung: OPTION_UNGUELTIG');
    const t7 = pruefe('du_k7', (v) => { delete fb(v).parameter.art; });
    ok(!t7.ok && codes(t7).includes('OPTION_UNGUELTIG') && /dulden gehoert nicht zu dieser Art/.test(t7.fehler.join(' ')), 'Optionen dulden in der Art ware (ohne art): OPTION_UNGUELTIG');
    const t8 = pruefe('du_k8', (v) => { v.beats.find((b) => b.id === 'b_schmier').optionen[0].id = 'bestechen2'; });
    ok(!t8.ok && codes(t8).includes('OPTION_UNGUELTIG'), 'eine fremde Option-Id im Schmiergeld: OPTION_UNGUELTIG');
    ok(codes(pruefe('du_k9', (v) => { fb(v).aus.gescheitert.weiter = 'b_schmier'; })).includes('OPTIONEN_GLEICHER_WEG'), 'OPTIONEN_GLEICHER_WEG bleibt: gelungen und gescheitert ins gleiche Ziel');
    ok(codes(pruefe('du_k10', (v) => { fb(v).gefahr = true; })).includes('OPTION_BEI_GEFAHR'), 'OPTION_BEI_GEFAHR bleibt: Optionen bei Gefahr weiter verboten');
    // Ladung des Beats fracht
    schmuggel('du_k20', { lade: { ladung: 'waffen', tarnung: 'fracht', illegal: true } });
    ok(Pruefer.pruefeVorlage(klon(D.vorlage('du_k20'))).ok, 'fracht mit ladung waffen, tarnung fracht, illegal: gueltig');
    const lb = (id, p) => { const v = klon(D.vorlage('du_k20')); v.id = id; Object.assign(v.beats[0].parameter, p); return Pruefer.pruefeVorlage(v); };
    for (const [name, p, re] of [
      ['ladung unbekannt', { ladung: 'gold' }, /ladung "gold" ist keine Ware/],
      ['ladung Person', { ladung: 'person' }, /ladung "person" ist keine Ware/],
      ['tarnung unbekannt', { tarnung: 'gold' }, /tarnung "gold" muss eine andere Ware/],
      ['tarnung = ladung', { tarnung: 'waffen' }, /tarnung "waffen" muss eine andere Ware/],
      ['illegal als Text', { illegal: 'ja' }, /illegal ist ein Wahrheitswert/],
      ['tarnung als Wahrheitswert', { tarnung: true }, /tarnung braucht eine Art/],
    ]) { const r = lb('du_k21', p); ok(!r.ok && codes(r).includes('PARAMETER') && re.test(r.fehler.join(' ')), 'fracht: ' + name + ' -> PARAMETER'); }
    ok(lb('du_k22', { illegal: false }).ok, 'illegal: false ist gueltig (keine Eigenschaft)');
    // Standard byte-gleich: art ware ausdruecklich = ohne Parameter (Paket A): gleicher Lauf, gleiche Spuren
    zoll('du_k30', { art: null }); zoll('du_k31', { art: 'ware' });
    const lauf = (id, seed) => {
      const x = bereit(seed); x.f = oeffne(x.g, id); mitWare(x); starteBeat(x);
      const spur = [];
      spur.push(angebot(x.g).text, angebot(x.g).optionen.map((o) => o.id).join());
      antwort(x.g, 'nicht_ausliefern'); starteBeat(x); antwort(x.g, 'bestechen');
      grenzen(x.g, 5); weiter(x.g, x.f);
      spur.push(marken(x.g), x.f.phase, x.f.ausgang && x.f.ausgang.art, ereignisse(x.f).join(), x.texte().join(' | '), JSON.stringify(x.mevts.map((e) => e.k)));
      return JSON.stringify(spur);
    };
    ok(lauf('du_k30', 101) === lauf('du_k31', 101), 'art ware ausdruecklich und ohne Parameter: gleicher Lauf (Texte, Optionen, Marken, Ereignisse, Funk)');
    const l0 = bereit(102); l0.f = oeffne(l0.g, 'du_k30'); mitWare(l0); starteBeat(l0);
    ok(angebot(l0.g).text === fmt(TEXTE.texte.forderung_zollschiff.text, { ware: require('../content/faeden/szenen-werte.json').werte.waren.wert.fracht_kiste.name, ort: Sektoren.hexName(l0.f.parameter.ort) || 'hier' }) && angebot(l0.g).optionen.map((o) => o.id).join() === 'ausliefern,nicht_ausliefern', 'ohne art: Text und Optionen wie in Paket A (ausliefern, nicht_ausliefern)');
    // Standard des Beats fracht: ohne Parameter Art fracht, nur der Auftrag
    ok(JSON.stringify(Fracht.ladungVon({ typ: 'fracht', parameter: { nach: ZIEL } })) === '{"art":"fracht","eigenschaften":{}}' && JSON.stringify(Fracht.ladungVon({ typ: 'fracht', parameter: { nach: ZIEL, ware: 'erz' } })) === '{"art":"fracht","eigenschaften":{}}', 'ladungVon ohne Parameter: Art fracht, keine Eigenschaften (der Parameter ware aendert die Ladung nie)');
  });

  await section('(l) Zollschiff-Vorlage komplett mit art durchsuchung: alle Wege bis zum Abschluss', async () => {
    zoll('du_l');
    const bis = (x) => { grenzen(x.g, 5); weiter(x.g, x.f); };
    { // dulden mit Fund
      const x = amZoll('du_l', 111, [OFFEN]); const { g, f } = x;
      const a = angebot(g);
      ok(!!a && a.von === ZOLL.name && a.kopf === 'ZOLL' && a.text === fmt(TEXTE.texte.durchsuchung_zollschiff.text, { ort: Sektoren.hexName(f.parameter.ort) || 'hier' }) && a.optionen.map((o) => o.text).join() === 'Durchsuchung dulden,Nicht dulden', 'Angebot: Zollschiff, Text „Frachtraum zur Prüfung öffnen“, Optionen Durchsuchung dulden / Nicht dulden: ' + (a && a.text));
      ok(x.radio.some((q) => q.von === ZOLL.name && q.text === a.text), 'das Ultimatum steht im Funk mit dem Zollschiff als Absender');
      antwort(g, 'dulden');
      ok(x.radio.some((q) => q.text === 'Durchsuchung dulden') && x.radio.some((q) => q.text === TEXTE.reaktionen.dulden && q.von === ZOLL.name), 'Funk: die Crew antwortet mit dem Text der Option, der Zoll reagiert');
      bis(x);
      ok(f.phase === 'abgeschlossen' && ereignisse(f)[0] === 'forderung_gescheitert', 'Abschluss erreicht nach dulden (' + ereignisse(f).join() + ')');
    }
    { // nicht dulden -> bestechen
      const x = amZoll('du_l', 112, [OFFEN]); const { g, f } = x;
      antwort(g, 'nicht_dulden'); starteBeat(x); antwort(g, 'bestechen'); bis(x);
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen' && ereignisse(f).slice(0, 2).join() === 'forderung_gelungen,schmiergeld_gelungen' && lager(g) === 1 && marken(g) === x.vorher - PREIS_GERING, 'nicht dulden, bestechen: Abschluss gelungen, die Ware bleibt, ' + PREIS_GERING + ' Marken');
    }
    { // nicht dulden -> verweigern -> Kampf gewonnen
      const x = amZoll('du_l', 113, [OFFEN]); const { g, f } = x;
      antwort(g, 'nicht_dulden'); starteBeat(x); antwort(g, 'verweigern'); starteBeat(x);
      Faden.beatAusgang(g, f.id, 'gelungen'); bis(x);
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen' && lager(g) === 1, 'nicht dulden, verweigern, Kampf gewonnen: Abschluss gelungen, die Ware bleibt');
    }
    { // nicht dulden -> verweigern -> Kampf verloren
      const x = amZoll('du_l', 114, []); const { g, f } = x;
      antwort(g, 'nicht_dulden'); starteBeat(x); antwort(g, 'verweigern'); starteBeat(x);
      Faden.beatAusgang(g, f.id, 'gescheitert'); bis(x);
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', 'Kampf verloren: Abschluss gescheitert');
    }
    { // tiefe scan: die Vorlage mit scan durchsucht nur ungetarnte Ware
      zoll('du_l2', { tiefe: 'scan' });
      const x = amZoll('du_l2', 115, [OFFEN, TARN]); const { g } = x;
      antwort(g, 'dulden');
      ok(arten(g) === 'waffen' && gesehen(x, 'frachtDurchsucht')[0].d.tiefe === 'scan' && x.texte().includes(fmt(TEXTE.durchsuchung.fund, { n: 1 })), 'Vorlage mit tiefe scan: der Sprengstoff geht, die getarnten Waffen bleiben');
    }
    { // der Beat ohne Schmuggel-Vorlage: kein Haendler, keine Ware, keine Enthuellung
      const x = amZoll('du_l', 116, []);
      ok(!x.f.fracht && !x.f.nsc.wahrheit, 'ohne Haendler: keine Ware am Faden, keine verborgene Wahrheit');
    }
  });

  await section('(m) Mehrspieler: zwei Antworten, die erste gilt', async () => {
    zoll('du_m');
    const x = amZoll('du_m', 121, [OFFEN]); const { g } = x;
    const nr = angebot(g).nr;
    const a1 = Bitte.beantworten(g, 'dulden', nr), a2 = Bitte.beantworten(g, 'nicht_dulden', nr);
    ok(a1 === null && a2 && a2.code === 'schon_beantwortet', 'die zweite Antwort wird verworfen (schon_beantwortet)');
    ok(gesehen(x, 'frachtDurchsucht').length === 1 && marken(g) === x.vorher - BUSSE('gering') && lager(g) === 0, 'genau eine Durchsuchung, einmal Bussgeld, die Ware weg');
    const y = amZoll('du_m', 122, [OFFEN]); const nr2 = angebot(y.g).nr;
    Bitte.beantworten(y.g, 'nicht_dulden', nr2); const z = Bitte.beantworten(y.g, 'dulden', nr2);
    ok(z && z.code === 'schon_beantwortet' && lager(y.g) === 1 && gesehen(y, 'frachtDurchsucht').length === 0, 'erst nicht dulden, dann dulden: die zweite wird verworfen, nichts durchsucht, die Ware bleibt');
  });

  await section('(n) Zuweisung illegal/getarnt beim Laden (Beat fracht, Parameter ladung, illegal, tarnung)', async () => {
    { // Standard: wie vor BEA-01 B
      schmuggel('du_n0', {});
      const x = bereit(131); x.f = oeffne(x.g, 'du_n0'); starteBeat(x);
      const e = x.g.fracht.lager[0];
      ok(lager(x.g) === 1 && e.art === 'fracht' && JSON.stringify(e.eig) === JSON.stringify({ auftrag: x.f.id }), 'ohne Parameter: Art fracht, nur der Auftrag des Fadens: ' + JSON.stringify(e));
    }
    { // illegal ohne Tarnung
      schmuggel('du_n1', { lade: { ladung: 'sprengstoff', illegal: true } });
      const x = bereit(132); x.f = oeffne(x.g, 'du_n1'); starteBeat(x);
      const e = x.g.fracht.lager[0];
      ok(e.art === 'sprengstoff' && e.eig.illegal === true && !e.eig.getarnt && e.eig.auftrag === x.f.id, 'ladung sprengstoff, illegal: ungetarnte Schmuggelware mit Auftrag');
      ok(x.g.snapshot().fracht.lager.join() === 'sprengstoff', 'ungetarnt zeigt die Anzeige die echte Art');
    }
    { // getarnt und illegal
      schmuggel('du_n2', { lade: { ladung: 'waffen', illegal: true, tarnung: 'fracht' } });
      const x = bereit(133); x.f = oeffne(x.g, 'du_n2'); starteBeat(x);
      const e = x.g.fracht.lager[0];
      ok(e.art === 'waffen' && e.eig.illegal === true && e.eig.getarnt === 'fracht' && e.eig.auftrag === x.f.id, 'ladung waffen, illegal, tarnung fracht: Waffen getarnt als Fracht mit Auftrag');
      ok(x.g.snapshot().fracht.lager.join() === 'fracht' && !ECHT.test(x.texte().join(' ')), 'die Anzeige zeigt die Tarnart; Funk beim Laden nennt die Faden-Ware: ' + x.texte().join(' | '));
    }
    { // Preis verraet die echte Art, die Bezeichnung nie (LAD-01 T7): Auftragsware ist nicht verkaufbar, der Preis steht nur im Katalog
      const x = bereit(134); einlagern(x.g, [TARN]);
      ok(!ECHT.test(JSON.stringify(x.g.snapshot().fracht)), 'eine getarnte Ladung im Lager: der Snapshot nennt die echte Art nicht');
    }
    { // Typ-Regel: gewoehnliche Fremdware im einzigen Modul raeumt der Quartiermeister, fremde Auftragsware nie (nie eine Scheinfracht)
      schmuggel('du_n3', { lade: { ladung: 'deuterium', illegal: true } });
      const x = bereit(135); raeume(x.g, [1]); einlagern(x.g, [LEGAL]);   // das einzige Modul haelt Erz
      x.f = oeffne(x.g, 'du_n3'); starteBeat(x);
      ok(lager(x.g) === 1 && x.g.fracht.lager[0].art === 'deuterium' && x.g.fracht.lager[0].eig.illegal === true && !!x.f.fracht, 'gewoehnliches Erz im einzigen Modul: der Quartiermeister raeumt, die Schmuggel-Ware kommt an Bord');
      const y = bereit(136); raeume(y.g, [1]); einlagern(y.g, [{ art: 'erz', eig: { auftrag: 'f999' } }]);
      y.f = oeffne(y.g, 'du_n3'); starteBeat(y);
      ok(lager(y.g) === 1 && y.g.fracht.lager[0].art === 'erz' && !y.f.fracht && y.f.phase === 'wartet' && D.vorlage(y.f.vorlage).beats[y.f.beat].id === 'b_ende', 'fremde Auftragsware im einzigen Modul: keine Scheinfracht, der Lade-Beat scheitert (Faden zum Ende)');
    }
  });

  await section('(o) BEA-01 Nacharbeit: Beat-Frist vor dem Verfall der Bitte, Notsprung im Schmiergeld, negative Marken, Volk der Gegner', async () => {
    { // die Durchsuchung wird erst nach einer unruhigen Phase angeboten: die Frist des Beats (6) greift vor dem Verfall der Bitte (Angebot + Frist): das Schweigen gilt trotzdem als Dulden
      zoll('du_o1');
      const x = bereit(151); x.f = oeffne(x.g, 'du_o1'); const { g, f } = x;
      einlagern(g, [OFFEN]); x.vorher = marken(g);
      grenzen(g, 5);
      g.simSzene = { probe: 1 };   // unruhig: kein Angebot
      weiter(g, f);
      ok(f.phase === 'laeuft' && !angebot(g), 'der Beat laeuft, die Bitte wird wegen der unruhigen Lage nicht angeboten');
      grenzen(g, 2); delete g.simSzene; grenzen(g, 1);
      const BEAT_FRIST = lies('content', 'faeden', 'werte.json').werte.beat_frist.wert;
      ok(!!angebot(g) && f.laufend.n < BEAT_FRIST && angebot(g).bis - g.weltsim.faeden.t > BEAT_FRIST - f.laufend.n, 'danach steht die Bitte offen, ihr Verfall liegt NACH der Frist des Beats (n ' + f.laufend.n + ', Frist ' + BEAT_FRIST + ', Verfall in ' + (angebot(g) && angebot(g).bis - g.weltsim.faeden.t) + ')');
      for (let i = 0; i < 8 && f.phase === 'laeuft'; i++) grenzen(g, 1);
      ok(f.phase !== 'laeuft' && ereignisse(f).slice(-1)[0] === 'forderung_gescheitert', 'die Frist beendet den Beat als gescheitert');
      ok(arten(g) === '' && gesehen(x, 'frachtBeschlagnahmt').length === 1 && marken(g) === x.vorher - BUSSE('gering'), 'die Durchsuchung fand trotzdem statt: Sprengstoff weg, Bussgeld gebucht (' + arten(g) + ', Marken ' + marken(g) + ')');
      ok(!angebot(g), 'keine Bitte bleibt offen');
    }
    { // Notsprung waehrend des Schmiergelds (Ware am Faden, Beat bleibt): der NSC erinnert sich an die verlorene Ladung wie in der Wartezeit
      const lade = { ladung: 'waffen', tarnung: 'fracht', illegal: true };
      schmuggel('du_o2', { lade });
      const x = bereit(152); x.f = oeffne(x.g, 'du_o2'); const { g, f } = x;
      starteBeat(x);   // b_lade
      starteBeat(x);   // b_forderung
      antwort(g, 'nicht_dulden');
      starteBeat(x);   // b_schmier
      ok(D.vorlage(f.vorlage).beats[f.beat].id === 'b_schmier' && f.phase === 'laeuft' && !!f.fracht, 'das Schmiergeld laeuft mit Ware am Faden');
      Fracht.notsprung(g);
      ok(!f.fracht && lager(g) === 0 && ereignisse(f).includes('fracht_gescheitert'), 'Notsprung: die Ware ist weg und das Gedaechtnis kennt fracht_gescheitert (' + ereignisse(f).join() + ')');
    }
    { // Bussgeld bei negativem Stand schreibt nie gut
      zoll('du_o3');
      const x = amZoll('du_o3', 153, [OFFEN]); const { g } = x;
      g.inventory.marks = -20;
      antwort(g, 'dulden');
      ok(marken(g) === -20, 'Stand -20: das Bussgeld nimmt nichts und schreibt nichts gut (Stand ' + marken(g) + ')');
      g.inventory.marks = -7; ok(Geld.abziehenHoechstens(g, 10, 'notfall') === 0 && marken(g) === -7, 'abziehenHoechstens: bei negativem Stand 0 abgezogen, kein Gewinn');
      g.inventory.marks = 5; ok(Geld.abziehenHoechstens(g, 10, 'notfall') === 5 && marken(g) === 0, 'abziehenHoechstens: ab 0 unveraendert (Untergrenze 0)');
    }
    { // das Volk der Gegner: Parameter volk des Beats raumschlacht (Zoll roemisch), ohne Parameter wie bisher germanisch
      for (const [id, volk, wort] of [['du_o4', 'rom', 'römische'], ['du_o5', undefined, 'germanische']]) {
        const r = registriere(alsVorlage(id, (v) => {
          v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
          v.beats = [
            { id: 'b_kampf', typ: 'raumschlacht', parameter: volk ? { volk } : {}, aus: { gelungen: WEG('aktiv', 'b_ende'), gescheitert: WEG('geflohen', 'b_ende') } },
            { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['raumschlacht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
          ];
        }));
        if (!r.ok) throw new Error('Vorlage ' + id + ': ' + r.fehler.join('; '));
        const x = bereit(154); x.f = oeffne(x.g, id); starteBeat(x);
        ok(x.texte().some((t) => t.includes(wort + ' Schiffe')), 'Vorwarnung nennt ' + wort + ' Schiffe: ' + x.texte().join(' | '));
        for (let i = 0; i < 40 * 60 && !x.g.space.enemies.length; i++) x.g.step();
        const es = x.g.space.enemies;
        ok(es.length > 0 && es.every((e) => e.volk === (volk || 'ger')), 'die Gegner sind ' + (volk || 'ger') + ': ' + es.map((e) => e.volk).join());
      }
    }
  });

  console.log('\n' + (n - fails) + '/' + n + ' Pruefungen ok' + (fails ? ' – ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})();
