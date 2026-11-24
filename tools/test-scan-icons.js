'use strict';
// SPT-02 6 „Scan-Anzeige mit Symbolen“ (Richtung B Stapel, Kai 2026-11-24): der Zielkasten zeigt die Systeme des gescannten Gegners als Symbole statt Kürzel (WBg, ESt, Antr …).
// Geprüft: (a) Art -> Symbolmaske und Name, jede Maske gibt es (SYMBOLE_MODUL bzw. Waffenkatalog), die vier Masken der Arten Emitter, Antrieb, Reaktor, Schildgenerator;
// (b) Stapel im echten Zonenkreuz (Hook inhalt): gleiche Arten einer Seite in einer Zeile mit Zähler und einem Balkenstück je Einheit, Zerstört als Form (Kreuz über dem Symbol,
// 1-px-Strich), Rahmen um das gewählte Balkenstück, Überlauf „+n“, keine Kürzel und kein Prozentwert im Bild; (c) Tooltip „Name · Seite / Zustand · Prozent“;
// (d) im echten Pult (Consoles.pultZielkasten, Ops): Symbole je Art, Tooltip unter der Maus, Systemziel-Knopf mit Symbol und Namen, keine Kürzel.
// Mutationsprobe: tools/mutation-scan-icons.js (ZIELSTAPEL_DATEI bzw. SCAN_ICONS_QUELLE/SCAN_ICONS_FUER ersetzen eine Quelldatei).
//   node tools/test-scan-icons.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');
const DATEN = require('../content/kampf/gegner-systeme.json');
const SCH = require('../shared/schiffskatalog.js');
const PS = require('../public/js/pult-systeme-tokens.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const read = (f) => fs.readFileSync(path.join(JS, f), 'utf8').replace(/\r\n/g, '\n');   // Quelldateien sind CRLF
// Quelle ersetzen (Mutationsprobe): ZIELSTAPEL_DATEI = Ersatz für zielstapel.js, SCAN_ICONS_QUELLE + SCAN_ICONS_FUER = Ersatz für eine andere Client-Datei
const quelle = (f) => {
  if (f === 'zielstapel.js' && process.env.ZIELSTAPEL_DATEI) return fs.readFileSync(process.env.ZIELSTAPEL_DATEI, 'utf8');
  if (process.env.SCAN_ICONS_FUER === f && process.env.SCAN_ICONS_QUELLE) return fs.readFileSync(process.env.SCAN_ICONS_QUELLE, 'utf8');
  return read(f);
};
// zielstapel.js als Node-Modul laden (relative require wie am Originalort)
function ladeModul(f) {
  const pfad = path.join(JS, f), m = new Module(pfad, module);
  m.filename = pfad; m.paths = Module._nodeModulePaths(path.dirname(pfad));
  m._compile(quelle(f), pfad);
  return m.exports;
}
const ZST = ladeModul('zielstapel.js');
const ZK = ladeModul('zonenkreuz.js');
const F = PS.farben('rom'), MASS = PS.TOKENS.MASS, STP = MASS.stapel, TEXT = PS.TOKENS.TEXT;
const TEXT_LEER = PS.TOKENS.ZEICHEN.leer;
const ALLE_KURZ = new Set(); for (const k of Object.values(DATEN.klassen)) for (const d of k.systeme) ALLE_KURZ.add(d.kurz);

// ---------------------------------------------------------------------------------------------------------------------------------
section('(a) Art, Symbolmaske, Name');
{
  const sys = (kl, id) => DATEN.klassen[kl].systeme.find((d) => d.id === id);
  const D = (kl, id, ziel) => ZST.info(sys(kl, id), ziel);
  ok(D('kreuzer', 'emitter_bb').maske === 'emitter' && D('kreuzer', 'antrieb').maske === 'antrieb' && D('kreuzer', 'reaktor').maske === 'reaktor' && D('kreuzer', 'schildgenerator').maske === 'schildgenerator',
    'Masken: Emitter, Antrieb, Reaktor, Schildgenerator je eine eigene');
  ok(D('kreuzer', 'modul_krankenstation').maske === 'krankenstation' && D('kreuzer', 'modul_werkstatt').maske === 'werkstatt' && D('kreuzer', 'modul_frachtraum').maske === 'frachtraum', 'Module: Maske = Modul-Id');
  const ziel = { weapons: [{ platz: 'bug', typ: 'lanze' }, { platz: 'bug2', typ: 'batterie' }, { platz: 'stbd1', typ: 'lanze' }, { platz: 'stbd2', typ: 'batterie' }, { platz: 'stbd3', typ: 'batterie' }] };
  ok(D('kreuzer', 'waffe_bug', ziel).maske === 'waffe:lanze' && D('kreuzer', 'waffe_bug2', ziel).maske === 'waffe:standardkanone', 'Waffe am Bug: Lanze bzw. Kanone aus target.weapons');
  ok(D('kreuzer', 'waffe_stbd1', ziel).maske === 'waffe:lanzenbatterie' && D('kreuzer', 'waffe_stbd2', ziel).maske === 'waffe:standardbatterie', 'Waffe an der Seite: Lanzenbatterie bzw. Batterie');
  ok(D('raider', 'waffe_bug', { weapons: [{ facing: 0 }] }).maske === 'waffe:standardkanone' && D('raider', 'waffe_bug', null).maske === 'waffe:standardkanone', 'Jäger ohne Platzangabe: Standardkanone am Bug');
  ok(D('kreuzer', 'waffe_stbd2', null).maske === 'waffe:standardbatterie', 'ohne weapons: Standardbatterie an der Seite');
  const namen = {
    kurz: [['kreuzer', 'waffe_bug', 'Lanze Bug 1', ziel], ['kreuzer', 'waffe_bug2', 'Kanone Bug 2', ziel], ['kreuzer', 'waffe_stbd2', 'Batterie Stb 2', ziel], ['kreuzer', 'waffe_stbd1', 'Lanzenbatterie Stb 1', ziel],
      ['kreuzer', 'reaktor', 'Reaktor', ziel], ['kreuzer', 'antrieb', 'Antrieb', ziel], ['kreuzer', 'emitter_bb', 'Emitter Bb', ziel], ['kreuzer', 'schildgenerator', 'Schildgenerator', ziel], ['raider', 'waffe_bug', 'Kanone Bug', null]],
  };
  for (const [kl, id, soll, z] of namen.kurz) ok(D(kl, id, z).kurzName === soll, `Knopfname ${id}: „${soll}“ (${D(kl, id, z).kurzName})`);
  ok(D('kreuzer', 'waffe_stbd2', ziel).langName === 'Batterie · Steuerbord 2' && D('kreuzer', 'antrieb', ziel).langName === 'Antrieb' && D('kreuzer', 'emitter_bb', ziel).langName === 'Emitter · Backbord', 'Tooltip-Name: Art · Seite Nummer, Antrieb und Mitte ohne Seite');
  // jede Maske hat Pixel: Module/Arten in SYMBOLE_MODUL (10×10), Waffen im Katalog (SYMBOLE)
  const tokenQ = read('pult-terminal-tokens.js'), block = /const SYMBOLE_MODUL = \{([\s\S]*?)\n  \};/.exec(tokenQ);
  const masken = {}; if (block) for (const m of block[1].matchAll(/^\s*(\w+): \[((?:'[^']*',? ?){10})\]/gm)) masken[m[1]] = m[2].match(/'([^']*)'/g).map((s) => s.slice(1, -1));
  ok(Object.keys(masken).length >= 7, 'SYMBOLE_MODUL: ' + Object.keys(masken).join(' '));
  ok(Object.keys(masken).every((k) => masken[k].length === 10 && masken[k].every((r) => /^[.#+ow]{10}$/.test(r))), 'alle Symbole 10 × 10 im Format . # + o w');
  let fehlt = [], gesehen = new Set();
  for (const k of Object.values(DATEN.klassen)) for (const d of k.systeme) {
    const I = ZST.info(d, { weapons: [{ platz: d.platz, typ: 'lanze' }, { platz: d.platz, typ: 'batterie' }] });
    gesehen.add(I.maske);
    if (I.maske.indexOf('waffe:') === 0) { const w = SCH.BY_ID[I.maske.slice(6)]; if (!w || !SCH.SYMBOLE[w.symbol]) fehlt.push(I.maske); } else if (!masken[I.maske]) fehlt.push(I.maske);
  }
  ok(fehlt.length === 0, 'jede Art aller Klassen hat eine Symbolmaske (' + [...gesehen].join(' ') + (fehlt.length ? '; fehlt: ' + fehlt.join(' ') : '') + ')');
  ok(['emitter', 'antrieb', 'reaktor', 'schildgenerator'].every((m) => masken[m] && gesehen.has(m)), 'die vier Masken der Arten gibt es und die Daten benutzen sie');
  ok(new Set(['emitter', 'antrieb', 'reaktor', 'schildgenerator'].map((m) => masken[m].join('|'))).size === 4, 'die vier Masken unterscheiden sich');
  ok(ZST.ART_FARBE.waffe === PS.TOKENS.FN.weapon && ZST.ART_FARBE.emitter === PS.TOKENS.FN.shield && ZST.ART_FARBE.antrieb === PS.TOKENS.FN.drive && ZST.ART_FARBE.modul === PS.TOKENS.FN.neutral, 'Symbolfarben aus den Funktionsfarben (Rot Waffen, Mint Schild, Bernstein Antrieb, Neutral Module)');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('(c) Tooltip-Text');
{
  const kl = DATEN.klassen.kreuzer, d = kl.systeme.find((q) => q.id === 'waffe_stbd2'), ziel = { weapons: [{ platz: 'stbd2', typ: 'batterie' }] };
  const I = ZST.info(d, ziel), e = (zust, pct) => ({ zust, pct });
  ok(ZST.tooltipText(I, e('besch', 40)) === 'Batterie · Steuerbord 2\nbeschädigt · 40 %', 'beschädigt: „Batterie · Steuerbord 2“ / „beschädigt · 40 %“ (' + JSON.stringify(ZST.tooltipText(I, e('besch', 40))) + ')');
  ok(ZST.tooltipText(I, e('ok', 100)) === 'Batterie · Steuerbord 2\nheil · 100 %', 'heil: „heil · 100 %“');
  ok(ZST.tooltipText(I, e('ok', 50)) === 'Batterie · Steuerbord 2\nbeschädigt · 50 %', 'bis 50 % zählt als beschädigt (wie die Farbe des Balkens)');
  ok(ZST.tooltipText(I, e('zer', 0)) === 'Batterie · Steuerbord 2\nzerstört', 'zerstört: ohne Prozentwert');
  const R = { ui: { mouse: { x: 12, y: 8 }, tooltip: null } };
  const zellen = [{ x: 10, y: 5, w: 6, h: 6, e: e('besch', 40), info: I }, { x: 30, y: 5, w: 6, h: 6, e: e('ok', 100), info: I }];
  const z = ZST.tooltipSetzen(R, zellen);
  ok(z === zellen[0] && R.ui.tooltip && R.ui.tooltip.text === ZST.tooltipText(I, e('besch', 40)) && R.ui.tooltip.x === 12 && R.ui.tooltip.y === 8, 'tooltipSetzen: die Fläche unter der Maus bestimmt den Text, Stelle = Maus');
  R.ui.mouse = { x: 20, y: 8 }; R.ui.tooltip = null;
  ok(ZST.tooltipSetzen(R, zellen) === null && R.ui.tooltip === null, 'Maus neben den Balkenstücken: kein Tooltip');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (b) Stapel im echten Zonenkreuz: Szene aus dem Mockup (Kreuzer, Stb zugewandt), Zeichenfläche mit Aufzeichnung
function zeichneKreuz(kl, o) {
  o = o || {};
  const sys = DATEN.klassen[kl].systeme, zs = [], rec = { rects: [], texte: [], symbole: [], alpha: [] };
  for (const d of sys) { const z = (o.zust || {})[d.id] || [0, 100]; zs.push(z[0], z[1]); }
  zs.push(-1);
  const zug = ['bug', 'stb', 'heck', 'bb'].indexOf(o.zugewandt || 'stb');
  const wahl = []; sys.forEach((d, i) => { if (!(o.zust && o.zust[d.id] && o.zust[d.id][0] === 2) && (d.zone === (o.zugewandt || 'stb'))) wahl.push(i); });
  const leer = ['bug', 'stb', 'heck', 'bb'].map((z) => { const l = sys.filter((d) => d.zone === z); return l.length && l.every((d) => o.zust && o.zust[d.id] && o.zust[d.id][0] === 2) ? 1 : 0; });
  const state = { ship: { zielSys: zs, zielZon: { z: zug, pct: [100, 100, 100, 100], leer }, zielWahl: wahl } };
  const m = ZK.modellZiel(state, { systeme: sys, lay: null });
  const c = { _f: '', _a: 1, set fillStyle(v) { this._f = v; }, get fillStyle() { return this._f; }, set globalAlpha(v) { this._a = v; }, get globalAlpha() { return this._a; },
    fillRect(x, y, w, h) { rec.rects.push({ x, y, w, h, f: this._f, a: this._a }); }, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} };
  const R = { text: (cc, s, x, y) => { rec.texte.push({ s: String(s), x, y }); return 0; }, measure: (s) => String(s).length * 5, ui: { buttons: [] } };
  const P = { mix: (a) => a, skin: { id: 'rom' } };
  const ziel = { weapons: o.weapons || [] };
  const zellen = [];
  const rect = o.rect || { x: 6, y: 40, w: 146, h: MASS.kreuz.ziel.h };
  const inhalt = ZST.inhalt(ziel, { zellen, symbol: (cc, maske, mx, my, farbe) => rec.symbole.push({ maske, mx, my, farbe }) });
  const r = ZK.zeichne(c, m, rect, { env: { R, P }, skin: 'rom', mass: MASS.kreuz.ziel, gegner: true, zugewandt: o.zugewandt || 'stb', seite: o.zugewandt || 'stb', selId: o.sel, inhalt: o.ohneInhalt ? undefined : inhalt });
  return { rec, m, r, zellen, zug };
}
const im = (b, p) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h;
const WAFFEN = [{ platz: 'bug', typ: 'lanze' }, { platz: 'bug2', typ: 'bolzen' }, { platz: 'stbd1', typ: 'lanze' }, { platz: 'stbd2', typ: 'batterie' }, { platz: 'stbd3', typ: 'batterie' },
  { platz: 'bb1', typ: 'batterie' }, { platz: 'bb2', typ: 'lanze' }, { platz: 'bb3', typ: 'batterie' }];
const SZENE = { zust: { waffe_stbd1: [2, 0], waffe_stbd2: [1, 40], emitter_stb: [1, 50], antrieb: [1, 60] }, weapons: WAFFEN, sel: 'waffe_stbd2' };

section('(b) Stapel: Gruppierung, Zähler, ein Balkenstück je Einheit');
{
  const k = zeichneKreuz('kreuzer', SZENE), B = k.r.bodies, S = k.rec.symbole;
  const inZone = (zn) => S.filter((s) => im(B[zn], { x: s.mx, y: s.my }));
  const stb = inZone('stb'), bb = inZone('bb'), bug = inZone('bug'), heck = inZone('heck'), mitte = S.filter((s) => im(k.r.mitte, { x: s.mx, y: s.my }));
  ok(stb.map((s) => s.maske).join() === 'waffe:lanzenbatterie,waffe:standardbatterie,emitter', 'Stb (4 Systeme): drei Zeilen Lanzenbatterie, Batterie (2 Waffen in einer Zeile), Emitter: ' + stb.map((s) => s.maske).join());
  ok(bb.map((s) => s.maske).join() === 'waffe:standardbatterie,waffe:lanzenbatterie,emitter', 'Bb: Batterie (bb1 + bb3) steht vor der Lanzenbatterie in einer Zeile: ' + bb.map((s) => s.maske).join());
  ok(bug.map((s) => s.maske).join() === 'waffe:lanze,waffe:standardkanone' && k.rec.texte.some((t) => t.s === '+1' && im(B.bug, t)), 'Bug (48 px breit): Lanze und Kanone, der Emitter fällt in „+1“ (drei Arten brauchen je Balkenstück mind. ' + STP.balkenMin + ' px)');
  ok(heck.map((s) => s.maske).join() === 'antrieb,emitter', 'Heck: Antrieb, Emitter');
  ok(mitte.length === 5 && mitte.map((s) => s.maske).sort().join() === 'frachtraum,krankenstation,reaktor,schildgenerator,werkstatt', 'Mitte: fünf Arten, ' + mitte.map((s) => s.maske).join());
  // Zähler nur bei mehreren; Zahl steht neben dem Symbol
  const zahl = (zn, wert) => k.rec.texte.filter((t) => t.s === String(wert) && im(B[zn], t));
  ok(zahl('stb', 2).length === 1 && zahl('bb', 2).length === 1, 'Zähler „2“ in Stb und Bb (je eine Zeile mit zwei Batterien)');
  ok(k.rec.texte.filter((t) => /^\d+$/.test(t.s)).length === 2, 'sonst keine Zahl im Kasten (Einzelne haben keinen Zähler): ' + k.rec.texte.map((t) => t.s).join(' '));
  // Balkenstücke: Spur (pipLeer, 4 hoch) je heiler/beschädigter Einheit, 1-px-Strich in Rot je zerstörter
  const spuren = (zn) => k.rec.rects.filter((r) => r.f === F.pipLeer && r.h === STP.balkenH && im(B[zn], r));
  const striche = (zn) => k.rec.rects.filter((r) => r.f === F.zer && r.h === 1 && r.w < 30 && r.y > B[zn].y + 2 && r.y < B[zn].y + B[zn].h - 2 && im(B[zn], r));
  ok(spuren('stb').length === 3 && striche('stb').length === 1, `Stb: 4 Einheiten = 3 Balkenstücke mit Spur + 1 Strich (${spuren('stb').length} + ${striche('stb').length})`);
  ok(spuren('bb').length === 4 && striche('bb').length === 0, `Bb: 4 Einheiten = 4 Balkenstücke (${spuren('bb').length})`);
  ok(spuren('bug').length === 2 && spuren('heck').length === 2, 'Bug 2 und Heck 2 Balkenstücke');
  ok(k.r.mitte && k.rec.rects.filter((r) => r.f === F.pipLeer && r.h === STP.balkenH && im(k.r.mitte, r)).length === 5, 'Mitte: fünf Balkenstücke');
  const xs = spuren('bb').filter((r) => r.y === spuren('bb')[0].y).map((r) => r.x);
  ok(new Set(xs).size === xs.length && xs.length >= 2, 'die Balkenstücke einer Zeile liegen nebeneinander (verschiedene x): ' + xs.join(' '));
  // Füllung nach Prozent: Batterie Stb 2 (40 %, beschädigt) in Gelb, die zweite heil in Creme
  const stbFarben = k.rec.rects.filter((r) => [F.besch, F.ok].includes(r.f) && r.h === STP.balkenH && im(B.stb, r)).map((r) => r.f);
  ok(stbFarben.includes(F.besch) && stbFarben.includes(F.ok), 'Zustandsfarbe: beschädigt Gelb, heil Creme');
  ok(k.zellen.length === DATEN.klassen.kreuzer.systeme.length - 1 && k.zellen.length === 17, 'Tooltip-Flächen: eine je gezeichnete Einheit (18 Systeme, eines in „+1“: ' + k.zellen.length + ')');
  ok(k.rec.texte.every((t) => !ALLE_KURZ.has(t.s)) && !k.rec.texte.some((t) => /^[WE](Bg|St|Hk|Bb)\d?$|^(Antr|Reakt|Schld|Werk|Krank|Frach)$/.test(t.s)), 'kein Kürzel im Bild (WBg, ESt, Antr, Reakt …)');
  ok(!k.rec.texte.some((t) => /%|zer\./.test(t.s)), 'kein Prozentwert und kein „zer.“ im Bild (nur im Tooltip)');
  const alt = zeichneKreuz('kreuzer', Object.assign({}, SZENE, { ohneInhalt: true }));
  ok(alt.rec.texte.some((t) => ALLE_KURZ.has(t.s)) && alt.rec.symbole.length === 0, 'Gegenprobe: ohne Hook zeichnet das Zonenkreuz weiter die Kürzel (Technik und Schadensplan unverändert)');
}

section('(b) Zerstört als Form, Systemziel-Rahmen');
{
  const k = zeichneKreuz('kreuzer', SZENE), B = k.r.bodies, S = k.rec.symbole;
  const lb = S.find((s) => s.maske === 'waffe:lanzenbatterie' && im(B.stb, { x: s.mx, y: s.my }));
  ok(lb && lb.farbe === F.stapelZer, 'zerstörte Lanzenbatterie: Symbol in Grau (stapelZer), nicht in der Funktionsfarbe');
  const kreuzPx = k.rec.rects.filter((r) => r.f === F.zerText && r.w === 1 && r.h === 1 && im(B.stb, r));
  ok(kreuzPx.length === 20, 'Kreuz über dem Symbol: zwei Diagonalen aus 20 Pixeln in zerText (' + kreuzPx.length + ')');
  const kreuzAlle = k.rec.rects.filter((r) => r.f === F.zerText && r.w === 1 && r.h === 1);
  ok(kreuzAlle.length === 20, 'sonst kein Kreuz (nur die eine Zeile ist ganz zerstört): ' + kreuzAlle.length);
  const em = S.find((s) => s.maske === 'emitter' && im(B.stb, { x: s.mx, y: s.my }));
  ok(em && em.farbe === PS.TOKENS.FN.shield, 'beschädigter Emitter bleibt in der Funktionsfarbe (kein Kreuz)');
  // Zeile mit zwei Waffen, eine zerstört: kein Kreuz (die Art lebt noch), der Strich steht beim zerstörten Stück
  const z2 = zeichneKreuz('kreuzer', { zust: { waffe_stbd2: [2, 0] }, weapons: WAFFEN });
  ok(z2.rec.rects.filter((r) => r.f === F.zerText && r.w === 1 && r.h === 1).length === 0, 'zwei Batterien, eine zerstört: kein Kreuz über der Zeile');
  ok(z2.rec.rects.filter((r) => r.f === F.zer && r.h === 1 && r.w < 30 && im(z2.r.bodies.stb, r) && r.y > z2.r.bodies.stb.y + 2).length === 1, '… aber ein roter Strich für das zerstörte Balkenstück');
  const z3 = zeichneKreuz('kreuzer', { zust: { waffe_stbd2: [2, 0], waffe_stbd3: [2, 0] }, weapons: WAFFEN });
  ok(z3.rec.rects.filter((r) => r.f === F.zerText && r.w === 1 && r.h === 1).length === 20, 'beide Batterien zerstört: Kreuz über der Zeile');
  // Systemziel: Marke + Fläche an der Zeile, Rahmen um das Balkenstück
  const marke = k.rec.rects.filter((r) => r.f === F.systemziel && r.w === STP.rand && r.h === STP.zeile - 1);
  const flaeche = k.rec.rects.filter((r) => r.f === F.systemzielZeile && r.h === STP.zeile - 1);
  ok(marke.length === 1 && flaeche.length === 1, 'Zeilenmarke (2 px) und Fläche an genau einer Zeile');
  const zelle = k.zellen.find((q) => q.e.id === 'waffe_stbd2');
  const rahmen = k.rec.rects.filter((r) => r.f === F.systemziel && r.h === 1 && r.w === zelle.w);
  ok(rahmen.length === 2 && rahmen.every((r) => r.x === zelle.x), 'Rahmen um das gewählte Balkenstück (Ober- und Unterkante, Breite Stück + 2)');
  const links = k.rec.rects.filter((r) => r.f === F.systemziel && r.w === 1 && r.h === STP.balkenH + 2);
  ok(links.length === 2, 'Rahmen: linke und rechte Kante, 6 px hoch');
  ok(marke[0].y === flaeche[0].y && marke[0].x === flaeche[0].x, 'Marke sitzt am linken Rand der Fläche');
  const ohne = zeichneKreuz('kreuzer', Object.assign({}, SZENE, { sel: undefined }));
  ok(ohne.rec.rects.filter((r) => r.f === F.systemzielZeile).length === 0 && k.rec.rects.filter((r) => r.f === F.systemziel).length - ohne.rec.rects.filter((r) => r.f === F.systemziel).length === 5, 'ohne Systemziel: weder Fläche noch Marke noch Rahmen (5 Rechtecke in Systemzielfarbe weniger: Marke, vier Rahmenkanten)');
  // Zeile mit Systemziel in der Gruppe: Rahmen nur um das gewählte Stück, nicht um das Nachbarstück derselben Zeile
  const zb = zeichneKreuz('kreuzer', Object.assign({}, SZENE, { sel: 'waffe_bb3' }));
  const zz = zb.zellen.find((q) => q.e.id === 'waffe_bb3'), zn = zb.zellen.find((q) => q.e.id === 'waffe_bb1');
  ok(zb.rec.rects.filter((r) => r.f === F.systemziel && r.h === 1 && r.w === zz.w).every((r) => r.x === zz.x && r.x !== zn.x), 'Systemziel bb3: Rahmen nur um dessen Stück, nicht um bb1 derselben Zeile');
}

section('(b) Nicht wählbare Zeilen gedimmt, Überlauf „+n“');
{
  const k = zeichneKreuz('kreuzer', SZENE);
  const gedimmt = k.rec.rects.filter((r) => r.a === 0.6);
  ok(gedimmt.length > 0 && k.rec.rects.filter((r) => r.a === 1).length > gedimmt.length, 'Systeme der abgewandten Seiten und der geschlossenen Mitte gedimmt (Alpha 0,6)');
  const sz = k.rec.rects.filter((r) => r.a === 1 && r.f === F.ok && r.h === STP.balkenH && im(k.r.bodies.stb, r));
  ok(sz.length >= 1, 'die anwählbare Seite (Stb) bleibt ungedimmt');
  // Überlauf: ein sehr niedriger Kasten, die Mitte mit fünf Arten passt nicht in eine Zeile mit zwei Spalten
  const eng = zeichneKreuz('kreuzer', { zust: {}, weapons: WAFFEN, rect: { x: 6, y: 40, w: 146, h: 66 } });
  const plus = eng.rec.texte.filter((t) => /^\+\d+$/.test(t.s));
  const gezeigt = eng.rec.symbole.filter((s) => im(eng.r.mitte, { x: s.mx, y: s.my })).length;
  ok(plus.length >= 1 && plus.some((t) => im(eng.r.mitte, t)), 'niedriger Kasten: „+n“ in der Mitte (' + plus.map((t) => t.s).join(' ') + ')');
  ok(plus.some((t) => im(eng.r.mitte, t) && t.s === '+' + (5 - gezeigt)), 'das „+n“ nennt genau die fehlenden Arten (5 - ' + gezeigt + ')');
  ok(k.rec.texte.filter((t) => /^\+\d+$/.test(t.s)).map((t) => t.s).join() === '+1', 'im vollen Kasten nur das „+1“ der Bug-Kachel');
  const ger = ZST.fluss(5, { w: 44, h: 53 }, STP.zeile, 53);
  ok(ger.cap >= 5, 'Fluss: fünf Arten in der Mitte des vollen Kasten passen (' + ger.rows + ' Zeilen × ' + ger.cols + ' Spalten)');
  ok(ZST.fluss(9, { w: 44, h: 20 }, STP.zeile, 20).cols <= 2, 'Fluss: höchstens so viele Spalten, wie die Breite zulässt (mind. ' + STP.spalteMin + ' px je Spalte)');
}

section('(b) Jäger und Korvette');
{
  const j = zeichneKreuz('raider', { zust: { emitter_bug: [1, 40] }, zugewandt: 'bug', sel: 'waffe_bug', weapons: [{ facing: 0 }] });
  const ms = j.rec.symbole.map((s) => s.maske);
  ok(ms.filter((m) => m === 'emitter').length === 3 && ms.includes('waffe:standardkanone') && ms.includes('antrieb') && ms.includes('reaktor') && ms.includes('schildgenerator'), 'Jäger: drei Emitter, Kanone, Antrieb, Reaktor, Schildgenerator: ' + ms.join(' '));
  ok(j.rec.symbole.length === 7 && j.rec.symbole.filter((s) => s.maske === 'emitter').length === 3, 'Jäger: sieben Systeme = sieben Symbole (Emitter jeder Seite in der eigenen Kachel)');
  const korv = zeichneKreuz('korvette', { zust: { waffe_bb: [2, 0], emitter_bb: [2, 0], schildgenerator: [1, 50] }, zugewandt: 'bb', sel: 'reaktor', weapons: [{ platz: 'bug', typ: 'lanze' }, { platz: 'stbd', typ: 'batterie' }, { platz: 'bb', typ: 'lanze' }] });
  ok(korv.rec.symbole.length === 10 && korv.m.offen.join() === 'bb', 'Korvette: zehn Symbole, Bb leer (Mitte offen): ' + korv.rec.symbole.length + ' ' + korv.m.offen.join());
  ok(korv.rec.symbole.filter((s) => s.farbe === F.stapelZer).length === 2, 'Korvette: die beiden zerstörten Systeme (Waffe Bb, Emitter Bb) grau');
  ok(korv.rec.rects.filter((r) => r.f === F.zerText && r.w === 1 && r.h === 1).length === 40, 'Korvette: zwei Kreuze (Waffe Bb, Emitter Bb)');
}

section('(c) Tooltip über das Modell: voller Name bei allen Arten aller Klassen (M1)');
{
  let alle = 0, falsch = [];
  for (const [kl, def] of Object.entries(DATEN.klassen)) {
    const zs = []; for (const d of def.systeme) zs.push(0, 100); zs.push(-1);
    const m = ZK.modellZiel({ ship: { zielSys: zs, zielZon: { z: 0, pct: [100, 100, 100, 100], leer: [0, 0, 0, 0] }, zielWahl: [] } }, { systeme: def.systeme, lay: null });
    const eintraege = [].concat(m.mitte.sys, ...['bug', 'stb', 'heck', 'bb'].map((z) => m.zonen[z].sys));
    for (const e of eintraege) {
      alle++;
      const I = ZST.info(e, { weapons: [] }), roh = def.systeme.find((d) => d.id === e.id), kurz = I.langName.split(' · ')[0];
      if (e.art !== 'waffe' && e.art !== 'emitter' && kurz !== String(roh.name)) falsch.push(kl + ':' + e.id + ' „' + kurz + '“');
      if (ALLE_KURZ.has(kurz) || /^(Reakt|Schld|Antr|Werk|Krank|Frach)$/.test(kurz)) falsch.push(kl + ':' + e.id + ' Kürzel „' + kurz + '“');
      if (ZST.tooltipText(I, e).split('\n').length !== 2) falsch.push(kl + ':' + e.id + ' Tooltip nicht zweizeilig');
    }
  }
  ok(alle >= 60 && falsch.length === 0, 'Tooltip-Name aus dem Modell-Eintrag = voller Name der Daten, kein Kürzel (' + alle + ' Systeme, 7 Klassen)' + (falsch.length ? ': ' + falsch.join('; ') : ''));
  const zs = []; for (const d of DATEN.klassen.korvette.systeme) zs.push(d.id === 'antrieb' ? 1 : 0, d.id === 'antrieb' ? 0 : 100); zs.push(-1);
  const m = ZK.modellZiel({ ship: { zielSys: zs, zielZon: { z: 0, pct: [100, 100, 100, 100], leer: [0, 0, 0, 0] }, zielWahl: [] } }, { systeme: DATEN.klassen.korvette.systeme, lay: null });
  const an = m.zonen.heck.sys.find((e) => e.id === 'antrieb');
  ok(ZST.tooltipText(ZST.info(an, null), an) === 'Antrieb\nbeschädigt · 0 %', 'Antrieb am Modell: Tooltip „Antrieb“ / „beschädigt · 0 %“ (' + JSON.stringify(ZST.tooltipText(ZST.info(an, null), an)) + ')');
}

section('Zustand: der Serverzustand geht vor (S2)');
{
  ok(ZK.zustandVon(0, 'damaged') === 'besch' && ZK.zustandVon(40, 'damaged') === 'besch' && ZK.zustandVon(100, 'damaged') === 'besch', 'damaged ist immer beschädigt, auch mit 0 %');
  ok(ZK.zustandVon(0, 'broken') === 'zer' && ZK.zustandVon(60, 'broken') === 'zer', 'broken ist immer zerstört');
  ok(ZK.zustandVon(0, 'ok') === 'zer' && ZK.zustandVon(30, 'ok') === 'besch' && ZK.zustandVon(80, 'ok') === 'ok' && ZK.zustandVon(50, 'offline') === 'offline', 'ok: Prozent entscheiden wie bisher (0 % zerstört), offline bleibt offline');
  const k = zeichneKreuz('korvette', { zust: { antrieb: [1, 0] }, zugewandt: 'heck', weapons: [] });
  const an = k.zellen.find((q) => q.e.id === 'antrieb');
  ok(an && an.e.zust === 'besch' && k.rec.rects.filter((r) => r.f === F.zerText && r.w === 1 && r.h === 1).length === 0, 'Antrieb „damaged“ mit 0 %: kein Kreuz, nicht als zerstört gezeichnet');
}

section('(b) Spaltenbreite nach Bedarf, Balkenstücke mind. so breit wie balkenMin (S1)');
{
  const tw5 = (s) => String(s).length * 5, G = (n) => ({ es: new Array(n).fill({}) });
  ok(STP.balkenMin === 3, 'MASS.stapel.balkenMin = 3');
  const breit = ZST.spalten([G(2), G(1)], { w: 100, h: 20 }, STP.zeile, 20, tw5);
  ok(breit.zaehler === true && breit.cap === 2 && breit.breiten.length === 2, 'breite Kachel: Zähler bleibt, beide Arten nebeneinander');
  ok(breit.breiten.reduce((a, b) => a + b, 0) >= 100 - 4 + 2 - breit.breiten.length, 'freie Breite verteilt sich auf die Spalten (Summe = Kachelbreite)');
  const eng = ZST.spalten([G(2), G(1)], { w: 48, h: 20 }, STP.zeile, 20, tw5);
  ok(eng.zaehler === false && eng.cap === 2, 'Kanone ×2 + Emitter in 48 px: der Zähler fällt weg, beide Arten bleiben (' + JSON.stringify(eng) + ')');
  const drei = ZST.spalten([G(1), G(1), G(1)], { w: 48, h: 20 }, STP.zeile, 20, tw5);
  ok(drei.cap === 2, 'drei Arten in einer Zeile von 48 px: nur zwei, der Rest in „+n“ (cap ' + drei.cap + ')');
  ok(ZST.spalten([G(3)], { w: 40, h: 20 }, STP.zeile, 20, tw5).breiten[0] >= ZST.bedarf(G(3), tw5, false), 'eine Spalte bekommt mindestens den Bedarf ihrer Gruppe');
  const summen = [eng, breit, drei].every((s) => s.breiten.reduce((a, b) => a + b, 0) <= 48 - 4 + 2 || s === breit);
  ok(summen, 'die Spalten zusammen sind nie breiter als die Kachel');
  // im gezeichneten Kasten: kein Balkenstück schmaler als balkenMin, keines ragt aus der Kachel oder in ein Symbol
  const szenen = [zeichneKreuz('kreuzer', SZENE), zeichneKreuz('kreuzer', { zust: {}, weapons: [{ platz: 'bug', typ: 'bolzen' }, { platz: 'bug2', typ: 'bolzen' }, { platz: 'stbd1', typ: 'batterie' }, { platz: 'stbd2', typ: 'batterie' }, { platz: 'stbd3', typ: 'batterie' }, { platz: 'bb1', typ: 'batterie' }, { platz: 'bb2', typ: 'batterie' }, { platz: 'bb3', typ: 'batterie' }] }),
    zeichneKreuz('korvette', { zust: {}, weapons: [{ platz: 'bug', typ: 'lanze' }, { platz: 'stbd', typ: 'batterie' }, { platz: 'bb', typ: 'lanze' }] }), zeichneKreuz('raider', { zust: {}, weapons: [{ facing: 0 }], zugewandt: 'bug' })];
  let schmal = 0, raus = 0, ueberSymbol = 0, stuecke = 0;
  for (const s of szenen) {
    const tiles = Object.values(s.r.bodies).concat([s.r.mitte]);
    for (const r of s.rec.rects.filter((q) => q.f === F.pipLeer && q.h === STP.balkenH)) {
      stuecke++;
      if (r.w < STP.balkenMin) schmal++;
      const t = tiles.find((b) => im(b, r));
      if (!t || r.x + r.w > t.x + t.w) raus++;
      if (s.rec.symbole.some((y) => r.x < y.mx + STP.symbol / 2 && r.x + r.w > y.mx - STP.symbol / 2 && r.y < y.my + STP.symbol / 2 && r.y + r.h > y.my - STP.symbol / 2)) ueberSymbol++;
    }
  }
  ok(stuecke > 40 && schmal === 0, 'kein Balkenstück schmaler als ' + STP.balkenMin + ' px (' + stuecke + ' Stücke in 4 Szenen)');
  ok(raus === 0 && ueberSymbol === 0, 'kein Balkenstück ragt aus seiner Kachel oder in ein Nachbarsymbol');
  // Kreuzer-Bug mit zwei gleichen Kanonen und Emitter (Review): zwei Stücke je 3 px oder mehr, beide Arten sichtbar
  const kb = zeichneKreuz('kreuzer', { zust: {}, weapons: [{ platz: 'bug', typ: 'bolzen' }, { platz: 'bug2', typ: 'bolzen' }] });
  const bugSym = kb.rec.symbole.filter((y) => im(kb.r.bodies.bug, { x: y.mx, y: y.my }));
  ok(bugSym.map((y) => y.maske).join() === 'waffe:standardkanone,emitter', 'Kreuzer-Bug: Kanone ×2 und Emitter beide sichtbar: ' + bugSym.map((y) => y.maske).join());
}

section('Tooltip-Farben (K1)');
{
  const e = (zust, pct) => ({ zust, pct }), I = ZST.info(DATEN.klassen.kreuzer.systeme.find((q) => q.id === 'antrieb'), null);
  const R = (ee) => { const r = { ui: { mouse: { x: 12, y: 8 }, tooltip: null } }; ZST.tooltipSetzen(r, [{ x: 10, y: 5, w: 6, h: 6, e: ee, info: I }], F); return r.ui.tooltip; };
  ok((R(e('besch', 40)).farben || [])[0] === F.text && (R(e('besch', 40)).farben || [])[1] === F.besch, 'beschädigt: Name in Textfarbe, Zustand Gelb');
  ok((R(e('zer', 0)).farben || [])[1] === F.zerText && (R(e('ok', 90)).farben || [])[1] === F.text, 'zerstört in zerText, heil in Textfarbe');
  const drawn = quelle('render.js');
  ok(/t\.farben && t\.farben\[i\]/.test(drawn), 'Render.drawTooltip nimmt die Farbe je Zeile');
}

section('LEER und Zeilen in niedriger Kachel (K2)');
{
  const schnitt = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (const h of [116, 100, 90, 84, 76, 70]) {   // Höhe des Kreuzes: der Kasten richtet sich nach dem Platz, die Bug-Kachel wird niedrig
    const k = zeichneKreuz('raider', { zust: { waffe_bug: [2, 0], emitter_bug: [2, 0] }, zugewandt: 'bug', weapons: [{ facing: 0 }], rect: { x: 6, y: 40, w: 146, h } });
    const leer = k.rec.texte.find((t) => t.s === TEXT_LEER);
    const lb = leer ? { x: leer.x - TEXT_LEER.length * 5, y: leer.y, w: TEXT_LEER.length * 5, h: 7 } : null;
    const boxen = k.rec.symbole.filter((y) => im(k.r.bodies.bug, { x: y.mx, y: y.my })).map((y) => ({ x: y.mx - STP.symbol / 2, y: y.my - STP.symbol / 2, w: STP.symbol, h: STP.symbol }))
      .concat(k.rec.rects.filter((r) => (r.f === F.zer || r.f === F.pipLeer) && r.h <= STP.balkenH && im(k.r.bodies.bug, r)));
    ok(!!leer && im(k.r.bodies.bug, leer) && boxen.length >= 1 && boxen.every((b) => !schnitt(b, lb)), 'Kreuz ' + h + ' px (Bug-Kachel ' + k.r.bodies.bug.h + ' px): LEER überdeckt kein Symbol und kein Balkenstück (' + boxen.length + ' Teile)');
  }
}

section('Keine freien Werte (K3)');
{
  const zq = quelle('zielstapel.js');
  ok(!/x \+ 15\b/.test(zq) && !/i < 10\b/.test(zq) && !/x \+ 10 - i/.test(zq) && !/const k = \d/.test(zq), 'zielstapel.js: Versatz und Kreuzgröße stehen als Tokens in MASS.stapel (versatz, kreuz)');
  ok(STP.versatz === 15 && STP.kreuz === 10, 'MASS.stapel.versatz 15 und kreuz 10');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// (d) echtes Pult: Consoles.pultZielkasten (Ops) mit den echten Skripten
function neueFlaeche() {
  const rec = { texte: [], rects: 0 };
  const st = { fillStyle: '#000', strokeStyle: '#000' };
  const f = { __rec: rec, fillText(s, x, y) { rec.texte.push([String(s), Math.round(x), Math.round(y)]); }, fillRect() { rec.rects++; }, measureText: (s) => ({ width: String(s).length * 5 }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) };
  const ctx = new Proxy(f, { get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { st[k] = v; return true; } });
  return { ctx, rec };
}
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
function umgebung() {
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'), Shared_Schilde: require('../shared/schilde.js'),
    Shared_Schiffskatalog: SCH,
    document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null, addEventListener() {} },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' }, URLSearchParams,
    localStorage: { getItem: () => null, setItem() {} } };
  win.window = win; win.self = win;
  vm.createContext(win);
  win.__fehler = []; win.__sym = [];
  win.Net = { guard: (w, f, d) => { try { return f(); } catch (e) { win.__fehler.push(w + ': ' + e.message); return d; } }, reportError(w, e) { win.__fehler.push(w + ': ' + (e && e.message)); } };
  win.Hud = new Proxy({}, { get: () => () => 0 });
  win.SchiffsUI = { drawWaffe(c, id, x, y, o) { win.__sym.push({ maske: 'waffe:' + id, x, y, farbe: o && o.color }); return true; }, draw() { return true; }, platzVon: () => null, mountAmPlatz: () => null, waffeVon: () => null, farbe: () => '#fff' };
  win.PultTerminal = { symbolModul(c, id, x, y, o) { win.__sym.push({ maske: id, x, y, farbe: o && o.color }); return true; } };
  for (const f of ['kennung.js', 'render.js', 'pult-systeme-tokens.js', 'zonenkreuz.js', 'zielstapel.js', 'zielsysteme.js', 'kartenlogik.js', 'pult.js', 'consoles.js', 'pult-stationen.js']) vm.runInContext(quelle(f), win, { filename: f });
  win.Zielsysteme.store.daten = DATEN;
  return win;
}
section('(d) Pult: Zielkasten und Systemziel-Knopf der Ops');
{
  const win = umgebung(), C = win.Consoles, R = win.Render;
  ok(typeof win.Zielstapel === 'object' && typeof win.PultSysteme === 'object', 'Zielstapel und PultSysteme geladen');
  const SYS = DATEN.klassen.korvette.systeme;
  const zielSys = (b) => { const zs = []; for (const d of SYS) { const q = (b || {})[d.id] || [0, 100]; zs.push(q[0], q[1]); } zs.push(-1); return zs; };
  const idx = (id) => SYS.findIndex((d) => d.id === id);
  const DET = { sys: zielSys({ waffe_stbd: [1, 40], waffe_bb: [2, 0] }), zon: { z: 1, pct: [100, 70, 100, 50], leer: [0, 0, 0, 0] }, wahl: [idx('waffe_stbd'), idx('emitter_stb')] };
  function ansicht(zs, mouse) {
    const en = [{ id: 'k1', kind: 'korvette', vk: 'ger', x: 1200, y: 0, hp: 50, hpMax: 100, scanned: true, angle: 0, shields: [2, 2, 2, 2],
      weapons: [{ platz: 'bug', typ: 'lanze' }, { platz: 'stbd', typ: 'batterie' }, { platz: 'bb', typ: 'lanze' }] }];
    const ship = { x: 1000, y: 0, angle: 0, hull: 100, mounts: [], target: 'k1', zielSys: DET.sys, zielZon: DET.zon, zielWahl: DET.wahl, zs };
    if (!zs) delete ship.zs;
    if (mouse) R.ui.mouse = mouse; else R.ui.mouse = { x: -1, y: -1 };
    return { gesendet: [], time: 1, me: { console: 'weapons', id: 'p1' }, pid: 'p1', ship, enemies: en, escorts: [], actions: { sfx() {} }, send() {},
      state: { time: 1, players: [], flotte: {}, space: { enemies: en, hidden: [] }, ship } };
  }
  function zeichne(v) { C.tab = 2; C.lageRects.length = 0; C.enemyRects.length = 0; const f = neueFlaeche(); win.__fehler.length = 0; win.__sym.length = 0; R.ui.tooltip = null; C.pultDraw(f.ctx, v, 'weapons'); win.__fehler = win.__fehler.filter((q) => !/^Lerche.sprite/.test(q)); return f; }
  const f0 = zeichne(ansicht(null));
  const texte = f0.rec.texte.map((t) => t[0]);
  ok(win.__fehler.length === 0, 'keine Fehlermeldung beim Zeichnen: ' + win.__fehler.join(' | '));
  ok(!texte.some((t) => ALLE_KURZ.has(t)), 'Zielkasten der Ops zeigt kein Kürzel (WBg, EBg, Antr, Reakt, Schld, Werk …)');
  const masken = win.__sym.map((s) => s.maske);
  ok(masken.filter((m) => m === 'emitter').length === 3 && masken.includes('antrieb') && masken.includes('reaktor') && masken.includes('schildgenerator') && masken.includes('werkstatt'), 'Symbole je Art im echten Kasten: ' + masken.join(' '));
  ok(masken.includes('waffe:lanze') && masken.includes('waffe:standardbatterie') && masken.includes('waffe:lanzenbatterie'), 'Waffen aus target.weapons: Lanze (Bug), Batterie (Stb), Lanzenbatterie (Bb): ' + masken.join(' '));
  const stbWaffe = win.__sym.find((s) => s.maske === 'waffe:standardbatterie');
  ok(stbWaffe && stbWaffe.farbe === win.PultSysteme.TOKENS.FN.weapon, 'Waffensymbol in der Funktionsfarbe Rot');
  ok(!f0.rec.texte.some((t) => /%/.test(t[0])) || f0.rec.texte.filter((t) => /%/.test(t[0])).every((t) => /^GESAMT|^(BUG|STB|HECK|BB) \d+%?$|%$/.test(t[0])), 'Prozent nur in Kopfzeile (GESAMT, schwächste Seite), nicht bei den Systemen');
  // Tooltip: Maus auf das Balkenstück der Batterie Stb
  const bat = stbWaffe;
  const f1 = zeichne(ansicht(null, { x: bat.x + 10, y: bat.y }));
  ok(R.ui.tooltip && R.ui.tooltip.text === 'Batterie · Steuerbord\nbeschädigt · 40 %', 'Tooltip unter der Maus: Name, Zustand, Prozent (' + JSON.stringify(R.ui.tooltip && R.ui.tooltip.text) + ')');
  const f2 = zeichne(ansicht(null, { x: 3, y: 3 }));
  ok(!R.ui.tooltip, 'Maus woanders: kein Tooltip');
  // Systemziel-Knopf: Name der Art mit Seite, Symbol davor
  const knopfTexte = (f) => f.rec.texte.map((t) => t[0]);
  const f3 = zeichne(ansicht('waffe_stbd'));
  ok(knopfTexte(f3).includes('Batterie Stb'), 'Systemziel-Knopf: „Batterie Stb“ statt „WSt“ (' + knopfTexte(f3).filter((t) => /Stb|WSt/.test(t)).join(' | ') + ')');
  ok(win.__sym.filter((s) => s.maske === 'waffe:standardbatterie').length === 2, 'Systemziel-Knopf: Waffensymbol vor dem Namen (zusätzlich zum Symbol im Kasten)');
  const f4 = zeichne(ansicht('emitter_stb'));
  ok(knopfTexte(f4).includes('Emitter Stb') && win.__sym.filter((s) => s.maske === 'emitter').length === 4, 'Systemziel-Knopf: „Emitter Stb“ mit Emittersymbol');
  const f5 = zeichne(ansicht(null));
  ok(knopfTexte(f5).includes('Systemziel') && !knopfTexte(f5).some((t) => /^(Emitter|Batterie|Kanone)/.test(t) && false), 'ohne gewähltes Systemziel steht „Systemziel“ im Knopf');
  // Systemziel im Kasten: Marke und Rahmen kommen mit
  ok(f3.rec.rects > f0.rec.rects, 'mit Systemziel zeichnet der Kasten zusätzlich Marke und Rahmen');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('Einbindung');
{
  const html = read('../index.html');
  ok(/zonenkreuz\.js[\s\S]*zielstapel\.js[\s\S]*pult-stationen\.js/.test(html), 'index.html lädt zielstapel.js nach zonenkreuz.js und vor pult-stationen.js');
  const q = quelle('pult-stationen.js');
  ok(/ZST\.inhalt\(target/.test(q) && /ZST\.tooltipSetzen\(R, zellen, F\)/.test(q) && /vor: zvor/.test(q), 'pult-stationen.js: Zielkasten benutzt Zielstapel.inhalt, Tooltip und Knopf-Symbol');
  const ps = read('pult-systeme-tokens.js');
  ok(/stapelZer: '#4A5468'/.test(ps) && /stapel: \{ zeile: 14/.test(ps), 'Tokens: Farbe stapelZer und MASS.stapel stehen in pult-systeme-tokens.js');
  const zq = quelle('zielstapel.js');
  ok(!/#[0-9A-Fa-f]{6}\b/.test(zq), 'zielstapel.js enthält keine eigenen Hex-Werte (Farben aus den Tokens)');
}

console.log('\ntest-scan-icons: ' + (n - fails) + '/' + n + ' ok');
process.exit(fails ? 1 : 0);
