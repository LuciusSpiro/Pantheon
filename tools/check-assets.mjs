// Asset-Prüfung (CONTRACT-M4 §4/§5): baut jedes Manifest-Asset in jedem Zustand in Node und prüft es.
//
//   npm run check:assets                     prüft gegen public/voxel/ (das, was das Spiel lädt; vorher npm run assets)
//   npm run check:assets -- --vw             prüft direkt gegen Voxelwerk (VOXELWERK_PATH, Standard ../voxelwerk)
//   npm run check:assets -- --team art-b     nur ein Team
//   npm run check:assets -- lerche/station   nur IDs, die den Text enthalten
//   npm run check:assets -- --no-missing     Liste der fehlenden Vertrags-IDs weglassen
//
// Geprüft: Pflichtfelder (§5), Dreiecke je Zustand gegen budgetTris und Vertragsbudget (Warnung > 100 %, Fehler > 150 %),
// Grundfläche/Höhe gegen footprint/height (+ 2,2-m-Grenze), Pflicht-Sockets, Parameter aus §3.3/§3.4/§3.6,
// Posen aus §3.4. Fehlende IDs aus §3.3/§3.4/§3.6 werden je Team gelistet (kein Fehler).
// Exit-Code 1 bei Fehlern.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readManifests } from './sync-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const USE_VW = argv.includes('--vw');
const TEAM = opt('--team');
const SHOW_MISSING = !argv.includes('--no-missing');
const FILTER = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--team')[0] || null;
const SRC = USE_VW ? path.resolve(ROOT, process.env.VOXELWERK_PATH || '../voxelwerk') : path.join(ROOT, 'public', 'voxel');
const MANIFEST_DIR = path.join(ROOT, 'assets', 'manifest');

// ---------------------------------------------------------------------------------------------
// Vertragswissen (§3.3, §3.4, §3.6, §5)
// ---------------------------------------------------------------------------------------------
const P = (s) => s.split(' ').filter(Boolean);
/** ID → Parameter, die das Spiel setzt (leer = keine). */
const EXPECTED = {
  // §3.3 Schiff
  'lerche/kit/wall': P('conn cut style variant'), 'lerche/kit/window': [], 'lerche/kit/floor': P('kind wear'),
  'lerche/kit/door': P('open style'), 'lerche/kit/breach': P('patched'), 'lerche/kit/light': P('mode style'),
  'lerche/kit/plaque': P('side'), 'lerche/kit/light_shaft': P('glow'), 'lerche/kit/pad': P('phase'),
  'lerche/station/reactor': P('state power'), 'lerche/station/reactor_switch': P('pos'), 'lerche/station/shield_gen': P('state'),
  'lerche/station/life_support': P('state'), 'lerche/station/engine': P('state throttle'), 'lerche/station/thruster': P('state side'),
  'lerche/station/lance': P('state charge'), 'lerche/station/battery': P('state side tubes'), 'lerche/station/emitter': P('state side strength'),
  'lerche/station/transfer': P('state'),
  'lerche/console/transfer': P('occupied alert'), 'lerche/console/helm': P('occupied alert'), 'lerche/console/tactical': P('occupied alert'),
  'lerche/console/captain': P('occupied'), 'lerche/console/plan_table': P('active'), 'lerche/console/spare': [], 'lerche/console/shop': P('docked'),
  'lerche/furn/shelf': P('item fill'), 'lerche/furn/pipes': [], 'lerche/furn/workbench': [], 'lerche/furn/control_desk': [],
  'lerche/furn/barrel': [], 'lerche/furn/crate': P('seed'), 'lerche/furn/bed': P('color'), 'lerche/furn/mess_table': [],
  'lerche/furn/sideboard': [], 'lerche/furn/trophy_niche': P('filled'), 'lerche/furn/shrine': [], 'lerche/furn/med_bed': [],
  'lerche/furn/bath': [], 'lerche/furn/bench': [], 'lerche/furn/floor_decal': P('kind seed'),
  'lerche/lift/shaft': P('deck power'), 'lerche/lift/platform': P('moving'), 'lerche/lift/ladder': [],
  'lerche/deco/quarter_floor': P('style'),
  ...Object.fromEntries(P('pflanze poster lampe teppich buecherregal aquarium sessel sternkarte trophaee_boje kristalllampe lamassu_figur').map((d) => ['lerche/deco/' + d, []])),
  // §3.4 Figuren und Modelle
  'lerche/actor/bot': P('mode'), 'lerche/actor/drone': P('wreck'), 'lerche/actor/warden': P('state front'),
  ...Object.fromEntries(P('spare_part extinguisher patch_plate bolts medipack datacore wrench tablet salvage blaster scav_rifle').map((d) => ['lerche/item/' + d, []])),
  // §3.6 Außenmissionen
  'away/platform/floor': [], 'away/platform/wall': P('conn cut'), 'away/platform/door_locked': P('open'),
  'away/platform/buoy_core': P('state'), 'away/platform/sonde': P('color on'),
  'away/wreck/floor': [], 'away/wreck/grate': [], 'away/wreck/wall': P('conn cut bent'), 'away/wreck/wall_weak': P('state'),
  'away/wreck/salvage': P('open'), 'away/wreck/lore_terminal': P('read'), 'away/wreck/debris': P('seed'),
  'away/kesh/floor_ruin': [], 'away/kesh/wall_ruin': P('conn cut decay'), 'away/kesh/cover_low': P('damaged'), 'away/kesh/pillar': [],
  'away/kesh/jammer': P('on'), 'away/kesh/archive_key': P('pos'), 'away/kesh/vault_gate': P('open'),
  'away/kesh/tablet_pedestal': P('present'), 'away/kesh/rubble': P('seed'),
};
const EXPECTED_FIGURES = { 'lerche/crew_0': [], 'lerche/crew_1': [], 'lerche/crew_2': [], 'crew/nova': [], 'crew/juno': [], 'crew/tami': [], 'lerche/ivo': [], 'lerche/scavenger': P('role') };
const EXPECTED_POSES = P('stand walk aim talk point kneel inspect attention guard arms_crossed sit operate repair extinguish carry hold minigame climb lift_ride crouch wounded revive hit');
const EXPECTED_OTHER = { palettes: P('lerche_rom mond_kesh wrack rostmeute'), moods: P('ship_interior ship_private kesh_dusk wreck_dark platform_space') };

/** Zuständiges Team laut §1. */
function ownerOf(id) {
  if (id === 'lerche/kit/pad') return 'art-c';
  if (id.startsWith('lerche/kit/')) return 'art-a';
  if (/^lerche\/station\/(battery|emitter|transfer)$/.test(id) || id.startsWith('lerche/station/parts_c/') || id.startsWith('lerche/console/')) return 'art-c';
  if (id.startsWith('lerche/station/')) return 'art-b';
  if (/^lerche\/furn\/(shelf|pipes|workbench|control_desk|barrel|crate|floor_decal)$/.test(id) || id.startsWith('lerche/lift/')) return 'art-e';
  if (id.startsWith('lerche/furn/') || id.startsWith('lerche/deco/')) return 'art-d';
  if (/^lerche\/(scavenger|actor\/(drone|warden)|item\/(blaster|scav_rifle))$/.test(id)) return 'art-g';
  if (/^lerche\/(crew_\d|ivo|actor\/bot|item\/)/.test(id) || id.startsWith('crew/')) return 'art-f';
  if (id.startsWith('away/')) return 'art-h';
  if (id === 'ship_private') return 'art-a';
  if (/^(mond_kesh|wrack|kesh_dusk|wreck_dark|platform_space)$/.test(id)) return 'art-h';
  return 'studio';
}
const isStation = (id) => /^lerche\/(station|console)\/[^/]+$/.test(id) && !/\/parts_/.test(id);
const isLight = (id, e) => id === 'lerche/kit/light' || (e.tags || []).includes('light');
// Wandmontiert (Pivot an der Wand, nicht mittig): Wandleuchte, Fenster, Plakette
const footprintExempt = (id) => /^lerche\/kit\/(light|window|plaque)$/.test(id);
// Handgehaltene Gegenstände (Pivot = Griff, Anker handR): keine Boden-/Grundflächen-/Höhenprüfung
const isHeld = (id, e) => /^lerche\/item\//.test(id) || (e.tags || []).includes('held');
const heightExempt = (id, e) => /(^|\/)(wall\w*|window|door|shaft|rock\w*|fels\w*|pillar|vault_gate)$/.test(id) || (e.tags || []).some((t) => ['wall', 'terrain', 'rock'].includes(t));
/** Vertragsbudget §5 (Dreiecke je Zustand). */
function contractBudget(id, e, tier) {
  if (e.kind === 'figure' || id.startsWith('lerche/actor/')) return { n: 6000, what: 'Figur' };
  if ((e.tags || []).includes('terrain')) return { n: 8000, what: 'Geländeblock' };
  if (/(^|\/)(floor|grate|floor_ruin|quarter_floor)$/.test(id)) return { n: 150, what: 'Bodenkachel' };
  if (/(^|\/)wall(_\w+)?$/.test(id)) return { n: 600, what: 'Wandkachel' };
  if (isStation(id)) return { n: 6000, what: 'Station/Konsole' };
  if (tier === 'architecture' || tier === 'terrain') return { n: 3000, what: 'Architekturmodul' };
  // Detail-Prop: 2.500 je belegter Kachel (2×2-Möbel wie Messetisch = 10.000) – Auslegung PIPELINE, siehe Bericht
  const fp = Array.isArray(e.footprint) ? e.footprint : [1, 1];
  const tiles = Math.max(1, Math.min(4, Math.round(fp[0]) * Math.round(fp[1])));
  return { n: 2500 * tiles, what: tiles > 1 ? `Detail-Prop ${tiles} Kacheln` : 'Detail-Prop' };
}

// ---------------------------------------------------------------------------------------------
const fmt = (n) => Math.round(n).toLocaleString('de-DE');
const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); };
const padL = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && isFinite(x));

function steps(range) {
  const [a, b] = range; if (!(b >= a)) return [a];
  if (Number.isInteger(a) && Number.isInteger(b) && b - a <= 6) return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return [a, b];
}

async function main() {
  const t0 = performance.now();
  if (!fs.existsSync(path.join(SRC, 'core', 'library.js'))) {
    console.error(`✗ ${SRC}/core/library.js fehlt – ${USE_VW ? 'VOXELWERK_PATH prüfen' : 'erst npm run assets'}`);
    process.exit(1);
  }
  const { Library } = await import(pathToFileURL(path.join(SRC, 'core', 'library.js')).href);
  const { voxelSize } = await import(pathToFileURL(path.join(SRC, 'core', 'scales.js')).href);
  const lib = new Library({
    json: async (p) => JSON.parse(await fsp.readFile(path.join(SRC, p), 'utf8')),
    binary: async (p) => { const b = await fsp.readFile(path.join(SRC, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  });
  const man = await readManifests(MANIFEST_DIR);
  let errors = 0, warnings = 0;
  const general = [];
  for (const e of man.errors) { errors++; general.push('✗ ' + e); }

  // Aktualität der Kopie
  if (!USE_VW) {
    const mst = await fsp.stat(path.join(SRC, 'manifest.json')).catch(() => null);
    const files = (await fsp.readdir(MANIFEST_DIR).catch(() => [])).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const st = await fsp.stat(path.join(MANIFEST_DIR, f));
      if (!mst || st.mtimeMs > mst.mtimeMs) { warnings++; general.push(`! ${f} ist neuer als public/voxel/manifest.json – erst npm run assets (oder --vw)`); break; }
    }
  }

  const byTeam = new Map();
  const entries = man.entries.filter((e) => (!TEAM || e.team === TEAM) && (!FILTER || e.id.includes(FILTER)));
  for (const e of entries) {
    const res = { id: e.id, src: e.source, team: e.team, n: 0, tris: 0, dims: null, notes: [], err: 0, warn: 0, budget: null };
    const bad = (m) => { res.err++; res.notes.push('✗ ' + m); };
    const meh = (m) => { res.warn++; res.notes.push('! ' + m); };
    if (!byTeam.has(e.team)) byTeam.set(e.team, []);
    byTeam.get(e.team).push(res);

    // Pflichtfelder
    const fp = e.footprint;
    if (!(Array.isArray(fp) && fp.length === 2 && fp.every((x) => typeof x === 'number' && x > 0))) bad('footprint [x, z] (Meter) fehlt/ungültig');
    if (typeof e.height !== 'number') bad('height (Meter) fehlt');
    if (e.facing !== '+z') meh(`facing "${e.facing ?? ''}" (erwartet "+z")`);
    if (!e.params || typeof e.params !== 'object' || Array.isArray(e.params)) bad('params {} fehlt');
    if (!e.sockets || typeof e.sockets !== 'object') bad('sockets {} fehlt');
    if (typeof e.budgetTris !== 'number') bad('budgetTris fehlt');
    if (!Array.isArray(e.tags)) meh('tags [] fehlt');
    if (e.states && typeof e.states !== 'object') bad('states muss ein Objekt sein');

    const kind = e.kind === 'figure' ? 'figures' : 'models';
    let asset;
    try { asset = await lib.load(kind, e.source); }
    catch (err) { bad(`lädt nicht: ${err.message}${USE_VW ? '' : ' (synchronisiert? npm run assets)'}`); continue; }

    // Parameter: Spiel-Parameter aus dem Vertrag
    const exp = (e.kind === 'figure' ? EXPECTED_FIGURES : EXPECTED)[e.id];
    const declared = e.kind === 'figure' ? (asset.params || {}) : (asset.params || {});
    if (exp) for (const p of exp) {
      if (p === 'seed') continue;
      if (!(p in (e.params || {}))) meh(`Parameter "${p}" (Vertrag) fehlt in params`);
      if (e.kind !== 'figure' && !(p in declared)) bad(`Modell kennt Parameter "${p}" (Vertrag) nicht`);
    }
    if (isStation(e.id) && e.params?.state && !(e.params.state[0] <= 0 && e.params.state[1] >= 5)) meh('state sollte 0–5 abdecken (§3.3)');
    for (const [k, r] of Object.entries(e.params || {})) {
      if (!Array.isArray(r) || r.length !== 2) { bad(`params.${k} muss [min, max] sein`); continue; }
      if (e.kind !== 'figure' && k !== 'seed' && !(k in declared)) bad(`params.${k}: Modell ${e.source} hat keinen Parameter "${k}"`);
      const d = declared[k];
      if (d && d.min !== undefined && r[0] < d.min) meh(`params.${k}: min ${r[0]} < Modell-min ${d.min}`);
      if (d && d.max !== undefined && r[1] > d.max) meh(`params.${k}: max ${r[1]} > Modell-max ${d.max}`);
    }

    if (e.kind === 'figure') {
      const rig = lib.get('rigs', asset.rig);
      if (!rig) { bad(`Rig ${asset.rig} fehlt`); continue; }
      for (const j of ['handR', 'handL', 'back']) if (!rig.joints[j]) bad(`Rig ${rig.id}: Anker "${j}" fehlt`);
      const parts = [...Object.entries(asset.parts || {}), ...Object.entries(asset.attach || {})];
      if (parts.length > 16) bad(`${parts.length} Teile (max. 16)`);
      let tris = 0;
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      const s = voxelSize(rig.tier || 'detail');
      for (const [jn, part] of parts) {
        try {
          const b = lib.build(part.model, { params: lib.partParams(part.model, asset.params, part.params), palette: part.palette || asset.palette, colors: asset.colors });
          tris += (b.mesh.lit.quads + b.mesh.emit.quads) * 2;
          const bb = b.grid.bounds();
          if (bb && b.grid.size) for (let i = 0; i < 3; i++) { box.min[i] = Math.min(box.min[i], bb.min[i]); box.max[i] = Math.max(box.max[i], bb.max[i] + 1); }
        } catch (err) { bad(`Teil ${jn} (${part.model}): ${err.message}`); }
      }
      res.n = 1; res.tris = tris;
      if (isFinite(box.min[0])) res.dims = [0, 2, 1].map((i) => (box.max[i] - box.min[i]) * s);
      if (rig.poses) {
        const poses = lib.get('poses', rig.poses)?.poses || {};
        const miss = EXPECTED_POSES.filter((p) => !poses[p]);
        if (miss.length) res.notes.push(`· Posen fehlen (${rig.poses}, ART-F): ${miss.join(', ')}`);
      }
    } else {
      if (e.tier && asset.tier !== e.tier) bad(`tier "${e.tier}" im Manifest, Modell hat "${asset.tier}"`);
      if (e.palette && asset.palette && e.palette !== asset.palette) meh(`palette "${e.palette}" im Manifest, Modell nutzt "${asset.palette}"`);
      const variants = [{ label: 'Standard', params: {} }];
      for (const [k, v] of Object.entries(e.states || {})) variants.push({ label: k, params: v || {} });
      for (const [k, r] of Object.entries(e.params || {})) if (Array.isArray(r) && r.length === 2) for (const v of steps(r)) variants.push({ label: `${k}=${v}`, params: { [k]: v } });
      const seen = new Set();
      let maxH = 0, worstFp = null, minY = 0;
      const s = voxelSize(asset.tier);
      const tol = s * 1.01;
      for (const v of variants.slice(0, 60)) {
        const key = JSON.stringify(Object.entries(v.params).sort());
        if (seen.has(key)) continue; seen.add(key);
        let b;
        try { b = lib.build(e.source, { params: v.params }); }
        catch (err) { bad(`[${v.label}] baut nicht: ${err.message}`); continue; }
        res.n++;
        if (!b.grid.size) { bad(`[${v.label}] leer`); continue; }
        const tris = (b.mesh.lit.quads + b.mesh.emit.quads) * 2;
        if (tris > res.tris) { res.tris = tris; res.worst = v.label; }
        const bb = b.grid.bounds(), a = b.anchor;
        const x0 = (bb.min[0] - a[0]) * s, x1 = (bb.max[0] + 1 - a[0]) * s;
        const y0 = (bb.min[1] - a[1]) * s, y1 = (bb.max[1] + 1 - a[1]) * s;
        const z0 = (bb.min[2] - a[2]) * s, z1 = (bb.max[2] + 1 - a[2]) * s;
        const dims = [x1 - x0, z1 - z0, y1 - y0];
        if (!res.dims || dims[2] > res.dims[2] || dims[0] * dims[1] > res.dims[0] * res.dims[1]) res.dims = dims;
        maxH = Math.max(maxH, y1); minY = Math.min(minY, y0);
        if (Array.isArray(fp) && !footprintExempt(e.id) && !isHeld(e.id, e)) {
          const ox = Math.max(-x0 - fp[0] / 2, x1 - fp[0] / 2), oz = Math.max(-z0 - fp[1] / 2, z1 - fp[1] / 2);
          if ((ox > tol || oz > tol) && !worstFp) worstFp = `[${v.label}] ragt über footprint ${JSON.stringify(fp)} hinaus: x ${x0.toFixed(2)}…${x1.toFixed(2)}, z ${z0.toFixed(2)}…${z1.toFixed(2)} m (Pivot = Mitte unten)`;
        }
        // Sockets innerhalb der Bounding-Box (±0,5 m)
        if (v.label === 'Standard') for (const [k, p] of Object.entries(e.sockets || {})) {
          if (!isVec3(p)) { bad(`Socket "${k}" muss [x, y, z] (Meter) sein`); continue; }
          if (p[0] < x0 - 0.5 || p[0] > x1 + 0.5 || p[2] < z0 - 0.5 || p[2] > z1 + 0.5 || p[1] < Math.min(y0, 0) - 0.5 || p[1] > y1 + 0.6) meh(`Socket "${k}" ${JSON.stringify(p)} liegt weit außerhalb des Modells`);
        }
      }
      if (worstFp) bad(worstFp);
      if (minY < -tol && !isHeld(e.id, e)) meh(`reicht ${(-minY).toFixed(2)} m unter den Boden (Pivot unten?)`);
      if (typeof e.height === 'number' && !isHeld(e.id, e)) {
        if (maxH > e.height + tol) bad(`Höhe ${maxH.toFixed(2)} m > height ${e.height} m`);
        else if (maxH < e.height - 0.25) meh(`height ${e.height} m, Modell nur ${maxH.toFixed(2)} m hoch`);
      }
      if (maxH > 2.2 + tol && !heightExempt(e.id, e) && !isHeld(e.id, e)) bad(`Höhe ${maxH.toFixed(2)} m > 2,2 m (§5)`);
    }

    // Sockets Pflicht
    const sk = e.sockets || {};
    if (isStation(e.id)) for (const k of ['use', 'fx_smoke', 'fx_spark', 'label']) if (!sk[k]) bad(`Pflicht-Socket "${k}" fehlt`);
    if (isLight(e.id, e) && !sk.light) bad('Pflicht-Socket "light" fehlt');

    // Budgets
    const cb = contractBudget(e.id, e, asset.tier);
    const budget = Math.min(typeof e.budgetTris === 'number' ? e.budgetTris : cb.n, cb.n);
    if (typeof e.budgetTris === 'number' && e.budgetTris > cb.n) meh(`budgetTris ${fmt(e.budgetTris)} > Vertragsbudget ${fmt(cb.n)} (${cb.what}) – gezählt wird ${fmt(cb.n)}`);
    res.budget = budget;
    const pct = budget ? (res.tris / budget) * 100 : 0;
    if (pct > 150) bad(`${fmt(res.tris)} △${res.worst ? ' [' + res.worst + ']' : ''} = ${Math.round(pct)} % des Budgets ${fmt(budget)}`);
    else if (pct > 100) meh(`${fmt(res.tris)} △${res.worst ? ' [' + res.worst + ']' : ''} = ${Math.round(pct)} % des Budgets ${fmt(budget)}`);
    lib.buildCache.clear();
  }

  // ---------------------------------------------------------------------------------------------
  // Ausgabe
  // ---------------------------------------------------------------------------------------------
  console.log(`\nAsset-Prüfung gegen ${USE_VW ? 'Voxelwerk ' + SRC : 'public/voxel'} – ${man.teams.length} Manifeste, ${entries.length} Einträge${TEAM ? ' (Team ' + TEAM + ')' : ''}${FILTER ? ' (Filter ' + FILTER + ')' : ''}`);
  for (const g of general) console.log('  ' + g);
  const W = Math.max(28, ...entries.map((e) => e.id.length)) + 2;
  for (const [team, list] of [...byTeam].sort()) {
    console.log(`\n== ${team} (${list.length})`);
    console.log('   ' + pad('ID', W) + padL('Zust.', 6) + padL('△ max', 9) + padL('Budget', 8) + padL('%', 6) + '  ' + pad('B × T × H (m)', 20) + 'Status');
    for (const r of list) {
      errors += r.err; warnings += r.warn;
      const pct = r.budget ? Math.round((r.tris / r.budget) * 100) : '';
      const st = r.err ? `✗ ${r.err} Fehler` + (r.warn ? `, ${r.warn} Warn.` : '') : r.warn ? `! ${r.warn} Warn.` : '✓';
      const dims = r.dims ? r.dims.map((d) => d.toFixed(2)).join(' × ') : '–';
      console.log(' ' + (r.err ? '✗' : r.warn ? '!' : '✓') + ' ' + pad(r.id, W) + padL(r.n, 6) + padL(fmt(r.tris), 9) + padL(r.budget ? fmt(r.budget) : '–', 8) + padL(pct, 6) + '  ' + pad(dims, 20) + st);
      for (const n of r.notes) console.log('       ' + n);
    }
  }

  if (SHOW_MISSING) {
    const have = new Set(man.entries.map((e) => e.id));
    const idx = JSON.parse(await fsp.readFile(path.join(ROOT, 'public', 'voxel', 'index.json'), 'utf8').catch(() => '{}'));
    const missing = new Map();
    const add = (id, what) => { const t = ownerOf(id); if (TEAM && t !== TEAM) return; if (!missing.has(t)) missing.set(t, []); missing.get(t).push(what ? `${id} (${what})` : id); };
    for (const id of Object.keys(EXPECTED)) if (!have.has(id)) add(id);
    for (const id of Object.keys(EXPECTED_FIGURES)) if (!have.has(id)) add(id, 'Figur');
    for (const [kind, ids] of Object.entries(EXPECTED_OTHER)) for (const id of ids) {
      const there = USE_VW ? fs.existsSync(path.join(SRC, 'assets', kind, id + '.json')) : (idx[kind] || []).includes(id);
      if (!there) add(id, kind === 'moods' ? 'Stimmung' : 'Palette');
    }
    const total = [...missing.values()].reduce((s, l) => s + l.length, 0);
    const all = Object.keys(EXPECTED).length + Object.keys(EXPECTED_FIGURES).length;
    console.log(`\n== Fehlende IDs aus §3.3/§3.4/§3.6 (noch kein Fehler): ${total} – Manifest-Abdeckung ${all - [...missing.values()].flat().filter((s) => !/\((Stimmung|Palette)\)$/.test(s)).length}/${all}`);
    for (const [team, ids] of [...missing].sort()) console.log(`   ${pad(team, 7)} ${ids.length}: ${ids.join(', ')}`);
  }

  console.log(`\n${errors ? '✗' : '✓'} ${errors} Fehler, ${warnings} Warnungen · ${Math.round(performance.now() - t0)} ms`);
  process.exit(errors ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
