'use strict';
// TEL-01 G: Buchungsdienste für Marken (server/sim/geld.js) und Verbrauchsgüter (server/sim/vorrat.js).
//   1. Grenze (statisch, Vorfilter): server/ und shared/ schreiben game.inventory.marks und die Verbrauchsgüter nirgends direkt – auch nicht über Aliase
//      (`const inv = game.inventory || {}`, `?? {}`, Destructuring, `let inv; inv = …`, Parameter, Reflect.set, Zeilenumbruch vor `.marks`), ausser in den Diensten.
//      Ausnahmen nur über ERLAUBT (exakte Zeile einer Datei, kommentiert, jede muss vorkommen). Ein Regex findet nie alles: die Laufzeitprobe (Punkt 6) ist die Grenze.
//   2. Selbsttest des Scanners.  3. Kern: je Dienst genau EINE schreibende Kernfunktion mit dem Protokoll-Haken.
//   4. Funktion im STRENGEN Modus (unbekannter Grund/Gut/Art wirft): Clamping, „zu wenig -> nichts gebucht“, stille Varianten ohne Ereignis, Ereignisse wie bisher.
//   5. Spielverhalten wie vor dem Umbau: unbekannte Eingaben (remove_item marks, debug_item_aboard marks, ensureItem marks, lagerGutschrift marks, kampagnegeld.zahlen
//      mit unbekanntem Posten, Weltstand mit lager.marks) werfen im Spiel NIE, buchen wie früher und zählen einen Fehler; Bruchteil-Bestände rechnen wie früher;
//      Aufrufstellen mit echtem Spiel (Abschuss, Notfall, Bergung, Sonden, Medipack); Tabelle der Aufrufstellen von geld.js.
//   6. Laufzeitprobe (tools/buchungen-probe.js): game.inventory als Proxy, der jeden Schreibzugriff aus server/ und shared/ ausser geld.js/vorrat.js meldet – in kurzen
//      Läufen von sim-headless (wellen, graben, arena) und in den Tests für Shop/Werft, Weltstand (Laden/Speichern), Regiebuch, Handelsinfo, Lager, Posten, Sonden, Waffen, Entern.
//   Umgebung: BUCHUNGEN_ROOT (anderes Wurzelverzeichnis, Mutationsprobe), BUCHUNGEN_PROBE=aus|arena|schnell (Probe auslassen / nur Arena-Lauf / nur test-entern).
//   Mutationsprobe: tools/mutation-buchungen.js.      node tools/test-buchungen.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.env.BUCHUNGEN_ROOT || path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name) => console.log('\n[' + name + ']');
process.on('uncaughtException', (e) => { console.log('  FEHLER unerwarteter Abbruch: ' + String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')); process.exit(1); });   // ein Wurf im Spiel ist ein Befund, kein Absturz des Tests

// ---- Ausnahmen: exakte Zeile (getrimmt) einer Datei, mit Begründung ----
const ERLAUBT = [
  { datei: 'server/game.js', zeile: "this.inventory = Object.assign({ loeschgelCharges: 0, marks: C.economy.startMarks, deko: [], tafel: 0 }, JSON.parse(JSON.stringify(C.economy.startInventory)));",
    grund: 'Anlage des Inventar-Objekts in reset() (Startwerte aus Config); kein Zu-/Abgang. Gleich danach führen Geld.standSetzen/Vorrat.standSetzen den Startstand durch die Kernfunktion' },
];
const DIENSTE = ['server/sim/geld.js', 'server/sim/vorrat.js'];

// ---- Scanner ----
const NAMEN = '(?:marks|bolzen|sonde|medipack|loeschgel|loeschgelCharges|medipackCharges|ersatzteil|flickblech|tafel|ladung|erz)';
const OP = '(?:=(?!=|>)|\\+=|-=|\\*=|\\*\\*=|/=|%=|<<=|>>=|>>>=|&=|\\|=|\\^=|&&=|\\|\\|=|\\?\\?=|\\+\\+|--)';

function ohneKommentare(text) {
  // CRLF (Checkout mit core.autocrlf) zuerst auf LF: '.' trifft kein \r, sonst bliebe jeder //-Kommentar stehen
  return text.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((z) => z.replace(/(^|[^:\\'"`])\/\/.*$/, '$1')).join('\n');
}
const paramNamen = (liste) => liste.split(',').map((p) => p.trim().replace(/^\.\.\./, '').replace(/\s*=[\s\S]*$/, '').trim()).filter((p) => /^[\w$]+$/.test(p));
// Namen, unter denen ein Inventar-Objekt in dieser Datei (code) vorkommt. fremd: Parameternamen aus Funktionen, die irgendwo mit game.inventory aufgerufen werden
function aliase(code, fremd) {
  const namen = new Set(['inventory', ...(fremd || [])]);
  const fn = [];   // Funktionen, die das Inventar zurückgeben (anker.js: inventar(game))
  for (const m of code.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{\s*return\s+[^;]*\binventory\b/g)) fn.push(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*[^;\n]{0,200}?\binventory\b/g)) namen.add(m[1]);                  // const inv = game.inventory || {} / ?? {} / (…)
  for (const m of code.matchAll(/(?<![.\w$])([\w$]+)\s*=(?![=>])\s*[^;\n]{0,200}?\binventory\b/g)) namen.add(m[1]);                        // let inv; inv = game.inventory
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=(?!=)/g)) {                                                                              // const { inventory: inv } = game
    for (const d of m[1].matchAll(/\binventory\b(?:\s*:\s*([\w$]+))?/g)) namen.add(d[1] || 'inventory');
  }
  for (const f of fn) for (const m of code.matchAll(new RegExp('(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*' + f + '\\s*\\(', 'g'))) namen.add(m[1]);
  return [...namen];
}
// [{ fn, i }]: Aufrufe f(…, game.inventory, …) dieser Datei
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'void', 'await', 'new']);
function inventarAufrufe(code) {
  const out = [];
  for (const m of code.matchAll(/([\w$]+)\s*\(([^()]*\binventory\b[^()]*)\)/g)) {
    const args = m[2].split(',');
    if (KEYWORDS.has(m[1])) continue;
    args.forEach((a, i) => { if (/^\s*(?:[\w$]+(?:\([^()]*\))?\.)*inventory\s*$/.test(a)) out.push({ fn: m[1], i }); });   // nur das ganze Inventar als Argument, nicht inventory.marks
  }
  return out;
}
// Definitionen function f(a, b) / f = (a, b) => / Methode f(a, b) { -> Map name -> [Parameterlisten]
function definitionen(code) {
  const map = new Map(); const add = (f, p) => { if (!map.has(f)) map.set(f, []); map.get(f).push(paramNamen(p)); };
  for (const m of code.matchAll(/function\s+([\w$]+)\s*\(([^()]*)\)/g)) add(m[1], m[2]);
  for (const m of code.matchAll(/([\w$]+)\s*[=:]\s*(?:async\s*)?(?:function\s*)?\(([^()]*)\)\s*(?:=>|\{)/g)) add(m[1], m[2]);
  for (const m of code.matchAll(/^\s*(?:async\s+)?([\w$]+)\s*\(([^()]*)\)\s*\{/gm)) if (!KEYWORDS.has(m[1])) add(m[1], m[2]);
  return map;
}
function muster(rec) {
  return [
    new RegExp('\\b' + rec + '\\s*\\)?\\s*(?:\\?\\.|\\.)\\s*' + NAMEN + '\\b\\s*' + OP),                                  // inventory.marks += n, inv.bolzen--, Zeilenumbruch vor .marks
    new RegExp('\\b' + rec + '\\s*(?:\\?\\.)?\\[[^\\]]*\\]\\s*' + OP),                                                      // inventory[k] = v, inv[k]++
    new RegExp('(?:\\+\\+|--)\\s*[\\w$.()]*\\b' + rec + '\\s*(?:\\.\\s*\\w+|\\[[^\\]]*\\])'),                               // ++inventory.x
    /\.inventory\s*=(?!=)/,                                                                                                  // ganzes Objekt ersetzen
    new RegExp('Object\\.(?:assign|defineProperty|defineProperties|setPrototypeOf)\\(\\s*[\\w$.()]*\\b' + rec + '\\s*[,)]'),  // Object.assign(inventory, …)
    new RegExp('Reflect\\.(?:set|defineProperty|deleteProperty)\\(\\s*[\\w$.()]*\\b' + rec + '\\s*[,)]'),                    // Reflect.set(inv, …)
    new RegExp('\\bdelete\\s+[\\w$.()]*\\b' + rec + '\\s*(?:\\.|\\[)'),                                                     // delete inventory.x
  ];
}
// dateien: Map rel -> Text. -> [{ datei, zeile, text }] direkte Schreibzugriffe (ohne die Dienste)
function scanne(dateien) {
  const codes = new Map([...dateien].map(([rel, t]) => [rel, ohneKommentare(t)]));
  const aufrufe = new Map();   // Funktionsname -> Set Parameterindex
  for (const code of codes.values()) for (const a of inventarAufrufe(code)) { if (!aufrufe.has(a.fn)) aufrufe.set(a.fn, new Set()); aufrufe.get(a.fn).add(a.i); }
  const fremd = new Set();
  for (const [rel, code] of codes) for (const [f, listen] of (DIENSTE.includes(rel) ? [] : definitionen(code))) {
    if (!aufrufe.has(f)) continue;
    for (const p of listen) for (const i of aufrufe.get(f)) if (p[i]) fremd.add(p[i]);
  }
  const out = [];
  for (const [rel, code] of codes) {
    if (DIENSTE.includes(rel)) continue;
    const rec = '(?:' + aliase(code, fremd).map((a) => a.replace(/[$]/g, '\\$')).join('|') + ')';
    const zeilen = code.split('\n');
    const starts = []; { let o = 0; for (const z of zeilen) { starts.push(o); o += z.length + 1; } }
    const gefunden = new Set();
    for (const re of muster(rec)) {
      const g = new RegExp(re.source, 'g');
      for (const m of code.matchAll(g)) {
        let z = 0; while (z + 1 < starts.length && starts[z + 1] <= m.index) z++;
        gefunden.add(z);
      }
    }
    for (const z of [...gefunden].sort((a, b) => a - b)) out.push({ datei: rel, zeile: z + 1, text: zeilen[z].trim() });
  }
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

section('Grenze: keine direkten Schreibzugriffe ausserhalb der Dienste (statischer Vorfilter)');
{
  const texte = new Map();
  for (const wurzel of ['server', 'shared']) for (const f of dateien(path.join(ROOT, wurzel))) texte.set(path.relative(ROOT, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8'));
  const gefunden = []; const benutzt = new Set();
  for (const s of scanne(texte)) {
    const e = ERLAUBT.findIndex((x) => x.datei === s.datei && s.text === x.zeile);
    if (e >= 0) benutzt.add(e); else gefunden.push(s.datei + ':' + s.zeile + '  ' + s.text.slice(0, 140));
  }
  ok(texte.size > 50, texte.size + ' Dateien in server/ und shared/ geprüft');
  for (const g of gefunden) console.log('       direkter Schreibzugriff: ' + g);
  ok(gefunden.length === 0, 'keine direkte Schreibstelle ausserhalb von geld.js und vorrat.js (' + gefunden.length + ' gefunden)');
  ERLAUBT.forEach((x, i) => ok(benutzt.has(i), 'Ausnahme kommt noch vor: ' + x.datei + ' „' + x.zeile.slice(0, 60) + '…“ (' + x.grund + ')'));
}

section('Scanner-Selbsttest');
{
  const trifft = (c) => scanne(new Map([['x.js', c]])).length > 0;
  for (const c of [
    'game.inventory.marks += 5;', 'g.inventory.bolzen--;', '--game.inventory.medipack;', 'game.inventory.sonde = 3;', 'game.inventory[k] = v;', 'this.inventory[item]++;',
    'const inv = game.inventory;\ninv.marks -= 1;', 'const inv = g_(m).inventory;\ninv.loeschgel = 0;', 'const inv = game.inventory;\ninv[x]++;',
    'function inventar(game) { return game.inventory || {}; }\nconst i = inventar(game);\ni.ersatzteil -= 1;', 'game.inventory = {};', 'Object.assign(game.inventory, { marks: 1 });',
    'delete game.inventory.flickblech;', 'game.inventory.loeschgelCharges *= 2;',
    // die bekannten Lücken des ersten Scanners
    'const inv = game.inventory || {};\ninv.marks += 1;', 'const inv = game.inventory ?? {};\ninv.bolzen -= 1;', 'const inv = (game.inventory);\ninv.sonde = 0;',
    'const { inventory: inv } = game;\ninv.marks = 5;', 'const { inventory } = game;\ninventory.medipack++;', 'const { a, inventory: lager, b } = game;\nlager.tafel = 1;',
    'let inv;\ninv = game.inventory;\ninv.marks -= 2;', 'function f(lager) { lager.bolzen -= 1; }\nf(game.inventory);', 'const f = (a, lager) => { lager.ersatzteil = 3; };\nf(1, game.inventory);',
    'Reflect.set(game.inventory, "marks", 5);', 'Reflect.set(inv, k, 1);\nconst inv = game.inventory;', 'game.inventory\n  .marks += 1;', 'game.inventory.marks ??= 0;', 'game.inventory.ladung ||= 1;',
    'const inv = game.inventory;\ninv\n  .bolzen = 1;', 'Object.defineProperty(game.inventory, "marks", { value: 1 });', 'game.inventory?.marks && (game.inventory.marks -= 1);', 'game.inventory.tafel = 1;', 'g.inventory.ladung -= 1;',
  ]) ok(trifft(c), 'erkannt: ' + c.replace(/\n/g, ' ').slice(0, 78));
  for (const c of [
    'if (game.inventory.marks >= 5) return;', 'if (inv.marks === 3) {}', 'const x = game.inventory.bolzen - 1;', 'r.sonde = false;', '// game.inventory.marks += 1;',
    '/* game.inventory.bolzen-- */', 'const marks = g.inventory.marks;', 'if (game.inventory.medipack <= 0) return;', 'const f = (o) => o.n;\nf(game.inventory);',
    'const have = game.inventory.bolzen || 0;\nhave++;', 'const t = a.inventory.deko.push(1);', 'const { inventory } = game;\nif (inventory.marks == 3) {}',
  ]) ok(!trifft(c), 'nicht erkannt (Lesen/Kommentar/anderer Schlüssel): ' + c.replace(/\n/g, ' '));
}

section('Kern: je Dienst genau eine schreibende Kernfunktion');
for (const [datei, schreib] of [['server/sim/geld.js', /\.inventory\.marks\s*=(?!=)/g], ['server/sim/vorrat.js', /\.inventory\[[^\]]+\]\s*=(?!=)/g]]) {
  const roh = fs.readFileSync(path.join(ROOT, datei), 'utf8');
  const code = ohneKommentare(roh);
  ok((code.match(schreib) || []).length === 1, datei + ': genau eine Schreibstelle (die Kernfunktion schreiben)');
  ok((code.match(/'stand'/g) || []).length === 2, datei + ': Art "stand" nur in standSetzen (Konstante ARTEN + eine Verwendung), alles andere ist "buchung"');
  ok((roh.match(/TEL-01: hier protokollieren/g) || []).length === 1, datei + ': Protokoll-Haken „TEL-01: hier protokollieren“ genau einmal');
}

// ---- Funktionstests ----
const Geld = require(path.join(ROOT, 'server/sim/geld.js'));
const Vorrat = require(path.join(ROOT, 'server/sim/vorrat.js'));
const Pruefung = require(path.join(ROOT, 'server/sim/buchungspruefung.js'));
const wirft = (f) => { try { f(); return false; } catch (e) { return true; } };
function spiel(inv) {
  const g = { inventory: Object.assign({ marks: 100 }, inv || {}), ereig: [], fehler: [] };
  g.emit = (...a) => g.ereig.push(['emit', ...a]);
  g.missionEvent = (...a) => g.ereig.push(['missionEvent', ...a]);
  g.countError = (where) => g.fehler.push(where);
  return g;
}
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

Geld.strengPruefen();   // die Tests laufen STRENG: unbekannter Grund/Gut/Art ist ein Programmierfehler und wirft (im Spiel wird er nur gezählt, siehe Abschnitt „unbekannte Eingaben“)
ok(Pruefung.istStreng(), 'strenger Modus ist an');

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
    'STRENG: unbekannter oder fehlender Grund wirft (Programmierfehler im Test)');
  ok(wirft(() => Geld.abbuchen(g, 99999, 'gibtsnicht')) && wirft(() => Geld.bezahlen(g, 99999, 'gibtsnicht')) && wirft(() => Geld.gutschreiben(g, 0, 'gibtsnicht')), 'STRENG: auch auf den Wegen, die nichts buchen (zu wenig, n = 0)');
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
  g.inventory.marks = 10;
  ok(Geld.abziehenGeprueft(g, 4, 'info') === 6 && g.inventory.marks === 6, 'abziehenGeprueft: zieht bedingungslos ab (Wächter beim Aufrufer)');
  g.inventory.marks = 2;
  ok(Geld.abziehenGeprueft(g, 5, 'info') === -3, 'abziehenGeprueft ohne Clamping: wie das alte `marks -= preis`');
  ok(g.ereig.length === 0, 'keine einzige stille Variante hat emit oder missionEvent gesendet (' + g.ereig.length + ' Ereignisse)');
}

section('Geld: standSetzen ist keine Buchung');
{
  const g = spiel();
  ok(Geld.standSetzen(g, 777, 'laden') === 777 && g.inventory.marks === 777 && g.ereig.length === 0, 'standSetzen setzt den Stand ohne Ereignis');
  ok(Geld.stand(g) === 777 && Geld.mindestens(g, 777) && !Geld.mindestens(g, 778), 'stand / mindestens lesen');
  ok(['start', 'testmarken', 'debug', 'laden'].every((x) => Geld.GRUENDE.includes(x)), 'Gründe für Stand: start, testmarken, debug, laden');
}

section('Vorrat: entnehmen / verbrauchen / einlagern / leeren / abziehenHoechstens / standSetzen');
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
  ok(Vorrat.einlagernBis(g, 'ladung', 5, 99, 'mission') === 5 && Vorrat.einlagernBis(g, 'ladung', 200, 99, 'mission') === 99 && Vorrat.einlagernBis(g, 'ladung', -500, 99, 'mission') === 0, 'einlagernBis: Obergrenze 99, nie unter 0 (wie ladung_geben)');
  ok(Vorrat.kappen(g, 'flickblech', 4, 'migration') === 5 && g.inventory.flickblech === 4, 'kappen: setzt auf die Obergrenze, gibt das Weggenommene zurück');
  ok(g.inventory.marks === 100, 'Marken blieben unberührt');
  ok(wirft(() => Vorrat.einlagern(g, 'bolzen', 1, 'gibtsnicht')) && wirft(() => Vorrat.entnehmen(g, 'bolzen', 1)) && wirft(() => Vorrat.standSetzen(g, 'bolzen', 1, 'gibtsnicht')), 'STRENG: unbekannter oder fehlender Grund wirft');
  ok(wirft(() => Vorrat.leeren(g, 'gibtsnicht', 'regal')) && wirft(() => Vorrat.einlagern(g, 'deko', 1, 'kauf')) && wirft(() => Vorrat.standSetzen(g, 'datenkern', 1, 'debug')), 'STRENG: ein Gut ausserhalb GUETER wirft (auch deko)');
  ok(wirft(() => Vorrat.einlagernBis(g, 'bolzen', 1, 5, 'gibtsnicht')) && wirft(() => Vorrat.verbrauchen(g, 'bolzen', 1, 'gibtsnicht')) && wirft(() => Vorrat.kappen(g, 'bolzen', 1, 'gibtsnicht')), 'STRENG: Grund-Prüfung auch in verbrauchen, einlagernBis, kappen');
  ok(Vorrat.GUETER.length === 11 && ['bolzen', 'sonde', 'medipack', 'loeschgel', 'loeschgelCharges', 'medipackCharges', 'ersatzteil', 'flickblech', 'tafel', 'ladung', 'erz'].every((x) => Vorrat.GUETER.includes(x)), 'Güter: die acht Verbrauchsgüter (mit medipackCharges, ITM-01) plus die Zähler tafel und ladung, plus das Material erz (GEL-03 B)');
}

section('Vorrat: marks wird an geld.js weitergeleitet (Ergebnis wie früher)');
{
  Pruefung.strengPruefen(false);
  const g = spiel();
  const geldAufrufe = []; const orig = {};
  for (const f of ['abziehenHoechstens', 'abziehenGeprueft', 'einnehmen', 'standSetzen']) { orig[f] = Geld[f]; Geld[f] = (...a) => { geldAufrufe.push(f); return orig[f](...a); }; }
  try {
    Vorrat.abziehenHoechstens(g, 'marks', 1, 'mission'); Vorrat.einlagern(g, 'marks', 1, 'belohnung'); Vorrat.standSetzen(g, 'marks', 100, 'debug');
    Vorrat.entnehmen(g, 'marks', 1, 'mission'); Vorrat.verbrauchen(g, 'marks', 1, 'mission'); g.inventory.marks = 100;
  } finally { for (const f of Object.keys(orig)) Geld[f] = orig[f]; }
  ok(gleich(geldAufrufe, ['abziehenHoechstens', 'einnehmen', 'standSetzen', 'abziehenHoechstens', 'abziehenGeprueft']), 'jeder Weg mit Gut "marks" läuft durch die Kernfunktion von geld.js (' + geldAufrufe.join(', ') + ')');
  g.fehler.length = 0;
  ok(Vorrat.abziehenHoechstens(g, 'marks', 30, 'mission') === 30 && g.inventory.marks === 70, 'abziehenHoechstens(marks) über Geld');
  ok(Vorrat.abziehenHoechstens(g, 'marks', 500, 'mission') === 70 && g.inventory.marks === 0, 'abziehenHoechstens(marks) mit Clamping auf 0');
  ok(Vorrat.einlagern(g, 'marks', 5, 'belohnung') === 5 && g.inventory.marks === 5, 'einlagern(marks) über Geld');
  ok(Vorrat.standSetzen(g, 'marks', 42, 'debug') === 42 && g.inventory.marks === 42 && g.ereig.length === 0, 'standSetzen(marks) über Geld, ohne Ereignis');
  ok(Vorrat.entnehmen(g, 'marks', 2, 'mission') && g.inventory.marks === 40 && !Vorrat.entnehmen(g, 'marks', 99, 'mission') && g.inventory.marks === 40, 'entnehmen(marks) über Geld');
  ok(g.fehler.length >= 5 && g.fehler.every((w) => w === 'buchung-gut'), 'jeder dieser Wege zählt einen Fehler (buchung-gut): ' + g.fehler.length);
  Pruefung.strengPruefen();
}

section('Spielverhalten: unbekannte Eingaben werfen im Spiel nie, buchen wie vor dem Umbau und zählen einen Fehler');
{
  Pruefung.strengPruefen(false);   // so läuft das Spiel
  const g = spiel({ bolzen: 4 });
  g.inventory.marks = 100;
  ok(Geld.gutschreiben(g, 5, 'gibtsnicht') === 105 && g.inventory.marks === 105 && gleich(g.ereig[1], ['missionEvent', 'marksCredited', { n: 5, grund: 'gibtsnicht', marks: 105 }]) && g.fehler.length === 1 && g.fehler[0] === 'buchung-grund',
    'gutschreiben mit unbekanntem Grund: gebucht, Ereignis wie früher (Grund im Ereignis), Fehler "buchung-grund" gezählt');
  g.ereig.length = 0;
  ok(Geld.gutschreiben(g, 5) === 110 && g.ereig[1][2].grund === null, 'gutschreiben ohne Grund: Ereignis-Grund null wie früher');
  g.ereig.length = 0;
  ok(Geld.abbuchen(g, 10, undefined) && g.inventory.marks === 100 && g.ereig[0][2].grund === null, 'abbuchen ohne Grund: Ereignis-Grund null wie früher');
  ok(Geld.einnehmen(g, 1, 'x') === 101 && Geld.erstatten(g, 1, 'x') === 102 && Geld.bezahlen(g, 2, 'x') && Geld.abziehenHoechstens(g, 2, 'x') === 2 && Geld.standSetzen(g, 9, 'x') === 9 && g.inventory.marks === 9,
    'stille Varianten und standSetzen mit unbekanntem Grund buchen weiter');
  g.fehler.length = 0;
  ok(Geld.abbuchen(g, 500, 'x') === false && Geld.bezahlen(g, 500, 'x') === false && g.fehler.length === 2 && g.inventory.marks === 9, 'auch der Weg „zu wenig“ zählt den Fehler und bucht nichts');
  g.fehler.length = 0;
  ok(Vorrat.einlagern(g, 'datenkern', 2, 'kauf') === 2 && g.inventory.datenkern === 2 && g.fehler.length === 1 && g.fehler[0] === 'buchung-gut', 'unbekanntes Gut: gebucht wie früher (inventory[k] = (inventory[k] || 0) + n), Fehler "buchung-gut" gezählt');
  ok(Vorrat.einlagern(g, 'bolzen', 1, 'gibtsnicht') === 5 && g.fehler[g.fehler.length - 1] === 'buchung-grund', 'unbekannter Grund im Vorrat: gebucht, "buchung-grund" gezählt');
  Pruefung.strengPruefen();
}

// ---- Echtes Spiel (Testgelände): Aufrufstellen, Regiebuch, Weltstand ----
const CONFIG = require(path.join(ROOT, 'shared/config.js'));
const { Game } = require(path.join(ROOT, 'server/game.js'));
const Registry = require(path.join(ROOT, 'server/mission/registry.js'));
const Space = require(path.join(ROOT, 'server/sim/space.js'));
const Waffen = require(path.join(ROOT, 'server/sim/schiffswaffen.js'));
const Weltstand = require(path.join(ROOT, 'server/weltstand.js'));
const Sonden = require(path.join(ROOT, 'server/sim/sonden.js'));
const Combat = require(path.join(ROOT, 'server/sim/combat.js'));
const Kampagnegeld = require(path.join(ROOT, 'server/sim/kampagnegeld.js'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-buchungen-'));
function echtesSpiel() {
  const g = new Game({ noStore: true, worlds: false, worldSaveSync: true, worldDir: path.join(TMP, 'w'), seed: 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'B0', name: 'Buchung0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  g.errorLog = {}; g.errors = 0;
  g.errorLog = new Proxy({}, { get: () => Infinity });   // countError soll in der Testausgabe nicht warnen (letzte Warnung "gerade eben")
  g.ereig = [];
  const emit0 = g.emit.bind(g); g.emit = (k, d) => { g.ereig.push(['emit', k, d]); return emit0(k, d); };
  const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { g.ereig.push(['missionEvent', k, d]); return me0(k, d); };
  return g;
}

section('Anlage: der Startstand läuft durch die Kernfunktionen (Art stand, Grund start), Werte unverändert');
{
  const gesehen = [];
  const g0 = Geld.standSetzen, v0 = Vorrat.standSetzen;
  Geld.standSetzen = (game, wert, grund) => { gesehen.push(['marks', wert, grund]); return g0(game, wert, grund); };
  Vorrat.standSetzen = (game, gut, wert, grund) => { gesehen.push([gut, wert, grund]); return v0(game, gut, wert, grund); };
  let g;
  try { g = echtesSpiel(); } finally { Geld.standSetzen = g0; Vorrat.standSetzen = v0; }
  const start = gesehen.filter((x) => x[2] === 'start');
  const inv0 = Object.assign({ loeschgelCharges: 0, marks: CONFIG.economy.startMarks, deko: [], tafel: 0 }, JSON.parse(JSON.stringify(CONFIG.economy.startInventory)));
  ok(start.some((x) => x[0] === 'marks'), 'Marken: Startstand über Geld.standSetzen (Grund start)');
  const gueter = Vorrat.GUETER.filter((k) => k in inv0);
  ok(gueter.length >= 5 && gueter.every((k) => start.some((x) => x[0] === k && x[1] === inv0[k])), 'jedes Startgut (' + gueter.join(', ') + ') über Vorrat.standSetzen (Grund start) mit dem Startwert');
  ok(g.inventory.deko !== undefined && JSON.stringify(inv0.deko) === '[]', 'die Anlage legt das Inventar wie zuvor an (deko bleibt eine Liste)');
}

section('Spielverhalten: Fehler-Eingaben im echten Spiel (Regiebuch, Debug, Lager, Kampagnengeld, Weltstand) – nie ein Wurf, Ergebnis wie f2daff7');
{
  Pruefung.strengPruefen(false);
  const g = echtesSpiel();
  const m = { game: g };
  const frisch = () => { g.errors = 0; g.ereig.length = 0; };
  // 1. remove_item { item: 'marks' }: alt `inv.marks = Math.max(0, have - (n != null ? n : have))` -> 0
  g.inventory.marks = 50; frisch();
  let geworfen = false; try { Registry.get('remove_item').run(m, { item: 'marks' }); } catch (e) { geworfen = true; }
  ok(!geworfen && g.inventory.marks === 0 && g.errors === 1, 'remove_item {item:"marks"}: kein Wurf, Marken 0 wie früher, ein Fehler gezählt (' + g.errors + ')');
  g.inventory.marks = 50; frisch();
  Registry.get('remove_item').run(m, { item: 'marks', n: 20 });
  ok(g.inventory.marks === 30 && g.errors === 1, 'remove_item {item:"marks", n:20}: 30');
  // 2. debug_item_aboard { item: 'marks' }: alt `inventory[item] = Math.max(1, inventory[item] || 0)`
  g.inventory.marks = 0; frisch();
  geworfen = false; try { Registry.get('debug_item_aboard').run(m, { item: 'marks' }); } catch (e) { geworfen = true; }
  ok(!geworfen && g.inventory.marks === 1 && g.errors === 1, 'debug_item_aboard {item:"marks"}: kein Wurf, Marken = max(1, Marken) wie früher, ein Fehler gezählt');
  g.inventory.marks = 9; Registry.get('debug_item_aboard').run(m, { item: 'marks' });
  ok(g.inventory.marks === 9, 'debug_item_aboard {item:"marks"} bei 9 Marken: bleibt 9');
  // 3. ensureItem (debug_recall_all): alt `if (!(inventory[x] >= 1)) inventory[x] = 1`
  g.inventory.marks = 0; frisch();
  geworfen = false; try { Registry.get('debug_recall_all').run(m, { map: 'platform', ensureItem: 'marks' }); } catch (e) { geworfen = true; }
  ok(!geworfen && g.inventory.marks === 1 && g.errors === 1, 'debug_recall_all {ensureItem:"marks"}: kein Wurf, Marken 1 wie früher, ein Fehler gezählt');
  // 4. lagerGutschrift(g, 'marks', 5): alt `inventory.marks = (inventory.marks || 0) + 5`
  g.inventory.marks = 10; frisch();
  geworfen = false; let r; try { r = Waffen.lagerGutschrift(g, 'marks', 5); } catch (e) { geworfen = true; }
  ok(!geworfen && r === 5 && g.inventory.marks === 15 && g.errors === 1 && g.ereig.length === 0, 'lagerGutschrift(g, "marks", 5): kein Wurf, Marken +5, kein Ereignis, ein Fehler gezählt');
  // 5. kampagnegeld.zahlen mit unbekanntem Posten: alt abbuchen(0, posten) -> true, nichts gebucht, kein Ereignis
  g.inventory.marks = 20; frisch();
  geworfen = false; try { r = Kampagnegeld.zahlen(g, 'bestechung'); } catch (e) { geworfen = true; }
  ok(!geworfen && r === true && g.inventory.marks === 20 && g.errors === 1 && g.ereig.length === 0, 'kampagnegeld.zahlen(g, "bestechung"): kein Wurf, true, nichts gebucht, ein Fehler gezählt');
  ok(Kampagnegeld.POSTEN.every((p) => Geld.GRUENDE.includes(p)), 'kampagnegeld.POSTEN ⊂ Geld.GRUENDE (' + Kampagnegeld.POSTEN.join(', ') + ')');
  // 6. Weltstand laden mit schiff.lager.marks (und anderen unbekannten Schlüsseln): alt `if (Number.isFinite(v)) inventory[k] = v`
  const cap = Weltstand.capture(g);
  cap.schiff = Object.assign({}, cap.schiff, { marken: 10, lager: { marks: 77, bolzen: 3, merkwuerdig: 4 } });
  frisch();
  geworfen = false; try { Weltstand.apply(g, cap); } catch (e) { geworfen = true; console.log('       ' + e.message); }
  ok(!geworfen && g.inventory.marks === 77 && g.inventory.bolzen === 3 && g.inventory.merkwuerdig === 4, 'Weltstand.apply mit schiff.lager.marks: lädt (kein Wurf), Marken 77, bolzen 3, unbekannter Schlüssel wie früher gesetzt');
  ok(g.errors >= 2, 'Weltstand.apply: unbekannte Schlüssel gezählt, nicht geworfen (' + g.errors + ')');
  Pruefung.strengPruefen();
  // STRENG schlägt dieselbe Eingabe an (der Test sieht den Programmierfehler)
  g.inventory.marks = 50;
  ok(wirft(() => Registry.get('remove_item').run(m, { item: 'marks' })), 'STRENG: remove_item "marks" wirft (der Test sieht den Programmierfehler)');
  ok(wirft(() => Waffen.lagerGutschrift(g, 'frei_erfunden', 1)), 'STRENG: lagerGutschrift mit unbekanntem Gut wirft');
  ok(wirft(() => Kampagnegeld.zahlen(g, 'bestechung')), 'STRENG: kampagnegeld.zahlen mit unbekanntem Posten wirft');
}

section('Spielverhalten: Bruchteil-Bestände rechnen wie vor dem Umbau');
{
  Pruefung.strengPruefen();
  // alte Stellen: nach eigenem Wächter (> 0) unbedingt `x--` bzw. `floor(max(0, x)) - 1`
  for (const b of [0.5, 1.5, 3, 2.25]) {
    const g = spiel({ medipack: b, loeschgel: b, bolzen: b, ersatzteil: b, ladung: b });
    for (const gut of ['medipack', 'loeschgel', 'bolzen', 'ersatzteil', 'ladung']) {
      const alt = b - 1;
      const r = Vorrat.verbrauchen(g, gut, 1, gut === 'bolzen' ? 'torpedo' : gut === 'ladung' ? 'sprengung' : 'regal');
      ok(r === alt && g.inventory[gut] === alt, 'verbrauchen(' + gut + ') bei ' + b + ' = ' + alt + ' (wie das alte `inventory.x--` nach dem Wächter)');
    }
  }
  const g2 = spiel({ medipack: 0.5 });
  ok(Vorrat.entnehmen(g2, 'medipack', 1, 'nachschub') === false && g2.inventory.medipack === 0.5, 'Gegenprobe: entnehmen (mit Prüfung) lässt 0,5 stehen – deshalb nehmen die alten Wächter-Stellen verbrauchen');
  for (const [b, alt] of [[1.5, 0], [2.7, 1], [1, 0], [-3, -1], [0.5, -1], [0, -1]]) {
    const g = spiel({ sonde: b });
    Vorrat.verbrauchenGanzzahlig(g, 'sonde', 1, 'sonde');
    ok(g.inventory.sonde === alt, 'verbrauchenGanzzahlig(sonde) bei ' + b + ' = ' + alt + ' (wie das alte floor(max(0, sonde)) - 1)');
  }
  // an den echten Stellen
  const g = echtesSpiel();
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2;
  for (const [b, alt] of [[1.5, 0], [2.7, 1]]) {
    g.inventory.sonde = b; g.sonden = [];
    const f = Sonden.starteInSzene(g, null, { x: sh.x + 400, y: sh.y });
    ok(f === null && g.inventory.sonde === alt && g.sonden.length === 1, 'Sonden.starteInSzene bei sonde ' + b + ': ' + alt + ' (Fehler: ' + f + ')');
  }
  const p = g.players[0];
  g.inventory.medipack = 0.5;
  Combat.onArrive(g, p);
  ok(g.inventory.medipack === -0.5 && p.medkit === CONFIG.medipack.ladungen, 'combat.onArrive bei medipack 0,5: -0,5 und ein Medipack (alle Ladungen) am Mann (wie früher)');
  g.inventory.medipack = 1.5; p.medkit = 0;
  Combat.onArrive(g, p);
  ok(g.inventory.medipack === 0.5 && p.medkit === CONFIG.medipack.ladungen, 'combat.onArrive bei medipack 1,5: 0,5');
}

section('Aufrufstellen mit echtem Spiel: Betrag und Ereignisse wie bisher');
{
  Pruefung.strengPruefen();
  const g = echtesSpiel();
  const kind = Object.keys(g.C.enemies).find((k) => g.C.enemies[k].salvage > 0 && k !== 'relay');
  g.inventory.marks = 200; g.ereig.length = 0;
  const e = Space.spawnEnemy(g, kind, { x: g.ship.x + 300, y: g.ship.y });
  g.ereig.length = 0;
  Space.enemyDown(g, e);
  ok(g.inventory.marks === 200 + g.C.enemies[kind].salvage, 'Abschuss-Beute: genau C.enemies[' + kind + '].salvage (' + g.C.enemies[kind].salvage + ') Marken');
  ok(!g.ereig.some((x) => x[1] === 'marksCredited' || x[1] === 'marksPaid'), 'Abschuss-Beute: kein marksCredited/marksPaid (stille Variante)');
  g.inventory.marks = 500; g.ereig.length = 0;
  Space.verlustAusloesen(g, 'test');
  ok(g.inventory.marks === Math.max(0, 500 - g.C.emergency.marksCost), 'Notfallprotokoll: Kosten C.emergency.marksCost (' + g.C.emergency.marksCost + ') abgezogen');
  ok(!g.ereig.some((x) => x[1] === 'marksPaid'), 'Notfallprotokoll: kein marksPaid');
  g.inventory.marks = 3; Space.verlustAusloesen(g, 'test');
  ok(g.inventory.marks === 0, 'Notfallprotokoll bei wenig Marken: Clamping auf 0');
  // Bergung
  const sp = g.space; g.inventory.marks = 10; g.inventory.ersatzteil = 0; g.ereig.length = 0;
  sp.salvage = [{ id: 'svA', x: g.ship.x, y: g.ship.y, kind: 'marks' }, { id: 'svB', x: g.ship.x, y: g.ship.y, kind: 'ersatzteil' }];
  g.step();
  ok(g.inventory.marks === 10 + g.C.salvage.marks && g.inventory.ersatzteil === 1, 'Bergung: C.salvage.marks Marken und ein Ersatzteil (' + g.inventory.marks + ', ' + g.inventory.ersatzteil + ')');
  ok(!g.ereig.some((x) => x[1] === 'marksCredited'), 'Bergung: kein marksCredited');
  ok(g.errors === 0, 'keiner dieser Wege hat einen Buchungsfehler gezählt (' + g.errors + ')');
}

section('Aufrufstellen von geld.js (Tabelle): jede Änderung an Stellen mit Ereignis ist eine bewusste Entscheidung');
{
  // Stellen MIT Ereignis (sfx/missionEvent; das Regiebuch reagiert darauf): gutschreiben, gutschreibenSkript, abbuchen, bestechungZahlen (BEA-01 A). Alles andere ist still. Neue Stelle oder anderer Typ = hier eintragen.
  const SOLL = {
    'server/mission/registry.js': { gutschreibenSkript: 1, abziehenHoechstens: 1, mindestens: 1 },
    'server/mission/kampagne.js': { standSetzen: 1 },
    'server/game.js': { standSetzen: 4 },
    'server/sim/entern.js': { einnehmen: 1 },
    'server/sim/explore.js': { einnehmen: 2 },
    'server/sim/faden-forderung.js': { mindestens: 1, bestechungZahlen: 1 },   // BEA-01 A: Bestechung im Geschichtsfaden (mit Ereignis marksPaid, Grund bestechungsgeld)
    'server/sim/handel-info.js': { abziehenGeprueft: 1 },
    'server/sim/kampagnegeld.js': { mindestens: 1, abbuchen: 1 },
    'server/sim/ladung.js': { gutschreiben: 1 },
    'server/sim/mission.js': { standSetzen: 1 },
    'server/sim/notrufe.js': { gutschreiben: 2 },
    'server/sim/schiffswaffen.js': { einnehmen: 1 },
    'server/sim/shop.js': { bezahlen: 1 },
    'server/sim/space.js': { einnehmen: 2, abziehenHoechstens: 1 },
    'server/sim/uebung-forschung.js': { standSetzen: 1 },   // TEL-01 M2: Startmarken der Übung (UEB-01), Grund start
    'server/sim/werft.js': { mindestens: 1, abbuchen: 1 },
    'server/weltstand.js': { erstatten: 4, standSetzen: 1 },
  };
  const FN = ['stand', 'mindestens', 'gutschreiben', 'gutschreibenSkript', 'abbuchen', 'bestechungZahlen', 'einnehmen', 'erstatten', 'bezahlen', 'abziehenGeprueft', 'abziehenHoechstens', 'standSetzen'];
  const ist = {};
  for (const wurzel of ['server', 'shared']) for (const f of dateien(path.join(ROOT, wurzel))) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (DIENSTE.includes(rel)) continue;
    const code = ohneKommentare(fs.readFileSync(f, 'utf8'));
    for (const m of code.matchAll(/\b(?:Geld|lazyMarken\(\)|Marken)\s*\.\s*([A-Za-z]+)\s*\(/g)) {
      if (!FN.includes(m[1]) || m[1] === 'stand') continue;
      if (rel.endsWith('/ladung.js') === false && m[0].startsWith('Marken')) continue;   // Marken = geld.js nur in ladung.js, sonst die Hex-Marken (sim/marken.js)
      (ist[rel] = ist[rel] || {})[m[1]] = ((ist[rel] || {})[m[1]] || 0) + 1;
    }
  }
  const abweich = [];
  for (const k of new Set([...Object.keys(SOLL), ...Object.keys(ist)])) if (JSON.stringify(Object.entries(ist[k] || {}).sort()) !== JSON.stringify(Object.entries(SOLL[k] || {}).sort())) abweich.push(k + ': ist ' + JSON.stringify(ist[k] || {}) + ' soll ' + JSON.stringify(SOLL[k] || {}));
  for (const a of abweich) console.log('       Abweichung: ' + a);
  ok(abweich.length === 0, 'Aufrufe von geld.js je Datei und Funktion wie in der Tabelle (' + Object.keys(SOLL).length + ' Dateien, ' + abweich.length + ' Abweichungen)');
}

// ---- Laufzeitprobe ----
const PROBE = process.env.BUCHUNGEN_PROBE || 'alle';
if (PROBE !== 'aus') {
  section('Laufzeitprobe: game.inventory als Proxy, kein Schreibzugriff ausser über geld.js / vorrat.js');
  const probeDatei = path.join(ROOT, 'tools', 'buchungen-probe.js');
  const ARENA = ['tools/sim-headless.js', 'arena', '--seeds', '1', '--waves', '2', '--max', '200'];
  const LAEUFE = [
    ['Arena (sim-headless)', ARENA],
    ['Wellen am Boden (sim-headless)', ['tools/sim-headless.js', 'wellen', '--karte', 'aussenposten', '--players', '1', '--seeds', '1', '--max', '150']],
    ['Graben (sim-headless)', ['tools/sim-headless.js', 'graben', '--players', '1', '--seeds', '1', '--max', '150']],
    ['Shop und Werft (test-werft)', ['tools/test-werft.js']],
    ['Weltstand laden/speichern (test-weltstand)', ['tools/test-weltstand.js']],
    ['Regiebuch-Bausteine (test-regiebuch)', ['tools/test-regiebuch.js']],
    ['Bausteine (test-bausteine)', ['tools/test-bausteine.js']],
    ['Handelsinfo (test-handel-info)', ['tools/test-handel-info.js']],
    ['Lager, Ladung, Weltstand (test-lager)', ['tools/test-lager.js']],
    ['Posten (test-posten)', ['tools/test-posten.js']],
    ['Sonden (test-sonden)', ['tools/test-sonden.js']],
    ['Schiffswaffen, Torpedo-Lager (test-waffen-schiff)', ['tools/test-waffen-schiff.js']],
    ['Entern (test-entern)', ['tools/test-entern.js']],
  ].filter(([, a]) => PROBE === 'alle' || (PROBE === 'arena' && a === ARENA) || (PROBE === 'schnell' && a[0] === 'tools/test-entern.js'));
  for (const [name, args] of LAEUFE) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['-r', probeDatei, ...args], { cwd: ROOT, env: Object.assign({}, process.env, { BUCHUNGEN_ROOT: ROOT, BUCHUNGEN_STRENG: '' }), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    const m = /\[buchungen-probe\] (\d+) Schreibzugriffe geprüft, (\d+) Verstöße/.exec(out);
    const verstoss = out.split('\n').filter((z) => /^\s*Verstoß:/.test(z));
    for (const z of verstoss.slice(0, 5)) console.log('       ' + z.trim());
    ok(!!m && Number(m[1]) > 0 && Number(m[2]) === 0 && r.status === 0, name + ': ' + (m ? m[1] + ' Schreibzugriffe über die Dienste, ' + m[2] + ' Verstöße' : 'KEINE Probe-Ausgabe') + ', Exit ' + r.status + ' (' + Math.round((Date.now() - t0) / 100) / 10 + ' s)');
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log('\n' + (n - fails) + '/' + n + ' ok');
process.exit(fails ? 1 : 0);
