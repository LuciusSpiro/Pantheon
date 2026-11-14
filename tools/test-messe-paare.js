'use strict';
// KAT-01 Paket 0.1: Test von tools/messe-paare.js – npm run test:messe-paare.
// Offline, ohne Spiel-Lauf: die Matrix wird aus den Katalogdaten gerechnet; die Mutationsprobe verfaelscht die Daten nur im Speicher (matrix({ mutiere })), die Dateien bleiben unberuehrt.
//   1 Katalog und Form   2 bekannte Paare aus REF-02   3 Kuerzel-Logik (ok/nurV mit Ort A/B/A+B/nie/kontext/hinweis, alle vier Proben nachgerechnet)   3b Optionen-Beats als B (Vierer-Plan, Neutralbeat)   4 Determinismus   5 Mutationsproben, danach Zustand wiederhergestellt   6 Aufruf: Konsole, --json/--md, Repo-Pfad abgelehnt, Repo sauber
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const PM = require('./messe-paare.js');
const D = require('../server/sim/faden-daten.js');
const BP = require('../server/sim/faden-bauplan.js');
const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messe-paare-'));
const repoSpuren = () => (cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout || '').split(/\r?\n/).filter((l) => /paare\.(md|json)/.test(l));
const spurenVorher = repoSpuren().join('\n');
const datenVorher = JSON.stringify(D.BEATS);

const M = PM.matrix();
const K = (a, b) => M.zellen[a][b].klasse;
const namenErwartet = Object.keys(D.BEATS).filter((n) => D.BEATS[n].bauplan && !D.BEATS[n].nur_inszenierer && !D.BEATS[n].abschluss);

// ---------- 1 Katalog und Form
check('1 Beats der Matrix = planbare Beats aus beats.json (bauplan, nicht nur_inszenierer, nicht abschluss)', JSON.stringify(M.beats) === JSON.stringify(namenErwartet) && M.beats.length > 10, M.beats.length);
check('1 jede Zelle je A und B gefuellt, gueltige Kuerzel', M.beats.every((a) => M.beats.every((b) => ['ok', 'nurV', 'nie', 'kontext', 'hinweis'].includes(K(a, b)))));
check('1 Zaehlung ergibt Beats zum Quadrat', Object.values(M.zaehlung).reduce((s, x) => s + x, 0) === M.beats.length ** 2);
check('1 vor_abschluss fuer jeden Beat', M.beats.every((b) => M.vor_abschluss[b] && ['ok', 'nie', 'kontext', 'hinweis'].includes(M.vor_abschluss[b].klasse)));
check('1 nurV-Ort je Zelle A, B oder A+B; nurVOrt und verzweigung_noetig_bei deckungsgleich mit den Zellen', M.beats.every((a) => M.beats.every((b) => (K(a, b) === 'nurV') === !!M.nurVOrt[a][b] && (K(a, b) !== 'nurV' || ['A', 'B', 'A+B'].includes(M.zellen[a][b].ort) && M.verzweigung_noetig_bei[a][M.zellen[a][b].ort].includes(b)))) && M.beats.every((a) => M.verzweigung_noetig_bei[a].A.length + M.verzweigung_noetig_bei[a].B.length + M.verzweigung_noetig_bei[a]['A+B'].length === M.nurV[a].length));
check('1 nurV und nie je A als Listen von Beats, deckungsgleich mit den Zellen', M.beats.every((a) => JSON.stringify(M.nurV[a]) === JSON.stringify(M.beats.filter((b) => K(a, b) === 'nurV')) && JSON.stringify(M.nie[a]) === JSON.stringify(M.beats.filter((b) => K(a, b) === 'nie'))));
check('1 Modul exportiert nur reine Funktionen', Object.values(PM).every((f) => typeof f === 'function'), Object.keys(PM).join(','));

// ---------- 2 bekannte Paare aus REF-02
check('2 hinterhalt > rettung ist nurV', K('hinterhalt', 'rettung') === 'nurV');
check('2 hinterhalt > landung ist nurV', K('hinterhalt', 'landung') === 'nurV');
check('2 schmiergeld direkt vor abschluss ist nie', M.vor_abschluss.schmiergeld.klasse === 'nie');
check('2 forderung > bitte ist nicht mehr nie: nurV, Verzweigung an A und B (A.forderung braucht sie selbst, B.bitte im Vierer-Plan); A.verzweigung allein scheitert weiter an OPTIONEN_GLEICHER_WEG', K('forderung', 'bitte') === 'nurV' && M.zellen.forderung.bitte.ort === 'A+B' && M.zellen.forderung.bitte.mit.includes('OPTIONEN_GLEICHER_WEG'));
check('2 bekannte ok-Paare: notruf > rettung, notruf > landung, fracht > spur, geruecht > spur, spontanhilfe > notruf', K('notruf', 'rettung') === 'ok' && K('notruf', 'landung') === 'ok' && K('fracht', 'spur') === 'ok' && K('geruecht', 'spur') === 'ok' && K('spontanhilfe', 'notruf') === 'ok');
check('2 spontanhilfe direkt vor abschluss ist ok, bitte direkt vor abschluss ist nie', M.vor_abschluss.spontanhilfe.klasse === 'ok' && M.vor_abschluss.bitte.klasse === 'nie');
const pflichtNamen = M.beats.filter((n) => D.BEATS[n].bauplan.optionen_pflicht);
check('2 vor_abschluss_nie: genau die Beats mit Optionen-Pflicht (bitte, forderung, schmiergeld), Code OPTIONEN_GLEICHER_WEG', JSON.stringify(M.vor_abschluss_nie.map((v) => v.beat)) === JSON.stringify(pflichtNamen) && pflichtNamen.join() === 'bitte,forderung,schmiergeld' && M.vor_abschluss_nie.every((v) => v.codes.includes('OPTIONEN_GLEICHER_WEG')), pflichtNamen.join());

// ---------- 3 Kuerzel-Logik
const mitZiel = M.beats.flatMap((a) => M.beats.filter((b) => K(a, b) === 'nurV').map((b) => [a, b]));
// die vier Proben ueber faden-bauplan pruefe nachgerechnet (C = M.neutral[b].beat)
const P = (a, b, p) => { const c = M.neutral[b] && M.neutral[b].beat; const g = (x) => BP.pruefe(x).ok; return [() => g(PM.planFuer([a, b], null, null)), () => g(PM.planFuer([a, b], 'z', null)), () => g(PM.planFuer([a, b, c], null, 'z')), () => g(PM.planFuer([a, b, c], 'z', 'z'))][p - 1](); };
check('3 nurV: ohne Verzweigung ungueltig; Ort A = Probe 2, Ort B = Probe 3 (und 2 ungueltig), Ort A+B = Probe 4 (und 2, 3 ungueltig); nachgerechnet', mitZiel.length > 0 && mitZiel.every(([a, b]) => { const o = M.zellen[a][b].ort; return !P(a, b, 1) && (o === 'A' ? P(a, b, 2) : o === 'B' ? !P(a, b, 2) && P(a, b, 3) : !P(a, b, 2) && !P(a, b, 3) && P(a, b, 4)); }));
check('3 Ort B und A+B kommen nur bei B mit Optionen-Pflicht vor; alle drei Orte treten auf', mitZiel.every(([a, b]) => M.zellen[a][b].ort === 'A' || pflichtNamen.includes(b)) && ['A', 'B', 'A+B'].every((o) => mitZiel.some(([a, b]) => M.zellen[a][b].ort === o)));
check('3 ok: ohne Verzweigung gueltig (nachgerechnet)', M.beats.every((a) => M.beats.filter((b) => K(a, b) === 'ok').every((b) => BP.pruefe(PM.planFuer([a, b], null)).ok)));
check('3 nie: in KEINER Probe gueltig (alle vier nachgerechnet, 3 und 4 nur bei B mit Optionen-Pflicht) und kein Kontext-Code', M.beats.every((a) => M.beats.filter((b) => K(a, b) === 'nie').every((b) => !P(a, b, 1) && !P(a, b, 2) && (!pflichtNamen.includes(b) || (!P(a, b, 3) && !P(a, b, 4))) && !M.zellen[a][b].letzte.some(PM.kontextCode) && !M.zellen[a][b].ohne.some(PM.kontextCode))));
const nieListe = M.beats.flatMap((a) => M.nie[a].map((b) => a + '>' + b));
check('3 nie enthaelt nur befreiung als B (STATUS_PASST_NICHT, ausser nach notruf) und sabotage>sabotage (SABOTAGE_NUR_EINMAL); bitte/forderung/schmiergeld als B nie nie', nieListe.every((p) => p.endsWith('>befreiung') || p === 'sabotage>sabotage') && !nieListe.includes('notruf>befreiung') && K('notruf', 'befreiung') === 'nurV' && K('sabotage', 'sabotage') === 'nie' && M.zellen.sabotage.sabotage.letzte.every((c) => c === 'SABOTAGE_NUR_EINMAL') && pflichtNamen.every((b) => M.beats.every((a) => K(a, b) !== 'nie')), nieListe.length);
check('3 Zaehlung ok/nurV/nie/kontext/hinweis ergibt 400', Object.values(M.zaehlung).reduce((x, y) => x + y, 0) === 400 && M.beats.length === 20, JSON.stringify(M.zaehlung));
check('3 kontext: nur Paare mit Kontext-Code (wiedersehen nach einem anderen Beat: NSC_ALT_NICHT_ERSTER), nie als Zustandsfehler gezaehlt', M.beats.every((a) => M.beats.every((b) => K(a, b) !== 'kontext' || M.zellen[a][b].ohne.some(PM.kontextCode))) && K('notruf', 'wiedersehen') === 'kontext');
check('3 hinweis: enthuellung ohne Hinweis-Traeger davor (spontanhilfe > enthuellung, kein Zustandsfehler dabei)', K('spontanhilfe', 'enthuellung') === 'hinweis' && M.zellen.spontanhilfe.enthuellung.ohne.every((c) => c === 'HINWEIS_FEHLT'));
check('3 kontextCode: SABOTAGE_NUR_EINMAL ist Planregel, kein Kontext; LAGE_ZIEL_FEHLT, NSC_ALT_NICHT_ERSTER, NSC_VON_FEHLT sind Kontext, STATUS_PASST_NICHT nicht', !PM.kontextCode('SABOTAGE_NUR_EINMAL') && PM.kontextCode('SABOTAGE_PAUSE') && PM.kontextCode('LAGE_ZIEL_FEHLT') && PM.kontextCode('NSC_ALT_NICHT_ERSTER') && PM.kontextCode('NSC_VON_FEHLT') && !PM.kontextCode('STATUS_PASST_NICHT'));
check('3 Plan hat Landeplatz fuer landung (landeplaetze + parameter.landeplatz) und optionen:true fuer forderung', (() => { const p = PM.planFuer(['landung', 'forderung'], null); return p.landeplaetze.length === 1 && p.beats[0].parameter.landeplatz === p.landeplaetze[0].id && p.beats[1].optionen === true; })());
check('3 wrack und landung teilen sich einen Landeplatz der Art Schiff', (() => { const p = PM.planFuer(['wrack', 'landung'], null); return p.landeplaetze.length === 1 && p.landeplaetze[0].art === 'schiff'; })());

// ---------- 3b Optionen-Beats als B: Vierer-Plan mit Neutralbeat
check('3b Neutralbeat C je B mit Optionen-Pflicht gesetzt, aus den Daten: planbar, ohne Optionen-Pflicht, nur nsc_status, erster passender in Katalogreihenfolge', pflichtNamen.every((b) => { const n = M.neutral[b]; if (!n || !n.beat) return false; const ok = (c) => !D.BEATS[c].bauplan.optionen_pflicht && Object.keys(D.BEATS[c].braucht || {}).join() === 'nsc_status'; const zust = (ags) => ags.flatMap((ag) => D.BEATS[b].bauplan.aus[ag].status); const erster = (zs) => M.beats.find((c) => ok(c) && zs.every((z) => D.BEATS[c].braucht.nsc_status.includes(z))); return n.beat === (erster(zust(['gelungen', 'gescheitert'])) || erster(zust(['gelungen']))); }), JSON.stringify(M.neutral));
check('3b bitte/forderung/schmiergeld direkt vor spontanhilfe-Neutralbeat: spontanhilfe > forderung ist nurV mit Ort B, nicht nie', K('spontanhilfe', 'forderung') === 'nurV' && M.zellen.spontanhilfe.forderung.ort === 'B' && K('spontanhilfe', 'schmiergeld') === 'nurV' && K('spontanhilfe', 'bitte') === 'nurV');
// gesondert geprueft (Ergebnis aus der Messung, nicht vorab geraten): jedes dieser drei Paare braucht die Verzweigung an A und an B
check('3b forderung > forderung, schmiergeld > schmiergeld, bitte > bitte: je nurV, Ort A+B; Probe 1 bis 3 scheitern (OPTIONEN_GLEICHER_WEG), Probe 4 gueltig', [['forderung', 'forderung'], ['schmiergeld', 'schmiergeld'], ['bitte', 'bitte']].every(([a, b]) => K(a, b) === 'nurV' && M.zellen[a][b].ort === 'A+B' && !P(a, b, 1) && !P(a, b, 2) && !P(a, b, 3) && P(a, b, 4) && M.zellen[a][b].ohne.includes('OPTIONEN_GLEICHER_WEG') && M.zellen[a][b].mit.includes('OPTIONEN_GLEICHER_WEG') && M.zellen[a][b].mitB.includes('OPTIONEN_GLEICHER_WEG')), ['forderung>forderung', 'schmiergeld>schmiergeld', 'bitte>bitte'].map((p) => { const [a, b] = p.split('>'); return p + ':' + K(a, b) + '/' + M.zellen[a][b].ort; }).join(' '));
check('3b Probe 3 (nur B.verzweigung) reicht, wenn A selbst keine Verzweigung braucht: notruf > bitte hat Ort B, ohne Code von A', K('notruf', 'bitte') === 'nurV' && M.zellen.notruf.bitte.ort === 'B' && M.zellen.notruf.bitte.mitB !== null && M.zellen.notruf.bitte.mit.includes('OPTIONEN_GLEICHER_WEG'));
check('3b planFuer mit B.verzweigung setzt beats[1].verzweigung und hat vier Beats', (() => { const p = PM.planFuer(['spontanhilfe', 'bitte', 'notruf'], null, 'z'); return p.beats.length === 4 && p.beats[1].verzweigung.gescheitert === 'z' && !p.beats[0].verzweigung; })());

// ---------- 4 Determinismus
check('4 zweimal gleiche Matrix', JSON.stringify(PM.matrix()) === JSON.stringify(M));

// ---------- 5 Mutationsprobe: hinterhalt endet gelungen in aktiv und gescheitert in verbuendet (zwei verschiedene, fuer spontanhilfe zulaessige Zustaende) -> hinterhalt > spontanhilfe wird ohne Verzweigung gueltig
const mut = PM.matrix({ mutiere: (B) => { B.hinterhalt.bauplan.aus.gelungen.status = ['aktiv']; B.hinterhalt.bauplan.aus.gescheitert.status = ['verbuendet']; } });
check('5 Mutation (hinterhalt.aus gelungen [aktiv], gescheitert [verbuendet]) macht hinterhalt > spontanhilfe von nurV zu ok', K('hinterhalt', 'spontanhilfe') === 'nurV' && mut.zellen.hinterhalt.spontanhilfe.klasse === 'ok' && JSON.stringify(mut.zellen) !== JSON.stringify(M.zellen), `${K('hinterhalt', 'spontanhilfe')} -> ${mut.zellen.hinterhalt.spontanhilfe.klasse}`);
// 4er-Probe: forderung endet in verbuendet und laesst nur aktiv/feindlich zu -> A.forderung > B.forderung scheitert in allen vier Proben an STATUS_PASST_NICHT (war nurV A+B; Probe 4 war der Weg)
const mut4 = PM.matrix({ mutiere: (B) => { B.forderung.bauplan.aus.gelungen.status = ['verbuendet']; B.forderung.bauplan.aus.gescheitert.status = ['verbuendet']; B.forderung.braucht.nsc_status = ['aktiv', 'feindlich']; } });
check('5 Mutation (forderung endet in verbuendet, braucht aktiv/feindlich): forderung > forderung von nurV A+B zu nie, Probe 4 scheitert mit STATUS_PASST_NICHT', K('forderung', 'forderung') === 'nurV' && M.zellen.forderung.forderung.ort === 'A+B' && mut4.zellen.forderung.forderung.klasse === 'nie' && mut4.zellen.forderung.forderung.beide.includes('STATUS_PASST_NICHT') && mut4.zellen.forderung.forderung.mitB.includes('STATUS_PASST_NICHT'), `${K('forderung', 'forderung')} -> ${mut4.zellen.forderung.forderung.klasse}`);
// Datengetrieben: ohne optionen_pflicht bekommt schmiergeld keinen Neutralbeat und keinen Vierer-Plan mehr (optionen:true bleibt, solange der Typ Optionen mit Standard hat) -> schmiergeld als B ist nicht mehr nurV
const mutP = PM.matrix({ mutiere: (B) => { delete B.schmiergeld.bauplan.optionen_pflicht; } });
check('5 Mutation (schmiergeld ohne optionen_pflicht): kein Neutralbeat fuer schmiergeld, Optionen-Pflicht-Liste nur noch bitte, forderung; notruf > schmiergeld nicht mehr nurV B', !mutP.neutral.schmiergeld && !!mutP.neutral.forderung && mutP.vor_abschluss_nie.every((v) => v.beat !== 'schmiergeld' || v.optionen_pflicht === false) && K('notruf', 'schmiergeld') === 'nurV' && mutP.zellen.notruf.schmiergeld.klasse !== 'nurV', `${K('notruf', 'schmiergeld')} -> ${mutP.zellen.notruf.schmiergeld.klasse}`);
check('5 nach der Mutation sind die Daten im Speicher unveraendert und die Matrix wieder die alte', JSON.stringify(D.BEATS) === datenVorher && JSON.stringify(PM.matrix()) === JSON.stringify(M));
check('5 die Dateien sind unberuehrt (beats.json = Datenstand)', JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'beats.json'), 'utf8')).beats) === datenVorher);
let wurf = null;
try { PM.matrix({ mutiere: () => { throw new Error('mutiere-fehler'); } }); } catch (e) { wurf = e; }
check('5 wirft mutiere, bleiben die Daten trotzdem unveraendert', wurf && wurf.message === 'mutiere-fehler' && JSON.stringify(D.BEATS) === datenVorher);

// ---------- 6 Aufruf
const lauf = (args) => { const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'messe-paare.js'), ...args], { cwd: TMP, encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };
const r1 = lauf(['--json', 'm.json', '--md', 'unter/m.md']);
check('6 Exit 0, Konsole mit Matrix und Abschnitten', r1.code === 0 && /Paarmatrix/.test(r1.out) && /nur mit Verzweigung \(/.test(r1.out) && /nie gueltig \(/.test(r1.out) && /Paare B direkt vor abschluss/.test(r1.out), r1.err.slice(0, 200));
let J = null; try { J = JSON.parse(fs.readFileSync(path.join(TMP, 'm.json'), 'utf8')); } catch (e) { J = null; }
check('6 --json relativ zum Aufrufer, gleiche Matrix wie das Modul', J && JSON.stringify(J.zellen) === JSON.stringify(M.zellen) && J.format === 'messung-paare/1');
const md = fs.existsSync(path.join(TMP, 'unter', 'm.md')) ? fs.readFileSync(path.join(TMP, 'unter', 'm.md'), 'utf8') : '';
check('6 --md mit Tabelle und den Listen', /\| A \\ B \|/.test(md) && /## Nur mit Verzweigung/.test(md) && /## Nie gueltig/.test(md) && /hinterhalt > rettung/.test(md));
const r2 = lauf(['--json', path.join(ROOT, 'm-paare-test.json')]);
check('6 Ausgabe ins Repo wird abgelehnt (Exit 2, nichts geschrieben)', r2.code === 2 && !fs.existsSync(path.join(ROOT, 'm-paare-test.json')));
check('6 Repo bleibt sauber (keine paare.json/md)', repoSpuren().join('\n') === spurenVorher);

fs.rmSync(TMP, { recursive: true, force: true });
const fail = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok    ' : 'FEHLER'} ${r.name}${!r.ok && r.detail !== undefined ? '  [' + r.detail + ']' : ''}`);
console.log(`\n${results.length - fail.length}/${results.length} Pruefungen bestanden`);
process.exit(fail.length ? 1 : 0);
