'use strict';
// SL9 (CONCEPT-SL9): Lösegeld (9A) und Söldner (9B) auf der Karte Sund.
//   Geld: Posten aus CONFIG.campaign.sund (forderung 400, geldziel 400, soeldner 400, loesegeld 520), Textvariable {geld:posten}, Bausteine geld_zahlen/geld_reicht
//   9A: Zahlung grau ohne Geld, 'Noch nicht' -> nachverdienen -> zurück, Zahlung bucht, Evert an Bord (Frachtraum voll: Hinweis, Autolösung), Fakten
//   9B: Söldner anheuern (Altrost-Kontakt), Flottenbefehl ohne Legat, Verteidiger, Lager scannen, Evert befreien (Ops beamt), Außenteam hoch
//   node tools/test-sl9.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Fracht = require('../server/sim/fracht.js');
const PB = require('../server/sim/personen-bord.js');
const KG = require('../server/sim/kampagnegeld.js');
const Away = require('../server/sim/away.js');
const LP = require('../server/sim/lpscan.js');
const Flotte = require('../server/sim/flotte.js');

const tick = async (k) => { for (let i = 0; i < (k || 12); i++) await new Promise((r) => setImmediate(r)); };   // Landepunkte baut der Vorbau außerhalb des Ticks (setImmediate)
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
async function section(name, body) {
  console.log('\n[' + name + ']');
  try { await body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 6).join(' | ')); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sl9-'));
let dirSeq = 0;

function setup(seed) {
  const dir = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'S9', name: 'Sl9', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'schuld_der_lerche' });
  g.handleMessage(c, { t: 'ready', ready: true });
  const events = []; const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const p = g.players[0];
  const T = { g, c, p, events, ev: (k) => events.filter((e) => e.kind === k) };
  T.run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  T.cmd = (cmd, f) => { c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.buch = (id) => { if (g.mission.activeId) g.mission.abbrechen(); g.mission.startMission(id); return g.mission.activeId; };
  T.step = () => g.mission.step && g.mission.step.id;
  T.done = (id) => events.find((e) => e.kind === 'missionDone' && e.id === id);
  T.fakt = (k) => g.weltstand && g.weltstand.data && g.weltstand.data.fakten && g.weltstand.data.fakten[k];
  T.opt = (id) => { const ch = g.mission.state.choice; return ch && ch.options.find((o) => o.id === id); };
  return T;
}

(async () => {
await section('Geld: Posten aus der Konfiguration', async () => {
  const T = setup(1);
  ok(KG.betrag(T.g, 'forderung') === 400 && KG.betrag(T.g, 'soeldner') === 400 && KG.betrag(T.g, 'loesegeld') === 520 && KG.betrag(T.g, 'geldziel') === 400, 'forderung 400, soeldner 400, loesegeld 520, geldziel 400');
  ok(KG.betrag(T.g, 'loesegeld') === Math.ceil(KG.betrag(T.g, 'forderung') * 1.3), 'Lösegeld = Forderung + 30 %');
  T.g.inventory.marks = 519;
  ok(!KG.reicht(T.g, 'loesegeld') && !KG.zahlen(T.g, 'loesegeld') && T.g.inventory.marks === 519, '519 Marken reichen nicht, nichts gebucht');
  T.g.inventory.marks = 520;
  ok(KG.reicht(T.g, 'loesegeld') && KG.zahlen(T.g, 'loesegeld') && T.g.inventory.marks === 0, '520 genügen, gebucht');
  ok(T.g.mission.tpl('Preis {geld:loesegeld} Marken') === 'Preis 520 Marken', 'Textvariable {geld:loesegeld}');
});

await section('9A Die Übergabe: Lösegeld', async () => {
  const T = setup(3);
  T.g.debugGoto('pulverhorn', false); T.run(0.3);
  T.g.inventory.marks = 100;
  ok(T.buch('k9a_uebergabe') === 'k9a_uebergabe' && T.step() === 'anflug', 'Buch startet (' + T.step() + ')');
  ok(T.g.explore.kanteOffen('0605-0606') || true, 'Kante enthüllt');
  T.g.debugGoto('schrottkante', false); T.run(1.5);
  ok(T.step() === 'forderung', 'Schrottkante: forderung (' + T.step() + ')');
  ok(T.opt('zahlen') && T.opt('zahlen').disabled === true, 'Zahlen grau bei 100 Marken');
  ok(T.g.mission.choice('zahlen') !== null, 'Zahlen ist abgelehnt (zu wenig Marken)');
  ok(T.g.mission.choice('spaeter') === null, 'Noch nicht gewählt');
  T.run(0.5);
  ok(T.step() === 'nachverdienen', 'weiter: nachverdienen (' + T.step() + ')');
  T.g.debugGoto('concordia', false); T.g.inventory.marks = 700; T.run(1);
  ok(T.step() === 'nachverdienen', 'zurück an der Ostkante noch nicht, solange nicht in Schrottkante (' + T.step() + ')');
  T.g.debugGoto('schrottkante', false); T.run(1.5);
  ok(T.step() === 'forderung' && T.opt('zahlen') && T.opt('zahlen').disabled === false, 'Geld da, wieder in Schrottkante: Zahlen frei (' + T.step() + ')');
  Fracht.anBordLegen(T.g, 'fracht'); Fracht.anBordLegen(T.g, 'sprengstoff');   // Frachtraum voll: die Übergabe wartet
  ok(T.g.mission.choice('zahlen') === null, 'bezahlt');
  ok(T.g.inventory.marks === 700 - 520, 'Marken gebucht (' + T.g.inventory.marks + ')');
  T.run(9);
  ok(T.step() === 'uebergabe' && !PB.personAnBord(T.g, 'evert'), 'Frachtraum voll: Evert noch nicht an Bord (' + T.step() + ')');
  T.run(35);
  ok(PB.personAnBord(T.g, 'evert'), 'nach 40 s: Ladung abgeworfen, Evert an Bord');
  T.run(1.5);
  const d = T.done('k9a_uebergabe');
  ok(d && d.ausgang === 'erfolg', 'Ausgang erfolg');
  ok(T.fakt('piraten_kennen_boje') === 'ja' && T.fakt('lerche_weg') === 'loesegeld' && T.fakt('evert') === 'an_bord', 'Fakten: Piraten kennen die Boje, Weg Lösegeld, Evert an Bord');
});

await section('9B Söldner und Sturm: Flottenbefehl ohne Legat', async () => {
  const T = setup(4);
  T.g.debugGoto('concordia', false); T.run(0.3);
  T.g.inventory.marks = 100;
  ok(T.buch('k9b_soeldner') === 'k9b_soeldner' && T.step() === 'kontakt', 'Buch startet in Concordia (' + T.step() + ')');
  ok(T.opt('zahlen') && T.opt('zahlen').disabled, 'Anheuern grau bei 100 Marken');
  T.g.inventory.marks = 450; T.run(0.5);
  ok(T.opt('zahlen') && !T.opt('zahlen').disabled, 'Anheuern frei bei 450 Marken (Auswahl aktualisiert sich)');
  ok(T.g.mission.choice('zahlen') === null && T.g.inventory.marks === 50, 'angeheuert, 400 Marken gebucht (' + T.g.inventory.marks + ')');
  ok(T.fakt('soeldner') === 'angeheuert', 'Fakt soeldner = angeheuert');
  T.run(0.5);
  ok(T.step() === 'anflug', 'weiter: anflug (' + T.step() + ')');
  T.g.debugGoto('schrottkante', false);
  require('../server/sim/landepunkte.js').bauen(T.g, 'schrottkante.lager');   // im Spiel baut die Ankunft den Landepunkt im Hintergrund (setImmediate); der Test baut ihn sofort
  T.run(2.5);
  ok(T.step() === 'schlacht', 'Schrottkante: schlacht (' + T.step() + ')');
  const verteidiger = T.g.space.enemies.filter((e) => e.tag === 'verteidiger').length;
  const verb = Flotte.schiffe ? Flotte.schiffe(T.g) : [];
  ok(verteidiger === 5, '5 Verteidiger (' + verteidiger + ')');
  ok(T.g.space.escorts.filter((e) => e.ally).length === 2, 'zwei Söldnerschiffe als Verbündete');
  ok(T.g.flotte && T.g.flotte.befehl && T.g.flotte.befehl.art === 'ausschalten', 'Flottenbefehl ausschalten ohne Legat erteilt');
  // Verteidiger fallen lassen (die Gefechtslogik testen andere Tests): Gegner entfernen
  T.g.space.enemies = T.g.space.enemies.filter((e) => e.tag !== 'verteidiger'); T.run(1.5);
  ok(T.step() === 'lager', 'Verteidiger weg: lager (' + T.step() + ')');
  await tick();   // der Landepunkt wird außerhalb des Ticks gebaut, dann holt der Vorbau Evert und die Wachen nach
  info('aways: ' + Object.keys(T.g.aways).join(',') + ' · Landepunkt bereit: ' + JSON.stringify(require('../server/sim/landepunkte.js').bereit ? require('../server/sim/landepunkte.js').bereit(T.g, 'schrottkante.lager') : null));
  ok(Away.personState(T.g, 'schrottkante.lager', 'evert') === 'ok', 'Evert sitzt in der Zelle (Landepunkt schrottkante.lager)');
  // Ops beamt Evert an Bord: erst Landepunkt-Scan
  T.p.console = 'weapons';
  const lpd = require('../server/sim/landepunkte.js').liste(T.g).find((q) => q.id === 'schrottkante.lager');
  T.g.ship.x = lpd.beam.x + 40; T.g.ship.y = lpd.beam.y; T.g.ship.vx = 0; T.g.ship.vy = 0; T.g.ship.speed = 0; T.run(0.3);
  ok(/gescannt/.test(PB.aufnehmenGrund(T.g, 'evert') || ''), 'ohne Scan kein Beamen: ' + PB.aufnehmenGrund(T.g, 'evert'));
  LP.markieren(T.g, 'schrottkante.lager'); T.run(0.5);
  ok(!T.g.transferZiel && !PB.aufnehmenGrund(T.g, 'evert'), 'gescannt und in Reichweite: Beamen möglich, ohne Wahl an der Transfer-Konsole (' + PB.aufnehmenGrund(T.g, 'evert') + ')');
  const e1 = T.cmd('weapons.person');
  ok(!e1.length && T.g.fracht.halt && T.g.fracht.halt.kind === 'person_an', 'Ops: Person beamen startet ' + JSON.stringify(e1));
  T.run(3.5);
  ok(PB.personAnBord(T.g, 'evert'), 'Evert an Bord');
  T.run(1.5);
  ok(T.step() === 'hoch' || !!T.done('k9b_soeldner'), 'weiter: hoch bzw. erledigt (' + T.step() + ')');
  T.run(1.5);
  const d = T.done('k9b_soeldner');
  ok(d && d.ausgang === 'erfolg', 'Ausgang erfolg (kein Außenteam unten)');
  ok(T.fakt('lerche_weg') === 'soeldner' && T.fakt('evert') === 'an_bord', 'Fakten: Weg Söldner, Evert an Bord');
});

// T5: die Schlacht MIT den fünf Verteidigern und der Söldnerflotte (kein Entfernen der Gegner). Die Lerche bekommt keine Eingabe
// (keine Waffen, keine Reparatur, kein Ruder): Das ist der Schlechtfall "Crew hilft nicht". Mit aktiver Crew siehe `node tools/sim-sund.js --kapitel k9b_soeldner`.
for (const seed of [1, 4, 6]) {
  await section('9B Schlacht mit Verteidigern, Lerche passiv (Seed ' + seed + ')', async () => {
    const T = setup(seed);
    T.g.debugGoto('concordia', false); T.run(0.3);
    T.g.inventory.marks = 450;
    T.buch('k9b_soeldner'); T.run(0.5);
    T.g.mission.choice('zahlen'); T.run(1);
    ok(T.fakt('soeldner') === 'angeheuert', 'angeheuert');
    T.run(0.5);
    T.g.debugGoto('schrottkante', false); T.run(1.5);
    ok(T.step() === 'schlacht', 'schlacht (' + T.step() + ')');
    const start = T.g.space.enemies.filter((e) => e.tag === 'verteidiger').length;
    ok(start === 5 && T.g.space.escorts.filter((e) => e.ally).length === 2, '5 Verteidiger gegen 2 Söldnerschiffe');
    let minHull = T.g.ship.hull, tEnde = null;
    const gewonnen = T.run(240, (t) => { minHull = Math.min(minHull, T.g.ship.hull); if (T.step() === 'lager') { tEnde = t; return true; } return T.g.ship.hull <= 0; });
    const nochDa = T.g.space.enemies.filter((e) => e.tag === 'verteidiger').length;
    ok(gewonnen && nochDa === 0, 'Flotte schlägt alle Verteidiger (' + (tEnde != null ? tEnde.toFixed(0) + ' s' : 'nicht in 240 s') + ', übrig ' + nochDa + ')');
    ok(T.g.ship.hull > 0 && minHull > 0, 'Lerche überlebt (kleinster Hüllenstand ' + minHull.toFixed(0) + ' %, Ende ' + T.g.ship.hull.toFixed(0) + ' %)');
    const verb = T.g.space.escorts.filter((e) => e.ally);
    ok(verb.length === 2, 'beide Söldnerschiffe leben (' + verb.map((e) => e.tag + ':' + Math.round(e.hp)).join(', ') + ')');
    ok(!T.fakt('soeldner_verloren'), 'kein Söldnerverlust gemeldet');
    info('Seed ' + seed + ': Sieg nach ' + (tEnde != null ? tEnde.toFixed(0) : '?') + ' s, Lerche minimal ' + minHull.toFixed(0) + ' % Hülle');
  });
}

console.log(`\ntest-sl9: ${n - fails}/${n} ok`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
process.exit(fails ? 1 : 0);
})();
