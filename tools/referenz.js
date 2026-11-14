'use strict';
// REF-01 A: ein Aufruf fuer die drei Referenztests (Beispiele 1 bis 3) und, auf Wunsch, die lesbaren Mitschnitte dazu.
//
//   node tools/referenz.js 1|2|3|alle [--mitschnitt <ordner>] [--nebenfaelle]      (npm run referenz -- <arg>)
//   Der Aufruf WERTET NICHT selbst: er startet die Tests strikt nacheinander (nie parallel, nie unter Last), zeigt je Beispiel
//   Test, Exit-Code, Dauer und die Schlusszeile des Tests und weist auf die Mutationsproben hin.
//   --mitschnitt <ordner>  danach je Beispiel gezielte Laeufer mit festem Seed (MITSCHNITT=1, MITSCHNITT_DIR je Lauf), Ablage <ordner>/<kennung>/...
//                          Ohne den Schalter entsteht nie ein Mitschnitt.
//   --nebenfaelle          zusaetzlich die Nebenfaelle (nur zusammen mit --mitschnitt)
//   Exit 0: alle gewaehlten Tests und Laeufer haben Exit 0; Exit 1: mindestens einer nicht (alle laufen trotzdem weiter); Exit 2: falscher Aufruf.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------------------------- die Tabelle (DATEN)
// test: Befehlszeile (Argumente fuer node) des Referenztests; mutation: npm-Skript der Mutationsprobe; kennung: Unterordner des Mitschnitts.
// laeufer: Befehlszeile (Argumente fuer node) je Mitschnitt-Lauf; {ordner} = <ordner>/<kennung> (absolut), {tmp} = Wegwerf-Ordner fuer --out.
//   id: Name des Laufs (Unterordner bei MITSCHNITT_DIR fuer die Laeufer ohne --mitschnitt-dir); neben: nur mit --nebenfaelle;
//   braucht: Wort, das im Quelltext des Laeufers stehen muss (per Dateilesen geprueft), sonst wird der Lauf uebersprungen.
const BEISPIELE = {
  1: {
    name: 'Beispiel 1 (Faden Haendler/Piraten)', test: ['tools/test-faden-beispiel1.js'], mutation: 'test:faden-beispiel1-mutation', kennung: 'b1',
    laeufer: [
      { id: 'verweigern', args: ['tools/spiel-forderung.js', '--weg', 'verweigern', '--seed', '605', '--out', '{tmp}', '--mitschnitt-dir', '{ordner}'] },
      { id: 'ausliefern', args: ['tools/spiel-forderung.js', '--weg', 'ausliefern', '--seed', '605', '--out', '{tmp}', '--mitschnitt-dir', '{ordner}'] },
      // der Seed steckt schon im Weg (605 bzw. 601), deshalb kein --seed
      { id: 'bestechen', neben: true, args: ['tools/spiel-forderung.js', '--weg', 'bestechen', '--out', '{tmp}', '--mitschnitt-dir', '{ordner}'] },
      { id: 'verweigern_kern_lehnt_ab', neben: true, args: ['tools/spiel-forderung.js', '--weg', 'verweigern_kern_lehnt_ab', '--out', '{tmp}', '--mitschnitt-dir', '{ordner}'] },
    ],
  },
  2: {
    name: 'Beispiel 2 (Rettung)', test: ['tools/test-faden-beispiel2.js'], mutation: 'test:faden-beispiel2-mutation', kennung: 'b2',
    laeufer: [
      { id: 'havarie-wildnis', args: ['tools/spiel-rettung.js', '--brett', '--variante', 'havarie', '--ort', 'wildnis', '--crew', '3', '--seed', '7'] },
      { id: 'piratenueberfall-schiff', args: ['tools/spiel-rettung.js', '--brett', '--variante', 'piratenueberfall', '--ort', 'schiff', '--crew', '3', '--seed', '7'] },
      { id: 'kette-ruhig-abgegeben', neben: true, args: ['tools/spiel-rettung.js', '--kette', '--besetzung', 'ruhig', '--ende', 'abgegeben', '--crew', '1', '--seed', '7'] },
    ],
  },
  3: {
    name: 'Beispiel 3 (Wrack)', test: ['tools/test-wrack-bot.js'], mutation: 'test:wrack-bot-mutation', kennung: 'b3',
    laeufer: [
      { id: 'ruhig', args: ['tools/spiel-wrack.js', '--besetzung', 'ruhig', '--beute', '--logbuch', '--crew', '3', '--seed', '7'] },
      // Belegte Kombinationen aus test-wrack-bot: raeuber mit Beute und Logbuch nur Crew 1 Seed 5, Crew 3 nur ohne Beute (Crew 3 mit Beute scheitert).
      { id: 'raeuber', args: ['tools/spiel-wrack.js', '--besetzung', 'raeuber', '--crew', '1', '--seed', '5', '--beute', '--logbuch'] },
      { id: 'raeuber-crew3-ohne-beute', neben: true, args: ['tools/spiel-wrack.js', '--besetzung', 'raeuber', '--crew', '3', '--seed', '7'] },
      // kommt mit REF-01 B1: laeuft erst, wenn spiel-wrack.js das Wort kennt
      { id: 'ruhig-verkauf', braucht: '--verkauf', args: ['tools/spiel-wrack.js', '--besetzung', 'ruhig', '--beute', '--logbuch', '--verkauf', '--crew', '3', '--seed', '7'] },
    ],
  },
};

const HILFE = `Aufruf: node tools/referenz.js 1|2|3|alle [--mitschnitt <ordner>] [--nebenfaelle]   (npm run referenz -- <arg>)
  1|2|3|alle        die Referenztests nacheinander ausfuehren (zeigt Exit-Code, Dauer, Schlusszeile; wertet nicht selbst)
  --mitschnitt <o>  danach je Beispiel die Laeufer fuer lesbare Mitschnitte, Ablage <o>/<b1|b2|b3>/...
  --nebenfaelle     mit --mitschnitt: zusaetzlich die Nebenfaelle
Exit 0: alles Exit 0; Exit 1: mindestens ein Test oder Lauf nicht; Exit 2: falscher Aufruf.`;

// ---------------------------------------------------------------------------------------------- Logik (exportiert)
// Liest die Argumente; { fehler } bei falschem Aufruf, sonst { auswahl: [1,2,3], mitschnitt: <abs. Ordner>|null, nebenfaelle }.
function lies(argv) {
  const rest = []; let mitschnitt = null; let nebenfaelle = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mitschnitt') {
      const w = argv[i + 1];
      if (w === undefined || String(w).startsWith('--')) return { fehler: '--mitschnitt braucht einen Ordner' };
      mitschnitt = path.resolve(w); i++;
    } else if (a === '--nebenfaelle') nebenfaelle = true;
    else rest.push(a);
  }
  if (rest.length !== 1) return { fehler: rest.length ? 'genau ein Beispiel angeben' : 'kein Beispiel angegeben' };
  const w = rest[0];
  let auswahl;
  if (w === 'alle') auswahl = Object.keys(BEISPIELE).map(Number);
  else if (/^[123]$/.test(w) && BEISPIELE[w]) auswahl = [Number(w)];
  else return { fehler: `unbekanntes Beispiel: ${w}` };
  if (nebenfaelle && !mitschnitt) return { fehler: '--nebenfaelle gilt nur mit --mitschnitt' };
  return { auswahl, mitschnitt, nebenfaelle };
}

// Baut den Ablauf: tests (in Reihenfolge) und, nur mit Mitschnitt, laeufer. opts.tabelle ersetzt BEISPIELE (Test mit Attrappen),
// opts.wurzel ist der Ordner, in dem der Quelltext der Laeufer fuer "braucht" gelesen wird.
function plane(gelesen, opts) {
  const o = opts || {};
  const tabelle = o.tabelle || BEISPIELE;
  const wurzel = o.wurzel || ROOT;
  const tests = []; const laeufer = [];
  for (const nr of gelesen.auswahl) {
    const b = tabelle[nr];
    tests.push({ nr, name: b.name, cmd: b.test, mutation: b.mutation });
  }
  if (gelesen.mitschnitt) {
    for (const nr of gelesen.auswahl) {
      const b = tabelle[nr];
      const ordner = path.join(gelesen.mitschnitt, b.kennung);
      for (const l of b.laeufer) {
        if (l.neben && !gelesen.nebenfaelle) continue;
        if (l.braucht) {
          let quelle = '';
          try { quelle = fs.readFileSync(path.join(wurzel, l.args[0]), 'utf8'); } catch (e) { quelle = ''; }
          if (!quelle.includes(l.braucht)) { laeufer.push({ nr, id: l.id, uebersprungen: `${l.args[0]} kennt ${l.braucht} noch nicht` }); continue; }
        }
        const mitDir = l.args.includes('--mitschnitt-dir');
        const dir = mitDir ? ordner : path.join(ordner, l.id);
        laeufer.push({
          nr, id: l.id, ordner: dir,
          cmd: l.args.map((a) => a.replace('{ordner}', ordner)),
          env: { MITSCHNITT: '1', MITSCHNITT_DIR: dir },
          tmpNoetig: l.args.includes('{tmp}'),
        });
      }
    }
  }
  return { tests, laeufer };
}

// Startet einen Kindprozess und wartet; behaelt nur die letzte nichtleere Zeile der Ausgabe. opts.zeige: Ausgabe live durchreichen.
function starte(cmd, env, opts) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = cp.spawn(process.execPath, cmd, { cwd: (opts && opts.cwd) || ROOT, env: { ...process.env, ...(env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let rest = ''; let letzte = '';
    const nimm = (d, ziel) => {
      if (opts && opts.zeige && ziel) ziel.write(d);
      rest += d.toString('utf8');
      const teile = rest.split(/\r?\n/); rest = teile.pop();
      for (const t of teile) if (t.trim()) letzte = t.trim();
    };
    child.stdout.on('data', (d) => nimm(d, opts && opts.zeigeOut));
    child.stderr.on('data', (d) => nimm(d, opts && opts.zeigeOut));
    child.on('error', (e) => resolve({ code: 1, start, ende: Date.now(), letzte: 'Start fehlgeschlagen: ' + e.message }));
    child.on('close', (code) => { if (rest.trim()) letzte = rest.trim(); resolve({ code: code === null ? 1 : code, start, ende: Date.now(), letzte }); });
  });
}

// Alle mission.md unterhalb von ordner (absolute Pfade).
function listeMissionen(ordner) {
  const liste = [];
  const geh = (d) => {
    let eintraege = [];
    try { eintraege = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of eintraege) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) geh(p);
      else if (e.name === 'mission.md') liste.push(p);
    }
  };
  geh(ordner);
  return liste;
}

// Zaehlt nur die mission.md, die seit "vorher" (Liste aus listeMissionen) neu sind. Liefert auch ihre Pfade relativ zu ordner und den
// Ordner des Laufs: der erste Unterordner, den alle neuen Dateien teilen, sonst ordner selbst.
function zaehleMissionen(ordner, vorher) {
  const alt = new Set(vorher || []);
  const neu = listeMissionen(ordner).filter((p) => !alt.has(p));
  let zeilen = 0;
  for (const p of neu) zeilen += fs.readFileSync(p, 'utf8').split('\n').length;
  const dateien = neu.map((p) => path.relative(ordner, p));
  const erste = new Set(dateien.map((d) => d.split(path.sep)[0]));
  const laufOrdner = dateien.length && dateien.every((d) => d.split(path.sep).length > 1) && erste.size === 1 ? path.join(ordner, [...erste][0]) : ordner;
  return { dateien: neu.length, zeilen, pfade: dateien, ordner: laufOrdner };
}

// Fuehrt den Plan aus: erst alle Tests, dann die Laeufer, strikt nacheinander. Ein Fehler bricht nichts ab.
// Gibt { code, tests: [...], laeufer: [...] } zurueck; ausgabe(zeile) bekommt die Berichtszeilen (Standard: stdout).
async function fuehreAus(plan, opts) {
  const o = opts || {};
  const aus = o.ausgabe || ((z) => process.stdout.write(z + '\n'));
  const ergTests = []; const ergLaeufer = [];
  let code = 0;
  for (const t of plan.tests) {
    aus(`\n=== ${t.name}: ${t.cmd.join(' ')}`);
    const r = await starte(t.cmd, null, { zeige: !!o.zeige, zeigeOut: o.zeige ? process.stdout : null });
    if (r.code !== 0) code = 1;
    ergTests.push({ nr: t.nr, name: t.name, code: r.code, dauer_s: (r.ende - r.start) / 1000, start: r.start, ende: r.ende, letzte: r.letzte });
  }
  if (plan.tests.length) {
    aus('\n--- Urteil der Tests (nur angezeigt, nicht ausgewertet)');
    for (const e of ergTests) aus(`Beispiel ${e.nr}  ${e.name}  Exit ${e.code}  ${e.dauer_s.toFixed(1)} s  | ${e.letzte || '(keine Ausgabe)'}`);
  }
  if (plan.laeufer.length) {
    aus('\n--- Mitschnitt-Laeufer');
    for (const l of plan.laeufer) {
      if (l.uebersprungen) { aus(`Beispiel ${l.nr}  ${l.id}  uebersprungen: ${l.uebersprungen}`); ergLaeufer.push({ nr: l.nr, id: l.id, uebersprungen: true }); continue; }
      fs.mkdirSync(l.ordner, { recursive: true });
      let tmp = null; let cmd = l.cmd;
      if (l.tmpNoetig) { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-referenz-')); cmd = cmd.map((a) => a.replace('{tmp}', tmp)); }
      const vorher = listeMissionen(l.ordner);
      const r = await starte(cmd, l.env, {});
      if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* Wegwerf-Ordner */ } }
      if (r.code !== 0) code = 1;
      const z = zaehleMissionen(l.ordner, vorher);
      aus(`Beispiel ${l.nr}  ${l.id}  Exit ${r.code}  ${((r.ende - r.start) / 1000).toFixed(1)} s  ${z.ordner}  mission.md: ${z.dateien} Dateien, ${z.zeilen} Zeilen`);
      for (const pf of z.pfade) aus(`    neu: ${pf}`);
      ergLaeufer.push({ nr: l.nr, id: l.id, code: r.code, start: r.start, ende: r.ende, ordner: z.ordner, basisordner: l.ordner, missionen: z.dateien, zeilen: z.zeilen, pfade: z.pfade });
    }
  }
  if (plan.tests.length) {
    aus('\nMutationsproben (je einzeln, nicht Teil dieses Aufrufs):');
    for (const t of plan.tests) aus(`  npm run ${t.mutation}`);
  }
  aus(`\nGesamt: Exit ${code}`);
  return { code, tests: ergTests, laeufer: ergLaeufer };
}

async function main(argv) {
  const g = lies(argv);
  if (g.fehler) { process.stderr.write(g.fehler + '\n' + HILFE + '\n'); return 2; }
  const plan = plane(g);
  const r = await fuehreAus(plan, { zeige: false });
  return r.code;
}

module.exports = { lies, plane, fuehreAus, zaehleMissionen, listeMissionen, BEISPIELE, HILFE };

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
