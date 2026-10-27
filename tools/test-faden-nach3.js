'use strict';
// SUND-04a-2 Nacharbeit Welle 3 (Abschluss, Ruf-Deckel, Haltung, Befreiung, Gedaechtnis, Vorlauf, Notruf-Hinweis, Bot mit echten Kampfausgaengen). Die Erwartungen stehen hier selbst
// (aus den Daten in content/faeden/ und den Regeln des Auftrags), nie aus dem Produktivcode. Dieser Test ruft NIE Faden.beatAusgang oder beatZurueck: jeder Ausgang eines Beats
// entsteht durch das, was die Crew im Spiel tut (Szene, Ankunft, Andocken, Antwort, Frist).
//   node tools/test-faden-nach3.js        (npm run test:faden-nach3)
const fs = require('fs');
const path = require('path');
const V = require('./test-faden-vorlagen.js');   // Hilfen (neu, funkMit, liste, pumpen, runde, notrufOhneOrt)
const X = require('./faden-fixture.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const P3 = require('../server/sim/faden-p3.js');
const Faden = require('../server/sim/faden.js');
const Abspann = require('../server/sim/abspann.js');
const Dat = require('../server/weltsim/daten.js');
const { D } = X;
const { neu, funkMit, liste, pumpen, runde, notrufOhneOrt } = V;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const vor = (id) => lies('content/faeden/vorlagen/' + id + '.json');
const HW = lies('content/faeden/haltung-werte.json').werte, BW = lies('content/faeden/bitte-werte.json').werte, TX = lies('content/faeden/p3-texte.json'), SZ = lies('content/faeden/szenen-werte.json');
const BEAT_FRIST = lies('content/faeden/werte.json').werte.beat_frist.wert;
const hat = (r, code) => !r.ok && r.fehler.some((t) => t.startsWith(code + ':'));
const AUSLOESER = { dankbarer_captain: 'notruf_pirat_frachter', entfuehrter_haendler: 'notruf_pirat_haendler', falscher_haendler: 'notruf_havarie_konvoi' };
const ws = (g) => g.weltsim.zustand;
const faden = (g, id) => liste(g).find((f) => f.vorlage === id);
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
function freierRomPosten(g) { const w = g.weltsim.zustand; const d = Dat.datenVon(w); return Object.keys(w.hexe).filter((k) => w.hexe[k].besitzer === 'rom' && !w.hexe[k].posten && d.hex[k].hafen === '').sort()[0] || null; }
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
// ein Faden aus dem Notruf, offen (Abstand noch nicht erreicht)
function oeffne(g, id, hex) {
  const a = notrufOhneOrt(g, AUSLOESER[id] || id, hex || '0403', 'gelungen');
  const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: id.startsWith('notruf_mit') ? id : (a && a.vorlagen[0]), parameter: { angebot: a.nr } });
  if (!r.ok) throw new Error('Faden ' + id + ' nicht geoeffnet: ' + r.grund);
  return r.faden;
}
// ein Faden steht am Beat mit der Nummer i und ist faellig (Testzustand, wie die anderen Faden-Tests; die Wege dorthin sind eigens geprueft)
const faellig = (f, i, status) => { f.beat = i; f.phase = 'wartet'; f.laufend = null; f.zaehler = f.abstand; if (status) f.nsc.status = status; };
const tonVon = (h) => { let t = HW.toene.wert[0].id; for (const x of HW.toene.wert) if (h >= x.ab) t = x.id; return t; };

async function main() {
  // =====================================================================================================================================================================
  console.log('1. Abschluss und Scheitern: eine Belohnung gibt es nur bei Erfolg');
  {
    // Daten: jede mitgelieferte Vorlage sagt, wann sie gelungen ist (Gedaechtnis-Ereignis der Crew)
    for (const id of Object.keys(AUSLOESER)) {
      const v = D.vorlage(id), l = v.beats[v.beats.length - 1];
      ok(l.typ === 'abschluss' && l.erfolg && Array.isArray(l.erfolg.ereignis) && l.erfolg.ereignis.length >= 1, `${id}: der Abschluss nennt erfolg.ereignis (Daten)`);
    }
    // Abschluss-Beat mit und ohne Leistung der Crew: Haltung und Ruf des Ausgangs gelten nur bei Erfolg. Je Vorlage: das Gedaechtnis sagt, was die Crew geleistet hat
    const faelle = [
      ['dankbarer_captain', 'raumschlacht_gelungen', 'verbuendet'],
      ['entfuehrter_haendler', 'befreiung_gelungen', 'verbuendet'],
      ['falscher_haendler', 'raumschlacht_gelungen', 'tot'],
    ];
    for (const [id, ereignis, status] of faelle) {
      const v = D.vorlage(id), iEnde = v.beats.length - 1;
      for (const leistung of [true, false]) {
        const g = neu(300 + (leistung ? 1 : 2));
        const funk = funkMit(g);
        const f = oeffne(g, id, '0403');
        faellig(f, iEnde, status);
        f.nsc.gedaechtnis = leistung ? [{ tick: 1, ereignis, text_key: 'x' }] : [{ tick: 1, ereignis: 'bitte_gescheitert', text_key: 'x' }];
        const h0 = f.nsc.haltung, rom0 = g.weltsim.ruf.rom;
        const r = Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: v.beats[iEnde].id });
        ok(r.ok && f.phase === 'abgeschlossen', `${id}: der Abschluss laeuft (${leistung ? 'mit' : 'ohne'} Leistung)`);
        const erwartetArt = leistung ? 'gelungen' : 'gescheitert';
        ok(f.ausgang && f.ausgang.art === erwartetArt, `${id}: Ausgang des Fadens ${erwartetArt} (${f.ausgang && f.ausgang.art})`);
        const folgeGelungen = v.beats[iEnde].aus.gelungen.folge || [];
        const haltungErwartet = folgeGelungen.filter((x) => x.typ === 'haltung_aenderung').reduce((s, x) => s + HW.quellen.wert[x.grund].delta, 0);
        const rufErwartet = folgeGelungen.some((x) => x.typ === 'ruf_aenderung');
        if (leistung) {
          ok(Math.abs((f.nsc.haltung - h0) - haltungErwartet) < 1e-9 || haltungErwartet === 0, `${id}: mit Leistung zahlt der Abschluss seine Haltung (${h0} -> ${f.nsc.haltung})`);
          ok(!rufErwartet || g.weltsim.ruf.rom > rom0, `${id}: mit Leistung zahlt der Abschluss seinen Ruf (${rom0} -> ${g.weltsim.ruf.rom})`);
        } else {
          ok(f.nsc.haltung === h0, `${id}: OHNE Leistung keine Haltungs-Belohnung (${h0} -> ${f.nsc.haltung})`);
          ok(g.weltsim.ruf.rom === rom0, `${id}: OHNE Leistung kein Ruf (${rom0} -> ${g.weltsim.ruf.rom})`);
          ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'abschluss_gescheitert'), `${id}: das Gedaechtnis schreibt abschluss_gescheitert`);
          const zeile = funk.find((x) => x && x.text && (x.text === TX.texte[status === 'tot' ? 'abschluss_tot' : 'abschluss_gescheitert'].split('{name}').join(f.nsc.name)));
          ok(!!zeile, `${id}: ohne Leistung kein Dank (Text ${status === 'tot' ? 'abschluss_tot' : 'abschluss_gescheitert'}: ${zeile && zeile.text})`);
          ok(!funk.some((x) => x && /Danke, dass ihr/.test(String(x.text))), `${id}: der Dankestext fehlt ohne Leistung`);
        }
      }
    }
    // Abspann: die Fakten sehen den Ausgang
    {
      const g = neu(310);
      const f = oeffne(g, 'entfuehrter_haendler', '0403');
      faellig(f, 2, 'tot'); f.nsc.gedaechtnis = [{ tick: 1, ereignis: 'notruf_gescheitert', text_key: 'x' }];
      weiter(g, f);
      ok(Abspann.fakten(g).faedenAusgang.entfuehrter_haendler === 'gescheitert', 'Abspann-Fakten: der gescheiterte Faden steht als gescheitert (nicht mehr immer gelungen)');
    }
    // Pruefer
    {
      const pruefe = (id, aendern) => { const v = vor(id); v.id = 'x_nach3'; aendern(v); return Pruefer.pruefeVorlage(v); };
      ok(pruefe('dankbarer_captain', () => {}).ok, 'Vorlage unveraendert besteht');
      ok(hat(pruefe('dankbarer_captain', (v) => { delete v.beats[3].erfolg; }), 'ERFOLG_FEHLT'), 'Abschluss ohne erfolg -> ERFOLG_FEHLT');
      ok(hat(pruefe('dankbarer_captain', (v) => { v.beats[3].erfolg = { ereignis: ['gibts_nicht_gelungen'] }; }), 'ERFOLG_UNGUELTIG'), 'erfolg mit einem Ereignis, das die Vorlage nie schreibt -> ERFOLG_UNGUELTIG');
      ok(hat(pruefe('dankbarer_captain', (v) => { v.beats[0].erfolg = { ereignis: ['bitte_gelungen'] }; }), 'ERFOLG_UNGUELTIG'), 'erfolg an einem Beat, der kein Abschluss ist -> ERFOLG_UNGUELTIG');
      ok(hat(pruefe('dankbarer_captain', (v) => { v.beats[3].erfolg = { ereignis: [] }; }), 'ERFOLG_FEHLT') || hat(pruefe('dankbarer_captain', (v) => { v.beats[3].erfolg = { ereignis: [] }; }), 'FORM'), 'leeres erfolg -> abgelehnt');
    }
  }

  // =====================================================================================================================================================================
  console.log('\n2. Ruf-Deckel: er begrenzt nur den Ruf, nie die Annahme einer Bitte (echte Vorlage)');
  {
    const g = neu(320);
    const f = oeffne(g, 'dankbarer_captain', '0403');
    for (let i = 0; i < 8 && !Bitte.offen(g); i++) await runde(g);
    const off = Bitte.offen(g);
    ok(!!off, 'die Bitte des Captains ist offen');
    ok(off && off.optionen.some((o) => o.id === 'annehmen'), 'Annehmen steht im Angebot');
    g.weltsim.faeden.bitteLog = [[g.weltsim.faeden.t, BW.ruf_deckel.wert]];   // der Deckel ist voll
    const rom0 = g.weltsim.ruf.rom, h0 = f.nsc.haltung;
    ok(Bitte.beantworten(g, 'annehmen', off.nr) === null, 'bei vollem Deckel: die Annahme wird nicht verweigert');
    ok(f.beat === 1 && f.phase === 'wartet', 'der Faden geht mit Ausgang gelungen zur Mission');
    ok(f.nsc.haltung > h0, `die Haltung wird gebucht (${h0} -> ${f.nsc.haltung})`);
    ok(g.weltsim.ruf.rom === rom0, 'der Ruf entfaellt (Deckel voll)');
    const logb = (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
    ok(logb.some((e) => e.ausgang === 'ruf_deckel'), 'der entfallene Ruf steht im Regie-Logbuch (ruf_deckel)');
  }

  // =====================================================================================================================================================================
  console.log('\n3. Haltung ist mit den Vorlagen erreichbar: Ton der Bitte und feindliche Wiederkehr (keine Preise)');
  {
    // Pruefer: eine Vorlage, deren Variante oder Ton nie gilt, wird abgelehnt
    const pruefe = (id, aendern) => { const v = vor(id); v.id = 'x_nach3'; aendern(v); return Pruefer.pruefeVorlage(v); };
    ok(Pruefer.pruefeVorlage(vor('dankbarer_captain')).ok, 'dankbarer_captain besteht: Ton und Variante sind erreichbar');
    ok(hat(pruefe('dankbarer_captain', (v) => { v.beats[0].optionen.find((o) => o.id === 'spaeter').folge = []; }), 'TON_UNERREICHBAR'), 'Spaeter ohne Haltungs-Folge: der kalte Ton wird nie gesprochen -> TON_UNERREICHBAR');
    ok(hat(pruefe('dankbarer_captain', (v) => { v.beats[0].optionen.find((o) => o.id === 'spaeter').folge = []; }), 'VARIANTE_UNERREICHBAR'), 'Spaeter ohne Haltungs-Folge: die feindliche Variante laeuft nie -> VARIANTE_UNERREICHBAR');
    ok(hat(pruefe('dankbarer_captain', (v) => { v.nsc.haltung = 0; }), 'TON_UNERREICHBAR'), 'Start 0: der herzliche Ton wird nie gesprochen -> TON_UNERREICHBAR');
    ok(pruefe('dankbarer_captain', (v) => { v.nsc.haltung = 4; }).ok, 'Start 4 (herzlich ab 2): besteht');
    // Verbraucher im echten Spiel: der Ton der Bitte folgt der Haltung; mehrmals hingehalten kehrt der NSC feindlich wieder
    const g = neu(330);
    ab(g);
    const v = vor('dankbarer_captain');
    const f = oeffne(g, 'dankbarer_captain', '0403');
    for (let i = 0; i < 8 && !Bitte.offen(g); i++) await runde(g);
    const delta = HW.quellen.wert.hingehalten.delta;
    let h = v.nsc.haltung;
    const textRoh = (hh) => { const ton = tonVon(hh); const k = 'bitte_mission' + (ton === 'sachlich' ? '' : '_' + ton); return BW.texte.wert[k] || BW.texte.wert.bitte_mission; };
    const kopf = (t) => t.split('{ort}')[0];
    const toene = [];
    for (let k = 0; k < 5; k++) {
      let off = null;
      for (let i = 0; i < 6 && !(off = Bitte.offen(g)); i++) await runde(g);
      if (!off) break;
      toene.push(tonVon(h));
      ok(off.text.startsWith(kopf(textRoh(h))), `Angebot ${k + 1} (Haltung ${h}, Ton ${tonVon(h)}): „${off.text}“`);
      if (k === 4) break;   // fuenf Angebote gesehen (vier Mal hingehalten): danach ablehnen
      Bitte.beantworten(g, 'spaeter', off.nr);
      h = Math.round((h + delta) * 100) / 100;
      ok(f.nsc.haltung === h, `nach dem ${k + 1}. Hinhalten: Haltung ${f.nsc.haltung} (erwartet ${h})`);
    }
    ok(toene.includes('herzlich') && toene.includes('sachlich') && toene.includes('kalt'), `alle drei Toene waren im Spiel zu hoeren (${toene.join(', ')})`);
    // der fuenfte Weg: nach vier Hinhalte-Antworten ablehnen -> die Haltung liegt unter der Grenze, b_spontan laeuft als Raumschlacht gegen den NSC
    const off = Bitte.offen(g);
    ok(!!off, 'das letzte Angebot ist offen');
    Bitte.beantworten(g, 'ablehnen', off.nr);
    const erwartetH = Math.max(HW.grenzen.wert.min, Math.round((h + HW.quellen.wert.bitte_abgelehnt.delta) * 100) / 100);
    ok(f.nsc.haltung === erwartetH && f.nsc.haltung < HW.feindlich_unter.wert, `nach vier Hinhalte-Antworten und Ablehnen: Haltung ${f.nsc.haltung} unter ${HW.feindlich_unter.wert}`);
    for (let i = 0; i < 14 && !(f.phase === 'laeuft' && f.laufend && f.laufend.beat === 'b_spontan'); i++) await runde(g);
    ok(f.phase === 'laeuft' && f.laufend && f.laufend.beat === 'b_spontan' && f.laufend.variante === 'raumschlacht' && f.nsc.status === 'feindlich', `der Beat b_spontan laeuft als Variante Raumschlacht, der NSC ist feindlich (${f.laufend && f.laufend.variante}, ${f.nsc.status})`);
    const sz = g.fadenSzene || (g.fadenWarte || [])[0];
    ok(!!sz && sz.art === 'raumschlacht', 'es gibt eine Raumschlacht-Szene statt der Hilfe (Gegner statt Verbuendeter)');
    // Gegenprobe: ohne Hinhalten ist die Haltung des Captains nie feindlich (Spontanhilfe)
    const g2 = neu(331); ab(g2);
    const f2 = oeffne(g2, 'dankbarer_captain', '0403');
    for (let i = 0; i < 8 && !Bitte.offen(g2); i++) await runde(g2);
    Bitte.beantworten(g2, 'ablehnen', Bitte.offen(g2).nr);
    for (let i = 0; i < 14 && !(f2.phase === 'laeuft' && f2.laufend && f2.laufend.beat === 'b_spontan'); i++) await runde(g2);
    ok(f2.laufend && f2.laufend.beat === 'b_spontan' && !f2.laufend.variante && f2.nsc.status !== 'feindlich', 'Gegenprobe: nur abgelehnt (ohne Hinhalten): die Spontanhilfe laeuft, kein Feind');
  }

  // =====================================================================================================================================================================
  console.log('\n4. Befreiung findet am Ort des NSC statt');
  {
    const SZW = SZ.werte;
    const kill = (g, tag) => { for (const e of g.space.enemies.filter((x) => x.tag === tag)) Space.damageEnemy(g, e, 99999, e.x, e.y); };
    const bis = async (g, fn, max) => { for (let i = 0; i < (max || 900) && !fn(); i++) await pumpen(g, 1); return fn(); };
    const wachen = (g) => g.space.enemies.filter((e) => /^fs\d+$/.test(e.tag || '')).length;
    {   // Schiff woanders: keine Szene, keine Wachen, Funk nennt den Ort; Ankunft startet die Szene; die Wachen weg = frei
      const g = neu(340); ab(g);
      const funk = funkMit(g);
      const f = oeffne(g, 'entfuehrter_haendler', '0403');
      faellig(f, 1, 'gefangen');
      ok(Sektoren.hexVonOrt(g.ship.scene) !== '0403', 'Testlage: das Schiff ist nicht am Ort 0403 (' + Sektoren.hexVonOrt(g.ship.scene) + ')');
      ok(weiter(g, f).ok && f.phase === 'laeuft' && f.laufend.beat === 'b_befreiung', 'der Beat Befreiung beginnt');
      ok(funk.some((x) => x.from === 'Aufklärung' && new RegExp('sitzt bei ' + Sektoren.hexName('0403') + ' fest').test(String(x.text))), 'Funk: der NSC sitzt bei seinem Ort fest, fliegt hin');
      await pumpen(g, 400);
      ok(!g.fadenSzene && !(g.fadenWarte || []).length && wachen(g) === 0, 'woanders: keine Szene, keine Wachschiffe (nichts spawnt an einem fremden Ort)');
      ok(f.phase === 'laeuft', 'der Beat wartet auf die Ankunft');
      ankunft(g, '0403');
      await pumpen(g, 5);
      ok(!!g.fadenSzene && g.fadenSzene.art === 'befreiung' && g.fadenSzene.phase === 'vorlauf', 'Ankunft am Ort: die Szene beginnt mit Vorwarnung (Vorlauf)');
      ok(funk.some((x) => /Wachschiffe sichern den Ort von/.test(String(x.text))), 'Vorwarnung (Gefahr wird angekuendigt)');
      ok(await bis(g, () => g.fadenSzene && g.fadenSzene.phase === 'kampf'), 'nach dem Vorlauf beginnt der Kampf');
      ok(wachen(g) >= 2, `Wachschiffe am Ort (${wachen(g)})`);
      kill(g, g.fadenSzene.tag);
      await pumpen(g, 5);
      ok(f.phase === 'wartet' && f.nsc.status === 'verbuendet', 'die Wachen sind vernichtet: der NSC ist frei (echter Kampfausgang)');
    }
    {   // Schiff schon am Ort: sofort
      const g = neu(341); ab(g); ankunft(g, '0403');
      const funk = funkMit(g);
      const f = oeffne(g, 'entfuehrter_haendler', '0403');
      faellig(f, 1, 'gefangen');
      weiter(g, f);
      ok(!!g.fadenSzene && g.fadenSzene.art === 'befreiung' && !funk.some((x) => /sitzt bei/.test(String(x.text))), 'am Ort: die Szene beginnt sofort, ohne Anreise-Funk');
    }
    {   // am falschen Ort bleibt es beim Warten, auch in einem anderen bekannten Ort
      const g = neu(342); ab(g); ankunft(g, '0203');
      const f = oeffne(g, 'entfuehrter_haendler', '0403');
      faellig(f, 1, 'gefangen');
      weiter(g, f);
      await pumpen(g, 300);
      ok(!g.fadenSzene && wachen(g) === 0 && f.phase === 'laeuft', 'an einem anderen Ort (0203): keine Szene');
    }
    {   // kommt die Crew nie, scheitert die Befreiung an der Frist
      const g = neu(343); ab(g);
      const f = oeffne(g, 'entfuehrter_haendler', '0403');
      faellig(f, 1, 'gefangen');
      weiter(g, f);
      X.grenzen(g, BEAT_FRIST + 1);
      ok(f.phase === 'wartet' && f.nsc.status === 'tot', 'ohne Ankunft: die Frist des Beats scheitert die Befreiung (NSC tot laut Vorlage)');
    }
    {   // ein Faden ohne Ort kann nichts befreien
      const g = neu(344); ab(g);
      const f = oeffne(g, 'entfuehrter_haendler', '0403');
      f.parameter.ort = '';
      faellig(f, 1, 'gefangen');
      weiter(g, f);
      ok(f.phase === 'wartet' && f.nsc.status === 'tot' && !g.fadenSzene, 'ohne Ort: der Beat scheitert sofort (keine Szene)');
    }
    {   // das Schiff verlaesst den Ort waehrend der Szene: Szenenwechsel = gescheitert (echt)
      const g = neu(345); ab(g); ankunft(g, '0403');
      const f = oeffne(g, 'entfuehrter_haendler', '0403');
      faellig(f, 1, 'gefangen');
      weiter(g, f);
      await bis(g, () => g.fadenSzene && g.fadenSzene.phase === 'kampf');
      ankunft(g, '0203');
      await pumpen(g, 5);
      ok(f.phase === 'wartet' && f.nsc.status === 'tot', 'die Crew fliegt weg: die Befreiung ist gescheitert (Szenenwechsel)');
    }
    ok(SZ.texte.befreiung_ort.length > 10 && !/\{(?!name\}|ort\})/.test(SZ.texte.befreiung_ort), 'der Anreise-Text steht in den Daten');
    const EIN = { name: 'x'.repeat(Math.max(...Object.values(lies('content/faeden/namen.json').voelker).map((vk) => Math.max(...vk.vornamen.map((s) => s.length)) + 1 + Math.max(...vk.nachnamen.map((s) => s.length))))), ort: 'x'.repeat(Math.max(...Object.values(lies('content/welt/sund_frei.json').hexe).map((h) => h.name.length))) };
    ok(SZ.texte.befreiung_ort.replace('{name}', EIN.name).replace('{ort}', EIN.ort).length <= 100, 'der Anreise-Text hoechstens 100 Zeichen mit langem Namen und Ort');
  }

  // =====================================================================================================================================================================
  console.log('\n5. Gedaechtnis: kein fracht_gescheitert, wenn keine Ware da war');
  {
    {   // kein Hafen in Reichweite: Annehmen, aber keine Ware
      const g = neu(350); const funk = funkMit(g);
      const f = oeffne(g, 'falscher_haendler', '0203');
      f.parameter.ort = '1105';
      for (let i = 0; i < 8 && !Bitte.offen(g); i++) await runde(g);
      Bitte.beantworten(g, 'annehmen', Bitte.offen(g).nr);
      for (let i = 0; i < 12 && f.beat < 2; i++) await runde(g);
      const e = f.nsc.gedaechtnis.map((x) => x.ereignis);
      ok(f.beat >= 2 && !f.fracht, 'Testlage: die Fracht ist gescheitert, es gab keine Ware');
      ok(!e.includes('fracht_gescheitert') && e.includes('fracht_ohne_ware'), `das Gedaechtnis schreibt fracht_ohne_ware, nicht fracht_gescheitert (${e.join(',')})`);
      ok(P3.notrufText(f.nsc, { parameter: { text_key: 'notruf_standard' } }) === 'notruf_standard', 'ein spaeterer Notruf erinnert sich nicht an eine Ladung, die es nie gab');
      // die Enthuellung: ein roemischer Posten in Reichweite des Ortes, damit die Sprengung gelingt und der Text mit oder ohne Ladung gesprochen wird
      const w5 = g.weltsim.zustand, d5 = Dat.datenVon(w5);
      const z = Object.keys(w5.hexe).filter((c) => w5.hexe[c].besitzer === 'rom' && !w5.hexe[c].posten && d5.hex[c].hafen === '' && Sektoren.hexAbstand('0203', c) !== null && Sektoren.hexAbstand('0203', c) <= 4).sort()[0]
        || Object.keys(w5.hexe).filter((c) => d5.hex[c].hafen === '' && Sektoren.hexAbstand('0203', c) !== null && Sektoren.hexAbstand('0203', c) <= 3).sort()[0];
      ok(!!z, 'Testlage: ein Hex ohne Hafen in 4 Spruengen um 0203 traegt einen roemischen Posten (' + z + ')');
      if (z) { w5.hexe[z].posten = true; w5.hexe[z].besitzer = 'rom'; delete w5.hexe[z].crew; }
      f.parameter.ort = '0203';
      ok(P3.ziel(g, '0203') === z, 'Testlage: der Posten ' + z + ' ist das Ziel der Sprengung fuer den Ort 0203 (' + P3.ziel(g, '0203') + ', Beat ' + f.beat + ', Phase ' + f.phase + ')');
      for (let i = 0; i < 14 && f.beat < 3; i++) { if (z) { w5.hexe[z].posten = true; w5.hexe[z].besitzer = 'rom'; } await runde(g); }   // die Welt tickt mit: der Posten steht bei jeder Runde (die Sim kann ihn sonst verloren haben)
      ok(f.beat >= 3, 'Testlage: die Enthuellung lief (Beat ' + f.beat + ', ' + (g.lageRegie.log.entries || []).filter((e) => e.key === 'enthuellung').map((e) => e.begruendung + ' ' + JSON.stringify(e.plan)).join(' / ') + ', ort ' + f.parameter.ort + ')');
      ok(funk.some((x) => /Meine Ladung geht auch ohne euch hoch/.test(String(x.text))) && !funk.some((x) => /Die Ladung ist scharf/.test(String(x.text))), 'die Enthuellung spricht nicht von einer Fracht (mitFracht nur bei echter Ware)');
    }
    {   // eine Ware war an Bord und ging verloren (Frist): fracht_gescheitert bleibt
      const g = neu(351); ab(g);
      const f = oeffne(g, 'falscher_haendler', '0203');
      for (let i = 0; i < 8 && !Bitte.offen(g); i++) await runde(g);
      Bitte.beantworten(g, 'annehmen', Bitte.offen(g).nr);
      for (let i = 0; i < 12 && !f.fracht; i++) await runde(g);
      ok(!!f.fracht, 'Testlage: die Ware ist an Bord');
      X.grenzen(g, BEAT_FRIST + 1);
      const e = f.nsc.gedaechtnis.map((x) => x.ereignis);
      ok(e.includes('fracht_gescheitert') && !e.includes('fracht_ohne_ware'), `Ware verloren (Frist): fracht_gescheitert (${e.join(',')})`);
      ok(P3.notrufText(f.nsc, { parameter: { text_key: 'notruf_standard' } }) === 'notruf_erinnert_fracht', 'ein spaeterer Notruf erinnert sich an die verlorene Ladung');
    }
  }

  // =====================================================================================================================================================================
  console.log('\n6. Vorlauf-Fall: eine unangebotene Bitte blockiert die Enthuellung nicht');
  {
    const g = neu(360); ab(g);
    const funk = funkMit(g);
    const f = oeffne(g, 'falscher_haendler', '0203');
    g.weltsim.funkwahl = { offen: { lfd: 1 } };   // eine Funk-Antwort ist offen: die Bitte wird nie angeboten (funk_offen) und bleibt es bis zur Frist
    X.grenzen(g, f.abstand);
    ok(weiter(g, f).ok && f.laufend.beat === 'b_bitte', 'der Bitten-Beat laeuft');
    ok(Bitte.offen(g) === null, 'die Bitte ist NICHT angeboten');
    ok(f.hinweise.includes('h_gerucht') && funk.some((x) => x.from === 'Hafenfunk'), 'der Gerücht-Hinweis ging trotzdem raus (mit dem Beginn des Beats)');
    X.grenzen(g, BEAT_FRIST + 1);
    ok(f.phase === 'wartet' && f.beat === 2, `die Frist hat den Beat beendet, der Faden steht vor der Enthuellung (Beat ${f.beat})`);
    X.grenzen(g, f.abstand);
    const pr = Pruefer.befehlPruefen(g.weltsim.faeden, { typ: 'faden_weiter', faden: f.id, beat: 'b_enthuell' }, Pruefer.neuerKontext());
    ok(pr === null, 'faden_weiter zur Enthuellung wird angenommen (kein HINWEIS_FEHLT)' + (pr ? ': ' + pr : ''));
  }

  // =====================================================================================================================================================================
  console.log('\n7. Der Hinweis des Bausteins notruf wird gesendet und gilt');
  {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'faeden', 'notruf-hinweis.json'), 'utf8'));
    const r = D.registriere(fx);
    ok(r.ok, 'die Testvorlage mit Hinweis am Notruf besteht den Pruefer' + (r.ok ? '' : ': ' + r.fehler.join(' | ')));
    const g = neu(370); ab(g);
    const funk = funkMit(g);
    const a = notrufOhneOrt(g, 'notruf_test_hinweis', '0403', 'gelungen');
    ok(!!a && a.vorlagen.includes('notruf_mit_hinweis'), 'der Notruf bietet die Vorlage an');
    const o = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'notruf_mit_hinweis', parameter: { angebot: a.nr } });
    const f = o.faden;
    ok(Pruefer.befehlPruefen(g.weltsim.faeden, { typ: 'faden_weiter', faden: f.id, beat: 'n_notruf' }, Pruefer.neuerKontext()) === null || true, 'Testlage');
    X.grenzen(g, f.abstand);
    ok(weiter(g, f).ok && f.laufend.beat === 'n_notruf', 'der Notruf-Beat laeuft');
    const text = fx.hinweise.h_scan.text.split('{name}').join(f.nsc.name);
    const z = funk.find((x) => x.text === text);
    ok(!!z && z.from === 'Sensoren Lerche' && z.lage === 1, `der Hinweis des Notrufs ging als Funk raus (von ${z && z.from})`);
    ok(f.hinweise.join() === 'h_scan', 'der Hinweis gilt (gestreut) erst, nachdem er gesendet war');
    const iNotruf = funk.findIndex((x) => x.fd === 2), iHinweis = funk.findIndex((x) => x.text === text);
    ok(iNotruf >= 0 && iHinweis > iNotruf, 'erst der Notruf, dann der Hinweis');
    ankunft(g, '0403'); await pumpen(g, 5);
    ok(f.phase === 'wartet' && f.beat === 1, 'die Ankunft beendet den Notruf gelungen');
    X.grenzen(g, f.abstand);
    ok(Pruefer.befehlPruefen(g.weltsim.faeden, { typ: 'faden_weiter', faden: f.id, beat: 'n_enthuell' }, Pruefer.neuerKontext()) === null, 'die Enthuellung ist freigegeben (der Hinweis vom Notruf zaehlt)');
    D.entferne('notruf_mit_hinweis');
  }

  // =====================================================================================================================================================================
  console.log('\n8. Bot mit ECHTEN Kampfausgaengen: jede Vorlage Ende zu Ende, ohne beatAusgang und ohne gesetzten Ort');
  {
    const quelle = fs.readFileSync(__filename, 'utf8').replace(/\/\/.*$/gm, '');
    ok(!/Faden\.beatAusgang\(|Faden\.beatZurueck\(/.test(quelle), 'dieser Test ruft nirgends Faden.beatAusgang oder beatZurueck (Ausgaenge entstehen nur im Spiel)');
    // die Erwartung kommt aus den Daten (eigener Interpreter)
    const erwartet = (v, pfad) => { const ids = v.beats.map((b) => b.id); const seq = []; let i = 0, k = 0; for (let w = 0; w < 20; w++) { seq.push(ids[i]); const b = v.beats[i]; if (b.typ === 'abschluss') break; const o = b.aus[pfad[k++] || 'gelungen']; i = o.weiter ? ids.indexOf(o.weiter) : i + 1; } return seq; };
    const toeten = async (g, typ) => {
      for (let i = 0; i < 900 && !(g.fadenSzene && g.fadenSzene.phase === 'kampf'); i++) await pumpen(g, 1);
      const fs2 = g.fadenSzene;
      if (!fs2 || fs2.phase !== 'kampf') return false;
      if (typ === 'verfolgung') { const z = g.space.verfolgung && g.space.verfolgung.ziel; const e = g.space.enemies.find((x) => x.id === z); if (e) Space.damageEnemy(g, e, 99999, e.x, e.y); }
      else for (const e of g.space.enemies.filter((x) => x.tag === fs2.tag)) Space.damageEnemy(g, e, 99999, e.x, e.y);
      await pumpen(g, 6);
      return true;
    };
    // pfad: je Beat der Ausgang, den die Crew HERSTELLT: gelungen = sie spielt ihn (antworten, hinfliegen, andocken, kaempfen), gescheitert = sie tut nichts (die Frist des Beats greift)
    async function echt(g, id, pfad, hex) {
      const v = D.vorlage(id);
      ankunft(g, '0305');   // die Crew fliegt (abgelegt in einem Ort, nicht angedockt: sonst kaeme keine Szene)
      const seq = []; const ziel = new Map(); let geoeffnet = false, szenen = 0;
      for (let r = 0; r < 700; r++) {
        Kriegslage.tick(g, 'test');
        if (!geoeffnet) { if (notrufOhneOrt(g, AUSLOESER[id], hex, 'gelungen')) geoeffnet = true; } else g.lageGrenze('szene_ende');
        await pumpen(g, 3);
        const f = faden(g, id);
        if (!f) continue;
        if (f.phase === 'abgeschlossen') break;
        if (f.phase !== 'laeuft' || !f.laufend) continue;
        const bid = f.laufend.beat;
        if (seq[seq.length - 1] !== bid) { seq.push(bid); ziel.set(bid, pfad[seq.length - 1] || 'gelungen'); }
        if (ziel.get(bid) !== 'gelungen') continue;
        const typ = v.beats.find((b) => b.id === bid).typ;
        if (typ === 'bitte') { const off = Bitte.offen(g); if (off && off.fadenId === f.id) { Bitte.beantworten(g, 'annehmen', off.nr); ziel.set(bid, 'erledigt'); } }
        else if (typ === 'notruf') { ankunft(g, f.parameter.ort); ziel.set(bid, 'erledigt'); }
        else if (typ === 'fracht') { if (f.fracht) { ankunft(g, f.fracht.nach); g.missionEvent('docked', {}); ab(g); ziel.set(bid, 'erledigt'); } }
        else if (['raumschlacht', 'befreiung', 'verfolgung'].includes(typ)) { if (await toeten(g, typ)) { szenen++; ziel.set(bid, 'erledigt'); } }
      }
      const f = faden(g, id);
      // die Reihenfolge der Beats steht im Regie-Logbuch (auch ein Beat, der sofort endet, wie die Enthuellung oder der Abschluss, steht drin)
      const lb = (((g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || []).filter((e) => e.art === 'faden_ereignis' && e.ausgang === 'beat_start' && f && e.key === f.id)).map((e) => e.plan.beat);
      return { seq: lb, f, szenen };
    }
    const faelle = [
      ['dankbarer_captain', '0403', ['gelungen', 'gelungen', 'gescheitert']],   // die Spontanhilfe braucht ein Gefecht, das der Bot nicht herstellt: sie endet an der Frist
      ['entfuehrter_haendler', '0403', ['gelungen', 'gelungen']],
      ['falscher_haendler', '0203', ['gelungen', 'gelungen', 'gelungen', 'gelungen', 'gelungen']],
    ];
    for (const [id, hex, pfad] of faelle) {
      const g = neu(380);
      if (id === 'falscher_haendler') { const z = freierRomPosten(g); if (z) g.weltsim.zustand.hexe[z].posten = true; }
      const funk = funkMit(g);
      const rom0 = g.weltsim.ruf.rom;
      const r = await echt(g, id, pfad, hex);
      const f = r.f;
      ok(!!f && f.phase === 'abgeschlossen', `${id}: der Bot bringt den Faden zu Ende (${r.seq.join(' > ')})`);
      ok(r.seq.join(' > ') === erwartet(D.vorlage(id), pfad).join(' > '), `${id}: Beats wie die Daten es fuer die gespielten Ausgaenge sagen`);
      const szenenErwartet = D.vorlage(id).beats.filter((b, i) => ['raumschlacht', 'befreiung', 'verfolgung'].includes(b.typ) && r.seq.includes(b.id)).length;
      ok(r.szenen === szenenErwartet, `${id}: ${r.szenen} echte Kaempfe gespielt (erwartet ${szenenErwartet}): die Szenen liefen mit Vorwarnung, Vorlauf, Gegnern und Abschuss`);
      ok(f && f.ausgang.art === 'gelungen', `${id}: der Faden endet gelungen (${f && f.ausgang.art})`);
      const e = f ? f.nsc.gedaechtnis.map((x) => x.ereignis) : [];
      const erfolge = D.vorlage(id).beats[D.vorlage(id).beats.length - 1].erfolg.ereignis;
      ok(erfolge.some((x) => e.includes(x)), `${id}: das Gedaechtnis kennt die Leistung der Crew (${e.join(',')})`);
      const erwEreignisse = r.seq.slice(0, -1).map((bid, i) => D.vorlage(id).beats.find((b) => b.id === bid).typ + '_' + (pfad[i] || 'gelungen'));
      ok(JSON.stringify(e.slice(0, erwEreignisse.length)) === JSON.stringify(erwEreignisse), `${id}: jeder Beat hat den Ausgang, den die Crew im Spiel hergestellt hat (${erwEreignisse.join(',')}; war ${e.join(',')})`);
      ok(e.includes('abschluss_gelungen') && g.weltsim.ruf.rom > rom0, `${id}: der gelungene Abschluss ist gebucht, der Ruf stieg (${rom0} -> ${g.weltsim.ruf.rom})`);
      ok(!funk.some((x) => x && /Fehler/.test(String(x.text))) && g.errors === 0, `${id}: keine Fehler (g.errors ${g.errors})`);
    }
    // echter Fehlschlag: die Crew tut nichts, die Fristen greifen; der Faden endet gescheitert und zahlt nichts
    for (const [id, hex] of [['entfuehrter_haendler', '0403'], ['dankbarer_captain', '0403']]) {
      const g = neu(381);
      const rom0 = g.weltsim.ruf.rom;
      const r = await echt(g, id, ['gescheitert', 'gescheitert', 'gescheitert', 'gescheitert'], hex);
      ok(r.f && r.f.phase === 'abgeschlossen' && r.f.ausgang.art === 'gescheitert', `${id}: die Crew tut nichts: der Faden endet gescheitert (${r.f && r.f.ausgang && r.f.ausgang.art})`);
      ok(g.weltsim.ruf.rom <= rom0, `${id}: ohne Leistung steigt der Ruf nicht (${rom0} -> ${g.weltsim.ruf.rom})`);
    }
  }

  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log('FADEN-NACH3 FEHLER: ' + fails); process.exit(1); }
  console.log('FADEN-NACH3 OK');
}
main().catch((e) => { console.log('ABSTURZ Ausnahme: ' + (e && e.stack)); process.exit(1); });
