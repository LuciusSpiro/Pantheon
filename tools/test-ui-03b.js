'use strict';
// SUND-03b UI (Designer-Review): Geometrie der Funk-Antwortleiste und des Hafenterminals (Bereichsknöpfe, Infozeile) ohne Browser.
//   Funkwahl.rechteck(m, S) gegen die Layouts der Konsolen (S = Oberkante der Statusleiste aus pult-stationen.js und pult-terminal-tokens.js): die Leiste liegt auf dem Schirm, über der Statusleiste,
//   und überdeckt nie einen Knopf des Pults · Pult.statusOben meldet nur das Pult, das gerade gezeichnet wurde · Bereichsknöpfe des Terminals liegen rechts der Modulraum-Spalte ohne Überschneidung
//   node tools/test-ui-03b.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const J = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const schneiden = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const VW = 640;

// ---------------------------------------------------------------- Terminal-Layout (echte pult-terminal-tokens.js mit Attrappen)
const same = (a) => a;
const win = { Render: { measure: (s) => String(s).length * 6, wrap: (s) => [s], text() {} }, Shared_Protocol: {}, performance };
win.window = win;
win.Pult = { FN: new Proxy({}, { get: () => '#000000' }), SKINS: { rom: { screenBg: '#000000', bg: '#000000', text: '#ffffff', dim: '#888888', ink: '#000000', off: '#000000', offLine: '#000000', frame: '#000000' } }, mix: same, rgba: same, cham() {}, knopf() {}, zelle() {}, titel() {} };
vm.createContext(win);
vm.runInContext(J('pult-terminal-tokens.js'), win, { filename: 'pult-terminal-tokens.js' });
const PT = win.PultTerminal;
const L = PT.layout(640, 360);
const S_TERMINAL = PT.TOKENS.S;

// S je Konsole direkt aus den Pult-Layouts (rahmen(... S: n ...))
const stationen = {};
for (const m of J('pult-stationen.js').matchAll(/titel: '(\w+)', S: (\d+)/g)) stationen[m[1] + m[2]] = { name: m[1], S: +m[2] };
const konsolen = Object.values(stationen).concat([{ name: 'TERMINAL', S: S_TERMINAL }]);

// ---------------------------------------------------------------- Funkwahl (echtes funkwahl.js)
const FW = require('../public/js/funkwahl.js');
const block = (k) => ({ nr: 5, von: 'Römische Streife', optionen: ['Lage an den Hafen melden.', 'Händlerfunk informieren.', 'Verstanden, weiter auf Kurs.'].slice(0, k).map((t, i) => ({ id: 'o' + i, text: t })), ignorieren: 'Nicht antworten', rest: 2 });

section('Antwortleiste: Lage je Konsole');
ok(konsolen.length >= 6, 'Konsolen aus den Layouts gelesen: ' + konsolen.map((k) => k.name + ' S=' + k.S).join(', '));
for (const k of [2, 3]) {
  FW.lesen({ t: 'snap', phase: 'play', world: { funkwahl: block(k) } });
  const m = FW.modell();
  for (const eing of [false, true]) {
    FW.store.eingeklappt = eing;
    for (const ko of konsolen) {
      const r = FW.rechteck(m, ko.S);
      const schirm = { x: 62, y: 6, w: 572, h: ko.S - 12 };
      const drin = r.x >= schirm.x && r.y >= schirm.y && r.x + r.w <= schirm.x + schirm.w && r.y + r.h <= schirm.y + schirm.h;
      ok(drin, k + ' Optionen' + (eing ? ' (Streifen)' : '') + ' ' + ko.name + ' S=' + ko.S + ': Leiste ' + r.x + ',' + r.y + ' ' + r.w + 'x' + r.h + ' liegt auf dem Schirm');
      ok(r.y + r.h <= ko.S - 6 && r.x + r.w <= 634 - 6, '   ... über der Statusleiste (Unterkante ' + (r.y + r.h) + ' <= ' + (ko.S - 6) + '), rechts mit Abstand');
      ok(!schneiden(r, { x: 0, y: ko.S, w: VW, h: 360 - ko.S }), '   ... überdeckt nichts unterhalb der Statusleiste (Pult, Knöpfe, Säule)');
    }
  }
  FW.store.eingeklappt = false;
}
section('Antwortleiste: Terminal, Knopfzonen des Pults');
{
  FW.lesen({ t: 'snap', phase: 'play', world: { funkwahl: block(3) } });
  const r = FW.rechteck(FW.modell(), S_TERMINAL);
  const zonen = [L.status, L.start, L.energie].concat(Object.values(L.kreuz), Object.values(L.module), Object.values(L.aktionen), [L.kreuzTitel, L.modulTitel]);
  ok(zonen.every((z) => !schneiden(r, z)), 'drei Optionen am Terminal: keine Zone des Pults (Kreuz, Module, Aktionen, Status) überdeckt');
}
section('Antwortleiste: Bord ohne Konsole');
{
  FW.lesen({ t: 'snap', phase: 'play', world: { funkwahl: block(2) } });
  const r = FW.rechteck(FW.modell(), null);
  ok(r.x === Math.round((VW - FW.BREITE) / 2) && r.y + r.h < 360, 'ohne Pult unten mittig: ' + r.x + ',' + r.y);
  ok(FW.statusOben({}) === null, 'ohne Pult.statusOben: null');
}

// ---------------------------------------------------------------- Pult.statusOben (echte pult.js)
section('Pult.statusOben meldet nur das gezeichnete Pult');
{
  let t = 1000;
  const ctx = new Proxy({}, { get: (o, k) => (typeof o[k] !== 'undefined' ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const w2 = { Render: { PAL: {}, text() {}, measure: (s) => String(s).length * 6, ui: { buttons: [], mouse: {} } }, Shared_Config: {}, location: { search: '' }, URLSearchParams, performance: { now: () => t } };
  w2.window = w2;
  vm.createContext(w2);
  vm.runInContext(J('pult.js'), w2, { filename: 'pult.js' });
  const P = w2.Pult;
  ok(P.statusOben({}) === null, 'vor dem ersten Zeichnen: null');
  const view = { state: { ship: {} }, send() {}, actions: { leave() {} } };
  P.rahmen(ctx, view, { titel: 'STEUER', S: 200, station: 'helm' });
  ok(P.statusOben(view) === 200, 'nach rahmen(S: 200): 200');
  t += 40; ok(P.statusOben(view) === 200, 'wenige Bilder später: noch 200');
  t += 500; ok(P.statusOben(view) === null, 'Konsole verlassen (kein Pult mehr gezeichnet): wieder null');
  ok(typeof P.kappe === 'function' && P.kappe('X', null) === 'X', 'Pult.kappe: Ersatzbeschriftung ohne Tasten.js');
}

// ---------------------------------------------------------------- Bereichsknöpfe des Terminals
section('Terminal: Bereichsknöpfe rechts der Modulraum-Spalte');
{
  const A = L.aktionen, kn = [A.info, A.lage, A.handel, A.werft];
  const modulRechts = Math.max(...Object.values(L.module).map((z) => z.x + z.w));
  ok(kn.every((b) => b.x > modulRechts), 'alle vier Knöpfe rechts der Modulraum-Spalte (bis ' + modulRechts + '): ' + kn.map((b) => b.x + '+' + b.w).join(' '));
  ok(kn.every((b) => b.x >= 424 && b.x + b.w <= 628), 'alle vier in 424..628');
  let frei = true;
  for (let i = 0; i < kn.length; i++) for (let j = i + 1; j < kn.length; j++) if (schneiden(kn[i], kn[j])) frei = false;
  ok(frei, 'ohne Überschneidung untereinander');
  ok(!kn.some((b) => Object.values(L.module).some((z) => schneiden(b, z))), 'und ohne Überschneidung mit den Modulräumen');
}
section('Terminal: Infozeile Handel im Raster 9 endet vor dem Schirmrand');
{
  const info = L.handelInfo, zl = PT.TOKENS.SCHRIFT.zeile;
  ok(info.y + 2 + 2 * zl + 7 <= S_TERMINAL - 6, 'dritte Zeile endet bei ' + (info.y + 2 + 2 * zl + 7) + ' <= Schirmrand ' + (S_TERMINAL - 6));
}

console.log(`\ntest-ui-03b: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
