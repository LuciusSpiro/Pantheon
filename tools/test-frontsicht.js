'use strict';
// OPS-01 Nacharbeit (R1/R2): Frontsicht des Steuers (drawFrontView) bleibt bit-gleich. Die Karten-Änderungen von OPS-01 (Label-Entzerrung, Rangfolge, Kurzformen, Sonden-/Spur-/Boje-Labels)
// dürfen im Bild des Steuers nichts verändern. Der Test hängt NICHT an Git: das Aufrufprotokoll (jede Methode mit Argumenten, jede gesetzte Eigenschaft, also Text, Position, Farbe)
// einer Szene mit Station, Wrack/Hohlraum mit Rang-2-Label (Versatz −60..+60), Marker, mehreren Gegnern (eines mit angekündigtem Angriff), Sprungpunkt-Bojen, Sonden und Randpfeilen
// wird mit dem Stand f2daff7 (vor OPS-01) in tools/fixtures/frontsicht-ref.json verglichen (je Fall Anzahl der Aufrufe und SHA-256).
//   (a) alle Fälle: Protokoll der aktuellen Skripte gleich der gespeicherten Referenz
//   (b) Mutation: Rangfolge der Ortslabels der Karte (m.posten ? 1 : 1.5) auch in der Frontsicht -> mindestens ein Fall weicht ab (der Test misst etwas)
//   (c) Mutation: Boje-Winkel mit Kartendrehung auch in der Frontsicht -> Abweichung
//   (d) R.FRONT-Werte, sitz.js ruft drawFrontView unverändert auf
// Referenz erzeugen (einmal, auf dem Stand f2daff7: render.js, starmap.js, sonden.js, spur.js von dort in ein Verzeichnis legen, z. B. mit `git show f2daff7:public/js/render.js > …`):
//   node tools/test-frontsicht.js --ref-schreiben <Verzeichnis mit den vier Dateien>
//   node tools/test-frontsicht.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const REF = path.join(__dirname, 'fixtures', 'frontsicht-ref.json');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');   // Quelldateien sind teils CRLF

// Zeichenfläche: Protokoll aller Aufrufe und Eigenschaftszuweisungen; measureText 5 px je Zeichen
function neueFlaeche(log) {
  const st = { fillStyle: '#000', strokeStyle: '#000', font: '8px monospace', textAlign: 'left' };
  const f = { measureText: (s) => ({ width: String(s).length * 5 }), createLinearGradient: () => ({ addColorStop(a, b) { log.push('grad:' + a + b); } }), createRadialGradient: () => ({ addColorStop(a, b) { log.push('grad:' + a + b); } }) };
  const fmt = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : typeof v === 'object' ? '[o]' : v);
  return new Proxy(f, {
    get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? (...a) => { log.push(k + ':' + JSON.stringify(a.map(fmt))); } : undefined),
    set: (t, k, v) => { st[k] = v; log.push('=' + String(k) + ':' + JSON.stringify(fmt(v))); return true; },
  });
}
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
function umgebung(quellen) {
  quellen = quellen || {};
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
    document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' } };
  win.window = win; win.self = win;
  vm.createContext(win);
  const lade = (f) => vm.runInContext(quellen[f] != null ? quellen[f] : rd(f), win, { filename: f });
  // IconsB-Attrappe: schreibt den Richtungswinkel der Sprungboje als Zeichenaufruf ins Protokoll (so sieht der Test jede Änderung am Winkel)
  win.IconsB = { boje(ctx, z, x, y, zoom, w) { ctx.rect(x, y, w, zoom); return true; } };
  lade('kennung.js'); lade('render.js'); lade('kartenlogik.js'); lade('sonden.js'); lade('spur.js'); lade('kartenzeichen.js'); lade('karte-tokens.js'); lade('kartenansicht.js'); lade('starmap.js');
  win.Hud = { szeneVon: () => null };
  return win;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Szene (alle Objekte in Schiffskoordinaten: vor / seitlich, damit sie bei jedem Kurs im Bild der Frontsicht liegen)
const SHIP = { x: 1000, y: 700 };
const rad = (g) => g * Math.PI / 180;
function ansicht(kursGrad, versatz) {
  const k = rad(kursGrad), fx = Math.cos(k), fy = Math.sin(k), sx = -fy, sy = fx;
  const p = (vor, seit) => ({ x: SHIP.x + fx * vor + sx * seit, y: SHIP.y + fy * vor + sy * seit });
  const g = (id, kind, vor, seit, extra) => Object.assign({ id, kind, vk: 'ger', hp: 10, hpMax: 10, angle: 1, shields: [2, 2, 2, 2] }, p(vor, seit), extra || {});
  const enemies = [g('e1', 'raider', 220, 60, { tele: { left: 1.7, dur: 3, sector: 1 } }), g('e2', 'korvette', 260, 90), g('e3', 'fregatte', 180, -140, { tele: { left: 2.1, dur: 3, sector: 3 } }), g('e4', 'kreuzer', 400, 20),
    g('e5', 'raider', 130, 160), g('e6', 'raider', 120, 190), g('e7', 'korvette', -60, -100, { nm: 'Vaelen-Karawane' })];
  const mk = (id, kind, vor, seit, extra) => Object.assign({ id, kind }, p(vor, seit), extra || {});
  const mount = (id, platz, facing, arc, range) => ({ id, platz, facing, arc, range, charge: 1, state: 'ok' });
  const space = { w: 9000, h: 9000, so: [Object.assign({ id: 's1', z: 1, hp: 1 }, p(100, 80)), Object.assign({ id: 's2', z: 0, hp: 1 }, p(150, -60))],
    jp: [Object.assign({ z: 'aktiv', n: '1,2' }, p(520, -120)), Object.assign({ z: 'temporaer', n: '2,2' }, p(300, 330))],
    markers: [mk('w', 'station', 300, 0, { name: 'Wrack' }), mk('h', 'station', 420, 150, { name: 'Hafen' }), mk('d', 'dock', 420, 150, { r: 70 }), mk('x', 'exit', 560, 60, { r: 140 }), mk('p', 'station', 200, -200, { name: 'Posten Nord', posten: true }),
      mk('b', 'buoy', 100, 250), mk('m', 'moon', 450, -300, { r: 120 }), mk('far', 'station', 1500, 0, { name: 'Fern' })],
    hidden: [Object.assign({ id: 'h1', kind: 'hollow', found: true }, p(300 + (versatz || 0), (versatz || 0) / 2 + 0)), Object.assign({ id: 'h2', kind: 'cache', found: false }, p(240, 40))],
    salvage: [Object.assign({ id: 'v1', kind: 'marks' }, p(160, -40))], mines: [Object.assign({ id: 'mi1', s: 1 }, p(350, -60))] };
  return { time: 1, me: { console: 'helm' }, ship: null, enemies, escorts: [], spaceProjectiles: [],
    state: { time: 1, ship: Object.assign({ x: SHIP.x, y: SHIP.y, angle: k, hull: 100, target: 'e1', jump: {}, mounts: [mount('m4', 4, -90, 90, 560), mount('m6', 6, 90, 90, 560), mount('m8', 8, 0, 20, 900)] }, {}), space, players: [], flotte: {}, inventory: { sonde: 2 } } };
}
const RECTS = [['Pult', { x: 10, y: 26, w: 404, h: 184 }], ['Hauptschirm', { x: 0, y: 0, w: 512, h: 288, side: 729 }]];
const VERSATZE = [-60, -30, 0, 30, 60];
const KURSE = [0, 90, 200];
const FAELLE = [];
for (const [rn] of RECTS) for (const kurs of KURSE) for (const v of VERSATZE) FAELLE.push({ name: rn + ' Kurs ' + kurs + ' Versatz ' + v, rect: RECTS.find((r) => r[0] === rn)[1], kurs, versatz: v });
const DUMP = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;   // Fehlersuche: Protokoll eines Falls (Name) in Datei schreiben
function lauf(win, tag) {
  const out = {};
  for (const f of FAELLE) {
    const log = [];
    try { win.Render.drawFrontView(neueFlaeche(log), ansicht(f.kurs, f.versatz), f.rect); } catch (e) { log.push('FEHLER ' + e.message); }
    if (DUMP && f.name === DUMP) fs.writeFileSync(path.join(process.argv[process.argv.indexOf('--dump') + 2], (tag || 'ist') + '.log'), log.join('\n'));
    out[f.name] = { n: log.length, sha: crypto.createHash('sha256').update(log.join('\n')).digest('hex').slice(0, 24), text: log.filter((l) => /^fillText/.test(l)).length };
  }
  return out;
}

if (process.argv.includes('--ref-schreiben')) {
  const dir = process.argv[process.argv.indexOf('--ref-schreiben') + 1];
  if (!dir || !fs.existsSync(path.join(dir, 'render.js'))) { console.log('Aufruf: --ref-schreiben <Verzeichnis mit render.js, starmap.js, sonden.js, spur.js vom Stand f2daff7>'); process.exit(2); }
  const q = {}; for (const f of ['render.js', 'starmap.js', 'sonden.js', 'spur.js']) q[f] = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(REF, JSON.stringify(lauf(umgebung(q), 'ref'), null, 0) + '\n');
  console.log('Referenz geschrieben: ' + REF);
  process.exit(0);
}

const ref = JSON.parse(fs.readFileSync(REF, 'utf8'));
const win = umgebung();
const R = win.Render;

section('(a) Aufrufprotokoll von drawFrontView gleich der Referenz (Stand f2daff7): ' + FAELLE.length + ' Fälle');
{
  const ist = lauf(win);
  const abw = FAELLE.filter((f) => !ref[f.name] || ref[f.name].sha !== ist[f.name].sha || ref[f.name].n !== ist[f.name].n).map((f) => f.name);
  ok(abw.length === 0, 'alle Fälle bit-gleich' + (abw.length ? ' – abweichend: ' + abw.slice(0, 6).join('; ') : ''));
  const klein = ist[FAELLE[0].name];
  ok(klein.n > 300 && klein.text >= 10 && FAELLE.every((f) => ist[f.name].text >= 10), 'die Szene zeichnet etwas (' + klein.n + ' Aufrufe, ' + klein.text + ' Texte im ersten Fall)');
  const mit = (ersetze) => { const q = ersetze(rd('render.js')); return lauf(umgebung({ 'render.js': q })); };
  const anders = (a) => FAELLE.filter((f) => ref[f.name].sha !== a[f.name].sha).length;
  const rangNeu = /front \? 2 : \(m\.posten \? 1 : 1\.5\)/.test(rd('render.js'));
  ok(rangNeu, 'render.js: Ortslabels in der Frontsicht mit Rang 2 (front ? 2 : …)');

  section('(b) Mutation: Rangfolge der Karten-Ortslabels auch in der Frontsicht');
  {
    const a = mit((q) => q.replace('front ? 2 : (m.posten ? 1 : 1.5)', '(m.posten ? 1 : 1.5)'));
    ok(anders(a) >= 1, 'mit dem Rang der Karte weichen ' + anders(a) + ' von ' + FAELLE.length + ' Fällen von der Referenz ab (Versatz-Reihe trifft die Kollision Wrack/Hohlraum)');
  }
  section('(c) Mutation: Kartendrehung im Boje-Winkel auch in der Frontsicht');
  {
    ok(rd('starmap.js').includes('w + (cam.front ? 0 : (cam.rot || 0))') && rd('render.js').includes('rot: front ? 0 : rot,'), 'starmap.js nutzt cam.rot nur auf Karten; render.js gibt in der Frontsicht rot 0');
    const a = lauf(umgebung({ 'render.js': rd('render.js').replace('rot: front ? 0 : rot,', 'rot,'), 'starmap.js': rd('starmap.js').replace('w + (cam.front ? 0 : (cam.rot || 0))', 'w + (cam.rot || 0)') }));   // beide Sicherungen (render.js und starmap.js) weg
    ok(anders(a) >= 1, 'mit Drehung in der Frontsicht weichen ' + anders(a) + ' von ' + FAELLE.length + ' Fällen ab');
  }
}

section('(d) Konstanten und Aufrufer');
{
  ok(R.FRONT.fwd === 700 && R.FRONT.back === 120 && R.FRONT.side === 420, 'R.FRONT = { fwd 700, back 120, side 420 }');
  ok(/R\.drawFrontView\(c, view, \{ x: 0, y: 0, w: SW, h: SH, side: \(SW \/ 2\) \/ zoom, sicht: \{ x: 0, y: 0, w: SW, h: SH \}, randOben: szeneOben\(view\) \}\)/.test(rd('sitz.js')), 'sitz.js: Aufruf von drawFrontView im Hauptschirm unverändert');
}

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
