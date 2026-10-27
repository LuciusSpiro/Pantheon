'use strict';
// SUND-04a-3 (Mehrspieler): Finale-Kern am ECHTEN Server – drei WebSocket-Clients wie im Spiel (Lobby, Start, Debug-Rang, Terminal-Befehle, Snapshots, Ereignisse).
// Alle drei sehen dasselbe Angebot (world.finale, Lagefunk), jeder am Terminal darf anfragen und bestätigen (keine Rollen), die erste Bestätigung gilt, die anderen bekommen „läuft schon“;
// nur der Server schreibt (Befehle ohne Konsole shop und gefälschte Nachrichten ändern nichts); Ablehnen und Ignorieren ändern den Ruf nie; ein fehlender Spieler verpasst nichts;
// Orbit-Niederlage = Neubeginn ohne Game Over, Boden-Sieg = Hrafnheim römisch in einem Tick, das Löschsignal kommt einmal, der Snapshot bleibt im Budget. Szene, Boden und Abspann sind Stubs.
//   node tools/test-finale-ws.js   (Port PORT oder 0 = frei)   (npm run test:finale-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Finale = require('../server/sim/finale.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'FIN3';
const DATEN = require('../content/welt/finale-werte.json');
const W = DATEN.werte, T = DATEN.texte;
const ZIEL = W.ziel.wert;
const TRIBUN = require('../content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === W.mindestrang.wert).ab;
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, sizes: [], funk: [], antw: [], finale: undefined, bloecke: 0, nullen: 0, ruf: null };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'snap') {
        c.sizes.push(Buffer.byteLength(s));
        if (m.world && 'finale' in m.world) { c.finale = m.world.finale; if (m.world.finale === null) c.nullen++; else c.bloecke++; }
        if (m.world && m.world.ruf) c.ruf = m.world.ruf;
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') c.funk.push(m.text);
      if (m.t === 'event' && m.kind === 'finaleAntwort') c.antw.push(m);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-finale-ws-'));
  const szenen = []; const abspanne = [];
  Finale.ersetzen('szene', { finaleStarten: (game, a) => { szenen.push(a); return { id: 1 }; } });
  Finale.ersetzen('boden', { bodenStarten: () => true });
  Finale.ersetzen('abspann', { beenden: (game, art) => { abspanne.push(art); return true; } });
  const srv = await startServer({ port: process.env.PORT != null ? Number(process.env.PORT) : 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game; const port = srv.port;
  console.log(`Server auf Port ${port}`);
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
  const z = () => g.weltsim.zustand;
  const tick = () => Kriegslage.tick(g, 'test');
  const sitz = async (x, console_) => { x.send({ t: 'debug', cmd: 'sitz', console: console_ }); await sleep(250); };
  const letzte = (x, op) => x.antw.filter((q) => q.op === op).slice(-1)[0];

  // 1. Vor Tribun: kein Block, kein Angebot
  tick(); tick(); await sleep(400);
  ok(alle((x) => x.finale === undefined) && !ws().finale.angebot && !a.funk.some((t) => t === T.funk.angebot), 'vor Tribun: kein world.finale, kein Angebot, kein Funk');

  // 2. Rang per Debug, ein Tick -> Angebot
  await sitz(a, 'shop'); await sitz(b, 'shop'); await sitz(c, 'shop');
  ok(g.players.every((p) => p.console === 'shop'), 'alle drei sitzen am Terminal (jeder darf, keine Rolle)');
  a.send({ t: 'debug', cmd: 'ruf', args: 'rom ' + TRIBUN });
  await sleep(300);
  tick();
  await bis(() => alle((x) => x.finale && x.finale.angebot), 3000);
  ok(alle((x) => x.finale && x.finale.frei === 1 && x.finale.angebot === 1 && x.finale.name === T.anzeige.name && x.finale.anfrage === undefined && x.finale.phase === undefined), 'ab Tribun: alle drei sehen dasselbe Angebot');
  ok(gleich(a.finale, b.finale) && gleich(b.finale, c.finale), 'der Block ist für alle drei gleich');
  ok(alle((x) => x.funk.some((t) => t === T.funk.angebot)), 'der Lagefunk mit der Gefahrenankündigung erreicht alle drei');
  const rufVor = JSON.stringify(a.ruf), rufServer = JSON.stringify(ws().ruf);
  messen();

  // 3. Nur der Server schreibt: ohne Konsole und gefälschte Nachrichten
  await sitz(c, 'helm');
  c.send({ t: 'cmd', c: 'finale.waehlen' });
  b.send({ t: 'finale', start: 1 }); b.send({ t: 'cmd', c: 'finale.start' }); b.send({ t: 'lobbyOpt', finale: 'orbit' }); b.send({ t: 'cmd', c: 'finale.phase', phase: 'ende' });
  await sleep(500);
  ok(!ws().finale.anfrage && Finale.phase(g) === null && szenen.length === 0, 'ohne Konsole shop und mit gefälschten Nachrichten: keine Anfrage, nichts gestartet');
  ok(g.errors === 0, 'kein Serverfehler durch gefälschte Nachrichten');
  await sitz(c, 'shop');

  // 4. Zweistufig: Bestätigen ohne Anfrage, Anfrage, Bestätigung
  for (const x of [a, b, c]) x.antw.length = 0;
  b.send({ t: 'cmd', c: 'finale.bestaetigen' });
  await bis(() => b.antw.length >= 1, 2000);
  ok(letzte(b, 'bestaetigen') && letzte(b, 'bestaetigen').ok === false && letzte(b, 'bestaetigen').code === 'keine_anfrage' && Finale.phase(g) === null, 'Bestätigen ohne Anfrage: abgewiesen, nichts gestartet');
  c.send({ t: 'cmd', c: 'finale.waehlen' });
  await bis(() => alle((x) => x.finale && x.finale.anfrage), 3000);
  ok(letzte(c, 'waehlen') && letzte(c, 'waehlen').ok === true && Finale.phase(g) === null && szenen.length === 0, 'Cem stellt die Anfrage: noch nichts gestartet');
  ok(alle((x) => x.finale.anfrage === W.bestaetigung.wert.fenster && x.finale.angebot === 1), 'alle drei sehen die offene Anfrage mit der Frist');
  ok(alle((x) => x.funk.some((t) => /Bestätigt innerhalb von \d+ Sekunden/.test(t) && /gefährlich/i.test(t))), 'der Funk kündigt Gefahr und Frist allen an');
  // Gleichzeitige Bestätigung: genau eine gilt
  for (const x of [a, b, c]) x.antw.length = 0;
  b.send({ t: 'cmd', c: 'finale.bestaetigen' }); a.send({ t: 'cmd', c: 'finale.bestaetigen' }); c.send({ t: 'cmd', c: 'finale.bestaetigen' });
  await bis(() => alle((x) => letzte(x, 'bestaetigen')), 3000);
  const oks = [a, b, c].filter((x) => letzte(x, 'bestaetigen').ok);
  const nein = [a, b, c].filter((x) => !letzte(x, 'bestaetigen').ok);
  ok(oks.length === 1 && nein.length === 2 && nein.every((x) => letzte(x, 'bestaetigen').code === 'laeuft'), 'genau eine Bestätigung gilt, die anderen bekommen „läuft schon“');
  ok(Finale.phase(g) === 'orbit' && szenen.length === 1 && szenen[0].hex === ZIEL.hex, 'das Finale läuft: phase orbit, Szene genau einmal für Hrafnheim gebaut');
  await bis(() => alle((x) => x.finale && x.finale.phase === 'orbit'), 3000);
  ok(alle((x) => x.finale.phase === 'orbit' && x.finale.angebot === undefined && x.finale.anfrage === undefined) && gleich(a.finale, b.finale) && gleich(b.finale, c.finale), 'alle drei sehen phase orbit, den gleichen Block');
  ok(alle((x) => x.funk.some((t) => t === T.funk.start)), 'Funk zum Start erreicht alle drei');
  ok(JSON.stringify(ws().ruf) === rufServer && JSON.stringify(a.ruf) === rufVor, 'das Finale ändert den Ruf nicht');
  messen();

  // 5. Ein Spieler fehlt: nichts bricht ab, das Finale läuft für die Crew weiter
  c.ws.close(); await sleep(400);
  ok(g.errors === 0 && Finale.phase(g) === 'orbit', 'ein Spieler trennt: das Finale läuft weiter, Fehlerzähler 0');

  // 6. Orbit-Niederlage: Neubeginn, kein Game Over, Angebot wieder da
  const tk = ws().tickZahl;
  Finale.orbitEnde(g, 'niederlage');
  await bis(() => a.finale && a.finale.angebot === 1 && a.finale.phase === undefined, 3000);
  ok(g.phase === 'play' && Finale.phase(g) === null && ws().tickZahl === tk, 'Orbit-Niederlage: kein Game Over, phase null, kein Sim-Tick');
  ok(a.finale && a.finale.angebot === 1 && a.finale.phase === undefined && b.finale.angebot === 1, 'die Anzeige: Angebot wieder da, keine Phase');
  ok(a.funk.some((t) => t === T.funk.orbit_niederlage), 'Funk: Niederlage, es geht von vorn los');
  messen();

  // 7. Zweiter Versuch bis zum Sieg
  a.send({ t: 'cmd', c: 'finale.waehlen' }); await bis(() => a.finale && a.finale.anfrage, 2000);
  b.send({ t: 'cmd', c: 'finale.bestaetigen' }); await bis(() => Finale.phase(g) === 'orbit', 2000);
  ok(Finale.phase(g) === 'orbit' && szenen.length === 2, 'zweiter Versuch: Bo bestätigt, das Finale beginnt erneut');
  Finale.orbitEnde(g, 'sieg');
  ok(Finale.phase(g) === 'boden' && ws().tickZahl === tk, 'Orbit-Sieg: phase boden, kein Sim-Tick');
  ok(z().hexe[ZIEL.hex].besitzer === 'ger', 'Hrafnheim ist noch germanisch');
  Finale.bodenEnde(g, 'sieg');
  await bis(() => a.finale && a.finale.phase === 'ende', 3000);
  ok(Finale.phase(g) === 'ende' && z().hexe[ZIEL.hex].besitzer === 'rom' && ws().tickZahl === tk + 1, 'Boden-Sieg: Hrafnheim römisch, genau ein Sim-Tick');
  ok(gleich(abspanne, ['sieg']), 'Abspann sieg genau einmal angestoßen');
  ok(a.finale.phase === 'ende' && b.finale.phase === 'ende', 'die Anzeige zeigt phase ende');
  ok(a.funk.some((t) => t === T.funk.sieg) && g.errors === 0, 'Funk zum Sieg, Fehlerzähler 0');
  messen();
  ok(snapMax > 0 && snapMax <= 18944, `Snapshot-Größe während des ganzen Ablaufs max ${snapMax} B (Ziel ≤ 18 944 B)`);

  // 8. Löschsignal: der Modus endet
  const nullVor = a.nullen;
  const merk = g.weltsim; g.weltsim = null;
  await bis(() => a.nullen > nullVor, 2000);
  ok(a.nullen === nullVor + 1 && a.finale === null, 'Modus endet: world.finale = null (Löschsignal) genau einmal');
  await sleep(400);
  ok(a.nullen === nullVor + 1, 'und danach nicht noch einmal');
  g.weltsim = merk;
  ok(g.errors === 0, 'Server-Fehlerzähler 0 (' + g.errors + ')');

  Finale.ersetzen('szene', null); Finale.ersetzen('boden', null); Finale.ersetzen('abspann', null);
  try { a.ws.close(); b.ws.close(); } catch (e) { /* egal */ }
  await srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'FINALE-WS OK'}`);
  process.exit(fails ? 1 : 0);
})();
