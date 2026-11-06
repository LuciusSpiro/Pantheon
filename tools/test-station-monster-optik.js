'use strict';
// MON-02 O3b: Optik des Station-Monsters „Schottbrecher“ im Voxelmodus. Client-Funktionen aus public/js/voxel/actors.js, gelesen aus dem Quelltext
// (der Block bis STATION-MONSTER-OPTIK-ENDE ist rein und wird als Funktion ausgeführt; die Anzeige-Funktionen laufen gegen Attrappen von THREE, Akteur und Figur,
// die Posen sind die echten aus public/voxel/assets/poses/schottbrecher.json).
// Geprüft: Zustandsabbildung aus away.mo (alle Kombinationen, Vorrang Pause > Rammen > Jagd > Lärm/Suche > Patrouille), Pose-Werte aus den Zyklen (Phase, Periode, shift,
// Sensor k 0,5), Zyklus ruht im Stand, Überblenden unter 0,2 s, Kegel (Länge/Breite je Zustand, aus in der Pause, kurz heller beim Rammen, an der Wand gekürzt,
// dreht mit dem Sensor), Ruck nur beim Rammen (steigende Flanke), Funken nur beim Rammen, Licht aus in der Pause, Rückfall ohne Asset, Snapshot mo unverändert,
// kein Zugriff auf Serverzustand, Manifest/Asset-Sync.
//   node tools/test-station-monster-optik.js   (npm run test:station-monster-optik)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-9 : e);
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};

const ac = read('public/js/voxel/actors.js');
const a0 = ac.indexOf('const SM_FIGUR'), a1 = ac.indexOf('// STATION-MONSTER-OPTIK-ENDE'), a2 = ac.indexOf('function monsterKegelBauen'), a3 = ac.indexOf('function updateEnemy(');
if (a0 < 0 || a1 < a0 || a2 < a1 || a3 < a2) { console.log('  FEHLER Quelltext-Blöcke in actors.js nicht gefunden'); process.exit(1); }
const REIN = ac.slice(a0, a1), ANZEIGE = ac.slice(a2, a3);
const NAMEN = ['SM_FIGUR', 'SM_ZUSTAENDE', 'SM_BLEND', 'SM_BEWEGT', 'SM_RUCK_VOXEL', 'SM_RUCK_ZEIT', 'SM_RUCK_ZURUECK', 'SM_FUNKEN_TAKT', 'SM_KEGEL', 'SM_KEGEL_TEMPO',
  'monsterZustand', 'monsterPoseWerte', 'monsterBlend', 'monsterBlendFaktor', 'monsterBewegt', 'monsterGehenGewicht', 'monsterPhase', 'monsterRuckSchritt', 'monsterRammSeit',
  'monsterLampeAn', 'monsterKegelZiel', 'monsterKegelBlitz', 'monsterKegelMischen', 'monsterStrahl', 'monsterKegelLaenge', 'monsterKegelGlaetten', 'monsterFunkenAn',
  'monsterFunkenZahl', 'monsterFunkenPunkt', 'monsterFigurEcht'];
const P = new Function(REIN + '\nreturn { ' + NAMEN.join(', ') + ' };')();

const POSEN = JSON.parse(read('public/voxel/assets/poses/schottbrecher.json')).poses;
const RIG = JSON.parse(read('public/voxel/assets/rigs/schottbrecher.json'));
const ZUSTAENDE = ['patrouille', 'laerm', 'jagd', 'rammen', 'pause'];
const D2R = Math.PI / 180;

section('Zustand aus away.mo: alle Kombinationen, Vorrang Pause > Rammen > Jagd > Lärm/Suche > Patrouille', () => {
  const erwartet = (z, r, h) => (h ? 'pause' : r ? 'rammen' : z === 'j' ? 'jagd' : (z === 'l' || z === 's') ? 'laerm' : 'patrouille');
  let alle = 0, falsch = 0;
  for (const z of ['p', 'l', 's', 'j']) for (const r of [undefined, 1]) for (const h of [undefined, 1]) {
    alle++;
    const mo = { x: 1, y: 2, z, f: 0.5 }; if (r) mo.r = r; if (h) mo.h = h;
    if (P.monsterZustand(mo) !== erwartet(z, r, h)) { falsch++; console.log('    ' + JSON.stringify(mo) + ' -> ' + P.monsterZustand(mo)); }
  }
  ok(alle === 16 && falsch === 0, 'alle 16 Kombinationen aus z (p, l, s, j), r und h folgen dem Vorrang (' + falsch + ' falsch)');
  ok(P.monsterZustand({ z: 'j', r: 1, h: 1 }) === 'pause' && P.monsterZustand({ z: 'j', r: 1 }) === 'rammen' && P.monsterZustand({ z: 'j' }) === 'jagd' && P.monsterZustand({ z: 's' }) === 'laerm' && P.monsterZustand({ z: 'p' }) === 'patrouille', 'Beispiele: Jagd + rammt + Pause = Pause, Jagd + rammt = Rammen, Suche = Lärm');
  const sicher = (f) => { try { return f(); } catch (e) { return 'WURF ' + e.message; } };
  ok(sicher(() => P.monsterZustand(null)) === 'patrouille' && sicher(() => P.monsterZustand({})) === 'patrouille' && sicher(() => P.monsterZustand({ z: 'x' })) === 'patrouille', 'ohne mo oder mit unbekanntem z: Patrouille (ohne Ausnahme)');
  ok(JSON.stringify(P.SM_ZUSTAENDE) === JSON.stringify(ZUSTAENDE) && ZUSTAENDE.every((z) => POSEN[z]), 'die fünf Zustände heißen wie die Posen des Assets (patrouille, laerm, jagd, rammen, pause)');
});

// Referenz (unabhängig vom Client): Winkel/Verschiebung einer Pose nach der Formel des Voxelwerks (tools/cha-pose.mjs poseWerte)
function ref(name, phi, gehen) {
  const p = POSEN[name], j = {}, s = {};
  for (const [k, v] of Object.entries(p.joints || {})) j[k] = v.slice();
  for (const [k, v] of Object.entries(p.shift || {})) s[k] = v.slice();
  if (p.cycle && gehen > 0) for (const [art, dst] of [['joints', j], ['shift', s]]) for (const [k, c] of Object.entries(p.cycle[art] || {})) {
    const w = Math.sin(2 * Math.PI * phi * (c.k || 1) + (c.p || 0) * D2R), b = dst[k] || [0, 0, 0];
    dst[k] = [0, 1, 2].map((i) => b[i] + (c.c[i] + c.a[i] * w - b[i]) * gehen);
  }
  return { joints: j, shift: s };
}
const gleich = (A, B, e) => ['joints', 'shift'].every((art) => { const ks = new Set([...Object.keys(A[art]), ...Object.keys(B[art])]); for (const k of ks) { const a = A[art][k] || [0, 0, 0], b = B[art][k] || [0, 0, 0]; if (!a.every((v, i) => near(v, b[i], e == null ? 1e-9 : e))) return false; } return true; });

section('Pose-Werte aus den Zyklen: Phase, Periode, shift, Sensor', () => {
  for (const z of ZUSTAENDE) for (const phi of [0, 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2.3]) for (const g of [0, 0.5, 1]) {
    if (!gleich(P.monsterPoseWerte(POSEN, z, phi, g), ref(z, phi, g))) { ok(false, 'Pose ' + z + ' φ ' + phi + ' gehen ' + g + ' weicht von der Formel ab'); return; }
  }
  ok(true, 'monsterPoseWerte = Formel c + a·sin(2π·φ·k + p) für alle fünf Posen, 8 Phasen, Gewicht 0/0,5/1');
  const pa = (phi) => P.monsterPoseWerte(POSEN, 'patrouille', phi, 1);
  ok(near(pa(0).joints.hipVL[0], 0) && near(pa(0.25).joints.hipVL[0], -11) && near(pa(0.25).joints.hipVR[0], 11) && near(pa(0.25).joints.hipHL[0], 11) && near(pa(0.25).joints.hipHR[0], -11), 'Patrouille: Hüften schwingen ±11°, diagonale Beinpaare (VL+HR gegen VR+HL) gegenphasig');
  ok(near(pa(1).joints.hipVL[0], pa(0).joints.hipVL[0], 1e-9) && near(pa(1.25).joints.hipVL[0], pa(0.25).joints.hipVL[0], 1e-9), 'Periode der Beine = 1 Zyklus (φ + 1 gibt denselben Wert)');
  ok(near(pa(0.5).joints.sensor[1], 28) && near(pa(1).joints.sensor[1], 0, 1e-9) && near(pa(1.5).joints.sensor[1], -28) && near(pa(2).joints.sensor[1], 0, 1e-9) && !near(pa(1).joints.sensor[1], pa(0.5).joints.sensor[1]), 'Sensorschwenk ±28° mit k 0,5: Periode 2 Zyklen (Höchstwert bei φ 0,5, Nulldurchgang bei 1 und 2)');
  ok(near(pa(0).shift.footVL[1], 3) && near(pa(0.5).shift.footVL[1], 0, 1e-9) && near(pa(0).shift.footVR[1], 0, 1e-9) && near(pa(0.5).shift.footVR[1], 3), 'Teleskop hebt den Fuß um 3 Voxel (shift y 0..3), die Gegenseite gegenphasig');
  const ja = (phi) => P.monsterPoseWerte(POSEN, 'jagd', phi, 1);
  ok(near(ja(0.25).joints.hipVL[0], -16) && near(ja(0).shift.footVL[1], 9) && near(ja(0.5).shift.footVL[1], 5, 1e-9) && near(P.monsterPoseWerte(POSEN, 'jagd', 0, 0).shift.hull[1], -5), 'Jagd: Hüfte ±16°, Teleskop 5 bis 9 Voxel, Wanne 5 Voxel tiefer');
  const st = P.monsterPoseWerte(POSEN, 'patrouille', 0.25, 0);
  ok(Object.keys(st.joints).length === 0 && st.shift.hull.join() === '0,0,0' && st.shift.footVL.join() === '0,0,0', 'Gewicht 0 (Stillstand): Standpose ohne Schritt und ohne Schwenk, alle Füße am Boden (shift 0)');
  const lm = P.monsterPoseWerte(POSEN, 'laerm', 0.3, 1), pz = P.monsterPoseWerte(POSEN, 'pause', 0.3, 1), ra = P.monsterPoseWerte(POSEN, 'rammen', 0.3, 1);
  ok(lm.joints.horchL.join() === '0,0,-82' && lm.joints.horchR.join() === '0,0,82' && !POSEN.laerm.cycle, 'Lärm: Horchplatten klappen hoch (∓82°), kein Zyklus');
  ok(pz.shift.lampe.join() === '0,-2,-2' && pz.shift.hull[1] === -10.5 && !POSEN.pause.cycle && ra.shift.schild.join() === '0,-2,3' && ra.joints.hull[0] === 9 && !POSEN.rammen.cycle, 'Pause: Lampe versenkt, Wanne 10,5 tiefer (liegt fast am Boden; MON-02 Nacharbeit M4, vorher 6); Rammen: Schild ausgefahren und abgesenkt, Wanne vorn gekippt; beide ohne Zyklus');
  ok(P.monsterPoseWerte(POSEN, 'gibtesnicht', 0, 1).joints && Object.keys(P.monsterPoseWerte(null, 'patrouille', 0, 1).joints).length === 0, 'unbekannte Pose oder keine Posen: leere Werte statt Absturz');
  // Phase
  ok(near(P.monsterPhase(0.2, 1.2, 0.5, true), 0.8) && P.monsterPhase(0.2, 1.2, 0.5, false) === 0.2, 'Phase läuft mit hz (1,2 Hz · 0,5 s = 0,6 Perioden), nur in Bewegung; im Stand steht sie');
  ok(P.monsterPhase(1023.9, 2.6, 1, true) < 4 && P.monsterBewegt(0.3) && !P.monsterBewegt(0.2) && !P.monsterBewegt(0), 'Phase bleibt beschränkt (Modulo 1024); bewegt = Tempo über 0,25 m/s');
  let g = 0; for (let i = 0; i < 30; i++) g = P.monsterGehenGewicht(g, true, 0.01);
  ok(near(g, 1) && P.monsterGehenGewicht(0, true, 0.075) === 0.5 && P.monsterGehenGewicht(1, false, 0.075) === 0.5 && P.monsterGehenGewicht(0.02, false, 1) === 0, 'Gehen-Gewicht läuft in 0,15 s auf 1 und zurück auf 0');
});

section('Überblenden unter 0,2 s', () => {
  ok(P.SM_BLEND > 0 && P.SM_BLEND < 0.2, 'Überblenddauer ' + P.SM_BLEND + ' s liegt unter 0,2 s');
  ok(P.monsterBlendFaktor(0) === 0 && near(P.monsterBlendFaktor(P.SM_BLEND / 2), 0.5) && P.monsterBlendFaktor(P.SM_BLEND) === 1 && P.monsterBlendFaktor(0.19) === 1 && P.monsterBlendFaktor(-1) === 0, 'Faktor linear: 0 bei 0 s, 0,5 bei der halben Zeit, 1 nach SM_BLEND (und bei 0,19 s)');
  const von = P.monsterPoseWerte(POSEN, 'patrouille', 0.25, 1), ziel = P.monsterPoseWerte(POSEN, 'pause', 0, 0);
  ok(gleich(P.monsterBlend(von, ziel, 0), von) && gleich(P.monsterBlend(von, ziel, 1), ziel), 'Blend s 0 = Ausgangspose, s 1 = Zielpose (Winkel und shift)');
  const mid = P.monsterBlend(von, ziel, 0.5);
  ok(near(mid.joints.hipVL[0], (von.joints.hipVL[0] + 0) / 2) && near(mid.joints.hipVL[2], (von.joints.hipVL[2] + -10) / 2) && near(mid.shift.hull[1], -5.25) && near(mid.shift.lampe[2], -1), 'Zwischenwert: Mitte je Gelenk (Winkel und shift, auch Gelenke, die nur eine Seite kennt, z. B. hull -10,5 und lampe -2)');
  ok(P.monsterBlend(null, ziel, 0.3) === ziel, 'ohne Ausgangspose (erstes Bild) = Zielpose');
  // Zustandsmaschine: kein Frame-Sprung größer als der Schritt
  let maxSprung = 0, prev = null;
  for (let i = 0; i <= 20; i++) { const w = P.monsterBlend(von, ziel, P.monsterBlendFaktor(i * 0.01)); if (prev) for (const art of ['joints', 'shift']) for (const k of Object.keys(w[art])) maxSprung = Math.max(maxSprung, Math.abs(w[art][k][1] - prev[art][k][1]), Math.abs(w[art][k][0] - prev[art][k][0])); prev = w; }
  ok(maxSprung < 12, 'in 10-ms-Schritten springt kein Gelenk um mehr als ' + maxSprung.toFixed(1) + ' (Grad oder Voxel): weicher Wechsel');
});

section('Lichtkegel: Länge, Breite und Helligkeit je Zustand', () => {
  const K = P.SM_KEGEL;
  ok(ZUSTAENDE.every((z) => K[z] && P.monsterKegelZiel(z) === K[z]), 'ein Kegel je Zustand');
  ok(K.laerm.laenge > K.patrouille.laenge && K.patrouille.laenge > K.jagd.laenge && K.jagd.laenge > K.rammen.laenge && K.rammen.laenge > 0, 'Länge: Lärm/Suche am längsten, dann Patrouille (mittel), Jagd (kurz), Rammen (sehr kurz)');
  ok(K.laerm.breite < K.rammen.breite && K.rammen.breite < K.patrouille.breite && K.patrouille.breite < K.jagd.breite, 'Breite: Lärm/Suche schmal, Rammen gestaucht, Patrouille mittel, Jagd breit');
  ok(K.laerm.laenge / K.laerm.breite > 5 && K.jagd.laenge / K.jagd.breite < 1 && K.rammen.laenge / K.rammen.breite < 1, 'Form: Lärm lang und schmal (Verhältnis > 5), Jagd kurz und breit, Rammen gestaucht (beide < 1)');
  ok(K.jagd.hell > K.patrouille.hell && K.jagd.hell > K.laerm.hell, 'Jagd ist am hellsten');
  ok(K.pause.laenge === 0 && K.pause.breite === 0 && K.pause.hell === 0, 'Pause: Kegel aus');
  ok(ZUSTAENDE.every((z) => K[z].hell <= 0.6), 'additiv, nie voll weiß (Helligkeit höchstens 0,6)');
  ok(P.monsterKegelBlitz('rammen', 0) > 1.4 && near(P.monsterKegelBlitz('rammen', 0.25), 1, 1e-9) && P.monsterKegelBlitz('rammen', 0.6) === 1 && P.monsterKegelBlitz('jagd', 0) === 1 && P.monsterKegelBlitz('pause', 0) === 1, 'Rammen: kurz heller (1,6-fach, in 0,25 s auf 1), andere Zustände nie');
  const m = P.monsterKegelMischen(K.patrouille, K.pause, 0.5);
  ok(near(m.laenge, K.patrouille.laenge / 2) && near(m.hell, K.patrouille.hell / 2) && P.monsterKegelMischen(null, K.jagd, 0.3) === K.jagd, 'Kegel-Mischen linear (halber Weg = halbe Länge, Breite, Helligkeit)');
  ok(P.monsterKegelGlaetten(null, 3, 0.016) === 3 && near(P.monsterKegelGlaetten(0, 3, 0.1), 1.2) && near(P.monsterKegelGlaetten(3, 0, 0.1), 1.8) && P.monsterKegelGlaetten(2.9, 3, 1) === 3, 'Länge wird nur mit höchstens 12 m/s nachgeführt (kein Aufblitzen an Ecken)');
});

section('Kegel an der Wand gekürzt', () => {
  const wand = (tx) => (x, y) => x >= tx;      // senkrechte Wand ab Kachelspalte tx
  // Monster bei x = 100 px, blickt nach +x (yaw = π/2 wie yawOf(1, 0)), Lichtschlitz 0,3 m vor der Mitte
  const frei = P.monsterKegelLaenge(5.6, 0.8, 0.3, 100, 100, Math.PI / 2, () => false), mitWand = P.monsterKegelLaenge(5.6, 0.8, 0.3, 100, 100, Math.PI / 2, wand(5));
  ok(near(frei, 5.6) && P.monsterKegelLaenge(5.6, 0.8, 0.3, 100, 100, Math.PI / 2, null) === 5.6, 'ohne Wand die volle Länge (auch ohne Kartenfunktion)');
  ok(mitWand < frei && mitWand > 1.5 && mitWand < 2.4, 'Wand ab Kachel 5 (x = 160 px): Kegel von 5,6 m auf ' + mitWand.toFixed(2) + ' m gekürzt (Wand 60 px = 1,9 m von der Mitte, minus 0,3 m Lichtschlitz)');
  const dicht = P.monsterKegelLaenge(3.4, 1.8, 0.3, 100, 100, Math.PI / 2, wand(4));
  ok(dicht > 0.4 && dicht < 0.7, 'Wand direkt vor dem Monster (x = 128 px, 0,875 m von der Mitte): nur noch ' + dicht.toFixed(2) + ' m ab dem Lichtschlitz (0,3 m vor der Mitte), unter dem Rumpf');
  const seite = P.monsterKegelLaenge(3.4, 3.0, 0.3, 100, 100, Math.PI / 2, (x, y) => y >= 4);   // Wand rechts/unten neben dem Strahl (y = 128 px)
  ok(seite < 3.4, 'auch die Kanten des breiten Kegels prüfen die Wand (Wand seitlich schneidet die Kegelkante: ' + seite.toFixed(2) + ' m)');
  ok(P.monsterKegelLaenge(0, 1, 0.3, 100, 100, 0, () => false) === 0 && P.monsterStrahl(0, 0, 1, 0, 50, null) === 50 && P.monsterStrahl(16, 16, 1, 0, 200, (tx) => tx >= 3) === 80, 'Länge 0 bleibt 0; Strahl ohne Kartenfunktion = Höchstweite; Strahl endet an der ersten festen Kachel (Schrittweite 4 px)');
  const gedreht = P.monsterKegelLaenge(5.6, 0.8, 0.3, 100, 100, 0, wand(5));   // yaw 0 = nach +y (unten), Wand liegt rechts davon
  ok(near(gedreht, 5.6), 'die Richtung stimmt: Blick nach unten (yaw 0) trifft die Wand rechts nicht');
});

section('Ruck und Funken nur beim Rammen', () => {
  ok(P.SM_RUCK_VOXEL >= 6 && P.SM_RUCK_VOXEL <= 8 && P.SM_RUCK_ZEIT <= 0.15 + 1e-9, 'Ruck 6 bis 8 Voxel in höchstens 0,15 s (' + P.SM_RUCK_VOXEL + ' Voxel, ' + P.SM_RUCK_ZEIT + ' s)');
  let r = 0; for (let i = 0; i < 60; i++) r = P.monsterRuckSchritt(r, false, 1 / 60);
  ok(r === 0, 'ohne Rammen kein Ruck (1 s lang 0)');
  const verlauf = []; r = 0;
  for (let i = 0; i < 90; i++) { r = P.monsterRuckSchritt(r, true, 1 / 60); verlauf.push(r); }
  ok(near(verlauf[8], P.SM_RUCK_VOXEL, 0.8) && verlauf[9] === P.SM_RUCK_VOXEL && verlauf[89] === P.SM_RUCK_VOXEL && verlauf.every((v) => v <= P.SM_RUCK_VOXEL), 'Rammen: in 0,15 s zum vollen Ruck, dann halten (nie darüber), 1,5 s lang');
  ok(verlauf[3] > 0 && verlauf[3] < verlauf[8], 'der Ruck wächst von Bild zu Bild (nach vorn)');
  let z = r; for (let i = 0; i < 30; i++) z = P.monsterRuckSchritt(z, false, 1 / 60);
  ok(z === 0, 'nach dem Rammen zurück auf 0 (in 0,3 s)');
  // zweite Flanke: ein neues Rammen ruckt wieder
  const v2 = []; let q = 0; for (let i = 0; i < 20; i++) { q = P.monsterRuckSchritt(q, true, 1 / 60); } for (let i = 0; i < 30; i++) q = P.monsterRuckSchritt(q, false, 1 / 60); for (let i = 0; i < 5; i++) { q = P.monsterRuckSchritt(q, true, 1 / 60); v2.push(q); }
  ok(q > 0 && q < P.SM_RUCK_VOXEL && v2[0] > 0, 'erneutes Rammen (neue steigende Flanke) ruckt erneut von 0 aus');
  ok(P.monsterRammSeit(0, true, 0.1) === 0.1 && P.monsterRammSeit(0.3, true, 0.1) === 0.4 && P.monsterRammSeit(0.3, false, 0.1) === 0, 'Rammzeit zählt nur während des Rammens');
  ok(P.monsterFunkenAn('rammen') && ZUSTAENDE.filter((x) => x !== 'rammen').every((x) => !P.monsterFunkenAn(x)), 'Funken nur im Zustand Rammen');
  let summe = 0, acc = 0; for (let i = 0; i < 60; i++) { const f = P.monsterFunkenZahl(acc, 1 / 60); acc = f.acc; summe += f.n; }
  let summe30 = 0; acc = 0; for (let i = 0; i < 30; i++) { const f = P.monsterFunkenZahl(acc, 1 / 30); acc = f.acc; summe30 += f.n; }
  ok(summe >= 22 && summe <= 26 && Math.abs(summe - summe30) <= 2 && P.monsterFunkenZahl(0, 1).n <= 3, 'Funkentakt 25 Hz, unabhängig von der Bildrate (60 Bilder/s: ' + summe + ', 30 Bilder/s: ' + summe30 + '), höchstens 3 je Bild');
  const pt = P.monsterFunkenPunkt([10, 0, 20], 0, 1, 0.5, 0.1), pt2 = P.monsterFunkenPunkt([10, 0, 20], Math.PI / 2, 1, 0, 0.1);
  ok(near(pt[2], 21) && near(pt[0], 10.5) && near(pt[1], 0.1) && near(pt2[0], 11) && near(pt2[2], 20), 'Funkenpunkt liegt vor dem Schild in Blickrichtung (yaw 0 = +z, yaw π/2 = +x), quer nach links (+x bei yaw 0)');
});

// ---- Anzeige gegen Attrappen
class V3 { constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; } clone() { return new V3(this.x, this.y, this.z); } }
class O3 {
  constructor(name) { this.name = name; this.children = []; this.parent = null; this.userData = {}; this.visible = true; this.position = new V3(); this.rotation = Object.assign(new V3(), { set(x, y, z, o) { this.x = x; this.y = y; this.z = z; this.order = o; return this; } }); this.scale = Object.assign(new V3(1, 1, 1), { setScalar(s) { this.x = this.y = this.z = s; } }); }
  add(c) { this.children.push(c); c.parent = this; return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parent = null; } return this; }
}
class Farbe { constructor() { this.v = 1; } copy() { this.v = 1; return this; } multiplyScalar(k) { this.v *= k; return this; } }
function welt(opt) {
  opt = opt || {};
  const w = { fx: [], modelle: [], hell: 0 };
  const THREE = { Group: O3, Mesh: class extends O3 { constructor(g, m) { super('mesh'); this.geometry = g; this.material = m; } }, BufferGeometry: class { setAttribute() {} setIndex() {} }, Float32BufferAttribute: class {}, AdditiveBlending: 2, DoubleSide: 2, Vector3: V3, Color: Farbe,
    MeshBasicMaterial: class { constructor(o) { Object.assign(this, o); this.color = new Farbe(); } } };
  const L = { THREE, ctx: { map: opt.solid === undefined ? { solid: () => false } : (opt.solid ? { solid: opt.solid } : null) }, smV: null };
  const window = { VoxelFx: opt.keinFx ? null : { spawnFx: (t, o) => w.fx.push([t, o]) }, Render: opt.render || null };
  const place = (a, x, y) => { a.container.position.set(x / 32, 0, y / 32); return { x: x / 32, z: y / 32 }; };
  const locomote = (a, wx, wz, dt, yaw) => { a.container.rotation.y = yaw; return 0; };
  const yawOf = (dx, dy) => Math.atan2(dx, dy);
  const fn = new Function('L', 'place', 'locomote', 'yawOf', 'window', 'VX', 'D2R', 'performance', REIN + ANZEIGE + '\nreturn { updateStationMonster, monsterRueckfall, monsterFesteKachel };')(L, place, locomote, yawOf, window, 1 / 16, D2R, { now: () => 0 });
  w.fn = fn; w.L = L;
  w.akteur = () => {
    const a = { container: new O3('container'), body: new O3('body'), model: null, speed: 0, labelH: null, setFigure() {}, setModel(id, p, fb) { w.modelle.push([id, p, fb]); if (!a.model) a.model = new O3('quader'); } };
    a.container.worldToLocal = (v) => { const y = a.container.rotation.y, dx = v.x - a.container.position.x, dz = v.z - a.container.position.z; return v.set(Math.cos(y) * dx - Math.sin(y) * dz, v.y, Math.sin(y) * dx + Math.cos(y) * dz); };
    if (opt.echt !== false) {
      const joints = {}, root = new O3('root');
      for (const nm of Object.keys(RIG.joints)) { const o = new O3(nm); o.userData.rest = new V3(); o.position.copy(o.userData.rest); joints[nm] = o; }
      joints.lampe.getWorldPosition = (v) => { const y = a.container.rotation.y; return v.set(a.container.position.x + Math.sin(y) * 0.31, 1.3, a.container.position.z + Math.cos(y) * 0.31); };
      a.fig = { root, joints, poses: opt.posen || POSEN, inner: { s: 1 / 16 } };
    } else { const root = new O3('root'); a.fig = { root, joints: { hips: new O3('hips') }, poses: null, placeholder: true }; }
    return a;
  };
  return w;
}
const mo = (z, r, h, f) => { const o = { x: 640, y: 320, z: z || 'p', f: f == null ? Math.PI / 2 : f }; if (r) o.r = 1; if (h) o.h = 1; return o; };
const ent = (m) => ({ id: 'M1', kind: 'monster', alive: true, vis: true, x: 640, y: 320, mo: m });
const gewuerft = new Set();
function up(w, a, e, dt, t, st) { try { w.fn.updateStationMonster(a, e, dt, t, st); } catch (err) { if (!gewuerft.has(err.message)) { gewuerft.add(err.message); ok(false, 'Anzeige wirft eine Ausnahme: ' + err.message); } } }
function lauf(w, a, m, sek, speed, dt) { dt = dt || 1 / 60; a.speed = speed || 0; for (let i = 0; i < Math.round(sek / dt); i++) up(w, a, ent(m), dt, i * dt); }
const winkel = (a, j) => a.fig.joints[j].rotation, verschub = (a, j) => a.fig.joints[j].position;

section('Anzeige: Pose je Zustand auf den Gelenken', () => {
  let w = welt(), a = w.akteur();
  lauf(w, a, mo('p'), 0.5, 0);
  ok(a.fig.root.visible && !a.model && w.modelle.length === 0 && a.sm.zustand === 'patrouille', 'Patrouille: Figur sichtbar, der alte Quader nicht gezeigt');
  ok(near(winkel(a, 'hipVL').x, 0) && near(verschub(a, 'hull').y, 0) && near(verschub(a, 'footVL').y, 0), 'Patrouille im Stand: Standpose (Hüfte 0°, Füße am Boden)');
  ok(winkel(a, 'hipVL').order === 'YXZ', 'Winkel in der Reihenfolge YXZ wie applyPose des Voxelwerks');
  lauf(w, a, mo('l'), 0.4, 0);
  ok(near(winkel(a, 'horchL').z, -82 * D2R) && near(winkel(a, 'horchR').z, 82 * D2R) && a.sm.zustand === 'laerm', 'Lärm: Horchplatten oben (∓82°)');
  lauf(w, a, mo('s'), 0.4, 0);
  ok(a.sm.zustand === 'laerm' && near(winkel(a, 'horchL').z, -82 * D2R), 'Suche (z s) wie Lärm');
  lauf(w, a, mo('j'), 0.4, 0);
  ok(a.sm.zustand === 'jagd' && near(verschub(a, 'hull').y, -5 / 16, 1e-6) && near(winkel(a, 'horchL').z, 0, 1e-9), 'Jagd: Wanne 5 Voxel tiefer (-0,3125 m), Horchplatten wieder unten');
  lauf(w, a, mo('j', 1), 0.4, 0);
  ok(a.sm.zustand === 'rammen' && near(winkel(a, 'hull').x, 9 * D2R, 1e-9) && near(verschub(a, 'schild').z, 3 / 16, 1e-6) && near(verschub(a, 'schild').y, -2 / 16, 1e-6), 'Rammen: Wanne vorn gekippt (+9°), Schild 3 Voxel ausgefahren, 2 abgesenkt');
  lauf(w, a, mo('j', 1, 1), 0.4, 0);
  ok(a.sm.zustand === 'pause' && near(verschub(a, 'hull').y, -10.5 / 16, 1e-6) && near(winkel(a, 'hipVL').z, -10 * D2R, 1e-9) && near(winkel(a, 'sensor').x, 20 * D2R, 1e-9), 'Pause (auch mit z j und r): Wanne 10,5 Voxel tiefer (fast am Boden), Hüften gespreizt, Sensor nach unten');
  ok(a.fig.joints.lampe.scale.x < 0.01, 'Pause: das Teil lampe (Lichtschlitz und Lichtfeld) ist ausgeblendet (Skalierung ≈ 0)');
  lauf(w, a, mo('p'), 0.4, 0);
  ok(a.fig.joints.lampe.scale.x === 1, 'danach wieder Licht an (Skalierung 1)');
});

section('Anzeige: Zyklus läuft nur in Bewegung, Überblenden', () => {
  let w = welt(), a = w.akteur();
  lauf(w, a, mo('p'), 1, 0);
  const still = []; for (let i = 0; i < 20; i++) { lauf(w, a, mo('p'), 0.05, 0); still.push(winkel(a, 'hipVL').x); }
  ok(still.every((v) => near(v, 0, 1e-9)) && near(a.sm.phi, 0), 'Stillstand: Zyklus ruht (Hüfte 0°, Phase bleibt ' + a.sm.phi + ')');
  const geh = []; for (let i = 0; i < 40; i++) { lauf(w, a, mo('p'), 0.05, 1.5); geh.push(winkel(a, 'hipVL').x / D2R); }
  ok(Math.max(...geh) > 8 && Math.min(...geh) < -8 && Math.max(...geh) <= 11.01, 'Bewegung: Hüfte schwingt (' + Math.min(...geh).toFixed(1) + '° bis ' + Math.max(...geh).toFixed(1) + '°, Amplitude 11°)');
  ok(near(a.sm.phi, 2 * 1.2 + 0, 0.15), 'Phase nach 2 s Bewegung ≈ 2 · 1,2 Hz = 2,4 Perioden (' + a.sm.phi.toFixed(2) + '), zeitbasiert');
  ok(a.sm.gehen === 1 && Math.abs(winkel(a, 'sensor').y) > 0, 'Sensor schwenkt in Bewegung');
  // Wechsel Patrouille (Zyklus läuft) -> Pause: nach 0,075 s Zwischenwerte, nach 0,16 s Zielpose
  w = welt(); a = w.akteur();
  lauf(w, a, mo('p'), 1.1, 1.5);
  const vor = verschub(a, 'hull').y, vorF = verschub(a, 'footVL').y;
  lauf(w, a, mo('p', 0, 1), 0.075, 0);
  const mitte = verschub(a, 'hull').y, mitteH = winkel(a, 'hipVL').z;
  ok(mitte < vor - 0.05 && mitte > -10.5 / 16 + 0.05 && mitteH < 0 && mitteH > -10 * D2R, 'nach 0,075 s: Zwischenwerte (Wanne ' + (mitte * 16).toFixed(1) + ' Voxel auf dem Weg nach -10,5, Hüfte ' + (mitteH / D2R).toFixed(1) + '° auf dem Weg nach -10°)');
  lauf(w, a, mo('p', 0, 1), 0.1, 0);
  ok(near(verschub(a, 'hull').y, -10.5 / 16, 1e-6) && near(winkel(a, 'hipVL').z, -10 * D2R, 1e-9) && near(verschub(a, 'footVL').y, 10.8 / 16, 1e-6), 'nach 0,175 s insgesamt: Zielpose erreicht (unter 0,2 s)');
  // erste Pose ohne Überblenden
  w = welt(); a = w.akteur(); up(w, a, ent(mo('j', 0, 1)), 1 / 60, 0);
  ok(near(verschub(a, 'hull').y, -10.5 / 16, 1e-6), 'erstes Bild: gleich die Zielpose (kein Überblenden aus dem Nichts)');
});

section('Anzeige: Lichtkegel je Zustand', () => {
  const dauer = 0.4;
  const kegel = (m, speed, solid) => { const w = welt({ solid }), a = w.akteur(); lauf(w, a, m, dauer, speed || 0); return { w, a, k: a.smKegel }; };
  const K = P.SM_KEGEL;
  ok(K.patrouille.hell === 0.34 && K.laerm.hell === 0.42 && K.jagd.hell === 0.50 && K.rammen.hell === 0.42, 'Kegel-Helligkeit: Patrouille 0,34 und Lärm 0,42 (MON-02 Nacharbeit N2, vorher 0,30 und 0,36: zart), Jagd 0,50 und Rammen 0,42 unverändert');
  for (const [z, m] of [['patrouille', mo('p')], ['laerm', mo('l')], ['jagd', mo('j')], ['rammen', mo('j', 1)]]) {
    const r = kegel(m, 0, null);
    const bl = z === 'rammen' ? 1 : 1;   // Blitz ist nach 0,4 s vorbei
    ok(r.k && r.k.visible && near(r.k.scale.x, K[z].breite, 1e-9) && near(r.k.scale.z, K[z].laenge, 1e-6) && near(r.k.material.color.v, K[z].hell * bl, 1e-9), z + ': Kegel sichtbar, Breite ' + K[z].breite + ' m, Länge ' + K[z].laenge + ' m, Helligkeit ' + K[z].hell);
  }
  const ps = kegel(mo('j', 1, 1), 0, null);
  ok(ps.k && !ps.k.visible, 'Pause: Kegel aus (nicht sichtbar)');
  const fr = kegel(mo('p'), 0, null).k;
  ok(Math.abs(fr.position.y - 0.03) < 1e-9 && fr.parent && fr.material.blending === 2 && fr.material.depthWrite === false && fr.material.transparent === true && fr.material.toneMapped === false && fr.material.vertexColors === true, 'Kegel: flach über dem Boden (0,03 m), additiv, transparent, ohne Tiefenschreiben, kein SpotLight');
  ok(near(fr.position.z, 0.31, 1e-6) && near(fr.rotation.y, 0, 1e-9), 'Kegel beginnt am Lichtschlitz (Gelenk lampe) und zeigt in Blickrichtung (yaw π/2 -> Kegel-Winkel 0 relativ zum Akteur)');
  // Wand
  const wand = kegel(mo('l', 0, 0, 0), 0, (tx) => tx >= 24);   // Monster bei x = 640 px (Kachel 20), Wand ab Kachel 24 (768 px): 128 px = 4 m
  ok(wand.k.scale.z < K.laerm.laenge - 1 && wand.k.scale.z > 3 && wand.k.visible, 'Lärm-Kegel an einer Wand 4 m vor dem Monster gekürzt auf ' + wand.k.scale.z.toFixed(2) + ' m (statt 5,6)');
  // Code-Review 13a: die Wandkürzung folgt dem Sensorschwenk (yaw + psi), nicht nur dem Blick des Monsters: es blickt nach +z, der Sensor ist um 90° nach +x gedreht, die Wand steht im Osten (2 m)
  const pS = JSON.parse(JSON.stringify(POSEN)); pS.laerm.joints.sensor = [0, 90, 0];
  const schwenk = (posen) => { const w = welt({ solid: (tx) => tx >= 22, posen }), a = w.akteur(); lauf(w, a, mo('l'), dauer, 0); return a.smKegel; };
  const kS = schwenk(pS), kG = schwenk(POSEN);
  ok(near(kS.rotation.y, 90 * D2R, 1e-9) && kS.scale.z > 1.2 && kS.scale.z < 2.3 && near(kG.scale.z, K.laerm.laenge, 1e-6), 'Sensor 90° zur Wand gedreht: der Kegel ist auf ' + kS.scale.z.toFixed(2) + ' m gekürzt (Wand 2 m im Osten); mit geradem Sensor (Blick nach Süden) läuft er ungekürzt (' + kG.scale.z.toFixed(2) + ' m)');
  const dicht = kegel(mo('l', 0, 0, 0), 0, (tx) => tx >= 21);
  ok(dicht.k.scale.z < 0.8 && dicht.k.scale.z > 0.4, 'Wand 1 m vor dem Monster (Kachel 21): der Kegel ist auf ' + dicht.k.scale.z.toFixed(2) + ' m ab dem Lichtschlitz gekürzt, er reicht kaum über den Rumpf');
  const keineKarte = kegel(mo('l'), 0, null);
  ok(near(keineKarte.k.scale.z, K.laerm.laenge, 1e-6), 'ohne Kartenfunktion im Client (map fehlt): volle Länge, kein Absturz (Grenze: dann ragt der Kegel durch Wände)');
  // Türen nach Zustand: Render.buehneSolid (Snapshot) statt der statischen Karte
  const wT = welt({ solid: () => true, render: { isBuehne: () => true, buehneSolid: (map, st) => (tx) => (tx >= 24 && st && st.zu) } }), aT = wT.akteur();
  up(wT, aT, ent(mo('l', 0, 0, 0)), 1 / 60, 0, { zu: false });
  ok(wT.fn.monsterFesteKachel({ zu: false })(30, 0) === false && wT.fn.monsterFesteKachel({ zu: true })(30, 0) === true, 'Kachelfunktion folgt dem Zustand im Snapshot (Render.buehneSolid), nicht der statischen Karte');
  ok(near(aT.smKegel.scale.z, K.laerm.laenge, 1e-6) , 'offene Tür (Snapshot): der Kegel läuft hindurch, obwohl die statische Karte dort „fest“ sagt');
  const wT2 = welt({ solid: () => false, render: { isBuehne: () => true, buehneSolid: (map, st) => (tx) => (tx >= 24 && st && st.zu) } }), aT2 = wT2.akteur();
  for (let i = 0; i < 30; i++) up(wT2, aT2, ent(mo('l', 0, 0, 0)), 1 / 60, i / 60, { zu: true });
  ok(aT2.smKegel.scale.z < K.laerm.laenge - 1, 'geschlossene Tür (Snapshot): der Kegel endet an ihr (' + aT2.smKegel.scale.z.toFixed(2) + ' m)');
  // Zustandswechsel: Kegel wird weich
  const w = welt(), a = w.akteur(); lauf(w, a, mo('l'), 0.5, 0); lauf(w, a, mo('j'), 0.075, 0);
  ok(a.smKegel.scale.z < K.laerm.laenge && a.smKegel.scale.z > K.jagd.laenge && a.smKegel.scale.x > K.laerm.breite && a.smKegel.scale.x < K.jagd.breite, 'Lärm -> Jagd: nach 0,075 s Zwischenwerte (Länge ' + a.smKegel.scale.z.toFixed(2) + ', Breite ' + a.smKegel.scale.x.toFixed(2) + ')');
  // Rammen: kurz heller
  const w2 = welt(), a2 = w2.akteur(); lauf(w2, a2, mo('j'), 0.4, 0); lauf(w2, a2, mo('j', 1), 0.05, 0);
  const hell0 = a2.smKegel.material.color.v; lauf(w2, a2, mo('j', 1), 0.5, 0);
  ok(hell0 > K.rammen.hell * 1.2 && near(a2.smKegel.material.color.v, K.rammen.hell, 1e-9), 'Rammen: der Kegel ist am Anfang heller (' + hell0.toFixed(2) + ') und fällt auf ' + K.rammen.hell);
  // Sensorschwenk dreht den Kegel
  const w3 = welt(), a3 = w3.akteur(); let minPsi = 9, maxPsi = -9;
  for (let i = 0; i < 160; i++) { lauf(w3, a3, mo('p'), 1 / 20, 1.5, 1 / 60); const psi = a3.smKegel.rotation.y; minPsi = Math.min(minPsi, psi); maxPsi = Math.max(maxPsi, psi); }
  ok(maxPsi > 20 * D2R && minPsi < -20 * D2R && maxPsi <= 28.01 * D2R, 'Patrouille: der Kegel schwenkt mit dem Sensor (' + (minPsi / D2R).toFixed(0) + '° bis ' + (maxPsi / D2R).toFixed(0) + '°, Sensor ±28°)');
});

section('Anzeige: Ruck und Funken', () => {
  const dt = 1 / 60;
  const lauf2 = (folge) => { const w = welt(), a = w.akteur(); const rz = []; let t = 0; for (const [m, sek] of folge) for (let i = 0; i < Math.round(sek / dt); i++, t += dt) { up(w, a, ent(m), dt, t); rz.push(a.body.position.z * 16); } return { w, a, rz }; };
  let r = lauf2([[mo('p'), 1], [mo('j'), 1], [mo('l'), 1]]);
  ok(r.rz.every((v) => v === 0) && r.w.fx.length === 0, 'ohne Rammen: Wurzel steht (kein Ruck), keine Funken');
  r = lauf2([[mo('j'), 0.3], [mo('j', 1), 1.2], [mo('j'), 0.6]]);
  const i0 = Math.round(0.3 / dt);
  ok(r.rz[i0 - 1] === 0 && r.rz[i0 + 3] > 2 && near(r.rz[i0 + 10], 7, 1e-9) && near(r.rz[i0 + 60], 7, 1e-9) && near(r.rz[i0 + 71], 7, 1e-9), 'Rammen: Ruck um 7 Voxel nach vorn in 0,15 s (Bild 4: ' + r.rz[i0 + 3].toFixed(1) + ' Voxel), dann gehalten bis zum Ende des Rammens');
  ok(near(r.rz[r.rz.length - 1], 0, 1e-9) && r.rz[i0 + 72 + 3] < 7, 'danach läuft die Wurzel zurück auf 0');
  const fu = r.w.fx.filter((f) => f[0] === 'sparks');
  ok(fu.length >= 26 && fu.length <= 32 && fu.every((f) => f[1].pos.length === 3 && f[1].pos[1] > 0 && f[1].pos[1] < 0.3), 'Funken nur beim Rammen: ' + fu.length + ' Schauer in 1,2 s (25 Hz), am Boden vor dem Schild');
  ok(fu.every((f) => f[1].n === 5 && f[1].s0 && f[1].s0[0] === 0.05 && f[1].s0[1] === 0.08), 'Funken: je Schauer 5 Stück mit der Größe 0,05 bis 0,08 m (1,6 bis 2,6 px; vorher 3 Stück mit 0,03 bis 0,05 m = 1 bis 1,6 px, kaum zu sehen)');
  const fxq = read('public/js/voxel/fx.js');
  ok(/case 'sparks': FX\.sparks\(p, o\.n \|\| 10, \{ c0: o\.color, s0: o\.s0 \}\)/.test(fxq) && /s0: o\.s0 \? rnd\(o\.s0\[0\], o\.s0\[1\]\) : rnd\(0\.03, 0\.05\)/.test(fxq), 'fx.js: spawnFx(\'sparks\') reicht s0 [min, max] an FX.sparks, ohne s0 bleibt die Größe 0,03 bis 0,05 (bestehende Aufrufer unverändert)');
  ok(fu.every((f) => f[1].pos[2] > 10 + 0.5 * 0 && near(f[1].pos[0], 20, 0.6)), 'Funken liegen vor dem Schild (Blick +z): vor der Mitte (z 10) und ±0,5 m quer (x 20)');
  const p1 = lauf2([[mo('j', 1, 1), 1]]);
  ok(p1.w.fx.length === 0 && p1.rz.every((v) => v === 0), 'Pause hat Vorrang: kein Ruck, keine Funken, auch wenn r gesetzt ist');
  const k0 = lauf2([[mo('p'), 1], [mo('l'), 1], [mo('j'), 1], [mo('p', 0, 1), 1]]);
  ok(k0.w.fx.length === 0, 'Patrouille, Lärm, Jagd und Pause: keine Funken');
  const kf = lauf2([[mo('j', 1), 1]]); const kn = welt({ keinFx: true }); const an = kn.akteur();
  let fehler = null; try { for (let i = 0; i < 30; i++) up(kn, an, ent(mo('j', 1)), dt, i * dt); } catch (e) { fehler = e; }
  ok(kf.w.fx.length > 0 && fehler === null, 'ohne Effektsystem (window.VoxelFx fehlt) kein Absturz');
  const z2 = lauf2([[mo('j', 1), 0.5], [mo('j'), 0.1], [mo('j', 1), 0.1]]);
  let sprung = 0; for (let i = 1; i < z2.rz.length; i++) sprung = Math.max(sprung, Math.abs(z2.rz[i] - z2.rz[i - 1]));
  ok(sprung <= 7 / 0.15 / 60 + 1e-9 && Math.min(...z2.rz.slice(Math.round(0.5 / dt))) > 3, 'neue Rammflanke: der Ruck setzt von dem Wert auf, auf den die Wurzel zurückgelaufen ist (größter Sprung ' + sprung.toFixed(2) + ' Voxel je Bild, nie ein Sprung)');
});

section('Rückfall ohne Asset: alter Quader, 2D unberührt', () => {
  let w = welt({ echt: false }), a = w.akteur();
  lauf(w, a, mo('j'), 0.3, 1);
  ok(w.modelle.length > 0 && w.modelle.every((m) => m[0] === 'lerche/actor/monster' && m[2] === 'monster') && w.modelle[0][1].jagd === 1, 'Figur nicht echt (Asset fehlt oder baut noch): der alte Quader lerche/actor/monster mit jagd 1 wird gezeigt');
  ok(a.model.visible === true && a.fig.root.visible === false && !a.smKegel && a.labelH === 2.6 && w.fx.length === 0, 'Quader sichtbar, Ersatzfigur ausgeblendet, kein Kegel, keine Funken, Namenshöhe wie früher (2,6 m)');
  w = welt({ echt: false }); a = w.akteur(); lauf(w, a, mo('p', 1), 0.3, 0);
  ok(w.modelle[0][1].jagd === 0 && w.fx.length === 0, 'Rückfall: jagd nur bei z j (wie vor O3b), auch beim Rammen keine Funken');
  // Figur fehlt einzelne Posen
  const posen = JSON.parse(JSON.stringify(POSEN)); delete posen.rammen;
  w = welt({ posen }); a = w.akteur(); lauf(w, a, mo('p'), 0.2, 0);
  ok(w.modelle.length > 0 && !P.monsterFigurEcht(a.fig), 'fehlt eine der fünf Posen: Rückfall (monsterFigurEcht = false)');
  w = welt(); a = w.akteur(); lauf(w, a, mo('p'), 0.2, 0);
  ok(P.monsterFigurEcht(a.fig) && !P.monsterFigurEcht(null) && !P.monsterFigurEcht({}) && !P.monsterFigurEcht({ joints: { sensor: {} }, poses: POSEN }), 'monsterFigurEcht: Figur mit Sensor, Lampe und allen fünf Posen; sonst nicht');
  // Wechsel echt -> Rückfall am selben Akteur blendet den Kegel aus
  w = welt(); a = w.akteur(); a.model = new O3('quader-vorher'); lauf(w, a, mo('p'), 0.3, 0); const k = a.smKegel;
  ok(a.model.visible === false && a.fig.root.visible === true, 'mit geladener Figur: ein vorhandener Quader ist ausgeblendet, die Figur sichtbar');
  a.fig.joints.lampe = undefined; lauf(w, a, mo('p'), 0.1, 0);
  ok(k.visible === false && a.model.visible === true && a.fig.root.visible === false, 'echt -> Rückfall am selben Akteur: Kegel aus, Figur aus, Quader wieder sichtbar');
  ok(a.labelH === 2.6, 'Namenshöhe im Rückfall 2,6 m');
  w = welt(); a = w.akteur(); lauf(w, a, mo('p'), 0.3, 0);
  ok(a.labelH === 1.75, 'Namenshöhe mit Modell 1,75 m (Modell 1,5 m hoch)');
});

section('Snapshot mo unverändert, kein Zugriff auf den Serverzustand', () => {
  const Monster = require('../server/sim/monster.js');
  const snap = (M) => Monster.snap({ away: { monster: M } });
  const M0 = { x: 100.04, y: 200.06, z: 'jagd', facing: 1.23456, ramm: null, pause: 0 };
  ok(JSON.stringify(snap(M0)) === JSON.stringify({ x: 100, y: 200.1, z: 'j', f: 1.23 }), 'Snapshot Jagd: {x, y, z "j", f} (Rundung 0,1 und 0,01)');
  ok(JSON.stringify(snap(Object.assign({}, M0, { z: 'patrouille', ramm: { kid: 'a', t: 1 } }))) === JSON.stringify({ x: 100, y: 200.1, z: 'p', f: 1.23, r: 1 }), 'Snapshot Rammen: zusätzlich r 1');
  ok(JSON.stringify(snap(Object.assign({}, M0, { z: 'laerm', pause: 0.5 }))) === JSON.stringify({ x: 100, y: 200.1, z: 'l', f: 1.23, h: 1 }), 'Snapshot Pause: zusätzlich h 1');
  ok(JSON.stringify(snap(Object.assign({}, M0, { z: 'suche', ramm: { kid: 'a', t: 1 }, pause: 1 }))) === JSON.stringify({ x: 100, y: 200.1, z: 's', f: 1.23, r: 1, h: 1 }), 'Snapshot Suche + r + h: {x, y, z "s", f, r, h}');
  ok(snap(null) === null || Monster.snap({ away: {} }) === null, 'ohne Monster: null');
  const sv = read('server/sim/monster.js');
  ok(/const o = \{ x: r1\(M\.x\), y: r1\(M\.y\), z: Z\[M\.z\] \|\| 'p', f: Math\.round\(M\.facing \* 100\) \/ 100 \};\n  if \(M\.ramm\) o\.r = 1;\n  if \(M\.pause > 0\) o\.h = 1;\n  return o;/.test(sv) && /const Z = \{ patrouille: 'p', laerm: 'l', suche: 's', jagd: 'j' \};/.test(sv), 'server/sim/monster.js: snap und Zustandskürzel im Quelltext unverändert');
  ok(/const HB = \{ w: 28, h: 28 \};/.test(sv), 'server/sim/monster.js: Kollisionsbox HB 28 × 28 px unverändert');
  const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const kern = strip(REIN + '\n' + ANZEIGE);
  ok(!/\bgame\b|\bsrv\b|require\(|aw\.monster|server\/|\bMonster\b|\bMon\.|\.monster\b/.test(kern), 'Schottbrecher-Code (ohne Kommentare) greift nicht auf Serverzustand zu (kein game, require, away.monster)');
  ok(!/\bmo\.[a-z]+\s*=[^=]/.test(kern) && !/\be\.[a-z]+\s*=[^=]/.test(kern) && !/\bM\.[a-z]+\s*=[^=]/.test(kern), 'der Client schreibt nie in mo, den Gegner e oder ein Server-Monster M');
  ok(/if \(kind === 'monster'\) \{ updateStationMonster\(a, e, dt, t, st\); return; \}/.test(ac), 'updateEnemy ruft updateStationMonster für kind monster');
  ok(/else if \(kind === 'monster'\) \{   \/\/ SL7c/.test(ac) && /function fallbackModel/.test(ac), 'fallbackModel(\'monster\') bleibt als Rückfall');
  const rd = read('public/js/render.js');
  ok(/function drawMonster/.test(rd) && !/schottbrecher|Schottbrecher/.test(rd), '2D (render.js drawMonster) unberührt: das Oval bleibt der Ersatz');
  ok(!/schottbrecher/i.test(sv) && !/Schottbrecher/.test(read('server/game.js')), 'Server kennt den Schottbrecher nicht (reine Client-Darstellung, keine Protokolländerung)');
});

section('Freigabe: Actor.dispose gibt den Kegel frei (Code-Review 13b)', () => {
  const m = /\n  dispose\(\) (\{[^\n]*\})\n/.exec(ac);
  ok(!!m, 'dispose() der Klasse Actor im Quelltext gefunden');
  const dispose = new Function('return function dispose() ' + m[1])();
  const w = welt(), a = w.akteur(); lauf(w, a, mo('l'), 0.3, 0);
  const z = { geo: 0, mat: 0, rem: 0 }, k = a.smKegel;
  a.container.parent = { remove() { z.rem++; } };
  k.geometry.dispose = () => { z.geo++; }; k.material.dispose = () => { z.mat++; };
  dispose.call(a);
  ok(!!k && z.geo === 1 && z.mat === 1 && z.rem === 1, 'ein Akteur mit Kegel: dispose gibt Geometrie (' + z.geo + ') und Material (' + z.mat + ') des Kegels frei und hängt den Container ab (' + z.rem + ')');
  const b = { container: { parent: { remove() {} } }, fig: null };
  let wurf = null; try { dispose.call(b); } catch (e) { wurf = e; }
  ok(wurf === null, 'ein Akteur ohne Kegel (kein Schottbrecher): dispose wirft nicht');
});

section('Manifest und Asset-Sync', () => {
  const man = JSON.parse(read('assets/manifest/mon02-station.json'));
  const ids = new Set(man.assets.map((x) => x.id));
  const teile = ['hull', 'sensor', 'lampe', 'horch', 'schild', 'hip', 'knee', 'foot'];
  ok(ids.has('station/schottbrecher') && teile.every((t) => ids.has('station/schottbrecher/' + t)) && man.assets.length === 9, 'Manifest mon02-station.json: Figur station/schottbrecher und die 8 Teilmodelle');
  ok(man.assets.find((x) => x.id === 'station/schottbrecher').kind === 'figure' && man.assets.find((x) => x.id === 'station/schottbrecher').footprint.join() === '2,2' && P.SM_FIGUR === 'station/schottbrecher', 'Figur 2 × 2 Kacheln, der Client lädt dieselbe ID');
  const idx = JSON.parse(read('public/voxel/index.json'));
  ok((idx.figures || []).includes('station/schottbrecher') && teile.every((t) => (idx.models || []).includes('station/schottbrecher/' + t)) && (idx.rigs || []).includes('schottbrecher') && (idx.poses || []).includes('schottbrecher') && (idx.palettes || []).includes('schottbrecher'), 'public/voxel enthält Figur, Teilmodelle, Rig, Posen und Palette schottbrecher (npm run assets gelaufen)');
  const fig = JSON.parse(read('public/voxel/assets/figures/station/schottbrecher.json'));
  ok(Object.values(fig.parts).every((p) => ids.has(p.model)) && fig.rig === 'schottbrecher', 'jedes Teil der Figur steht im Manifest');
  ok(RIG.lichtquelle && RIG.lichtquelle.gelenk === 'lampe' && RIG.joints.lampe && RIG.joints.sensor, 'Rig: Lichtquelle am Gelenk lampe, Sensorgelenk vorhanden');
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
