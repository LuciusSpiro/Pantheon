'use strict';
// FRE-03 A: Namensschutz in den Texten, die an das LLM gehen (abenteuer-absicht.js folgeInput, abenteuer-geschichte.js zeileFuer und kandidatenZeilen).
// Sie nutzen den Titel-Filter (lage-ausschnitt ohneNamenImTitel): Flexion hinter dem Namen ("Bos", "Bo's") faellt mit dem Namen weg, ein auf 12 Zeichen gekuerzt gespeicherter Name verschwindet auch voll
// ausgeschrieben, "Boje" und "Bordintelligenz" bleiben bei einem Spieler "Bo" lesbar. Spieler: "Bo" und "Zaubermeiste" (der Langname "Zaubermeister_Langername" ist im Spiel auf 12 Zeichen gekuerzt gespeichert).
// Die Erwartungen stehen hier selbst, nicht aus dem Produktivcode abgeleitet.
// Aufruf: node tools/test-namensschutz.js
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const Absicht = require('../server/sim/abenteuer-absicht.js');
const G = require('../server/sim/abenteuer-geschichte.js');

const { Faden, F } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const LANG = 'Zaubermeister_Langername', GEKUERZT = 'Zaubermeiste';
const SCHLECHT = ['Bos Schiff', "Bo's", 'Bo’s', 'Bo hilft', LANG, GEKUERZT];
const BLEIBT = ['Boje', 'Bordintelligenz'];
const ROH = ['Bos Schiff', "Bo's Fracht", 'Bo’s Fracht', 'Bo hilft', 'Boje', 'Bordintelligenz', LANG + ' meldet', GEKUERZT + ' im Funk'].join('; ');
const sauber = (s, wo) => {
  for (const x of SCHLECHT) ok(!s.includes(x), wo + ': "' + x + '" nicht im Ergebnis');
  for (const x of BLEIBT) ok(s.includes(x), wo + ': "' + x + '" bleibt unveraendert');
  ok(/Crew/.test(s), wo + ': an die Stelle der Namen tritt "Crew"');
};

function neu() {
  const t = F.neuesSpiel({ crew: 2, seed: 7, names: ['Bo', LANG], env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'off', SPIELLEITER_RUECKFALL: '1', ABENTEUER_ANSCHLUSS: '0' } });
  t.g.players[1].name = GEKUERZT;   // wie im Spiel gespeichert (server/game.js kuerzt auf 12 Zeichen)
  return t;
}

console.log('\n== folgeInput (abenteuer-absicht.js)');
{
  const g = neu().g;
  const v = { text: ROH };
  const r = Absicht.folgeInput(g, v, { format: 'absicht/1', absicht: 'spur', titel: 'x', parameter: {}, bezug: {}, bogen: { einsatz: 'x', wendung: 'keine', preis: 'y' }, ton: 'nuechtern' }, {}, 1);
  sauber(r.prompt, 'folgeInput');
}

console.log('\n== zeileFuer und kandidatenZeilen (abenteuer-geschichte.js)');
{
  const t = neu(), g = t.g;
  const plan = { format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats: [{ typ: 'notruf' }, { typ: 'abschluss' }] };
  const a = Faden.abenteuerAnbieten(g, plan, { hex: '0305' });
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  const f = r.faden;
  const v = require('./faden-fixture.js').D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) { f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 }; Faden.beatAusgang(g, f.id, 'gelungen'); }
  const name = 'Zed Miller';   // kein Spielername: die Zeile nennt den NSC mit Namen, nicht neutral
  f.nsc.name = name; f.nsc.fraktion = 'rom'; f.nsc.status = ROH; f.nsc.haltung = 1;
  const e = Faden.zustandVon(g).kanon.find((x) => x.f === f.id);
  e.name = name; e.volk = 'rom'; e.status = ROH;
  const z = G.geschichteZeilen(g, { werte: Object.assign({}, G.werte(), { zeile_max: 2000, zeichen_ziel: 100000 }) });
  ok(z.zeilen.length >= 1 && z.zeilen[0].startsWith('K1 ' + name), 'geschichteZeilen: die Zeile des NSC steht da');
  sauber(z.zeilen.join('\n'), 'zeileFuer');
  const k = G.kandidatenZeilen(g, null, { K1: name }, 1);
  // kandidatenZeilen nimmt die Namen als Liste (zweites Argument)
  const k2 = G.kandidatenZeilen(g, [name], { K1: name }, 1);
  ok(k2.length === 1 && k2[0].startsWith('K1 (rom)'), 'kandidatenZeilen: eine Zeile mit Kennung und Volk');
  sauber(k2.join('\n'), 'kandidatenZeilen');
  ok(Array.isArray(k) && k.length === 0, 'kandidatenZeilen ohne Namensliste: leer');
}

console.log(`\n${n - fails}/${n} gruen`);
process.exit(fails ? 1 : 0);
