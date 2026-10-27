'use strict';
// SUND-04a-3 Zusammenführung: Ende-zu-Ende-Bot-Test des Finales mit ECHTEN Modulen (keine Stubs, kein Finale.ersetzen) und echten Kampfausgängen.
//   Angebot -> zweistufige Bestätigung -> Orbit-Schlacht (Kampf-Bot der Sim-Szene) -> Boden (Hinunterbeamen, Wächter erschießen, Schrein halten) -> Abspann.
// Erwartungen aus dem Vertrag der Zusammenführung, nicht aus dem Code:
//   Weg 1 (Niederlage/Abbruch in jeder Phase, je mit Neubeginn): Orbit-Niederlage (Crew passiv, Notfallprotokoll) -> neues Angebot -> Orbit-Sieg -> Boden-Abbruch
//     (Hochbeamen, vor dem Kampf und mitten im Kampf) -> Neubeginn -> Orbit-Sieg -> Boden-Sieg -> Abspann (EIN Spielverlauf).
//   Weg 2 (Orbit-Flucht durch Sprung) -> Neubeginn.
//   Schiff bleibt nach dem Orbit-Sieg am Ort (ship.scene), der Boden baut dort den Landepunkt.
//   Fakt finale_gespielt steht VOR Abspann.beenden('sieg'); der Abspann zeigt den Block „Schrein“.
//   Bestätigung im selben game.time wie die Anfrage (Gleitkomma) geht.
//   node tools/test-finale-ende-zu-ende.js   (npm run test:finale-ende)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Finale = require('../server/sim/finale.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Abspann = require('../server/sim/abspann.js');
const LP = require('../server/sim/landepunkte.js');
const away = require('../server/sim/away.js');
const interior = require('../server/sim/interior.js');
const { OrbitAgent, TRIBUN } = require('./sim-finale-orbit.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const HZ = CONFIG.tickHz;
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'finale-boden.json'), 'utf8'));
const ID = D.landepunkt.id;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-finale-e2e-'));

// ---------- Spielaufbau: Freie Fahrt Sund, Crew der Kampf-Bots (solo: ein Spieler), Rang Tribun
function neu(seed, crew) {
  const dir = path.join(TMP, 'w' + Math.random().toString(36).slice(2)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false, orders: 0, coverShots: 0, keyTries: 0 };
  const opts = { passiv: false };
  const roles = crew === 1 ? ['solo'] : ['helm', 'weapons'];
  const agents = roles.map((r, i) => new OrbitAgent(g, i, r, opts));
  g.simAgents = agents;
  g.lobbyOpts.startMission = 'freie_fahrt';
  for (const a of agents) { g.addConnection(a.conn); a.hello(); }
  for (let i = 0; i < 2 * HZ; i++) g.step();
  g.space.enemies = [];
  g.weltsim.ruf.rom = TRIBUN;
  Kriegslage.tick(g, 'test');
  const radio = [];
  const emit0 = g.emit.bind(g);
  g.emit = (k, d) => { if (k === 'radio') radio.push(d.text); return emit0(k, d); };
  return { g, agents, opts, radio };
}
// Zwischen den Versuchen erholt sich die Crew (Hülle, Schilde); sonst entscheidet der Verschleiß des vorigen Kampfes statt des Finales
const erholen = (g) => {  g.ship.shields.current = g.ship.shields.alloc.slice(); };
const stufe = (g) => { g.ship.helm.stage = Math.max(g.ship.helm.stage, 1); };

// Orbit: die Bots kämpfen, bis die Szene endet. -> Ausgang der Szene
function orbit(t, maxSek) {
  const g = t.g; let snap = g.snapshot(); const t0 = g.time;
  while (g.simSzene && g.time - t0 < maxSek) {
    g.step();
    if (g.wantsSnapshot()) snap = g.snapshot();
    for (const a of t.agents) a.update(snap);
  }
  const L = g.simSzeneLetzte;
  return g.simSzene ? null : (L && L.finale ? L.ausgang : null);
}
function angebotBestaetigen(t) {   // wie die Crew: Angebot steht, Anfrage, Bestätigung (im selben game.time)
  const g = t.g;
  const a = Finale.snapshot(g);
  const f1 = Finale.waehlen(g), f2 = Finale.bestaetigen(g);
  return { angebot: !!(a && a.angebot), fehler: f1 || f2 };
}

// ---------- Boden-Bot: alle auf die Pads, Transfer-Konsole, transfer.down (wie die Crew)
const players = (t) => t.g.players;
const unten = (t) => players(t).filter((p) => p.zone === 'away');
function hinunter(t) {
  const g = t.g;
  g.ship.speed = 0;
  players(t).forEach((p, i) => { interior.placeOnShipPad(g, p, i); p.console = 'transfer'; });
  g.handleMessage(t.agents[0].conn, { t: 'cmd', c: 'transfer.down' });
  for (let i = 0; i < 6 * HZ; i++) { for (const p of players(t)) { p.input.mx = 0; p.input.my = 0; } g.step(); }   // die Bots der Orbit-Szene lassen ihre letzte Laufeingabe stehen: unten steht die Crew still
}
function hinauf(t) {   // freiwilliger Abbruch: alle hochbeamen
  const g = t.g;
  for (const p of unten(t)) { p.console = 'transfer'; }
  g.handleMessage(t.agents[0].conn, { t: 'cmd', c: 'transfer.up' });
  for (let i = 0; i < 6 * HZ; i++) g.step();
}
function botWaechter(t, maxSek) {   // echte away.shoot-Schüsse auf den Wächter, der Bot versetzt sich in 4 Kacheln Abstand
  const g = t.g, aw = g.away, map = interior.awayInfoOf(aw.map).map;
  for (let i = 0; i < HZ * maxSek; i++) {
    const boss = aw.drones.find((d) => d.boss && d.alive);
    if (!boss || !g.finaleBoden || g.finaleBoden.ende) break;
    for (const p of unten(t)) {
      if (p.downed) continue;
      if (Math.hypot(p.x - boss.x, p.y - boss.y) > 200 || i % 60 === 0) {
        for (const [ox, oy] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-3, -3], [3, 3]]) {
          const tx = Math.floor(boss.x / 32) + ox, ty = Math.floor(boss.y / 32) + oy;
          if (!map.solid(tx, ty)) { p.x = tx * 32 + 16; p.y = ty * 32 + 16; break; }
        }
      }
      away.shoot(g, p, Math.atan2(boss.y - p.y, boss.x - p.x));
    }
    g.step();
  }
}
function botSchrein(t, maxSek) {
  const g = t.g, k = LP.karte(g, ID), z = k.anker.find((a) => a.id === g.finaleBoden.ziel);
  const p = unten(t)[0];
  p.x = z.x * 32 + 16; p.y = z.y * 32 + 16;
  interior.onAct(g, p, true);
  for (let i = 0; i < HZ * maxSek && !(g.finaleBoden && g.finaleBoden.ende); i++) { if (!p.hold) interior.onAct(g, p, true); g.step(); }
}
// Die Bots gewinnen den Orbit nicht jedes Mal (gemessen: etwa 3 von 4, siehe sim-finale-orbit). Eine echte Niederlage ist selbst ein Neubeginn und wird mitgeprüft; bis zu 5 Anläufe.
function orbitBisSieg(t, titel) {
  const g = t.g; let ausgang = null;
  for (let k = 1; k <= 5; k++) {
    g.space.enemies = []; g.space.escorts = []; erholen(g); stufe(g);
    const r = angebotBestaetigen(t);
    ok(r.angebot && !r.fehler, titel + ', Anlauf ' + k + ': Angebot bestätigt ' + JSON.stringify(r.fehler));
    ausgang = orbit(t, 900);
    if (ausgang === 'sieg') return ausgang;
    ok(ausgang === 'niederlage', titel + ', Anlauf ' + k + ': Ausgang niederlage statt Sieg (' + ausgang + '), also Neubeginn');
    neuBereit(t, titel + ', Anlauf ' + k);
  }
  return ausgang;
}
function neuBereit(t, titel) {   // nach einem Scheitern: kein Game Over, Phase null, das Angebot steht wieder, die Crew ist am Ort
  const g = t.g;
  for (let i = 0; i < 3 * HZ; i++) g.step();
  const s = Finale.snapshot(g);
  ok(g.phase !== 'end' && Finale.phase(g) === null, titel + ': kein Game Over, Phase null');
  ok(s && s.angebot === 1 && !s.phase, titel + ': das Angebot steht wieder (Neubeginn)');
  ok(!g.simSzene || g.simSzene.phase === 'ende', titel + ': keine laufende Szene');
}

function main() {
  const t = neu(11, 1); const g = t.g;
  ok(Finale.bereit(g).ok && Finale.snapshot(g).angebot === 1, 'Start: Rang Tribun, das Angebot steht');
  const errors0 = g.errors;

  // ===== Versuch 1: Orbit-Niederlage (Crew passiv, echter Kampf, Notfallprotokoll)
  console.log('\nVersuch 1: Orbit-Niederlage');
  stufe(g); t.opts.passiv = true;
  let r = angebotBestaetigen(t);
  ok(r.angebot && !r.fehler, 'Angebot da, Anfrage und Bestätigung im selben game.time gehen: ' + JSON.stringify(r.fehler));
  ok(Finale.phase(g) === 'orbit' && g.simSzene && g.simSzene.modus === 'finale', 'Phase orbit, echte Orbit-Szene (keine Stubs)');
  g.space.escorts = (g.space.escorts || []).filter((q) => q.sim !== g.simSzene.id);   // die römischen Verbündeten fallen vorab weg: sonst gewinnen sie den Kampf allein (die Niederlage soll aus dem Kampf kommen)
  let ausgang = orbit(t, 900);
  ok(ausgang === 'niederlage', 'echter Kampf: Ausgang niederlage (' + ausgang + ')');
  neuBereit(t, 'nach der Orbit-Niederlage');

  // ===== Versuch 2: Orbit-Sieg, Boden-Abbruch vor dem Kampf (Hochbeamen), Neubeginn
  console.log('\nVersuch 2: Orbit-Sieg, Boden-Abbruch');
  t.opts.passiv = false;
  const ort = g.ship.scene;
  ausgang = orbitBisSieg(t, 'Versuch 2');
  ok(ausgang === 'sieg' && Finale.phase(g) === 'boden', 'echter Kampf: Orbit-Sieg, Phase boden (' + ausgang + '/' + Finale.phase(g) + ')');
  ok(g.ship.scene === ort && g.finaleBoden && g.finaleBoden.ort === g.ship.scene, 'das Schiff bleibt am Ort, der Boden baut den Landepunkt dort (' + g.ship.scene + ')');
  ok(g.transferZiel && g.transferZiel.lp === ID && g.transferZiel.scene === g.ship.scene, 'Transferziel = Schrein am Ort des Schiffs');
  hinunter(t);
  ok(unten(t).length === players(t).length && g.away && g.away.map === ID, 'die Crew ist unten auf dem Schrein');
  ok(g.finaleBoden.gelandet && (g.away.drones || []).some((d) => d.alive), 'Wachen sind erschienen (echte Gegner)');
  for (let i = 0; i < 3 * HZ; i++) g.step();
  hinauf(t);
  ok(unten(t).length === 0, 'die Crew ist wieder an Bord');
  neuBereit(t, 'nach dem Boden-Abbruch');
  ok(g.finaleBoden === null || g.finaleBoden === undefined, 'Boden aufgeräumt (kein Landepunkt, kein Transferziel)');
  ok(!g.transferZiel || g.transferZiel.lp !== ID, 'Transferziel zurückgenommen');

  // ===== Versuch 3: Orbit-Sieg, Boden: Wächter erschießen, Schrein halten, Abspann
  console.log('\nVersuch 3: Orbit-Sieg, Boden-Sieg, Abspann');
  ausgang = orbitBisSieg(t, 'Versuch 3');
  ok(ausgang === 'sieg' && Finale.phase(g) === 'boden', 'echter Kampf: Orbit-Sieg (' + ausgang + ')');
  hinunter(t);
  ok(unten(t).length === players(t).length, 'die Crew ist unten');
  // Abspann beobachten: der Fakt muss beim Aufruf schon stehen
  const fakt = () => { const f = g.weltstand && g.weltstand.data && g.weltstand.data.fakten; return f ? f.finale_gespielt === true : false; };
  ok(!fakt(), 'vor dem Sieg: Fakt finale_gespielt nicht gesetzt (auch nicht nach den gescheiterten Versuchen)');
  const aufrufe = []; const beenden0 = Abspann.beenden;
  Abspann.beenden = function (game, art, quelle) { aufrufe.push({ art, quelle, fakt: fakt(), phase: Finale.phase(game) }); return beenden0.apply(this, arguments); };
  try {
    botWaechter(t, 240);
    ok(g.finaleBoden && !g.finaleBoden.ende && g.finaleBoden.frei, 'Wächter gefallen, der Schrein ist frei (echte Schüsse)');
    botSchrein(t, 120);
  } finally { Abspann.beenden = beenden0; }
  ok(Finale.phase(g) === 'ende', 'Finale: Phase ende');
  ok(aufrufe.length >= 1 && aufrufe.every((a) => a.art === 'sieg' && a.fakt === true), 'Abspann.beenden("sieg") sieht den Fakt finale_gespielt schon gesetzt: ' + JSON.stringify(aufrufe));
  ok(g.phase === 'end' && g.abspann && g.abspann.bloecke.some((b) => b.kopf === 'DER SCHREIN') && !g.abspann.bloecke.some((b) => b.kopf === 'OHNE EUCH'), 'Abspann: Block „Schrein“, nicht „kampflos“');
  ok(g.weltstand.data.fakten.szenario_ende === 'sieg' && fakt(), 'Marker szenario_ende = sieg, Fakt finale_gespielt');
  ok(g.errors === errors0, 'keine Fehler im ganzen Verlauf (' + (g.errors - errors0) + ')');
  ok(Finale.bestaetigen(g) && Finale.waehlen(g), 'nach dem Ende gibt es kein neues Finale');
}

function flucht() {
  console.log('\nWeg 2: Orbit-Flucht durch Sprung');
  const t = neu(12, 1); const g = t.g;
  stufe(g);
  const r = angebotBestaetigen(t);
  ok(r.angebot && !r.fehler, 'Angebot bestätigt');
  ok(Finale.phase(g) === 'orbit', 'Phase orbit');
  for (let i = 0; i < 2 * HZ; i++) g.step();
  const S = g.simSzene;
  const Szene = require('../server/sim/kriegslage-szene.js');
  Szene.verlassen(g, 'sprung');   // wie ein Sprung aus dem Orbit
  for (let i = 0; i < 2 * HZ; i++) g.step();
  ok(!g.simSzene || g.simSzene.id !== S.id || g.simSzene.phase === 'ende', 'die Szene ist beendet');
  neuBereit(t, 'nach der Orbit-Flucht');
}

main();
flucht();
console.log(fails ? `\nFEHLER: ${fails} von ${n} Prüfungen` : `\n${n} Prüfungen, FINALE-ENDE-ZU-ENDE OK`);
process.exit(fails ? 1 : 0);
