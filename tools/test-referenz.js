'use strict';
// Tests des Referenz-Aufrufs (REF-01 A) – npm run test:referenz.
// Startet KEINE echten Referenztests: referenz.js bekommt eine Tabelle mit Attrappen-Befehlen (node -e). Schreibt nur in ein mkdtemp-Verzeichnis.
//   a Argumentpruefung   b alle gruen -> 0   c ein roter Test -> 1, die anderen laufen   d strikt nacheinander
//   e ohne --mitschnitt weder Umgebung noch Laeufer, mit --mitschnitt Tabelle mit Umgebung (+ Nebenfaelle)
//   f echter Kindprozess: node tools/referenz.js ohne Argument -> Exit 2

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const R = require('./referenz.js');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-referenz-test-'));
const ZEIT = path.join(TMP, 'zeit.log');

// Attrappe: wartet kurz, haengt Start/Ende an eine Datei, beendet mit dem Code; Laeufer schreiben ihre Umgebung.
const attrappe = (id, code, ms) => ['-e', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(ZEIT)},'${id} start '+Date.now()+'\\n');setTimeout(()=>{fs.appendFileSync(${JSON.stringify(ZEIT)},'${id} ende '+Date.now()+'\\n');console.log('${id} 3/3 Pruefungen ok');process.exit(${code})},${ms})`];
const laeuferAttrappe = (code) => ['-e', `const fs=require('fs'),p=require('path');const d=process.env.MITSCHNITT_DIR;fs.mkdirSync(p.join(d,'01_x'),{recursive:true});fs.writeFileSync(p.join(d,'01_x','mission.md'),'a\\nb\\nc');fs.writeFileSync(p.join(d,'env.json'),JSON.stringify({m:process.env.MITSCHNITT}));process.exit(${code})`];
const tabelle = (codes) => ({
  1: { name: 'A1', test: attrappe('t1', codes[0], 150), mutation: 'm1', kennung: 'b1', laeufer: [
    { id: 'l1', args: laeuferAttrappe(0) }, { id: 'l1n', neben: true, args: laeuferAttrappe(0) } ] },
  2: { name: 'A2', test: attrappe('t2', codes[1], 150), mutation: 'm2', kennung: 'b2', laeufer: [ { id: 'l2', args: laeuferAttrappe(codes[3] || 0) } ] },
  3: { name: 'A3', test: attrappe('t3', codes[2], 150), mutation: 'm3', kennung: 'b3', laeufer: [ { id: 'l3', args: laeuferAttrappe(0) } ] },
});
const still = { ausgabe: () => {} };

(async () => {
  // a Argumentpruefung
  check('a kein Argument -> Fehler', !!R.lies([]).fehler);
  check('a "4" -> Fehler', !!R.lies(['4']).fehler);
  check('a "x" -> Fehler', !!R.lies(['x']).fehler);
  check('a "1,2" -> Fehler', !!R.lies(['1,2']).fehler);
  check('a zwei Beispiele -> Fehler', !!R.lies(['1', '2']).fehler);
  check('a --mitschnitt ohne Ordner -> Fehler', !!R.lies(['1', '--mitschnitt']).fehler);
  check('a --nebenfaelle ohne --mitschnitt -> Fehler', !!R.lies(['1', '--nebenfaelle']).fehler);
  check('a "2" -> nur Beispiel 2', JSON.stringify(R.lies(['2']).auswahl) === '[2]');
  check('a "alle" -> 1,2,3', JSON.stringify(R.lies(['alle']).auswahl) === '[1,2,3]');

  // b alle gruen
  fs.writeFileSync(ZEIT, '');
  let g = R.lies(['alle']);
  let zeilen = [];
  let r = await R.fuehreAus(R.plane(g, { tabelle: tabelle([0, 0, 0]) }), { ausgabe: (z) => zeilen.push(z) });
  check('b alle gruen -> Exit 0', r.code === 0 && r.tests.length === 3 && r.tests.every((t) => t.code === 0));
  check('b Schlusszeile des Tests wird angezeigt', zeilen.some((z) => z.includes('t2 3/3 Pruefungen ok')));
  check('b Hinweis auf Mutationsproben', ['npm run m1', 'npm run m2', 'npm run m3'].every((s) => zeilen.some((z) => z.includes(s))));

  // d strikt nacheinander (Zeiten aus der Datei, unabhaengig vom Rueckgabewert)
  const ev = fs.readFileSync(ZEIT, 'utf8').trim().split('\n').map((z) => z.split(' '));
  const ordnung = ev.map((e) => e[0] + ':' + e[1]).join(',');
  check('d Reihenfolge t1 t2 t3, nie ueberlappend', ordnung === 't1:start,t1:ende,t2:start,t2:ende,t3:start,t3:ende', ordnung);
  check('d Zeiten wachsen', ev.every((e, i) => i === 0 || Number(e[2]) >= Number(ev[i - 1][2])));

  // c ein roter Test, die anderen laufen
  fs.writeFileSync(ZEIT, '');
  r = await R.fuehreAus(R.plane(R.lies(['alle']), { tabelle: tabelle([0, 1, 0]) }), still);
  check('c roter Test -> Exit 1', r.code === 1);
  check('c alle drei liefen, Codes 0/1/0', r.tests.length === 3 && r.tests.map((t) => t.code).join('') === '010');
  check('c der dritte lief nach dem roten', fs.readFileSync(ZEIT, 'utf8').includes('t3 ende'));

  // e ohne --mitschnitt
  let p = R.plane(R.lies(['alle']), { tabelle: tabelle([0, 0, 0]) });
  check('e ohne --mitschnitt keine Laeufer', p.laeufer.length === 0);
  fs.writeFileSync(ZEIT, '');
  const probe = { ...tabelle([0, 0, 0]) };
  probe[1] = { ...probe[1], test: ['-e', "process.exit(process.env.MITSCHNITT||process.env.MITSCHNITT_DIR?1:0)"] };
  const alt = { m: process.env.MITSCHNITT, d: process.env.MITSCHNITT_DIR };
  process.env.MITSCHNITT = '1'; process.env.MITSCHNITT_DIR = path.join(TMP, 'geerbt');   // in der Shell gesetzt: darf nicht in den Test gelangen
  r = await R.fuehreAus(R.plane(R.lies(['1']), { tabelle: probe }), still);
  if (alt.m !== undefined) process.env.MITSCHNITT = alt.m; else delete process.env.MITSCHNITT; if (alt.d !== undefined) process.env.MITSCHNITT_DIR = alt.d; else delete process.env.MITSCHNITT_DIR;
  check('e ein in der Shell gesetztes MITSCHNITT/MITSCHNITT_DIR gelangt nicht in den Test (Kindprozess endet mit 0)', r.code === 0);

  // e mit --mitschnitt
  const ms = path.join(TMP, 'ms');
  g = R.lies(['alle', '--mitschnitt', ms]);
  check('e --mitschnitt wird absolut gelesen', g.mitschnitt === path.resolve(ms));
  p = R.plane(g, { tabelle: tabelle([0, 0, 0]) });
  const ids = p.laeufer.map((l) => l.id).join(',');
  check('e ohne --nebenfaelle: Hauptlaeufer, kein Nebenfall', ids === 'l1,l2,l3', ids);
  check('e Umgebung je Lauf (MITSCHNITT=1, MITSCHNITT_DIR absolut unter <ordner>/<kennung>)', p.laeufer.every((l) => l.env.MITSCHNITT === '1' && path.isAbsolute(l.env.MITSCHNITT_DIR) && l.env.MITSCHNITT_DIR.startsWith(path.join(ms, 'b'))));
  const pn = R.plane(R.lies(['1', '--mitschnitt', ms, '--nebenfaelle']), { tabelle: tabelle([0, 0, 0]) });
  check('e mit --nebenfaelle auch der Nebenfall', pn.laeufer.some((l) => l.id === 'l1n'));
  fs.writeFileSync(ZEIT, '');
  zeilen = [];
  r = await R.fuehreAus(p, { ausgabe: (z) => zeilen.push(z) });
  check('e Laeufer liefen, Exit 0, Mission gezaehlt (3 Zeilen)', r.code === 0 && r.laeufer.every((l) => l.code === 0 && l.missionen === 1 && l.zeilen === 3), JSON.stringify(r.laeufer));
  check('e Umgebung kam im Laeufer an', JSON.parse(fs.readFileSync(path.join(ms, 'b1', 'l1', 'env.json'), 'utf8')).m === '1');
  check('e Bericht nennt Ordner und Zeilen', zeilen.some((z) => z.includes(path.join(ms, 'b2', 'l2')) && z.includes('3 Zeilen')));
  const lz = r.laeufer;
  check('e Laeufer nacheinander', lz.every((l, i) => i === 0 || l.start >= lz[i - 1].ende));
  r = await R.fuehreAus(R.plane(R.lies(['alle', '--mitschnitt', path.join(TMP, 'ms2')]), { tabelle: tabelle([0, 0, 0, 1]) }), still);
  check('e roter Laeufer -> Exit 1, der Rest laeuft', r.code === 1 && r.laeufer.some((l) => l.id === 'l3' && l.code === 0));

  // g Zaehlung je Lauf, nicht kumulativ: zwei Laeufer schreiben je eine mission.md in denselben Ordner (wie spiel-forderung unter b1)
  const gleich = (id) => ['-e', `const fs=require('fs'),p=require('path');const d=p.join(process.env.MITSCHNITT_DIR,'${id}-x');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,'mission.md'),'a\\nb')`];
  const tg = { 1: { name: 'G', test: ['-e', '0'], mutation: 'mg', kennung: 'b1', laeufer: [
    { id: 'g1', args: [...gleich('g1'), '--', '--mitschnitt-dir', '{ordner}'] }, { id: 'g2', args: [...gleich('g2'), '--', '--mitschnitt-dir', '{ordner}'] }, { id: 'g3', args: [...gleich('g3'), '--', '--mitschnitt-dir', '{ordner}'] } ] } };
  zeilen = [];
  r = await R.fuehreAus(R.plane(R.lies(['1', '--mitschnitt', path.join(TMP, 'ms3')]), { tabelle: tg }), { ausgabe: (z) => zeilen.push(z) });
  check('g je Lauf genau 1 Datei, 2 Zeilen (nicht kumulativ)', r.laeufer.length === 3 && r.laeufer.every((l) => l.missionen === 1 && l.zeilen === 2), JSON.stringify(r.laeufer));
  check('g Ordner des Laufs und neue Pfade', r.laeufer.every((l) => l.ordner === path.join(TMP, 'ms3', 'b1', l.id + '-x') && l.pfade.length === 1) && zeilen.some((z) => z.includes('neu: g2-x')));
  const tabB = R.BEISPIELE[3].laeufer;
  check('g Beispiel 3: raeuber = Crew 1 Seed 5 mit Beute und Logbuch', tabB.some((l) => l.id === 'raeuber' && !l.neben && ['--crew', '1', '--seed', '5', '--beute', '--logbuch'].every((a) => l.args.includes(a))));
  check('g Beispiel 3: Nebenfall raeuber-crew3-ohne-beute', tabB.some((l) => l.id === 'raeuber-crew3-ohne-beute' && l.neben && !l.args.includes('--beute') && l.args.includes('3')));

  // f echter Aufruf
  const k = cp.spawnSync(process.execPath, [path.join(__dirname, 'referenz.js')], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
  check('f Aufruf ohne Argument -> Exit 2, Hilfe auf stderr', k.status === 2 && /Aufruf/.test(k.stderr) && !k.stdout);
  const k2 = cp.spawnSync(process.execPath, [path.join(__dirname, 'referenz.js'), '1,2'], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
  check('f "1,2" -> Exit 2', k2.status === 2);

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* Wegwerf */ }
  const fails = results.filter((x) => !x.ok);
  for (const x of results) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}${x.ok || !x.detail ? '' : ' :: ' + x.detail}`);
  console.log(`\n${results.length - fails.length}/${results.length} Pruefungen ok`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
