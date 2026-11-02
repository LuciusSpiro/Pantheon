'use strict';
// TEL-01 G: Buchungsdienste für Marken (server/sim/geld.js) und Verbrauchsgüter (server/sim/vorrat.js).
//   1. Grenze: server/ und shared/ schreiben game.inventory.marks und die Verbrauchsgüter (bolzen, sonde, medipack, loeschgel, loeschgelCharges, ersatzteil,
//      flickblech) nirgends direkt (Zuweisung, ++, --, +=, -=, auch über Aliase wie `const inv = game.inventory` und computed Schlüssel inventory[k]),
//      ausser in den beiden Diensten. Ausnahmen nur über ERLAUBT (kommentiert, jede muss tatsächlich vorkommen).
//      Nicht erfasst (bewusst): deko (Liste), Fracht (server/sim/ladung.js) und die Zähler ladung/tafel mit festem Schlüssel
//      (server/mission/bausteine/buehne.js, server/sim/anker.js: Sprengstoff-Gegenstand, nicht Teil des Pakets).
//   2. Selbsttest des Scanners (er erkennt die Muster, überschätzt Vergleiche nicht).
//   3. Kern: je Dienst genau EINE schreibende Kernfunktion mit dem Protokoll-Haken „TEL-01: hier protokollieren“.
//   4. Funktion: Clamping, „zu wenig -> nichts gebucht“, stille Varianten senden KEIN Ereignis, gutschreiben/abbuchen senden dieselben Ereignisse wie bisher,
//      standSetzen ist keine Buchung (Art 'stand'), unbekannter Grund wirft.
//   Mutationsprobe: tools/mutation-buchungen.js.
//   node tools/test-buchungen.js
const fs = require('fs');
const path = require('path');

const ROOT = process.env.BUCHUNGEN_ROOT || path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name) => console.log('\n[' + name + ']');

// ---- Ausnahmen (Datei, Zeilenausschnitt, Begründung) ----
const ERLAUBT = [
  { datei: 'server/game.js', text: 'this.inventory = Object.assign(', grund: 'Anlage des Inventar-Objekts im Konstruktor (Startwerte aus Config); kein Zu-/Abgang, Dienste brauchen das Objekt schon' },
];
const DIENSTE = ['server/sim/geld.js', 'server/sim/vorrat.js'];

// ---- Scanner ----
const NAMEN = '(?:marks|bolzen|sonde|medipack|loeschgel|loeschgelCharges|ersatzteil|flickblech)';
const OP = '(?:=(?!=|>)|\\+=|-=|\\*=|/=|%=|\\+\\+|--)';

function ohneKommentare(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((z) => z.replace(/(^|[^:\\'"`])\/\/.*$/, '$1')).join('\n');
}
function aliase(code) {
  const namen = new Set(['inventory']);
  const fn = [];   // Funktionen, die das Inventar zurückgeben (anker.js: inventar(game))
  for (const m of code.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{\s*return\s+[^;]*\binventory\b/g)) fn.push(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:[\w$]+(?:\([^()]*\))?\.)*inventory\b(?=\s*[;,)])/g)) namen.add(m[1]);
  for (const f of fn) for (const m of code.matchAll(new RegExp('(?:const|let|var)\\s+(\\w+)\\s*=\\s*' + f + '\\s*\\(', 'g'))) namen.add(m[1]);
  return [...namen];
}
// -> [{ zeile, text }] direkte Schreibzugriffe
function schreibstellen(text) {
  const code = ohneKommentare(text);
  const rec = '(?:' + aliase(code).map((a) => a.replace(/[$]/g, '\\$')).join('|') + ')';
  const muster = [
    new RegExp('\\b' + rec + '\\.' + NAMEN + '\\b\\s*' + OP),                 // inventory.marks += n, inv.bolzen--
    new RegExp('\\b' + rec + '\\[[^\\]]*\\]\\s*' + OP),                        // inventory[k] = v, inv[k]++
    new RegExp('(?:\\+\\+|--)\\s*[\\w$.()]*\\b' + rec + '(?:\\.\\w+|\\[[^\\]]*\\])'),   // ++inventory.x
    /\.inventory\s*=(?!=)/,                                                    // ganzes Objekt ersetzen
    new RegExp('Object\\.assign\\(\\s*[\\w$.()]*\\b' + rec + '\\s*[,)]'),     // Object.assign(inventory, …)
    new RegExp('\\bdelete\\s+[\\w$.()]*\\b' + rec + '(?:\\.|\\[)'),            // delete inventory.x
  ];
  const out = [];
  code.split('\n').forEach((z, i) => { if (muster.some((re) => re.test(z))) out.push({ zeile: i + 1, text: z.trim() }); });
  return out;
}
function dateien(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...dateien(p)); } else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

section('Grenze: keine direkten Schreibzugriffe ausserhalb der Dienste');
{
  const gefunden = []; const benutzt = new Set(); let geprueft = 0;
  for (const wurzel of ['server', 'shared']) {
    for (const f of dateien(path.join(ROOT, wurzel))) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (DIENSTE.includes(rel)) continue;
      geprueft++;
      for (const s of schreibstellen(fs.readFileSync(f, 'utf8'))) {
        const e = ERLAUBT.findIndex((x) => x.datei === rel && s.text.includes(x.text));
        if (e >= 0) benutzt.add(e); else gefunden.push(rel + ':' + s.zeile + '  ' + s.text.slice(0, 140));
      }
    }
  }
  ok(geprueft > 50, geprueft + ' Dateien in server/ und shared/ geprüft');
  for (const g of gefunden) console.log('       direkter Schreibzugriff: ' + g);
  ok(gefunden.length === 0, 'keine direkte Schreibstelle ausserhalb von geld.js und vorrat.js (' + gefunden.length + ' gefunden)');
  ERLAUBT.forEach((x, i) => ok(benutzt.has(i), 'Ausnahme kommt noch vor: ' + x.datei + ' „' + x.text + '“ (' + x.grund + ')'));
}

section('Scanner-Selbsttest');
{
  const trifft = (c) => schreibstellen(c).length > 0;
  for (const c of [
    'game.inventory.marks += 5;', 'g.inventory.bolzen--;', '--game.inventory.medipack;', 'game.inventory.sonde = 3;', 'game.inventory[k] = v;', 'this.inventory[item]++;',
    'const inv = game.inventory;\ninv.marks -= 1;', 'const inv = g_(m).inventory;\ninv.loeschgel = 0;', 'const inv = game.inventory;\ninv[x]++;',
    'function inventar(game) { return game.inventory || {}; }\nconst i = inventar(game);\ni.ersatzteil -= 1;', 'game.inventory = {};', 'Object.assign(game.inventory, { marks: 1 });',
    'delete game.inventory.flickblech;', 'game.inventory.loeschgelCharges *= 2;',
  ]) ok(trifft(c), 'erkannt: ' + c.replace(/\n/g, ' ').slice(0, 70));
  for (const c of [
    'if (game.inventory.marks >= 5) return;', 'if (inv.marks === 3) {}', 'const x = game.inventory.bolzen - 1;', 'r.sonde = false;', '// game.inventory.marks += 1;',
    '/* game.inventory.bolzen-- */', 'game.inventory.ladung -= 1;', 'const marks = g.inventory.marks;', 'if (game.inventory.medipack <= 0) return;', "const t = 'inventory.marks = 3';".replace('inventory', 'x'),
  ]) ok(!trifft(c), 'nicht erkannt (Lesen/Kommentar/anderer Schlüssel): ' + c);
}

section('Kern: je Dienst genau eine schreibende Kernfunktion');
for (const [datei, schreib] of [['server/sim/geld.js', /\.inventory\.marks\s*=(?!=)/g], ['server/sim/vorrat.js', /\.inventory\[[^\]]+\]\s*=(?!=)/g]]) {
  const code = ohneKommentare(fs.readFileSync(path.join(ROOT, datei), 'utf8'));
  ok((code.match(schreib) || []).length === 1, datei + ': genau eine Schreibstelle (die Kernfunktion schreiben)');
  const roh = fs.readFileSync(path.join(ROOT, datei), 'utf8');
  ok((ohneKommentare(roh).match(/'stand'/g) || []).length === 2, datei + ': Art "stand" nur in standSetzen (Konstante ARTEN + eine Verwendung), alles andere ist "buchung"');
  ok((roh.match(/TEL-01: hier protokollieren/g) || []).length === 1, datei + ': Protokoll-Haken „TEL-01: hier protokollieren“ genau einmal');
}

// ---- Funktionstests ----
const Geld = require(path.join(ROOT, 'server/sim/geld.js'));
const Vorrat = require(path.join(ROOT, 'server/sim/vorrat.js'));
const wirft = (f) => { try { f(); return false; } catch (e) { return true; } };
function spiel(inv) {
  const g = { inventory: Object.assign({ marks: 100 }, inv || {}), ereig: [] };
  g.emit = (...a) => g.ereig.push(['emit', ...a]);
  g.missionEvent = (...a) => g.ereig.push(['missionEvent', ...a]);
  return g;
}
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

section('Geld: gutschreiben / abbuchen (mit Ereignis, wie bisher)');
{
  const g = spiel();
  ok(Geld.gutschreiben(g, 2.7, 'verkauf') === 102 && g.inventory.marks === 102, 'gutschreiben rundet ab auf ganze Zahlen');
  ok(gleich(g.ereig, [['emit', 'sfx', { name: 'discovery', volume: 0.5 }], ['missionEvent', 'marksCredited', { n: 2, grund: 'verkauf', marks: 102 }]]), 'gutschreiben: sfx discovery, dann marksCredited { n, grund, marks }, sonst nichts');
  g.ereig.length = 0;
  ok(Geld.gutschreiben(g, -5, 'verkauf') === 102 && Geld.gutschreiben(g, 0, 'verkauf') === 102 && g.ereig.length === 0, 'gutschreiben: n <= 0 bucht nichts und sendet nichts');
  ok(Geld.abbuchen(g, 2, 'werft') && g.inventory.marks === 100 && gleich(g.ereig, [['missionEvent', 'marksPaid', { n: 2, grund: 'werft', marks: 100 }]]), 'abbuchen: marksPaid { n, grund, marks }, kein sfx');
  g.ereig.length = 0;
  ok(!Geld.abbuchen(g, 500, 'werft') && g.inventory.marks === 100 && g.ereig.length === 0, 'abbuchen mit zu wenig: false, nichts gebucht, kein Ereignis');
  ok(Geld.abbuchen(g, 0, 'werft') && g.ereig.length === 0, 'abbuchen 0: true, kein Ereignis');
  ok(Geld.abbuchen(g, 100, 'werft') && g.inventory.marks === 0, 'abbuchen des ganzen Standes: 0');
  g.ereig.length = 0; g.inventory.marks = 7;
  Geld.gutschreibenSkript(g, 3, 'beute_text');
  ok(g.inventory.marks === 10 && g.ereig[1][2].grund === 'beute_text', 'gutschreibenSkript: Text des Skripts bleibt im Ereignis');
  ok(wirft(() => Geld.gutschreiben(g, 1, 'gibtsnicht')) && wirft(() => Geld.abbuchen(g, 1, 'gibtsnicht')) && wirft(() => Geld.gutschreiben(g, 1)) && wirft(() => Geld.einnehmen(g, 1, 'gibtsnicht')) && wirft(() => Geld.standSetzen(g, 1, 'gibtsnicht')),
    'unbekannter oder fehlender Grund wirft (Programmierfehler)');
  ok(g.inventory.marks === 10, 'ein geworfener Grund hat nichts gebucht');
}

section('Geld: stille Varianten senden KEIN Ereignis');
{
  const g = spiel();
  ok(Geld.einnehmen(g, 15, 'abschuss') === 115 && g.inventory.marks === 115, 'einnehmen addiert');
  ok(Geld.erstatten(g, 300, 'migration') === 415, 'erstatten addiert');
  ok(Geld.bezahlen(g, 15, 'kauf') && g.inventory.marks === 400, 'bezahlen: Stand reicht -> gebucht');
  ok(!Geld.bezahlen(g, 401, 'kauf') && g.inventory.marks === 400, 'bezahlen: zu wenig -> false, nichts gebucht');
  ok(Geld.bezahlen(g, 400, 'kauf') && g.inventory.marks === 0, 'bezahlen: genau der Stand');
  g.inventory.marks = 30;
  ok(Geld.abziehenHoechstens(g, 50, 'notfall') === 30 && g.inventory.marks === 0, 'abziehenHoechstens: Clamping auf 0, Rückgabe = tatsächlich abgezogen (30)');
  g.inventory.marks = 80;
  ok(Geld.abziehenHoechstens(g, 50, 'notfall') === 50 && g.inventory.marks === 30, 'abziehenHoechstens: genug da -> voller Betrag');
  ok(g.ereig.length === 0, 'keine einzige stille Variante hat emit oder missionEvent gesendet (' + g.ereig.length + ' Ereignisse)');
}

section('Geld: standSetzen ist keine Buchung');
{
  const g = spiel();
  ok(Geld.standSetzen(g, 777, 'laden') === 777 && g.inventory.marks === 777 && g.ereig.length === 0, 'standSetzen setzt den Stand ohne Ereignis');
  ok(Geld.stand(g) === 777 && Geld.mindestens(g, 777) && !Geld.mindestens(g, 778), 'stand / mindestens lesen');
  ok(Geld.GRUENDE.includes('laden') && Geld.GRUENDE.includes('testmarken') && Geld.GRUENDE.includes('debug') && Geld.GRUENDE.includes('start'), 'Gründe für Stand: start, testmarken, debug, laden');
}

section('Vorrat: entnehmen / einlagern / leeren / abziehenHoechstens / standSetzen');
{
  const g = spiel({ bolzen: 3, loeschgelCharges: 2 });
  ok(Vorrat.entnehmen(g, 'bolzen', 1, 'torpedo') && g.inventory.bolzen === 2, 'entnehmen: genug da -> gebucht');
  ok(!Vorrat.entnehmen(g, 'bolzen', 3, 'torpedo') && g.inventory.bolzen === 2, 'entnehmen: zu wenig -> false, nichts gebucht');
  ok(Vorrat.entnehmen(g, 'bolzen', 2, 'torpedo') && g.inventory.bolzen === 0 && !Vorrat.entnehmen(g, 'bolzen', 1, 'torpedo'), 'entnehmen bis 0, dann false');
  ok(!Vorrat.entnehmen(g, 'medipack', 1, 'nachschub') && g.inventory.medipack === undefined, 'entnehmen aus fehlendem Schlüssel: false, nichts angelegt');
  ok(Vorrat.einlagern(g, 'medipack', 2, 'kauf') === 2 && Vorrat.einlagern(g, 'medipack', 1, 'kauf') === 3, 'einlagern legt fehlenden Schlüssel an und addiert');
  ok(Vorrat.leeren(g, 'loeschgelCharges', 'regal') === 2 && g.inventory.loeschgelCharges === 0, 'leeren: gibt die Menge zurück, setzt 0');
  g.inventory.ersatzteil = 2;
  ok(Vorrat.abziehenHoechstens(g, 'ersatzteil', 5, 'posten') === 2 && g.inventory.ersatzteil === 0, 'abziehenHoechstens: Clamping auf 0, Rückgabe = tatsächlich abgezogen');
  ok(Vorrat.abziehenHoechstens(g, 'ersatzteil', 5, 'posten') === 0 && g.inventory.ersatzteil === 0, 'abziehenHoechstens bei 0: nichts');
  ok(Vorrat.standSetzen(g, 'flickblech', 9, 'laden') === 9 && g.inventory.flickblech === 9 && g.ereig.length === 0, 'standSetzen setzt den Bestand, ohne Ereignis');
  ok(g.inventory.marks === 100, 'Marken blieben unberührt');
  ok(wirft(() => Vorrat.einlagern(g, 'bolzen', 1, 'gibtsnicht')) && wirft(() => Vorrat.entnehmen(g, 'bolzen', 1)) && wirft(() => Vorrat.standSetzen(g, 'bolzen', 1, 'gibtsnicht')), 'unbekannter oder fehlender Grund wirft');
  ok(wirft(() => Vorrat.einlagern(g, 'marks', 1, 'kauf')) && wirft(() => Vorrat.standSetzen(g, 'deko', 1, 'laden')), 'marks und deko sind kein Vorratsschlüssel (Marken: geld.js)');
  ok(Vorrat.GUETER.length === 7 && ['bolzen', 'sonde', 'medipack', 'loeschgel', 'loeschgelCharges', 'ersatzteil', 'flickblech'].every((x) => Vorrat.GUETER.includes(x)), 'Verbrauchsgüter: die sieben bekannten');
}

section('Torpedo-Lager (lagerGutschrift über den Vorrat)');
{
  const Waffen = require(path.join(ROOT, 'server/sim/schiffswaffen.js'));
  const g = spiel({ bolzen: 10 });
  g.oda = (...a) => g.ereig.push(['oda', ...a]);
  ok(Waffen.lagerGutschrift(g, 'bolzen', 5) === 2 && g.inventory.bolzen === 12 && g.inventory.marks === 130, 'Lager voll: 2 eingelagert, 3 Überhang zu 30 Marken verkauft');
  ok(g.ereig.length === 1 && g.ereig[0][0] === 'oda', 'nur die ODA-Meldung, kein missionEvent/sfx');
  g.ereig.length = 0;
  ok(Waffen.lagerGutschrift(g, 'medipack', 2) === 2 && g.inventory.medipack === 2 && g.ereig.length === 0, 'andere Güter: einfach einlagern');
}

console.log('\n' + (n - fails) + '/' + n + ' ok');
process.exit(fails ? 1 : 0);
