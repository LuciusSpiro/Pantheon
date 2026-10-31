#!/usr/bin/env node
// ORT-01: Byte-Gleichheit der Generatorkarten und der Deko-Streuung gegen die Baseline tools/fixtures/ort01-hash-baseline.json.
//   karten: unverändert seit main 6d912b4. deko_zellen, deko, layout: Stand ORT-01 Paket 9 (Ersatz der Altstücke in deko/germanen.json, Besitz-Streu ohne Altstücke in Orten, Rom-Deko).
//
//   node tools/hash-baseline.js --compare    vergleicht mit tools/fixtures/ort01-hash-baseline.json (Exit 1 bei Abweichung)
//   node tools/hash-baseline.js --compare --karten   nur die Karten-Hashes (schnell, ohne Browser; hängt in npm test)
//   node tools/hash-baseline.js --compare [--karten] --ohne-zeichen "Y,H,;"   entfernt die genannten Legendenzeichen vor dem Hashen (VOX-01: neue Kachelarten;
//     jede Karte trägt die ganze Legende, neue Zeichen ändern daher jeden Kartenhash). Gleich zur Basis = die Karten sind bis auf diese Legendeneinträge unverändert.
//   node tools/hash-baseline.js --write      schreibt die Baseline neu (nur auf einem Stand, der als Referenz gelten soll!)
//
// karten: sha1 über JSON.stringify(Karte) für alle festen Generator-Landepunkte (Außenposten, Station) und je 10 Seeds
//   Außenposten/Station (germanen) für rostmeute, kontor, konkordat (72 Hashes).
// deko_zellen: Zellenmodus allein (ohne Rollen-Dateien), 60 Hashes, germanen. Stand ORT-01 Paket 9: nicht mehr main 6d912b4 (Regeln und Besitz-Streu der Orte bewusst geändert, Grund im Commit).
// deko / layout: Deko mit den produktiven Rollen-Dateien auf denselben germanischen Karten für BEIDE Bauweisen (120 Hashes); layout = nur Orte,
//   Drehungen, Rollen, Füße ohne Modell-IDs, Rom und Germanen müssen gleich sein (Layout-Parität, `layout-parität`).
// deko (Einzelheiten): sha1 über die Deko-Liste (public/js/voxel/deko.js streuen, genau wie kit.js: deckung_props-Filter, Besitz-Streuung,
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
// --ohne-zeichen "Y,H,;": Liste (Komma getrennt) oder einfach die Zeichen hintereinander; nur Legendeneinträge dieser Zeichen werden vor dem Hashen entfernt
const OHNE = (() => {
  const i = process.argv.indexOf('--ohne-zeichen');
  if (i < 0 || !process.argv[i + 1]) return [];
  const a = process.argv[i + 1];
  return a.includes(',') && a.split(',').every((z) => z.length === 1) ? a.split(',') : Array.from(a);
})();
const kartenHash = (k) => {
  if (!OHNE.length || !k || !k.legende) return sha(JSON.stringify(k));
  const c = JSON.parse(JSON.stringify(k));   // nie die Karte des Generators verändern (Cache)
  for (const z of OHNE) delete c.legende[z];
  return sha(JSON.stringify(c));
};

async function berechne(nurKarten) {
  process.chdir(ROOT);
  const LP = require(path.join(ROOT, 'server/sim/landepunkte.js'));
  const Buehne = require(path.join(ROOT, 'shared/buehne.js'));
  const GS = require(path.join(ROOT, 'shared/gen-siedlung.js'));
  const GT = require(path.join(ROOT, 'shared/gen-station.js'));
  const { streuen, besitzStreuFuerOrt } = nurKarten ? {} : await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/deko.js')).href);
  const kacheln = json(path.join(ROOT, 'content/buehnen/kacheln.json'));
  const BW = path.join(ROOT, 'content/buehnen');

  const karten = {};
  const g = { seed: 7 };
  for (const list of Object.values(LP.defs().orte)) for (const d of list) {
    if (!['aussenposten', 'station'].includes(d.art)) continue;
    karten[d.id] = kartenHash(LP.karte(g, d.id));
  }
  for (const art of ['aussenposten', 'station']) for (const besitz of ['rostmeute', 'kontor', 'konkordat']) for (let s = 1; s <= 10; s++) {
    const gg = { seed: 7 };
    const id = LP.neu(gg, 'kesh', { art, besitz, bauweise: 'germanen', seed: s * 977 });
    karten[`${art}/germanen/${besitz}/${s * 977}`] = kartenHash(LP.karte(gg, id));
  }

  const deko = {}, dekoZellen = {}, layout = {};
  if (nurKarten) return { karten, deko, deko_zellen: dekoZellen, layout };
  const BWS = ['germanen', 'rom'];
  const dekoRegeln = {}, bauweise = {};
  for (const bw of BWS) { dekoRegeln[bw] = json(path.join(BW, 'deko/' + bw + '.json')); bauweise[bw] = json(path.join(BW, 'bauweisen/' + bw + '.json')); }
  for (const art of ['station', 'aussenposten']) {
    const rf = path.join(BW, 'rollen', art + '.json');
    const rollen = fs.existsSync(rf) ? json(rf) : null;
    for (const besitz of ['rostmeute', 'kontor', 'konkordat']) {
      const extra = besitzStreuFuerOrt(art, json(path.join(BW, 'paletten', besitz + '.json')).streu);   // wie kit.js: Altstücke fallen in Orten weg
      for (let s = 1; s <= 10; s++) {
        const roh = art === 'station'
          ? GT.erzeuger(96, 56).karteRoh(s, 8, { bauweise: 'germanen', besitz, zustand: 'intakt', id: 't' })
          : GS.erzeuger(130, 90).karteRoh(s, 10, { bauweise: 'germanen', typ: 'handel', besitz, zustand: 'intakt', id: 't' });
        const k = Buehne.ausRaster(roh, { spiel: true }).karte;
        const kindAt = (x, y) => { const c = (k.rows[y] || '')[x]; return c == null || c === '' ? null : kacheln.zeichen[c] ? kacheln.zeichen[c].kind : null; };
        const plaetze = Object.keys(k.plaetze).sort().map((id) => { const p = k.plaetze[id]; return { id, typ: p.typ, x: p.rect[0], y: p.rect[1], w: p.rect[2], h: p.rect[3] }; });
        // Beide Bauweisen auf DERSELBEN (germanischen) Karte: so zeigt der Vergleich nur, was die Bauweise ändert (Modelle), nicht das Layout
        for (const bw of BWS) {
          const dp = bauweise[bw].deckung_props && bauweise[bw].deckung_props[k.art];
          const deckIds = new Set(dp ? Object.values(dp).flat() : []);
          for (const id of (bauweise[bw].deko_ausschluss && bauweise[bw].deko_ausschluss[k.art]) || []) deckIds.add(id);   // wie kit.js (ORT-01)
          let regeln = dekoRegeln[bw];
          if (deckIds.size) { regeln = Object.assign({}, dekoRegeln[bw], { regeln: {} }); for (const [t, r] of Object.entries(dekoRegeln[bw].regeln)) regeln.regeln[t] = Object.assign({}, r, { props: r.props.filter((i) => !deckIds.has(i)) }); }
          const karteIn = { id: 't', w: k.w, h: k.h, seed: k.seed, art: k.art, kindAt, anker: k.anker, plaetze };
          const key = art + '/' + bw + '/' + besitz + '/' + s;
          // Zellenmodus allein (ohne Rollen), nur germanen: Stand ORT-01 Paket 9 (Kopfkommentar)
          if (bw === 'germanen') dekoZellen[key] = sha(JSON.stringify(streuen(karteIn, regeln, { extra })));
          const opts = { extra };
          if (rollen) opts.rollen = { daten: rollen, bauweise: bw, ausschluss: deckIds, leitFuss: bauweise[bw].leit_fuss };
          const liste = streuen(karteIn, regeln, opts);
          deko[key] = sha(JSON.stringify(liste));
          // Layout der Rollen-Stücke (ohne Besitz-Banner: sie hängen an der Zellen-Obergrenze 12, die vom Zellenmodus der Bauweise abhängt): nur Orte, Drehungen, Versätze, Rollen und Füße, ohne Modell-IDs (Parität Rom ↔ Germanen; der Zellenmodus hat je Bauweise eigene Regeln)
          layout[key] = sha(JSON.stringify(liste.filter((d) => d.rolle && d.rolle !== 'besitz').map((d) => [d.x, d.y, d.rot, d.dx, d.dz, d.rolle || null, d.platz, d.fuss || null])));
        }
      }
    }
  }
  // ORT-01 9: Schiff (germanen) und Ruine (rom) ohne Orte-Regeln: byte-gleich zu main 3c7f8cd (Referenz im Fixture, Schlüssel schiff_ruine, nicht neu schreiben)
  const schiffRuine = {};
  for (const [art, bw] of [['schiff', 'germanen'], ['ruine', 'rom']]) {
    const B = json(path.join(BW, 'bauweisen/' + bw + '.json')), reg = json(path.join(BW, 'deko/' + bw + '.json'));
    const dp = B.deckung_props && B.deckung_props[art];
    const ids = new Set(dp ? Object.values(dp).flat() : []);
    for (const i of (B.deko_ausschluss && B.deko_ausschluss[art]) || []) ids.add(i);
    const regeln = Object.assign({}, reg, { regeln: {} });
    for (const [t, v] of Object.entries(reg.regeln)) regeln.regeln[t] = Object.assign({}, v, { props: v.props.filter((i) => !ids.has(i)) });
    const extra = art === 'schiff' ? (json(path.join(BW, 'paletten/rostmeute.json')).streu || []) : [];
    for (let s = 1; s <= 10; s++) {
      const g = { seed: 7 };
      const id = LP.neu(g, 'kesh', { art, besitz: 'rostmeute', bauweise: bw, seed: s * 977 });
      const k = LP.karte(g, id);
      const kindAt = (x, y) => { const c = (k.rows[y] || '')[x]; return c == null || c === '' ? null : kacheln.zeichen[c] ? kacheln.zeichen[c].kind : null; };
      const plaetze = Object.keys(k.plaetze || {}).sort().map((pid) => { const p = k.plaetze[pid]; return { id: pid, typ: p.typ, x: p.rect[0], y: p.rect[1], w: p.rect[2], h: p.rect[3] }; });
      schiffRuine[art + '/' + bw + '/' + s] = sha(JSON.stringify(streuen({ id: 't', w: k.w, h: k.h, seed: k.seed, art: k.art, stride: k.stride, kindAt, anker: k.anker || [], plaetze }, regeln, { extra, rollen: null })));
    }
  }
  return { karten, deko, deko_zellen: dekoZellen, layout, schiff_ruine: schiffRuine };
}

(async () => {
  const modus = process.argv.includes('--write') ? 'write' : 'compare';
  if (modus === 'write' && OHNE.length) { console.error('--ohne-zeichen gilt nur mit --compare (die Basis darf nicht ohne Zeichen geschrieben werden)'); process.exit(1); }
  const nurKarten = process.argv.includes('--karten') && modus === 'compare';
  const ist = await berechne(nurKarten);
  if (modus === 'write') {
    fs.writeFileSync(DATEI, JSON.stringify({ format: 'ort01-hash-baseline/2', stand: 'karten: VOX-01 (neue Kachelarten Y, H, ; in den Legenden der Karten; Raster, Regeln und Anker unverändert gegenüber main 6d912b4); deko_zellen, deko, layout: ORT-01 Paket 9 (Altstücke ersetzt, Besitz-Streu der Orte gefiltert, Rom-Deko für Außenposten und Station-Gänge)', karten: ist.karten, deko_zellen: ist.deko_zellen, deko: ist.deko, layout: ist.layout, schiff_ruine: fs.existsSync(DATEI) && json(DATEI).schiff_ruine ? json(DATEI).schiff_ruine : ist.schiff_ruine }, null, 1) + '\n');
    console.log(`Baseline geschrieben: ${Object.keys(ist.karten).length} Karten-Hashes, ${Object.keys(ist.deko_zellen).length} Zellen-Deko-Hashes, ${Object.keys(ist.deko).length} Deko-Hashes (beide Bauweisen), ${Object.keys(ist.layout).length} Layout-Hashes -> ${path.relative(ROOT, DATEI)}`);
    return;
  }
  const soll = json(DATEI);
  if (OHNE.length) console.log(`Legendeneinträge vor dem Hashen entfernt: ${OHNE.map((z) => JSON.stringify(z)).join(' ')} (Karten-Hashes; Deko/Layout hängen nicht an der Legende)`);
  let fehler = 0;
  for (const teil of nurKarten ? ['karten'] : ['karten', 'deko_zellen', 'deko', 'layout', 'schiff_ruine']) {
    const ab = [];
    for (const k of Object.keys(soll[teil])) if (soll[teil][k] !== ist[teil][k]) ab.push(k);
    for (const k of Object.keys(ist[teil])) if (!(k in soll[teil])) ab.push(k + ' (neu)');
    const n = Object.keys(soll[teil]).length;
    console.log(`${ab.length ? '✗' : '✓'} ${teil}: ${n - ab.length}/${n} gleich${ab.length ? ', abweichend: ' + ab.slice(0, 8).join(', ') + (ab.length > 8 ? ' …' : '') : ''}`);
    fehler += ab.length;
  }
  if (!nurKarten) {
    // Layout-Parität: dieselbe Karte, beide Bauweisen: Positionen, Drehungen, Versätze und Füße müssen gleich sein
    const un = [];
    for (const key of Object.keys(ist.layout)) if (key.includes('/germanen/') && ist.layout[key] !== ist.layout[key.replace('/germanen/', '/rom/')]) un.push(key);
    const n = Object.keys(ist.layout).length / 2;
    console.log(`${un.length ? '✗' : '✓'} layout-parität: ${n - un.length}/${n} Karten mit gleichem Layout in Rom und Germanen${un.length ? ', abweichend: ' + un.slice(0, 6).join(', ') : ''}`);
    fehler += un.length;
  }
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
