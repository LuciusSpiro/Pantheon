// Asset-Bibliothek: lädt Modelle, Paletten, Rigs, Figuren, Posen, Stimmungen und Szenen samt
// Abhängigkeiten und baut Modelle (mit Cache). Läuft im Browser (fetch) und in Node (fs) –
// der Zugriff kommt von außen über `io`.
import { buildModel, collectDeps } from './recipe.js';
import { resolvePalette } from './color.js';
import { meshGrid } from './mesher.js';
import { parseVox } from './vox.js';

export const KINDS = ['models', 'palettes', 'rigs', 'figures', 'poses', 'moods', 'scenes'];
export const assetPath = (kind, id) => `assets/${kind}/${id}.json`;

export class Library {
  /** io: { json(path) → Promise<obj>, binary(path) → Promise<ArrayBuffer> } */
  constructor(io) {
    this.io = io;
    this.store = Object.fromEntries(KINDS.map((k) => [k, new Map()]));
    this.vox = new Map();
    this.pending = new Map();
    this.buildCache = new Map();
    this.missing = new Map();   // 'kind:id' → Fehlermeldung (nur optionale Abhängigkeiten aus Vorlagen)
  }

  get(kind, id) { return this.store[kind].get(id); }

  /** Lädt ein Asset (einmalig) und seine Abhängigkeiten. */
  async load(kind, id) {
    const pk = kind + ':' + id;
    if (this.store[kind].has(id)) return this.store[kind].get(id);
    if (this.pending.has(pk)) return this.pending.get(pk);
    const p = (async () => {
      let obj;
      try { obj = await this.io.json(assetPath(kind, id)); }
      catch (e) { throw new Error(`${kind}/${id}: ${e.message}`); }
      if (obj.id !== id) throw new Error(`${assetPath(kind, id)}: Feld "id" ist "${obj.id}", erwartet "${id}"`);
      this.store[kind].set(id, obj);
      await this.loadDeps(kind, obj);
      return obj;
    })();
    this.pending.set(pk, p);
    try { return await p; } finally { this.pending.delete(pk); }
  }

  /** Ein Asset neu laden (z. B. nach dem Speichern im Editor). */
  async reload(kind, id) {
    this.store[kind].delete(id);
    this.buildCache.clear();
    return this.load(kind, id);
  }

  /** Ein Asset direkt aus einem Objekt übernehmen (Editor-Vorschau ohne Speichern). */
  async put(kind, obj) {
    this.store[kind].set(obj.id, obj);
    this.buildCache.clear();
    await this.loadDeps(kind, obj);
  }

  async loadDeps(kind, obj) {
    const jobs = [];
    const need = (k, id) => id && jobs.push(this.load(k, id));
    if (kind === 'palettes') need('palettes', obj.extends);
    if (kind === 'models') {
      const d = collectDeps(obj);
      d.models.forEach((m) => need('models', m));
      d.optional.forEach((m) => jobs.push(this.loadOptional('models', m)));
      d.palettes.forEach((p) => need('palettes', p));
      d.vox.forEach((f) => jobs.push(this.loadVox(f)));
    }
    if (kind === 'figures') {
      need('rigs', obj.rig); need('palettes', obj.palette);
      for (const part of Object.values(obj.parts || {})) { need('models', part.model); need('palettes', part.palette); }
      for (const a of Object.values(obj.attach || {})) { need('models', a.model); need('palettes', a.palette); }
    }
    if (kind === 'rigs' && obj.poses) need('poses', obj.poses);
    if (kind === 'scenes') {
      need('moods', obj.mood); need('palettes', obj.palette);
      if (obj.terrain?.palette) need('palettes', obj.terrain.palette);
      for (const pl of obj.place || []) { need('models', pl.model); need('palettes', pl.palette); }
      for (const f of obj.figures || []) need('figures', f.figure);
      for (const sc of obj.scatter || []) { for (const m of [].concat(sc.model)) need('models', m); need('palettes', sc.palette); }
    }
    await Promise.all(jobs);
  }

  /** Wie load, aber ein Fehlen ist kein Fehler (Vorlagen-Kandidaten). Liefert das Asset oder undefined. */
  async loadOptional(kind, id) {
    const k = kind + ':' + id;
    if (this.store[kind].has(id)) return this.store[kind].get(id);
    try { const obj = await this.load(kind, id); this.missing.delete(k); return obj; }
    catch (e) { this.missing.set(k, e.message); return undefined; }
  }

  /** Vorlagen-Kombinationen eines geladenen Modells, für die kein Kandidat (auch kein Fallback) geladen ist. */
  templateGaps(id) {
    const model = this.get('models', id);
    if (!model) throw new Error(`Modell "${id}" nicht geladen`);
    const gaps = [];
    for (const t of collectDeps(model).templates) {
      for (const c of t.combos) {
        if (c.ids.some((m) => this.get('models', m))) continue;
        const vals = Object.entries(c.values).map(([k, v]) => `${k}=${v}`).join(', ');
        gaps.push(`Vorlage "${t.template}"${vals ? ' mit ' + vals : ''}: kein Modell vorhanden (versucht: ${c.ids.join(', ')})`);
      }
    }
    return gaps;
  }

  async loadVox(file) {
    if (this.vox.has(file)) return;
    const buf = await this.io.binary(`assets/${file}`);
    this.vox.set(file, parseVox(buf));
  }

  /** Figur-Parameter + Teil-Parameter; gemeinsame Figur-Parameter nur, wenn das Teilmodell sie kennt. */
  partParams(modelId, figParams, partParams) {
    const decl = this.get('models', modelId)?.params || {}, out = {};
    for (const [k, v] of Object.entries(figParams || {})) if (k in decl || k === 'seed') out[k] = v;
    return { ...out, ...(partParams || {}) };
  }

  palette(id, overrides) {
    return resolvePalette(id, (p) => this.get('palettes', p), overrides);
  }

  /**
   * Baut ein Modell. Ergebnis wird gecacht: { grid, anchor, tier, mesh }.
   * opts: { params, palette, colors }
   */
  build(id, opts = {}) {
    const model = this.get('models', id);
    if (!model) throw new Error(`Modell "${id}" nicht geladen`);
    const palId = opts.palette || model.palette || 'base';
    const ck = JSON.stringify([id, opts.params || {}, palId, opts.colors || null]);
    let hit = this.buildCache.get(ck);
    if (hit) return hit;
    const env = {
      getModel: (m) => this.get('models', m),
      getVox: (f) => this.vox.get(f),
      palette: this.palette(palId, opts.colors),
      resolvePalette: (p, o) => this.palette(p, o),
    };
    const built = buildModel(model, opts.params || {}, env);
    hit = { ...built, mesh: meshGrid(built.grid) };
    this.buildCache.set(ck, hit);
    return hit;
  }
}
