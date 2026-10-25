'use strict';
// ORT-01 Paket 1: Rollenformat rollen/1 und Parität Rom ↔ Germanen (check:assets, tools/rollen-pruefung.mjs).
//   Beleg des Formats (Testdateien tools/fixtures/rollen/*.json grün), produktive Dateien grün, Mutationsprobe
//   (Belegung entfernt → rot, unbekannte ID → rot, Modell nur im Index → rot, zu großes Deko-Modell → rot, …),
//   K-SILHOUETTE für Rollen (Buehne.silhouetteFehler), Exit-Code von check-assets über --nur-rollen.
//   node tools/test-rollen-paritaet.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const Buehne = require('../shared/buehne.js');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name) => console.log('\n[' + name + ']');
const clone = (o) => JSON.parse(JSON.stringify(o));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rollen-par-'));
let lauf = 0;
// Schreibt eine Variante der Station-Testdatei in einen frischen Ordner und lässt check-assets --nur-rollen darüber laufen
function pruefe(mut, aussenMut) {
  const dir = path.join(TMP, 'v' + (++lauf));
  fs.mkdirSync(dir);
  const station = clone(JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/rollen/station.json'), 'utf8')));
  if (mut) mut(station);
  fs.writeFileSync(path.join(dir, 'station.json'), JSON.stringify(station, null, 1));
  const aussen = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/rollen/aussenposten.json'), 'utf8'));
  if (typeof aussenMut === 'function') aussenMut(aussen);
  if (aussenMut !== false) fs.writeFileSync(path.join(dir, 'aussenposten.json'), JSON.stringify(aussen, null, 1));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/check-assets.mjs'), '--nur-rollen', '--rollen-dir', dir], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

(async () => {
  const { readManifests } = await import(pathToFileURL(path.join(ROOT, 'tools/sync-assets.mjs')).href);
  const { pruefeRollenDatei, belegungListe } = await import(pathToFileURL(path.join(ROOT, 'tools/rollen-pruefung.mjs')).href);
  const man = await readManifests(path.join(ROOT, 'assets/manifest'));
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/voxel/index.json'), 'utf8'));
  const ctx = { manifestIds: new Set(man.entries.map((e) => e.id)), indexModels: new Set(idx.models || []), modelle: {}, leitFuss: {}, deckung: {}, ankerRollen: null };
  for (const e of man.entries) ctx.modelle[e.id] = { footprint: e.footprint, height: e.height };
  for (const bw of ['rom', 'germanen']) {
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/buehnen/bauweisen/' + bw + '.json'), 'utf8'));
    ctx.leitFuss[bw] = b.leit_fuss || {};
    ctx.deckung[bw] = {};
    for (const [art, m] of Object.entries(b.deckung_props || {})) if (m && typeof m === 'object' && !Array.isArray(m)) ctx.deckung[bw][art] = new Set(Object.values(m).flat());
  }
  ctx.ankerRollen = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'content/buehnen/anker.json'), 'utf8')).rollen));
  const fehler = (l) => l.filter((x) => x.lvl === 'err');

  section('Beleg des Formats: Testdateien und produktive Dateien');
  for (const art of ['station', 'aussenposten']) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/rollen/' + art + '.json'), 'utf8'));
    const l = pruefeRollenDatei(j, art + '.json', ctx);
    ok(fehler(l).length === 0, `Testdatei ${art}: 0 Fehler (${fehler(l).map((x) => x.msg).join('; ')})`);
    ok(l.filter((x) => x.lvl === 'warn').length === 0, `Testdatei ${art}: 0 Warnungen`);
    const bel = Object.values(j.rollen).every((r) => belegungListe(r.rom) && belegungListe(r.germanen));
    ok(bel, `Testdatei ${art}: jede Rolle hat rom UND germanen`);
    const p = path.join(ROOT, 'content/buehnen/rollen/' + art + '.json');
    ok(fs.existsSync(p), `produktive Datei content/buehnen/rollen/${art}.json vorhanden`);
    const lp = pruefeRollenDatei(JSON.parse(fs.readFileSync(p, 'utf8')), art + '.json', ctx);
    ok(fehler(lp).length === 0, `produktive Datei ${art}: 0 Fehler`);
  }
  const g = pruefe(null);
  ok(g.code === 0 && /0 Fehler/.test(g.out), 'check-assets --nur-rollen: Exit 0 auf den Testdateien');
  const prod = spawnSync(process.execPath, [path.join(ROOT, 'tools/check-assets.mjs'), '--nur-rollen'], { encoding: 'utf8' });
  ok(prod.status === 0, 'check-assets --nur-rollen: Exit 0 auf content/buehnen/rollen');

  section('Mutationsprobe: Parität');
  let r = pruefe((s) => { delete s.rollen['lager.behaelter'].germanen; });
  ok(r.code === 1 && /lager\.behaelter: Belegung für germanen fehlt/.test(r.out), 'germanische Belegung entfernt → rot (Exit 1, nennt Rolle und Bauweise)');
  r = pruefe((s) => { delete s.rollen['kommando.streu'].rom; });
  ok(r.code === 1 && /kommando\.streu: Belegung für rom fehlt/.test(r.out), 'römische Belegung entfernt → rot');
  r = pruefe((s) => { s.rollen['lager.werkzeug'].germanen = []; });
  ok(r.code === 1 && /Belegung für germanen fehlt/.test(r.out), 'leere Liste zählt nicht als Belegung → rot');
  r = pruefe((s) => { s.rollen['lager.werkzeug'].rom = ['']; });
  ok(r.code === 1 && /Belegung für rom fehlt/.test(r.out), 'leere ID zählt nicht als Belegung → rot');
  r = pruefe((s) => { delete s.rollen['lager.leuchte']; });
  ok(r.code === 1 && /lager\.leuchte ist in "rollen" nicht definiert/.test(r.out), 'Rolle im Raumtyp ohne Definition → rot');
  r = pruefe((s) => { delete s.rollen['lager.hauptstueck'].germanen; });
  ok(r.code === 1 && /lager\.hauptstueck: Belegung für germanen fehlt/.test(r.out), 'auch Hauptstücke (kind anker) brauchen beide Seiten → rot');
  r = pruefe(null, false);
  ok(r.code === 0, 'Gegenprobe: unveränderte Station-Datei allein bleibt grün');

  section('Mutationsprobe: Modell-IDs');
  r = pruefe((s) => { s.rollen['lager.behaelter'].rom = 'prop/rom/gibt_es_nicht'; });
  ok(r.code === 1 && /weder im Manifest noch in index\.json/.test(r.out), 'unbekannte Modell-ID → rot');
  ok(ctx.indexModels.has('rom/energiezelle') && !ctx.manifestIds.has('rom/energiezelle'), 'Ausgangslage: rom/energiezelle steht in index.json, aber nicht im Manifest');
  r = pruefe((s) => { s.rollen['lager.behaelter'].rom = 'rom/energiezelle'; });
  ok(r.code === 1 && /keinen Manifest-Eintrag/.test(r.out), 'Modell nur in index.json (ohne Manifest-Eintrag: der Client lädt es nicht) → rot');
  r = pruefe((s) => { s.rollen['lager.behaelter'].germanen = ['prop/germanen/gemein/fass', 'prop/germanen/gemein/nix']; });
  ok(r.code === 1 && /prop\/germanen\/gemein\/nix/.test(r.out), 'eine unbekannte ID in einer Liste → rot');
  r = pruefe((s) => { s.rollen['lager.behaelter'].rom = 'prop/rom/ruine/saeule_gestuerzt'; });
  ok(r.code === 1 && /Deko ist 1×1/.test(r.out), 'streu-Modell größer als 1×1 → rot');
  r = pruefe((s) => { s.raumtypen.lager.rollen[1].kind = 'leit'; s.rollen['lager.behaelter'] = { rom: 'prop/rom/ruine/schutt', germanen: 'prop/germanen/gemein/fass' }; });
  ok(r.code === 1 && /keinen Eintrag in leit_fuss/.test(r.out), 'kind leit ohne leit_fuss-Eintrag → rot');

  r = pruefe(null, (a) => { a.rollen['lager.behaelter'].germanen = ['prop/germanen/gemein/fass', 'prop/germanen/gemein/hocker']; });
  ok(r.code === 1 && /Deckungs-Prop der germanen-Bauweise/.test(r.out), 'Außenposten: germanische Belegung ist Deckungs-Prop (fass) → rot (kit.js nähme es aus der Deko, Rolle bliebe leer)');
  r = pruefe(null, (a) => { a.rollen['lager.behaelter'].rom = 'prop/germanen/gemein/werkzeug'; });
  ok(r.code === 1 && /Deckungs-Prop der rom-Bauweise/.test(r.out), 'Außenposten: auch die römische Seite nutzt heute die germanischen Deckungs-Props (deckung_props rom) → rot');
  r = pruefe((s) => { s.rollen['lager.behaelter'].germanen = ['prop/germanen/gemein/fass', 'prop/germanen/gemein/hocker']; }, false);
  ok(r.code === 0, 'Station: fass ist dort kein Deckungs-Prop (deckung_props gilt nur für den Außenposten) → grün');

  section('Mutationsprobe: Format');
  r = pruefe((s) => { s.format = 'rollen/2'; });
  ok(r.code === 1 && /format/.test(r.out), 'falsches format → rot');
  r = pruefe((s) => { s.raumtypen.lager.rollen[2].kind = 'deko'; });
  ok(r.code === 1 && /kind "deko"/.test(r.out), 'unbekannte kind → rot');
  r = pruefe((s) => { s.raumtypen.lager.rollen[2].zug = [3, 1]; });
  ok(r.code === 1 && /zug/.test(r.out), 'zug min > max → rot');
  r = pruefe((s) => { s.raumtypen.lager.frei_halten = 0; });
  ok(r.code === 1 && /frei_halten/.test(r.out), 'frei_halten 0 → rot (Anker und Türen bleiben frei)');
  r = pruefe((s) => { s.raumtypen.lager.rollen[0].ankerRolle = 'gibtsnicht'; });
  ok(r.code === 1 && /gibtsnicht/.test(r.out), 'ankerRolle nicht in anker.json → rot');
  r = pruefe((s) => { s.raumtypen.lager.rollen.push(s.raumtypen.lager.rollen[1]); });
  ok(r.code === 1 && /doppelt/.test(r.out), 'Rolle doppelt im Raumtyp → rot');
  r = pruefe((s) => { s.kartenart = 'ruine'; });
  ok(r.code === 1 && /kartenart/.test(r.out), 'kartenart ≠ Dateiname → rot');
  r = pruefe((s) => { s.rollen['lager.behaelter'].aegypten = 'x'; });
  ok(r.code === 0 && /unbekanntes Feld aegypten/.test(r.out), 'unbekannte Bauweise (Ägypten) ist nur eine Warnung (Völker folgen später)');
  r = pruefe((s) => { const l = s.raumtypen.lager.rollen; for (let i = 0; i < 3; i++) l.push({ rolle: 'lager.extra' + i, kind: 'streu' }), (s.rollen['lager.extra' + i] = { rom: 'prop/rom/ruine/schutt', germanen: 'prop/germanen/gemein/fass' }); });
  ok(r.code === 0 && /Erkundung: 5–7/.test(r.out), '9 Rollen je Raumtyp: Warnung (Erkundung 5–7), kein Fehler');

  section('K-SILHOUETTE für Rollen');
  const modelle = {};
  for (const e of man.entries) modelle[e.id] = { height: e.height, footprint: e.footprint };
  const rd = { format: 'rollen/1', kartenart: 'station', raumtypen: { lager: { rollen: [{ rolle: 'lager.hoch', kind: 'streu' }, { rolle: 'lager.haupt', kind: 'leit' }] } },
    rollen: { 'lager.hoch': { rom: 'prop/rom/ruine/schutt', germanen: 'prop/germanen/gemein/laterne' }, 'lager.haupt': { rom: 'leit/rom/ruine/fahnenheiligtum', germanen: 'leit/germanen/aussenposten/statue_platz' } } };
  const sil = Buehne.silhouetteFehler({ bauweisen: [], deko: [], rollen: [rd], modelle });
  ok(sil.length === 1 && sil[0].id === 'prop/germanen/gemein/laterne', `streu-Rolle mit 2,13-m-Laterne → K-SILHOUETTE (${sil.map((x) => x.id).join(',')}); Leitstück (kind leit) bleibt frei`);
  const echt = Buehne.silhouetteFehler(Buehne.silhouetteDaten());
  ok(echt.length === 0, 'produktive Daten (inkl. content/buehnen/rollen): keine K-SILHOUETTE');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\ntest-rollen-paritaet: ${n - fails}/${n} ok`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
