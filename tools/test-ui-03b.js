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
      // Nacharbeit SUND-04a-2 (F4): der Streifen (Später) sitzt im Ruf-Slot ganz oben, y 0 bis 11 (über dem Schirmrahmen, die Köpfe beginnen bei y 12); die volle Leiste liegt auf dem Schirm
      const drin = eing ? r.y === 0 && r.y + r.h <= 11 && r.x >= 0 && r.x + r.w <= VW
        : r.x >= schirm.x && r.y >= schirm.y && r.x + r.w <= schirm.x + schirm.w && r.y + r.h <= schirm.y + schirm.h;
      ok(drin, k + ' Optionen' + (eing ? ' (Streifen)' : '') + ' ' + ko.name + ' S=' + ko.S + ': Leiste ' + r.x + ',' + r.y + ' ' + r.w + 'x' + r.h + (eing ? ' liegt im Ruf-Slot oben (y 0 bis 11)' : ' liegt auf dem Schirm'));
      ok(r.y + r.h <= ko.S - 6 && r.x + r.w <= 634 - 6, '   ... über der Statusleiste (Unterkante ' + (r.y + r.h) + ' <= ' + (ko.S - 6) + '), rechts mit Abstand');
      ok(!schneiden(r, { x: 0, y: ko.S, w: VW, h: 360 - ko.S }), '   ... überdeckt nichts unterhalb der Statusleiste (Pult, Knöpfe, Säule)');
    }
  }
  FW.store.eingeklappt = false;
}
// ---------------------------------------------------------------- Bedienflächen je Konsole/Ansicht (gemessen im echten Client: tools/messe-funk-flaechen.js -> tools/fixtures/funk-bedienflaechen.json)
section('Antwortleiste: keine Bedienfläche verdeckt (Leiste im Standardzustand, Streifen, je Konsole und Ansicht)');
{
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'funk-bedienflaechen.json'), 'utf8')).ansichten;
  const namen = Object.keys(F);
  const bedien = FW.BEDIENFLAECHEN;
  const schirmDe = (r, S) => r.x >= 62 && r.y >= 6 && r.x + r.w <= 634 && r.y + r.h <= S - 6;
  const imSlot = (r) => r.y === 0 && r.y + r.h <= 11 && r.x >= 0 && r.x + r.w <= VW;   // F4: der Streifen im Ruf-Slot oben
  for (const st of ['helm', 'weapons', 'technik', 'captain', 'shop']) ok(namen.some((k) => F[k].station === st), 'Messung deckt die Konsole ab: ' + st);
  for (const b of ['werft', 'handel', 'info', 'lage']) ok(namen.includes('terminal-' + b), 'Messung deckt den Terminal-Bereich ab: ' + b);
  ok(namen.some((k) => k.startsWith('technik-1')) && namen.some((k) => k.startsWith('captain-5')), 'Messung deckt Technik-Schadensplan und alle Captain-Reiter ab');
  ok(namen.every((k) => konsolen.some((ko) => ko.S === F[k].S)), 'jede gemessene Statusleiste (S) kommt in den Layouts vor (Messung nicht veraltet): ' + [...new Set(namen.map((k) => F[k].S))].join(', '));
  ok(['technik', 'captain', 'shop'].every((s) => bedien.includes(s)) && !bedien.includes('helm') && !bedien.includes('weapons'), 'Bedienflächen-Konsolen: Technik, Captain, Terminal; Steuer und Ops behalten die volle Leiste (' + bedien.join(', ') + ')');
  let verdeckt = 0;
  for (const nOpt of [2, 3]) {
    FW.lesen({ t: 'snap', phase: 'play', world: { funkwahl: block(nOpt) } });
    const m = FW.modell();
    for (const k of namen) {
      const v = F[k], ko = { S: v.S, station: v.station };
      FW.store.eingeklappt = false; FW.store.geoeffnetBei = null;
      const zugeklappt = FW.zu(ko);
      const r = FW.rechteck(m, ko);
      const hit = v.knoepfe.filter((b) => schneiden(r, b));
      ok(hit.length === 0 && (zugeklappt ? imSlot(r) : schirmDe(r, v.S)), nOpt + ' Optionen, ' + k + ' (' + v.station + '): Standard = ' + (zugeklappt ? 'Streifen' : 'volle Leiste') + ' ' + r.x + ',' + r.y + ' ' + r.w + 'x' + r.h + ', keine Bedienfläche darunter' + (hit.length ? ' (verdeckt: ' + hit.map((b) => b.label).join(', ') + ')' : ''));
      ok(zugeklappt === bedien.includes(v.station), '   ... Streifen genau an den Bedienflächen-Konsolen');
      // aufgeklappt (vom Spieler selbst): darf überdecken, liegt aber auf dem Schirm über der Statusleiste
      FW.store.geoeffnetBei = v.station; FW.store.eingeklappt = false;
      const ra = FW.rechteck(m, ko, false);
      ok(schirmDe(ra, v.S) && ra.y + ra.h <= v.S - 6, '   ... aufgeklappt auf dem Schirm über der Statusleiste');
      verdeckt += v.knoepfe.filter((b) => schneiden(ra, b)).length;
      // die volle Leiste an Konsolen OHNE Streifen-Standard verdeckt nie etwas; an den anderen ist der Streifen nötig
      if (!bedien.includes(v.station)) ok(v.knoepfe.every((b) => !schneiden(ra, b)), '   ... Konsole ohne Bedienflächen unter der Leiste: auch die volle Leiste verdeckt nichts');
    }
  }
  FW.store.geoeffnetBei = null;
  ok(verdeckt > 0, 'Gegenprobe: aufgeklappt verdeckt die Leiste tatsächlich Knöpfe (Technik „+“, Terminal Handel) – der Streifen ist nötig (' + verdeckt + ' Treffer)');
  // der Streifen sitzt immer an derselben Stelle ohne Bedienfläche: Gegenprobe über ALLE Ansichten mit Streifen
  const sr = FW.rechteck(FW.modell(), { S: 258, station: 'captain' });
  ok(namen.every((k) => F[k].knoepfe.every((b) => !schneiden(sr, b))), 'der Streifen im Ruf-Slot oben (' + sr.x + ',' + sr.y + ' ' + sr.w + 'x' + sr.h + ') liegt in KEINER gemessenen Ansicht über einer Bedienfläche (auch nicht in Steuer und Ops, wo „Später“ ihn zeigt)');
}
section('Antwortleiste: Taste, Esc und Später an Konsolen mit Streifen');
{
  FW.lesen({ t: 'snap', phase: 'play', world: { funkwahl: block(3) } });
  const send = [];
  FW.store.konsole = { S: 152, station: 'technik' }; FW.store.markiert = -1;
  ok(FW.zu() === true && FW.rechteck(FW.modell(), FW.store.konsole).h === 11, 'Technik: neues Angebot = Streifen (11 hoch)');
  ok(FW.markieren() === -1 && FW.zu() === false, 'erster Druck auf „.“ klappt nur auf, markiert nichts');
  ok(FW.markieren() === 0 && FW.store.markiert === 0, 'zweiter Druck markiert die erste Option');
  ok(FW.senden((x) => send.push(x)) && send.length === 1 && send[0].id === 'o0', 'Umschalt+Punkt sendet die markierte Option');
  ok(FW.zuklappen() === true && FW.zu() === true, 'Esc klappt die selbst geöffnete Leiste wieder zu (verbraucht die Taste)');
  ok(FW.zuklappen() === false, 'noch einmal Esc: nicht verbraucht (verlässt die Konsole wie bisher)');
  ok(!FW.senden((x) => send.push(x)) && send.length === 1, 'als Streifen sendet Umschalt+Punkt nichts');
  FW.spaeter(false); ok(FW.zu() === false, 'Klick auf den Streifen klappt auf');
  FW.spaeter(true); ok(FW.zu() === true && FW.store.eingeklappt, '„Später“ klappt wieder zu');
  FW.spaeter(false);
  FW.store.konsole = { S: 238, station: 'shop' }; ok(FW.zu() === true, 'an einer anderen Bedienflächen-Konsole (Terminal) wieder Streifen: aufgeklappt gilt nur dort, wo der Spieler es tat');
  FW.store.konsole = { S: 200, station: 'helm' }; ok(FW.zu() === false, 'Steuer: volle Leiste wie bisher');
  ok(FW.zuklappen() === false, 'Steuer: Esc wird nicht verbraucht');
  FW.store.konsole = { S: 200, station: 'helm' }; FW.spaeter(true); ok(FW.zu() === true && FW.rechteck(FW.modell(), FW.store.konsole).y === 0, 'Steuer: „Später“ = Streifen im Ruf-Slot oben (F4: derselbe Slot wie an Technik, Captain und Terminal)');
  FW.lesen({ t: 'snap', phase: 'play', world: { funkwahl: Object.assign(block(3), { nr: 6 }) } });
  FW.store.konsole = { S: 152, station: 'technik' };
  ok(FW.store.geoeffnetBei === null && !FW.store.eingeklappt && FW.zu() === true, 'ein neues Angebot beginnt wieder als Streifen');
  FW.store.konsole = null; FW.store.eingeklappt = false; FW.store.geoeffnetBei = null;
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
