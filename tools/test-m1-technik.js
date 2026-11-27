'use strict';
// TEC-01 F: das Tutorial m1 „Die stumme Boje“ nimmt das Komponentenmodell der Schildkette mit.
// Geprüft werden die DATEN (content/regiebuecher/m1.regiebuch.json) und der Lauf im Gefechtsschritt „combat“:
//   die Skriptaktion damage_component zerlegt Spannungsregler und Relais des Schildgenerators (ohne Zufall, jeder Seed gleich), zwei Tausche mit Ersatzteil heilen ihn
//   (zerstört -> beschädigt -> ok), der Hinweis hintRepair schließt erst danach, die Texte nennen Q und die Schildkette im Schadensplan, beide Wege (Korvette, Bestechung).
//   node tools/test-m1-technik.js
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const WORLD = require('../server/world.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } }
const DT = 1 / CONFIG.tickHz;
const BUCH = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher', 'm1.regiebuch.json'), 'utf8'));
const COMBAT = BUCH.steps.find((s) => s.id === 'combat');
const T = BUCH.texte;
const z = (g) => g.ship.komp.shields.map((k) => k.t + ':' + k.z[0]).join(' ');

// m1 im Gefechtsschritt; bribed: true läuft über den Durchschlag (Bestechung), sonst über die Korvette
function combat(seed, bribed) {
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'm1' });
  g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  run(1);
  const oda = []; const oda0 = g.oda.bind(g); g.oda = (t, k) => { oda.push(String(t)); return oda0(t, k); };
  const ev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { ev.push({ nm, d }); return me0(nm, d); };
  if (bribed) g.mission.flags.bribed = true;
  const err = g.mission.forceStage('combat');
  if (!bribed) g.space.enemies = [];   // Korvette: ohne Rostmeute greift die Regel sofort; Bestechung: der Räuber bleibt (sonst endet der Schritt im selben Tick), Durchschlag nach 25 s
  g.god = !!bribed;   // der Räuber darf das Schiff nicht zusätzlich beschädigen
  return { g, c, run, oda, ev, err, p: g.players[0] };
}
const ziel = (g, id) => (g.mission.state.objectives || []).find((o) => o.id === id);
const ankern = (g, p, sys) => { const st = WORLD.STATIONS.find((s) => s.system === sys); const c = WORLD.tileCenter(st.x, st.y); p.x = c.x; p.y = c.y; p.zone = 'ship'; p.console = null; p.hold = null; p.moving = false; p.input.mx = 0; p.input.my = 0; };
const reparierte = (ev) => ev.filter((e) => e.nm === 'repaired' && e.d.system === 'shields').length;

section('Daten: Skriptaktion, Hinweis, Texte', () => {
  const akt = [];
  for (const r of COMBAT.rules) for (const d of (r.do || [])) for (const w of (d.wirkung || [])) { akt.push(w); }
  const schild = akt.filter((w) => w.system === 'shields');
  ok(schild.length === 2 && schild.every((w) => w.do === 'damage_component' && w.komp === 'SR'), 'beide Wege (Korvette, Bestechung) zerlegen per damage_component Spannungsregler und Relais (komp SR), kein damage_system mehr (kein Doppelweg)');
  ok(schild.every((w) => /Q/.test(T[w.text.slice(1)]) && /Spannungsregler/.test(T[w.text.slice(1)]) && /Relais/.test(T[w.text.slice(1)])), 'beide ODA-Texte nennen die zwei Teile und Q');
  ok(/Schildkette/.test(T['combat.schaeden']) && /Schadensplan/.test(T['combat.schaeden']), 'Schadens-Hinweis nennt Schadensplan und Schildkette (Komponentenübersicht)');
  const h = COMBAT.objectives.find((o) => o.id === 'hintRepair');
  ok(h && /zwei Teile/.test(T['ziel.tipp_reparatur']) && /Q/.test(T['ziel.tipp_reparatur']), 'Hinweis hintRepair: zwei Teile, Ersatzteil, Q wählt');
  ok(h && !/"event"/.test(JSON.stringify(h.done)) && /system_ok/.test(JSON.stringify(h.done)), 'hintRepair schließt nach Zustand (system_ok), nicht nach dem ersten Ereignis repaired');
  ok(/damage_component/.test(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuch', 'bausteine.json'), 'utf8')), 'Baustein damage_component im Katalog (bausteine.json)');
});

section('Korvette: der Treffer zerlegt immer Spannungsregler und Relais (jeder Seed gleich)', () => {
  const gesehen = new Set();
  for (const seed of [1, 7, 13, 42]) {
    const { g, run, oda, ev, err } = combat(seed, false);
    run(2);
    gesehen.add(z(g));
    ok(err === null && g.mission.state.stage === 'combat', `Seed ${seed}: Schritt combat läuft`);
    ok(g.ship.systems.shields === 'broken' && z(g) === 'K:o S:d R:d', `Seed ${seed}: Schildgenerator zerstört, K ok, S und R defekt (${z(g)})`);
    ok(g.ship.komp.shields.map((k) => k.n).join(',') === '0,0,1', `Seed ${seed}: Ausfallzähler nur beim Relais (n 0,0,1)`);
    ok(ev.filter((e) => e.nm === 'systemDamaged' && e.d.system === 'shields').length === 1, `Seed ${seed}: genau ein Ereignis systemDamaged`);
    ok(oda.includes(T['combat.erste_salve']), `Seed ${seed}: ODA-Text der ersten Salve gesprochen`);
    ok((g.ship.kompKorrekturen | 0) === 0, `Seed ${seed}: Wächter hat nicht korrigiert`);
  }
  ok(gesehen.size === 1, 'in allen Seeds dieselbe Verteilung (kein Zufall)');
});

section('Zwei Tausche heilen den Generator, der Hinweis schließt erst danach', () => {
  const { g, run, ev } = combat(5, false);
  run(2);
  ok(ziel(g, 'hintRepair') && ziel(g, 'hintRepair').done === false, 'hintRepair offen, solange der Generator zerstört ist');
  I.repairSystem(g, 'shields', 'player', 'swap');
  run(0.5);
  ok(z(g) === 'K:o S:o R:d' && g.ship.systems.shields === 'damaged', 'erster Tausch: erste defekte (S) heil, zerstört -> beschädigt');
  ok(reparierte(ev) === 1, 'repaired wurde einmal gemeldet');
  ok(ziel(g, 'hintRepair').done === false, 'nach dem ersten repaired bleibt hintRepair offen (kein Abschluss auf das erste Ereignis)');
  I.repairSystem(g, 'shields', 'player', 'swap');
  run(0.5);
  ok(z(g) === 'K:o S:o R:o' && g.ship.systems.shields === 'ok', 'zweiter Tausch: Relais heil, System wieder ok');
  ok(reparierte(ev) === 2, 'repaired zweimal (je Tausch)');
  ok(ziel(g, 'hintRepair').done === true, 'hintRepair schließt erst nach dem zweiten Tausch (System ok)');
  ok(g.ship.komp.shields.map((k) => k.n).join(',') === '0,0,0', 'Tausch setzt den Ausfallzähler zurück');
});

section('Mit Ersatzteil am Pult: Q-Wunsch R zuerst, dann der Standard (S)', () => {
  const { g, run, p } = combat(9, false);
  run(2);
  ankern(g, p, 'shields'); p.carry = 'ersatzteil';
  I.onAct(g, p, true, 'R');
  ok(p.hold && p.hold.kind === 'swap' && p.hold.komp === 'R', 'Q-Wahl R: der Tausch-Hold trägt das Relais');
  run(3.3); I.onAct(g, p, false);
  ok(z(g) === 'K:o S:d R:o' && g.ship.systems.shields === 'damaged' && p.carry === null, 'Relais getauscht, Spannungsregler weiter defekt, Ersatzteil verbraucht');
  ankern(g, p, 'shields'); p.carry = 'ersatzteil';
  I.onAct(g, p, true);
  ok(p.hold && p.hold.komp === 'S', 'ohne Wahl: Standard = erste defekte (Spannungsregler)');
  run(3.3); I.onAct(g, p, false);
  ok(g.ship.systems.shields === 'ok' && z(g) === 'K:o S:o R:o' && ziel(g, 'hintRepair').done === true, 'zweiter Tausch: System ok, Hinweis erledigt');
});

section('Bestechung: der Durchschlag zerlegt dieselben zwei Teile', () => {
  const { g, run, oda } = combat(11, true);
  run(27);
  ok(g.mission.flags.bribed === true && g.ship.systems.shields === 'broken' && z(g) === 'K:o S:d R:d', 'Durchschlag: Generator zerstört, S und R defekt');
  ok(oda.includes(T['combat.durchschlag']), 'ODA-Text des Durchschlags gesprochen');
  ok(ziel(g, 'hintRepair').done === false, 'hintRepair offen');
  I.repairSystem(g, 'shields', 'player', 'swap'); I.repairSystem(g, 'shields', 'player', 'swap'); run(0.5);
  ok(g.ship.systems.shields === 'ok' && ziel(g, 'hintRepair').done === true, 'zwei Tausche: ok, Hinweis erledigt');
});

console.log(`\n${n - fails}/${n} Prüfungen grün${fails ? `, ${fails} FEHLER` : ''}`);
process.exit(fails ? 1 : 0);
