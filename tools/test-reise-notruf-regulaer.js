'use strict';
// FRE-03 Nacharbeit N5: Notruf-Angebote zaehlen NICHT als regulaere Angebote. Vier Stellen sind auf P.regulaereAngebote umgestellt (FRE-03 D), jede mit einem Test, der drei Notruf-Angebote am Brett hat und sonst nichts:
//   offeneAngebote (abenteuer-spielleiter.js: Voll-Pruefung des Komponisten), die Zaehler im Prompt des Modells (abenteuer-prompt.js: abenteuer_angebote und laufend.angebote), der Filter der Wiederholungsregel Folge
//   (abenteuer-wiederholung.js: ein offenes Notruf-Angebot sperrt kein regulaeres Angebot gleicher Typenfolge) und der Sammelfunk (abenteuer-brett.js sammelHinweis: "N Auftraege am Brett" zaehlt keinen Notruf mit).
//   node tools/test-reise-notruf-regulaer.js        (npm run test:reise-notruf-regulaer; Mutationsprobe: npm run test:reise-notruf-regulaer-mutation)
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Faden = require('./../server/sim/faden.js');
const D = require('../server/sim/faden-daten.js');
const P = require('../server/sim/faden-pruefer.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Prompt = require('../server/sim/abenteuer-prompt.js');
const Wdh = require('../server/sim/abenteuer-wiederholung.js');
const Absicht = require('../server/sim/absicht-pruefer.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };
const BW = D.BRETT.werte;
const Fz = (g) => Faden.zustandVon(g);

function brettMitDreiNotrufen() {
  const g = F.neuesSpiel({ crew: 1, seed: 7, env: ENV }).g;
  g.weltsim.zustand.flotten = [];
  g.ship.scene = Sektoren.ortVonHex('0305');
  Fz(g).abenteuerAngebote.length = 0;   // der Spielstart legt schon ein regulaeres Angebot: leeres Brett
  const orte = ['0603', '0504', '0503'];
  orte.forEach((h, i) => Brett.notrufAnbieten(g, { nr: -(i + 1), id: 'notruf_havarie_reaktor', hex: h, variante: 'havarie', sprecher: 'Kutter ' + ['Fortuna', 'Sperber', 'Moewe'][i], marke: 'reise:n-' + (i + 1), ankunft: '0305' }));
  return g;
}

console.log('\nNotruf-Angebote sind nicht regulaer: drei Notruf-Angebote, kein regulaeres');
{
  const g = brettMitDreiNotrufen();
  ok(P.notrufAngebote(Fz(g)).length === 3 && P.regulaereAngebote(Fz(g)).length === 0, 'Ausgangslage: 3 Notruf-Angebote, 0 regulaere');
  // offeneAngebote: der Komponist darf noch anbieten (angebote_max bezieht sich auf regulaere)
  ok(g.lageSpielleiter.abenteuer.offeneAngebote() === 0, 'offeneAngebote() = 0 (die Voll-Pruefung des Komponisten sieht keine Notruf-Angebote), ist ' + g.lageSpielleiter.abenteuer.offeneAngebote());
  // Prompt: Zaehler der Fadenkontexte
  const kontext = JSON.stringify(Prompt.kontextVon(g, Prompt.WERTE, [], 0, '0305', false));
  ok(/"abenteuer_angebote":\[\]/.test(kontext), 'Prompt (kontextVon): abenteuer_angebote ist leer, die Notruf-Angebote stehen nicht darin');
  const bau = Prompt.baueAbsicht(g, { nr: 1, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: Prompt.WERTE, katalog: Absicht.katalogStandard() });
  ok(!bau.fehler && /"laufend":\{[^}]*"angebote":0[,}]/.test(bau.prompt), 'Prompt der Absichten: laufend.angebote = 0' + (bau.fehler ? ' (' + bau.fehler + ')' : ''));
  // Wiederholungsregel Folge: ein offenes Notruf-Angebot sperrt kein regulaeres Angebot gleicher Typenfolge
  const a = P.notrufAngebote(Fz(g))[0];
  ok(Wdh.pruefe(g, a.vorlage, '0305') === null, 'Wiederholungsregel: ein regulaeres Angebot mit der Typenfolge eines offenen Notruf-Angebots bleibt erlaubt (' + Wdh.pruefe(g, a.vorlage, '0305') + ')');
  // Sammelfunk: kein Funk, solange nur Notruf-Angebote da sind
  const funk = []; const emit0 = g.emit.bind(g); g.emit = (ev, d) => { if (ev === 'radio') funk.push(d.text); return emit0(ev, d); };
  ok(Brett.sammelHinweis(g) === false && funk.length === 0, 'Sammelfunk: 3 Notruf-Angebote ergeben keinen Funk "N Auftraege am Brett"');
  // ... und zaehlt mit einem regulaeren Angebot nur dieses
  const plan = { format: 'faden-bauplan/1', titel: 'Testauftrag Eins', anlass: 'Ein Test ohne Namen fuer das Brett.', beats: [{ typ: 'geruecht' }, { typ: 'abschluss' }], volk_erlaubt: ['rom'] };
  const r = Faden.abenteuerAnbieten(g, plan, { hex: '0305' });
  ok(r.ok && P.regulaereAngebote(Fz(g)).length === 1, 'ein regulaeres Angebot am Brett');
  funk.length = 0;
  ok(Brett.sammelHinweis(g) === true && funk.length === 1 && funk[0] === BW.sammel_text_eins, 'Sammelfunk mit 1 regulaerem + 3 Notruf-Angeboten: "' + (funk[0] || '') + '" (zaehlt nur das regulaere)');
  ok(g.errors === 0, 'keine Fehler');
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
