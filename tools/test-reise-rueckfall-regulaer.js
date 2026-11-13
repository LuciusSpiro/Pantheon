'use strict';
// FRE-05: im Rueckfall-Betrieb (kein Modell, Standard des Servers) fuehrt abenteuer-brett.js abenteuerRueckfallWeiter einen angenommenen REGULAEREN Brett-Faden (Geruecht, Spur, Konvoi, Geleit, Sabotage) bis zum Abschluss:
// Beat 0 startet nach dem Annehmen sofort, jeder spaetere Beat erst, wenn er faellig ist, die Frist beendet einen laufenden Beat. Geprueft werden (A) je Beat-Art und fuenf Seeds: Faden laeuft zu Ende, nichts bleibt gesperrt (ein Notruf-Angebot
// ist danach annehmbar), (B) Szenen-Beats (Gefecht, Konvoi, Geleit) in der Warteschlange von faden-szene.js: der Rueckfall wartet auf das Szenenende, kein Zombie-Faden, (C) Betrieb mit Modell bleibt unberuehrt (kein Doppeltreiben,
// der Mock-Treiber fuehrt jeden Faden genau einmal weiter), (D) Notruf-Faeden und Faeden ohne Plan fasst die Funktion nie an.
//   node tools/test-reise-rueckfall-regulaer.js        (npm run test:reise-rueckfall-regulaer; Mutationsprobe: npm run test:reise-rueckfall-regulaer-mutation)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Faden = require('./../server/sim/faden.js');
const D = require('../server/sim/faden-daten.js');
const P = require('../server/sim/faden-pruefer.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Mock = require('../server/sim/lage-mock.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };   // wie der echte Server im Rueckfall (ohne ABENTEUER_ABSICHTEN), kein Modell
const Fz = (g) => Faden.zustandVon(g);
const SEEDS = [7, 11, 23, 31, 47];
const FRIST = D.WERTE.beat_frist;
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const rangAb = (id) => lies('content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === id).ab;
const plan = (beats, titel) => ({ format: 'faden-bauplan/1', titel: titel || 'Testauftrag Eins', anlass: 'Ein Test ohne Namen fuer das Brett.', beats, volk_erlaubt: ['rom'] });
const ARTEN = {   // regulaere Beat-Arten mit dem Plan, den das Brett anbietet (anschluss.json: X > abschluss)
  geruecht: plan([{ typ: 'geruecht' }, { typ: 'abschluss' }]),
  spur: plan([{ typ: 'spur' }, { typ: 'abschluss' }]),
  konvoi: plan([{ typ: 'konvoi' }, { typ: 'abschluss' }]),
  geleit: plan([{ typ: 'geleit' }, { typ: 'abschluss' }]),
  sabotage: plan([{ typ: 'sabotage' }, { typ: 'abschluss' }]),
};
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];

function spiel(seed) {
  const g = F.neuesSpiel({ crew: 1, seed, env: ENV }).g;
  const fehler = []; g.countError = (wo, e) => { fehler.push(wo + ': ' + (e && e.message)); };
  g.weltsim.zustand.flotten = [];
  Fz(g).abenteuerAngebote.length = 0;   // der Spielstart legt schon ein regulaeres Angebot: leeres Brett
  Object.assign(g.weltsim.zustand.hexe['0703'], { besitzer: 'ger', posten: true, garnison: 4, anspruch: {} });   // ein Ziel fuer die Sabotage
  if (g.weltBesitz && g.weltBesitz.hexe['0703']) g.weltBesitz.hexe['0703'] = { besitzer: 'ger', posten: true };
  g.weltsim.ruf.rom = rangAb('miles');
  return { g, fehler };
}
// ein Angebot (Plan) anbieten und annehmen -> Faden
function annehmen(g, p) {
  const r = Faden.abenteuerAnbieten(g, p, { hex: Sektoren.hexVonOrt(g.ship.scene) });
  if (!r.ok) return { r };
  const e = Brett.annehmen(g, 'a' + r.angebot.nr);
  return { r, e, f: Fz(g).liste.find((x) => x.plan && x.vorlage === r.angebot.ref) };
}
// ein Takt der Sim, eine Taetigkeit (Andocken) davor: der Rueckfall fuehrt den Faden, die Frist zaehlt
const takt = (g, schritte) => { Faden.taetigkeit(g, 'andocken'); for (let i = 0; i < (schritte || 3); i++) g.step(); };
const beatsGestartet = (g, f) => logbuch(g).filter((e) => e.art === 'faden_ereignis' && e.ausgang === 'beat_start' && e.key === f.id).length;
const abgelehnt = (g) => logbuch(g).filter((e) => e.art === 'faden_pruefung' && e.ausgang === 'abgelehnt');
const notrufAn = (g) => Brett.notrufAnbieten(g, { nr: -1, id: 'notruf_havarie_reaktor', hex: '0603', variante: 'havarie', sprecher: 'Kutter Fortuna', marke: 'reise:n-1', ankunft: '0305' });

console.log('\nA: je Beat-Art und Seed: nach dem Annehmen startet Beat 0, der Faden laeuft zu Ende, das Brett ist frei');
for (const [art, p] of Object.entries(ARTEN)) {
  const ergebnis = [];
  for (const seed of SEEDS) {
    const { g, fehler } = spiel(seed);
    const { r, e, f } = annehmen(g, p);
    if (!(r.ok && e === null && f)) { ok(false, `${art} Seed ${seed}: Angebot oder Annehmen (${JSON.stringify(r.fehler || e)})`); ergebnis.push(false); continue; }
    const vorher = f.phase + f.beat;
    g.step();   // ein Takt: Beat 0 startet (Abstand uebersprungen)
    const gestartet = f.phase === 'laeuft' && f.beat === 0 && beatsGestartet(g, f) === 1;
    for (let i = 0; i < 80 && f.phase !== 'abgeschlossen'; i++) takt(g);
    // danach ist ein Notruf-Angebot annehmbar (kein laeuft_schon)
    notrufAn(g);
    const na = P.notrufAngebote(Fz(g))[0];
    const nr = na ? Brett.annehmen(g, 'a' + na.nr) : 'kein Notruf-Angebot';
    const ok1 = vorher === 'wartet0' && gestartet && f.phase === 'abgeschlossen' && f.ausgang && f.ausgang.art === 'gescheitert' && beatsGestartet(g, f) === 2;
    const ok2 = nr === null && P.abenteuerLaufend(Fz(g)) === 1 && g.errors === 0 && fehler.length === 0 && abgelehnt(g).length === 0;
    ergebnis.push(ok1 && ok2);
    if (!(ok1 && ok2)) ok(false, `${art} Seed ${seed}: Vorher ${vorher}, Beat 0 gestartet ${gestartet}, Phase ${f.phase}, Beats ${beatsGestartet(g, f)}, Notruf annehmen ${JSON.stringify(nr)}, laufend ${P.abenteuerLaufend(Fz(g))}, Fehler ${g.errors} ${fehler.slice(0, 2)}, abgelehnt ${abgelehnt(g).length}`);
  }
  ok(ergebnis.length === SEEDS.length && ergebnis.every(Boolean), `${art}: ${SEEDS.length} Seeds: Beat 0 startet, Faden abgeschlossen (gescheitert ohne Crew-Tat), kein Fehler, danach ein Notruf-Angebot annehmbar (nur dieses laeuft: abenteuerLaufend 1)`);
}
{   // Abstand: nur Beat 0 uebergeht ihn, ein spaeterer Beat wartet auf seine Faelligkeit
  const { g } = spiel(7);
  const { f } = annehmen(g, ARTEN.geruecht);
  g.step();
  for (let i = 0; i < FRIST + 1 && f.phase === 'laeuft'; i++) Faden.taetigkeit(g, 'andocken');
  g.step();   // Beat 0 ist durch die Frist zu Ende, Beat 1 (abschluss) wartet auf den Abstand
  ok(f.beat === 1 && f.phase === 'wartet' && f.zaehler < f.abstand, `Beat 1 steht nach der Frist (Zaehler ${f.zaehler}, Abstand ${f.abstand})`);
  g.step(); g.step();
  ok(f.beat === 1 && f.phase === 'wartet' && Brett.abenteuerRueckfallWeiter(g) === 0, 'Beat 1 startet nicht vor seinem Abstand (der Abstand wird nur bei Beat 0 uebersprungen)');
  for (let i = 0; i < 20 && f.zaehler < f.abstand; i++) Faden.taetigkeit(g, 'andocken');
  ok(Brett.abenteuerRueckfallWeiter(g) === 1 && f.phase === 'abgeschlossen', 'faellig: genau ein Beat, Faden abgeschlossen');
  ok(Brett.abenteuerRueckfallWeiter(g) === 0, 'ein abgeschlossener Faden wird nicht angefasst');
}

console.log('\nB: Szenen-Beats stehen in der Warteschlange von faden-szene.js (Abnahme 3)');
{   // angedockt: eine Szene beginnt erst nach dem Ablegen, der Eintrag wartet; die Frist beendet den Beat, die Warteschlange raeumt ab, nichts bleibt haengen
  const { g, fehler } = spiel(7);
  const { f } = annehmen(g, plan([{ typ: 'geruecht' }, { typ: 'raumschlacht' }, { typ: 'abschluss' }], 'Geruecht in Gefahr'));
  let eingereiht = false, szeneNie = true, doppelt = 0;
  for (let i = 0; i < 80 && f.phase !== 'abgeschlossen'; i++) {
    g.ship.docked = true;
    takt(g);
    if (f.beat === 1 && f.phase === 'laeuft') { eingereiht = eingereiht || (g.fadenWarte || []).length === 1; if (Brett.abenteuerRueckfallWeiter(g) !== 0) doppelt++; }
    if (g.fadenSzene) szeneNie = false;
  }
  g.step(); g.step();
  ok(eingereiht && szeneNie && doppelt === 0, 'angedockt: der Gefecht-Beat steht in der Warteschlange (Faden laeuft), keine Szene, der Rueckfall fuehrt den laufenden Beat nicht doppelt');
  ok(f.phase === 'abgeschlossen' && (g.fadenWarte || []).length === 0 && !g.fadenSzene, 'Frist beendet den Beat, Warteschlange leer, keine Szene, Faden abgeschlossen (kein Zombie)');
  ok(g.errors === 0 && fehler.length === 0 && abgelehnt(g).length === 0, 'keine Fehler, keine abgelehnten Befehle');
}
for (const art of ['konvoi', 'geleit']) {   // im Flug: Vorlauf, Kampf; der Rueckfall wartet auf das Szenenende, die Frist raeumt auf
  const { g, fehler } = spiel(7);
  g.ship.docked = false; g.ship.dockedAt = null; g.ship.x = g.space.w - 150; g.ship.y = g.space.h - 150; g.ship.vx = 0; g.ship.vy = 0;   // weit weg vom Liegeplatz: kein Andocken im Test
  const { f } = annehmen(g, ARTEN[art]);
  let k = 0, weiter = 0;
  for (; k < 3000 && !(g.fadenSzene && g.fadenSzene.phase === 'kampf'); k++) { g.step(); weiter += Brett.abenteuerRueckfallWeiter(g); }
  const tag = g.fadenSzene && g.fadenSzene.tag;
  ok(f.phase === 'laeuft' && f.beat === 0 && !!tag && weiter === 0 && Brett.abenteuerRueckfallWeiter(g) === 0, `${art}: im Flug beginnt die Szene (Kampf nach ${k} Takten), der Faden laeuft, der Rueckfall fuehrt ihn nicht weiter`);
  for (let i = 0; i < FRIST + 1; i++) Faden.taetigkeit(g, 'andocken');
  g.step(); g.step();
  ok(!g.fadenSzene && (g.fadenWarte || []).length === 0 && !g.space.enemies.some((e) => e.tag === tag), `${art}: die Frist beendet den Beat, die Szene ist weg (keine Gegner, keine Warteschlange)`);
  for (let i = 0; i < 40 && f.phase !== 'abgeschlossen'; i++) takt(g);
  ok(f.phase === 'abgeschlossen' && P.abenteuerLaufend(Fz(g)) === 0 && g.errors === 0 && fehler.length === 0 && !g.fadenSzene, `${art}: danach fuehrt der Rueckfall den Faden zum Abschluss, nichts bleibt haengen`);
}

{   // Gefecht im Flug: die Crew gewinnt (alle Gegner weg): die Szene meldet gelungen, der Rueckfall fuehrt danach den Abschluss
  const { g, fehler } = spiel(11);
  g.ship.docked = false; g.ship.dockedAt = null; g.ship.x = g.space.w - 150; g.ship.y = g.space.h - 150; g.ship.vx = 0; g.ship.vy = 0;
  const { r, f } = annehmen(g, plan([{ typ: 'raumschlacht' }, { typ: 'abschluss' }], 'Gefecht am Rand'));
  let k = 0;
  for (; f && k < 3000 && !(g.fadenSzene && g.fadenSzene.phase === 'kampf'); k++) g.step();
  const tag = g.fadenSzene && g.fadenSzene.tag;
  ok(!!f && !!tag && f.phase === 'laeuft' && g.space.enemies.some((e) => e.tag === tag) && Brett.abenteuerRueckfallWeiter(g) === 0, `Gefecht im Flug: Kampf mit Gegnern, der Faden laeuft (${r.ok ? 'Plan ok' : JSON.stringify(r.fehler)})`);
  g.space.enemies = [];   // die Crew hat gewonnen
  g.step(); g.step();
  ok(f.beat === 1 && f.phase === 'wartet' && !g.fadenSzene && (g.fadenWarte || []).length === 0, 'Szenenende (gelungen): der Beat ist zu Ende, der Abschluss wartet, keine Szene, keine Warteschlange');
  for (let i = 0; i < 40 && f.phase !== 'abgeschlossen'; i++) takt(g);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen' && P.abenteuerLaufend(Fz(g)) === 0 && g.errors === 0 && fehler.length === 0, `danach schliesst der Rueckfall den Faden ab (Ausgang ${f.ausgang && f.ausgang.art})`);
}

console.log('\nC: Betrieb mit Modell bleibt unberuehrt (kein Doppeltreiben)');
{
  const { g, fehler } = spiel(7);
  const sl = g.lageSpielleiter;
  const rb = sl.rueckfallBetrieb, modus = sl.mode;
  sl.rueckfallBetrieb = false; sl.mode = 'mock';   // ein Modell (hier: Mock) steuert die Faeden selbst: Spielleiter aktiv, aber kein Rueckfall-Betrieb
  const { f } = annehmen(g, ARTEN.geruecht);
  const r0 = Brett.abenteuerRueckfallWeiter(g);
  g.step(); g.step();
  ok(r0 === 0 && f.phase === 'wartet' && f.beat === 0 && beatsGestartet(g, f) === 0, `mit Modell startet der Rueckfall nichts (Rueckgabe ${r0}, Phase ${f.phase}, Beat ${f.beat})`);
  // der Mock-Treiber (lage-mock.js fadenBefehle) fuehrt jeden faelligen Faden weiter: genau einmal je Beat
  const treiber = () => {
    const prompt = '<ausschnitt>\n' + JSON.stringify({ faeden: Faden.ausschnittBlock(g) }) + '\n</ausschnitt>\n<grenze>\n{"nr":1,"art":"andocken"}\n</grenze>';
    let b = 0;
    for (const c of Mock.planVon({ prompt }).befehle) if (c.typ === 'faden_weiter' && Faden.befehlAnwenden(g, c).ok) b++;
    return b;
  };
  let getrieben = 0;
  for (let i = 0; i < 60 && f.phase !== 'abgeschlossen'; i++) {
    Faden.taetigkeit(g, 'andocken'); g.step(); getrieben += treiber();
    for (let k = 0; k < FRIST + 1 && f.phase === 'laeuft'; k++) Faden.taetigkeit(g, 'andocken');
  }
  ok(f.phase === 'abgeschlossen' && getrieben === 2 && beatsGestartet(g, f) === 2, `Mock-Treiber: jeder Beat genau einmal gestartet (${getrieben} Befehle, ${beatsGestartet(g, f)} Beats, Phase ${f.phase})`);
  ok(abgelehnt(g).length === 0 && g.errors === 0 && fehler.length === 0, 'keine abgelehnten Befehle (auch nicht FADEN_BELEGT durch Doppeltreiben), keine Fehler');
  sl.rueckfallBetrieb = rb; sl.mode = modus;
}

console.log('\nE: eine unerwartete Ablehnung des Pruefers wird einmal gezaehlt, nicht in jedem Takt');
{   // die Plaene des Bretts (X > abschluss, auch die des Inszenierers) lehnt der Pruefer ausser wegen ABSTAND nie ab; hier erzwungen: ein NSC im Zustand gefangen kann keinen Beat raumschlacht starten
  const { g, fehler } = spiel(7);
  const { f } = annehmen(g, plan([{ typ: 'geruecht' }, { typ: 'raumschlacht' }, { typ: 'abschluss' }], 'Geruecht in Gefahr'));
  for (let i = 0; i < 80 && f.beat < 1; i++) takt(g);
  f.nsc.status = 'gefangen'; f.zaehler = f.abstand;
  for (let i = 0; i < 10; i++) g.step();
  const mine = fehler.filter((x) => /abenteuer-brett-rueckfall/.test(x) && /STATUS_PASST_NICHT/.test(x));
  ok(f.beat === 1 && f.phase === 'wartet' && mine.length === 1, `STATUS_PASST_NICHT: genau ein Fehler in 10 Takten (${mine.length}), der Faden bleibt in Phase wartet (keine Abbruch-Funktion in faden.js: gemeldet, nicht behoben)`);
}

console.log('\nD: Notruf-Faeden und Faeden ohne Plan fasst die Funktion nie an');
{
  const { g, fehler } = spiel(11);
  const { f } = annehmen(g, ARTEN.geruecht);
  g.step();   // Beat 0 laeuft
  notrufAn(g);
  for (let i = 0; i < 80 && f.phase !== 'abgeschlossen'; i++) takt(g);   // ein Notruf-Faden kann erst nach dem regulaeren angenommen werden
  const na = P.notrufAngebote(Fz(g))[0];
  ok(!!na && Brett.annehmen(g, 'a' + na.nr) === null, 'ein Notruf-Angebot ist angenommen');
  const fn = Fz(g).liste.find((x) => P.notrufBrettFaden(x));
  fn.phase = 'wartet'; fn.laufend = null; fn.beat = 0; fn.zaehler = fn.abstand;   // wartet auf Beat 0, faellig
  const b0 = beatsGestartet(g, fn);
  ok(P.notrufBrettFaden(fn) && Brett.abenteuerRueckfallWeiter(g) === 0 && fn.phase === 'wartet' && beatsGestartet(g, fn) === b0, 'ein Notruf-Faden (Beat 0, wartet) bleibt unangetastet');
  fn.beat = 1; fn.zaehler = fn.abstand;
  ok(Brett.abenteuerRueckfallWeiter(g) === 0 && fn.phase === 'wartet', 'ein faelliger spaeterer Beat eines Notruf-Fadens bleibt unangetastet (das ist Sache von notrufRueckfallWeiter)');
  fn.beat = 0; const sicher = [fn.plan, fn.notruf]; delete fn.plan; delete fn.notruf;   // Faden ohne Plan und ohne Notruf-Marke (Altbestand)
  ok(Brett.abenteuerRueckfallWeiter(g) === 0 && fn.phase === 'wartet', 'ein Faden ohne Plan (Altbestand) bleibt unangetastet');
  fn.plan = sicher[0]; fn.notruf = sicher[1];
  ok(g.errors === 0 && fehler.length === 0, 'keine Fehler');
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
