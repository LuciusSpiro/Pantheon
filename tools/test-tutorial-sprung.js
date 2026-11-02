'use strict';
// GEG-01 D: Sprung im Tutorial wie im freien Spiel (Sprungpunkt-Automatik, Schnellsprung), Grenzen bleiben wirksam.
//   (a) Tutorial, Lerche am Sprungpunkt -> j.dest von selbst, Ereignis destSelected; m1 läuft ohne Zielwahl des Captains weiter
//   (b) Tutorial: Schnellsprung über erkundete Sektoren (Route, befehl, Hops)
//   (c) Tutorial: nie aus dem Saumraum hinaus (Zielwahl, Automatik, Route, Hop, Notsprung) – auch bei offener Kante tutorial-ende
//   (d) Eisenwald-Kette nach dem Tutorial: Schnellsprung läuft, Wolfstor nur mit Sperrriegel, Sperren der Mission gelten je Hop
//   node tools/test-tutorial-sprung.js   (Mutationsprobe: tools/mutation-tutorial-sprung.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = process.env.TUTSPRUNG_ROOT || path.join(__dirname, '..');
const { Game } = require(path.join(ROOT, 'server/game.js'));
const Sektoren = require(path.join(ROOT, 'shared/sektoren.js'));
const Sprung = require(path.join(ROOT, 'server/sim/sprung.js'));
const Reise = require(path.join(ROOT, 'server/sim/reise.js'));
const space = require(path.join(ROOT, 'server/sim/space.js'));

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tutsprung-'));
let seq = 0;

function setup(startMission, seed) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 7, debug: true,
    env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Crew', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission }); g.handleMessage(c, { t: 'ready', ready: true });
  const t = { g, c, run: (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); }, ereignisse: [] };
  const alt = g.missionEvent.bind(g);
  g.missionEvent = (name, data) => { t.ereignisse.push({ name, data }); return alt(name, data); };   // Spion: welche Missionsereignisse kommen?
  t.run(1); g.space.enemies = [];
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0;   // kein Abfangen
  return t;
}
function place(g, x, y) { const s = g.ship; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }
function amSprungpunkt(t, hex) { const p = Sprung.sprungpunkt(t.g, hex); place(t.g, p.x - 80, p.y); t.g.space.enemies = []; t.g.step(); }
const stepId = (g) => g.mission.step && g.mission.step.id;

// ---------------------------------------------------------------------------------------------------------------------
section('(a) Tutorial (Kampagne m1): Sprungpunkt-Automatik setzt das Ziel von selbst');
{
  const t = setup('m1'); const g = t.g; const j = g.ship.jump;
  ok(g.weltstand.persistent && Sprung.tutorialLaeuft(g), 'Tutorial läuft (persistenter Weltstand, m1–m3 offen)');
  g.mission.setStep('undock'); g.explore.reveal && g.explore.reveal('b7');   // wie nach dem Annehmen des Auftrags (Schritt undock, B-7 aufgedeckt)
  ok(stepId(g) === 'undock', 'm1 im Schritt undock');
  place(g, 1200, 700); g.space.enemies = []; g.step();
  ok(j.dest === null && /Kein Sprungpunkt in Reichweite/.test(j.blockedReason || ''), 'weit weg vom Sprungpunkt: kein Ziel, einheitlicher Grund (kein Tutorial-Sondertext): „' + j.blockedReason + '“');
  t.ereignisse.length = 0;
  amSprungpunkt(t, '0306');
  ok(j.dest === 'splitter', 'am Sprungpunkt Splittergürtel: j.dest = splitter ohne selectDest');
  ok(t.ereignisse.some((e) => e.name === 'destSelected' && e.data.dest === 'splitter'), 'Ereignis destSelected kommt von der Automatik');
  ok(g.mission.cond({ dest: 'splitter' }), 'Missionsbedingung { dest: splitter } erfüllt (Ziel-Checkliste m1 „destSplitter“ hakt von selbst ab)');
  for (let i = 0; i < 30 * 40 && !j.ready; i++) g.step();
  ok(j.ready && Sprung.doJump(g) === null && g.ship.scene === 'splitter', 'Leiste voll, Faltsprung zum Splittergürtel');
  t.run(1);
  ok(stepId(g) === 'route', 'm1 läuft ohne Zielwahl des Captains weiter (Schritt undock -> route)');
  for (let i = 0; i < 60; i++) g.step();
  ok(j.dest === null && !j.ready, 'Ankunft am Gegen-Sprungpunkt: kein Rücksprung-Ziel');
  // m1 route: Boje B-7 – die Automatik setzt das Ziel, die Missionssperre (Bergungsgut) bleibt wirksam
  amSprungpunkt(t, '0406');
  ok(j.dest === 'b7', 'am Sprungpunkt B-7: Ziel von selbst');
  g.step();
  ok(!!j.blockedReason && !j.ready, 'm1 jumpBlock (Bergungsgut/Grauzahn) sperrt den Sprung weiter: „' + j.blockedReason + '“');
  ok(Sprung.doJump(g) === j.blockedReason, 'doJump liefert den Sperrgrund');
}

// ---------------------------------------------------------------------------------------------------------------------
section('(b) Tutorial (Direktstart m3): Schnellsprung über erkundete Sektoren');
{
  const t = setup('m3'); const g = t.g;
  ok(!g.weltstand.persistent && Sprung.tutorialLaeuft(g), 'Tutorial läuft (Direktstart)');
  g.explore.erkunde('0206'); g.explore.erkunde('0306'); g.explore.erkunde('0406');
  ok(Reise.planen(g, '0206', '0406') && Reise.planen(g, '0206', '0406').join() === '0306,0406', 'planen: Route über den erkundeten Splittergürtel im Tutorial');
  amSprungpunkt(t, '0306');
  ok(Sprung.selectDest(g, 'b7') === null && g.reisePlan && g.reisePlan.hops.join() === '0306,0406', 'selectDest auf B-7 legt im Tutorial die Schnellsprung-Route an (kein reisePlan = null mehr)');
  for (let i = 0; i < 30 * 40 && !g.ship.jump.ready; i++) g.step();
  ok(Reise.befehl(g) === null && g.reise && g.reise.hops.length === 2, 'Schnellsprung startet');
  t.run(9);
  ok(g.ship.scene === 'b7' && !g.reise && !g.reisePlan, 'beide Hops gesprungen, Reise beendet (Tutorial)');
}

// ---------------------------------------------------------------------------------------------------------------------
section('(c) Tutorial: kein Sprung aus dem Saumraum hinaus');
{
  const t = setup('m3'); const g = t.g; const ex = g.explore;
  const statio = Sektoren.ortVonHex('0305');
  ok(Sektoren.hexDaten('0305').region === 'imperium' && Sektoren.hexDaten('0306').region === 'saumraum', 'Datenlage: Statio Limitis Imperium, Splittergürtel Saumraum');
  ok(!Sprung.tutorialZielErlaubt(g, '0305') && Sprung.tutorialZielErlaubt(g, '0306') && Sprung.tutorialZielErlaubt(g, '0106'), 'tutorialZielErlaubt: Saumraum und Leerraum ja, Imperium nein');
  // Schlimmster Fall: die Kante tutorial-ende wäre schon offen, die Boje bekannt, der Hex erkundet
  ex.openLink('tutorial-ende'); ex.erkunde('0305'); ex.erkunde('0306'); ex.erkunde('0206'); ex.markBoje('0305-0306');
  ok(ex.kanteOffen('0305-0306') && ex.bojeBekannt('0305-0306'), 'Vorbedingung: Kante Splittergürtel – Statio Limitis offen und bekannt');
  space.enterScene(g, 'splitter', {}); g.space.enemies = [];
  amSprungpunkt(t, '0305');
  ok(g.ship.jump.dest !== statio, 'Automatik: am Sprungpunkt Statio Limitis kein Ziel (dest=' + g.ship.jump.dest + ')');
  ok(/Saumraum/.test(Sprung.selectDest(g, statio) || ''), 'selectDest nach Statio Limitis abgelehnt: „' + Sprung.selectDest(g, statio) + '“');
  ok(/Saumraum/.test(Sprung.hexGrund(g, '0306', '0305') || ''), 'hexGrund nennt den Tutorial-Grund');
  ok(Reise.planen(g, '0306', '0305') === null, 'planen: keine Route nach Statio Limitis');
  ex.erkunde('0304'); ex.openLink('tutorial-ende');
  ok(Reise.planen(g, '0206', '0304') === null, 'planen: keine Route ins Imperium dahinter');
  // Hop-Prüfung: eine (böswillig) gesetzte Route aus dem Saumraum heraus wird im ersten Hop abgebrochen
  g.reisePlan = { ziel: statio, hops: ['0305'] }; g.ship.jump.dest = statio; g.ship.jump.charge = 1; g.ship.jump.ready = true;
  g.reise = { hops: ['0305'], i: 0, t: 99, ziel: statio, abbruch: false };
  Reise.update(g, 0.1);
  ok(g.ship.scene === 'splitter' && !g.reise && !g.reisePlan, 'Hop aus dem Saumraum: Schnellsprung endet, Lerche bleibt im Splittergürtel');
  // Notfallsprung: 60 Seeds, nie außerhalb des Saumraums (Leerraum zählt nicht als Region)
  let draussen = 0, hex = new Set();
  for (let s = 1; s <= 60; s++) {
    const u = setup('m3', s); u.g.explore.openLink('tutorial-ende');
    space.enterScene(u.g, 'splitter', {}); u.g.space.enemies = []; place(u.g, 1200, 700); u.g.ship.reactorCtl.state = 'online';
    if (Sprung.notsprung(u.g) !== null) continue;
    const h = Sektoren.hexVonOrt(u.g.ship.scene); hex.add(h);
    const d = Sektoren.hexDaten(h); if (d && d.region !== 'saumraum') draussen++;
  }
  ok(draussen === 0 && hex.size >= 2, 'Notsprung aus dem Splittergürtel, 60 Seeds: nie außerhalb des Saumraums (Ziele ' + [...hex].join(',') + ')');
  // Nach dem Tutorial (Direktstart-Weltstand "erledigt") fällt die Grenze
  const f = setup('free'); const fg = f.g;
  ok(!Sprung.tutorialLaeuft(fg) && Sprung.tutorialZielErlaubt(fg, '0305'), 'Kampagne ohne Tutorial: Grenze entfällt');
}

// ---------------------------------------------------------------------------------------------------------------------
section('(d) Kette nach dem Tutorial (eisenwald_ohne): Schnellsprung und Kettensperren');
{
  const t = setup('eisenwald_ohne'); const g = t.g; const ex = g.explore;
  ok(g.mission.kette && !Sprung.tutorialLaeuft(g), 'Eisenwald-Kette läuft, Tutorial vorbei');
  // Bestandsaufnahme: Schnellsprung Hafen -> Splittergürtel -> B-7 (Saumraum gilt nach dem Tutorial als erkundet)
  ok(ex.hexErkundet('0306') && ex.hexErkundet('0406'), 'Saumraum der Tutorial-Karte erkundet');
  ok(Reise.planen(g, '0206', '0406') && Reise.planen(g, '0206', '0406').join() === '0306,0406', 'planen funktioniert in der Kette');
  amSprungpunkt(t, '0306');
  const e1 = Sprung.selectDest(g, 'b7');
  ok(e1 === null && g.reisePlan && g.reisePlan.hops.length === 2, 'selectDest legt die Route an (Kette, Kapitel ' + stepId(g) + ')');
  for (let i = 0; i < 30 * 40 && !g.ship.jump.ready; i++) g.step();
  const e2 = Reise.befehl(g);
  ok(e2 === null && !!g.reise, 'befehl startet den Schnellsprung in der Kette' + (e2 ? ' (' + e2 + ')' : ''));
  t.run(9);
  ok(g.ship.scene === 'b7' && !g.reise, 'Schnellsprung kommt in B-7 an');

  // Wolfstor (0604): alle Hexe erkundet und alle Bojen bekannt, aber Sperrriegel nicht offen
  for (const h of Object.keys(Sektoren.KARTE.hexe)) ex.erkunde(h);
  for (const e of Sektoren.KARTE.kanten) if (e.art !== 'far' && e.art !== 'hidden') ex.markBoje(Sektoren.kanteId(e.a, e.b));
  ex.linksOpen.delete('sperrriegel'); ex.offenExtra.delete('0504-0604'); ex.offenExtra.delete('0604-0605'); ex.offenExtra.delete('0604-0705');
  ok(!ex.sperrriegelOffen(), 'Vorbedingung: Sperrriegel zu');
  const wolf = Sektoren.ortVonHex('0604');
  ok(Reise.planen(g, '0504', '0604') === null && Reise.planen(g, '0206', '0604') === null, 'planen: Wolfstor ohne Sperrriegel nicht erreichbar (weder von Vorfeld noch von weit weg)');
  space.enterScene(g, 'vorfeld', {}); g.space.enemies = [];
  const gr = Sprung.hexGrund(g, '0504', '0604');
  ok(!!gr, 'hexGrund Vorfeld -> Wolfstor gesperrt: „' + gr + '“');
  ok(!!Sprung.selectDest(g, wolf) && g.ship.jump.dest !== wolf, 'selectDest Wolfstor abgelehnt, kein Ziel');
  amSprungpunkt(t, '0604');
  ok(g.ship.jump.dest !== wolf, 'Automatik am Sprungpunkt Wolfstor: kein Ziel ohne Sperrriegel');
  // erzwungene Route durch das Tor wird je Hop abgewiesen
  g.reisePlan = { ziel: wolf, hops: ['0604'] }; g.ship.jump.dest = wolf;
  g.reise = { hops: ['0604'], i: 0, t: 99, ziel: wolf, abbruch: false };
  Reise.update(g, 0.1);
  ok(g.ship.scene === 'vorfeld' && !g.reise, 'Hop durch das gesperrte Tor: Schnellsprung endet vor Wolfstor');
  // mit Sperrriegel: erreichbar (der Schlüssel öffnet, nicht die Reise)
  ex.openLink('sperrriegel');
  ok(Reise.planen(g, '0504', '0604') && Reise.planen(g, '0504', '0604').join() === '0604', 'mit Sperrriegel: Route nach Wolfstor möglich');
  ok(Sprung.hexGrund(g, '0504', '0604') === null, 'mit Sperrriegel: hexGrund frei');
  // Missionssperren gelten je Hop
  ex.linksOpen.delete('sperrriegel');
  ex.openLink('sperrriegel');
  const alt = g.mission.jumpBlocked;
  g.mission.jumpBlocked = (d) => (d === 'dunkelriff' ? 'Missionssperre (Test)' : null);
  g.reisePlan = { ziel: 'dunkelriff', hops: ['0505'] }; g.reise = { hops: ['0505'], i: 0, t: 99, ziel: 'dunkelriff', abbruch: false };
  Reise.update(g, 0.1);
  ok(g.ship.scene === 'vorfeld' && !g.reise, 'jumpBlocked sperrt einen Hop des Schnellsprungs');
  g.mission.jumpBlocked = alt;
  const altD = g.mission.destBlocked;
  g.mission.destBlocked = (d) => (d === 'dunkelriff' ? 'Zielsperre (Test)' : null);
  g.reisePlan = { ziel: 'dunkelriff', hops: ['0505'] }; g.reise = { hops: ['0505'], i: 0, t: 99, ziel: 'dunkelriff', abbruch: false };
  Reise.update(g, 0.1);
  ok(g.ship.scene === 'vorfeld' && !g.reise, 'destBlocked sperrt einen Hop des Schnellsprungs (GEG-01 D)');
  ok(Sprung.selectDest(g, 'dunkelriff') === 'Zielsperre (Test)', 'destBlocked sperrt die Zielwahl');
  amSprungpunkt(t, '0505');
  ok(g.ship.jump.dest !== 'dunkelriff', 'destBlocked sperrt die Automatik');
  g.mission.destBlocked = altD;
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
