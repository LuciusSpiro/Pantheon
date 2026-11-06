'use strict';
// MON-02 O3a: Optik der Kreaturen im Voxelmodus (Rudeltier D „Helmhyäne“). Client-Funktionen aus public/js/voxel/actors.js, gelesen aus dem Quelltext
// (der Block bis KREATUR-OPTIK-ENDE ist rein und wird als Funktion ausgeführt; die Anzeige-Funktionen laufen gegen Attrappen von THREE, Lader und Akteur).
// Geprüft: Client-Content (Zuordnung Typ -> Modell, Reihenfolge = kreaturen.json, Manifest, Auslieferung), Fell aus der Tier-Nummer, Pose aus den Bits
// (inkl. Bit 6 zielt), Beinphase aus der Strecke, Marken mit Ladung und derselben Pose, Cache-Schlüssel (Anzahl), Rückfall ohne Eintrag/Asset/Marken,
// Zittern/Staub/Sterne/Pulsieren nur im richtigen Zustand, Wippen nur in Bewegung, keine Typnamen im Client-Kern, Staub-Effekt in fx.js.
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
const P = new Function(REIN + '\nreturn { KR_SCHRITT, kreaturEintrag, kreaturFell, kreaturPose, kreaturLadung, kreaturBeinphase, kreaturParameter, kreaturSchluessel, kreaturZitterAmp, kreaturStaubAn, kreaturSterneAn, kreaturPuls, kreaturWippen, kreaturMarkenPivot };')();

const KREATUREN = require('../content/kampf/kreaturen.json');
const MODELLE = JSON.parse(read('content/kreaturen/modelle.json'));
const MANIFEST = JSON.parse(read('assets/manifest/mon02.json'));
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
  ok(P.kreaturZitterAmp(64 | 3) > P.kreaturZitterAmp(64 | 0) && P.kreaturZitterAmp(64 | 3) < 0.05, 'Zittern wächst mit der Ladung und bleibt klein (< 5 cm)');
  let max = 0, min = 9; for (let t = 0; t < 2; t += 0.01) { const s = P.kreaturPuls(3, t); max = Math.max(max, s); min = Math.min(min, s); }
  ok(max > 1.15 && min < 1.02 && max <= 1.2001, 'Marken pulsieren bei Ladung 3 (Skalierung ' + min.toFixed(2) + ' bis ' + max.toFixed(2) + ')');
  const per = []; for (let t = 0.001; t < 2; t += 0.001) if (P.kreaturPuls(3, t) > 1.199 && P.kreaturPuls(3, t - 0.001) <= 1.199) per.push(t);
  ok(per.length >= 2 && per.length <= 4, 'Puls 1 bis 2 Hz (' + per.length + ' Spitzen in 2 s)');
  ok([0, 1, 2, 2 | 4, 2 | 8, 2 | 64, 64].every((b) => P.kreaturPuls(b, 0.123) === 1 && P.kreaturPuls(b, 0.4) === 1) && P.kreaturPuls(3 | 8, 0.1) !== 1, 'Pulsieren nur bei Ladung 3 (in jedem Zustand, auch beim Rammen; nicht bei Ladung 0 bis 2)');
  ok(P.kreaturWippen(0, 0, 1.3) === 0 && P.kreaturWippen(0, 0.1, 1.3) === 0 && P.kreaturWippen(8, 0, 0.3) === 0, 'Wippen: im Stand (Tempo 0) kein Versatz');
  let wg = 0, wj = 0, wr = 0; for (let s = 0; s < 3; s += 0.01) { wg = Math.max(wg, P.kreaturWippen(0, 1.4, s)); wj = Math.max(wj, P.kreaturWippen(0, 2.8, s)); wr = Math.max(wr, P.kreaturWippen(8, 7.5, s)); }
  ok(wg > 0 && wg < wj && wj < wr && wr <= 0.06 && wg <= 0.03, 'Wippen: leicht beim Gehen (' + wg.toFixed(3) + ' m), stärker in der Jagd (' + wj.toFixed(3) + ' m) und beim Rammen (' + wr.toFixed(3) + ' m), alles klein (Tier 0,8 m hoch)');
  const pv = [0, 1, 2, 3].map(P.kreaturMarkenPivot);
  ok(pv.every((v) => v[0] === 0 && v[1] > 0.6 && v[1] < 0.9 && v[2] < 0) && pv[0][1] > pv[1][1] && pv[1][1] > pv[2][1], 'Marken-Pivot liegt auf dem Rücken (hinten, y 0,7 bis 0,9 m, mit der Pose abgesenkt)');
});

// ---- Anzeige gegen Attrappen
class O3 {
  constructor(name) { this.name = name; this.children = []; this.parent = null; this.userData = {}; this.visible = true; const v = (o) => Object.assign(o, { set(x, y, z) { o.x = x; o.y = y; o.z = z; return o; } }); this.position = v({ x: 0, y: 0, z: 0 }); this.rotation = v({ x: 0, y: 0, z: 0 }); this.scale = Object.assign({ x: 1, y: 1, z: 1 }, { setScalar(s) { this.x = this.y = this.z = s; }, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }); }
  add(c) { this.children.push(c); c.parent = this; return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parent = null; } return this; }
}
function welt(opt) {
  const w = { bereit: !!(opt && opt.bereit), marken: opt && opt.marken !== undefined ? opt.marken : null, loads: [], fallbacks: [], fx: [] };
  const L = { THREE: { Group: O3, Mesh: O3 }, fbGeo: {}, kreaturInhalt: opt && opt.inhalt !== undefined ? opt.inhalt : MODELLE };
  const loadModel = (id, params, fb) => { const s = new O3('slot:' + id); const isMarken = /marken/.test(id); s.userData.slot = { ready: isMarken && w.marken !== null ? w.marken : w.bereit, id, params }; s.userData.params = params; w.loads.push({ id, params, fb }); return s; };
  const refreshSlot = () => {};
  const fallbackModel = (k) => { w.fallbacks.push(k); const g = new O3('fb:' + k); g.userData.placeholder = true; return g; };
  const window = { VoxelFx: { spawnFx: (t, o) => w.fx.push([t, o]) }, Render: { KREATUR: { pause: '#fff' } } };
  const place = (a, x, y) => { a.container.position.set(x / 32, 0, y / 32); return { x: x / 32, z: y / 32 }; };
  const locomote = () => 0, yawOf = () => 0, fbMaterial = () => ({});
  const fn = new Function('L', 'loadModel', 'refreshSlot', 'fallbackModel', 'place', 'locomote', 'yawOf', 'fbMaterial', 'window', 'fetch', REIN + ANZEIGE + '\nreturn { updateKreatur, kreaturModellAnwenden, kreaturPlatzhalter, kreaturEffekte };')(L, loadModel, refreshSlot, fallbackModel, place, locomote, yawOf, fbMaterial, window, undefined);
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

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
