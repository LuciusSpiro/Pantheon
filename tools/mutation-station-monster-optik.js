'use strict';
// MON-02 O3b: Mutationsprobe zur Optik des Station-Monsters (tools/test-station-monster-optik.js).
// Kopiert Server, Shared, Content, public/js, die Schottbrecher-Assets und die Manifeste in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Stelle und verlangt,
// dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt. Gleichwertige Mutationen stehen mit Begründung und müssen überleben.
//   node tools/mutation-station-monster-optik.js [begriff …] [--trocken]      (npm run test:station-monster-optik-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-smopt-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content', 'assets/manifest', 'public/js']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
for (const rel of ['public/voxel/index.json', 'public/voxel/assets/poses/schottbrecher.json', 'public/voxel/assets/rigs/schottbrecher.json', 'public/voxel/assets/figures/station/schottbrecher.json']) {
  fs.mkdirSync(path.dirname(path.join(TMP, rel)), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
}
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const T1 = 'tools/test-station-monster-optik.js';
for (const rel of [T1, 'package.json']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const AC = 'public/js/voxel/actors.js', FX = 'public/js/voxel/fx.js', MA = 'assets/manifest/mon02-station.json';
const RUCK = '  return rammt ? Math.min(SM_RUCK_VOXEL, ruck + SM_RUCK_VOXEL / SM_RUCK_ZEIT * dt) : Math.max(0, ruck - SM_RUCK_VOXEL / SM_RUCK_ZURUECK * dt);';
const FUNKEN = "function monsterFunkenAn(zustand) { return zustand === 'rammen'; }";
const ZYKLUS = 'const s = Math.sin(2 * Math.PI * phi * (c.k || 1) + (c.p || 0) * Math.PI / 180)';
const WECHSEL = '  if (S.zustand !== zustand) { S.von = S.gezeigt; S.kegelVon = S.kegelGezeigt; S.seit = 0; S.zustand = zustand; }';
const GLAETTEN = 'function monsterKegelGlaetten(cur, ziel, dt) { const d = SM_KEGEL_TEMPO * dt; return cur == null ? ziel : ziel > cur ? Math.min(ziel, cur + d) : Math.max(ziel, cur - d); }';
const KEGELZEILE = '  return Math.max(0, best / SM_TILE - vorlauf);';
const FUNKENPUNKT = '  return [pos[0] + Math.cos(yaw) * quer + Math.sin(yaw) * vor, pos[1] + hoch, pos[2] - Math.sin(yaw) * quer + Math.cos(yaw) * vor];';
const BLEND = 'function monsterBlendFaktor(seit) { return seit >= SM_BLEND ? 1 : seit <= 0 ? 0 : seit / SM_BLEND; }';
const LAMPE = "function monsterLampeAn(zustand) { return zustand !== 'pause'; }";
const ECHT = 'return !!(f && f.joints && f.joints.sensor && f.joints.lampe && f.poses && SM_ZUSTAENDE.every((z) => f.poses[z]));';
const BLICK = '  const f = +(mo && mo.f) || 0;\n  locomote(a, pos.x, pos.z, dt, yawOf(Math.cos(f), Math.sin(f)), false);';
const RUECKFALL = '  if (a.fig && a.fig.root) a.fig.root.visible = false;\n  if (a.smKegel) a.smKegel.visible = false;';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Tests, gleichwertig (Begründung) oder fehlt]
const MUTATIONEN = [
  // ---- Zustandsabbildung
  [AC, "  if (mo.h) return 'pause';\n  if (mo.r) return 'rammen';", "  if (mo.r) return 'rammen';\n  if (mo.h) return 'pause';", 'Vorrang: Rammen vor Pause', [T1]],
  [AC, "  if (mo.r) return 'rammen';\n  if (mo.z === 'j') return 'jagd';", "  if (mo.z === 'j') return 'jagd';\n  if (mo.r) return 'rammen';", 'Vorrang: Jagd vor Rammen', [T1]],
  [AC, "  if (mo.h) return 'pause';\n  if (mo.r) return 'rammen';\n  if (mo.z === 'j') return 'jagd';", "  if (mo.z === 'j') return 'jagd';\n  if (mo.h) return 'pause';\n  if (mo.r) return 'rammen';", 'Vorrang: Jagd vor Pause und Rammen', [T1]],
  [AC, "if (mo.z === 'l' || mo.z === 's') return 'laerm';", "if (mo.z === 'l') return 'laerm';", 'Suche (z s) zeigt Patrouille statt Lärm', [T1]],
  [AC, "if (mo.z === 'l' || mo.z === 's') return 'laerm';", "if (mo.z === 's') return 'laerm';", 'Lärm (z l) zeigt Patrouille', [T1]],
  [AC, "  if (!mo) return 'patrouille';\n", '', 'ohne mo stürzt die Zustandsabbildung ab', [T1]],
  // ---- Pose-Werte, Zyklus
  [AC, ZYKLUS, 'const s = Math.sin(2 * Math.PI * phi + (c.p || 0) * Math.PI / 180)', 'Zyklus ignoriert k (Sensorschwenk mit voller statt halber Frequenz)', [T1]],
  [AC, ZYKLUS, 'const s = Math.sin(2 * Math.PI * phi * (c.k || 1) + (c.p || 0))', 'Zyklus: Phasenversatz p in Radiant statt Grad (Beinpaare nicht gegenphasig)', [T1]],
  [AC, 'out[art][j] = [0, 1, 2].map((i) => b[i] + (C[i] + A[i] * s - b[i]) * w);', 'out[art][j] = [0, 1, 2].map((i) => b[i] + (C[i] - b[i]) * w);', 'Zyklus ohne Amplitude (a·sin fehlt)', [T1]],
  [AC, 'out[art][j] = [0, 1, 2].map((i) => b[i] + (C[i] + A[i] * s - b[i]) * w);', 'out[art][j] = [0, 1, 2].map((i) => C[i] + A[i] * s);', 'Zyklus ohne Gewicht (läuft auch im Stillstand voll)', [T1]],
  [AC, "    for (const art of ['joints', 'shift']) {\n      for (const [j, c] of Object.entries(cyc[art] || {})) {", "    for (const art of ['joints']) {\n      for (const [j, c] of Object.entries(cyc[art] || {})) {", 'Zyklus-shift (Teleskopfüße) wird nicht ausgewertet', [T1]],
  [AC, '  for (const [j, r] of Object.entries(p.shift || {})) out.shift[j] = [r[0], r[1], r[2]];\n', '', 'Pose-shift (Wanne tiefer, Schild aus) wird nicht gelesen', [T1]],
  [AC, 'function monsterBewegt(speed) { return speed > SM_BEWEGT; }', 'function monsterBewegt(speed) { return true; }', 'Zyklus läuft auch im Stand (bewegt immer wahr)', [T1]],
  [AC, 'function monsterBewegt(speed) { return speed > SM_BEWEGT; }', 'function monsterBewegt(speed) { return speed > 3; }', 'Bewegt erst ab 3 m/s (Patrouille ginge ohne Schritt)', [T1]],
  [AC, 'function monsterPhase(phi, hz, dt, bewegt) { return bewegt ? (phi + hz * dt) % 1024 : phi; }', 'function monsterPhase(phi, hz, dt, bewegt) { return (phi + hz * dt) % 1024; }', 'Phase läuft auch im Stand weiter', [T1]],
  [AC, 'function monsterPhase(phi, hz, dt, bewegt) { return bewegt ? (phi + hz * dt) % 1024 : phi; }', 'function monsterPhase(phi, hz, dt, bewegt) { return bewegt ? (phi + dt) % 1024 : phi; }', 'Phase ohne hz der Pose (feste 1 Hz)', [T1]],
  [AC, 'function monsterGehenGewicht(g, bewegt, dt) { const z = bewegt ? 1 : 0, d = dt / SM_BLEND;', 'function monsterGehenGewicht(g, bewegt, dt) { const z = 1, d = dt / SM_BLEND;', 'Gehen-Gewicht immer 1 (Hüften schwingen im Stand)', [T1]],
  [AC, '  S.gezeigt = monsterBlend(S.von, monsterPoseWerte(a.fig.poses, zustand, S.phi, S.gehen), s);', '  S.gezeigt = monsterBlend(S.von, monsterPoseWerte(a.fig.poses, zustand, S.phi, 1), s);', 'Anzeige nutzt Zyklus-Gewicht 1 (läuft im Stand)', [T1]],
  // ---- Überblenden
  [AC, BLEND, 'function monsterBlendFaktor(seit) { return 1; }', 'Überblenden fehlt (Posen springen)', [T1]],
  [AC, 'const SM_BLEND = 0.15;', 'const SM_BLEND = 0.4;', 'Überblenden zu langsam (0,4 s)', [T1]],
  [AC, 'const SM_BLEND = 0.15;', 'const SM_BLEND = 0.001;', 'Überblenden praktisch sofort', [T1]],
  [AC, BLEND, 'function monsterBlendFaktor(seit) { return seit >= SM_BLEND ? 1 : seit <= 0 ? 0 : (seit / SM_BLEND) * (seit / SM_BLEND); }', 'Überblenden quadratisch statt linear', [T1]],
  [AC, 'a[2] + (b[2] - a[2]) * s];\n    }\n  }\n  return out;\n}\n/** Fortschritt', 'a[2]];\n    }\n  }\n  return out;\n}\n/** Fortschritt', 'Blend lässt die z-Achse aus', [T1]],
  [AC, "for (const art of ['joints', 'shift']) {\n    for (const j of new Set(", "for (const art of ['joints']) {\n    for (const j of new Set(", 'Blend überblendet shift nicht (Wanne und Schild springen)', [T1]],
  [AC, WECHSEL, '  if (S.zustand !== zustand) { S.von = null; S.kegelVon = null; S.seit = 0; S.zustand = zustand; }', 'Wechsel ohne Ausgangspose (springt)', [T1]],
  [AC, WECHSEL, '  if (S.zustand !== zustand) { S.von = S.gezeigt; S.kegelVon = S.kegelGezeigt; S.zustand = zustand; }', 'Wechsel setzt die Zeit nicht zurück', [T1]],
  [AC, WECHSEL, '  if (S.zustand !== zustand) { S.von = S.gezeigt; S.seit = 0; S.zustand = zustand; }', 'Kegel wird beim Wechsel nicht überblendet', [T1]],
  // ---- Lampe, Rückfall
  [AC, LAMPE, 'function monsterLampeAn(zustand) { return true; }', 'Lampe in der Pause nicht ausgeblendet', [T1]],
  [AC, LAMPE, "function monsterLampeAn(zustand) { return zustand === 'jagd'; }", 'Lampe nur in der Jagd an', [T1]],
  [AC, 'if (sh) { o.position.x += sh[0] * s; o.position.y += sh[1] * s; o.position.z += sh[2] * s; }', 'if (sh) { o.position.x += sh[0]; o.position.y += sh[1]; o.position.z += sh[2]; }', 'shift ohne Voxelgröße (Voxel statt Meter)', [T1]],
  [AC, "o.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ');", "o.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'XYZ');", 'Winkelreihenfolge XYZ statt YXZ', [T1]],
  [AC, "o.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ');", "o.rotation.set(r[0], r[1], r[2], 'YXZ');", 'Winkel in Grad statt Bogenmaß', [T1]],
  [AC, '  if (!monsterFigurEcht(a.fig)) { monsterRueckfall(a, mo, t); return; }\n', '', 'Rückfall fehlt (ohne Asset kein Quader)', [T1]],
  [AC, ECHT, 'return !!(f && f.joints && f.joints.sensor && f.joints.lampe && f.poses);', 'Echt-Prüfung verlangt die fünf Posen nicht', [T1]],
  [AC, ECHT, 'return !!(f && f.joints && f.poses && SM_ZUSTAENDE.every((z) => f.poses[z]));', 'Echt-Prüfung kennt das Rig nicht (die Ersatzfigur gälte als echt)', [T1]],
  [AC, RUECKFALL, '  if (a.smKegel) a.smKegel.visible = false;', 'Rückfall blendet die Ersatzfigur nicht aus', [T1]],
  [AC, RUECKFALL, '  if (a.fig && a.fig.root) a.fig.root.visible = false;', 'Rückfall lässt den Kegel stehen', [T1]],
  [AC, '  if (a.model) a.model.visible = true;\n  a.labelH = 2.6;', '  a.labelH = 2.6;', 'Rückfall zeigt den Quader nicht wieder', [T1]],
  [AC, '  a.fig.root.visible = true;\n  if (a.model) a.model.visible = false;', '  a.fig.root.visible = true;', 'mit Figur bleibt der Quader sichtbar', [T1]],
  [AC, '  a.labelH = 1.75;\n}', '}', 'Namenshöhe nicht dem kleineren Modell angepasst', [T1]],
  [AC, "a.setModel('lerche/actor/monster', { jagd: z === 'j' ? 1 : 0 }, 'monster');", "a.setModel('lerche/actor/monster', { jagd: 1 }, 'monster');", 'Rückfall-Quader immer im Jagdzustand', [T1]],
  [AC, "if (kind === 'monster') { updateStationMonster(a, e, dt, t, st); return; }", "if (kind === 'monster') { monsterRueckfall(a, e.mo, t); return; }", 'updateEnemy nutzt nur noch den Quader', [T1]],
  // ---- Kegel
  [AC, '  pause: { laenge: 0, breite: 0, hell: 0 },', '  pause: { laenge: 2, breite: 1, hell: 0.3 },', 'Kegel in der Pause an', [T1]],
  [AC, '  jagd: { laenge: 2.4, breite: 3.0, hell: 0.50 },', '  jagd: { laenge: 6.4, breite: 3.0, hell: 0.50 },', 'Jagd-Kegel lang statt kurz', [T1]],
  [AC, '  laerm: { laenge: 5.6, breite: 0.8, hell: 0.42 },', '  laerm: { laenge: 5.6, breite: 2.8, hell: 0.42 },', 'Lärm-Kegel breit statt schmal', [T1]],
  [AC, '  rammen: { laenge: 1.3, breite: 1.6, hell: 0.42 },', '  rammen: { laenge: 4.3, breite: 1.6, hell: 0.42 },', 'Ramm-Kegel nicht gestaucht', [T1]],
  [AC, '  patrouille: { laenge: 3.4, breite: 1.8, hell: 0.34 },', '  patrouille: { laenge: 3.4, breite: 1.8, hell: 0.80 },', 'Patrouille-Kegel viel zu hell', [T1]],
  [AC, KEGELZEILE, '  return laenge;', 'Kegel wird nicht an Wänden gekürzt', [T1]],
  [AC, KEGELZEILE, '  return Math.max(0, best / SM_TILE);', 'Kegelkürzung rechnet den Abstand des Lichtschlitzes nicht ab', [T1]],
  [AC, '  for (const w of a > 0 ? [0, -a, a] : [0]) {', '  for (const w of [0]) {', 'Kegel prüft nur den Mittelstrahl, nicht die Kanten', [T1]],
  [AC, 'const d = monsterStrahl(x, y, Math.sin(yaw + w), Math.cos(yaw + w), maxPx / Math.cos(w), solid);', 'const d = monsterStrahl(x, y, Math.cos(yaw + w), Math.sin(yaw + w), maxPx / Math.cos(w), solid);', 'Kegel-Strahl in vertauschter Richtung (x und y)', [T1]],
  [AC, GLAETTEN, 'function monsterKegelGlaetten(cur, ziel, dt) { return ziel; }', 'Glättungsfunktion macht nichts', [T1]],
  [AC, '  const laenge = S.kegelLaenge = monsterKegelGlaetten(S.kegelLaenge, ziel0, dt);', '  const laenge = S.kegelLaenge = ziel0;', 'Anzeige nutzt die Glättung der Kegellänge nicht', [T1], 'gleichwertig für den Test: die Kegellänge der Attrappen ändert sich je Zustand nur über das Überblenden; die Glättung (12 m/s) wirkt erst bei Sprüngen durch Wände, geprüft in der reinen Funktion und im Browser (Spur beim Gehen)'],
  [AC, 'if (R && R.isBuehne && R.buehneSolid && R.isBuehne(m))', 'if (false)', 'Türen im Kegel nach statischer Karte statt Snapshot', [T1]],
  [AC, "function monsterKegelBlitz(zustand, seit) { return zustand === 'rammen' && seit < 0.25 ?", 'function monsterKegelBlitz(zustand, seit) { return false && seit < 0.25 ?', 'Rammen ohne Aufblitzen des Kegels', [T1]],
  [AC, "function monsterKegelBlitz(zustand, seit) { return zustand === 'rammen' && seit < 0.25 ?", 'function monsterKegelBlitz(zustand, seit) { return seit < 0.25 ?', 'Aufblitzen des Kegels auch außerhalb des Rammens', [T1]],
  [AC, '  S.rammSeit = monsterRammSeit(S.rammSeit, rammt, dt);', '  S.rammSeit = 99;', 'Ramm-Zeit steht (Aufblitzen des Kegels fehlt in der Anzeige)', [T1]],
  [AC, 'k.rotation.y = psi;', 'k.rotation.y = 0;', 'Kegel dreht nicht mit dem Sensor', [T1]],
  [AC, 'k.position.set(lx, 0.03, lz);', 'k.position.set(lx, 0.03, 0);', 'Kegel beginnt nicht am Lichtschlitz (z)', [T1]],
  [AC, 'k.position.set(lx, 0.03, lz);', 'k.position.set(lx, 1.3, lz);', 'Kegel schwebt auf Lampenhöhe statt auf dem Boden', [T1]],
  [AC, 'k.scale.set(kg.breite, 1, laenge);', 'k.scale.set(kg.laenge, 1, laenge);', 'Kegelbreite aus der Länge statt der Breite', [T1]],
  [AC, 'blending: T.AdditiveBlending,', 'blending: T.NormalBlending,', 'Kegel nicht additiv', [T1]],
  [AC, 'transparent: true, depthWrite: false,', 'transparent: true, depthWrite: true,', 'Kegel schreibt Tiefe', [T1]],
  [AC, '  if (hell < 0.01 || kg.laenge < 0.05) { k.visible = false;', '  if (hell < 0.01 || kg.laenge < 0.05) { k.visible = true;', 'Kegel bleibt bei hell 0 sichtbar', [T1]],
  [AC, '  k.visible = laenge > 0.05;\n', '  k.visible = true;\n', 'Kegel bleibt trotz Wand direkt davor sichtbar', [T1], 'gleichwertig: mit Länge 0 ist die Fläche zusammengefallen (scale.z 0) und unsichtbar, nur das Sichtbar-Flag unterscheidet sich'],
  [AC, '  k.material.color.copy(L.smFarbe).multiplyScalar(hell);', '  k.material.color.copy(L.smFarbe);', 'Helligkeit des Kegels wird nicht gesetzt', [T1]],
  // ---- Ruck und Funken
  [AC, RUCK, '  return Math.min(SM_RUCK_VOXEL, ruck + SM_RUCK_VOXEL / SM_RUCK_ZEIT * dt);', 'Ruck dauerhaft (geht nach dem Rammen nicht zurück)', [T1]],
  [AC, RUCK, '  return rammt ? SM_RUCK_VOXEL : 0;', 'Ruck ohne Verlauf (springt sofort)', [T1]],
  [AC, RUCK, '  return rammt ? ruck + SM_RUCK_VOXEL / SM_RUCK_ZEIT * dt : Math.max(0, ruck - SM_RUCK_VOXEL / SM_RUCK_ZURUECK * dt);', 'Ruck ohne Obergrenze (wächst weiter)', [T1]],
  [AC, RUCK, '  return Math.min(SM_RUCK_VOXEL, ruck + SM_RUCK_VOXEL / SM_RUCK_ZEIT * dt * (rammt ? 1 : 0.2));', 'Ruck auch außerhalb des Rammens (schwächer)', [T1]],
  [AC, 'const SM_RUCK_VOXEL = 7;', 'const SM_RUCK_VOXEL = 12;', 'Ruck 12 Voxel statt 6 bis 8', [T1]],
  [AC, 'const SM_RUCK_ZEIT = 0.15;', 'const SM_RUCK_ZEIT = 0.6;', 'Ruck zu langsam (0,6 s)', [T1]],
  [AC, '  a.body.position.set(0, 0, S.ruck * VX);', '  a.body.position.set(0, S.ruck * VX, 0);', 'Ruck nach oben statt nach vorn', [T1]],
  [AC, FUNKEN, 'function monsterFunkenAn(zustand) { return true; }', 'Funken immer', [T1]],
  [AC, FUNKEN, "function monsterFunkenAn(zustand) { return zustand === 'rammen' || zustand === 'jagd'; }", 'Funken auch in der Jagd', [T1]],
  [AC, FUNKEN, 'function monsterFunkenAn(zustand) { return false; }', 'Funken nie', [T1]],
  [AC, "fx.spawnFx('sparks', {", "fx.spawnFx('staub', {", 'Funken lösen einen anderen Effekt aus', [T1]],
  [AC, 'const SM_FUNKEN_TAKT = 0.04;', 'const SM_FUNKEN_TAKT = 0.001;', 'Funkentakt 1 kHz (höchstens 3 je Bild)', [T1]],
  [AC, '  if (!monsterFunkenAn(zustand)) { S.funkenAcc = 0; return; }', '  if (!monsterFunkenAn(zustand)) { return; }', 'Funken-Zähler wird außerhalb des Rammens nicht zurückgesetzt', [T1], 'gleichwertig: der Zähler läuft höchstens auf einen Takt (0,04 s, Obergrenze in monsterFunkenZahl), das erste Rammbild löst höchstens einen Schauer früher aus'],
  [AC, FUNKENPUNKT, '  return [pos[0] + Math.cos(yaw) * quer, pos[1] + hoch, pos[2] + Math.cos(yaw) * vor];', 'Funkenpunkt ignoriert die Blickrichtung (nur yaw 0 stimmt)', [T1]],
  [AC, 'const SM_SCHILD_VOR = 0.95;', 'const SM_SCHILD_VOR = -0.95;', 'Funken hinter dem Monster statt am Schild', [T1]],
  [AC, '(Math.random() * 2 - 1) * 0.5, 0.1), n: 5, s0: [0.05, 0.08], dt });', '(Math.random() * 2 - 1) * 0.5, 1.6), n: 5, s0: [0.05, 0.08], dt });', 'Funken in Kopfhöhe statt am Boden', [T1]],
  // ---- MON-02 Nacharbeit (Optik Station-Monster): Kegel-Helligkeit, Funken, Schwenk, Freigabe
  [AC, '  patrouille: { laenge: 3.4, breite: 1.8, hell: 0.34 },', '  patrouille: { laenge: 3.4, breite: 1.8, hell: 0.30 },', 'N2: Patrouille-Kegel wieder zart (0,30)', [T1]],
  [AC, '  laerm: { laenge: 5.6, breite: 0.8, hell: 0.42 },', '  laerm: { laenge: 5.6, breite: 0.8, hell: 0.36 },', 'N2: Lärm-Kegel wieder zart (0,36)', [T1]],
  [AC, 'n: 5, s0: [0.05, 0.08], dt });', 'n: 3, s0: [0.05, 0.08], dt });', 'N1: nur 3 Funken je Schauer', [T1]],
  [AC, 'n: 5, s0: [0.05, 0.08], dt });', 'n: 5, dt });', 'N1: Funken ohne Größenangabe (klein)', [T1]],
  [AC, 'n: 5, s0: [0.05, 0.08], dt });', 'n: 5, s0: [0.03, 0.05], dt });', 'N1: Funken wieder 0,03 bis 0,05 m', [T1]],
  [FX, '{ c0: o.color, s0: o.s0 }); break;', '{ c0: o.color }); break;', 'N1: spawnFx reicht die Größe nicht an FX.sparks', [T1]],
  [FX, 's0: o.s0 ? rnd(o.s0[0], o.s0[1]) : rnd(0.03, 0.05),', 's0: rnd(0.03, 0.05),', 'N1: FX.sparks ignoriert die Größenoption', [T1]],
  [AC, 'e.x, e.y, yaw + psi, solid);', 'e.x, e.y, yaw, solid);', '13a: Wandkürzung ignoriert den Sensorschwenk (yaw statt yaw + psi)', [T1]],
  [AC, 'if (this.smKegel) { this.smKegel.geometry.dispose(); this.smKegel.material.dispose(); } ', '', '13b: dispose gibt den Kegel nicht frei', [T1]],
  [AC, 'this.smKegel.geometry.dispose(); this.smKegel.material.dispose(); }', 'this.smKegel.material.dispose(); }', '13b: dispose gibt die Geometrie des Kegels nicht frei', [T1]],
  [AC, 'this.smKegel.geometry.dispose(); this.smKegel.material.dispose(); }', 'this.smKegel.geometry.dispose(); }', '13b: dispose gibt das Material des Kegels nicht frei', [T1]],
  // ---- Blick
  [AC, BLICK, BLICK.replace('yawOf(Math.cos(f), Math.sin(f))', 'yawOf(0, 1)'), 'Blickrichtung ignoriert mo.f', [T1]],
  [AC, BLICK, BLICK.replace('), false);', '), true);'), 'Blick rastet auf 45 Grad (locomote mit moving true)', [T1], 'gleichwertig für den Test: die Attrappe von locomote kennt das Einrasten nicht; geprüft nur im Browser (Kegel zeigt in Fahrtrichtung)'],
  // ---- Manifest
  [MA, '"id": "station/schottbrecher/lampe"', '"id": "station/schottbrecher/lampen"', 'Manifest: Teilmodell lampe falsch benannt', [T1]],
  [MA, '"kind": "figure",\n      "tier": "detail",\n      "palette": "schottbrecher",\n      "footprint": [\n        2,\n        2\n      ],', '"kind": "figure",\n      "tier": "detail",\n      "palette": "schottbrecher",\n      "footprint": [\n        1,\n        1\n      ],', 'Manifest: Figur mit Fußabdruck 1 × 1', [T1]],
];

{
  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, datei), 'utf8')); } catch (e) { schlecht.push(`${was}: Datei ${datei} nicht lesbar`); continue; }
    const k = text.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) process.exit(0);
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 180000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Abschnitt/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe Station-Monster-Optik (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf(T1);
  console.log(`  Ausgangslage ${T1}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, tests, gleichwertig] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let fe = [], absturz = false, von = null;
  for (const test of tests) {
    const r = lauf(test);
    const e = r.status === 0 ? [] : pruefFehler(r);
    if (e.length) { fe = e; von = test; break; }
    if (r.status !== 0) absturz = true;
  }
  fs.writeFileSync(f, orig);
  if (gleichwertig) {   // als gleichwertig eingestuft (kein Test beobachtet die Stelle): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß; ' + gleichwertig})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${path.basename(von)}: ${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
