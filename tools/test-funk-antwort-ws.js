'use strict';
// SUND-03b A (Abnahme Mehrspieler): Funk-Antworten am ECHTEN Server – drei WebSocket-Clients wie im Spiel (Lobby, Start, Befehle, Snapshots, Ereignisse). Alle drei sehen dasselbe Angebot
// (world.funkwahl), jeder darf antworten (keine Konsole, keine Rolle), bei gleichzeitigen Antworten gilt genau eine (die erste), die anderen bekommen „schon beantwortet“; alle hören die Antwort der Crew
// und die Reaktion des Sprechers; Ignorieren kostet nichts; in unruhiger Lage (laufende Gefahr) ist die Antwort nicht möglich; das Löschsignal kommt einmal; der Snapshot bleibt im Budget.
// Fixture am Server-Objekt: nur das Ereignis (Sprung mit erzwungenem Katalogeintrag), alles andere über das Netz.   node tools/test-funk-antwort-ws.js   (Port PORT oder 0 = frei)   (npm run test:funk-antwort-ws)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off'; process.env.REISE_EREIGNISSE = '1';
const WebSocket = require('ws');
const { startServer } = require('../server/index.js');
const Sektoren = require('../shared/sektoren.js');
const Sprung = require('../server/sim/sprung.js');
const RE = require('../server/sim/reise-ereignis.js');
const FA = require('../server/sim/funk-antwort.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'FNK3';
const W = RE.WERTE;
const KAT = RE.KATALOG;
function nur(ids, fn) { const kopie = KAT.slice(); KAT.length = 0; for (const e of kopie) if (ids.includes(e.id)) KAT.push(e); try { return fn(); } finally { KAT.length = 0; KAT.push(...kopie); } }
function sicher(fn) { const alt = W.wahrscheinlichkeit; W.wahrscheinlichkeit = 1; try { return fn(); } finally { W.wahrscheinlichkeit = alt; } }

function client(port, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, sizes: [], funk: [], antw: [], block: undefined, bloecke: 0, nullSignale: 0, ruf: null, pid: null };
    ws.on('message', (data) => {
      const s = data.toString(); const m = JSON.parse(s);
      if (m.t === 'welcome') c.pid = m.pid;
      if (m.t === 'snap') {
        c.sizes.push(Buffer.byteLength(s));
        if (m.world && 'funkwahl' in m.world) { c.block = m.world.funkwahl; if (m.world.funkwahl === null) c.nullSignale++; else c.bloecke++; }
        if (m.world && m.world.ruf) c.ruf = m.world.ruf;
        return;
      }
      if (m.t === 'event' && m.kind === 'radio') c.funk.push({ von: m.from, text: m.text });
      if (m.t === 'event' && m.kind === 'funkAntwort') c.antw.push(m);
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', code: CODE }, hello)); resolve(c); });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-funk-ws-'));
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
  const offen = () => (ws().funkwahl && ws().funkwahl.offen) || null;
  const ereignis = (id, hex) => { ws().zustand.flotten = []; g.space.enemies = []; ws().reise.letzter = null; ws().reise.letzte = []; return nur([id], () => sicher(() => Sprung.springeNach(g, Sektoren.ortVonHex(hex)))); };
  const antwortenVon = (x) => x.antw.length;

  // 1. Ohne Angebot: kein Block
  await sleep(400); messen();
  ok(alle((x) => x.block === undefined), 'ohne Angebot sendet der Server keinen Block (kein Mehrverbrauch)');
  const antwOhne = (x) => x.send({ t: 'cmd', c: 'funk.antworten', id: 'kennung' });
  antwOhne(a); await sleep(300);
  ok(a.antw.length === 1 && a.antw[0].ok === false && a.antw[0].code === 'kein_angebot', 'Antwort ohne Angebot: „kein Angebot“ an den Absender, an sonst niemanden');
  ok(b.antw.length === 0 && c.antw.length === 0, 'die anderen bekommen die Weigerung nicht');

  // 2. Angebot: alle drei sehen dasselbe
  const r = ereignis('patrouille_rom_gruss', '0305');
  ok(r && r.id === 'patrouille_rom_gruss' && !!offen(), 'Streife funkt, das Angebot steht');
  await bis(() => alle((x) => x.block), 3000);
  ok(alle((x) => x.block && x.block.optionen.length === 2 && x.block.von === 'Römische Streife' && x.block.nr === offen().lfd && x.block.rest === W.antwort_gilt_spruenge), 'alle drei sehen dasselbe Angebot (world.funkwahl): Sprecher, 2 Optionen, Gültigkeit');
  ok(alle((x) => JSON.stringify(x.block) === JSON.stringify(a.block)), 'derselbe Block bei allen (ein Block für alle, nicht je Spieler)');
  ok(alle((x) => x.funk.some((f) => /Kennung erfasst|Papiere sind in Ordnung/.test(f.text))), 'alle hören den Funk der Streife');
  const nr = a.block.nr, rufVor = JSON.stringify(ws().ruf);
  // 3. Gleichzeitige Antworten: genau eine gilt
  const sendeAlle = () => { a.send({ t: 'cmd', c: 'funk.antworten', id: 'kennung', nr }); b.send({ t: 'cmd', c: 'funk.antworten', id: 'saum', nr }); c.send({ t: 'cmd', c: 'funk.antworten', id: 'kennung', nr }); };
  const ant0 = [a, b, c].map(antwortenVon);
  sendeAlle();
  await bis(() => [a, b, c].every((x, i) => antwortenVon(x) > ant0[i]), 3000);
  const neu = [a, b, c].map((x, i) => x.antw.slice(ant0[i]));
  const gut = neu.flat().filter((m) => m.ok), schlecht = neu.flat().filter((m) => !m.ok);
  ok(gut.length === 1 && schlecht.length === 2 && schlecht.every((m) => m.code === 'schon_beantwortet'), 'bei gleichzeitigen Antworten gilt genau eine (die erste), die anderen bekommen „schon beantwortet“');
  const gewonnen = ['kennung', 'saum'][0];
  const z = ws().funkwahl.zuletzt;
  ok(z && (z.id === 'kennung' || z.id === 'saum') && z.gebucht === 1, 'serverseitig: genau eine Folge gebucht (' + z.id + ')');
  const rufNach = ws().ruf;
  ok(JSON.stringify(rufNach) !== rufVor && ((z.id === 'kennung' && rufNach.rom === JSON.parse(rufVor).rom + require('../content/welt/ruf-werte.json').werte.quellen.wert.funk_rom_gruss.delta) || (z.id === 'saum' && rufNach.kon === 0.5)), 'der Ruf ändert sich genau einmal (' + JSON.stringify(rufNach) + ')');
  await bis(() => alle((x) => x.block === null), 3000);
  ok(alle((x) => x.block === null && x.nullSignale === 1), 'das Angebot verschwindet bei allen (Löschsignal world.funkwahl = null genau einmal)');
  const text = KAT.find((e) => e.id === 'patrouille_rom_gruss').antworten.find((o) => o.id === z.id);
  ok(alle((x) => x.funk.some((f) => f.von === 'Lerche' && f.text === text.text)), 'alle drei hören die Antwort der Crew (Plakette Lerche, kein Spielername)');
  ok(alle((x) => !x.funk.some((f) => f.text === text.reaktion)), 'die Reaktion des Sprechers kommt nicht sofort');
  await bis(() => alle((x) => x.funk.some((f) => f.text === text.reaktion)), (W.antwort_reaktion_s + 3) * 1000);
  ok(alle((x) => x.funk.some((f) => f.von === 'Römische Streife' && f.text === text.reaktion)), `alle drei hören nach ${W.antwort_reaktion_s} s die Reaktion des Sprechers`);
  ok(![a, b, c].some((x) => x.funk.some((f) => /Ada|Bo\b|Cem/.test(f.text + f.von))), 'kein Spielername im Funk');
  messen();

  // 4. Ein veraltetes Angebot (nr) gilt nicht für das neue
  ereignis('funk_handel_stimmen', '0305');
  await bis(() => alle((x) => x.block && x.block.nr !== nr), 3000);
  const nr2 = a.block.nr;
  ok(nr2 === nr + 1, 'neues Angebot, neue Nummer');
  const alt = a.antw.length; a.send({ t: 'cmd', c: 'funk.antworten', id: 'rom', nr }); await sleep(300);
  ok(a.antw.length === alt + 1 && a.antw[alt].ok === false && a.antw[alt].code === 'kein_angebot' && !!offen(), 'ein Klick auf das ältere Angebot gilt nicht, das neue bleibt');
  // 5. Müll und gefälschte Nachrichten
  const e0 = g.errors;
  for (const m of [{ id: null }, { id: 5 }, { id: { x: 1 } }, { id: '__proto__' }, { id: 'rom', nr: 'x' }, {}]) b.send(Object.assign({ t: 'cmd', c: 'funk.antworten' }, m));
  b.send({ t: 'cmd', c: 'funk.antworten', id: 'rom', nr: { a: 1 } });
  await sleep(500);
  ok(g.errors === e0 && !!offen() && JSON.stringify(ws().ruf) === JSON.stringify(rufNach), 'Müll als Befehl: keine Ausnahme, keine Folge, das Angebot bleibt');
  // 6. Ignorieren
  const rufVorIgn = JSON.stringify(ws().ruf), chronikVor = ws().chronik.length;
  c.send({ t: 'cmd', c: 'funk.antworten', id: 'ignorieren', nr: nr2 });
  await bis(() => alle((x) => x.block === null && x.nullSignale === 2), 3000);
  ok(alle((x) => x.block === null && x.nullSignale === 2), 'Nicht antworten: das Angebot verschwindet bei allen');
  await sleep(W.antwort_reaktion_s * 1000 + 800);
  ok(JSON.stringify(ws().ruf) === rufVorIgn && ws().chronik.length === chronikVor && !a.funk.some((f) => f.text === KAT.find((e) => e.id === 'funk_handel_stimmen').antworten[0].reaktion), 'Ignorieren kostet nichts: kein Ruf, keine Chronik, keine Reaktion');
  messen();

  // 7. Unruhige Lage: keine Antwort, Angebot zurückgezogen
  ereignis('funk_handel_stimmen', '0304');
  await bis(() => alle((x) => x.block && x.nullSignale === 2 && x.bloecke >= 3), 3000);
  const nr3 = a.block && a.block.nr;
  const rufVorSz = JSON.stringify(ws().ruf);
  const gefahr = { nr: 99, id: 'piraten_hinterhalt', phase: 'erwartet', szene: g.ship.scene, sprung: ws().reise.n, ab: g.time + 1e6, tag: 'fixture' };
  ws().reise.laufend.push(gefahr);   // laufende (angekündigte) Gefahr: unruhige Lage, ohne eine Szene zu fälschen
  const antN = b.antw.length; b.send({ t: 'cmd', c: 'funk.antworten', id: 'rom', nr: nr3 });
  await bis(() => b.antw.length > antN, 2000);
  ok(b.antw[antN] && b.antw[antN].ok === false && ['unruhig', 'kein_angebot'].includes(b.antw[antN].code) && JSON.stringify(ws().ruf) === rufVorSz, 'bei laufender Gefahr: abgelehnt („unruhig", oder „kein Angebot“, wenn der Server das Angebot schon zurückgezogen hat), keine Folge');
  await bis(() => alle((x) => x.block === null && x.nullSignale === 3), 3000);
  ok(alle((x) => x.block === null && x.nullSignale === 3), 'das Angebot ist bei allen zurückgezogen');
  ws().reise.laufend.splice(ws().reise.laufend.indexOf(gefahr), 1);

  // 8. Schalter aus: nichts
  process.env.REISE_EREIGNISSE = '0';
  ok(FA.anbieten(g, { id: 'funk_handel_stimmen', nr: 1, hex: '0305', textIdx: 0 }) === null, 'Schalter aus: kein Angebot');
  process.env.REISE_EREIGNISSE = '1';

  // 9. Ein Spieler geht, nichts bricht ab
  ereignis('funk_handel_stimmen', '0305');
  await bis(() => alle((x) => x.block && x.bloecke >= 4), 3000);
  c.ws.close(); await sleep(400);
  ok(g.errors === 0 && !!offen(), 'ein Spieler trennt: Server und Angebot unverändert, Fehlerzähler 0');
  messen();
  a.send({ t: 'cmd', c: 'funk.antworten', id: 'tipp', nr: a.block.nr });
  await bis(() => a.block === null, 3000);
  ok(a.block === null && g.errors === 0, 'die beiden anderen antworten weiter');
  messen();
  ok(snapMax > 0 && snapMax <= 18944, `Snapshot-Größe während des ganzen Ablaufs max ${snapMax} B (Ziel ≤ 18 944 B)`);
  ok(g.errors === 0, 'Server-Fehlerzähler 0 (' + g.errors + ')');

  try { a.ws.close(); b.ws.close(); } catch (e) { /* egal */ }
  await srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n} Prüfungen, ${fails ? fails + ' FEHLER' : 'FUNK-ANTWORT-WS OK'}`);
  process.exit(fails ? 1 : 0);
})();
