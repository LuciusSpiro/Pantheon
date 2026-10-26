'use strict';
// SUND-04a-2 P2 (Mehrspieler): Bitten der Geschichtsfaeden am ECHTEN Server – drei WebSocket-Clients wie im Spiel (Lobby, Start, Befehle, Snapshots, Ereignisse). Alle drei sehen dasselbe Angebot
// (world.bitte), jeder darf antworten (keine Konsole, keine Rolle), bei gleichzeitigen Antworten gilt genau eine (die erste), die anderen bekommen „schon beantwortet“ (Ereignis fadenBitteAntwort);
// die Antwort der Crew kommt bei allen (Plakette Lerche, kein Spielername); das Löschsignal kommt genau einmal; eine NSC-Funkzeile trägt das Porträt (pid); Müll als Befehl wirft nichts.
// Fixture am Server-Objekt: nur das Ereignis (Angebot Notruf, Faden öffnen, Beat starten, Tätigkeiten), alles andere über das Netz.   node tools/test-faden-bitte-ws.js   (npm run test:faden-bitte-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off'; process.env.REISE_EREIGNISSE = '1'; process.env.FAEDEN = '1';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const X = require('./faden-fixture.js');
const Faden = require('../server/sim/faden.js');
const Bitte = require('../server/sim/faden-bitte.js');
const D = require('../server/sim/faden-daten.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'FNB4';

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, sizes: [], bitte: undefined, bloecke: 0, nullSignale: 0, antw: [], funk: [], pid: null };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'welcome') c.pid = m.pid;
      if (m.t === 'snap') {
        c.sizes.push(Buffer.byteLength(s));
        if (m.world && 'bitte' in m.world) { c.bitte = m.world.bitte; if (m.world.bitte === null) c.nullSignale++; else c.bloecke++; }
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') c.funk.push({ von: m.from, text: m.text, pid: m.pid });
      if (m.t === 'event' && m.kind === 'fadenBitteAntwort') c.antw.push(m);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-faden-bitte-ws-'));
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
  const alle = (f) => [a, b, c].every(f);

  // Fixture: Vorlage mit Ausgängen, Faden über den Notruf-Hook öffnen, Beat starten, Abstand über echte Tätigkeitsgrenzen
  X.registriere(X.alsVorlage('test_bitte_ws', (v) => { v.beats[0].optionen[0].ausgang = 'gelungen'; }));
  const angebot = Faden.ausgangMitPerson(g, { art: 'notruf', id: 'notruf_ws', hex: '0305', sprecher: 'Sprecher', ausgang: 'gelungen' });
  ok(!!angebot, 'Notruf mit Person am Ausgang macht ein Faden-Angebot');
  const oe = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'test_bitte_ws', parameter: { angebot: angebot.nr } });
  ok(oe.ok, 'der Spielleiter öffnet den Faden (Befehl, Fixture)');
  for (let i = 0; i < 6; i++) g.lageGrenze('andocken');
  const we = Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: oe.faden.id, beat: 'b_bitte' });
  ok(we.ok, 'der Beat bitte startet (Befehl, Fixture)');
  ok(!!g.weltsim.faeden.bitte, 'das Angebot steht am Server');
  await bis(() => alle((x) => x.bitte), 3000);
  await sleep(1500);
  ok(alle((x) => x.bloecke <= 2), 'das Angebot geht nur bei Änderung raus (nicht in jedem Snapshot): ' + [a, b, c].map((x) => x.bloecke).join(','));
  const nr = g.weltsim.faeden.bitte.nr;
  ok(alle((x) => x.bitte && x.bitte.nr === nr), 'alle drei sehen dieselbe Bitte (world.bitte)');
  ok(alle((x) => x.bitte && x.bitte.kopf === 'BITTE' && x.bitte.optionen.map((o) => o.id).join(',') === 'zusagen,ablehnen,spaeter'), 'Kopf BITTE und die drei Optionen (ohne Folgen)');
  ok(alle((x) => x.bitte && x.bitte.optionen.every((o) => Object.keys(o).sort().join(',') === 'id,text')), 'im Snapshot stehen keine Folgen');
  ok(alle((x) => x.bitte && /^f:[0-5]:(rom|kon|ger)$/.test(x.bitte.pid || '')), 'das Porträt des Absenders (pid) steht im Snapshot');
  ok(alle((x) => JSON.stringify(x.bitte) === JSON.stringify(a.bitte)), 'derselbe Block bei allen (ein Block für alle)');
  const groesste = Math.max(...[a, b, c].map((x) => Math.max(...x.sizes, 0)));
  ok(groesste <= 18944, `Snapshot mit offener Bitte bleibt im Budget (${groesste} B, höchstens 18944)`);

  // Gleichzeitige Antworten: genau eine gilt
  const ant0 = [a, b, c].map((x) => x.antw.length);
  a.send({ t: 'cmd', c: 'faden.bitte', id: 'zusagen', nr });
  b.send({ t: 'cmd', c: 'faden.bitte', id: 'ablehnen', nr });
  c.send({ t: 'cmd', c: 'faden.bitte', id: 'zusagen', nr });
  await bis(() => [a, b, c].every((x, i) => x.antw.length > ant0[i]), 3000);
  const neu = [a, b, c].map((x, i) => x.antw.slice(ant0[i]));
  const gut = neu.flat().filter((m) => m.ok), schlecht = neu.flat().filter((m) => !m.ok);
  ok(gut.length === 1 && schlecht.length === 2 && schlecht.every((m) => m.code === 'schon_beantwortet'), 'bei gleichzeitigen Antworten gilt genau eine, die anderen bekommen „schon beantwortet“');
  ok(gut.length === 1 && gut[0].kind === 'fadenBitteAntwort', 'die Antwort geht als Ereignis fadenBitteAntwort an den Absender');
  const zuletzt = g.weltsim.faeden.bitteZuletzt;
  ok(zuletzt && zuletzt.nr === nr && g.weltsim.faeden.liste[0].nsc.haltung === 2, 'serverseitig gilt genau eine Folge (Haltung 2: geholfen und gedankt)');
  await bis(() => alle((x) => x.bitte === null), 3000);
  ok(alle((x) => x.bitte === null && x.nullSignale === 1), 'das Angebot verschwindet bei allen; das Löschsignal kommt genau einmal');
  const zusage = D.vorlage('test_bitte_ws').beats[0].optionen[0].text;
  await bis(() => alle((x) => x.funk.some((f) => f.von === 'Lerche' && f.text === zusage)), 3000);
  ok(alle((x) => x.funk.some((f) => f.von === 'Lerche' && f.text === zusage)), 'alle drei hören die Antwort der Crew (Plakette Lerche, der angeklickte Text)');
  ok(![a, b, c].some((x) => x.funk.some((f) => /Ada|Bo\b|Cem/.test(f.text + f.von))), 'kein Spielername im Funk');

  // NSC-Funkzeile mit Porträt (funkVon, Aufrufer P1/P3)
  const nsc = g.weltsim.faeden.liste[0].nsc;
  Bitte.funkVon(g, nsc, 'Danke, Lerche.');
  await bis(() => alle((x) => x.funk.some((f) => f.text === 'Danke, Lerche.')), 3000);
  const zeile = a.funk.find((f) => f.text === 'Danke, Lerche.');
  ok(!!zeile && zeile.von === nsc.name && /^f:[0-5]:(rom|ger|kon)$/.test(zeile.pid || ''), 'die NSC-Funkzeile trägt Name und Porträt (pid)');

  // Müll als Befehl: keine Ausnahme, keine Folge, keine Änderung
  const e0 = g.errors, h0 = JSON.stringify(g.weltsim.faeden.liste[0].nsc), r0 = JSON.stringify(g.weltsim.ruf);
  for (const m of [{ id: null }, { id: 5 }, { id: { x: 1 } }, { id: '__proto__' }, { id: 'zusagen', nr: 'x' }, {}]) b.send(Object.assign({ t: 'cmd', c: 'faden.bitte' }, m));
  await sleep(500);
  ok(g.errors === e0 && JSON.stringify(g.weltsim.faeden.liste[0].nsc) === h0 && JSON.stringify(g.weltsim.ruf) === r0, 'Müll als Befehl: keine Ausnahme, keine Folge');

  // Nach der Annahme wartet der Faden auf seinen nächsten Beat; ohne neuen Beat gibt es kein Angebot
  for (let i = 0; i < 6; i++) g.lageGrenze('andocken');
  ok(!g.weltsim.faeden.bitte && g.weltsim.faeden.liste[0].phase === 'wartet', 'nach der Annahme: kein Angebot mehr, der Faden wartet auf den nächsten Beat');
  console.log(`\n${n - fails} von ${n} Prüfungen bestanden` + (fails ? `, ${fails} FEHLER` : ''));
  for (const x of [a, b, c]) x.ws.close();
  await sleep(200);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ABSTURZ Ausnahme:', e && e.stack); process.exit(1); });
