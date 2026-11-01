'use strict';
// CHA-01 B2 Nacharbeit (S1): tools/sync-assets.mjs löscht nichts, wenn der Lauf Fehler hat oder die Quelle den Charakter-Katalog nicht führt.
// Läuft gegen eine Attrappe in einem temporären Ordner (Kopie des Skripts, kleines Pseudo-Voxelwerk); das echte Voxelwerk und public/ bleiben unberührt.
//   node tools/test-sync-assets.js   (npm run test:sync-assets)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const SCRIPT = path.join(__dirname, 'sync-assets.mjs');

let n = 0, fails = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const put = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-assets-'));

// Pseudo-Voxelwerk: nur das, was syncOnce liest
const LIB = `export const assetPath = (kind, id) => 'assets/' + kind + '/' + id + '.json';
export class Library {
  constructor(io) { this.io = io; this.store = {}; this.vox = new Map(); }
  async load(kind, id) { const r = await this.io.json(assetPath(kind, id)); (this.store[kind] ||= new Map()).set(id, r); return r; }
}`;
function voxelwerk(dir, mitKatalog) {
  put(path.join(dir, 'core', 'library.js'), LIB);
  put(path.join(dir, 'render', 'voxel-three.js'), '// stub');
  put(path.join(dir, 'vendor', 'three.module.js'), '// stub');
  put(path.join(dir, 'vendor', 'three.core.js'), "const REVISION = '1';");
  put(path.join(dir, 'vendor', 'three-LICENSE.txt'), 'MIT');
  put(path.join(dir, 'assets', 'models', 'a.json'), '{"id":"a"}');
  if (mitKatalog) put(path.join(dir, 'assets', 'katalog', 'charakter.json'), '{"v":1}');
}
// Pantheon-Attrappe: Skript liegt in <root>/tools, ROOT ist sein Elternordner
function pantheon(root, cha, manifestEintraege) {
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'tools', 'sync-assets.mjs'));
  if (cha) put(path.join(root, 'assets', 'manifest', 'cha.json'), JSON.stringify({ team: 'cha', assets: [{ id: 'cha/x', source: 'a' }] }));
  put(path.join(root, 'assets', 'manifest', 'art-x.json'), JSON.stringify({ team: 'x', assets: manifestEintraege }));
  // Altbestand, der nicht weg darf
  put(path.join(root, 'public', 'voxel', 'assets', 'katalog', 'charakter.json'), 'ALT');
  put(path.join(root, 'public', 'voxel', 'assets', 'figures', 'cha', 'spieler.json'), 'ALT');
  put(path.join(root, 'public', 'voxel', 'sprites', 'cha', 'vorschau', 'v.png'), 'ALT');
  put(path.join(root, 'content', 'katalog', 'charakter.json'), 'ALT');
}
const lauf = (root, vw) => spawnSync(process.execPath, [path.join(root, 'tools', 'sync-assets.mjs'), '--quiet'], { env: { ...process.env, VOXELWERK_PATH: vw, SYNC_GIT_TIMEOUT: '50' }, encoding: 'utf8' });
function momentaufnahme(root) {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out[path.relative(root, f)] = fs.readFileSync(f, 'utf8'); } };
  for (const d of ['public', 'content']) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
  return JSON.stringify(out);
}

try {
  console.log('\nQuelle ohne Katalog, Manifest cha.json vorhanden');
  {
    const root = path.join(tmp, 'p1'), vw = path.join(tmp, 'vw1');
    voxelwerk(vw, false); pantheon(root, true, [{ id: 'a' }]);
    const vorher = momentaufnahme(root);
    const r = lauf(root, vw);
    ok(r.status !== 0, `Exit-Code ungleich 0 (${r.status})`);
    ok(/VOXELWERK_PATH/.test(r.stderr) && /Katalog/.test(r.stderr), 'Meldung nennt Katalog und VOXELWERK_PATH');
    ok(momentaufnahme(root) === vorher, 'Zielordner unverändert (nichts geschrieben, nichts gelöscht)');
  }
  console.log('\nQuelle mit Katalog, aber ein Asset lässt sich nicht laden');
  {
    const root = path.join(tmp, 'p2'), vw = path.join(tmp, 'vw2');
    voxelwerk(vw, true); pantheon(root, true, [{ id: 'a' }, { id: 'fehlt' }]);
    const r = lauf(root, vw);
    ok(r.status !== 0, `Exit-Code ungleich 0 (${r.status})`);
    ok(/fehlt/.test(r.stdout), 'Fehler wird genannt');
    const gelesen = (f) => fs.existsSync(path.join(root, f)) && fs.readFileSync(path.join(root, f), 'utf8');
    ok(['public/voxel/assets/figures/cha/spieler.json', 'public/voxel/sprites/cha/vorschau/v.png'].every((f) => gelesen(f) === 'ALT'), 'Altbestand (Figur, Vorschau) nach Fehler nicht gelöscht');
    ok(gelesen('public/voxel/assets/katalog/charakter.json') === '{"v":1}', 'Katalog wird trotz Fehler geschrieben');
  }
  console.log('\nFehlerfreier Lauf räumt weiter auf');
  {
    const root = path.join(tmp, 'p3'), vw = path.join(tmp, 'vw3');
    voxelwerk(vw, true); pantheon(root, true, [{ id: 'a' }]);
    const r = lauf(root, vw);
    ok(r.status === 0, `Exit-Code 0 (${r.status}) ${r.status ? r.stdout + r.stderr : ''}`);
    ok(!fs.existsSync(path.join(root, 'public', 'voxel', 'assets', 'figures', 'cha', 'spieler.json')), 'Veraltetes wird entfernt');
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log(fails + ' FEHLER'); process.exit(1); }
