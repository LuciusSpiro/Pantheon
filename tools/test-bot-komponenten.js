'use strict';
// TEC-01 E: die drei Bot-Pfade lernen die Komponentenlage der Schildkette (Schrauber, Spieler-Bot, Befehl tech.reparieren), eine Aufgabenwahl: server/sim/komponenten-plan.js.
//   1. Plan: reine Fälle je Lage (zerstörter Generator, defekt + geflickt, Relais verschlissen n >= 3, Druck/ruhig, ohne Ersatzteile, ruhige Tauschrunde, Reserve)
//   2. Quellscan: der Plan schreibt keinen Spielzustand; die drei Pfade rufen ihn auf (keine Kopie der Regeln)
//   3. Reparaturliste: Eintrag mit Zielkomponente (technik.repair komp), Normalisierung, Snapshot
//   4. Schrauber (Automatik, 1 Mensch): Treffer auf die Schildkette, der Generator wird mit und ohne Ersatzteile wieder geheilt; ein Wunsch des Eintrags geht vor
//   5. Spieler-Bot (solo, repairDuty): Treffer auf den Generator, Flicken/Tausch/Relais-Minispiel heilen ihn
//   6. Befehl tech.reparieren (Bot-Mannschaft + Schrauber): Eintrag mit Art und Komponente, der Generator wird geheilt
//   node tools/test-bot-komponenten.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const K = require('../server/sim/komponenten.js');
const Plan = require('../server/sim/komponenten-plan.js');
const Bots = require('../server/sim/bots.js');
const Station = require('../server/sim/station.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const { BotKern } = require('../server/bots/kern.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botkomp-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
const HZ = CONFIG.tickHz;
const CODES = { o: 'ok', d: 'defekt', g: 'geflickt' };
const setz = (g, sys, codes, zaehler) => { K.erzeugeAusZustand(g, sys); codes.split('').forEach((c, i) => { g.ship.komp[sys][i].z = CODES[c]; if (zaehler && zaehler[i] != null) g.ship.komp[sys][i].n = zaehler[i]; }); K.synchronisieren(g, sys); };
const codes = (g, sys) => K.lage(g, sys).map((c) => c.z[0]).join('');
const KETTE = ['shields', 'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];

function neuesSpiel(seed, o) {
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.space.enemies = []; g.space.projectiles = [];
  if (o && o.teile != null) g.inventory.ersatzteil = o.teile;
  return g;
}
const kontext = (o) => Object.assign({ druck: false, ersatzteile: 0, minispiel: false }, o);

// ---------- 1 Plan ----------
section('1 Plan: reine Fälle');
{
  const g = neuesSpiel(1); K.konsistentAlle(g);
  const plan = (sys, c, ctx, zaehler) => { setz(g, sys, c, zaehler); return Plan.reparaturPlan(g, sys, kontext(ctx)); };
  const gleich = (p, aktion, komp) => !!p && p.aktion === aktion && p.komp === komp;
  ok(plan('shields', 'ooo', { ersatzteile: 4, minispiel: true }) === null, 'alles heil: kein Plan');
  ok(Plan.reparaturPlan(g, 'reactor', kontext({ ersatzteile: 4 })) === null && Plan.reparaturPlan(g, 'engines', kontext()) === null, 'System ohne Komponenten: kein Plan');
  // zerstörter Generator
  ok(gleich(plan('shields', 'ddo', { ersatzteile: 4 }), 'swap', 'K'), 'zerstörter Generator, Teile, ruhig: Tausch (erste defekte Komponente, Steuerkern)');
  ok(gleich(plan('shields', 'ddo', { ersatzteile: 4, druck: true }), 'flick', 'K'), 'zerstörter Generator unter Druck: Flicken, auch mit Teilen');
  ok(gleich(plan('shields', 'ddo', {}), 'flick', 'K'), 'zerstörter Generator ohne Teile: Flicken');
  ok(gleich(plan('shields', 'dod', { ersatzteile: 4, minispiel: true }), 'swap', 'K'), 'Steuerkern + Relais defekt, Teile, Minispiel möglich: das Teil geht an den Steuerkern, das Relais folgt per Minispiel');
  ok(gleich(plan('shields', 'odd', { ersatzteile: 4, minispiel: true }), 'swap', 'S'), 'Spannungsregler + Relais defekt: Tausch am Regler (nicht am Relais)');
  ok(gleich(plan('shields', 'dod', { minispiel: true }), 'minigame', 'R'), 'zerstört ohne Teile, Minispiel möglich: Relais zuerst per Minispiel (kostenlos, ok statt Flicken)');
  ok(gleich(plan('shields', 'dod', {}), 'flick', 'K'), 'zerstört ohne Teile, ohne Minispiel (Schrauber): Flicken');
  // beschädigt
  ok(gleich(plan('shields', 'odo', { ersatzteile: 2 }), 'swap', 'S'), 'beschädigt (Regler), Teile da, ruhig: Tausch');
  ok(gleich(plan('shields', 'ood', { ersatzteile: 2, minispiel: true }), 'minigame', 'R'), 'beschädigt (Relais), Minispiel, ruhig: Minispiel statt Teil');
  ok(gleich(plan('shields', 'ood', { ersatzteile: 2, minispiel: false }), 'swap', 'R'), 'beschädigt (Relais), Schrauber (kein Minispiel), Teile: Tausch');
  ok(gleich(plan('shields', 'ood', { ersatzteile: 2, minispiel: true, druck: true }), 'flick', 'R'), 'beschädigt (Relais) unter Druck: Flicken, kein Minispiel');
  ok(gleich(plan('emitter_bow', 'od', { ersatzteile: 1 }), 'swap', 'L') && gleich(plan('emitter_bow', 'od', {}), 'flick', 'L'), 'Emitter-Leitung defekt: Tausch mit Teil, sonst Flicken (L hat kein Minispiel)');
  // n >= 3: Relais verschlissen
  const sperre = K.ausfallSperre(g);
  ok(gleich(plan('shields', 'ood', { ersatzteile: 2, minispiel: true }, [0, 0, sperre]), 'swap', 'R'), `Relais verschlissen (n ${sperre}): Tausch statt Minispiel`);
  ok(gleich(plan('shields', 'ood', { minispiel: true }, [0, 0, sperre]), 'flick', 'R'), 'Relais verschlissen, ohne Teile: Flicken (kein Minispiel)');
  ok(gleich(plan('shields', 'ood', { ersatzteile: 2, minispiel: true }, [0, 0, sperre - 1]), 'minigame', 'R'), 'Relais knapp unter der Sperre: noch Minispiel');
  ok(gleich(plan('shields', 'dod', { ersatzteile: 4, minispiel: true }, [0, 0, sperre]), 'swap', 'K'), 'zerstört, Relais verschlissen: Tausch zuerst am Steuerkern');
  // defekt + geflickt: Defektes zuerst
  ok(gleich(plan('shields', 'gdo', { ersatzteile: 3 }), 'swap', 'S') && gleich(plan('shields', 'gdo', {}), 'flick', 'S'), 'geflickt + defekt: zuerst die defekte Komponente (nicht die geflickte)');
  ok(gleich(plan('shields', 'dgo', { ersatzteile: 3 }), 'swap', 'K'), 'defekt vor geflickt unabhängig von der Rezeptreihenfolge');
  // ruhige Tauschrunde
  ok(gleich(plan('shields', 'ggo', { ersatzteile: 2 }), 'swap', 'K'), 'nichts defekt, geflickt, ruhig, Teile übrig: tauschen (erste geflickte)');
  ok(plan('shields', 'ggo', { ersatzteile: 2, druck: true }) === null, 'geflickt unter Druck: nichts tun');
  ok(plan('shields', 'ggo', { ersatzteile: 0 }) === null, 'geflickt ohne Teile: nichts tun');
  ok(plan('shields', 'ggo', { ersatzteile: 1, reserve: 1 }) === null && gleich(plan('shields', 'ggo', { ersatzteile: 2, reserve: 1 }), 'swap', 'K'), 'Reserve: die ruhige Tauschrunde rührt die Reserve nicht an');
  // Ablauf: Generator zerstört -> wieder heil, Zug um Zug (rein, mit Anwendung des Plans)
  setz(g, 'shields', 'ddo');
  const folge = []; let teile = 1;
  for (let i = 0; i < 6; i++) {
    const p = Plan.reparaturPlan(g, 'shields', kontext({ ersatzteile: teile, minispiel: true }));
    if (!p) break;
    folge.push(p.aktion + ':' + p.komp);
    if (p.aktion === 'swap') { K.tauschenKomponente(g, 'shields', p.komp); teile--; } else if (p.aktion === 'minigame') K.reparierenRelais(g, 'shields'); else K.flickenKomponente(g, 'shields', p.komp);
  }
  ok(folge.join(' ') === 'swap:K flick:S' && g.ship.systems.shields === 'ok' && codes(g, 'shields') === 'ogo', 'zerstörter Generator mit einem Teil: Tausch (Steuerkern), dann Flicken (Regler) -> ' + folge.join(' ') + ', Generator ' + g.ship.systems.shields + ' ' + codes(g, 'shields'));
  // Kontext aus dem Spielzustand
  const h = neuesSpiel(2); h.inventory.ersatzteil = 1;
  setz(h, 'shields', 'odo');
  ok(Plan.kontextFuer(h, 'shields', {}).ersatzteile === 0, 'Kontext: ein Teil im Lager bleibt für ein zerstörtes System reserviert (beschädigt: 0 verfügbar)');
  setz(h, 'shields', 'ddo');
  ok(Plan.kontextFuer(h, 'shields', {}).ersatzteile === 1 && Plan.kontextFuer(h, 'shields', { traegtTeil: true }).ersatzteile === 2, 'Kontext: zerstört: das Teil zählt, ein getragenes dazu');
  ok(Plan.kontextFuer(h, 'shields', {}).druck === false, 'Kontext: ohne Gegner kein Druck');
  h.space.enemies = [{ kind: 'relay' }];
  ok(Plan.kontextFuer(h, 'shields', {}).druck === false, 'Kontext: ein Relais ist kein Gegner');
  h.space.enemies = [{ kind: 'raider' }];
  ok(Plan.kontextFuer(h, 'shields', {}).druck === true && Plan.kontextFuer(h, 'shields', { druck: false }).druck === false, 'Kontext: Gegner im Raum = Druck, der Aufrufer kann ihn überschreiben');
  ok(Plan.listenModus({ aktion: 'swap' }) === 'part' && Plan.listenModus({ aktion: 'flick' }) === 'flick' && Plan.listenModus({ aktion: 'minigame' }) === 'flick' && Plan.listenModus(null) === null, 'Listenmodus: Tausch = part, sonst flick');
  ok(Plan.wunschZulaessig(h, 'shields', 'flick', 'K') && !Plan.wunschZulaessig(h, 'shields', 'flick', 'R') && !Plan.wunschZulaessig(h, 'shields', 'swap', 'R') && !Plan.wunschZulaessig(h, 'shields', 'flick', 'L'), 'Wunsch zulässig: Flicken nur defekt, Tausch nicht heil, nur Arten des Rezepts');
}

// ---------- 2 Quellscan ----------
section('2 Quellscan: eine Quelle, keine Kopie');
{
  const lies = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const plan = lies('server/sim/komponenten-plan.js');
  ok(!/\b(game|g|ship)\.[A-Za-z_.]+\s*=(?!=)/.test(plan) && !/\.(cmd|send|emit|push|splice|delete)\(/.test(plan) && !/repairSystem|flickenKomponente|tauschenKomponente|reparierenRelais/.test(plan), 'komponenten-plan.js liest nur (keine Zuweisung an den Spielzustand, keine Reparatur)');
  const schrauber = lies('server/sim/bots.js'), kern = lies('server/bots/kern.js'), technik = lies('server/bots/befehle/technik.js');
  ok(/Plan\.reparaturPlan/.test(schrauber) && /Plan\.reparaturPlan/.test(kern), 'Schrauber und Spieler-Bot wählen über Plan.reparaturPlan');
  ok(/reparaturEintrag/.test(technik) && /reparaturEintrag\(sys\)/.test(kern) && !/Plan\./.test(technik), 'tech.reparieren holt den Eintrag vom Agenten (reparaturEintrag, derselbe Plan), ohne selbst zu planen');
  ok(!/ersatzteil\s*>\s*0\s*\?\s*'part'/.test(technik), 'tech.reparieren hat die alte Einzelregel (Teil bei zerstört) nicht mehr');
}

// ---------- 3 Reparaturliste: Eintrag mit Zielkomponente ----------
section('3 Reparaturliste: Eintrag mit Zielkomponente');
{
  const g = neuesSpiel(3); K.konsistentAlle(g); setz(g, 'shields', 'ddo');
  ok(Protocol.normKomp('S') === 'S' && Protocol.normKomp('X') === undefined && Protocol.normKomp(3) === undefined, 'normKomp: bekannte Art, sonst kein Wunsch');
  ok(Bots.queueRepairKomponente(g, 'shields', 'flick', 'S') === null && g.ship.repairQueue.length === 1 && g.ship.repairQueue[0].komp === 'S', 'Eintrag mit Zielkomponente S');
  ok(g.snapshot().ship.repairQueue[0].komp === 'S', 'der Snapshot trägt die Zielkomponente im Eintrag');
  ok(Bots.queueRepairKomponente(g, 'shields', 'part', undefined) === null && g.ship.repairQueue.length === 1 && g.ship.repairQueue[0].komp === undefined && g.ship.repairQueue[0].mode === 'part', 'derselbe Eintrag ohne Wunsch: Art geändert, Wunsch gelöscht');
  ok(!('komp' in g.snapshot().ship.repairQueue[0]), 'ohne Wunsch fehlt komp im Snapshot (Format unverändert)');
  ok(Bots.queueRepairKomponente(g, 'shields', 'flick', 'L') === null && g.ship.repairQueue[0].komp === undefined, 'eine Art, die nicht im Rezept steht (L am Generator): kein Wunsch');
  ok(Bots.queueRepairKomponente(g, 'shields', null) === null && g.ship.repairQueue.length === 0, 'mode null entfernt den Eintrag');
  ok(Bots.queueRepairKomponente(g, 'engines', 'flick', 'S') === 'Triebwerk ist heil.' || typeof Bots.queueRepairKomponente(g, 'engines', 'flick', 'S') === 'string', 'heiles System: Fehlertext wie queueRepair');
  g.ship.systems.engines = 'damaged';
  Bots.queueRepairKomponente(g, 'engines', 'flick', 'S');
  ok(g.ship.repairQueue.find((e) => e.system === 'engines') && g.ship.repairQueue.find((e) => e.system === 'engines').komp === undefined, 'System ohne Komponenten: kein Wunsch');
}

// ---------- 4 Schrauber ----------
const schlag = (g, sys, mal) => { for (let i = 0; i < mal; i++) I.damageSystem(g, sys); };
const lauf = (g, sek, bis, nachTick) => { const t1 = g.time + sek; while (g.time < t1) { g.step(); if (g.wantsSnapshot()) g.snapshot(); if (nachTick) nachTick(); if (bis && bis()) return true; } return bis ? !!bis() : true; };
function menschenPartie(seed, o) {
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { send() {}, sendRaw() {} }; g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  g.lobbyOpts.startMission = 'arena_space';
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = 1e9;
  g.space.enemies = [];
  lauf(g, 3);
  g.inventory.ersatzteil = (o && o.teile) != null ? o.teile : 4;
  return g;
}
const heil = (g, sys) => g.ship.systems[sys] === 'ok' && K.lage(g, sys).every((c) => c.z !== 'defekt');
const ohneFlicken = (g, sys) => K.lage(g, sys).every((c) => c.z === 'ok');

section('4 Schrauber: Generator nach Treffern wieder heil');
{
  const SEEDS = [1, 2, 3, 4, 5];
  for (const [teile, name] of [[0, 'ohne Ersatzteile'], [4, 'mit 4 Ersatzteilen']]) {
    let heilN = 0, saubern = 0, swaps = 0, flicks = 0, maxT = 0; const fehler = [];
    for (const seed of SEEDS) {
      const g = menschenPartie(seed, { teile });
      schlag(g, 'shields', 2); schlag(g, 'emitter_bow', 1);   // Generator zerstört (zwei Komponenten), Bug-Emitter beschädigt
      const t0 = g.time; const s0 = { sw: g.stats.swaps || 0, fl: g.stats.flicks || 0 };
      const zerst = g.ship.systems.shields === 'broken';
      const fertig = lauf(g, 240, () => heil(g, 'shields') && heil(g, 'emitter_bow') && !g.ship.repairQueue.length && g.bots.every((b) => !b.task));
      if (fertig && zerst) heilN++; else fehler.push(seed + ':' + codes(g, 'shields') + '/' + codes(g, 'emitter_bow') + '@' + g.ship.systems.shields);
      if (ohneFlicken(g, 'shields') && ohneFlicken(g, 'emitter_bow')) saubern++;
      swaps += (g.stats.swaps || 0) - s0.sw; flicks += (g.stats.flicks || 0) - s0.fl; maxT = Math.max(maxT, g.time - t0);
      if (g.errors) fehler.push(seed + ': errors ' + g.errors);
    }
    console.log(`       Schrauber ${name}: Seeds ${SEEDS.join(',')} (n=${SEEDS.length}): geheilt ${heilN}/${SEEDS.length}, ohne Flicken ${saubern}/${SEEDS.length}, Tausche ${swaps}, Flicken ${flicks}, längste Dauer ${maxT.toFixed(0)} s`);
    ok(heilN === SEEDS.length && fehler.length === 0, `Schrauber ${name}: der zerstörte Generator und der Emitter sind in allen ${SEEDS.length} Läufen wieder heil (keine Komponente defekt)${fehler.length ? ' ' + fehler.join(' ') : ''}`);
    if (teile === 0) ok(swaps === 0 && flicks >= 3 * SEEDS.length && saubern === 0, `ohne Teile nur Flicken (${flicks} Flicken, ${swaps} Tausche), die Komponenten bleiben geflickt`);
    else ok(swaps >= 3 * SEEDS.length && saubern >= SEEDS.length - 1, `mit Teilen getauscht (${swaps} Tausche) und die Schildkette ist am Ende ohne Flicken (${saubern}/${SEEDS.length})`);
  }
  // Gefecht: ein Gegner im Raum = Druck: der Schrauber flickt (schnell), tauscht nicht
  let swapsImGefecht = 0, flicksImGefecht = 0, geheilt = 0;
  for (const seed of [1, 2, 3]) {
    const g = menschenPartie(seed, { teile: 4 });
    const e = require('../server/sim/space.js').spawnEnemy(g, 'raider', { x: g.ship.x + 900, y: g.ship.y, facing: Math.PI });
    const fest = { x: e.x, y: e.y };
    schlag(g, 'shields', 2);
    const s0 = { sw: g.stats.swaps || 0, fl: g.stats.flicks || 0 };
    const fertig = lauf(g, 90, () => g.ship.systems.shields === 'ok', () => { if (g.space.enemies.includes(e)) { e.x = fest.x; e.y = fest.y; e.fireT = -999; e.hp = e.hpMax; } g.space.projectiles = g.space.projectiles.filter((q) => q.kind !== 'enemy'); });
    if (fertig) geheilt++;
    swapsImGefecht += (g.stats.swaps || 0) - s0.sw; flicksImGefecht += (g.stats.flicks || 0) - s0.fl;
  }
  console.log(`       Schrauber im Gefecht: Seeds 1,2,3 (n=3): Generator ok ${geheilt}/3, Flicken ${flicksImGefecht}, Tausche ${swapsImGefecht}`);
  ok(geheilt === 3 && flicksImGefecht >= 6 && swapsImGefecht === 0, 'unter Druck (Gegner im Raum) flickt der Schrauber den Generator, ohne Teile zu tauschen');
  // Wunsch des Eintrags: Regler zuerst, obwohl der Steuerkern vorn steht
  const w = menschenPartie(7, { teile: 0 });
  w.ship.botAuto = false; w.ship.botAutoChosen = true;
  setz(w, 'shields', 'ddo');   // Steuerkern und Regler defekt (Rezeptreihenfolge: der Steuerkern stünde vorn)
  const vorher = codes(w, 'shields');
  Bots.queueRepairKomponente(w, 'shields', 'flick', 'S');
  lauf(w, 120, () => K.lage(w, 'shields').find((c) => c.t === 'S').z !== 'defekt');
  const nachher = K.lage(w, 'shields');
  ok(vorher === 'ddo' && nachher.find((c) => c.t === 'S').z === 'geflickt' && nachher.find((c) => c.t === 'K').z === 'defekt', `Wunsch des Eintrags (Regler S) gilt: vorher ${vorher}, nachher ${codes(w, 'shields')} (Steuerkern bleibt defekt, solange der Wunsch gilt)`);
  lauf(w, 120, () => w.ship.systems.shields === 'ok');
  ok(w.ship.systems.shields === 'ok', 'danach arbeitet der Schrauber den Rest nach Plan ab (Generator ok)');
}

// ---------- 5 Spieler-Bot ----------
class ReparaturAgent extends BotKern {
  update(S) {
    const p = this.me(S);
    if (!p || S.phase !== 'play') return;
    if (this.waitT > 0) { this.waitT -= 1 / HZ; return; }
    if (p.downed) return;
    this.repairDuty(S, p, { damaged: true, cooldown: 1 });
  }
}
function soloPartie(seed, teile) {
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const a = new ReparaturAgent(g, 0, 'solo', {});
  g.lobbyOpts.startMission = 'arena_space';
  g.addConnection(a.conn); a.hello();
  for (let i = 0; i < 2 * HZ; i++) g.step();
  if (g.arena) g.arena.nextAt = 1e9;
  g.space.enemies = [];
  Bots.setBotAuto(g, false);   // der Schrauber ruht: nur der Spieler-Bot repariert
  g.inventory.ersatzteil = teile;
  return { g, a, snap: g.snapshot() };
}
function laufSolo(P, sek, bis) {
  const t1 = P.g.time + sek;
  while (P.g.time < t1) { P.g.step(); if (P.g.wantsSnapshot()) P.snap = P.g.snapshot(); P.a.update(P.snap); if (bis && bis()) return true; }
  return bis ? !!bis() : true;
}
section('5 Spieler-Bot (repairDuty): Generator nach Treffern wieder heil');
{
  const SEEDS = [1, 2, 3, 4];
  for (const [teile, name] of [[0, 'ohne Ersatzteile'], [4, 'mit 4 Ersatzteilen']]) {
    let heilN = 0, mini = 0, swaps = 0, flicks = 0; const fehler = []; let maxT = 0;
    for (const seed of SEEDS) {
      const P = soloPartie(seed, teile); const g = P.g;
      schlag(g, 'shields', 2);
      const t0 = g.time; const s0 = { sw: g.stats.swaps || 0, fl: g.stats.flicks || 0, mg: g.stats.minigames || 0 };
      const zerst = g.ship.systems.shields === 'broken';
      const fertig = laufSolo(P, 300, () => heil(g, 'shields') && !P.a.memo.job);
      if (fertig && zerst) heilN++; else fehler.push(seed + ':' + codes(g, 'shields') + '@' + g.ship.systems.shields + ' job ' + JSON.stringify(P.a.memo.job && { how: P.a.memo.job.how, komp: P.a.memo.job.komp }));
      swaps += (g.stats.swaps || 0) - s0.sw; flicks += (g.stats.flicks || 0) - s0.fl; mini += (g.stats.minigames || 0) - s0.mg; maxT = Math.max(maxT, g.time - t0);
      if (g.errors) fehler.push(seed + ': errors ' + g.errors);
    }
    console.log(`       Spieler-Bot ${name}: Seeds ${SEEDS.join(',')} (n=${SEEDS.length}): geheilt ${heilN}/${SEEDS.length}, Tausche ${swaps}, Flicken ${flicks}, Minispiele ${mini}, längste Dauer ${maxT.toFixed(0)} s`);
    ok(heilN === SEEDS.length && fehler.length === 0, `Spieler-Bot ${name}: der zerstörte Generator ist in allen ${SEEDS.length} Läufen wieder heil${fehler.length ? ' ' + fehler.join(' | ') : ''}`);
    if (teile === 0) ok(swaps === 0, `ohne Teile kein Tausch (${swaps}), Flicken ${flicks}, Minispiele ${mini}`);
    else ok(swaps >= SEEDS.length, `mit Teilen wird getauscht (${swaps} Tausche, ${mini} Minispiele für das Relais)`);
  }
  // Relais verschlissen (n >= 3): kein Minispiel, Tausch
  {
    const P = soloPartie(11, 4); const g = P.g;
    setz(g, 'shields', 'ood', [0, 0, K.ausfallSperre(g)]);
    const mg0 = g.stats.minigames || 0, sw0 = g.stats.swaps || 0;
    const fertig = laufSolo(P, 200, () => heil(g, 'shields') && !P.a.memo.job);
    ok(fertig && (g.stats.minigames || 0) === mg0 && (g.stats.swaps || 0) === sw0 + 1 && g.ship.komp.shields[2].n === 0, `verschlissenes Relais (n ${K.ausfallSperre(g)}): ein Tausch statt Minispiel, Ausfallzähler danach 0 (Generator ${g.ship.systems.shields}, Tausche ${(g.stats.swaps || 0) - sw0})`);
  }
  // Ruhige Tauschrunde: geflickte Komponenten werden mit übrigen Teilen getauscht
  {
    const P = soloPartie(12, 4); const g = P.g;
    setz(g, 'shields', 'ggo');
    const sw0 = g.stats.swaps || 0;
    const fertig = laufSolo(P, 200, () => ohneFlicken(g, 'shields') && !P.a.memo.job);
    ok(fertig && (g.stats.swaps || 0) - sw0 === 2, `ruhige Phase, Generator geflickt (ggo), Teile übrig: beide Flicken werden getauscht (${(g.stats.swaps || 0) - sw0} Tausche, ${codes(g, 'shields')})`);
    const Q = soloPartie(13, 1); setz(Q.g, 'shields', 'ggo');
    laufSolo(Q, 60);
    ok(codes(Q.g, 'shields') === 'ggo', 'mit nur einem Teil (Reserve) bleibt der Flicken stehen');
  }
}

// ---------- 6 Befehl tech.reparieren ----------
function befehlPartie(seed) {
  const mk = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: fs.mkdtempSync(path.join(TMP, 'w')), seed, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = mk(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  for (const r of ['navigation', 'ops', 'technik']) BotSpieler.botHinzufuegen(g, null, r);
  g.lobbyOpts.startMission = 'arena_space';
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = 1e9;
  g.space.enemies = [];
  const techBot = () => g.players.find((p) => p.bot && p.rolle === 'technik');
  lauf(g, 40, () => Station.stationOf(techBot()) === 'technik');
  const sh = g.ship; sh.docked = false; sh.dockedAt = null; sh.dockArmed = true; sh.x = 1100; sh.y = 1500; sh.vx = 0; sh.vy = 0; sh.speed = 0; sh.helm.stage = 0;
  lauf(g, 3);
  return { g, c };
}
function befehlSenden(P, seed, system) {
  let uhr = 1e12 + seed * 1e6; const echt = Date.now; Date.now = () => uhr;
  try { P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'technik', befehl: 'tech.reparieren', quelle: 'menu', args: { system } }); return P.c.inbox.filter((x) => x.t === 'bot.antwort').pop(); } finally { Date.now = echt; }
}
section('6 Befehl tech.reparieren (Bot-Mannschaft, Schrauber führt aus)');
{
  const SEEDS = [1, 2, 3];
  let heilN = 0, mitKomp = 0, teileGebraucht = 0; const fehler = [];
  for (const seed of SEEDS) {
    const P = befehlPartie(seed); const g = P.g;
    g.inventory.ersatzteil = 4;
    schlag(g, 'shields', 2);
    const antwort = befehlSenden(P, seed, 'shields');
    const e = g.ship.repairQueue.find((q) => q.system === 'shields');
    if (e && e.komp && e.mode === 'part') mitKomp++;
    const s0 = g.stats.swaps || 0;
    const fertig = lauf(g, 240, () => heil(g, 'shields'));
    if (fertig && antwort && /ok$/.test(antwort.textId)) heilN++; else fehler.push(seed + ':' + (antwort && antwort.textId) + ' ' + codes(g, 'shields') + ' ' + JSON.stringify(e));
    teileGebraucht += (g.stats.swaps || 0) - s0;
    if (g.errors) fehler.push(seed + ': errors ' + g.errors);
  }
  console.log(`       tech.reparieren: Seeds ${SEEDS.join(',')} (n=${SEEDS.length}): Eintrag mit Art und Komponente ${mitKomp}/${SEEDS.length}, Generator geheilt ${heilN}/${SEEDS.length}, Tausche ${teileGebraucht}`);
  ok(mitKomp === SEEDS.length, 'der Eintrag der Reparaturliste trägt Art (Tausch, Teil da, zerstört) und Zielkomponente');
  ok(heilN === SEEDS.length && fehler.length === 0, `der Befehl führt zum geheilten Generator in allen ${SEEDS.length} Läufen${fehler.length ? ' ' + fehler.join(' | ') : ''}`);
  ok(teileGebraucht >= SEEDS.length, `mit Teilen wird getauscht (${teileGebraucht} Tausche)`);
}

// ---------- 7 Einzeldefekte: jede Komponente, alle drei Pfade ----------
// Befund (Review B1/B2/C): der Spieler-Bot wählte für ein beschädigtes System immer das Minispiel; bei heilem Relais lehnt der Server es ab (Schleife, 60 s ohne Reparatur).
// Hier: genau eine Komponente defekt (K, S, L am Emitter, Relais verschlissen n >= 3, Relais n 0) -> jeder Pfad heilt sie; kein abgelehntes Minispiel.
section('7 Einzeldefekte (K, S, L, Relais): Schrauber, Spieler-Bot, tech.reparieren');
{
  const FAELLE = [
    { name: 'Steuerkern K defekt', sys: 'shields', codes: 'doo' },
    { name: 'Spannungsregler S defekt (häufigster Überlastschaden)', sys: 'shields', codes: 'odo' },
    { name: 'Leitung L defekt (Emitter)', sys: 'emitter_aft', codes: 'od' },
    { name: 'Relais R defekt, n 0', sys: 'shields', codes: 'ood' },
    { name: 'Relais R verschlissen (n 3)', sys: 'shields', codes: 'ood', zaehler: [0, 0, 3] },
  ];
  const SEEDS = [1, 2];
  const { statistik } = require('../server/bots/kern.js');
  for (const f of FAELLE) {
    const aufbau = (g) => { setz(g, f.sys, f.codes, f.zaehler); };
    let schr = 0, spieler = 0, befehl = 0, abgelehnt = 0;
    for (const seed of SEEDS) {
      for (const teile of [0, 4]) {
        const g = menschenPartie(seed, { teile }); aufbau(g);
        if (lauf(g, 240, () => heil(g, f.sys) && !g.ship.repairQueue.length)) schr++;
        const P = soloPartie(seed, teile); aufbau(P.g);
        const r0 = statistik(P.g).minigameRejected || 0;
        if (laufSolo(P, 200, () => heil(P.g, f.sys) && !P.a.memo.job)) spieler++;
        abgelehnt += (statistik(P.g).minigameRejected || 0) - r0;
      }
      const B = befehlPartie(seed); B.g.inventory.ersatzteil = seed === 1 ? 4 : 0; aufbau(B.g);
      const antwort = befehlSenden(B, seed, f.sys);
      if (antwort && /ok$/.test(antwort.textId) && lauf(B.g, 240, () => heil(B.g, f.sys))) befehl++;
    }
    const nSchr = SEEDS.length * 2;
    console.log(`       ${f.name}: Schrauber ${schr}/${nSchr}, Spieler-Bot ${spieler}/${nSchr} (abgelehnte Minispiele ${abgelehnt}), tech.reparieren ${befehl}/${SEEDS.length} (Seeds ${SEEDS.join(',')}, mit 0 und 4 Teilen)`);
    ok(schr === nSchr && spieler === nSchr && befehl === SEEDS.length && abgelehnt === 0, `${f.name}: alle drei Pfade heilen die Komponente, kein abgelehntes Minispiel`);
  }
}

// ---------- 8 Zielkomponente des Eintrags: der Schrauber arbeitet an der gewählten Komponente (TEC-01 Nacharbeit 1.6) ----------
section('8 Schrauber nutzt die gewählte Zielkomponente der Reparaturliste');
{
  const ersteReparatur = (seed, wunsch, modus) => {
    const g = menschenPartie(seed, { teile: 4 }); setz(g, 'shields', 'ddo');   // Steuerkern und Spannungsregler defekt (zerstört)
    ok(Bots.queueRepairKomponente(g, 'shields', modus, wunsch) === null, `Eintrag (${modus}, Wunsch ${wunsch || 'keiner'}) angenommen`);
    lauf(g, 240, () => K.lage(g, 'shields').filter((c) => c.z === 'defekt').length < 2);
    return codes(g, 'shields');
  };
  for (const seed of [1, 2]) {
    const ohne = ersteReparatur(seed, undefined, 'flick');
    const mit = ersteReparatur(seed, 'S', 'flick');
    ok(mit === 'dgo', `Seed ${seed} Flicken mit Wunsch S: zuerst der Spannungsregler (ist ${mit})`);
    ok(ohne === 'gdo', `Seed ${seed} Flicken ohne Wunsch: Standard = erste defekte in Rezeptreihenfolge, der Steuerkern (ist ${ohne})`);
    const tausch = ersteReparatur(seed, 'S', 'part');
    ok(tausch === 'doo', `Seed ${seed} Tausch mit Wunsch S: der Spannungsregler wird ersetzt (ist ${tausch})`);
  }
}

console.log(`\ntest-bot-komponenten: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
