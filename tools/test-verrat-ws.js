'use strict';
// SUND-02b E (Abnahme Mehrspieler): Beschuss auf römische Verbündete (Verrat) am ECHTEN Server – drei WebSocket-Clients wie im Spiel (Lobby, Start, Debug-Ankunft, Kommandos, Snapshots).
// Ein Spieler sitzt an der Ops und löst aus, die beiden anderen sehen zu: alle drei sehen dieselbe Warnung (Funk, Szenenzeile flotte.sz.w, fracht.halt id verrat), dieselbe Umschaltung (flotte.sz.vt,
// keine Verbündeten mehr, Gegner), denselben Ruf (world.ruf); nur der Server schreibt (Befehl ohne Ops-Sitz und gefälschte Nachrichten ändern nichts); Abbruch kostet nichts; jeder kann springen;
// Tickzähler: der Beginn ist kein Tick, der Sieg genau einer; Snapshot im Budget.
// Fixture am Server-Objekt: Rang, römische Flotte im Hex und die Lage der Lerche (die Clients fliegen und schießen nicht); alles andere läuft über das Netz.
//   node tools/test-verrat-ws.js   (Port PORT oder 0 = frei)   (npm run test:verrat-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const WebSocket = require('ws');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');   // SYS-01 C1a-1: Gegner ohne Hülle, Abschuss über den Reaktor
const Szene = require('../server/sim/kriegslage-szene.js');
const { startServer } = require('../server/index.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'VRT3';
const VW = require('../content/welt/verrat-werte.json').werte;
const RUF = require('../content/welt/ruf-werte.json').werte;
const TEXTE = require('../content/flotte/verrat.json');
const HEX = '0505';

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, snaps: [], sizes: [], funk: [], oda: [], ruf: null, halts: [], szs: [], pos: [] };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'snap') {
        c.snaps.push(m); c.sizes.push(Buffer.byteLength(s)); if (c.snaps.length > 5) c.snaps.shift();
        if (m.world && m.world.ruf) c.ruf = m.world.ruf;
        if (m.fracht && m.fracht.halt) c.halts.push(m.fracht.halt);
        if (m.flotte && m.flotte.sz) c.szs.push(m.flotte.sz);
        if (m.space && m.space.po) c.pos.push(m.space.po);
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') c.funk.push(m.text);
      if (m.t === 'event' && m.kind === 'oda') c.oda.push(m.text);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}
const kill = (g, e) => Testhilfe.toeten(g, e);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-verrat-ws-'));
  const srv = await startServer({ port: process.env.PORT != null ? Number(process.env.PORT) : 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game; const port = srv.port;
  console.log(`Server auf Port ${port}`);
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  VW.anlauf.wert.dauer = 3;   // kurz: der Server läuft in Echtzeit (die Daten sind dieselben Objekte im selben Prozess)
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
  g.weltsim.ruf.rom = 50;

  // Ankunft im freien Hex, Ops besetzt, römische Flotte und germanische Flotte im Hex (Szene über Debug wie im Spiel)
  z().flotten = z().flotten.filter((f) => f.ort !== HEX);
  a.send({ t: 'debug', cmd: 'hex', hex: HEX });
  await bis(() => g.ship.scene === Sektoren.ortVonHex(HEX), 2500); await sleep(300);
  a.send({ t: 'debug', cmd: 'sitz', console: 'weapons' });
  await sleep(300);
  const rfl = { id: z().naechsteId++, fraktion: 'rom', heimat: '0405', ort: HEX, staerke: 6, kap: 6, befehl: 'rueckzug', ziel: '0405', warte: 0, versorgung: 1, angriff: null };
  z().flotten.push(rfl);
  a.send({ t: 'debug', cmd: 'szene', args: ['6', 'ger'] });
  await bis(() => g.simSzene, 2500); await sleep(400);
  ok(g.simSzene && !g.simSzene.modus && (g.space.escorts || []).some((q) => q.ally && q.sim === g.simSzene.id), 'Sim-Szene läuft, römische Verbündete in der Szene');
  ok(alle((s) => s.space && s.space.po && s.space.po.k === 'v' && s.space.po.ok === 1), 'alle drei sehen space.po { k: v, ok: 1 } (Verrat möglich, nur Knopf)');
  ok(alle((s) => s.flotte && s.flotte.sz && s.flotte.sz.vt === undefined && s.flotte.sz.w === undefined), 'Szenenzeile ohne Warnung und ohne vt');
  const tick0 = g.weltsim.tickZahl; const ruf0 = g.weltsim.ruf.rom;
  const allies0 = (g.space.escorts || []).filter((q) => q.ally).length;

  // Zuschauer und fremde Nachrichten ändern nichts
  b.send({ t: 'cmd', c: 'weapons.verrat.beginnen' });   // B sitzt nicht an der Ops
  b.send({ t: 'cmd', c: 'verrat', ort: HEX }); c.send({ t: 'verrat' }); c.send({ t: 'debug', cmd: 'verrat', ort: HEX });
  await sleep(500);
  ok(!(g.fracht && g.fracht.halt) && g.simSzene.modus === undefined && g.weltsim.ruf.rom === ruf0, 'ohne Ops-Sitz und mit gefälschten Nachrichten: kein Anlauf, kein Verrat, Ruf unverändert (nur der Server schreibt)');

  // Anlauf über das Netz: alle sehen die Warnung
  a.send({ t: 'cmd', c: 'weapons.verrat.beginnen' }); await sleep(300);
  ok(!(g.fracht && g.fracht.halt) && alle((s) => s.space && s.space.po && s.space.po.b > 0), 'erster Druck: nur Anfrage, kein Anlauf, alle sehen space.po.b (Bestätigung offen)');
  a.send({ t: 'cmd', c: 'weapons.verrat.beginnen' });
  await bis(() => g.fracht && g.fracht.halt && g.fracht.halt.id === 'verrat', 1500);
  await sleep(1000);
  ok(alle((s) => s.fracht && s.fracht.halt && s.fracht.halt.kind === 'posten' && s.fracht.halt.id === 'verrat' && s.fracht.halt.p > 0), 'alle drei sehen fracht.halt { kind: posten, id: verrat, p } mit Fortschritt');
  ok(alle((s) => s.flotte && s.flotte.sz && Array.isArray(s.flotte.sz.w) && s.flotte.sz.w[1] === 3), 'alle drei sehen die Warnung in der Szenenzeile (flotte.sz.w = [Rest, 3])');
  ok([a, b, c].every((x) => x.funk.some((t) => /bereitet den Angriff auf die römischen Schiffe vor/.test(t) && /Hochverrat/.test(t))), 'der Funk-Warntext erreicht alle drei');
  ok(g.weltsim.tickZahl === tick0 && g.weltsim.ruf.rom === ruf0 && g.simSzene.modus === undefined, 'während des Anlaufs: kein Tick, kein Ruf-Abzug, Szene unverändert');

  // Abbruch kostet nichts (anderer Spieler am Pult könnte auch: hier der Spieler an der Ops)
  a.send({ t: 'cmd', c: 'weapons.fracht', off: true });
  await sleep(500);
  ok(!(g.fracht && g.fracht.halt) && g.weltsim.ruf.rom === ruf0 && g.simSzene.modus === undefined && g.weltsim.tickZahl === tick0, 'Abbruch: Halteprozess weg, Ruf unverändert, Szene unverändert, kein Tick');
  ok([a, b, c].every((x) => x.oda.some((t) => t === TEXTE.abbruch.abgebrochen)), 'alle lesen „… abgebrochen. Nichts ist geschehen.“');
  ok(alle((s) => s.flotte && s.flotte.sz && s.flotte.sz.w === undefined), 'die Warnzeile ist bei allen weg');

  // zweiter Anlauf bis zum Ende
  a.send({ t: 'cmd', c: 'weapons.verrat.beginnen' }); await sleep(200); a.send({ t: 'cmd', c: 'weapons.verrat.beginnen' });
  await bis(() => g.simSzene && g.simSzene.modus === 'verrat', 6000); await sleep(600);
  ok(g.simSzene && g.simSzene.modus === 'verrat' && g.weltsim.tickZahl === tick0, 'Verrat läuft, der Beginn ist kein Tick');
  const abzug = RUF.quellen.wert.verrat_beginn.delta;
  ok(g.weltsim.ruf.rom === ruf0 + abzug, `Ruf Rom ${ruf0} -> ${g.weltsim.ruf.rom} (${abzug}), genau einmal`);
  ok([a, b, c].every((x) => x.ruf && x.ruf.rom === ruf0 + abzug), 'world.ruf bei allen drei gleich');
  ok(alle((s) => s.flotte && s.flotte.sz && s.flotte.sz.vt === 1 && s.flotte.sz.p === 'k' && s.flotte.sz.w === undefined), 'alle drei sehen flotte.sz mit vt 1 (VERRAT)');
  ok(alle((s) => !(s.fracht && s.fracht.halt)) && alle((s) => !(s.space && s.space.po)), 'Anlauf und Knopf sind bei allen weg');
  ok((g.space.escorts || []).filter((q) => q.ally).length === 0 && g.space.enemies.some((e) => e.verratS) && allies0 > 0, 'keine Verbündeten mehr, ehemalige Verbündete als Gegner (Server)');
  ok([a, b, c].every((x) => x.funk.some((t) => /eröffnet das Feuer auf die römischen Schiffe/.test(t))), 'der Funk „… eröffnet das Feuer auf die römischen Schiffe …“ erreicht alle drei');
  const sz = snap(a).flotte.sz; ok(g.space.enemies.length > 0 && sz.g > 0, 'alle sehen dieselbe Szene: Gegner in der Szenenzeile (g ' + sz.g + ')');
  messen();

  // ein Spieler trennt sich mitten im Verrat: nichts bricht ab
  const S = g.simSzene;
  c.ws.close(); await sleep(500);
  ok(g.simSzene === S && g.players.filter((q) => q.connected).length === 2, 'ein Spieler trennt: die Szene läuft weiter (hängt am Schiff)');

  // Sieg
  for (let i = 0; i < 600 && g.simSzene; i++) { for (const e of g.space.enemies.filter((x) => x.verratS)) kill(g, e); await sleep(100); }
  await bis(() => !g.simSzene, 3000); await sleep(600);
  const L = Szene.letzte(g);
  ok(!g.simSzene && L && L.ausgang === 'sieg' && L.verrat === true, 'Sieg im Verrat');
  ok(g.weltsim.tickZahl === tick0 + 1, `genau ein Tick (${tick0} -> ${g.weltsim.tickZahl}), die Wirkungen gelten einmal`);
  const ab2 = RUF.quellen.wert.verrat_flotte_vernichtet.delta;
  ok(g.weltsim.ruf.rom === ruf0 + abzug + ab2, `Ruf Rom nur Abzug (${ruf0} -> ${g.weltsim.ruf.rom})`);
  ok([a, b].every((x) => x.ruf && x.ruf.rom === g.weltsim.ruf.rom), 'world.ruf bei beiden verbliebenen gleich');
  ok([a, b].every((x) => x.szs.some((s) => s.p === 's' && s.vt === 1)), 'beide sahen die Ergebniszeile (Sieg, vt 1)');
  ok([a, b].every((x) => x.funk.some((t) => t === TEXTE.sieg)), 'der Funk „Die römischen Schiffe sind vernichtet“ erreicht beide');
  const rf = z().flotten.find((f) => f.id === rfl.id); ok(rf && rf.staerke > 0 && rf.staerke < 6, 'römische Flotte geschwächt, nicht vernichtet (' + (rf && rf.staerke) + ')');
  ok(g.weltsim.verrat && g.weltsim.verrat.n === 1 && g.weltsim.verrat.hex === HEX, 'Gedächtnis auf dem Server');
  messen();
  ok(snapMax > 0 && snapMax <= 18944, `Snapshot während Anlauf, Szene und Ergebnis max ${snapMax} B (Ziel ≤ 18 944 B)`);
  ok(g.errors === 0, 'Server-Fehlerzähler 0 (' + g.errors + ')');

  try { a.ws.close(); b.ws.close(); } catch (e) { /* egal */ }
  await srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'VERRAT-WS OK'}`);
  process.exit(fails ? 1 : 0);
})();
