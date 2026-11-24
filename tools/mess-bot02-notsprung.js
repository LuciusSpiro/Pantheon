'use strict';
// BOT-02 B5: Messskript Notsprung des Navigations-Bots (Bericht BOT-01 8.3 Nr. 4): reaktorNotsprung (kern.js) loest unter 8 s Reaktor-Countdown helm.notsprung aus. Das Skript MISST und
// protokolliert (Tick fuer Tick am Spielzustand), es aendert kein Verhalten. Echtes Game (Freie Fahrt, Server-Bots), Countdown des zweiten Ausfalls (10 s: keine Reparatur rettet ihn).
//   (a) Navigation (+Technik) am Steuer, niemand unten
//   (b) ein Mensch unten (zone away): b1 Navigation+Technik (Technik haelt den Bord-Dienst), b2 nur Navigation (sie ist der Bord-Bot und steht an der Transfer-Konsole), b3 Navigation+Ops+Technik
//   (b2t, b2x) wie b2, aber der Bord-Bot steht beim Countdown schon an der Transfer-Konsole (b2t: erster Ausfall, 20 s; b2x: zweiter Ausfall, 10 s: der Weg zur Steuer dauert rund 10 s, die Lerche ist verloren)
//   (c) Vergleich ohne Navigations-Bot: Ops+Technik, ohne und mit Mensch unten
//   node tools/mess-bot02-notsprung.js        (Exit 0, wenn jeder Fall seine erwartete Antwort liefert; die Bewertung steht im Rueckbericht, nicht im Exit)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const interior = require('../server/sim/interior.js');
const Sprung = require('../server/sim/sprung.js');
const FadenFracht = require('../server/sim/faden-fracht.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const { STOP } = require('../server/bots/kern.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botnots-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0, n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
const KONSOLE = { navigation: 'helm', ops: 'weapons', technik: 'technik' };

function partie(bots, seed) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.botZufall = (() => { let a = 42; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const spy = []; const echt = g.handleMessage.bind(g);
  g.handleMessage = (conn, msg) => { if (conn && conn.bot) spy.push({ pid: conn.player ? conn.player.id : null, rolle: conn.player ? conn.player.rolle : null, msg, t: g.time }); return echt(conn, msg); };
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  for (const r of bots) BotSpieler.botHinzufuegen(g, null, r);
  g.lobbyOpts.startMission = 'free';
  g.handleMessage(c, { t: 'ready', ready: true });
  g.space.enemies = []; g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0;
  const ereignisse = [];
  const emit = g.emit.bind(g);
  g.emit = (name, data) => { if (['notsprung', 'squadRecall', 'schiffZerstoert', 'beam'].includes(name)) ereignisse.push({ t: g.time, name, data }); return emit(name, data); };
  const P = { g, c, h: c.player, spy, ereignisse };
  lauf(P, 40, () => g.players.filter((p) => p.bot).every((p) => Station.stationOf(p) === KONSOLE[p.rolle])); lauf(P, 1);
  return P;
}
const tick = (P) => { P.g.step(); if (P.g.wantsSnapshot()) P.g.snapshot(); };
const lauf = (P, sec, bis, jeTick) => { const t1 = P.g.time + sec; while (P.g.time < t1) { tick(P); if (jeTick) jeTick(); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const botVon = (P, rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
function setze(P, x, y) { const s = P.g.ship; s.docked = false; s.dockedAt = null; s.dockArmed = true; s.x = x; s.y = y; s.angle = 0; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.stage = STOP; s.helm.autoStop = false; lauf(P, 1.5); }
const sysZustand = (g) => JSON.stringify(g.ship.systems);

// Ein Fall: Reaktor des zweiten Ausfalls (Countdown 10 s) zerstoeren, 25 s laufen lassen, Zustand Tick fuer Tick (jede halbe Sekunde, dazu jeder Wechsel) protokollieren
function fall(name, bots, mitMensch, opt) {
  opt = opt || {};
  console.log(`\n=== ${name}: Bots ${bots.join('+')}, ${mitMensch ? 'ein Mensch unten (zone away)' : 'niemand unten'} ===`);
  const P = partie(bots); const { g } = P;
  g.explore.erkunde('0306'); const sp = Sprung.sprungpunkt(g, '0306'); setze(P, sp.x - 600, sp.y);
  const ws = g.weltsim; let fracht = { aufrufe: 0, verloren: [] };
  const altFracht = FadenFracht.notsprung; FadenFracht.notsprung = (gm) => { fracht.aufrufe++; const r = altFracht(gm); fracht.verloren = fracht.verloren.concat(r); return r; };
  try {
    if (mitMensch) { P.h.zone = 'away'; lauf(P, opt.amTransfer ? 40 : 8, () => { const b = Lauf.bordBot(g); return b && b.console === 'transfer'; }); }
    const vorSzene = g.ship.scene; const vorSys = sysZustand(g);
    const inv0 = FadenFracht.inventar(g).length;
    g.ship.reaktorAusfaelle = opt.ausfaelle == null ? 1 : opt.ausfaelle; interior.damageSystem(g, 'reactor', 'broken');   // Standard: zweiter Ausfall, Countdown 10 s
    const t0 = g.time; const cd0 = g.ship.reaktorCountdown ? g.ship.reaktorCountdown.t : null;
    console.log(`  t=0: Countdown ${cd0} s, Szene ${vorSzene}, Mensch ${P.h.zone}, Bord-Bot ${(Lauf.bordBot(g) || {}).rolle || '-'}, Transfer ${g.ship.systems.transfer}, Ware an Bord ${inv0}`);
    let letzteZeile = '';
    let gesprungen = null;
    lauf(P, 25, () => g.ship.schiffZerstoert || (gesprungen && g.time - gesprungen > 6), () => {
      const rest = g.ship.reaktorCountdown ? g.ship.reaktorCountdown.t : null;
      const cons = g.players.filter((p) => p.bot).map((p) => p.rolle[0] + ':' + (p.console || p.zone)).join(' ');
      const zeile = `Mensch ${P.h.zone}, Szene ${g.ship.scene}, Reaktor ${g.ship.systems.reactor}, Transfer ${g.ship.systems.transfer}, Bots ${cons}`;
      const ns = P.ereignisse.find((e) => e.name === 'notsprung');
      if (ns && !gesprungen) gesprungen = ns.t;
      const jetzt = g.time - t0;
      if (zeile !== letzteZeile || Math.floor(jetzt * 2) !== Math.floor((jetzt - 1 / 30) * 2)) {
        if (zeile !== letzteZeile || jetzt < 12) console.log(`  t=${jetzt.toFixed(2).padStart(5)}: Rest ${rest == null ? '-' : rest.toFixed(1)} s | ${zeile}`);
        letzteZeile = zeile;
      }
    });
    const ns = P.ereignisse.find((e) => e.name === 'notsprung');
    const rc = P.ereignisse.find((e) => e.name === 'squadRecall');
    const sendNs = P.spy.filter((s) => s.msg.t === 'cmd' && s.msg.c === 'helm.notsprung');
    const nachSys = sysZustand(g);
    const schaden = Object.keys(g.ship.systems).filter((k) => JSON.parse(vorSys)[k] !== g.ship.systems[k]).map((k) => `${k}: ${JSON.parse(vorSys)[k]} -> ${g.ship.systems[k]}`);
    const res = {
      gesprungen: !!ns, zeitBisSprung: ns ? +(ns.t - t0).toFixed(2) : null, vonNach: ns ? `${ns.data.von} -> ${ns.data.nach}` : null,
      botSender: sendNs.map((s) => `${s.rolle}@${(s.t - t0).toFixed(2)}`),
      tot: !!g.ship.schiffZerstoert, mensch: P.h.zone, rueckholung: !!rc, transferNachher: g.ship.systems.transfer, schaeden: schaden,
      weltsimAktiv: !!g.weltsim, frachtHookAufrufe: fracht.aufrufe, ware0: inv0,
    };
    console.log('  ERGEBNIS ' + JSON.stringify(res));
    return res;
  } finally { FadenFracht.notsprung = altFracht; }
}

const a1 = fall('a1', ['navigation'], false);
const a2 = fall('a2', ['navigation', 'technik'], false);
const b1 = fall('b1', ['navigation', 'technik'], true);
const b2 = fall('b2', ['navigation'], true);
const b2t = fall('b2t', ['navigation'], true, { amTransfer: true, ausfaelle: 0 });
const b2x = fall('b2x', ['navigation'], true, { amTransfer: true, ausfaelle: 1 });
const b3 = fall('b3', ['navigation', 'ops', 'technik'], true);
const c1 = fall('c1', ['ops', 'technik'], false);
const c2 = fall('c2', ['ops', 'technik'], true);

console.log('\n=== Auswertung ===');
ok(a1.gesprungen && !a1.tot && a1.zeitBisSprung >= 1.5 && a1.zeitBisSprung <= 2.5, `(a1) nur Navigation, niemand unten: Notsprung bei Rest 8 s (nach ${a1.zeitBisSprung} s), Lerche lebt`);
ok(a2.gesprungen && !a2.tot, `(a2) Navigation+Technik, niemand unten: Notsprung (${a2.zeitBisSprung} s), Lerche lebt`);
ok(b1.gesprungen && !b1.tot && b1.rueckholung, `(b1) Mensch unten, Technik haelt den Bord-Dienst: Notsprung (${b1.zeitBisSprung} s), Rueckholung ${b1.rueckholung}, Mensch ${b1.mensch}`);
ok(b2.gesprungen && !b2.tot, `(b2) nur Navigation mit Mensch unten (Bot auf dem Weg zum Transfer): Notsprung ${b2.gesprungen} (${b2.zeitBisSprung} s), tot ${b2.tot}, Mensch ${b2.mensch}`);
ok(b2t.gesprungen && !b2t.tot, `(b2t) nur Navigation, Bot am Transfer, erster Ausfall (20 s): Notsprung ${b2t.gesprungen} (${b2t.zeitBisSprung} s), tot ${b2t.tot}`);
console.log(`  info (b2x) nur Navigation, Bot am Transfer, zweiter Ausfall (10 s): Notsprung ${b2x.gesprungen}, tot ${b2x.tot} (der Weg zur Steuer dauert rund 10 s)`);
console.log(`  info (b3) alle drei, Mensch unten: Notsprung ${b3.gesprungen}, tot ${b3.tot}, Mensch ${b3.mensch}`);
ok(!c1.gesprungen && c1.tot, `(c1) ohne Navigations-Bot: kein Notsprung, die Lerche stirbt (tot ${c1.tot})`);
console.log(`  info (c2) ohne Navigation, Mensch unten: Notsprung ${c2.gesprungen}, tot ${c2.tot}`);
console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
