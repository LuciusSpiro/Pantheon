'use strict';
// MON-02 O3a: Optik der Kreaturen im Voxelmodus (Rudeltier D „Helmhyäne“). Client-Funktionen aus public/js/voxel/actors.js, gelesen aus dem Quelltext
// (der Block bis KREATUR-OPTIK-ENDE ist rein und wird als Funktion ausgeführt; die Anzeige-Funktionen laufen gegen Attrappen von THREE, Lader und Akteur).
// Geprüft: Client-Content (Zuordnung Typ -> Modell, Reihenfolge = kreaturen.json, Manifest, Auslieferung), Fell aus der Tier-Nummer, Pose aus den Bits
// (inkl. Bit 6 zielt), Beinphase aus der Strecke, Marken mit Ladung und derselben Pose, Cache-Schlüssel (Anzahl), Rückfall ohne Eintrag/Asset/Marken,
// Zittern/Staub/Sterne/Pulsieren nur im richtigen Zustand, Schwarm (MON-03 E: Schwarmling und Königin, Eintragsfelder label/wippen/sterne/zerfall), Wippen nur in Bewegung, keine Typnamen im Client-Kern, Staub-Effekt in fx.js.
//   node tools/test-kreatur-optik.js   (npm run test:kreatur-optik)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};

const ac = read('public/js/voxel/actors.js');
const a0 = ac.indexOf('const KR_SCHRITT'), a1 = ac.indexOf('// KREATUR-OPTIK-ENDE'), a2 = ac.indexOf('function kreaturInhaltLaden'), a3 = ac.indexOf('function updateEnemy(');
if (a0 < 0 || a1 < a0 || a2 < a1 || a3 < a2) { console.log('  FEHLER Quelltext-Blöcke in actors.js nicht gefunden'); process.exit(1); }
const REIN = ac.slice(a0, a1), ANZEIGE = ac.slice(a2, a3);
const P = new Function(REIN + '\nreturn { KR_SCHRITT, kreaturEintrag, kreaturFell, kreaturPose, kreaturLadung, kreaturBeinphase, kreaturParameter, kreaturSchluessel, kreaturZitterAmp, kreaturStaubAn, kreaturSterneAn, kreaturPuls, kreaturWippen, kreaturMarkenPivot, kreaturLabelHoehe, kreaturWippFaktor, kreaturSterneErlaubt };')();

const KREATUREN = require('../content/kampf/kreaturen.json');
const MODELLE = JSON.parse(read('content/kreaturen/modelle.json'));
const MANIFEST = { assets: JSON.parse(read('assets/manifest/mon02.json')).assets.concat(JSON.parse(read('assets/manifest/mon03.json')).assets) };   // Rudeltier (mon02) + Schwarm (mon03)
const IDS = Object.keys(KREATUREN.typen);
const BITS = { ladung: 3, pause: 4, rammt: 8, zielt: 64 };
// gültige Zustände des Servers (Modus steht = Pause, ramme, zielen) mit Ladung 0..3 und Größe 1
const ZUSTAENDE = []; for (const m of ['', 'pause', 'rammt', 'zielt']) for (let l = 0; l <= 3; l++) ZUSTAENDE.push({ m, l, b: l | (m === 'pause' ? 4 : m === 'rammt' ? 8 : m === 'zielt' ? 64 : 0) });

section('Client-Content: Zuordnung Typ -> Modell', () => {
  ok(JSON.stringify(MODELLE.reihenfolge) === JSON.stringify(IDS), 'reihenfolge = Reihenfolge der Typen in kreaturen.json (Protokoll: typCode = Index): ' + IDS.join(', '));
  const ohne = MODELLE.ohne || [], typen = Object.keys(MODELLE.typen || {});
  ok(IDS.every((id) => typen.includes(id) !== ohne.includes(id)), 'jeder Typ hat entweder einen Eintrag oder steht bewusst unter ohne (nicht beides): typen [' + typen + '], ohne [' + ohne + ']');
  ok(typen.every((id) => IDS.includes(id)) && ohne.every((id) => IDS.includes(id)), 'keine unbekannten Typen im Client-Content');
  const ids = new Set(MANIFEST.assets.map((a) => a.id));
  for (const id of typen) {
    const e = MODELLE.typen[id];
    ok(ids.has(e.modell) && ids.has(e.marken), id + ': Körper ' + e.modell + ' und Marken ' + e.marken + ' stehen im Manifest mon02.json');
    const fell = MANIFEST.assets.find((a) => a.id === e.modell).params.fell;
    ok(Number.isInteger(e.varianten) && e.varianten === fell[1] + 1, id + ': varianten ' + e.varianten + ' = Fellfarben des Modells (fell 0.." + fell[1] + ")');
  }
  ok(ids.has('kreatur/rudeltier_koerper'), 'das Teilmodell kreatur/rudeltier_koerper ist mit synchronisiert (Abhängigkeit des Rezepts)');
  const idx = JSON.parse(read('public/voxel/index.json')), pal = JSON.parse(read('public/voxel/assets/palettes/kreatur.json'));
  const mod = (idx.models || []);
  ok(['kreatur/rudeltier', 'kreatur/rudeltier_marken', 'kreatur/rudeltier_koerper'].every((i) => mod.includes(i)) && (idx.palettes || []).includes('kreatur') && pal.id === 'kreatur', 'public/voxel enthält die drei Modelle und die Palette kreatur (npm run assets gelaufen)');
  const { resolveStatic } = require('../server/index.js');
  ok(!!resolveStatic('/content/kreaturen/modelle.json') && !resolveStatic('/content/kreaturen/anderes.json'), 'Auslieferung: /content/kreaturen/modelle.json ja, andere Dateien im Ordner nicht');
  ok(/fetch\('\/content\/kreaturen\/modelle\.json'\)/.test(ac), 'der Client lädt den Content von /content/kreaturen/modelle.json');
  const typ0 = P.kreaturEintrag(MODELLE, 0), typ1 = P.kreaturEintrag(MODELLE, 1);
  ok((IDS[0] === 'probe' ? typ0 === null : true) && typ1 && typ1.modell === 'kreatur/rudeltier' && typ1.marken === 'kreatur/rudeltier_marken' && typ1.varianten === 6, 'kreaturEintrag: typCode 0 (probe) kein Eintrag, typCode 1 = Rudeltier-Modelle');
  ok(P.kreaturEintrag(null, 1) === null && P.kreaturEintrag({}, 1) === null && P.kreaturEintrag(MODELLE, 9) === null && P.kreaturEintrag({ reihenfolge: ['x'], typen: { x: { modell: 'a' } } }, 0) === null, 'kreaturEintrag: ohne Inhalt, unbekannter typCode oder unvollständiger Eintrag -> null (Platzhalter)');
});

section('Fell aus der Tier-Nummer', () => {
  ok([0, 1, 2, 3, 4, 5, 6, 7, 11, 12].map((nr) => P.kreaturFell(nr, 6)).join() === '0,1,2,3,4,5,0,1,5,0', 'fell = nr % 6: 0..5, 6 -> 0, 7 -> 1, 11 -> 5, 12 -> 0');
  const seen = new Set(); for (let nr = 1; nr <= 12; nr++) seen.add(P.kreaturFell(nr, 6));
  ok(seen.size === 6, 'ein Rudel von 12 zeigt alle 6 Felle');
  ok(P.kreaturFell(5, 6) === P.kreaturFell(5, 6) && P.kreaturFell(-1, 6) === 5 && P.kreaturFell(3, 0) === 0 && P.kreaturFell(3, 1) === 0, 'deterministisch, nie außerhalb 0..varianten-1 (auch bei 0 oder 1 Variante)');
});

section('Pose aus den Bits (inkl. Bit 6 zielt)', () => {
  const pose = (l, m) => P.kreaturPose(l | (m === 'pause' ? 4 : m === 'rammt' ? 8 : m === 'zielt' ? 64 : 0) | 16);
  ok([0, 1, 2, 3].every((l) => pose(l, '') === 0 && pose(l, 'zielt') === 1 && pose(l, 'pause') === 2 && pose(l, 'rammt') === 3), 'steh 0, zielt 1 (Aufladen), Pause 2, rammt 3, unabhängig von Ladung und Größenbits');
  ok(P.kreaturPose(0) === 0 && P.kreaturPose(64) === 1 && P.kreaturPose(4) === 2 && P.kreaturPose(8) === 3 && P.kreaturPose(64 | 3) === 1, 'Bit 6 = 64 allein ergibt Pose 1');
  ok(P.kreaturLadung(0) === 0 && P.kreaturLadung(3 | 64 | 16) === 3 && P.kreaturLadung(2 | 4) === 2, 'Ladung = Bits 0-1');
});

section('Beinphase aus der Strecke, Parameter, Cache-Schlüssel', () => {
  const S = P.KR_SCHRITT;
  ok(P.kreaturBeinphase(0, 0) === 0 && P.kreaturBeinphase(0, S * 0.99) === 0 && P.kreaturBeinphase(0, S * 1.01) === 1 && P.kreaturBeinphase(0, S * 2.01) === 0 && P.kreaturBeinphase(0, S * 3.5) === 1, 'Beinphase wechselt nach je ' + S + ' m Strecke zwischen 0 und 1');
  ok([1, 2, 3].every((p) => P.kreaturBeinphase(p, S * 1.5) === 0) && P.kreaturBeinphase(0, -3) === 0, 'in den Posen aufladen, Pause, rammen immer Beinphase 0 (eigene Beinstellung); negative Strecke 0');
  const E = MODELLE.typen[IDS.find((id) => MODELLE.typen[id])];
  const p = P.kreaturParameter(E, 8, 2 | 8 | 16, S * 1.2);
  ok(JSON.stringify(p) === JSON.stringify({ koerper: { pose: 3, fell: 2, beinphase: 0 }, marken: { ladung: 2, pose: 3 } }), 'Parameter: Körper {pose, fell, beinphase}, Marken {ladung, pose} mit derselben Pose (rammen: Pose 3 an beiden)');
  const q = P.kreaturParameter(E, 8, 1, S * 1.2);
  ok(q.koerper.pose === 0 && q.koerper.beinphase === 1 && q.marken.pose === q.koerper.pose && q.marken.ladung === 1, 'Gehen mit Ladung 1: Pose 0, Beinphase aus der Strecke, Marken Pose 0 / Ladung 1');
  for (const z of ZUSTAENDE) for (let nr = 1; nr <= 12; nr++) { const pp = P.kreaturParameter(E, nr, z.b | 16, 7 * S); if (pp.marken.pose !== pp.koerper.pose) fails++, n++, console.log('  FEHLER Marken-Pose ungleich Körper-Pose bei Bits ' + z.b); }
  // Cache: alle Kombinationen über Zustände, 12 Tiere und viele Strecken
  const kor = new Set(), mar = new Set();
  for (const z of ZUSTAENDE) for (let nr = 1; nr <= 12; nr++) for (let s = 0; s < 8; s += 0.1) { const pp = P.kreaturParameter(E, nr, z.b | 16, s); kor.add(P.kreaturSchluessel(E.modell, pp.koerper)); mar.add(P.kreaturSchluessel(E.marken, pp.marken)); }
  ok(kor.size === 6 * 2 + 3 * 6 && mar.size === 16, 'Cache-Schlüssel: ' + kor.size + ' Körper (6 Felle x 2 Beinphasen in Pose 0 + 3 Posen x 6 Felle = 30) und ' + mar.size + ' Marken (4 Ladungen x 4 Posen = 16), zusammen ' + (kor.size + mar.size) + ' (höchstens 64 + Marken)');
  ok(P.kreaturSchluessel('m', { b: 1, a: 2 }) === P.kreaturSchluessel('m', { a: 2, b: 1 }) && P.kreaturSchluessel('m', { a: 1 }) !== P.kreaturSchluessel('m', { a: 2 }), 'Schlüssel unabhängig von der Reihenfolge der Parameter, verschieden bei anderem Wert');
});

section('Effekte nur im richtigen Zustand (rein)', () => {
  for (const z of ZUSTAENDE) {
    const w = z.m;
    ok((P.kreaturZitterAmp(z.b) > 0) === (w === 'zielt'), 'Zittern nur beim Aufladen: Zustand ' + (w || 'gehen') + ' Ladung ' + z.l + ' -> Amplitude ' + P.kreaturZitterAmp(z.b).toFixed(3));
    ok(P.kreaturStaubAn(z.b) === (w === 'rammt'), 'Staubspur nur beim Rammen: ' + (w || 'gehen') + ' Ladung ' + z.l);
    ok(P.kreaturSterneAn(z.b) === (w === 'pause'), 'Sterne nur bei Pause: ' + (w || 'gehen') + ' Ladung ' + z.l);
  }
  ok(P.kreaturZitterAmp(64 | 3) > P.kreaturZitterAmp(64 | 0) && P.kreaturZitterAmp(64 | 3) <= 0.05 + 1e-9, 'Zittern wächst mit der Ladung und bleibt klein (höchstens 5 cm)');
  ok(P.kreaturZitterAmp(64) * 32 >= 0.6 && P.kreaturZitterAmp(64 | 1) * 32 >= 0.9, 'Zittern bei Ladung 0 und 1 mindestens 0,6 bzw. 0,9 px bei 32 px/m (MON-02 Nacharbeit M1: vorher 0,26 bis 0,8 px, in der Spielgröße unsichtbar): ' + (P.kreaturZitterAmp(64) * 32).toFixed(2) + ' und ' + (P.kreaturZitterAmp(65) * 32).toFixed(2) + ' px');
  let max = 0, min = 9; for (let t = 0; t < 2; t += 0.01) { const s = P.kreaturPuls(3, t); max = Math.max(max, s); min = Math.min(min, s); }
  ok(max > 1.3 && min < 1.03 && max <= 1.3501, 'Marken pulsieren bei Ladung 3 (Skalierung ' + min.toFixed(2) + ' bis ' + max.toFixed(2) + '; MON-02 Nacharbeit M2: Amplitude 0,35, vorher 0,2)');
  const per = []; for (let t = 0.001; t < 2; t += 0.001) if (P.kreaturPuls(3, t) > 1.3 && P.kreaturPuls(3, t - 0.001) <= 1.3) per.push(t);
  ok(per.length === 4, 'Puls 2 Hz (' + per.length + ' Spitzen in 2 s, MON-02 Nacharbeit M2: vorher 1,5 Hz)');
  ok([0, 1, 2, 2 | 4, 2 | 8, 2 | 64, 64].every((b) => P.kreaturPuls(b, 0.123) === 1 && P.kreaturPuls(b, 0.4) === 1) && P.kreaturPuls(3 | 8, 0.1) !== 1, 'Pulsieren nur bei Ladung 3 (in jedem Zustand, auch beim Rammen; nicht bei Ladung 0 bis 2)');
  ok(P.kreaturWippen(0, 0, 1.3) === 0 && P.kreaturWippen(0, 0.1, 1.3) === 0 && P.kreaturWippen(8, 0, 0.3) === 0, 'Wippen: im Stand (Tempo 0) kein Versatz');
  let wg = 0, wj = 0, wr = 0; for (let s = 0; s < 3; s += 0.01) { wg = Math.max(wg, P.kreaturWippen(0, 1.4, s)); wj = Math.max(wj, P.kreaturWippen(0, 2.8, s)); wr = Math.max(wr, P.kreaturWippen(8, 7.5, s)); }
  ok(wg > 0 && wg < wj && wj < wr && wr <= 0.06 && wg <= 0.03, 'Wippen: leicht beim Gehen (' + wg.toFixed(3) + ' m), stärker in der Jagd (' + wj.toFixed(3) + ' m) und beim Rammen (' + wr.toFixed(3) + ' m), alles klein (Tier 0,8 m hoch)');
  const pv = [0, 1, 2, 3].map(P.kreaturMarkenPivot);
  ok(pv.every((v) => v[0] === 0 && v[1] > 0.6 && v[1] < 0.9 && v[2] < 0) && pv[0][1] > pv[1][1] && pv[1][1] > pv[2][1], 'Marken-Pivot liegt auf dem Rücken (hinten, y 0,7 bis 0,9 m, mit der Pose abgesenkt)');
});

// ---- Anzeige gegen Attrappen
class Farbe3 { constructor() { this.v = 1; } multiplyScalar(k) { this.v *= k; return this; } }
class O3 {
  constructor(name) { this.name = name; this.children = []; this.parent = null; this.userData = {}; this.visible = true; const v = (o) => Object.assign(o, { set(x, y, z) { o.x = x; o.y = y; o.z = z; return o; } }); this.position = v({ x: 0, y: 0, z: 0 }); this.rotation = v({ x: 0, y: 0, z: 0 }); this.scale = Object.assign({ x: 1, y: 1, z: 1 }, { setScalar(s) { this.x = this.y = this.z = s; }, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }); }
  add(c) { this.children.push(c); c.parent = this; return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parent = null; } return this; }
}
class Mesh3 extends O3 { constructor(g, m) { super('mesh'); this.geometry = g; this.material = m; } }
class Mat3 { constructor(o) { Object.assign(this, o); this.farbe = o.color; this.color = new Farbe3(); } }
function welt(opt) {
  const w = { bereit: !!(opt && opt.bereit), marken: opt && opt.marken !== undefined ? opt.marken : null, loads: [], fallbacks: [], fx: [], fbCalls: 0 };
  const L = { THREE: { Group: O3, Mesh: Mesh3, MeshBasicMaterial: Mat3 }, fbGeo: {}, kreaturInhalt: opt && opt.leer ? undefined : opt && opt.inhalt !== undefined ? opt.inhalt : MODELLE };
  const loadModel = (id, params, fb) => { const s = new O3('slot:' + id); const isMarken = /marken/.test(id); s.userData.slot = { ready: isMarken && w.marken !== null ? w.marken : w.bereit, id, params }; s.userData.params = params; w.loads.push({ id, params, fb }); return s; };
  const refreshSlot = () => {};
  const fallbackModel = (k) => { w.fallbacks.push(k); const g = new O3('fb:' + k); g.userData.placeholder = true; return g; };
  const window = { VoxelFx: { spawnFx: (t, o) => w.fx.push([t, o]) }, Render: { KREATUR: { pause: '#fff' } } };
  const place = (a, x, y) => { a.container.position.set(x / 32, 0, y / 32); return { x: x / 32, z: y / 32 }; };
  const locomote = () => 0, yawOf = () => 0, fbMaterial = () => { w.fbCalls++; return {}; };
  const fn = new Function('L', 'loadModel', 'refreshSlot', 'fallbackModel', 'place', 'locomote', 'yawOf', 'fbMaterial', 'window', 'fetch', REIN + ANZEIGE + '\nreturn { updateKreatur, kreaturModellAnwenden, kreaturPlatzhalter, kreaturEffekte };')(L, loadModel, refreshSlot, fallbackModel, place, locomote, yawOf, fbMaterial, window, opt && opt.fetch);
  w.L = L; w.fn = fn;
  w.akteur = () => { const a = { models: {}, body: new O3('body'), container: new O3('container'), dist: 0, speed: 0, model: null, modelKey: null, labelH: null }; a.container.rotation.y = 0; return a; };
  return w;
}
const tier = (nr, b, t) => ({ id: 'K' + nr, x: 160, y: 96, facing: 0, kr: { t: t == null ? 1 : t, b } });

section('Anzeige: Modell, Marken, Rückfall', () => {
  let w = welt({ bereit: true }), a = w.akteur();
  w.fn.updateKreatur(a, tier(8, 2), 0.05, 1);
  const kor = w.loads.find((l) => l.id === 'kreatur/rudeltier'), mar = w.loads.find((l) => l.id === 'kreatur/rudeltier_marken');
  ok(!!kor && !!mar && JSON.stringify(kor.params) === JSON.stringify({ pose: 0, fell: 2, beinphase: 0 }) && JSON.stringify(mar.params) === JSON.stringify({ ladung: 2, pose: 0 }), 'Tier 8, Ladung 2: Körper {pose 0, fell 8 % 6 = 2, beinphase 0}, Marken {ladung 2, pose 0}');
  ok(a.model && a.model.name === 'slot:kreatur/rudeltier' && a.body.children.includes(a.model) && a.markenPivot && a.markenPivot.children.some((c) => c.name === 'slot:kreatur/rudeltier_marken') && a.markenPivot.parent === a.body, 'Körper und Marken hängen am selben body (gleicher Ort, gleiche Drehung)');
  ok(w.fallbacks.length === 0, 'mit Modell kein Platzhalter gebaut');
  ok(a.labelH === 1.45, 'Namenszug über dem kleineren Modell: labelH 1,45 m');
  for (const [b, pose, ladung] of [[64 | 1, 1, 1], [4 | 3, 2, 3], [8 | 2, 3, 2], [0, 0, 0]]) {
    w = welt({ bereit: true }); a = w.akteur(); w.fn.updateKreatur(a, tier(3, b), 0.05, 1);
    const k = w.loads.find((l) => l.id === 'kreatur/rudeltier'), m = w.loads.find((l) => l.id === 'kreatur/rudeltier_marken');
    ok(k.params.pose === pose && m.params.pose === pose && m.params.ladung === ladung, 'Bits ' + b + ': Körper und Marken in Pose ' + pose + ', Ladung ' + ladung);
  }
  w = welt({ bereit: true }); a = w.akteur();
  w.fn.updateKreatur(a, tier(5, 1), 0.05, 1); const m1 = a.marken, k1 = a.model;
  w.fn.updateKreatur(a, tier(5, 2), 0.05, 1.05);
  ok(a.model === k1 && a.marken !== m1 && w.loads.filter((l) => l.id === 'kreatur/rudeltier').length === 1, 'Ladungswechsel tauscht nur die Marken, der Körper bleibt (kein Neuaufbau)');
  w.fn.updateKreatur(a, tier(5, 2), 0.05, 1.1);
  ok(w.loads.length === 3, 'derselbe Zustand baut nichts neu (Cache je Akteur): ' + w.loads.length + ' Teilmodelle für 2 Zustände');
  a.dist = 0.6; w.fn.updateKreatur(a, tier(5, 2), 0.05, 1.2);
  const kg = w.loads.filter((l) => l.id === 'kreatur/rudeltier').map((l) => l.params.beinphase).join();
  ok(kg === '0,1', 'zurückgelegte Strecke (0,6 m) schaltet die Beinphase um: Körper-Aufbauten ' + kg);
  const nL = w.loads.length; a.dist = 0.6; for (let i = 0; i < 20; i++) w.fn.updateKreatur(a, tier(5, 2), 0.05, 2 + i * 0.3);
  ok(w.loads.length === nL, 'Stillstand (Strecke gleich, Zeit läuft): keine Beinbewegung, kein neuer Aufbau');
  // Rückfall
  w = welt({ bereit: true, inhalt: null }); a = w.akteur(); w.fn.updateKreatur(a, tier(8, 2), 0.05, 1);
  ok(w.loads.length === 0 && w.fallbacks.length === 1 && w.fallbacks[0] === 'kreatur|2' && a.model && a.model.userData.placeholder, 'Client-Content noch nicht geladen: grauer Platzhalter (kreatur|2), kein Modell geladen');
  ok(a.labelH === 1.8, 'Platzhalter behält seine Namenshöhe (1,8 m für Größe 1)');
  w = welt({ bereit: true }); a = w.akteur(); w.fn.updateKreatur(a, tier(8, 2, 0), 0.05, 1);
  ok(w.loads.length === 0 && w.fallbacks.length === 1, 'Typ ohne Eintrag (probe, typCode 0): Platzhalter');
  w = welt({ bereit: false }); a = w.akteur(); w.fn.updateKreatur(a, tier(8, 2), 0.05, 1);
  ok(w.fallbacks.length === 1 && a.model && a.model.userData.placeholder && !a.markenPivot, 'Asset fehlt oder baut noch: Platzhalter, die Teilmodelle werden nicht gezeigt');
  w = welt({ bereit: true, marken: false }); a = w.akteur(); w.fn.updateKreatur(a, tier(8, 2), 0.05, 1);
  ok(w.fallbacks.length === 1 && a.model && a.model.userData.placeholder, 'nur die Marken fehlen: Platzhalter (der Körper allein lässt die Plätze leer, immer beide oder keins)');
  w = welt({ bereit: false, marken: true }); a = w.akteur(); w.fn.updateKreatur(a, tier(8, 2), 0.05, 1);
  ok(w.fallbacks.length === 1 && a.model && a.model.userData.placeholder && !a.markenPivot, 'nur der Körper fehlt: Platzhalter, die Marken allein werden nicht gezeigt');
  // Wechsel Modell -> Platzhalter -> Modell am selben Akteur
  w = welt({ bereit: true }); a = w.akteur(); w.fn.updateKreatur(a, tier(8, 2), 0.05, 1);
  w.L.kreaturInhalt = null; w.fn.updateKreatur(a, tier(8, 2), 0.05, 1.1);
  ok(a.model && a.model.userData.placeholder && !a.markenPivot.visible, 'Rückfall am selben Akteur blendet die Marken aus');
  w.L.kreaturInhalt = MODELLE; w.fn.updateKreatur(a, tier(8, 2), 0.05, 1.2);
  ok(a.model && a.model.name === 'slot:kreatur/rudeltier' && a.markenPivot.visible && a.body.children.filter((c) => c.userData.placeholder).length === 0, 'danach wieder das Modell, der Platzhalter ist abgehängt');
  // Code-Review 13d: Körper-Versatz (Zittern, Wippen, Kippen) wird beim Wechsel zum Platzhalter im selben Aufruf zurückgesetzt, nicht erst im nächsten Bild
  w = welt({ bereit: true }); a = w.akteur(); a.speed = 0;
  for (let i = 0; i < 12; i++) w.fn.updateKreatur(a, tier(8, 64 | 3), 0.025, 1 + i * 0.025);
  const vorher = Math.abs(a.body.position.x) + Math.abs(a.body.position.z) + Math.abs(a.body.rotation.z);
  ok(vorher > 0.01 && a.model.name === 'slot:kreatur/rudeltier', 'Modell mit Aufladen: der Körper ist versetzt (zittert, Betrag ' + vorher.toFixed(3) + ')');
  w.L.kreaturInhalt = null; w.fn.updateKreatur(a, tier(8, 64 | 3), 0.025, 2);
  ok(a.model.userData.placeholder && a.body.position.x === 0 && a.body.position.y === 0 && a.body.position.z === 0 && a.body.rotation.x === 0 && a.body.rotation.y === 0 && a.body.rotation.z === 0, 'erst das Modell, dann der Platzhalter: Körper-Versatz und Drehung sind im selben Aufruf wieder 0 (nicht erst einen Frame später)');
});

section('Anzeige: Zittern, Staubspur, Sterne, Pulsieren', () => {
  const lauf = (b, speed, nr) => {
    const w = welt({ bereit: true }), a = w.akteur(); a.speed = speed || 0;
    let zitter = 0, pulsMax = 1, pulsMin = 9, sternSichtbar = false;
    for (let i = 0; i < 40; i++) {
      w.fn.updateKreatur(a, tier(nr || 3, b), 0.025, 1 + i * 0.025);
      zitter = Math.max(zitter, Math.abs(a.body.position.x) + Math.abs(a.body.position.z) + Math.abs(a.body.rotation.z));
      pulsMax = Math.max(pulsMax, a.markenPivot.scale.x); pulsMin = Math.min(pulsMin, a.markenPivot.scale.x);
      if (a.sterne && a.sterne.visible) sternSichtbar = true;
    }
    return { zitter, pulsMax, pulsMin, stern: sternSichtbar, staub: w.fx.filter((f) => f[0] === 'staub').length, fx: w.fx, a };
  };
  for (const z of ZUSTAENDE) {
    const r = lauf(z.b, 0);
    ok((r.zitter > 0.0005) === (z.m === 'zielt'), 'Anzeige Zittern (Stand): ' + (z.m || 'stehen') + ' Ladung ' + z.l + ' -> ' + r.zitter.toFixed(4) + ' m' + (z.m === 'zielt' ? ' (zittert)' : ' (ruhig)'));
    ok(r.stern === (z.m === 'pause'), 'Anzeige Sterne: ' + (z.m || 'stehen') + ' Ladung ' + z.l + (r.stern ? ' sichtbar' : ' nicht sichtbar'));
    ok((r.pulsMax > 1.1) === (z.l === 3), 'Anzeige Pulsieren der Marken: ' + (z.m || 'stehen') + ' Ladung ' + z.l + ' (Skalierung bis ' + r.pulsMax.toFixed(2) + ')');
  }
  for (const z of ZUSTAENDE) {
    const lang = lauf(z.b, 5, 3), stand = lauf(z.b, 0, 3);
    ok((lang.staub > 0) === (z.m === 'rammt') && stand.staub === 0, 'Staubspur: ' + (z.m || 'gehen') + ' Ladung ' + z.l + ' in Bewegung ' + lang.staub + ' Partikel-Aufrufe, im Stand ' + stand.staub);
  }
  const s = lauf(8, 5, 3), fxA = s.fx.find((f) => f[0] === 'staub');
  ok(fxA && fxA[1].pos.length === 3 && fxA[1].dir.length === 2 && fxA[1].pos[1] < 0.2 && s.staub <= 40, 'Staub: Weltposition am Boden hinter dem Tier, Richtung [x, z], im 25-Hz-Takt gedeckelt (' + s.staub + ' Aufrufe in 1 s)');
  const rate = (() => { const w = welt({ bereit: true }), a = w.akteur(); a.speed = 5; for (let i = 0; i < 60; i++) w.fn.updateKreatur(a, tier(3, 8), 1 / 60, 1 + i / 60); return w.fx.filter((x) => x[0] === 'staub').length; })();
  ok(rate >= 20 && rate <= 30, 'Staubspur im Takt 25 Hz, unabhängig von der Bildrate (60 Bilder in 1 s: ' + rate + ' Aufrufe)');
  const st = lauf(0, 0, 3);
  const wippen = (b, speed) => { let m = 0; const w = welt({ bereit: true }), a = w.akteur(); a.speed = speed; for (let i = 0; i < 60; i++) { a.dist = i * 0.05; w.fn.updateKreatur(a, tier(3, b), 0.025, 1 + i * 0.025); m = Math.max(m, a.body.position.y); } return m; };
  ok(wippen(0, 2.8) > 0.005 && wippen(0, 2.8) < 0.05 && wippen(0, 0) === 0, 'Wippen in Bewegung: body hebt sich leicht (' + wippen(0, 2.8).toFixed(3) + ' m), im Stand nicht');
  ok(st.a.body.position.y === 0 && st.a.body.position.x === 0, 'im Stand (Tempo 0, kein Zustand mit Effekt): body ruhig');
  const rf = (() => { const w = welt({ bereit: true, inhalt: null }), a = w.akteur(); a.speed = 5; w.fn.updateKreatur(a, tier(3, 8), 0.05, 1); return { fx: w.fx.length, y: a.body.position.y, rz: a.body.rotation.z }; })();
  ok(rf.fx === 0 && rf.y === 0 && rf.rz === 0, 'Rückfall (Platzhalter): keine Effekte des Modells, body ruhig');
});

section('Schwarm (MON-03 E): Client-Content, Eintragsfelder, Anzeige', () => {
  const idx = JSON.parse(read('public/voxel/index.json')), ids = new Set(MANIFEST.assets.map((a) => a.id)), mod = idx.models || [];
  for (const id of ['schwarmling', 'koenigin']) {
    const e = MODELLE.typen[id];
    ok(!!e && ids.has(e.modell) && ids.has(e.marken) && mod.includes(e.modell) && mod.includes(e.marken), id + ': Körper ' + (e && e.modell) + ' und Sporen ' + (e && e.marken) + ' stehen im Manifest mon03 und in public/voxel (npm run assets gelaufen)');
    const z = e && e.zerfall, zm = z && MANIFEST.assets.find((a) => a.id === z.modell);
    ok(!!zm && mod.includes(z.modell) && z.params && Number.isInteger(z.params.gross) && z.params.gross >= zm.params.gross[0] && z.params.gross <= zm.params.gross[1], id + ': Zerfallsmodell ' + (z && z.modell) + ' mit gültigem Parameter gross ' + (z && z.params && z.params.gross));
    ok(e.sterne === false && e.label > 0 && e.label < 4, id + ': keine Pause-Sterne, Namenshöhe ' + e.label + ' m');
  }
  ok(MODELLE.typen.schwarmling.label < MODELLE.typen.koenigin.label && MODELLE.typen.koenigin.label > 2 && MODELLE.typen.schwarmling.wippen > 1, 'Namenshöhen passen zum Maßstab (Schwarmling klein, Königin über 2 m), Schwarmling wippt stärker');
  ok(['kreatur/myzel_faden', 'kreatur/schwarm_fleck'].every((i) => ids.has(i) && mod.includes(i)) && MANIFEST.assets.filter((a) => a.tags.includes('boden')).every((a) => a.height <= 0.3), 'Bodenoptik (Fleck, Faden) ist synchronisiert und höchstens 0,3 m hoch (keine Kollision nötig)');
  const pal = JSON.parse(read('public/voxel/assets/palettes/kreatur.json'));
  ok(['kappe', 'lamelle', 'stiel', 'myzel', 'spore_an', 'fleck'].every((r) => r in pal.roles) && pal.roles.spore_an.emit > 0, 'Palette kreatur enthält die Schwarm-Rollen (Sporen leuchten)');
  ok(P.kreaturLabelHoehe(null) === 1.45 && P.kreaturLabelHoehe({}) === 1.45 && P.kreaturLabelHoehe({ label: 0.8 }) === 0.8 && P.kreaturLabelHoehe({ label: -1 }) === 1.45 && P.kreaturLabelHoehe({ label: 'x' }) === 1.45, 'kreaturLabelHoehe: Standard 1,45, Eintrag gilt, Unsinn fällt auf den Standard zurück');
  ok(P.kreaturWippFaktor(null) === 1 && P.kreaturWippFaktor({}) === 1 && P.kreaturWippFaktor({ wippen: 2 }) === 2 && P.kreaturWippFaktor({ wippen: 0 }) === 1, 'kreaturWippFaktor: Standard 1, Eintrag gilt');
  ok(P.kreaturSterneErlaubt(null) === true && P.kreaturSterneErlaubt({}) === true && P.kreaturSterneErlaubt({ sterne: false }) === false && P.kreaturSterneErlaubt({ sterne: true }) === true, 'kreaturSterneErlaubt: nur sterne:false schaltet ab');
  const TYP = { schwarmling: IDS.indexOf('schwarmling'), koenigin: IDS.indexOf('koenigin'), rudeltier: IDS.indexOf('rudeltier') };
  ok(TYP.schwarmling > 0 && TYP.koenigin > 0, 'Typcodes aus kreaturen.json: schwarmling ' + TYP.schwarmling + ', koenigin ' + TYP.koenigin);
  // Schwarmling: Modell, Sporen, Maßstab
  let w = welt({ bereit: true }), a = w.akteur();
  w.fn.updateKreatur(a, tier(5, 16, TYP.schwarmling), 0.05, 1);
  const k = w.loads.find((l) => l.id === 'kreatur/schwarmling'), m = w.loads.find((l) => l.id === 'kreatur/schwarmling_sporen');
  ok(k && m && JSON.stringify(k.params) === JSON.stringify({ pose: 0, fell: 0, beinphase: 0 }) && JSON.stringify(m.params) === JSON.stringify({ ladung: 0, pose: 0 }) && w.fallbacks.length === 0, 'Schwarmling: Körper {pose 0, fell 0, beinphase 0} und Sporen {ladung 0, pose 0}, kein Platzhalter');
  ok(a.labelH === 0.8, 'Schwarmling: Namenszug auf 0,8 m (Modell 0,4 m hoch)');
  for (const [b, pose] of [[4 | 16, 2], [8 | 16, 3], [16, 0]]) { w = welt({ bereit: true }); a = w.akteur(); w.fn.updateKreatur(a, tier(5, b, TYP.schwarmling), 0.05, 1); ok(w.loads.every((l) => l.params.pose === pose) && w.loads.length === 2, 'Schwarmling Bits ' + b + ': Körper und Sporen in Pose ' + pose + ' (hocke / biss / steh)'); }
  // Pause: keine Sterne (Schwarmling, Königin), das Rudeltier behält sie
  for (const [typ, nm] of [[TYP.schwarmling, 'Schwarmling'], [TYP.koenigin, 'Königin'], [TYP.rudeltier, 'Rudeltier']]) {
    w = welt({ bereit: true }); a = w.akteur(); a.speed = 0;
    for (let i = 0; i < 10; i++) w.fn.updateKreatur(a, tier(7, 4 | 16, typ), 0.025, 1 + i * 0.025);
    ok(!!(a.sterne && a.sterne.visible) === (nm === 'Rudeltier'), nm + ' in Pause (Modus steht): Sterne ' + (a.sterne && a.sterne.visible ? 'sichtbar' : 'aus'));
  }
  // Königin: feste Pose 2 (Modus steht), Namenshöhe, kein Versatz
  w = welt({ bereit: true }); a = w.akteur(); a.speed = 0;
  w.fn.updateKreatur(a, tier(9, 4 | 16, TYP.koenigin), 0.05, 1);
  const kk = w.loads.find((l) => l.id === 'kreatur/koenigin');
  ok(kk && kk.params.pose === 2 && w.loads.some((l) => l.id === 'kreatur/koenigin_sporen') && a.labelH === 2.3 && a.body.position.y === 0 && w.fallbacks.length === 0, 'Königin: Körper und Sporen, Pose 2 (Dauerzustand steht), Namenszug auf 2,3 m, ruhig');
  const cache = w.loads.length; for (let i = 0; i < 30; i++) w.fn.updateKreatur(a, tier(9, 4 | 16, TYP.koenigin), 0.05, 2 + i * 0.1);
  ok(w.loads.length === cache, 'Königin im Dauerzustand: nach dem ersten Bild kein weiterer Aufbau (' + cache + ' Teilmodelle)');
  // Wippen: Schwarmling stärker als das Rudeltier bei gleichem Tempo
  const wipp = (typ) => { let mx = 0; const w2 = welt({ bereit: true }), a2 = w2.akteur(); a2.speed = 2.8; for (let i = 0; i < 80; i++) { a2.dist = i * 0.05; w2.fn.updateKreatur(a2, tier(3, 16, typ), 0.025, 1 + i * 0.025); mx = Math.max(mx, a2.body.position.y); } return mx; };
  const ws = wipp(TYP.schwarmling), wr = wipp(TYP.rudeltier);
  ok(wr > 0 && Math.abs(ws / wr - 2) < 0.15 && ws < 0.08, 'Wippen: Schwarmling ' + ws.toFixed(3) + ' m gegen Rudeltier ' + wr.toFixed(3) + ' m (Faktor 2), klein gegen das Modell');
  // Rückfall bleibt
  w = welt({ bereit: false }); a = w.akteur(); w.fn.updateKreatur(a, tier(5, 16, TYP.schwarmling), 0.05, 1);
  ok(w.fallbacks.length === 1 && a.model && a.model.userData.placeholder, 'Schwarmling ohne gebautes Asset: grauer Platzhalter (Rückfall)');
});

section('Pause-Sterne: Material, Form, Größe, Höhe (MON-02 Nacharbeit H1)', () => {
  const w = welt({ bereit: true }), a = w.akteur(); a.speed = 0;
  const hoehen = [];
  for (let i = 0; i < 40; i++) { w.fn.updateKreatur(a, tier(3, 4 | 2), 0.025, 1 + i * 0.025); hoehen.push(a.sterne.position.y); }
  const s = a.sterne, T = w.L.THREE, near = (x, y, e) => Math.abs(x - y) <= (e == null ? 1e-9 : e);
  ok(s && s.children.length === 3 && s.visible, 'drei Sterne im Zustand Pause');
  const mat = s.children[0].material;
  ok(s.children.every((m) => m.material === mat) && mat instanceof T.MeshBasicMaterial && mat.toneMapped === false, 'Material: MeshBasicMaterial (unbeleuchtet) mit toneMapped false, ein Material für alle drei');
  ok(mat.farbe === '#FFF4C0' && near(mat.color.v, 1.6), 'Farbe #FFF4C0, mit 1,6 multipliziert (über 1: greift im Bloom; der Helm #E0D4B8 ist beleuchtet und liegt darunter)');
  ok(w.fbCalls === 0, 'kein fbMaterial (das beleuchtete Standardmaterial) für die Sterne');
  ok(s.children.every((m) => near(m.scale.x, 0.12) && near(m.scale.y, 0.12) && near(m.scale.z, 0.12)), 'Größe 0,12 m');
  ok(s.children.every((m) => near(m.rotation.x, Math.PI / 4) && near(m.rotation.z, Math.PI / 4)), 'um π/4 gedreht (Rauten statt achsparalleler Würfel, nicht wie Sandbrocken)');
  ok(s.children.every((m) => near(Math.hypot(m.position.x, m.position.z), 0.32)), 'Ring-Radius 0,32 m');
  ok(Math.min(...hoehen) >= 0.95 - 0.0401 && Math.max(...hoehen) <= 0.95 + 0.0401 && Math.min(...hoehen) > 0.9, 'Höhe um 0,95 m (schwankt ±0,04), klar über dem Helm (Modell 0,81 m hoch): ' + Math.min(...hoehen).toFixed(2) + ' bis ' + Math.max(...hoehen).toFixed(2));
});

section('Zittern: Größe in px, Kippen (MON-02 Nacharbeit M1)', () => {
  for (const l of [0, 1, 2, 3]) {
    const w = welt({ bereit: true }), a = w.akteur(); a.speed = 0; let pos = 0, rot = 0;
    for (let i = 0; i < 120; i++) { w.fn.updateKreatur(a, tier(3, 64 | l), 0.025, 1 + i * 0.025); pos = Math.max(pos, Math.abs(a.body.position.x), Math.abs(a.body.position.z)); rot = Math.max(rot, Math.abs(a.body.rotation.z)); }
    const amp = 0.02 + 0.01 * l;
    ok(pos * 32 >= (l === 0 ? 0.55 : 0.85 + (l - 1) * 0.3) && pos <= amp + 1e-9, 'Ladung ' + l + ': Zittern bis ' + (pos * 32).toFixed(2) + ' px (Amplitude ' + amp.toFixed(2) + ' m, sichtbar ab etwa 0,6 px)');
    ok(rot <= 2 * amp + 1e-9 && rot >= 2 * amp * 0.9, 'Ladung ' + l + ': Kippen bis ' + rot.toFixed(3) + ' rad (Faktor 2 auf die Amplitude, bei Ladung 3 höchstens 0,1 rad)');
  }
});

section('Quelltext: keine Typnamen im Client-Kern, Effekte, Einhängestellen', () => {
  const kern = ac.slice(a0, a3).split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  ok(!/rudeltier|probe|helmhy/i.test(kern.replace(/kreatur\/rudeltier/g, '')) && !/'kreatur\/[a-z_]+'/.test(kern), 'actors.js: im Kreaturen-Code (ohne Kommentare) kein Typname und keine feste Modell-ID, nur Daten aus dem Client-Content');
  ok(/kind === 'kreatur'\) \{ updateKreatur\(a, e, dt, t\); return; \}/.test(ac), 'updateEnemy ruft updateKreatur für Kreaturen');
  ok(/function kreaturPlatzhalter/.test(ac) && /fallbackModel\('kreatur\|' \+ b\)/.test(ac), 'der MON-01-Platzhalter bleibt als Rückfall (kreaturPlatzhalter, fallbackModel kreatur|bits)');
  const mo = ac.slice(ac.lastIndexOf("if (kind === 'monster')"), ac.indexOf("if (kind === 'kreatur')"));
  ok(/updateStationMonster/.test(mo) && !/kreatur/.test(mo) && /lerche\/actor\/monster/.test(ac.slice(ac.indexOf('function monsterRueckfall'), ac.indexOf('function updateStationMonster'))), 'Station-Monster-Pfad (mo) getrennt von den Kreaturen (MON-02 O3b: updateStationMonster, der alte Quader bleibt im Rückfall monsterRueckfall)');
  const fx = read('public/js/voxel/fx.js');
  ok(/case 'staub': FX\.staub\(p, o\.dir\); break;/.test(fx) && /\n  staub\(p, dir\) \{/.test(fx), 'fx.js: Effekt staub (spawnFx(\'staub\', { pos, dir })) vorhanden');
  ok(/fx\.spawnFx\('staub'/.test(ac), 'actors.js löst die Staubspur über spawnFx aus (vorhandenes Effektsystem, keine Eigenlösung)');
  const rd = read('public/js/render.js');
  ok(/function drawKreatur/.test(rd) && !/zielt|& 64/.test(rd.slice(rd.indexOf('function drawKreatur'), rd.indexOf('function drawMonster'))), '2D (drawKreatur) unverändert: liest Bit 6 nicht');
  const sv = read('server/sim/kreatur.js'), pr = read('shared/protocol.js'), c2 = read('CONTRACT-B2.md'), rm = read('README.md');
  ok(/BIT_ZIELT = 64/.test(sv) && /modus === 'zielen' \? BIT_ZIELT : 0/.test(sv), 'Server: BIT_ZIELT = 64 für den Modus zielen');
  ok(/6 zielt/.test(pr) && /Bit 6 \(Wert 64\) zielt/.test(c2) && /Bit 6 \(Wert 64\) zielt/.test(rm), 'Bit 6 ist in protocol.js, CONTRACT-B2.md und README.md dokumentiert');
  ok(/kreaturen\/modelle\.json/.test(rm) && /kreaturen\/modelle\.json/.test(c2), 'Client-Content modelle.json ist in README.md und CONTRACT-B2.md beschrieben');
});

// Code-Review 13e: schlägt der Abruf von modelle.json fehl, bleibt es nicht bis zum Neuladen beim Platzhalter, sondern nach KR_INHALT_WARTE s wird neu versucht
async function inhaltNeuVersuchen() {
  console.log('\n[Client-Content: neuer Abruf nach einem Fehler]');
  const flush = () => new Promise((r) => setTimeout(r, 5));
  const mkFetch = (plan) => {
    const f = (url) => {
      f.calls.push(url); const p = plan.shift();
      return p === 'netz' ? Promise.reject(new Error('Netz weg'))
        : p === '404' ? Promise.resolve({ ok: false })
        : p === 'kaputt' ? Promise.resolve({ ok: true, json: () => Promise.reject(new Error('kein JSON')) })
        : p === 'leer' ? Promise.resolve({ ok: true, json: () => Promise.resolve({ ohne: 1 }) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(MODELLE) });
    };
    f.calls = []; return f;
  };
  const f = mkFetch(['netz', '404', 'kaputt', 'leer', 'ok']), w = welt({ bereit: true, leer: true, fetch: f }), a = w.akteur();
  const up = (t) => w.fn.updateKreatur(a, tier(8, 2), 0.05, t);
  up(1); up(1.05);
  ok(f.calls.length === 1 && f.calls[0] === '/content/kreaturen/modelle.json', 'erster Abruf beim ersten Bild, ein laufender Abruf wird nicht doppelt gestartet (' + f.calls.length + ' Aufruf)');
  await flush();
  ok(!w.L.kreaturInhalt && w.fallbacks.length > 0 && a.model && a.model.userData.placeholder, 'Netzfehler: bis dahin der Platzhalter');
  up(2); up(5.9);
  ok(f.calls.length === 1, 'innerhalb der Wartezeit (5 s) kein neuer Abruf');
  up(6.1); await flush();
  ok(f.calls.length === 2, 'nach 5 s ein zweiter Abruf (Antwort 404)');
  up(8); up(11.0);
  ok(f.calls.length === 2, 'wieder erst nach der Wartezeit');
  up(11.2); await flush();
  ok(f.calls.length === 3, 'dritter Abruf (kaputtes JSON)');
  up(16.3); await flush();
  ok(f.calls.length === 4 && !w.L.kreaturInhalt, 'vierter Abruf (JSON ohne typen: gilt als Fehler)');
  up(21.4); await flush();
  ok(f.calls.length === 5 && w.L.kreaturInhalt && w.L.kreaturInhalt.typen, 'fünfter Abruf gelingt: der Inhalt ist geladen');
  up(21.5);
  ok(a.model && a.model.name === 'slot:kreatur/rudeltier' && w.loads.length > 0, 'danach zeigt das Tier das Modell statt des Platzhalters');
  up(60); up(100);
  ok(f.calls.length === 5, 'nach Erfolg kein weiterer Abruf');
}

inhaltNeuVersuchen().then(() => {
  console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e)); console.log('\n' + (n - fails) + '/' + n + ' ok, FEHLER'); process.exit(1); });
