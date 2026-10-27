'use strict';
// SUND-02a A2 (Abnahme 8): Sim-Szene am ECHTEN Server – WebSocket-Clients wie im Spiel (Lobby, Start, Debug-Ankunft, Sprung-Kommandos, Snapshots),
// Tickzähler der Weltsimulation vor und nach: Sieg (+1), Misserfolg (+1), Flucht per Sprung (+1, der Sprung-Tick), Flucht per Notfallsprung (+1),
// Szene ohne Wirkung (+1, Zustand = Vergleichslauf). Drei Spieler: eine Szene, Wirkungen einmal, ein Trennen bricht nichts ab.
// Fixture am Server-Objekt: die Flotte der Sim im Hex und die Abschüsse (die Clients feuern nicht); alles andere läuft über das Netz.
//   node tools/test-szene-ws.js   (Port PORT oder 3414)   (npm run test:szene-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const WebSocket = require('ws');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Sektoren = require('../shared/sektoren.js');
const Kern = require('../server/weltsim/kern.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');   // SYS-01 C1a-1: Gegner ohne Hülle, Abschuss über den Reaktor
const Sprung = require('../server/sim/sprung.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const { startServer } = require('../server/index.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'SZ3N';
const OSTIA = '0305';

let letzterTick = null; const kernOrig = Kern.tick;
Kern.tick = function (z, o) { letzterTick = { vor: Kriegslage.abbild(z), wirkungen: (o && o.wirkungen) || [] }; return kernOrig.apply(this, arguments); };
const gleichJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, msgs: [], snaps: [], sizes: [], welcome: null, funk: [], oda: [] };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'snap') { c.snaps.push(m); c.sizes.push(Buffer.byteLength(s)); if (c.snaps.length > 5) c.snaps.shift(); return; }
      if (m.t === 'welcome') c.welcome = m;
      if (m.t === 'event' && m.kind === 'radio') c.funk.push(m.text);
      if (m.t === 'event' && m.kind === 'oda') c.oda.push(m.text);
      c.msgs.push(m);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}
const kill = (g, e) => Testhilfe.toeten(g, e);
function flotte(g, hex, fraktion, staerke, belagerung) {
  const z = g.weltsim.zustand;
  const fl = { id: z.naechsteId++, fraktion, heimat: ({ ger: '1004', pirat: '0602', kon: '0604' })[fraktion] || hex, ort: hex, staerke, kap: Math.max(staerke, 5), befehl: 'rueckzug', ziel: null, warte: 0, versorgung: 1, angriff: null }; fl.befehl = 'angriff'; fl.ziel = hex;   // steht im Feld (die Sim kennt 'heim' nur im eigenen Hafen, dort löst sie keine Szene aus; im Rückzug zöge sie im nächsten Tick ab)
  z.flotten.push(fl);
  if (belagerung) {
    const id = z.naechsteAngriffId++;
    z.angriffe.push({ id, t0: z.tick, ziel: hex, von: fraktion, art: fraktion === 'pirat' ? 'pirat' : 'reich', relevant: true, zielArt: 'hafen', t_an: z.tick, t_ende: null, ausgang: null, phase: 'marsch', t_marsch: z.tick, stuetz: null, flotten: [fl.id] });
    fl.befehl = 'angriff'; fl.ziel = hex; fl.angriff = id;
  }
  return fl;
}
const ohne = (g, hex) => { const z = g.weltsim.zustand; z.flotten = z.flotten.filter((f) => f.ort !== hex); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-szene-ws-'));
  const srv = await startServer({ port: process.env.PORT != null ? Number(process.env.PORT) : 3414, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game; const port = srv.port;
  console.log(`Server auf Port ${port}`);
  g.C.simSzene.vorwarnung = 3; g.C.simSzene.vorwarnungErinnerung = [2, 1]; g.C.simSzene.erschoepfungGnade = 3;   // kurze Vorwarnung: der Server läuft in Echtzeit
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  const a = await client(port, { clientId: 'A', name: 'Ada', color: 0 });
  const b = await client(port, { clientId: 'B', name: 'Bo', color: 1 });
  const c = await client(port, { clientId: 'C', name: 'Cem', color: 2 });
  await sleep(300);
  a.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of [a, b, c]) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  ok(g.phase === 'play' && g.weltsim && g.players.length === 3 && g.players.every((p) => p.connected), 'Freie Fahrt Sund läuft mit drei Spielern über das Netz');
  const snap = () => a.snaps[a.snaps.length - 1];
  const tick = () => g.weltsim.tickZahl;
  const bis = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(50); } return !!f(); };
  let snapMax = 0;
  const messen = () => { for (const x of [a, b, c]) { const m = Math.max(0, ...x.sizes); if (m > snapMax) snapMax = m; x.sizes = []; } };
  const ankunft = async (hex) => { a.send({ t: 'debug', cmd: 'hex', hex }); await bis(() => g.ship.scene === Sektoren.ortVonHex(hex), 2000); await sleep(150); };
  const warteAufKampf = async () => { await bis(() => g.simSzene && g.simSzene.phase === 'kampf' && g.space.enemies.length > 0, 8000); };
  const flaggschiffFallen = async () => {
    for (let i = 0; i < 400 && g.simSzene; i++) {
      const fl = g.space.enemies.find((e) => e.flagg);
      if (fl) { kill(g, fl); break; }
      for (const e of g.space.enemies.slice()) kill(g, e);
      await sleep(100);
    }
    await bis(() => !g.simSzene, 3000);
  };

  // ---------- Sieg ----------
  console.log('\nSieg: Piratenflotte 8 im freien Sektor 0505');
  ohne(g, '0505'); const fl1 = flotte(g, '0505', 'pirat', 8);
  let t0 = tick();
  await ankunft('0505');
  ok(g.simSzene && g.simSzene.hex === '0505', 'Ankunft über das Netz (debug hex): Szene läuft');
  ok(a.funk.some((s) => /Feindkontakt/.test(s) && /Klarmachen/.test(s)) && b.funk.some((s) => /Feindkontakt/.test(s)) && c.funk.some((s) => /Feindkontakt/.test(s)), 'der Funkspruch erreicht alle drei Clients');
  ok(snap().flotte && snap().flotte.wl && snap().flotte.wl[0] === 0, 'Snapshot trägt flotte.wl (Welle 0/n in der Vorwarnung)');
  await warteAufKampf();
  ok(tick() === t0, 'während der Szene (Vorwarnung, Welle 1) kein Tick: ' + t0 + ' -> ' + tick());
  messen();
  await flaggschiffFallen();
  ok(!g.simSzene && Szene.letzte(g).ausgang === 'sieg' && tick() === t0 + 1, `Sieg: Tickzähler ${t0} -> ${tick()} (+1)`);
  ok(Szene.letzte(g).wirkungen.some((w) => w.typ === 'flaggschiff_gefallen') && g.weltsim.wirkungenAngewandt >= 2 && g.weltsim.wirkungenVerworfen === 0, 'Wirkungen angewandt, keine verworfen');
  ok(g.weltsim.kommandanten && Object.keys(g.weltsim.kommandanten).length === 1, 'Kommandant im Gedächtnis (' + Object.keys(g.weltsim.kommandanten) + ')');
  ok(fl1.befehl === 'rueckzug' || fl1.befehl === 'heim', 'Piratenflotte bricht ab');
  await sleep(1500);
  ok(a.snaps.length > 0 && snap().flotte && snap().flotte.sz && snap().flotte.sz.p === 's' && Object.keys(snap().flotte).join() === 'sz', 'nach dem Ende nur noch die Ergebniszeile flotte.sz (Sieg) im Snapshot, sonst nichts');

  // ---------- Misserfolg ----------
  console.log('\nMisserfolg: Ostia Nova belagert (Germanen 17), die Lerche unterliegt');
  ohne(g, OSTIA); const rom = flotte(g, OSTIA, 'rom', 4); const fl2 = flotte(g, OSTIA, 'ger', 17, true);
  t0 = tick();
  await ankunft(OSTIA);
  ok(g.simSzene && g.simSzene.ort === 'hafen', 'Hafen-Szene über das Netz');
  await warteAufKampf();
  ok(g.space.dockOk === false, 'Andocken gesperrt (space.dockOk im Server, Dock-Marker weg): ' + !g.space.markers.some((m) => m.kind === 'dock'));
  for (const q of (g.space.escorts || []).filter((x) => x.sim)) require('../server/sim/escort.js').hit(g, q, 99999, {});   // die Hafenflotte fällt, dann unterliegt die Lerche
  await sleep(500);
  require('../server/sim/space.js').verlustAusloesen(g, 'test');
  await bis(() => !g.simSzene, 3000);
  const L2 = Szene.letzte(g);
  ok(L2.ausgang === 'niederlage' && tick() === t0 + 1, `Misserfolg: Tickzähler ${t0} -> ${tick()} (+1)`);
  ok(g.weltsim.zustand.hexe[OSTIA].besitzer === 'ger', 'Hafen fiel an die Germanen (ort_gefallen, hafen_gefallen)');
  messen();

  // ---------- Flucht per Sprung (in der Vorwarnung: der Antrieb lädt nur ohne Gegner) ----------
  console.log('\nFlucht per Sprung: Piraten 5 im freien Sektor 0505');
  g.weltsim.zustand.hexe[OSTIA].besitzer = 'rom';
  ohne(g, '0505'); const fl3 = flotte(g, '0505', 'pirat', 5);
  const z0 = JSON.stringify(Kriegslage.abbild(g.weltsim.zustand));
  g.C.simSzene.vorwarnung = 60;   // lange Vorwarnung: genug Zeit zum Laden
  t0 = tick();
  await ankunft('0505');
  ok(g.simSzene && g.simSzene.phase === 'vorwarnung', 'Szene in der Vorwarnung');
  const ziel = '0503';
  g.explore.markBoje(Sektoren.kanteId('0505', ziel));
  a.send({ t: 'cmd', c: 'captain.selectDest', dest: Sektoren.ortVonHex(ziel) });
  await sleep(200);
  const p = Sprung.sprungpunkt(g, ziel);
  g.ship.x = p.x - 80; g.ship.y = p.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0; g.ship.helm.stage = 1;
  ok(await bis(() => g.ship.jump.ready, 15000), 'Antrieb geladen (ohne Gegner im Raum)');
  ok(tick() === t0, 'beim Laden kein Tick');
  a.send({ t: 'debug', cmd: 'sitz', console: 'helm' });
  await sleep(200);
  a.send({ t: 'cmd', c: 'helm.jump' });
  await bis(() => g.ship.scene !== Sektoren.ortVonHex('0505') && !g.simSzene, 3000);
  ok(!g.simSzene && g.ship.scene !== Sektoren.ortVonHex('0505') && tick() === t0 + 1, `Flucht per Sprung: Tickzähler ${t0} -> ${tick()} (+1, der Sprung-Tick)`);
  const L3 = Szene.letzte(g);
  ok(L3.ausgang === 'abbruch' && L3.wirkungen.length === 0 && letzterTick.wirkungen.length === 0, 'Szene ohne Wirkung: keine Wirkung, nur der eine Tick');
  const probe = Object.assign(JSON.parse(JSON.stringify(letzterTick.vor)), { werte: g.weltsim.zustand.werte, karte: g.weltsim.zustand.karte });
  kernOrig.call(Kern, probe, { wirkungen: [] });
  ok(gleichJson(Kriegslage.abbild(probe), Kriegslage.abbild(g.weltsim.zustand)), 'Weltstand = Vergleichslauf (ein Tick ohne Wirkung)');
  void z0; void fl3;

  // ---------- Flucht per Notfallsprung mit Verlusten ----------
  console.log('\nFlucht per Notfallsprung: Germanen 17 im freien Sektor, ein Abschuss');
  g.C.simSzene.vorwarnung = 3;
  ohne(g, '0505'); const fl4 = flotte(g, '0505', 'ger', 17);
  // Reste früherer Fälle (Flotten im Feld, auch die im Rückzug nach einem Sieg) wegräumen: der Notfallsprung landet zufällig in einem Nachbarhex und löste dort sonst eine neue Szene aus
  { const st = g.weltsim.zustand; st.flotten = st.flotten.filter((q) => q.id === fl4.id || !['angriff', 'anspruch', 'rueckzug'].includes(q.befehl)); st.angriffe = st.angriffe.filter((a) => a.t_ende !== null || (a.flotten || []).includes(fl4.id)); }
  await ankunft('0505');
  await warteAufKampf();
  const e1 = g.space.enemies[0]; const pt = CONFIG.wellenplan.punkte[e1.kind];
  kill(g, e1); await sleep(200);
  t0 = tick(); const idAlt = g.simSzene && g.simSzene.id;
  a.send({ t: 'debug', cmd: 'sitz', console: 'helm' });
  await sleep(200);
  a.send({ t: 'cmd', c: Protocol.CMD_HELM_NOTSPRUNG });
  await bis(() => !g.simSzene || g.simSzene.id !== idAlt, 3000);
  // Die Szene, die die Lerche verlässt, endet mit Abbruch und genau einem Tick. Landet der Notfallsprung zufällig in einem Hex mit marschierender Feindflotte, beginnt dort eine NEUE Szene (gewollt): geprüft wird deshalb die alte Szene, nicht „keine Szene“.
  { const L = Szene.letzte(g) || {}; ok(idAlt != null && L.id === idAlt && L.ausgang === 'abbruch' && (!g.simSzene || g.simSzene.id !== idAlt) && tick() === t0 + 1, `Notfallsprung: Tickzähler ${t0} -> ${tick()} (+1), alte Szene ${idAlt}: Ausgang ${L.ausgang} (Id ${L.id}), jetzt ${g.simSzene ? 'neue Szene ' + g.simSzene.id : 'keine Szene'}`); }
  ok(letzterTick.wirkungen.some((w) => w.typ === 'flotte_verlust' && w.flotte === fl4.id && w.punkte === pt) && !letzterTick.wirkungen.some((w) => w.typ.startsWith('ort_')), `Verlust ${pt} Punkt(e) gilt, kein ort_*`);

  // ---------- Mehrspieler: einer trennt ----------
  console.log('\nMehrspieler: ein Spieler trennt sich mitten in der Szene');
  ohne(g, '0505'); const fl5 = flotte(g, '0505', 'pirat', 8);
  await ankunft('0505');
  await warteAufKampf();
  const S5 = g.simSzene; t0 = tick();
  c.ws.close();
  await sleep(500);
  ok(g.simSzene === S5 && g.players.filter((q) => q.connected).length === 2, 'ein Spieler trennt: die Szene läuft weiter (hängt am Schiff)');
  b.ws.close(); await sleep(300);
  ok(g.simSzene === S5, 'auch der zweite weg: die Szene läuft weiter');
  await flaggschiffFallen();
  ok(Szene.letzte(g).ausgang === 'sieg' && tick() === t0 + 1, `Sieg mit einem Spieler: Wirkungen einmal, Tickzähler ${t0} -> ${tick()} (+1)`);
  void fl5; void rom; void fl2;
  messen();
  ok(snapMax > 0 && snapMax <= 18944, `Snapshot während der Szenen max ${snapMax} B (Ziel ≤ 18 944 B)`);
  ok(g.errors === 0, 'Server-Fehlerzähler 0 (' + g.errors + ')');

  try { a.ws.close(); } catch (e) { /* egal */ }
  await srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'SZENE-WS OK'}`);
  process.exit(fails ? 1 : 0);
})();
