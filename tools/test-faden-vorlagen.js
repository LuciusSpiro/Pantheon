'use strict';
// SUND-04a-2 P3: Ende-zu-Ende-Tests der drei Fadenvorlagen (Freie Fahrt Sund, FAEDEN=1) und der Bausteine notruf, enthuellung, abschluss.
// Der Bot geht den ECHTEN Weg: Notruf bewaeltigt -> Hook (Faden.ausgangMitPerson, wie reise-ereignis) -> Lage-Spielleiter (Mock) oeffnet den Faden
// und bringt ihn Beat fuer Beat weiter (faden_weiter) -> Beats laufen ueber Taetigkeiten (lageGrenze) -> Bitte (Antwort ueber faden.bitte), Szenen (Faden-Szene),
// Fracht (Andocken), Sprengung (Sim-Befehl sabotage, Vorwarnung und Vorlauf) -> Abschluss.
// Der Bot entscheidet pro Beat den Ausgang aus dem Pfad (gelungen/gescheitert), die Erwartung leitet der Test selbst aus den Daten der Vorlage ab (eigener Interpreter).
// Zwei Hilfen sind nicht vermeidbar und stehen so im Code: der Ort der Crew (ship.scene) wird fuer Ankunft und Andocken gesetzt, und der Ausgang eines
// Szenen-Beats (Kampf) wird gesetzt, wo der Bot nicht kaempft (die Mechanik der Szene ist in test-faden-szene.js geprueft). Die Frist scheitert alles, was die Crew nicht erledigt.
// Aufruf: node tools/test-faden-vorlagen.js
const fs = require('fs');
const path = require('path');
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const SZ = require('../server/sim/faden-szene.js');
const P3 = require('../server/sim/faden-p3.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Fracht = require('../server/sim/faden-fracht.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Faden = require('../server/sim/faden.js');
const { F, D } = X;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const frei = () => new Promise((r) => setImmediate(r));
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const liste = (g) => g.weltsim.faeden.liste;
const VORLAGEN = ['dankbarer_captain', 'entfuehrter_haendler', 'falscher_haendler'];
const AUSLOESER = { dankbarer_captain: 'notruf_pirat_frachter', entfuehrter_haendler: 'notruf_pirat_haendler', falscher_haendler: 'notruf_havarie_konvoi' };
const DATEI_VIERTE = path.join(__dirname, 'fixtures', 'faeden', 'vierte-geschichte.json');
async function pumpen(g, k) { for (let i = 0; i < k; i++) { g.step(); await frei(); } }
// eine Runde der Welt: ein Takt der Kriegslage (Tätigkeiten der Welt), eine Tätigkeit der Crew an der Grenze, dann der Spielleiter und die Schritte
async function runde(g, k) { for (let i = 0; i < (k || 1); i++) { Kriegslage.tick(g, 'test'); g.lageGrenze('szene_ende'); await pumpen(g, 3); } }
// die Beats eines Fadens in der Reihenfolge, in der sie liefen (aus dem Regie-Logbuch: auch ein Beat, der sofort endet, steht drin)
const logEintraege = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
function mitLage(g) {
  const llm = LLM.create({ mode: 'mock' });
  const sl = LS.create(g, { llm, werte: { min_abstand_ticks: 1, deckel_je_sitzung: 9999 } });
  g.lageSpielleiter = sl; g.lageSchalter = true;
  return sl;
}
function neu(seed) {
  const g = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } }).g;
  mitLage(g);
  return g;
}
// Funk mitschreiben (Game.emit wird nur umhüllt, nichts geht verloren)
function funkMit(g) {
  const out = []; const orig = g.emit.bind(g);
  g.emit = (...a) => { if (a[0] === 'radio' && a[1]) out.push(a[1]); return orig(...a); };
  return out;
}
const notrufOhneOrt = (g, id, hex, ausgang) => Faden.ausgangMitPerson(g, { art: 'notruf', id, hex, sprecher: '', ausgang: ausgang || 'gelungen' });
// Ort der Sektor-ID zum Hex (die Crew fliegt dorthin): Leerraum-ID, wenn der Hex kein Ort ist
const scene = (hex) => Sektoren.ortVonHex(hex) || ('leer-' + hex);

// Ein roemischer Hex ohne Hafen (die Sprengung trifft nur einen Posten): der erste nach Code, ohne Posten
const Dat = require('../server/weltsim/daten.js');
function freierRomPosten(g) { const w = g.weltsim.zustand; const d = Dat.datenVon(w); return Object.keys(w.hexe).filter((k) => w.hexe[k].besitzer === 'rom' && !w.hexe[k].posten && d.hex[k].hafen === '').sort()[0] || null; }

// Erwartung aus den Daten (eigener Interpreter, nie der Produktivcode): die Beats in der Reihenfolge, die die Ausgaenge des Pfades ergeben
function erwartet(v, pfad) {
  const ids = v.beats.map((b) => b.id); const seq = []; let i = 0, k = 0;
  for (let guard = 0; guard < 20; guard++) {
    seq.push(ids[i]);
    const b = v.beats[i];
    if (b.typ === 'abschluss') break;
    const o = b.aus[pfad[k++] || 'gelungen']; i = o.weiter ? ids.indexOf(o.weiter) : i + 1;
  }
  return seq;
}

// Ein Durchlauf des Bots: oeffnet den Faden aus einem Notruf, spielt jeden Beat mit dem Ausgang des Pfades, bis alle Faeden des Laufs abgeschlossen sind.
// o.hex: Ort des Notrufs (Ankunft und Andocken), o.ereignis: Notruf-Kennung, o.vorher(g): Vorbereitung je Runde (Testwelt), o.runden
async function lauf(g, id, pfad, o) {
  o = Object.assign({ hex: '0403', runden: 400 }, o || {});   // nicht der Ort des Schiffs (0305): dort waere der Notruf sofort bewaeltigt
  const ereignis = o.ereignis || AUSLOESER[id];
  const v = D.vorlage(id);
  const seqs = new Map(), aus = new Map(), pendAus = new Map(), abstaende = [], gesehen = new WeakSet(), beats = new Map();
  let ursache = null, geoeffnet = false, gespielt = null;
  const beende = () => { const fs = liste(g).filter((f) => f.vorlage === id); return fs.length > 0 && fs.every((f) => f.phase === 'abgeschlossen'); };
  for (let r = 0; r < o.runden; r++) {
    if (o.vorher) o.vorher(g, r);
    Kriegslage.tick(g, 'test');
    if (!geoeffnet) {
      const a = notrufOhneOrt(g, ereignis, o.hex, 'gelungen');
      if (a) { geoeffnet = true; ursache = a; }
    } else g.lageGrenze('szene_ende');
    await pumpen(g, 3);
    if (geoeffnet && !gespielt) { gespielt = liste(g).find((f) => f.vorlage === id) || null; }
    for (const f of liste(g).filter((x) => x.vorlage === id)) {
      if (f.phase === 'abgeschlossen') continue;
      if (f.phase === 'laeuft' && f.laufend && seqs.get(f.id) !== undefined && seqs.get(f.id).slice(-1)[0] !== f.laufend.beat) seqs.get(f.id).push(f.laufend.beat);
      if (f.phase === 'laeuft' && f.laufend && !(seqs.get(f.id) || []).includes(f.laufend.beat)) {
        if (!seqs.has(f.id)) seqs.set(f.id, []);
        seqs.get(f.id).push(f.laufend.beat);
        const pos = seqs.get(f.id).length - 1;
        pendAus.set(f.id, { beat: f.laufend.beat, ausgang: pfad[(aus.get(f.id) || 0)] || 'gelungen' });
        aus.set(f.id, (aus.get(f.id) || 0) + 1);
        abstaende.push(f.abstand);
        void pos;
      }
      const p = pendAus.get(f.id);
      if (!p || !f.laufend || f.laufend.beat !== p.beat) continue;
      const b = v.beats.find((x) => x.id === p.beat), typ = b.typ;
      if (typ === 'bitte') {
        const off = Bitte.offen(g);
        if (off && off.fadenId === f.id) {
          const opt = p.ausgang === 'gelungen' ? 'annehmen' : 'ablehnen';
          Bitte.beantworten(g, opt, off.nr);
          pendAus.delete(f.id);
        }
      } else if (typ === 'notruf') {
        if (p.ausgang === 'gelungen') { g.ship.scene = scene(f.parameter.ort); pendAus.delete(f.id); }
        else pendAus.delete(f.id);   // die Crew kommt nicht: die Frist scheitert den Beat
      } else if (typ === 'fracht') {
        if (p.ausgang === 'gelungen' && f.fracht) { g.ship.scene = scene(f.fracht.nach); SZ.andockenHook(g); }
        pendAus.delete(f.id);
      } else if (['raumschlacht', 'befreiung', 'verfolgung', 'spontanhilfe'].includes(typ)) {
        if (p.ausgang === 'gelungen') Faden.beatAusgang(g, f.id, 'gelungen');
        pendAus.delete(f.id);
      } else pendAus.delete(f.id);
    }
    for (const e of logEintraege(g)) if (!gesehen.has(e)) { gesehen.add(e); if (e.art === 'faden_ereignis' && e.ausgang === 'beat_start') { if (!beats.has(e.key)) beats.set(e.key, []); beats.get(e.key).push(e.plan.beat); } }
    if (beende()) break;
  }
  return { ursache, faeden: liste(g).filter((f) => f.vorlage === id), seqs: beats, abstaende };
}

async function main() {
  console.log('Daten und Pruefer');
  for (const id of VORLAGEN) {
    const r = Pruefer.pruefeVorlage(require('../content/faeden/vorlagen/' + id + '.json'));
    ok(r.ok, `Vorlage ${id} besteht den Pruefer` + (r.ok ? '' : ': ' + r.fehler.join(' | ')));
    ok(D.vorlage(id) !== null, `Vorlage ${id} ist ueber das Register geladen (keine Zeile Code)`);
  }
  ok(VORLAGEN.every((id) => D.vorlage(id).ausloeser.every((a) => a.ereignis && a.ereignis.length)), 'jede Vorlage nennt ihre Ausloeser-Kennungen (Daten)');

  console.log('\nAusloeser: welcher Notruf oeffnet welche Vorlage');
  {
    // je Notruf eine eigene Partie (die Obergrenze fuer Angebote liegt bei zwei, ein Angebot je Notruf genuegt)
    const kennung = { notruf_pirat_frachter: ['dankbarer_captain'], notruf_havarie_reaktor: ['dankbarer_captain'], notruf_pirat_haendler: ['entfuehrter_haendler'], notruf_havarie_konvoi: ['falscher_haendler'] };
    for (const [ev, erwartet2] of Object.entries(kennung)) {
      const a = notrufOhneOrt(neu(3), ev, '0305', 'gelungen');
      ok(a && JSON.stringify(a.vorlagen.slice().sort()) === JSON.stringify(erwartet2.slice().sort()), `Notruf ${ev} bietet ${erwartet2.join(', ')} an`);
    }
    ok(notrufOhneOrt(neu(3), 'notruf_belagerung_posten', '0203', 'gelungen') === null, 'ein Notruf ohne Zuordnung (belagerung_posten) oeffnet keinen Faden');
  }

  console.log('\nEnde zu Ende: jede Vorlage per Bot, Pfad „alles gelungen“');
  for (const id of VORLAGEN) {
    const g = neu(11);
    const funk = funkMit(g);
    const v = D.vorlage(id);
    const pfad = v.beats.filter((b) => b.typ !== 'abschluss').map(() => 'gelungen');
    const welt = g.weltsim.zustand;
    const r = await lauf(g, id, pfad, { hex: id === 'falscher_haendler' ? '0203' : '0403' });
    const f = r.faeden[0];
    ok(r.faeden.length === 1, `${id}: genau ein Faden geoeffnet (${r.faeden.length})`);
    ok(f && f.phase === 'abgeschlossen' && f.ausgang && f.ausgang.art === 'gelungen', `${id}: der Faden endet im Abschluss (gelungen)`);
    const gespielt = (r.seqs.get(f && f.id) || []).join(' > ');
    ok(gespielt === erwartet(v, pfad).join(' > '), `${id}: Beats in der Reihenfolge der Daten (${gespielt})`);
    ok(r.abstaende.length > 0 && r.abstaende.every((a) => a >= 2 && a <= 4), `${id}: Abstand zwischen den Beats 2 bis 4 Taetigkeiten (${r.abstaende.join(',')})`);
    ok(f && f.nsc.gedaechtnis.length >= 1, `${id}: der NSC hat sein Gedaechtnis gefuellt (${f ? f.nsc.gedaechtnis.length : 0} Eintraege)`);
    ok(funk.some((x) => x && x.from), `${id}: die Funkzeilen liefen (${funk.length})`);
    ok(!funk.some((x) => x && /Fehler/.test(String(x.text))), `${id}: kein Fehlertext im Funk`);
    if (id === 'falscher_haendler') {
      const lb = ((g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || []).filter((e) => e.key === 'sabotage' || e.art === 'faden_baustein').map((e) => e.ausgang + ':' + (e.begruendung || '')).join(' | ');
      // Ziel: der Posten, den die Enthuellung gewaehlt hat (Logbuch des Bausteins, plan.ziel). Die Sprengung wirkt erst nach dem Vorlauf: die Welt laeuft weiter, bis sie greift (hoechstens 40 Ticks)
      const bs = ((g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || []).find((e) => e.art === 'faden_baustein' && e.plan && e.plan.beat === 'b_enthuell');
      const ziel = bs && bs.plan.ziel;
      const hält = () => !!ziel && g.weltsim.zustand.hexe[ziel].posten && g.weltsim.zustand.hexe[ziel].besitzer === 'rom';
      for (let i = 0; i < 40 && hält(); i++) { Kriegslage.tick(g, 'test'); await pumpen(g, 1); }
      const verloren = ziel && !hält() ? [ziel] : [];
      ok(verloren.length === 1 && g.weltsim.zustand.hexe[verloren[0]].besitzer !== 'rom', `falscher Haendler: die Sprengung hat genau einen roemischen Posten vernichtet (Sim-Befehl sabotage, nach der Vorwarnung) [verloren ${verloren.join(',')}, Logbuch: ${lb}]`);
      ok(f.nsc.wahrheit && f.nsc.wahrheit.offenbart === true, 'falscher Haendler: die Wahrheit ist enthuellt');
    }
  }

  console.log('\nScheitern: jeder Beat einmal gescheitert, der Faden veraendert sich und endet nicht vor dem Abschluss');
  for (const id of VORLAGEN) {
    const g = neu(21);
    const v = D.vorlage(id);
    const pfad = v.beats.filter((b) => b.typ !== 'abschluss').map(() => 'gescheitert');
    if (id === 'falscher_haendler') { const ziel = freierRomPosten(g); if (ziel) g.weltsim.zustand.hexe[ziel].posten = true; }
    const r = await lauf(g, id, pfad, { hex: id === 'falscher_haendler' ? '0203' : '0403' });
    const f = r.faeden[0];
    ok(f && f.phase === 'abgeschlossen' && f.ausgang && f.ausgang.art === 'gelungen', `${id} im Scheitern: der Faden kommt bis zum Abschluss, nichts blockiert`);
    const gespielt = (r.seqs.get(f && f.id) || []).join(' > ');
    const prot = ((g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || []).filter((e) => e.art === 'faden_ereignis').map((e) => e.ausgang + ':' + (e.begruendung || '')).join(' | ');
    ok(gespielt === erwartet(v, pfad).join(' > '), `${id} im Scheitern: der Weg ueber die gescheiterten Ausgaenge (${gespielt}) [${prot.slice(0, 500)}]`);
    ok(f && f.nsc.status !== undefined && f.nsc.status !== 'gelungen', `${id} im Scheitern: der NSC steht in einem anderen Zustand (${f ? f.nsc.status : '?'})`);
  }

  console.log('\nBitten-Ton und Gedaechtnis des NSC (tonVon, erinnert)');
  {
    // ein Notruf, bei dem der NSC eine abgelehnte Bitte im Gedaechtnis hat: der Notruf erinnert sich
    const { D: DD } = X;
    DD.registriere(JSON.parse(fs.readFileSync(DATEI_VIERTE, 'utf8')));
    const g = neu(31);
    const funk = funkMit(g);
    const r = await lauf(g, 'vierte_geschichte', ['gescheitert', 'gelungen'], { ereignis: 'notruf_belagerung_hafen', hex: '0403' });
    const f = r.faeden[0];
    ok(f && f.nsc.gedaechtnis.some((x) => x.ereignis === 'bitte_gescheitert'), 'das Gedaechtnis hat die abgelehnte Bitte (bitte_gescheitert)');
    ok(funk.some((x) => typeof x.text === 'string' && x.text.includes('Ihr habt mich damals abgewiesen')), 'der Notruf erinnert sich an die Ablehnung (Text erinnert) [Funk: ' + funk.map((x) => x.text).join(' || ').slice(0, 400) + ']');
    ok(Faden.tonVon({ haltung: -8 }) === 'kalt' && Faden.tonVon({ haltung: 0 }) === 'sachlich' && Faden.tonVon({ haltung: 5 }) === 'herzlich', 'tonVon: kalt, sachlich, herzlich nach Haltung');
  }
  {
    // der Ton der Bitte folgt der Haltung: ein kalter NSC bittet kalt
    const g = neu(41);
    const funk = funkMit(g);
    const a = notrufOhneOrt(g, 'notruf_pirat_frachter', '0305', 'gelungen');
    Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'dankbarer_captain', parameter: { angebot: a.nr } });
    await pumpen(g, 3);
    const f = liste(g).find((x) => x.vorlage === 'dankbarer_captain');
    for (let i = 0; i < 3; i++) Faden.haltungBuchen(g, [{ typ: 'haltung_aenderung', npc: f.nsc.id, delta: -3, grund: 'verraten' }]);
    ok(Faden.haltungVon(f.nsc) <= -6, `Haltung nach dreimal verraten: ${Faden.haltungVon(f.nsc)} (kalt, feindlich unter -6)`);
    // der Beat laeuft erst nach dem Abstand: Tätigkeiten, bis die Bitte da ist
    for (let i = 0; i < 6 && !Bitte.offen(g); i++) { await runde(g); }
    ok(!!(Bitte.offen(g) && Bitte.offen(g).text.includes('Ihr habt lange gebraucht')), 'kalter NSC: die Bitte nimmt den kalten Ton');
  }

  console.log('\nFeindlich wiederkehrender NSC: die Variante des Beats (Gegner statt Hilfe)');
  {
    const g = neu(51);
    const a = notrufOhneOrt(g, 'notruf_pirat_frachter', '0305', 'gelungen');
    Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'dankbarer_captain', parameter: { angebot: a.nr } });
    await pumpen(g, 3);
    const f = liste(g).find((x) => x.vorlage === 'dankbarer_captain');
    // der Captain ist feindlich geworden: Haltung unter -6 (drei Verratsbuchungen), dann beginnt der Beat „spontan“ als Gegner
    for (let i = 0; i < 3; i++) Faden.haltungBuchen(g, [{ typ: 'haltung_aenderung', npc: f.nsc.id, delta: -3, grund: 'verraten' }]);
    f.beat = 2; f.phase = 'wartet'; f.zaehler = f.abstand; f.laufend = null;   // der Faden ist am Beat „spontan“ (die Bitte und die Mission sind vorbei)
    const r = Pruefer.effektiv(D.vorlage('dankbarer_captain').beats[2], f.nsc.haltung, f.nsc.status);
    ok(r.variante === true && r.cat.baustein === 'raumschlacht', 'Haltung unter -6: der Beat laeuft als Raumschlacht (Variante), nicht als Hilfe');
    const pruef = Pruefer.befehlPruefen(g.weltsim.faeden, { typ: 'faden_weiter', faden: f.id, beat: 'b_spontan' }, Pruefer.neuerKontext());
    ok(pruef === null, 'faden_weiter fuer den Beat spontan wird bei feindlichem NSC angenommen (Status feindlich)');
  }

  console.log('\nSprengung ohne Ziel: keine Sprengung, der Faden aendert sich (Funk und Logbuch)');
  {
    const g = neu(61);
    const a = notrufOhneOrt(g, 'notruf_havarie_konvoi', '0305', 'gelungen');
    Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'falscher_haendler', parameter: { angebot: a.nr } });
    await pumpen(g, 3);
    const welt = g.weltsim.zustand;
    for (const k of Object.keys(g.weltsim.zustand.hexe)) if (g.weltsim.zustand.hexe[k].posten && g.weltsim.zustand.hexe[k].besitzer === 'rom') { g.weltsim.zustand.hexe[k].posten = false; g.weltsim.zustand.hexe[k].besitzer = 'ger'; }
    const f = liste(g).find((x) => x.vorlage === 'falscher_haendler');
    f.hinweise = ['h_gerucht', 'h_papiere'];   // Testwelt: die Hinweise sind schon gestreut (ihr Weg ist eigens geprueft)
    f.beat = 2; f.phase = 'wartet'; f.zaehler = f.abstand;   // b_enthuell
    const e = Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_enthuell' });
    ok(e.ok === true, 'die Enthuellung startet (faden_weiter angenommen)');
    ok(f.nsc.status === 'geflohen' && f.beat === 3, `ohne roemischen Posten in Reichweite: gescheitert, der NSC ist geflohen, der Faden geht den anderen Weg (${f.nsc.status}, Beat ${f.beat})`);
    ok(require('../server/sim/regie-befehle.js').fadenSabotage(g, '0305').ok === false, 'die Sprengung wird ohne gueltiges Ziel abgelehnt');
  }

  console.log('\nSpeichern und Laden mitten im Faden');
  {
    // Bitte offen (vor dem Speichern): die Bitte ueberlebt; danach die Mission (Szene) mitten im Lauf: sie steht nach dem Laden wieder aus
    const g = neu(71);
    const a = notrufOhneOrt(g, 'notruf_pirat_frachter', '0305', 'gelungen');
    Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'dankbarer_captain', parameter: { angebot: a.nr } });
    await pumpen(g, 3);
    const f = liste(g).find((x) => x.vorlage === 'dankbarer_captain');
    for (let i = 0; i < 8 && !Bitte.offen(g); i++) { await runde(g); }
    const off = Bitte.offen(g);
    ok(!!off, 'eine Bitte ist offen (vor dem Speichern)');
    const blk = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim)));
    const F2 = Faden.lesen(blk);
    ok(F2.liste.length === 1 && F2.liste[0].id === f.id && F2.ladeFehler.length === 0, 'der Faden ueberlebt Speichern und Laden (Weltstand validiert)');
    ok(!!(blk.bitte && blk.bitte.faden === f.id && blk.bitte.beat === 'b_bitte'), 'die offene Bitte steht im Weltstand');
    ok(!!(F2.bitte && F2.bitte.fadenId === f.id && F2.bitte.optionen.length >= 2), 'die offene Bitte ueberlebt das Laden (Folgen aus der Vorlage)');
    // die Mission (Szene, raumschlacht) laeuft: Bitte annehmen, dann laeuft der Beat, bis die Szene steht
    Bitte.beantworten(g, 'annehmen', off.nr);
    let laeuft = null;
    for (let i = 0; i < 60 && !laeuft; i++) {
      await runde(g);
      const x = liste(g).find((y) => y.id === f.id);
      if (x && x.phase === 'laeuft' && x.laufend && x.laufend.beat === 'b_mission') laeuft = x;
    }
    ok(!!laeuft, 'die Mission (Szene) laeuft');
    if (laeuft) {
      const blk2 = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim)));
      const F3 = Faden.lesen(blk2);
      const f3 = F3.liste[0];
      ok(f3 && f3.phase === 'wartet' && f3.laufend === null && f3.beat === 1, `eine laufende Szene steht nach dem Laden wieder aus (${f3 && f3.phase}, Beat ${f3 && f3.beat})`);
      ok(f3 && f3.nsc.name === f.nsc.name && f3.nsc.gedaechtnis.length === f.nsc.gedaechtnis.length, 'NSC und Gedaechtnis bleiben beim Laden erhalten');
    }
  }

  console.log('\nAusfall des Spielleiters: begonnene Faeden stehen, ohne Fehler, die Welt laeuft');
  {
    const g = neu(81);
    const a = notrufOhneOrt(g, 'notruf_pirat_frachter', '0305', 'gelungen');
    Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'dankbarer_captain', parameter: { angebot: a.nr } });
    await pumpen(g, 3);
    const f = liste(g).find((x) => x.vorlage === 'dankbarer_captain');
    g.lageSpielleiter.dispose();
    for (let i = 0; i < 12; i++) { Kriegslage.tick(g, 'test'); await runde(g, 2); }
    ok(f.phase !== 'abgeschlossen' && f.ausgang === null, `ohne Spielleiter bleibt der Faden offen (${f.phase})`);
    ok(f.nsc.gedaechtnis.length === 0, 'die Frist eines laufenden Beats laeuft nicht ab, solange der Spielleiter fehlt (kein Ausgang gebucht)');
    ok(!(g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries || []).some((e) => e.ausgang === 'baustein_fehler' || e.ausgang === 'frist'), 'keine Fehler und keine Frist im Lauf');
  }

  console.log('\nObergrenze: hoechstens drei aktive Faeden, ein vierter Befehl wird abgelehnt');
  {
    const g = neu(91);
    const ids = [['notruf_pirat_frachter', '0305'], ['notruf_pirat_haendler', '0203'], ['notruf_havarie_konvoi', '0304']];
    for (const [ev, hex] of ids) {
      const a = notrufOhneOrt(g, ev, hex, 'gelungen');
      if (a) Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: a.vorlagen[0], parameter: { angebot: a.nr } });
      await pumpen(g, 2);
    }
    const aktive = liste(g).filter((f) => f.phase !== 'abgeschlossen').length;
    ok(aktive === 3, `drei aktive Faeden (${aktive})`);
    const a4 = notrufOhneOrt(g, 'notruf_pirat_frachter', '0304', 'gelungen');
    ok(a4 === null, 'bei drei aktiven Faeden entsteht kein Angebot fuer einen vierten (Obergrenze)');
  }

  console.log('\nVierte Vorlage, nur in Daten (Abnahme 14a): laeuft ohne Codeaenderung');
  {
    const g = neu(101);
    const r = await lauf(g, 'vierte_geschichte', ['gelungen', 'gelungen'], { ereignis: 'notruf_belagerung_hafen', hex: '0403' });   // ein Ereignis, das nur die vierte Vorlage (ohne Einschraenkung) oeffnet
    const f = r.faeden[0];
    if (!f) console.log('  (Diagnose: Angebote ' + JSON.stringify(g.weltsim.faeden.angebote.map((a) => a.vorlagen)) + ', Faeden ' + liste(g).length + ', Logbuch ' + ((g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || []).slice(-3).map((e) => e.art + '/' + e.ausgang + ' ' + JSON.stringify(e.fehler || '')).join(' ; ') + ')');
    ok(!!f && f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'die vierte Vorlage laeuft per Bot bis zum Abschluss');
    ok(!!f && (r.seqs.get(f.id) || []).join(' > ') === 'v_bitte > v_notruf > v_abschluss', 'ihre Beats in der Reihenfolge der Daten');
  }

  console.log('\nWarteschlange der Spontanhilfe: eine zweite Hilfe wartet, statt zu scheitern, und rueckt nach');
  {
    // Zwei Faeden stehen am Beat „spontan“ (Testzustand: die Beats laufen, der Bot spielt sie nicht); die Hilfe des ersten Fadens laeuft, der zweite wartet
    const g = neu(111);
    const a1 = notrufOhneOrt(g, 'notruf_pirat_frachter', '0403', 'gelungen');
    Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'dankbarer_captain', parameter: { angebot: a1.nr } });
    const a2 = notrufOhneOrt(g, 'notruf_havarie_reaktor', '0203', 'gelungen');
    Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'dankbarer_captain', parameter: { angebot: a2.nr } });
    const [f1, f2] = liste(g);
    for (const f of [f1, f2]) { f.beat = 2; f.phase = 'laeuft'; f.zaehler = 0; f.laufend = { beat: 'b_spontan', n: 0, seit: 0 }; }   // Testzustand: der Beat „spontan“ laeuft
    const r1 = SZ.starten(g, { art: 'spontanhilfe', fadenId: f1.id, beatId: 'b_spontan', nsc: f1.nsc });
    ok(r1.ok && r1.grund === null && g.fadenHilfe && g.fadenHilfe.fadenId === f1.id, 'die erste Spontanhilfe laeuft');
    const r2 = SZ.starten(g, { art: 'spontanhilfe', fadenId: f2.id, beatId: 'b_spontan', nsc: f2.nsc });
    ok(r2.ok && r2.grund === 'WARTET' && (g.fadenHilfeWarte || []).length === 1, 'die zweite Spontanhilfe wartet in der Schlange (kein Scheitern: HILFE_LAEUFT entfaellt)');
    Faden.beatAusgang(g, f1.id, 'gelungen');
    SZ.update(g);
    ok(!!g.fadenHilfe && g.fadenHilfe.fadenId === f2.id, 'nach dem Ende der ersten Hilfe rueckt die zweite nach');
    ok((g.fadenHilfeWarte || []).length === 0, 'die Schlange ist leer');
  }

  console.log('\nSprengung (Nacharbeit L12): Ziel ohne Crew-Posten, Reichweite, Hex-Abstand, Entwarnung, Sperre im Plan, Leser');
  {
    const Regie = require('../server/sim/regie-befehle.js');
    const LP = require('../server/sim/lage-prompt.js');
    const LB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'flotte', 'lage-befehle.json'), 'utf8'));
    const REICH = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'p3-texte.json'), 'utf8')).werte.sprengung_reichweite.wert;
    // eigene Breitensuche (Spruenge ueber die Nachbarn des Rasters), unabhaengig vom Produktivcode
    const bfs = (a) => { const d = { [a]: 0 }; const q = [a]; while (q.length) { const h = q.shift(); for (const m of Sektoren.nachbarn(h)) if (d[m] === undefined) { d[m] = d[h] + 1; q.push(m); } } return d; };
    const raster = []; for (let c = 1; c <= Sektoren.KARTE.spalten; c++) for (let r = 1; r <= Sektoren.KARTE.zeilen; r++) raster.push(String(c).padStart(2, '0') + String(r).padStart(2, '0'));
    const hexe = (g) => g.weltsim.zustand.hexe;
    const ohnePosten = (g) => { for (const k of Object.keys(hexe(g))) if (hexe(g)[k].posten) { hexe(g)[k].posten = false; delete hexe(g)[k].crew; } };
    const setze = (g, code, crew) => { const nd = hexe(g)[code]; nd.besitzer = 'rom'; nd.posten = true; if (crew) nd.crew = true; else delete nd.crew; };
    const frei = (g) => Object.keys(hexe(g)).filter((c) => Dat.datenVon(g.weltsim.zustand).hex[c].hafen === '').sort();   // Hexe ohne Hafen: dort kann ein Posten liegen
    const erwartet = (g, ort) => { const d = bfs(ort); let best = null, bd = Infinity; for (const c of Object.keys(hexe(g)).sort()) { const nd = hexe(g)[c]; if (!nd.posten || nd.besitzer !== 'rom' || nd.crew === true || d[c] === undefined || d[c] > REICH) continue; if (d[c] < bd) { best = c; bd = d[c]; } } return best; };

    {   // die ganze Karte: fuer jeden Ort des Rasters stimmt das Ziel mit der eigenen Rechnung ueberein (Posten Roms und der Crew gemischt)
      const g = neu(131);
      ohnePosten(g);
      frei(g).forEach((c, i) => setze(g, c, i % 3 === 0));
      let falsch = 0, treffer = 0;
      for (const o of raster) { const e = erwartet(g, o), z = P3.ziel(g, o); if (e !== z) falsch++; if (z) treffer++; }
      ok(raster.length > 60 && treffer > 20 && falsch === 0, 'Ziel der Sprengung fuer jeden Ort des Rasters wie die eigene Rechnung (' + raster.length + ' Orte, ' + treffer + ' mit Ziel, ' + falsch + ' abweichend)');
    }
    {   // kein Posten der Crew als Ziel
      const g = neu(132);
      ohnePosten(g);
      const P = '0603', Q = '0605';
      const dp = bfs(P), dq = bfs(Q);
      const ort = raster.filter((c) => dp[c] === 1 && dq[c] > 1).sort()[0];
      ok(!!ort, 'Testwelt: ein Ort neben dem Posten ' + P + ', weiter weg vom Posten ' + Q + ' (' + ort + ')');
      setze(g, P, true); setze(g, Q, false);
      ok(P3.ziel(g, ort) === Q, 'der naehere Posten gehoert der Crew: nicht das Ziel, der Posten Roms dahinter ist es (' + P3.ziel(g, ort) + ')');
      hexe(g)[Q].posten = false;
      ok(P3.ziel(g, ort) === null, 'nur der Posten der Crew in Reichweite: kein Ziel');
      const funk = funkMit(g);
      const r = Regie.fadenSabotage(g, P);
      ok(r.ok === false && /Crew/.test(r.grund || ''), 'auch der Kern-Pruefer lehnt einen Posten der Crew ab (' + r.grund + ')');
      ok(g.weltsim.regie.vorgemerkt.length === 0 && funk.length === 0, 'nichts vorgemerkt, keine Vorwarnung');
    }
    {   // Reichweite (Hex-Abstand): genau REICH ist ein Ziel, REICH + 1 nicht
      const g = neu(133);
      ohnePosten(g);
      const P = '0603';
      const d = bfs(P);
      const gerade = raster.filter((c) => d[c] === REICH).sort()[0], zuweit = raster.filter((c) => d[c] === REICH + 1).sort()[0];
      ok(!!gerade && !!zuweit, 'Testwelt: Orte im Abstand ' + REICH + ' (' + gerade + ') und ' + (REICH + 1) + ' (' + zuweit + ') vom Posten ' + P);
      setze(g, P, false);
      ok(P3.ziel(g, zuweit) === null, 'ein Posten im Abstand ' + (REICH + 1) + ': ausserhalb der Reichweite, kein Ziel');
      ok(P3.ziel(g, gerade) === P, 'ein Posten im Abstand ' + REICH + ': Ziel');
    }
    {   // Hex-Abstand statt Luftlinie ueber Spalten und Zeilen: bei gleichem Hex-Abstand gewinnt der kleinere Code, nicht die kuerzere Luftlinie
      const g = neu(134);
      ohnePosten(g);
      const teile = (h) => ({ c: Number(h.slice(0, 2)), r: Number(h.slice(2)) });
      let paar = null;
      for (const ort of raster) {
        const d = bfs(ort), luft = (h) => Math.hypot(teile(h).c - teile(ort).c, teile(h).r - teile(ort).r);
        const ks = Object.keys(hexe(g)).sort().filter((c) => d[c] >= 1 && d[c] <= REICH);
        for (const a of ks) for (const b of ks) if (!paar && d[a] === d[b] && b < a && luft(a) < luft(b)) paar = { ort, a, b };
      }
      ok(!!paar, 'Testwelt: zwei Posten im gleichen Hex-Abstand, der mit dem groesseren Code hat die kuerzere Luftlinie (Ort ' + (paar && paar.ort) + ': ' + (paar && paar.a) + ' und ' + (paar && paar.b) + ')');
      if (paar) { setze(g, paar.a, false); setze(g, paar.b, false); ok(P3.ziel(g, paar.ort) === paar.b, 'gleicher Hex-Abstand: der kleinere Code gewinnt (' + P3.ziel(g, paar.ort) + '), nicht die kuerzere Luftlinie (' + paar.a + ')'); }
    }
    {   // kein Ziel in der Enthuellung (nur Posten der Crew): der Beat scheitert mit Funk
      const g = neu(135);
      ohnePosten(g);
      for (const c of frei(g)) setze(g, c, true);
      const funk = funkMit(g);
      const a = notrufOhneOrt(g, 'notruf_havarie_konvoi', '0305', 'gelungen');
      Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'falscher_haendler', parameter: { angebot: a.nr } });
      const f = liste(g).find((x) => x.vorlage === 'falscher_haendler');
      f.hinweise = ['h_gerucht', 'h_papiere']; f.beat = 2; f.phase = 'wartet'; f.zaehler = f.abstand;
      ok(Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_enthuell' }).ok && f.nsc.status === 'geflohen' && f.beat === 3, 'nur Posten der Crew: die Enthuellung scheitert (der NSC flieht, der Faden geht den anderen Weg)');
      ok(funk.some((x) => /zündet nicht/.test(String(x.text))) && g.weltsim.regie.vorgemerkt.length === 0, 'Funk: die Sprengladung zuendet nicht; nichts vorgemerkt');
    }
    // Entwarnung: die angekuendigte Sprengung kommt nicht
    const eintrag = LB.entwarnung.sabotage;
    const ewText = (z) => eintrag.text.replace('{ziel}', Sektoren.hexName(z) || z);
    const mitPosten = (seed) => { const g = neu(seed); ohnePosten(g); setze(g, '0603', false); return { g, p: '0603' }; };
    {
      const { g, p } = mitPosten(136);
      const funk = funkMit(g);
      const r = Regie.fadenSabotage(g, p);
      ok(r.ok === true && funk.length === 1 && /Sprengladung/.test(funk[0].text) && !/Entwarnung/.test(funk[0].text), 'Vorwarnung der Sprengung (Aufklaerung)');
      Regie.rueckfall(g, 'Ausfall des Spielleiters');
      const ew = funk.slice(1).find((x) => /Entwarnung/.test(String(x.text)));
      ok(!!ew && ew.text === ewText(p) && ew.from === eintrag.sprecher, 'Ausfall des Spielleiters: die verworfene Sprengung bekommt ihre Entwarnung (Text aus den Daten): ' + (ew && ew.text));
      ok(g.weltsim.regie.vorgemerkt.length === 0, 'die Sprengung ist verworfen');
    }
    {
      const { g, p } = mitPosten(137);
      const funk = funkMit(g);
      ok(Regie.fadenSabotage(g, p).ok, 'Sprengung vorgemerkt');
      hexe(g)[p].besitzer = 'ger';   // der Posten faellt vor dem Tick anderweitig
      for (let i = 0; i < 4; i++) Kriegslage.tick(g, 'test');
      const ew = funk.find((x) => /Entwarnung/.test(String(x.text)));
      ok(!!ew && ew.text === ewText(p), 'im Tick abgelehnt (Posten gehoert nicht mehr Rom): Entwarnung (' + (ew && ew.text) + ')');
      ok(g.weltsim.regie.vorgemerkt.length === 0, 'nichts mehr vorgemerkt');
    }
    {   // die Sprengung steht nie im Plan des Spielleiters
      const { g, p } = mitPosten(138);
      const r = Regie.planAnwenden(g, { befehle: [{ typ: 'sabotage', ort: p }], begruendung: 'Probe' });
      ok(r.angenommen.length === 0 && r.abgelehnt.length === 1 && /nur aus einer Enthüllung/.test(r.abgelehnt[0].grund), 'Plan mit sabotage: abgelehnt (' + (r.abgelehnt[0] && r.abgelehnt[0].grund) + ')');
      ok(g.weltsim.regie.vorgemerkt.length === 0, 'nichts vorgemerkt, keine Rate verbraucht (' + g.weltsim.regie.rate.length + ')');
      ok(!/sabotage/i.test(LP.katalogText()), 'der Katalogtext des Spielleiters kennt die Sprengung nicht');
    }
    {   // Leser: die Sprengung wird nie ueber vorgemerkt_max abgeschnitten
      const max = Regie.R.plan.wert.vorgemerkt_max;
      const eins = (typ, i) => Object.assign({ b: typ === 'sabotage' ? { typ, ort: '0603' } : { typ: 'verstaerken', fraktion: 'rom', ort: '0302', menge: i }, ab: 5 + i }, typ === 'sabotage' ? { w: 1 } : {});
      const normal = Array.from({ length: max + 3 }, (_, i) => eins('verstaerken', i));
      const L1 = Regie.lesen({ vorgemerkt: normal.concat([eins('sabotage', 0)]) }, 4).vorgemerkt;
      ok(L1.filter((e) => e.b.typ !== 'sabotage').length === max && L1.filter((e) => e.b.typ === 'sabotage').length === 1, 'Leser: ' + max + ' normale Befehle und die Sprengung dahinter bleiben (' + L1.length + ' Eintraege)');
      const L2 = Regie.lesen({ vorgemerkt: Array.from({ length: max + 4 }, (_, i) => eins('sabotage', i)) }, 4).vorgemerkt;
      ok(L2.length === max && L2.every((e) => e.b.typ === 'sabotage'), 'Leser: auch die Sprengungen haben eine Obergrenze (' + L2.length + ')');
    }
  }

  console.log('\nNotruf-Beat: mehrere Notrufe gleichzeitig, Speichern und Laden mitten im Notruf');
  {
    const v = D.vorlage('entfuehrter_haendler');
    const nb = v.beats[0];
    ok(nb.typ === 'notruf', 'Vorlage: der erste Beat ist der Notruf');
    const naechster = v.beats.findIndex((b) => b.id === nb.aus.gelungen.weiter);   // Erwartung aus den Daten: wohin ein gelungener Notruf fuehrt
    const oeffneNotruf = (g, hex) => { const a = notrufOhneOrt(g, 'notruf_pirat_haendler', hex, 'gelungen'); const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'entfuehrter_haendler', parameter: { angebot: a.nr } }); return r.faden; };
    const starte = (g, f) => { X.grenzen(g, f.abstand, 'andocken'); return Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: nb.id }); };
    {   // zwei Notrufe zugleich (je Faden), jeder endet an seinem Ort
      const g = neu(121);
      const f1 = oeffneNotruf(g, '0403'), f2 = oeffneNotruf(g, '0203');
      ok(!!f1 && !!f2 && f1.id !== f2.id, 'zwei Faeden mit je eigenem Notruf-Ort');
      ok(starte(g, f1).ok && starte(g, f2).ok && f1.phase === 'laeuft' && f2.phase === 'laeuft', 'beide Notruf-Beats laufen gleichzeitig');
      g.ship.scene = scene('0403'); P3.update(g);
      ok(f1.phase === 'wartet' && f1.beat === naechster && f2.phase === 'laeuft', 'Ankunft am ersten Ort: nur der erste Notruf gelingt, der zweite laeuft weiter (kein Platz, der ueberschrieben wird)');
      g.ship.scene = scene('0203'); P3.update(g);
      ok(f2.phase === 'wartet' && f2.beat === naechster, 'Ankunft am zweiten Ort: auch der zweite Notruf gelingt');
      ok(!('fadenNotruf' in g), 'kein eigener Laufzeitzustand neben dem Faden');
      // ein Faden, dessen laufender Beat nicht zum Beat der Vorlage passt (kaputter Stand): kein Notruf, keine Ankunft zaehlt
      const g5 = neu(123); const f5 = oeffneNotruf(g5, '0403'); starte(g5, f5); f5.laufend.beat = 'b_fremd';
      g5.ship.scene = scene('0403'); P3.update(g5);
      ok(f5.phase === 'laeuft' && f5.laufend.beat === 'b_fremd', 'laufender Beat passt nicht zur Vorlage: die Ankunft laesst nichts gelingen');
    }
    {   // Speichern und Laden mitten im Notruf-Beat
      const g = neu(122);
      const f = oeffneNotruf(g, '0403');
      ok(starte(g, f).ok && f.phase === 'laeuft', 'der Notruf-Beat laeuft');
      X.grenzen(g, 2, 'andocken');
      const blk = JSON.parse(JSON.stringify(Faden.toSave(g.weltsim)));
      const F2 = Faden.lesen(blk);
      const f2 = F2.liste[0];
      ok(f2.phase === 'laeuft' && f2.laufend && f2.laufend.beat === nb.id && f2.laufend.n === f.laufend.n, 'nach dem Laden laeuft der Notruf-Beat weiter (Beat und Fristzaehler bleiben)');
      g.weltsim.faeden = F2;   // der geladene Stand ersetzt den laufenden
      g.ship.scene = scene('0403'); P3.update(g);
      ok(f2.phase === 'wartet' && f2.beat === naechster && f2.nsc.gedaechtnis.some((x) => x.ereignis === 'notruf_gelungen'), 'nach dem Laden: die Ankunft am Ort laesst den Notruf gelingen (nicht an der Frist gescheitert)');
    }
  }

  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log('FADEN-VORLAGEN FEHLER: ' + fails); process.exit(1); }
  console.log('FADEN-VORLAGEN OK');
}

main().catch((e) => { console.log('ABSTURZ Ausnahme: ' + (e && e.stack)); process.exit(1); });
