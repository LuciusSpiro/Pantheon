'use strict';
// FRE-01 A: Szenario-Schalter der Freien Fahrt (server/sim/szenario-schalter.js, Daten content/welt/freie-fahrt-szenario.json). Ein Game wie in server/index.js
// (szenarioSchalter: true, noStore, Basis-Env ohne Schalter) startet freie_fahrt mit den Spielleiter-Schaltern aus dem Szenario: Brett, Faeden und Reise-Funk laufen auch
// ohne Modell (Rueckfall content/faeden/anschluss.json), es gibt weder Lage-Plaene noch einen CLI-Prozess; process.env bleibt unveraendert. Die Erwartungen stehen hier selbst.
// Geprueft: reine Funktion wirksamesEnv · (a) Start im Rueckfall-Betrieb · (b) Env-Variable ueberstimmt das Szenario · (c) andere Modi unberuehrt · (d) Option aus: wie bisher ·
// (e) Fortsetzen in beide Richtungen · (f) Betriebsart live (nur Env-Ebene, Transport als Stub, nie ein echter Aufruf) · (g) Telemetrie-Kopf.
// Aufruf: node tools/test-freie-fahrt-szenario.js [begriff ...]        (npm run test:freie-fahrt-szenario)
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
process.chdir(path.join(__dirname, '..'));

// Spion: jeder Kindprozess (CLI) landet hier und wird verweigert. Vor dem Laden des Spiels einhaengen.
const prozesse = [];
for (const k of ['spawn', 'spawnSync', 'exec', 'execFile', 'execSync', 'execFileSync', 'fork']) {
  cp[k] = function (...a) { prozesse.push(k + ' ' + String(a[0])); throw new Error('Test: Kindprozess verboten (' + k + ')'); };
}
delete process.env.LLM_LIVE;
const ENV_VOR = JSON.stringify(Object.assign({}, process.env));

const { Game } = require('../server/game.js');
const LLM = require('../server/mission/llm.js');
const Sz = require('../server/sim/szenario-schalter.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Faden = require('../server/sim/faden.js');
const RE = require('../server/sim/reise-ereignis.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Kopf = require('../server/telemetrie/kopf.js');
const Weltstand = require('../server/weltstand.js');
const Sektoren = require('../shared/sektoren.js');
const Sprung = require('../server/sim/sprung.js');
const DATEN = require('../content/welt/freie-fahrt-szenario.json');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fre01a-'));
let seq = 0;
const frisch = () => { const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true }); return d; };
const sch = DATEN.werte.schalter.wert;

// wie server/index.js: szenarioSchalter an, Basis-Env ohne Schalter (nur Ablage des Regie-Logbuchs im Temp)
function bauGame(o) {
  o = o || {};
  const dir = o.dir || frisch();
  const env = Object.assign({ MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(dir, 'regie') }, o.env || {});
  const g = new Game({ szenarioSchalter: o.szenarioSchalter !== false, noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env, log: () => {} });
  g.fehler = [];
  const ce = g.countError.bind(g); g.countError = (w, e) => { g.fehler.push(w + ': ' + (e && e.message)); return ce(w, e); };
  g.funk = [];
  const rad = g.emit.bind(g); g.emit = function (k, d) { if (k === 'radio') g.funk.push(d); return rad(k, d); };
  const conn = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(conn);
  g.handleMessage(conn, { t: 'hello', clientId: 'FF0', name: 'Bot', color: 0 });
  g.conn = conn; g.dir = dir;
  return g;
}
function starte(g, opt, schritte) {
  g.handleMessage(g.conn, Object.assign({ t: 'lobbyOpt' }, opt));
  g.handleMessage(g.conn, { t: 'ready', ready: true });
  for (let k = 0; k < (schritte == null ? 30 : schritte); k++) g.step();
}
function fortsetzen(g, id, schritte) {
  g.refreshWorldList();
  g.handleMessage(g.conn, { t: 'lobbyOpt', world: id });
  g.handleMessage(g.conn, { t: 'ready', ready: true });
  for (let k = 0; k < schritte; k++) g.step();
}
const platz = (g, x, y) => { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
// echte Spruenge wie tools/sim-freie-fahrt.js; nach jedem Sprung 40 Schritte
function springe(g, anzahl) {
  let getan = 0;
  for (; getan < anzahl; getan++) {
    const von = Sektoren.hexVonOrt(g.ship.scene);
    const kand = Sektoren.nachbarn(von).filter((h) => Sektoren.spielbar(h) && Sektoren.ortVonHex(h) && !Sektoren.istLeerraum(h));
    let gut = false;
    for (const h of kand) {
      g.explore.markBoje(Sektoren.kanteId(von, h));
      if (Sprung.hexGrund(g, von, h)) continue;
      if (Sprung.selectDest(g, Sektoren.ortVonHex(h))) continue;
      const p = Sprung.sprungpunkt(g, h); if (!p) continue;
      platz(g, p.x - 80, p.y);
      for (let k = 0; k < 900 && !g.ship.jump.ready; k++) { g.space.enemies = []; g.step(); }
      g.space.enemies = [];
      if (!Sprung.doJump(g)) { gut = true; break; }
    }
    if (!gut) break;
    for (let k = 0; k < 40; k++) g.step();
  }
  return getan;
}
const angebote = (g) => (g.weltsim && g.weltsim.faeden ? g.weltsim.faeden.abenteuerAngebote.length : 0);
const fadenZahl = (g) => (g.weltsim && g.weltsim.faeden ? g.weltsim.faeden.liste.length : 0);

section('Daten und reine Funktion wirksamesEnv', () => {
  ok(DATEN.format === 'freie-fahrt-szenario/1' && typeof DATEN._hinweis === 'string', 'Datei: Format-Feld und _hinweis');
  ok(sch.FAEDEN === '1' && sch.REISE_EREIGNISSE === '1' && sch.LAGE_SPIELLEITER === '1', 'Daten: FAEDEN, REISE_EREIGNISSE, LAGE_SPIELLEITER = 1');
  const basis = Object.freeze({ A: 'x' });
  const r = Sz.wirksamesEnv(basis, 'freie_fahrt', { live: false });
  ok(r !== basis && r.A === 'x' && r.FAEDEN === '1' && r.REISE_EREIGNISSE === '1' && r.LAGE_SPIELLEITER === '1', 'Kopie mit Szenario-Werten und Basis-Variablen');
  ok(r.SPIELLEITER_RUECKFALL === '1' && r.SPIELLEITER_LLM === undefined && r.LLM_LIVE === undefined, 'rueckfall: Rueckfall-Marker, kein Modell, kein LLM_LIVE');
  const l = Sz.wirksamesEnv({}, 'freie_fahrt', { live: true });
  ok(l.SPIELLEITER_LLM === 'live' && l.LLM_LIVE === '1' && l.SPIELLEITER_RUECKFALL === undefined, 'live: SPIELLEITER_LLM=live, LLM_LIVE=1, kein Rueckfall-Marker');
  const o = Sz.wirksamesEnv({ FAEDEN: '0', LLM_LIVE: '0', REISE_EREIGNISSE: '' }, 'freie_fahrt', { live: true });
  ok(o.FAEDEN === '0' && o.LLM_LIVE === '0' && o.REISE_EREIGNISSE === '1', 'gesetzte Variablen ueberstimmen (auch LLM_LIVE=0), leere zaehlen als nicht gesetzt');
  const a = Sz.wirksamesEnv({ B: '1' }, 'm1', { live: true });
  ok(a.B === '1' && a.FAEDEN === undefined && a.LLM_LIVE === undefined, 'anderer Modus: nur die Kopie der Basis');
  const p = Sz.wirksamesEnv(undefined, 'freie_fahrt', {});
  ok(p !== process.env && JSON.stringify(Object.assign({}, process.env)) === ENV_VOR, 'ohne Basis: Kopie von process.env, process.env unveraendert');
  ok(Sz.betriebsart(true) === 'live' && Sz.betriebsart(false) === 'rueckfall' && Sz.betriebsart(undefined) === 'rueckfall', 'betriebsart: nur true ist live');
  ok(LS.rueckfallAn({ LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' }) && !LS.rueckfallAn({ LAGE_SPIELLEITER: '1' }) && !LS.rueckfallAn({ LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1', SPIELLEITER_LLM: 'mock' }) && !LS.rueckfallAn({ SPIELLEITER_RUECKFALL: '1' }), 'rueckfallAn: braucht LAGE_SPIELLEITER und Marker, nie mit Modell');
  ok(!LS.betriebAn({ LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'off' }) && LS.betriebAn({ LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' }), 'Bestand: SPIELLEITER_LLM=off ohne Marker => kein Objekt; mock => Objekt');
});

section('(a) Freie Fahrt wie auf dem echten Server: Rueckfall ohne Modell', () => {
  const g = bauGame();
  ok(g.env === g.envBasis, 'vor dem Start: Basis-Env');
  starte(g, { startMission: 'freie_fahrt' });
  ok(g.phase === 'play' && g.env !== g.envBasis && g.env.FAEDEN === '1' && g.env.LAGE_SPIELLEITER === '1' && g.envBasis.FAEDEN === undefined, 'Szenario-Env ist eine Kopie, das Basis-Env bleibt ohne Schalter');
  const l = g.lageSpielleiter;
  ok(!!l && l.mode === 'off' && l.rueckfallBetrieb === true, 'Lage-Spielleiter im benannten Zustand rueckfall (mode off)');
  ok(Faden.aktiv(g) && RE.aktiv(g) && Faden.spielleiterAktiv(g) && Kriegslage.neueBloeckeAn(g), 'Faeden an, Reise-Ereignisse an, spielleiterAktiv, Bloecke werden gespeichert');
  ok(springe(g, 12) === 12, '12 echte Spruenge');
  const l2 = g.lageSpielleiter;
  ok(l2.aufrufe === 0 && l2.letzte_plaene.length === 0 && l2.zustand === 'idle' && !l2.job, 'kein Lage-Plan beauftragt');
  ok(!l2.llm || l2.llm.mode === 'off', 'kein Modell (llm fehlt oder mode off)');
  ok(prozesse.length === 0, 'kein CLI-Prozess gestartet (Spion: ' + prozesse.length + ')');
  ok(angebote(g) >= 1, 'Anschluss-Angebot am Brett nach den Spruengen (' + angebote(g) + ')');
  const bs = Brett.snapshot(g);
  ok(bs && bs.ok === 1 && bs.angebote.length >= 1, 'Brett-Snapshot ok:1 mit Angebot');
  g.sentAbenteuerKey = null;   // wie ein neu verbundener Client
  let ab = null;
  for (let i = 0; i < 15 && !ab; i++) { const sn = g.snapshot(); ab = sn && sn.world && sn.world.abenteuer; }
  ok(!!ab && ab.ok === 1 && ab.angebote.length >= 1, 'world.abenteuer im Snapshot (ok:1, mit Angebot)');
  ok(g.funk.some((f) => f.lage), 'Reise-Funk kam (lage:1)');
  ok(g.fehler.length === 0 && g.errors === 0, 'keine Serverfehler ' + g.fehler.join('|'));
  ok(JSON.stringify(Object.assign({}, process.env)) === ENV_VOR && process.env.LLM_LIVE === undefined, 'process.env unveraendert');
  g.zurLobby();
  ok(g.phase === 'lobby' && g.env === g.envBasis && g.lageSpielleiter === null && g.lageSchalter === undefined, 'zurLobby: Basis-Env, Lage-Spielleiter und -Schalter zurueckgesetzt');
});

section('(b) Env-Variable ueberstimmt das Szenario', () => {
  const g = bauGame({ env: { FAEDEN: '0' } });
  starte(g, { startMission: 'freie_fahrt' });
  ok(g.env.FAEDEN === '0' && !Faden.aktiv(g), 'FAEDEN=0 im Basis-Env: Faeden aus');
  ok(RE.aktiv(g) && !!g.lageSpielleiter && g.env.LAGE_SPIELLEITER === '1', 'uebrige Szenario-Werte gelten weiter');
  const g2 = bauGame({ env: { SPIELLEITER_LLM: 'mock' } });
  starte(g2, { startMission: 'freie_fahrt' });
  ok(g2.lageSpielleiter && g2.lageSpielleiter.mode === 'mock' && !g2.lageSpielleiter.rueckfallBetrieb, 'SPIELLEITER_LLM=mock im Basis-Env gewinnt: Mock, kein Rueckfall-Zustand');
  const g3 = bauGame({ env: { LAGE_SPIELLEITER: '0' } });
  starte(g3, { startMission: 'freie_fahrt' });
  ok(g3.lageSpielleiter == null && !Faden.spielleiterAktiv(g3), 'LAGE_SPIELLEITER=0: kein Lage-Spielleiter');
  ok(prozesse.length === 0, 'kein CLI-Prozess');
});

section('(c) andere Modi: Basis-Env, nichts aktiv', () => {
  for (const opt of [{ startMission: 'm1' }, { startMission: 'free' }, { startMission: 'labor' }, { startMission: 'arena_away' }, { startMission: 'arena' }]) {
    const g = bauGame();
    try { starte(g, opt, 5); } catch (e) { ok(false, opt.startMission + ': Ausnahme ' + e.message); continue; }
    ok(g.env === g.envBasis && g.env.FAEDEN === undefined && g.lageSpielleiter == null && !Faden.aktiv(g) && !RE.aktiv(g), opt.startMission + ': game.env bleibt Basis (phase ' + g.phase + '), nichts aktiv');
  }
  ok(prozesse.length === 0, 'kein CLI-Prozess');
});

section('(d) szenarioSchalter aus (Standard): freie_fahrt wie heute', () => {
  const g = bauGame({ szenarioSchalter: false });
  starte(g, { startMission: 'freie_fahrt' });
  ok(g.phase === 'play' && g.env === g.envBasis && !g.lageSpielleiter && !Faden.aktiv(g) && !RE.aktiv(g) && !Kriegslage.neueBloeckeAn(g), 'ohne Option: Basis-Env, nichts aktiv');
  const h = bauGame({ szenarioSchalter: false, env: { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'off' } });
  starte(h, { startMission: 'freie_fahrt' });
  ok(!h.lageSpielleiter && Faden.aktiv(h) && !Faden.spielleiterAktiv(h), 'Bestand: SPIELLEITER_LLM=off => kein Lage-Spielleiter, kein Brett');
  const k = new Game({ noStore: true, env: {}, log: () => {} });
  ok(k.szenarioSchalter === false && k.envBasis === k.env, 'Default der Option: false');
});

section('(e) Fortsetzen eines Weltstands in beide Richtungen', () => {
  const dir = frisch();
  const g = bauGame({ dir });
  starte(g, { startMission: 'freie_fahrt' });
  springe(g, 12);
  // einen Faden laufen lassen: ein Angebot ueber den echten Weg des Bretts annehmen, danach wieder ein offenes Angebot (Anschluss) abwarten
  const ids = (Brett.snapshot(g) || { angebote: [] }).angebote.map((a) => a.id);
  ok(ids.length >= 1, 'Vorbedingung: offenes Angebot (' + ids.length + ')');
  const fehler = ids.length ? Brett.annehmen(g, ids[0]) : 'keins';
  ok(fehler == null && fadenZahl(g) >= 1, 'Angebot angenommen, Faden laeuft (Liste ' + fadenZahl(g) + ', Fehler ' + JSON.stringify(fehler) + ')');
  const D = require('../server/sim/faden-daten.js');
  for (const bp of D.ANSCHLUSS.plaene) { if (angebote(g) >= 1) break; Faden.abenteuerAnbieten(g, JSON.parse(JSON.stringify(bp)), { hex: Sektoren.hexVonOrt(g.ship.scene) }); }   // ein zweites Angebot aus den Standardplaenen (der Anschluss bietet bei laufendem Abenteuer keins an)
  ok(angebote(g) >= 1, 'zugleich ein offenes Angebot (' + angebote(g) + ')');
  const faeden = fadenZahl(g), offen = angebote(g);
  ok(Weltstand.save(g).ok, 'Weltstand gespeichert');
  const id = g.weltstand && g.weltstand.id;
  const datei = path.join(dir, id + '.json');
  const data = JSON.parse(fs.readFileSync(datei, 'utf8'));
  ok(data.welt.sim.modus === 'freie_fahrt' && !!data.welt.sim.chronik && !!data.welt.sim.reise && !!data.welt.sim.faeden, 'Stand enthaelt chronik, reise, faeden');
  ok(data.version === 3, 'Weltstand-Version bleibt 3');

  // Richtung 1: neuer Server mit Szenario (Basis-Env ohne Schalter) setzt den Stand fort
  const dir2 = frisch(); fs.copyFileSync(datei, path.join(dir2, id + '.json'));
  const h = bauGame({ dir: dir2 });
  fortsetzen(h, id, 60);
  ok(h.phase === 'play' && h.env !== h.envBasis && h.env.FAEDEN === '1' && h.env.SPIELLEITER_LLM === undefined && h.env.LLM_LIVE === undefined, 'Fortsetzen: Szenario-Env gesetzt, Betriebsart rueckfall (nie live)');
  ok(!!h.lageSpielleiter && h.lageSpielleiter.rueckfallBetrieb === true && Faden.spielleiterAktiv(h), 'Rueckfall-Lage-Spielleiter laeuft');
  ok(fadenZahl(h) === faeden && angebote(h) === offen, 'Faden (' + fadenZahl(h) + ') und offenes Angebot (' + angebote(h) + ') wiederhergestellt');
  ok(h.fehler.length === 0 && h.errors === 0, 'keine Fehler ' + h.fehler.join('|'));
  Weltstand.save(h);
  const nach = JSON.parse(fs.readFileSync(path.join(dir2, id + '.json'), 'utf8'));
  ok(['chronik', 'reise', 'faeden'].every((k) => nach.welt.sim[k]), 'erneut gespeichert: Bloecke chronik, reise, faeden bleiben');
  h.zurLobby();
  ok(h.env === h.envBasis && h.lageSpielleiter === null, 'zurueck in die Lobby: Basis-Env');

  // Richtung 2: derselbe Stand ohne Szenario (Option aus, Basis-Env ohne Schalter): laedt heil
  const dir3 = frisch(); fs.copyFileSync(datei, path.join(dir3, id + '.json'));
  const k = bauGame({ dir: dir3, szenarioSchalter: false });
  fortsetzen(k, id, 60);
  ok(k.phase === 'play' && k.env === k.envBasis && k.fehler.length === 0 && k.errors === 0, 'ohne Szenario geladen: heil, keine Fehler ' + k.fehler.join('|'));
  ok(!Faden.aktiv(k) && !k.lageSpielleiter, 'ohne Schalter: nichts aktiv, kein Lage-Spielleiter');

  // Altstand aus main (Sim-Block ohne neue Felder) in einem Weltstand, mit Szenario
  const alt = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'faeden', 'main-sim-altstand.json'), 'utf8'));
  const dir4 = frisch();
  const d4 = JSON.parse(JSON.stringify(data)); d4.welt.sim = alt;
  fs.writeFileSync(path.join(dir4, id + '.json'), JSON.stringify(d4));
  const m = bauGame({ dir: dir4 });
  fortsetzen(m, id, 60);
  ok(m.phase === 'play' && m.fehler.length === 0 && m.errors === 0 && !!m.weltsim, 'Altstand aus main laedt mit Szenario ohne Fehler ' + m.fehler.join('|'));
  ok(m.env.FAEDEN === '1' && !!m.lageSpielleiter && m.lageSpielleiter.rueckfallBetrieb, 'Altstand: Szenario-Env gilt, neue Bloecke beginnen leer');

  // Stand eines anderen Modus (Kampagne) setzt kein Szenario
  const dir5 = frisch();
  const c = bauGame({ dir: dir5 });
  starte(c, { startMission: 'free' }, 10);
  const idc = c.weltstand && c.weltstand.id;
  ok(!!idc && fs.existsSync(path.join(dir5, idc + '.json')), 'Kampagnenstand angelegt');
  c.zurLobby();
  fortsetzen(c, idc, 10);
  ok(c.phase === 'play' && c.env === c.envBasis && !Faden.aktiv(c), 'Kampagnenstand fortgesetzt: Basis-Env, nichts aktiv');
  ok(prozesse.length === 0, 'kein CLI-Prozess');
});

section('(f) Betriebsart live: nur Env-Ebene, Transport als Stub', async () => {
  const g = bauGame();
  g.lobbyOpts.liveSpielleiter = true;
  g.handleMessage(g.conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(g.conn, { t: 'ready', ready: true });
  g.step();   // legt den Lage-Spielleiter an (noch keine Grenze, kein Aufruf)
  ok(g.env.SPIELLEITER_LLM === 'live' && g.env.LLM_LIVE === '1' && g.env.SPIELLEITER_RUECKFALL === undefined, 'wirksames Env: SPIELLEITER_LLM=live, LLM_LIVE=1');
  ok(process.env.LLM_LIVE === undefined && g.envBasis.LLM_LIVE === undefined, 'process.env.LLM_LIVE und Basis-Env nicht gesetzt');
  ok(g.lageSpielleiter && g.lageSpielleiter.mode === 'live' && !g.lageSpielleiter.rueckfallBetrieb, 'Lage-Spielleiter im Modus live (kein Rueckfall-Zustand)');
  ok(Faden.spielleiterAktiv(g), 'spielleiterAktiv');
  const rufe = [];
  const stub = { name: 'stub', call: async (text) => { rufe.push(text); return { text: '{"befehle":[]}', usage: { input: 1, output: 1 } }; } };
  const frage = { system: 'x', prompt: 'p', art: 'a', nr: 1 };
  // ohne die Option verhaelt sich llm.js wie bisher: ohne LLM_LIVE in process.env verweigert er
  const ohne = LLM.create({ mode: 'live', transport: stub, recordDir: path.join(TMP, 'a1') });
  const mit = LLM.create({ mode: 'live', transport: stub, env: g.env, recordDir: path.join(TMP, 'a2') });
  const a = await ohne.ask('lage', frage, { timeoutMs: 1000 }).then(() => 'ok', (e) => e.code);
  const b = await mit.ask('lage', frage, { timeoutMs: 1000 }).then(() => 'ok', (e) => e.code + ':' + e.message);
  ok(a === 'REFUSED', 'ohne Option: REFUSED wie bisher (' + a + ')');
  ok(b === 'ok' && rufe.length === 1, 'mit dem Env des Szenarios: Aufruf geht an den Stub (' + b + ')');
  const l = g.lageSpielleiter; l.opts.transport = stub; l.llm = null;
  const c = await l.getLlm().ask('lage', Object.assign({}, frage, { nr: 2 }), { timeoutMs: 1000 }).then(() => 'ok', (e) => e.code);
  ok(c === 'ok' && rufe.length === 2, 'getLlm des Lage-Spielleiters reicht sein Env durch (' + c + ')');
  ok(prozesse.length === 0 && process.env.LLM_LIVE === undefined, 'kein CLI-Prozess, process.env.LLM_LIVE weiter ungesetzt');
  g.zurLobby();
  ok(g.env === g.envBasis, 'zurLobby: Basis-Env');
  // Fortsetzen ist nie live, auch wenn die Lobby-Option steht (steht in (e): Betriebsart rueckfall)
});

section('(g) Telemetrie-Kopf nennt die wirksamen Schalter', () => {
  const g = bauGame();
  starte(g, { startMission: 'freie_fahrt' }, 3);
  const k = Kopf.baueKopf(g, { tuning: Kopf.tuningStand(g), quelle: 'mensch' });
  ok(k.schalter.FAEDEN === '1' && k.schalter.REISE_EREIGNISSE === '1' && k.schalter.LAGE_SPIELLEITER === '1' && k.schalter.SPIELLEITER_RUECKFALL === '1', 'Rueckfall: Kopf nennt FAEDEN, REISE_EREIGNISSE, LAGE_SPIELLEITER, SPIELLEITER_RUECKFALL');
  ok(k.schalter.SPIELLEITER_LLM === undefined && k.schalter.LLM_LIVE === undefined, 'kein Modell, kein LLM_LIVE im Kopf');
  const v = bauGame();
  v.lobbyOpts.liveSpielleiter = true;
  starte(v, { startMission: 'freie_fahrt' }, 3);
  const kv = Kopf.baueKopf(v, { tuning: Kopf.tuningStand(v), quelle: 'mensch' });
  ok(kv.schalter.SPIELLEITER_LLM === 'live' && kv.schalter.LLM_LIVE === '1', 'live: Kopf nennt SPIELLEITER_LLM=live und LLM_LIVE=1');
  ok(Kopf.SCHALTER.includes('LLM_LIVE') && Kopf.SCHALTER.includes('SPIELLEITER_RUECKFALL'), 'Positivliste enthaelt LLM_LIVE und SPIELLEITER_RUECKFALL');
  v.zurLobby();
  ok(prozesse.length === 0, 'kein CLI-Prozess');
});

(async () => {
  for (const [name, fn] of abschnitte) {
    if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
    console.log('\n' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
  }
  ok(JSON.stringify(Object.assign({}, process.env)) === ENV_VOR, 'process.env am Ende unveraendert');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* Temp */ }
  console.log('\n' + (n - fails) + ' von ' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
  process.exit(fails ? 1 : 0);
})();
