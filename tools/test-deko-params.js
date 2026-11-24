#!/usr/bin/env node
'use strict';
// SCH-02 C3: Deko-Regeln mit Parametern. Ein props-Eintrag ist eine ID oder { id, params, gewicht } (public/js/voxel/deko.js).
//   node tools/test-deko-params.js
// Prueft: (a) Objekt-Eintrag wird zu id + params aufgeloest, gewicht zaehlt als Lose, (b) reine String-Regeln liefern dieselbe Liste wie
// vorher (kein params-Feld), (c) die Streuung ist deterministisch, (d) der Geometrie-Cache von kit.js trennt die Parameter (Schluessel
// enthaelt params, Modell baut je kind verschieden), (e) jede Rom-Schiff-Deko-ID/kind steht im Manifest und ist hoechstens 0,3 m hoch
// (Bodendeko ohne Kollision muss ueberschreitbar sein, Kai 2026-11-23; kind 4 und 7 bewusst nicht).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, ''));
const MAX_H = 0.3;
const VERBOTEN_KIND = new Set([4, 7]);   // Werkzeugkiste, Eimer: 4 Voxel = 0,25 m, Kai will nur flache Stuecke

(async () => {
  process.chdir(ROOT);
  const rot = []; let n = 0;
  const ok = (bed, msg) => { n++; if (!bed) rot.push(msg); };
  const { streuen } = await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/deko.js')).href);
  const GenSchiff = require(path.join(ROOT, 'shared/gen-schiff.js'));
  const Buehne = require(path.join(ROOT, 'shared/buehne.js'));
  const kacheln = rd('content/buehnen/kacheln.json');
  const roh = GenSchiff.erzeuger().karteRoh(3, { layout: 'schiff', zustand: 'intakt', id: 't', bauweise: 'rom', besitz: 'rostmeute' });
  const k = Buehne.ausRaster(roh, { spiel: true }).karte;
  const kindAt = (x, y) => { const c = (k.rows[y] || '')[x]; return c == null || c === '' ? null : kacheln.zeichen[c] ? kacheln.zeichen[c].kind : null; };
  const plaetze = Object.keys(k.plaetze).sort().map((id) => { const p = k.plaetze[id]; return { id, typ: p.typ, x: p.rect[0], y: p.rect[1], w: p.rect[2], h: p.rect[3] }; });
  const karte = { id: 't', w: k.w, h: k.h, seed: k.seed, art: k.art, stride: k.stride, kindAt, anker: k.anker || [], plaetze };
  const D = 'lerche/furn/floor_decal';
  const regel = (props) => { const r = {}; for (const t of ['antrieb', 'reaktor', 'batteriedeck', 'sektion']) r[t] = { props, dichte: [1, 3], wandnah: false, frei_halten: 1 }; return { regeln: r }; };

  // (a) Objekt-Eintrag
  const liste = streuen(karte, regel([{ id: D, params: { kind: 3 }, gewicht: 2 }, { id: D, params: { kind: 5 } }]), { extra: [] });
  ok(liste.length > 0, 'Objekt-Regel streut nichts');
  ok(liste.every((d) => d.id === D && d.params && (d.params.kind === 3 || d.params.kind === 5)), 'Objekt-Eintrag nicht zu id + params aufgeloest');
  const k3 = liste.filter((d) => d.params.kind === 3).length, k5 = liste.length - k3;
  ok(k3 > 0 && k5 > 0 && k3 > k5, `gewicht 2 nicht wirksam (kind3 ${k3}, kind5 ${k5})`);
  // (b) String-Regel: kein params-Feld, gleiche Orte wie ein Objekt-Eintrag ohne Gewicht (gleiche Zufallsfolge)
  const alt = streuen(karte, regel([D]), { extra: [] });
  ok(alt.length > 0 && alt.every((d) => d.id === D && !('params' in d)), 'String-Eintrag bekommt ein params-Feld');
  const neu1 = streuen(karte, regel([{ id: D, params: { kind: 1 } }]), { extra: [] });
  const ort = (l) => JSON.stringify(l.map(({ x, y, rot: r, seed, dx, dz }) => [x, y, r, seed, dx, dz]));
  ok(ort(alt) === ort(neu1), 'Objekt-Eintrag verschiebt die Zufallsfolge (Orte weichen von der String-Regel ab)');
  // (c) deterministisch
  ok(JSON.stringify(liste) === JSON.stringify(streuen(karte, regel([{ id: D, params: { kind: 3 }, gewicht: 2 }, { id: D, params: { kind: 5 } }]), { extra: [] })), 'Streuung nicht deterministisch');

  // (d) Cache-Schluessel in kit.js und Modellbau je kind
  const kit = fs.readFileSync(path.join(ROOT, 'public/js/voxel/kit.js'), 'utf8');
  ok(/const ck = id \+ '\|' \+ JSON\.stringify\(params\)/.test(kit), 'kit.js: Cache-Schluessel enthaelt die Parameter nicht');
  ok(/assetGeo\(dd\.id, Object\.assign\(\{ seed: dd\.seed, zustand: zKit, art: k\.art \}, dd\.params\)\)/.test(kit), 'kit.js: dd.params wird nicht an assetGeo durchgereicht');
  const { Library } = await import(pathToFileURL(path.join(ROOT, 'public/voxel/core/library.js')).href);
  const { voxelSize } = await import(pathToFileURL(path.join(ROOT, 'public/voxel/core/scales.js')).href);
  const SRC = path.join(ROOT, 'public/voxel');
  const lib = new Library({ json: async (p) => JSON.parse(fs.readFileSync(path.join(SRC, p), 'utf8')), binary: async (p) => { const b = fs.readFileSync(path.join(SRC, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
  const manifest = rd('public/voxel/manifest.json').assets;
  const asset = await lib.load('models', D);
  const hoehe = (kind) => { const b = lib.build(D, { params: { kind, seed: 0 } }); const bb = b.grid.bounds(); return { h: (bb.max[1] + 1 - b.anchor[1]) * voxelSize(asset.tier), quads: b.mesh.lit.quads + b.mesh.emit.quads }; };
  const q = new Set([0, 1, 3, 5, 6, 8].map((kd) => hoehe(kd).quads));
  ok(q.size >= 5, 'floor_decal baut fuer verschiedene kind kaum verschiedene Modelle (Quads: ' + [...q].join(',') + ')');

  // (e) Rom-Regeln
  const rom = rd('content/buehnen/deko/rom.json');
  const kinds = new Set();
  for (const t of ['antrieb', 'reaktor', 'batteriedeck', 'sektion']) {
    const props = rom.regeln[t].props;
    ok(props.some((e) => typeof e === 'object'), `Regel ${t}: keine Objekt-Eintraege`);
    ok(new Set(props.map((e) => e.params && e.params.kind)).size >= 4, `Regel ${t}: weniger als 4 verschiedene kind`);
    for (const e of props) {
      const id = typeof e === 'string' ? e : e.id, kd = typeof e === 'string' ? 0 : (e.params && e.params.kind) | 0;
      ok(!!manifest[id], `${t}: ${id} nicht im Manifest`);
      ok(!VERBOTEN_KIND.has(kd), `${t}: kind ${kd} ist verboten (zu hoch)`);
      if (!kinds.has(kd)) { kinds.add(kd); const { h } = hoehe(kd); ok(h <= MAX_H + 1e-9, `kind ${kd}: ${h.toFixed(3)} m > ${MAX_H} m`); }
    }
  }
  ok(rom.regeln.bruecke.props.length === 0, 'Bruecke muss leer bleiben');
  // Rom-Karte streut mit den echten Regeln (ohne Besitz-Streu) nur freigegebene kinds
  const echt = streuen(karte, rom, { extra: [] }).filter((d) => d.id === D);
  ok(echt.length > 0 && echt.every((d) => d.params && !VERBOTEN_KIND.has(d.params.kind)), 'Rom-Karte streut ein verbotenes kind oder Deko ohne params');

  console.log(`Deko-Parameter: ${n - rot.length}/${n} gruen (kinds ${[...kinds].sort().join(',')}, ${echt.length} floor_decal auf Rom Seed 3 ohne Besitz-Streu)`);
  for (const r of rot) console.log('  ROT ' + r);
  process.exit(rot.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
