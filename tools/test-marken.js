'use strict';
// SL1B Karte und Missionsanzeige: Hex-Marken (server/sim/marken.js, Snapshot world.marken, Regiebuch-Bausteine), gemeinsamer Zeichencode
// (public/js/kartenzeichen.js) und die Hexkarte (public/js/starmap.js) mit Marken, Ansichten und Karte Sund – headless im vm.
//   node tools/test-marken.js   (npm run test:marken)
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Game } = require('../server/game.js');
const Sektoren = require('../shared/sektoren.js');
const Welt = require('../server/sim/welt.js');
const Marken = require('../server/sim/marken.js');
const Registry = require('../server/mission/registry.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-marken-'));

section('Marken (Server)');
Welt.waehle(null, 'sund');
{
  const g = { time: 0, C: {}, errors: 0, countError() { this.errors++; }, marken: [] };
  ok(Marken.setze(g, { id: 'n1', typ: 'notruf', ort: 'pulverhorn', ticks: 4 }) === null, 'Notruf setzen (Ort-ID)');
  ok(Marken.setze(g, { id: 'f1', typ: 'fund', hex: '0503', sym: 'wrack' }) === null, 'Fund setzen (Hex)');
  ok(typeof Marken.setze(g, { id: 'x', typ: 'ziel', hex: '0503' }) === 'string', 'Typ ziel lässt sich nicht setzen (kommt aus den Missionen)');
  ok(typeof Marken.setze(g, { id: 'x', typ: 'fund', hex: '9999' }) === 'string' && typeof Marken.setze(g, { typ: 'fund', hex: '0503' }) === 'string', 'ungültiger Hex bzw. fehlende Id: Begründung');
  ok(Marken.setze(g, { id: 'n1', typ: 'notruf', hex: '0605', ticks: 4 }) === null && Marken.liste(g).filter((m) => m.id === 'n1').length === 1, 'gleiche Id ersetzt');
  const s0 = Marken.snapshot(g);
  ok(s0.length === 2 && s0.find((m) => m.t === 'notruf').h === '0605' && s0.find((m) => m.t === 'notruf').b === 120 && s0.find((m) => m.t === 'notruf').g === 120, 'Snapshot: Hex, Typ, Restzeit b und Gesamtzeit g (4 Ticks à 30 s)');
  const k0 = Marken.key(g);
  g.time = 61; ok(Marken.key(g) !== k0 && Marken.snapshot(g).find((m) => m.t === 'notruf').b === 60, 'Restzeit läuft in 5-s-Schritten');
  g.time = 121; ok(Marken.liste(g).length === 1 && !Marken.da(g, 'n1'), 'Notruf verschwindet nach seinen Ticks von allein');
  ok(Marken.entferne(g, 'f1') && Marken.liste(g).length === 0, 'entfernen');
  // Ziele aus den Missionen
  const m = { step: { objectives: [{ id: 'a', hex: '0604' }, { id: 'b', hex: 'pulverhorn' }, { id: 'c', hex: 'leer-0506' }, { id: 'd', text: 'ohne hex' }] },
    state: { objectives: [{ id: 'a', done: false }, { id: 'b', done: true }, { id: 'c', done: false }] }, cond: () => true, focusSnapshot: () => ({ focusLoc: 'kantenstein' }) };
  g.mission = m;
  const z = Marken.liste(g);
  ok(z.length === 3 && z.every((x) => x.t === 'ziel') && z.map((x) => x.h).sort().join() === '0506,0603,0604', 'Ziele: offene Ziele mit hex (erledigte nicht) + Ort des Fokus-Auftrags');
  ok(Marken.snapshot(g).every((x) => x.id === undefined), 'Ziele ohne Id im Snapshot (Netzbudget)');
  m.step = null; m.focusSnapshot = () => ({ focusLoc: null }); m.kette = { aktuell: () => ({ ort: 'concordia' }) };
  ok(Marken.liste(g).length === 1 && Marken.liste(g)[0].h === '0604', 'ohne Ziele: Ort des Kapitels der Kette');
  g.mission = null;
  for (let i = 0; i < 12; i++) Marken.setze(g, { id: 'm' + i, typ: 'fund', hex: '0503' });
  ok(Marken.liste(g).length === Marken.MAX, 'höchstens ' + Marken.MAX + ' Marken');
  // Bausteine
  const g2 = { time: 0, C: {}, errors: 0, countError() { this.errors++; }, marken: [] };
  const mm = { game: g2 };
  Registry.get('hex_marke_setzen').run(mm, { id: 'e1', typ: 'spur', hex: 'concordia' });
  ok(Registry.get('hex_marke_da').test(mm, { id: 'e1' }) && Marken.liste(g2)[0].h === '0604', 'Baustein hex_marke_setzen / hex_marke_da');
  Registry.get('hex_marke_entfernen').run(mm, { id: 'e1' });
  ok(!Registry.get('hex_marke_da').test(mm, { id: 'e1' }), 'Baustein hex_marke_entfernen');
  Registry.get('hex_marke_setzen').run(mm, { id: 'e2', typ: 'fund', hex: 'nirgends' });
  ok(g2.errors === 1, 'ungültige Marke im Baustein wird als Fehler gezählt, nie geworfen');
}

section('Marken im Snapshot (Partie auf Sund)');
Welt.waehle(null, 'limes');
{
  const d = path.join(TMP, 'w1'); fs.mkdirSync(d, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: d, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M0', name: 'Crew', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'schuld_der_lerche' }); g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1);
  const s1 = g.snapshot();
  ok(s1.world && Array.isArray(s1.world.marken), 'erster Snapshot trägt world.marken');
  ok(g.snapshot().world.marken === undefined, 'ohne Änderung kommt world.marken nicht erneut');
  run(2);
  ok(g.snapshot().world.marken === undefined, 'auch nach zwei Sekunden Spielzeit nicht (Ziele und Marken unverändert)');
  Marken.setze(g, { id: 'n1', typ: 'notruf', ort: 'pulverhorn', ticks: 10 });
  const s2 = g.snapshot();
  ok(s2.world.marken && s2.world.marken.some((m) => m.t === 'notruf' && m.h === '0605'), 'neue Marke erscheint im nächsten Snapshot');
  Marken.entferne(g, 'n1');
  const s3 = g.snapshot();
  ok(Array.isArray(s3.world.marken) && s3.world.marken.every((m) => m.t !== 'notruf'), 'entfernte Marke: Liste ohne sie (leeres Feld löscht den Client-Stand)');
  g.sentSektorenVersion = -1;   // Neuverbindung: world.sektoren wird neu gesendet, world.marken folgt
  const s4 = g.snapshot();
  ok(s4.world.sektoren !== undefined && Array.isArray(s4.world.marken), 'Neuverbindung: world.marken kommt zusammen mit world.sektoren');
  const bytes = JSON.stringify({ marken: [{ h: '0605', t: 'notruf', id: 'n1', b: 120, g: 300 }, { h: '0603', t: 'ziel' }, { h: '0604', t: 'fund', id: 'f1', s: 'wrack' }] }).length;
  ok(bytes < 200, `drei Marken ≈ ${bytes} Byte`);
  g.releaseWorldLock();
}
Welt.waehle(null, 'limes');

section('Kartenzeichen und Hexkarte (Client im vm)');
{
  const calls = [];
  const rec = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, a]); }), set: (t, k, v) => { t[k] = v; return true; } });
  const fehler = [];
  const win = {};
  win.Net = { reportError: (l, e) => fehler.push(l + ': ' + (e && e.message)), on() { return () => {}; } };
  let alt = 0;
  win.Render = {
    text: (ctx, s, x, y, o) => { calls.push(['text', [s]]); }, measure: (s) => String(s).length * 5, wrap: (s) => [String(s)],
    worldOf: (st) => st.world, drawPin() {}, drawStarMapAlt() { alt++; },
  };
  const ctxVm = { window: win, self: win, document: { createElement: () => ({ getContext: rec, width: 0, height: 0 }) }, console };
  vm.createContext(ctxVm);
  const lade = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'), ctxVm, { filename: f });
  lade('kartenzeichen.js'); lade('starmap.js');
  const KZ = win.Kartenzeichen; const SM = win.StarMap;
  ok(!!KZ && !!SM && typeof KZ.marke === 'function' && typeof KZ.symbol === 'function' && Object.keys(KZ.MARKEN).join() === 'ziel,notruf,spur,fund,kontakt', 'Kartenzeichen und StarMap laden, fünf Marken-Typen');
  const cx = rec();
  for (const t of Object.keys(KZ.MARKEN)) KZ.marke(cx, t, 50, 50, 1, { r: 7, rest: 30, gesamt: 60 });
  ok(calls.filter((c) => c[0] === 'arc').length >= 5 && !fehler.length, 'jede Marken-Plakette zeichnet ohne Fehler');
  for (const id of ['heimat', 'hafen', 'asteroiden', 'nebel', 'boje', 'wrack', 'schrein', 'ruine', 'piraten', 'festung', 'gasriese', 'ally', 'target', 'bomb', 'system']) KZ.symbol(cx, id, 10, 10, { farbe: '#fff' });
  ok(!fehler.length, 'alle Karten-Symbole zeichnen (Ersatz, kein IconsB nötig)');
  ok(KZ.hauptIcon({ art: 'Gasriese (Treibstoff)' }) === 'gasriese' && KZ.hauptIcon({ symbole: ['pirate'] }) === 'piraten' && KZ.hauptIcon({ hafen: 'C' }) === 'hafen', 'hauptIcon aus Karteneintrag');

  // Karte Sund an die Hexkarte
  Welt.waehle(null, 'sund');
  const K = Sektoren.fuerClient();
  SM.setKarte(K);
  const state = { ship: { scene: 'kantenstein', jump: {} }, world: { location: 'kantenstein', locations: [
    { id: 'kantenstein', name: 'Kantenstein', known: true, visited: true, links: [] }, { id: 'concordia', name: 'Concordia', known: true, links: [] } ] },
    space: {}, plan: { pins: [] } };
  const view = { state, time: 3, mouse: null, actions: {} };
  const rect = { x: 0, y: 0, w: 640, h: 360 };
  const gezeichnet = () => calls.filter((c) => c[0] === 'text').map((c) => c[1][0]);
  const marke0 = KZ.marke; const marked = [];
  KZ.marke = (c, t, x, y, tt, o) => { marked.push(t); return marke0(c, t, x, y, tt, o); };
  SM.setMarken([{ h: '0604', t: 'ziel' }, { h: '0605', t: 'notruf', id: 'n1', b: 60, g: 120 }, { h: '0503', t: 'fund', id: 'f1' }, { h: '0605', t: 'kontakt', id: 'k1' }]);
  calls.length = 0;
  SM.draw(cx, view, rect, {});
  ok(alt === 0 && !fehler.length, 'Hexkarte Sund zeichnet ohne Rückfall auf die Punktkarte (' + fehler.join('; ') + ')');
  ok(marked.sort().join() === 'fund,kontakt,notruf,ziel', 'alle vier Marken werden gezeichnet (' + marked.join() + ')');
  ok(gezeichnet().some((s) => /KARTE SUND/.test(s)), 'Kartentitel folgt der Karte (KARTE SUND), nicht „Limes“');
  ok(!gezeichnet().some((s) => /LIMES|SAUMRAUM/.test(s)), 'kein „Limes“/„Saumraum“ mehr im Kartenbild');
  ok(SM.ansicht === 'fokus' && SM.toggleAnsicht() === 'gesamt' && SM.setAnsicht('saumraum') === 'fokus' && SM.setAnsicht('limes') === 'gesamt', 'Ansichten fokus/gesamt, alte Namen werden übersetzt');
  marked.length = 0; calls.length = 0;
  SM.draw(cx, view, rect, {});   // gesamt
  ok(alt === 0 && marked.length === 4, 'Ansicht gesamt: Marken ebenfalls sichtbar');
  SM.setAnsicht('fokus');
  marked.length = 0; calls.length = 0;
  SM.draw(cx, view, { x: 0, y: 0, w: 200, h: 120 }, { kompakt: true });
  ok(alt === 0 && marked.length === 4, 'HUD-Ausschnitt (kompakt) zeigt die Marken');
  SM.setMarken([{ h: '0204', t: 'notruf', id: 'fern', b: 30, g: 90 }]);   // gesperrtes Hex außerhalb des Ausschnitts: kommt trotzdem ins Bild
  marked.length = 0; SM.draw(cx, view, rect, {});
  ok(alt === 0 && marked.join() === 'notruf', 'Marke auf einem Hex außerhalb des Spielgebiets liegt im Bild (Ausschnitt wächst mit)');
  SM.setMarken([]);
  marked.length = 0; SM.draw(cx, view, rect, {});
  ok(alt === 0 && marked.length === 0 && SM.marken.length === 0, 'ohne Marken keine Plaketten');
  // Karte wechseln: alter Stand verfällt
  SM.setMarken([{ h: '0604', t: 'ziel' }]);
  Welt.waehle(null, 'limes');
  SM.setKarte(Sektoren.fuerClient());
  ok(SM.marken.length === 0, 'Kartenwechsel (Sund -> Limes) löscht Marken und Erkundungsstand');
  const stateL = { ship: { scene: 'hafen', jump: {} }, world: { location: 'hafen', locations: [{ id: 'hafen', name: 'Hafen Lichtkordon', known: true, visited: true, links: [] }] }, space: {}, plan: { pins: [] } };
  marked.length = 0; calls.length = 0;
  SM.draw(cx, { state: stateL, time: 1, actions: {} }, rect, {});
  ok(alt === 0 && gezeichnet().some((s) => /KARTE LIMES/.test(s)), 'Hexkarte Limes unverändert (KARTE LIMES · AUSSCHNITT)');
  KZ.marke = marke0;
  ok(!fehler.length, 'keine gemeldeten Fehler (' + fehler.join('; ') + ')');
}

console.log(`\n${n - fails}/${n} bestanden${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
