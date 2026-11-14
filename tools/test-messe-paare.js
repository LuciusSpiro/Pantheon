'use strict';
// KAT-01 Paket 0.1: Test von tools/messe-paare.js – npm run test:messe-paare.
// Offline, ohne Spiel-Lauf: die Matrix wird aus den Katalogdaten gerechnet; die Mutationsprobe verfaelscht die Daten nur im Speicher (matrix({ mutiere })), die Dateien bleiben unberuehrt.
//   1 Katalog und Form   2 bekannte Paare aus REF-02   3 Kuerzel-Logik (ok/nurV/nie/kontext/hinweis)   4 Determinismus   5 Mutationsprobe, danach Zustand wiederhergestellt   6 Aufruf: Konsole, --json/--md, Repo-Pfad abgelehnt, Repo sauber
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
check('1 nurV und nie je A als Listen von Beats, deckungsgleich mit den Zellen', M.beats.every((a) => JSON.stringify(M.nurV[a]) === JSON.stringify(M.beats.filter((b) => K(a, b) === 'nurV')) && JSON.stringify(M.nie[a]) === JSON.stringify(M.beats.filter((b) => K(a, b) === 'nie'))));
check('1 Modul exportiert nur reine Funktionen', Object.values(PM).every((f) => typeof f === 'function'), Object.keys(PM).join(','));

// ---------- 2 bekannte Paare aus REF-02
check('2 hinterhalt > rettung ist nurV', K('hinterhalt', 'rettung') === 'nurV');
check('2 hinterhalt > landung ist nurV', K('hinterhalt', 'landung') === 'nurV');
check('2 schmiergeld direkt vor abschluss ist nie', M.vor_abschluss.schmiergeld.klasse === 'nie');
check('2 forderung > bitte: nie (OPTIONEN_GLEICHER_WEG am bitte, das als vorletzter Beat keinen spaeteren Beat zum Verzweigen hat)', K('forderung', 'bitte') === 'nie' && M.zellen.forderung.bitte.mit.includes('OPTIONEN_GLEICHER_WEG'));
check('2 bekannte ok-Paare: notruf > rettung, notruf > landung, fracht > spur, geruecht > spur, spontanhilfe > notruf', K('notruf', 'rettung') === 'ok' && K('notruf', 'landung') === 'ok' && K('fracht', 'spur') === 'ok' && K('geruecht', 'spur') === 'ok' && K('spontanhilfe', 'notruf') === 'ok');
check('2 spontanhilfe direkt vor abschluss ist ok, bitte direkt vor abschluss ist nie', M.vor_abschluss.spontanhilfe.klasse === 'ok' && M.vor_abschluss.bitte.klasse === 'nie');

// ---------- 3 Kuerzel-Logik
const mitZiel = M.beats.flatMap((a) => M.beats.filter((b) => K(a, b) === 'nurV').map((b) => [a, b]));
check('3 nurV: ohne Verzweigung ungueltig, mit A.gescheitert -> abschluss gueltig (nachgerechnet ueber faden-bauplan pruefe)', mitZiel.length > 0 && mitZiel.every(([a, b]) => { const p0 = BP.pruefe(PM.planFuer([a, b], null)), p1 = BP.pruefe(PM.planFuer([a, b], 'z')); return !p0.ok && p1.ok; }));
check('3 ok: ohne Verzweigung gueltig (nachgerechnet)', M.beats.every((a) => M.beats.filter((b) => K(a, b) === 'ok').every((b) => BP.pruefe(PM.planFuer([a, b], null)).ok)));
check('3 nie: auch mit Verzweigung ungueltig und kein Kontext-Code (nachgerechnet)', M.beats.every((a) => M.beats.filter((b) => K(a, b) === 'nie').every((b) => !BP.pruefe(PM.planFuer([a, b], 'z')).ok && !M.zellen[a][b].mit.some(PM.kontextCode) && !M.zellen[a][b].ohne.some(PM.kontextCode))));
check('3 kontext: nur Paare mit Kontext-Code (wiedersehen nach einem anderen Beat: NSC_ALT_NICHT_ERSTER), nie als Zustandsfehler gezaehlt', M.beats.every((a) => M.beats.every((b) => K(a, b) !== 'kontext' || M.zellen[a][b].ohne.some(PM.kontextCode))) && K('notruf', 'wiedersehen') === 'kontext');
check('3 hinweis: enthuellung ohne Hinweis-Traeger davor (spontanhilfe > enthuellung, kein Zustandsfehler dabei)', K('spontanhilfe', 'enthuellung') === 'hinweis' && M.zellen.spontanhilfe.enthuellung.ohne.every((c) => c === 'HINWEIS_FEHLT'));
check('3 kontextCode: SABOTAGE_NUR_EINMAL ist Planregel, kein Kontext; LAGE_ZIEL_FEHLT, NSC_ALT_NICHT_ERSTER, NSC_VON_FEHLT sind Kontext, STATUS_PASST_NICHT nicht', !PM.kontextCode('SABOTAGE_NUR_EINMAL') && PM.kontextCode('SABOTAGE_PAUSE') && PM.kontextCode('LAGE_ZIEL_FEHLT') && PM.kontextCode('NSC_ALT_NICHT_ERSTER') && PM.kontextCode('NSC_VON_FEHLT') && !PM.kontextCode('STATUS_PASST_NICHT'));
check('3 Plan hat Landeplatz fuer landung (landeplaetze + parameter.landeplatz) und optionen:true fuer forderung', (() => { const p = PM.planFuer(['landung', 'forderung'], null); return p.landeplaetze.length === 1 && p.beats[0].parameter.landeplatz === p.landeplaetze[0].id && p.beats[1].optionen === true; })());
check('3 wrack und landung teilen sich einen Landeplatz der Art Schiff', (() => { const p = PM.planFuer(['wrack', 'landung'], null); return p.landeplaetze.length === 1 && p.landeplaetze[0].art === 'schiff'; })());

// ---------- 4 Determinismus
check('4 zweimal gleiche Matrix', JSON.stringify(PM.matrix()) === JSON.stringify(M));

// ---------- 5 Mutationsprobe: hinterhalt endet gelungen in aktiv und gescheitert in verbuendet (zwei verschiedene, fuer spontanhilfe zulaessige Zustaende) -> hinterhalt > spontanhilfe wird ohne Verzweigung gueltig
const mut = PM.matrix({ mutiere: (B) => { B.hinterhalt.bauplan.aus.gelungen.status = ['aktiv']; B.hinterhalt.bauplan.aus.gescheitert.status = ['verbuendet']; } });
check('5 Mutation (hinterhalt.aus gelungen [aktiv], gescheitert [verbuendet]) macht hinterhalt > spontanhilfe von nurV zu ok', K('hinterhalt', 'spontanhilfe') === 'nurV' && mut.zellen.hinterhalt.spontanhilfe.klasse === 'ok' && JSON.stringify(mut.zellen) !== JSON.stringify(M.zellen), `${K('hinterhalt', 'spontanhilfe')} -> ${mut.zellen.hinterhalt.spontanhilfe.klasse}`);
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
