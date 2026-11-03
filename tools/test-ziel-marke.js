'use strict';
// OPS-01 Nacharbeit (Designer G1, G3, G4, G5, G6): Zielmarkierung, Scan-Hinweis, Namensfarbe und Knopfreihe der Captain-Lage. Ops und Captain sehen dasselbe Gefecht gleich gut; es gibt kein Stationsflag.
//   (a) G1 Markierungssprache auf der Karte (Fake-Zeichenfläche, Position und Label): Ops-Taktikkarte wie bisher (Bernstein, „ZIEL“); Lagekarte: Ops-Ziel gedämpft „OPS-ZIEL“, Anzeigeziel des Captains Eisblau „ZIEL“
//       (Gegner, Station, verstecktes Objekt); fallen beide auf dasselbe Objekt, steht ein Zeichen (Eisblau, „ZIEL“); capLage reicht die id aus Consoles.anzeigeZielVon als Option an drawTactical
//   (b) G3 Scan-Hinweis: EINE Regel (scanHinweisArt); der Captain zeigt „nicht gescannt“ nur bei Gegnerschiffen, nie bei Station/verstecktem Objekt; die Ops zeigen ihre Hinweise wie bisher
//   (c) G4 Namensfarbe im Zielkasten nach Art (Gegner Rot, Station/Boje Bernstein, verstecktes Objekt wie sein Kartenlabel), Ops und Captain gleich (eine Funktion)
//   (d) G5 Knopfreihe: „Ziel löschen“ mit Taste Shift+T (tasten.js, Consoles.keyDown, sicht-tasten), Funktionsfarbe Sensoren, aktiv/gesperrt; Abstand zur Reiter-Gruppe
//   (e) G6 Texte: „Scannen halten“, „Keine gescannt. Karte anklicken oder T“
//   node tools/test-ziel-marke.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const DATEN = require('../content/kampf/gegner-systeme.json');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');

// Zeichenfläche: Texte mit Farbe (ohne Schatten), Strichaufrufe mit Farbe und letztem Punkt
function neueFlaeche() {
  const rec = { texte: [], striche: [] };
  const st = { fillStyle: '#000', strokeStyle: '#000', last: [0, 0], tx: 0, ty: 0 };
  const stack = [];
  const f = {
    save() { stack.push([st.tx, st.ty]); }, restore() { const s = stack.pop(); if (s) { st.tx = s[0]; st.ty = s[1]; } }, translate(x, y) { st.tx += x; st.ty += y; },
    moveTo(x, y) { st.last = [x + st.tx, y + st.ty]; }, lineTo(x, y) { st.last = [x + st.tx, y + st.ty]; }, arc(x, y) { st.last = [x + st.tx, y + st.ty]; },
    stroke() { rec.striche.push({ fs: st.strokeStyle, x: st.last[0], y: st.last[1] }); },
    fillText(s, x, y) { if (/^rgba\(11,14,26/.test(st.fillStyle)) return; rec.texte.push({ s: String(s), x: x + st.tx, y: y + st.ty, fs: st.fillStyle }); },
    measureText: (s) => ({ width: String(s).length * 5 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx = new Proxy(f, { get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { st[k] = v; return true; } });
  return { ctx, rec };
}
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
function umgebung(quellen, skin) {
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'), Shared_Schilde: require('../shared/schilde.js'),
    document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null, addEventListener() {} },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: skin ? '?pult=' + skin : '' }, URLSearchParams,
    localStorage: { getItem: () => null, setItem() {} } };
  win.window = win; win.self = win;
  vm.createContext(win);
  win.__fehler = [];
  win.Net = { guard: (w, f, d) => { try { return f(); } catch (e) { win.__fehler.push(w + ': ' + e.message); return d; } }, reportError(w, e) { win.__fehler.push(w + ': ' + (e && e.message)); } };
  win.Hud = new Proxy({}, { get: () => () => 0 });
  for (const f of ['kennung.js', 'render.js', 'pult-systeme-tokens.js', 'zonenkreuz.js', 'zielsysteme.js', 'kartenlogik.js', 'pult.js', 'consoles.js', 'pult-stationen.js', 'tasten.js']) vm.runInContext((quellen && quellen[f]) || read(f), win, { filename: f });
  win.Zielsysteme.store.daten = DATEN;
  return win;
}
const win = umgebung();
const C = win.Consoles, R = win.Render, PAL = R.PAL;

// ---------------------------------------------------------------------------------------------------------------------------------
const SHIP = { x: 1000, y: 0 };
const gegner = () => [
  { id: 'k1', kind: 'korvette', vk: 'ger', x: 1250, y: -150, hp: 50, hpMax: 100, scanned: true, angle: 0, shields: [2, 2, 2, 2] },
  { id: 'k2', kind: 'korvette', vk: 'rom', x: 1250, y: 150, hp: 80, hpMax: 100, scanned: true, angle: 0, shields: [1, 1, 1, 1] },
  { id: 'r1', kind: 'raider', vk: 'pirat', x: 800, y: 200, hp: 10, hpMax: 10, scanned: false, angle: 0, shields: [2, 2, 2, 2] },
];
const HIDDEN = [{ id: 'h1', kind: 'hollow', x: 800, y: -200, found: false }];
const MARKER = [{ id: 'm1', kind: 'station', x: 1050, y: 200, name: 'Hafen' }];
function ansicht(o) {
  o = o || {};
  const en = o.keineGegner ? [] : gegner();
  const ship = Object.assign({ x: SHIP.x, y: SHIP.y, angle: -Math.PI / 2, hull: 100, mounts: [] }, o.ship || {});
  if (o.target !== undefined) ship.target = o.target;
  if (o.cz) ship.cz = o.cz;
  const gesendet = [];
  const space = { enemies: en, hidden: o.hidden || HIDDEN, markers: o.markers || MARKER, w: 6000, h: 6000 };
  return { gesendet, time: 1, me: { console: o.console || 'weapons', id: 'p1' }, pid: 'p1', ship, enemies: en, escorts: [], actions: { sfx() {} }, send(m) { gesendet.push(m); },
    state: { time: 1, players: [], flotte: {}, space, ship } };
}
const RECT = { x: 10, y: 26, w: 440, h: 260 };
function karte(view, mode, extra) {
  const { ctx, rec } = neueFlaeche();
  const res = R.drawTactical(ctx, view, RECT, Object.assign({ zoom: 0.45, mode, arcs: false, intel: true, enemyRects: [], rot: 0 }, extra || {}));
  return { res, rec };
}
const nahe = (rec, s, wo, maxD) => rec.texte.filter((t) => t.s === s && Math.hypot(t.x - wo.x, t.y - wo.y) <= (maxD || 70));
const zaehle = (rec, s) => rec.texte.filter((t) => t.s === s).length;
const DIMM = 'rgba(255,198,107,0.5)';

section('(a) G1: eine Markierungssprache, zwei Besitzer');
{
  // Ops-Taktikkarte: unverändert (Bernstein „ZIEL“), auch mit gesetzter anzeigeZielId wirkt nur die Option, nie die Station
  const v = ansicht({ target: 'k1' });
  const o = karte(v, 'tactical'), p1 = o.res.toS(1250, -150);
  const lz = nahe(o.rec, 'ZIEL', p1);
  ok(lz.length === 1 && lz[0].fs === PAL.amber && !zaehle(o.rec, 'OPS-ZIEL'), 'Ops-Karte: Ziel der Ops mit Bernstein „ZIEL“ am Gegner, kein „OPS-ZIEL“ (' + JSON.stringify(lz.map((t) => [t.fs, Math.round(t.x - p1.x), Math.round(t.y - p1.y)])) + ')');
  ok(o.rec.striche.some((q) => q.fs === PAL.amber && Math.hypot(q.x - p1.x, q.y - p1.y) < 50) && !o.rec.striche.some((q) => q.fs === PAL.ice && Math.hypot(q.x - p1.x, q.y - p1.y) < 50), 'Ops-Karte: Eckklammern in Bernstein, nichts in Eisblau');
  // Lagekarte: Ops-Ziel k1 gedämpft, Anzeigeziel k2 Eisblau
  const v2 = ansicht({ console: 'captain', target: 'k1', cz: { id: 'k2' } });
  const l = karte(v2, 'lage', { anzeigeZielId: 'k2' }), q1 = l.res.toS(1250, -150), q2 = l.res.toS(1250, 150);
  const ops = nahe(l.rec, 'OPS-ZIEL', q1), az = nahe(l.rec, 'ZIEL', q2);
  ok(ops.length === 1 && ops[0].fs === DIMM, 'Lage: Ops-Ziel (k1) gedämpft „OPS-ZIEL“ am Gegner (' + JSON.stringify(ops.map((t) => [t.fs, Math.round(t.x - q1.x), Math.round(t.y - q1.y)])) + ')');
  ok(az.length === 1 && az[0].fs === PAL.ice, 'Lage: Anzeigeziel des Captains (k2) Eisblau „ZIEL“ am Gegner (' + JSON.stringify(az.map((t) => [t.fs, Math.round(t.x - q2.x), Math.round(t.y - q2.y)])) + ')');
  ok(zaehle(l.rec, 'ZIEL') === 1 && zaehle(l.rec, 'OPS-ZIEL') === 1 && !nahe(l.rec, 'ZIEL', q1).length, 'Lage: je ein Zeichen für jedes Ziel, nichts doppelt, kein Bernstein-„ZIEL“ am Ops-Ziel');
  ok(l.rec.striche.some((q) => q.fs === PAL.ice && Math.hypot(q.x - q2.x, q.y - q2.y) < 50) && l.rec.striche.some((q) => q.fs === DIMM && Math.hypot(q.x - q1.x, q.y - q1.y) < 50) && !l.rec.striche.some((q) => q.fs === PAL.amber && Math.hypot(q.x - q1.x, q.y - q1.y) < 50), 'Lage: Eckwinkel Eisblau um k2, gedämpft um k1');
  // beide Ziele dasselbe Objekt: ein Zeichen
  const v3 = ansicht({ console: 'captain', target: 'k1', cz: { id: 'k1' } });
  const g = karte(v3, 'lage', { anzeigeZielId: 'k1' }), r1 = g.res.toS(1250, -150);
  ok(zaehle(g.rec, 'ZIEL') === 1 && zaehle(g.rec, 'OPS-ZIEL') === 0 && nahe(g.rec, 'ZIEL', r1)[0].fs === PAL.ice, 'beide Ziele auf demselben Gegner: ein Zeichen, Eisblau + „ZIEL“, kein „OPS-ZIEL“');
  // ohne Anzeigeziel: nur das gedämpfte Ops-Ziel
  const n0 = karte(ansicht({ console: 'captain', target: 'k1' }), 'lage', {});
  ok(zaehle(n0.rec, 'OPS-ZIEL') === 1 && zaehle(n0.rec, 'ZIEL') === 0, 'Lage ohne Anzeigeziel: nur „OPS-ZIEL“');
  // Station (Hauptobjekt 'station') als Anzeigeziel
  const v4 = ansicht({ console: 'captain', target: 'k1', cz: { id: 'station' } });
  const s4 = karte(v4, 'lage', { anzeigeZielId: 'station' }), ps = s4.res.toS(1050, 200);
  const zs = s4.rec.texte.filter((t) => t.s === 'ZIEL' && Math.hypot(t.x - ps.x, t.y - ps.y) < 120);
  ok(zs.length === 1 && zs[0].fs === PAL.ice && zaehle(s4.rec, 'OPS-ZIEL') === 1, 'Station als Anzeigeziel: Eisblau „ZIEL“ über der Station, Ops-Ziel bleibt „OPS-ZIEL“ (' + JSON.stringify(zs.map((t) => [t.fs, Math.round(t.x - ps.x), Math.round(t.y - ps.y)])) + ')');
  ok(s4.rec.striche.some((q) => q.fs === PAL.ice), 'Station: Ring in Eisblau');
  // Ops-Ziel = Station, Lage: gedämpft; beide = Station: ein Zeichen
  const v5 = ansicht({ console: 'captain', target: 'station', cz: { id: 'station' } });
  const s5 = karte(v5, 'lage', { anzeigeZielId: 'station' });
  ok(zaehle(s5.rec, 'ZIEL') === 1 && zaehle(s5.rec, 'OPS-ZIEL') === 0, 'Station ist Ops-Ziel und Anzeigeziel: ein „ZIEL“');
  const s6 = karte(ansicht({ console: 'captain', target: 'station' }), 'lage', {});
  ok(zaehle(s6.rec, 'OPS-ZIEL') === 1 && zaehle(s6.rec, 'ZIEL') === 0, 'Station nur Ops-Ziel (Lage): gedämpft „OPS-ZIEL“');
  const s7 = karte(ansicht({ target: 'station' }), 'tactical', {}), z7 = s7.rec.texte.filter((t) => t.s === 'ZIEL');
  ok(z7.length === 1 && z7[0].fs === PAL.amber, 'Station als Ops-Ziel auf der Ops-Karte: Bernstein „ZIEL“ wie bisher');
  // verstecktes Objekt als Anzeigeziel
  const v8 = ansicht({ console: 'captain', target: 'k1', cz: { id: 'h1' } });
  const h8 = karte(v8, 'lage', { anzeigeZielId: 'h1' }), ph = h8.res.toS(800, -200);
  const zh = nahe(h8.rec, 'ZIEL', ph, 60);
  ok(zh.length === 1 && zh[0].fs === PAL.ice && h8.rec.striche.some((q) => q.fs === PAL.ice && Math.hypot(q.x - ph.x, q.y - ph.y) < 30), 'verstecktes Objekt als Anzeigeziel: Eisblau „ZIEL“ und Ring (' + JSON.stringify(zh.map((t) => [Math.round(t.x - ph.x), Math.round(t.y - ph.y)])) + ')');
  // Frontsicht: nie Zielzeichen des Captains
  const fl = neueFlaeche(); R.drawFrontView(fl.ctx, ansicht({ target: 'k1' }), { x: 10, y: 26, w: 404, h: 184 });
  ok(!fl.rec.texte.some((t) => /ZIEL/.test(t.s)), 'Frontsicht: keine Zielzeichen (unverändert)');
  // capLage: die Option kommt aus Consoles.anzeigeZielVon
  let opts = null; const orig = R.drawTactical; R.drawTactical = function (c, v, r, o) { opts = o; return orig.apply(this, arguments); };
  const { ctx } = neueFlaeche(); C.tab = 2; C.pultDraw(ctx, ansicht({ console: 'captain', target: 'k1', cz: { id: 'k2' } }), 'captain');
  R.drawTactical = orig;
  ok(opts && opts.mode === 'lage' && opts.anzeigeZielId === 'k2', 'capLage reicht anzeigeZielId aus Consoles.anzeigeZielVon an drawTactical (' + (opts && opts.anzeigeZielId) + ')');
  ok(!/captain|weapons|station/.test((read('render.js').match(/const azId = [^\n]*/) || [''])[0]) && !/fuerCaptain|istCaptain/.test(read('render.js')), 'kein Stationsflag in drawSpace: nur mode und die Option anzeigeZielId');
}

// ---------------------------------------------------------------------------------------------------------------------------------
function zeichnePult(station, view, tab) {
  C.tab = tab == null ? 2 : tab; C.lageRects.length = 0; C.enemyRects.length = 0; win.Render.ui.buttons.length = 0; win.__fehler.length = 0;
  const { ctx, rec } = neueFlaeche();
  C.pultDraw(ctx, view, station);
  return { rec, texte: rec.texte.map((t) => t.s), buttons: win.Render.ui.buttons.slice(), fehler: win.__fehler.filter((x) => !/Lerche\.sprite/.test(x)) };
}

section('(b) G3: Scan-Hinweis nach einer Regel');
{
  ok(typeof C.scanHinweisArt === 'function' && C.scanHinweisArt(null) === null, 'Consoles.scanHinweisArt vorhanden');
  const zo = C.zielAusId(ansicht({}), 'station'), zh = C.zielAusId(ansicht({}), 'h1'), ze = C.zielAusId(ansicht({}), 'r1'), zg = C.zielAusId(ansicht({}), 'k1');
  ok(C.scanHinweisArt(ze) === 'schilde' && C.scanHinweisArt(zo) === 'genau' && C.scanHinweisArt(zh) === 'genau' && C.scanHinweisArt(zg) === null, 'Gegner ungescannt: schilde; Station/verstecktes Objekt: genau; gescannt: null');
  const ps = read('pult-stationen.js');
  ok(ps.split('scanHinweisArt(').length - 1 === 2 && ps.split('zk.hinweis').length - 1 >= 2, 'Ops und Captain lesen dasselbe Feld hinweis aus pultZielkasten (die Art kommt aus einer Funktion)');
  // Station nach dem Landescan (Hinweis „BEAMEN MÖGLICH“ ist im Test test-beam-hinweis) und verstecktes Objekt: Captain ohne Scanzeile
  const cs = zeichnePult('captain', ansicht({ console: 'captain', cz: { id: 'station' } })), ch = zeichnePult('captain', ansicht({ console: 'captain', cz: { id: 'h1' } })), ce = zeichnePult('captain', ansicht({ console: 'captain', cz: { id: 'r1' } }));
  ok(!cs.texte.includes('nicht gescannt') && !ch.texte.includes('nicht gescannt'), 'Captain: Station und verstecktes Objekt ohne „nicht gescannt“');
  ok(ce.texte.includes('nicht gescannt') && !ce.texte.some((t) => /S: scannen|S halten/.test(t)), 'Captain: ungescanntes Gegnerschiff zeigt „nicht gescannt“, nicht den Ops-Hinweis');
  const os = zeichnePult('weapons', ansicht({ target: 'station' })), oh = zeichnePult('weapons', ansicht({ target: 'h1' })), oe = zeichnePult('weapons', ansicht({ target: 'r1' }));
  ok(os.texte.includes('S halten: genauer scannen') && oh.texte.includes('S halten: genauer scannen') && oe.texte.includes('S: scannen für Schilde'), 'Ops: Hinweise wie bisher (Station/verstecktes Objekt: genauer scannen, Gegner: scannen für Schilde)');
  ok(![os, oh, oe, cs, ch, ce].some((x) => x.fehler.length), 'ohne Anzeigefehler');
}

section('(c) G4: Namensfarbe nach Art, eine Funktion');
{
  const nameFs = (res, name) => { const t = res.rec.texte.find((q) => q.s === name); return t && t.fs; };
  const FNW = '#E0473C';
  const oS = zeichnePult('weapons', ansicht({ target: 'station' })), cS = zeichnePult('captain', ansicht({ console: 'captain', cz: { id: 'station' } }));
  const nmS = C.zielAusId(ansicht({}), 'station').name;
  ok(nameFs(oS, nmS) === PAL.amber && nameFs(cS, nmS) === PAL.amber, 'Station/Boje „' + nmS + '“: Name Bernstein bei Ops und Captain (' + nameFs(oS, nmS) + ' / ' + nameFs(cS, nmS) + ')');
  const oH = zeichnePult('weapons', ansicht({ target: 'h1' })), cH = zeichnePult('captain', ansicht({ console: 'captain', cz: { id: 'h1' } }));
  ok(nameFs(oH, 'HOHLRAUM') === PAL.mint && nameFs(cH, 'HOHLRAUM') === PAL.mint, 'verstecktes Objekt: Name in der Farbe seines Kartenlabels (Mint), nicht Rot (' + nameFs(oH, 'HOHLRAUM') + ')');
  const oG = zeichnePult('weapons', ansicht({ target: 'r1' })), cG = zeichnePult('captain', ansicht({ console: 'captain', cz: { id: 'r1' } }));
  const nmG = R.ENEMY_NAMES.raider;
  ok(nameFs(oG, nmG) === FNW && nameFs(cG, nmG) === FNW, 'Gegnerschiff: Name bleibt Rot (' + nameFs(oG, nmG) + ')');
  ok(R.zielNameFarbe({ station: true }) === PAL.amber && R.zielNameFarbe({ id: 'k1', kind: 'raider' }) === null && R.zielNameFarbe({ kind: 'hollow' }, true) === PAL.mint && R.zielNameFarbe({ kind: 'hollow', found: true }, true) === PAL.panelLight, 'Render.zielNameFarbe: Station Bernstein, Gegner null, verstecktes Objekt Mint (erfasst Grau)');
  ok(/R\.zielNameFarbe\(target\)/.test(read('pult-stationen.js')) && /zielNameFarbe\(h, true\)/.test(read('render.js')), 'Kasten und Kartenlabel des versteckten Objekts nutzen dieselbe Farbfunktion');
}

section('(d) G5: Knopfreihe der Captain-Lage');
{
  const T = win.Tasten;
  const a = T.AKTIONEN.find((q) => q.id === 'captain.lage.zielLoeschen');
  ok(a && a.std.join() === 'Shift+KeyT' && a.bereich === 'captain.lage', 'tasten.js: captain.lage.zielLoeschen, Shift+T, Bereich captain.lage (' + JSON.stringify(a && [a.std, a.bereich]) + ')');
  const leer = zeichnePult('captain', ansicht({ console: 'captain' })), mit = zeichnePult('captain', ansicht({ console: 'captain', cz: { id: 'k1' } }));
  const bl = (r) => r.buttons.find((b) => b.label === 'Ziel löschen'), bn = (r) => r.buttons.find((b) => b.label === 'Nächstes Ziel'), tab = (r) => r.buttons.find((b) => b.label === 'Lage');
  ok(bl(leer) && bl(leer).disabled === true && bl(mit) && bl(mit).disabled === false, '„Ziel löschen“: ohne Anzeigeziel gesperrt, mit Anzeigeziel aktiv');
  ok(bl(mit).hotkey && /T/.test(bl(mit).hotkey), 'Tastenkappe vorhanden (' + bl(mit).hotkey + ')');
  ok(bl(mit).y === bn(mit).y && bn(mit).y - (tab(mit).y + tab(mit).h) >= 6, 'Reihe 6 px unter der Reiter-Gruppe (Lücke ' + (bn(mit).y - (tab(mit).y + tab(mit).h)) + ' px)');
  const ps = read('pult-stationen.js');
  ok(/'Ziel löschen', \{ hotkey: 'Shift\+T', aktion: 'captain\.lage\.zielLoeschen', fn: 'sensor'/.test(ps) && /'Nächstes Ziel', \{ hotkey: 'T', aktion: 'captain\.lage\.naechstesZiel', fn: 'sensor'/.test(ps), '„Ziel löschen“ in der Funktionsfarbe Sensoren (Eisblau) wie „Nächstes Ziel“');
  // Farbe im Skin: aktiv in der Funktionsfarbe Sensoren (Eisblau), gesperrt gedämpft – in BEIDEN Skins an den gezeichneten Flächen unterscheidbar
  for (const skin of ['rom', 'germanen']) {
    const farben = (disabled) => {
      const w = umgebung({}, skin), o = neueFlaeche().ctx, fills = [];
      const ctx = new Proxy(o, { get: (t, k) => (k === 'fillRect' || k === 'fill' ? () => fills.push(String(o.fillStyle)) : t[k]), set: (t, k, v) => { o[k] = v; return true; } });
      w.Pult.rahmen(ctx, ansicht({}), { titel: 'T', S: 258, station: 'captain', anzeige() {} }); fills.length = 0;
      w.Pult.knopf(ctx, 62, 300, 107, 14, 'Ziel löschen', { hotkey: 'Shift+T', aktion: 'captain.lage.zielLoeschen', fn: 'sensor', disabled });
      return fills;
    };
    const an = farben(false), aus = farben(true);
    ok(an.includes(PAL.ice) && !aus.includes(PAL.ice) && an.join() !== aus.join(), 'Skin ' + skin + ': aktiv zeichnet die Funktionsfarbe Eisblau (' + PAL.ice + '), gesperrt nicht – Flächen unterscheiden sich');
  }
  // Consoles.keyDown: Shift+T drückt „Ziel löschen“ vor T „Nächstes Ziel“
  const v = ansicht({ console: 'captain', cz: { id: 'k1' } });
  zeichnePult('captain', v); v.gesendet.length = 0;
  C.keyDown({ code: 'KeyT', shiftKey: true, repeat: false, preventDefault() {} }, v);
  ok(v.gesendet.length === 1 && v.gesendet[0].c === 'captain.anzeigeziel' && v.gesendet[0].id === null, 'Shift+T im Reiter Lage löscht das Anzeigeziel (captain.anzeigeziel mit id null)');
  zeichnePult('captain', v); v.gesendet.length = 0; v.state.ship.cz = null;
  C.keyDown({ code: 'KeyT', shiftKey: false, repeat: false, preventDefault() {} }, v);
  ok(v.gesendet.length === 1 && v.gesendet[0].id === C.targetList(v)[0].id, 'T wählt weiter das nächste Ziel (' + (v.gesendet[0] && v.gesendet[0].id) + ')');
  ok(/'Shift\+KeyT', 'captain\.anzeigeziel'/.test(fs.readFileSync(path.join(ROOT, 'tools', 'sicht-tasten.js'), 'utf8')), 'tools/sicht-tasten.js PLAN: Shift+T erwartet captain.anzeigeziel');
}

section('(e) G6: Texte');
{
  const cp = zeichnePult('captain', ansicht({ console: 'captain', keineGegner: true }));
  ok(cp.buttons.some((b) => b.label === 'Scannen halten') && !cp.buttons.some((b) => /\(halten\)/.test(b.label)), 'Scan-Knopf „Scannen halten“ (ohne Klammern)');
  const src = read('consoles.js');
  ok(/'Scanne … halten' : 'Scannen halten'/.test(src) && !/Scann(e|en)[^']*\(halten\)/.test(src), 'consoles.js: beide Zustände ohne Klammern');
  ok(/R\.wrap\('Keine gescannt\. Karte anklicken oder T', rw, 1\)/.test(src), 'consoles.js: „Keine gescannt. Karte anklicken oder T“');
  const breiten = [60, 80, 100, 114, 130], umbr = breiten.map((w) => R.wrap('Keine gescannt. Karte anklicken oder T', w, 1));
  ok(umbr.every((z) => z.every((l) => l.length >= 3 || z.length === 1)), 'Umbruch bei 60–130 px: kein verwaistes Zeichen am Zeilenende/-anfang (' + JSON.stringify(umbr.slice(0, 3)) + ')');
}

console.log('\ntest-ziel-marke: ' + (n - fails) + '/' + n + ' ok');
process.exit(fails ? 1 : 0);
