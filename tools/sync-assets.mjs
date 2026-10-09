// Asset-Sync (CONTRACT-M4 §4): Voxelwerk → public/voxel/ + public/vendor/three/
//
//   npm run assets            einmal synchronisieren
//   npm run assets:watch      bei Änderungen in Voxelwerk oder assets/manifest/ erneut synchronisieren
//
// Quelle: VOXELWERK_PATH (Standard ../voxelwerk). Voxelwerk wird nur gelesen.
// Ergebnis:
//   public/vendor/three/      three.module.js, three.core.js, addons/**, three-LICENSE.txt, VERSION
//   public/voxel/core/*.js    DOM-freier Kern (ES-Module)
//   public/voxel/render/voxel-three.js
//   public/voxel/assets/…     alle Paletten, Rigs, Posen, Moods + alle Modelle/Figuren aus den Manifesten samt Abhängigkeiten
//   public/voxel/manifest.json  zusammengeführte Manifeste (Format: assets/manifest/_schema.md); `sockets` = Rezept-Sockets
//                               + Manifest-Sockets (Manifest hat Vorrang, CONTRACT-B1 §10.1), `socketsFromRecipe` nennt die übernommenen
//   public/voxel/VERSION.json   { voxelwerkCommit, dirty, date, three, counts }
// Exit-Code 1 bei Fehlern (doppelte IDs, kaputte Manifeste, Assets, die sich nicht laden lassen).
// Die Ausgabe wird trotzdem geschrieben (ohne die fehlerhaften Einträge), damit die anderen Teams weiterarbeiten können.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VW = path.resolve(ROOT, process.env.VOXELWERK_PATH || '../voxelwerk');
const MANIFEST_DIR = path.join(ROOT, 'assets', 'manifest');
const OUT = path.join(ROOT, 'public', 'voxel');
const VENDOR_OUT = path.join(ROOT, 'public', 'vendor', 'three');
const ALWAYS_KINDS = ['palettes', 'rigs', 'poses', 'moods'];
// Figuren, die die Pipeline selbst braucht (Maßstab-Figur der Galerie). Werden mitkopiert, wenn vorhanden.
const PIPELINE_EXTRA = [{ kind: 'figures', id: 'crew/nova' }];

const args = process.argv.slice(2);
const WATCH = args.includes('--watch');
const QUIET = args.includes('--quiet');

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const log = (...a) => { if (!QUIET) console.log(...a); };

// ---------------------------------------------------------------------------------------------
// Dateien schreiben: nur bei geänderter Bytefolge (schont Watcher, Git und Browser-Caches)
// ---------------------------------------------------------------------------------------------
function makeWriter() {
  const written = new Set();
  let changed = 0;
  async function put(dest, data) {
    written.add(path.resolve(dest));
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const old = await fsp.readFile(dest).catch(() => null);
    if (old && old.equals(buf)) return;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, buf);
    changed++;
  }
  async function copy(src, dest) { await put(dest, await fsp.readFile(src)); }
  /** Löscht alles unter dir, was in diesem Lauf nicht geschrieben wurde. */
  async function prune(dir) {
    let removed = 0;
    const walk = async (d) => {
      const ents = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
      for (const e of ents) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) {
          await walk(f);
          if (!(await fsp.readdir(f)).length) await fsp.rmdir(f).catch(() => {});
        } else if (!written.has(path.resolve(f))) { await fsp.unlink(f); removed++; }
      }
    };
    await walk(dir);
    return removed;
  }
  return { put, copy, prune, get changed() { return changed; }, get count() { return written.size; } };
}

async function listFiles(dir, filter = () => true) {
  const out = [];
  const walk = async (d) => {
    const ents = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f); else if (filter(f)) out.push(f);
    }
  };
  await walk(dir);
  return out.sort();
}

// Git ist auf diesem Rechner sehr langsam beim Prozessstart (gemessen 2–25 s). Deshalb:
// - Commit direkt aus .git lesen (HEAD → ref → loose ref oder packed-refs), kein Prozess.
// - dirty per `git status --porcelain` asynchron parallel zum Kopieren, mit Zeitlimit (SYNC_GIT_TIMEOUT ms, Standard 4000).
//   Läuft das Zeitlimit ab (oder im Watch-Modus), gilt eine mtime-Schätzung: dirty, wenn eine Datei in
//   core/render/vendor/assets neuer ist als .git/index. VERSION.json nennt die Quelle in `dirtySource`.
function readCommit() {
  try {
    const gitDir = path.join(VW, '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice(4).trim();
    const loose = path.join(gitDir, ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((l) => l.endsWith(' ' + ref));
    return line ? line.split(' ')[0] : null;
  } catch (e) { return null; }
}
function gitStatusAsync(timeoutMs) {
  return new Promise((resolve) => {
    execFile('git', ['-C', VW, 'status', '--porcelain', '--', 'core', 'render', 'vendor', 'assets'],
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout.trim().length > 0));
  });
}
async function mtimeDirty() {
  const idx = await fsp.stat(path.join(VW, '.git', 'index')).catch(() => null);
  if (!idx) return true;
  for (const d of ['core', 'render', 'vendor', 'assets']) {
    for (const f of await listFiles(path.join(VW, d))) {
      const st = await fsp.stat(f).catch(() => null);
      if (st && st.mtimeMs > idx.mtimeMs) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Manifeste lesen und zusammenführen
// ---------------------------------------------------------------------------------------------
/** Liest assets/manifest/*.json (ohne _-Dateien). Rückgabe { teams, entries:[{...entry, team, file}], errors } */
export async function readManifests(dir = MANIFEST_DIR) {
  const errors = [], entries = [], teams = [];
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const seen = new Map();
  for (const f of files) {
    let m;
    try { m = JSON.parse((await fsp.readFile(path.join(dir, f), 'utf8')).replace(/^﻿/, '')); }   // BOM (PowerShell) tolerieren
    catch (e) { errors.push(`${f}: kein gültiges JSON (${e.message})`); continue; }
    const team = m.team || f.replace(/\.json$/, '');
    if (!Array.isArray(m.assets)) { errors.push(`${f}: Feld "assets" (Array) fehlt`); continue; }
    teams.push({ team, file: f, count: m.assets.length });
    m.assets.forEach((a, i) => {
      if (!a || typeof a.id !== 'string' || !a.id) { errors.push(`${f}: assets[${i}] ohne "id"`); return; }
      if (seen.has(a.id)) { errors.push(`doppelte ID "${a.id}" in ${f} (schon in ${seen.get(a.id)})`); return; }
      seen.set(a.id, f);
      const kind = a.kind || 'model';
      if (kind !== 'model' && kind !== 'figure') { errors.push(`${f}: ${a.id}: kind "${kind}" (erlaubt: model, figure)`); return; }
      entries.push({ ...a, kind, source: a.source || a.id, team, file: f });
    });
  }
  return { teams, entries, errors };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/**
 * Sockets aus dem Voxelwerk-Rezept + Manifest (CONTRACT-B1 §3.4 AD 3, §10.1): Rezept-Sockets werden übernommen,
 * der Manifest-Eintrag hat je Socket-Name Vorrang. Rückgabe { sockets, fromRecipe: [Namen], overridden: [Namen], present }.
 * present = Manifest oder Rezept führt ein Feld `sockets` (auch leer).
 */
export function mergeSockets(entry, recipe) {
  const rs = isObj(recipe?.sockets) ? recipe.sockets : {};
  const ms = isObj(entry?.sockets) ? entry.sockets : {};
  const fromRecipe = Object.keys(rs).filter((k) => !(k in ms));
  const overridden = Object.keys(rs).filter((k) => k in ms && JSON.stringify(rs[k]) !== JSON.stringify(ms[k]));
  return { sockets: { ...rs, ...ms }, fromRecipe, overridden, present: isObj(recipe?.sockets) || isObj(entry?.sockets) };
}

// ---------------------------------------------------------------------------------------------
// Ein Lauf
// ---------------------------------------------------------------------------------------------
async function syncOnce() {
  const t0 = performance.now();
  if (!fs.existsSync(path.join(VW, 'core', 'library.js'))) {
    console.error(`✗ Voxelwerk nicht gefunden unter ${VW} (VOXELWERK_PATH setzen)`);
    return { ok: false };
  }
  const w = makeWriter();
  const errors = [];
  const gitStatus = WATCH ? Promise.resolve(null) : gitStatusAsync(+process.env.SYNC_GIT_TIMEOUT || 4000);

  // 1) three.js
  const vendor = path.join(VW, 'vendor');
  for (const f of ['three.module.js', 'three.core.js', 'three-LICENSE.txt']) await w.copy(path.join(vendor, f), path.join(VENDOR_OUT, f));
  for (const f of await listFiles(path.join(vendor, 'addons'))) await w.copy(f, path.join(VENDOR_OUT, 'addons', path.relative(path.join(vendor, 'addons'), f)));
  const rev = (/const REVISION = '(\d+[^']*)'/.exec(await fsp.readFile(path.join(vendor, 'three.core.js'), 'utf8')) || [])[1] || '?';
  await w.put(path.join(VENDOR_OUT, 'VERSION'), `r${rev}\n`);

  // 2) Kern + three-Schicht
  for (const f of await listFiles(path.join(VW, 'core'), (f) => f.endsWith('.js'))) await w.copy(f, path.join(OUT, 'core', path.basename(f)));
  await w.copy(path.join(VW, 'render', 'voxel-three.js'), path.join(OUT, 'render', 'voxel-three.js'));
  // Damit Node (check-assets) die kopierten .js als ES-Module lädt
  await w.put(path.join(OUT, 'package.json'), JSON.stringify({ type: 'module', private: true, description: 'generiert von tools/sync-assets.mjs – nicht von Hand ändern' }, null, 2) + '\n');

  // 3) Assets: immer alle Paletten/Rigs/Posen/Moods, dazu alles aus den Manifesten samt Abhängigkeiten
  const { Library, assetPath } = await import(pathToFileURL(path.join(VW, 'core', 'library.js')).href + `?t=${Date.now()}`);
  const io = {
    json: async (p) => JSON.parse(await fsp.readFile(path.join(VW, p), 'utf8')),
    binary: async (p) => { const b = await fsp.readFile(path.join(VW, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  };
  const lib = new Library(io);
  for (const kind of ALWAYS_KINDS) {
    const base = path.join(VW, 'assets', kind);
    for (const f of await listFiles(base, (f) => f.endsWith('.json'))) {
      const id = path.relative(base, f).replace(/\\/g, '/').replace(/\.json$/, '');
      try { await lib.load(kind, id); } catch (e) { errors.push(`${kind}/${id}: ${e.message}`); }
    }
  }
  const man = await readManifests();
  errors.push(...man.errors);
  const merged = {};
  for (const e of man.entries) {
    const kind = e.kind === 'figure' ? 'figures' : 'models';
    try {
      const recipe = await lib.load(kind, e.source);
      const { file, ...entry } = e;
      const ms = mergeSockets(e, recipe);
      entry.sockets = ms.sockets;
      if (ms.fromRecipe.length) entry.socketsFromRecipe = ms.fromRecipe;   // Herkunft (Info für Galerie/Fehlersuche)
      merged[e.id] = entry;
    } catch (err) { errors.push(`${e.file}: ${e.id}${e.source !== e.id ? ' (source ' + e.source + ')' : ''}: ${err.message}`); }
  }
  for (const x of PIPELINE_EXTRA) { try { await lib.load(x.kind, x.id); } catch (e) { /* optional */ } }

  const counts = {};
  for (const [kind, map] of Object.entries(lib.store)) {
    counts[kind] = map.size;
    for (const id of map.keys()) await w.copy(path.join(VW, assetPath(kind, id)), path.join(OUT, assetPath(kind, id)));
  }
  counts.vox = lib.vox.size;
  for (const file of lib.vox.keys()) await w.copy(path.join(VW, 'assets', file), path.join(OUT, 'assets', file));

  // 4) manifest.json + VERSION.json
  const gitDirty = await gitStatus;
  const git = { commit: readCommit(), dirty: gitDirty ?? (await mtimeDirty()), dirtySource: gitDirty === null ? 'mtime' : 'git' };
  const date = new Date().toISOString();
  const manifest = {
    format: 1,
    teams: man.teams.map(({ team, file, count }) => ({ team, file, count })),
    assets: Object.fromEntries(Object.keys(merged).sort().map((id) => [id, merged[id]])),
  };
  await w.put(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // index.json: alle kopierten IDs je Art (z. B. für Stimmungswahl; der Browser kann keine Ordner auflisten)
  const index = Object.fromEntries(Object.entries(lib.store).map(([k, m]) => [k, [...m.keys()].sort()]));
  index.vox = [...lib.vox.keys()].sort();
  await w.put(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  // VERSION.json nur neu schreiben, wenn sich sonst etwas geändert hat oder der Commit wechselt (Datum sonst stabil)
  const verPath = path.join(OUT, 'VERSION.json');
  const oldVer = JSON.parse(await fsp.readFile(verPath, 'utf8').catch(() => 'null'));
  const ver = { voxelwerkCommit: git.commit, dirty: git.dirty, dirtySource: git.dirtySource, date, three: rev, manifests: man.teams.length, assets: Object.keys(merged).length, counts };
  const same = oldVer && oldVer.voxelwerkCommit === ver.voxelwerkCommit && oldVer.dirty === ver.dirty && JSON.stringify(oldVer.counts) === JSON.stringify(ver.counts) && oldVer.assets === ver.assets;
  if (w.changed === 0 && same) ver.date = oldVer.date;
  await w.put(verPath, JSON.stringify(ver, null, 2) + '\n');

  // 5) Veraltetes entfernen
  const removed = (await w.prune(OUT)) + (await w.prune(VENDOR_OUT));

  const ms = Math.round(performance.now() - t0);
  log(`${errors.length ? '✗' : '✓'} Assets synchronisiert in ${ms} ms – ${man.teams.length} Manifeste, ${Object.keys(merged).length} Einträge · ` +
    Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') + ` · ${w.count} Dateien (${w.changed} geändert, ${removed} entfernt)`);
  log(`  Voxelwerk ${git.commit ? git.commit.slice(0, 8) : '?'}${git.dirty ? ' (dirty)' : ''} · three r${rev} · Quelle ${VW}`);
  for (const e of errors) console.log('  ✗ ' + e);
  return { ok: errors.length === 0, ms, errors };
}

// ---------------------------------------------------------------------------------------------
async function main() {
  if (!WATCH) {
    const r = await syncOnce();
    process.exit(r.ok ? 0 : 1);
  }
  let timer = null, running = false, again = false;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try { await syncOnce(); } catch (e) { console.error('✗ Sync abgebrochen:', e.message); }
    running = false;
    if (again) { again = false; run(); }
  };
  const trigger = (where) => (ev, file) => {
    if (file && /(^|[\\/])\.|~$|\.tmp$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { log(`… Änderung: ${where}/${file || ''}`); run(); }, 250);
  };
  await run();
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  for (const [dir, name] of [[path.join(VW, 'core'), 'voxelwerk/core'], [path.join(VW, 'render'), 'voxelwerk/render'],
    [path.join(VW, 'assets'), 'voxelwerk/assets'], [path.join(VW, 'vendor'), 'voxelwerk/vendor'], [MANIFEST_DIR, rel(MANIFEST_DIR)]]) {
    try { fs.watch(dir, { recursive: true }, trigger(name)); } catch (e) { console.error(`! kann ${dir} nicht beobachten: ${e.message}`); }
  }
  log('Beobachte Voxelwerk und assets/manifest/ … (Strg+C beendet)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
