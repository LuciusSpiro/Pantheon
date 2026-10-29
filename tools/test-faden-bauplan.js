'use strict';
// SUND-04b A1: Abenteuer-Plaene (Bauplan, Expander, Pruefer, Persistenz, Oeffnen ohne Notruf). Geprueft wird: die drei Vorlagen aus 04a laufen unveraendert durch denselben Pruefer · handgeschriebene gueltige
// und ungueltige Plaene (erwartet wird der Code der Regel, die Zustaende werden hier von Hand aus den Daten abgeleitet, nicht aus dem Expander) · maschinelle Zufallsplaene (kein Absturz, jede Ablehnung hat Code,
// was der Expander durchlaesst, besteht den Pruefer) · Speichern und Laden mitten im Abenteuer (auch mit ungueltigem Plan) · Altstand aus main · Obergrenzen · ohne Schalter nichts.
// Aufruf: node tools/test-faden-bauplan.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Bausteine = require('../server/sim/faden-bausteine.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const BP = require('../server/sim/faden-bauplan.js');

const { D, Faden, F, klon, grenzen } = X;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
// Platzhalter fuer alle Bausteine ausser abschluss (die Szenen, Funk und Sprengung sind in ihren eigenen Tests geprueft; hier zaehlt der Faden)
for (const e of Object.values(D.BEATS)) if (e.baustein !== 'abschluss') Bausteine.registriere(e.baustein, Bausteine.platzhalter(e.baustein));
const hexe = ['0305', '0202', '0203', '0204'];

const b = (typ, o) => Object.assign({ typ }, o || {});
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Abenteuer', beats }, o || {});
const codes = (r) => r.codes.join(',');
const beatVon = (v, id) => v.beats.find((x) => x.id === id);
const ST = (r, id, ag) => beatVon(r.vorlage, id).aus[ag].status;

// ---------------------------------------------------------------- (a) die drei Vorlagen aus 04a
section('(a) Die drei Vorlagen aus 04a laufen unveraendert durch denselben Pruefer', () => {
  const dir = path.join(D.DIR, 'vorlagen');
  // die Dateien selbst sind unveraendert (Hash aus main 6e7b34c, hier fest, nicht aus dem Produktivcode)
  const SOLL = { 'dankbarer_captain.json': 'c2a50af791f560267972aadca05c09eb3ba30b9d', 'entfuehrter_haendler.json': '417172987f65d7e9f4342b20f088805c77bddfbf', 'falscher_haendler.json': 'b119c2702bff1b28099839790676d57d9e5db5a8' };   // SHA-1 des Inhalts mit LF-Zeilenenden (git show 6e7b34c:<Datei>)
  for (const [datei, soll] of Object.entries(SOLL)) {
    const roh = fs.readFileSync(path.join(dir, datei));
    const h = crypto.createHash('sha1').update(roh).digest('hex'), h2 = crypto.createHash('sha1').update(Buffer.from(roh.toString('utf8').replace(/\r\n/g, '\n'))).digest('hex');
    ok(h === soll || h2 === soll, `${datei} ist unveraendert (SHA-1 ${soll.slice(0, 8)})`);
    const v = JSON.parse(roh.toString('utf8'));
    const r = Pruefer.pruefeVorlage(v);
    ok(r.ok && r.fehler.length === 0, `${v.id}: der Pruefer laesst sie durch (${r.fehler.join('; ')})`);
  }
  ok(JSON.stringify(D.vorlagenIds()) === JSON.stringify(['dankbarer_captain', 'entfuehrter_haendler', 'falscher_haendler']) && D.ladefehler().length === 0, 'das Register der Dateien hat genau diese drei, ohne Ladefehler');
  ok(!D.vorlagenIds().some((id) => D.istAbenteuer(id)), 'ein Abenteuer taucht nie in vorlagenIds() auf (nie ein Angebot ueber Ausloeser)');
  ok(BP.katalogFehler().length === 0, 'die Daten des Expanders sind in sich stimmig (katalogFehler leer)');
});

// ---------------------------------------------------------------- (b) gueltige Plaene
const GUELTIG = [];
const gueltig = (text, p, pruef) => GUELTIG.push({ text, p, pruef });
gueltig('Spontanhilfe, Abschluss', plan([b('spontanhilfe'), b('abschluss')]), (r) => {
  ok(r.vorlage.nsc.status === 'aktiv' && ST(r, 'b1_spontanhilfe', 'gelungen') === 'verbuendet' && ST(r, 'b1_spontanhilfe', 'gescheitert') === 'aktiv', '    Zustaende von Hand: Start aktiv, gelungen verbuendet, gescheitert aktiv');
  ok(JSON.stringify(r.vorlage.beats[1].erfolg) === JSON.stringify({ ereignis: ['spontanhilfe_gelungen'] }), '    Erfolg des Abschlusses: spontanhilfe_gelungen');
  ok(Object.keys(r.vorlage.hinweise).length === 0 && !r.vorlage.wahrheit, '    keine Wahrheit, keine Hinweise');
  ok(JSON.stringify(r.vorlage.volk_erlaubt) === '["rom","kon"]' && r.vorlage.nsc.haltung === 0 && r.vorlage.ausloeser[0].art === 'notruf' && r.vorlage.ausloeser[0].ausgang === 'gelungen', '    Standards: Voelker rom und kon, Start-Haltung 0, Ausloeser notruf/gelungen (Form)');
  ok(/^abenteuer_[0-9a-f]{12}$/.test(r.vorlage.id) && r.vorlage.id.length === 22, '    Id = abenteuer_ + 12 Hexzeichen');
});
gueltig('Notruf, Abschluss', plan([b('notruf'), b('abschluss')]), (r) => {
  ok(ST(r, 'b1_notruf', 'gelungen') === 'verbuendet' && ST(r, 'b1_notruf', 'gescheitert') === 'gefangen', '    Notruf: gelungen verbuendet, gescheitert gefangen (Zustaende der Daten, Abschluss nimmt alle)');
  ok(r.vorlage.beats[0].parameter.text_key === 'notruf_standard', '    Standard-Text des Notrufs aus den Daten');
});
gueltig('Fracht, Abschluss', plan([b('fracht'), b('abschluss')]), (r) => {
  const p = r.vorlage.beats[0].parameter;
  ok(p.nach === '$ort' && p.ware === 'fracht_kiste', '    Fracht: Ziel $ort und die Ware aus den Daten');
});
gueltig('Raumschlacht, Abschluss', plan([b('raumschlacht'), b('abschluss')]), (r) => {
  ok(ST(r, 'b1_raumschlacht', 'gelungen') === 'tot' && ST(r, 'b1_raumschlacht', 'gescheitert') === 'geflohen', '    Raumschlacht vor dem Abschluss: gelungen tot, gescheitert geflohen');
});
gueltig('Verfolgung, Raumschlacht, Abschluss', plan([b('verfolgung'), b('raumschlacht'), b('abschluss')]), (r) => {
  ok(ST(r, 'b1_verfolgung', 'gelungen') === 'feindlich' && ST(r, 'b1_verfolgung', 'gescheitert') === 'geflohen', '    Verfolgung: gelungen feindlich, gescheitert geflohen (beides laesst die Raumschlacht zu)');
  ok(r.vorlage.beats[0].parameter.fluchtziel === 'naechster_sprungpunkt', '    Fluchtziel aus den Daten');
  ok(ST(r, 'b2_raumschlacht', 'gelungen') === 'tot', '    Raumschlacht: tot (der Abschluss folgt)');
});
gueltig('Notruf mit Verzweigung, Befreiung, Abschluss', plan([b('notruf', { verzweigung: { gescheitert: 'ende' } }), b('befreiung'), b('abschluss', { id: 'ende' })]), (r) => {
  ok(r.vorlage.nsc.status === 'aktiv', '    Start aktiv (der erste Beat ist ein Notruf)');
  const n0 = beatVon(r.vorlage, 'b1_notruf');
  ok(n0.aus.gelungen.status === 'gefangen' && !n0.aus.gelungen.weiter && n0.aus.gescheitert.status === 'gefangen' && n0.aus.gescheitert.weiter === 'ende', '    Notruf: gelungen gefangen (Befreiung braucht gefangen), gescheitert gefangen und weiter ende');
  ok(ST(r, 'b2_befreiung', 'gelungen') === 'verbuendet' && ST(r, 'b2_befreiung', 'gescheitert') === 'gefangen', '    Befreiung: gelungen verbuendet, gescheitert gefangen');
});
gueltig('Befreiung als erster Beat startet gefangen', plan([b('befreiung'), b('abschluss')]), (r) => {
  ok(r.vorlage.nsc.status === 'gefangen', '    Start gefangen (Daten: start_status der Befreiung)');
});
gueltig('Bitte, Fracht, Enthuellung, Abschluss (Verzweigung, Optionen, Hinweise)', plan([b('bitte', { verzweigung: { gescheitert: 'e' } }), b('fracht'), b('enthuellung', { id: 'e' }), b('abschluss')]), (r) => {
  const v = r.vorlage;
  ok(JSON.stringify(v.wahrheit) === JSON.stringify({ id: 'ist_germane', fraktion: 'ger' }), '    Wahrheit ist_germane (Daten)');
  ok(beatVon(v, 'b1_bitte').hinweise.length === 1 && beatVon(v, 'b2_fracht').hinweise.length === 1 && !beatVon(v, 'e').hinweise, '    je ein Hinweis an Bitte und Fracht (Traeger vor der Enthuellung), keiner an der Enthuellung');
  ok(beatVon(v, 'b1_bitte').hinweise[0] !== beatVon(v, 'b2_fracht').hinweise[0] && Object.keys(v.hinweise).length === 2, '    zwei verschiedene Hinweise aus dem Katalog');
  ok(beatVon(v, 'b1_bitte').parameter.text_key === 'hilfe_rom', '    Standardtext der Bitte: hilfe_rom (Daten)');
  const o = beatVon(v, 'b1_bitte').optionen;
  ok(o.length === 2 && o[0].ausgang === 'gelungen' && o[1].ausgang === 'gescheitert', '    Standard-Optionen annehmen/ablehnen mit Folge');
  ok(ST(r, 'b1_bitte', 'gelungen') === 'verbuendet' && ST(r, 'b1_bitte', 'gescheitert') === 'aktiv' && beatVon(v, 'b1_bitte').aus.gescheitert.weiter === 'e', '    Bitte: gelungen verbuendet, gescheitert aktiv und weiter e');
  ok(ST(r, 'e', 'gelungen') === 'feindlich' && ST(r, 'e', 'gescheitert') === 'geflohen', '    Enthuellung vor dem Abschluss: feindlich bzw. geflohen');
  ok(beatVon(v, 'b2_fracht').aus.gelungen.status === 'verbuendet', '    Fracht gelungen verbuendet (Enthuellung laesst verbuendet zu)');
});
gueltig('namenlos: Spontanhilfe, Raumschlacht, Abschluss', plan([b('spontanhilfe'), b('raumschlacht'), b('abschluss')], { namenlos: true }), (r) => {
  const v = r.vorlage;
  ok(v.nsc.rolle === 'namenlos' && v.nsc.status === 'aktiv', '    nsc.rolle namenlos, Start aktiv');
  ok(v.beats.every((x) => Object.values(x.aus).every((o) => o.status === undefined)), '    kein Ausgang traegt einen Status');
});
gueltig('namenlos: Notruf, Fracht, Abschluss', plan([b('notruf'), b('fracht'), b('abschluss')], { namenlos: true }));
gueltig('namenlos: Bitte mit Verzweigung, Spontanhilfe, Abschluss', plan([b('bitte', { verzweigung: { gescheitert: 'ende' } }), b('spontanhilfe'), b('abschluss', { id: 'ende' })], { namenlos: true }));
gueltig('namenlos mit Enthuellung: Hinweise ohne {name}', plan([b('notruf'), b('enthuellung', { verzweigung: { gescheitert: 'ende' } }), b('raumschlacht'), b('abschluss', { id: 'ende' })], { namenlos: true }), (r) => {
  const texte = Object.values(r.vorlage.hinweise).map((h) => h.text);
  ok(texte.length === 1 && !texte[0].includes('{name}') && texte[0].includes('{ort}'), '    der Hinweis nennt keinen Namen, nur den Ort: ' + texte[0]);
});
gueltig('Spontanhilfe, Notruf, Abschluss', plan([b('spontanhilfe'), b('notruf'), b('abschluss')]));
gueltig('Notruf, Bitte (Verzweigung zum Abschluss), Fracht, Abschluss', plan([b('notruf'), b('bitte', { verzweigung: { gescheitert: 'ende' } }), b('fracht'), b('abschluss', { id: 'ende' })]), (r) => {
  ok(ST(r, 'b1_notruf', 'gescheitert') === 'aktiv', '    Notruf vor der Bitte: gescheitert aktiv (gefangen passt nicht zur Bitte)');
});
gueltig('acht Beats (die Obergrenze)', plan([b('spontanhilfe'), b('notruf'), b('bitte', { verzweigung: { gescheitert: 'sp2' } }), b('fracht'), b('spontanhilfe', { id: 'sp2' }), b('verfolgung'), b('raumschlacht'), b('abschluss')]), (r) => {
  ok(JSON.stringify(r.vorlage.beats[7].erfolg.ereignis) === JSON.stringify(['bitte_gelungen', 'fracht_gelungen', 'verfolgung_gelungen', 'raumschlacht_gelungen']), '    Erfolg ohne Angabe: die letzten vier Typen des Plans (Typen in der Reihenfolge ihres ersten Auftretens, das Schema der Vorlage erlaubt vier)');
});
gueltig('Verzweigung ueberspringt einen Beat (nur der Gescheiterte)', plan([b('spontanhilfe', { verzweigung: { gescheitert: 'rs' } }), b('notruf'), b('raumschlacht', { id: 'rs' }), b('abschluss')]), (r) => {
  const s = r.vorlage.beats[0];
  ok(s.aus.gelungen.weiter === undefined && s.aus.gescheitert.weiter === 'rs', '    nur das Gescheiterte zeigt auf rs, Gelungen geht zum naechsten');
});
gueltig('Optionen ausdruecklich (optionen true)', plan([b('bitte', { optionen: true, verzweigung: { gelungen: 'ende' } }), b('spontanhilfe'), b('abschluss', { id: 'ende' })]));
gueltig('text_key hilfe_kon und notruf_entfuehrt', plan([b('notruf', { parameter: { text_key: 'notruf_entfuehrt' } }), b('bitte', { parameter: { text_key: 'hilfe_kon' }, verzweigung: { gescheitert: 'ende' } }), b('spontanhilfe'), b('abschluss', { id: 'ende' })]), (r) => {
  ok(r.vorlage.beats[0].parameter.text_key === 'notruf_entfuehrt' && r.vorlage.beats[1].parameter.text_key === 'hilfe_kon', '    die erlaubten Texte des Plans gelten');
  ok(ST(r, 'b2_bitte', 'gelungen') === 'verbuendet' && ST(r, 'b2_bitte', 'gescheitert') === 'aktiv', '    Bitte vor Spontanhilfe und vor dem Abschluss: gelungen verbuendet, gescheitert aktiv (erster Kandidat der Daten)');
});
gueltig('Fluchtziel als Hex-Code und als Symbol', plan([b('verfolgung', { parameter: { fluchtziel: '0305' } }), b('verfolgung', { parameter: { fluchtziel: 'heimat' } }), b('abschluss')]), (r) => {
  ok(r.vorlage.beats[0].parameter.fluchtziel === '0305' && r.vorlage.beats[1].parameter.fluchtziel === 'heimat', '    beide Fluchtziele');
});
gueltig('Volk eingeschraenkt, Anlass, Erfolg', plan([b('spontanhilfe'), b('fracht'), b('abschluss', { erfolg: ['fracht'] })], { volk_erlaubt: ['kon'], anlass: 'Ein Kurier bittet im Saum um Geleit zum Hafen.' }), (r) => {
  ok(JSON.stringify(r.vorlage.volk_erlaubt) === '["kon"]' && r.vorlage.anlass.startsWith('Ein Kurier'), '    Volk und Anlass stehen in der Vorlage');
  ok(JSON.stringify(r.vorlage.beats[2].erfolg) === JSON.stringify({ ereignis: ['fracht_gelungen'] }), '    erfolg: nur fracht_gelungen');
});
gueltig('Wahrheit ausdruecklich genannt', plan([b('notruf'), b('enthuellung'), b('abschluss')], { wahrheit: 'ist_germane', titel: 'Wahrheit genannt' }));
gueltig('Enthuellung nach Bitte und Notruf (zwei Traeger, die Verzweigung umgeht den zweiten)', plan([b('bitte', { verzweigung: { gescheitert: 'e' } }), b('notruf'), b('enthuellung', { id: 'e' }), b('abschluss')]));
gueltig('Verfolgung zweimal hintereinander, dann Raumschlacht', plan([b('verfolgung'), b('verfolgung'), b('raumschlacht'), b('abschluss')]));
gueltig('Spontanhilfe zweimal, Titel mit Umlauten', plan([b('spontanhilfe'), b('spontanhilfe'), b('abschluss')], { titel: 'Hilfe für die Fähre' }));

section('(b) Mindestens 20 handgeschriebene gueltige Plaene expandieren und bestehen den Pruefer', () => {
  ok(GUELTIG.length >= 20, `${GUELTIG.length} gueltige Plaene`);
  const ids = new Set();
  for (const g of GUELTIG) {
    const r = BP.pruefe(g.p);
    ok(r.ok && r.fehler.length === 0, `${g.text}: ${r.ok ? 'gueltig' : r.fehler.join('; ')}`);
    if (!r.ok) continue;
    const e = BP.expandiere(g.p);
    ok(e.ok && JSON.stringify(e.vorlage) === JSON.stringify(r.vorlage), '    expandiere und pruefe liefern dieselbe Vorlage');
    ok(Pruefer.pruefeVorlage(klon(r.vorlage)).ok, '    der Pruefer laesst die Vorlage durch');
    ok(D.registriereAbenteuer(klon(r.vorlage)).ok && Object.isFrozen(D.vorlage(r.vorlage.id)) && !D.vorlagenIds().includes(r.vorlage.id), '    im Abenteuer-Register, eingefroren, nie in vorlagenIds()');
    ok(JSON.stringify(BP.expandiere(klon(g.p)).vorlage.id) === JSON.stringify(r.vorlage.id) && r.vorlage.id.length <= 32, `    dieselbe Id bei jedem Aufruf (${r.vorlage.id})`);
    ids.add(r.vorlage.id);
    if (g.pruef) g.pruef(r);
  }
  ok(ids.size === GUELTIG.length, 'jeder Plan ergibt eine eigene Id (Hash des Inhalts)');
});

// ---------------------------------------------------------------- (c) ungueltige Plaene
const UNGUELTIG = [];
const ungueltig = (text, p, code) => UNGUELTIG.push({ text, p, code });
const tx = (o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Abenteuer' }, o);
ungueltig('Hinweis fehlt: Enthuellung ohne Traeger davor', plan([b('spontanhilfe'), b('enthuellung'), b('abschluss')]), 'HINWEIS_FEHLT');
ungueltig('Hinweis fehlt: Enthuellung als erster Beat', plan([b('enthuellung'), b('abschluss')]), 'HINWEIS_FEHLT');
ungueltig('Hinweis fehlt: ein Weg der Verzweigung umgeht den Traeger', plan([b('spontanhilfe', { verzweigung: { gelungen: 'e' } }), b('fracht'), b('enthuellung', { id: 'e' }), b('abschluss')]), 'HINWEIS_FEHLT');
ungueltig('Option bei Gefahr (Spontanhilfe)', plan([b('spontanhilfe', { optionen: true }), b('abschluss')]), 'OPTION_BEI_GEFAHR');
ungueltig('Option bei Gefahr (Raumschlacht)', plan([b('raumschlacht', { optionen: true }), b('abschluss')]), 'OPTION_BEI_GEFAHR');
ungueltig('Optionen bei einem Typ ohne Optionen (Notruf)', plan([b('notruf', { optionen: true }), b('abschluss')]), 'OPTIONEN_NICHT_ERLAUBT');
ungueltig('kein Abschluss', plan([b('spontanhilfe'), b('notruf')]), 'ABSCHLUSS_FEHLT');
ungueltig('Abschluss mitten im Plan', plan([b('spontanhilfe'), b('abschluss'), b('notruf'), b('abschluss', { id: 'z' })]), 'ABSCHLUSS_NICHT_LETZT');
ungueltig('Rueckwaertssprung', plan([b('spontanhilfe', { id: 'a' }), b('notruf', { verzweigung: { gescheitert: 'a' } }), b('abschluss')]), 'WEITER_UNGUELTIG');
ungueltig('Sprung auf sich selbst', plan([b('spontanhilfe', { id: 'a', verzweigung: { gelungen: 'a' } }), b('abschluss')]), 'WEITER_UNGUELTIG');
ungueltig('Sprung auf einen Beat, den es nicht gibt', plan([b('spontanhilfe', { verzweigung: { gelungen: 'nirgends' } }), b('abschluss')]), 'WEITER_UNGUELTIG');
ungueltig('unbekannter Typ', plan([b('wunder'), b('abschluss')]), 'TYP_UNBEKANNT');
ungueltig('doppelte Beat-Id', plan([b('spontanhilfe', { id: 'a' }), b('notruf', { id: 'a' }), b('abschluss')]), 'ID_DOPPELT');
ungueltig('neun Beats (Obergrenze 8)', plan([b('spontanhilfe'), b('spontanhilfe'), b('spontanhilfe'), b('spontanhilfe'), b('spontanhilfe'), b('spontanhilfe'), b('spontanhilfe'), b('spontanhilfe'), b('abschluss')]), 'BEATS_ANZAHL');
ungueltig('ein einziger Beat', plan([b('abschluss')]), 'BEATS_ANZAHL');
ungueltig('keine Beats', plan([]), 'BEATS_ANZAHL');
ungueltig('Bitte ohne Verzweigung (Annehmen und Ablehnen gleicher Weg)', plan([b('bitte'), b('spontanhilfe'), b('abschluss')]), 'OPTIONEN_GLEICHER_WEG');
ungueltig('Bitte ohne Optionen (sie scheitert sonst immer)', plan([b('bitte', { optionen: false, verzweigung: { gescheitert: 'e' } }), b('spontanhilfe'), b('abschluss', { id: 'e' })]), 'BAUPLAN_OPTIONEN_PFLICHT');
ungueltig('unbekannter Parameter', plan([b('spontanhilfe', { parameter: { zauberei: 'ja' } }), b('abschluss')]), 'PARAMETER');
ungueltig('Text-Schluessel ausserhalb der erlaubten', plan([b('notruf', { parameter: { text_key: 'bitte_transport' } }), b('abschluss')]), 'PARAMETER');
ungueltig('Fluchtziel unsinnig', plan([b('verfolgung', { parameter: { fluchtziel: 'irgendwo' } }), b('abschluss')]), 'FLUCHTZIEL_FEHLT');
ungueltig('Beat wird auf keinem Weg erreicht', plan([b('spontanhilfe', { verzweigung: { gelungen: 'e', gescheitert: 'e' } }), b('notruf'), b('abschluss', { id: 'e' })]), 'UNERREICHBAR');
ungueltig('Scheitern aendert nichts (Notruf, Befreiung linear)', plan([b('notruf'), b('befreiung'), b('abschluss')]), 'SCHEITERN_FOLGENLOS');
ungueltig('kein Zustand des NSC passt zum Folgebeat (Befreiung nach Bitte)', plan([b('bitte', { verzweigung: { gescheitert: 'e' } }), b('befreiung'), b('abschluss', { id: 'e' })]), 'STATUS_PASST_NICHT');
ungueltig('namenlos mit Befreiung (der NSC bleibt aktiv)', plan([b('notruf', { verzweigung: { gescheitert: 'e' } }), b('befreiung'), b('abschluss', { id: 'e' })], { namenlos: true }), 'BAUPLAN_NAMENLOS_TYP');
ungueltig('namenlos ohne Weg-oder-Folge-Unterschied (Verfolgung linear)', plan([b('verfolgung'), b('abschluss')], { namenlos: true }), 'SCHEITERN_FOLGENLOS');
ungueltig('unbekannte Wahrheit', plan([b('notruf'), b('enthuellung'), b('abschluss')], { wahrheit: 'ist_kaiser' }), 'BAUPLAN_WAHRHEIT_UNBEKANNT');
ungueltig('Wahrheit ohne Enthuellung', plan([b('notruf'), b('abschluss')], { wahrheit: 'ist_germane' }), 'WAHRHEIT_OHNE_ENTHUELLUNG');
ungueltig('Verzweigung am Abschluss', plan([b('spontanhilfe'), b('abschluss', { verzweigung: { gelungen: 'x' } })]), 'AUSGANG_UNGUELTIG');
ungueltig('erfolg an einem Beat, der kein Abschluss ist (der genannte Typ steht im Plan)', plan([b('spontanhilfe', { erfolg: ['notruf'] }), b('notruf'), b('abschluss')]), 'ERFOLG_UNGUELTIG');
ungueltig('erfolg nennt einen Typ, den der Plan nicht hat', plan([b('spontanhilfe'), b('abschluss', { erfolg: ['raumschlacht'] })]), 'ERFOLG_UNGUELTIG');
ungueltig('falsches Format', tx({ format: 'faden-vorlage/1', beats: [] }), 'FORM');
ungueltig('Titel zu kurz', plan([b('spontanhilfe'), b('abschluss')], { titel: 'ab' }), 'FORM');
ungueltig('unbekanntes Feld im Plan (der Plan darf keine Zustaende schreiben)', plan([b('spontanhilfe'), b('abschluss')], { nsc: { status: 'tot' } }), 'FORM');
ungueltig('unbekanntes Feld am Beat (aus gehoert den Daten)', plan([b('spontanhilfe', { aus: {} }), b('abschluss')]), 'FORM');
ungueltig('namenlos ist kein Wahrheitswert', plan([b('spontanhilfe'), b('abschluss')], { namenlos: 'ja' }), 'FORM');
ungueltig('Anlass mit Platzhalter', plan([b('spontanhilfe'), b('abschluss')], { anlass: 'Hilfe fuer {name} bei {ort}' }), 'BAUPLAN_TEXT');
ungueltig('Anlass zu kurz', plan([b('spontanhilfe'), b('abschluss')], { anlass: 'kurz' }), 'BAUPLAN_TEXT');
ungueltig('unbekanntes Volk', plan([b('spontanhilfe'), b('abschluss')], { volk_erlaubt: ['atlantis'] }), 'VOLK');
ungueltig('kein Objekt', 'ein Plan', 'FORM');
ungueltig('Plan ohne beats', { format: 'faden-bauplan/1', titel: 'Ohne Beats' }, 'FORM');
ungueltig('Titel mit Platzhalter', plan([b('spontanhilfe'), b('abschluss')], { titel: 'Hilfe fuer {name}' }), 'BAUPLAN_TEXT');
ungueltig('gescheiterter Weg fuehrt zu einem Beat, der keinen passenden Zustand zulaesst (Befreiung)', plan([b('spontanhilfe', { verzweigung: { gescheitert: 'bf' } }), b('notruf'), b('befreiung', { id: 'bf' }), b('abschluss')]), 'STATUS_PASST_NICHT');
ungueltig('zu viele Typen im Erfolg (mehr als vier)', plan([b('spontanhilfe'), b('abschluss', { erfolg: ['spontanhilfe', 'spontanhilfe', 'spontanhilfe', 'spontanhilfe', 'spontanhilfe'] })]), 'FORM');
// Prototyp-Schluessel (Nacharbeit): props[k] fand constructor/toString im Prototyp, __proto__ als eigener Schluessel (nur aus JSON.parse) wurde vom Hash ignoriert
ungueltig('Prototyp-Schluessel constructor im Kopf des Plans', plan([b('spontanhilfe'), b('abschluss')], { constructor: 'x'.repeat(5000) }), 'FORM');
ungueltig('Prototyp-Schluessel toString im Kopf des Plans', plan([b('spontanhilfe'), b('abschluss')], { toString: { a: 1 } }), 'FORM');
ungueltig('Prototyp-Schluessel constructor an einem Beat', plan([b('spontanhilfe', { constructor: 5 }), b('abschluss')]), 'FORM');
ungueltig('Prototyp-Schluessel __proto__ im Kopf des Plans (JSON)', JSON.parse('{"format":"faden-bauplan/1","titel":"Probe Abenteuer","__proto__":{"x":1},"beats":[{"typ":"spontanhilfe"},{"typ":"abschluss"}]}'), 'FORM');
ungueltig('Prototyp-Schluessel prototype an einem Beat', plan([b('spontanhilfe', { prototype: 1 }), b('abschluss')]), 'FORM');

section('(c) Mindestens 20 ungueltige Plaene werden mit dem richtigen Code abgelehnt (vom Expander selbst, nicht erst vom Pruefer)', () => {
  ok(UNGUELTIG.length >= 20, `${UNGUELTIG.length} ungueltige Plaene`);
  for (const u of UNGUELTIG) {
    const r = BP.expandiere(u.p);
    ok(!r.ok && r.vorlage === null && r.codes.includes(u.code) && r.fehler.every((t) => /^[A-Z][A-Z_]+: /.test(t)), `${u.text} -> ${u.code}  (${r.codes.join(', ') || 'angenommen!'})`);
  }
});

// ---------------------------------------------------------------- (d) Zufallsplaene
function lcg(seed) { let s = (seed * 2654435761) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const TYPEN = Object.keys(D.BEATS);
function zufallsPlan(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const n = 2 + Math.floor(r() * 8);   // 2 bis 9 (9 ist zu lang)
  const beats = [];
  for (let i = 0; i < n; i++) {
    const typ = i === n - 1 && r() < 0.9 ? 'abschluss' : r() < 0.03 ? 'wunder' : pick(TYPEN);
    const e = { typ };
    if (r() < 0.35) e.id = 'x' + i;
    if (typ === 'bitte' && r() < 0.15) e.optionen = r() < 0.5;
    else if (typ !== 'bitte' && r() < 0.05) e.optionen = true;
    if (typ === 'verfolgung' && r() < 0.3) e.parameter = { fluchtziel: pick(['heimat', '0305', 'nachbar_ort', 'irgendwo']) };
    if (typ === 'notruf' && r() < 0.3) e.parameter = { text_key: pick(['notruf_standard', 'notruf_entfuehrt', 'bitte_transport']) };
    if (typ === 'fracht' && r() < 0.2) e.parameter = { ware: pick(['fracht_kiste', 'gold']) };
    if (r() < 0.3 && i < n - 1) {
      const v = {};
      for (const ag of ['gelungen', 'gescheitert']) if (r() < 0.6) v[ag] = r() < 0.04 ? 'x' + Math.floor(r() * n) : r() < 0.03 ? 'nirgends' : 'x' + (i + 1 + Math.floor(r() * (n - i - 1)));
      if (Object.keys(v).length) e.verzweigung = v;
    }
    if (typ === 'abschluss' && r() < 0.1) e.erfolg = [pick(TYPEN)];
    beats.push(e);
  }
  const p = { format: 'faden-bauplan/1', titel: 'Zufall ' + Math.floor(r() * 1e6), beats };
  if (r() < 0.25) p.namenlos = true;
  if (r() < 0.1) p.wahrheit = pick(['ist_germane', 'ist_kaiser']);
  if (r() < 0.15) p.volk_erlaubt = [pick(['rom', 'kon', 'ger'])];
  return p;
}
// jede Beat-Id 'x<i>' muss es geben, damit Verzweigungen oft treffen: Beats ohne eigene Id bekommen sie hier
function ids(p) { p.beats.forEach((e, i) => { if (!e.id) e.id = 'x' + i; }); return p; }
section('(d) 200 Zufallsplaene x 3 Seeds: kein Absturz, jede Ablehnung hat Code, was der Expander durchlaesst besteht den Pruefer', () => {
  let alle = 0, angenommen = 0, prueferAblehnung = 0, ohneCode = 0, abstuerze = 0;
  const haeufig = {};
  for (const seed of [1, 777, 4242]) {
    const r = lcg(seed);
    let ok1 = 0;
    for (let k = 0; k < (Number(process.env.BAUPLAN_N) || 200); k++) {
      const p = ids(zufallsPlan(r));
      alle++;
      let e;
      try { e = BP.expandiere(p); } catch (x) { abstuerze++; console.log('    Absturz: ' + (x && x.stack)); continue; }
      if (!e.ok) { if (!e.fehler.length || !e.fehler.every((t) => /^[A-Z][A-Z_]+: .+/.test(t))) ohneCode++; for (const c of new Set(e.codes)) haeufig[c] = (haeufig[c] || 0) + 1; continue; }
      angenommen++; ok1++;
      const pr = Pruefer.pruefeVorlage(klon(e.vorlage));
      if (!pr.ok) { prueferAblehnung++; console.log('    Pruefer lehnt ab: ' + pr.fehler.slice(0, 2).join('; ') + '  Plan ' + JSON.stringify(p)); }
      const e2 = BP.expandiere(klon(p));
      if (JSON.stringify(e2.vorlage) !== JSON.stringify(e.vorlage)) { prueferAblehnung++; console.log('    nicht deterministisch'); }
    }
    console.log(`    Seed ${seed}: ${ok1} von ${Number(process.env.BAUPLAN_N) || 200} angenommen`);
    ok(ok1 >= 15, `Seed ${seed}: der Generator erreicht den Pruefer (${ok1} angenommen)`);
  }
  console.log('    Ablehnungen nach Code (Plaene je Code): ' + Object.entries(haeufig).sort((a, b2) => b2[1] - a[1]).map(([c, k]) => c + ' ' + k).join(', '));
  ok(abstuerze === 0, `kein Absturz in ${alle} Plaenen`);
  ok(ohneCode === 0, 'jede Ablehnung hat mindestens einen Code ("CODE: Text")');
  ok(angenommen > 0 && prueferAblehnung === 0, `${angenommen} Plaene vom Expander angenommen, davon lehnt der Pruefer 0 ab (Ablehnquote 0)`);
});

// ---------------------------------------------------------------- Spiel
const wahl = (r) => (r() < 0.6 ? 'gelungen' : 'gescheitert');
function bringeWeiter(g, f) {   // Taetigkeiten ueber den echten Hook, bis der naechste Beat faellig ist; -> true, wenn er startete
  for (let i = 0; i < 8; i++) {
    const beat = D.vorlage(f.vorlage).beats[f.beat].id;
    if (Faden.befehlPruefen(g, { typ: 'faden_weiter', faden: f.id, beat }) === null) return Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat }).ok;
    grenzen(g, 1);
  }
  return false;
}
const spiel = (o) => X.spiel(o).g;
function abenteuer(g, p, hex, o) {
  const a = Faden.abenteuerAnbieten(g, p, { hex: hex || '0305' });
  if (!a.ok) return { a };
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, o);
  return { a, r, f: r.ok ? r.faden : null };
}
const PLAN_VOLL = plan([b('bitte', { verzweigung: { gescheitert: 'e' } }), b('fracht'), b('enthuellung', { id: 'e' }), b('raumschlacht'), b('abschluss')], { anlass: 'Eine Frachtbitte, hinter der mehr steckt.' });

section('Abenteuer spielen: Hinweis vor der Enthuellung, beide Wege bis zum Abschluss, Zufallsplaene im Spiel', () => {
  const g = spiel();
  const { f, r } = abenteuer(g, PLAN_VOLL, '0305');
  ok(r.ok && f && f.plan && f.plan.id === f.vorlage && D.istAbenteuer(f.vorlage) && f.nsc.wahrheit && f.nsc.wahrheit.offenbart === false, 'das Abenteuer ist offen: Faden mit Plan, NSC mit verborgener Wahrheit');
  ok(f.abstand >= 2 && f.abstand <= 4 && f.parameter.ort === '0305', `Abstand ${f.abstand} (2 bis 4), Ort 0305`);
  ok(Faden.befehlPruefen(g, { typ: 'faden_weiter', faden: f.id, beat: f.plan.beats[0].id }) !== null, 'vor dem Abstand startet kein Beat');
  let reihe = [];
  for (let i = 0; i < 12 && f.phase !== 'abgeschlossen'; i++) {
    if (f.phase === 'wartet') { if (!bringeWeiter(g, f)) break; }
    if (f.phase === 'laeuft') { reihe.push(f.laufend.beat); if (f.laufend.beat === 'e') ok(f.hinweise.length >= 1, 'die Enthuellung beginnt erst nach einem gestreuten Hinweis (' + f.hinweise + ')'); Faden.beatAusgang(g, f.id, 'gelungen'); }
  }
  ok(f.phase === 'abgeschlossen' && f.ausgang && f.ausgang.art === 'gelungen', 'Abschluss erreicht, Ausgang gelungen (Erfolg: Beats der Crew): ' + reihe.join(' > '));
  ok(reihe.join('>') === 'b1_bitte>b2_fracht>e>b4_raumschlacht', 'Weg bei lauter Gelingen: Bitte, Fracht, Enthuellung, Raumschlacht (der Abschluss endet beim Start, er steht nicht als laufender Beat)');
  ok(Pruefer.pruefeFaden(f).length === 0, 'der Faden besteht pruefeFaden');
  // zweiter Lauf: Scheitern der Bitte nimmt die Verzweigung (ueberspringt die Fracht), die Enthuellung hat trotzdem einen Hinweis (Bitte ist Traeger)
  const h = spiel(), o2 = abenteuer(h, PLAN_VOLL, '0305'), f2 = o2.f; const reihe2 = [];
  for (let i = 0; i < 12 && f2.phase !== 'abgeschlossen'; i++) {
    if (f2.phase === 'wartet') { if (!bringeWeiter(h, f2)) break; }
    if (f2.phase === 'laeuft') { reihe2.push(f2.laufend.beat); if (f2.laufend.beat === 'e') ok(f2.hinweise.length >= 1, 'auch auf dem Weg ueber das Scheitern der Bitte gibt es vor der Enthuellung einen Hinweis'); Faden.beatAusgang(h, f2.id, reihe2.length === 1 ? 'gescheitert' : 'gelungen'); }
  }
  ok(reihe2.join('>') === 'b1_bitte>e>b4_raumschlacht' && f2.phase === 'abgeschlossen', 'Scheitern der Bitte: ' + reihe2.join(' > ') + ' (die Fracht entfaellt)');
  ok(g.errors === 0 && h.errors === 0, 'keine Serverfehler');
});

section('Zufallsplaene im Spiel: jeder angenommene Plan laeuft bis zum Abschluss, kein Wurf, jeder Zustand besteht pruefeFaden und das Weltstand-Schema', () => {
  let gespielt = 0, abgeschlossen = 0, probleme = 0;
  for (const seed of [1, 777, 4242]) {
    const r = lcg(seed + 5), g = spiel({ seed });
    let k = 0;
    let je = 0;
    while (je < 14 && k++ < 600) {
      const p = ids(zufallsPlan(r));
      if (!BP.pruefe(p).ok) continue;
      const o = abenteuer(g, p, hexe[k % hexe.length]);
      if (!o.f) { probleme++; console.log('    Oeffnen scheitert: ' + JSON.stringify(o.r || o.a).slice(0, 160)); continue; }
      gespielt++; je++;
      const f = o.f;
      for (let i = 0; i < 40 && f.phase !== 'abgeschlossen'; i++) {
        if (f.phase === 'wartet') { if (!bringeWeiter(g, f)) { probleme++; console.log('    Beat startet nicht: ' + f.id + ' ' + f.vorlage + ' Beat ' + f.beat + ' ' + Faden.befehlPruefen(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id })); break; } }
        if (f.phase === 'laeuft') Faden.beatAusgang(g, f.id, wahl(r));
        const e = Pruefer.pruefeFaden(f); if (e.length) { probleme++; console.log('    pruefeFaden: ' + e[0]); break; }
      }
      if (f.phase === 'abgeschlossen') abgeschlossen++; else probleme++;
      const v = Weltstand.validate(Weltstand.capture(g), g); if (v.length) { probleme++; console.log('    Weltstand: ' + v[0]); }
    }
    ok(g.errors === 0, `Seed ${seed}: keine Serverfehler`);
  }
  ok(gespielt >= 40 && abgeschlossen === gespielt && probleme === 0, `${gespielt} Plaene gespielt, ${abgeschlossen} bis zum Abschluss, ${probleme} Probleme`);
});

// ---------------------------------------------------------------- (e) Speichern und Laden
section('(e) Speichern und Laden mitten im Abenteuer; ungueltiger gespeicherter Plan beendet den Faden ohne Fehler', () => {
  const g = spiel(), { f } = abenteuer(g, PLAN_VOLL, '0305');
  bringeWeiter(g, f); Faden.beatAusgang(g, f.id, 'gelungen');   // Bitte gelungen: der Faden steht vor der Fracht
  grenzen(g, 1);
  const data = Weltstand.capture(g), sim = JSON.parse(JSON.stringify(data.welt.sim));
  const bl = sim.faeden.liste[0];
  ok(Weltstand.validate(data, g).length === 0, 'der Stand ist schemagueltig: ' + Weltstand.validate(data, g).slice(0, 2).join('; '));
  ok(bl.plan && bl.plan.id === bl.vorlage && bl.beat === 1 && bl.phase === 'wartet', 'der Plan steht im Weltstand (welt.sim.faeden.liste[0].plan), Beat 1, wartet');
  ok(!('abenteuerAngebote' in sim.faeden), 'Angebote bleiben Laufzeit');
  const g2 = spiel();
  Kriegslage.restore(g2, sim);
  ok(JSON.stringify(Faden.toSave(g2.weltsim)) === JSON.stringify(sim.faeden), 'Speichern und Laden ergibt denselben Block');
  const f2 = g2.weltsim.faeden.liste[0];
  ok(f2 && f2.plan && f2.vorlage === f.vorlage && D.vorlage(f2.vorlage).beats.length === 5 && f2.hinweise.length === f.hinweise.length && f2.nsc.name === f.nsc.name, 'der Faden ist da: Plan, Hinweise, NSC');
  const reihe = [];
  for (let i = 0; i < 12 && f2.phase !== 'abgeschlossen'; i++) {
    if (f2.phase === 'wartet') { if (!bringeWeiter(g2, f2)) break; }
    if (f2.phase === 'laeuft') { reihe.push(f2.laufend.beat); Faden.beatAusgang(g2, f2.id, 'gelungen'); }
  }
  ok(f2.phase === 'abgeschlossen' && reihe.join('>') === 'b2_fracht>e>b4_raumschlacht', 'nach dem Laden geht es weiter bis zum Abschluss: ' + reihe.join(' > '));
  // laufender Beat (kein Szenen-Beat: die Fracht steht laufend im Stand)
  const g3 = spiel(), o3 = abenteuer(g3, PLAN_VOLL, '0305'); bringeWeiter(g3, o3.f); Faden.beatAusgang(g3, o3.f.id, 'gelungen'); bringeWeiter(g3, o3.f);
  const s3 = JSON.parse(JSON.stringify(Weltstand.capture(g3).welt.sim)), g4 = spiel(); Kriegslage.restore(g4, s3);
  ok(g4.weltsim.faeden.liste[0].phase === 'laeuft' && g4.weltsim.faeden.liste[0].laufend.beat === 'b2_fracht' && g4.weltsim.faeden.liste[0].plan, 'ein laufender Beat (Fracht) mit Plan ueberlebt Speichern und Laden');
  // ungueltige gespeicherte Plaene
  const kaputt = (aendern, ohneNeueId) => { const s = JSON.parse(JSON.stringify(sim)); const l0 = s.faeden.liste[0]; aendern(l0); if (!ohneNeueId && l0.plan && typeof l0.plan === 'object' && l0.plan.id) { l0.plan.id = D.abenteuerId(l0.plan); l0.vorlage = l0.plan.id; } const gg = spiel(); let fehler = null; try { Kriegslage.restore(gg, s); } catch (e) { fehler = e; } return { gg, fehler, liste: gg.weltsim.faeden.liste }; };
  const FALLE = {
    'Beat ohne Abschluss': (l) => { l.plan.beats.pop(); },
    'Hinweis entfernt': (l) => { for (const x of l.plan.beats) delete x.hinweise; },
    'Option bei Gefahr eingeschleust': (l) => { l.plan.beats[3].optionen = JSON.parse(JSON.stringify(l.plan.beats[0].optionen)); },
    'Rueckwaertssprung': (l) => { l.plan.beats[3].aus.gelungen.weiter = 'b1_bitte'; },
    'unbekannter Typ': (l) => { l.plan.beats[1].typ = 'wunder'; },
    'Id passt nicht zum Inhalt': [(l) => { l.plan.titel = 'Anderer Titel'; }, true],
    'Plan ist kein Objekt': (l) => { l.plan = 'x'; },
    'Plan gehoert zu einer anderen Vorlage': [(l) => { l.vorlage = 'abenteuer_000000000000'; }, true],
    'Faden verweist auf eine Vorlage der Dateien, traegt aber einen Plan': [(l) => { l.vorlage = 'falscher_haendler'; }, true],
    'Plan mit fremder Id (kein Praefix)': [(l) => { l.plan.id = 'falscher_haendler'; l.vorlage = 'falscher_haendler'; }, true],
    'Muell in plan': (l) => { l.plan = { beats: 5 }; },
    'Prototyp-Schluessel constructor mit 2 MB Text (Id neu berechnet)': (l) => { l.plan.constructor = 'x'.repeat(2e6); },
    'Prototyp-Schluessel toString (Id neu berechnet)': (l) => { l.plan.toString = { a: 1 }; },
    'Prototyp-Schluessel tief in einem Beat': (l) => { l.plan.beats[0].constructor = 5; },
    'uebergrosser Plan (unbekanntes Feld mit 9000 Zeichen, Id neu berechnet)': (l) => { l.plan.zusatz = 'x'.repeat(9000); },
  };
  for (const [text, e] of Object.entries(FALLE)) {
    const k = Array.isArray(e) ? kaputt(e[0], e[1]) : kaputt(e);
    ok(!k.fehler && k.liste.length === 0 && k.gg.weltsim.faeden.ladeFehler.length >= 1 && k.gg.errors === 0, `ungueltiger Plan (${text}): der Faden faellt weg, kein Wurf, Meldung (${k.gg.weltsim.faeden.ladeFehler[0] || ''})`.slice(0, 190));
    const k2 = k.gg; for (let i = 0; i < 6; i++) { k2.lageGrenze('andocken'); } ok(k2.errors === 0, '    danach laeuft das Spiel ohne Fehler weiter');
  }
  // __proto__ als EIGENER Schluessel (nur aus JSON.parse): wird vor dem Hash abgelehnt, nicht erst von der Id-Bindung (Object.assign haette ihn zum Prototyp gemacht und der Hash ihn ignoriert)
  {
    const s = JSON.parse(JSON.stringify(sim)); const l0 = s.faeden.liste[0];
    const text = JSON.stringify(l0.plan).replace(/^{/, '{"__proto__":{"a":1},');
    l0.plan = JSON.parse(text);
    ok(Object.keys(l0.plan).includes('__proto__') && l0.plan.id === l0.vorlage, 'Probe: der Plan traegt einen eigenen Schluessel __proto__ und die alte (passende) Id');
    const reg = D.registriereAbenteuer(l0.plan);
    ok(!reg.ok && /^ABENTEUER_FORM: /.test(reg.fehler[0]), '__proto__ im Plan: Ablehnung mit ABENTEUER_FORM VOR dem Hash (' + reg.fehler[0].slice(0, 40) + ')');
    const gg = spiel(); let fehler = null; try { Kriegslage.restore(gg, s); } catch (e) { fehler = e; }
    ok(!fehler && gg.weltsim.faeden.liste.length === 0 && gg.weltsim.faeden.ladeFehler.length >= 1 && gg.errors === 0, 'beim Laden faellt der Faden mit __proto__ im Plan ohne Fehler weg');
  }
  {
    const v = JSON.parse(JSON.stringify(sim.faeden.liste[0].plan)); v.zusatz = 'x'.repeat(9000); v.id = D.abenteuerId(v);
    const r = D.registriereAbenteuer(v);
    ok(!r.ok && /^ABENTEUER_GROESSE: /.test(r.fehler[0]), 'zu grosser Plan: eigener Code ABENTEUER_GROESSE (' + r.fehler[0].slice(0, 40) + ')');
    const echt = JSON.stringify(sim.faeden.liste[0].plan).length;
    ok(echt <= D.WERTE.abenteuer.plan_max_zeichen / 2, 'ein echter Plan (' + echt + ' Zeichen) liegt weit unter der Grenze ' + D.WERTE.abenteuer.plan_max_zeichen);
  }
  {
    const v = JSON.parse(JSON.stringify(sim.faeden.liste[0].plan)); let t = {}; v.zusatz = t; for (let i = 0; i < 50; i++) { t.x = {}; t = t.x; } v.id = D.abenteuerId(v);
    const r = D.registriereAbenteuer(v);
    ok(!r.ok && /^ABENTEUER_FORM: /.test(r.fehler[0]), 'ein Plan mit 50 Ebenen Tiefe wird abgelehnt (ABENTEUER_FORM), ohne Absturz');
  }
  {   // Map-Schema (additionalProperties als Schema): ein Prototyp-Schluessel ist auch dort kein Eintrag
    const sch = { type: 'object', additionalProperties: { type: 'number' } };
    ok(Weltstand.fallbackValidate({ a: 1 }, sch).length === 0 && Weltstand.fallbackValidate({ constructor: 5 }, sch).length === 1 && Weltstand.fallbackValidate(JSON.parse('{"__proto__":5}'), sch).length === 1, 'fallbackValidate: in einer Map gilt constructor/__proto__ nicht als Eintrag, normale Schluessel schon');
  }
  {   // der Checker (ENGINE, validiert alle Weltstaende) und der eigene Pruefer verhalten sich gleich
    const C = require('../server/mission/checker.js');
    const sch = { type: 'object', additionalProperties: false, properties: { a: { type: 'number' } } };
    ok(C.validate({ a: 1 }, sch).length === 0 && C.validate({ constructor: 5 }, sch).length === 1 && C.validate({ toString: 5 }, sch).length === 1 && C.validate(JSON.parse('{"__proto__":5}'), sch).length === 1, 'Checker.validate: constructor, toString und __proto__ sind unbekannte Felder, a bleibt gueltig');
    const map = { type: 'object', additionalProperties: { type: 'number' } };
    ok(C.validate({ k: 1 }, map).length === 0 && C.validate({ constructor: 5 }, map).length === 1 && C.validate(JSON.parse('{"__proto__":5}'), map).length === 1, 'Checker.validate: in einer Map gilt constructor/__proto__ nicht als Eintrag');
    const pf = { type: 'object', required: ['toString'] };
    ok(Weltstand.fallbackValidate({}, pf).length === 1 && Weltstand.fallbackValidate({ toString: 1 }, pf).length === 0, 'fallbackValidate: ein Pflichtfeld toString fehlt, auch wenn der Prototyp eines hat');
  }
  // Weltstand-Schema: Prototyp-Schluessel an einem Faden sind unbekannte Felder (beide Pruefer, der des Checkers und der eigene)
  {
    const d2 = JSON.parse(JSON.stringify(data)); d2.welt.sim.faeden.liste[0].constructor = 5;
    ok(Weltstand.validate(d2, g).length > 0, 'Weltstand.validate lehnt constructor an einem Faden ab');
    ok(Weltstand.fallbackValidate(d2, Weltstand.schema()).some((t) => /unbekanntes Feld constructor/.test(t)), 'fallbackValidate lehnt constructor an einem Faden ab');
    const d3 = JSON.parse(JSON.stringify(data)); d3.welt.sim.faeden.liste[0].nsc = JSON.parse(JSON.stringify(d3.welt.sim.faeden.liste[0].nsc).replace(/^{/, '{"__proto__":{"a":1},'));
    ok(Weltstand.fallbackValidate(d3, Weltstand.schema()).some((t) => /unbekanntes Feld __proto__/.test(t)) && Weltstand.validate(d3, g).length > 0, 'ein eigener Schluessel __proto__ im Stand wird von beiden Pruefern abgelehnt');
  }
  const ohnePlan = kaputt((l) => { delete l.plan; }, true);
  ok(ohnePlan.liste.length === 0 && !ohnePlan.fehler, 'ein Faden mit der Id eines Abenteuers, aber ohne Plan, faellt weg (der Plan ginge sonst beim Speichern verloren)');
  const ausserdem = kaputt((l) => { l.plan.zusatz = 1; });
  ok(ausserdem.liste.length === 0, 'ein Plan mit unbekanntem Feld besteht die Form nicht');
  // ein ungueltiger Plan blockiert die anderen Faeden nicht
  const s5 = JSON.parse(JSON.stringify(sim)); const g5 = spiel();
  const fd = X.oeffne(g5, 'test_geschichte');
  const zweiter = JSON.parse(JSON.stringify(Weltstand.capture(g5).welt.sim.faeden.liste[0]));
  s5.faeden.liste[0].plan.beats.pop(); s5.faeden.liste.push(Object.assign(zweiter, { id: 'f7', nsc: Object.assign(zweiter.nsc, { id: 'n7', name: 'Ouzo Brandt' }) }));
  const g6 = spiel(); Kriegslage.restore(g6, s5);
  ok(g6.weltsim.faeden.liste.length === 1 && g6.weltsim.faeden.liste[0].id === 'f7' && fd, 'der ungueltige Plan faellt weg, ein anderer Faden im selben Stand bleibt');
});

// ---------------------------------------------------------------- (f) Altstand
section('(f) Altstand aus main (ohne Plan-Feld) laedt und laeuft 40 Ticks weiter', () => {
  const alt = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'faeden', 'main-sim-altstand.json'), 'utf8'));
  ok(alt.faeden.liste.length === 1 && alt.faeden.liste[0].vorlage === 'falscher_haendler' && !('plan' in alt.faeden.liste[0]), 'die Vorlage-Datei stammt aus main: ein Faden falscher_haendler ohne Plan-Feld');
  const g = spiel({ seed: 11 });
  Kriegslage.restore(g, alt);
  const f = g.weltsim.faeden.liste[0];
  ok(f && f.vorlage === 'falscher_haendler' && !f.plan && f.beat === 3 && f.phase === 'wartet' && g.weltsim.faeden.ladeFehler.length === 0, 'der Altstand ist da, Beat 3 (b_jagd), keine Ladefehler');
  ok(JSON.stringify(Faden.toSave(g.weltsim)) === JSON.stringify(alt.faeden), 'speichern ergibt denselben Block wie der Altstand (kein plan-Feld, nichts hinzugefuegt)');
  let weiter = 0, ausgaenge = 0;
  const t0 = g.weltsim.tickZahl;
  for (let k = 0; k < 40; k++) {
    Kriegslage.tick(g, 'test');
    g.lageGrenze(['szene_ende', 'andocken', 'absicht'][k % 3]);
    if (f.phase === 'wartet' && Faden.befehlPruefen(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id }) === null) { if (Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id }).ok) weiter++; }
    if (f.phase === 'laeuft') { Faden.beatAusgang(g, f.id, k % 2 ? 'gelungen' : 'gescheitert'); ausgaenge++; }
  }
  ok(g.weltsim.tickZahl >= t0 + 40, `40 Ticks gelaufen (${t0} bis ${g.weltsim.tickZahl})`);
  ok(f.phase === 'abgeschlossen' && weiter === 3 && ausgaenge === 2, `der Faden lief seine zwei letzten Beats (b_jagd, b_schlacht) und den Abschluss (${weiter} Starts, ${ausgaenge} Ausgaenge von Hand, der Abschluss endet beim Start)`);
  ok(g.errors === 0 && Pruefer.pruefeFaden(f).length === 0 && Weltstand.validate(Weltstand.capture(g), g).length === 0, 'keine Serverfehler, der Faden besteht pruefeFaden, der Stand ist schemagueltig');
  // ein Altstand laeuft auch neben einem neuen Abenteuer
  const g2 = spiel({ seed: 11 }); Kriegslage.restore(g2, alt);
  const o = abenteuer(g2, PLAN_VOLL, '0305');
  ok(o.f && g2.weltsim.faeden.liste.length === 2 && Weltstand.validate(Weltstand.capture(g2), g2).length === 0, 'neben dem Altfaden laesst sich ein Abenteuer oeffnen, der Stand bleibt schemagueltig');
});

// ---------------------------------------------------------------- (g) Obergrenzen
section('(g) Obergrenzen: 3 aktive Faeden, 1 laufendes Abenteuer, 3 offene Abenteuer-Angebote, Abstand, Verfall', () => {
  const P1 = plan([b('spontanhilfe'), b('abschluss')], { titel: 'Erstes Abenteuer' }), P2 = plan([b('notruf'), b('abschluss')], { titel: 'Zweites Abenteuer' }), P3 = plan([b('fracht'), b('abschluss')], { titel: 'Drittes Abenteuer' }), P4 = plan([b('raumschlacht'), b('abschluss')], { titel: 'Viertes Abenteuer' });
  const g = spiel();
  const a1 = Faden.abenteuerAnbieten(g, P1, { hex: '0305' }), a2 = Faden.abenteuerAnbieten(g, P2, { hex: '0202' }), a3 = Faden.abenteuerAnbieten(g, P3, { hex: '0203' });
  ok(a1.ok && a2.ok && a3.ok && g.weltsim.faeden.abenteuerAngebote.length === 3, 'drei Abenteuer-Angebote sind moeglich');
  const a4 = Faden.abenteuerAnbieten(g, P4, { hex: '0204' });
  ok(!a4.ok && /^ABENTEUER_ANGEBOTE/.test(a4.grund) && g.weltsim.faeden.abenteuerAngebote.length === 3, 'das vierte wird abgelehnt (ABENTEUER_ANGEBOTE), nichts verdraengt ein anderes: ' + a4.grund);
  ok(!Faden.abenteuerAnbieten(g, P1, { hex: '0305' }).ok, 'dasselbe Abenteuer am selben Ort doppelt: abgelehnt (hier greift schon die Obergrenze der Angebote)');
  const logs = (g.lageRegie ? g.lageRegie.log.entries : []).filter((e) => e.art === 'faden_pruefung');
  ok(logs.some((e) => e.key === 'abenteuer_anbieten'), 'die Ablehnung steht im Regie-Logbuch');
  // Titel und Anlass stammen aus der Modellantwort und koennen einen Spielernamen tragen: nie ins Regie-Logbuch (kein Eintrag, kein Feld)
  const gz = spiel();
  const zebra = Faden.abenteuerAnbieten(gz, { format: 'faden-bauplan/1', titel: 'ZEBRAKAI rettet alle', anlass: 'ZEBRAKAI ruft um Hilfe', beats: [{ typ: 'gibt_es_nicht' }] }, { hex: '0305' });
  ok(!zebra.ok, 'ein abgelehnter Plan mit Spielername im Titel: abgelehnt');
  const voll = spiel();
  for (const [i, h] of ['0305', '0202', '0203'].entries()) Faden.abenteuerAnbieten(voll, plan([b(['spontanhilfe', 'notruf', 'fracht'][i]), b('abschluss')], { titel: 'Probe ' + i }), { hex: h });
  const zebra2 = Faden.abenteuerAnbieten(voll, plan([b('raumschlacht'), b('abschluss')], { titel: 'ZEBRAKAI im Titel' }), { hex: '0204' });
  ok(!zebra2.ok && /^ABENTEUER_ANGEBOTE/.test(zebra2.grund), 'ein Plan mit Spielername im Titel bei vollen Angeboten: abgelehnt (ABENTEUER_ANGEBOTE)');
  const alle = (x) => JSON.stringify(x.lageRegie.log.entries);
  ok(gz.lageRegie.log.entries.some((e) => e.key === 'abenteuer_anbieten') && voll.lageRegie.log.entries.some((e) => e.key === 'abenteuer_anbieten'), 'beide Ablehnungen stehen im Regie-Logbuch');
  ok(!/ZEBRAKAI/i.test(alle(gz)) && !/ZEBRAKAI/i.test(alle(voll)), 'Titel und Anlass der Modellantwort (hier ein Spielername) tauchen in keinem Logbuch-Eintrag auf');
  const o1 = Faden.abenteuerOeffnen(g, a1.angebot.nr);
  ok(o1.ok && o1.faden.plan && g.weltsim.faeden.abenteuerAngebote.length === 2, 'das erste Abenteuer geht auf, ein Platz im Angebot wird frei');
  const o2 = Faden.abenteuerOeffnen(g, a2.angebot.nr);
  ok(!o2.ok && /^ABENTEUER_LAUFEND/.test(o2.grund) && g.weltsim.faeden.liste.length === 1, 'ein zweites laufendes Abenteuer: abgelehnt (ABENTEUER_LAUFEND), obwohl nur 1 von 3 Faeden aktiv ist: ' + o2.grund);
  ok(!Faden.abenteuerOeffnen(g, 999).ok && /^KEIN_ANGEBOT/.test(Faden.abenteuerOeffnen(g, 999).grund), 'ein Angebot, das es nicht gibt: KEIN_ANGEBOT');
  ok(Faden.abenteuerAnbieten(g, P4, { hex: '0204' }).ok, 'das vierte Abenteuer passt jetzt als Angebot');
  // Abenteuer abschliessen: dann ist wieder Platz fuer ein laufendes
  const f = o1.faden;
  for (let i = 0; i < 10 && f.phase !== 'abgeschlossen'; i++) { if (f.phase === 'wartet') bringeWeiter(g, f); if (f.phase === 'laeuft') Faden.beatAusgang(g, f.id, 'gelungen'); }
  ok(f.phase === 'abgeschlossen', 'das erste Abenteuer ist abgeschlossen');
  const o2b = Faden.abenteuerOeffnen(g, a2.angebot.nr);
  ok(o2b.ok, 'danach geht das naechste auf (laufend_max zaehlt nur nicht abgeschlossene)');
  // 3 aktive Faeden: zwei Dateien-Faeden + ein Abenteuer, dann ist Schluss (auch fuer die Dateien)
  const h = spiel();
  const fa = X.oeffne(h, 'test_geschichte'), fb = (X.registriere(X.alsVorlage('test_b')), X.oeffne(h, 'test_b'));
  const hb = Faden.abenteuerAnbieten(h, P1, { hex: '0305' }), ho = Faden.abenteuerOeffnen(h, hb.angebot.nr);
  ok(fa && fb && ho.ok && h.weltsim.faeden.liste.filter((x) => x.phase !== 'abgeschlossen').length === 3, 'drei aktive Faeden (zwei aus Dateien, ein Abenteuer)');
  const hc = Faden.abenteuerAnbieten(h, P2, { hex: '0202' }), hd = Faden.abenteuerOeffnen(h, hc.angebot.nr);
  ok(!hd.ok && /^OBERGRENZE/.test(hd.grund), 'ein weiteres: abgelehnt, die Obergrenze gilt weiter (' + hd.grund + ')');
  const j = spiel(); for (const id of ['x1', 'x2', 'x3']) X.registriere(X.alsVorlage('t_' + id));
  const ja = ['t_x1', 't_x2', 't_x3'].map((id) => X.oeffne(j, id));
  const jb = Faden.abenteuerAnbieten(j, P1, { hex: '0305' }), jo = Faden.abenteuerOeffnen(j, jb.angebot.nr);
  ok(ja.every(Boolean) && !jo.ok && /^OBERGRENZE/.test(jo.grund), 'bei drei aktiven Faeden aus Dateien: OBERGRENZE (3 aktive Faeden gelten fuer Abenteuer wie fuer alle): ' + jo.grund);
  // Abstand
  const k = spiel(), ko = abenteuer(k, P1, '0305');
  const ab = ko.f.abstand;
  ok(ab >= 2 && ab <= 4, `der Abstand liegt in 2 bis 4 (${ab})`);
  for (let i = 0; i < ab - 1; i++) { grenzen(k, 1); ok(/^ABSTAND/.test(Faden.befehlPruefen(k, { typ: 'faden_weiter', faden: ko.f.id, beat: ko.f.plan.beats[0].id })), `nach ${i + 1} Taetigkeiten noch kein Beat`); }
  grenzen(k, 1);
  ok(Faden.befehlPruefen(k, { typ: 'faden_weiter', faden: ko.f.id, beat: ko.f.plan.beats[0].id }) === null, `nach ${ab} Taetigkeiten ist der Beat faellig`);
  // Verfall der Angebote: 12 Taetigkeiten (Daten)
  const m = spiel(); Faden.abenteuerAnbieten(m, P1, { hex: '0305' });
  grenzen(m, 12); ok(m.weltsim.faeden.abenteuerAngebote.length === 1, 'nach 12 Taetigkeiten ist das Angebot noch da (Grenze inklusive)');
  grenzen(m, 1); ok(m.weltsim.faeden.abenteuerAngebote.length === 0, 'nach 13 verfaellt es');
  // Parameter beim Oeffnen
  const q = spiel(), qa = Faden.abenteuerAnbieten(q, plan([b('spontanhilfe'), b('abschluss')], { titel: 'Parameterprobe' }), { hex: '0305' });
  ok(!Faden.abenteuerOeffnen(q, qa.angebot.nr, { zauberei: 1 }).ok && !Faden.abenteuerOeffnen(q, qa.angebot.nr, { volk: 'ger' }).ok && !Faden.abenteuerOeffnen(q, qa.angebot.nr, { name: 'Erfundener Name' }).ok, 'unbekannter Parameter, unerlaubtes Volk, erfundener Name: abgelehnt');
  ok(Faden.abenteuerAnbieten(q, plan([b('spontanhilfe'), b('abschluss')], { titel: 'Ortsprobe' }), { hex: '9999' }).ok === false && Faden.abenteuerAnbieten(q, plan([b('spontanhilfe'), b('abschluss')], { titel: 'Ortsprobe' }), {}).ok === false, 'ohne spielbaren Ort kein Angebot');
  ok(q.weltsim.faeden.liste.length === 0, 'abgelehnte Oeffnungen veraendern nichts');
});

section('Ohne Schalter FAEDEN=1 tun die neuen Wege nichts', () => {
  const g = spiel({ aus: true });
  const a = Faden.abenteuerAnbieten(g, PLAN_VOLL, { hex: '0305' });
  ok(!a.ok && /^INAKTIV/.test(a.grund), 'abenteuerAnbieten: INAKTIV');
  ok(!Faden.abenteuerOeffnen(g, 1).ok, 'abenteuerOeffnen: abgelehnt');
  ok((!g.weltsim.faeden || g.weltsim.faeden.liste.length === 0) && Faden.toSave(g.weltsim) === null, 'nichts im Zustand, kein Block im Weltstand');
  const data = Weltstand.capture(g);
  ok(!('faeden' in data.welt.sim), 'der Weltstand hat keinen Block welt.sim.faeden');
  // selbst mit einem von Hand eingeschleusten Angebot oeffnet ohne Schalter nichts
  const v = BP.expandiere(plan([b('spontanhilfe'), b('abschluss')], { titel: 'Ohne Schalter' })).vorlage;
  g.weltsim.faeden = Faden.neu(); g.weltsim.faeden.abenteuerAngebote.push({ nr: 1, art: 'abenteuer', ref: v.id, hex: '0305', volk: '', vorlage: v, alter: 0 });
  const o = Faden.abenteuerOeffnen(g, 1);
  ok(!o.ok && /^INAKTIV/.test(o.grund) && g.weltsim.faeden.liste.length === 0, 'abenteuerOeffnen ohne Schalter: INAKTIV, auch mit vorhandenem Angebot kein Faden');
});

// ---------------------------------------------------------------- Expander gegen die Daten
const sichern = () => klon({ B: D.BEATS, BW: D.BAUPLAN.werte, WA: D.BAUPLAN.wahrheiten, H: D.BAUPLAN.hinweise });
function zurueck(s) { for (const [ziel, alt] of [[D.BEATS, s.B], [D.BAUPLAN.werte, s.BW], [D.BAUPLAN.wahrheiten, s.WA], [D.BAUPLAN.hinweise, s.H]]) { for (const k of Object.keys(ziel)) delete ziel[k]; Object.assign(ziel, klon(alt)); } }
function mitDaten(aendern, fn) { const s = sichern(); try { aendern(); return fn(); } finally { zurueck(s); } }

section('Expander: Typ ohne Standards, erfolg_max, Daten in sich stimmig (katalogFehler hat Zaehne)', () => {
  const r1 = mitDaten(() => { D.BEATS.nur_katalog = { zweck: 'Probe', baustein: 'bitte', gefahr: false, optionen: 'keine', braucht: { nsc_status: ['aktiv'] }, parameter: { pflicht: [], optional: [] } }; }, () => BP.expandiere(plan([b('nur_katalog'), b('abschluss')])));
  ok(!r1.ok && r1.codes.includes('BAUPLAN_TYP_NICHT_PLANBAR') && !r1.codes.includes('TYP_UNBEKANNT'), 'ein Katalogtyp ohne bauplan-Standards kann in keinem Plan stehen (BAUPLAN_TYP_NICHT_PLANBAR)');
  const p3 = plan([b('spontanhilfe'), b('notruf'), b('abschluss')]);
  const r2 = mitDaten(() => { D.BAUPLAN.werte.erfolg_max = 1; }, () => ({ a: BP.expandiere(p3), b: BP.expandiere(plan([b('spontanhilfe'), b('notruf'), b('abschluss', { erfolg: ['spontanhilfe', 'notruf'] })])) }));
  ok(r2.a.ok && JSON.stringify(r2.a.vorlage.beats[2].erfolg.ereignis) === '["notruf_gelungen"]', 'erfolg_max 1: ohne Angabe zaehlt nur der letzte Typ (notruf_gelungen)');
  ok(!r2.b.ok && r2.b.codes.includes('ERFOLG_UNGUELTIG'), 'erfolg_max 1: zwei genannte Typen im Plan werden abgelehnt (ERFOLG_UNGUELTIG)');
  const kaputtPlan = mitDaten(() => { D.BEATS.befreiung.bauplan.start_status = 'aktiv'; BP.katalogNeuLesen(); }, () => BP.expandiere(plan([b('spontanhilfe'), b('abschluss')])));
  BP.katalogNeuLesen();
  ok(!kaputtPlan.ok && kaputtPlan.codes.join() === 'BAUPLAN_KATALOG' && BP.expandiere(plan([b('spontanhilfe'), b('abschluss')])).ok, 'kaputte Daten werden vor dem ersten Plan gemeldet (BAUPLAN_KATALOG), mit heilen Daten laeuft der Expander wieder');
  ok(BP.katalogFehler().length === 0, 'Ausgangslage: katalogFehler leer');
  const KAPUTT = [
    ['id_praefix mit Grossbuchstaben', () => { D.BAUPLAN.werte.id_praefix = 'Abenteuer_'; }, 'id_praefix'],
    ['id_praefix zu lang fuer die Vorlagen-Id', () => { D.BAUPLAN.werte.id_praefix = 'abenteuer_abenteuer_x'; }, 'id_praefix'],
    ['ausloeser mit unbekannter Art', () => { D.BAUPLAN.werte.ausloeser.art = 'lotterie'; }, 'ausloeser'],
    ['Standard-Volk unbekannt', () => { D.BAUPLAN.werte.volk_erlaubt_standard = ['atlantis']; }, 'volk_erlaubt_standard'],
    ['wahrheit_standard unbekannt', () => { D.BAUPLAN.werte.wahrheit_standard = 'ist_kaiser'; }, 'wahrheit_standard'],
    ['erfolg_max fehlt', () => { delete D.BAUPLAN.werte.erfolg_max; }, 'erfolg_max fehlt'],
    ['erfolg_max groesser als das Schema der Vorlage', () => { D.BAUPLAN.werte.erfolg_max = 9; }, 'erfolg_max ist groesser'],
    ['Hinweis mit unbekanntem Kanal', () => { D.BAUPLAN.hinweise.h_scan.kanal = 'telepathie'; }, 'Kanal'],
    ['Hinweis ohne mit_name', () => { delete D.BAUPLAN.hinweise.h_scan.mit_name; }, 'mit_name fehlt'],
    ['Hinweis ohne Text', () => { D.BAUPLAN.hinweise.h_scan.text = 'kurz'; }, 'Text fehlt'],
    ['Hinweis mit fremdem Platzhalter', () => { D.BAUPLAN.hinweise.h_scan.text = 'Scan bei {ziel}: nichts Besonderes zu sehen.'; }, 'nur {name} und {ort}'],
    ['Hinweis ohne mit_name nennt trotzdem {name}', () => { D.BAUPLAN.hinweise.h_scan.text = 'Scan bei {ort}: {name} ist nicht, wer er vorgibt.'; }, 'ohne mit_name'],
    ['Hinweis beginnt mit {name}:', () => { D.BAUPLAN.hinweise.h_gerucht.text = '{name}: hat noch kein Kontor je eine Lieferung gesehen.'; }, 'am Anfang'],
    ['Wahrheit mit ungueltiger Kennung', () => { D.BAUPLAN.wahrheiten.Ist_Kaiser = { hinweise: ['h_scan'] }; }, 'Kennung'],
    ['Wahrheit mit unbekannter Fraktion', () => { D.BAUPLAN.wahrheiten.ist_germane.fraktion = 'atlantis'; }, 'Fraktion'],
    ['Wahrheit mit unbekanntem Hinweis', () => { D.BAUPLAN.wahrheiten.ist_germane.hinweise.push('h_gibts_nicht'); }, 'unbekanntem Hinweis'],
    ['Wahrheit ohne Hinweis ohne {name}', () => { D.BAUPLAN.wahrheiten.ist_germane.hinweise = ['h_gerucht', 'h_papiere']; }, 'ohne {name}'],
    ['Wahrheit mit mehr als 8 Hinweisen', () => { for (let i = 0; i < 9; i++) { D.BAUPLAN.hinweise['h_x' + i] = { kanal: 'scan', mit_name: false, text: 'Scan bei {ort}: Probe ' + i }; D.BAUPLAN.wahrheiten.ist_germane.hinweise.push('h_x' + i); } }, 'mehr als 8'],
    ['start_status nicht erlaubt fuer den Typ', () => { D.BEATS.befreiung.bauplan.start_status = 'aktiv'; }, 'start_status'],
    ['hinweis_traeger fehlt', () => { delete D.BEATS.notruf.bauplan.hinweis_traeger; }, 'hinweis_traeger'],
    ['Parameter steht nicht im Katalog des Typs', () => { D.BEATS.spontanhilfe.bauplan.parameter.zauber = { standard: 'a', erlaubt: ['a'] }; }, 'steht nicht in parameter'],
    ['Standard steht nicht in erlaubt', () => { D.BEATS.notruf.bauplan.parameter.text_key.standard = 'gibt_es_nicht'; }, 'standard fehlt oder steht nicht in erlaubt'],
    ['text_key mit Grossbuchstaben', () => { D.BEATS.notruf.bauplan.parameter.text_key.erlaubt.push('Gross'); }, 'ungueltig'],
    ['Bitten-Text steht nicht in bitte-werte.json', () => { D.BEATS.bitte.bauplan.parameter.text_key.erlaubt.push('gibt_es_nicht'); }, 'bitte-werte.json'],
    ['Bitten-Text hat eine Ton-Variante', () => { D.BEATS.bitte.bauplan.parameter.text_key.erlaubt.push('bitte_mission'); }, 'Ton-Variante'],
    ['Notruf-Text steht nicht in p3-texte.json', () => { D.BEATS.notruf.bauplan.parameter.text_key.erlaubt.push('gibt_es_nicht'); }, 'p3-texte.json'],
    ['Pflichtparameter ohne Standard', () => { delete D.BEATS.verfolgung.bauplan.parameter.fluchtziel; }, 'Pflichtparameter'],
    ['aus.gelungen fehlt', () => { delete D.BEATS.fracht.bauplan.aus.gelungen; }, 'aus.gelungen fehlt'],
    ['aus.folge fehlt', () => { delete D.BEATS.fracht.bauplan.aus.gescheitert.folge; }, 'folge fehlt'],
    ['aus.folge mit unbekanntem Grund', () => { D.BEATS.fracht.bauplan.aus.gescheitert.folge = [{ typ: 'haltung_aenderung', grund: 'gibt_es_nicht' }]; }, 'unbekannter'],
    ['aus.status leer', () => { D.BEATS.fracht.bauplan.aus.gelungen.status = []; }, 'status ist leer'],
    ['aus.status mit unbekanntem Zustand', () => { D.BEATS.fracht.bauplan.aus.gelungen.status = ['verschwunden']; }, 'status ist leer oder'],
    ['optionen_pflicht bei einem Typ ohne Optionen', () => { D.BEATS.notruf.bauplan.optionen_pflicht = true; D.BEATS.notruf.bauplan.optionen = D.BEATS.bitte.bauplan.optionen; }, 'optionen_pflicht, aber'],
    ['Optionen bei einem Typ mit Gefahr', () => { D.BEATS.raumschlacht.bauplan.optionen = D.BEATS.bitte.bauplan.optionen; }, 'ohne Gefahr'],
    ['Standard-Optionen mit Scheinwahl', () => { D.BEATS.bitte.bauplan.optionen[1].folge = D.BEATS.bitte.bauplan.optionen[0].folge; D.BEATS.bitte.bauplan.optionen[1].ausgang = 'gelungen'; }, 'Standard-Optionen ungueltig'],
    ['optionen_pflicht ohne optionen', () => { delete D.BEATS.bitte.bauplan.optionen; }, 'optionen_pflicht ohne optionen'],
  ];
  for (const [text, aendern, erwartet] of KAPUTT) {
    const f = mitDaten(aendern, () => BP.katalogFehler());
    ok(f.length >= 1 && f.some((t) => /^BAUPLAN_KATALOG: /.test(t) && t.includes(erwartet)), `katalogFehler: ${text} -> "${erwartet}" (${f.slice(0, 1).join('').slice(0, 90) || 'nichts gemeldet'})`);
  }
  ok(BP.katalogFehler().length === 0, 'nach allen Proben sind die Daten wieder unveraendert (katalogFehler leer)');
});

// ---------------------------------------------------------------- Pruefer: namenlos
section('Pruefer: ein namenloses Abenteuer entkoppelt nur den Status, die Statuspruefung bleibt (NAMENLOS)', () => {
  const basis = BP.expandiere(plan([b('spontanhilfe'), b('raumschlacht'), b('abschluss')], { namenlos: true })).vorlage;
  const pv = (aendern) => { const v = klon(basis); aendern(v); return Pruefer.pruefeVorlage(v).fehler.map((t) => t.split(':')[0]); };
  ok(Pruefer.pruefeVorlage(klon(basis)).ok, 'Ausgangslage: die namenlose Vorlage ist gueltig (Ausgaenge ohne status)');
  ok(pv((v) => { v.nsc.status = 'gefangen'; }).includes('NAMENLOS'), 'namenloser NSC startet gefangen: NAMENLOS');
  ok(pv((v) => { v.beats[0].aus.gelungen.status = 'verbuendet'; }).includes('NAMENLOS'), 'ein Ausgang setzt einen anderen Zustand als aktiv: NAMENLOS');
  ok(pv((v) => { v.nsc.rolle = 'spion'; }).includes('NSC'), 'unbekannte Rolle: NSC');
  ok(pv((v) => { v.beats[0].variante = { wenn: 'feindlich', typ: 'raumschlacht', aus: { gelungen: { status: 'feindlich' }, gescheitert: { status: 'geflohen' } } }; }).includes('NAMENLOS'), 'feindliche Variante in einem namenlosen Abenteuer: NAMENLOS');
  ok(pv((v) => { v.beats[1].typ = 'befreiung'; }).includes('STATUS_PASST_NICHT'), 'die Statuspruefung bleibt: eine Befreiung verlangt einen gefangenen NSC, der namenlose bleibt aktiv (STATUS_PASST_NICHT)');
  ok(pv((v) => { v.beats[1].aus.gescheitert = klon(v.beats[1].aus.gelungen); }).includes('SCHEITERN_FOLGENLOS'), 'namenlos: gleicher Weg und gleiche Folge bei Gelingen und Scheitern: SCHEITERN_FOLGENLOS');
  ok(!pv((v) => { v.beats[1].aus.gescheitert = { folge: [{ typ: 'haltung_aenderung', grund: 'verraten' }] }; }).includes('SCHEITERN_FOLGENLOS'), 'namenlos: gleicher Weg, aber andere Folge veraendert den Faden (kein Fehler)');
  // nicht abgeschwaecht: ohne namenlos zaehlt die Folge nicht, Zustand und Weg entscheiden wie in 04a
  const voll = BP.expandiere(plan([b('spontanhilfe'), b('raumschlacht'), b('abschluss')])).vorlage;
  const v2 = klon(voll); v2.beats[1].aus.gescheitert.status = v2.beats[1].aus.gelungen.status; v2.beats[1].aus.gescheitert.folge = [{ typ: 'haltung_aenderung', grund: 'verraten' }];
  ok(Pruefer.pruefeVorlage(v2).fehler.some((t) => t.startsWith('SCHEITERN_FOLGENLOS')), 'ohne namenlos: gleicher Zustand und gleicher Weg bleibt SCHEITERN_FOLGENLOS, auch wenn die Folge anders ist (04a-Regel nicht abgeschwaecht)');
  const v3 = klon(voll); delete v3.beats[0].aus.gelungen.status;
  ok(Pruefer.pruefeVorlage(v3).fehler.some((t) => t.startsWith('AUSGANG_UNGUELTIG')), 'ohne namenlos braucht jeder Ausgang weiter einen status (AUSGANG_UNGUELTIG)');
  const v4 = klon(voll); v4.beats[1].typ = 'befreiung';
  ok(Pruefer.pruefeVorlage(v4).fehler.some((t) => t.startsWith('STATUS_PASST_NICHT')), 'ohne namenlos: STATUS_PASST_NICHT wie bisher');
});

// ---------------------------------------------------------------- Anbieten und Oeffnen: einzelne Regeln
section('Anbieten und Oeffnen: ungueltige Plaene, doppelte Angebote, Parameter, Namen, Laden mit zwei Abenteuern', () => {
  const P1 = plan([b('spontanhilfe'), b('abschluss')], { titel: 'Erstes Abenteuer' });
  const g = spiel();
  for (const u of [plan([b('spontanhilfe'), b('notruf')]), plan([b('enthuellung'), b('abschluss')]), 'kein Plan', plan([b('wunder'), b('abschluss')])]) {
    const a = Faden.abenteuerAnbieten(g, u, { hex: '0305' });
    ok(!a.ok && !a.angebot && /^[A-Z_]+: /.test(a.grund) && g.weltsim.faeden.abenteuerAngebote.length === 0, 'ein ungueltiger Plan wird nie angeboten: ' + a.grund.slice(0, 60));
  }
  const a1 = Faden.abenteuerAnbieten(g, P1, { hex: '0305' });
  const a2 = Faden.abenteuerAnbieten(g, P1, { hex: '0305' });
  ok(a1.ok && !a2.ok && /^ABENTEUER_DOPPELT/.test(a2.grund) && g.weltsim.faeden.abenteuerAngebote.length === 1, 'dasselbe Abenteuer am selben Ort doppelt: ABENTEUER_DOPPELT');
  ok(Faden.abenteuerAnbieten(g, P1, { hex: '0202' }).ok, 'dasselbe Abenteuer an einem anderen Ort ist ein eigenes Angebot');
  const rom = D.NAMEN.rom, name = rom.vornamen[0] + ' ' + rom.nachnamen[0];
  const o = Faden.abenteuerOeffnen(g, a1.angebot.nr, { volk: 'rom', name });
  ok(o.ok && o.faden.nsc.name === name && o.faden.parameter.volk === 'rom', 'Volk und Name aus den Listen werden angenommen');
  const f = o.faden;
  for (let i = 0; i < 10 && f.phase !== 'abgeschlossen'; i++) { if (f.phase === 'wartet') bringeWeiter(g, f); if (f.phase === 'laeuft') Faden.beatAusgang(g, f.id, 'gelungen'); }
  const a3 = Faden.abenteuerAnbieten(g, plan([b('notruf'), b('abschluss')], { titel: 'Zweites Abenteuer' }), { hex: '0203' });
  const o2 = Faden.abenteuerOeffnen(g, a3.angebot.nr, { volk: 'rom', name });
  ok(f.phase === 'abgeschlossen' && !o2.ok && /^NAME.*schon vergeben/.test(o2.grund), 'ein Name, den ein Faden (auch ein abgeschlossener) traegt, ist vergeben: NAME');
  ok(!Faden.abenteuerOeffnen(g, a3.angebot.nr, { volk: 'rom', name: 'Erfundener Name' }).ok, 'ein erfundener Name wird abgelehnt');
  ok(!Faden.abenteuerOeffnen(g, a3.angebot.nr, 'kein Objekt').ok && !Faden.abenteuerOeffnen(g, 'x').ok && !Faden.abenteuerOeffnen(g, 1.5).ok, 'Parameter, die kein Objekt sind, und Angebots-Nummern, die keine ganzen Zahlen sind: abgelehnt');
  ok(Faden.abenteuerOeffnen(g, a3.angebot.nr).ok, 'ohne Parameter geht es auf (NSC aus den Datenlisten)');
  ok(g.errors === 0, 'keine Serverfehler');
  // Laden: zwei laufende Abenteuer in einem Stand -> nur das erste bleibt
  const h = spiel(), h1 = abenteuer(h, P1, '0305').f;
  const sim = JSON.parse(JSON.stringify(Weltstand.capture(h).welt.sim));
  const zw = JSON.parse(JSON.stringify(sim.faeden.liste[0]));
  const pl2 = plan([b('notruf'), b('abschluss')], { titel: 'Zweites Abenteuer' }), v2 = BP.expandiere(pl2).vorlage;
  zw.id = 'f9'; zw.vorlage = v2.id; zw.plan = v2; zw.nsc.id = 'n9'; zw.nsc.name = rom.vornamen[1] + ' ' + rom.nachnamen[1];
  sim.faeden.liste.push(zw);
  const h2 = spiel(); Kriegslage.restore(h2, sim);
  ok(h2.weltsim.faeden.liste.length === 1 && h2.weltsim.faeden.liste[0].id === h1.id && h2.weltsim.faeden.ladeFehler.some((t) => /laufendes Abenteuer/.test(t)), 'ein Stand mit zwei laufenden Abenteuern: nur das erste bleibt (laufend_max), Meldung');
  // Register: eine Vorlage der Dateien mit Abenteuer-Id
  const w = BP.expandiere(plan([b('notruf'), b('abschluss')], { titel: 'Kollision' })).vorlage;
  const kopie = klon(w); D.registriere(kopie);
  const k = D.registriereAbenteuer(klon(w));
  ok(!k.ok && /Vorlage der Dateien/.test(k.fehler[0]), 'eine Id, die schon einer Vorlage der Dateien gehoert, wird abgelehnt');
  D.entferne(w.id);
  ok(!D.registriereAbenteuer({ id: 'abenteuer_123456789012' }).ok && !D.registriereAbenteuer(null).ok && !D.registriereAbenteuer('x').ok, 'Muell als Plan: abgelehnt, kein Wurf');
});

section('Register: zuruecksetzen leert auch die Abenteuer', () => {
  const v = BP.expandiere(plan([b('spontanhilfe'), b('abschluss')], { titel: 'Registerprobe' })).vorlage;
  ok(D.registriereAbenteuer(klon(v)).ok && D.vorlage(v.id) !== null, 'eingetragen');
  D.zuruecksetzen();
  ok(D.vorlage(v.id) === null && D.vorlagenIds().length === 3, 'nach zuruecksetzen: weg, die drei Vorlagen der Dateien sind wieder geladen');
});

console.log(`\n${n - fails}/${n} Pruefungen ok`);
if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
