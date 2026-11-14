'use strict';
// KAT-01 A: Waechter fuer die abgeleitete Zustandsregel-Zeile im Katalog des Abenteuer-Prompts – npm run test:katalog-zustandsregeln.
// Offline, ohne Spiel-Lauf, kein Claude-Aufruf. Die Zeile entsteht in abenteuer-prompt.js (zustandsregeln, zustandsregelText) NUR aus der Paarmatrix (server/sim/faden-paare.js). Der Test liest den TEXT zurueck (eigener Parser, nicht die Struktur des Erzeugers)
// und haelt ihn gegen die Matrix:
//   1 Text gegen Matrix: jedes nurV-Paar mit Verzweigung am Vorgaenger (Ort A, A-Teil von A+B) steht im Text; nichts steht im Text, was nicht nurV mit Ort A/A+B ist; Optionen-Pflicht-Beats = vor_abschluss_nie, nie ein Paar mit B = Pflicht-Beat ok
//   2 Mutationsprobe (Daten nur im Speicher): hinterhalt-Ausgaenge so, dass hinterhalt > spontanhilfe ok wird -> die Zeile aendert sich genau dort; danach alles wie vorher
//   3 Laenge: Wachstum des Katalogs durch die Zeile hoechstens 600 Zeichen (Paket A; 200 von KAT-01 insgesamt 800 sind fuer Paket B reserviert)
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
const PREFIX = 'verzweigung.gescheitert auf einen spaeteren Beat brauchen: ';
function zerlege(zeile) {
  const m = /^Verzweigung Pflicht \(sonst lehnt der Pruefer ab\): (.+)\.$/.exec(zeile);
  if (!m) return null;
  const teile = m[1].split('; ');
  const p = /^(.+): stets eine verzweigung \(gelungen oder gescheitert\), nie direkt vor (\S+)$/.exec(teile[0]);
  const pflicht = p ? p[1].split(' | ') : [], abschluss = p ? p[2] : null;
  const gruppen = [];
  (p ? teile.slice(1) : teile).forEach((t, i) => {
    if (i === 0 && t.startsWith(PREFIX)) t = t.slice(PREFIX.length);
    const g = /^(.+?) direkt vor (allen ausser )?(.+)$/.exec(t);
    gruppen.push({ nach: g[1].split(' | '), ausser: !!g[2], namen: g[3].split(' | ') });
  });
  return { pflicht, abschluss, gruppen };
}
// die B, fuer die der Text am Vorgaenger a eine Verzweigung verlangt
function vorVon(Zx, Mx, a) {
  const g = Zx.gruppen.find((x) => x.nach.includes(a));
  return g ? (g.ausser ? Mx.beats.filter((b) => !g.namen.includes(b)) : g.namen) : [];
}
// Probleme der Zeile gegen die Matrix; leere Liste = stimmig
function probleme(Mx, zeile) {
  const P = [], Zx = zerlege(zeile);
  if (!Zx) return ['Zeile nicht lesbar: ' + zeile.slice(0, 80)];
  const k = (a, b) => Mx.zellen[a][b];
  const pflichtM = Mx.vor_abschluss_nie.filter((v) => v.optionen_pflicht).map((v) => v.beat);
  if (JSON.stringify(Zx.pflicht) !== JSON.stringify(pflichtM)) P.push('Pflicht-Beats im Text ' + Zx.pflicht + ' != Matrix ' + pflichtM);
  if (Zx.pflicht.length && Zx.abschluss !== Mx.abschluss_beat) P.push('Abschluss im Text falsch: ' + Zx.abschluss);
  for (const g of Zx.gruppen) {
    if (g.ausser && !g.namen.includes(Mx.abschluss_beat)) P.push('Komplement ohne Abschluss: ' + g.namen);
    for (const b of g.namen) if (b !== Mx.abschluss_beat && !Mx.beats.includes(b)) P.push('unbekannter Beat: ' + b);
    for (const a of g.nach) {
      if (!Mx.beats.includes(a)) { P.push('unbekannter Beat nach: ' + a); continue; }
      if (Zx.pflicht.includes(a)) P.push('Pflicht-Beat als Vorgaenger-Gruppe: ' + a);
      if (g.ausser && Mx.vor_abschluss[a].klasse !== 'ok') P.push(`Komplement schliesst den Abschluss ein, aber ${a} direkt vor ${Mx.abschluss_beat} ist ${Mx.vor_abschluss[a].klasse}`);
      for (const b of vorVon(Zx, Mx, a)) if (!(k(a, b).klasse === 'nurV' && (k(a, b).ort === 'A' || k(a, b).ort === 'A+B'))) P.push(`Aussage ${a} > ${b}, Matrix: ${k(a, b).klasse} ${k(a, b).ort || ''}`);
    }
  }
  for (const a of Mx.beats) for (const b of Mx.beats) {
    const c = k(a, b);
    if (c.klasse !== 'nurV') { if (pflichtM.includes(b) && c.klasse === 'ok') P.push(`${a} > ${b} (Optionen-Pflicht) ist ok: "stets eine verzweigung" stimmt nicht`); continue; }
    if ((c.ort === 'A' || c.ort === 'A+B') && !pflichtM.includes(a) && !vorVon(Zx, Mx, a).includes(b)) P.push(`nurV ${a} > ${b} (Ort ${c.ort}) fehlt im Text`);
    if ((c.ort === 'B' || c.ort === 'A+B') && !pflichtM.includes(b)) P.push(`nurV ${a} > ${b} (Ort ${c.ort}): ${b} ist kein Optionen-Pflicht-Beat, der Text deckt das nicht`);
  }
  for (const v of Mx.vor_abschluss_nie) if (!v.optionen_pflicht) P.push('vor_abschluss nie ohne Optionen-Pflicht: ' + v.beat + ' (nicht im Text)');
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
check('1 jedes nurV-Paar mit Ort A/A+B ist gedeckt, keine Aussage zu Paaren, die nicht nurV sind', pr.length === 0, pr.slice(0, 3).join(' / '));
check('1 bekannte Paare: verfolgung, raumschlacht, hinterhalt vor spontanhilfe; befreiung vor verfolgung; notruf vor befreiung stehen im Text', !!Z && ['verfolgung', 'raumschlacht', 'hinterhalt'].every((a) => vorVon(Z, M, a).includes('spontanhilfe')) && vorVon(Z, M, 'befreiung').includes('verfolgung') && vorVon(Z, M, 'notruf').includes('befreiung'));
check('1 jeder Vorgaenger in hoechstens einer Gruppe, Gruppen mit gleicher Liste zusammengefasst', !!Z && (() => { const alle = Z.gruppen.flatMap((g) => g.nach); const listen = Z.gruppen.map((g) => vorVon(Z, M, g.nach[0]).join()); return alle.length === new Set(alle).size && listen.length === new Set(listen).size; })());
check('1 Ort B und A+B nur bei Optionen-Pflicht-Beats als B (Voraussetzung der Zeile)', !!Z && M.beats.every((a) => M.beats.every((b) => M.zellen[a][b].klasse !== 'nurV' || M.zellen[a][b].ort === 'A' || Z.pflicht.includes(b))));
check('1 zustandsregelText(zustandsregeln(Matrix)) ist die Zeile', AP.zustandsregelText(AP.zustandsregeln(M)) === zeile);
check('1 Text gleich bei zweitem Aufruf (Cache) und nach Neulesen (Determinismus)', AP.katalogText() === text && (neu(), AP.katalogText()) === text);

// ---------- 2 Mutationsprobe: hinterhalt endet gelungen in aktiv, gescheitert in verbuendet -> hinterhalt > spontanhilfe wird ohne Verzweigung gueltig
const mut = mitDaten((B) => { B.hinterhalt.bauplan.aus.gelungen.status = ['aktiv']; B.hinterhalt.bauplan.aus.gescheitert.status = ['verbuendet']; }, () => ({ M: PA.matrix(), text: AP.katalogText() }));
const zM = zerlege(zeileVon(mut.text));
check('2 Mutation: hinterhalt > spontanhilfe ist in der Matrix von nurV zu ok geworden', M.zellen.hinterhalt.spontanhilfe.klasse === 'nurV' && mut.M.zellen.hinterhalt.spontanhilfe.klasse === 'ok');
check('2 Mutation: die Zeile aendert sich; hinterhalt verlangt spontanhilfe nicht mehr, verfolgung weiter (vorher beide)', mut.text !== text && !!zM && vorVon(Z, M, 'hinterhalt').includes('spontanhilfe') && !vorVon(zM, mut.M, 'hinterhalt').includes('spontanhilfe') && vorVon(zM, mut.M, 'verfolgung').includes('spontanhilfe'));
const prM = probleme(mut.M, zeileVon(mut.text));
check('2 Mutation: die geaenderte Zeile ist gegen die geaenderte Matrix stimmig', prM.length === 0, prM.slice(0, 3).join(' / '));
const mutP = mitDaten((B) => { delete B.schmiergeld.bauplan.optionen_pflicht; }, () => zerlege(zeileVon(AP.katalogText())));
check('2 Mutation: schmiergeld ohne optionen_pflicht faellt aus der Pflicht-Liste', !!mutP && mutP.pflicht.join() === 'bitte,forderung');
check('2 nach den Mutationen: Daten im Speicher, Katalog und Matrix wie vorher', JSON.stringify(D.BEATS) === datenVorher && AP.katalogText() === text && JSON.stringify(PA.matrix()) === JSON.stringify(M));

// ---------- 3 Laenge: Basiswert aus dem Katalog ohne die Zeile (Stand vor KAT-01 A: 11 945 Zeichen)
const wachstum = text.length - ohneZeile(text).length;
check('3 Wachstum des Katalogs durch die Zeile hoechstens 600 Zeichen', wachstum > 0 && wachstum <= 600, wachstum);
check('3 Katalog insgesamt hoechstens 11 945 + 600 (Stand vor KAT-01 A plus Budget Paket A)', text.length <= 11945 + 600, text.length);

// ---------- 4 Matrix-Waechter: ein erfundener Beat (Kopie von verfolgung); die Datenlage bestimmt jede Klassifikation
const erf = mitDaten((B) => { B.zz_probe = klon(B.verfolgung); }, () => ({ M: PA.matrix(), text: AP.katalogText() }));
const zE = zerlege(zeileVon(erf.text));
check('4 erfundener Beat steht in der Matrix (Zeile und Spalte)', erf.M.beats.includes('zz_probe') && erf.M.beats.length === M.beats.length + 1 && !!erf.M.zellen.zz_probe && !!erf.M.zellen.hinterhalt.zz_probe);
check('4 erfundener Beat steht im Text, wie die Matrix es verlangt (wie verfolgung: nurV vor spontanhilfe, Verzweigung am Vorgaenger)', !!zE && erf.M.zellen.zz_probe.spontanhilfe.klasse === 'nurV' && zE.gruppen.some((g) => g.nach.includes('zz_probe')) && vorVon(zE, erf.M, 'zz_probe').includes('spontanhilfe'));
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
