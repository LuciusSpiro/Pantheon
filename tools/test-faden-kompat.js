'use strict';
// SUND-04a-1 B: Rueckwaerts-Kompatibilitaet der Faeden. Ohne Schalter FAEDEN=1 (auch mit Lage-Spielleiter und Reise-Ereignissen) ist die Freie Fahrt Sund byte-gleich zu main: kein Block welt.sim.faeden,
// jedes Feld von welt.sim steht im Schema von main (tools/fixtures/weltstand-main.schema.json, das auch test-weltstand-kompat.js benutzt), der Sim-Zustand ist bitgleich. Mit Schalter erscheint der Block
// (das eigene Schema nimmt ihn an, das von main lehnt ihn ab: die Pruefung hat Zaehne), und auch dann bleibt der Sim-Zustand bitgleich: Faeden beruehren die Sim nie.        node tools/test-faden-kompat.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Absicht = require('../server/sim/absicht.js');
const RE = require('../server/sim/reise-ereignis.js');

const { F, Faden, grenzen } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const MAIN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weltstand-main.schema.json'), 'utf8'));
const SIM_ERLAUBT = Object.keys(MAIN.properties.welt.properties.sim.properties);
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const simBlock = (data) => (data.welt && data.welt.sim) || data.sim || null;
const zustand = (g) => JSON.stringify(Kriegslage.abbild(g.weltsim.zustand));

// 150 Spruenge mit Taetigkeitsgrenzen ueber die echten Hooks; mit Faeden (faden = true) laeuft nebenher eine Geschichte
function lauf(seed, env, faden) {
  const reg = X.registriere(X.vorlageTest());
  if (!reg.ok) throw new Error('Testvorlage ungueltig');
  const t = F.neuesSpiel({ crew: 3, seed, names: NAMEN, env });
  const g = t.g;
  let f = null;
  for (let k = 1; k <= 150; k++) {
    Kriegslage.tick(g, 'test');
    RE.zaehleSprung(g);
    g.lageGrenze(['szene_ende', 'andocken', 'absicht'][k % 3]);
    if (k % 12 === 0) { Absicht.debug(g, ['angebot']); Absicht.ablehnen(g); }
    if (faden && k === 10) { const a = Faden.ausgangMitPerson(g, { art: 'notruf', id: 'k', hex: '0305', ausgang: 'gelungen' }); if (a) { const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: a.nr } }); f = r.ok ? r.faden : null; } }
    if (faden && f && k % 10 === 0 && f.phase === 'wartet') Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: require('../server/sim/faden-daten.js').vorlage(f.vorlage).beats[f.beat].id });
    if (faden && f && f.phase === 'laeuft') Faden.beatAusgang(g, f.id, k % 20 === 0 ? 'gescheitert' : 'gelungen');
    if (k % 30 === 0) for (let i = 0; i < 40; i++) g.step();
  }
  return g;
}

for (const seed of [7, 21, 33]) {
  for (const [name, env] of [['ohne alles', {}], ['REISE_EREIGNISSE=1', { REISE_EREIGNISSE: '1' }], ['Lage-Spielleiter an (Mock)', { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' }], ['FAEDEN=off', { FAEDEN: 'off' }]]) {
    console.log(`\nSeed ${seed}: ${name}, ohne FAEDEN=1`);
    const g = lauf(seed, env);
    const data = Weltstand.capture(g), sim = simBlock(data);
    ok(sim && sim.tick >= 150, 'Weltstand mit Sim-Block (Tick ' + (sim && sim.tick) + ')');
    ok(!('faeden' in sim), 'kein Block welt.sim.faeden');
    ok(Object.keys(sim).every((k) => SIM_ERLAUBT.includes(k) || ['chronik', 'reise', 'regie'].includes(k)), 'jedes Feld von welt.sim ist ein bekanntes (' + Object.keys(sim).join(', ') + ')');
    if (!Object.keys(env).length) {
      ok(Object.keys(sim).every((k) => SIM_ERLAUBT.includes(k)), 'ohne jeden Schalter steht jedes Feld im Schema von main');
      const errs = Weltstand.fallbackValidate(data, MAIN);
      ok(errs.length === 0, 'der Pruefer akzeptiert den Stand gegen das Schema von main' + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : ''));
    }
    ok(Weltstand.validate(data, g).length === 0, 'und gegen das eigene Schema');
    ok(g.weltsim.faeden.t === 0 && g.weltsim.faeden.liste.length === 0 && Faden.toSave(g.weltsim) === null, 'die Hooks haben nichts gezaehlt, kein Faden');
    ok(g.errors === 0, 'keine Serverfehler');
  }
}

for (const seed of [7, 21, 33]) {
  console.log(`\nSeed ${seed}: mit FAEDEN=1`);
  const ohne = lauf(seed, {});
  const leer = lauf(seed, { FAEDEN: '1' });
  const mit = lauf(seed, { FAEDEN: '1' }, true);
  ok(zustand(ohne) === zustand(leer) && zustand(ohne) === zustand(mit), 'der Sim-Zustand nach 150 Spruengen ist bitgleich: ohne Schalter, mit Schalter ohne Faden, mit einer gespielten Geschichte (Faeden beruehren die Sim nie)');
  ok(JSON.stringify(ohne.weltsim.chronik) === JSON.stringify(leer.weltsim.chronik) && JSON.stringify(ohne.weltsim.ruf) === JSON.stringify(leer.weltsim.ruf) && JSON.stringify(ohne.weltsim.regie) === JSON.stringify(leer.weltsim.regie), 'auch Chronik, Ruf und Regie sind gleich');
  const data = Weltstand.capture(leer), sim = simBlock(data);
  ok(sim.faeden && sim.faeden.t >= 150 && !sim.faeden.liste, `mit Schalter und ohne Faden steht nur der Zaehler im Weltstand: ${JSON.stringify(sim.faeden)}`);
  ok(Weltstand.validate(data, leer).length === 0, 'das eigene Schema nimmt den Stand an');
  const errs = Weltstand.fallbackValidate(data, MAIN);
  ok(errs.some((e) => /faeden/.test(e) && /unbekanntes Feld/.test(e)), 'das Schema von main lehnt faeden ab („unbekanntes Feld“), die Pruefung hat Zaehne');
  const d2 = Weltstand.capture(mit), s2 = simBlock(d2);
  ok(s2.faeden && s2.faeden.liste.length === 1 && Weltstand.validate(d2, mit).length === 0, 'mit einem Faden: Block mit einem Faden, schemagueltig');
  ok(!JSON.stringify(s2).includes('Mireille') && !JSON.stringify(s2).includes('Ouzo') && !JSON.stringify(s2).includes('Tzvi'), 'keine Spielernamen im Sim-Block');
  // Rueckrichtung: ein Stand mit Faden laedt auch ohne Schalter; der Faden bleibt erhalten und wird wieder geschrieben (nichts geht verloren)
  const g2 = F.neuesSpiel({ crew: 3, seed, names: NAMEN, env: {} });
  Kriegslage.restore(g2.g, JSON.parse(JSON.stringify(s2)));
  ok(g2.g.weltsim.faeden.liste.length === 1 && Faden.toSave(g2.g.weltsim) && JSON.stringify(Faden.toSave(g2.g.weltsim)) === JSON.stringify(s2.faeden), 'ein Stand mit Faden laedt auch ohne Schalter (der Faden bleibt stehen und geht beim Speichern nicht verloren)');
  ok(mit.errors === 0 && leer.errors === 0 && ohne.errors === 0, 'keine Serverfehler');
}

console.log(`\n${n - fails} von ${n} ok`);
if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
