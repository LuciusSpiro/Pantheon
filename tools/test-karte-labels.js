'use strict';
// OPS-01 Paket B (Nacharbeit): Beschriftungen der Taktik-/Lagekarte überdecken sich nicht. Eine Entzerrung (flushLabels in drawSpace) für Ops und Captain-Lage.
//   (a) Szene mit 8 Gegnern, Hafen, Dock-Ring, Sprungpunkt, Posten, Schiffsbögen (BB/STB/BUG), Ziel: in drawTactical sammelt eine Zeichenfläche alle fillText-Rechtecke;
//       bei Standardzoom und kleinster Stufe der Ops-Fläche, Captain-Lage, drei Kursen, beiden Ausrichtungen und beiden Lagen der Kartenmitte (Pult: Mitte nach rechts verschoben)
//       dürfen sich Beschriftungen nicht überlappen (Toleranz 1 px). Die Nordmarke zählt als Beschriftung.
//   (b) Mutation: dieselbe Szene mit render.js von vor der Nacharbeit (7f097f3) muss Überlappungen zeigen – sonst misst der Test nichts
//   (c) Kurzform der Bogenbeschriftung unter Zoom 0,2; Beschriftungen bei lesbaren Stufen bleiben; Kennung/Schildring werden nie weggelassen
//   (d) Sicht seitlich >= R.FRONT.side an beiden Extremen von opsMitteX (pult-stationen.js), Fläche 404 × 184
//   node tools/test-karte-labels.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const BREITE = (s) => String(s).length * 5;   // Messung wie in den anderen Karten-Tests: 5 px je Zeichen

// Zeichenfläche: fillText-Rechtecke (Schatten rgba(11,14,26) ausgenommen), Schrifthöhe aus ctx.font, Ausrichtung aus textAlign
function neueFlaeche() {
  const texte = [];
  const st = { fillStyle: '#000', strokeStyle: '#000', font: '8px monospace', textAlign: 'left', tx: 0, ty: 0 };
  const stack = [];
  const f = {
    save() { stack.push({ tx: st.tx, ty: st.ty, font: st.font, textAlign: st.textAlign }); },
    restore() { const s = stack.pop(); if (s) Object.assign(st, s); },
    translate(x, y) { st.tx += x; st.ty += y; },
    fillText(s, x, y) {
      if (/^rgba\(11,14,26/.test(st.fillStyle)) return;
      const h = +(/(\d+)px/.exec(st.font) || [0, 8])[1], w = BREITE(s), px = x + st.tx, py = y + st.ty;
      const x0 = st.textAlign === 'center' ? px - w / 2 : st.textAlign === 'right' ? px - w : px;
      texte.push({ s: String(s), x: x0, y: py, w, h });
    },
    measureText: (s) => ({ width: BREITE(s) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx = new Proxy(f, {
    get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? () => {} : undefined),
    set: (t, k, v) => { st[k] = v; return true; },
  });
  return { ctx, texte };
}
const messCtx = new Proxy({ measureText: (s) => ({ width: BREITE(s) }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });   // Zeichen- und Messfläche der Zwischenbilder (Kennung)
function umgebung(renderQuelle) {
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
    document: { createElement: () => ({ getContext: () => messCtx, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' } };
  win.window = win; win.self = win;
  vm.createContext(win);
  const lade = (f, q) => vm.runInContext(q || fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), win, { filename: f });
  win.SchiffsUI = { waffeVon: (m) => ({ id: m.id, art: m.art || 'salve', kurz: m.kurz || 'STANDARD' }), platzVon: (m) => m.platz, drawWaffe() {} };   // Stub: Waffenname je Platz, wie auf dem Pult
  lade('kennung.js'); lade('render.js', renderQuelle); lade('kartenlogik.js'); lade('sonden.js'); lade('spur.js');
  win.Hud = { szeneVon: () => null };
  return win;
}
const win = umgebung();
const R = win.Render, KL = win.Kartenlogik;
const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

const OPS = { x: 10, y: 26, w: 404, h: 184 };
const LAGE = { x: 12, y: 48, w: 440, h: 238 };
const rad = (g) => g * Math.PI / 180;
const SHIP = { x: 1000, y: -500 };
const rel = (dx, dy) => ({ x: SHIP.x + dx, y: SHIP.y + dy });

// Szene: Gegner dicht beieinander (Klumpen wie auf dem Pult), Hafen + Dock-Ring + Sprungpunkt + Posten, drei Bögen, Ziel e1
function szene(kurs) {
  const g = (id, kind, dx, dy, extra) => Object.assign({ id, kind, vk: 'ger', hp: 10, hpMax: 10, angle: 1, shields: [2, 2, 2, 2] }, rel(dx, dy), extra || {});
  const enemies = [g('e1', 'raider', 90, -160), g('e2', 'korvette', 60, 330), g('e3', 'fregatte', 190, 250), g('e4', 'kreuzer', 120, 380), g('e5', 'raider', -230, 140),
    g('e6', 'raider', -200, 200), g('e7', 'korvette', 330, -60), g('e8', 'fregatte', -310, -220, { nm: 'Vaelen-Karawane' })];
  const mk = (id, kind, dx, dy, extra) => Object.assign({ id, kind }, rel(dx, dy), extra || {});
  const mount = (id, platz, facing, arc, range, extra) => Object.assign({ id, platz, facing, arc, range, charge: 1, state: 'ok' }, extra || {});
  const space = { w: 6000, h: 6000, so: [{ id: 's1', ...rel(150, 40), z: 1, hp: 1 }, { id: 's2', ...rel(-120, -60), z: 0, hp: 1 }], jp: [{ z: 'aktiv', n: '1,2' }, { z: 'aktiv', n: '2,2' }], markers: [mk('h', 'station', 20, 330), mk('d', 'dock', 20, 330, { r: 70 }), mk('x', 'exit', -380, -300, { r: 140 }), mk('p', 'station', 280, 190, { name: 'Posten Nord', posten: true }), mk('k', 'moon', -150, 120, { name: 'Mond Kesh', r: 60 })] };
  return { time: 1, me: { console: 'weapons' }, ship: null, enemies, escorts: [],
    state: { time: 1, ship: { x: SHIP.x, y: SHIP.y, angle: rad(kurs), hull: 100, target: 'e1',
      mounts: [mount('m4', 4, -90, 90, 560, { kurz: 'STANDARD' }), mount('m6', 6, 90, 90, 560, { kurz: 'STANDARD' }), mount('m8', 8, 0, 20, 900, { art: 'lanze', kurz: 'LANZE' })] }, space, players: [], flotte: {}, inventory: { sonde: 2 } } };
}
// Pult wie in pult-stationen.js: Leisten oben links (266 breit), Zoomzeile oben rechts, Mitte nach rechts verschoben
function pultConfig(rect, cxRel) {
  // dazu die Sonden-Tasten unten links (SondenView.flaeche, 2 Sprungpunkte): stehen über der Karte und dürfen von Labels nicht verdeckt werden
  const sonden = win.SondenView.flaeche(szene(0).state, rect);
  return { cx: rect.x + cxRel, sperren: [{ x: rect.x + rect.w - 64, y: rect.y + 1, w: 62, h: 11 }, { x: rect.x + 4, y: rect.y + 29, w: 266, h: 66 }, sonden] };
}
function zeichne(w, rect, karte, zoom, ausr, kurs, extra) {
  w.Kartenlogik.setze(karte, ausr);
  const view = szene(kurs), { ctx, texte } = neueFlaeche(), rects = [];
  const o = Object.assign({ zoom, arcs: karte === 'weapons', intel: true, mode: karte === 'weapons' ? 'tactical' : 'lage', enemyRects: rects }, w.Kartenlogik.optionen(karte, view), extra || {});
  const res = w.Render.drawTactical(ctx, view, rect, o);
  return { res, texte, rects };
}
// Paarweise Überlappung (Toleranz 1 px je Seite)
function ueberlappungen(texte) {
  const out = [];
  for (let i = 0; i < texte.length; i++) for (let j = i + 1; j < texte.length; j++) {
    const a = texte[i], b = texte[j];
    if (a.x + 1 < b.x + b.w && b.x + 1 < a.x + a.w && a.y + 1 < b.y + b.h && b.y + 1 < a.y + a.h) out.push(a.s + ' x ' + b.s);
  }
  return out;
}
const FAELLE = [];
for (const ausr of ['schiff', 'norden']) for (const kurs of [0, 135, 250]) {
  FAELLE.push({ name: 'Ops Standard Mitte', rect: OPS, karte: 'weapons', zoom: KL.zoomStandard(OPS), ausr, kurs, extra: { cx: OPS.x + 202 } });
  FAELLE.push({ name: 'Ops Standard Mitte rechts (Pult)', rect: OPS, karte: 'weapons', zoom: KL.zoomStandard(OPS), ausr, kurs, extra: pultConfig(OPS, 334) });
  FAELLE.push({ name: 'Ops kleinste Stufe', rect: OPS, karte: 'weapons', zoom: KL.zoomMin(OPS), ausr, kurs, extra: { cx: OPS.x + 202 } });
  FAELLE.push({ name: 'Ops kleinste Stufe Mitte rechts', rect: OPS, karte: 'weapons', zoom: KL.zoomMin(OPS), ausr, kurs, extra: pultConfig(OPS, 334) });
  FAELLE.push({ name: 'Ops Zoom 0,25', rect: OPS, karte: 'weapons', zoom: 0.25, ausr, kurs, extra: {} });
  FAELLE.push({ name: 'Captain-Lage Standard', rect: LAGE, karte: 'lage', zoom: KL.zoomStandard(LAGE), ausr, kurs, extra: {} });
  FAELLE.push({ name: 'Captain-Lage 0,35', rect: LAGE, karte: 'lage', zoom: 0.35, ausr, kurs, extra: {} });
}
function lauf(w) {
  let schlecht = 0, gesamt = 0; const beispiele = [];
  for (const f of FAELLE) {
    const { texte } = zeichne(w, f.rect, f.karte, f.zoom, f.ausr, f.kurs, f.extra);
    const u = ueberlappungen(texte); gesamt++;
    for (const q of (f.extra && f.extra.sperren) || []) for (const a of texte) if (a.s !== 'N' && a.x + 1 < q.x + q.w && q.x + 1 < a.x + a.w && a.y + 1 < q.y + q.h && q.y + 1 < a.y + a.h) u.push(a.s + ' x Sperre');
    if (u.length) { schlecht++; if (beispiele.length < 6) beispiele.push(f.name + ' ' + f.ausr + ' Kurs ' + f.kurs + ' z ' + f.zoom.toFixed(3) + ': ' + u.slice(0, 4).join(' | ')); }
  }
  return { schlecht, gesamt, beispiele };
}

section('(a) keine überlappenden Beschriftungen: ' + FAELLE.length + ' Fälle (Standard, kleinste Stufe, 0,25, Captain-Lage; 3 Kurse; beide Ausrichtungen)');
{
  const r = lauf(win);
  ok(r.schlecht === 0, r.gesamt + ' Fälle, davon mit Überlappung: ' + r.schlecht + (r.beispiele.length ? '\n         ' + r.beispiele.join('\n         ') : ''));
  const probe = zeichne(win, OPS, 'weapons', KL.zoomStandard(OPS), 'schiff', 0, { cx: OPS.x + 202 });
  ok(probe.texte.length >= 8, 'die Szene trägt Beschriftungen (' + probe.texte.length + ' Texte bei Standardzoom): ' + probe.texte.map((t) => t.s).join(', ').slice(0, 200));
}

section('(b) Mutation: render.js ohne die Entzerrung (Stand 7f097f3) überlappt in derselben Szene');
{
  let alt = null;
  try { alt = execFileSync('git', ['show', '7f097f3:public/js/render.js'], { cwd: ROOT, encoding: 'utf8' }); } catch (e) { alt = null; }
  if (!alt) ok(false, 'Vergleichsstand 7f097f3 nicht lesbar');
  else {
    const r = lauf(umgebung(alt));
    ok(r.schlecht >= 4, 'alter Stand: ' + r.schlecht + ' von ' + r.gesamt + ' Fällen mit Überlappung (der Test ist rot ohne die Entzerrung)' + (r.beispiele.length ? '\n         ' + r.beispiele.slice(0, 2).join('\n         ') : ''));
  }
}

section('(c) Kurzform der Bogenbeschriftung und erhaltene Beschriftungen');
{
  const txt = (zoom, rect, karte) => zeichne(win, rect || OPS, karte || 'weapons', zoom, 'schiff', 0, { cx: OPS.x + 202 }).texte.map((t) => t.s);
  const lang = txt(0.25), kurz = txt(KL.zoomMin(OPS)), mitte = txt(KL.zoomStandard(OPS));
  ok(lang.some((s) => /STANDARD BEREIT/.test(s)), 'Zoom 0,25: Bogenbeschriftung wie bisher in Langform');
  ok(KL.zoomStandard(OPS) < 0.2 && !mitte.some((s) => /STANDARD/.test(s)) && mitte.includes('BB') && mitte.includes('STB'), 'Standardzoom (' + KL.zoomStandard(OPS).toFixed(3) + ' < 0,2): Kurzform BB / STB statt „STANDARD BEREIT“');
  ok(!kurz.some((s) => /STANDARD/.test(s)) && kurz.includes('BB') && kurz.includes('STB'), 'kleinste Stufe: Kurzform');
  ok(lang.includes('ZIEL') && mitte.includes('ZIEL') && kurz.includes('ZIEL'), 'ZIEL bleibt auf allen Stufen stehen');
  ok(lang.includes('HAFEN') && mitte.includes('HAFEN'), 'HAFEN bleibt bei Zoom 0,25 und Standardzoom stehen (' + lang.length + ' / ' + mitte.length + ' Beschriftungen)');
  const { rects } = zeichne(win, OPS, 'weapons', KL.zoomMin(OPS), 'schiff', 0, { cx: OPS.x + 202 });
  ok(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'].every((id) => rects.some((q) => q.id === id)), 'kleinste Stufe: jeder sichtbare Gegner hat Kennung und Klickfläche (die Entzerrung betrifft nur Textlabels)');
  ok(/kennungMassstab\(zoom\) \{ return zoom >= 0\.3 \? 2 : 1\.5; \}/.test(rd('render.js')), 'Kennungsmaßstab unverändert: 2 ab Zoom 0,3, sonst 1,5');
}

section('(d) Sicht seitlich >= R.FRONT.side an beiden Extremen der Kartenmitte (opsMitteX)');
{
  // pult-stationen.js: Mitte zwischen Flächenmitte (x + 202) und min(x + w − 70, x + 4 + 266 + 58) = x + 328; Obergrenze der Formel x + w − 70 = x + 334
  const q = rd('pult-stationen.js');
  ok(/Math\.min\(mr\.x \+ mr\.w - 70, mr\.x \+ 4 \+ 266 \+ 58\)/.test(q) && /const mitteX = mr\.x \+ Math\.round\(mr\.w \/ 2\)/.test(q), 'pult-stationen.js: Mitte zwischen Flächenmitte und min(x + w − 70, x + 328) (Formel unverändert)');
  const z = KL.zoomStandard(OPS), side = R.FRONT.side;
  const extreme = [['Mitte (unverschoben)', OPS.w / 2], ['Verschiebung durch Leisten (x + 328)', 4 + 266 + 58], ['äußerste Grenze der Formel (x + w − 70)', OPS.w - 70]];
  for (const [nm, cxRel] of extreme) {
    const rechts = (OPS.w - cxRel) / z, links = cxRel / z;
    ok(rechts >= side && links >= side, nm + ': rechts ' + rechts.toFixed(0) + ' / links ' + links.toFixed(0) + ' Welt-px ≥ R.FRONT.side (' + side + ')');
    let alle = true;
    for (const ausr of ['schiff', 'norden']) for (const kurs of [0, 90, 200]) {
      const { res } = zeichne(win, OPS, 'weapons', z, ausr, kurs, { cx: OPS.x + cxRel });
      const k = rad(kurs);
      const pts = ausr === 'schiff' ? [rel(Math.cos(k + Math.PI / 2) * side, Math.sin(k + Math.PI / 2) * side), rel(Math.cos(k - Math.PI / 2) * side, Math.sin(k - Math.PI / 2) * side)] : [rel(side, 0), rel(-side, 0)];
      for (const p of pts) { const s = res.toS(p.x, p.y); if (s.x < OPS.x - 1 || s.x > OPS.x + OPS.w + 1) alle = false; }
    }
    ok(alle, nm + ': R.FRONT.side seitlich liegt über toS in der Fläche (beide Ausrichtungen, 3 Kurse)');
  }
}

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
