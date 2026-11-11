'use strict';
// BEA-01 C0: die Faden-Ware lebt ueber mehrere Beats (Ende-Modi des Beats fracht, Daten content/faeden/beats.json ende_modi).
//   Beat fracht mit parameter.ende = "geladen" laedt die Ware und endet gelungen; die Ware bleibt am Faden (faden.fracht, Ziel faden.fracht.nach) und im Frachtraum, bis ein spaeterer Beat fracht
//   (ende "abgeliefert" oder ohne Parameter = heutiges Verhalten) beim Andocken im Zielhafen abliefert. Verliert der Faden sie vorher (Beat scheitert, Frist, Notsprung, Ladung weg), gilt „verloren“ wie bisher.
// Geprueft: (a) laden -> Zwischen-Beat -> abliefern · (b) Faden verliert die Ware (Frist, Wahl, Notsprung im Beat und in der Wartezeit, Ladung weg, Abliefer-Beat) · (c) Speichern/Laden zwischen den Beats, im
// Zwischen-Beat und in einer Szene · (d) Wartezeit: keine Frist, kein Aufraeumen · (e) Pruefer: sim_befehl nach bloßem Laden wird abgelehnt (SIM_BEFEHL_OHNE_TAT), nach Ablieferung nicht; Parameter-Pruefung;
// der Expander setzt ende nicht · (f) Standardverhalten ohne Parameter unveraendert (Ereignisse, Funk, Weltstand-Block) · (g) Invasion nach Laden + Abliefern mit aktiver Standard-KI ueber mehrere Seeds.
// Erwartete Werte: eigene Zaehlung im Test, nicht aus dem Produktivcode abgeleitet.      node tools/test-faden-ware-ueber-beats.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Faden = require('../server/sim/faden.js');
const Fracht = require('../server/sim/faden-fracht.js');
const Lager = require('../server/sim/fracht.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const BP = require('../server/sim/faden-bauplan.js');
const P3 = require('../server/sim/faden-p3.js');
const Bitte = require('../server/sim/faden-bitte.js');
const V = require('./test-faden-vorlagen.js');
const X = require('./faden-fixture.js');
const { D, spiel, oeffne, grenzen, alsVorlage, registriere } = X;

const TXT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'szenen-werte.json'), 'utf8')).texte.fracht;
const FH = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'faeden', 'falscher_haendler-fad01.json'), 'utf8'));   // BEA-01 C1: Grundlage der Varianten ist die Vorlage wie in FAD-01 (sechs Beats, Fixture aus acf7795c); die echte Vorlage hat jetzt zehn Beats und prueft test-faden-beispiel1.js
const BEAT_FRIST = 6;   // content/faeden/werte.json beat_frist (eigene Zahl: der Test setzt sie fest; stimmt sie nicht mehr, scheitert der Frist-Test sichtbar)
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
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => v[k]);
const WARE = 'Frachtkiste';   // wird unten aus den Daten gelesen, nicht aus dem Code
const ZIEL = '0305';

// Vorlage: laden (geladen) -> Zwischen-Beat -> abliefern -> Abschluss. mitte: Typ des Zwischen-Beats (bitte oder spontanhilfe = Szene)
function vorlage(id, o) {
  o = o || {};
  const mitte = o.mitte || 'bitte';
  const r = registriere(alsVorlage(id, (v) => {
    v.nsc.status = 'aktiv';
    v.volk_erlaubt = ['rom', 'kon', 'ger'];
    delete v.wahrheit; delete v.hinweise;
    const m = { id: 'b_mitte', typ: mitte, aus: { gelungen: { status: 'verbuendet', weiter: 'b_abgabe' }, gescheitert: { status: 'aktiv', weiter: 'b_ende' } } };
    if (mitte === 'bitte') m.optionen = [
      { id: 'annehmen', text: 'Wir bleiben dran.', ausgang: 'gelungen', folge: [{ typ: 'haltung_aenderung', grund: 'geholfen' }] },
      { id: 'ablehnen', text: 'Ohne uns.', ausgang: 'gescheitert', folge: [{ typ: 'haltung_aenderung', grund: 'bitte_abgelehnt' }] },
    ];
    v.beats = [
      { id: 'b_lade', typ: 'fracht', parameter: { nach: ZIEL, ende: 'geladen' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_mitte' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },
      m,
      { id: 'b_abgabe', typ: 'fracht', parameter: o.abgabeOhneEnde ? { nach: ZIEL } : { nach: ZIEL, ende: 'abgeliefert' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['fracht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  if (!r.ok) throw new Error('Vorlage ' + id + ' ungueltig: ' + r.fehler.join('; '));
}
// Spiel in der Freien Fahrt, in einer Szene bei ZIEL, Funk mitgeschrieben, Spielleiter-Attrappe (die Frist laeuft nur mit aktivem Spielleiter)
function bereit(seed) {
  const x = spiel({ crew: 1, seed }); const g = x.g;
  const radio = []; const orig = g.emit.bind(g);
  g.emit = (k, d) => { if (k === 'radio' && d && d.text) radio.push(d.text); return orig(k, d); };
  g.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
  ab(g); ankunft(g, ZIEL);
  return { g, radio };
}
// Faden oeffnen und den Lade-Beat starten: danach wartet der Faden vor b_mitte, die Ware haengt am Faden
function geladen(id, seed) {
  const x = bereit(seed);
  x.lager0 = lager(x.g);
  x.f = oeffne(x.g, id); grenzen(x.g, 5);
  x.r = weiter(x.g, x.f);
  return x;
}
const frachtFunk = (radio) => radio.filter((t) => /^(Ware an Bord|Die Ware ist verloren|.* abgeliefert.$)/.test(t));   // nur die Fracht-Funksprueche (das Brett meldet daneben eigene Angebote)
const ZWISCHEN = (x) => { grenzen(x.g, 5); return weiter(x.g, x.f); };   // b_mitte starten

(async () => {
  const WARE_NAME = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'szenen-werte.json'), 'utf8')).werte.waren.wert.fracht_kiste.name;
  bereit(1);   // laedt die Sektorendaten wie im Spiel (der Hafenname haengt davon ab)
  const hafen = Sektoren.hexName(ZIEL) || ZIEL;
  const T_LADEN = fmt(TXT.laden, { ware: WARE_NAME, hafen }), T_ABGELIEFERT = fmt(TXT.abgeliefert, { ware: WARE_NAME, hafen }), T_VERLOREN = fmt(TXT.verloren, { ware: WARE_NAME, hafen });

  await section('Daten: Ende-Modi im Katalog, Beat-Parameter', async () => {
    const c = D.BEATS.fracht;
    ok(c.ende_modi && c.ende_modi.parameter === 'ende' && c.ende_modi.standard === 'abgeliefert', 'beats.json: ende_modi am Beat fracht, Standard abgeliefert');
    ok(c.parameter.optional.includes('ende'), 'ende ist ein optionaler Parameter des Beats fracht');
    ok(D.endeModus({ typ: 'fracht', parameter: { nach: ZIEL } }).liefert === true && D.endeModus({ typ: 'fracht', parameter: { nach: ZIEL } }).tat === true, 'ohne Parameter: Modus abgeliefert (liefert, Tat)');
    const m = D.endeModus({ typ: 'fracht', parameter: { nach: ZIEL, ende: 'geladen' } });
    ok(m.haelt === true && m.liefert === false && m.tat === false && m.ereignis === 'fracht_geladen', 'ende geladen: haelt die Ware, liefert nicht, keine Tat, Ereignis fracht_geladen');
    ok(D.endeModus({ typ: 'bitte' }) === null && D.endeModus(null) === null && D.endeModus({ typ: 'fracht', parameter: { ende: 'x' } }) === null, 'Beats ohne Ende-Modus und unbekannte Werte: null');
    ok(Pruefer.katalogFehler().length === 0, 'katalogFehler leer');
  });

  await section('(a) laden -> Zwischen-Beat -> abliefern: die Ware bleibt, die Ablieferung wirkt', async () => {
    vorlage('wb_a');
    const x = geladen('wb_a', 22); const { g, radio, f } = x;
    ok(x.r.ok && f.phase === 'wartet' && f.beat === 1 && !!f.fracht && f.fracht.nach === ZIEL && f.fracht.ware === 'fracht_kiste', 'Lade-Beat endet gelungen, der Faden wartet vor b_mitte, die Ware haengt am Faden (Ziel ' + ZIEL + ')');
    ok(lager(g) === x.lager0 + 1 && g.fracht.lager[g.fracht.lager.length - 1].art === 'fracht', 'die Ware liegt im Frachtraum (ein Platz)');
    ok(radio.includes(T_LADEN), 'Funk: Ware an Bord');
    ok(f.nsc.status === 'verbuendet' && ereignisse(f).join() === 'fracht_geladen', 'Gedaechtnis: fracht_geladen (NICHT fracht_gelungen: Laden allein ist keine Lieferung), NSC verbuendet');
    // Wartezeit: Andocken am Ziel liefert nicht ab, Ticks raeumen die Ladung nicht weg
    andocken(g, ZIEL); laufe(g, 3);
    ok(f.phase === 'wartet' && !!f.fracht && lager(g) === x.lager0 + 1 && !radio.includes(T_ABGELIEFERT), 'Andocken am Ziel waehrend der Wartezeit: keine Ablieferung, Ware bleibt (auch nach Ticks)');
    ok(ZWISCHEN(x).ok && f.phase === 'laeuft' && f.beat === 1 && !!f.fracht, 'Zwischen-Beat laeuft, die Ware bleibt am Faden');
    andocken(g, ZIEL);
    ok(f.phase === 'laeuft' && f.beat === 1 && !!f.fracht && lager(g) === x.lager0 + 1 && !radio.includes(T_ABGELIEFERT), 'Andocken am Ziel im Zwischen-Beat: nicht abgeliefert (kein Abliefer-Beat), der Beat laeuft weiter');
    ok(Faden.optionWaehlen(g, f.id, 'annehmen').ok && f.phase === 'wartet' && f.beat === 2 && !!f.fracht && f.fracht.nach === ZIEL && lager(g) === x.lager0 + 1, 'Zwischen-Beat gelungen: Ware, Ziel (f.fracht.nach) und Ladung bleiben');
    grenzen(g, 5);
    ok(weiter(g, f).ok && f.phase === 'laeuft' && f.beat === 2 && !!f.fracht && lager(g) === x.lager0 + 1, 'Abliefer-Beat laeuft: die Ware wird NICHT noch einmal geladen (ein Eintrag im Frachtraum)');
    ok(radio.filter((t) => t === T_LADEN).length === 1, 'Funk „Ware an Bord“ kam genau einmal');
    andocken(g, ZIEL);
    ok(f.phase === 'wartet' && f.beat === 3 && !f.fracht && lager(g) === x.lager0 && radio.includes(T_ABGELIEFERT) && f.nsc.status === 'verbuendet', 'Andocken am Ziel im Abliefer-Beat: abgeliefert, Ware weg, Frachtraum leer');
    ok(ereignisse(f).join() === 'fracht_geladen,bitte_gelungen,fracht_gelungen', 'Gedaechtnis: fracht_geladen, bitte_gelungen, fracht_gelungen (Fall „fracht gelungen“ erst bei der Ablieferung): ' + ereignisse(f).join());
    ok(!radio.includes(T_VERLOREN), 'kein „verloren“');
    grenzen(g, 5); weiter(g, f);
    ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'der Abschluss zaehlt fracht_gelungen: Faden gelungen (' + (f.ausgang && f.ausgang.art) + ')');
    ok(!f.fracht && lager(g) === x.lager0, 'am Ende keine Ware mehr');
  });

  await section('(b) der Faden verliert die Ware: gescheitert, „verloren“, Frachtraum leer', async () => {
    vorlage('wb_b');
    const ende = (x, titel, ereignis) => {
      const { g, f, radio } = x;
      ok(f.phase === 'wartet' && f.beat === 3 && !f.fracht && lager(g) === x.lager0 && radio.includes(T_VERLOREN), titel + ': Ware weg, Frachtraum leer, Funk „verloren“, der Faden steht vor dem Abschluss');
      if (ereignis) ok(ereignisse(f).slice(-1)[0] === ereignis, titel + ': Gedaechtnis ' + ereignis);
      grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', titel + ': Faden gescheitert (' + (f.phase) + ', ' + (f.ausgang && f.ausgang.art) + ')');
    };
    { const x = geladen('wb_b', 31); ZWISCHEN(x); grenzen(x.g, BEAT_FRIST + 1); ende(x, 'Frist im Zwischen-Beat', 'bitte_gescheitert'); }
    { const x = geladen('wb_b', 32); ZWISCHEN(x); Faden.optionWaehlen(x.g, x.f.id, 'ablehnen'); ende(x, 'Wahl „ablehnen“ (Zwischen-Beat gescheitert)', 'bitte_gescheitert'); }
    { const x = geladen('wb_b', 33); ZWISCHEN(x); ok(!!x.f.fracht, 'Ware im Zwischen-Beat'); Fracht.notsprung(x.g); ende(x, 'Notsprung im Zwischen-Beat', 'bitte_gescheitert'); }
    { // Notsprung in der Wartezeit (kein Beat laeuft): die Ware ist weg, der naechste Beat (Abliefern) laedt NICHT neu
      const x = geladen('wb_b', 34); const { g, f, radio } = x;
      ok(Fracht.notsprung(g).join() === f.id, 'Notsprung in der Wartezeit trifft den Faden mit Ware');
      ok(f.phase === 'wartet' && f.beat === 1 && !f.fracht && lager(g) === x.lager0 && radio.includes(T_VERLOREN), 'Notsprung in der Wartezeit: Ware weg, Frachtraum leer, Funk „verloren“, der Faden wartet weiter');
      ok(ZWISCHEN(x).ok && Faden.optionWaehlen(g, f.id, 'annehmen').ok && f.beat === 2, 'der Faden laeuft ohne Ware bis zum Abliefer-Beat');
      grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'wartet' && f.beat === 3 && !f.fracht && lager(g) === x.lager0, 'Abliefer-Beat ohne Ware: gescheitert, die Ware wird NICHT neu geladen (kein Frachtraum-Eintrag)');
      ok(ereignisse(f).slice(-1)[0] === 'fracht_gescheitert', 'Gedaechtnis: fracht_gescheitert, nicht fracht_ohne_ware (die Ware gab es): ' + ereignisse(f).join());
      grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', 'Faden gescheitert');
    }
    { // Ladung unterwegs verloren (abgegeben/Huellentreffer): der Abliefer-Beat scheitert beim Start
      const x = geladen('wb_b', 35); const { g, f, radio } = x;
      Lager.auftragEntnehmen(g, f.id);
      ok(lager(g) === x.lager0 && !!f.fracht, 'Ladung aus dem Frachtraum genommen, der Faden fuehrt die Ware noch');
      ZWISCHEN(x); Faden.optionWaehlen(g, f.id, 'annehmen'); grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'wartet' && f.beat === 3 && !f.fracht && radio.includes(T_VERLOREN), 'Abliefer-Beat: die Ladung fehlt, gescheitert, Funk „verloren“');
    }
    { // Frist im Abliefer-Beat selbst: wie bisher
      const x = geladen('wb_b', 36); const { g, f } = x;
      ZWISCHEN(x); Faden.optionWaehlen(g, f.id, 'annehmen'); grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'laeuft' && !!f.fracht, 'Abliefer-Beat laeuft');
      grenzen(g, BEAT_FRIST + 1);
      ok(f.phase === 'wartet' && f.beat === 3 && !f.fracht && lager(g) === x.lager0 && x.radio.includes(T_VERLOREN) && ereignisse(f).slice(-1)[0] === 'fracht_gescheitert', 'Frist im Abliefer-Beat: Ware weg, verloren, fracht_gescheitert (wie bisher)');
    }
    { // Lade-Beat selbst ohne Platz/Ziel: gescheitert wie bisher, nichts am Faden
      const x = bereit(37); x.lager0 = lager(x.g);
      const r = registriere(alsVorlage('wb_b_ziel', (v) => { v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise; v.beats = [
        { id: 'b_lade', typ: 'fracht', parameter: { nach: '0406', ende: 'geladen' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_abgabe' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },
        { id: 'b_abgabe', typ: 'fracht', parameter: { nach: '0406', ende: 'abgeliefert' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },   // BEA-01 C1: nach einem Lade-Beat muss jeder Weg abliefern (LADUNG_NICHT_ABGELIEFERT); der Test prueft nur den Lade-Beat
        { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['fracht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } }]; }));
      ok(r.ok, 'Vorlage mit nicht andockbarem Ziel (0406)');
      const f = oeffne(x.g, 'wb_b_ziel'); grenzen(x.g, 5); weiter(x.g, f);
      ok(f.phase === 'wartet' && !f.fracht && lager(x.g) === x.lager0 && ereignisse(f).slice(-1)[0] === 'fracht_ohne_ware', 'Lade-Beat, Ziel nicht andockbar: gescheitert, keine Ware, fracht_ohne_ware (wie bisher)');
    }
  });

  await section('(c) Speichern und Laden zwischen den Beats', async () => {
    vorlage('wb_c');
    const x = geladen('wb_c', 41); const { g, f } = x;
    // 1. Wartezeit: Faden-Block
    const F2 = Faden.lesen(Faden.toSave(g.weltsim));
    const f2 = F2.liste.find((y) => y.id === f.id);
    ok(f2 && f2.phase === 'wartet' && f2.beat === 1 && !!f2.fracht && f2.fracht.ware === 'fracht_kiste' && f2.fracht.nach === ZIEL && f2.fracht.von === f.fracht.von && F2.ladeFehler.length === 0, 'Wartezeit: Ware und Lieferziel bleiben im Faden-Block (Speichern/Laden)');
    // 2. ganzer Weltstand: Schema, Frachtraum, Faden
    const data = Weltstand.capture(g);
    ok(Weltstand.validate(data, g).length === 0, 'Weltstand mit Ware in der Wartezeit besteht das Schema: ' + Weltstand.validate(data, g).slice(0, 2).join('; '));
    ok(data.version === 3, 'Weltstand-Version bleibt 3');
    const y = bereit(42); const g2 = y.g;
    Weltstand.apply(g2, JSON.parse(JSON.stringify(data)));
    const h = g2.weltsim.faeden.liste.find((z) => z.id === f.id);
    ok(!!h && h.phase === 'wartet' && !!h.fracht && h.fracht.nach === ZIEL && Lager.auftragAnBord(g2, h.id), 'nach dem Laden des ganzen Weltstands: Ware am Faden UND Ladung im Frachtraum');
    laufe(g2, 3);
    ok(!!h.fracht && Lager.auftragAnBord(g2, h.id), 'nach Ticks: die Ladung wird nicht als erloschen aufgeraeumt');
    g2.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
    grenzen(g2, 5); weiter(g2, h); Faden.optionWaehlen(g2, h.id, 'annehmen'); grenzen(g2, 5); weiter(g2, h);
    ankunft(g2, ZIEL); g2.missionEvent('docked', {});
    ok(h.phase === 'wartet' && h.beat === 3 && !h.fracht && !Lager.auftragAnBord(g2, h.id) && ereignisse(h).slice(-1)[0] === 'fracht_gelungen', 'im geladenen Stand geht es weiter: Zwischen-Beat, Abliefern, fracht_gelungen');
    // 3. im laufenden Zwischen-Beat (bitte ist keine Szene: laeuft nach dem Laden weiter)
    const z = geladen('wb_c', 43); ZWISCHEN(z);
    const F3 = Faden.lesen(Faden.toSave(z.g.weltsim)); const f3 = F3.liste[0];
    ok(f3.phase === 'laeuft' && f3.beat === 1 && !!f3.fracht && f3.fracht.nach === ZIEL, 'Zwischen-Beat laeuft beim Speichern: nach dem Laden laeuft er, die Ware bleibt');
    // 4. Szenen-Beat als Zwischen-Beat: nach dem Laden steht er wieder aus, die Ware darf NICHT verloren gehen
    vorlage('wb_c_szene', { mitte: 'spontanhilfe' });
    const s = geladen('wb_c_szene', 44); const r = ZWISCHEN(s);
    ok(r.ok && s.f.phase === 'laeuft' && !!s.f.fracht, 'Szenen-Beat (spontanhilfe) laeuft mit Ware am Faden');
    const F4 = Faden.lesen(Faden.toSave(s.g.weltsim)); const f4 = F4.liste[0];
    ok(f4.phase === 'wartet' && f4.beat === 1 && f4.laufend === null && !!f4.fracht && f4.fracht.nach === ZIEL, 'Szene beim Speichern: der Beat steht nach dem Laden wieder aus, die Ware bleibt (vorher: delete f.fracht)');
    const d4 = Weltstand.capture(s.g);
    ok(Weltstand.validate(d4, s.g).length === 0, 'Weltstand mitten im Szenen-Beat mit Ware ist schemagueltig');
    // 5. Muell: unbrauchbares Feld faellt weg, Ware ohne Lade-Beat davor ebenfalls
    const lies = (aendern) => { const b = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim))); aendern(b.liste[0]); return Faden.lesen(b); };
    for (const [name, aendern] of [['Text', (q) => { q.fracht = 'kaputt'; }], ['Ziel kaputt', (q) => { q.fracht.nach = 'xx'; }], ['umbenannte Ware', (q) => { q.fracht.ware = 'alte_ware'; }], ['Zahl', (q) => { q.fracht = 5; }]]) {
      const Fm = lies(aendern); ok(Fm.liste.length === 1 && Fm.liste[0].fracht === undefined && Fm.liste[0].phase === 'wartet', 'Muell (' + name + '): nur das Feld faellt weg, der Faden bleibt');
    }
    const Fv = lies((q) => { q.beat = 0; });
    ok(Fv.liste.length === 1 && Fv.liste[0].fracht === undefined, 'Ware ohne Lade-Beat davor (wartet vor dem Lade-Beat): faellt weg');
    const Fa = lies((q) => { q.beat = 3; q.phase = 'abgeschlossen'; q.ausgang = { art: 'gelungen', status: 'verbuendet', tick: 1 }; q.laufend = null; });
    ok(Fa.liste.length === 1 && Fa.liste[0].fracht === undefined, 'abgeschlossener Faden traegt keine Ware');
  });

  await section('(d) Wartezeit zwischen den Beats: keine Frist', async () => {
    vorlage('wb_d');
    const x = geladen('wb_d', 51); const { g, f } = x;
    grenzen(g, 40); laufe(g, 2);
    ok(f.phase === 'wartet' && f.beat === 1 && !!f.fracht && lager(g) === x.lager0 + 1, '40 Taetigkeiten in der Wartezeit: die Ware bleibt (die Frist gilt nur fuer einen laufenden Beat)');
  });

  await section('(e) Pruefer: sim_befehl nur nach einer ABLIEFERUNG, nicht nach bloßem Laden', async () => {
    const reg = (id, aendern) => { const v = klon(FH); v.id = id; aendern(v); return Pruefer.pruefeVorlage(v); };
    const bf = (v, id) => v.beats.find((b) => b.id === id);
    const codes = (r) => r.fehler.map((s) => String(s).split(':')[0]);
    const OHNE_TAT = (r) => codes(r).some((c) => /SIM_BEFEHL_OHNE_TAT/.test(c));
    ok(Pruefer.pruefeVorlage(klon(FH)).ok, 'falscher_haendler (unveraendert) besteht den Pruefer');
    ok(reg('fh1', (v) => { bf(v, 'b_fracht').parameter.ende = 'abgeliefert'; }).ok, 'b_fracht mit ende abgeliefert (explizit): ok, wie ohne Parameter');
    const g1 = reg('fh2', (v) => { bf(v, 'b_fracht').parameter.ende = 'geladen'; });
    ok(!g1.ok && OHNE_TAT(g1), 'Gegenprobe: nur geladen (ende geladen) und dann enthuellt: abgelehnt SIM_BEFEHL_OHNE_TAT (' + codes(g1).join(',') + ')');
    const abgabe = (extra) => (v) => {
      const i = v.beats.findIndex((b) => b.id === 'b_fracht');
      v.beats[i].parameter.ende = 'geladen';
      v.beats[i].aus.gelungen.weiter = 'b_abgabe';
      v.beats.splice(i + 1, 0, { id: 'b_abgabe', typ: 'fracht', parameter: { nach: '$ort', ende: 'abgeliefert' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_enthuell' }, gescheitert: { status: 'aktiv', weiter: 'b_abschluss' } } });
      if (extra) extra(v);
    };
    const g2 = reg('fh3', abgabe());
    ok(g2.ok, 'geladen, dann abgeliefert, dann enthuellt: ok (' + g2.fehler.join('; ') + ')');
    const g3 = reg('fh4', abgabe((v) => { bf(v, 'b_abgabe').aus.gescheitert.weiter = 'b_enthuell'; bf(v, 'b_abgabe').aus.gescheitert.status = 'verbuendet'; bf(v, 'b_abgabe').aus.gelungen.status = 'aktiv'; }));
    ok(!g3.ok && OHNE_TAT(g3), 'Gegenprobe: scheitert das Abliefern, fuehrt aber doch zur Enthuellung: abgelehnt SIM_BEFEHL_OHNE_TAT');
    const g4 = reg('fh5', abgabe((v) => { bf(v, 'b_abgabe').parameter.ende = 'geladen'; }));
    ok(!g4.ok && OHNE_TAT(g4), 'Gegenprobe: der zweite Fracht-Beat ladet nur (ende geladen): abgelehnt SIM_BEFEHL_OHNE_TAT');
    const g5 = reg('fh6', (v) => { bf(v, 'b_fracht').parameter.ende = 'unbekannt'; });
    ok(!g5.ok && codes(g5).includes('PARAMETER'), 'ein unbekannter Wert fuer ende wird abgelehnt (PARAMETER)');
    const g6 = reg('fh7', (v) => { bf(v, 'b_bitte').parameter.ende = 'geladen'; });
    ok(!g6.ok && codes(g6).includes('PARAMETER'), 'ende an einem Beat ohne Ende-Modus (bitte): abgelehnt (PARAMETER)');
    // der Expander: dieselbe Regel (er ruft denselben Pruefer); ende darf der Plan in C0 nicht setzen
    const b = (typ, o) => Object.assign({ typ }, o || {});
    const plan = (beats) => ({ format: 'faden-bauplan/1', titel: 'Probe Abenteuer', beats });
    const e1 = BP.pruefe(plan([b('bitte', { verzweigung: { gescheitert: 'e' } }), b('fracht', { parameter: { ende: 'geladen' } }), b('enthuellung', { id: 'e' }), b('abschluss')]));
    ok(!e1.ok && e1.codes.includes('PARAMETER'), 'Expander: der Plan darf ende (noch) nicht setzen (PARAMETER)');
    const e2 = BP.pruefe(plan([b('bitte', { verzweigung: { gescheitert: 'e' } }), b('fracht'), b('enthuellung', { id: 'e' }), b('abschluss')]));
    ok(e2.ok && !e2.vorlage.beats.some((q) => q.parameter && 'ende' in q.parameter), 'Expander: ein Plan ohne ende expandiert unveraendert (kein ende-Parameter im Beat, byte-gleich)');
    // Pruefer-Regel auf der expandierten Vorlage: laeuft durch denselben Pfad (SIM_BEFEHL_OHNE_TAT haengt an istTat)
    const e3 = BP.pruefe(plan([b('fracht', { verzweigung: { gescheitert: 'ende' } }), b('enthuellung'), b('abschluss', { id: 'ende' })]));
    ok(e3.ok, 'Expander: fracht (gescheitert zum Abschluss), enthuellung, abschluss expandiert (' + (e3.fehler || []).join('; ') + ')');
    const sim = klon(e3.vorlage); sim.beats.find((q) => q.typ === 'enthuellung').aus.gelungen.folge = [{ typ: 'sim_befehl' }]; sim.id = 'expand_abgeliefert';
    ok(Pruefer.pruefeVorlage(klon(sim)).ok, 'die expandierte Vorlage mit sim_befehl nach einer Ablieferung (Standard) besteht den Pruefer');
    sim.beats.find((q) => q.typ === 'fracht').parameter.ende = 'geladen'; sim.id = 'expand_geladen';
    const r3 = Pruefer.pruefeVorlage(sim);
    ok(!r3.ok && OHNE_TAT(r3), 'dieselbe expandierte Vorlage mit ende geladen: SIM_BEFEHL_OHNE_TAT');
  });

  await section('(f) Standardverhalten ohne Parameter: unveraendert (Ereignisfolge, Funk, Weltstand-Block)', async () => {
    vorlage('wb_f', { abgabeOhneEnde: true });
    // ein Fracht-Beat ohne ende, laedt und liefert in EINEM Beat (wie vor BEA-01)
    const r = registriere(alsVorlage('wb_f0', (v) => { v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise; v.beats = [
      { id: 'b_fracht', typ: 'fracht', parameter: { nach: ZIEL }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['fracht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } }]; }));
    ok(r.ok, 'Vorlage ohne ende');
    { // laden + liefern
      const x = bereit(61); const { g, radio } = x; const l0 = lager(g);
      const f = oeffne(g, 'wb_f0'); grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'laeuft' && !!f.fracht && f.fracht.nach === ZIEL && lager(g) === l0 + 1 && frachtFunk(radio).join('|') === T_LADEN, 'ohne ende: der Beat laedt und LAEUFT (wartet auf die Ablieferung)');
      const save = JSON.stringify(Faden.toSave(g.weltsim));
      ok(JSON.stringify(Faden.toSave(Faden.lesen(JSON.parse(save)) && { faeden: Faden.lesen(JSON.parse(save)) })) === save, 'Speichern/Laden: gleicher Block');
      andocken(g, ZIEL);
      ok(f.phase === 'wartet' && !f.fracht && lager(g) === l0 && ereignisse(f).join() === 'fracht_gelungen' && frachtFunk(radio).join('|') === [T_LADEN, T_ABGELIEFERT].join('|'), 'abgeliefert: fracht_gelungen, Funk laden + abgeliefert, Frachtraum leer');
    }
    { // Frist: wie bisher
      const x = bereit(62); const { g, radio } = x; const l0 = lager(g);
      const f = oeffne(g, 'wb_f0'); grenzen(g, 5); weiter(g, f); grenzen(g, BEAT_FRIST + 1);
      ok(f.phase === 'wartet' && !f.fracht && lager(g) === l0 && ereignisse(f).join() === 'fracht_gescheitert' && frachtFunk(radio).join('|') === [T_LADEN, T_VERLOREN].join('|'), 'Frist: fracht_gescheitert, Funk laden + verloren, Ware weg');
      ok(f.beat === 1 && f.nsc.status === 'geflohen', 'Frist: weiter zum Abschluss, NSC geflohen');
    }
    { // Notsprung
      const x = bereit(63); const { g, radio } = x; const l0 = lager(g);
      const f = oeffne(g, 'wb_f0'); grenzen(g, 5); weiter(g, f); Fracht.notsprung(g);
      ok(f.phase === 'wartet' && !f.fracht && lager(g) === l0 && ereignisse(f).join() === 'fracht_gescheitert' && frachtFunk(radio).join('|') === [T_LADEN, T_VERLOREN].join('|'), 'Notsprung: wie bisher verloren');
    }
    { // Abliefer-Beat ohne ende, ohne Lade-Beat davor, ladet selbst (wb_f hat einen Lade-Beat davor: dort ohne ende NICHT neu laden)
      const x = geladen('wb_f', 64); const { g, f } = x;
      ZWISCHEN(x); Faden.optionWaehlen(g, f.id, 'annehmen'); grenzen(g, 5); weiter(g, f);
      ok(f.phase === 'laeuft' && !!f.fracht && lager(g) === x.lager0 + 1, 'Abliefer-Beat ohne ende NACH einem Lade-Beat: liefert die geladene Ware, ladet nicht neu');
      andocken(g, ZIEL);
      ok(f.beat === 3 && !f.fracht && lager(g) === x.lager0 && ereignisse(f).slice(-1)[0] === 'fracht_gelungen', 'abgeliefert');
    }
    { // Beat ohne Ware: nie eine Ware am Faden, Andocken am Ziel tut nichts
      const x = bereit(65); const { g } = x;
      registriere(alsVorlage('wb_f1', (v) => { v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise; v.beats = [
        { id: 'b_m', typ: 'bitte', aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'aktiv', weiter: 'b_ende' } } },
        { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['bitte_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } }]; }));
      const f = oeffne(g, 'wb_f1'); grenzen(g, 5); weiter(g, f); andocken(g, ZIEL); Faden.beatAusgang(g, f.id, 'gelungen');
      ok(f.fracht === undefined && f.beat === 1, 'Beat ohne Ware: kein f.fracht');
    }
  });

  await section('(g) Invasion nach Laden + Abliefern mit aktiver Standard-KI ueber mehrere Seeds (nie ein halbes Wirken)', async () => {
    // Der Falsche Haendler, Beat b_fracht aufgeteilt: laden (geladen), dann abliefern (abgeliefert), dann die Enthuellung mit sim_befehl
    const v = klon(FH); v.id = 'fh_geteilt';
    const i = v.beats.findIndex((b) => b.id === 'b_fracht');
    v.beats[i].id = 'b_lade'; v.beats[i].parameter.ende = 'geladen'; v.beats[i].aus.gelungen.weiter = 'b_abgabe';
    v.beats.splice(i + 1, 0, { id: 'b_abgabe', typ: 'fracht', parameter: { nach: '$ort', ende: 'abgeliefert' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_enthuell' }, gescheitert: { status: 'aktiv', weiter: 'b_abschluss' } } });
    v.beats.find((b) => b.id === 'b_bitte').aus.gelungen.weiter = 'b_lade';
    const rr = registriere(v);
    ok(rr.ok, 'die geteilte Vorlage besteht den Pruefer (' + rr.fehler.join('; ') + ')');
    const ORT = '0203';
    const hochgestuft = (g) => g.weltsim.zustand.flotten.filter((fl) => fl.hochgestuft === true);
    const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
    let angenommen = 0;
    for (const seed of [501, 502, 503, 504, 505, 506]) {
      const g = V.neu(seed);
      const f = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'fh_geteilt', parameter: { angebot: V.notrufOhneOrt(g, 'notruf_havarie_konvoi', ORT, 'gelungen').nr } }).faden;
      for (let k = 0; k < 8 && !Bitte.offen(g); k++) await V.runde(g);
      Bitte.beantworten(g, 'annehmen', Bitte.offen(g).nr);
      let hielt = true, wartete = false;
      for (let k = 0; k < 20 && !(f.phase === 'laeuft' && f.beat === 2); k++) {
        await V.runde(g);
        if (f.beat === 2 && f.phase === 'wartet') { wartete = true; if (!f.fracht || !Lager.auftragAnBord(g, f.id)) hielt = false; }
      }
      ok(f.beat === 2 && f.phase === 'laeuft' && !!f.fracht && Lager.auftragAnBord(g, f.id) && hielt, `Seed ${seed}: geladen, die Ware hielt ueber die Wartezeit, der Abliefer-Beat laeuft (Beat ${f.beat}, ${f.phase})`);
      ok(!g.weltsim.zustand.angriffe.some((a) => a.befohlen === true) && hochgestuft(g).length === 0, `Seed ${seed}: nach dem bloßen Laden keine Wirkung auf die Sim`);
      // abliefern, dann die Welt fuer eine annehmbare Invasion vorbereiten (die Standard-KI bleibt AN, wie bei V.bereiteInvasion) und die Enthuellung
      ankunft(g, f.fracht.nach); g.missionEvent('docked', {}); ab(g);
      ok(f.beat === 3 && f.phase === 'wartet' && !f.fracht && ereignisse(f).slice(-1)[0] === 'fracht_gelungen', `Seed ${seed}: abgeliefert, der Faden wartet vor der Enthuellung`);
      const z = g.weltsim.zustand, ziel = P3.invasionsZiel(g, ORT);
      if (!ziel) { ok(false, `Seed ${seed}: kein Invasionsziel`); continue; }
      z.flotten = z.flotten.filter((q) => !(q.ort === ziel && q.fraktion === 'rom'));
      z.hexe[ziel].abwehr = 0.1;
      z.angriffe = z.angriffe.filter((a) => a.von !== 'ger');
      for (const fl of z.flotten) if (fl.fraktion === 'ger' && !fl.miete) { fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null; fl.angriff = null; fl.warte = 0; fl.staerke = fl.kap; fl.versorgung = 1; }
      z.regie = Object.assign(z.regie || {}, { ger: { p_act: 0, aggr: 0, regler_bis: z.tick + 50 } });
      for (const q of ['rom', 'ger']) { z.vorrat[q].T = Math.max(z.vorrat[q].T, 40); z.vorrat[q].U = Math.max(z.vorrat[q].U, 40); }
      f.zaehler = f.abstand;
      const w = Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_enthuell' });
      ok(w.ok, `Seed ${seed}: faden_weiter enthuellung angenommen (${w.grund || ''})`);
      for (let k = 0; k < 8; k++) Kriegslage.tick(g, 'test');
      const abgelehnt = logbuch(g).filter((e) => /abgelehnt/.test(String(e.ausgang)) && e.key === 'invasion');
      ok(hochgestuft(g).length === 1 && abgelehnt.length === 0 && g.weltsim.zustand.angriffe.some((a) => a.befohlen === true && a.von === 'ger'), `Seed ${seed}: die Invasion wirkt im Tick (hochgestuft ${hochgestuft(g).length}, abgelehnt ${abgelehnt.length}), nichts halb`);
      if (hochgestuft(g).length === 1) angenommen++;
    }
    ok(angenommen === 6, 'alle sechs Seeds: Invasion angenommen (' + angenommen + ')');
    // Gegenprobe im selben Aufbau: Ware nach dem Laden verloren (Notsprung) -> kein sim_befehl
    for (const seed of [511, 512]) {
      const g = V.neu(seed);
      const f = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'fh_geteilt', parameter: { angebot: V.notrufOhneOrt(g, 'notruf_havarie_konvoi', ORT, 'gelungen').nr } }).faden;
      for (let k = 0; k < 8 && !Bitte.offen(g); k++) await V.runde(g);
      Bitte.beantworten(g, 'annehmen', Bitte.offen(g).nr);
      for (let k = 0; k < 20 && !f.fracht; k++) await V.runde(g);
      ok(!!f.fracht && f.beat === 2, `Seed ${seed}: Ware geladen`);
      Fracht.notsprung(g);
      for (let k = 0; k < 10 && f.phase !== 'abgeschlossen'; k++) { await V.runde(g); if (f.phase === 'wartet') { f.zaehler = f.abstand; Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id }); } }   // der Mock-Spielleiter setzt nicht jede Runde fort: von Hand weiter
      ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && g.weltsim.regie.vorgemerkt.every((e) => e.b.typ !== 'invasion') && hochgestuft(g).length === 0, `Seed ${seed}: Ware nach dem Laden verloren: Abschluss gescheitert, keine Invasion`);
    }
  });

  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
  console.log('Test bestanden');
})();
