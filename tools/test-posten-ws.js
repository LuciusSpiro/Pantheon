'use strict';
// SUND-02b A1 (Abnahme Mehrspieler): Posten der Crew am ECHTEN Server – drei WebSocket-Clients wie im Spiel (Lobby, Start, Debug-Ankunft, Kommandos, Snapshots).
// Ein Spieler sitzt an der Ops und gründet, die beiden anderen sehen zu: alle drei sehen denselben Halteprozess (fracht.halt), denselben Posten (Sim, space.po, world.ruf),
// dasselbe Dock und dieselbe Werft; nur der Server schreibt (ein Befehl von einem Spieler ohne Ops und gefälschte Nachrichten ändern nichts); der Snapshot bleibt im Budget.
// Fixture am Server-Objekt: Rang, Ersatzteile und die Lage der Lerche (die Clients fliegen nicht); alles andere läuft über das Netz.
//   node tools/test-posten-ws.js   (Port PORT oder 0 = frei)   (npm run test:posten-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const WebSocket = require('ws');
const Sektoren = require('../shared/sektoren.js');
const Besitz = require('../server/sim/besitz.js');
const Locations = require('../shared/locations.js');
const { startServer } = require('../server/index.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'PST3';
const PW = require('../content/welt/posten-werte.json').werte;
const TEXTE = require('../content/flotte/posten.json');
const FREI = '0505';

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, snaps: [], sizes: [], funk: [], oda: [], ruf: null, rufSnaps: 0, halts: [] };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'snap') {
        c.snaps.push(m); c.sizes.push(Buffer.byteLength(s)); if (c.snaps.length > 5) c.snaps.shift();
        if (m.world && m.world.ruf) { c.ruf = m.world.ruf; c.rufSnaps++; }
        if (m.fracht && m.fracht.halt) c.halts.push(m.fracht.halt);
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') c.funk.push(m.text);
      if (m.t === 'event' && m.kind === 'oda') c.oda.push(m.text);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-posten-ws-'));
  const srv = await startServer({ port: process.env.PORT != null ? Number(process.env.PORT) : 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game; const port = srv.port;
  console.log(`Server auf Port ${port}`);
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
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

  // Ankunft im freien Hex, Ops besetzt
  g.inventory.ersatzteil = 4;
  a.send({ t: 'debug', cmd: 'hex', hex: FREI });
  await bis(() => g.ship.scene === Sektoren.ortVonHex(FREI), 2500); await sleep(300);
  a.send({ t: 'debug', cmd: 'sitz', console: 'weapons' });
  await sleep(300);
  const pl = Besitz.postenLage(Locations.get(Sektoren.ortVonHex(FREI)).scene);
  const stelle = () => { Object.assign(g.ship, { x: pl.x, y: pl.y, vx: 0, vy: 0, speed: 0 }); g.ship.helm.stage = 1; };
  stelle();
  await sleep(300);
  ok(alle((s) => s.space && s.space.po && s.space.po.k === 'g' && s.space.po.ok === 1), 'alle drei sehen space.po { k: g, ok: 1 } (Gründen möglich)');
  const ersatz0 = g.inventory.ersatzteil; const tick0 = g.weltsim.tickZahl;

  // Zuschauer und fremde Nachrichten ändern nichts
  b.send({ t: 'cmd', c: 'weapons.posten.gruenden' });   // B sitzt nicht an der Ops
  b.send({ t: 'cmd', c: 'posten.setzen', ort: FREI }); c.send({ t: 'posten', ort: FREI }); c.send({ t: 'debug', cmd: 'posten', ort: FREI });
  await sleep(500);
  ok(!(g.fracht && g.fracht.halt) && z().hexe[FREI].posten === false, 'ohne Ops-Sitz und mit gefälschten Nachrichten: kein Halteprozess, kein Posten (nur der Server schreibt)');

  // Gründen über das Netz
  a.send({ t: 'cmd', c: 'weapons.posten.gruenden' });
  await bis(() => g.fracht && g.fracht.halt && g.fracht.halt.kind === 'posten', 1500);
  await sleep(2500);
  ok(g.fracht.halt && g.fracht.halt.kind === 'posten', 'Halteprozess läuft (Server)');
  ok(alle((s) => s.fracht && s.fracht.halt && s.fracht.halt.kind === 'posten' && s.fracht.halt.id === 'gruenden' && s.fracht.halt.p > 0), 'alle drei sehen fracht.halt { kind: posten, id: gruenden, p } mit Fortschritt');
  b.send({ t: 'cmd', c: 'weapons.posten.gruenden' }); await sleep(200);
  ok(g.weltsim.zustand.hexe[FREI].posten === false && g.weltsim.tickZahl === tick0, 'während des Prozesses: noch nichts gebaut, kein Tick');
  messen();
  const fertig = await bis(() => z().hexe[FREI].posten === true, (PW.gruenden.wert.dauer + 4) * 1000);
  await sleep(600);
  ok(fertig && z().hexe[FREI].crew === true && z().hexe[FREI].besitzer === 'rom', 'Posten steht: Besitzer Rom, crew true');
  ok(g.weltsim.tickZahl === tick0 + 1, `genau ein Tick (${tick0} -> ${g.weltsim.tickZahl}), die Wirkung gilt einmal`);
  ok(g.inventory.ersatzteil === ersatz0 - PW.gruenden.wert.kosten.ersatzteil, 'Ersatzteile einmal abgebucht');
  ok(alle((s) => !(s.fracht && s.fracht.halt)) && alle((s) => !(s.space && s.space.po)), 'der Prozess ist bei allen weg, space.po verschwunden (Stützpunkt)');
  ok([a, b, c].every((x) => x.ruf && x.ruf.rom === require('../content/welt/ruf-werte.json').werte.quellen.wert.posten_gehisst.delta), 'world.ruf bei allen drei gleich: Rom +' + require('../content/welt/ruf-werte.json').werte.quellen.wert.posten_gehisst.delta);
  ok([a, b, c].every((x) => x.oda.some((t) => /gegründet/.test(t))), 'die Meldung „Posten … gegründet“ erreicht alle drei');
  ok(alle((s) => s.space && s.space.markers && s.space.markers.some((m) => m.kind === 'dock') && s.space.markers.some((m) => m.posten)), 'alle sehen Posten- und Dock-Marker');

  // Dock
  const dl = Besitz.dockLage(g, Locations.get(Sektoren.ortVonHex(FREI)).scene, FREI);
  Object.assign(g.ship, { x: dl.x, y: dl.y - 20, vx: 0, vy: 0, speed: 0 }); g.ship.dockArmed = true;
  await bis(() => g.ship.docked, 2000); await sleep(400);
  ok(alle((s) => s.ship && s.ship.docked === true && s.ship.dockedAt === 'brachland'), 'alle drei sehen: angedockt in brachland (Stützpunkt)');
  b.send({ t: 'debug', cmd: 'sitz', console: 'shop' }); await sleep(600);
  ok(alle((s) => s.werft && s.werft.aktiv === true && s.werft.hs === TEXTE.dock.handel), 'Werft aktiv und Handel gesperrt (werft.hs) bei allen drei');

  // ein Spieler geht, nichts bricht ab
  c.ws.close(); await sleep(400);
  ok(z().hexe[FREI].crew === true && g.ship.docked && g.errors === 0, 'ein Spieler trennt: Posten, Dock und Fehlerzähler unverändert');
  messen();
  ok(snapMax > 0 && snapMax <= 18944, `Snapshot während Gründen, Dock und Werft max ${snapMax} B (Ziel ≤ 18 944 B)`);
  ok(g.errors === 0, 'Server-Fehlerzähler 0 (' + g.errors + ')');

  try { a.ws.close(); b.ws.close(); } catch (e) { /* egal */ }
  await srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'POSTEN-WS OK'}`);
  process.exit(fails ? 1 : 0);
})();
