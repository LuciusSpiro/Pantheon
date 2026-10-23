'use strict';
// SUND-02b D (Abnahme Mehrspieler): Strategische Optionen am ECHTEN Server – drei WebSocket-Clients wie im Spiel (Lobby, Start, Debug-Rang, Terminal-Befehle, Snapshots, Ereignisse).
// Alle drei sehen dasselbe Angebot (world.absicht, Lagefunk), jeder am Terminal darf wählen (keine Rollen), bei gleichzeitigen Wahlen gilt genau eine (die erste), die anderen bekommen
// „schon gewählt“; nur der Server schreibt (Befehle ohne Konsole shop und gefälschte Nachrichten ändern nichts); Ablehnen und Ignorieren ändern den Ruf nie; die Absicht läuft ab und räumt
// zustand.absichten.rom; das Löschsignal kommt einmal; der Snapshot bleibt im Budget. Fixture am Server-Objekt: nur Rang-Tick (Kriegslage.tick wie der Sprung), alles andere über das Netz.
//   node tools/test-absichten-ws.js   (Port PORT oder 0 = frei)   (npm run test:absichten-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Kriegslage = require('../server/sim/kriegslage.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'ABS3';
const W = require('../content/welt/absichten.json').werte;
const TEXTE = require('../content/flotte/absichten.json');
const KAT = W.absichten.wert;
const TRIBUN = require('../content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === W.mindestrang.wert).ab;
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, snaps: [], sizes: [], funk: [], antw: [], absicht: undefined, absichtBloecke: 0, absichtNull: 0, ruf: null };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'snap') {
        c.snaps.push(m); c.sizes.push(Buffer.byteLength(s)); if (c.snaps.length > 5) c.snaps.shift();
        if (m.world && 'absicht' in m.world) { c.absicht = m.world.absicht; if (m.world.absicht === null) c.absichtNull++; else c.absichtBloecke++; }
        if (m.world && m.world.ruf) c.ruf = m.world.ruf;
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') c.funk.push(m.text);
      if (m.t === 'event' && m.kind === 'absichtAntwort') c.antw.push(m);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-absichten-ws-'));
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
  const antwortVon = (x, op) => x.antw.filter((q) => q.op === op);
  const sitz = async (x, console_) => { x.send({ t: 'debug', cmd: 'sitz', console: console_ }); await sleep(250); };

  // 1. Vor Tribun: der Hinweis, kein Angebot
  await bis(() => alle((x) => x.absicht && x.absicht.frei === 0), 2000);
  ok(alle((x) => x.absicht && x.absicht.frei === 0 && x.absicht.ab === 'Tribun' && x.absicht.angebot === undefined), 'vor Tribun: alle drei sehen world.absicht { frei: 0, ab: Tribun }, ohne Angebot');
  tick(); tick(); await sleep(300);
  ok(ws().absicht.angebot === null && !a.funk.some((t) => /bietet Euch/.test(t)), 'zwei Ticks vor Tribun: kein Angebot, kein Funk');
  // 2. Rang per Debug (wie im Spiel zum Testen), ein Tick -> Angebot
  await sitz(a, 'shop'); await sitz(b, 'shop'); await sitz(c, 'shop');
  ok(g.players.every((p) => p.console === 'shop'), 'alle drei sitzen am Terminal (jeder darf, keine Rolle)');
  a.send({ t: 'debug', cmd: 'ruf', args: 'rom ' + TRIBUN });
  await sleep(300);
  tick();
  await bis(() => alle((x) => x.absicht && x.absicht.angebot), 2000);
  ok(alle((x) => x.absicht && x.absicht.frei === 1 && x.absicht.angebot && x.absicht.angebot.length >= 2 && x.absicht.angebot.length <= 3), 'ab Tribun: alle drei sehen dasselbe Angebot mit 2–3 Karten');
  ok(gleich(a.absicht, b.absicht) && gleich(b.absicht, c.absicht), 'der Block ist für alle drei gleich (Karten, Restzeit)');
  ok(a.absicht.angebot.every((k) => k.id && k.name && k.text && k.dauer > 0), 'jede Karte: Id, Name, Text, Dauer');
  ok(alle((x) => x.funk.some((t) => t === TEXTE.funk.angebot)), 'der Lagefunk „Rom bietet Euch eine Absicht an“ erreicht alle drei');
  const rufVor = JSON.stringify(a.ruf);
  messen();

  // 3. Nur der Server schreibt: Befehle ohne Konsole shop und gefälschte Nachrichten
  const ang = a.absicht.angebot.map((k) => k.id);
  await sitz(c, 'helm');   // Cem steht am Steuer
  c.antw.length = 0;
  c.send({ t: 'cmd', c: 'absicht.waehlen', id: ang[0] });
  b.send({ t: 'absicht', id: ang[0] }); b.send({ t: 'cmd', c: 'absicht.setzen', id: ang[0] }); b.send({ t: 'lobbyOpt', absicht: ang[0] });
  b.send({ t: 'cmd', c: 'absichten.rom', p_act: 1 });
  await sleep(500);
  ok(ws().absicht.laufend === null && ws().absicht.angebot && !z().absichten.rom, 'ohne Konsole shop und mit gefälschten Nachrichten: nichts gewählt, nichts gesetzt');
  ok(g.errors === 0, 'kein Serverfehler durch gefälschte Nachrichten');
  await sitz(c, 'shop');

  // 4. Gleichzeitige Wahl: genau eine gilt
  for (const x of [a, b, c]) x.antw.length = 0;
  const wA = ang[ang.length - 1], wB = ang[0], wC = ang[Math.min(1, ang.length - 1)];
  b.send({ t: 'cmd', c: 'absicht.waehlen', id: wB });
  c.send({ t: 'cmd', c: 'absicht.waehlen', id: wC });
  a.send({ t: 'cmd', c: 'absicht.waehlen', id: wA });
  await bis(() => alle((x) => x.antw.length >= 1), 2000);
  const oks = [a, b, c].filter((x) => antwortVon(x, 'waehlen').some((q) => q.ok));
  const nein = [a, b, c].filter((x) => antwortVon(x, 'waehlen').some((q) => !q.ok));
  ok(oks.length === 1 && nein.length === 2, `genau eine Wahl gilt (${oks.length}), die anderen beiden bekommen eine Absage (${nein.length})`);
  ok(nein.every((x) => antwortVon(x, 'waehlen').every((q) => q.code === 'schon_gewaehlt' && /Schon gewählt/.test(q.text))), 'die Absage ist „Schon gewählt: …“');
  const gewinner = ws().absicht.laufend && ws().absicht.laufend.id;
  ok(gewinner && KAT.find((k) => k.id === gewinner) && ang.includes(gewinner), 'gewählt ist eine Absicht des Angebots: ' + gewinner);
  await bis(() => alle((x) => x.absicht && x.absicht.laufend), 2000);
  ok(alle((x) => x.absicht.laufend && x.absicht.laufend.id === gewinner && x.absicht.angebot === undefined), 'alle drei sehen dieselbe laufende Absicht, das Angebot ist weg');
  ok(gleich(a.absicht, b.absicht) && gleich(b.absicht, c.absicht), 'der Block ist wieder für alle gleich');
  const wk = KAT.find((k) => k.id === gewinner).wirkung;
  ok(z().absichten.rom && z().absichten.rom.p_act === wk.p_act && z().absichten.rom.aggr === wk.aggr && z().absichten.rom.max_active === wk.max_active, 'zustand.absichten.rom = Wirkung der gewählten Absicht (Server)');
  ok(JSON.stringify(a.ruf) === rufVor, 'Annehmen ändert den Ruf nicht (world.ruf unverändert)');
  // Nachzügler wählt noch einmal
  b.antw.length = 0; b.send({ t: 'cmd', c: 'absicht.waehlen', id: ang[0] }); await sleep(300);
  ok(antwortVon(b, 'waehlen').length === 1 && !antwortVon(b, 'waehlen')[0].ok && ws().absicht.laufend.id === gewinner, 'eine spätere Wahl: „schon gewählt“, der Zustand bleibt');
  messen();

  // 5. Ablauf: die Dauer vergeht (Sprünge), zustand.absichten.rom wird geräumt, Lagefunk
  const dauer = KAT.find((k) => k.id === gewinner).dauer;
  for (let i = 0; i < dauer - 1; i++) tick();
  await sleep(200);
  ok(ws().absicht.laufend && z().absichten.rom, `nach ${dauer - 1} von ${dauer} Sprüngen gilt sie noch`);
  const rest = a.absicht.laufend && a.absicht.laufend.rest;
  ok(rest === 1, 'die Anzeige zählt mit: noch 1 Sprung (' + rest + ')');
  tick();
  await bis(() => alle((x) => x.absicht && !x.absicht.laufend), 2000);
  ok(ws().absicht.laufend === null && z().absichten.rom === undefined, 'nach der Dauer: Absicht beendet, zustand.absichten.rom weg');
  ok(alle((x) => x.absicht && !x.absicht.laufend && x.absicht.angebot === undefined), 'alle drei sehen: nichts läuft, noch kein neues Angebot (Pause)');
  ok(alle((x) => x.funk.some((t) => /ausgelaufen/.test(t))), 'der Lagefunk „ausgelaufen“ erreicht alle drei');
  messen();

  // 6. Pause, neues Angebot, Ablehnen: der Ruf bleibt
  for (let i = 0; i < W.abstand_nach_ablauf.wert; i++) tick();
  await bis(() => alle((x) => x.absicht && x.absicht.angebot), 2000);
  ok(alle((x) => x.absicht && x.absicht.angebot), 'nach der Pause: wieder ein Angebot, für alle');
  const rufVorAblehnen = JSON.stringify(ws().ruf);
  for (const x of [a, b, c]) x.antw.length = 0;
  c.send({ t: 'cmd', c: 'absicht.ablehnen' });
  await bis(() => alle((x) => x.absicht && !x.absicht.angebot), 2000);
  ok(antwortVon(c, 'ablehnen').length === 1 && antwortVon(c, 'ablehnen')[0].ok === true, 'Ablehnen durch Cem: ok');
  ok(alle((x) => x.absicht && !x.absicht.angebot && !x.absicht.laufend) && !z().absichten.rom, 'das Angebot ist bei allen weg, keine Absicht, die Standard-KI läuft');
  ok(JSON.stringify(ws().ruf) === rufVorAblehnen && JSON.stringify(a.ruf) === rufVor, 'Ablehnen ändert den Ruf nicht (Server und world.ruf)');
  a.antw.length = 0; a.send({ t: 'cmd', c: 'absicht.ablehnen' }); await sleep(250);
  ok(antwortVon(a, 'ablehnen').length === 1 && antwortVon(a, 'ablehnen')[0].ok === false && antwortVon(a, 'ablehnen')[0].code === 'kein_angebot', 'ein zweites Ablehnen: kein Angebot, keine Folge');
  // Ignorieren: das nächste Angebot verfällt unbeachtet
  for (let i = 0; i < W.abstand_nach_verfall.wert; i++) tick();
  await bis(() => alle((x) => x.absicht && x.absicht.angebot), 2000);
  ok(alle((x) => x.absicht && x.absicht.angebot), 'nach der Pause: wieder ein Angebot');
  const rufVorIgnorieren = JSON.stringify(ws().ruf);
  for (let i = 0; i < W.angebot_dauer.wert; i++) tick();
  await bis(() => alle((x) => x.absicht && !x.absicht.angebot), 2000);
  ok(alle((x) => x.absicht && !x.absicht.angebot && !x.absicht.laufend) && JSON.stringify(ws().ruf) === rufVorIgnorieren, 'Ignorieren: das Angebot verfällt bei allen, der Ruf bleibt');
  messen();

  // 7. Ein Spieler geht, nichts bricht ab
  c.ws.close(); await sleep(400);
  ok(g.errors === 0 && ws() && ws().absicht, 'ein Spieler trennt: Server und Absicht-Zustand unverändert, Fehlerzähler 0');
  messen();
  ok(snapMax > 0 && snapMax <= 18944, `Snapshot-Größe während des ganzen Ablaufs max ${snapMax} B (Ziel ≤ 18 944 B)`);

  // 8. Löschsignal: der Modus endet
  const nullVor = a.absichtNull;
  const merk = g.weltsim; g.weltsim = null;
  await bis(() => a.absichtNull > nullVor, 2000);
  ok(a.absichtNull === nullVor + 1 && a.absicht === null, 'Modus endet: world.absicht = null (Löschsignal) genau einmal');
  await sleep(400);
  ok(a.absichtNull === nullVor + 1, 'und danach nicht noch einmal');
  g.weltsim = merk;
  ok(g.errors === 0, 'Server-Fehlerzähler 0 (' + g.errors + ')');

  try { a.ws.close(); b.ws.close(); } catch (e) { /* egal */ }
  await srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'ABSICHTEN-WS OK'}`);
  process.exit(fails ? 1 : 0);
})();
