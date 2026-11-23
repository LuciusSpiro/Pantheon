'use strict';
// SPT-01 Nacharbeit: die Verfallsanzeige des Auftragsbretts stimmt mit der Regel des Servers ueberein.
// Server: abenteuer-brett.js sendet rest = gilt - alter; faden.js zaehlt je Taetigkeit alter++ und behaelt alles mit alter <= gilt. Ein Angebot mit rest n ist also nach n Taetigkeiten NOCH da
// (rest 0) und erst nach n + 1 weg. Die Anzeige (PultAuftrag.verfall) darf bei n = 0 kein "noch 0 Ticks" und bei keinem n ein "verfaellt nach n Ticks" sagen.
// Der Test laeuft durch die echten Hooks (Snapshot des Bretts, game.lageGrenze); die Erwartung steht hier von Hand.
//   node tools/test-verfall-anzeige.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const PA = require('../public/js/pult-auftrag-tokens.js');
const { Faden, F } = X;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const GILT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content/faeden/werte.json'), 'utf8')).werte.abenteuer.wert.angebot_gilt_taetigkeiten;

function neu() {
  const t = F.neuesSpiel({ crew: 3, seed: 11, names: ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'], env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  return t.g;
}
const PLAN = { format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats: [{ typ: 'notruf' }, { typ: 'abschluss' }] };
const imBrett = (g, nr) => { const b = Brett.snapshot(g); return b && b.angebote.find((x) => x.id === 'a' + nr) || null; };

console.log('Geltungsdauer aus den Daten: ' + GILT);
for (const r of [GILT, 2, 1, 0]) {
  const g = neu();
  const a = Faden.abenteuerAnbieten(g, JSON.parse(JSON.stringify(PLAN)), { hex: '0305' });
  const e = g.weltsim.faeden.abenteuerAngebote.find((x) => !x.notruf);
  ok(!!a && !!e, 'rest ' + r + ': ein Angebot liegt aus');
  e.alter = GILT - r;
  const s0 = imBrett(g, e.nr);
  ok(s0 && s0.rest === r, 'rest ' + r + ': der Server meldet rest ' + r + ' (' + (s0 && s0.rest) + ')');
  const v = PA.verfall(s0.rest);
  for (let i = 0; i < r; i++) g.lageGrenze('andocken');
  const noch = imBrett(g, e.nr);
  ok(!!noch && noch.rest === 0, 'rest ' + r + ': nach ' + r + ' Ticks ist das Angebot NOCH da (rest ' + (noch && noch.rest) + ')');
  g.lageGrenze('andocken');
  ok(imBrett(g, e.nr) === null, 'rest ' + r + ': nach ' + (r + 1) + ' Ticks ist es weg');
  // Anzeige: n = 0 -> "verfaellt mit dem naechsten Tick", sonst "gilt noch ..."; nie "noch 0", nie "verfaellt nach"
  const text = v.kurz + ' / ' + v.lang;
  ok(!/noch 0|verfällt nach/.test(text), 'rest ' + r + ': Anzeige ohne "noch 0" und ohne "verfällt nach" (' + text + ')');
  if (r === 0) ok(v.lang === 'verfällt mit dem nächsten Tick' && v.bald, 'rest 0: "verfällt mit dem nächsten Tick" (stimmt: der nächste Tick nimmt es weg), bald');
  else ok(v.lang === (r === 1 ? 'gilt noch einen Tick' : 'gilt noch ' + r + ' Ticks') && v.kurz.endsWith(r === 1 ? 'noch 1 Tick' : 'noch ' + r + ' Ticks'), 'rest ' + r + ': "gilt noch ' + (r === 1 ? 'einen Tick' : r + ' Ticks') + '" (stimmt: ' + r + ' weitere Ticks übersteht es)');
}
console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLER' : 'alle ' + n + ' Pruefungen gruen'));
process.exit(fails ? 1 : 0);
