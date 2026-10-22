'use strict';
// SUND-01 Paket C (Client): Übersichtskarte Sund nach dem Wissen von Rom – Zeichenlogik mit Fake-Canvas (kein Browser).
//   KarteLage (Zeichenhilfen, Ansichtsmodell, Spalte) und StarMap.draw mit world.lage: kein Fehler bei leerem und vollem Block, Altstand, 0 und 12 Flotten,
//   Zoom-Stufen, Nahansicht, Hexradius 23,6 der Ausgangsansicht; ohne world.lage bleibt die Karte wie vorher (Kampagne, Limes).
//   node tools/test-lage-karte.js   (npm run test:lage-karte)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const T = require('../public/js/karte-tokens.js');
const KL = require('../public/js/karte-lage.js');
const KZ = require('../public/js/kartenzeichen.js');
const KA = require('../public/js/kartenansicht.js');
const SUND = require('../content/welt/sund_frei.json');
const LIMES = require('../content/welt/limes.json');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const CODES = T.hexReihenfolge(SUND);

// ------------------------------------------------------------------ Fake-Canvas und Fake-Render
function fakeCtx() {
  const calls = {}, st = {};
  return new Proxy({}, {
    get(_, k) {
      if (k === '__calls') return calls;
      if (k in st) return st[k];
      return (...a) => { calls[k] = (calls[k] || 0) + 1; if (k === 'createPattern') return {}; if (k === 'measureText') return { width: 10 }; return undefined; };
    },
    set(_, k, v) { st[k] = v; return true; },
  });
}
function fakeRender(log) {
  return {
    text(ctx, s, x, y, o) { log.push({ s: String(s), x, y, o }); },
    measure(s) { return String(s).length * 5; },
    wrap(s, w) { return [String(s)]; },
    worldOf(st) { return { location: (st && st.loc) || 'ostia_nova', locations: [] }; },
    drawStarMapAlt() { log.alt = (log.alt || 0) + 1; },
    drawPin() {}, button() {},
  };
}
KL.env.Render = fakeRender([]);

// ------------------------------------------------------------------ Beispielblöcke
const hx = (o) => CODES.map((c) => { const q = (o && o[c]) || null; return q ? q : (SUND.hexe[c].fraktion === 'rom' ? 're' : '-?'); }).join('');
function blockLeer() { return { t: 0, vz: 1, sw: 2, hx: CODES.map(() => '-?').join(''), f: [], m: [] }; }
function blockLageB() {
  const o = {}; for (const c of CODES) { const f = SUND.hexe[c].fraktion; o[c] = (f === 'rom' ? 'r' : f === 'ger' ? 'g' : f === 'saum' ? 'k' : f === 'pirat' ? 'p' : f === 'vorl' ? 'v' : '-') + (f === 'rom' ? 'e' : '9'); }
  Object.assign(o, { '0603': 'Re', '0703': 'r1', '0803': 'g1', '0904': 'g9' });
  return { t: 43, vz: 1, sw: 2, hx: CODES.map((c) => o[c]).join(''),
    f: [{ f: 'g', h: '0803', k: 3, p: 's', a: 1, d: 2 }, { f: 'r', h: '0603', k: 1, p: 'h', a: 0 }, { f: 'g', h: '0904', k: 2, p: 'u', a: 11, v: '0803' }],
    m: [{ e: 'sa', h: '0803', t: 43, f: 'g', k: 3 }, { e: 'pg', h: '0603', t: 38, f: 'r' }] };
}
function block12() {
  const b = blockLageB();
  const arten = ['s', 'm', 'b', 'u', 'r', 'h'], hexe = CODES.filter((c) => SUND.hexe[c].spielbar !== false);
  b.f = []; b.m = [];
  for (let i = 0; i < 12; i++) b.f.push({ f: ['g', 'r', 'k', 'p'][i % 4], h: hexe[i], k: 1 + (i % 3), p: arten[i % 6], a: i % 5 === 4 ? 9 : i % 3 === 0 ? 0 : 1, [i % 4 === 1 ? 'n' : 'v']: hexe[(i + 1) % hexe.length], z: i % 6 === 1 ? hexe[(i + 3) % hexe.length] : undefined, d: i % 6 === 0 ? 2 : undefined });
  for (let i = 0; i < 6; i++) b.m.push({ e: ['sa', 'ma', 'be', 'hf', 'hh', 'pv'][i], h: hexe[i], t: 43 - (i % 2), f: 'g', k: 2 });
  return b;
}

// =============================================================================================================================
section('Tokens: Alterszeichen und hxLesen');
{
  const rt = []; for (let a = 0; a <= 40; a++) rt.push(T.alterLesen(T.alterZeichen(a)));
  ok(T.alterZeichen(0) === 'e' && T.alterZeichen(null) === '?' && T.alterZeichen(14) !== 'e' && T.alterZeichen(99) === 'z', 'Alterszeichen: 0 = e, null = ?, 14 ist nicht e, ab 34 z');
  ok(rt.slice(0, 34).every((v, a) => v === a) && rt[40] === 34, 'Hin und zurück für 0 bis 33 verlustfrei, darüber 34');
  const h = T.hxLesen(blockLageB().hx, CODES);
  ok(h['0603'].f === 'r' && h['0603'].posten && h['0603'].alter === 0 && h['0803'].alter === 1 && h['0904'].alter === 9, 'hxLesen: Posten, Alter');
  ok(Object.keys(T.hxLesen('', CODES)).length === 0 && Object.keys(T.hxLesen(null, CODES)).length === 0 && T.hxLesen('x', CODES)['0105'] !== undefined, 'hxLesen: leer, null, ungültig ohne Fehler');
}

// =============================================================================================================================
section('KarteLage.lesen: leer, halb, voll');
{
  const a0 = KL.lesen(null, CODES), a1 = KL.lesen({}, CODES), a2 = KL.lesen({ hx: 5, f: 'x', m: null }, CODES);
  ok([a0, a1, a2].every((a) => a.fl.length === 0 && a.m.length === 0 && a.hell('0803') === false && a.stufe('0803') === 'unbekannt'), 'null, {} und Unsinn ergeben ein leeres Modell');
  const A = KL.lesen(blockLageB(), CODES);
  ok(A.stufe('0603') === 'jetzt' && A.stufe('0803') === 'gesehen' && A.stufe('0904') === 'alt' && A.hell('0803') && !A.hell('0904'), 'Stufen: jetzt, gesehen, alt; hell nur jetzt und gesehen');
  ok(A.fl.length === 3 && A.neu.has('0803') && !A.neu.has('0603'), 'Flotten und „neu“ (Meldung aus dem letzten Tick)');
  const alt = KL.lesen(Object.assign(blockLageB(), { f: [{ f: 'g', h: '0803', k: 1, p: 'h', a: 13 }, { f: 'g', h: '0803', k: 1, p: 'h', a: 12 }] }), CODES);
  ok(alt.fl.length === 1, 'Altstand älter als altMax entfällt');
  const kaputt = KL.lesen({ t: 1, vz: 1, hx: '', f: [{ f: 'q', h: '0803', a: 1 }, { f: 'g', h: 'xx', a: 1 }, null, { f: 'g', h: '0803', k: 2, p: 'h' }] }, CODES);
  ok(kaputt.fl.length === 0, 'Einträge mit unbekannter Fraktion, falschem Hex oder ohne Alter werden verworfen');
}

// =============================================================================================================================
section('KarteLage: Zeichnen ohne Fehler');
{
  const ctx = fakeCtx();
  const log = []; KL.env.Render = fakeRender(log);
  const V = { s: 23.6, h3: Math.sqrt(3) * 23.6, hexe: CODES, bereich: 'voll',
    mitte: (h) => { const c = +h.slice(0, 2), r = +h.slice(2); return { x: 30 + 23.6 * (1 + 1.5 * (c - 1)), y: 20 + 23.6 * (Math.sqrt(3) / 2 + Math.sqrt(3) * (r - 1) + (c % 2 === 0 ? Math.sqrt(3) / 2 : 0)) }; },
    nachbarn: (h) => { const c = +h.slice(0, 2), r = +h.slice(2); const f = (a, b) => (a < 10 ? '0' : '') + a + (b < 10 ? '0' : '') + b; const cand = c % 2 ? [[c, r - 1], [c, r + 1], [c - 1, r - 1], [c - 1, r], [c + 1, r - 1], [c + 1, r]] : [[c, r - 1], [c, r + 1], [c - 1, r], [c - 1, r + 1], [c + 1, r], [c + 1, r + 1]]; return cand.filter(([a, b]) => a >= 1 && a <= 11 && b >= 1 && b <= 7).map(([a, b]) => f(a, b)); },
    weg: (a, b) => [a, b] };
  for (const [name, blk] of [['leer', blockLeer()], ['Lage B', blockLageB()], ['12 Flotten', block12()], ['null', null]]) {
    const A = KL.lesen(blk, CODES);
    let fehler = null;
    try {
      for (const h of CODES) KL.flaeche(ctx, V.mitte(h), V.s, A, h, 'g');
      KL.sichtgrenze(ctx, A, V); KL.front(ctx, A, V);
      KL.flotten(ctx, A, V, { notrufHex: new Set(['0803']) });
      for (const s of [8, 14, 21.9, 22, 23.6, 40]) KL.flotten(ctx, A, Object.assign({}, V, { s, h3: Math.sqrt(3) * s, bereich: T.bereich(s) }), {});
      const o = { rx: 432, rw: 196, y: 50, sel: '0803', name: (h) => h, art: () => 'Art', hafen: () => 'D', karteFraktion: () => 'g', dist: () => 3, kurs: () => 0 };
      KL.ortsinfo(ctx, A, o); KL.meldeliste(ctx, A, o); KL.legende(ctx, 432, 250);
      KL.ortsinfo(ctx, A, Object.assign({}, o, { sel: null })); KL.ortsinfo(ctx, A, Object.assign({}, o, { sel: '0105' }));
    } catch (e) { fehler = e; }
    ok(!fehler, name + ': Flächen, Sichtgrenze, Front, Flotten (alle Hexradien), Ortsinfo, Meldeliste, Legende ohne Fehler' + (fehler ? ' – ' + fehler.stack : ''));
  }
  const A = KL.lesen(blockLageB(), CODES);
  const seiten = KL.sichtgrenze(fakeCtx(), A, V);
  ok(seiten > 0, 'Sichtgrenze: ' + seiten + ' Hexseiten zwischen hell und dunkel');
  ok(KL.front(fakeCtx(), A, V) === KL.frontSeiten(A, V).length, 'Front: eine Bake je Seite Rom|Germanen');
  const fl = KL.frontSeiten(KL.lesen({ t: 1, vz: 1, hx: blockLageB().hx.replace(/^(..)/, '$1'), f: [], m: [] }, CODES), V).every(([a, b]) => { const h = T.hxLesen(blockLageB().hx, CODES); return (h[a].f === 'r' && h[b].f === 'g') || (h[a].f === 'g' && h[b].f === 'r'); });
  ok(fl, 'Front nur zwischen bekanntem Rom und bekannten Germanen (Konkordat neutral)');
  // Plakettenbreiten: 22 ohne Phase, Phase S 30 (Maße der Tokens)
  const q = (p) => ({ f: 'g', k: 3, p, a: 1, stufe: 'gesehen' });
  ok(KL.plBreite(q('h')) === 22 && KL.plBreite(q('s')) === 30 && KL.plBreite({ f: 'g', k: 1, p: 's', a: 11, stufe: 'alt' }) > 30, 'Plakettenbreite: 22 ohne Phasenfeld, 30 mit S, breiter mit zweistelligem Alter im Phasenfeld');
  // Nahansicht
  const adj = { '0603': ['0503', '0703', '0604'], '0503': ['0603', '0403'], '0703': ['0603', '0803'], '0803': ['0703', '0904'], '0904': ['0803'], '0403': ['0503'], '0604': ['0603'] };
  const nah = KL.fokusHexe('nah', CODES, '0603', adj), uebers = KL.fokusHexe('uebersicht', CODES, '0603', adj);
  ok(nah.has('0603') && nah.has('0803') && nah.has('0403') && !nah.has('0904') && uebers.size === CODES.length, 'Nahansicht: Lerche plus 2 Sprünge, Übersicht: alle Kartenhexe');
}

// =============================================================================================================================
// StarMap mit Fake-Fenster: je Szenario eine frische Karte (eigener Zustand)
function neueKarte(opts) {
  const log = []; const mess = []; const listener = [];
  const R = fakeRender(log);
  const win = { Kartenzeichen: KZ, KarteTokens: T, KarteLage: opts && opts.ohneLage ? undefined : KL, KartenAnsicht: KA, Render: R, Net: { on: (f) => { listener.push(f); return () => {}; }, reportError: (l, e) => mess.push(l + ': ' + (e && e.message)) } };
  KL.env.Render = R;
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'starmap.js'), 'utf8');
  vm.runInNewContext('(function (window) {' + src + '\n})(win)', { win, performance, console });
  win.StarMap.setKarte(opts && opts.karte || SUND);
  return { win, SM: win.StarMap, log, mess, senden: (m) => listener.forEach((f) => f(m)),
    zeichne: (rect, state, o) => { const ctx = fakeCtx(); log.length = 0; log.alt = 0; const res = win.StarMap.draw(ctx, { state: state || { loc: 'ostia_nova', ship: { scene: 'ostia_nova' } }, time: 1 }, rect || { x: 12, y: 48, w: 410, h: 272 }, Object.assign({ ansichtKey: 't' }, o)); return { res, ctx, texte: log.map((l) => l.s), alt: log.alt || 0 }; } };
}
const RECT = { x: 12, y: 48, w: 410, h: 272 };

section('StarMap mit world.lage: Ausgangsansicht (Hexradius 23,6, ohne Seitenleiste, ohne Koordinate)');
{
  const k = neueKarte();
  k.senden({ t: 'snap', phase: 'play', world: { lage: blockLageB() } });
  ok(k.SM.lageAktiv(), 'lageAktiv nach world.lage');
  const r = k.zeichne();
  ok(r.alt === 0 && k.mess.length === 0, 'kein Rückfall auf die Punktkarte, keine gemeldeten Fehler ' + JSON.stringify(k.mess));
  ok(Math.abs(r.res.scale - 23.6) < 0.1, 'Hexradius der Ausgangsansicht ' + r.res.scale.toFixed(2) + ' (Soll 23,6)');
  ok(!r.texte.some((s) => /^\d{4}$/.test(s)), 'keine Koordinate im Hex');
  ok(r.texte.includes('KARTE SUND · ÜBERSICHT') || r.texte.some((s) => /ÜBERSICHT/.test(s)), 'Beschriftung „… · ÜBERSICHT“');
  ok(r.texte.includes('G') && r.texte.includes('R') && r.texte.includes('S'), 'Plaketten: Buchstaben G und R, Phase S');
  ok(!r.texte.some((s) => /AUSSCHNITT/.test(s)), 'kein „AUSSCHNITT“');
  ok(k.SM.lageModell() && k.SM.lageModell().A.fl.length === 3, 'Modell für die Spalte der Konsole');
  // Altstand, leer, 12 Flotten, kaputt
  for (const [name, b] of [['leer', blockLeer()], ['12 Flotten', block12()], ['leerer Block', {}], ['Block ohne hx', { t: 3, vz: 1, f: [], m: [] }]]) {
    k.senden({ t: 'snap', phase: 'play', world: { lage: b } });
    const x = k.zeichne();
    ok(x.alt === 0 && k.mess.length === 0, name + ': gezeichnet, kein Fehler');
  }
}

section('StarMap: Zoom-Stufen, Nahansicht, kleine Konsole');
{
  const k = neueKarte();
  k.senden({ t: 'snap', phase: 'play', world: { lage: block12() } });
  let r = k.zeichne({ x: 12, y: 48, w: 410, h: 272 }, null, { ansichtKey: 'zoom' });
  const s0 = r.res.scale;
  const stufen = [s0];
  for (let i = 0; i < 4; i++) { KA.rad(200, 180, -100); r = k.zeichne(RECT, null, { ansichtKey: 'zoom' }); stufen.push(r.res.scale); ok(r.alt === 0 && !k.mess.length, 'Zoom-Stufe ' + (i + 1) + ' (Hexradius ' + r.res.scale.toFixed(1) + '): kein Fehler'); }
  ok(stufen.every((v, i) => i === 0 || v > stufen[i - 1]), 'Hexradius wächst mit dem Zoom: ' + stufen.map((v) => v.toFixed(1)).join(' → '));
  ok(stufen[stufen.length - 1] >= T.MASS.hexradius.voll, 'höchste Stufe liegt im Bereich „voll“');
  KA.zuruecksetzen('zoom');
  // kleine Konsole (Planungstisch): Hexradius „knapp“, Kurzplaketten
  r = k.zeichne({ x: 0, y: 0, w: 200, h: 130 }, null, { ansichtKey: 'klein' });
  ok(r.alt === 0 && r.res.scale < T.MASS.hexradius.voll && r.res.scale >= T.MASS.hexradius.knapp - 6, 'kleine Karte (Hexradius ' + r.res.scale.toFixed(1) + '): Kurzplaketten, kein Fehler');
  // Taste M: Nahansicht
  ok(k.SM.toggleAnsicht() === 'nah' && k.SM.lageAnsicht === 'nah', 'M: Nahansicht');
  r = k.zeichne(RECT, { loc: 'kantenstein', ship: { scene: 'kantenstein' } }, { ansichtKey: 'nah' });
  ok(r.alt === 0 && r.res.scale <= T.MASS.hexradius.nahMax + 0.01 && r.res.scale > 23.6, 'Nahansicht: größerer Hexradius (' + r.res.scale.toFixed(1) + ' ≤ ' + T.MASS.hexradius.nahMax + ')');
  ok(!r.texte.some((s) => /NAHANSICHT|ÜBERSICHT/.test(s)), 'Nahansicht: kein Kartenetikett (SUND-01 F: es überdeckte Hexnamen; die Fußzeile nennt die Ansicht)');
  ok(k.SM.toggleAnsicht() === 'uebersicht', 'M noch einmal: zurück zur Übersicht');
}

section('Ohne world.lage bleibt die Karte wie vorher (Kampagne, Limes)');
{
  for (const [name, karte] of [['Kampagne Sund', JSON.parse(fs.readFileSync(path.join(ROOT, 'content/welt/sund.json'), 'utf8'))], ['Limes', LIMES]]) {
    const k = neueKarte({ karte });
    ok(!k.SM.lageAktiv(), name + ': lageAktiv falsch');
    const r = k.zeichne(RECT, { loc: Object.values(karte.hexe).find((h) => h.ort).ort, ship: { scene: Object.values(karte.hexe).find((h) => h.ort).ort } });
    ok(r.alt === 0 && !k.mess.length, name + ': alter Pfad zeichnet ohne Fehler');
    ok(r.texte.some((s) => /AUSSCHNITT/.test(s)) && !r.texte.some((s) => /ÜBERSICHT|NAHANSICHT/.test(s)), name + ': Fokus-Ansicht mit „AUSSCHNITT“, keine Übersicht');
    ok(k.SM.toggleAnsicht() === 'gesamt' && k.SM.ansicht === 'gesamt', name + ': M wechselt wie vorher Ausschnitt/gesamt');
    ok(k.SM.lageModell() === null, name + ': kein Lagemodell');
  }
  // dieselbe Karte, aber die Lage kommt und geht (Lobby): zurück zum alten Pfad
  const k = neueKarte();
  k.senden({ t: 'snap', phase: 'play', world: { lage: blockLageB() } });
  ok(k.SM.lageAktiv(), 'Sund-frei mit Block: aktiv');
  k.senden({ t: 'snap', phase: 'lobby' });
  ok(!k.SM.lageAktiv(), 'Lobby: Wissen verworfen');
  // Kartenwechsel verwirft das Wissen
  k.senden({ t: 'snap', phase: 'play', world: { lage: blockLageB() } });
  k.SM.setKarte(LIMES);
  ok(!k.SM.lageAktiv(), 'andere Karte: Wissen verworfen');
  // KarteLage fehlt ganz (Datei nicht geladen): alter Pfad
  const k2 = neueKarte({ ohneLage: true });
  k2.senden({ t: 'snap', phase: 'play', world: { lage: blockLageB() } });
  ok(!k2.SM.lageAktiv() && k2.zeichne().alt === 0, 'ohne karte-lage.js: alter Pfad, kein Fehler');
}

section('Lagefunk-Liste (Funk-Reiter)');
{
  KL.funkLeeren();
  KL.funkMerken({ from: 'POSTEN KANTENSTEIN', text: 'Germanische Flotte sammelt sich bei Ulfsvakt. Stärke groß, Ziel unbekannt.', tick: 43 });
  KL.funkMerken({ from: 'X', text: 'zwei' }); KL.funkMerken(null); KL.funkMerken({ text: 5 });
  for (let i = 0; i < 10; i++) KL.funkMerken({ from: 'Y', text: 'm' + i, tick: i });
  const l = KL.funkListe();
  ok(l.length === 4 && l[0].text === 'm9' && l[0].t === 9, 'Liste: neueste zuerst, höchstens 4, Unsinn wird ignoriert');
  KL.funkLeeren(); ok(KL.funkListe().length === 0, 'leeren');
}

section('Spalte: Texte');
{
  const log = []; KL.env.Render = fakeRender(log);
  const A = KL.lesen(blockLageB(), CODES), name = (h) => ({ '0803': 'Ulfsvakt', '0603': 'Kantenstein', '0904': 'Skjaldborg', '0703': 'Eisfeld' })[h] || h;
  const o = { rx: 432, rw: 196, y: 50, name, art: () => 'Nordtor, Wachposten', hafen: () => 'D', karteFraktion: () => 'g', dist: () => 3, kurs: () => 0 };
  const txts = () => log.map((l) => l.s);
  KL.ortsinfo(fakeCtx(), A, Object.assign({ sel: '0803' }, o)); let t = txts();
  ok(t.includes('Ulfsvakt') && t.includes('Germanen · Hafen D') && t.includes('Gesehen · Stand Tick 42'), 'Ortsinfo gesehen: Name, „Germanen · Hafen D“, „Gesehen · Stand Tick 42“');
  log.length = 0; KL.ortsinfo(fakeCtx(), A, Object.assign({ sel: '0904' }, o)); t = txts();
  ok(t.includes('Außer Sicht · Stand vor 9 Ticks') && t.some((s) => /Nächster Knoten: 3 Sprünge \(Sicht 2\)/.test(s)), 'Ortsinfo Altstand: „vor 9 Ticks“, nächster Knoten (Sicht 2 aus dem Block)');
  log.length = 0; KL.ortsinfo(fakeCtx(), A, Object.assign({ sel: '0105' }, o)); t = txts();
  ok(t.includes('Eigen · aktuell'), 'Ortsinfo eigenes Hex: „Eigen · aktuell“');
  log.length = 0; KL.ortsinfo(fakeCtx(), KL.lesen(blockLeer(), CODES), Object.assign({ sel: '1004' }, o)); t = txts();
  ok(t.includes('Außer Sicht · nie gesehen'), 'Ortsinfo nie gesehen');
  log.length = 0; const res = KL.meldeliste(fakeCtx(), A, Object.assign({ sel: '0803' }, o, { rw: 200 })); t = txts();   // SUND-01 F: rw 200, weil der Text jetzt ab x 42 (statt 40) beginnt und die Langform in Fake-Breite 5/Zeichen knapp passt
  ok(t[0] === 'MELDUNGEN · STAND T-1' && t.includes('Ulfsvakt · sammelt seit 2 Ticks') && t.some((s) => /Skjaldborg · vor 11 Ticks/.test(s)), 'Meldeliste: Kopf, „sammelt seit 2 Ticks“, Altstand „vor 11 Ticks“ ' + JSON.stringify(t));
  ok(res.zeilen === 4, 'Meldeliste: 3 Flotten und 1 Ereigniszeile (Posten gegründet); „sammelt“ in der Meldung ist nur das Neu-Zeichen');
  log.length = 0; KL.meldeliste(fakeCtx(), KL.lesen(block12(), CODES), Object.assign({ sel: null }, o)); t = txts();
  ok(t.some((s) => /^\+\d+ weitere$/.test(s)) && t.filter((s) => s !== 'MELDUNGEN · STAND T-1' && !/^\+/.test(s) && s.length > 3).length <= T.MASS.spalte.meldung.max + 2, 'Meldeliste bei vielen Einträgen: höchstens ' + T.MASS.spalte.meldung.max + ' Zeilen und „+n weitere“');
  log.length = 0; KL.meldeliste(fakeCtx(), KL.lesen(blockLeer(), CODES), Object.assign({ sel: null }, o)); t = txts();
  ok(t.includes(T.TEXT.meldeliste.leer), 'leere Liste: „Keine Flotten gemeldet.“');
}

// =============================================================================================================================
section('SUND-01 F: Kurznamen, Meldeliste-Kurzformen, Rangfolge, Legende, Ortsinfo, Marken-Scheibe');
{
  const log = []; KL.env.Render = fakeRender(log);
  // Kurznamen
  const KN = T.TEXT.kurzname;
  const langeNamen = CODES.map((c) => SUND.hexe[c].name).filter((nm) => nm.length > 7);
  ok(langeNamen.every((nm) => KN[nm]), 'jeder lange Hexname (> 7 Zeichen) hat einen handverlesenen Kurznamen: ' + langeNamen.filter((nm) => !KN[nm]).join(', '));
  const schlecht = Object.keys(KN).filter((k) => !(CODES.some((c) => SUND.hexe[c].name === k) && KN[k].replace('.', '').length <= 6 && KN[k].length < k.length));
  ok(!schlecht.length && Object.keys(KN).every((k) => CODES.some((c) => SUND.hexe[c].name === k) && KN[k].replace('.', '').length <= 6 && KN[k].length < k.length), 'Kurznamen: gehören zu einem Kartenhex, höchstens 6 Zeichen plus Punkt, kürzer als der Name ' + schlecht.join(', '));
  ok(KL.kurzname('Raffinerie Lumen', 600) === 'Lumen' && KL.kurzname('Raffinerie Lumen', 38) === 'Lumen', '„Raffinerie Lumen“ heißt immer „Lumen“ (Übersicht und Zoom)');
  ok(KL.kurzname('Vorläufer-Sektor', 38) === 'Vorl.' && KL.kurzname('Vorläufer-Sektor', 600) === 'Vorläufer-Sektor', 'Vorläufer-Sektor: „Vorl.“ in der Übersicht, voller Name im Zoom');
  ok(KL.kurzname('Sudrvik', 38) === 'Sudrvik' && KL.kurzname('Unbekannt Name Lang', 38) === null, 'Name passt: voll; ohne Tabelleneintrag: null (Aufrufer kürzt)');
  // Meldeliste in der schmalen Pult-Spalte: Zeit und Ziel gehen nicht verloren
  const name = (h) => ({ '0803': 'Ulfsvakt', '0603': 'Kantenstein', '0904': 'Skjaldborg', '0703': 'Eisfeld', '0403': 'Speculum' })[h] || h;
  const B = blockLageB();
  B.f = [{ f: 'g', h: '0803', k: 3, p: 's', a: 1, d: 2 }, { f: 'g', h: '0703', k: 2, p: 'm', a: 1, v: '0803' }, { f: 'g', h: '0904', k: 2, p: 'u', a: 11, v: '0803' }];
  const On = { rx: 432, rw: 144, y: 50, sel: null, name, art: () => '', hafen: () => '', karteFraktion: () => 'g', dist: () => 3, kurs: () => 0 };
  log.length = 0; KL.meldeliste(fakeCtx(), KL.lesen(B, CODES), On);
  const breiteN = On.rw - T.MASS.spalte.meldung.textX, zeilen = log.map((l) => l.s).filter((s) => /seit|→|vor/.test(s));
  ok(zeilen.some((s) => /Ulf.* · seit 2/.test(s)) && zeilen.some((s) => /Ulf.*→ ?Eisfeld/.test(s)) && zeilen.every((s) => s.length * 5 <= breiteN), 'schmale Meldeliste: Kurzformen mit Ort und Zeit/Herkunft statt bloßem Ortsnamen: ' + JSON.stringify(zeilen));
  ok(T.MASS.spalte.meldung.textX === 42, 'Meldeliste: Text ab x 42');
  // Rangfolge: Gleichstand nach Fraktion (g vor p vor k), dann Stärke
  const qg = { f: 'g', k: 1, p: 'u', a: 1, stufe: 'gesehen' }, qp = { f: 'p', k: 3, p: 'u', a: 1, stufe: 'gesehen' }, qk = { f: 'k', k: 3, p: 'u', a: 1, stufe: 'gesehen' }, qg3 = { f: 'g', k: 3, p: 'u', a: 1, stufe: 'gesehen' };
  ok([qk, qp, qg].sort(KL.rangVergleich).map((q) => q.f).join('') === 'gpk' && [qg, qg3].sort(KL.rangVergleich)[0] === qg3, 'Rangfolge bei Gleichstand: g vor p vor k, danach Stärke absteigend');
  const Mix = KL.lesen({ t: 5, vz: 1, sw: 2, hx: CODES.map(() => '-1').join(''), f: [{ f: 'p', h: '0703', k: 1, p: 'u', a: 1 }, { f: 'g', h: '0703', k: 2, p: 'u', a: 1 }], m: [] }, CODES);
  log.length = 0;
  KL.flotten(fakeCtx(), Mix, { s: 24, h3: 41.6, mitte: () => ({ x: 100, y: 100 }), nachbarn: () => [], hexe: ['0703'], bereich: 'voll' }, {});
  ok(log.some((l) => l.s === 'G') && !log.some((l) => l.s === 'P') && log.some((l) => l.s === '+1'), 'Mischhex Eisfeld: die germanische Flotte steht auf der Plakette, die Piraten im Chip „+1“');
  // Legende: schmale Spalte vier bis fünf Zeilen, breite drei
  ok(KL.legendeZeilen(144) >= 4 && KL.legendeZeilen(144) <= 5 && KL.legendeZeilen(196) === 3, 'Legende: schmale Spalte ' + KL.legendeZeilen(144) + ' Zeilen (4 bis 5), breite ' + KL.legendeZeilen(196));
  // Ortsinfo außer Sicht in der schmalen Spalte: Kurzform mit Sichtweite
  const Aalt = KL.lesen(blockLageB(), CODES);
  log.length = 0; KL.ortsinfo(fakeCtx(), Aalt, { rx: 432, rw: 146, y: 50, sel: '0904', name, art: () => '', hafen: () => '', karteFraktion: () => 'g', dist: () => 4, kurs: () => 0, ohneArt: true });
  ok(log.some((l) => l.s === 'Knoten 4 Sprünge · Sicht 2'), 'Ortsinfo außer Sicht (146 px): „Knoten 4 Sprünge · Sicht 2“ statt abgeschnittener Langform: ' + JSON.stringify(log.map((l) => l.s)));
  // Verborgenes, unerkundetes Hex: kein Name, kein Besitzer, keine Art
  log.length = 0; KL.ortsinfo(fakeCtx(), Aalt, { rx: 432, rw: 196, y: 50, sel: '0602', name: () => 'Altrost', art: () => 'Piratenlager Nord', hafen: () => '', karteFraktion: () => 'p', dist: () => 3, kurs: () => 0, verborgen: (h) => h === '0602' });
  ok(log.some((l) => l.s === '?') && !log.some((l) => /Altrost|Pirat/.test(l.s)), 'Ortsinfo verborgenes Hex: „?“, nichts von Name, Besitzer oder Art: ' + JSON.stringify(log.map((l) => l.s)));
  // Notruf-Marke: deckende Scheibe (Alpha 1, r + 2) unter dem Ring, Puls nur auf dem Ring
  const rec = []; let ga = 1, fst = '';
  const mctx = new Proxy({}, { get(_, k) { if (k === 'globalAlpha') return ga; if (k === 'fillStyle') return fst; return (...a) => { if (k === 'arc') rec.push({ k, r: a[2], ga, fs: fst }); if (k === 'fill' || k === 'stroke') rec.push({ k, ga, fs: fst }); }; }, set(_, k, v) { if (k === 'globalAlpha') ga = v; if (k === 'fillStyle') fst = v; return true; } });
  KZ.marke(mctx, 'notruf', 50, 50, 0.52, { r: 6, deckend: true });
  const scheibe = rec.find((x) => x.k === 'arc'), erstesFill = rec.find((x) => x.k === 'fill');
  ok(scheibe && scheibe.r === 8 && erstesFill && erstesFill.ga === 1 && erstesFill.fs === KZ.COL.tisch, 'Notruf-Marke deckend: erste Fläche = Scheibe Radius r + 2 = 8 in Tischfarbe mit Alpha 1');
  const ring = rec.filter((x) => x.k === 'stroke')[0], zeichen = rec.filter((x) => x.k === 'fill').slice(-1)[0];
  ok(ring && ring.ga < 1 && zeichen && zeichen.ga === 1, 'Notruf-Marke deckend: Puls nur auf dem Ring (Alpha ' + (ring && ring.ga.toFixed(2)) + '), Zeichen „!“ voll deckend');
  rec.length = 0; KZ.marke(mctx, 'notruf', 50, 50, 0.52, { r: 6 });
  ok(rec.find((x) => x.k === 'arc').r === 6, 'ohne deckend (Limes, Kampagne): unverändert Radius r, keine Scheibe');
  ok(T.MASS.notruf.rMinLage === 6, 'Notruf-Marke in der Lage-Karte mindestens Radius 6');
}
section('SUND-01 G: Spaltenbilanz, Meldeliste mindestens 3 Zeilen, Sprunghinweis, Kurzform-Kette');
{
  const log = []; KL.env.Render = fakeRender(log);
  const name = (h) => ({ '0803': 'Ulfsvakt', '0603': 'Kantenstein', '0904': 'Skjaldborg', '0703': 'Eisfeld', '0403': 'Speculum' })[h] || h;
  const MS = T.MASS.spalte, Bl = (f) => KL.lesen(Object.assign(blockLageB(), { f, m: [] }), CODES);
  const flotten = (k) => Array.from({ length: k }, (_, i) => ({ f: 'g', h: CODES[10 + i], k: 2, p: 'h', a: 1 }));
  // Platz der Pult-Spalte: a.y 10, a.h 238, rw 144; Ortsinfo bis y 57 (4 Zeilen) oder 67 (5 Zeilen, Lage c); Sprungblock ohne Hinweis 51, Hinweis 1 Zeile
  const plan = (k, y, o) => KL.spaltenPlan(Bl(flotten(k)), Object.assign({ y, unten: 10 + 238 - 14, rw: 144, sprungBasis: 51, grundZ: 1 }, o));
  let kleinste = 99;
  for (const y of [57, 67]) for (const k of [1, 2, 3, 4, 5, 6, 9, 12]) { const p = plan(k, y); kleinste = Math.min(kleinste, Math.min(p.maxZeilen, k)); ok(p.passt && p.maxZeilen >= Math.min(k, MS.meldung.min), 'Spaltenbilanz y ' + y + ', ' + k + ' Meldungen: ' + p.maxZeilen + ' Zeilen (mindestens ' + Math.min(k, MS.meldung.min) + '), frei ' + p.frei); }
  ok(plan(12, 57).maxZeilen >= 3 && plan(12, 57).maxZeilen <= MS.meldung.max, 'viele Flotten: 3 bis ' + MS.meldung.max + ' Zeilen plus „+n weitere“ (' + plan(12, 57).maxZeilen + ')');
  ok(plan(3, 57).maxZeilen === 3 && plan(2, 67).maxZeilen === 2, 'wenige Meldungen: alle Zeilen, keine Reserve für „+n weitere“');
  // engste Lage: Sprungziel gewählt (Sprungpunkt-Zeile, Hinweis zwei Zeilen) und Ortsinfo mit fünf Zeilen: die Legende wird einzeilig, der Hinweis einzeilig, die Liste behält mindestens 4 Zeilen (SUND-02a C)
  const eng = plan(12, 67, { sprungBasis: 61, grundZ: 2 }), weit = plan(12, 57), kurz = plan(2, 67, { sprungBasis: 61, grundZ: 2 });
  ok(eng.kompakt === 'eins' && eng.legZ === MS.legende.einzeilig && eng.maxZeilen >= MS.meldung.min && eng.passt, 'Sprungziel gewählt, Ortsinfo 5 Zeilen, 12 Meldungen: Legende einzeilig (' + eng.legZ + ' Zeile), Liste ' + eng.maxZeilen + ' Zeilen, Hinweis ' + eng.grundZ + ' Zeile(n)');
  const gross = plan(12, 57, { unten: 10 + 238 + 60 });
  ok(weit.kompakt === true && weit.maxZeilen === MS.meldung.max && weit.passt, 'Pult-Standardlage (Ortsinfo 4 Zeilen, 12 Meldungen): Legende kompakt (' + weit.legZ + ' Zeilen), Liste ' + weit.maxZeilen + ' Zeilen plus „+n weitere“');
  ok(!gross.kompakt && gross.legZ === KL.legendeZeilen(144) && gross.maxZeilen === MS.meldung.max && kurz.maxZeilen === 2 && kurz.passt, 'viel Platz: volle Legende (' + gross.legZ + ' Zeilen) und 5 Meldungen; wenige Meldungen: nie mehr Zeilen als Meldungen');
  for (const y of [57, 67]) ok(plan(12, y).maxZeilen >= MS.meldung.max - 1 && plan(5, y).maxZeilen === 5, 'Pult: bei y ' + y + ' mindestens ' + (MS.meldung.max - 1) + ' von 12 Meldungen, 5 von 5 ganz (' + plan(12, y).maxZeilen + '/' + plan(5, y).maxZeilen + ')');
  ok(KL.legendeZeilen(144, 'eins') === MS.legende.einzeilig && KL.legendeZeilen(196, 'eins') === MS.legende.einzeilig, 'einzeilige Legende (144 und 196 px): genau eine Zeile');
  { const lg = []; KL.env.Render = fakeRender(lg); KL.legende(fakeCtx(), 432, 200, 144, 'eins'); const tl = lg.map((l) => l.s);
    ok(['jetzt', 'T-1', 'alt'].every((x) => tl.includes(x)) && !tl.includes('Front') && !tl.includes('dunkel'), 'einzeilige Legende nennt nur die Wissensstufen: ' + JSON.stringify(tl)); KL.env.Render = fakeRender(log); }
  for (const w of [144, 196]) ok(KL.legendeZeilen(w, true) === MS.legende.kompaktZeilen, 'kompakte Legende (' + w + ' px): genau ' + MS.legende.kompaktZeilen + ' Zeilen (' + KL.legendeZeilen(w, true) + ')');
  { const lg = []; KL.env.Render = fakeRender(lg); KL.legende(fakeCtx(), 432, 200, 144, true); const tl = lg.map((l) => l.s);
    ok(['jetzt', 'T-1', 'alt', 'Front', 'Sicht', 'dunkel'].every((x) => tl.includes(x)), 'kompakte Legende nennt Wissensstufen, Front, Sicht und dunkel: ' + JSON.stringify(tl));
    lg.length = 0; KL.legende(fakeCtx(), 432, 200, 144); ok(['jetzt', 'T-1', 'alt', 'sammelt', 'Kurs', 'belagert', 'Front', 'Sicht', 'dunkel'].every((x) => lg.map((l) => l.s).includes(x)), 'volle Legende unverändert vollständig'); KL.env.Render = fakeRender(log); }
  // Sprunghinweis: Standardhinweis des Servers eine Zeile (Pult 144 px), andere höchstens zwei Zeilen
  const wrap3 = (t) => String(t).match(/.{1,12}/g) || [];
  const std = 'Kein Sprungpunkt in Reichweite – Boje am Sektorrand anfliegen.';
  ok(KL.sprungHinweis(std, wrap3).length === 1 && KL.sprungHinweis(std, wrap3)[0].length * 5 <= 144, 'Sprunghinweis Standardfall: eine Zeile, in 144 px: ' + KL.sprungHinweis(std, wrap3)[0]);
  ok(KL.sprungHinweis('Antrieb ohne Energie. Und ein sehr langer Zusatz, der drei Zeilen füllen würde.', wrap3).length === 2, 'anderer Hinweis: höchstens zwei Zeilen');
  // Kurzform-Kette: ohne Ziel und Herkunft steht die Phase als Wort, nicht nur der Ort
  const B = Bl([{ f: 'g', h: '0803', k: 2, p: 'u', a: 1 }, { f: 'g', h: '0703', k: 2, p: 'm', a: 1 }, { f: 'g', h: '0904', k: 1, p: 'r', a: 1 }]);
  const On = { rx: 432, rw: 144, y: 50, sel: null, name, art: () => '', hafen: () => '', karteFraktion: () => 'g', dist: () => 3, kurs: () => 0 };
  log.length = 0; KL.meldeliste(fakeCtx(), B, On);
  const t = log.map((l) => l.s), breite = On.rw - MS.meldung.textX;
  ok(t.some((s) => /Ulf.* · unterw/.test(s)) && t.some((s) => /Eisfeld · marsch/.test(s)) && t.some((s) => /Skjald.* · Rückz/.test(s)) && t.slice(1).every((s) => s.length * 5 <= breite), 'schmale Liste: Flotte ohne Ziel zeigt „Ort · unterw.“, „· marsch“, „· Rückz.“ statt nur den Ort: ' + JSON.stringify(t.slice(1)));
  const breit = KL.zeilenText({ q: Object.assign({ stufe: 'gesehen' }, B.fl[0]) }, { name }, false);
  ok(breit === 'Ulfsvakt · unterwegs', 'Langform ohne Ziel: „Ulfsvakt · unterwegs“ (' + breit + ')');
  // nur der Ort erst, wenn gar keine Form mehr passt
  log.length = 0; KL.meldeliste(fakeCtx(), B, Object.assign({}, On, { rw: 60 }));
  ok(log.slice(1).every((l) => l.s.length * 5 <= 60 - MS.meldung.textX + 6), 'Spalte zu schmal: gekürzt, ohne Fehler');
}
section('SUND-01 G: Kurspfeil eigener Flotten auf der Hexseite');
{
  const s = 23.6, SQ = Math.sqrt(3);
  const mitte = (h) => { const c = +h.slice(0, 2), r = +h.slice(2); return { x: 30 + s * (1 + 1.5 * (c - 1)), y: 20 + s * (SQ / 2 + SQ * (r - 1) + (c % 2 === 0 ? SQ / 2 : 0)) }; };
  const V = { s, h3: SQ * s, hexe: CODES, bereich: 'voll', mitte, nachbarn: () => [], weg: (a, b) => [a, b] };
  const pfeil = (q) => {
    const pts = []; let offen = false;   // der erste geschlossene Pfad ist der Kurspfeil (danach folgt das Phasenfeld der Plakette)
    const ctx = new Proxy({}, { get(_, k) { return (...a) => { if (k === 'beginPath') { offen = true; pts.length = 0; } if ((k === 'moveTo' || k === 'lineTo') && offen) pts.push(a); if (k === 'closePath') { offen = false; if (!pts.done) pts.done = pts.slice(); } }; }, set() { return true; } });
    KL.flotten(ctx, KL.lesen(Object.assign(blockLageB(), { f: [q], m: [] }), CODES), V, {});
    return pts.done;
  };
  for (const [h, nb] of [['0405', '0505'], ['0603', '0503'], ['0603', '0703'], ['0603', '0604']]) {
    const own = pfeil({ f: 'r', h, k: 1, p: 'm', a: 0, n: nb });
    if (!own) { ok(false, 'eigener Pfeil ' + h + ' -> ' + nb + ': gezeichnet'); continue; }
    const p = mitte(h), q2 = mitte(nb), dx = q2.x - p.x, dy = q2.y - p.y, len = Math.hypot(dx, dy), nx = dx / len, ny = dy / len;
    const mx = (p.x + q2.x) / 2, my = (p.y + q2.y) / 2, tip = own[0], b1 = own[1], b2 = own[2], bm = { x: (b1[0] + b2[0]) / 2, y: (b1[1] + b2[1]) / 2 };
    const ts = (tip[0] - mx) * nx + (tip[1] - my) * ny, bs = (bm.x - mx) * nx + (bm.y - my) * ny, quer = (tip[0] - bm.x) * -ny + (tip[1] - bm.y) * nx;
    ok(Math.abs(ts + bs) < 0.01 && ts > 0 && bs < 0, 'eigener Pfeil ' + h + ' -> ' + nb + ': Spitze ' + ts.toFixed(1) + ' px hinter, Fuß ' + (-bs).toFixed(1) + ' px vor der Seitenmitte (zentriert)');
    ok(Math.abs(quer) < 0.01 && Math.abs((tip[0] - bm.x) * nx + (tip[1] - bm.y) * ny - (ts - bs)) < 0.01, 'eigener Pfeil ' + h + ' -> ' + nb + ': senkrecht zur Hexseite ausgerichtet');
  }
  const fremd = pfeil({ f: 'g', h: '0405', k: 1, p: 'u', a: 1, v: '0505' });
  const p = mitte('0405'), q2 = mitte('0505'), mx = (p.x + q2.x) / 2, my = (p.y + q2.y) / 2, len = Math.hypot(q2.x - p.x, q2.y - p.y), nx = (q2.x - p.x) / len, ny = (q2.y - p.y) / len;
  const fb = { x: (fremd[1][0] + fremd[2][0]) / 2, y: (fremd[1][1] + fremd[2][1]) / 2 };
  ok(Math.abs(((fb.x - mx) * nx + (fb.y - my) * ny) + T.MASS.kurs.abstandRand) < 0.01, 'fremder Pfeil (Herkunft v) unverändert: 6 px innen vor der Hexseite');
}
section('SUND-01 G: Hafenklasse unter Belagerung');
{
  const log = []; KL.env.Render = fakeRender(log);
  const A = KL.lesen(Object.assign(blockLageB(), { f: [{ f: 'g', h: '0603', k: 2, p: 'b', a: 0 }, { f: 'r', h: '0603', k: 1, p: 'h', a: 0 }], m: [] }), CODES);
  const p = { x: 100, y: 100 };
  ok(KL.belagerungKlasse(fakeCtx(), A, p, '0603', 'D', 23.6, '#fff') === false && log.length === 0, 'Übersicht (s 23,6): kein Platz neben dem Rahmen, die Klasse entfällt (Plakette und Hexrand bleiben frei)');
  ok(KL.belagerungKlasse(fakeCtx(), A, p, '0603', 'D', 32, '#fff') === true && log.length === 1 && log[0].s === 'D' && log[0].x > p.x + 14 && log[0].x + 4 <= p.x + 32 - 3, 'Zoom (s 32): Klasse rechts neben dem Rahmen, innerhalb des Hexrands');
  ok(KL.belagerungKlasse(fakeCtx(), A, p, '0403', 'D', 40, '#fff') === false && KL.belagerungKlasse(fakeCtx(), A, p, '0603', 'D', 14, '#fff') === false, 'ohne Belagerung im Hex und im Bereich „knapp“: nichts');
}
section('SUND-01 F: StarMap mit Lage: Hafenklasse, Nebensymbole, Abdunklung, Etikett');
{
  let einfl = 0; const einflOrig = KZ.einfluss; KZ.einfluss = (...a) => { einfl++; return einflOrig(...a); };
  const STYLES = []; const fakeCtxOrig = fakeCtx;
  fakeCtx = () => new Proxy(fakeCtxOrig(), { set(t, k, v) { if (k === 'fillStyle') STYLES.push({ v, at: STYLES.log ? STYLES.log.length : 0 }); t[k] = v; return true; } });
  try {
    const k = neueKarte(); STYLES.log = k.log;
    k.senden({ t: 'snap', phase: 'play', world: { lage: blockLageB() } });
    let r = k.zeichne(RECT, null, { ansichtKey: 'fz' });   // eigener Schlüssel: KA.rad trifft den zuletzt registrierten frischen Bereich
    ok(einfl === 0 && T.MASS.hexradius.nebenMin === 30 && T.MASS.plakette.anker.hafenDy === -4, 'Übersicht (s 23,6 < 30): keine Einfluss-Nebensymbole; Hafenklasse auf Symbolhöhe (hafenDy −4)');
    ok(!STYLES.some((x) => x.v === 'rgba(11,14,26,0.6)'), 'Übersicht: keine Abdunklung außerhalb des Ausschnitts (Spezifikation §8)');
    ok(r.texte.some((s) => /ÜBERSICHT/.test(s)), 'Etikett in der unbewegten Übersicht');
    for (let i = 0; i < 6; i++) { KA.rad(200, 180, -100); r = k.zeichne(RECT, null, { ansichtKey: 'fz' }); }
    einfl = 0; r = k.zeichne(RECT, null, { ansichtKey: 'fz' });
    ok(r.res.scale >= 30 && einfl > 0, 'Zoom (s ' + r.res.scale.toFixed(1) + ' ≥ 30): Nebensymbole wieder sichtbar');
    ok(!r.texte.some((s) => /ÜBERSICHT|NAHANSICHT/.test(s)), 'Zoom: kein Kartenetikett über den Hexnamen');
    KA.zuruecksetzen('fz');
    k.SM.toggleAnsicht(); STYLES.length = 0;
    r = k.zeichne(RECT, { loc: 'kantenstein', ship: { scene: 'kantenstein' } }, { ansichtKey: 'fz' });
    const dim = STYLES.find((x) => x.v === 'rgba(11,14,26,0.6)'), ersteG = r.texte.indexOf('G');
    ok(dim && (ersteG < 0 || dim.at <= ersteG), 'Nahansicht: Abdunklung wird vor den Plaketten gezeichnet (Position ' + (dim && dim.at) + ' vor erstem „G“ bei ' + ersteG + ')');
    // SUND-01 G: Auswahlrahmen (1 px, Inset 5) liegt unter den Plaketten: vor dem ersten Plakettenbuchstaben gezeichnet
    KA.zuruecksetzen('fz');
    const strokes = []; let tlog = null;
    const sctx = new Proxy({}, { get(_, k) { if (k === 'stroke') return () => strokes.push({ v: st.strokeStyle, lw: st.lineWidth, at: tlog.length }); if (k in st) return st[k]; return () => {}; }, set(_, k, v) { st[k] = v; return true; } });
    const st = {}, k3 = neueKarte(); tlog = k3.log;
    k3.senden({ t: 'snap', phase: 'play', world: { lage: blockLageB() } });
    k3.log.length = 0; k3.win.StarMap.draw(sctx, { state: { loc: 'ostia_nova', ship: { scene: 'ostia_nova' } }, time: 1 }, RECT, { ansichtKey: 'auswahl', selected: 'kantenstein' });
    const txs = k3.log.map((l) => l.s), erst = Math.min(...['G', 'R'].map((b) => (txs.indexOf(b) < 0 ? 1e9 : txs.indexOf(b))));
    const wahl = strokes.filter((x) => x.v === '#F4EEDC' && x.lw === 1);
    ok(wahl.length > 0 && erst < 1e9 && wahl.every((x) => x.at <= erst), 'Auswahlrahmen vor den Plaketten gezeichnet (Rahmen bei Text-Position ' + wahl.map((x) => x.at).join(',') + ', erster Plakettenbuchstabe bei ' + erst + ')');
  } finally { KZ.einfluss = einflOrig; fakeCtx = fakeCtxOrig; }
}

console.log('\n' + (n - fails) + '/' + n + ' Prüfungen ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
