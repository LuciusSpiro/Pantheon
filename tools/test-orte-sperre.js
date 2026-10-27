'use strict';
// ORT-01 Prüf-Sperre (tools/orte-sperre.mjs): Orte lösen keine Ruine-/Alt-Stücke auf. Grundzustand grün, Mutationsprobe je verbotenem Stück,
// Rückfall-Eintrag '*' (Ruine) ist erlaubt, Ausnahmen sind explizit, Rom darf kein prop/germanen/*.
//   node tools/test-orte-sperre.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'content/buehnen', p), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
(async () => {
  const M = await import(pathToFileURL(path.join(ROOT, 'tools/orte-sperre.mjs')).href);
  const basis = () => ({ bauweisen: { rom: J('bauweisen/rom.json'), germanen: J('bauweisen/germanen.json') }, deko: { rom: J('deko/rom.json'), germanen: J('deko/germanen.json') },
    platztypen: { station: ['schleuse', 'korridor', 'kreuzung', 'zellen', 'lager', 'herzstueck', 'reaktorraum', 'kontrollraum', 'quartiere'], aussenposten: ['landeplatz', 'dorfplatz', 'hof', 'lagerhalle', 'kulisse', 'wachturm'] },
    raumRollen: { station: J('rollen/station.json'), aussenposten: J('rollen/aussenposten.json') },
    besitz: { rostmeute: J('paletten/rostmeute.json'), kontor: J('paletten/kontor.json') } });
  const fehler = (l) => l.filter((x) => x.lvl === 'err');
  const { besitzStreuFuerOrt } = await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/deko.js')).href);
  const besitzStreu = (art) => besitzStreuFuerOrt(art, J('paletten/rostmeute.json').streu).map((e) => (typeof e === 'string' ? e : e.id));
  console.log('[Grundzustand]');
  const g = M.pruefeOrte(basis());
  ok(fehler(g).length === 0, 'produktive Daten: 0 Fehler (' + fehler(g).map((x) => x.msg).join('; ') + ')');
  ok(g.some((x) => x.lvl === 'info' && /^Ausnahme/.test(x.msg)) && g.some((x) => x.lvl === 'info' && /^Altstück/.test(x.msg)), 'Ausnahmen und Altstücke werden namentlich gemeldet (nicht stillschweigend)');
  console.log('[Mutationsprobe: verbotene Stücke]');
  const faelle = [
    ['rom anker zelle station → carcer', (c) => { c.bauweisen.rom.anker.zelle.station = 'prop/rom/ruine/carcer'; }, /carcer|Ruine/],
    ['rom anker beute aussenposten → legionskasse', (c) => { c.bauweisen.rom.anker.beute.aussenposten = 'prop/rom/ruine/legionskasse'; }, /legionskasse|Ruine/],
    ['germanen anker beute station → truhe', (c) => { c.bauweisen.germanen.anker.beute.station = 'prop/germanen/gemein/truhe'; }, /Truhe/],
    ['germanen anker zelle aussenposten → kaefig_zelle', (c) => { c.bauweisen.germanen.anker.zelle.aussenposten = 'prop/germanen/gemein/kaefig_zelle'; }, /Käfigzelle/],
    ['germanen anker ziel aussenposten → thing_stein', (c) => { c.bauweisen.germanen.anker.ziel.aussenposten = 'leit/germanen/aussenposten/thing_stein'; }, /Thing-Stein/],
    ['germanen anker terminal station entfernt → Rückfall * (runenstein ok, aber ruine nicht): rom terminal ohne Station-Eintrag', (c) => { delete c.bauweisen.rom.anker.terminal.station; }, /Ruine/],
    ['rom Rollen-Belegung mit prop/germanen', (c) => { c.raumRollen.station.rollen['kommando.datentafel'].rom = 'prop/germanen/gemein/decal_runen'; }, /germanisches Modell/],
    ['germanen Freiland-Regel * → fass (ORT-01 9: Catch-all wird aufgelöst)', (c) => { c.deko.germanen.regeln['aussenposten:*'] = { props: ['prop/germanen/gemein/fass'] }; }, /Fass/],
    ['germanen Station Lager → werkzeug (Holzwerkbank)', (c) => { c.deko.germanen.regeln['station:lager'] = { props: ['prop/germanen/gemein/werkzeug'] }; }, /Holzwerkbank/],
    ['germanen Außenposten deko hof → fass (ORT-01 6M)', (c) => { c.deko.germanen.regeln['aussenposten:hof'] = { props: ['prop/germanen/gemein/fass'] }; }, /Fass/],
    ['germanen Außenposten deko wachturm → kette (ORT-01 6M)', (c) => { c.deko.germanen.regeln['aussenposten:wachturm'] = { props: ['prop/germanen/gemein/kette'] }; }, /Kette/],
    ['germanen Außenposten deko dorfplatz → feuerschale (ORT-01 6M)', (c) => { c.deko.germanen.regeln['aussenposten:dorfplatz'] = { props: ['prop/germanen/gemein/feuerschale'] }; }, /Feuerschale/],
    ['germanen Außenposten deko dorfplatz → werkzeug (Holzwerkbank)', (c) => { c.deko.germanen.regeln['aussenposten:dorfplatz'] = { props: ['prop/germanen/gemein/werkzeug'] }; }, /Holzwerkbank/],
    ['germanen Außenposten deckung_voll → feuerschale', (c) => { c.bauweisen.germanen.deckung_props.aussenposten.deckung_voll.push('prop/germanen/gemein/feuerschale'); }, /Feuerschale/],
    ['rom leit mit germanischem Modell', (c) => { c.bauweisen.rom.leit.landeplatz.aussenposten = 'prop/germanen/aussenposten/landeplatz_2x2'; }, /germanisches Modell/],
    ['germanen Rolle mit werkzeug (Holzwerkbank)', (c) => { c.raumRollen.station.rollen['werkstatt.werkzeug'].germanen = 'prop/germanen/gemein/werkzeug'; }, /Holzwerkbank/],
    ['rom deko mit Ruine-Prop in einem Generator-Platztyp', (c) => { c.deko.rom.regeln['aussenposten:hof'] = { props: ['prop/rom/ruine/schutt'] }; }, /Ruine/],
  ];
  for (const [name, mut, re] of faelle) {
    const c = basis(); mut(c);
    const f = fehler(M.pruefeOrte(c));
    ok(f.length > 0 && f.some((x) => re.test(x.msg)), name + ' → rot');
  }
  console.log('[Schiff und Ruine: unpräfixierte Regeln]');
  {
    const c = basis(); c.deko.germanen.regeln.lager = { props: ['prop/germanen/gemein/fass', 'prop/germanen/gemein/kette'] };
    ok(fehler(M.pruefeOrte(c)).length === 0, 'unpräfixierte Altstück-Regel (nur Schiff) wird von den Orten nicht gelesen → grün');
  }
  console.log('[Besitz-Streu]');
  {
    const mit = (c) => { c.besitz.rostmeute.streu.push('prop/germanen/gemein/kette'); return c; };
    const f0 = fehler(M.pruefeOrte(mit(basis()), { besitzFilter: (a, st) => st })); ok(f0.some((x) => /besitz.rostmeute/.test(x.msg)), 'Besitz-Streu mit Altstück ohne Filter → rot');
    const f1 = fehler(M.pruefeOrte(mit(basis()))); ok(f1.length === 0, 'Besitz-Streu mit Altstück und Ort-Filter → grün (Altstück fällt weg)');
    const ohne = M.pruefeOrte(mit(basis())).filter((x) => x.lvl === 'info' && /besitz/.test(x.msg)).length;
    ok(ohne === 0, 'Filter entfernt den Altstück-Eintrag still ohne Meldung (kein Info-Rauschen)');
    const sch = besitzStreu('schiff'); ok(sch.includes('prop/germanen/gemein/fass'), 'Schiff behält Altstücke in der Besitz-Streu (Ruine und Schiff unverändert)');
  }
  console.log('[Gegenprobe]');
  {
    const c = basis();
    c.bauweisen.rom.anker.zelle['*'] = 'prop/rom/ruine/carcer';   // Rückfall für die Ruine bleibt erlaubt
    ok(fehler(M.pruefeOrte(c)).length === 0, "Eintrag '*' (Ruine) wird für station/aussenposten nicht aufgelöst");
    const c2 = basis(); c2.bauweisen.germanen.anker.zelle.station = 'prop/germanen/gemein/kaefig_zelle';
    ok(fehler(M.pruefeOrte(c2, { ausnahmen: M.AUSNAHMEN.concat([{ id: /kaefig_zelle$/, wo: /^anker\.zelle$/, grund: 'Test' }]) })).length === 0, 'explizite Ausnahme (Liste) hebt den Fehler auf');
    ok(M.AUSNAHMEN.every((a) => a.grund && a.grund.length > 20), 'jede Ausnahme hat einen Grund');
  }
  console.log(fails ? `\n${fails} FEHLER` : '\nalle grün');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
