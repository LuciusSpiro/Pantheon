'use strict';
// SPL-01 a3: Selbsttest der Messwerkzeuge tools/messe-spl-*.js (matrix, kontext, kontext-wachstum, rueckfall, anker, rudel).
// Geprueft wird das Werkzeug, nicht der Messwert: Exit-Codes (0 gemessen, 2 falscher Aufruf), JSON-Form, Selbstkonsistenz der Zahlen
// (Karten + Wuerfe = Seeds, ok + fehler = Seeds, Wachstum linear), Determinismus des Rueckfall-Zaehlers, und was die Werkzeuge vom Produkt voraussetzen
// (Oberflaeche-Rudel setzbar, Pflichtsatz-Anker 'abholpunkt' auf jeder Karte). Die Messwerte selbst (Anker-Minima, Rudel in der Hoehle, Kontext-Luft)
// sind Befunde der Erkundung SPL-01 und aendern sich mit den Paketen a1/a2; sie sind hier bewusst keine Erwartung.
// Die Werkzeuge laufen als Kindprozesse parallel, kleine Seed-Saetze (wenige Sekunden).
// Aufruf: node tools/test-messe-spl.js        (npm run test:messe-spl)
const path = require('path');
const cp = require('child_process');

const TOOLS = ['matrix', 'kontext', 'kontext-wachstum', 'rueckfall', 'anker', 'rudel'];
const datei = (t) => path.join(__dirname, `messe-spl-${t}.js`);

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

function lauf(t, args) {
  return new Promise((resolve) => {
    const p = cp.spawn(process.execPath, [datei(t), ...args], { cwd: path.join(__dirname, '..') });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
function json(r) { try { return JSON.parse(r.out); } catch (e) { return null; } }

(async () => {
  const [matrix, kontext, wachstum, rueck, rueck2, anker, rudel, ...falsch] = await Promise.all([
    lauf('matrix', ['--kartenart', 'schiff', '--json']),
    lauf('kontext', ['--json']),
    lauf('kontext-wachstum', ['--json']),
    lauf('rueckfall', ['--seeds', '4', '--json']),
    lauf('rueckfall', ['--seeds', '4', '--json']),
    lauf('anker', ['--seeds', '2', '--json']),
    lauf('rudel', ['--seeds', '2', '--json']),
    ...TOOLS.map((t) => lauf(t, ['--gibt-es-nicht'])),
  ]);
  const hilfe = await Promise.all(TOOLS.map((t) => lauf(t, ['--hilfe'])));

  console.log('Aufruf');
  ok(falsch.every((r) => r.code === 2 && /Aufruf/.test(r.err)), 'unbekannte Option: Exit 2 mit Aufruf-Hinweis bei allen sechs Werkzeugen');
  ok(hilfe.every((r) => r.code === 0 && /Aufruf: node tools\/messe-spl-/.test(r.out)), '--hilfe: Exit 0 und Aufrufzeile bei allen sechs');
  const [bad1, bad2, bad3] = await Promise.all([lauf('anker', ['--seeds', '0']), lauf('matrix', ['--kartenart', 'mond']), lauf('kontext-wachstum', ['--art', 'schiff'])]);
  ok(bad1.code === 2 && bad2.code === 2 && bad3.code === 2, 'ungueltige Werte (--seeds 0, --kartenart mond, --art schiff): Exit 2');

  console.log('Pruefer-Matrix');
  const m = json(matrix);
  ok(matrix.code === 0 && m && m.seeds === 1 && Array.isArray(m.zeilen) && m.zeilen.length > 5, 'Exit 0, JSON mit Zeilen (--kartenart schiff)');
  const mitErg = m ? m.zeilen.filter((z) => z.ergebnis) : [];
  ok(mitErg.length > 0 && mitErg.every((z) => Object.keys(z.ergebnis).join() === 'schiff'), 'nur die gewaehlte Kartenart in den Ergebnissen');
  ok(mitErg.every((z) => z.ergebnis.schiff.ok === z.ergebnis.schiff.von || Object.keys(z.ergebnis.schiff.fehler).length > 0), 'je Ergebnis ok oder mindestens ein Fehlercode');
  ok(mitErg.some((z) => z.ergebnis.schiff.ok === 1), 'mindestens eine Boden-Umsetzung laeuft auf Kartenart schiff durch');
  ok(mitErg.some((z) => z.ergebnis.schiff.fehler['BUEHNE-ART'] > 0), 'mindestens eine Umsetzung scheitert an BUEHNE-ART (Kartenart nicht erlaubt)');

  console.log('Kontext');
  const k = json(kontext);
  ok(kontext.code === 0 && k && k.welten.length >= 5 && k.maxPlus === Math.max(...k.welten.map((w) => w.plus)), 'Exit 0, je Weltstand eine Zeile, maxPlus = Maximum');
  ok(k && k.luft === k.grenze - k.maxPlus && k.welten.every((w) => w.nachher - w.vorher === w.plus || Math.abs(w.nachher - w.vorher - w.plus) <= 1), 'Luft = Grenze - maxPlus, plus = nachher - vorher (Rundung)');
  ok(k && k.maxPlus > 500 && k.kartenarten.length >= 5 && k.fraktionen.length >= 5, 'Kontext traegt Kartenarten und Fraktionen (Zuwachs > 500 Tokens)');

  console.log('Kontext-Wachstum');
  const w = json(wachstum);
  const z = w ? w.zeilen : [];
  ok(wachstum.code === 0 && z.map((x) => x.n).join() === '0,5,10,20,40' && z.every((x) => x.eintraege === x.n), 'Exit 0, n = 0/5/10/20/40, jeder angelegte Landepunkt steht im Kontext');
  ok(z.length === 5 && z.every((x, i) => i === 0 || x.tokens > z[i - 1].tokens), 'Tokens wachsen streng mit n');
  ok(z.length === 5 && z[4].plus > 0 && Math.abs(z[4].plus / 40 - z[1].plus / 5) / (z[1].plus / 5) < 0.1, 'Wachstum linear (je Landepunkt bei n=40 und n=5 auf 10 % gleich)');

  console.log('Rueckfall-Zaehler');
  const r = json(rueck); const r2 = json(rueck2);
  ok(rueck.code === 0 && r && r.seeds === 4 && r.mock.plaene === 4 && r.archiv.plaene <= 4 && r.plaeneGesamt === r.archiv.plaene + 4, 'Exit 0, 4 Seeds, Plaene gezaehlt');
  ok(r && r2 && JSON.stringify(r) === JSON.stringify(r2), 'deterministisch (zwei Laeufe gleiches Ergebnis)');

  console.log('Anker-Sweep');
  const a = json(anker);
  ok(anker.code === 0 && a && a.gruppen.length === 16, 'Exit 0, 16 Gruppen (9 Wildnis, 3 Hoehle, 4 Wildnis+Hoehle)');
  ok(a && a.gruppen.every((g) => g.karten + g.wuerfe === 2), 'je Gruppe Karten + Wuerfe = Seeds');
  ok(a && a.gruppen.every((g) => g.karten === 0 || g.min.abholpunkt >= 1), "jede gemessene Karte hat einen Abholpunkt (Pflichtsatz 'abholpunkt' des Kontexts)");
  ok(a && a.pflichtsatz.some((p) => p.art === 'wildnis') && a.pflichtsatz.some((p) => p.art === 'hoehle'), 'Pflichtsatz des Kontexts fuer wildnis und hoehle gegen Messung ausgewiesen');

  console.log('Rudel-Erreichbarkeit');
  const d = json(rudel);
  ok(rudel.code === 0 && d && d.faelle.length === 5 && d.faelle.every((f) => f.ok + f.fehler === f.von), 'Exit 0, 5 Faelle, ok + fehler = Seeds');
  const f = (nm) => (d ? d.faelle.find((x) => x.name === nm) : null);
  ok(f('wildnis') && f('wildnis').ok === 2 && f('hoehle') && f('hoehle').ok === 2, 'Rudel auf Wildnis-Oberflaeche und in der Hoehle setzbar (2/2)');

  console.log(`\n${n - fails}/${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
