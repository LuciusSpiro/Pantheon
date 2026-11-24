#!/usr/bin/env node
'use strict';
// SCH-02 Pflichttest: Rom-Schiff hat fuer jede Ankerrolle, die ein Schiff braucht, ein roemisches Modell.
//   node tools/test-rom-schiff.js
// Die Rollenliste ist NICHT von Hand gefuehrt, sie kommt aus drei Quellen (Vereinigung):
//   (1) shared/gen-schiff.js PFLICHT (erzeuger().PFLICHT): was der Generator je Karte mindestens setzt,
//   (2) content/katalog/molekuele/*.json: buehne_braucht.anker und .min jeder Umsetzung, deren kartenarten schiff enthalten (was der Katalog dem Spielleiter anbietet),
//   (3) tatsaechlich erzeugte Anker (Stichprobe karteRoh, layout rechteck und schiff, alle Zustaende): Rollen, Fallentypen, Platztypen der Ziele.
// Fuer jede Rolle liefert ankerEintragVon(bauweise rom, rolle, 'schiff', platzTyp, typ) (public/js/voxel/kit-regeln.js) ein Modell, das
//   (a) nicht unter /ruine/ liegt (Ruinen-Rueckfall '*'), (b) nicht unter /germanen/ liegt (germanische Bake o. ae.), (c) im Manifest (public/voxel/manifest.json) existiert.
// ziel: je erzeugtem Platztyp (bruecke, reaktor, batteriedeck, sektion -> '*', Laderaum) ein EIGENES Modell (Abnahme SCH-02 Nr. 3).
// Rollen OHNE Anker-Prop sind unten in OHNE_PROP mit Grund benannt. Jede andere Rolle ohne roemisches Modell ist rot: bekommt Generator oder Katalog eine neue Rolle,
// die Rom nicht abdeckt, wird dieser Test rot (Selbstprobe am Ende mit einer erfundenen Rolle).
// Schritt der Kette (tools/testliste.json, Stufe fast).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, ''));
const GenSchiff = require('../shared/gen-schiff.js');

// Rollen, die im Schiff bewusst KEIN Anker-Prop bekommen (jede mit Grund; neue Eintraege nur mit Begruendung)
const OHNE_PROP = {
  eingang: 'Schleuse/Tuer ist Kit (Kachelart), kein Anker-Prop',
  nsc: 'Figur (Besatzung/Gefangene), kein Prop',
  wache: 'Gegner-Figur, kein Prop',
  patrouille: 'Gegner-Wegpunkte der Karte, kein Prop',
};

function rollenQuellen() {
  const gen = GenSchiff.erzeuger();
  const pflicht = Object.keys(gen.PFLICHT);
  const katalog = new Set();
  const dir = path.join(ROOT, 'content/katalog/molekuele');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const u of rd('content/katalog/molekuele/' + f).umsetzungen || []) {
      const b = u && u.buehne_braucht;
      if (!b || !(b.kartenarten || []).includes('schiff')) continue;
      for (const a of b.anker || []) katalog.add(typeof a === 'string' ? a : a && a.rolle);
      for (const r of Object.keys(b.min || {})) katalog.add(r);
    }
  }
  const erzeugt = new Set(), falle = new Set(), zielPlatz = new Set();
  for (const layout of ['rechteck', 'schiff']) for (const zustand of ['intakt', 'verfallen', 'umkaempft']) for (let i = 0; i < 8; i++) {
    let roh;
    try { roh = gen.karteRoh(1 + i * 37, { layout, zustand, id: 'test.rom', bauweise: 'rom', besitz: 'rostmeute' }); } catch (e) { continue; }
    for (const a of roh.anker) {
      erzeugt.add(a.rolle);
      if (a.rolle === 'falle' && a.typ) falle.add(a.typ);
      if (a.rolle === 'ziel') { const p = roh.plaetze && roh.plaetze[a.platz]; if (p && p.typ) zielPlatz.add(p.typ); }
    }
  }
  const rollen = new Set([...pflicht, ...katalog, ...erzeugt]);
  rollen.delete(undefined); rollen.delete(null);
  return { rollen: [...rollen].sort(), pflicht, katalog: [...katalog].sort(), erzeugt: [...erzeugt].sort(), falle: [...falle].sort(), zielPlatz: [...zielPlatz].sort() };
}

(async () => {
  const { ankerEintragVon } = await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/kit-regeln.js')).href);
  const bw = rd('content/buehnen/bauweisen/rom.json');
  const manifest = rd('public/voxel/manifest.json').assets;
  const Q = rollenQuellen();

  // pruefeRollen(rollen) -> { n, rot[], ohne[] }
  const pruefeRollen = (rollen) => {
    const rot = [], ohne = [];
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
    const ziele = {};
    for (const rolle of rollen) {
      if (OHNE_PROP[rolle]) { n++; ohne.push(rolle + ' (' + OHNE_PROP[rolle] + ')'); continue; }
      if (rolle === 'ziel') { for (const pt of Q.zielPlatz) ziele[pt] = pruefe('ziel/' + pt, 'ziel', pt); continue; }
      if (rolle === 'falle') { for (const typ of Q.falle) pruefe('falle/' + typ, 'falle', null, typ); if (!Q.falle.length) { n++; rot.push('falle: Generator lieferte keinen Fallentyp'); } continue; }
      pruefe(rolle, rolle, null);
    }
    if (rollen.includes('ziel')) {
      n++;
      const ids = Object.values(ziele).filter(Boolean);
      if (new Set(ids).size !== Q.zielPlatz.length) rot.push('ziel: ' + Q.zielPlatz.length + ' Plaetze (' + Q.zielPlatz.join(', ') + ') brauchen ebenso viele verschiedene Modelle, gefunden ' + new Set(ids).size + ' (' + ids.join(', ') + ')');
    }
    return { n, rot, ohne };
  };

  const R = pruefeRollen(Q.rollen);
  let n = R.n;
  const rot = R.rot.slice();
  console.log('  Rollen (Generator PFLICHT + Katalog schiff + erzeugte Anker): ' + Q.rollen.join(', '));
  console.log('  Fallentypen: ' + Q.falle.join(', ') + ' | Ziel-Platztypen: ' + Q.zielPlatz.join(', '));
  console.log('  bewusst ohne Anker-Prop: ' + (R.ohne.join('; ') || '-'));
  // Quellen muessen etwas liefern, sonst prueft der Test ins Leere
  n++; if (Q.pflicht.length < 8 || Q.katalog.length < 4 || Q.erzeugt.length < 8 || Q.zielPlatz.length < 4 || Q.falle.length < 3) rot.push('Rollenquellen zu leer: PFLICHT ' + Q.pflicht.length + ', Katalog ' + Q.katalog.length + ', erzeugt ' + Q.erzeugt.length + ', Ziel-Platztypen ' + Q.zielPlatz.length + ', Fallentypen ' + Q.falle.length);
  // Selbstprobe: eine neue Rolle, die Rom nicht abdeckt, muss rot werden (Generator/Katalog-Erweiterung wuerde genauso auffallen)
  n++; { const t = pruefeRollen([...Q.rollen, 'geschuetzturm_neu']); if (!t.rot.some((r) => /^geschuetzturm_neu/.test(r))) rot.push('Selbstprobe: erfundene Rolle wurde nicht rot'); }

  console.log(`Rom-Schiff Pflichtanker: ${n - rot.length}/${n} gruen`);
  for (const r of rot) console.log('  ROT ' + r);
  process.exit(rot.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
