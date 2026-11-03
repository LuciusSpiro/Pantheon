'use strict';
// KUL-03 C: Instrumentenleiste und Peilband des Visiers (public/js/visier-leiste.js) mit den ECHTEN Skripten (art.js, render.js, Tokens, hauptschirm-tafeln.js, visier.js) im vm, Aufrufprotokoll als Zeichenflaeche.
//   (1) Peilband winkeltreu: Peilung 0/+-15/+-30 Grad: Bandposition == Visier.projiziere des Objekts auf <= 1,5 Grad, ab Entfernung 400; Mockup-Formel tan(a)*F liegt weiter daneben (Gegenprobe)
//   (2) Bandstriche: Kurs steht unter der Mitte, Zahlen dreistellig, 0 als N, Striche liegen im Band
//   (3) Text passt: Tempo + Schubstufe (laengstes Wort STOPP, dreistelliges Tempo) bis x 130, Kurs im Kasten, Band ab x 134, Kasten ueber den Zahlen frei
//   (4) keine Huelle in der Leiste; Leiste 22 px, nur Tempo-Feld und Kasten ragen darueber
//   (5) oben links frei: kein Zeichenaufruf im Bereich oben links
//   (6) Marken Ziel (Bernstein), Sprungboje (Messing), Station (Mint), Stern; Randpfeil ausserhalb; Gegner hinter dem Schiff nicht auf dem Band
//   (7) kein Wurf bei fehlenden Daten, save/restore ausgeglichen; Schicht 'leiste' beim Visier angemeldet, Sprungziel-Tafel rechts oben, ohne Sprungziel keine Tafel
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');
const rad = (g) => g * Math.PI / 180, grad = (r) => r / Math.PI * 180;

const meldungen = [];
const messCtx = { font: '8px monospace', measureText(s) { return { width: String(s).length * 5 }; } };
const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
  Shared_Locations: require('../shared/locations.js'), Net: { reportError: (l, e) => meldungen.push(l + ': ' + (e && e.message)) },
  document: { createElement: () => ({ getContext: () => messCtx, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
  console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' } };
win.window = win; win.self = win;
vm.createContext(win);
for (const f of ['art.js', 'kennung.js', 'render.js', 'kartenlogik.js', 'sonden.js', 'spur.js', 'kartenzeichen.js', 'karte-tokens.js', 'kartenansicht.js', 'starmap.js', 'hauptschirm-tokens.js', 'hauptschirm-tafeln.js', 'kulisse-himmel.js', 'visier.js']) vm.runInContext(rd(f), win, { filename: f });
win.Hauptschirm = { registriere() {} };
win.Consoles = {
  helmInfo(ship) { const h = (ship && ship.helm) || {}; return { stages: h.stages || [], names: (h.stageNames || []).map((s) => String(s).replace('¼', '1/4').replace('½', '1/2').replace('¾', '3/4')), stage: h.stage != null ? h.stage : -1, stop: h.stop != null ? h.stop : 1 }; },
  targetOf(view) { const id = (view.state.ship || {}).target; if (!id) return null; if (id === 'station') { const so = win.Render.stationOf(view.state.space); return so ? Object.assign({ hidden: true }, so) : null; } return (view.enemies || []).find((e) => e.id === id) || null; },
};
// Leiste NACH der Umgebung laden; sie meldet sich beim Visier an (hier: Aufzeichnung der Anmeldung)
const angemeldet = [];
const reg0 = win.Visier.registriereSchicht; win.Visier.registriereSchicht = (name, rang, fn) => { angemeldet.push({ name, rang, fn }); return reg0(name, rang, fn); };
vm.runInContext(rd('visier-leiste.js'), win, { filename: 'visier-leiste.js' });
const VL = win.VisierLeiste, Vis = win.Visier, TK = win.HauptschirmTokens.TOKENS, LS = TK.VISIER.leiste, W = TK.SCHIRM.w, H = TK.SCHIRM.h, LY = H - LS.hoehe, cam = Vis.kamera();
const R = win.Render;

// ------------------------------------------------------------------ Zeichenflaeche: Protokoll aller Geometrie und Texte (Render.text wird mitgeschrieben, nicht gemalt)
function neueFlaeche(log) {
  const st = { fillStyle: '#000', strokeStyle: '#000', font: '8px monospace', lineWidth: 1 };
  const grad = { addColorStop() {} }, P = [], T = [0, 0], TS = [];
  const f = { measureText: (s) => ({ width: String(s).length * 5 }), createLinearGradient: () => grad, createRadialGradient: () => grad,
    fillRect(x, y, w, h) { log.push({ k: 'rect', x0: x, y0: y, x1: x + w, y1: y + h, fill: st.fillStyle }); },
    translate(x, y) { T[0] += x; T[1] += y; },
    moveTo(x, y) { P.length = 0; P.push([x + T[0], y + T[1]]); }, lineTo(x, y) { P.push([x + T[0], y + T[1]]); },
    fill() { if (P.length) { const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]); log.push({ k: 'poly', x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), fill: st.fillStyle, pts: P.slice() }); } },
    beginPath() { P.length = 0; }, closePath() {}, save() { TS.push(T.slice()); log.push({ k: 'save' }); }, restore() { const t = TS.pop() || [0, 0]; T[0] = t[0]; T[1] = t[1]; log.push({ k: 'restore' }); } };
  return new Proxy(f, { get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { st[k] = v; return true; } });
}
function zeichneMitLog(v, plan) {
  const log = [], texte = [], orig = R.text;
  R.text = (ctx, str, x, y, o) => { const sk = (o && o.scale) || 1, al = (o && o.align) || 'left', w = R.measure(str, sk), x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x; texte.push({ str: String(str), x, y, scale: sk, color: o && o.color, align: al, x0, x1: x0 + w, y0: y, y1: y + 7 * sk }); };
  const m0 = meldungen.length;
  try { VL.zeichne(neueFlaeche(log), v, plan === undefined ? Vis.plan(v) : plan, cam); } finally { R.text = orig; }
  return { log, texte, meldungen: meldungen.length - m0 };
}

// ------------------------------------------------------------------ Ansicht
function ansicht(o) {
  o = o || {};
  const kurs = o.kurs != null ? o.kurs : 217;
  const ship = Object.assign({ x: 1500, y: 1100, angle: win.Shared_Physics.radAusKompass(kurs), speed: 164, hull: 77, hullMax: 100,
    helm: { stages: [-30, 0, 35, 65, 98, 130], stageNames: ['R', 'STOPP', '¼', '½', '¾', 'VOLL'], stage: 3, stop: 1 }, jump: o.jump === undefined ? { dest: 'Methalle', charge: 0, ready: false, anflug: true } : o.jump }, o.ship || {});
  const f = (vor, seit) => ({ x: ship.x + Math.cos(ship.angle) * vor - Math.sin(ship.angle) * seit, y: ship.y + Math.sin(ship.angle) * vor + Math.cos(ship.angle) * seit });
  const jp = o.jp !== undefined ? o.jp : [Object.assign({ k: '0503-0504', z: 'aktiv', n: '0504' }, f(1200, 0))];
  const space = { w: 6000, h: 6000, so: [], jp, markers: o.markers || [], hidden: [], salvage: [], mines: [] };
  return { time: 1, pid: 'a', me: { console: 'helm' }, ship: null, enemies: o.enemies || [], escorts: [], spaceProjectiles: [],
    state: { time: 1, ship, space, players: [], flotte: {}, inventory: {}, zonen: { in: [], bk: [] }, world: { location: 'kreuzweg' } }, f };
}
const bandRect = { x0: LS.band.rand, x1: W - LS.band.rand };

// ------------------------------------------------------------------ (1) winkeltreu
section('(1) Peilband winkeltreu');
{
  ok(Math.abs(VL.bandX(0, cam) - W / 2) < 1e-9, 'Peilung 0 liegt auf x = ' + W / 2);
  let max = 0, maxMockup = 0, zeilen = 0;
  for (const kurs of [0, 90, 217]) {
    for (const rel of [0, 15, -15, 30, -30]) {
      for (const d of [400, 700, 1500]) {
        const ang = win.Shared_Physics.radAusKompass(kurs), s = { x: 2000, y: 2000, angle: ang }, a = ang + rad(rel);
        const p = Vis.projiziereWelt(s, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 0);
        const wBand = grad(Math.atan2(VL.bandX(rad(rel), cam) - W / 2, cam.F / cam.cp)), wBild = grad(Math.atan2(p.x - W / 2, cam.F / cam.cp));
        const wMock = grad(Math.atan((Math.tan(rad(rel)) * cam.F) / (cam.F / cam.cp)));
        max = Math.max(max, Math.abs(wBand - wBild)); maxMockup = Math.max(maxMockup, Math.abs(wMock - wBild)); zeilen++;
        ok(Math.abs(wBand - wBild) <= 1.5, 'Kurs ' + kurs + ' Peilung ' + rel + ' Entfernung ' + d + ': Bandposition ' + VL.bandX(rad(rel), cam).toFixed(1) + ' px, Bild ' + p.x.toFixed(1) + ' px, Abweichung ' + (wBand - wBild).toFixed(2) + ' Grad');
      }
    }
  }
  ok(max <= 1.5 && zeilen === 45, zeilen + ' Lagen, groesste Abweichung ' + max.toFixed(2) + ' Grad (Grenze 1,5)');
  ok(maxMockup > max, 'Gegenprobe: ohne 1/cos(Neigung) (Mockup-Formel tan(a)*F) waere es schlechter (' + maxMockup.toFixed(2) + ' Grad)');
  const mitte = Vis.projiziereWelt({ x: 0, y: 0, angle: 0 }, 1000, 0, 0);
  ok(Math.abs(mitte.x - VL.bandX(0, cam)) < 1e-9, 'Objekt voraus: Band und Bild auf derselben Spalte');
  // Gegenprobe in Pixeln bei 30 Grad / 700: die echte Formel liegt naeher am Bild als die Mockup-Formel
  const mockup = (a) => W / 2 + Math.tan(a) * cam.F, sp = { x: 0, y: 0, angle: 0 }, pp = Vis.projiziereWelt(sp, Math.cos(rad(30)) * 700, Math.sin(rad(30)) * 700, 0);
  ok(Math.abs(VL.bandX(rad(30), cam) - pp.x) < Math.abs(mockup(rad(30)) - pp.x) / 2, 'bei 30 Grad: Band ' + VL.bandX(rad(30), cam).toFixed(1) + ' px, Mockup-Formel ' + mockup(rad(30)).toFixed(1) + ' px, Bild ' + pp.x.toFixed(1) + ' px');
}

// ------------------------------------------------------------------ (2) Striche
section('(2) Bandstriche und Kurs');
{
  const v = ansicht({ kurs: 217 }), L = VL.lage(v, Vis.plan(v), cam);
  ok(L.kurs === 217, 'Kurs 217 (Shared_Physics.kompassGrad)');
  const t215 = L.ticks.find((t) => t.grad === 215), t220 = L.ticks.find((t) => t.grad === 220);
  ok(t215 && t220 && t215.x < W / 2 && t220.x > W / 2, 'Striche 215 links, 220 rechts der Mitte');
  ok(L.ticks.every((t) => t.x >= bandRect.x0 && t.x <= bandRect.x1), 'alle Striche im Band (x ' + bandRect.x0 + ' … ' + bandRect.x1 + ')');
  ok(L.ticks.every((t) => t.lang === (t.grad % 10 === 0)), 'lang und Zahl alle 10, Strich alle 5');
  ok(L.ticks.filter((t) => t.lang).every((t) => /^\d{3}$/.test(t.text)), 'Gradzahlen dreistellig');
  const n0 = VL.lage(ansicht({ kurs: 0 }), null, cam), n350 = VL.lage(ansicht({ kurs: 355 }), null, cam);
  ok(n0.ticks.find((t) => t.grad === 0 && t.text === 'N') && n0.ticks.find((t) => t.grad === 0).x === Math.round(W / 2), 'Kurs 0: Norden als N genau in der Mitte');
  ok(n350.ticks.some((t) => t.grad === 0 && t.text === 'N' && t.x > W / 2) && n350.ticks.some((t) => t.grad === 350 && t.x < W / 2), 'Kurs 355: N rechts der Mitte, 350 links (Ueberlauf 360 -> 0)');
  // Sichtbarkeit der Bandzahlen: auf jedem Kurs steht mindestens eine Zahl im Band, auf den meisten je eine links und rechts vom Kasten
  let ohne = 0, beide = 0;
  for (let k = 0; k < 360; k++) {
    const zz = zeichneMitLog(ansicht({ kurs: k })), zs = zz.texte.filter((t) => t.scale === 2 && t.y0 === LY + LS.band.zahl.y);
    if (!zs.length) ohne++;
    if (zs.some((t) => t.x < W / 2) && zs.some((t) => t.x > W / 2)) beide++;
  }
  ok(ohne === 0, 'auf jedem der 360 Kurse steht mindestens eine Gradzahl im Band (ohne: ' + ohne + '), links und rechts: ' + beide + ' von 360');
  const l90 = VL.lage(ansicht({ kurs: 90 }), null, cam);
  ok(l90.kurs === 90 && l90.ticks.some((t) => t.grad === 90), 'Kurs 90 (Ost)');
  // Zeichnung: Gradzahl steht unter dem Strich (gleiche Spalte), Kasten haelt Zahlen nahe der Mitte fern
  const z = zeichneMitLog(v);
  const zahlen = z.texte.filter((t) => t.scale === LS.band.zahl.skala && /^\d{3}$/.test(t.str) && t.scale === 2 && t.y0 === LY + LS.band.zahl.y);
  ok(zahlen.length >= 2 && zahlen.every((t) => L.ticks.some((k) => k.x === t.x && k.text === t.str)), 'Gradzahlen (' + zahlen.map((t) => t.str).join(' ') + ') stehen genau unter ihrem Strich');
  const kasten = z.texte.find((t) => t.str === '217' && t.scale === 3);
  ok(kasten && kasten.scale === 3 && kasten.align === 'center' && Math.abs(kasten.x - W / 2) < 1e-9, 'Kurs „217“ Skala 3 mittig im Kasten');
  ok(zahlen.every((t) => t.x1 < kasten.x0 - LS.band.zahl.abstandKasten + 8 || t.x0 > kasten.x1 + LS.band.zahl.abstandKasten - 8), 'Gradzahlen beruehren den Kasten nicht');
}

// ------------------------------------------------------------------ (3) Breiten
section('(3) Text passt');
{
  const stufenNamen = ['R', 'STOPP', '¼', '½', '¾', 'VOLL'];
  let maxEnde = 0;
  for (const tempo of [0, 7, 88, 164, 199]) {
    for (let stage = 0; stage < 6; stage++) {
      const v = ansicht({ ship: { speed: tempo, helm: { stages: [-30, 0, 35, 65, 98, 130], stageNames: stufenNamen, stage, stop: 1 } } }), z = zeichneMitLog(v);
      const tx = z.texte.filter((t) => t.str === String(tempo) && t.scale === 3), wort = z.texte.filter((t) => t.scale === 2 && t.x0 < 130 && t.y0 < LY + 4);
      for (const t of tx.concat(wort)) maxEnde = Math.max(maxEnde, t.x1);
      ok(tx.length === 1 && tx[0].y0 === LY + LS.tempo.y && tx[0].y1 <= H && tx[0].scale === 3, 'Tempo ' + tempo + ' Skala 3, Stufe ' + stage + ': y ' + tx[0].y0 + ' … ' + tx[0].y1 + ' innerhalb des Schirms');
      if (wort.length) ok(wort[0].x1 <= LS.feldBreite && wort[0].x1 <= LS.band.rand - 4, 'Wort „' + wort[0].str + '“ endet bei x ' + wort[0].x1 + ' (Feld ' + LS.feldBreite + ', Band ab ' + LS.band.rand + ')');
    }
  }
  ok(maxEnde <= LS.feldBreite, 'laengster Fall (dreistelliges Tempo + STOPP) endet bei x ' + maxEnde + ' <= ' + LS.feldBreite);
  ok(R.measure('STOPP', 2) <= LS.stufe.maxBreite, 'STOPP ' + R.measure('STOPP', 2) + ' px <= Token maxBreite ' + LS.stufe.maxBreite);
  const v = ansicht({ kurs: 217 }), z = zeichneMitLog(v);
  const k = z.texte.find((t) => t.str === '217' && t.scale === 3), kw = R.measure('217', 3) + 2 * LS.kasten.pad;
  ok(k.y0 >= LY + LS.kasten.y && k.y1 <= H, 'Kurstext y ' + k.y0 + ' … ' + k.y1 + ' im Kasten (' + (LY + LS.kasten.y) + ' … ' + H + ')');
  ok(W / 2 - kw / 2 > LS.feldBreite && W / 2 + kw / 2 < W - LS.band.rand, 'Kasten (' + kw + ' px) steht im Band, nicht im Tempo-Feld');
  const zahlen = z.texte.filter((t) => t.scale === 2 && /^\d{3}$/.test(t.str) && t.scale === 2 && t.y0 === LY + LS.band.zahl.y);
  ok(zahlen.every((t) => t.y1 <= H && t.x0 >= bandRect.x0 && t.x1 <= bandRect.x1), 'Gradzahlen (Skala 2) in Leiste und Band: y ' + zahlen[0].y0 + ' … ' + zahlen[0].y1);
  const texte = z.texte.filter((t) => t.y0 >= LY - 6);
  ok(texte.every((t) => t.x0 >= 0 && t.x1 <= W && t.y1 <= H), 'alle Texte der Leiste liegen im Schirm');
  ok(z.texte.filter((t) => t.str === '217' && t.scale === 3)[0].scale === TK.TEXT.skalaGross && z.texte.some((t) => t.str === '164' && t.scale === TK.TEXT.skalaGross) && z.texte.some((t) => t.str === '½' || t.str === '1/2'), 'Skalen: Kurs und Tempo 3, Schubstufe 2');
}

// ------------------------------------------------------------------ (4) keine Huelle, Hoehe
section('(4) keine Huelle, Leiste 22 px');
{
  const v = ansicht({ ship: { hull: 61, hullMax: 100 } }), z = zeichneMitLog(v);
  ok(!z.texte.some((t) => /HÜLLE|HUELLE|HULL|%$/.test(t.str) && t.y0 >= LY - 6) && !z.texte.some((t) => t.str === '61'), 'kein Hüllenwert, kein Hüllentext in der Leiste');
  const Q = z.log.filter((e) => e.y0 != null && e.y0 >= LY - 8);
  ok(!z.log.some((e) => e.fill && /E0473C/i.test(String(e.fill)) && e.k === 'rect' && e.y0 >= LY), 'keine rote Huellenflaeche (Alarm nur als Streifen)');
  ok(LS.hoehe === 22 && LS.hochfeld === 27, 'Leiste 22 px, Hochfeld 27 px (Tokens)');
  const hoch = z.log.filter((e) => (e.k === 'poly' || e.k === 'rect') && e.y0 < LY && e.y0 >= LY - 8 && e.y1 - e.y0 > 8);
  ok(hoch.every((e) => e.y0 >= H - LS.hochfeld) && hoch.length >= 1, 'hoechstens ' + LS.hochfeld + ' px hoch: ueber der Leiste nur Tempo-Feld (bis x ' + LS.feldBreite + ') und Kasten');
  const darueber = z.log.filter((e) => (e.k === 'poly' || e.k === 'rect') && e.y0 < H - LS.hochfeld - 0.01 && e.y1 > 0 && e.x0 < W && !(e.y0 >= 0 && e.y1 < H - LS.hochfeld));
  void Q; void darueber;
  const leiste = z.log.filter((e) => e.k === 'poly' && e.fill === 'rgba(11,14,26,0.94)' && e.y0 >= H - LS.hochfeld);
  ok(leiste.length === 2 && leiste.some((e) => e.y0 === LY && e.x1 === W) && leiste.some((e) => e.y0 === H - LS.hochfeld && e.x1 === LS.feldBreite), 'Platte: Leiste ab y ' + LY + ' ueber die ganze Breite, Hochfeld ab y ' + (H - LS.hochfeld) + ' nur bis x ' + LS.feldBreite + ' (Skin rom 94 %)');
  const alarm = zeichneMitLog(ansicht({ ship: { alert: 'red' } })), norm = zeichneMitLog(ansicht({}));
  ok(alarm.log.some((e) => e.k === 'rect' && e.y0 === LY && e.fill === LS.farbeAlarm) && norm.log.some((e) => e.k === 'rect' && e.y0 === LY && e.fill === LS.farbe), 'Streifen Bernstein, bei Alarm rot (ship.alert red)');
}

// ------------------------------------------------------------------ (5) oben links frei
section('(5) oben links frei');
{
  for (const o of [{}, { kurs: 0 }, { jump: {} }, { ship: { alert: 'red' } }]) {
    const v = ansicht(o), z = zeichneMitLog(v), grenzeY = LY - 12;
    const geo = z.log.filter((e) => (e.k === 'rect' || e.k === 'poly'));
    const links = geo.filter((e) => e.x0 < W / 2 && e.y0 < grenzeY).concat(z.texte.filter((t) => t.x0 < W / 2 && t.y0 < grenzeY));
    if (links.length) console.log(JSON.stringify(links[0]).slice(0, 200));
    ok(links.length === 0, 'Ansicht ' + JSON.stringify(o) + ': nichts in der linken Haelfte oberhalb y ' + grenzeY + ' (gefunden ' + links.length + ')');
    const tl = geo.filter((e) => e.x0 < 200 && e.y0 < 120).concat(z.texte.filter((t) => t.x0 < 200 && t.y0 < 120));
    ok(tl.length === 0, '  Bereich 200 × 120 oben links leer');
  }
}

// ------------------------------------------------------------------ (6) Marken
section('(6) Marken');
{
  const sicht = (rel, d, obj) => { const t = win.Shared_Physics.radAusKompass(217) + rad(rel); return { x: 1500 + Math.cos(t) * d, y: 1100 + Math.sin(t) * d }; };
  const farbeZu = (L, art) => L.marken.filter((m) => m.art === art);
  // Ziel der Ops (Gegner) 10 Grad rechts
  const g = sicht(10, 800), vz = ansicht({ ship: { target: 'e1' }, enemies: [{ id: 'e1', x: g.x, y: g.y, hull: 40 }], jp: [] });
  let L = VL.lage(vz, Vis.plan(vz), cam);
  let m = farbeZu(L, 'ziel');
  ok(m.length === 1 && m[0].farbe === TK.FARBE.kurs && !m[0].aus && Math.abs(grad(m[0].a) - 10) < 0.01 && Math.abs(m[0].x - VL.bandX(rad(10), cam)) < 1e-6, 'Ziel der Ops: Bernstein, 10 Grad rechts, auf dem Band bei x ' + (m[0] && m[0].x.toFixed(1)));
  // Sprungboje: Messing, Peilung der Tafel
  let vb = ansicht({ jp: [Object.assign({ k: '0503-0504', n: '0504' }, sicht(-12, 1200))] });
  L = VL.lage(vb, Vis.plan(vb), cam); m = farbeZu(L, 'sprungboje');
  ok(m.length === 1 && m[0].farbe === TK.FARBE.sprung && !m[0].aus && Math.abs(grad(m[0].a) + 12) < 0.01 && m[0].x < W / 2, 'Sprungboje: Messing, 12 Grad links, x ' + (m[0] && m[0].x.toFixed(1)));
  ok(farbeZu(VL.lage(ansicht({ jump: {} }), null, cam), 'sprungboje').length === 0, 'ohne Sprungziel keine Bojenmarke');
  // Station: Mint
  const so = sicht(5, 900), vs = ansicht({ markers: [{ kind: 'station', x: so.x, y: so.y, name: 'Hafen' }], jp: [] });
  L = VL.lage(vs, Vis.plan(vs), cam); m = farbeZu(L, 'station');
  ok(m.length === 1 && m[0].farbe === TK.FARBE.schild && Math.abs(grad(m[0].a) - 5) < 0.01, 'Station: Mint, 5 Grad rechts');
  // Stern: Sternmarke
  const stern = sicht(-20, 3000);
  const planStern = { sterne: [{ wx: stern.x, wy: stern.y, peil: rad(-20) }], planeten: [] };
  L = VL.lage(ansicht({ jp: [] }), planStern, cam); m = farbeZu(L, 'stern');
  ok(m.length === 1 && m[0].farbe === TK.EIGEN.sternMarke && m[0].x < W / 2, 'Stern: Sternmarke ' + TK.EIGEN.sternMarke + ' links');
  // Randpfeil: ausserhalb des Bandes (aber vor dem Schiff) und weit seitlich
  for (const rel of [25, 60, -25, -80]) {
    const q = sicht(rel, 900), v = ansicht({ markers: [{ kind: 'station', x: q.x, y: q.y, name: 'Hafen' }], jp: [] });
    const mm = farbeZu(VL.lage(v, null, cam), 'station')[0];
    const links = rel < 0;
    ok(mm && mm.aus && mm.dir === (links ? -1 : 1) && mm.x === (links ? bandRect.x0 : bandRect.x1), 'Peilung ' + rel + ': Pfeil am ' + (links ? 'linken' : 'rechten') + ' Bandende (x ' + (mm && mm.x) + ')');
  }
  const sp = zeichneMitLog(ansicht({ markers: [(() => { const q = sicht(60, 900); return { kind: 'station', x: q.x, y: q.y, name: 'Hafen' }; })()], jp: [] }));
  const pfeil = sp.log.find((e) => e.k === 'poly' && e.fill === TK.FARBE.schild && e.x1 > bandRect.x1);
  ok(pfeil && pfeil.y1 <= LY + 0.001 && pfeil.y0 >= LY - LS.marke.aus.h - 0.001, 'Randpfeil gezeichnet: Spitze ueber das Bandende hinaus (x ' + (pfeil && pfeil.x1) + '), ueber der Leistenkante');
  const inBand = zeichneMitLog(vz).log.find((e) => e.k === 'poly' && e.fill === TK.FARBE.kurs && e.y1 === LY && e.y0 === LY - LS.marke.h);
  ok(inBand && inBand.x1 - inBand.x0 === 2 * LS.marke.halbB, 'Marke im Band: Dreieck ' + 2 * LS.marke.halbB + ' × ' + LS.marke.h + ' px, Spitze auf der Leistenkante');
  // Gegner hinter dem Schiff: nicht auf dem Band
  const h = sicht(170, 500), vh = ansicht({ ship: { target: 'e2' }, enemies: [{ id: 'e2', x: h.x, y: h.y }, { id: 'e3', x: sicht(180, 300).x, y: sicht(180, 300).y }], jp: [] });
  L = VL.lage(vh, Vis.plan(vh), cam);
  ok(farbeZu(L, 'ziel').length === 0 && L.marken.length === 0, 'Gegner (auch als Ziel der Ops) hinter dem Schiff: keine Marke auf dem Band');
  ok(farbeZu(VL.lage(Object.assign(ansicht({ ship: { target: 'station' }, markers: [{ kind: 'station', x: sicht(0, 700).x, y: sicht(0, 700).y, name: 'Hafen' }], jp: [] })), null, cam), 'ziel').length === 1, 'Station als Ziel der Ops: Zielmarke (auch ohne Gegner)');
  ok(L.marken.every((q) => q.x >= bandRect.x0 && q.x <= bandRect.x1), 'alle Marken liegen im Band oder an seinem Ende');
}

// ------------------------------------------------------------------ (7) Robustheit, Anmeldung, Tafel
section('(7) Robustheit, Anmeldung, Sprungziel-Tafel');
{
  ok(angemeldet.length === 1 && angemeldet[0].name === 'leiste' && angemeldet[0].rang === 20 && angemeldet[0].fn === VL.zeichne, 'Schicht „leiste“ (Rang 20) beim Visier angemeldet');
  const faelle = [undefined, null, {}, { state: {} }, { state: { ship: {} } }, { state: { ship: { x: 1, y: 1, angle: NaN } } }, { state: { ship: { x: 1, y: 1, angle: 0 }, space: null } },
    { state: { ship: { x: 1, y: 1, angle: 0, helm: null, jump: { dest: 'X', anflug: true } }, space: { jp: [null, { x: 'a' }] } }, enemies: null }, { state: { ship: { x: 1, y: 1, angle: 0, target: 'e9' }, space: {} }, enemies: [null] }];
  const textAlt = R.text; R.text = () => {};
  let wirft = null, vorher = meldungen.length;
  const log = [], ctx = neueFlaeche(log);
  for (const f of faelle) { try { VL.zeichne(ctx, f, Vis.plan(f), cam); VL.zeichne(ctx, f, undefined, cam); VL.lage(f, null, cam); } catch (e) { wirft = e; } }
  ok(!wirft && meldungen.length === vorher, 'kein Wurf, keine gemeldeten Fehler bei fehlenden Daten' + (wirft ? ' ' + wirft.message : ''));
  R.text = textAlt;
  ok(log.filter((e) => e.k === 'save').length === log.filter((e) => e.k === 'restore').length, 'save/restore ausgeglichen');
  const z = zeichneMitLog({ time: 1, state: { ship: { x: 1, y: 1, angle: 0 }, space: {} }, enemies: [] });
  ok(z.texte.some((t) => t.str === '–') && z.meldungen === 0, 'ohne Tempo/Kurs: Strich statt Wert');
  const mit = zeichneMitLog(ansicht({})), ohne = zeichneMitLog(ansicht({ jump: {} }));
  const tafel = mit.texte.find((t) => /METHALLE/.test(t.str));
  ok(tafel && tafel.x0 > W / 2 && tafel.y0 < 40 && tafel.scale === 2, 'Sprungziel-Tafel oben rechts: „' + (tafel && tafel.str) + '“ Skala 2 bei x ' + (tafel && tafel.x0) + ', y ' + (tafel && tafel.y0));
  const tf = TK.TAFEL.rechts;
  ok(mit.log.some((e) => e.k === 'poly' && e.fill === 'rgba(11,14,26,0.94)' && e.x1 === W + tf.x && e.x1 - e.x0 === tf.w && e.y0 === tf.y), 'Tafel ' + tf.w + ' × ' + tf.h + ' bei x ' + (W + tf.x - tf.w) + ' mit Deckung 94 %');
  ok(!ohne.texte.some((t) => /METHALLE|SPRUNGZIEL/.test(t.str)), 'ohne Sprungziel keine Tafel');
  ok(mit.texte.some((t) => t.str === TK.TEXT.kopf.ziel), 'Tafelkopf „' + TK.TEXT.kopf.ziel + '“ Skala 1');
}

// ------------------------------------------------------------------ (8) Bildschiff statt Snapshot-Schiff (N1 B1)
section('(8) Band, Kasten und Boje lesen dasselbe Schiff wie das Bild (view.ship, interpoliert)');
{
  const v = ansicht({ ship: { target: 'e1' }, jp: [] }), st = v.state.ship, abw = rad(4);
  v.ship = Object.assign({}, st, { angle: st.angle + abw });   // Wende: das Bild (interpoliert, 100 ms zurueck) steht 4 Grad neben dem neuesten Snapshot
  const s = v.ship, a = s.angle + rad(10), ziel = { x: s.x + Math.cos(a) * 800, y: s.y + Math.sin(a) * 800 };
  v.enemies = [Object.assign({ id: 'e1', hull: 40 }, ziel)];
  const L = VL.lage(v, Vis.plan(v), cam), m = L.marken.find((q) => q.art === 'ziel');
  const p = Vis.projiziereWelt(Vis.schiffVon(v), ziel.x, ziel.y, 0);
  const wBand = grad(Math.atan2(m.x - W / 2, cam.F / cam.cp)), wBild = grad(Math.atan2(p.x - W / 2, cam.F / cam.cp));
  ok(Vis.schiffVon(v) === v.ship && Vis.schiffVon({ state: { ship: st } }) === st && Vis.schiffVon(null) === null, 'Visier.schiffVon: view.ship vor Snapshot-Schiff, sonst Rueckfall, sonst null');
  ok(Math.abs(wBand - wBild) <= 1.5, 'Zielmarke liegt bei 4 Grad Schiffsabweichung auf dem Bild-Gegner (Abweichung ' + (wBand - wBild).toFixed(2) + ' Grad, Grenze 1,5)');
  ok(Math.abs(grad(m.a) - 10) < 0.01, 'Peilung der Marke relativ zum Bildschiff: ' + grad(m.a).toFixed(2) + ' Grad (nicht 14 wie vom Snapshot)');
  const kursBild = (((v.ship.angle / rad(1) + 90) % 360) + 360) % 360;
  ok(Math.abs(L.kursExakt - kursBild) < 1e-9 && L.kurs === win.Shared_Physics.kompassGrad(v.ship.angle), 'Kurs-Kasten und Band laufen mit dem Bildschiff (' + L.kurs + ', nicht ' + win.Shared_Physics.kompassGrad(st.angle) + ')');
  const vb = ansicht({ jp: [] }), sb = Object.assign({}, vb.state.ship, { angle: vb.state.ship.angle + abw }), ab = sb.angle + rad(-12), bx = sb.x + Math.cos(ab) * 1200, by = sb.y + Math.sin(ab) * 1200;
  vb.state.space.jp = [{ k: '0503-0504', z: 'aktiv', n: '0504', x: bx, y: by }]; vb.ship = sb;
  const bm = VL.lage(vb, Vis.plan(vb), cam).marken.find((q) => q.art === 'sprungboje'), pb = Vis.projiziereWelt(sb, bx, by, 0);
  ok(bm && Math.abs(grad(Math.atan2(bm.x - W / 2, cam.F / cam.cp)) - grad(Math.atan2(pb.x - W / 2, cam.F / cam.cp))) <= 1.5, 'Sprungboje auf dem Band stimmt ebenfalls mit dem Bild ueberein');
}

// ------------------------------------------------------------------ (9) Szenenzeile und Sprungziel-Tafel (N1 B2)
section('(9) Sprungziel-Tafel rueckt unter die Szenenzeile; Optionen aus EINER Stelle');
{
  win.Hud = { szeneVon: () => true, drawSzenenStrip: () => 420, szenenHoehe: () => 27 };   // breite, hohe Zeile (Vorwarnung): kollidiert mit der rechten Tafel
  try {
    const v = ansicht({}), szene = VL.szenenLage(neueFlaeche([]), v, cam), opt = VL.tafelOptionen(szene), unten = 6 + 27 + 4;
    ok(szene && szene.w === 420 && szene.y === 6 && szene.h === 27 && szene.x === Math.round((W - 420) / 2) && opt.szeneBreite === 420 && opt.szeneUnten === unten, 'Szenenlage und Optionen wie sitz.js tafelOpt (Breite 420, Unterkante ' + opt.szeneUnten + ')');
    const soll = win.HauptschirmTafeln.lage(v, opt).rechts, z = zeichneMitLog(v);
    ok(soll && soll.y >= unten && soll.y > TK.TAFEL.rechts.y, 'Tafel rueckt unter die Zeile (y ' + (soll && soll.y) + ' >= ' + unten + ')');
    const grund = z.log.find((e) => e.k === 'poly' && e.fill === 'rgba(11,14,26,0.94)' && e.x1 - e.x0 === TK.TAFEL.rechts.w);
    ok(grund && soll && grund.y0 === soll.y && grund.x0 === soll.x, 'gezeichnete Tafel steht an der Stelle der Optionen (y ' + (grund && grund.y0) + ')');
    const tafelText = z.texte.find((t) => /METHALLE/.test(t.str));
    ok(tafelText && tafelText.y0 >= unten, 'Tafeltext unterhalb der Szenenzeile (y ' + (tafelText && tafelText.y0) + ')');
    ok(VL.tafelOptionen(null).szeneBreite === 0, 'ohne Szene: Optionen leer');
  } finally { delete win.Hud; }
  const ohne = zeichneMitLog(ansicht({})).log.find((e) => e.k === 'poly' && e.fill === 'rgba(11,14,26,0.94)' && e.x1 - e.x0 === TK.TAFEL.rechts.w);
  ok(ohne && ohne.y0 === TK.TAFEL.rechts.y, 'ohne Szenenzeile bleibt die Tafel oben (y ' + (ohne && ohne.y0) + ')');
}

console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLER' : 'alle ' + n + ' Pruefungen gruen'));
process.exit(fails ? 1 : 0);
