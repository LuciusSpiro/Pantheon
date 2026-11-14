'use strict';
// KAT-01 Paket 0.1: Test von tools/messe-paare.js – npm run test:messe-paare.
// Offline, ohne Spiel-Lauf: die Matrix wird aus den Katalogdaten gerechnet; die Mutationsprobe verfaelscht die Daten nur im Speicher (matrix({ mutiere })), die Dateien bleiben unberuehrt.
//   1 Katalog und Form   2 bekannte Paare aus REF-02   3 Kuerzel-Logik (ok/nurV mit Ort A/B/A+B und Art gescheitert/gelungen/beide, nie/kontext/hinweis, alle Proben nachgerechnet; keine festen Zahlen: Summe = Beats zum Quadrat, nie-Zellen aus den Daten abgeleitet)   3b Optionen-Beats als B (Vierer-Plan, Neutralbeat)   3c als_erster   4 Determinismus   5 Mutationsproben (auch: Mutation fuegt einen Beat hinzu und loescht einen, danach ist alles wie vorher)   6 Aufruf: Konsole, --json/--md, Repo-Pfad abgelehnt, Repo sauber
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const PM = require('./messe-paare.js');
const PA = require('../server/sim/faden-paare.js');
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
check('1 Zaehlung ergibt Beats zum Quadrat, alle fuenf Klassen als Schluessel', Object.values(M.zaehlung).reduce((s, x) => s + x, 0) === M.beats.length ** 2 && ['ok', 'nurV', 'nie', 'kontext', 'hinweis'].every((k) => Number.isInteger(M.zaehlung[k])), JSON.stringify(M.zaehlung));
check('1 vor_abschluss fuer jeden Beat', M.beats.every((b) => M.vor_abschluss[b] && ['ok', 'nie', 'kontext', 'hinweis'].includes(M.vor_abschluss[b].klasse)));
check('1 nurV-Art je Zelle gescheitert, gelungen, beide oder gemischt; nurVArt deckungsgleich', M.beats.every((a) => M.beats.every((b) => (K(a, b) === 'nurV') === !!M.nurVArt[a][b] && (K(a, b) !== 'nurV' || ['gescheitert', 'gelungen', 'beide', 'gemischt'].includes(M.zellen[a][b].art) && M.nurVArt[a][b] === M.zellen[a][b].art))));
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
// alle Proben ueber faden-bauplan pruefe nachgerechnet (C = M.neutral[b].beat); Art 'gescheitert' = verzweigung.gescheitert -> abschluss, 'gelungen' = verzweigung.gelungen -> abschluss
const ZIEL = { gescheitert: 'z', gelungen: { gelungen: 'z' } };
const ART = Object.keys(ZIEL);
const gueltig = (plan) => BP.pruefe(plan).ok;
const cVon = (b) => M.neutral[b] && M.neutral[b].beat;
const P1 = (a, b) => gueltig(PM.planFuer([a, b], null, null));
const PA_ = (a, b) => Object.fromEntries(ART.map((x) => [x, gueltig(PM.planFuer([a, b], ZIEL[x], null))]));
const PB_ = (a, b) => Object.fromEntries(ART.map((x) => [x, !!cVon(b) && gueltig(PM.planFuer([a, b, cVon(b)], null, ZIEL[x]))]));
const PAB_ = (a, b) => Object.fromEntries(ART.flatMap((x) => ART.map((y) => [x + '/' + y, !!cVon(b) && gueltig(PM.planFuer([a, b, cVon(b)], ZIEL[x], ZIEL[y]))])));
const irgendeine = (o) => Object.values(o).some(Boolean);
// die Art, die aus den gueltigen Proben folgt (unabhaengig von faden-paare.js nachgebaut)
const artAus = (o) => { const allein = ART.filter((x) => Object.keys(o).some((k) => o[k] && k.split('/').every((p) => p === x))); return allein.length === 2 ? 'beide' : allein.length === 1 ? allein[0] : 'gemischt'; };
check('3 nurV: ohne Verzweigung ungueltig; Ort A = eine Art an A gueltig; Ort B = A in keiner Art, an B gueltig; Ort A+B = A und B allein in keiner Art, beide gueltig; Art = die gueltigen Arten; nachgerechnet', mitZiel.length > 0 && mitZiel.every(([a, b]) => { const z = M.zellen[a][b]; if (P1(a, b)) return false; if (z.ort === 'A') return irgendeine(PA_(a, b)) && artAus(PA_(a, b)) === z.art; if (z.ort === 'B') return !irgendeine(PA_(a, b)) && irgendeine(PB_(a, b)) && artAus(PB_(a, b)) === z.art; return !irgendeine(PA_(a, b)) && !irgendeine(PB_(a, b)) && irgendeine(PAB_(a, b)) && artAus(PAB_(a, b)) === z.art; }));
check('3 Ort B und A+B kommen nur bei B mit Optionen-Pflicht vor; alle drei Orte treten auf', mitZiel.every(([a, b]) => M.zellen[a][b].ort === 'A' || pflichtNamen.includes(b)) && ['A', 'B', 'A+B'].every((o) => mitZiel.some(([a, b]) => M.zellen[a][b].ort === o)));
check('3 Arten: jede Zelle mit art gelungen hat die Probe gescheitert ungueltig, jede mit art gescheitert die Probe gelungen ungueltig (Ort A und B); beide kommt vor', mitZiel.every(([a, b]) => { const z = M.zellen[a][b]; const o = z.ort === 'A' ? PA_(a, b) : z.ort === 'B' ? PB_(a, b) : null; return !o || ((z.art !== 'gelungen' || !o.gescheitert) && (z.art !== 'gescheitert' || !o.gelungen)); }) && mitZiel.some(([a, b]) => M.zellen[a][b].art === 'beide'));
check('3 Review-Belege: befreiung > befreiung ist nurV (nur verzweigung.gelungen -> abschluss), hinterhalt > landung ist nurV und mit gelungen -> abschluss gueltig', K('befreiung', 'befreiung') === 'nurV' && M.zellen.befreiung.befreiung.art === 'gelungen' && !PA_('befreiung', 'befreiung').gescheitert && PA_('befreiung', 'befreiung').gelungen && K('hinterhalt', 'landung') === 'nurV' && PA_('hinterhalt', 'landung').gelungen);
check('3 ok: ohne Verzweigung gueltig (nachgerechnet)', M.beats.every((a) => M.beats.filter((b) => K(a, b) === 'ok').every((b) => BP.pruefe(PM.planFuer([a, b], null)).ok)));
check('3 nie: in KEINER Probe gueltig (A und B je beide Arten, A+B alle vier Artenpaare, B und A+B nur bei B mit Optionen-Pflicht) und kein Kontext-Code', M.beats.every((a) => M.beats.filter((b) => K(a, b) === 'nie').every((b) => !P1(a, b) && !irgendeine(PA_(a, b)) && (!pflichtNamen.includes(b) || (!irgendeine(PB_(a, b)) && !irgendeine(PAB_(a, b)))) && !M.zellen[a][b].letzte.some(PM.kontextCode) && !M.zellen[a][b].ohne.some(PM.kontextCode))));
// nie-Zellen aus den Daten abgeleitet, keine feste Liste: jede nie-Zelle hat eine Ursache aus den Daten: Planregel (nur_einmal-Beat zweimal; B mit braucht.nsc_alt nicht als erster) oder ein Zustandsfehler (STATUS_PASST_NICHT)
const planUrsache = (a, b) => (D.BEATS[a].nur_einmal === true && a === b) || D.BEATS[b].braucht.nsc_alt === true;
const nieZellen = M.beats.flatMap((a) => M.nie[a].map((b) => [a, b]));
check('3 jede nie-Zelle: Planregel (SABOTAGE_NUR_EINMAL bei nur_einmal-Beat doppelt, NSC_ALT_NICHT_ERSTER bei B mit nsc_alt) oder STATUS_PASST_NICHT; die Planregel-Codes zaehlen nicht als Kontext', nieZellen.length > 0 && nieZellen.every(([a, b]) => { const c = M.zellen[a][b].letzte; return planUrsache(a, b) ? c.some(PA.planregelCode) : c.includes('STATUS_PASST_NICHT'); }) && nieZellen.some(([a, b]) => planUrsache(a, b)) && nieZellen.some(([a, b]) => !planUrsache(a, b)), nieZellen.length);
check('3 jede Spalte mit nsc_alt (Planregel): alle Paare X > B sind nie mit NSC_ALT_NICHT_ERSTER; sabotage > sabotage ist nie (SABOTAGE_NUR_EINMAL); bitte/forderung/schmiergeld als B nie nie; notruf > befreiung nurV', M.beats.filter((b) => D.BEATS[b].braucht.nsc_alt === true).every((b) => M.beats.every((a) => K(a, b) === 'nie' && M.zellen[a][b].letzte.includes('NSC_ALT_NICHT_ERSTER'))) && K('sabotage', 'sabotage') === 'nie' && M.zellen.sabotage.sabotage.letzte.every((c) => c === 'SABOTAGE_NUR_EINMAL') && pflichtNamen.every((b) => M.beats.every((a) => K(a, b) !== 'nie')) && K('notruf', 'befreiung') === 'nurV');
check('3 kontext: nur Paare mit Kontext-Code, nie als Zustandsfehler gezaehlt; X > wiedersehen ist nie (Planregel), nicht kontext; Zaehlung kontext = Zahl der kontext-Zellen', M.beats.every((a) => M.beats.every((b) => K(a, b) !== 'kontext' || M.zellen[a][b].ohne.some(PM.kontextCode))) && K('notruf', 'wiedersehen') === 'nie' && M.zaehlung.kontext === M.beats.flatMap((a) => M.kontext[a]).length);
check('3 hinweis: enthuellung ohne Hinweis-Traeger davor (spontanhilfe > enthuellung, kein Zustandsfehler dabei)', K('spontanhilfe', 'enthuellung') === 'hinweis' && M.zellen.spontanhilfe.enthuellung.ohne.every((c) => c === 'HINWEIS_FEHLT'));
check('3 kontextCode: SABOTAGE_NUR_EINMAL und NSC_ALT_NICHT_ERSTER sind Planregeln, kein Kontext; LAGE_ZIEL_FEHLT, SABOTAGE_PAUSE, NSC_VON_FEHLT sind Kontext, STATUS_PASST_NICHT nicht', !PM.kontextCode('SABOTAGE_NUR_EINMAL') && !PM.kontextCode('NSC_ALT_NICHT_ERSTER') && PA.planregelCode('NSC_ALT_NICHT_ERSTER') && PA.planregelCode('SABOTAGE_NUR_EINMAL') && PM.kontextCode('SABOTAGE_PAUSE') && PM.kontextCode('LAGE_ZIEL_FEHLT') && PM.kontextCode('NSC_VON_FEHLT') && !PM.kontextCode('STATUS_PASST_NICHT'));
check('3 Plan hat Landeplatz fuer landung (landeplaetze + parameter.landeplatz) und optionen:true fuer forderung', (() => { const p = PM.planFuer(['landung', 'forderung'], null); return p.landeplaetze.length === 1 && p.beats[0].parameter.landeplatz === p.landeplaetze[0].id && p.beats[1].optionen === true; })());
check('3 wrack und landung teilen sich einen Landeplatz der Art Schiff', (() => { const p = PM.planFuer(['wrack', 'landung'], null); return p.landeplaetze.length === 1 && p.landeplaetze[0].art === 'schiff'; })());

// ---------- 3b Optionen-Beats als B: Vierer-Plan mit Neutralbeat
check('3b Neutralbeat C je B mit Optionen-Pflicht gesetzt, aus den Daten: planbar, ohne Optionen-Pflicht, nur nsc_status, erster passender in Katalogreihenfolge', pflichtNamen.every((b) => { const n = M.neutral[b]; if (!n || !n.beat) return false; const ok = (c) => !D.BEATS[c].bauplan.optionen_pflicht && Object.keys(D.BEATS[c].braucht || {}).join() === 'nsc_status'; const zust = (ags) => ags.flatMap((ag) => D.BEATS[b].bauplan.aus[ag].status); const erster = (zs) => M.beats.find((c) => ok(c) && zs.every((z) => D.BEATS[c].braucht.nsc_status.includes(z))); return n.beat === (erster(zust(['gelungen', 'gescheitert'])) || erster(zust(['gelungen']))); }), JSON.stringify(M.neutral));
check('3b bitte/forderung/schmiergeld direkt vor spontanhilfe-Neutralbeat: spontanhilfe > forderung ist nurV mit Ort B, nicht nie', K('spontanhilfe', 'forderung') === 'nurV' && M.zellen.spontanhilfe.forderung.ort === 'B' && K('spontanhilfe', 'schmiergeld') === 'nurV' && K('spontanhilfe', 'bitte') === 'nurV');
// gesondert geprueft (Ergebnis aus der Messung, nicht vorab geraten): jedes dieser drei Paare braucht die Verzweigung an A und an B
check('3b forderung > forderung, schmiergeld > schmiergeld, bitte > bitte: je nurV, Ort A+B; Probe 1 bis 3 scheitern in jeder Art (OPTIONEN_GLEICHER_WEG), Probe 4 gueltig', [['forderung', 'forderung'], ['schmiergeld', 'schmiergeld'], ['bitte', 'bitte']].every(([a, b]) => K(a, b) === 'nurV' && M.zellen[a][b].ort === 'A+B' && !P1(a, b) && !irgendeine(PA_(a, b)) && !irgendeine(PB_(a, b)) && irgendeine(PAB_(a, b)) && M.zellen[a][b].ohne.includes('OPTIONEN_GLEICHER_WEG') && M.zellen[a][b].mit.includes('OPTIONEN_GLEICHER_WEG') && M.zellen[a][b].mitB.includes('OPTIONEN_GLEICHER_WEG')), ['forderung>forderung', 'schmiergeld>schmiergeld', 'bitte>bitte'].map((p) => { const [a, b] = p.split('>'); return p + ':' + K(a, b) + '/' + M.zellen[a][b].ort; }).join(' '));
check('3b Probe 3 (nur B.verzweigung) reicht, wenn A selbst keine Verzweigung braucht: notruf > bitte hat Ort B, ohne Code von A', K('notruf', 'bitte') === 'nurV' && M.zellen.notruf.bitte.ort === 'B' && M.zellen.notruf.bitte.mitB !== null && M.zellen.notruf.bitte.mit.includes('OPTIONEN_GLEICHER_WEG'));
check('3b planFuer mit B.verzweigung setzt beats[1].verzweigung und hat vier Beats', (() => { const p = PM.planFuer(['spontanhilfe', 'bitte', 'notruf'], null, 'z'); return p.beats.length === 4 && p.beats[1].verzweigung.gescheitert === 'z' && !p.beats[0].verzweigung; })());

// ---------- 3c als_erster: B an Position 0 (Plan [B, abschluss] und [B, X, abschluss])
check('3c als_erster fuer jeden Beat; gueltig genau dann, wenn [B, abschluss] ok ist oder ein Folge-Beat X mit gueltigem [B, X, abschluss] (ok oder nurV) existiert; nachgerechnet', M.beats.every((b) => { const e = M.als_erster[b]; const direkt = BP.pruefe(PM.planFuer([b], null)).ok; const folger = M.beats.filter((x) => P1(b, x) || irgendeine(PA_(b, x)) || irgendeine(PB_(b, x)) || irgendeine(PAB_(b, x))); return e && e.direkt === M.vor_abschluss[b].klasse && direkt === (e.direkt === 'ok') && JSON.stringify(e.folger) === JSON.stringify(folger) && e.gueltig === (direkt || folger.length > 0); }));
check('3c befreiung (start_status gefangen) ist als erster Beat gueltig: [befreiung, abschluss] und mindestens ein [befreiung, X, abschluss]; hinter spontanhilfe nie', M.als_erster.befreiung.gueltig && M.als_erster.befreiung.direkt === 'ok' && M.als_erster.befreiung.folger.length > 0 && K('spontanhilfe', 'befreiung') === 'nie');
check('3c wiedersehen als erster Beat gueltig (die Planregel erlaubt ihn nur dort)', M.als_erster.wiedersehen.gueltig);

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
// Befund 6: eine Mutation, die einen Beat hinzufuegt UND einen loescht: danach identische Daten (auch Schluesselreihenfolge) und identische Matrix (Cache neu gelesen, nicht der alte Cache)
const mutHL = PM.matrix({ mutiere: (B) => { B.zz_neu = JSON.parse(JSON.stringify(B.spontanhilfe)); delete B.wrack; } });
const frisch = (PA.neuLesen(), PA.matrix());
check('5 Mutation fuegt zz_neu hinzu und loescht wrack: die Mutation sieht es, danach sind Daten (Reihenfolge der Schluessel) und neu gerechnete Matrix wie vorher', mutHL.beats.includes('zz_neu') && !mutHL.beats.includes('wrack') && JSON.stringify(D.BEATS) === datenVorher && !('zz_neu' in D.BEATS) && JSON.stringify(frisch) === JSON.stringify(M), Object.keys(D.BEATS).length);
check('5 die Dateien sind unberuehrt (jeder Beat aus beats.json = Datenstand im Speicher; im Speicher nur Probe-Beats mehr)', (() => { const datei = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'beats.json'), 'utf8')).beats; const mem = JSON.parse(datenVorher); return Object.keys(datei).every((k) => JSON.stringify(datei[k]) === JSON.stringify(mem[k])) && Object.keys(mem).filter((k) => !(k in datei)).every((k) => /^probe_/.test(k)); })());
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
