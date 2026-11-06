'use strict';
// MON-02 Nacharbeit (Code-Review 13c): Die Lockerung der Asset-Prüfung (keine Anker/Standardposen, Teilelimit 18) hängt an der ausdrücklichen Rig-Eigenschaft
// "art" im Rig (Voxelwerk), nicht an der Heuristik "hat das Gelenk hips". Ein Menschen-Rig ohne hips und ohne art wird weiter streng geprüft.
//   node tools/test-rig-art.js   (npm run test:rig-art)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

(async () => {
  const { istMenschenRig } = await import('./rig-art.mjs');
  const rig = (id) => JSON.parse(read('public/voxel/assets/rigs/' + id + '.json'));
  console.log('\n[Rig-Art]');
  ok(rig('schottbrecher').art === 'vierbeiner', 'das synchronisierte Rig schottbrecher trägt art "vierbeiner" (Voxelwerk-Asset)');
  ok(rig('human').art === undefined && istMenschenRig(rig('human')), 'das Rig human trägt keine art und gilt als Menschen-Rig (streng)');
  ok(!istMenschenRig(rig('schottbrecher')), 'Rig mit art "vierbeiner": kein Menschen-Rig (Anker und Standardposen entfallen, Teilelimit 18)');
  const ohneHips = { id: 'x', joints: { root: { at: [0, 0, 0] }, hull: { parent: 'root', at: [0, 1, 0] } } };
  ok(istMenschenRig(ohneHips), 'Menschen-Rig ohne Gelenk hips und ohne art: bleibt streng geprüft (keine Heuristik über Gelenknamen)');
  ok(istMenschenRig({ art: 'mensch', joints: {} }) && istMenschenRig({ art: 'unbekannt', joints: {} }) && istMenschenRig(null), 'jede andere oder unbekannte art, auch fehlendes Rig: streng');
  const hips = { id: 'y', art: 'vierbeiner', joints: { hips: { at: [0, 1, 0] } } };
  ok(!istMenschenRig(hips), 'art "vierbeiner" entscheidet allein (ein Gelenk hips ändert daran nichts)');
  console.log('\n[Quelltext check-assets.mjs]');
  const ca = read('tools/check-assets.mjs');
  ok(/import \{ istMenschenRig \} from '\.\/rig-art\.mjs';/.test(ca) && /const menschRig = istMenschenRig\(rig\);/.test(ca), 'check-assets.mjs entscheidet über istMenschenRig(rig)');
  ok(!/rig\.joints\.hips/.test(ca), 'check-assets.mjs enthält die Heuristik rig.joints.hips nicht mehr');
  console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('  FEHLER ' + (e.stack || e)); process.exit(1); });
