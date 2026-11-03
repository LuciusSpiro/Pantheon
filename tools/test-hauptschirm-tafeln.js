'use strict';
// KUL-02 D / D2: Lesbarkeit (Beschriftungen der Frontsicht auf Skala 2, nur Hauptschirm) und Ecktafeln des klassischen Hauptschirms (public/js/hauptschirm-tafeln.js) mit dem ECHTEN
// render.js, starmap.js, den Tokens und sitz.js (vm, Canvas-Attrappe mit Aufrufprotokoll).
//   (a) Geometrie: beide Tafeln im Schirm, ohne Überlappung, Mitte oben mindestens mitteFreiMin frei; ohne Sprungziel entfällt die rechte Tafel; breite Szenenzeile schiebt beide unter die Zeile
//   (b) Texte gegen Datenwerte: Kurs 217 -> „217°“ (Skala 3), Kursband mit S (nicht N/O/W), Tempo (Skala 3), Stufenwort (Skala 2), Ziel, Boje 1200 -> „BOJE · 1200“, Peilpfeil dreht auf die Boje
//   (c) Skalen laut Tokens (Aufrufprotokoll Render.text), Köpfe Skala 1; Ladebalken-Anteil; Kopf „SPRUNG LÄDT n %“
//   (d) keine Hülle; fehlende Daten werfen nicht (kein gemeldeter Fehler, save/restore ausgeglichen)
//   (e) Frontsicht Skala 2: Labels des Hauptschirms mit 14-px-Schrift (Skala 2), keine Überlagerung im Gefecht mit vier Gegnern und beim Anflug an Station/Boje; Pult bleibt Skala 1 (test-frontsicht, Kindprozess)
//   (f) Randpfeile und Labels weichen den Tafeln aus (rect.sperren); ohne Sperren läge der Pfeil in der Tafel
//   (g) sitz.js (klassischer Zeichner): Tafeln NACH drawFrontView, rect.textSkala = Token, rect.sperren aus den Tafeln
//   (h) Mutationen: Tafel vor drawFrontView -> (g) rot; rect.sperren nicht weitergegeben -> (f) rot; Skala-Option nicht weitergereicht -> (e) rot; textSkala in sitz.js entfernt -> (g) rot
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const Locs = require('../shared/locations.js');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');
const rad = (g) => g * Math.PI / 180;

// ------------------------------------------------------------------ Zeichenfläche (Protokoll aller Aufrufe; fillRect mit der aktuellen fillStyle; measureText je nach Schrift)
function neueFlaeche(log) {
  const st = { fillStyle: '#000', strokeStyle: '#000', font: '8px monospace', textAlign: 'left' };
  const grad = { addColorStop() {} };
  const breite = (s) => String(s).length * (parseInt(st.font, 10) >= 14 ? 12 : 5);
  const f = { measureText: (s) => ({ width: breite(s) }), createLinearGradient: () => grad, createRadialGradient: () => grad, log,
    fillRect(...a) { log.push({ k: 'fillRect', a, fill: st.fillStyle }); }, fillText(s, x, y) { log.push({ k: 'fillText', s: String(s), x, y, font: st.font, align: st.textAlign, fill: st.fillStyle }); } };
  return new Proxy(f, {
    get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? (...a) => { log.push({ k, a }); } : undefined),
    set: (t, k, v) => { st[k] = v; return true; },
  });
}
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
// Messfläche von render.js (measure): Schriftgröße bestimmt die Breite (14 px = Skala 2: 12 je Zeichen, sonst 5)
const messCtx = { font: '8px monospace', measureText(s) { return { width: String(s).length * (parseInt(this.font, 10) >= 14 ? 12 : 5) }; } };

// ------------------------------------------------------------------ Umgebung (echte Skripte im vm)
function umgebung(q) {
  q = q || {};
  const meldungen = [];
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
    Shared_Locations: Locs, Net: { reportError: (l, e) => meldungen.push(l + ': ' + (e && e.message)) },
    document: { createElement: () => ({ getContext: () => messCtx, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' } };
  win.window = win; win.self = win; win.meldungen = meldungen;
  vm.createContext(win);
  const lade = (f) => vm.runInContext(q[f] != null ? q[f] : rd(f), win, { filename: f });
  win.IconsB = { boje(ctx, z, x, y, zoom, w) { ctx.rect(x, y, w, zoom); return true; } };
  for (const f of ['kennung.js', 'render.js', 'kartenlogik.js', 'sonden.js', 'spur.js', 'kartenzeichen.js', 'karte-tokens.js', 'kartenansicht.js', 'starmap.js', 'hauptschirm-tokens.js', 'hauptschirm-tafeln.js']) lade(f);
  win.Hud = { szeneVon: () => null };
  // Consoles.helmInfo: Attrappe mit derselben Rückgabeform wie consoles.js (stages, names, stage, stop)
  win.Consoles = { helmInfo(ship) { const h = (ship && ship.helm) || {}; return { stages: h.stages || [], names: (h.stageNames || []).map((s) => String(s).replace('¼', '1/4').replace('½', '1/2').replace('¾', '3/4')), stage: h.stage != null ? h.stage : 0, stop: h.stop != null ? h.stop : 0 }; } };
  return win;
}
const win = umgebung();
const TA = win.HauptschirmTafeln, TK = win.HauptschirmTokens.TOKENS, TF = TK.TAFEL;

// Render.text mitschreiben (Text, Position, Skala, Farbe); gezeichnet wird nichts
function textLog(w) {
  const log = [], R = w.Render, orig = R.text;
  R.text = (ctx, str, x, y, o) => { log.push({ str: String(str), x, y, scale: (o && o.scale) || 1, color: o && o.color, align: (o && o.align) || 'left' }); };
  R.measure = (s, sk) => String(s).length * 6 * (sk || 1);
  return { log, undo() { R.text = orig; } };
}

// ------------------------------------------------------------------ Ansicht
function ansicht(o) {
  o = o || {};
  const kurs = o.kurs != null ? o.kurs : 217;
  const ship = Object.assign({ x: 1500, y: 1100, angle: win.Shared_Physics.radAusKompass(kurs), speed: 83.4, hull: 77, hullMax: 100,
    helm: { stages: [-30, 0, 35, 65, 98, 130], stageNames: ['R', 'STOPP', '¼', '½', '¾', 'VOLL'], stage: 3, stop: 1 }, jump: o.jump === undefined ? { dest: 'Methalle', charge: 0, ready: false, anflug: true } : o.jump }, o.ship || {});
  const f = (vor, seit) => ({ x: ship.x + Math.cos(ship.angle) * vor - Math.sin(ship.angle) * seit, y: ship.y + Math.sin(ship.angle) * vor + Math.cos(ship.angle) * seit });
  const jp = o.jp !== undefined ? o.jp : [Object.assign({ k: '0503-0504', z: 'aktiv', n: '0504' }, f(1200, 0))];
  const space = { w: 6000, h: 6000, so: [], jp, markers: o.markers || [], hidden: [], salvage: [], mines: [] };
  return { time: 1, pid: 'a', me: { console: 'helm' }, ship: null, enemies: o.enemies || [], escorts: [], spaceProjectiles: [],
    state: { time: 1, ship, space, players: [], flotte: {}, inventory: {}, zonen: { in: [], bk: [] }, world: { location: 'kreuzweg' } }, f };
}
const RECT = (() => { const zoom = 288 / 820; return { x: 0, y: 0, w: 512, h: 288, side: 256 / zoom, sicht: { x: 0, y: 0, w: 512, h: 288 } }; })();
const innen = (r, w, h) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const schneidet = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ------------------------------------------------------------------ (a) Geometrie
section('(a) Geometrie');
{
  const v = ansicht(), L = TA.lage(v);
  ok(L.links && L.rechts && innen(L.links, 512, 288) && innen(L.rechts, 512, 288), 'beide Tafeln im Schirm: ' + JSON.stringify([L.links, L.rechts]));
  ok(!schneidet(L.links, L.rechts), 'Tafeln überlappen nicht');
  ok(L.rechts.x - (L.links.x + L.links.w) >= TF.mitteFreiMin, 'Mitte oben mindestens ' + TF.mitteFreiMin + ' px frei (' + (L.rechts.x - L.links.x - L.links.w) + ')');
  ok(L.links.x + L.links.w / 2 < 256 && L.rechts.x + L.rechts.w / 2 > 256 && L.links.y === TF.links.y && L.rechts.y === TF.rechts.y, 'Tafeln sitzen oben links und oben rechts');
  const S = TA.sperren(v);
  ok(S.length === 2 && S.every((q, i) => { const t = i ? L.rechts : L.links; return q.x === t.x - TF.sperrAbstand && q.w === t.w + 2 * TF.sperrAbstand && q.y === t.y - TF.sperrAbstand; }), 'Sperrflächen = Tafeln + sperrAbstand ' + TF.sperrAbstand);
  const ohne = TA.lage(ansicht({ jump: {} }));
  ok(ohne.rechts === null && TA.sperren(ansicht({ jump: {} })).length === 1, 'ohne Sprungziel entfällt die rechte Tafel (und ihre Sperre)');
  const schmal = TA.lage(v, { szeneBreite: 100, szeneUnten: 24 }), breit = TA.lage(v, { szeneBreite: 232, szeneUnten: 37 });
  ok(!schmal.versetzt && schmal.links.y === TF.links.y, 'schmale Szenenzeile (100 px) passt in die Mitte, Tafeln bleiben oben');
  ok(breit.versetzt && breit.links.y >= 37 && breit.rechts.y >= 37 && innen(breit.links, 512, 288) && innen(breit.rechts, 512, 288), 'breite Szenenzeile (232 px) schiebt beide Tafeln unter die Zeile (y ' + breit.links.y + ')');
}

// ------------------------------------------------------------------ (b) Texte gegen Datenwerte
section('(b) Texte gegen Datenwerte');
function zeichneMitLog(v, opt) {
  const t = textLog(win), flog = [], ctx = neueFlaeche(flog);
  const m0 = win.meldungen.length;
  TA.zeichne(ctx, v, opt);
  t.undo();
  return { texte: t.log, flaeche: flog, neueMeldungen: win.meldungen.length - m0 };
}
const finde = (texte, s) => texte.filter((x) => x.str === s);
{
  const v = ansicht(), L = TA.lage(v), r = zeichneMitLog(v);
  const d = TA.daten(v);
  ok(d.kurs === 217 && d.tempo === 83 && d.stufe === '1/2' && d.sprung && d.sprung.entfernung === 1200, 'daten(): Kurs 217, Tempo 83, Stufe 1/2, Boje 1200 m (' + JSON.stringify([d.kurs, d.tempo, d.stufe, d.sprung && d.sprung.entfernung]) + ')');
  const k = finde(r.texte, '217°');
  ok(k.length === 1 && k[0].scale === TK.TEXT.skalaGross && k[0].x === L.links.x + TF.links.kurs.wertX && k[0].y === L.links.y + TF.links.kurs.wertY && k[0].color === TK.FARBE.kurs, 'Kurs 217 als „217°“, Skala 3, Bernstein, an der Token-Stelle');
  const bandKarten = ['N', 'O', 'S', 'W'].filter((c) => finde(r.texte, c).length);
  ok(bandKarten.join('') === 'S', 'Kursband bei 217° zeigt nur „S“ (Süd bei 180°, ±40°): ' + bandKarten.join(''));
  ok(finde(zeichneMitLog(ansicht({ kurs: 90 })).texte, 'O').length === 1 && finde(zeichneMitLog(ansicht({ kurs: 90 })).texte, 'O')[0].x === Math.round(L.links.x + TF.links.band.x + TF.links.band.w / 2), 'Kurs 90: „O“ steht auf der Bandmitte');
  const tp = finde(r.texte, '83');
  ok(tp.length === 1 && tp[0].scale === TK.TEXT.skalaGross && tp[0].x === L.links.x + TF.links.tempo.wertX, 'Tempo „83“, Skala 3, in der Tempo-Spalte');
  const sf = finde(r.texte, '1/2');
  ok(sf.length === 1 && sf[0].scale === TF.links.stufe.skala && sf[0].x === L.links.x + TF.links.stufe.x && sf[0].y === L.links.y + TF.links.stufe.y, 'Schubstufe als Wort aus helmInfo („1/2“ statt ½), Skala 2');
  const nm = finde(r.texte, 'METHALLE'), bj = finde(r.texte, 'BOJE · 1200');
  ok(nm.length === 1 && nm[0].scale === TF.rechts.ziel.skala && nm[0].x === L.rechts.x + TF.rechts.ziel.wertX && nm[0].color === TF.rechts.farbe, 'Sprungziel-Name (Messing, Skala 2) wie Hud/Render.locName');
  ok(bj.length === 1 && bj[0].scale === TF.rechts.boje.skala && bj[0].y === L.rechts.y + TF.rechts.boje.y, 'Boje 1200 m voraus -> „BOJE · 1200“ (Skala 2)');
  const rot = r.flaeche.filter((e) => e.k === 'rotate').map((e) => e.a[0]);
  ok(rot.length === 1 && Math.abs(rot[0] - (-Math.PI / 2)) < 1e-9, 'Peilpfeil: Boje genau voraus -> Pfeil zeigt nach oben (rotate ' + (rot[0] && rot[0].toFixed(3)) + ')');
  const sb = ansicht(); sb.state.space.jp = [Object.assign({ k: '0503-0504', n: '0504' }, sb.f(0, 800))];   // rechts (Steuerbord) der Nase
  const rot2 = zeichneMitLog(sb).flaeche.filter((e) => e.k === 'rotate').map((e) => e.a[0]);
  ok(rot2.length === 1 && Math.abs(Math.sin(rot2[0])) < 1e-9 && Math.cos(rot2[0]) > 0, 'Peilpfeil: Boje seitlich rechts -> Pfeil zeigt nach rechts (rotate ' + (rot2[0] && rot2[0].toFixed(3)) + ')');
  const nah = ansicht({ jp: [Object.assign({ k: 'a', n: '9999' }, ansicht().f(900, 0)), Object.assign({ k: 'b', n: '9998' }, ansicht().f(300, 100))] });
  ok(TA.daten(nah).sprung.entfernung === Math.round(Math.hypot(300, 100)) || Math.abs(TA.daten(nah).sprung.entfernung - 316) <= 1, 'ohne Boje zum Ziel: die nächste Sprungboje (316 m)');
  const zwei = ansicht({ jump: { dest: 'leer-0504', anflug: true }, jp: [Object.assign({ k: 'a', n: '0999' }, ansicht().f(300, 100)), Object.assign({ k: 'b', n: '0504' }, ansicht().f(900, 0))] });
  ok(TA.daten(zwei).sprung.entfernung === 900, 'die Boje zum Ziel (Hex 0504) gilt, nicht die nähere (900 m statt 316 m)');
  ok(TA.daten(ansicht({ jump: { dest: 'leer-0504', anflug: true, jp: 'a' }, jp: zwei.state.space.jp })).sprung.entfernung === 316, 'jump.jp (Kante des gewählten Ziels) hat Vorrang');
  ok(TA.daten(ansicht({ jump: { dest: 'leer-0504', anflug: false } })).sprung.boje === null, 'ohne Anflugpflicht (Tutorial) keine Boje');
  ok(r.neueMeldungen === 0, 'kein gemeldeter Fehler');
}

// ------------------------------------------------------------------ (c) Skalen laut Tokens, Ladebalken
section('(c) Skalen und Ladebalken');
{
  const v = ansicht(), r = zeichneMitLog(v);
  const erlaubt = new Set([TK.TEXT.skalaKopf, TK.TEXT.skalaGross, TK.TEXT.skalaWert]);
  ok(r.texte.every((x) => erlaubt.has(x.scale)), 'jede Skala ist ein Token (' + [...new Set(r.texte.map((x) => x.scale))].join(',') + ')');
  const kopf = r.texte.filter((x) => ['KURS', 'TEMPO', 'SPRUNGZIEL'].includes(x.str));
  ok(kopf.length === 3 && kopf.every((x) => x.scale === TK.TEXT.skalaKopf && x.color === TF.kappe.farbeText), 'Tafelköpfe KURS, TEMPO, SPRUNGZIEL: Skala 1 in Kappenfarbe');
  const lv = ansicht({ jump: { dest: 'Methalle', charge: 0.45, ready: false, anflug: true } }), rl = zeichneMitLog(lv), L = TA.lage(lv);
  ok(finde(rl.texte, 'SPRUNG LÄDT 45 %').length === 1 && finde(rl.texte, 'SPRUNGZIEL').length === 0, 'beim Laden zeigt der Kopf „SPRUNG LÄDT 45 %“');
  const bw = L.rechts.w - 2 * TF.rechts.ziel.kopfX, by = L.rechts.y + TF.rechts.laden.balkenY;
  const balken = rl.flaeche.filter((e) => e.k === 'fillRect' && e.a[1] === by && e.a[3] === TF.rechts.laden.balkenH);
  ok(balken.length === 2 && balken[0].a[2] === bw && balken[0].fill === TF.rechts.laden.spur && balken[1].a[2] === Math.round(bw * 0.45) && balken[1].fill === TF.rechts.laden.farbe, 'Ladebalken: Spur ' + bw + ' px, Füllung ' + Math.round(bw * 0.45) + ' px = 45 %');
  const pz = rl.texte.find((x) => x.str === '45 %');
  ok(pz && pz.scale === TK.TEXT.skalaWert && pz.align === 'right' && pz.y === L.rechts.y + TF.rechts.boje.y && TF.rechts.laden.balkenH >= 5, 'Laden: Prozentzahl „45 %“ in Skala 2, rechtsbündig in der Bojenzeile, Balken >= 5 px');
  ok(zeichneMitLog(ansicht()).flaeche.filter((e) => e.k === 'fillRect' && e.a[1] === by && e.a[3] === TF.rechts.laden.balkenH).length === 0, 'ohne Ladung kein Balken');
  const bereit = zeichneMitLog(ansicht({ jump: { dest: 'Methalle', charge: 1, ready: true, anflug: false } }));
  ok(finde(bereit.texte, 'BEREIT').length === 1 && finde(bereit.texte, 'SPRUNGZIEL').length === 1, 'Sprung bereit (ohne Boje): „BEREIT“, Kopf bleibt SPRUNGZIEL');
  const lang = ansicht({ jump: { dest: 'WWWWWWWWWWWWWWWWWWWWWWWWW', anflug: false } }), rn = zeichneMitLog(lang);
  const name = rn.texte.find((x) => x.scale === 2 && x.y === TA.lage(lang).rechts.y + TF.rechts.ziel.wertY);
  ok(name && name.str.endsWith('…') && win.Render.measure(name.str, 2) <= TF.rechts.ziel.maxBreite, 'langer Name ohne Nummer wird am Ende mit „…“ gekürzt und passt: ' + (name && name.str));
}
// S2/S3: Name mit Nummer am Ende: der Name vor der Nummer wird gekürzt, die Nummer bleibt; Leerraum-Ziel „LEER 0504“
function pruefeKuerzung(w, rep) {
  const T2 = w.HauptschirmTafeln, Tk = w.HauptschirmTokens.TOKENS, mt = textLog(w);
  const v = ansicht({ jump: { dest: 'WWWWWWWWWWWWWWWWWWWWWWWW 0504', anflug: false } });
  T2.zeichne(neueFlaeche([]), v); mt.undo();
  const nm = mt.log.find((x) => x.scale === 2 && x.y === T2.lage(v).rechts.y + Tk.TAFEL.rechts.ziel.wertY);
  rep(!!nm && / 0504$/.test(nm.str) && nm.str.includes('…') && w.Render.measure(nm.str, 2) <= Tk.TAFEL.rechts.ziel.maxBreite, 'Name mit Nummer: Nummer bleibt ganz, Name davor gekürzt, Breite <= maxBreite (' + (nm && nm.str) + ')');
  const m2 = textLog(w), v2 = ansicht({ jump: { dest: 'leer-0504', anflug: false } });
  T2.zeichne(neueFlaeche([]), v2); m2.undo();
  rep(m2.log.some((x) => x.str === 'LEER 0504'), 'Leerraum-Ziel zeigt „LEER 0504“ ungekürzt (' + m2.log.filter((x) => x.scale === 2).map((x) => x.str).join('|') + ')');
}
section('(c2) Kürzung nie an der Nummer');
pruefeKuerzung(win, ok);

// ------------------------------------------------------------------ (d) keine Hülle, fehlende Daten
section('(d) keine Hülle, fehlende Daten');
{
  const v = ansicht(), r = zeichneMitLog(v);
  ok(!r.texte.some((x) => /H[ÜU]LLE|HULL|^77$|77 ?%/i.test(x.str)), 'keine Hülle auf dem Hauptschirm (Hülle 77 taucht nirgends auf)');
  const faelle = [['view null', null], ['view leer', {}], ['state leer', { state: {} }], ['Schiff leer', { state: { ship: {} } }], ['Sprungziel ohne Rest', { state: { ship: { jump: { dest: 'x' } } } }],
    ['kaputte Werte', { state: { ship: { angle: NaN, speed: 'a', jump: { dest: 'leer-0101', charge: NaN, anflug: true, jp: 5 }, helm: { stages: 'x' } }, space: { jp: [null, { x: NaN }, { x: 1, y: 1 }] } } }],
    ['jp ohne Schiffsort', { state: { ship: { jump: { dest: 'leer-0101', anflug: true } }, space: { jp: [{ x: 1, y: 2, k: 'a' }] } } }]];
  for (const [name, view] of faelle) {
    const log = [], ctx = neueFlaeche(log), m0 = win.meldungen.length, t = textLog(win);
    let wirft = null;
    try { TA.zeichne(ctx, view); TA.sperren(view); TA.daten(view); } catch (e) { wirft = e; }
    t.undo();
    const sv = log.filter((e) => e.k === 'save').length, rs = log.filter((e) => e.k === 'restore').length;
    ok(!wirft && win.meldungen.length === m0 && sv === rs, name + ': kein Wurf, kein gemeldeter Fehler, save/restore ausgeglichen' + (wirft ? ' (' + wirft.message + ')' : ''));
  }
  const ohneConsoles = umgebung(); delete ohneConsoles.Consoles; delete ohneConsoles.Shared_Physics;
  let w2 = null; try { ohneConsoles.HauptschirmTafeln.zeichne(neueFlaeche([]), ansicht()); } catch (e) { w2 = e; }
  ok(!w2 && ohneConsoles.meldungen.length === 0, 'ohne Consoles und Shared_Physics: kein Wurf (Kurs aus der Formel, Stufe fehlt)');
}

// ------------------------------------------------------------------ (e) Frontsicht Skala 2, keine Überlagerung
// Szene: Schiff Kurs 0 (Norden); vier Gegner, Station, Ort außerhalb (Randpfeil), Dock-Ring, Sprungboje des Ziels weit voraus (Randpfeil „SPRUNG 1200“)
function szeneGefecht(kurs) {
  const v = ansicht({ kurs, jump: { dest: 'leer-0504', anflug: true, charge: 0, ready: false } });
  const f = v.f, g = (id, kind, vor, seit, extra) => Object.assign({ id, kind, vk: 'ger', hp: 10, hpMax: 10, angle: 1, shields: [2, 2, 2, 2] }, f(vor, seit), extra || {});
  v.enemies = [g('e1', 'raider', 220, 60), g('e2', 'korvette', 260, 90), g('e3', 'fregatte', 180, -140), g('e4', 'kreuzer', 400, 20)];
  const mk = (id, kind, vor, seit, extra) => Object.assign({ id, kind }, f(vor, seit), extra || {});
  v.state.space.markers = [mk('h', 'station', 300, 150, { name: 'Hafen' }), mk('d', 'dock', 300, 150, { r: 70 }), mk('x', 'station', 1500, -900, { name: 'Fern' }), mk('a', 'station', 330, -200, { name: 'Alpha' }), mk('b', 'station', 330, -71, { name: 'Beta' })];   // Alpha und Beta: 45 px nebeneinander, ihre Skala-2-Labels (62 und 50 px) überlappen ohne Entzerrung
  v.state.space.jp = [Object.assign({ k: '0503-0504', z: 'aktiv', n: '0504' }, f(1200, 0))];
  v.state.ship.target = 'e1';
  return v;
}
function frontLauf(w, v, rect) {
  const log = [], ctx = neueFlaeche(log);
  w.Render.drawFrontView(ctx, v, rect);
  return log;
}
const KONTUR = 'rgba(5,7,13,0.9)';   // Token FARBE.kontur (tiefraum, 90 %)
function labelRects(log) {
  return log.filter((e) => e.k === 'fillText' && e.fill !== 'rgba(11,14,26,0.85)' && e.fill !== KONTUR).map((e) => {
    const px = parseInt(e.font, 10), w = e.s.length * (px >= 14 ? 12 : 5), h = px >= 14 ? 14 : 7;
    return { s: e.s, px, x: e.align === 'center' ? e.x - w / 2 : e.align === 'right' ? e.x - w : e.x, y: e.y, w, h };
  });
}
function pruefeLabels(w, rep) {
  const ergebnis = [];
  for (const kurs of [0, 90, 217]) {
    const v = szeneGefecht(kurs), rect = Object.assign({}, RECT, { textSkala: TK.TEXT.skalaBeschriftung, sperren: w.HauptschirmTafeln.sperren(v) });
    const labels = labelRects(frontLauf(w, v, rect)).filter((l) => l.s.length > 1 && l.s !== 'NEBEL – SICHT HALBIERT');
    const gross = labels.filter((l) => l.px >= 14);
    rep(labels.length >= 4 && gross.length === labels.length, 'Kurs ' + kurs + ': alle ' + labels.length + ' Beschriftungen der Frontsicht in Skala 2 (14 px) [' + labels.map((l) => l.s).join(' | ') + ']');
    let ueber = 0;
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (schneidet(labels[i], labels[j])) { ueber++; console.log('    Überlagerung: ' + labels[i].s + ' / ' + labels[j].s); }
    rep(ueber === 0, 'Kurs ' + kurs + ': keine Überlagerung der Beschriftungen');
    const rohLog = frontLauf(w, v, rect), kont = rohLog.filter((e) => e.k === 'fillText' && e.fill === KONTUR).length;
    rep(kont === 8 * labels.length, 'Kurs ' + kurs + ': jedes Label mit 8-facher Kontur (' + kont + ' Konturstriche für ' + labels.length + ' Labels)');
    ergebnis.push(labels);
  }
  return ergebnis;
}
section('(e) Frontsicht Skala 2 (nur Hauptschirm)');
const labelStand = pruefeLabels(win, ok);
{
  const v = szeneGefecht(0), pult = labelRects(frontLauf(win, v, Object.assign({}, RECT, { x: 10, y: 26, w: 404, h: 184, side: 729, sicht: undefined })));
  ok(pult.length >= 3 && pult.every((l) => l.px === 8), 'Pult (ohne rect.textSkala): alle ' + pult.length + ' Beschriftungen bleiben Skala 1 (8 px)');
  const hs = labelRects(frontLauf(win, v, Object.assign({}, RECT, { textSkala: 2 }))), ps = hs.find((l) => /^200$/.test(l.s));
  ok(ps && ps.px === 14, 'Peilstrich „200“ in Skala 2');
  const pu = spawnSync(process.execPath, [path.join(__dirname, 'test-frontsicht.js')], { encoding: 'utf8' });
  ok(pu.status === 0, 'tools/test-frontsicht.js (Pult bit-gleich zur Referenz) Exit-Code ' + pu.status);
}

// ------------------------------------------------------------------ (f) Randpfeile und Labels weichen den Tafeln aus
// Ein Ort weit voraus links (Randpfeil trifft den Rand oben links, unter die linke Tafel) und einer voraus rechts (unter die rechte Tafel)
function pfeile(log) {
  const out = [];
  for (let i = 2; i < log.length; i++) if (log[i].k === 'moveTo' && log[i].a[0] === 8 && log[i].a[1] === 0) { const t = log.slice(i - 6, i).reverse().find((e) => e.k === 'translate'); if (t) out.push({ x: t.a[0], y: t.a[1] }); }
  return out;
}
function randSzene() {
  const v = ansicht({ kurs: 0, jp: [], jump: { dest: 'leer-0504', anflug: true } }), f = v.f;
  const mk = (id, kind, vor, seit, extra) => Object.assign({ id, kind }, f(vor, seit), extra || {});
  v.state.space.markers = [mk('l', 'station', 1000, -470, { name: 'Linksoben' }), mk('r', 'station', 1000, 470, { name: 'Rechtsoben' }), mk('l2', 'station', 800, -400, { name: 'Links zwei' })];
  return v;
}
function pruefeAusweichen(w, rep) {
  const v = randSzene(), L = w.HauptschirmTafeln.lage(v), tafeln = [L.links, L.rechts];
  const ohne = pfeile(frontLauf(w, v, Object.assign({}, RECT, { textSkala: 2 })));
  const mit = pfeile(frontLauf(w, v, Object.assign({}, RECT, { textSkala: 2, sperren: w.HauptschirmTafeln.sperren(v) })));
  const inTafel = (p) => tafeln.some((t) => p.x > t.x - 8 && p.x < t.x + t.w + 8 && p.y > t.y - 8 && p.y < t.y + t.h + 8);
  rep(ohne.length >= 2 && ohne.some(inTafel), 'Prüfling: ohne Sperren liegt mindestens ein Randpfeil in einer Tafel (' + ohne.map((p) => p.x + ',' + p.y).join(' ') + ')');
  rep(mit.length >= 2 && !mit.some(inTafel), 'mit Sperren liegt kein Randpfeil in einer Tafel (' + mit.map((p) => p.x + ',' + p.y).join(' ') + ')');
  const labels = labelRects(frontLauf(w, v, Object.assign({}, RECT, { textSkala: 2, sperren: w.HauptschirmTafeln.sperren(v) }))).filter((l) => l.s.length > 3);
  rep(labels.length >= 3 && !labels.some((l) => tafeln.some((t) => schneidet(l, t))), 'mit Sperren überdeckt kein Label eine Tafel (' + labels.length + ' Labels)');
  return mit;
}
section('(f) Ausweichen vor den Tafeln');
pruefeAusweichen(win, ok);

// Boje (Spielobjekt mit eigenem Label, starmap.js) unter der linken Tafel: ihr Label darf die Tafel nicht halb überdecken
function pruefeBojeLabel(w, rep) {
  const v = ansicht({ kurs: 0, jp: [], jump: { dest: 'leer-0504', anflug: true } }), P = w.Render.frontProjektion(v, RECT), sh = v.state.ship;
  const welt = (sx, sy) => { const dx = (sx - P.cx) / P.zoom, dy = (sy - P.cy) / P.zoom; return { x: sh.x + dx * Math.cos(-P.rot) - dy * Math.sin(-P.rot), y: sh.y + dx * Math.sin(-P.rot) + dy * Math.cos(-P.rot) }; };
  v.state.space.jp = [Object.assign({ k: 'x', n: '0503', z: 'aktiv' }, welt(120, 30)), Object.assign({ k: 'y', n: '0505', z: 'aktiv' }, welt(250, 60))];
  const sp = w.HauptschirmTafeln.sperren(v), tafeln = [w.HauptschirmTafeln.lage(v).links];
  const r1 = labelRects(frontLauf(w, v, Object.assign({}, RECT, { textSkala: 2 }))).filter((l) => l.s.length > 3 && l.s !== '200');
  const r2 = labelRects(frontLauf(w, v, Object.assign({}, RECT, { textSkala: 2, sperren: sp }))).filter((l) => l.s.length > 3 && l.s !== '200');
  rep(r1.some((l) => tafeln.some((t) => schneidet(l, t))), 'Prüfling: ohne Sperren überdeckt ein Boje-Label die Tafel (' + r1.map((l) => l.s).join(' | ') + ')');
  rep(!r2.some((l) => tafeln.some((t) => schneidet(l, t))), 'mit Sperren überdeckt kein Boje-Label eine Tafel (' + r2.map((l) => l.s).join(' | ') + ')');
}
pruefeBojeLabel(win, ok);

// ------------------------------------------------------------------ (g) sitz.js: Reihenfolge, Skala, Sperren
// sitz.js im vm (wie test-sitz-projektion): der klassische Zeichner ruft drawFrontView (Attrappe schreibt rect mit) und danach die ECHTEN Tafeln (Aufruf wird mitgeschrieben)
function sitzLauf(sitzQuelle, szene) {
  const reihe = [];
  let fenster = null;
  const w = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'),
    Hud: { szeneVon: () => (szene ? { p: 'k' } : null), szenenHoehe: () => 14, drawSzenenStrip: () => 232 },
    Render: { PAL: new Proxy({}, { get: () => '#fff' }), ui: { buttons: [] }, text() {}, measure: (s, sk) => String(s).length * 6 * (sk || 1), FRONT: { fwd: 700, back: 120 }, locName: (st, id) => String(id),
      drawFrontView(c, v, rect) { reihe.push('drawFrontView'); fenster = rect; } },
    Net: { reportError() {}, guard: (n, f) => f() }, document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }) },
    location: { search: '' }, URLSearchParams, performance: { now: () => 0 }, console };
  w.window = w; w.self = w; vm.createContext(w);
  for (const f of ['hauptschirm-tokens.js', 'hauptschirm-tafeln.js', 'hauptschirm.js']) vm.runInContext(rd(f), w, { filename: f });
  const z0 = w.HauptschirmTafeln.zeichne;
  w.HauptschirmTafeln.zeichne = (...a) => { reihe.push('tafeln'); return z0(...a); };
  vm.runInContext(sitzQuelle, w, { filename: 'sitz.js' });
  const v = ansicht(); v.state.flotte = szene ? { sz: { p: 'k' } } : {};
  w.Consoles = win.Consoles;
  w.Hauptschirm.zeichne(neueFlaeche([]), v, { x: 0, y: 0, w: 512, h: 288 });
  return { reihe, fenster, w, v };
}
section('(g) sitz.js: Zeichner klassisch');
const sitzOrig = rd('sitz.js');
function pruefeSitz(quelle, rep, tag) {
  const a = sitzLauf(quelle, false), b = sitzLauf(quelle, true);
  rep(a.reihe.join() === 'drawFrontView,tafeln', tag + 'Tafeln werden NACH drawFrontView gezeichnet (' + a.reihe.join() + ')');
  rep(a.fenster && a.fenster.textSkala === TK.TEXT.skalaBeschriftung, tag + 'rect.textSkala = Token skalaBeschriftung (' + (a.fenster && a.fenster.textSkala) + ')');
  const soll = a.w.HauptschirmTafeln.sperren(a.v);
  rep(a.fenster && Array.isArray(a.fenster.sperren) && a.fenster.sperren.length === 2 && JSON.stringify(a.fenster.sperren) === JSON.stringify(soll), tag + 'rect.sperren = Sperrflächen der Tafeln');
  rep(b.fenster && b.fenster.sperren && b.fenster.sperren[0].y >= 24 - TF.sperrAbstand + 0 && b.fenster.sperren[0].y > a.fenster.sperren[0].y, tag + 'mit breiter Szenenzeile rücken die Sperrflächen unter die Zeile (y ' + (b.fenster && b.fenster.sperren && b.fenster.sperren[0].y) + ')');
  return a;
}
pruefeSitz(sitzOrig, ok, '');
{
  const fenster = /const fenster = \{[^}]*\{[^}]*\}[^}]*\};/.test(sitzOrig);
  ok(fenster && /R\.drawFrontView\(c, view, fenster\);/.test(sitzOrig) && (sitzOrig.match(/R\.drawFrontView\(/g) || []).length === 1, 'drawFrontView-Aufruf in sitz.js unverändert (ein Aufruf, Fenster als Konstante)');
}

// ------------------------------------------------------------------ (i) Randpfeil-Label des Hauptschirms (Designer 5)
// Mit echter Sektorkarte (Shared_Sektoren): Ziel Rabenpass (Hex 0502) und leerer Hex 0101, Boje weit voraus (außerhalb des Bildes -> Randpfeil)
function pruefeRandLabel(w, rep, tag) {
  w.Shared_Sektoren = require('../shared/sektoren.js');
  const hole = (dest, hex, rect) => {
    const v = ansicht({ kurs: 0, jump: { dest, anflug: true, charge: 0 }, jp: [] }), f = v.f;
    v.state.space.jp = [Object.assign({ k: 'k-' + hex, z: 'aktiv', n: hex }, f(1296, 0))];
    v.state.world.sektoren = { e: ['0502'], b: [], t: [], o: [] };
    return labelRects(frontLauf(w, v, rect)).map((l) => l.s);
  };
  const hs = hole('rabenpass', '0502', Object.assign({}, RECT, { textSkala: 2 })), leer = hole('leer-0101', '0101', Object.assign({}, RECT, { textSkala: 2 }));
  const pult = hole('rabenpass', '0502', Object.assign({}, RECT, { x: 10, y: 26, w: 404, h: 184, side: 729, sicht: undefined }));
  rep(hs.some((t) => /^RABENPASS \d+$/.test(t)) && !hs.some((t) => /SPRUNG/.test(t)), tag + 'Hauptschirm: Randpfeil „RABENPASS <m>“ ohne das Wort SPRUNG [' + hs.join(' | ') + ']');
  rep(leer.some((t) => /^LEER 0101 \d+$/.test(t)), tag + 'Hauptschirm: leerer Hex „LEER 0101 <m>“ [' + leer.join(' | ') + ']');
  rep(pult.some((t) => /^SPRUNG Rabenpass \d+$/.test(t)), tag + 'Pult unverändert: „SPRUNG Rabenpass <m>“ [' + pult.join(' | ') + ']');
  const rl = w.HauptschirmTafeln.randLabel('Castra Martis Hafenstadt', '0102', 800);
  rep(rl === 'CASTRA MA 800', tag + 'randLabel kürzt den Namen auf 9 Zeichen (' + rl + ')');
}
section('(i) Randpfeil-Label des Hauptschirms');
pruefeRandLabel(win, ok, '');

// ------------------------------------------------------------------ (h) Mutationen
section('(h) Mutationen');
function mutiere(was, quelleDatei, ersatz, pruefung) {
  const alt = rd(quelleDatei), neu = alt.split(ersatz[0]).join(ersatz[1]);
  if (neu === alt) { ok(false, was + ': Mutation greift nicht (Muster fehlt)'); return; }
  let rot = 0, gesamt = 0;
  pruefung(neu, (c) => { gesamt++; if (!c) rot++; });
  ok(rot > 0, was + ': rot (' + rot + ' von ' + gesamt + ' Prüfungen schlagen an)');
}
mutiere('Tafel VOR drawFrontView', 'sitz.js', ['    R.drawFrontView(c, view, fenster);\n    if (TA) TA.zeichne(c, view, tafelOpt);', '    if (TA) TA.zeichne(c, view, tafelOpt);\n    R.drawFrontView(c, view, fenster);'], (q, rep) => pruefeSitz(q, rep, ''));
mutiere('Sitz ohne textSkala', 'sitz.js', ['    if (HT) fenster.textSkala = HT.TOKENS.TEXT.skalaBeschriftung;\n', ''], (q, rep) => pruefeSitz(q, rep, ''));
mutiere('Sitz ohne Sperren', 'sitz.js', ['    if (TA) fenster.sperren = TA.sperren(view, tafelOpt);\n', ''], (q, rep) => pruefeSitz(q, rep, ''));
mutiere('drawFrontView reicht rect.sperren nicht weiter', 'render.js', [', sperren: rect.sperren });', ' });'], (q, rep) => pruefeAusweichen(umgebung({ 'render.js': q }), rep));
mutiere('drawSpace reicht cam.sperren nicht an die Boje-Labels', 'render.js', ['sperren: front ? cfg.sperren : undefined, ', ''], (q, rep) => pruefeBojeLabel(umgebung({ 'render.js': q }), rep));
mutiere('drawFrontView reicht rect.textSkala nicht weiter', 'render.js', [', textSkala: rect.textSkala,', ','], (q, rep) => pruefeLabels(umgebung({ 'render.js': q }), rep));
mutiere('drawSpace ignoriert die Skala (Entzerrung bleibt Skala 1)', 'render.js', ['measure(l.str, tsk) + 2', 'measure(l.str, 1) + 2'], (q, rep) => pruefeLabels(umgebung({ 'render.js': q }), rep));

mutiere('Kürzen am Ende statt vor der Nummer', 'hauptschirm-tafeln.js', ['    if (m) {', '    if (false) {'], (q, rep) => pruefeKuerzung(umgebung({ 'hauptschirm-tafeln.js': q }), rep));
mutiere('Randpfeil-Label des Hauptschirms ohne Kurzform', 'starmap.js', ['if (cam.front && cam.textSkala > 1 && window.HauptschirmTafeln', 'if (false && window.HauptschirmTafeln'], (q, rep) => pruefeRandLabel(umgebung({ 'starmap.js': q }), rep, ''));
console.log('\n' + (n - fails) + '/' + n + ' ok');
if (fails) { console.log(fails + ' FEHLER'); process.exit(1); }
console.log('Tafeln und Skala 2 ok.');
