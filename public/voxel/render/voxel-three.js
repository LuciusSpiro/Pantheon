// three.js-Schicht: Meshes aus dem Kern, Instancing, Figuren, Szenen.
import * as THREE from 'three';
import { voxelSize } from '../core/scales.js';
import { meshGrid } from '../core/mesher.js';
import { buildTerrain } from '../core/terrain.js';
import { resolveScene } from '../core/scene.js';

export const MATS = {
  lit: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0 }),
  emit: new THREE.MeshBasicMaterial({ vertexColors: true }),
};

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Netzdaten (Kern) → BufferGeometry. Farben werden nach linear umgerechnet. */
function toGeometry(buf) {
  if (!buf.indices.length) return null;
  const geo = new THREE.BufferGeometry();
  const col = new Float32Array(buf.colors.length);
  for (let i = 0; i < col.length; i++) col[i] = srgbToLinear(Math.min(buf.colors[i], 1)) * (buf.colors[i] > 1 ? buf.colors[i] : 1);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(buf.indices, 1));
  return geo;
}

const geoCache = new WeakMap();
/** Geometrien eines gebauten Modells (in Metern, Anker im Ursprung). */
export function geometriesOf(built, mirrorX = false) {
  let per = geoCache.get(built);
  if (!per) geoCache.set(built, (per = {}));
  const k = mirrorX ? 'm' : 'n';
  if (per[k]) return per[k];
  let mesh = built.mesh;
  if (mirrorX) {
    // Spiegeln an der Ebene x = 0 (Figurenteile links ↔ rechts)
    const g = built.grid, mg = new g.constructor();
    for (const v of g.values()) mg.set(-v.x - 1, v.y, v.z, v.c, v.e);
    mesh = meshGrid(mg);
  }
  const s = voxelSize(built.tier), a = built.anchor;
  const fix = (geo) => { if (geo) { geo.translate(mirrorX ? a[0] : -a[0], -a[1], -a[2]); geo.scale(s, s, s); geo.computeBoundingSphere(); } return geo; };
  // Beim Spiegeln liegt der Anker bei −a.x
  per[k] = { lit: fix(toGeometry(mesh.lit)), emit: fix(toGeometry(mesh.emit)), voxels: built.grid.size };
  return per[k];
}

/** Einzelnes Modell als Group (lit + emit). */
export function modelObject(lib, id, opts = {}) {
  const built = lib.build(id, opts);
  const g = geometriesOf(built, opts.mirrorX);
  const grp = new THREE.Group(); grp.name = id;
  if (g.lit) { const m = new THREE.Mesh(g.lit, MATS.lit); m.castShadow = opts.castShadow !== false; m.receiveShadow = true; grp.add(m); }
  if (g.emit) { const m = new THREE.Mesh(g.emit, MATS.emit); m.userData.bloom = true; grp.add(m); }
  grp.userData.voxels = g.voxels;
  return grp;
}

// ---------------------------------------------------------------------------------------------
// Figuren
// ---------------------------------------------------------------------------------------------
const D2R = Math.PI / 180;
/** Baut eine Figur aus Rig + Teilen. Rückgabe { root, joints, rig, poses, phase } */
export function figureObject(lib, figId, opts = {}) {
  const fig = lib.get('figures', figId);
  if (!fig) throw new Error(`Figur "${figId}" nicht geladen`);
  const rig = lib.get('rigs', fig.rig);
  if (!rig) throw new Error(`Rig "${fig.rig}" nicht geladen`);
  const s = voxelSize(rig.tier || 'detail');
  const root = new THREE.Group(); root.name = figId;
  const joints = {};
  let voxels = 0;
  // Gelenke anlegen (Eltern zuerst)
  const order = [], seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return; const j = rig.joints[name];
    if (!j) throw new Error(`Rig ${rig.id}: Gelenk "${name}" fehlt`);
    if (j.parent) visit(j.parent);
    seen.add(name); order.push(name);
  };
  Object.keys(rig.joints).forEach(visit);
  for (const name of order) {
    const j = rig.joints[name], obj = new THREE.Group(); obj.name = name;
    const pa = j.parent ? rig.joints[j.parent].at : [0, 0, 0];
    obj.position.set((j.at[0] - pa[0]) * s, (j.at[1] - pa[1]) * s, (j.at[2] - pa[2]) * s);
    obj.userData.rest = obj.position.clone();
    (j.parent ? joints[j.parent] : root).add(obj);
    joints[name] = obj;
  }
  const palette = opts.palette || fig.palette;
  const colors = { ...(fig.colors || {}), ...(opts.colors || {}) };
  // Teile: in Figur-Koordinaten modelliert, Anker [0,0,0] → um die Gelenkposition verschieben
  for (const [jn, part] of Object.entries(fig.parts || {})) {
    const joint = joints[jn]; if (!joint) throw new Error(`Figur ${figId}: Gelenk "${jn}" gibt es im Rig ${rig.id} nicht`);
    const o = modelObject(lib, part.model, { params: lib.partParams(part.model, fig.params, part.params), palette: part.palette || palette, colors, mirrorX: !!part.mirror });
    const at = rig.joints[jn].at;
    o.position.set(-at[0] * s, -at[1] * s, -at[2] * s);
    o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    joint.add(o); voxels += o.userData.voxels;
  }
  for (const [jn, a] of Object.entries({ ...(fig.attach || {}), ...(opts.attach || {}) })) {
    if (!a) continue;
    const joint = joints[jn]; if (!joint) throw new Error(`Figur ${figId}: Anbaupunkt "${jn}" fehlt im Rig`);
    const o = modelObject(lib, a.model, { params: lib.partParams(a.model, fig.params, a.params), palette: a.palette || palette, colors, mirrorX: !!a.mirror });
    if (a.rot) o.rotation.set(a.rot[0] * D2R, a.rot[1] * D2R, a.rot[2] * D2R);
    if (a.offset) o.position.set(a.offset[0] * s, a.offset[1] * s, a.offset[2] * s);
    joint.add(o); voxels += o.userData.voxels;
  }
  root.userData.voxels = voxels;
  const poses = rig.poses ? lib.get('poses', rig.poses)?.poses || {} : {};
  return { root, joints, rig, poses, phase: opts.phase ?? Math.random() * 6, s };
}

/** Pose anwenden. Pose = { joints: { name: [rx,ry,rz] Grad }, lift: Voxel, breathe: 0..1 } */
export function applyPose(f, poseName, t = 0) {
  const p = f.poses[poseName] || f.poses.stand || { joints: {} };
  for (const [name, obj] of Object.entries(f.joints)) {
    obj.rotation.set(0, 0, 0);
    obj.position.copy(obj.userData.rest);
  }
  for (const [name, r] of Object.entries(p.joints || {})) {
    const obj = f.joints[name]; if (!obj) continue;
    obj.rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ');
  }
  const br = Math.sin(t * 2.0 + f.phase) * (p.breathe ?? 0.5);
  if (f.joints.hips) f.joints.hips.position.y += ((p.lift ?? 0) + br * 0.25) * f.s;
  if (f.joints.torso) f.joints.torso.rotation.x += br * 0.012;
  if (f.joints.head && p.look !== false) f.joints.head.rotation.y += Math.sin(t * 0.45 + f.phase * 2) * 0.12;
}

// ---------------------------------------------------------------------------------------------
// Szenen
// ---------------------------------------------------------------------------------------------
/** Baut eine Szene. Wiederholte Modelle werden instanziert. Rückgabe { group, figures, stats, info } */
export function sceneObject(lib, sceneId) {
  const scene = lib.get('scenes', sceneId);
  if (!scene) throw new Error(`Szene "${sceneId}" nicht geladen`);
  const group = new THREE.Group(); group.name = sceneId;
  const stats = { voxels: 0, instances: 0, models: 0 };
  const res = resolveScene(scene, lib);

  if (scene.terrain) {
    const pal = lib.palette(scene.terrain.palette || scene.palette || 'base');
    const { grid } = buildTerrain(scene.terrain, pal, scene.seed ?? 0);
    const g = geometriesOf({ grid, anchor: [0, 0, 0], tier: 'terrain', mesh: meshGrid(grid) });
    const m = new THREE.Mesh(g.lit, MATS.lit); m.receiveShadow = true; m.castShadow = true; m.name = 'terrain';
    group.add(m); stats.voxels += grid.size;
  }

  // Platzierungen nach gebautem Modell gruppieren → InstancedMesh
  const byBuild = new Map();
  for (const p of res.placements) {
    const built = lib.build(p.model, { params: p.params, palette: p.palette, colors: p.colors });
    let e = byBuild.get(built); if (!e) byBuild.set(built, (e = { built, list: [], id: p.model }));
    e.list.push(p);
  }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  for (const { built, list, id } of byBuild.values()) {
    const g = geometriesOf(built);
    stats.models++; stats.instances += list.length; stats.voxels += g.voxels * list.length;
    for (const [geo, mat, shadow] of [[g.lit, MATS.lit, true], [g.emit, MATS.emit, false]]) {
      if (!geo) continue;
      if (list.length === 1) {
        const m = new THREE.Mesh(geo, mat); const p = list[0];
        m.position.set(...p.pos); m.rotation.y = p.rot * D2R; m.castShadow = shadow; m.receiveShadow = shadow; m.name = id;
        group.add(m);
      } else {
        const im = new THREE.InstancedMesh(geo, mat, list.length); im.name = id;
        list.forEach((p, i) => { Q.setFromAxisAngle(UP, p.rot * D2R); V.set(...p.pos); M.compose(V, Q, S); im.setMatrixAt(i, M); });
        im.castShadow = shadow; im.receiveShadow = shadow; im.computeBoundingSphere();
        group.add(im);
      }
    }
  }

  const figures = [];
  for (const f of res.figures) {
    const fo = figureObject(lib, f.figure, { palette: f.palette, colors: f.colors, attach: f.attach });
    fo.root.position.set(...f.pos); fo.root.rotation.y = f.rot * D2R;
    fo.pose = f.pose || 'stand';
    applyPose(fo, fo.pose, 0);
    group.add(fo.root); figures.push(fo); stats.voxels += fo.root.userData.voxels;
  }
  return { group, figures, stats, info: res.info, scene };
}
