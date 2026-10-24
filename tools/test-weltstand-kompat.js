'use strict';
// SUND-03 F7: Rückwärts-Kompatibilität des Weltstands. Ohne Schalter (Lage-Spielleiter aus, Reise-Ereignisse aus) schreibt die Freie Fahrt Sund denselben Weltstand wie nach SUND-02: kein Block
// welt.sim.chronik, welt.sim.reise (oder regie). main/Pantheon-play lehnt unbekannte Felder ab („unbekanntes Feld“) und startet sonst ein neues Spiel. Geprüft gegen das Schema von main
// (tools/fixtures/weltstand-main.schema.json, Kopie von content/schema/weltstand.schema.json aus Pantheon-main, Stand 6d912b4) mit dem Prüfer dieses Repos (Weltstand.fallbackValidate).
// Gegenprobe: mit Schalter erscheinen die Blöcke, das eigene Schema nimmt sie an, das von main lehnt sie ab (der Test hat Zähne).
//   node tools/test-weltstand-kompat.js   (npm run test:weltstand-kompat)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Absicht = require('../server/sim/absicht.js');
const RE = require('../server/sim/reise-ereignis.js');
const F = require('./regie-fixture.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const MAIN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weltstand-main.schema.json'), 'utf8'));
const SIM_ERLAUBT = Object.keys(MAIN.properties.welt.properties.sim.properties);
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];

// 150 Sprünge mit drei Spielern; Einträge der Chronik kommen aus den echten Quellen (Strategische Option abgelehnt)
function lauf(seed, env) {
  const t = F.neuesSpiel({ crew: 3, seed, names: NAMEN, env });
  const g = t.g;
  for (let k = 1; k <= 150; k++) {
    Kriegslage.tick(g, 'test');
    RE.zaehleSprung(g);   // der Sprungzähler der Reise-Ereignisse zählt (ohne Schalter darf er trotzdem nicht im Stand landen)
    if (k % 12 === 0) { Absicht.debug(g, ['angebot']); Absicht.ablehnen(g); }
    if (k % 30 === 0) for (let i = 0; i < 40; i++) g.step();
  }
  return g;
}
const welt = (g) => Weltstand.capture(g);
const simBlock = (data) => (data.welt && data.welt.sim) || data.sim || null;

for (const seed of [7, 21, 33]) {
  console.log('\nSeed ' + seed + ': ohne Schalter');
  const g = lauf(seed);
  const data = welt(g);
  const sim = simBlock(data);
  ok(sim && sim.tick >= 150, 'Weltstand mit Sim-Block (Tick ' + (sim && sim.tick) + ')');
  ok(g.weltsim.chronik && g.weltsim.chronik.length > 0, 'im Speicher steht eine Chronik (' + (g.weltsim.chronik || []).length + ' Einträge), sie kommt nicht in den Weltstand');
  ok(sim && !('chronik' in sim) && !('reise' in sim) && !('regie' in sim), 'kein Block chronik, reise oder regie in welt.sim');
  ok(sim && Object.keys(sim).every((k) => SIM_ERLAUBT.includes(k)), 'jedes Feld von welt.sim steht im Schema von main (' + Object.keys(sim || {}).join(', ') + ')');
  const errs = Weltstand.fallbackValidate(data, MAIN);
  ok(errs.length === 0, 'der Prüfer akzeptiert den Stand gegen das Schema von main' + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : ''));
  ok(Weltstand.validate(data, g).length === 0, 'und gegen das eigene Schema');
  ok(!JSON.stringify(sim).includes('Mireille'), 'keine Spielernamen im Sim-Block');
  ok(g.errors === 0, 'keine Serverfehler');
}

console.log('\nGegenprobe: mit Schalter erscheinen die Blöcke');
for (const [name, env] of [['REISE_EREIGNISSE=1', { REISE_EREIGNISSE: '1' }], ['Lage-Spielleiter an', { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' }], ['Lage-Spielleiter an, Reise-Ereignisse ausdrücklich aus', { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: 'off' }]]) {
  const g = lauf(7, env);
  const data = welt(g), sim = simBlock(data);
  ok(sim && Array.isArray(sim.chronik) && sim.chronik.length > 0, name + ': welt.sim.chronik wird geschrieben');
  ok(Weltstand.validate(data, g).length === 0, name + ': das eigene Schema nimmt den Stand an');
  const errs = Weltstand.fallbackValidate(data, MAIN);
  ok(errs.some((e) => /chronik/.test(e) && /unbekanntes Feld/.test(e)), name + ': das Schema von main lehnt chronik ab („unbekanntes Feld“), die Prüfung hat Zähne');
}

console.log('\nSchalter an gespielt, ohne Schalter weitergespielt und gespeichert (SUND-03 F2)');
{
  const Regie = require('../server/sim/regie-befehle.js');
  const Marken = require('../server/sim/marken.js');
  const a = lauf(7, { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' });
  const r = Regie.planAnwenden(a, { befehle: [{ typ: 'regler', fraktion: 'rom', p_act: 0.2, dauer: 5 }], fokus: { hex: Marken.hexVon(a.ship.scene), radius: 2 }, begruendung: 'Test' });
  const d1 = welt(a), s1 = simBlock(d1);
  ok(r.angenommen.length >= 2 && s1.regie && s1.regie.rate && s1.regie.rate.length === 2 && s1.chronik, 'mit Schalter: Plan gebucht, regie (Rate 2 Plätze) und chronik im Stand');
  ok(Weltstand.validate(d1, a).length === 0, 'der Stand mit Schalter ist für das eigene Schema gültig');
  const b = F.neuesSpiel({ crew: 3, seed: 7, names: NAMEN }).g;   // ohne Schalter
  Kriegslage.restore(b, JSON.parse(JSON.stringify(s1)));
  ok(b.weltsim.regie.rate.length === 2 && b.weltsim.chronik.length > 0, 'ohne Schalter geladen: die Zusatzdaten sind im Speicher');
  for (let k = 0; k < 130; k++) Kriegslage.tick(b, 'test');
  const d2 = welt(b), s2 = simBlock(d2);
  ok(!('chronik' in s2) && !('reise' in s2) && !('regie' in s2), 'danach ohne Schalter gespeichert: kein Block chronik, reise, regie (die Zusatzdaten gehen verloren)');
  ok(Weltstand.fallbackValidate(d2, MAIN).length === 0, 'und das Schema von main nimmt den Stand an');
  // abgelaufene Einträge werden auch mit Schalter nicht mehr mitgeschrieben
  const c = lauf(7, { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' });
  const RT = Regie.R.rate.wert;
  c.weltsim.regie.rate = [c.weltsim.tickZahl - RT.fenster, c.weltsim.tickZahl - RT.fenster + 1, c.weltsim.tickZahl];
  c.weltsim.regie.letzte = { 'regler:rom': c.weltsim.tickZahl - 1000, 'fokus': c.weltsim.tickZahl };
  const blk = Regie.toSave(c.weltsim);
  ok(blk && blk.rate.join() === (c.weltsim.tickZahl - RT.fenster + 1) + ',' + c.weltsim.tickZahl, 'abgelaufene Rate-Einträge (genau am Fensterrand) werden nicht geschrieben: ' + (blk && blk.rate.join()));
  ok(blk && Object.keys(blk.letzte).join() === 'fokus', 'abgelaufene Abkühlzeiten werden nicht geschrieben');
  c.weltsim.regie = Regie.neu(); c.weltsim.regie.rate = [c.weltsim.tickZahl - RT.fenster]; c.weltsim.regie.letzte = { 'regler:rom': 0 };
  ok(Regie.toSave(c.weltsim) === null, 'nur Abgelaufenes: gar kein Block');
}

console.log('\nFunktion und Laden');
ok(typeof Kriegslage.neueBloeckeAn === 'function', 'benannte Funktion Kriegslage.neueBloeckeAn');
{
  const g = lauf(7, { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' });
  const data = welt(g);
  const b = simBlock(data);
  const g2 = F.neuesSpiel({ crew: 1, seed: 7 }).g;
  Kriegslage.restore(g2, b);
  ok(g2.weltsim.chronik.length === b.chronik.length, 'ein Stand mit Block lädt auch ohne Schalter (Laden bleibt offen)');
  const alt = JSON.parse(JSON.stringify(b)); delete alt.chronik; delete alt.reise;
  Kriegslage.restore(g2, alt);
  ok(g2.weltsim.chronik.length === 0, 'ein Stand ohne Block lädt (fehlt = leer)');
}
console.log(`\n${n - fails} von ${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
