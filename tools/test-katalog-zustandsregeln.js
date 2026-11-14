'use strict';
// KAT-01 A: Waechter fuer die abgeleitete Zustandsregel-Zeile im Katalog des Abenteuer-Prompts – npm run test:katalog-zustandsregeln.
// Offline, ohne Spiel-Lauf, kein Claude-Aufruf. Die Zeile entsteht in abenteuer-prompt.js (zustandsregeln, zustandsregelText) NUR aus der Paarmatrix (server/sim/faden-paare.js). Der Test liest den TEXT zurueck (eigener Parser, nicht die Struktur des Erzeugers)
// und haelt ihn gegen die Matrix:
//   1 Text gegen Matrix: jedes nurV-Paar mit Verzweigung am Vorgaenger (Ort A, A-Teil von A+B) steht im Text, mit der richtigen Art (gescheitert | gelungen | beide = ohne Zusatz); nichts steht im Text, was nicht nurV mit Ort A/A+B ist; Optionen-Pflicht-Beats = vor_abschluss_nie, nie ein Paar mit B = Pflicht-Beat ok;
//     jede nie-Spalte mit einem Zustandsfehler steht im Text (befreiung: nur als erster Beat oder direkt nach den Beats, bei denen das Paar ok/nurV ist); ausgenommen bewusst die Planregeln (sabotage > sabotage = SABOTAGE_NUR_EINMAL, wiedersehen = NSC_ALT_NICHT_ERSTER: die Beat-Zeile sagt "nur als erster Beat")
//   1b Belege fuer die Aussagen: "Ziel etwa abschluss" (Probe in der Matrix) und "Ziel nie der naechste" (Plan mit dem naechsten Beat als Ziel ist ungueltig); befreiung ist ueber keine Verzweigung eines frueheren Beats erreichbar; der Text sagt nur Belegtes
//   2 Mutationsproben (Daten nur im Speicher): hinterhalt-Ausgaenge so, dass hinterhalt > spontanhilfe ok wird -> die Zeile aendert sich genau dort; befreiung laesst alle Zustaende zu -> der befreiung-Satz entfaellt; verfaelschter Text (Satz entfernt, Art entfernt) wird vom Waechter rot; danach alles wie vorher
//   3 Laenge: Wachstum des Katalogs durch die Zeile hoechstens 600 Zeichen; Wachstum aller KAT-01-Zeilen (Katalog minus Katalog ohne sie, katalogTextOhneKat) hoechstens 800 (plus Zuschlag je Probe-Beat im Speicher, ohne Probe-Beats 0) – ohne absolute Basis, damit neue Beats die Pruefung nicht kippen (Basis ohne Probe-Beats war 11 945)
//   4 Matrix-Waechter: ein erfundener Beat (Kopie von verfolgung) taucht in Matrix und Text auf, der Text bleibt gegen die Matrix stimmig; die Datenlage bestimmt jede Klassifikation (nichts hart codiert)
//   5 Layering: server/sim liest nicht aus tools/
const fs = require('fs');
const path = require('path');

const D = require('../server/sim/faden-daten.js');
const BP = require('../server/sim/faden-bauplan.js');
const PA = require('../server/sim/faden-paare.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const klon = (x) => JSON.parse(JSON.stringify(x));
const datenVorher = JSON.stringify(D.BEATS);
// Zuschlag je Beat, den die Daten im Speicher mehr haben als beats.json (Probe-Beats, PROBE_BEATS): sein Name steht hoechstens dreimal samt Trenner in den Listen der Zeile; ohne Probe-Beats ist der Zuschlag 0
const dateiBeats = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'beats.json'), 'utf8')).beats;
const ZUSCHLAG = Object.keys(D.BEATS).filter((k) => !(k in dateiBeats)).reduce((s, k) => s + 3 * (k.length + 3), 0);
const WACHSTUM_BASIS = 800, ZEILE_BASIS = 600;
const WACHSTUM_MAX = WACHSTUM_BASIS + ZUSCHLAG, ZEILE_MAX = ZEILE_BASIS + ZUSCHLAG;
const neu = () => { BP.katalogNeuLesen(); AP.katalogNeuLesen(); };   // Pruefer-Cache, Katalog-Cache und Matrix-Cache

// Daten nur im Speicher aendern, f ausfuehren, danach wiederherstellen
function mitDaten(mutiere, f) {
  const B = D.BEATS, sicher = klon(B);
  try { mutiere(B); neu(); return f(); }
  finally { for (const k of Object.keys(B)) delete B[k]; for (const k of Object.keys(sicher)) B[k] = klon(sicher[k]); neu(); }
}
// die Zeile (letzte Zeile des Katalogs) und der Rest
const zeileVon = (t) => t.split('\n').pop();
const ohneZeile = (t) => t.split('\n').slice(0, -1).join('\n');
const KOPF = /^Verzweigung Pflicht \(gescheitert oder gelungen, Ziel nie der naechste; Pruefer lehnt sonst ab\): (.+)\.$/;
function zerlege(zeile) {
  const m = KOPF.exec(zeile);
  if (!m) return null;
  const saetze = m[1].split('. ');
  const teile = saetze[0].split('; ');
  const p = /^(.+): stets, nie direkt vor (\S+)$/.exec(teile[0]);
  const pflicht = p ? p[1].split(' | ') : [], abschluss = p ? p[2] : null;
  const gruppen = [];
  let ziel = null;
  (p ? teile.slice(1) : teile).forEach((t, i) => {
    if (i === 0) { const z = /^Ziel etwa (\S+): (.+)$/.exec(t); if (!z) return; ziel = z[1]; t = z[2]; }
    const g = /^(.+?) direkt vor (allen ausser )?(.+)$/.exec(t);
    const namen = g[3].split(' | ').map((n) => { const e = /^(\S+?)(?: \(nur (gescheitert|gelungen|ungleiche Arten)\))?$/.exec(n); return { b: e[1], art: e[2] === 'ungleiche Arten' ? 'gemischt' : e[2] || 'beide' }; });
    gruppen.push({ nach: g[1].split(' | '), ausser: !!g[2], namen });
  });
  const nurNach = saetze.slice(1).map((t) => { const n = /^(\S+) nur (als erster Beat)?( oder )?(?:direkt nach (.+))?$/.exec(t); return n ? { beat: n[1], erster: !!n[2], nach: n[4] ? n[4].split(' | ') : [] } : { fehler: t }; });
  return { pflicht, abschluss, ziel, gruppen, nurNach };
}
// die B, fuer die der Text am Vorgaenger a eine Verzweigung verlangt, mit Art
function vorVon(Zx, Mx, a) {
  const g = Zx.gruppen.find((x) => x.nach.includes(a));
  if (!g) return [];
  return g.ausser ? Mx.beats.filter((b) => !g.namen.some((n) => n.b === b)).map((b) => ({ b, art: 'beide' })) : g.namen;
}
// Spalten, die der Test bewusst nicht im Text verlangt: Planregeln (unabhaengig von faden-paare.js benannt); ein Zustandsfehler ist jeder andere Code ausser Kontext und fehlendem Hinweis
const PLANREGELN = ['SABOTAGE_NUR_EINMAL', 'NSC_ALT_NICHT_ERSTER'];
const zustandsCode = (x) => !PLANREGELN.includes(x) && !/^(LAGE_|SABOTAGE_|NSC_ALT_|NSC_VON)/.test(x) && x !== 'HINWEIS_FEHLT';
// Probleme der Zeile gegen die Matrix; leere Liste = stimmig
function probleme(Mx, zeile) {
  const P = [], Zx = zerlege(zeile);
  if (!Zx) return ['Zeile nicht lesbar: ' + zeile.slice(0, 80)];
  const k = (a, b) => Mx.zellen[a][b];
  const pflichtM = Mx.vor_abschluss_nie.filter((v) => v.optionen_pflicht).map((v) => v.beat);
  if (JSON.stringify(Zx.pflicht) !== JSON.stringify(pflichtM)) P.push('Pflicht-Beats im Text ' + Zx.pflicht + ' != Matrix ' + pflichtM);
  if (Zx.pflicht.length && Zx.abschluss !== Mx.abschluss_beat) P.push('Abschluss im Text falsch: ' + Zx.abschluss);
  if (Zx.gruppen.length && Zx.ziel !== Mx.abschluss_beat) P.push('Ziel im Text ' + Zx.ziel + ' != ' + Mx.abschluss_beat);
  for (const e of Zx.nurNach) if (e.fehler) P.push('Satz nicht lesbar: ' + e.fehler);
  for (const g of Zx.gruppen) {
    const ns = g.namen.map((n) => n.b);
    if (g.ausser && !ns.includes(Mx.abschluss_beat)) P.push('Komplement ohne Abschluss: ' + ns);
    for (const b of ns) if (b !== Mx.abschluss_beat && !Mx.beats.includes(b)) P.push('unbekannter Beat: ' + b);
    for (const a of g.nach) {
      if (!Mx.beats.includes(a)) { P.push('unbekannter Beat nach: ' + a); continue; }
      if (Zx.pflicht.includes(a)) P.push('Pflicht-Beat als Vorgaenger-Gruppe: ' + a);
      if (g.ausser && Mx.vor_abschluss[a].klasse !== 'ok') P.push(`Komplement schliesst den Abschluss ein, aber ${a} direkt vor ${Mx.abschluss_beat} ist ${Mx.vor_abschluss[a].klasse}`);
      for (const { b, art } of vorVon(Zx, Mx, a)) {
        const c = k(a, b);
        if (!(c.klasse === 'nurV' && (c.ort === 'A' || c.ort === 'A+B'))) P.push(`Aussage ${a} > ${b}, Matrix: ${c.klasse} ${c.ort || ''}`);
        else if (c.art !== art) P.push(`Art ${a} > ${b}: Text ${art}, Matrix ${c.art}`);
      }
    }
  }
  for (const a of Mx.beats) for (const b of Mx.beats) {
    const c = k(a, b);
    if (c.klasse !== 'nurV') { if (pflichtM.includes(b) && c.klasse === 'ok') P.push(`${a} > ${b} (Optionen-Pflicht) ist ok: "stets" stimmt nicht`); continue; }
    if ((c.ort === 'A' || c.ort === 'A+B') && !pflichtM.includes(a) && !vorVon(Zx, Mx, a).some((x) => x.b === b)) P.push(`nurV ${a} > ${b} (Ort ${c.ort}) fehlt im Text`);
    if ((c.ort === 'B' || c.ort === 'A+B') && !pflichtM.includes(b)) P.push(`nurV ${a} > ${b} (Ort ${c.ort}): ${b} ist kein Optionen-Pflicht-Beat, der Text deckt das nicht`);
  }
  for (const v of Mx.vor_abschluss_nie) if (!v.optionen_pflicht) P.push('vor_abschluss nie ohne Optionen-Pflicht: ' + v.beat + ' (nicht im Text)');
  // Waechter: jede Spalte mit einem Zustandsfehler (nie, nicht nur Planregel) steht im Text, mit genau den A, bei denen das Paar ok oder nurV ist; sonst steht sie nicht darin
  for (const b of Mx.beats) {
    const spalte = Mx.beats.map((a) => k(a, b));
    const zustand = spalte.some((c) => c.klasse === 'nie' && c.letzte.some(zustandsCode));
    const rein = spalte.every((c) => c.klasse === 'ok' || c.klasse === 'nurV' || c.klasse === 'nie');
    const e = Zx.nurNach.find((x) => x.beat === b);
    if (zustand && rein) {
      const nach = Mx.beats.filter((a) => k(a, b).klasse === 'ok' || k(a, b).klasse === 'nurV');
      if (!e) P.push(`nie-Spalte ${b} (Zustandsfehler) fehlt im Text`);
      else {
        if (JSON.stringify(e.nach) !== JSON.stringify(nach)) P.push(`${b} nur nach ${e.nach} im Text, Matrix: ${nach}`);
        if (e.erster !== Mx.als_erster[b].gueltig) P.push(`${b} als erster Beat: Text ${e.erster}, Matrix ${Mx.als_erster[b].gueltig}`);
      }
    } else if (e) P.push(`${b} steht im Text (nur nach), hat aber keine Spalte mit Zustandsfehler`);
  }
  if (Zx.nurNach.some((x) => Mx.beats.includes(x.beat) && Mx.beats.every((a) => k(a, x.beat).klasse === 'nie' && k(a, x.beat).letzte.every((c) => !zustandsCode(c))))) P.push('eine reine Planregel-Spalte steht im Text');
  return P;
}

neu();
const M = PA.matrix();
const text = AP.katalogText();
const zeile = zeileVon(text);
const Z = zerlege(zeile);

// ---------- 1 Text gegen Matrix
check('1 letzte Katalogzeile ist die abgeleitete Zustandsregel und lesbar', !!Z && Z.pflicht.length > 0 && Z.gruppen.length > 0, zeile.slice(0, 100));
check('1 Optionen-Pflicht-Beats im Text = vor_abschluss_nie der Matrix (bitte, forderung, schmiergeld)', !!Z && Z.pflicht.join() === M.vor_abschluss_nie.map((v) => v.beat).join() && Z.pflicht.join() === 'bitte,forderung,schmiergeld');
const pr = probleme(M, zeile);
check('1 jedes nurV-Paar mit Ort A/A+B ist gedeckt (mit Art), keine Aussage zu Paaren, die nicht nurV sind; jede nie-Spalte mit Zustandsfehler steht im Text', pr.length === 0, pr.slice(0, 3).join(' / '));
check('1 bekannte Paare: verfolgung, raumschlacht, hinterhalt vor spontanhilfe; befreiung vor verfolgung; notruf vor befreiung stehen im Text', !!Z && ['verfolgung', 'raumschlacht', 'hinterhalt'].every((a) => vorVon(Z, M, a).some((x) => x.b === 'spontanhilfe')) && vorVon(Z, M, 'befreiung').some((x) => x.b === 'verfolgung') && vorVon(Z, M, 'notruf').some((x) => x.b === 'befreiung'));
check('1 befreiung: nur als erster Beat oder direkt nach notruf | befreiung (die Matrix: befreiung > befreiung nur mit verzweigung.gelungen); als erster Beat belegt (als_erster)', !!Z && (() => { const e = Z.nurNach.find((x) => x.beat === 'befreiung'); return !!e && e.erster && e.nach.join() === M.beats.filter((a) => M.zellen[a].befreiung.klasse !== 'nie').join() && e.nach.includes('notruf') && e.nach.includes('befreiung') && M.als_erster.befreiung.gueltig && vorVon(Z, M, 'befreiung').some((x) => x.b === 'befreiung' && x.art === 'gelungen'); })());
check('1 die Planregel-Spalten stehen nicht im Text: wiedersehen (NSC_ALT_NICHT_ERSTER), sabotage > sabotage (SABOTAGE_NUR_EINMAL); Satz "nur als erster Beat" nur fuer befreiung', !!Z && !Z.nurNach.some((x) => x.beat === 'wiedersehen' || x.beat === 'sabotage') && Z.nurNach.map((x) => x.beat).join() === 'befreiung');
check('1 jeder Vorgaenger in hoechstens einer Gruppe, Gruppen mit gleicher Liste zusammengefasst', !!Z && (() => { const alle = Z.gruppen.flatMap((g) => g.nach); const listen = Z.gruppen.map((g) => JSON.stringify(vorVon(Z, M, g.nach[0]))); return alle.length === new Set(alle).size && listen.length === new Set(listen).size; })());
check('1 Ort B und A+B nur bei Optionen-Pflicht-Beats als B (Voraussetzung der Zeile)', !!Z && M.beats.every((a) => M.beats.every((b) => M.zellen[a][b].klasse !== 'nurV' || M.zellen[a][b].ort === 'A' || Z.pflicht.includes(b))));
check('1 zustandsregelText(zustandsregeln(Matrix)) ist die Zeile', AP.zustandsregelText(AP.zustandsregeln(M)) === zeile);
check('1 Text gleich bei zweitem Aufruf (Cache) und nach Neulesen (Determinismus)', AP.katalogText() === text && (neu(), AP.katalogText()) === text);
check('1 der Text behauptet nur Belegtes: Ziel "etwa" abschluss, nicht "ein beliebiger spaeterer Beat"; gescheitert ODER gelungen, nicht nur gescheitert', /Ziel etwa /.test(zeile) && /gescheitert oder gelungen/.test(zeile) && !/spaeter|beliebig|brauchen verzweigung\.gescheitert/.test(zeile) && /Ziel nie der naechste/.test(zeile));

// ---------- 1b Belege fuer die Aussagen der Zeile
// Probe eines Paares mit der Verzweigung an A (Ort A) bzw. an A und B (Ort A+B, Vierer-Plan mit dem Neutralbeat der Matrix); ziel: Ziel der Verzweigung an A, art: gescheitert | gelungen
const ZIELART = { gescheitert: (z) => z, gelungen: (z) => ({ gelungen: z }) };
function probe(a, b, art, ziel) {
  const c = M.zellen[a][b];
  if (c.ort === 'A') return BP.pruefe(PA.planFuer([a, b], ZIELART[art](ziel), null)).ok;
  const n = M.neutral[b] && M.neutral[b].beat;
  return !!n && BP.pruefe(PA.planFuer([a, b, n], ZIELART[art](ziel), ZIELART[art]('z'))).ok;
}
const paare = Z ? Z.gruppen.flatMap((g) => g.nach.flatMap((a) => vorVon(Z, M, a).map((x) => [a, x.b, x.art]))) : [];
check('1b "Ziel etwa abschluss": jedes Paar der Gruppen ist mit Ziel abschluss gueltig, in der genannten Art (gescheitert, gelungen oder jede), ohne Verzweigung ungueltig', paare.length > 0 && paare.every(([a, b, art]) => { const g = probe(a, b, 'gescheitert', 'z'), l = probe(a, b, 'gelungen', 'z'); return !BP.pruefe(PA.planFuer([a, b], null, null)).ok && (art === 'beide' ? g && l : art === 'gescheitert' ? g && !l : art === 'gelungen' ? l && !g : g || l); }), paare.length);
check('1b "Ziel nie der naechste": mit dem naechsten Beat als Ziel (b2) ist jedes Paar der Gruppen ungueltig, in beiden Arten', paare.length > 0 && paare.every(([a, b]) => !probe(a, b, 'gescheitert', 'b2') && !probe(a, b, 'gelungen', 'b2')));
check('1b befreiung ist ueber keine Verzweigung eines frueheren Beats erreichbar: Plan [X, Y, befreiung] mit X.verzweigung -> befreiung (beide Arten) ist nur fuer die im Text genannten Vorgaenger X gueltig', !!Z && (() => { const e = Z.nurNach.find((x) => x.beat === 'befreiung'); return !!e && M.beats.every((x) => M.beats.every((y) => [PA.planFuer([x, y, 'befreiung'], 'b3', null), PA.planFuer([x, y, 'befreiung'], { gelungen: 'b3' }, null)].every((pl) => !BP.pruefe(pl).ok || e.nach.includes(x)))); })());

// ---------- 2 Mutationsprobe: hinterhalt endet gelungen in aktiv, gescheitert in verbuendet -> hinterhalt > spontanhilfe wird ohne Verzweigung gueltig
const mut = mitDaten((B) => { B.hinterhalt.bauplan.aus.gelungen.status = ['aktiv']; B.hinterhalt.bauplan.aus.gescheitert.status = ['verbuendet']; }, () => ({ M: PA.matrix(), text: AP.katalogText() }));
const zM = zerlege(zeileVon(mut.text));
check('2 Mutation: hinterhalt > spontanhilfe ist in der Matrix von nurV zu ok geworden', M.zellen.hinterhalt.spontanhilfe.klasse === 'nurV' && mut.M.zellen.hinterhalt.spontanhilfe.klasse === 'ok');
check('2 Mutation: die Zeile aendert sich; hinterhalt verlangt spontanhilfe nicht mehr, verfolgung weiter (vorher beide)', mut.text !== text && !!zM && vorVon(Z, M, 'hinterhalt').some((x) => x.b === 'spontanhilfe') && !vorVon(zM, mut.M, 'hinterhalt').some((x) => x.b === 'spontanhilfe') && vorVon(zM, mut.M, 'verfolgung').some((x) => x.b === 'spontanhilfe'));
const prM = probleme(mut.M, zeileVon(mut.text));
check('2 Mutation: die geaenderte Zeile ist gegen die geaenderte Matrix stimmig', prM.length === 0, prM.slice(0, 3).join(' / '));
const mutP = mitDaten((B) => { delete B.schmiergeld.bauplan.optionen_pflicht; }, () => zerlege(zeileVon(AP.katalogText())));
check('2 Mutation: schmiergeld ohne optionen_pflicht faellt aus der Pflicht-Liste', !!mutP && mutP.pflicht.join() === 'bitte,forderung');
const mutB = mitDaten((B) => { B.befreiung.braucht.nsc_status = D.WERTE.status.slice(); }, () => ({ M: PA.matrix(), text: AP.katalogText() }));
const zB = zerlege(zeileVon(mutB.text));
check('2 Mutation: befreiung ohne Zustandsfehler (braucht jeden Zustand): der Satz zu befreiung entfaellt, Text stimmig zur Matrix', !!zB && !zB.nurNach.some((x) => x.beat === 'befreiung') && probleme(mutB.M, zeileVon(mutB.text)).length === 0, (zB && zB.nurNach.map((x) => x.beat).join()) + ' / ' + probleme(mutB.M, zeileVon(mutB.text)).slice(0, 2).join(' / '));
// der Waechter selbst: ein verfaelschter Text muss rot werden
const ohneBefreiungSatz = zeile.replace(/\. befreiung nur [^.]+\.$/, '.');
const ohneArt = zeile.replace(' (nur gelungen)', '');
const mitPlanregelSpalte = zeile.replace(/\.$/, '. wiedersehen nur als erster Beat.');
const mitFalschemNach = zeile.replace(/ | [^ .|]+.$/, '.');
check('2 Waechter: Text ohne den befreiung-Satz / ohne Art-Zusatz / mit einer Planregel-Spalte / mit zu kurzer Nach-Liste ist rot, der echte gruen', [ohneBefreiungSatz, ohneArt, mitPlanregelSpalte, mitFalschemNach].every((t) => t !== zeile && probleme(M, t).length > 0) && probleme(M, zeile).length === 0, [ohneBefreiungSatz, ohneArt, mitPlanregelSpalte, mitFalschemNach].map((t) => probleme(M, t).length).join());
check('2 nach den Mutationen: Daten im Speicher, Katalog und Matrix wie vorher', JSON.stringify(D.BEATS) === datenVorher && AP.katalogText() === text && JSON.stringify(PA.matrix()) === JSON.stringify(M));

// ---------- 3 Laenge: ohne absolute Basis; Wachstum = Katalog mit allen KAT-Zeilen minus Katalog ohne sie (katalogTextOhneKat: Zeilen weg, urspruenglicher Satz zu Annehmen/Ablehnen zurueck; ohne Probe-Beats war die Basis 11 945)
const wachstum = text.length - ohneZeile(text).length;
check(`3 Wachstum des Katalogs durch die Zustandsregel-Zeile hoechstens ${ZEILE_MAX} Zeichen`, wachstum > 0 && wachstum <= ZEILE_MAX, wachstum);
const gesamtWachstum = text.length - AP.katalogTextOhneKat().length;
check(`3 Wachstum aller KAT-01-Zeilen (Katalog minus Katalog ohne sie) hoechstens ${WACHSTUM_MAX} Zeichen`, gesamtWachstum > 0 && gesamtWachstum <= WACHSTUM_MAX, gesamtWachstum);
check('3 der Katalog ohne KAT-Zeilen enthaelt keine der drei Zeilen und den urspruenglichen Satz zu Annehmen und Ablehnen; die Basis aendert den Cache nicht', (() => { const o = AP.katalogTextOhneKat(); return !/Verzweigung Pflicht|Kontext beat_zaehler|Landeplatz-Beats/.test(o) && /Annehmen und Ablehnen einer Bitte muessen in verschiedene Beats fuehren/.test(o) && !/Annehmen und Ablehnen/.test(text) && AP.katalogText() === text; })());

// ---------- 4 Matrix-Waechter: ein erfundener Beat (Kopie von verfolgung); die Datenlage bestimmt jede Klassifikation
const erf = mitDaten((B) => { B.zz_probe = klon(B.verfolgung); }, () => ({ M: PA.matrix(), text: AP.katalogText() }));
const zE = zerlege(zeileVon(erf.text));
check('4 erfundener Beat steht in der Matrix (Zeile und Spalte)', erf.M.beats.includes('zz_probe') && erf.M.beats.length === M.beats.length + 1 && !!erf.M.zellen.zz_probe && !!erf.M.zellen.hinterhalt.zz_probe);
check('4 erfundener Beat steht im Text, wie die Matrix es verlangt (wie verfolgung: nurV vor spontanhilfe, Verzweigung am Vorgaenger)', !!zE && erf.M.zellen.zz_probe.spontanhilfe.klasse === 'nurV' && zE.gruppen.some((g) => g.nach.includes('zz_probe')) && vorVon(zE, erf.M, 'zz_probe').some((x) => x.b === 'spontanhilfe'));
const prE = probleme(erf.M, zeileVon(erf.text));
check('4 Text gegen die Matrix mit dem erfundenen Beat stimmig', prE.length === 0, prE.slice(0, 3).join(' / '));
check('4 nach dem erfundenen Beat: Daten, Katalog und Matrix wie vorher', JSON.stringify(D.BEATS) === datenVorher && AP.katalogText() === text && JSON.stringify(PA.matrix()) === JSON.stringify(M));

// ---------- 5 Layering
const lies = (f) => fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', f), 'utf8');
check('5 faden-paare.js und abenteuer-prompt.js lesen nichts aus tools/', ![lies('faden-paare.js'), lies('abenteuer-prompt.js')].some((s) => /require\([^)]*tools\//.test(s)));
check('5 tools/messe-paare.js ist duenner Aufrufer des Kerns in server/sim, gleiche exportierte Namen', (() => { const PM = require('./messe-paare.js'); return Object.keys(PM).sort().join() === 'kontextCode,matrix,planFuer' && PM.matrix === PA.matrix && PM.planFuer === PA.planFuer; })());

const fail = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok    ' : 'FEHLER'} ${r.name}${!r.ok && r.detail !== undefined ? '  [' + r.detail + ']' : ''}`);
console.log(`\n${results.length - fail.length}/${results.length} Pruefungen bestanden`);
process.exit(fail.length ? 1 : 0);
