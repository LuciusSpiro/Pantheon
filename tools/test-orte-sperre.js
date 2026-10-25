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
    raumRollen: { station: J('rollen/station.json'), aussenposten: J('rollen/aussenposten.json') } });
  const fehler = (l) => l.filter((x) => x.lvl === 'err');
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
    ['rom Rollen-Belegung mit prop/germanen', (c) => { c.raumRollen.station.rollen['kommando.datentafel'].rom = 'prop/germanen/gemein/kette'; }, /germanisches Modell/],
    ['rom leit mit germanischem Modell', (c) => { c.bauweisen.rom.leit.landeplatz.aussenposten = 'prop/germanen/aussenposten/landeplatz_2x2'; }, /germanisches Modell/],
    ['germanen Rolle mit werkzeug (Holzwerkbank)', (c) => { c.raumRollen.station.rollen['werkstatt.werkzeug'].germanen = 'prop/germanen/gemein/werkzeug'; }, /Holzwerkbank/],
    ['rom deko mit Ruine-Prop in einem Generator-Platztyp', (c) => { c.deko.rom.regeln.hof = { props: ['prop/rom/ruine/schutt'] }; }, /Ruine/],
  ];
  for (const [name, mut, re] of faelle) {
    const c = basis(); mut(c);
    const f = fehler(M.pruefeOrte(c));
    ok(f.length > 0 && f.some((x) => re.test(x.msg)), name + ' → rot');
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
