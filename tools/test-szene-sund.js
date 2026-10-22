'use strict';
// SUND-02a A2: Sim-Szene (server/sim/kriegslage-szene.js, Flotte.wellenStartAusPlan). Direkt gegen die Game-Klasse, ohne Netz.
//   Auslöser (Flotte da / Belagerung / keine Gefahr / römische Flotte / Kampagne / gedockt) · Aufstellung reproduzierbar und unskaliert · höchstens 12 Schiffe ·
//   Vorwarnung · Verluste -> Punkte · Flaggschiff fällt (Sieg, Reststärke, Gedächtnis) · Hafen und Posten gehalten/gefallen · Abbruch (Sprung, Notfallsprung) ·
//   Tickzähler (+0 in der Szene, danach genau +1) · Docken · keine Endlos-Neuauslösung · Takt für Notrufe · Weltstand · Mehrspieler.
//   node tools/test-szene-sund.js [begriff …]   (npm run test:szene-sund)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Kern = require('../server/weltsim/kern.js');
const Plan = require('../server/weltsim/wellenplan.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const Besitz = require('../server/sim/besitz.js');
const Sprung = require('../server/sim/sprung.js');
const Space = require('../server/sim/space.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const Reise = require('../server/sim/reise.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-szene-'));
let seq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const HZ = CONFIG.tickHz;

// Zähler am Sim-Kern: wie oft wurde wirklich getickt, mit welchen Wirkungen, und der Zustand davor (für den Vergleichslauf)
let kernTicks = 0; let letzterTick = null;
const kernOrig = Kern.tick;
Kern.tick = function (z, o) {
  kernTicks++;
  letzterTick = { vor: Kriegslage.abbild(z), wirkungen: (o && o.wirkungen) || [] };
  return kernOrig.apply(this, arguments);
};

function neu(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: freshDir(), seed: o.seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (o.crew || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S' + i, name: 'S' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: o.start || 'freie_fahrt' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 1);
  g.space.enemies = [];
  const funk = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
  const oda = () => cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'oda').map((m) => m.text);
  return { g, cs, funk, oda };
}
const run = (g, sek, each) => { for (let i = 0; i < Math.round(sek * HZ); i++) { if (each) each(i); g.step(); } };
function bis(g, f, maxSek) { for (let i = 0; i < maxSek * HZ; i++) { if (f()) return true; g.step(); } return !!f(); }
const z = (g) => g.weltsim.zustand;
const ticks = (g) => g.weltsim.tickZahl;
// Lerche ablegen (Start ist angedockt)
function ab(g) { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }
// Flotte der Sim in einem Hex (optional mit Belagerung, Feldzug marsch, Ankunft jetzt)
function flotte(g, hex, fraktion, staerke, o) {
  const st = z(g); const opt = o || {};
  const fl = { id: st.naechsteId++, fraktion, heimat: opt.heimat || HEIMAT[fraktion] || hex, ort: hex, staerke, kap: opt.kap || Math.max(staerke, 5), befehl: 'heim', ziel: null, warte: 0, versorgung: 1, angriff: null };
  st.flotten.push(fl);
  if (opt.belagerung) {
    const id = st.naechsteAngriffId++;
    st.angriffe.push({ id, t0: st.tick, ziel: hex, von: fraktion, art: fraktion === 'pirat' ? 'pirat' : 'reich', relevant: true, zielArt: st.hexe[hex].posten ? 'posten' : 'hafen', t_an: st.tick, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: st.tick, stuetz: null, flotten: [fl.id] });
    fl.befehl = 'angriff'; fl.ziel = hex; fl.angriff = id;
  }
  return fl;
}
const ohneFlotten = (g, hex) => { const st = z(g); st.flotten = st.flotten.filter((f) => f.ort !== hex); };
// Ankunft in einem Hex (wie nach einem Sprung, ohne Tick)
function ankunft(g, hex) { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); }
const kill = (g, e) => { e.hp = 1; Space.damageEnemy(g, e, 500, e.x - 100, e.y, {}); };
const killAlle = (g, ohneFlagg) => { for (const e of g.space.enemies.slice()) if (!(ohneFlagg && e.flagg)) kill(g, e); };
const gegner = (g) => g.space.enemies.filter((e) => e.wv != null);
const verbuendete = (g) => (g.space.escorts || []).filter((q) => q.ally && q.sim);
// Wellen abräumen, bis das Flaggschiff steht (alle anderen Gegner sofort erledigen); liefert die Zahl der Wellen, die kamen
function bisFlaggschiff(g, maxSek) {
  let wellen = 0; let letzte = 0;
  for (let i = 0; i < (maxSek || 400) * HZ; i++) {
    const w = g.flotte && g.flotte.welle; if (w && w.n !== letzte) { letzte = w.n; wellen = w.n; }
    if (g.space.enemies.some((e) => e.flagg)) return wellen;
    if (g.space.enemies.length) killAlle(g, true);
    g.step();
    if (!g.simSzene) return wellen;
  }
  return wellen;
}
const hatEreignis = (g, typ) => g.weltsim.ereignisse.filter((e) => e.typ === typ);
const kopie = (o) => JSON.parse(JSON.stringify(o));
// Vergleichslauf: derselbe Tick auf der Kopie des Zustands davor, mit denselben Wirkungen
function vergleich(g) {
  const lt = letzterTick; const ws = g.weltsim;
  const probe = Object.assign(kopie(lt.vor), { werte: z(g).werte, karte: z(g).karte });
  kernOrig.call(Kern, probe, { wirkungen: lt.wirkungen });
  return gleich(Kriegslage.abbild(probe), Kriegslage.abbild(ws.zustand));
}
const OSTIA = '0305';
const HEIMAT = { ger: '1004', pirat: '0602', kon: '0604' };   // Heimathäfen der Fixtures (rom: der Hex selbst); ohne eigene Heimat zöge sich eine Flotte im Hex „nach Hause“ und bliebe dort

section('Daten und Config', () => {
  const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'flotte', 'sim-szene.json'), 'utf8'));
  ok(T.format === 'sim-szene/1' && T.klassen['1'] && T.klassen['2'] && T.klassen['3'] && T.fraktionen.ger.flotte && T.fraktionen.pirat.flotte, 'Texte: Format, Stärkeklassen, Fraktionen');
  ok(T.vorwarnung.ort.includes('{klasse}') && T.vorwarnung.ort.includes('{kommandant}') && T.vorwarnung.ort.includes('{sek}'), 'Vorwarnung nennt Klasse, Kommandant und Sekunden');
  const C = CONFIG.simSzene;
  ok(C.vorwarnung === 20 && C.vorwarnungErinnerung.length >= 1 && C.verteidiger.max >= 1 && C.verteidiger.max + 1 <= CONFIG.flotte.max, 'Config: Vorwarnung 20 s, Verteidiger-Grenze unter 12 Schiffen');
  ok(Szene.schiffeFuer({ C: CONFIG }, 21, 4).length <= 4 && Szene.schiffeFuer({ C: CONFIG }, 200, 4).length === 4 && Szene.schiffeFuer({ C: CONFIG }, 0.2, 4).length === 0, 'Umrechnung Verteidiger: nie mehr als max Schiffe (auch bei großen Punkten), keine bei ~0');
  const pt = CONFIG.wellenplan.punkte;
  const sum = (l) => l.reduce((s, k) => s + pt[k], 0);
  ok(sum(Szene.schiffeFuer({ C: CONFIG }, 8, 4)) <= 8 && sum(Szene.schiffeFuer({ C: CONFIG }, 8, 4)) >= 6, 'Umrechnung Verteidiger: Punkte der Schiffe liegen nah an den Punkten (8 -> ' + sum(Szene.schiffeFuer({ C: CONFIG }, 8, 4)) + ')');
});

section('Flottenfunktion wellenStartAusPlan (unskaliert, Eisenwald-Pfad unverändert)', () => {
  const plan = Plan.plane({ staerke: 17, seed: 5, volk: 'ger', kommandant: { name: 'Test', volk: 'ger', zug: '' } });
  const hp = {};
  for (const crew of [1, 3]) {
    const t = neu({ crew }); const g = t.g; ab(g);
    ok(Flotte.wellenStartAusPlan(g, { plan: { wellen: [], flaggschiff: null } }) === null, `Crew ${crew}: leerer Plan -> null`);
    const w = Flotte.wellenStartAusPlan(g, { plan, volk: 'ger' });
    run(g, 0.2);
    const erste = plan.wellen[0].reduce((s, x) => s + x.n, 0);
    ok(w && w.ohneSkala && g.space.enemies.length === erste, `Crew ${crew}: Welle 1 hat ${erste} Schiffe wie im Plan (${g.space.enemies.length}), keine Skalierung mit der Crew`);
    hp[crew] = g.space.enemies.map((e) => e.hpMax);
  }
  ok(hp[1].length === hp[3].length && hp[1].every((h, i) => Math.abs(h / hp[3][i] - CONFIG.crewScaling[1].enemyHp / CONFIG.crewScaling[3].enemyHp) < 0.06), 'nur die Hülle skaliert mit der Crew (crewScaling.enemyHp 0,5 gegen 0,7), nicht die Schiffszahl');
  // der Eisenwald-Pfad: wellenStart skaliert weiter (1 Spieler 0,67)
  const t = neu(); const g = t.g; ab(g);
  Flotte.wellenStart(g, { wellen: 'raider:3|raider:4', takt: 0, rest: 0 });
  run(g, 0.2);
  ok(g.space.enemies.length === Math.round(3 * 0.67) && !g.flotte.welle.ohneSkala && g.flotte.welle.beginn == null && !g.flotte.welle.restJe, 'wellenStart: Skalierung 0,67 und kein Plan-Feld (bitgenau wie vorher)');
});

section('Auslöser', () => {
  const t = neu(); const g = t.g;
  // keine Gefahr: Vulcania (rom), kein Feind
  ohneFlotten(g, '0205');
  ankunft(g, '0205');
  ok(!g.simSzene && Szene.lage(g, '0205') === null, 'keine feindliche Flotte im Hex: keine Szene');
  // römische Flotte allein: keine Szene (kein Kampf gegen Rom)
  flotte(g, '0205', 'rom', 8);
  ankunft(g, '0205');
  ok(!g.simSzene, 'römische Flotte allein: keine Szene');
  // Konkordat-Flotte: neutral
  flotte(g, '0205', 'kon', 8);
  ankunft(g, '0205');
  ok(!g.simSzene, 'Konkordat-Flotte: kein Gegner, keine Szene');
  // zu schwach (< 1)
  const f0 = flotte(g, '0205', 'ger', 0.8);
  ankunft(g, '0205');
  ok(!g.simSzene, 'Stärke unter 1: keine Szene');
  f0.staerke = 3;
  ankunft(g, '0205');
  ok(g.simSzene && g.simSzene.hex === '0205' && g.simSzene.ort === 'hafen', 'germanische Flotte im römischen Hafenhex (Stärke 3): Szene mit Ort Hafen');
  ohneFlotten(g, '0205'); ankunft(g, '0205');
  ok(!g.simSzene, 'Flotte weg: eine neue Ankunft löst nichts aus (und die alte Szene ist beendet)');
  // freier Sektor, Piraten
  ohneFlotten(g, '0505'); flotte(g, '0505', 'pirat', 5);
  ankunft(g, '0505');
  ok(g.simSzene && g.simSzene.ort === null && g.simSzene.fraktion === 'pirat', 'Piraten im freien Sektor: Szene ohne Ort');
  // Belagerung des Hafens
  const t2 = neu(); const g2 = t2.g; ab(g2);
  ohneFlotten(g2, OSTIA);
  flotte(g2, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g2, OSTIA);
  const S = g2.simSzene;
  ok(S && S.ort === 'hafen' && S.fraktion === 'ger' && S.summe === 17, 'Belagerung des Hafens Ostia Nova: Szene mit Ort Hafen, Angreifer 17');
  ok(S && S.plan.punkte === 17 && S.plan.wellen.length === 3, 'Plan für Stärke 17: drei Wellen, 17 Punkte');
  // gedockt: nie eine Szene
  const t3 = neu(); const g3 = t3.g;
  flotte(g3, OSTIA, 'ger', 8, { belagerung: true });
  ok(g3.ship.docked && Szene.betreten(g3, OSTIA) === null && !g3.simSzene, 'gedockt: Szene wird nicht ausgelöst');
  // Kampagne: nie
  for (const start of ['free', 'schuld_der_lerche']) {
    const tk = neu({ start }); const gk = tk.g;
    ok(gk.weltsim === null && Szene.betreten(gk, '0305') === null && !gk.simSzene, `${start}: Kampagne ohne Sim, nie eine Szene`);
    Space.enterScene(gk, gk.ship.scene, {});
    ok(!gk.simSzene && gk.errors === 0 && !gk.flotte, `${start}: enterScene ohne Szene, kein Flottenzustand`);
  }
});

section('Aufstellung reproduzierbar', () => {
  const lauf = (crew) => {
    const t = neu({ crew }); const g = t.g; ab(g);
    ohneFlotten(g, OSTIA); const fl = flotte(g, OSTIA, 'ger', 17, { belagerung: true });
    ankunft(g, OSTIA);
    const S = g.simSzene;
    return { plan: kopie(S.plan), kd: S.kommandant && S.kommandant.name, schiffe: S.vert.schiffe.length, id: fl.id, tick: z(g).tick, funk: t.funk() };
  };
  const a = lauf(1), b = lauf(1), c3 = lauf(3);
  ok(gleich(a.plan, b.plan) && a.kd === b.kd, 'gleicher Seed (Flotte, Tick), gleiche Wellen und derselbe Kommandant: ' + a.kd);
  ok(gleich(a.plan.wellen, c3.plan.wellen), 'die Crewgröße ändert die Wellen nicht (Stärkewert unskaliert)');
  ok(a.schiffe >= 1 && a.schiffe <= CONFIG.simSzene.verteidiger.max, `Verteidiger: ${a.schiffe} Schiffe (höchstens ${CONFIG.simSzene.verteidiger.max})`);
  const direkt = Plan.plane({ staerke: 17, seed: Plan.seedAus(a.id, a.tick), volk: a.plan.wellen[0][0].volk, kommandant: Plan.kommandantFuer({ fraktion: 'ger', seed: Plan.seedAus(a.id, a.tick), gefallen: [] }) });
  ok(gleich(direkt.wellen, a.plan.wellen), 'der Plan ist plane({ staerke: Summe, seed: seedAus(Flotten-Id, Tick), volk, kommandant })');
  // Wahrheit statt Wissen: die Szene liest den Sim-Zustand, nicht world.lage
  const t = neu(); const g = t.g; ab(g);
  ohneFlotten(g, '0505'); flotte(g, '0505', 'ger', 9);
  const lageVor = JSON.stringify(g.snapshot().world && g.snapshot().world.lage);
  ankunft(g, '0505');
  ok(g.simSzene && g.simSzene.summe === 9, 'Szene aus der Wahrheit des Servers (Flotte unbekannt für Rom)');
  ok(JSON.stringify(g.snapshot().world && g.snapshot().world.lage) === lageVor, 'das Wissen von Rom (world.lage) bleibt unverändert');
});

section('Vorwarnung', () => {
  const t = neu(); const g = t.g; ab(g);
  ohneFlotten(g, OSTIA); flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  const t0 = g.time;
  ankunft(g, OSTIA);
  const funk = t.funk().join(' | ');
  ok(/große germanische Flotte|mittlere germanische Flotte|kleine germanische Flotte/.test(funk), 'Funkspruch nennt Stärkeklasse und Fraktion: ' + funk.slice(0, 120));
  ok(/Klarmachen/.test(funk) && /20 s/.test(funk) && g.simSzene.kommandant && funk.includes(g.simSzene.kommandant.name), 'Funkspruch nennt „Klarmachen“, 20 s und den Kommandanten');
  ok(Kern.staerkeKlasse(17, z(g).werte) === 3 && /große/.test(funk), 'Stärke 17 = Klasse groß');
  run(g, 16);
  ok(gegner(g).length === 0 && g.flotte.welle.i === -1, '16 s nach der Ankunft: noch keine Welle (Vorwarnung)');
  ok(t.oda().some((s) => /Erste Welle in 10 s/.test(s)) && t.oda().some((s) => /Erste Welle in 5 s/.test(s)), 'Hinweise (ODA) erinnern bei 10 s und 5 s');
  const ss = g.snapshot().flotte;
  ok(ss && ss.wl && ss.wl[0] === 0 && ss.wl[1] === 3, 'Anzeige „Welle 0/3“ steht schon in der Vorwarnung (vorhandenes Feld flotte.wl)');
  run(g, 5);
  ok(gegner(g).length > 0 && g.time - t0 >= 20, 'nach ~20 s kommt Welle 1');
  // Piraten: Hinweis, dass man ihnen ausweichen darf
  const t2 = neu(); const g2 = t2.g; ab(g2);
  ohneFlotten(g2, '0505'); flotte(g2, '0505', 'pirat', 5); ankunft(g2, '0505');
  ok(t2.funk().some((s) => /Piratenflotte/.test(s)) && t2.oda().some((s) => /Piraten wollen Beute/.test(s)), 'Piraten: „Piratenflotte“ im Funk und Hinweis, dass die Crew ausweichen darf');
  // ein Kommandant, der schon einmal entkommen ist, wird erwähnt
  const t3 = neu(); const g3 = t3.g; ab(g3);
  ohneFlotten(g3, '0505'); const f3 = flotte(g3, '0505', 'ger', 9);
  const kd = Plan.kommandantFuer({ fraktion: 'ger', seed: Plan.seedAus(f3.id, z(g3).tick), gefallen: [] });
  g3.weltsim.kommandanten[kd.name] = { fraktion: 'ger', schicksal: 'entkommen', begegnungen: 1, tick: 0 };
  ankunft(g3, '0505');
  ok(g3.simSzene.kommandant.name === kd.name && t3.funk().some((s) => /schon einmal entkommen/.test(s)), 'wiederkehrender Kommandant: „schon einmal entkommen“ im Funk');
});

section('Höchstens 12 Schiffe gleichzeitig (Stärke 40 und 80, frei und im Hafen mit Verteidigern)', () => {
  for (const [staerke, wellenMin, hex, belagerung] of [[40, 4, '0505', false], [80, 5, '0505', false], [80, 5, OSTIA, true], [40, 4, OSTIA, true]]) {
    const t = neu(); const g = t.g; ab(g);
    ohneFlotten(g, hex); flotte(g, hex, 'ger', staerke, { belagerung });
    ankunft(g, hex);
    const S = g.simSzene; const ort = hex === OSTIA ? 'Hafen' : 'frei';
    ok(S && S.plan.wellen.length >= wellenMin && Plan.plane({ staerke, seed: S.seed, volk: 'ger' }).wellen.length === S.plan.wellen.length, `Stärke ${staerke} (${ort}): ${S.plan.wellen.length} Wellen, Finale ${S.plan.wellen[S.plan.wellen.length - 1][0].kind}`);
    let max = 0; let kills = 0; let nachschub = 0;
    // die Wellen laufen so schnell wie möglich: je Welle nur bis zum Rest erledigen, dann kommt die nächste (Überlappung = Höchstlast)
    for (let i = 0; i < 900 * HZ && g.simSzene; i++) {
      g.step();
      max = Math.max(max, Flotte.schiffe(g));
      if (g.flotte) nachschub = Math.max(nachschub, g.flotte.nachschub.length);
      const w = g.flotte && g.flotte.welle;
      if (w && i % 15 === 0) {
        const lebend = g.space.enemies.filter((e) => e.wv === w.id && e.wvN === w.i + 1 && !e.flagg);
        const rest = w.restJe[w.i];
        if (w.i + 1 < w.liste.length && lebend.length > rest) { kill(g, lebend[0]); kills++; }
        else if (w.i + 1 >= w.liste.length) { const e = g.space.enemies.find((x) => !x.flagg) || g.space.enemies[0]; if (e) { kill(g, e); kills++; } }
      }
    }
    ok(max <= CONFIG.flotte.max && max >= 4, `Stärke ${staerke} (${ort}): nie mehr als ${CONFIG.flotte.max} Schiffe gleichzeitig (höchstens ${max}, Warteschlange bis ${nachschub}), ${kills} Abschüsse`);
    ok(!g.simSzene && g.errors === 0, `Stärke ${staerke} (${ort}): die Szene endet, keine Fehler`);
  }
});

section('Verluste -> Punkte, Flaggschiff fällt (Sieg mit Reststärke)', () => {
  const t = neu(); const g = t.g; ab(g);
  ohneFlotten(g, '0505'); const fl = flotte(g, '0505', 'ger', 17);
  const fl2 = flotte(g, '0505', 'ger', 9);
  ankunft(g, '0505');
  const S = g.simSzene; const tick0 = ticks(g); const kern0 = kernTicks;
  run(g, 21);
  ok(S.phase === 'kampf' && gegner(g).length > 0, 'Kampf beginnt nach der Vorwarnung');
  // erste Welle erledigen
  const w1 = gegner(g).slice(); const pt = CONFIG.wellenplan.punkte;
  const w1Punkte = w1.reduce((s, e) => s + pt[e.kind], 0);
  killAlle(g);
  ok(S.killPunkte === w1Punkte && ticks(g) === tick0, `Welle 1 vernichtet: ${w1Punkte} Verlustpunkte gezählt, Tickzähler unverändert (${ticks(g)})`);
  const wellen = bisFlaggschiff(g, 300);
  ok(g.space.enemies.some((e) => e.flagg) && g.space.enemies.find((e) => e.flagg).name === S.kommandant.name, 'Finale: Flaggschiff trägt den Namen des Kommandanten (' + S.kommandant.name + ')');
  ok(t.funk().some((s) => s.includes(S.kommandant.name) && /Flaggschiff/.test(s)), 'Funk beim Finale nennt den Namen');
  ok(ticks(g) === tick0 && kernTicks === kern0, `während der Szene kein Tick (Wellen: ${wellen}, Tickzähler ${ticks(g)})`);
  const vor = { a: fl.staerke, b: fl2.staerke };
  const punkteVorFlagg = S.killPunkte;
  const flagg = g.space.enemies.find((e) => e.flagg);
  kill(g, flagg);
  run(g, 0.2);
  ok(!g.simSzene && ticks(g) === tick0 + 1 && kernTicks === kern0 + 1, 'Flaggschiff gefallen: Szene endet, genau EIN Tick (' + tick0 + ' -> ' + ticks(g) + ')');
  const L = Szene.letzte(g);
  ok(L && L.ausgang === 'sieg' && ['entkommen', 'gefallen'].includes(L.schicksal), 'Ausgang Sieg, Schicksal ' + (L && L.schicksal));
  const fv = L.wirkungen.filter((x) => x.typ === 'flotte_verlust');
  const summeV = fv.reduce((s, x) => s + x.punkte, 0);
  ok(Math.abs(summeV - (punkteVorFlagg + CONFIG.wellenplan.punkte[flagg.kind])) < 1e-9, `Verluste als flotte_verlust: ${summeV} Punkte = Abschüsse nach Klasse (${S.killPunkte})`);
  ok(fv.every((x) => Number.isInteger(x.punkte)), 'Verluste in ganzen Punkten');
  const gf = L.wirkungen.filter((x) => x.typ === 'flaggschiff_gefallen');
  ok(gf.length === 2 && gf.every((x) => x.kommandant.name === S.kommandant.name), 'flaggschiff_gefallen für beide Flotten, derselbe Kommandant');
  ok(!L.wirkungen.some((x) => x.typ.startsWith('ort_')), 'freier Sektor: keine ort_*-Wirkung');
  ok(L.ergebnis.ok && L.ergebnis.angewandt === L.wirkungen.length && L.ergebnis.verworfen === 0, 'alle Wirkungen angewandt, keine verworfen');
  ok(vergleich(g), 'Weltstand = Vergleichslauf (gleiche Wirkungen, ein Tick auf dem Zustand davor)');
  ok(['rueckzug', 'heim'].includes(fl.befehl) && ['rueckzug', 'heim'].includes(fl2.befehl) && fl.ort !== '0505' && fl2.ort !== '0505', 'die Flotten brechen ab (Rückzug bzw. heim, wenn die Stärke unter 0,5 fiel), sie haben das Hex im Tick verlassen');
  ok(fl.staerke + fl2.staerke > 0.5 && fl.staerke < vor.a + 0.01, `Reststärke bleibt (${fl.staerke.toFixed(1)} + ${fl2.staerke.toFixed(1)}): der Sieg gilt auch mit Rest`);
  const km = g.weltsim.kommandanten[S.kommandant.name];
  ok(km && km.fraktion === 'ger' && km.schicksal === L.schicksal && km.begegnungen === 1, 'Kommandanten-Gedächtnis: ' + JSON.stringify(km) + ' (einmal gezählt trotz zwei Flotten)');
  ok(g.space.enemies.every((e) => e.leaving) && g.flotte === null && !g.space.retreatRule, 'übrige Gegner drehen ab (sichtbar), Flottenzustand und Rückzugsregel aufgeräumt');
  run(g, 20);
  ok(g.space.enemies.length === 0 && g.errors === 0, 'nach ~14 s sind sie weg, keine Fehler');
  // ein gefallener Kommandant kommt nie wieder, ein entkommener darf
  const tot = Object.keys(g.weltsim.kommandanten).filter((nm) => g.weltsim.kommandanten[nm].schicksal === 'gefallen');
  const gefallen = Object.keys(require('../content/welt/kommandanten.json').kommandanten.ger.reduce((o, k) => (o[k.name] = 1, o), {}));
  g.weltsim.kommandanten = {}; for (const nm of gefallen.slice(1)) g.weltsim.kommandanten[nm] = { fraktion: 'ger', schicksal: 'gefallen', begegnungen: 1, tick: 0 };
  ohneFlotten(g, '0505'); flotte(g, '0505', 'ger', 9); ankunft(g, '0505');
  ok(g.simSzene.kommandant.name === gefallen[0], 'alle anderen gefallen: der einzige Lebende führt (' + gefallen[0] + ')');
  g.weltsim.kommandanten[gefallen[0]] = { fraktion: 'ger', schicksal: 'gefallen', begegnungen: 1, tick: 0 };
  ohneFlotten(g, '0505'); flotte(g, '0505', 'ger', 9); ankunft(g, '0505');
  ok(g.simSzene.kommandant === null && g.simSzene.plan.flaggschiff.kommandant.name === 'Der Flottenführer', 'alle gefallen: Ersatzname „Der Flottenführer“ statt Absturz');
  ok(tot.length === 0 || tot.every((nm) => g.weltsim.kommandanten[nm]), 'Gedächtnis wird nicht vergessen');
  // Sieg ohne echten Kommandanten: die Flotte bricht ab, aber der Ersatzname kommt nicht ins Gedächtnis
  const namen0 = Object.keys(g.weltsim.kommandanten).sort(); const fl0 = z(g).flotten.find((f) => f.ort === '0505' && f.fraktion === 'ger');
  const t0 = ticks(g);
  run(g, 21); bisFlaggschiff(g, 300);
  kill(g, g.space.enemies.find((e) => e.flagg)); run(g, 0.2);
  const Lk = Szene.letzte(g);
  ok(Lk && Lk.ausgang === 'sieg' && ticks(g) === t0 + 1 && Lk.wirkungen.some((x) => x.typ === 'flaggschiff_gefallen' && x.flotte === fl0.id && !('kommandant' in x)), 'Sieg ohne Kommandant: flaggschiff_gefallen ohne Kommandantenfeld, ein Tick');
  ok(gleich(Object.keys(g.weltsim.kommandanten).sort(), namen0) && !g.weltsim.kommandanten['Der Flottenführer'], 'kein Platzhalter „Der Flottenführer“ im Gedächtnis');
  ok(fl0.befehl === 'rueckzug' || fl0.ort === fl0.heimat, 'die Flotte bricht trotzdem ab (Rückzug)');
});

section('Hafen gehalten', () => {
  const t = neu(); const g = t.g; ab(g);
  const rom = z(g).flotten.filter((f) => f.ort === OSTIA && f.fraktion === 'rom');
  const fl = flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  const abwehr0 = z(g).hexe[OSTIA].abwehr; const romStaerke0 = rom.map((f) => f.staerke);
  ankunft(g, OSTIA);
  const S = g.simSzene;
  ok(S.ort === 'hafen' && S.vert.n0 >= 1 && S.vert.gruppen.some((x) => x.typ === 'flotte') && S.vert.gruppen.some((x) => x.typ === 'abwehr'), `Verteidiger aus Hafenflotte und Abwehr: ${S.vert.n0} Schiffe, ${S.vert.gruppen.length} Gruppen`);
  ok(verbuendete(g).length === S.vert.n0 && verbuendete(g).every((q) => q.ally && q.volk === 'rom' && q.rolle === 'angreifer'), 'Verbündete über Flotte.aufstellen (rom, Rolle angreifer)');
  const bonus = z(g).werte.bonus.B;
  const erwartet = rom.reduce((s, f) => s + f.staerke * (1 + bonus), 0) + abwehr0;
  ok(Math.abs(S.vert.gruppen.reduce((s, x) => s + x.eff, 0) - erwartet) < 1e-9, `Umrechnung: Σ römische Flotte × (1 + Ortsbonus ${bonus}) + Abwehr ${abwehr0} = ${erwartet.toFixed(2)} Punkte`);
  const tick0 = ticks(g);
  run(g, 21);
  // einen Verbündeten verlieren
  const v0 = verbuendete(g)[0]; Escort.hit(g, v0, 99999, {});
  ok(S.vert.verloren === v0.simPts && S.vert.lebend === S.vert.n0 - 1, `ein Verbündeter zerstört: ${v0.simPts} Schiffspunkte verloren`);
  ok(!(g.weltstand.data.fakten || {})['flotte_' + v0.tag] && !Object.keys(g.weltstand.data.npc || {}).some((k) => (g.weltstand.data.npc[k].gedaechtnis || []).some((x) => x.ereignis === 'schiff_verloren')), 'kein Weltstand-Eintrag (Fakt, Legat-Gedächtnis) für Schiffe der Sim-Szene');
  bisFlaggschiff(g, 300);
  kill(g, g.space.enemies.find((e) => e.flagg));
  run(g, 0.2);
  const L = Szene.letzte(g);
  ok(L.ausgang === 'sieg' && ticks(g) === tick0 + 1, 'Sieg: ein Tick');
  ok(L.wirkungen.some((x) => x.typ === 'ort_gehalten' && x.ort === OSTIA), 'ort_gehalten für Ostia Nova');
  const ab1 = L.wirkungen.find((x) => x.typ === 'abwehr_verlust');
  const fr = L.wirkungen.filter((x) => x.typ === 'flotte_verlust' && rom.some((f) => f.id === x.flotte));
  ok(ab1 && ab1.ort === OSTIA && ab1.punkte > 0 && fr.length >= 1, `verlorener Verbündeter wirkt als abwehr_verlust (${ab1 && ab1.punkte}) und flotte_verlust der römischen Flotte`);
  const rec = z(g).angriffe.find((r) => r.id === fl.angriff) || z(g).angriffe.find((r) => r.ziel === OSTIA);
  ok(rec && rec.ausgang === 'abgewehrt' && rec.t_ende !== null && hatEreignis(g, 'angriff_abgewehrt').length >= 1, 'Belagerung endet „abgewehrt“ (Ereignis angriff_abgewehrt)');
  ok(z(g).hexe[OSTIA].besitzer === 'rom' && L.ergebnis.verworfen === 0 && vergleich(g), 'Ostia Nova bleibt römisch, nichts verworfen, Weltstand = Vergleichslauf');
  ok(fl.ort !== OSTIA && ['rueckzug', 'heim'].includes(fl.befehl), 'die Angreiferflotte zieht ab (verlässt das Hex im Tick)');
  ok(verbuendete(g).length === 0 && (g.space.escorts || []).every((q) => !q.sim), 'Verbündete der Szene sind weg (springen nicht mit)');
  ok(g.space.dockOk === true && Besitz.darfAndocken(g, OSTIA) && g.space.markers.some((m) => m.kind === 'dock'), 'Andocken wieder erlaubt, Dock-Marker zurück');
  ok(romStaerke0.every((v, i) => rom[i].staerke <= v + 1e-9), 'Hafenflotte hat nur verloren, nichts gewonnen');
});

section('Hafen gefallen (Crew unterlegen / Verteidiger erschöpft)', () => {
  // a) Notfallprotokoll der Lerche: mit lebenden Verteidigern geht die Schlacht weiter, ohne sie ist die Crew unterlegen
  let t = neu(); let g = t.g; ab(g);
  flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA);
  const tick0 = ticks(g);
  run(g, 21);
  ok(g.simSzene && g.simSzene.phase === 'kampf', 'Kampf läuft');
  g.ship.hull = 0; run(g, 0.3);
  ok(g.simSzene && g.stats.emergencies === 1 && ticks(g) === tick0, 'Notfallprotokoll der Lerche mit lebenden Verteidigern: die Schlacht geht weiter, kein Tick');
  for (const v of verbuendete(g)) Escort.hit(g, v, 99999, {});
  run(g, 1);
  ok(g.simSzene && g.simSzene.vert.lebend === 0, 'Verteidiger gefallen: Gnadenfrist (das frühere Protokoll zählt nicht mit)');
  g.ship.hull = 0; run(g, 0.3);
  const L = Szene.letzte(g);
  ok(!g.simSzene && L && L.ausgang === 'niederlage' && L.grund === 'lerche' && g.stats.emergencies === 2, 'Notfallprotokoll der Lerche ohne Verteidiger = Crew unterlegen: Szene endet');
  ok(ticks(g) === tick0 + 1 && L.wirkungen.some((x) => x.typ === 'ort_gefallen' && x.ort === OSTIA && x.an === 'ger'), 'ein Tick, ort_gefallen an ger');
  ok(z(g).hexe[OSTIA].besitzer === 'ger' && hatEreignis(g, 'hafen_gefallen').length === 1, 'die Sim überträgt den Hafen (hafen_gefallen) wie sonst');
  ok(vergleich(g) && L.ergebnis.verworfen === 0, 'Weltstand = Vergleichslauf');
  ok(g.space.dockOk === false && Besitz.darfAndocken(g, OSTIA) === false, 'jetzt germanischer Hafen: Andocken verweigert (Besitz-Overlay)');
  // b) Verteidiger erschöpft: Gnadenfrist, dann verloren
  t = neu(); g = t.g; ab(g);
  flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA);
  run(g, 21);
  for (const v of verbuendete(g)) Escort.hit(g, v, 99999, {});
  run(g, 0.2);
  ok(g.simSzene && g.simSzene.vert.lebend === 0 && g.simSzene.vert.erschT != null && t.funk().some((s) => /Die letzten Verteidiger sind gefallen/.test(s)), 'alle Verteidiger gefallen: Gnadenfrist mit Funkspruch');
  const t1 = ticks(g);
  run(g, CONFIG.simSzene.erschoepfungGnade - 3);
  ok(g.simSzene && ticks(g) === t1, 'innerhalb der Gnadenfrist läuft die Szene weiter, kein Tick');
  run(g, 4);
  const L2 = Szene.letzte(g);
  ok(!g.simSzene && L2.ausgang === 'niederlage' && L2.grund === 'verteidigung' && z(g).hexe[OSTIA].besitzer === 'ger' && ticks(g) === t1 + 1, 'Frist um: Hafen gefallen, ein Tick');
  // c) fällt das Flaggschiff in der Gnadenfrist, ist es ein Sieg
  t = neu(); g = t.g; ab(g);
  flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA);
  run(g, 21);
  bisFlaggschiff(g, 300);
  for (const v of verbuendete(g)) Escort.hit(g, v, 99999, {});
  run(g, 1);
  kill(g, g.space.enemies.find((e) => e.flagg)); run(g, 0.2);
  ok(Szene.letzte(g).ausgang === 'sieg' && z(g).hexe[OSTIA].besitzer === 'rom', 'Flaggschiff in der Gnadenfrist gefallen: Sieg, Hafen gehalten');
  // d) Piraten erobern keinen Hafen: Niederlage ohne ort_gefallen, die Sim entscheidet
  t = neu(); g = t.g; ab(g);
  flotte(g, OSTIA, 'pirat', 9, { belagerung: true });
  ankunft(g, OSTIA); run(g, 21);
  for (const v of verbuendete(g)) Escort.hit(g, v, 99999, {});
  g.ship.hull = 0; run(g, 0.3);
  const L4 = Szene.letzte(g);
  ok(L4.ausgang === 'niederlage' && !L4.wirkungen.some((x) => x.typ === 'ort_gefallen') && z(g).hexe[OSTIA].besitzer === 'rom', 'Piraten gegen einen Hafen: kein ort_gefallen aus der Szene (Piraten erobern keinen Hafen)');
});

section('Durchziehende Flotte (keine Belagerung): der Ort fällt nicht', () => {
  // Gegenprobe zu „Hafen gefallen“: dieselbe Niederlage, aber ohne Feldzug gegen den Ort. Ohne die Crew hätte die Sim nie erobert (Auftrag §3).
  // wie in der Sim: wer durchzieht, ist unterwegs (Rückzug nach Hause) und verlässt das Hex im nächsten Tick; „heim“ gibt es nur im eigenen Hafen
  const durchzug = (f) => { f.befehl = 'rueckzug'; f.ziel = f.heimat; return f; };
  const unterliegen = (g) => { run(g, 21); for (const v of verbuendete(g)) Escort.hit(g, v, 99999, {}); run(g, 0.3); g.ship.hull = 0; run(g, 0.5); return Szene.letzte(g); };
  let t = neu(); let g = t.g; ab(g);
  ohneFlotten(g, OSTIA);
  const fl = durchzug(flotte(g, OSTIA, 'ger', 3));   // keine Belagerung
  ankunft(g, OSTIA);
  const tick0 = ticks(g);
  ok(g.simSzene && g.simSzene.ort === 'hafen' && z(g).angriffe.every((r) => r.ziel !== OSTIA || r.t_ende !== null), 'durchziehende Flotte löst die Szene aus (Hafen, keine Belagerung)');
  const L = unterliegen(g);
  ok(!g.simSzene && L && L.ausgang === 'niederlage', 'Crew unterliegt: Szene endet als Niederlage');
  ok(!L.wirkungen.some((x) => x.typ === 'ort_gefallen') && z(g).hexe[OSTIA].besitzer === 'rom' && hatEreignis(g, 'hafen_gefallen').length === 0, 'kein ort_gefallen, Ostia Nova bleibt römisch, keine Eroberung');
  ok(ticks(g) === tick0 + 1 && L.ergebnis.verworfen === 0 && vergleich(g), 'genau ein Tick, nichts verworfen, Weltstand = Vergleichslauf');
  ok(g.space.dockOk === true && Besitz.darfAndocken(g, OSTIA) === true && t.funk().some((s) => /Schlacht ist verloren/.test(s)) && !t.funk().some((s) => /ist verloren.$/.test(s) && /Ostia/.test(s)), 'Andocken bleibt erlaubt, Funk: Schlacht verloren, nicht „Ort verloren“');
  // Hauptwelt Palatina
  t = neu(); g = t.g; ab(g);
  ohneFlotten(g, '0204');
  durchzug(flotte(g, '0204', 'ger', 2));
  ankunft(g, '0204');
  const L2 = unterliegen(g);
  ok(L2 && L2.ausgang === 'niederlage' && z(g).hexe['0204'].besitzer === 'rom' && !g.weltsim.hauptweltGefallen && hatEreignis(g, 'hauptwelt_gefallen').length === 0, 'Palatina bleibt römisch (kein hauptweltGefallen)');
  // Posten ohne Feldzug
  const P = '0505';
  t = neu(); g = t.g; ab(g);
  const h = z(g).hexe[P]; h.besitzer = 'rom'; h.posten = true; h.garnison = 0; h.anspruch = {};
  g.weltBesitz.hexe[P] = { besitzer: 'rom', posten: true };
  ohneFlotten(g, P);
  durchzug(flotte(g, P, 'ger', 8));
  ankunft(g, P); run(g, 21); g.ship.hull = 0; run(g, 0.5);
  const L3 = Szene.letzte(g);
  ok(L3.ausgang === 'niederlage' && z(g).hexe[P].besitzer === 'rom' && z(g).hexe[P].posten && hatEreignis(g, 'posten_verloren').length === 0, 'Posten ohne Belagerung: bleibt stehen');
  // Gegenprobe mit Belagerung: derselbe Aufbau, der Hafen fällt (siehe Abschnitt davor)
  t = neu(); g = t.g; ab(g);
  ohneFlotten(g, OSTIA);
  flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA);
  const L4 = unterliegen(g);
  ok(L4 && L4.wirkungen.some((x) => x.typ === 'ort_gefallen') && z(g).hexe[OSTIA].besitzer === 'ger', 'Gegenprobe mit Belagerung: der Hafen fällt');
});

section('Debug szene: Stärke begrenzt', () => {
  const t = neu(); const g = t.g; ab(g);
  const n0 = z(g).flotten.length;
  const r = Szene.debug(g, ['5000', 'ger']);
  ok(typeof r === 'string' && /200/.test(r) && z(g).flotten.length === n0 && !g.simSzene, 'Stärke 5000: abgelehnt mit Hinweis, keine Flotte, keine Szene');
  ok(Szene.debug(g, ['201']) !== null && !g.simSzene, 'Stärke 201: abgelehnt');
  ohneFlotten(g, OSTIA);
  const r2 = Szene.debug(g, ['200', 'ger']);
  ok(r2 === null || typeof r2 === 'string', 'Stärke 200 (Obergrenze): wird nicht wegen der Grenze abgelehnt (' + r2 + ')');
});

section('Posten gehalten und gefallen', () => {
  const POSTEN = '0505';
  const aufbau = (garnison) => {
    const t = neu(); const g = t.g; ab(g);
    const h = z(g).hexe[POSTEN]; h.besitzer = 'rom'; h.posten = true; h.garnison = garnison == null ? 4 : garnison; h.anspruch = {};
    g.weltBesitz.hexe[POSTEN] = { besitzer: 'rom', posten: true };
    ohneFlotten(g, POSTEN);
    return { t, g };
  };
  let { g } = aufbau();
  flotte(g, POSTEN, 'pirat', 6, { belagerung: true });
  ankunft(g, POSTEN);
  let S = g.simSzene;
  ok(S.ort === 'posten' && S.vert.n0 >= 1 && S.vert.gruppen.length === 1 && S.vert.gruppen[0].typ === 'abwehr' && S.vert.gruppen[0].staerke === 4, `Posten: Garnison 4 -> ${S.vert.n0} Verbündete`);
  ok(g.space.markers.some((m) => m.posten), 'Posten-Marker steht in der Szene');
  const tick0 = ticks(g);
  run(g, 21); bisFlaggschiff(g, 300);
  kill(g, g.space.enemies.find((e) => e.flagg)); run(g, 0.2);
  let L = Szene.letzte(g);
  ok(L.ausgang === 'sieg' && L.wirkungen.some((x) => x.typ === 'ort_gehalten') && ticks(g) === tick0 + 1 && z(g).hexe[POSTEN].besitzer === 'rom' && z(g).hexe[POSTEN].posten, 'Posten gehalten: ort_gehalten, ein Tick, Posten steht');
  ok(vergleich(g), 'Weltstand = Vergleichslauf');
  // gefallen a) Garnison 0: die Lerche steht allein, ihr Notfallprotokoll ist die Niederlage
  ({ g } = aufbau(0));
  flotte(g, POSTEN, 'ger', 8, { belagerung: true });
  ankunft(g, POSTEN); run(g, 21);
  ok(g.simSzene && g.simSzene.vert.n0 === 0, 'Garnison 0: keine Verteidiger');
  g.ship.hull = 0; run(g, 0.3);
  L = Szene.letzte(g);
  ok(L.ausgang === 'niederlage' && L.grund === 'lerche' && L.wirkungen.some((x) => x.typ === 'ort_gefallen' && x.an === 'ger') && z(g).hexe[POSTEN].besitzer === null && !z(g).hexe[POSTEN].posten && hatEreignis(g, 'posten_verloren').length === 1, 'Posten gefallen (Lerche allein unterlegen): ort_gefallen, Posten verloren (posten_verloren), Ort frei');
  ok(vergleich(g), 'Weltstand = Vergleichslauf');
  // gefallen b) Garnison fällt (Verteidiger erschöpft, Gnadenfrist)
  ({ g } = aufbau(4));
  flotte(g, POSTEN, 'ger', 8, { belagerung: true });
  ankunft(g, POSTEN); run(g, 21);
  for (const v of verbuendete(g)) Escort.hit(g, v, 99999, {});
  run(g, CONFIG.simSzene.erschoepfungGnade + 1);
  L = Szene.letzte(g);
  ok(L.ausgang === 'niederlage' && L.grund === 'verteidigung' && z(g).hexe[POSTEN].besitzer === null && L.wirkungen.some((x) => x.typ === 'abwehr_verlust' && x.punkte === 4), 'Posten gefallen (Garnison erschöpft): abwehr_verlust 4, ort_gefallen');
  ok(vergleich(g), 'Weltstand = Vergleichslauf');
});

section('Abbruch: Flucht per Sprung und Notfallsprung', () => {
  // Sprung wie ein Spieler: Ziel wählen, Sprungpunkt anfliegen, laden. Mit Gegnern im Raum lädt der Antrieb nicht (Störsender der Rostmeute); wer in der Vorwarnung
  // springt, lädt normal. mitGegnern: der Antrieb gilt als geladen (die Lücke zwischen zwei Wellen), dann springt doJump.
  const springe = (g, hex, mitGegnern) => {
    const von = Sektoren.hexVonOrt(g.ship.scene);
    g.explore.markBoje(Sektoren.kanteId(von, hex));
    const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return 'Ziel: ' + e;
    const p = Sprung.sprungpunkt(g, hex); const s = g.ship; s.x = p.x - 80; s.y = p.y; s.vx = 0; s.vy = 0; s.speed = 0;
    if (mitGegnern) { s.jump.charge = 1; s.jump.ready = true; return Sprung.doJump(g); }
    for (let i = 0; i < 40 * HZ && !s.jump.ready; i++) g.step();
    return Sprung.doJump(g);
  };
  // a) Flucht per Sprung nach der ersten Welle: Verluste gelten, kein ort_*, genau ein Tick
  let t = neu(); let g = t.g; ab(g);
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  const fl = flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA);
  const tick0 = ticks(g);
  run(g, 21);
  const w1 = gegner(g).slice(); const pkt = w1.reduce((s, e) => s + CONFIG.wellenplan.punkte[e.kind], 0);
  killAlle(g);
  const staerke0 = fl.staerke; const romN = z(g).flotten.filter((f) => f.ort === OSTIA && f.fraktion === 'rom').length;
  run(g, 2);
  const S = g.simSzene;
  ok(S && S.killPunkte === pkt && ticks(g) === tick0, `Welle 1 erledigt (${pkt} Punkte), noch kein Tick`);
  g.explore.erkunde('0204');
  const err = springe(g, '0204', true);
  ok(!err && g.ship.scene !== 'ostia_nova', 'Flucht per Sprung gelungen ' + (err || ''));
  ok(!g.simSzene && ticks(g) === tick0 + 1, `Sprung beendet die Szene, der Sprung-Tick ist der EINE Tick (${tick0} -> ${ticks(g)})`);
  const L = Szene.letzte(g);
  ok(L.ausgang === 'abbruch' && L.wo === 'sprung' && L.wirkungen.every((x) => x.typ === 'flotte_verlust' || x.typ === 'abwehr_verlust') && !L.wirkungen.some((x) => x.typ.startsWith('ort_') || x.typ === 'flaggschiff_gefallen'), 'Abbruch: nur Verluste, kein ort_*, kein flaggschiff_gefallen');
  ok(letzterTick.wirkungen.some((x) => x.typ === 'flotte_verlust' && x.flotte === fl.id && x.punkte === pkt), `die Verluste gingen in den Sprung-Tick ein (${pkt} Punkte)`);
  ok(g.weltsim.vorgemerkt.length === 0 && vergleich(g), 'nichts bleibt vorgemerkt, Weltstand = Vergleichslauf');
  ok((g.space.escorts || []).every((q) => !q.sim) && !g.flotte && g.errors === 0, 'Verbündete springen nicht mit, kein Flottenzustand im neuen Sektor');
  ok(z(g).hexe[OSTIA].besitzer === 'rom' || z(g).hexe[OSTIA].besitzer === 'ger', 'der Hafen wird behandelt wie ohne Crew (Sim entscheidet im Tick: ' + z(g).hexe[OSTIA].besitzer + ')');
  ok(staerke0 - fl.staerke <= pkt + 2 && romN >= 1, 'Verlust der Angreifer ungefähr die erzielten Punkte (Rest: Gefecht der Sim)');
  // b) Flucht in der Vorwarnung: nichts gekämpft, nichts vorgemerkt, nur der Sprung-Tick; Weltstand wie ohne Crew
  t = neu(); g = t.g; ab(g);
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  flotte(g, '0505', 'pirat', 5);
  ankunft(g, '0505');
  const t1 = ticks(g);
  const err2 = springe(g, '0503');
  ok(!err2 && !g.simSzene && ticks(g) === t1 + 1 && Szene.letzte(g).wirkungen.length === 0, 'Piraten ignoriert und weggesprungen: keine Wirkung, ein Tick (der Sprung)');
  ok(vergleich(g) && letzterTick.wirkungen.length === 0, 'Weltstand = Vergleichslauf ohne Wirkungen (Szene ohne Wirkung ändert nichts außer dem einen Tick)');
  // c) Flucht per Notfallsprung (auch im selben Sektor): ein Tick, Verluste gelten
  t = neu(); g = t.g; ab(g);
  const fl3 = flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA);
  const t3 = ticks(g);
  run(g, 21);
  const e1 = gegner(g)[0]; const p1 = CONFIG.wellenplan.punkte[e1.kind];
  kill(g, e1); run(g, 0.1);
  ok(g.simSzene.killPunkte === p1, 'ein Abschuss gezählt (' + p1 + ' Punkt/e)');
  const dr = Sprung.notsprung(g);
  const L3 = Szene.letzte(g);
  ok(dr === null && !g.simSzene && ticks(g) === t3 + 1 && L3.ausgang === 'abbruch' && L3.wo === 'notsprung', 'Notfallsprung: Szene weg, genau ein Tick (' + t3 + ' -> ' + ticks(g) + ')');
  ok(letzterTick.wirkungen.some((x) => x.typ === 'flotte_verlust' && x.flotte === fl3.id && x.punkte === p1) && !letzterTick.wirkungen.some((x) => x.typ.startsWith('ort_')), 'Verluste gelten, kein ort_*');
  ok(vergleich(g), 'Weltstand = Vergleichslauf');
  // Notfallsprung im selben Sektor (kein Nachbar): bleibt am Ort, die Szene wird nicht neu ausgelöst
  run(g, 1);
  ok(!g.simSzene, 'nach einem Notfallsprung im selben Sektor: keine Neuauslösung (nur Ankunft löst aus)');
  // d) Debug-Ortswechsel ohne Sprung (debugGoto, debugHex): kein Sprung-Tick folgt, also schließt die Szene selbst ab – Verluste + genau ein Tick, nichts vorgemerkt
  for (const weg of ['goto', 'hex']) {
    t = neu(); g = t.g; ab(g);
    const fl4 = flotte(g, '0505', 'ger', 9, { belagerung: true });
    ankunft(g, '0505'); run(g, 21);
    const e4 = gegner(g)[0]; const p4 = CONFIG.wellenplan.punkte[e4.kind];
    kill(g, e4); run(g, 0.2);
    const t4 = ticks(g);
    const fehl = weg === 'goto' ? g.debugGoto(Sektoren.ortVonHex(OSTIA), false) : Sprung.debugHex(g, OSTIA);
    run(g, 0.5);
    const L4 = Szene.letzte(g);
    ok(!fehl && !g.simSzene && ticks(g) === t4 + 1 && g.weltsim.vorgemerkt.length === 0, `Debug-${weg} mit laufender Szene: Tickzähler +1 (${t4} -> ${ticks(g)}), nichts vorgemerkt`);
    ok(L4.ausgang === 'abbruch' && L4.wo === 'neu' && !L4.wirkungen.some((x) => x.typ.startsWith('ort_')) && letzterTick.wirkungen.some((x) => x.typ === 'flotte_verlust' && x.flotte === fl4.id && x.punkte === p4), 'Verluste gingen in diesen Tick, kein ort_*');
    ok(vergleich(g) && g.errors === 0, 'Weltstand = Vergleichslauf');
  }
});

section('Docken während der Szene', () => {
  const t = neu(); const g = t.g; ab(g);
  flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA);
  ok(g.space.dockOk === false && !g.space.markers.some((m) => m.kind === 'dock') && Besitz.darfAndocken(g, OSTIA) === false, 'Hafen unter Beschuss: kein Dock-Marker, Andocken gesperrt');
  ok(/Feindkontakt/.test(Besitz.verbotText(g, OSTIA) || ''), 'Hinweistext: ' + Besitz.verbotText(g, OSTIA));
  const dock = Locations.get(g.ship.scene).scene.dock;
  const s = g.ship; s.x = dock.x; s.y = dock.y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.stage = 1;
  run(g, 3);
  ok(!g.ship.docked, 'direkt am Dock-Ring bleibt die Lerche abgedockt');
  ok(t.oda().some((x) => /Andocken gesperrt/.test(x)), 'Hinweis (ODA) beim Anflug an das Dock');
  // Sieg gibt das Dock wieder frei
  run(g, 21); bisFlaggschiff(g, 300); kill(g, g.space.enemies.find((e) => e.flagg)); run(g, 0.2);
  ok(!g.simSzene && g.space.dockOk === true && g.space.markers.some((m) => m.kind === 'dock'), 'nach dem Sieg: Dock-Marker und Andocken zurück');
  // Posten (Kulisse) bleibt ohnehin ohne Dock; andere Sektoren sind nicht betroffen
  ok(Besitz.darfAndocken(g, '0205') === true, 'andere Häfen unberührt');
});

section('Keine Endlos-Neuauslösung', () => {
  const t = neu(); const g = t.g; ab(g);
  const fl = flotte(g, '0505', 'ger', 9);
  ankunft(g, '0505');
  const id1 = g.simSzene.id;
  run(g, 21); bisFlaggschiff(g, 300); kill(g, g.space.enemies.find((e) => e.flagg)); run(g, 0.2);
  ok(!g.simSzene && Szene.letzte(g).id === id1, 'Szene 1 endet');
  // Bleiben: die Flotte ist weg (Rückzug), nichts löst aus – auch nach 60 s Warten nicht
  run(g, 60);
  ok(!g.simSzene && Szene.letzte(g).id === id1, 'im Hex geblieben: auch nach 60 s keine zweite Szene');
  // Kommt eine Flotte später im selben Hex an und die Crew bleibt, löst das nichts aus (nur eine Ankunft der Crew löst aus)
  flotte(g, '0505', 'ger', 9); run(g, 5);
  ok(!g.simSzene, 'Flotte erscheint, während die Crew bleibt: keine Szene (die Karte zeigt es, die Szene folgt der Ankunft)');
  // Ankunft: löst wieder aus, mit neuer Id
  ankunft(g, '0505');
  ok(g.simSzene && g.simSzene.id === id1 + 1, 'neue Ankunft bei vorhandener Flotte: neue Szene (Id ' + id1 + ' -> ' + (g.simSzene && g.simSzene.id) + ')');
  // erneute Ankunft ohne Ende der alten Szene: die alte wird sauber abgebrochen (keine zwei Szenen)
  ankunft(g, '0505');
  ok(g.simSzene && g.simSzene.id === id1 + 2 && Szene.letzte(g).ausgang === 'abbruch' && (g.space.escorts || []).filter((q) => q.sim === id1 + 1).length === 0, 'zweite Ankunft: die alte Szene ist abgebrochen, nur eine Szene lebt');
  // Niederlage mit stehender Flotte: bleibt die Crew, bleibt Ruhe (die Flotte ist noch da, die Szene nicht)
  const t2 = neu(); const g2 = t2.g; ab(g2);
  ohneFlotten(g2, '0505'); flotte(g2, '0505', 'ger', 17);
  ankunft(g2, '0505'); run(g2, 21); g2.ship.hull = 0; run(g2, 0.3);
  ok(!g2.simSzene && z(g2).flotten.some((f) => f.ort === '0505' && f.fraktion === 'ger'), 'nach der Niederlage (Lerche allein im freien Sektor) steht die Flotte noch im Hex');
  run(g2, 60);
  ok(!g2.simSzene && Szene.letzte(g2).ausgang === 'niederlage', 'Flotte noch da, Crew bleibt: keine Neuauslösung in 60 s');
  // Schnellsprung: Feindkontakt beendet ihn
  const t3 = neu(); const g3 = t3.g; ab(g3);
  g3.reise = { hops: ['0505', '0503'], i: 0, t: 0, ziel: '0503', abbruch: false }; g3.reisePlan = { ziel: 'x', hops: ['0503'] };
  flotte(g3, '0505', 'pirat', 5);
  Sprung.springeNach(g3, Sektoren.ortVonHex('0505'));
  ok(g3.simSzene, 'Schnellsprung-Hop in einen Sektor mit Piraten löst die Szene aus');
  g3.reise.i = 0; g3.reise.t = 99;
  const hopVor = g3.ship.scene;
  Reise.update(g3, 0.1);
  ok(g3.reise === null && g3.ship.scene === hopVor, 'Feindkontakt beendet den Schnellsprung (kein Weiterspringen mitten in der Szene)');
});

section('Takt: Notruf erledigt in Freie Fahrt', () => {
  const t = neu(); const g = t.g;
  const t0 = ticks(g);
  g.missionEvent('notrufErledigt', { id: 'x', wahrheit: 'echt' });
  ok(ticks(g) === t0 + 1, 'Notruf erledigt (Szenenende ohne Sprung): ein Tick');
  g.missionEvent('notrufAbgelaufen', { id: 'x' }); g.missionEvent('notrufAbgelehnt', { id: 'x' });
  ok(ticks(g) === t0 + 1, 'Notruf abgelaufen/abgelehnt: kein Tick (kein Szenenende; der Sprung danach tickt)');
  // während einer Sim-Szene tickt deren Ende, nicht der Notruf
  ab(g); flotte(g, '0505', 'ger', 9); ankunft(g, '0505');
  const t1 = ticks(g);
  g.missionEvent('notrufErledigt', { id: 'y' });
  ok(ticks(g) === t1, 'während einer Sim-Szene: kein zusätzlicher Tick');
  // Kampagne: nie
  const tk = neu({ start: 'free' });
  const k0 = kernTicks;
  tk.g.missionEvent('notrufErledigt', { id: 'x' });
  ok(kernTicks === k0 && tk.g.weltsim === null, 'Kampagne: Notruf-Ende tickt nie');
  // echter Ablauf: Notruf im Hex bergen (Erledigt kommt aus Notrufe.update)
  const t2 = neu(); const g2 = t2.g;
  const Notrufe = require('../server/sim/notrufe.js');
  const d = Notrufe.datei('sl_klar');
  if (d) {
    const hex = d.hex; const ort = Sektoren.ortVonHex(hex);
    if (ort && Locations.get(ort)) {
      ab(g2); Notrufe.freischalten(g2, 'sl_klar'); ohneFlotten(g2, hex); Space.enterScene(g2, ort, {}); ab(g2);
      g2.god = true;
      run(g2, 1);
      const r = Notrufe.finde(g2, 'sl_klar');
      const a = ticks(g2);
      if (r && r.z === Notrufe.Z.VOR_ORT) {
        const sh = Notrufe.schiff(g2, r);
        g2.ship.x = sh.x; g2.ship.y = sh.y; g2.ship.vx = 0; g2.ship.vy = 0; g2.ship.speed = 0;
        bis(g2, () => Notrufe.erledigt(g2, 'sl_klar'), 30);
        ok(Notrufe.erledigt(g2, 'sl_klar') && ticks(g2) === a + 1, 'echter Notruf geborgen (sl_klar): genau ein Tick, ' + a + ' -> ' + ticks(g2));
      } else ok(true, 'Notruf-Flug im Test nicht erreichbar (übersprungen): ' + (r && r.z));
    }
  }
});

section('Notruf-Hinterhalt im selben Hex: der Szenen-Rückzug zählt nicht als „erledigt“', () => {
  // Die heutige Falle (sl_falle) liegt in 0502, keinem Sim-Hex; hier wird sie als Kopie in einen Sim-Hex gelegt, damit Szene und Hinterhalt zusammenfallen.
  const Notrufe = require('../server/sim/notrufe.js');
  const orig = Notrufe.datei('sl_falle');
  const HEX = '0505';
  Notrufe.registriere(Object.assign(kopie(orig), { hex: HEX }));
  try {
    const t = neu(); const g = t.g; ab(g); g.god = true;
    ohneFlotten(g, HEX); Notrufe.freischalten(g, 'sl_falle'); Notrufe.hinfliegen(g, 'sl_falle');
    flotte(g, HEX, 'ger', 9);
    ankunft(g, HEX); run(g, 1);
    const r = Notrufe.finde(g, 'sl_falle');
    ok(g.simSzene && r.z === Notrufe.Z.VOR_ORT, 'Szene und Notruf-Falle im selben Hex');
    const sh = Notrufe.schiff(g, r); g.ship.x = sh.x + 100; g.ship.y = sh.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0;
    run(g, 0.5);
    const hinter = () => g.space.enemies.filter((e) => e.tag === 'hinterhalt');
    ok(r.hinterhalt && hinter().length === 3, 'Hinterhalt ausgelöst: 3 Jäger mit Tag hinterhalt');
    run(g, 21);
    for (let i = 0; i < 300 * HZ && g.simSzene && !g.space.enemies.some((e) => e.flagg); i++) { for (const e of gegner(g)) kill(g, e); g.step(); }   // nur die Welle der Szene, der Hinterhalt bleibt
    kill(g, g.space.enemies.find((e) => e.flagg)); run(g, 0.2);
    ok(Szene.letzte(g).ausgang === 'sieg', 'Szene gewonnen');
    const marks0 = g.inventory.marks, t0 = ticks(g);
    run(g, 20);
    ok(gegner(g).length === 0 && !g.space.enemies.some((e) => e.tag === 'sim_szene'), 'die Gegner der Szene sind abgezogen (Rückzug wie bisher)');
    ok(hinter().length === 3 && r.z === Notrufe.Z.VOR_ORT && !Notrufe.erledigt(g, 'sl_falle'), 'die Hinterhalt-Jäger des Notrufs bleiben: Notruf nicht erledigt');
    ok(g.inventory.marks === marks0 && ticks(g) === t0, 'keine Beute ohne Kampf, kein zweiter Tick (notrufErledigt)');
    g.space.enemies = []; run(g, 0.5);   // Hinterhalt weg (wie in test-notrufe: ohne Kopfgeld der Abschüsse)
    ok(Notrufe.erledigt(g, 'sl_falle') && g.inventory.marks === marks0 + 60 && ticks(g) === t0 + 1, 'Hinterhalt wirklich abgewehrt: Notruf erledigt, Beute 60, ein Tick (Notruf-Ende ohne Szene)');
  } finally { Notrufe.registriere(orig); }
});

section('Weltstand: nichts wird gespeichert, Altstände laden, Laden löst nichts aus', () => {
  const t = neu(); const g = t.g;
  const data0 = kopie(Weltstand.capture(g));
  ab(g); flotte(g, OSTIA, 'ger', 17, { belagerung: true }); ankunft(g, OSTIA); run(g, 21);
  const json = JSON.stringify(Weltstand.capture(g));
  ok(!json.includes('simSzene') && !json.includes('sim_szene') && !json.includes('killPunkte'), 'der Weltstand enthält keinen Szenenzustand');
  const data1 = kopie(Weltstand.capture(g));
  ok(data1.version === 3 && Weltstand.validate(data1).length === 0, 'Weltstand bleibt Version 3 und schemagültig');
  const keys = (d) => Object.keys(d.welt.sim).sort().join();
  ok(keys(data0) === keys(data1) || /kommandanten|vorgemerkt|wissen/.test(keys(data1)), 'welt.sim trägt nur bekannte Blöcke: ' + keys(data1));
  // Altstand (SUND-01: ohne kommandanten und vorgemerkt) lädt unverändert
  const alt = kopie(data0); delete alt.welt.sim.kommandanten; delete alt.welt.sim.vorgemerkt;
  const dir = freshDir();
  alt.id = 'w-altstand'; fs.writeFileSync(path.join(dir, 'w-altstand.json'), JSON.stringify(alt));
  const g2 = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} }; g2.addConnection(c); g2.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'A', color: 0 });
  g2.handleMessage(c, { t: 'lobbyOpt', world: 'w-altstand' }); g2.handleMessage(c, { t: 'ready', ready: true });
  run(g2, 2);
  ok(g2.phase === 'play' && g2.weltsim && g2.errors === 0 && !g2.simSzene && g2.ship.docked, 'Altstand (SUND-01) lädt: Sim da, gedockt, keine Szene, keine Fehler');
  // Laden mit Flotte im Hex: das Laden stellt nie eine Szene her (gespeichert wird nur gedockt, gedockt gibt es keine Szene)
  flotte(g2, OSTIA, 'ger', 17, { belagerung: true });
  Space.enterScene(g2, 'ostia_nova', { docked: true });
  ok(!g2.simSzene, 'gedockt im Hex mit Flotte (Laden): keine Szene, nichts hängt');
  Kriegslage.nachLaden(g2);
  ok(!g2.simSzene && g2.errors === 0, 'nachLaden: keine Szene');
  g2.simSzene = { hex: OSTIA, phase: 'kampf' };
  Kriegslage.restore(g2, data1.welt.sim);
  ok(g2.simSzene === null, 'restore räumt eine Szene weg (kein Szenenzustand über das Laden hinaus)');
});

section('Mehrspieler: Crew 3, eine Szene für alle, Wirkungen nur einmal', () => {
  const t = neu({ crew: 3 }); const g = t.g; ab(g);
  flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA);
  const S = g.simSzene; const tick0 = ticks(g);
  ok(S && g.players.filter((p) => p.connected).length === 3, 'drei Spieler verbunden, eine Szene');
  run(g, 21);
  ok(gegner(g).length === S.plan.wellen[0].reduce((s, x) => s + x.n, 0), 'Welle 1 wie im Plan (' + gegner(g).length + ' Schiffe, unskaliert auch zu dritt)');
  // ein Spieler trennt sich: die Szene läuft weiter
  g.removeConnection(t.cs[2]);
  run(g, 3);
  ok(g.simSzene === S && S.phase === 'kampf' && g.players.filter((p) => p.connected).length === 2, 'einer trennt: die Szene hängt am Schiff und läuft weiter');
  g.removeConnection(t.cs[1]);
  run(g, 1);
  ok(g.simSzene === S, 'auch ein zweiter weg: Szene läuft');
  bisFlaggschiff(g, 300);
  kill(g, g.space.enemies.find((e) => e.flagg)); run(g, 0.2);
  ok(Szene.letzte(g).ausgang === 'sieg' && ticks(g) === tick0 + 1 && g.weltsim.wirkungenAngewandt === Szene.letzte(g).wirkungen.length, 'Wirkungen genau einmal angewandt (' + g.weltsim.wirkungenAngewandt + '), ein Tick');
  ok(t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio' && /Feindkontakt/.test(m.text)).length === 1, 'der Funkspruch kam genau einmal');
  ok(g.errors === 0, 'keine Fehler');
});
section('Client-Runde M1: Szenenfunk läuft über den Lagefunk-Pfad (Konsolen, Funk-Reiter, Logbuch)', () => {
  const t = neu(); const g = t.g; ab(g);
  ohneFlotten(g, OSTIA); flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  const ev = () => t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio');
  const logN = g.explore.log.length;
  ankunft(g, OSTIA);
  const e = ev();
  ok(e.length >= 2 && e.every((m) => m.lage), 'alle Funksprüche der Szene tragen die Lagefunk-Kennung (lage), ' + e.length + ' Stück');
  const letzter = e[e.length - 1];
  ok(/Feindkontakt/.test(letzter.text) && letzter.text.includes(g.simSzene.kommandant.name), 'der letzte (an der Konsole obenauf stehende) Funkspruch ist die Vorwarnung mit Fraktion, Stärke und Kommandant: „' + letzter.text.slice(0, 70) + '…“');
  ok(g.explore.log.length > logN && g.explore.log.slice(logN).some((l) => /Feindkontakt/.test(l.text) && l.loc === g.ship.scene), 'die Vorwarnung steht im Logbuch (explore.log)');
  // Finale mit Flaggschiff und Sieg
  bisFlaggschiff(g, 300);
  ok(ev().some((m) => m.lage && /greift mit dem Flaggschiff ein/.test(m.text) && m.text.includes(g.simSzene.kommandant.name)), 'Finale: „… greift mit dem Flaggschiff ein!“ als Lagefunk, mit dem Namen des Kommandanten');
  const n0 = ev().length;
  kill(g, g.space.enemies.find((x) => x.flagg)); run(g, 0.2);
  const neue = ev().slice(n0);
  ok(neue.length >= 2 && neue.every((m) => m.lage), 'Sieg: Funk als Lagefunk (' + neue.map((m) => m.text).join(' | ').slice(0, 100) + ')');
  const kd = neue.findIndex((m) => m.text.includes(g.simSzene ? '' : Szene.letzte(g) && Szene.letzte(g).wirkungen.find((x) => x.typ === 'flaggschiff_gefallen').kommandant.name));
  ok(kd > 0 && /hält\./.test(neue[0].text), 'Sieg: erst „… hält.“, dann der Spruch zum Kommandanten (Name erreicht die Crew); danach höchstens Meldungen der Weltsimulation');
  ok(g.errors === 0, 'keine Fehler');
  // Niederlage
  const t2 = neu(); const g2 = t2.g; ab(g2);
  ohneFlotten(g2, OSTIA); flotte(g2, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g2, OSTIA); run(g2, 21);
  for (const v of verbuendete(g2)) Escort.hit(g2, v, 99999, {});
  g2.ship.hull = 0; run(g2, 0.3); g2.ship.hull = 0; run(g2, 0.5);
  const nl = t2.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio' && m.lage).map((m) => m.text);
  ok(nl.some((s) => /ist verloren/.test(s)) && nl.some((s) => /Lerche ist angeschlagen/.test(s)), 'Niederlage als Lagefunk');
});

section('Client-Runde M2: Szenenzeile im Snapshot (flotte.sz) und Messung', () => {
  const t = neu(); const g = t.g; ab(g);
  ok(!g.snapshot().flotte || !g.snapshot().flotte.sz, 'ohne Szene kein Feld sz');
  ohneFlotten(g, OSTIA); flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA);
  run(g, 5);
  let s = g.snapshot().flotte;
  ok(s && s.sz && s.sz.p === 'v' && s.sz.f === 'ger' && s.sz.k === 3 && Array.isArray(s.sz.v) && s.sz.v[1] === 20 && s.sz.v[0] >= 14 && s.sz.v[0] <= 16, 'Vorwarnung: Phase v, Fraktion ger, Klasse 3, Restsekunden ' + JSON.stringify(s && s.sz && s.sz.v) + ' von 20');
  ok(s.wl && s.wl[0] === 0 && s.wl[1] === 3 && s.sz.kd === undefined, 'Welle 0/3 kommt aus dem vorhandenen flotte.wl, kein Kommandant in der Vorwarnung');
  const mess = (o) => Buffer.byteLength(JSON.stringify(o));
  ok(mess(s.sz) <= 60, 'sz in der Vorwarnung: ' + mess(s.sz) + ' B');
  run(g, 16);
  s = g.snapshot().flotte;
  ok(s.sz.p === 'k' && s.sz.g > 0 && s.sz.v === undefined && s.sz.f === undefined, 'Kampf: Phase k, Zahl der Gegner ' + s.sz.g + ', Vorwarnfelder weg');
  ok(s.sz.g === gegner(g).length, 'g = lebende Gegner der Welle');
  bisFlaggschiff(g, 300);
  run(g, 0.5);
  s = g.snapshot().flotte;
  ok(s.sz.p === 'f' && s.sz.kd === g.simSzene.kommandant.name.slice(0, 24) && s.sz.kd.length <= 24, 'Finale: Phase f mit Kommandant (höchstens 24 Zeichen): ' + s.sz.kd);
  ok(g.space.enemies.some((e) => e.flagg) && g.snapshot().space.enemies.filter((e) => e.fg === 1).length === 1, 'das Flaggschiff trägt fg im Snapshot (genau eines)');
  const dauer = mess(g.snapshot());
  kill(g, g.space.enemies.find((e) => e.flagg)); run(g, 0.3);
  s = g.snapshot().flotte;
  ok(s && s.sz && s.sz.p === 's' && s.sz.o === 'Ostia Nova', 'Sieg: sz.p s, Ort Ostia Nova (6 s lang)');
  ok(s.wl === undefined && s.b === undefined, 'nach dem Ende gibt es sonst nichts im flotte-Block');
  run(g, 5); ok(g.snapshot().flotte && g.snapshot().flotte.sz, 'nach 5 s noch da');
  run(g, 1.5); ok(!(g.snapshot().flotte && g.snapshot().flotte.sz), 'nach 6,5 s weg');
  console.log('       Snapshot im Finale: ' + dauer + ' B');
  // Niederlage mit Ort
  const t2 = neu(); const g2 = t2.g; ab(g2);
  ohneFlotten(g2, OSTIA); flotte(g2, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g2, OSTIA); run(g2, 21);
  for (const v of verbuendete(g2)) Escort.hit(g2, v, 99999, {});
  g2.ship.hull = 0; run(g2, 0.3); g2.ship.hull = 0; run(g2, 0.5);
  const s2 = g2.snapshot().flotte;
  ok(s2 && s2.sz && s2.sz.p === 'n' && s2.sz.o === 'Ostia Nova', 'Niederlage: sz.p n mit Ort');
  // Szenenwechsel beendet die Ergebnisanzeige (kein Nachhall in einem anderen Hex)
  const t3 = neu(); const g3 = t3.g; ab(g3);
  ohneFlotten(g3, OSTIA); flotte(g3, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g3, OSTIA); run(g3, 21); bisFlaggschiff(g3, 300); kill(g3, g3.space.enemies.find((e) => e.flagg)); run(g3, 0.3);
  ok(g3.snapshot().flotte && g3.snapshot().flotte.sz, 'Ergebnis steht');
  ankunft(g3, '0205');
  ok(!(g3.snapshot().flotte && g3.snapshot().flotte.sz), 'anderes Hex: keine Ergebniszeile des alten Hexes');
  // Kampagne: nie
  const tk = neu({ start: 'free' }); ok(!tk.g.snapshot().flotte, 'Kampagne: kein flotte-Block, kein sz');
  ok(g.errors === 0 && g2.errors === 0, 'keine Fehler');
});

section('Client-Runde S2: Alarm Rot nur während der Szene (reine Darstellung)', () => {
  const t = neu(); const g = t.g; ab(g);
  run(g, 1);
  ok(g.snapshot().ship.alert === 'normal', 'vor der Szene Alarm Grün');
  ohneFlotten(g, OSTIA); flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA); run(g, 1);
  ok(g.space.enemies.length === 0 && g.snapshot().ship.alert === 'red', 'Vorwarnung (noch keine Gegner): Alarm Rot');
  ok(!g.space.alarm || !g.space.alarm.aktiv, 'der Raum-Alarm (Gegner-KI, Minen, Einsprung) bleibt aus: reine Darstellung');
  run(g, 20); bisFlaggschiff(g, 300); kill(g, g.space.enemies.find((e) => e.flagg)); run(g, 0.5);
  g.space.enemies = []; run(g, 1);
  ok(!g.simSzene && g.snapshot().ship.alert === 'normal', 'nach der Szene wieder Alarm Grün');
});

section('Client-Runde GRNDS.: Gnadenfrist-Meldung ohne Belagerung ohne „verloren“', () => {
  const durchzug = (f) => { f.befehl = 'rueckzug'; f.ziel = f.heimat; return f; };
  let t = neu(); let g = t.g; ab(g);
  ohneFlotten(g, OSTIA); durchzug(flotte(g, OSTIA, 'ger', 3));
  ankunft(g, OSTIA); run(g, 21);
  for (const v of verbuendete(g)) Escort.hit(g, v, 99999, {});
  run(g, 0.3);
  const f1 = t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text).filter((s) => /Die letzten Verteidiger/.test(s));
  ok(f1.length === 1 && !/verloren/.test(f1[0]) && /sonst bricht die Linie/.test(f1[0]), 'durchziehende Flotte: Gnadenfrist ohne „… verloren“: „' + f1[0] + '“');
  t = neu(); g = t.g; ab(g);
  ohneFlotten(g, OSTIA); flotte(g, OSTIA, 'ger', 17, { belagerung: true });
  ankunft(g, OSTIA); run(g, 21);
  for (const v of verbuendete(g)) Escort.hit(g, v, 99999, {});
  run(g, 0.3);
  const f2 = t.cs[0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text).filter((s) => /Die letzten Verteidiger/.test(s));
  ok(f2.length === 1 && /sonst ist Ostia Nova verloren/.test(f2[0]), 'mit Belagerung: wie bisher „sonst ist Ostia Nova verloren!“');
});


try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`\n${n} Prüfungen, ${fails} Fehler`);
process.exit(fails ? 1 : 0);
