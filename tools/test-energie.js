'use strict';
// PAN-01 Paket A: Energie und Bordmodule (AP9).
//   Reaktor 8; nur die drei Hauptsysteme und die laufenden Module (je 1) ziehen Energie, Transporter/Lager/Sensoren nicht, Lebenserhaltung nicht mehr.
//   Standardverteilung (Start 2 Module = 2/2/2, voll 4 Module = 1/2/1), Technik schaltet Module ab (technik.module), Kürzung bei Reaktorschaden,
//   Frachtraum ungesichert (Folge: Ladung löst sich bei Hüllentreffern), Werkstatt = zweiter Schrauber, Notrückholung (Krankenstation holt jeden Ausgeschalteten,
//   jede Notrückholung sprengt den Transfer, alte Regel ohne Krankenstation), Weltstand (Bestückung), Snapshot.
//   node tools/test-energie.js            -> alle Abschnitte
//   node tools/test-energie.js kuerzung   -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Physics = require('../shared/physics.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Fracht = require('../server/sim/fracht.js');
const Modul = require('../server/sim/module.js');
const Bots = require('../server/sim/bots.js');
const combat = require('../server/sim/combat.js');
const away = require('../server/sim/away.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-energie-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

// Partie mit `players` Spielern im leeren Testgelände (arena_space) bzw. mit Weltstand (free). Wie test-lager.js.
function setup(start, opts) {
  const o = opts || {};
  const players = o.players || 1;
  const worlds = start !== 'arena_space';
  const g = new Game(Object.assign({ noStore: true, worlds, worldSaveSync: true, worldDir: o.dir, seed: o.seed || 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} }, o.game || {}));
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'E' + i, name: 'Energie' + i, color: i });
    conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: start, ...(o.world ? { world: o.world } : {}) });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  const T = { g, conns, p: g.players[0], run, events, ev: (k) => events.filter((e) => e.kind === k), odas: () => events.filter((e) => e.kind === 'oda').map((e) => e.text) };
  T.cmd = (i, cmd, f) => { conns[i].inbox.length = 0; g.handleMessage(conns[i], Object.assign({ t: 'cmd', c: cmd }, f || {})); return conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.debug = (cmd, args) => { conns[0].inbox.length = 0; g.handleMessage(conns[0], { t: 'debug', cmd, args }); return conns[0].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  return T;
}
function arena(opts) {
  const T = setup('arena_space', opts);
  const sh = T.g.ship; sh.x = T.g.space.w / 2; sh.y = T.g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  T.g.god = true;
  T.run(0.1);
  return T;
}
const technik = (T, i) => { T.g.players[i || 0].console = 'technik'; };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const snapShip = (T) => T.g.snapshot().ship;

section('Konfiguration: Reaktor 8, Hauptsysteme, Module als Daten', () => {
  ok(CONFIG.power.reactor === 8, 'Reaktor 8');
  ok(JSON.stringify(Protocol.POWER_SYSTEMS) === '["engines","shields","weapons"]', 'POWER_SYSTEMS: nur Antrieb, Schilde, Waffen (keine Lebenserhaltung)');
  ok(!('life' in CONFIG.power.default) && JSON.stringify(CONFIG.power.default) === '{"engines":2,"shields":2,"weapons":2}', 'Standardverteilung ohne life, 2/2/2');
  ok(CONFIG.module.max === 4 && CONFIG.module.energie === 1 && CONFIG.module.start.length === 2, 'Module: höchstens 4, je 1 Energie, Start 2');
  ok(Protocol.MODUL_IDS.join() === CONFIG.module.ids.join(), 'MODUL_IDS = CONFIG.module.ids (Client und Server)');
  ok(Protocol.CMD_TECHNIK.includes('technik.module') && Protocol.DEBUG_CMDS.includes('modul'), 'Protokoll: technik.module, Debug modul');
  ok(!CONFIG.shop.some((s) => s.id === 'schildpool' || s.id === 'bot2'), 'Shop: schildpool entfällt, bot2 ist das Modul Werkstatt');
  ok(CONFIG.shop.some((s) => s.id === 'bolzenwerfer') && CONFIG.shop.some((s) => s.id === 'seitenturm'), 'bolzenwerfer und seitenturm bleiben (Paket C/D)');
  ok(CONFIG.o2.drainLifeBroken === 0, 'O2-Verlust durch ausgefallene Lebenserhaltung ruht (AP10)');
  const t = CONFIG.module.standard;
  ok(JSON.stringify(t[6]) === '[2,2,2]' && JSON.stringify(t[4]) === '[1,2,1]', 'Standard: 6 frei = 2/2/2, 4 frei = 1/2/1');
  ok(Object.values(t).every((v) => v.length === 3 && v.every((x) => x >= 1 && x <= CONFIG.power.maxPerSystem)), 'jede Standardverteilung: mindestens 1 je Hauptsystem, höchstens 4');
  const T = arena();
  ok([8, 7, 6, 5, 4].every((f) => sum(Modul.standardVerteilung(T.g, f)) <= f), 'Standardverteilung nie über der freien Energie');
});

section('Start-Lerche: 2 Module, Standardverteilung 2/2/2', () => {
  const T = arena();
  const sh = snapShip(T);
  ok(JSON.stringify(sh.power) === '{"engines":2,"shields":2,"weapons":2}', 'Snapshot power: ' + JSON.stringify(sh.power));
  ok(!('life' in sh.heat) && Object.keys(sh.heat).join() === 'engines,shields,weapons', 'Snapshot heat ohne life');
  ok(JSON.stringify(sh.mod) === '[["f",1,1,1],["k",2,1,1]]', 'Snapshot mod: Frachtraum (Raum 1) + Krankenstation (Raum 2) an und laufend ' + JSON.stringify(sh.mod));
  ok(sh.reactor.output === 8 && sh.reactor.used === 8, 'Reaktor 8, verbraucht 8 (6 Hauptsysteme + 2 Module)');
  ok(T.g.ship.shields.pool === 6 && sh.chargePoints === 4, 'Pool 6 (E×3), 4 Ladepunkte (E+2) wie bisher');
  ok(T.g.bots.length === 1, 'ein Schrauber (Werkstatt nicht eingebaut)');
  ok(Fracht.gesichert(T.g), 'Frachtraum läuft: gesichert');
  ok(JSON.stringify(sh.mod).length < 40, 'ship.mod kompakt (' + JSON.stringify(sh.mod).length + ' B)');
});

section('Voll ausgebaut (Debug): vier Module, Standardverteilung 1/2/1', () => {
  const T = arena();
  ok(T.debug('modul', 'voll').length === 0, 'debug modul voll');
  T.run(0.2);
  const sh = snapShip(T);
  ok(sh.mod.length === 4 && sh.mod.every((m) => m[3] === 1), 'vier Module laufen: ' + JSON.stringify(sh.mod));
  ok(JSON.stringify(sh.power) === '{"engines":1,"shields":2,"weapons":1}' && sh.reactor.used === 8, 'Verteilung 1/2/1, verbraucht 8: ' + JSON.stringify(sh.power));
  ok(T.g.ship.shields.pool === 6 && sh.chargePoints === 3, 'Pool 6, 3 Ladepunkte');
  ok(T.g.bots.length === 2, 'Werkstatt läuft: zweiter Schrauber (' + T.g.bots.length + ')');
  ok(sh.mod.filter((m) => m[0] === 'f').length === 2, 'gleiche Module dürfen mehrfach stehen (zwei Frachträume)');
  T.debug('modul', 'start'); T.run(0.2);
  ok(JSON.stringify(snapShip(T).power) === '{"engines":2,"shields":2,"weapons":2}' && T.g.bots.length === 1, 'debug modul start: zurück auf 2/2/2, ein Schrauber');
  ok(T.debug('modul', 'bau werkstatt').length === 0, 'debug modul bau werkstatt');
  T.run(0.2);
  ok(snapShip(T).mod.length === 3 && JSON.stringify(snapShip(T).power) === '{"engines":2,"shields":2,"weapons":1}' && snapShip(T).reactor.used === 8, 'drei Module: 2/2/1, verbraucht 8');
  ok(T.debug('modul', 'bau frachtraum 3').length === 1 && T.debug('modul', 'bau frachtraum 4').length === 0, 'Modulraum 3 ist von der Werkstatt belegt, Raum 4 frei');
  ok(T.debug('modul', 'bau frachtraum').some((t) => /Kein freier Modulraum/.test(t)), 'alle vier Räume belegt: kein weiterer Einbau');
  ok(T.g.ship.module.length === 4 && T.g.ship.module.map((m) => m.raum).join() === '1,2,3,4', 'höchstens 4 Modulräume, Raumnummern eindeutig');
  T.debug('modul', 'weg werkstatt'); T.run(0.1);
  ok(!Modul.installiert(T.g, 'werkstatt') && T.g.bots.length === 1, 'debug modul weg werkstatt');
});

section('Transporter, Lager, Sensoren: kein Energieposten', () => {
  const T = arena();
  ok(Object.keys(T.g.ship.power).sort().join() === 'engines,shields,weapons', 'ship.power kennt nur die Hauptsysteme');
  ok(Protocol.MODUL_IDS.every((id) => !['transfer', 'sensoren', 'lager'].includes(id)), 'keine Module für Transporter, Lager, Sensoren');
  // Transfer läuft ohne Energie (auch bei Notstrom): beschädigte/ok Zustände hängen nicht an ship.power
  T.g.ship.systems.reactor = 'broken'; T.run(0.2);
  ok(space.powerUsed(T.g) <= 2, 'Reaktor zerstört: Notstrom 2, alles gekürzt (' + space.powerUsed(T.g) + ')');
  ok(T.g.ship.systems.transfer === 'ok' && !away.recall(T.g, 'x').includes('Energie'), 'Transfer hat keinen Energieposten (Zustand unabhängig vom Reaktor)');
  // Lebenserhaltung: kein Energieposten, kein O2-Verlust; Treffer und EMP wählen sie nicht mehr
  T.g.ship.systems.life = 'broken'; T.g.ship.o2 = 100; T.run(5);
  ok(T.g.ship.o2 >= 99.9, 'Lebenserhaltung zerstört: O2 sinkt nicht (AP10 ruht)');
  const interior = require('../server/sim/interior.js');
  ok(interior.INERT_SYSTEMS.join() === 'life', 'Lebenserhaltung ist als wirkungslos markiert (nicht trefferbar)');
  let getroffen = 0;
  for (let i = 0; i < 400; i++) { T.g.ship.systems = interior.makeSystems(); T.g.ship.sysHitAt = {}; for (const r of interior.hitSystems(T.g, i % 4, { chance: 1 })) if (r.system === 'life') getroffen++; }
  ok(getroffen === 0, 'in 400 Treffern wird die Lebenserhaltung nie ausgewählt');
});

section('Technik schaltet Module ab', () => {
  const T = arena({ players: 2 });
  const g = T.g;
  technik(T, 0); g.players[1].console = 'helm';
  ok(T.cmd(1, 'technik.module', { id: 'krankenstation', on: false }).some((t) => /Konsole/.test(t)) && Modul.laeuft(g, 'krankenstation'), 'nur die Technik darf (Navigation abgewiesen)');
  ok(T.cmd(0, 'technik.module', { id: 'quatsch', on: false }).some((t) => /Unbekanntes Modul/.test(t)), 'unbekanntes Modul abgelehnt');
  ok(T.cmd(0, 'technik.module', { id: 'werkstatt', on: false }).some((t) => /nicht eingebaut/.test(t)), 'nicht eingebautes Modul abgelehnt');
  ok(T.cmd(0, 'technik.power', { sys: 'engines', delta: 1 }).some((t) => /Reaktor ausgelastet/.test(t)), 'vorher: Reaktor ausgelastet, Antrieb nicht zu erhöhen');
  ok(T.cmd(0, 'technik.module', { id: 'krankenstation', on: false }).length === 0, 'technik.module krankenstation aus');
  T.run(0.1);
  let sh = snapShip(T);
  ok(JSON.stringify(sh.mod) === '[["f",1,1,1],["k",2,0,0]]' && sh.reactor.used === 7, 'Snapshot: Krankenstation aus (an 0, läuft 0), verbraucht 7: ' + JSON.stringify(sh.mod));
  ok(!Modul.laeuft(g, 'krankenstation') && T.cmd(0, 'technik.module', { id: 'krankenstation', on: false }).some((t) => /schon aus/.test(t)), 'doppelt aus: Hinweis');
  ok(T.cmd(0, 'technik.power', { sys: 'engines', delta: 1 }).length === 0, 'freie Energie: Antrieb 3');
  T.run(0.1);
  ok(g.ship.power.engines === 3 && snapShip(T).reactor.used === 8, 'Antrieb 3, Reaktor wieder voll');
  ok(T.cmd(0, 'technik.module', { id: 'krankenstation', on: true }).some((t) => /Reaktor ausgelastet/.test(t)) && !Modul.laeuft(g, 'krankenstation'), 'Einschalten ohne freie Energie abgelehnt (kein stilles Wegnehmen)');
  ok(T.cmd(0, 'technik.power', { sys: 'engines', delta: -1 }).length === 0 && T.cmd(0, 'technik.module', { id: 'krankenstation', on: true }).length === 0, 'Energie freigegeben, dann Einschalten geht');
  T.run(0.1);
  ok(Modul.laeuft(g, 'krankenstation') && snapShip(T).reactor.used === 8, 'Krankenstation läuft wieder');
  // abgeschaltet bleibt abgeschaltet (kein Wiederanlauf von selbst)
  T.cmd(0, 'technik.module', { id: 'frachtraum', on: false }); T.run(5);
  ok(!Modul.laeuft(g, 'frachtraum') && g.ship.module.find((m) => m.id === 'frachtraum').an === false, 'abgeschaltetes Modul bleibt aus');
  // Bot-Rolle ändert nichts: Hauptsysteme + Module zusammen nie über dem Reaktor
  for (let i = 0; i < 12; i++) T.cmd(0, 'technik.power', { sys: ['engines', 'shields', 'weapons'][i % 3], delta: 1 });
  T.run(0.2);
  ok(space.powerUsed(g) <= 8, 'Verbrauch nie über Reaktor 8 (' + space.powerUsed(g) + ')');
  const tab = T.cmd(0, 'technik.module', { id: 'frachtraum', on: true });
  ok(tab.length === 1 && /ausgelastet/.test(tab[0]), 'bei voller Verteilung kein Einschalten');
});

section('Kürzung bei Reaktorschaden (enforcePower)', () => {
  const T = arena();
  const g = T.g;
  // Reaktor beschädigt: 6. Bedarf 8 -> Hauptsysteme zuerst (Waffen, Antrieb), Module laufen weiter
  g.ship.systems.reactor = 'damaged'; T.run(0.1);
  ok(JSON.stringify(g.ship.power) === '{"engines":1,"shields":2,"weapons":1}' && Modul.anzahlLaufend(g) === 2 && space.powerUsed(g) === 6, 'Reaktor beschädigt (6): Hauptsysteme 1/2/1, beide Module laufen: ' + JSON.stringify(g.ship.power));
  g.ship.systems.reactor = 'ok'; T.run(0.1);
  ok(JSON.stringify(g.ship.power) === '{"engines":2,"shields":2,"weapons":2}', 'Reaktor repariert: eingestellte Verteilung kehrt zurück');
  // vier Module: Reaktor 6, Hauptsysteme schon am Minimum -> Werkstatt zuerst, dann Frachtraum, Krankenstation zuletzt
  T.debug('modul', 'voll'); T.run(0.1);
  g.ship.systems.reactor = 'damaged'; T.run(0.1);
  const lauf = (id, raum) => g.ship.module.find((m) => m.id === id && (raum == null || m.raum === raum)).lauf;
  ok(JSON.stringify(g.ship.power) === '{"engines":1,"shields":1,"weapons":1}' && space.powerUsed(g) === 6 && !lauf('werkstatt') && lauf('krankenstation') && lauf('frachtraum', 1) && lauf('frachtraum', 4),
    'voll + Reaktor 6: Hauptsysteme auf 1 gekürzt, dann fällt die Werkstatt aus: ' + JSON.stringify(g.ship.power));
  ok(g.bots.length === 1 && g.ship.module.every((m) => m.an), 'Werkstatt aus: ein Schrauber; Wunsch (an) bleibt');
  g.ship.systems.reactor = 'broken'; T.run(0.1);
  ok(space.powerUsed(g) <= 2 && !lauf('krankenstation') && !lauf('frachtraum', 1) && g.ship.power.shields >= 1 && g.ship.power.engines >= 1, 'Reaktor zerstört (Notstrom 2): alle Module aus, Schilde und Antrieb behalten 1, Waffen 0: ' + JSON.stringify(g.ship.power));
  ok(!Fracht.gesichert(g), 'ohne Strom ist der Frachtraum ungesichert');
  g.ship.systems.reactor = 'ok'; require('../server/sim/space.js').reactorOnline(g, 'Test'); T.run(0.2);
  ok(Modul.anzahlLaufend(g) === 4 && Fracht.gesichert(g) && JSON.stringify(g.ship.power) === '{"engines":1,"shields":2,"weapons":1}' && g.bots.length === 2, 'Reaktor wieder 8: alles läuft wie eingestellt');
  // Überladen (12) gibt Luft: technik.power darf erhöhen
  technik(T, 0);
  T.cmd(0, 'technik.overload'); T.run(0.1);
  ok(g.ship.reactor.output === 12 && T.cmd(0, 'technik.power', { sys: 'weapons', delta: 1 }).length === 0, 'Überladen (12): Energie lässt sich erhöhen');
  // Reaktor offline (Notstrom 2, EK2): gleiche Kürzung
  g.ship.reactorCtl.state = 'offline'; T.run(0.1);
  ok(space.powerUsed(g) <= 2, 'Reaktor offline (Notstrom 2): Verbrauch ' + space.powerUsed(g));
});

section('Kürzung: Wunsch der Technik bleibt (N1), Modulräume (N3), EMP', () => {
  const T = arena();
  const g = T.g;
  technik(T);
  // Reaktor beschädigt (6): Verteilung 2/2/2 wird auf 1/2/1 gekürzt; die Technik nimmt einen Schildpunkt weg
  g.ship.systems.reactor = 'damaged'; T.run(0.1);
  ok(JSON.stringify(g.ship.power) === '{"engines":1,"shields":2,"weapons":1}', 'gekürzt auf 1/2/1');
  ok(T.cmd(0, 'technik.power', { sys: 'shields', delta: -1 }).length === 0, 'Technik: Schilde −1 während der Kürzung');
  ok(g.ship.powerIntent.engines === 2 && g.ship.powerIntent.weapons === 2 && g.ship.powerIntent.shields === 1, 'Wunsch der anderen Systeme bleibt (2/1/2): ' + JSON.stringify(g.ship.powerIntent));
  g.ship.systems.reactor = 'ok'; T.run(0.1);
  ok(g.ship.power.engines === 2 && g.ship.power.weapons === 2 && g.ship.power.shields === 1, 'nach der Reparatur: 2/1/2 statt der gekürzten Werte: ' + JSON.stringify(g.ship.power));
  // N3: Modulraum nur als ganze Zahl 1–4
  const R = (raum) => { Modul.restore(g, [{ id: 'frachtraum', raum }, { id: 'krankenstation', raum: 2 }]); return g.ship.module.length; };
  ok(R('1') === 1 && R(1.5) === 1 && R(0) === 1 && R(5) === 1 && R(3) === 2, 'restore: Strings, Brüche, 0 und 5 werden abgelehnt, 3 gilt');
  // N4: EMP im Altpfad wählt die Lebenserhaltung nie
  const interior = require('../server/sim/interior.js');
  ok(typeof space.shipHit === 'function' && interior.INERT_SYSTEMS.includes('life'), 'Lebenserhaltung bleibt vom EMP ausgenommen');
});

section('Frachtraum ungesichert: sichtbare Folge', () => {
  const T = arena();
  const g = T.g;
  technik(T);
  Fracht.anBordLegen(g, 'sprengstoff'); Fracht.anBordLegen(g, 'fracht');
  T.run(0.1);
  ok(Fracht.gesichert(g) && snapShip(T) && T.g.snapshot().fracht.lager.length === 2 && T.g.snapshot().fracht.g === undefined, 'Frachtraum läuft: gesichert, kein Feld g');
  T.cmd(0, 'technik.module', { id: 'frachtraum', on: false }); T.run(0.1);
  ok(!Fracht.gesichert(g) && g.snapshot().fracht.g === false, 'Modul aus: Fracht.gesichert = false, Snapshot fracht.g = false (Taktik: UNGESICHERT)');
  ok(T.ev('frachtGesichert').some((e) => e.an === false) && T.odas().some((t) => /ungesichert/i.test(t)), 'Ereignis frachtGesichert und ODA-Meldung');
  const FL = require('../shared/frachtliste.js').frachtListe(g.snapshot().fracht, 2);
  ok(FL.gesichert === false && /UNGESICHERT/.test(FL.text), 'Frachtliste der Taktik zeigt UNGESICHERT: ' + FL.text);
  // Wirkung: Hüllentreffer löst Ladung (die älteste Ware), sie treibt hinter dem Schiff und lässt sich neu beamen
  g.ship.shields.current = [0, 0, 0, 0]; g.ship.shields.allocIntent = [0, 0, 0, 0];
  space.shipHit(g, 0, 1, {});
  ok(Fracht.anBord(g) === 1 && Fracht.draussen(g).length === 1 && Fracht.draussen(g)[0].art === 'sprengstoff', 'Hüllentreffer: genau eine Ladung (Sprengstoff, die älteste) löst sich und treibt');
  ok(T.ev('frachtVerloren').length === 1 && T.odas().some((t) => /gelöst/.test(t)), 'Ereignis frachtVerloren, ODA „hat sich gelöst“');
  const pod = Fracht.draussen(g)[0];
  ok(pod.x < g.ship.x && Math.abs(pod.y - g.ship.y) < 1, 'die Ladung treibt hinter dem Schiff (Heck)');
  // Schildtreffer verliert nichts
  g.ship.shields.current = [4, 4, 4, 4];
  space.shipHit(g, 0, 1, {});
  ok(Fracht.anBord(g) === 1, 'Schildtreffer (kein Hüllenschaden): nichts löst sich');
  // gesichert: nie Verlust
  T.cmd(0, 'technik.module', { id: 'frachtraum', on: true }); T.run(0.1);
  ok(Fracht.gesichert(g) && g.snapshot().fracht.g === undefined, 'Modul an: wieder gesichert');
  g.ship.shields.current = [0, 0, 0, 0];
  space.shipHit(g, 0, 1, {});
  ok(Fracht.anBord(g) === 1, 'gesichert: Hüllentreffer verliert nichts');
  // Schnittstelle für Personen (AP14): gefaehrdet liefert alles an Bord, wenn ungesichert
  Fracht.setGesichert(g, false);
  ok(Fracht.gefaehrdet(g).length === 1 && Fracht.gefaehrdet(g)[0].art === 'fracht', 'Fracht.gefaehrdet: Liste der Ladung im ungesicherten Lager (Personen hängen sich in AP14 hier an)');
  Fracht.setGesichert(g, true);
  // Personen werden vom Hüllentreffer nicht angetastet (nur Ware)
  Fracht.state(g).lager = [{ art: 'person', p: 'evert', n: 'Evert' }];
  Fracht.setGesichert(g, false);
  ok(Fracht.huellenTreffer(g) === 0 && Fracht.anBord(g) === 1, 'Personen bleiben an Bord (nur Ware löst sich)');
  // zwei Frachträume: erst wenn beide laufen, gilt „gesichert“
  T.debug('modul', 'voll'); T.run(0.1);
  T.cmd(0, 'technik.module', { id: 'frachtraum', on: false, raum: 4 }); T.run(0.1);
  ok(Modul.laeuft(g, 'frachtraum') && !Fracht.gesichert(g), 'zwei Frachträume, einer aus: ungesichert');
  T.cmd(0, 'technik.module', { id: 'frachtraum', on: true, raum: 4 }); T.run(0.1);
  ok(Fracht.gesichert(g), 'beide laufen: gesichert');
  // N2: gelöste Ware bleibt beim Sektorwechsel für die Rückkehr liegen (Kampagnen-Fracht kann nicht verloren gehen)
  const S = arena();
  Fracht.anBordLegen(S.g, 'sprengstoff'); Fracht.setGesichert(S.g, false); S.g.ship.shields.current = [0, 0, 0, 0];
  S.g.ship.module.forEach((m) => { m.an = false; });
  space.shipHit(S.g, 0, 1, {});
  const hier = S.g.ship.scene;
  ok(Fracht.draussen(S.g).length === 1 && S.g.fracht.draussen[0].eigene, 'gelöste Ware liegt im Sektor');
  S.g.ship.scene = 'andernorts'; S.run(0.1);
  ok(S.g.fracht.draussen.length === 1, 'nach dem Sektorwechsel nicht gelöscht');
  S.g.ship.scene = hier; S.run(0.1);
  ok(Fracht.draussen(S.g).length === 1, 'zurück im Sektor: wieder beamfähig');
  // Docked: nichts treibt, die Ware ist weg
  const D = arena();
  Fracht.anBordLegen(D.g, 'fracht'); D.g.ship.docked = true; D.g.ship.shields.current = [0, 0, 0, 0];
  Fracht.setGesichert(D.g, false); D.g.ship.module.forEach((m) => { m.an = false; });
  ok(Fracht.huellenTreffer(D.g) === 1 && Fracht.anBord(D.g) === 0 && Fracht.draussen(D.g).length === 0, 'angedockt: die Ladung ist weg, es treibt nichts');
});

section('Frachtraum ohne Strom durch Reaktorschaden: ungesichert, aber nichts geht verloren', () => {
  const T = arena();
  const g = T.g;
  Fracht.anBordLegen(g, 'sprengstoff');
  g.ship.systems.reactor = 'broken'; T.run(0.2);
  ok(!Fracht.gesichert(g) && g.snapshot().fracht.g === false, 'Notstrom: Frachtraum ungesichert (Anzeige)');
  g.ship.shields.current = [0, 0, 0, 0];
  space.shipHit(g, 0, 1, {});
  ok(Fracht.anBord(g) === 1 && Fracht.draussen(g).length === 0, 'Hüllentreffer im Notstrom: Ladung bleibt (Kampagnen-Fracht, Kette k2)');
});

section('Werkstatt: zweiter Schrauber als Modul', () => {
  const T = arena();
  const g = T.g;
  technik(T);
  ok(g.bots.length === 1 && Bots.botAnzahl(g) === 1, 'Start: ein Schrauber');
  ok(Modul.bestuecken(g, 'werkstatt') === null, 'Werkstatt einbauen (Debug)');
  Modul.verteilungSetzen(g); T.run(0.1);
  ok(g.bots.length === 2 && Bots.botAnzahl(g) === 2, 'Werkstatt läuft: zwei Schrauber');
  g.bots[1].carry = 'ersatzteil'; const vorrat = g.inventory.ersatzteil;
  T.cmd(0, 'technik.module', { id: 'werkstatt', on: false }); T.run(0.1);
  ok(g.bots.length === 1 && g.inventory.ersatzteil === vorrat + 1, 'Werkstatt aus: der zweite Schrauber geht, sein Teil kommt zurück ins Regal');
  ok(T.cmd(0, 'technik.power', { sys: 'weapons', delta: 1 }).length === 0, 'freie Energie auf die Waffen');
  ok(T.cmd(0, 'technik.module', { id: 'werkstatt', on: true }).some((t) => /Reaktor ausgelastet/.test(t)) && (T.run(0.1), g.bots.length === 1), 'Einschalten bei voller Verteilung abgelehnt: weiter ein Schrauber');
  T.cmd(0, 'technik.power', { sys: 'weapons', delta: -1 });
  ok(T.cmd(0, 'technik.module', { id: 'werkstatt', on: true }).length === 0 && (T.run(0.1), g.bots.length === 2), 'Energie frei: Werkstatt an, zwei Schrauber');
  ok(!('bot2' in g.upgrades) && !('schildpool' in g.upgrades), 'upgrades kennt bot2/schildpool nicht mehr');
});

// ---------- Notrückholung (Kesh, Kampf v2) ----------
function kesh(players, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  g.handleMessage(conns[0], { t: 'debug', cmd: 'kesh' });
  g.aways.kesh.drones = [];
  const P = (i) => g.players[i];
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const events = (kind) => conns[0].inbox.filter((m) => m.kind === kind);
  const odas = () => conns[0].inbox.filter((m) => m.kind === 'oda').map((m) => m.text);
  const place = (i, tx, ty) => { const c = Physics.tileCenter(tx, ty); P(i).x = c.x; P(i).y = c.y; };
  return { g, conns, P, run, events, odas, place };
}
const AC = CONFIG.awayCombat;
const HOL = CONFIG.module.krankenstation.holNach;

section('Notrückholung mit Krankenstation: jeder Ausgeschaltete wird geholt', () => {
  const { g, P, run, events, odas } = kesh(3);
  ok(Modul.laeuft(g, 'krankenstation') && P(0).zone === 'away' && P(1).zone === 'away' && P(2).zone === 'away', 'Start: Krankenstation läuft, alle drei unten');
  ok(HOL < AC.wounded.bleedout, `holNach (${HOL} s) ist kürzer als das Ausbluten (${AC.wounded.bleedout} s)`);
  combat.woundPlayer(g, P(0), 'test');
  run(HOL - 0.5);
  ok(P(0).zone === 'away' && P(0).downed, `vor ${HOL} s noch unten (Kameraden können aufhelfen)`);
  ok(g.ship.systems.transfer === 'ok', 'der Transfer ist noch heil');
  run(1);
  ok(P(0).zone === 'ship' && !P(0).downed && P(0).shield.seg === AC.shield.segments, `nach ${HOL} s: von der Krankenstation an Bord geholt, Schild voll`);
  ok(g.ship.systems.transfer === 'broken', 'die Notrückholung hat den Transfer gesprengt (zerstört, Reparatur nötig)');
  ok(odas().some((t) => /Krankenstation: Notrückholung für K0/.test(t)) && events('beam').some((e) => e.dir === 'up' && e.pids.includes(P(0).id)), 'ODA „Krankenstation: Notrückholung“, Beam-Ereignis');
  ok(g.phase === 'play', 'kein Game Over');
  // M2: auch der zweite Ausgeschaltete wird geholt, obwohl der Transfer schon zerstört ist (er bleibt zerstört)
  combat.woundPlayer(g, P(1), 'test');
  run(HOL + 0.5);
  ok(P(1).zone === 'ship' && !P(1).downed && g.ship.systems.transfer === 'broken', 'Transfer schon zerstört: die Krankenstation holt trotzdem jeden Ausgeschalteten');
  // Reparatur über den echten Weg (Reparaturliste der Schrauber, Flicken), dann holt sie wieder und sprengt wieder
  ok(Bots.queueRepair(g, 'transfer', 'flick') === null, 'Technik setzt einen Schrauber auf den Transfer');
  run(25);
  ok(g.ship.systems.transfer === 'ok', 'Schrauber haben den Transfer geflickt: ' + g.ship.systems.transfer);
  combat.woundPlayer(g, P(2), 'test');
  run(HOL + 0.5);
  ok(P(2).zone === 'ship' && g.ship.systems.transfer === 'broken', 'nach der Reparatur holt die Krankenstation wieder, und sprengt wieder');
  // M1: die Holzeit beginnt mit jedem Ausfall neu (9 s verwundet, aufgeholfen, später erneut verwundet: volle 10 s)
  const K = kesh(3);
  combat.woundPlayer(K.g, K.P(0), 'test'); K.run(HOL - 1);
  combat.revive(K.g, K.P(0), null, { quiet: true });
  K.run(30);
  combat.woundPlayer(K.g, K.P(0), 'test'); K.run(HOL - 1.5);
  ok(K.P(0).zone === 'away' && K.P(0).downed, 'M1: erneut verwundet nach 30 s: nach ' + (HOL - 1.5) + ' s noch unten (Holzeit startet neu)');
  K.run(2);
  ok(K.P(0).zone === 'ship', 'M1: nach vollen ' + HOL + ' s geholt');
});

section('Notrückholung mit Krankenstation: kein Wellenmodus', () => {
  const { g, P, run } = kesh(3);
  combat.woundPlayer(g, P(0), 'test');
  g.arena = { wellen: {} };   // Wellenmodus Boden: keine Notrückholung (alle unten = Ende der Runde)
  run(HOL + 2);
  ok(P(0).zone === 'away' && P(0).downed && g.ship.systems.transfer === 'ok', 'im Wellenmodus holt die Krankenstation niemanden');
  g.arena = null;
  run(HOL + 0.5);
  ok(P(0).zone === 'ship' && !P(0).downed, `ohne Wellenmodus holt sie ihn nach ${HOL} s`);
});

section('Notrückholung mit Krankenstation: Bewusstlose, Gefesselte', () => {
  const { g, P, run } = kesh(3);   // der dritte steht, sonst holt die Rückholung aller (alle Ausgeschalteten) das Team
  ok(g.ship.module.some((m) => m.id === 'krankenstation' && m.lauf), 'Krankenstation läuft');
  // bewusstlos (Betäuber ohne Schild)
  P(0).shield.seg = 0;
  const r = combat.hitPlayer(g, P(0), 1, 'betaeuber', { nichttoedlich: true, waffe: 'betaeuber' });
  ok(r === 'bewusstlos' && P(0).downed && P(0).zustand === 'bewusstlos', 'Spieler bewusstlos (' + r + ')');
  run(HOL - 0.5);
  ok(P(0).zone === 'away' && P(0).downed, 'noch unten');
  run(1);
  ok(P(0).zone === 'ship' && !P(0).downed && P(0).zustand === 'ok', 'auch der Bewusstlose wird geholt (alte Regel: nur Wachwerden oder Rückholung aller)');
  ok(g.ship.systems.transfer === 'broken', 'Transfer gesprengt');
  // gefesselt/gefangen: bleiben bei den Gegnern
  g.ship.systems.transfer = 'ok';
  P(1).shield.seg = 0;
  combat.hitPlayer(g, P(1), 1, 'betaeuber', { nichttoedlich: true, waffe: 'betaeuber' });
  P(1).zustand = 'gefesselt';
  run(HOL + 2);
  ok(P(1).zone === 'away' && P(1).downed && g.ship.systems.transfer === 'ok', 'Gefesselte holt die Krankenstation nicht (Gegner halten sie)');
});

section('Notrückholung ohne Krankenstation: alte Regel', () => {
  const { g, P, run, events } = kesh(3);
  Modul.schalten(g, 'krankenstation', false, null, 0, 8);   // aus (Technik)
  run(0.2);
  ok(!Modul.laeuft(g, 'krankenstation'), 'Krankenstation aus');
  combat.woundPlayer(g, P(0), 'test');
  run(HOL + 2);
  ok(P(0).zone === 'away' && P(0).downed && g.ship.systems.transfer === 'ok', `nach ${HOL + 2} s: niemand holt ihn (Krankenstation aus)`);
  run(AC.wounded.bleedout - HOL - 2 + 0.5);
  ok(P(0).zone === 'ship' && !P(0).downed, `alte Regel: nach dem Ausbluten (${AC.wounded.bleedout} s) Einzel-Notrückholung`);
  ok(g.ship.systems.transfer === 'broken', 'auch die alte Notrückholung sprengt den Transfer');
  // Bewusstloser ohne Krankenstation: bleibt, bis er aufwacht
  g.ship.systems.transfer = 'ok';
  P(1).shield.seg = 0;
  combat.hitPlayer(g, P(1), 1, 'betaeuber', { nichttoedlich: true, waffe: 'betaeuber' });
  run(HOL + 2);
  ok(P(1).zone === 'away' && P(1).downed && P(1).zustand === 'bewusstlos', 'Bewusstloser ohne Krankenstation bleibt liegen');
  run(AC.koerper ? CONFIG.awayCombat.koerper.bewusstlos : 30);
  ok(P(1).zone === 'away' && !P(1).downed, 'wacht von selbst auf (alte Regel)');
  // alle verwundet: Rückholung aller wie bisher
  const E = kesh(2);
  Modul.schalten(E.g, 'krankenstation', false, null, 0, 8); E.run(0.2);
  combat.woundPlayer(E.g, E.P(0), 'test'); combat.woundPlayer(E.g, E.P(1), 'test');
  E.run(AC.wounded.squadRecallDelay + 0.5);
  ok(E.P(0).zone === 'ship' && E.P(1).zone === 'ship' && E.events('squadRecall').length === 1 && E.g.ship.systems.transfer === 'broken', 'alle verwundet: Rückholung aller (squadRecall) sprengt den Transfer');
  // läuft auch bei kaputtem Transfer (Notstrom): letzter Ausweg, kein Game Over
  const F = kesh(2);
  F.g.ship.systems.transfer = 'broken';
  combat.woundPlayer(F.g, F.P(0), 'test'); combat.woundPlayer(F.g, F.P(1), 'test');
  F.run(AC.wounded.squadRecallDelay + 0.5);
  ok(F.P(0).zone === 'ship' && F.P(1).zone === 'ship' && F.g.phase === 'play', 'Rückholung aller funktioniert auch mit kaputtem Transfer (letzter Ausweg)');
});

section('Notrückholung im Notstrom und per Captain-Befehl', () => {
  const { g, P, run } = kesh(2);
  g.ship.systems.reactor = 'broken'; run(0.3);
  ok(space.powerUsed(g) <= 2 && !Modul.laeuft(g, 'krankenstation') && !Modul.laeuft(g, 'frachtraum'), 'Notstrom: Module aus (Reaktor zerstört)');
  ok(away.recall(g, P(0).id) === null, 'transfer.recall im Notstrom: geht (der Transfer braucht keine Energie)');
  ok(P(0).zone === 'ship' && g.ship.systems.transfer === 'broken', 'Spieler an Bord, Transfer gesprengt');
  ok(/Transfer ausgefallen/.test(away.recall(g, P(1).id) || ''), 'zweite Notrückholung: erst reparieren');
  g.ship.systems.transfer = 'damaged';
  g.support.recall = 0;   // Abklingzeit der Notrückholung (support.recall) abgelaufen
  ok(away.recall(g, P(1).id) === null && P(1).zone === 'ship', 'beschädigter Transfer (nicht zerstört): Rückholung möglich');
  // Rückholung eines Wunden per Captain
  const K = kesh(2);
  combat.woundPlayer(K.g, K.P(1), 'test');
  ok(away.recall(K.g, K.P(1).id) === null && K.P(1).zone === 'ship' && !K.P(1).downed && K.g.ship.systems.transfer === 'broken', 'Captain holt einen Verwundeten: an Bord geheilt, Transfer gesprengt');
});

section('Weltstand: Bestückung', () => {
  const dir = freshDir();
  const T = setup('free', { dir });
  T.run(0.3);
  const g = T.g;
  T.debug('modul', 'voll'); T.run(0.2);
  technik(T); T.cmd(0, 'technik.module', { id: 'krankenstation', on: false }); T.run(0.2);
  const id = g.weltstand.id;
  T.conns[0].inbox.length = 0;
  g.handleMessage(T.conns[0], { t: 'menu', op: 'end' });
  const file = path.join(dir, id + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(JSON.stringify(data.schiff.module) === '[{"id":"frachtraum","raum":1,"an":true},{"id":"krankenstation","raum":2,"an":false},{"id":"werkstatt","raum":3,"an":true},{"id":"frachtraum","raum":4,"an":true}]', 'Stand: schiff.module = Bestückung mit an/aus ' + JSON.stringify(data.schiff.module));
  ok(Weltstand.validate(data).length === 0, 'Stand ist schema-gültig ' + (Weltstand.validate(data)[0] || ''));
  ok(!JSON.stringify(data.schiff).includes('"power"') && !('verteilung' in data.schiff), 'die Energieverteilung wird nicht gespeichert');
  ok(!(data.schiff.ausbauten || []).includes('schildpool') && !(data.schiff.ausbauten || []).includes('bot2'), 'ausbauten ohne schildpool/bot2');
  const L = setup('free', { dir, world: id });
  L.run(0.3);
  ok(JSON.stringify(Modul.toSave(L.g)) === JSON.stringify(data.schiff.module), 'nach dem Laden: dieselbe Bestückung');
  ok(JSON.stringify(L.g.ship.power) === '{"engines":2,"shields":2,"weapons":2}' || L.g.ship.power.engines + L.g.ship.power.shields + L.g.ship.power.weapons === 5, 'Verteilung: Standard für 3 laufende Module (' + JSON.stringify(L.g.ship.power) + ')');
  ok(!Modul.laeuft(L.g, 'krankenstation') && Modul.laeuft(L.g, 'werkstatt') && L.g.bots.length === 2, 'Krankenstation bleibt aus, Werkstatt läuft (2 Schrauber)');
  // Altstand ohne Feld: Start-Bestückung; bot2 im Altstand -> Werkstatt; schildpool wird ignoriert (keine Abwärtsmigration)
  const alt = JSON.parse(JSON.stringify(data));
  delete alt.schiff.module; alt.schiff.ausbauten = ['schildpool', 'bot2', 'seitenturm'];
  fs.writeFileSync(file, JSON.stringify(alt, null, 1));
  const A = setup('free', { dir, world: id });
  A.run(0.3);
  ok(A.g.ship.module.map((m) => m.id).join() === 'frachtraum,krankenstation,werkstatt' && !('schildpool' in A.g.upgrades) && A.g.upgrades.seitenturm === true, 'Altstand: Start-Bestückung + Werkstatt (aus bot2), schildpool ignoriert');
  const bad = JSON.parse(JSON.stringify(data)); bad.schiff.module[0].id = 'traktorstrahl';
  ok(Weltstand.validate(bad).length > 0, 'Schema lehnt unbekanntes Modul ab');
  const bad2 = JSON.parse(JSON.stringify(data)); bad2.schiff.module[0].raum = 5;
  ok(Weltstand.validate(bad2).length > 0, 'Schema lehnt Modulraum 5 ab');
});

section('Debug sl energie: Waffen 0 und alle Module aus (4 Punkte frei)', () => {
  const T = arena();
  ok(T.debug('sl', 'energie').length === 0, 'debug sl energie');
  T.run(0.2);
  const Boje = require('../server/sim/boje.js');
  ok(Boje.freieEnergie(T.g) >= 4 && Modul.anzahlLaufend(T.g) === 0, 'freie Energie ' + Boje.freieEnergie(T.g) + ', Module laufen: ' + Modul.anzahlLaufend(T.g));
});

section('Snapshot: Budget', () => {
  const T = arena();
  T.debug('modul', 'voll'); T.run(0.2);
  const s = JSON.stringify(T.g.snapshot());
  const a = JSON.stringify(T.g.snapshot().ship.mod).length;
  ok(a <= 80, 'ship.mod mit vier Modulen: ' + a + ' B');
  ok(s.length < CONFIG.net.snapMax - CONFIG.net.snapLuft, 'Snapshot im Budget (' + s.length + ' B)');
});

console.log('\n' + (n - fails) + '/' + n + ' Energie-Tests bestanden.' + (fails ? '\n' + fails + ' FEHLER.' : ''));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignorieren */ }
process.exit(fails ? 1 : 0);
