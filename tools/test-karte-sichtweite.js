'use strict';
// OPS-01 Paket B: Sichtweite der Ops-Taktikkarte. Ops und Captain sehen dasselbe Gefecht gleich gut; der Sichtwert kommt aus der Frontsicht des Steuers (R.FRONT), nicht aus einer zweiten Zahl.
//   (a) Standardzoom der Ops-Karte: vorn und hinten je >= R.FRONT.fwd, seitlich >= max(R.FRONT.side, Seitenhälfte des Voxel-Hauptschirms nach der Formel aus sitz.js)
//   (b) bei „Schiff oben“ und „Norden oben“, mehreren Kursen: Punkte 700 vor / 700 hinter dem Bug / R.FRONT.side seitlich liegen in der Kartenfläche (über toS aus drawTactical)
//   (c) kleinste Stufe zeigt den Sensorradius (1400) in alle Richtungen (Höhe >= 2800)
//   (d) Stufenliste aufsteigend, ohne Duplikate, cycleZoom klemmt an den Enden, Standardstufe ist enthalten; Ops und Captain-Lage nutzen dieselbe Funktion
//   (e) Frontsicht unverändert (drawFrontView-Aufrufprotokoll gleich dem Stand von Paket A, R.FRONT-Werte)
//   (f) Klickfläche eines Gegners im Standardzoom >= 14 px je Seite
//   node tools/test-karte-sichtweite.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);

function neueFlaeche(log) {
  const st = { fillStyle: '#000', strokeStyle: '#000' };
  const f = { measureText: (s) => ({ width: String(s).length * 5 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) };
  return new Proxy(f, {
    get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? (...a) => { if (log) log.push(k + ':' + JSON.stringify(a.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : typeof v === 'object' ? '[o]' : v)))); } : undefined),
    set: (t, k, v) => { st[k] = v; return true; },
  });
}
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
function umgebung(renderQuelle) {
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
    document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' } };
  win.window = win; win.self = win;
  vm.createContext(win);
  const lade = (f, q) => vm.runInContext(q || fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), win, { filename: f });
  lade('kennung.js'); lade('render.js', renderQuelle); lade('kartenlogik.js');
  win.Hud = { szeneVon: () => null };
  return win;
}
const win = umgebung();
const R = win.Render, KL = win.Kartenlogik;
const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

const OPS = { x: 10, y: 26, w: 404, h: 184 };       // Ops-Anzeigefläche im Pult (pult-stationen.js, mr)
const OPS_ALT = { x: 10, y: 26, w: 404, h: 292 };   // Ops-Karte im alten Konsolenlayout (consoles.js drawWeapons)
const LAGE = { x: 12, y: 48, w: 440, h: 238 };      // Captain-Lage
const KURSE = [0, 45, 90, 135, 180, 225, 270, 315];
const rad = (g) => g * Math.PI / 180;
const SHIP = { x: 1000, y: -500 };
const ansicht = (kurs, extra) => Object.assign({ time: 1, me: { console: 'weapons' }, ship: null, enemies: [], escorts: [],
  state: { time: 1, ship: { x: SHIP.x, y: SHIP.y, angle: rad(kurs), hull: 100, mounts: [] }, space: {}, players: [], flotte: {} } }, extra || {});
function zeichne(karte, rect, zoom, ausr, kurs, extra) {
  KL.setze(karte, ausr);
  const view = ansicht(kurs, extra), rects = [];
  const res = R.drawTactical(neueFlaeche(), view, rect, Object.assign({ zoom, arcs: karte === 'weapons', intel: true, mode: karte === 'weapons' ? 'tactical' : 'lage', enemyRects: rects }, KL.optionen(karte, view)));
  return { res, rects };
}
const inRect = (p, r) => p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1;
const nah = (d, wink) => ({ x: SHIP.x + Math.cos(wink) * d, y: SHIP.y + Math.sin(wink) * d });

// Voxelhälfte aus sitz.js: SW/SH wirklich dort nachlesen, dann (SW/2) / (SH / (fwd + back))
const sitz = rd('sitz.js');
const mSW = /const SW = (\d+), SH = (\d+);/.exec(sitz);
const F = R.FRONT;
const voxelHaelfte = (+mSW[1] / 2) / (+mSW[2] / (F.fwd + F.back));
const seiteMin = Math.max(F.side, voxelHaelfte);

section('(a) Standardzoom der Ops-Karte: vorn und hinten R.FRONT.fwd, seitlich max(FRONT.side, Voxelhälfte)');
{
  ok(mSW && +mSW[1] === 512 && +mSW[2] === 288, 'sitz.js: Hauptschirm 512 × 288 (Kartenlogik rechnet mit denselben Maßen)');
  ok(Math.abs(voxelHaelfte - 728.9) < 0.5, 'Voxelhälfte ≈ 729 (' + voxelHaelfte.toFixed(1) + ')');
  for (const [name, rect] of [['Pult 404×184', OPS], ['alt 404×292', OPS_ALT]]) {
    const z = KL.zoomStandard(rect);
    ok(rect.h / z / 2 >= F.fwd - 1e-6, name + ': vorn und hinten je ' + (rect.h / z / 2).toFixed(0) + ' ≥ FRONT.fwd (' + F.fwd + ')');
    ok(rect.w / z / 2 >= seiteMin - 1e-6, name + ': seitlich je ' + (rect.w / z / 2).toFixed(0) + ' ≥ ' + seiteMin.toFixed(0));
    ok(z < 0.3 && z > KL.zoomMin(rect), name + ': Standardzoom ' + z.toFixed(3) + ' liegt über dem kleinsten Zoom');
  }
  ok(OPS.h / 0.35 / 2 < F.fwd, 'zur Kontrolle: bei 0,35 reichte die Karte nur ' + (OPS.h / 0.35 / 2).toFixed(0) + ' nach vorn (< FRONT.fwd)');
}

section('(b) Sichtbereich bei „Schiff oben“ und „Norden oben“, acht Kurse');
{
  const zs = KL.zoomStandard(OPS);
  for (const ausr of ['schiff', 'norden']) {
    let alle = true, detail = '';
    for (const kurs of KURSE) {
      const k = rad(kurs), { res } = zeichne('weapons', OPS, zs, ausr, kurs);
      const pkt = ausr === 'schiff'
        ? { vorn: nah(F.fwd, k), hinten: nah(F.fwd, k + Math.PI), links: nah(F.side, k - Math.PI / 2), rechts: nah(F.side, k + Math.PI / 2) }
        : { n: nah(F.fwd, -Math.PI / 2), s: nah(F.fwd, Math.PI / 2), o: nah(seiteMin, 0), w: nah(seiteMin, Math.PI) };
      for (const [nm, p] of Object.entries(pkt)) if (!inRect(res.toS(p.x, p.y), OPS)) { alle = false; detail += ' Kurs ' + kurs + ' ' + nm; }
    }
    ok(alle, (ausr === 'schiff' ? 'Schiff oben: 700 vorn / 700 hinten / FRONT.side seitlich in der Fläche, alle Kurse' : 'Norden oben: 700 nach N/S, Seitenmaß nach O/W in der Fläche, alle Kurse') + detail);
  }
  // Schiff oben: vorn heißt oben – der Punkt 700 vor dem Bug liegt oben am Rand, der 700 dahinter unten
  const { res } = zeichne('weapons', OPS, zs, 'schiff', 135);
  const p = nah(F.fwd, rad(135)), q = nah(F.fwd, rad(135) + Math.PI);
  ok(Math.abs(res.toS(p.x, p.y).y - OPS.y) <= 1 && Math.abs(res.toS(q.x, q.y).y - (OPS.y + OPS.h)) <= 1 && Math.abs(res.toS(p.x, p.y).x - res.cx) <= 1, 'Schiff oben: 700 voraus genau am oberen, 700 achteraus genau am unteren Rand (Kurs 135°)');
  // Captain-Lage: gleiche Funktion, andere Fläche
  const zl = KL.zoomStandard(LAGE), { res: rl } = zeichne('lage', LAGE, zl, 'schiff', 30);
  const pl = nah(F.fwd, rad(30));
  ok(inRect(rl.toS(pl.x, pl.y), LAGE), 'Captain-Lage: dieselbe Funktion ergäbe für ihre Fläche ebenfalls ≥ ' + F.fwd + ' nach vorn (Zoom ' + zl.toFixed(3) + ')');
}

section('(c) kleinste Stufe: Sensorradius in alle Richtungen');
{
  const sr = R.sensorRange({});
  ok(sr === 1400, 'R.sensorRange ohne Nebel = 1400 (Quelle für die kleinste Stufe)');
  for (const [name, rect, karte] of [['Ops', OPS, 'weapons'], ['Captain-Lage', LAGE, 'lage']]) {
    const zm = KL.zoomMin(rect), { res } = zeichne(karte, rect, zm, 'schiff', 20);
    ok(rect.h / zm >= 2 * sr - 1e-6, name + ': Höhe der Kartenfläche ' + (rect.h / zm).toFixed(0) + ' ≥ 2·' + sr);
    let alle = true;
    for (let a = 0; a < 360; a += 15) { const p = nah(sr, rad(a)), s = res.toS(p.x, p.y); if (!inRect(s, rect)) alle = false; }
    ok(alle, name + ': Punkte im Sensorradius rundum (24 Richtungen) liegen in der Fläche');
  }
}

section('(d) Stufenliste und cycleZoom');
{
  for (const [name, rect] of [['Ops', OPS], ['Ops alt', OPS_ALT], ['Captain-Lage', LAGE]]) {
    const st = KL.zoomStufen(rect);
    ok(st.every((z, i) => i === 0 || z > st[i - 1]), name + ': Stufen streng aufsteigend ' + st.map((z) => z.toFixed(3)).join(' '));
    ok(st.every((z, i) => i === 0 || z / st[i - 1] >= 1.15), name + ': keine zu engen Nachbarn (Verhältnis ≥ 1,15)');
    ok(Math.abs(st[0] - KL.zoomMin(rect)) < 1e-9 && st.some((z) => Math.abs(z - KL.zoomStandard(rect)) < 1e-9), name + ': kleinste Stufe und Standardstufe sind enthalten');
    ok(st[st.length - 1] >= 0.5, name + ': hineinzoomen bleibt möglich (größte Stufe ' + st[st.length - 1] + ')');
  }
  // cycleZoom/zoomAbgleichen aus consoles.js herausgelöst (Quelltext der beiden Methoden, gegen Kartenlogik)
  const q = rd('consoles.js').replace(/\r\n/g, '\n');
  const m = /(    zoomAbgleichen\(which, rect\)[\s\S]*?    cycleZoom\(which, dir\) \{[\s\S]*?\n    \},)\n/.exec(q);
  ok(!!m, 'consoles.js: zoomAbgleichen und cycleZoom gefunden');
  const Kons = vm.runInNewContext('({ zoom: { weapons: 0.35, lage: 0.35 }, zoomGewaehlt: { weapons: false, lage: true }, mapRects: { weapons: OPS, lage: LAGE },' + m[1] + ' })', { Kartenlogik: KL, OPS, LAGE });
  Kons.zoomAbgleichen('weapons', OPS);
  ok(Math.abs(Kons.zoom.weapons - KL.zoomStandard(OPS)) < 1e-9, 'Ops startet im Standardzoom');
  Kons.zoomAbgleichen('weapons', OPS_ALT);
  ok(Math.abs(Kons.zoom.weapons - KL.zoomStandard(OPS_ALT)) < 1e-9, 'ungewählt folgt der Zoom einer anderen Kartenfläche');
  Kons.zoomAbgleichen('weapons', OPS);
  const st = KL.zoomStufen(OPS);
  Kons.cycleZoom('weapons', 1);
  ok(Math.abs(Kons.zoom.weapons - st[2]) < 1e-9, '+ geht eine Stufe hinein');
  for (let i = 0; i < 10; i++) Kons.cycleZoom('weapons', 1);
  ok(Math.abs(Kons.zoom.weapons - st[st.length - 1]) < 1e-9, '+ klemmt an der größten Stufe');
  for (let i = 0; i < 10; i++) Kons.cycleZoom('weapons', -1);
  ok(Math.abs(Kons.zoom.weapons - st[0]) < 1e-9, '− klemmt an der kleinsten Stufe (Sensorradius)');
  Kons.zoomAbgleichen('weapons', OPS_ALT);
  ok(Math.abs(Kons.zoom.weapons - st[0]) < 1e-9, 'eine gewählte Stufe wird nicht vom Standard überschrieben');
  const gesehen = []; for (let i = 0; i < st.length; i++) { Kons.cycleZoom('weapons'); gesehen.push(Kons.zoom.weapons); }
  ok(Math.abs(Kons.zoom.weapons - st[0]) < 1e-9 && gesehen.length === st.length, 'Z reihum läuft über alle Stufen und wieder zum Anfang');
  Kons.cycleZoom('lage'); ok(KL.zoomStufen(LAGE).some((z) => Math.abs(z - Kons.zoom.lage) < 1e-9), 'Captain-Lage: cycleZoom nutzt dieselbe Stufenfunktion');
  ok(!/ZOOM_STEPS/.test(rd('consoles.js') + rd('pult-stationen.js')), 'keine zweite, feste Stufenliste mehr in consoles.js/pult-stationen.js');
  ok(/zoomAbgleichen\('weapons', mr\)/.test(rd('pult-stationen.js')) && /zoomAbgleichen\('weapons', rect\)/.test(rd('consoles.js')), 'Ops-Pult und altes Ops-Layout gleichen den Zoom an ihre Fläche an');
}

section('(e) Frontsicht unverändert');
{
  ok(F.fwd === 700 && F.back === 120 && F.side === 420, 'R.FRONT = { fwd 700, back 120, side 420 }');
  const git = (a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  let alt = null;
  try { alt = git(['show', 'ebfc378:public/js/render.js']); } catch (e) { alt = null; }
  if (alt) {
    const wa = umgebung(alt);
    const prot = (w) => {
      const log = [], c = neueFlaeche(log), v = ansicht(40, { enemies: [{ id: 'e', kind: 'raider', x: SHIP.x + 200, y: SHIP.y - 300, hp: 10, hpMax: 10, angle: 0, shields: [2, 2, 2, 2] }] });
      w.Render.drawFrontView(c, v, { x: 10, y: 26, w: 404, h: 184 }); w.Render.drawFrontView(c, v, { x: 0, y: 0, w: 512, h: 288, side: 729 });
      return log.join('|');
    };
    const p1 = prot(win), p2 = prot(wa);
    ok(p1.length > 100 && p1 === p2, 'drawFrontView: Aufrufprotokoll gleich dem Stand von Paket A (' + p1.length + ' Zeichen)');
  } else ok(false, 'Vergleichsstand ebfc378 nicht lesbar');
  ok(git(['diff', '--name-only', 'ebfc378', '--', 'public/js/sitz.js', 'server', 'shared']).trim() === '', 'sitz.js, server/, shared/ gegenüber Paket A unverändert (kein Snapshot-/Serverteil; render.js nur durch die Label-Entzerrung der Nacharbeit, drawFrontView bleibt durch das Aufrufprotokoll oben belegt)');
}

section('(f) Klickfläche eines Gegners im Standardzoom');
{
  const zs = KL.zoomStandard(OPS);
  const gegner = (id, kind) => ({ id, kind, vk: 'ger', x: SHIP.x + 250, y: SHIP.y - 120, hp: 10, hpMax: 10, angle: 0, shields: [2, 2, 2, 2] });
  for (const kind of ['raider', 'korvette', 'fregatte', 'kreuzer']) {
    const { rects } = zeichne('weapons', OPS, zs, 'schiff', 0, { enemies: [gegner('g1', kind)] });
    const r = rects.find((q) => q.id === 'g1');
    ok(r && r.w >= 14 && r.h >= 14, kind + ': Klickfläche ' + (r ? r.w + '×' + r.h : 'fehlt') + ' px ≥ 14×14 bei Zoom ' + zs.toFixed(3));
  }
  const { rects } = zeichne('weapons', OPS, KL.zoomMin(OPS), 'schiff', 0, { enemies: [gegner('g2', 'raider')] });
  const r = rects.find((q) => q.id === 'g2');
  ok(r && r.w >= 14 && r.h >= 14, 'kleinste Stufe: Klickfläche des Jägers ' + (r ? r.w + '×' + r.h : 'fehlt') + ' px ≥ 14×14');
}

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
