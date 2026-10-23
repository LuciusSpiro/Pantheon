'use strict';
// SUND-02b A2 (Abnahme Mehrspieler): Posten sprengen am ECHTEN Server – drei WebSocket-Clients wie im Spiel (Lobby, Start, Debug-Ankunft, Kommandos, Snapshots).
// Ein Spieler sitzt an der Ops und greift den germanischen Posten an, die beiden anderen sehen zu: alle drei sehen denselben Anlauf (fracht.halt), dieselbe Szene (flotte.sz mit x), denselben Funk, dasselbe
// Ergebnis (Posten frei, world.ruf); nur der Server schreibt (Befehl ohne Ops-Sitz und gefälschte Nachrichten ändern nichts); ein Trennen bricht nichts ab; Tickzähler genau +1; Snapshot im Budget.
// Fixture am Server-Objekt: der Posten der Gegner, Rang und die Lage der Lerche (die Clients fliegen und schießen nicht); alles andere läuft über das Netz.
//   node tools/test-sprengen-ws.js   (Port PORT oder 0 = frei)   (npm run test:sprengen-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const WebSocket = require('ws');
const Sektoren = require('../shared/sektoren.js');
const Besitz = require('../server/sim/besitz.js');
const Locations = require('../shared/locations.js');
const Space = require('../server/sim/space.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const { startServer } = require('../server/index.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'SPR3';
const PW = require('../content/welt/posten-werte.json').werte;
const RUF = require('../content/welt/ruf-werte.json').werte;
const SZT = require('../content/flotte/sim-szene.json');
const GER1 = '0703';

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, snaps: [], sizes: [], funk: [], oda: [], ruf: null, halts: [], szs: [] };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'snap') {
        c.snaps.push(m); c.sizes.push(Buffer.byteLength(s)); if (c.snaps.length > 5) c.snaps.shift();
        if (m.world && m.world.ruf) c.ruf = m.world.ruf;
        if (m.fracht && m.fracht.halt) c.halts.push(m.fracht.halt);
        if (m.flotte && m.flotte.sz) c.szs.push(m.flotte.sz);
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') c.funk.push(m.text);
      if (m.t === 'event' && m.kind === 'oda') c.oda.push(m.text);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}
const kill = (g, e) => { e.hp = 1; Space.damageEnemy(g, e, 500, e.x - 100, e.y, {}); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sprengen-ws-'));
  const srv = await startServer({ port: process.env.PORT != null ? Number(process.env.PORT) : 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game; const port = srv.port;
  console.log(`Server auf Port ${port}`);
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  PW.angreifen.wert.dauer = 3; PW.angreifen.wert.vorlauf = 3;   // kurz: der Server läuft in Echtzeit (die Daten sind dieselben Objekte im selben Prozess)
  const a = await client(port, { clientId: 'A', name: 'Ada', color: 0 });
  const b = await client(port, { clientId: 'B', name: 'Bo', color: 1 });
  const c = await client(port, { clientId: 'C', name: 'Cem', color: 2 });
  await sleep(300);
  a.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of [a, b, c]) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  ok(g.phase === 'play' && g.weltsim && g.players.length === 3 && g.players.every((p) => p.connected), 'Freie Fahrt Sund läuft mit drei Spielern über das Netz');
  const bis = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(50); } return !!f(); };
  const snap = (x) => x.snaps[x.snaps.length - 1];
  let snapMax = 0;
  const messen = () => { for (const x of [a, b, c]) { const m = Math.max(0, ...x.sizes); if (m > snapMax) snapMax = m; x.sizes = []; } };
  const z = () => g.weltsim.zustand;
  const alle = (f) => [a, b, c].every((x) => x.snaps.length && f(snap(x)));

  // Posten der Gegner, Ankunft, Ops besetzt
  Object.assign(z().hexe[GER1], { besitzer: 'ger', posten: true, garnison: 4, anspruch: {} });
  z().flotten = z().flotten.filter((f) => f.ort !== GER1);
  a.send({ t: 'debug', cmd: 'hex', hex: GER1 });
  await bis(() => g.ship.scene === Sektoren.ortVonHex(GER1), 2500); await sleep(300);
  a.send({ t: 'debug', cmd: 'sitz', console: 'weapons' });
  await sleep(300);
  const pl = Besitz.postenLage(Locations.get(Sektoren.ortVonHex(GER1)).scene);
  const stelle = () => { Object.assign(g.ship, { x: pl.x, y: pl.y, vx: 0, vy: 0, speed: 0 }); g.ship.helm.stage = 1; };
  stelle();
  await sleep(300);
  ok(!g.simSzene, 'Ankunft am gegnerischen Posten: keine Szene (Ruf ist ein Kann)');
  ok(alle((s) => s.space && s.space.po && s.space.po.k === 'x' && s.space.po.ok === 1), 'alle drei sehen space.po { k: x, ok: 1 } (Angreifen möglich)');
  const tick0 = g.weltsim.tickZahl; const ruf0 = g.weltsim.ruf.rom;

  // Zuschauer und fremde Nachrichten ändern nichts
  b.send({ t: 'cmd', c: 'weapons.posten.angreifen' });   // B sitzt nicht an der Ops
  b.send({ t: 'cmd', c: 'posten.sprengen', ort: GER1 }); c.send({ t: 'posten', ort: GER1 }); c.send({ t: 'debug', cmd: 'sprengen', ort: GER1 });
  await sleep(500);
  ok(!(g.fracht && g.fracht.halt) && !g.simSzene && z().hexe[GER1].posten === true, 'ohne Ops-Sitz und mit gefälschten Nachrichten: kein Anlauf, keine Szene, der Posten steht (nur der Server schreibt)');

  // Angreifen über das Netz
  a.send({ t: 'cmd', c: 'weapons.posten.angreifen' });
  await bis(() => g.fracht && g.fracht.halt && g.fracht.halt.kind === 'posten', 1500);
  await sleep(1000);
  ok(alle((s) => s.fracht && s.fracht.halt && s.fracht.halt.kind === 'posten' && s.fracht.halt.id === 'angreifen' && s.fracht.halt.p > 0), 'alle drei sehen fracht.halt { kind: posten, id: angreifen, p } mit Fortschritt');
  ok(g.weltsim.tickZahl === tick0 && z().hexe[GER1].posten === true, 'während des Anlaufs: kein Tick, nichts verändert');
  await bis(() => g.simSzene && g.simSzene.modus === 'angriff', 6000);
  await sleep(500);
  ok(g.simSzene && g.simSzene.modus === 'angriff' && g.weltsim.tickZahl === tick0, 'Angriffsszene läuft, Beginn ist kein Tick');
  ok(alle((s) => !(s.fracht && s.fracht.halt)), 'der Anlauf ist bei allen weg');
  ok(alle((s) => s.flotte && s.flotte.sz && s.flotte.sz.x === 1 && ['v', 'k'].includes(s.flotte.sz.p)), 'alle drei sehen flotte.sz mit x 1 (ANGRIFF AUF POSTEN)');
  ok([a, b, c].every((x) => x.funk.some((t) => /Angriff auf den Posten/.test(t))), 'der Funk „Angriff auf den Posten …“ erreicht alle drei');
  await bis(() => g.simSzene && g.simSzene.phase === 'kampf' && g.space.enemies.length > 0, 8000);
  messen();

  // ein Spieler trennt sich mitten in der Szene: nichts bricht ab
  const S = g.simSzene;
  c.ws.close(); await sleep(500);
  ok(g.simSzene === S && g.players.filter((q) => q.connected).length === 2, 'ein Spieler trennt: die Szene läuft weiter (hängt am Schiff)');

  // Wellen abräumen
  for (let i = 0; i < 600 && g.simSzene; i++) { for (const e of g.space.enemies.slice()) kill(g, e); await sleep(100); }
  await bis(() => !g.simSzene, 3000); await sleep(600);
  const L = Szene.letzte(g);
  ok(!g.simSzene && L && L.ausgang === 'sieg' && L.gesprengt === true, 'Sieg: Posten gesprengt');
  ok(z().hexe[GER1].posten === false && z().hexe[GER1].besitzer === null, 'Posten frei (Server)');
  ok(g.weltsim.tickZahl === tick0 + 1, `genau ein Tick (${tick0} -> ${g.weltsim.tickZahl}), die Wirkungen gelten einmal`);
  const q = RUF.quellen.wert.posten_gesprengt_ger;
  ok(g.weltsim.ruf.rom === ruf0 + q.delta, `Ruf Rom +${q.delta}`);
  ok([a, b].every((x) => x.ruf && x.ruf.rom === ruf0 + q.delta), 'world.ruf bei beiden verbliebenen gleich');
  ok([a, b].every((x) => x.funk.some((t) => /gesprengt/.test(t))), 'der Funk „… gesprengt“ erreicht beide verbliebenen Spieler');
  ok([a, b].every((x) => x.szs.some((s) => s.p === 's' && s.x === 1)), 'beide sahen die Ergebniszeile (Sieg, x 1)');
  await sleep(300);
  ok([a, b].every((x) => !(snap(x).space && snap(x).space.po && snap(x).space.po.k === 'x')), 'space.po zeigt kein Angreifen mehr (der Posten ist weg)');
  messen();
  ok(snapMax > 0 && snapMax <= 18944, `Snapshot während Anlauf, Szene und Ergebnis max ${snapMax} B (Ziel ≤ 18 944 B)`);
  ok(g.errors === 0, 'Server-Fehlerzähler 0 (' + g.errors + ')');
  void SZT;

  try { a.ws.close(); b.ws.close(); } catch (e) { /* egal */ }
  await srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'SPRENGEN-WS OK'}`);
  process.exit(fails ? 1 : 0);
})();
