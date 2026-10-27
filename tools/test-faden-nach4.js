'use strict';
// SUND-04a-2 Nacharbeit Welle 4 (Review der Faden-Schicht): M1 Speichern waehrend einer feindlichen Variante, S1 eigene Ausgaenge der Variante, S2 Ruf nur fuer Leistung (Annehmen zahlt nichts, der Deckel
// zaehlt nur gebuchten Ruf), S3 Spaeter kostet wie Ablehnen (die feindliche Wiederkehr bleibt erreichbar), S4 Befreiung: Warnung im Vorwarntext und Halt des Schnellsprungs am Ort des NSC.
// Die Erwartungen stehen hier selbst (aus den Daten und den Regeln des Auftrags). Jeder Ausgang eines Beats entsteht durch das, was die Crew im Spiel tut (Antwort, Szene, Andocken, Frist).
//   node tools/test-faden-nach4.js        (npm run test:faden-nach4)
const fs = require('fs');
const path = require('path');
const V = require('./test-faden-vorlagen.js');   // Hilfen (neu, funkMit, liste, pumpen, runde, notrufOhneOrt)
const X = require('./faden-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const Reise = require('../server/sim/reise.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Weltstand = require('../server/weltstand.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Faden = require('../server/sim/faden.js');
const SZ = require('../server/sim/faden-szene.js');
const { D } = X;
const { neu, funkMit, liste, pumpen, runde, notrufOhneOrt } = V;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const vor = (id) => lies('content/faeden/vorlagen/' + id + '.json');
const HW = lies('content/faeden/haltung-werte.json').werte, BW = lies('content/faeden/bitte-werte.json').werte, SZD = lies('content/faeden/szenen-werte.json'), WW = lies('content/faeden/werte.json').werte;
const hat = (r, code) => !r.ok && r.fehler.some((t) => t.startsWith(code + ':'));
const AUSLOESER = { dankbarer_captain: 'notruf_pirat_frachter', entfuehrter_haendler: 'notruf_pirat_haendler', falscher_haendler: 'notruf_havarie_konvoi' };
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
function oeffne(g, id, hex) {
  const a = notrufOhneOrt(g, AUSLOESER[id], hex || '0403', 'gelungen');
  const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: id, parameter: { angebot: a.nr } });
  if (!r.ok) throw new Error('Faden ' + id + ' nicht geoeffnet: ' + r.grund);
  return r.faden;
}
const faellig = (f, i, status) => { f.beat = i; f.phase = 'wartet'; f.laufend = null; f.zaehler = f.abstand; if (status) f.nsc.status = status; };
const kill = (g, tag) => { for (const e of g.space.enemies.filter((x) => x.tag === tag)) Space.damageEnemy(g, e, 99999, e.x, e.y); };
const bis = async (g, fn, max) => { for (let i = 0; i < (max || 900) && !fn(); i++) await pumpen(g, 1); return fn(); };
const logb = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const klon = (x) => JSON.parse(JSON.stringify(x));

// Der Captain wird feindlich: fuenf Mal „Spaeter“, dann „Ablehnen“ (Weg der Daten: hingehalten -1, sechs Angebote in der Frist des Beats); danach laeuft b_spontan als Variante
async function captainFeindlich(g) {
  ankunft(g, '0403');   // weg von der Station: ein Schiff am Dock dockt sonst von selbst an (Szenenwechsel)
  const f = oeffne(g, 'dankbarer_captain', '0403');
  for (let k = 0; k < 6; k++) {
    let off = null;
    for (let i = 0; i < 8 && !(off = Bitte.offen(g)); i++) await runde(g);
    if (!off) throw new Error('kein Angebot ' + (k + 1));
    Bitte.beantworten(g, k < 5 ? 'spaeter' : 'ablehnen', off.nr);
  }
  for (let i = 0; i < 14 && !(f.phase === 'laeuft' && f.laufend && f.laufend.beat === 'b_spontan'); i++) await runde(g);
  return f;
}

async function main() {
  // Alle drei Vorlagen muessen den Pruefer bestehen (sonst gaebe es nichts zu spielen: ein klarer Fehler statt eines Absturzes)
  const lf = D.ladefehler();
  ok(lf.length === 0 && D.vorlagenIds().length === 3, 'alle drei Vorlagen bestehen den Pruefer beim Laden' + (lf.length ? ' (' + lf[0].datei + ': ' + lf[0].fehler[0] + ')' : ''));
  if (lf.length) { console.log(`
${n - fails}/${n} Pruefungen ok
${fails} FEHLER`); process.exit(1); }
  // =====================================================================================================================================================================
  console.log('1. M1: Speichern, Laden und Weiterspielen waehrend einer feindlichen Variante');
  {
    const g = neu(410);
    const f = await captainFeindlich(g);
    ok(f.phase === 'laeuft' && f.laufend.beat === 'b_spontan' && f.laufend.variante === 'raumschlacht' && f.nsc.status === 'feindlich', `Testlage: b_spontan laeuft als Variante Raumschlacht gegen den feindlichen NSC (Haltung ${f.nsc.haltung})`);
    const data = Weltstand.capture(g);
    const fehler = Weltstand.validate(data, g);
    ok(fehler.length === 0, 'der Stand besteht das Weltstand-Schema, solange die Variante laeuft' + (fehler.length ? ' (' + fehler[0] + ')' : ''));
    const lf = data.welt.sim.faeden.liste.find((x) => x.id === f.id);
    ok(lf && lf.phase === 'laeuft' && !('variante' in lf.laufend), 'laufend.variante steht nicht im Weltstand (Laufzeit, abgeleitet)');
    ok(f.laufend.variante === 'raumschlacht', 'das Speichern aendert den Zustand der laufenden Partie nicht (variante bleibt im Spiel)');
    // Laden: die Szene ist nicht speicherbar, der Beat steht wieder aus; Haltung und Status stehen im Stand
    const geladen = Faden.lesen(klon(data.welt.sim.faeden));
    const fl = geladen.liste.find((x) => x.id === f.id);
    ok(fl && fl.phase === 'wartet' && fl.laufend === null && fl.beat === f.beat && fl.nsc.status === 'feindlich' && fl.nsc.haltung === f.nsc.haltung, 'geladen: der Beat steht wieder aus, der NSC bleibt feindlich mit seiner Haltung');
    // weiterspielen: der geladene Stand fuehrt die Variante wieder als Szene (aus Haltung und Status abgeleitet)
    const g2 = neu(410); ankunft(g2, '0403');
    g2.weltsim.faeden = geladen;
    const f2 = geladen.liste.find((x) => x.id === f.id);
    f2.zaehler = f2.abstand;
    const r = weiter(g2, f2);
    ok(r.ok && f2.phase === 'laeuft' && f2.laufend.variante === 'raumschlacht', 'nach dem Laden laeuft b_spontan wieder als Variante Raumschlacht');
    ok(await bis(g2, () => g2.fadenSzene && g2.fadenSzene.art === 'raumschlacht' && g2.fadenSzene.phase === 'kampf', 900), 'die Raumschlacht-Szene laeuft (Vorlauf, Kampf)');
    kill(g2, g2.fadenSzene.tag); await pumpen(g2, 3);
    ok(f2.beat === 3 && f2.phase === 'wartet' && f2.nsc.status === 'geflohen', `die Szene endet gelungen und der Faden geht zum Abschluss (Beat ${f2.beat}, ${f2.nsc.status})`);
    ok(Weltstand.validate(Weltstand.capture(g2), g2).length === 0, 'auch der Stand danach besteht das Schema');
    // Stand ohne Schalter bleibt byte-gleich: ein Faden ohne laufende Variante speichert wie vorher (laufend ohne variante)
    const g3 = neu(411); ab(g3);
    const f3 = oeffne(g3, 'dankbarer_captain', '0403');
    for (let i = 0; i < 8 && !Bitte.offen(g3); i++) await runde(g3);
    const roh = Faden.toSave(g3.weltsim).liste.find((x) => x.id === f3.id);
    ok(JSON.stringify(roh.laufend) === JSON.stringify({ beat: f3.laufend.beat, n: f3.laufend.n, seit: f3.laufend.seit }), 'ein laufender Beat ohne Variante speichert unveraendert (beat, n, seit)');
  }

  // =====================================================================================================================================================================
  console.log('\n2. S1: ein gewonnener Kampf gegen den feindlich gewordenen NSC ist keine Hilfe');
  {
    // Daten und Pruefer
    const v = vor('dankbarer_captain'), vb = v.beats.find((b) => b.id === 'b_spontan').variante;
    ok(vb.aus && vb.aus.gelungen && vb.aus.gescheitert, 'dankbarer_captain: die Variante hat eigene Ausgaenge (Daten)');
    ok(!WW.variante_status.wert.includes('verbuendet') && WW.variante_status.wert.includes(vb.aus.gelungen.status) && WW.variante_status.wert.includes(vb.aus.gescheitert.status), `die Ausgaenge lassen den Feind ${vb.aus.gelungen.status} bzw. ${vb.aus.gescheitert.status} zurueck, nie verbuendet`);
    const pruefe = (aendern) => { const w = vor('dankbarer_captain'); w.id = 'x_nach4'; aendern(w, w.beats.find((b) => b.id === 'b_spontan').variante); return Pruefer.pruefeVorlage(w); };
    ok(pruefe(() => {}).ok, 'die unveraenderte Vorlage besteht');
    ok(hat(pruefe((w, va) => { delete va.aus; }), 'VARIANTE_AUS') || hat(pruefe((w, va) => { delete va.aus; }), 'FORM'), 'Variante ohne aus -> abgelehnt (VARIANTE_AUS oder FORM)');
    ok(hat(pruefe((w, va) => { delete va.aus.gescheitert; }), 'VARIANTE_AUS') || hat(pruefe((w, va) => { delete va.aus.gescheitert; }), 'FORM'), 'Variante ohne einen Ausgang -> abgelehnt');
    ok(hat(pruefe((w, va) => { va.aus.gelungen.status = 'verbuendet'; }), 'VARIANTE_AUSGANG'), 'gelungen -> verbuendet -> VARIANTE_AUSGANG (Dank fuer einen Kampf)');
    ok(hat(pruefe((w, va) => { va.aus.gescheitert.status = 'aktiv'; }), 'VARIANTE_AUSGANG'), 'gescheitert -> aktiv -> VARIANTE_AUSGANG');
    ok(hat(pruefe((w, va) => { va.aus.gelungen.folge = [{ typ: 'haltung_aenderung', grund: 'gedankt' }]; }), 'VARIANTE_AUSGANG'), 'Haltung steigt in der Variante (gedankt) -> VARIANTE_AUSGANG');
    ok(pruefe((w, va) => { va.aus.gescheitert.folge = [{ typ: 'haltung_aenderung', grund: 'bitte_abgelehnt' }]; }).ok, 'Haltung sinkt in der Variante: erlaubt');
    ok(hat(pruefe((w, va) => { va.aus.gelungen.weiter = 'b_bitte'; }), 'WEITER_UNGUELTIG'), 'weiter nach hinten -> WEITER_UNGUELTIG');
    ok(hat(pruefe((w, va) => { va.aus.gelungen.status = va.aus.gescheitert.status; }), 'VARIANTE_AUS'), 'beide Ausgaenge gleich -> VARIANTE_AUS (Scheitern aendert nichts)');
    // Weg des Zustands: ein Beat nach der Variante, der den Zustand der Variante nicht vertraegt
    ok(hat(pruefe((w) => { const i = w.beats.findIndex((b) => b.id === 'b_abschluss'); w.beats.splice(i, 0, { id: 'b_extra', typ: 'spontanhilfe', aus: { gelungen: { status: 'verbuendet' }, gescheitert: { status: 'aktiv' } } }); w.beats.find((b) => b.id === 'b_spontan').aus.gelungen.weiter = 'b_extra'; w.beats.find((b) => b.id === 'b_spontan').aus.gescheitert.weiter = 'b_extra'; w.beats.find((b) => b.id === 'b_spontan').variante.aus.gelungen.weiter = 'b_extra'; w.beats.find((b) => b.id === 'b_spontan').variante.aus.gescheitert.weiter = 'b_extra'; }), 'STATUS_PASST_NICHT'), 'ein Beat nach der Variante, der den Zustand geflohen/feindlich nicht vertraegt -> STATUS_PASST_NICHT (Weg der Variante wird mitgeprueft)');
    {   // Haltungswege: der Weg durch die Variante folgt ihren Ausgaengen (kein Dank), nicht denen des Grund-Beats
      const w = vor('dankbarer_captain'); const idx = new Map(w.beats.map((b, i) => [b.id, i]));
      const wege = Pruefer.haltungsWege(w, idx);
      const iEnde = w.beats.findIndex((b) => b.id === 'b_abschluss');
      ok(wege.start[iEnde].length > 0 && !wege.start[iEnde].some((x) => x.s === 'verbuendet' && x.h <= HW.feindlich_unter.wert), 'Haltungswege: kein Weg erreicht den Abschluss „verbuendet“ aus der Variante (Haltung unter der Grenze)');
    }
    // Spiel: die Variante laeuft, die Crew gewinnt
    const g = neu(420);
    const f = await captainFeindlich(g);
    const funk = funkMit(g);
    const h0 = f.nsc.haltung, rom0 = g.weltsim.ruf.rom;
    ok(f.laufend && f.laufend.variante === 'raumschlacht', 'Testlage: die Variante laeuft');
    ok(await bis(g, () => g.fadenSzene && g.fadenSzene.phase === 'kampf', 900), 'der Kampf laeuft');
    kill(g, g.fadenSzene.tag); await pumpen(g, 3);
    const gd = f.nsc.gedaechtnis.map((x) => x.ereignis);
    const letzter = f.nsc.gedaechtnis[f.nsc.gedaechtnis.length - 1];
    ok(f.nsc.status === vb.aus.gelungen.status && f.nsc.status !== 'verbuendet', `der gewonnene Kampf: NSC ${f.nsc.status}, nicht verbuendet`);
    ok(f.nsc.haltung <= h0, `die Haltung steigt nicht (${h0} -> ${f.nsc.haltung}), kein „gedankt“`);
    ok(letzter.ereignis === WW.variante_ereignis.wert + 'raumschlacht_gelungen', `das Gedaechtnis erinnert sich an den Kampf (${letzter.ereignis})`);
    ok(!gd.includes('spontanhilfe_gelungen') && !gd.includes('spontanhilfe_gescheitert'), 'es gibt kein spontanhilfe_gelungen im Gedaechtnis');
    ok(g.weltsim.ruf.rom === rom0, 'kein Ruf fuer den Kampf (keine Preise)');
    ok(f.beat === 3 && f.phase === 'wartet', 'der Faden steht am Abschluss');
    // der Abschluss zaehlt den Kampf nicht als Leistung fuer den Captain: kein Erfolg, keine Belohnung
    f.zaehler = f.abstand;
    ok(weiter(g, f).ok && f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', 'der Faden schliesst gescheitert ab (der Feind ist kein dankbarer Captain)');
    ok(f.nsc.haltung <= h0 && g.weltsim.ruf.rom === rom0, 'der Abschluss zahlt weder Haltung noch Ruf');
    ok(!funk.some((x) => /spontan/i.test(String(x.text))), 'kein Funk der Spontanhilfe');
    // Verlieren: der Feind bleibt feindlich
    const gv = neu(421);
    const fv = await captainFeindlich(gv);
    ok(await bis(gv, () => gv.fadenSzene && gv.fadenSzene.phase === 'kampf', 900), 'zweite Partie: der Kampf laeuft');
    gv.ship.docked = true; gv.ship.dockedAt = 'x'; SZ.andockenHook(gv); await pumpen(gv, 3);   // die Crew dockt an: Szenenwechsel, gescheitert
    ok(fv.nsc.status === vb.aus.gescheitert.status && fv.nsc.status === 'feindlich', `verloren (Andocken): der NSC bleibt feindlich (${fv.nsc.status})`);
    ok(fv.nsc.gedaechtnis[fv.nsc.gedaechtnis.length - 1].ereignis === WW.variante_ereignis.wert + 'raumschlacht_gescheitert', 'Gedaechtnis: feind_raumschlacht_gescheitert');
    // Gegenprobe: ohne Variante (Hilfe) buchen die Ausgaenge des Grund-Beats unveraendert
    const gh = neu(422); ab(gh);
    const fh = oeffne(gh, 'dankbarer_captain', '0403');
    faellig(fh, 2, 'verbuendet'); fh.nsc.haltung = 3;
    ok(weiter(gh, fh).ok && fh.laufend && !fh.laufend.variante, 'Gegenprobe: Haltung 3: b_spontan laeuft als Hilfe');
    const hh = fh.nsc.haltung;
    Faden.beatAusgang(gh, fh.id, 'gelungen');
    ok(fh.nsc.status === 'verbuendet' && fh.nsc.haltung > hh && fh.nsc.gedaechtnis.some((x) => x.ereignis === 'spontanhilfe_gelungen'), 'Gegenprobe: die Hilfe bucht wie vorher (verbuendet, gedankt, spontanhilfe_gelungen)');
  }

  // =====================================================================================================================================================================
  console.log('\n3. S2: Ruf nur fuer die Leistung, nicht fuer die Zusage');
  {
    for (const id of ['dankbarer_captain', 'falscher_haendler']) {
      const v = vor(id), b = v.beats.find((x) => x.id === 'b_bitte');
      const annehmen = b.optionen.find((o) => o.id === 'annehmen');
      ok(!annehmen.folge.some((x) => x.typ === 'ruf_aenderung'), `${id}: Annehmen hat keine Ruf-Folge (Daten)`);
    }
    {
      const v = vor('dankbarer_captain'), l = v.beats[v.beats.length - 1];
      ok(l.aus.gelungen.folge.some((x) => x.typ === 'ruf_aenderung') && !l.aus.gescheitert.folge.some((x) => x.typ === 'ruf_aenderung'), 'dankbarer_captain: der Ruf steht am gelungenen Abschluss, nicht am gescheiterten (Daten)');
    }
    // Zusage, dann scheitern: kein Ruf, der Deckel bleibt frei
    const g = neu(430); ab(g);
    const f = oeffne(g, 'dankbarer_captain', '0403');
    for (let i = 0; i < 8 && !Bitte.offen(g); i++) await runde(g);
    const rom0 = g.weltsim.ruf.rom;
    Bitte.beantworten(g, 'annehmen', Bitte.offen(g).nr);
    ok(g.weltsim.ruf.rom === rom0 && g.weltsim.faeden.bitteLog.length === 0, 'Annehmen: kein Ruf, der Deckel ist unberuehrt');
    faellig(f, 1, f.nsc.status);
    ok(weiter(g, f).ok && f.laufend.beat === 'b_mission', 'die Mission beginnt');
    for (let i = 0; i < WW.beat_frist.wert + 2 && f.phase === 'laeuft'; i++) g.lageGrenze('szene_ende');   // die Crew kommt nicht: die Frist scheitert den Beat
    await pumpen(g, 3);
    ok(f.phase === 'wartet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'raumschlacht_gescheitert'), 'die Mission scheitert');
    f.beat = 3; f.phase = 'wartet'; f.zaehler = f.abstand;
    ok(weiter(g, f).ok && f.ausgang.art === 'gescheitert', 'der Abschluss ohne Leistung ist gescheitert');
    ok(g.weltsim.ruf.rom === rom0, `Zusage und Scheitern: der Ruf bleibt (${rom0} -> ${g.weltsim.ruf.rom})`);
    // Zusage und Erfolg: der Ruf kommt am Abschluss (der Deckel ist frei, weil die Zusage nichts verbraucht hat)
    const g2 = neu(431); ab(g2);
    const f2 = oeffne(g2, 'dankbarer_captain', '0403');
    for (let i = 0; i < 8 && !Bitte.offen(g2); i++) await runde(g2);
    Bitte.beantworten(g2, 'annehmen', Bitte.offen(g2).nr);
    const rom2 = g2.weltsim.ruf.rom;
    faellig(f2, 3, 'verbuendet'); f2.nsc.gedaechtnis.push({ tick: 1, ereignis: 'raumschlacht_gelungen', text_key: 'x' });
    ok(weiter(g2, f2).ok && f2.ausgang.art === 'gelungen' && g2.weltsim.ruf.rom > rom2, `Zusage und Erfolg: der Ruf kommt am Abschluss (${rom2} -> ${g2.weltsim.ruf.rom})`);
    ok(g2.weltsim.faeden.bitteLog.length === 1 && g2.weltsim.faeden.bitteLog[0][1] > 0, 'der gebuchte Ruf steht im Deckel');

    // Nebenbefund: der Deckel zaehlt nur gebuchten Ruf
    const roh = Kriegslage.rufBuchen;
    for (const [name, ersatz] of [['die Buchung wird abgelehnt (Katalog)', () => ({ ok: true, angewandt: 0, vorher: null, nachher: null })], ['die Buchung wirft', () => { throw new Error('Probe'); }], ['keine Weltsim', () => ({ ok: false, angewandt: 0, vorher: null, nachher: null })]]) {
      const g3 = neu(432); ab(g3);
      const f3 = oeffne(g3, 'dankbarer_captain', '0403');
      faellig(f3, 3, 'verbuendet'); f3.nsc.gedaechtnis.push({ tick: 1, ereignis: 'raumschlacht_gelungen', text_key: 'x' });
      Kriegslage.rufBuchen = ersatz;
      try { weiter(g3, f3); } finally { Kriegslage.rufBuchen = roh; }
      ok(f3.phase === 'abgeschlossen' && g3.weltsim.faeden.bitteLog.length === 0, `${name}: der Deckel bleibt frei (kein Eintrag ohne Buchung)`);
    }
  }

  // =====================================================================================================================================================================
  console.log('\n4. S3: Spaeter kostet nicht mehr als Ablehnen, die feindliche Wiederkehr bleibt erreichbar');
  {
    const Q = HW.quellen.wert;
    ok(Q.hingehalten.delta === -1 && Q.hingehalten.delta === Q.bitte_abgelehnt.delta, `hingehalten ${Q.hingehalten.delta} = bitte_abgelehnt ${Q.bitte_abgelehnt.delta} (Daten)`);
    ok(D.vorlagenIds().length === 3 && D.ladefehler().length === 0, 'alle drei Vorlagen bestehen den Pruefer (TON_UNERREICHBAR und VARIANTE_UNERREICHBAR gerechnet)');
    const v = vor('dankbarer_captain'); v.id = 'x_nach4s3';
    ok(Pruefer.pruefeVorlage(v).ok, 'dankbarer_captain besteht mit den Zahlen der Daten');
    // der Grund fuer feindlich_unter -3: mit der alten Grenze -6 waere die Variante unerreichbar
    const H = D.HALTUNG, alt = H.feindlich_unter;
    H.feindlich_unter = -6;
    let r6; try { r6 = Pruefer.pruefeVorlage(v); } finally { H.feindlich_unter = alt; }
    ok(hat(r6, 'VARIANTE_UNERREICHBAR'), 'mit feindlich_unter -6 und hingehalten -1 waere die Variante unerreichbar (VARIANTE_UNERREICHBAR): darum -3');
    // Spiel: ein klares Nein (-1) und ein Aufschub (-1) kosten gleich viel
    const g = neu(440); ab(g);
    const f = oeffne(g, 'dankbarer_captain', '0403');
    for (let i = 0; i < 8 && !Bitte.offen(g); i++) await runde(g);
    const h0 = f.nsc.haltung;
    Bitte.beantworten(g, 'spaeter', Bitte.offen(g).nr);
    ok(Math.round((h0 - f.nsc.haltung) * 100) / 100 === 1, `Spaeter kostet 1 Haltung (${h0} -> ${f.nsc.haltung})`);
    const gA = neu(441); ab(gA);
    const fA = oeffne(gA, 'dankbarer_captain', '0403');
    for (let i = 0; i < 8 && !Bitte.offen(gA); i++) await runde(gA);
    const hA = fA.nsc.haltung;
    Bitte.beantworten(gA, 'ablehnen', Bitte.offen(gA).nr);
    ok(Math.round((hA - fA.nsc.haltung) * 100) / 100 === 1, `Ablehnen kostet ebenfalls 1 Haltung (${hA} -> ${fA.nsc.haltung})`);
    // die feindliche Wiederkehr ist im Spiel erreichbar (captainFeindlich: fuenf Aufschuebe und ein Nein)
    const g2 = neu(442);
    const f2 = await captainFeindlich(g2);
    ok(f2.nsc.haltung < HW.feindlich_unter.wert && f2.laufend && f2.laufend.variante === 'raumschlacht', `fuenf Aufschuebe und ein Nein: Haltung ${f2.nsc.haltung} unter ${HW.feindlich_unter.wert}, die Variante laeuft`);
  }

  // =====================================================================================================================================================================
  console.log('\n5. S4: Befreiung: die Folge steht im Funk, der Schnellsprung haelt am Ort des NSC');
  {
    const T = SZD.texte;
    ok(/andock/i.test(T.vorwarnung.befreiung) && /spring/i.test(T.vorwarnung.befreiung) && /im Stich/.test(T.vorwarnung.befreiung) && /verloren/.test(T.vorwarnung.befreiung), 'Vorwarntext (Daten): nennt Andocken und Springen und die Folge (im Stich gelassen, verloren)');
    ok(/andock/i.test(T.vorwarnung.befreiung) && /spring/i.test(T.vorwarnung.befreiung), 'Vorwarntext: Andocken und Springen stehen als Verben da');
    ok(T.vorwarnung.befreiung.replace(/\{name\}/g, 'Quintus Fabrin').replace('{sek}', '10').length <= 160, 'der Vorwarntext bleibt unter 160 Zeichen (mit Namen)');
    // im Spiel: die Warnung wird gefunkt, und wer im Vorlauf andockt, laesst den NSC im Stich (tot)
    const g = neu(450); ab(g);
    const funk = funkMit(g);
    const f = oeffne(g, 'entfuehrter_haendler', '0403');
    faellig(f, 1, 'gefangen');
    ankunft(g, '0403');
    ok(weiter(g, f).ok && f.laufend.beat === 'b_befreiung', 'der Beat Befreiung beginnt am Ort');
    await pumpen(g, 5);
    const w = funk.find((x) => x.from === 'Aufklärung' && /Wachschiffe sichern/.test(String(x.text)));
    ok(!!w && /im Stich/.test(w.text) && w.text.includes(f.nsc.name), `der Funk im Vorlauf nennt die Folge: „${w && w.text}“`);
    ok(g.fadenSzene && g.fadenSzene.phase === 'vorlauf', 'die Szene steht im Vorlauf');
    g.ship.docked = true; g.ship.dockedAt = 'x'; SZ.andockenHook(g); await pumpen(g, 3);
    ok(f.nsc.status === 'tot' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'befreiung_gescheitert'), 'Andocken im Vorlauf: der NSC ist tot, die Befreiung gescheitert (die Folge der Warnung)');

    // Schnellsprung ueber mehrere Hops durch den Ort des NSC
    const runden = async (gg, sek) => { for (let i = 0; i < Math.round(sek * 30); i++) gg.step(); };
    const aufbau = (seed, aktivBeat) => {
      const gs = X.F.neuesSpiel({ crew: 3, seed, names: ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'], env: { FAEDEN: '1', REISE_EREIGNISSE: 'off' } }).g; ab(gs);   // ohne Reise-Ereignisse: nur der Halt des Fadens darf den Schnellsprung beenden
      gs.explore.erkunde('0304'); gs.explore.erkunde('0403'); gs.explore.erkunde('0305');
      gs.C.reise.neutralChance = 0; gs.C.reise.neutralPlus = 0; gs.C.reise.feindChance = 0;
      const fs = oeffne(gs, 'entfuehrter_haendler', '0304');
      if (aktivBeat) { faellig(fs, 1, 'gefangen'); weiter(gs, fs); }
      const ziel = Sprung.selectDest(gs, Sektoren.ortVonHex('0403'));
      const p = Sprung.sprungpunkt(gs, gs.reisePlan.hops[0]); gs.ship.x = p.x - 80; gs.ship.y = p.y;
      const meldungen = []; const oda = gs.oda.bind(gs); gs.oda = (t, k) => { meldungen.push(String(t)); return oda(t, k); };
      for (let i = 0; i < 40 * 30 && !gs.ship.jump.ready; i++) gs.step();
      return { g: gs, f: fs, ziel, meldungen };
    };
    {
      const t = aufbau(451, true);
      ok(t.ziel === null && t.g.reisePlan && t.g.reisePlan.hops.join() === '0204,0304,0403', 'Testlage: die Route 0305 -> 0403 fuehrt ueber 0304, den Ort des NSC (' + (t.g.reisePlan && t.g.reisePlan.hops.join()) + ')');
      ok(t.f.phase === 'laeuft' && t.f.parameter.ort === '0304', 'Testlage: der Befreiungs-Beat laeuft und wartet auf die Ankunft bei 0304');
      ok(Reise.befehl(t.g) === null && !!t.g.reise, 'der Schnellsprung startet');
      await runden(t.g, 4.3 * 3);
      ok(Sektoren.hexVonOrt(t.g.ship.scene) === '0304' && !t.g.reise, `der Schnellsprung haelt am Ort des NSC (Sektor ${Sektoren.hexVonOrt(t.g.ship.scene)}, Reise ${!!t.g.reise})`);
      ok(t.meldungen.some((m) => /Schnellsprung angehalten/.test(m) && m.includes(t.f.nsc.name) && /im Stich/.test(m)), 'die Meldung nennt den NSC und die Folge');
      ok(t.g.reisePlan && t.g.reisePlan.hops.join() === '0403', 'die Rest-Route bleibt gewaehlt (wie nach einem Reise-Ereignis)');
      ok(t.f.phase === 'laeuft' && t.f.nsc.status === 'gefangen', 'der NSC lebt, der Beat laeuft weiter');
      await runden(t.g, 3);
      ok(t.g.fadenSzene && t.g.fadenSzene.art === 'befreiung', 'die Befreiung beginnt am Ort (Vorwarnung, Vorlauf)');
    }
    {   // Gegenprobe: ohne wartende Befreiung faehrt der Schnellsprung durch (nichts wird angehalten)
      const t = aufbau(452, false);
      ok(Reise.befehl(t.g) === null, 'Gegenprobe: der Schnellsprung startet');
      await runden(t.g, 4.3 * 3 + 1);
      ok(Sektoren.hexVonOrt(t.g.ship.scene) === '0403' && !t.g.reise, 'Gegenprobe: ohne wartende Befreiung kommt er am Ziel an (Sektor ' + Sektoren.hexVonOrt(t.g.ship.scene) + ', Reise ' + !!t.g.reise + ', Meldungen ' + t.meldungen.slice(-2).join(' | ') + ')');
    }
  }

  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
  console.log('FADEN-NACH4 OK');
}
main().then(() => process.exit(0)).catch((e) => { console.log('ABSTURZ ' + (e && e.stack)); process.exit(1); });
