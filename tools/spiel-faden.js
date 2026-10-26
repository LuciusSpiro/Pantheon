'use strict';
// SUND-04a-2 P3 (Spieltest): echter Server (wie npm run debug) mit FAEDEN=1, Lage-Spielleiter (Mock), drei WebSocket-Clients. Der Notruf bewaeltigt
// oeffnet den dankbaren Captain; die Crew (drei Clients) beantwortet die Bitte, die Tätigkeiten laufen ueber die Grenzen des Spielleiters, bis der Faden
// abgeschlossen ist. Ausgabe: ein Protokoll (Zeile je Ereignis) auf der Konsole und in der Datei --out (Standard: Scratchpad-Ordner des Laufs).
// Aufruf: node tools/spiel-faden.js [--out datei.txt]   (npm run spiel:faden)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'mock'; process.env.LAGE_SPIELLEITER = '1'; process.env.REISE_EREIGNISSE = '1'; process.env.FAEDEN = '1';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Faden = require('../server/sim/faden.js');
const Bitte = require('../server/sim/faden-bitte.js');
const Kriegslage = require('../server/sim/kriegslage.js');

const CODE = 'SPFD';
const NAMEN = ['Ada', 'Bo', 'Cem'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const protokoll = [];
const zeile = (s) => { const t = new Date().toISOString().slice(11, 19); protokoll.push(`${t}  ${s}`); console.log(`${t}  ${s}`); };
const outIdx = process.argv.indexOf('--out');
const outDatei = outIdx > 0 ? process.argv[outIdx + 1] : path.join(os.tmpdir(), 'spiel-faden-protokoll.txt');

function client(port, hello, name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, name, funk: [], antw: 0, bitte: null };
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.t === 'snap') { if (m.world && 'bitte' in m.world) c.bitte = m.world.bitte; return; }
      if (m.t === 'event' && m.kind === 'radio' && name === NAMEN[0]) c.funk.push(`${m.from}: ${m.text}`);
      if (m.t === 'event' && m.kind === 'fadenBitteAntwort') c.antw++;
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spiel-faden-'));
  const srv = await startServer({ port: 0, quiet: true, noStore: true, worlds: true, worldDir: dir, debug: true, roomCode: CODE });
  const g = srv.game, port = srv.port;
  zeile(`Server auf Port ${port}, Schalter FAEDEN=1`);
  const cl = [await client(port, { clientId: 'A', name: NAMEN[0], color: 0 }, NAMEN[0]), await client(port, { clientId: 'B', name: NAMEN[1], color: 1 }, NAMEN[1]), await client(port, { clientId: 'C', name: NAMEN[2], color: 2 }, NAMEN[2])];
  await sleep(300);
  cl[0].send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const x of cl) x.send({ t: 'ready', ready: true });
  await sleep(1200);
  zeile(`drei Clients im Spiel: ${g.players.filter((p) => p.connected).length} verbunden, Phase ${g.phase}, Lage-Spielleiter ${g.lageSpielleiter && !g.lageSpielleiter.disposed ? 'aktiv (Mock, Modus ' + g.lageSpielleiter.mode + ')' : 'nicht aktiv'}`);

  // Der Notruf ist bewaeltigt: die Person am Ausgang oeffnet ein Angebot (Hook, wie reise-ereignis)
  const angebot = Faden.ausgangMitPerson(g, { art: 'notruf', id: 'notruf_pirat_frachter', hex: '0403', sprecher: 'Frachter Aurelia', ausgang: 'gelungen' });
  zeile(`Notruf bewaeltigt (notruf_pirat_frachter): Angebot ${angebot ? 'Nr ' + angebot.nr + ' fuer ' + angebot.vorlagen.join(', ') : 'keines'}`);
  let faden = null;
  for (let i = 0; i < 120 && !faden; i++) {   // der Spielleiter (Mock) oeffnet aus dem Angebot an der naechsten Grenze
    Kriegslage.tick(g, 'spiel');
    g.lageGrenze('szene_ende');
    await sleep(120);
    faden = g.weltsim.faeden.liste.find((f) => f.vorlage === 'dankbarer_captain') || null;
  }
  zeile(faden ? `Faden ${faden.id} (dankbarer_captain) geoeffnet, NSC ${faden.nsc.name} (${faden.nsc.schiff}), Abstand ${faden.abstand}` : 'KEIN Faden geoeffnet');
  let gesehen = 0;
  for (let i = 0; i < 1200 && !(faden && faden.phase === 'abgeschlossen'); i++) {
    Kriegslage.tick(g, 'spiel');
    g.lageGrenze('szene_ende');
    await sleep(100);
    const off = Bitte.offen(g);
    if (off && !off.gemeldet) {
      off.gemeldet = true;
      zeile(`Bitte ${off.nr} (${off.beatId}) an alle drei: ${off.text} [${off.optionen.map((o) => o.text).join(' | ')}]`);
      const antwort = off.optionen.find((o) => o.id === 'annehmen') || off.optionen[0];
      cl[0].send({ t: 'cmd', c: 'faden.bitte', id: antwort.id, nr: off.nr });   // Ada antwortet
      cl[1].send({ t: 'cmd', c: 'faden.bitte', id: 'ablehnen', nr: off.nr });   // Bo antwortet gleichzeitig: wird verworfen (die erste gilt)
      zeile(`Crew antwortet: Ada „${antwort.text}“, Bo „Sucht Euch jemand anderen“ (gleichzeitig, nur eine Antwort gilt)`);
    }
    if (faden) {
      const beats = g.lageRegie && g.lageRegie.log ? g.lageRegie.log.entries.filter((e) => e.art === 'faden_ereignis' && e.key === faden.id) : [];
      for (const e of beats.slice(gesehen)) zeile(`Faden: ${e.begruendung}`);
      gesehen = beats.length;
    }
  }
  await sleep(300);
  const fertig = faden && faden.phase === 'abgeschlossen';
  zeile(fertig ? `Faden abgeschlossen: Ausgang ${faden.ausgang.art}, NSC ${faden.nsc.status}, Gedaechtnis ${faden.nsc.gedaechtnis.map((x) => x.ereignis).join(', ')}` : `Faden NICHT abgeschlossen (Phase ${faden && faden.phase}, Beat ${faden && faden.beat})`);
  zeile(`Funk bei Ada (Auswahl): ${cl[0].funk.slice(-6).join(' || ').slice(0, 600)}`);
  zeile(`Bitten-Antworten bei allen drei: ${cl.map((x) => x.antw).join(', ')}`);
  fs.writeFileSync(outDatei, protokoll.join('\n') + '\n');
  zeile(`Protokoll geschrieben: ${outDatei}`);
  for (const x of cl) x.ws.close();
  process.exit(fertig ? 0 : 1);
})().catch((e) => { console.log('FEHLER: ' + (e && e.stack)); process.exit(1); });
