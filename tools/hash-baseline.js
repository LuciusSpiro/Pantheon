#!/usr/bin/env node
// ORT-01: Byte-Gleichheit der Generatorkarten und der Deko-Streuung gegen eine eingefrorene Baseline (main 6d912b4).
//
//   node tools/hash-baseline.js --compare    vergleicht mit tools/fixtures/ort01-hash-baseline.json (Exit 1 bei Abweichung)
//   node tools/hash-baseline.js --write      schreibt die Baseline neu (nur auf einem Stand, der als Referenz gelten soll!)
//
// karten: sha1 über JSON.stringify(Karte) für alle festen Generator-Landepunkte (Außenposten, Station) und je 10 Seeds
//   Außenposten/Station (germanen) für rostmeute, kontor, konkordat (72 Hashes).
// deko: sha1 über die Deko-Liste (public/js/voxel/deko.js streuen, genau wie kit.js: deckung_props-Filter, Besitz-Streuung,
//   mit den produktiven Rollen-Dateien content/buehnen/rollen/<art>.json, falls vorhanden) für 10 Seeds je Kartenart und
//   Besitz. Solange die produktiven Rollen-Dateien keine Raumtypen enthalten, muss die Streuung byte-gleich bleiben.
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const DATEI = path.join(ROOT, 'tools', 'fixtures', 'ort01-hash-baseline.json');
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

async function berechne() {
  process.chdir(ROOT);
  const LP = require(path.join(ROOT, 'server/sim/landepunkte.js'));
  const Buehne = require(path.join(ROOT, 'shared/buehne.js'));
  const GS = require(path.join(ROOT, 'shared/gen-siedlung.js'));
  const GT = require(path.join(ROOT, 'shared/gen-station.js'));
  const { streuen } = await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/deko.js')).href);
  const kacheln = json(path.join(ROOT, 'content/buehnen/kacheln.json'));
  const BW = path.join(ROOT, 'content/buehnen');

  const karten = {};
  const g = { seed: 7 };
  for (const list of Object.values(LP.defs().orte)) for (const d of list) {
    if (!['aussenposten', 'station'].includes(d.art)) continue;
    karten[d.id] = sha(JSON.stringify(LP.karte(g, d.id)));
  }
  for (const art of ['aussenposten', 'station']) for (const besitz of ['rostmeute', 'kontor', 'konkordat']) for (let s = 1; s <= 10; s++) {
    const gg = { seed: 7 };
    const id = LP.neu(gg, 'kesh', { art, besitz, bauweise: 'germanen', seed: s * 977 });
    karten[`${art}/germanen/${besitz}/${s * 977}`] = sha(JSON.stringify(LP.karte(gg, id)));
  }

  const deko = {};
  const dekoRegeln = json(path.join(BW, 'deko/germanen.json'));
  const bauweise = json(path.join(BW, 'bauweisen/germanen.json'));
  for (const art of ['station', 'aussenposten']) {
    const rf = path.join(BW, 'rollen', art + '.json');
    const rollen = fs.existsSync(rf) ? json(rf) : null;
    for (const besitz of ['rostmeute', 'kontor', 'konkordat']) {
      const extra = (json(path.join(BW, 'paletten', besitz + '.json')).streu) || [];
      for (let s = 1; s <= 10; s++) {
        const roh = art === 'station'
          ? GT.erzeuger(96, 56).karteRoh(s, 8, { bauweise: 'germanen', besitz, zustand: 'intakt', id: 't' })
          : GS.erzeuger(130, 90).karteRoh(s, 10, { bauweise: 'germanen', typ: 'handel', besitz, zustand: 'intakt', id: 't' });
        const k = Buehne.ausRaster(roh, { spiel: true }).karte;
        const kindAt = (x, y) => { const c = (k.rows[y] || '')[x]; return c == null || c === '' ? null : kacheln.zeichen[c] ? kacheln.zeichen[c].kind : null; };
        const plaetze = Object.keys(k.plaetze).sort().map((id) => { const p = k.plaetze[id]; return { id, typ: p.typ, x: p.rect[0], y: p.rect[1], w: p.rect[2], h: p.rect[3] }; });
        const dp = bauweise.deckung_props && bauweise.deckung_props[k.art];
        const deckIds = new Set(dp ? Object.values(dp).flat() : []);
        let regeln = dekoRegeln;
        if (deckIds.size) { regeln = Object.assign({}, dekoRegeln, { regeln: {} }); for (const [t, r] of Object.entries(dekoRegeln.regeln)) regeln.regeln[t] = Object.assign({}, r, { props: r.props.filter((i) => !deckIds.has(i)) }); }
        const opts = { extra };
        if (rollen) opts.rollen = { daten: rollen, bauweise: 'germanen', ausschluss: deckIds };
        const liste = streuen({ id: 't', w: k.w, h: k.h, seed: k.seed, art: k.art, kindAt, anker: k.anker, plaetze }, regeln, opts);
        deko[`${art}/germanen/${besitz}/${s}`] = sha(JSON.stringify(liste));
      }
    }
  }
  return { karten, deko };
}

(async () => {
  const modus = process.argv.includes('--write') ? 'write' : 'compare';
  const ist = await berechne();
  if (modus === 'write') {
    fs.writeFileSync(DATEI, JSON.stringify({ format: 'ort01-hash-baseline/1', stand: 'main 6d912b4', karten: ist.karten, deko: ist.deko }, null, 1) + '\n');
    console.log(`Baseline geschrieben: ${Object.keys(ist.karten).length} Karten-Hashes, ${Object.keys(ist.deko).length} Deko-Hashes -> ${path.relative(ROOT, DATEI)}`);
    return;
  }
  const soll = json(DATEI);
  let fehler = 0;
  for (const teil of ['karten', 'deko']) {
    const ab = [];
    for (const k of Object.keys(soll[teil])) if (soll[teil][k] !== ist[teil][k]) ab.push(k);
    for (const k of Object.keys(ist[teil])) if (!(k in soll[teil])) ab.push(k + ' (neu)');
    const n = Object.keys(soll[teil]).length;
    console.log(`${ab.length ? '✗' : '✓'} ${teil}: ${n - ab.length}/${n} gleich${ab.length ? ', abweichend: ' + ab.slice(0, 8).join(', ') + (ab.length > 8 ? ' …' : '') : ''}`);
    fehler += ab.length;
  }
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
