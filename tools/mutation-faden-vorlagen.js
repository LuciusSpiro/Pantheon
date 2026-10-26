'use strict';
// SUND-04a-2 P3: Mutationsprobe der Fadenvorlagen. Jede Mutation verändert eine GEPRUEFTE Vorlage (Kopie, nur Daten) so, dass eine Regel verletzt ist;
// der Pruefer muss den erwarteten Code melden. Anker-Selbstcheck zuerst: die unveränderten Vorlagen müssen bestehen (sonst Exit 2).
// Abstürze zählen NICHT als erkannt. Aufruf: node tools/mutation-faden-vorlagen.js [--trocken]   (--trocken: nur der Anker-Selbstcheck)
const fs = require('fs');
const path = require('path');
const Pruefer = require('../server/sim/faden-pruefer.js');

const VORLAGEN = ['dankbarer_captain', 'entfuehrter_haendler', 'falscher_haendler'];
const laden = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'vorlagen', id + '.json'), 'utf8'));
const kopie = (id) => JSON.parse(JSON.stringify(laden(id)));
const beat = (v, id) => v.beats.find((b) => b.id === id);

// Anker: unveraendert muessen alle drei Vorlagen bestehen
const anker = VORLAGEN.filter((id) => { try { return !Pruefer.pruefeVorlage(laden(id)).ok; } catch (e) { return true; } });
if (anker.length) { console.log('ANKER FEHLER: unveraenderte Vorlagen bestehen nicht: ' + anker.join(', ')); process.exit(2); }
console.log('Anker ok: ' + VORLAGEN.length + ' Vorlagen bestehen unveraendert');
if (process.argv.includes('--trocken')) { console.log('--trocken: Anker ok, keine Mutationen'); process.exit(0); }

const MUT = [
  ['Hinweis vor der Enthuellung entfernt (falscher Haendler)', 'falscher_haendler', (v) => { delete beat(v, 'b_bitte').hinweise; delete beat(v, 'b_fracht').hinweise; }, 'HINWEIS_FEHLT'],
  ['Hinweis nur auf einem Weg (Bitte ohne Hinweis, Fracht ohne Hinweis, Ablehnung)', 'falscher_haendler', (v) => { delete beat(v, 'b_bitte').hinweise; beat(v, 'b_fracht').aus.gescheitert.weiter = 'b_enthuell'; delete beat(v, 'b_fracht').hinweise; }, 'HINWEIS_FEHLT'],
  ['Option bei Gefahr (Spontanhilfe bekommt Optionen)', 'dankbarer_captain', (v) => { beat(v, 'b_spontan').optionen = [{ id: 'a', text: 'Ja', folge: [], ausgang: 'gelungen' }, { id: 'b', text: 'Nein', folge: [{ typ: 'haltung_aenderung', grund: 'bitte_abgelehnt' }], ausgang: 'gescheitert' }]; }, 'OPTION_BEI_GEFAHR'],
  ['Gefahr abgeschwaecht (Spontanhilfe als ungefaehrlich)', 'dankbarer_captain', (v) => { beat(v, 'b_spontan').gefahr = false; }, 'GEFAHR_ABGESCHWAECHT'],
  ['Scheitern veraendert nichts (gleicher Zustand, gleicher Weg)', 'dankbarer_captain', (v) => { const b = beat(v, 'b_mission'); b.aus.gescheitert = { status: b.aus.gelungen.status, weiter: b.aus.gelungen.weiter }; }, 'SCHEITERN_FOLGENLOS'],
  ['Abschluss nicht der letzte Beat', 'entfuehrter_haendler', (v) => { const a = v.beats.pop(); v.beats.splice(1, 0, a); }, 'ABSCHLUSS_NICHT_LETZT'],
  ['Scheinwahl (zwei Optionen mit gleicher Folge)', 'dankbarer_captain', (v) => { const o = beat(v, 'b_bitte').optionen; o[1].folge = JSON.parse(JSON.stringify(o[0].folge)); o[1].ausgang = o[0].ausgang; }, 'SCHEINWAHL'],
  ['Enthuellung ohne verborgene Wahrheit', 'falscher_haendler', (v) => { delete v.wahrheit; }, 'ENTHUELLUNG_OHNE_WAHRHEIT'],
  ['Variante mit einem Typ, der nicht zu einem Gegner passt (Bitte)', 'dankbarer_captain', (v) => { beat(v, 'b_spontan').variante = { wenn: 'feindlich', typ: 'bitte' }; }, 'VARIANTE'],
  ['Auslöser mit unbekannter Art', 'entfuehrter_haendler', (v) => { v.ausloeser[0].art = 'rettung'; }, 'AUSLOESER'],
  ['Weiter nach hinten (Schleife)', 'falscher_haendler', (v) => { beat(v, 'b_enthuell').aus.gelungen.weiter = 'b_bitte'; }, 'WEITER_UNGUELTIG'],
  ['Status passt nicht (Enthuellung nach totem NSC)', 'entfuehrter_haendler', (v) => { beat(v, 'b_notruf').aus.gelungen.status = 'tot'; beat(v, 'b_notruf').aus.gelungen.weiter = 'b_befreiung'; }, 'STATUS_PASST_NICHT'],
  ['Unbekannter Beat-Typ', 'dankbarer_captain', (v) => { beat(v, 'b_mission').typ = 'geiseln_befreien'; }, 'TYP_UNBEKANNT'],
];

let erkannt = 0, verfehlt = [], absturz = [];
for (const [titel, id, mut, code] of MUT) {
  let ergebnis;
  try {
    const v = kopie(id);
    mut(v);
    const r = Pruefer.pruefeVorlage(v);
    ergebnis = !r.ok && r.fehler.some((t) => t.startsWith(code + ':'));
    if (!ergebnis) verfehlt.push(`${titel} (erwartet ${code}; gemeldet: ${r.fehler.map((t) => t.split(':')[0]).join(', ') || 'nichts'})`);
  } catch (e) {
    absturz.push(`${titel}: ${e && e.message}`);
    ergebnis = false;
  }
  if (ergebnis) erkannt++;
  console.log(`  ${ergebnis ? 'erkannt ' : 'VERFEHLT'} ${titel}`);
}
console.log(`\n${erkannt} von ${MUT.length} Mutationen erkannt`);
if (absturz.length) console.log('Abstuerze (zaehlen nicht als erkannt): ' + absturz.join(' | '));
if (verfehlt.length) console.log('Verfehlt: ' + verfehlt.join(' | '));
process.exit(erkannt === MUT.length ? 0 : 1);
