'use strict';
// SUND-04a-2 P3: Mutationsprobe der Fadenvorlagen. Jede Mutation verändert eine GEPRUEFTE Vorlage (Kopie, nur Daten) so, dass eine Regel verletzt ist;
// der Pruefer muss den erwarteten Code melden. Anker-Selbstcheck zuerst: die unveränderten Vorlagen müssen bestehen (sonst Exit 2).
// Abstürze zählen NICHT als erkannt. Aufruf: node tools/mutation-faden-vorlagen.js [--trocken]   (--trocken: nur der Anker-Selbstcheck beider Teile)
// Teil 1: Daten-Mutationen der Vorlagen (Prüfer). Teil 2 (codeProbe, unten): Code-Mutationen der Sprengung, des Notrufs, der Plan-Sperre, des Katalogtexts und des Lesers gegen test-faden-vorlagen.js.
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
if (process.argv.includes('--trocken')) { codeProbe(true); console.log('--trocken: Anker ok, keine Mutationen'); process.exit(0); }

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
const code = codeProbe(false);
process.exit(erkannt === MUT.length && code.ok ? 0 : 1);

// ---------------------------------------------------------------------------------------------------------------------------
// Teil 2 (Nacharbeit SUND-04a-2 Welle 1): CODE-Mutationen. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel
// der Sprengung, des Notrufs und ihrer Randregeln und verlangt, dass einer der Tests rot wird (Exit != 0 MIT FEHLER-Zeile; Abstuerze, SyntaxErrors und 'ABSTURZ Ausnahme' zaehlen NICHT als erkannt).
// Anker-Selbstcheck vor jedem Lauf: jeder Anker muss genau einmal im Quelltext der Kopie stehen, sonst Exit 2.
function codeProbe(trocken) {
  const os = require('os');
  const { spawnSync } = require('child_process');
  const ROOT = path.join(__dirname, '..');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-faden-code-'));
  const weg = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } };
  for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
  fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
  const TESTS = [['tools/test-faden-vorlagen.js'], ['tools/test-sektoren.js']];
  for (const f of [...TESTS.map((t) => t[0]), 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'tools/sprungkette.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
  if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

  const P3 = 'server/sim/faden-p3.js', RB = 'server/sim/regie-befehle.js', LPR = 'server/sim/lage-prompt.js', KB = 'server/weltsim/befehle.js', SK = 'shared/sektoren.js', LBJ = 'content/flotte/lage-befehle.json', FD = 'server/sim/faden.js';
  // [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
  const MUTATIONEN = [
    [P3, "if (!nd.posten || nd.besitzer !== 'rom' || nd.crew === true) continue;", "if (!nd.posten || nd.besitzer !== 'rom') continue;", 'Sprengung: ein Posten der Crew ist ein Ziel'],
    [P3, 'if (d === null || d > reichweite) continue;', 'if (d === null) continue;', 'Sprengung: ohne Reichweitengrenze'],
    [P3, 'if (d < bd) { best = code; bd = d; }', 'if (d <= bd) { best = code; bd = d; }', 'Sprengung: bei Gleichstand der groessere Code'],
    [P3, 'const d = Sektoren.hexAbstand(ort, code);', 'const d = Math.hypot(Number(ort.slice(0, 2)) - Number(code.slice(0, 2)), Number(ort.slice(2)) - Number(code.slice(2)));', 'Sprengung: Luftlinie der Spalten und Zeilen statt Hex-Abstand'],
    [P3, "return { ausgang: r.ok ? 'gelungen' : 'gescheitert' };", "return { ausgang: 'gelungen' };", 'Enthuellung ohne Ziel gilt als gelungen'],
    [P3, 'for (const f of F.liste.slice()) {\n    if (notrufOrt(f) !== hier) continue;', 'for (const f of F.liste.slice(0, 1)) {\n    if (notrufOrt(f) !== hier) continue;', 'Notruf: nur der erste Faden zaehlt (mehrere Notrufe gleichzeitig gehen nicht)'],
    [P3, "if (!beat || beat.id !== f.laufend.beat || !D.BEATS[beat.typ] || D.BEATS[beat.typ].baustein !== 'notruf') return null;", "if (!beat || !D.BEATS[beat.typ] || D.BEATS[beat.typ].baustein !== 'notruf') return null;", 'Notruf: ein anderer laufender Beat des Fadens zaehlt (kein Abgleich mit dem laufenden Beat)'],
    [FD, "for (const f of F.liste) if (f.phase === 'laeuft' && D.BEATS[D.vorlage(f.vorlage).beats[f.beat].typ].szene) {", "for (const f of F.liste) if (f.phase === 'laeuft' && (D.BEATS[D.vorlage(f.vorlage).beats[f.beat].typ].szene || D.BEATS[D.vorlage(f.vorlage).beats[f.beat].typ].baustein === 'notruf')) {", 'Notruf-Beat steht nach dem Laden wieder aus (Zustand geht beim Speichern verloren)'],
    [RB, '  s.vorgemerkt.push({ b, ab, w: 1 });', '  s.vorgemerkt.push({ b, ab });', 'Sprengung ohne Kennzeichen „angekuendigt“ (keine Entwarnung)'],
    [RB, "  if (f) funkSenden(game, f);\n  schreibe(game, { art: 'lage_befehl', ausgang: 'vorgemerkt', key: 'sabotage'", "  schreibe(game, { art: 'lage_befehl', ausgang: 'vorgemerkt', key: 'sabotage'", 'Sprengung ohne Vorwarnung per Funk'],
    [RB, "  if (b.typ === 'sabotage') return 'Sprengung kommt nur aus einer Enthüllung eines Fadens, nicht aus einem Plan';", '', 'ein Plan des Spielleiters darf die Sprengung ausloesen'],
    [LPR, "if (typ === 'sabotage') continue;", "if (typ === 'sabotage') { L.push('- sabotage { ort } – Sprengung eines Postens'); continue; }", 'Katalogtext des Spielleiters zeigt die Sprengung'],
    [RB, "const sab = istObjekt(e) && istObjekt(e.b) && e.b.typ === 'sabotage';", 'const sab = false;', 'Leser: die Sprengung wird ueber vorgemerkt_max abgeschnitten'],
    [RB, '      if (sab) nSab++;\n', '', 'Leser: die Sprengungen haben keine eigene Obergrenze'],
    [KB, "      if (z.hexe[b.ort].crew === true) return 'Posten der Crew ist kein Sprengziel';   // SUND-04a-2 Nacharbeit L12\n", '', 'Kern-Pruefer: ein Posten der Crew ist ein Sprengziel'],
    [LBJ, '    "sabotage": {"sprecher": "Aufklärung", "text": "Entwarnung: Die Sprengladung bei {ziel} ist entschärft worden, sie geht nicht hoch."},\n', '', 'Entwarnung der Sprengung fehlt (Daten)'],
    [SK, 'return Math.max(Math.abs(u.x - v.x), Math.abs(u.y - v.y), Math.abs(u.z - v.z));', 'return Math.max(Math.abs(u.x - v.x), Math.abs(u.z - v.z));', 'hexAbstand rechnet die dritte Achse nicht mit'],
  ];

  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, datei), 'utf8')); } catch (e) { schlecht.push(was + ': Datei ' + datei + ' nicht lesbar'); continue; }
    const k = text.split(alt).length - 1;
    if (k !== 1) schlecht.push(was + ': Anker ' + (k === 0 ? 'nicht gefunden' : k + 'x gefunden') + ' (' + datei + ')');
  }
  if (schlecht.length) { console.log('Anker-Check (Code): ' + schlecht.length + ' von ' + MUTATIONEN.length + ' Mutationen nicht anwendbar:\n  ' + schlecht.join('\n  ')); weg(); process.exit(2); }
  console.log('Anker-Check (Code): alle ' + MUTATIONEN.length + ' Anker genau einmal gefunden.');
  if (trocken) { weg(); return { ok: true, gesamt: MUTATIONEN.length }; }

  const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
  const FEHLERZEILEN = (r) => ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
  for (const t of TESTS) {
    const basis = lauf(t);
    console.log('  Ausgangslage ' + t.join(' ') + ': ' + (basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'));
    if (basis.status !== 0) { console.log(FEHLERZEILEN(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); weg(); process.exit(1); }
  }
  console.log('Mutationsprobe Code (' + MUTATIONEN.length + ' Mutationen: Sprengung, Notruf, Leser, Plan-Sperre, Katalogtext, Entwarnung)');
  let ueberlebt = 0, erkannt = 0, abstuerze = 0;
  for (const [datei, alt, neu, was] of MUTATIONEN) {
    const f = path.join(TMP, datei);
    const orig = fs.readFileSync(f, 'utf8');
    const nl = orig.includes('\r\n');
    const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
    fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
    let wer = null, fehler = [], absturz = null;
    for (const t of TESTS) {
      const r = lauf(t);
      if (r.status === 0) continue;
      const fz = FEHLERZEILEN(r);
      if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
      if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|ABSTURZ|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || 'Exit ' + r.status };
    }
    fs.writeFileSync(f, orig);
    if (wer) { erkannt++; console.log('  rot    ' + was + ' (' + wer + ': ' + fehler.length + ' Fehler, z. B. ' + fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64) + ')'); }
    else if (absturz) { abstuerze++; console.log('  ABSTURZ ' + was + ' (' + absturz.test + ': ' + absturz.text + ') – nicht als erkannt gezaehlt'); }
    else { ueberlebt++; console.log('  GRUEN  ' + was + '  <-- UEBERLEBT'); }
  }
  weg();
  console.log('Ergebnis Code: ' + erkannt + ' erkannt, ' + ueberlebt + ' ueberlebt, ' + abstuerze + ' Absturz/Syntaxfehler (von ' + MUTATIONEN.length + ')');
  return { ok: !ueberlebt && !abstuerze, gesamt: MUTATIONEN.length };
}

