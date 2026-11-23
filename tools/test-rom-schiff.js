#!/usr/bin/env node
'use strict';
// SCH-02 Pflichttest: Rom-Schiff hat fuer jede Pflicht-Ankerrolle der Kartenart schiff ein roemisches Modell.
//   node tools/test-rom-schiff.js
// Fuer jede Rolle liefert ankerEintragVon(bauweise rom, rolle, 'schiff', platzTyp) (public/js/voxel/kit-regeln.js) ein Modell, das
//   (a) nicht unter /ruine/ liegt (Ruinen-Rueckfall '*'), (b) nicht unter /germanen/ liegt (germanische Bake o. ae.), (c) im Manifest (public/voxel/manifest.json) existiert.
// ziel: je Platztyp bruecke, reaktor, batteriedeck und Mittelsektion (sektion -> '*', Laderaum) ein EIGENES Modell (Abnahme SCH-02 Nr. 3).
// Pflichtsatz: shared/gen-schiff.js PFLICHT (eingang, abholpunkt, sprengpunkt, ziel, terminal, zelle, beute, nsc, wache, lift, leiter) ohne eingang/nsc/wache
//   (Eingang hat im Schiff kein Anker-Prop, nsc und wache sind Figuren); dazu falle (Typen schott, druck, schuss).
// Stand SCH-02 C2: gruen (Modelle aus B1/B2 verdrahtet), Schritt der Kette (tools/testliste.json, Stufe fast).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, ''));

(async () => {
  const { ankerEintragVon } = await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/kit-regeln.js')).href);
  const bw = rd('content/buehnen/bauweisen/rom.json');
  const manifest = rd('public/voxel/manifest.json').assets;
  const rot = [];
  let n = 0;
  const pruefe = (name, rolle, platzTyp, typ) => {
    n++;
    const e = ankerEintragVon(bw, rolle, 'schiff', platzTyp, typ);
    const id = e && e.id;
    let grund = null;
    if (!id) grund = 'kein Eintrag (Platzhalter)';
    else if (/\/ruine\//.test(id)) grund = 'Ruinen-Rueckfall ' + id;
    else if (/\/germanen\//.test(id)) grund = 'germanisches Modell ' + id;
    else if (!manifest[id]) grund = 'nicht im Manifest ' + id;
    if (grund) rot.push(name + ': ' + grund);
    return id || null;
  };
  pruefe('terminal', 'terminal', null);
  pruefe('sprengpunkt', 'sprengpunkt', null);
  const ziele = {};
  for (const pt of ['bruecke', 'reaktor', 'batteriedeck', 'sektion']) ziele[pt] = pruefe('ziel/' + pt, 'ziel', pt);
  pruefe('lift', 'lift', null);
  pruefe('leiter', 'leiter', null);
  pruefe('beute', 'beute', null);
  pruefe('zelle', 'zelle', null);
  pruefe('abholpunkt', 'abholpunkt', null);
  for (const typ of ['schott', 'druck', 'schuss']) pruefe('falle/' + typ, 'falle', null, typ);
  n++;
  const ids = Object.values(ziele).filter(Boolean);
  if (new Set(ids).size !== 4) rot.push('ziel: vier Plaetze brauchen vier verschiedene Modelle, gefunden ' + new Set(ids).size + ' (' + ids.join(', ') + ')');

  console.log(`Rom-Schiff Pflichtanker: ${n - rot.length}/${n} gruen`);
  for (const r of rot) console.log('  ROT ' + r);
  process.exit(rot.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
