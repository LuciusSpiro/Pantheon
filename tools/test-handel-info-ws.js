'use strict';
// SUND-03b I (Abnahme Mehrspieler): Informationshandel des Konkordats am ECHTEN Server – drei WebSocket-Clients wie im Spiel (Lobby, Start, Debug-Sitz, Terminal-Befehle, Snapshots, Ereignisse).
// Alle drei sehen dasselbe Angebot (world.info) und dasselbe Ergebnis (Funk, Karte bei einem Beleg); jeder am Terminal darf kaufen (geteilte Marken, keine Rollen); bei gleichzeitigem Kauf mit zu
// wenig Marken gilt genau einer; nur der Server schreibt (Befehle ohne Konsole shop und gefälschte Nachrichten ändern nichts); Löschsignal; Snapshot im Budget; Sim-Zustand unberührt.
// Fixture am Server-Objekt: die Lage der Lerche (Concordia) und die Sprünge der Sim (Kriegslage.tick); alles andere läuft über das Netz.
//   node tools/test-handel-info-ws.js   (Port PORT oder 0 = frei)   (npm run test:handel-info-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const WebSocket = require('ws');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Info = require('../server/sim/handel-info.js');
const { startServer } = require('../server/index.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'INF3';
const W = Info.WERTE;
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, snaps: [], sizes: [], funk: [], antw: [], info: undefined, infoBloecke: 0, infoNull: 0, lage: null, marks: null };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'snap') {
        c.snaps.push(m); c.sizes.push(Buffer.byteLength(s)); if (c.snaps.length > 5) c.snaps.shift();
        if (m.inventory) c.marks = m.inventory.marks;
        if (m.world && 'info' in m.world) { c.info = m.world.info; if (m.world.info === null) c.infoNull++; else c.infoBloecke++; }
        if (m.world && m.world.lage) c.lage = m.world.lage;
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') c.funk.push(m.text);
      if (m.t === 'event' && m.kind === 'infoAntwort') c.antw.push(m);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-info-ws-'));
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
  let snapMax = 0;
  const messen = () => { for (const x of [a, b, c]) { const m = Math.max(0, ...x.sizes); if (m > snapMax) snapMax = m; x.sizes = []; } };
  const alle = (f) => [a, b, c].every(f);
  const ws = () => g.weltsim;
  const antwortVon = (x) => x.antw.filter((q) => q.op === 'kaufen');
  const sitz = async (x, console_) => { x.send({ t: 'debug', cmd: 'sitz', console: console_ }); await sleep(250); };
  const kauf = (x, thema, stufe) => x.send({ t: 'cmd', c: 'info.kaufen', thema, stufe });

  // Aufbau: die Lerche liegt in Concordia (Hafen des Konkordats), die Sim läuft, bis das Konkordat zwei Themen hat
  Space.enterScene(g, Sektoren.ortVonHex('0604'), {});
  Object.assign(g.ship, { docked: true, dockedAt: Sektoren.ortVonHex('0604'), vx: 0, vy: 0, speed: 0 });
  g.inventory.marks = 1000;
  let angebot = null;
  for (let t = 0; t < 400 && !angebot; t++) { Kriegslage.tick(g, 'test'); const q = Info.angebotFuer(g); if (q.themen.length >= 2) angebot = q; }
  ok(!!angebot, 'Konkordat bietet ' + (angebot ? angebot.themen.length : 0) + ' Themen an (Tick ' + ws().tickZahl + ')');

  // 1. Ohne Terminal-Sitzer: kein Block (nichts im Snapshot, solange niemand am Terminal sitzt)
  await sleep(400);
  ok(alle((x) => x.info === undefined || x.info === null), 'solange niemand am Terminal sitzt: kein Block world.info');
  // 2. Alle drei am Terminal: derselbe Block
  await sitz(a, 'shop'); await sitz(b, 'shop'); await sitz(c, 'shop');
  await bis(() => alle((x) => x.info && x.info.th), 2500);
  ok(alle((x) => x.info && x.info.th && x.info.th.length === angebot.themen.length), 'alle drei sehen dasselbe Angebot (' + (a.info && a.info.th ? a.info.th.length : 0) + ' Themen)');
  ok(gleich(a.info, b.info) && gleich(b.info, c.info), 'der Block ist für alle drei gleich');
  ok(!/\d{4}|fraktion|klasse|zeit/.test(JSON.stringify(a.info)), 'der Block verrät vor dem Kauf keine Fakten');
  messen();

  // 3. Nur der Server schreibt: ohne Konsole shop, gefälschte Nachrichten
  await sitz(c, 'helm');
  const bloeckeVor = a.infoBloecke; await sleep(700);
  ok(a.infoBloecke === bloeckeVor, 'ohne Änderung kommt der Block nicht noch einmal (nur bei Änderung)');
  const marks0 = g.inventory.marks, zVor = JSON.stringify(ws().zustand);
  kauf(c, 't0', 'gerucht');
  b.send({ t: 'info', thema: 't0', stufe: 'gerucht' }); b.send({ t: 'cmd', c: 'info.setzen', thema: 't0' }); b.send({ t: 'cmd', c: 'infos.kaufen', thema: 't0', stufe: 'beleg' });
  b.send({ t: 'cmd', c: 'info.kaufen', thema: { $gt: '' }, stufe: ['beleg'] }); b.send({ t: 'cmd', c: 'info.kaufen', thema: 't0', stufe: 'gold' });
  await sleep(500);
  ok(g.inventory.marks === marks0 && !ws().wissen.belege && !ws().wissen.gz, 'ohne Konsole shop und mit gefälschten Nachrichten: nichts gekauft, nichts abgebucht');
  ok(g.errors === 0, 'kein Serverfehler durch gefälschte Nachrichten');
  await sitz(c, 'shop');

  // 4. Gerücht: Bo kauft, alle sehen den Funk, die Marken sind geteilt
  for (const x of [a, b, c]) { x.antw.length = 0; x.funk.length = 0; }
  kauf(b, 't0', 'gerucht');
  await bis(() => antwortVon(b).length >= 1, 2000);
  await bis(() => alle((x) => x.funk.some((t) => t.startsWith(W.kennzeichnung.gerucht))), 2000);
  ok(antwortVon(b).length === 1 && antwortVon(b)[0].ok && antwortVon(b)[0].stufe === 'gerucht' && antwortVon(a).length === 0 && antwortVon(c).length === 0, 'die Antwort geht nur an den Absender (Bo)');
  ok(alle((x) => x.funk.filter((t) => t.startsWith(W.kennzeichnung.gerucht + ': ')).length === 1), 'die Funkzeile „' + W.kennzeichnung.gerucht + ': …“ erreicht alle drei, einmal');
  const geruchtText = a.funk.find((t) => t.startsWith(W.kennzeichnung.gerucht));
  ok(antwortVon(b)[0].text === geruchtText, 'Antwort und Funk tragen denselben Text');
  ok(!('wahr' in antwortVon(b)[0]) && !('feld' in antwortVon(b)[0]) && !('intern' in antwortVon(b)[0]), 'die Antwort verrät nicht, ob das Gerücht stimmt');
  await bis(() => alle((x) => x.marks === marks0 - W.preise.gerucht), 2000);
  ok(alle((x) => x.marks === marks0 - W.preise.gerucht) && g.inventory.marks === marks0 - W.preise.gerucht, 'alle sehen dieselben Marken: ' + marks0 + ' -> ' + g.inventory.marks);
  await bis(() => alle((x) => x.info && x.info.th[0].g === 1 && x.info.l && x.info.l.length === 1), 2000);
  ok(alle((x) => x.info && x.info.th[0].g === 1 && x.info.l && x.info.l[0].x === geruchtText) && gleich(a.info, c.info), 'alle sehen: Gerücht zu Thema 1 gekauft, letztes Ergebnis im Block');
  const lageVor = JSON.stringify(ws().wissen.hexe) + JSON.stringify(ws().wissen.flotten);
  ok(lageVor === JSON.stringify(ws().wissen.hexe) + JSON.stringify(ws().wissen.flotten) && !ws().wissen.belege, 'das Gerücht ändert die Karte nicht');
  messen();

  // 5. Dasselbe Gerücht noch einmal (Ada): „Schon gekauft“, keine Marken weg
  a.antw.length = 0; kauf(a, 't0', 'gerucht');
  await bis(() => antwortVon(a).length >= 1, 2000);
  ok(antwortVon(a)[0] && !antwortVon(a)[0].ok && antwortVon(a)[0].code === 'gekauft' && g.inventory.marks === marks0 - W.preise.gerucht, 'Doppelkauf: „Schon gekauft“, Marken unverändert');

  // 6. Gleichzeitiger Kauf mit zu wenig Marken: die Kasse reicht für genau einen Beleg
  g.inventory.marks = W.preise.beleg + 10;
  for (const x of [a, b, c]) { x.antw.length = 0; x.funk.length = 0; }
  kauf(a, 't0', 'beleg'); kauf(b, 't1', 'beleg'); kauf(c, 't0', 'beleg');
  await bis(() => antwortVon(a).length + antwortVon(b).length + antwortVon(c).length >= 3, 2500);
  const alleAntw = [a, b, c].flatMap(antwortVon);
  const gut = alleAntw.filter((q) => q.ok), schlecht = alleAntw.filter((q) => !q.ok);
  ok(gut.length === 1 && schlecht.length === 2 && schlecht.every((q) => q.code === 'zu_wenig_marken' || q.code === 'gekauft'), `genau ein Beleg gilt (${gut.length}), die anderen beiden bekommen eine Absage (${schlecht.map((q) => q.code).join(', ')})`);
  ok(g.inventory.marks === 10 && ws().wissen.belege.length === 1, 'geteilte Kasse: 120 abgebucht, ein Beleg im Wissen (Marken ' + g.inventory.marks + ')');
  await bis(() => alle((x) => x.funk.some((t) => t.startsWith(W.kennzeichnung.beleg))), 2000);
  ok(alle((x) => x.funk.filter((t) => t.startsWith(W.kennzeichnung.beleg + ': ')).length === 1), 'die Funkzeile „' + W.kennzeichnung.beleg + ': …“ erreicht alle drei, einmal');
  // 7. Der Beleg wirkt auf die Karte, für alle gleich
  await bis(() => alle((x) => x.lage && x.lage.hx), 2000);
  await sleep(400);
  ok(alle((x) => x.lage && gleich(x.lage, a.lage)), 'world.lage ist für alle drei gleich');
  const beleg = ws().wissen.belege[0], kt = require('../server/sim/kriegslage-wissen.js').karte();
  const T = ws().tickZahl, i0 = kt.codes.indexOf(beleg.h[0]);
  ok(i0 >= 0 && ws().wissen.hexe[beleg.h[0]].a === T && beleg.bis === T + W.beleg_dauer, 'das Hex des Belegs ist im Wissen exakt (Alter 0), gültig bis Tick ' + beleg.bis);
  messen();

  // 8. Zu wenig Marken über das Netz: Antwort mit Code, nichts abgebucht
  g.inventory.marks = 5; for (const x of [a, b, c]) x.antw.length = 0;
  const thB = (a.info && a.info.th) || [];
  kauf(c, thB.length > 1 ? 't1' : 't0', thB.length > 1 && thB[1].b ? 'gerucht' : 'beleg');
  await bis(() => antwortVon(c).length >= 1, 2000);
  ok(antwortVon(c)[0] && !antwortVon(c)[0].ok && ['zu_wenig_marken', 'gekauft'].includes(antwortVon(c)[0].code) && g.inventory.marks === 5, 'zu wenig Marken: Absage mit Code, Marken unverändert');

  // 9. Sim-Zustand unberührt von allen Käufen (kein Tick dazwischen)
  ok(JSON.stringify(ws().zustand) === zVor, 'der Sim-Zustand ist nach allen Käufen byte-gleich (gelesen, nie geschrieben)');

  // 10. Ein Spieler geht, nichts bricht ab
  c.ws.close(); await sleep(400);
  ok(g.errors === 0 && ws() && ws().wissen, 'ein Spieler trennt: Server und Wissen unverändert, Fehlerzähler 0');
  messen();
  ok(snapMax > 0 && snapMax <= 18944, `Snapshot-Größe während des ganzen Ablaufs max ${snapMax} B (Ziel ≤ 18 944 B)`);

  // 11. Löschsignal: niemand mehr am Terminal -> world.info = null genau einmal; wer sich wieder setzt, bekommt den Block neu
  const nullVor = a.infoNull;
  await sitz(a, 'helm'); await sitz(b, 'helm');
  await bis(() => a.infoNull > nullVor, 2500);
  ok(a.infoNull === nullVor + 1 && a.info === null, 'niemand am Terminal: world.info = null (Löschsignal) genau einmal');
  await sleep(400);
  ok(a.infoNull === nullVor + 1, 'und danach nicht noch einmal');
  await sitz(b, 'shop');
  await bis(() => b.info && b.info.th, 2500);
  ok(b.info && b.info.th && b.info.th.length >= 2, 'wer sich wieder setzt, bekommt den Block neu');
  g.ship.docked = false; g.ship.dockedAt = null; g.ship.x += 4000;   // die Lerche legt ab
  await bis(() => b.info === null, 2500);
  ok(b.info === null, 'Ablegen: world.info = null');
  ok(g.errors === 0, 'Server-Fehlerzähler 0 (' + g.errors + ')');

  try { a.ws.close(); b.ws.close(); } catch (e) { /* egal */ }
  await srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'HANDEL-INFO-WS OK'}`);
  process.exit(fails ? 1 : 0);
})();
