'use strict';
// KUL-03 E: Skins Rom und Germanen fuer Leiste und Sprungziel-Tafel des Visiers (public/js/visier-leiste.js skinVon, hauptschirm-tafeln.js zeichneSprungziel), echte Skripte im vm, Aufrufprotokoll als Zeichenflaeche.
//   (1) Skinwahl skinVon(view): Schiffsvolk im Snapshot (volk/skin/pult, Klasse ueber CONFIG.shipClasses.pult) schlaegt alles; Pult.skinId nur als Letztes; unbekannt/fehlend -> 'rom'
//   (2) Leiste und Tafel zeichnen fuer beide Skins ohne Wurf; Plattenfarben verschieden (Rom 94 % Tiefraum, Germanen 94 % Eisen), Wolfszahn/Nieten nur bei Germanen
//   (3) gleiche Funktion: Texte (Wert, Position, Skala) in beiden Skins gleich, nur der Tafelkopf rueckt beim Schildbuckel
//   (4) Skalenzuordnung gegen die tatsaechlichen Zeichenaufrufe: Kurs und Tempo 3; Peilband-Zahlen, Schubstufe, Sprungziel, Boje + Entfernung 2; Lagescheibe ohne Text; Tokens der Objekt-Texte (B2)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');

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
  targetOf() { return null; },
};
vm.runInContext(rd('visier-leiste.js'), win, { filename: 'visier-leiste.js' });
vm.runInContext(rd('visier-lage.js'), win, { filename: 'visier-lage.js' });
const VL = win.VisierLeiste, Vis = win.Visier, TK = win.HauptschirmTokens.TOKENS, LS = TK.VISIER.leiste, SKIN = TK.VISIER.skin, W = TK.SCHIRM.w, H = TK.SCHIRM.h, LY = H - LS.hoehe, cam = Vis.kamera(), R = win.Render;

function neueFlaeche(log) {
  const st = { fillStyle: '#000', strokeStyle: '#000', font: '8px monospace', lineWidth: 1 };
  const grad = { addColorStop() {} }, P = [];
  const f = { measureText: (s) => ({ width: String(s).length * 5 }), createLinearGradient: () => grad, createRadialGradient: () => grad,
    fillRect(x, y, w, h) { log.push({ k: 'rect', x0: x, y0: y, x1: x + w, y1: y + h, fill: st.fillStyle }); },
    moveTo(x, y) { P.length = 0; P.push([x, y]); }, lineTo(x, y) { P.push([x, y]); },
    arc(x, y, r) { P.length = 0; P.push([x - r, y - r], [x + r, y + r]); },
    fill() { if (P.length) { const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]); log.push({ k: 'poly', x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), fill: st.fillStyle }); } },
    beginPath() { P.length = 0; }, closePath() {}, save() { log.push({ k: 'save' }); }, restore() { log.push({ k: 'restore' }); } };
  return new Proxy(f, { get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { st[k] = v; return true; } });
}
function zeichneMitLog(v) {
  const log = [], texte = [], orig = R.text;
  R.text = (ctx, str, x, y, o) => { const sk = (o && o.scale) || 1, al = (o && o.align) || 'left', w = R.measure(str, sk), x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x; texte.push({ str: String(str), x, y, scale: sk, color: o && o.color, align: al, x0, x1: x0 + w }); };
  const m0 = meldungen.length;
  try { VL.zeichne(neueFlaeche(log), v, Vis.plan(v), cam); } finally { R.text = orig; }
  return { log, texte, meldungen: meldungen.length - m0 };
}
function ansicht(ship) {
  const kurs = 217, ang = win.Shared_Physics.radAusKompass(kurs);
  const s = Object.assign({ x: 1500, y: 1100, angle: ang, speed: 164, hull: 77, hullMax: 100, helm: { stages: [-30, 0, 35, 65, 98, 130], stageNames: ['R', 'STOPP', '¼', '½', '¾', 'VOLL'], stage: 3, stop: 1 },
    jump: { dest: 'Methalle', charge: 0, ready: false, anflug: true } }, ship || {});
  const jp = [{ k: '0503-0504', z: 'aktiv', n: '0504', x: s.x + Math.cos(ang) * 1200, y: s.y + Math.sin(ang) * 1200 }];
  return { time: 1, pid: 'a', me: { console: 'helm' }, ship: null, enemies: [], escorts: [], spaceProjectiles: [],
    state: { time: 1, ship: s, space: { w: 6000, h: 6000, so: [], jp, markers: [], hidden: [], salvage: [], mines: [] }, players: [], flotte: {}, inventory: {}, zonen: { in: [], bk: [] }, world: { location: 'kreuzweg' } } };
}
const ROM = 'rgba(11,14,26,0.94)', GER = 'rgba(26,22,20,0.94)';

// ------------------------------------------------------------------ (1) Skinwahl
section('(1) Skinwahl: Schiffsvolk im Snapshot, Pult nur als Letztes');
{
  const skin = (ship) => VL.skinVon(ansicht(ship));
  delete win.Pult;
  ok(skin({ volk: 'rom' }) === 'rom', 'Schiffsvolk rom -> rom');
  ok(skin({ volk: 'germanen' }) === 'germanen', 'Schiffsvolk germanen -> germanen');
  ok(skin({ volk: 'ger' }) === 'germanen', 'Kennung ger (CONFIG.kennung.voelker) -> germanen');
  ok(skin({ skin: 'germanen' }) === 'germanen' && skin({ pult: 'germanen' }) === 'germanen', 'Feld skin / pult im Schiff -> germanen');
  const CK = win.Shared_Config.shipClasses; CK.testgerm = { pult: 'germanen' };
  try { ok(skin({ klasse: 'testgerm' }) === 'germanen', 'Schiffsklasse mit pult: germanen (CONFIG.shipClasses) -> germanen'); } finally { delete CK.testgerm; }
  ok(skin({ klasse: 'lerche' }) === 'rom', 'Lerche (kein pult) -> rom');
  ok(skin({ volk: 'klingonen' }) === 'rom' && skin({ volk: 42 }) === 'rom', 'unbekanntes Volk -> Rueckfall rom');
  ok(skin({}) === 'rom' && VL.skinVon(null) === 'rom' && VL.skinVon(undefined) === 'rom' && VL.skinVon({ state: {} }) === 'rom', 'fehlend (kein Volk, kein Schiff, keine Ansicht) -> rom');
  // Pult nur als Letztes
  let pultWert = 'germanen'; win.Pult = { skinId: () => pultWert };
  ok(skin({}) === 'germanen', 'kein Schiffsvolk im Snapshot, Pult.skinId germanen -> germanen (letzte Stufe)');
  ok(skin({ volk: 'rom' }) === 'rom', 'Schiffsvolk rom schlaegt Pult.skinId germanen (kein client-lokaler Unterschied, wo der Snapshot es sagt)');
  pultWert = 'rom'; ok(skin({ volk: 'germanen' }) === 'germanen', 'Schiffsvolk germanen schlaegt Pult.skinId rom');
  pultWert = 'mongolen'; ok(skin({}) === 'rom', 'Pult.skinId unbekannt -> rom');
  win.Pult = { skinId() { throw new Error('kaputt'); } }; ok(skin({}) === 'rom', 'Pult.skinId wirft -> rom, kein Wurf');
  delete win.Pult;
}

// ------------------------------------------------------------------ (2) Zeichnen beider Skins
section('(2) Leiste und Tafel zeichnen in beiden Skins');
const zr = zeichneMitLog(ansicht({ volk: 'rom' })), zg = zeichneMitLog(ansicht({ volk: 'germanen' }));
{
  ok(zr.meldungen === 0 && zg.meldungen === 0, 'kein Wurf, keine gemeldeten Fehler in beiden Skins');
  const sr = (z, k) => z.log.filter((e) => e.k === k).length;
  ok(sr(zr, 'save') === sr(zr, 'restore') && sr(zg, 'save') === sr(zg, 'restore'), 'save/restore ausgeglichen');
  const leiste = (z, f) => z.log.filter((e) => e.k === 'poly' && e.fill === f && e.y0 >= H - LS.hochfeld);
  const tafel = (z, f) => z.log.filter((e) => e.k === 'poly' && e.fill === f && e.y0 === TK.TAFEL.rechts.y);
  ok(SKIN.rom.platte.farbe !== SKIN.germanen.platte.farbe, 'Tokens: Plattenfarben verschieden (' + SKIN.rom.platte.farbe + ' / ' + SKIN.germanen.platte.farbe + ')');
  ok(leiste(zr, ROM).length === 2 && leiste(zr, GER).length === 0, 'Rom: Leistenplatte ' + ROM + ', keine Eisenplatte');
  ok(leiste(zg, GER).length === 2 && leiste(zg, ROM).length === 0, 'Germanen: Leistenplatte ' + GER + ', keine Rom-Platte');
  ok(tafel(zr, ROM).length === 1 && tafel(zr, GER).length === 0, 'Rom: Tafelplatte ' + ROM);
  ok(tafel(zg, GER).length === 1 && tafel(zg, ROM).length === 0, 'Germanen: Tafelplatte ' + GER);
  const farbe = (z, c) => z.log.filter((e) => e.k === 'rect' && e.fill === c).length;
  ok(farbe(zg, SKIN.germanen.rand.farbe) >= 4 && farbe(zg, SKIN.germanen.niete.farbe) >= 6 && farbe(zr, SKIN.germanen.rand.farbe) === 0 && farbe(zr, SKIN.germanen.niete.farbe) === 0, 'Eisenrand und Nieten nur bei Germanen (Rand ' + farbe(zg, SKIN.germanen.rand.farbe) + ', Nieten ' + farbe(zg, SKIN.germanen.niete.farbe) + ')');
  const zahn = (z) => z.log.filter((e) => e.k === 'rect' && e.fill === LS.farbe && e.y1 - e.y0 === 1 && e.x1 - e.x0 <= 4).length;
  ok(zahn(zg) > 30 && zahn(zr) === 0, 'Wolfszahn-Band in der Funktionsfarbe nur bei Germanen (' + zahn(zg) + ' Zaehne)');
  ok(zr.log.some((e) => e.k === 'rect' && e.y0 === LY && e.fill === LS.farbe && e.x1 - e.x0 === W - 2 * LS.schraege), 'Rom: durchgehender Streifen (Funktionsfarbe) auf der Leiste');
  const hex = SKIN.rom.kante.farbe, kf = 'rgba(' + [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)].join(',') + ',' + SKIN.rom.kante.alpha + ')';
  ok(farbe(zr, kf) === 2 && farbe(zg, kf) === 0, 'Rom: Kante (Fuss der Leiste und Innenkante des Tempo-Felds), damit die Platte lesbar bleibt; Germanen traegt statt dessen den Eisenrand');
  const al = zeichneMitLog(ansicht({ volk: 'germanen', alert: 'red' }));
  ok(al.log.some((e) => e.k === 'rect' && e.fill === LS.farbeAlarm && e.y0 < LY + 3) && !zg.log.some((e) => e.k === 'rect' && e.fill === LS.farbeAlarm), 'Germanen: Alarm faerbt das Wolfszahn-Band rot (Funktion gleich in allen Skins)');
  const ohne = zeichneMitLog(ansicht({ volk: 'germanen', jump: {} }));
  ok(!ohne.texte.some((t) => /SPRUNGZIEL|METHALLE/.test(t.str)) && tafel(ohne, GER).length === 0, 'ohne Sprungziel keine Tafel, auch nicht im Skin Germanen');
}

// ------------------------------------------------------------------ (3) gleiche Funktion
section('(3) gleiche Funktion: gleiche Texte und Positionen in beiden Skins');
{
  const werte = (z) => z.texte.filter((t) => t.scale !== TK.TEXT.skalaKopf).map((t) => [t.str, t.x, t.y, t.scale, t.color].join('|'));
  ok(werte(zr).length >= 6 && JSON.stringify(werte(zr)) === JSON.stringify(werte(zg)), 'alle Texte ab Skala 2 (' + werte(zr).length + ') in Text, Position, Skala und Farbe identisch');
  const kr = zr.texte.filter((t) => t.scale === TK.TEXT.skalaKopf), kg = zg.texte.filter((t) => t.scale === TK.TEXT.skalaKopf);
  ok(kr.length === 1 && kg.length === 1 && kr[0].str === kg[0].str && kr[0].y === kg[0].y, 'Tafelkopf "' + (kg[0] && kg[0].str) + '" gleicher Text und gleiche Zeile (Rom x ' + kr[0].x + ', Germanen x ' + kg[0].x + ': rueckt hinter den Buckel)');
  ok(kg[0].color === TK.TAFEL.rechts.farbe && kr[0].color === TK.TAFEL.kappe.farbeText, 'Kopf: Rom dunkel auf Funktionsflaeche, Germanen Funktionsfarbe neben dem Buckel');
  const marken = (z) => z.log.filter((e) => e.k === 'poly' && e.y1 === LY && e.y0 === LY - LS.marke.h).length;
  ok(marken(zr) === marken(zg) && marken(zr) >= 1, 'Marken auf dem Band in beiden Skins gleich (' + marken(zr) + ')');
}

// ------------------------------------------------------------------ (4) Skalen
section('(4) Skalen: Kurs und Tempo 3, alles andere Skala 2');
{
  const GROSS = TK.TEXT.skalaGross, WERT = TK.TEXT.skalaWert, BESCHR = TK.TEXT.skalaBeschriftung;
  ok(GROSS === 3 && WERT === 2 && BESCHR === 2, 'Tokens: skalaGross ' + GROSS + ', skalaWert ' + WERT + ', skalaBeschriftung ' + BESCHR);
  for (const [name, z] of [['Rom', zr], ['Germanen', zg]]) {
    const t = z.texte, f = (fn) => t.filter(fn);
    const kurs = f((x) => x.str === '217'), tempo = f((x) => x.str === '164'), stufe = f((x) => x.str === '1/2'), band = f((x) => /^\d{3}$/.test(x.str) && x.str !== '217' && x.y > LY);
    ok(kurs.length === 1 && kurs[0].scale === GROSS, name + ': Kurs 217 Skala ' + (kurs[0] && kurs[0].scale));
    ok(tempo.length === 1 && tempo[0].scale === GROSS, name + ': Tempo 164 Skala ' + (tempo[0] && tempo[0].scale));
    ok(stufe.length === 1 && stufe[0].scale === WERT, name + ': Schubstufe 1/2 Skala ' + (stufe[0] && stufe[0].scale));
    ok(band.length >= 2 && band.every((x) => x.scale === BESCHR), name + ': Peilband-Zahlen (' + band.map((x) => x.str).join(' ') + ') Skala ' + (band[0] && band[0].scale));
    const ziel = f((x) => x.str === 'METHALLE'), boje = f((x) => /^BOJE/.test(x.str));
    ok(ziel.length === 1 && ziel[0].scale === WERT, name + ': Sprungziel METHALLE Skala ' + (ziel[0] && ziel[0].scale));
    ok(boje.length === 1 && /\d{3,4}$/.test(boje[0].str) && boje[0].scale === WERT, name + ': Boje + Entfernung "' + (boje[0] && boje[0].str) + '" Skala ' + (boje[0] && boje[0].scale));
    ok(t.filter((x) => x.scale === TK.TEXT.skalaKopf).length === 1, name + ': einzige Skala-1-Schrift ist der Tafelkopf (Kappe)');
    ok(t.every((x) => x.scale === 1 || x.scale === 2 || x.scale === 3), name + ': nur ganzzahlige Skalen 1 bis 3');
  }
  // Lagescheibe: Zeichnen ohne Text
  const log = [], texte = [], orig = R.text; R.text = (c, s, x, y, o) => { texte.push({ str: s, scale: o && o.scale }); };
  const v = ansicht({ volk: 'rom' });
  try { win.VisierLage.zeichne(neueFlaeche(log), v, win.VisierLage.plan ? win.VisierLage.plan(v, cam) : null, cam); } finally { R.text = orig; }
  ok(log.length > 0 && texte.length === 0, 'Lagescheibe zeichnet (' + log.length + ' Aufrufe) ohne jeden Text: keine Skala zu pruefen');
  // Texte der Objekte (visier-objekte.js, Paket B2): Skala laut Tokens
  const O = TK.VISIER.objekt;
  ok(O.gegner.ziel.label.skala === 2 && O.station.label.skala === 2 && O.station.label.entfernungSkala === 2 && O.station.dock.label.skala === 2, 'Tokens Objekt-Texte: ZIEL + Entfernung, Stationsname, Entfernung zur Station, DOCK-RING alle Skala 2');
  ok(O.boje.sprung.label.skala === 2 && O.boje.nav.label.skala === 2 && O.randpfeil.label.skala === 2, 'Tokens: Sprungboje, NAV, Randpfeil Skala 2');
  ok(TK.VISIER.glas.ringe.wert.skala === 1 && O.boje.sprung.label.entfernungSkala === 1, 'Ausnahmen laut Mockup (Hilfe, keine Meldung): Ringwerte und Boje-Entfernung im Bild Skala 1');
}

console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLER' : 'alle ' + n + ' Pruefungen gruen'));
process.exit(fails ? 1 : 0);
