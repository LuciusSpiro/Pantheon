'use strict';
// SPT-02 1 (B1): ein Faden im Abschluss-Beat (b2_abschluss) schliesst auch im Betrieb MIT Modell ab, wenn das Modell nicht weiterfuehrt (abenteuer-brett.js abenteuerAbschlussWeiter). Geprueft werden (A) Abschluss-Beat im
// Live-Betrieb: nach dem Abstand abgeschlossen, vorher nicht, der Rueckfall tut dort weiter nichts, (B) Gegenprobe: ein Beat ohne abschluss im Live-Betrieb bleibt unberuehrt, (C) Notruf-Faeden und Faeden ohne Plan bleiben unberuehrt.
//   node tools/test-faden-auto-abschluss.js
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Faden = require('./../server/sim/faden.js');
const D = require('../server/sim/faden-daten.js');
const P = require('../server/sim/faden-pruefer.js');
const Brett = require('../server/sim/abenteuer-brett.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };
const Fz = (g) => Faden.zustandVon(g);
const plan = (beats, titel) => ({ format: 'faden-bauplan/1', titel: titel || 'Testauftrag Eins', anlass: 'Ein Test ohne Namen fuer das Brett.', beats, volk_erlaubt: ['rom'] });
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const beatsGestartet = (g, f) => logbuch(g).filter((e) => e.art === 'faden_ereignis' && e.ausgang === 'beat_start' && e.key === f.id).length;

// Betrieb mit Modell: Spielleiter aktiv (mode mock), aber kein Rueckfall-Betrieb; das "Modell" sendet nichts
function live(seed) {
  const g = F.neuesSpiel({ crew: 1, seed, env: ENV }).g;
  const fehler = []; g.countError = (wo, e) => { fehler.push(wo + ': ' + (e && e.message)); };
  g.weltsim.zustand.flotten = [];
  Fz(g).abenteuerAngebote.length = 0;
  g.lageSpielleiter.rueckfallBetrieb = false; g.lageSpielleiter.mode = 'mock';
  return { g, fehler };
}
function annehmen(g, p) {
  const r = Faden.abenteuerAnbieten(g, p, { hex: Sektoren.hexVonOrt(g.ship.scene) });
  if (!r.ok) return null;
  if (Brett.annehmen(g, 'a' + r.angebot.nr) !== null) return null;
  return Fz(g).liste.find((x) => x.plan && x.vorlage === r.angebot.ref) || null;
}
const weiter = (g, f) => (f.beat < 1 && (f.zaehler = Math.max(f.zaehler, f.abstand)), 0) || Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const taetig = (g, k) => { for (let i = 0; i < k; i++) Faden.taetigkeit(g, 'andocken'); };

console.log('\nA: Abschluss-Beat im Live-Betrieb schliesst nach dem Abstand ab');
for (const seed of [7, 11, 23]) {
  const { g, fehler } = live(seed);
  const f = annehmen(g, plan([{ typ: 'geleit' }, { typ: 'abschluss' }]));
  if (!f) { ok(false, `Seed ${seed}: Angebot oder Annehmen`); continue; }
  g.step();
  ok(f.phase === 'wartet' && f.beat === 0 && Brett.abenteuerRueckfallWeiter(g) === 0, `Seed ${seed}: mit Modell startet der Rueckfall nichts, Beat 0 wartet auf das Modell`);
  ok(weiter(g, f).ok && f.phase === 'laeuft', `Seed ${seed}: das Modell startet Beat 0 (geleit)`);
  taetig(g, D.WERTE.beat_frist + 1);
  g.step();
  ok(f.phase === 'wartet' && f.beat === 1 && B_ist_abschluss(f), `Seed ${seed}: die Frist beendet Beat 0 (gescheitert), Beat 1 ist der Abschluss und wartet (Modell fuehrt nicht weiter)`);
  ok(f.zaehler < f.abstand && Brett.abenteuerAbschlussWeiter(g) === 0 && f.phase === 'wartet', `Seed ${seed}: vor dem Abstand startet der Abschluss nicht (Zaehler ${f.zaehler}, Abstand ${f.abstand})`);
  for (let i = 0; i < 40 && f.zaehler < f.abstand; i++) taetig(g, 1);
  g.step();
  ok(f.phase === 'abgeschlossen' && f.ausgang && f.ausgang.art === 'gescheitert' && beatsGestartet(g, f) === 2, `Seed ${seed}: nach dem Abstand schliesst der Takt den Faden ab (Phase ${f.phase}, Ausgang ${f.ausgang && f.ausgang.art})`);
  ok(P.abenteuerLaufend(Fz(g)) === 0 && Brett.abenteuerAbschlussWeiter(g) === 0, `Seed ${seed}: nichts bleibt gesperrt (abenteuerLaufend 0), ein abgeschlossener Faden wird nicht angefasst`);
  ok(g.errors === 0 && fehler.length === 0, `Seed ${seed}: keine Fehler`);
}
function B_ist_abschluss(f) { const b = D.vorlage(f.vorlage).beats[f.beat]; return !!(D.BEATS[b.typ] && D.BEATS[b.typ].abschluss); }

console.log('\nB: Gegenprobe: ein Beat ohne abschluss bleibt im Live-Betrieb unberuehrt');
{
  const { g, fehler } = live(7);
  const f = annehmen(g, plan([{ typ: 'geruecht' }, { typ: 'raumschlacht' }, { typ: 'abschluss' }], 'Geruecht in Gefahr'));
  g.step();
  ok(f && weiter(g, f).ok, 'das Modell startet Beat 0');
  taetig(g, D.WERTE.beat_frist + 1); g.step();
  for (let i = 0; i < 40 && f.zaehler < f.abstand; i++) taetig(g, 1);
  ok(f.beat === 1 && f.phase === 'wartet' && f.zaehler >= f.abstand && !B_ist_abschluss(f), `Beat 1 (raumschlacht) ist faellig und wartet (Zaehler ${f.zaehler}, Abstand ${f.abstand})`);
  const b0 = beatsGestartet(g, f);
  for (let i = 0; i < 5; i++) g.step();
  ok(Brett.abenteuerAbschlussWeiter(g) === 0 && f.beat === 1 && f.phase === 'wartet' && beatsGestartet(g, f) === b0, 'der Takt und abenteuerAbschlussWeiter fuehren den Nicht-Abschluss-Beat nicht (das bleibt Sache des Modells)');
  ok(g.errors === 0 && fehler.length === 0, 'keine Fehler');
}

console.log('\nC: Faeden ohne Plan und Notruf-Faeden bleiben unberuehrt');
{
  const { g, fehler } = live(11);
  const f = annehmen(g, plan([{ typ: 'geruecht' }, { typ: 'abschluss' }]));
  g.step(); weiter(g, f); taetig(g, D.WERTE.beat_frist + 1); g.step();
  for (let i = 0; i < 40 && f.zaehler < f.abstand; i++) taetig(g, 1);
  const sicher = f.plan; delete f.plan;   // Altbestand ohne Plan
  ok(Brett.abenteuerAbschlussWeiter(g) === 0 && f.phase === 'wartet', 'ein Faden ohne Plan (Altbestand) bleibt unangetastet');
  f.plan = sicher; f.notruf = { marke: 'reise:n-1' };
  ok(Brett.abenteuerAbschlussWeiter(g) === 0 && f.phase === 'wartet', 'ein Notruf-Faden bleibt unangetastet (Sache von notrufRueckfallWeiter, wartet auf das Ende des Kampfes)');
  delete f.notruf;
  ok(Brett.abenteuerAbschlussWeiter(g) === 1 && f.phase === 'abgeschlossen', 'ohne diese Ausnahmen schliesst die Funktion den faelligen Abschluss ab');
  ok(g.errors === 0 && fehler.length === 0, 'keine Fehler');
}

console.log('\nD: ohne aktiven Spielleiter (Modus off, kein Rueckfall) fuehrt die Funktion nichts');
{
  const { g, fehler } = live(23);
  const f = annehmen(g, plan([{ typ: 'geruecht' }, { typ: 'abschluss' }]));
  g.step(); weiter(g, f); taetig(g, D.WERTE.beat_frist + 1); g.step();
  for (let i = 0; i < 40 && f.zaehler < f.abstand; i++) taetig(g, 1);
  g.lageSpielleiter.mode = 'off';
  ok(f.beat === 1 && f.phase === 'wartet' && Brett.abenteuerAbschlussWeiter(g) === 0 && f.phase === 'wartet', 'Spielleiter aus: der faellige Abschluss bleibt stehen (der Ausfall ist kein Auftrag zum Abschliessen)');
  g.lageSpielleiter.mode = 'mock';
  ok(Brett.abenteuerAbschlussWeiter(g) === 1 && f.phase === 'abgeschlossen' && g.errors === 0 && fehler.length === 0, 'Spielleiter da: der Abschluss laeuft');
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
