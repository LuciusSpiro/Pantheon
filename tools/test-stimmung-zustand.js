#!/usr/bin/env node
'use strict';
// SCH-02 C1: Stimmung je Zustand (public/js/voxel/stimmung.js stimmungFuerZustand).
//   node tools/test-stimmung-zustand.js
// 1. Testbauweise (Fixture): der Schluessel "<art>:<zustand>" gewinnt vor "<art>"; ohne ihn gilt "<art>"; Hoehle und Wildnis-Boden unberuehrt.
// 2. Bestand: fuer jede Bauweisen-Datei, Kartenart, Bodenton und jeden Zustand liefert stimmungFuerZustand dasselbe wie stimmungVon (Zustandsschluessel im Bestand nur schiff:verfallen/schiff:umkaempft in rom.json, SCH-02 C2).
// 3. Verdrahtung: kit.js ruft stimmungFuerZustand mit k.zustand auf und nicht mehr stimmungVon direkt.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };

(async () => {
  const S = await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/stimmung.js')).href);
  const ZUSTAENDE = ['intakt', 'verfallen', 'umkaempft'];

  console.log('[Fixture-Bauweise]');
  const fix = { schiff: 'ship_a', 'schiff:verfallen': 'ship_a_verfallen', 'schiff:umkaempft': 'ship_a_umkaempft', ruine: 'ruin_a', wildnis: 'w_gras', 'wildnis:wueste': 'w_wueste', hoehle: 'x' };
  ok(S.stimmungFuerZustand(fix, 'schiff', null, 'verfallen') === 'ship_a_verfallen', 'schiff:verfallen gewinnt');
  ok(S.stimmungFuerZustand(fix, 'schiff', null, 'umkaempft') === 'ship_a_umkaempft', 'schiff:umkaempft gewinnt');
  ok(S.stimmungFuerZustand(fix, 'schiff', null, 'intakt') === 'ship_a', 'intakt ohne Zustandsschluessel: schiff');
  ok(S.stimmungFuerZustand(fix, 'schiff', null, undefined) === 'ship_a' && S.stimmungFuerZustand(fix, 'schiff', null, null) === 'ship_a', 'ohne Zustand: schiff');
  ok(S.stimmungFuerZustand(fix, 'ruine', null, 'verfallen') === 'ruin_a', 'andere Art ohne Zustandsschluessel: unveraendert');
  ok(S.stimmungFuerZustand(fix, 'wildnis', 'wueste', 'verfallen') === 'w_wueste' && S.stimmungFuerZustand(fix, 'wildnis', 'gras', 'umkaempft') === 'w_gras', 'Wildnis: Bodenton wie zuvor');
  ok(S.stimmungFuerZustand(fix, 'hoehle', null, 'verfallen') === 'x' && S.stimmungFuerZustand({}, 'hoehle', null, 'verfallen') === 'hoehle', 'Hoehle: ein Eintrag');
  ok(S.stimmungFuerZustand(null, 'schiff', null, 'verfallen') === null && S.stimmungFuerZustand({}, 'schiff', null, 'verfallen') === null, 'ohne Tabelle: null');
  ok(S.stimmungFuerZustand({ 'schiff:verfallen': 'v' }, 'schiff', null, 'intakt') === null, 'nur Zustandsschluessel: intakt faellt auf null (Zonenstimmung)');

  console.log('[Bestand unveraendert]');
  const dir = path.join(ROOT, 'content', 'buehnen', 'bauweisen');
  const ARTEN = ['aussenposten', 'station', 'schiff', 'ruine', 'wildnis', 'hoehle', 'gelaende', 'hand', 'unbekannt'];
  const BOEDEN = [null, undefined, 'wueste', 'gras', 'vulkan', 'erde'];
  let faelle = 0, abweich = 0;
  const zustandsKeys = {};   // Datei -> Schluessel "<art>:<zustand>"
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '')).stimmung || {};
    for (const k of Object.keys(t)) if (ZUSTAENDE.some((z) => k.endsWith(':' + z))) (zustandsKeys[f] = zustandsKeys[f] || []).push(k);
    for (const art of ARTEN) for (const b of BOEDEN) for (const z of ZUSTAENDE.concat([undefined])) {
      if ((zustandsKeys[f] || []).includes(art + ':' + z)) continue;   // Absicht: dieser Zustandsschluessel gewinnt (Rom-Schiff, SCH-02 C2)
      faelle++; if (S.stimmungFuerZustand(t, art, b, z) !== S.stimmungVon(t, art, b)) abweich++;
    }
  }
  // Einziger Bestands-Zustandsschluessel: schiff:verfallen und schiff:umkaempft in rom.json (SCH-02 C2)
  const erlaubt = { 'rom.json': ['schiff:verfallen', 'schiff:umkaempft'] };
  const unerwartet = Object.keys(zustandsKeys).filter((f) => JSON.stringify(zustandsKeys[f].slice().sort()) !== JSON.stringify((erlaubt[f] || []).slice().sort()) );
  ok(unerwartet.length === 0 && Object.keys(zustandsKeys).length === 1, 'Zustandsschluessel "<art>:<zustand>" nur in rom.json (schiff:verfallen, schiff:umkaempft)' + (unerwartet.length ? ' – abweichend: ' + unerwartet.join(', ') : ''));
  ok(faelle > 500 && abweich === 0, `${faelle} Bestandsfaelle ohne diese Schluessel: stimmungFuerZustand == stimmungVon (${abweich} Abweichungen)`);

  console.log('[Verdrahtung]');
  const kit = fs.readFileSync(path.join(ROOT, 'public/js/voxel/kit.js'), 'utf8');
  ok(/stimmungFuerZustand\(BW\.stimmung, k\.art, k\.boden, k\.zustand\)/.test(kit) && !/[^A-Za-z]stimmungVon\(/.test(kit), 'kit.js: stimmungFuerZustand(BW.stimmung, k.art, k.boden, k.zustand)');

  console.log(`\n${n - bad}/${n} ok${bad ? ', ' + bad + ' FEHLER' : ''}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
