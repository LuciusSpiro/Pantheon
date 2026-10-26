'use strict';
// SUND-04a-2 P3 (Mehrspieler zu dritt): die Bitte des dankbaren Captains am ECHTEN Server – drei WebSocket-Clients wie im Spiel. Der Faden gehoert der CREW,
// nicht einem Spieler: alle drei sehen dieselbe Bitte (world.bitte), jeder darf antworten, genau eine Antwort gilt (die erste), der Faden geht danach weiter,
// und in keiner Funkzeile steht ein Spielername. Fixture am Server-Objekt: nur das Ereignis (Notruf-Angebot, Faden oeffnen, Tätigkeiten), alles andere ueber das Netz.
// Aufruf: node tools/test-faden-vorlagen-ws.js   (npm run test:faden-vorlagen-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off'; process.env.REISE_EREIGNISSE = '1'; process.env.FAEDEN = '1';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Faden = require('../server/sim/faden.js');
const Bitte = require('../server/sim/faden-bitte.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'FVW3';
const NAMEN = ['Ada', 'Bo', 'Cem'];

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, sizes: [], bitte: undefined, nullSignale: 0, antw: [], funk: [] };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'snap') {
        c.sizes.push(Buffer.byteLength(s));
        if (m.world && 'bitte' in m.world) { c.bitte = m.world.bitte; if (m.world.bitte === null) c.nullSignale++; }
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') c.funk.push({ von: m.from, text: m.text });
      if (m.t === 'event' && m.kind === 'fadenBitteAntwort') c.antw.push(m);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-faden-vorlagen-ws-'));
  const srv = await startServer({ port: process.env.PORT != null ? Number(process.env.PORT) : 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game, port = srv.port;
  const a = await client(port, { clientId: 'A', name: NAMEN[0], color: 0 });
  const b = await client(port, { clientId: 'B', name: NAMEN[1], color: 1 });
  const c = await client(port, { clientId: 'C', name: NAMEN[2], color: 2 });
  await sleep(300);
  a.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of [a, b, c]) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  const bis = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(50); } return !!f(); };
  const alle = (f) => [a, b, c].every(f);
  ok(g.phase === 'play' && g.players.length === 3 && g.players.every((p) => p.connected), 'Freie Fahrt Sund laeuft mit drei Spielern ueber das Netz');

  // Fixture: der Notruf (bewaeltigt, Person am Ausgang) oeffnet den Captain; die Tätigkeiten laufen ueber die echte Grenze
  const angebot = Faden.ausgangMitPerson(g, { art: 'notruf', id: 'notruf_pirat_frachter', hex: '0403', sprecher: 'Frachter', ausgang: 'gelungen' });
  ok(!!angebot && angebot.vorlagen.includes('dankbarer_captain'), 'der Notruf bietet den dankbaren Captain an');
  const oe = angebot && Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'dankbarer_captain', parameter: { angebot: angebot.nr } });
  ok(!!(oe && oe.ok), 'der Faden wird geoeffnet (Befehl des Spielleiters, Fixture)');
  const f = oe && oe.faden;
  for (let i = 0; i < 12 && !Bitte.offen(g); i++) {
    g.lageGrenze('andocken');
    if (f.phase === 'wartet' && f.zaehler >= f.abstand) Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_bitte' });
    await sleep(60);
  }
  ok(!!Bitte.offen(g), 'die Bitte steht am Server');
  await bis(() => alle((x) => x.bitte), 3000);
  const nr = g.weltsim.faeden.bitte && g.weltsim.faeden.bitte.nr;
  ok(alle((x) => x.bitte && x.bitte.nr === nr), 'alle drei sehen dieselbe Bitte (ein Angebot fuer die Crew)');
  ok(alle((x) => x.bitte && x.bitte.optionen.map((o) => o.id).join(',') === 'annehmen,ablehnen,spaeter' && x.bitte.optionen.every((o) => Object.keys(o).sort().join(',') === 'id,text')), 'drei Optionen, im Snapshot ohne Folgen');

  // Antworten: A und C nehmen an, B lehnt ab (gleichzeitig): genau eine gilt
  a.send({ t: 'cmd', c: 'faden.bitte', id: 'annehmen', nr });
  b.send({ t: 'cmd', c: 'faden.bitte', id: 'ablehnen', nr });
  c.send({ t: 'cmd', c: 'faden.bitte', id: 'annehmen', nr });
  await sleep(1200);
  ok(alle((x) => x.nullSignale === 1), 'das Loeschsignal der Bitte kommt bei allen genau einmal');
  ok(alle((x) => x.antw.length >= 1), 'alle drei bekommen das Antwort-Ereignis');
  const antwort = g.weltsim.faeden.bitteZuletzt;
  ok(!!antwort && antwort.nr === nr, 'die erste Antwort gilt (Zuletzt-Marke der Bitte)');
  ok(f.nsc && f.beat >= 1, `nach der Annahme geht der Faden weiter (Beat ${f.beat})`);
  const alleFunk = [a, b, c].flatMap((x) => x.funk);
  ok(!alleFunk.some((z) => NAMEN.some((nm) => String(z.von).includes(nm) || String(z.text).includes(nm))), 'in keiner Funkzeile steht ein Spielername (die Crew antwortet als Schiff)');
  ok(!alleFunk.some((z) => /Fehler|undefined|NaN/.test(String(z.text))), 'kein Fehlertext im Funk');
  const groesste = Math.max(...[a, b, c].map((x) => Math.max(...x.sizes, 0)));
  ok(groesste <= 18944, `Snapshot bleibt im Budget (${groesste} B, hoechstens 18944)`);

  for (const x of [a, b, c]) x.ws.close();
  await srv.close?.();
  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log('FADEN-VORLAGEN-WS FEHLER: ' + fails); process.exit(1); }
  console.log('FADEN-VORLAGEN-WS OK');
  process.exit(0);
})().catch((e) => { console.log('ABSTURZ Ausnahme: ' + (e && e.stack)); process.exit(1); });
