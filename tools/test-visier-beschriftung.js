'use strict';
// KUL-03 B2: Beschriftung und Randpfeile des Visiers (public/js/visier-beschriftung.js), reiner Node-Test ohne Browser.
//   (1) Gefecht: keine Überlappung der Texte/Marken untereinander und mit den gesperrten Flächen; alles im Bild
//   (2) nur das Ziel trägt Text (ZIEL <Entfernung>, Skala 2); alle anderen Gegner nur die Marke
//   (3) Ausweichen nach oben mit Führungslinie bei Versatz > 5 px; Rangfolge; Grenzen der Versuche
//   (4) Stabilität: gleicher Eingang -> gleiche Lage (auch bei umgekehrter Eingabereihenfolge)
//   (5) Station, Dock-Ring, Sprungboje: Name + Entfernung in Skala 2 (Boje: Entfernung Skala 1 nach Tokens)
//   (6) Randpfeile für außerhalb liegende Station / Sprungboje / Ziel; kurze Beschriftung; nicht über gesperrten Flächen
//   (7) Gegner hinter dem Schiff: weder Marke noch Text noch Randpfeil (auch nicht als Ziel)
//   (8) oben links bleibt frei; Sperrflächen aus Tokens, Lagescheibe, Tafel, Szenenzeile
//   (9) Tele-Warnung nur in den letzten 1,2 s (Frontsicht-Regel)
//   (10) Robustheit: kein Wurf bei fehlenden/kaputten Daten
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const rad = (g) => g * Math.PI / 180;
globalThis.HauptschirmTokens = require('../public/js/hauptschirm-tokens.js');
const TK = HauptschirmTokens.TOKENS, V = TK.VISIER, OB = V.objekt, BS = OB.beschriftung;
require('../public/js/kulisse-himmel.js');
const Vis = require('../public/js/visier.js');
globalThis.HauptschirmTafeln = require('../public/js/hauptschirm-tafeln.js');
const textCalls = [];
globalThis.Render = { measure: (s, k) => Math.max(0, String(s).length * 6 - 1) * (k || 1), textKontur: (ctx, s, x, y, o) => textCalls.push({ s, x, y, o }) };
let zielId = null;
globalThis.Consoles = { targetOf: (view) => (zielId ? (view.enemies || []).find((e) => e.id === zielId) || (zielId === 'station' ? { id: 'station', station: true, x: view._zielX, y: view._zielY } : null) : null) };
const Lage = require('../public/js/visier-lage.js');
const Obj = require('../public/js/visier-objekte.js');
const Besch = require('../public/js/visier-beschriftung.js');
require('../public/js/visier-leiste.js');   // setzt globalThis.VisierLeiste: Optionen der Sprungziel-Tafel kommen von dort (N1 B2)
const c = Vis.kamera(), W = c.W, H = c.H;

const ship = { x: 1000, y: 1000, angle: 0 };   // Kurs Osten: voraus = +x, Steuerbord = +y
const enemy = (id, f, r, kind, extra) => Object.assign({ id, kind: kind || 'raider', x: 1000 + f, y: 1000 + r, angle: rad(180), hp: 8, hpMax: 10, shields: [1, 1, 1, 1], shieldsMax: [2, 2, 2, 2] }, extra);
const mkView = (enemies, space, jump) => ({ time: 1, ship, enemies, escorts: [], spaceProjectiles: [], state: { ship: Object.assign({ scene: 'zz', jump: jump || {} }, ship), space: space || {} } });
const lageVon = (v) => Obj.baue(v, Vis.plan(v), c);
const bau = (v, opt) => Besch.baue(v, Vis.plan(v), c, Object.assign({ lage: lageVon(v) }, opt));
const alle = (P) => P.items.concat(P.pfeile);
const ueberlappt = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
function keineUeberlappung(P) {
  const rs = alle(P); let bad = 0;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (ueberlappt(rs[i].rect, rs[j].rect)) bad++;
  return bad;
}
const verletztSperre = (P) => alle(P).filter((it) => P.sperren.some((s) => ueberlappt(it.rect, s))).length;
const imBildAlle = (P) => alle(P).every((it) => it.rect.x0 >= 0 && it.rect.y0 >= 0 && it.rect.x1 <= W && it.rect.y1 <= H);
const sig = (P) => JSON.stringify(alle(P).map((i) => [i.id, i.rect.x0, i.rect.y0, i.rect.x1, i.rect.y1, !!i.fuehrung]));
const protCtx = (prot) => new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 0 }) : (...a) => { prot.push([k, a]); }), set: () => true });

// Gefecht: neun Gegner, mehrere fast hintereinander (gleiche Peilung), ein Ziel
const gefecht = () => mkView([enemy('g1', 300, 0), enemy('g2', 340, 6), enemy('g3', 380, -4), enemy('g4', 420, 2), enemy('g5', 460, 0), enemy('g6', 520, 10),
  enemy('g7', 600, -30, 'korvette'), enemy('g8', 700, 40, 'fregatte'), enemy('g9', 330, -120)]);

section('(1) Gefecht: keine Überlappung, alles im Bild');
{
  zielId = 'g3';
  const v = gefecht(), P = bau(v);
  ok(P && P.items.length > 8, 'Lage mit ' + (P && P.items.length) + ' Posten (9 Marken + ZIEL-Text)');
  ok(keineUeberlappung(P) === 0, 'kein Posten überlappt einen anderen');
  ok(verletztSperre(P) === 0, 'kein Posten liegt auf einer gesperrten Fläche (' + P.sperren.map((s) => s.name).join(', ') + ')');
  ok(imBildAlle(P), 'alle Rechtecke liegen im Bild');
  ok(P.items.filter((i) => i.art === 'marke').length === 9 && P.weggelassen.length === 0, 'alle 9 Marken gesetzt, nichts weggelassen');
  ok(P.items.find((i) => i.art === 'ziel').rect.y0 >= P.items.find((i) => i.id === 'marke:g3').rect.y1, 'ZIEL-Text steht unter dem Ziel (nach unten gesetzt), die Marke darüber');
}

section('(2) nur das Ziel trägt Text');
{
  zielId = 'g3';
  const P = bau(gefecht()), texte = P.items.filter((i) => i.art !== 'marke');
  ok(texte.length === 1 && texte[0].art === 'ziel' && /^ZIEL \d+$/.test(texte[0].text), 'genau ein Text an Gegnern: "' + (texte[0] && texte[0].text) + '"');
  ok(texte[0].text === 'ZIEL ' + Math.round(Math.hypot(380, -4)), 'Entfernung = Abstand Schiff - Ziel');
  ok(P.items.filter((i) => i.art === 'marke').every((i) => i.text == null), 'Marken tragen keinen Text');
  zielId = null;
  const P0 = bau(gefecht());
  ok(P0.items.every((i) => i.art === 'marke'), 'ohne Ziel: nur Marken, kein Text');
  const prot = [], ctx = protCtx(prot); textCalls.length = 0; zielId = 'g3';
  const vz = gefecht(), pz = Vis.plan(vz);
  Obj.zeichne(ctx, vz, pz, c); Besch.zeichne(ctx, vz, pz, c);
  ok(textCalls.length === 1 && textCalls[0].o.scale === 2 && /^ZIEL/.test(textCalls[0].s), 'beim Zeichnen genau ein Text, Skala 2, nicht doppelt (B1 schreibt keinen mehr)');
  zielId = null;
}

section('(3) Ausweichen nach oben, Führungslinie, Rang, Versuche');
{
  zielId = 'g3';
  const P = bau(gefecht()), M = P.items.filter((i) => i.art === 'marke');
  const versetzt = M.filter((i) => i.dy !== 0);
  ok(versetzt.length >= 3, versetzt.length + ' Marken sind ausgewichen (dichter Haufen)');
  ok(versetzt.every((i) => i.dy < 0), 'Marken weichen nach oben aus (dy < 0)');
  ok(M.every((i) => ((Math.abs(i.y - i.rect.y1) > BS.fuehrung.abVersatz) === !!i.fuehrung)), 'Führungslinie genau dann, wenn der Versatz größer als ' + BS.fuehrung.abVersatz + ' px ist');
  ok(M.filter((i) => i.fuehrung).every((i) => i.fuehrung.y === i.rect.y1 && i.fuehrung.x >= i.rect.x0 && i.fuehrung.x <= i.rect.x1), 'Führungslinie führt vom Anker zur Unterkante der Marke');
  const z = P.items.find((i) => i.id === 'marke:g3');
  ok(z.dy === 0, 'das Ziel (Rang 3) wird zuerst gesetzt und bleibt am Platz');
  // reines Setzen
  const kam = { W, H };
  const a = { id: 'a', rang: 1, w: 40, h: 15, x: 256, y: 150, richtung: 'oben' }, b = { id: 'b', rang: 3, w: 40, h: 15, x: 256, y: 150, richtung: 'oben' };
  const R = Besch.setze([a, b], [], kam);
  ok(R.items[0].id === 'b' && R.items[0].dy === 0 && R.items[1].id === 'a' && R.items[1].dy < 0, 'höherer Rang zuerst am Platz, der niedrigere weicht nach oben');
  const e1 = Besch.setze([{ id: 'y', rang: 1, w: 30, h: 10, x: 100, y: 150, richtung: 'oben' }, { id: 'x', rang: 1, w: 30, h: 10, x: 100, y: 150, richtung: 'oben' }], [], kam);
  ok(e1.items[0].id === 'x', 'Gleichstand: stabile Ordnung nach Objekt-id');
  const viele = []; for (let i = 0; i < 60; i++) viele.push({ id: 'k' + i, rang: 1, w: 40, h: 15, x: 256, y: 150, richtung: 'oben' });
  const t0 = Date.now(), RV = Besch.setze(viele, [], kam);
  ok(Date.now() - t0 < 500 && RV.items.length + RV.weggelassen.length === 60 && RV.weggelassen.length > 0, 'zu viele gleichartige Posten: nach den Versuchen weggelassen (' + RV.items.length + ' gesetzt, ' + RV.weggelassen.length + ' weggelassen), keine Endlosschleife');
  ok(RV.items.length <= 16 * BS.versuche + 1, 'höchstens ' + (16 * BS.versuche + 1) + ' Plätze je Anker (je Richtung ' + BS.versuche + ' Versuche, dazu seitlich)');
  const unten = Besch.setze([{ id: 'u', rang: 3, w: 40, h: 15, x: 256, y: 10, richtung: 'unten' }], [{ x0: 0, y0: 0, x1: 512, y1: 150 }, { x0: 0, y0: 160, x1: 512, y1: 288 }], kam);
  ok(unten.items.length === 0 && unten.weggelassen[0] === 'u', 'nirgends Platz: weggelassen');
  const gegen = Besch.setze([{ id: 'u', rang: 3, w: 40, h: 15, x: 256, y: 250, richtung: 'unten' }], [{ x0: 0, y0: 252, x1: 512, y1: 288 }], kam);
  ok(gegen.items.length === 1 && gegen.items[0].rect.y1 <= 250, 'nach unten gesperrt: weicht in die Gegenrichtung (über den Anker)');
}

section('(4) Stabilität');
{
  zielId = 'g3';
  const P1 = bau(gefecht()), P2 = bau(gefecht());
  ok(sig(P1) === sig(P2), 'zweimal derselbe Eingang -> dieselbe Lage');
  const v = gefecht(); v.enemies.reverse();
  ok(sig(bau(v)) === sig(P1), 'andere Reihenfolge der Gegner im Snapshot -> dieselbe Lage');
  const v3 = gefecht(); for (const e of v3.enemies) e.hp = 3;
  ok(sig(bau(v3)) === sig(P1), 'Hüllenwerte ändern die Lage nicht (kein Flackern)');
  zielId = null;
}

section('(5) Station, Dock-Ring, Sprungboje im Bild');
{
  const sp = { markers: [{ kind: 'station', x: 1500, y: 1040, name: 'Hafen Castra' }, { kind: 'dock', x: 1420, y: 1040, r: 70 }], jp: [{ k: 'k1', x: 1400, y: 880, n: '0502' }] };
  const v = mkView([enemy('a', 300, 0)], sp, { dest: 'leer-0502', jp: 'k1' }), P = bau(v);
  const st = P.items.find((i) => i.art === 'station'), dk = P.items.find((i) => i.art === 'dock'), bj = P.items.find((i) => i.art === 'sprungboje');
  ok(st && st.text === 'HAFEN CASTRA' && st.sub && st.sub.skala === 2 && st.sub.text === String(Math.round(Math.hypot(500, 40))), 'Station: Name und Entfernung, beide Skala 2');
  ok(dk && /^DOCK-RING \d+$/.test(dk.text) && dk.richtung === 'unten', 'Dock-Ring: "' + (dk && dk.text) + '" in Skala 2, unter dem Ring');
  ok(bj && bj.text === 'LEER 0502' && bj.sub.skala === OB.boje.sprung.label.entfernungSkala, 'Sprungboje: Name des Ziels (' + (bj && bj.text) + '), Entfernung in der Skala der Tokens');
  ok(keineUeberlappung(P) === 0 && verletztSperre(P) === 0, 'auch mit Station, Ring und Boje keine Überlappung');
  ok(st.h === BS.hoeheMitEntfernung2, 'Schildhöhe mit Entfernung in Skala 2 (' + st.h + ')');
  zielId = 'a'; textCalls.length = 0;
  Obj.zeichne(protCtx([]), v, Vis.plan(v), c); Besch.zeichne(protCtx([]), v, Vis.plan(v), c);
  const gez = textCalls.map((t) => t.s);
  ok(['HAFEN CASTRA', 'LEER 0502'].every((s) => gez.includes(s)) && gez.some((s) => /^DOCK-RING/.test(s)) && gez.filter((s) => /^ZIEL/.test(s)).length === 1, 'gezeichnet: ' + gez.join(' | '));
  zielId = null;
}

section('(6) Randpfeile für Objekte außerhalb des Bildes');
{
  // Mittelpunkt außerhalb des Bildes, nur der Rand ragt herein: Pfeil statt Schild am Bildrand
  const vR = mkView([], { markers: [{ kind: 'station', x: 1500, y: 1420, name: 'Hafen' }] }), PR = bau(vR), stR = lageVon(vR).objekte.find((o) => o.art === 'station');
  ok(stR && !(stR.p.x >= 0 && stR.p.x <= W) && !PR.items.some((i) => i.art === 'station') && PR.pfeile.some((p) => p.id === 'station'), 'Station mit Mittelpunkt links/rechts außerhalb (Rand ragt ins Bild): kein Schild, dafür Randpfeil');
  // Boje unter der Sprungziel-Tafel: das Schild sitzt nie auf dem eigenen Mast
  const vB = mkView([], { jp: [{ k: 'b', x: 1700, y: 1150, n: '0502' }] }, { dest: 'leer-0502', jp: 'b' }), bj0 = bau(vB).items.find((i) => i.art === 'sprungboje');
  ok(bj0 && !(bj0.x >= bj0.rect.x0 && bj0.x <= bj0.rect.x1 && bj0.y >= bj0.rect.y0 && bj0.y <= bj0.rect.y1), 'Boje unter der Tafel: das Schild weicht seitlich aus, bedeckt den Mast nicht');
  const sp = { markers: [{ kind: 'station', x: 1400, y: 1700, name: 'Hafen Castra' }], jp: [{ k: 'k1', x: 1450, y: 300, n: '0502' }] };
  zielId = 'z';
  const v = mkView([enemy('z', 400, -650), enemy('n1', 300, 640), enemy('hinten', -300, 50)], sp, { dest: 'leer-0502', jp: 'k1' });
  const P = bau(v), pf = (id) => P.pfeile.find((p) => p.id === id);
  ok(P.pfeile.length >= 4, P.pfeile.length + ' Randpfeile: ' + P.pfeile.map((p) => p.id).join(', '));
  ok(pf('station') && pf('station').seite === 1 && /^HAFEN CAS \d+$/.test(pf('station').text), 'Station rechts außerhalb: Pfeil mit kurzem Namen + Entfernung ("' + (pf('station') && pf('station').text) + '")');
  ok(pf('boje:k1') && pf('boje:k1').seite === -1 && /^LEER 0502 \d+$/.test(pf('boje:k1').text), 'Sprungboje links außerhalb: Pfeil "' + (pf('boje:k1') && pf('boje:k1').text) + '"');
  ok(pf('gegner:z') && pf('gegner:z').seite === -1 && /^ZIEL \d+$/.test(pf('gegner:z').text), 'Ziel der Ops außerhalb: Pfeil "' + (pf('gegner:z') && pf('gegner:z').text) + '"');
  ok(pf('gegner:n1') && pf('gegner:n1').text === null, 'anderer Gegner außerhalb: Pfeil ohne Text');
  ok(P.pfeile.every((p) => (p.seite < 0 ? p.x <= 20 : p.x >= W - 20)), 'Pfeile sitzen links/rechts am Rand');
  ok(keineUeberlappung(P) === 0 && verletztSperre(P) === 0 && imBildAlle(P), 'Pfeile überdecken weder einander noch Leiste, Lagescheibe, Tafel; alle im Bild');
  const hz = Vis.kamera().horizont;
  ok(P.pfeile.every((p) => p.rect.y0 >= hz + OB.randpfeil.unterHorizont - 6 - 1e-9 && p.rect.y1 <= H - V.leiste.hoehe), 'Pfeile zwischen Horizont und Leiste');
  const pfeilPos = P.pfeile.map((p) => p.rect.y0 + ':' + p.id).join();
  ok(pfeilPos === bau(v).pfeile.map((p) => p.rect.y0 + ':' + p.id).join(), 'Lage der Pfeile stabil');
  // Pfeile auch ohne Entfernung ins Lagescheiben-Gebiet geschoben: rechts unten ausweichen statt überdecken
  const sp2 = { markers: [{ kind: 'station', x: 1060, y: 1900, name: 'Hafen' }] };
  const P2 = bau(mkView([], sp2)), s2 = P2.pfeile.find((p) => p.id === 'station');
  ok(!!s2, 'Station nahe voraus seitlich: Pfeil vorhanden');
  ok(s2 && !ueberlappt(s2.rect, (() => { const f = Lage.flaeche(c); return { x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h }; })()), 'Pfeil unten rechts weicht der Lagescheibe aus (y0 ' + (s2 && s2.rect.y0) + ')');
  zielId = null;
}

section('(7) Gegner hinter dem Schiff');
{
  zielId = 'ziel-hinten';
  const v = mkView([enemy('h1', -200, 30), enemy('h2', -900, -400), enemy('ziel-hinten', -100, 300), enemy('seite', 10, 500), enemy('vorn', 400, 0)]);
  const P = bau(v), ids = alle(P).map((i) => i.id);
  ok(!ids.some((i) => /h1|h2|hinten/.test(i)), 'kein Posten für Gegner hinter dem Schiff (auch nicht als Ziel): ' + ids.join(', '));
  ok(!alle(P).some((i) => i.text && /HECK|ALARM/.test(i.text)), 'keine Texte "HECK" und "ALARM ROT"');
  ok(ids.includes('marke:vorn'), 'Gegner voraus hat seine Marke');
  zielId = null;
  const hinten = bau(mkView([enemy('h', -500, 100), enemy('h2', 30, 100), enemy('h3', 39, -100)]));
  ok(hinten.pfeile.length === 0 && hinten.items.length === 0, 'Z < ' + OB.randpfeil.hintenWelt + ': weder Pfeil noch Marke (nur Lagescheibe)');
}

section('(8) oben links frei, Sperrflächen');
{
  const F = BS.freiObenLinks, TF = TK.TAFEL;
  ok(F.x === 0 && F.y === 0 && F.w === TF.links.x + TF.links.w + TF.rand && F.h === TF.links.y + TF.links.h + TF.rand, 'Token freiObenLinks = Fläche der früheren linken Tafel samt Rand');
  // viele Gegner links oben: Marken dürfen dort nicht stehen
  const links = []; for (let i = 0; i < 12; i++) links.push(enemy('l' + i, 520 + i * 40, -190 - i * 10, i % 2 ? 'korvette' : 'raider'));
  zielId = 'l3';
  const P = bau(mkView(links, { markers: [{ kind: 'station', x: 1800, y: 800, name: 'Hafen' }] })), fr = { x0: F.x, y0: F.y, x1: F.x + F.w, y1: F.y + F.h };
  const L = lageVon(mkView(links));
  const obenLinks = L.objekte.filter((o) => o.bb && o.bb.x0 < F.w && o.bb.y0 < F.h + 20).length;
  ok(obenLinks >= 1, 'Gegenprobe: ' + obenLinks + ' Modelle stehen im oder knapp am oberen linken Bereich');
  ok(alle(P).every((i) => !ueberlappt(i.rect, fr)), 'kein Posten im oberen linken Bereich (' + alle(P).length + ' Posten)');
  zielId = null;
  const mitTafel = Besch.sperrFlaechen(mkView([], {}, { dest: 'leer-0502' }), c, null), ohneTafel = Besch.sperrFlaechen(mkView([]), c, null);
  const nm = (a) => a.map((s) => s.name).sort().join();
  ok(nm(mitTafel) === 'lagescheibe,leiste,obenLinks,tafelRechts' && nm(ohneTafel) === 'lagescheibe,leiste,obenLinks', 'Sperren: Leiste, Lagescheibe, oben links, Sprungziel-Tafel nur mit Sprungziel (' + nm(ohneTafel) + ')');
  const lf = Lage.flaeche(c), ls = mitTafel.find((s) => s.name === 'lagescheibe');
  ok(ls.x0 <= lf.x && ls.y0 <= lf.y && ls.x1 >= lf.x + lf.w && ls.y1 >= lf.y + lf.h, 'Lagescheibe aus VisierLage.flaeche() (x ' + lf.x + '–' + (lf.x + lf.w) + ', y ' + lf.y + '–' + (lf.y + lf.h) + ')');
  const lei = mitTafel.find((s) => s.name === 'leiste');
  ok(lei.y0 <= H - V.leiste.hochfeld && lei.y1 >= H, 'Leiste samt Hochfeld (Tempo, Kurs-Kasten 27 px) gesperrt');
  const tf = mitTafel.find((s) => s.name === 'tafelRechts');
  ok(tf.x1 >= W - TF.rechts.x * -1 - 1 && tf.x1 - tf.x0 >= TF.rechts.w && tf.y1 - tf.y0 >= TF.rechts.h, 'Sprungziel-Tafel (' + TF.rechts.w + ' x ' + TF.rechts.h + ') gesperrt');
  const mitSzene = Besch.sperrFlaechen(mkView([]), c, { x: 150, y: 6, w: 200, h: 14 });
  ok(mitSzene.some((s) => s.name === 'szene' && s.x0 < 150 && s.x1 > 350 && s.y1 >= 20), 'Szenenzeile gesperrt');
  // N1 B2: Sperrflaeche der Tafel = die tatsaechlich (unter der Zeile) gezeichnete Tafel, Optionen aus VisierLeiste.tafelOptionen
  const hohe = { x: 46, y: 6, w: 420, h: 27 }, vj = mkView([], {}, { dest: 'leer-0502' });
  const tHoch = Besch.sperrFlaechen(vj, c, hohe).find((s) => s.name === 'tafelRechts'), soll = HauptschirmTafeln.lage(vj, VisierLeiste.tafelOptionen(hohe)).rechts;
  ok(tHoch && soll && soll.y >= 37 && tHoch.y0 === soll.y - TF.sperrAbstand && tHoch.y1 === soll.y + soll.h + TF.sperrAbstand && tHoch.x0 === soll.x - TF.sperrAbstand, 'Sperrflaeche der Tafel liegt unter der hohen Szenenzeile (y ' + (tHoch && tHoch.y0) + ' ... ' + (tHoch && tHoch.y1) + ') = gezeichnete Tafel');
  // ein Posten, der genau dorthin wollte, weicht aus
  const szP = bau(mkView([enemy('a', 300, 0)]), { szene: { x: 0, y: 70, w: 512, h: 130 } });
  ok(alle(szP).every((i) => !ueberlappt(i.rect, { x0: 0, y0: 70, x1: 512, y1: 200 })), 'Szenenzeile (hier groß erfunden) wird von Marken und Texten gemieden');
}

section('(9) Tele-Warnung nur in den letzten 1,2 s');
{
  ok(Obj.teleSichtbar({ tele: { left: 5, dur: 6 } }) === false && Obj.teleSichtbar({ tele: { left: 1.5 } }) === false, 'noch 5 s / 1,5 s: nicht sichtbar');
  ok(Obj.teleSichtbar({ tele: { left: 1.2 } }) === true && Obj.teleSichtbar({ tele: { left: 0.4 } }) === true && Obj.teleSichtbar({ tele: { left: 0 } }) === true, 'ab 1,2 s: sichtbar');
  ok(Obj.teleSichtbar({}) === false && Obj.teleSichtbar(null) === false && Obj.teleSichtbar({ tele: {} }) === true, 'ohne Ladung: nein (ohne left gilt 0 = gleich vorbei, sichtbar)');
  ok(OB.grob.tele.sichtLetzte === 1.2, 'Token sichtLetzte 1,2');
  const dashes = (left) => { const prot = []; const v = mkView([enemy('t', 350, 0, 'raider', { tele: { left, dur: 6 } })]); Obj.zeichne(protCtx(prot), v, Vis.plan(v), c); return prot.filter(([k, a]) => k === 'setLineDash' && a[0] && a[0].join() === OB.grob.tele.strich.join()).length; };
  ok(dashes(5) === 0 && dashes(1) === 1, 'gezeichnet: Ring bei left 5 nicht, bei left 1 genau einmal');
}

section('(10) Robustheit');
{
  const prot = [], ctx = protCtx(prot);
  let w = null;
  const kaputt = [mkView([]), {}, null, mkView(undefined), mkView([null, {}, { id: 'x', x: NaN, y: 1 }, { id: 'y', x: 1300, y: 1000 }, enemy('k', 300, 0, 'unbekannt')]),
    mkView([enemy('a', 300, 0)], { markers: [null, { kind: 'dock' }, { kind: 'station', x: 'a', y: 1 }, { kind: 'station', x: 1300, y: 1000 }, { kind: 'exit', x: 1400, y: 1000 }, { kind: 'exit', x: 1100, y: 2500 }], jp: [null, { x: 1300, y: 1020, k: 'b' }, { x: 5 }], asteroids: [null], mines: [null], hidden: [null, { id: 'h', x: 1300, y: 1050 }] }, { dest: 'xx', jp: 'zz' })];
  try {
    for (const v of kaputt) { const L = v && v.state ? Vis.plan(v) : null; Besch.baue(v, L, c); Obj.zeichne(ctx, v, L, c); Besch.zeichne(ctx, v, L, c); }
    Besch.baue(); Besch.zeichne(); Besch.setze([], [], c); Besch.setze([{ id: 'n', rang: 1, w: NaN, h: 1, x: 1, y: 1, richtung: 'oben' }, null && {}].filter(Boolean), [], c);
  } catch (e) { w = e; }
  ok(!w, 'wirft nicht bei fehlenden, leeren und kaputten Daten' + (w ? ': ' + w.stack : ''));
  ok(Besch.baue(null, null, c) === null && Besch.baue({ state: { space: {} } }, null, c, { lage: null }) === null, 'ohne Schiff/Lage: null');
  zielId = null;
  const leer = Besch.baue(mkView([]), Vis.plan(mkView([])), c, { lage: lageVon(mkView([])) });
  ok(leer && leer.items.length === 0 && leer.pfeile.length === 0, 'leere Szene: nichts zu setzen');
  const v = mkView([enemy('s', 300, 0)]); zielId = 's'; textCalls.length = 0;
  Vis.zeichne(protCtx([]), v, { x: 0, y: 0, w: 512, h: 288 });
  ok(textCalls.some((q) => /^ZIEL/.test(q.s)), 'Visier.zeichne ruft die Schicht "beschriftung" (ZIEL erscheint)');
  zielId = null;
}
console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLER' : 'alle ' + n + ' Pruefungen gruen'));
process.exit(fails ? 1 : 0);
